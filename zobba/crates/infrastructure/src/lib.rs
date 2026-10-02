//! PostgreSQL bootstrap adapter. Runtime validation never runs a migration.
pub mod conversation;
pub mod dispatcher;
pub mod evidence;
pub mod fixture;
pub mod identity;
pub mod membership;
pub mod methodology;
pub mod oidc;
pub mod operation;
pub mod scope;
pub mod skills;
pub mod task;
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
            pg_catalog.has_table_privilege(r.oid,c.oid,'TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
            OR (c.relname NOT IN ('login_attempts','sessions','task_counters','tasks','task_cycles','task_commands','task_events','task_wakeups','task_claims','task_receipt_slots','task_observations','permission_versions','permission_heads','operations','operation_decisions','operation_attempts','operation_claims','operation_receipt_slots','operation_receipts','operation_receipt_producers','evidence_reservations','evidence_originals') AND pg_catalog.has_table_privilege(r.oid,c.oid,'INSERT'))
            OR (c.relname NOT IN ('login_attempts','sessions') AND pg_catalog.has_table_privilege(r.oid,c.oid,'DELETE'))
            OR pg_catalog.has_table_privilege(r.oid,c.oid,'UPDATE')
            OR (c.relname IN ('task_wakeups','task_deliveries','membership_events','membership_invitations','membership_versions','methodology_versions','methodology_assignments','methodology_events','methodology_recalls','task_methodology_bindings','task_methodology_heads','task_methodology_changes','skill_versions','skill_events','skill_status','task_skill_selections') AND pg_catalog.has_table_privilege(r.oid,c.oid,'SELECT'))
            OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped AND (
              pg_catalog.has_column_privilege(r.oid,c.oid,a.attnum,'REFERENCES')
              OR (c.relname IN ('membership_events','membership_invitations','membership_versions','methodology_versions','methodology_assignments','methodology_events','methodology_recalls','task_methodology_bindings','task_methodology_heads','task_methodology_changes','skill_versions','skill_events','skill_status','task_skill_selections') AND pg_catalog.has_column_privilege(r.oid,c.oid,a.attnum,'SELECT'))
              OR (NOT (c.relname IN ('login_attempts','sessions','task_counters','tasks','task_cycles','task_commands','task_events','task_wakeups','task_claims','task_receipt_slots','task_observations','permission_versions','permission_heads','operations','operation_decisions','operation_attempts','operation_claims','operation_receipt_slots','operation_receipts','operation_receipt_producers','evidence_reservations','evidence_originals') OR (c.relname='identities' AND a.attname IN ('id','issuer','subject','display_name')) OR (c.relname='task_deliveries' AND a.attname='wakeup_id')) AND pg_catalog.has_column_privilege(r.oid,c.oid,a.attnum,'INSERT'))
              OR (NOT ((c.relname IN ('identities','engagements') AND a.attname IN ('display_name','name')) OR (c.relname='task_counters' AND a.attname='cursor') OR (c.relname='tasks' AND a.attname IN ('cycle_id','working_brief','state','cessation','intent_revision','applied_intent','applied_command_cursor','revision','execution_epoch','owner_id','owner_until','owner_epoch')) OR (c.relname='task_cycles' AND a.attname='status') OR (c.relname='task_claims' AND a.attname='state') OR (c.relname='permission_heads' AND a.attname='current_version') OR (c.relname='operation_claims' AND a.attname IN ('state','consumed_at')) OR (c.relname='task_wakeups' AND a.attname IN ('pending','available_at')) OR (c.relname='task_deliveries' AND a.attname IN ('delivery_owner','delivery_until'))) AND pg_catalog.has_column_privilege(r.oid,c.oid,a.attnum,'UPDATE'))
            ))))))
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

