//! Actual authenticated HTTP + guarded PostgreSQL + real S3 protocol composition.
use reqwest::{Client, Method, Response, StatusCode};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{Connection, Executor, PgConnection};
use std::{sync::atomic::Ordering, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    time::timeout,
};
use tower::ServiceExt;
use zobba_application::identity::CurrentAuthority;
use zobba_infrastructure::{
    RuntimeDatabase, database_options,
    evidence::s3::{S3EvidenceObjects, storage_namespace},
    identity::IdentityRepository,
    migrate,
};

#[path = "evidence_http/composition.rs"]
mod composition;
#[path = "../../infrastructure/tests/support/s3_protocol.rs"]
mod s3_protocol;
#[path = "../../infrastructure/tests/support/mod.rs"]
mod support;

const ISSUER: &str = "https://synthetic-evidence-http.example";
const SCOPE: &str = "organisation_id=org-a&client_id=client-a";
const PREFIX: &str = "/engagements/engagement-a";

#[derive(Clone)]
struct Browser {
    client: Client,
    address: String,
    origin: String,
    token: String,
    csrf: String,
}
impl Browser {
    fn request(&self, method: Method, path: &str) -> reqwest::RequestBuilder {
        self.client
            .request(method, format!("{}{PREFIX}/{path}?{SCOPE}", self.address))
            .header("Cookie", format!("__Host-zobba-session={}", self.token))
            .header("Origin", &self.origin)
            .header("X-CSRF-Token", &self.csrf)
            .header("X-Expected-Session", &self.csrf)
    }
    async fn reserve(&self, body: &Value) -> Response {
        self.request(Method::POST, "evidence-reservations")
            .header("Content-Type", "application/json")
            .body(body.to_string())
            .send()
            .await
            .unwrap()
    }
    async fn upload(&self, id: &str, bytes: &[u8]) -> Response {
        self.request(Method::PUT, &format!("evidence-reservations/{id}/upload"))
            .body(bytes.to_vec())
            .send()
            .await
            .unwrap()
    }
    async fn read(&self, path: &str) -> Response {
        self.request(Method::GET, path).send().await.unwrap()
    }
    async fn command(&self, path: &str, value: Value) -> Response {
        self.request(Method::POST, path)
            .header("Content-Type", "application/json")
            .body(value.to_string())
            .send()
            .await
            .unwrap()
    }
}
fn claim(key: &str, filename: &str, bytes: &[u8]) -> Value {
    json!({"key":key,"filename":filename,"identity":{"sha256":format!("{:x}", Sha256::digest(bytes)),"size":bytes.len()},"source":{"system":"User export","account":null,"source_version":null,"selection":"Selected original","coverage":null}})
}
async fn document(response: Response, expected: StatusCode) -> Value {
    let status = response.status();
    assert_eq!(response.headers()["cache-control"], "no-store");
    assert_eq!(response.headers()["referrer-policy"], "no-referrer");
    assert_eq!(response.headers()["x-content-type-options"], "nosniff");
    let value: Value = serde_json::from_str(&response.text().await.unwrap()).unwrap();
    assert_eq!(status, expected, "unexpected API result: {value}");
    value
}

async fn fixture(config: &support::Configuration, admin: &mut PgConnection) {
    let mut migration = PgConnection::connect_with(&database_options(&config.migration).unwrap())
        .await
        .unwrap();
    config.guard_connection(&mut migration).await;
    migration.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT USAGE ON SCHEMA public TO PUBLIC; REVOKE CREATE ON SCHEMA public FROM PUBLIC;").await.unwrap();
    migration.close().await.unwrap();
    config.guard_connection(admin).await;
    let role = database_options(&config.runtime)
        .unwrap()
        .get_username()
        .to_owned();
    migrate(&config.migration, &role).await.unwrap();
    let mut tx = admin.begin().await.unwrap();
    sqlx::query("INSERT INTO public.identities(id,issuer,subject,display_name) VALUES('identity-a',$1,'auditor-a','Alex'),('identity-peer',$1,'auditor-peer','Peer'),('identity-admin',$1,'admin','Casey')").bind(ISSUER).execute(&mut *tx).await.unwrap();
    tx.execute("INSERT INTO public.organisations(id,name) VALUES('org-a','Northstar'); INSERT INTO public.clients(organisation_id,id,name) VALUES('org-a','client-a','Alder'),('org-a','client-b','Birch'); INSERT INTO public.engagements(organisation_id,client_id,id,name) VALUES('org-a','client-a','engagement-a','Audit A'),('org-a','client-b','engagement-b','Audit B'); INSERT INTO public.organisation_memberships(organisation_id,actor_id,roles) VALUES('org-a','identity-a',ARRAY['auditor']),('org-a','identity-peer',ARRAY['auditor']),('org-a','identity-admin',ARRAY['admin']); INSERT INTO public.engagement_assignments(organisation_id,client_id,engagement_id,actor_id) VALUES('org-a','client-a','engagement-a','identity-a'),('org-a','client-a','engagement-a','identity-peer');").await.unwrap();
    tx.commit().await.unwrap();
}

