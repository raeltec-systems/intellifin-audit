//! Real, disposable PostgreSQL contracts for conversational engagement setup
//! (Story 22.2 AC4): atomic establishment, rollback, authority under the lock,
//! concurrent confirmation, bounds, replay and conflict.
use sqlx::{Connection, Executor, PgConnection, PgPool, postgres::PgPoolOptions};
use std::time::Duration;
use zobba_application::{
    SchemaHealth,
    engagement_setup::{EngagementSetups, SetupError},
};
use zobba_domain::{
    SCHEMA_VERSION,
    engagement_setup::{MemberInput, SetupAuthor, SetupState, SetupView},
};
use zobba_infrastructure::{
    RuntimeDatabase, database_options,
    engagement_setup::EngagementSetupRepository,
    identity::{IdentityRepository, secret_hash},
    migrate, scope,
};
mod support;
use support::Configuration;

const ISSUER: &str = "https://setup.fixture.invalid";
const ORG: &str = "org";

async fn repository(pool: &PgPool, subject: &str) -> EngagementSetupRepository {
    let token = IdentityRepository::new(pool.clone())
        .establish_session(ISSUER, subject, subject, None)
        .await
        .unwrap();
    EngagementSetupRepository::new(pool.clone()).with_session_hash(secret_hash(&token))
}

async fn count(admin: &mut PgConnection, sql: &str) -> i64 {
    sqlx::query_scalar(sql).fetch_one(admin).await.unwrap()
}

/// Drive a setup through objective, client and period to the confirmation summary.
async fn to_confirm(
    repo: &EngagementSetupRepository,
    actor: &str,
    prefix: &str,
    objective: &str,
    client: &str,
    new_client: bool,
) -> SetupView {
    let view = repo
        .open(actor, ORG, &format!("{prefix}-open"), objective)
        .await
        .unwrap();
    let view = repo
        .message(
            actor,
            ORG,
            &view.id,
            &format!("{prefix}-client"),
            &MemberInput::Text(client.into()),
        )
        .await
        .unwrap();
    let view = if new_client {
        assert_eq!(view.facts.state, SetupState::NewClient);
        repo.message(
            actor,
            ORG,
            &view.id,
            &format!("{prefix}-accept"),
            &MemberInput::NewClient(true),
        )
        .await
        .unwrap()
    } else {
        view
    };
    assert_eq!(view.facts.state, SetupState::Period);
    let view = repo
        .message(
            actor,
            ORG,
            &view.id,
            &format!("{prefix}-period"),
            &MemberInput::Text("2026-01-01 to 2026-12-31".into()),
        )
        .await
        .unwrap();
    assert_eq!(view.facts.state, SetupState::Confirm);
    view
}

