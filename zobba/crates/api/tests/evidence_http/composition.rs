//! Production environment composition and both real router deadline layers.
use super::*;
use axum::{
    Router,
    body::{Body, to_bytes},
    http::{HeaderMap, Request},
};
use std::sync::{Arc, atomic::AtomicBool};

const CHILD: &str = "ZOBBA_EVIDENCE_CONSTRUCTOR_CASE";

pub(super) async fn production_configuration_contract(config: &support::Configuration) {
    for mode in [
        "configured",
        "missing",
        "invalid_bucket",
        "invalid_endpoint",
    ] {
        // A synthetic HTTPS destination is deliberately never contacted. Any
        // attempted S3 connection fails this test before it can emit a request.
        let sentinel = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = sentinel.local_addr().unwrap();
        let mut command = tokio::process::Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "composition::production_constructor_child",
                "--ignored",
                "--nocapture",
            ])
            .kill_on_drop(true)
            .env_clear()
            .env(CHILD, mode)
            .env("ZOBBA_TEST_MIGRATION_DATABASE_URL", &config.migration)
            .env("ZOBBA_TEST_RUNTIME_DATABASE_URL", &config.runtime)
            .env("ZOBBA_TEST_ADMIN_DATABASE_URL", &config.admin)
            .env(
                "ZOBBA_PUBLIC_ORIGIN",
                "https://synthetic-evidence.example.test",
            )
            .env("AWS_ACCESS_KEY_ID", "synthetic-access-key")
            .env("AWS_SECRET_ACCESS_KEY", "synthetic-secret-key")
            .env("AWS_REGION", "us-east-1")
            .env("AWS_EC2_METADATA_DISABLED", "true")
            .env(
                "AWS_ENDPOINT",
                format!(
                    "{}://{address}",
                    if mode == "invalid_endpoint" {
                        "http"
                    } else {
                        "https"
                    }
                ),
            );
        if mode != "missing" {
            command.env(
                "ZOBBA_EVIDENCE_BUCKET",
                if mode == "invalid_bucket" {
                    ""
                } else {
                    "synthetic-evidence"
                },
            );
        }
        let output = tokio::select! {
            result = timeout(Duration::from_secs(30), command.output()) => result.expect("bounded production constructor child").unwrap(),
            _ = sentinel.accept() => panic!("production metadata or reservation attempted S3 network I/O: {mode}"),
        };
        assert!(
            output.status.success(),
            "production constructor case {mode} failed:\n{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(
            String::from_utf8_lossy(&output.stdout).contains("1 passed"),
            "child must execute its selected assertion"
        );
    }
}

#[tokio::test]
#[ignore = "spawned with isolated synthetic configuration by the parent HTTP contract"]
async fn production_constructor_child() {
    let mode = std::env::var(CHILD).expect("explicit constructor case");
    let configured = mode == "configured";
    let config = support::Configuration::from_environment();
    let database = RuntimeDatabase::connect(&config.runtime).await.unwrap();
    let identities = IdentityRepository::new(database.pool().clone());
    let token = identities
        .establish_session(ISSUER, "auditor-a", "Alex", None)
        .await
        .unwrap();
    let csrf = identities.session(&token).await.unwrap().csrf_token;
    let browser = Browser {
        client: Client::new(),
        address: String::new(),
        origin: std::env::var("ZOBBA_PUBLIC_ORIGIN").unwrap(),
        token,
        csrf,
    };
    let auth = zobba_api::auth::AuthState::from_environment(&database).unwrap();
    // Exercise the production constructor itself: it must read the bucket and
    // construct the guarded production S3 adapter, with no injected transport.
    let app = zobba_api::authenticated_router(database.clone(), auth);
    let page = composed_read(app.clone(), &browser, "evidence", StatusCode::OK).await;
    assert_eq!(page["storage_configured"], configured);
    let request = claim(
        &format!("production-{mode}"),
        "original.txt",
        b"synthetic original",
    );
    let response = app
        .clone()
        .oneshot(request_for(
            &browser,
            "POST",
            "evidence-reservations",
            Body::from(request.to_string()),
        ))
        .await
        .unwrap();
    let expected = if configured {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    let document = composed_document(response, expected).await;
    if configured {
        assert_eq!(document["request"], request);
        assert_eq!(document["actor_id"], "identity-a");
    } else {
        assert_eq!(document["error"], "evidence_unavailable");
    }
    let pending = composed_read(app, &browser, "evidence-reservations", StatusCode::OK).await;
    assert_eq!(
        pending["items"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|value| value["request"]["key"] == request["key"])
            .count(),
        usize::from(configured)
    );
    identities.logout(&browser.token).await.unwrap();
    database.pool().close().await;
}

fn request_for(browser: &Browser, method: &str, path: &str, body: Body) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(format!("{PREFIX}/{path}?{SCOPE}"))
        .header("Cookie", format!("__Host-zobba-session={}", browser.token))
        .header("Origin", &browser.origin)
        .header("X-CSRF-Token", &browser.csrf)
        .header("X-Expected-Session", &browser.csrf)
        .header(
            "Content-Type",
            if method == "PUT" {
                "application/octet-stream"
            } else {
                "application/json"
            },
        )
        .body(body)
        .unwrap()
}

