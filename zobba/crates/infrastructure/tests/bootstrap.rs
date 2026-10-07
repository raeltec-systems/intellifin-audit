//! Real PostgreSQL contract, deliberately destructive only in a named *_test DB.
//! One serial test owns the fixture and leaves an empty database for process smoke.
use sqlx::{Connection, Executor, PgConnection};
use std::time::{Duration, Instant};
use zobba_application::{BootstrapError, SchemaHealth};
use zobba_infrastructure::{RuntimeDatabase, database_options, migrate, valid_role_name};
mod support;
use support::Configuration;
#[path = "support/isolation.rs"]
mod isolation;

async fn reset(config: &Configuration, conn: &mut PgConnection) {
    config.guard_connection(conn).await;
    conn.execute("DROP SCHEMA IF EXISTS foreign_schema CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT USAGE ON SCHEMA public TO PUBLIC; REVOKE CREATE ON SCHEMA public FROM PUBLIC;")
        .await.expect("reset synthetic test schema");
}

async fn snapshot(conn: &mut PgConnection) -> Vec<String> {
    let mut snapshot: Vec<String> = sqlx::query_scalar(r#"
      SELECT pg_catalog.jsonb_build_object('namespace',n.nspname,'schema_owner',n.nspowner,'schema_acl',n.nspacl,
        'relation',pg_catalog.to_jsonb(c),
        'columns',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(a) ORDER BY a.attnum) FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid),
        'defaults',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(d) ORDER BY d.adnum) FROM pg_catalog.pg_attrdef d WHERE d.adrelid=c.oid),
        'constraints',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(k) ORDER BY k.conname) FROM pg_catalog.pg_constraint k WHERE k.conrelid=c.oid),
        'triggers',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t) ORDER BY t.tgname) FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid),
        'policies',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(p) ORDER BY p.polname) FROM pg_catalog.pg_policy p WHERE p.polrelid=c.oid),
        'rules',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) ORDER BY r.rulename) FROM pg_catalog.pg_rewrite r WHERE r.ev_class=c.oid))::text
      FROM pg_catalog.pg_namespace n LEFT JOIN pg_catalog.pg_class c ON c.relnamespace=n.oid
      WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' ORDER BY n.nspname,c.relname
    "#).fetch_all(&mut *conn).await.expect("snapshot definitions and privileges");
    // Include catalog-only objects and authority edges in no-mutation evidence.
    for (catalog, namespace) in [
        ("pg_statistic_ext", "stxnamespace"),
        ("pg_collation", "collnamespace"),
        ("pg_operator", "oprnamespace"),
        ("pg_opclass", "opcnamespace"),
        ("pg_opfamily", "opfnamespace"),
        ("pg_conversion", "connamespace"),
        ("pg_ts_config", "cfgnamespace"),
        ("pg_ts_dict", "dictnamespace"),
        ("pg_ts_parser", "prsnamespace"),
        ("pg_ts_template", "tmplnamespace"),
        ("pg_proc", "pronamespace"),
        ("pg_type", "typnamespace"),
    ] {
        let rows: String = sqlx::query_scalar(&format!("SELECT COALESCE(jsonb_agg(to_jsonb(o) ORDER BY o.oid),'[]'::jsonb)::text FROM pg_catalog.{catalog} o JOIN pg_catalog.pg_namespace n ON n.oid=o.{namespace} WHERE n.nspname='public'"))
            .fetch_one(&mut *conn).await.unwrap();
        snapshot.push(rows);
    }
    let triggers: String = sqlx::query_scalar("SELECT COALESCE(jsonb_agg(to_jsonb(o) ORDER BY o.oid),'[]'::jsonb)::text FROM pg_catalog.pg_event_trigger o")
        .fetch_one(&mut *conn).await.unwrap();
    snapshot.push(triggers);
    for (catalog, parent, link, namespace) in [
        ("pg_ts_config_map", "pg_ts_config", "mapcfg", "cfgnamespace"),
        ("pg_amop", "pg_opfamily", "amopfamily", "opfnamespace"),
        ("pg_amproc", "pg_opfamily", "amprocfamily", "opfnamespace"),
    ] {
        let rows: String = sqlx::query_scalar(&format!("SELECT COALESCE(jsonb_agg(to_jsonb(o) ORDER BY to_jsonb(o)::text),'[]'::jsonb)::text FROM pg_catalog.{catalog} o JOIN pg_catalog.{parent} p ON p.oid=o.{link} JOIN pg_catalog.pg_namespace n ON n.oid=p.{namespace} WHERE n.nspname='public'"))
            .fetch_one(&mut *conn).await.unwrap();
        snapshot.push(rows);
    }
    let config = Configuration::from_environment();
    let mut roles = vec![
        database_options(&config.runtime)
            .unwrap()
            .get_username()
            .to_owned(),
        database_options(&config.migration)
            .unwrap()
            .get_username()
            .to_owned(),
    ];
    for suffix in ["runtime", "parent", "login"] {
        roles.push(format!("zobba_fixture_{}_{suffix}", std::process::id()));
    }
    let memberships: String = sqlx::query_scalar(
        r#"
        WITH RECURSIVE relevant(oid) AS (
            SELECT oid FROM pg_catalog.pg_roles WHERE rolname=ANY($1)
            UNION
            SELECT m.roleid FROM pg_catalog.pg_auth_members m JOIN relevant r ON m.member=r.oid
        )
        SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.oid),'[]'::jsonb)::text
        FROM pg_catalog.pg_auth_members m WHERE m.member IN (SELECT oid FROM relevant)
    "#,
    )
    .bind(&roles)
    .fetch_one(&mut *conn)
    .await
    .unwrap();
    snapshot.push(memberships);
    // Only ordinary owned-name tables are read, never an attacker-controlled view.
    for table in ["_sqlx_migrations", "zobba_bootstrap"] {
        let ordinary: bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=$1 AND c.relkind='r')").bind(table).fetch_one(&mut *conn).await.unwrap();
        if ordinary {
            let content: String=sqlx::query_scalar(&format!("SELECT COALESCE(pg_catalog.md5(pg_catalog.string_agg(pg_catalog.to_jsonb(t)::text,',' ORDER BY pg_catalog.to_jsonb(t)::text)),'empty') FROM public.\"{table}\" t"))
                .fetch_one(&mut *conn).await.unwrap();
            snapshot.push(content);
        }
    }
    snapshot
}

async fn refused_without_mutation(admin: &mut PgConnection, url: &str, expected: BootstrapError) {
    let before = snapshot(admin).await;
    let error = match RuntimeDatabase::connect(url).await {
        Ok(_) => panic!("invalid fixture admitted"),
        Err(error) => error,
    };
    assert_eq!(error, expected);
    assert_eq!(snapshot(admin).await, before, "startup mutated schema");
}

