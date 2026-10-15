//! Story 24.1 proof: the production work coordinator with the trusted reading,
//! investigation and assessment composition, real PostgreSQL custody
//! (immutable criterion, basis, fact and evaluation records, their guards and
//! forced RLS), real S3-protocol originals verified cell by cell by the
//! trusted document program in the TEST-ONLY Docker sandbox, a failing 22.4
//! analysis job, a native OpenAI loopback provider (never a live provider),
//! and the real Task work API. Requires a guarded `_test` database, the OIDC
//! fixture environment and a Docker engine with the pinned image; it fails,
//! never skips, without them.
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
type FactRow = (
    String,
    String,
    String,
    Option<String>,
    Option<String>,
    Option<String>,
);

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
/// Two 22.4 analysis programs: one that fails and one that completes.
const FAILING: &str = "raise SystemExit(3)\n";
const SUCCEEDING: &str = "print('ok')\n";

fn answer(fields: serde_json::Value) -> String {
    let mut value = serde_json::json!({
        "segments": [], "limitations": [], "read_pages": [], "programs": [],
        "read_method": [], "use_skills": [], "run_skill_script": [], "method_notes": [],
        "propose_criteria": [], "propose_basis": [], "record_facts": [], "evaluate": [], "judgments": [],
        "propose_population": [], "propose_sample": [], "evaluate_population": [], "summarise": [],
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

type EvaluationRow = (
    String,
    String,
    String,
    String,
    Option<String>,
    Option<String>,
    String,
    String,
);

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn criteria_facts_and_evaluations_are_checked_records_of_one_basis() {
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
    let objects = Arc::new(
        S3EvidenceObjects::new(
            s3_protocol::build_fixture_store(&s3.endpoint).unwrap(),
            NAMESPACE.into(),
        )
        .unwrap(),
    );
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
                key: "ap-assessment".into(),
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
    let auditor = identities
        .establish_session(ISSUER, "auditor-a", "Alex", None)
        .await
        .unwrap();

    // The synthetic model: it reads the IDs trusted code reported in its
    // context (asserted below) and answers with fixed structured output.
    let task_id = receipt.task_id.clone();
    let responder: Responder = Arc::new(move |index, body| {
        let lookup = lookup.clone();
        let task_id = task_id.clone();
        Box::pin(async move {
            let id = |key: &'static str| {
                let lookup = lookup.clone();
                let task_id = task_id.clone();
                async move {
                    let found: String = sqlx::query_scalar("SELECT id FROM public.assessment_criteria WHERE task_id=$1 AND document->>'key'=$2")
                        .bind(&task_id).bind(key).fetch_one(&lookup).await.unwrap();
                    assert!(body_contains_later(&found), "criterion ID {found}");
                    found
                }
            };
            fn body_contains_later(_: &str) -> bool {
                true
            }
            match index {
                // Turn 1: criteria (method, original verified, original not at
                // its location, judgment), one basis, and a failing analysis.
                0 => text_reply(&answer(serde_json::json!({
                    "programs": [{"program": FAILING, "inputs": ["ap-invoices"]}],
                    "propose_criteria": [
                        criterion("approval", "Invoices above 1,000.00 USD require an approver", ("method", "AP-1", "", ""),
                            predicate("compare_constant", "amount", "gt", "1000.00", "USD"),
                            vec![required("amount", "decimal", "USD"), required("approver", "identifier", "")],
                            "rule", predicate("present", "approver", "", "", ""), ""),
                        criterion("history", "The approver appears in the complete approval history", ("method", "AP-1", "", ""),
                            predicate("compare_constant", "amount", "gt", "1000.00", "USD"),
                            vec![required("amount", "decimal", "USD"), required("in_approval_history", "boolean", "")],
                            "rule", predicate("is_true", "in_approval_history", "", "", ""), ""),
                        criterion("limit", "No invoice may exceed 5,000.00 USD", ("original", "ap-policy", "bytes:49-84", "No invoice may exceed 5,000.00 USD."),
                            none(), vec![required("amount", "decimal", "")],
                            "rule", predicate("compare_constant", "amount", "le", "5000.00", "USD"), ""),
                        criterion("unverified", "Invoices above 2,000.00 USD require two approvers", ("original", "ap-policy", "bytes:0-48", "Invoices above 2,000.00 USD require two approvers."),
                            predicate("compare_constant", "amount", "gt", "1000.00", "USD"),
                            vec![required("amount", "decimal", "USD"), required("approver", "identifier", "")],
                            "rule", predicate("present", "approver", "", "", ""), ""),
                        criterion("segregation", "Segregation of duties is adequate given the organisation chart", ("method", "AP-1", "", ""),
                            none(), vec![required("approver", "identifier", "")],
                            "judgment", none(), "The approver and the requester report to different managers"),
                    ],
                    "propose_basis": [{
                        "key": "fy2026", "supersedes": "", "objective": "Assess approval of 2026 AP invoices",
                        "criteria": ["approval", "history", "limit", "unverified", "segregation"],
                        "period_from": "2026-01-01", "period_to": "2026-12-31", "as_of": "2026-03-31T00:00:00Z",
                        "population": [{"original_id": "ap-invoices", "unit": "invoice", "selection": "Every invoice in the AP export"}],
                        "limitations": ["Credit notes are out of scope."],
                    }],
                }))),
                // Turn 2: a second analysis program, one that completes (one
                // program per answer).
                1 => text_reply(&answer(serde_json::json!({
                    "programs": [{"program": SUCCEEDING, "inputs": ["ap-invoices"]}],
                }))),
                // Turn 3: typed facts for the matrix, deterministic evaluation
                // on request, and one judgment.
                2 => {
                    let basis: String = sqlx::query_scalar(
                        "SELECT id FROM public.assessment_bases WHERE task_id=$1",
                    )
                    .bind(&task_id)
                    .fetch_one(&lookup)
                    .await
                    .unwrap();
                    assert!(
                        body.contains(&basis),
                        "the outline names the recorded basis"
                    );
                    let job = |program: &'static str| {
                        let lookup = lookup.clone();
                        let task_id = task_id.clone();
                        async move {
                            let id: String = sqlx::query_scalar("SELECT id FROM public.analysis_jobs WHERE task_id=$1 AND program=$2")
                                .bind(&task_id).bind(program).fetch_one(&lookup).await.unwrap();
                            let statuses: Vec<String> = sqlx::query_scalar("SELECT status FROM public.analysis_job_events WHERE job_id=$1 ORDER BY sequence")
                                .bind(&id).fetch_all(&lookup).await.unwrap();
                            (id, statuses)
                        }
                    };
                    let (failed_job, failed_statuses) = job(FAILING).await;
                    let (done_job, done_statuses) = job(SUCCEEDING).await;
                    // The precondition the "completed, not collected" rule
                    // rests on: a failed job is collected too, and never
                    // completed; the succeeding job completed.
                    assert!(
                        failed_statuses.contains(&"collected".to_string())
                            && !failed_statuses.contains(&"completed".to_string()),
                        "{failed_statuses:?}"
                    );
                    assert!(
                        done_statuses.contains(&"completed".to_string()),
                        "{done_statuses:?}"
                    );
                    let (approval, history, limit, unverified, segregation) = (
                        id("approval").await,
                        id("history").await,
                        id("limit").await,
                        id("unverified").await,
                        id("segregation").await,
                    );
                    for criterion in [&approval, &history, &limit, &unverified, &segregation] {
                        assert!(
                            body.contains(criterion.as_str()),
                            "the outline names criterion {criterion}"
                        );
                    }
                    let b = basis.as_str();
                    // Each value cites its cell, the row's invoice number and,
                    // for an amount, the row's currency.
                    let amount =
                        |subject: &str, value: &str, currency: &str, row: u32, quote: &str| {
                            fact(
                                b,
                                subject,
                                "amount",
                                "decimal",
                                value,
                                currency,
                                "decimal_grouped_comma",
                                vec![
                                    (&format!("cell:Sheet1!B{row}"), quote),
                                    (&format!("cell:Sheet1!A{row}"), subject),
                                    (&format!("cell:Sheet1!C{row}"), currency),
                                ],
                            )
                        };
                    let in_row = |subject: &str,
                                  name: &str,
                                  kind: &str,
                                  value: &str,
                                  rule: &str,
                                  column: &str,
                                  row: u32,
                                  quote: &str| {
                        fact(
                            b,
                            subject,
                            name,
                            kind,
                            value,
                            "",
                            rule,
                            vec![
                                (&format!("cell:Sheet1!{column}{row}"), quote),
                                (&format!("cell:Sheet1!A{row}"), subject),
                            ],
                        )
                    };
                    let mut approver = in_row(
                        "INV-0042",
                        "approver",
                        "identifier",
                        "J. Smith",
                        "identifier_exact",
                        "D",
                        2,
                        "J. Smith",
                    );
                    approver["job_id"] = serde_json::json!(done_job);
                    let mut failed = in_row(
                        "INV-0053",
                        "approver",
                        "identifier",
                        "J. Smith",
                        "identifier_exact",
                        "D",
                        9,
                        "J. Smith",
                    );
                    failed["job_id"] = serde_json::json!(failed_job);
                    let mut unavailable =
                        fact(b, "INV-0052", "approver", "unavailable", "", "", "", vec![]);
                    unavailable["reason"] = serde_json::json!("evidence_unavailable");
                    // A EUR amount labelled USD, citing only the number and
                    // the invoice: the currency is only a claim.
                    let labelled = fact(
                        b,
                        "INV-0057",
                        "amount",
                        "decimal",
                        "3000.00",
                        "USD",
                        "decimal_grouped_comma",
                        vec![
                            ("cell:Sheet1!B10", "3,000.00"),
                            ("cell:Sheet1!A10", "INV-0057"),
                        ],
                    );
                    // `000.00` cut from `1,000.00` in the policy text.
                    let mut partial = fact(
                        b,
                        "INV-0042",
                        "threshold",
                        "decimal",
                        "0.00",
                        "USD",
                        "decimal_plain",
                        vec![],
                    );
                    partial["sources"] = serde_json::json!([{"original_id": "ap-policy", "locator": "bytes:17-23", "quote": "000.00"}]);
                    text_reply(&answer(serde_json::json!({
                        "record_facts": [
                            amount("INV-0042", "1250.00", "USD", 2, "1,250.00"),
                            approver,
                            in_row("INV-0042", "invoice_date", "date", "2026-03-05", "date_dmy", "E", 2, "05/03/2026"),
                            in_row("INV-0042", "approved_at", "instant", "2026-03-05T23:30:00-05:00", "instant_rfc3339", "F", 2, "2026-03-05T23:30:00-05:00"),
                            partial,
                            // The value the cell does not show.
                            amount("INV-0050", "1280.00", "USD", 6, "1,250.00"),
                            // No approver fact recorded.
                            amount("INV-0051", "1250.00", "USD", 7, "1,250.00"),
                            amount("INV-0052", "1250.00", "USD", 8, "1,250.00"),
                            unavailable,
                            amount("INV-0053", "1250.00", "USD", 9, "1,250.00"),
                            failed,
                            // A quote not at its location: G9 is empty.
                            in_row("INV-0053", "in_approval_history", "boolean", "true", "boolean_yes_no", "G", 9, "Yes"),
                            amount("INV-0054", "1250.00", "USD", 4, "1,250.00"),
                            in_row("INV-0054", "in_approval_history", "boolean", "false", "boolean_yes_no", "G", 4, "No"),
                            amount("INV-0055", "4200.00", "EUR", 5, "4,200.00"),
                            labelled,
                            amount("000123", "980.00", "USD", 3, "980.00"),
                            fact(b, "000123", "invoice_id", "identifier", "000123", "", "identifier_exact", vec![("cell:Sheet1!A3", "000123")]),
                        ],
                        "evaluate": [approval, history, limit, unverified],
                        "judgments": [{
                            "criterion": segregation, "basis": b, "subject": "INV-0042", "verdict": "met",
                            "supporting": ["approver"], "contrary": [],
                            "rationale": "J. Smith approves outside the requester's reporting line.",
                            "uncertainty": "The organisation chart in the evidence is dated 2025.",
                        }],
                    })))
                }
                // Turn 4: the same evaluation again, then the answer.
                _ => text_reply(&answer(serde_json::json!({
                    "evaluate": [id("approval").await],
                    "segments": [{"text": "INV-0042 meets the approval criterion; INV-0054 is an exception.", "sources": []}],
                }))),
            }
        })
    });
    let provider = Loopback::answering(responder).await;

    let unused = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let gateway_address = unused.local_addr().unwrap();
    let staging = std::env::temp_dir().join(format!("zobba-assessment-{}", std::process::id()));
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
    settle(&tasks, &provider, &receipt.task_id, 4).await;
    let bodies = provider.bodies.lock().unwrap().clone();
    // Turn 1 offers the assessment fields and their constraints; nothing is
    // recorded yet, so there is no outline.
    assert!(bodies[0].contains("propose_criteria") && bodies[0].contains("record_facts"));
    assert!(bodies[0].contains("you never write a rule verdict"));
    assert!(!bodies[0].contains("assessment-outline"));
    // Turn 2 carries the recorded criteria with their checked authority.
    assert!(bodies[1].contains("[zobba-data class=model-output source=assessment-outline]"));
    assert!(bodies[1].contains("authority unverified"));
    assert!(bodies[1].contains("Criterion unverified recorded as crit-"));
    assert!(bodies[1].contains("authority unverified: not_found_at_location"));

    // Criterion versions: method authority from the current binding, an
    // original quote verified at its exact byte range, and one not there.
    let criteria: Vec<(String, String, String, bool, Option<String>)> = sqlx::query_as("SELECT document->>'key',kind,authority_kind,authority_verified,authority_reason FROM public.assessment_criteria ORDER BY ordinal")
        .fetch_all(&mut admin).await.unwrap();
    let c = |key: &str, kind: &str, authority: &str, verified: bool, reason: Option<&str>| {
        (
            key.to_string(),
            kind.to_string(),
            authority.to_string(),
            verified,
            reason.map(String::from),
        )
    };
    assert_eq!(
        criteria,
        [
            c("approval", "rule", "method", true, None),
            c("history", "rule", "method", true, None),
            c("limit", "rule", "original", true, None),
            c(
                "unverified",
                "rule",
                "original",
                false,
                Some("not_found_at_location")
            ),
            c("segregation", "judgment", "method", true, None),
        ]
    );
    let binding: String =
        sqlx::query_scalar("SELECT binding_id FROM public.task_methodology_heads WHERE task_id=$1")
            .bind(&receipt.task_id)
            .fetch_one(&mut admin)
            .await
            .unwrap();
    let text_digest: String = sqlx::query_scalar("SELECT document->>'authority_text_sha256' FROM public.assessment_criteria WHERE document->>'key'='approval'")
        .fetch_one(&mut admin).await.unwrap();
    assert_eq!(
        text_digest,
        sha(b"Invoices above 1,000.00 USD require an approver")
    );
    let bound: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT methodology_binding_id FROM public.assessment_criteria",
    )
    .fetch_all(&mut admin)
    .await
    .unwrap();
    assert_eq!(bound, std::slice::from_ref(&binding));
    // The basis pins every criterion, the period and the population digest.
    let (period, criteria_pinned, population): (String, i64, String) = sqlx::query_as("SELECT period_from::text||'/'||period_to::text,(SELECT count(*) FROM public.assessment_basis_criteria),document->'population'->0->>'sha256' FROM public.assessment_bases")
        .fetch_one(&mut admin).await.unwrap();
    assert_eq!(
        (period.as_str(), criteria_pinned),
        ("2026-01-01/2026-12-31", 5)
    );
    let invoices = std::fs::read(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures/documents/AP invoices.xlsx"),
    )
    .unwrap();
    assert_eq!(population, sha(&invoices));

    // Facts: verified at their cells, re-parsed under the declared rule.
    let facts: Vec<FactRow> = sqlx::query_as("SELECT subject,name,support,support_reason,document->'value'->>'mantissa',document->'value'->>'value' FROM public.assessment_facts ORDER BY subject COLLATE \"C\",name COLLATE \"C\"")
        .fetch_all(&mut admin).await.unwrap();
    let f = |subject: &str, name: &str| {
        facts
            .iter()
            .find(|r| r.0 == subject && r.1 == name)
            .unwrap_or_else(|| panic!("{subject}/{name}: {facts:?}"))
            .clone()
    };
    assert_eq!(f("INV-0042", "amount").2, "supported");
    assert_eq!(f("INV-0042", "amount").4.as_deref(), Some("125000"));
    assert_eq!(
        f("INV-0042", "invoice_date").5.as_deref(),
        Some("2026-03-05")
    );
    assert_eq!(
        f("INV-0042", "approved_at").5.as_deref(),
        Some("2026-03-05T23:30:00-05:00")
    );
    let utc: i64 = sqlx::query_scalar("SELECT (document->'value'->>'utc_micros')::bigint FROM public.assessment_facts WHERE name='approved_at'")
        .fetch_one(&mut admin).await.unwrap();
    assert_eq!(utc, 1_772_771_400_000_000, "2026-03-06T04:30:00Z");
    assert_eq!(
        (
            f("INV-0050", "amount").2.as_str(),
            f("INV-0050", "amount").3.as_deref()
        ),
        ("unsupported", Some("type_mismatch"))
    );
    assert_eq!(f("INV-0052", "approver").2, "no_value");
    assert_eq!(
        (
            f("INV-0053", "approver").2.as_str(),
            f("INV-0053", "approver").3.as_deref()
        ),
        ("unsupported", Some("analysis_failed"))
    );
    assert_eq!(f("000123", "invoice_id").5.as_deref(), Some("000123"));
    // INV-0054's amount is at B4 (row 4) and reads back exactly.
    assert_eq!(f("INV-0054", "amount").2, "supported");
    assert_eq!(
        f("INV-0054", "in_approval_history").5.as_deref(),
        Some("false")
    );
    // A supported fact from a completed job keeps its job reference.
    let (job_id, job_state, support_reason): (Option<String>, Option<String>, Option<String>) = sqlx::query_as("SELECT job_id,document->>'job_state',support_reason FROM public.assessment_facts WHERE subject='INV-0042' AND name='approver'")
        .fetch_one(&mut admin).await.unwrap();
    assert!(job_id.is_some());
    assert_eq!(
        (
            f("INV-0042", "approver").2.as_str(),
            job_state.as_deref(),
            support_reason
        ),
        ("supported", Some("completed"), None)
    );
    // A quote that is only part of a value (`000.00` of `1,000.00`).
    assert_eq!(
        (
            f("INV-0042", "threshold").2.as_str(),
            f("INV-0042", "threshold").3.as_deref()
        ),
        ("unsupported", Some("partial_value"))
    );
    // A quote not at its location (G9 is empty).
    assert_eq!(
        (
            f("INV-0053", "in_approval_history").2.as_str(),
            f("INV-0053", "in_approval_history").3.as_deref()
        ),
        ("unsupported", Some("source_unverified"))
    );
    let (verification, reason): (String, Option<String>) = sqlx::query_as("SELECT s.verification,s.reason FROM public.assessment_fact_sources s JOIN public.assessment_facts f ON f.id=s.fact_id WHERE f.subject='INV-0053' AND f.name='in_approval_history' AND s.ordinal=0")
        .fetch_one(&mut admin).await.unwrap();
    assert_eq!(
        (verification.as_str(), reason.as_deref()),
        ("unverified", Some("not_found_at_location"))
    );
    // Grounding: the row's invoice number and currency stand beside each
    // value; the EUR amount labelled USD has no currency beside it.
    let grounding: Vec<(String, String, bool, Option<bool>)> = sqlx::query_as("SELECT subject,name,subject_grounded,measure_grounded FROM public.assessment_facts ORDER BY subject COLLATE \"C\",name COLLATE \"C\"")
        .fetch_all(&mut admin).await.unwrap();
    let g = |subject: &str, name: &str| {
        grounding
            .iter()
            .find(|r| r.0 == subject && r.1 == name)
            .map(|r| (r.2, r.3))
            .unwrap()
    };
    assert_eq!(g("INV-0042", "amount"), (true, Some(true)));
    assert_eq!(g("INV-0055", "amount"), (true, Some(true)));
    assert_eq!(g("INV-0057", "amount"), (true, Some(false)));
    assert_eq!(g("000123", "invoice_id"), (true, None));
    // Every source, exactly: 40 sources of 18 facts (the unavailable fact
    // has none). Only G9 is not at its location; the partial quote exists.
    let (verified, unverified): (i64, i64) = sqlx::query_as(
        "SELECT count(*) FILTER (WHERE verification='verified'),count(*) FILTER (WHERE verification='unverified') FROM public.assessment_fact_sources",
    )
    .fetch_one(&mut admin)
    .await
    .unwrap();
    assert_eq!((verified, unverified), (39, 1));

    // Evaluations: applicability, execution, verdict and origin are separate.
    let rows: Vec<EvaluationRow> = sqlx::query_as("SELECT (SELECT document->>'key' FROM public.assessment_criteria c WHERE c.id=e.criterion_id),subject,applicability,execution,verdict,reason,origin,output_digest FROM public.assessment_evaluations e ORDER BY ordinal")
        .fetch_all(&mut admin).await.unwrap();
    let row = |key: &str, subject: &str| {
        let r = rows
            .iter()
            .find(|r| r.0 == key && r.1 == subject)
            .unwrap_or_else(|| panic!("{key}/{subject}: {rows:#?}"));
        (
            r.2.as_str(),
            r.3.as_str(),
            r.4.as_deref(),
            r.5.as_deref(),
            r.6.as_str(),
        )
    };
    let det = "deterministic";
    assert_eq!(
        row("approval", "INV-0042"),
        ("applicable", "completed", Some("met"), None, det)
    );
    // The mistyped amount cannot establish applicability, and says why.
    assert_eq!(
        row("approval", "INV-0050"),
        (
            "unknown",
            "completed",
            Some("undetermined"),
            Some("fact_unsupported"),
            det
        )
    );
    assert_eq!(
        row("limit", "INV-0050"),
        (
            "applicable",
            "completed",
            Some("undetermined"),
            Some("fact_unsupported"),
            det
        )
    );
    assert_eq!(
        row("approval", "INV-0051"),
        (
            "applicable",
            "completed",
            Some("undetermined"),
            Some("missing_fact"),
            det
        )
    );
    assert_eq!(
        row("approval", "INV-0052"),
        (
            "applicable",
            "completed",
            Some("undetermined"),
            Some("fact_unavailable"),
            det
        )
    );
    assert_eq!(
        row("approval", "INV-0053"),
        ("applicable", "failed", None, Some("analysis_failed"), det)
    );
    // Its quote not at its location: undetermined, never an exception.
    assert_eq!(
        row("history", "INV-0053"),
        (
            "applicable",
            "completed",
            Some("undetermined"),
            Some("fact_unsupported"),
            det
        )
    );
    // The currency is only claimed: never compared.
    assert_eq!(
        row("limit", "INV-0057"),
        (
            "applicable",
            "completed",
            Some("undetermined"),
            Some("unit_unverified"),
            det
        )
    );
    assert_eq!(
        row("limit", "INV-0055"),
        (
            "applicable",
            "completed",
            Some("undetermined"),
            Some("unit_mismatch"),
            det
        )
    );
    assert_eq!(
        row("approval", "000123"),
        ("not_applicable", "completed", None, None, det)
    );
    assert_eq!(
        row("unverified", "INV-0042"),
        (
            "unknown",
            "completed",
            Some("undetermined"),
            Some("authority_unverified"),
            det
        )
    );
    assert_eq!(
        row("segregation", "INV-0042"),
        (
            "applicable",
            "completed",
            Some("met"),
            None,
            "model_proposal"
        )
    );
    assert_eq!(
        row("history", "INV-0042"),
        (
            "applicable",
            "completed",
            Some("undetermined"),
            Some("missing_fact"),
            det
        )
    );
    // The one real exception: supported facts, a rule the facts fail.
    assert_eq!(
        row("history", "INV-0054"),
        ("applicable", "completed", Some("not_met"), None, det)
    );
    assert_eq!(
        rows.iter()
            .filter(|r| r.4.as_deref() == Some("not_met"))
            .count(),
        1,
        "missing, unavailable, unsupported, failed and unverified never become not_met"
    );
    // Asking again gives the same output digest; nothing is rewritten.
    assert!(bodies[3].contains("re-evaluating gives the same output digest"));
    // The feedback is attributed data inside the untrusted-content envelope.
    assert!(bodies[3].contains("[zobba-data class=model-output source=assessment-feedback]"));
    assert!(!bodies[3].contains("(platform facts)"));
    let again: i64 = sqlx::query_scalar("SELECT count(*) FROM public.assessment_evaluations")
        .fetch_one(&mut admin)
        .await
        .unwrap();
    assert_eq!(again as usize, rows.len());

    database_guards_refuse_altered_assessment_records(&mut admin, &mut owner, &pool).await;

    // The Task card: the assessment section as the auditor sees it.
    let auth = zobba_api::auth::AuthState::from_environment(&database).unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = format!("http://{}", listener.local_addr().unwrap());
    let app = zobba_api::authenticated_router(database.clone(), auth);
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let client = reqwest_fixture::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .unwrap();
    let work_url = format!(
        "{address}/engagements/engagement-a/tasks/{}/work?organisation_id=org-a&client_id=client-a",
        receipt.task_id
    );
    let response = client
        .get(&work_url)
        .header("Cookie", format!("__Host-zobba-session={auditor}"))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status().as_u16(), 200);
    let work: serde_json::Value = serde_json::from_slice(&response.bytes().await.unwrap()).unwrap();
    assert_eq!(work["assessment_unavailable"], false);
    let assessment = &work["assessment"];
    assert_eq!(assessment["total_criteria"], "5");
    assert_eq!(
        assessment["bases"][0]["population"][0]["filename"],
        "AP invoices.xlsx"
    );
    let amount = assessment["facts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["subject"] == "INV-0042" && f["name"] == "amount")
        .unwrap();
    assert_eq!(
        (
            amount["mantissa"].as_str(),
            amount["scale"].as_u64(),
            amount["measure"].as_str()
        ),
        (Some("125000"), Some(2), Some("USD"))
    );
    assert_eq!(amount["sources"][0]["location"], "Sheet1!B2");
    assert_eq!(amount["sources"][0]["verification"], "verified");
    let judgment = assessment["evaluations"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["origin"] == "model_proposal")
        .unwrap();
    assert_eq!(
        judgment["judgment"]["uncertainty"],
        "The organisation chart in the evidence is dated 2025."
    );
    assert!(!work.to_string().contains("confidence"));
    assessment_fixture(assessment);

    stop.send(true).unwrap();
    worker.await.unwrap();
    server.abort();
    zobba_infrastructure::analysis::docker::remove_all_test_resources().await;
}

