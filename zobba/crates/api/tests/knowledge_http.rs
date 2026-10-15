//! Real socket HTTP plus guarded PostgreSQL; no knowledge projection is seeded.
use reqwest::{Client, Method, RequestBuilder, Response, StatusCode, header::HeaderValue};
use serde_json::{Value, json};
use sqlx::{Connection, Executor, PgConnection};
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use zobba_application::{identity::CurrentAuthority, task::TaskCommands};
use zobba_infrastructure::{
    RuntimeDatabase, database_options, fixture::seed_local_configured,
    identity::IdentityRepository, migrate,
};

#[path = "../../infrastructure/tests/support/mod.rs"]
mod support;

const PREFERENCE: &str = "/knowledge/organisations/org-a/preference";
const OBSERVATIONS: &str = "/knowledge/organisations/org-a/preference/observations";
const CONTROLS: &str =
    "/engagements/engagement-a/task-controls?organisation_id=org-a&client_id=client-a";
const CREATE: &str =
    "/engagements/engagement-a/task-commands?organisation_id=org-a&client_id=client-a";

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
    fn request(&self, method: Method, route: &str) -> RequestBuilder {
        self.client
            .request(method, format!("{}{route}", self.address))
            .header("Cookie", format!("__Host-zobba-session={}", self.token))
            .header("X-Expected-Session", &self.csrf)
    }
    fn post(&self, route: &str, value: &Value) -> RequestBuilder {
        self.request(Method::POST, route)
            .header("Origin", &self.origin)
            .header("X-CSRF-Token", &self.csrf)
            .header("X-Expected-Actor", &self.actor)
            .header("Content-Type", "application/json")
            .body(value.to_string())
    }
    async fn read(&self, route: &str) -> Response {
        self.request(Method::GET, route).send().await.unwrap()
    }
    async fn command(&self, route: &str, value: &Value) -> Response {
        self.post(route, value).send().await.unwrap()
    }
    async fn sign_in(&self, identities: &IdentityRepository, issuer: &str, subject: &str) -> Self {
        let token = identities
            .establish_verified_session(issuer, subject, subject, None, None)
            .await
            .unwrap();
        let current = identities.session(&token).await.unwrap();
        Self {
            token,
            csrf: current.csrf_token,
            actor: current.identity.id,
            ..self.clone()
        }
    }
}
async fn document(response: Response, expected: StatusCode) -> Value {
    let path = response.url().path().to_owned();
    assert_eq!(response.headers()["cache-control"], "no-store");
    assert_eq!(response.headers()["content-type"], "application/json");
    assert_eq!(response.headers()["x-content-type-options"], "nosniff");
    assert!(!response.headers().contains_key("set-cookie"));
    let status = response.status();
    let body = response.text().await.unwrap();
    assert!(
        body.len() <= 4 * 1024 * 1024,
        "ordinary knowledge reads keep the existing browser cap"
    );
    assert_eq!(status, expected, "{path}: {body}");
    serde_json::from_str(&body).unwrap()
}
async fn refused(response: Response, expected: StatusCode, code: &str) {
    assert_eq!(document(response, expected).await, json!({"error":code}));
}
fn route(task: &Value, suffix: &str) -> String {
    format!(
        "/engagements/engagement-a/tasks/{}/knowledge{suffix}?organisation_id=org-a&client_id=client-a",
        task["task_id"].as_str().unwrap()
    )
}
fn exact(task: &Value, record: &Value) -> String {
    route(
        task,
        &format!(
            "/records/{}/revisions/{}",
            record["id"].as_str().unwrap(),
            record["revision"].as_str().unwrap()
        ),
    )
}
fn assertion(key: &str, revision: &Value, text: &str) -> Value {
    json!({"key":key,"expected_revision":revision,"action":{"kind":"assert","assertion":{"text":text,"period":{"start":null,"end":null},"uncertainty":"An attributed assertion; independently unverified","dependencies":[]}}})
}
async fn create(browser: &Browser, key: &str) -> Value {
    document(browser.command(CREATE, &json!({"key":key,"kind":"create","task_id":null,"cycle_id":null,"content":"Inspect attributable working knowledge"})).await, StatusCode::ACCEPTED).await
}
async fn fixture(config: &support::Configuration, connection: &mut PgConnection, issuer: &str) {
    let mut migration = PgConnection::connect_with(&database_options(&config.migration).unwrap())
        .await
        .unwrap();
    config.guard_connection(&mut migration).await;
    migration.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public; REVOKE CREATE ON SCHEMA public FROM PUBLIC").await.unwrap();
    migration.close().await.unwrap();
    migrate(
        &config.migration,
        database_options(&config.runtime).unwrap().get_username(),
    )
    .await
    .unwrap();
    seed_local_configured(issuer, &config.migration)
        .await
        .unwrap();
    config.guard_connection(connection).await;
    connection.execute("INSERT INTO public.engagements(organisation_id,client_id,id,name) VALUES('org-a','client-a','engagement-later','Later same-client work');
        INSERT INTO public.engagement_assignments(organisation_id,client_id,engagement_id,actor_id) VALUES('org-a','client-a','engagement-later','actor-a'),('org-a','client-a','engagement-later','actor-manager')").await.unwrap();
}
async fn mutation_fences(browser: &Browser, route: &str, body: &Value) {
    for name in ["origin", "x-csrf-token", "x-expected-actor"] {
        let mut request = browser.post(route, body).build().unwrap();
        request.headers_mut().remove(name);
        refused(
            browser.client.execute(request).await.unwrap(),
            StatusCode::FORBIDDEN,
            "access_denied",
        )
        .await;
        let mut request = browser.post(route, body).build().unwrap();
        let value = request.headers()[name].clone();
        request.headers_mut().append(name, value);
        refused(
            browser.client.execute(request).await.unwrap(),
            StatusCode::FORBIDDEN,
            "access_denied",
        )
        .await;
    }
    for (name, value) in [
        ("origin", "https://foreign.invalid"),
        ("x-csrf-token", "obsolete"),
        ("x-expected-actor", "actor-b"),
    ] {
        let mut request = browser.post(route, body).build().unwrap();
        request
            .headers_mut()
            .insert(name, HeaderValue::from_static(value));
        refused(
            browser.client.execute(request).await.unwrap(),
            StatusCode::FORBIDDEN,
            "access_denied",
        )
        .await;
    }
    let mut stale = browser.post(route, body).build().unwrap();
    stale
        .headers_mut()
        .insert("x-expected-session", HeaderValue::from_static("obsolete"));
    refused(
        browser.client.execute(stale).await.unwrap(),
        StatusCode::PRECONDITION_FAILED,
        "session_changed",
    )
    .await;
}
async fn read_fences(browser: &Browser, route: &str) {
    for duplicate in [false, true] {
        let mut request = browser.request(Method::GET, route).build().unwrap();
        if duplicate {
            request.headers_mut().append(
                "x-expected-session",
                HeaderValue::from_str(&browser.csrf).unwrap(),
            );
        } else {
            request
                .headers_mut()
                .insert("x-expected-session", HeaderValue::from_static("obsolete"));
        }
        refused(
            browser.client.execute(request).await.unwrap(),
            StatusCode::PRECONDITION_FAILED,
            "session_changed",
        )
        .await;
    }
    let mut unbound = browser.request(Method::GET, route).build().unwrap();
    unbound.headers_mut().remove("x-expected-session");
    document(
        browser.client.execute(unbound).await.unwrap(),
        StatusCode::OK,
    )
    .await;
    let mut request = browser.request(Method::GET, route).build().unwrap();
    request.headers_mut().remove("cookie");
    refused(
        browser.client.execute(request).await.unwrap(),
        StatusCode::UNAUTHORIZED,
        "authentication_required",
    )
    .await;
}

/// Consume a committed HTTP response and discard its acknowledgement. A retry
/// traverses authentication, authorisation and the actual durable receipt path.
async fn lose_acknowledgement(browser: &Browser, route: &str, body: &Value) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = format!("http://{}", listener.local_addr().unwrap());
    let upstream = browser.address.strip_prefix("http://").unwrap().to_owned();
    let relay = tokio::spawn(async move {
        let (mut downstream, _) = listener.accept().await.unwrap();
        let mut request = Vec::new();
        while !request.ends_with(b"\r\n\r\n") {
            request.push(downstream.read_u8().await.unwrap());
            assert!(request.len() < 16_384);
        }
        let header = std::str::from_utf8(&request).unwrap();
        let length: usize = header
            .lines()
            .find_map(|line| {
                line.to_ascii_lowercase()
                    .strip_prefix("content-length:")
                    .map(|n| n.trim().parse().unwrap())
            })
            .unwrap();
        assert!(length < 256 * 1024);
        let mut body = vec![0; length];
        downstream.read_exact(&mut body).await.unwrap();
        let mut backend = tokio::net::TcpStream::connect(upstream).await.unwrap();
        backend.write_all(&request).await.unwrap();
        backend.write_all(&body).await.unwrap();
        let mut response = Vec::new();
        while !response.ends_with(b"\r\n\r\n") {
            response.push(backend.read_u8().await.unwrap());
            assert!(response.len() < 16_384);
        }
        let header = std::str::from_utf8(&response).unwrap();
        assert!(header.starts_with("HTTP/1.1 200"), "{header}");
        let length: usize = header
            .lines()
            .find_map(|line| {
                line.to_ascii_lowercase()
                    .strip_prefix("content-length:")
                    .map(|n| n.trim().parse().unwrap())
            })
            .unwrap();
        assert!(length < 4 * 1024 * 1024);
        let mut body = vec![0; length];
        backend.read_exact(&mut body).await.unwrap();
        assert!(serde_json::from_slice::<Value>(&body).unwrap()["event_id"].is_string());
        downstream.shutdown().await.unwrap();
    });
    let interrupted = Browser {
        address,
        ..browser.clone()
    };
    assert!(interrupted.post(route, body).send().await.is_err());
    relay.await.unwrap();
}

