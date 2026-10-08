//! Actual HTTP and guarded PostgreSQL proof; only this test owns its schema.
use reqwest::{Client, Method, RequestBuilder, Response, StatusCode};
use serde_json::{Value, json};
use sqlx::{Connection, Executor, PgConnection};
use std::time::{Duration, Instant};
use zobba_application::identity::CurrentAuthority;
use zobba_infrastructure::{
    RuntimeDatabase, database_options, identity::IdentityRepository, migrate,
};

#[path = "../../infrastructure/tests/support/mod.rs"]
mod support;

const SNAPSHOT: &str = "/methodology/organisations/org-a";
const SAVE: &str = "/methodology/organisations/org-a/save";
const RECALL: &str = "/methodology/organisations/org-a/recall";
const CREATE: &str =
    "/engagements/engagement-a/task-commands?organisation_id=org-a&client_id=client-a";
const CONTROLS: &str =
    "/engagements/engagement-a/task-controls?organisation_id=org-a&client_id=client-a";

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
    fn post(&self, route: &str) -> RequestBuilder {
        self.request(Method::POST, route)
            .header("Origin", &self.origin)
            .header("X-CSRF-Token", &self.csrf)
            .header("X-Expected-Actor", &self.actor)
            .header("Content-Type", "application/json")
    }
    async fn read(&self, route: &str) -> Response {
        self.request(Method::GET, route).send().await.unwrap()
    }
    async fn command(&self, route: &str, value: &Value) -> Response {
        self.post(route)
            .body(value.to_string())
            .send()
            .await
            .unwrap()
    }
    async fn sign_in(&self, identities: &IdentityRepository, issuer: &str, subject: &str) -> Self {
        let token = identities
            .establish_verified_session(issuer, subject, subject, None, None)
            .await
            .unwrap();
        let session = identities.session(&token).await.unwrap();
        Self {
            token,
            csrf: session.csrf_token,
            actor: session.identity.id,
            ..self.clone()
        }
    }
}
async fn document(response: Response, expected: StatusCode) -> Value {
    assert_eq!(response.headers()["cache-control"], "no-store");
    assert_eq!(response.headers()["content-type"], "application/json");
    assert!(!response.headers().contains_key("set-cookie"));
    let status = response.status();
    let text = response.text().await.unwrap();
    assert_eq!(status, expected, "{text}");
    serde_json::from_str(&text).unwrap()
}
async fn refused(response: Response, expected: StatusCode, code: &str) {
    assert_eq!(document(response, expected).await, json!({"error":code}));
}
fn save(key: &str, revision: &str) -> Value {
    json!({
        "key":key,"expected_revision":revision,"supersedes":null,"undo_of":null,
        "assignment":{"kind":"firm","client_id":null,"engagement_id":null},
        "applicability":{"audit_area":null,"period_start":null,"period_end":null},
        "activation":{"mode":"new_tasks","available_at":0},
        "definition":{
            "name":"Receivables review","neutral_starter":false,
            "default_context":{"audit_area":"Receivables","period_start":"2024-01-01","period_end":"2024-12-31"},
            "requirements":[{"id":"review","label":"Review","mandatory":true,"criteria":["Document the conclusion"],
                "populations":null,"evidence_checks":null,"ratings":null,"review_rules":null,
                "templates":[{"id":"review-template","version":"v1"}],"suitable_skills":null}],
            "templates":[{"id":"review-template","version":"v1","name":"Review template",
                "sections":[{"id":"conclusion","title":"Conclusion","content":"Record the basis for the conclusion.","required":true}]}]
        },
        "source":{"kind":"authored","reference":null,"note":null}
    })
}
fn basis(task: &Value) -> String {
    format!(
        "/engagements/engagement-a/tasks/{}/methodology?organisation_id=org-a&client_id=client-a",
        task["task_id"].as_str().unwrap()
    )
}

