//! Story 24.4 proof: firm-shaped work products with supported claims, end to
//! end. The production work coordinator with the trusted assessment
//! composition records the agent's work-product drafts only when trusted
//! code has checked every claim against its records (and PostgreSQL checks
//! them again); a refused draft records nothing and tells the agent which
//! block failed and why. The real authenticated API shows the shelf, each
//! version by template section with claim currency derived now, lets a
//! currently assigned Auditor or Audit manager edit text (never Admin alone),
//! and renders deterministic DOCX and XLSX exports from one exact version. A
//! native OpenAI loopback provider stands in for the model (never a live
//! provider): it names records and writes sentences, never a checked value
//! it was not shown. Requires a guarded `_test` database, the OIDC fixture
//! environment and a Docker engine with the pinned image; it fails, never
//! skips, without them.
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
            "templates": [{"id":"ap-wp","version":"1","name":"AP working paper FY2026","sections":[
                {"id":"objective","title":"Objective","content":"State the objective and scope.","required":true},
                {"id":"results","title":"Results","content":"Report each result with the records it rests on.","required":false},
                {"id":"conclusion","title":"Conclusion","content":"State the conclusion.","required":true}]}],
            "requirements":[
                {"id":"AP-1","label":"Invoice approvals","mandatory":true,
                 "criteria":["Invoices above 1,000.00 USD require an approver"],"populations":["AP invoices"],
                 "evidence_checks":null,"ratings":null,"templates":[{"id":"ap-wp","version":"1"}],"review_rules":null,"suitable_skills":null}
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
    /// The raw bytes and content type of a read.
    async fn bytes(&self, route: &str) -> (u16, Vec<u8>, String) {
        let response = self
            .client
            .get(format!(
                "{}/engagements/engagement-a/{route}?{SCOPE_QUERY}",
                self.address
            ))
            .header("Cookie", format!("__Host-zobba-session={}", self.token))
            .header("X-Expected-Session", &self.csrf)
            .send()
            .await
            .unwrap();
        let status = response.status().as_u16();
        let kind = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default()
            .to_string();
        (status, response.bytes().await.unwrap().to_vec(), kind)
    }
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
    async fn post(&self, route: &str, body: &serde_json::Value) -> (u16, serde_json::Value) {
        let response = self
            .client
            .post(format!(
                "{}/engagements/engagement-a/{route}?{SCOPE_QUERY}",
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

/// The rows of `AP invoices.xlsx` Sheet1 this proof cites: (subject, row).
const ROWS: &[(&str, u32)] = &[
    ("INV-0042", 2),
    ("000123", 3),
    ("INV-0054", 4),
    ("INV-0055", 5),
    ("INV-0050", 6),
    ("INV-0051", 7),
    ("INV-0052", 8),
    ("INV-0053", 9),
    ("INV-0057", 10),
];
fn row(subject: &str) -> u32 {
    ROWS.iter().find(|(s, _)| *s == subject).unwrap().1
}
/// The invoice identifier fact of one subject, citing its own cell.
fn invoice(basis: &str, subject: &str) -> serde_json::Value {
    let cell = format!("cell:Sheet1!A{}", row(subject));
    fact(
        basis,
        subject,
        "invoice",
        "identifier",
        subject,
        "",
        "identifier_exact",
        vec![(&cell, subject)],
    )
}
/// The approver fact of one subject (late evidence).
fn approver_of(basis: &str, subject: &str, name: &str) -> serde_json::Value {
    let (cell, key) = (
        format!("cell:Sheet1!D{}", row(subject)),
        format!("cell:Sheet1!A{}", row(subject)),
    );
    fact(
        basis,
        subject,
        "approver",
        "identifier",
        name,
        "",
        "identifier_exact",
        vec![(&cell, name), (&key, subject)],
    )
}
fn judgment(
    criterion: &str,
    basis: &str,
    subject: &str,
    verdict: &str,
    supporting: &[&str],
) -> serde_json::Value {
    serde_json::json!({
        "criterion": criterion, "basis": basis, "subject": subject, "verdict": verdict,
        "supporting": supporting, "contrary": [],
        "rationale": format!("The evidence for {subject} shows who approved it and who requested it."),
        "uncertainty": "The organisation chart in the evidence is dated 2025.",
    })
}
/// One typed value column of a proposed population.
fn column(
    header: &str,
    name: &str,
    kind: &str,
    rule: &str,
    currency: &str,
    measure: &str,
) -> serde_json::Value {
    serde_json::json!({"header": header, "name": name, "type": kind, "rule": rule, "unit": "", "currency": currency, "measure_column": measure})
}
/// A proposed population of `AP population.xlsx` on one sheet; `control` is
/// `(locator, quote)` of a cited control count.
fn population(
    key: &str,
    basis: &str,
    sheet: &str,
    header_row: u32,
    exhaustive: bool,
    control: Option<(&str, &str)>,
) -> serde_json::Value {
    let (locator, quote) = control.unwrap_or(("", ""));
    serde_json::json!({
        "key": key, "basis": basis, "supersedes": "", "original_id": "ap-population",
        "sheet": sheet, "header_row": header_row, "subject_unit": "invoice", "grain": ["Invoice"],
        "period_column": "Invoice date", "period_rule": "date_iso",
        "value_columns": [
            column("Amount", "amount", "decimal", "decimal_grouped_comma", "USD", "Currency"),
            column("Approved", "approved", "boolean", "boolean_yes_no", "", ""),
            column("Approved before payment", "approved_before_payment", "boolean", "boolean_yes_no", "", ""),
        ],
        "exhaustive": exhaustive,
        "control_original_id": if control.is_some() { "ap-population" } else { "" },
        "control_locator": locator, "control_quote": quote,
        "control_rule": if control.is_some() { "decimal_grouped_comma" } else { "" },
        "selection": format!("Every invoice row of the {sheet} sheet"),
    })
}

// ------------------------------------------------------------------ drafts

/// One assertion of a drafted claim (every field present, strict output).
fn assertion(
    kind: &str,
    record: &str,
    measure: &str,
    detail: &str,
    value: &str,
) -> serde_json::Value {
    serde_json::json!({"kind": kind, "record": record, "measure": measure, "detail": detail, "value": value})
}
/// One drafted block.
fn block(
    kind: &str,
    section: &str,
    text: &str,
    record: &str,
    assertions: Vec<serde_json::Value>,
) -> serde_json::Value {
    serde_json::json!({"kind": kind, "section": section, "text": text, "record": record, "assertions": assertions})
}
fn keep(id: &str) -> serde_json::Value {
    block("keep", "", "", id, vec![])
}
fn draft(
    title: &str,
    template: &str,
    base: &str,
    blocks: Vec<serde_json::Value>,
) -> serde_json::Value {
    serde_json::json!({"title": title, "kind": "working_paper", "template": template, "base": base, "blocks": blocks})
}
fn quote_assertion() -> serde_json::Value {
    assertion("quote", "ap-policy", "", "bytes:0-48", POLICY_QUOTE)
}

/// The versions of the work product: (number, ID, author kind), in order.
/// The exact JSON the web parses (`web/tests/fixtures/<name>`), with every
/// generated identifier and digest (a lowercase hex run of 32 or more) and
/// every database time replaced by a stable value of the same shape. Set
/// `ZOBBA_UPDATE_WORK_PRODUCT_FIXTURE=1` to rewrite it after an intended change.
fn fixture(body: &serde_json::Value, name: &str) {
    fn times(value: &mut serde_json::Value) {
        match value {
            serde_json::Value::Object(map) => {
                for (key, field) in map.iter_mut() {
                    if key == "recorded_us" && field.is_string() {
                        *field = serde_json::json!("1760000000000000");
                    } else {
                        times(field);
                    }
                }
            }
            serde_json::Value::Array(items) => items.iter_mut().for_each(times),
            _ => {}
        }
    }
    let mut body = body.clone();
    times(&mut body);
    let text = format!("{}\n", serde_json::to_string_pretty(&body).unwrap());
    let hex = |c: char| c.is_ascii_digit() || ('a'..='f').contains(&c);
    let chars: Vec<char> = text.chars().collect();
    let mut seen: Vec<String> = Vec::new();
    let (mut out, mut i) = (String::new(), 0);
    while i < chars.len() {
        let mut j = i;
        while j < chars.len() && hex(chars[j]) {
            j += 1;
        }
        let bounded = (i == 0 || !chars[i - 1].is_ascii_alphanumeric())
            && (j == chars.len() || !chars[j].is_ascii_alphanumeric());
        if j - i >= 32 && bounded {
            let run: String = chars[i..j].iter().collect();
            let index = seen.iter().position(|s| *s == run).unwrap_or_else(|| {
                seen.push(run.clone());
                seen.len() - 1
            });
            out.push_str(&format!("{:0width$x}", index + 1, width = j - i));
            i = j;
        } else if j > i {
            out.extend(&chars[i..j]);
            i = j;
        } else {
            out.push(chars[i]);
            i += 1;
        }
    }
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../web/tests/fixtures")
        .join(name);
    if std::env::var("ZOBBA_UPDATE_WORK_PRODUCT_FIXTURE").as_deref() == Ok("1") {
        std::fs::write(&path, out).unwrap();
    } else {
        let stored = std::fs::read_to_string(&path).unwrap_or_default();
        assert_eq!(
            stored, out,
            "set ZOBBA_UPDATE_WORK_PRODUCT_FIXTURE=1 to update {path:?}"
        );
    }
}

async fn versions(admin: &mut PgConnection) -> Vec<(i32, String, String)> {
    sqlx::query_as(
        "SELECT version, id, author_kind FROM public.work_product_versions ORDER BY version",
    )
    .fetch_all(&mut *admin)
    .await
    .unwrap()
}
/// The blocks of one version: (ID, section, kind, author kind, authored in).
async fn blocks_of(
    lookup: &sqlx::PgPool,
    version: &str,
) -> Vec<(String, String, String, String, String)> {
    sqlx::query_as("SELECT block_id, section_id, kind, author_kind, authored_in_version FROM public.work_product_blocks WHERE version_id=$1 ORDER BY ordinal")
        .bind(version)
        .fetch_all(lookup)
        .await
        .unwrap()
}
/// The ID of the block of a version whose text or statement starts so.
async fn block_with(lookup: &sqlx::PgPool, version: &str, start: &str) -> String {
    sqlx::query_scalar("SELECT block_id FROM public.work_product_blocks WHERE version_id=$1 AND body LIKE $2 || '%'")
        .bind(version)
        .bind(start)
        .fetch_one(lookup)
        .await
        .unwrap()
}
/// The latest version of the Task's (one) work product.
async fn head(lookup: &sqlx::PgPool) -> String {
    sqlx::query_scalar("SELECT id FROM public.work_product_versions ORDER BY version DESC LIMIT 1")
        .fetch_one(lookup)
        .await
        .unwrap()
}

const C1: &str = "15 of 1,000 applicable invoices had no recorded approver.";
const C2: &str = "Segregation of duties was not met for INV-0042.";
const C3: &str = "INV-0055 did not meet the segregation criterion.";
const C4: &str = "The policy requires an approver above 1,000.00 USD.";
const C5: &str =
    "The coverage summary concludes that exceptions were found and the result is inconclusive.";

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn every_claim_of_a_recorded_version_agrees_with_its_records() {
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
    let lookup_pool = lookup.clone();
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
    register(&mut admin, &objects, "ap-population", "AP population.xlsx").await;
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
    let manager_session = identities
        .establish_session(ISSUER, "manager-a", "Manager", None)
        .await
        .unwrap();
    let models =
        ModelRepository::new(pool.clone()).with_session_hash(secret_hash(&manager_session));
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
    let methods =
        MethodologyRepository::new(pool.clone()).with_session_hash(secret_hash(&manager_session));
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
                key: "ap-work-product".into(),
                kind: CommandKind::Create,
                task_id: None,
                cycle_id: None,
                content: Some(
                    "Test approval of every 2026 AP invoice and write the working paper".into(),
                ),
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
            let scalar = |sql: &'static str| {
                let lookup = lookup.clone();
                let task_id = task_id.clone();
                async move {
                    let found: String = sqlx::query_scalar(sql)
                        .bind(&task_id)
                        .fetch_one(&lookup)
                        .await
                        .unwrap();
                    found
                }
            };
            let approver = || criterion_id(&lookup, &task_id, "approver");
            let fy = || basis_id(&lookup, &task_id, "fy2026");
            let seg = || basis_id(&lookup, &task_id, "seg2026");
            let summary = || {
                scalar(
                    "SELECT id FROM public.assessment_summaries WHERE task_id=$1 ORDER BY created_us LIMIT 1",
                )
            };
            let eval_of = |subject: &'static str| {
                let lookup = lookup.clone();
                async move {
                    sqlx::query_scalar::<_, String>(
                        "SELECT id FROM public.assessment_evaluations WHERE subject=$1",
                    )
                    .bind(subject)
                    .fetch_one(&lookup)
                    .await
                    .unwrap()
                }
            };
            let rule = |fact: &str| predicate("is_true", fact, "", "", "");
            let over = predicate("compare_constant", "amount", "gt", "1000.00", "USD");
            match index {
                // Turn 1: the 24.2 coverage of every AP invoice (two rule
                // criteria over the full population) and its summary.
                0 => text_reply(&answer(serde_json::json!({
                    "propose_criteria": [
                        criterion("approver", "Invoices above 1,000.00 USD require an approver", ("method", "AP-1", "", ""),
                            over.clone(), vec![required("amount", "decimal", "USD"), required("approved", "boolean", "")],
                            "rule", rule("approved"), ""),
                        criterion("before", "Invoices above 1,000.00 USD are approved before payment", ("method", "AP-1", "", ""),
                            over.clone(), vec![required("amount", "decimal", "USD"), required("approved_before_payment", "boolean", "")],
                            "rule", rule("approved_before_payment"), ""),
                    ],
                    "propose_basis": [{
                        "key": "fy2026", "supersedes": "", "objective": "Test approval of every 2026 AP invoice",
                        "criteria": ["approver", "before"],
                        "period_from": "2026-01-01", "period_to": "2026-12-31", "as_of": "",
                        "population": [{"original_id": "ap-population", "unit": "invoice", "selection": "Every invoice in the AP export"}],
                        "limitations": [],
                    }],
                    "propose_population": [population("ap", "fy2026", "Invoices", 3, true, Some(("cell:Summary!B1", "1,250")))],
                    "evaluate_population": [{"criterion": "approver", "population": "ap"}, {"criterion": "before", "population": "ap"}],
                    "summarise": [{"basis": "fy2026", "population": "ap", "sample": ""}],
                }))),
                // Turn 2: a judgment criterion on its own basis, and the
                // identifiers of the two invoices it judges.
                1 => text_reply(&answer(serde_json::json!({
                    "propose_criteria": [
                        criterion("segregation", "Segregation of duties is adequate given the organisation chart", ("method", "AP-1", "", ""),
                            none(), vec![], "judgment", none(), "The approver and the requester report to different managers"),
                    ],
                    "propose_basis": [{
                        "key": "seg2026", "supersedes": "", "objective": "Judge segregation of duties for two invoices",
                        "criteria": ["segregation"],
                        "period_from": "2026-01-01", "period_to": "2026-12-31", "as_of": "",
                        "population": [{"original_id": "ap-invoices", "unit": "invoice", "selection": "Two invoices of the AP export"}],
                        "limitations": ["The organisation chart is dated 2025."],
                    }],
                    "record_facts": [invoice("seg2026", "INV-0042"), invoice("seg2026", "INV-0055")],
                }))),
                // Turn 3: two judgments, each not met.
                2 => {
                    let b = seg().await;
                    let s = criterion_id(&lookup, &task_id, "segregation").await;
                    text_reply(&answer(serde_json::json!({
                        "judgments": [
                            judgment(&s, &b, "INV-0042", "not_met", &["invoice"]),
                            judgment(&s, &b, "INV-0055", "not_met", &["invoice"]),
                        ],
                    })))
                }
                // Turn 4 (AC1): the working paper on the bound firm template.
                3 => {
                    let (a, s, f) = (approver().await, summary().await, fy().await);
                    let (e42, e55) = (eval_of("INV-0042").await, eval_of("INV-0055").await);
                    text_reply(&answer(serde_json::json!({
                        "draft_work_product": [draft("AP approvals working paper", "ap-wp:1", "", vec![
                            block("heading", "objective", "Approval testing", "", vec![]),
                            block("narrative", "objective", "Test whether every invoice above the threshold was approved.", "", vec![]),
                            block("judgment", "results", "Approvals appear weak across the population; segregation needs a closer look.", "", vec![]),
                            block("claim", "results", C1, "", vec![
                                assertion("count", &s, "not_met", &a, "15"),
                                assertion("count", &s, "applicable", &a, "1000"),
                            ]),
                            block("coverage", "results", "", &s, vec![]),
                            block("claim", "results", C2, "", vec![assertion("outcome", &e42, "", "", "not_met")]),
                            block("claim", "results", C3, "", vec![assertion("outcome", &e55, "", "", "not_met")]),
                            block("claim", "results", C4, "", vec![quote_assertion()]),
                            block("claim", "results", C5, "", vec![assertion("conclusion", &s, "", "", "exceptions_found_inconclusive")]),
                            block("exceptions", "results", "", &f, vec![]),
                        ])],
                    })))
                }
                // Turn 5: a draft every check refuses (nothing is recorded),
                // beside a fact (so the work continues).
                4 => {
                    let (a, s, b) = (approver().await, summary().await, seg().await);
                    let e42 = eval_of("INV-0042").await;
                    let v1 = head(&lookup).await;
                    let mut blocks: Vec<serde_json::Value> = blocks_of(&lookup, &v1)
                        .await
                        .iter()
                        .map(|b| keep(&b.0))
                        .collect();
                    blocks.extend([
                        block(
                            "claim",
                            "results",
                            "14 of 1,000 applicable invoices had no recorded approver.",
                            "",
                            vec![
                                assertion("count", &s, "not_met", &a, "15"),
                                assertion("count", &s, "applicable", &a, "1000"),
                            ],
                        ),
                        block(
                            "claim",
                            "results",
                            "15 invoices had no recorded approver.",
                            "",
                            vec![assertion("count", &s, "not_met", &a, "14")],
                        ),
                        block("judgment", "results", "About 20 items failed.", "", vec![]),
                        block(
                            "claim",
                            "results",
                            "The control passed.",
                            "",
                            vec![quote_assertion()],
                        ),
                        block(
                            "claim",
                            "results",
                            "INV-0042 met the criterion.",
                            "",
                            vec![assertion("outcome", &e42, "", "", "met")],
                        ),
                        block(
                            "narrative",
                            "nowhere",
                            "A section the template does not have.",
                            "",
                            vec![],
                        ),
                        keep(&format!("blk-{}", "0".repeat(40))),
                    ]);
                    text_reply(&answer(serde_json::json!({
                        "record_facts": [invoice(&b, "INV-0054")],
                        "draft_work_product": [draft("AP approvals working paper", "ap-wp:1", &v1, blocks)],
                    })))
                }
                // Turn 6: a new work product on a template the binding does
                // not hold.
                5 => {
                    let b = seg().await;
                    text_reply(&answer(serde_json::json!({
                        "record_facts": [invoice(&b, "INV-0050")],
                        "draft_work_product": [draft("Another paper", "other:1", "", vec![
                            block("heading", "objective", "Approval testing", "", vec![]),
                        ])],
                    })))
                }
                // Turn 8 (woken by a person's request to reconsider
                // INV-0042): late evidence, the judgment again, and the
                // effective summary of the coverage population.
                7 => {
                    let (b, f) = (seg().await, fy().await);
                    let s = criterion_id(&lookup, &task_id, "segregation").await;
                    let p = scalar("SELECT id FROM public.assessment_populations WHERE task_id=$1 AND document->>'key'='ap'").await;
                    text_reply(&answer(serde_json::json!({
                        "record_facts": [approver_of(&b, "INV-0042", "J. Smith")],
                        "judgments": [judgment(&s, &b, "INV-0042", "met", &["invoice", "approver"])],
                        "summarise_effective": [{"basis": f, "population": p, "sample": ""}],
                    })))
                }
                // Turn 9: the refresh: a successor of the latest version
                // that keeps every block but the revised claim, and cites
                // the chain's new head.
                8 => {
                    let latest = head(&lookup).await;
                    let stale =
                        block_with(&lookup, &latest, "Segregation of duties was not met").await;
                    let revision: String = sqlx::query_scalar("SELECT id FROM public.assessment_evaluation_revisions WHERE subject='INV-0042' ORDER BY revision DESC LIMIT 1")
                        .fetch_one(&lookup).await.unwrap();
                    let mut blocks = Vec::new();
                    for b in blocks_of(&lookup, &latest).await {
                        if b.0 == stale {
                            blocks.push(block(
                                "claim",
                                "results",
                                "After late evidence, INV-0042 met the segregation criterion.",
                                "",
                                vec![assertion("outcome", &revision, "", "", "met")],
                            ));
                        } else {
                            blocks.push(keep(&b.0));
                        }
                    }
                    text_reply(&answer(serde_json::json!({
                        "draft_work_product": [draft("AP approvals working paper", "ap-wp:1", &latest, blocks)],
                    })))
                }
                // Turn 10: a successor that drops a person's block.
                9 => {
                    let b = seg().await;
                    let latest = head(&lookup).await;
                    let blocks: Vec<serde_json::Value> = blocks_of(&lookup, &latest)
                        .await
                        .iter()
                        .filter(|b| b.3 != "human")
                        .map(|b| keep(&b.0))
                        .collect();
                    text_reply(&answer(serde_json::json!({
                        "record_facts": [invoice(&b, "INV-0053")],
                        "draft_work_product": [draft("AP approvals working paper", "ap-wp:1", &latest, blocks)],
                    })))
                }
                // Turn 11: a successor of a version that is not the latest.
                10 => {
                    let b = seg().await;
                    let second: String = sqlx::query_scalar(
                        "SELECT id FROM public.work_product_versions WHERE version=2",
                    )
                    .fetch_one(&lookup)
                    .await
                    .unwrap();
                    let blocks: Vec<serde_json::Value> = blocks_of(&lookup, &second)
                        .await
                        .iter()
                        .map(|b| keep(&b.0))
                        .collect();
                    text_reply(&answer(serde_json::json!({
                        "record_facts": [invoice(&b, "INV-0052")],
                        "draft_work_product": [draft("AP approvals working paper", "ap-wp:1", &second, blocks)],
                    })))
                }
                // Turn 12 (scale): twenty claims of four counts each on the
                // effective summary, kept with every block of the latest.
                11 => {
                    let latest = head(&lookup).await;
                    let (es, document): (String, serde_json::Value) = sqlx::query_as("SELECT id, document FROM public.assessment_effective_summaries ORDER BY created_us DESC LIMIT 1")
                        .fetch_one(&lookup).await.unwrap();
                    let mut blocks: Vec<serde_json::Value> = blocks_of(&lookup, &latest)
                        .await
                        .iter()
                        .map(|b| keep(&b.0))
                        .collect();
                    let criteria = document["effective"]["summary"]["criteria"]
                        .as_array()
                        .unwrap()
                        .clone();
                    for i in 0..20 {
                        let c = &criteria[i % criteria.len()];
                        let id = c["criterion_id"].as_str().unwrap();
                        let n = |k: &str| c[k].as_i64().unwrap().to_string();
                        let grouped = |k: &str| {
                            zobba_domain::work_product::grouped(c[k].as_i64().unwrap() as u64)
                        };
                        blocks.push(block("claim", "results",
                            &format!("Of {} applicable invoices, {} met the criterion, {} did not and {} are undetermined.", grouped("applicable"), grouped("met"), grouped("not_met"), grouped("undetermined")),
                            "", vec![
                                assertion("count", &es, "applicable", id, &n("applicable")),
                                assertion("count", &es, "met", id, &n("met")),
                                assertion("count", &es, "not_met", id, &n("not_met")),
                                assertion("count", &es, "undetermined", id, &n("undetermined")),
                            ]));
                    }
                    text_reply(&answer(serde_json::json!({
                        "draft_work_product": [draft("AP approvals working paper", "ap-wp:1", &latest, blocks)],
                    })))
                }
                _ => text_reply(&answer(serde_json::json!({
                    "segments": [{"text": "The working paper is drafted.", "sources": []}],
                }))),
            }
        })
    });
    let provider = Loopback::answering(responder).await;

    let unused = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let gateway_address = unused.local_addr().unwrap();
    let staging = std::env::temp_dir().join(format!("zobba-work-product-{}", std::process::id()));
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
    settle(&tasks, &provider, &receipt.task_id, 7).await;

    // AC1: exactly one version, the agent's, every claim checked.
    let recorded = versions(&mut admin).await;
    assert_eq!(
        recorded.len(),
        1,
        "only the checked draft was recorded: {recorded:?}"
    );
    let v1 = recorded[0].1.clone();
    assert_eq!(recorded[0].2, "agent");
    let v1_blocks = blocks_of(&lookup_pool, &v1).await;
    let kinds: Vec<&str> = v1_blocks.iter().map(|b| b.2.as_str()).collect();
    assert_eq!(
        kinds,
        [
            "heading",
            "narrative",
            "narrative",
            "claim",
            "coverage",
            "claim",
            "claim",
            "claim",
            "claim",
            "exceptions",
            "limitations"
        ],
        "trusted code appended the limitations block"
    );
    let (missing, digest): (Vec<String>, String) = sqlx::query_as(
        "SELECT missing_required, digest FROM public.work_product_versions WHERE id=$1",
    )
    .bind(&v1)
    .fetch_one(&mut admin)
    .await
    .unwrap();
    assert_eq!(missing, ["conclusion"], "the required conclusion is empty");
    let assertions: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM public.work_product_assertions WHERE version_id=$1",
    )
    .bind(&v1)
    .fetch_one(&mut admin)
    .await
    .unwrap();
    assert_eq!(assertions, 6);
    let bodies = provider.bodies.lock().unwrap().clone();
    assert!(
        bodies[3].contains("ap-wp:1"),
        "the request lists the bound template"
    );
    assert!(
        bodies[4].contains(&format!("Work product")) && bodies[4].contains(&v1),
        "the next turn reads the recorded version"
    );
    // Every refusal of the second draft, each with its block, and nothing
    // recorded.
    for reason in [
        "unsupported_figure",
        "count_mismatch",
        "figure_in_narrative",
        "verdict_without_record",
        "outcome_mismatch",
        "section_unknown",
        "unknown_record",
    ] {
        assert!(bodies[5].contains(reason), "{reason} is fed back");
    }
    assert!(bodies[5].contains("nothing was recorded"));
    assert!(
        bodies[6].contains("template_unbound"),
        "an unbound template is refused"
    );

    // The real API.
    let auth = zobba_api::auth::AuthState::from_environment(&database).unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = format!("http://{}", listener.local_addr().unwrap());
    let app = zobba_api::authenticated_router_with_evidence(database.clone(), auth, Some(store()));
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let accountable = browser(&identities, &address, "auditor-a", "actor-a").await;
    let manager = browser(&identities, &address, "manager-a", "actor-manager").await;
    let administrator = browser(&identities, &address, "admin-only", "actor-admin").await;
    let task = receipt.task_id.as_str();
    let product: String = sqlx::query_scalar("SELECT id FROM public.work_products")
        .fetch_one(&mut admin)
        .await
        .unwrap();
    let base = format!("tasks/{task}/work-products/{product}");

    // The shelf: one Draft, nothing to refresh, the missing section named.
    let (status, shelf) = accountable.read("work-products", &accountable.csrf).await;
    assert_eq!(status, 200, "{shelf}");
    assert_eq!(shelf["total"], "1");
    assert_eq!(shelf["products"][0]["review_state"], "Draft");
    assert_eq!(shelf["products"][0]["refresh"], "0");
    assert_eq!(shelf["products"][0]["claims"], "5");
    assert_eq!(
        shelf["products"][0]["missing_required"],
        serde_json::json!(["conclusion"])
    );
    let (status, task_shelf) = accountable
        .read(&format!("tasks/{task}/work-products"), &accountable.csrf)
        .await;
    assert_eq!((status, task_shelf["total"].as_str()), (200, Some("1")));
    let (status, _) = administrator
        .read("work-products", &administrator.csrf)
        .await;
    assert_eq!(status, 403, "Admin alone sees no work product");

    // The version by template section, every claim current.
    let (status, view) = accountable
        .read(&format!("{base}/versions/{v1}"), &accountable.csrf)
        .await;
    assert_eq!(status, 200, "{view}");
    assert_eq!(view["digest"], digest.as_str());
    let sections = view["sections"].as_array().unwrap();
    assert_eq!(
        sections
            .iter()
            .map(|s| s["id"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["objective", "results", "conclusion"]
    );
    assert_eq!(
        sections[2]["not_completed"],
        "Not completed in this version."
    );
    let results = sections[1]["blocks"].as_array().unwrap();
    assert_eq!(
        results[0]["label_words"],
        "Zobba's judgment — not checked against records"
    );
    let claim = &results[1]["claim"];
    assert_eq!(
        (claim["number"].as_str(), claim["current"].as_bool()),
        (Some("1"), Some(true))
    );
    assert!(
        claim["coverage"]
            .as_str()
            .unwrap()
            .starts_with("Population"),
        "a count claim shows its platform coverage line: {claim}"
    );
    assert_eq!(view["refresh"], "0");
    assert!(view["newer_version_id"].is_null());
    let limitations = view["limitations"].as_array().unwrap();
    assert!(
        limitations.iter().any(|l| l
            .as_str()
            .unwrap()
            .contains("conclusion exceptions found inconclusive")),
        "{limitations:?}"
    );
    assert!(
        limitations.iter().any(|l| l
            .as_str()
            .unwrap()
            .contains("Conclusion is required by the template")),
        "{limitations:?}"
    );
    let c1_block = block_with(&lookup_pool, &v1, "15 of 1,000").await;
    let (status, support) = accountable
        .read(
            &format!("{base}/versions/{v1}/claims/{c1_block}/support"),
            &accountable.csrf,
        )
        .await;
    assert_eq!(status, 200, "{support}");
    assert_eq!(support["items"].as_array().unwrap().len(), 2);
    assert_eq!(support["items"][0]["pinned"]["value"], "15");
    fixture(
        &serde_json::json!({"shelf": task_shelf, "version": view, "support": support}),
        "work-product.json",
    );

    // A person's edit: an edited narrative and claim sentence, a removed
    // claim; every kept block is unchanged with its author.
    let narrative = block_with(&lookup_pool, &v1, "Test whether").await;
    let c3_block = block_with(&lookup_pool, &v1, "INV-0055").await;
    let c4_block = block_with(&lookup_pool, &v1, "The policy").await;
    let edit = |key: &str, base_version: &str, overrides: &[(&str, &str)], drop: &[&str]| {
        let blocks: Vec<serde_json::Value> = v1_blocks
            .iter()
            .filter(|b| !drop.contains(&b.0.as_str()))
            .map(|b| match overrides.iter().find(|(id, _)| *id == b.0) {
                Some((_, text)) => serde_json::json!({"block": b.0, "text": text}),
                None => serde_json::json!({"block": b.0}),
            })
            .collect();
        serde_json::json!({"key": key, "base_version": base_version, "blocks": blocks})
    };
    let edited = [
        (
            narrative.as_str(),
            "Test whether every invoice above the threshold was approved before payment.",
        ),
        (
            c1_block.as_str(),
            "15 of 1,000 applicable invoices lacked a recorded approver.",
        ),
        (
            c4_block.as_str(),
            "=HYPERLINK the policy requires an approver above 1,000.00 USD.",
        ),
    ];
    let first = edit("edit-1", &v1, &edited, &[&c3_block]);
    let (status, v2_view) = accountable.post(&format!("{base}/versions"), &first).await;
    assert_eq!(status, 200, "{v2_view}");
    let v2 = v2_view["id"].as_str().unwrap().to_string();
    assert_eq!(
        (v2_view["version"].as_str(), v2_view["author_kind"].as_str()),
        (Some("2"), Some("human"))
    );
    let v2_blocks = blocks_of(&lookup_pool, &v2).await;
    assert_eq!(v2_blocks.len(), v1_blocks.len() - 1);
    for b in &v2_blocks {
        let source = v1_blocks.iter().find(|s| s.0 == b.0).unwrap();
        if edited.iter().any(|(id, _)| *id == b.0) {
            assert_eq!((b.3.as_str(), b.4.as_str()), ("human", v2.as_str()));
        } else {
            assert_eq!(b, source, "a kept block is unchanged with its author");
        }
    }
    let (status, again) = accountable.post(&format!("{base}/versions"), &first).await;
    assert_eq!(
        (status, again["id"].as_str()),
        (200, Some(v2.as_str())),
        "an exact retry returns the original"
    );
    let (status, conflict) = accountable
        .post(&format!("{base}/versions"), &edit("edit-1", &v1, &[], &[]))
        .await;
    assert_eq!(
        (status, conflict["error"].as_str()),
        (409, Some("work_product_edit_conflict"))
    );
    let (status, stale) = accountable
        .post(&format!("{base}/versions"), &edit("edit-2", &v1, &[], &[]))
        .await;
    assert_eq!(
        (status, stale["error"].as_str(), stale["head"].as_str()),
        (409, Some("stale_base"), Some(v2.as_str()))
    );
    let wrong = serde_json::json!({"key": "edit-3", "base_version": v2, "blocks": v2_blocks.iter().map(|b| if b.0 == c1_block {
        serde_json::json!({"block": b.0, "text": "16 of 1,000 applicable invoices lacked a recorded approver."})
    } else { serde_json::json!({"block": b.0}) }).collect::<Vec<_>>()});
    let (status, refused_edit) = accountable.post(&format!("{base}/versions"), &wrong).await;
    assert_eq!(
        (status, refused_edit["error"].as_str()),
        (409, Some("unsupported_figure")),
        "{refused_edit}"
    );
    assert!(refused_edit["refusals"][0]["block"].is_number());
    let keep_all = |key: &str| serde_json::json!({"key": key, "base_version": v2, "blocks": v2_blocks.iter().map(|b| serde_json::json!({"block": b.0})).collect::<Vec<_>>()});
    let (status, denied) = administrator
        .post(&format!("{base}/versions"), &keep_all("admin-edit"))
        .await;
    assert_eq!(status, 403, "Admin alone may not edit: {denied}");
    // Two people edit the latest version at once: one successor.
    let route = format!("{base}/versions");
    let (race_a, race_b) = (keep_all("race-a"), keep_all("race-b"));
    let (a, b) = tokio::join!(
        accountable.post(&route, &race_a),
        manager.post(&route, &race_b),
    );
    let mut outcomes = [a.0, b.0];
    outcomes.sort();
    assert_eq!(
        outcomes,
        [200, 409],
        "one successor per version: {a:?} {b:?}"
    );
    let loser = if a.0 == 409 { &a.1 } else { &b.1 };
    assert_eq!(loser["error"], "stale_base");
    let v3 = head(&lookup_pool).await;
    let (status, v1_now) = accountable
        .read(&format!("{base}/versions/{v1}"), &accountable.csrf)
        .await;
    assert_eq!(status, 200);
    assert_eq!(
        v1_now["newer_version_id"],
        v3.as_str(),
        "a newer version is announced"
    );

    // AC2: the DOCX and XLSX exports of version 2.
    let export = |format: &str, key: &str| serde_json::json!({"format": format, "key": key});
    let (status, docx) = accountable
        .post(
            &format!("{base}/versions/{v2}/exports"),
            &export("docx", "docx-1"),
        )
        .await;
    assert_eq!(status, 200, "{docx}");
    let (status, docx_again) = accountable
        .post(
            &format!("{base}/versions/{v2}/exports"),
            &export("docx", "docx-2"),
        )
        .await;
    assert_eq!(status, 200);
    assert_eq!(
        docx["digest"], docx_again["digest"],
        "the same version, format and withheld set give identical bytes"
    );
    let (status, bytes, kind) = manager
        .bytes(&format!(
            "{base}/exports/{}/content",
            docx["id"].as_str().unwrap()
        ))
        .await;
    assert_eq!(
        status, 200,
        "another viewer with the same withheld set downloads it"
    );
    assert_eq!(
        kind,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    assert_eq!(sha(&bytes), docx["digest"].as_str().unwrap());
    let parts = zobba_domain::work_product::export::unzip(&bytes).expect("a valid ZIP");
    let document = String::from_utf8(
        parts
            .iter()
            .find(|(n, _)| n == "word/document.xml")
            .unwrap()
            .1
            .clone(),
    )
    .unwrap();
    let v2_digest: String =
        sqlx::query_scalar("SELECT digest FROM public.work_product_versions WHERE id=$1")
            .bind(&v2)
            .fetch_one(&mut admin)
            .await
            .unwrap();
    assert!(document.contains(&format!(
        "Source revision: {v2} · version 2 · sha256 {v2_digest}"
    )));
    assert!(document.contains("Not completed in this version."));
    assert!(
        document.contains("w:anchor=\"citation_1\"") && document.contains("w:name=\"citation_1\"")
    );
    assert!(document.contains("Draft — not reviewed"));
    let footer = String::from_utf8(
        parts
            .iter()
            .find(|(n, _)| n == "word/footer1.xml")
            .unwrap()
            .1
            .clone(),
    )
    .unwrap();
    assert!(footer.contains("PAGE") && footer.contains(&v2));
    let (status, xlsx) = accountable
        .post(
            &format!("{base}/versions/{v2}/exports"),
            &export("xlsx", "xlsx-1"),
        )
        .await;
    assert_eq!(status, 200, "{xlsx}");
    let (status, bytes, _) = accountable
        .bytes(&format!(
            "{base}/exports/{}/content",
            xlsx["id"].as_str().unwrap()
        ))
        .await;
    assert_eq!(status, 200);
    let sheets = zobba_domain::work_product::export::unzip(&bytes).unwrap();
    let all: String = sheets
        .iter()
        .filter(|(n, _)| n.starts_with("xl/worksheets/"))
        .map(|(_, b)| String::from_utf8(b.clone()).unwrap())
        .collect();
    assert_eq!(
        all.matches("<f>").count(),
        1,
        "one SUM formula, never a formula from text"
    );
    assert!(
        all.contains("=HYPERLINK the policy"),
        "a statement starting with = is an inline string"
    );
    let (status, scope_changed) = accountable
        .post(
            &format!("{base}/versions/{v2}/exports"),
            &export("xlsx", "docx-1"),
        )
        .await;
    assert_eq!(
        (status, scope_changed["error"].as_str()),
        (409, Some("work_product_export_conflict"))
    );

    // AC3: records change after publication. A person replaces INV-0055's
    // verdict; a person asks to reconsider INV-0042 (the agent then revises
    // it on late evidence and summarises the coverage again).
    let head_of = |subject: &'static str| {
        let lookup = lookup_pool.clone();
        async move {
            sqlx::query_scalar::<_, String>("SELECT coalesce((SELECT r.id FROM public.assessment_evaluation_revisions r WHERE r.chain_id=e.id ORDER BY r.revision DESC LIMIT 1), e.id) FROM public.assessment_evaluations e WHERE e.subject=$1")
                .bind(subject)
                .fetch_one(&lookup)
                .await
                .unwrap()
        }
    };
    let (status, saved) = accountable
        .dispose(
            task,
            &head_of("INV-0055").await,
            &disposition(
                "replace-0055",
                "replaced",
                Some("met"),
                None,
                "The requester is not the approver.",
                policy_reference(),
            ),
        )
        .await;
    assert_eq!(status, 200, "{saved}");
    let (status, saved) = accountable
        .dispose(
            task,
            &head_of("INV-0042").await,
            &disposition(
                "reconsider-0042",
                "needs_reconsideration",
                None,
                Some("facts"),
                "An approver may be on file.",
                serde_json::json!([]),
            ),
        )
        .await;
    assert_eq!(status, 200, "{saved}");
    let started = Instant::now();
    settle(&tasks, &provider, &receipt.task_id, 13).await;
    let cycle = started.elapsed();

    // Version 1 is unchanged; its claims say why they need refresh.
    let (_, v1_after) = accountable
        .read(&format!("{base}/versions/{v1}"), &accountable.csrf)
        .await;
    assert_eq!(
        v1_after["digest"],
        digest.as_str(),
        "version 1's bytes are unchanged"
    );
    let refresh_of = |view: &serde_json::Value, start: &str| -> Vec<String> {
        view["sections"]
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|s| s["blocks"].as_array().unwrap().iter())
            .find(|b| b["text"].as_str().is_some_and(|t| t.starts_with(start)))
            .map(|b| {
                b["claim"]["refresh"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|r| r.as_str().unwrap().to_string())
                    .collect()
            })
            .unwrap()
    };
    assert_eq!(refresh_of(&v1_after, "15 of 1,000"), ["summary_superseded"]);
    fixture(&v1_after, "work-product-stale.json");
    assert_eq!(
        refresh_of(&v1_after, "Segregation of duties"),
        ["evaluation_revised"]
    );
    assert_eq!(refresh_of(&v1_after, "INV-0055"), ["disposition_changed"]);
    assert_eq!(
        refresh_of(&v1_after, "The coverage summary"),
        ["summary_superseded"]
    );
    assert!(
        refresh_of(&v1_after, "The policy").is_empty(),
        "the quote is still current"
    );
    assert_eq!(v1_after["refresh"], "4");

    // The refresh: the agent's successor keeps the person's blocks; the
    // draft that drops one and the draft on a superseded version are
    // refused; the scale draft is recorded.
    let recorded = versions(&mut admin).await;
    let numbered: Vec<(i32, &str)> = recorded.iter().map(|(n, _, k)| (*n, k.as_str())).collect();
    assert_eq!(
        numbered,
        [
            (1, "agent"),
            (2, "human"),
            (3, "human"),
            (4, "agent"),
            (5, "agent")
        ]
    );
    let v4 = recorded[3].1.clone();
    let v4_blocks = blocks_of(&lookup_pool, &v4).await;
    for b in v2_blocks.iter().filter(|b| b.3 == "human") {
        assert!(
            v4_blocks.iter().any(|k| k == b),
            "the agent kept the person's block {}",
            b.0
        );
    }
    let (_, v4_view) = accountable
        .read(&format!("{base}/versions/{v4}"), &accountable.csrf)
        .await;
    assert!(
        refresh_of(&v4_view, "After late evidence").is_empty(),
        "the refreshed claim is current"
    );
    let bodies = provider.bodies.lock().unwrap().clone();
    assert!(
        bodies[10].contains("human_block_dropped"),
        "dropping a person's block is refused"
    );
    assert!(
        bodies[11].contains("stale_base"),
        "a superseded base is refused"
    );
    assert!(
        bodies[8].contains("need refresh"),
        "the outline counts claims needing refresh"
    );
    let v5 = recorded[4].1.clone();
    let claims: i32 =
        sqlx::query_scalar("SELECT claims FROM public.work_product_versions WHERE id=$1")
            .bind(&v5)
            .fetch_one(&mut admin)
            .await
            .unwrap();
    assert_eq!(claims, 24, "four kept claims and twenty new ones");

    // Realistic size: reads of a version with 24 claims and 85 assertions
    // stay well within the runtime's statement bound.
    let timed = Instant::now();
    let (status, v5_view) = accountable
        .read(&format!("{base}/versions/{v5}"), &accountable.csrf)
        .await;
    assert_eq!(status, 200, "{v5_view}");
    let (status, _) = accountable.read("work-products", &accountable.csrf).await;
    assert_eq!(status, 200);
    assert!(
        timed.elapsed() < Duration::from_secs(5),
        "reads took {:?}",
        timed.elapsed()
    );
    assert!(
        cycle < Duration::from_secs(300),
        "the refresh cycle took {cycle:?}"
    );

    database_guards_refuse_altered_work_product_records(
        &mut admin,
        &mut owner,
        &pool,
        &v1,
        &v2,
        &v5,
        &secret_hash(&accountable.token),
    )
    .await;

    let _ = stop.send(true);
    let _ = tokio::time::timeout(Duration::from_secs(30), worker).await;
    server.abort();
}