#[tokio::test]
async fn bootstrap_contract() {
    let config = Configuration::from_environment();
    let migration_url = config.migration.clone();
    let runtime_url = config.runtime.clone();
    let runtime = database_options(&runtime_url).expect("valid test runtime URL");
    let role = runtime.get_username();
    assert!(valid_role_name(role));
    let mut admin = PgConnection::connect(&migration_url)
        .await
        .expect("connect synthetic test database");
    reset(&config, &mut admin).await;

    refused_without_mutation(&mut admin, &runtime_url, BootstrapError::SchemaMismatch).await;
    admin
        .execute("CREATE TABLE public.foreign_product(id integer)")
        .await
        .unwrap();
    let before = snapshot(&mut admin).await;
    assert_eq!(
        migrate(&migration_url, role).await,
        Err(BootstrapError::SchemaMismatch)
    );
    assert_eq!(
        before,
        snapshot(&mut admin).await,
        "migration changed foreign database"
    );
    refused_without_mutation(&mut admin, &runtime_url, BootstrapError::SchemaMismatch).await;
    reset(&config, &mut admin).await;

    migrate(&migration_url, role)
        .await
        .expect("explicit bootstrap migration");
    let installed: Vec<String> = sqlx::query_scalar(
        "SELECT pg_catalog.to_jsonb(m)::text FROM public._sqlx_migrations m ORDER BY version",
    )
    .fetch_all(&mut admin)
    .await
    .unwrap();
    migrate(&migration_url, role)
        .await
        .expect("repeat migration");
    let repeated: Vec<String> = sqlx::query_scalar(
        "SELECT pg_catalog.to_jsonb(m)::text FROM public._sqlx_migrations m ORDER BY version",
    )
    .fetch_all(&mut admin)
    .await
    .unwrap();
    assert_eq!(installed.len(), 12, "fresh migration ledger is incomplete");
    assert_eq!(installed, repeated, "repeat changed migration ledger");
    let database = RuntimeDatabase::connect(&runtime_url)
        .await
        .expect("nonowner runtime starts");
    assert_eq!(database.check().await.unwrap().0, 12);
    refused_without_mutation(
        &mut admin,
        &migration_url,
        BootstrapError::UnsafeRuntimeRole,
    )
    .await;

    let mut restricted = PgConnection::connect(&runtime_url).await.unwrap();
    for mutation in [
        "CREATE TABLE public.forbidden(id integer)",
        "UPDATE public.zobba_bootstrap SET schema_version=1",
        "UPDATE public.zobba_bootstrap SET local_fixture_issuer='https://fixture.invalid'",
        "DELETE FROM public._sqlx_migrations",
        "ALTER TABLE public.zobba_bootstrap ADD COLUMN forbidden text",
        "UPDATE public.permission_versions SET document='{}'",
        "DELETE FROM public.permission_versions",
        "UPDATE public.permission_heads SET policy_key='substituted'",
        "UPDATE public.operations SET request='substituted'",
        "UPDATE public.operations SET source_binding='substituted'",
        "UPDATE public.operation_attempts SET source_binding='substituted'",
        "INSERT INTO public.trusted_attachment_metadata VALUES('org','client','engagement','source','attachment',repeat('a',64),'public')",
        "UPDATE public.trusted_attachment_metadata SET classification='public'",
        "DELETE FROM public.trusted_attachment_metadata",
        "UPDATE public.operation_decisions SET allow=true",
        "UPDATE public.operation_attempts SET basis='{}'",
        "UPDATE public.operation_claims SET attempt_id='substituted'",
        "UPDATE public.operation_receipt_slots SET capability_hash=repeat('a',64)",
        "UPDATE public.operation_receipts SET outcome='completed'",
        "DELETE FROM public.operations",
        "DELETE FROM public.operation_decisions",
        "DELETE FROM public.operation_attempts",
        "DELETE FROM public.operation_claims",
        "DELETE FROM public.operation_receipt_slots",
        "DELETE FROM public.operation_receipts",
        "UPDATE public.organisation_memberships SET active=false",
        "INSERT INTO public.membership_versions VALUES('forbidden',1)",
        "UPDATE public.membership_events SET receipt='{}'",
        "DELETE FROM public.membership_events",
        "SELECT secret_hash FROM public.membership_invitations",
        "SELECT public.membership_admin('actor','org')",
        "UPDATE public.identities SET active=false",
        "DELETE FROM public.identities",
        "SELECT public.admin_continuity_assert('org')",
        "SELECT public.admin_continuity_lock()",
        "SELECT public.admin_continuity_check()",
        "SELECT public.admin_continuity_truncate()",
        "SELECT public.methodology_audit('org','client','engagement')",
        "SELECT * FROM public.methodology_versions",
        "SELECT * FROM public.methodology_events",
        "SELECT * FROM public.methodology_assignments",
        "SELECT * FROM public.methodology_recalls",
        "SELECT * FROM public.task_methodology_bindings",
        "SELECT * FROM public.task_methodology_heads",
        "SELECT * FROM public.task_methodology_changes",
        "UPDATE public.methodology_versions SET command='{}'",
        "DELETE FROM public.methodology_events",
        "UPDATE public.task_methodology_heads SET binding_id='substituted'",
        "SELECT * FROM public.skill_versions",
        "SELECT * FROM public.skill_events",
        "SELECT * FROM public.skill_status",
        "SELECT * FROM public.task_skill_selections",
        "UPDATE public.skill_versions SET digest=repeat('b',64)",
        "DELETE FROM public.skill_events",
        "UPDATE public.skill_status SET status='enabled'",
        "UPDATE public.task_skill_selections SET receipt='{}'",
        "UPDATE public.model_profiles SET document='{}'",
        "DELETE FROM public.model_invocations",
        "UPDATE public.model_results SET document='{}'",
        "DELETE FROM public.model_tool_bindings",
        "UPDATE public.knowledge_records SET document='{}'",
        "DELETE FROM public.knowledge_events",
        "UPDATE public.knowledge_invalidations SET document='{}'",
        "DELETE FROM public.knowledge_publications",
        "DELETE FROM public.knowledge_withdrawals",
        "UPDATE public.knowledge_layout_events SET document='{}'",
        "DELETE FROM public.knowledge_source_corrections",
        "UPDATE public.knowledge_captures SET document='{}'",
    ] {
        assert!(
            restricted.execute(mutation).await.is_err(),
            "runtime mutation admitted"
        );
    }
    restricted.close().await.unwrap();

    schema4_scope_contract(&config).await;

    admin.execute("CREATE SCHEMA foreign_schema").await.unwrap();
    assert_eq!(
        database.check().await,
        Err(BootstrapError::SchemaMismatch),
        "running readiness ignored foreign schema"
    );
    refused_without_mutation(&mut admin, &runtime_url, BootstrapError::SchemaMismatch).await;
    admin.execute("DROP SCHEMA foreign_schema").await.unwrap();

    for mutation in [
        "UPDATE public._sqlx_migrations SET checksum='\\x00'::bytea",
        "UPDATE public._sqlx_migrations SET success=false",
        "UPDATE public._sqlx_migrations SET version=version+999",
        "DELETE FROM public._sqlx_migrations",
        "ALTER TABLE public.zobba_bootstrap ADD COLUMN alien text",
        "ALTER TABLE public.zobba_bootstrap DROP CONSTRAINT zobba_bootstrap_product_check",
        "CREATE INDEX unexpected_index ON public.zobba_bootstrap(product)",
        "ALTER TABLE public.engagements NO FORCE ROW LEVEL SECURITY",
        "ALTER POLICY scoped_engagement_update ON public.engagements USING (true) WITH CHECK (true)",
        "ALTER TABLE public.sessions ADD COLUMN alien text",
        "ALTER TABLE public.sessions DROP CONSTRAINT sessions_verified_recipient",
        "ALTER TABLE public.membership_invitations NO FORCE ROW LEVEL SECURITY",
        "ALTER POLICY membership_owner ON public.organisation_memberships USING (true) WITH CHECK (true)",
        "ALTER FUNCTION public.membership_read(text,text,text,text,text,text) SECURITY INVOKER",
        "ALTER FUNCTION public.membership_read(text,text,text,text,text,text) SET search_path=public",
        "CREATE OR REPLACE FUNCTION public.membership_admin(actor text,org text) RETURNS boolean LANGUAGE sql VOLATILE SET search_path=pg_catalog,public AS 'SELECT true'",
        "GRANT EXECUTE ON FUNCTION public.membership_read(text,text,text,text,text,text) TO PUBLIC",
        "GRANT EXECUTE ON FUNCTION public.membership_session(text,text) TO PUBLIC",
        "ALTER TABLE public.organisation_memberships DISABLE TRIGGER admin_continuity_check",
        "ALTER TABLE public.identities ENABLE REPLICA TRIGGER admin_continuity_lock",
        "ALTER TRIGGER admin_continuity_check ON public.organisations RENAME TO renamed_guard",
        "DROP TRIGGER admin_continuity_truncate ON public.organisation_memberships",
        "DROP INDEX public.organisation_memberships_actor_organisation",
        "DROP TRIGGER admin_continuity_lock ON public.identities; CREATE TRIGGER admin_continuity_lock BEFORE UPDATE OF display_name OR DELETE ON public.identities FOR EACH ROW EXECUTE FUNCTION public.admin_continuity_lock()",
        "DROP TRIGGER admin_continuity_check ON public.organisations; CREATE CONSTRAINT TRIGGER admin_continuity_check AFTER INSERT OR UPDATE OF id OR DELETE ON public.organisations DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION public.admin_continuity_check()",
        "ALTER FUNCTION public.admin_continuity_assert(text) SECURITY INVOKER",
        "ALTER FUNCTION public.admin_continuity_lock() SET search_path=public",
        "CREATE OR REPLACE FUNCTION public.admin_continuity_assert(org text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS 'BEGIN RETURN; END'",
        "GRANT EXECUTE ON FUNCTION public.admin_continuity_check() TO PUBLIC",
        "CREATE TRIGGER extra_guard BEFORE DELETE ON public.identities FOR EACH ROW EXECUTE FUNCTION public.admin_continuity_lock()",
        "DROP INDEX public.membership_invitations_page",
        "DROP INDEX public.sessions_expiry",
        "DROP INDEX public.login_attempts_expiry",
        "DROP INDEX public.task_commands_pending",
        "DROP INDEX public.tasks_open_scope",
        "ALTER TABLE public.permission_versions NO FORCE ROW LEVEL SECURITY",
        "ALTER POLICY scoped_insert ON public.permission_versions WITH CHECK (true)",
        "ALTER POLICY scoped_update ON public.permission_heads USING (true) WITH CHECK (true)",
        "ALTER TABLE public.operations DROP CONSTRAINT operations_request_digest_check",
        "DROP INDEX public.operations_task",
        "ALTER TABLE public.operations DROP CONSTRAINT operations_source_binding_check",
        "ALTER TABLE public.operation_attempts DROP CONSTRAINT operation_attempts_source_binding_check",
        "ALTER TABLE public.trusted_attachment_metadata NO FORCE ROW LEVEL SECURITY",
        "ALTER POLICY scoped_read ON public.trusted_attachment_metadata USING (true)",
        "ALTER POLICY owner_registration ON public.trusted_attachment_metadata WITH CHECK (true)",
        "ALTER TABLE public.trusted_attachment_metadata DROP CONSTRAINT trusted_attachment_metadata_digest_check",
        "ALTER TABLE public.operation_decisions DROP CONSTRAINT operation_decisions_request_digest_check",
        "ALTER TABLE public.operation_attempts DROP CONSTRAINT operation_attempts_attempt_number_check",
        "ALTER TABLE public.operation_claims NO FORCE ROW LEVEL SECURITY",
        "ALTER POLICY scoped_consume ON public.operation_claims USING (true) WITH CHECK (true)",
        "DROP INDEX public.operation_claims_admitted",
        "ALTER TABLE public.operation_receipt_slots DROP CONSTRAINT operation_receipt_slots_capability_hash_check",
        "ALTER POLICY exact_receipt ON public.operation_receipt_slots USING (true)",
        "ALTER TABLE public.operation_receipt_producers NO FORCE ROW LEVEL SECURITY",
        "ALTER POLICY scoped_read ON public.operation_receipt_producers USING (true)",
        "ALTER TABLE public.operation_receipt_slots DROP CONSTRAINT operation_receipt_slots_custody_check",
        "ALTER POLICY receipt_insert ON public.operation_receipts WITH CHECK (true)",
        "ALTER POLICY scoped_read ON public.operation_receipts USING (true)",
        "DROP INDEX public.operation_receipts_attempt",
        "ALTER TABLE public.tasks ALTER COLUMN applied_command_cursor SET DEFAULT 1",
        "ALTER TABLE public.tasks DROP CONSTRAINT tasks_applied_command_cursor_check",
        "ALTER TABLE public.task_deliveries NO FORCE ROW LEVEL SECURITY",
        "ALTER POLICY dispatcher_lease ON public.task_deliveries USING (true) WITH CHECK (true)",
        "ALTER POLICY scoped_delivery_insert ON public.task_deliveries WITH CHECK (true)",
        "CREATE POLICY dispatcher_mutation ON public.task_wakeups FOR UPDATE USING (pg_catalog.current_setting('zobba.dispatcher',true)='on') WITH CHECK (pg_catalog.current_setting('zobba.dispatcher',true)='on')",
        "ALTER TABLE public.task_deliveries DROP CONSTRAINT task_deliveries_wakeup_id_fkey",
        "ALTER TABLE public.evidence_originals NO FORCE ROW LEVEL SECURITY",
        "DROP POLICY scoped_insert ON public.evidence_reservations",
        "ALTER FUNCTION public.evidence_session_locked(text,text) SECURITY INVOKER",
        "DROP INDEX public.evidence_originals_scope; CREATE INDEX evidence_originals_scope ON public.evidence_originals(organisation_id,client_id,engagement_id,id)",
        "DROP INDEX public.evidence_reservations_owner; CREATE INDEX evidence_reservations_owner ON public.evidence_reservations(organisation_id,client_id,engagement_id,actor_id,id)",
        "ALTER TABLE public.methodology_versions NO FORCE ROW LEVEL SECURITY",
        "ALTER POLICY methodology_owner ON public.methodology_assignments USING (true) WITH CHECK (true)",
        "ALTER TABLE public.methodology_versions DROP CONSTRAINT methodology_versions_revision_check",
        "ALTER TABLE public.task_methodology_bindings DROP CONSTRAINT task_methodology_bindings_pkey CASCADE",
        "ALTER FUNCTION public.methodology_read(text,text,text) SECURITY INVOKER",
        "ALTER FUNCTION public.methodology_write(text,text,text,text,jsonb,text,text) SET search_path=public",
        "CREATE OR REPLACE FUNCTION public.methodology_audit(org text,client text,engagement text) RETURNS boolean LANGUAGE sql VOLATILE SET search_path=pg_catalog,public AS 'SELECT true'",
        "GRANT EXECUTE ON FUNCTION public.methodology_candidates(text,text,text,bigint) TO PUBLIC",
        "ALTER TABLE public.skill_versions NO FORCE ROW LEVEL SECURITY",
        "ALTER POLICY skills_owner ON public.task_skill_selections USING (true) WITH CHECK (true)",
        "DROP INDEX public.skill_versions_manifest_identity",
        "DROP INDEX public.skill_events_version_history",
        "DROP INDEX public.task_skill_selections_version",
        "DROP INDEX public.task_skill_selections_scope; CREATE INDEX task_skill_selections_scope ON public.task_skill_selections(organisation_id,client_id,engagement_id,task_id,revision,version_id)",
        "DROP INDEX public.skills_client_choices; CREATE INDEX skills_client_choices ON public.clients(organisation_id,id)",
        "DROP INDEX public.skills_engagement_choices",
        "ALTER TABLE public.skill_events DROP CONSTRAINT skill_events_check",
        "ALTER TABLE public.skill_status DROP CONSTRAINT skill_status_status_check",
        "ALTER FUNCTION public.skills_read(text,text,text) SECURITY INVOKER",
        "ALTER FUNCTION public.skills_admin(text,text,text,text,jsonb) SECURITY INVOKER",
        "GRANT EXECUTE ON FUNCTION public.skills_impact(text,jsonb) TO PUBLIC",
        "ALTER FUNCTION public.skills_write(text,text,text,text,jsonb,text,text,text,jsonb) SET search_path=public",
        "GRANT EXECUTE ON FUNCTION public.skills_task(text,text,jsonb) TO PUBLIC",
        "ALTER FUNCTION public.model_configuration_admin(text,text,text) SECURITY INVOKER",
        "GRANT EXECUTE ON FUNCTION public.model_configuration_admin(text,text,text) TO PUBLIC",
        "ALTER TABLE public.task_steps DISABLE TRIGGER work_step_guard",
        "DROP TRIGGER work_answer_guard ON public.task_routing_answers",
        "GRANT EXECUTE ON FUNCTION public.work_guidance_guard() TO PUBLIC",
        "ALTER FUNCTION public.work_step_guard() SECURITY DEFINER",
        "CREATE OR REPLACE FUNCTION public.work_answer_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS 'BEGIN RETURN NEW; END'",
        "ALTER TABLE public.task_steps DROP CONSTRAINT task_steps_check2",
        "ALTER TABLE public.model_profiles NO FORCE ROW LEVEL SECURITY",
        "ALTER TABLE public.model_catalogues NO FORCE ROW LEVEL SECURITY",
        "ALTER TABLE public.model_invocations NO FORCE ROW LEVEL SECURITY",
        "ALTER TABLE public.model_results NO FORCE ROW LEVEL SECURITY",
        "ALTER TABLE public.model_tool_bindings NO FORCE ROW LEVEL SECURITY",
        "ALTER POLICY model_result_insert ON public.model_results WITH CHECK (true)",
        "ALTER TABLE public.knowledge_records NO FORCE ROW LEVEL SECURITY",
        "ALTER TABLE public.knowledge_events NO FORCE ROW LEVEL SECURITY",
        "ALTER TABLE public.knowledge_invalidations NO FORCE ROW LEVEL SECURITY",
        "ALTER TABLE public.knowledge_publications NO FORCE ROW LEVEL SECURITY",
        "ALTER TABLE public.knowledge_withdrawals NO FORCE ROW LEVEL SECURITY",
        "ALTER TABLE public.knowledge_layout_events NO FORCE ROW LEVEL SECURITY",
        "ALTER TABLE public.knowledge_source_corrections NO FORCE ROW LEVEL SECURITY",
        "ALTER TABLE public.knowledge_captures NO FORCE ROW LEVEL SECURITY",
        "ALTER POLICY knowledge_read ON public.knowledge_records USING (true)",
        "ALTER POLICY knowledge_insert ON public.knowledge_publications WITH CHECK (true)",
        "DROP INDEX public.knowledge_records_page; CREATE INDEX knowledge_records_page ON public.knowledge_records(organisation_id,id,revision DESC)",
        "ALTER FUNCTION public.knowledge_audit(text,text,text,text) SECURITY INVOKER",
        "ALTER FUNCTION public.knowledge_release_active(text,text) SET search_path=public",
        "GRANT EXECUTE ON FUNCTION public.knowledge_release_active(text,text) TO PUBLIC",
        "ALTER TABLE public.engagements DROP CONSTRAINT engagements_name_check",
        "ALTER TABLE public.organisations DROP CONSTRAINT organisations_id_check",
        "ALTER TABLE public.engagement_assignments DROP CONSTRAINT engagement_assignments_organisation_id_client_id_engagemen_fkey",
        "ALTER TABLE public.zobba_bootstrap ENABLE ROW LEVEL SECURITY",
        "CREATE TYPE public.alien_composite AS (value text)",
        "CREATE TYPE public.alien_range AS RANGE (subtype=integer)",
        "ALTER TABLE public.zobba_bootstrap SET UNLOGGED",
        "ALTER TABLE public._sqlx_migrations SET UNLOGGED",
        "ALTER TABLE public.zobba_bootstrap ALTER COLUMN singleton SET DEFAULT false",
        "ALTER TABLE public._sqlx_migrations ALTER COLUMN installed_on SET DEFAULT '2000-01-01'::timestamptz",
        "CREATE RULE alien_rule AS ON DELETE TO public.zobba_bootstrap DO ALSO NOTHING",
        "INSERT INTO public._sqlx_migrations(version,description,success,checksum,execution_time) SELECT v,repeat('x',4096),true,'\\x00'::bytea,0 FROM generate_series(13,1000) v",
        "UPDATE public._sqlx_migrations SET description=repeat('x',1048576),checksum=decode(repeat('ff',1048576),'hex')",
        "ALTER TABLE public.zobba_bootstrap DROP CONSTRAINT zobba_bootstrap_product_check; UPDATE public.zobba_bootstrap SET product='foreign'",
        "ALTER TABLE public.zobba_bootstrap DROP CONSTRAINT zobba_bootstrap_product_check; UPDATE public.zobba_bootstrap SET product=repeat('x',1048576)",
        "ALTER TABLE public.zobba_bootstrap DROP CONSTRAINT zobba_bootstrap_schema_version_check; UPDATE public.zobba_bootstrap SET schema_version=999",
    ] {
        admin
            .execute(mutation)
            .await
            .expect("corrupt synthetic fixture");
        refused_without_mutation(&mut admin, &runtime_url, BootstrapError::SchemaMismatch).await;
        assert_eq!(
            migrate(&migration_url, role).await,
            Err(BootstrapError::SchemaMismatch)
        );
        reset(&config, &mut admin).await;
        migrate(&migration_url, role)
            .await
            .expect("restore synthetic fixture");
    }

    membership_function_authority(&config, &mut admin).await;
    methodology_function_authority(&config, &mut admin).await;
    skills_function_authority(&config, &mut admin).await;
    knowledge_function_authority(&config, &mut admin).await;
    model_function_authority(&config, &mut admin).await;
    internal_trigger_contract(&config, &mut admin).await;

    // Column-level leases must not expand to routing identity, scheduling or
    // initial lease ownership writes, even if accidental grants remain unused.
    for privilege in [
        "INSERT ON public.organisation_memberships",
        "UPDATE(roles) ON public.organisation_memberships",
        "DELETE ON public.engagement_assignments",
        "SELECT ON public.membership_events",
        "SELECT(receipt) ON public.membership_events",
        "SELECT(secret_hash) ON public.membership_invitations",
        "SELECT(version) ON public.membership_versions",
        "INSERT ON public.membership_events",
        "UPDATE(status) ON public.membership_invitations",
        "DELETE ON public.membership_invitations",
        "UPDATE(wakeup_id) ON public.task_deliveries",
        "INSERT(delivery_owner) ON public.task_deliveries",
        "INSERT(delivery_until) ON public.task_deliveries",
        "DELETE ON public.task_deliveries",
        "UPDATE(actor_id) ON public.task_wakeups",
        "UPDATE(task_id) ON public.task_wakeups",
        "SELECT ON public.task_wakeups",
        "SELECT ON public.task_deliveries",
        "UPDATE(document) ON public.permission_versions",
        "UPDATE(accepted_snapshot) ON public.permission_versions",
        "DELETE ON public.permission_versions",
        "UPDATE(client_id) ON public.permission_heads",
        "UPDATE(policy_key) ON public.permission_heads",
        "DELETE ON public.permission_heads",
        "UPDATE(request) ON public.operations",
        "UPDATE(source_binding) ON public.operations",
        "UPDATE(source_binding) ON public.operation_attempts",
        "INSERT ON public.trusted_attachment_metadata",
        "UPDATE(classification) ON public.trusted_attachment_metadata",
        "DELETE ON public.trusted_attachment_metadata",
        "UPDATE(authority_snapshot) ON public.operations",
        "UPDATE(actor_id) ON public.operation_decisions",
        "UPDATE(allow) ON public.operation_decisions",
        "UPDATE(basis) ON public.operation_attempts",
        "UPDATE(attempt_id) ON public.operation_claims",
        "UPDATE(operation_id) ON public.operation_claims",
        "UPDATE(capability_hash) ON public.operation_receipt_slots",
        "UPDATE(custody) ON public.operation_receipt_slots",
        "UPDATE(producer_id) ON public.operation_receipt_producers",
        "DELETE ON public.operation_receipt_producers",
        "UPDATE(outcome) ON public.operation_receipts",
        "UPDATE ON public.operation_claims",
        "DELETE ON public.operation_receipts",
        "SELECT ON public.methodology_versions",
        "SELECT(command) ON public.methodology_versions",
        "INSERT ON public.methodology_assignments",
        "SELECT ON public.methodology_events",
        "UPDATE(command) ON public.methodology_versions",
        "DELETE ON public.methodology_recalls",
        "INSERT ON public.task_methodology_bindings",
        "UPDATE(binding_id) ON public.task_methodology_heads",
        "SELECT ON public.task_methodology_changes",
        "SELECT ON public.skill_versions",
        "SELECT(command) ON public.skill_versions",
        "INSERT ON public.skill_events",
        "UPDATE(status) ON public.skill_status",
        "DELETE ON public.task_skill_selections",
        "SELECT(receipt) ON public.task_skill_selections",
        "UPDATE(document) ON public.knowledge_records",
        "DELETE ON public.knowledge_events",
        "UPDATE(document) ON public.knowledge_invalidations",
        "DELETE ON public.knowledge_publications",
        "DELETE ON public.knowledge_withdrawals",
        "UPDATE(document) ON public.knowledge_layout_events",
        "DELETE ON public.knowledge_source_corrections",
        "UPDATE(document) ON public.knowledge_captures",
    ] {
        admin
            .execute(format!("GRANT {privilege} TO \"{role}\"").as_str())
            .await
            .unwrap();
        refused_without_mutation(&mut admin, &runtime_url, BootstrapError::UnsafeRuntimeRole).await;
        migration_refused_without_mutation(
            &mut admin,
            &config,
            role,
            BootstrapError::UnsafeRuntimeRole,
        )
        .await;
        admin
            .execute(format!("REVOKE {privilege} FROM \"{role}\"").as_str())
            .await
            .unwrap();
        // PostgreSQL REVOKE at table level also removes that role's column
        // grants. The explicit idempotent migrator restores the owned narrow set.
        migrate(&migration_url, role)
            .await
            .expect("restore exact narrow grants after removing the accidental privilege");
        RuntimeDatabase::connect(&runtime_url)
            .await
            .expect("exact lease/routing grants restore a usable runtime");
    }

    // Even a limited role with accidental metadata writes is an unsafe runtime.
    admin
        .execute(format!("GRANT UPDATE ON public.zobba_bootstrap TO \"{role}\"").as_str())
        .await
        .unwrap();
    refused_without_mutation(&mut admin, &runtime_url, BootstrapError::UnsafeRuntimeRole).await;
    reset(&config, &mut admin).await;
    upgrade_contract(&config, &mut admin).await;
    continuity_upgrade_contract(&config, &mut admin).await;
    methodology_upgrade_contract(&config, &mut admin).await;
    skills_upgrade_contract(&config, &mut admin).await;
    knowledge_upgrade_contract(&config, &mut admin).await;
    model_upgrade_contract(&config, &mut admin).await;
    no_foreign_code_runs(&config, &mut admin).await;
    foreign_catalog_objects(&config, &mut admin).await;
    authority_and_atomicity(&config, &mut admin).await;
    lock_and_blackhole(&config, &mut admin).await;
    reset(&config, &mut admin).await;
    println!(
        "bootstrap contract: fresh/v1-v8/repeat/owner/privilege/methodology/skills/foreign/marker/checksum/version refusals passed; test schema empty"
    );
}

