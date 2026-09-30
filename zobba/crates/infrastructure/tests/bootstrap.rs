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
        'rules',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) ORDER BY r.rulename) FROM pg_catalog.pg_rewrite r WHERE r.ev_class=c.oid))::text
      FROM pg_catalog.pg_namespace n LEFT JOIN pg_catalog.pg_class c ON c.relnamespace=n.oid
      WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' ORDER BY n.nspname,c.relname
    "#).fetch_all(&mut *conn).await.expect("snapshot definitions and privileges");
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
    let installed: String =
        sqlx::query_scalar("SELECT installed_on::text FROM public._sqlx_migrations")
            .fetch_one(&mut admin)
            .await
            .unwrap();
    migrate(&migration_url, role)
        .await
        .expect("repeat migration");
    let repeated: String =
        sqlx::query_scalar("SELECT installed_on::text FROM public._sqlx_migrations")
            .fetch_one(&mut admin)
            .await
            .unwrap();
    assert_eq!(installed, repeated, "repeat reapplied migration");
    let database = RuntimeDatabase::connect(&runtime_url)
        .await
        .expect("nonowner runtime starts");
    assert_eq!(database.check().await.unwrap().0, 1);
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
        "UPDATE public._sqlx_migrations SET version=999",
        "DELETE FROM public._sqlx_migrations",
        "ALTER TABLE public.zobba_bootstrap ADD COLUMN alien text",
        "ALTER TABLE public.zobba_bootstrap DROP CONSTRAINT zobba_bootstrap_product_check",
        "CREATE INDEX unexpected_index ON public.zobba_bootstrap(product)",
        "ALTER TABLE public.zobba_bootstrap ENABLE ROW LEVEL SECURITY",
        "CREATE TYPE public.alien_composite AS (value text)",
        "CREATE TYPE public.alien_range AS RANGE (subtype=integer)",
        "ALTER TABLE public.zobba_bootstrap SET UNLOGGED",
        "ALTER TABLE public._sqlx_migrations SET UNLOGGED",
        "ALTER TABLE public.zobba_bootstrap ALTER COLUMN singleton SET DEFAULT false",
        "ALTER TABLE public._sqlx_migrations ALTER COLUMN installed_on SET DEFAULT '2000-01-01'::timestamptz",
        "CREATE RULE alien_rule AS ON DELETE TO public.zobba_bootstrap DO ALSO NOTHING",
        "INSERT INTO public._sqlx_migrations(version,description,success,checksum,execution_time) SELECT v,repeat('x',4096),true,'\\x00'::bytea,0 FROM generate_series(2,1000) v",
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

    // Even a limited role with accidental metadata writes is an unsafe runtime.
    admin
        .execute(format!("GRANT UPDATE ON public.zobba_bootstrap TO \"{role}\"").as_str())
        .await
        .unwrap();
    refused_without_mutation(&mut admin, &runtime_url, BootstrapError::UnsafeRuntimeRole).await;
    reset(&config, &mut admin).await;
    no_foreign_code_runs(&config, &mut admin).await;
    authority_and_atomicity(&config, &mut admin).await;
    lock_and_blackhole(&config, &mut admin).await;
    reset(&config, &mut admin).await;
    println!(
        "bootstrap contract: fresh/repeat/owner/privilege/foreign/marker/checksum/version refusals passed; test schema empty"
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
    RuntimeDatabase::connect(&target_url)
        .await
        .expect("safe nonowner target starts");

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

    // Simulate interruption after SQLx creates its ledger but before bootstrap
    // finishes. The outer transaction must remove BOTH tables and all grants.
    reset(config, conn).await;
    privileged.execute(r#"
      CREATE FUNCTION pg_catalog.zobba_fixture_interrupt() RETURNS event_trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF EXISTS(SELECT 1 FROM pg_catalog.pg_event_trigger_ddl_commands() WHERE object_identity='public.zobba_bootstrap')
        THEN RAISE EXCEPTION 'synthetic bootstrap interruption'; END IF;
      END $$;
      CREATE EVENT TRIGGER zobba_fixture_interrupt ON ddl_command_end WHEN TAG IN ('CREATE TABLE') EXECUTE FUNCTION pg_catalog.zobba_fixture_interrupt();
    "#).await.unwrap();
    migration_refused_without_mutation(conn, config, &target, BootstrapError::MigrationFailed)
        .await;
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