async fn check_runtime_grants(conn: &mut PgConnection, role: &str) -> Result<(), BootstrapError> {
    let complete: bool = sqlx::query_scalar(r#"
      SELECT (SELECT pg_catalog.bool_and(pg_catalog.has_table_privilege($1,c.oid,'SELECT'))
        FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relname NOT IN ('task_wakeups','task_deliveries','membership_events','membership_invitations','membership_versions','methodology_versions','methodology_assignments','methodology_events','methodology_recalls','task_methodology_bindings','task_methodology_heads','task_methodology_changes','skill_versions','skill_events','skill_status','task_skill_selections'))
        AND pg_catalog.has_table_privilege($1,'public.evidence_reservations','INSERT')
        AND pg_catalog.has_table_privilege($1,'public.evidence_originals','INSERT')
        AND pg_catalog.has_table_privilege($1,'public.login_attempts','INSERT')
        AND pg_catalog.has_table_privilege($1,'public.login_attempts','DELETE')
        AND pg_catalog.has_table_privilege($1,'public.sessions','INSERT')
        AND pg_catalog.has_table_privilege($1,'public.sessions','DELETE')
        AND pg_catalog.has_column_privilege($1,'public.identities','id','INSERT')
        AND pg_catalog.has_column_privilege($1,'public.identities','issuer','INSERT')
        AND pg_catalog.has_column_privilege($1,'public.identities','subject','INSERT')
        AND pg_catalog.has_column_privilege($1,'public.identities','display_name','INSERT')
        AND pg_catalog.has_column_privilege($1,'public.identities','display_name','UPDATE')
        AND pg_catalog.has_column_privilege($1,'public.engagements','name','UPDATE')
        AND pg_catalog.has_table_privilege($1,'public.task_counters','INSERT')
        AND pg_catalog.has_table_privilege($1,'public.tasks','INSERT')
        AND pg_catalog.has_table_privilege($1,'public.task_cycles','INSERT')
        AND pg_catalog.has_table_privilege($1,'public.task_commands','INSERT')
        AND pg_catalog.has_table_privilege($1,'public.task_events','INSERT')
        AND pg_catalog.has_table_privilege($1,'public.task_wakeups','INSERT')
        AND pg_catalog.has_column_privilege($1,'public.task_wakeups','id','SELECT')
        AND pg_catalog.has_column_privilege($1,'public.task_wakeups','actor_id','SELECT')
        AND pg_catalog.has_column_privilege($1,'public.task_wakeups','organisation_id','SELECT')
        AND pg_catalog.has_column_privilege($1,'public.task_wakeups','client_id','SELECT')
        AND pg_catalog.has_column_privilege($1,'public.task_wakeups','engagement_id','SELECT')
        AND pg_catalog.has_column_privilege($1,'public.task_wakeups','task_id','SELECT')
        AND pg_catalog.has_column_privilege($1,'public.task_wakeups','pending','SELECT')
        AND pg_catalog.has_column_privilege($1,'public.task_wakeups','available_at','SELECT')
        AND pg_catalog.has_column_privilege($1,'public.task_deliveries','wakeup_id','SELECT')
        AND pg_catalog.has_column_privilege($1,'public.task_deliveries','wakeup_id','INSERT')
        AND pg_catalog.has_column_privilege($1,'public.task_deliveries','delivery_owner','SELECT')
        AND pg_catalog.has_column_privilege($1,'public.task_deliveries','delivery_until','SELECT')
        AND pg_catalog.has_table_privilege($1,'public.task_claims','INSERT')
        AND pg_catalog.has_table_privilege($1,'public.task_receipt_slots','INSERT')
        AND pg_catalog.has_table_privilege($1,'public.task_observations','INSERT')
        AND pg_catalog.has_table_privilege($1,'public.permission_versions','INSERT')
        AND pg_catalog.has_table_privilege($1,'public.permission_heads','INSERT')
        AND pg_catalog.has_table_privilege($1,'public.operations','INSERT')
        AND pg_catalog.has_table_privilege($1,'public.operation_decisions','INSERT')
        AND pg_catalog.has_table_privilege($1,'public.operation_attempts','INSERT')
        AND pg_catalog.has_table_privilege($1,'public.operation_claims','INSERT')
        AND pg_catalog.has_table_privilege($1,'public.operation_receipt_slots','INSERT')
        AND pg_catalog.has_table_privilege($1,'public.operation_receipt_producers','INSERT')
        AND pg_catalog.has_table_privilege($1,'public.operation_receipts','INSERT')
        AND pg_catalog.has_column_privilege($1,'public.permission_heads','current_version','UPDATE')
        AND pg_catalog.has_column_privilege($1,'public.operation_claims','state','UPDATE')
        AND pg_catalog.has_column_privilege($1,'public.operation_claims','consumed_at','UPDATE')
        AND pg_catalog.has_column_privilege($1,'public.task_counters','cursor','UPDATE')
        AND pg_catalog.has_column_privilege($1,'public.tasks','cycle_id','UPDATE')
        AND pg_catalog.has_column_privilege($1,'public.tasks','working_brief','UPDATE')
        AND pg_catalog.has_column_privilege($1,'public.tasks','state','UPDATE')
        AND pg_catalog.has_column_privilege($1,'public.tasks','cessation','UPDATE')
        AND pg_catalog.has_column_privilege($1,'public.tasks','intent_revision','UPDATE')
        AND pg_catalog.has_column_privilege($1,'public.tasks','applied_intent','UPDATE')
        AND pg_catalog.has_column_privilege($1,'public.tasks','applied_command_cursor','UPDATE')
        AND pg_catalog.has_column_privilege($1,'public.tasks','revision','UPDATE')
        AND pg_catalog.has_column_privilege($1,'public.tasks','execution_epoch','UPDATE')
        AND pg_catalog.has_column_privilege($1,'public.tasks','owner_id','UPDATE')
        AND pg_catalog.has_column_privilege($1,'public.tasks','owner_until','UPDATE')
        AND pg_catalog.has_column_privilege($1,'public.tasks','owner_epoch','UPDATE')
        AND pg_catalog.has_column_privilege($1,'public.task_cycles','status','UPDATE')
        AND pg_catalog.has_column_privilege($1,'public.task_claims','state','UPDATE')
        AND pg_catalog.has_column_privilege($1,'public.task_wakeups','pending','UPDATE')
        AND pg_catalog.has_column_privilege($1,'public.task_wakeups','available_at','UPDATE')
        AND pg_catalog.has_column_privilege($1,'public.task_deliveries','delivery_owner','UPDATE')
        AND pg_catalog.has_column_privilege($1,'public.task_deliveries','delivery_until','UPDATE')
    "#).bind(role).fetch_one(&mut *conn).await.map_err(|_| BootstrapError::UnsafeRuntimeRole)?;
    check_membership_functions(conn, Some(role)).await?;
    check_evidence_functions(conn, Some(role)).await?;
    check_continuity_functions(conn, Some(role)).await?;
    check_methodology_functions(conn, Some(role)).await?;
    check_skills_functions(conn, Some(role)).await?;
    if complete {
        Ok(())
    } else {
        Err(BootstrapError::UnsafeRuntimeRole)
    }
}

async fn check_membership_functions(
    conn: &mut PgConnection,
    runtime: Option<&str>,
) -> Result<(), BootstrapError> {
    let safe: bool = sqlx::query_scalar(r#"
      SELECT count(*)=9 AND bool_and(
        p.proowner=(SELECT relowner FROM pg_catalog.pg_class WHERE oid='public.zobba_bootstrap'::regclass)
        AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a WHERE a.grantee=0 OR (a.grantee<>p.proowner AND (a.privilege_type<>'EXECUTE' OR a.is_grantable OR p.proname NOT IN ('membership_read','membership_write','membership_accept','membership_preview','membership_assignments') OR ($1::text IS NOT NULL AND a.grantee<>(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=$1)))))
        AND ($1::text IS NULL OR CASE WHEN p.proname IN ('membership_read','membership_write','membership_accept','membership_preview','membership_assignments') THEN pg_catalog.has_function_privilege($1,p.oid,'EXECUTE') ELSE NOT pg_catalog.has_function_privilege($1,p.oid,'EXECUTE') END)
      ) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('membership_admin','membership_session','membership_validate','membership_fence','membership_read','membership_write','membership_accept','membership_preview','membership_assignments')
    "#).bind(runtime).fetch_one(conn).await.map_err(|_| BootstrapError::SchemaMismatch)?;
    if safe {
        Ok(())
    } else {
        Err(BootstrapError::SchemaMismatch)
    }
}

async fn check_evidence_functions(
    conn: &mut PgConnection,
    runtime: Option<&str>,
) -> Result<(), BootstrapError> {
    let safe:bool=sqlx::query_scalar(r#"SELECT count(*)=1 AND bool_and(p.prosecdef AND p.proowner=(SELECT relowner FROM pg_catalog.pg_class WHERE oid='public.zobba_bootstrap'::regclass)
 AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a WHERE a.grantee=0 OR (a.grantee<>p.proowner AND (a.privilege_type<>'EXECUTE' OR a.is_grantable OR ($1::text IS NOT NULL AND a.grantee<>(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=$1)))))
 AND ($1::text IS NULL OR pg_catalog.has_function_privilege($1,p.oid,'EXECUTE'))) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='evidence_session_locked'"#).bind(runtime).fetch_one(conn).await.map_err(|_|BootstrapError::SchemaMismatch)?;
    if safe {
        Ok(())
    } else {
        Err(BootstrapError::UnsafeRuntimeRole)
    }
}

