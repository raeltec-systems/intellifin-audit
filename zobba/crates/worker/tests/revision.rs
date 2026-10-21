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
        "summarise_effective": [], "draft_work_product": [],
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
    let saved_segregation_id = saved["id"].clone();
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
    // The resume is a Task event written with the disposition, before any
    // work the worker does afterwards.
    let before: i64 = sqlx::query_scalar("SELECT coalesce(max(cursor),0) FROM public.task_events")
        .fetch_one(&mut admin)
        .await
        .unwrap();
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
    let first_event: (String, String) = sqlx::query_as(
        "SELECT kind, task_id FROM public.task_events WHERE cursor > $1 ORDER BY cursor LIMIT 1",
    )
    .bind(before)
    .fetch_one(&mut admin)
    .await
    .unwrap();
    assert_eq!(
        first_event,
        ("observed".to_string(), receipt.task_id.clone()),
        "the resume is recorded as the Task's own event"
    );
    settle(&tasks, &provider, &receipt.task_id, 5).await;
    let bodies = provider.bodies.lock().unwrap().clone();
    // The person's words travel in their own message, attributed to the
    // person (never model output), escaped as a quoted string.
    let envelope = bodies[3]
        .find("[zobba-data class=person-input source=assessment-reconsiderations]")
        .expect("the reconsiderations envelope");
    let words = bodies[3].find(rationale).expect("the person's words");
    assert!(words > envelope, "the words are inside their envelope");
    assert!(bodies[3].contains(&format!(
        "- reconsideration {} of {} (",
        saved["id"].as_str().unwrap(),
        rev2.0
    )));
    assert!(bodies[3].contains("concern facts"));

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

    // A disposition racing a revision of the same head: the revision holds
    // the chain lock; the disposition waits, then is refused naming the
    // new head. Nothing of the disposition is written.
    let lookup = admin_pool(&configuration).await;
    let written = dispositions(&mut admin).await;
    {
        let mut racing = admin.begin().await.unwrap();
        sqlx::query(&forged_successor(
            &rev3.0,
            &rev_id(4),
            500,
            &without_input(&approver_fact),
            &["inputs_changed"],
            &format!("'{{\"added\":[],\"removed\":[\"{approver_fact}\"],\"replaced\":[]}}'::jsonb"),
        ))
        .execute(&mut *racing)
        .await
        .unwrap();
        let accept = disposition(
            "accept-racing",
            "accepted",
            None,
            None,
            "Agreed.",
            serde_json::json!([]),
        );
        let (refusal, ()) = tokio::join!(auditor.dispose(task, &rev3.0, &accept), async {
            waiting_on_lock(&lookup).await;
            racing.commit().await.unwrap();
        });
        assert_eq!(
            (
                refusal.0,
                refusal.1["error"].as_str(),
                refusal.1["head_id"].as_str()
            ),
            (409, Some("revision_superseded"), Some(rev_id(4).as_str())),
            "{refusal:?}"
        );
    }
    assert_eq!(dispositions(&mut admin).await, written, "nothing written");
    // Two revisions of one head at once: the second waits on the chain lock
    // and is refused once the first commits (no fork).
    {
        let plus_approver = with_input(&approver_fact);
        let added =
            format!("'{{\"added\":[\"{approver_fact}\"],\"removed\":[],\"replaced\":[]}}'::jsonb");
        let mut second = PgConnection::connect(&configuration.admin).await.unwrap();
        configuration.guard_connection(&mut second).await;
        let mut first = admin.begin().await.unwrap();
        sqlx::query(&forged_successor(
            &rev_id(4),
            &rev_id(5),
            501,
            &plus_approver,
            &["inputs_changed"],
            &added,
        ))
        .execute(&mut *first)
        .await
        .unwrap();
        let fork = forged_successor(
            &rev_id(4),
            &rev_id(6),
            502,
            &plus_approver,
            &["inputs_changed"],
            &added,
        );
        let ((), forked) = tokio::join!(
            async {
                waiting_on_lock(&lookup).await;
                first.commit().await.unwrap();
            },
            sqlx::query(&fork).execute(&mut second)
        );
        let message = forked.expect_err("a fork").to_string();
        assert!(
            message.contains("a revision succeeds the current head of its chain"),
            "{message}"
        );
        let heads: Vec<String> = sqlx::query_scalar(
            "SELECT id FROM public.assessment_evaluation_revisions WHERE predecessor_id=$1",
        )
        .bind(rev_id(4))
        .fetch_all(&mut admin)
        .await
        .unwrap();
        assert_eq!(heads, vec![rev_id(5)], "exactly one successor");
    }
    reset_delete(
        &mut admin,
        "assessment_evaluation_revisions",
        &[rev_id(5), rev_id(4)],
    )
    .await;

    // A paused Task stays paused when a person asks to reconsider; resumed,
    // it runs one turn that shows the request and then waits (a shown request
    // the model does not act on never loops).
    let pause = TaskCommand {
        context: None,
        key: "pause-revision".into(),
        kind: CommandKind::Pause,
        task_id: Some(receipt.task_id.clone()),
        cycle_id: Some(
            tasks
                .get("actor-a", &scope(), task)
                .await
                .unwrap()
                .cycle_id
                .clone(),
        ),
        content: None,
    };
    tasks.admit("actor-a", &scope(), &pause).await.unwrap();
    let paused_revision = tasks.get("actor-a", &scope(), task).await.unwrap().revision;
    let (status, reconsider_head) = auditor
        .dispose(
            task,
            &rev3.0,
            &disposition(
                "reconsider-paused",
                "needs_reconsideration",
                None,
                Some("rule"),
                "Check the rule against the policy text.",
                serde_json::json!([]),
            ),
        )
        .await;
    assert_eq!(status, 200, "{reconsider_head}");
    let paused = tasks.get("actor-a", &scope(), task).await.unwrap();
    assert_eq!(
        (paused.state, paused.revision),
        (TaskState::Paused, paused_revision),
        "a paused Task stays paused"
    );
    tokio::time::sleep(Duration::from_secs(2)).await;
    assert_eq!(
        provider.sends.load(Ordering::SeqCst),
        5,
        "no turn while paused"
    );
    let resume = TaskCommand {
        key: "resume-revision".into(),
        kind: CommandKind::Resume,
        ..pause.clone()
    };
    tasks.admit("actor-a", &scope(), &resume).await.unwrap();
    settle(&tasks, &provider, &receipt.task_id, 6).await;
    let bodies = provider.bodies.lock().unwrap().clone();
    assert!(bodies[5].contains(&format!(
        "- reconsideration {} of {} (",
        reconsider_head["id"].as_str().unwrap(),
        rev3.0
    )));
    tokio::time::sleep(Duration::from_secs(2)).await;
    assert_eq!(provider.sends.load(Ordering::SeqCst), 6, "no further turn");

    // No cap (owner decision 2026-10-21): a revision is never permanently
    // undecidable. The segregation head holds one; 199 more are saved, the
    // 17th among them.
    let started = std::time::Instant::now();
    let mut saved_ids = vec![saved_segregation_id.as_str().unwrap().to_string()];
    for n in 0..199 {
        let mut again = replace.clone();
        again["key"] = serde_json::json!(format!("replace-{n}"));
        again["rationale"] = serde_json::json!(format!("Reason {n}."));
        let (status, body) = auditor.dispose(task, &segregation_chain, &again).await;
        assert_eq!(status, 200, "disposition {}: {body}", n + 2);
        saved_ids.push(body["id"].as_str().unwrap().to_string());
    }
    let saving = started.elapsed();
    assert!(
        saving < Duration::from_secs(120),
        "200 saves took {saving:?}"
    );
    let stored: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM public.assessment_dispositions WHERE revision_id=$1",
    )
    .bind(&segregation_chain)
    .fetch_one(&mut admin)
    .await
    .unwrap();
    assert_eq!(stored, 200, "the 17th and every later disposition is kept");
    // The effective review is the newest disposition (the 200th).
    let (status, work) = auditor
        .read(&format!("tasks/{task}/work"), &auditor.csrf)
        .await;
    assert_eq!(status, 200, "{work}");
    let head = work["assessment"]["evaluations"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["chain"]["chain_id"] == segregation_chain.as_str())
        .unwrap()["chain"]
        .clone();
    assert_eq!(
        (head["disposition"]["id"].as_str(), head["review"].as_str()),
        (Some(saved_ids.last().unwrap().as_str()), Some("replaced")),
        "the chain head shows its newest disposition"
    );
    // The history lists the revision's first 16 and its exact count; the
    // rest are read in bounded pages, in order, each disposition once.
    let read_started = std::time::Instant::now();
    let (status, page) = auditor
        .read(
            &format!("tasks/{task}/assessment/chains/{segregation_chain}/history"),
            &auditor.csrf,
        )
        .await;
    assert_eq!(status, 200, "{page}");
    let entry = &page["entries"][0];
    assert_eq!(entry["dispositions"].as_array().unwrap().len(), 16);
    assert_eq!(entry["dispositions_total"], "200");
    assert_eq!(
        entry["dispositions_next_cursor"].as_str(),
        entry["dispositions"][15]["id"].as_str()
    );
    let mut paged: Vec<String> = entry["dispositions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|d| d["id"].as_str().unwrap().to_string())
        .collect();
    let mut cursor = entry["dispositions_next_cursor"]
        .as_str()
        .map(str::to_string);
    let mut pages = 0;
    while let Some(after) = cursor {
        let (status, body) = auditor
            .read(
                &format!("tasks/{task}/assessment/revisions/{segregation_chain}/dispositions?cursor={after}"),
                &auditor.csrf,
            )
            .await;
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["total"], "200");
        let listed = body["dispositions"].as_array().unwrap();
        assert!(!listed.is_empty() && listed.len() <= 50, "a bounded page");
        paged.extend(listed.iter().map(|d| d["id"].as_str().unwrap().to_string()));
        cursor = body["next_cursor"].as_str().map(str::to_string);
        if cursor.is_some() {
            assert_eq!(listed.len(), 50);
            assert_eq!(cursor.as_deref(), listed[49]["id"].as_str());
        }
        pages += 1;
        assert!(pages <= 4, "pages end");
    }
    assert_eq!(pages, 4, "184 after the first 16: 50, 50, 50, 34");
    assert_eq!(paged, saved_ids, "every disposition once, oldest first");
    let reading = read_started.elapsed();
    assert!(reading < Duration::from_secs(20), "paging took {reading:?}");
    // A cursor that is not one of this revision's dispositions is refused,
    // and so is a malformed one.
    let (status, _) = auditor
        .read(
            &format!(
                "tasks/{task}/assessment/revisions/{segregation_chain}/dispositions?cursor=disp-{}",
                "0".repeat(40)
            ),
            &auditor.csrf,
        )
        .await;
    assert_eq!(status, 400, "an unknown cursor");
    let (status, _) = auditor
        .read(
            &format!(
                "tasks/{task}/assessment/revisions/{segregation_chain}/dispositions?cursor=17"
            ),
            &auditor.csrf,
        )
        .await;
    assert_eq!(status, 400, "a malformed cursor");
    let (status, first) = auditor
        .read(
            &format!("tasks/{task}/assessment/revisions/{segregation_chain}/dispositions"),
            &auditor.csrf,
        )
        .await;
    assert_eq!(status, 200);
    assert_eq!(first["dispositions"].as_array().unwrap().len(), 50);
    assert_eq!(
        first["dispositions"][0]["id"].as_str(),
        Some(saved_ids[0].as_str())
    );
    // An exact retry of a saved key still returns the original.
    let (status, again) = auditor.dispose(task, &segregation_chain, &replace).await;
    assert_eq!((status, &again["id"]), (200, &saved_segregation_id));
    // An exact replay is answered only after authority is checked again.
    sqlx::query("UPDATE public.engagement_assignments SET active=false WHERE actor_id='actor-a' AND organisation_id='org-a'")
        .execute(&mut admin)
        .await
        .unwrap();
    let (status, refusal) = auditor.dispose(task, &segregation_chain, &replace).await;
    assert_eq!(
        (status, refusal["error"].as_str()),
        (403, Some("access_denied")),
        "a replay never returns the original to a revoked actor"
    );
    sqlx::query("UPDATE public.engagement_assignments SET active=true WHERE actor_id='actor-a' AND organisation_id='org-a'")
        .execute(&mut admin)
        .await
        .unwrap();
    // An Admin with an assignment on the engagement is still not an auditor.
    sqlx::query("INSERT INTO public.engagement_assignments(organisation_id,client_id,engagement_id,actor_id) VALUES('org-a','client-a','engagement-a','actor-admin')")
        .execute(&mut admin)
        .await
        .unwrap();
    let (status, refusal) = administrator
        .dispose(
            task,
            &rev3.0,
            &disposition(
                "admin-assigned",
                "accepted",
                None,
                None,
                "Agreed.",
                serde_json::json!([]),
            ),
        )
        .await;
    assert_eq!(
        (status, refusal["error"].as_str()),
        (403, Some("access_denied")),
        "{refusal}"
    );
    sqlx::query(
        "UPDATE public.engagement_assignments SET active=false WHERE actor_id='actor-admin'",
    )
    .execute(&mut admin)
    .await
    .unwrap();

    stop.send(true).unwrap();
    worker.await.unwrap();

    // Another Task of the same engagement holds none of these chains.
    let other = tasks
        .admit(
            "actor-a",
            &scope(),
            &TaskCommand {
                context: None,
                key: "ap-other".into(),
                kind: CommandKind::Create,
                task_id: None,
                cycle_id: None,
                content: Some("Another assessment".into()),
            },
        )
        .await
        .unwrap();
    let (status, refusal) = auditor
        .dispose(
            &other.task_id,
            &rev3.0,
            &disposition(
                "other-task",
                "accepted",
                None,
                None,
                "Agreed.",
                serde_json::json!([]),
            ),
        )
        .await;
    assert_eq!(
        (status, refusal["error"].as_str()),
        (404, Some("revision_not_found"))
    );
    let (status, _) = auditor
        .read(
            &format!("tasks/{}/assessment/chains/{chain}/history", other.task_id),
            &auditor.csrf,
        )
        .await;
    assert_eq!(status, 403, "another Task's history read of this chain");
    server.abort();

    database_guards_refuse_altered_revision_records(
        &mut admin,
        &mut owner,
        &pool,
        &Records {
            chain: chain.clone(),
            head: rev3.0.clone(),
            previous: rev2.0.clone(),
            successor: successor.clone(),
            first_basis: first_basis.clone(),
            old_amount: old_amount.clone(),
            new_amount: new_amount.clone(),
            approver: approver_fact.clone(),
            segregation: segregation_chain.clone(),
            other_task: other.task_id.clone(),
            session: secret_hash(&auditor.token),
        },
    )
    .await;
    zobba_infrastructure::analysis::docker::remove_all_test_resources().await;
}