async fn migration_refused_without_mutation(
    conn: &mut PgConnection,
    config: &Configuration,
    role: &str,
    error: BootstrapError,
) {
    let before = snapshot(conn).await;
    assert_eq!(migrate(&config.migration, role).await, Err(error));
    assert_eq!(
        before,
        snapshot(conn).await,
        "refused migration changed data/definitions/privileges"
    );
}

async fn no_foreign_code_runs(config: &Configuration, conn: &mut PgConnection) {
    config.guard_connection(conn).await;
    let runtime = database_options(&config.runtime).unwrap();
    let role = runtime.get_username();
    migrate(&config.migration, role).await.unwrap();
    let running = RuntimeDatabase::connect(&config.runtime).await.unwrap();
    reset(config, conn).await;
    conn.execute(
        r#"
      CREATE TABLE public.shadow_sentinel(calls integer NOT NULL);
      INSERT INTO public.shadow_sentinel VALUES (0);
      CREATE FUNCTION public.current_setting(text) RETURNS text LANGUAGE plpgsql AS $$
      BEGIN UPDATE public.shadow_sentinel SET calls=calls+1; RETURN '180004'; END $$;
    "#,
    )
    .await
    .unwrap();
    refused_without_mutation(conn, &config.runtime, BootstrapError::SchemaMismatch).await;
    migration_refused_without_mutation(conn, config, role, BootstrapError::SchemaMismatch).await;
    let calls: i32 = sqlx::query_scalar("SELECT calls FROM public.shadow_sentinel")
        .fetch_one(&mut *conn)
        .await
        .unwrap();
    assert_eq!(calls, 0, "foreign current_setting was invoked");
    reset(config, conn).await;
    // A view with an owned metadata name must never be read. Its volatile
    // expression attempts a harmless advisory-lock side effect if invoked.
    conn.execute("CREATE VIEW public._sqlx_migrations AS SELECT CASE WHEN pg_catalog.pg_advisory_lock(9026020099) IS NULL THEN 1::bigint ELSE 999::bigint END AS version,'bootstrap'::text AS description,true AS success,'\\x00'::bytea AS checksum; CREATE VIEW public.zobba_bootstrap AS SELECT true AS singleton,'zobba'::text AS product,1::bigint AS schema_version").await.unwrap();
    conn.execute(
        format!("GRANT SELECT ON public._sqlx_migrations,public.zobba_bootstrap TO \"{role}\"")
            .as_str(),
    )
    .await
    .unwrap();
    refused_without_mutation(conn, &config.runtime, BootstrapError::SchemaMismatch).await;
    assert_eq!(running.check().await, Err(BootstrapError::SchemaMismatch));
    migration_refused_without_mutation(conn, config, role, BootstrapError::SchemaMismatch).await;
    let held:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_locks WHERE locktype='advisory' AND classid=2 AND objid=436085507)").fetch_one(&mut *conn).await.unwrap();
    assert!(!held, "foreign metadata view was invoked");
    reset(config, conn).await;
    // Atomic bootstrap intentionally refuses existing partial ledgers instead
    // of treating foreign empty or nonempty table names as an interrupted run.
    for partial in [
        "CREATE TABLE public._sqlx_migrations(id integer)",
        "CREATE TABLE public._sqlx_migrations(version bigint PRIMARY KEY,description text NOT NULL,installed_on timestamptz NOT NULL DEFAULT now(),success boolean NOT NULL,checksum bytea NOT NULL,execution_time bigint NOT NULL)",
        "CREATE TABLE public._sqlx_migrations(id integer); INSERT INTO public._sqlx_migrations VALUES(1)",
    ] {
        conn.execute(partial).await.unwrap();
        migration_refused_without_mutation(conn, config, role, BootstrapError::SchemaMismatch)
            .await;
        reset(config, conn).await;
    }
}

async fn foreign_catalog_objects(config: &Configuration, conn: &mut PgConnection) {
    let runtime = database_options(&config.runtime).unwrap();
    let role = runtime.get_username();
    let mut admin = PgConnection::connect(&config.admin).await.unwrap();
    // Catalog-only fixtures exercise each formerly omitted inventory family.
    for (create, remove) in [
        (
            "CREATE COLLATION public.alien FROM pg_catalog.\"C\"",
            "DROP COLLATION public.alien",
        ),
        (
            "CREATE OPERATOR public.=== (FUNCTION=pg_catalog.int4eq, LEFTARG=integer, RIGHTARG=integer)",
            "DROP OPERATOR public.=== (integer,integer)",
        ),
        (
            "CREATE OPERATOR FAMILY public.alien USING btree",
            "DROP OPERATOR FAMILY public.alien USING btree",
        ),
        (
            "CREATE OPERATOR CLASS public.alien FOR TYPE integer USING btree AS OPERATOR 1 pg_catalog.< (integer,integer), FUNCTION 1 pg_catalog.btint4cmp(integer,integer)",
            "DROP OPERATOR CLASS public.alien USING btree; DROP OPERATOR FAMILY public.alien USING btree",
        ),
        (
            "CREATE CONVERSION public.alien FOR 'UTF8' TO 'LATIN1' FROM pg_catalog.utf8_to_iso8859_1",
            "DROP CONVERSION public.alien",
        ),
        (
            "CREATE TEXT SEARCH CONFIGURATION public.alien (COPY=pg_catalog.simple)",
            "DROP TEXT SEARCH CONFIGURATION public.alien",
        ),
        (
            "CREATE TEXT SEARCH DICTIONARY public.alien (TEMPLATE=pg_catalog.simple)",
            "DROP TEXT SEARCH DICTIONARY public.alien",
        ),
        (
            "CREATE TEXT SEARCH TEMPLATE public.alien (LEXIZE=pg_catalog.dsimple_lexize)",
            "DROP TEXT SEARCH TEMPLATE public.alien",
        ),
        (
            "CREATE TEXT SEARCH PARSER public.alien (START=pg_catalog.prsd_start, GETTOKEN=pg_catalog.prsd_nexttoken, END=pg_catalog.prsd_end, LEXTYPES=pg_catalog.prsd_lextype)",
            "DROP TEXT SEARCH PARSER public.alien",
        ),
    ] {
        for bootstrapped in [false, true] {
            reset(config, conn).await;
            let running = if bootstrapped {
                migrate(&config.migration, role).await.unwrap();
                Some(RuntimeDatabase::connect(&config.runtime).await.unwrap())
            } else {
                None
            };
            admin
                .execute(create)
                .await
                .expect("create foreign catalog fixture");
            migration_refused_without_mutation(conn, config, role, BootstrapError::SchemaMismatch)
                .await;
            refused_without_mutation(conn, &config.runtime, BootstrapError::SchemaMismatch).await;
            if let Some(running) = &running {
                assert_eq!(running.check().await, Err(BootstrapError::SchemaMismatch));
            }
            admin
                .execute(remove)
                .await
                .expect("remove foreign catalog fixture");
            if let Some(running) = running {
                assert_eq!(running.check().await.unwrap().0, 12);
            }
        }
    }
    reset(config, conn).await;
    migrate(&config.migration, role).await.unwrap();
    let running = RuntimeDatabase::connect(&config.runtime).await.unwrap();
    admin
        .execute(
            "CREATE STATISTICS public.alien ON product,schema_version FROM public.zobba_bootstrap",
        )
        .await
        .unwrap();
    migration_refused_without_mutation(conn, config, role, BootstrapError::SchemaMismatch).await;
    refused_without_mutation(conn, &config.runtime, BootstrapError::SchemaMismatch).await;
    assert_eq!(running.check().await, Err(BootstrapError::SchemaMismatch));
    admin.execute("DROP STATISTICS public.alien").await.unwrap();
    assert_eq!(running.check().await.unwrap().0, 12);
    reset(config, conn).await;
}