struct DelayedObservation {
    release: std::sync::Arc<tokio::sync::Notify>,
    pending: tokio::task::JoinHandle<Response>,
    stop: tokio::sync::oneshot::Sender<()>,
    server: tokio::task::JoinHandle<()>,
}
impl DelayedObservation {
    async fn start(owner: &Browser, body: &Value) -> Self {
        let entered = std::sync::Arc::new(tokio::sync::Notify::new());
        let release = std::sync::Arc::new(tokio::sync::Notify::new());
        let receive = entered.clone();
        let forward = release.clone();
        let upstream = owner.clone();
        let app = axum::Router::new().route(
            "/hold",
            axum::routing::post(move |axum::Json(body): axum::Json<Value>| {
                let receive = receive.clone();
                let forward = forward.clone();
                let upstream = upstream.clone();
                async move {
                    receive.notify_one();
                    forward.notified().await;
                    let response = upstream.command(OBSERVATIONS, &body).await;
                    let status = response.status();
                    let headers = response.headers().clone();
                    let bytes = response.bytes().await.unwrap();
                    let mut response = axum::http::Response::new(axum::body::Body::from(bytes));
                    *response.status_mut() = status;
                    *response.headers_mut() = headers;
                    response
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = format!("http://{}", listener.local_addr().unwrap());
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
            address,
            ..owner.clone()
        };
        let body = body.clone();
        let pending = tokio::spawn(async move { browser.command("/hold", &body).await });
        tokio::time::timeout(Duration::from_secs(3), entered.notified())
            .await
            .expect("actual emitted HTTP observation reaches the network delay before Undo");
        Self {
            release,
            pending,
            stop,
            server,
        }
    }
    async fn release(self) -> Response {
        self.release.notify_one();
        let response = self.pending.await.unwrap();
        self.stop.send(()).unwrap();
        self.server.await.unwrap();
        response
    }
}

#[tokio::test]
async fn knowledge_http_producers_mutations_exact_recovery_and_authority_contract() {
    let config = support::Configuration::from_environment();
    let issuer = std::env::var("ZOBBA_OIDC_ISSUER").expect("load fixture OIDC configuration");
    let origin = std::env::var("ZOBBA_PUBLIC_ORIGIN").expect("load fixture public origin");
    let mut connection = PgConnection::connect_with(&database_options(&config.admin).unwrap())
        .await
        .unwrap();
    fixture(&config, &mut connection, &issuer).await;
    let database = RuntimeDatabase::connect(&config.runtime).await.unwrap();
    let identities = IdentityRepository::new(database.pool().clone());
    let auth = zobba_api::auth::AuthState::from_environment(&database).unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = format!("http://{}", listener.local_addr().unwrap());
    let app = zobba_api::authenticated_router_with_evidence(database.clone(), auth, None);
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
            .no_proxy()
            .timeout(Duration::from_secs(10))
            .build()
            .unwrap(),
        address,
        origin,
        token: String::new(),
        csrf: String::new(),
        actor: String::new(),
    };
    let auditor = browser.sign_in(&identities, &issuer, "auditor-a").await;
    let manager = browser.sign_in(&identities, &issuer, "manager-a").await;
    let admin = browser.sign_in(&identities, &issuer, "admin-only").await;
    let foreign = browser.sign_in(&identities, &issuer, "auditor-b").await;
    let task = create(&auditor, "http-knowledge-task").await;
    let scoped = route(&task, "");
    let commands = route(&task, "/commands");
    read_fences(&auditor, &scoped).await;
    read_fences(&auditor, PREFERENCE).await;
    for outsider in [&admin, &foreign] {
        refused(
            outsider.read(&scoped).await,
            StatusCode::FORBIDDEN,
            "access_denied",
        )
        .await;
    }
    let initial = document(auditor.read(&scoped).await, StatusCode::OK).await;
    assert_eq!(initial["task_id"], task["task_id"]);
    assert!(initial["revision"].is_string() && initial["execution_epoch"].is_string());
    assert!(initial["methodology_binding_id"].is_string());
    let draft = assertion(
        "http-assertion",
        &initial["revision"],
        "\u{feff}Attributable knowledge\r\nPreserve café, e\u{301} and 🧾.",
    );
    mutation_fences(&auditor, &commands, &draft).await;
    let receipt = document(auditor.command(&commands, &draft).await, StatusCode::OK).await;
    let _: zobba_api::knowledge::KnowledgeReceipt = serde_json::from_value(receipt.clone())
        .expect("actual HTTP receipt agrees with the declared public response schema");
    let record = &receipt["record"]["record"];
    assert_eq!(record["text"], draft["action"]["assertion"]["text"]);
    assert_eq!(record["actor_id"], "actor-a");
    assert_eq!(record["certainty"], "asserted");
    assert_eq!(record["scope"]["engagement_id"], "engagement-a");
    let record_route = exact(&task, record);
    let verification_route = route(&task, "/verify");
    let verification = json!({"query":{"after":null,"text":null,"include_inactive":false},"expected_execution_epoch":initial["execution_epoch"],"expected_methodology_binding_id":initial["methodology_binding_id"],"items":[{"id":record["id"],"revision":record["revision"],"status":"current"}],"exact":false});
    mutation_fences(&auditor, &verification_route, &verification).await;
    assert_eq!(
        document(
            auditor.command(&verification_route, &verification).await,
            StatusCode::OK
        )
        .await,
        json!({"verified":true})
    );
    read_fences(&auditor, &record_route).await;
    assert_eq!(
        document(auditor.read(&record_route).await, StatusCode::OK).await["record"],
        *record
    );
    assert_eq!(
        document(auditor.command(&commands, &draft).await, StatusCode::OK).await,
        receipt
    );
    let mut altered = draft.clone();
    altered["action"]["assertion"]["text"] = json!("A changed meaning under the same key");
    refused(
        auditor.command(&commands, &altered).await,
        StatusCode::CONFLICT,
        "knowledge_conflict",
    )
    .await;
    for malformed in [
        json!("01"),
        json!(1),
        json!("18446744073709551616"),
        json!("-1"),
    ] {
        let mut bad = draft.clone();
        bad["key"] = json!("invalid-revision");
        bad["expected_revision"] = malformed;
        refused(
            auditor.command(&commands, &bad).await,
            StatusCode::BAD_REQUEST,
            "invalid_knowledge",
        )
        .await;
    }
    let mut unknown = draft.clone();
    unknown["private_text"] = json!("No generic private text release is accepted");
    refused(
        auditor.command(&commands, &unknown).await,
        StatusCode::BAD_REQUEST,
        "invalid_knowledge",
    )
    .await;
    let current = document(auditor.read(&scoped).await, StatusCode::OK).await;
    let lost = assertion(
        "lost-http-ack",
        &current["revision"],
        "A committed assertion survives a lost HTTP acknowledgement",
    );
    lose_acknowledgement(&auditor, &commands, &lost).await;
    let recovered = document(auditor.command(&commands, &lost).await, StatusCode::OK).await;
    assert_eq!(
        document(auditor.command(&commands, &lost).await, StatusCode::OK).await,
        recovered
    );
    let persisted: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM public.knowledge_events WHERE key='lost-http-ack'",
    )
    .fetch_one(&mut connection)
    .await
    .unwrap();
    assert_eq!(persisted, 1);

    let guide = json!({"key":"http-guide","kind":"guide","task_id":task["task_id"],"cycle_id":task["cycle_id"],"content":"Original Task-local instruction remains attributable"});
    let direction_receipt = document(
        auditor.command(CONTROLS, &guide).await,
        StatusCode::ACCEPTED,
    )
    .await;
    let after_guide = document(auditor.read(&scoped).await, StatusCode::OK).await;
    let direction = after_guide["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["record"]["direction"]["command_id"] == direction_receipt["command_id"])
        .expect("accepted HTTP Guide automatically produces attributed direction");
    assert_eq!(
        direction["record"]["direction"]["cycle_id"],
        task["cycle_id"]
    );
    assert_eq!(direction["record"]["certainty"], "user_directed");
    assert!(
        !direction["can_correct"].as_bool().unwrap(),
        "live direction stays with Task Guide admission"
    );
    assert_eq!(
        document(
            auditor.command(CONTROLS, &guide).await,
            StatusCode::ACCEPTED
        )
        .await,
        direction_receipt
    );
    let correction = json!({"key":"http-correct","expected_revision":after_guide["revision"],"action":{"kind":"correct","target":{"id":record["id"],"revision":record["revision"]},"reason":"Clarify an unsupported interpretation","assertion":{"text":"Corrected interpretation","period":{"start":null,"end":null},"uncertainty":null,"dependencies":[]}}});
    let corrected = document(
        auditor.command(&commands, &correction).await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(
        corrected["record"]["record"]["supersedes"]["id"],
        record["id"]
    );
    let original = document(auditor.read(&record_route).await, StatusCode::OK).await;
    assert_eq!(original["record"], *record);
    assert_eq!(original["status"], "corrected");
    refused(
        auditor.command(&verification_route, &verification).await,
        StatusCode::CONFLICT,
        "knowledge_conflict",
    )
    .await;
    let mut historical_verification = verification.clone();
    historical_verification["exact"] = json!(true);
    historical_verification["items"][0]["status"] = json!("corrected");
    assert_eq!(
        document(
            auditor
                .command(&verification_route, &historical_verification)
                .await,
            StatusCode::OK
        )
        .await,
        json!({"verified":true})
    );

    let later = document(auditor.command(&CREATE.replace("engagement-a", "engagement-later"), &json!({"key":"http-later-reuse-task","kind":"create","task_id":null,"cycle_id":null,"content":"Reuse only expressly selected same-client context"})).await, StatusCode::ACCEPTED).await;
    let later_route = route(&later, "").replace("engagement-a", "engagement-later");
    let reusable = &corrected["record"]["record"];
    assert!(
        !document(auditor.read(&later_route).await, StatusCode::OK).await["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["record"]["id"] == reusable["id"])
    );
    let reuse = json!({"key":"http-named-reuse","expected_revision":corrected["revision"],"action":{"kind":"reuse","target":{"id":reusable["id"],"revision":reusable["revision"]},"destination_engagement_id":"engagement-later","destination_task_id":later["task_id"],"reason":"Use the exact source in this named later Task"}});
    document(auditor.command(&commands, &reuse).await, StatusCode::OK).await;
    let later_view = document(manager.read(&later_route).await, StatusCode::OK).await;
    let reused = later_view["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["record"]["id"] == reusable["id"])
        .expect("actual later Task retrieves the exact authorised same-client source");
    assert_eq!(reused["record"], *reusable);
    assert_eq!(reused["record"]["scope"]["engagement_id"], "engagement-a");
    assert_eq!(reused["can_correct"], false);
    assert_eq!(reused["can_reuse"], false);
    assert_eq!(reused["can_exclude"], true);
    assert_eq!(reused["can_forget"], true);
    let later_exact = exact(&later, reusable).replace("engagement-a", "engagement-later");
    assert_eq!(
        document(manager.read(&later_exact).await, StatusCode::OK).await["record"],
        *reusable
    );
    let verify_reuse = route(&later, "/verify").replace("engagement-a", "engagement-later");
    let reuse_basis = json!({"query":{"after":null,"text":null,"include_inactive":false},"expected_execution_epoch":later_view["execution_epoch"],"expected_methodology_binding_id":later_view["methodology_binding_id"],"items":[{"id":reusable["id"],"revision":reusable["revision"],"status":"current"}],"exact":false});
    assert_eq!(
        document(
            manager.command(&verify_reuse, &reuse_basis).await,
            StatusCode::OK
        )
        .await,
        json!({"verified":true})
    );
    connection.execute("UPDATE public.engagement_assignments SET active=false WHERE actor_id='actor-a' AND engagement_id='engagement-a'").await.unwrap();
    refused(
        manager.command(&verify_reuse, &reuse_basis).await,
        StatusCode::FORBIDDEN,
        "access_denied",
    )
    .await;
    connection.execute("UPDATE public.engagement_assignments SET active=true WHERE actor_id='actor-a' AND engagement_id='engagement-a'").await.unwrap();

    http_foreign_origin_controls(
        &auditor,
        &manager,
        &task,
        &later,
        reusable,
        &recovered["record"]["record"],
    )
    .await;

    http_preference_release_and_undo(&auditor, &manager).await;
    http_verification_basis_and_applied_guide(&auditor, &database).await;
    let excerpt =
        "/engagements/engagement-a/knowledge/excerpts?organisation_id=org-a&client_id=client-a";
    let invalid_range =
        json!({"key":"invalid-excerpt","evidence_id":"original-id","byte_start":4,"byte_end":3});
    mutation_fences(&auditor, excerpt, &invalid_range).await;
    refused(
        auditor.command(excerpt, &invalid_range).await,
        StatusCode::BAD_REQUEST,
        "invalid_knowledge",
    )
    .await;

    // A known session at the HTTP boundary can become invalid while waiting.
    let waiting = auditor.sign_in(&identities, &issuer, "auditor-a").await;
    let token = waiting.token.clone();
    let mut barrier = PgConnection::connect(&config.admin).await.unwrap();
    config.guard_connection(&mut barrier).await;
    barrier
        .execute("BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('org-a',205))")
        .await
        .unwrap();
    let selected_route = scoped.clone();
    let pending = tokio::spawn(async move { waiting.read(&selected_route).await });
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        let blocked: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory')").fetch_one(&mut connection).await.unwrap();
        if blocked {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "HTTP knowledge request did not reach actual organisation fence"
        );
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    identities.logout(&token).await.unwrap();
    barrier.execute("COMMIT").await.unwrap();
    refused(
        pending.await.unwrap(),
        StatusCode::FORBIDDEN,
        "access_denied",
    )
    .await;
    let foreign_scope = scoped.replace("client_id=client-a", "client_id=client-b");
    refused(
        auditor.read(&foreign_scope).await,
        StatusCode::FORBIDDEN,
        "access_denied",
    )
    .await;
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM public.operations")
        .fetch_one(&mut connection)
        .await
        .unwrap();
    assert_eq!(
        count, 0,
        "knowledge capture, correction and reuse never create operations"
    );
    stop.send(()).unwrap();
    server.await.unwrap();
    database.pool().close().await;
}

async fn http_foreign_origin_controls(
    owner: &Browser,
    viewer: &Browser,
    source_task: &Value,
    destination_task: &Value,
    reused: &Value,
    second_source: &Value,
) {
    let destination_page = route(destination_task, "").replace("engagement-a", "engagement-later");
    let destination_commands =
        route(destination_task, "/commands").replace("engagement-a", "engagement-later");
    let current = document(viewer.read(&destination_page).await, StatusCode::OK).await;
    let foreign_correct = json!({"key":"http-foreign-correct-refused","expected_revision":current["revision"],
        "action":{"kind":"correct","target":{"id":reused["id"],"revision":reused["revision"]},"reason":"A destination route cannot correct the immutable origin",
        "assertion":{"text":"A locally invented replacement","period":{"start":null,"end":null},"uncertainty":null,"dependencies":[]}}});
    refused(
        viewer
            .command(&destination_commands, &foreign_correct)
            .await,
        StatusCode::CONFLICT,
        "knowledge_ineligible",
    )
    .await;
    let foreign_reuse = json!({"key":"http-foreign-reuse-refused","expected_revision":current["revision"],
        "action":{"kind":"reuse","target":{"id":reused["id"],"revision":reused["revision"]},"reason":"A destination route cannot republish the origin",
        "destination_engagement_id":"engagement-a","destination_task_id":source_task["task_id"]}});
    refused(
        viewer.command(&destination_commands, &foreign_reuse).await,
        StatusCode::FORBIDDEN,
        "access_denied",
    )
    .await;
    for (label, record) in [("exclude", reused), ("forget", second_source)] {
        if label == "forget" {
            let source = document(owner.read(&route(source_task, "")).await, StatusCode::OK).await;
            let grant = json!({"key":"http-second-origin-reuse","expected_revision":source["revision"],
                "action":{"kind":"reuse","target":{"id":record["id"],"revision":record["revision"]},"reason":"Permit exactly the second destination restriction proof",
                "destination_engagement_id":"engagement-later","destination_task_id":destination_task["task_id"]}});
            document(
                owner
                    .command(&route(source_task, "/commands"), &grant)
                    .await,
                StatusCode::OK,
            )
            .await;
        }
        let exact_destination =
            exact(destination_task, record).replace("engagement-a", "engagement-later");
        let actionable = document(viewer.read(&exact_destination).await, StatusCode::OK).await;
        assert_eq!(actionable["can_correct"], false);
        assert_eq!(actionable["can_reuse"], false);
        assert_eq!(actionable["can_exclude"], true);
        assert_eq!(actionable["can_forget"], true);
        let basis = document(viewer.read(&destination_page).await, StatusCode::OK).await;
        let restriction = json!({"key":format!("http-destination-{label}"),"expected_revision":basis["revision"],
            "action":{"kind":label,"target":{"id":record["id"],"revision":record["revision"]},"reason":"Withdraw this exact record only from the named destination Task"}});
        let result = document(
            viewer.command(&destination_commands, &restriction).await,
            StatusCode::OK,
        )
        .await;
        assert_eq!(
            result["record"]["status"],
            if label == "exclude" {
                "excluded"
            } else {
                "forgotten"
            }
        );
        assert_eq!(result["record"]["record"], *record);
        let origin = document(
            owner.read(&exact(source_task, record)).await,
            StatusCode::OK,
        )
        .await;
        assert_eq!(origin["record"], *record);
        assert_eq!(
            origin["status"], "current",
            "destination restrictions preserve the original eligible record"
        );
    }
}

async fn http_verification_basis_and_applied_guide(browser: &Browser, database: &RuntimeDatabase) {
    let task = create(browser, "http-independent-verification-basis").await;
    let scoped = route(&task, "");
    let commands = route(&task, "/commands");
    let verify_route = route(&task, "/verify");
    let before = document(browser.read(&scoped).await, StatusCode::OK).await;
    let received = document(
        browser
            .command(
                &commands,
                &assertion(
                    "http-stable-basis-record",
                    &before["revision"],
                    "This exact record remains unchanged while its Task basis advances",
                ),
            )
            .await,
        StatusCode::OK,
    )
    .await;
    let record = received["record"]["record"].clone();
    let original = document(browser.read(&exact(&task, &record)).await, StatusCode::OK).await;
    let initial = document(browser.read(&scoped).await, StatusCode::OK).await;
    let verification = |basis: &Value| {
        json!({
            "query":{"after":null,"text":null,"include_inactive":false},
            "expected_execution_epoch":basis["execution_epoch"],
            "expected_methodology_binding_id":basis["methodology_binding_id"],
            "items":[{"id":record["id"],"revision":record["revision"],"status":"current"}],
            "exact":false
        })
    };
    document(
        browser
            .command(&verify_route, &verification(&initial))
            .await,
        StatusCode::OK,
    )
    .await;
    let pause = json!({"key":"http-basis-pause","kind":"pause","task_id":task["task_id"],"cycle_id":task["cycle_id"],"content":null});
    document(
        browser.command(CONTROLS, &pause).await,
        StatusCode::ACCEPTED,
    )
    .await;
    let paused = document(browser.read(&scoped).await, StatusCode::OK).await;
    assert_ne!(paused["execution_epoch"], initial["execution_epoch"]);
    assert_eq!(
        paused["methodology_binding_id"],
        initial["methodology_binding_id"]
    );
    let mut old_epoch = verification(&paused);
    old_epoch["expected_execution_epoch"] = initial["execution_epoch"].clone();
    refused(
        browser.command(&verify_route, &old_epoch).await,
        StatusCode::CONFLICT,
        "knowledge_conflict",
    )
    .await;
    document(
        browser.command(&verify_route, &verification(&paused)).await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(
        document(browser.read(&exact(&task, &record)).await, StatusCode::OK).await,
        original,
        "the epoch-only refusal occurs with unchanged record revision, standing and source authority"
    );

    let guide = json!({"key":"http-basis-context-guide","kind":"guide","task_id":task["task_id"],"cycle_id":task["cycle_id"],
        "content":"Apply this exact instruction through its owning Task coordinator",
        "context":{"audit_area":"inventory","period_start":null,"period_end":null}});
    let guide_receipt = document(
        browser.command(CONTROLS, &guide).await,
        StatusCode::ACCEPTED,
    )
    .await;
    let pending = document(browser.read(&scoped).await, StatusCode::OK).await;
    let received_direction = pending["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["record"]["direction"]["command_id"] == guide_receipt["command_id"])
        .expect("the accepted Guide is inspectable before the owning work boundary")
        .clone();
    assert!(
        received_direction["record"]["direction"]["standing"]
            .as_str()
            .unwrap()
            .starts_with("Received")
    );
    assert_eq!(
        pending["methodology_binding_id"], paused["methodology_binding_id"],
        "accepted context remains pending until the actual owner applies it"
    );
    let scope = zobba_domain::identity::Scope {
        organisation_id: "org-a".into(),
        client_id: "client-a".into(),
        engagement_id: "engagement-a".into(),
    };
    let task_id = task["task_id"].as_str().unwrap().to_owned();
    let owner = zobba_infrastructure::task::TaskRepository::new(database.pool().clone())
        .with_session_hash(zobba_infrastructure::identity::secret_hash(&browser.token));
    let wakeup = zobba_domain::task::WakeupRoute {
        id: task_id.clone(),
        actor_id: browser.actor.clone(),
        scope: scope.clone(),
        task_id: task_id.clone(),
    };
    assert_eq!(
        owner
            .coordinate(&wakeup, "knowledge-basis-owner")
            .await
            .unwrap(),
        zobba_domain::task::Decision::Idle,
        "a paused Task applies retained intent and context without consuming or dispatching work"
    );
    let applied = document(browser.read(&scoped).await, StatusCode::OK).await;
    assert_ne!(
        applied["methodology_binding_id"],
        paused["methodology_binding_id"]
    );
    let mut old_binding = verification(&applied);
    old_binding["expected_methodology_binding_id"] = paused["methodology_binding_id"].clone();
    refused(
        browser.command(&verify_route, &old_binding).await,
        StatusCode::CONFLICT,
        "knowledge_conflict",
    )
    .await;
    assert_eq!(
        document(
            browser
                .command(&verify_route, &verification(&applied))
                .await,
            StatusCode::OK
        )
        .await,
        json!({"verified":true})
    );
    assert_eq!(
        document(browser.read(&exact(&task, &record)).await, StatusCode::OK).await,
        original,
        "the binding-only refusal also uses unchanged record revision, standing and source authority"
    );
    let applied_direction = document(
        browser
            .read(&exact(&task, &received_direction["record"]))
            .await,
        StatusCode::OK,
    )
    .await;
    assert!(
        applied_direction["record"]["direction"]["standing"]
            .as_str()
            .unwrap()
            .starts_with("Applied")
    );
    for field in [
        "id",
        "revision",
        "actor_id",
        "scope",
        "text",
        "certainty",
        "period",
        "dependencies",
    ] {
        assert_eq!(
            applied_direction["record"][field],
            received_direction["record"][field]
        );
    }
    for field in ["command_id", "task_id", "cycle_id"] {
        assert_eq!(
            applied_direction["record"]["direction"][field],
            received_direction["record"]["direction"][field]
        );
    }
    assert_eq!(
        document(
            browser.command(CONTROLS, &guide).await,
            StatusCode::ACCEPTED
        )
        .await,
        guide_receipt
    );
    let events = owner.events(&browser.actor, &scope, 0).await.unwrap();
    assert_eq!(
        events
            .iter()
            .filter(|event| event.kind == "applied"
                && event.command_id.as_deref() == guide_receipt["command_id"].as_str())
            .count(),
        1,
        "Applied standing follows the real owner's single immutable application event"
    );
}

async fn http_preference_release_and_undo(owner: &Browser, recipient: &Browser) {
    let initial = document(owner.read(PREFERENCE).await, StatusCode::OK).await;
    let first = json!({"key":"http-expand-one","expected_revision":initial["revision"],"opening_id":"http-opening-one","value":"expanded"});
    mutation_fences(owner, OBSERVATIONS, &first).await;
    assert!(
        document(owner.command(OBSERVATIONS, &first).await, StatusCode::OK).await["current"]
            .is_null()
    );
    let before_second = document(owner.read(PREFERENCE).await, StatusCode::OK).await;
    let second = json!({"key":"http-expand-two","expected_revision":before_second["revision"],"opening_id":"http-opening-two","value":"expanded"});
    let learned = document(owner.command(OBSERVATIONS, &second).await, StatusCode::OK).await;
    assert_eq!(learned["current"]["can_forget"], false);
    assert_eq!(learned["current"]["can_undo"], true);
    let record = &learned["current"]["record"];
    assert_eq!(record["preference"]["inferred"], true);
    assert_eq!(record["preference"]["name"], "task_inspection_layout");
    assert_eq!(
        record["preference"]["observation_ids"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert!(document(recipient.read(PREFERENCE).await, StatusCode::OK).await["current"].is_null());
    let owner_task = create(owner, "http-private-preference-owner-task").await;
    let owner_page = document(owner.read(&route(&owner_task, "")).await, StatusCode::OK).await;
    let personal = owner_page["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["record"]["id"] == record["id"])
        .unwrap();
    assert_eq!(personal["can_forget"], false);
    assert_eq!(personal["can_undo"], true);
    let wrong_route = json!({"key":"http-private-preference-task-forget","expected_revision":owner_page["revision"],
        "action":{"kind":"forget","target":{"id":record["id"],"revision":record["revision"]},"reason":"Personal preferences use their real owner-private Undo route"}});
    refused(
        owner
            .command(&route(&owner_task, "/commands"), &wrong_route)
            .await,
        StatusCode::CONFLICT,
        "knowledge_ineligible",
    )
    .await;
    let publish = json!({"key":"http-publish-layout","expected_revision":learned["revision"],"action":{"kind":"publish","target":{"id":record["id"],"revision":record["revision"]},"client_id":"client-a","engagement_id":"engagement-later"}});
    mutation_fences(owner, PREFERENCE, &publish).await;
    document(owner.command(PREFERENCE, &publish).await, StatusCode::OK).await;
    let later = document(recipient.command(&CREATE.replace("engagement-a", "engagement-later"), &json!({"key":"http-recipient-task","kind":"create","task_id":null,"cycle_id":null,"content":"Read the expressly published layout preference"})).await, StatusCode::ACCEPTED).await;
    let destination = route(&later, "").replace("engagement-a", "engagement-later");
    let result = document(recipient.read(&destination).await, StatusCode::OK).await;
    let released = result["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["record"]["kind"] == "published_preference")
        .expect("recipient sees the allowlisted value release");
    assert_eq!(released["record"]["preference"]["value"], "expanded");
    assert_eq!(
        released["record"]["preference"]["observation_ids"],
        json!([])
    );
    assert!(
        !result.to_string().contains("http-opening"),
        "private click events remain private"
    );
    let latest = document(owner.read(PREFERENCE).await, StatusCode::OK).await;
    let delayed = json!({"key":"http-observation-delayed-by-network","expected_revision":latest["revision"],"opening_id":"http-old-opening","value":"expanded"});
    let delayed = DelayedObservation::start(owner, &delayed).await;
    let undo = json!({"key":"http-undo-layout","expected_revision":latest["revision"],"action":{"kind":"undo","target":{"id":record["id"],"revision":record["revision"]}}});
    document(owner.command(PREFERENCE, &undo).await, StatusCode::OK).await;
    refused(
        delayed.release().await,
        StatusCode::CONFLICT,
        "knowledge_conflict",
    )
    .await;
    assert!(document(owner.read(PREFERENCE).await, StatusCode::OK).await["current"].is_null());
    for old in [&first, &second] {
        assert!(
            document(owner.command(OBSERVATIONS, old).await, StatusCode::OK).await["current"]
                .is_null()
        );
    }
    assert!(
        !document(recipient.read(&destination).await, StatusCode::OK).await["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v["record"]["kind"] == "published_preference")
    );
    let before_save = document(owner.read(PREFERENCE).await, StatusCode::OK).await;
    let emitted_before_save = json!({"key":"http-observation-delayed-across-save","expected_revision":before_save["revision"],"opening_id":"http-opening-before-save","value":"standard"});
    let held_before_save = DelayedObservation::start(owner, &emitted_before_save).await;
    let save = json!({"key":"http-explicit-save-after-undo","expected_revision":before_save["revision"],"action":{"kind":"save","value":"expanded"}});
    let saved = document(owner.command(PREFERENCE, &save).await, StatusCode::OK).await;
    assert_eq!(
        saved["record"]["record"]["certainty"],
        "explicit_preference"
    );
    let after_save = document(owner.read(PREFERENCE).await, StatusCode::OK).await;
    refused(
        held_before_save.release().await,
        StatusCode::CONFLICT,
        "knowledge_conflict",
    )
    .await;
    assert_eq!(
        document(owner.read(PREFERENCE).await, StatusCode::OK).await,
        after_save,
        "a previously emitted request cannot mutate the explicit Save or consumed horizon"
    );
    for index in 0..2 {
        let current = document(owner.read(PREFERENCE).await, StatusCode::OK).await;
        let fresh = json!({"key":format!("http-fresh-choice-after-save-{index}"),"expected_revision":current["revision"],"opening_id":format!("http-fresh-opening-after-save-{index}"),"value":"standard"});
        let observed = document(owner.command(OBSERVATIONS, &fresh).await, StatusCode::OK).await;
        assert_eq!(
            observed["current"]["record"], saved["record"]["record"],
            "fresh explicit choices remain accepted without overriding the owner's saved preference"
        );
    }
    let mut arbitrary = publish.clone();
    arbitrary["action"]["text"] =
        json!("Private conversation must not be accepted as a typed preference");
    refused(
        owner.command(PREFERENCE, &arbitrary).await,
        StatusCode::BAD_REQUEST,
        "invalid_knowledge",
    )
    .await;
}
