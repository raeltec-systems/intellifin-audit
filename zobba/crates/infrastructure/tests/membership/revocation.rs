//! Membership revocation uses real Task claims and immutable receipt custody.
//! Called only inside the parent test's explicitly guarded disposable database.
use serde_json::Value;
use sqlx::{Executor, PgConnection, PgPool};
use zobba_application::{
    membership::{AssignmentChange, AssignmentMode, MembershipError, MembershipStore, SaveMember},
    operation::wire::StoredPolicy,
    task::{TaskCommands, TaskError},
};
use zobba_domain::{
    identity::Scope,
    permissions::{PermissionBounds, PolicyDocument, PolicyKind, PolicyReference},
    task::{
        Cessation, ClaimBasis, CommandKind, Decision, Observation, TaskCommand, TaskState,
        WakeupRoute,
    },
};
use zobba_infrastructure::{membership::MembershipRepository, scope, task::TaskRepository};

#[path = "expiry_split.rs"]
mod expiry_split;
#[path = "operation_revocation.rs"]
mod operation_revocation;
#[path = "renewal_and_remove.rs"]
mod renewal_and_remove;

fn selected(organisation: &str) -> Scope {
    Scope {
        organisation_id: organisation.into(),
        client_id: "client".into(),
        engagement_id: "engagement".into(),
    }
}

fn save(key: &str, version: &str, assigned: bool) -> SaveMember {
    SaveMember {
        assignment_mode: zobba_application::membership::AssignmentMode::Replace,
        key: key.into(),
        expected_version: version.into(),
        actor_id: "member".into(),
        roles: vec!["auditor".into()],
        active: true,
        expires_at: None,
        assignments: if assigned {
            vec![AssignmentChange {
                renew: false,
                client_id: "client".into(),
                engagement_id: "engagement".into(),
            }]
        } else {
            vec![]
        },
    }
}

fn renew(key: &str, version: &str, assigned: bool) -> SaveMember {
    let mut command = save(key, version, assigned);
    for assignment in &mut command.assignments {
        assignment.renew = true;
    }
    command
}

async fn claimed(
    tasks: &TaskRepository,
    actor: &str,
    selected: &Scope,
    key: &str,
) -> (WakeupRoute, ClaimBasis) {
    let receipt = tasks
        .admit(
            actor,
            selected,
            &TaskCommand {
                context: None,
                key: key.into(),
                kind: CommandKind::Create,
                task_id: None,
                cycle_id: None,
                content: Some("Membership revocation contract".into()),
            },
        )
        .await
        .unwrap();
    let route = WakeupRoute {
        id: receipt.task_id.clone(),
        actor_id: actor.into(),
        scope: selected.clone(),
        task_id: receipt.task_id,
    };
    let Decision::Execute(basis) = tasks.coordinate(&route, "membership-worker").await.unwrap()
    else {
        panic!("a fresh Task must produce an admitted claim");
    };
    (route, *basis)
}

async fn task_record(admin: &mut PgConnection, id: &str) -> Value {
    sqlx::query_scalar("SELECT to_jsonb(t) FROM public.tasks t WHERE id=$1")
        .bind(id)
        .fetch_one(admin)
        .await
        .unwrap()
}

async fn claim_state(admin: &mut PgConnection, id: &str) -> String {
    sqlx::query_scalar("SELECT state FROM public.task_claims WHERE id=$1")
        .bind(id)
        .fetch_one(admin)
        .await
        .unwrap()
}

async fn custody(admin: &mut PgConnection, claim: &str) -> Value {
    sqlx::query_scalar(
        "SELECT jsonb_build_object('claim',to_jsonb(c),'slot',to_jsonb(s),\
         'observation',(SELECT to_jsonb(o) FROM public.task_observations o WHERE o.claim_id=c.id)) \
         FROM public.task_claims c JOIN public.task_receipt_slots s ON s.claim_id=c.id WHERE c.id=$1",
    )
    .bind(claim)
    .fetch_one(admin)
    .await
    .unwrap()
}

async fn delegation(
    admin: &mut PgConnection,
    subject: &str,
    parent_kind: PolicyKind,
    parent: &str,
) {
    delegation_in(admin, &selected("org"), subject, parent_kind, parent).await;
}

