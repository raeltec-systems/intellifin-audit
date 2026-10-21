//! Real HTTP/session/policy proof; this test owns a guarded disposable schema.
use reqwest::{Client, Response, StatusCode};
use serde_json::{Value, json};
use sqlx::{Connection, Executor, PgConnection};
use std::{
    collections::BTreeSet,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    time::timeout,
};
use zobba_application::{
    identity::CurrentAuthority, operation::OperationStore, task::TaskCommands,
};
use zobba_domain::{
    identity::Scope,
    permissions::*,
    task::{ClaimBasis, CommandKind, CommandReceipt, Decision, TaskCommand, WakeupRoute},
};
use zobba_infrastructure::{
    RuntimeDatabase, database_options, identity::IdentityRepository, migrate,
    operation::OperationRepository, task::TaskRepository,
};
#[path = "../../infrastructure/tests/support/mod.rs"]
mod support;
const ISSUER: &str = "https://synthetic-operation-http.example";
const SCOPE_QUERY: &str = "organisation_id=org-a&client_id=client-a";
fn scope() -> Scope {
    Scope {
        organisation_id: "org-a".into(),
        client_id: "client-a".into(),
        engagement_id: "engagement-a".into(),
    }
}
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
    fn url(&self, route: &str) -> String {
        format!(
            "{}/engagements/engagement-a/{route}{}{}",
            self.address,
            if route.contains('?') { '&' } else { '?' },
            SCOPE_QUERY
        )
    }
    fn post(&self, route: &str) -> reqwest::RequestBuilder {
        self.client
            .post(self.url(route))
            .header("Cookie", format!("__Host-zobba-session={}", self.token))
            .header("Origin", &self.origin)
            .header("X-CSRF-Token", &self.csrf)
            .header("X-Expected-Actor", &self.actor)
            .header("Content-Type", "application/json")
    }
    async fn command(&self, route: &str, body: &Value) -> Response {
        self.post(route)
            .body(body.to_string())
            .send()
            .await
            .unwrap()
    }
    fn get(&self, route: &str) -> reqwest::RequestBuilder {
        self.client
            .get(self.url(route))
            .header("Cookie", format!("__Host-zobba-session={}", self.token))
            .header("X-Expected-Session", &self.csrf)
    }
    async fn read(&self, route: &str) -> Response {
        self.get(route).send().await.unwrap()
    }
}
async fn document(response: Response, expected: StatusCode) -> Value {
    assert_eq!(response.headers()["cache-control"], "no-store");
    let status = response.status();
    let text = response.text().await.unwrap();
    assert_eq!(status, expected, "{text}");
    serde_json::from_str(&text).unwrap()
}
fn assert_producing_methodology(value: &Value, basis: &ClaimBasis, binding: &Value) {
    assert_eq!(value["execution_epoch"], basis.execution_epoch.to_string());
    assert_eq!(value["methodology_binding_id"], binding["id"]);
    assert!(binding["id"].as_str().is_some_and(|id| !id.is_empty()));
    assert!(
        binding["execution_epoch"]
            .as_str()
            .unwrap()
            .parse::<i64>()
            .unwrap()
            <= basis.execution_epoch,
        "the recorded producer must use a binding already effective at its epoch"
    );
}
async fn headers(stream: &mut TcpStream) -> Vec<u8> {
    let mut result = Vec::new();
    while !result.ends_with(b"\r\n\r\n") {
        result.push(stream.read_u8().await.unwrap());
        assert!(result.len() <= 16_384);
    }
    result
}
// A test-owned proxy drops only the committed decision acknowledgement.
// Recovery below uses a fresh GET and does not replay the mutation.
async fn lose_decision_ack(browser: &Browser, route: &str, decision: &Value) {
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
        assert!(length < 32 * 1024);
        let mut body = vec![0; length];
        downstream.read_exact(&mut body).await.unwrap();
        let mut server = TcpStream::connect(upstream).await.unwrap();
        server.write_all(&head).await.unwrap();
        server.write_all(&body).await.unwrap();
        let mut response = Vec::new();
        server.read_to_end(&mut response).await.unwrap();
        assert!(response.starts_with(b"HTTP/1.1 200 "));
        drop(downstream);
    });
    let request = Browser {
        address: proxy_address,
        ..browser.clone()
    }
    .post(route)
    .header("Connection", "close")
    .body(decision.to_string());
    assert!(
        request.send().await.is_err(),
        "caller received no decision acknowledgement"
    );
    timeout(Duration::from_secs(2), proxy)
        .await
        .unwrap()
        .unwrap();
}

