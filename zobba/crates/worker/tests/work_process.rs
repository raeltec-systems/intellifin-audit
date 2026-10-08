//! Story 22.2 worker proof: the real coordinator, executor authority poll,
//! native loopback transport and PostgreSQL. The provider stalls so Pause and
//! restart are exercised while a model call is genuinely in flight.
//!
//! The OS-level restart proof re-executes this test executable as a separate
//! worker process (the ignored helper below) and SIGKILLs it mid-turn and,
//! separately, mid-tool. The production `zobba-worker` binary deliberately
//! composes no qualification source and has no fixture flag, so model work can
//! only be composed by a test process; the killed and replacement processes
//! run the production `coordinate_work` path against the real database.
use sha2::{Digest, Sha256};
use sqlx::{Connection, Executor, PgConnection, postgres::PgPoolOptions};
use std::{
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    process::{Child, Command},
};
use zobba_application::{
    model::{
        ArgumentSchema, CancellationSemantics, Capabilities, Effect, IdempotencySemantics,
        ModelProfile, ModelQualificationSource, OutputCompleteness, Provider, Qualification,
        ReconciliationSemantics, ToolCatalog, ToolDescriptor,
    },
    operation::OperationStore,
    task::TaskCommands,
};
use zobba_domain::{
    identity::Scope,
    model::{JsonValue, operation_arguments},
    permissions::{
        AccountRestriction, Action, Attachment, AuthoritySnapshot, CanonicalOperation,
        EnvironmentKind, PermissionBounds, PermissionRule, PolicyDocument, PolicyKind, Purpose,
        ReadRestriction, SourceBinding, SourceFact,
    },
    task::{Cessation, CommandKind, CommandReceipt, TaskCommand, TaskState},
    work::{Attention, StepKind, StepStatus, TurnConfiguration, invocation_key},
};
use zobba_infrastructure::{
    RuntimeDatabase, database_options,
    fixture::seed_local_configured,
    identity::{IdentityRepository, secret_hash},
    migrate,
    model::{ModelRepository, native::NativeAdapter},
    operation::OperationRepository,
    task::TaskRepository,
};
use zobba_worker::{executor, gateway::Gateway, work::Composition};

#[path = "../../infrastructure/tests/support/mod.rs"]
mod support;

fn scope() -> Scope {
    Scope {
        organisation_id: "org-a".into(),
        client_id: "client-a".into(),
        engagement_id: "engagement-a".into(),
    }
}
fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}
struct Fixture;
impl ModelQualificationSource for Fixture {
    fn qualified(&self, p: &ModelProfile) -> bool {
        p.qualification == Qualification::Fixture
            && p.account_id == "fixture-account"
            && p.destination == "fixture-destination"
    }
}
fn disclosure() -> CanonicalOperation {
    let material = "Synthetic model processing";
    CanonicalOperation {
        version: 1,
        purpose: Purpose::AuditCoordination,
        action: Action::Send,
        account_id: "fixture-account".into(),
        environment_id: "audit-environment".into(),
        destination: "fixture-destination".into(),
        recipients: vec!["recipient-a".into()],
        material: material.into(),
        material_digest: format!("{:x}", Sha256::digest(material.as_bytes())),
        attachments: vec![Attachment {
            id: "attachment".into(),
            digest: "a".repeat(64),
            classification: "audit".into(),
        }],
        resource_id: "audit-resource".into(),
        resource_version: "resource-v1".into(),
        expires_at: 4_102_444_800,
    }
}
fn policy(kind: PolicyKind, subject: &str) -> PolicyDocument {
    let r = disclosure();
    let bounds = PermissionBounds {
        rules: vec![PermissionRule {
            purpose: r.purpose,
            action: r.action,
            account_id: r.account_id.clone(),
            environment_id: r.environment_id.clone(),
            destination: r.destination.clone(),
            resource_id: r.resource_id.clone(),
            recipients: r.recipients.clone(),
            attachment_classifications: vec!["audit".into()],
            expires_at: r.expires_at,
        }],
    };
    PolicyDocument {
        schema_version: 1,
        kind,
        subject_id: subject.into(),
        version: 1,
        actor_id: "actor-manager".into(),
        created_at: now(),
        revoked: false,
        hard: bounds.clone(),
        standing: bounds,
        parent: None,
        account: (kind == PolicyKind::Account).then(|| AccountRestriction {
            source: SourceBinding {
                source_id: "fixture-source".into(),
                ledger_id: "fixture-ledger".into(),
                endpoint_digest: "a".repeat(64),
                contract_version: 1,
            },
            account_id: "fixture-account".into(),
            environment_id: "audit-environment".into(),
            environment: EnvironmentKind::Audit,
            read_restriction: ReadRestriction::None,
            restriction_survives_takeover: false,
            test_environment_verified: false,
            test_resources: vec![],
            test_cleanup_id: None,
            audit_resources: vec!["audit-resource".into()],
        }),
    }
}