fn rev_id(n: u32) -> String {
    format!("rev-{n:040x}")
}
/// The head's inputs without one fact (a SQL jsonb expression over `r`).
fn without_input(fact: &str) -> String {
    format!(
        "(SELECT coalesce(jsonb_agg(x ORDER BY x->>'id'),'[]'::jsonb) FROM jsonb_array_elements(r.document->'inputs') x WHERE x->>'id' <> '{fact}')"
    )
}
/// The head's inputs with one more fact and its exact digest.
fn with_input(fact: &str) -> String {
    format!(
        "(r.document->'inputs') || (SELECT jsonb_build_array(jsonb_build_object('digest',f.digest,'id',f.id)) FROM public.assessment_facts f WHERE f.id='{fact}')"
    )
}
/// A forged successor of `head` (a copy of it as revision n+1) with the
/// given inputs, causes and changes, under a new ID and ordinal.
fn forged_successor(
    head: &str,
    id: &str,
    ordinal: i32,
    inputs: &str,
    causes: &[&str],
    changes: &str,
) -> String {
    let causes = causes
        .iter()
        .map(|c| format!("'{c}'"))
        .collect::<Vec<_>>()
        .join(",");
    let causes = format!("ARRAY[{causes}]::text[]");
    format!(
        "INSERT INTO public.assessment_evaluation_revisions(organisation_id,client_id,engagement_id,task_id,cycle_id,actor_id,invocation_id,ordinal,id,methodology_binding_id,execution_epoch,chain_id,revision,predecessor_id,basis_id,criterion_id,subject,applicability,execution,verdict,reason,origin,causes,output_digest,digest,document) \
         SELECT r.organisation_id,r.client_id,r.engagement_id,r.task_id,r.cycle_id,r.actor_id,r.invocation_id,{ordinal},'{id}',r.methodology_binding_id,r.execution_epoch,r.chain_id,r.revision+1,r.id,r.basis_id,r.criterion_id,r.subject,r.applicability,r.execution,r.verdict,r.reason,r.origin,{causes},r.output_digest,r.digest, \
         jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(r.document,'{{id}}',to_jsonb('{id}'::text)),'{{revision}}',to_jsonb(r.revision+1)),'{{predecessor_id}}',to_jsonb(r.id)),'{{ordinal}}',to_jsonb({ordinal})),'{{inputs}}',{inputs}),'{{causes}}',to_jsonb({causes})),'{{changes}}',{changes}) \
         FROM public.assessment_evaluation_revisions r WHERE r.id='{head}'"
    )
}
/// Wait until some backend waits on an advisory lock (a held chain lock).
async fn waiting_on_lock(lookup: &sqlx::PgPool) {
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        let waiting: i64 = sqlx::query_scalar("SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE wait_event_type='Lock' AND wait_event='advisory'")
            .fetch_one(lookup)
            .await
            .unwrap();
        if waiting > 0 {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "no backend waited on the chain lock"
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}
/// Delete rows under the explicit disposable fixture reset.
async fn reset_delete(admin: &mut PgConnection, table: &str, ids: &[String]) {
    let mut reset = admin.begin().await.unwrap();
    sqlx::query("SET LOCAL zobba.disposable_fixture_reset='on'")
        .execute(&mut *reset)
        .await
        .unwrap();
    sqlx::query(&format!("DELETE FROM public.{table} WHERE id = ANY($1)"))
        .bind(ids)
        .execute(&mut *reset)
        .await
        .unwrap();
    reset.commit().await.unwrap();
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
    fn normalise(value: &mut serde_json::Value, ids: &mut Vec<String>, digests: &mut Vec<String>) {
        let stable =
            |text: &str, ids: &mut Vec<String>, digests: &mut Vec<String>| -> Option<String> {
                let hex = |s: &str| {
                    s.bytes()
                        .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
                };
                if text.len() == 64 && hex(text) {
                    let index = digests.iter().position(|d| d == text).unwrap_or_else(|| {
                        digests.push(text.into());
                        digests.len() - 1
                    });
                    return Some(format!("{:064x}", index + 1));
                }
                if let Some((prefix, rest)) = text.split_once('-')
                    && matches!(
                        prefix,
                        "crit" | "basis" | "fact" | "eval" | "rev" | "disp" | "carry"
                    )
                    && rest.len() == 40
                    && hex(rest)
                {
                    let index = ids.iter().position(|d| d == text).unwrap_or_else(|| {
                        ids.push(text.into());
                        ids.len() - 1
                    });
                    return Some(format!("{prefix}-{}", index + 1));
                }
                None
            };
        match value {
            serde_json::Value::Object(map) => {
                for (key, field) in map.iter_mut() {
                    match (key.as_str(), &*field) {
                        (
                            "invocation_id" | "methodology_binding_id" | "job_id" | "version",
                            serde_json::Value::String(id),
                        ) => {
                            let id = id.clone();
                            let index = ids.iter().position(|v| *v == id).unwrap_or_else(|| {
                                ids.push(id);
                                ids.len() - 1
                            });
                            *field = serde_json::json!(format!("id-{}", index + 1));
                        }
                        ("recorded_us", serde_json::Value::String(_)) => {
                            *field = serde_json::json!("1760000000000000");
                        }
                        (_, serde_json::Value::String(text)) => {
                            if let Some(replaced) = stable(&text.clone(), ids, digests) {
                                *field = serde_json::json!(replaced);
                            }
                        }
                        _ => normalise(field, ids, digests),
                    }
                }
            }
            serde_json::Value::Array(items) => {
                for item in items.iter_mut() {
                    if let serde_json::Value::String(text) = &*item {
                        if let Some(replaced) = stable(&text.clone(), ids, digests) {
                            *item = serde_json::json!(replaced);
                        }
                    } else {
                        normalise(item, ids, digests);
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
    normalise(&mut body, &mut vec![], &mut vec![]);
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

/// The records the database guards are tried against.
struct Records {
    chain: String,
    /// The approval chain's head (revision 3) and the revision before it.
    head: String,
    previous: String,
    successor: String,
    first_basis: String,
    old_amount: String,
    new_amount: String,
    approver: String,
    /// The segregation chain (a judgment, revision 1, 200 dispositions).
    segregation: String,
    other_task: String,
    /// The auditor's exact session hash.
    session: String,
}

const RESET: &str = "SET LOCAL zobba.disposable_fixture_reset='on'";

/// The person's own scope and session for one transaction (as the API sets
/// them for a disposition write).
fn person(session: &str) -> Vec<String> {
    vec![format!(
        "SELECT set_config('zobba.organisation_id','org-a',true),set_config('zobba.client_id','client-a',true),set_config('zobba.engagement_id','engagement-a',true),set_config('zobba.actor_id','actor-a',true),set_config('zobba.session_hash','{session}',true)"
    )]
}

/// Run `setup` then `statement` in a transaction that is rolled back; the
/// statement's own refusal, by the database's words.
async fn refused_in(conn: &mut PgConnection, setup: &[String], statement: &str) -> String {
    let mut tx = conn.begin().await.unwrap();
    for s in setup {
        sqlx::query(s).execute(&mut *tx).await.expect(s);
    }
    let message = sqlx::query(statement)
        .execute(&mut *tx)
        .await
        .expect_err(statement)
        .to_string();
    tx.rollback().await.unwrap();
    message
}
/// The same, where the statement must succeed (a positive control).
async fn accepted_in(conn: &mut PgConnection, setup: &[String], statement: &str) {
    let mut tx = conn.begin().await.unwrap();
    for s in setup {
        sqlx::query(s).execute(&mut *tx).await.expect(s);
    }
    sqlx::query(statement)
        .execute(&mut *tx)
        .await
        .unwrap_or_else(|e| panic!("{statement}: {e}"));
    tx.rollback().await.unwrap();
}

/// A forged row: a copy of `source` (from `from`, a table or a temporary
/// copy) with columns set to SQL values and document paths set to SQL
/// jsonb values, under a new ID.
fn forged_with(
    table: &str,
    from: &str,
    names: &[&str],
    filter: &str,
    columns: &[(&str, String)],
    document: &[(&str, String)],
) -> String {
    let mut doc = "r.document".to_string();
    for (path, value) in document {
        doc = format!("jsonb_set({doc},'{{{path}}}',{value})");
    }
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
        "INSERT INTO public.{table}({},document) SELECT {},{doc} FROM {from} r {filter}",
        names.join(","),
        values.join(","),
    )
}
const REVISION_COLUMNS: &[&str] = &[
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
const DISPOSITION_COLUMNS: &[&str] = &[
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
const FACT_COLUMNS: &str = "organisation_id,client_id,engagement_id,task_id,cycle_id,actor_id,invocation_id,ordinal,id,methodology_binding_id,execution_epoch,basis_id,subject,subject_unit,name,value_kind,support,support_reason,rule,job_id,subject_grounded,measure_grounded,document,digest";
const CARRY_COLUMNS: &[&str] = &[
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
    "basis_id",
    "from_basis_id",
    "carried",
    "digest",
];
fn text(value: &str) -> String {
    format!("'{value}'")
}
fn json(value: &str) -> String {
    format!("to_jsonb('{value}'::text)")
}
fn causes(list: &[&str]) -> (String, String) {
    let quoted = list
        .iter()
        .map(|c| format!("'{c}'"))
        .collect::<Vec<_>>()
        .join(",");
    (
        format!("ARRAY[{quoted}]::text[]"),
        format!("to_jsonb(ARRAY[{quoted}]::text[])"),
    )
}

/// Revision, carry and disposition records are immutable even for the owner
/// and under the fixture reset (which may only delete), and the database
/// refuses forks, forged causes and changes, ineffective inputs, older
/// versions, stale, unauthorised or rule-replacing dispositions, unverified
/// references, and a carry that does not hold exactly its facts. Every
/// refusal is checked by its own message, and each forgery breaks one rule
/// only (a copy that breaks none is accepted).
async fn database_guards_refuse_altered_revision_records(
    admin: &mut PgConnection,
    owner: &mut PgConnection,
    pool: &sqlx::PgPool,
    r: &Records,
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
        let message = refused_in(
            admin,
            &[RESET.into()],
            &format!("UPDATE public.{table} SET actor_id=actor_id"),
        )
        .await;
        assert_refused(&message, "revision records are immutable", table);
        let runtime = sqlx::query(&format!("DELETE FROM public.{table}"))
            .execute(pool)
            .await
            .expect_err("the runtime deleted a record")
            .to_string();
        assert!(runtime.contains("permission denied"), "{table}: {runtime}");
        // The owner, with forced RLS lifted so its UPDATE and DELETE reach
        // every row, is refused by the trigger itself.
        let lifted = format!("ALTER TABLE public.{table} NO FORCE ROW LEVEL SECURITY");
        for statement in [
            format!("UPDATE public.{table} SET actor_id=actor_id"),
            format!("DELETE FROM public.{table}"),
        ] {
            assert_refused(
                &refused_in(owner, std::slice::from_ref(&lifted), &statement).await,
                "revision records are immutable",
                &statement,
            );
        }
        let statement = format!("TRUNCATE public.{table} CASCADE");
        assert_refused(
            &refused(owner, &statement).await,
            "revision records are retained",
            &statement,
        );
    }
    // The carries table's own TRUNCATE trigger, without the cascade to the
    // carried facts (its foreign key lifted in a rolled-back transaction).
    let lift: String = sqlx::query_scalar("SELECT format('ALTER TABLE public.assessment_basis_carried_facts DROP CONSTRAINT %I', conname) FROM pg_catalog.pg_constraint WHERE conrelid='public.assessment_basis_carried_facts'::regclass AND confrelid='public.assessment_basis_carries'::regclass")
        .fetch_one(&mut *admin)
        .await
        .unwrap();
    assert_refused(
        &refused_in(admin, &[lift], "TRUNCATE public.assessment_basis_carries").await,
        "revision records are retained",
        "TRUNCATE carries",
    );
    // Forced RLS: the owner sees this engagement's revisions under its scope
    // and none under another engagement's.
    let count_under = |engagement: &str| {
        format!(
            "SELECT set_config('zobba.organisation_id','org-a',true),set_config('zobba.client_id','client-a',true),set_config('zobba.engagement_id','{engagement}',true)"
        )
    };
    for (engagement, visible) in [("engagement-a", true), ("engagement-b", false)] {
        let mut tx = owner.begin().await.unwrap();
        sqlx::query(&count_under(engagement))
            .execute(&mut *tx)
            .await
            .unwrap();
        let rows: i64 =
            sqlx::query_scalar("SELECT count(*) FROM public.assessment_evaluation_revisions")
                .fetch_one(&mut *tx)
                .await
                .unwrap();
        tx.rollback().await.unwrap();
        assert_eq!(rows > 0, visible, "{engagement}: {rows}");
    }
    let visible: i64 =
        sqlx::query_scalar("SELECT count(*) FROM public.assessment_evaluation_revisions")
            .fetch_one(&mut *owner)
            .await
            .unwrap();
    assert_eq!(visible, 0, "forced RLS hides revisions without a scope");

    let forged_id = |n: u32| format!("rev-{n:040x}");
    let head = r.head.as_str();
    // A fork: a second successor of a revision that is no longer the head.
    let statement = forged_revision(head, &forged_id(1), &[]);
    let message = refused(admin, &statement).await;
    assert!(
        message.contains("a revision succeeds the current head of its chain")
            || message.contains("a revision names the revision before it in its chain"),
        "{statement}: {message}"
    );
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
            &format!("'{}'", r.chain),
            &format!("\"{}\"", r.chain),
        )],
    );
    assert_refused(
        &refused(admin, &statement).await,
        "a revision names the revision before it in its chain",
        &statement,
    );

    // The changes: a successor of the head that drops the approver (cause
    // inputs_changed, exactly derived) must name exactly that fact removed.
    let changes = |added: &[&str], removed: &[&str]| {
        format!(
            "'{}'::jsonb",
            serde_json::json!({"added": added, "removed": removed, "replaced": []})
        )
    };
    let successor_changes = |id: u32, changes: &str| {
        forged_successor(
            head,
            &forged_id(id),
            700 + id as i32,
            &without_input(&r.approver),
            &["inputs_changed"],
            changes,
        )
    };
    accepted_in(
        admin,
        &[],
        &successor_changes(10, &changes(&[], &[&r.approver])),
    )
    .await;
    for (id, forged, what) in [
        (11, changes(&[], &[]), "no change named"),
        (
            12,
            changes(&[&r.approver], &[&r.approver]),
            "an extra fact added",
        ),
        (13, changes(&[], &[&r.old_amount]), "another fact removed"),
    ] {
        assert_refused(
            &refused_in(admin, &[], &successor_changes(id, &forged)).await,
            "a revision names exactly the facts added, removed and replaced since its predecessor",
            what,
        );
    }
    // The head reads the head's basis and criterion version or one that
    // succeeds them, never an older or unrelated one.
    let older = forged_with(
        "assessment_evaluation_revisions",
        "public.assessment_evaluation_revisions",
        REVISION_COLUMNS,
        &format!("WHERE r.id='{head}'"),
        &[
            ("id", text(&forged_id(20))),
            ("ordinal", "720".into()),
            ("revision", "4".into()),
            ("predecessor_id", text(head)),
            ("basis_id", text(&r.first_basis)),
        ],
        &[
            ("id", json(&forged_id(20))),
            ("ordinal", "to_jsonb(720)".into()),
            ("revision", "to_jsonb(4)".into()),
            ("predecessor_id", json(head)),
            ("basis_id", json(&r.first_basis)),
        ],
    );
    assert_refused(
        &refused_in(admin, &[], &older).await,
        "a revision reads its head's basis version or one that succeeds it",
        &older,
    );
    let segregation_criterion: String =
        sqlx::query_scalar("SELECT criterion_id FROM public.assessment_evaluations WHERE id=$1")
            .bind(&r.segregation)
            .fetch_one(&mut *admin)
            .await
            .unwrap();
    let unrelated = forged_with(
        "assessment_evaluation_revisions",
        "public.assessment_evaluation_revisions",
        REVISION_COLUMNS,
        &format!("WHERE r.id='{head}'"),
        &[
            ("id", text(&forged_id(21))),
            ("ordinal", "721".into()),
            ("revision", "4".into()),
            ("predecessor_id", text(head)),
            ("criterion_id", text(&segregation_criterion)),
        ],
        &[
            ("id", json(&forged_id(21))),
            ("ordinal", "to_jsonb(721)".into()),
            ("revision", "to_jsonb(4)".into()),
            ("predecessor_id", json(head)),
            ("criterion_id", json(&segregation_criterion)),
        ],
    );
    assert_refused(
        &refused_in(admin, &[], &unrelated).await,
        "a revision reads its head's criterion version or one that succeeds it",
        &unrelated,
    );

    // Revision 3 again, with its own row removed under the reset (so revision
    // 2 is the head): an exact copy is accepted; each cause omitted, a false
    // prior_execution_failed, an answer that never showed the
    // reconsideration, an excepted or shadowed input, or another subject is
    // refused by its own rule.
    let again = [
        RESET.to_string(),
        format!(
            "CREATE TEMPORARY TABLE copied ON COMMIT DROP AS SELECT * FROM public.assessment_evaluation_revisions WHERE id='{head}'"
        ),
        format!("DELETE FROM public.assessment_evaluation_revisions WHERE id='{head}'"),
    ];
    let rev3 = |columns: &[(&str, String)], document: &[(&str, String)]| {
        let mut c = vec![("id", text(&forged_id(30)))];
        c.extend(columns.iter().cloned());
        let mut d = vec![("id", json(&forged_id(30)))];
        d.extend(document.iter().cloned());
        forged_with(
            "assessment_evaluation_revisions",
            "pg_temp.copied",
            REVISION_COLUMNS,
            &format!("WHERE r.id='{head}'"),
            &c,
            &d,
        )
    };
    accepted_in(admin, &again, &rev3(&[], &[])).await;
    let all = [
        "inputs_changed",
        "basis_revised",
        "prior_execution_failed",
        "reconsideration_requested",
    ];
    for list in [
        vec![all[1], all[3]],
        vec![all[0], all[3]],
        vec![all[0], all[1]],
        vec![all[0], all[1], all[2], all[3]],
    ] {
        let (column, document) = causes(&list);
        let statement = rev3(&[("causes", column)], &[("causes", document)]);
        assert_refused(
            &refused_in(admin, &again, &statement).await,
            "a revision states exactly the causes trusted code derives from its predecessor",
            &format!("{list:?}"),
        );
    }
    // The reconsideration was shown only in the request of revision 3's own
    // answer: the same revision under an earlier answer (whose request never
    // listed it) has no reconsideration cause.
    let earlier: String = sqlx::query_scalar(
        "SELECT invocation_id FROM public.assessment_evaluation_revisions WHERE id=$1",
    )
    .bind(&r.previous)
    .fetch_one(&mut *admin)
    .await
    .unwrap();
    let statement = rev3(
        &[("invocation_id", text(&earlier)), ("ordinal", "740".into())],
        &[
            ("invocation_id", json(&earlier)),
            ("ordinal", "to_jsonb(740)".into()),
        ],
    );
    assert_refused(
        &refused_in(admin, &again, &statement).await,
        "a revision states exactly the causes trusted code derives from its predecessor",
        "an answer that never showed the reconsideration",
    );
    // The excepted old amount is not an effective fact of the successor.
    let excepted_inputs = format!(
        "(SELECT jsonb_agg(CASE WHEN x->>'id'='{new}' THEN jsonb_build_object('digest',f.digest,'id',f.id) ELSE x END) FROM jsonb_array_elements(r.document->'inputs') x, public.assessment_facts f WHERE f.id='{old}')",
        new = r.new_amount,
        old = r.old_amount
    );
    let statement = rev3(&[], &[("inputs", excepted_inputs)]);
    assert_refused(
        &refused_in(admin, &again, &statement).await,
        "a revision input is an effective fact of its basis and subject",
        "an excepted fact as an input",
    );
    // A carried fact the successor later records itself is shadowed.
    let mut shadowed = again.to_vec();
    shadowed.push(format!(
        "INSERT INTO public.assessment_facts({FACT_COLUMNS}) SELECT organisation_id,client_id,engagement_id,task_id,cycle_id,actor_id,invocation_id,63,'fact-{z}',methodology_binding_id,execution_epoch,'{b}',subject,subject_unit,name,value_kind,support,support_reason,rule,job_id,subject_grounded,measure_grounded,jsonb_set(jsonb_set(jsonb_set(document,'{{id}}',to_jsonb('fact-{z}'::text)),'{{basis_id}}',to_jsonb('{b}'::text)),'{{ordinal}}',to_jsonb(63)),digest FROM public.assessment_facts WHERE id='{a}'",
        z = "e".repeat(40),
        b = r.successor,
        a = r.approver
    ));
    assert_refused(
        &refused_in(admin, &shadowed, &rev3(&[], &[])).await,
        "a revision input is an effective fact of its basis and subject",
        "a shadowed carried fact as an input",
    );
    let statement = rev3(
        &[("subject", text("INV-9999"))],
        &[("subject", json("INV-9999"))],
    );
    assert_refused(
        &refused_in(admin, &again, &statement).await,
        "a revision continues an evaluation chain of its own Task and subject",
        "another subject",
    );

    // A second first evaluation of a subject in the same lineage, under the
    // same basis and under its successor (which must revise, not restart).
    let first_again = |basis: &str, n: u32| {
        format!(
            "INSERT INTO public.assessment_evaluations(organisation_id,client_id,engagement_id,task_id,cycle_id,actor_id,invocation_id,ordinal,id,methodology_binding_id,execution_epoch,basis_id,criterion_id,subject,applicability,execution,verdict,reason,origin,document,output_digest,digest) SELECT e.organisation_id,e.client_id,e.engagement_id,e.task_id,e.cycle_id,e.actor_id,e.invocation_id,e.ordinal+{n},'eval-{z}',e.methodology_binding_id,e.execution_epoch,'{basis}',e.criterion_id,e.subject,e.applicability,e.execution,e.verdict,e.reason,e.origin,jsonb_set(jsonb_set(jsonb_set(jsonb_set(e.document,'{{id}}','\"eval-{z}\"'),'{{ordinal}}',to_jsonb(e.ordinal+{n})),'{{basis_id}}',to_jsonb('{basis}'::text)),'{{inputs}}','[]'),e.output_digest,e.digest FROM public.assessment_evaluations e WHERE e.id='{chain}'",
            z = format!("{n:040x}"),
            chain = r.chain
        )
    };
    for (basis, n) in [(&r.first_basis, 100u32), (&r.successor, 101u32)] {
        let statement = first_again(basis, n);
        assert_refused(
            &refused(admin, &statement).await,
            "is a revision of that chain",
            &statement,
        );
    }

    // Dispositions, each written as the person in their own session unless
    // the case is about that: a copy of the reconsideration of revision 2.
    let disposition = |n: u32, columns: &[(&str, String)], document: &[(&str, String)]| {
        let id = format!("disp-{n:040x}");
        let mut c = vec![("id", text(&id)), ("key", text(&id))];
        c.extend(columns.iter().cloned());
        let mut d = vec![("id", json(&id)), ("key", json(&id))];
        d.extend(document.iter().cloned());
        forged_with(
            "assessment_dispositions",
            "public.assessment_dispositions",
            DISPOSITION_COLUMNS,
            "WHERE r.key='reconsider-approval'",
            &c,
            &d,
        )
    };
    // An accepted disposition of the head (revision 3).
    type Sets = Vec<(&'static str, String)>;
    let on_head = || -> (Sets, Sets) {
        (
            vec![
                ("kind", text("accepted")),
                ("concern", "NULL".to_string()),
                ("revision", "3".to_string()),
                ("revision_id", text(head)),
            ],
            vec![
                ("revision", "to_jsonb(3)".to_string()),
                ("revision_id", json(head)),
                ("kind", json("accepted")),
                ("concern", "'null'::jsonb".into()),
            ],
        )
    };
    let me = person(&r.session);
    // On a superseded revision.
    assert_refused(
        &refused_in(admin, &me, &disposition(1, &[], &[])).await,
        "a disposition names the current head of its chain",
        "superseded",
    );
    // An accepted disposition of the head is the positive control.
    let (c, d) = on_head();
    accepted_in(admin, &me, &disposition(2, &c, &d)).await;
    // A rule verdict replaced.
    let (mut c, mut d) = on_head();
    c.retain(|(k, _)| *k != "kind" && *k != "verdict");
    c.extend([("kind", text("replaced")), ("verdict", text("not_met"))]);
    d.extend([("kind", json("replaced")), ("verdict", json("not_met"))]);
    assert_refused(
        &refused_in(admin, &me, &disposition(3, &c, &d)).await,
        "a deterministic verdict cannot be replaced",
        "replaced rule",
    );
    // Authority: an Admin, no scope at all (a NULL must not pass), and a
    // scope without a person's session (a worker connection).
    let authority = "a disposition is saved by a currently assigned auditor or audit manager in their own session";
    let (mut c, mut d) = on_head();
    c.push(("actor_id", text("actor-admin")));
    d.push(("actor_id", json("actor-admin")));
    assert_refused(
        &refused_in(admin, &me, &disposition(4, &c, &d)).await,
        authority,
        "Admin",
    );
    let (c, d) = on_head();
    assert_refused(
        &refused_in(admin, &[], &disposition(5, &c, &d)).await,
        authority,
        "no scope",
    );
    let worker = vec!["SELECT set_config('zobba.organisation_id','org-a',true),set_config('zobba.client_id','client-a',true),set_config('zobba.engagement_id','engagement-a',true),set_config('zobba.actor_id','actor-a',true)".to_string()];
    assert_refused(
        &refused_in(admin, &worker, &disposition(6, &c, &d)).await,
        authority,
        "no session",
    );
    // Another Task's chain.
    let (mut c, mut d) = on_head();
    c.push(("task_id", text(&r.other_task)));
    d.push(("task_id", json(&r.other_task)));
    assert_refused(
        &refused_in(admin, &me, &disposition(7, &c, &d)).await,
        "a disposition names an evaluation chain of its own Task",
        "another Task",
    );
    // No cap: the segregation chain's revision 1 holds 200 dispositions and
    // a 201st is accepted by the guard, whose checks read only the head and
    // the newest disposition (index seeks), never the whole history.
    let cap_columns = vec![
        ("revision", "1".to_string()),
        ("revision_id", text(&r.segregation)),
        ("chain_id", text(&r.segregation)),
        ("kind", text("accepted")),
        ("concern", "NULL".to_string()),
    ];
    let cap_document = vec![
        ("revision", "to_jsonb(1)".to_string()),
        ("revision_id", json(&r.segregation)),
        ("chain_id", json(&r.segregation)),
        ("kind", json("accepted")),
        ("concern", "'null'::jsonb".into()),
    ];
    let held: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM public.assessment_dispositions WHERE revision_id=$1",
    )
    .bind(&r.segregation)
    .fetch_one(&mut *admin)
    .await
    .unwrap();
    assert_eq!(held, 200);
    let started = std::time::Instant::now();
    accepted_in(admin, &me, &disposition(8, &cap_columns, &cap_document)).await;
    let elapsed = started.elapsed();
    assert!(
        elapsed < std::time::Duration::from_secs(5),
        "the 201st disposition's guard took {elapsed:?}"
    );
    assert!(
        !include_str!("../../../migrations/0023_disposition_history.sql").contains("at most 16"),
        "0023 holds no disposition cap"
    );
    // References: one valid reference is accepted; an unverified one, one of
    // another digest, one of an unregistered original and an over-long quote
    // are each refused.
    let reference = |verification: &str, original: &str, sha: &str, quote: &str| {
        format!(
            "jsonb_build_array(jsonb_build_object('original_id','{original}','locator','bytes:0-48','quote','{quote}','original_sha256',{sha},'verification','{verification}'))"
        )
    };
    let real_sha = "(SELECT digest FROM public.evidence_originals WHERE id='ap-policy')";
    let (c, mut d) = on_head();
    d.push((
        "references",
        reference("verified", "ap-policy", real_sha, POLICY_QUOTE),
    ));
    accepted_in(admin, &me, &disposition(9, &c, &d)).await;
    let long = "x".repeat(1001);
    for (n, forged) in [
        (
            10,
            reference("unverified", "ap-policy", real_sha, POLICY_QUOTE),
        ),
        (
            11,
            reference(
                "verified",
                "ap-policy",
                &format!("'{}'", "f".repeat(64)),
                POLICY_QUOTE,
            ),
        ),
        (
            12,
            reference("verified", "unregistered", real_sha, POLICY_QUOTE),
        ),
        (13, reference("verified", "ap-policy", real_sha, &long)),
    ] {
        let (c, mut d) = on_head();
        d.push(("references", forged));
        assert_refused(
            &refused_in(admin, &me, &disposition(n, &c, &d)).await,
            "a disposition reference is a verified quote of a registered original",
            &format!("reference {n}"),
        );
    }

    // Carried facts: a two-row statement with exactly one bad row (the
    // excepted amount) is refused as a whole.
    let message = refused_in(
        admin,
        &[
            RESET.into(),
            format!(
                "DELETE FROM public.assessment_basis_carried_facts WHERE basis_id='{}'",
                r.successor
            ),
        ],
        &format!(
            "INSERT INTO public.assessment_basis_carried_facts SELECT c.organisation_id,c.client_id,c.engagement_id,c.task_id,c.actor_id,c.basis_id,f.id,c.from_basis_id FROM public.assessment_basis_carries c CROSS JOIN (VALUES ('{}'),('{}')) f(id) WHERE c.basis_id='{}'",
            r.approver, r.old_amount, r.successor
        ),
    )
    .await;
    assert_refused(&message, "an excepted fact is not carried", "excepted");
    // A carried fact from a basis that is not the carry's.
    let statement = format!(
        "INSERT INTO public.assessment_basis_carried_facts SELECT c.organisation_id,c.client_id,c.engagement_id,c.task_id,c.actor_id,c.basis_id,'{}','{}' FROM public.assessment_basis_carries c WHERE c.basis_id='{}'",
        r.old_amount, r.successor, r.successor
    );
    assert_refused(
        &refused(admin, &statement).await,
        "a carried fact belongs to its basis's carry",
        &statement,
    );
    // The carry again, under the reset, with no exception and `carried`
    // stated: carrying the old amount the successor records itself; one
    // more row than stated; and too few rows at commit.
    let recarry = |carried: u32| {
        vec![
            RESET.to_string(),
            format!(
                "DELETE FROM public.assessment_basis_carried_facts WHERE basis_id='{}'",
                r.successor
            ),
            "CREATE TEMPORARY TABLE carry_copy ON COMMIT DROP AS SELECT * FROM public.assessment_basis_carries".into(),
            format!(
                "DELETE FROM public.assessment_basis_carries WHERE basis_id='{}'",
                r.successor
            ),
            forged_with(
                "assessment_basis_carries",
                "pg_temp.carry_copy",
                CARRY_COLUMNS,
                &format!("WHERE r.basis_id='{}'", r.successor),
                &[("carried", carried.to_string())],
                &[
                    ("carried", format!("to_jsonb({carried})")),
                    ("except", "'[]'::jsonb".into()),
                ],
            ),
        ]
    };
    let carry_rows = |ids: &[&str]| {
        format!(
            "INSERT INTO public.assessment_basis_carried_facts SELECT c.organisation_id,c.client_id,c.engagement_id,c.task_id,c.actor_id,c.basis_id,f.id,c.from_basis_id FROM public.assessment_basis_carries c CROSS JOIN unnest(ARRAY[{}]::text[]) f(id) WHERE c.basis_id='{}'",
            ids.iter()
                .map(|i| format!("'{i}'"))
                .collect::<Vec<_>>()
                .join(","),
            r.successor
        )
    };
    assert_refused(
        &refused_in(
            admin,
            &recarry(2),
            &carry_rows(&[&r.approver, &r.old_amount]),
        )
        .await,
        "a basis that records a fact itself does not carry it",
        "records it itself",
    );
    assert_refused(
        &refused_in(admin, &recarry(0), &carry_rows(&[&r.approver])).await,
        "a carry holds exactly its stated facts",
        "one row more than stated",
    );
    {
        let mut tx = admin.begin().await.unwrap();
        for s in recarry(0) {
            sqlx::query(&s).execute(&mut *tx).await.expect(&s);
        }
        let message = tx.commit().await.expect_err("a short carry").to_string();
        assert!(
            message.contains("a carry holds every effective fact of the basis it carries from, except the listed ones"),
            "{message}"
        );
    }
    // The 1,024-fact bound counts own and carried facts, in the fact guard
    // and in the carried-fact batch. (Copies of the corrected amount on the
    // successor reach the bound; the per-answer ordinal constraints are
    // lifted in this rolled-back transaction only.)
    let lift_ordinals = "DO $lift$ DECLARE c text; BEGIN FOR c IN SELECT conname FROM pg_catalog.pg_constraint WHERE conrelid='public.assessment_facts'::regclass AND (pg_catalog.pg_get_constraintdef(oid) LIKE '%invocation_id, ordinal%' OR pg_catalog.pg_get_constraintdef(oid) LIKE '%ordinal >= 0%' OR pg_catalog.pg_get_constraintdef(oid) LIKE '%ordinal <= 63%') LOOP EXECUTE format('ALTER TABLE public.assessment_facts DROP CONSTRAINT %I', c); END LOOP; END $lift$".to_string();
    let copies = |count: u32| {
        format!(
            "INSERT INTO public.assessment_facts({FACT_COLUMNS}) SELECT f.organisation_id,f.client_id,f.engagement_id,f.task_id,f.cycle_id,f.actor_id,f.invocation_id,f.ordinal,'fact-'||lpad(to_hex(n),40,'0'),f.methodology_binding_id,f.execution_epoch,f.basis_id,'S-'||n,f.subject_unit,f.name,f.value_kind,f.support,f.support_reason,f.rule,f.job_id,f.subject_grounded,f.measure_grounded,jsonb_set(jsonb_set(f.document,'{{id}}',to_jsonb('fact-'||lpad(to_hex(n),40,'0'))),'{{subject}}',to_jsonb('S-'||n)),f.digest FROM public.assessment_facts f CROSS JOIN generate_series(1,{count}) n WHERE f.id='{}'",
            r.new_amount
        )
    };
    let one_more = copies(1).replace("generate_series(1,1)", "generate_series(5000,5000)");
    // Own 1 + carried 1 + 1,022 copies = 1,024: one more own fact is refused.
    assert_refused(
        &refused_in(admin, &[lift_ordinals.clone(), copies(1022)], &one_more).await,
        "a basis holds at most 1024 facts",
        "own after carried",
    );
    // Own 1 + 1,023 copies = 1,024 own facts: carrying one more is refused.
    assert_refused(
        &refused_in(
            admin,
            &[
                lift_ordinals,
                RESET.into(),
                format!(
                    "DELETE FROM public.assessment_basis_carried_facts WHERE basis_id='{}'",
                    r.successor
                ),
                copies(1023),
            ],
            &carry_rows(&[&r.approver]),
        )
        .await,
        "a basis holds at most 1024 facts",
        "carried after own",
    );
    // "One carried fact per subject and name" is implied by the
    // effective-fact rule above (a basis holds one effective fact per subject
    // and name), so no forgery can reach it alone; it stays as a second lock.
    let _ = &r.first_basis;
}