async fn authority_and_atomicity(config: &Configuration, conn: &mut PgConnection) {
    config.guard_connection(conn).await;
    let mut privileged = PgConnection::connect_with(&database_options(&config.admin).unwrap())
        .await
        .expect("connect isolated fixture admin");
    let superuser: bool =
        sqlx::query_scalar("SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname=current_user")
            .fetch_one(&mut privileged)
            .await
            .unwrap();
    assert!(
        superuser,
        "set ZOBBA_TEST_ADMIN_DATABASE_URL to a synthetic admin on the SAME test database for elevated-role fixtures"
    );
    let runtime = database_options(&config.runtime).unwrap();
    let role = runtime.get_username();
    let target = format!("zobba_fixture_{}_runtime", std::process::id());
    let parent = format!("zobba_fixture_{}_parent", std::process::id());
    let login = format!("zobba_fixture_{}_login", std::process::id());
    let database = runtime.get_database().unwrap().replace('"', "\"\"");
    // PostgreSQL permits only a superuser to create a shell/base type. Inject
    // this foreign fixture with test-admin authority, never the migrator role.
    privileged
        .execute("CREATE TYPE public.alien_shell")
        .await
        .unwrap();
    refused_without_mutation(conn, &config.runtime, BootstrapError::SchemaMismatch).await;
    migration_refused_without_mutation(conn, config, role, BootstrapError::SchemaMismatch).await;
    reset(config, conn).await;
    privileged.execute(format!("CREATE ROLE \"{target}\" LOGIN NOINHERIT PASSWORD 'synthetic-fixture-only'; CREATE ROLE \"{parent}\" NOLOGIN; CREATE ROLE \"{login}\" LOGIN PASSWORD 'synthetic-fixture-only'; GRANT CONNECT ON DATABASE \"{database}\" TO \"{target}\",\"{login}\"").as_str()).await.unwrap();
    let mut target_url = url::Url::parse(&config.runtime).unwrap();
    target_url.set_username(&target).unwrap();
    target_url
        .set_password(Some("synthetic-fixture-only"))
        .unwrap();
    let target_url = target_url.to_string();
    migrate(&config.migration, &target)
        .await
        .expect("safe independent runtime target");
    let running = RuntimeDatabase::connect(&target_url)
        .await
        .expect("safe nonowner target starts");

    for table in [
        "zobba_bootstrap",
        "_sqlx_migrations",
        "sessions",
        "tasks",
        "task_deliveries",
    ] {
        privileged
            .execute(format!("GRANT MAINTAIN ON public.{table} TO \"{target}\"").as_str())
            .await
            .unwrap();
        let mut capable = PgConnection::connect(&target_url).await.unwrap();
        capable
            .execute(format!("VACUUM public.{table}").as_str())
            .await
            .expect("direct MAINTAIN really permits maintenance");
        capable.close().await.unwrap();
        refused_without_mutation(conn, &target_url, BootstrapError::UnsafeRuntimeRole).await;
        migration_refused_without_mutation(
            conn,
            config,
            &target,
            BootstrapError::UnsafeRuntimeRole,
        )
        .await;
        assert_eq!(
            running.check().await,
            Err(BootstrapError::UnsafeRuntimeRole)
        );
        privileged
            .execute(format!("REVOKE MAINTAIN ON public.{table} FROM \"{target}\"").as_str())
            .await
            .unwrap();
        assert_eq!(running.check().await.unwrap().0, 12);
    }
    privileged.execute(format!("GRANT pg_read_server_files TO \"{parent}\" WITH INHERIT TRUE, SET FALSE; GRANT \"{parent}\" TO \"{target}\" WITH INHERIT FALSE, SET TRUE").as_str()).await.unwrap();
    let mut capable = PgConnection::connect(&target_url).await.unwrap();
    capable
        .execute(format!("SET ROLE \"{parent}\"").as_str())
        .await
        .unwrap();
    let inherited: bool = sqlx::query_scalar(
        "SELECT pg_catalog.pg_has_role(current_user,'pg_read_server_files','USAGE')",
    )
    .fetch_one(&mut capable)
    .await
    .unwrap();
    assert!(
        inherited,
        "mixed path must expose actual server-file authority"
    );
    capable.close().await.unwrap();
    refused_without_mutation(conn, &target_url, BootstrapError::UnsafeRuntimeRole).await;
    migration_refused_without_mutation(conn, config, &target, BootstrapError::UnsafeRuntimeRole)
        .await;
    assert_eq!(
        running.check().await,
        Err(BootstrapError::UnsafeRuntimeRole)
    );
    privileged.execute(format!("REVOKE \"{parent}\" FROM \"{target}\"; REVOKE pg_read_server_files FROM \"{parent}\"").as_str()).await.unwrap();
    assert_eq!(running.check().await.unwrap().0, 12);

    for flags in [
        "REPLICATION",
        "CREATEDB",
        "CREATEROLE",
        "BYPASSRLS",
        "SUPERUSER",
    ] {
        privileged
            .execute(format!("ALTER ROLE \"{target}\" {flags}").as_str())
            .await
            .unwrap();
        refused_without_mutation(conn, &target_url, BootstrapError::UnsafeRuntimeRole).await;
        migration_refused_without_mutation(
            conn,
            config,
            &target,
            BootstrapError::UnsafeRuntimeRole,
        )
        .await;
        privileged
            .execute(format!("ALTER ROLE \"{target}\" NO{flags}").as_str())
            .await
            .unwrap();
    }
    privileged
        .execute(
            format!("GRANT UPDATE(product) ON public.zobba_bootstrap TO \"{target}\"").as_str(),
        )
        .await
        .unwrap();
    refused_without_mutation(conn, &target_url, BootstrapError::UnsafeRuntimeRole).await;
    migration_refused_without_mutation(conn, config, &target, BootstrapError::UnsafeRuntimeRole)
        .await;
    privileged.execute(format!("REVOKE UPDATE(product) ON public.zobba_bootstrap FROM \"{target}\"; GRANT UPDATE(product) ON public.zobba_bootstrap TO \"{parent}\"; GRANT \"{parent}\" TO \"{target}\" WITH INHERIT FALSE, SET TRUE").as_str()).await.unwrap();
    refused_without_mutation(conn, &target_url, BootstrapError::UnsafeRuntimeRole).await;
    migration_refused_without_mutation(conn, config, &target, BootstrapError::UnsafeRuntimeRole)
        .await;
    privileged
        .execute(format!("REVOKE \"{parent}\" FROM \"{target}\"").as_str())
        .await
        .unwrap();
    for powerful in [
        "pg_read_server_files",
        "pg_write_server_files",
        "pg_execute_server_program",
        "pg_write_all_data",
        "pg_create_subscription",
    ] {
        privileged
            .execute(
                format!("GRANT {powerful} TO \"{target}\" WITH INHERIT FALSE, SET TRUE").as_str(),
            )
            .await
            .unwrap();
        refused_without_mutation(conn, &target_url, BootstrapError::UnsafeRuntimeRole).await;
        migration_refused_without_mutation(
            conn,
            config,
            &target,
            BootstrapError::UnsafeRuntimeRole,
        )
        .await;
        privileged
            .execute(format!("REVOKE {powerful} FROM \"{target}\"").as_str())
            .await
            .unwrap();
    }
    privileged
        .execute(format!("GRANT pg_monitor TO \"{target}\"").as_str())
        .await
        .unwrap();
    RuntimeDatabase::connect(&target_url)
        .await
        .expect("harmless monitoring role remains supported");
    migrate(&config.migration, &target)
        .await
        .expect("harmless monitoring target supported");
    privileged.execute(format!("REVOKE pg_monitor FROM \"{target}\"; GRANT \"{target}\" TO \"{login}\"; ALTER ROLE \"{login}\" SET role='{target}'").as_str()).await.unwrap();
    let mut login_url = url::Url::parse(&target_url).unwrap();
    login_url.set_username(&login).unwrap();
    refused_without_mutation(conn, login_url.as_str(), BootstrapError::UnsafeRuntimeRole).await;
    privileged
        .execute(
            format!("ALTER ROLE \"{login}\" RESET role; REVOKE \"{target}\" FROM \"{login}\"")
                .as_str(),
        )
        .await
        .unwrap();
    let migrator = database_options(&config.migration).unwrap();
    let migrator_role = migrator.get_username();
    let migrator_is_superuser: bool =
        sqlx::query_scalar("SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname=$1")
            .bind(migrator_role)
            .fetch_one(&mut privileged)
            .await
            .unwrap();
    privileged
        .execute(
            format!("GRANT \"{migrator_role}\" TO \"{target}\" WITH INHERIT FALSE, SET TRUE")
                .as_str(),
        )
        .await
        .unwrap();
    refused_without_mutation(conn, &target_url, BootstrapError::UnsafeRuntimeRole).await;
    migration_refused_without_mutation(conn, config, &target, BootstrapError::UnsafeRuntimeRole)
        .await;
    privileged
        .execute(format!("REVOKE \"{migrator_role}\" FROM \"{target}\"").as_str())
        .await
        .unwrap();

    privileged.execute(format!("GRANT \"{migrator_role}\" TO \"{target}\" WITH ADMIN TRUE, INHERIT FALSE, SET FALSE").as_str()).await.unwrap();
    // ADMIN-only can promote membership in a restricted migrator. PostgreSQL
    // reserves changes to superuser membership for superusers, even with ADMIN.
    // Roll either transaction back before checking the original authority edge.
    let mut capable = PgConnection::connect(&target_url).await.unwrap();
    capable.execute("BEGIN").await.unwrap();
    let promotion = capable
        .execute(format!("GRANT \"{migrator_role}\" TO \"{target}\" WITH SET TRUE").as_str())
        .await;
    if migrator_is_superuser {
        let error = promotion.expect_err("only superusers may alter superuser membership");
        assert_eq!(
            error
                .as_database_error()
                .and_then(|error| error.code())
                .as_deref(),
            Some("42501"),
            "superuser membership promotion must fail for insufficient privilege"
        );
    } else {
        promotion.expect("ADMIN permits restricted-migrator self-regrant");
        capable
            .execute(format!("SET LOCAL ROLE \"{migrator_role}\"").as_str())
            .await
            .expect("regrant enables restricted migrator role");
    }
    capable.execute("ROLLBACK").await.unwrap();
    capable.close().await.unwrap();
    refused_without_mutation(conn, &target_url, BootstrapError::UnsafeRuntimeRole).await;
    migration_refused_without_mutation(conn, config, &target, BootstrapError::UnsafeRuntimeRole)
        .await;
    assert_eq!(
        running.check().await,
        Err(BootstrapError::UnsafeRuntimeRole)
    );
    privileged
        .execute(format!("REVOKE \"{migrator_role}\" FROM \"{target}\"").as_str())
        .await
        .unwrap();
    assert_eq!(running.check().await.unwrap().0, 12);

    // Simulate interruption after SQLx creates its ledger but before bootstrap
    // finishes. The outer transaction must remove BOTH tables and all grants.
    reset(config, conn).await;
    privileged.execute(r#"
      CREATE FUNCTION pg_catalog.zobba_fixture_interrupt() RETURNS event_trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF EXISTS(SELECT 1 FROM pg_catalog.pg_event_trigger_ddl_commands() WHERE object_identity='public.zobba_bootstrap')
        THEN RAISE EXCEPTION 'synthetic bootstrap interruption'; END IF;
      END $$;
    "#).await.unwrap();
    let trigger = "CREATE EVENT TRIGGER zobba_fixture_interrupt ON ddl_command_end WHEN TAG IN ('CREATE TABLE') EXECUTE FUNCTION pg_catalog.zobba_fixture_interrupt()";
    migrate(&config.migration, &target).await.unwrap();
    // An already-installed event trigger is foreign, even outside public.
    privileged.execute(trigger).await.unwrap();
    assert_eq!(running.check().await, Err(BootstrapError::SchemaMismatch));
    migration_refused_without_mutation(conn, config, &target, BootstrapError::SchemaMismatch).await;
    refused_without_mutation(conn, &target_url, BootstrapError::SchemaMismatch).await;
    privileged
        .execute("DROP EVENT TRIGGER zobba_fixture_interrupt")
        .await
        .unwrap();
    assert_eq!(running.check().await.unwrap().0, 12);
    reset(config, conn).await;
    privileged.execute(trigger).await.unwrap();
    migration_refused_without_mutation(conn, config, &target, BootstrapError::SchemaMismatch).await;
    refused_without_mutation(conn, &target_url, BootstrapError::SchemaMismatch).await;
    privileged
        .execute("DROP EVENT TRIGGER zobba_fixture_interrupt")
        .await
        .unwrap();
    // Block catalog writes, but allow preflight reads. Install the interruption
    // only after the migrator reaches CREATE TABLE, then let its transaction run.
    let mut blocker = tokio::time::timeout(
        Duration::from_secs(5),
        PgConnection::connect_with(&database_options(&config.admin).unwrap()),
    )
    .await
    .expect("bounded blocker connection")
    .unwrap();
    tokio::time::timeout(
        Duration::from_secs(5),
        blocker.execute("BEGIN; LOCK TABLE pg_catalog.pg_class IN SHARE MODE"),
    )
    .await
    .expect("bounded catalog lock acquisition")
    .unwrap();
    let application = format!("zobba_interrupt_{}", std::process::id());
    let mut interrupted_url = url::Url::parse(&config.migration).unwrap();
    let query: Vec<(String, String)> = interrupted_url
        .query_pairs()
        .filter(|(key, _)| key != "application_name")
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect();
    interrupted_url.set_query(None);
    interrupted_url
        .query_pairs_mut()
        .extend_pairs(query)
        .append_pair("application_name", &application);
    let (result, before) = tokio::join!(migrate(interrupted_url.as_str(), &target), async {
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            let blocked: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_locks l JOIN pg_catalog.pg_stat_activity a ON a.pid=l.pid WHERE l.database=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database()) AND a.datname=current_database() AND a.usename=$1 AND a.application_name=$2 AND l.relation='pg_catalog.pg_class'::regclass AND l.mode='RowExclusiveLock' AND NOT l.granted)").bind(migrator_role).bind(&application).fetch_one(&mut privileged).await.unwrap();
            if blocked {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "migration never reached catalog writes"
            );
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        privileged.execute(trigger).await.unwrap();
        let before = snapshot(conn).await;
        blocker.execute("COMMIT").await.unwrap();
        before
    });
    assert_eq!(result, Err(BootstrapError::MigrationFailed));
    assert_eq!(
        before,
        snapshot(conn).await,
        "interrupted transaction left bootstrap objects or grants"
    );
    privileged.execute("DROP EVENT TRIGGER zobba_fixture_interrupt; DROP FUNCTION pg_catalog.zobba_fixture_interrupt()").await.unwrap();
    migrate(&config.migration, &target)
        .await
        .expect("retry after interrupted bootstrap");
    reset(config, conn).await;
    // Unsafe privileges arriving via defaults must fail the post-grant check
    // and roll back ledger/bootstrap instead of reporting a usable migration.
    privileged.execute(format!("ALTER DEFAULT PRIVILEGES FOR ROLE \"{migrator_role}\" IN SCHEMA public GRANT UPDATE ON TABLES TO \"{target}\"").as_str()).await.unwrap();
    migration_refused_without_mutation(conn, config, &target, BootstrapError::UnsafeRuntimeRole)
        .await;
    privileged.execute(format!("ALTER DEFAULT PRIVILEGES FOR ROLE \"{migrator_role}\" IN SCHEMA public REVOKE UPDATE ON TABLES FROM \"{target}\"").as_str()).await.unwrap();
    migrate(&config.migration, role)
        .await
        .expect("retry after invalid default grants removed");
    privileged.execute(format!("DROP OWNED BY \"{target}\",\"{parent}\",\"{login}\"; DROP ROLE \"{target}\",\"{parent}\",\"{login}\"").as_str()).await.unwrap();
    reset(config, conn).await;
}

async fn lock_and_blackhole(config: &Configuration, conn: &mut PgConnection) {
    use std::sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    };
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    config.guard_connection(conn).await;
    let runtime = database_options(&config.runtime).unwrap();
    let role = runtime.get_username().to_owned();
    let before = snapshot(conn).await;
    conn.execute("SELECT pg_catalog.pg_advisory_lock(9026020001)")
        .await
        .unwrap();
    let url = config.migration.clone();
    let next_role = role.clone();
    let (waiting, ()) = tokio::join!(migrate(&url, &next_role), async {
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            let blocked:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_locks WHERE locktype='advisory' AND NOT granted AND classid=2 AND objid=436085409)").fetch_one(&mut *conn).await.unwrap();
            if blocked {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "second migrator never waited on the migration lock"
            );
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert_eq!(
            before,
            snapshot(conn).await,
            "waiting migrator mutated before acquiring lock"
        );
        conn.execute("SELECT pg_catalog.pg_advisory_unlock(9026020001)")
            .await
            .unwrap();
    });
    waiting.expect("waiting migration resumes after release");
    reset(config, conn).await;

    // Relay authentication, then blackhole replies AFTER the migration lock
    // request reaches PostgreSQL. This exercises a post-connect network stall.
    let source = database_options(&config.migration).unwrap();
    let upstream = (source.get_host().to_owned(), source.get_port());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let seen = Arc::new(AtomicBool::new(false));
    let proxy_seen = seen.clone();
    let proxy = tokio::spawn(async move {
        let (client, _) = listener.accept().await.unwrap();
        let server = tokio::net::TcpStream::connect(upstream).await.unwrap();
        let (mut client_read, mut client_write) = client.into_split();
        let (mut server_read, mut server_write) = server.into_split();
        let mut client_buffer = [0u8; 8192];
        let mut server_buffer = [0u8; 8192];
        let mut tail = Vec::new();
        loop {
            tokio::select! {
                result=client_read.read(&mut client_buffer) => {
                    let size=result.unwrap_or(0);
                    if size==0 {break;}
                    tail.extend_from_slice(&client_buffer[..size]);
                    if tail.windows(b"pg_advisory_lock".len()).any(|part|part==b"pg_advisory_lock") {proxy_seen.store(true,Ordering::SeqCst);}
                    if tail.len()>64 {tail.drain(..tail.len()-64);}
                    if server_write.write_all(&client_buffer[..size]).await.is_err() {break;}
                }
                result=server_read.read(&mut server_buffer) => {
                    let size=result.unwrap_or(0);
                    if size==0 {break;}
                    if !proxy_seen.load(Ordering::SeqCst) && client_write.write_all(&server_buffer[..size]).await.is_err() {break;}
                }
            }
        }
    });
    let mut url = url::Url::parse(&config.migration).unwrap();
    url.set_host(Some("127.0.0.1")).unwrap();
    url.set_port(Some(port)).unwrap();
    let started = Instant::now();
    assert_eq!(
        migrate(url.as_str(), &role).await,
        Err(BootstrapError::DatabaseUnavailable)
    );
    assert!(
        seen.load(Ordering::SeqCst),
        "fixture never reached post-connect migration lock"
    );
    assert!(
        started.elapsed() < Duration::from_secs(12),
        "whole migration deadline exceeded"
    );
    tokio::time::timeout(Duration::from_secs(2), proxy)
        .await
        .expect("timed-out connection closed")
        .unwrap();
    let released: bool = sqlx::query_scalar("SELECT pg_catalog.pg_try_advisory_lock(9026020001)")
        .fetch_one(&mut *conn)
        .await
        .unwrap();
    assert!(released, "deadline leaked migration advisory lock");
    conn.execute("SELECT pg_catalog.pg_advisory_unlock(9026020001)")
        .await
        .unwrap();
    assert_eq!(
        before,
        snapshot(conn).await,
        "blackholed preflight changed schema"
    );
    migrate(&config.migration, &role)
        .await
        .expect("retry after blackhole deadline");
}

async fn upgrade_contract(config: &Configuration, conn: &mut PgConnection) {
    let role = database_options(&config.runtime)
        .unwrap()
        .get_username()
        .to_owned();
    let published = [
        include_str!("../../../migrations/0001_bootstrap.sql"),
        include_str!("../../../migrations/0002_identity_scope.sql"),
        include_str!("../../../migrations/0003_tasks.sql"),
        include_str!("../../../migrations/0004_permissions_operations.sql"),
        include_str!("../../../migrations/0005_membership_administration.sql"),
        include_str!("../../../migrations/0006_evidence.sql"),
        include_str!("../../../migrations/0007_admin_continuity.sql"),
    ];
    let migrator = sqlx::migrate!("../../migrations");
    for prefix in [1_usize, 2, 3, 4, 5, 6, 7] {
        for corruption in [None, Some("checksum"), Some("catalog")] {
            reset(config, conn).await;
            // Execute the exact published bytes with their original SQLx ledger.
            // Neither an edited current schema nor a marker downgrade proves upgrade.
            conn.execute("CREATE TABLE public._sqlx_migrations(version bigint PRIMARY KEY,description text NOT NULL,installed_on timestamptz NOT NULL DEFAULT now(),success boolean NOT NULL,checksum bytea NOT NULL,execution_time bigint NOT NULL)").await.unwrap();
            for (sql, migration) in published.iter().zip(migrator.iter()).take(prefix) {
                conn.execute(*sql).await.unwrap();
                sqlx::query("INSERT INTO public._sqlx_migrations(version,description,success,checksum,execution_time) VALUES($1,$2,true,$3,0)")
                    .bind(migration.version).bind(migration.description.as_ref()).bind(migration.checksum.as_ref()).execute(&mut *conn).await.unwrap();
            }
            conn.execute(format!("REVOKE ALL ON public._sqlx_migrations FROM PUBLIC; GRANT USAGE ON SCHEMA public TO \"{role}\"; GRANT SELECT ON public._sqlx_migrations,public.zobba_bootstrap TO \"{role}\"").as_str()).await.unwrap();
            if prefix >= 2 {
                conn.execute(format!("GRANT SELECT ON public.identities,public.login_attempts,public.sessions,public.organisations,public.clients,public.engagements,public.organisation_memberships,public.engagement_assignments TO \"{role}\"; GRANT INSERT(id,issuer,subject,display_name),UPDATE(display_name) ON public.identities TO \"{role}\"; GRANT INSERT,DELETE ON public.login_attempts,public.sessions TO \"{role}\"; GRANT UPDATE(name) ON public.engagements TO \"{role}\"").as_str()).await.unwrap();
            }
            refused_without_mutation(conn, &config.runtime, BootstrapError::SchemaMismatch).await;
            if let Some(corruption) = corruption {
                let sql = match corruption {
                    "checksum" => "UPDATE public._sqlx_migrations SET checksum='\\x00'::bytea",
                    "catalog" if prefix >= 2 => {
                        "ALTER POLICY scoped_engagement_update ON public.engagements USING (true) WITH CHECK (true)"
                    }
                    "catalog" => {
                        "ALTER TABLE public.zobba_bootstrap DROP CONSTRAINT zobba_bootstrap_product_check"
                    }
                    _ => unreachable!(),
                };
                conn.execute(sql).await.unwrap();
                migration_refused_without_mutation(
                    conn,
                    config,
                    &role,
                    BootstrapError::SchemaMismatch,
                )
                .await;
            } else {
                let before: Vec<String> = sqlx::query_scalar(
                    "SELECT pg_catalog.to_jsonb(m)::text FROM public._sqlx_migrations m ORDER BY version",
                )
                .fetch_all(&mut *conn)
                .await
                .unwrap();
                assert_eq!(before.len(), prefix);
                migrate(&config.migration, &role)
                    .await
                    .expect("verified historical prefix upgrades");
                let after: Vec<String> = sqlx::query_scalar(
                    "SELECT pg_catalog.to_jsonb(m)::text FROM public._sqlx_migrations m WHERE version <= $1 ORDER BY version",
                )
                .bind(prefix as i64)
                .fetch_all(&mut *conn)
                .await
                .unwrap();
                assert_eq!(before, after, "upgrade changed historical migration ledger");
                let all: Vec<String> = sqlx::query_scalar(
                    "SELECT pg_catalog.to_jsonb(m)::text FROM public._sqlx_migrations m ORDER BY version",
                )
                .fetch_all(&mut *conn)
                .await
                .unwrap();
                assert_eq!(all.len(), 12, "upgrade did not reach the complete ledger");
                let database = RuntimeDatabase::connect(&config.runtime).await.unwrap();
                assert_eq!(database.check().await.unwrap().0, 12);
                migrate(&config.migration, &role)
                    .await
                    .expect("upgrade repeat is safe");
                let repeated: Vec<String> = sqlx::query_scalar(
                    "SELECT pg_catalog.to_jsonb(m)::text FROM public._sqlx_migrations m ORDER BY version",
                )
                .fetch_all(&mut *conn)
                .await
                .unwrap();
                assert_eq!(all, repeated, "repeat changed an upgraded ledger");
            }
        }
    }
    reset(config, conn).await;
}

