//! PostgreSQL bootstrap adapter. Runtime validation never runs a migration.
use sqlx::{
    ConnectOptions, Connection, PgConnection, PgPool,
    postgres::{PgConnectOptions, PgPoolOptions},
};
use std::{str::FromStr, time::Duration};
use zobba_application::{BootstrapError, SchemaHealth};
use zobba_domain::{SCHEMA_VERSION, SchemaVersion};

const DATABASE_DEADLINE: Duration = Duration::from_secs(5);
const MIGRATION_DEADLINE: Duration = Duration::from_secs(10);
const MIGRATION_LOCK: i64 = 9_026_020_001;
static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("../../migrations");

/// Admit explicit TCP URLs only. Routing/identity/options query overrides could
/// silently select a different database or bypass a test's connection proxy.
pub fn database_options(value: &str) -> Result<PgConnectOptions, BootstrapError> {
    let url = url::Url::parse(value).map_err(|_| BootstrapError::InvalidConfiguration)?;
    if !matches!(url.scheme(), "postgres" | "postgresql")
        || url
            .host_str()
            .is_none_or(|host| host.is_empty() || host.contains('%'))
        || url.username().is_empty()
        || url.path().len() < 2
        || url.fragment().is_some()
        || url
            .query_pairs()
            .any(|(key, _)| !matches!(key.as_ref(), "sslmode" | "ssl-mode" | "application_name"))
        || std::env::var_os("PGOPTIONS").is_some()
    {
        return Err(BootstrapError::InvalidConfiguration);
    }
    Ok(PgConnectOptions::from_str(value)
        .map_err(|_| BootstrapError::InvalidConfiguration)?
        .disable_statement_logging()
        .options([
            ("statement_timeout", "4000"),
            ("lock_timeout", "4000"),
            ("search_path", "pg_catalog,public"),
        ]))
}

async fn connect(url: &str) -> Result<PgConnection, BootstrapError> {
    tokio::time::timeout(
        DATABASE_DEADLINE,
        PgConnection::connect_with(&database_options(url)?),
    )
    .await
    .map_err(|_| BootstrapError::DatabaseUnavailable)?
    .map_err(|_| BootstrapError::DatabaseUnavailable)
}

fn supported_postgres(version: i32) -> Result<(), BootstrapError> {
    if (180_000..190_000).contains(&version) {
        Ok(())
    } else {
        Err(BootstrapError::UnsupportedPostgres)
    }
}

async fn check_postgres(conn: &mut PgConnection) -> Result<(), BootstrapError> {
    let version: i32 =
        sqlx::query_scalar("SELECT pg_catalog.current_setting('server_version_num')::integer")
            .fetch_one(conn)
            .await
            .map_err(|_| BootstrapError::DatabaseUnavailable)?;
    supported_postgres(version)
}

