//! Real PostgreSQL identity contract. One serial test owns a guarded *_test schema.
use sqlx::{Connection, Executor, PgConnection, PgPool, postgres::PgPoolOptions};
use std::time::Duration;
use zobba_application::identity::{CurrentAuthority, IdentityError};
use zobba_domain::identity::{AuditRole, Scope};
use zobba_infrastructure::{
    database_options,
    identity::{
        IdentityRepository, LOGIN_SECONDS, SESSION_SECONDS, random_secret, secret_hash,
        valid_secret,
    },
    migrate,
};

mod support;
use support::Configuration;

const ISSUER: &str = "https://synthetic-identity.example";

async fn reset(config: &Configuration, connection: &mut PgConnection) {
    config.guard_connection(connection).await;
    connection.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT USAGE ON SCHEMA public TO PUBLIC; REVOKE CREATE ON SCHEMA public FROM PUBLIC;")
        .await.expect("reset only the guarded disposable identity test schema");
}

async fn seed(config: &Configuration, admin: &mut PgConnection) {
    config.guard_connection(admin).await;
    let mut tx = admin.begin().await.unwrap();
    // Only this isolated fixture transaction may suspend policies. Restore them
    // before commit so all repository calls run with the actual forced policies.
    let tables = [
        "organisations",
        "clients",
        "engagements",
        "organisation_memberships",
        "engagement_assignments",
    ];
    for table in tables {
        tx.execute(format!("ALTER TABLE public.{table} DISABLE ROW LEVEL SECURITY").as_str())
            .await
            .unwrap();
    }
    sqlx::query("INSERT INTO public.identities(id,issuer,subject,display_name) VALUES ('identity-a',$1,'auditor-a','Alex'),('identity-b',$1,'auditor-b','Blair'),('identity-manager',$1,'manager','Morgan'),('identity-admin',$1,'admin','Casey'),('identity-unassigned',$1,'unassigned','Unassigned')")
        .bind(ISSUER).execute(&mut *tx).await.unwrap();
    tx.execute("INSERT INTO public.organisations(id,name) VALUES('org-a','Northstar'),('org-b','Meridian');
        INSERT INTO public.clients(organisation_id,id,name) VALUES('org-a','client-a','Alder'),('org-a','client-other','Other'),('org-b','client-b','Beacon');
        INSERT INTO public.engagements(organisation_id,client_id,id,name) VALUES('org-a','client-a','engagement-a','Audit A'),('org-a','client-other','engagement-other','Other audit'),('org-b','client-b','engagement-b','Audit B');
        INSERT INTO public.organisation_memberships(organisation_id,actor_id,roles) VALUES('org-a','identity-a',ARRAY['auditor']),('org-b','identity-b',ARRAY['auditor']),('org-a','identity-manager',ARRAY['audit_manager','admin']),('org-a','identity-admin',ARRAY['admin']);
        INSERT INTO public.engagement_assignments(organisation_id,client_id,engagement_id,actor_id) VALUES('org-a','client-a','engagement-a','identity-a'),('org-b','client-b','engagement-b','identity-b'),('org-a','client-a','engagement-a','identity-manager'),('org-a','client-a','engagement-a','identity-admin');")
        .await.unwrap();
    for table in tables {
        tx.execute(format!("ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY; ALTER TABLE public.{table} FORCE ROW LEVEL SECURITY").as_str()).await.unwrap();
    }
    tx.commit().await.unwrap();
}

async fn count(admin: &mut PgConnection, table: &str) -> i64 {
    sqlx::query_scalar(&format!("SELECT count(*) FROM public.{table}"))
        .fetch_one(admin)
        .await
        .unwrap()
}

async fn login_contract(
    repository: &IdentityRepository,
    rival: &IdentityRepository,
    admin: &mut PgConnection,
) {
    let state = random_secret().unwrap();
    let browser = random_secret().unwrap();
    let nonce = random_secret().unwrap();
    let verifier = random_secret().unwrap();
    repository
        .begin_login(&state, &browser, &nonce, &verifier)
        .await
        .unwrap();
    let stored: (String, String, String, String, i64) = sqlx::query_as("SELECT state_hash,browser_hash,nonce,pkce_verifier,expires_at-extract(epoch FROM clock_timestamp())::bigint FROM public.login_attempts")
        .fetch_one(&mut *admin).await.unwrap();
    assert_eq!(stored.0, secret_hash(&state));
    assert_eq!(stored.1, secret_hash(&browser));
    assert_ne!(stored.0, state);
    assert_ne!(stored.1, browser);
    assert_eq!((stored.2, stored.3), (nonce.clone(), verifier.clone()));
    assert!((LOGIN_SECONDS - 5..=LOGIN_SECONDS).contains(&stored.4));
    assert_eq!(
        repository.consume_login("malformed", &browser).await.err(),
        Some(IdentityError::InvalidResponse)
    );
    assert_eq!(
        repository
            .consume_login(&random_secret().unwrap(), &browser)
            .await
            .err(),
        Some(IdentityError::InvalidResponse)
    );
    assert_eq!(
        count(admin, "login_attempts").await,
        1,
        "unknown state consumed another attempt"
    );
    assert_eq!(
        repository
            .consume_login(&state, &random_secret().unwrap())
            .await
            .err(),
        Some(IdentityError::InvalidResponse)
    );
    assert_eq!(
        count(admin, "login_attempts").await,
        1,
        "wrong binding consumed another login"
    );
    assert!(repository.consume_login(&state, &browser).await.is_ok());
    assert_eq!(count(admin, "login_attempts").await, 0);

    repository
        .begin_login(&state, &browser, &nonce, &verifier)
        .await
        .unwrap();
    admin.execute("UPDATE public.login_attempts SET expires_at=extract(epoch FROM clock_timestamp())::bigint").await.unwrap();
    assert_eq!(
        repository.consume_login(&state, &browser).await.err(),
        Some(IdentityError::ExpiredLoginConsumed)
    );
    assert_eq!(
        count(admin, "login_attempts").await,
        0,
        "expired attempt was not consumed"
    );
    repository
        .begin_login(&state, &browser, &nonce, &verifier)
        .await
        .unwrap();
    admin
        .execute("UPDATE public.login_attempts SET expires_at=0")
        .await
        .unwrap();
    let fresh_state = random_secret().unwrap();
    repository
        .begin_login(&fresh_state, &browser, &nonce, &verifier)
        .await
        .unwrap();
    assert_eq!(
        count(admin, "login_attempts").await,
        1,
        "begin_login did not clear expired attempts"
    );

    // Hold the row until both separate runtime connections are waiting on it.
    // This proves concurrent database consumption, not just sequential replay.
    let mut lock = admin.begin().await.unwrap();
    sqlx::query("SELECT state_hash FROM public.login_attempts WHERE state_hash=$1 FOR UPDATE")
        .bind(secret_hash(&fresh_state))
        .fetch_one(&mut *lock)
        .await
        .unwrap();
    let consumers = [repository.clone(), rival.clone()].map(|repository| {
        let state = fresh_state.clone();
        let binding = browser.clone();
        tokio::spawn(async move { repository.consume_login(&state, &binding).await })
    });
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let waiting: i64 = sqlx::query_scalar("SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'DELETE FROM public.login_attempts WHERE state_hash=$1%'")
                .fetch_one(&mut *lock).await.unwrap();
            if waiting == 2 { break; }
            // PostgreSQL may cache activity statistics inside a transaction.
            sqlx::query("SELECT pg_catalog.pg_stat_clear_snapshot()").execute(&mut *lock).await.unwrap();
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }).await.expect("both login consumers must reach the locked database row");
    lock.commit().await.unwrap();
    let [left, right] = consumers;
    let results = [left.await.unwrap(), right.await.unwrap()];
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert_eq!(
        results
            .iter()
            .filter(|result| matches!(result, Err(IdentityError::InvalidResponse)))
            .count(),
        1
    );
    let attempt = results.into_iter().find_map(Result::ok).unwrap();
    assert_eq!(attempt.nonce, nonce);
    assert_eq!(attempt.pkce_verifier, verifier);
    assert_eq!(
        repository.consume_login(&fresh_state, &browser).await.err(),
        Some(IdentityError::InvalidResponse)
    );
    assert_eq!(count(admin, "login_attempts").await, 0);
    assert_eq!(
        count(admin, "sessions").await,
        0,
        "login state alone created a session"
    );
}