// FK trigger modes are catalog authority too: intact FK definitions are insufficient.
async fn internal_trigger_contract(config: &Configuration, conn: &mut PgConnection) {
    let mut privileged = PgConnection::connect(&config.admin).await.unwrap();
    config.guard_connection(&mut privileged).await;
    let role = database_options(&config.runtime)
        .unwrap()
        .get_username()
        .to_owned();
    for mutation in [
        "ALTER TABLE public.engagements DISABLE TRIGGER ALL",
        "ALTER TABLE public.clients DISABLE TRIGGER ALL",
        "DO $$ DECLARE target name; BEGIN SELECT tgname INTO STRICT target FROM pg_catalog.pg_trigger WHERE tgrelid='public.engagements'::regclass AND tgisinternal ORDER BY tgname LIMIT 1; EXECUTE pg_catalog.format('ALTER TABLE public.engagements ENABLE REPLICA TRIGGER %I',target); END $$",
        "DO $$ DECLARE target name; BEGIN SELECT tgname INTO STRICT target FROM pg_catalog.pg_trigger WHERE tgrelid='public.engagements'::regclass AND tgisinternal ORDER BY tgname LIMIT 1; EXECUTE pg_catalog.format('ALTER TABLE public.engagements ENABLE ALWAYS TRIGGER %I',target); END $$",
    ] {
        privileged
            .execute(mutation)
            .await
            .expect("arrange altered internal FK trigger fixture");
        refused_without_mutation(conn, &config.runtime, BootstrapError::SchemaMismatch).await;
        migration_refused_without_mutation(conn, config, &role, BootstrapError::SchemaMismatch)
            .await;
        reset(config, conn).await;
        migrate(&config.migration, &role)
            .await
            .expect("ordinary internal FK triggers remain supported");
    }
}
/// Table policy proof independent of repository filters: shared organisation
/// limits cross engagements, exact requests and late receipts never do.
async fn schema4_scope_contract(config: &Configuration) {
    // The migration owner remains subject to forced RLS. Only this explicitly
    // guarded fixture connection arranges synthetic rows and revocation; all
    // migration/readiness checks above retain the restricted migration role.
    let mut admin = PgConnection::connect(&config.admin).await.unwrap();
    config.guard_connection(&mut admin).await;
    admin.execute(r#"
      BEGIN;
      INSERT INTO public.identities(id,issuer,subject,display_name) VALUES('schema4_actor','schema4','actor','Schema fixture'),('schema4_admin','schema4','admin','Schema Admin');
      INSERT INTO public.organisations(id,name) VALUES('schema4_org','Schema fixture');
      INSERT INTO public.clients(organisation_id,id,name) VALUES('schema4_org','a','A'),('schema4_org','b','B');
      INSERT INTO public.engagements(organisation_id,client_id,id,name) VALUES('schema4_org','a','a','A'),('schema4_org','b','b','B');
      INSERT INTO public.organisation_memberships(organisation_id,actor_id,roles) VALUES('schema4_org','schema4_actor',ARRAY['auditor']),('schema4_org','schema4_admin',ARRAY['admin']);
      INSERT INTO public.engagement_assignments(organisation_id,client_id,engagement_id,actor_id) VALUES('schema4_org','a','a','schema4_actor'),('schema4_org','b','b','schema4_actor');
      INSERT INTO public.tasks(organisation_id,client_id,engagement_id,id,cycle_id,accountable_actor,objective,working_brief,state,cessation) VALUES('schema4_org','a','a','schema4_task','schema4_cycle','schema4_actor','Scope proof','Scope proof','running','none');
      INSERT INTO public.task_cycles(organisation_id,client_id,engagement_id,task_id,id,status) VALUES('schema4_org','a','a','schema4_task','schema4_cycle','active');
      INSERT INTO public.permission_versions(organisation_id,policy_key,client_id,engagement_id,kind,subject_id,version,document,actor_id) VALUES
        ('schema4_org','shared',NULL,NULL,'organisation','schema4_org',1,'shared authority','schema4_actor'),
        ('schema4_org','scope_a','a','a','engagement','a',1,'scope A canary','schema4_actor'),
        ('schema4_org','scope_b','b','b','engagement','b',1,'scope B canary','schema4_actor');
      INSERT INTO public.permission_heads(organisation_id,policy_key,current_version,client_id,engagement_id) SELECT organisation_id,policy_key,version,client_id,engagement_id FROM public.permission_versions;
      INSERT INTO public.operations(organisation_id,client_id,engagement_id,id,task_id,cycle_id,actor_id,key,request,source_binding,request_digest,authority_snapshot,basis) VALUES('schema4_org','a','a','schema4_op','schema4_task','schema4_cycle','schema4_actor','schema4_key','request canary','{"source_id":"schema4_source","ledger_id":"schema4_ledger","endpoint_digest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","contract_version":1}',repeat('a',64),'{}','{}');
      INSERT INTO public.operation_attempts(organisation_id,client_id,engagement_id,id,operation_id,attempt_number,source_binding,basis) VALUES('schema4_org','a','a','schema4_attempt','schema4_op',1,'{"source_id":"schema4_source","ledger_id":"schema4_ledger","endpoint_digest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","contract_version":1}','{}');
      INSERT INTO public.operation_claims(organisation_id,client_id,engagement_id,id,operation_id,attempt_id,state,consumed_at) VALUES('schema4_org','a','a','schema4_claim','schema4_op','schema4_attempt','consumed',clock_timestamp());
      INSERT INTO public.operation_attempts(organisation_id,client_id,engagement_id,id,operation_id,attempt_number,source_binding,basis) VALUES('schema4_org','a','a','schema4_other_attempt','schema4_op',2,'{"source_id":"schema4_source","ledger_id":"schema4_ledger","endpoint_digest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","contract_version":1}','{}');
      INSERT INTO public.operation_receipt_producers(organisation_id,client_id,engagement_id,attempt_id,producer_id) VALUES('schema4_org','a','a','schema4_attempt','original'),('schema4_org','a','a','schema4_attempt','recovery'),('schema4_org','a','a','schema4_other_attempt','original');
      INSERT INTO public.operation_receipt_slots(organisation_id,client_id,engagement_id,attempt_id,producer_id,capability_hash,custody) VALUES('schema4_org','a','a','schema4_attempt','original',repeat('b',64),'dispatch'),('schema4_org','a','a','schema4_attempt','recovery',repeat('c',64),'reconciliation'),('schema4_org','a','a','schema4_other_attempt','original',repeat('d',64),'dispatch');
      INSERT INTO public.operation_receipts(organisation_id,client_id,engagement_id,id,attempt_id,producer_id,key,outcome,source) VALUES('schema4_org','a','a','schema4_other_fact','schema4_other_attempt','original','other','completed','dispatch');
      COMMIT;
    "#).await.unwrap();
    // A non-superuser schema owner can register trusted fixture metadata while
    // ordinary runtime principals retain no registration or mutation privilege.
    let mut registrar = PgConnection::connect(&config.migration).await.unwrap();
    registrar.execute("INSERT INTO public.trusted_attachment_metadata(organisation_id,client_id,engagement_id,source_key,attachment_id,digest,classification) VALUES('schema4_org','a','a','schema4_source','attachment_a',repeat('a',64),'internal'),('schema4_org','b','b','schema4_source','attachment_b',repeat('b',64),'restricted');").await.expect("trusted schema owner can register attachment metadata");
    registrar.close().await.unwrap();
    let mut runtime = PgConnection::connect(&config.runtime).await.unwrap();
    runtime.execute("SELECT set_config('zobba.actor_id','schema4_actor',false),set_config('zobba.organisation_id','schema4_org',false),set_config('zobba.client_id','a',false),set_config('zobba.engagement_id','a',false)").await.unwrap();
    let documents: Vec<String> =
        sqlx::query_scalar("SELECT document FROM public.permission_versions ORDER BY document")
            .fetch_all(&mut runtime)
            .await
            .unwrap();
    assert_eq!(documents, ["scope A canary", "shared authority"]);
    let attachments: Vec<String> =
        sqlx::query_scalar("SELECT attachment_id FROM public.trusted_attachment_metadata")
            .fetch_all(&mut runtime)
            .await
            .unwrap();
    assert_eq!(
        attachments,
        ["attachment_a"],
        "trusted metadata follows the current scope"
    );
    assert_eq!(runtime.execute("UPDATE public.operation_claims SET state='admitted',consumed_at=NULL WHERE id='schema4_claim'").await.unwrap().rows_affected(), 0, "consumed one-use claims cannot be reset even with direct runtime SQL");

    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM public.operation_receipt_producers WHERE attempt_id='schema4_attempt'")
            .fetch_one(&mut runtime)
            .await
            .unwrap(),
        2,
        "scoped recovery can bound how many capability slots were minted"
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(capability_hash) FROM public.operation_receipt_slots"
        )
        .fetch_one(&mut runtime)
        .await
        .unwrap(),
        0,
        "ordinary scoped access cannot retrieve stored capability digests"
    );
    assert!(runtime.execute("INSERT INTO public.operation_receipts(organisation_id,client_id,engagement_id,id,attempt_id,producer_id,key,outcome,source) VALUES('schema4_org','a','a','schema4_uncap','schema4_attempt','original','uncap','completed','dispatch')").await.is_err(), "current membership alone cannot append producer facts");
    runtime.execute("SELECT set_config('zobba.client_id','b',false),set_config('zobba.engagement_id','b',false)").await.unwrap();
    let documents: Vec<String> =
        sqlx::query_scalar("SELECT document FROM public.permission_versions ORDER BY document")
            .fetch_all(&mut runtime)
            .await
            .unwrap();
    assert_eq!(documents, ["scope B canary", "shared authority"]);
    let attachments: Vec<String> =
        sqlx::query_scalar("SELECT attachment_id FROM public.trusted_attachment_metadata")
            .fetch_all(&mut runtime)
            .await
            .unwrap();
    assert_eq!(attachments, ["attachment_b"]);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM public.operations")
            .fetch_one(&mut runtime)
            .await
            .unwrap(),
        0
    );
    // Scope B cannot point its head at scope A, even when it guesses the key.
    assert!(runtime.execute("INSERT INTO public.permission_heads(organisation_id,policy_key,current_version,client_id,engagement_id) VALUES('schema4_org','scope_a',1,'b','b')").await.is_err());
    admin.execute("UPDATE public.organisation_memberships SET active=false WHERE organisation_id='schema4_org' AND actor_id='schema4_actor'").await.unwrap();
    runtime.execute("SELECT set_config('zobba.client_id','a',false),set_config('zobba.engagement_id','a',false),set_config('zobba.receipt_claim','schema4_attempt',false),set_config('zobba.receipt_hash',repeat('b',64),false),set_config('zobba.receipt_org','schema4_org',false),set_config('zobba.receipt_client','a',false),set_config('zobba.receipt_engagement','a',false)").await.unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM public.permission_versions")
            .fetch_one(&mut runtime)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM public.operations")
            .fetch_one(&mut runtime)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM public.operation_claims")
            .fetch_one(&mut runtime)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM public.trusted_attachment_metadata")
            .fetch_one(&mut runtime)
            .await
            .unwrap(),
        0,
        "revocation hides trusted attachment metadata"
    );
    runtime.execute("INSERT INTO public.operation_receipts(organisation_id,client_id,engagement_id,id,attempt_id,producer_id,key,outcome,source) VALUES('schema4_org','a','a','schema4_late','schema4_attempt','original','late','pending','dispatch')").await.expect("revoked producer retains exact receipt-only authority");
    assert!(runtime.execute("INSERT INTO public.operation_receipts(organisation_id,client_id,engagement_id,id,attempt_id,producer_id,key,outcome,source) VALUES('schema4_org','a','a','schema4_wrong','schema4_attempt','recovery','wrong','completed','reconciliation')").await.is_err(), "original capability cannot impersonate recovery producer");
    runtime
        .execute("SELECT set_config('zobba.receipt_hash',repeat('c',64),false)")
        .await
        .unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM public.operation_receipts")
            .fetch_one(&mut runtime)
            .await
            .unwrap(),
        1,
        "recovery capability reads all exact-attempt facts across producers, excluding other attempts"
    );
    runtime.execute("SELECT set_config('zobba.receipt_hash',repeat('b',64),false),set_config('zobba.receipt_client','b',false)").await.unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM public.operation_receipts")
            .fetch_one(&mut runtime)
            .await
            .unwrap(),
        0,
        "exact receipt capability also binds scope"
    );
    runtime.close().await.unwrap();
}

/// Function identity, grants and owner are checked before any owned entry point
/// runs; a refused migration may not silently repair an altered authority.
async fn membership_function_authority(config: &Configuration, conn: &mut PgConnection) {
    let role = database_options(&config.runtime)
        .unwrap()
        .get_username()
        .to_owned();
    let owner: String = sqlx::query_scalar("SELECT current_user::text")
        .fetch_one(&mut *conn)
        .await
        .unwrap();
    let mut privileged = PgConnection::connect(&config.admin).await.unwrap();
    config.guard_connection(&mut privileged).await;
    for mutation in [
        format!("GRANT EXECUTE ON FUNCTION public.admin_continuity_assert(text) TO \"{role}\""),
        format!(
            "GRANT EXECUTE ON FUNCTION public.admin_continuity_lock() TO \"{role}\" WITH GRANT OPTION"
        ),
        format!("ALTER FUNCTION public.admin_continuity_check() OWNER TO \"{role}\""),
        format!("GRANT EXECUTE ON FUNCTION public.membership_validate(text,jsonb) TO \"{role}\""),
        format!(
            "GRANT EXECUTE ON FUNCTION public.membership_write(text,text,text,text,jsonb,text,text,text) TO \"{role}\" WITH GRANT OPTION"
        ),
        format!(
            "REVOKE EXECUTE ON FUNCTION public.membership_accept(text,text,text,text,text,text) FROM \"{role}\""
        ),
        format!(
            "ALTER FUNCTION public.membership_preview(text,text,text,text) OWNER TO \"{role}\""
        ),
    ] {
        privileged.execute(mutation.as_str()).await.unwrap();
        refused_without_mutation(conn, &config.runtime, BootstrapError::SchemaMismatch).await;
        // A missing owned EXECUTE can be restored by explicit migration. Other
        // altered private/grantable/owner authority is refused before mutation.
        if mutation.starts_with("REVOKE") {
            migrate(&config.migration, &role)
                .await
                .expect("explicit migration restores missing public entry point grant");
        } else {
            migration_refused_without_mutation(conn, config, &role, BootstrapError::SchemaMismatch)
                .await;
            privileged.execute(format!("ALTER FUNCTION public.membership_preview(text,text,text,text) OWNER TO \"{owner}\"").as_str()).await.unwrap();
            reset(config, conn).await;
            migrate(&config.migration, &role).await.unwrap();
        }
    }
}

