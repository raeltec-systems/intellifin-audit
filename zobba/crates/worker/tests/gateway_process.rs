//! Actual PostgreSQL/HTTP/process qualification. Fault hooks exist only in this
//! test executable; the production gateway has no crash or destination flags.
use sha2::{Digest, Sha256};
use sqlx::{Connection, Executor, PgConnection, PgPool, postgres::PgPoolOptions};
use std::{
    path::PathBuf,
    process::Stdio,
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{
    process::{Child, Command},
    time::timeout,
};
use zobba_application::{
    operation::{OperationError, OperationStore},
    task::TaskCommands,
};
use zobba_domain::{
    identity::Scope,
    permissions::{
        AccountRestriction, Action, Attachment, AuthoritySnapshot, CanonicalOperation,
        ConsumedOperation, DecisionCommand, EnvironmentKind, Operation, OperationAttemptPage,
        OperationDecision, OperationHistory, OperationHistoryQuery, OperationPage, OperationState,
        PermissionBounds, PermissionRule, PolicyDocument, PolicyKind, PolicyReference, Purpose,
        ReadRestriction, RevocationCommand, SourceBinding, SourceFact,
    },
    task::{Cessation, ClaimBasis, CommandKind, Decision, TaskCommand, TaskState, WakeupRoute},
};
use zobba_infrastructure::{
    database_options, fixture::seed_local_configured, migrate, operation::OperationRepository,
    task::TaskRepository,
};
use zobba_worker::gateway::Gateway;

#[path = "support/fault_endpoint.rs"]
mod fault_endpoint;
#[path = "../../infrastructure/tests/support/mod.rs"]
mod support;
use fault_endpoint::{Endpoint, Fault};

static NEXT_DIRECTORY: AtomicU64 = AtomicU64::new(1);
const WAIT: Duration = Duration::from_secs(15);

fn scope() -> Scope {
    Scope {
        organisation_id: "org-a".into(),
        client_id: "client-a".into(),
        engagement_id: "engagement-a".into(),
    }
}

struct Markers(PathBuf);
impl Markers {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "zobba-gateway-{}-{}",
            std::process::id(),
            NEXT_DIRECTORY.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir(&path).unwrap();
        Self(path)
    }
    async fn wait(&self, name: &str) {
        timeout(WAIT, async {
            while !self.0.join(name).exists() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("owned gateway child must reach its exact fault boundary");
    }
}
impl Drop for Markers {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Forward all actual authority and writes to PostgreSQL. Only consumed-return
/// and receipt-entry can be interrupted by the owned child test process.
struct FaultStore {
    repository: OperationRepository,
    mode: String,
    markers: PathBuf,
}
impl OperationStore for FaultStore {
    async fn save_policy(
        &self,
        actor: &str,
        scope: &Scope,
        policy: &PolicyDocument,
    ) -> Result<PolicyReference, OperationError> {
        self.repository.save_policy(actor, scope, policy).await
    }
    async fn accept_authority(
        &self,
        actor: &str,
        scope: &Scope,
        task_id: &str,
        authority: &AuthoritySnapshot,
    ) -> Result<PolicyReference, OperationError> {
        self.repository
            .accept_authority(actor, scope, task_id, authority)
            .await
    }
    async fn admit(
        &self,
        actor: &str,
        scope: &Scope,
        basis: &ClaimBasis,
        operation_key: &str,
        request: &CanonicalOperation,
    ) -> Result<Operation, OperationError> {
        self.repository
            .admit(actor, scope, basis, operation_key, request)
            .await
    }
    async fn decide(
        &self,
        actor: &str,
        scope: &Scope,
        decision: &DecisionCommand,
    ) -> Result<OperationDecision, OperationError> {
        self.repository.decide(actor, scope, decision).await
    }
    async fn revoke(
        &self,
        actor: &str,
        scope: &Scope,
        command: &RevocationCommand,
    ) -> Result<PolicyReference, OperationError> {
        self.repository.revoke(actor, scope, command).await
    }
    async fn get(&self, actor: &str, scope: &Scope, id: &str) -> Result<Operation, OperationError> {
        self.repository.get(actor, scope, id).await
    }
    async fn list(
        &self,
        actor: &str,
        scope: &Scope,
        task_id: &str,
        after: Option<&str>,
    ) -> Result<OperationPage, OperationError> {
        self.repository.list(actor, scope, task_id, after).await
    }
    async fn unresolved(
        &self,
        actor: &str,
        scope: &Scope,
        task_id: &str,
        after: Option<&str>,
    ) -> Result<OperationAttemptPage, OperationError> {
        self.repository
            .unresolved(actor, scope, task_id, after)
            .await
    }
    async fn history(
        &self,
        actor: &str,
        scope: &Scope,
        operation_id: &str,
        query: &OperationHistoryQuery,
    ) -> Result<OperationHistory, OperationError> {
        self.repository
            .history(actor, scope, operation_id, query)
            .await
    }
    async fn reauthorize_recovery(
        &self,
        actor: &str,
        scope: &Scope,
        custody: &ConsumedOperation,
    ) -> Result<(), OperationError> {
        self.repository
            .reauthorize_recovery(actor, scope, custody)
            .await
    }
    async fn recover(
        &self,
        actor: &str,
        scope: &Scope,
        attempt_id: &str,
    ) -> Result<ConsumedOperation, OperationError> {
        self.repository.recover(actor, scope, attempt_id).await
    }
    async fn consume(
        &self,
        basis: &ClaimBasis,
        operation_id: &str,
    ) -> Result<ConsumedOperation, OperationError> {
        let attempt = self.repository.consume(basis, operation_id).await?;
        std::fs::write(self.markers.join("consumed"), &attempt.attempt_id).unwrap();
        if self.mode == "crash_consumed" {
            std::process::exit(81);
        }
        if self.mode == "delay_consumed" {
            // Deliberately block only this owned child process at the completed
            // database-call return. A late producer remains possible after the
            // recovered source reports absence, even when its lease expires.
            while !self.markers.join("release").exists() {
                std::thread::sleep(Duration::from_millis(5));
            }
        }
        Ok(attempt)
    }
    async fn observe(
        &self,
        attempt: &ConsumedOperation,
        fact: SourceFact,
    ) -> Result<(), OperationError> {
        if self.mode == "crash_receipt" {
            assert_eq!(fact, SourceFact::Completed);
            std::fs::write(self.markers.join("effect_observed"), b"ready").unwrap();
            std::process::exit(82);
        }
        self.repository.observe(attempt, fact).await
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "owned helper process, invoked by gateway test with guarded fixture inputs"]
async fn gateway_worker_helper() {
    let configuration = support::Configuration::from_environment();
    let mode = std::env::var("ZOBBA_GATEWAY_TEST_MODE").unwrap();
    let markers = PathBuf::from(std::env::var_os("ZOBBA_GATEWAY_TEST_MARKERS").unwrap());
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&configuration.runtime)
        .await
        .unwrap();
    let repository = OperationRepository::new(pool);
    let gateway = Gateway::qualification(
        std::env::var("ZOBBA_GATEWAY_TEST_ADDRESS")
            .unwrap()
            .parse()
            .unwrap(),
        serde_json::from_str::<zobba_application::operation::wire::StoredSource>(
            &std::env::var("ZOBBA_GATEWAY_TEST_SOURCE").unwrap(),
        )
        .unwrap()
        .0,
    )
    .unwrap();
    let target = std::env::var("ZOBBA_GATEWAY_TEST_TARGET").unwrap();
    let outcome = if mode == "recover" {
        gateway
            .recover(&repository, "actor-a", &scope(), &target)
            .await
    } else {
        let stored: zobba_application::operation::wire::StoredBasis =
            serde_json::from_slice(&std::fs::read(markers.join("basis.json")).unwrap()).unwrap();
        gateway
            .dispatch(
                &FaultStore {
                    repository,
                    mode,
                    markers: markers.clone(),
                },
                &stored.0,
                &target,
            )
            .await
    };
    std::fs::write(
        markers.join("outcome"),
        match outcome {
            Ok(fact) => fact.as_str(),
            Err(error) => error.code(),
        },
    )
    .unwrap();
}

fn helper(
    configuration: &support::Configuration,
    endpoint: &Endpoint,
    mode: &str,
    target: &str,
    markers: &Markers,
) -> Child {
    Command::new(std::env::current_exe().unwrap())
        .args([
            "--ignored",
            "--exact",
            "gateway_worker_helper",
            "--nocapture",
        ])
        .env_clear()
        .env(
            "ZOBBA_TEST_MIGRATION_DATABASE_URL",
            &configuration.migration,
        )
        .env("ZOBBA_TEST_RUNTIME_DATABASE_URL", &configuration.runtime)
        .env("ZOBBA_TEST_ADMIN_DATABASE_URL", &configuration.admin)
        .env("ZOBBA_GATEWAY_TEST_MODE", mode)
        .env("ZOBBA_GATEWAY_TEST_TARGET", target)
        .env("ZOBBA_GATEWAY_TEST_MARKERS", &markers.0)
        .env("ZOBBA_GATEWAY_TEST_ADDRESS", endpoint.address.to_string())
        .env(
            "ZOBBA_GATEWAY_TEST_SOURCE",
            serde_json::to_string(&zobba_application::operation::wire::StoredSource(
                endpoint.source.clone(),
            ))
            .unwrap(),
        )
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::inherit())
        .kill_on_drop(true)
        .spawn()
        .unwrap()
}

async fn child_outcome(mut child: Child, markers: &Markers) -> String {
    assert!(
        timeout(WAIT, child.wait())
            .await
            .unwrap()
            .unwrap()
            .success()
    );
    std::fs::read_to_string(markers.0.join("outcome")).unwrap()
}

async fn fixture(
    pool: &PgPool,
    key: &str,
    policies: &mut Option<AuthoritySnapshot>,
    source: &SourceBinding,
) -> (ClaimBasis, Operation) {
    let tasks = TaskRepository::new(pool.clone());
    let store = OperationRepository::new(pool.clone());
    let receipt = tasks
        .admit(
            "actor-a",
            &scope(),
            &TaskCommand {
                key: key.into(),
                kind: CommandKind::Create,
                task_id: None,
                cycle_id: None,
                content: Some("Owned operation qualification".into()),
            },
        )
        .await
        .unwrap();
    let route = WakeupRoute {
        id: receipt.task_id.clone(),
        actor_id: "actor-a".into(),
        scope: scope(),
        task_id: receipt.task_id.clone(),
    };
    let basis = match tasks.coordinate(&route, "gateway_fixture").await.unwrap() {
        Decision::Execute(basis) => *basis,
        other => panic!("expected current work basis, got {other:?}"),
    };
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    let request = CanonicalOperation {
        version: 1,
        purpose: Purpose::TestWorkflows,
        action: Action::Write,
        account_id: "qualification-account".into(),
        environment_id: "qualification-environment".into(),
        destination: "owned-effect-store".into(),
        recipients: vec![],
        material: key.into(),
        material_digest: format!("{:x}", Sha256::digest(key.as_bytes())),
        attachments: vec![],
        resource_id: "synthetic-record".into(),
        resource_version: "version-1".into(),
        expires_at: now + 600,
    };
    let bounds = PermissionBounds {
        rules: vec![PermissionRule {
            purpose: request.purpose,
            action: request.action,
            account_id: request.account_id.clone(),
            environment_id: request.environment_id.clone(),
            destination: request.destination.clone(),
            resource_id: request.resource_id.clone(),
            recipients: vec![],
            attachment_classifications: vec!["public".into()],
            expires_at: now + 3600,
        }],
    };
    let document = |kind, subject_id: String| PolicyDocument {
        schema_version: 1,
        kind,
        subject_id,
        version: 1,
        actor_id: "actor-manager".into(),
        created_at: now,
        revoked: false,
        hard: bounds.clone(),
        standing: bounds.clone(),
        parent: None,
        account: if kind == PolicyKind::Account {
            Some(AccountRestriction {
                source: source.clone(),
                account_id: request.account_id.clone(),
                environment_id: request.environment_id.clone(),
                environment: EnvironmentKind::Test,
                read_restriction: ReadRestriction::None,
                restriction_survives_takeover: false,
                test_environment_verified: true,
                test_resources: vec![request.resource_id.clone()],
                test_cleanup_id: Some("qualification-cleanup".into()),
                audit_resources: vec![],
            })
        } else {
            None
        },
    };
    let mut authority = policies.clone().unwrap_or_else(|| AuthoritySnapshot {
        scope: scope(),
        actor_id: "actor-a".into(),
        task_id: receipt.task_id.clone(),
        organisation: document(PolicyKind::Organisation, "org-a".into()),
        engagement: document(PolicyKind::Engagement, "engagement-a".into()),
        member: document(PolicyKind::Member, "actor-a".into()),
        account: document(PolicyKind::Account, request.account_id.clone()),
        task: document(PolicyKind::Task, receipt.task_id.clone()),
        delegations: vec![],
    });
    if policies.is_none() {
        for policy in [
            &authority.organisation,
            &authority.engagement,
            &authority.member,
            &authority.account,
        ] {
            store
                .save_policy("actor-manager", &scope(), policy)
                .await
                .unwrap();
        }
        *policies = Some(authority.clone());
    }
    authority.task_id = receipt.task_id.clone();
    authority.task = document(PolicyKind::Task, receipt.task_id.clone());
    authority.task.actor_id = "actor-a".into();
    store
        .accept_authority("actor-a", &scope(), &receipt.task_id, &authority)
        .await
        .unwrap();
    let operation = store
        .admit("actor-a", &scope(), &basis, key, &request)
        .await
        .unwrap();
    assert_eq!(operation.state, OperationState::Ready);
    (basis, operation)
}

fn save_basis(markers: &Markers, basis: &ClaimBasis) {
    std::fs::write(
        markers.0.join("basis.json"),
        serde_json::to_vec(&zobba_application::operation::wire::StoredBasis(
            basis.clone(),
        ))
        .unwrap(),
    )
    .unwrap();
}

async fn fresh_basis(pool: &PgPool, previous: &ClaimBasis) -> ClaimBasis {
    let route = WakeupRoute {
        id: previous.task_id.clone(),
        actor_id: previous.actor_id.clone(),
        scope: previous.scope.clone(),
        task_id: previous.task_id.clone(),
    };
    match TaskRepository::new(pool.clone())
        .coordinate(&route, "gateway_fixture")
        .await
        .unwrap()
    {
        Decision::Execute(basis) => *basis,
        other => {
            panic!("source-confirmed absence must allow fresh authorized attempt basis: {other:?}")
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn owned_gateway_process_recovery_preserves_source_facts_and_fences_late_sends() {
    let configuration = support::Configuration::from_environment();
    let mut owner = PgConnection::connect(&configuration.migration)
        .await
        .unwrap();
    configuration.guard_connection(&mut owner).await;
    owner.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public; REVOKE CREATE ON SCHEMA public FROM PUBLIC").await.unwrap();
    migrate(
        &configuration.migration,
        database_options(&configuration.runtime)
            .unwrap()
            .get_username(),
    )
    .await
    .unwrap();
    seed_local_configured("https://localhost:9443", &configuration.migration)
        .await
        .unwrap();
    let mut inspector = PgConnection::connect(&configuration.admin).await.unwrap();
    configuration.guard_connection(&mut inspector).await;
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&configuration.runtime)
        .await
        .unwrap();
    let store = OperationRepository::new(pool.clone());
    let endpoint = Endpoint::start().await;
    let gateway = Gateway::qualification(endpoint.address, endpoint.source.clone()).unwrap();
    let mut policies = None;

    let (basis, operation) =
        fixture(&pool, "concurrent_gateway", &mut policies, &endpoint.source).await;
    let (left, right) = tokio::join!(
        gateway.dispatch(&store, &basis, &operation.id),
        gateway.dispatch(&store, &basis, &operation.id)
    );
    assert_eq!(
        [left, right]
            .iter()
            .filter(|result| **result == Ok(SourceFact::Completed))
            .count(),
        1
    );
    assert_eq!(endpoint.effects(&operation.id), 1);
    assert_eq!(
        endpoint
            .events()
            .iter()
            .filter(|event| event.operation_id == operation.id && event.kind == "send")
            .count(),
        1
    );

    let (basis, operation) = fixture(
        &pool,
        "fresh_human_refusal",
        &mut policies,
        &endpoint.source,
    )
    .await;
    let refusal = store
        .decide(
            "actor-a",
            &scope(),
            &DecisionCommand {
                key: "fresh_refusal_key".into(),
                operation_id: operation.id.clone(),
                expected_revision: operation.revision,
                request: operation.request.clone(),
                expires_at: operation.request.expires_at,
                allow: false,
            },
        )
        .await
        .unwrap();
    assert!(!refusal.allowed);
    assert_eq!(
        store
            .get("actor-a", &scope(), &operation.id)
            .await
            .unwrap()
            .state,
        OperationState::Revoked
    );
    assert_eq!(
        gateway.dispatch(&store, &basis, &operation.id).await,
        Err(OperationError::Denied)
    );
    assert!(
        store
            .unresolved("actor-a", &scope(), &basis.task_id, None)
            .await
            .unwrap()
            .attempts
            .is_empty()
    );
    assert_eq!(endpoint.effects(&operation.id), 0);
    assert!(
        !endpoint
            .events()
            .iter()
            .any(|event| event.operation_id == operation.id)
    );
    let attempts: i64 =
        sqlx::query_scalar("SELECT count(*) FROM public.operation_attempts WHERE operation_id=$1")
            .bind(&operation.id)
            .fetch_one(&mut inspector)
            .await
            .unwrap();
    assert_eq!(attempts, 0);

    let (basis, operation) = fixture(
        &pool,
        "pinned_recovery_source",
        &mut policies,
        &endpoint.source,
    )
    .await;
    endpoint.fault(Fault::DropAfterEffect);
    assert_eq!(
        gateway
            .dispatch(&store, &basis, &operation.id)
            .await
            .unwrap(),
        SourceFact::Unknown
    );
    assert_eq!(endpoint.effects(&operation.id), 1);
    let attempt = store
        .unresolved("actor-a", &scope(), &basis.task_id, None)
        .await
        .unwrap()
        .attempts
        .remove(0);
    let other_source = Endpoint::start().await;
    let other_gateway =
        Gateway::qualification(other_source.address, other_source.source.clone()).unwrap();
    assert_eq!(
        other_gateway
            .recover(&store, "actor-a", &scope(), &attempt.id)
            .await,
        Err(OperationError::Fenced)
    );
    assert!(other_source.events().is_empty());
    assert_eq!(
        store
            .unresolved("actor-a", &scope(), &basis.task_id, None)
            .await
            .unwrap()
            .attempts
            .len(),
        1
    );
    assert!(Gateway::qualification(other_source.address, endpoint.source.clone()).is_err());
    assert_eq!(
        gateway
            .recover(&store, "actor-a", &scope(), &attempt.id)
            .await
            .unwrap(),
        SourceFact::Completed
    );
    assert_eq!(endpoint.effects(&operation.id), 1);

    let (basis, operation) =
        fixture(&pool, "stop_unconsumed", &mut policies, &endpoint.source).await;
    TaskRepository::new(pool.clone())
        .admit(
            "actor-a",
            &scope(),
            &TaskCommand {
                key: "stop_before_dispatch".into(),
                kind: CommandKind::Stop,
                task_id: Some(basis.task_id.clone()),
                cycle_id: Some(basis.cycle_id.clone()),
                content: None,
            },
        )
        .await
        .unwrap();
    assert!(
        gateway
            .dispatch(&store, &basis, &operation.id)
            .await
            .is_err()
    );
    assert!(
        !endpoint
            .events()
            .iter()
            .any(|event| event.operation_id == operation.id)
    );

    for (mode, code) in [("crash_consumed", 81), ("crash_receipt", 82)] {
        let (basis, operation) = fixture(&pool, mode, &mut policies, &endpoint.source).await;
        let markers = Markers::new();
        save_basis(&markers, &basis);
        let mut child = helper(&configuration, &endpoint, mode, &operation.id, &markers);
        assert_eq!(
            timeout(WAIT, child.wait()).await.unwrap().unwrap().code(),
            Some(code)
        );
        let attempts = store
            .unresolved("actor-a", &scope(), &basis.task_id, None)
            .await
            .unwrap()
            .attempts;
        assert_eq!(attempts.len(), 1);
        assert_eq!(attempts[0].observed, SourceFact::Unknown);
        let count_before = endpoint.events().len();
        let recovery = Markers::new();
        let outcome = child_outcome(
            helper(
                &configuration,
                &endpoint,
                "recover",
                &attempts[0].id,
                &recovery,
            ),
            &recovery,
        )
        .await;
        let expected = if mode == "crash_consumed" {
            "authoritatively_absent"
        } else {
            "completed"
        };
        assert_eq!(outcome, expected);
        assert_eq!(endpoint.events()[count_before].kind, "lookup");
        assert_eq!(
            endpoint.events().len(),
            count_before + 1,
            "replacement only queries, never resends"
        );
        if mode == "crash_consumed" {
            assert_eq!(endpoint.effects(&operation.id), 0);
            let basis = fresh_basis(&pool, &basis).await;
            assert_eq!(
                gateway
                    .dispatch(&store, &basis, &operation.id)
                    .await
                    .unwrap(),
                SourceFact::Completed
            );
        }
        assert_eq!(endpoint.effects(&operation.id), 1);
    }

    let (basis, operation) = fixture(&pool, "lost_ack", &mut policies, &endpoint.source).await;
    endpoint.fault(Fault::DropAfterEffect);
    let markers = Markers::new();
    save_basis(&markers, &basis);
    assert_eq!(
        child_outcome(
            helper(&configuration, &endpoint, "normal", &operation.id, &markers),
            &markers
        )
        .await,
        "unknown"
    );
    assert_eq!(endpoint.effects(&operation.id), 1);
    let attempts = store
        .unresolved("actor-a", &scope(), &basis.task_id, None)
        .await
        .unwrap()
        .attempts;
    let recovery = Markers::new();
    assert_eq!(
        child_outcome(
            helper(
                &configuration,
                &endpoint,
                "recover",
                &attempts[0].id,
                &recovery
            ),
            &recovery
        )
        .await,
        "completed"
    );
    assert_eq!(endpoint.effects(&operation.id), 1);
    assert_eq!(
        endpoint
            .events()
            .iter()
            .filter(|event| event.operation_id == operation.id)
            .map(|event| event.kind)
            .collect::<Vec<_>>(),
        vec!["send", "lookup"]
    );

    for key in ["changed_source_version", "expired_at_source"] {
        let (basis, operation) = fixture(&pool, key, &mut policies, &endpoint.source).await;
        let approval = store
            .decide(
                "actor-a",
                &scope(),
                &DecisionCommand {
                    key: format!("approve_{key}"),
                    operation_id: operation.id.clone(),
                    expected_revision: operation.revision,
                    request: operation.request.clone(),
                    expires_at: operation.request.expires_at,
                    allow: true,
                },
            )
            .await
            .unwrap();
        assert!(approval.allowed);
        let markers = Markers::new();
        save_basis(&markers, &basis);
        let delayed = helper(
            &configuration,
            &endpoint,
            "delay_consumed",
            &operation.id,
            &markers,
        );
        markers.wait("consumed").await;
        if key == "changed_source_version" {
            endpoint.set_resource_version("version-2");
        } else {
            endpoint.set_clock(Some(operation.request.expires_at));
        }
        std::fs::write(markers.0.join("release"), b"ready").unwrap();
        assert_eq!(child_outcome(delayed, &markers).await, "unknown");
        assert_eq!(
            endpoint.effects(&operation.id),
            0,
            "source checks preconditions at effect atomicity"
        );
        let attempt = std::fs::read_to_string(markers.0.join("consumed")).unwrap();
        assert_eq!(
            gateway
                .recover(&store, "actor-a", &scope(), &attempt)
                .await
                .unwrap(),
            SourceFact::AuthoritativelyAbsent
        );
        endpoint.set_clock(None);
        endpoint.set_resource_version("version-1");
    }

    let (basis, operation) = fixture(
        &pool,
        "trusted_attachments",
        &mut policies,
        &endpoint.source,
    )
    .await;
    let source_key = format!(
        "{}:{}{}:{}",
        endpoint.source.source_id.len(),
        endpoint.source.source_id,
        endpoint.source.ledger_id.len(),
        endpoint.source.ledger_id
    );
    for (id, classification) in [
        ("public-copy", "public"),
        ("restricted-copy", "restricted"),
        ("source-class-mismatch", "public"),
        ("source-digest-mismatch", "public"),
        ("source-missing", "public"),
    ] {
        sqlx::query("INSERT INTO public.trusted_attachment_metadata(organisation_id,client_id,engagement_id,source_key,attachment_id,digest,classification) VALUES('org-a','client-a','engagement-a',$1,$2,$3,$4)")
            .bind(&source_key).bind(id).bind(format!("{:x}", Sha256::digest(b"actual attachment bytes"))).bind(classification).execute(&mut owner).await.unwrap();
    }
    endpoint.register_attachment("public-copy", b"actual attachment bytes", "public");
    endpoint.register_attachment("restricted-copy", b"actual attachment bytes", "restricted");
    endpoint.register_attachment(
        "source-class-mismatch",
        b"actual attachment bytes",
        "restricted",
    );
    endpoint.register_attachment("source-digest-mismatch", b"different bytes", "public");
    let mut request = operation.request.clone();
    request.attachments = vec![Attachment {
        id: "restricted-copy".into(),
        digest: format!("{:x}", Sha256::digest(b"actual attachment bytes")),
        classification: "public".into(),
    }];
    assert_eq!(
        store
            .admit(
                "actor-a",
                &scope(),
                &basis,
                "forged_attachment_class",
                &request
            )
            .await,
        Err(OperationError::Denied)
    );
    request.attachments[0].id = "public-copy".into();
    request.attachments[0].digest = "0".repeat(64);
    assert_eq!(
        store
            .admit(
                "actor-a",
                &scope(),
                &basis,
                "forged_attachment_digest",
                &request
            )
            .await,
        Err(OperationError::Denied)
    );
    request.attachments[0].digest = format!("{:x}", Sha256::digest(b"actual attachment bytes"));
    let valid = store
        .admit(
            "actor-a",
            &scope(),
            &basis,
            "trusted_attachment_valid",
            &request,
        )
        .await
        .unwrap();
    assert_eq!(
        gateway.dispatch(&store, &basis, &valid.id).await.unwrap(),
        SourceFact::Completed
    );
    assert_eq!(endpoint.effects(&valid.id), 1);
    for id in [
        "source-class-mismatch",
        "source-digest-mismatch",
        "source-missing",
    ] {
        request.attachments[0].id = id.into();
        let admitted = store
            .admit("actor-a", &scope(), &basis, id, &request)
            .await
            .unwrap();
        assert_eq!(
            gateway
                .dispatch(&store, &basis, &admitted.id)
                .await
                .unwrap(),
            SourceFact::Unknown
        );
        assert_eq!(
            endpoint.effects(&admitted.id),
            0,
            "source verifies actual registered bytes and classification"
        );
        let attempts = store
            .unresolved("actor-a", &scope(), &basis.task_id, None)
            .await
            .unwrap()
            .attempts;
        let attempt = attempts
            .iter()
            .find(|attempt| attempt.operation_id == admitted.id)
            .unwrap();
        assert_eq!(
            gateway
                .recover(&store, "actor-a", &scope(), &attempt.id)
                .await
                .unwrap(),
            SourceFact::AuthoritativelyAbsent
        );
    }

    let (basis, operation) = fixture(&pool, "late_send", &mut policies, &endpoint.source).await;
    let markers = Markers::new();
    save_basis(&markers, &basis);
    let delayed = helper(
        &configuration,
        &endpoint,
        "delay_consumed",
        &operation.id,
        &markers,
    );
    markers.wait("consumed").await;
    let attempts = store
        .unresolved("actor-a", &scope(), &basis.task_id, None)
        .await
        .unwrap()
        .attempts;
    assert_eq!(
        gateway
            .recover(&store, "actor-a", &scope(), &attempts[0].id)
            .await
            .unwrap(),
        SourceFact::AuthoritativelyAbsent
    );
    let basis = fresh_basis(&pool, &basis).await;
    assert_eq!(
        gateway
            .dispatch(&store, &basis, &operation.id)
            .await
            .unwrap(),
        SourceFact::Completed
    );
    std::fs::write(markers.0.join("release"), b"ready").unwrap();
    assert_eq!(
        child_outcome(delayed, &markers).await,
        "authoritatively_absent"
    );
    assert_eq!(
        endpoint.effects(&operation.id),
        1,
        "source fence rejects old dispatch after certified absence"
    );
    assert_eq!(
        gateway
            .recover(&store, "actor-a", &scope(), &attempts[0].id)
            .await
            .unwrap(),
        SourceFact::AuthoritativelyAbsent,
        "old attempt tombstone survives another attempt completing the logical operation"
    );
    assert_eq!(
        endpoint
            .events()
            .iter()
            .filter(|event| event.operation_id == operation.id)
            .map(|event| event.kind)
            .collect::<Vec<_>>(),
        vec!["lookup", "send", "send", "lookup"]
    );

    for (key, fault) in [
        ("wrong_response_operation", Fault::WrongOperation),
        ("wrong_response_attempt", Fault::WrongAttempt),
        ("wrong_response_fingerprint", Fault::WrongFingerprint),
        ("wrong_response_source", Fault::WrongSource),
    ] {
        let (basis, operation) = fixture(&pool, key, &mut policies, &endpoint.source).await;
        endpoint.fault(fault);
        assert_eq!(
            gateway
                .dispatch(&store, &basis, &operation.id)
                .await
                .unwrap(),
            SourceFact::Unknown
        );
        assert_eq!(endpoint.effects(&operation.id), 1);
        let attempts = store
            .unresolved("actor-a", &scope(), &basis.task_id, None)
            .await
            .unwrap()
            .attempts;
        assert_eq!(attempts.len(), 1);
        assert_eq!(attempts[0].observed, SourceFact::Unknown);
        endpoint.fault(fault);
        assert_eq!(
            gateway
                .recover(&store, "actor-a", &scope(), &attempts[0].id)
                .await
                .unwrap(),
            SourceFact::Unknown
        );
        assert_eq!(
            gateway
                .recover(&store, "actor-a", &scope(), &attempts[0].id)
                .await
                .unwrap(),
            SourceFact::Completed
        );
        assert_eq!(endpoint.effects(&operation.id), 1);
    }

    let (basis, operation) = fixture(&pool, "pending", &mut policies, &endpoint.source).await;
    endpoint.fault(Fault::AcceptPending);
    assert_eq!(
        gateway
            .dispatch(&store, &basis, &operation.id)
            .await
            .unwrap(),
        SourceFact::Accepted
    );
    let attempts = store
        .unresolved("actor-a", &scope(), &basis.task_id, None)
        .await
        .unwrap()
        .attempts;
    assert_eq!(
        gateway
            .recover(&store, "actor-a", &scope(), &attempts[0].id)
            .await
            .unwrap(),
        SourceFact::Accepted
    );
    assert!(
        gateway
            .dispatch(&store, &basis, &operation.id)
            .await
            .is_err()
    );
    assert_eq!(endpoint.effects(&operation.id), 0);
    for _ in 0..40 {
        assert_eq!(
            gateway
                .recover(&store, "actor-a", &scope(), &attempts[0].id)
                .await
                .unwrap(),
            SourceFact::Accepted
        );
    }
    let slots: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM public.operation_receipt_slots WHERE attempt_id=$1",
    )
    .bind(&attempts[0].id)
    .fetch_one(&mut inspector)
    .await
    .unwrap();
    assert_eq!(
        slots, 2,
        "normal pending polls reuse one receipt custody alongside the dispatch producer"
    );
    endpoint.set_resource_version("version-2");
    assert!(!endpoint.complete_pending(&operation.id));
    assert_eq!(endpoint.effects(&operation.id), 0);
    assert_eq!(
        gateway
            .recover(&store, "actor-a", &scope(), &attempts[0].id)
            .await
            .unwrap(),
        SourceFact::Accepted
    );
    endpoint.set_resource_version("version-1");
    endpoint.set_clock(Some(operation.request.expires_at));
    assert!(!endpoint.complete_pending(&operation.id));
    assert_eq!(endpoint.effects(&operation.id), 0);
    endpoint.set_clock(None);
    assert!(endpoint.complete_pending(&operation.id));
    assert_eq!(
        gateway
            .recover(&store, "actor-a", &scope(), &attempts[0].id)
            .await
            .unwrap(),
        SourceFact::Completed
    );
    assert_eq!(endpoint.effects(&operation.id), 1);

    let (basis, operation) = fixture(&pool, "unknown", &mut policies, &endpoint.source).await;
    endpoint.fault(Fault::DropBeforeAccept);
    assert_eq!(
        gateway
            .dispatch(&store, &basis, &operation.id)
            .await
            .unwrap(),
        SourceFact::Unknown
    );
    let attempts = store
        .unresolved("actor-a", &scope(), &basis.task_id, None)
        .await
        .unwrap()
        .attempts;
    for _ in 0..40 {
        endpoint.fault(Fault::UnknownLookup);
        assert_eq!(
            gateway
                .recover(&store, "actor-a", &scope(), &attempts[0].id)
                .await
                .unwrap(),
            SourceFact::Unknown
        );
    }
    let slots: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM public.operation_receipt_slots WHERE attempt_id=$1",
    )
    .bind(&attempts[0].id)
    .fetch_one(&mut inspector)
    .await
    .unwrap();
    assert_eq!(
        slots, 2,
        "normal unknown polls cannot exhaust replacement-producer capacity"
    );
    endpoint.fault(Fault::UnknownLookup);
    assert_eq!(
        gateway
            .recover(&store, "actor-a", &scope(), &attempts[0].id)
            .await
            .unwrap(),
        SourceFact::Unknown
    );
    assert!(
        gateway
            .dispatch(&store, &basis, &operation.id)
            .await
            .is_err()
    );
    for fault in [Fault::OversizedReply, Fault::OversizedReplyWithoutLength] {
        endpoint.fault(fault);
        assert_eq!(
            gateway
                .recover(&store, "actor-a", &scope(), &attempts[0].id)
                .await
                .unwrap(),
            SourceFact::Unknown
        );
    }
    assert_eq!(endpoint.effects(&operation.id), 0);
    assert_eq!(
        store
            .unresolved("actor-a", &scope(), &basis.task_id, None)
            .await
            .unwrap()
            .attempts
            .len(),
        1
    );
    let (basis, operation) = fixture(
        &pool,
        "connection_released",
        &mut policies,
        &endpoint.source,
    )
    .await;
    endpoint.fault(Fault::HoldReply);
    let concurrent_store = store.clone();
    let concurrent_gateway = gateway.clone();
    let operation_id = operation.id.clone();
    let dispatch = tokio::spawn(async move {
        concurrent_gateway
            .dispatch(&concurrent_store, &basis, &operation_id)
            .await
    });
    timeout(WAIT, async {
        while endpoint.effects(&operation.id) == 0 {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    // The same pool has exactly one connection. This read can succeed while
    // source I/O remains deliberately held only if dispatch released custody.
    assert_eq!(
        timeout(
            Duration::from_millis(500),
            store.get("actor-a", &scope(), &operation.id)
        )
        .await
        .unwrap()
        .unwrap()
        .state,
        OperationState::PossiblyDispatched
    );
    assert!(!dispatch.is_finished());
    endpoint.release_reply();
    assert_eq!(dispatch.await.unwrap().unwrap(), SourceFact::Completed);

    let (basis, operation) = fixture(&pool, "stop_consumed", &mut policies, &endpoint.source).await;
    let markers = Markers::new();
    save_basis(&markers, &basis);
    let delayed = helper(
        &configuration,
        &endpoint,
        "delay_consumed",
        &operation.id,
        &markers,
    );
    markers.wait("consumed").await;
    let tasks = TaskRepository::new(pool.clone());
    tasks
        .admit(
            "actor-a",
            &scope(),
            &TaskCommand {
                key: "stop_after_consumption".into(),
                kind: CommandKind::Stop,
                task_id: Some(basis.task_id.clone()),
                cycle_id: Some(basis.cycle_id.clone()),
                content: None,
            },
        )
        .await
        .unwrap();
    let stopped = tasks
        .get("actor-a", &scope(), &basis.task_id)
        .await
        .unwrap();
    assert_eq!(stopped.state, TaskState::Stopped);
    assert_eq!(stopped.cessation, Cessation::Pending);
    assert_eq!(endpoint.effects(&operation.id), 0);
    std::fs::write(markers.0.join("release"), b"ready").unwrap();
    assert_eq!(child_outcome(delayed, &markers).await, "completed");
    assert_eq!(endpoint.effects(&operation.id), 1);
    assert_eq!(
        tasks
            .get("actor-a", &scope(), &basis.task_id)
            .await
            .unwrap()
            .state,
        TaskState::Stopped
    );
    assert_eq!(
        store
            .get("actor-a", &scope(), &operation.id)
            .await
            .unwrap()
            .state,
        OperationState::Completed
    );

    // Revocation after the cutoff removes all current reads/recovery while the
    // original producer's exact receipt remains admissible as a historical fact.
    let (basis, operation) =
        fixture(&pool, "revoked_consumed", &mut policies, &endpoint.source).await;
    let markers = Markers::new();
    save_basis(&markers, &basis);
    let delayed = helper(
        &configuration,
        &endpoint,
        "delay_consumed",
        &operation.id,
        &markers,
    );
    markers.wait("consumed").await;
    let (cached_basis, cached_operation) = fixture(
        &pool,
        "cached_recovery_revocation",
        &mut policies,
        &endpoint.source,
    )
    .await;
    endpoint.fault(Fault::DropAfterEffect);
    assert_eq!(
        gateway
            .dispatch(&store, &cached_basis, &cached_operation.id)
            .await
            .unwrap(),
        SourceFact::Unknown
    );
    let cached_attempt = store
        .unresolved("actor-a", &scope(), &cached_basis.task_id, None)
        .await
        .unwrap()
        .attempts
        .remove(0);
    endpoint.fault(Fault::UnknownLookup);
    assert_eq!(
        gateway
            .recover(&store, "actor-a", &scope(), &cached_attempt.id)
            .await
            .unwrap(),
        SourceFact::Unknown
    );
    let mut admin = PgConnection::connect(&configuration.admin).await.unwrap();
    configuration.guard_connection(&mut admin).await;
    admin.execute("UPDATE public.organisation_memberships SET active=false WHERE organisation_id='org-a' AND actor_id='actor-a'").await.unwrap();
    let before = endpoint.events().len();
    assert_eq!(
        gateway
            .recover(&store, "actor-a", &scope(), &cached_attempt.id)
            .await,
        Err(OperationError::Denied)
    );
    assert_eq!(
        endpoint.events().len(),
        before,
        "cached custody needs fresh authority before each source lookup"
    );
    assert_eq!(
        store.get("actor-a", &scope(), &operation.id).await,
        Err(OperationError::Denied)
    );
    let attempt = std::fs::read_to_string(markers.0.join("consumed")).unwrap();
    assert!(matches!(
        store.recover("actor-a", &scope(), &attempt).await,
        Err(OperationError::Denied)
    ));
    std::fs::write(markers.0.join("release"), b"ready").unwrap();
    assert_eq!(child_outcome(delayed, &markers).await, "completed");
    assert_eq!(endpoint.effects(&operation.id), 1);
    let receipt_count: i64 = sqlx::query_scalar("SELECT count(*) FROM public.operation_receipts WHERE attempt_id=$1 AND outcome='completed'").bind(attempt).fetch_one(&mut admin).await.unwrap();
    assert_eq!(receipt_count, 1);
    pool.close().await;
}