async fn session_contract(repository: &IdentityRepository, admin: &mut PgConnection) {
    let attacker_chosen = random_secret().unwrap();
    let token = repository
        .establish_session(ISSUER, "auditor-a", "Alex", Some(&attacker_chosen))
        .await
        .unwrap();
    assert!(valid_secret(&token));
    assert_ne!(token, attacker_chosen, "session fixation admitted");
    let current = repository.session(&token).await.unwrap();
    assert_eq!(current.identity.id, "identity-a");
    assert!(valid_secret(&current.csrf_token));
    assert_ne!(current.csrf_token, token);
    let row: (String, String, String, i64) = sqlx::query_as("SELECT token_hash,actor_id,csrf_token,expires_at-extract(epoch FROM clock_timestamp())::bigint FROM public.sessions")
        .fetch_one(&mut *admin).await.unwrap();
    assert_eq!(row.0, secret_hash(&token));
    assert_ne!(row.0, token);
    assert_eq!(row.1, current.identity.id);
    assert_eq!(row.2, current.csrf_token);
    assert!((SESSION_SECONDS - 5..=SESSION_SECONDS).contains(&row.3));
    for invalid in ["", "malformed", &attacker_chosen] {
        assert_eq!(
            repository.session(invalid).await.err(),
            Some(IdentityError::Unauthenticated)
        );
    }
    let rotated = repository
        .establish_session(ISSUER, "auditor-a", "Renamed Alex", Some(&token))
        .await
        .unwrap();
    assert_ne!(rotated, token);
    assert_eq!(
        repository.session(&token).await.err(),
        Some(IdentityError::Unauthenticated)
    );
    let replacement = repository.session(&rotated).await.unwrap();
    assert_eq!(replacement.identity.id, current.identity.id);
    assert_eq!(replacement.identity.display_name, "Renamed Alex");
    assert_ne!(replacement.csrf_token, current.csrf_token);
    assert_eq!(
        count(admin, "sessions").await,
        1,
        "rotation retained the old session"
    );

    let other_issuer = repository
        .establish_session(
            "https://different-issuer.example",
            "auditor-a",
            "Renamed Alex",
            None,
        )
        .await
        .unwrap();
    let other_subject = repository
        .establish_session(ISSUER, "different-subject", "Renamed Alex", None)
        .await
        .unwrap();
    for token in [&other_issuer, &other_subject] {
        let identity = repository.session(token).await.unwrap().identity;
        assert_ne!(
            identity.id, current.identity.id,
            "identity linked by display name or subject without issuer"
        );
        assert!(
            repository
                .engagements(&identity.id, None)
                .await
                .unwrap()
                .engagements
                .is_empty(),
            "new identity inherited application membership"
        );
    }
    assert_ne!(
        repository.session(&other_issuer).await.unwrap().identity.id,
        repository
            .session(&other_subject)
            .await
            .unwrap()
            .identity
            .id
    );
    for token in [&rotated, &other_issuer, &other_subject] {
        repository.logout(token).await.unwrap();
        repository.logout(token).await.unwrap();
        assert_eq!(
            repository.session(token).await.err(),
            Some(IdentityError::Unauthenticated),
            "logged-out session replay succeeded"
        );
    }
    assert_eq!(count(admin, "sessions").await, 0);

    let expired = repository
        .establish_session(ISSUER, "auditor-a", "Alex", None)
        .await
        .unwrap();
    admin
        .execute(
            "UPDATE public.sessions SET expires_at=extract(epoch FROM clock_timestamp())::bigint",
        )
        .await
        .unwrap();
    assert_eq!(
        repository.session(&expired).await.err(),
        Some(IdentityError::Unauthenticated)
    );
    assert_eq!(
        count(admin, "sessions").await,
        0,
        "expired session retained"
    );
    let inactive = repository
        .establish_session(ISSUER, "auditor-a", "Alex", None)
        .await
        .unwrap();
    admin
        .execute("UPDATE public.identities SET active=false WHERE id='identity-a'")
        .await
        .unwrap();
    assert_eq!(
        repository.session(&inactive).await.err(),
        Some(IdentityError::Unauthenticated)
    );
    assert_eq!(
        repository
            .establish_session(ISSUER, "auditor-a", "Untrusted rename", None)
            .await
            .err(),
        Some(IdentityError::Unauthenticated)
    );
    assert_eq!(
        count(admin, "sessions").await,
        0,
        "inactive identity acquired a new session"
    );
    let name: String =
        sqlx::query_scalar("SELECT display_name FROM public.identities WHERE id='identity-a'")
            .fetch_one(&mut *admin)
            .await
            .unwrap();
    assert_eq!(name, "Alex", "rejected sign-in committed identity changes");
    admin
        .execute("UPDATE public.identities SET active=true WHERE id='identity-a'")
        .await
        .unwrap();
    assert_eq!(
        repository.session(&inactive).await.err(),
        Some(IdentityError::Unauthenticated),
        "reactivation restored a revoked session"
    );
}