/// A loopback endpoint that accepts each request and never answers, or (with
/// a reply) answers every request with that exact response.
struct Stall {
    address: std::net::SocketAddr,
    endpoint: String,
    sends: Arc<AtomicUsize>,
    bodies: Arc<std::sync::Mutex<Vec<String>>>,
    _task: tokio::task::JoinHandle<()>,
}
impl Stall {
    async fn start() -> Self {
        Self::answering(vec![]).await
    }
    /// Serve `replies` in order (the last repeats); with none, hold every
    /// request open. An owned-source lookup is answered from the request's own
    /// exact identities with an authoritative completion.
    async fn answering(replies: Vec<Vec<u8>>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let endpoint = format!("http://{address}/native");
        let sends = Arc::new(AtomicUsize::new(0));
        let bodies = Arc::new(std::sync::Mutex::new(Vec::new()));
        let count = sends.clone();
        let seen = bodies.clone();
        let task = tokio::spawn(async move {
            let mut held = Vec::new();
            loop {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut buffer = vec![0u8; 1 << 20];
                let mut total = 0;
                let mut lookup = false;
                // Read the complete request before counting it as sent.
                loop {
                    let n = socket.read(&mut buffer[total..]).await.unwrap_or(0);
                    if n == 0 {
                        break;
                    }
                    total += n;
                    let text = String::from_utf8_lossy(&buffer[..total]);
                    if let Some(end) = text.find("\r\n\r\n") {
                        let length = text[..end]
                            .lines()
                            .find_map(|l| {
                                l.to_ascii_lowercase()
                                    .strip_prefix("content-length: ")
                                    .and_then(|v| v.parse::<usize>().ok())
                            })
                            .unwrap_or(0);
                        if total >= end + 4 + length {
                            lookup = text[..end].starts_with("POST /v1/operations/lookup");
                            seen.lock().unwrap().push(
                                String::from_utf8_lossy(&buffer[end + 4..end + 4 + length])
                                    .into_owned(),
                            );
                            count.fetch_add(1, Ordering::SeqCst);
                            break;
                        }
                    }
                }
                if lookup {
                    let body = seen.lock().unwrap().last().cloned().unwrap();
                    let request: serde_json::Value = serde_json::from_str(&body).unwrap();
                    let answer = serde_json::json!({
                        "source": request["source"],
                        "operation_id": request["operation_id"],
                        "attempt_id": request["attempt_id"],
                        "fingerprint": request["fingerprint"],
                        "outcome": "completed",
                    })
                    .to_string();
                    let reply = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{answer}",
                        answer.len()
                    );
                    let _ = socket.write_all(reply.as_bytes()).await;
                    let _ = socket.shutdown().await;
                } else if let Some(reply) = replies
                    .get(count.load(Ordering::SeqCst) - 1)
                    .or(replies.last())
                {
                    let _ = socket.write_all(reply).await;
                    let _ = socket.shutdown().await;
                } else {
                    held.push(socket);
                }
            }
        });
        Self {
            address,
            endpoint,
            sends,
            bodies,
            _task: task,
        }
    }
    /// Owned-source dispatches carry the canonical request; lookups do not.
    fn dispatches(&self) -> usize {
        self.bodies
            .lock()
            .unwrap()
            .iter()
            .filter(|body| body.contains("\"canonical_request\""))
            .count()
    }
}

