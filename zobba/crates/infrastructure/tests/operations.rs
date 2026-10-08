//! Real PostgreSQL authority, exact-operation, cutoff and receipt contracts.
//! The single async test owns one explicitly guarded disposable schema.
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{Connection, Executor, PgConnection, PgPool, postgres::PgPoolOptions};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use zobba_application::{
    operation::{OperationError, OperationStore, wire::*},
    task::{TaskCommands, TaskError},
};
use zobba_domain::{
    identity::Scope,
    permissions::*,
    task::{
        Cessation, ClaimBasis, CommandKind, CommandReceipt, ConsumedAttempt, Decision, Observation,
        TaskCommand, TaskState, WakeupRoute,
    },
};
use zobba_infrastructure::{
    database_options, fixture::seed_local_configured, migrate, operation::OperationRepository,
    scope as scoped, task::TaskRepository,
};
#[path = "operations/methodology_execution.rs"]
mod methodology_execution;
#[path = "operations/model_execution.rs"]
mod model_execution;
#[path = "operations/policy_revisions.rs"]
mod policy_revisions;
#[path = "operations/review_repairs.rs"]
mod review_repairs;
mod support;
#[path = "operations/task_reconciliation.rs"]
mod task_reconciliation;
#[path = "operations/work_cycle.rs"]
mod work_cycle;
use support::Configuration;