async fn head(stream: &mut TcpStream) -> Vec<u8> {
    let mut bytes = Vec::new();
    while !bytes.ends_with(b"\r\n\r\n") {
        bytes.push(stream.read_u8().await.unwrap());
        assert!(bytes.len() < 16384);
    }
    bytes
}
async fn hold_upload(browser: &Browser, id: &str, bytes: &[u8]) -> TcpStream {
    let authority = browser.address.strip_prefix("http://").unwrap();
    let mut stream = TcpStream::connect(authority).await.unwrap();
    let request = format!(
        "PUT {PREFIX}/evidence-reservations/{id}/upload?{SCOPE} HTTP/1.1\r\nHost: {authority}\r\nCookie: __Host-zobba-session={}\r\nOrigin: {}\r\nX-CSRF-Token: {}\r\nX-Expected-Session: {}\r\nContent-Length: {}\r\nExpect: 100-continue\r\nConnection: close\r\n\r\n",
        browser.token,
        browser.origin,
        browser.csrf,
        browser.csrf,
        bytes.len()
    );
    stream.write_all(request.as_bytes()).await.unwrap();
    assert_eq!(
        timeout(Duration::from_secs(2), head(&mut stream))
            .await
            .unwrap(),
        b"HTTP/1.1 100 Continue\r\n\r\n"
    );
    stream.write_all(&bytes[..bytes.len() - 1]).await.unwrap();
    stream
}

async fn lost_ack(browser: &Browser, method: &str, path: &str, bytes: &[u8]) -> Value {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let downstream = listener.local_addr().unwrap();
    let upstream = browser.address.strip_prefix("http://").unwrap().to_owned();
    let proxy = tokio::spawn(async move {
        let (mut client, _) = listener.accept().await.unwrap();
        let headers = head(&mut client).await;
        let length = std::str::from_utf8(&headers)
            .unwrap()
            .lines()
            .find_map(|line| {
                line.to_ascii_lowercase()
                    .strip_prefix("content-length: ")
                    .map(str::to_owned)
            })
            .unwrap()
            .parse::<usize>()
            .unwrap();
        assert!(length < 32768);
        let mut body = vec![0; length];
        client.read_exact(&mut body).await.unwrap();
        let mut server = TcpStream::connect(upstream).await.unwrap();
        server.write_all(&headers).await.unwrap();
        server.write_all(&body).await.unwrap();
        let mut response = Vec::new();
        server.read_to_end(&mut response).await.unwrap();
        let split = response
            .windows(4)
            .position(|part| part == b"\r\n\r\n")
            .unwrap();
        assert!(response.starts_with(b"HTTP/1.1 200 "));
        let committed: Value = serde_json::from_slice(&response[split + 4..]).unwrap();
        drop(client);
        committed
    });
    let result = browser
        .client
        .request(
            Method::from_bytes(method.as_bytes()).unwrap(),
            format!("http://{downstream}{PREFIX}/{path}?{SCOPE}"),
        )
        .header("Cookie", format!("__Host-zobba-session={}", browser.token))
        .header("Origin", &browser.origin)
        .header("X-CSRF-Token", &browser.csrf)
        .header("X-Expected-Session", &browser.csrf)
        .header("Content-Type", "application/json")
        .header("Connection", "close")
        .body(bytes.to_vec())
        .send()
        .await;
    assert!(result.is_err(), "response was lost after actual commit");
    timeout(Duration::from_secs(5), proxy)
        .await
        .unwrap()
        .unwrap()
}

