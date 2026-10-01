//! An accepted, non-expiring Admin replaces continuity; a pending invite cannot.
use serde_json::Value;
use sqlx::{Connection, Executor, PgConnection, PgPool};
use std::time::Duration;
use zobba_application::{
    identity::CurrentAuthority, membership::*, operation::wire::StoredPolicy, task::TaskCommands,
};
use zobba_domain::{
    identity::Scope,
    permissions::{PermissionBounds, PolicyDocument, PolicyKind, PolicyReference},
    task::{ClaimBasis, CommandKind, Decision, Observation, TaskCommand, WakeupRoute},
};
use zobba_infrastructure::{
    identity::{IdentityRepository, random_secret, secret_hash},
    membership::MembershipRepository,
    scope,
    task::TaskRepository,
};

const ORG: &str = "accepted-admin-replacement";
const ORIGINAL: &str = "continuity-original-admin";
const RECIPIENT_SUBJECT: &str = "continuity-invited-admin";
const RECIPIENT_EMAIL: &str = "continuity-admin@example.com";

fn save(key: &str, version: &str, actor: &str, active: bool, expiry: Option<i64>) -> SaveMember {
    SaveMember {
        key: key.into(),
        expected_version: version.into(),
        actor_id: actor.into(),
        roles: vec!["admin".into()],
        active,
        expires_at: expiry,
        assignment_mode: AssignmentMode::Replace,
        assignments: if active {
            vec![AssignmentChange {
                client_id: "client".into(),
                engagement_id: "engagement".into(),
                renew: false,
            }]
        } else {
            Vec::new()
        },
    }
}

async fn durable(admin: &mut PgConnection) -> Value {
    sqlx::query_scalar(
        "SELECT jsonb_build_object(
          'members',(SELECT jsonb_agg(to_jsonb(m) ORDER BY actor_id) FROM organisation_memberships m WHERE organisation_id=$1),
          'assignments',(SELECT jsonb_agg(to_jsonb(a) ORDER BY actor_id,client_id,engagement_id) FROM engagement_assignments a WHERE organisation_id=$1),
          'version',(SELECT to_jsonb(v) FROM membership_versions v WHERE organisation_id=$1),
          'invitations',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM membership_invitations i WHERE organisation_id=$1),
          'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM membership_events e WHERE organisation_id=$1),
          'tasks',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM tasks t WHERE organisation_id=$1),
          'task_claims',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM task_claims c WHERE organisation_id=$1),
          'task_slots',(SELECT jsonb_agg(to_jsonb(s) ORDER BY claim_id) FROM task_receipt_slots s WHERE organisation_id=$1),
          'task_observations',(SELECT jsonb_agg(to_jsonb(o) ORDER BY claim_id) FROM task_observations o WHERE organisation_id=$1),
          'task_events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY client_id,engagement_id,cursor) FROM task_events e WHERE organisation_id=$1),
          'task_counters',(SELECT jsonb_agg(to_jsonb(c) ORDER BY client_id,engagement_id) FROM task_counters c WHERE organisation_id=$1),
          'task_wakeups',(SELECT jsonb_agg(to_jsonb(w) ORDER BY id) FROM task_wakeups w WHERE organisation_id=$1),
          'permission_heads',(SELECT jsonb_agg(to_jsonb(h) ORDER BY policy_key) FROM permission_heads h WHERE organisation_id=$1),
          'permission_versions',(SELECT jsonb_agg(to_jsonb(v) ORDER BY policy_key,version) FROM permission_versions v WHERE organisation_id=$1))",
    )
    .bind(ORG)
    .fetch_one(admin)
    .await
    .unwrap()
}

