//! Atomic scoped task authority. Only the bounded inert worker can consume claims.
use crate::scope;
use rand::{RngCore, rngs::OsRng};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Postgres, Row, Transaction, postgres::PgRow};
use zobba_application::task::{TaskCommands, TaskError, TaskExecution};
use zobba_domain::task::{ClaimBasis, ConsumedAttempt, Decision, Observation, WakeupRoute};
use zobba_domain::{
    identity::Scope,
    task::{
        Cessation, CommandKind, CommandReceipt, ReceiptStatus, TaskCommand, TaskEvent, TaskPage,
        TaskSnapshot, TaskState,
    },
};

pub(crate) type Tx = Transaction<'static, Postgres>;
const MAX_OPEN_TASKS: i64 = 100;
const COMMAND_BATCH: i64 = 32;

#[derive(Clone)]
pub struct TaskRepository {
    pool: PgPool,
    session_hash: Option<String>,
}
impl TaskRepository {
    pub fn new(pool: PgPool) -> Self {
        Self {
            pool,
            session_hash: None,
        }
    }
    /// Browser admission retains the captured exact session across authority waits.
    /// Worker calls retain their separately fenced durable actor authority.
    pub fn with_session_hash(mut self, hash: String) -> Self {
        self.session_hash = Some(hash);
        self
    }
    pub(crate) fn pool(&self) -> &PgPool {
        &self.pool
    }
    pub(crate) fn session(&self) -> Option<&str> {
        self.session_hash.as_deref()
    }
}
pub(crate) fn unavailable(_: sqlx::Error) -> TaskError {
    TaskError::Unavailable
}
pub(crate) fn token() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
fn digest(value: &str) -> String {
    Sha256::digest(value.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
pub(crate) fn get<T>(row: &PgRow, name: &str) -> Result<T, TaskError>
where
    for<'a> T: sqlx::Decode<'a, Postgres> + sqlx::Type<Postgres>,
{
    row.try_get(name).map_err(unavailable)
}
pub(crate) fn snapshot(row: &PgRow) -> Result<TaskSnapshot, TaskError> {
    Ok(TaskSnapshot {
        id: get(row, "id")?,
        cycle_id: get(row, "cycle_id")?,
        objective: get(row, "objective")?,
        working_brief: get(row, "working_brief")?,
        state: TaskState::parse(&get::<String>(row, "state")?).ok_or(TaskError::Unavailable)?,
        cessation: Cessation::parse(&get::<String>(row, "cessation")?)
            .ok_or(TaskError::Unavailable)?,
        intent_revision: get::<i64>(row, "intent_revision")? as u64,
        revision: get::<i64>(row, "revision")? as u64,
        execution_epoch: get::<i64>(row, "execution_epoch")? as u64,
        accountable_actor: get(row, "accountable_actor")?,
        accountable_label: get(row, "accountable_label")?,
    })
}
pub(crate) async fn begin(pool: &PgPool, actor: &str, selected: &Scope) -> Result<Tx, TaskError> {
    if !selected.is_valid() {
        return Err(TaskError::Denied);
    }
    scope::begin(pool, actor, selected)
        .await
        .map_err(|error| match error {
            scope::ScopeError::Denied => TaskError::Denied,
            scope::ScopeError::Unavailable => TaskError::Unavailable,
        })
}
pub(crate) async fn lock(pool: &PgPool, actor: &str, selected: &Scope) -> Result<Tx, TaskError> {
    let mut tx = begin(pool, actor, selected).await?;
    // Membership narrowing, permission consumption and Task controls share the
    // organisation -> engagement -> Task order. The following statements use a
    // fresh snapshot after a concurrent revocation has released this lock.
    sqlx::query("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1,205))")
        .bind(&selected.organisation_id)
        .execute(&mut *tx)
        .await
        .map_err(unavailable)?;
    let row=sqlx::query("SELECT id FROM public.engagements WHERE organisation_id=$1 AND client_id=$2 AND id=$3 FOR UPDATE")
        .bind(&selected.organisation_id).bind(&selected.client_id).bind(&selected.engagement_id).fetch_optional(&mut *tx).await.map_err(unavailable)?;
    if row.is_none() {
        return Err(TaskError::Denied);
    }
    Ok(tx)
}
pub(crate) async fn task(tx: &mut Tx, id: &str) -> Result<PgRow, TaskError> {
    sqlx::query("SELECT *,owner_until>clock_timestamp() AS owner_live,(SELECT left(display_name,200) FROM public.identities WHERE id=tasks.accountable_actor) AS accountable_label FROM public.tasks WHERE id=$1 FOR UPDATE")
        .bind(id).fetch_optional(&mut **tx).await.map_err(unavailable)?.ok_or(TaskError::Denied)
}
async fn cursor(tx: &mut Tx, s: &Scope) -> Result<i64, TaskError> {
    sqlx::query_scalar("INSERT INTO public.task_counters(organisation_id,client_id,engagement_id,cursor) VALUES($1,$2,$3,1) ON CONFLICT(organisation_id,client_id,engagement_id) DO UPDATE SET cursor=task_counters.cursor+1 RETURNING cursor")
        .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id).fetch_one(&mut **tx).await.map_err(unavailable)
}
pub(crate) async fn event(
    tx: &mut Tx,
    s: &Scope,
    task_id: &str,
    cycle_id: &str,
    command: Option<&str>,
    kind: &str,
) -> Result<i64, TaskError> {
    let next = cursor(tx, s).await?;
    put_event(tx, s, task_id, cycle_id, command, kind, next).await?;
    Ok(next)
}
#[allow(clippy::too_many_arguments)]
async fn put_event(
    tx: &mut Tx,
    s: &Scope,
    task_id: &str,
    cycle_id: &str,
    command: Option<&str>,
    kind: &str,
    cursor: i64,
) -> Result<(), TaskError> {
    sqlx::query("INSERT INTO public.task_events(organisation_id,client_id,engagement_id,cursor,task_id,cycle_id,command_id,kind) VALUES($1,$2,$3,$4,$5,$6,$7,$8)")
        .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id).bind(cursor).bind(task_id).bind(cycle_id).bind(command).bind(kind)
        .execute(&mut **tx).await.map_err(unavailable)?;
    Ok(())
}
pub(crate) async fn wake(tx: &mut Tx, s: &Scope, id: &str, actor: &str) -> Result<(), TaskError> {
    sqlx::query("INSERT INTO public.task_wakeups(id,actor_id,organisation_id,client_id,engagement_id,task_id) VALUES($1,$2,$3,$4,$5,$1) ON CONFLICT(task_id) DO UPDATE SET pending=true,available_at=clock_timestamp()")
        .bind(id).bind(actor).bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id).execute(&mut **tx).await.map_err(unavailable)?;
    sqlx::query("INSERT INTO public.task_deliveries(wakeup_id) VALUES($1) ON CONFLICT(wakeup_id) DO NOTHING")
        .bind(id).execute(&mut **tx).await.map_err(unavailable)?;
    Ok(())
}
fn receipt(row: &PgRow) -> Result<CommandReceipt, TaskError> {
    Ok(CommandReceipt {
        command_id: get(row, "id")?,
        task_id: get(row, "task_id")?,
        cycle_id: get(row, "cycle_id")?,
        event_cursor: get::<i64>(row, "received_cursor")?.to_string(),
        status: ReceiptStatus::Received,
    })
}