async fn delegation_in(
    admin: &mut PgConnection,
    scope: &Scope,
    subject: &str,
    parent_kind: PolicyKind,
    parent: &str,
) {
    // The latest editor is another Admin. Stable ancestry, not actor_id, must
    // determine which member's delegations are fenced.
    let document = PolicyDocument {
        schema_version: 1,
        kind: PolicyKind::Delegation,
        subject_id: subject.into(),
        version: 1,
        actor_id: "second".into(),
        created_at: 1,
        revoked: false,
        hard: PermissionBounds { rules: vec![] },
        standing: PermissionBounds { rules: vec![] },
        account: None,
        parent: Some(PolicyReference {
            kind: parent_kind,
            subject_id: parent.into(),
            version: 1,
        }),
    };
    assert!(document.is_valid());
    let key = format!(
        "{}:{}{}:{}delegation:{subject}",
        scope.client_id.len(),
        scope.client_id,
        scope.engagement_id.len(),
        scope.engagement_id
    );
    sqlx::query("INSERT INTO public.permission_versions(organisation_id,policy_key,client_id,engagement_id,kind,subject_id,version,document,actor_id) VALUES($4,$1,$5,$6,'delegation',$2,1,$3,'second')")
        .bind(&key)
        .bind(subject)
        .bind(serde_json::to_string(&StoredPolicy(document)).unwrap())
        .bind(&scope.organisation_id).bind(&scope.client_id).bind(&scope.engagement_id)
        .execute(&mut *admin)
        .await
        .unwrap();
    sqlx::query("INSERT INTO public.permission_heads(organisation_id,policy_key,client_id,engagement_id,current_version) VALUES($2,$1,$3,$4,1)")
        .bind(key).bind(&scope.organisation_id).bind(&scope.client_id).bind(&scope.engagement_id)
        .execute(admin)
        .await
        .unwrap();
}

async fn delegation_head(admin: &mut PgConnection, subject: &str) -> PolicyDocument {
    let text: String = sqlx::query_scalar("SELECT v.document FROM public.permission_versions v JOIN public.permission_heads h ON (h.organisation_id,h.policy_key,h.current_version)=(v.organisation_id,v.policy_key,v.version) WHERE v.organisation_id='org' AND v.kind='delegation' AND v.subject_id=$1")
        .bind(subject)
        .fetch_one(admin)
        .await
        .unwrap();
    serde_json::from_str::<StoredPolicy>(&text).unwrap().0
}

