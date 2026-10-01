//! Seed is a once-only provisioning operation, including after explicit revocation.
use sqlx::{Connection, Executor, PgConnection};
use zobba_application::BootstrapError;
use zobba_infrastructure::{
    RuntimeDatabase, database_options, fixture::seed_local_configured, migrate,
};
mod support;
use support::Configuration;
#[path = "support/isolation.rs"]
mod isolation;

async fn state(admin: &mut PgConnection) -> Vec<String> {
    let mut rows = Vec::new();
    for table in [
        "identities",
        "organisations",
        "clients",
        "engagements",
        "organisation_memberships",
        "engagement_assignments",
        "zobba_bootstrap",
    ] {
        rows.push(sqlx::query_scalar::<_,String>(&format!("SELECT coalesce(string_agg(to_jsonb(t)::text,',' ORDER BY to_jsonb(t)::text),'empty') FROM public.{table} t")).fetch_one(&mut *admin).await.unwrap());
    }
    rows
}

#[tokio::test]
async fn local_seed_preserves_deleted_and_disabled_authority() {
    let config = Configuration::from_environment();
    let mut owner = PgConnection::connect(&config.migration).await.unwrap();
    config.guard_connection(&mut owner).await;
    seed_under_higher_connection_defaults(&config, &mut owner).await;
    owner.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public; REVOKE CREATE ON SCHEMA public FROM PUBLIC").await.unwrap();
    migrate(
        &config.migration,
        database_options(&config.runtime).unwrap().get_username(),
    )
    .await
    .unwrap();
    let mut admin = PgConnection::connect(&config.admin).await.unwrap();
    config.guard_connection(&mut admin).await;
    let issuer = "https://127.0.0.1:4443";
    let (left, right) = tokio::join!(
        seed_local_configured(issuer, &config.migration),
        seed_local_configured(issuer, &config.migration)
    );
    left.unwrap();
    right.unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM public.identities")
            .fetch_one(&mut admin)
            .await
            .unwrap(),
        6
    );
    let continuity: bool = sqlx::query_scalar(
        "SELECT NOT EXISTS(SELECT 1 FROM public.organisations o WHERE NOT EXISTS(SELECT 1 FROM public.organisation_memberships m JOIN public.identities i ON i.id=m.actor_id WHERE m.organisation_id=o.id AND m.active AND m.expires_at IS NULL AND 'admin'=ANY(m.roles) AND i.active))",
    )
    .fetch_one(&mut admin)
    .await
    .unwrap();
    assert!(
        continuity,
        "every synthetic organisation needs a permanent Admin"
    );
    let admin_b: (Vec<String>, bool, Option<i64>) = sqlx::query_as(
        "SELECT roles,active,expires_at FROM public.organisation_memberships WHERE organisation_id='org-b' AND actor_id='actor-admin-b'",
    )
    .fetch_one(&mut admin)
    .await
    .unwrap();
    assert_eq!(admin_b, (vec!["admin".to_owned()], true, None));
    let auditor_b: Vec<String> = sqlx::query_scalar(
        "SELECT roles FROM public.organisation_memberships WHERE organisation_id='org-b' AND actor_id='actor-b'",
    )
    .fetch_one(&mut admin)
    .await
    .unwrap();
    assert_eq!(
        auditor_b,
        ["auditor"],
        "seeding must not promote the auditor"
    );
    let admin_scopes: Vec<(String, String)> = sqlx::query_as(
        "SELECT actor_id,organisation_id FROM public.organisation_memberships WHERE actor_id IN ('actor-admin','actor-admin-b') ORDER BY actor_id",
    )
    .fetch_all(&mut admin)
    .await
    .unwrap();
    assert_eq!(
        admin_scopes,
        [
            ("actor-admin".to_owned(), "org-a".to_owned()),
            ("actor-admin-b".to_owned(), "org-b".to_owned()),
        ],
        "each dedicated Admin must retain its own organisation scope"
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM public.engagement_assignments WHERE actor_id='actor-admin-b'"
        )
        .fetch_one(&mut admin)
        .await
        .unwrap(),
        0,
        "the new Admin must have no audit assignment"
    );
    let first = state(&mut admin).await;
    seed_local_configured(issuer, &config.migration)
        .await
        .unwrap();
    assert_eq!(state(&mut admin).await, first);
    admin.execute("DELETE FROM public.engagement_assignments WHERE actor_id='actor-a'; DELETE FROM public.organisation_memberships WHERE actor_id='actor-a'; UPDATE public.identities SET active=false WHERE id='actor-a'; UPDATE public.engagement_assignments SET active=false WHERE actor_id='actor-manager'; UPDATE public.organisation_memberships SET active=false WHERE actor_id='actor-manager'; DELETE FROM public.identities WHERE id='actor-unassigned'").await.unwrap();
    // An explicit replacement permits revoking the dedicated org-b Admin.
    // The provisioning marker must prevent later seed calls from restoring it.
    let mut replacement = admin.begin().await.unwrap();
    sqlx::query("INSERT INTO public.identities(id,issuer,subject,display_name) VALUES('actor-admin-b-replacement',$1,'admin-b-replacement','Replacement Administrator')")
        .bind(issuer)
        .execute(&mut *replacement)
        .await
        .unwrap();
    replacement.execute("INSERT INTO public.organisation_memberships(organisation_id,actor_id,roles) VALUES('org-b','actor-admin-b-replacement',ARRAY['admin']); UPDATE public.organisation_memberships SET active=false WHERE organisation_id='org-b' AND actor_id='actor-admin-b'; UPDATE public.identities SET active=false WHERE id='actor-admin-b'").await.unwrap();
    replacement.commit().await.unwrap();
    let revoked = state(&mut admin).await;
    seed_local_configured(issuer, &config.migration)
        .await
        .unwrap();
    assert_eq!(
        state(&mut admin).await,
        revoked,
        "rerun revived removed authority or identity"
    );
    assert_eq!(
        seed_local_configured("https://localhost:4443", &config.migration).await,
        Err(BootstrapError::InvalidConfiguration)
    );
    assert_eq!(
        state(&mut admin).await,
        revoked,
        "different issuer modified existing provisioning"
    );
    // Removing a complete disposable organisation is atomic: no ownerless
    // organisation may remain after the transaction commits.
    let mut remove = admin.begin().await.unwrap();
    remove.execute("DELETE FROM public.engagement_assignments; DELETE FROM public.organisation_memberships; DELETE FROM public.identities; DELETE FROM public.engagements; DELETE FROM public.clients; DELETE FROM public.organisations").await.unwrap();
    remove.commit().await.unwrap();
    let removed = state(&mut admin).await;
    seed_local_configured(issuer, &config.migration)
        .await
        .unwrap();
    assert_eq!(
        state(&mut admin).await,
        removed,
        "removing all fixtures lost the provisioning marker"
    );
    let runtime = RuntimeDatabase::connect(&config.runtime).await.unwrap();
    runtime.pool().close().await;
    owner.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public; REVOKE CREATE ON SCHEMA public FROM PUBLIC").await.unwrap();
}