pub(crate) async fn admission_fence(
    tx: &mut Tx,
    actor: &str,
    s: &Scope,
    session: Option<&str>,
) -> Result<(), TaskError> {
    sqlx::query("SET CONSTRAINTS ALL IMMEDIATE")
        .execute(&mut **tx)
        .await
        .map_err(unavailable)?;
    let allowed:bool=sqlx::query_scalar("SELECT public.knowledge_audit($1,$2,$3,$4) AND ($5::text IS NULL OR public.evidence_session_locked($1,$5))").bind(actor).bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id).bind(session).fetch_one(&mut **tx).await.map_err(unavailable)?;
    if allowed {
        Ok(())
    } else {
        Err(TaskError::Denied)
    }
}

/// Admission inside an already locked organisation/engagement transaction.
/// Callers own the session fence and commit.
pub(crate) async fn admit_in(
    tx: &mut Tx,
    actor: &str,
    s: &Scope,
    c: &TaskCommand,
) -> Result<CommandReceipt, TaskError> {
    if !c.is_valid() {
        return Err(TaskError::Invalid);
    }
    let context = c.context.as_ref().map(|context| {
        serde_json::json!({
            "audit_area": context.audit_area,
            "period_start": context.period_start,
            "period_end": context.period_end,
        })
    });
    if let Some(existing) =
        sqlx::query("SELECT * FROM public.task_commands WHERE author_id=$1 AND idempotency_key=$2")
            .bind(actor)
            .bind(&c.key)
            .fetch_optional(&mut **tx)
            .await
            .map_err(unavailable)?
    {
        if get::<String>(&existing, "kind")? != c.kind.as_str()
            || get::<Option<String>>(&existing, "target_task_id")? != c.task_id
            || get::<Option<String>>(&existing, "target_cycle_id")? != c.cycle_id
            || get::<Option<String>>(&existing, "content")? != c.content
            || get::<Option<serde_json::Value>>(&existing, "methodology_context")? != context
        {
            return Err(TaskError::Conflict);
        }
        let original = receipt(&existing)?;
        crate::knowledge::project_guide(tx, s, actor, &original.command_id)
            .await
            .map_err(|_| TaskError::Unavailable)?;
        return Ok(original);
    }
    let id = c.task_id.clone().unwrap_or_else(token);
    let mut cycle = c.cycle_id.clone().unwrap_or_else(token);
    if c.kind == CommandKind::Create {
        let count: i64 =
            sqlx::query_scalar("SELECT count(*) FROM public.tasks WHERE state <> 'stopped'")
                .fetch_one(&mut **tx)
                .await
                .map_err(unavailable)?;
        if count >= MAX_OPEN_TASKS {
            return Err(TaskError::Capacity);
        }
        sqlx::query("INSERT INTO public.tasks(organisation_id,client_id,engagement_id,id,cycle_id,accountable_actor,objective,working_brief,state,cessation) VALUES($1,$2,$3,$4,$5,$6,$7,$7,'ready','none')")
                .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id).bind(&id).bind(&cycle).bind(actor).bind(&c.content).execute(&mut **tx).await.map_err(unavailable)?;
        insert_cycle(tx, s, &id, &cycle).await?;
        crate::methodology::bind_new_task(tx, s, &id, c.context.as_ref()).await?;
    } else {
        let row = task(tx, &id).await?;
        let before = snapshot(&row)?;
        if before.cycle_id != cycle || !before.state.accepts(c.kind, before.cessation) {
            return Err(TaskError::Conflict);
        }
        let unresolved:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM public.task_claims WHERE task_id=$1 AND state='consumed') OR EXISTS(SELECT 1 FROM public.operations o JOIN public.operation_claims c ON c.operation_id=o.id WHERE o.task_id=$1 AND c.state='consumed' AND NOT EXISTS(SELECT 1 FROM public.operation_receipts r WHERE r.attempt_id=c.attempt_id AND r.outcome IN ('completed','absent')))").bind(&id).fetch_one(&mut **tx).await.map_err(unavailable)?;
        match c.kind {
            CommandKind::Guide => {
                sqlx::query("UPDATE public.tasks SET intent_revision=intent_revision+1,revision=revision+1 WHERE id=$1").bind(&id).execute(&mut **tx).await.map_err(unavailable)?;
            }
            CommandKind::Pause | CommandKind::Stop => {
                let state = if c.kind == CommandKind::Pause {
                    "paused"
                } else {
                    "stopped"
                };
                let cessation = if unresolved {
                    if before.cessation == Cessation::ReconciliationRequired {
                        "reconciliation_required"
                    } else {
                        "pending"
                    }
                } else {
                    "confirmed"
                };
                sqlx::query("UPDATE public.tasks SET state=$2,cessation=$3,execution_epoch=execution_epoch+1,revision=revision+1 WHERE id=$1").bind(&id).bind(state).bind(cessation).execute(&mut **tx).await.map_err(unavailable)?;
                if c.kind == CommandKind::Stop {
                    sqlx::query(
                        "UPDATE public.task_cycles SET status='stopped' WHERE task_id=$1 AND id=$2",
                    )
                    .bind(&id)
                    .bind(&cycle)
                    .execute(&mut **tx)
                    .await
                    .map_err(unavailable)?;
                }
            }
            CommandKind::Resume | CommandKind::Continue => {
                if unresolved {
                    return Err(TaskError::Conflict);
                }
                if c.kind == CommandKind::Continue {
                    let count: i64 = sqlx::query_scalar(
                        "SELECT count(*) FROM public.tasks WHERE state <> 'stopped'",
                    )
                    .fetch_one(&mut **tx)
                    .await
                    .map_err(unavailable)?;
                    if count >= MAX_OPEN_TASKS {
                        return Err(TaskError::Capacity);
                    }
                    cycle = token();
                    insert_cycle(tx, s, &id, &cycle).await?;
                }
                sqlx::query("UPDATE public.tasks SET cycle_id=$2,state='ready',cessation='none',execution_epoch=execution_epoch+1,revision=revision+1 WHERE id=$1").bind(&id).bind(&cycle).execute(&mut **tx).await.map_err(unavailable)?;
            }
            CommandKind::Create => unreachable!(),
        }
        sqlx::query(
            "UPDATE public.task_claims SET state='abandoned' WHERE task_id=$1 AND state='admitted'",
        )
        .bind(&id)
        .execute(&mut **tx)
        .await
        .map_err(unavailable)?;
        sqlx::query("UPDATE public.operation_claims SET state='abandoned' WHERE operation_id IN (SELECT id FROM public.operations WHERE task_id=$1) AND state='admitted'").bind(&id).execute(&mut **tx).await.map_err(unavailable)?;
    }
    let after = task(tx, &id).await?;
    let command_id = token();
    let next = cursor(tx, s).await?;
    sqlx::query("INSERT INTO public.task_commands(organisation_id,client_id,engagement_id,id,author_id,idempotency_key,kind,target_task_id,target_cycle_id,content,task_id,cycle_id,received_cursor,intent_revision,methodology_context) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)")
            .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id).bind(&command_id).bind(actor).bind(&c.key).bind(c.kind.as_str()).bind(&c.task_id).bind(&c.cycle_id).bind(&c.content).bind(&id).bind(&cycle).bind(next).bind(get::<i64>(&after,"intent_revision")?).bind(context).execute(&mut **tx).await.map_err(unavailable)?;
    if c.kind == CommandKind::Guide
        && let Some(context) = &c.context
    {
        crate::methodology::stage_context(tx, s, &id, &command_id, actor, context).await?;
    }
    if c.kind == CommandKind::Continue {
        crate::methodology::enroll_future(tx, s, &id).await?;
    }
    put_event(tx, s, &id, &cycle, Some(&command_id), "received", next).await?;
    if c.kind == CommandKind::Guide {
        crate::knowledge::project_guide(tx, s, actor, &command_id)
            .await
            .map_err(|_| TaskError::Unavailable)?;
    }
    wake(tx, s, &id, &get::<String>(&after, "accountable_actor")?).await?;
    Ok(CommandReceipt {
        command_id,
        task_id: id,
        cycle_id: cycle,
        event_cursor: next.to_string(),
        status: ReceiptStatus::Received,
    })
}

