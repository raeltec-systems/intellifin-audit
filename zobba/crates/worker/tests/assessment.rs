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
fn answer(fields: serde_json::Value) -> String {
    let mut value = serde_json::json!({
        "segments": [], "limitations": [], "read_pages": [], "programs": [],
        "read_method": [], "use_skills": [], "run_skill_script": [], "method_notes": [],
        "propose_criteria": [], "propose_basis": [], "record_facts": [], "evaluate": [], "judgments": [],
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
                    "programs": [{"program": "raise SystemExit(3)\n", "inputs": ["ap-invoices"]}],
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
                // Turn 2: typed facts for the matrix, deterministic evaluation
                // on request, and one judgment.
                1 => {
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
                    let job: String =
                        sqlx::query_scalar("SELECT id FROM public.analysis_jobs WHERE task_id=$1")
                            .bind(&task_id)
                            .fetch_one(&lookup)
                            .await
                            .unwrap();
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
                    let mut failed = fact(
                        b,
                        "INV-0053",
                        "approver",
                        "identifier",
                        "J. Smith",
                        "",
                        "identifier_exact",
                        vec![("cell:Sheet1!D2", "J. Smith")],
                    );
                    failed["job_id"] = serde_json::json!(job);
                    let mut unavailable =
                        fact(b, "INV-0052", "approver", "unavailable", "", "", "", vec![]);
                    unavailable["reason"] = serde_json::json!("evidence_unavailable");
                    text_reply(&answer(serde_json::json!({
                        "record_facts": [
                            fact(b, "INV-0042", "amount", "decimal", "1250.00", "USD", "decimal_grouped_comma", vec![("cell:Sheet1!B2", "1,250.00")]),
                            fact(b, "INV-0042", "approver", "identifier", "J. Smith", "", "identifier_exact", vec![("cell:Sheet1!D2", "J. Smith")]),
                            fact(b, "INV-0042", "invoice_date", "date", "2026-03-05", "", "date_dmy", vec![("cell:Sheet1!E2", "05/03/2026")]),
                            fact(b, "INV-0042", "approved_at", "instant", "2026-03-05T23:30:00-05:00", "", "instant_rfc3339", vec![("cell:Sheet1!F2", "2026-03-05T23:30:00-05:00")]),
                            // The value the cell does not show.
                            fact(b, "INV-0050", "amount", "decimal", "1280.00", "USD", "decimal_grouped_comma", vec![("cell:Sheet1!B2", "1,250.00")]),
                            // No approver fact recorded.
                            fact(b, "INV-0051", "amount", "decimal", "1250.00", "USD", "decimal_grouped_comma", vec![("cell:Sheet1!B2", "1,250.00")]),
                            fact(b, "INV-0052", "amount", "decimal", "1250.00", "USD", "decimal_grouped_comma", vec![("cell:Sheet1!B2", "1,250.00")]),
                            unavailable,
                            fact(b, "INV-0053", "amount", "decimal", "1250.00", "USD", "decimal_grouped_comma", vec![("cell:Sheet1!B2", "1,250.00")]),
                            failed,
                            fact(b, "INV-0054", "amount", "decimal", "1250.00", "USD", "decimal_grouped_comma", vec![("cell:Sheet1!B4", "1,250.00")]),
                            fact(b, "INV-0054", "in_approval_history", "boolean", "false", "", "boolean_yes_no", vec![("cell:Sheet1!G4", "No")]),
                            fact(b, "INV-0055", "amount", "decimal", "4200.00", "EUR", "decimal_grouped_comma", vec![("cell:Sheet1!B5", "4,200.00")]),
                            fact(b, "000123", "amount", "decimal", "980.00", "USD", "decimal_grouped_comma", vec![("cell:Sheet1!B3", "980.00")]),
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
                // Turn 3: the same evaluation again, then the answer.
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
    settle(&tasks, &provider, &receipt.task_id, 3).await;
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
    let sources: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM public.assessment_fact_sources WHERE verification='verified'",
    )
    .fetch_one(&mut admin)
    .await
    .unwrap();
    assert!(sources >= 12, "{sources}");

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
    assert_eq!(
        row("approval", "INV-0050"),
        (
            "unknown",
            "completed",
            Some("undetermined"),
            Some("unknown_applicability"),
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
        ("unknown", "failed", None, Some("analysis_failed"), det)
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
            "applicable",
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
    assert!(bodies[2].contains("re-evaluating gives the same output digest"));
    let again: i64 = sqlx::query_scalar("SELECT count(*) FROM public.assessment_evaluations")
        .fetch_one(&mut admin)
        .await
        .unwrap();
    assert_eq!(again as usize, rows.len());

    database_guards_refuse_altered_assessment_records(&mut admin, &pool).await;

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

/// Records are immutable, bound to their own invocation's binding, and the
/// database refuses a decided verdict that rests on an unsupported fact.
async fn database_guards_refuse_altered_assessment_records(
    admin: &mut PgConnection,
    pool: &sqlx::PgPool,
) {
    for statement in [
        "UPDATE public.assessment_evaluations SET verdict='met',reason=NULL",
        "UPDATE public.assessment_facts SET support='supported',support_reason=NULL",
        "UPDATE public.assessment_criteria SET authority_verified=true,authority_reason=NULL",
        "UPDATE public.assessment_bases SET period_to='2027-12-31'",
        "UPDATE public.assessment_fact_sources SET verification='verified',reason=NULL",
        "UPDATE public.assessment_basis_criteria SET ordinal=ordinal",
    ] {
        let refused = sqlx::query(statement).execute(&mut *admin).await;
        assert!(refused.is_err(), "{statement} was accepted");
    }
    for table in [
        "assessment_criteria",
        "assessment_bases",
        "assessment_basis_criteria",
        "assessment_facts",
        "assessment_fact_sources",
        "assessment_evaluations",
    ] {
        let refused = sqlx::query(&format!("DELETE FROM public.{table}"))
            .execute(pool)
            .await;
        assert!(refused.is_err(), "runtime deleted from {table}");
        let refused = sqlx::query(&format!("DELETE FROM public.{table}"))
            .execute(&mut *admin)
            .await
            .unwrap_err();
        assert!(
            refused
                .to_string()
                .contains("assessment records are immutable"),
            "{table}: {refused}"
        );
        let refused = sqlx::query(&format!("TRUNCATE public.{table} CASCADE"))
            .execute(&mut *admin)
            .await
            .unwrap_err();
        assert!(
            refused
                .to_string()
                .contains("assessment records are retained"),
            "{table}: {refused}"
        );
    }
    // A forged deterministic `met` that reads an unsupported fact.
    let forged = sqlx::query("INSERT INTO public.assessment_evaluations(organisation_id,client_id,engagement_id,task_id,cycle_id,actor_id,invocation_id,ordinal,id,methodology_binding_id,execution_epoch,basis_id,criterion_id,subject,applicability,execution,verdict,reason,origin,document,output_digest,digest)
        SELECT e.organisation_id,e.client_id,e.engagement_id,e.task_id,e.cycle_id,e.actor_id,e.invocation_id,1000,'eval-'||repeat('f',40),e.methodology_binding_id,e.execution_epoch,e.basis_id,e.criterion_id,'INV-0050','applicable','completed','met',NULL,'deterministic',
          jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(e.document,'{id}',to_jsonb('eval-'||repeat('f',40))),'{ordinal}','1000'),'{subject}','\"INV-0050\"'),'{verdict}','\"met\"'),'{reason}','null')
            || jsonb_build_object('inputs',(SELECT jsonb_agg(jsonb_build_object('id',f.id,'digest',f.digest)) FROM public.assessment_facts f WHERE f.subject='INV-0050'),'applicability','applicable'),
          e.output_digest,e.digest
        FROM public.assessment_evaluations e WHERE e.subject='INV-0050' AND e.origin='deterministic' LIMIT 1")
        .execute(&mut *admin).await.unwrap_err();
    assert!(
        forged
            .to_string()
            .contains("a decided verdict reads only supported facts"),
        "{forged}"
    );
    // A forged judgment origin on a rule criterion.
    let forged = sqlx::query("INSERT INTO public.assessment_evaluations SELECT organisation_id,client_id,engagement_id,task_id,cycle_id,actor_id,invocation_id,1001,'eval-'||repeat('e',40),methodology_binding_id,execution_epoch,basis_id,criterion_id,'INV-0099',applicability,execution,verdict,reason,'model_proposal',
          jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(document,'{id}',to_jsonb('eval-'||repeat('e',40))),'{ordinal}','1001'),'{subject}','\"INV-0099\"'),'{origin}','\"model_proposal\"'),'{judgment}','{}'),output_digest,digest,created_us
        FROM public.assessment_evaluations WHERE origin='deterministic' AND verdict IS NULL LIMIT 1")
        .execute(&mut *admin).await.unwrap_err();
    assert!(
        forged
            .to_string()
            .contains("an evaluation origin follows its criterion kind"),
        "{forged}"
    );
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
    // The only escape is an explicit disposable fixture reset in a *_test
    // database, shown inside a rolled-back transaction.
    let mut reset = admin.begin().await.unwrap();
    sqlx::query("SET LOCAL zobba.disposable_fixture_reset='on'")
        .execute(&mut *reset)
        .await
        .unwrap();
    sqlx::query("DELETE FROM public.assessment_evaluations")
        .execute(&mut *reset)
        .await
        .unwrap();
    reset.rollback().await.unwrap();
    let kept: i64 = sqlx::query_scalar("SELECT count(*) FROM public.assessment_evaluations")
        .fetch_one(&mut *admin)
        .await
        .unwrap();
    assert!(kept > 0, "the rolled-back reset removed nothing");
}