// These helpers are trigger-only owner authority, never runtime entry points.
async fn check_continuity_functions(
    conn: &mut PgConnection,
    runtime: Option<&str>,
) -> Result<(), BootstrapError> {
    let safe: bool = sqlx::query_scalar(r#"
      SELECT count(*)=4 AND bool_and(p.prosecdef
       AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid IN ('public.organisations'::regclass,'public.organisation_memberships'::regclass,'public.identities'::regclass) AND c.relowner<>p.proowner)
       AND p.proowner=(SELECT relowner FROM pg_catalog.pg_class WHERE oid='public.zobba_bootstrap'::regclass)
       AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a WHERE a.grantee<>p.proowner)
       AND ($1::text IS NULL OR NOT pg_catalog.has_function_privilege($1,p.oid,'EXECUTE')))
      FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN ('admin_continuity_assert','admin_continuity_lock','admin_continuity_check','admin_continuity_truncate')
    "#).bind(runtime).fetch_one(conn).await.map_err(|_| BootstrapError::SchemaMismatch)?;
    if safe {
        Ok(())
    } else {
        Err(BootstrapError::SchemaMismatch)
    }
}

async fn check_methodology_functions(
    conn: &mut PgConnection,
    runtime: Option<&str>,
) -> Result<(), BootstrapError> {
    let safe: bool = sqlx::query_scalar(r#"
      SELECT count(*)=5 AND bool_and(
       p.proowner=(SELECT relowner FROM pg_catalog.pg_class WHERE oid='public.zobba_bootstrap'::regclass)
       AND (p.proname='methodology_audit' OR p.prosecdef)
       AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a WHERE a.grantee=0 OR (a.grantee<>p.proowner AND (p.proname='methodology_audit' OR a.privilege_type<>'EXECUTE' OR a.is_grantable OR ($1::text IS NOT NULL AND a.grantee<>(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=$1)))))
       AND ($1::text IS NULL OR CASE WHEN p.proname='methodology_audit' THEN NOT pg_catalog.has_function_privilege($1,p.oid,'EXECUTE') ELSE pg_catalog.has_function_privilege($1,p.oid,'EXECUTE') END))
      FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN ('methodology_audit','methodology_read','methodology_write','methodology_candidates','methodology_task')
    "#).bind(runtime).fetch_one(conn).await.map_err(|_| BootstrapError::SchemaMismatch)?;
    if safe {
        Ok(())
    } else {
        Err(BootstrapError::SchemaMismatch)
    }
}

