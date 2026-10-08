//! Scope a connection default to the guarded migration role and test database.
use crate::support::Configuration;
use futures_util::FutureExt;
use sqlx::{Connection, Executor, PgConnection};
use std::{
    future::Future,
    panic::{AssertUnwindSafe, resume_unwind},
};
use zobba_infrastructure::database_options;

async fn settings(conn: &mut PgConnection, role: &str, database: &str) -> Vec<String> {
    let mut settings: Vec<String> = sqlx::query_scalar::<_, Vec<String>>(
        "SELECT s.setconfig FROM pg_catalog.pg_db_role_setting s JOIN pg_catalog.pg_roles r ON r.oid=s.setrole JOIN pg_catalog.pg_database d ON d.oid=s.setdatabase WHERE r.rolname=$1 AND d.datname=$2",
    )
    .bind(role)
    .bind(database)
    .fetch_optional(conn)
    .await
    .expect("read guarded role-in-database settings")
    .unwrap_or_default();
    settings.sort();
    settings
}

/// Callers capture errors and assert only after restoration. Unexpected panics
/// also restore the original setting before resuming their unwind.
pub async fn with_migration_default<F, Fut, T>(
    config: &Configuration,
    isolation: &str,
    operation: F,
) -> T
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = T>,
{
    assert!(matches!(isolation, "repeatable read" | "serializable"));
    let options = database_options(&config.migration).unwrap();
    let role = options.get_username();
    let database = options.get_database().unwrap();
    let mut admin = PgConnection::connect_with(&database_options(&config.admin).unwrap())
        .await
        .unwrap();
    config.guard_connection(&mut admin).await;
    let before = settings(&mut admin, role, database).await;
    let previous = before
        .iter()
        .find_map(|setting| setting.strip_prefix("default_transaction_isolation="));
    let target = format!(
        "ALTER ROLE \"{}\" IN DATABASE \"{}\"",
        role.replace('"', "\"\""),
        database.replace('"', "\"\"")
    );
    admin
        .execute(format!("{target} SET default_transaction_isolation = '{isolation}'").as_str())
        .await
        .unwrap();
    let result = AssertUnwindSafe(async { operation().await })
        .catch_unwind()
        .await;
    let restore = match previous {
        Some(value) => format!(
            "{target} SET default_transaction_isolation = '{}'",
            value.replace('\'', "''")
        ),
        None => format!("{target} RESET default_transaction_isolation"),
    };
    admin
        .execute(restore.as_str())
        .await
        .expect("restore original migration-role isolation default");
    assert_eq!(
        settings(&mut admin, role, database).await,
        before,
        "isolation test changed unrelated role-in-database settings"
    );
    admin.close().await.unwrap();
    match result {
        Ok(value) => value,
        Err(panic) => resume_unwind(panic),
    }
}