impl TaskCommands for TaskRepository {
    async fn admit(
        &self,
        actor: &str,
        s: &Scope,
        c: &TaskCommand,
    ) -> Result<CommandReceipt, TaskError> {
        if !c.is_valid() {
            return Err(TaskError::Invalid);
        }
        let mut tx = lock(&self.pool, actor, s).await?;
        if let Some(hash) = &self.session_hash {
            let current: bool = sqlx::query_scalar("SELECT public.evidence_session_locked($1,$2)")
                .bind(actor)
                .bind(hash)
                .fetch_one(&mut *tx)
                .await
                .map_err(unavailable)?;
            if !current {
                return Err(TaskError::Denied);
            }
        }
        let receipt = admit_in(&mut tx, actor, s, c).await?;
        admission_fence(&mut tx, actor, s, self.session_hash.as_deref()).await?;
        tx.commit().await.map_err(unavailable)?;
        Ok(receipt)
    }
    async fn get(&self, actor: &str, s: &Scope, id: &str) -> Result<TaskSnapshot, TaskError> {
        let mut tx = begin(&self.pool, actor, s).await?;
        let row = sqlx::query("SELECT *,(SELECT left(display_name,200) FROM public.identities WHERE id=tasks.accountable_actor) AS accountable_label FROM public.tasks WHERE id=$1")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(unavailable)?
            .ok_or(TaskError::Denied)?;
        let result = snapshot(&row)?;
        tx.commit().await.map_err(unavailable)?;
        Ok(result)
    }
    async fn list(
        &self,
        actor: &str,
        s: &Scope,
        after: Option<&str>,
    ) -> Result<TaskPage, TaskError> {
        if after.is_some_and(|id| !zobba_domain::identity::valid_scope_id(id)) {
            return Err(TaskError::Invalid);
        }
        let mut tx = begin(&self.pool, actor, s).await?;
        let mut rows = sqlx::query(
            "SELECT *,(SELECT left(display_name,200) FROM public.identities WHERE id=tasks.accountable_actor) AS accountable_label FROM public.tasks WHERE ($1::text IS NULL OR id>$1) ORDER BY id LIMIT 101",
        )
        .bind(after)
        .fetch_all(&mut *tx)
        .await
        .map_err(unavailable)?;
        let more = rows.len() > 100;
        rows.truncate(100);
        let tasks = rows.iter().map(snapshot).collect::<Result<Vec<_>, _>>()?;
        let next_cursor = if more {
            tasks.last().map(|task| task.id.clone())
        } else {
            None
        };
        tx.commit().await.map_err(unavailable)?;
        Ok(TaskPage { tasks, next_cursor })
    }
    async fn events(
        &self,
        actor: &str,
        s: &Scope,
        after: u64,
    ) -> Result<Vec<TaskEvent>, TaskError> {
        let after = i64::try_from(after).map_err(|_| TaskError::Invalid)?;
        let mut tx = begin(&self.pool, actor, s).await?;
        let rows=sqlx::query("SELECT cursor,task_id,cycle_id,command_id,kind FROM public.task_events WHERE cursor>$1 ORDER BY cursor LIMIT 100").bind(after).fetch_all(&mut *tx).await.map_err(unavailable)?;
        let result = rows
            .iter()
            .map(|row| {
                Ok(TaskEvent {
                    cursor: get::<i64>(row, "cursor")?.to_string(),
                    task_id: get(row, "task_id")?,
                    cycle_id: get(row, "cycle_id")?,
                    command_id: get(row, "command_id")?,
                    kind: get(row, "kind")?,
                })
            })
            .collect::<Result<_, TaskError>>()?;
        tx.commit().await.map_err(unavailable)?;
        Ok(result)
    }
}
async fn insert_cycle(tx: &mut Tx, s: &Scope, id: &str, cycle: &str) -> Result<(), TaskError> {
    sqlx::query("INSERT INTO public.task_cycles(organisation_id,client_id,engagement_id,task_id,id,status) VALUES($1,$2,$3,$4,$5,'active')").bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id).bind(id).bind(cycle).execute(&mut **tx).await.map_err(unavailable)?;
    Ok(())
}