async fn await_pinned_get(fixture: &s3_protocol::Fixture, previous: usize) {
    timeout(Duration::from_secs(3), async {
        while fixture
            .state
            .records()
            .iter()
            .filter(|r| r.method == hyper::Method::GET && r.query.contains("versionId"))
            .count()
            <= previous
        {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("actual pinned object read began");
}
fn pinned_gets(fixture: &s3_protocol::Fixture) -> usize {
    fixture
        .state
        .records()
        .iter()
        .filter(|r| r.method == hyper::Method::GET && r.query.contains("versionId"))
        .count()
}

#[tokio::test]
async fn evidence_http_proves_custody_replay_limits_and_authority_after_io() {
    let config = support::Configuration::from_environment();
    let mut admin = PgConnection::connect_with(&database_options(&config.admin).unwrap())
        .await
        .unwrap();
    fixture(&config, &mut admin).await;
    composition::production_configuration_contract(&config).await;
    // Each child proved real production construction against this guarded
    // fixture; reset its test custody before the independent HTTP scenarios.
    fixture(&config, &mut admin).await;
    let database = RuntimeDatabase::connect(&config.runtime).await.unwrap();
    let identities = IdentityRepository::new(database.pool().clone());
    let token = identities
        .establish_session(ISSUER, "auditor-a", "Alex", None)
        .await
        .unwrap();
    let session = identities.session(&token).await.unwrap();
    let storage = s3_protocol::Fixture::start().await;
    let objects = S3EvidenceObjects::new(
        storage.store(),
        storage_namespace(&storage.endpoint, "fixture-bucket"),
    )
    .unwrap();
    let auth = zobba_api::auth::AuthState::from_environment(&database).unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = format!("http://{}", listener.local_addr().unwrap());
    let app = zobba_api::authenticated_router_with_evidence(database.clone(), auth, Some(objects));
    let composed_app = app.clone();
    let (stop, stopped) = tokio::sync::oneshot::channel::<()>();
    let server = tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(async {
                let _ = stopped.await;
            })
            .await
            .unwrap();
    });
    let mut browser = Browser {
        client: Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(10))
            .build()
            .unwrap(),
        address,
        origin: std::env::var("ZOBBA_PUBLIC_ORIGIN").expect("fixture origin required"),
        token,
        csrf: session.csrf_token,
    };

    let bytes = b"Account,Amount\nAlder,42\n";
    let request = claim("lost-reservation-ack", "original.csv", bytes);
    let reserved = lost_ack(
        &browser,
        "POST",
        "evidence-reservations",
        request.to_string().as_bytes(),
    )
    .await;
    let id = reserved["id"].as_str().unwrap().to_owned();
    assert_eq!(
        document(browser.reserve(&request).await, StatusCode::OK).await,
        reserved
    );
    assert_eq!(reserved["actor_id"], "identity-a");
    assert!(reserved["reserved_at"].is_i64());
    assert_eq!(reserved["request"], request);
    for (method, path, origin, csrf, body) in [
        (
            Method::POST,
            "evidence-reservations".to_owned(),
            browser.origin.clone(),
            "wrong-csrf".to_owned(),
            request.to_string().into_bytes(),
        ),
        (
            Method::PUT,
            format!("evidence-reservations/{id}/upload"),
            "https://foreign.example".to_owned(),
            browser.csrf.clone(),
            bytes.to_vec(),
        ),
    ] {
        let refused = browser
            .request(method, &path)
            .header("Origin", origin)
            .header("X-CSRF-Token", csrf)
            .header("Content-Type", "application/json")
            .body(body)
            .send()
            .await
            .unwrap();
        document(refused, StatusCode::FORBIDDEN).await;
    }
    let mut false_acquisition = request.clone();
    false_acquisition["acquisition_method"] = json!("live_connector");
    document(
        browser.reserve(&false_acquisition).await,
        StatusCode::BAD_REQUEST,
    )
    .await;
    let mut changed = request.clone();
    changed["source"]["coverage"] = json!("Complete");
    document(browser.reserve(&changed).await, StatusCode::CONFLICT).await;
    assert_eq!(
        document(browser.read("evidence").await, StatusCode::OK).await["items"],
        json!([])
    );
    assert_eq!(
        document(browser.read("evidence-reservations").await, StatusCode::OK).await["items"],
        json!([reserved])
    );
    document(
        browser.read(&format!("evidence/{id}")).await,
        StatusCode::FORBIDDEN,
    )
    .await;
    document(
        browser.upload(&id, b"different bytes").await,
        StatusCode::CONFLICT,
    )
    .await;
    assert!(storage.state.objects.lock().unwrap().is_empty());

    storage
        .state
        .drop_next_put_ack
        .store(true, Ordering::SeqCst);
    let evidence = lost_ack(
        &browser,
        "PUT",
        &format!("evidence-reservations/{id}/upload"),
        bytes,
    )
    .await;
    assert_eq!(evidence["reservation"]["id"], id);
    assert!(evidence["version"].is_string());
    assert!(
        evidence["registered_at"].as_i64().unwrap() >= reserved["reserved_at"].as_i64().unwrap()
    );
    assert_eq!(
        document(browser.upload(&id, bytes).await, StatusCode::OK).await,
        evidence
    );
    assert_eq!(
        document(
            browser.read(&format!("evidence/{id}")).await,
            StatusCode::OK
        )
        .await,
        evidence
    );
    assert_eq!(
        document(browser.read("evidence-reservations").await, StatusCode::OK).await["items"],
        json!([])
    );
    assert_eq!(storage.state.objects.lock().unwrap().len(), 1);
    assert!(
        storage
            .state
            .objects
            .lock()
            .unwrap()
            .values()
            .all(|versions| versions.len() == 1)
    );
    let records = storage.state.records();
    assert!(
        records
            .iter()
            .filter(|r| r.method == hyper::Method::PUT)
            .all(|r| r.if_none_match.as_deref() == Some("*"))
    );
    assert!(
        records
            .iter()
            .filter(|r| r.method == hyper::Method::GET && r.path.contains("/evidence/"))
            .all(|r| r.query.contains("versionId"))
    );
    let preview = document(
        browser.read(&format!("evidence/{id}/preview")).await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(
        preview,
        json!({"kind":"plain_text","text":std::str::from_utf8(bytes).unwrap(),"truncated":false})
    );
    let download = browser.read(&format!("evidence/{id}/download")).await;
    assert_eq!(download.status(), StatusCode::OK);
    assert_eq!(
        download.headers()["content-type"],
        "application/octet-stream"
    );
    assert_eq!(
        download.headers()["content-disposition"],
        "attachment; filename=\"original.csv\""
    );
    assert_eq!(download.headers()["cache-control"], "no-store");
    assert_eq!(download.bytes().await.unwrap().as_ref(), bytes);

    // Missing, cross-client and foreign-owner reservation handles disclose the
    // same fixed refusal; registered originals are visible to current peers.
    let peer_token = identities
        .establish_session(ISSUER, "auditor-peer", "Peer", None)
        .await
        .unwrap();
    let peer = Browser {
        token: peer_token.clone(),
        csrf: identities.session(&peer_token).await.unwrap().csrf_token,
        ..browser.clone()
    };
    document(peer.upload(&id, bytes).await, StatusCode::FORBIDDEN).await;
    assert_eq!(
        document(peer.read(&format!("evidence/{id}")).await, StatusCode::OK).await,
        evidence
    );
    let denied = document(
        browser.read("evidence/missing").await,
        StatusCode::FORBIDDEN,
    )
    .await;
    let foreign = browser
        .client
        .get(format!(
            "{}/engagements/engagement-b/evidence/{id}?organisation_id=org-a&client_id=client-b",
            browser.address
        ))
        .header("Cookie", format!("__Host-zobba-session={}", browser.token))
        .send()
        .await
        .unwrap();
    assert_eq!(document(foreign, StatusCode::FORBIDDEN).await, denied);
    let wrong = browser
        .request(Method::GET, "evidence")
        .header("X-Expected-Session", "replaced-session")
        .send()
        .await
        .unwrap();
    document(wrong, StatusCode::PRECONDITION_FAILED).await;

    // The 32 KiB metadata bound supports maximum valid escaped assertions.
    let mut escaped = claim("escaped-source", "escaped.txt", b"text");
    for name in [
        "system",
        "account",
        "source_version",
        "selection",
        "coverage",
    ] {
        escaped["source"][name] = json!("\"".repeat(2000));
    }
    assert!(escaped.to_string().len() > 16 * 1024);
    document(browser.reserve(&escaped).await, StatusCode::OK).await;

    // Two stalled bodies exhaust exactly the shared evidence I/O lane. HTTP
    // 100 Continue proves collection started only after admission.
    let hold_request = claim("held-body", "held.txt", b"pending-body");
    let held = document(browser.reserve(&hold_request).await, StatusCode::OK).await;
    let held_id = held["id"].as_str().unwrap();
    let first = hold_upload(&browser, held_id, b"pending-body").await;
    let second = hold_upload(&browser, held_id, b"pending-body").await;
    for path in [
        format!("evidence/{id}/preview"),
        format!("evidence/{id}/download"),
    ] {
        let response = browser.read(&path).await;
        assert_eq!(response.headers()["retry-after"], "1");
        document(response, StatusCode::TOO_MANY_REQUESTS).await;
    }
    document(
        browser.upload(held_id, b"pending-body").await,
        StatusCode::TOO_MANY_REQUESTS,
    )
    .await;
    document(browser.read("evidence").await, StatusCode::OK).await;
    let task=document(browser.command("task-commands",json!({"key":"evidence-independent-task","kind":"create","content":"Conversation remains responsive"})).await,StatusCode::ACCEPTED).await;
    document(browser.command("task-controls",json!({"key":"evidence-independent-pause","kind":"pause","task_id":task["task_id"],"cycle_id":task["cycle_id"]})).await,StatusCode::ACCEPTED).await;
    document(browser.read("conversation").await, StatusCode::OK).await;
    drop(first);
    drop(second);
    timeout(Duration::from_secs(3), async {
        loop {
            let response = browser.upload(held_id, b"pending-body").await;
            if response.status() != StatusCode::TOO_MANY_REQUESTS {
                document(response, StatusCode::OK).await;
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();

    // Inclusive byte bound and the streaming (no Content-Length) limit.
    let maximum = vec![b'x'; 10 * 1024 * 1024];
    let maximum_reserved = document(
        browser
            .reserve(&claim("maximum", "maximum.txt", &maximum))
            .await,
        StatusCode::OK,
    )
    .await;
    let maximum_id = maximum_reserved["id"].as_str().unwrap();
    document(browser.upload(maximum_id, &maximum).await, StatusCode::OK).await;
    let before = storage.state.records().len();
    document(
        browser
            .upload(maximum_id, &vec![b'x'; maximum.len() + 1])
            .await,
        StatusCode::PAYLOAD_TOO_LARGE,
    )
    .await;
    let stream =
        futures_util::stream::iter([Ok::<_, std::io::Error>(vec![b'x'; maximum.len() + 1])]);
    let response = browser
        .request(
            Method::PUT,
            &format!("evidence-reservations/{maximum_id}/upload"),
        )
        .body(reqwest::Body::wrap_stream(stream))
        .send()
        .await
        .unwrap();
    document(response, StatusCode::PAYLOAD_TOO_LARGE).await;
    assert_eq!(
        storage.state.records().len(),
        before,
        "oversized bytes never reach S3"
    );

    // A corrupt stored read fails before preview/download disclosure.
    storage.state.corrupt_get.store(true, Ordering::SeqCst);
    document(
        browser.read(&format!("evidence/{id}/download")).await,
        StatusCode::SERVICE_UNAVAILABLE,
    )
    .await;
    storage.state.corrupt_get.store(false, Ordering::SeqCst);
    let corrupt_reserved = document(
        browser
            .reserve(&claim("corrupt-upload", "corrupt.txt", b"corruption input"))
            .await,
        StatusCode::OK,
    )
    .await;
    let corrupt_id = corrupt_reserved["id"].as_str().unwrap();
    storage.state.corrupt_get.store(true, Ordering::SeqCst);
    document(
        browser.upload(corrupt_id, b"corruption input").await,
        StatusCode::SERVICE_UNAVAILABLE,
    )
    .await;
    storage.state.corrupt_get.store(false, Ordering::SeqCst);
    document(
        browser.read(&format!("evidence/{corrupt_id}")).await,
        StatusCode::FORBIDDEN,
    )
    .await;
    document(
        browser.upload(corrupt_id, b"corruption input").await,
        StatusCode::OK,
    )
    .await;

    // Exact-session replacement while object I/O is held refuses registration.
    let pending = document(
        browser
            .reserve(&claim(
                "replace-during-upload",
                "pending.txt",
                b"session pending",
            ))
            .await,
        StatusCode::OK,
    )
    .await;
    let pending_id = pending["id"].as_str().unwrap().to_owned();
    storage.state.delay_get_body_ms.store(500, Ordering::SeqCst);
    let count = pinned_gets(&storage);
    let old = browser.clone();
    let held_id = pending_id.clone();
    let upload = tokio::spawn(async move { old.upload(&held_id, b"session pending").await });
    await_pinned_get(&storage, count).await;
    let token = identities
        .establish_session(ISSUER, "auditor-a", "Alex", Some(&browser.token))
        .await
        .unwrap();
    document(upload.await.unwrap(), StatusCode::UNAUTHORIZED).await;
    browser.token = token.clone();
    browser.csrf = identities.session(&token).await.unwrap().csrf_token;
    document(
        browser.read(&format!("evidence/{pending_id}")).await,
        StatusCode::FORBIDDEN,
    )
    .await;
    document(
        browser.upload(&pending_id, b"session pending").await,
        StatusCode::OK,
    )
    .await;

    // An integrity error after revocation must not reveal the old audience's
    // storage state. Reauthorization runs on both successful and failed reads.
    storage.state.corrupt_get.store(true, Ordering::SeqCst);
    storage.state.delay_get_body_ms.store(500, Ordering::SeqCst);
    let count = pinned_gets(&storage);
    let current = browser.clone();
    let held_id = id.clone();
    let failed_read =
        tokio::spawn(async move { current.read(&format!("evidence/{held_id}/download")).await });
    await_pinned_get(&storage, count).await;
    identities.logout(&browser.token).await.unwrap();
    document(failed_read.await.unwrap(), StatusCode::UNAUTHORIZED).await;
    storage.state.corrupt_get.store(false, Ordering::SeqCst);
    let token = identities
        .establish_session(ISSUER, "auditor-a", "Alex", None)
        .await
        .unwrap();
    browser.token = token.clone();
    browser.csrf = identities.session(&token).await.unwrap().csrf_token;

    // Scope revoked after bytes start arriving cannot leak the buffered original.
    storage.state.delay_get_body_ms.store(500, Ordering::SeqCst);
    let count = pinned_gets(&storage);
    let current = browser.clone();
    let held_id = id.clone();
    let download =
        tokio::spawn(async move { current.read(&format!("evidence/{held_id}/download")).await });
    await_pinned_get(&storage, count).await;
    sqlx::query("DELETE FROM public.engagement_assignments WHERE actor_id='identity-a'")
        .execute(&mut admin)
        .await
        .unwrap();
    document(download.await.unwrap(), StatusCode::FORBIDDEN).await;
    document(browser.read("evidence").await, StatusCode::FORBIDDEN).await;

    // Missing configuration preserves scoped metadata; a changed namespace
    // cannot silently retarget a historical original to the new object store.
    let auth = zobba_api::auth::AuthState::from_environment(&database).unwrap();
    let missing =
        zobba_api::authenticated_router_with_evidence(database.clone(), auth.clone(), None);
    let page = composed_read(missing.clone(), &peer, "evidence", StatusCode::OK).await;
    assert_eq!(page["storage_configured"], false);
    assert!(!page["items"].as_array().unwrap().is_empty());
    assert_eq!(
        composed_read(
            missing.clone(),
            &peer,
            &format!("evidence/{id}"),
            StatusCode::OK
        )
        .await,
        evidence
    );
    assert_eq!(
        composed_read(
            missing,
            &peer,
            &format!("evidence/{id}/download"),
            StatusCode::SERVICE_UNAVAILABLE
        )
        .await["error"],
        "evidence_unavailable"
    );
    let other = S3EvidenceObjects::new(
        storage.store(),
        storage_namespace("http://127.0.0.1:1", "fixture-bucket"),
    )
    .unwrap();
    let retargeted =
        zobba_api::authenticated_router_with_evidence(database.clone(), auth, Some(other));
    let before = storage.state.records().len();
    assert_eq!(
        composed_read(
            retargeted,
            &peer,
            &format!("evidence/{id}/download"),
            StatusCode::SERVICE_UNAVAILABLE
        )
        .await["error"],
        "evidence_unavailable"
    );
    assert_eq!(
        storage.state.records().len(),
        before,
        "namespace mismatch is refused before object I/O"
    );

    composition::complete_router_deadlines(composed_app, &peer).await;

    let _ = stop.send(());
    timeout(Duration::from_secs(5), server)
        .await
        .unwrap()
        .unwrap();
    storage.stop().await;
    database.pool().close().await;
}

async fn composed_read(
    app: axum::Router,
    browser: &Browser,
    path: &str,
    expected: StatusCode,
) -> Value {
    let request = axum::http::Request::builder()
        .uri(format!("{PREFIX}/{path}?{SCOPE}"))
        .header("Cookie", format!("__Host-zobba-session={}", browser.token))
        .header("X-Expected-Session", &browser.csrf)
        .body(axum::body::Body::empty())
        .unwrap();
    let response = app.oneshot(request).await.unwrap();
    assert_eq!(response.status().as_u16(), expected.as_u16());
    assert_eq!(response.headers()["cache-control"], "no-store");
    serde_json::from_slice(
        &axum::body::to_bytes(response.into_body(), 64 * 1024)
            .await
            .unwrap(),
    )
    .unwrap()
}