async fn check_skills_functions(
    conn: &mut PgConnection,
    runtime: Option<&str>,
) -> Result<(), BootstrapError> {
    let safe: bool = sqlx::query_scalar(r#"
      SELECT count(*)=5 AND bool_and(p.prosecdef
       AND p.proowner=(SELECT relowner FROM pg_catalog.pg_class WHERE oid='public.zobba_bootstrap'::regclass)
       AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a WHERE a.grantee=0 OR (a.grantee<>p.proowner AND (a.privilege_type<>'EXECUTE' OR a.is_grantable OR ($1::text IS NOT NULL AND a.grantee<>(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=$1)))))
       AND ($1::text IS NULL OR pg_catalog.has_function_privilege($1,p.oid,'EXECUTE')))
      FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN ('skills_read','skills_admin','skills_impact','skills_write','skills_task')
    "#).bind(runtime).fetch_one(conn).await.map_err(|_| BootstrapError::SchemaMismatch)?;
    if safe {
        Ok(())
    } else {
        Err(BootstrapError::SchemaMismatch)
    }
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
        OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname NOT IN ('membership_admin','membership_session','membership_validate','membership_fence','membership_read','membership_write','membership_accept','membership_preview','membership_assignments','evidence_session_locked','admin_continuity_assert','admin_continuity_lock','admin_continuity_check','admin_continuity_truncate','methodology_audit','methodology_read','methodology_write','methodology_candidates','methodology_task','skills_read','skills_admin','skills_impact','skills_write','skills_task'))
        OR EXISTS (
          SELECT 1 FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace
          WHERE n.nspname='public' AND t.oid NOT IN (
            SELECT c.reltype FROM pg_catalog.pg_class c WHERE c.relnamespace=n.oid AND c.relkind='r' AND c.relname IN ('_sqlx_migrations','zobba_bootstrap','identities','login_attempts','sessions','organisations','clients','engagements','organisation_memberships','engagement_assignments','task_counters','tasks','task_cycles','task_commands','task_events','task_wakeups','task_claims','task_receipt_slots','task_observations','trusted_attachment_metadata','task_deliveries','permission_versions','permission_heads','operations','operation_decisions','operation_attempts','operation_claims','operation_receipt_slots','operation_receipts','operation_receipt_producers','membership_events','membership_invitations','membership_versions','evidence_reservations','evidence_originals','methodology_versions','methodology_assignments','methodology_events','methodology_recalls','task_methodology_bindings','task_methodology_heads','task_methodology_changes','skill_versions','skill_events','skill_status','task_skill_selections')
            UNION ALL SELECT rowtype.typarray FROM pg_catalog.pg_type rowtype JOIN pg_catalog.pg_class c ON c.reltype=rowtype.oid
              WHERE c.relnamespace=n.oid AND c.relkind='r' AND c.relname IN ('_sqlx_migrations','zobba_bootstrap','identities','login_attempts','sessions','organisations','clients','engagements','organisation_memberships','engagement_assignments','task_counters','tasks','task_cycles','task_commands','task_events','task_wakeups','task_claims','task_receipt_slots','task_observations','trusted_attachment_metadata','task_deliveries','permission_versions','permission_heads','operations','operation_decisions','operation_attempts','operation_claims','operation_receipt_slots','operation_receipts','operation_receipt_producers','membership_events','membership_invitations','membership_versions','evidence_reservations','evidence_originals','methodology_versions','methodology_assignments','methodology_events','methodology_recalls','task_methodology_bindings','task_methodology_heads','task_methodology_changes','skill_versions','skill_events','skill_status','task_skill_selections')
          ))
    "#).fetch_one(&mut *conn).await.map_err(|_| BootstrapError::DatabaseUnavailable)?;
    if foreign {
        return Err(BootstrapError::SchemaMismatch);
    }
    // Bound inventory independently of attacker-controlled catalog size.
    sqlx::query_scalar("SELECT c.relname::text FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind <> 'i' ORDER BY c.relname LIMIT 65")
        .fetch_all(conn).await.map_err(|_| BootstrapError::DatabaseUnavailable)
}