fn scope(organisation: &str, client: &str, engagement: &str) -> Scope {
    Scope {
        organisation_id: organisation.into(),
        client_id: client.into(),
        engagement_id: engagement.into(),
    }
}

async fn assert_no_authority(repository: &IdentityRepository, actor: &str, selected: &Scope) {
    assert!(
        repository
            .engagements(actor, None)
            .await
            .unwrap()
            .engagements
            .is_empty()
    );
    assert_eq!(
        repository.engagement(actor, selected).await.err(),
        Some(IdentityError::Denied)
    );
}

async fn authority_contract(
    repository: &IdentityRepository,
    pool: &PgPool,
    admin: &mut PgConnection,
) {
    let a = scope("org-a", "client-a", "engagement-a");
    let b = scope("org-b", "client-b", "engagement-b");
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(pool)
        .await
        .unwrap();
    let token = repository
        .establish_session(ISSUER, "auditor-a", "Alex", None)
        .await
        .unwrap();
    for _ in 0..3 {
        for (actor, selected, roles) in [
            ("identity-a", &a, vec![AuditRole::Auditor]),
            ("identity-b", &b, vec![AuditRole::Auditor]),
            (
                "identity-manager",
                &a,
                vec![AuditRole::AuditManager, AuditRole::Admin],
            ),
        ] {
            let assigned = repository
                .engagements(actor, None)
                .await
                .unwrap()
                .engagements;
            assert_eq!(assigned.len(), 1);
            assert_eq!(assigned[0].scope, *selected);
            assert_eq!(assigned[0].roles, roles);
            assert_eq!(
                repository.engagement(actor, selected).await.unwrap(),
                assigned[0]
            );
        }
        assert_no_authority(repository, "identity-admin", &a).await;
        assert_no_authority(repository, "identity-unassigned", &a).await;
        assert_eq!(
            repository.engagement("identity-a", &b).await.err(),
            Some(IdentityError::Denied)
        );
        for guessed in [
            scope("org-a", "client-b", "engagement-a"),
            scope("org-b", "client-a", "engagement-a"),
            scope("org-a", "client-other", "engagement-other"),
            scope("org-a", "client-a", "missing"),
        ] {
            assert_eq!(
                repository.engagement("identity-a", &guessed).await.err(),
                Some(IdentityError::Denied)
            );
        }
        let context: (i32, bool) = sqlx::query_as("SELECT pg_backend_pid(), COALESCE(current_setting('zobba.actor_id',true),'')='' AND COALESCE(current_setting('zobba.organisation_id',true),'')='' AND COALESCE(current_setting('zobba.client_id',true),'')='' AND COALESCE(current_setting('zobba.engagement_id',true),'')=''")
            .fetch_one(pool).await.unwrap();
        assert_eq!(
            context,
            (pid, true),
            "scope leaked or test stopped reusing one connection"
        );
    }
    for change in [
        "UPDATE public.organisation_memberships SET roles=ARRAY['admin'] WHERE actor_id='identity-a'",
        "UPDATE public.organisation_memberships SET active=false WHERE actor_id='identity-a'",
        "UPDATE public.organisation_memberships SET expires_at=extract(epoch FROM clock_timestamp())::bigint WHERE actor_id='identity-a'",
        "UPDATE public.engagement_assignments SET active=false WHERE actor_id='identity-a'",
        "UPDATE public.engagement_assignments SET expires_at=extract(epoch FROM clock_timestamp())::bigint WHERE actor_id='identity-a'",
        "DELETE FROM public.engagement_assignments WHERE actor_id='identity-a'",
        "DELETE FROM public.engagement_assignments WHERE actor_id='identity-a'; DELETE FROM public.organisation_memberships WHERE actor_id='identity-a'",
    ] {
        admin.execute(change).await.unwrap();
        assert_no_authority(repository, "identity-a", &a).await;
        assert_eq!(
            repository.session(&token).await.unwrap().identity.id,
            "identity-a",
            "valid sign-in should still reach the empty chooser"
        );
        admin.execute("INSERT INTO public.organisation_memberships(organisation_id,actor_id,roles) VALUES('org-a','identity-a',ARRAY['auditor','admin']) ON CONFLICT(organisation_id,actor_id) DO UPDATE SET active=true,expires_at=NULL,roles=EXCLUDED.roles;
            INSERT INTO public.engagement_assignments(organisation_id,client_id,engagement_id,actor_id) VALUES('org-a','client-a','engagement-a','identity-a') ON CONFLICT(organisation_id,client_id,engagement_id,actor_id) DO UPDATE SET active=true,expires_at=NULL;").await.unwrap();
        assert_eq!(
            repository.engagement("identity-a", &a).await.unwrap().roles,
            vec![AuditRole::Auditor, AuditRole::Admin]
        );
    }
    admin
        .execute("UPDATE public.identities SET active=false WHERE id='identity-a'")
        .await
        .unwrap();
    assert_no_authority(repository, "identity-a", &a).await;
    assert_eq!(
        repository.session(&token).await.err(),
        Some(IdentityError::Unauthenticated)
    );
}

#[tokio::test]
async fn postgres_identity_contract() {
    let config = Configuration::from_environment();
    let mut migration = PgConnection::connect_with(&database_options(&config.migration).unwrap())
        .await
        .unwrap();
    reset(&config, &mut migration).await;
    migrate(
        &config.migration,
        database_options(&config.runtime).unwrap().get_username(),
    )
    .await
    .unwrap();
    let mut admin = PgConnection::connect_with(&database_options(&config.admin).unwrap())
        .await
        .unwrap();
    seed(&config, &mut admin).await;
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(Duration::from_secs(5))
        .connect_with(database_options(&config.runtime).unwrap())
        .await
        .unwrap();
    let rival_pool = PgPoolOptions::new()
        .max_connections(8)
        .acquire_timeout(Duration::from_secs(5))
        .connect_with(database_options(&config.runtime).unwrap())
        .await
        .unwrap();
    let repository = IdentityRepository::new(pool.clone());
    let rival = IdentityRepository::new(rival_pool.clone());
    let test_pool = pool.clone();
    // Preserve the original assertion failure while still clearing the fixture.
    let outcome = tokio::spawn(async move {
        login_contract(&repository, &rival, &mut admin).await;
        bounded_capacity_contract(&repository, &rival, &mut admin).await;
        session_contract(&repository, &mut admin).await;
        stored_scope_bounds_contract(&mut admin).await;
        paginated_authority_contract(&repository, &mut admin).await;
        authority_contract(&repository, &test_pool, &mut admin).await;
    })
    .await;
    pool.close().await;
    rival_pool.close().await;
    reset(&config, &mut migration).await;
    let remaining: i64 =
        sqlx::query_scalar("SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname='public'")
            .fetch_one(&mut migration)
            .await
            .unwrap();
    assert_eq!(
        remaining, 0,
        "identity fixture did not leave an empty database"
    );
    if let Err(error) = outcome {
        std::panic::resume_unwind(error.into_panic());
    }
}

async fn bounded_capacity_contract(
    repository: &IdentityRepository,
    rival: &IdentityRepository,
    admin: &mut PgConnection,
) {
    use zobba_infrastructure::identity::{EXPIRY_CLEANUP_BATCH, LOGIN_CAPACITY};
    admin
        .execute("DELETE FROM public.login_attempts; DELETE FROM public.sessions")
        .await
        .unwrap();
    // A substantial imported backlog must cost one fixed batch, including under
    // concurrent calls. Tokens here are synthetic owner fixtures, never login bypasses.
    admin.execute("INSERT INTO public.login_attempts SELECT 'expired-'||n,'binding','nonce','verifier',0 FROM generate_series(1,10000) n").await.unwrap();
    let first = random_secret().unwrap();
    let binding = random_secret().unwrap();
    repository
        .begin_login(&first, &binding, &binding, &binding)
        .await
        .unwrap();
    assert_eq!(
        count(admin, "login_attempts").await,
        10_001 - EXPIRY_CLEANUP_BATCH
    );
    let left_state = random_secret().unwrap();
    let right_state = random_secret().unwrap();
    let (left, right) = tokio::join!(
        repository.begin_login(&left_state, &binding, &binding, &binding),
        rival.begin_login(&right_state, &binding, &binding, &binding)
    );
    left.unwrap();
    right.unwrap();
    assert_eq!(
        count(admin, "login_attempts").await,
        10_003 - 3 * EXPIRY_CLEANUP_BATCH
    );
    // Hold a row well beyond the first batch. Admission must not touch/wait for it.
    let mut held = admin.begin().await.unwrap();
    sqlx::query(
        "SELECT state_hash FROM public.login_attempts WHERE state_hash='expired-9999' FOR UPDATE",
    )
    .fetch_one(&mut *held)
    .await
    .unwrap();
    tokio::time::timeout(
        Duration::from_secs(2),
        repository.begin_login(&random_secret().unwrap(), &binding, &binding, &binding),
    )
    .await
    .expect("cleanup scanned beyond the bounded batch")
    .unwrap();
    held.rollback().await.unwrap();
    admin
        .execute("DELETE FROM public.login_attempts")
        .await
        .unwrap();
    sqlx::query("INSERT INTO public.login_attempts SELECT 'live-'||n,'binding','nonce','verifier',extract(epoch FROM statement_timestamp())::bigint+300 FROM generate_series(1,$1) n")
        .bind(LOGIN_CAPACITY-1).execute(&mut *admin).await.unwrap();
    // Every competing connection defaults to REPEATABLE READ. Admission must
    // explicitly lower isolation before taking a snapshot while awaiting its
    // lock; otherwise all eight retain the same stale count of 999 rows.
    let admission_pool = PgPoolOptions::new()
        .max_connections(8)
        .acquire_timeout(Duration::from_secs(5))
        .after_connect(|connection, _metadata| Box::pin(async move {
            connection.execute("SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL REPEATABLE READ").await?;
            Ok(())
        }))
        .connect_with(database_options(&Configuration::from_environment().runtime).unwrap())
        .await.unwrap();
    let default_isolation: String = sqlx::query_scalar("SHOW default_transaction_isolation")
        .fetch_one(&admission_pool)
        .await
        .unwrap();
    assert_eq!(default_isolation, "repeatable read");
    let admission_repository = IdentityRepository::new(admission_pool.clone());
    // Eight independent connections wait at admission for exactly one slot.
    let mut admission_lock = admin.begin().await.unwrap();
    admission_lock
        .execute("SELECT pg_catalog.pg_advisory_xact_lock(9026020002)")
        .await
        .unwrap();
    let mut admissions = Vec::new();
    for _ in 0..8 {
        let repository = admission_repository.clone();
        admissions.push(tokio::spawn(async move {
            let secret = random_secret().unwrap();
            repository
                .begin_login(&secret, &secret, &secret, &secret)
                .await
        }));
    }
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            sqlx::query("SELECT pg_catalog.pg_stat_clear_snapshot()").execute(&mut *admission_lock).await.unwrap();
            let waiting: i64=sqlx::query_scalar("SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query='SELECT pg_catalog.pg_advisory_xact_lock(9026020002)'")
                .fetch_one(&mut *admission_lock).await.unwrap();
            if waiting == 8 { break; }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }).await.expect("all eight admissions must overlap at the database lock");
    admission_lock.commit().await.unwrap();
    let mut accepted = 0;
    let mut capacity = 0;
    for admission in admissions {
        match admission.await.unwrap() {
            Ok(()) => accepted += 1,
            Err(IdentityError::Capacity) => capacity += 1,
            Err(other) => panic!("unexpected admission result: {other:?}"),
        }
    }
    admission_pool.close().await;
    assert_eq!((accepted, capacity), (1, 7));
    assert_eq!(count(admin, "login_attempts").await, LOGIN_CAPACITY);
    for _ in 0..8 {
        assert_eq!(
            repository
                .begin_login(&random_secret().unwrap(), &binding, &binding, &binding)
                .await,
            Err(IdentityError::Capacity)
        );
    }
    assert_eq!(count(admin, "login_attempts").await, LOGIN_CAPACITY);
    // Capacity refusal still commits bounded cleanup; it never rolls it back.
    admin.execute("INSERT INTO public.login_attempts SELECT 'expired-'||n,'binding','nonce','verifier',0 FROM generate_series(1,10000) n").await.unwrap();
    assert_eq!(
        repository
            .begin_login(&random_secret().unwrap(), &binding, &binding, &binding)
            .await,
        Err(IdentityError::Capacity)
    );
    assert_eq!(
        count(admin, "login_attempts").await,
        10_000 + LOGIN_CAPACITY - EXPIRY_CLEANUP_BATCH
    );
    admin
        .execute("DELETE FROM public.login_attempts")
        .await
        .unwrap();
    admin.execute("INSERT INTO public.sessions SELECT 'expired-'||n,'identity-a','csrf',0 FROM generate_series(1,10000) n").await.unwrap();
    repository
        .establish_session(ISSUER, "auditor-a", "Alex", None)
        .await
        .unwrap();
    assert_eq!(
        count(admin, "sessions").await,
        10_001 - EXPIRY_CLEANUP_BATCH
    );
    let (left, right) = tokio::join!(
        repository.establish_session(ISSUER, "auditor-a", "Alex", None),
        rival.establish_session(ISSUER, "auditor-b", "Blair", None)
    );
    left.unwrap();
    right.unwrap();
    let remaining = count(admin, "sessions").await;
    // Concurrent cleanup may overlap, but each call removes at most 128 rows.
    assert!(
        (10_003 - 3 * EXPIRY_CLEANUP_BATCH..=10_003 - 2 * EXPIRY_CLEANUP_BATCH)
            .contains(&remaining)
    );
    // EXPLAIN the production DELETE itself. Both finding expired records AND
    // removing them must stay bounded: no sequential target-table backlog scan.
    admin.execute("INSERT INTO public.login_attempts SELECT 'expired-'||n,'binding','nonce','verifier',0 FROM generate_series(1,10000) n; ANALYZE public.login_attempts; ANALYZE public.sessions").await.unwrap();
    for (cleanup, index) in [
        (
            zobba_infrastructure::identity::LOGIN_EXPIRY_CLEANUP_SQL,
            "login_attempts_expiry",
        ),
        (
            zobba_infrastructure::identity::SESSION_EXPIRY_CLEANUP_SQL,
            "sessions_expiry",
        ),
    ] {
        let plan: Vec<String> = sqlx::query_scalar(&format!("EXPLAIN {cleanup}"))
            .bind(1_i64)
            .bind(EXPIRY_CLEANUP_BATCH)
            .fetch_all(&mut *admin)
            .await
            .unwrap();
        let plan = plan.join("\n");
        assert!(
            plan.contains(index),
            "missing indexed expiry lookup: {plan}"
        );
        assert!(
            plan.contains("Tid Scan"),
            "missing bounded deletion: {plan}"
        );
        assert!(!plan.contains("Seq Scan"), "cleanup scans backlog: {plan}");
    }
    admin
        .execute("DELETE FROM public.login_attempts; DELETE FROM public.sessions")
        .await
        .unwrap();
}