async fn live_claim(
    tasks: &TaskRepository,
    admin: &mut PgConnection,
    actor: &str,
    selected: &Scope,
) -> ClaimBasis {
    let receipt = tasks
        .admit(
            actor,
            selected,
            &TaskCommand {
                key: "continuity-live-task".into(),
                kind: CommandKind::Create,
                task_id: None,
                cycle_id: None,
                content: Some("Last Admin refusal preserves live authority".into()),
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
    let Decision::Execute(basis) = tasks.coordinate(&route, "continuity-worker").await.unwrap()
    else {
        panic!("combined-role Admin must have a live admitted Task claim");
    };
    // Keep the unrelated five-second worker lease out of this rollback proof.
    sqlx::query("UPDATE tasks SET owner_until=clock_timestamp()+interval '60 seconds' WHERE id=$1")
        .bind(&basis.task_id)
        .execute(&mut *admin)
        .await
        .unwrap();
    let document = PolicyDocument {
        schema_version: 1,
        kind: PolicyKind::Delegation,
        subject_id: "continuity-live-delegation".into(),
        version: 1,
        actor_id: ORIGINAL.into(),
        created_at: 1,
        revoked: false,
        hard: PermissionBounds { rules: vec![] },
        standing: PermissionBounds { rules: vec![] },
        account: None,
        parent: Some(PolicyReference {
            kind: PolicyKind::Task,
            subject_id: basis.task_id.clone(),
            version: 1,
        }),
    };
    assert!(document.is_valid());
    let policy_key = "6:client10:engagementdelegation:continuity-live-delegation";
    sqlx::query("INSERT INTO permission_versions(organisation_id,policy_key,client_id,engagement_id,kind,subject_id,version,document,actor_id) VALUES($1,$2,'client','engagement','delegation','continuity-live-delegation',1,$3,$4)")
        .bind(ORG).bind(policy_key)
        .bind(serde_json::to_string(&StoredPolicy(document)).unwrap())
        .bind(ORIGINAL).execute(&mut *admin).await.unwrap();
    sqlx::query("INSERT INTO permission_heads(organisation_id,policy_key,client_id,engagement_id,current_version) VALUES($1,$2,'client','engagement',1)")
        .bind(ORG).bind(policy_key).execute(&mut *admin).await.unwrap();
    *basis
}

async fn now(admin: &mut PgConnection) -> i64 {
    sqlx::query_scalar("SELECT extract(epoch FROM clock_timestamp())::bigint")
        .fetch_one(admin)
        .await
        .unwrap()
}

async fn assert_receipt(admin: &mut PgConnection, receipt: &Receipt) {
    let stored: Value = sqlx::query_scalar(
        "SELECT receipt FROM membership_events WHERE organisation_id=$1 AND id=$2 AND actor_id=$3",
    )
    .bind(ORG)
    .bind(&receipt.event_id)
    .bind(&receipt.actor_id)
    .fetch_one(admin)
    .await
    .unwrap();
    assert_eq!(stored, serde_json::to_value(receipt).unwrap());
}

pub async fn verify(pool: &PgPool, admin: &mut PgConnection, issuer: &str) {
    let mut tx = admin.begin().await.unwrap();
    sqlx::query("INSERT INTO identities(id,issuer,subject,display_name) VALUES($1,$2,$1,'Original continuity Admin')")
        .bind(ORIGINAL).bind(issuer).execute(&mut *tx).await.unwrap();
    tx.execute(
        "INSERT INTO organisations(id,name) VALUES('accepted-admin-replacement','Accepted Admin replacement');
         INSERT INTO clients(organisation_id,id,name) VALUES('accepted-admin-replacement','client','Continuity client');
         INSERT INTO engagements(organisation_id,client_id,id,name) VALUES('accepted-admin-replacement','client','engagement','Continuity engagement');
         INSERT INTO organisation_memberships(organisation_id,actor_id,roles) VALUES('accepted-admin-replacement','continuity-original-admin',ARRAY['admin']);
         INSERT INTO engagement_assignments(organisation_id,client_id,engagement_id,actor_id) VALUES('accepted-admin-replacement','client','engagement','continuity-original-admin')",
    ).await.unwrap();
    tx.commit().await.unwrap();

    let identities = IdentityRepository::new(pool.clone());
    let original_token = identities
        .establish_verified_session(
            issuer,
            ORIGINAL,
            "Original continuity Admin",
            Some("continuity-original@example.com"),
            None,
        )
        .await
        .unwrap();
    assert_eq!(
        identities
            .session(&original_token)
            .await
            .unwrap()
            .identity
            .id,
        ORIGINAL
    );
    let original = MembershipRepository::new(pool.clone(), issuer.into())
        .with_session_hash(secret_hash(&original_token));
    let initial = original
        .snapshot(ORIGINAL, ORG, None, None, None)
        .await
        .unwrap();
    assert_eq!(initial.members.len(), 1);
    let secret = random_secret().unwrap();
    let invitation = original
        .invite(
            ORIGINAL,
            ORG,
            &InviteCommand {
                key: "invite-replacement-admin".into(),
                expected_version: initial.version,
                recipient_email: RECIPIENT_EMAIL.into(),
                roles: vec!["admin".into()],
                assignments: vec![Assignment {
                    client_id: "client".into(),
                    engagement_id: "engagement".into(),
                }],
                expires_in_seconds: 3600,
                secret: secret.clone(),
            },
        )
        .await
        .unwrap();
    let pending = original
        .snapshot(ORIGINAL, ORG, None, None, None)
        .await
        .unwrap();
    assert_eq!(pending.version, invitation.version);
    assert_eq!(pending.members.len(), 1);
    assert_eq!(pending.invitations.len(), 1);
    assert_eq!(pending.invitations[0].status, "pending");
    assert_eq!(
        Some(&pending.invitations[0].id),
        invitation.invitation_id.as_ref()
    );
    let expiry: i64 =
        sqlx::query_scalar("SELECT extract(epoch FROM clock_timestamp())::bigint+3600")
            .fetch_one(&mut *admin)
            .await
            .unwrap();
    let mut temporary = save(
        "make-original-temporary",
        &pending.version,
        ORIGINAL,
        true,
        Some(expiry),
    );
    let before = durable(admin).await;
    assert_eq!(
        original.save_member(ORIGINAL, ORG, &temporary).await,
        Err(MembershipError::LastAdmin)
    );
    assert_eq!(
        durable(admin).await,
        before,
        "pending invitation allowed a partial Save"
    );
    assert_eq!(
        original
            .snapshot(ORIGINAL, ORG, None, None, None)
            .await
            .unwrap(),
        pending
    );

    let recipient_token = identities
        .establish_verified_session(
            issuer,
            RECIPIENT_SUBJECT,
            "Invited continuity Admin",
            Some(RECIPIENT_EMAIL),
            None,
        )
        .await
        .unwrap();
    let recipient_actor = identities
        .session(&recipient_token)
        .await
        .unwrap()
        .identity
        .id;
    let recipient_hash = secret_hash(&recipient_token);
    let recipient = MembershipRepository::new(pool.clone(), issuer.into())
        .with_session_hash(recipient_hash.clone());
    let acceptance = recipient
        .accept(
            &recipient_actor,
            &recipient_hash,
            &secret,
            "accept-replacement-admin",
        )
        .await
        .unwrap();
    assert_eq!(acceptance.kind, "accept");
    assert_eq!(acceptance.actor_id, recipient_actor);
    assert_eq!(acceptance.invitation_id, invitation.invitation_id);
    assert_receipt(admin, &acceptance).await;
    let accepted = original
        .snapshot(ORIGINAL, ORG, None, None, None)
        .await
        .unwrap();
    assert_eq!(accepted.version, acceptance.version);
    let replacement = accepted
        .members
        .iter()
        .find(|member| member.actor_id == recipient_actor)
        .unwrap();
    assert_eq!(replacement.roles, ["admin"]);
    assert!(replacement.active);
    assert_eq!(replacement.expires_at, None);
    assert_eq!(replacement.assignments.len(), 1);
    assert_eq!(accepted.invitations[0].status, "accepted");
    let qualifies: bool = sqlx::query_scalar(
        "SELECT m.active AND m.expires_at IS NULL AND 'admin'=ANY(m.roles) AND i.active
         FROM organisation_memberships m JOIN identities i ON i.id=m.actor_id
         WHERE m.organisation_id=$1 AND m.actor_id=$2",
    )
    .bind(ORG)
    .bind(&recipient_actor)
    .fetch_one(&mut *admin)
    .await
    .unwrap();
    assert!(
        qualifies,
        "accepted Admin did not establish durable continuity"
    );

    // Both Admins have an explicit assignment. The Admin role still grants no
    // audit chooser entry or scoped audit access, including after acceptance.
    let selected = Scope {
        organisation_id: ORG.into(),
        client_id: "client".into(),
        engagement_id: "engagement".into(),
    };
    for actor in [ORIGINAL, recipient_actor.as_str()] {
        assert!(
            identities
                .engagements(actor, None)
                .await
                .unwrap()
                .engagements
                .is_empty()
        );
        assert!(matches!(
            scope::begin(pool, actor, &selected).await,
            Err(scope::ScopeError::Denied)
        ));
    }
    assert_eq!(
        recipient
            .snapshot(&recipient_actor, ORG, None, None, None)
            .await
            .unwrap(),
        accepted
    );

    // The previously refused command key is reusable because refusal persisted
    // neither a receipt nor a version. Only its freshly read version changes.
    temporary.expected_version = accepted.version;
    let saved = original
        .save_member(ORIGINAL, ORG, &temporary)
        .await
        .unwrap();
    assert_eq!(saved.kind, "save_member");
    assert_eq!(saved.actor_id, ORIGINAL);
    assert_eq!(saved.subject_actor_id.as_deref(), Some(ORIGINAL));
    assert_receipt(admin, &saved).await;
    let after_expiry = original
        .snapshot(ORIGINAL, ORG, None, None, None)
        .await
        .unwrap();
    assert_eq!(after_expiry.version, saved.version);
    let prior_admin = after_expiry
        .members
        .iter()
        .find(|member| member.actor_id == ORIGINAL)
        .unwrap();
    assert!(prior_admin.active);
    assert_eq!(prior_admin.expires_at, Some(expiry));
    assert_eq!(
        original
            .save_member(ORIGINAL, ORG, &temporary)
            .await
            .unwrap(),
        saved
    );

    // Keep the Admin-only audit-boundary checks above. Now explicitly grant the
    // permanent Admin an audit role, so the refused Save has live execution and
    // delegation authority to fence, not just membership rows to roll back.
    let mut combined = save(
        "grant-replacement-audit-role",
        &after_expiry.version,
        &recipient_actor,
        true,
        None,
    );
    combined.roles.push("auditor".into());
    let combined_receipt = original
        .save_member(ORIGINAL, ORG, &combined)
        .await
        .unwrap();
    assert_receipt(admin, &combined_receipt).await;
    let after_combined = original
        .snapshot(ORIGINAL, ORG, None, None, None)
        .await
        .unwrap();
    assert_eq!(after_combined.version, combined_receipt.version);
    let tasks = TaskRepository::new(pool.clone());
    let basis = live_claim(&tasks, admin, &recipient_actor, &selected).await;
    let mut remove = save(
        "remove-accepted-admin",
        &after_combined.version,
        &recipient_actor,
        false,
        None,
    );
    let before_removal = durable(admin).await;
    assert_eq!(before_removal["tasks"][0]["state"], "ready");
    assert_eq!(before_removal["task_claims"][0]["state"], "admitted");
    assert_eq!(before_removal["task_slots"], Value::Null);
    assert_eq!(before_removal["permission_heads"][0]["current_version"], 1);
    assert_eq!(
        before_removal["permission_versions"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    // The frozen schema-5 preguard accepts a currently eligible temporary
    // peer. This Save therefore runs membership_fence before schema 7 refuses
    // its deferred commit. Every affected durable surface must roll back.
    assert!(now(admin).await < expiry);
    assert_eq!(
        original.save_member(ORIGINAL, ORG, &remove).await,
        Err(MembershipError::LastAdmin)
    );
    assert_eq!(
        durable(admin).await,
        before_removal,
        "deferred refusal leaked membership, Task, claim, delegation, version or receipt changes"
    );
    assert_eq!(
        original
            .snapshot(ORIGINAL, ORG, None, None, None)
            .await
            .unwrap(),
        after_combined
    );
    let permitted = scope::begin(pool, &recipient_actor, &selected)
        .await
        .unwrap();
    permitted.rollback().await.unwrap();
    let consumed = tasks.consume(&basis).await.unwrap();
    tasks
        .observe(&consumed, Observation::Cancelled)
        .await
        .unwrap();

    let restored = original
        .save_member(
            ORIGINAL,
            ORG,
            &save(
                "restore-original-continuity",
                &after_combined.version,
                ORIGINAL,
                true,
                None,
            ),
        )
        .await
        .unwrap();
    remove.expected_version = restored.version;
    let removed = original.save_member(ORIGINAL, ORG, &remove).await.unwrap();
    assert_receipt(admin, &removed).await;
    // Positive control: the same removal fences the same Task/delegation once
    // a permanent replacement exists. The earlier unchanged snapshot cannot
    // pass merely because the fixture was outside membership_fence's scope.
    let fenced = durable(admin).await;
    assert_eq!(fenced["tasks"][0]["state"], "paused");
    assert!(
        fenced["tasks"][0]["execution_epoch"].as_u64().unwrap()
            > before_removal["tasks"][0]["execution_epoch"]
                .as_u64()
                .unwrap()
    );
    assert_eq!(fenced["permission_heads"][0]["current_version"], 2);
    let revoked = serde_json::from_str::<StoredPolicy>(
        fenced["permission_versions"][1]["document"]
            .as_str()
            .unwrap(),
    )
    .unwrap()
    .0;
    assert!(revoked.revoked);
    assert_eq!(revoked.actor_id, ORIGINAL);
    let after_removal = original
        .snapshot(ORIGINAL, ORG, None, None, None)
        .await
        .unwrap();
    assert_eq!(after_removal.version, removed.version);
    let inactive = after_removal
        .members
        .iter()
        .find(|member| member.actor_id == recipient_actor)
        .unwrap();
    assert!(!inactive.active);
    assert!(inactive.assignments.is_empty());
    assert_eq!(
        recipient
            .snapshot(&recipient_actor, ORG, None, None, None)
            .await,
        Err(MembershipError::Denied)
    );

    let before_replay = durable(admin).await;
    assert_eq!(
        recipient
            .accept(
                &recipient_actor,
                &recipient_hash,
                &secret,
                "accept-replacement-admin"
            )
            .await
            .unwrap(),
        acceptance
    );
    assert_eq!(
        durable(admin).await,
        before_replay,
        "acceptance replay regranted removed authority"
    );
    assert_eq!(
        original
            .snapshot(ORIGINAL, ORG, None, None, None)
            .await
            .unwrap(),
        after_removal
    );
    assert_eq!(
        recipient
            .snapshot(&recipient_actor, ORG, None, None, None)
            .await,
        Err(MembershipError::Denied)
    );
    assert!(matches!(
        scope::begin(pool, &recipient_actor, &selected).await,
        Err(scope::ScopeError::Denied)
    ));

    // Let an additional temporary Admin expire by wall clock, with no authority
    // write or cleanup between the before/after observations. The permanent
    // Admin remains administratively eligible throughout.
    let deadline = now(admin).await + 4;
    let mut temporary_again = save(
        "temporary-admin-clock-crossing",
        &after_removal.version,
        &recipient_actor,
        true,
        Some(deadline),
    );
    temporary_again.assignments[0].renew = true;
    let temporary_receipt = original
        .save_member(ORIGINAL, ORG, &temporary_again)
        .await
        .unwrap();
    assert_receipt(admin, &temporary_receipt).await;
    let before_crossing = original
        .snapshot(ORIGINAL, ORG, None, None, None)
        .await
        .unwrap();
    assert_eq!(before_crossing.version, temporary_receipt.version);
    assert_eq!(
        recipient
            .snapshot(&recipient_actor, ORG, None, None, None)
            .await
            .unwrap(),
        before_crossing
    );
    for (repository, actor) in [
        (&original, ORIGINAL),
        (&recipient, recipient_actor.as_str()),
    ] {
        let organisations = repository.organisations(actor, None).await.unwrap();
        assert_eq!(organisations.organisations.len(), 1);
        assert_eq!(organisations.organisations[0].organisation_id, ORG);
    }
    assert!(
        now(admin).await < deadline,
        "temporary Admin must first be eligible"
    );
    let unchanged = durable(admin).await;
    tokio::time::timeout(Duration::from_secs(8), async {
        while now(admin).await < deadline {
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .expect("temporary Admin expiry did not cross within the bound");
    assert_eq!(
        recipient
            .snapshot(&recipient_actor, ORG, None, None, None)
            .await,
        Err(MembershipError::Denied)
    );
    assert!(
        recipient
            .organisations(&recipient_actor, None)
            .await
            .unwrap()
            .organisations
            .is_empty()
    );
    let after_crossing_save = save(
        "admin-save-after-clock-crossing",
        &temporary_receipt.version,
        ORIGINAL,
        true,
        None,
    );
    assert_eq!(
        recipient
            .save_member(&recipient_actor, ORG, &after_crossing_save)
            .await,
        Err(MembershipError::Denied)
    );
    assert_eq!(
        original
            .snapshot(ORIGINAL, ORG, None, None, None)
            .await
            .unwrap(),
        before_crossing
    );
    let permanent = original.organisations(ORIGINAL, None).await.unwrap();
    assert_eq!(permanent.organisations.len(), 1);
    assert_eq!(permanent.organisations[0].organisation_id, ORG);
    assert_eq!(
        identities
            .session(&recipient_token)
            .await
            .unwrap()
            .identity
            .id,
        recipient_actor
    );
    let qualifying: Vec<String> = sqlx::query_scalar(
        "SELECT m.actor_id FROM organisation_memberships m JOIN identities i ON i.id=m.actor_id
         WHERE m.organisation_id=$1 AND m.active AND m.expires_at IS NULL AND 'admin'=ANY(m.roles) AND i.active ORDER BY m.actor_id",
    ).bind(ORG).fetch_all(&mut *admin).await.unwrap();
    assert_eq!(qualifying, [ORIGINAL]);
    assert_eq!(
        durable(admin).await,
        unchanged,
        "clock crossing changed durable authority, versions or receipts"
    );
    // Only after the unchanged crossing proof, exercise the permanent Admin's
    // ordinary Save: expiry of its peer did not strand administration.
    let retained = original
        .save_member(ORIGINAL, ORG, &after_crossing_save)
        .await
        .unwrap();
    assert_eq!(retained.actor_id, ORIGINAL);
    assert_eq!(retained.subject_actor_id.as_deref(), Some(ORIGINAL));
    assert_receipt(admin, &retained).await;
}