async fn hold_body(browser: &Browser, route: &str, body: &Value) -> TcpStream {
    let authority = browser.address.strip_prefix("http://").unwrap();
    let mut stream = TcpStream::connect(authority).await.unwrap();
    let body = body.to_string();
    let request = format!(
        "POST /engagements/engagement-a/{route}?{SCOPE_QUERY} HTTP/1.1\r\nHost: {authority}\r\nCookie: __Host-zobba-session={}\r\nOrigin: {}\r\nX-CSRF-Token: {}\r\nX-Expected-Actor: {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nExpect: 100-continue\r\nConnection: close\r\n\r\n",
        browser.token,
        browser.origin,
        browser.csrf,
        browser.actor,
        body.len()
    );
    stream.write_all(request.as_bytes()).await.unwrap();
    assert_eq!(
        timeout(Duration::from_secs(2), headers(&mut stream))
            .await
            .unwrap(),
        b"HTTP/1.1 100 Continue\r\n\r\n"
    );
    stream
        .write_all(&body.as_bytes()[..body.len() - 1])
        .await
        .unwrap();
    stream
}
fn request() -> CanonicalOperation {
    CanonicalOperation {
        version: 1,
        purpose: Purpose::AuditCoordination,
        action: Action::Send,
        account_id: "audit-account".into(),
        environment_id: "audit-environment".into(),
        destination: "audit-destination".into(),
        recipients: vec!["recipient-a".into()],
        material: "Synthetic reviewed material".into(),
        material_digest: "49081b8282339ea871a4a02a467033c94c160354ba80a043cab85da91217faef".into(),
        attachments: vec![Attachment {
            id: "attachment-a".into(),
            digest: "a".repeat(64),
            classification: "audit-material".into(),
        }],
        resource_id: "audit-resource".into(),
        resource_version: "resource-v1".into(),
        expires_at: 4_102_444_800,
    }
}
fn source() -> SourceBinding {
    SourceBinding {
        source_id: "http-source".into(),
        ledger_id: "http-ledger".into(),
        endpoint_digest: "f".repeat(64),
        contract_version: 1,
    }
}
fn authority(task: &str, request: &CanonicalOperation) -> AuthoritySnapshot {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    let rule = PermissionRule {
        purpose: request.purpose,
        action: request.action,
        account_id: request.account_id.clone(),
        environment_id: request.environment_id.clone(),
        destination: request.destination.clone(),
        recipients: vec!["recipient-a".into(), "recipient-b".into()],
        resource_id: request.resource_id.clone(),
        attachment_classifications: vec!["audit-material".into()],
        expires_at: request.expires_at,
    };
    let policy = |kind, subject: &str| PolicyDocument {
        schema_version: 1,
        kind,
        subject_id: subject.into(),
        version: 1,
        actor_id: "identity-a".into(),
        created_at: now,
        revoked: false,
        hard: PermissionBounds {
            rules: vec![rule.clone()],
        },
        standing: PermissionBounds { rules: Vec::new() },
        account: None,
        parent: None,
    };
    let mut account = policy(PolicyKind::Account, &request.account_id);
    account.account = Some(AccountRestriction {
        source: source(),
        account_id: request.account_id.clone(),
        environment_id: request.environment_id.clone(),
        environment: EnvironmentKind::Audit,
        read_restriction: ReadRestriction::None,
        restriction_survives_takeover: false,
        test_environment_verified: false,
        test_resources: Vec::new(),
        test_cleanup_id: None,
        audit_resources: vec![request.resource_id.clone()],
    });
    AuthoritySnapshot {
        scope: scope(),
        actor_id: "identity-a".into(),
        task_id: task.into(),
        organisation: policy(PolicyKind::Organisation, "org-a"),
        engagement: policy(PolicyKind::Engagement, "engagement-a"),
        member: policy(PolicyKind::Member, "identity-a"),
        account,
        task: policy(PolicyKind::Task, task),
        delegations: Vec::new(),
    }
}
async fn create_operation(database: &RuntimeDatabase) -> (Operation, CommandReceipt, ClaimBasis) {
    let tasks = TaskRepository::new(database.pool().clone());
    let command = TaskCommand {
        context: None,
        key: "http-operation-task".into(),
        kind: CommandKind::Create,
        task_id: None,
        cycle_id: None,
        content: Some("Synthetic operation objective".into()),
    };
    let receipt = tasks.admit("identity-a", &scope(), &command).await.unwrap();
    let operations = OperationRepository::new(database.pool().clone());
    let request = request();
    let authority = authority(&receipt.task_id, &request);
    for policy in authority.documents().filter(|p| p.kind != PolicyKind::Task) {
        operations
            .save_policy("identity-a", &scope(), policy)
            .await
            .unwrap();
    }
    operations
        .accept_authority("identity-a", &scope(), &receipt.task_id, &authority)
        .await
        .unwrap();
    let route = WakeupRoute {
        id: receipt.task_id.clone(),
        actor_id: "identity-a".into(),
        scope: scope(),
        task_id: receipt.task_id.clone(),
    };
    let Decision::Execute(basis) = tasks
        .coordinate(&route, "operation-http-worker")
        .await
        .unwrap()
    else {
        panic!("expected producing task claim")
    };
    // The ordinary Task owner renews only a consumed inert claim. Record that
    // possible-dispatch cutoff for this synthetic owner; no child result is claimed.
    let _inert_attempt = tasks.consume(&basis).await.unwrap();
    let operation = operations
        .admit(
            "identity-a",
            &scope(),
            &basis,
            "http-logical-operation",
            &request,
        )
        .await
        .unwrap();
    (operation, receipt, *basis)
}