async fn paginated_authority_contract(repository: &IdentityRepository, admin: &mut PgConnection) {
    // Duplicate names and repeated engagement IDs across scopes make name-only
    // order or engagement-only cursors lose rows at the page boundary.
    admin.execute("INSERT INTO public.identities(id,issuer,subject,display_name) VALUES('page-actor','https://synthetic-identity.example','page-actor','Pages'); INSERT INTO public.organisation_memberships(organisation_id,actor_id,roles) VALUES('org-a','page-actor',ARRAY['auditor']),('org-b','page-actor',ARRAY['auditor']); INSERT INTO public.engagements(organisation_id,client_id,id,name) SELECT 'org-a','client-a','page-'||lpad(n::text,3,'0'),'Same name' FROM generate_series(1,121) n; INSERT INTO public.engagements(organisation_id,client_id,id,name) VALUES('org-b','client-b','page-050','Same name'); INSERT INTO public.engagement_assignments(organisation_id,client_id,engagement_id,actor_id) SELECT organisation_id,client_id,id,'page-actor' FROM public.engagements WHERE id LIKE 'page-%';").await.unwrap();
    let saved = scope("org-a", "client-a", "page-121");
    assert_eq!(
        repository
            .engagement("page-actor", &saved)
            .await
            .unwrap()
            .scope,
        saved
    );
    let mut cursor = None;
    let mut seen = std::collections::BTreeSet::new();
    let mut sizes = Vec::new();
    loop {
        let page = repository
            .engagements("page-actor", cursor.as_ref())
            .await
            .unwrap();
        sizes.push(page.engagements.len());
        assert!(page.engagements.len() <= 50);
        for item in page.engagements {
            assert_eq!(item.roles, [AuditRole::Auditor]);
            assert!(
                seen.insert((
                    item.scope.organisation_id,
                    item.scope.client_id,
                    item.scope.engagement_id
                )),
                "page duplicated scope"
            );
        }
        let Some(next) = page.next_cursor else { break };
        cursor = Some(next);
    }
    assert_eq!(sizes, [50, 50, 22]);
    assert_eq!(seen.len(), 122);
    assert!(seen.contains(&("org-b".into(), "client-b".into(), "page-050".into())));
    // A stale cursor is only a position; current membership still authorizes rows.
    admin
        .execute(
            "UPDATE public.organisation_memberships SET active=false WHERE actor_id='page-actor'",
        )
        .await
        .unwrap();
    assert!(
        repository
            .engagements("page-actor", cursor.as_ref())
            .await
            .unwrap()
            .engagements
            .is_empty()
    );
    assert_eq!(
        repository.engagement("page-actor", &saved).await.err(),
        Some(IdentityError::Denied)
    );
}

