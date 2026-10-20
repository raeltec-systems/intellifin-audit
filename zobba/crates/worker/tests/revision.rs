//! Story 24.3a proof: evaluation revision chains, carried facts and human
//! dispositions, end to end. The production work coordinator with the trusted
//! assessment composition, real PostgreSQL custody (revision, carry and
//! disposition records, their guards and forced RLS), real S3-protocol
//! originals, a native OpenAI loopback provider (never a live provider) and
//! the real authenticated disposition and history API. Requires a guarded
//! `_test` database, the OIDC fixture environment and a Docker engine with
//! the pinned image; it fails, never skips, without them.
use sha2::{Digest, Sha256};
use sqlx::{Connection, Executor, PgConnection};
use std::{
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};
use zobba_application::{
    analysis::{AnalysisSettings, AnalysisTarget},
    evidence::EvidenceObjects,
    methodology::{MethodologyStore, SaveMethodology},
    model::{
        Capabilities, ModelProfile, ModelQualificationSource, Provider, Qualification, ToolCatalog,
    },
    operation::OperationStore,
    task::TaskCommands,
};
use zobba_domain::{
    analysis::{GENERAL_IMAGE_DIGEST, server_allowlist},
    identity::Scope,
    permissions::{
        AccountRestriction, Action, Attachment, AuthoritySnapshot, CanonicalOperation,
        EnvironmentKind, PermissionBounds, PermissionRule, PolicyDocument, PolicyKind, Purpose,
        ReadRestriction, SourceBinding,
    },
    task::{CommandKind, TaskCommand, TaskState},
};
use zobba_infrastructure::{
    RuntimeDatabase,
    analysis::docker::DockerSandbox,
    database_options,
    evidence::s3::S3EvidenceObjects,
    fixture::seed_local_configured,
    identity::{IdentityRepository, secret_hash},
    methodology::MethodologyRepository,
    migrate,
    model::{ModelRepository, native::NativeAdapter},
    operation::OperationRepository,
    task::TaskRepository,
};
use zobba_worker::{
    executor,
    gateway::Gateway,
    work::{Composition, ReadingComposition},
};

#[path = "../../infrastructure/tests/support/s3_protocol.rs"]
mod s3_protocol;
#[path = "../../infrastructure/tests/support/mod.rs"]
mod support;

const REPOSITORY: &str = "127.0.0.1:5000/zobba/analysis-general";
const NAMESPACE: &str = "6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e";
const ISSUER: &str = "https://127.0.0.1:4443";