const GATE: i64 = 20_050_099;
const APP: &str = "zobba-operation-contract";
fn selected(suffix: &str) -> Scope {
    Scope {
        organisation_id: format!("org-{suffix}"),
        client_id: format!("client-{suffix}"),
        engagement_id: format!("engagement-{suffix}"),
    }
}
fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn source() -> SourceBinding {
    SourceBinding {
        source_id: "fixture-source".into(),
        ledger_id: "fixture-ledger".into(),
        endpoint_digest: "a".repeat(64),
        contract_version: 1,
    }
}
fn request(material: &str) -> CanonicalOperation {
    CanonicalOperation {
        version: 1,
        purpose: Purpose::AuditCoordination,
        action: Action::Send,
        account_id: "audit-account".into(),
        environment_id: "audit-environment".into(),
        destination: "owned-endpoint".into(),
        recipients: vec!["recipient-a".into()],
        material: material.into(),
        material_digest: hash(material.as_bytes()),
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
fn bounds() -> PermissionBounds {
    let r = request("fixture");
    PermissionBounds {
        rules: vec![PermissionRule {
            purpose: r.purpose,
            action: r.action,
            account_id: r.account_id,
            environment_id: r.environment_id,
            destination: r.destination,
            resource_id: r.resource_id,
            recipients: r.recipients,
            attachment_classifications: vec!["audit".into()],
            expires_at: r.expires_at,
        }],
    }
}
fn policy(kind: PolicyKind, subject: &str) -> PolicyDocument {
    PolicyDocument {
        schema_version: 1,
        kind,
        subject_id: subject.into(),
        version: 1,
        actor_id: "actor-manager".into(),
        created_at: now(),
        revoked: false,
        hard: bounds(),
        standing: bounds(),
        parent: None,
        account: (kind == PolicyKind::Account).then(|| AccountRestriction {
            source: source(),
            account_id: "audit-account".into(),
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
fn authority() -> AuthoritySnapshot {
    AuthoritySnapshot {
        scope: selected("a"),
        actor_id: "actor-a".into(),
        task_id: "placeholder".into(),
        organisation: policy(PolicyKind::Organisation, "org-a"),
        engagement: policy(PolicyKind::Engagement, "engagement-a"),
        member: policy(PolicyKind::Member, "actor-a"),
        account: policy(PolicyKind::Account, "audit-account"),
        task: policy(PolicyKind::Task, "placeholder"),
        delegations: vec![],
    }
}
fn command(key: &str, kind: CommandKind, receipt: &CommandReceipt) -> TaskCommand {
    TaskCommand {
        context: None,
        key: key.into(),
        kind,
        task_id: Some(receipt.task_id.clone()),
        cycle_id: Some(receipt.cycle_id.clone()),
        content: (kind == CommandKind::Guide).then(|| "Changed exact direction".into()),
    }
}
fn route(receipt: &CommandReceipt) -> WakeupRoute {
    WakeupRoute {
        id: receipt.task_id.clone(),
        actor_id: "actor-a".into(),
        scope: selected("a"),
        task_id: receipt.task_id.clone(),
    }
}
fn execution(value: Decision) -> ClaimBasis {
    match value {
        Decision::Execute(b) => *b,
        other => panic!("expected current producing basis, got {other:?}"),
    }
}
fn exact(operation: &Operation, key: &str) -> DecisionCommand {
    DecisionCommand {
        key: key.into(),
        operation_id: operation.id.clone(),
        expected_revision: operation.revision,
        request: operation.request.clone(),
        expires_at: operation.request.expires_at,
        allow: true,
    }
}
async fn runtime_pool(configuration: &Configuration, max: u32) -> PgPool {
    PgPoolOptions::new()
        .max_connections(max)
        .acquire_timeout(Duration::from_secs(2))
        .connect_with(
            database_options(&configuration.runtime)
                .unwrap()
                .application_name(APP),
        )
        .await
        .unwrap()
}
struct Case {
    receipt: CommandReceipt,
    basis: ClaimBasis,
    authority: AuthoritySnapshot,
    request: CanonicalOperation,
}
struct Fixture {
    pool: PgPool,
    operations: OperationRepository,
    tasks: TaskRepository,
    authority: AuthoritySnapshot,
}
impl Fixture {
    async fn new(pool: PgPool) -> Self {
        let operations = OperationRepository::new(pool.clone());
        let authority = authority();
        for document in [
            &authority.organisation,
            &authority.engagement,
            &authority.member,
            &authority.account,
        ] {
            operations
                .save_policy("actor-manager", &selected("a"), document)
                .await
                .unwrap();
        }
        Self {
            tasks: TaskRepository::new(pool.clone()),
            pool,
            operations,
            authority,
        }
    }
    async fn case(&self, name: &str, standing: bool, depth: usize) -> Case {
        let receipt = self
            .tasks
            .admit(
                "actor-a",
                &selected("a"),
                &TaskCommand {
                    context: None,
                    key: name.into(),
                    kind: CommandKind::Create,
                    task_id: None,
                    cycle_id: None,
                    content: Some(format!("Synthetic case {name}")),
                },
            )
            .await
            .unwrap();
        let mut authority = self.authority.clone();
        authority.task_id = receipt.task_id.clone();
        authority.task = policy(PolicyKind::Task, &receipt.task_id);
        authority.task.actor_id = "actor-a".into();
        if !standing {
            authority.task.standing.rules.clear();
        }
        for index in 0..depth {
            let mut delegation =
                policy(PolicyKind::Delegation, &format!("{name}-ancestor-{index}"));
            delegation.parent = Some(
                authority
                    .delegations
                    .last()
                    .unwrap_or(&authority.task)
                    .reference(),
            );
            self.operations
                .save_policy("actor-manager", &selected("a"), &delegation)
                .await
                .unwrap();
            authority.delegations.push(delegation);
        }
        authority.task.created_at = now();
        self.operations
            .accept_authority("actor-a", &selected("a"), &receipt.task_id, &authority)
            .await
            .unwrap();
        let t1 = std::time::Instant::now();
        let basis = execution(
            self.tasks
                .coordinate(&route(&receipt), &format!("worker-{name}"))
                .await
                .unwrap(),
        );
        eprintln!("DEBUGZ coordinate {name} took {:?}", t1.elapsed());
        Case {
            receipt,
            basis,
            authority,
            request: request(name),
        }
    }
    async fn admit(&self, case: &Case, key: &str) -> Operation {
        self.operations
            .admit("actor-a", &selected("a"), &case.basis, key, &case.request)
            .await
            .unwrap()
    }
    async fn save_organisation(&mut self, mut doc: PolicyDocument) {
        doc.version = self.authority.organisation.version + 1;
        doc.created_at = now();
        doc.actor_id = "actor-manager".into();
        self.operations
            .save_policy("actor-manager", &selected("a"), &doc)
            .await
            .unwrap();
        self.authority.organisation = doc;
    }
}

#[test]
fn owned_storage_roundtrips_and_refuses_ambiguous_durable_fields() {
    let request = request("Exact reviewable material\nΩ");
    let text = serde_json::to_string(&StoredCanonical(request.clone())).unwrap();
    let decoded: StoredCanonical = serde_json::from_str(&text).unwrap();
    assert_eq!(decoded.0, request);
    assert_eq!(decoded.0.canonical_bytes(), request.canonical_bytes());
    let snapshot = authority();
    let stored = serde_json::to_string(&StoredAuthority(snapshot.clone())).unwrap();
    assert_eq!(
        serde_json::from_str::<StoredAuthority>(&stored).unwrap().0,
        snapshot
    );
    for extra in [
        "\"purpose\":\"live_inspection\",",
        "\"unreviewed_field\":true,",
    ] {
        assert!(
            serde_json::from_str::<StoredCanonical>(&text.replacen('{', &format!("{{{extra}"), 1))
                .is_err()
        );
    }
    let mut value: Value = serde_json::from_str(&text).unwrap();
    value["attachments"][0]["capability"] = json!("secret-canary");
    assert!(serde_json::from_value::<StoredCanonical>(value).is_err());
    let mut snapshot_value: Value = serde_json::from_str(&stored).unwrap();
    snapshot_value["account"]["account"]["unverified_override"] = json!(true);
    assert!(serde_json::from_value::<StoredAuthority>(snapshot_value).is_err());
}

#[test]
fn maximal_valid_owned_wire_values_fit_durable_byte_envelopes() {
    let id = "x".repeat(128);
    let ids: Vec<String> = (0..SET_MAX)
        .map(|index| format!("{index:02}{}", "x".repeat(126)))
        .collect();
    let material = "\t".repeat(MATERIAL_MAX);
    let canonical = CanonicalOperation {
        version: OPERATION_VERSION,
        purpose: Purpose::AuditCoordination,
        action: Action::Write,
        account_id: id.clone(),
        environment_id: id.clone(),
        destination: id.clone(),
        recipients: ids.clone(),
        material_digest: hash(material.as_bytes()),
        material,
        attachments: ids
            .iter()
            .map(|id| Attachment {
                id: id.clone(),
                digest: "f".repeat(64),
                classification: "x".repeat(128),
            })
            .collect(),
        resource_id: id.clone(),
        resource_version: id.clone(),
        expires_at: MAX_TIMESTAMP,
    };
    assert!(canonical.is_valid());
    let rule = PermissionRule {
        purpose: canonical.purpose,
        action: canonical.action,
        account_id: id.clone(),
        environment_id: id.clone(),
        destination: id.clone(),
        resource_id: id.clone(),
        recipients: ids.clone(),
        attachment_classifications: ids.clone(),
        expires_at: MAX_TIMESTAMP,
    };
    let bounds = PermissionBounds {
        rules: vec![rule; POLICY_RULES_MAX],
    };
    let make = |kind, subject_id: String| PolicyDocument {
        schema_version: 1,
        kind,
        subject_id,
        version: i64::MAX as u64,
        actor_id: id.clone(),
        created_at: MAX_TIMESTAMP,
        revoked: false,
        hard: bounds.clone(),
        standing: bounds.clone(),
        parent: None,
        account: None,
    };
    let mut account = make(PolicyKind::Account, id.clone());
    account.account = Some(AccountRestriction {
        source: source(),
        account_id: id.clone(),
        environment_id: id.clone(),
        environment: EnvironmentKind::Audit,
        read_restriction: ReadRestriction::ValidatedAdapter,
        restriction_survives_takeover: false,
        test_environment_verified: false,
        test_resources: ids.clone(),
        test_cleanup_id: Some(id.clone()),
        audit_resources: ids.clone(),
    });
    let mut snapshot = AuthoritySnapshot {
        scope: Scope {
            organisation_id: id.clone(),
            client_id: id.clone(),
            engagement_id: id.clone(),
        },
        actor_id: id.clone(),
        task_id: id.clone(),
        organisation: make(PolicyKind::Organisation, id.clone()),
        engagement: make(PolicyKind::Engagement, id.clone()),
        member: make(PolicyKind::Member, id.clone()),
        account,
        task: make(PolicyKind::Task, id.clone()),
        delegations: vec![],
    };
    for subject in ids.iter().take(DELEGATION_MAX) {
        let mut delegation = make(PolicyKind::Delegation, subject.clone());
        delegation.parent = Some(
            snapshot
                .delegations
                .last()
                .unwrap_or(&snapshot.task)
                .reference(),
        );
        snapshot.delegations.push(delegation);
    }
    assert!(snapshot.is_valid());
    let policy_bytes = snapshot
        .documents()
        .map(|document| {
            serde_json::to_vec(&StoredPolicy(document.clone()))
                .unwrap()
                .len()
        })
        .max()
        .unwrap();
    let snapshot_bytes = serde_json::to_vec(&StoredAuthority(snapshot))
        .unwrap()
        .len();
    let canonical_bytes = serde_json::to_vec(&StoredCanonical(canonical.clone()))
        .unwrap()
        .len();
    let decision = DecisionCommand {
        key: id.clone(),
        operation_id: id,
        expected_revision: i64::MAX as u64,
        request: canonical,
        expires_at: MAX_TIMESTAMP,
        allow: false,
    };
    assert!(decision.is_valid());
    let decision_bytes = serde_json::to_vec(&StoredDecision(decision)).unwrap().len();
    assert!(
        canonical_bytes <= 32_768,
        "maximal valid canonical request exceeds operation storage"
    );
    assert!(
        decision_bytes <= 32_768,
        "maximal valid decision exceeds decision storage"
    );
    assert!(
        policy_bytes <= 131_072,
        "maximal valid policy exceeds immutable policy storage"
    );
    assert!(
        snapshot_bytes <= 1_048_576,
        "full maximum delegation snapshot exceeds durable authority storage"
    );
    println!(
        "maximal valid wire bytes: canonical={canonical_bytes}, decision={decision_bytes}, policy={policy_bytes}, authority={snapshot_bytes}"
    );
}

async fn wait_for_blockers(admin: &mut PgConnection, minimum: i64) -> i32 {
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        let blocked: Vec<i32> = sqlx::query_scalar("SELECT pid FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' ORDER BY query_start")
            .bind(APP).fetch_all(&mut *admin).await.unwrap();
        if blocked.len() >= minimum as usize {
            return blocked[0];
        }
        assert!(
            Instant::now() < deadline,
            "real repository transactions did not reach the expected database lock boundary"
        );
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
}
async fn gate(admin: &mut PgConnection, holder: &mut PgConnection, table: &str) {
    assert!(matches!(
        table,
        "operations" | "operation_attempts" | "task_commands" | "permission_versions"
    ));
    admin.execute(format!("CREATE FUNCTION public.operation_fixture_gate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_catalog.pg_advisory_xact_lock({GATE}); RETURN NEW; END $$; CREATE CONSTRAINT TRIGGER operation_fixture_gate AFTER INSERT ON public.{table} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.operation_fixture_gate()").as_str()).await.unwrap();
    sqlx::query("SELECT pg_advisory_lock($1)")
        .bind(GATE)
        .execute(holder)
        .await
        .unwrap();
}
async fn release(holder: &mut PgConnection) {
    sqlx::query("SELECT pg_advisory_unlock($1)")
        .bind(GATE)
        .execute(holder)
        .await
        .unwrap();
}
async fn ungate(admin: &mut PgConnection, table: &str) {
    admin.execute(format!("DROP TRIGGER operation_fixture_gate ON public.{table}; DROP FUNCTION public.operation_fixture_gate()").as_str()).await.unwrap();
}

async fn logical_admission_and_atomicity(
    f: &Fixture,
    admin: &mut PgConnection,
    holder: &mut PgConnection,
) {
    let case = f.case("logical-admission", true, 0).await;
    gate(admin, holder, "operations").await;
    let repo = f.operations.clone();
    let basis = case.basis.clone();
    let request = case.request.clone();
    let pending = tokio::spawn(async move {
        repo.admit(
            "actor-a",
            &selected("a"),
            &basis,
            "rollback-operation",
            &request,
        )
        .await
    });
    let pid = wait_for_blockers(admin, 1).await;
    let before: i64 =
        sqlx::query_scalar("SELECT count(*) FROM public.operations WHERE key='rollback-operation'")
            .fetch_one(&mut *admin)
            .await
            .unwrap();
    assert_eq!(
        before, 0,
        "operation became visible before successful commit"
    );
    assert!(!pending.is_finished());
    assert!(
        sqlx::query_scalar::<_, bool>("SELECT pg_cancel_backend($1)")
            .bind(pid)
            .fetch_one(&mut *admin)
            .await
            .unwrap()
    );
    assert_eq!(pending.await.unwrap(), Err(OperationError::Unavailable));
    release(holder).await;
    ungate(admin, "operations").await;
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM public.operations WHERE key='rollback-operation'"
        )
        .fetch_one(&mut *admin)
        .await
        .unwrap(),
        0
    );
    // Discard the successful admission return to model a lost caller ACK.
    drop(f.admit(&case, "stable-logical-intent").await);
    let recorded: String =
        sqlx::query_scalar("SELECT id FROM public.operations WHERE key='stable-logical-intent'")
            .fetch_one(&mut *admin)
            .await
            .unwrap();
    sqlx::query(
        "UPDATE public.tasks SET owner_until=clock_timestamp()-interval '1 second' WHERE id=$1",
    )
    .bind(&case.receipt.task_id)
    .execute(&mut *admin)
    .await
    .unwrap();
    let replacement = execution(
        f.tasks
            .coordinate(&route(&case.receipt), "replacement-owner")
            .await
            .unwrap(),
    );
    assert_ne!(replacement.owner_epoch, case.basis.owner_epoch);
    assert_ne!(replacement.claim_id, case.basis.claim_id);
    assert_ne!(replacement.process_instance, case.basis.process_instance);
    let retried = f
        .operations
        .admit(
            "actor-a",
            &selected("a"),
            &replacement,
            "stable-logical-intent",
            &case.request,
        )
        .await
        .unwrap();
    assert_eq!(retried.id, recorded);
    let mut changed = case.request.clone();
    changed.material.push('!');
    changed.material_digest = hash(changed.material.as_bytes());
    assert_eq!(
        f.operations
            .admit(
                "actor-a",
                &selected("a"),
                &replacement,
                "stable-logical-intent",
                &changed
            )
            .await,
        Err(OperationError::Conflict)
    );
    let (left, right) = tokio::join!(
        f.operations.consume(&replacement, &retried.id),
        f.operations.consume(&replacement, &retried.id)
    );
    let consumed = match (left, right) {
        (Ok(a), Err(OperationError::Fenced)) | (Err(OperationError::Fenced), Ok(a)) => a,
        _ => panic!("competing gateways did not consume exactly once"),
    };
    assert_ne!(consumed.operation_id, consumed.attempt_id);
    assert_ne!(consumed.attempt_id, consumed.claim_id);
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM public.operation_attempts WHERE operation_id=$1"
        )
        .bind(&retried.id)
        .fetch_one(&mut *admin)
        .await
        .unwrap(),
        1
    );
    f.operations
        .observe(&consumed, SourceFact::Completed)
        .await
        .unwrap();
    let again = f
        .operations
        .admit(
            "actor-a",
            &selected("a"),
            &replacement,
            "stable-logical-intent",
            &case.request,
        )
        .await
        .unwrap();
    assert_eq!(again.id, retried.id);
    assert_eq!(again.state, OperationState::Completed);
}

async fn exact_decisions(f: &Fixture, admin: &mut PgConnection) {
    let case = f.case("exact-decisions", false, 0).await;
    let operation = f.admit(&case, "reviewable-operation").await;
    assert_eq!(operation.state, OperationState::NeedsDecision);
    assert!(matches!(
        f.operations.consume(&case.basis, &operation.id).await,
        Err(OperationError::NeedsDecision)
    ));
    let decision = exact(&operation, "exact-human-allow");
    for field in 0..15 {
        let mut changed = decision.clone();
        match field {
            0 => changed.request.account_id = "other".into(),
            1 => changed.request.environment_id = "other".into(),
            2 => changed.request.destination = "other".into(),
            3 => changed.request.recipients = vec!["recipient-b".into()],
            4 => {
                changed.request.material.push('!');
                changed.request.material_digest = hash(changed.request.material.as_bytes());
            }
            5 => changed.request.material_digest = "b".repeat(64),
            6 => changed.request.attachments[0].id = "other".into(),
            7 => changed.request.attachments[0].digest = "c".repeat(64),
            8 => changed.request.attachments[0].classification = "other".into(),
            9 => changed.request.resource_id = "other".into(),
            10 => changed.request.resource_version = "v2".into(),
            11 => changed.request.purpose = Purpose::TestWorkflows,
            12 => changed.request.action = Action::Write,
            13 => {
                changed.request.expires_at -= 1;
                changed.expires_at -= 1;
            }
            _ => changed.request.version = 2,
        }
        assert!(
            matches!(
                f.operations
                    .decide("actor-a", &selected("a"), &changed)
                    .await,
                Err(OperationError::Conflict | OperationError::Invalid)
            ),
            "material substitution {field} was not refused"
        );
    }
    for (revision, expiry) in [
        (operation.revision + 1, decision.expires_at),
        (operation.revision, 1),
    ] {
        let mut changed = decision.clone();
        changed.expected_revision = revision;
        changed.expires_at = expiry;
        assert_eq!(
            f.operations
                .decide("actor-a", &selected("a"), &changed)
                .await,
            Err(OperationError::Conflict)
        );
    }
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM public.operation_decisions WHERE operation_id=$1"
        )
        .bind(&operation.id)
        .fetch_one(&mut *admin)
        .await
        .unwrap(),
        0
    );
    let original = f
        .operations
        .decide("actor-manager", &selected("a"), &decision)
        .await
        .unwrap();
    assert_eq!(original.actor_id, "actor-manager");
    assert_eq!(
        f.operations
            .decide("actor-manager", &selected("a"), &decision)
            .await
            .unwrap(),
        original
    );
    for roles in [vec!["auditor"], vec!["admin"]] {
        sqlx::query("UPDATE public.organisation_memberships SET roles=$1 WHERE organisation_id='org-a' AND actor_id='actor-manager'")
            .bind(roles).execute(&mut *admin).await.unwrap();
        assert_eq!(
            f.operations
                .decide("actor-manager", &selected("a"), &decision)
                .await,
            Err(OperationError::Denied),
            "a demoted decision author cannot adopt the original receipt through idempotent retry"
        );
        let mut new_decision = decision.clone();
        new_decision.key = "demoted-manager-new-decision".into();
        assert_eq!(
            f.operations
                .decide("actor-manager", &selected("a"), &new_decision)
                .await,
            Err(OperationError::Denied),
            "an assigned peer Auditor or Admin alone cannot decide another actor's Task operation"
        );
    }
    sqlx::query("UPDATE public.organisation_memberships SET roles=ARRAY['audit_manager','admin'] WHERE organisation_id='org-a' AND actor_id='actor-manager'")
        .execute(&mut *admin).await.unwrap();
    let mut owner_decision = decision.clone();
    owner_decision.key = "accountable-owner-decision".into();
    assert_eq!(
        f.operations
            .decide("actor-a", &selected("a"), &owner_decision)
            .await
            .unwrap()
            .actor_id,
        "actor-a"
    );
    let mut changed = decision.clone();
    changed.allow = false;
    assert_eq!(
        f.operations
            .decide("actor-manager", &selected("a"), &changed)
            .await,
        Err(OperationError::Conflict)
    );
    let projection = f
        .operations
        .get("actor-manager", &selected("a"), &operation.id)
        .await
        .unwrap();
    assert_eq!(
        projection.actor_id, "actor-a",
        "deciding actor replaced immutable producer attribution"
    );
    let consumed = f
        .operations
        .consume(&case.basis, &operation.id)
        .await
        .unwrap();
    let public = serde_json::to_string(&StoredOperation(projection)).unwrap();
    assert!(!public.contains(&consumed.receipt_capability));
    assert!(!public.contains("receipt_capability"));
    assert!(!public.contains("custody"));
    f.operations
        .observe(&consumed, SourceFact::Completed)
        .await
        .unwrap();
    let expiring = f.case("consumption-expiry", false, 0).await;
    let operation = f.admit(&expiring, "consumption-expiry-op").await;
    let mut short_decision = exact(&operation, "short-decision");
    short_decision.expires_at = now() + 2;
    f.operations
        .decide("actor-a", &selected("a"), &short_decision)
        .await
        .unwrap();
    assert_eq!(
        f.operations
            .get("actor-a", &selected("a"), &operation.id)
            .await
            .unwrap()
            .state,
        OperationState::Ready
    );
    while now() < short_decision.expires_at {
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert!(
        matches!(
            f.operations.consume(&expiring.basis, &operation.id).await,
            Err(OperationError::NeedsDecision)
        ),
        "a previously valid exact decision cannot dispatch after its own expiry"
    );
}

async fn intersected_policy_and_lineage(f: &mut Fixture) {
    let case = f.case("frozen-standing", false, 0).await;
    let operation = f.admit(&case, "frozen-standing-op").await;
    let mut enlarged_task = case.authority.task.clone();
    enlarged_task.version += 1;
    enlarged_task.standing = bounds();
    f.operations
        .save_policy("actor-a", &selected("a"), &enlarged_task)
        .await
        .unwrap();
    assert!(matches!(
        f.operations.consume(&case.basis, &operation.id).await,
        Err(OperationError::NeedsDecision)
    ));
    let mut changed_request = case.request.clone();
    changed_request.recipients = vec!["recipient-b".into()];
    let mut broader = f.authority.organisation.clone();
    broader.hard.rules[0].recipients.push("recipient-b".into());
    broader.standing = broader.hard.clone();
    f.save_organisation(broader).await;
    assert!(matches!(
        f.operations
            .admit(
                "actor-a",
                &selected("a"),
                &case.basis,
                "unaccepted-widening",
                &changed_request
            )
            .await,
        Err(OperationError::Denied)
    ));

    let narrowed_case = f.case("current-narrowing", true, 0).await;
    let narrowed_op = f.admit(&narrowed_case, "current-narrowing-op").await;
    let retained = f.authority.organisation.clone();
    let mut narrow = retained.clone();
    narrow.hard.rules.clear();
    f.save_organisation(narrow).await;
    assert!(matches!(
        f.operations
            .consume(&narrowed_case.basis, &narrowed_op.id)
            .await,
        Err(OperationError::Denied)
    ));
    assert_eq!(
        f.operations
            .get("actor-a", &selected("a"), &narrowed_op.id)
            .await
            .unwrap()
            .state,
        OperationState::Revoked
    );
    f.save_organisation(retained).await;

    let delegated = f.case("full-lineage", true, DELEGATION_MAX).await;
    let delegated_op = f.admit(&delegated, "full-lineage-op").await;
    let middle = &delegated.authority.delegations[DELEGATION_MAX / 2];
    f.operations
        .revoke(
            "actor-manager",
            &selected("a"),
            &RevocationCommand {
                key: "revoke-middle-ancestor".into(),
                kind: PolicyKind::Delegation,
                subject_id: middle.subject_id.clone(),
                expected_version: middle.version,
            },
        )
        .await
        .unwrap();
    assert!(matches!(
        f.operations
            .consume(&delegated.basis, &delegated_op.id)
            .await,
        Err(OperationError::Denied)
    ));
    assert_eq!(
        f.operations
            .get("actor-a", &selected("a"), &delegated_op.id)
            .await
            .unwrap()
            .state,
        OperationState::Revoked
    );
}

#[derive(Clone, Copy, Debug)]
enum Cutoff {
    Stop,
    Guide,
    Revoke,
}
async fn cutoff_races(f: &Fixture, admin: &mut PgConnection, holder: &mut PgConnection) {
    for cutoff in [Cutoff::Stop, Cutoff::Guide, Cutoff::Revoke] {
        for consume_first in [false, true] {
            let name = format!("cutoff-{cutoff:?}-{consume_first}");
            let case = f.case(&name, true, 0).await;
            let operation = f.admit(&case, &format!("{name}-operation")).await;
            let table = if consume_first {
                "operation_attempts"
            } else if matches!(cutoff, Cutoff::Revoke) {
                "permission_versions"
            } else {
                "task_commands"
            };
            gate(admin, holder, table).await;
            let consumer = || {
                let repo = f.operations.clone();
                let basis = case.basis.clone();
                let id = operation.id.clone();
                tokio::spawn(async move { repo.consume(&basis, &id).await })
            };
            let control = || {
                let ops = f.operations.clone();
                let tasks = f.tasks.clone();
                let receipt = case.receipt.clone();
                let key = format!("{name}-control");
                tokio::spawn(async move {
                    if matches!(cutoff, Cutoff::Revoke) {
                        ops.revoke(
                            "actor-a",
                            &selected("a"),
                            &RevocationCommand {
                                key,
                                kind: PolicyKind::Task,
                                subject_id: receipt.task_id,
                                expected_version: 1,
                            },
                        )
                        .await
                        .map(|_| ())
                        .map_err(|e| e.to_string())
                    } else {
                        tasks
                            .admit(
                                "actor-a",
                                &selected("a"),
                                &command(
                                    &key,
                                    if matches!(cutoff, Cutoff::Stop) {
                                        CommandKind::Stop
                                    } else {
                                        CommandKind::Guide
                                    },
                                    &receipt,
                                ),
                            )
                            .await
                            .map(|_| ())
                            .map_err(|e| e.to_string())
                    }
                })
            };
            let (consumption, control) = if consume_first {
                let consumption = consumer();
                wait_for_blockers(admin, 1).await;
                let control = control();
                wait_for_blockers(admin, 2).await;
                (consumption, control)
            } else {
                let control = control();
                wait_for_blockers(admin, 1).await;
                let consumption = consumer();
                wait_for_blockers(admin, 2).await;
                (consumption, control)
            };
            assert!(
                !consumption.is_finished() && !control.is_finished(),
                "both contenders must actually overlap before releasing COMMIT"
            );
            release(holder).await;
            control.await.unwrap().unwrap();
            let result = consumption.await.unwrap();
            ungate(admin, table).await;
            if consume_first {
                let consumed = result.expect("a committed consumption remains possibly dispatched");
                assert_eq!(
                    f.operations
                        .get("actor-a", &selected("a"), &operation.id)
                        .await
                        .unwrap()
                        .state,
                    OperationState::PossiblyDispatched
                );
                f.operations
                    .observe(&consumed, SourceFact::Completed)
                    .await
                    .unwrap();
            } else {
                assert!(
                    matches!(result, Err(OperationError::Fenced | OperationError::Denied)),
                    "control committed first but old consumption was not fenced"
                );
                assert_eq!(
                    sqlx::query_scalar::<_, i64>(
                        "SELECT count(*) FROM public.operation_attempts WHERE operation_id=$1"
                    )
                    .bind(&operation.id)
                    .fetch_one(&mut *admin)
                    .await
                    .unwrap(),
                    0
                );
            }
            assert!(
                f.operations
                    .consume(&case.basis, &operation.id)
                    .await
                    .is_err()
            );
        }
    }
}

async fn facts_and_recovery(f: &Fixture, admin: &mut PgConnection) {
    let case = f.case("receipt-custody", true, 0).await;
    let operation = f.admit(&case, "receipt-custody-op").await;
    let mut consumed = f
        .operations
        .consume(&case.basis, &operation.id)
        .await
        .unwrap();
    consumed.custody = OperationCustody::ReceiptOnly;
    assert!(
        matches!(
            f.operations
                .observe(&consumed, SourceFact::AuthoritativelyAbsent)
                .await,
            Err(OperationError::Denied)
        ),
        "producer supplied custody must not override stored dispatch custody"
    );
    consumed.custody = OperationCustody::Dispatch;
    let mut recovery = f
        .operations
        .recover("actor-a", &selected("a"), &consumed.attempt_id)
        .await
        .unwrap();
    recovery.custody = OperationCustody::Dispatch;
    assert!(
        matches!(
            f.operations.observe(&recovery, SourceFact::Accepted).await,
            Err(OperationError::Denied)
        ),
        "receipt-only custody cannot adopt dispatch attribution"
    );
    recovery.custody = OperationCustody::ReceiptOnly;
    f.operations
        .observe(&consumed, SourceFact::Accepted)
        .await
        .unwrap();
    assert_eq!(
        f.operations
            .get("actor-a", &selected("a"), &operation.id)
            .await
            .unwrap()
            .state,
        OperationState::Accepted
    );
    assert!(
        matches!(
            f.operations
                .observe(&recovery, SourceFact::AuthoritativelyAbsent)
                .await,
            Err(OperationError::Conflict)
        ),
        "an accepted source cannot later be called never accepted"
    );
    f.operations
        .observe(&recovery, SourceFact::Completed)
        .await
        .unwrap();
    assert!(matches!(
        f.operations
            .observe(&consumed, SourceFact::AuthoritativelyAbsent)
            .await,
        Err(OperationError::Invalid | OperationError::Conflict)
    ));

    let case = f.case("contradicting-producers", true, 0).await;
    let operation = f.admit(&case, "contradicting-producers-op").await;
    let consumed = f
        .operations
        .consume(&case.basis, &operation.id)
        .await
        .unwrap();
    let recovery = f
        .operations
        .recover("actor-a", &selected("a"), &consumed.attempt_id)
        .await
        .unwrap();
    let (complete, absent) = tokio::join!(
        f.operations.observe(&consumed, SourceFact::Completed),
        f.operations
            .observe(&recovery, SourceFact::AuthoritativelyAbsent)
    );
    assert!(
        matches!(
            (complete, absent),
            (Ok(()), Err(OperationError::Conflict)) | (Err(OperationError::Conflict), Ok(()))
        ),
        "cross-producer terminal contradictions were both accepted"
    );
    assert_eq!(sqlx::query_scalar::<_, i64>("SELECT count(*) FROM public.operation_receipts WHERE attempt_id=$1 AND outcome IN ('completed','absent')").bind(&consumed.attempt_id).fetch_one(&mut *admin).await.unwrap(), 1);

    let case = f.case("bounded-recovery", true, 0).await;
    let operation = f.admit(&case, "bounded-recovery-op").await;
    let consumed = f
        .operations
        .consume(&case.basis, &operation.id)
        .await
        .unwrap();
    for _ in 1..32 {
        f.operations
            .recover("actor-a", &selected("a"), &consumed.attempt_id)
            .await
            .unwrap();
    }
    assert!(
        matches!(
            f.operations
                .recover("actor-a", &selected("a"), &consumed.attempt_id)
                .await,
            Err(OperationError::Capacity)
        ),
        "actual producer count must include invisible receipt slots"
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM public.operation_receipt_producers WHERE attempt_id=$1"
        )
        .bind(&consumed.attempt_id)
        .fetch_one(&mut *admin)
        .await
        .unwrap(),
        32
    );
    f.operations
        .observe(&consumed, SourceFact::Completed)
        .await
        .unwrap();

    let case = f.case("revoked-recovery", true, 0).await;
    let operation = f.admit(&case, "revoked-recovery-op").await;
    let consumed = f
        .operations
        .consume(&case.basis, &operation.id)
        .await
        .unwrap();
    f.operations
        .revoke(
            "actor-a",
            &selected("a"),
            &RevocationCommand {
                key: "withdraw-source-recovery".into(),
                kind: PolicyKind::Task,
                subject_id: case.receipt.task_id,
                expected_version: 1,
            },
        )
        .await
        .unwrap();
    assert!(matches!(
        f.operations
            .recover("actor-a", &selected("a"), &consumed.attempt_id)
            .await,
        Err(OperationError::Denied)
    ));
    f.operations
        .observe(&consumed, SourceFact::Completed)
        .await
        .unwrap();
}