async fn stored_scope_bounds_contract(admin: &mut PgConnection) {
    for id in [
        "".to_owned(),
        "x".repeat(129),
        "slash/id".into(),
        "query?id".into(),
        "é".into(),
        "has space".into(),
        "x\n".into(),
    ] {
        let error = sqlx::query("INSERT INTO public.organisations(id,name) VALUES($1,'Label')")
            .bind(id)
            .execute(&mut *admin)
            .await
            .unwrap_err();
        assert_eq!(
            error.as_database_error().unwrap().code().as_deref(),
            Some("23514")
        );
    }
    let id = "z".repeat(128);
    let label = "🦉".repeat(200);
    sqlx::query("INSERT INTO public.organisations(id,name) VALUES($1,$2)")
        .bind(&id)
        .bind(&label)
        .execute(&mut *admin)
        .await
        .unwrap();
    for bad in [
        "".to_owned(),
        "x".repeat(201),
        "🦉".repeat(201),
        " space".into(),
        "space ".into(),
        "\u{a0}space".into(),
        "space\u{3000}".into(),
        "a\u{85}b".into(),
        "a\u{7f}b".into(),
        "a\u{9f}b".into(),
        "a\nb".into(),
    ] {
        for statement in [
            "UPDATE public.organisations SET name=$1 WHERE id='org-a'",
            "UPDATE public.clients SET name=$1 WHERE organisation_id='org-a' AND id='client-a'",
            "UPDATE public.engagements SET name=$1 WHERE organisation_id='org-a' AND client_id='client-a' AND id='engagement-a'",
        ] {
            let error = sqlx::query(statement)
                .bind(&bad)
                .execute(&mut *admin)
                .await
                .unwrap_err();
            assert_eq!(
                error.as_database_error().unwrap().code().as_deref(),
                Some("23514"),
                "admitted {bad:?}"
            );
        }
    }
    let whitespace = "\u{9}\u{a}\u{b}\u{c}\u{d} \u{85}\u{a0}\u{1680}\u{2000}\u{2001}\u{2002}\u{2003}\u{2004}\u{2005}\u{2006}\u{2007}\u{2008}\u{2009}\u{200a}\u{2028}\u{2029}\u{202f}\u{205f}\u{3000}";
    for bad in whitespace
        .chars()
        .flat_map(|c| [format!("{c}label"), format!("label{c}")])
        .chain(
            (1..=31)
                .chain(127..=159)
                .map(|c| format!("a{}b", char::from_u32(c).unwrap())),
        )
    {
        let error = sqlx::query("UPDATE public.organisations SET name=$1 WHERE id='org-a'")
            .bind(&bad)
            .execute(&mut *admin)
            .await
            .unwrap_err();
        assert_eq!(
            error.as_database_error().unwrap().code().as_deref(),
            Some("23514"),
            "admitted whitespace/control {bad:?}"
        );
    }
    // Interior whitespace and format characters are valid Unicode labels.
    sqlx::query("UPDATE public.organisations SET name=$1 WHERE id='org-a'")
        .bind("a\u{a0}b\u{feff}")
        .execute(&mut *admin)
        .await
        .unwrap();
    for bad in ["".to_owned(), "x".repeat(129), "slash/id".into()] {
        for statement in [
            "INSERT INTO public.clients(organisation_id,id,name) VALUES('org-a',$1,'Label')",
            "INSERT INTO public.engagements(organisation_id,client_id,id,name) VALUES('org-a','client-a',$1,'Label')",
        ] {
            let error = sqlx::query(statement)
                .bind(&bad)
                .execute(&mut *admin)
                .await
                .unwrap_err();
            assert_eq!(
                error.as_database_error().unwrap().code().as_deref(),
                Some("23514")
            );
        }
    }
}