fn scope() -> Scope {
    Scope {
        organisation_id: "org-a".into(),
        client_id: "client-a".into(),
        engagement_id: "engagement-a".into(),
    }
}
fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}
fn sha(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
struct Fixture;
impl ModelQualificationSource for Fixture {
    fn qualified(&self, p: &ModelProfile) -> bool {
        p.qualification == Qualification::Fixture
            && p.account_id == "fixture-account"
            && p.destination == "fixture-destination"
    }
}
fn source() -> SourceBinding {
    SourceBinding {
        source_id: "analysis-sandbox".into(),
        ledger_id: "analysis-ledger".into(),
        endpoint_digest: "a".repeat(64),
        contract_version: 1,
    }
}
fn disclosure() -> CanonicalOperation {
    let material = "Synthetic method investigation";
    CanonicalOperation {
        version: 1,
        purpose: Purpose::AuditCoordination,
        action: Action::Send,
        account_id: "fixture-account".into(),
        environment_id: "audit-environment".into(),
        destination: "fixture-destination".into(),
        recipients: vec!["recipient-a".into()],
        material: material.into(),
        material_digest: sha(material.as_bytes()),
        attachments: vec![Attachment {
            id: "attachment".into(),
            digest: "a".repeat(64),
            classification: "audit".into(),
        }],
        resource_id: "audit-resource".into(),
        resource_version: "resource-v1".into(),
        expires_at: 4_102_444_800,
    }
}
fn target() -> AnalysisTarget {
    AnalysisTarget {
        account_id: "fixture-account".into(),
        environment_id: "audit-environment".into(),
        destination: "analysis-sandbox".into(),
        resource_id: "analysis-resource".into(),
        resource_version: "v1".into(),
        classification: "audit".into(),
        lifetime_seconds: 3_600,
    }
}
fn policy(kind: PolicyKind, subject: &str) -> PolicyDocument {
    let d = disclosure();
    let t = target();
    let bounds = PermissionBounds {
        rules: vec![
            PermissionRule {
                purpose: d.purpose,
                action: d.action,
                account_id: d.account_id.clone(),
                environment_id: d.environment_id.clone(),
                destination: d.destination.clone(),
                resource_id: d.resource_id.clone(),
                recipients: d.recipients.clone(),
                attachment_classifications: vec!["audit".into()],
                expires_at: d.expires_at,
            },
            PermissionRule {
                purpose: Purpose::AuditCoordination,
                action: Action::Write,
                account_id: t.account_id.clone(),
                environment_id: t.environment_id.clone(),
                destination: t.destination.clone(),
                resource_id: t.resource_id.clone(),
                recipients: vec![],
                attachment_classifications: vec!["audit".into()],
                expires_at: 4_102_444_800,
            },
        ],
    };
    PolicyDocument {
        schema_version: 1,
        kind,
        subject_id: subject.into(),
        version: 1,
        actor_id: "actor-manager".into(),
        created_at: now(),
        revoked: false,
        hard: bounds.clone(),
        standing: bounds,
        parent: None,
        account: (kind == PolicyKind::Account).then(|| AccountRestriction {
            source: source(),
            account_id: "fixture-account".into(),
            environment_id: "audit-environment".into(),
            environment: EnvironmentKind::Audit,
            read_restriction: ReadRestriction::None,
            restriction_survives_takeover: false,
            test_environment_verified: false,
            test_resources: vec![],
            test_cleanup_id: None,
            audit_resources: vec!["analysis-resource".into(), "audit-resource".into()],
        }),
    }
}
fn delay(duration: Duration) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>> {
    Box::pin(tokio::time::sleep(duration))
}
const SETTINGS: AnalysisSettings = AnalysisSettings {
    poll: Duration::from_millis(200),
    stop_confirmation: Duration::from_secs(20),
    provisioning: Duration::from_secs(60),
    collect_attempts: 3,
    delay,
};
fn sse_reply(mut values: Vec<serde_json::Value>) -> Vec<u8> {
    for (sequence, value) in values.iter_mut().enumerate() {
        value["sequence_number"] = serde_json::json!(sequence);
    }
    let body: String = values
        .iter()
        .map(|v| {
            format!(
                "event: {}\r\ndata: {v}\r\n\r\n",
                v["type"].as_str().unwrap()
            )
        })
        .collect();
    format!(
        "HTTP/1.1 200 Fixture\r\nContent-Type: text/event-stream; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
    .into_bytes()
}
fn text_reply(text: &str) -> Vec<u8> {
    use serde_json::json;
    let part = json!({"type":"output_text","text":text});
    let item = json!({"id":"message-1","type":"message","role":"assistant","status":"completed","content":[part.clone()]});
    sse_reply(vec![
        json!({"type":"response.created","response":{"id":"response-1","model":"fixture-model","status":"in_progress"}}),
        json!({"type":"response.output_item.added","output_index":0,"item":{"id":"message-1","type":"message","role":"assistant","status":"in_progress","content":[]}}),
        json!({"type":"response.content_part.added","output_index":0,"item_id":"message-1","content_index":0,"part":{"type":"output_text","text":""}}),
        json!({"type":"response.output_text.delta","output_index":0,"item_id":"message-1","content_index":0,"delta":text}),
        json!({"type":"response.output_text.done","output_index":0,"item_id":"message-1","content_index":0,"text":text}),
        json!({"type":"response.content_part.done","output_index":0,"item_id":"message-1","content_index":0,"part":part}),
        json!({"type":"response.output_item.done","output_index":0,"item":item.clone()}),
        json!({"type":"response.completed","response":{"id":"response-1","model":"fixture-model","status":"completed","output":[item],"usage":{"input_tokens":17,"output_tokens":4}}}),
    ])
}

/// One structured answer with every field present (strict output).
async fn image_present() {
    let image = format!("{REPOSITORY}@{GENERAL_IMAGE_DIGEST}");
    let present = tokio::process::Command::new("docker")
        .args(["image", "inspect", &image])
        .output()
        .await
        .expect("a Docker engine is required for the skill script fixtures")
        .status
        .success();
    assert!(
        present,
        "the pinned general image {image} must be available"
    );
}

async fn register(admin: &mut PgConnection, objects: &S3EvidenceObjects, id: &str, filename: &str) {
    let bytes = std::fs::read(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures/documents")
            .join(filename),
    )
    .unwrap();
    let digest = sha(&bytes);
    let version = objects.put_if_absent(id, bytes.clone()).await.unwrap();
    let request = serde_json::json!({"key": id, "filename": filename, "sha256": digest, "size": bytes.len(), "system": null, "account": null, "source_version": null, "selection": null, "coverage": null}).to_string();
    sqlx::query("INSERT INTO public.evidence_reservations(id,organisation_id,client_id,engagement_id,actor_id,key,request,digest,size,namespace) VALUES($1,'org-a','client-a','engagement-a','actor-a',$1,$2,$3,$4,$5)")
        .bind(id).bind(&request).bind(&digest).bind(bytes.len() as i64).bind(NAMESPACE).execute(&mut *admin).await.unwrap();
    sqlx::query("INSERT INTO public.evidence_originals SELECT r.*, $2, r.reserved_at FROM public.evidence_reservations r WHERE id=$1")
        .bind(id).bind(&version).execute(&mut *admin).await.unwrap();
    sqlx::query("INSERT INTO public.trusted_attachment_metadata(organisation_id,client_id,engagement_id,source_key,attachment_id,digest,classification) VALUES('org-a','client-a','engagement-a','16:analysis-sandbox15:analysis-ledger',$1,$2,'audit')")
        .bind(id).bind(&digest).execute(&mut *admin).await.unwrap();
}

/// Subject, name, support and optional value, support reason and job ID.
type Responder = Arc<
    dyn Fn(usize, String) -> std::pin::Pin<Box<dyn std::future::Future<Output = Vec<u8>> + Send>>
        + Send
        + Sync,
>;

/// A loopback provider whose reply to request `n` (0-based) is computed from
/// the request body, recording each complete body. It stands in for a model
/// that reads the IDs trusted code reported in its context.
struct Loopback {
    endpoint: String,
    sends: Arc<AtomicUsize>,
    bodies: Arc<std::sync::Mutex<Vec<String>>>,
    _task: tokio::task::JoinHandle<()>,
}
impl Loopback {
    async fn answering(responder: Responder) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("http://{}/native", listener.local_addr().unwrap());
        let sends = Arc::new(AtomicUsize::new(0));
        let bodies = Arc::new(std::sync::Mutex::new(Vec::new()));
        let (count, seen) = (sends.clone(), bodies.clone());
        let task = tokio::spawn(async move {
            loop {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut buffer = vec![0u8; 16 << 20];
                let mut total = 0;
                let mut body = String::new();
                loop {
                    let n = socket.read(&mut buffer[total..]).await.unwrap_or(0);
                    if n == 0 {
                        break;
                    }
                    total += n;
                    let text = String::from_utf8_lossy(&buffer[..total]);
                    if let Some(end) = text.find("\r\n\r\n") {
                        let length = text[..end]
                            .lines()
                            .find_map(|l| {
                                l.to_ascii_lowercase()
                                    .strip_prefix("content-length: ")
                                    .and_then(|v| v.parse::<usize>().ok())
                            })
                            .unwrap_or(0);
                        if total >= end + 4 + length {
                            body = String::from_utf8_lossy(&buffer[end + 4..end + 4 + length])
                                .into_owned();
                            break;
                        }
                    }
                }
                let index = count.fetch_add(1, Ordering::SeqCst);
                seen.lock().unwrap().push(body.clone());
                let reply = responder(index, body).await;
                let _ = socket.write_all(&reply).await;
                let _ = socket.shutdown().await;
            }
        });
        Self {
            endpoint,
            sends,
            bodies,
            _task: task,
        }
    }
}

/// One structured answer with every field present (strict output).
fn answer(fields: serde_json::Value) -> String {
    let mut value = serde_json::json!({
        "segments": [], "limitations": [], "read_pages": [], "programs": [],
        "read_method": [], "use_skills": [], "run_skill_script": [], "method_notes": [],
        "propose_criteria": [], "propose_basis": [], "record_facts": [], "evaluate": [], "judgments": [],
        "propose_population": [], "propose_sample": [], "evaluate_population": [], "summarise": [], "carry_facts": [],
    });
    for (key, field) in fields.as_object().unwrap() {
        value[key] = field.clone();
    }
    value.to_string()
}
fn predicate(
    kind: &str,
    fact: &str,
    op: &str,
    constant: &str,
    currency: &str,
) -> serde_json::Value {
    serde_json::json!({"kind": kind, "fact": fact, "op": op, "right_fact": "", "constant": constant, "unit": "", "currency": currency, "values": []})
}
fn none() -> serde_json::Value {
    predicate("", "", "", "", "")
}
fn required(name: &str, kind: &str, currency: &str) -> serde_json::Value {
    serde_json::json!({"name": name, "type": kind, "unit": "", "currency": currency})
}
#[allow(clippy::too_many_arguments)]
fn criterion(
    key: &str,
    assertion: &str,
    authority: (&str, &str, &str, &str),
    applicability: serde_json::Value,
    required_facts: Vec<serde_json::Value>,
    method: &str,
    rule: serde_json::Value,
    rubric: &str,
) -> serde_json::Value {
    let (kind, requirement, locator, quote) = authority;
    serde_json::json!({
        "key": key, "supersedes": "", "assertion": assertion,
        "authority_kind": kind, "requirement_id": if kind == "method" { requirement } else { "" },
        "criterion_ordinal": 0,
        "original_id": if kind == "original" { requirement } else { "" },
        "locator": locator, "quote": quote,
        "effective_from": "", "effective_to": "",
        "applicability": applicability, "required_facts": required_facts,
        "method": method, "rule": rule, "rubric": rubric,
    })
}
#[allow(clippy::too_many_arguments)]
fn fact(
    basis: &str,
    subject: &str,
    name: &str,
    kind: &str,
    value: &str,
    currency: &str,
    rule: &str,
    sources: Vec<(&str, &str)>,
) -> serde_json::Value {
    serde_json::json!({
        "basis": basis, "subject": subject, "subject_unit": "invoice", "name": name,
        "value_kind": kind, "value": value, "unit": "", "currency": currency,
        "reason": "", "candidates": 0, "rule": rule,
        "sources": sources.iter().map(|(locator, quote)| serde_json::json!({"original_id": "ap-invoices", "locator": locator, "quote": quote})).collect::<Vec<_>>(),
        "job_id": "", "effective": "",
    })
}

/// A firm AP method whose AP-1 criterion the agent cites as authority.
fn ap_method() -> SaveMethodology {
    serde_json::from_value(serde_json::json!({
        "key": "ap-method", "expected_revision": 0, "supersedes": null, "undo_of": null,
        "assignment": {"kind":"firm","client_id":null,"engagement_id":null},
        "applicability": {"audit_area":null,"period_start":null,"period_end":null},
        "activation": {"mode":"new_tasks","available_at":0},
        "definition": {"name":"Accounts payable method","neutral_starter":false,
            "default_context":{"audit_area":"accounts_payable","period_start":"2026-01-01","period_end":"2026-12-31"},
            "templates": [],
            "requirements":[
                {"id":"AP-1","label":"Invoice approvals","mandatory":true,
                 "criteria":["Invoices above 1,000.00 USD require an approver"],"populations":["AP invoices"],
                 "evidence_checks":null,"ratings":null,"templates":null,"review_rules":null,"suitable_skills":null}
            ]},
        "source": {"kind":"authored","reference":null,"note":"Synthetic AP method"}
    }))
    .unwrap()
}

/// Wait until the Task waits for guidance after `turns` model sends.
async fn settle(tasks: &TaskRepository, provider: &Loopback, task_id: &str, turns: usize) {
    let deadline = Instant::now() + Duration::from_secs(300);
    loop {
        let task = tasks.get("actor-a", &scope(), task_id).await.unwrap();
        if provider.sends.load(Ordering::SeqCst) == turns && task.state == TaskState::Waiting {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "the assessment cycle did not settle: {} sends, Task {:?}",
            provider.sends.load(Ordering::SeqCst),
            task.state
        );
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

const SCOPE_QUERY: &str = "organisation_id=org-a&client_id=client-a";
const POLICY_QUOTE: &str = "Invoices above 1,000.00 USD require an approver.";

/// The amount of INV-0042 on `basis`, citing its row's amount, invoice and
/// currency cells.
fn amount(basis: &str) -> serde_json::Value {
    fact(
        basis,
        "INV-0042",
        "amount",
        "decimal",
        "1250.00",
        "USD",
        "decimal_grouped_comma",
        vec![
            ("cell:Sheet1!B2", "1,250.00"),
            ("cell:Sheet1!A2", "INV-0042"),
            ("cell:Sheet1!C2", "USD"),
        ],
    )
}
fn approver(basis: &str) -> serde_json::Value {
    fact(
        basis,
        "INV-0042",
        "approver",
        "identifier",
        "J. Smith",
        "",
        "identifier_exact",
        vec![
            ("cell:Sheet1!D2", "J. Smith"),
            ("cell:Sheet1!A2", "INV-0042"),
        ],
    )
}
async fn criterion_id(lookup: &sqlx::PgPool, task_id: &str, key: &str) -> String {
    sqlx::query_scalar(
        "SELECT id FROM public.assessment_criteria WHERE task_id=$1 AND document->>'key'=$2",
    )
    .bind(task_id)
    .bind(key)
    .fetch_one(lookup)
    .await
    .unwrap()
}
async fn basis_id(lookup: &sqlx::PgPool, task_id: &str, key: &str) -> String {
    sqlx::query_scalar(
        "SELECT id FROM public.assessment_bases WHERE task_id=$1 AND document->>'key'=$2",
    )
    .bind(task_id)
    .bind(key)
    .fetch_one(lookup)
    .await
    .unwrap()
}

/// A person's browser: the session cookie, its CSRF token and the expected
/// actor, as the web sends them.
struct Browser {
    client: reqwest_fixture::Client,
    address: String,
    origin: String,
    token: String,
    csrf: String,
    actor: String,
}
impl Browser {
    async fn dispose(
        &self,
        task_id: &str,
        revision_id: &str,
        body: &serde_json::Value,
    ) -> (u16, serde_json::Value) {
        let response = self
            .client
            .post(format!(
                "{}/engagements/engagement-a/tasks/{task_id}/assessment/revisions/{revision_id}/dispositions?{SCOPE_QUERY}",
                self.address
            ))
            .header("Cookie", format!("__Host-zobba-session={}", self.token))
            .header("Origin", &self.origin)
            .header("X-CSRF-Token", &self.csrf)
            .header("X-Expected-Actor", &self.actor)
            .header("Content-Type", "application/json")
            .body(body.to_string())
            .send()
            .await
            .unwrap();
        let status = response.status().as_u16();
        let bytes = response.bytes().await.unwrap();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
        )
    }
    async fn read(&self, route: &str, session: &str) -> (u16, serde_json::Value) {
        let response = self
            .client
            .get(format!(
                "{}/engagements/engagement-a/{route}{}{SCOPE_QUERY}",
                self.address,
                if route.contains('?') { '&' } else { '?' }
            ))
            .header("Cookie", format!("__Host-zobba-session={}", self.token))
            .header("X-Expected-Session", session)
            .send()
            .await
            .unwrap();
        let status = response.status().as_u16();
        let bytes = response.bytes().await.unwrap();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
        )
    }
}
async fn browser(
    identities: &IdentityRepository,
    address: &str,
    subject: &str,
    actor: &str,
) -> Browser {
    use zobba_application::identity::CurrentAuthority;
    let token = identities
        .establish_session(ISSUER, subject, subject, None)
        .await
        .unwrap();
    let session = identities.session(&token).await.unwrap();
    Browser {
        client: reqwest_fixture::Client::builder()
            .timeout(Duration::from_secs(20))
            .build()
            .unwrap(),
        address: address.into(),
        origin: std::env::var("ZOBBA_PUBLIC_ORIGIN")
            .expect("load the actual local fixture environment"),
        token,
        csrf: session.csrf_token,
        actor: actor.into(),
    }
}
fn disposition(
    key: &str,
    kind: &str,
    verdict: Option<&str>,
    concern: Option<&str>,
    rationale: &str,
    references: serde_json::Value,
) -> serde_json::Value {
    serde_json::json!({
        "key": key, "kind": kind, "verdict": verdict, "concern": concern,
        "rationale": rationale, "references": references,
    })
}
fn policy_reference() -> serde_json::Value {
    serde_json::json!([{"original_id": "ap-policy", "locator": "bytes:0-48", "quote": POLICY_QUOTE}])
}

type RevisionRow = (String, i32, String, Vec<String>, Option<String>, String);

async fn revisions(admin: &mut PgConnection, chain: &str) -> Vec<RevisionRow> {
    sqlx::query_as("SELECT id,revision,predecessor_id,causes,verdict,document::text FROM public.assessment_evaluation_revisions WHERE chain_id=$1 ORDER BY revision")
        .bind(chain)
        .fetch_all(admin)
        .await
        .unwrap()
}
async fn dispositions(admin: &mut PgConnection) -> i64 {
    sqlx::query_scalar("SELECT count(*) FROM public.assessment_dispositions")
        .fetch_one(admin)
        .await
        .unwrap()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn late_evidence_revises_and_a_person_disposes_without_changing_any_record() {
    image_present().await;
    zobba_infrastructure::analysis::docker::remove_all_test_resources().await;
    let configuration = support::Configuration::from_environment();
    let mut owner = PgConnection::connect(&configuration.migration)
        .await
        .unwrap();
    configuration.guard_connection(&mut owner).await;
    owner
        .execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public; REVOKE CREATE ON SCHEMA public FROM PUBLIC")
        .await
        .unwrap();
    migrate(
        &configuration.migration,
        database_options(&configuration.runtime)
            .unwrap()
            .get_username(),
    )
    .await
    .unwrap();
    seed_local_configured(ISSUER, &configuration.migration)
        .await
        .unwrap();
    let mut admin = PgConnection::connect(&configuration.admin).await.unwrap();
    configuration.guard_connection(&mut admin).await;
    let lookup = sqlx::PgPool::connect(&configuration.admin).await.unwrap();
    let database = RuntimeDatabase::connect(&configuration.runtime)
        .await
        .unwrap();
    let pool = database.pool().clone();

    let s3 = s3_protocol::Fixture::start().await;
    let store = || {
        S3EvidenceObjects::new(
            s3_protocol::build_fixture_store(&s3.endpoint).unwrap(),
            NAMESPACE.into(),
        )
        .unwrap()
    };
    let objects = Arc::new(store());
    register(&mut admin, &objects, "ap-invoices", "AP invoices.xlsx").await;
    register(&mut admin, &objects, "ap-policy", "AP policy.txt").await;

    let operations = OperationRepository::new(pool.clone());
    let organisation = policy(PolicyKind::Organisation, "org-a");
    let engagement = policy(PolicyKind::Engagement, "engagement-a");
    let member = policy(PolicyKind::Member, "actor-a");
    let account = policy(PolicyKind::Account, "fixture-account");
    for document in [&organisation, &engagement, &member, &account] {
        operations
            .save_policy("actor-manager", &scope(), document)
            .await
            .unwrap();
    }
    let identities = IdentityRepository::new(pool.clone());
    let manager = identities
        .establish_session(ISSUER, "manager-a", "Manager", None)
        .await
        .unwrap();
    let models = ModelRepository::new(pool.clone()).with_session_hash(secret_hash(&manager));
    models
        .save_profile(
            "actor-manager",
            "org-a",
            &ModelProfile {
                id: "loopback".into(),
                revision: 1,
                provider: Provider::OpenAi,
                model: "fixture-model".into(),
                destination: "fixture-destination".into(),
                account_id: "fixture-account".into(),
                capability_revision: "fixture-native-v1".into(),
                qualification: Qualification::Fixture,
                enabled: true,
                capabilities: Capabilities {
                    tools: false,
                    structured_output: true,
                    reasoning: false,
                    image_input: false,
                },
                max_output_tokens: 4_096,
            },
        )
        .await
        .unwrap();
    models
        .save_catalogue(
            "actor-manager",
            "org-a",
            &ToolCatalog {
                id: "no-tools".into(),
                revision: 1,
                enabled: true,
                tools: vec![],
            },
        )
        .await
        .unwrap();
    let methods = MethodologyRepository::new(pool.clone()).with_session_hash(secret_hash(&manager));
    methods
        .save("actor-manager", "org-a", &ap_method())
        .await
        .unwrap();

    let tasks = TaskRepository::new(pool.clone());
    let receipt = tasks
        .admit(
            "actor-a",
            &scope(),
            &TaskCommand {
                context: None,
                key: "ap-revision".into(),
                kind: CommandKind::Create,
                task_id: None,
                cycle_id: None,
                content: Some("Assess approval of 2026 AP invoices".into()),
            },
        )
        .await
        .unwrap();
    let mut authority = AuthoritySnapshot {
        scope: scope(),
        actor_id: "actor-a".into(),
        task_id: receipt.task_id.clone(),
        organisation,
        engagement,
        member,
        account,
        task: policy(PolicyKind::Task, &receipt.task_id),
        delegations: vec![],
    };
    authority.task.actor_id = "actor-a".into();
    operations
        .accept_authority("actor-a", &scope(), &receipt.task_id, &authority)
        .await
        .unwrap();

    let task_id = receipt.task_id.clone();
    let responder: Responder = Arc::new(move |index, _body| {
        let lookup = lookup.clone();
        let task_id = task_id.clone();
        Box::pin(async move {
            match index {
                // Turn 1: a rule and a judgment criterion, one basis, the
                // amount only, and an evaluation (undetermined: no approver).
                0 => text_reply(&answer(serde_json::json!({
                    "propose_criteria": [
                        criterion("approval", "Invoices above 1,000.00 USD require an approver", ("method", "AP-1", "", ""),
                            predicate("compare_constant", "amount", "gt", "1000.00", "USD"),
                            vec![required("amount", "decimal", "USD"), required("approver", "identifier", "")],
                            "rule", predicate("present", "approver", "", "", ""), ""),
                        criterion("segregation", "Segregation of duties is adequate given the organisation chart", ("method", "AP-1", "", ""),
                            none(), vec![required("approver", "identifier", "")],
                            "judgment", none(), "The approver and the requester report to different managers"),
                    ],
                    "propose_basis": [{
                        "key": "fy2026", "supersedes": "", "objective": "Assess approval of 2026 AP invoices",
                        "criteria": ["approval", "segregation"],
                        "period_from": "2026-01-01", "period_to": "2026-12-31", "as_of": "2026-03-31T00:00:00Z",
                        "population": [{"original_id": "ap-invoices", "unit": "invoice", "selection": "Every invoice in the AP export"}],
                        "limitations": [],
                    }],
                    "record_facts": [amount("fy2026")],
                    "evaluate": ["approval"],
                }))),
                // Turn 2: late evidence (the approver) on the same basis, the
                // evaluation again, and the judgment.
                1 => {
                    let b = basis_id(&lookup, &task_id, "fy2026").await;
                    let approval = criterion_id(&lookup, &task_id, "approval").await;
                    let segregation = criterion_id(&lookup, &task_id, "segregation").await;
                    text_reply(&answer(serde_json::json!({
                        "record_facts": [approver(&b)],
                        "evaluate": [approval],
                        "judgments": [{
                            "criterion": segregation, "basis": b, "subject": "INV-0042", "verdict": "met",
                            "supporting": ["approver"], "contrary": [],
                            "rationale": "J. Smith approves outside the requester's reporting line.",
                            "uncertainty": "The organisation chart in the evidence is dated 2025.",
                        }],
                    })))
                }
                // Turn 3: the same evaluation again: nothing changed, so
                // nothing is recorded, and the answer.
                2 => {
                    let approval = criterion_id(&lookup, &task_id, "approval").await;
                    text_reply(&answer(serde_json::json!({
                        "evaluate": [approval],
                        "segments": [{"text": "INV-0042 meets the approval criterion.", "sources": []}],
                    })))
                }
                // Turn 4 (after the person asks for reconsideration): a
                // successor basis carrying every fact except the amount,
                // the corrected amount on it, and the evaluation again.
                3 => {
                    let b = basis_id(&lookup, &task_id, "fy2026").await;
                    let approval = criterion_id(&lookup, &task_id, "approval").await;
                    let segregation = criterion_id(&lookup, &task_id, "segregation").await;
                    text_reply(&answer(serde_json::json!({
                        "propose_basis": [{
                            "key": "fy2026b", "supersedes": b, "objective": "Assess approval of 2026 AP invoices",
                            "criteria": [approval, segregation],
                            "period_from": "2026-01-01", "period_to": "2026-12-31", "as_of": "2026-03-31T00:00:00Z",
                            "population": [{"original_id": "ap-invoices", "unit": "invoice", "selection": "Every invoice in the AP export"}],
                            "limitations": [],
                        }],
                        "carry_facts": [{"basis": "fy2026b", "except": [{"subject": "INV-0042", "name": "amount"}]}],
                        "record_facts": [amount("fy2026b")],
                        "evaluate": [approval],
                    })))
                }
                _ => text_reply(&answer(serde_json::json!({
                    "segments": [{"text": "INV-0042 meets the approval criterion on the corrected basis.", "sources": []}],
                }))),
            }
        })
    });
    let provider = Loopback::answering(responder).await;

    let unused = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let gateway_address = unused.local_addr().unwrap();
    let staging = std::env::temp_dir().join(format!("zobba-revision-{}", std::process::id()));
    let runner: Arc<dyn zobba_worker::work::WorkRunner> = Arc::new(ReadingComposition {
        base: Composition {
            pool: pool.clone(),
            qualifications: Arc::new(Fixture),
            transport: Arc::new(
                NativeAdapter::test_loopback(
                    Provider::OpenAi,
                    &provider.endpoint,
                    Duration::from_secs(60),
                )
                .unwrap(),
            ),
            gateway: Gateway::qualification(
                gateway_address,
                SourceBinding {
                    endpoint_digest: sha(gateway_address.to_string().as_bytes()),
                    ..source()
                },
            )
            .unwrap(),
            disclosure: disclosure(),
            input_class: "audit".into(),
            max_output_tokens: 4_096,
            context: zobba_domain::context::ContextBudget::DEFAULT,
        },
        sandbox: Arc::new(DockerSandbox::explicit_test(REPOSITORY, &staging).unwrap()),
        objects: objects.clone(),
        allowlist: server_allowlist(),
        analysis_settings: SETTINGS,
        analysis: target(),
        classification: "audit".into(),
        investigation: true,
        assessment: true,
    });
    let config = executor::Config::new(std::path::PathBuf::from("/bin/false"), 10).unwrap();
    let (stop, shutdown) = tokio::sync::watch::channel(false);
    let worker = tokio::spawn(zobba_worker::coordinate_work(
        database.clone(),
        config,
        runner,
        shutdown,
    ));
    settle(&tasks, &provider, &receipt.task_id, 3).await;

    // Revision 1 of the approval chain is the 24.1 evaluation; the late
    // approver fact appends revision 2, caused by changed inputs, naming
    // exactly the fact it added; the third answer recorded nothing.
    let approval = criterion_id(
        &admin_pool(&configuration).await,
        &receipt.task_id,
        "approval",
    )
    .await;
    let segregation = criterion_id(
        &admin_pool(&configuration).await,
        &receipt.task_id,
        "segregation",
    )
    .await;
    let (chain, first_verdict, first_reason): (String, Option<String>, Option<String>) =
        sqlx::query_as(
            "SELECT id,verdict,reason FROM public.assessment_evaluations WHERE criterion_id=$1",
        )
        .bind(&approval)
        .fetch_one(&mut admin)
        .await
        .unwrap();
    assert_eq!(
        (first_verdict.as_deref(), first_reason.as_deref()),
        (Some("undetermined"), Some("missing_fact"))
    );
    let rows = revisions(&mut admin, &chain).await;
    assert_eq!(rows.len(), 1, "one revision: {rows:?}");
    let rev2 = rows[0].clone();
    assert_eq!(
        (rev2.1, rev2.2.as_str(), rev2.3.clone(), rev2.4.as_deref()),
        (
            2,
            chain.as_str(),
            vec!["inputs_changed".to_string()],
            Some("met")
        )
    );
    let approver_fact: String = sqlx::query_scalar(
        "SELECT id FROM public.assessment_facts WHERE name='approver' AND subject='INV-0042'",
    )
    .fetch_one(&mut admin)
    .await
    .unwrap();
    let rev2_document: serde_json::Value = serde_json::from_str(&rev2.5).unwrap();
    assert_eq!(
        rev2_document["changes"]["added"],
        serde_json::json!([approver_fact])
    );
    assert_eq!(rev2_document["changes"]["removed"], serde_json::json!([]));
    let evaluations: i64 = sqlx::query_scalar("SELECT count(*) FROM public.assessment_evaluations")
        .fetch_one(&mut admin)
        .await
        .unwrap();
    assert_eq!(evaluations, 2, "one evaluation per chain, never rewritten");
    let segregation_chain: String =
        sqlx::query_scalar("SELECT id FROM public.assessment_evaluations WHERE criterion_id=$1")
            .bind(&segregation)
            .fetch_one(&mut admin)
            .await
            .unwrap();
    let bodies = provider.bodies.lock().unwrap().clone();
    assert!(
        bodies[2].contains(&rev2.0),
        "the outline names the chain's head"
    );

    // The real API: dispositions by the people the engagement assigns.
    let auth = zobba_api::auth::AuthState::from_environment(&database).unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = format!("http://{}", listener.local_addr().unwrap());
    let app = zobba_api::authenticated_router_with_evidence(database.clone(), auth, Some(store()));
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let auditor = browser(&identities, &address, "auditor-a", "actor-a").await;
    let administrator = browser(&identities, &address, "admin-only", "actor-admin").await;
    let task = receipt.task_id.as_str();
    let segregation_before: String = sqlx::query_scalar(
        "SELECT document::text||verdict||output_digest FROM public.assessment_evaluations WHERE id=$1",
    )
    .bind(&segregation_chain)
    .fetch_one(&mut admin)
    .await
    .unwrap();
    let replace = disposition(
        "replace-segregation",
        "replaced",
        Some("not_met"),
        None,
        "The requester and J. Smith share a manager.",
        policy_reference(),
    );
    let (status, saved) = auditor.dispose(task, &segregation_chain, &replace).await;
    assert_eq!(status, 200, "{saved}");
    assert_eq!(saved["kind"], "replaced");
    assert_eq!(saved["verdict"], "not_met");
    assert_eq!(saved["actor_id"], "actor-a");
    assert_eq!(saved["references"][0]["quote"], POLICY_QUOTE);
    let segregation_after: String = sqlx::query_scalar(
        "SELECT document::text||verdict||output_digest FROM public.assessment_evaluations WHERE id=$1",
    )
    .bind(&segregation_chain)
    .fetch_one(&mut admin)
    .await
    .unwrap();
    assert_eq!(
        segregation_before, segregation_after,
        "the model's judgment is kept as it was"
    );
    // An exact retry returns the original; the key with another request is
    // refused.
    let (status, again) = auditor.dispose(task, &segregation_chain, &replace).await;
    assert_eq!((status, &again["id"]), (200, &saved["id"]));
    let mut changed = replace.clone();
    changed["rationale"] = serde_json::json!("Another reason.");
    let (status, refusal) = auditor.dispose(task, &segregation_chain, &changed).await;
    assert_eq!(
        (status, refusal["error"].as_str()),
        (409, Some("disposition_conflict"))
    );
    // A rule verdict is never replaced.
    let (status, refusal) = auditor
        .dispose(
            task,
            &rev2.0,
            &disposition(
                "replace-rule",
                "replaced",
                Some("not_met"),
                None,
                "No.",
                serde_json::json!([]),
            ),
        )
        .await;
    assert_eq!(
        (status, refusal["error"].as_str()),
        (400, Some("not_replaceable"))
    );
    // A superseded revision is refused and names the head.
    let (status, refusal) = auditor
        .dispose(
            task,
            &chain,
            &disposition(
                "accept-old",
                "accepted",
                None,
                None,
                "Agreed.",
                serde_json::json!([]),
            ),
        )
        .await;
    assert_eq!(
        (
            status,
            refusal["error"].as_str(),
            refusal["head_id"].as_str()
        ),
        (409, Some("revision_superseded"), Some(rev2.0.as_str()))
    );
    // One unverified reference refuses the whole request and names it.
    let (status, refusal) = auditor
        .dispose(
            task,
            &rev2.0,
            &disposition(
                "accept-unverified",
                "accepted",
                None,
                None,
                "Agreed.",
                serde_json::json!([
                    {"original_id": "ap-policy", "locator": "bytes:0-48", "quote": POLICY_QUOTE},
                    {"original_id": "ap-policy", "locator": "bytes:0-8", "quote": "Approved"},
                ]),
            ),
        )
        .await;
    assert_eq!(
        (status, refusal["error"].as_str(), refusal["index"].as_u64()),
        (409, Some("reference_unverified"), Some(1))
    );
    assert_eq!(dispositions(&mut admin).await, 1, "nothing written");
    // Admin alone is refused, and so is an auditor whose assignment ends.
    let accept = disposition(
        "accept-head",
        "accepted",
        None,
        None,
        "Agreed.",
        serde_json::json!([]),
    );
    let (status, refusal) = administrator.dispose(task, &rev2.0, &accept).await;
    assert_eq!(
        (status, refusal["error"].as_str()),
        (403, Some("access_denied")),
        "{refusal}"
    );
    sqlx::query("UPDATE public.engagement_assignments SET active=false WHERE actor_id='actor-a' AND organisation_id='org-a'")
        .execute(&mut admin)
        .await
        .unwrap();
    let (status, _) = auditor.dispose(task, &rev2.0, &accept).await;
    assert_eq!(status, 403, "a revoked assignment saves nothing");
    sqlx::query("UPDATE public.engagement_assignments SET active=true WHERE actor_id='actor-a' AND organisation_id='org-a'")
        .execute(&mut admin)
        .await
        .unwrap();
    assert_eq!(dispositions(&mut admin).await, 1, "nothing written");

    // Reconsideration wakes the Task; the person's words reach the model as
    // quoted data in the outline, and the model revises on a successor basis
    // that carries every fact except the corrected amount.
    let rationale = "The amount cell was re-keyed after approval; read the corrected export.";
    let (status, saved) = auditor
        .dispose(
            task,
            &rev2.0,
            &disposition(
                "reconsider-approval",
                "needs_reconsideration",
                None,
                Some("facts"),
                rationale,
                serde_json::json!([]),
            ),
        )
        .await;
    assert_eq!(status, 200, "{saved}");
    settle(&tasks, &provider, &receipt.task_id, 5).await;
    let bodies = provider.bodies.lock().unwrap().clone();
    let outline = bodies[3]
        .find("[zobba-data class=model-output source=assessment-outline]")
        .expect("the outline envelope");
    let words = bodies[3].find(rationale).expect("the person's words");
    assert!(words > outline, "the words are inside the outline envelope");
    assert!(bodies[3].contains("facts"));

    let rows = revisions(&mut admin, &chain).await;
    assert_eq!(rows.len(), 2, "{rows:?}");
    let rev3 = rows[1].clone();
    let successor = basis_id(&admin_pool(&configuration).await, task, "fy2026b").await;
    let first_basis = basis_id(&admin_pool(&configuration).await, task, "fy2026").await;
    assert_eq!(
        (rev3.1, rev3.2.as_str(), rev3.3.clone()),
        (
            3,
            rev2.0.as_str(),
            vec![
                "inputs_changed".to_string(),
                "basis_revised".to_string(),
                "reconsideration_requested".to_string()
            ]
        )
    );
    let rev3_document: serde_json::Value = serde_json::from_str(&rev3.5).unwrap();
    assert_eq!(rev3_document["basis_id"], successor.as_str());
    let (old_amount, new_amount): (String, String) = sqlx::query_as(
        "SELECT (SELECT id FROM public.assessment_facts WHERE basis_id=$1 AND name='amount'),(SELECT id FROM public.assessment_facts WHERE basis_id=$2 AND name='amount')",
    )
    .bind(&first_basis)
    .bind(&successor)
    .fetch_one(&mut admin)
    .await
    .unwrap();
    assert_eq!(
        rev3_document["changes"]["replaced"],
        serde_json::json!([{"from": old_amount, "to": new_amount}])
    );
    // The approver is carried by reference, with its original verification:
    // no fact row was copied.
    let (carried, carried_fact, facts): (i32, String, i64) = sqlx::query_as(
        "SELECT c.carried,(SELECT fact_id FROM public.assessment_basis_carried_facts WHERE basis_id=$1),(SELECT count(*) FROM public.assessment_facts) FROM public.assessment_basis_carries c WHERE c.basis_id=$1",
    )
    .bind(&successor)
    .fetch_one(&mut admin)
    .await
    .unwrap();
    assert_eq!(
        (carried, carried_fact.as_str(), facts),
        (1, approver_fact.as_str(), 3)
    );

    // The work view: chain heads with their derived review state.
    let (status, work) = auditor
        .read(&format!("tasks/{task}/work"), &auditor.csrf)
        .await;
    assert_eq!(status, 200);
    let chain_of = |criterion: &str| {
        work["assessment"]["evaluations"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["criterion_id"] == criterion)
            .unwrap()["chain"]
            .clone()
    };
    let approval_chain = chain_of(&approval);
    assert_eq!(
        (
            approval_chain["head_id"].as_str(),
            approval_chain["revision"].as_str(),
            approval_chain["review"].as_str()
        ),
        (Some(rev3.0.as_str()), Some("3"), Some("unreviewed"))
    );
    let segregation_view = chain_of(&segregation);
    assert_eq!(
        (
            segregation_view["verdict"].as_str(),
            segregation_view["effective_verdict"].as_str(),
            segregation_view["effective_origin"].as_str(),
            segregation_view["review"].as_str()
        ),
        (
            Some("met"),
            Some("not_met"),
            Some("human"),
            Some("replaced")
        )
    );
    assert!(!work.to_string().contains("confidence"));

    // The history route: every revision with its causes and dispositions,
    // paged by revision number.
    let history = format!("tasks/{task}/assessment/chains/{chain}/history");
    let (status, page) = auditor.read(&history, &auditor.csrf).await;
    assert_eq!(status, 200, "{page}");
    assert_eq!(
        (page["total"].as_str(), page["head_id"].as_str()),
        (Some("3"), Some(rev3.0.as_str()))
    );
    let entries = page["entries"].as_array().unwrap();
    assert_eq!(
        entries
            .iter()
            .map(|e| e["revision"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["1", "2", "3"]
    );
    assert_eq!(
        entries[1]["dispositions"][0]["kind"],
        "needs_reconsideration"
    );
    assert_eq!(entries[1]["dispositions"][0]["rationale"], rationale);
    assert!(page["next_cursor"].is_null());
    let (status, page) = auditor
        .read(&format!("{history}?cursor=2"), &auditor.csrf)
        .await;
    assert_eq!(status, 200);
    assert_eq!(page["entries"].as_array().unwrap().len(), 1);
    assert_eq!(page["entries"][0]["revision"], "3");
    let (status, _) = auditor
        .read(&format!("{history}?cursor=x"), &auditor.csrf)
        .await;
    assert_eq!(status, 400);
    let (status, _) = auditor.read(&history, "another-session").await;
    assert_eq!(status, 412, "a read bound to another session is refused");
    let unknown = format!(
        "tasks/{task}/assessment/chains/eval-{}/history",
        "0".repeat(40)
    );
    let (status, _) = auditor.read(&unknown, &auditor.csrf).await;
    assert_eq!(status, 403, "a chain this Task does not hold");
    let (status, _) = administrator.read(&history, &administrator.csrf).await;
    assert_eq!(status, 403, "Admin alone reads no assessment history");
    revision_fixture(&page_full(&auditor, &history).await);

    stop.send(true).unwrap();
    worker.await.unwrap();
    server.abort();

    database_guards_refuse_altered_revision_records(
        &mut admin,
        &mut owner,
        &pool,
        &chain,
        &rev3.0,
        &successor,
        &first_basis,
        &old_amount,
        &approver_fact,
    )
    .await;
    zobba_infrastructure::analysis::docker::remove_all_test_resources().await;
}

async fn admin_pool(configuration: &support::Configuration) -> sqlx::PgPool {
    sqlx::PgPool::connect(&configuration.admin).await.unwrap()
}
async fn page_full(browser: &Browser, history: &str) -> serde_json::Value {
    browser.read(history, &browser.csrf).await.1
}

/// The exact history JSON the web parses
/// (`web/tests/fixtures/task-revision.json`), with generated identifiers and
/// digests replaced by stable ones. Set `ZOBBA_UPDATE_REVISION_FIXTURE=1` to
/// rewrite it after an intended change.
fn revision_fixture(body: &serde_json::Value) {
    fn normalise(value: &mut serde_json::Value, ids: &mut Vec<String>) {
        match value {
            serde_json::Value::String(text) => {
                let generated = [
                    "eval-", "rev-", "fact-", "basis-", "crit-", "disp-", "inv-", "task-",
                    "cycle-", "binding-", "carry-",
                ]
                .iter()
                .any(|p| text.starts_with(p))
                    || (text.len() == 64 && text.bytes().all(|b| b.is_ascii_hexdigit()))
                    || (text.len() > 20 && text.bytes().all(|b| b.is_ascii_digit()));
                if generated {
                    let index = ids.iter().position(|i| i == text).unwrap_or_else(|| {
                        ids.push(text.clone());
                        ids.len() - 1
                    });
                    *text = format!("id-{index:03}");
                }
            }
            serde_json::Value::Array(items) => {
                for item in items {
                    normalise(item, ids);
                }
            }
            serde_json::Value::Object(map) => {
                for (key, item) in map.iter_mut() {
                    if key == "methodology_binding_id" {
                        *item = serde_json::json!("binding");
                    } else if key.ends_with("_us") || key == "recorded_at" {
                        *item = serde_json::json!("0");
                    } else {
                        normalise(item, ids);
                    }
                }
            }
            _ => {}
        }
    }
    let mut body = body.clone();
    // Facts are listed by their generated IDs: order them by name and then by
    // basis version (the first basis before its successor) for a stable file.
    let first_basis = body["entries"][0]["basis_id"].clone();
    if let Some(facts) = body["facts"].as_array_mut() {
        facts.sort_by_key(|f| {
            (
                f["name"].as_str().unwrap_or_default().to_string(),
                f["basis_id"] != first_basis,
            )
        });
    }
    normalise(&mut body, &mut Vec::new());
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../web/tests/fixtures/task-revision.json");
    let text = format!("{}\n", serde_json::to_string_pretty(&body).unwrap());
    if std::env::var("ZOBBA_UPDATE_REVISION_FIXTURE").as_deref() == Ok("1") {
        std::fs::write(&path, text).unwrap();
    } else {
        let stored = std::fs::read_to_string(&path).unwrap_or_default();
        assert_eq!(
            stored, text,
            "set ZOBBA_UPDATE_REVISION_FIXTURE=1 to update {path:?}"
        );
    }
}

/// The message of a refused statement (the database's own words).
async fn refused(conn: &mut PgConnection, statement: &str) -> String {
    sqlx::query(statement)
        .execute(&mut *conn)
        .await
        .expect_err(statement)
        .to_string()
}
fn assert_refused(message: &str, expected: &str, statement: &str) {
    assert!(message.contains(expected), "{statement}: {message}");
}

/// A forged revision: a copy of `source` with each column and document
/// field set, under a new ID.
fn forged_revision(source: &str, id: &str, sets: &[(&str, &str, &str)]) -> String {
    let mut document = format!("jsonb_set(r.document,'{{id}}',to_jsonb('{id}'::text))");
    let mut columns = vec![("id".to_string(), format!("'{id}'"))];
    for (column, sql, json) in sets {
        document = format!("jsonb_set({document},'{{{column}}}','{json}')");
        columns.push(((*column).to_string(), (*sql).to_string()));
    }
    let names = [
        "organisation_id",
        "client_id",
        "engagement_id",
        "task_id",
        "cycle_id",
        "actor_id",
        "invocation_id",
        "ordinal",
        "id",
        "methodology_binding_id",
        "execution_epoch",
        "chain_id",
        "revision",
        "predecessor_id",
        "basis_id",
        "criterion_id",
        "subject",
        "applicability",
        "execution",
        "verdict",
        "reason",
        "origin",
        "causes",
        "output_digest",
        "digest",
    ];
    let values: Vec<String> = names
        .iter()
        .map(|n| {
            columns
                .iter()
                .find(|(c, _)| c == n)
                .map_or(format!("r.{n}"), |(_, v)| v.clone())
        })
        .collect();
    format!(
        "INSERT INTO public.assessment_evaluation_revisions({},document) SELECT {},{document} FROM public.assessment_evaluation_revisions r WHERE r.id='{source}'",
        names.join(","),
        values.join(","),
    )
}

/// Revision, carry and disposition records are immutable even for the owner
/// and under the fixture reset (which may only delete), and the database
/// refuses forks, forged causes and changes, stale or rule-replacing
/// dispositions, and a carry that does not hold exactly its facts. Every
/// refusal is checked by its own message.
#[allow(clippy::too_many_arguments)]
async fn database_guards_refuse_altered_revision_records(
    admin: &mut PgConnection,
    owner: &mut PgConnection,
    pool: &sqlx::PgPool,
    chain: &str,
    head: &str,
    successor: &str,
    first_basis: &str,
    old_amount: &str,
    approver: &str,
) {
    let tables = [
        "assessment_basis_carries",
        "assessment_basis_carried_facts",
        "assessment_evaluation_revisions",
        "assessment_dispositions",
    ];
    for table in tables {
        let statement = format!("UPDATE public.{table} SET actor_id=actor_id");
        assert_refused(
            &refused(admin, &statement).await,
            "revision records are immutable",
            &statement,
        );
        let statement = format!("DELETE FROM public.{table}");
        assert_refused(
            &refused(admin, &statement).await,
            "revision records are immutable",
            &statement,
        );
        let statement = format!("TRUNCATE public.{table} CASCADE");
        assert_refused(
            &refused(admin, &statement).await,
            "revision records are retained",
            &statement,
        );
        // The fixture reset may delete in a disposable `_test` database, but
        // never rewrite.
        let mut reset = admin.begin().await.unwrap();
        sqlx::query("SET LOCAL zobba.disposable_fixture_reset='on'")
            .execute(&mut *reset)
            .await
            .unwrap();
        let message = sqlx::query(&format!("UPDATE public.{table} SET actor_id=actor_id"))
            .execute(&mut *reset)
            .await
            .unwrap_err()
            .to_string();
        assert_refused(&message, "revision records are immutable", table);
        reset.rollback().await.unwrap();
        assert!(
            sqlx::query(&format!("DELETE FROM public.{table}"))
                .execute(pool)
                .await
                .is_err(),
            "runtime deleted from {table}"
        );
        let changed = sqlx::query(&format!("UPDATE public.{table} SET actor_id=actor_id"))
            .execute(&mut *owner)
            .await
            .unwrap()
            .rows_affected();
        assert_eq!(changed, 0, "the owner updated {table}");
        let statement = format!("TRUNCATE public.{table} CASCADE");
        assert_refused(
            &refused(owner, &statement).await,
            "revision records are retained",
            &statement,
        );
    }
    // Under scope GUCs a scoped role sees the rows; without them, none.
    let visible: i64 =
        sqlx::query_scalar("SELECT count(*) FROM public.assessment_evaluation_revisions")
            .fetch_one(&mut *owner)
            .await
            .unwrap();
    assert_eq!(visible, 0, "forced RLS hides revisions without a scope");

    let forged_id = |n: u32| format!("rev-{n:040x}");
    // A fork: a second successor of a revision that is no longer the head.
    let previous: String = sqlx::query_scalar(
        "SELECT predecessor_id FROM public.assessment_evaluation_revisions WHERE id=$1",
    )
    .bind(head)
    .fetch_one(&mut *admin)
    .await
    .unwrap();
    let statement = forged_revision(head, &forged_id(1), &[]);
    let message = refused(admin, &statement).await;
    assert!(
        message.contains("a revision succeeds the current head of its chain")
            || message.contains("a revision names the revision before it in its chain"),
        "{statement}: {message}"
    );
    let _ = previous;
    // A successor of the head that states a cause trusted code does not
    // derive (nothing changed since the head).
    let statement = forged_revision(
        head,
        &forged_id(2),
        &[
            ("revision", "4", "4"),
            (
                "predecessor_id",
                &format!("'{head}'"),
                &format!("\"{head}\""),
            ),
            (
                "causes",
                "ARRAY['criterion_revised']",
                "[\"criterion_revised\"]",
            ),
        ],
    );
    assert_refused(
        &refused(admin, &statement).await,
        "a revision states exactly the causes trusted code derives from its predecessor",
        &statement,
    );
    // Revision 3 that names its chain's first evaluation as predecessor.
    let statement = forged_revision(
        head,
        &forged_id(3),
        &[(
            "predecessor_id",
            &format!("'{chain}'"),
            &format!("\"{chain}\""),
        )],
    );
    assert_refused(
        &refused(admin, &statement).await,
        "a revision names the revision before it in its chain",
        &statement,
    );
    // A second first evaluation of a subject in the same lineage.
    let statement = format!(
        "INSERT INTO public.assessment_evaluations(organisation_id,client_id,engagement_id,task_id,cycle_id,actor_id,invocation_id,ordinal,id,methodology_binding_id,execution_epoch,basis_id,criterion_id,subject,applicability,execution,verdict,reason,origin,document,output_digest,digest) SELECT e.organisation_id,e.client_id,e.engagement_id,e.task_id,e.cycle_id,e.actor_id,e.invocation_id,e.ordinal+100,'eval-{z}',e.methodology_binding_id,e.execution_epoch,e.basis_id,e.criterion_id,e.subject,e.applicability,e.execution,e.verdict,e.reason,e.origin,jsonb_set(jsonb_set(jsonb_set(e.document,'{{id}}','\"eval-{z}\"'),'{{ordinal}}',to_jsonb(e.ordinal+100)),'{{basis_id}}',to_jsonb(e.basis_id)),e.output_digest,e.digest FROM public.assessment_evaluations e WHERE e.id='{chain}'",
        z = "f".repeat(40)
    );
    assert_refused(
        &refused(admin, &statement).await,
        "is a revision of that chain",
        &statement,
    );

    // Dispositions: on a superseded revision, a replaced rule verdict, and
    // by an Admin who is not assigned.
    let forged_disposition = |id: &str, sets: &[(&str, &str, &str)]| {
        let mut document =
            format!("jsonb_set(jsonb_set(d.document,'{{id}}','\"{id}\"'),'{{key}}','\"{id}\"')");
        let mut columns = vec![("id", format!("'{id}'")), ("key", format!("'{id}'"))];
        for (column, sql, json) in sets {
            document = format!("jsonb_set({document},'{{{column}}}','{json}')");
            columns.push((column, (*sql).to_string()));
        }
        let names = [
            "organisation_id",
            "client_id",
            "engagement_id",
            "task_id",
            "actor_id",
            "id",
            "key",
            "chain_id",
            "revision",
            "revision_id",
            "kind",
            "concern",
            "verdict",
            "rationale",
            "digest",
        ];
        let values: Vec<String> = names
            .iter()
            .map(|n| {
                columns
                    .iter()
                    .find(|(c, _)| c == n)
                    .map_or(format!("d.{n}"), |(_, v)| v.clone())
            })
            .collect();
        format!(
            "INSERT INTO public.assessment_dispositions({},document) SELECT {},{document} FROM public.assessment_dispositions d WHERE d.kind='needs_reconsideration'",
            names.join(","),
            values.join(","),
        )
    };
    let id = |n: u32| format!("disp-{n:040x}");
    let statement = forged_disposition(&id(1), &[]);
    assert_refused(
        &refused(admin, &statement).await,
        "a disposition names the current head of its chain",
        &statement,
    );
    let statement = forged_disposition(
        &id(2),
        &[
            ("revision", "3", "3"),
            ("revision_id", &format!("'{head}'"), &format!("\"{head}\"")),
            ("kind", "'replaced'", "\"replaced\""),
            ("concern", "NULL", "null"),
            ("verdict", "'not_met'", "\"not_met\""),
        ],
    );
    assert_refused(
        &refused(admin, &statement).await,
        "a deterministic verdict cannot be replaced",
        &statement,
    );
    let statement = forged_disposition(
        &id(3),
        &[
            ("actor_id", "'actor-admin'", "\"actor-admin\""),
            ("revision", "3", "3"),
            ("revision_id", &format!("'{head}'"), &format!("\"{head}\"")),
        ],
    );
    assert_refused(
        &refused(admin, &statement).await,
        "a disposition is saved by a currently assigned auditor or audit manager",
        &statement,
    );

    // Carried facts: a two-row statement with exactly one bad row (the
    // excepted amount) is refused as a whole.
    let mut reset = admin.begin().await.unwrap();
    sqlx::query("SET LOCAL zobba.disposable_fixture_reset='on'")
        .execute(&mut *reset)
        .await
        .unwrap();
    sqlx::query("DELETE FROM public.assessment_basis_carried_facts WHERE basis_id=$1")
        .bind(successor)
        .execute(&mut *reset)
        .await
        .unwrap();
    let statement = format!(
        "INSERT INTO public.assessment_basis_carried_facts SELECT c.organisation_id,c.client_id,c.engagement_id,c.task_id,c.actor_id,c.basis_id,f.id,c.from_basis_id FROM public.assessment_basis_carries c CROSS JOIN (VALUES ('{approver}'),('{old_amount}')) f(id) WHERE c.basis_id='{successor}'"
    );
    let message = sqlx::query(&statement)
        .execute(&mut *reset)
        .await
        .unwrap_err()
        .to_string();
    assert_refused(&message, "an excepted fact is not carried", &statement);
    reset.rollback().await.unwrap();
    // A carried fact from a basis that is not the carry's.
    let statement = format!(
        "INSERT INTO public.assessment_basis_carried_facts SELECT c.organisation_id,c.client_id,c.engagement_id,c.task_id,c.actor_id,c.basis_id,'{old_amount}','{successor}' FROM public.assessment_basis_carries c WHERE c.basis_id='{successor}'"
    );
    assert_refused(
        &refused(admin, &statement).await,
        "a carried fact belongs to its basis's carry",
        &statement,
    );
    let _ = first_basis;
}