fn json(value: &JsonValue) -> serde_json::Value {
    match value {
        JsonValue::Null => serde_json::Value::Null,
        JsonValue::Bool(v) => serde_json::Value::Bool(*v),
        JsonValue::Integer(v) => serde_json::Value::Number((*v).into()),
        JsonValue::String(v) => serde_json::Value::String(v.clone()),
        JsonValue::Array(v) => serde_json::Value::Array(v.iter().map(json).collect()),
        JsonValue::Object(v) => {
            serde_json::Value::Object(v.iter().map(|(k, v)| (k.clone(), json(v))).collect())
        }
    }
}

fn sse_reply(mut values: Vec<serde_json::Value>) -> Vec<u8> {
    for (sequence, value) in values.iter_mut().enumerate() {
        value["sequence_number"] = serde_json::json!(sequence);
    }
    let body: String = values
        .iter()
        .map(|v| {
            format!(
                "event: {}\r\ndata: {v}\r\n\r\n",
                v["type"].as_str().unwrap()
            )
        })
        .collect();
    format!(
        "HTTP/1.1 200 Fixture\r\nContent-Type: text/event-stream; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
    .into_bytes()
}

/// A native OpenAI-format streamed text answer with no tool proposal.
fn text_reply(text: &str) -> Vec<u8> {
    use serde_json::json;
    let part = json!({"type":"output_text","text":text});
    let item = json!({"id":"message-1","type":"message","role":"assistant","status":"completed","content":[part.clone()]});
    sse_reply(vec![
        json!({"type":"response.created","response":{"id":"response-2","model":"fixture-model","status":"in_progress"}}),
        json!({"type":"response.output_item.added","output_index":0,"item":{"id":"message-1","type":"message","role":"assistant","status":"in_progress","content":[]}}),
        json!({"type":"response.content_part.added","output_index":0,"item_id":"message-1","content_index":0,"part":{"type":"output_text","text":""}}),
        json!({"type":"response.output_text.delta","output_index":0,"item_id":"message-1","content_index":0,"delta":text}),
        json!({"type":"response.output_text.done","output_index":0,"item_id":"message-1","content_index":0,"text":text}),
        json!({"type":"response.content_part.done","output_index":0,"item_id":"message-1","content_index":0,"part":part}),
        json!({"type":"response.output_item.done","output_index":0,"item":item.clone()}),
        json!({"type":"response.completed","response":{"id":"response-2","model":"fixture-model","status":"completed","output":[item],"usage":{"input_tokens":17,"output_tokens":4}}}),
    ])
}

/// A native OpenAI-format streamed response proposing the catalogue tool.
fn tool_reply() -> Vec<u8> {
    use serde_json::json;
    let arguments = json(&operation_arguments(&disclosure())).to_string();
    let item = json!({"id":"item-1","type":"function_call","call_id":"call-1","name":"send_exact","arguments":arguments,"status":"completed"});
    sse_reply(vec![
        json!({"type":"response.created","response":{"id":"response-1","model":"fixture-model","status":"in_progress"}}),
        json!({"type":"response.output_item.added","output_index":0,"item":{"id":"item-1","type":"function_call","call_id":"call-1","name":"send_exact","arguments":"","status":"in_progress"}}),
        json!({"type":"response.function_call_arguments.delta","output_index":0,"item_id":"item-1","delta":arguments}),
        json!({"type":"response.function_call_arguments.done","output_index":0,"item_id":"item-1","arguments":arguments,"name":"send_exact"}),
        json!({"type":"response.output_item.done","output_index":0,"item":item.clone()}),
        json!({"type":"response.completed","response":{"id":"response-1","model":"fixture-model","status":"completed","output":[item],"usage":{"input_tokens":17,"output_tokens":4}}}),
    ])
}

fn source_binding(address: std::net::SocketAddr) -> SourceBinding {
    SourceBinding {
        source_id: "fixture-source".into(),
        ledger_id: "fixture-ledger".into(),
        endpoint_digest: format!("{:x}", Sha256::digest(address.to_string().as_bytes())),
        contract_version: 1,
    }
}

/// Trusted fixture composition: qualification, loopback transport and the
/// owned gateway. Shared by the in-process coordinator and the helper process.
fn composition(
    pool: sqlx::PgPool,
    provider: &str,
    source: std::net::SocketAddr,
) -> Arc<dyn zobba_worker::work::WorkRunner> {
    Arc::new(Composition {
        pool,
        qualifications: Arc::new(Fixture),
        transport: Arc::new(
            NativeAdapter::test_loopback(Provider::OpenAi, provider, Duration::from_secs(60))
                .unwrap(),
        ),
        gateway: Gateway::qualification(source, source_binding(source)).unwrap(),
        disclosure: disclosure(),
        input_class: "audit".into(),
        max_output_tokens: 128,
        context: zobba_domain::context::ContextBudget::DEFAULT,
    })
}

/// Spawned explicitly by the OS-level restart proof. It runs the production
/// `coordinate_work` with the fixture composition until SIGTERM or SIGKILL.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "test-only worker subprocess; the parent supplies guarded configuration"]
async fn work_worker_helper() {
    let configuration = support::Configuration::from_environment();
    let provider = std::env::var("ZOBBA_WORK_TEST_PROVIDER").unwrap();
    let source: std::net::SocketAddr = std::env::var("ZOBBA_WORK_TEST_SOURCE")
        .unwrap()
        .parse()
        .unwrap();
    let database = RuntimeDatabase::connect(&configuration.runtime)
        .await
        .unwrap();
    let runner = composition(database.pool().clone(), &provider, source);
    let (shutdown, receiver) = tokio::sync::watch::channel(false);
    let mut terminate =
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).unwrap();
    tokio::spawn(async move {
        terminate.recv().await;
        let _ = shutdown.send(true);
    });
    let config = executor::Config::new(std::path::PathBuf::from("/bin/false"), 10).unwrap();
    zobba_worker::coordinate_work(database, config, runner, receiver).await;
}