async fn methodology_function_authority(config: &Configuration, conn: &mut PgConnection) {
    let role = database_options(&config.runtime)
        .unwrap()
        .get_username()
        .to_owned();
    let mut privileged = PgConnection::connect(&config.admin).await.unwrap();
    config.guard_connection(&mut privileged).await;
    for mutation in [
        format!("GRANT EXECUTE ON FUNCTION public.methodology_audit(text,text,text) TO \"{role}\""),
        format!(
            "GRANT EXECUTE ON FUNCTION public.methodology_write(text,text,text,text,jsonb,text,text) TO \"{role}\" WITH GRANT OPTION"
        ),
        format!("ALTER FUNCTION public.methodology_task(text,text,jsonb) OWNER TO \"{role}\""),
        format!(
            "REVOKE EXECUTE ON FUNCTION public.methodology_read(text,text,text) FROM \"{role}\""
        ),
        format!(
            "REVOKE EXECUTE ON FUNCTION public.methodology_write(text,text,text,text,jsonb,text,text) FROM \"{role}\""
        ),
        format!(
            "REVOKE EXECUTE ON FUNCTION public.methodology_candidates(text,text,text,bigint) FROM \"{role}\""
        ),
        format!(
            "REVOKE EXECUTE ON FUNCTION public.methodology_task(text,text,jsonb) FROM \"{role}\""
        ),
    ] {
        privileged.execute(mutation.as_str()).await.unwrap();
        refused_without_mutation(conn, &config.runtime, BootstrapError::SchemaMismatch).await;
        if mutation.starts_with("REVOKE") {
            migrate(&config.migration, &role)
                .await
                .expect("explicit migration restores missing methodology entry point");
        } else {
            migration_refused_without_mutation(conn, config, &role, BootstrapError::SchemaMismatch)
                .await;
            reset(config, conn).await;
            migrate(&config.migration, &role).await.unwrap();
        }
        RuntimeDatabase::connect(&config.runtime)
            .await
            .unwrap()
            .pool()
            .close()
            .await;
    }
}

async fn skills_function_authority(config: &Configuration, conn: &mut PgConnection) {
    let role = database_options(&config.runtime)
        .unwrap()
        .get_username()
        .to_owned();
    let mut privileged = PgConnection::connect(&config.admin).await.unwrap();
    config.guard_connection(&mut privileged).await;
    for mutation in [
        format!(
            "GRANT EXECUTE ON FUNCTION public.skills_write(text,text,text,text,jsonb,text,text,text,jsonb) TO \"{role}\" WITH GRANT OPTION"
        ),
        format!("ALTER FUNCTION public.skills_task(text,text,jsonb) OWNER TO \"{role}\""),
        format!("REVOKE EXECUTE ON FUNCTION public.skills_read(text,text,text) FROM \"{role}\""),
        format!(
            "REVOKE EXECUTE ON FUNCTION public.skills_admin(text,text,text,text,jsonb) FROM \"{role}\""
        ),
        format!("REVOKE EXECUTE ON FUNCTION public.skills_impact(text,jsonb) FROM \"{role}\""),
        format!(
            "REVOKE EXECUTE ON FUNCTION public.skills_write(text,text,text,text,jsonb,text,text,text,jsonb) FROM \"{role}\""
        ),
        format!("REVOKE EXECUTE ON FUNCTION public.skills_task(text,text,jsonb) FROM \"{role}\""),
    ] {
        privileged.execute(mutation.as_str()).await.unwrap();
        refused_without_mutation(conn, &config.runtime, BootstrapError::SchemaMismatch).await;
        if mutation.starts_with("REVOKE") {
            migrate(&config.migration, &role)
                .await
                .expect("explicit migration restores missing skills entry point");
        } else {
            migration_refused_without_mutation(conn, config, &role, BootstrapError::SchemaMismatch)
                .await;
            reset(config, conn).await;
            migrate(&config.migration, &role).await.unwrap();
        }
        RuntimeDatabase::connect(&config.runtime)
            .await
            .unwrap()
            .pool()
            .close()
            .await;
    }
}

async fn knowledge_function_authority(config: &Configuration, conn: &mut PgConnection) {
    let role = database_options(&config.runtime)
        .unwrap()
        .get_username()
        .to_owned();
    let mut privileged = PgConnection::connect(&config.admin).await.unwrap();
    config.guard_connection(&mut privileged).await;
    for mutation in [
        format!(
            "GRANT EXECUTE ON FUNCTION public.knowledge_audit(text,text,text,text) TO \"{role}\" WITH GRANT OPTION"
        ),
        format!("ALTER FUNCTION public.knowledge_release_active(text,text) OWNER TO \"{role}\""),
        format!(
            "REVOKE EXECUTE ON FUNCTION public.knowledge_audit(text,text,text,text) FROM \"{role}\""
        ),
        format!(
            "REVOKE EXECUTE ON FUNCTION public.knowledge_release_active(text,text) FROM \"{role}\""
        ),
    ] {
        privileged.execute(mutation.as_str()).await.unwrap();
        refused_without_mutation(conn, &config.runtime, BootstrapError::SchemaMismatch).await;
        if mutation.starts_with("REVOKE") {
            migrate(&config.migration, &role)
                .await
                .expect("explicit migration restores missing narrow knowledge authority function");
        } else {
            migration_refused_without_mutation(conn, config, &role, BootstrapError::SchemaMismatch)
                .await;
            reset(config, conn).await;
            migrate(&config.migration, &role).await.unwrap();
        }
        RuntimeDatabase::connect(&config.runtime)
            .await
            .unwrap()
            .pool()
            .close()
            .await;
    }
}

// Runtime execution is limited to the new session-bound configuration predicate.
async fn model_function_authority(config: &Configuration, conn: &mut PgConnection) {
    let role = database_options(&config.runtime)
        .unwrap()
        .get_username()
        .to_owned();
    let mut privileged = PgConnection::connect(&config.admin).await.unwrap();
    config.guard_connection(&mut privileged).await;
    for mutation in [
        format!(
            "GRANT EXECUTE ON FUNCTION public.model_configuration_admin(text,text,text) TO \"{role}\" WITH GRANT OPTION"
        ),
        format!(
            "ALTER FUNCTION public.model_configuration_admin(text,text,text) OWNER TO \"{role}\""
        ),
        format!(
            "REVOKE EXECUTE ON FUNCTION public.model_configuration_admin(text,text,text) FROM \"{role}\""
        ),
    ] {
        privileged.execute(mutation.as_str()).await.unwrap();
        refused_without_mutation(conn, &config.runtime, BootstrapError::SchemaMismatch).await;
        if mutation.starts_with("REVOKE") {
            migrate(&config.migration, &role).await.expect(
                "explicit migration restores missing narrow model configuration authority function",
            );
        } else {
            migration_refused_without_mutation(conn, config, &role, BootstrapError::SchemaMismatch)
                .await;
            reset(config, conn).await;
            migrate(&config.migration, &role).await.unwrap();
        }
        RuntimeDatabase::connect(&config.runtime)
            .await
            .unwrap()
            .pool()
            .close()
            .await;
    }
}

// A populated published schema 7 is upgraded by the restricted migration role.
// Existing Task commands retain their bytes; bindings explicitly label their neutral legacy basis.
async fn methodology_upgrade_contract(config: &Configuration, conn: &mut PgConnection) {
    let role = database_options(&config.runtime)
        .unwrap()
        .get_username()
        .to_owned();
    install_schema6(config, conn).await;
    let migrator = sqlx::migrate!("../../migrations");
    let migration = migrator.iter().nth(6).unwrap();
    conn.execute(migration.sql.as_ref()).await.unwrap();
    sqlx::query("INSERT INTO public._sqlx_migrations(version,description,success,checksum,execution_time) VALUES($1,$2,true,$3,0)")
        .bind(migration.version).bind(migration.description.as_ref()).bind(migration.checksum.as_ref())
        .execute(&mut *conn).await.unwrap();
    let catalog: Vec<String> = sqlx::query_scalar(include_str!("../src/catalog-signature.sql"))
        .fetch_all(&mut *conn)
        .await
        .unwrap();
    assert!(
        catalog
            .iter()
            .map(String::as_str)
            .eq(include_str!("../src/schema-v7.catalog").lines()),
        "upgrade must start from the published schema 7 catalog"
    );
    let ledger: Vec<String> = sqlx::query_scalar(
        "SELECT to_jsonb(m)::text FROM public._sqlx_migrations m ORDER BY version",
    )
    .fetch_all(&mut *conn)
    .await
    .unwrap();
    let mut admin = PgConnection::connect(&config.admin).await.unwrap();
    config.guard_connection(&mut admin).await;
    let mut seed = admin.begin().await.unwrap();
    seed.execute("SET TRANSACTION ISOLATION LEVEL READ COMMITTED")
        .await
        .unwrap();
    seed.execute(r#"
      INSERT INTO public.identities(id,issuer,subject,display_name) VALUES('methodology-upgrade','upgrade','methodology','Upgrade Auditor');
      INSERT INTO public.organisations VALUES('methodology-upgrade','Upgrade');
      INSERT INTO public.organisation_memberships(organisation_id,actor_id,roles) VALUES('methodology-upgrade','methodology-upgrade',ARRAY['admin','auditor']);
      INSERT INTO public.clients VALUES('methodology-upgrade','client','Client');
      INSERT INTO public.engagements(organisation_id,client_id,id,name) VALUES('methodology-upgrade','client','engagement','Engagement');
      INSERT INTO public.engagement_assignments(organisation_id,client_id,engagement_id,actor_id) VALUES('methodology-upgrade','client','engagement','methodology-upgrade');
      SELECT set_config('zobba.actor_id','methodology-upgrade',true),set_config('zobba.organisation_id','methodology-upgrade',true),set_config('zobba.client_id','client',true),set_config('zobba.engagement_id','engagement',true);
      INSERT INTO public.tasks(organisation_id,client_id,engagement_id,id,cycle_id,accountable_actor,objective,working_brief,state,cessation) VALUES('methodology-upgrade','client','engagement','legacy-task','legacy-cycle','methodology-upgrade','Existing objective','Existing brief','ready','none');
      INSERT INTO public.task_cycles VALUES('methodology-upgrade','client','engagement','legacy-task','legacy-cycle','active');
      INSERT INTO public.task_commands(organisation_id,client_id,engagement_id,id,author_id,idempotency_key,kind,content,task_id,cycle_id,received_cursor,intent_revision) VALUES('methodology-upgrade','client','engagement','legacy-command','methodology-upgrade','legacy-key','create','Existing objective','legacy-task','legacy-cycle',1,1);
    "#).await.unwrap();
    seed.commit().await.unwrap();
    let command_before: String = sqlx::query_scalar(
        "SELECT to_jsonb(c)::text FROM public.task_commands c WHERE id='legacy-command'",
    )
    .fetch_one(&mut admin)
    .await
    .unwrap();
    let task_before: String =
        sqlx::query_scalar("SELECT to_jsonb(t)::text FROM public.tasks t WHERE id='legacy-task'")
            .fetch_one(&mut admin)
            .await
            .unwrap();
    migrate(&config.migration, &role)
        .await
        .expect("populated schema 7 upgrades through the migration connection");
    let ledger_after: Vec<String> = sqlx::query_scalar(
        "SELECT to_jsonb(m)::text FROM public._sqlx_migrations m WHERE version<=7 ORDER BY version",
    )
    .fetch_all(&mut *conn)
    .await
    .unwrap();
    assert_eq!(
        ledger, ledger_after,
        "upgrade changed published ledger rows"
    );
    let command_after: String = sqlx::query_scalar("SELECT (to_jsonb(c)-'methodology_context'-'received_at')::text FROM public.task_commands c WHERE id='legacy-command'")
        .fetch_one(&mut admin).await.unwrap();
    assert_eq!(
        command_before, command_after,
        "upgrade rewrote a retained Task command"
    );
    assert_legacy_command_timestamps_unknown(&mut admin).await;
    assert!(
        sqlx::query_scalar::<_, bool>(
            "SELECT methodology_context IS NULL FROM public.task_commands WHERE id='legacy-command'"
        )
        .fetch_one(&mut admin)
        .await
        .unwrap(),
        "upgrade invented context for a legacy command"
    );
    let task_after: String =
        sqlx::query_scalar("SELECT to_jsonb(t)::text FROM public.tasks t WHERE id='legacy-task'")
            .fetch_one(&mut admin)
            .await
            .unwrap();
    assert_eq!(task_before, task_after, "upgrade rewrote a retained Task");
    for table in [
        "methodology_versions",
        "methodology_assignments",
        "methodology_events",
        "methodology_recalls",
        "task_methodology_changes",
    ] {
        assert_eq!(
            sqlx::query_scalar::<_, i64>(&format!("SELECT count(*) FROM public.{table}"))
                .fetch_one(&mut admin)
                .await
                .unwrap(),
            0,
            "upgrade invented configured methodology"
        );
    }
    let (binding, context): (serde_json::Value, serde_json::Value) = sqlx::query_as("SELECT b.document,h.context FROM public.task_methodology_heads h JOIN public.task_methodology_bindings b ON (b.organisation_id,b.task_id,b.id)=(h.organisation_id,h.task_id,h.binding_id) WHERE h.task_id='legacy-task'")
        .fetch_one(&mut admin).await.expect("restricted migration must backfill each legacy Task");
    assert_eq!(
        binding["execution_epoch"], 0,
        "legacy work retains an explicit unknown neutral epoch"
    );
    assert_eq!(binding["resolution"]["status"], "neutral");
    assert_eq!(
        binding["resolution"]["neutral_source_version_ids"],
        serde_json::json!(["builtin_neutral_v1"])
    );
    assert_eq!(binding["resolution"]["version_ids"], serde_json::json!([]));
    assert_eq!(binding["resolution"]["requirements"], serde_json::json!([]));
    assert_eq!(binding["resolution"]["templates"], serde_json::json!([]));
    assert_eq!(
        context,
        serde_json::json!({"audit_area":null,"period_start":null,"period_end":null})
    );
    assert_eq!(binding["actor_id"], "methodology-upgrade");
    assert!(
        binding["resolution"]["reason"]
            .as_str()
            .unwrap()
            .contains("neutral")
    );
    let database = RuntimeDatabase::connect(&config.runtime).await.unwrap();
    assert_eq!(database.check().await.unwrap().0, 12);
    let selected = zobba_domain::identity::Scope {
        organisation_id: "methodology-upgrade".into(),
        client_id: "client".into(),
        engagement_id: "engagement".into(),
    };
    let mut proof =
        zobba_infrastructure::scope::begin(database.pool(), "methodology-upgrade", &selected)
            .await
            .unwrap();
    for epoch in [0, 1] {
        let original: serde_json::Value =
            sqlx::query_scalar("SELECT public.methodology_task('legacy-task','basis',$1)")
                .bind(serde_json::json!({"execution_epoch":epoch}))
                .fetch_one(&mut *proof)
                .await
                .unwrap();
        assert_eq!(
            original, binding["id"],
            "legacy producing epochs map to explicit neutral basis"
        );
    }
    proof.commit().await.unwrap();
    database.pool().close().await;
    migrate(&config.migration, &role)
        .await
        .expect("populated schema 8 migration is repeatable");
    let repeated: serde_json::Value = sqlx::query_scalar(
        "SELECT document FROM public.task_methodology_bindings WHERE task_id='legacy-task'",
    )
    .fetch_one(&mut admin)
    .await
    .unwrap();
    assert_eq!(binding, repeated, "repeat rewrote the legacy binding");
    reset(config, conn).await;
}

async fn install_schema6(config: &Configuration, conn: &mut PgConnection) {
    reset(config, conn).await;
    conn.execute("CREATE TABLE public._sqlx_migrations(version bigint PRIMARY KEY,description text NOT NULL,installed_on timestamptz NOT NULL DEFAULT now(),success boolean NOT NULL,checksum bytea NOT NULL,execution_time bigint NOT NULL)").await.unwrap();
    let migrator = sqlx::migrate!("../../migrations");
    for migration in migrator.iter().take(6) {
        conn.execute(migration.sql.as_ref()).await.unwrap();
        sqlx::query("INSERT INTO public._sqlx_migrations(version,description,success,checksum,execution_time) VALUES($1,$2,true,$3,0)")
            .bind(migration.version).bind(migration.description.as_ref()).bind(migration.checksum.as_ref())
            .execute(&mut *conn).await.unwrap();
    }
}

async fn authority_snapshot(conn: &mut PgConnection) -> Vec<String> {
    sqlx::query_scalar("SELECT jsonb_build_object('organisation',to_jsonb(o),'members',(SELECT jsonb_agg(to_jsonb(m) ORDER BY actor_id) FROM public.organisation_memberships m WHERE m.organisation_id=o.id),'identities',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.identities i))::text FROM public.organisations o ORDER BY o.id")
        .fetch_all(conn).await.unwrap()
}

async fn continuity_upgrade_contract(config: &Configuration, conn: &mut PgConnection) {
    let role = database_options(&config.runtime)
        .unwrap()
        .get_username()
        .to_owned();
    for invalid in [
        None,
        Some("missing"),
        Some("temporary"),
        Some("expired"),
        Some("inactive_identity"),
        Some("inactive_member"),
        Some("auditor"),
    ] {
        install_schema6(config, conn).await;
        conn.execute("INSERT INTO public.identities(id,issuer,subject,display_name) VALUES('upgrade-good','upgrade','good','Good'),('upgrade-target','upgrade','target','Target'); INSERT INTO public.organisations VALUES('upgrade-good','Good'),('upgrade-target','Target'); INSERT INTO public.organisation_memberships(organisation_id,actor_id,roles) VALUES('upgrade-good','upgrade-good',ARRAY['admin']),('upgrade-target','upgrade-target',ARRAY['admin']);").await.unwrap();
        if let Some(case) = invalid {
            conn.execute(match case {
                "missing" => "DELETE FROM public.organisation_memberships WHERE organisation_id='upgrade-target'",
                "temporary" => "UPDATE public.organisation_memberships SET expires_at=253402300799 WHERE organisation_id='upgrade-target'",
                "expired" => "UPDATE public.organisation_memberships SET expires_at=1 WHERE organisation_id='upgrade-target'",
                "inactive_identity" => "UPDATE public.identities SET active=false WHERE id='upgrade-target'",
                "inactive_member" => "UPDATE public.organisation_memberships SET active=false WHERE organisation_id='upgrade-target'",
                "auditor" => "UPDATE public.organisation_memberships SET roles=ARRAY['auditor'] WHERE organisation_id='upgrade-target'",
                _ => unreachable!(),
            }).await.unwrap();
        }
        let before = authority_snapshot(conn).await;
        let catalog_before = snapshot(conn).await;
        if invalid.is_some() {
            assert_eq!(
                migrate(&config.migration, &role).await,
                Err(BootstrapError::AdminContinuityRequired)
            );
            assert_eq!(
                authority_snapshot(conn).await,
                before,
                "refused upgrade rewrote authority"
            );
            assert_eq!(
                snapshot(conn).await,
                catalog_before,
                "refused upgrade partially installed schema/ledger/grants"
            );
            // Explicit synthetic operator remediation: a separately authorised
            // identity, not promotion/reactivation or expiry clearing by migration.
            conn.execute("INSERT INTO public.identities(id,issuer,subject,display_name) VALUES('upgrade-remediation','upgrade','remediation','Remediation'); INSERT INTO public.organisation_memberships(organisation_id,actor_id,roles) VALUES('upgrade-target','upgrade-remediation',ARRAY['admin']);").await.unwrap();
        }
        let authorised = authority_snapshot(conn).await;
        migrate(&config.migration, &role)
            .await
            .expect("valid/remediated schema 6 upgrades");
        assert_eq!(authority_snapshot(conn).await, authorised);
        let database = RuntimeDatabase::connect(&config.runtime).await.unwrap();
        assert_eq!(database.check().await.unwrap().0, 12);
        database.pool().close().await;
    }

    // The actual migrator must override connection defaults before its first
    // snapshot, while preserving valid schema-6 authority exactly.
    let options = database_options(&config.migration).unwrap();
    for default in ["repeatable read", "serializable"] {
        install_schema6(config, conn).await;
        conn.execute("INSERT INTO public.identities(id,issuer,subject,display_name) VALUES('upgrade-default','upgrade','default','Default'); INSERT INTO public.organisations VALUES('upgrade-default','Default'); INSERT INTO public.organisation_memberships(organisation_id,actor_id,roles) VALUES('upgrade-default','upgrade-default',ARRAY['admin']);").await.unwrap();
        let before = authority_snapshot(conn).await;
        let (observed, upgraded) = isolation::with_migration_default(config, default, || async {
            let mut fresh = PgConnection::connect_with(&options).await?;
            let observed: String = sqlx::query_scalar("SHOW default_transaction_isolation")
                .fetch_one(&mut fresh)
                .await?;
            fresh.close().await?;
            let upgraded = migrate(&config.migration, &role).await;
            Ok::<_, sqlx::Error>((observed, upgraded))
        })
        .await
        .unwrap();
        assert_eq!(
            observed, default,
            "fresh migration connection inherited wrong default"
        );
        upgraded.expect("real migrator overrides the higher default before upgrading schema 6");
        assert_eq!(
            authority_snapshot(conn).await,
            before,
            "upgrade changed authority"
        );
        let database = RuntimeDatabase::connect(&config.runtime).await.unwrap();
        assert_eq!(database.check().await.unwrap().0, 12);
        database.pool().close().await;
    }

    // A direct migration cannot validate an old higher-isolation snapshot. The
    // explicit CLI sets READ COMMITTED before taking any migration snapshot.
    for isolation in ["REPEATABLE READ", "SERIALIZABLE"] {
        install_schema6(config, conn).await;
        let before = snapshot(conn).await;
        let mut tx = conn.begin().await.unwrap();
        tx.execute(format!("SET TRANSACTION ISOLATION LEVEL {isolation}").as_str())
            .await
            .unwrap();
        tx.execute("SELECT count(*) FROM public.organisations")
            .await
            .unwrap();
        let error = tx
            .execute(include_str!(
                "../../../migrations/0007_admin_continuity.sql"
            ))
            .await
            .unwrap_err();
        assert_eq!(
            error.as_database_error().unwrap().code().as_deref(),
            Some("0A000")
        );
        tx.rollback().await.unwrap();
        assert_eq!(snapshot(conn).await, before);
    }

    // An old-schema writer narrows authority while upgrade waits for its table
    // lock. Preflight must see that committed change and refuse atomically.
    install_schema6(config, conn).await;
    conn.execute("INSERT INTO public.identities(id,issuer,subject,display_name) VALUES('upgrade-race','upgrade','race','Race'); INSERT INTO public.organisations VALUES('upgrade-race','Race'); INSERT INTO public.organisation_memberships(organisation_id,actor_id,roles) VALUES('upgrade-race','upgrade-race',ARRAY['admin']);").await.unwrap();
    let mut writer = PgConnection::connect(&config.migration).await.unwrap();
    let writer_pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut writer)
        .await
        .unwrap();
    let mut writer_tx = writer.begin().await.unwrap();
    writer_tx.execute("UPDATE public.organisation_memberships SET expires_at=253402300799 WHERE organisation_id='upgrade-race'").await.unwrap();
    let mut upgrade_url = url::Url::parse(&config.migration).unwrap();
    upgrade_url
        .query_pairs_mut()
        .append_pair("application_name", "continuity-upgrade-race");
    let upgrading = migrate(upgrade_url.as_str(), &role);
    let release_writer = async {
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            let waiting: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='continuity-upgrade-race' AND $1=ANY(pg_blocking_pids(pid)))")
                .bind(writer_pid).fetch_one(&mut *conn).await.unwrap();
            if waiting {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "upgrade did not wait on the old-schema writer"
            );
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        writer_tx.commit().await.unwrap();
        authority_snapshot(conn).await
    };
    let (upgraded, before) = tokio::join!(upgrading, release_writer);
    assert_eq!(upgraded, Err(BootstrapError::AdminContinuityRequired));
    assert_eq!(authority_snapshot(conn).await, before);
    let version: i64 = sqlx::query_scalar("SELECT schema_version FROM public.zobba_bootstrap")
        .fetch_one(&mut *conn)
        .await
        .unwrap();
    assert_eq!(version, 6);
    reset(config, conn).await;
    migrate(&config.migration, &role).await.unwrap();
}