/// Conservatively close membership paths over INHERIT, SET and ADMIN authority.
/// ADMIN can regrant membership options; mixed paths can expose inherited powers.
/// Used for live sessions and for a migration's target before and after grants.
async fn check_effective_role(
    conn: &mut PgConnection,
    role: &str,
    current_session: bool,
) -> Result<(), BootstrapError> {
    let unsafe_role: bool = sqlx::query_scalar(r#"
        WITH RECURSIVE target AS (SELECT oid, rolcanlogin FROM pg_catalog.pg_roles WHERE rolname=$1),
        authority(oid) AS (
          SELECT oid FROM target
          UNION
          SELECT m.roleid FROM pg_catalog.pg_auth_members m JOIN authority a ON m.member=a.oid
          WHERE m.inherit_option OR m.set_option OR m.admin_option
        ),
        reachable AS (SELECT r.* FROM pg_catalog.pg_roles r JOIN authority a ON r.oid=a.oid)
        SELECT NOT EXISTS (SELECT 1 FROM target WHERE rolcanlogin)
        OR ($2 AND (session_user <> current_user OR current_user::text <> $1))
        OR EXISTS (SELECT 1 FROM reachable r WHERE r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication
          OR r.rolname IN ('pg_read_server_files','pg_write_server_files','pg_execute_server_program',
            'pg_read_all_data','pg_write_all_data','pg_create_subscription','pg_maintain','pg_signal_backend','pg_checkpoint'))
        OR EXISTS (SELECT 1 FROM reachable r WHERE
          pg_catalog.has_database_privilege(r.oid,pg_catalog.current_database(),'CREATE')
          OR pg_catalog.has_schema_privilege(r.oid,'public','CREATE'))
        OR EXISTS (SELECT 1 FROM pg_catalog.pg_database d JOIN reachable r ON d.datdba=r.oid
          WHERE d.datname=pg_catalog.current_database())
        OR EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n JOIN reachable r ON n.nspowner=r.oid
          WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema')
        OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace, reachable r
          WHERE n.nspname='public' AND (c.relowner=r.oid OR (c.relkind IN ('r','p') AND (
            pg_catalog.has_table_privilege(r.oid,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
            OR pg_catalog.has_any_column_privilege(r.oid,c.oid,'INSERT,UPDATE,REFERENCES')))))
    "#).bind(role).bind(current_session).fetch_one(conn).await.map_err(|_| BootstrapError::DatabaseUnavailable)?;
    if unsafe_role {
        Err(BootstrapError::UnsafeRuntimeRole)
    } else {
        Ok(())
    }
}

async fn check_runtime_role(conn: &mut PgConnection) -> Result<(), BootstrapError> {
    let role: String = sqlx::query_scalar("SELECT current_user::text")
        .fetch_one(&mut *conn)
        .await
        .map_err(|_| BootstrapError::DatabaseUnavailable)?;
    check_effective_role(conn, &role, true).await
}

async fn inventory(conn: &mut PgConnection) -> Result<Vec<String>, BootstrapError> {
    let foreign: bool = sqlx::query_scalar(r#"
        SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname !~ '^pg_' AND nspname NOT IN ('public','information_schema'))
        OR EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname <> 'plpgsql')
        OR EXISTS (SELECT 1 FROM pg_catalog.pg_event_trigger)
        OR EXISTS (SELECT 1 FROM pg_catalog.pg_statistic_ext o JOIN pg_catalog.pg_namespace n ON n.oid=o.stxnamespace WHERE n.nspname='public')
        OR EXISTS (SELECT 1 FROM pg_catalog.pg_collation o JOIN pg_catalog.pg_namespace n ON n.oid=o.collnamespace WHERE n.nspname='public')
        OR EXISTS (SELECT 1 FROM pg_catalog.pg_operator o JOIN pg_catalog.pg_namespace n ON n.oid=o.oprnamespace WHERE n.nspname='public')
        OR EXISTS (SELECT 1 FROM pg_catalog.pg_opclass o JOIN pg_catalog.pg_namespace n ON n.oid=o.opcnamespace WHERE n.nspname='public')
        OR EXISTS (SELECT 1 FROM pg_catalog.pg_opfamily o JOIN pg_catalog.pg_namespace n ON n.oid=o.opfnamespace WHERE n.nspname='public')
        OR EXISTS (SELECT 1 FROM pg_catalog.pg_conversion o JOIN pg_catalog.pg_namespace n ON n.oid=o.connamespace WHERE n.nspname='public')
        OR EXISTS (SELECT 1 FROM pg_catalog.pg_ts_config o JOIN pg_catalog.pg_namespace n ON n.oid=o.cfgnamespace WHERE n.nspname='public')
        OR EXISTS (SELECT 1 FROM pg_catalog.pg_ts_dict o JOIN pg_catalog.pg_namespace n ON n.oid=o.dictnamespace WHERE n.nspname='public')
        OR EXISTS (SELECT 1 FROM pg_catalog.pg_ts_parser o JOIN pg_catalog.pg_namespace n ON n.oid=o.prsnamespace WHERE n.nspname='public')
        OR EXISTS (SELECT 1 FROM pg_catalog.pg_ts_template o JOIN pg_catalog.pg_namespace n ON n.oid=o.tmplnamespace WHERE n.nspname='public')
        OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public')
        OR EXISTS (
          SELECT 1 FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace
          WHERE n.nspname='public' AND t.oid NOT IN (
            SELECT c.reltype FROM pg_catalog.pg_class c WHERE c.relnamespace=n.oid AND c.relkind='r' AND c.relname IN ('_sqlx_migrations','zobba_bootstrap')
            UNION ALL SELECT rowtype.typarray FROM pg_catalog.pg_type rowtype JOIN pg_catalog.pg_class c ON c.reltype=rowtype.oid
              WHERE c.relnamespace=n.oid AND c.relkind='r' AND c.relname IN ('_sqlx_migrations','zobba_bootstrap')
          ))
    "#).fetch_one(&mut *conn).await.map_err(|_| BootstrapError::DatabaseUnavailable)?;
    if foreign {
        return Err(BootstrapError::SchemaMismatch);
    }
    // Three rows suffice to reject anything other than the two owned tables.
    sqlx::query_scalar("SELECT c.relname::text FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind <> 'i' ORDER BY c.relname LIMIT 3")
        .fetch_all(conn).await.map_err(|_| BootstrapError::DatabaseUnavailable)
}