fn helper(configuration: &support::Configuration, provider: &str, source: &str) -> Child {
    Command::new(std::env::current_exe().unwrap())
        .args(["--ignored", "--exact", "work_worker_helper", "--nocapture"])
        .env_clear()
        .env(
            "ZOBBA_TEST_MIGRATION_DATABASE_URL",
            &configuration.migration,
        )
        .env("ZOBBA_TEST_RUNTIME_DATABASE_URL", &configuration.runtime)
        .env("ZOBBA_TEST_ADMIN_DATABASE_URL", &configuration.admin)
        .env("ZOBBA_WORK_TEST_PROVIDER", provider)
        .env("ZOBBA_WORK_TEST_SOURCE", source)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::inherit())
        .kill_on_drop(true)
        .spawn()
        .unwrap()
}

/// SIGKILL: the abrupt loss of the producing worker process.
async fn kill(child: &mut Child) {
    child.start_kill().unwrap();
    let status = tokio::time::timeout(Duration::from_secs(10), child.wait())
        .await
        .expect("killed worker exits")
        .unwrap();
    assert!(!status.success(), "the worker was killed, not drained");
}

async fn terminate(child: &mut Child) {
    let status = Command::new("/bin/kill")
        .arg("-TERM")
        .arg(child.id().unwrap().to_string())
        .status()
        .await
        .unwrap();
    assert!(status.success());
    let _ = tokio::time::timeout(Duration::from_secs(15), child.wait()).await;
}

async fn eventually<T>(mut check: impl AsyncFnMut() -> Option<T>) -> T {
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        if let Some(value) = check().await {
            return value;
        }
        assert!(
            Instant::now() < deadline,
            "work condition did not become true"
        );
        tokio::time::sleep(Duration::from_millis(40)).await;
    }
}

