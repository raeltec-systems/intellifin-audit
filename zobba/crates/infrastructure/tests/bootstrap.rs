//! Real PostgreSQL contract, deliberately destructive only in a named *_test DB.
//! One serial test owns the fixture and leaves an empty database for process smoke.
use sqlx::{Connection, Executor, PgConnection};
use std::time::{Duration, Instant};
use zobba_application::{BootstrapError, SchemaHealth};
use zobba_infrastructure::{RuntimeDatabase, database_options, migrate, valid_role_name};
mod support;
use support::Configuration;

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
    assert_eq!(installed.len(), 3, "fresh migration ledger is incomplete");
    assert_eq!(installed, repeated, "repeat changed migration ledger");
    let database = RuntimeDatabase::connect(&runtime_url)
        .await
        .expect("nonowner runtime starts");
    assert_eq!(database.check().await.unwrap().0, 3);
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
    ] {
        assert!(
            restricted.execute(mutation).await.is_err(),
            "runtime mutation admitted"
        );
    }
    restricted.close().await.unwrap();

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
        "DROP INDEX public.sessions_expiry",
        "DROP INDEX public.login_attempts_expiry",
        "DROP INDEX public.task_commands_pending",
        "DROP INDEX public.tasks_open_scope",
        "ALTER TABLE public.tasks ALTER COLUMN applied_command_cursor SET DEFAULT 1",
        "ALTER TABLE public.tasks DROP CONSTRAINT tasks_applied_command_cursor_check",
        "ALTER TABLE public.task_deliveries NO FORCE ROW LEVEL SECURITY",
        "ALTER POLICY dispatcher_lease ON public.task_deliveries USING (true) WITH CHECK (true)",
        "ALTER POLICY scoped_delivery_insert ON public.task_deliveries WITH CHECK (true)",
        "CREATE POLICY dispatcher_mutation ON public.task_wakeups FOR UPDATE USING (pg_catalog.current_setting('zobba.dispatcher',true)='on') WITH CHECK (pg_catalog.current_setting('zobba.dispatcher',true)='on')",
        "ALTER TABLE public.task_deliveries DROP CONSTRAINT task_deliveries_wakeup_id_fkey",
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
        "INSERT INTO public._sqlx_migrations(version,description,success,checksum,execution_time) SELECT v,repeat('x',4096),true,'\\x00'::bytea,0 FROM generate_series(4,1000) v",
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

    internal_trigger_contract(&config, &mut admin).await;

    // Column-level leases must not expand to routing identity, scheduling or
    // initial lease ownership writes, even if accidental grants remain unused.
    for privilege in [
        "UPDATE(wakeup_id) ON public.task_deliveries",
        "INSERT(delivery_owner) ON public.task_deliveries",
        "INSERT(delivery_until) ON public.task_deliveries",
        "DELETE ON public.task_deliveries",
        "UPDATE(actor_id) ON public.task_wakeups",
        "UPDATE(task_id) ON public.task_wakeups",
        "SELECT ON public.task_wakeups",
        "SELECT ON public.task_deliveries",
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
    no_foreign_code_runs(&config, &mut admin).await;
    foreign_catalog_objects(&config, &mut admin).await;
    authority_and_atomicity(&config, &mut admin).await;
    lock_and_blackhole(&config, &mut admin).await;
    reset(&config, &mut admin).await;
    println!(
        "bootstrap contract: fresh/v1/v2/repeat/owner/privilege/foreign/marker/checksum/version refusals passed; test schema empty"
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
                assert_eq!(running.check().await.unwrap().0, 3);
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
    assert_eq!(running.check().await.unwrap().0, 3);
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
        assert_eq!(running.check().await.unwrap().0, 3);
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
    assert_eq!(running.check().await.unwrap().0, 3);

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
    assert_eq!(running.check().await.unwrap().0, 3);

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
    assert_eq!(running.check().await.unwrap().0, 3);
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
    ];
    let migrator = sqlx::migrate!("../../migrations");
    for prefix in [1_usize, 2] {
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
            if prefix == 2 {
                conn.execute(format!("GRANT SELECT ON public.identities,public.login_attempts,public.sessions,public.organisations,public.clients,public.engagements,public.organisation_memberships,public.engagement_assignments TO \"{role}\"; GRANT INSERT(id,issuer,subject,display_name),UPDATE(display_name) ON public.identities TO \"{role}\"; GRANT INSERT,DELETE ON public.login_attempts,public.sessions TO \"{role}\"; GRANT UPDATE(name) ON public.engagements TO \"{role}\"").as_str()).await.unwrap();
            }
            refused_without_mutation(conn, &config.runtime, BootstrapError::SchemaMismatch).await;
            if let Some(corruption) = corruption {
                let sql = match corruption {
                    "checksum" => "UPDATE public._sqlx_migrations SET checksum='\\x00'::bytea",
                    "catalog" if prefix == 2 => {
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
                assert_eq!(all.len(), 3, "upgrade did not reach the complete ledger");
                let database = RuntimeDatabase::connect(&config.runtime).await.unwrap();
                assert_eq!(database.check().await.unwrap().0, 3);
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
