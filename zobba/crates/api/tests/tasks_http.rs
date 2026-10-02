//! Actual HTTP/session/SQL proof; one test owns the guarded disposable schema.
use std::{collections::BTreeSet, time::Duration};

use reqwest::{Client, Response, StatusCode};
use serde_json::{Value, json};
use sqlx::{Connection, Executor, PgConnection};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    time::{Instant, timeout},
};
use zobba_application::identity::CurrentAuthority;
use zobba_infrastructure::{
    RuntimeDatabase, database_options, identity::IdentityRepository, migrate,
};

#[path = "../../infrastructure/tests/support/mod.rs"]
mod support;

const ISSUER: &str = "https://synthetic-task-http.example";

#[derive(Clone)]
struct Browser {
    client: Client,
    address: String,
    origin: String,
    token: String,
    csrf: String,
    actor: String,
}

impl Browser {
    async fn command(&self, route: &str, body: &Value) -> Response {
        self.raw_command(route, body.to_string()).await
    }

    async fn raw_command(&self, route: &str, body: String) -> Response {
        self.client
            .post(format!(
                "{}/engagements/engagement-a/{route}?organisation_id=org-a&client_id=client-a",
                self.address
            ))
            .header("Cookie", format!("__Host-zobba-session={}", self.token))
            .header("Origin", &self.origin)
            .header("X-CSRF-Token", &self.csrf)
            .header("X-Expected-Actor", &self.actor)
            .header("Content-Type", "application/json")
            .body(body)
            .send()
            .await
            .unwrap()
    }

    async fn read(&self, path: &str) -> Response {
        self.client
            .get(format!("{}{path}", self.address))
            .header("Cookie", format!("__Host-zobba-session={}", self.token))
            .send()
            .await
            .unwrap()
    }
}

async fn document(response: Response, expected: StatusCode) -> Value {
    assert_eq!(response.status(), expected);
    assert_eq!(response.headers()["cache-control"], "no-store");
    serde_json::from_str(&response.text().await.unwrap()).unwrap()
}

async fn headers(stream: &mut TcpStream) -> Vec<u8> {
    let mut result = Vec::new();
    while !result.ends_with(b"\r\n\r\n") {
        result.push(stream.read_u8().await.unwrap());
        assert!(result.len() <= 16_384, "bounded synthetic HTTP headers");
    }
    result
}

// 100 Continue is sent only once the real handler polls its body, after the
// count middleware acquires a permit. It gives a deterministic admission barrier
// without exposing internal counters or adding a production test hook.
async fn hold_body(browser: &Browser, route: &str, body: &Value) -> TcpStream {
    let authority = browser.address.strip_prefix("http://").unwrap();
    let mut stream = TcpStream::connect(authority).await.unwrap();
    let body = body.to_string();
    let request = format!(
        "POST /engagements/engagement-a/{route}?organisation_id=org-a&client_id=client-a HTTP/1.1\r\nHost: {authority}\r\nCookie: __Host-zobba-session={}\r\nOrigin: {}\r\nX-CSRF-Token: {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nExpect: 100-continue\r\nConnection: close\r\n\r\n",
        browser.token,
        browser.origin,
        browser.csrf,
        body.len()
    );
    stream.write_all(request.as_bytes()).await.unwrap();
    let interim = timeout(Duration::from_secs(2), headers(&mut stream))
        .await
        .expect("real HTTP handler starts consuming this body");
    assert_eq!(interim, b"HTTP/1.1 100 Continue\r\n\r\n");
    stream
        .write_all(&body.as_bytes()[..body.len() - 1])
        .await
        .unwrap();
    stream
}

fn wire_document(response: &[u8], expected: StatusCode) -> Value {
    let split = response
        .windows(4)
        .position(|part| part == b"\r\n\r\n")
        .unwrap();
    let head = std::str::from_utf8(&response[..split]).unwrap();
    assert!(head.starts_with(&format!("HTTP/1.1 {} ", expected.as_u16())));
    assert!(head.contains("cache-control: no-store"));
    serde_json::from_slice(&response[split + 4..]).unwrap()
}

