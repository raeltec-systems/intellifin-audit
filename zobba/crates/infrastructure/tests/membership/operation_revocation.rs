//! Real operation authority and deterministic membership/dispatch lock orders.
use super::{claimed, save, selected, task_record};
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::{Connection, Executor, PgConnection, PgPool};
use std::time::{Duration, Instant};
use zobba_application::{
    membership::{MembershipStore, Receipt},
    operation::{OperationError, OperationStore, wire::StoredPolicy},
    task::TaskCommands,
};
use zobba_domain::{
    permissions::*,
    task::{ClaimBasis, Decision, TaskState, WakeupRoute},
};
use zobba_infrastructure::{
    membership::MembershipRepository, operation::OperationRepository, task::TaskRepository,
};

fn request(material: &str) -> CanonicalOperation {
    CanonicalOperation {
        version: 1,
        purpose: Purpose::AuditCoordination,
        action: Action::Send,
        account_id: "membership-account".into(),
        environment_id: "membership-audit".into(),
        destination: "membership-endpoint".into(),
        recipients: vec!["membership-recipient".into()],
        material: material.into(),
        material_digest: format!("{:x}", Sha256::digest(material.as_bytes())),
        attachments: vec![],
        resource_id: "membership-resource".into(),
        resource_version: "v1".into(),
        expires_at: 4_102_444_800,
    }
}

fn policy(kind: PolicyKind, subject: &str) -> PolicyDocument {
    let request = request("fixture");
    let bounds = PermissionBounds {
        rules: vec![PermissionRule {
            purpose: request.purpose,
            action: request.action,
            account_id: request.account_id,
            environment_id: request.environment_id,
            destination: request.destination,
            resource_id: request.resource_id,
            recipients: request.recipients,
            attachment_classifications: vec![],
            expires_at: request.expires_at,
        }],
    };
    PolicyDocument {
        schema_version: 1,
        kind,
        subject_id: subject.into(),
        version: 1,
        actor_id: "second".into(),
        created_at: 1,
        revoked: false,
        hard: bounds.clone(),
        standing: bounds,
        parent: None,
        account: (kind == PolicyKind::Account).then(|| AccountRestriction {
            source: SourceBinding {
                source_id: "membership-source".into(),
                ledger_id: "membership-ledger".into(),
                endpoint_digest: "a".repeat(64),
                contract_version: 1,
            },
            account_id: "membership-account".into(),
            environment_id: "membership-audit".into(),
            environment: EnvironmentKind::Audit,
            read_restriction: ReadRestriction::None,
            restriction_survives_takeover: false,
            test_environment_verified: false,
            test_resources: vec![],
            test_cleanup_id: None,
            audit_resources: vec!["membership-resource".into()],
        }),
    }
}

async fn seed_policy(admin: &mut PgConnection, doc: PolicyDocument) {
    assert!(doc.is_valid());
    let engagement = doc.kind == PolicyKind::Engagement;
    let key = if engagement {
        format!(
            "6:client10:engagement{}:{}",
            doc.kind.as_str(),
            doc.subject_id
        )
    } else {
        format!("{}_{}", doc.kind.as_str(), doc.subject_id)
    };
    // Owner seed establishes the pre-existing standing authority; every Task
    // acceptance, operation, decision, consumption and observation below uses
    // the actual restricted runtime repository.
    sqlx::query("INSERT INTO public.permission_versions(organisation_id,policy_key,client_id,engagement_id,kind,subject_id,version,document,actor_id) VALUES('org',$1,$2,$3,$4,$5,1,$6,'second')")
        .bind(&key)
        .bind(engagement.then_some("client"))
        .bind(engagement.then_some("engagement"))
        .bind(doc.kind.as_str())
        .bind(&doc.subject_id)
        .bind(serde_json::to_string(&StoredPolicy(doc.clone())).unwrap())
        .execute(&mut *admin)
        .await
        .unwrap();
    sqlx::query("INSERT INTO public.permission_heads(organisation_id,policy_key,client_id,engagement_id,current_version) VALUES('org',$1,$2,$3,1)")
        .bind(key)
        .bind(engagement.then_some("client"))
        .bind(engagement.then_some("engagement"))
        .execute(admin)
        .await
        .unwrap();
}

struct Case {
    route: WakeupRoute,
    basis: ClaimBasis,
    operation: Operation,
}