fn control(key: &str, kind: CommandKind, receipt: &CommandReceipt) -> TaskCommand {
    TaskCommand {
        context: None,
        key: key.into(),
        kind,
        task_id: Some(receipt.task_id.clone()),
        cycle_id: Some(receipt.cycle_id.clone()),
        content: None,
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn stalled_provider_pause_and_restart_recover_without_resending() {
    let configuration = support::Configuration::from_environment();
    let mut owner = PgConnection::connect(&configuration.migration)
        .await
        .unwrap();
    configuration.guard_connection(&mut owner).await;
    owner
        .execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public; REVOKE CREATE ON SCHEMA public FROM PUBLIC")
        .await
        .unwrap();
    migrate(
        &configuration.migration,
        database_options(&configuration.runtime)
            .unwrap()
            .get_username(),
    )
    .await
    .unwrap();
    seed_local_configured("https://127.0.0.1:4443", &configuration.migration)
        .await
        .unwrap();
    let mut admin = PgConnection::connect(&configuration.admin).await.unwrap();
    configuration.guard_connection(&mut admin).await;
    let database = RuntimeDatabase::connect(&configuration.runtime)
        .await
        .unwrap();
    let pool = database.pool().clone();
    let control_pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(&configuration.runtime)
        .await
        .unwrap();
    let operations = OperationRepository::new(pool.clone());
    let organisation = policy(PolicyKind::Organisation, "org-a");
    let engagement = policy(PolicyKind::Engagement, "engagement-a");
    let member = policy(PolicyKind::Member, "actor-a");
    // The owned source for tool dispatch: accepts and never answers.
    let source = Stall::start().await;
    let mut account = policy(PolicyKind::Account, "fixture-account");
    account.account.as_mut().unwrap().source = source_binding(source.address);
    for document in [&organisation, &engagement, &member, &account] {
        operations
            .save_policy("actor-manager", &scope(), document)
            .await
            .unwrap();
    }
    let session = IdentityRepository::new(pool.clone())
        .establish_session("https://127.0.0.1:4443", "manager-a", "Manager", None)
        .await
        .unwrap();
    let models = ModelRepository::new(pool.clone()).with_session_hash(secret_hash(&session));
    let profile = ModelProfile {
        id: "loopback".into(),
        revision: 1,
        provider: Provider::OpenAi,
        model: "fixture-model".into(),
        destination: "fixture-destination".into(),
        account_id: "fixture-account".into(),
        capability_revision: "fixture-native-v1".into(),
        qualification: Qualification::Fixture,
        enabled: true,
        capabilities: Capabilities {
            tools: true,
            structured_output: false,
            reasoning: false,
        },
        max_output_tokens: 128,
    };
    let tool_operation = disclosure();
    let catalogue = ToolCatalog {
        id: "loopback-tools".into(),
        revision: 1,
        enabled: true,
        tools: vec![ToolDescriptor {
            name: "send_exact".into(),
            version: 1,
            description: "Send exactly the owned prepared synthetic operation".into(),
            input_schema: ArgumentSchema::for_operation(&tool_operation),
            operation: tool_operation,
            output_schema: ArgumentSchema::Boolean,
            effect: Effect::Send,
            cancellation: CancellationSemantics::LocalOnly,
            idempotency: IdempotencySemantics::ExactKey,
            reconciliation: ReconciliationSemantics::SourceLookup,
            completeness: OutputCompleteness::Complete,
        }],
    };
    models
        .save_profile("actor-manager", "org-a", &profile)
        .await
        .unwrap();
    models
        .save_catalogue("actor-manager", "org-a", &catalogue)
        .await
        .unwrap();

    let tasks = TaskRepository::new(pool.clone());
    let controls = TaskRepository::new(control_pool.clone());
    let receipt = tasks
        .admit(
            "actor-a",
            &scope(),
            &TaskCommand {
                context: None,
                key: "work-process".into(),
                kind: CommandKind::Create,
                task_id: None,
                cycle_id: None,
                content: Some("Synthetic work-loop objective".into()),
            },
        )
        .await
        .unwrap();
    let mut authority = AuthoritySnapshot {
        scope: scope(),
        actor_id: "actor-a".into(),
        task_id: receipt.task_id.clone(),
        organisation,
        engagement,
        member,
        account,
        task: policy(PolicyKind::Task, &receipt.task_id),
        delegations: vec![],
    };
    authority.task.actor_id = "actor-a".into();
    operations
        .accept_authority("actor-a", &scope(), &receipt.task_id, &authority)
        .await
        .unwrap();

    let provider = Stall::start().await;
    let runner = || composition(pool.clone(), &provider.endpoint, source.address);
    let config = executor::Config::new(std::path::PathBuf::from("/bin/false"), 10).unwrap();
    let (stop, shutdown) = tokio::sync::watch::channel(false);
    let first = tokio::spawn(zobba_worker::coordinate_work(
        database.clone(),
        config.clone(),
        runner(),
        shutdown.clone(),
    ));
    let invocations = async |admin: &mut PgConnection| -> i64 {
        sqlx::query_scalar("SELECT count(*) FROM public.model_invocations")
            .fetch_one(admin)
            .await
            .unwrap()
    };
    eventually(async || (provider.sends.load(Ordering::SeqCst) == 1).then_some(())).await;
    assert_eq!(
        invocations(&mut admin).await,
        1,
        "the dispatch cutoff precedes I/O"
    );

    // Pause while the provider stalls: the control lane admits at once and the
    // executor's authority poll cancels the in-flight call.
    let started = Instant::now();
    controls
        .admit(
            "actor-a",
            &scope(),
            &control("work-pause", CommandKind::Pause, &receipt),
        )
        .await
        .unwrap();
    assert!(
        started.elapsed() < Duration::from_secs(2),
        "control waited for the model"
    );
    let paused = eventually(async || {
        let task = tasks
            .get("actor-a", &scope(), &receipt.task_id)
            .await
            .ok()?;
        (task.cessation == Cessation::Confirmed).then_some(task)
    })
    .await;
    assert_eq!(paused.state, TaskState::Paused);
    assert!(
        started.elapsed() < Duration::from_secs(5),
        "Pausing took too long to become Paused"
    );
    let cancelled: String =
        sqlx::query_scalar("SELECT document->>'completion' FROM public.model_results")
            .fetch_one(&mut admin)
            .await
            .unwrap();
    assert!(cancelled.contains("cancelled"), "{cancelled}");

    // Resume: the next turn stalls; then the worker process is lost mid-turn.
    controls
        .admit(
            "actor-a",
            &scope(),
            &control("work-resume", CommandKind::Resume, &receipt),
        )
        .await
        .unwrap();
    eventually(async || (provider.sends.load(Ordering::SeqCst) == 2).then_some(())).await;
    first.abort();
    let _ = first.await;
    sqlx::query("UPDATE public.tasks SET owner_until=clock_timestamp()-interval '1 second'")
        .execute(&mut admin)
        .await
        .unwrap();
    let second = tokio::spawn(zobba_worker::coordinate_work(
        database.clone(),
        config,
        runner(),
        shutdown,
    ));
    let work = eventually(async || {
        let work = tasks
            .work("actor-a", &scope(), &receipt.task_id)
            .await
            .ok()?;
        (work.attention == Some(Attention::StepFailed)).then_some(work)
    })
    .await;
    assert_eq!(
        provider.sends.load(Ordering::SeqCst),
        2,
        "the replacement owner recovered the same invocation key without resending"
    );
    assert_eq!(invocations(&mut admin).await, 2);
    assert_eq!(work.steps.last().unwrap().status, StepStatus::Failed);
    let task = eventually(async || {
        let task = tasks
            .get("actor-a", &scope(), &receipt.task_id)
            .await
            .ok()?;
        (task.state == TaskState::Waiting).then_some(task)
    })
    .await;
    assert_eq!(
        task.state,
        TaskState::Waiting,
        "an unknown turn waits; it never completes the objective"
    );
    assert_eq!(provider.sends.load(Ordering::SeqCst), 2);
    stop.send(true).unwrap();
    let _ = tokio::time::timeout(Duration::from_secs(10), second).await;

    // OS-level restart proof: separate worker processes, SIGKILL, new process.
    let accepted = async |key: &str| -> CommandReceipt {
        let receipt = tasks
            .admit(
                "actor-a",
                &scope(),
                &TaskCommand {
                    context: None,
                    key: key.into(),
                    kind: CommandKind::Create,
                    task_id: None,
                    cycle_id: None,
                    content: Some("Synthetic process-loss objective".into()),
                },
            )
            .await
            .unwrap();
        let mut snapshot = authority.clone();
        snapshot.task_id = receipt.task_id.clone();
        snapshot.task = policy(PolicyKind::Task, &receipt.task_id);
        snapshot.task.actor_id = "actor-a".into();
        operations
            .accept_authority("actor-a", &scope(), &receipt.task_id, &snapshot)
            .await
            .unwrap();
        receipt
    };
    let expire = async |admin: &mut PgConnection, task: &str| {
        sqlx::query(
            "UPDATE public.tasks SET owner_until=clock_timestamp()-interval '1 second' WHERE id=$1",
        )
        .bind(task)
        .execute(admin)
        .await
        .unwrap();
    };
    let task_invocations = async |admin: &mut PgConnection, task: &str| -> Vec<String> {
        sqlx::query_scalar("SELECT key FROM public.model_invocations WHERE task_id=$1")
            .bind(task)
            .fetch_all(admin)
            .await
            .unwrap()
    };
    let source_address = source.address.to_string();
    // Trusted material for the owned source, supplied by the guarded fixture
    // owner exactly as Story 20.5 requires; runtime cannot write it.
    sqlx::query("INSERT INTO public.trusted_attachment_metadata(organisation_id,client_id,engagement_id,source_key,attachment_id,digest,classification) VALUES('org-a','client-a','engagement-a','14:fixture-source14:fixture-ledger','attachment',$1,'audit')")
        .bind("a".repeat(64))
        .execute(&mut admin)
        .await
        .unwrap();

    // Killed mid-turn: the provider holds the request; the process dies.
    let stalled = Stall::start().await;
    let receipt = accepted("work-process-kill-turn").await;
    let mut lost = helper(&configuration, &stalled.endpoint, &source_address);
    eventually(async || (stalled.sends.load(Ordering::SeqCst) == 1).then_some(())).await;
    let keys = task_invocations(&mut admin, &receipt.task_id).await;
    assert_eq!(keys.len(), 1, "the dispatch cutoff precedes provider I/O");
    kill(&mut lost).await;
    expire(&mut admin, &receipt.task_id).await;
    let mut replacement = helper(&configuration, &stalled.endpoint, &source_address);
    let work = eventually(async || {
        let work = tasks
            .work("actor-a", &scope(), &receipt.task_id)
            .await
            .ok()?;
        (work.attention == Some(Attention::StepFailed)).then_some(work)
    })
    .await;
    let task = eventually(async || {
        let task = tasks
            .get("actor-a", &scope(), &receipt.task_id)
            .await
            .ok()?;
        (task.state == TaskState::Waiting).then_some(task)
    })
    .await;
    assert_eq!(
        task.state,
        TaskState::Waiting,
        "an unknown turn never completes"
    );
    assert_eq!(
        stalled.sends.load(Ordering::SeqCst),
        1,
        "the new process recovered the same invocation key without a resend"
    );
    assert_eq!(
        task_invocations(&mut admin, &receipt.task_id).await,
        keys,
        "the same invocation key, no second invocation"
    );
    let snapshot = tasks
        .get("actor-a", &scope(), &receipt.task_id)
        .await
        .unwrap();
    assert_eq!(
        keys[0],
        invocation_key(
            &receipt.task_id,
            &receipt.cycle_id,
            snapshot.intent_revision,
            0,
            TurnConfiguration {
                profile_id: "loopback",
                profile_revision: 1,
                catalogue_id: "loopback-tools",
                catalogue_revision: 1,
            }
        )
    );
    assert_eq!(
        work.steps
            .iter()
            .map(|s| (s.kind, s.status))
            .collect::<Vec<_>>(),
        vec![(StepKind::ModelTurn, StepStatus::Failed)],
        "the unknown turn is a recorded fact, not replayed"
    );
    terminate(&mut replacement).await;

    // Killed mid-tool: the turn proposed the tool, consumption committed and the
    // owned source holds the dispatch; the process dies.
    let answering = Stall::answering(vec![
        tool_reply(),
        text_reply("Reconciled result considered."),
    ])
    .await;
    let receipt = accepted("work-process-kill-tool").await;
    let mut lost = helper(&configuration, &answering.endpoint, &source_address);
    eventually(async || (source.dispatches() == 1).then_some(())).await;
    kill(&mut lost).await;
    let attempts = async |admin: &mut PgConnection, task: &str| -> (i64,) {
        sqlx::query_as("SELECT count(*) FROM public.operation_attempts a JOIN public.operations o ON o.id=a.operation_id WHERE o.task_id=$1")
            .bind(task)
            .fetch_one(admin)
            .await
            .unwrap()
    };
    assert_eq!(attempts(&mut admin, &receipt.task_id).await.0, 1);
    expire(&mut admin, &receipt.task_id).await;
    let turns = answering.sends.load(Ordering::SeqCst);
    assert_eq!(turns, 1);
    let mut replacement = helper(&configuration, &answering.endpoint, &source_address);
    let task = eventually(async || {
        let task = tasks
            .get("actor-a", &scope(), &receipt.task_id)
            .await
            .ok()?;
        (task.cessation == Cessation::ReconciliationRequired).then_some(task)
    })
    .await;
    assert_eq!(task.cessation, Cessation::ReconciliationRequired);
    assert_eq!(
        tasks
            .work("actor-a", &scope(), &receipt.task_id)
            .await
            .unwrap()
            .attention,
        Some(Attention::ReconciliationRequired)
    );
    // Give the new process time to act; nothing may be replayed.
    tokio::time::sleep(Duration::from_secs(3)).await;
    assert_eq!(
        source.dispatches(),
        1,
        "the consumed attempt is never resent by the new process"
    );
    assert_eq!(
        attempts(&mut admin, &receipt.task_id).await.0,
        1,
        "no second attempt"
    );
    assert_eq!(
        answering.sends.load(Ordering::SeqCst),
        turns,
        "no model turn is replayed while the attempt is unresolved"
    );
    let work = tasks
        .work("actor-a", &scope(), &receipt.task_id)
        .await
        .unwrap();
    assert!(
        !work
            .steps
            .iter()
            .any(|s| s.kind == StepKind::ToolStep && s.status == StepStatus::Refused),
        "a possibly dispatched operation is never recorded as refused"
    );
    // The consumed attempt reconciles through a source lookup under current
    // authority (never a send). The Task then continues: the same attempt is
    // recorded as completed with its fact, and nothing is resent.
    let attempt_id: String = sqlx::query_scalar("SELECT a.id FROM public.operation_attempts a JOIN public.operations o ON o.id=a.operation_id WHERE o.task_id=$1")
        .bind(&receipt.task_id)
        .fetch_one(&mut admin)
        .await
        .unwrap();
    let reconciler =
        OperationRepository::new(pool.clone()).with_model_qualification_source(Arc::new(Fixture));
    let fact = Gateway::qualification(source.address, source_binding(source.address))
        .unwrap()
        .recover(&reconciler, "actor-a", &scope(), &attempt_id)
        .await
        .unwrap();
    assert_eq!(fact, SourceFact::Completed);
    // Reconciliation leaves the Task waiting. An explicit Pause then Resume
    // starts a fresh producer under the unchanged intent, which must rebuild
    // the reconciled attempt from durable facts rather than send again.
    let waiting = eventually(async || {
        let task = tasks
            .get("actor-a", &scope(), &receipt.task_id)
            .await
            .ok()?;
        (task.state == TaskState::Waiting && task.cessation == Cessation::Confirmed).then_some(task)
    })
    .await;
    assert_eq!(waiting.state, TaskState::Waiting);
    controls
        .admit(
            "actor-a",
            &scope(),
            &control(
                "work-process-reconciled-pause",
                CommandKind::Pause,
                &receipt,
            ),
        )
        .await
        .unwrap();
    eventually(async || {
        let task = tasks
            .get("actor-a", &scope(), &receipt.task_id)
            .await
            .ok()?;
        (task.state == TaskState::Paused).then_some(())
    })
    .await;
    controls
        .admit(
            "actor-a",
            &scope(),
            &control(
                "work-process-reconciled-resume",
                CommandKind::Resume,
                &receipt,
            ),
        )
        .await
        .unwrap();
    let work = eventually(async || {
        let work = tasks
            .work("actor-a", &scope(), &receipt.task_id)
            .await
            .ok()?;
        work.steps
            .iter()
            .any(|s| s.status == StepStatus::Responded)
            .then_some(work)
    })
    .await;
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
        "the reconciled attempt is a completed fact, never refused or replayed"
    );
    assert_eq!(
        work.steps[1].attempt_id.as_deref(),
        Some(attempt_id.as_str())
    );
    assert_eq!(work.steps[1].fact, Some(SourceFact::Completed));
    assert_eq!(source.dispatches(), 1, "a lookup is not a resend");
    assert_eq!(attempts(&mut admin, &receipt.task_id).await.0, 1);
    terminate(&mut replacement).await;
}