async fn clean(pool: &PgPool, expected_pid: i32) {
    assert_eq!(
        sqlx::query_scalar::<_, i32>("SELECT pg_backend_pid()")
            .fetch_one(pool)
            .await
            .unwrap(),
        expected_pid,
        "proof must reuse exact physical connection"
    );
    let settings: Vec<String> = sqlx::query_scalar("SELECT coalesce(current_setting(name,true),'') FROM unnest(ARRAY['zobba.actor_id','zobba.organisation_id','zobba.client_id','zobba.engagement_id','zobba.dispatcher','zobba.receipt_claim','zobba.receipt_hash','zobba.receipt_org','zobba.receipt_client','zobba.receipt_engagement']) name").fetch_all(pool).await.unwrap();
    assert!(
        settings.iter().all(String::is_empty),
        "transaction-local receipt or audience context leaked"
    );
    for table in [
        "operations",
        "operation_attempts",
        "operation_claims",
        "operation_receipts",
        "operation_receipt_slots",
        "permission_versions",
    ] {
        assert_eq!(
            sqlx::query_scalar::<_, i64>(&format!("SELECT count(*) FROM public.{table}"))
                .fetch_one(pool)
                .await
                .unwrap(),
            0,
            "unscoped pool disclosed {table}"
        );
    }
}
async fn late_receipts_scope_and_cessation(
    f: &Fixture,
    config: &Configuration,
    admin: &mut PgConnection,
) {
    let single = runtime_pool(config, 1).await;
    let repo = OperationRepository::new(single.clone());
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&single)
        .await
        .unwrap();
    let case = f.case("late-revoked-producer", true, 0).await;
    let operation = f.admit(&case, "late-revoked-producer-op").await;
    let consumed = repo.consume(&case.basis, &operation.id).await.unwrap();
    for (actor, scope) in [
        ("actor-b", selected("a")),
        ("actor-admin", selected("a")),
        ("actor-a", selected("b")),
        ("actor-b", selected("b")),
    ] {
        assert_eq!(
            repo.get(actor, &scope, &operation.id).await,
            Err(OperationError::Denied)
        );
    }
    clean(&single, pid).await;
    // Even an explicit receipt context discloses no operation or other producer
    // secret. Exact receipt access is limited to facts for this one attempt.
    let mut tx = scoped::begin_actor(&single, "receipt-context")
        .await
        .unwrap();
    sqlx::query("SELECT set_config('zobba.actor_id','',true),set_config('zobba.receipt_claim',$1,true),set_config('zobba.receipt_hash',$2,true),set_config('zobba.receipt_org',$3,true),set_config('zobba.receipt_client',$4,true),set_config('zobba.receipt_engagement',$5,true)")
        .bind(&consumed.attempt_id).bind(hash(consumed.receipt_capability.as_bytes())).bind("org-a").bind("client-a").bind("engagement-a").execute(&mut *tx).await.unwrap();
    for table in [
        "operations",
        "operation_attempts",
        "operation_claims",
        "permission_versions",
        "tasks",
    ] {
        assert_eq!(
            sqlx::query_scalar::<_, i64>(&format!("SELECT count(*) FROM public.{table}"))
                .fetch_one(&mut *tx)
                .await
                .unwrap(),
            0
        );
    }
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM public.operation_receipt_slots")
            .fetch_one(&mut *tx)
            .await
            .unwrap(),
        1
    );
    tx.commit().await.unwrap();
    clean(&single, pid).await;

    f.tasks
        .admit(
            "actor-a",
            &selected("a"),
            &command(
                "stop-with-possible-effect",
                CommandKind::Stop,
                &case.receipt,
            ),
        )
        .await
        .unwrap();
    let stopped = f
        .tasks
        .get("actor-a", &selected("a"), &case.receipt.task_id)
        .await
        .unwrap();
    assert_eq!(
        (stopped.state, stopped.cessation),
        (TaskState::Stopped, Cessation::Pending)
    );
    let before_cursor: i64 = sqlx::query_scalar("SELECT cursor FROM public.task_counters WHERE organisation_id='org-a' AND client_id='client-a' AND engagement_id='engagement-a'")
        .fetch_one(&mut *admin).await.unwrap();
    assert_eq!(
        f.tasks
            .coordinate(&route(&case.receipt), &case.basis.worker_id)
            .await
            .unwrap(),
        Decision::Waiting
    );
    let reconciliation_events = f
        .tasks
        .events("actor-a", &selected("a"), before_cursor as u64)
        .await
        .unwrap();
    assert_eq!(
        reconciliation_events.len(),
        2,
        "Stop application and new unresolved source state each advance the durable cursor"
    );
    assert_eq!(reconciliation_events[0].kind, "applied");
    assert_eq!(
        reconciliation_events[0].cursor,
        (before_cursor + 1).to_string()
    );
    assert_eq!(reconciliation_events[1].kind, "waiting");
    assert_eq!(
        reconciliation_events[1].cursor,
        (before_cursor + 2).to_string()
    );
    let unresolved_cursor = before_cursor + 2;
    assert_eq!(
        f.tasks
            .coordinate(&route(&case.receipt), &case.basis.worker_id)
            .await
            .unwrap(),
        Decision::Waiting
    );
    assert!(
        f.tasks
            .events("actor-a", &selected("a"), unresolved_cursor as u64)
            .await
            .unwrap()
            .is_empty(),
        "unchanged unresolved state must not invent another durable event"
    );
    assert_eq!(
        f.tasks
            .get("actor-a", &selected("a"), &case.receipt.task_id)
            .await
            .unwrap()
            .cessation,
        Cessation::ReconciliationRequired
    );
    let before: i64 = sqlx::query_scalar("SELECT revision FROM public.tasks WHERE id=$1")
        .bind(&case.receipt.task_id)
        .fetch_one(&mut *admin)
        .await
        .unwrap();
    sqlx::query("UPDATE public.organisation_memberships SET roles=ARRAY['admin'] WHERE organisation_id='org-a' AND actor_id='actor-a'").execute(&mut *admin).await.unwrap();
    assert_eq!(
        repo.get("actor-a", &selected("a"), &operation.id).await,
        Err(OperationError::Denied)
    );
    assert!(matches!(
        repo.recover("actor-a", &selected("a"), &consumed.attempt_id)
            .await,
        Err(OperationError::Denied)
    ));
    assert!(repo.consume(&case.basis, &operation.id).await.is_err());
    assert_eq!(
        f.tasks
            .coordinate(&route(&case.receipt), &case.basis.worker_id)
            .await,
        Err(TaskError::Denied)
    );
    repo.observe(&consumed, SourceFact::Completed)
        .await
        .unwrap();
    repo.observe(&consumed, SourceFact::Completed)
        .await
        .unwrap();
    clean(&single, pid).await;
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT revision FROM public.tasks WHERE id=$1")
            .bind(&case.receipt.task_id)
            .fetch_one(&mut *admin)
            .await
            .unwrap(),
        before,
        "late receipt changed Task authority without a current coordinator"
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM public.operation_receipts WHERE attempt_id=$1"
        )
        .bind(&consumed.attempt_id)
        .fetch_one(&mut *admin)
        .await
        .unwrap(),
        1
    );
    sqlx::query("UPDATE public.organisation_memberships SET roles=ARRAY['auditor'] WHERE organisation_id='org-a' AND actor_id='actor-a'").execute(&mut *admin).await.unwrap();
    assert_eq!(
        f.tasks
            .coordinate(&route(&case.receipt), &case.basis.worker_id)
            .await
            .unwrap(),
        Decision::Idle
    );
    let terminal_events = f
        .tasks
        .events("actor-a", &selected("a"), unresolved_cursor as u64)
        .await
        .unwrap();
    assert_eq!(
        terminal_events.len(),
        1,
        "factual cessation must become visible through one durable event"
    );
    assert_eq!(terminal_events[0].kind, "observed");
    assert_eq!(
        terminal_events[0].cursor,
        (unresolved_cursor + 1).to_string()
    );
    let final_state = f
        .tasks
        .get("actor-a", &selected("a"), &case.receipt.task_id)
        .await
        .unwrap();
    assert_eq!(
        (final_state.state, final_state.cessation),
        (TaskState::Stopped, Cessation::Confirmed)
    );
    assert_eq!(
        repo.get("actor-manager", &selected("a"), &operation.id)
            .await
            .unwrap()
            .actor_id,
        "actor-a"
    );
    single.close().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn standing_permissions_exact_operations_and_transaction_cutoffs() {
    let config = Configuration::from_environment();
    let mut owner = PgConnection::connect(&config.migration).await.unwrap();
    config.guard_connection(&mut owner).await;
    owner.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public; REVOKE CREATE ON SCHEMA public FROM PUBLIC").await.unwrap();
    migrate(
        &config.migration,
        database_options(&config.runtime).unwrap().get_username(),
    )
    .await
    .unwrap();
    seed_local_configured("https://127.0.0.1:4443", &config.migration)
        .await
        .unwrap();
    let mut admin = PgConnection::connect(&config.admin).await.unwrap();
    config.guard_connection(&mut admin).await;
    let mut holder = PgConnection::connect(&config.admin).await.unwrap();
    config.guard_connection(&mut holder).await;
    sqlx::query("INSERT INTO public.trusted_attachment_metadata(organisation_id,client_id,engagement_id,source_key,attachment_id,digest,classification) VALUES('org-a','client-a','engagement-a','14:fixture-source14:fixture-ledger','attachment',$1,'audit')").bind("a".repeat(64)).execute(&mut admin).await.unwrap();
    let mut fixture = Fixture::new(runtime_pool(&config, 4).await).await;
    Box::pin(model_execution::verify(&fixture, &mut admin, &mut holder)).await;
    logical_admission_and_atomicity(&fixture, &mut admin, &mut holder).await;
    exact_decisions(&fixture, &mut admin).await;
    intersected_policy_and_lineage(&mut fixture).await;
    cutoff_races(&fixture, &mut admin, &mut holder).await;
    facts_and_recovery(&fixture, &mut admin).await;
    policy_revisions::verify(&mut fixture, &mut admin).await;
    review_repairs::verify(&mut fixture, &mut admin, &mut holder).await;
    // This scenario carries many independent claims and reconciliation orders;
    // allocate its async state separately from the aggregate contract test.
    Box::pin(task_reconciliation::verify(&fixture)).await;
    late_receipts_scope_and_cessation(&fixture, &config, &mut admin).await;
    methodology_execution::verify(&fixture, &mut admin).await;
    Box::pin(work_cycle::verify(&fixture, &mut admin)).await;
    fixture.pool.close().await;
}
