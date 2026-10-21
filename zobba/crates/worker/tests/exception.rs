//! Story 24.3b proof: Task-scoped exceptions and the effective summary, end
//! to end. The production work coordinator with the trusted assessment
//! composition records not_met results whose occurrences the database
//! writes; trusted code derives every exception status and the effective
//! summary that PostgreSQL recounts; the real authenticated API lists the
//! exceptions and lets the accountable person or an Audit manager close and
//! reopen one (never anyone else, never without verified evidence). A native
//! OpenAI loopback provider stands in for the model (never a live provider):
//! it only names what to ask for, never a count or a status. Requires a
//! guarded `_test` database, the OIDC fixture environment and a Docker
//! engine with the pinned image; it fails, never skips, without them.
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
        "summarise_effective": [],
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
    /// A read in another engagement's scope.
    async fn read_in(
        &self,
        engagement: &str,
        organisation: &str,
        client: &str,
        route: &str,
    ) -> (u16, serde_json::Value) {
        let response = self
            .client
            .get(format!(
                "{}/engagements/{engagement}/{route}?organisation_id={organisation}&client_id={client}",
                self.address
            ))
            .header("Cookie", format!("__Host-zobba-session={}", self.token))
            .header("X-Expected-Session", &self.csrf)
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
/// The subjects the model judges (each not met at first).
const JUDGED: &[&str] = &["INV-0042", "000123", "INV-0054", "INV-0055", "INV-0051"];
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
/// The population of every invoice of Sheet1 with its approval-history flag.
fn invoices(key: &str, basis: &str) -> serde_json::Value {
    serde_json::json!({
        "key": key, "basis": basis, "supersedes": "", "original_id": "ap-invoices",
        "sheet": "Sheet1", "header_row": 1, "subject_unit": "invoice", "grain": ["Invoice"],
        "period_column": "Invoice date", "period_rule": "date_dmy",
        "value_columns": [
            {"header": "In approval history", "name": "in_history", "type": "boolean", "rule": "boolean_yes_no", "unit": "", "currency": "", "measure_column": ""},
        ],
        "exhaustive": true,
        "control_original_id": "", "control_locator": "", "control_quote": "", "control_rule": "",
        "selection": "Every invoice row of Sheet1",
    })
}
fn exception_disposition(
    key: &str,
    kind: &str,
    references: serde_json::Value,
) -> serde_json::Value {
    serde_json::json!({
        "key": key, "kind": kind,
        "rationale": "The approver confirmed the approval in writing after the review.",
        "references": references,
    })
}

/// One stored exception: (subject, criterion lineage root, ID).
async fn exceptions(admin: &mut PgConnection) -> Vec<(String, String, String)> {
    sqlx::query_as("SELECT subject, criterion_root, id FROM public.assessment_exceptions ORDER BY subject COLLATE \"C\", criterion_root COLLATE \"C\"")
        .fetch_all(admin)
        .await
        .unwrap()
}
async fn occurrences(admin: &mut PgConnection, exception: &str) -> Vec<(String, String)> {
    sqlx::query_as("SELECT source_kind, origin FROM public.assessment_exception_occurrences WHERE exception_id=$1 ORDER BY source_us, source_id COLLATE \"C\"")
        .bind(exception)
        .fetch_all(admin)
        .await
        .unwrap()
}
/// The status the database derives for every exception, by subject and
/// criterion key.
async fn statuses(admin: &mut PgConnection) -> Vec<(String, String, String, String)> {
    sqlx::query_as("SELECT x.subject, c.document->>'key', s.status, s.latest_observed FROM public.assessment_exceptions x JOIN public.assessment_criteria c ON c.id=x.criterion_root CROSS JOIN LATERAL public.assessment_exception_status(x.organisation_id,x.client_id,x.engagement_id,x.id) s ORDER BY x.subject COLLATE \"C\", c.document->>'key'")
        .fetch_all(admin)
        .await
        .unwrap()
}
fn row4(subject: &str, key: &str, status: &str, latest: &str) -> (String, String, String, String) {
    (subject.into(), key.into(), status.into(), latest.into())
}
/// An effective summary's stored row: its ID, conclusion, counts (failing,
/// meets, unresolved, not applicable to any, failing opportunities, human
/// replaced, pending, undisposed, superseded, exceptions total, open,
/// resolved, replaced, closed, subjects, in scope), what it supersedes and
/// its document.
type EffectiveRow = (String, String, Vec<i32>, Option<String>, serde_json::Value);
async fn effective_rows(admin: &mut PgConnection) -> Vec<EffectiveRow> {
    type Stored = (String, String, Vec<i32>, Option<String>, String);
    let rows: Vec<Stored> = sqlx::query_as("SELECT id,conclusion,ARRAY[failing_subjects,meets_every_applicable,unresolved_subjects,not_applicable_to_any,failing_opportunities,human_replaced,pending_reconsideration,undisposed,superseded,exceptions_total,exceptions_open,exceptions_resolved,exceptions_replaced,exceptions_closed,exception_subjects,in_scope],supersedes,document::text FROM public.assessment_effective_summaries ORDER BY created_us, id COLLATE \"C\"")
        .fetch_all(admin)
        .await
        .unwrap();
    rows.into_iter()
        .map(|r| (r.0, r.1, r.2, r.3, serde_json::from_str(&r.4).unwrap()))
        .collect()
}
fn limitation_codes(document: &serde_json::Value) -> Vec<(String, Option<u64>)> {
    document["effective"]["limitations"]
        .as_array()
        .unwrap()
        .iter()
        .map(|l| (l["code"].as_str().unwrap().to_string(), l["count"].as_u64()))
        .collect()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn every_not_met_result_is_an_exception_whose_status_is_derived_and_recounted() {
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
    register(&mut admin, &objects, "ap-invoices", "AP invoices.xlsx").await;
    register(&mut admin, &objects, "ap-bulk", "AP invoices bulk.xlsx").await;
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
                key: "ap-exceptions".into(),
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
            let ids = || async {
                (
                    basis_id(&lookup, &task_id, "fy2026").await,
                    criterion_id(&lookup, &task_id, "history").await,
                    criterion_id(&lookup, &task_id, "segregation").await,
                )
            };
            let population = || async {
                sqlx::query_scalar::<_, String>("SELECT id FROM public.assessment_populations WHERE task_id=$1 AND document->>'key'='invoices'")
                    .bind(&task_id)
                    .fetch_one(&lookup)
                    .await
                    .unwrap()
            };
            match index {
                // Turn 1: a rule and a judgment criterion, one basis and
                // each judged invoice's identifier.
                0 => text_reply(&answer(serde_json::json!({
                    "propose_criteria": [
                        criterion("history", "Every invoice appears in the approval history", ("method", "AP-1", "", ""),
                            none(), vec![required("in_history", "boolean", "")],
                            "rule", predicate("is_true", "in_history", "", "", ""), ""),
                        criterion("segregation", "Segregation of duties is adequate given the organisation chart", ("method", "AP-1", "", ""),
                            none(), vec![],
                            "judgment", none(), "The approver and the requester report to different managers"),
                    ],
                    "propose_basis": [{
                        "key": "fy2026", "supersedes": "", "objective": "Assess approval of 2026 AP invoices",
                        "criteria": ["history", "segregation"],
                        "period_from": "2026-01-01", "period_to": "2026-12-31", "as_of": "2026-03-31T00:00:00Z",
                        "population": [{"original_id": "ap-invoices", "unit": "invoice", "selection": "Every invoice in the AP export"}],
                        "limitations": [],
                    }],
                    "record_facts": JUDGED.iter().map(|s| invoice("fy2026", s)).collect::<Vec<_>>(),
                }))),
                // Turn 2: five judgments, each not met.
                1 => {
                    let (b, _, segregation) = ids().await;
                    text_reply(&answer(serde_json::json!({
                        "judgments": JUDGED.iter().map(|s| judgment(&segregation, &b, s, "not_met", &["invoice"])).collect::<Vec<_>>(),
                    })))
                }
                // Turn 3: the population of every invoice, both criteria
                // over it (a judgment criterion uses its recorded judgments)
                // and its summary.
                2 => {
                    let (b, history, segregation) = ids().await;
                    text_reply(&answer(serde_json::json!({
                        "propose_population": [invoices("invoices", &b)],
                        "evaluate_population": [{"criterion": history, "population": "invoices"}, {"criterion": segregation, "population": "invoices"}],
                        "summarise": [{"basis": b, "population": "invoices", "sample": ""}],
                    })))
                }
                // Turn 4: late evidence (two approvers), the judgments
                // again (met), and the effective summary.
                3 => {
                    let (b, _, segregation) = ids().await;
                    let p = population().await;
                    text_reply(&answer(serde_json::json!({
                        "record_facts": [approver_of(&b, "INV-0042", "J. Smith"), approver_of(&b, "INV-0055", "A. Jones")],
                        "judgments": [
                            judgment(&segregation, &b, "INV-0042", "met", &["invoice", "approver"]),
                            judgment(&segregation, &b, "INV-0055", "met", &["invoice", "approver"]),
                        ],
                        "summarise_effective": [{"basis": b, "population": p, "sample": ""}],
                    })))
                }
                // Turn 6 (after a person's dispositions and a request for
                // reconsideration): INV-0051's currency (evidence its closure
                // never saw) and its judgment again (not met); INV-0054's
                // judgment again on the same evidence (not met); a new
                // version of the population with the judgment criterion over
                // it (its opportunities name recorded judgments, so no fresh
                // occurrence); and the effective summary again.
                5 => {
                    let (b, _, segregation) = ids().await;
                    let p = population().await;
                    let mut v2 = invoices("invoices-v2", &b);
                    v2["supersedes"] = serde_json::json!(p);
                    text_reply(&answer(serde_json::json!({
                        "record_facts": [fact(&b, "INV-0051", "currency", "identifier", "USD", "", "identifier_exact",
                            vec![("cell:Sheet1!C7", "USD"), ("cell:Sheet1!A7", "INV-0051")])],
                        "judgments": [
                            judgment(&segregation, &b, "INV-0051", "not_met", &["invoice", "currency"]),
                            judgment(&segregation, &b, "INV-0054", "not_met", &["invoice"]),
                        ],
                        "propose_population": [v2],
                        "evaluate_population": [{"criterion": segregation, "population": "invoices-v2"}],
                        "summarise_effective": [{"basis": b, "population": p, "sample": ""}],
                    })))
                }
                // Turn 7: the same effective summary once more: nothing
                // changed, so nothing is recorded, and the answer.
                6 => {
                    let (b, _, _) = ids().await;
                    let p = population().await;
                    text_reply(&answer(serde_json::json!({
                        "summarise_effective": [{"basis": b, "population": p, "sample": ""}],
                        "segments": [{"text": "The exceptions are listed with their status.", "sources": []}],
                    })))
                }
                // Turn 8 (scale): the 20,000-invoice population and the rule
                // criterion over it (19,000 rule results not met), and the judgment
                // criterion (its recorded judgments name no bulk invoice).
                7 => {
                    let (b, history, segregation) = ids().await;
                    let mut bulk = invoices("bulk", &b);
                    bulk["original_id"] = serde_json::json!("ap-bulk");
                    bulk["selection"] = serde_json::json!("Every invoice row of the bulk export");
                    text_reply(&answer(serde_json::json!({
                        "propose_population": [bulk],
                        "evaluate_population": [{"criterion": history, "population": "bulk"}, {"criterion": segregation, "population": "bulk"}],
                    })))
                }
                // Turn 9: its effective summary (the answer follows).
                8 => {
                    let (b, _, _) = ids().await;
                    let p: String = sqlx::query_scalar("SELECT id FROM public.assessment_populations WHERE task_id=$1 AND document->>'key'='bulk'")
                        .bind(&task_id)
                        .fetch_one(&lookup)
                        .await
                        .unwrap();
                    text_reply(&answer(serde_json::json!({
                        "summarise_effective": [{"basis": b, "population": p, "sample": ""}],
                    })))
                }
                _ => text_reply(&answer(serde_json::json!({
                    "segments": [{"text": "The exceptions are listed with their status.", "sources": []}],
                }))),
            }
        })
    });
    let provider = Loopback::answering(responder).await;

    let unused = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let gateway_address = unused.local_addr().unwrap();
    let staging = std::env::temp_dir().join(format!("zobba-exception-{}", std::process::id()));
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
    settle(&tasks, &provider, &receipt.task_id, 5).await;

    // Every not_met result is an occurrence of its exception, written by the
    // database in the statement that recorded the result: five judgments and
    // one rule opportunity. A judgment's population opportunity names the
    // recorded judgment (its own occurrence) and adds none; met results and
    // later revisions that meet add none.
    let found = exceptions(&mut admin).await;
    let keyed: Vec<(String, String)> = statuses(&mut admin)
        .await
        .into_iter()
        .map(|(s, k, _, _)| (s, k))
        .collect();
    assert_eq!(
        keyed,
        vec![
            ("000123".to_string(), "segregation".to_string()),
            ("INV-0042".into(), "segregation".into()),
            ("INV-0051".into(), "segregation".into()),
            ("INV-0054".into(), "history".into()),
            ("INV-0054".into(), "segregation".into()),
            ("INV-0055".into(), "segregation".into()),
        ],
        "one exception per criterion lineage and subject: {found:?}"
    );
    let named: Vec<(String, String, String)> = sqlx::query_as("SELECT x.subject, c.document->>'key', x.id FROM public.assessment_exceptions x JOIN public.assessment_criteria c ON c.id=x.criterion_root")
        .fetch_all(&mut admin)
        .await
        .unwrap();
    let id_of = |subject: &str, key: &str| -> String {
        named
            .iter()
            .find(|(s, k, _)| s == subject && k == key)
            .unwrap()
            .2
            .clone()
    };
    for (subject, key, expected) in [
        (
            "INV-0042",
            "segregation",
            vec![("evaluation", "model_proposal")],
        ),
        (
            "INV-0054",
            "history",
            vec![("opportunity", "deterministic")],
        ),
        (
            "INV-0051",
            "segregation",
            vec![("evaluation", "model_proposal")],
        ),
    ] {
        let rows = occurrences(&mut admin, &id_of(subject, key)).await;
        let rows: Vec<(&str, &str)> = rows.iter().map(|(a, b)| (a.as_str(), b.as_str())).collect();
        assert_eq!(rows, expected, "{subject} {key}");
    }
    let total: i64 =
        sqlx::query_scalar("SELECT count(*) FROM public.assessment_exception_occurrences")
            .fetch_one(&mut admin)
            .await
            .unwrap();
    assert_eq!(total, 6, "every not_met result, and nothing else");
    // Statuses are derived: late evidence makes the model propose met for
    // two exceptions, which stay open until a person accepts the proposal
    // (owner decision 2026-10-21); the rest stay open.
    assert_eq!(
        statuses(&mut admin).await,
        vec![
            row4("000123", "segregation", "open", "not_met"),
            row4("INV-0042", "segregation", "open", "proposed_met"),
            row4("INV-0051", "segregation", "open", "not_met"),
            row4("INV-0054", "history", "open", "not_met"),
            row4("INV-0054", "segregation", "open", "not_met"),
            row4("INV-0055", "segregation", "open", "proposed_met"),
        ]
    );
    // The first effective summary, recounted by the database.
    let effective = effective_rows(&mut admin).await;
    assert_eq!(effective.len(), 1, "{effective:?}");
    let (first_id, conclusion, counts, supersedes, document) = &effective[0];
    assert_eq!(
        (conclusion.as_str(), counts.as_slice(), supersedes),
        (
            "exceptions_found_inconclusive",
            &[3, 2, 4, 0, 4, 0, 0, 5, 0, 6, 6, 0, 0, 0, 5, 9][..],
            &None
        )
    );
    assert_eq!(
        limitation_codes(document),
        vec![
            ("unresolved_subjects".to_string(), Some(4)),
            ("unreviewed_model_proposals".to_string(), Some(5)),
            ("open_exceptions".to_string(), Some(6)),
        ]
    );
    assert_eq!(document["effective"]["listed"].as_array().unwrap().len(), 6);
    let bodies = provider.bodies.lock().unwrap().clone();
    assert!(
        bodies[4].contains(&format!("Effective summary {first_id}")),
        "the next turn reads the recorded effective summary"
    );
    assert!(
        bodies[4].contains("exceptions under basis"),
        "the outline counts the exceptions by status"
    );

    // The real API: the accountable person and an Audit manager dispose.
    let auth = zobba_api::auth::AuthState::from_environment(&database).unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = format!("http://{}", listener.local_addr().unwrap());
    let app = zobba_api::authenticated_router_with_evidence(database.clone(), auth, Some(store()));
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    // A currently assigned Auditor who is neither an Audit manager nor the
    // Task's accountable person.
    sqlx::raw_sql("INSERT INTO public.identities(id,issuer,subject,display_name) VALUES('actor-c','https://127.0.0.1:4443','auditor-c','Cameron Auditor');
        INSERT INTO public.organisation_memberships(organisation_id,actor_id,roles) VALUES('org-a','actor-c',ARRAY['auditor']);
        INSERT INTO public.engagement_assignments(organisation_id,client_id,engagement_id,actor_id) VALUES('org-a','client-a','engagement-a','actor-c');")
        .execute(&mut admin)
        .await
        .unwrap();
    let accountable = browser(&identities, &address, "auditor-a", "actor-a").await;
    let manager = browser(&identities, &address, "manager-a", "actor-manager").await;
    let other = browser(&identities, &address, "auditor-c", "actor-c").await;
    let administrator = browser(&identities, &address, "admin-only", "actor-admin").await;
    let task = receipt.task_id.as_str();
    let route =
        |exception: &str| format!("tasks/{task}/assessment/exceptions/{exception}/dispositions");

    // A person's verdict replaces the model's on 000123 (Story 24.3a).
    let chain_000123: String =
        sqlx::query_scalar("SELECT id FROM public.assessment_evaluations WHERE subject='000123'")
            .fetch_one(&mut admin)
            .await
            .unwrap();
    let (status, saved) = accountable
        .dispose(
            task,
            &chain_000123,
            &disposition(
                "replace-000123",
                "replaced",
                Some("met"),
                None,
                "The requester is not the approver.",
                policy_reference(),
            ),
        )
        .await;
    assert_eq!(status, 200, "{saved}");
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
    // A person accepts the model's met on INV-0042: the accepted proposal
    // from new evidence now resolves its exception (owner decision
    // 2026-10-21). INV-0055's proposal stays unreviewed.
    let (status, saved) = accountable
        .dispose(
            task,
            &head_of("INV-0042").await,
            &disposition(
                "accept-0042",
                "accepted",
                None,
                None,
                "The approver J. Smith is in the evidence.",
                serde_json::json!([]),
            ),
        )
        .await;
    assert_eq!(status, 200, "{saved}");
    assert_eq!(
        statuses(&mut admin).await[1],
        row4(
            "INV-0042",
            "segregation",
            "resolved_by_evidence",
            "not_observed"
        )
    );
    assert_eq!(
        statuses(&mut admin).await[5],
        row4("INV-0055", "segregation", "open", "proposed_met")
    );
    // A person's undetermined is not evidence of remediation (owner
    // decision 2026-10-21); a person's not_met is an occurrence (human).
    let head_0055 = head_of("INV-0055").await;
    let (status, saved) = accountable
        .dispose(
            task,
            &head_0055,
            &disposition(
                "undetermined-0055",
                "replaced",
                Some("undetermined"),
                None,
                "The organisation chart cannot be read.",
                serde_json::json!([]),
            ),
        )
        .await;
    assert_eq!(status, 200, "{saved}");
    assert_eq!(
        statuses(&mut admin).await[5],
        row4("INV-0055", "segregation", "open", "person_undetermined")
    );
    let seg_0055 = id_of("INV-0055", "segregation");
    assert_eq!(occurrences(&mut admin, &seg_0055).await.len(), 1);
    let (status, saved) = accountable
        .dispose(
            task,
            &head_0055,
            &disposition(
                "not-met-0055",
                "replaced",
                Some("not_met"),
                None,
                "A. Jones requested the payment too.",
                policy_reference(),
            ),
        )
        .await;
    assert_eq!(status, 200, "{saved}");
    assert_eq!(
        occurrences(&mut admin, &seg_0055).await,
        vec![
            ("evaluation".to_string(), "model_proposal".to_string()),
            ("disposition".into(), "human".into()),
        ],
        "a person's replaced not_met is an occurrence of its own"
    );
    assert_eq!(
        statuses(&mut admin).await[5],
        row4("INV-0055", "segregation", "open", "not_met")
    );

    let seg_0051 = id_of("INV-0051", "segregation");
    let before: String = sqlx::query_scalar("SELECT string_agg(source_id||origin||source_us, ',' ORDER BY source_id) FROM public.assessment_exception_occurrences")
        .fetch_one(&mut admin)
        .await
        .unwrap();
    // Closing without evidence, closing as an Auditor without that
    // authority, and closing as Admin alone are refused; nothing is written.
    let (status, refusal) = accountable
        .post(
            &route(&seg_0051),
            &exception_disposition("close-empty", "closed", serde_json::json!([])),
        )
        .await;
    assert_eq!(
        (status, refusal["error"].as_str()),
        (400, Some("exception_disposition_invalid"))
    );
    let (status, refusal) = other
        .post(
            &route(&seg_0051),
            &exception_disposition("close-other", "closed", policy_reference()),
        )
        .await;
    assert_eq!(
        (status, refusal["error"].as_str()),
        (403, Some("exception_close_forbidden")),
        "{refusal}"
    );
    let (status, refusal) = administrator
        .post(
            &route(&seg_0051),
            &exception_disposition("close-admin", "closed", policy_reference()),
        )
        .await;
    assert_eq!(
        (status, refusal["error"].as_str()),
        (403, Some("access_denied")),
        "{refusal}"
    );
    let (status, refusal) = accountable
        .post(
            &route(&seg_0051),
            &exception_disposition("reopen-open", "reopened", serde_json::json!([])),
        )
        .await;
    assert_eq!(
        (status, refusal["error"].as_str()),
        (409, Some("exception_not_closed"))
    );
    // One unverified reference refuses the whole request and names it.
    let (status, refusal) = accountable
        .post(
            &route(&seg_0051),
            &exception_disposition(
                "close-unverified",
                "closed",
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
    let written: i64 =
        sqlx::query_scalar("SELECT count(*) FROM public.assessment_exception_dispositions")
            .fetch_one(&mut admin)
            .await
            .unwrap();
    assert_eq!(written, 0, "nothing written");
    // The accountable person closes it with verified evidence; an exact
    // retry returns the original; another request under the key conflicts.
    let close = exception_disposition("close-0051", "closed", policy_reference());
    let (status, closed) = accountable.post(&route(&seg_0051), &close).await;
    assert_eq!(status, 200, "{closed}");
    assert_eq!(
        (closed["kind"].as_str(), closed["actor_id"].as_str()),
        (Some("closed"), Some("actor-a"))
    );
    assert_eq!(closed["references"][0]["quote"], POLICY_QUOTE);
    let (status, again) = accountable.post(&route(&seg_0051), &close).await;
    assert_eq!((status, &again["id"]), (200, &closed["id"]));
    let mut changed = close.clone();
    changed["rationale"] = serde_json::json!("Another reason.");
    let (status, refusal) = accountable.post(&route(&seg_0051), &changed).await;
    assert_eq!(
        (status, refusal["error"].as_str()),
        (409, Some("exception_disposition_conflict"))
    );
    let (status, refusal) = manager
        .post(
            &route(&seg_0051),
            &exception_disposition("close-twice", "closed", policy_reference()),
        )
        .await;
    assert_eq!(
        (status, refusal["error"].as_str()),
        (409, Some("exception_already_closed"))
    );
    // An Audit manager reopens it; the accountable person closes it again.
    let (status, reopened) = manager
        .post(
            &route(&seg_0051),
            &exception_disposition("reopen-0051", "reopened", serde_json::json!([])),
        )
        .await;
    assert_eq!(
        (status, reopened["kind"].as_str()),
        (200, Some("reopened")),
        "{reopened}"
    );
    let (status, _) = accountable
        .post(
            &route(&seg_0051),
            &exception_disposition("close-0051-again", "closed", policy_reference()),
        )
        .await;
    assert_eq!(status, 200);
    // An Audit manager closes INV-0054's segregation exception.
    let seg_0054 = id_of("INV-0054", "segregation");
    let (status, closed_0054) = manager
        .post(
            &route(&seg_0054),
            &exception_disposition("close-0054", "closed", policy_reference()),
        )
        .await;
    assert_eq!(status, 200, "{closed_0054}");
    // A replay is answered only to a person who may still dispose: a revoked
    // assignment (the admission fence) and a lost Audit manager role (the
    // closing authority) each refuse it with their own code, and return no
    // original.
    sqlx::query("UPDATE public.engagement_assignments SET active=false WHERE actor_id='actor-a' AND organisation_id='org-a'")
        .execute(&mut admin)
        .await
        .unwrap();
    let (status, refusal) = accountable.post(&route(&seg_0051), &close).await;
    assert_eq!(
        (status, refusal["error"].as_str(), refusal.get("id")),
        (403, Some("access_denied"), None),
        "a revoked assignment is answered nothing: {refusal}"
    );
    sqlx::query("UPDATE public.engagement_assignments SET active=true WHERE actor_id='actor-a' AND organisation_id='org-a'")
        .execute(&mut admin)
        .await
        .unwrap();
    sqlx::query("UPDATE public.organisation_memberships SET roles=ARRAY['auditor','admin'] WHERE actor_id='actor-manager' AND organisation_id='org-a'")
        .execute(&mut admin)
        .await
        .unwrap();
    let (status, refusal) = manager
        .post(
            &route(&seg_0051),
            &exception_disposition("reopen-0051", "reopened", serde_json::json!([])),
        )
        .await;
    assert_eq!(
        (status, refusal["error"].as_str(), refusal.get("id")),
        (403, Some("exception_close_forbidden"), None),
        "a replay after the Audit manager role was lost: {refusal}"
    );
    sqlx::query("UPDATE public.organisation_memberships SET roles=ARRAY['audit_manager','admin'] WHERE actor_id='actor-manager' AND organisation_id='org-a'")
        .execute(&mut admin)
        .await
        .unwrap();
    // No disposition changes an occurrence.
    let after: String = sqlx::query_scalar("SELECT string_agg(source_id||origin||source_us, ',' ORDER BY source_id) FROM public.assessment_exception_occurrences")
        .fetch_one(&mut admin)
        .await
        .unwrap();
    assert_eq!(
        before, after,
        "occurrences are never changed by a disposition"
    );

    // The list: every exception with its derived status and the exact
    // counts; whether the viewer may close one.
    let (status, list) = accountable
        .read(
            &format!("tasks/{task}/assessment/exceptions"),
            &accountable.csrf,
        )
        .await;
    assert_eq!(status, 200, "{list}");
    assert_eq!(list["may_close"], true);
    assert_eq!(
        (
            list["counts"]["total"].as_str(),
            list["counts"]["open"].as_str(),
            list["counts"]["resolved_by_evidence"].as_str(),
            list["counts"]["replaced_by_human_judgment"].as_str(),
            list["counts"]["closed_by_disposition"].as_str(),
            list["counts"]["subjects"].as_str()
        ),
        (
            Some("6"),
            Some("2"),
            Some("1"),
            Some("1"),
            Some("2"),
            Some("5")
        )
    );
    assert_eq!(list["next_cursor"], serde_json::Value::Null);
    let listed: Vec<(String, String)> = list["exceptions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| {
            (
                e["subject"].as_str().unwrap().into(),
                e["status"].as_str().unwrap().into(),
            )
        })
        .collect();
    assert_eq!(
        listed,
        vec![
            (
                "000123".to_string(),
                "replaced_by_human_judgment".to_string()
            ),
            ("INV-0042".into(), "resolved_by_evidence".into()),
            ("INV-0051".into(), "closed_by_disposition".into()),
            ("INV-0054".into(), listed[3].1.clone()),
            ("INV-0054".into(), listed[4].1.clone()),
            ("INV-0055".into(), "open".into()),
        ]
    );
    // Keyset paging: after the third exception, the rest in the same order;
    // a cursor naming no exception of this Task, or not an exception ID, is
    // refused (never a silent first page).
    let third = list["exceptions"][2]["id"].as_str().unwrap().to_string();
    let (status, rest) = accountable
        .read(
            &format!("tasks/{task}/assessment/exceptions?cursor={third}"),
            &accountable.csrf,
        )
        .await;
    assert_eq!(status, 200, "{rest}");
    let rest_ids: Vec<&str> = rest["exceptions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["id"].as_str().unwrap())
        .collect();
    let all_ids: Vec<&str> = list["exceptions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["id"].as_str().unwrap())
        .collect();
    assert_eq!(rest_ids, all_ids[3..].to_vec());
    assert_eq!(
        rest["counts"], list["counts"],
        "the counts are never the page's"
    );
    for cursor in [format!("exc-{}", "0".repeat(40)), "page-2".to_string()] {
        let (status, refusal) = accountable
            .read(
                &format!("tasks/{task}/assessment/exceptions?cursor={cursor}"),
                &accountable.csrf,
            )
            .await;
        assert_eq!(
            (status, refusal["error"].as_str()),
            (400, Some("exception_cursor_invalid")),
            "{cursor}"
        );
    }
    // Viewer scoping: Admin alone and another engagement's person read
    // nothing; an unknown exception is not found.
    let (status, _) = administrator
        .read(
            &format!("tasks/{task}/assessment/exceptions"),
            &administrator.csrf,
        )
        .await;
    assert_eq!(status, 403, "Admin alone reads no exception");
    let outsider = browser(&identities, &address, "auditor-b", "actor-b").await;
    let (status, _) = outsider
        .read_in(
            "engagement-b",
            "org-b",
            "client-b",
            &format!("tasks/{task}/assessment/exceptions"),
        )
        .await;
    assert_eq!(
        status, 403,
        "another engagement reads no exception of this Task"
    );
    let (status, refusal) = accountable
        .read(
            &format!("tasks/{task}/assessment/exceptions/exc-{}", "0".repeat(40)),
            &accountable.csrf,
        )
        .await;
    assert_eq!(
        (status, refusal["error"].as_str()),
        (404, Some("exception_not_found"))
    );
    assert_eq!(
        list["not_remediation"],
        zobba_domain::exception::NOT_REMEDIATION
    );
    let (status, list) = other
        .read(&format!("tasks/{task}/assessment/exceptions"), &other.csrf)
        .await;
    assert_eq!((status, list["may_close"].as_bool()), (200, Some(false)));
    let (status, detail) = accountable
        .read(
            &format!("tasks/{task}/assessment/exceptions/{seg_0051}"),
            &accountable.csrf,
        )
        .await;
    assert_eq!(status, 200, "{detail}");
    assert_eq!(detail["occurrences"].as_array().unwrap().len(), 1);
    let kinds: Vec<&str> = detail["dispositions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|d| d["kind"].as_str().unwrap())
        .collect();
    assert_eq!(kinds, vec!["closed", "reopened", "closed"]);
    assert_eq!(detail["exception"]["status"], "closed_by_disposition");

    // A person asks for reconsideration of INV-0054's judgment: the Task
    // wakes and the agent asks for the effective summary again.
    let chain_0054: String =
        sqlx::query_scalar("SELECT id FROM public.assessment_evaluations WHERE subject='INV-0054'")
            .fetch_one(&mut admin)
            .await
            .unwrap();
    let (status, saved) = accountable
        .dispose(
            task,
            &chain_0054,
            &disposition(
                "reconsider-0054",
                "needs_reconsideration",
                None,
                Some("facts"),
                "The requester field may be wrong.",
                serde_json::json!([]),
            ),
        )
        .await;
    assert_eq!(status, 200, "{saved}");
    settle(&tasks, &provider, &receipt.task_id, 7).await;

    let effective = effective_rows(&mut admin).await;
    assert_eq!(
        effective.len(),
        2,
        "the unchanged third request recorded nothing"
    );
    // INV-0051's new judgment read evidence its closure never saw: the
    // closed exception reopens. INV-0054's reconsidered judgment read the
    // same evidence as before its closure: the closure stands (its history
    // still shows the occurrence). A new population version with the
    // judgment criterion over it adds no occurrence: its opportunities name
    // recorded judgments. INV-0042 stays resolved and 000123 replaced.
    assert_eq!(
        statuses(&mut admin).await,
        vec![
            row4(
                "000123",
                "segregation",
                "replaced_by_human_judgment",
                "not_observed"
            ),
            row4(
                "INV-0042",
                "segregation",
                "resolved_by_evidence",
                "not_observed"
            ),
            row4("INV-0051", "segregation", "open", "not_met"),
            row4("INV-0054", "history", "open", "not_observed"),
            row4(
                "INV-0054",
                "segregation",
                "closed_by_disposition",
                "not_met"
            ),
            row4("INV-0055", "segregation", "open", "not_met"),
        ]
    );
    let revision = vec![
        ("evaluation".to_string(), "model_proposal".to_string()),
        ("revision".into(), "model_proposal".into()),
    ];
    assert_eq!(occurrences(&mut admin, &seg_0051).await, revision);
    assert_eq!(
        occurrences(&mut admin, &id_of("INV-0054", "segregation")).await,
        revision
    );
    let judged_v2: i64 = sqlx::query_scalar("SELECT count(*) FROM public.assessment_opportunities o JOIN public.assessment_populations p ON p.id=o.population_id WHERE p.document->>'key'='invoices-v2' AND o.evaluation_id IS NOT NULL")
        .fetch_one(&mut admin)
        .await
        .unwrap();
    assert!(
        judged_v2 > 0,
        "the judgment criterion was read over the new version"
    );
    let occurrence_total: i64 =
        sqlx::query_scalar("SELECT count(*) FROM public.assessment_exception_occurrences")
            .fetch_one(&mut admin)
            .await
            .unwrap();
    assert_eq!(
        occurrence_total, 9,
        "the two revisions are the only new occurrences"
    );
    let (_, conclusion, counts, supersedes, document) = &effective[1];
    // A closure never drops a failing count: INV-0054 still fails.
    assert_eq!(
        (conclusion.as_str(), counts.as_slice(), supersedes),
        (
            "exceptions_found_inconclusive",
            &[3, 2, 4, 0, 4, 2, 0, 2, 0, 6, 3, 1, 1, 1, 5, 9][..],
            &Some(first_id.clone())
        )
    );
    assert_eq!(
        limitation_codes(document),
        vec![
            ("unresolved_subjects".to_string(), Some(4)),
            ("unreviewed_model_proposals".to_string(), Some(2)),
            ("open_exceptions".to_string(), Some(3)),
        ]
    );
    let bodies = provider.bodies.lock().unwrap().clone();
    assert!(
        !bodies[6].contains("recount disagreed"),
        "the database agreed with trusted code's recount"
    );
    let (status, list) = accountable
        .read(
            &format!("tasks/{task}/assessment/exceptions"),
            &accountable.csrf,
        )
        .await;
    assert_eq!(status, 200);
    assert_eq!(list["effective_summaries"].as_array().unwrap().len(), 2);
    assert_eq!(
        list["effective_summaries"][1]["exceptions"]["closed_by_disposition"],
        "1"
    );
    assert_eq!(
        list["effective_summaries"][1]["summary"]["failing_subjects"],
        "3"
    );
    exceptions_fixture(&list);

    // Scale (24.3b review A): a population at the 20,000-row ceiling whose
    // rule criterion fails 19,000 times. The writer, the derived statuses,
    // the effective summary's recount and every read stay within the
    // runtime's statement bound; nothing halts a cycle.
    let reconsider_0051 = head_of("INV-0051").await;
    let (status, saved) = accountable
        .dispose(
            task,
            &reconsider_0051,
            &disposition(
                "reconsider-0051",
                "needs_reconsideration",
                None,
                Some("facts"),
                "The currency may be wrong.",
                serde_json::json!([]),
            ),
        )
        .await;
    assert_eq!(status, 200, "{saved}");
    let started = Instant::now();
    settle(&tasks, &provider, &receipt.task_id, 10).await;
    let cycle = started.elapsed();
    let bodies = provider.bodies.lock().unwrap().clone();
    assert!(
        bodies[8].contains("19000 opportunities")
            || bodies[8].contains("19,000")
            || bodies[8].contains("20000"),
        "the bulk population was read: {}",
        &bodies[8][bodies[8].len().saturating_sub(3000)..]
    );
    let bulk: (i64, i64) = sqlx::query_as("SELECT count(*), count(DISTINCT subject) FROM public.assessment_exceptions WHERE subject LIKE 'BLK-%'")
        .fetch_one(&mut admin)
        .await
        .unwrap();
    assert_eq!(bulk, (19_000, 19_000), "one exception per failing invoice");
    let bulk_summary: String = sqlx::query_scalar("SELECT s.id FROM public.assessment_effective_summaries s JOIN public.assessment_populations p ON p.id=s.population_id WHERE p.document->>'key'='bulk'")
        .fetch_one(&mut admin)
        .await
        .unwrap();
    let effective = effective_rows(&mut admin).await;
    let (_, conclusion, counts, _, _) = effective.iter().find(|e| e.0 == bulk_summary).unwrap();
    // The judgment criterion has no judgment of a bulk invoice: the 1,000
    // invoices in the history are unresolved, so the conclusion is
    // inconclusive; every failing invoice is one open exception.
    assert_eq!(conclusion, "exceptions_found_inconclusive");
    assert_eq!(
        (
            counts[0], counts[1], counts[2], counts[9], counts[10], counts[14], counts[15]
        ),
        (19_000, 0, 1_000, 19_000, 19_000, 19_000, 20_000)
    );
    let timed = Instant::now();
    let (status, list) = accountable
        .read(
            &format!("tasks/{task}/assessment/exceptions"),
            &accountable.csrf,
        )
        .await;
    let list_time = timed.elapsed();
    assert_eq!(status, 200, "{list}");
    assert_eq!(list["counts"]["total"], "19006");
    assert_eq!(list["exceptions"].as_array().unwrap().len(), 50);
    assert!(list["next_cursor"].is_string());
    let timed = Instant::now();
    let first = list["exceptions"][0]["id"].as_str().unwrap().to_string();
    let (status, _) = accountable
        .read(
            &format!("tasks/{task}/assessment/exceptions/{first}"),
            &accountable.csrf,
        )
        .await;
    let detail_time = timed.elapsed();
    assert_eq!(status, 200);
    eprintln!("scale: cycle {cycle:?}, list {list_time:?}, detail {detail_time:?}");
    // Within the runtime's 4 s statement bound (measured 1.7 s alone, 3.3 s
    // under the full sequential suite).
    assert!(list_time < Duration::from_secs(4), "list {list_time:?}");
    assert!(
        detail_time < Duration::from_secs(2),
        "detail {detail_time:?}"
    );
    server.abort();
    let _ = stop.send(true);
    let _ = worker.await;

    database_guards_refuse_altered_exception_records(
        &mut admin,
        &mut owner,
        &pool,
        &receipt.task_id,
        &id_of("INV-0054", "segregation"),
        &id_of("INV-0042", "segregation"),
        &id_of("INV-0054", "history"),
        &Sessions {
            accountable: secret_hash(&accountable.token),
            manager: secret_hash(&manager.token),
            other: secret_hash(&other.token),
        },
    )
    .await;
    decide_parity(&mut admin).await;
    zobba_infrastructure::analysis::docker::remove_all_test_resources().await;
}

/// Generated IDs inside a text (a source ID or a limitation sentence),
/// replaced by the same stable names as whole values.
fn embedded(text: &str, ids: &mut Vec<String>) -> String {
    let mut out = String::new();
    let mut rest = text;
    'scan: while !rest.is_empty() {
        for prefix in [
            "crit-",
            "basis-",
            "pop-",
            "eval-",
            "rev-",
            "exc-",
            "esummary-",
        ] {
            if let Some(tail) = rest.strip_prefix(prefix)
                && tail.len() >= 40
                && tail.as_bytes()[..40]
                    .iter()
                    .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
            {
                let id = format!("{prefix}{}", &tail[..40]);
                let index = ids.iter().position(|d| *d == id).unwrap_or_else(|| {
                    ids.push(id.clone());
                    ids.len() - 1
                });
                out.push_str(&format!("{prefix}{}", index + 1));
                rest = &tail[40..];
                continue 'scan;
            }
        }
        let c = rest.chars().next().unwrap();
        out.push(c);
        rest = &rest[c.len_utf8()..];
    }
    out
}

/// The exact exception list JSON the web parses
/// (`web/tests/fixtures/task-exceptions.json`), with generated identifiers
/// and digests replaced by stable ones. Set `ZOBBA_UPDATE_EXCEPTION_FIXTURE=1`
/// to rewrite it after an intended change.
fn exceptions_fixture(body: &serde_json::Value) {
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
                        "crit"
                            | "basis"
                            | "fact"
                            | "eval"
                            | "rev"
                            | "disp"
                            | "carry"
                            | "exc"
                            | "esummary"
                            | "pop"
                            | "xdisp"
                            | "summary"
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
                            } else {
                                *field = serde_json::json!(embedded(&text.clone(), ids));
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
    // Exceptions of one subject are listed in their criterion lineage's ID
    // order, which is random: order them by what the first occurrence was.
    let first: std::collections::BTreeMap<String, String> = body["exceptions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| {
            (
                e["id"].as_str().unwrap().to_string(),
                e["first_source_kind"].as_str().unwrap().to_string(),
            )
        })
        .collect();
    let order = |e: &serde_json::Value| {
        (
            e["subject"].as_str().unwrap_or_default().to_string(),
            first
                .get(e["id"].as_str().unwrap_or_default())
                .cloned()
                .unwrap_or_default(),
        )
    };
    if let Some(list) = body["exceptions"].as_array_mut() {
        list.sort_by_key(order);
    }
    if let Some(summaries) = body["effective_summaries"].as_array_mut() {
        for s in summaries {
            if let Some(listed) = s["listed"].as_array_mut() {
                listed.sort_by_key(order);
            }
        }
    }
    normalise(&mut body, &mut vec![], &mut vec![]);
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../web/tests/fixtures/task-exceptions.json");
    let text = format!("{}\n", serde_json::to_string_pretty(&body).unwrap());
    if std::env::var("ZOBBA_UPDATE_EXCEPTION_FIXTURE").as_deref() == Ok("1") {
        std::fs::write(&path, text).unwrap();
    } else {
        let stored = std::fs::read_to_string(&path).unwrap_or_default();
        assert_eq!(
            stored, text,
            "set ZOBBA_UPDATE_EXCEPTION_FIXTURE=1 to update {path:?}"
        );
    }
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

const EXCEPTION_COLUMNS: &str = "organisation_id,client_id,engagement_id,task_id,actor_id,id,kind,criterion_root,subject,first_source_kind,first_source_id";
const OCCURRENCE_COLUMNS: &str = "organisation_id,client_id,engagement_id,task_id,actor_id,exception_id,source_kind,source_id,population_id,member_ordinal,criterion_id,basis_id,origin,evidence,source_us,seq";

/// The live sessions of the proof's people (session hashes).
struct Sessions {
    accountable: String,
    manager: String,
    other: String,
}
fn person_as(actor: &str, session: &str) -> String {
    person(session).replace("'actor-a'", &format!("'{actor}'"))
}
/// An occurrence copied from `kept_occurrence` with some columns replaced.
fn occurrence_copy(overrides: &[(&str, &str)]) -> String {
    let values: Vec<String> = OCCURRENCE_COLUMNS
        .split(',')
        .map(|c| {
            overrides
                .iter()
                .find(|(name, _)| *name == c)
                .map_or(format!("o.{c}"), |(_, v)| (*v).to_string())
        })
        .collect();
    format!(
        "INSERT INTO public.assessment_exception_occurrences({OCCURRENCE_COLUMNS}) SELECT {} FROM kept_occurrence o",
        values.join(",")
    )
}

/// Exception records are immutable even for the owner and under the
/// fixture reset (which may only delete); the database refuses an exception
/// or occurrence that is not exactly what trusted code derives (statement
/// guards, one bad row of a multi-row insert refusing the whole statement),
/// an exception disposition outside a person's own session or authority,
/// and an effective summary whose counts disagree with its own recount. Its
/// backfill reproduces every occurrence from the stored results.
#[allow(clippy::too_many_arguments)]
async fn database_guards_refuse_altered_exception_records(
    admin: &mut PgConnection,
    owner: &mut PgConnection,
    pool: &sqlx::PgPool,
    task_id: &str,
    closed: &str,
    resolved: &str,
    open: &str,
    sessions: &Sessions,
) {
    let session = sessions.accountable.as_str();
    let tables = [
        "assessment_exceptions",
        "assessment_exception_occurrences",
        "assessment_exception_dispositions",
        "assessment_effective_summaries",
    ];
    for table in tables {
        for statement in [
            format!("UPDATE public.{table} SET actor_id=actor_id"),
            format!("DELETE FROM public.{table}"),
        ] {
            assert_refused(
                &refused(admin, &statement).await,
                "exception records are immutable",
                &statement,
            );
            let lifted = format!("ALTER TABLE public.{table} NO FORCE ROW LEVEL SECURITY");
            assert_refused(
                &refused_in(owner, std::slice::from_ref(&lifted), &statement).await,
                "exception records are immutable",
                &statement,
            );
        }
        let statement = format!("TRUNCATE public.{table} CASCADE");
        assert_refused(
            &refused(admin, &statement).await,
            "exception records are retained",
            &statement,
        );
        assert_refused(
            &refused(owner, &statement).await,
            "exception records are retained",
            &statement,
        );
        let message = refused_in(
            admin,
            &[RESET.into()],
            &format!("UPDATE public.{table} SET actor_id=actor_id"),
        )
        .await;
        assert_refused(&message, "exception records are immutable", table);
        let runtime = sqlx::query(&format!("DELETE FROM public.{table}"))
            .execute(pool)
            .await
            .expect_err("the runtime deleted a record")
            .to_string();
        assert!(runtime.contains("permission denied"), "{table}: {runtime}");
    }
    // Forced RLS: nothing is visible without a scope, nothing under another
    // engagement's.
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

    // A forged exception: a wrong ID, a root that is not a lineage root, a
    // subject no not_met result names. A multi-row statement with one bad
    // row is refused whole; the same statement with only the good row (the
    // stored exception, deleted first under the reset) is accepted.
    let copy = |id: &str, subject: &str| {
        format!(
            "SELECT x.organisation_id,x.client_id,x.engagement_id,x.task_id,x.actor_id,{id},x.kind,x.criterion_root,{subject},x.first_source_kind,x.first_source_id FROM kept_exception x"
        )
    };
    let delete_resolved = [
        RESET.to_string(),
        format!(
            "CREATE TEMP TABLE kept_exception ON COMMIT DROP AS SELECT * FROM public.assessment_exceptions WHERE id='{resolved}'"
        ),
        format!(
            "DELETE FROM public.assessment_exception_occurrences WHERE exception_id='{resolved}'"
        ),
        format!("DELETE FROM public.assessment_exceptions WHERE id='{resolved}'"),
    ];
    let good = copy("x.id", "x.subject");
    accepted_in(
        admin,
        &delete_resolved,
        &format!("INSERT INTO public.assessment_exceptions({EXCEPTION_COLUMNS}) {good}"),
    )
    .await;
    let wrong_id = copy(&format!("'exc-{}'", "0".repeat(40)), "'INV-0052'");
    assert_refused(
        &refused_in(admin, &delete_resolved, &format!("INSERT INTO public.assessment_exceptions({EXCEPTION_COLUMNS}) {good} UNION ALL {wrong_id}")).await,
        "an exception is named by its Task, criterion lineage root and subject",
        "wrong id in a two-row insert",
    );
    let no_result = copy(
        "public.assessment_exception_key(x.organisation_id,x.client_id,x.engagement_id,x.task_id,x.criterion_root,'INV-0050')",
        "'INV-0050'",
    );
    assert_refused(
        &refused_in(admin, &delete_resolved, &format!("INSERT INTO public.assessment_exceptions({EXCEPTION_COLUMNS}) {good} UNION ALL {no_result}")).await,
        "an exception begins with a not_met result of its lineage and subject",
        "an exception no not_met result names",
    );
    // A forged occurrence: each differs in one column from its source, or
    // names a met result; the unchanged copy is accepted.
    let delete_occurrences = [
        RESET.to_string(),
        format!(
            "CREATE TEMP TABLE kept_occurrence ON COMMIT DROP AS SELECT * FROM public.assessment_exception_occurrences WHERE exception_id='{resolved}'"
        ),
        format!(
            "DELETE FROM public.assessment_exception_occurrences WHERE exception_id='{resolved}'"
        ),
    ];
    accepted_in(admin, &delete_occurrences, &occurrence_copy(&[])).await;
    let other_criterion = format!(
        "(SELECT y.criterion_id FROM public.assessment_exception_occurrences y WHERE y.exception_id='{open}' LIMIT 1)"
    );
    let open_id = format!("'{open}'");
    let met = "(SELECT r.id FROM public.assessment_evaluation_revisions r WHERE r.verdict='met' ORDER BY r.id LIMIT 1)".to_string();
    // A judgment's population opportunity names a recorded judgment, whose
    // own record is the occurrence: it is never one itself.
    let judged = |column: &str| {
        format!(
            "(SELECT j.{column} FROM public.assessment_opportunities j WHERE j.subject='INV-0042' AND j.evaluation_id IS NOT NULL ORDER BY j.population_id, j.criterion_id LIMIT 1)"
        )
    };
    let (j_population, j_ordinal, j_criterion) = (
        judged("population_id"),
        judged("member_ordinal"),
        judged("criterion_id"),
    );
    let j_source = judged("population_id||'#'||j.criterion_id||'#'||j.member_ordinal");
    let forgeries: Vec<(&str, Vec<(&str, &str)>)> = vec![
        ("origin", vec![("origin", "'deterministic'")]),
        ("evidence", vec![("evidence", "ARRAY['forged']::text[]")]),
        ("actor", vec![("actor_id", "'actor-manager'")]),
        (
            "exception",
            vec![("exception_id", &open_id), ("seq", "999")],
        ),
        ("source kind", vec![("source_kind", "'revision'")]),
        (
            "source id",
            vec![(
                "source_id",
                "'eval-0000000000000000000000000000000000000000'",
            )],
        ),
        (
            "a met source",
            vec![("source_kind", "'revision'"), ("source_id", &met)],
        ),
        ("criterion", vec![("criterion_id", &other_criterion)]),
        (
            "basis",
            vec![(
                "basis_id",
                "'basis-0000000000000000000000000000000000000000'",
            )],
        ),
        (
            "a judgment's opportunity",
            vec![
                ("source_kind", "'opportunity'"),
                ("source_id", &j_source),
                ("population_id", &j_population),
                ("member_ordinal", &j_ordinal),
                ("criterion_id", &j_criterion),
            ],
        ),
        ("time", vec![("source_us", "o.source_us+1")]),
    ];
    for (name, overrides) in &forgeries {
        assert_refused(
            &refused_in(admin, &delete_occurrences, &occurrence_copy(overrides)).await,
            "an occurrence is exactly the not_met result it names, in its exception",
            name,
        );
    }
    // Ordered after every earlier record: the closed exception's newest
    // occurrence, put back before its dispositions, is refused; put back in
    // its own place it is accepted.
    let move_newest = [
        RESET.to_string(),
        format!(
            "CREATE TEMP TABLE kept_occurrence ON COMMIT DROP AS SELECT * FROM public.assessment_exception_occurrences WHERE exception_id='{closed}' ORDER BY seq DESC LIMIT 1"
        ),
        "DELETE FROM public.assessment_exception_occurrences y USING kept_occurrence k WHERE (y.exception_id,y.seq)=(k.exception_id,k.seq)".to_string(),
    ];
    accepted_in(admin, &move_newest, &occurrence_copy(&[])).await;
    let before_dispositions = format!(
        "(SELECT min(d.seq) FROM public.assessment_exception_dispositions d WHERE d.exception_id='{closed}')"
    );
    assert_refused(
        &refused_in(
            admin,
            &move_newest,
            &occurrence_copy(&[("seq", &before_dispositions)]),
        )
        .await,
        "an occurrence is ordered after every earlier record of its exception",
        "an occurrence before a disposition",
    );
    // The runtime, as the accountable person in their own session, may not
    // insert a forged exception either.
    let mut conn = pool.acquire().await.unwrap();
    assert_refused(
        &refused_in(
            &mut conn,
            &[person(session)],
            &format!(
                "INSERT INTO public.assessment_exceptions({EXCEPTION_COLUMNS}) {}",
                wrong_id.replace(
                    "FROM kept_exception x",
                    &format!("FROM public.assessment_exceptions x WHERE x.id='{closed}'")
                )
            ),
        )
        .await,
        "an exception is named by its Task, criterion lineage root and subject",
        "runtime forged exception",
    );
    // An exception disposition: never from a connection without the
    // person's session (a worker holds none); a closure of a closed
    // exception is refused; the person's own valid reopening is accepted.
    let disposition = |kind: &str, key: &str| {
        format!(
            "INSERT INTO public.assessment_exception_dispositions(organisation_id,client_id,engagement_id,task_id,actor_id,id,key,exception_id,kind,rationale,document,digest) SELECT d.organisation_id,d.client_id,d.engagement_id,d.task_id,'actor-a','xdisp-{}','{key}',d.exception_id,'{kind}',d.rationale,jsonb_set(jsonb_set(jsonb_set(jsonb_set(d.document,'{{id}}',to_jsonb('xdisp-{}'::text)),'{{key}}',to_jsonb('{key}'::text)),'{{kind}}',to_jsonb('{kind}'::text)),'{{actor_id}}',to_jsonb('actor-a'::text)),d.digest FROM (SELECT * FROM public.assessment_exception_dispositions z WHERE z.exception_id='{closed}' AND z.kind='closed' ORDER BY z.seq LIMIT 1) d",
            "9".repeat(40),
            "9".repeat(40)
        )
    };
    let unscoped_session = "SELECT set_config('zobba.organisation_id','org-a',true),set_config('zobba.client_id','client-a',true),set_config('zobba.engagement_id','engagement-a',true),set_config('zobba.actor_id','actor-a',true)".to_string();
    assert_refused(
        &refused_in(
            &mut conn,
            &[unscoped_session],
            &disposition("reopened", "worker-reopen"),
        )
        .await,
        "an exception disposition is saved by a currently assigned auditor or audit manager in their own session",
        "no session",
    );
    assert_refused(
        &refused_in(
            &mut conn,
            &[person(session)],
            &disposition("closed", "close-again"),
        )
        .await,
        "an exception that is closed is not closed again",
        "close a closed exception",
    );
    accepted_in(
        &mut conn,
        &[person(session)],
        &disposition("reopened", "person-reopen"),
    )
    .await;
    // The guard's own branches, each reached directly in a person's own
    // session (the application refuses each first).
    let any = |actor: &str,
               kind: &str,
               key: &str,
               exception: &str,
               references: Option<&str>,
               n: u32| {
        let id = format!("xdisp-{n:040x}");
        let references = references.map_or("d.document->'references'".to_string(), str::to_string);
        format!(
            "INSERT INTO public.assessment_exception_dispositions(organisation_id,client_id,engagement_id,task_id,actor_id,id,key,exception_id,kind,rationale,document,digest) SELECT d.organisation_id,d.client_id,d.engagement_id,d.task_id,'{actor}','{id}','{key}','{exception}','{kind}',d.rationale,jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(d.document,'{{id}}',to_jsonb('{id}'::text)),'{{key}}',to_jsonb('{key}'::text)),'{{kind}}',to_jsonb('{kind}'::text)),'{{exception_id}}',to_jsonb('{exception}'::text)),'{{actor_id}}',to_jsonb('{actor}'::text)),'{{references}}',{references}),d.digest FROM (SELECT * FROM public.assessment_exception_dispositions z WHERE z.exception_id='{closed}' AND z.kind='closed' ORDER BY z.seq LIMIT 1) d"
        )
    };
    let manager_session = person_as("actor-manager", &sessions.manager);
    let other_session = person_as("actor-c", &sessions.other);
    // Positive controls: the manager and the accountable person may close an
    // open exception.
    accepted_in(
        &mut conn,
        std::slice::from_ref(&manager_session),
        &any("actor-manager", "closed", "m1", open, None, 1),
    )
    .await;
    accepted_in(
        &mut conn,
        &[person(session)],
        &any("actor-a", "closed", "m2", open, None, 2),
    )
    .await;
    let cases: Vec<(&str, Vec<String>, String, &str)> = vec![
        (
            "an assigned Auditor who is neither the accountable person nor an Audit manager",
            vec![other_session.clone()],
            any("actor-c", "closed", "m3", open, None, 3),
            "an exception disposition is saved by an audit manager or the Task's accountable person",
        ),
        (
            "an Audit manager whose membership expired",
            vec![
                "UPDATE public.organisation_memberships SET expires_at=1 WHERE actor_id='actor-manager' AND organisation_id='org-a'".to_string(),
                manager_session.clone(),
            ],
            any("actor-manager", "closed", "m4", open, None, 4),
            "an exception disposition is saved by",
        ),
        (
            "an exception of no Task",
            vec![person(session)],
            any("actor-a", "closed", "m5", &format!("exc-{}", "0".repeat(40)), None, 5),
            "an exception disposition names an exception of its own Task",
        ),
        (
            "a reopening of an open exception",
            vec![person(session)],
            any("actor-a", "reopened", "m6", open, None, 6),
            "only a closed exception is reopened",
        ),
        (
            "a reference with another original's digest",
            vec![person(session)],
            any("actor-a", "closed", "m7", open, Some(&format!("jsonb_set(d.document->'references','{{0,original_sha256}}',to_jsonb('{}'::text))", "0".repeat(64))), 7),
            "an exception disposition reference is a verified quote of a registered original",
        ),
        (
            "a closure with no reference",
            vec![person(session)],
            any("actor-a", "closed", "m8", open, Some("'[]'::jsonb"), 8),
            "violates check constraint",
        ),
    ];
    for (name, setup, statement, expected) in &cases {
        // The membership change needs the administrator connection.
        let message = if setup.iter().any(|s| s.starts_with("UPDATE")) {
            refused_in(admin, setup, statement).await
        } else {
            refused_in(&mut conn, setup, statement).await
        };
        assert_refused(&message, expected, name);
    }
    // At most 16 dispositions: the 17th is refused.
    {
        let mut tx = conn.begin().await.unwrap();
        sqlx::query(&person(session))
            .execute(&mut *tx)
            .await
            .unwrap();
        let held: i64 = sqlx::query_scalar(&format!(
            "SELECT count(*) FROM public.assessment_exception_dispositions WHERE exception_id='{closed}'"
        ))
        .fetch_one(&mut *tx)
        .await
        .unwrap();
        let mut kind = "reopened";
        for n in held..16 {
            sqlx::query(&any(
                "actor-a",
                kind,
                &format!("cap-{n}"),
                closed,
                None,
                100 + n as u32,
            ))
            .execute(&mut *tx)
            .await
            .unwrap_or_else(|e| panic!("disposition {n}: {e}"));
            kind = if kind == "reopened" {
                "closed"
            } else {
                "reopened"
            };
        }
        let message = sqlx::query(&any("actor-a", kind, "cap-17", closed, None, 200))
            .execute(&mut *tx)
            .await
            .expect_err("a 17th disposition was saved")
            .to_string();
        assert_refused(
            &message,
            "an exception holds at most 16 dispositions",
            "17th",
        );
        tx.rollback().await.unwrap();
    }
    // A forged effective summary: the stored newest one under a new ID and
    // invocation ordinal, with one exception moved from open to resolved.
    let newest: (String, String) = sqlx::query_as("SELECT id, invocation_id FROM public.assessment_effective_summaries WHERE task_id=$1 ORDER BY created_us DESC LIMIT 1")
        .bind(task_id)
        .fetch_one(&mut *admin)
        .await
        .unwrap();
    let columns: Vec<String> = sqlx::query_scalar("SELECT column_name::text FROM information_schema.columns WHERE table_schema='public' AND table_name='assessment_effective_summaries' AND column_name NOT IN ('created_us') ORDER BY ordinal_position")
        .fetch_all(&mut *admin)
        .await
        .unwrap();
    let forged = |sets: &[(&str, &str)], document: &str| {
        let values: Vec<String> = columns
            .iter()
            .map(|c| {
                sets.iter()
                    .find(|(name, _)| name == c)
                    .map_or(format!("s.{c}"), |(_, v)| (*v).to_string())
            })
            .collect();
        format!(
            "INSERT INTO public.assessment_effective_summaries({}) SELECT {} FROM public.assessment_effective_summaries s WHERE s.id='{}'",
            columns.join(","),
            values.join(",").replace("s.document", document),
            newest.0
        )
    };
    let id = format!("'esummary-{}'", "8".repeat(40));
    let base_doc = format!(
        "jsonb_set(jsonb_set(jsonb_set(s.document,'{{id}}',to_jsonb({id}::text)),'{{ordinal}}','1'),'{{supersedes}}',to_jsonb(s.id))"
    );
    let base: Vec<(&str, String)> = vec![
        ("id", id.clone()),
        ("ordinal", "1".into()),
        ("supersedes", "s.id".into()),
    ];
    let _ = &newest.1;
    let with = |extra: &[(&str, &str)]| -> Vec<(String, String)> {
        // A case's own columns come first: the first named value wins.
        extra
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .chain(base.iter().map(|(k, v)| (k.to_string(), v.clone())))
            .collect()
    };
    let statement = |sets: &[(String, String)], document: &str| {
        let pairs: Vec<(&str, &str)> = sets.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
        forged(&pairs, document)
    };
    // The stored newest summary under a new ID and the free ordinal of its
    // invocation is accepted: every refusal below is its own field's.
    accepted_in(admin, &[], &statement(&with(&[]), &base_doc)).await;
    // (name, columns, document edits, expected refusal)
    type Case<'a> = (
        &'a str,
        Vec<(&'a str, &'a str)>,
        Vec<(&'a str, &'a str)>,
        &'a str,
    );
    let cases: Vec<Case> = vec![
        (
            "an exception moved between statuses",
            vec![
                ("exceptions_open", "s.exceptions_open-1"),
                ("exceptions_resolved", "s.exceptions_resolved+1"),
            ],
            vec![
                ("effective,exceptions,open", "to_jsonb(s.exceptions_open-1)"),
                (
                    "effective,exceptions,resolved_by_evidence",
                    "to_jsonb(s.exceptions_resolved+1)",
                ),
            ],
            "an effective summary count is not the stored count: exceptions",
        ),
        (
            "one exception subject fewer",
            vec![("exception_subjects", "s.exception_subjects-1")],
            vec![(
                "effective,exceptions,subjects",
                "to_jsonb(s.exception_subjects-1)",
            )],
            "an effective summary count is not the stored count: exceptions",
        ),
        (
            "one more closed exception",
            vec![
                ("exceptions_total", "s.exceptions_total+1"),
                ("exceptions_closed", "s.exceptions_closed+1"),
            ],
            vec![
                (
                    "effective,exceptions,total",
                    "to_jsonb(s.exceptions_total+1)",
                ),
                (
                    "effective,exceptions,closed_by_disposition",
                    "to_jsonb(s.exceptions_closed+1)",
                ),
            ],
            "an effective summary count is not the stored count: exceptions",
        ),
        (
            "a failing subject dropped",
            vec![
                ("failing_subjects", "s.failing_subjects-1"),
                ("meets_every_applicable", "s.meets_every_applicable+1"),
            ],
            vec![
                (
                    "effective,summary,failing",
                    "to_jsonb(s.failing_subjects-1)",
                ),
                (
                    "effective,summary,meets_every_applicable",
                    "to_jsonb(s.meets_every_applicable+1)",
                ),
            ],
            "an effective summary count is not the stored count: failing_subjects",
        ),
        (
            "an unresolved subject called not applicable",
            vec![
                ("unresolved_subjects", "s.unresolved_subjects-1"),
                ("not_applicable_to_any", "s.not_applicable_to_any+1"),
            ],
            vec![
                (
                    "effective,summary,unresolved",
                    "to_jsonb(s.unresolved_subjects-1)",
                ),
                (
                    "effective,summary,not_applicable_to_any",
                    "to_jsonb(s.not_applicable_to_any+1)",
                ),
            ],
            "an effective summary count is not the stored count: unresolved_subjects",
        ),
        (
            "one failing opportunity more",
            vec![("failing_opportunities", "s.failing_opportunities+1")],
            vec![(
                "effective,summary,failing_opportunities",
                "to_jsonb(s.failing_opportunities+1)",
            )],
            "an effective summary count is not the stored count: failing_opportunities",
        ),
        (
            "one human replacement more",
            vec![("human_replaced", "s.human_replaced+1")],
            vec![],
            "an effective summary count is not the stored count: reviews",
        ),
        (
            "one pending reconsideration more",
            vec![("pending_reconsideration", "s.pending_reconsideration+1")],
            vec![],
            "an effective summary count is not the stored count: reviews",
        ),
        (
            "one undisposed proposal fewer",
            vec![("undisposed", "s.undisposed-1")],
            vec![],
            "an effective summary count is not the stored count: reviews",
        ),
        (
            "one superseded result more",
            vec![("superseded", "s.superseded+1")],
            vec![],
            "an effective summary count is not the stored count: reviews",
        ),
        (
            "a different conclusion",
            vec![("conclusion", "'exceptions_found'")],
            vec![
                ("effective,conclusion", "'\"exceptions_found\"'"),
                ("effective,summary,conclusion", "'\"exceptions_found\"'"),
            ],
            "an effective summary concludes only what its counts allow",
        ),
        (
            "a listed status changed",
            vec![],
            vec![("effective,listed,0,status", "'\"closed_by_disposition\"'")],
            "an effective summary lists the first 50 exceptions with their derived status",
        ),
        (
            "a later supersedes",
            vec![("supersedes", "NULL")],
            vec![("supersedes", "'null'")],
            "an effective summary supersedes the newest effective summary of its population and sample",
        ),
    ];
    for (name, columns, edits, expected) in &cases {
        let mut document = base_doc.clone();
        for (path, value) in edits {
            document = format!("jsonb_set({document},'{{{path}}}',{value})");
        }
        let message = refused(admin, &statement(&with(columns), &document)).await;
        assert_refused(&message, expected, name);
    }
    // A limitation dropped from the effective list.
    let message = refused(
        admin,
        &statement(
            &with(&[]),
            &format!("({base_doc} #- '{{effective,limitations,0}}')"),
        ),
    )
    .await;
    assert_refused(
        &message,
        "an effective summary states exactly the limitations its counts give",
        "a dropped limitation",
    );
    // A removed key is refused (NULL-safe: a missing number never passes).
    for path in [
        "effective,exceptions,open",
        "effective,exceptions,subjects",
        "effective,summary,failing",
        "effective,summary,unresolved",
        "effective,conclusion",
        "effective,listed",
        "effective,limitations",
    ] {
        let message = refused(
            admin,
            &statement(&with(&[]), &format!("({base_doc} #- '{{{path}}}')")),
        )
        .await;
        assert!(
            message.contains("violates check constraint")
                || message.contains("an effective summary"),
            "{path}: {message}"
        );
    }

    // Two people closing one exception at once: the second waits on the
    // exception's lock and, once the first commits, is refused (the status
    // is read after the lock, never before).
    let close_open = |key: &str, n: char| {
        format!(
            "INSERT INTO public.assessment_exception_dispositions(organisation_id,client_id,engagement_id,task_id,actor_id,id,key,exception_id,kind,rationale,document,digest) SELECT d.organisation_id,d.client_id,d.engagement_id,d.task_id,'actor-a','xdisp-{0}','{key}','{open}','closed',d.rationale,jsonb_set(jsonb_set(jsonb_set(jsonb_set(d.document,'{{id}}',to_jsonb('xdisp-{0}'::text)),'{{key}}',to_jsonb('{key}'::text)),'{{exception_id}}',to_jsonb('{open}'::text)),'{{actor_id}}',to_jsonb('actor-a'::text)),d.digest FROM (SELECT * FROM public.assessment_exception_dispositions z WHERE z.exception_id='{closed}' AND z.kind='closed' ORDER BY z.seq LIMIT 1) d",
            n.to_string().repeat(40)
        )
    };
    let mut first = pool.begin().await.unwrap();
    sqlx::query(&person(session))
        .execute(&mut *first)
        .await
        .unwrap();
    sqlx::query(&close_open("race-1", '6'))
        .execute(&mut *first)
        .await
        .unwrap();
    let second_pool = pool.clone();
    let second_statement = close_open("race-2", '7');
    let setup = person(session);
    let (pid_tx, pid_rx) = tokio::sync::oneshot::channel::<i32>();
    let second = tokio::spawn(async move {
        let mut tx = second_pool.begin().await.unwrap();
        sqlx::query(&setup).execute(&mut *tx).await.unwrap();
        let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *tx)
            .await
            .unwrap();
        pid_tx.send(pid).unwrap();
        let result = sqlx::query(&second_statement)
            .execute(&mut *tx)
            .await
            .map(|_| ())
            .map_err(|e| e.to_string());
        tx.rollback().await.unwrap();
        result
    });
    let second_pid = pid_rx.await.unwrap();
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        // This very connection waits on an advisory lock (never another
        // test's waiter).
        let waiting: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_stat_activity WHERE pid=$1 AND wait_event_type='Lock' AND wait_event='advisory')")
            .bind(second_pid)
            .fetch_one(&mut *admin)
            .await
            .unwrap();
        if waiting {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "the second close did not wait on the exception's lock"
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    first.commit().await.unwrap();
    let refused_second = second
        .await
        .unwrap()
        .expect_err("the second close was saved");
    assert_refused(
        &refused_second,
        "an exception that is closed is not closed again",
        "concurrent close",
    );
    // Without any scope the runtime writes nothing, even a complete row: the
    // guard (no assignment in no scope) or the row-level policy refuses it.
    let row = sqlx::query_as::<_, (String, String, String, String, String, String)>(&format!(
        "SELECT task_id, rationale, document::text, digest, actor_id, exception_id FROM public.assessment_exception_dispositions WHERE exception_id='{closed}' AND kind='closed' ORDER BY seq LIMIT 1"
    ))
    .fetch_one(&mut *admin)
    .await
    .unwrap();
    let mut tx = conn.begin().await.unwrap();
    sqlx::query(&format!("SELECT set_config('zobba.actor_id','actor-a',true),set_config('zobba.session_hash','{session}',true)"))
        .execute(&mut *tx)
        .await
        .unwrap();
    let unscoped = sqlx::query("INSERT INTO public.assessment_exception_dispositions(organisation_id,client_id,engagement_id,task_id,actor_id,id,key,exception_id,kind,rationale,document,digest) VALUES('org-a','client-a','engagement-a',$1,'actor-a',$2,'unscoped',$3,'reopened',$4,jsonb_set(jsonb_set(jsonb_set(jsonb_set($5::jsonb,'{id}',to_jsonb($2::text)),'{key}','\"unscoped\"'),'{kind}','\"reopened\"'),'{references}','[]'),$6)")
        .bind(&row.0)
        .bind(format!("xdisp-{}", "5".repeat(40)))
        .bind(&row.5)
        .bind(&row.1)
        .bind(&row.2)
        .bind(&row.3)
        .execute(&mut *tx)
        .await
        .expect_err("an unscoped runtime connection saved a disposition")
        .to_string();
    tx.rollback().await.unwrap();
    assert!(
        unscoped.contains("row-level security")
            || unscoped
                .contains("an exception disposition is saved by a currently assigned auditor"),
        "{unscoped}"
    );
    drop(conn);

    // The backfill: with every exception record removed under the reset,
    // the migration's own backfill block reproduces each occurrence exactly.
    // Live places interleave dispositions; the backfill (no dispositions)
    // keeps the same order.
    let snapshot = "SELECT string_agg(concat_ws('|',exception_id,source_kind,source_id,population_id,member_ordinal,criterion_id,basis_id,origin,array_to_string(evidence,';'),source_us,actor_id,place), E'\\n' ORDER BY exception_id, source_kind, source_id) FROM (SELECT y.*, rank() OVER (PARTITION BY exception_id ORDER BY seq) AS place FROM public.assessment_exception_occurrences y) y";
    let exceptions_snapshot = "SELECT string_agg(concat_ws('|',id,task_id,criterion_root,subject,first_source_kind,first_source_id), E'\\n' ORDER BY id) FROM public.assessment_exceptions";
    let stored: (Option<String>, Option<String>) = (
        sqlx::query_scalar(snapshot)
            .fetch_one(&mut *admin)
            .await
            .unwrap(),
        sqlx::query_scalar(exceptions_snapshot)
            .fetch_one(&mut *admin)
            .await
            .unwrap(),
    );
    let migration = include_str!("../../../migrations/0021_assessment_exceptions.sql");
    let backfill = migration
        .split("-- BEGIN BACKFILL")
        .nth(1)
        .unwrap()
        .split("-- END BACKFILL")
        .next()
        .unwrap();
    let mut tx = owner.begin().await.unwrap();
    for statement in [
        RESET,
        "ALTER TABLE public.assessment_criteria NO FORCE ROW LEVEL SECURITY",
        "ALTER TABLE public.assessment_evaluations NO FORCE ROW LEVEL SECURITY",
        "ALTER TABLE public.assessment_evaluation_revisions NO FORCE ROW LEVEL SECURITY",
        "ALTER TABLE public.assessment_opportunities NO FORCE ROW LEVEL SECURITY",
        "ALTER TABLE public.assessment_populations NO FORCE ROW LEVEL SECURITY",
        "ALTER TABLE public.assessment_dispositions NO FORCE ROW LEVEL SECURITY",
        "ALTER TABLE public.assessment_exceptions NO FORCE ROW LEVEL SECURITY",
        "ALTER TABLE public.assessment_exception_occurrences NO FORCE ROW LEVEL SECURITY",
        "ALTER TABLE public.assessment_exception_dispositions NO FORCE ROW LEVEL SECURITY",
        "DELETE FROM public.assessment_exception_dispositions",
        "DELETE FROM public.assessment_exception_occurrences",
        "DELETE FROM public.assessment_exceptions",
    ] {
        sqlx::query(statement)
            .execute(&mut *tx)
            .await
            .unwrap_or_else(|e| panic!("{statement}: {e}"));
    }
    let empty: i64 =
        sqlx::query_scalar("SELECT count(*) FROM public.assessment_exception_occurrences")
            .fetch_one(&mut *tx)
            .await
            .unwrap();
    assert_eq!(empty, 0);
    sqlx::raw_sql(backfill).execute(&mut *tx).await.unwrap();
    let rebuilt: (Option<String>, Option<String>) = (
        sqlx::query_scalar(snapshot)
            .fetch_one(&mut *tx)
            .await
            .unwrap(),
        sqlx::query_scalar(exceptions_snapshot)
            .fetch_one(&mut *tx)
            .await
            .unwrap(),
    );
    tx.rollback().await.unwrap();
    assert!(stored.0.is_some());
    assert_eq!(
        rebuilt, stored,
        "the backfill reproduces every exception and occurrence"
    );
}

/// The database's status decision agrees with trusted Rust code's over a
/// table of single-observation cases: every observation kind, verdict,
/// execution, origin and review state, with and without the revision cause,
/// newer or older than the failing occurrence, over the same or different
/// evidence, closed or not.
async fn decide_parity(admin: &mut PgConnection) {
    use zobba_domain::{
        assessment::{Execution, Verdict},
        exception::{
            ExceptionDispositionKind, ExceptionFacts, LatestObserved, Observation, ObservationKind,
            Occurrence, exception_status,
        },
        revision::{EffectiveOrigin, ReviewState, RevisionCause},
    };
    let occurrence = Occurrence {
        seq: 1,
        at_us: 100,
        criterion_id: "crit-a".into(),
        evidence: vec!["a".into()],
    };
    let mut cases: Vec<(bool, Option<Observation>)> = vec![(false, None), (true, None)];
    for kind in ObservationKind::ALL {
        for verdict in [
            None,
            Some(Verdict::Met),
            Some(Verdict::NotMet),
            Some(Verdict::Undetermined),
        ] {
            for execution in [Some(Execution::Completed), Some(Execution::Failed)] {
                for origin in EffectiveOrigin::ALL {
                    for review in ReviewState::ALL {
                        for causes in [
                            vec![],
                            vec![RevisionCause::InputsChanged],
                            vec![RevisionCause::ReconsiderationRequested],
                        ] {
                            for newer in [true, false] {
                                for same_evidence in [true, false] {
                                    for criterion in ["crit-a", "crit-b"] {
                                        for closed in [false, true] {
                                            cases.push((
                                                closed,
                                                Some(Observation {
                                                    kind: *kind,
                                                    id: "obs".into(),
                                                    at_us: if newer { 200 } else { 50 },
                                                    verdict,
                                                    execution,
                                                    origin: Some(*origin),
                                                    review: *review,
                                                    causes: causes.clone(),
                                                    criterion_id: Some(criterion.into()),
                                                    evidence: if same_evidence {
                                                        vec!["a".into()]
                                                    } else {
                                                        vec!["b".into()]
                                                    },
                                                }),
                                            ));
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    let expected: Vec<(String, String)> = cases
        .iter()
        .map(|(closed, observation)| {
            let (status, latest) = exception_status(&ExceptionFacts {
                occurrences: vec![occurrence.clone()],
                decision: closed.then_some((ExceptionDispositionKind::Closed, 2)),
                observations: observation.iter().cloned().collect(),
            });
            (status.as_str().to_string(), latest.as_str().to_string())
        })
        .collect();
    let column = |f: &dyn Fn(&Observation) -> Option<String>| -> Vec<Option<String>> {
        cases.iter().map(|(_, o)| o.as_ref().and_then(f)).collect()
    };
    let closed: Vec<bool> = cases.iter().map(|(c, _)| *c).collect();
    let failing: Vec<bool> = cases
        .iter()
        .map(|(_, o)| {
            o.as_ref()
                .is_some_and(|o| o.verdict == Some(Verdict::NotMet))
        })
        .collect();
    let kind = column(&|o| Some(o.kind.as_str().into()));
    let at: Vec<Option<i64>> = cases
        .iter()
        .map(|(_, o)| o.as_ref().map(|o| o.at_us))
        .collect();
    let verdict = column(&|o| o.verdict.map(|v| v.as_str().into()));
    let execution = column(&|o| o.execution.map(|v| v.as_str().into()));
    let origin = column(&|o| o.origin.map(|v| v.as_str().into()));
    let review = column(&|o| Some(o.review.as_str().into()));
    let causes = column(&|o| {
        Some(
            o.causes
                .iter()
                .map(|c| c.as_str())
                .collect::<Vec<_>>()
                .join(","),
        )
    });
    let criterion = column(&|o| o.criterion_id.clone());
    let evidence = column(&|o| Some(o.evidence.join(",")));
    let got: Vec<(String, String)> = sqlx::query_as("SELECT d.status, d.latest_observed FROM unnest($1::boolean[],$2::boolean[],$3::text[],$4::bigint[],$5::text[],$6::text[],$7::text[],$8::text[],$9::text[],$10::text[],$11::text[]) WITH ORDINALITY AS c(closed,failing,kind,at_us,verdict,execution,origin,review,causes,criterion,evidence,n)
        CROSS JOIN LATERAL public.assessment_exception_decide(c.closed, c.failing, c.kind, c.at_us, c.verdict, c.execution, c.origin, c.review,
          CASE WHEN c.causes IS NULL OR c.causes='' THEN ARRAY[]::text[] ELSE string_to_array(c.causes, ',') END, c.criterion,
          CASE WHEN c.evidence IS NULL OR c.evidence='' THEN ARRAY[]::text[] ELSE string_to_array(c.evidence, ',') END,
          100, 'crit-a', ARRAY['a']::text[]) d ORDER BY c.n")
        .bind(&closed).bind(&failing).bind(&kind).bind(&at).bind(&verdict).bind(&execution)
        .bind(&origin).bind(&review).bind(&causes).bind(&criterion).bind(&evidence)
        .fetch_all(&mut *admin)
        .await
        .unwrap();
    assert_eq!(got.len(), expected.len());
    let disagreements: Vec<_> = cases
        .iter()
        .zip(expected.iter().zip(got.iter()))
        .filter(|(_, (e, g))| e != g)
        .take(5)
        .collect();
    assert!(
        disagreements.is_empty(),
        "Rust and SQL disagree: {disagreements:?}"
    );
    let seen: std::collections::BTreeSet<&str> = expected.iter().map(|(s, _)| s.as_str()).collect();
    assert_eq!(seen.len(), 4, "every status is reached: {seen:?}");
    let observed: std::collections::BTreeSet<&str> =
        expected.iter().map(|(_, l)| l.as_str()).collect();
    assert_eq!(observed.len(), LatestObserved::ALL.len(), "{observed:?}");
}