async fn blocked_on(admin: &mut PgConnection, holder: i32, expected: i64) {
    for _ in 0..200 {
        let waiting: i64 = sqlx::query_scalar("SELECT count(*) FROM pg_catalog.pg_locks WHERE NOT granted AND locktype='advisory' AND $1=ANY(pg_catalog.pg_blocking_pids(pid))")
            .bind(holder).fetch_one(&mut *admin).await.unwrap();
        if waiting >= expected {
            return;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    panic!("expected {expected} confirmations waiting on organisation lock 205");
}

#[tokio::test]
async fn postgres_engagement_setup_contract() {
    let config = Configuration::from_environment();
    let mut owner = PgConnection::connect(&config.migration).await.unwrap();
    config.guard_connection(&mut owner).await;
    owner
        .execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public; REVOKE CREATE ON SCHEMA public FROM PUBLIC")
        .await
        .unwrap();
    let options = database_options(&config.runtime).unwrap();
    let role = options.get_username().to_owned();
    migrate(&config.migration, &role).await.unwrap();
    let runtime = RuntimeDatabase::connect(&config.runtime).await.unwrap();
    assert_eq!(runtime.check().await.unwrap(), SCHEMA_VERSION);
    let mut admin = PgConnection::connect(&config.admin).await.unwrap();
    config.guard_connection(&mut admin).await;
    admin.execute(r#"
     INSERT INTO identities(id,issuer,subject,display_name) VALUES
      ('auditor','https://setup.fixture.invalid','auditor','Auditor'),
      ('manager','https://setup.fixture.invalid','manager','Manager'),
      ('admin','https://setup.fixture.invalid','admin','Admin'),
      ('revoked','https://setup.fixture.invalid','revoked','Revoked'),
      ('racer','https://setup.fixture.invalid','racer','Racer'),
      ('bounded','https://setup.fixture.invalid','bounded','Bounded'),
      ('foreign-admin','https://setup.fixture.invalid','foreign-admin','Foreign Admin');
     INSERT INTO organisations VALUES('org','Northstar'),('foreign','Meridian');
     INSERT INTO clients VALUES('org','acme-1','Acme'),('org','acme-2','ACME'),('org','alder','Alder Manufacturing'),('foreign','foreign-alder','Alder Manufacturing');
     INSERT INTO engagements(organisation_id,client_id,id,name) VALUES('org','alder','existing','Existing engagement');
     INSERT INTO organisation_memberships(organisation_id,actor_id,roles) VALUES
      ('org','auditor',ARRAY['auditor']),('org','manager',ARRAY['audit_manager','admin']),('org','admin',ARRAY['admin']),
      ('org','revoked',ARRAY['auditor']),('org','racer',ARRAY['auditor']),('org','bounded',ARRAY['auditor']),
      ('foreign','foreign-admin',ARRAY['admin']);
    "#).await.unwrap();
    // Existing engagements keep an unknown period.
    assert_eq!(
        count(
            &mut admin,
            "SELECT count(*) FROM engagements WHERE period_start IS NULL AND period_end IS NULL"
        )
        .await,
        1
    );
    // Creation is owner-mediated: the runtime role has no INSERT on authority rows.
    for table in ["clients", "engagements", "engagement_assignments"] {
        let insert: bool = sqlx::query_scalar("SELECT has_table_privilege($1,$2,'INSERT')")
            .bind(&role)
            .bind(format!("public.{table}"))
            .fetch_one(&mut admin)
            .await
            .unwrap();
        assert!(!insert, "runtime must not INSERT {table}");
    }
    let pool = PgPoolOptions::new()
        .max_connections(6)
        .connect_with(options)
        .await
        .unwrap();
    assert!(
        sqlx::query("INSERT INTO public.engagements(organisation_id,client_id,id,name) VALUES('org','alder','direct','Direct')")
            .execute(&pool).await.is_err()
    );

    // Happy path: an Auditor with zero assignments.
    let auditor = repository(&pool, "auditor").await;
    assert_eq!(
        auditor
            .organisations("auditor")
            .await
            .unwrap()
            .iter()
            .map(|o| o.id.as_str())
            .collect::<Vec<_>>(),
        ["org"]
    );
    let opened = auditor
        .open("auditor", ORG, "happy-open", "Review leaver access")
        .await
        .unwrap();
    assert_eq!(opened.facts.state, SetupState::Client);
    assert_eq!(opened.messages.len(), 2);
    assert_eq!(opened.messages[0].author, SetupAuthor::Member);
    assert_eq!(opened.messages[1].reply_to, Some(0));
    assert_eq!(opened.messages[1].prompt.as_deref(), Some("client"));
    // Replay returns the original; a changed meaning conflicts.
    assert_eq!(
        auditor
            .open("auditor", ORG, "happy-open", "Review leaver access")
            .await
            .unwrap(),
        opened
    );
    assert_eq!(
        auditor
            .open("auditor", ORG, "happy-open", "Something else")
            .await,
        Err(SetupError::Conflict)
    );
    let client = auditor
        .message(
            "auditor",
            ORG,
            &opened.id,
            "happy-client",
            &MemberInput::Text("Alder Manufacturing".into()),
        )
        .await
        .unwrap();
    assert_eq!(client.facts.state, SetupState::Period);
    assert_eq!(client.facts.client.as_ref().unwrap().id, "alder");
    assert_eq!(
        auditor
            .message(
                "auditor",
                ORG,
                &opened.id,
                "happy-client",
                &MemberInput::Text("Other".into())
            )
            .await,
        Err(SetupError::Conflict)
    );
    let refused = auditor
        .message(
            "auditor",
            ORG,
            &opened.id,
            "happy-bad-period",
            &MemberInput::Text("2026-12-31 to 2026-01-01".into()),
        )
        .await
        .unwrap();
    assert_eq!(refused.facts.state, SetupState::Period);
    assert_eq!(
        refused.messages.last().unwrap().refusal.as_deref(),
        Some("period_order")
    );
    let ready = auditor
        .message(
            "auditor",
            ORG,
            &opened.id,
            "happy-period",
            &MemberInput::Text("2026-01-01 to 2026-12-31".into()),
        )
        .await
        .unwrap();
    assert_eq!(ready.facts.state, SetupState::Confirm);
    // Nothing exists before confirmation.
    assert_eq!(
        count(&mut admin, "SELECT count(*) FROM engagements").await,
        1
    );
    let version_before = count(
        &mut admin,
        "SELECT coalesce((SELECT version FROM membership_versions WHERE organisation_id='org'),0)",
    )
    .await;
    let done = auditor
        .confirm("auditor", ORG, &opened.id, "happy-confirm")
        .await
        .unwrap();
    assert_eq!(done.facts.state, SetupState::Established);
    let established = done.established.clone().unwrap();
    assert_eq!(established.scope.client_id, "alder");
    assert_eq!(
        done.messages.last().unwrap().kind,
        "established",
        "the confirmation is answered"
    );
    let row: (String, String, String) = sqlx::query_as("SELECT to_char(period_start,'YYYY-MM-DD'),to_char(period_end,'YYYY-MM-DD'),name FROM engagements WHERE id=$1")
        .bind(&established.scope.engagement_id).fetch_one(&mut admin).await.unwrap();
    assert_eq!(
        row,
        (
            "2026-01-01".into(),
            "2026-12-31".into(),
            "Audit 2026-01-01 to 2026-12-31".into()
        )
    );
    assert_eq!(
        count(&mut admin, &format!("SELECT count(*) FROM engagement_assignments WHERE engagement_id='{}' AND actor_id='auditor'", established.scope.engagement_id)).await,
        1
    );
    assert_eq!(
        count(
            &mut admin,
            &format!(
                "SELECT count(*) FROM engagement_assignments WHERE engagement_id='{}'",
                established.scope.engagement_id
            )
        )
        .await,
        1,
        "only the creator is assigned"
    );
    let task: (String, String) = sqlx::query_as(
        "SELECT objective,accountable_actor FROM tasks WHERE id=$1 AND engagement_id=$2",
    )
    .bind(&established.receipt.task_id)
    .bind(&established.scope.engagement_id)
    .fetch_one(&mut admin)
    .await
    .unwrap();
    assert_eq!(task, ("Review leaver access".into(), "auditor".into()));
    assert_eq!(
        count(&mut admin, "SELECT coalesce((SELECT version FROM membership_versions WHERE organisation_id='org'),0)").await,
        version_before + 1
    );
    // The conversation continues in the new engagement scope.
    let mut scoped = scope::begin(&pool, "auditor", &established.scope)
        .await
        .unwrap();
    let visible: i64 = sqlx::query_scalar("SELECT count(*) FROM public.tasks")
        .fetch_one(&mut *scoped)
        .await
        .unwrap();
    assert_eq!(visible, 1);
    scoped.rollback().await.unwrap();
    // Exact retry and a second tab's confirmation return the original receipt.
    assert_eq!(
        auditor
            .confirm("auditor", ORG, &opened.id, "happy-confirm")
            .await
            .unwrap()
            .established,
        done.established
    );
    assert_eq!(
        auditor
            .confirm("auditor", ORG, &opened.id, "happy-confirm-tab")
            .await
            .unwrap()
            .established,
        done.established
    );
    assert_eq!(
        auditor
            .confirm("auditor", ORG, &opened.id, "happy-client")
            .await,
        Err(SetupError::Conflict),
        "a key reused with another meaning conflicts"
    );
    assert_eq!(
        auditor
            .message(
                "auditor",
                ORG,
                &opened.id,
                "after-close",
                &MemberInput::Text("x".into())
            )
            .await,
        Err(SetupError::Conflict)
    );
    assert_eq!(count(&mut admin, "SELECT count(*) FROM tasks").await, 1);

    // Ambiguous client: two clients fold to the same name.
    let ambiguous = auditor
        .open("auditor", ORG, "amb-open", "Test payments")
        .await
        .unwrap();
    let asked = auditor
        .message(
            "auditor",
            ORG,
            &ambiguous.id,
            "amb-client",
            &MemberInput::Text("acme".into()),
        )
        .await
        .unwrap();
    assert_eq!(asked.facts.state, SetupState::ClientChoice);
    assert_eq!(
        asked
            .facts
            .candidates
            .iter()
            .map(|c| c.id.as_str())
            .collect::<Vec<_>>(),
        ["acme-1", "acme-2"]
    );
    assert_eq!(asked.messages.last().unwrap().candidates.len(), 2);
    let outside = auditor
        .message(
            "auditor",
            ORG,
            &ambiguous.id,
            "amb-outside",
            &MemberInput::ChooseClient("alder".into()),
        )
        .await
        .unwrap();
    assert_eq!(outside.facts.state, SetupState::ClientChoice);
    assert_eq!(
        outside.messages.last().unwrap().refusal.as_deref(),
        Some("not_a_candidate")
    );
    let chosen = auditor
        .message(
            "auditor",
            ORG,
            &ambiguous.id,
            "amb-choose",
            &MemberInput::ChooseClient("acme-2".into()),
        )
        .await
        .unwrap();
    assert_eq!(chosen.facts.client.unwrap().name, "ACME");
    // A foreign organisation's client never resolves.
    assert_eq!(count(&mut admin, "SELECT count(*) FROM clients").await, 4);

    // New client: proposed, declined (stays open), then explicitly accepted.
    let fresh = auditor
        .open("auditor", ORG, "new-open", "Assess vendor onboarding")
        .await
        .unwrap();
    let proposed = auditor
        .message(
            "auditor",
            ORG,
            &fresh.id,
            "new-client",
            &MemberInput::Text("Birch Holdings".into()),
        )
        .await
        .unwrap();
    assert_eq!(proposed.facts.state, SetupState::NewClient);
    let declined = auditor
        .message(
            "auditor",
            ORG,
            &fresh.id,
            "new-decline",
            &MemberInput::NewClient(false),
        )
        .await
        .unwrap();
    assert_eq!(declined.facts.state, SetupState::Client);
    assert_eq!(
        count(
            &mut admin,
            "SELECT count(*) FROM clients WHERE name='Birch Holdings'"
        )
        .await,
        0
    );
    auditor
        .message(
            "auditor",
            ORG,
            &fresh.id,
            "new-client-2",
            &MemberInput::Text("Birch Holdings".into()),
        )
        .await
        .unwrap();
    auditor
        .message(
            "auditor",
            ORG,
            &fresh.id,
            "new-accept",
            &MemberInput::NewClient(true),
        )
        .await
        .unwrap();
    auditor
        .message(
            "auditor",
            ORG,
            &fresh.id,
            "new-period",
            &MemberInput::Text("2026-04-01/2027-03-31".into()),
        )
        .await
        .unwrap();
    let created = auditor
        .confirm("auditor", ORG, &fresh.id, "new-confirm")
        .await
        .unwrap();
    let created = created.established.unwrap();
    let name: String = sqlx::query_scalar("SELECT name FROM clients WHERE id=$1")
        .bind(&created.scope.client_id)
        .fetch_one(&mut admin)
        .await
        .unwrap();
    assert_eq!(name, "Birch Holdings");

    // Unauthorised: Admin alone is not audit authority.
    let only_admin = repository(&pool, "admin").await;
    assert!(only_admin.organisations("admin").await.unwrap().is_empty());
    assert_eq!(
        only_admin
            .open("admin", ORG, "admin-open", "Anything")
            .await,
        Err(SetupError::Denied)
    );
    assert_eq!(
        auditor.get("auditor", "foreign", &opened.id).await,
        Err(SetupError::Denied)
    );
    assert_eq!(
        repository(&pool, "manager")
            .await
            .get("manager", ORG, &opened.id)
            .await,
        Err(SetupError::Denied),
        "a setup is visible only to its own actor"
    );

    // Revocation decided under organisation lock 205.
    let revoked = repository(&pool, "revoked").await;
    let pending = to_confirm(
        &revoked,
        "revoked",
        "rev",
        "Revoked objective",
        "Alder Manufacturing",
        false,
    )
    .await;
    let engagements_before = count(&mut admin, "SELECT count(*) FROM engagements").await;
    let mut holder = PgConnection::connect(&config.admin).await.unwrap();
    let holder_pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut holder)
        .await
        .unwrap();
    holder
        .execute("BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('org',205))")
        .await
        .unwrap();
    let confirm = tokio::spawn({
        let revoked = revoked.clone();
        let id = pending.id.clone();
        async move { revoked.confirm("revoked", ORG, &id, "rev-confirm").await }
    });
    blocked_on(&mut admin, holder_pid, 1).await;
    holder
        .execute("UPDATE organisation_memberships SET active=false WHERE organisation_id='org' AND actor_id='revoked'; COMMIT")
        .await
        .unwrap();
    assert_eq!(confirm.await.unwrap(), Err(SetupError::Denied));
    assert_eq!(
        count(&mut admin, "SELECT count(*) FROM engagements").await,
        engagements_before
    );
    assert_eq!(
        count(
            &mut admin,
            &format!(
                "SELECT count(*) FROM engagement_setups WHERE id='{}' AND state='confirm'",
                pending.id
            )
        )
        .await,
        1
    );
    assert_eq!(
        revoked.get("revoked", ORG, &pending.id).await,
        Err(SetupError::Denied)
    );

    // Concurrent confirms from two tabs: exactly one engagement.
    let racer = repository(&pool, "racer").await;
    let race = to_confirm(
        &racer,
        "racer",
        "race",
        "Race objective",
        "Alder Manufacturing",
        false,
    )
    .await;
    let tasks_before = count(&mut admin, "SELECT count(*) FROM tasks").await;
    holder
        .execute("BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('org',205))")
        .await
        .unwrap();
    let first = tokio::spawn({
        let racer = racer.clone();
        let id = race.id.clone();
        async move { racer.confirm("racer", ORG, &id, "race-tab-1").await }
    });
    let second = tokio::spawn({
        let racer = racer.clone();
        let id = race.id.clone();
        async move { racer.confirm("racer", ORG, &id, "race-tab-2").await }
    });
    blocked_on(&mut admin, holder_pid, 2).await;
    holder.execute("COMMIT").await.unwrap();
    let first = first.await.unwrap().unwrap().established.unwrap();
    let second = second.await.unwrap().unwrap().established.unwrap();
    assert_eq!(first, second, "the loser receives the original receipt");
    assert_eq!(
        count(
            &mut admin,
            "SELECT count(*) FROM engagement_assignments WHERE actor_id='racer'"
        )
        .await,
        1
    );
    assert_eq!(
        count(&mut admin, "SELECT count(*) FROM tasks").await,
        tasks_before + 1
    );

    // A Task failure rolls back the client, engagement and assignment.
    let manager = repository(&pool, "manager").await;
    let failing = to_confirm(
        &manager,
        "manager",
        "fail",
        "Trigger task failure",
        "Cedar Partners",
        true,
    )
    .await;
    admin.execute(r#"
     CREATE FUNCTION public.setup_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.objective='Trigger task failure' THEN RAISE EXCEPTION 'injected'; END IF; RETURN NEW; END$$;
     CREATE TRIGGER setup_test_fail BEFORE INSERT ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.setup_test_fail();
    "#).await.unwrap();
    let before = (
        count(&mut admin, "SELECT count(*) FROM clients").await,
        count(&mut admin, "SELECT count(*) FROM engagements").await,
        count(&mut admin, "SELECT count(*) FROM engagement_assignments").await,
        count(&mut admin, "SELECT count(*) FROM tasks").await,
    );
    assert_eq!(
        manager
            .confirm("manager", ORG, &failing.id, "fail-confirm")
            .await,
        Err(SetupError::Unavailable)
    );
    assert_eq!(
        (
            count(&mut admin, "SELECT count(*) FROM clients").await,
            count(&mut admin, "SELECT count(*) FROM engagements").await,
            count(&mut admin, "SELECT count(*) FROM engagement_assignments").await,
            count(&mut admin, "SELECT count(*) FROM tasks").await,
        ),
        before
    );
    assert_eq!(
        manager
            .get("manager", ORG, &failing.id)
            .await
            .unwrap()
            .facts
            .state,
        SetupState::Confirm
    );
    admin
        .execute(
            "DROP TRIGGER setup_test_fail ON public.tasks; DROP FUNCTION public.setup_test_fail()",
        )
        .await
        .unwrap();
    // The durable confirmation is retried with its own key.
    let recovered = manager
        .confirm("manager", ORG, &failing.id, "fail-confirm")
        .await
        .unwrap();
    assert_eq!(recovered.facts.state, SetupState::Established);
    assert_eq!(
        count(
            &mut admin,
            "SELECT count(*) FROM clients WHERE name='Cedar Partners'"
        )
        .await,
        1
    );

    // Bounds: eight open setups, twenty engagements per UTC day.
    let bounded = repository(&pool, "bounded").await;
    let mut open = Vec::new();
    for index in 0..8 {
        open.push(
            bounded
                .open(
                    "bounded",
                    ORG,
                    &format!("bound-{index}"),
                    "Bounded objective",
                )
                .await
                .unwrap(),
        );
    }
    assert_eq!(
        bounded
            .open("bounded", ORG, "bound-8", "Bounded objective")
            .await,
        Err(SetupError::OpenLimit)
    );
    assert_eq!(bounded.open_setups("bounded", ORG).await.unwrap().len(), 8);
    let cancelled = bounded
        .message(
            "bounded",
            ORG,
            &open[0].id,
            "bound-cancel",
            &MemberInput::Cancel,
        )
        .await
        .unwrap();
    assert_eq!(cancelled.facts.state, SetupState::Cancelled);
    let daily = to_confirm(
        &bounded,
        "bounded",
        "daily",
        "Daily objective",
        "Alder Manufacturing",
        false,
    )
    .await;
    admin.execute(r#"
     INSERT INTO engagement_setups(organisation_id,id,actor_id,idempotency_key,objective,state,resolved_client_id,resolved_client_name,period_start,period_end,client_id,engagement_id,task_id,cycle_id,receipt,established_at)
     SELECT 'org','prior-'||n,'bounded','prior-'||n,'Prior','established','alder','Alder Manufacturing','2026-01-01','2026-12-31','alder','existing','task','cycle','{}'::jsonb,floor(extract(epoch FROM clock_timestamp()))::bigint FROM generate_series(1,20) n;
    "#).await.unwrap();
    let engagements_before = count(&mut admin, "SELECT count(*) FROM engagements").await;
    assert_eq!(
        bounded
            .confirm("bounded", ORG, &daily.id, "daily-confirm")
            .await,
        Err(SetupError::DailyLimit)
    );
    assert_eq!(
        count(&mut admin, "SELECT count(*) FROM engagements").await,
        engagements_before
    );
    // A previous UTC day does not count.
    admin
        .execute("UPDATE engagement_setups SET established_at=established_at-86400 WHERE id LIKE 'prior-%'")
        .await
        .unwrap();
    assert_eq!(
        bounded
            .confirm("bounded", ORG, &daily.id, "daily-confirm")
            .await
            .unwrap()
            .facts
            .state,
        SetupState::Established
    );
    // Every member message precedes its single Zobba reply.
    assert_eq!(
        count(&mut admin, "SELECT count(*) FROM engagement_setup_messages r JOIN engagement_setup_messages m ON m.setup_id=r.setup_id AND m.ordinal=r.reply_to WHERE r.ordinal<=m.ordinal OR m.author<>'member'").await,
        0
    );
    pool.close().await;
}
