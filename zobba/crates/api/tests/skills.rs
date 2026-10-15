//! Actual socket HTTP and guarded PostgreSQL: selection is metadata, not execution.
use reqwest::{Client, Method, RequestBuilder, Response, StatusCode, header::HeaderValue};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{Connection, Executor, PgConnection};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use zobba_application::{identity::CurrentAuthority, operation::OperationStore};
use zobba_domain::{identity::Scope, permissions::*};
use zobba_infrastructure::{
    RuntimeDatabase, database_options, identity::IdentityRepository, migrate,
    operation::OperationRepository,
};

#[path = "../../infrastructure/tests/support/mod.rs"]
mod support;

const CATALOG: &str = "/skills/organisations/org-a";
const INSTALL: &str = "/skills/organisations/org-a/install";
const STATUS: &str = "/skills/organisations/org-a/status";
const ASSIGNMENTS: &str = "/skills/organisations/org-a/assignments";
const IMPACTS: &str =
    "/engagements/engagement-a/skills/impacts?organisation_id=org-a&client_id=client-a";
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
    fn post(&self, route: &str, body: &Value) -> RequestBuilder {
        self.request(Method::POST, route)
            .header("Origin", &self.origin)
            .header("X-CSRF-Token", &self.csrf)
            .header("X-Expected-Actor", &self.actor)
            .header("Content-Type", "application/json")
            .body(body.to_string())
    }
    async fn read(&self, route: &str) -> Response {
        self.request(Method::GET, route).send().await.unwrap()
    }
    async fn command(&self, route: &str, body: &Value) -> Response {
        self.post(route, body).send().await.unwrap()
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
    assert_eq!(response.headers()["cache-control"], "no-store");
    assert_eq!(response.headers()["content-type"], "application/json");
    assert_eq!(response.headers()["x-content-type-options"], "nosniff");
    assert!(!response.headers().contains_key("set-cookie"));
    let status = response.status();
    let body = response.text().await.unwrap();
    assert_eq!(status, expected, "{body}");
    serde_json::from_str(&body).unwrap()
}
async fn refused(response: Response, expected: StatusCode, code: &str) {
    assert_eq!(document(response, expected).await, json!({"error":code}));
}
fn route(task: &Value, suffix: &str) -> String {
    format!(
        "/engagements/engagement-a/tasks/{}/skills{suffix}?organisation_id=org-a&client_id=client-a",
        task["task_id"].as_str().unwrap()
    )
}
fn candidate<'a>(discovery: &'a Value, skill: &str) -> &'a Value {
    discovery["candidates"]
        .as_array()
        .unwrap()
        .iter()
        .find(|candidate| candidate["version"]["command"]["manifest"]["id"] == skill)
        .unwrap()
}
fn install(key: &str, revision: &str, skill: &str) -> Value {
    json!({
        "key":key,"expected_revision":revision,
        "assignment":{"kind":"firm","client_id":null,"engagement_id":null},
        "applicability":{"audit_area":null,"period_start":null,"period_end":null},
        "enabled":true,
        "manifest":{
            "schema_version":1,"id":skill,"version":"v1","name":"Recorded audit technique",
            "description":"A selected technique records the basis; no script or model is run.",
            "source":{"reference":"firm-reviewed-package","revision":"exact-source-revision","license":"Internal firm use"},
            "inputs":[{"id":"basis","label":"Reviewed basis","required":true}],
            "outputs":["Attributable technique choice"],"needs":[],"method_version_ids":[],
            "resources":[{"id":"guide","kind":"text","content":"Preserve exact text: café, e\u{301}, 日本語.\nA second line.\n"}]
        }
    })
}
fn tool_need(tool: &str) -> Value {
    json!({"id":"required-tool","tool":tool,"account_id":null,"environment_id":null,"destination":null,"resource_id":null,"recipients":[],"attachment_classifications":[],"requires_attachments":false})
}
fn select(key: &str, version: &Value, discovery: &Value) -> Value {
    json!({
        "key":key,"version_id":version,"reason":"Choose the exact installed technique; preserve all method requirements.",
        "expected_catalog_revision":discovery["catalog_revision"],
        "expected_methodology_binding_id":discovery["methodology_binding_id"],
        "expected_execution_epoch":discovery["execution_epoch"],
        "expected_selection_revision":discovery["selection_revision"]
    })
}
fn status(key: &str, revision: &str, version: &Value, value: &str) -> Value {
    json!({"key":key,"expected_revision":revision,"version_id":version,"status":value,"reason":"Current explicit firm catalog restriction"})
}
async fn create(browser: &Browser, key: &str, content: &str) -> Value {
    document(
        browser
            .command(
                CREATE,
                &json!({
                    "key":key,"kind":"create","task_id":null,"cycle_id":null,"content":content
                }),
            )
            .await,
        StatusCode::ACCEPTED,
    )
    .await
}

