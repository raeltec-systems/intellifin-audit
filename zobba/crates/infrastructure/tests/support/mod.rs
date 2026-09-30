use sqlx::{PgConnection, postgres::PgConnectOptions};
use std::{
    collections::BTreeSet,
    env,
    net::{IpAddr, Ipv4Addr, ToSocketAddrs},
};
use zobba_infrastructure::{database_options, valid_role_name};

#[derive(Debug, PartialEq, Eq)]
struct Identity {
    database: String,
    hosts: BTreeSet<IpAddr>,
    port: u16,
}

fn identity(options: &PgConnectOptions) -> Identity {
    let host = options.get_host().trim_matches(['[', ']']);
    let hosts = (host, options.get_port())
        .to_socket_addrs()
        .expect("resolve synthetic DB host")
        .map(|address| {
            let ip = match address.ip() {
                IpAddr::V6(ip) => ip
                    .to_ipv4_mapped()
                    .map(IpAddr::V4)
                    .unwrap_or(IpAddr::V6(ip)),
                other => other,
            };
            if ip.is_loopback() {
                IpAddr::V4(Ipv4Addr::LOCALHOST)
            } else {
                ip
            }
        })
        .collect::<BTreeSet<_>>();
    assert!(!hosts.is_empty(), "synthetic database host must resolve");
    Identity {
        database: options.get_database().expect("explicit database").into(),
        hosts,
        port: options.get_port(),
    }
}

fn same_database(left: &Identity, right: &Identity) -> bool {
    left.database == right.database
        && left.port == right.port
        && !left.hosts.is_disjoint(&right.hosts)
}

fn assert_same_target(selected: &Identity, runtime: &Identity, admin: &Identity) {
    assert!(
        selected == runtime && selected == admin,
        "all test roles must share one complete effective endpoint set"
    );
}

pub fn validate(migration: &str, runtime: &str, admin: &str, development: &[String]) {
    let migration = database_options(migration).expect("explicit safe test migration URL");
    let runtime = database_options(runtime).expect("explicit safe test runtime URL");
    let admin = database_options(admin).expect("explicit safe test admin URL");
    assert!(
        [&migration, &runtime, &admin]
            .iter()
            .all(|options| valid_role_name(options.get_username())),
        "test role names must be bounded lowercase identifiers"
    );
    let selected = identity(&migration);
    assert!(
        selected.database.ends_with("_test"),
        "destructive fixtures require a dedicated *_test database"
    );
    assert_same_target(&selected, &identity(&runtime), &identity(&admin));
    assert_ne!(
        migration.get_username(),
        runtime.get_username(),
        "test roles must differ"
    );
    for value in development {
        let dev = identity(&database_options(value).expect("explicit safe development URL"));
        assert!(
            !same_database(&selected, &dev),
            "refusing destructive fixture against configured development database"
        );
    }
}

pub struct Configuration {
    pub migration: String,
    pub runtime: String,
    pub admin: String,
    development: Vec<String>,
}

impl Configuration {
    pub fn from_environment() -> Self {
        let migration = env::var("ZOBBA_TEST_MIGRATION_DATABASE_URL")
            .expect("set dedicated ZOBBA_TEST_MIGRATION_DATABASE_URL");
        let runtime = env::var("ZOBBA_TEST_RUNTIME_DATABASE_URL")
            .expect("set dedicated ZOBBA_TEST_RUNTIME_DATABASE_URL");
        let admin = env::var("ZOBBA_TEST_ADMIN_DATABASE_URL").unwrap_or_else(|_| migration.clone());
        let development = ["ZOBBA_MIGRATION_DATABASE_URL", "ZOBBA_RUNTIME_DATABASE_URL"]
            .iter()
            .filter_map(|name| env::var(name).ok())
            .collect();
        let config = Self {
            migration,
            runtime,
            admin,
            development,
        };
        config.guard();
        config
    }

    pub fn guard(&self) {
        validate(
            &self.migration,
            &self.runtime,
            &self.admin,
            &self.development,
        );
    }

    pub async fn guard_connection(&self, conn: &mut PgConnection) {
        self.guard();
        let actual: String = sqlx::query_scalar("SELECT pg_catalog.current_database()::text")
            .fetch_one(conn)
            .await
            .expect("verify actual test database before mutation");
        assert_eq!(
            Some(actual.as_str()),
            database_options(&self.migration).unwrap().get_database()
        );
    }
}

#[test]
fn destructive_guard_refuses_development_and_endpoint_aliases() {
    let migration = "postgres://owner@127.0.0.1:55434/guard_test";
    let runtime = "postgres://runtime@127.0.0.1:55434/guard_test";
    validate(migration, runtime, migration, &[]);
    for development in [
        migration,
        "postgres://other@localhost:55434/guard_test",
        "postgres://other@[::1]:55434/guard_test",
        "postgres://other@[::ffff:127.0.0.1]:55434/guard_test",
        "postgres://other@127.0.0.1:55434/guard%5Ftest",
    ] {
        assert!(
            std::panic::catch_unwind(|| validate(
                migration,
                runtime,
                migration,
                &[development.into()]
            ))
            .is_err()
        );
    }
    for bad in [
        "postgres://owner@127.0.0.1:55434/not_disposable",
        "postgres://owner@127.0.0.1:55434/guard_test?host=elsewhere",
        "postgres://owner@127.0.0.1:55434/guard_test?dbname=development",
        "postgres://owner@127.0.0.1:55434/guard_test?options=-crole=owner",
    ] {
        assert!(std::panic::catch_unwind(|| validate(bad, runtime, migration, &[])).is_err());
    }
}

#[test]
fn partial_dns_overlap_refuses_test_pair_but_still_blocks_development_overlap() {
    let selected = Identity {
        database: "guard_test".into(),
        port: 5432,
        hosts: ["192.0.2.1".parse().unwrap(), "192.0.2.2".parse().unwrap()]
            .into_iter()
            .collect(),
    };
    let partial = Identity {
        database: "guard_test".into(),
        port: 5432,
        hosts: ["192.0.2.2".parse().unwrap(), "192.0.2.3".parse().unwrap()]
            .into_iter()
            .collect(),
    };
    assert!(
        same_database(&selected, &partial),
        "any dev overlap must remain blocked"
    );
    assert!(
        std::panic::catch_unwind(|| assert_same_target(&selected, &partial, &selected)).is_err()
    );
    assert!(
        std::panic::catch_unwind(|| assert_same_target(&selected, &selected, &partial)).is_err()
    );
}
