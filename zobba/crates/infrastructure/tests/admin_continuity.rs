//! Real PostgreSQL continuity contracts. One test owns a guarded disposable schema.
use serde_json::Value;
use sqlx::{Connection, Executor, PgConnection};
use std::time::Duration;
use zobba_infrastructure::{database_options, migrate};

mod support;
use support::Configuration;

const ISSUER: &str = "https://admin-continuity.fixture.invalid";

async fn connect(config: &Configuration) -> PgConnection {
    let mut connection = PgConnection::connect(&config.migration).await.unwrap();
    config.guard_connection(&mut connection).await;
    connection
        .execute("SET default_transaction_isolation='read committed'; SET statement_timeout='12s'; SET idle_in_transaction_session_timeout='20s'")
        .await
        .unwrap();
    connection
}

async fn pid(connection: &mut PgConnection) -> i32 {
    sqlx::query_scalar("SELECT pg_catalog.pg_backend_pid()")
        .fetch_one(connection)
        .await
        .unwrap()
}

// Include COMMIT: continuity is deliberately deferred so an atomic replacement
// can temporarily remove the last qualifying membership inside its transaction.
async fn finish(connection: &mut PgConnection, sql: &str) -> Result<(), sqlx::Error> {
    let result = match connection.execute(sql).await {
        Ok(_) => connection.execute("COMMIT").await.map(|_| ()),
        Err(error) => Err(error),
    };
    if result.is_err() {
        connection.execute("ROLLBACK").await.unwrap();
    }
    result
}

async fn apply(connection: &mut PgConnection, sql: &str) -> Result<(), sqlx::Error> {
    connection.execute("BEGIN").await.unwrap();
    finish(connection, sql).await
}

fn assert_code(result: Result<(), sqlx::Error>, accepted: &[&str]) {
    let error = result.expect_err("unsafe authority change unexpectedly committed");
    let code = error
        .as_database_error()
        .and_then(|error| error.code())
        .expect("refusal must have a stable database SQLSTATE");
    assert!(
        accepted.contains(&code.as_ref()),
        "unexpected refusal: {error}"
    );
}

async fn snapshot(connection: &mut PgConnection) -> Value {
    sqlx::query_scalar(
        "SELECT jsonb_build_object(
          'organisations',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM organisations o),
          'identities',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM identities i),
          'memberships',(SELECT jsonb_agg(to_jsonb(m) ORDER BY organisation_id,actor_id) FROM organisation_memberships m),
          'versions',(SELECT jsonb_agg(to_jsonb(v) ORDER BY organisation_id) FROM membership_versions v),
          'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM membership_events e),
          'invitations',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM membership_invitations i))",
    )
    .fetch_one(connection)
    .await
    .unwrap()
}

async fn invariant(connection: &mut PgConnection) {
    let orphaned: Vec<String> = sqlx::query_scalar(
        "SELECT o.id FROM organisations o WHERE NOT EXISTS (
          SELECT 1 FROM organisation_memberships m JOIN identities i ON i.id=m.actor_id
          WHERE m.organisation_id=o.id AND m.active AND m.expires_at IS NULL
            AND 'admin'=ANY(m.roles) AND i.active) ORDER BY o.id",
    )
    .fetch_all(connection)
    .await
    .unwrap();
    assert!(
        orphaned.is_empty(),
        "organisations lost continuity: {orphaned:?}"
    );
}

async fn qualifies(connection: &mut PgConnection, org: &str, actor: &str) -> bool {
    sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM organisation_memberships m JOIN identities i ON i.id=m.actor_id
         WHERE m.organisation_id=$1 AND m.actor_id=$2 AND m.active AND m.expires_at IS NULL
           AND 'admin'=ANY(m.roles) AND i.active)",
    )
    .bind(org)
    .bind(actor)
    .fetch_one(connection)
    .await
    .unwrap()
}

// Both identities exist, but callers choose whether the second is a member.
async fn provision(connection: &mut PgConnection, org: &str, two_admins: bool) {
    let mut tx = connection.begin().await.unwrap();
    for suffix in ["a", "b"] {
        let actor = format!("{org}-{suffix}");
        sqlx::query("INSERT INTO identities(id,issuer,subject,display_name) VALUES($1,$2,$1,'Synthetic Admin')")
            .bind(&actor).bind(ISSUER).execute(&mut *tx).await.unwrap();
    }
    sqlx::query("INSERT INTO organisations(id,name) VALUES($1,'Synthetic organisation')")
        .bind(org)
        .execute(&mut *tx)
        .await
        .unwrap();
    for suffix in if two_admins {
        &["a", "b"][..]
    } else {
        &["a"][..]
    } {
        sqlx::query("INSERT INTO organisation_memberships(organisation_id,actor_id,roles) VALUES($1,$2,ARRAY['admin'])")
            .bind(org).bind(format!("{org}-{suffix}")).execute(&mut *tx).await.unwrap();
    }
    tx.commit().await.unwrap();
}