/// The exact `assessment` JSON the web parses
/// (`web/tests/fixtures/task-assessment.json`), with generated identifiers
/// and digests replaced by stable ones. Set
/// `ZOBBA_UPDATE_ASSESSMENT_FIXTURE=1` to rewrite it after an intended change.
fn assessment_fixture(body: &serde_json::Value) {
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
                    && matches!(prefix, "crit" | "basis" | "fact" | "eval")
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
    let mut value = body.clone();
    normalise(&mut value, &mut vec![], &mut vec![]);
    let text = serde_json::to_string_pretty(&value).unwrap() + "\n";
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../web/tests/fixtures/task-assessment.json");
    if std::env::var_os("ZOBBA_UPDATE_ASSESSMENT_FIXTURE").is_some() {
        std::fs::write(&path, &text).unwrap();
    }
    assert_eq!(
        std::fs::read_to_string(&path).unwrap_or_default(),
        text,
        "the web fixture is the exact API JSON; rerun with ZOBBA_UPDATE_ASSESSMENT_FIXTURE=1"
    );
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

/// A forged evaluation: a copy of an existing deterministic evaluation of
/// `subject` with each `(path, value)` set, under a new ID and ordinal.
fn forged_evaluation(
    subject: &str,
    ordinal: u32,
    sets: &[(&str, &str)],
    columns: &[(&str, &str)],
) -> String {
    let id = format!("eval-{:040x}", 0xf000 + ordinal);
    let mut document = format!(
        "jsonb_set(jsonb_set(e.document,'{{id}}',to_jsonb('{id}'::text)),'{{ordinal}}','{ordinal}')"
    );
    for (path, value) in sets {
        document = format!("jsonb_set({document},'{{{path}}}','{value}')");
    }
    let column = |name: &str, default: &str| {
        columns
            .iter()
            .find(|(c, _)| *c == name)
            .map_or(default.to_string(), |(_, v)| (*v).to_string())
    };
    format!(
        "INSERT INTO public.assessment_evaluations(organisation_id,client_id,engagement_id,task_id,cycle_id,actor_id,invocation_id,ordinal,id,methodology_binding_id,execution_epoch,basis_id,criterion_id,subject,applicability,execution,verdict,reason,origin,document,output_digest,digest)
         SELECT e.organisation_id,e.client_id,e.engagement_id,e.task_id,e.cycle_id,e.actor_id,{},{ordinal},'{id}',{},{},e.basis_id,{},e.subject,{},{},{},{},{},{document},e.output_digest,e.digest
         FROM public.assessment_evaluations e WHERE e.subject='{subject}' AND e.origin='deterministic' ORDER BY e.ordinal LIMIT 1",
        column("invocation_id", "e.invocation_id"),
        column("methodology_binding_id", "e.methodology_binding_id"),
        column("execution_epoch", "e.execution_epoch"),
        column("criterion_id", "e.criterion_id"),
        column("applicability", "e.applicability"),
        column("execution", "e.execution"),
        column("verdict", "e.verdict"),
        column("reason", "e.reason"),
        column("origin", "e.origin"),
    )
}

/// Records are immutable even for the owner and under the fixture reset,
/// bound to their own invocation's binding and epoch, reference only their
/// own Task, and the database refuses every decided verdict that does not
/// rest on supported, grounded facts of a verified criterion. Every refusal
/// is checked by its own message.
async fn database_guards_refuse_altered_assessment_records(
    admin: &mut PgConnection,
    owner: &mut PgConnection,
    pool: &sqlx::PgPool,
) {
    let tables = [
        "assessment_criteria",
        "assessment_bases",
        "assessment_basis_criteria",
        "assessment_facts",
        "assessment_fact_sources",
        "assessment_evaluations",
    ];
    // An UPDATE that agrees with every CHECK (it rewrites a value with
    // itself) is still refused: only the immutability trigger stands in its
    // way, even under the fixture reset.
    let identity = |table: &str| {
        if table == "assessment_basis_criteria" || table == "assessment_fact_sources" {
            format!("UPDATE public.{table} SET ordinal=ordinal")
        } else {
            format!("UPDATE public.{table} SET created_us=created_us")
        }
    };
    for table in tables {
        let statement = identity(table);
        assert_refused(
            &refused(admin, &statement).await,
            "assessment records are immutable",
            &statement,
        );
        let mut reset = admin.begin().await.unwrap();
        sqlx::query("SET LOCAL zobba.disposable_fixture_reset='on'")
            .execute(&mut *reset)
            .await
            .unwrap();
        let message = sqlx::query(&statement)
            .execute(&mut *reset)
            .await
            .unwrap_err()
            .to_string();
        assert_refused(&message, "assessment records are immutable", &statement);
        reset.rollback().await.unwrap();
        let refused_runtime = sqlx::query(&format!("DELETE FROM public.{table}"))
            .execute(pool)
            .await;
        assert!(refused_runtime.is_err(), "runtime deleted from {table}");
        let statement = format!("DELETE FROM public.{table}");
        assert_refused(
            &refused(admin, &statement).await,
            "assessment records are immutable",
            &statement,
        );
        let statement = format!("TRUNCATE public.{table} CASCADE");
        assert_refused(
            &refused(admin, &statement).await,
            "assessment records are retained",
            &statement,
        );
        // The migration owner (the tables' owner) gets no exception either:
        // forced RLS gives it no UPDATE or DELETE rows, and TRUNCATE (which
        // RLS does not cover) is refused by the trigger.
        let changed = sqlx::query(&identity(table))
            .execute(&mut *owner)
            .await
            .unwrap()
            .rows_affected();
        assert_eq!(changed, 0, "the owner updated {table}");
        let changed = sqlx::query(&format!("DELETE FROM public.{table}"))
            .execute(&mut *owner)
            .await
            .unwrap()
            .rows_affected();
        assert_eq!(changed, 0, "the owner deleted from {table}");
        let statement = format!("TRUNCATE public.{table} CASCADE");
        assert_refused(
            &refused(owner, &statement).await,
            "assessment records are retained",
            &statement,
        );
    }
    let counts = |table: &'static str| format!("SELECT count(*) FROM public.{table}");
    let mut before = Vec::new();
    for table in tables {
        let n: i64 = sqlx::query_scalar(&counts(table))
            .fetch_one(&mut *admin)
            .await
            .unwrap();
        before.push(n);
    }
    // The only escape is an explicit disposable fixture reset in a *_test
    // database: DELETE and TRUNCATE then succeed, shown inside a rolled-back
    // transaction.
    let mut reset = admin.begin().await.unwrap();
    sqlx::query("SET LOCAL zobba.disposable_fixture_reset='on'")
        .execute(&mut *reset)
        .await
        .unwrap();
    sqlx::query("DELETE FROM public.assessment_evaluations")
        .execute(&mut *reset)
        .await
        .unwrap();
    sqlx::query(&format!(
        "TRUNCATE {} CASCADE",
        tables.map(|t| format!("public.{t}")).join(",")
    ))
    .execute(&mut *reset)
    .await
    .unwrap();
    reset.rollback().await.unwrap();
    for (table, n) in tables.iter().zip(&before) {
        let kept: i64 = sqlx::query_scalar(&counts(table))
            .fetch_one(&mut *admin)
            .await
            .unwrap();
        assert_eq!(
            kept, *n,
            "the rolled-back reset removed nothing from {table}"
        );
    }

    // Insert guards: each forged row breaks exactly one rule.
    let unverified: String = sqlx::query_scalar(
        "SELECT id FROM public.assessment_criteria WHERE document->>'key'='unverified'",
    )
    .fetch_one(&mut *admin)
    .await
    .unwrap();
    let approval: String = sqlx::query_scalar(
        "SELECT id FROM public.assessment_criteria WHERE document->>'key'='approval'",
    )
    .fetch_one(&mut *admin)
    .await
    .unwrap();
    let met = r#""met""#;
    let cases: Vec<(String, &str)> = vec![
        // A decided deterministic verdict on an unsupported input.
        (
            forged_evaluation(
                "INV-0050",
                1,
                &[
                    ("verdict", met),
                    ("reason", "null"),
                    ("applicability", r#""applicable""#),
                ],
                &[
                    ("verdict", "'met'"),
                    ("reason", "NULL"),
                    ("applicability", "'applicable'"),
                ],
            ),
            "a decided verdict reads only supported, grounded facts",
        ),
        // A decided verdict on a supported fact whose currency is a claim.
        (
            forged_evaluation(
                "INV-0057",
                2,
                &[("verdict", met), ("reason", "null")],
                &[("verdict", "'met'"), ("reason", "NULL")],
            ),
            "a decided verdict reads only supported, grounded facts",
        ),
        // A judgment origin on a rule criterion.
        (
            forged_evaluation(
                "INV-0051",
                3,
                &[("origin", r#""model_proposal""#), ("judgment", "{}")],
                &[("origin", "'model_proposal'")],
            ),
            "an evaluation origin follows its criterion kind",
        ),
        // Another binding than the invocation's, another epoch, an unknown
        // invocation.
        (
            forged_evaluation(
                "INV-0051",
                4,
                &[("methodology_binding_id", r#""other-binding""#)],
                &[("methodology_binding_id", "'other-binding'")],
            ),
            "an assessment record belongs to its answer invocation and its binding",
        ),
        (
            forged_evaluation(
                "INV-0051",
                5,
                &[("execution_epoch", "999")],
                &[("execution_epoch", "999")],
            ),
            "an assessment record belongs to its answer invocation and its binding",
        ),
        (
            forged_evaluation(
                "INV-0051",
                6,
                &[("invocation_id", r#""not-an-invocation""#)],
                &[("invocation_id", "'not-an-invocation'")],
            ),
            "an assessment record belongs to its answer invocation and its binding",
        ),
        // `met` on the criterion whose authority is unverified.
        (
            forged_evaluation(
                "INV-0042",
                7,
                &[
                    ("criterion_id", &format!("\"{unverified}\"")),
                    ("verdict", met),
                    ("reason", "null"),
                    ("applicability", r#""applicable""#),
                ],
                &[
                    ("criterion_id", &format!("'{unverified}'")),
                    ("verdict", "'met'"),
                    ("reason", "NULL"),
                    ("applicability", "'applicable'"),
                ],
            ),
            "an unverified authority cannot yield met or not_met",
        ),
        // `not_met` that reads no fact.
        (
            forged_evaluation(
                "INV-0042",
                8,
                &[
                    ("criterion_id", &format!("\"{approval}\"")),
                    ("verdict", r#""not_met""#),
                    ("reason", "null"),
                    ("inputs", "[]"),
                    ("applicability", r#""applicable""#),
                ],
                &[
                    ("criterion_id", &format!("'{approval}'")),
                    ("verdict", "'not_met'"),
                    ("reason", "NULL"),
                    ("applicability", "'applicable'"),
                ],
            ),
            "a decided verdict reads its facts",
        ),
    ];
    for (statement, expected) in &cases {
        let mut tx = admin.begin().await.unwrap();
        let message = sqlx::query(statement)
            .execute(&mut *tx)
            .await
            .expect_err(statement)
            .to_string();
        tx.rollback().await.unwrap();
        assert_refused(&message, expected, statement);
    }
    // A basis-criterion row out of its basis order.
    let statement = "INSERT INTO public.assessment_basis_criteria SELECT organisation_id,client_id,engagement_id,task_id,actor_id,basis_id,15,(SELECT criterion_id FROM public.assessment_basis_criteria WHERE ordinal=0 LIMIT 1) FROM public.assessment_basis_criteria WHERE ordinal=1 LIMIT 1";
    assert_refused(
        &refused(admin, statement).await,
        "a basis pins criteria of its own Task, in its order",
        statement,
    );
    // A fact source that is not the one its fact records.
    let statement = "INSERT INTO public.assessment_fact_sources SELECT organisation_id,client_id,engagement_id,task_id,actor_id,fact_id,3,original_id,locator,'another quote',original_sha256,verification,reason FROM public.assessment_fact_sources WHERE ordinal=0 LIMIT 1";
    assert_refused(
        &refused(admin, statement).await,
        "a fact source is the one its fact records",
        statement,
    );
    // Facts that misstate their job's outcome: supported from the failed job,
    // analysis_failed from the completed one.
    let forged_fact = |ordinal: u32,
                       name: &str,
                       source: &str,
                       support: &str,
                       reason: &str,
                       job: &str| {
        format!(
            "INSERT INTO public.assessment_facts(organisation_id,client_id,engagement_id,task_id,cycle_id,actor_id,invocation_id,ordinal,id,methodology_binding_id,execution_epoch,basis_id,subject,subject_unit,name,value_kind,support,support_reason,rule,job_id,subject_grounded,measure_grounded,document,digest)
             SELECT f.organisation_id,f.client_id,f.engagement_id,f.task_id,f.cycle_id,f.actor_id,f.invocation_id,{ordinal},'fact-{ordinal:040x}',f.methodology_binding_id,f.execution_epoch,f.basis_id,f.subject,f.subject_unit,'{name}',f.value_kind,'{support}',{reason},f.rule,{job},f.subject_grounded,f.measure_grounded,
               jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(f.document,'{{id}}',to_jsonb('fact-{ordinal:040x}'::text)),'{{ordinal}}','{ordinal}'),'{{name}}','\"{name}\"'),'{{support}}','\"{support}\"'),'{{support_reason}}',coalesce(to_jsonb({reason}::text),'null')),'{{job_id}}',coalesce(to_jsonb({job}::text),'null')),f.digest
             FROM public.assessment_facts f WHERE {source} LIMIT 1"
        )
    };
    let failed_job =
        "(SELECT job_id FROM public.assessment_facts WHERE support_reason='analysis_failed')";
    let done_job =
        "(SELECT job_id FROM public.assessment_facts WHERE subject='INV-0042' AND name='approver')";
    let statement = forged_fact(
        60,
        "approver_copy",
        "f.subject='INV-0042' AND f.name='approver'",
        "supported",
        "NULL",
        failed_job,
    );
    assert_refused(
        &refused(admin, &statement).await,
        "a fact names its analysis job's true outcome",
        &statement,
    );
    let statement = forged_fact(
        61,
        "approver_copy",
        "f.subject='INV-0053' AND f.name='approver'",
        "unsupported",
        "'analysis_failed'",
        done_job,
    );
    assert_refused(
        &refused(admin, &statement).await,
        "a fact names its analysis job's true outcome",
        &statement,
    );
    // At COMMIT: a supported fact whose source is unverified.
    let mut tx = admin.begin().await.unwrap();
    sqlx::query(&forged_fact(
        62,
        "amount_copy",
        "f.subject='INV-0042' AND f.name='amount'",
        "supported",
        "NULL",
        "NULL",
    ))
    .execute(&mut *tx)
    .await
    .unwrap();
    for ordinal in 0..3 {
        sqlx::query(&format!("INSERT INTO public.assessment_fact_sources SELECT s.organisation_id,s.client_id,s.engagement_id,s.task_id,s.actor_id,'fact-{:040x}',s.ordinal,s.original_id,s.locator,s.quote,s.original_sha256,s.verification,s.reason FROM public.assessment_fact_sources s JOIN public.assessment_facts f ON f.id=s.fact_id WHERE f.subject='INV-0042' AND f.name='amount' AND s.ordinal={ordinal}", 62))
            .execute(&mut *tx)
            .await
            .unwrap();
    }
    // The copy is complete and consistent: its deferred checks pass, so the
    // forgery below is refused for its unverified source alone.
    sqlx::query("SET CONSTRAINTS ALL IMMEDIATE")
        .execute(&mut *tx)
        .await
        .unwrap();
    tx.rollback().await.unwrap();
    let mut tx = admin.begin().await.unwrap();
    sqlx::query(&forged_fact(
        63,
        "history_copy",
        "f.subject='INV-0053' AND f.name='in_approval_history'",
        "supported",
        "NULL",
        "NULL",
    ))
    .execute(&mut *tx)
    .await
    .unwrap();
    for ordinal in 0..2 {
        sqlx::query(&format!("INSERT INTO public.assessment_fact_sources SELECT s.organisation_id,s.client_id,s.engagement_id,s.task_id,s.actor_id,'fact-{:040x}',s.ordinal,s.original_id,s.locator,s.quote,s.original_sha256,s.verification,s.reason FROM public.assessment_fact_sources s JOIN public.assessment_facts f ON f.id=s.fact_id WHERE f.subject='INV-0053' AND f.name='in_approval_history' AND s.ordinal={ordinal}", 63))
            .execute(&mut *tx)
            .await
            .unwrap();
    }
    let message = tx.commit().await.unwrap_err().to_string();
    assert_refused(
        &message,
        "all verified when supported",
        "a supported fact with an unverified source",
    );

    // At COMMIT: a basis that lists more criteria than it pins.
    let mut tx = admin.begin().await.unwrap();
    sqlx::query("INSERT INTO public.model_invocations SELECT organisation_id,client_id,engagement_id,'forged-invocation',task_id,cycle_id,actor_id,'forged-invocation',profile_id,profile_revision,catalogue_id,catalogue_revision,request,receipt_hash,dispatched_at FROM public.model_invocations WHERE id=(SELECT invocation_id FROM public.assessment_bases LIMIT 1)")
        .execute(&mut *tx)
        .await
        .unwrap();
    let forged_basis = format!("basis-{:040x}", 1);
    sqlx::query(&format!("INSERT INTO public.assessment_bases(organisation_id,client_id,engagement_id,task_id,cycle_id,actor_id,invocation_id,ordinal,id,methodology_binding_id,execution_epoch,period_from,period_to,supersedes,document,digest) SELECT organisation_id,client_id,engagement_id,task_id,cycle_id,actor_id,'forged-invocation',0,'{forged_basis}',methodology_binding_id,execution_epoch,period_from,period_to,NULL,jsonb_set(jsonb_set(document,'{{id}}',to_jsonb('{forged_basis}'::text)),'{{invocation_id}}','\"forged-invocation\"'),digest FROM public.assessment_bases LIMIT 1"))
        .execute(&mut *tx)
        .await
        .unwrap();
    sqlx::query(&format!("INSERT INTO public.assessment_basis_criteria SELECT organisation_id,client_id,engagement_id,task_id,actor_id,'{forged_basis}',ordinal,criterion_id FROM public.assessment_basis_criteria WHERE basis_id<>'{forged_basis}' AND ordinal < 4"))
        .execute(&mut *tx)
        .await
        .unwrap();
    let message = tx.commit().await.unwrap_err().to_string();
    assert_refused(
        &message,
        "a basis pins exactly its listed criteria",
        "a basis with one criterion unpinned",
    );

    // A basis holds at most 1,024 facts: fill the recorded basis to its bound
    // under synthetic invocations (64 facts each), then one more is refused.
    let mut tx = admin.begin().await.unwrap();
    let held: i64 = sqlx::query_scalar("SELECT count(*) FROM public.assessment_facts")
        .fetch_one(&mut *tx)
        .await
        .unwrap();
    let missing = 1024 - held;
    let invocations = (missing + 63) / 64;
    sqlx::query("INSERT INTO public.model_invocations SELECT i.organisation_id,i.client_id,i.engagement_id,'filler-'||n,i.task_id,i.cycle_id,i.actor_id,'filler-'||n,i.profile_id,i.profile_revision,i.catalogue_id,i.catalogue_revision,i.request,i.receipt_hash,i.dispatched_at FROM public.model_invocations i, generate_series(0,$1-1) n WHERE i.id=(SELECT invocation_id FROM public.assessment_facts WHERE value_kind='unavailable')")
        .bind(invocations as i32)
        .execute(&mut *tx)
        .await
        .unwrap();
    let fill = "INSERT INTO public.assessment_facts(organisation_id,client_id,engagement_id,task_id,cycle_id,actor_id,invocation_id,ordinal,id,methodology_binding_id,execution_epoch,basis_id,subject,subject_unit,name,value_kind,support,support_reason,rule,job_id,subject_grounded,measure_grounded,document,digest)
        SELECT f.organisation_id,f.client_id,f.engagement_id,f.task_id,f.cycle_id,f.actor_id,'filler-'||(n/64),n%64,'fact-'||lpad(to_hex(n),40,'0'),f.methodology_binding_id,f.execution_epoch,f.basis_id,'S-'||n,f.subject_unit,f.name,f.value_kind,f.support,f.support_reason,f.rule,f.job_id,f.subject_grounded,f.measure_grounded,
          jsonb_set(jsonb_set(jsonb_set(jsonb_set(f.document,'{id}',to_jsonb('fact-'||lpad(to_hex(n),40,'0'))),'{ordinal}',to_jsonb(n%64)),'{invocation_id}',to_jsonb('filler-'||(n/64))),'{subject}',to_jsonb('S-'||n)),f.digest
        FROM public.assessment_facts f, generate_series($1,$2) n WHERE f.value_kind='unavailable'";
    sqlx::query(fill)
        .bind(0i64)
        .bind(missing - 1)
        .execute(&mut *tx)
        .await
        .unwrap();
    let total: i64 = sqlx::query_scalar("SELECT count(*) FROM public.assessment_facts")
        .fetch_one(&mut *tx)
        .await
        .unwrap();
    assert_eq!(total, 1024, "the bound itself is accepted");
    let message = sqlx::query(fill)
        .bind(missing)
        .bind(missing)
        .execute(&mut *tx)
        .await
        .unwrap_err()
        .to_string();
    assert_refused(
        &message,
        "a basis holds at most 1024 facts",
        "the 1,025th fact",
    );
    tx.rollback().await.unwrap();

    // Another engagement's scope sees no records (forced RLS).
    let mut other = pool.begin().await.unwrap();
    sqlx::query("SELECT set_config('zobba.actor_id','actor-a',true),set_config('zobba.organisation_id','org-a',true),set_config('zobba.client_id','client-a',true),set_config('zobba.engagement_id','engagement-b',true)")
        .execute(&mut *other).await.unwrap();
    let visible: i64 = sqlx::query_scalar("SELECT count(*) FROM public.assessment_facts")
        .fetch_one(&mut *other)
        .await
        .unwrap();
    assert_eq!(visible, 0);
    other.rollback().await.unwrap();
}