async fn history_evidence(
    browser: &Browser,
    database: &RuntimeDatabase,
    admin: &mut PgConnection,
    operation: &Operation,
    basis: &ClaimBasis,
    decision_route: &str,
    decision: &Value,
) -> Operation {
    let operations = OperationRepository::new(database.pool().clone());
    let tasks = TaskRepository::new(database.pool().clone());
    let methodology = document(
        browser
            .read(&format!("tasks/{}/methodology", operation.task_id))
            .await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(
        methodology["current"]["id"],
        operation.methodology_binding_id
    );
    assert!(tasks.current(basis).await.unwrap());
    let unconsumed = operations
        .admit(
            "identity-a",
            &scope(),
            basis,
            "http-unconsumed-revocation",
            &operation.request,
        )
        .await
        .unwrap();
    let mut next = decision.clone();
    next["key"] = json!("http-revoke-exact-decision");
    document(
        browser
            .command(&format!("operations/{}/decisions", unconsumed.id), &next)
            .await,
        StatusCode::OK,
    )
    .await;
    for index in 0..50 {
        if index % 10 == 0 {
            assert!(tasks.current(basis).await.unwrap());
        }
        let mut next = decision.clone();
        next["key"] = json!(format!("http-history-decision-{index}"));
        document(browser.command(decision_route, &next).await, StatusCode::OK).await;
    }
    let route = format!("operations/{}/history", operation.id);
    let first = document(browser.read(&route).await, StatusCode::OK).await;
    assert_eq!(first["decisions"].as_array().unwrap().len(), 50);
    let cursor = first["decision_next_cursor"].as_str().unwrap();
    let second = document(
        browser
            .read(&format!("{route}?after_decision_id={cursor}"))
            .await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(second["decisions"].as_array().unwrap().len(), 1);
    assert!(second["decision_next_cursor"].is_null());
    let decision_ids: BTreeSet<_> = first["decisions"]
        .as_array()
        .unwrap()
        .iter()
        .chain(second["decisions"].as_array().unwrap())
        .map(|v| v["decision"]["id"].as_str().unwrap())
        .collect();
    assert_eq!(decision_ids.len(), 51);
    assert!(tasks.current(basis).await.unwrap());
    // Preserve real port-created facts. The gateway suite separately qualifies
    // actual endpoints; this HTTP test supplies synthetic source observations.
    let attempt = operations.consume(basis, &operation.id).await.unwrap();
    operations
        .observe(&attempt, SourceFact::Unknown)
        .await
        .unwrap();
    let recovery = operations
        .recover("identity-a", &scope(), &attempt.attempt_id)
        .await
        .unwrap();
    operations
        .observe(&attempt, SourceFact::Accepted)
        .await
        .unwrap();
    operations
        .observe(&recovery, SourceFact::Completed)
        .await
        .unwrap();
    // Test-admin-only immutable history fixtures exercise page bounds without
    // fabricating a fresh execution basis or dispatching further operations.
    // Capability hashes have no known corresponding capability in this fixture.
    let mut fixture = admin.begin().await.unwrap();
    for index in 2..=51_i64 {
        let id = format!("http-history-attempt-{index:03}");
        let producer = format!("http-history-producer-{index:03}");
        sqlx::query("INSERT INTO public.operation_attempts SELECT (jsonb_populate_record(NULL::public.operation_attempts,to_jsonb(a)||jsonb_build_object('id',$1::text,'attempt_number',$2::bigint,'basis',(a.basis::jsonb||jsonb_build_object('process_instance',$3::text))::text))).* FROM public.operation_attempts a WHERE id=$4")
            .bind(&id).bind(index).bind(&producer).bind(&attempt.attempt_id).execute(&mut *fixture).await.unwrap();
        sqlx::query("INSERT INTO public.operation_claims SELECT (jsonb_populate_record(NULL::public.operation_claims,to_jsonb(c)||jsonb_build_object('id',$1::text,'attempt_id',$2::text))).* FROM public.operation_claims c WHERE attempt_id=$3")
            .bind(format!("http-history-claim-{index:03}")).bind(&id).bind(&attempt.attempt_id).execute(&mut *fixture).await.unwrap();
        sqlx::query("INSERT INTO public.operation_receipt_producers SELECT (jsonb_populate_record(NULL::public.operation_receipt_producers,to_jsonb(p)||jsonb_build_object('attempt_id',$1::text,'producer_id',$2::text))).* FROM public.operation_receipt_producers p WHERE attempt_id=$3 AND producer_id=$4")
            .bind(&id).bind(&producer).bind(&attempt.attempt_id).bind(&attempt.basis.process_instance).execute(&mut *fixture).await.unwrap();
        sqlx::query("INSERT INTO public.operation_receipt_slots SELECT (jsonb_populate_record(NULL::public.operation_receipt_slots,to_jsonb(s)||jsonb_build_object('attempt_id',$1::text,'producer_id',$2::text,'capability_hash',repeat('e',64)))).* FROM public.operation_receipt_slots s WHERE attempt_id=$3 AND producer_id=$4")
            .bind(&id).bind(&producer).bind(&attempt.attempt_id).bind(&attempt.basis.process_instance).execute(&mut *fixture).await.unwrap();
        sqlx::query("INSERT INTO public.operation_receipts SELECT (jsonb_populate_record(NULL::public.operation_receipts,to_jsonb(r)||jsonb_build_object('id',$1::text,'attempt_id',$2::text,'producer_id',$3::text))).* FROM public.operation_receipts r WHERE attempt_id=$4 AND outcome='unknown'")
            .bind(format!("http-history-observation-{index:03}")).bind(&id).bind(&producer).bind(&attempt.attempt_id).execute(&mut *fixture).await.unwrap();
    }
    fixture.commit().await.unwrap();
    let first = document(browser.read(&route).await, StatusCode::OK).await;
    assert_eq!(first.as_object().unwrap().len(), 7);
    assert_eq!(first["attempts"].as_array().unwrap().len(), 50);
    assert_eq!(first["observations"].as_array().unwrap().len(), 50);
    let attempt_cursor = first["attempt_next_cursor"].as_str().unwrap();
    let observation_cursor = first["observation_next_cursor"].as_str().unwrap();
    let second = document(browser.read(&format!("{route}?after_attempt_id={attempt_cursor}&after_observation_id={observation_cursor}")).await, StatusCode::OK).await;
    assert_eq!(second["attempts"].as_array().unwrap().len(), 1);
    assert!(second["attempt_next_cursor"].is_null());
    let attempt_numbers: BTreeSet<_> = first["attempts"]
        .as_array()
        .unwrap()
        .iter()
        .chain(second["attempts"].as_array().unwrap())
        .map(|v| v["number"].as_str().unwrap().parse::<u64>().unwrap())
        .collect();
    assert_eq!(attempt_numbers, (1..=51).collect());
    assert!(second["observation_next_cursor"].is_null());
    assert_eq!(
        second["decisions"].as_array().unwrap().len(),
        50,
        "independent cursors never advance another collection"
    );
    let observations: Vec<_> = first["observations"]
        .as_array()
        .unwrap()
        .iter()
        .chain(second["observations"].as_array().unwrap())
        .collect();
    assert_eq!(observations.len(), 53);
    assert_eq!(
        observations
            .iter()
            .map(|v| v["id"].as_str().unwrap())
            .collect::<BTreeSet<_>>()
            .len(),
        53
    );
    assert_eq!(
        observations
            .iter()
            .map(|v| v["fact"].as_str().unwrap())
            .collect::<BTreeSet<_>>(),
        BTreeSet::from(["unknown", "accepted", "completed"])
    );
    assert_eq!(
        observations
            .iter()
            .map(|v| v["source"].as_str().unwrap())
            .collect::<BTreeSet<_>>(),
        BTreeSet::from(["dispatch", "reconciliation"])
    );
    for value in observations {
        assert_eq!(value.as_object().unwrap().len(), 5);
        assert!(value["recorded_at"].is_string());
    }
    for page in [&first, &second] {
        let text = page.to_string();
        for secret in [
            &attempt.receipt_capability,
            &recovery.receipt_capability,
            &"f".repeat(64),
            &"e".repeat(64),
            &"operation-http-worker".to_owned(),
        ] {
            assert!(!text.contains(secret.as_str()));
        }
        for value in page["attempts"].as_array().unwrap() {
            assert_eq!(value.as_object().unwrap().len(), 9);
            assert!(value["number"].is_string());
            assert!(value["recorded_at"].is_string());
            assert_eq!(value["source_id"], "http-source");
            assert_eq!(value["ledger_id"], "http-ledger");
            assert_producing_methodology(value, basis, &methodology["current"]);
        }
    }
    unconsumed
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
        INSERT INTO public.organisation_memberships(organisation_id,actor_id,roles) VALUES('org-a','identity-a',ARRAY['auditor','audit_manager','admin']),('org-a','identity-admin',ARRAY['admin']),('org-a','identity-peer',ARRAY['auditor']);
        INSERT INTO public.engagement_assignments(organisation_id,client_id,engagement_id,actor_id) VALUES('org-a','client-a','engagement-a','identity-a'),('org-a','client-a','engagement-a','identity-admin'),('org-a','client-a','engagement-a','identity-peer');")
        .await.unwrap();
    sqlx::query("INSERT INTO public.trusted_attachment_metadata(organisation_id,client_id,engagement_id,source_key,attachment_id,digest,classification) VALUES('org-a','client-a','engagement-a',$1,'attachment-a',$2,'audit-material')")
        .bind("11:http-source11:http-ledger")
        .bind("a".repeat(64)).execute(&mut *tx).await.unwrap();
    tx.commit().await.unwrap();
}

async fn independent_control_capacity(
    browser: &Browser,
    database: &RuntimeDatabase,
    receipt: &CommandReceipt,
    decision_route: &str,
    decision: &Value,
) {
    let mut held = Vec::new();
    for _ in 0..8 {
        held.push(hold_body(browser, decision_route, decision).await);
    }
    assert_eq!(
        browser.command(decision_route, decision).await.status(),
        StatusCode::TOO_MANY_REQUESTS
    );
    for path in [
        format!("operations?task_id={}", receipt.task_id),
        format!(
            "{}/history",
            decision_route.strip_suffix("/decisions").unwrap()
        ),
        "tasks".into(),
        "conversation".into(),
    ] {
        assert_eq!(
            browser.read(&path).await.status(),
            StatusCode::TOO_MANY_REQUESTS,
            "operation bodies share the ordinary permits"
        );
    }
    let guide = json!({"key":"http-permission-capacity-guide","kind":"guide","task_id":receipt.task_id,"cycle_id":receipt.cycle_id,"content":"Preserve the existing operation direction"});
    document(
        browser.command("task-controls", &guide).await,
        StatusCode::ACCEPTED,
    )
    .await;
    let started = tokio::time::Instant::now();
    timeout(Duration::from_secs(8), async {
        for mut stream in held {
            let mut response = Vec::new();
            stream.read_to_end(&mut response).await.unwrap();
            assert!(response.starts_with(b"HTTP/1.1 503 "));
        }
    })
    .await
    .expect("all incomplete operation bodies release at the shared six second deadline");
    assert!(started.elapsed() < Duration::from_secs(8));
    // Every shared ordinary connection is busy. Reserved control authentication
    // and admission remain independent of the new operation read waiting on it.
    let mut occupied = Vec::new();
    for _ in 0..4 {
        occupied.push(database.pool().acquire().await.unwrap());
    }
    let waiting = browser.get(&format!(
        "{}/history",
        decision_route.strip_suffix("/decisions").unwrap()
    ));
    let waiting = tokio::spawn(async move { waiting.send().await.unwrap() });
    let duplicate = timeout(
        Duration::from_secs(2),
        browser.command("task-controls", &guide),
    )
    .await
    .expect("reserved control lane cannot wait on operation traffic");
    assert_eq!(duplicate.status(), StatusCode::ACCEPTED);
    assert!(!waiting.is_finished());
    drop(occupied);
    assert_eq!(waiting.await.unwrap().status(), StatusCode::OK);
}

#[tokio::test]
async fn exact_operation_http_decisions_revocation_and_fresh_projections() {
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
            .expect("load the actual local fixture environment"),
        token,
        csrf: session.csrf_token,
        actor: "identity-a".into(),
    };
    let (operation, receipt, basis) = create_operation(&database).await;
    let route = format!("operations/{}", operation.id);
    let decision_route = format!("{route}/decisions");
    let methodology_route = format!("tasks/{}/methodology", receipt.task_id);
    let methodology = document(browser.read(&methodology_route).await, StatusCode::OK).await;
    assert_eq!(methodology["history"], json!([]));
    let view = document(browser.read(&route).await, StatusCode::OK).await;
    assert_eq!(view["state"], "needs_decision");
    assert_eq!(view["actor_id"], "identity-a");
    assert_eq!(view["request"]["material"], "Synthetic reviewed material");
    assert_eq!(view["request"]["attachments"][0]["id"], "attachment-a");
    assert!(view["revision"].is_string());
    assert!(view["request"]["expires_at"].is_string());
    assert_producing_methodology(&view, &basis, &methodology["current"]);
    assert_eq!(
        view.as_object().unwrap().len(),
        10,
        "only the explicit secret-free projection is public"
    );
    let page = document(
        browser
            .read(&format!("operations?task_id={}", receipt.task_id))
            .await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(page["operations"], json!([view.clone()]));
    assert!(page["next_cursor"].is_null());
    let empty = document(
        browser
            .read(&format!(
                "operations?task_id={}&after_operation_id={}",
                receipt.task_id, operation.id
            ))
            .await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(empty["operations"], json!([]));
    let mut decision = json!({"key":"http-exact-decision","expected_revision":view["revision"],"request":view["request"],"expires_at":view["request"]["expires_at"],"allow":true});

    for (method, path) in [
        (reqwest::Method::GET, "engagements/%FF/operations"),
        (reqwest::Method::GET, "engagements/%FF/operations/operation"),
        (
            reqwest::Method::GET,
            "engagements/engagement-a/operations/%FF",
        ),
        (
            reqwest::Method::GET,
            "engagements/%FF/operations/operation/history",
        ),
        (
            reqwest::Method::GET,
            "engagements/engagement-a/operations/%FF/history",
        ),
        (
            reqwest::Method::POST,
            "engagements/%FF/operations/operation/decisions",
        ),
        (
            reqwest::Method::POST,
            "engagements/engagement-a/operations/%FF/decisions",
        ),
        (
            reqwest::Method::POST,
            "engagements/%FF/permissions/account/revoke",
        ),
        (
            reqwest::Method::POST,
            "engagements/engagement-a/permissions/%FF/revoke",
        ),
    ] {
        let response = browser
            .client
            .request(method, format!("{}/{path}?{SCOPE_QUERY}", browser.address))
            .header("Cookie", format!("__Host-zobba-session={}", browser.token))
            .header("Origin", &browser.origin)
            .header("X-CSRF-Token", &browser.csrf)
            .header("X-Expected-Actor", &browser.actor)
            .header("Content-Type", "application/json")
            .body(decision.to_string())
            .send()
            .await
            .unwrap();
        assert_eq!(response.headers()["content-type"], "application/json");
        assert_eq!(
            document(response, StatusCode::BAD_REQUEST).await,
            json!({"error":"invalid_operation"})
        );
    }

    // The full current canonical request is authoritative: every material field
    // is submitted, and substitution cannot accidentally become a broad grant.
    for (field, replacement) in [
        ("account_id", json!("another-account")),
        ("environment_id", json!("another-environment")),
        ("destination", json!("another-destination")),
        ("recipients", json!(["recipient-b"])),
        ("material", json!("substituted material")),
        ("material_digest", json!("b".repeat(64))),
        ("attachments", json!([])),
        ("resource_id", json!("another-resource")),
        ("resource_version", json!("resource-v2")),
        ("purpose", json!("test_workflows")),
        ("action", json!("read")),
        ("expires_at", json!("4102444799")),
        ("version", json!(2)),
    ] {
        let mut changed = decision.clone();
        changed["request"][field] = replacement;
        let response = browser.command(&decision_route, &changed).await;
        assert!(
            matches!(
                response.status(),
                StatusCode::BAD_REQUEST | StatusCode::CONFLICT
            ),
            "{field} was not refused: {}",
            response.status()
        );
    }
    for (field, replacement) in [
        ("expected_revision", json!("2")),
        ("expires_at", json!("1")),
        ("expected_revision", json!("9007199254740993")),
    ] {
        let mut changed = decision.clone();
        changed[field] = replacement;
        assert_eq!(
            browser.command(&decision_route, &changed).await.status(),
            StatusCode::CONFLICT
        );
    }
    for replacement in [
        json!(1),
        json!("01"),
        json!("1e0"),
        json!("9223372036854775808"),
    ] {
        let mut changed = decision.clone();
        changed["expected_revision"] = replacement;
        assert_eq!(
            browser.command(&decision_route, &changed).await.status(),
            StatusCode::BAD_REQUEST
        );
    }
    let mut unknown = decision.clone();
    unknown["actor_id"] = json!("identity-peer");
    assert_eq!(
        browser.command(&decision_route, &unknown).await.status(),
        StatusCode::BAD_REQUEST
    );
    let duplicate_field = decision.to_string().replacen('{', "{\"key\":\"other\",", 1);
    assert_eq!(
        browser
            .post(&decision_route)
            .body(duplicate_field)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::BAD_REQUEST
    );
    let mut oversized = decision.to_string();
    oversized.push_str(&" ".repeat(32 * 1024));
    assert_eq!(
        browser
            .post(&decision_route)
            .body(oversized)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::BAD_REQUEST
    );

    for (origin, csrf, actor) in [
        (
            "https://foreign.example",
            browser.csrf.as_str(),
            "identity-a",
        ),
        (browser.origin.as_str(), "stale-csrf", "identity-a"),
        (
            browser.origin.as_str(),
            browser.csrf.as_str(),
            "identity-peer",
        ),
    ] {
        let response = browser
            .client
            .post(browser.url(&decision_route))
            .header("Cookie", format!("__Host-zobba-session={}", browser.token))
            .header("Origin", origin)
            .header("X-CSRF-Token", csrf)
            .header("X-Expected-Actor", actor)
            .header("Content-Type", "application/json")
            .body(decision.to_string())
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }
    let missing_actor = browser
        .client
        .post(browser.url(&decision_route))
        .header("Cookie", format!("__Host-zobba-session={}", browser.token))
        .header("Origin", &browser.origin)
        .header("X-CSRF-Token", &browser.csrf)
        .header("Content-Type", "application/json")
        .body(decision.to_string())
        .send()
        .await
        .unwrap();
    assert_eq!(missing_actor.status(), StatusCode::FORBIDDEN);
    let peer_token = identities
        .establish_session(ISSUER, "auditor-peer", "Peer", None)
        .await
        .unwrap();
    let peer_session = identities.session(&peer_token).await.unwrap();
    let peer = Browser {
        token: peer_token,
        csrf: peer_session.csrf_token,
        actor: "identity-peer".into(),
        ..browser.clone()
    };
    let changed_actor = peer
        .post(&decision_route)
        .header("X-Expected-Actor", "identity-a")
        .body(decision.to_string())
        .send()
        .await
        .unwrap();
    assert_eq!(changed_actor.status(), StatusCode::FORBIDDEN);
    let stale_read = peer
        .client
        .get(peer.url(&route))
        .header("Cookie", format!("__Host-zobba-session={}", peer.token))
        .header("X-Expected-Session", &browser.csrf)
        .send()
        .await
        .unwrap();
    assert_eq!(stale_read.status(), StatusCode::PRECONDITION_FAILED);
    assert!(!stale_read.headers().contains_key("set-cookie"));
    for path in [
        "operations/guessed-operation".into(),
        format!(
            "operations?task_id={}&after_operation_id=bad%20id",
            receipt.task_id
        ),
    ] {
        assert!(matches!(
            browser.read(&path).await.status(),
            StatusCode::FORBIDDEN | StatusCode::BAD_REQUEST
        ));
    }
    let foreign = browser
        .client
        .get(format!(
            "{}/engagements/engagement-a/{route}?organisation_id=foreign&client_id=client-a",
            browser.address
        ))
        .header("Cookie", format!("__Host-zobba-session={}", browser.token))
        .send()
        .await
        .unwrap();
    assert_eq!(foreign.status(), StatusCode::FORBIDDEN);
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM public.operation_decisions")
        .fetch_one(&mut admin)
        .await
        .unwrap();
    assert_eq!(count, 0, "all refused decisions must leave history empty");

    lose_decision_ack(&browser, &decision_route, &decision).await;
    let history_route = format!("{route}/history");
    let recovered = document(browser.read(&history_route).await, StatusCode::OK).await;
    assert_eq!(recovered["decisions"].as_array().unwrap().len(), 1);
    assert_eq!(recovered["decisions"][0]["key"], decision["key"]);
    let accepted = recovered["decisions"][0]["decision"].clone();
    assert_eq!(accepted["expires_at"], decision["expires_at"]);
    assert!(recovered["decisions"][0]["recorded_at"].is_string());
    assert_eq!(recovered["attempts"], json!([]));
    assert_eq!(recovered["observations"], json!([]));
    let peer_history = document(peer.read(&history_route).await, StatusCode::OK).await;
    assert_eq!(
        peer_history["decisions"], recovered["decisions"],
        "freshly authorized readers retain the original decider"
    );
    let changed_session = peer
        .client
        .get(peer.url(&history_route))
        .header("Cookie", format!("__Host-zobba-session={}", peer.token))
        .header("X-Expected-Session", &browser.csrf)
        .send()
        .await
        .unwrap();
    assert_eq!(changed_session.status(), StatusCode::PRECONDITION_FAILED);
    assert!(!changed_session.headers().contains_key("set-cookie"));
    for suffix in [
        "after_decision_id=bad%20id",
        "after_attempt_id=bad%20id",
        "after_observation_id=bad%20id",
    ] {
        assert_eq!(
            browser
                .read(&format!("{history_route}?{suffix}"))
                .await
                .status(),
            StatusCode::BAD_REQUEST
        );
    }
    let foreign_history = browser.client.get(format!("{}/engagements/engagement-a/{history_route}?organisation_id=foreign&client_id=client-a", browser.address))
        .header("Cookie", format!("__Host-zobba-session={}", browser.token)).send().await.unwrap();
    assert_eq!(foreign_history.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        browser
            .read("operations/guessed-operation/history")
            .await
            .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(accepted["actor_id"], "identity-a");
    assert_eq!(accepted["allowed"], true);
    assert_eq!(accepted["request_digest"], view["request_digest"]);
    assert_eq!(
        document(
            browser.command(&decision_route, &decision).await,
            StatusCode::OK
        )
        .await,
        accepted,
        "same-key decision retry returns its immutable original"
    );
    decision["allow"] = json!(false);
    assert_eq!(
        browser.command(&decision_route, &decision).await.status(),
        StatusCode::CONFLICT
    );
    decision["allow"] = json!(true);
    let ready = document(browser.read(&route).await, StatusCode::OK).await;
    assert_eq!(ready["state"], "ready");

    let unconsumed = history_evidence(
        &browser,
        &database,
        &mut admin,
        &operation,
        &basis,
        &decision_route,
        &decision,
    )
    .await;
    let revocation_route = "permissions/audit-account/revoke";
    let revoke = json!({"key":"http-revoke-account","kind":"account","expected_version":"1"});
    assert_eq!(
        peer.command(revocation_route, &revoke).await.status(),
        StatusCode::FORBIDDEN
    );
    let revoked = document(
        browser.command(revocation_route, &revoke).await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(revoked["version"], "2");
    assert_eq!(
        browser.read(&history_route).await.status(),
        StatusCode::OK,
        "permission revocation retains history for the current engagement audience"
    );
    assert_eq!(
        document(
            browser.command(revocation_route, &revoke).await,
            StatusCode::OK
        )
        .await,
        revoked
    );
    let different_key =
        json!({"key":"http-stale-revoke-account","kind":"account","expected_version":"1"});
    assert_eq!(
        browser
            .command(revocation_route, &different_key)
            .await
            .status(),
        StatusCode::CONFLICT
    );
    assert!(
        OperationRepository::new(database.pool().clone())
            .consume(&basis, &unconsumed.id)
            .await
            .is_err(),
        "revocation denies an unconsumed exact decision"
    );

    independent_control_capacity(&browser, &database, &receipt, &decision_route, &decision).await;
    // Guidance and subsequent controls change current Task intent/epochs, while
    // operation inspection continues to identify the original producing basis.
    let guided = document(browser.read(&methodology_route).await, StatusCode::OK).await;
    assert_eq!(guided, methodology);
    let controlled_history = document(browser.read(&history_route).await, StatusCode::OK).await;
    let continued_history_route = format!(
        "{history_route}?after_attempt_id={}",
        controlled_history["attempt_next_cursor"].as_str().unwrap()
    );
    let controlled_history_tail =
        document(browser.read(&continued_history_route).await, StatusCode::OK).await;
    for (offset, kind, state) in [(1, "pause", "paused"), (2, "stop", "stopped")] {
        let control = json!({
            "key": format!("http-methodology-{kind}"),
            "kind": kind,
            "task_id": receipt.task_id,
            "cycle_id": receipt.cycle_id,
        });
        document(
            browser.command("task-controls", &control).await,
            StatusCode::ACCEPTED,
        )
        .await;
        let task = document(
            browser.read(&format!("tasks/{}", receipt.task_id)).await,
            StatusCode::OK,
        )
        .await;
        assert_eq!(task["state"], state);
        assert_eq!(
            task["execution_epoch"],
            (basis.execution_epoch + offset).to_string()
        );
        let retained = document(browser.read(&route).await, StatusCode::OK).await;
        assert_producing_methodology(&retained, &basis, &methodology["current"]);
        assert_eq!(
            document(browser.read(&methodology_route).await, StatusCode::OK).await,
            methodology
        );
        assert_eq!(
            document(browser.read(&history_route).await, StatusCode::OK).await,
            controlled_history,
            "controls preserve original attempt associations on the first page"
        );
        assert_eq!(
            document(browser.read(&continued_history_route).await, StatusCode::OK).await,
            controlled_history_tail,
            "controls preserve original attempt associations on the remaining page"
        );
    }
    config.guard_connection(&mut admin).await;
    admin.execute("UPDATE public.organisation_memberships SET roles=ARRAY['admin'] WHERE actor_id='identity-a'").await.unwrap();
    assert_eq!(
        browser.command(&decision_route, &decision).await.status(),
        StatusCode::FORBIDDEN,
        "decision retries reauthorize the current scope"
    );
    assert_eq!(
        browser.command(revocation_route, &revoke).await.status(),
        StatusCode::FORBIDDEN,
        "revocation retries reauthorize the current scope"
    );
    assert_eq!(browser.read(&route).await.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        browser.read(&history_route).await.status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        browser
            .read(&format!("operations?task_id={}", receipt.task_id))
            .await
            .status(),
        StatusCode::FORBIDDEN
    );
    let logout = browser
        .client
        .post(format!("{}/auth/logout", browser.address))
        .header("Cookie", format!("__Host-zobba-session={}", browser.token))
        .header("Origin", &browser.origin)
        .header("X-CSRF-Token", &browser.csrf)
        .send()
        .await
        .unwrap();
    assert_eq!(logout.status(), StatusCode::NO_CONTENT);
    for response in [
        browser.read(&route).await,
        browser.read(&history_route).await,
        browser.command(&decision_route, &decision).await,
        browser.command(revocation_route, &revoke).await,
    ] {
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert!(!response.headers().contains_key("set-cookie"));
    }
    stop.send(()).unwrap();
    server.await.unwrap();
}
