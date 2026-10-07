//! Story 22.2: the durable work loop against real PostgreSQL authority. The
//! transport is an in-process script; admission, Permissions consumption, step
//! facts, guidance boundaries and routing are the production repositories.
use super::model_execution::{FixtureQualification, catalogue, profile};
use super::*;
use std::{
    collections::VecDeque,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
};
use tokio::sync::Notify;
use zobba_application::knowledge::{
    Assertion, KnowledgeAction, KnowledgeCommand, KnowledgeQuery, KnowledgeStore, Period,
    RecordReference, RecordStatus,
};
use zobba_application::{
    model::*,
    work::{CycleEnd, SettledAttempt, ToolDispatch, WorkLoop, WorkSettings, settled_attempt},
};
use zobba_domain::work::{
    Attention, Direction, NextAction, StepKind, StepStatus, invocation_key, routed_guide_key,
};
use zobba_infrastructure::{
    identity::{IdentityRepository, secret_hash},
    knowledge::KnowledgeRepository,
    model::{ModelRepository, bind_disclosure},
};

enum Turn {
    Tool(&'static str, &'static str),
    Text(&'static str),
    /// Wait for the notify, then answer with the inner turn.
    Stall(Arc<Notify>, Box<Turn>),
    /// Never answer until cancelled.
    Hang,
}

#[derive(Default)]
struct Script {
    turns: Mutex<VecDeque<Turn>>,
    sends: AtomicUsize,
    briefs: Mutex<Vec<String>>,
    requests: Mutex<Vec<ModelRequest>>,
}
impl Script {
    fn new(turns: Vec<Turn>) -> Arc<Self> {
        Arc::new(Self {
            turns: Mutex::new(turns.into()),
            ..Self::default()
        })
    }
}
fn outcome(turn: &Turn) -> TransportOutcome {
    let (events, completion) = match turn {
        Turn::Tool(call, name) => (
            vec![ModelEvent {
                sequence: 0,
                kind: EventKind::ToolProposal {
                    call_id: (*call).into(),
                    name: (*name).into(),
                    arguments: JsonValue::Null,
                },
            }],
            Completion::Succeeded,
        ),
        Turn::Text(text) => (
            vec![ModelEvent {
                sequence: 0,
                kind: EventKind::TextDelta {
                    item_id: "text-1".into(),
                    text: (*text).into(),
                },
            }],
            Completion::Succeeded,
        ),
        _ => unreachable!(),
    };
    TransportOutcome {
        events,
        actual_provider: Provider::OpenAi,
        actual_model: Some("fixture-model".into()),
        response_id: Some("fixture-response".into()),
        usage: Usage::default(),
        completion,
    }
}
#[derive(Clone)]
struct Shared(Arc<Script>);
impl ModelTransport for Shared {
    async fn invoke(&self, request: &ModelRequest, cancel: &ModelCancellation) -> TransportOutcome {
        self.0.sends.fetch_add(1, Ordering::SeqCst);
        self.0.requests.lock().unwrap().push(request.clone());
        if let Some(brief) = request
            .messages
            .iter()
            .find(|m| m.source_id.as_deref() == Some("task-brief"))
        {
            self.0.briefs.lock().unwrap().push(brief.text.clone());
        }
        let turn = self
            .0
            .turns
            .lock()
            .unwrap()
            .pop_front()
            .expect("unscripted turn");
        let turn = match turn {
            Turn::Stall(notify, inner) => {
                notify.notified().await;
                *inner
            }
            Turn::Hang => loop {
                if cancel.is_cancelled() {
                    return TransportOutcome {
                        events: vec![],
                        actual_provider: Provider::OpenAi,
                        actual_model: None,
                        response_id: None,
                        usage: Usage::default(),
                        completion: Completion::Cancelled,
                    };
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            },
            other => other,
        };
        let mut result = outcome(&turn);
        // Fill exact catalogue arguments for the named tool.
        for event in &mut result.events {
            if let EventKind::ToolProposal {
                name, arguments, ..
            } = &mut event.kind
            {
                let tool = request
                    .catalogue
                    .tools
                    .iter()
                    .find(|t| &t.name == name)
                    .unwrap();
                *arguments = operation_arguments(&tool.operation);
            }
        }
        result
    }
}

/// A Guide admitted after tool admission and before consumption.
type Interjection = Arc<Mutex<Option<(TaskRepository, TaskCommand)>>>;

struct Dispatch {
    operations: OperationRepository,
    /// Simulate a lost producer after consumption (possible dispatch cutoff).
    hang_after_consume: Arc<AtomicBool>,
    /// Simulate a lost producer after the completed receipt was recorded but
    /// before the tool step fact was written.
    hang_after_observe: Arc<AtomicBool>,
    before_consume: Interjection,
    dispatches: Arc<AtomicUsize>,
}
impl ToolDispatch for Dispatch {
    async fn dispatch(
        &self,
        basis: &ClaimBasis,
        operation_id: &str,
    ) -> Result<(String, SourceFact), OperationError> {
        self.dispatches.fetch_add(1, Ordering::SeqCst);
        let interjection = self.before_consume.lock().unwrap().take();
        if let Some((tasks, command)) = interjection {
            tasks
                .admit("actor-a", &selected("a"), &command)
                .await
                .unwrap();
        }
        let attempt = self.operations.consume(basis, operation_id).await?;
        if self.hang_after_consume.load(Ordering::SeqCst) {
            std::future::pending::<()>().await;
        }
        self.operations
            .observe(&attempt, SourceFact::Completed)
            .await?;
        if self.hang_after_observe.load(Ordering::SeqCst) {
            std::future::pending::<()>().await;
        }
        Ok((attempt.attempt_id.clone(), SourceFact::Completed))
    }
    async fn settled(
        &self,
        basis: &ClaimBasis,
        operation_id: &str,
    ) -> Result<Option<SettledAttempt>, OperationError> {
        settled_attempt(
            &self.operations,
            &basis.actor_id,
            &basis.scope,
            operation_id,
        )
        .await
    }
}

struct Harness {
    repo: ModelRepository,
    operations: OperationRepository,
    profile: ModelProfile,
    catalogue: ToolCatalog,
    hang_after_observe: Arc<AtomicBool>,
    before_consume: Interjection,
    dispatches: Arc<AtomicUsize>,
}
impl Harness {
    fn work(
        &self,
        f: &Fixture,
        script: &Arc<Script>,
        hang: &Arc<AtomicBool>,
    ) -> WorkLoop<TaskRepository, ModelRepository, Shared, Dispatch> {
        WorkLoop {
            steps: f.tasks.clone(),
            coordinator: ModelCoordinator {
                store: self.repo.clone(),
                transport: Shared(script.clone()),
            },
            dispatch: Dispatch {
                operations: self.operations.clone(),
                hang_after_consume: hang.clone(),
                hang_after_observe: self.hang_after_observe.clone(),
                before_consume: self.before_consume.clone(),
                dispatches: self.dispatches.clone(),
            },
            settings: WorkSettings {
                profile: self.profile.clone(),
                catalogue: self.catalogue.clone(),
                disclosure: request("Synthetic model processing"),
                input_class: "audit".into(),
                max_output_tokens: 128,
            },
            bind: bind_disclosure,
        }
    }
}

async fn consumed(f: &Fixture, name: &str) -> (Case, ClaimBasis, ConsumedAttempt) {
    let case = f.case(name, true, 0).await;
    let basis = case.basis.clone();
    let attempt = f.tasks.consume(&basis).await.unwrap();
    (case, basis, attempt)
}
/// The worker records the loop's end as an exact observation, then reconciles.
async fn finish(f: &Fixture, case: &Case, attempt: &ConsumedAttempt, outcome: Observation) {
    f.tasks.observe(attempt, outcome).await.unwrap();
    f.tasks
        .reconcile(&route(&case.receipt), &attempt.basis.worker_id)
        .await
        .unwrap();
}
fn guide(key: &str, case: &Case, content: &str) -> TaskCommand {
    TaskCommand {
        context: None,
        key: key.into(),
        kind: CommandKind::Guide,
        task_id: Some(case.receipt.task_id.clone()),
        cycle_id: Some(case.receipt.cycle_id.clone()),
        content: Some(content.into()),
    }
}

pub(super) async fn verify(f: &Fixture, admin: &mut PgConnection) {
    let identities = IdentityRepository::new(f.pool.clone());
    let session = identities
        .establish_session("https://127.0.0.1:4443", "manager-a", "Manager", None)
        .await
        .unwrap();
    let qualification = Arc::new(FixtureQualification(AtomicBool::new(true)));
    let repo = ModelRepository::new(f.pool.clone())
        .with_session_hash(secret_hash(&session))
        .with_qualification_source(qualification.clone());
    let mut p = profile();
    p.id = "work-profile".into();
    let mut c = catalogue(&request("Work loop prepared effect"));
    c.id = "work-tools".into();
    // A second catalogue tool that current Permissions refuse.
    let mut refused = c.tools[0].clone();
    refused.name = "send_forbidden".into();
    refused.operation.destination = "forbidden-endpoint".into();
    refused.input_schema = ArgumentSchema::for_operation(&refused.operation);
    c.tools.push(refused);
    repo.save_profile("actor-manager", "org-a", &p)
        .await
        .unwrap();
    repo.save_catalogue("actor-manager", "org-a", &c)
        .await
        .unwrap();
    // Selection reads only latest enabled, trusted-qualified configuration.
    let selection = repo.selection("actor-a", &selected("a")).await.unwrap();
    assert!(
        selection.is_some(),
        "a qualified profile and enabled catalogue are selectable"
    );
    assert_eq!(
        ModelRepository::new(f.pool.clone())
            .selection("actor-a", &selected("a"))
            .await
            .unwrap(),
        None,
        "without a trusted qualification source the model is unavailable"
    );
    let harness = Harness {
        repo: repo.clone(),
        operations: OperationRepository::new(f.pool.clone())
            .with_model_qualification_source(qualification.clone()),
        profile: p,
        catalogue: c,
        hang_after_observe: Arc::new(AtomicBool::new(false)),
        before_consume: Arc::new(Mutex::new(None)),
        dispatches: Arc::new(AtomicUsize::new(0)),
    };
    let hang = Arc::new(AtomicBool::new(false));
    first_cycle(f, &harness, &hang).await;
    guidance_mid_call(f, &harness, &hang, admin).await;
    guide_turn_race(f, &harness, &hang, admin).await;
    stalled_pause(f, &harness, &hang).await;
    restart_recovery(f, &harness, &hang, admin).await;
    completed_before_restart(f, &harness, &hang, admin).await;
    fenced_after_admission(f, &harness, &hang, admin).await;
    guide_after_completed_tool(f, &harness, &hang).await;
    let auditor = identities
        .establish_session("https://127.0.0.1:4443", "auditor-a", "Auditor", None)
        .await
        .unwrap();
    knowledge_context(f, &harness, &hang, &secret_hash(&auditor)).await;
    routing(f, admin).await;
}

async fn first_cycle(f: &Fixture, h: &Harness, hang: &Arc<AtomicBool>) {
    let (case, basis, attempt) = consumed(f, "work-first-cycle").await;
    let script = Script::new(vec![
        Turn::Tool("call-1", "send_exact"),
        Turn::Tool("call-2", "send_forbidden"),
        Turn::Text("Review complete for now; awaiting direction."),
    ]);
    let end = h
        .work(f, &script, hang)
        .run(&basis, &ModelCancellation::new())
        .await;
    assert_eq!(
        end,
        CycleEnd::Waiting,
        "a text-only turn waits; it is not completion"
    );
    assert_eq!(script.sends.load(Ordering::SeqCst), 3);
    let work = f
        .tasks
        .work("actor-a", &selected("a"), &case.receipt.task_id)
        .await
        .unwrap();
    let shape: Vec<_> = work
        .steps
        .iter()
        .map(|s| (s.ordinal, s.kind, s.status))
        .collect();
    assert_eq!(
        shape,
        vec![
            (0, StepKind::ModelTurn, StepStatus::Proposed),
            (1, StepKind::ToolStep, StepStatus::Completed),
            (2, StepKind::ModelTurn, StepStatus::Proposed),
            (3, StepKind::ToolStep, StepStatus::Refused),
            (4, StepKind::ModelTurn, StepStatus::Responded),
        ]
    );
    // The completed tool is attributable: exact operation, attempt and receipt.
    let tool = &work.steps[1];
    assert_eq!(tool.fact, Some(SourceFact::Completed));
    assert!(tool.operation_id.is_some() && tool.attempt_id.is_some());
    // Refused admission is a recorded fact and nothing was consumed for it.
    let refused = &work.steps[3];
    assert_eq!(refused.attempt_id, None);
    assert_eq!(work.next_action, Some(NextAction::AwaitGuidance));
    assert_eq!(work.next_action_invocation_id, work.steps[4].invocation_id);
    assert_eq!(work.current_work.as_deref(), Some("Model turn 5 responded"));
    assert!(
        work.methodology_binding_id.is_some(),
        "the card names the bound method"
    );
    // Each invocation is bound to its Task, cycle, intent and step ordinal.
    let first = h
        .repo
        .get(
            "actor-a",
            &selected("a"),
            work.steps[0].invocation_id.as_ref().unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        first.key,
        invocation_key(
            &basis.task_id,
            &basis.cycle_id,
            basis.intent_revision as u64,
            0
        )
    );
    assert_eq!(first.request.basis.execution_epoch, basis.execution_epoch);
    // Owned history: the second turn carried the exact first ToolExchange.
    let second = h
        .repo
        .get(
            "actor-a",
            &selected("a"),
            work.steps[2].invocation_id.as_ref().unwrap(),
        )
        .await
        .unwrap();
    assert!(
        matches!(&second.request.history[..], [HistoryItem::ToolExchange(e)] if e.result.attempt_id == *tool.attempt_id.as_ref().unwrap())
    );
    // The Create brief was applied at the claim boundary before step 0.
    assert_eq!(work.briefs.len(), 1);
    assert_eq!(work.briefs[0].applied_boundary, Some(0));
    // Observed completion of the loop leaves the Task waiting, not done.
    finish(f, &case, &attempt, Observation::Completed).await;
    let snapshot = f
        .tasks
        .get("actor-a", &selected("a"), &case.receipt.task_id)
        .await
        .unwrap();
    assert_eq!(snapshot.state, TaskState::Waiting);
    let work = f
        .tasks
        .work("actor-a", &selected("a"), &case.receipt.task_id)
        .await
        .unwrap();
    assert_eq!(work.attention, Some(Attention::AwaitingGuidance));
}

async fn guidance_mid_call(
    f: &Fixture,
    h: &Harness,
    hang: &Arc<AtomicBool>,
    admin: &mut PgConnection,
) {
    let (case, basis, attempt) = consumed(f, "work-guide-mid-call").await;
    let release = Arc::new(Notify::new());
    let script = Script::new(vec![
        Turn::Stall(
            release.clone(),
            Box::new(Turn::Tool("stale-call", "send_exact")),
        ),
        Turn::Text("Reconsidered under the new brief."),
    ]);
    let work = h.work(f, &script, hang);
    let cancellation = ModelCancellation::new();
    let run = work.run(&basis, &cancellation);
    tokio::pin!(run);
    // Guidance is received immediately while the provider call runs.
    let received = async {
        while script.sends.load(Ordering::SeqCst) == 0 {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        let command = guide(
            "work-mid-guide",
            &case,
            "New direction: sample the largest items",
        );
        let receipt = f
            .tasks
            .admit("actor-a", &selected("a"), &command)
            .await
            .unwrap();
        assert_eq!(
            receipt.task_id, case.receipt.task_id,
            "Received names the target Task"
        );
        // The in-flight work is not cancelled by guidance.
        assert!(f.tasks.current(&basis).await.unwrap());
        assert_eq!(
            f.tasks
                .admit("actor-a", &selected("a"), &command)
                .await
                .unwrap(),
            receipt,
            "duplicate retry returns the original receipt"
        );
        release.notify_one();
        receipt
    };
    let (end, receipt) = tokio::join!(&mut run, received);
    assert_eq!(end, CycleEnd::Waiting);
    let steps = f
        .tasks
        .work("actor-a", &selected("a"), &case.receipt.task_id)
        .await
        .unwrap();
    let shape: Vec<_> = steps.steps.iter().map(|s| (s.kind, s.status)).collect();
    assert_eq!(
        shape,
        vec![
            (StepKind::ModelTurn, StepStatus::Superseded),
            (StepKind::ModelTurn, StepStatus::Responded),
        ]
    );
    // Superseded proposals were never admitted.
    let stale = steps.steps[0].invocation_id.clone().unwrap();
    let bound: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM public.model_tool_bindings WHERE invocation_id=$1",
    )
    .bind(&stale)
    .fetch_one(&mut *admin)
    .await
    .unwrap();
    assert_eq!(
        bound, 0,
        "a stale-intent proposal is recorded, never admitted"
    );
    // Applied is a separate fact naming the boundary step.
    let briefs = &steps.briefs;
    assert_eq!(briefs[0].command_id, receipt.command_id);
    assert_eq!(briefs[0].applied_boundary, Some(1));
    assert_eq!(
        briefs[1].superseded_by.as_deref(),
        Some(receipt.command_id.as_str())
    );
    let applied: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM public.task_events WHERE command_id=$1 AND kind='applied'",
    )
    .bind(&receipt.command_id)
    .fetch_one(&mut *admin)
    .await
    .unwrap();
    assert_eq!(applied, 1);
    // The next turn used the new brief.
    let seen = script.briefs.lock().unwrap().clone();
    assert!(seen[1].contains("New direction"), "{seen:?}");
    assert!(!seen[0].contains("New direction"));
    // Two further Guides: revisions listed in order with superseded_by.
    let g2 = f
        .tasks
        .admit(
            "actor-a",
            &selected("a"),
            &guide("work-guide-2", &case, "Second revision"),
        )
        .await
        .unwrap();
    let g3 = f
        .tasks
        .admit(
            "actor-a",
            &selected("a"),
            &guide("work-guide-3", &case, "Third revision"),
        )
        .await
        .unwrap();
    finish(f, &case, &attempt, Observation::Completed).await;
    let briefs = f
        .tasks
        .work("actor-a", &selected("a"), &case.receipt.task_id)
        .await
        .unwrap()
        .briefs;
    assert_eq!(briefs[0].command_id, g3.command_id);
    assert_eq!(briefs[1].command_id, g2.command_id);
    assert_eq!(
        briefs[1].superseded_by.as_deref(),
        Some(g3.command_id.as_str())
    );
    assert_eq!(briefs[0].superseded_by, None);
    assert_eq!(briefs[1].applied_boundary, briefs[0].applied_boundary);
}

/// Concurrent Guide versus turn completion. Whichever commits first, a
/// proposal produced under the old intent is never consumed and the guidance
/// is applied at a recorded boundary before the next turn.
async fn guide_turn_race(
    f: &Fixture,
    h: &Harness,
    hang: &Arc<AtomicBool>,
    admin: &mut PgConnection,
) {
    for delay in [0u64, 2, 5, 15] {
        let name = format!("work-race-{delay}");
        let (case, basis, _) = consumed(f, &name).await;
        let script = Script::new(vec![
            Turn::Tool("race-call", "send_exact"),
            Turn::Text("After the race."),
        ]);
        let work = h.work(f, &script, hang);
        let cancellation = ModelCancellation::new();
        let command = guide(&format!("{name}-guide"), &case, "Raced direction");
        let guidance = async {
            while script.sends.load(Ordering::SeqCst) == 0 {
                tokio::task::yield_now().await;
            }
            tokio::time::sleep(Duration::from_millis(delay)).await;
            f.tasks
                .admit("actor-a", &selected("a"), &command)
                .await
                .unwrap()
        };
        let (end, receipt) = tokio::join!(work.run(&basis, &cancellation), guidance);
        assert!(matches!(end, CycleEnd::Waiting), "{delay}: {end:?}");
        let work = f
            .tasks
            .work("actor-a", &selected("a"), &case.receipt.task_id)
            .await
            .unwrap();
        let first = &work.steps[0];
        let consumed: i64 = sqlx::query_scalar("SELECT count(*) FROM public.operation_claims c JOIN public.model_tool_bindings b ON b.operation_id=c.operation_id WHERE b.invocation_id=$1 AND c.state='consumed'")
            .bind(first.invocation_id.as_ref().unwrap()).fetch_one(&mut *admin).await.unwrap();
        match first.status {
            StepStatus::Superseded => assert_eq!(consumed, 0, "{delay}"),
            // The turn committed before the Guide: its tool either completed
            // before the Guide or was fenced from admission/consumption.
            StepStatus::Proposed => assert!(
                matches!(
                    work.steps[1].status,
                    StepStatus::Superseded | StepStatus::Completed
                ),
                "{delay}"
            ),
            other => panic!("{delay}: unexpected {other:?}"),
        }
        let applied = work
            .briefs
            .iter()
            .find(|b| b.command_id == receipt.command_id)
            .unwrap();
        assert!(
            applied.applied_boundary.is_some(),
            "{delay}: guidance applied at a boundary"
        );
        assert_eq!(work.steps.last().unwrap().status, StepStatus::Responded);
        assert!(
            script
                .briefs
                .lock()
                .unwrap()
                .last()
                .unwrap()
                .contains("Raced direction")
        );
    }
}

async fn stalled_pause(f: &Fixture, h: &Harness, hang: &Arc<AtomicBool>) {
    let (case, basis, attempt) = consumed(f, "work-stalled-pause").await;
    let script = Script::new(vec![Turn::Hang]);
    let work = h.work(f, &script, hang);
    let cancellation = ModelCancellation::new();
    let run = work.run(&basis, &cancellation);
    tokio::pin!(run);
    let control = async {
        while script.sends.load(Ordering::SeqCst) == 0 {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        let started = Instant::now();
        let pause = TaskCommand {
            context: None,
            key: "work-pause".into(),
            kind: CommandKind::Pause,
            task_id: Some(case.receipt.task_id.clone()),
            cycle_id: Some(case.receipt.cycle_id.clone()),
            content: None,
        };
        // The control is admitted while the provider stalls.
        f.tasks
            .admit("actor-a", &selected("a"), &pause)
            .await
            .unwrap();
        assert!(
            started.elapsed() < Duration::from_secs(2),
            "control waited for the model"
        );
        // The executor's existing authority poll observes the fence and cancels.
        assert!(!f.tasks.current(&basis).await.unwrap());
        cancellation.cancel();
        started
    };
    let (end, started) = tokio::join!(&mut run, control);
    assert!(matches!(end, CycleEnd::Fenced | CycleEnd::Failed));
    assert!(
        started.elapsed() < Duration::from_secs(3),
        "stalled call was not cancelled promptly"
    );
    let snapshot = f
        .tasks
        .get("actor-a", &selected("a"), &case.receipt.task_id)
        .await
        .unwrap();
    assert_eq!(snapshot.state, TaskState::Paused);
    assert_eq!(
        snapshot.cessation,
        Cessation::Pending,
        "Pausing until quiescence is observed"
    );
    finish(f, &case, &attempt, Observation::Cancelled).await;
    let snapshot = f
        .tasks
        .get("actor-a", &selected("a"), &case.receipt.task_id)
        .await
        .unwrap();
    assert_eq!(
        (snapshot.state, snapshot.cessation),
        (TaskState::Paused, Cessation::Confirmed)
    );
}

async fn restart_recovery(
    f: &Fixture,
    h: &Harness,
    hang: &Arc<AtomicBool>,
    admin: &mut PgConnection,
) {
    // Mid-turn: the producer dies after the disclosure cutoff.
    let (case, basis, _lost) = consumed(f, "work-restart-turn").await;
    let script = Script::new(vec![Turn::Hang]);
    {
        let work = h.work(f, &script, hang);
        let cancellation = ModelCancellation::new();
        let run = work.run(&basis, &cancellation);
        tokio::pin!(run);
        tokio::select! {
            _ = &mut run => panic!("hung turn returned"),
            _ = async { while script.sends.load(Ordering::SeqCst) == 0 { tokio::time::sleep(Duration::from_millis(5)).await; } } => {},
        }
        // Dropping the future is the abrupt loss of the producing process.
    }
    sqlx::query(
        "UPDATE public.tasks SET owner_until=clock_timestamp()-interval '1 second' WHERE id=$1",
    )
    .bind(&case.receipt.task_id)
    .execute(&mut *admin)
    .await
    .unwrap();
    let replacement = execution(
        f.tasks
            .coordinate(&route(&case.receipt), "work-replacement")
            .await
            .unwrap(),
    );
    assert_eq!(replacement.execution_epoch, basis.execution_epoch);
    let replacement_attempt = f.tasks.consume(&replacement).await.unwrap();
    let retry = Script::new(vec![]);
    let end = h
        .work(f, &retry, hang)
        .run(&replacement, &ModelCancellation::new())
        .await;
    assert_eq!(
        end,
        CycleEnd::Failed,
        "an unknown possibly accepted turn is a recorded fact"
    );
    assert_eq!(
        retry.sends.load(Ordering::SeqCst),
        0,
        "the same invocation key recovered without resending"
    );
    let work = f
        .tasks
        .work("actor-a", &selected("a"), &case.receipt.task_id)
        .await
        .unwrap();
    assert_eq!(work.steps.len(), 1);
    assert_eq!(work.steps[0].status, StepStatus::Failed);
    let invocations: i64 =
        sqlx::query_scalar("SELECT count(*) FROM public.model_invocations WHERE task_id=$1")
            .bind(&case.receipt.task_id)
            .fetch_one(&mut *admin)
            .await
            .unwrap();
    assert_eq!(invocations, 1);
    finish(f, &case, &replacement_attempt, Observation::Completed).await;
    let work = f
        .tasks
        .work("actor-a", &selected("a"), &case.receipt.task_id)
        .await
        .unwrap();
    assert_eq!(work.attention, Some(Attention::StepFailed));

    // Mid-tool: the producer dies after consumption. No replay; reconciliation.
    let (case, basis, _lost) = consumed(f, "work-restart-tool").await;
    let script = Script::new(vec![Turn::Tool("lost-call", "send_exact")]);
    hang.store(true, Ordering::SeqCst);
    {
        let work = h.work(f, &script, hang);
        let cancellation = ModelCancellation::new();
        let run = work.run(&basis, &cancellation);
        let consumed_attempt = async {
            loop {
                let n: i64 = sqlx::query_scalar("SELECT count(*) FROM public.operation_claims c JOIN public.operations o ON o.id=c.operation_id WHERE o.task_id=$1 AND c.state='consumed'")
                    .bind(&case.receipt.task_id).fetch_one(&mut *admin).await.unwrap();
                if n == 1 {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        };
        tokio::select! {
            _ = run => panic!("lost dispatch returned"),
            _ = consumed_attempt => {},
        }
    }
    hang.store(false, Ordering::SeqCst);
    sqlx::query(
        "UPDATE public.tasks SET owner_until=clock_timestamp()-interval '1 second' WHERE id=$1",
    )
    .bind(&case.receipt.task_id)
    .execute(&mut *admin)
    .await
    .unwrap();
    assert_eq!(
        f.tasks
            .coordinate(&route(&case.receipt), "work-replacement")
            .await
            .unwrap(),
        Decision::Waiting,
        "a consumed attempt with unknown effect is never replayed"
    );
    let snapshot = f
        .tasks
        .get("actor-a", &selected("a"), &case.receipt.task_id)
        .await
        .unwrap();
    assert_eq!(snapshot.cessation, Cessation::ReconciliationRequired);
    let attempts: i64 = sqlx::query_scalar("SELECT count(*) FROM public.operation_attempts a JOIN public.operations o ON o.id=a.operation_id WHERE o.task_id=$1")
        .bind(&case.receipt.task_id).fetch_one(&mut *admin).await.unwrap();
    assert_eq!(attempts, 1);
}

async fn expire_owner(case: &Case, admin: &mut PgConnection) {
    sqlx::query(
        "UPDATE public.tasks SET owner_until=clock_timestamp()-interval '1 second' WHERE id=$1",
    )
    .bind(&case.receipt.task_id)
    .execute(&mut *admin)
    .await
    .unwrap();
}
async fn task_attempts(case: &Case, admin: &mut PgConnection) -> i64 {
    sqlx::query_scalar("SELECT count(*) FROM public.operation_attempts a JOIN public.operations o ON o.id=a.operation_id WHERE o.task_id=$1")
        .bind(&case.receipt.task_id).fetch_one(&mut *admin).await.unwrap()
}

/// The producer dies after the source confirmed completion and the receipt was
/// recorded, but before the tool step fact. The replacement must record the
/// completed attempt as Completed with its fact and owned history, never as a
/// refusal and never by sending again.
async fn completed_before_restart(
    f: &Fixture,
    h: &Harness,
    hang: &Arc<AtomicBool>,
    admin: &mut PgConnection,
) {
    let (case, basis, _lost) = consumed(f, "work-completed-restart").await;
    let script = Script::new(vec![Turn::Tool("done-call", "send_exact")]);
    h.hang_after_observe.store(true, Ordering::SeqCst);
    let before = h.dispatches.load(Ordering::SeqCst);
    {
        let work = h.work(f, &script, hang);
        let cancellation = ModelCancellation::new();
        let run = work.run(&basis, &cancellation);
        let observed = async {
            loop {
                let n: i64 = sqlx::query_scalar("SELECT count(*) FROM public.operation_receipts r JOIN public.operation_attempts a ON a.id=r.attempt_id JOIN public.operations o ON o.id=a.operation_id WHERE o.task_id=$1")
                    .bind(&case.receipt.task_id).fetch_one(&mut *admin).await.unwrap();
                if n >= 1 {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        };
        tokio::select! {
            _ = run => panic!("lost producer returned"),
            _ = observed => {},
        }
    }
    h.hang_after_observe.store(false, Ordering::SeqCst);
    assert_eq!(h.dispatches.load(Ordering::SeqCst), before + 1);
    let lost = f
        .tasks
        .work("actor-a", &selected("a"), &case.receipt.task_id)
        .await
        .unwrap();
    assert_eq!(
        lost.steps
            .iter()
            .map(|s| (s.kind, s.status))
            .collect::<Vec<_>>(),
        vec![(StepKind::ModelTurn, StepStatus::Proposed)],
        "the tool step fact was not written before the loss"
    );
    expire_owner(&case, &mut *admin).await;
    let replacement = execution(
        f.tasks
            .coordinate(&route(&case.receipt), "work-completed-replacement")
            .await
            .unwrap(),
    );
    let replacement_attempt = f.tasks.consume(&replacement).await.unwrap();
    let retry = Script::new(vec![Turn::Text("Completed result considered.")]);
    let end = h
        .work(f, &retry, hang)
        .run(&replacement, &ModelCancellation::new())
        .await;
    assert_eq!(end, CycleEnd::Waiting);
    assert_eq!(
        h.dispatches.load(Ordering::SeqCst),
        before + 1,
        "the completed operation was not dispatched again"
    );
    assert_eq!(task_attempts(&case, &mut *admin).await, 1);
    let work = f
        .tasks
        .work("actor-a", &selected("a"), &case.receipt.task_id)
        .await
        .unwrap();
    assert_eq!(
        work.steps
            .iter()
            .map(|s| (s.kind, s.status))
            .collect::<Vec<_>>(),
        vec![
            (StepKind::ModelTurn, StepStatus::Proposed),
            (StepKind::ToolStep, StepStatus::Completed),
            (StepKind::ModelTurn, StepStatus::Responded),
        ],
        "a completed operation is never recorded as refused"
    );
    let tool = &work.steps[1];
    assert_eq!(tool.fact, Some(SourceFact::Completed));
    let attempt_id: String = sqlx::query_scalar("SELECT a.id FROM public.operation_attempts a JOIN public.operations o ON o.id=a.operation_id WHERE o.task_id=$1")
        .bind(&case.receipt.task_id).fetch_one(&mut *admin).await.unwrap();
    assert_eq!(tool.attempt_id.as_deref(), Some(attempt_id.as_str()));
    let next = h
        .repo
        .get(
            "actor-a",
            &selected("a"),
            work.steps[2].invocation_id.as_ref().unwrap(),
        )
        .await
        .unwrap();
    assert!(
        matches!(&next.request.history[..], [HistoryItem::ToolExchange(e)] if e.result.attempt_id == attempt_id && e.result.fact == SourceFact::Completed),
        "the completed exchange is rebuilt into owned history"
    );
    finish(f, &case, &replacement_attempt, Observation::Completed).await;
}

/// Guidance received after tool admission and before consumption fences the
/// consumption. Nothing is consumed; the fact says superseded, not refused.
async fn fenced_after_admission(
    f: &Fixture,
    h: &Harness,
    hang: &Arc<AtomicBool>,
    admin: &mut PgConnection,
) {
    let (case, basis, attempt) = consumed(f, "work-fenced-admission").await;
    *h.before_consume.lock().unwrap() = Some((
        f.tasks.clone(),
        guide(
            "work-fenced-guide",
            &case,
            "Changed direction before the send",
        ),
    ));
    let script = Script::new(vec![
        Turn::Tool("fenced-call", "send_exact"),
        Turn::Text("Reconsidered after the fence."),
    ]);
    let end = h
        .work(f, &script, hang)
        .run(&basis, &ModelCancellation::new())
        .await;
    assert_eq!(end, CycleEnd::Waiting);
    assert!(h.before_consume.lock().unwrap().is_none());
    let work = f
        .tasks
        .work("actor-a", &selected("a"), &case.receipt.task_id)
        .await
        .unwrap();
    assert_eq!(
        work.steps
            .iter()
            .map(|s| (s.kind, s.status))
            .collect::<Vec<_>>(),
        vec![
            (StepKind::ModelTurn, StepStatus::Proposed),
            (StepKind::ToolStep, StepStatus::Superseded),
            (StepKind::ModelTurn, StepStatus::Responded),
        ]
    );
    assert!(work.steps[1].operation_id.is_some(), "it had been admitted");
    assert_eq!(work.steps[1].attempt_id, None);
    assert_eq!(
        task_attempts(&case, &mut *admin).await,
        0,
        "nothing consumed"
    );
    assert!(
        script
            .briefs
            .lock()
            .unwrap()
            .last()
            .unwrap()
            .contains("Changed direction")
    );
    finish(f, &case, &attempt, Observation::Completed).await;
}

/// A completed tool exchange produced under an earlier applied intent remains
/// exact owned history after new guidance; the stale turn is described by its
/// fixed catalogue names only and never replayed.
async fn guide_after_completed_tool(f: &Fixture, h: &Harness, hang: &Arc<AtomicBool>) {
    let (case, basis, attempt) = consumed(f, "work-guide-after-tool").await;
    let release = Arc::new(Notify::new());
    let script = Script::new(vec![
        Turn::Tool("history-call", "send_exact"),
        Turn::Stall(
            release.clone(),
            Box::new(Turn::Tool("stale-history-call", "send_exact")),
        ),
        Turn::Text("Continued under the new brief with earlier results."),
    ]);
    let work = h.work(f, &script, hang);
    let cancellation = ModelCancellation::new();
    let run = work.run(&basis, &cancellation);
    let guidance = async {
        while script.sends.load(Ordering::SeqCst) < 2 {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        f.tasks
            .admit(
                "actor-a",
                &selected("a"),
                &guide(
                    "work-guide-after-tool-guide",
                    &case,
                    "Newer direction after the tool",
                ),
            )
            .await
            .unwrap();
        release.notify_one();
    };
    let (end, ()) = tokio::join!(run, guidance);
    assert_eq!(end, CycleEnd::Waiting);
    let work = f
        .tasks
        .work("actor-a", &selected("a"), &case.receipt.task_id)
        .await
        .unwrap();
    assert_eq!(
        work.steps
            .iter()
            .map(|s| (s.kind, s.status))
            .collect::<Vec<_>>(),
        vec![
            (StepKind::ModelTurn, StepStatus::Proposed),
            (StepKind::ToolStep, StepStatus::Completed),
            (StepKind::ModelTurn, StepStatus::Superseded),
            (StepKind::ModelTurn, StepStatus::Responded),
        ]
    );
    let last = script.requests.lock().unwrap()[2].clone();
    assert!(
        matches!(&last.history[..], [HistoryItem::ToolExchange(e)] if Some(&e.result.attempt_id) == work.steps[1].attempt_id.as_ref()),
        "the earlier-intent completed exchange remains exact history"
    );
    assert!(
        last.messages
            .iter()
            .any(|m| m.text.contains("Newer direction"))
    );
    assert!(
        last.messages
            .iter()
            .any(|m| m.text.starts_with("Earlier proposals were superseded")
                && m.text.contains("send_exact")),
        "the superseded turn is described by catalogue names only"
    );
    assert!(
        !last
            .messages
            .iter()
            .any(|m| m.text.contains("stale-history-call"))
    );
    finish(f, &case, &attempt, Observation::Completed).await;
}

fn disclosed(request: &ModelRequest, marker: &str) -> bool {
    request.messages.iter().any(|m| m.text.contains(marker))
}

/// Context carries the Task's current authorised knowledge with exact
/// references, checked again at disclosure. A record withdrawn before a turn
/// is excluded from that turn and never disclosed.
async fn knowledge_context(f: &Fixture, h: &Harness, hang: &Arc<AtomicBool>, session: &str) {
    let knowledge = KnowledgeRepository::new(f.pool.clone()).with_session_hash(session.into());
    let (case, basis, attempt) = consumed(f, "work-knowledge").await;
    let task = &case.receipt.task_id;
    let assert = async |key: &str, text: &str, expected: u64| {
        let result = knowledge
            .mutate(
                "actor-a",
                &selected("a"),
                task,
                &KnowledgeCommand {
                    key: key.into(),
                    expected_revision: expected,
                    action: KnowledgeAction::Assert {
                        assertion: Assertion {
                            text: text.into(),
                            period: Period::default(),
                            uncertainty: Some("Attributed synthetic assertion".into()),
                            dependencies: vec![],
                        },
                    },
                },
            )
            .await
            .unwrap();
        let record = result.record.unwrap().record;
        (
            RecordReference {
                id: record.id,
                revision: record.revision,
            },
            result.revision,
        )
    };
    let forget = async |key: &str, target: &RecordReference, expected: u64| {
        knowledge
            .mutate(
                "actor-a",
                &selected("a"),
                task,
                &KnowledgeCommand {
                    key: key.into(),
                    expected_revision: expected,
                    action: KnowledgeAction::Forget {
                        target: target.clone(),
                        reason: "Withdraw from current use".into(),
                    },
                },
            )
            .await
            .unwrap()
            .revision
    };
    let page = knowledge
        .inspect("actor-a", &selected("a"), task, &KnowledgeQuery::default())
        .await
        .unwrap();
    let (kept, revision) = assert(
        "work-knowledge-keep",
        "Synthetic fact KN-KEEP-7731",
        page.revision,
    )
    .await;
    let (gone, revision) = assert(
        "work-knowledge-gone",
        "Synthetic fact KN-GONE-4410",
        revision,
    )
    .await;
    // Revoked before the first turn: excluded from that turn's context.
    let revision = forget("work-knowledge-forget-gone", &gone, revision).await;
    let script = Script::new(vec![Turn::Text("Considered the verified knowledge.")]);
    let end = h
        .work(f, &script, hang)
        .run(&basis, &ModelCancellation::new())
        .await;
    assert_eq!(end, CycleEnd::Waiting);
    let sent = script.requests.lock().unwrap()[0].clone();
    assert!(
        disclosed(&sent, "KN-KEEP-7731"),
        "current knowledge is context"
    );
    assert!(
        !disclosed(&sent, "KN-GONE-4410"),
        "withdrawn knowledge is never disclosed"
    );
    assert!(
        sent.context
            .verification
            .items
            .iter()
            .any(|v| v.id == kept.id
                && v.revision == kept.revision
                && v.status == RecordStatus::Current),
        "the exact reference is verified at disclosure"
    );
    assert!(
        !sent
            .context
            .verification
            .items
            .iter()
            .any(|v| v.id == gone.id)
    );
    assert!(
        sent.context
            .entries
            .iter()
            .any(|e| e.knowledge.as_ref() == Some(&kept))
    );
    // The persisted invocation carries the same exact references.
    let work = f.tasks.work("actor-a", &selected("a"), task).await.unwrap();
    let stored = h
        .repo
        .get(
            "actor-a",
            &selected("a"),
            work.steps[0].invocation_id.as_ref().unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        stored.request.context.verification,
        sent.context.verification
    );
    finish(f, &case, &attempt, Observation::Completed).await;

    // Revoked before the next turn of another Task in the engagement: excluded.
    forget("work-knowledge-forget-keep", &kept, revision).await;
    let (case, basis, attempt) = consumed(f, "work-knowledge-after").await;
    let script = Script::new(vec![Turn::Text("No withdrawn knowledge.")]);
    let end = h
        .work(f, &script, hang)
        .run(&basis, &ModelCancellation::new())
        .await;
    assert_eq!(end, CycleEnd::Waiting);
    let sent = script.requests.lock().unwrap()[0].clone();
    assert!(!disclosed(&sent, "KN-KEEP-7731"));
    assert!(!disclosed(&sent, "KN-GONE-4410"));
    assert!(
        !sent
            .context
            .verification
            .items
            .iter()
            .any(|v| v.id == kept.id || v.id == gone.id)
    );
    finish(f, &case, &attempt, Observation::Completed).await;
}

async fn routing(f: &Fixture, admin: &mut PgConnection) {
    let b = selected("b");
    let tasks = &f.tasks;
    let create = |key: &str| TaskCommand {
        context: None,
        key: key.into(),
        kind: CommandKind::Create,
        task_id: None,
        cycle_id: None,
        content: Some(format!("Routing objective {key}")),
    };
    assert_eq!(
        tasks
            .direct("actor-b", &b, "route-none", "Look at payroll")
            .await,
        Err(TaskError::Conflict),
        "no Task to receive untargeted guidance"
    );
    let one = tasks
        .admit("actor-b", &b, &create("route-one"))
        .await
        .unwrap();
    let routed = tasks
        .direct("actor-b", &b, "route-single", "Look at payroll")
        .await
        .unwrap();
    let Direction::Routed(receipt) = &routed else {
        panic!("single candidate must route")
    };
    assert_eq!(
        receipt.task_id, one.task_id,
        "the receipt names the target Task"
    );
    assert_eq!(
        tasks
            .direct("actor-b", &b, "route-single", "Look at payroll")
            .await
            .unwrap(),
        routed
    );
    assert_eq!(
        tasks
            .direct("actor-b", &b, "route-single", "Different text")
            .await,
        Err(TaskError::Conflict)
    );
    let two = tasks
        .admit("actor-b", &b, &create("route-two"))
        .await
        .unwrap();
    let asked = tasks
        .direct("actor-b", &b, "route-ambiguous", "Check the sample")
        .await
        .unwrap();
    let Direction::Asked(question) = asked.clone() else {
        panic!("two candidates must ask")
    };
    let mut ids = vec![one.task_id.clone(), two.task_id.clone()];
    ids.sort();
    assert_eq!(
        question
            .candidates
            .iter()
            .map(|c| c.task_id.clone())
            .collect::<Vec<_>>(),
        ids
    );
    assert_eq!(question.answer, None);
    let guides: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM public.task_commands WHERE content='Check the sample'",
    )
    .fetch_one(&mut *admin)
    .await
    .unwrap();
    assert_eq!(guides, 0, "nothing is applied before the targeting answer");
    assert_eq!(
        tasks
            .direct("actor-b", &b, "route-ambiguous", "Check the sample")
            .await
            .unwrap(),
        asked
    );
    // Foreign Task IDs and another author refuse.
    assert_eq!(
        tasks
            .answer("actor-b", &b, &question.id, &["foreign-task".into()])
            .await,
        Err(TaskError::Conflict)
    );
    assert!(
        tasks
            .answer("actor-a", &selected("a"), &question.id, &ids)
            .await
            .is_err()
    );
    let answered = tasks
        .answer("actor-b", &b, &question.id, &ids)
        .await
        .unwrap();
    let guides = answered.answer.clone().unwrap();
    assert_eq!(guides.len(), 2, "one Guide per selected target");
    for guide in &guides {
        let key: String =
            sqlx::query_scalar("SELECT idempotency_key FROM public.task_commands WHERE id=$1")
                .bind(&guide.command_id)
                .fetch_one(&mut *admin)
                .await
                .unwrap();
        assert_eq!(key, routed_guide_key("route-ambiguous", &guide.task_id));
    }
    assert_eq!(
        tasks
            .answer("actor-b", &b, &question.id, &ids)
            .await
            .unwrap()
            .answer,
        answered.answer,
        "retry creates no duplicates"
    );
    assert_eq!(
        tasks.answer("actor-b", &b, &question.id, &ids[..1]).await,
        Err(TaskError::Conflict)
    );
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM public.task_commands WHERE content='Check the sample'",
    )
    .fetch_one(&mut *admin)
    .await
    .unwrap();
    assert_eq!(count, 2);
    assert_eq!(tasks.questions("actor-b", &b).await.unwrap()[0], answered);
    // A stale candidate (stopped since the question) refuses the answer.
    let asked = tasks
        .direct("actor-b", &b, "route-stale", "Recheck controls")
        .await
        .unwrap();
    let Direction::Asked(stale) = asked else {
        panic!("expected a question")
    };
    let stop = TaskCommand {
        context: None,
        key: "route-stop".into(),
        kind: CommandKind::Stop,
        task_id: Some(two.task_id.clone()),
        cycle_id: Some(two.cycle_id.clone()),
        content: None,
    };
    tasks.admit("actor-b", &b, &stop).await.unwrap();
    assert_eq!(
        tasks
            .answer("actor-b", &b, &stale.id, std::slice::from_ref(&two.task_id))
            .await,
        Err(TaskError::Conflict)
    );
    assert!(
        tasks
            .answer("actor-b", &b, &stale.id, std::slice::from_ref(&one.task_id))
            .await
            .is_ok()
    );
}