const RESET: &str = "SET LOCAL zobba.disposable_fixture_reset='on'";
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
fn person(session: &str) -> String {
    format!(
        "SELECT set_config('zobba.organisation_id','org-a',true),set_config('zobba.client_id','client-a',true),set_config('zobba.engagement_id','engagement-a',true),set_config('zobba.actor_id','actor-a',true),set_config('zobba.session_hash','{session}',true)"
    )
}

const ASSERTION_COLUMNS: &str = "organisation_id,client_id,engagement_id,task_id,actor_id,version_id,block_id,ordinal,kind,record_kind,record_id,record_digest,measure,criterion_id,value,origin,review,locator,unit,subject";

/// Work-product records are immutable even for the owner and under the
/// fixture reset (which may only delete); the database refuses a person's
/// version outside their own session, an assertion that does not agree with
/// its record now (one bad row of a multi-row statement refuses the whole
/// statement) and a version that does not edit the latest.
#[allow(clippy::too_many_arguments)]
async fn database_guards_refuse_altered_work_product_records(
    admin: &mut PgConnection,
    owner: &mut PgConnection,
    pool: &sqlx::PgPool,
    v1: &str,
    v2: &str,
    v5: &str,
    session: &str,
) {
    let tables = [
        "work_products",
        "work_product_versions",
        "work_product_blocks",
        "work_product_assertions",
        "work_product_exports",
    ];
    for table in tables {
        for statement in [
            format!("UPDATE public.{table} SET actor_id=actor_id"),
            format!("DELETE FROM public.{table}"),
        ] {
            assert_refused(
                &refused(admin, &statement).await,
                "work-product records are immutable",
                &statement,
            );
            let lifted = format!("ALTER TABLE public.{table} NO FORCE ROW LEVEL SECURITY");
            assert_refused(
                &refused_in(owner, std::slice::from_ref(&lifted), &statement).await,
                "work-product records are immutable",
                &statement,
            );
        }
        let statement = format!("TRUNCATE public.{table} CASCADE");
        assert_refused(
            &refused(admin, &statement).await,
            "work-product records are retained",
            &statement,
        );
        assert_refused(
            &refused(owner, &statement).await,
            "work-product records are retained",
            &statement,
        );
        let message = refused_in(
            admin,
            &[RESET.into()],
            &format!("UPDATE public.{table} SET actor_id=actor_id"),
        )
        .await;
        assert_refused(&message, "work-product records are immutable", table);
        let runtime = sqlx::query(&format!("DELETE FROM public.{table}"))
            .execute(pool)
            .await
            .expect_err("the runtime deleted a record")
            .to_string();
        assert!(runtime.contains("permission denied"), "{table}: {runtime}");
    }
    // Forced RLS: nothing visible under another engagement's scope.
    for (engagement, visible) in [("engagement-a", true), ("engagement-b", false)] {
        let mut tx = owner.begin().await.unwrap();
        sqlx::query(&format!("SELECT set_config('zobba.organisation_id','org-a',true),set_config('zobba.client_id','client-a',true),set_config('zobba.engagement_id','{engagement}',true)"))
            .execute(&mut *tx)
            .await
            .unwrap();
        for table in tables {
            let rows: i64 = sqlx::query_scalar(&format!("SELECT count(*) FROM public.{table}"))
                .fetch_one(&mut *tx)
                .await
                .unwrap();
            assert_eq!(rows > 0, visible, "{engagement} {table}: {rows}");
        }
        tx.rollback().await.unwrap();
    }

    // A forged count among good rows: the scale version's first claim's
    // assertions are deleted under the reset and written again, once
    // unchanged (accepted) and once with one more row whose count is wrong
    // (the whole statement is refused, naming the bad row).
    let claim: String = sqlx::query_scalar("SELECT block_id FROM public.work_product_assertions WHERE version_id=$1 AND record_kind='effective_summary' ORDER BY block_id LIMIT 1")
        .bind(v5)
        .fetch_one(&mut *admin)
        .await
        .unwrap();
    let setup = [
        RESET.to_string(),
        format!(
            "CREATE TEMP TABLE kept_assertion ON COMMIT DROP AS SELECT * FROM public.work_product_assertions WHERE version_id='{v5}' AND block_id='{claim}'"
        ),
        format!(
            "DELETE FROM public.work_product_assertions WHERE version_id='{v5}' AND block_id='{claim}'"
        ),
    ];
    let good = format!("SELECT {ASSERTION_COLUMNS} FROM kept_assertion");
    accepted_in(
        admin,
        &setup,
        &format!("INSERT INTO public.work_product_assertions({ASSERTION_COLUMNS}) {good}"),
    )
    .await;
    let bad_columns = ASSERTION_COLUMNS
        .replace("ordinal", "7")
        .replace(",value,", ",(value::bigint+1)::text,");
    let bad = format!("SELECT {bad_columns} FROM kept_assertion WHERE ordinal=0");
    let message = refused_in(
        admin,
        &setup,
        &format!(
            "INSERT INTO public.work_product_assertions({ASSERTION_COLUMNS}) {good} UNION ALL {bad}"
        ),
    )
    .await;
    assert_refused(
        &message,
        &format!("a work-product assertion does not agree with its record now: {v5}/{claim}/7"),
        "a forged count",
    );
    // A quote pinned to another digest.
    let quote_claim: String = sqlx::query_scalar(
        "SELECT block_id FROM public.work_product_assertions WHERE version_id=$1 AND kind='quote'",
    )
    .bind(v1)
    .fetch_one(&mut *admin)
    .await
    .unwrap();
    let setup = [
        RESET.to_string(),
        format!(
            "CREATE TEMP TABLE kept_assertion ON COMMIT DROP AS SELECT * FROM public.work_product_assertions WHERE version_id='{v1}' AND block_id='{quote_claim}'"
        ),
        format!(
            "DELETE FROM public.work_product_assertions WHERE version_id='{v1}' AND block_id='{quote_claim}'"
        ),
    ];
    let forged = ASSERTION_COLUMNS.replace("record_digest", &format!("'{}'", "b".repeat(64)));
    assert_refused(
        &refused_in(admin, &setup, &format!("INSERT INTO public.work_product_assertions({ASSERTION_COLUMNS}) SELECT {forged} FROM kept_assertion")).await,
        "does not agree with its record now",
        "a quote with another digest",
    );

    // A person's version outside a live session, and one in it that does
    // not edit the latest version.
    let columns = "organisation_id,client_id,engagement_id,task_id,actor_id,product_id,id,version,predecessor_id,author_kind,author_id,invocation_id,cycle_id,key,title,kind,methodology_binding_id,execution_epoch,blocks,claims,missing_required,document,digest";
    let copy = columns
        .replace(",id,", &format!(",'wpv-{}',", "c".repeat(40)))
        .replace(",key,", ",'forged-key',");
    let statement = format!(
        "INSERT INTO public.work_product_versions({columns}) SELECT {copy} FROM public.work_product_versions WHERE id='{v2}'"
    );
    assert_refused(
        &refused_in(admin, &[], &statement).await,
        "saved by a currently assigned auditor or audit manager in their own session",
        "no session",
    );
    assert_refused(
        &refused_in(admin, &[person(session)], &statement).await,
        "a work-product version edits its product's latest version",
        "a fork of version 1",
    );
    // The fixture reset may delete (in a *_test database), never update.
    accepted_in(
        admin,
        &[RESET.into()],
        "DELETE FROM public.work_product_exports",
    )
    .await;
}
