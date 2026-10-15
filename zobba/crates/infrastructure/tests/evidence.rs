//! Real PostgreSQL custody, RLS, replay and post-lock exact-session refusal.
use sqlx::{Connection, Executor, PgConnection, postgres::PgPoolOptions};
use std::time::{Duration, Instant};
use zobba_application::evidence::{EvidenceError, EvidenceMetadata};
use zobba_domain::{evidence::*, identity::Scope};
use zobba_infrastructure::{
    database_options,
    evidence::EvidenceRepository,
    fixture::seed_local_configured,
    identity::{IdentityRepository, secret_hash},
    migrate, scope,
};
mod support;
const ISSUER: &str = "https://127.0.0.1:4443";
fn scope_a() -> Scope {
    Scope {
        organisation_id: "org-a".into(),
        client_id: "client-a".into(),
        engagement_id: "engagement-a".into(),
    }
}
fn request(key: &str) -> ReservationRequest {
    ReservationRequest {
        key: key.into(),
        filename: "source.txt".into(),
        identity: ContentIdentity {
            sha256: "a".repeat(64),
            size: 7,
        },
        source: SourceAssertions {
            system: Some("User asserted system".into()),
            account: Some("Asserted source account".into()),
            source_version: Some("source-v1".into()),
            selection: Some("Selected seven bytes".into()),
            coverage: None,
        },
    }
}
/// Drop a real successful COMMIT response before SQLx can observe its receipt.
/// PostgreSQL protocol frames are bounded; the test owns this numeric-loopback relay.
struct CommitAckProxy {
    url: String,
    armed: std::sync::Arc<std::sync::atomic::AtomicBool>,
    dropped: std::sync::Arc<std::sync::atomic::AtomicBool>,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for CommitAckProxy {
    fn drop(&mut self) {
        self.task.abort();
    }
}
impl CommitAckProxy {
    async fn start(runtime: &str) -> Self {
        use std::sync::{
            Arc,
            atomic::{AtomicBool, Ordering},
        };
        use tokio::{
            io::{AsyncReadExt, AsyncWriteExt},
            net::{TcpListener, TcpStream},
            task::JoinSet,
        };
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let options = database_options(runtime).unwrap();
        let destination = (options.get_host().to_owned(), options.get_port());
        let mut url = url::Url::parse(runtime).unwrap();
        url.set_host(Some("127.0.0.1")).unwrap();
        url.set_port(Some(listener.local_addr().unwrap().port()))
            .unwrap();
        url.set_query(Some("sslmode=disable"));
        let armed = Arc::new(AtomicBool::new(false));
        let dropped = Arc::new(AtomicBool::new(false));
        let arm = armed.clone();
        let drop_signal = dropped.clone();
        let task = tokio::spawn(async move {
            let mut children = JoinSet::new();
            loop {
                tokio::select! {
                    accepted=listener.accept()=>{
                        let Ok((client,_))=accepted else {break};let target=destination.clone();let arm=arm.clone();let drop_signal=drop_signal.clone();
                        children.spawn(async move {
                            let Ok(upstream)=TcpStream::connect(target).await else{return};
                            let (mut client_read,mut client_write)=client.into_split();let(mut upstream_read,mut upstream_write)=upstream.into_split();
                            let forward=tokio::io::copy(&mut client_read,&mut upstream_write);
                            let responses=async {
                                loop {
                                    let mut header=[0u8;5];upstream_read.read_exact(&mut header).await?;
                                    let length=u32::from_be_bytes(header[1..5].try_into().unwrap()) as usize;
                                    if !(4..=1024*1024).contains(&length){return Err(std::io::Error::other("bounded fixture frame"))}
                                    let mut payload=vec![0;length-4];upstream_read.read_exact(&mut payload).await?;
                                    if header[0]==b'C' && payload==b"COMMIT\0" && arm.swap(false,Ordering::SeqCst) {drop_signal.store(true,Ordering::SeqCst);return Ok::<(),std::io::Error>(());}
                                    client_write.write_all(&header).await?;client_write.write_all(&payload).await?;
                                }
                            };
                            tokio::select!{_=forward=>{},_=responses=>{}}
                        });
                    },
                    _=children.join_next(),if !children.is_empty()=>{}
                }
            }
        });
        Self {
            url: url.to_string(),
            armed,
            dropped,
            task,
        }
    }
}

#[tokio::test]
async fn immutable_scoped_custody_replay_and_post_lock_session_fence() {
    let config = support::Configuration::from_environment();
    let mut owner = PgConnection::connect(&config.migration).await.unwrap();
    config.guard_connection(&mut owner).await;
    owner.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public; REVOKE CREATE ON SCHEMA public FROM PUBLIC").await.unwrap();
    migrate(
        &config.migration,
        database_options(&config.runtime).unwrap().get_username(),
    )
    .await
    .unwrap();
    seed_local_configured(ISSUER, &config.migration)
        .await
        .unwrap();
    let mut admin = PgConnection::connect(&config.admin).await.unwrap();
    config.guard_connection(&mut admin).await;
    let pool = PgPoolOptions::new()
        .max_connections(6)
        .connect_with(
            database_options(&config.runtime)
                .unwrap()
                .application_name("zobba-evidence-custody-contract"),
        )
        .await
        .unwrap();
    let identities = IdentityRepository::new(pool.clone());
    let token = identities
        .establish_session(ISSUER, "auditor-a", "Auditor", None)
        .await
        .unwrap();
    let repo = EvidenceRepository::new(pool.clone()).with_session_hash(secret_hash(&token));
    let manager_token = identities
        .establish_session(ISSUER, "manager-a", "Manager", None)
        .await
        .unwrap();
    // The seed's manager subject is owned; use its actual subject when arranging sessions.
    let manager_subject: String =
        sqlx::query_scalar("SELECT subject FROM identities WHERE id='actor-manager'")
            .fetch_one(&mut admin)
            .await
            .unwrap();
    identities.logout(&manager_token).await.unwrap();
    let manager_token = identities
        .establish_session(ISSUER, &manager_subject, "Manager", None)
        .await
        .unwrap();
    let manager =
        EvidenceRepository::new(pool.clone()).with_session_hash(secret_hash(&manager_token));
    let s = scope_a();
    let namespace = "b".repeat(64);
    if std::env::var("ZOBBA_TEST_REQUIRE_NON_C_COLLATION").as_deref() == Ok("1") {
        let default_order: Vec<String> = sqlx::query_scalar("SELECT value FROM (VALUES ('Z'),('a'),('A'),('z')) values_to_order(value) ORDER BY value")
            .fetch_all(&mut admin).await.unwrap();
        assert_ne!(
            default_order,
            ["A", "Z", "a", "z"],
            "R02 qualification requires a database whose default collation differs from byte ordering"
        );
    }
    let command = request("immutable-first");
    let reserved = repo
        .reserve("actor-a", &s, &command, &namespace)
        .await
        .unwrap();
    assert_eq!(
        repo.reserve("actor-a", &s, &command, &namespace)
            .await
            .unwrap(),
        reserved,
        "lost reservation acknowledgement recovers exact frozen result"
    );
    assert!(
        repo.list("actor-a", &s, None)
            .await
            .unwrap()
            .items
            .is_empty()
    );
    assert_eq!(
        repo.inspect("actor-a", &s, &reserved.reservation.id).await,
        Err(EvidenceError::Denied)
    );
    assert!(
        manager
            .recover("actor-manager", &s, None)
            .await
            .unwrap()
            .items
            .is_empty()
    );
    assert_eq!(
        manager
            .reservation("actor-manager", &s, &reserved.reservation.id)
            .await,
        Err(EvidenceError::Denied)
    );
    let mut changed = command.clone();
    for field in 0..8 {
        changed.clone_from(&command);
        match field {
            0 => changed.filename = "changed.txt".into(),
            1 => changed.identity.size += 1,
            2 => changed.identity.sha256 = "c".repeat(64),
            3 => changed.source.system = Some("changed".into()),
            4 => changed.source.account = None,
            5 => changed.source.source_version = None,
            6 => changed.source.selection = None,
            _ => changed.source.coverage = Some("complete asserted".into()),
        };
        assert_eq!(
            repo.reserve("actor-a", &s, &changed, &namespace).await,
            Err(EvidenceError::Conflict)
        );
    }
    assert_eq!(
        repo.register(
            "actor-a",
            &s,
            &reserved.reservation.id,
            &namespace,
            "null",
            &command.identity
        )
        .await,
        Err(EvidenceError::Invalid)
    );
    assert_eq!(
        repo.register(
            "actor-a",
            &s,
            &reserved.reservation.id,
            &"c".repeat(64),
            "v1",
            &command.identity
        )
        .await,
        Err(EvidenceError::Conflict)
    );
    let evidence = repo
        .register(
            "actor-a",
            &s,
            &reserved.reservation.id,
            &namespace,
            "storage-v1",
            &command.identity,
        )
        .await
        .unwrap();
    assert!(evidence.registered_at >= evidence.reservation.reserved_at);
    assert_eq!(
        repo.register(
            "actor-a",
            &s,
            &reserved.reservation.id,
            &namespace,
            "storage-v1",
            &command.identity
        )
        .await
        .unwrap(),
        evidence,
        "lost registration acknowledgement returns exact receipt"
    );
    assert_eq!(
        repo.register(
            "actor-a",
            &s,
            &reserved.reservation.id,
            &namespace,
            "other-version",
            &command.identity
        )
        .await,
        Err(EvidenceError::Conflict)
    );
    assert!(
        repo.recover("actor-a", &s, None)
            .await
            .unwrap()
            .items
            .is_empty()
    );
    assert_eq!(
        manager
            .inspect("actor-manager", &s, &reserved.reservation.id)
            .await
            .unwrap()
            .evidence,
        evidence
    );
    let mut wrong_scope = s.clone();
    wrong_scope.client_id = "client-b".into();
    assert_eq!(
        repo.inspect("actor-a", &wrong_scope, &reserved.reservation.id)
            .await,
        Err(EvidenceError::Denied)
    );
    let mut tx = scope::begin(&pool, "actor-manager", &s).await.unwrap();
    let invisible: i64 = sqlx::query_scalar("SELECT count(*) FROM evidence_reservations")
        .fetch_one(&mut *tx)
        .await
        .unwrap();
    assert_eq!(invisible, 0, "RLS hides another owner's incomplete custody");
    tx.rollback().await.unwrap();
    for table in ["evidence_reservations", "evidence_originals"] {
        let grants:(bool,bool)=sqlx::query_as("SELECT has_table_privilege(current_user,$1,'UPDATE'),has_table_privilege(current_user,$1,'DELETE')").bind(table).fetch_one(&pool).await.unwrap();
        assert_eq!(grants, (false, false));
    }
    let mut escaped = request("escaped-source");
    let extreme = "\\\"".repeat(1000);
    escaped.source = SourceAssertions {
        system: Some(extreme.clone()),
        account: Some(extreme.clone()),
        source_version: Some(extreme.clone()),
        selection: Some(extreme.clone()),
        coverage: Some(extreme),
    };
    assert!(escaped.is_valid());
    repo.reserve("actor-a", &s, &escaped, &namespace)
        .await
        .unwrap();
    // Real indexed pagination retains registered history and owner-only incomplete custody.
    for index in 0..54 {
        let command = request(&format!("registered-page-{index}"));
        let mut reserved = repo
            .reserve("actor-a", &s, &command, &namespace)
            .await
            .unwrap();
        // Deterministic mixed-case fixture IDs expose locale-sensitive pagination.
        // Only the guarded test administrator can arrange IDs this way.
        let mixed_id = format!(
            "{}-registered-{index:03}",
            if index % 2 == 0 { "A" } else { "a" }
        );
        sqlx::query("UPDATE evidence_reservations SET id=$1 WHERE id=$2")
            .bind(&mixed_id)
            .bind(&reserved.reservation.id)
            .execute(&mut admin)
            .await
            .unwrap();
        reserved.reservation.id = mixed_id;
        repo.register(
            "actor-a",
            &s,
            &reserved.reservation.id,
            &namespace,
            "page-v1",
            &command.identity,
        )
        .await
        .unwrap();
    }
    let first = manager.list("actor-manager", &s, None).await.unwrap();
    assert_eq!(first.items.len(), 50);
    let second = manager
        .list("actor-manager", &s, first.next_cursor.as_deref())
        .await
        .unwrap();
    assert_eq!(second.items.len(), 5);
    assert!(second.next_cursor.is_none());
    let actual: Vec<String> = first
        .items
        .iter()
        .chain(&second.items)
        .map(|item| item.reservation.id.clone())
        .collect();
    let expected: Vec<String> =
        sqlx::query_scalar("SELECT id FROM evidence_originals ORDER BY id COLLATE \"C\"")
            .fetch_all(&mut admin)
            .await
            .unwrap();
    assert_eq!(
        actual, expected,
        "R02 registry predicates and ordering share byte collation across page boundaries"
    );
    assert!(actual.windows(2).all(|pair| pair[0] < pair[1]));
    let search_first = manager
        .search(
            "actor-manager",
            &s,
            &EvidenceSearchQuery::new("", None).unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(search_first.items.len(), 50);
    let search_second = manager
        .search(
            "actor-manager",
            &s,
            &EvidenceSearchQuery::new("", search_first.next_cursor).unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(search_second.items.len(), 5);
    assert!(search_second.coverage.complete);
    assert_eq!(
        search_first
            .items
            .iter()
            .chain(&search_second.items)
            .map(|item| item.reservation.id.clone())
            .collect::<Vec<_>>(),
        expected,
        "search retains C-collated order across mixed-case cursor boundaries"
    );
    assert_bounded_metadata_search(&repo, &manager, &mut admin, &reserved.reservation.id).await;
    for index in 0..50 {
        let pending = repo
            .reserve(
                "actor-a",
                &s,
                &request(&format!("incomplete-page-{index}")),
                &namespace,
            )
            .await
            .unwrap();
        let mixed_id = format!(
            "{}-pending-{index:03}",
            if index % 2 == 0 { "Z" } else { "z" }
        );
        sqlx::query("UPDATE evidence_reservations SET id=$1 WHERE id=$2")
            .bind(&mixed_id)
            .bind(&pending.reservation.id)
            .execute(&mut admin)
            .await
            .unwrap();
    }
    let first = repo.recover("actor-a", &s, None).await.unwrap();
    assert_eq!(first.items.len(), 50);
    let second = repo
        .recover("actor-a", &s, first.next_cursor.as_deref())
        .await
        .unwrap();
    assert_eq!(second.items.len(), 1);
    assert!(second.next_cursor.is_none());
    let actual: Vec<String> = first
        .items
        .iter()
        .chain(&second.items)
        .map(|item| item.id.clone())
        .collect();
    let expected: Vec<String> = sqlx::query_scalar("SELECT r.id FROM evidence_reservations r WHERE NOT EXISTS(SELECT 1 FROM evidence_originals e WHERE e.id=r.id) ORDER BY r.id COLLATE \"C\"").fetch_all(&mut admin).await.unwrap();
    assert_eq!(
        actual, expected,
        "R02 recovery predicates and ordering share byte collation across page boundaries"
    );
    assert!(actual.windows(2).all(|pair| pair[0] < pair[1]));
    // Lose acknowledgements at the PostgreSQL boundary, after actual COMMIT.
    // The authoritative row persists and an exact retry returns its original result.
    let relay = CommitAckProxy::start(&config.runtime).await;
    let relay_pool = PgPoolOptions::new()
        .max_connections(1)
        .connect_with(database_options(&relay.url).unwrap())
        .await
        .unwrap();
    let relay_repo =
        EvidenceRepository::new(relay_pool.clone()).with_session_hash(secret_hash(&token));
    let lost = request("lost-database-ack");
    relay.armed.store(true, std::sync::atomic::Ordering::SeqCst);
    assert_eq!(
        relay_repo.reserve("actor-a", &s, &lost, &namespace).await,
        Err(EvidenceError::Unavailable)
    );
    assert!(relay.dropped.load(std::sync::atomic::Ordering::SeqCst));
    let recovered = relay_repo
        .reserve("actor-a", &s, &lost, &namespace)
        .await
        .unwrap();
    relay
        .dropped
        .store(false, std::sync::atomic::Ordering::SeqCst);
    relay.armed.store(true, std::sync::atomic::Ordering::SeqCst);
    assert_eq!(
        relay_repo
            .register(
                "actor-a",
                &s,
                &recovered.reservation.id,
                &namespace,
                "ack-v1",
                &lost.identity
            )
            .await,
        Err(EvidenceError::Unavailable)
    );
    assert!(relay.dropped.load(std::sync::atomic::Ordering::SeqCst));
    let registered = relay_repo
        .register(
            "actor-a",
            &s,
            &recovered.reservation.id,
            &namespace,
            "ack-v1",
            &lost.identity,
        )
        .await
        .unwrap();
    assert_eq!(
        registered,
        repo.inspect("actor-a", &s, &recovered.reservation.id)
            .await
            .unwrap()
            .evidence
    );
    relay_pool.close().await;
    drop(relay);
    assert_incomplete_reservation_quota(&repo, &manager, &mut admin, &namespace).await;
    // Session rotation never inherits the previous capability; fresh current scope
    // may explicitly recover the same owner's durable reservation.
    let rotated = identities
        .establish_session(ISSUER, "auditor-a", "Auditor", Some(&token))
        .await
        .unwrap();
    assert_eq!(
        repo.list("actor-a", &s, None).await,
        Err(EvidenceError::Denied)
    );
    assert_eq!(
        repo.search("actor-a", &s, &EvidenceSearchQuery::new("", None).unwrap())
            .await,
        Err(EvidenceError::Denied)
    );
    let repo = EvidenceRepository::new(pool.clone()).with_session_hash(secret_hash(&rotated));
    assert_eq!(
        repo.reserve("actor-a", &s, &command, &namespace)
            .await
            .unwrap()
            .registered,
        Some(evidence)
    );
    // Hold the real engagement lock, revoke the captured session while registration
    // waits, then require the post-wait exact-session check to refuse its insert.
    let pending = repo
        .reserve("actor-a", &s, &request("held-registration"), &namespace)
        .await
        .unwrap();
    let mut barrier = PgConnection::connect(&config.admin).await.unwrap();
    config.guard_connection(&mut barrier).await;
    barrier.execute("BEGIN; SELECT id FROM engagements WHERE organisation_id='org-a' AND client_id='client-a' AND id='engagement-a' FOR UPDATE").await.unwrap();
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut barrier)
        .await
        .unwrap();
    let waiting_repo = repo.clone();
    let waiting_id = pending.reservation.id.clone();
    let waiting_namespace = namespace.clone();
    let waiting = tokio::spawn(async move {
        waiting_repo
            .register(
                "actor-a",
                &scope_a(),
                &waiting_id,
                &waiting_namespace,
                "late-v1",
                &request("held-registration").identity,
            )
            .await
    });
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        let blocked:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity a WHERE a.datname=current_database() AND a.application_name='zobba-evidence-custody-contract' AND $1=ANY(pg_blocking_pids(a.pid)))").bind(pid).fetch_one(&mut admin).await.unwrap();
        if blocked {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "registration did not wait on owned engagement lock"
        );
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    identities.logout(&rotated).await.unwrap();
    barrier.execute("COMMIT").await.unwrap();
    assert_eq!(waiting.await.unwrap(), Err(EvidenceError::Denied));
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM evidence_originals WHERE id=$1")
        .bind(&pending.reservation.id)
        .fetch_one(&mut admin)
        .await
        .unwrap();
    assert_eq!(
        count, 0,
        "revoked session registered after authority lock wait"
    );
    // A foreign/revoked reader gets the same refusal as a missing opaque handle.
    sqlx::query("UPDATE engagement_assignments SET active=false WHERE actor_id='actor-manager'")
        .execute(&mut admin)
        .await
        .unwrap();
    assert_eq!(
        manager
            .inspect("actor-manager", &s, &reserved.reservation.id)
            .await,
        Err(EvidenceError::Denied)
    );
    assert_eq!(
        manager.inspect("actor-manager", &s, "missing").await,
        Err(EvidenceError::Denied)
    );
    assert_eq!(
        manager
            .search(
                "actor-manager",
                &s,
                &EvidenceSearchQuery::new("Résumé", None).unwrap()
            )
            .await,
        Err(EvidenceError::Denied)
    );
    pool.close().await;
}

/// Administrative synthetic metadata prepares scan density without claiming
/// object acquisition. Reads use the real restricted repository and session.
async fn assert_bounded_metadata_search(
    repo: &EvidenceRepository,
    manager: &EvidenceRepository,
    admin: &mut PgConnection,
    source_id: &str,
) {
    let inserted = sqlx::query(
        "INSERT INTO evidence_reservations(id,organisation_id,client_id,engagement_id,actor_id,key,request,digest,size,namespace,reserved_at) \
         SELECT 'search-'||lpad(n::text,4,'0'),organisation_id,client_id,engagement_id,actor_id,'search-key-'||n, \
         (request::jsonb || jsonb_build_object('key','search-key-'||n,'filename','Résumé 界🙂 '||n||'.txt','coverage',CASE WHEN n=256 THEN 'Rare %_ needle' ELSE NULL END))::text, \
         digest,size,namespace,reserved_at FROM evidence_reservations CROSS JOIN generate_series(0,256) n WHERE id=$1",
    ).bind(source_id).execute(&mut *admin).await.unwrap();
    assert_eq!(inserted.rows_affected(), 257);
    sqlx::query("INSERT INTO evidence_originals(id,organisation_id,client_id,engagement_id,actor_id,key,request,digest,size,namespace,reserved_at,version) SELECT id,organisation_id,client_id,engagement_id,actor_id,key,request,digest,size,namespace,reserved_at,'search-version' FROM evidence_reservations WHERE id LIKE 'search-%'")
        .execute(&mut *admin).await.unwrap();
    // A matching foreign row falls inside this cursor range, but may neither
    // consume the current scope's candidate budget nor appear in its results.
    sqlx::query("INSERT INTO evidence_reservations(id,organisation_id,client_id,engagement_id,actor_id,key,request,digest,size,namespace,reserved_at) SELECT 'search-0000-foreign','org-b','client-b','engagement-b','actor-b',key,request,digest,size,namespace,reserved_at FROM evidence_reservations WHERE id='search-0000'")
        .execute(&mut *admin).await.unwrap();
    sqlx::query("INSERT INTO evidence_originals(id,organisation_id,client_id,engagement_id,actor_id,key,request,digest,size,namespace,reserved_at,version) SELECT id,organisation_id,client_id,engagement_id,actor_id,key,request,digest,size,namespace,reserved_at,'foreign-version' FROM evidence_reservations WHERE id='search-0000-foreign'")
        .execute(&mut *admin).await.unwrap();
    // The acquired original has a random ID and may sort anywhere after this
    // cursor. It consumes scan budget even though it does not match either query.
    // Independently count the exact scoped C-ordered prefix instead of assuming
    // that only the synthetic matching rows are examined.
    let candidates: Vec<String> = sqlx::query_scalar("SELECT id FROM evidence_originals WHERE organisation_id='org-a' AND client_id='client-a' AND engagement_id='engagement-a' AND id COLLATE \"C\">'search-' ORDER BY id COLLATE \"C\"")
        .fetch_all(&mut *admin).await.unwrap();
    let s = scope_a();
    let query = EvidenceSearchQuery::new("%_ NEEDLE", Some("search-".into())).unwrap();
    let first = manager.search("actor-manager", &s, &query).await.unwrap();
    assert!(first.items.is_empty());
    assert_eq!(first.coverage.examined_count, 256);
    assert_eq!(first.coverage.candidate_limit, 256);
    assert!(!first.coverage.complete);
    assert_eq!(first.next_cursor.as_ref(), Some(&candidates[255]));
    let second = manager
        .search(
            "actor-manager",
            &s,
            &EvidenceSearchQuery::new(&query.query, first.next_cursor).unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(second.items.len(), 1);
    assert_eq!(second.items[0].reservation.id, "search-0256");
    assert_eq!(second.items[0].version, "search-version");
    assert_eq!(second.items[0].reservation.scope, s);
    assert_eq!(second.coverage.examined_count, candidates.len() - 256);
    assert!(second.coverage.complete);
    assert!(second.next_cursor.is_none());
    let mut after = Some("search-".into());
    let mut actual = Vec::new();
    let mut pages = 0;
    let mut examined = 0;
    loop {
        let page = manager
            .search(
                "actor-manager",
                &s,
                &EvidenceSearchQuery::new("RÉSUMÉ 界🙂", after).unwrap(),
            )
            .await
            .unwrap();
        pages += 1;
        assert!(page.items.len() <= 50);
        let expected_cursor = (pages < 6).then(|| format!("search-{:04}", pages * 50 - 1));
        let expected_end = expected_cursor.as_ref().map_or(candidates.len(), |cursor| {
            candidates.iter().position(|id| id == cursor).unwrap() + 1
        });
        assert_eq!(page.coverage.examined_count, expected_end - examined);
        assert_eq!(page.next_cursor, expected_cursor);
        examined = expected_end;
        assert_eq!(page.coverage.complete, page.next_cursor.is_none());
        assert!(page.items.iter().all(|item| item.reservation.scope == s));
        actual.extend(page.items.into_iter().map(|item| item.reservation.id));
        after = page.next_cursor;
        if after.is_none() {
            break;
        }
        assert!(pages < 7, "bounded deterministic cursor must make progress");
    }
    assert_eq!(pages, 6);
    assert_eq!(
        actual,
        (0..257)
            .map(|n| format!("search-{n:04}"))
            .collect::<Vec<_>>()
    );
    assert_eq!(
        repo.search(
            "actor-a",
            &Scope {
                organisation_id: "org-b".into(),
                client_id: "client-b".into(),
                engagement_id: "engagement-b".into()
            },
            &EvidenceSearchQuery::new("Résumé", None).unwrap()
        )
        .await,
        Err(EvidenceError::Denied)
    );
    assert_eq!(
        repo.search(
            "actor-a",
            &s,
            &EvidenceSearchQuery {
                query: "x".repeat(201),
                after: None
            }
        )
        .await,
        Err(EvidenceError::Invalid)
    );
}

/// R15 exercises the durable per-owner/per-scope quota using the restricted
/// repository port. Test administration only creates the second authorised scope.
async fn assert_incomplete_reservation_quota(
    repo: &EvidenceRepository,
    manager: &EvidenceRepository,
    admin: &mut PgConnection,
    namespace: &str,
) {
    let s = scope_a();
    let pending: i64 = sqlx::query_scalar("SELECT count(*) FROM evidence_reservations r WHERE r.actor_id='actor-a' AND r.engagement_id='engagement-a' AND NOT EXISTS(SELECT 1 FROM evidence_originals e WHERE e.id=r.id)")
        .fetch_one(&mut *admin).await.unwrap();
    let first = repo
        .reserve("actor-a", &s, &request("quota-replay"), namespace)
        .await
        .unwrap();
    for index in pending + 1..100 {
        repo.reserve(
            "actor-a",
            &s,
            &request(&format!("quota-fill-{index}")),
            namespace,
        )
        .await
        .unwrap();
    }
    let before: i64 = sqlx::query_scalar("SELECT count(*) FROM evidence_reservations")
        .fetch_one(&mut *admin)
        .await
        .unwrap();
    assert_eq!(
        repo.reserve("actor-a", &s, &request("quota-overflow"), namespace)
            .await,
        Err(EvidenceError::ReservationLimit)
    );
    let after: i64 = sqlx::query_scalar("SELECT count(*) FROM evidence_reservations")
        .fetch_one(&mut *admin)
        .await
        .unwrap();
    assert_eq!(
        before, after,
        "R15 the 101st distinct reservation inserts no row"
    );
    assert_eq!(
        repo.reserve("actor-a", &s, &request("quota-replay"), namespace)
            .await
            .unwrap(),
        first,
        "R15 exact replay still succeeds at quota"
    );
    let mut changed = request("quota-replay");
    changed.source.coverage = Some("Changed assertion".into());
    assert_eq!(
        repo.reserve("actor-a", &s, &changed, namespace).await,
        Err(EvidenceError::Conflict),
        "R15 changed replay remains a conflict at quota"
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM evidence_reservations")
            .fetch_one(&mut *admin)
            .await
            .unwrap(),
        before
    );
    manager
        .reserve(
            "actor-manager",
            &s,
            &request("quota-other-actor"),
            namespace,
        )
        .await
        .unwrap();
    admin.execute("INSERT INTO engagements(organisation_id,client_id,id,name) VALUES('org-a','client-a','engagement-quota','Quota isolation'); INSERT INTO engagement_assignments(organisation_id,client_id,engagement_id,actor_id) VALUES('org-a','client-a','engagement-quota','actor-a');").await.unwrap();
    let other_scope = Scope {
        engagement_id: "engagement-quota".into(),
        ..s.clone()
    };
    repo.reserve(
        "actor-a",
        &other_scope,
        &request("quota-other-scope"),
        namespace,
    )
    .await
    .unwrap();
    assert_eq!(
        repo.reserve("actor-a", &s, &request("quota-overflow"), namespace)
            .await,
        Err(EvidenceError::ReservationLimit),
        "R15 other scopes neither share nor free this quota"
    );
    repo.register(
        "actor-a",
        &s,
        &first.reservation.id,
        namespace,
        "quota-v1",
        &first.reservation.request.identity,
    )
    .await
    .unwrap();
    let released = repo
        .reserve("actor-a", &s, &request("quota-overflow"), namespace)
        .await
        .unwrap();
    assert_eq!(
        repo.reserve("actor-a", &s, &request("quota-overflow-again"), namespace)
            .await,
        Err(EvidenceError::ReservationLimit),
        "R15 completing one original frees exactly one slot"
    );
    // Leave one slot for the later post-lock session-revocation proof.
    repo.register(
        "actor-a",
        &s,
        &released.reservation.id,
        namespace,
        "quota-v2",
        &released.reservation.request.identity,
    )
    .await
    .unwrap();
}
