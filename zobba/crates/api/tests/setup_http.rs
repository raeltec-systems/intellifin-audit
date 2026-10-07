//! Actual HTTP/session/SQL proof for conversational engagement setup (Story 22.2 AC4).
use std::time::Duration;

use reqwest::{Client, Response, StatusCode};
use serde_json::{Value, json};
use sqlx::{Connection, Executor, PgConnection};
use zobba_application::identity::CurrentAuthority;
use zobba_infrastructure::{
    RuntimeDatabase, database_options, identity::IdentityRepository, migrate,
};

#[path = "../../infrastructure/tests/support/mod.rs"]
mod support;

const ISSUER: &str = "https://synthetic-setup-http.example";

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
    async fn post(&self, path: &str, body: &Value) -> Response {
        self.client
            .post(format!("{}{path}", self.address))
            .header("Cookie", format!("__Host-zobba-session={}", self.token))
            .header("Origin", &self.origin)
            .header("X-CSRF-Token", &self.csrf)
            .header("X-Expected-Actor", &self.actor)
            .header("Content-Type", "application/json")
            .body(body.to_string())
            .send()
            .await
            .unwrap()
    }
    async fn get(&self, path: &str) -> Response {
        self.client
            .get(format!("{}{path}", self.address))
            .header("Cookie", format!("__Host-zobba-session={}", self.token))
            .header("X-Expected-Session", &self.csrf)
            .send()
            .await
            .unwrap()
    }
}