/// Restores member grants, removes only this helper's membership events, and
/// resets the organisation version to zero for the parent's independent cases.
/// Task/delegation evidence remains available for the rest of the test.
pub async fn verify(
    pool: &PgPool,
    admin: &mut PgConnection,
    repo: &MembershipRepository,
    issuer: &str,
) {
    let actual_issuer: String =
        sqlx::query_scalar("SELECT issuer FROM public.identities WHERE id='member'")
            .fetch_one(&mut *admin)
            .await
            .unwrap();
    assert_eq!(actual_issuer, issuer);
    let tasks = TaskRepository::new(pool.clone());
    let selected = selected("org");
    let foreign = self::selected("foreign");
    let (route, unused) = claimed(&tasks, "member", &selected, "revocation-unused").await;
    let (consumed_route, consumed_basis) =
        claimed(&tasks, "member", &selected, "revocation-consumed").await;
    let consumed = tasks.consume(&consumed_basis).await.unwrap();
    let (_, unrelated) = claimed(&tasks, "other", &selected, "revocation-unrelated").await;
    let (_, foreign_basis) = claimed(&tasks, "member", &foreign, "revocation-foreign").await;
    delegation(
        admin,
        "revocation-parent",
        PolicyKind::Task,
        &unused.task_id,
    )
    .await;
    delegation(
        admin,
        "revocation-child",
        PolicyKind::Delegation,
        "revocation-parent",
    )
    .await;
    delegation(
        admin,
        "revocation-other",
        PolicyKind::Task,
        &unrelated.task_id,
    )
    .await;
    let other_before = task_record(admin, &unrelated.task_id).await;
    let foreign_before = task_record(admin, &foreign_basis.task_id).await;
    let other_delegation = delegation_head(admin, "revocation-other").await;
    let custody_before = custody(admin, &consumed_basis.claim_id).await;

    let removed = repo
        .save_member("admin", "org", &save("revocation-remove", "0", false))
        .await
        .unwrap();
    assert_eq!(removed.version, "1");
    assert!(scope::begin(pool, "member", &selected).await.is_err());
    assert!(matches!(
        tasks.consume(&unused).await,
        Err(TaskError::Denied)
    ));
    assert_eq!(claim_state(admin, &unused.claim_id).await, "abandoned");
    assert_eq!(
        custody(admin, &consumed_basis.claim_id).await,
        custody_before
    );
    let pending = task_record(admin, &consumed_basis.task_id).await;
    assert_eq!(pending["state"], "paused");
    assert_eq!(pending["cessation"], "pending");
    for subject in ["revocation-parent", "revocation-child"] {
        let head = delegation_head(admin, subject).await;
        assert!(head.is_valid() && head.revoked);
        assert_eq!(head.version, 2);
        assert_eq!(head.actor_id, "admin");
    }
    // Exact receipt custody survives removal, including a producer's late fact.
    tasks
        .observe(&consumed, Observation::Cancelled)
        .await
        .unwrap();
    let late_custody = custody(admin, &consumed_basis.claim_id).await;
    assert_eq!(late_custody["claim"], custody_before["claim"]);
    assert_eq!(late_custody["slot"], custody_before["slot"]);
    assert_eq!(late_custody["observation"]["outcome"], "cancelled");

    let regranted = repo
        .save_member("admin", "org", &renew("revocation-regrant", "1", true))
        .await
        .unwrap();
    assert_eq!(regranted.version, "2");
    let paused = tasks
        .get("member", &selected, &unused.task_id)
        .await
        .unwrap();
    assert_eq!(paused.state, TaskState::Paused);
    assert_eq!(paused.cessation, Cessation::Confirmed);
    assert!(paused.execution_epoch > unused.execution_epoch as u64);
    assert!(matches!(
        tasks.consume(&unused).await,
        Err(TaskError::Fenced)
    ));
    assert!(!tasks.current(&consumed_basis).await.unwrap());
    assert_eq!(
        tasks.coordinate(&route, "membership-worker").await.unwrap(),
        Decision::Idle
    );
    assert_eq!(custody(admin, &consumed_basis.claim_id).await, late_custody);
    assert_eq!(
        tasks
            .coordinate(&consumed_route, "membership-worker")
            .await
            .unwrap(),
        Decision::Idle
    );
    assert_eq!(
        tasks
            .get("member", &selected, &consumed_basis.task_id)
            .await
            .unwrap()
            .state,
        TaskState::Paused
    );
    assert!(delegation_head(admin, "revocation-parent").await.revoked);
    assert_eq!(task_record(admin, &unrelated.task_id).await, other_before);
    assert_eq!(
        task_record(admin, &foreign_basis.task_id).await,
        foreign_before
    );
    assert_eq!(claim_state(admin, &unrelated.claim_id).await, "admitted");
    assert_eq!(
        claim_state(admin, &foreign_basis.claim_id).await,
        "admitted"
    );
    assert_eq!(
        delegation_head(admin, "revocation-other").await,
        other_delegation
    );
    tasks
        .get("other", &selected, &unrelated.task_id)
        .await
        .unwrap();
    tasks
        .get("member", &foreign, &foreign_basis.task_id)
        .await
        .unwrap();

    // Expiry happens without a membership command. Extending an expired grant
    // must fence its old execution instead of accidentally restoring it.
    let (_, expired) = claimed(&tasks, "member", &selected, "revocation-expired").await;
    admin.execute("UPDATE public.organisation_memberships SET expires_at=extract(epoch FROM clock_timestamp())::bigint-1 WHERE organisation_id='org' AND actor_id='member'").await.unwrap();
    assert!(matches!(
        tasks.consume(&expired).await,
        Err(TaskError::Denied)
    ));
    let restored = repo
        .save_member(
            "admin",
            "org",
            &save("revocation-expiry-regrant", "2", true),
        )
        .await
        .unwrap();
    assert_eq!(restored.version, "3");
    assert!(matches!(
        tasks.consume(&expired).await,
        Err(TaskError::Fenced)
    ));
    assert_eq!(claim_state(admin, &expired.claim_id).await, "abandoned");
    assert!(
        tasks
            .get("member", &selected, &expired.task_id)
            .await
            .unwrap()
            .execution_epoch
            > expired.execution_epoch as u64
    );
    let (_, expired_assignment) =
        claimed(&tasks, "member", &selected, "revocation-assignment-expired").await;
    admin.execute("UPDATE public.engagement_assignments SET expires_at=extract(epoch FROM clock_timestamp())::bigint-1 WHERE organisation_id='org' AND actor_id='member'").await.unwrap();
    assert!(matches!(
        tasks.consume(&expired_assignment).await,
        Err(TaskError::Denied)
    ));
    let restored = repo
        .save_member(
            "admin",
            "org",
            &renew("revocation-assignment-regrant", "3", true),
        )
        .await
        .unwrap();
    assert_eq!(restored.version, "4");
    assert!(matches!(
        tasks.consume(&expired_assignment).await,
        Err(TaskError::Fenced)
    ));
    assert_eq!(
        claim_state(admin, &expired_assignment.claim_id).await,
        "abandoned"
    );
    assert_eq!(task_record(admin, &unrelated.task_id).await, other_before);
    assert_eq!(
        task_record(admin, &foreign_basis.task_id).await,
        foreign_before
    );

    // A pre-administration or owner-disabled assignment may have no earlier
    // execution fence. Reactivating that stored row must fence its old claim.
    let (_, inactive_assignment) = claimed(
        &tasks,
        "member",
        &selected,
        "revocation-assignment-inactive",
    )
    .await;
    admin.execute("UPDATE public.engagement_assignments SET active=false WHERE organisation_id='org' AND actor_id='member'").await.unwrap();
    assert!(matches!(
        tasks.consume(&inactive_assignment).await,
        Err(TaskError::Denied)
    ));
    assert_eq!(
        repo.save_member(
            "admin",
            "org",
            &save("revocation-inactive-no-renew", "4", true)
        )
        .await,
        Err(MembershipError::Conflict)
    );
    let restored = repo
        .save_member(
            "admin",
            "org",
            &renew("revocation-inactive-regrant", "4", true),
        )
        .await
        .unwrap();
    assert_eq!(restored.version, "5");
    assert!(matches!(
        tasks.consume(&inactive_assignment).await,
        Err(TaskError::Fenced)
    ));
    assert_eq!(
        claim_state(admin, &inactive_assignment.claim_id).await,
        "abandoned"
    );
    let paused = tasks
        .get("member", &selected, &inactive_assignment.task_id)
        .await
        .unwrap();
    assert_eq!(paused.state, TaskState::Paused);
    assert!(paused.execution_epoch > inactive_assignment.execution_epoch as u64);
    assert_eq!(task_record(admin, &unrelated.task_id).await, other_before);
    assert_eq!(
        task_record(admin, &foreign_basis.task_id).await,
        foreign_before
    );

    // These are isolated setup scenarios in a disposable fixture. Preserve the
    // parent's version-zero contract without deleting any Task/receipt history.
    admin.execute("DELETE FROM public.membership_events WHERE organisation_id='org' AND actor_id='admin' AND command_key IN ('revocation-remove','revocation-regrant','revocation-expiry-regrant','revocation-assignment-regrant','revocation-inactive-regrant'); UPDATE public.membership_versions SET version=0 WHERE organisation_id='org'").await.unwrap();
    assert_eq!(
        repo.snapshot("admin", "org", None, None, None)
            .await
            .unwrap()
            .version,
        "0"
    );
    operation_revocation::verify(pool, admin, repo).await;

    // VG1: only the role changes; the assigned engagement is identical before
    // and after both Saves. Removing this role-narrowing predicate must fail.
    admin.execute("UPDATE organisation_memberships SET roles=ARRAY['auditor','admin'] WHERE organisation_id='org' AND actor_id='member'").await.unwrap();
    let (_, role_basis) = claimed(&tasks, "member", &selected, "repair-vg1-claim").await;
    delegation(
        admin,
        "repair-vg1-delegation",
        PolicyKind::Task,
        &role_basis.task_id,
    )
    .await;
    let mut downgrade = save("repair-vg1-downgrade", "0", true);
    downgrade.roles = vec!["admin".into()];
    repo.save_member("admin", "org", &downgrade).await.unwrap();
    assert!(scope::begin(pool, "member", &selected).await.is_err());
    assert_eq!(claim_state(admin, &role_basis.claim_id).await, "abandoned");
    let narrowed = task_record(admin, &role_basis.task_id).await;
    assert!(narrowed["execution_epoch"].as_u64().unwrap() > role_basis.execution_epoch as u64);
    assert_eq!(narrowed["state"], "paused");
    assert!(
        delegation_head(admin, "repair-vg1-delegation")
            .await
            .revoked
    );
    let mut regrant = save("repair-vg1-regrant", "1", true);
    regrant.roles = vec!["auditor".into(), "admin".into()];
    repo.save_member("admin", "org", &regrant).await.unwrap();
    assert!(matches!(
        tasks.consume(&role_basis).await,
        Err(TaskError::Fenced)
    ));
    assert!(
        delegation_head(admin, "repair-vg1-delegation")
            .await
            .revoked
    );
    assert_eq!(task_record(admin, &role_basis.task_id).await, narrowed);
    admin.execute("UPDATE organisation_memberships SET roles=ARRAY['auditor'] WHERE organisation_id='org' AND actor_id='member'; DELETE FROM membership_events WHERE organisation_id='org' AND actor_id='admin' AND command_key IN ('repair-vg1-downgrade','repair-vg1-regrant'); UPDATE membership_versions SET version=0 WHERE organisation_id='org'").await.unwrap();
    renewal_and_remove::verify(pool, admin, repo).await;
    expiry_split::verify(pool, admin, repo).await;
}
