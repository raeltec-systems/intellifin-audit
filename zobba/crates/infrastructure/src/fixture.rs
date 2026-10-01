//! Explicit synthetic fixture provisioning. Never called by API/worker startup.
use crate::database_options;
use sqlx::{Connection, PgConnection};
use zobba_application::BootstrapError;

fn loopback(value: &str) -> bool {
    matches!(value, "localhost" | "127.0.0.1" | "[::1]" | "::1")
}

pub async fn seed_local() -> Result<(), BootstrapError> {
    if std::env::var("ZOBBA_LOCAL_FIXTURES").as_deref() != Ok("1") {
        return Err(BootstrapError::InvalidConfiguration);
    }
    let issuer =
        std::env::var("ZOBBA_OIDC_ISSUER").map_err(|_| BootstrapError::InvalidConfiguration)?;
    let database_url = std::env::var("ZOBBA_MIGRATION_DATABASE_URL")
        .map_err(|_| BootstrapError::InvalidConfiguration)?;
    seed_local_configured(&issuer, &database_url).await
}

/// Explicit provisioning entry point for the local fixture CLI and guarded tests.
/// Both destinations must be loopback; this never participates in authentication.
pub async fn seed_local_configured(issuer: &str, database_url: &str) -> Result<(), BootstrapError> {
    let issuer_url = url::Url::parse(issuer).map_err(|_| BootstrapError::InvalidConfiguration)?;
    let options = database_options(database_url)?;
    if issuer_url.scheme() != "https"
        || !issuer_url.host_str().is_some_and(loopback)
        || !loopback(options.get_host())
    {
        return Err(BootstrapError::InvalidConfiguration);
    }
    let mut connection = PgConnection::connect_with(&options)
        .await
        .map_err(|_| BootstrapError::DatabaseUnavailable)?;
    let mut tx = connection
        .begin()
        .await
        .map_err(|_| BootstrapError::DatabaseUnavailable)?;
    // Provisioning must not inherit a stale-snapshot isolation default: the
    // continuity guards require READ COMMITTED before any lock or metadata read.
    sqlx::query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED")
        .execute(&mut *tx)
        .await
        .map_err(|_| BootstrapError::MigrationFailed)?;
    // Serialize provisioning before schema validation and fixture metadata reads.
    sqlx::query("SELECT pg_advisory_xact_lock(20260930, 2002)")
        .execute(&mut *tx)
        .await
        .map_err(|_| BootstrapError::MigrationFailed)?;
    // Validate before reading fixture metadata; seeding never migrates.
    crate::check_schema(&mut tx, false).await?;
    // The singleton row serializes provisioning and retains the decision even if
    // every synthetic identity and membership is subsequently removed.
    let provisioned: Option<String> = sqlx::query_scalar(
        "SELECT local_fixture_issuer FROM public.zobba_bootstrap WHERE singleton FOR UPDATE",
    )
    .fetch_one(&mut *tx)
    .await
    .map_err(|_| BootstrapError::MigrationFailed)?;
    if let Some(provisioned) = provisioned {
        return if provisioned == issuer {
            tx.commit()
                .await
                .map_err(|_| BootstrapError::MigrationFailed)
        } else {
            Err(BootstrapError::InvalidConfiguration)
        };
    }
    // The existing owner policies permit provisioning with FORCE RLS enabled.
    for (id, subject, name) in [
        ("actor-a", "auditor-a", "Alex Auditor"),
        ("actor-manager", "manager-a", "Morgan Manager"),
        ("actor-b", "auditor-b", "Blair Auditor"),
        ("actor-admin", "admin-only", "Casey Administrator"),
        ("actor-admin-b", "admin-b-only", "Drew Administrator"),
        ("actor-unassigned", "unassigned", "Unassigned Auditor"),
    ] {
        let inserted=sqlx::query("INSERT INTO public.identities(id,issuer,subject,display_name) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET display_name=EXCLUDED.display_name WHERE identities.issuer=EXCLUDED.issuer AND identities.subject=EXCLUDED.subject")
            .bind(id).bind(issuer).bind(subject).bind(name).execute(&mut *tx).await.map_err(|_|BootstrapError::MigrationFailed)?;
        if inserted.rows_affected() != 1 {
            return Err(BootstrapError::InvalidConfiguration);
        }
    }
    sqlx::raw_sql("INSERT INTO public.organisations(id,name) VALUES('org-a','Northstar'),('org-b','Meridian') ON CONFLICT DO NOTHING;
      INSERT INTO public.clients(organisation_id,id,name) VALUES('org-a','client-a','Alder Manufacturing'),('org-b','client-b','Beacon Services') ON CONFLICT DO NOTHING;
      INSERT INTO public.engagements(organisation_id,client_id,id,name) VALUES('org-a','client-a','engagement-a','FY2026 audit'),('org-b','client-b','engagement-b','FY2026 review') ON CONFLICT DO NOTHING;
      INSERT INTO public.organisation_memberships(organisation_id,actor_id,roles) VALUES('org-a','actor-a',ARRAY['auditor']),('org-a','actor-manager',ARRAY['audit_manager','admin']),('org-b','actor-b',ARRAY['auditor']),('org-a','actor-admin',ARRAY['admin']),('org-b','actor-admin-b',ARRAY['admin']) ON CONFLICT DO NOTHING;
      INSERT INTO public.engagement_assignments(organisation_id,client_id,engagement_id,actor_id) VALUES('org-a','client-a','engagement-a','actor-a'),('org-a','client-a','engagement-a','actor-manager'),('org-b','client-b','engagement-b','actor-b') ON CONFLICT DO NOTHING;")
        .execute(&mut *tx).await.map_err(|_|BootstrapError::MigrationFailed)?;
    sqlx::query("UPDATE public.zobba_bootstrap SET local_fixture_issuer=$1 WHERE singleton")
        .bind(issuer)
        .execute(&mut *tx)
        .await
        .map_err(|_| BootstrapError::MigrationFailed)?;
    crate::check_schema(&mut tx, false).await?;
    tx.commit()
        .await
        .map_err(|_| BootstrapError::MigrationFailed)
}
