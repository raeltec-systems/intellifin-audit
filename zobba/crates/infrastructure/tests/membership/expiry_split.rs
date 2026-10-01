//! R1: expiry crosses after fence classification but before authority UPDATE.
//! The test-only trigger gates the real SQL entry point without changing it.
use super::*;
use std::time::{Duration, Instant};

fn with_preserved(mut command: SaveMember) -> SaveMember {
    command.assignments.push(AssignmentChange {
        client_id: "client".into(),
        engagement_id: "preserved".into(),
        renew: false,
    });
    command
}

async fn now(admin: &mut PgConnection) -> i64 {
    sqlx::query_scalar("SELECT extract(epoch FROM clock_timestamp())::bigint")
        .fetch_one(admin)
        .await
        .unwrap()
}

async fn protect_claim_lease(admin: &mut PgConnection, basis: &ClaimBasis) {
    // Isolate expiry authority from the unrelated five-second worker lease.
    sqlx::query("UPDATE tasks SET owner_until=clock_timestamp()+interval '60 seconds' WHERE id=$1")
        .bind(&basis.task_id)
        .execute(admin)
        .await
        .unwrap();
}

pub async fn verify(pool: &PgPool, admin: &mut PgConnection, repo: &MembershipRepository) {
    let tasks = TaskRepository::new(pool.clone());
    let selected = selected("org");
    let preserved = Scope {
        engagement_id: "preserved".into(),
        ..selected.clone()
    };
    admin.execute("UPDATE engagement_assignments SET active=true,expires_at=NULL WHERE organisation_id='org' AND actor_id='member'; UPDATE organisation_memberships SET expires_at=NULL WHERE organisation_id='org' AND actor_id='member'").await.unwrap();

    // No expiry change and renew:false must leave future-finite work usable.
    let finite = now(admin).await + 3600;
    sqlx::query("UPDATE engagement_assignments SET expires_at=$1 WHERE organisation_id='org' AND actor_id='member'").bind(finite).execute(&mut *admin).await.unwrap();
    sqlx::query("UPDATE organisation_memberships SET expires_at=$1 WHERE organisation_id='org' AND actor_id='member'").bind(finite).execute(&mut *admin).await.unwrap();
    let (_, unchanged) = claimed(&tasks, "member", &selected, "r1-unchanged-claim").await;
    delegation(
        admin,
        "r1-unchanged-delegation",
        PolicyKind::Task,
        &unchanged.task_id,
    )
    .await;
    let unchanged_task = task_record(admin, &unchanged.task_id).await;
    let unchanged_delegation = delegation_head(admin, "r1-unchanged-delegation").await;
    let mut unchanged_command = with_preserved(save("r1-unchanged", "0", true));
    unchanged_command.expires_at = Some(finite);
    repo.save_member("admin", "org", &unchanged_command)
        .await
        .unwrap();
    assert_eq!(task_record(admin, &unchanged.task_id).await, unchanged_task);
    assert_eq!(
        delegation_head(admin, "r1-unchanged-delegation").await,
        unchanged_delegation
    );
    assert_eq!(claim_state(admin, &unchanged.claim_id).await, "admitted");
    let consumed = tasks.consume(&unchanged).await.unwrap();
    tasks
        .observe(&consumed, Observation::Cancelled)
        .await
        .unwrap();

    // An explicit future-finite renewal conservatively fences its scope even
    // when the retained deadline remains future and therefore is not cleared.
    let (_, future) = claimed(&tasks, "member", &selected, "r1-future-claim").await;
    let (_, untouched) = claimed(&tasks, "member", &preserved, "r1-future-preserved").await;
    delegation(
        admin,
        "r1-future-delegation",
        PolicyKind::Task,
        &future.task_id,
    )
    .await;
    delegation_in(
        admin,
        &preserved,
        "r1-future-preserved-delegation",
        PolicyKind::Task,
        &untouched.task_id,
    )
    .await;
    let untouched_task = task_record(admin, &untouched.task_id).await;
    let untouched_delegation = delegation_head(admin, "r1-future-preserved-delegation").await;
    let mut future_command = with_preserved(renew("r1-future", "1", true));
    future_command.expires_at = Some(finite);
    repo.save_member("admin", "org", &future_command)
        .await
        .unwrap();
    let unchanged_expiry:Option<i64>=sqlx::query_scalar("SELECT expires_at FROM engagement_assignments WHERE organisation_id='org' AND actor_id='member' AND engagement_id='engagement'").fetch_one(&mut *admin).await.unwrap();
    assert_eq!(unchanged_expiry, Some(finite));
    assert_eq!(claim_state(admin, &future.claim_id).await, "abandoned");
    assert!(
        task_record(admin, &future.task_id).await["execution_epoch"]
            .as_u64()
            .unwrap()
            > future.execution_epoch as u64
    );
    assert!(delegation_head(admin, "r1-future-delegation").await.revoked);
    assert!(matches!(
        tasks.consume(&future).await,
        Err(TaskError::Fenced)
    ));
    assert_eq!(task_record(admin, &untouched.task_id).await, untouched_task);
    assert_eq!(
        delegation_head(admin, "r1-future-preserved-delegation").await,
        untouched_delegation
    );
    let consumed = tasks.consume(&untouched).await.unwrap();
    tasks
        .observe(&consumed, Observation::Cancelled)
        .await
        .unwrap();

    // The real membership_write always calls membership_fence before this
    // UPDATE. This fixture trigger creates a deterministic stop between them.
    admin.execute("CREATE FUNCTION public.membership_test_expiry_gate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.actor_id='member' THEN PERFORM pg_advisory_xact_lock(206,919); END IF; RETURN NEW; END $$; CREATE TRIGGER membership_test_expiry_gate BEFORE UPDATE ON organisation_memberships FOR EACH ROW EXECUTE FUNCTION public.membership_test_expiry_gate()").await.unwrap();
    for (index, kind) in ["assignment", "membership-unlimited", "membership-later"]
        .into_iter()
        .enumerate()
    {
        admin.execute("UPDATE engagement_assignments SET active=true,expires_at=NULL WHERE organisation_id='org' AND actor_id='member'; UPDATE organisation_memberships SET expires_at=NULL WHERE organisation_id='org' AND actor_id='member'").await.unwrap();
        let (_, basis) = claimed(&tasks, "member", &selected, &format!("r1-{kind}-claim")).await;
        let (_, other_basis) = claimed(
            &tasks,
            "member",
            &preserved,
            &format!("r1-{kind}-preserved-claim"),
        )
        .await;
        protect_claim_lease(admin, &basis).await;
        protect_claim_lease(admin, &other_basis).await;
        let subject = format!("r1-{kind}-delegation");
        let other_subject = format!("r1-{kind}-preserved-delegation");
        delegation(admin, &subject, PolicyKind::Task, &basis.task_id).await;
        delegation_in(
            admin,
            &preserved,
            &other_subject,
            PolicyKind::Task,
            &other_basis.task_id,
        )
        .await;
        let before = task_record(admin, &basis.task_id).await;
        let other_before = task_record(admin, &other_basis.task_id).await;
        let other_delegation = delegation_head(admin, &other_subject).await;
        let expiry = now(admin).await + 4;
        let assignment_only = kind == "assignment";
        if assignment_only {
            sqlx::query("UPDATE engagement_assignments SET expires_at=$1 WHERE organisation_id='org' AND actor_id='member' AND engagement_id='engagement'").bind(expiry).execute(&mut *admin).await.unwrap();
        } else {
            sqlx::query("UPDATE organisation_memberships SET expires_at=$1 WHERE organisation_id='org' AND actor_id='member'").bind(expiry).execute(&mut *admin).await.unwrap();
        }
        let mut command =
            with_preserved(save(&format!("r1-{kind}"), &(index + 2).to_string(), true));
        command.assignments[0].renew = assignment_only;
        command.expires_at = if kind == "membership-later" {
            Some(expiry + 3600)
        } else {
            None
        };
        let mut barrier = pool.begin().await.unwrap();
        let barrier_pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *barrier)
            .await
            .unwrap();
        sqlx::query("SELECT pg_advisory_xact_lock(206,919)")
            .execute(&mut *barrier)
            .await
            .unwrap();
        let pending_repo = repo.clone();
        let pending_command = command.clone();
        let pending = tokio::spawn(async move {
            pending_repo
                .save_member("admin", "org", &pending_command)
                .await
        });
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            let blocked:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity a WHERE a.datname=current_database() AND a.query LIKE '%membership_write%' AND $1=ANY(pg_blocking_pids(a.pid)))").bind(barrier_pid).fetch_one(&mut *admin).await.unwrap();
            if blocked {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "writer never reached its post-fence UPDATE trigger"
            );
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert!(
            now(admin).await < expiry,
            "expiry must still be future after fence classification"
        );
        tokio::time::timeout(Duration::from_secs(6), async {
            while now(admin).await < expiry {
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await
        .unwrap();
        barrier.commit().await.unwrap();
        let receipt = pending.await.unwrap().unwrap();
        let after = task_record(admin, &basis.task_id).await;
        assert!(
            after["execution_epoch"].as_u64().unwrap()
                > before["execution_epoch"].as_u64().unwrap(),
            "{kind}: renewal did not advance the old epoch"
        );
        assert_eq!(after["state"], "paused");
        assert_eq!(claim_state(admin, &basis.claim_id).await, "abandoned");
        assert!(delegation_head(admin, &subject).await.revoked);
        let permitted = scope::begin(pool, "member", &selected).await.unwrap();
        permitted.rollback().await.unwrap();
        assert!(
            matches!(tasks.consume(&basis).await, Err(TaskError::Fenced)),
            "{kind}: old claim survived renewal"
        );
        if assignment_only {
            let expiry:Option<i64>=sqlx::query_scalar("SELECT expires_at FROM engagement_assignments WHERE organisation_id='org' AND actor_id='member' AND engagement_id='engagement'").fetch_one(&mut *admin).await.unwrap();
            assert_eq!(expiry, None);
            assert_eq!(task_record(admin, &other_basis.task_id).await, other_before);
            assert_eq!(
                delegation_head(admin, &other_subject).await,
                other_delegation
            );
            assert_eq!(claim_state(admin, &other_basis.claim_id).await, "admitted");
            let consumed = tasks.consume(&other_basis).await.unwrap();
            tasks
                .observe(&consumed, Observation::Cancelled)
                .await
                .unwrap();
        } else {
            assert!(
                task_record(admin, &other_basis.task_id).await["execution_epoch"]
                    .as_u64()
                    .unwrap()
                    > other_before["execution_epoch"].as_u64().unwrap()
            );
            assert_eq!(claim_state(admin, &other_basis.claim_id).await, "abandoned");
            assert!(delegation_head(admin, &other_subject).await.revoked);
            assert!(matches!(
                tasks.consume(&other_basis).await,
                Err(TaskError::Fenced)
            ));
            let actual:Option<i64>=sqlx::query_scalar("SELECT expires_at FROM organisation_memberships WHERE organisation_id='org' AND actor_id='member'").fetch_one(&mut *admin).await.unwrap();
            assert_eq!(actual, command.expires_at);
        }
        let event_before: Value =
            sqlx::query_scalar("SELECT to_jsonb(e) FROM membership_events e WHERE command_key=$1")
                .bind(&command.key)
                .fetch_one(&mut *admin)
                .await
                .unwrap();
        assert_eq!(
            repo.save_member("admin", "org", &command).await.unwrap(),
            receipt
        );
        let event_after: Value =
            sqlx::query_scalar("SELECT to_jsonb(e) FROM membership_events e WHERE command_key=$1")
                .bind(&command.key)
                .fetch_one(&mut *admin)
                .await
                .unwrap();
        assert_eq!(event_before, event_after);
        assert_eq!(
            task_record(admin, &basis.task_id).await,
            after,
            "retry must not advance the epoch twice"
        );
    }
    admin.execute("DROP TRIGGER membership_test_expiry_gate ON organisation_memberships; DROP FUNCTION public.membership_test_expiry_gate(); UPDATE organisation_memberships SET expires_at=NULL WHERE organisation_id='org' AND actor_id='member'; UPDATE engagement_assignments SET expires_at=NULL,active=(engagement_id='engagement') WHERE organisation_id='org' AND actor_id='member'; DELETE FROM membership_events WHERE organisation_id='org' AND actor_id='admin' AND command_key LIKE 'r1-%'; UPDATE membership_versions SET version=0 WHERE organisation_id='org'").await.unwrap();
}