async fn case(
    tasks: &TaskRepository,
    operations: &OperationRepository,
    actor: &str,
    key: &str,
) -> Case {
    let scope = selected("org");
    let (route, basis) = claimed(tasks, actor, &scope, key).await;
    let mut task = policy(PolicyKind::Task, &basis.task_id);
    task.actor_id = actor.into();
    // Force an exact attributable decision rather than relying on a permissive
    // fixture policy. Both current and accepted hard bounds still apply.
    task.standing.rules.clear();
    let authority = AuthoritySnapshot {
        scope: scope.clone(),
        actor_id: actor.into(),
        task_id: basis.task_id.clone(),
        organisation: policy(PolicyKind::Organisation, "org"),
        engagement: policy(PolicyKind::Engagement, "engagement"),
        member: policy(PolicyKind::Member, actor),
        account: policy(PolicyKind::Account, "membership-account"),
        task,
        delegations: vec![],
    };
    operations
        .accept_authority(actor, &scope, &basis.task_id, &authority)
        .await
        .unwrap();
    let operation = operations
        .admit(actor, &scope, &basis, key, &request(key))
        .await
        .unwrap();
    assert_eq!(operation.state, OperationState::NeedsDecision);
    operations
        .decide(
            actor,
            &scope,
            &DecisionCommand {
                key: format!("{key}-decision"),
                operation_id: operation.id.clone(),
                expected_revision: operation.revision,
                request: operation.request.clone(),
                expires_at: operation.request.expires_at,
                allow: true,
            },
        )
        .await
        .unwrap();
    assert_eq!(
        operations
            .get(actor, &scope, &operation.id)
            .await
            .unwrap()
            .state,
        OperationState::Ready
    );
    Case {
        route,
        basis,
        operation,
    }
}

async fn records(admin: &mut PgConnection, operation: &str) -> Value {
    sqlx::query_scalar("SELECT jsonb_build_object('operation',to_jsonb(o),'decisions',(SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.id),'[]'::jsonb) FROM public.operation_decisions d WHERE d.operation_id=o.id),'attempts',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]'::jsonb) FROM public.operation_attempts a WHERE a.operation_id=o.id),'claims',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id),'[]'::jsonb) FROM public.operation_claims c WHERE c.operation_id=o.id),'slots',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.attempt_id,s.producer_id),'[]'::jsonb) FROM public.operation_receipt_slots s JOIN public.operation_attempts a ON a.id=s.attempt_id WHERE a.operation_id=o.id),'receipts',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]'::jsonb) FROM public.operation_receipts r JOIN public.operation_attempts a ON a.id=r.attempt_id WHERE a.operation_id=o.id)) FROM public.operations o WHERE o.id=$1")
        .bind(operation)
        .fetch_one(admin)
        .await
        .unwrap()
}

async fn blocked_by(admin: &mut PgConnection, blocker: i32) -> i32 {
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        let pid = sqlx::query_scalar("SELECT DISTINCT pid FROM pg_catalog.pg_locks WHERE NOT granted AND $1=ANY(pg_catalog.pg_blocking_pids(pid)) ORDER BY pid LIMIT 1")
            .bind(blocker)
            .fetch_optional(&mut *admin)
            .await
            .unwrap();
        if let Some(pid) = pid {
            return pid;
        }
        assert!(
            Instant::now() < deadline,
            "operation/membership writer did not reach the shared lock boundary"
        );
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
}