async fn fixture(config: &support::Configuration, admin: &mut PgConnection, issuer: &str) {
    let mut migration = PgConnection::connect_with(&database_options(&config.migration).unwrap())
        .await
        .unwrap();
    config.guard_connection(&mut migration).await;
    migration.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT USAGE ON SCHEMA public TO PUBLIC; REVOKE CREATE ON SCHEMA public FROM PUBLIC;").await.unwrap();
    let owns: bool = sqlx::query_scalar("SELECT nspowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user) FROM pg_catalog.pg_namespace WHERE nspname='public'")
        .fetch_one(&mut migration).await.unwrap();
    assert!(owns, "test reset preserves migration ownership");
    migration.close().await.unwrap();
    config.guard_connection(admin).await;
    let runtime_role = database_options(&config.runtime)
        .unwrap()
        .get_username()
        .to_owned();
    migrate(&config.migration, &runtime_role).await.unwrap();
    let mut tx = admin.begin().await.unwrap();
    sqlx::query("INSERT INTO public.identities(id,issuer,subject,display_name) VALUES('identity-admin',$1,'admin','Admin'),('identity-combined',$1,'combined','Accountable'),('identity-auditor',$1,'auditor','Selector'),('identity-foreign',$1,'foreign','Foreign')")
        .bind(issuer).execute(&mut *tx).await.unwrap();
    tx.execute("INSERT INTO public.organisations(id,name) VALUES('org-a','Northstar'),('org-b','Private foreign organisation');
        INSERT INTO public.clients(organisation_id,id,name) VALUES('org-a','client-a','Alder'),('org-a','client-other','Private second client'),('org-b','client-b','Private foreign client');
        INSERT INTO public.engagements(organisation_id,client_id,id,name) VALUES('org-a','client-a','engagement-a','Audit A'),('org-a','client-other','engagement-other','Private other engagement'),('org-b','client-b','engagement-b','Private foreign engagement');
        INSERT INTO public.organisation_memberships(organisation_id,actor_id,roles) VALUES('org-a','identity-admin',ARRAY['admin']),('org-a','identity-combined',ARRAY['admin','auditor']),('org-a','identity-auditor',ARRAY['auditor']),('org-b','identity-foreign',ARRAY['admin','auditor']);
        INSERT INTO public.engagement_assignments(organisation_id,client_id,engagement_id,actor_id) VALUES('org-a','client-a','engagement-a','identity-admin'),('org-a','client-a','engagement-a','identity-combined'),('org-a','client-a','engagement-a','identity-auditor'),('org-b','client-b','engagement-b','identity-foreign');")
        .await.unwrap();
    tx.commit().await.unwrap();
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
    }
    for (name, value) in [
        ("origin", "https://foreign.invalid"),
        ("x-csrf-token", "stale"),
        ("x-expected-actor", "identity-foreign"),
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
    for name in ["origin", "x-csrf-token", "x-expected-actor"] {
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
    let mut request = browser.post(route, body).build().unwrap();
    request
        .headers_mut()
        .insert("x-expected-session", HeaderValue::from_static("obsolete"));
    refused(
        browser.client.execute(request).await.unwrap(),
        StatusCode::PRECONDITION_FAILED,
        "session_changed",
    )
    .await;
}

async fn read_session_fences(browser: &Browser, route: &str) {
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
    let mut optional = browser.request(Method::GET, route).build().unwrap();
    optional.headers_mut().remove("x-expected-session");
    document(
        browser.client.execute(optional).await.unwrap(),
        StatusCode::OK,
    )
    .await;
    let mut unauthenticated = browser.request(Method::GET, route).build().unwrap();
    unauthenticated.headers_mut().remove("cookie");
    refused(
        browser.client.execute(unauthenticated).await.unwrap(),
        StatusCode::UNAUTHORIZED,
        "authentication_required",
    )
    .await;
}

async fn execution_counts(connection: &mut PgConnection) -> Value {
    sqlx::query_scalar("SELECT jsonb_build_object('operations',(SELECT count(*) FROM public.operations),'decisions',(SELECT count(*) FROM public.operation_decisions),'operation_claims',(SELECT count(*) FROM public.operation_claims),'task_claims',(SELECT count(*) FROM public.task_claims),'task_wakeups',(SELECT count(*) FROM public.task_wakeups),'task_events',(SELECT count(*) FROM public.task_events),'source_receipts',(SELECT count(*) FROM public.operation_receipts))")
        .fetch_one(connection).await.unwrap()
}

async fn seed_authority(database: &RuntimeDatabase, task: &Value) -> AuthoritySnapshot {
    let scope = Scope {
        organisation_id: "org-a".into(),
        client_id: "client-a".into(),
        engagement_id: "engagement-a".into(),
    };
    let task_id = task["task_id"].as_str().unwrap();
    let rule = PermissionRule {
        purpose: Purpose::LiveInspection,
        action: Action::Read,
        account_id: "live-account".into(),
        environment_id: "live-environment".into(),
        destination: "owned-endpoint".into(),
        resource_id: "resource".into(),
        recipients: vec![],
        attachment_classifications: vec![],
        expires_at: 4_102_444_800,
    };
    let policy = |kind, subject: &str| PolicyDocument {
        schema_version: 1,
        kind,
        subject_id: subject.into(),
        version: 1,
        actor_id: "identity-combined".into(),
        created_at: 1,
        revoked: false,
        hard: PermissionBounds {
            rules: vec![rule.clone()],
        },
        standing: PermissionBounds { rules: vec![] },
        account: None,
        parent: None,
    };
    let mut account = policy(PolicyKind::Account, "live-account");
    account.account = Some(AccountRestriction {
        source: SourceBinding {
            source_id: "http-source".into(),
            ledger_id: "http-ledger".into(),
            endpoint_digest: "a".repeat(64),
            contract_version: 1,
        },
        account_id: "live-account".into(),
        environment_id: "live-environment".into(),
        environment: EnvironmentKind::Live,
        read_restriction: ReadRestriction::SourceReadOnly,
        restriction_survives_takeover: true,
        test_environment_verified: false,
        test_resources: vec![],
        test_cleanup_id: None,
        audit_resources: vec![],
    });
    let authority = AuthoritySnapshot {
        scope: scope.clone(),
        actor_id: "identity-combined".into(),
        task_id: task_id.into(),
        organisation: policy(PolicyKind::Organisation, "org-a"),
        engagement: policy(PolicyKind::Engagement, "engagement-a"),
        member: policy(PolicyKind::Member, "identity-combined"),
        account,
        task: policy(PolicyKind::Task, task_id),
        delegations: vec![],
    };
    let operations = OperationRepository::new(database.pool().clone());
    for policy in authority.documents().filter(|p| p.kind != PolicyKind::Task) {
        operations
            .save_policy("identity-combined", &scope, policy)
            .await
            .unwrap();
    }
    operations
        .accept_authority("identity-combined", &scope, task_id, &authority)
        .await
        .unwrap();
    authority
}

async fn read_headers(stream: &mut tokio::net::TcpStream) -> Vec<u8> {
    let mut bytes = Vec::new();
    while !bytes.ends_with(b"\r\n\r\n") {
        bytes.push(stream.read_u8().await.unwrap());
        assert!(bytes.len() <= 16_384);
    }
    bytes
}

/// The proxy waits for the committed response and discards the acknowledgement.
/// The caller must recover through scoped HTTP; no receipt is injected into it.
async fn lose_selection_ack(browser: &Browser, route: &str, body: &Value) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = format!("http://{}", listener.local_addr().unwrap());
    let upstream = browser.address.strip_prefix("http://").unwrap().to_owned();
    let proxy = tokio::spawn(async move {
        let (mut downstream, _) = listener.accept().await.unwrap();
        let head = read_headers(&mut downstream).await;
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
        assert!(length < 16_384);
        let mut body = vec![0; length];
        downstream.read_exact(&mut body).await.unwrap();
        let mut upstream = tokio::net::TcpStream::connect(upstream).await.unwrap();
        upstream.write_all(&head).await.unwrap();
        upstream.write_all(&body).await.unwrap();
        let mut response = Vec::new();
        upstream.read_to_end(&mut response).await.unwrap();
        assert!(
            response.starts_with(b"HTTP/1.1 200 "),
            "selection must commit before acknowledgement loss"
        );
        drop(downstream);
    });
    let interrupted = Browser {
        address,
        ..browser.clone()
    };
    assert!(
        interrupted
            .post(route, body)
            .header("Connection", "close")
            .send()
            .await
            .is_err()
    );
    tokio::time::timeout(Duration::from_secs(3), proxy)
        .await
        .unwrap()
        .unwrap();
}

async fn logout_while_waiting(
    browser: &Browser,
    identities: &IdentityRepository,
    issuer: &str,
    config: &support::Configuration,
    connection: &mut PgConnection,
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
            .fetch_one(&mut *connection).await.unwrap();
        if blocked {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "HTTP request did not reach real organisation lock"
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

async fn mixed_ascii_task_impact_pages(
    connection: &mut PgConnection,
    admin: &Browser,
    auditor: &Browser,
    source_task: &Value,
) {
    // Controlled fresh Task/binding fixtures let the actual HTTP select path
    // produce receipts for IDs that random hex Task IDs can never exercise.
    let ids = [
        "mixed-impact-",
        "mixed-impact0",
        "mixed-impactA",
        "mixed-impactZ",
        "mixed-impact_",
        "mixed-impacta",
        "mixed-impactz",
    ];
    let mut tx = connection.begin().await.unwrap();
    let source_epoch: i64 = sqlx::query_scalar("SELECT (b.document->>'execution_epoch')::bigint FROM public.task_methodology_heads h JOIN public.task_methodology_bindings b ON (b.organisation_id,b.task_id,b.id)=(h.organisation_id,h.task_id,h.binding_id) WHERE h.organisation_id='org-a' AND h.task_id=$1")
        .bind(source_task["task_id"].as_str().unwrap()).fetch_one(&mut *tx).await.unwrap();
    assert_eq!(
        source_epoch, 1,
        "fresh Tasks retain the neutral fixture binding epoch"
    );
    sqlx::query("INSERT INTO public.tasks(organisation_id,client_id,engagement_id,id,cycle_id,accountable_actor,objective,working_brief,state,cessation) SELECT organisation_id,client_id,engagement_id,selected.id,'cycle-'||selected.id,accountable_actor,'Mixed ASCII cursor fixture','Mixed ASCII cursor fixture','ready','none' FROM public.tasks t CROSS JOIN unnest($2::text[]) selected(id) WHERE t.id=$1")
        .bind(source_task["task_id"].as_str().unwrap()).bind(ids.as_slice()).execute(&mut *tx).await.unwrap();
    sqlx::query("INSERT INTO public.task_cycles(organisation_id,client_id,engagement_id,task_id,id,status) SELECT organisation_id,client_id,engagement_id,id,cycle_id,'active' FROM public.tasks WHERE id=ANY($1)")
        .bind(ids.as_slice()).execute(&mut *tx).await.unwrap();
    sqlx::query("INSERT INTO public.task_methodology_bindings(organisation_id,client_id,engagement_id,task_id,id,document) SELECT b.organisation_id,b.client_id,b.engagement_id,selected.id,'binding-'||selected.id,jsonb_set(b.document,'{id}',to_jsonb('binding-'||selected.id)) FROM public.task_methodology_heads h JOIN public.task_methodology_bindings b ON (b.organisation_id,b.task_id,b.id)=(h.organisation_id,h.task_id,h.binding_id) CROSS JOIN unnest($2::text[]) selected(id) WHERE h.organisation_id='org-a' AND h.task_id=$1")
        .bind(source_task["task_id"].as_str().unwrap()).bind(ids.as_slice()).execute(&mut *tx).await.unwrap();
    sqlx::query("INSERT INTO public.task_methodology_heads(organisation_id,task_id,binding_id,context,pending_context_command,pending_context_at) SELECT organisation_id,task_id,id,document->'resolution'->'context',NULL,NULL FROM public.task_methodology_bindings WHERE task_id=ANY($1)")
        .bind(ids.as_slice()).execute(&mut *tx).await.unwrap();
    tx.commit().await.unwrap();
    let side_effects = execution_counts(connection).await;
    let catalog = document(admin.read(CATALOG).await, StatusCode::OK).await;
    let command = install(
        "mixed-impact-version",
        catalog["revision"].as_str().unwrap(),
        "mixed-impact-technique",
    );
    let installed = document(admin.command(INSTALL, &command).await, StatusCode::OK).await;
    for (position, task_id) in ids.iter().enumerate() {
        let task = json!({"task_id":task_id});
        let mut discovery = document(auditor.read(&route(&task, "")).await, StatusCode::OK).await;
        for index in 0..if position == 0 { 48 } else { 1 } {
            let command = select(
                &format!("mixed-select-{index}"),
                &installed["version_id"],
                &discovery,
            );
            let selected = document(
                auditor.command(&route(&task, "/select"), &command).await,
                StatusCode::OK,
            )
            .await;
            discovery["selection_revision"] = selected["selection"]["revision"].clone();
        }
    }
    let restriction = status(
        "mixed-impact-disable",
        installed["revision"].as_str().unwrap(),
        &installed["version_id"],
        "disabled",
    );
    let disabled = document(admin.command(STATUS, &restriction).await, StatusCode::OK).await;
    assert_eq!(disabled["affected_selections"], "54");
    let path = format!(
        "{IMPACTS}&version_id={}",
        installed["version_id"].as_str().unwrap()
    );
    let first = document(auditor.read(&path).await, StatusCode::OK).await;
    assert_eq!(first["selections"].as_array().unwrap().len(), 50);
    assert_eq!(
        first["next_after"],
        json!({"task_id":"mixed-impactA","revision":"1"})
    );
    let second = document(
        auditor
            .read(&format!(
                "{path}&after_task_id=mixed-impactA&after_revision=1"
            ))
            .await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(second["selections"].as_array().unwrap().len(), 4);
    assert!(second["next_after"].is_null());
    let actual: Vec<_> = first["selections"]
        .as_array()
        .unwrap()
        .iter()
        .chain(second["selections"].as_array().unwrap())
        .map(|row| {
            (
                row["task_id"].as_str().unwrap().to_owned(),
                row["selection_revision"]
                    .as_str()
                    .unwrap()
                    .parse::<u64>()
                    .unwrap(),
            )
        })
        .collect();
    let mut expected: Vec<_> = (1..=48)
        .map(|revision| ("mixed-impact-".to_owned(), revision))
        .collect();
    expected.extend(
        [
            ("mixed-impact0", 1),
            ("mixed-impactA", 1),
            ("mixed-impactZ", 1),
            ("mixed-impact_", 1),
            ("mixed-impacta", 1),
            ("mixed-impactz", 1),
        ]
        .map(|(id, revision)| (id.to_owned(), revision)),
    );
    assert_eq!(
        actual, expected,
        "complete response order follows literal ASCII Task IDs and numeric revisions across the cursor boundary"
    );
    assert_eq!(execution_counts(connection).await, side_effects);
}

async fn paged_configuration_and_scoped_impact(
    connection: &mut PgConnection,
    admin: &Browser,
    auditor: &Browser,
    combined: &Browser,
    foreign: &Browser,
    task: &Value,
) {
    connection.execute("INSERT INTO public.clients(organisation_id,id,name) SELECT 'org-a','empty-client-'||lpad(n::text,3,'0'),'Client without engagements '||n FROM generate_series(1,60) n;
        INSERT INTO public.clients(organisation_id,id,name) SELECT 'org-a',id,'Mixed ASCII client' FROM unnest(ARRAY['empty-client-044z','empty-client-044_','empty-client-044A','empty-client-044-','empty-client-044a','empty-client-044Z','empty-client-0440']) id;
        INSERT INTO public.engagements(organisation_id,client_id,id,name) SELECT 'org-a','client-a','paged-engagement-'||lpad(n::text,3,'0'),'Assignment choice '||n FROM generate_series(1,513) n;
        INSERT INTO public.engagements(organisation_id,client_id,id,name) SELECT 'org-a','client-a',id,'Mixed ASCII engagement' FROM unnest(ARRAY['paged-engagement-047z','paged-engagement-047_','paged-engagement-047A','paged-engagement-047-','paged-engagement-047a','paged-engagement-047Z','paged-engagement-0470']) id;
        INSERT INTO public.engagement_assignments(organisation_id,client_id,engagement_id,actor_id) VALUES('org-a','client-other','engagement-other','identity-combined')").await.unwrap();
    let catalog = document(admin.read(CATALOG).await, StatusCode::OK).await;
    assert_eq!(catalog["revision"], "6");
    assert_eq!(catalog["versions"].as_array().unwrap().len(), 4);
    assert!(catalog.get("engagements").is_none());
    assert!(!catalog.to_string().contains("task_id"));
    let mut client_ids = std::collections::BTreeSet::new();
    let mut ordered_clients = Vec::new();
    let mut next: Option<String> = None;
    loop {
        let path = format!(
            "{ASSIGNMENTS}?kind=client{}",
            next.as_ref()
                .map(|id| format!("&after={id}"))
                .unwrap_or_default()
        );
        let page = document(admin.read(&path).await, StatusCode::OK).await;
        assert_eq!(page["engagements"], json!([]));
        let items = page["clients"].as_array().unwrap();
        assert!(items.len() <= 50);
        for item in items {
            assert!(client_ids.insert(item["client_id"].as_str().unwrap().to_owned()));
            ordered_clients.push(item["client_id"].as_str().unwrap().to_owned());
        }
        next = page["next_after"].as_str().map(str::to_owned);
        if next.is_some() {
            assert_eq!(next.as_deref(), ordered_clients.last().map(String::as_str));
            assert_eq!(next.as_deref(), Some("empty-client-044Z"));
        }
        if next.is_none() {
            break;
        }
    }
    // Independent literal ASCII expectation: punctuation, digits, capitals,
    // underscore, then lowercase. Never sort the server result to hide a defect.
    let mut expected_clients = vec!["client-a".to_owned(), "client-other".to_owned()];
    expected_clients.extend((1..=44).map(|n| format!("empty-client-{n:03}")));
    expected_clients.extend(
        [
            "empty-client-044-",
            "empty-client-0440",
            "empty-client-044A",
            "empty-client-044Z",
            "empty-client-044_",
            "empty-client-044a",
            "empty-client-044z",
        ]
        .map(str::to_owned),
    );
    expected_clients.extend((45..=60).map(|n| format!("empty-client-{n:03}")));
    assert_eq!(ordered_clients, expected_clients);
    assert_eq!(client_ids.len(), 69);
    assert!(client_ids.contains("empty-client-060"));
    let empty = document(
        admin
            .read(&format!(
                "{ASSIGNMENTS}?kind=engagement&client_id=empty-client-060"
            ))
            .await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(empty["engagements"], json!([]));
    let mut engagement_ids = std::collections::BTreeSet::new();
    let mut ordered_engagements = Vec::new();
    loop {
        let path = format!(
            "{ASSIGNMENTS}?kind=engagement&client_id=client-a{}",
            next.as_ref()
                .map(|id| format!("&after={id}"))
                .unwrap_or_default()
        );
        let page = document(admin.read(&path).await, StatusCode::OK).await;
        assert_eq!(page["clients"], json!([]));
        let items = page["engagements"].as_array().unwrap();
        assert!(items.len() <= 50);
        for item in items {
            assert!(engagement_ids.insert(item["engagement_id"].as_str().unwrap().to_owned()));
            ordered_engagements.push(item["engagement_id"].as_str().unwrap().to_owned());
        }
        next = page["next_after"].as_str().map(str::to_owned);
        if next.is_some() {
            assert_eq!(
                next.as_deref(),
                ordered_engagements.last().map(String::as_str)
            );
            if ordered_engagements.len() == 50 {
                assert_eq!(next.as_deref(), Some("paged-engagement-0470"));
            }
        }
        if next.is_none() {
            break;
        }
    }
    let mut expected_engagements = vec!["engagement-a".to_owned()];
    expected_engagements.extend((1..=47).map(|n| format!("paged-engagement-{n:03}")));
    expected_engagements.extend(
        [
            "paged-engagement-047-",
            "paged-engagement-0470",
            "paged-engagement-047A",
            "paged-engagement-047Z",
            "paged-engagement-047_",
            "paged-engagement-047a",
            "paged-engagement-047z",
        ]
        .map(str::to_owned),
    );
    expected_engagements.extend((48..=513).map(|n| format!("paged-engagement-{n:03}")));
    assert_eq!(ordered_engagements, expected_engagements);
    assert_eq!(engagement_ids.len(), 521);
    for suffix in [
        "?kind=invalid",
        "?kind=client&client_id=client-a",
        "?kind=engagement",
        "?kind=client&after=../invalid",
        "?kind=client&unexpected=true",
    ] {
        refused(
            admin.read(&format!("{ASSIGNMENTS}{suffix}")).await,
            StatusCode::BAD_REQUEST,
            "invalid_skill",
        )
        .await;
    }
    let assignments = format!("{ASSIGNMENTS}?kind=client");
    read_session_fences(admin, &assignments).await;
    for actor in [auditor, foreign] {
        refused(
            actor.read(&assignments).await,
            StatusCode::FORBIDDEN,
            "access_denied",
        )
        .await;
    }

    let command = install("paged-version", "6", "paged-technique");
    let installed = document(admin.command(INSTALL, &command).await, StatusCode::OK).await;
    let version_id = installed["version_id"].as_str().unwrap();
    let history_path = format!("{CATALOG}/versions/{version_id}/history");
    let initial_history = document(admin.read(&history_path).await, StatusCode::OK).await;
    assert_eq!(initial_history["events"].as_array().unwrap().len(), 1);
    assert_eq!(
        initial_history["events"][0]["event_id"],
        installed["event_id"]
    );
    assert_eq!(initial_history["events"][0]["actor_id"], admin.actor);
    assert!(initial_history["events"][0]["reason"].is_null());
    assert_eq!(initial_history["events"][0]["revision"], "7");

    let other_create = CREATE
        .replace("engagement-a", "engagement-other")
        .replace("client_id=client-a", "client_id=client-other");
    let other_task = document(combined.command(&other_create, &json!({"key":"private-impact-task","kind":"create","task_id":null,"cycle_id":null,"content":"Private task in a different engagement"})).await, StatusCode::ACCEPTED).await;
    let other_route = route(&other_task, "")
        .replace("engagement-a", "engagement-other")
        .replace("client_id=client-a", "client_id=client-other");
    let other_discovery = document(combined.read(&other_route).await, StatusCode::OK).await;
    let other_command = select(
        "private-impact-selection",
        &installed["version_id"],
        &other_discovery,
    );
    document(
        combined
            .command(
                &other_route.replace("/skills?", "/skills/select?"),
                &other_command,
            )
            .await,
        StatusCode::OK,
    )
    .await;
    let side_effects = execution_counts(connection).await;
    let mut discovery = document(auditor.read(&route(task, "")).await, StatusCode::OK).await;
    let mut first_selection = None;
    let mut first_select_command = None;
    for index in 0..51 {
        let command = select(
            &format!("impact-selection-{index}"),
            &installed["version_id"],
            &discovery,
        );
        let selected = document(
            auditor.command(&route(task, "/select"), &command).await,
            StatusCode::OK,
        )
        .await;
        discovery["selection_revision"] = selected["selection"]["revision"].clone();
        if index == 0 {
            first_selection = Some(selected["selection"].clone());
            first_select_command = Some(command);
        }
    }
    let enabled = document(auditor.read(IMPACTS).await, StatusCode::OK).await;
    assert_eq!(
        enabled["selections"].as_array().unwrap().len(),
        1,
        "unfiltered impact includes only the previously recalled version while the new version is enabled"
    );
    let enabled_filter = document(
        auditor
            .read(&format!("{IMPACTS}&version_id={version_id}"))
            .await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(enabled_filter["selections"].as_array().unwrap().len(), 50);
    assert_eq!(enabled_filter["selections"][0]["status"], "enabled");

    let mut first_status = None;
    let mut final_receipt = Value::Null;
    for index in 0..51 {
        let mut command = status(
            &format!("paged-status-{index}"),
            &(7 + index).to_string(),
            &installed["version_id"],
            if index % 2 == 0 {
                "disabled"
            } else {
                "enabled"
            },
        );
        command["reason"] = json!(format!("Attributable configuration change {index}: 😀"));
        final_receipt = document(admin.command(STATUS, &command).await, StatusCode::OK).await;
        if index == 0 {
            first_status = Some((command, final_receipt.clone()));
        }
    }
    assert_eq!(final_receipt["revision"], "58");
    assert_eq!(final_receipt["affected_selections"], "52");
    let (first_command, first_receipt) = first_status.unwrap();
    assert_eq!(
        document(admin.command(STATUS, &first_command).await, StatusCode::OK).await,
        first_receipt,
        "old status retry preserves its immutable receipt"
    );
    assert_eq!(
        document(admin.command(INSTALL, &command).await, StatusCode::OK).await,
        installed
    );
    let reloaded = document(admin.read(CATALOG).await, StatusCode::OK).await;
    assert_eq!(reloaded["revision"], "58");
    let version = reloaded["versions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|version| version["id"] == version_id)
        .unwrap();
    assert_eq!(version["status"], "disabled");
    assert_eq!(version["status_event"]["actor_id"], admin.actor);
    assert_eq!(
        version["status_event"]["event_id"],
        final_receipt["event_id"]
    );
    assert_eq!(
        version["status_event"]["reason"],
        "Attributable configuration change 50: 😀"
    );
    assert_eq!(version["status_event"]["revision"], "58");
    assert!(version["status_event"]["recorded_at"].as_i64().unwrap() > 0);
    let history = document(admin.read(&history_path).await, StatusCode::OK).await;
    assert_eq!(history["events"].as_array().unwrap().len(), 50);
    assert_eq!(history["events"][0], version["status_event"]);
    assert_eq!(history["next_before_revision"], "9");
    let earlier = document(
        admin
            .read(&format!("{history_path}?before_revision=9"))
            .await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(earlier["events"].as_array().unwrap().len(), 2);
    assert_eq!(earlier["events"][1], initial_history["events"][0]);
    assert!(earlier["next_before_revision"].is_null());
    assert!(!history.to_string().contains("task_id"));
    read_session_fences(admin, &history_path).await;
    for actor in [auditor, foreign] {
        refused(
            actor.read(&history_path).await,
            StatusCode::FORBIDDEN,
            "access_denied",
        )
        .await;
    }
    for before in ["0", "01", "-1", "9223372036854775808"] {
        refused(
            admin
                .read(&format!("{history_path}?before_revision={before}"))
                .await,
            StatusCode::BAD_REQUEST,
            "invalid_skill",
        )
        .await;
    }

    let impacts = document(auditor.read(IMPACTS).await, StatusCode::OK).await;
    assert_eq!(impacts["selections"].as_array().unwrap().len(), 50);
    assert!(impacts["version_id"].is_null());
    assert!(
        !impacts
            .to_string()
            .contains(other_task["task_id"].as_str().unwrap())
    );
    let cursor = &impacts["next_after"];
    let next_path = format!(
        "{IMPACTS}&after_task_id={}&after_revision={}",
        cursor["task_id"].as_str().unwrap(),
        cursor["revision"].as_str().unwrap()
    );
    let rest = document(auditor.read(&next_path).await, StatusCode::OK).await;
    assert_eq!(rest["selections"].as_array().unwrap().len(), 2);
    assert!(rest["next_after"].is_null());
    let mut revisions = std::collections::BTreeSet::new();
    for row in impacts["selections"]
        .as_array()
        .unwrap()
        .iter()
        .chain(rest["selections"].as_array().unwrap())
    {
        assert_eq!(row["task_id"], task["task_id"]);
        assert!(revisions.insert(row["selection_revision"].as_str().unwrap().to_owned()));
        assert!(row.get("methodology").is_none());
        assert!(row.get("reason").is_none());
        assert!(row.get("authority_actor_id").is_none());
    }
    assert_eq!(revisions.len(), 52);
    let first_selection = first_selection.unwrap();
    let row = impacts["selections"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["selection_id"] == first_selection["id"])
        .unwrap();
    assert_eq!(row["digest"], first_selection["digest"]);
    assert_eq!(
        row["methodology_binding_id"],
        first_selection["methodology"]["id"]
    );
    assert_eq!(row["execution_epoch"], first_selection["execution_epoch"]);
    assert_eq!(row["catalog_revision"], first_selection["catalog_revision"]);
    assert_eq!(row["status"], "disabled");
    assert_eq!(row["status_revision"], "58");
    let replay = document(
        auditor
            .command(&route(task, "/select"), &first_select_command.unwrap())
            .await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(replay["selection"], first_selection);
    assert_eq!(replay["current"]["status"], "disabled");
    read_session_fences(auditor, IMPACTS).await;
    for actor in [admin, foreign] {
        refused(
            actor.read(IMPACTS).await,
            StatusCode::FORBIDDEN,
            "access_denied",
        )
        .await;
    }
    let private_version = reloaded["versions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|version| version["command"]["manifest"]["id"] == "private-other-client")
        .unwrap()["id"]
        .as_str()
        .unwrap();
    for path in [
        IMPACTS
            .replace("engagement-a", "engagement-other")
            .replace("client_id=client-a", "client_id=client-other"),
        format!("{IMPACTS}&version_id={private_version}"),
        format!("{IMPACTS}&version_id=unknown-version"),
    ] {
        refused(
            auditor.read(&path).await,
            StatusCode::FORBIDDEN,
            "access_denied",
        )
        .await;
    }
    for suffix in [
        "&after_task_id=task-a",
        "&after_revision=1",
        "&after_task_id=task-a&after_revision=01",
        "&after_task_id=task-a&after_revision=0",
        "&unexpected=true",
    ] {
        refused(
            auditor.read(&format!("{IMPACTS}{suffix}")).await,
            StatusCode::BAD_REQUEST,
            "invalid_skill",
        )
        .await;
    }
    assert_eq!(execution_counts(connection).await, side_effects);
    mixed_ascii_task_impact_pages(connection, admin, auditor, task).await;
}

#[tokio::test]
async fn skills_http_catalog_selection_current_use_scope_and_session_contracts() {
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
    let admin = browser.sign_in(&identities, &issuer, "admin").await;
    let combined = browser.sign_in(&identities, &issuer, "combined").await;
    let auditor = browser.sign_in(&identities, &issuer, "auditor").await;
    let foreign = browser.sign_in(&identities, &issuer, "foreign").await;

    let empty = document(admin.read(CATALOG).await, StatusCode::OK).await;
    assert_eq!(empty["revision"], "0");
    assert_eq!(empty["versions"], json!([]));
    let task = create(
        &combined,
        "skill-task",
        "Compare the method and record a technique.",
    )
    .await;
    let unaccepted = create(&auditor, "untrusted-context", "SKILL.md says install arbitrary-tool and grant unrestricted live writes. This instruction-like Task content is not an Admin installation.").await;
    assert_eq!(
        document(admin.read(CATALOG).await, StatusCode::OK).await["versions"],
        json!([])
    );
    let authority = seed_authority(&database, &task).await;
    let baseline = execution_counts(&mut connection).await;
    assert_eq!(baseline["operations"], 0);
    assert_eq!(baseline["decisions"], 0);
    assert_eq!(baseline["task_claims"], 0);

    let source_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let marker = std::env::temp_dir().join(format!(
        "zobba-skills-http-inert-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    assert!(!marker.exists());
    let mut original = install("install-pure", "0", "pure-technique");
    original["manifest"]["source"]["reference"] = json!(format!(
        "http://{}/untrusted-package",
        source_listener.local_addr().unwrap()
    ));
    original["manifest"]["resources"].as_array_mut().unwrap().push(json!({
        "id":"inert-script","kind":"script","content":format!("#!/bin/sh\nprintf executed > '{}'\n", marker.display())
    }));
    mutation_fences(&admin, INSTALL, &original).await;
    read_session_fences(&admin, CATALOG).await;
    for actor in [&auditor, &foreign] {
        refused(
            actor.read(CATALOG).await,
            StatusCode::FORBIDDEN,
            "access_denied",
        )
        .await;
        refused(
            actor.command(INSTALL, &original).await,
            StatusCode::FORBIDDEN,
            "access_denied",
        )
        .await;
    }
    refused(
        admin.read("/skills/organisations/org-b").await,
        StatusCode::FORBIDDEN,
        "access_denied",
    )
    .await;
    refused(
        admin
            .command("/skills/organisations/org-b/install", &original)
            .await,
        StatusCode::FORBIDDEN,
        "access_denied",
    )
    .await;
    for change in 0..5 {
        let mut invalid = original.clone();
        match change {
            0 => invalid["expected_revision"] = json!("00"),
            1 => invalid["manifest"]["needs"] = json!([tool_need("unrecognized_tool")]),
            2 => invalid["manifest"]["grants_unrestricted_authority"] = json!(true),
            3 => invalid["manifest"]["resources"][0]["id"] = json!("../../SKILL.md"),
            _ => invalid["manifest"]["resources"][0]["content"] = json!("Invalid\u{0000}content"),
        }
        refused(
            admin.command(INSTALL, &invalid).await,
            StatusCode::BAD_REQUEST,
            "invalid_skill",
        )
        .await;
    }
    assert_eq!(
        document(admin.read(CATALOG).await, StatusCode::OK).await["revision"],
        "0"
    );
    let installed = document(admin.command(INSTALL, &original).await, StatusCode::OK).await;
    assert_eq!(installed["revision"], "1");
    assert_eq!(installed["actor_id"], admin.actor);
    assert_eq!(
        installed,
        document(admin.command(INSTALL, &original).await, StatusCode::OK).await
    );
    let mut changed = original.clone();
    changed["manifest"]["resources"][0]["content"] = json!("Changed immutable content");
    refused(
        admin.command(INSTALL, &changed).await,
        StatusCode::CONFLICT,
        "skill_conflict",
    )
    .await;
    changed["key"] = json!("stale-install");
    refused(
        admin.command(INSTALL, &changed).await,
        StatusCode::CONFLICT,
        "skill_conflict",
    )
    .await;
    changed["expected_revision"] = json!("1");
    refused(
        admin.command(INSTALL, &changed).await,
        StatusCode::CONFLICT,
        "skill_conflict",
    )
    .await;
    let catalog = document(admin.read(CATALOG).await, StatusCode::OK).await;
    let version = &catalog["versions"][0];
    assert_eq!(version["command"], original);
    assert_eq!(version["status"], "enabled");
    let manifest: zobba_application::skills::Manifest =
        serde_json::from_value(original["manifest"].clone()).unwrap();
    assert_eq!(
        version["digest"],
        format!("{:x}", Sha256::digest(manifest.canonical_bytes().unwrap()))
    );
    for (resource, recorded) in original["manifest"]["resources"]
        .as_array()
        .unwrap()
        .iter()
        .zip(version["resource_digests"].as_array().unwrap())
    {
        assert_eq!(resource["id"], recorded["id"]);
        assert_eq!(
            recorded["digest"],
            format!(
                "{:x}",
                Sha256::digest(resource["content"].as_str().unwrap().as_bytes())
            )
        );
    }

    let mut live = install("install-live", "1", "live-technique");
    live["manifest"]["needs"] = json!([tool_need("live_read_v1")]);
    let live_receipt = document(admin.command(INSTALL, &live).await, StatusCode::OK).await;
    let mut analysis = install("install-analysis", "2", "analysis-technique");
    analysis["manifest"]["needs"] = json!([tool_need("analysis_v1")]);
    document(admin.command(INSTALL, &analysis).await, StatusCode::OK).await;
    let mut other_client = install("install-other-client", "3", "private-other-client");
    other_client["assignment"] =
        json!({"kind":"client","client_id":"client-other","engagement_id":null});
    document(admin.command(INSTALL, &other_client).await, StatusCode::OK).await;

    let discovered = document(auditor.read(&route(&task, "")).await, StatusCode::OK).await;
    assert_eq!(discovered["catalog_revision"], "4");
    assert_eq!(discovered["selection_revision"], "0");
    assert_eq!(discovered["candidates"].as_array().unwrap().len(), 3);
    assert!(!discovered.to_string().contains("private-other-client"));
    assert_eq!(
        candidate(&discovered, "pure-technique")["inspection"]["status"],
        "eligible"
    );
    assert_eq!(
        candidate(&discovered, "pure-technique")["inspection"]["authority_actor_id"],
        combined.actor
    );
    assert_eq!(
        candidate(&discovered, "live-technique")["inspection"]["status"],
        "unavailable"
    );
    assert_eq!(
        candidate(&discovered, "live-technique")["inspection"]["needs"][0]["status"],
        "unavailable"
    );
    assert_eq!(
        candidate(&discovered, "analysis-technique")["inspection"]["status"],
        "unavailable"
    );
    let missing_authority =
        document(auditor.read(&route(&unaccepted, "")).await, StatusCode::OK).await;
    assert_eq!(
        candidate(&missing_authority, "pure-technique")["inspection"]["status"],
        "eligible"
    );
    assert!(
        candidate(&missing_authority, "pure-technique")["inspection"]["authority_actor_id"]
            .is_null()
    );
    assert_eq!(
        candidate(&missing_authority, "live-technique")["inspection"]["status"],
        "unavailable"
    );

    let command = select("select-pure", &installed["version_id"], &discovered);
    let method_route = route(&task, "").replace("/skills?", "/methodology?");
    let original_method = document(auditor.read(&method_route).await, StatusCode::OK).await;
    mutation_fences(&auditor, &route(&task, "/select"), &command).await;
    read_session_fences(&auditor, &route(&task, "")).await;
    for actor in [&admin, &foreign] {
        refused(
            actor.read(&route(&task, "")).await,
            StatusCode::FORBIDDEN,
            "access_denied",
        )
        .await;
        refused(
            actor.command(&route(&task, "/select"), &command).await,
            StatusCode::FORBIDDEN,
            "access_denied",
        )
        .await;
    }
    for forged in [
        route(&task, "").replace("client_id=client-a", "client_id=client-other"),
        route(&task, "").replace("organisation_id=org-a", "organisation_id=org-b"),
        route(&task, "").replace("engagement-a", "engagement-other"),
        route(&task, "").replace(task["task_id"].as_str().unwrap(), "unknown-task"),
        format!("{}&authority_actor_id=identity-auditor", route(&task, "")),
    ] {
        refused(
            auditor.read(&forged).await,
            StatusCode::FORBIDDEN,
            "access_denied",
        )
        .await;
    }
    let mut forged = command.clone();
    forged["authority_actor_id"] = json!(auditor.actor);
    refused(
        auditor.command(&route(&task, "/select"), &forged).await,
        StatusCode::BAD_REQUEST,
        "invalid_skill",
    )
    .await;
    for field in [
        "expected_catalog_revision",
        "expected_execution_epoch",
        "expected_selection_revision",
        "expected_methodology_binding_id",
    ] {
        let mut stale = command.clone();
        stale[field] = if field.ends_with("binding_id") {
            json!("other-binding")
        } else {
            json!("999")
        };
        refused(
            auditor.command(&route(&task, "/select"), &stale).await,
            StatusCode::CONFLICT,
            "skill_conflict",
        )
        .await;
    }
    let unavailable_command = select(
        "select-unavailable",
        &live_receipt["version_id"],
        &discovered,
    );
    refused(
        auditor
            .command(&route(&task, "/select"), &unavailable_command)
            .await,
        StatusCode::CONFLICT,
        "skill_ineligible",
    )
    .await;
    lose_selection_ack(&auditor, &route(&task, "/select"), &command).await;
    let recovered = document(auditor.read(&route(&task, "")).await, StatusCode::OK).await;
    assert_eq!(recovered["selection_revision"], "1");
    assert_eq!(recovered["selections"].as_array().unwrap().len(), 1);
    let selected = document(
        auditor.command(&route(&task, "/select"), &command).await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(
        selected["selection"],
        recovered["selections"][0]["selection"]
    );
    assert_eq!(selected["selection"]["selector_id"], auditor.actor);
    assert_eq!(
        selected["selection"]["methodology"],
        original_method["current"]
    );
    assert_eq!(
        document(auditor.read(&method_route).await, StatusCode::OK).await["current"],
        original_method["current"]
    );
    assert_eq!(selected["selection"]["authority_actor_id"], combined.actor);
    assert_ne!(
        selected["selection"]["selector_id"],
        selected["selection"]["authority_actor_id"]
    );
    assert_eq!(selected["selection"]["version_id"], installed["version_id"]);
    assert_eq!(selected["selection"]["digest"], version["digest"]);
    assert_eq!(selected["selection"]["revision"], "1");
    assert_eq!(selected["current"]["status"], "eligible");
    assert_eq!(
        selected["selection"],
        document(
            auditor.command(&route(&task, "/select"), &command).await,
            StatusCode::OK
        )
        .await["selection"]
    );
    let mut different = command.clone();
    different["reason"] = json!("Changed exact meaning");
    refused(
        auditor.command(&route(&task, "/select"), &different).await,
        StatusCode::CONFLICT,
        "skill_conflict",
    )
    .await;
    let current_route = route(
        &task,
        &format!(
            "/selections/{}",
            selected["selection"]["id"].as_str().unwrap()
        ),
    );
    let current = document(auditor.read(&current_route).await, StatusCode::OK).await;
    assert_eq!(current["selection"], selected["selection"]);
    assert_eq!(current["current"]["status"], "eligible");
    read_session_fences(&auditor, &current_route).await;
    for actor in [&admin, &foreign] {
        refused(
            actor.read(&current_route).await,
            StatusCode::FORBIDDEN,
            "access_denied",
        )
        .await;
    }
    refused(
        auditor
            .read(&current_route.replace(
                selected["selection"]["id"].as_str().unwrap(),
                "unknown-selection",
            ))
            .await,
        StatusCode::FORBIDDEN,
        "access_denied",
    )
    .await;
    assert_eq!(execution_counts(&mut connection).await, baseline);

    let mut restricted = authority.organisation.clone();
    restricted.version += 1;
    restricted.hard.rules.clear();
    OperationRepository::new(database.pool().clone())
        .save_policy("identity-combined", &authority.scope, &restricted)
        .await
        .unwrap();
    let forbidden = document(auditor.read(&route(&task, "")).await, StatusCode::OK).await;
    assert_eq!(
        candidate(&forbidden, "live-technique")["inspection"]["status"],
        "forbidden"
    );
    assert_eq!(
        candidate(&forbidden, "live-technique")["inspection"]["needs"][0]["status"],
        "forbidden"
    );
    assert_eq!(
        candidate(&forbidden, "live-technique")["inspection"]["needs"][0]["blocking_bound"],
        json!({"accepted":false,"kind":"organisation","delegation_depth":null})
    );
    refused(
        auditor
            .command(
                &route(&task, "/select"),
                &select("select-forbidden", &live_receipt["version_id"], &forbidden),
            )
            .await,
        StatusCode::CONFLICT,
        "skill_ineligible",
    )
    .await;

    let disable = status("disable-pure", "4", &installed["version_id"], "disabled");
    mutation_fences(&admin, STATUS, &disable).await;
    refused(
        auditor.command(STATUS, &disable).await,
        StatusCode::FORBIDDEN,
        "access_denied",
    )
    .await;
    let disabled = document(admin.command(STATUS, &disable).await, StatusCode::OK).await;
    assert_eq!(disabled["affected_selections"], "1");
    assert_eq!(disabled["revision"], "5");
    assert_eq!(
        disabled,
        document(admin.command(STATUS, &disable).await, StatusCode::OK).await
    );
    let retained = document(auditor.read(&current_route).await, StatusCode::OK).await;
    assert_eq!(retained["selection"], selected["selection"]);
    assert_eq!(retained["current"]["status"], "disabled");
    assert_ne!(
        retained["current"]["dependency_fingerprint"],
        selected["current"]["dependency_fingerprint"]
    );
    let replay = document(
        auditor.command(&route(&task, "/select"), &command).await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(replay["selection"], selected["selection"]);
    assert_eq!(replay["current"]["status"], "disabled");
    let disabled_discovery = document(auditor.read(&route(&task, "")).await, StatusCode::OK).await;
    assert_eq!(disabled_discovery["selection_revision"], "1");
    assert_eq!(
        disabled_discovery["selections"][0]["selection"],
        selected["selection"]
    );
    refused(
        auditor
            .command(
                &route(&task, "/select"),
                &select(
                    "disabled-new-key",
                    &installed["version_id"],
                    &disabled_discovery,
                ),
            )
            .await,
        StatusCode::CONFLICT,
        "skill_ineligible",
    )
    .await;
    let mut stale = command.clone();
    stale["key"] = json!("stale-open-view");
    refused(
        auditor.command(&route(&task, "/select"), &stale).await,
        StatusCode::CONFLICT,
        "skill_conflict",
    )
    .await;
    let recall = status("recall-pure", "5", &installed["version_id"], "recalled");
    let recalled = document(admin.command(STATUS, &recall).await, StatusCode::OK).await;
    assert_eq!(recalled["revision"], "6");
    assert_eq!(recalled["affected_selections"], "1");
    assert_eq!(
        recalled,
        document(admin.command(STATUS, &recall).await, StatusCode::OK).await
    );
    let replay = document(
        auditor.command(&route(&task, "/select"), &command).await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(replay["selection"], selected["selection"]);
    assert_eq!(replay["current"]["status"], "recalled");
    assert_eq!(
        document(auditor.read(&current_route).await, StatusCode::OK).await["current"]["status"],
        "recalled"
    );
    refused(
        admin
            .command(
                STATUS,
                &status("cannot-reenable", "6", &installed["version_id"], "enabled"),
            )
            .await,
        StatusCode::CONFLICT,
        "skill_conflict",
    )
    .await;

    for (subject, path, body) in [
        ("admin", CATALOG.to_owned(), None),
        ("admin", format!("{ASSIGNMENTS}?kind=client"), None),
        (
            "admin",
            format!(
                "{CATALOG}/versions/{}/history",
                installed["version_id"].as_str().unwrap()
            ),
            None,
        ),
        ("auditor", IMPACTS.to_owned(), None),
        (
            "admin",
            INSTALL.to_owned(),
            Some(install("logged-out-install", "6", "never-installed")),
        ),
        (
            "admin",
            STATUS.to_owned(),
            Some(status(
                "logged-out-status",
                "6",
                &live_receipt["version_id"],
                "disabled",
            )),
        ),
        ("auditor", route(&task, ""), None),
        ("auditor", route(&task, "/select"), Some(command.clone())),
        ("auditor", current_route.clone(), None),
    ] {
        logout_while_waiting(
            &browser,
            &identities,
            &issuer,
            &config,
            &mut connection,
            subject,
            (path, body),
        )
        .await;
    }
    assert_eq!(
        document(admin.read(CATALOG).await, StatusCode::OK).await["revision"],
        "6"
    );
    assert_eq!(execution_counts(&mut connection).await, baseline);
    assert!(
        !marker.exists(),
        "installed script content must remain inert"
    );
    assert!(
        tokio::time::timeout(Duration::from_millis(100), source_listener.accept())
            .await
            .is_err(),
        "installation must not fetch source references or contact an adapter"
    );
    paged_configuration_and_scoped_impact(
        &mut connection,
        &admin,
        &auditor,
        &combined,
        &foreign,
        &task,
    )
    .await;
    connection.execute("UPDATE public.engagement_assignments SET active=false WHERE organisation_id='org-a' AND actor_id='identity-auditor'; UPDATE public.organisation_memberships SET active=false WHERE organisation_id='org-a' AND actor_id='identity-admin'").await.unwrap();
    refused(
        auditor.read(&route(&task, "")).await,
        StatusCode::FORBIDDEN,
        "access_denied",
    )
    .await;
    refused(
        auditor.read(&current_route).await,
        StatusCode::FORBIDDEN,
        "access_denied",
    )
    .await;
    refused(
        auditor.command(&route(&task, "/select"), &command).await,
        StatusCode::FORBIDDEN,
        "access_denied",
    )
    .await;
    refused(
        admin.read(CATALOG).await,
        StatusCode::FORBIDDEN,
        "access_denied",
    )
    .await;
    refused(
        admin.command(INSTALL, &original).await,
        StatusCode::FORBIDDEN,
        "access_denied",
    )
    .await;
    for path in [
        format!("{ASSIGNMENTS}?kind=client"),
        format!(
            "{CATALOG}/versions/{}/history",
            installed["version_id"].as_str().unwrap()
        ),
    ] {
        refused(
            admin.read(&path).await,
            StatusCode::FORBIDDEN,
            "access_denied",
        )
        .await;
    }
    refused(
        auditor.read(IMPACTS).await,
        StatusCode::FORBIDDEN,
        "access_denied",
    )
    .await;
    stop.send(()).unwrap();
    server.await.unwrap();
    database.pool().close().await;
    connection.close().await.unwrap();
}
