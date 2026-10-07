//! Durable work-cycle facts, step-boundary guidance and deterministic routing.
//! Every transaction is short and shares the organisation -> engagement -> Task
//! lock order with admission and Permissions consumption.
use crate::task::{
    TaskRepository, Tx, admission_fence, admit_in, apply_commands, begin, claim_matches,
    continuation_current, event, get, lock, task, token, unavailable,
};
use sqlx::postgres::PgRow;
use zobba_application::{
    task::TaskError,
    work::{WorkBoundary, WorkSteps},
};
use zobba_domain::{
    identity::{Scope, valid_scope_id},
    permissions::SourceFact,
    task::{
        COMMAND_CONTENT_MAX, ClaimBasis, CommandKind, CommandReceipt, ReceiptStatus, TaskCommand,
        TaskState,
    },
    work::{
        BRIEF_PAGE_SIZE, BriefRevision, Direction, MAX_ROUTING_CANDIDATES, NextAction, RoutedGuide,
        Routing, RoutingCandidate, RoutingQuestion, StepKind, StepStatus, TaskStep, TaskWork,
        answer_selection, route_direction, routed_guide_key, summarise,
    },
};

const STEP_PAGE_SIZE: i64 = 50;
const QUESTION_PAGE_SIZE: i64 = 20;

fn step(row: &PgRow) -> Result<TaskStep, TaskError> {
    let step = TaskStep {
        task_id: get(row, "task_id")?,
        cycle_id: get(row, "cycle_id")?,
        ordinal: get::<i32>(row, "ordinal")? as u32,
        kind: StepKind::parse(&get::<String>(row, "kind")?).ok_or(TaskError::Unavailable)?,
        intent_revision: get::<i64>(row, "intent_revision")? as u64,
        execution_epoch: get::<i64>(row, "execution_epoch")? as u64,
        invocation_id: get(row, "invocation_id")?,
        call_id: get(row, "call_id")?,
        operation_id: get(row, "operation_id")?,
        attempt_id: get(row, "attempt_id")?,
        fact: get::<Option<String>>(row, "fact")?
            .map(|fact| SourceFact::parse(&fact).ok_or(TaskError::Unavailable))
            .transpose()?,
        status: StepStatus::parse(&get::<String>(row, "status")?).ok_or(TaskError::Unavailable)?,
        next_action: get::<Option<String>>(row, "next_action")?
            .map(|action| NextAction::parse(&action).ok_or(TaskError::Unavailable))
            .transpose()?,
        current_work: get(row, "current_work")?,
    };
    if step.is_valid() {
        Ok(step)
    } else {
        Err(TaskError::Unavailable)
    }
}

async fn cycle_steps(
    tx: &mut Tx,
    task_id: &str,
    cycle_id: &str,
) -> Result<Vec<TaskStep>, TaskError> {
    sqlx::query("SELECT * FROM public.task_steps WHERE task_id=$1 AND cycle_id=$2 ORDER BY ordinal LIMIT 4096")
        .bind(task_id)
        .bind(cycle_id)
        .fetch_all(&mut **tx)
        .await
        .map_err(unavailable)?
        .iter()
        .map(step)
        .collect()
}

