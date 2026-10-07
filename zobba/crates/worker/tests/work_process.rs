//! Story 22.2 worker proof: the real coordinator, executor authority poll,
//! native loopback transport and PostgreSQL. The provider stalls so Pause and
//! restart are exercised while a model call is genuinely in flight.
use sha2::{Digest, Sha256};
use sqlx::{Connection, Executor, PgConnection, postgres::PgPoolOptions};
use std::{
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::{io::AsyncReadExt, net::TcpListener};
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
    permissions::{
        AccountRestriction, Action, Attachment, AuthoritySnapshot, CanonicalOperation,
        EnvironmentKind, PermissionBounds, PermissionRule, PolicyDocument, PolicyKind, Purpose,
        ReadRestriction, SourceBinding,
    },
    task::{Cessation, CommandKind, CommandReceipt, TaskCommand, TaskState},
    work::{Attention, StepStatus},
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

/// A loopback provider that accepts each request and never answers.
struct Stall {
    endpoint: String,
    sends: Arc<AtomicUsize>,
    _task: tokio::task::JoinHandle<()>,
}
impl Stall {
    async fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("http://{}/native", listener.local_addr().unwrap());
        let sends = Arc::new(AtomicUsize::new(0));
        let count = sends.clone();
        let task = tokio::spawn(async move {
            let mut held = Vec::new();
            loop {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut buffer = vec![0u8; 1 << 20];
                let mut total = 0;
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
                            count.fetch_add(1, Ordering::SeqCst);
                            break;
                        }
                    }
                }
                held.push(socket);
            }
        });
        Self {
            endpoint,
            sends,
            _task: task,
        }
    }
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
    let account = policy(PolicyKind::Account, "fixture-account");
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
    let gateway_address: std::net::SocketAddr = "127.0.0.1:9".parse().unwrap();
    let runner = || -> Arc<dyn zobba_worker::work::WorkRunner> {
        Arc::new(Composition {
            pool: pool.clone(),
            qualifications: Arc::new(Fixture),
            transport: Arc::new(
                NativeAdapter::test_loopback(
                    Provider::OpenAi,
                    &provider.endpoint,
                    Duration::from_secs(60),
                )
                .unwrap(),
            ),
            gateway: Gateway::qualification(
                gateway_address,
                SourceBinding {
                    source_id: "fixture-source".into(),
                    ledger_id: "fixture-ledger".into(),
                    endpoint_digest: format!(
                        "{:x}",
                        Sha256::digest(gateway_address.to_string().as_bytes())
                    ),
                    contract_version: 1,
                },
            )
            .unwrap(),
            disclosure: disclosure(),
            input_class: "audit".into(),
            max_output_tokens: 128,
        })
    };
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
}