async fn document(response: Response, expected: StatusCode) -> Value {
    assert_eq!(response.headers()["cache-control"], "no-store");
    let status = response.status();
    let text = response.text().await.unwrap();
    assert_eq!(status, expected, "{text}");
    serde_json::from_str(&text).unwrap()
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
    sqlx::query("INSERT INTO public.identities(id,issuer,subject,display_name) VALUES('identity-a',$1,'auditor-a','Alex'),('identity-admin',$1,'admin','Casey')")
        .bind(ISSUER).execute(&mut *tx).await.unwrap();
    tx.execute("INSERT INTO public.organisations(id,name) VALUES('org-a','Northstar');
        INSERT INTO public.clients(organisation_id,id,name) VALUES('org-a','client-a','Alder'),('org-a','client-b','ALDER');
        INSERT INTO public.organisation_memberships(organisation_id,actor_id,roles) VALUES('org-a','identity-a',ARRAY['auditor']),('org-a','identity-admin',ARRAY['admin']);")
        .await.unwrap();
    tx.commit().await.unwrap();
}

#[tokio::test]
async fn organisation_setup_http_fences_replay_and_establishes_once() {
    let config = support::Configuration::from_environment();
    let mut admin = PgConnection::connect_with(&database_options(&config.admin).unwrap())
        .await
        .unwrap();
    fixture(&config, &mut admin).await;
    let database = RuntimeDatabase::connect(&config.runtime).await.unwrap();
    let identities = IdentityRepository::new(database.pool().clone());
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
    let sign_in = |subject: &'static str| {
        let identities = identities.clone();
        let address = address.clone();
        async move {
            let token = identities
                .establish_session(ISSUER, subject, subject, None)
                .await
                .unwrap();
            let session = identities.session(&token).await.unwrap();
            Browser {
                client: Client::builder()
                    .timeout(Duration::from_secs(10))
                    .build()
                    .unwrap(),
                address,
                origin: std::env::var("ZOBBA_PUBLIC_ORIGIN")
                    .expect("load the actual local fixture environment for HTTP tests"),
                token,
                csrf: session.csrf_token,
                actor: session.identity.id,
            }
        }
    };
    let auditor = sign_in("auditor-a").await;
    let only_admin = sign_in("admin").await;

    // No assignment yet: the engagement list is empty, but setup is offered.
    let engagements = document(auditor.get("/engagements").await, StatusCode::OK).await;
    assert_eq!(engagements["engagements"], json!([]));
    let organisations = document(
        auditor.get("/engagement-setups/organisations").await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(
        organisations,
        json!({"organisations":[{"organisation_id":"org-a","organisation_name":"Northstar"}]})
    );
    assert_eq!(
        document(
            only_admin.get("/engagement-setups/organisations").await,
            StatusCode::OK
        )
        .await,
        json!({"organisations":[]})
    );

    let base = "/organisations/org-a/engagement-setups";
    let open = json!({"key":"http-open","objective":"Review leaver access"});
    // Mutation fences: CSRF, expected actor and Admin-only authority.
    let mut forged = auditor.clone();
    forged.actor = "identity-admin".into();
    assert_eq!(
        document(forged.post(base, &open).await, StatusCode::FORBIDDEN).await,
        json!({"error":"access_denied"})
    );
    let mut no_csrf = auditor.clone();
    no_csrf.csrf = "wrong".into();
    assert_eq!(
        no_csrf.post(base, &open).await.status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        document(only_admin.post(base, &open).await, StatusCode::FORBIDDEN).await,
        json!({"error":"access_denied"})
    );
    assert_eq!(
        document(
            auditor
                .post(base, &json!({"key":"http-open","objective":"x","extra":1}))
                .await,
            StatusCode::BAD_REQUEST
        )
        .await,
        json!({"error":"invalid_engagement_setup"})
    );

    let opened = document(auditor.post(base, &open).await, StatusCode::OK).await;
    assert_eq!(opened["state"], "client");
    assert_eq!(opened["messages"].as_array().unwrap().len(), 2);
    assert_eq!(opened["messages"][1]["prompt"], "client");
    let id = opened["id"].as_str().unwrap().to_owned();
    assert_eq!(
        document(auditor.post(base, &open).await, StatusCode::OK).await,
        opened,
        "an identical retry returns the original setup"
    );
    assert_eq!(
        document(
            auditor
                .post(base, &json!({"key":"http-open","objective":"Changed"}))
                .await,
            StatusCode::CONFLICT
        )
        .await,
        json!({"error":"engagement_setup_conflict"})
    );
    let messages = format!("{base}/{id}/messages");
    let asked = document(
        auditor
            .post(
                &messages,
                &json!({"key":"http-client","kind":"text","content":"alder"}),
            )
            .await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(asked["state"], "client_choice");
    assert_eq!(asked["candidates"].as_array().unwrap().len(), 2);
    assert_eq!(
        document(
            auditor
                .post(
                    &messages,
                    &json!({"key":"http-bad","kind":"choose_client","content":"x"})
                )
                .await,
            StatusCode::BAD_REQUEST
        )
        .await,
        json!({"error":"invalid_engagement_setup"})
    );
    let refused = document(
        auditor
            .post(
                &messages,
                &json!({"key":"http-outside","kind":"choose_client","client_id":"client-z"}),
            )
            .await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(refused["state"], "client_choice");
    let last = refused["messages"]
        .as_array()
        .unwrap()
        .last()
        .unwrap()
        .clone();
    assert_eq!(last["refusal"], "not_a_candidate");
    document(
        auditor
            .post(
                &messages,
                &json!({"key":"http-choose","kind":"choose_client","client_id":"client-b"}),
            )
            .await,
        StatusCode::OK,
    )
    .await;
    let ready = document(
        auditor
            .post(
                &messages,
                &json!({"key":"http-period","kind":"text","content":"2026-01-01 to 2026-12-31"}),
            )
            .await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(ready["state"], "confirm");
    assert_eq!(ready["client"]["client_name"], "ALDER");
    assert_eq!(ready["period_start"], "2026-01-01");
    assert_eq!(
        document(auditor.get(&format!("{base}/{id}")).await, StatusCode::OK).await,
        ready
    );
    assert_eq!(
        document(auditor.get(base).await, StatusCode::OK).await["setups"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let confirm = format!("{base}/{id}/confirm");
    let done = document(
        auditor.post(&confirm, &json!({"key":"http-confirm"})).await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(done["state"], "established");
    let established = done["established"].clone();
    assert_eq!(established["client_id"], "client-b");
    assert_eq!(established["receipt"]["status"], "received");
    assert_eq!(
        document(
            auditor.post(&confirm, &json!({"key":"http-confirm"})).await,
            StatusCode::OK
        )
        .await["established"],
        established,
        "exact retry returns the original receipt"
    );
    assert_eq!(
        document(
            auditor.post(&confirm, &json!({"key":"http-period"})).await,
            StatusCode::CONFLICT
        )
        .await,
        json!({"error":"engagement_setup_conflict"})
    );
    // The new engagement and its first Task are now ordinary scoped resources.
    let engagement = established["engagement_id"].as_str().unwrap();
    let opened_engagement = document(
        auditor
            .get(&format!(
                "/engagements/{engagement}?organisation_id=org-a&client_id=client-b"
            ))
            .await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(
        opened_engagement["engagement_name"],
        "Audit 2026-01-01 to 2026-12-31"
    );
    let tasks = document(
        auditor
            .get(&format!(
                "/engagements/{engagement}/tasks?organisation_id=org-a&client_id=client-b"
            ))
            .await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(tasks["tasks"][0]["objective"], "Review leaver access");
    assert_eq!(tasks["tasks"][0]["id"], established["receipt"]["task_id"]);
    assert_eq!(
        document(
            only_admin.get(&format!("{base}/{id}")).await,
            StatusCode::FORBIDDEN
        )
        .await,
        json!({"error":"access_denied"})
    );
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM public.engagements")
        .fetch_one(&mut admin)
        .await
        .unwrap();
    assert_eq!(count, 1);
    let _ = stop.send(());
    server.await.unwrap();
    database.pool().close().await;
}