// Schema 9 adds catalogue storage without rewriting any published work or basis.
async fn skills_upgrade_contract(config: &Configuration, conn: &mut PgConnection) {
    let role = database_options(&config.runtime)
        .unwrap()
        .get_username()
        .to_owned();
    install_schema6(config, conn).await;
    let migrator = sqlx::migrate!("../../migrations");
    for migration in migrator.iter().skip(6).take(2) {
        conn.execute(migration.sql.as_ref()).await.unwrap();
        sqlx::query("INSERT INTO public._sqlx_migrations(version,description,success,checksum,execution_time) VALUES($1,$2,true,$3,0)")
            .bind(migration.version).bind(migration.description.as_ref()).bind(migration.checksum.as_ref())
            .execute(&mut *conn).await.unwrap();
    }
    let catalog: Vec<String> = sqlx::query_scalar(include_str!("../src/catalog-signature.sql"))
        .fetch_all(&mut *conn)
        .await
        .unwrap();
    assert!(
        catalog
            .iter()
            .map(String::as_str)
            .eq(include_str!("../src/schema-v8.catalog").lines()),
        "skills upgrade must start from the exact published schema 8"
    );
    let mut admin = PgConnection::connect(&config.admin).await.unwrap();
    config.guard_connection(&mut admin).await;
    let mut seed = admin.begin().await.unwrap();
    seed.execute("SET TRANSACTION ISOLATION LEVEL READ COMMITTED")
        .await
        .unwrap();
    seed.execute(r#"
      INSERT INTO public.identities(id,issuer,subject,display_name) VALUES('skills-upgrade','upgrade','skills','Upgrade Auditor');
      INSERT INTO public.organisations VALUES('skills-upgrade','Upgrade');
      INSERT INTO public.organisation_memberships(organisation_id,actor_id,roles) VALUES('skills-upgrade','skills-upgrade',ARRAY['admin','auditor']);
      INSERT INTO public.clients VALUES('skills-upgrade','client','Client');
      INSERT INTO public.engagements(organisation_id,client_id,id,name) VALUES('skills-upgrade','client','engagement','Engagement');
      INSERT INTO public.engagement_assignments(organisation_id,client_id,engagement_id,actor_id) VALUES('skills-upgrade','client','engagement','skills-upgrade');
      SELECT set_config('zobba.actor_id','skills-upgrade',true),set_config('zobba.organisation_id','skills-upgrade',true),set_config('zobba.client_id','client',true),set_config('zobba.engagement_id','engagement',true);
      INSERT INTO public.tasks(organisation_id,client_id,engagement_id,id,cycle_id,accountable_actor,objective,working_brief,state,cessation) VALUES('skills-upgrade','client','engagement','skills-upgrade-task','skills-upgrade-cycle','skills-upgrade','Retained objective','Retained brief','ready','none');
      INSERT INTO public.task_cycles VALUES('skills-upgrade','client','engagement','skills-upgrade-task','skills-upgrade-cycle','active');
      INSERT INTO public.task_commands(organisation_id,client_id,engagement_id,id,author_id,idempotency_key,kind,content,task_id,cycle_id,received_cursor,intent_revision,methodology_context) VALUES('skills-upgrade','client','engagement','skills-upgrade-command','skills-upgrade','skills-upgrade-key','create','Retained objective','skills-upgrade-task','skills-upgrade-cycle',1,1,'{"audit_area":"Revenue","period_start":"2026-01-01","period_end":"2026-12-31"}');
      INSERT INTO public.methodology_versions VALUES('skills-upgrade','skills-upgrade-method','skills-upgrade',1,1,'{"definition":{"name":"Retained firm method","requirements":[{"id":"retained","mandatory":true,"criteria":["Original criterion"]}]}}');
      INSERT INTO public.methodology_assignments VALUES('skills-upgrade','skills-upgrade-method','client','engagement',1,NULL);
      INSERT INTO public.methodology_events VALUES('skills-upgrade','skills-upgrade-event','skills-upgrade','skills-method-key',1,'save','{"key":"skills-method-key"}','{"version_id":"skills-upgrade-method","revision":1}',1);
      INSERT INTO public.task_methodology_bindings VALUES('skills-upgrade','client','engagement','skills-upgrade-task','skills-upgrade-binding','{"id":"skills-upgrade-binding","execution_epoch":1,"actor_id":"skills-upgrade","bound_at":1,"candidate_version_ids":["skills-upgrade-method"],"context_command_id":"skills-upgrade-command","resolution":{"status":"bound","context":{"audit_area":"Revenue","period_start":"2026-01-01","period_end":"2026-12-31"},"version_ids":["skills-upgrade-method"],"requirements":[{"id":"retained","mandatory":true,"criteria":["Original criterion"],"field_sources":[{"field":"criteria","source_version_ids":["skills-upgrade-method"]}]}],"templates":[],"neutral_source_version_ids":[],"issues":[],"reason":"Explicit retained basis"}}');
      INSERT INTO public.task_methodology_heads VALUES('skills-upgrade','skills-upgrade-task','skills-upgrade-binding','{"audit_area":"Revenue","period_start":"2026-01-01","period_end":"2026-12-31"}',NULL,NULL);
    "#).await.unwrap();
    seed.commit().await.unwrap();
    let tables: Vec<String> = sqlx::query_scalar("SELECT tablename::text FROM pg_catalog.pg_tables WHERE schemaname='public' AND tablename<>'zobba_bootstrap' AND tablename<>'_sqlx_migrations' ORDER BY tablename")
        .fetch_all(&mut admin).await.unwrap();
    let mut before = Vec::new();
    for table in &tables {
        let rows: serde_json::Value = sqlx::query_scalar(&format!("SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.\"{table}\" t"))
            .fetch_one(&mut admin).await.unwrap();
        before.push(rows);
    }
    let ledger: Vec<String> = sqlx::query_scalar(
        "SELECT to_jsonb(m)::text FROM public._sqlx_migrations m ORDER BY version",
    )
    .fetch_all(&mut *conn)
    .await
    .unwrap();
    migrate(&config.migration, &role)
        .await
        .expect("restricted owner upgrades populated schema 8");
    for (table, original) in tables.iter().zip(before) {
        let row = if table == "task_commands" {
            "to_jsonb(t)-'received_at'"
        } else {
            "to_jsonb(t)"
        };
        let after: serde_json::Value = sqlx::query_scalar(&format!("SELECT coalesce(jsonb_agg({row} ORDER BY ({row})::text),'[]'::jsonb) FROM public.\"{table}\" t"))
            .fetch_one(&mut admin).await.unwrap();
        assert_eq!(original, after, "skills migration rewrote {table}");
    }
    assert_legacy_command_timestamps_unknown(&mut admin).await;
    let ledger_after: Vec<String> = sqlx::query_scalar(
        "SELECT to_jsonb(m)::text FROM public._sqlx_migrations m WHERE version<=8 ORDER BY version",
    )
    .fetch_all(&mut *conn)
    .await
    .unwrap();
    assert_eq!(
        ledger, ledger_after,
        "skills migration rewrote prefix ledger"
    );
    for table in [
        "skill_versions",
        "skill_events",
        "skill_status",
        "task_skill_selections",
    ] {
        let count: i64 = sqlx::query_scalar(&format!("SELECT count(*) FROM public.{table}"))
            .fetch_one(&mut admin)
            .await
            .unwrap();
        assert_eq!(count, 0, "upgrade invented a skill or selection");
    }
    let database = RuntimeDatabase::connect(&config.runtime).await.unwrap();
    assert_eq!(database.check().await.unwrap().0, 12);
    database.pool().close().await;
    migrate(&config.migration, &role)
        .await
        .expect("schema 9 repeat migration");
    reset(config, conn).await;
}

/// Install the exact published prefix, then prove the additive knowledge upgrade
/// preserves existing evidence, admitted direction and their configuration basis.
async fn knowledge_upgrade_contract(config: &Configuration, conn: &mut PgConnection) {
    let role = database_options(&config.runtime)
        .unwrap()
        .get_username()
        .to_owned();
    install_schema6(config, conn).await;
    let migrator = sqlx::migrate!("../../migrations");
    for migration in migrator.iter().skip(6).take(3) {
        conn.execute(migration.sql.as_ref()).await.unwrap();
        sqlx::query("INSERT INTO public._sqlx_migrations(version,description,success,checksum,execution_time) VALUES($1,$2,true,$3,0)")
            .bind(migration.version).bind(migration.description.as_ref()).bind(migration.checksum.as_ref())
            .execute(&mut *conn).await.unwrap();
    }
    let catalog: Vec<String> = sqlx::query_scalar(include_str!("../src/catalog-signature.sql"))
        .fetch_all(&mut *conn)
        .await
        .unwrap();
    assert!(
        catalog
            .iter()
            .map(String::as_str)
            .eq(include_str!("../src/schema-v9.catalog").lines()),
        "knowledge upgrade must begin with the exact published schema 9"
    );
    let mut admin = PgConnection::connect(&config.admin).await.unwrap();
    config.guard_connection(&mut admin).await;
    let mut seed = admin.begin().await.unwrap();
    seed.execute("SET TRANSACTION ISOLATION LEVEL READ COMMITTED")
        .await
        .unwrap();
    seed.execute(r#"
      INSERT INTO public.identities(id,issuer,subject,display_name) VALUES('knowledge-upgrade','upgrade','knowledge','Upgrade Auditor');
      INSERT INTO public.organisations VALUES('knowledge-upgrade','Upgrade');
      INSERT INTO public.organisation_memberships(organisation_id,actor_id,roles) VALUES('knowledge-upgrade','knowledge-upgrade',ARRAY['admin','auditor']);
      INSERT INTO public.clients VALUES('knowledge-upgrade','client','Client');
      INSERT INTO public.engagements(organisation_id,client_id,id,name) VALUES('knowledge-upgrade','client','engagement','Engagement');
      INSERT INTO public.engagement_assignments(organisation_id,client_id,engagement_id,actor_id) VALUES('knowledge-upgrade','client','engagement','knowledge-upgrade');
      SELECT set_config('zobba.actor_id','knowledge-upgrade',true),set_config('zobba.organisation_id','knowledge-upgrade',true),set_config('zobba.client_id','client',true),set_config('zobba.engagement_id','engagement',true);
      INSERT INTO public.tasks(organisation_id,client_id,engagement_id,id,cycle_id,accountable_actor,objective,working_brief,state,cessation,intent_revision,applied_intent,applied_command_cursor) VALUES('knowledge-upgrade','client','engagement','knowledge-upgrade-task','knowledge-upgrade-cycle','knowledge-upgrade','Retained objective','Keep this exact direction','ready','none',2,2,2);
      INSERT INTO public.task_cycles VALUES('knowledge-upgrade','client','engagement','knowledge-upgrade-task','knowledge-upgrade-cycle','active');
      INSERT INTO public.task_commands(organisation_id,client_id,engagement_id,id,author_id,idempotency_key,kind,content,task_id,cycle_id,received_cursor,intent_revision,methodology_context) VALUES('knowledge-upgrade','client','engagement','knowledge-create','knowledge-upgrade','create-key','create','Retained objective','knowledge-upgrade-task','knowledge-upgrade-cycle',1,1,'{"audit_area":"Revenue","period_start":"2026-01-01","period_end":"2026-12-31"}');
      INSERT INTO public.task_commands(organisation_id,client_id,engagement_id,id,author_id,idempotency_key,kind,target_task_id,target_cycle_id,content,task_id,cycle_id,received_cursor,intent_revision) VALUES('knowledge-upgrade','client','engagement','knowledge-guide','knowledge-upgrade','guide-key','guide','knowledge-upgrade-task','knowledge-upgrade-cycle','Keep this exact direction','knowledge-upgrade-task','knowledge-upgrade-cycle',2,2);
      INSERT INTO public.task_events VALUES('knowledge-upgrade','client','engagement',1,'knowledge-upgrade-task','knowledge-upgrade-cycle','knowledge-create','received'),('knowledge-upgrade','client','engagement',2,'knowledge-upgrade-task','knowledge-upgrade-cycle','knowledge-guide','received'),('knowledge-upgrade','client','engagement',3,'knowledge-upgrade-task','knowledge-upgrade-cycle','knowledge-guide','applied');
      INSERT INTO public.methodology_versions VALUES('knowledge-upgrade','knowledge-method','knowledge-upgrade',1,1,'{"definition":{"name":"Retained firm method","requirements":[{"id":"retained","mandatory":true,"criteria":["Original criterion"]}]}}');
      INSERT INTO public.methodology_assignments VALUES('knowledge-upgrade','knowledge-method','client','engagement',1,NULL);
      INSERT INTO public.methodology_events VALUES('knowledge-upgrade','knowledge-method-event','knowledge-upgrade','method-key',1,'save','{"key":"method-key"}','{"version_id":"knowledge-method","revision":1}',1);
      INSERT INTO public.task_methodology_bindings VALUES('knowledge-upgrade','client','engagement','knowledge-upgrade-task','knowledge-binding','{"id":"knowledge-binding","execution_epoch":1,"actor_id":"knowledge-upgrade","bound_at":1,"candidate_version_ids":["knowledge-method"],"context_command_id":"knowledge-create","resolution":{"status":"resolved","context":{"audit_area":"Revenue","period_start":"2026-01-01","period_end":"2026-12-31"},"version_ids":["knowledge-method"],"requirements":[{"id":"retained","mandatory":true,"criteria":["Original criterion"]}],"templates":[],"neutral_source_version_ids":[],"issues":[],"reason":"Explicit retained basis"}}');
      INSERT INTO public.task_methodology_heads VALUES('knowledge-upgrade','knowledge-upgrade-task','knowledge-binding','{"audit_area":"Revenue","period_start":"2026-01-01","period_end":"2026-12-31"}',NULL,NULL);
      INSERT INTO public.skill_versions VALUES('knowledge-upgrade','knowledge-skill','knowledge-upgrade',1,1,'{"manifest":{"id":"retained-technique","version":"1","purpose":"Retained inert technique","resources":[{"id":"notes","kind":"text","content":"Preserve exact technique notes"}]}}',repeat('a',64),'[]','client','engagement');
      INSERT INTO public.skill_events VALUES('knowledge-upgrade','knowledge-skill-event','knowledge-upgrade','skill-key',1,'install','{"key":"skill-key"}','{"version_id":"knowledge-skill","revision":1,"status":"enabled"}',1);
      INSERT INTO public.skill_status VALUES('knowledge-upgrade','knowledge-skill','enabled',1,'knowledge-skill-event');
      INSERT INTO public.task_skill_selections VALUES('knowledge-upgrade','client','engagement','knowledge-upgrade-task','knowledge-selection','knowledge-upgrade','selection-key',1,'knowledge-skill','{"version_id":"knowledge-skill","reason":"Exact retained technique"}','{"id":"knowledge-selection","version_id":"knowledge-skill","methodology_binding_id":"knowledge-binding","execution_epoch":1,"reason":"Exact retained technique"}');
      INSERT INTO public.evidence_reservations(id,organisation_id,client_id,engagement_id,actor_id,key,request,digest,size,namespace,reserved_at) VALUES('knowledge-original','knowledge-upgrade','client','engagement','knowledge-upgrade','original-key','{"key":"original-key","filename":"retained.txt","source":{"system":"Asserted source","coverage":"Claimed partial"}}',repeat('b',64),12,repeat('c',64),1);
      INSERT INTO public.evidence_originals SELECT r.*, 'retained-storage-version',2 FROM public.evidence_reservations r WHERE id='knowledge-original';
    "#).await.unwrap();
    seed.commit().await.unwrap();
    let tables: Vec<String> = sqlx::query_scalar("SELECT tablename::text FROM pg_catalog.pg_tables WHERE schemaname='public' AND tablename NOT IN ('zobba_bootstrap','_sqlx_migrations') ORDER BY tablename")
        .fetch_all(&mut admin).await.unwrap();
    let mut before = Vec::new();
    for table in &tables {
        let rows: serde_json::Value = sqlx::query_scalar(&format!("SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.\"{table}\" t"))
            .fetch_one(&mut admin).await.unwrap();
        before.push(rows);
    }
    let ledger: Vec<String> = sqlx::query_scalar(
        "SELECT to_jsonb(m)::text FROM public._sqlx_migrations m ORDER BY version",
    )
    .fetch_all(&mut *conn)
    .await
    .unwrap();
    assert_eq!(ledger.len(), 9);
    migrate(&config.migration, &role)
        .await
        .expect("restricted owner upgrades populated schema 9");
    for (table, original) in tables.iter().zip(before) {
        let row = if table == "task_commands" {
            "to_jsonb(t)-'received_at'"
        } else {
            "to_jsonb(t)"
        };
        let after: serde_json::Value = sqlx::query_scalar(&format!("SELECT coalesce(jsonb_agg({row} ORDER BY ({row})::text),'[]'::jsonb) FROM public.\"{table}\" t"))
            .fetch_one(&mut admin).await.unwrap();
        assert_eq!(original, after, "knowledge migration rewrote {table}");
    }
    assert_legacy_command_timestamps_unknown(&mut admin).await;
    let retained_ledger: Vec<String> = sqlx::query_scalar(
        "SELECT to_jsonb(m)::text FROM public._sqlx_migrations m WHERE version<=9 ORDER BY version",
    )
    .fetch_all(&mut *conn)
    .await
    .unwrap();
    assert_eq!(
        ledger, retained_ledger,
        "knowledge migration rewrote published prefix ledger"
    );
    for table in [
        "knowledge_records",
        "knowledge_events",
        "knowledge_invalidations",
        "knowledge_publications",
        "knowledge_withdrawals",
        "knowledge_layout_events",
        "knowledge_source_corrections",
        "knowledge_captures",
    ] {
        let count: i64 = sqlx::query_scalar(&format!("SELECT count(*) FROM public.{table}"))
            .fetch_one(&mut admin)
            .await
            .unwrap();
        assert_eq!(
            count, 0,
            "schema upgrade invented capture, assertions or preferences without a verified producer"
        );
    }
    let database = RuntimeDatabase::connect(&config.runtime).await.unwrap();
    assert_eq!(database.check().await.unwrap().0, 12);
    database.pool().close().await;
    let installed: Vec<String> = sqlx::query_scalar(
        "SELECT to_jsonb(m)::text FROM public._sqlx_migrations m ORDER BY version",
    )
    .fetch_all(&mut *conn)
    .await
    .unwrap();
    assert_eq!(installed.len(), 12);
    migrate(&config.migration, &role)
        .await
        .expect("knowledge upgrade repeat is idempotent");
    let repeated: Vec<String> = sqlx::query_scalar(
        "SELECT to_jsonb(m)::text FROM public._sqlx_migrations m ORDER BY version",
    )
    .fetch_all(&mut *conn)
    .await
    .unwrap();
    assert_eq!(
        installed, repeated,
        "repeated knowledge upgrade changed ledger facts"
    );
    reset(config, conn).await;
}

async fn assert_legacy_command_timestamps_unknown(conn: &mut PgConnection) {
    let (commands, invented): (i64, i64) = sqlx::query_as(
        "SELECT count(*),count(*) FILTER (WHERE received_at IS NOT NULL) FROM public.task_commands",
    )
    .fetch_one(conn)
    .await
    .unwrap();
    assert!(
        commands > 0,
        "timestamp preservation requires retained commands"
    );
    assert_eq!(
        invented, 0,
        "upgrade invented a receipt timestamp for legacy commands"
    );
}

/// The schema10 source owners and their immutable rows survive the model upgrade.
async fn model_upgrade_contract(config: &Configuration, conn: &mut PgConnection) {
    let role = database_options(&config.runtime)
        .unwrap()
        .get_username()
        .to_owned();
    install_schema6(config, conn).await;
    let migrator = sqlx::migrate!("../../migrations");
    for migration in migrator.iter().skip(6).take(4) {
        conn.execute(migration.sql.as_ref()).await.unwrap();
        sqlx::query("INSERT INTO public._sqlx_migrations(version,description,success,checksum,execution_time) VALUES($1,$2,true,$3,0)")
            .bind(migration.version).bind(migration.description.as_ref()).bind(migration.checksum.as_ref()).execute(&mut *conn).await.unwrap();
    }
    let catalog: Vec<String> = sqlx::query_scalar(include_str!("../src/catalog-signature.sql"))
        .fetch_all(&mut *conn)
        .await
        .unwrap();
    assert!(
        catalog
            .iter()
            .map(String::as_str)
            .eq(include_str!("../src/schema-v10.catalog").lines())
    );
    let mut admin = PgConnection::connect(&config.admin).await.unwrap();
    config.guard_connection(&mut admin).await;
    let mut seed = admin.begin().await.unwrap();
    seed.execute(r#"
      INSERT INTO public.identities(id,issuer,subject,display_name) VALUES('model-upgrade','upgrade','model','Upgrade Auditor');
      INSERT INTO public.organisations VALUES('model-upgrade','Upgrade');
      INSERT INTO public.organisation_memberships(organisation_id,actor_id,roles) VALUES('model-upgrade','model-upgrade',ARRAY['admin','auditor']);
      INSERT INTO public.clients VALUES('model-upgrade','client','Client');
      INSERT INTO public.engagements(organisation_id,client_id,id,name) VALUES('model-upgrade','client','engagement','Engagement');
      INSERT INTO public.engagement_assignments(organisation_id,client_id,engagement_id,actor_id) VALUES('model-upgrade','client','engagement','model-upgrade');
      SELECT set_config('zobba.actor_id','model-upgrade',true),set_config('zobba.organisation_id','model-upgrade',true),set_config('zobba.client_id','client',true),set_config('zobba.engagement_id','engagement',true);
      INSERT INTO public.tasks(organisation_id,client_id,engagement_id,id,cycle_id,accountable_actor,objective,working_brief,state,cessation,intent_revision,applied_intent,applied_command_cursor) VALUES('model-upgrade','client','engagement','model-upgrade-task','model-upgrade-cycle','model-upgrade','Retained objective','Retained exact direction','ready','none',1,1,1);
      INSERT INTO public.task_cycles VALUES('model-upgrade','client','engagement','model-upgrade-task','model-upgrade-cycle','active');
      INSERT INTO public.task_commands(organisation_id,client_id,engagement_id,id,author_id,idempotency_key,kind,content,task_id,cycle_id,received_cursor,intent_revision) VALUES('model-upgrade','client','engagement','model-upgrade-create','model-upgrade','create','create','Retained objective','model-upgrade-task','model-upgrade-cycle',1,1);
      INSERT INTO public.knowledge_records(organisation_id,id,revision,actor_id,client_id,engagement_id,document) VALUES('model-upgrade','retained-record',1,'model-upgrade','client','engagement','{"fact":"exact old source"}');
      INSERT INTO public.knowledge_events(organisation_id,id,actor_id,key,client_id,engagement_id,command,receipt) VALUES('model-upgrade','retained-event','model-upgrade','retained-key','client','engagement','{"key":"retained-key"}','{"event":"retained-event"}');
    "#).await.unwrap();
    seed.commit().await.unwrap();
    let tables:Vec<String>=sqlx::query_scalar("SELECT tablename::text FROM pg_catalog.pg_tables WHERE schemaname='public' AND tablename NOT IN ('zobba_bootstrap','_sqlx_migrations') ORDER BY tablename").fetch_all(&mut admin).await.unwrap();
    let mut before = Vec::new();
    for table in &tables {
        let rows:serde_json::Value=sqlx::query_scalar(&format!("SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.\"{table}\" t")).fetch_one(&mut admin).await.unwrap();
        before.push(rows);
    }
    let ledger: Vec<String> = sqlx::query_scalar(
        "SELECT to_jsonb(m)::text FROM public._sqlx_migrations m ORDER BY version",
    )
    .fetch_all(&mut *conn)
    .await
    .unwrap();
    assert_eq!(ledger.len(), 10);
    migrate(&config.migration, &role).await.unwrap();
    for (table, original) in tables.iter().zip(before) {
        let after:serde_json::Value=sqlx::query_scalar(&format!("SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.\"{table}\" t")).fetch_one(&mut admin).await.unwrap();
        assert_eq!(original, after, "model upgrade rewrote {table}");
    }
    let retained:Vec<String>=sqlx::query_scalar("SELECT to_jsonb(m)::text FROM public._sqlx_migrations m WHERE version<=10 ORDER BY version").fetch_all(&mut *conn).await.unwrap();
    assert_eq!(ledger, retained);
    for table in [
        "model_profiles",
        "model_catalogues",
        "model_invocations",
        "model_results",
        "model_tool_bindings",
        "task_steps",
        "task_guidance_applications",
        "task_routing_questions",
        "task_routing_answers",
        "task_work_claims",
    ] {
        let count: i64 = sqlx::query_scalar(&format!("SELECT count(*) FROM public.{table}"))
            .fetch_one(&mut admin)
            .await
            .unwrap();
        assert_eq!(
            count, 0,
            "migration invented qualification or model activity"
        );
    }
    let database = RuntimeDatabase::connect(&config.runtime).await.unwrap();
    assert_eq!(database.check().await.unwrap().0, 12);
    database.pool().close().await;
    migrate(&config.migration, &role).await.unwrap();
    reset(config, conn).await;
}