/// The first repository writer owns org-205 and waits on our engagement row;
/// the second must wait on the first writer's organisation lock. This exercises
/// actual repository lock ordering without fixture triggers or altered code.
async fn race(
    admin: &mut PgConnection,
    membership: &MembershipRepository,
    operations: &OperationRepository,
    case: &Case,
    version: &str,
    consume_first: bool,
) -> (Receipt, Result<ConsumedOperation, OperationError>) {
    // The test controls the scheduling barrier, so keep the synthetic owner's
    // lease live while proving lock order rather than racing its five seconds.
    sqlx::query(
        "UPDATE public.tasks SET owner_until=clock_timestamp()+interval '30 seconds' WHERE id=$1",
    )
    .bind(&case.basis.task_id)
    .execute(&mut *admin)
    .await
    .unwrap();
    let mut barrier = admin.begin().await.unwrap();
    let holder: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *barrier)
        .await
        .unwrap();
    sqlx::query("SELECT id FROM public.engagements WHERE organisation_id='org' AND client_id='client' AND id='engagement' FOR UPDATE")
        .execute(&mut *barrier).await.unwrap();
    let op = operations.clone();
    let basis = case.basis.clone();
    let id = case.operation.id.clone();
    let consume = async move { op.consume(&basis, &id).await };
    let repo = membership.clone();
    let key = if consume_first {
        "op-revocation-consume-first"
    } else {
        "op-revocation-save-first"
    };
    let command = save(key, version, false);
    let remove = async move { repo.save_member("admin", "org", &command).await };
    let (consume, remove) = if consume_first {
        let consume = tokio::spawn(consume);
        let first = blocked_by(&mut barrier, holder).await;
        let remove = tokio::spawn(remove);
        let second = blocked_by(&mut barrier, first).await;
        let advisory: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_locks WHERE pid=$1 AND NOT granted AND locktype='advisory')")
            .bind(second).fetch_one(&mut *barrier).await.unwrap();
        assert!(advisory);
        (consume, remove)
    } else {
        let remove = tokio::spawn(remove);
        let first = blocked_by(&mut barrier, holder).await;
        let consume = tokio::spawn(consume);
        let second = blocked_by(&mut barrier, first).await;
        let advisory: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_locks WHERE pid=$1 AND NOT granted AND locktype='advisory')")
            .bind(second).fetch_one(&mut *barrier).await.unwrap();
        assert!(advisory);
        (consume, remove)
    };
    assert!(!consume.is_finished() && !remove.is_finished());
    barrier.commit().await.unwrap();
    let (consumed, removed) = tokio::join!(consume, remove);
    (removed.unwrap().unwrap(), consumed.unwrap())
}