fn stalled_body(polled: Arc<AtomicBool>) -> Body {
    Body::from_stream(futures_util::stream::poll_fn(move |_| {
        polled.store(true, Ordering::SeqCst);
        std::task::Poll::<Option<Result<bytes::Bytes, std::io::Error>>>::Pending
    }))
}

async fn composed_document(response: axum::response::Response, expected: StatusCode) -> Value {
    let status = response.status();
    private_headers(response.headers());
    let document: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 64 * 1024).await.unwrap()).unwrap();
    assert_eq!(status.as_u16(), expected.as_u16(), "{document}");
    document
}

fn private_headers(headers: &HeaderMap) {
    assert_eq!(headers["cache-control"], "no-store");
    assert_eq!(headers["referrer-policy"], "no-referrer");
    assert_eq!(headers["x-content-type-options"], "nosniff");
}

pub(super) async fn complete_router_deadlines(app: Router, browser: &Browser) {
    let bytes = b"composed deadline original";
    let reservation = app
        .clone()
        .oneshot(request_for(
            browser,
            "POST",
            "evidence-reservations",
            Body::from(claim("composed-deadline", "deadline.txt", bytes).to_string()),
        ))
        .await
        .unwrap();
    let reservation = composed_document(reservation, StatusCode::OK).await;
    let id = reservation["id"].as_str().unwrap();
    let upload_path = format!("evidence-reservations/{id}/upload");
    let first_polled = Arc::new(AtomicBool::new(false));
    let second_polled = Arc::new(AtomicBool::new(false));
    let metadata_polled = Arc::new(AtomicBool::new(false));
    let first = tokio::spawn(app.clone().oneshot(request_for(
        browser,
        "PUT",
        &upload_path,
        stalled_body(first_polled.clone()),
    )));
    let second = tokio::spawn(app.clone().oneshot(request_for(
        browser,
        "PUT",
        &upload_path,
        stalled_body(second_polled.clone()),
    )));
    let metadata = tokio::spawn(app.clone().oneshot(request_for(
        browser,
        "POST",
        "evidence-reservations",
        stalled_body(metadata_polled.clone()),
    )));
    timeout(Duration::from_secs(5), async {
        while ![&first_polled, &second_polled, &metadata_polled]
            .into_iter()
            .all(|flag| flag.load(Ordering::SeqCst))
        {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("real upload authentication, scope and reservation checks reached body collection");
    let excess_polled = Arc::new(AtomicBool::new(false));
    let excess = app
        .clone()
        .oneshot(request_for(
            browser,
            "PUT",
            &upload_path,
            stalled_body(excess_polled.clone()),
        ))
        .await
        .unwrap();
    assert_eq!(excess.headers()["retry-after"], "1");
    assert_eq!(
        composed_document(excess, StatusCode::TOO_MANY_REQUESTS).await["error"],
        "evidence_capacity"
    );
    assert!(!excess_polled.load(Ordering::SeqCst));

    // These are the complete production outer middleware and evidence inner
    // lane around real handlers, not a synthetic /upload handler. Pause only
    // after real database authorization has finished, then control deadlines
    // without a ten-second HTTP client masking an outer fifteen-second bug.
    tokio::time::pause();
    tokio::time::advance(Duration::from_secs(14)).await;
    tokio::task::yield_now().await;
    assert!(!metadata.is_finished());
    tokio::time::advance(Duration::from_secs(2)).await;
    tokio::task::yield_now().await;
    assert!(
        metadata.is_finished(),
        "ordinary metadata retains the fifteen-second boundary"
    );
    assert_eq!(
        composed_document(
            metadata.await.unwrap().unwrap(),
            StatusCode::SERVICE_UNAVAILABLE
        )
        .await["error"],
        "identity_unavailable"
    );
    assert!(
        !first.is_finished() && !second.is_finished(),
        "the complete router permits evidence I/O beyond fifteen seconds"
    );
    tokio::time::advance(Duration::from_secs(103)).await;
    tokio::task::yield_now().await;
    assert!(
        !first.is_finished() && !second.is_finished(),
        "both complete-router requests retain the120-second I/O window"
    );
    tokio::time::advance(Duration::from_secs(1)).await;
    tokio::task::yield_now().await;
    assert!(
        first.is_finished() && second.is_finished(),
        "both deadlines fire at120seconds"
    );
    for request in [first, second] {
        assert_eq!(
            composed_document(
                request.await.unwrap().unwrap(),
                StatusCode::SERVICE_UNAVAILABLE
            )
            .await["error"],
            "evidence_unavailable"
        );
    }
    tokio::time::resume();
    // Timed-out custody remains recoverable; cancellation released the shared
    // lane so the same authenticated reservation can complete through real S3.
    let finished = app
        .oneshot(request_for(
            browser,
            "PUT",
            &upload_path,
            Body::from(bytes.as_slice()),
        ))
        .await
        .unwrap();
    let receipt = composed_document(finished, StatusCode::OK).await;
    assert_eq!(receipt["reservation"]["id"], id);
}