async fn fixture(config: &support::Configuration, admin: &mut PgConnection, issuer: &str) {
    let mut migration = PgConnection::connect_with(&database_options(&config.migration).unwrap())
        .await
        .unwrap();
    config.guard_connection(&mut migration).await;
    migration.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT USAGE ON SCHEMA public TO PUBLIC; REVOKE CREATE ON SCHEMA public FROM PUBLIC;").await.unwrap();
    let owns_schema: bool = sqlx::query_scalar("SELECT nspowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user) FROM pg_catalog.pg_namespace WHERE nspname='public'")
        .fetch_one(&mut migration).await.unwrap();
    assert!(owns_schema, "fixture reset preserves migration ownership");
    migration.close().await.unwrap();
    config.guard_connection(admin).await;
    let runtime_role = database_options(&config.runtime)
        .unwrap()
        .get_username()
        .to_owned();
    migrate(&config.migration, &runtime_role).await.unwrap();
    let mut tx = admin.begin().await.unwrap();
    sqlx::query("INSERT INTO public.identities(id,issuer,subject,display_name) VALUES('identity-admin',$1,'admin','Casey'),('identity-combined',$1,'combined','Alex'),('identity-auditor',$1,'auditor','Robin'),('identity-foreign',$1,'foreign','Foreign')")
        .bind(issuer).execute(&mut *tx).await.unwrap();
    tx.execute("INSERT INTO public.organisations(id,name) VALUES('org-a','Northstar'),('org-b','Private foreign organisation');
        INSERT INTO public.clients(organisation_id,id,name) VALUES('org-a','client-a','Alder'),('org-b','client-b','Private foreign client');
        INSERT INTO public.engagements(organisation_id,client_id,id,name) VALUES('org-a','client-a','engagement-a','Audit A'),('org-b','client-b','engagement-b','Private foreign engagement');
        INSERT INTO public.organisation_memberships(organisation_id,actor_id,roles) VALUES('org-a','identity-admin',ARRAY['admin']),('org-a','identity-combined',ARRAY['admin','auditor']),('org-a','identity-auditor',ARRAY['auditor']),('org-b','identity-foreign',ARRAY['admin']);
        INSERT INTO public.engagement_assignments(organisation_id,client_id,engagement_id,actor_id) VALUES('org-a','client-a','engagement-a','identity-admin'),('org-a','client-a','engagement-a','identity-combined'),('org-a','client-a','engagement-a','identity-auditor');")
        .await.unwrap();
    tx.commit().await.unwrap();
}

async fn header_fences(admin: &Browser) {
    let command = save("header-refusal", "0");
    for name in ["Origin", "X-CSRF-Token", "X-Expected-Actor"] {
        let mut request = admin.post(SAVE).body(command.to_string()).build().unwrap();
        request.headers_mut().remove(name);
        refused(
            admin.client.execute(request).await.unwrap(),
            StatusCode::FORBIDDEN,
            "access_denied",
        )
        .await;
    }
    for (name, value) in [
        ("Origin", "https://foreign.example"),
        ("X-CSRF-Token", "obsolete"),
        ("X-Expected-Actor", "identity-auditor"),
    ] {
        refused(
            admin
                .post(SAVE)
                .header(name, value)
                .body(command.to_string())
                .send()
                .await
                .unwrap(),
            StatusCode::FORBIDDEN,
            "access_denied",
        )
        .await;
    }
    for response in [
        admin
            .request(Method::GET, SNAPSHOT)
            .header("X-Expected-Session", "obsolete")
            .send()
            .await
            .unwrap(),
        admin
            .post(SAVE)
            .header("X-Expected-Session", "obsolete")
            .body(command.to_string())
            .send()
            .await
            .unwrap(),
    ] {
        refused(response, StatusCode::PRECONDITION_FAILED, "session_changed").await;
    }
    assert_eq!(
        document(admin.read(SNAPSHOT).await, StatusCode::OK).await["revision"],
        "0"
    );
}

async fn save_and_bind(admin: &Browser, auditor: &Browser) -> Value {
    refused(
        auditor.read(SNAPSHOT).await,
        StatusCode::FORBIDDEN,
        "access_denied",
    )
    .await;
    refused(
        admin.read("/methodology/organisations/org-b").await,
        StatusCode::FORBIDDEN,
        "access_denied",
    )
    .await;
    let original = save("save-original", "0");
    refused(
        auditor.command(SAVE, &original).await,
        StatusCode::FORBIDDEN,
        "access_denied",
    )
    .await;
    refused(
        admin
            .command("/methodology/organisations/org-b/save", &original)
            .await,
        StatusCode::FORBIDDEN,
        "access_denied",
    )
    .await;
    let receipt = document(admin.command(SAVE, &original).await, StatusCode::OK).await;
    assert_eq!(receipt["actor_id"], admin.actor);
    assert_eq!(receipt["revision"], "1");
    assert_eq!(
        receipt,
        document(admin.command(SAVE, &original).await, StatusCode::OK).await
    );
    let mut changed = original.clone();
    changed["source"]["note"] = json!("Changed exact meaning");
    refused(
        admin.command(SAVE, &changed).await,
        StatusCode::CONFLICT,
        "methodology_conflict",
    )
    .await;
    changed["key"] = json!("stale-save");
    refused(
        admin.command(SAVE, &changed).await,
        StatusCode::CONFLICT,
        "methodology_conflict",
    )
    .await;
    changed["expected_revision"] = json!("1");
    changed["assignment"] =
        json!({"kind":"engagement","client_id":"client-b","engagement_id":"engagement-b"});
    refused(
        admin.command(SAVE, &changed).await,
        StatusCode::BAD_REQUEST,
        "invalid_methodology",
    )
    .await;
    let snapshot = document(admin.read(SNAPSHOT).await, StatusCode::OK).await;
    assert_eq!(snapshot["versions"].as_array().unwrap().len(), 1);
    assert_eq!(snapshot["versions"][0]["command"], original);
    assert!(!snapshot.to_string().contains("Private foreign"));

    let defaults = original["definition"]["default_context"].clone();
    let context =
        json!({"audit_area":"Inventory","period_start":"2023-04-01","period_end":"2024-03-31"});
    for field in ["audit_area", "period_start", "period_end"] {
        assert_ne!(
            context[field], defaults[field],
            "explicit {field} must differ from defaults"
        );
    }
    let create = json!({"key":"create-explicit","kind":"create","task_id":null,"cycle_id":null,"content":"Inspect inventory","context":context});
    // Task mutations retain their established cookie/CSRF/actor contract. The
    // optional read-only session header must not interfere with valid admission.
    let task = document(
        auditor
            .post(CREATE)
            .header("X-Expected-Session", "irrelevant-read-header")
            .body(create.to_string())
            .send()
            .await
            .unwrap(),
        StatusCode::ACCEPTED,
    )
    .await;
    assert_eq!(
        task,
        document(auditor.command(CREATE, &create).await, StatusCode::ACCEPTED).await
    );
    let mut changed_create = create.clone();
    changed_create["context"]["period_end"] = json!("2024-02-29");
    refused(
        auditor.command(CREATE, &changed_create).await,
        StatusCode::CONFLICT,
        "task_command_conflict",
    )
    .await;
    let task_basis = document(auditor.read(&basis(&task)).await, StatusCode::OK).await;
    assert_eq!(task_basis["task_id"], task["task_id"]);
    assert_eq!(task_basis["current"]["actor_id"], auditor.actor);
    assert!(task_basis["current"]["context_command_id"].is_null());
    assert_eq!(task_basis["history"], json!([]));
    assert!(task_basis["pending"].is_null());
    assert_eq!(task_basis["current"]["resolution"]["context"], context);
    assert_eq!(
        task_basis["current"]["candidate_version_ids"],
        json!([receipt["version_id"]])
    );
    assert_eq!(
        task_basis["current"]["resolution"]["version_ids"],
        json!([receipt["version_id"]])
    );
    assert_eq!(
        task_basis["current"]["resolution"]["neutral_source_version_ids"],
        json!([])
    );
    assert_eq!(
        task_basis["current"]["resolution"]["templates"][0]["template"]["sections"][0]["content"],
        "Record the basis for the conclusion."
    );
    assert_eq!(
        task_basis["current"]["resolution"]["templates"][0]["source_version_id"],
        receipt["version_id"]
    );
    assert!(
        !task_basis["current"]["resolution"]["requirements"][0]["field_sources"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    refused(
        admin.read(&basis(&task)).await,
        StatusCode::FORBIDDEN,
        "access_denied",
    )
    .await;
    let foreign_scope = basis(&task).replace("organisation_id=org-a", "organisation_id=org-b");
    refused(
        auditor.read(&foreign_scope).await,
        StatusCode::FORBIDDEN,
        "access_denied",
    )
    .await;
    let absent_context = json!({"key":"create-defaults","kind":"create","task_id":null,"cycle_id":null,"content":"Inspect other receivables"});
    let default_task = document(
        auditor.command(CREATE, &absent_context).await,
        StatusCode::ACCEPTED,
    )
    .await;
    let default_basis = document(auditor.read(&basis(&default_task)).await, StatusCode::OK).await;
    assert_eq!(default_basis["current"]["resolution"]["context"], defaults);
    let conversation = document(
        auditor
            .read("/engagements/engagement-a/conversation?organisation_id=org-a&client_id=client-a")
            .await,
        StatusCode::OK,
    )
    .await;
    let messages = conversation["messages"].as_array().unwrap();
    let explicit_messages: Vec<_> = messages
        .iter()
        .filter(|message| message["key"] == "create-explicit")
        .collect();
    assert_eq!(
        explicit_messages.len(),
        1,
        "exact replay retains one command"
    );
    let explicit = explicit_messages[0];
    assert_eq!(explicit["command_id"], task["command_id"]);
    assert_eq!(explicit["task_id"], task["task_id"]);
    assert_eq!(explicit["cycle_id"], task["cycle_id"]);
    assert_eq!(explicit["author_id"], auditor.actor);
    assert_eq!(explicit["kind"], "create");
    assert_eq!(explicit["content"], create["content"]);
    assert_eq!(explicit["context"], context);
    assert_eq!(
        document(auditor.read(&basis(&task)).await, StatusCode::OK).await["current"],
        task_basis["current"],
        "the exact explicit initial binding remains persisted after a separate defaulted Create"
    );
    assert!(
        messages
            .iter()
            .find(|message| message["key"] == "create-defaults")
            .unwrap()["context"]
            .is_null(),
        "recovery echoes the exact optional command context, separately from resolved firm defaults"
    );
    guide_context(auditor, &default_task, &default_basis).await;

    let mut successor = save("save-successor", "1");
    successor["supersedes"] = receipt["version_id"].clone();
    successor["definition"]["requirements"][0]["criteria"] =
        json!(["Document an expanded conclusion"]);
    let successor_receipt = document(admin.command(SAVE, &successor).await, StatusCode::OK).await;
    assert_eq!(successor_receipt["impact"]["retained_tasks"], "2");
    let retained = document(auditor.read(&basis(&task)).await, StatusCode::OK).await;
    assert_eq!(retained["current"], task_basis["current"]);
    assert!(retained["pending"].is_null());
    assert_eq!(
        retained["notices"][0]["version_id"],
        successor_receipt["version_id"]
    );
    let recall = json!({"key":"recall-original","expected_revision":"2","version_id":receipt["version_id"],"reason":"The original required control was incomplete"});
    let recalled = document(admin.command(RECALL, &recall).await, StatusCode::OK).await;
    assert_eq!(
        recalled,
        document(admin.command(RECALL, &recall).await, StatusCode::OK).await
    );
    let recalled_basis = document(auditor.read(&basis(&task)).await, StatusCode::OK).await;
    assert!(recalled_basis["recalled"].as_bool().unwrap());
    assert_eq!(
        recalled_basis["current"], task_basis["current"],
        "recall retains the historical basis"
    );
    task
}

async fn guide_context(auditor: &Browser, task: &Value, original_basis: &Value) {
    let context =
        json!({"audit_area":"Receivables","period_start":"2023-01-01","period_end":"2023-12-31"});
    let command = json!({
        "key":"guide-context", "kind":"guide", "task_id":task["task_id"],
        "cycle_id":task["cycle_id"], "content":"Use the year ended December 2023.",
        "context":context,
    });
    let receipt = document(
        auditor.command(CONTROLS, &command).await,
        StatusCode::ACCEPTED,
    )
    .await;
    assert_eq!(receipt["task_id"], task["task_id"]);
    assert_eq!(receipt["cycle_id"], task["cycle_id"]);
    assert_eq!(
        receipt,
        document(
            auditor.command(CONTROLS, &command).await,
            StatusCode::ACCEPTED
        )
        .await
    );
    let mut changed = command.clone();
    changed["context"]["period_end"] = json!("2023-11-30");
    refused(
        auditor.command(CONTROLS, &changed).await,
        StatusCode::CONFLICT,
        "task_command_conflict",
    )
    .await;

    let pending = document(auditor.read(&basis(task)).await, StatusCode::OK).await;
    assert_eq!(
        pending["current"], original_basis["current"],
        "Guide retains the original binding until a safe work boundary"
    );
    assert_eq!(pending["pending"]["id"], receipt["command_id"]);
    assert_eq!(pending["pending"]["actor_id"], auditor.actor);
    assert!(
        pending["pending"]["requested_at"]
            .as_i64()
            .is_some_and(|at| at > 0)
    );
    assert_eq!(pending["pending"]["resolution"]["context"], context);
    assert_eq!(
        pending["pending"]["reason"],
        format!(
            "Explicit Task context supplied by Guide: {}",
            command["content"].as_str().unwrap()
        )
    );

    let unchanged = json!({"key":"guide-unchanged","kind":"guide","task_id":task["task_id"],"cycle_id":task["cycle_id"],"content":"Retain the discovered business period."});
    let unchanged_receipt = document(
        auditor.command(CONTROLS, &unchanged).await,
        StatusCode::ACCEPTED,
    )
    .await;
    let mut explicit_null = unchanged.clone();
    explicit_null["context"] = Value::Null;
    assert_eq!(
        unchanged_receipt,
        document(
            auditor.command(CONTROLS, &explicit_null).await,
            StatusCode::ACCEPTED
        )
        .await
    );
    assert_eq!(
        document(auditor.read(&basis(task)).await, StatusCode::OK).await["pending"],
        pending["pending"],
        "a Guide without context leaves the staged replacement unchanged"
    );

    for (kind, route) in [
        ("pause", CONTROLS),
        ("stop", CONTROLS),
        ("resume", CREATE),
        ("continue", CREATE),
    ] {
        let control = json!({"key":format!("context-refused-{kind}"),"kind":kind,"task_id":task["task_id"],"cycle_id":task["cycle_id"],"content":null,"context":context});
        refused(
            auditor.command(route, &control).await,
            StatusCode::BAD_REQUEST,
            "invalid_task_command",
        )
        .await;
    }
    let conversation = document(
        auditor
            .read("/engagements/engagement-a/conversation?organisation_id=org-a&client_id=client-a")
            .await,
        StatusCode::OK,
    )
    .await;
    let messages = conversation["messages"].as_array().unwrap();
    let message = messages
        .iter()
        .find(|message| message["key"] == "guide-context")
        .unwrap();
    assert_eq!(message["command_id"], receipt["command_id"]);
    assert_eq!(message["context"], context);
    assert_eq!(
        messages
            .iter()
            .filter(|message| message["key"] == "guide-context")
            .count(),
        1,
        "exact replay adds no second Guide"
    );
}

async fn logout_while_waiting(
    browser: &Browser,
    identities: &IdentityRepository,
    issuer: &str,
    config: &support::Configuration,
    admin: &mut PgConnection,
    subject: &str,
    request: (String, Option<Value>),
) {
    let waiting = browser.sign_in(identities, issuer, subject).await;
    let token = waiting.token.clone();
    let mut barrier = PgConnection::connect_with(&database_options(&config.admin).unwrap())
        .await
        .unwrap();
    config.guard_connection(&mut barrier).await;
    barrier
        .execute("BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('org-a',205))")
        .await
        .unwrap();
    let pending = tokio::spawn(async move {
        match request.1 {
            Some(body) => waiting.command(&request.0, &body).await,
            None => waiting.read(&request.0).await,
        }
    });
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        let blocked: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory')")
            .fetch_one(&mut *admin).await.unwrap();
        if blocked {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "the real HTTP request never reached the organisation lock"
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
    barrier.close().await.unwrap();
}

#[tokio::test]
async fn methodology_http_save_replay_scope_context_and_session_fences() {
    let config = support::Configuration::from_environment();
    let issuer =
        std::env::var("ZOBBA_OIDC_ISSUER").expect("load the local fixture OIDC configuration");
    let origin =
        std::env::var("ZOBBA_PUBLIC_ORIGIN").expect("load the local fixture public origin");
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
    let admin = browser.sign_in(&identities, &issuer, "admin").await;
    let auditor = browser.sign_in(&identities, &issuer, "auditor").await;
    header_fences(&admin).await;
    let task = save_and_bind(&admin, &auditor).await;
    for (subject, route, command) in [
        ("admin", SNAPSHOT.to_owned(), None),
        (
            "admin",
            SAVE.to_owned(),
            Some(save("lost-session-save", "3")),
        ),
        ("auditor", basis(&task), None),
        (
            "auditor",
            CREATE.to_owned(),
            Some(
                json!({"key":"lost-session-create","kind":"create","task_id":null,"cycle_id":null,"content":"Never admitted"}),
            ),
        ),
    ] {
        logout_while_waiting(
            &browser,
            &identities,
            &issuer,
            &config,
            &mut connection,
            subject,
            (route, command),
        )
        .await;
    }
    assert_eq!(
        document(admin.read(SNAPSHOT).await, StatusCode::OK).await["revision"],
        "3"
    );
    connection.execute("UPDATE public.engagement_assignments SET active=false WHERE organisation_id='org-a' AND actor_id='identity-auditor'; UPDATE public.organisation_memberships SET active=false WHERE organisation_id='org-a' AND actor_id='identity-admin'").await.unwrap();
    refused(
        auditor.read(&basis(&task)).await,
        StatusCode::FORBIDDEN,
        "access_denied",
    )
    .await;
    refused(
        admin.read(SNAPSHOT).await,
        StatusCode::FORBIDDEN,
        "access_denied",
    )
    .await;
    refused(
        admin.command(SAVE, &save("revoked-admin", "3")).await,
        StatusCode::FORBIDDEN,
        "access_denied",
    )
    .await;
    stop.send(()).unwrap();
    server.await.unwrap();
    database.pool().close().await;
    connection.close().await.unwrap();
}