pub(super) async fn verify(
    pool: &PgPool,
    admin: &mut PgConnection,
    membership: &MembershipRepository,
) {
    for doc in [
        policy(PolicyKind::Organisation, "org"),
        policy(PolicyKind::Engagement, "engagement"),
        policy(PolicyKind::Account, "membership-account"),
        policy(PolicyKind::Member, "member"),
        policy(PolicyKind::Member, "other"),
    ] {
        seed_policy(admin, doc).await;
    }
    let tasks = TaskRepository::new(pool.clone());
    let operations = OperationRepository::new(pool.clone());
    let unrelated = case(&tasks, &operations, "other", "op-revocation-other").await;
    let unrelated_task = task_record(admin, &unrelated.basis.task_id).await;
    let unrelated_records = records(admin, &unrelated.operation.id).await;
    let unused = case(&tasks, &operations, "member", "op-revocation-unused").await;
    // Today's public consume port atomically inserts and consumes its claim.
    // Seed a valid admitted attempt solely to test the defensive abandonment
    // branch for a durable unused claim; real consume races below never use it.
    sqlx::query("INSERT INTO public.operation_attempts(organisation_id,client_id,engagement_id,id,operation_id,attempt_number,basis,source_binding) SELECT organisation_id,client_id,engagement_id,'membership-unused-attempt',id,1,basis,source_binding FROM public.operations WHERE id=$1")
        .bind(&unused.operation.id).execute(&mut *admin).await.unwrap();
    sqlx::query("INSERT INTO public.operation_claims(organisation_id,client_id,engagement_id,id,operation_id,attempt_id,state) VALUES('org','client','engagement','membership-unused-claim',$1,'membership-unused-attempt','admitted')")
        .bind(&unused.operation.id).execute(&mut *admin).await.unwrap();
    let unused_before = records(admin, &unused.operation.id).await;
    let before = case(
        &tasks,
        &operations,
        "member",
        "op-revocation-before-consume",
    )
    .await;
    let before_records = records(admin, &before.operation.id).await;
    let (removed, refused) = race(admin, membership, &operations, &before, "0", false).await;
    assert_eq!(removed.version, "1");
    assert!(matches!(
        refused,
        Err(OperationError::Denied | OperationError::Fenced)
    ));
    assert_eq!(
        records(admin, &before.operation.id).await,
        before_records,
        "revocation won: no attempt, claim, or receipt capability may be minted"
    );
    let unused_after = records(admin, &unused.operation.id).await;
    for field in ["operation", "decisions", "attempts", "slots", "receipts"] {
        assert_eq!(unused_after[field], unused_before[field]);
    }
    assert_eq!(unused_after["claims"][0]["state"], "abandoned");
    membership
        .save_member(
            "admin",
            "org",
            &super::renew("op-revocation-regrant-one", "1", true),
        )
        .await
        .unwrap();
    assert!(matches!(
        operations
            .consume(&before.basis, &before.operation.id)
            .await,
        Err(OperationError::Fenced)
    ));
    assert_eq!(
        operations
            .get("member", &selected("org"), &before.operation.id)
            .await
            .unwrap()
            .state,
        OperationState::Revoked
    );
    assert_eq!(
        tasks
            .coordinate(&before.route, "membership-worker")
            .await
            .unwrap(),
        Decision::Idle
    );

    let after = case(&tasks, &operations, "member", "op-revocation-after-consume").await;
    let immutable_before = records(admin, &after.operation.id).await;
    let (removed, consumed) = race(admin, membership, &operations, &after, "2", true).await;
    assert_eq!(removed.version, "3");
    let consumed = consumed.unwrap();
    let preserved = records(admin, &after.operation.id).await;
    assert_eq!(preserved["operation"], immutable_before["operation"]);
    assert_eq!(preserved["decisions"], immutable_before["decisions"]);
    assert_eq!(preserved["claims"][0]["state"], "consumed");
    assert_eq!(preserved["attempts"].as_array().unwrap().len(), 1);
    assert_eq!(preserved["slots"].as_array().unwrap().len(), 1);
    let paused = task_record(admin, &after.basis.task_id).await;
    assert_eq!(paused["state"], "paused");
    assert_eq!(paused["cessation"], "pending");
    assert!(matches!(
        operations
            .get("member", &selected("org"), &after.operation.id)
            .await,
        Err(OperationError::Denied)
    ));
    assert!(matches!(
        operations.consume(&after.basis, &after.operation.id).await,
        Err(OperationError::Denied)
    ));
    assert!(matches!(
        operations
            .recover("member", &selected("org"), &consumed.attempt_id)
            .await,
        Err(OperationError::Denied)
    ));
    operations
        .observe(&consumed, SourceFact::Accepted)
        .await
        .unwrap();
    operations
        .observe(&consumed, SourceFact::Completed)
        .await
        .unwrap();
    let late = records(admin, &after.operation.id).await;
    for field in ["operation", "decisions", "attempts", "claims", "slots"] {
        assert_eq!(
            late[field], preserved[field],
            "late receipt changed {field}"
        );
    }
    assert_eq!(late["receipts"].as_array().unwrap().len(), 2);
    membership
        .save_member(
            "admin",
            "org",
            &super::renew("op-revocation-regrant-two", "3", true),
        )
        .await
        .unwrap();
    assert_eq!(
        operations
            .get("member", &selected("org"), &after.operation.id)
            .await
            .unwrap()
            .state,
        OperationState::Completed
    );
    assert!(matches!(
        operations.consume(&after.basis, &after.operation.id).await,
        Err(OperationError::Fenced)
    ));
    assert_eq!(
        tasks
            .coordinate(&after.route, "membership-worker")
            .await
            .unwrap(),
        Decision::Idle
    );
    assert_eq!(
        tasks
            .get("member", &selected("org"), &after.basis.task_id)
            .await
            .unwrap()
            .state,
        TaskState::Paused
    );
    assert_eq!(records(admin, &after.operation.id).await, late);
    assert_eq!(
        records(admin, &unrelated.operation.id).await,
        unrelated_records
    );
    assert_eq!(
        task_record(admin, &unrelated.basis.task_id).await,
        unrelated_task
    );
    assert_eq!(
        operations
            .get("other", &selected("org"), &unrelated.operation.id)
            .await
            .unwrap()
            .state,
        OperationState::Ready
    );
    admin.execute("DELETE FROM public.membership_events WHERE organisation_id='org' AND actor_id='admin' AND command_key IN ('op-revocation-save-first','op-revocation-regrant-one','op-revocation-consume-first','op-revocation-regrant-two'); UPDATE public.membership_versions SET version=0 WHERE organisation_id='org'").await.unwrap();
    assert_eq!(
        membership
            .snapshot("admin", "org", None, None, None)
            .await
            .unwrap()
            .version,
        "0"
    );
}