async fn after_cancel(browser: &Browser, route: &str, body: &Value) -> Value {
    timeout(Duration::from_secs(2), async {
        loop {
            let response = browser.command(route, body).await;
            if response.status() != StatusCode::TOO_MANY_REQUESTS {
                return document(response, StatusCode::ACCEPTED).await;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("disconnect releases the request permit before its deadline")
}

async fn request_count_deadline_and_cancellation(browser: &Browser, task_id: &str, cycle_id: &str) {
    let create =
        json!({"key":"http-count-create","kind":"create","content":"Bounded HTTP objective"});
    let guide = json!({"key":"http-count-guide","kind":"guide","task_id":task_id,"cycle_id":cycle_id,"content":"Bounded HTTP guidance"});
    let mut ordinary = Vec::new();
    for _ in 0..8 {
        ordinary.push(hold_body(browser, "task-commands", &create).await);
    }
    assert_eq!(
        document(
            browser.command("task-commands", &create).await,
            StatusCode::TOO_MANY_REQUESTS
        )
        .await,
        json!({"error":"task_capacity"})
    );
    let original_guide = document(
        browser.command("task-controls", &guide).await,
        StatusCode::ACCEPTED,
    )
    .await;
    assert_eq!(
        document(
            browser.command("task-controls", &guide).await,
            StatusCode::ACCEPTED
        )
        .await,
        original_guide,
        "same-key control retry performs fresh reserved authorization without ordinary preflight"
    );
    for suffix in ["", "/history?through=0", "/events?after=0"] {
        let separator = if suffix.contains('?') { '&' } else { '?' };
        assert_eq!(browser.read(&format!("/engagements/engagement-a/conversation{suffix}{separator}organisation_id=org-a&client_id=client-a")).await.status(),StatusCode::TOO_MANY_REQUESTS,"conversation shares the eight ordinary permits, preserving the separate control lane");
    }

    let mut control = Vec::new();
    for _ in 0..4 {
        control.push(hold_body(browser, "task-controls", &guide).await);
    }
    assert_eq!(
        document(
            browser.command("task-controls", &guide).await,
            StatusCode::TOO_MANY_REQUESTS
        )
        .await,
        json!({"error":"task_capacity"})
    );

    drop(ordinary.pop());
    let original_create = after_cancel(browser, "task-commands", &create).await;
    assert_eq!(
        browser.command("task-controls", &guide).await.status(),
        StatusCode::TOO_MANY_REQUESTS,
        "a released ordinary permit cannot release a control permit"
    );
    ordinary.push(hold_body(browser, "task-commands", &create).await);

    drop(control.pop());
    assert_eq!(
        after_cancel(browser, "task-controls", &guide).await,
        original_guide
    );
    assert_eq!(
        browser.command("task-commands", &create).await.status(),
        StatusCode::TOO_MANY_REQUESTS,
        "a released control permit cannot release an ordinary permit"
    );
    control.push(hold_body(browser, "task-controls", &guide).await);

    let started = Instant::now();
    timeout(Duration::from_secs(8), async {
        for mut stream in ordinary.into_iter().chain(control) {
            let mut response = Vec::new();
            stream.read_to_end(&mut response).await.unwrap();
            assert_eq!(
                wire_document(&response, StatusCode::SERVICE_UNAVAILABLE),
                json!({"error":"task_unavailable"})
            );
        }
    })
    .await
    .expect("six-second deadlines cancel all twelve unfinished HTTP bodies");
    assert!(started.elapsed() < Duration::from_secs(8));
    assert_eq!(
        document(
            browser.command("task-commands", &create).await,
            StatusCode::ACCEPTED
        )
        .await,
        original_create
    );
    assert_eq!(
        document(
            browser.command("task-controls", &guide).await,
            StatusCode::ACCEPTED
        )
        .await,
        original_guide
    );
    // Reacquiring every slot, with a 100 Continue from each, proves all twelve
    // deadline cancellations released their permits rather than just one slot.
    let mut reacquired = Vec::new();
    for (route, body, count) in [("task-commands", &create, 8), ("task-controls", &guide, 4)] {
        for _ in 0..count {
            reacquired.push(hold_body(browser, route, body).await);
        }
    }
    drop(reacquired);
    assert_eq!(
        after_cancel(browser, "task-commands", &create).await,
        original_create
    );
    assert_eq!(
        after_cancel(browser, "task-controls", &guide).await,
        original_guide
    );
}

async fn lost_committed_acknowledgement(browser: &Browser, admin: &mut PgConnection) {
    // The only fault seam is an external TCP proxy inside this test binary.
    // It forwards the exact authenticated request to the production router,
    // waits for its complete committed 202 response, then closes the client
    // socket without transmitting any response bytes.
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let proxy_address = format!("http://{}", listener.local_addr().unwrap());
    let upstream = browser.address.strip_prefix("http://").unwrap().to_owned();
    let proxy = tokio::spawn(async move {
        let (mut downstream, _) = listener.accept().await.unwrap();
        let head = headers(&mut downstream).await;
        let length: usize = std::str::from_utf8(&head)
            .unwrap()
            .lines()
            .find_map(|line| {
                line.to_ascii_lowercase()
                    .strip_prefix("content-length: ")
                    .map(str::to_owned)
            })
            .unwrap()
            .parse()
            .unwrap();
        assert!(length < 32 * 1_024);
        let mut body = vec![0; length];
        downstream.read_exact(&mut body).await.unwrap();
        let mut server = TcpStream::connect(upstream).await.unwrap();
        server.write_all(&head).await.unwrap();
        server.write_all(&body).await.unwrap();
        let mut response = Vec::new();
        server.read_to_end(&mut response).await.unwrap();
        let committed = wire_document(&response, StatusCode::ACCEPTED);
        drop(downstream);
        committed
    });
    let command = json!({"key":"http-lost-committed-ack","kind":"create","content":"Retained uncertain admission"});
    let lost = browser.client.post(format!("{proxy_address}/engagements/engagement-a/task-commands?organisation_id=org-a&client_id=client-a"))
        .header("Cookie", format!("__Host-zobba-session={}", browser.token))
        .header("Origin", &browser.origin).header("X-CSRF-Token", &browser.csrf)
        .header("Content-Type", "application/json").header("Connection", "close")
        .body(command.to_string()).send().await;
    assert!(
        lost.is_err(),
        "caller receives no committed acknowledgement"
    );
    let committed = timeout(Duration::from_secs(2), proxy)
        .await
        .unwrap()
        .unwrap();
    for _ in 0..3 {
        assert_eq!(
            document(
                browser.command("task-commands", &command).await,
                StatusCode::ACCEPTED
            )
            .await,
            committed
        );
    }
    let facts: (i64, i64, i64, i64) = sqlx::query_as(
        "SELECT
        (SELECT count(*) FROM public.task_commands WHERE idempotency_key='http-lost-committed-ack'),
        (SELECT count(*) FROM public.tasks WHERE id=$1),
        (SELECT count(*) FROM public.task_events WHERE command_id=$2 AND kind='received'),
        (SELECT count(*) FROM public.task_wakeups WHERE task_id=$1)",
    )
    .bind(committed["task_id"].as_str().unwrap())
    .bind(committed["command_id"].as_str().unwrap())
    .fetch_one(admin)
    .await
    .unwrap();
    assert_eq!(
        facts,
        (1, 1, 1, 1),
        "lost response and repeated retry create exactly one durable work item"
    );
}

async fn event_cursor_pages(
    browser: &Browser,
    admin: &mut PgConnection,
    task_id: &str,
    cycle_id: &str,
) {
    for index in 0..105 {
        let guide = json!({"key":format!("http-event-page-{index}"),"kind":"guide","task_id":task_id,"cycle_id":cycle_id,"content":"Retained pagination guidance"});
        document(
            browser.command("task-controls", &guide).await,
            StatusCode::ACCEPTED,
        )
        .await;
    }
    let expected: Vec<(i64, Option<String>)> = sqlx::query_as("SELECT cursor,command_id FROM public.task_events WHERE organisation_id='org-a' AND client_id='client-a' AND engagement_id='engagement-a' ORDER BY cursor")
        .fetch_all(admin).await.unwrap();
    assert!(expected.len() > 100);
    let mut after = "0".to_owned();
    let mut delivered = Vec::new();
    let mut pages = 0;
    loop {
        let page = document(browser.read(&format!("/engagements/engagement-a/task-events?organisation_id=org-a&client_id=client-a&after={after}")).await, StatusCode::OK).await;
        let events = page["events"].as_array().unwrap();
        let next = page["next_cursor"].as_str().unwrap();
        assert!(events.len() <= 100);
        if events.is_empty() {
            assert_eq!(
                next, after,
                "empty pages preserve the returned continuation cursor"
            );
            break;
        }
        assert_eq!(next, events.last().unwrap()["cursor"].as_str().unwrap());
        for event in events {
            assert_eq!(event.as_object().unwrap().len(), 5);
            delivered.push((
                event["cursor"].as_str().unwrap().parse::<i64>().unwrap(),
                event["command_id"].as_str().map(str::to_owned),
            ));
        }
        // Only this HTTP response determines the next request, never a locally
        // calculated cursor, a fixture row, or the last event inspected above.
        after = next.to_owned();
        pages += 1;
        assert!(pages <= 10, "cursor must make bounded progress");
    }
    assert!(pages >= 2);
    assert_eq!(
        delivered, expected,
        "HTTP cursors drain every persisted event in commit order"
    );
    let unique: BTreeSet<_> = delivered.iter().map(|event| event.0).collect();
    assert_eq!(
        unique.len(),
        delivered.len(),
        "no repeated event across pages"
    );
    let padded_cursor = format!("000{after}");
    let empty = document(browser.read(&format!("/engagements/engagement-a/task-events?organisation_id=org-a&client_id=client-a&after={padded_cursor}")).await, StatusCode::OK).await;
    assert!(empty["events"].as_array().unwrap().is_empty());
    assert_eq!(
        empty["next_cursor"], padded_cursor,
        "an empty page preserves any valid supplied cursor exactly"
    );
}

async fn conversation_http_pages(browser: &Browser, admin: &mut PgConnection, task_id: &str) {
    let base = "/engagements/engagement-a/conversation";
    let scope = "organisation_id=org-a&client_id=client-a";
    let snapshot = document(
        browser.read(&format!("{base}?{scope}")).await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(
        snapshot["scope"],
        json!({"organisation_id":"org-a","client_id":"client-a","engagement_id":"engagement-a"})
    );
    assert_eq!(snapshot["audience"], "engagement_members");
    let through = snapshot["watermark"].as_str().unwrap();
    assert_eq!(snapshot["messages"].as_array().unwrap().len(), 100);
    assert!(snapshot["before_cursor"].is_string());
    assert!(
        snapshot["tasks"]
            .as_array()
            .unwrap()
            .iter()
            .all(|task| task["accountable_label"] == "Alex")
    );
    let mut delivered = snapshot["messages"].as_array().unwrap().clone();
    let mut before = snapshot["before_cursor"].as_str().map(str::to_owned);
    while let Some(cursor) = before {
        let history = document(
            browser
                .read(&format!(
                    "{base}/history?{scope}&through={through}&before={cursor}"
                ))
                .await,
            StatusCode::OK,
        )
        .await;
        assert_eq!(history["watermark"], through);
        assert_eq!(history["scope"], snapshot["scope"]);
        assert_eq!(history["audience"], "engagement_members");
        assert!(history["messages"].as_array().unwrap().len() <= 100);
        delivered.extend(history["messages"].as_array().unwrap().iter().cloned());
        before = history["before_cursor"].as_str().map(str::to_owned);
    }
    let expected: Vec<(String,String,String)> = sqlx::query_as("SELECT id,idempotency_key,received_cursor::text FROM public.task_commands WHERE engagement_id='engagement-a' ORDER BY task_commands.received_cursor")
        .fetch_all(&mut *admin).await.unwrap();
    assert_eq!(delivered.len(), expected.len());
    delivered.sort_by_key(|message| {
        message["received_cursor"]
            .as_str()
            .unwrap()
            .parse::<u64>()
            .unwrap()
    });
    for (message, (command, key, received)) in delivered.iter().zip(&expected) {
        assert_eq!(message["command_id"], *command);
        assert_eq!(message["key"], *key);
        assert_eq!(message["received_cursor"], *received);
        assert_eq!(message["author_id"], "identity-a");
        assert_eq!(message["author_label"], "Alex");
        assert!(message["applied_cursor"].is_null());
        assert_eq!(
            message.get("context"),
            Some(&Value::Null),
            "commands without explicit audit context retain the owned null field"
        );
        assert_eq!(
            message.as_object().unwrap().len(),
            13,
            "only the owned message contract is disclosed"
        );
    }
    assert_eq!(
        delivered
            .iter()
            .filter(|message| message["key"] == "http-lost-committed-ack")
            .count(),
        1,
        "lost acknowledgement remains one durable message"
    );
    let scoped = document(
        browser
            .read(&format!(
                "{base}/history?{scope}&through={through}&task_id={task_id}"
            ))
            .await,
        StatusCode::OK,
    )
    .await;
    assert!(
        scoped["messages"]
            .as_array()
            .unwrap()
            .iter()
            .all(|message| message["task_id"] == task_id)
    );
    let mut cursor = "0".to_owned();
    let mut events = Vec::new();
    loop {
        let page = document(
            browser
                .read(&format!("{base}/events?{scope}&after={cursor}"))
                .await,
            StatusCode::OK,
        )
        .await;
        assert_eq!(page["resync_required"], false);
        let batch = page["events"].as_array().unwrap();
        assert!(batch.len() <= 100);
        assert_eq!(
            page["next_cursor"],
            batch
                .last()
                .map_or(cursor.as_str(), |event| event["cursor"].as_str().unwrap())
        );
        events.extend(batch.iter().cloned());
        cursor = page["next_cursor"].as_str().unwrap().to_owned();
        if !page["has_more"].as_bool().unwrap() {
            break;
        }
    }
    assert_eq!(cursor, through);
    assert_eq!(events.len(), expected.len());
    let future = document(
        browser
            .read(&format!("{base}/events?{scope}&after=9223372036854775807"))
            .await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(future["resync_required"], true);
    assert_eq!(future["next_cursor"], "9223372036854775807");
    assert!(future["events"].as_array().unwrap().is_empty());
    for path in [
        format!("{base}/history?{scope}&through=-1"),
        format!("{base}/history?{scope}"),
        format!("{base}/events?{scope}&after=9223372036854775808"),
        format!("{base}/events?{scope}&after=1.5"),
    ] {
        assert_eq!(browser.read(&path).await.status(), StatusCode::BAD_REQUEST);
    }
    for path in [
        format!("{base}?organisation_id=foreign&client_id=client-a"),
        format!("{base}/history?organisation_id=foreign&client_id=client-a&through=0"),
        format!("{base}/events?organisation_id=foreign&client_id=client-a&after=0"),
    ] {
        assert_eq!(browser.read(&path).await.status(), StatusCode::FORBIDDEN);
    }
}

async fn fixture(config: &support::Configuration, admin: &mut PgConnection) {
    // The schema must be recreated by its migration owner, not the separate
    // superuser used below solely for guarded synthetic identities/memberships.
    let mut migration = PgConnection::connect_with(&database_options(&config.migration).unwrap())
        .await
        .unwrap();
    config.guard_connection(&mut migration).await;
    migration.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT USAGE ON SCHEMA public TO PUBLIC; REVOKE CREATE ON SCHEMA public FROM PUBLIC;").await.unwrap();
    let owns_schema: bool = sqlx::query_scalar("SELECT nspowner = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user) FROM pg_catalog.pg_namespace WHERE nspname='public'")
        .fetch_one(&mut migration).await.unwrap();
    assert!(
        owns_schema,
        "HTTP fixture reset preserves migration ownership"
    );
    migration.close().await.unwrap();
    config.guard_connection(admin).await;
    let role = database_options(&config.runtime)
        .unwrap()
        .get_username()
        .to_owned();
    migrate(&config.migration, &role).await.unwrap();
    let mut tx = admin.begin().await.unwrap();
    sqlx::query("INSERT INTO public.identities(id,issuer,subject,display_name) VALUES('identity-a',$1,'auditor-a','Alex'),('identity-admin',$1,'admin','Casey'),('identity-peer',$1,'auditor-peer','Peer')")
        .bind(ISSUER).execute(&mut *tx).await.unwrap();
    tx.execute("INSERT INTO public.organisations(id,name) VALUES('org-a','Northstar');
        INSERT INTO public.clients(organisation_id,id,name) VALUES('org-a','client-a','Alder');
        INSERT INTO public.engagements(organisation_id,client_id,id,name) VALUES('org-a','client-a','engagement-a','Audit A');
        INSERT INTO public.organisation_memberships(organisation_id,actor_id,roles) VALUES('org-a','identity-a',ARRAY['auditor']),('org-a','identity-admin',ARRAY['admin']),('org-a','identity-peer',ARRAY['auditor']);
        INSERT INTO public.engagement_assignments(organisation_id,client_id,engagement_id,actor_id) VALUES('org-a','client-a','engagement-a','identity-a'),('org-a','client-a','engagement-a','identity-admin'),('org-a','client-a','engagement-a','identity-peer');")
        .await.unwrap();
    tx.commit().await.unwrap();
}

#[tokio::test]
async fn scoped_http_commands_reauthorize_retries_and_reserve_control_authentication() {
    let config = support::Configuration::from_environment();
    let mut admin = PgConnection::connect_with(&database_options(&config.admin).unwrap())
        .await
        .unwrap();
    fixture(&config, &mut admin).await;
    let database = RuntimeDatabase::connect(&config.runtime).await.unwrap();
    let identities = IdentityRepository::new(database.pool().clone());
    let token = identities
        .establish_session(ISSUER, "auditor-a", "Alex", None)
        .await
        .unwrap();
    let session = identities.session(&token).await.unwrap();
    let auth = zobba_api::auth::AuthState::from_environment(&database).unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = format!("http://{}", listener.local_addr().unwrap());
    let app = zobba_api::authenticated_router(database.clone(), auth);
    let (stop, stopped) = tokio::sync::oneshot::channel::<()>();
    let server = tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(async {
                let _ = stopped.await;
            })
            .await
            .unwrap();
    });
    let browser = Browser {
        client: Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .unwrap(),
        address,
        origin: std::env::var("ZOBBA_PUBLIC_ORIGIN")
            .expect("load the actual local fixture environment for HTTP tests"),
        token,
        csrf: session.csrf_token,
        actor: "identity-a".into(),
    };
    let create =
        json!({"key":"http-create","kind":"create","content":"Retained synthetic objective"});
    let receipt = document(
        browser.command("task-commands", &create).await,
        StatusCode::ACCEPTED,
    )
    .await;
    assert_eq!(receipt["status"], "received");
    assert!(receipt["event_cursor"].is_string());
    assert_eq!(receipt.as_object().unwrap().len(), 5);
    let task_id = receipt["task_id"].as_str().unwrap();
    let cycle_id = receipt["cycle_id"].as_str().unwrap();
    for actor in [
        "identity-admin".to_owned(),
        String::new(),
        "bad actor".to_owned(),
        "a".repeat(129),
    ] {
        let response=browser.client.post(format!("{}/engagements/engagement-a/task-commands?organisation_id=org-a&client_id=client-a",browser.address))
            .header("Cookie",format!("__Host-zobba-session={}",browser.token)).header("Origin",&browser.origin).header("X-CSRF-Token",&browser.csrf).header("X-Expected-Actor",actor)
            .header("Content-Type", "application/json").body(create.to_string()).send().await.unwrap();
        assert_eq!(
            document(response, StatusCode::FORBIDDEN).await["error"],
            "access_denied",
            "actor fence precedes even identical receipt recovery"
        );
    }
    let duplicate = browser
        .client
        .post(format!(
            "{}/engagements/engagement-a/task-commands?organisation_id=org-a&client_id=client-a",
            browser.address
        ))
        .header("Cookie", format!("__Host-zobba-session={}", browser.token))
        .header("Origin", &browser.origin)
        .header("X-CSRF-Token", &browser.csrf)
        .header("X-Expected-Actor", "identity-a")
        .header("X-Expected-Actor", "identity-a")
        .header("Content-Type", "application/json")
        .body(create.to_string())
        .send()
        .await
        .unwrap();
    assert_eq!(duplicate.status(), StatusCode::FORBIDDEN);
    let peer_token = identities
        .establish_session(ISSUER, "auditor-peer", "Peer", None)
        .await
        .unwrap();
    let peer_session = identities.session(&peer_token).await.unwrap();
    let changed_actor = browser
        .client
        .post(format!(
            "{}/engagements/engagement-a/task-commands?organisation_id=org-a&client_id=client-a",
            browser.address
        ))
        .header("Cookie", format!("__Host-zobba-session={peer_token}"))
        .header("Origin", &browser.origin)
        .header("X-CSRF-Token", peer_session.csrf_token)
        .header("X-Expected-Actor", "identity-a")
        .header("Content-Type", "application/json")
        .body(create.to_string())
        .send()
        .await
        .unwrap();
    assert_eq!(
        changed_actor.status(),
        StatusCode::FORBIDDEN,
        "a current authorized peer with valid CSRF cannot replay the previous actor's outbox"
    );
    let peer_commands: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM public.task_commands WHERE author_id='identity-peer'",
    )
    .fetch_one(&mut admin)
    .await
    .unwrap();
    assert_eq!(peer_commands, 0);

    // Reverse raw JSON order and explicitly include null optional fields. The
    // repository compares parsed meaning, not an unstable serialization hash.
    let response = browser.client
        .post(format!("{}/engagements/engagement-a/task-commands?organisation_id=org-a&client_id=client-a", browser.address))
        .header("Cookie", format!("__Host-zobba-session={}", browser.token))
        .header("Origin", &browser.origin).header("X-CSRF-Token", &browser.csrf)
        .header("Content-Type", "application/json")
        .body(r#"{"content":"Retained synthetic objective","cycle_id":null,"task_id":null,"kind":"create","key":"http-create"}"#)
        .send().await.unwrap();
    assert_eq!(document(response, StatusCode::ACCEPTED).await, receipt);
    let changed = json!({"key":"http-create","kind":"create","content":"Different objective"});
    assert_eq!(
        document(
            browser.command("task-commands", &changed).await,
            StatusCode::CONFLICT
        )
        .await["error"],
        "task_command_conflict"
    );

    let guide = json!({"key":"http-guide","kind":"guide","task_id":task_id,"cycle_id":cycle_id,"content":"Retained guidance"});
    assert_eq!(
        browser.command("task-commands", &guide).await.status(),
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        browser.command("task-controls", &create).await.status(),
        StatusCode::BAD_REQUEST
    );
    let pause = json!({"key":"http-pause","kind":"pause","task_id":task_id,"cycle_id":cycle_id});

    // Occupy every ordinary connection and start an ordinary read that must
    // queue on authentication. Reserved controls still authenticate and commit.
    let mut occupied = Vec::new();
    for _ in 0..4 {
        occupied.push(database.pool().acquire().await.unwrap());
    }
    let waiting = browser
        .client
        .get(format!(
            "{}/engagements/engagement-a/conversation?organisation_id=org-a&client_id=client-a",
            browser.address
        ))
        .header("Cookie", format!("__Host-zobba-session={}", browser.token));
    let waiting = tokio::spawn(async move { waiting.send().await.unwrap() });
    for body in [&guide, &pause] {
        let response = tokio::time::timeout(Duration::from_secs(2), browser.command("task-controls", body)).await.expect("reserved authentication and control admission are independent of ordinary pool saturation");
        assert_eq!(
            document(response, StatusCode::ACCEPTED).await["status"],
            "received"
        );
    }
    assert!(
        !waiting.is_finished(),
        "ordinary authentication should still be queued"
    );
    drop(occupied);
    assert_eq!(waiting.await.unwrap().status(), StatusCode::OK);

    let path = format!(
        "/engagements/engagement-a/tasks/{task_id}?organisation_id=org-a&client_id=client-a"
    );
    let snapshot = document(browser.read(&path).await, StatusCode::OK).await;
    assert_eq!(snapshot["state"], "paused");
    assert_eq!(snapshot["cessation"], "confirmed");
    assert_eq!(snapshot["accountable_actor"], "identity-a");
    assert!(snapshot["intent_revision"].is_string());
    let page = document(
        browser
            .read("/engagements/engagement-a/tasks?organisation_id=org-a&client_id=client-a")
            .await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(page["tasks"].as_array().unwrap().len(), 1);
    assert!(page["next_cursor"].is_null());
    let exhausted = document(browser.read(&format!("/engagements/engagement-a/tasks?organisation_id=org-a&client_id=client-a&after_task_id={task_id}")).await, StatusCode::OK).await;
    assert!(exhausted["tasks"].as_array().unwrap().is_empty());
    assert!(exhausted["next_cursor"].is_null());

    // Content is valid and tiny. Only JSON whitespace takes this over the HTTP
    // byte bound, so dropping that bound cannot hide behind domain validation.
    let oversized =
        json!({"key":"http-whitespace-body","kind":"create","content":"Valid bounded objective"});
    let mut over_bound = oversized.to_string();
    over_bound.push_str(&" ".repeat(32 * 1_024 + 1 - over_bound.len()));
    assert_eq!(
        serde_json::from_str::<Value>(&over_bound).unwrap(),
        oversized
    );
    let rejected = document(
        browser.raw_command("task-commands", over_bound).await,
        StatusCode::BAD_REQUEST,
    )
    .await;
    assert_eq!(rejected, json!({"error":"invalid_task_command"}));
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM public.task_commands WHERE idempotency_key='http-whitespace-body'",
    )
    .fetch_one(&mut admin)
    .await
    .unwrap();
    assert_eq!(
        count, 0,
        "oversized otherwise-valid body never admits a command"
    );
    let mut below_bound = oversized.to_string();
    below_bound.push_str(&" ".repeat(32 * 1_024 - 1 - below_bound.len()));
    document(
        browser.raw_command("task-commands", below_bound).await,
        StatusCode::ACCEPTED,
    )
    .await;

    request_count_deadline_and_cancellation(&browser, task_id, cycle_id).await;
    lost_committed_acknowledgement(&browser, &mut admin).await;

    // Exact Origin and session CSRF are required even for idempotent duplicates.
    for (origin, csrf) in [
        ("https://foreign.example", browser.csrf.as_str()),
        (browser.origin.as_str(), "wrong-session-token"),
    ] {
        let response = browser.client
            .post(format!("{}/engagements/engagement-a/task-controls?organisation_id=org-a&client_id=client-a", browser.address))
            .header("Cookie", format!("__Host-zobba-session={}", browser.token))
            .header("Origin", origin).header("X-CSRF-Token", csrf)
            .header("Content-Type", "application/json").body(pause.to_string()).send().await.unwrap();
        assert_eq!(
            document(response, StatusCode::FORBIDDEN).await["error"],
            "access_denied"
        );
    }
    for path in [
        "/engagements/engagement-a/tasks",
        "/engagements/engagement-a/tasks?organisation_id=foreign&client_id=client-a",
        "/engagements/engagement-a/tasks/guessed?organisation_id=org-a&client_id=client-a",
    ] {
        assert_eq!(browser.read(path).await.status(), StatusCode::FORBIDDEN);
    }
    event_cursor_pages(&browser, &mut admin, task_id, cycle_id).await;
    conversation_http_pages(&browser, &mut admin, task_id).await;
    assert_eq!(browser.read("/engagements/engagement-a/task-events?organisation_id=org-a&client_id=client-a&after=9223372036854775808").await.status(), StatusCode::BAD_REQUEST);

    let admin_token = identities
        .establish_session(ISSUER, "admin", "Casey", None)
        .await
        .unwrap();
    let admin_session = identities.session(&admin_token).await.unwrap();
    let admin_browser = Browser {
        client: browser.client.clone(),
        address: browser.address.clone(),
        origin: browser.origin.clone(),
        token: admin_token,
        csrf: admin_session.csrf_token,
        actor: "identity-admin".into(),
    };
    assert_eq!(
        admin_browser
            .command("task-commands", &create)
            .await
            .status(),
        StatusCode::FORBIDDEN
    );

    config.guard_connection(&mut admin).await;
    admin.execute("UPDATE public.organisation_memberships SET roles=ARRAY['admin'] WHERE actor_id='identity-a'").await.unwrap();
    assert_eq!(
        browser.command("task-commands", &create).await.status(),
        StatusCode::FORBIDDEN,
        "duplicate receipts are freshly reauthorized"
    );
    assert_eq!(browser.read(&path).await.status(), StatusCode::FORBIDDEN);
    for suffix in ["", "/history?through=0", "/events?after=0"] {
        let separator = if suffix.contains('?') { '&' } else { '?' };
        assert_eq!(browser.read(&format!("/engagements/engagement-a/conversation{suffix}{separator}organisation_id=org-a&client_id=client-a")).await.status(),StatusCode::FORBIDDEN,"projection reads reauthorize after a role change");
    }
    stop.send(()).unwrap();
    server.await.unwrap();
}