/// The exact consumed, unobserved claim of this producer.
async fn producer(tx: &mut Tx, b: &ClaimBasis) -> Result<(), TaskError> {
    let claim = sqlx::query("SELECT * FROM public.task_claims WHERE id=$1 AND state='consumed' AND NOT EXISTS(SELECT 1 FROM public.task_observations o WHERE o.claim_id=task_claims.id)")
        .bind(&b.claim_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(unavailable)?
        .ok_or(TaskError::Fenced)?;
    if claim_matches(&claim, b)? {
        Ok(())
    } else {
        Err(TaskError::Fenced)
    }
}

fn valid_content(value: &str) -> bool {
    !value.trim().is_empty()
        && value.len() <= COMMAND_CONTENT_MAX
        && !value
            .chars()
            .any(|ch| ch.is_control() && !matches!(ch, '\n' | '\r' | '\t'))
}

fn candidates(value: serde_json::Value) -> Result<Vec<RoutingCandidate>, TaskError> {
    let rows = value.as_array().ok_or(TaskError::Unavailable)?;
    rows.iter()
        .map(|row| {
            let field = |name: &str| {
                row.get(name)
                    .and_then(|v| v.as_str())
                    .map(str::to_owned)
                    .ok_or(TaskError::Unavailable)
            };
            Ok(RoutingCandidate {
                task_id: field("task_id")?,
                cycle_id: field("cycle_id")?,
                objective: field("objective")?,
            })
        })
        .collect()
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

impl TaskRepository {
    async fn check_session(&self, tx: &mut Tx, actor: &str) -> Result<(), TaskError> {
        if let Some(hash) = self.session() {
            let current: bool = sqlx::query_scalar("SELECT public.evidence_session_locked($1,$2)")
                .bind(actor)
                .bind(hash)
                .fetch_one(&mut **tx)
                .await
                .map_err(unavailable)?;
            if !current {
                return Err(TaskError::Denied);
            }
        }
        Ok(())
    }

    async fn question(tx: &mut Tx, actor: &str, row: &PgRow) -> Result<RoutingQuestion, TaskError> {
        let key: String = get(row, "idempotency_key")?;
        let selected: Option<serde_json::Value> = get(row, "selected")?;
        let answer = match selected {
            None => None,
            Some(selected) => {
                let mut guides = Vec::new();
                for task_id in selected.as_array().ok_or(TaskError::Unavailable)? {
                    let task_id = task_id.as_str().ok_or(TaskError::Unavailable)?;
                    let command = sqlx::query("SELECT * FROM public.task_commands WHERE author_id=$1 AND idempotency_key=$2")
                        .bind(actor)
                        .bind(routed_guide_key(&key, task_id))
                        .fetch_one(&mut **tx)
                        .await
                        .map_err(unavailable)?;
                    let receipt = receipt(&command)?;
                    guides.push(RoutedGuide {
                        task_id: receipt.task_id,
                        cycle_id: receipt.cycle_id,
                        command_id: receipt.command_id,
                        event_cursor: receipt.event_cursor,
                    });
                }
                Some(guides)
            }
        };
        Ok(RoutingQuestion {
            id: get(row, "id")?,
            key,
            content: get(row, "content")?,
            candidates: candidates(get(row, "candidates")?)?,
            answer,
        })
    }

    /// Admit a direction without a target. Exactly one non-stopped Task receives
    /// it as Guidance; two or more produce one durable targeting question; no
    /// model is consulted. An identical retry returns the original outcome.
    pub async fn direct(
        &self,
        actor: &str,
        s: &Scope,
        key: &str,
        content: &str,
    ) -> Result<Direction, TaskError> {
        if !valid_scope_id(key) || !valid_content(content) {
            return Err(TaskError::Invalid);
        }
        let mut tx = lock(self.pool(), actor, s).await?;
        self.check_session(&mut tx, actor).await?;
        if let Some(existing) = sqlx::query(
            "SELECT * FROM public.task_commands WHERE author_id=$1 AND idempotency_key=$2",
        )
        .bind(actor)
        .bind(key)
        .fetch_optional(&mut *tx)
        .await
        .map_err(unavailable)?
        {
            if get::<String>(&existing, "kind")? != "guide"
                || get::<Option<String>>(&existing, "content")?.as_deref() != Some(content)
            {
                return Err(TaskError::Conflict);
            }
            let original = receipt(&existing)?;
            admission_fence(&mut tx, actor, s, self.session()).await?;
            tx.commit().await.map_err(unavailable)?;
            return Ok(Direction::Routed(original));
        }
        if let Some(existing) = sqlx::query("SELECT q.*,a.selected FROM public.task_routing_questions q LEFT JOIN public.task_routing_answers a ON a.question_id=q.id WHERE q.author_id=$1 AND q.idempotency_key=$2")
            .bind(actor)
            .bind(key)
            .fetch_optional(&mut *tx)
            .await
            .map_err(unavailable)?
        {
            if get::<String>(&existing, "content")? != content {
                return Err(TaskError::Conflict);
            }
            let question = Self::question(&mut tx, actor, &existing).await?;
            admission_fence(&mut tx, actor, s, self.session()).await?;
            tx.commit().await.map_err(unavailable)?;
            return Ok(Direction::Asked(question));
        }
        let rows = sqlx::query("SELECT id,cycle_id,objective FROM public.tasks WHERE state <> 'stopped' ORDER BY id COLLATE \"C\" LIMIT $1")
            .bind(MAX_ROUTING_CANDIDATES as i64 + 1)
            .fetch_all(&mut *tx)
            .await
            .map_err(unavailable)?;
        if rows.len() > MAX_ROUTING_CANDIDATES {
            return Err(TaskError::Capacity);
        }
        let found = rows
            .iter()
            .map(|row| {
                Ok(RoutingCandidate {
                    task_id: get(row, "id")?,
                    cycle_id: get(row, "cycle_id")?,
                    objective: get(row, "objective")?,
                })
            })
            .collect::<Result<Vec<_>, TaskError>>()?;
        let result = match route_direction(found) {
            Routing::NoCandidate => return Err(TaskError::Conflict),
            Routing::Target(candidate) => Direction::Routed(
                admit_in(
                    &mut tx,
                    actor,
                    s,
                    &TaskCommand {
                        key: key.into(),
                        kind: CommandKind::Guide,
                        task_id: Some(candidate.task_id),
                        cycle_id: Some(candidate.cycle_id),
                        content: Some(content.into()),
                        context: None,
                    },
                )
                .await?,
            ),
            Routing::Ask(candidates) => {
                let id = token();
                let encoded = serde_json::Value::Array(
                    candidates
                        .iter()
                        .map(|c| {
                            serde_json::json!({"task_id":c.task_id,"cycle_id":c.cycle_id,"objective":c.objective})
                        })
                        .collect(),
                );
                sqlx::query("INSERT INTO public.task_routing_questions(organisation_id,client_id,engagement_id,id,author_id,idempotency_key,content,candidates) VALUES($1,$2,$3,$4,$5,$6,$7,$8)")
                    .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id).bind(&id).bind(actor).bind(key).bind(content).bind(encoded)
                    .execute(&mut *tx).await.map_err(unavailable)?;
                Direction::Asked(RoutingQuestion {
                    id,
                    key: key.into(),
                    content: content.into(),
                    candidates,
                    answer: None,
                })
            }
        };
        admission_fence(&mut tx, actor, s, self.session()).await?;
        tx.commit().await.map_err(unavailable)?;
        Ok(result)
    }

    /// Answer a targeting question with one or more of its own candidates. Each
    /// target receives one Guide under a derived key, so a retry creates no
    /// duplicates. Stale (stopped or newer-cycle) and foreign Tasks refuse.
    pub async fn answer(
        &self,
        actor: &str,
        s: &Scope,
        question_id: &str,
        selected: &[String],
    ) -> Result<RoutingQuestion, TaskError> {
        if !valid_scope_id(question_id) || selected.iter().any(|id| !valid_scope_id(id)) {
            return Err(TaskError::Invalid);
        }
        let mut tx = lock(self.pool(), actor, s).await?;
        self.check_session(&mut tx, actor).await?;
        let row = sqlx::query("SELECT q.*,a.selected FROM public.task_routing_questions q LEFT JOIN public.task_routing_answers a ON a.question_id=q.id WHERE q.id=$1 AND q.author_id=$2")
            .bind(question_id)
            .bind(actor)
            .fetch_optional(&mut *tx)
            .await
            .map_err(unavailable)?
            .ok_or(TaskError::Denied)?;
        let question = Self::question(&mut tx, actor, &row).await?;
        let chosen = answer_selection(&question, selected).ok_or(TaskError::Conflict)?;
        if let Some(previous) = &question.answer {
            let mut before: Vec<String> = previous.iter().map(|g| g.task_id.clone()).collect();
            before.sort();
            if before != chosen {
                return Err(TaskError::Conflict);
            }
            admission_fence(&mut tx, actor, s, self.session()).await?;
            tx.commit().await.map_err(unavailable)?;
            return Ok(question);
        }
        let mut guides = Vec::new();
        for task_id in &chosen {
            let candidate = question
                .candidates
                .iter()
                .find(|c| &c.task_id == task_id)
                .ok_or(TaskError::Conflict)?;
            let current = sqlx::query("SELECT state,cycle_id FROM public.tasks WHERE id=$1")
                .bind(task_id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(unavailable)?
                .ok_or(TaskError::Conflict)?;
            if get::<String>(&current, "state")? == TaskState::Stopped.as_str()
                || get::<String>(&current, "cycle_id")? != candidate.cycle_id
            {
                return Err(TaskError::Conflict);
            }
            let receipt = admit_in(
                &mut tx,
                actor,
                s,
                &TaskCommand {
                    key: routed_guide_key(&question.key, task_id),
                    kind: CommandKind::Guide,
                    task_id: Some(task_id.clone()),
                    cycle_id: Some(candidate.cycle_id.clone()),
                    content: Some(question.content.clone()),
                    context: None,
                },
            )
            .await?;
            guides.push(RoutedGuide {
                task_id: receipt.task_id,
                cycle_id: receipt.cycle_id,
                command_id: receipt.command_id,
                event_cursor: receipt.event_cursor,
            });
        }
        sqlx::query("INSERT INTO public.task_routing_answers(organisation_id,client_id,engagement_id,question_id,author_id,selected) VALUES($1,$2,$3,$4,$5,$6)")
            .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id).bind(question_id).bind(actor).bind(serde_json::json!(chosen))
            .execute(&mut *tx).await.map_err(unavailable)?;
        admission_fence(&mut tx, actor, s, self.session()).await?;
        tx.commit().await.map_err(unavailable)?;
        Ok(RoutingQuestion {
            answer: Some(guides),
            ..question
        })
    }

    /// The author's most recent targeting questions, newest first.
    pub async fn questions(
        &self,
        actor: &str,
        s: &Scope,
    ) -> Result<Vec<RoutingQuestion>, TaskError> {
        let mut tx = begin(self.pool(), actor, s).await?;
        let rows = sqlx::query("SELECT q.*,a.selected FROM public.task_routing_questions q LEFT JOIN public.task_routing_answers a ON a.question_id=q.id WHERE q.author_id=$1 ORDER BY q.asked_at DESC, q.id COLLATE \"C\" DESC LIMIT $2")
            .bind(actor)
            .bind(QUESTION_PAGE_SIZE)
            .fetch_all(&mut *tx)
            .await
            .map_err(unavailable)?;
        let mut result = Vec::new();
        for row in &rows {
            result.push(Self::question(&mut tx, actor, row).await?);
        }
        tx.commit().await.map_err(unavailable)?;
        Ok(result)
    }

    /// Card projection: method binding, current cycle steps, brief revisions and
    /// the next action attributed to its invocation. No model text is returned.
    pub async fn work(&self, actor: &str, s: &Scope, task_id: &str) -> Result<TaskWork, TaskError> {
        if !valid_scope_id(task_id) {
            return Err(TaskError::Invalid);
        }
        let mut tx = begin(self.pool(), actor, s).await?;
        let row = sqlx::query("SELECT cycle_id,state,cessation FROM public.tasks WHERE id=$1")
            .bind(task_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(unavailable)?
            .ok_or(TaskError::Denied)?;
        let cycle_id: String = get(&row, "cycle_id")?;
        let state: String = get(&row, "state")?;
        let cessation: String = get(&row, "cessation")?;
        let mut steps = sqlx::query("SELECT * FROM public.task_steps WHERE task_id=$1 AND cycle_id=$2 ORDER BY ordinal DESC LIMIT $3")
            .bind(task_id)
            .bind(&cycle_id)
            .bind(STEP_PAGE_SIZE)
            .fetch_all(&mut *tx)
            .await
            .map_err(unavailable)?
            .iter()
            .map(step)
            .collect::<Result<Vec<_>, _>>()?;
        steps.reverse();
        let turns: i64 = sqlx::query_scalar("SELECT count(*) FROM public.task_steps WHERE task_id=$1 AND cycle_id=$2 AND kind='model_turn'")
            .bind(task_id)
            .bind(&cycle_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(unavailable)?;
        let briefs = sqlx::query("SELECT * FROM (SELECT c.id,c.task_id,c.cycle_id,c.content,c.received_cursor,g.boundary_ordinal,g.applied_cursor,lead(c.id) OVER (ORDER BY c.received_cursor) AS superseded_by FROM public.task_commands c LEFT JOIN public.task_guidance_applications g ON g.command_id=c.id WHERE c.task_id=$1 AND c.kind IN ('create','guide')) b ORDER BY received_cursor DESC LIMIT $2")
            .bind(task_id)
            .bind(BRIEF_PAGE_SIZE as i64)
            .fetch_all(&mut *tx)
            .await
            .map_err(unavailable)?
            .iter()
            .map(|row| {
                Ok(BriefRevision {
                    command_id: get(row, "id")?,
                    task_id: get(row, "task_id")?,
                    cycle_id: get(row, "cycle_id")?,
                    content: get(row, "content")?,
                    received_cursor: get::<i64>(row, "received_cursor")? as u64,
                    applied_boundary: get::<Option<i32>>(row, "boundary_ordinal")?
                        .map(|v| v as u32),
                    applied_cursor: get::<Option<i64>>(row, "applied_cursor")?.map(|v| v as u64),
                    superseded_by: get(row, "superseded_by")?,
                })
            })
            .collect::<Result<Vec<_>, TaskError>>()?;
        let binding = crate::methodology::current_binding(&mut tx, task_id)
            .await
            .ok();
        let (current_work, next_action, next_action_invocation_id, mut attention) = summarise(
            &steps,
            state == "waiting",
            cessation == "reconciliation_required",
        );
        if attention.is_none()
            && state == "waiting"
            && turns as usize >= zobba_domain::work::MAX_TURNS_PER_CYCLE
        {
            attention = Some(zobba_domain::work::Attention::CycleBounded);
        }
        tx.commit().await.map_err(unavailable)?;
        Ok(TaskWork {
            task_id: task_id.into(),
            cycle_id,
            methodology_status: binding.as_ref().and_then(|b| {
                serde_json::to_value(b.resolution.status)
                    .ok()
                    .and_then(|v| v.as_str().map(str::to_owned))
            }),
            methodology_binding_id: binding.map(|b| b.id),
            steps,
            briefs,
            current_work,
            next_action,
            next_action_invocation_id,
            attention,
        })
    }

    pub async fn boundary(&self, b: &ClaimBasis) -> Result<WorkBoundary, TaskError> {
        let mut tx = lock(self.pool(), &b.actor_id, &b.scope).await?;
        let row = task(&mut tx, &b.task_id).await?;
        if !continuation_current(&row, b)? {
            return Err(TaskError::Fenced);
        }
        producer(&mut tx, b).await?;
        sqlx::query("INSERT INTO public.task_work_claims(organisation_id,client_id,engagement_id,claim_id,process_instance) VALUES($1,$2,$3,$4,$5) ON CONFLICT(claim_id) DO NOTHING")
            .bind(&b.scope.organisation_id).bind(&b.scope.client_id).bind(&b.scope.engagement_id).bind(&b.claim_id).bind(&b.process_instance)
            .execute(&mut *tx).await.map_err(unavailable)?;
        apply_commands(&mut tx, &b.scope, &b.task_id, true).await?;
        sqlx::query("UPDATE public.tasks SET owner_until=clock_timestamp()+interval '5 seconds' WHERE id=$1")
            .bind(&b.task_id)
            .execute(&mut *tx)
            .await
            .map_err(unavailable)?;
        let row = task(&mut tx, &b.task_id).await?;
        if !continuation_current(&row, b)?
            || !crate::methodology::new_use_allowed(&mut tx, &b.task_id).await?
        {
            return Err(TaskError::Fenced);
        }
        let steps = cycle_steps(&mut tx, &b.task_id, &b.cycle_id).await?;
        let binding = crate::methodology::current_binding(&mut tx, &b.task_id)
            .await
            .map_err(|_| TaskError::Unavailable)?;
        let mut basis = b.clone();
        basis.intent_revision = get(&row, "applied_intent")?;
        let boundary = WorkBoundary {
            basis,
            objective: get(&row, "objective")?,
            working_brief: get(&row, "working_brief")?,
            methodology_binding_id: binding.id,
            steps,
        };
        admission_fence(&mut tx, &b.actor_id, &b.scope, None).await?;
        tx.commit().await.map_err(unavailable)?;
        Ok(boundary)
    }

    pub async fn record_step(
        &self,
        b: &ClaimBasis,
        input: &TaskStep,
    ) -> Result<TaskStep, TaskError> {
        if !input.is_valid()
            || input.task_id != b.task_id
            || input.cycle_id != b.cycle_id
            || input.execution_epoch != b.execution_epoch as u64
        {
            return Err(TaskError::Invalid);
        }
        let mut tx = lock(self.pool(), &b.actor_id, &b.scope).await?;
        producer(&mut tx, b).await?;
        if let Some(existing) = sqlx::query(
            "SELECT * FROM public.task_steps WHERE task_id=$1 AND cycle_id=$2 AND ordinal=$3",
        )
        .bind(&b.task_id)
        .bind(&b.cycle_id)
        .bind(input.ordinal as i32)
        .fetch_optional(&mut *tx)
        .await
        .map_err(unavailable)?
        {
            let existing = step(&existing)?;
            if existing.kind != input.kind
                || existing.invocation_id != input.invocation_id
                || existing.call_id != input.call_id
            {
                return Err(TaskError::Conflict);
            }
            tx.commit().await.map_err(unavailable)?;
            return Ok(existing);
        }
        let count: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM public.task_steps WHERE task_id=$1 AND cycle_id=$2",
        )
        .bind(&b.task_id)
        .bind(&b.cycle_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(unavailable)?;
        if count != i64::from(input.ordinal) {
            return Err(TaskError::Conflict);
        }
        let row = task(&mut tx, &b.task_id).await?;
        let mut stored = input.clone();
        // Decided under the Task lock: a Guide or control that committed before
        // this fact makes the turn's proposals stale. They are kept, never run.
        if stored.kind == StepKind::ModelTurn
            && matches!(stored.status, StepStatus::Proposed | StepStatus::Responded)
            && (get::<i64>(&row, "intent_revision")? as u64 != stored.intent_revision
                || get::<i64>(&row, "execution_epoch")? as u64 != stored.execution_epoch)
        {
            stored.status = StepStatus::Superseded;
            stored.next_action = Some(NextAction::ModelTurn);
            stored.current_work = format!("Model turn {} was superseded", stored.ordinal + 1);
        }
        sqlx::query("INSERT INTO public.task_steps(organisation_id,client_id,engagement_id,task_id,cycle_id,ordinal,kind,intent_revision,execution_epoch,invocation_id,call_id,operation_id,attempt_id,fact,status,next_action,current_work) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)")
            .bind(&b.scope.organisation_id).bind(&b.scope.client_id).bind(&b.scope.engagement_id)
            .bind(&stored.task_id).bind(&stored.cycle_id).bind(stored.ordinal as i32).bind(stored.kind.as_str())
            .bind(stored.intent_revision as i64).bind(stored.execution_epoch as i64)
            .bind(&stored.invocation_id).bind(&stored.call_id).bind(&stored.operation_id).bind(&stored.attempt_id)
            .bind(stored.fact.map(|f| f.as_str())).bind(stored.status.as_str())
            .bind(stored.next_action.as_ref().map(NextAction::descriptor)).bind(&stored.current_work)
            .execute(&mut *tx).await.map_err(unavailable)?;
        event(&mut tx, &b.scope, &b.task_id, &b.cycle_id, None, "step").await?;
        tx.commit().await.map_err(unavailable)?;
        Ok(stored)
    }
}

impl WorkSteps for TaskRepository {
    async fn boundary(&self, basis: &ClaimBasis) -> Result<WorkBoundary, TaskError> {
        TaskRepository::boundary(self, basis).await
    }
    async fn record_step(
        &self,
        basis: &ClaimBasis,
        step: &TaskStep,
    ) -> Result<TaskStep, TaskError> {
        TaskRepository::record_step(self, basis, step).await
    }
}