/// Apply received commands in commit order at a work boundary. Create/Guide
/// replace the working brief and record the step boundary at which they took
/// effect; their immutable Received receipts are unchanged. With
/// `guidance_only`, a pending non-guidance command refuses: inside a running
/// cycle a control has already fenced continuation by execution epoch.
pub(crate) async fn apply_commands(
    tx: &mut Tx,
    s: &Scope,
    task_id: &str,
    guidance_only: bool,
) -> Result<usize, TaskError> {
    let row = task(tx, task_id).await?;
    let commands=sqlx::query("SELECT c.id,c.kind,c.content,c.cycle_id,c.intent_revision,c.received_cursor FROM public.task_commands c WHERE c.task_id=$1 AND c.received_cursor>$2 ORDER BY c.received_cursor LIMIT $3")
        .bind(task_id).bind(get::<i64>(&row,"applied_command_cursor")?).bind(COMMAND_BATCH).fetch_all(&mut **tx).await.map_err(unavailable)?;
    if guidance_only
        && commands.iter().any(|command| {
            !matches!(
                get::<String>(command, "kind").as_deref(),
                Ok("create" | "guide")
            )
        })
    {
        return Err(TaskError::Fenced);
    }
    for command in &commands {
        let kind = get::<String>(command, "kind")?;
        let cycle = get::<String>(command, "cycle_id")?;
        let id = get::<String>(command, "id")?;
        let guidance = matches!(kind.as_str(), "create" | "guide");
        let boundary: i64 = if guidance {
            sqlx::query("UPDATE public.tasks SET working_brief=$2,applied_intent=$3,revision=revision+1 WHERE id=$1")
                .bind(task_id).bind(get::<String>(command,"content")?).bind(get::<i64>(command,"intent_revision")?).execute(&mut **tx).await.map_err(unavailable)?;
            sqlx::query_scalar(
                "SELECT count(*) FROM public.task_steps WHERE task_id=$1 AND cycle_id=$2",
            )
            .bind(task_id)
            .bind(&cycle)
            .fetch_one(&mut **tx)
            .await
            .map_err(unavailable)?
        } else {
            0
        };
        let applied = event(tx, s, task_id, &cycle, Some(&id), "applied").await?;
        if guidance {
            sqlx::query("INSERT INTO public.task_guidance_applications(organisation_id,client_id,engagement_id,command_id,task_id,cycle_id,boundary_ordinal,applied_cursor) VALUES($1,$2,$3,$4,$5,$6,$7,$8)")
                .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id).bind(&id).bind(task_id).bind(&cycle).bind(boundary as i32).bind(applied).execute(&mut **tx).await.map_err(unavailable)?;
        }
    }
    if let Some(last) = commands.last() {
        sqlx::query("UPDATE public.tasks SET applied_command_cursor=$2 WHERE id=$1")
            .bind(task_id)
            .bind(get::<i64>(last, "received_cursor")?)
            .execute(&mut **tx)
            .await
            .map_err(unavailable)?;
    }
    Ok(commands.len())
}