async fn seed_under_higher_connection_defaults(config: &Configuration, owner: &mut PgConnection) {
    let role = database_options(&config.runtime)
        .unwrap()
        .get_username()
        .to_owned();
    let options = database_options(&config.migration).unwrap();
    for default in ["repeatable read", "serializable"] {
        config.guard_connection(owner).await;
        owner.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public; REVOKE CREATE ON SCHEMA public FROM PUBLIC").await.unwrap();
        migrate(&config.migration, &role).await.unwrap();
        // Only this migration role in this disposable database receives the
        // higher default. Capture errors; the helper restores before assertions.
        let (observed, seeded) = isolation::with_migration_default(config, default, || async {
            let mut fresh = PgConnection::connect_with(&options).await?;
            let observed: String = sqlx::query_scalar("SHOW default_transaction_isolation")
                .fetch_one(&mut fresh)
                .await?;
            fresh.close().await?;
            let seeded = seed_local_configured("https://127.0.0.1:4443", &config.migration).await;
            Ok::<_, sqlx::Error>((observed, seeded))
        })
        .await
        .unwrap();
        assert_eq!(
            observed, default,
            "fresh seed connection inherited wrong default"
        );
        seeded.expect("seed must select READ COMMITTED before its first query");
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM public.organisations")
                .fetch_one(&mut *owner)
                .await
                .unwrap(),
            2,
            "first seed must provision both organisations under a higher default"
        );
        let before = state(owner).await;
        let repeated = isolation::with_migration_default(config, default, || {
            seed_local_configured("https://127.0.0.1:4443", &config.migration)
        })
        .await;
        repeated.expect("repeat seed accepts the higher connection default");
        assert_eq!(
            state(owner).await,
            before,
            "repeat seed changed fixture authority"
        );
    }
}

#[tokio::test]
async fn local_seed_refuses_nonlocal_destinations_before_connecting() {
    for (issuer, database) in [
        (
            "http://127.0.0.1:4443",
            "postgres://owner@127.0.0.1/fixture_test",
        ),
        (
            "https://customer.example",
            "postgres://owner@127.0.0.1/fixture_test",
        ),
        (
            "https://127.0.0.1:4443",
            "postgres://owner@customer.example/fixture_test",
        ),
    ] {
        assert_eq!(
            seed_local_configured(issuer, database).await,
            Err(BootstrapError::InvalidConfiguration)
        );
    }
}