async fn refused_unchanged(connection: &mut PgConnection, sql: &str, codes: &[&str]) {
    let before = snapshot(connection).await;
    assert_code(apply(connection, sql).await, codes);
    assert_eq!(
        snapshot(connection).await,
        before,
        "refusal changed durable data: {sql}"
    );
    invariant(connection).await;
}

async fn wait_for_block(observer: &mut PgConnection, waiting: i32, blocking: i32) {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let blocked: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_stat_activity a
                 WHERE a.pid=$1 AND a.datname=current_database() AND a.state='active'
                   AND a.wait_event_type='Lock' AND $2=ANY(pg_catalog.pg_blocking_pids(a.pid)))",
            )
            .bind(waiting)
            .bind(blocking)
            .fetch_one(&mut *observer)
            .await
            .unwrap();
            if blocked {
                break;
            }
            // A short polling interval bounds observer load. Only the observed
            // PostgreSQL lock, never elapsed time, releases the test barrier.
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap_or_else(|_| panic!("backend {waiting} never waited on backend {blocking}"));
}

async fn direct_sql_matrix(owner: &mut PgConnection) {
    provision(owner, "matrix", false).await;
    provision(owner, "destination", false).await;
    apply(owner, r#"
        INSERT INTO identities(id,issuer,subject,display_name,active) VALUES
          ('temporary','https://admin-continuity.fixture.invalid','temporary','Temporary',true),
          ('expired','https://admin-continuity.fixture.invalid','expired','Expired',true),
          ('inactive-member','https://admin-continuity.fixture.invalid','inactive-member','Inactive membership',true),
          ('inactive-identity','https://admin-continuity.fixture.invalid','inactive-identity','Inactive identity',false),
          ('unused-inactive','https://admin-continuity.fixture.invalid','unused-inactive','Inactive replacement',false),
          ('auditor','https://admin-continuity.fixture.invalid','auditor','Auditor',true);
        INSERT INTO organisation_memberships(organisation_id,actor_id,roles,active,expires_at) VALUES
          ('matrix','temporary',ARRAY['admin'],true,extract(epoch FROM clock_timestamp())::bigint+3600),
          ('matrix','expired',ARRAY['admin'],true,1),
          ('matrix','inactive-member',ARRAY['admin'],false,NULL),
          ('matrix','inactive-identity',ARRAY['admin'],true,NULL),
          ('matrix','auditor',ARRAY['auditor','audit_manager'],true,NULL);
        INSERT INTO membership_versions VALUES('matrix',7);
        INSERT INTO membership_events(id,organisation_id,actor_id,command_key,meaning,receipt)
          VALUES('matrix-history','matrix','matrix-a','prior-save','{}','{"version":"7"}');
        INSERT INTO membership_invitations(id,organisation_id,recipient_issuer,recipient_email,secret_hash,roles,assignments,inviter_actor_id,expires_at,status)
          VALUES('pending-admin','matrix','https://admin-continuity.fixture.invalid','pending@example.com',repeat('a',64),ARRAY['admin'],'[]','matrix-a',extract(epoch FROM clock_timestamp())::bigint+3600,'pending');
    "#).await.unwrap();
    for sql in [
        "DELETE FROM organisation_memberships WHERE organisation_id='matrix' AND actor_id='matrix-a'",
        "UPDATE organisation_memberships SET active=false WHERE organisation_id='matrix' AND actor_id='matrix-a'",
        "UPDATE organisation_memberships SET roles=ARRAY['auditor','audit_manager'] WHERE organisation_id='matrix' AND actor_id='matrix-a'",
        "UPDATE organisation_memberships SET expires_at=extract(epoch FROM clock_timestamp())::bigint+3600 WHERE organisation_id='matrix' AND actor_id='matrix-a'",
        "UPDATE organisation_memberships SET expires_at=1 WHERE organisation_id='matrix' AND actor_id='matrix-a'",
        "UPDATE organisation_memberships SET actor_id='unused-inactive' WHERE organisation_id='matrix' AND actor_id='matrix-a'",
        "UPDATE organisation_memberships SET organisation_id='destination' WHERE organisation_id='matrix' AND actor_id='matrix-a'",
        "UPDATE identities SET active=false WHERE id='matrix-a'",
    ] {
        refused_unchanged(owner, sql, &["Z0004"]).await;
    }
    // Rejected multi-statement work also rolls back a version and receipt that
    // were written before the deferred continuity error is raised at COMMIT.
    refused_unchanged(owner,
        "UPDATE membership_versions SET version=8 WHERE organisation_id='matrix';
         INSERT INTO membership_events(id,organisation_id,actor_id,command_key,meaning,receipt)
           VALUES('rejected-history','matrix','matrix-a','rejected-save','{}','{}');
         UPDATE organisation_memberships SET active=false WHERE organisation_id='matrix' AND actor_id='matrix-a'",
        &["Z0004"]).await;
    for sql in [
        "TRUNCATE organisation_memberships CASCADE",
        "TRUNCATE identities CASCADE",
        "TRUNCATE organisations CASCADE",
    ] {
        refused_unchanged(owner, sql, &["0A000"]).await;
    }
    // Ordinary unchanged edits and additional temporary Admins remain valid.
    apply(owner, "UPDATE organisation_memberships SET roles=ARRAY['admin','auditor'] WHERE organisation_id='matrix' AND actor_id='matrix-a';
        UPDATE organisation_memberships SET expires_at=extract(epoch FROM clock_timestamp())::bigint+7200 WHERE organisation_id='matrix' AND actor_id='temporary'").await.unwrap();
    assert!(qualifies(owner, "matrix", "matrix-a").await);
    assert!(!qualifies(owner, "matrix", "temporary").await);
}

async fn provisioning_and_replacement(owner: &mut PgConnection) {
    refused_unchanged(
        owner,
        "INSERT INTO organisations(id,name) VALUES('ownerless','Ownerless')",
        &["Z0004"],
    )
    .await;
    refused_unchanged(owner, "INSERT INTO organisations(id,name) VALUES('invalid-provision','Invalid provision');
        INSERT INTO organisation_memberships(organisation_id,actor_id,roles) VALUES('invalid-provision','inactive-identity',ARRAY['admin'])", &["Z0004"]).await;
    provision(owner, "replacement", false).await;
    apply(owner, "DELETE FROM organisation_memberships WHERE organisation_id='replacement' AND actor_id='replacement-a';
        INSERT INTO organisation_memberships(organisation_id,actor_id,roles) VALUES('replacement','replacement-b',ARRAY['admin']);
        UPDATE identities SET active=false WHERE id='replacement-a'").await.unwrap();
    assert!(qualifies(owner, "replacement", "replacement-b").await);
    assert!(!qualifies(owner, "replacement", "replacement-a").await);
    provision(owner, "retired", false).await;
    apply(owner, "DELETE FROM organisation_memberships WHERE organisation_id='retired'; DELETE FROM organisations WHERE id='retired'").await.unwrap();
    let retired: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM organisations WHERE id='retired')")
            .fetch_one(&mut *owner)
            .await
            .unwrap();
    assert!(
        !retired,
        "complete transactional organisation retirement was refused"
    );
    invariant(owner).await;
}

async fn identity_lifecycle(owner: &mut PgConnection) {
    provision(owner, "multi-a", true).await;
    apply(owner, "INSERT INTO organisations(id,name) VALUES('multi-b','Second organisation');
        INSERT INTO organisation_memberships(organisation_id,actor_id,roles) VALUES('multi-b','multi-a-a',ARRAY['admin'])").await.unwrap();
    let before = snapshot(owner).await;
    let error = apply(
        owner,
        "UPDATE identities SET active=false WHERE id='multi-a-a'",
    )
    .await
    .expect_err("deactivation must refuse the organisation without a replacement");
    assert_eq!(
        error
            .as_database_error()
            .unwrap()
            .downcast_ref::<sqlx::postgres::PgDatabaseError>()
            .detail(),
        Some("Organisation: multi-b"),
        "owner diagnostics must identify the blocked organisation, not a safe peer"
    );
    assert_code(Err(error), &["Z0004"]);
    assert_eq!(snapshot(owner).await, before);
    apply(owner, "INSERT INTO organisation_memberships(organisation_id,actor_id,roles) VALUES('multi-b','multi-a-b',ARRAY['admin']);
        UPDATE identities SET active=false WHERE id='multi-a-a'").await.unwrap();
    assert!(qualifies(owner, "multi-a", "multi-a-b").await);
    assert!(qualifies(owner, "multi-b", "multi-a-b").await);

    // A last Admin is protected even if the existing immediate FK refuses the
    // identity removal before the deferred continuity trigger runs.
    refused_unchanged(
        owner,
        "DELETE FROM identities WHERE id='matrix-a'",
        &["23503", "Z0004"],
    )
    .await;
    apply(owner, "INSERT INTO organisation_memberships(organisation_id,actor_id,roles) VALUES('matrix','matrix-b',ARRAY['admin']);
        DELETE FROM organisation_memberships WHERE organisation_id='matrix' AND actor_id='matrix-a'").await.unwrap();
    // Authorship and invitations still reference this former Admin; there must
    // be no cascading history deletion even after replacement and removal.
    refused_unchanged(
        owner,
        "DELETE FROM identities WHERE id='matrix-a'",
        &["23503"],
    )
    .await;
    apply(owner, "DELETE FROM identities WHERE id='unused-inactive'")
        .await
        .unwrap();
    let remains: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM identities WHERE id='unused-inactive')")
            .fetch_one(&mut *owner)
            .await
            .unwrap();
    assert!(
        !remains,
        "harmless unreferenced identity deletion was refused"
    );
    invariant(owner).await;
}

#[derive(Clone, Copy)]
enum Narrowing {
    Expire,
    Deactivate,
}

impl Narrowing {
    fn sql(self, org: &str, actor: &str) -> String {
        match self {
            Self::Expire => format!(
                "UPDATE organisation_memberships SET expires_at=extract(epoch FROM clock_timestamp())::bigint+3600 WHERE organisation_id='{org}' AND actor_id='{actor}'"
            ),
            Self::Deactivate => format!("UPDATE identities SET active=false WHERE id='{actor}'"),
        }
    }
}

async fn competing_narrowings(
    config: &Configuration,
    owner: &mut PgConnection,
    observer: &mut PgConnection,
) {
    for (index, (first_change, second_change)) in [
        (Narrowing::Expire, Narrowing::Expire),
        (Narrowing::Deactivate, Narrowing::Deactivate),
        (Narrowing::Expire, Narrowing::Deactivate),
        (Narrowing::Deactivate, Narrowing::Expire),
    ]
    .into_iter()
    .enumerate()
    {
        let org = format!("narrowing-{index}");
        provision(owner, &org, true).await;
        let mut first = connect(config).await;
        let mut second = connect(config).await;
        let first_pid = pid(&mut first).await;
        let second_pid = pid(&mut second).await;
        first.execute("BEGIN").await.unwrap();
        first
            .execute(first_change.sql(&org, &format!("{org}-a")).as_str())
            .await
            .unwrap();
        second.execute("BEGIN").await.unwrap();
        let sql = second_change.sql(&org, &format!("{org}-b"));
        let waiting = tokio::spawn(async move { finish(&mut second, &sql).await });
        wait_for_block(observer, second_pid, first_pid).await;
        first.execute("COMMIT").await.unwrap();
        assert_code(waiting.await.unwrap(), &["Z0004"]);
        assert!(!qualifies(owner, &org, &format!("{org}-a")).await);
        assert!(qualifies(owner, &org, &format!("{org}-b")).await);
        invariant(owner).await;
    }
}

async fn insertion_identity_races(
    config: &Configuration,
    owner: &mut PgConnection,
    observer: &mut PgConnection,
) {
    for deleting in [false, true] {
        for insertion_first in [false, true] {
            let org = format!(
                "insert-{}-{}",
                u8::from(deleting),
                u8::from(insertion_first)
            );
            provision(owner, &org, false).await;
            let mut insertion = connect(config).await;
            let mut lifecycle = connect(config).await;
            let insertion_pid = pid(&mut insertion).await;
            let lifecycle_pid = pid(&mut lifecycle).await;
            let insert_sql = format!("INSERT INTO organisation_memberships(organisation_id,actor_id,roles) VALUES('{org}','{org}-b',ARRAY['admin']);
                UPDATE organisation_memberships SET expires_at=extract(epoch FROM clock_timestamp())::bigint+3600 WHERE organisation_id='{org}' AND actor_id='{org}-a'");
            let lifecycle_sql = if deleting {
                format!("DELETE FROM identities WHERE id='{org}-b'")
            } else {
                format!("UPDATE identities SET active=false WHERE id='{org}-b'")
            };
            insertion.execute("BEGIN").await.unwrap();
            lifecycle.execute("BEGIN").await.unwrap();
            if insertion_first {
                insertion.execute(insert_sql.as_str()).await.unwrap();
                let waiting =
                    tokio::spawn(async move { finish(&mut lifecycle, &lifecycle_sql).await });
                // An uncommitted qualifying membership must lock its identity;
                // the lifecycle query cannot see that membership at its start.
                wait_for_block(observer, lifecycle_pid, insertion_pid).await;
                insertion.execute("COMMIT").await.unwrap();
                let codes = if deleting {
                    &["23503", "Z0004"][..]
                } else {
                    &["Z0004"][..]
                };
                assert_code(waiting.await.unwrap(), codes);
                assert!(qualifies(owner, &org, &format!("{org}-b")).await);
                assert!(!qualifies(owner, &org, &format!("{org}-a")).await);
            } else {
                lifecycle.execute(lifecycle_sql.as_str()).await.unwrap();
                let waiting =
                    tokio::spawn(async move { finish(&mut insertion, &insert_sql).await });
                wait_for_block(observer, insertion_pid, lifecycle_pid).await;
                lifecycle.execute("COMMIT").await.unwrap();
                let codes = if deleting {
                    &["23503", "Z0004"][..]
                } else {
                    &["Z0004"][..]
                };
                assert_code(waiting.await.unwrap(), codes);
                assert!(qualifies(owner, &org, &format!("{org}-a")).await);
                assert!(!qualifies(owner, &org, &format!("{org}-b")).await);
            }
            invariant(owner).await;
        }
    }
}

async fn qualifying_update_identity_races(
    config: &Configuration,
    owner: &mut PgConnection,
    observer: &mut PgConnection,
) {
    for (change, initial_values, qualifying_update) in [
        (
            "promotion",
            "ARRAY['auditor'],true,NULL",
            "roles=ARRAY['admin']",
        ),
        ("reactivation", "ARRAY['admin'],false,NULL", "active=true"),
        (
            "expiry-removal",
            "ARRAY['admin'],true,4102444800",
            "expires_at=NULL",
        ),
    ] {
        for replacement_first in [false, true] {
            let org = format!("update-{change}-{}", u8::from(replacement_first));
            provision(owner, &org, false).await;
            apply(owner, &format!(r#"
                INSERT INTO organisation_memberships(organisation_id,actor_id,roles,active,expires_at)
                  VALUES('{org}','{org}-b',{initial_values});
                INSERT INTO membership_versions VALUES('{org}',7);
                INSERT INTO membership_events(id,organisation_id,actor_id,command_key,meaning,receipt)
                  VALUES('{org}-prior','{org}','{org}-a','prior-save','{{}}','{{"version":"7"}}');
            "#)).await.unwrap();
            assert!(qualifies(owner, &org, &format!("{org}-a")).await);
            assert!(!qualifies(owner, &org, &format!("{org}-b")).await);

            let mut replacement = connect(config).await;
            let mut lifecycle = connect(config).await;
            let replacement_pid = pid(&mut replacement).await;
            let lifecycle_pid = pid(&mut lifecycle).await;
            let replacement_sql = format!(
                r#"
                UPDATE organisation_memberships SET {qualifying_update}
                  WHERE organisation_id='{org}' AND actor_id='{org}-b';
                UPDATE organisation_memberships SET expires_at=4102444800
                  WHERE organisation_id='{org}' AND actor_id='{org}-a';
                UPDATE membership_versions SET version=8 WHERE organisation_id='{org}';
                INSERT INTO membership_events(id,organisation_id,actor_id,command_key,meaning,receipt)
                  VALUES('{org}-replacement','{org}','{org}-a','replacement-save','{{}}','{{"version":"8"}}');
            "#
            );
            let lifecycle_sql = format!("UPDATE identities SET active=false WHERE id='{org}-b'");
            replacement.execute("BEGIN").await.unwrap();
            lifecycle.execute("BEGIN").await.unwrap();
            let expected = if replacement_first {
                replacement.execute(replacement_sql.as_str()).await.unwrap();
                let expected = snapshot(&mut replacement).await;
                let waiting =
                    tokio::spawn(async move { finish(&mut lifecycle, &lifecycle_sql).await });
                // Each UPDATE makes the existing membership newly qualifying.
                // Its identity FOR SHARE must fence active-only owner updates.
                wait_for_block(observer, lifecycle_pid, replacement_pid).await;
                replacement.execute("COMMIT").await.unwrap();
                assert_code(waiting.await.unwrap(), &["Z0004"]);
                expected
            } else {
                lifecycle.execute(lifecycle_sql.as_str()).await.unwrap();
                let expected = snapshot(&mut lifecycle).await;
                let waiting =
                    tokio::spawn(async move { finish(&mut replacement, &replacement_sql).await });
                wait_for_block(observer, replacement_pid, lifecycle_pid).await;
                lifecycle.execute("COMMIT").await.unwrap();
                assert_code(waiting.await.unwrap(), &["Z0004"]);
                expected
            };
            assert_eq!(
                snapshot(owner).await,
                expected,
                "the refused {change} race changed durable authority, versions or receipts"
            );
            assert_eq!(
                qualifies(owner, &org, &format!("{org}-a")).await,
                !replacement_first
            );
            assert_eq!(
                qualifies(owner, &org, &format!("{org}-b")).await,
                replacement_first
            );
            invariant(owner).await;
        }
    }
}

async fn multi_org_phantom_races(
    config: &Configuration,
    owner: &mut PgConnection,
    observer: &mut PgConnection,
) {
    for insertion_first in [false, true] {
        let prefix = format!("phantom-{}", u8::from(insertion_first));
        let first_org = format!("{prefix}-first");
        let second_org = format!("{prefix}-second");
        let new_org = format!("{prefix}-new");
        for org in [&first_org, &second_org, &new_org] {
            provision(owner, org, false).await;
        }
        let shared = format!("{first_org}-b");
        apply(owner, &format!("INSERT INTO organisation_memberships(organisation_id,actor_id,roles)
            VALUES('{first_org}','{shared}',ARRAY['admin']),('{second_org}','{shared}',ARRAY['admin'])")).await.unwrap();
        let mut lifecycle = connect(config).await;
        let mut insertion = connect(config).await;
        let lifecycle_pid = pid(&mut lifecycle).await;
        let insertion_pid = pid(&mut insertion).await;
        lifecycle.execute("BEGIN").await.unwrap();
        insertion.execute("BEGIN").await.unwrap();
        let insert_sql = format!("INSERT INTO organisation_memberships(organisation_id,actor_id,roles)
            VALUES('{new_org}','{shared}',ARRAY['admin']);
            UPDATE organisation_memberships SET expires_at=extract(epoch FROM clock_timestamp())::bigint+3600
            WHERE organisation_id='{new_org}' AND actor_id='{new_org}-a'");
        let deactivate_sql = format!("UPDATE identities SET active=false WHERE id='{shared}'");
        if insertion_first {
            insertion.execute(insert_sql.as_str()).await.unwrap();
            let waiting =
                tokio::spawn(async move { finish(&mut lifecycle, &deactivate_sql).await });
            wait_for_block(observer, lifecycle_pid, insertion_pid).await;
            insertion.execute("COMMIT").await.unwrap();
            assert_code(waiting.await.unwrap(), &["Z0004"]);
            assert!(qualifies(owner, &new_org, &shared).await);
            assert!(!qualifies(owner, &new_org, &format!("{new_org}-a")).await);
        } else {
            let mut barrier = connect(config).await;
            let barrier_pid = pid(&mut barrier).await;
            barrier.execute("BEGIN").await.unwrap();
            sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,205))")
                .bind(&first_org)
                .execute(&mut barrier)
                .await
                .unwrap();
            let deactivation =
                tokio::spawn(async move { finish(&mut lifecycle, &deactivate_sql).await });
            // The identity trigger has already enumerated its two existing
            // organisations and holds the identity row while waiting here.
            wait_for_block(observer, lifecycle_pid, barrier_pid).await;
            let addition = tokio::spawn(async move { finish(&mut insertion, &insert_sql).await });
            // A third organisation was absent from that enumeration. Its
            // qualifying membership must still serialize on the identity row.
            wait_for_block(observer, insertion_pid, lifecycle_pid).await;
            barrier.execute("COMMIT").await.unwrap();
            deactivation.await.unwrap().unwrap();
            assert_code(addition.await.unwrap(), &["Z0004"]);
            assert!(!qualifies(owner, &new_org, &shared).await);
            assert!(qualifies(owner, &new_org, &format!("{new_org}-a")).await);
        }
        assert!(qualifies(owner, &first_org, &format!("{first_org}-a")).await);
        assert!(qualifies(owner, &second_org, &format!("{second_org}-a")).await);
        invariant(owner).await;
    }
}

async fn lock_inversion_aborts_safely(
    config: &Configuration,
    owner: &mut PgConnection,
    observer: &mut PgConnection,
) {
    provision(owner, "inversion", true).await;
    apply(
        owner,
        r#"
        INSERT INTO membership_versions VALUES('inversion',7);
        INSERT INTO membership_events(id,organisation_id,actor_id,command_key,meaning,receipt)
          VALUES('inversion-prior','inversion','inversion-a','prior-save','{}','{"version":"7"}');
    "#,
    )
    .await
    .unwrap();
    let mut membership = connect(config).await;
    let mut identity = connect(config).await;
    let membership_pid = pid(&mut membership).await;
    let identity_pid = pid(&mut identity).await;
    membership.execute("BEGIN").await.unwrap();
    membership
        .execute(Narrowing::Expire.sql("inversion", "inversion-a").as_str())
        .await
        .unwrap();
    identity.execute("BEGIN").await.unwrap();
    let deactivation = tokio::spawn(async move {
        finish(
            &mut identity,
            "UPDATE identities SET active=false WHERE id='inversion-b'",
        )
        .await
    });
    // UPDATE already holds the identity row when its BEFORE trigger requests
    // the organisation fence. The membership path holds the opposite lock.
    wait_for_block(observer, identity_pid, membership_pid).await;
    let expiry = tokio::spawn(async move {
        finish(
            &mut membership,
            "SELECT id FROM identities WHERE id='inversion-b' FOR SHARE",
        )
        .await
    });
    let outcomes = tokio::time::timeout(Duration::from_secs(10), async {
        [expiry.await.unwrap(), deactivation.await.unwrap()]
    })
    .await
    .expect("PostgreSQL must resolve the forced row/advisory lock inversion");
    assert_eq!(outcomes.iter().filter(|outcome| outcome.is_ok()).count(), 1);
    let expiry_lost = outcomes[0].is_err();
    for error in outcomes.into_iter().filter_map(Result::err) {
        assert_code(Err(error), &["40P01"]);
    }
    let a = qualifies(owner, "inversion", "inversion-a").await;
    let b = qualifies(owner, "inversion", "inversion-b").await;
    assert_ne!(a, b, "the deadlock victim's narrowing was not rolled back");
    assert_eq!(a, expiry_lost);
    assert_eq!(b, !expiry_lost);

    let retry_narrowing = if expiry_lost {
        format!(
            "{}; SELECT id FROM identities WHERE id='inversion-b' FOR SHARE",
            Narrowing::Expire.sql("inversion", "inversion-a")
        )
    } else {
        Narrowing::Deactivate.sql("inversion", "inversion-b")
    };
    let retry_sql = format!(
        r#"
        UPDATE membership_versions SET version=8 WHERE organisation_id='inversion';
        INSERT INTO membership_events(id,organisation_id,actor_id,command_key,meaning,receipt)
          VALUES('inversion-retry','inversion','inversion-a','retried-save','{{}}','{{"version":"8"}}');
        {retry_narrowing};
    "#
    );
    let before_retry = snapshot(owner).await;
    // Retry the entire losing operation in a fresh READ COMMITTED transaction.
    // The winner has changed authority, so a retry cannot blindly reuse the
    // pre-deadlock decision that both Admins qualified.
    let mut retry = connect(config).await;
    retry.execute("BEGIN").await.unwrap();
    retry
        .execute("SELECT pg_advisory_xact_lock(hashtextextended('inversion',205))")
        .await
        .unwrap();
    assert_eq!(qualifies(&mut retry, "inversion", "inversion-a").await, a);
    assert_eq!(qualifies(&mut retry, "inversion", "inversion-b").await, b);
    assert_code(finish(&mut retry, &retry_sql).await, &["Z0004"]);
    assert_eq!(
        snapshot(owner).await,
        before_retry,
        "refused whole-transaction retry changed durable authority, versions or receipts"
    );
    invariant(owner).await;

    // An explicit replacement makes the same losing operation safe; a fresh
    // retry now succeeds and produces exactly the previously rolled-back receipt.
    apply(
        owner,
        &format!(
            "INSERT INTO identities(id,issuer,subject,display_name)
           VALUES('inversion-c','{ISSUER}','inversion-c','Explicit replacement');
         INSERT INTO organisation_memberships(organisation_id,actor_id,roles)
           VALUES('inversion','inversion-c',ARRAY['admin'])"
        ),
    )
    .await
    .unwrap();
    let mut retry = connect(config).await;
    retry.execute("BEGIN").await.unwrap();
    retry
        .execute("SELECT pg_advisory_xact_lock(hashtextextended('inversion',205))")
        .await
        .unwrap();
    assert_eq!(qualifies(&mut retry, "inversion", "inversion-a").await, a);
    assert_eq!(qualifies(&mut retry, "inversion", "inversion-b").await, b);
    assert!(qualifies(&mut retry, "inversion", "inversion-c").await);
    finish(&mut retry, &retry_sql).await.unwrap();
    assert!(!qualifies(owner, "inversion", "inversion-a").await);
    assert!(!qualifies(owner, "inversion", "inversion-b").await);
    assert!(qualifies(owner, "inversion", "inversion-c").await);
    let version: i64 = sqlx::query_scalar(
        "SELECT version FROM membership_versions WHERE organisation_id='inversion'",
    )
    .fetch_one(&mut *owner)
    .await
    .unwrap();
    assert_eq!(version, 8);
    let receipt: Value = sqlx::query_scalar(
        "SELECT receipt FROM membership_events WHERE id='inversion-retry' AND actor_id='inversion-a' AND command_key='retried-save'",
    )
    .fetch_one(&mut *owner)
    .await
    .unwrap();
    assert_eq!(receipt, serde_json::json!({"version": "8"}));
    invariant(owner).await;
}

async fn higher_isolation(config: &Configuration, owner: &mut PgConnection) {
    for (level_index, isolation) in ["REPEATABLE READ", "SERIALIZABLE"].into_iter().enumerate() {
        for (change_index, change) in [Narrowing::Expire, Narrowing::Deactivate]
            .into_iter()
            .enumerate()
        {
            let org = format!("isolation-{level_index}-{change_index}");
            provision(owner, &org, true).await;
            let mut stale = connect(config).await;
            stale
                .execute(format!("BEGIN ISOLATION LEVEL {isolation}").as_str())
                .await
                .unwrap();
            assert!(qualifies(&mut stale, &org, &format!("{org}-a")).await);
            apply(owner, &Narrowing::Expire.sql(&org, &format!("{org}-a")))
                .await
                .unwrap();
            // This is a demonstrated stale snapshot, not merely SET isolation.
            assert!(qualifies(&mut stale, &org, &format!("{org}-a")).await);
            assert!(!qualifies(owner, &org, &format!("{org}-a")).await);
            assert_code(
                finish(&mut stale, &change.sql(&org, &format!("{org}-b"))).await,
                &["0A000"],
            );
            assert!(qualifies(owner, &org, &format!("{org}-b")).await);
        }
        let mut unsupported = connect(config).await;
        unsupported
            .execute(format!("BEGIN ISOLATION LEVEL {isolation}").as_str())
            .await
            .unwrap();
        assert_code(finish(&mut unsupported, "INSERT INTO organisations(id,name) VALUES('unsupported-provision','Unsupported provision')").await, &["0A000"]);
    }
    invariant(owner).await;
}

async fn runtime_boundary(config: &Configuration, owner: &mut PgConnection) {
    let mut runtime = PgConnection::connect(&config.runtime).await.unwrap();
    let before = snapshot(owner).await;
    for sql in [
        "UPDATE identities SET active=false WHERE id='matrix-b'",
        "DELETE FROM identities WHERE id='matrix-b'",
        "UPDATE organisation_memberships SET active=false WHERE organisation_id='matrix'",
        "SELECT public.admin_continuity_assert('matrix')",
    ] {
        assert_code(apply(&mut runtime, sql).await, &["42501"]);
    }
    let can_execute: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname='public' AND p.proname IN ('admin_continuity_assert','admin_continuity_lock','admin_continuity_check','admin_continuity_truncate')
           AND pg_catalog.has_function_privilege(current_user,p.oid,'EXECUTE'))",
    ).fetch_one(&mut runtime).await.unwrap();
    assert!(
        !can_execute,
        "trigger helpers became runtime-callable authority"
    );
    assert_eq!(snapshot(owner).await, before);
}

#[tokio::test]
async fn postgres_admin_continuity_contract() {
    let config = Configuration::from_environment();
    let mut owner = connect(&config).await;
    config.guard_connection(&mut owner).await;
    owner.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public; REVOKE CREATE ON SCHEMA public FROM PUBLIC")
        .await.expect("reset only the guarded disposable Admin continuity schema");
    let runtime = database_options(&config.runtime).unwrap();
    migrate(&config.migration, runtime.get_username())
        .await
        .unwrap();
    let mut observer = PgConnection::connect(&config.admin).await.unwrap();
    config.guard_connection(&mut observer).await;

    direct_sql_matrix(&mut owner).await;
    provisioning_and_replacement(&mut owner).await;
    identity_lifecycle(&mut owner).await;
    competing_narrowings(&config, &mut owner, &mut observer).await;
    insertion_identity_races(&config, &mut owner, &mut observer).await;
    qualifying_update_identity_races(&config, &mut owner, &mut observer).await;
    multi_org_phantom_races(&config, &mut owner, &mut observer).await;
    lock_inversion_aborts_safely(&config, &mut owner, &mut observer).await;
    higher_isolation(&config, &mut owner).await;
    runtime_boundary(&config, &mut owner).await;
    invariant(&mut owner).await;
}