impl TaskRepository {
    /// Routes contain no work content and grant no authority. Re-derive their
    /// recorded actor/scope in this fresh transaction before touching the Task.
    pub async fn coordinate(
        &self,
        route: &WakeupRoute,
        worker: &str,
    ) -> Result<Decision, TaskError> {
        let mut tx = lock(&self.pool, &route.actor_id, &route.scope).await?;
        let row = task(&mut tx, &route.task_id).await?;
        let routed:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM public.task_wakeups WHERE id=$1 AND task_id=$2 AND actor_id=$3)")
            .bind(&route.id).bind(&route.task_id).bind(&route.actor_id).fetch_one(&mut *tx).await.map_err(unavailable)?;
        if !routed || get::<String>(&row, "accountable_actor")? != route.actor_id {
            return Err(TaskError::Denied);
        }
        let old_owner = get::<Option<String>>(&row, "owner_id")?;
        let live = get::<Option<bool>>(&row, "owner_live")?.unwrap_or(false);
        if live && old_owner.as_deref() != Some(worker) {
            return Ok(Decision::Idle);
        }
        let changed = !live || old_owner.as_deref() != Some(worker);
        sqlx::query("UPDATE public.tasks SET owner_id=$2,owner_until=clock_timestamp()+interval '5 seconds',owner_epoch=owner_epoch+$3 WHERE id=$1")
            .bind(&route.task_id).bind(worker).bind(i64::from(changed)).execute(&mut *tx).await.map_err(unavailable)?;
        let mut now = snapshot(&row)?;
        let was_reconciling = matches!(
            now.cessation,
            Cessation::Pending | Cessation::ReconciliationRequired
        );
        // Applying retained text is an ordinary work boundary, not AI understanding.
        let commands = apply_commands(&mut tx, &route.scope, &route.task_id, false).await?;
        let consumed=sqlx::query("SELECT c.*,o.outcome FROM public.task_claims c LEFT JOIN public.task_observations o ON o.claim_id=c.id WHERE c.task_id=$1 AND c.state='consumed' ORDER BY c.id LIMIT 1")
            .bind(&route.task_id).fetch_optional(&mut *tx).await.map_err(unavailable)?;
        let mut inert_observed = false;
        if let Some(claim) = consumed {
            let work_claim: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM public.task_work_claims WHERE claim_id=$1)",
            )
            .bind(get::<String>(&claim, "id")?)
            .fetch_one(&mut *tx)
            .await
            .map_err(unavailable)?;
            if work_claim && get::<Option<String>>(&claim, "outcome")?.is_none() {
                // The work loop lived in the lost producer. Its only effects are
                // durable invocation facts (recovered by key, never resent) and
                // operations (reconciled by the external check below), so a
                // fresh owner may take the claim over instead of guessing.
                sqlx::query("UPDATE public.task_claims SET state='observed' WHERE id=$1")
                    .bind(get::<String>(&claim, "id")?)
                    .execute(&mut *tx)
                    .await
                    .map_err(unavailable)?;
                event(
                    &mut tx,
                    &route.scope,
                    &route.task_id,
                    &get::<String>(&claim, "cycle_id")?,
                    None,
                    "observed",
                )
                .await?;
                let (state, cessation) =
                    if matches!(now.state, TaskState::Paused | TaskState::Stopped) {
                        (now.state.as_str(), "confirmed")
                    } else {
                        ("ready", "none")
                    };
                sqlx::query(
                    "UPDATE public.tasks SET state=$2,cessation=$3,revision=revision+1 WHERE id=$1",
                )
                .bind(&route.task_id)
                .bind(state)
                .bind(cessation)
                .execute(&mut *tx)
                .await
                .map_err(unavailable)?;
                now.state = TaskState::parse(state).ok_or(TaskError::Unavailable)?;
                now.cessation = Cessation::parse(cessation).ok_or(TaskError::Unavailable)?;
            } else if let Some(outcome) = get::<Option<String>>(&claim, "outcome")? {
                inert_observed = true;
                sqlx::query("UPDATE public.task_claims SET state='observed' WHERE id=$1")
                    .bind(get::<String>(&claim, "id")?)
                    .execute(&mut *tx)
                    .await
                    .map_err(unavailable)?;
                event(
                    &mut tx,
                    &route.scope,
                    &route.task_id,
                    &get::<String>(&claim, "cycle_id")?,
                    None,
                    "observed",
                )
                .await?;
                // A work loop applies guidance at its own step boundaries, so it
                // has finished the current brief when no received guidance
                // remains unapplied. An inert child ran under its claim intent.
                let latest = task(&mut tx, &route.task_id).await?;
                let intent_done = if work_claim {
                    get::<i64>(&latest, "applied_intent")?
                        == get::<i64>(&latest, "intent_revision")?
                } else {
                    get::<i64>(&claim, "intent_revision")? as u64 == now.intent_revision
                };
                let same_basis = intent_done
                    && get::<i64>(&claim, "execution_epoch")? as u64 == now.execution_epoch
                    && get::<String>(&claim, "cycle_id")? == now.cycle_id;
                let (state, cessation) =
                    if matches!(now.state, TaskState::Paused | TaskState::Stopped) {
                        (now.state.as_str(), "confirmed")
                    } else if !same_basis
                        && matches!(
                            outcome.as_str(),
                            "completed" | "cancelled" | "exited" | "not_started"
                        )
                    {
                        ("ready", "none")
                    } else {
                        ("waiting", "confirmed")
                    };
                sqlx::query(
                    "UPDATE public.tasks SET state=$2,cessation=$3,revision=revision+1 WHERE id=$1",
                )
                .bind(&route.task_id)
                .bind(state)
                .bind(cessation)
                .execute(&mut *tx)
                .await
                .map_err(unavailable)?;
                now.state = TaskState::parse(state).ok_or(TaskError::Unavailable)?;
                now.cessation = Cessation::parse(cessation).ok_or(TaskError::Unavailable)?;
            } else {
                // The coordinator never calls this while tracking a live child;
                // current() alone renews that child's lease. Re-entry without an
                // observation means its exact process proof was lost, even under
                // the same owner after a local runner failure.
                {
                    let state = if matches!(now.state, TaskState::Paused | TaskState::Stopped) {
                        now.state.as_str()
                    } else {
                        "waiting"
                    };
                    if now.cessation != Cessation::ReconciliationRequired {
                        sqlx::query("UPDATE public.tasks SET state=$2,cessation='reconciliation_required',revision=revision+1 WHERE id=$1").bind(&route.task_id).bind(state).execute(&mut *tx).await.map_err(unavailable)?;
                        event(
                            &mut tx,
                            &route.scope,
                            &route.task_id,
                            &now.cycle_id,
                            None,
                            "waiting",
                        )
                        .await?;
                    }
                }
                tx.commit().await.map_err(unavailable)?;
                return Ok(Decision::Waiting);
            }
        }
        // An inert child receipt proves only that child ended. External claims
        // that crossed consumption remain possibly dispatched until source facts
        // establish completion or authoritative absence under the source contract.
        let external: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM public.operations o JOIN public.operation_claims c ON c.operation_id=o.id WHERE o.task_id=$1 AND c.state='consumed' AND NOT EXISTS(SELECT 1 FROM public.operation_receipts r WHERE r.attempt_id=c.attempt_id AND r.outcome IN ('completed','absent')))")
            .bind(&route.task_id).fetch_one(&mut *tx).await.map_err(unavailable)?;
        if external {
            let state = if matches!(now.state, TaskState::Paused | TaskState::Stopped) {
                now.state.as_str()
            } else {
                "waiting"
            };
            let changed = sqlx::query("UPDATE public.tasks SET state=$2,cessation='reconciliation_required',revision=revision+1 WHERE id=$1 AND (state<>$2 OR cessation<>'reconciliation_required')")
                .bind(&route.task_id).bind(state).execute(&mut *tx).await.map_err(unavailable)?;
            if changed.rows_affected() != 0 {
                event(
                    &mut tx,
                    &route.scope,
                    &route.task_id,
                    &now.cycle_id,
                    None,
                    "waiting",
                )
                .await?;
            }
            tx.commit().await.map_err(unavailable)?;
            return Ok(Decision::Waiting);
        }
        let reconciling = was_reconciling
            || matches!(
                now.cessation,
                Cessation::Pending | Cessation::ReconciliationRequired
            );
        let retry = now.state == TaskState::Waiting
            && (reconciling || inert_observed)
            && retryable_external_absence(&mut tx, route, &now).await?;
        if reconciling || retry {
            // Any unresolved inert claim returned above; all remaining source
            // facts are terminal. Only this freshly authorized owner incorporates
            // those facts, including receipt-only facts from a revoked producer.
            // A stopped/paused Task never resumes here. An active Task may obtain
            // a fresh producer only for a latest source-confirmed absence under
            // its unchanged cycle/intent/execution. Consumption still rechecks
            // current policy and exact operation authority independently.
            let state = if retry { "ready" } else { now.state.as_str() };
            let cessation = if retry || matches!(now.state, TaskState::Ready | TaskState::Running) {
                "none"
            } else {
                "confirmed"
            };
            // The inert receipt may already have incorporated this exact state
            // above. Do not create a second revision/event for that same fact.
            let changed = sqlx::query(
                "UPDATE public.tasks SET state=$2,cessation=$3,revision=revision+1 WHERE id=$1 AND (state<>$2 OR cessation<>$3)",
            )
            .bind(&route.task_id)
            .bind(state)
            .bind(cessation)
            .execute(&mut *tx)
            .await
            .map_err(unavailable)?;
            now.state = TaskState::parse(state).ok_or(TaskError::Unavailable)?;
            now.cessation = Cessation::parse(cessation).ok_or(TaskError::Unavailable)?;
            if changed.rows_affected() != 0 {
                event(
                    &mut tx,
                    &route.scope,
                    &route.task_id,
                    &now.cycle_id,
                    None,
                    "observed",
                )
                .await?;
            }
        }
        // A configuration change is applied only after all consumed inert and
        // external effects above have their original facts reconciled. A staged
        // change fences unused work without cancelling this receipt authority.
        if crate::methodology::apply_pending(&mut tx, &route.scope, &route.task_id).await? {
            now = snapshot(&task(&mut tx, &route.task_id).await?)?;
            event(
                &mut tx,
                &route.scope,
                &route.task_id,
                &now.cycle_id,
                None,
                "applied",
            )
            .await?;
        }
        let row = task(&mut tx, &route.task_id).await?;
        if commands == COMMAND_BATCH as usize
            || get::<i64>(&row, "applied_intent")? != get::<i64>(&row, "intent_revision")?
        {
            tx.commit().await.map_err(unavailable)?;
            return Ok(Decision::Idle);
        }
        if !matches!(now.state, TaskState::Ready | TaskState::Running) {
            let activation =
                crate::methodology::pending_activation(&mut tx, &route.task_id).await?;
            sqlx::query("UPDATE public.task_wakeups SET pending=($2::bigint IS NOT NULL),available_at=COALESCE(to_timestamp($2::bigint),available_at) WHERE id=$1")
                .bind(&route.id)
                .bind(activation)
                .execute(&mut *tx)
                .await
                .map_err(unavailable)?;
            tx.commit().await.map_err(unavailable)?;
            return Ok(Decision::Idle);
        }
        if !crate::methodology::new_use_allowed(&mut tx, &route.task_id).await? {
            sqlx::query("UPDATE public.tasks SET state='waiting',cessation='confirmed',revision=revision+1 WHERE id=$1")
                .bind(&route.task_id)
                .execute(&mut *tx)
                .await
                .map_err(unavailable)?;
            event(
                &mut tx,
                &route.scope,
                &route.task_id,
                &now.cycle_id,
                None,
                "waiting",
            )
            .await?;
            tx.commit().await.map_err(unavailable)?;
            return Ok(Decision::Waiting);
        }
        // Unconsumed abandoned owner/intent claims are safe to replace; consumed
        // claims took the possible-dispatch cutoff and were handled above.
        sqlx::query(
            "UPDATE public.task_claims SET state='abandoned' WHERE task_id=$1 AND state='admitted'",
        )
        .bind(&route.task_id)
        .execute(&mut *tx)
        .await
        .map_err(unavailable)?;
        let basis = ClaimBasis {
            actor_id: route.actor_id.clone(),
            scope: route.scope.clone(),
            task_id: route.task_id.clone(),
            cycle_id: now.cycle_id,
            claim_id: token(),
            worker_id: worker.into(),
            process_instance: token(),
            owner_epoch: get(&row, "owner_epoch")?,
            execution_epoch: get(&row, "execution_epoch")?,
            intent_revision: get(&row, "intent_revision")?,
        };
        sqlx::query("INSERT INTO public.task_claims(organisation_id,client_id,engagement_id,task_id,cycle_id,id,actor_id,worker_id,process_instance,owner_epoch,execution_epoch,intent_revision,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'admitted')")
            .bind(&basis.scope.organisation_id).bind(&basis.scope.client_id).bind(&basis.scope.engagement_id).bind(&basis.task_id).bind(&basis.cycle_id).bind(&basis.claim_id).bind(&basis.actor_id).bind(&basis.worker_id).bind(&basis.process_instance).bind(basis.owner_epoch).bind(basis.execution_epoch).bind(basis.intent_revision).execute(&mut *tx).await.map_err(unavailable)?;
        event(
            &mut tx,
            &route.scope,
            &route.task_id,
            &basis.cycle_id,
            None,
            "claimed",
        )
        .await?;
        tx.commit().await.map_err(unavailable)?;
        Ok(Decision::Execute(Box::new(basis)))
    }
    pub async fn consume(&self, basis: &ClaimBasis) -> Result<ConsumedAttempt, TaskError> {
        let mut tx = lock(&self.pool, &basis.actor_id, &basis.scope).await?;
        let row = task(&mut tx, &basis.task_id).await?;
        if !admission_current(&row, basis)?
            || !crate::methodology::new_use_allowed(&mut tx, &basis.task_id).await?
        {
            return Err(TaskError::Fenced);
        }
        let claim = sqlx::query(
            "SELECT * FROM public.task_claims WHERE id=$1 AND state='admitted' FOR UPDATE",
        )
        .bind(&basis.claim_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(unavailable)?
        .ok_or(TaskError::Fenced)?;
        if !claim_matches(&claim, basis)? {
            return Err(TaskError::Fenced);
        }
        let capability = token();
        sqlx::query("UPDATE public.task_claims SET state='consumed' WHERE id=$1")
            .bind(&basis.claim_id)
            .execute(&mut *tx)
            .await
            .map_err(unavailable)?;
        sqlx::query("INSERT INTO public.task_receipt_slots(organisation_id,client_id,engagement_id,claim_id,process_instance,capability_hash) VALUES($1,$2,$3,$4,$5,$6)")
            .bind(&basis.scope.organisation_id).bind(&basis.scope.client_id).bind(&basis.scope.engagement_id).bind(&basis.claim_id).bind(&basis.process_instance).bind(digest(&capability)).execute(&mut *tx).await.map_err(unavailable)?;
        sqlx::query("UPDATE public.tasks SET state='running',cessation='none',revision=revision+1 WHERE id=$1").bind(&basis.task_id).execute(&mut *tx).await.map_err(unavailable)?;
        event(
            &mut tx,
            &basis.scope,
            &basis.task_id,
            &basis.cycle_id,
            None,
            "consumed",
        )
        .await?;
        // Deferred effects must complete before the final fresh cutoff check,
        // exactly as for operation dispatch. A newly due methodology change
        // rolls back the consumed claim, receipt capability and event together.
        sqlx::query("SET CONSTRAINTS ALL IMMEDIATE")
            .execute(&mut *tx)
            .await
            .map_err(unavailable)?;
        let current = task(&mut tx, &basis.task_id).await?;
        if !admission_current(&current, basis)?
            || !crate::methodology::new_use_allowed(&mut tx, &basis.task_id).await?
        {
            return Err(TaskError::Fenced);
        }
        tx.commit().await.map_err(unavailable)?;
        Ok(ConsumedAttempt {
            basis: basis.clone(),
            receipt_capability: capability,
        })
    }
    pub async fn current(&self, basis: &ClaimBasis) -> Result<bool, TaskError> {
        let mut tx = lock(&self.pool, &basis.actor_id, &basis.scope).await?;
        let row = task(&mut tx, &basis.task_id).await?;
        if !continuation_current(&row, basis)? {
            return Ok(false);
        }
        let claim =
            sqlx::query("SELECT * FROM public.task_claims WHERE id=$1 AND state='consumed'")
                .bind(&basis.claim_id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(unavailable)?;
        if !claim
            .as_ref()
            .map(|row| claim_matches(row, basis))
            .transpose()?
            .unwrap_or(false)
        {
            return Ok(false);
        }
        sqlx::query("UPDATE public.tasks SET owner_until=clock_timestamp()+interval '5 seconds' WHERE id=$1").bind(&basis.task_id).execute(&mut *tx).await.map_err(unavailable)?;
        tx.commit().await.map_err(unavailable)?;
        Ok(true)
    }
    /// Exact-attempt immutable observation. No actor context, Task projection,
    /// transitions, lease or new execution is available in this transaction.
    pub async fn observe(
        &self,
        attempt: &ConsumedAttempt,
        outcome: Observation,
    ) -> Result<(), TaskError> {
        let b = &attempt.basis;
        if attempt.receipt_capability.len() != 64 || !b.scope.is_valid() {
            return Err(TaskError::Denied);
        }
        let mut tx = scope::begin_actor(&self.pool, "receipt-context")
            .await
            .map_err(|_| TaskError::Unavailable)?;
        sqlx::query("SELECT set_config('zobba.actor_id','',true),set_config('zobba.receipt_claim',$1,true),set_config('zobba.receipt_hash',$2,true),set_config('zobba.receipt_org',$3,true),set_config('zobba.receipt_client',$4,true),set_config('zobba.receipt_engagement',$5,true)")
            .bind(&b.claim_id).bind(digest(&attempt.receipt_capability)).bind(&b.scope.organisation_id).bind(&b.scope.client_id).bind(&b.scope.engagement_id).execute(&mut *tx).await.map_err(unavailable)?;
        let allowed:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM public.task_receipt_slots WHERE claim_id=$1 AND process_instance=$2)").bind(&b.claim_id).bind(&b.process_instance).fetch_one(&mut *tx).await.map_err(unavailable)?;
        if !allowed {
            return Err(TaskError::Denied);
        }
        sqlx::query("INSERT INTO public.task_observations(organisation_id,client_id,engagement_id,claim_id,process_instance,outcome) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(claim_id) DO NOTHING")
            .bind(&b.scope.organisation_id).bind(&b.scope.client_id).bind(&b.scope.engagement_id).bind(&b.claim_id).bind(&b.process_instance).bind(outcome.as_str()).execute(&mut *tx).await.map_err(unavailable)?;
        let existing: String =
            sqlx::query_scalar("SELECT outcome FROM public.task_observations WHERE claim_id=$1")
                .bind(&b.claim_id)
                .fetch_one(&mut *tx)
                .await
                .map_err(unavailable)?;
        if existing != outcome.as_str() {
            return Err(TaskError::Conflict);
        }
        tx.commit().await.map_err(unavailable)
    }
    pub async fn reconcile(&self, route: &WakeupRoute, worker: &str) -> Result<(), TaskError> {
        // coordinate may create an unconsumed replacement claim after a guidance
        // cancellation. Its next bounded delivery safely replaces that claim.
        self.coordinate(route, worker).await.map(|_| ())
    }
}
/// Return only a same-meaning retry opportunity, never permission to dispatch.
/// The operation store caps each Task at 1,000 logical operations. Decode its
/// strict persisted basis rather than interpreting untrusted request labels.
async fn retryable_external_absence(
    tx: &mut Tx,
    route: &WakeupRoute,
    now: &TaskSnapshot,
) -> Result<bool, TaskError> {
    let rows = sqlx::query("SELECT a.basis FROM public.operation_attempts a JOIN public.operations o ON o.id=a.operation_id WHERE o.task_id=$1 AND o.cycle_id=$2 AND NOT EXISTS(SELECT 1 FROM public.operation_attempts later WHERE later.operation_id=a.operation_id AND later.attempt_number>a.attempt_number) AND EXISTS(SELECT 1 FROM public.operation_receipts r WHERE r.attempt_id=a.id AND r.outcome='absent') LIMIT 1001")
        .bind(&route.task_id)
        .bind(&now.cycle_id)
        .fetch_all(&mut **tx)
        .await
        .map_err(unavailable)?;
    if rows.len() > 1000 {
        return Err(TaskError::Unavailable);
    }
    for row in rows {
        let basis: zobba_application::operation::wire::StoredBasis =
            serde_json::from_str(&get::<String>(&row, "basis")?)
                .map_err(|_| TaskError::Unavailable)?;
        let b = basis.0;
        if b.actor_id == route.actor_id
            && b.scope == route.scope
            && b.task_id == now.id
            && b.cycle_id == now.cycle_id
            && b.intent_revision == now.intent_revision as i64
            && b.execution_epoch == now.execution_epoch as i64
        {
            return Ok(true);
        }
    }
    Ok(false)
}
/// Ownership and execution fences only. A changed intent (accepted guidance not
/// yet applied) leaves in-flight work current: guidance never cancels work.
/// Only Pause/Stop (execution epoch), cycle change or ownership loss do.
pub(crate) fn continuation_current(row: &PgRow, b: &ClaimBasis) -> Result<bool, TaskError> {
    Ok(get::<String>(row, "accountable_actor")? == b.actor_id
        && get::<Option<String>>(row, "owner_id")?.as_deref() == Some(b.worker_id.as_str())
        && get::<Option<bool>>(row, "owner_live")?.unwrap_or(false)
        && get::<i64>(row, "owner_epoch")? == b.owner_epoch
        && get::<i64>(row, "execution_epoch")? == b.execution_epoch
        && get::<String>(row, "cycle_id")? == b.cycle_id
        && matches!(get::<String>(row, "state")?.as_str(), "ready" | "running"))
}
/// Continuation plus the producing intent: received guidance must be applied
/// and equal the basis before any new admission, consumption or disclosure.
pub(crate) fn admission_current(row: &PgRow, b: &ClaimBasis) -> Result<bool, TaskError> {
    Ok(continuation_current(row, b)?
        && get::<i64>(row, "intent_revision")? == b.intent_revision
        && get::<i64>(row, "applied_intent")? == b.intent_revision)
}
/// The exact claim producer. Its recorded intent is the historical claim-time
/// intent; current intent is a separate admission fence above.
pub(crate) fn claim_matches(row: &PgRow, b: &ClaimBasis) -> Result<bool, TaskError> {
    Ok(get::<String>(row, "actor_id")? == b.actor_id
        && get::<String>(row, "task_id")? == b.task_id
        && get::<String>(row, "cycle_id")? == b.cycle_id
        && get::<String>(row, "worker_id")? == b.worker_id
        && get::<String>(row, "process_instance")? == b.process_instance
        && get::<i64>(row, "owner_epoch")? == b.owner_epoch
        && get::<i64>(row, "execution_epoch")? == b.execution_epoch)
}

impl TaskExecution for TaskRepository {
    async fn coordinate(&self, route: &WakeupRoute, worker: &str) -> Result<Decision, TaskError> {
        TaskRepository::coordinate(self, route, worker).await
    }
    async fn consume(&self, basis: &ClaimBasis) -> Result<ConsumedAttempt, TaskError> {
        TaskRepository::consume(self, basis).await
    }
    async fn current(&self, basis: &ClaimBasis) -> Result<bool, TaskError> {
        TaskRepository::current(self, basis).await
    }
    async fn observe(
        &self,
        attempt: &ConsumedAttempt,
        outcome: Observation,
    ) -> Result<(), TaskError> {
        TaskRepository::observe(self, attempt, outcome).await
    }
    async fn reconcile(&self, route: &WakeupRoute, worker: &str) -> Result<(), TaskError> {
        TaskRepository::reconcile(self, route, worker).await
    }
}