async fn check_schema(conn: &mut PgConnection) -> Result<(), BootstrapError> {
    if inventory(conn).await? != ["_sqlx_migrations", "zobba_bootstrap"] {
        return Err(BootstrapError::SchemaMismatch);
    }
    // Validate physical structure before touching possibly foreign row values.
    type ColumnSignature = (String, String, String, bool, Option<String>, String, String);
    let columns: Vec<ColumnSignature> = sqlx::query_as(r#"
        SELECT c.relname::text,a.attname::text,pg_catalog.format_type(a.atttypid,a.atttypmod),a.attnotnull,
          pg_catalog.left(pg_catalog.pg_get_expr(d.adbin,d.adrelid),128),a.attidentity::text,a.attgenerated::text
        FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
        JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
        WHERE n.nspname='public' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped
        ORDER BY c.relname,a.attnum LIMIT 10
    "#).fetch_all(&mut *conn).await.map_err(|_| BootstrapError::SchemaMismatch)?;
    let expected = [
        ("_sqlx_migrations", "version", "bigint", None),
        ("_sqlx_migrations", "description", "text", None),
        (
            "_sqlx_migrations",
            "installed_on",
            "timestamp with time zone",
            Some("now()"),
        ),
        ("_sqlx_migrations", "success", "boolean", None),
        ("_sqlx_migrations", "checksum", "bytea", None),
        ("_sqlx_migrations", "execution_time", "bigint", None),
        ("zobba_bootstrap", "singleton", "boolean", Some("true")),
        ("zobba_bootstrap", "product", "text", None),
        ("zobba_bootstrap", "schema_version", "bigint", None),
    ];
    if columns.len() != expected.len()
        || columns.iter().zip(expected).any(
            |((table, column, kind, required, default, identity, generated), (et, ec, ek, ed))| {
                table != et
                    || column != ec
                    || kind != ek
                    || !required
                    || default.as_deref() != ed
                    || !identity.is_empty()
                    || !generated.is_empty()
            },
        )
    {
        return Err(BootstrapError::SchemaMismatch);
    }
    let constraints: Vec<(String,String)> = sqlx::query_as(r#"
        SELECT c.relname::text,pg_catalog.left(pg_catalog.pg_get_constraintdef(k.oid),512)
        FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON c.oid=k.conrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND k.contype <> 'n' ORDER BY c.relname,pg_catalog.pg_get_constraintdef(k.oid) LIMIT 6
    "#).fetch_all(&mut *conn).await.map_err(|_| BootstrapError::SchemaMismatch)?;
    let expected_constraints = [
        ("_sqlx_migrations", "PRIMARY KEY (version)"),
        ("zobba_bootstrap", "CHECK ((product = 'zobba'::text))"),
        ("zobba_bootstrap", "CHECK ((schema_version = 1))"),
        ("zobba_bootstrap", "CHECK (singleton)"),
        ("zobba_bootstrap", "PRIMARY KEY (singleton)"),
    ];
    if constraints.len() != expected_constraints.len()
        || constraints
            .iter()
            .zip(expected_constraints)
            .any(|((table, definition), (et, ed))| table != et || definition != ed)
    {
        return Err(BootstrapError::SchemaMismatch);
    }
    let altered_objects: bool = sqlx::query_scalar(r#"
        SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal)
        OR EXISTS (SELECT 1 FROM pg_catalog.pg_rewrite r JOIN pg_catalog.pg_class c ON c.oid=r.ev_class JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public')
        OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND (c.relpersistence <> 'p' OR c.relrowsecurity OR c.relforcerowsecurity))
        OR (SELECT pg_catalog.count(*) <> 2 FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public')
    "#).fetch_one(&mut *conn).await.map_err(|_| BootstrapError::SchemaMismatch)?;
    if altered_objects {
        return Err(BootstrapError::SchemaMismatch);
    }
    // Return fixed-width booleans, never arbitrary metadata text/blob contents.
    // LIMIT stops a forged oversized ledger/marker from allocating unbounded rows.
    let expected = MIGRATOR
        .iter()
        .next()
        .ok_or(BootstrapError::SchemaMismatch)?;
    let rows: Vec<(i64,bool,bool,bool)> = sqlx::query_as("SELECT version,description=$1,success,checksum=$2 FROM public._sqlx_migrations ORDER BY version LIMIT 2")
        .bind(expected.description.as_ref()).bind(expected.checksum.as_ref())
        .fetch_all(&mut *conn).await.map_err(|_| BootstrapError::SchemaMismatch)?;
    if rows != [(expected.version, true, true, true)] || MIGRATOR.iter().count() != 1 {
        return Err(BootstrapError::SchemaMismatch);
    }
    let marker: Vec<(bool, bool, i64)> = sqlx::query_as(
        "SELECT singleton,product='zobba',schema_version FROM public.zobba_bootstrap LIMIT 2",
    )
    .fetch_all(conn)
    .await
    .map_err(|_| BootstrapError::SchemaMismatch)?;
    if marker != [(true, true, i64::from(SCHEMA_VERSION.0))] {
        return Err(BootstrapError::SchemaMismatch);
    }
    Ok(())
}

#[derive(Clone)]
pub struct RuntimeDatabase {
    pool: PgPool,
}

impl RuntimeDatabase {
    pub async fn connect(url: &str) -> Result<Self, BootstrapError> {
        let pool = PgPoolOptions::new()
            .max_connections(4)
            .acquire_timeout(DATABASE_DEADLINE)
            .connect_with(database_options(url)?)
            .await
            .map_err(|_| BootstrapError::DatabaseUnavailable)?;
        let database = Self { pool };
        database.check().await?;
        Ok(database)
    }
}

impl SchemaHealth for RuntimeDatabase {
    async fn check(&self) -> Result<SchemaVersion, BootstrapError> {
        tokio::time::timeout(DATABASE_DEADLINE, async {
            let mut conn = self
                .pool
                .acquire()
                .await
                .map_err(|_| BootstrapError::DatabaseUnavailable)?;
            let mut tx = conn
                .begin()
                .await
                .map_err(|_| BootstrapError::DatabaseUnavailable)?;
            sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
                .execute(&mut *tx)
                .await
                .map_err(|_| BootstrapError::DatabaseUnavailable)?;
            check_postgres(&mut tx).await?;
            check_runtime_role(&mut tx).await?;
            check_schema(&mut tx).await?;
            tx.commit()
                .await
                .map_err(|_| BootstrapError::DatabaseUnavailable)?;
            Ok(SCHEMA_VERSION)
        })
        .await
        .map_err(|_| BootstrapError::DatabaseUnavailable)?
    }
}

pub fn valid_role_name(role: &str) -> bool {
    !role.is_empty()
        && role.len() <= 63
        && role
            .bytes()
            .enumerate()
            .all(|(i, c)| c == b'_' || c.is_ascii_lowercase() || (i > 0 && c.is_ascii_digit()))
}

pub async fn migrate(url: &str, runtime_role: &str) -> Result<(), BootstrapError> {
    if !valid_role_name(runtime_role) {
        return Err(BootstrapError::InvalidConfiguration);
    }
    // Cancellation drops the dedicated connection; PostgreSQL rolls back its
    // transaction and releases its lock, even if a post-connect reply blackholes.
    tokio::time::timeout(MIGRATION_DEADLINE, async {
        let mut conn = connect(url).await?;
        check_postgres(&mut conn).await?;
        sqlx::query("SELECT pg_catalog.pg_advisory_lock($1)")
            .bind(MIGRATION_LOCK)
            .execute(&mut conn)
            .await
            .map_err(|_| BootstrapError::MigrationFailed)?;
        let result = migrate_locked(&mut conn, runtime_role).await;
        let _ = conn.close().await;
        result
    })
    .await
    .map_err(|_| BootstrapError::DatabaseUnavailable)?
}

async fn migrate_locked(conn: &mut PgConnection, runtime_role: &str) -> Result<(), BootstrapError> {
    check_effective_role(conn, runtime_role, false).await?;
    if !inventory(conn).await?.is_empty() {
        check_schema(conn).await?;
    }
    // SQLx creates its ledger before its per-migration transaction. An enclosing
    // transaction makes ledger, bootstrap, grants and validation one atomic unit.
    let mut tx = conn
        .begin()
        .await
        .map_err(|_| BootstrapError::MigrationFailed)?;
    // Omit pg_catalog here: PostgreSQL implicitly searches it FIRST, while DDL's
    // creation namespace is public. All our preflight catalog references qualify it.
    sqlx::query("SET LOCAL search_path=public")
        .execute(&mut *tx)
        .await
        .map_err(|_| BootstrapError::MigrationFailed)?;
    let mut migrator = sqlx::migrate!("../../migrations");
    migrator.set_locking(false);
    migrator
        .run(&mut *tx)
        .await
        .map_err(|_| BootstrapError::MigrationFailed)?;
    sqlx::query("SET LOCAL search_path=pg_catalog,public")
        .execute(&mut *tx)
        .await
        .map_err(|_| BootstrapError::MigrationFailed)?;
    let grants = format!(
        "REVOKE CREATE ON SCHEMA public FROM PUBLIC; REVOKE ALL ON public._sqlx_migrations FROM PUBLIC; GRANT USAGE ON SCHEMA public TO \"{runtime_role}\"; GRANT SELECT ON public.zobba_bootstrap,public._sqlx_migrations TO \"{runtime_role}\";"
    );
    sqlx::raw_sql(&grants)
        .execute(&mut *tx)
        .await
        .map_err(|_| BootstrapError::MigrationFailed)?;
    check_effective_role(&mut tx, runtime_role, false).await?;
    check_schema(&mut tx).await?;
    tx.commit()
        .await
        .map_err(|_| BootstrapError::MigrationFailed)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn supports_only_postgres_18() {
        assert_eq!(
            supported_postgres(179_999),
            Err(BootstrapError::UnsupportedPostgres)
        );
        assert!(supported_postgres(180_000).is_ok());
        assert!(supported_postgres(180_004).is_ok());
        assert_eq!(
            supported_postgres(190_000),
            Err(BootstrapError::UnsupportedPostgres)
        );
    }
    #[test]
    fn interpolated_role_is_a_bounded_identifier() {
        assert!(valid_role_name("zobba_app"));
        for role in [
            "",
            "1role",
            "role-name",
            "role; DROP TABLE anything",
            "role\"",
            "PUBLIC",
        ] {
            assert!(!valid_role_name(role));
        }
        assert!(!valid_role_name(&"x".repeat(64)));
    }
    #[test]
    fn rejects_implicit_or_overridden_database_identity() {
        for value in [
            "postgres://localhost/db",
            "postgres://role@localhost/",
            "postgres://role@localhost/db?host=other",
            "postgres://role@localhost/db?port=1",
            "postgres://role@localhost/db?dbname=other",
            "postgres://role@localhost/db?user=owner",
            "postgres://role@localhost/db?options=-crole=owner",
        ] {
            assert!(database_options(value).is_err());
        }
    }
}
