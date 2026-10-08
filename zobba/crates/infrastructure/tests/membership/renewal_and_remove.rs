//! Real clock-boundary renewal and scoped Remove fencing, within the guarded fixture.
use super::*;
use std::time::Duration;

pub async fn verify(pool: &PgPool, admin: &mut PgConnection, repo: &MembershipRepository) {
    let tasks = TaskRepository::new(pool.clone());
    let selected = selected("org");
    let (_, basis) = claimed(&tasks, "member", &selected, "renewal-boundary-claim").await;
    delegation(
        admin,
        "renewal-boundary-delegation",
        PolicyKind::Task,
        &basis.task_id,
    )
    .await;
    let expiry: i64 = sqlx::query_scalar("UPDATE engagement_assignments SET expires_at=extract(epoch FROM clock_timestamp())::bigint+2 WHERE organisation_id='org' AND client_id='client' AND engagement_id='engagement' AND actor_id='member' RETURNING expires_at")
        .fetch_one(&mut *admin).await.unwrap();
    let loaded = repo
        .snapshot("admin", "org", None, None, None)
        .await
        .unwrap();
    assert_eq!(loaded.version, "0");
    assert_eq!(
        loaded
            .members
            .iter()
            .find(|m| m.actor_id == "member")
            .unwrap()
            .assignments
            .len(),
        1
    );
    let mut retained = save("renewal-boundary-retain", "0", true);
    retained.roles.push("audit_manager".into());
    // Time alone changes effective authority, without a version or fixture edit.
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let now: i64 =
                sqlx::query_scalar("SELECT extract(epoch FROM clock_timestamp())::bigint")
                    .fetch_one(&mut *admin)
                    .await
                    .unwrap();
            if now >= expiry {
                break;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .unwrap();
    let retained_receipt = repo.save_member("admin", "org", &retained).await.unwrap();
    assert_eq!(retained_receipt.version, "1");
    let historical: Value = sqlx::query_scalar(
        "SELECT to_jsonb(e) FROM membership_events e WHERE command_key='renewal-boundary-retain'",
    )
    .fetch_one(&mut *admin)
    .await
    .unwrap();
    assert!(
        historical["meaning"]["command"]["assignments"][0]
            .get("renew")
            .is_none()
    );
    assert!(
        historical["meaning"]["command"]
            .get("assignment_mode")
            .is_none()
    );
    let hash: String = sqlx::query_scalar("SELECT token_hash FROM sessions WHERE actor_id='admin'")
        .fetch_one(&mut *admin)
        .await
        .unwrap();
    // Both forms reach the callable runtime SQL entry, recovering the same
    // pre-default historical meaning without modifying the immutable event.
    for omitted in [false, true] {
        let mut wire = serde_json::to_value(&retained).unwrap();
        wire["roles"]
            .as_array_mut()
            .unwrap()
            .sort_by(|a, b| a.as_str().cmp(&b.as_str()));
        if omitted {
            wire["assignments"][0]
                .as_object_mut()
                .unwrap()
                .remove("renew");
            wire.as_object_mut().unwrap().remove("assignment_mode");
        }
        let mut tx = scope::begin_actor(pool, "admin").await.unwrap();
        let receipt:Value=sqlx::query_scalar("SELECT membership_write('admin',$1,'org','save_member',$2,'retry-event','retry-invite','https://membership.fixture.invalid')").bind(&hash).bind(wire).fetch_one(&mut *tx).await.unwrap();
        assert_eq!(receipt, serde_json::to_value(&retained_receipt).unwrap());
        tx.commit().await.unwrap();
    }
    let unchanged: Value = sqlx::query_scalar(
        "SELECT to_jsonb(e) FROM membership_events e WHERE command_key='renewal-boundary-retain'",
    )
    .fetch_one(&mut *admin)
    .await
    .unwrap();
    assert_eq!(historical, unchanged);
    for invalid in [Value::Null, Value::String("false".into())] {
        let mut wire = serde_json::to_value(&retained).unwrap();
        wire["assignments"][0]["renew"] = invalid;
        let mut tx = scope::begin_actor(pool, "admin").await.unwrap();
        let error=sqlx::query_scalar::<_,Value>("SELECT membership_write('admin',$1,'org','save_member',$2,'retry-event','retry-invite','https://membership.fixture.invalid')").bind(&hash).bind(wire).fetch_one(&mut *tx).await.unwrap_err();
        assert_eq!(
            error.as_database_error().unwrap().code().as_deref(),
            Some("Z0001")
        );
        tx.rollback().await.unwrap();
    }
    let saved_expiry:Option<i64>=sqlx::query_scalar("SELECT expires_at FROM engagement_assignments WHERE organisation_id='org' AND actor_id='member' AND engagement_id='engagement'").fetch_one(&mut *admin).await.unwrap();
    assert_eq!(
        saved_expiry,
        Some(expiry),
        "retained selection silently renewed after clock expiry"
    );
    assert!(scope::begin(pool, "member", &selected).await.is_err());
    assert_eq!(claim_state(admin, &basis.claim_id).await, "abandoned");
    assert!(
        delegation_head(admin, "renewal-boundary-delegation")
            .await
            .revoked
    );

    let mut renewed = renew("renewal-boundary-explicit", "1", true);
    renewed.roles = retained.roles;
    let receipt = repo.save_member("admin", "org", &renewed).await.unwrap();
    let after = task_record(admin, &basis.task_id).await;
    let event_before: Value = sqlx::query_scalar(
        "SELECT to_jsonb(e) FROM membership_events e WHERE command_key='renewal-boundary-explicit'",
    )
    .fetch_one(&mut *admin)
    .await
    .unwrap();
    assert_eq!(
        event_before["meaning"]["command"]["assignments"][0]["renew"],
        true
    );
    assert_eq!(
        repo.save_member("admin", "org", &renewed).await.unwrap(),
        receipt
    );
    let event_after: Value = sqlx::query_scalar(
        "SELECT to_jsonb(e) FROM membership_events e WHERE command_key='renewal-boundary-explicit'",
    )
    .fetch_one(&mut *admin)
    .await
    .unwrap();
    assert_eq!(
        event_before, event_after,
        "exact renewal retry changed immutable event"
    );
    assert_eq!(task_record(admin, &basis.task_id).await, after);
    assert!(matches!(
        tasks.consume(&basis).await,
        Err(TaskError::Fenced)
    ));
    assert!(
        delegation_head(admin, "renewal-boundary-delegation")
            .await
            .revoked
    );
    let grant = scope::begin(pool, "member", &selected).await.unwrap();
    grant.rollback().await.unwrap();
    let mut changed = renewed;
    changed.assignments[0].renew = false;
    assert_eq!(
        repo.save_member("admin", "org", &changed).await,
        Err(MembershipError::Conflict)
    );
    admin.execute("UPDATE organisation_memberships SET roles=ARRAY['auditor'] WHERE organisation_id='org' AND actor_id='member'; DELETE FROM membership_events WHERE organisation_id='org' AND command_key LIKE 'renewal-boundary-%'; UPDATE membership_versions SET version=0 WHERE organisation_id='org'").await.unwrap();

    // VG4: Remove only one scope, retaining another live assignment belonging to
    // the same member. Every authority artifact is observed on both sides.
    admin.execute("INSERT INTO engagements VALUES('org','client','preserved','Preserved Engagement'); INSERT INTO engagement_assignments(organisation_id,client_id,engagement_id,actor_id) VALUES('org','client','preserved','member')").await.unwrap();
    let preserved = Scope {
        engagement_id: "preserved".into(),
        ..selected.clone()
    };
    let (removed_route, removed_basis) =
        claimed(&tasks, "member", &selected, "remove-selected-claim").await;
    let (_, preserved_basis) =
        claimed(&tasks, "member", &preserved, "remove-preserved-claim").await;
    delegation_in(
        admin,
        &selected,
        "remove-selected-delegation",
        PolicyKind::Task,
        &removed_basis.task_id,
    )
    .await;
    delegation_in(
        admin,
        &preserved,
        "remove-preserved-delegation",
        PolicyKind::Task,
        &preserved_basis.task_id,
    )
    .await;
    let preserved_task = task_record(admin, &preserved_basis.task_id).await;
    let preserved_delegation = delegation_head(admin, "remove-preserved-delegation").await;
    let mut remove = save("remove-selected", "0", true);
    remove.assignment_mode = AssignmentMode::Remove;
    repo.save_member("admin", "org", &remove).await.unwrap();
    assert!(scope::begin(pool, "member", &selected).await.is_err());
    let fenced = task_record(admin, &removed_basis.task_id).await;
    assert!(fenced["execution_epoch"].as_u64().unwrap() > removed_basis.execution_epoch as u64);
    assert_eq!(fenced["state"], "paused");
    assert_eq!(
        claim_state(admin, &removed_basis.claim_id).await,
        "abandoned"
    );
    assert!(
        delegation_head(admin, "remove-selected-delegation")
            .await
            .revoked
    );
    assert_eq!(
        task_record(admin, &preserved_basis.task_id).await,
        preserved_task
    );
    assert_eq!(
        claim_state(admin, &preserved_basis.claim_id).await,
        "admitted"
    );
    assert_eq!(
        delegation_head(admin, "remove-preserved-delegation").await,
        preserved_delegation
    );
    let consumed = tasks.consume(&preserved_basis).await.unwrap();
    assert!(tasks.current(&preserved_basis).await.unwrap());
    let preserved_task = task_record(admin, &preserved_basis.task_id).await;

    let mut regrant = renew("remove-selected-regrant", "1", true);
    regrant.assignments.push(AssignmentChange {
        client_id: preserved.client_id.clone(),
        engagement_id: preserved.engagement_id.clone(),
        renew: false,
    });
    repo.save_member("admin", "org", &regrant).await.unwrap();
    assert!(matches!(
        tasks.consume(&removed_basis).await,
        Err(TaskError::Fenced)
    ));
    assert_eq!(
        tasks
            .coordinate(&removed_route, "membership-worker")
            .await
            .unwrap(),
        Decision::Idle
    );
    assert!(
        delegation_head(admin, "remove-selected-delegation")
            .await
            .revoked
    );
    assert_eq!(
        task_record(admin, &preserved_basis.task_id).await,
        preserved_task
    );
    assert_eq!(
        delegation_head(admin, "remove-preserved-delegation").await,
        preserved_delegation
    );
    tasks
        .observe(&consumed, Observation::Cancelled)
        .await
        .unwrap();
    assert_eq!(
        custody(admin, &preserved_basis.claim_id).await["observation"]["outcome"],
        "cancelled"
    );
    // Keep the original fixture's assignment set, without deleting execution evidence.
    admin.execute("UPDATE engagement_assignments SET active=false WHERE organisation_id='org' AND actor_id='member' AND engagement_id='preserved'; DELETE FROM membership_events WHERE organisation_id='org' AND command_key IN ('remove-selected','remove-selected-regrant'); UPDATE membership_versions SET version=0 WHERE organisation_id='org'").await.unwrap();
}
