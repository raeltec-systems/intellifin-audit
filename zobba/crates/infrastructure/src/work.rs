//! Durable work-cycle facts, step-boundary guidance and deterministic routing.
//! Every transaction is short and shares the organisation -> engagement -> Task
//! lock order with admission and Permissions consumption.
use crate::task::{
    OWNER_LEASE_SECONDS, TaskRepository, Tx, admission_fence, admit_in, apply_commands, begin,
    claim_matches, continuation_current, event, get, lock, task, token, unavailable,
};
use sqlx::postgres::PgRow;
use zobba_application::{
    knowledge::RecordReference,
    model::Invocation,
    task::TaskError,
    work::{MAX_WORK_KNOWLEDGE, MAX_WORK_KNOWLEDGE_BYTES, WorkBoundary, WorkKnowledge, WorkSteps},
};
use zobba_domain::{
    identity::{Scope, valid_scope_id},
    permissions::SourceFact,
    task::{
        COMMAND_CONTENT_MAX, Cessation, ClaimBasis, CommandKind, CommandReceipt, ReceiptStatus,
        TaskCommand, TaskState,
    },
    work::{
        AnswerError, BRIEF_PAGE_SIZE, BriefRevision, CALL_ID_MAX, Direction,
        MAX_ROUTING_CANDIDATES, NextAction, RoutedGuide, Routing, RoutingCandidate,
        RoutingQuestion, StepKind, StepStatus, TaskStep, TaskWork, answer_selection, direction_key,
        route_direction, routed_guide_key, summarise,
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
        knowledge_omitted: u32::try_from(get::<i32>(row, "knowledge_omitted")?)
            .map_err(|_| TaskError::Unavailable)?,
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

fn state_of(row: &PgRow) -> Result<(TaskState, Cessation), TaskError> {
    Ok((
        TaskState::parse(&get::<String>(row, "state")?).ok_or(TaskError::Unavailable)?,
        Cessation::parse(&get::<String>(row, "cessation")?).ok_or(TaskError::Unavailable)?,
    ))
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

/// The fact stored for a model turn whose producing intent or execution epoch
/// was no longer current when it was recorded.
fn superseded(input: &TaskStep) -> TaskStep {
    let mut stored = input.clone();
    if stored.kind == StepKind::ModelTurn
        && matches!(stored.status, StepStatus::Proposed | StepStatus::Responded)
    {
        stored.status = StepStatus::Superseded;
        stored.next_action = Some(NextAction::ModelTurn);
        stored.current_work = format!("Model turn {} was superseded", stored.ordinal + 1);
    }
    stored
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

    /// Decode questions and their answered Guides with one bounded receipt
    /// read for the whole page instead of one query per selected Task.
    async fn questions_from(
        tx: &mut Tx,
        actor: &str,
        rows: &[PgRow],
    ) -> Result<Vec<RoutingQuestion>, TaskError> {
        let mut selections = Vec::with_capacity(rows.len());
        let mut keys = Vec::new();
        for row in rows {
            let key: String = get(row, "idempotency_key")?;
            let selected: Option<serde_json::Value> = get(row, "selected")?;
            let selected = match selected {
                None => None,
                Some(value) => Some(
                    value
                        .as_array()
                        .ok_or(TaskError::Unavailable)?
                        .iter()
                        .map(|id| id.as_str().map(str::to_owned).ok_or(TaskError::Unavailable))
                        .collect::<Result<Vec<_>, _>>()?,
                ),
            };
            for task_id in selected.iter().flatten() {
                keys.push(routed_guide_key(&key, task_id));
            }
            selections.push((key, selected));
        }
        let commands = if keys.is_empty() {
            vec![]
        } else {
            sqlx::query(
                "SELECT * FROM public.task_commands WHERE author_id=$1 AND idempotency_key=ANY($2)",
            )
            .bind(actor)
            .bind(&keys)
            .fetch_all(&mut **tx)
            .await
            .map_err(unavailable)?
        };
        let mut by_key = std::collections::HashMap::new();
        for command in &commands {
            by_key.insert(
                get::<String>(command, "idempotency_key")?,
                receipt(command)?,
            );
        }
        rows.iter()
            .zip(selections)
            .map(|(row, (key, selected))| {
                let answer = selected
                    .map(|ids| {
                        ids.iter()
                            .map(|task_id| {
                                let receipt = by_key
                                    .get(&routed_guide_key(&key, task_id))
                                    .ok_or(TaskError::Unavailable)?;
                                Ok(RoutedGuide {
                                    task_id: receipt.task_id.clone(),
                                    cycle_id: receipt.cycle_id.clone(),
                                    command_id: receipt.command_id.clone(),
                                    event_cursor: receipt.event_cursor.clone(),
                                })
                            })
                            .collect::<Result<Vec<_>, TaskError>>()
                    })
                    .transpose()?;
                Ok(RoutingQuestion {
                    id: get(row, "id")?,
                    key,
                    content: get(row, "content")?,
                    candidates: candidates(get(row, "candidates")?)?,
                    answer,
                })
            })
            .collect()
    }

    async fn question(tx: &mut Tx, actor: &str, row: &PgRow) -> Result<RoutingQuestion, TaskError> {
        Self::questions_from(tx, actor, std::slice::from_ref(row))
            .await?
            .pop()
            .ok_or(TaskError::Unavailable)
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
        // A routed Guide uses its own key namespace: the same client key used
        // for an ordinary Task command is unrelated to this direction.
        let routed_key = direction_key(key);
        if let Some(existing) = sqlx::query(
            "SELECT * FROM public.task_commands WHERE author_id=$1 AND idempotency_key=$2",
        )
        .bind(actor)
        .bind(&routed_key)
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
        // Every open Task fits: open Tasks are bounded by the same capacity.
        let rows = sqlx::query("SELECT id,cycle_id,objective,state,cessation FROM public.tasks WHERE state <> 'stopped' ORDER BY id COLLATE \"C\" LIMIT $1")
            .bind(MAX_ROUTING_CANDIDATES as i64 + 1)
            .fetch_all(&mut *tx)
            .await
            .map_err(unavailable)?;
        if rows.len() > MAX_ROUTING_CANDIDATES {
            return Err(TaskError::Unavailable);
        }
        let mut found = Vec::new();
        for row in &rows {
            let (state, cessation) = state_of(row)?;
            if state.accepts(CommandKind::Guide, cessation) {
                found.push(RoutingCandidate {
                    task_id: get(row, "id")?,
                    cycle_id: get(row, "cycle_id")?,
                    objective: get(row, "objective")?,
                });
            }
        }
        let result = match route_direction(found) {
            Routing::NoCandidate => return Err(TaskError::Conflict),
            Routing::Target(candidate) => Direction::Routed(
                admit_in(
                    &mut tx,
                    actor,
                    s,
                    &TaskCommand {
                        key: routed_key,
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
        if !valid_scope_id(question_id)
            || selected.is_empty()
            || selected.len() > MAX_ROUTING_CANDIDATES
            || selected.iter().any(|id| !valid_scope_id(id))
        {
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
        let chosen = answer_selection(&question, selected).map_err(|error| match error {
            AnswerError::Invalid => TaskError::Invalid,
            AnswerError::NotCandidate => TaskError::Conflict,
        })?;
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
            let current =
                sqlx::query("SELECT state,cessation,cycle_id FROM public.tasks WHERE id=$1")
                    .bind(task_id)
                    .fetch_optional(&mut *tx)
                    .await
                    .map_err(unavailable)?
                    .ok_or(TaskError::Conflict)?;
            let (state, cessation) = state_of(&current)?;
            if state == TaskState::Stopped
                || !state.accepts(CommandKind::Guide, cessation)
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
    /// Returns the page and whether older questions exist beyond it.
    pub async fn questions(
        &self,
        actor: &str,
        s: &Scope,
    ) -> Result<(Vec<RoutingQuestion>, bool), TaskError> {
        let mut tx = begin(self.pool(), actor, s).await?;
        let rows = sqlx::query("SELECT q.*,a.selected FROM public.task_routing_questions q LEFT JOIN public.task_routing_answers a ON a.question_id=q.id WHERE q.author_id=$1 ORDER BY q.asked_at DESC, q.id COLLATE \"C\" DESC LIMIT $2")
            .bind(actor)
            .bind(QUESTION_PAGE_SIZE + 1)
            .fetch_all(&mut *tx)
            .await
            .map_err(unavailable)?;
        let more = rows.len() as i64 > QUESTION_PAGE_SIZE;
        let page = &rows[..rows.len().min(QUESTION_PAGE_SIZE as usize)];
        let result = Self::questions_from(&mut tx, actor, page).await?;
        tx.commit().await.map_err(unavailable)?;
        Ok((result, more))
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
        let (turns, total): (i64, i64) = sqlx::query_as("SELECT count(*) FILTER (WHERE kind='model_turn'),count(*) FROM public.task_steps WHERE task_id=$1 AND cycle_id=$2")
            .bind(task_id)
            .bind(&cycle_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(unavailable)?;
        // A revision is superseded only by a later revision of the same cycle
        // that was actually applied; received-but-pending guidance replaces
        // nothing yet.
        let briefs = sqlx::query("SELECT c.id,c.task_id,c.cycle_id,c.content,c.received_cursor,g.boundary_ordinal,g.applied_cursor,(SELECT later.id FROM public.task_commands later JOIN public.task_guidance_applications lg ON lg.command_id=later.id WHERE later.task_id=c.task_id AND later.cycle_id=c.cycle_id AND later.kind IN ('create','guide') AND later.received_cursor>c.received_cursor ORDER BY later.received_cursor LIMIT 1) AS superseded_by FROM public.task_commands c LEFT JOIN public.task_guidance_applications g ON g.command_id=c.id WHERE c.task_id=$1 AND c.kind IN ('create','guide') ORDER BY c.received_cursor DESC LIMIT $2")
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
        // Every Task is bound at creation; an unreadable binding is an error,
        // never reported as "not bound".
        let binding = Some(
            crate::methodology::current_binding(&mut tx, task_id)
                .await
                .map_err(|error| match error {
                    zobba_application::methodology::MethodologyError::Denied => TaskError::Denied,
                    _ => TaskError::Unavailable,
                })?,
        );
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
            total_steps: u32::try_from(total).map_err(|_| TaskError::Unavailable)?,
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
        sqlx::query("UPDATE public.tasks SET owner_until=clock_timestamp()+make_interval(secs=>$2) WHERE id=$1")
            .bind(&b.task_id)
            .bind(OWNER_LEASE_SECONDS)
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
        let objective: String = get(&row, "objective")?;
        let working_brief: String = get(&row, "working_brief")?;
        let applied_intent: i64 = get(&row, "applied_intent")?;
        // Current authorised knowledge, under this same fence. Withdrawn or
        // otherwise non-current records are omitted and never disclosed.
        let (knowledge, knowledge_omitted) = crate::knowledge::task_context_in_transaction(
            &mut tx,
            &b.actor_id,
            &b.scope,
            &b.task_id,
            MAX_WORK_KNOWLEDGE,
            MAX_WORK_KNOWLEDGE_BYTES,
        )
        .await
        .map_err(|error| match error {
            zobba_application::knowledge::KnowledgeError::Denied => TaskError::Fenced,
            _ => TaskError::Unavailable,
        })?;
        let knowledge = knowledge
            .into_iter()
            .map(|view| WorkKnowledge {
                reference: RecordReference {
                    id: view.record.id,
                    revision: view.record.revision,
                },
                text: view.record.text,
            })
            .collect();
        let mut basis = b.clone();
        basis.intent_revision = applied_intent;
        let boundary = WorkBoundary {
            basis,
            objective,
            working_brief,
            methodology_binding_id: binding.id,
            steps,
            knowledge,
            knowledge_omitted,
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
            // An identical retry returns the original fact. The only accepted
            // difference is the storage decision that superseded a stale turn.
            let existing = step(&existing)?;
            if existing != *input && existing != superseded(input) {
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
        // Decided under the Task lock: a Guide or control that committed before
        // this fact makes the turn's proposals stale. They are kept, never run.
        let stored = if get::<i64>(&row, "intent_revision")? as u64 != input.intent_revision
            || get::<i64>(&row, "execution_epoch")? as u64 != input.execution_epoch
        {
            superseded(input)
        } else {
            input.clone()
        };
        sqlx::query("INSERT INTO public.task_steps(organisation_id,client_id,engagement_id,task_id,cycle_id,ordinal,kind,intent_revision,execution_epoch,invocation_id,call_id,operation_id,attempt_id,fact,status,next_action,current_work,knowledge_omitted) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)")
            .bind(&b.scope.organisation_id).bind(&b.scope.client_id).bind(&b.scope.engagement_id)
            .bind(&stored.task_id).bind(&stored.cycle_id).bind(stored.ordinal as i32).bind(stored.kind.as_str())
            .bind(stored.intent_revision as i64).bind(stored.execution_epoch as i64)
            .bind(&stored.invocation_id).bind(&stored.call_id).bind(&stored.operation_id).bind(&stored.attempt_id)
            .bind(stored.fact.map(|f| f.as_str())).bind(stored.status.as_str())
            .bind(stored.next_action.as_ref().map(NextAction::descriptor)).bind(&stored.current_work)
            .bind(i32::try_from(stored.knowledge_omitted).map_err(|_| TaskError::Invalid)?)
            .execute(&mut *tx).await.map_err(|error| {
                // A storage guard (wrong Task/cycle binding) is a refusal, not an outage.
                if error.as_database_error().and_then(|e| e.code()).as_deref() == Some("23514") {
                    TaskError::Conflict
                } else {
                    TaskError::Unavailable
                }
            })?;
        event(&mut tx, &b.scope, &b.task_id, &b.cycle_id, None, "step").await?;
        tx.commit().await.map_err(unavailable)?;
        Ok(stored)
    }
}

impl TaskRepository {
    /// See `WorkSteps::invocation`.
    pub async fn cycle_invocation(
        &self,
        b: &ClaimBasis,
        invocation_id: &str,
    ) -> Result<Invocation, TaskError> {
        let mut tx = lock(self.pool(), &b.actor_id, &b.scope).await?;
        producer(&mut tx, b).await?;
        let invocation = crate::model::load_for_cycle(&mut tx, b, invocation_id)
            .await
            .map_err(|error| match error {
                zobba_application::model::ModelError::Unavailable => TaskError::Unavailable,
                _ => TaskError::Denied,
            })?;
        tx.commit().await.map_err(unavailable)?;
        Ok(invocation)
    }
    /// See `WorkSteps::bound_operation`.
    pub async fn bound_operation(
        &self,
        b: &ClaimBasis,
        invocation_id: &str,
        call_id: &str,
    ) -> Result<Option<String>, TaskError> {
        if !valid_scope_id(invocation_id) || call_id.is_empty() || call_id.len() > CALL_ID_MAX {
            return Err(TaskError::Invalid);
        }
        let mut tx = lock(self.pool(), &b.actor_id, &b.scope).await?;
        producer(&mut tx, b).await?;
        let operation: Option<String> = sqlx::query_scalar("SELECT b.operation_id FROM public.model_tool_bindings b JOIN public.operations o ON o.id=b.operation_id WHERE b.invocation_id=$1 AND b.call_id=$2 AND o.task_id=$3")
            .bind(invocation_id)
            .bind(call_id)
            .bind(&b.task_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(unavailable)?;
        tx.commit().await.map_err(unavailable)?;
        Ok(operation)
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
    async fn invocation(
        &self,
        basis: &ClaimBasis,
        invocation_id: &str,
    ) -> Result<Invocation, TaskError> {
        self.cycle_invocation(basis, invocation_id).await
    }
    async fn bound_operation(
        &self,
        basis: &ClaimBasis,
        invocation_id: &str,
        call_id: &str,
    ) -> Result<Option<String>, TaskError> {
        TaskRepository::bound_operation(self, basis, invocation_id, call_id).await
    }
}

#[cfg(test)]
mod tests {
    use sha2::{Digest, Sha256};

    /// The domain's dependency-free SHA-256 (the domain crate may have no
    /// dependencies) agrees with the workspace's independent digest crate at
    /// every padding boundary and across multiple blocks.
    #[test]
    fn domain_sha256_matches_the_independent_digest_crate() {
        for length in [
            0usize, 1, 55, 56, 57, 63, 64, 65, 119, 120, 121, 127, 128, 1000,
        ] {
            let input: Vec<u8> = (0..length).map(|i| (i * 31 % 251) as u8).collect();
            assert_eq!(
                zobba_domain::work::sha256_hex(&input),
                format!("{:x}", Sha256::digest(&input)),
                "length {length}"
            );
        }
    }
}
