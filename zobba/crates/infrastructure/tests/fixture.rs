//! Seed is a once-only provisioning operation, including after explicit revocation.
use sqlx::{Connection, Executor, PgConnection};
use zobba_application::BootstrapError;
use zobba_infrastructure::{
    RuntimeDatabase, database_options, fixture::seed_local_configured, migrate,
};
mod support;
use support::Configuration;

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
        5
    );
    let first = state(&mut admin).await;
    seed_local_configured(issuer, &config.migration)
        .await
        .unwrap();
    assert_eq!(state(&mut admin).await, first);
    admin.execute("DELETE FROM public.engagement_assignments WHERE actor_id='actor-a'; DELETE FROM public.organisation_memberships WHERE actor_id='actor-a'; UPDATE public.identities SET active=false WHERE id='actor-a'; UPDATE public.engagement_assignments SET active=false WHERE actor_id='actor-manager'; UPDATE public.organisation_memberships SET active=false WHERE actor_id='actor-manager'; DELETE FROM public.identities WHERE id='actor-unassigned'").await.unwrap();
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
    admin.execute("DELETE FROM public.engagement_assignments; DELETE FROM public.organisation_memberships; DELETE FROM public.identities; DELETE FROM public.engagements; DELETE FROM public.clients; DELETE FROM public.organisations").await.unwrap();
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