/// The checked-in catalog signatures were captured from the owned migrations on
/// PostgreSQL 18, and include physical columns, checks/FKs, indexes and RLS policies.
/// Catalogs are inspected before any table values; no foreign view/function runs.
async fn check_schema(
    conn: &mut PgConnection,
    allow_previous: bool,
) -> Result<i64, BootstrapError> {
    let tables = inventory(conn).await?;
    let mut version = if tables
        == [
            "_sqlx_migrations",
            "clients",
            "engagement_assignments",
            "engagements",
            "evidence_originals",
            "evidence_reservations",
            "identities",
            "login_attempts",
            "membership_events",
            "membership_invitations",
            "membership_versions",
            "methodology_assignments",
            "methodology_events",
            "methodology_recalls",
            "methodology_versions",
            "operation_attempts",
            "operation_claims",
            "operation_decisions",
            "operation_receipt_producers",
            "operation_receipt_slots",
            "operation_receipts",
            "operations",
            "organisation_memberships",
            "organisations",
            "permission_heads",
            "permission_versions",
            "sessions",
            "skill_events",
            "skill_status",
            "skill_versions",
            "task_claims",
            "task_commands",
            "task_counters",
            "task_cycles",
            "task_deliveries",
            "task_events",
            "task_methodology_bindings",
            "task_methodology_changes",
            "task_methodology_heads",
            "task_observations",
            "task_receipt_slots",
            "task_skill_selections",
            "task_wakeups",
            "tasks",
            "trusted_attachment_metadata",
            "zobba_bootstrap",
        ] {
        9
    } else if tables
        == [
            "_sqlx_migrations",
            "clients",
            "engagement_assignments",
            "engagements",
            "evidence_originals",
            "evidence_reservations",
            "identities",
            "login_attempts",
            "membership_events",
            "membership_invitations",
            "membership_versions",
            "methodology_assignments",
            "methodology_events",
            "methodology_recalls",
            "methodology_versions",
            "operation_attempts",
            "operation_claims",
            "operation_decisions",
            "operation_receipt_producers",
            "operation_receipt_slots",
            "operation_receipts",
            "operations",
            "organisation_memberships",
            "organisations",
            "permission_heads",
            "permission_versions",
            "sessions",
            "task_claims",
            "task_commands",
            "task_counters",
            "task_cycles",
            "task_deliveries",
            "task_events",
            "task_methodology_bindings",
            "task_methodology_changes",
            "task_methodology_heads",
            "task_observations",
            "task_receipt_slots",
            "task_wakeups",
            "tasks",
            "trusted_attachment_metadata",
            "zobba_bootstrap",
        ]
    {
        8
    } else if tables == ["_sqlx_migrations", "zobba_bootstrap"] {
        1
    } else if tables
        == [
            "_sqlx_migrations",
            "clients",
            "engagement_assignments",
            "engagements",
            "identities",
            "login_attempts",
            "organisation_memberships",
            "organisations",
            "sessions",
            "zobba_bootstrap",
        ]
    {
        2
    } else if tables
        == [
            "_sqlx_migrations",
            "clients",
            "engagement_assignments",
            "engagements",
            "identities",
            "login_attempts",
            "organisation_memberships",
            "organisations",
            "sessions",
            "task_claims",
            "task_commands",
            "task_counters",
            "task_cycles",
            "task_deliveries",
            "task_events",
            "task_observations",
            "task_receipt_slots",
            "task_wakeups",
            "tasks",
            "zobba_bootstrap",
        ]
    {
        3
    } else if tables
        == [
            "_sqlx_migrations",
            "clients",
            "engagement_assignments",
            "engagements",
            "identities",
            "login_attempts",
            "operation_attempts",
            "operation_claims",
            "operation_decisions",
            "operation_receipt_producers",
            "operation_receipt_slots",
            "operation_receipts",
            "operations",
            "organisation_memberships",
            "organisations",
            "permission_heads",
            "permission_versions",
            "sessions",
            "task_claims",
            "task_commands",
            "task_counters",
            "task_cycles",
            "task_deliveries",
            "task_events",
            "task_observations",
            "task_receipt_slots",
            "task_wakeups",
            "tasks",
            "trusted_attachment_metadata",
            "zobba_bootstrap",
        ]
    {
        4
    } else if tables
        == [
            "_sqlx_migrations",
            "clients",
            "engagement_assignments",
            "engagements",
            "identities",
            "login_attempts",
            "membership_events",
            "membership_invitations",
            "membership_versions",
            "operation_attempts",
            "operation_claims",
            "operation_decisions",
            "operation_receipt_producers",
            "operation_receipt_slots",
            "operation_receipts",
            "operations",
            "organisation_memberships",
            "organisations",
            "permission_heads",
            "permission_versions",
            "sessions",
            "task_claims",
            "task_commands",
            "task_counters",
            "task_cycles",
            "task_deliveries",
            "task_events",
            "task_observations",
            "task_receipt_slots",
            "task_wakeups",
            "tasks",
            "trusted_attachment_metadata",
            "zobba_bootstrap",
        ]
    {
        5
    } else if tables
        == [
            "_sqlx_migrations",
            "clients",
            "engagement_assignments",
            "engagements",
            "evidence_originals",
            "evidence_reservations",
            "identities",
            "login_attempts",
            "membership_events",
            "membership_invitations",
            "membership_versions",
            "operation_attempts",
            "operation_claims",
            "operation_decisions",
            "operation_receipt_producers",
            "operation_receipt_slots",
            "operation_receipts",
            "operations",
            "organisation_memberships",
            "organisations",
            "permission_heads",
            "permission_versions",
            "sessions",
            "task_claims",
            "task_commands",
            "task_counters",
            "task_cycles",
            "task_deliveries",
            "task_events",
            "task_observations",
            "task_receipt_slots",
            "task_wakeups",
            "tasks",
            "trusted_attachment_metadata",
            "zobba_bootstrap",
        ]
    {
        6
    } else {
        return Err(BootstrapError::SchemaMismatch);
    };
    let altered_objects: bool = sqlx::query_scalar(r#"
        SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND t.tgenabled <> 'O')
        OR EXISTS (SELECT 1 FROM pg_catalog.pg_rewrite r JOIN pg_catalog.pg_class c ON c.oid=r.ev_class JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public')
    "#).fetch_one(&mut *conn).await.map_err(|_| BootstrapError::SchemaMismatch)?;
    if altered_objects {
        return Err(BootstrapError::SchemaMismatch);
    }
    let signature: Vec<String> = sqlx::query_scalar(include_str!("catalog-signature.sql"))
        .fetch_all(&mut *conn)
        .await
        .map_err(|_| BootstrapError::SchemaMismatch)?;
    // Versions 6 and 7 have identical tables. Recognize revision 7 only by
    // its exact catalog, before reading any public table or invoking a function.
    if version == 6
        && signature
            .iter()
            .map(String::as_str)
            .eq(include_str!("schema-v7.catalog").lines())
    {
        version = 7;
    }
    let expected = if version == 1 {
        include_str!("schema-v1.catalog")
    } else if version == 2 {
        include_str!("schema-v2.catalog")
    } else if version == 3 {
        include_str!("schema-v3.catalog")
    } else if version == 4 {
        include_str!("schema-v4.catalog")
    } else if version == 5 {
        include_str!("schema-v5.catalog")
    } else if version == 6 {
        include_str!("schema-v6.catalog")
    } else if version == 7 {
        include_str!("schema-v7.catalog")
    } else if version == 8 {
        include_str!("schema-v8.catalog")
    } else {
        include_str!("schema-v9.catalog")
    };
    if signature.len() >= 4097 || !signature.iter().map(String::as_str).eq(expected.lines()) {
        return Err(BootstrapError::SchemaMismatch);
    }
    if version >= 5 {
        check_membership_functions(conn, None).await?;
    }
    if version >= 6 {
        check_evidence_functions(conn, None).await?;
    }
    if version >= 7 {
        check_continuity_functions(conn, None).await?;
    }
    if version >= 8 {
        check_methodology_functions(conn, None).await?;
    }
    if version >= 9 {
        check_skills_functions(conn, None).await?;
    }
    // Compare bounded booleans, never allocate untrusted metadata strings/blobs.
    let versions: Vec<i64> =
        sqlx::query_scalar("SELECT version FROM public._sqlx_migrations ORDER BY version LIMIT 10")
            .fetch_all(&mut *conn)
            .await
            .map_err(|_| BootstrapError::SchemaMismatch)?;
    if versions != (1..=version).collect::<Vec<_>>()
        || (!allow_previous && version != i64::from(SCHEMA_VERSION.0))
    {
        return Err(BootstrapError::SchemaMismatch);
    }
    for migration in MIGRATOR.iter().take(version as usize) {
        let verified: bool = sqlx::query_scalar("SELECT description=$1 AND success AND checksum=$2 FROM public._sqlx_migrations WHERE version=$3")
            .bind(migration.description.as_ref()).bind(migration.checksum.as_ref()).bind(migration.version)
            .fetch_one(&mut *conn).await.map_err(|_| BootstrapError::SchemaMismatch)?;
        if !verified {
            return Err(BootstrapError::SchemaMismatch);
        }
    }
    let marker: Vec<(bool, bool, i64)> = sqlx::query_as(
        "SELECT singleton,product='zobba',schema_version FROM public.zobba_bootstrap LIMIT 2",
    )
    .fetch_all(conn)
    .await
    .map_err(|_| BootstrapError::SchemaMismatch)?;
    if marker != [(true, true, version)] {
        return Err(BootstrapError::SchemaMismatch);
    }
    Ok(version)
}

#[derive(Clone)]
pub struct RuntimeDatabase {
    pool: PgPool,
}

impl RuntimeDatabase {
    pub fn pool(&self) -> &PgPool {
        &self.pool
    }

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
            check_schema(&mut tx, false).await?;
            let role: String = sqlx::query_scalar("SELECT current_user::text")
                .fetch_one(&mut *tx)
                .await
                .map_err(|_| BootstrapError::DatabaseUnavailable)?;
            check_runtime_grants(&mut tx, &role).await?;
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

fn migration_error(error: sqlx::migrate::MigrateError) -> BootstrapError {
    let sqlx::migrate::MigrateError::ExecuteMigration(sqlx::Error::Database(database), _) = error
    else {
        return BootstrapError::MigrationFailed;
    };
    if database.code().as_deref() == Some("23514")
        && matches!(
            database.constraint(),
            Some("organisation_memberships_expiry_range" | "engagement_assignments_expiry_range")
        )
    {
        BootstrapError::MembershipExpiryOutOfRange
    } else if database.code().as_deref() == Some("Z0007") {
        BootstrapError::AdminContinuityRequired
    } else {
        BootstrapError::MigrationFailed
    }
}

async fn migrate_locked(conn: &mut PgConnection, runtime_role: &str) -> Result<(), BootstrapError> {
    check_effective_role(conn, runtime_role, false).await?;
    if !inventory(conn).await?.is_empty() {
        check_schema(conn, true).await?;
    }
    // SQLx creates its ledger before its per-migration transaction. An enclosing
    // transaction makes ledger, bootstrap, grants and validation one atomic unit.
    let mut tx = conn
        .begin()
        .await
        .map_err(|_| BootstrapError::MigrationFailed)?;
    // An operator's role/database default must not leave upgrade preflight on a
    // stale snapshot after it waits for the authority-table write locks.
    sqlx::query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED")
        .execute(&mut *tx)
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
    migrator.run(&mut *tx).await.map_err(migration_error)?;
    sqlx::query("SET LOCAL search_path=pg_catalog,public")
        .execute(&mut *tx)
        .await
        .map_err(|_| BootstrapError::MigrationFailed)?;
    let grants = format!(
        "REVOKE CREATE ON SCHEMA public FROM PUBLIC; REVOKE ALL ON public._sqlx_migrations FROM PUBLIC; GRANT USAGE ON SCHEMA public TO \"{runtime_role}\"; GRANT SELECT ON public.zobba_bootstrap,public._sqlx_migrations TO \"{runtime_role}\";"
    );
    let grants = format!(
        "{grants} GRANT SELECT ON public.identities,public.login_attempts,public.sessions,public.organisations,public.clients,public.engagements,public.organisation_memberships,public.engagement_assignments TO \"{runtime_role}\"; GRANT INSERT(id,issuer,subject,display_name),UPDATE(display_name) ON public.identities TO \"{runtime_role}\"; GRANT INSERT,DELETE ON public.login_attempts,public.sessions TO \"{runtime_role}\"; GRANT UPDATE(name) ON public.engagements TO \"{runtime_role}\";"
    );
    let grants = format!(
        "{grants} GRANT SELECT,INSERT ON public.task_counters,public.tasks,public.task_cycles,public.task_commands,public.task_events,public.task_claims,public.task_receipt_slots,public.task_observations TO \"{runtime_role}\"; GRANT INSERT ON public.task_wakeups TO \"{runtime_role}\"; GRANT SELECT(id,actor_id,organisation_id,client_id,engagement_id,task_id,pending,available_at) ON public.task_wakeups TO \"{runtime_role}\"; GRANT UPDATE(cursor) ON public.task_counters TO \"{runtime_role}\"; GRANT UPDATE(cycle_id,working_brief,state,cessation,intent_revision,applied_intent,applied_command_cursor,revision,execution_epoch,owner_id,owner_until,owner_epoch) ON public.tasks TO \"{runtime_role}\"; GRANT UPDATE(status) ON public.task_cycles TO \"{runtime_role}\"; GRANT UPDATE(state) ON public.task_claims TO \"{runtime_role}\"; GRANT INSERT(wakeup_id),SELECT(wakeup_id,delivery_owner,delivery_until),UPDATE(delivery_owner,delivery_until) ON public.task_deliveries TO \"{runtime_role}\"; GRANT UPDATE(pending,available_at) ON public.task_wakeups TO \"{runtime_role}\";"
    );
    let grants = format!(
        "{grants} GRANT SELECT ON public.trusted_attachment_metadata TO \"{runtime_role}\"; GRANT SELECT,INSERT ON public.permission_versions,public.permission_heads,public.operations,public.operation_decisions,public.operation_attempts,public.operation_claims,public.operation_receipt_slots,public.operation_receipt_producers,public.operation_receipts TO \"{runtime_role}\"; GRANT UPDATE(current_version) ON public.permission_heads TO \"{runtime_role}\"; GRANT UPDATE(state,consumed_at) ON public.operation_claims TO \"{runtime_role}\";"
    );
    let grants = format!(
        "{grants} GRANT EXECUTE ON FUNCTION public.membership_assignments(text,text,text,text,text),public.membership_preview(text,text,text,text),public.membership_read(text,text,text,text,text,text),public.membership_write(text,text,text,text,jsonb,text,text,text),public.membership_accept(text,text,text,text,text,text) TO \"{runtime_role}\";"
    );
    let grants = format!(
        "{grants} GRANT EXECUTE ON FUNCTION public.evidence_session_locked(text,text) TO \"{runtime_role}\"; GRANT SELECT,INSERT ON public.evidence_reservations,public.evidence_originals TO \"{runtime_role}\";"
    );
    let grants = format!(
        "{grants} GRANT EXECUTE ON FUNCTION public.methodology_read(text,text,text),public.methodology_write(text,text,text,text,jsonb,text,text),public.methodology_candidates(text,text,text,bigint),public.methodology_task(text,text,jsonb) TO \"{runtime_role}\";"
    );
    let grants = format!(
        "{grants} GRANT EXECUTE ON FUNCTION public.skills_read(text,text,text),public.skills_admin(text,text,text,text,jsonb),public.skills_impact(text,jsonb),public.skills_write(text,text,text,text,jsonb,text,text,text,jsonb),public.skills_task(text,text,jsonb) TO \"{runtime_role}\";"
    );
    sqlx::raw_sql(&grants)
        .execute(&mut *tx)
        .await
        .map_err(|_| BootstrapError::MigrationFailed)?;
    check_effective_role(&mut tx, runtime_role, false).await?;
    check_schema(&mut tx, false).await?;
    check_runtime_grants(&mut tx, runtime_role).await?;
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
