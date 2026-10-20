//! Story 24.2 proof: the production work coordinator with the trusted reading
//! and assessment composition reads every row of `AP population.xlsx` through
//! the trusted document program in the TEST-ONLY Docker sandbox, records the
//! population manifest and its members, evaluates rule criteria over every
//! in-scope member, records a seeded sample, and computes coverage summaries
//! that PostgreSQL recounts. A native OpenAI loopback provider stands in for
//! the model (never a live provider); it only names where and how, never a
//! count. Requires a guarded `_test` database, the OIDC fixture environment
//! and a Docker engine with the pinned image; it fails, never skips, without
//! them.
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
    let deadline = Instant::now() + Duration::from_secs(900);
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

/// A proposed population of another sheet: its own header row, period rule,
/// subject unit and grain, and optional further value columns.
#[allow(clippy::too_many_arguments)]
fn population_on(
    key: &str,
    basis: &str,
    sheet: &str,
    period_rule: &str,
    unit: &str,
    grain: &[&str],
    extra: Vec<serde_json::Value>,
) -> serde_json::Value {
    let mut p = population(key, basis, sheet, 1, true, None);
    p["period_rule"] = serde_json::json!(period_rule);
    p["subject_unit"] = serde_json::json!(unit);
    p["grain"] = serde_json::json!(grain);
    p["value_columns"].as_array_mut().unwrap().extend(extra);
    p
}

/// A summary row: (conclusion, completeness, reason, reconciliation,
/// received, duplicates, distinct, excluded, in scope, selected, failing,
/// meets, unresolved, not applicable to any, failing opportunities).
type SummaryRow = (
    String,
    String,
    Option<String>,
    String,
    i32,
    i32,
    i32,
    i32,
    i32,
    Option<i32>,
    i32,
    i32,
    i32,
    i32,
    i32,
);

/// A population row: key, completeness, reason, reconciliation, received,
/// duplicates, distinct, excluded, in scope, declared count.
type PopulationRow = (
    String,
    String,
    Option<String>,
    String,
    i32,
    i32,
    i32,
    i32,
    i32,
    Option<i32>,
);
/// A summary's words and its counts in column order.
type SummaryWords = (String, String, Option<String>, String, Vec<Option<i32>>);

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn every_row_is_counted_by_trusted_code_and_recounted_by_the_database() {
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
    register(&mut admin, &objects, "ap-population", "AP population.xlsx").await;

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
                key: "ap-coverage".into(),
                kind: CommandKind::Create,
                task_id: None,
                cycle_id: None,
                content: Some("Test approval of every 2026 AP invoice".into()),
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

    // The synthetic model names where and how; trusted code counts. Later
    // turns read the IDs trusted code reported (asserted in the outline).
    let task_id = receipt.task_id.clone();
    let responder: Responder = Arc::new(move |index, body| {
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
            let criteria = || async {
                (
                    scalar("SELECT id FROM public.assessment_criteria WHERE task_id=$1 AND document->>'key'='approver'").await,
                    scalar("SELECT id FROM public.assessment_criteria WHERE task_id=$1 AND document->>'key'='before'").await,
                )
            };
            let basis = || scalar("SELECT id FROM public.assessment_bases WHERE task_id=$1");
            let rule = |fact: &str| predicate("is_true", fact, "", "", "");
            let over = predicate("compare_constant", "amount", "gt", "1000.00", "USD");
            match index {
                // Turn 1: criteria, the basis, the full population with its
                // cited control count, evaluation over every member and a
                // summary, all in one answer.
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
                // Turn 2: a complete population where nothing is above the
                // threshold.
                1 => {
                    assert!(
                        body.contains("Population ap recorded as pop-"),
                        "the outline reports the population"
                    );
                    let (a, b) = criteria().await;
                    let basis = basis().await;
                    text_reply(&answer(serde_json::json!({
                        "propose_population": [population("low", &basis, "Low", 1, true, None)],
                        "evaluate_population": [{"criterion": a, "population": "low"}, {"criterion": b, "population": "low"}],
                        "summarise": [{"basis": basis, "population": "low", "sample": ""}],
                    })))
                }
                // Turn 3: a filtered export, declared not exhaustive.
                2 => {
                    let (a, b) = criteria().await;
                    let basis = basis().await;
                    text_reply(&answer(serde_json::json!({
                        "propose_population": [population("filtered", &basis, "Filtered", 1, false, None)],
                        "evaluate_population": [{"criterion": a, "population": "filtered"}, {"criterion": b, "population": "filtered"}],
                        "summarise": [{"basis": basis, "population": "filtered", "sample": ""}],
                    })))
                }
                // Turn 4: a sheet whose header is "Amount " (a trailing space,
                // refused), a seeded random sample of the full population and
                // its summary over the selected items only.
                3 => {
                    let basis = basis().await;
                    let ap = scalar("SELECT id FROM public.assessment_populations WHERE task_id=$1 AND document->>'key'='ap'").await;
                    let keys: Vec<String> = sqlx::query_scalar("SELECT subject FROM public.assessment_population_members WHERE population_id=$1 AND disposition='in_scope' ORDER BY subject COLLATE \"C\"")
                        .bind(&ap).fetch_all(&lookup).await.unwrap();
                    let selected = zobba_domain::coverage::seeded_selection(&keys, 42, 25);
                    text_reply(&answer(serde_json::json!({
                        "propose_population": [population("mismatch", &basis, "Mismatch", 1, true, None)],
                        "propose_sample": [{
                            "key": "s1", "population": ap, "method": "seeded_random", "seed": "42", "size": 25,
                            "strata": "", "justification": "A seeded random selection of 25 in-scope invoices",
                            "keys": selected, "substitutions": [],
                        }],
                        "summarise": [{"basis": basis, "population": ap, "sample": "s1"}],
                    })))
                }
                // Turn 5: the full population again, citing the cover
                // sheet's count, which does not match.
                4 => {
                    let basis = basis().await;
                    text_reply(&answer(serde_json::json!({
                        "propose_population": [population("cover", &basis, "Invoices", 3, true, Some(("cell:Summary!B2", "1,251")))],
                    })))
                }
                // Turn 6: the Edge sheet: a conflicting duplicate key, a date
                // that does not parse, a blank date and a row with no key.
                5 => {
                    let (a, b) = criteria().await;
                    let basis = basis().await;
                    text_reply(&answer(serde_json::json!({
                        "propose_population": [population_on("edge", &basis, "Edge", "date_dmy", "invoice", &["Invoice"], vec![])],
                        "evaluate_population": [{"criterion": a, "population": "edge"}, {"criterion": b, "population": "edge"}],
                        "summarise": [{"basis": basis, "population": "edge", "sample": ""}],
                    })))
                }
                // Turn 7: the Dated sheet of typed Excel cells, every in-scope
                // invoice meeting both criteria, and a sample of all of them.
                6 => {
                    let (a, b) = criteria().await;
                    let basis = basis().await;
                    text_reply(&answer(serde_json::json!({
                        "propose_population": [population_on("dated", &basis, "Dated", "date_iso", "invoice", &["Invoice"],
                            vec![column("Approved at", "approved_at", "instant", "instant_rfc3339", "", "")])],
                        "evaluate_population": [{"criterion": a, "population": "dated"}, {"criterion": b, "population": "dated"}],
                        "propose_sample": [{
                            "key": "every", "population": "dated", "method": "all_in_scope", "seed": "", "size": 2,
                            "strata": "", "justification": "Every in-scope invoice of the Dated sheet",
                            "keys": [], "substitutions": [],
                        }],
                        "summarise": [{"basis": basis, "population": "dated", "sample": ""}, {"basis": basis, "population": "dated", "sample": "every"}],
                    })))
                }
                // Turn 8: the Lines sheet, one subject per invoice line.
                7 => {
                    let (a, b) = criteria().await;
                    let basis = basis().await;
                    text_reply(&answer(serde_json::json!({
                        "propose_population": [population_on("lines", &basis, "Lines", "date_iso", "invoice_line", &["Invoice", "Line"], vec![])],
                        "evaluate_population": [{"criterion": a, "population": "lines"}, {"criterion": b, "population": "lines"}],
                        "summarise": [{"basis": basis, "population": "lines", "sample": ""}],
                    })))
                }
                // Turn 9: the answer.
                _ => text_reply(&answer(serde_json::json!({
                    "segments": [{"text": "20 of 1,200 in-scope invoices have at least one exception.", "sources": []}],
                }))),
            }
        })
    });
    let provider = Loopback::answering(responder).await;

    let unused = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let gateway_address = unused.local_addr().unwrap();
    let staging = std::env::temp_dir().join(format!("zobba-coverage-{}", std::process::id()));
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
    settle(&tasks, &provider, &receipt.task_id, 9).await;
    let bodies = provider.bodies.lock().unwrap().clone();
    // The constraints say the model never counts; turn 1 offers the fields.
    assert!(bodies[0].contains("propose_population") && bodies[0].contains("summarise"));
    // The header mismatch is fed back in words naming the column, and the
    // count mismatch with both numbers.
    assert!(
        bodies[4].contains(
            "Population mismatch was not recorded: the header row has no column exactly named"
        ),
        "the header mismatch is fed back"
    );
    assert!(
        bodies[5].contains("1251 declared, 1250 subjects found"),
        "the count mismatch is fed back"
    );

    // AC1: rows, duplicates, exclusions and scope, counted by trusted code.
    let populations: Vec<PopulationRow> = sqlx::query_as(
        "SELECT document->>'key',completeness,completeness_reason,reconciliation,received_rows,duplicate_rows,distinct_subjects,excluded_out_of_period,in_scope,declared_count::integer FROM public.assessment_populations ORDER BY created_us",
    )
    .fetch_all(&mut admin)
    .await
    .unwrap();
    let p = |key: &str| {
        populations
            .iter()
            .find(|p| p.0 == key)
            .unwrap_or_else(|| panic!("population {key}: {populations:?}"))
            .clone()
    };
    let s = |v: &str| v.to_string();
    assert_eq!(
        p("ap"),
        (
            s("ap"),
            s("complete"),
            None,
            s("matched"),
            1256,
            6,
            1250,
            50,
            1200,
            Some(1250)
        )
    );
    assert_eq!(
        p("cover"),
        (
            s("cover"),
            s("incomplete"),
            Some(s("count_mismatch")),
            s("mismatch"),
            1256,
            6,
            1250,
            50,
            1200,
            Some(1251)
        )
    );
    assert_eq!(
        p("filtered"),
        (
            s("filtered"),
            s("incomplete"),
            Some(s("not_exhaustive")),
            s("not_declared"),
            0,
            0,
            0,
            0,
            0,
            None
        )
    );
    assert_eq!(p("low").8, 20);
    assert!(
        populations.iter().all(|p| p.0 != "mismatch"),
        "a header mismatch records no manifest"
    );
    assert!(
        bodies[4].contains("Amount"),
        "the feedback names the column"
    );
    // Each exclusion is a stored member with its reason.
    let reasons: Vec<(String, Option<String>, i64)> = sqlx::query_as(
        "SELECT m.disposition,m.reason,count(*) FROM public.assessment_population_members m JOIN public.assessment_populations p ON p.id=m.population_id WHERE p.document->>'key'='ap' GROUP BY 1,2 ORDER BY 1,2",
    )
    .fetch_all(&mut admin)
    .await
    .unwrap();
    assert_eq!(
        reasons,
        [
            (s("duplicate_row"), None, 6),
            (s("excluded"), Some(s("out_of_period")), 50),
            (s("in_scope"), None, 1200),
        ]
    );
    // The enumeration job read the exact original; its ID is kept.
    let job: Option<String> = sqlx::query_scalar(
        "SELECT job_id FROM public.assessment_populations WHERE document->>'key'='ap'",
    )
    .fetch_one(&mut admin)
    .await
    .unwrap();
    assert!(
        job.is_some(),
        "a workbook is read by a recorded enumeration job"
    );

    // AC2: per-criterion opportunity counts and the subject partition.
    let raw: Vec<SummaryRow> = sqlx::query_as(
        "SELECT conclusion,completeness,completeness_reason,reconciliation,received_rows,duplicate_rows,distinct_subjects,excluded_out_of_period,in_scope,selected,failing_subjects,meets_every_applicable,unresolved_subjects,not_applicable_to_any,failing_opportunities FROM public.assessment_summaries ORDER BY created_us",
    )
    .fetch_all(&mut admin)
    .await
    .unwrap();
    // Words, then the counts in their column order.
    let rows: Vec<SummaryWords> = raw
        .into_iter()
        .map(|r| {
            (
                r.0,
                r.1,
                r.2,
                r.3,
                vec![
                    Some(r.4),
                    Some(r.5),
                    Some(r.6),
                    Some(r.7),
                    Some(r.8),
                    r.9,
                    Some(r.10),
                    Some(r.11),
                    Some(r.12),
                    Some(r.13),
                    Some(r.14),
                ],
            )
        })
        .collect();
    assert_eq!(rows.len(), 8, "{rows:#?}");
    let expected: serde_json::Value = serde_json::from_slice(
        &std::fs::read(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../fixtures/documents/AP population expected.json"),
        )
        .unwrap(),
    )
    .unwrap();
    let e = |key: &str| expected[key].as_i64().unwrap() as i32;
    assert_eq!(
        rows[0],
        (
            s("exceptions_found_inconclusive"),
            s("complete"),
            None,
            s("matched"),
            vec![
                Some(e("received_rows")),
                Some(e("duplicate_rows")),
                Some(e("distinct_subjects")),
                Some(e("excluded_out_of_period")),
                Some(e("in_scope")),
                None,
                Some(e("failing")),
                Some(e("meets_every_applicable")),
                Some(e("unresolved")),
                Some(e("not_applicable_to_any")),
                Some(e("failing_opportunities")),
            ],
        )
    );
    let per_criterion: Vec<(String, String, String, String, String)> = sqlx::query_as(
        "SELECT (SELECT document->>'key' FROM public.assessment_criteria c WHERE c.id=x->>'criterion_id'),x->>'applicable',x->>'met',x->>'not_met',x->>'undetermined' FROM public.assessment_summaries s, jsonb_array_elements(s.document->'summary'->'criteria') x WHERE s.ordinal=0 AND s.sample_id IS NULL AND s.received_rows=1256 ORDER BY 1",
    )
    .fetch_all(&mut admin)
    .await
    .unwrap();
    let c = |key: &str| {
        let v = &expected[key];
        (
            s(if key == "a" { "approver" } else { "before" }),
            expected["applicable"].to_string(),
            v["met"].to_string(),
            v["not_met"].to_string(),
            v["undetermined"].to_string(),
        )
    };
    assert_eq!(per_criterion, [c("a"), c("b")]);
    // Every other per-criterion field, against the same independent counts.
    let rest: Vec<(String, String, String, String, String)> = sqlx::query_as(
        "SELECT x->>'not_applicable',x->>'applicability_unknown',x->>'execution_failed',x->>'not_evaluated',x->>'met_unreviewed' FROM public.assessment_summaries s, jsonb_array_elements(s.document->'summary'->'criteria') x WHERE s.ordinal=0 AND s.sample_id IS NULL AND s.received_rows=1256",
    )
    .fetch_all(&mut admin)
    .await
    .unwrap();
    let zero = || s("0");
    assert_eq!(
        rest,
        vec![
            (
                expected["not_applicable"].to_string(),
                zero(),
                zero(),
                zero(),
                zero()
            );
            2
        ]
    );
    // Zero applicable: not a pass.
    assert_eq!(
        (rows[1].0.as_str(), rows[1].4[9], rows[1].4[7]),
        ("no_eligible_items", Some(20), Some(0))
    );
    // A filtered export: absence is not proven.
    assert_eq!(rows[2].0, "no_items_found_absence_not_proven");
    // The sample: 25 selected items, never a population conclusion. Its
    // partition is recounted here from the stored opportunities of exactly
    // the selected subjects, independently of the summary.
    assert_eq!(rows[3].4[5], Some(25));
    let (failing, unresolved, meets): (i64, i64, i64) = sqlx::query_as(
        "WITH s AS (SELECT id FROM public.assessment_samples WHERE document->>'key'='s1'),
         per AS (SELECT o.subject, bool_or(o.verdict='not_met') AS f,
                   bool_or(o.applicability='unknown' OR o.execution='failed' OR (o.applicability='applicable' AND o.verdict IS DISTINCT FROM 'met' AND o.verdict IS DISTINCT FROM 'not_met')) AS u,
                   bool_or(o.verdict='met') AS m
                 FROM public.assessment_opportunities o JOIN public.assessment_populations p ON p.id=o.population_id
                 WHERE p.document->>'key'='ap' AND o.subject IN (SELECT x.subject FROM public.assessment_sample_members x WHERE x.sample_id=(SELECT id FROM s))
                 GROUP BY o.subject)
         SELECT count(*) FILTER (WHERE f), count(*) FILTER (WHERE NOT f AND u), count(*) FILTER (WHERE NOT f AND NOT u AND m) FROM per",
    )
    .fetch_one(&mut admin)
    .await
    .unwrap();
    assert_eq!(
        (rows[3].4[6], rows[3].4[8], rows[3].4[7]),
        (
            Some(failing as i32),
            Some(unresolved as i32),
            Some(meets as i32)
        )
    );
    let sampled = if failing > 0 {
        if unresolved > 0 {
            "exceptions_found_inconclusive"
        } else {
            "exceptions_found"
        }
    } else {
        "inconclusive"
    };
    assert_eq!(
        rows[3].0, sampled,
        "a sample concludes only about its selected items"
    );
    let (selected, inference): (i64, bool) = sqlx::query_as("SELECT (SELECT count(*) FROM public.assessment_sample_members m JOIN public.assessment_samples s ON s.id=m.sample_id WHERE s.document->>'key'='s1'),(SELECT bool_or(statistical_inference) FROM public.assessment_summaries)")
        .fetch_one(&mut admin)
        .await
        .unwrap();
    assert_eq!((selected, inference), (25, false));

    // The Edge sheet, read end to end: a conflicting duplicate key (both rows
    // scope unknown), a date that does not parse, a blank date and a row
    // with no key. Nothing covers them, so the summary is inconclusive.
    let o = |v: &str| Some(v.to_string());
    assert_eq!(
        dispositions(&mut admin, "edge").await,
        [
            (s("scope_unknown"), o("conflicting_duplicate"), o("000123")),
            (s("scope_unknown"), o("conflicting_duplicate"), o("000123")),
            (s("scope_unknown"), o("period_unparsed"), o("INV-EDGE-1")),
            (s("scope_unknown"), o("period_missing"), o("INV-EDGE-2")),
            (s("unkeyed"), None, None),
            (s("in_scope"), None, o("INV-EDGE-3")),
        ]
    );
    assert_eq!(
        (rows[4].0.as_str(), rows[4].4.clone()),
        (
            "inconclusive",
            vec![
                Some(6),
                Some(0),
                Some(4),
                Some(0),
                Some(1),
                None,
                Some(0),
                Some(1),
                Some(0),
                Some(0),
                Some(0)
            ]
        )
    );
    let unkeyed: (i32, i32, i32, i32) = sqlx::query_as(
        "SELECT s.unkeyed,s.scope_unknown_period_unparsed,s.scope_unknown_period_missing,s.scope_unknown_conflicting_duplicate FROM public.assessment_summaries s JOIN public.assessment_populations p ON p.id=s.population_id WHERE p.document->>'key'='edge'",
    )
    .fetch_one(&mut admin)
    .await
    .unwrap();
    assert_eq!(unkeyed, (1, 1, 1, 1));
    assert_eq!(
        limitations(&mut admin, "edge", false).await,
        [(s("scope_unknown"), Some(3)), (s("unkeyed_rows"), Some(1))]
    );

    // The Dated sheet of typed Excel cells: a zero-padded invoice number keeps
    // its leading zeros, an Excel date is a date, formatted empty rows are not
    // rows, and each naive Excel date-time is said to be read as UTC. Every
    // in-scope invoice meets both criteria over a complete population: the
    // one positive "no exception found". The sample of all of them is never
    // a population conclusion.
    assert_eq!(
        dispositions(&mut admin, "dated").await,
        [
            (s("in_scope"), None, o("000123")),
            (s("excluded"), o("out_of_period"), o("000124")),
            (s("in_scope"), None, o("INV-D3")),
        ]
    );
    assert_eq!(
        (rows[5].0.as_str(), rows[5].4.clone()),
        (
            "no_exception_found",
            vec![
                Some(3),
                Some(0),
                Some(3),
                Some(1),
                Some(2),
                None,
                Some(0),
                Some(2),
                Some(0),
                Some(0),
                Some(0)
            ]
        )
    );
    let (naive, kinds): (String, Vec<String>) = sqlx::query_as(
        "SELECT p.document->>'naive_date_times',(SELECT array_agg(c->>'kind' ORDER BY m.ordinal,c->>'kind') FROM public.assessment_population_members m, jsonb_array_elements(m.document->'cells') c WHERE m.population_id=p.id) FROM public.assessment_populations p WHERE p.document->>'key'='dated'",
    )
    .fetch_one(&mut admin)
    .await
    .unwrap();
    assert_eq!(
        naive, "3",
        "three Excel date-time cells in the instant column"
    );
    assert_eq!(kinds.iter().filter(|k| *k == "excel_datetime").count(), 3);
    assert_eq!(kinds.iter().filter(|k| *k == "excel_date").count(), 3);
    assert_eq!(
        limitations(&mut admin, "dated", false).await,
        [(s("naive_date_times"), Some(3))]
    );
    assert_eq!(
        (rows[6].0.as_str(), rows[6].4[5], rows[6].4[7], rows[6].4[6]),
        ("inconclusive", Some(2), Some(2), Some(0))
    );
    assert!(
        limitations(&mut admin, "dated", true)
            .await
            .contains(&(s("sample_selected_only"), Some(2)))
    );

    // The Lines sheet: the grain is invoice line, so each line is a subject.
    let lines = dispositions(&mut admin, "lines").await;
    assert_eq!(lines.len(), 6);
    assert!(lines.iter().all(|l| l.0 == "in_scope"));
    assert_eq!(lines[0].2.as_deref(), Some("INV-00251|1"));
    assert_eq!(
        (rows[7].0.as_str(), rows[7].4[2], rows[7].4[4], rows[7].4[7]),
        ("no_exception_found", Some(6), Some(6), Some(6))
    );

    // The work API shows the counts beside their units, and a page of
    // exclusions with an exact total.
    let auth = zobba_api::auth::AuthState::from_environment(&database).unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = format!("http://{}", listener.local_addr().unwrap());
    let app = zobba_api::authenticated_router(database.clone(), auth);
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let client = reqwest_fixture::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .unwrap();
    let cookie = format!("__Host-zobba-session={auditor}");
    let work_url = format!(
        "{address}/engagements/engagement-a/tasks/{}/work?organisation_id=org-a&client_id=client-a",
        receipt.task_id
    );
    let response = client
        .get(&work_url)
        .header("Cookie", &cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status().as_u16(), 200);
    let work: serde_json::Value = serde_json::from_slice(&response.bytes().await.unwrap()).unwrap();
    assert_eq!(work["assessment_unavailable"], false);
    let assessment = &work["assessment"];
    assert_eq!(
        (
            assessment["total_populations"].as_str(),
            assessment["total_summaries"].as_str()
        ),
        (Some("7"), Some("8"))
    );
    let summary = &assessment["summaries"][0];
    assert_eq!(summary["failing_subjects"], "20");
    assert_eq!(summary["failing_opportunities"], "27");
    assert_eq!(summary["counts"]["in_scope"], "1200");
    let text = work.to_string();
    assert!(!text.contains("confidence") && !text.contains("percent"));
    let ap: String = sqlx::query_scalar(
        "SELECT id FROM public.assessment_populations WHERE document->>'key'='ap'",
    )
    .fetch_one(&mut admin)
    .await
    .unwrap();
    let members = |query: String| {
        let client = client.clone();
        let cookie = cookie.clone();
        let url = format!(
            "{address}/engagements/engagement-a/tasks/{}/assessment/populations/{ap}/members?organisation_id=org-a&client_id=client-a{query}",
            receipt.task_id
        );
        async move {
            let response = client
                .get(&url)
                .header("Cookie", &cookie)
                .send()
                .await
                .unwrap();
            let status = response.status().as_u16();
            let body: serde_json::Value =
                serde_json::from_slice(&response.bytes().await.unwrap()).unwrap_or_default();
            (status, body)
        }
    };
    let (status, first) = members("&disposition=excluded".into()).await;
    assert_eq!(status, 200);
    assert_eq!(first["total"], "50");
    assert_eq!(first["members"].as_array().unwrap().len(), 50);
    assert!(first["next_cursor"].is_null(), "50 exclusions fit one page");
    assert_eq!(first["members"][0]["reason"], "out_of_period");
    assert_eq!(first["members"][0]["subject"], "INV-00001");
    assert_eq!(first["values_withheld"], false);
    let (_, all) = members(String::new()).await;
    assert_eq!(all["total"], "1256");
    let cursor = all["next_cursor"].as_str().unwrap().to_string();
    let (_, next) = members(format!("&cursor={cursor}")).await;
    assert_eq!(next["members"][0]["ordinal"], 50);
    let (status, _) = members("&disposition=passed".into()).await;
    assert_eq!(status, 400, "an unknown disposition is refused");
    coverage_fixture(assessment, &first);

    // Route-level authority (J/H4). A population this Task does not hold is
    // refused like any record outside scope; a changed session is 412.
    let route = |population: &str| {
        format!(
            "{address}/engagements/engagement-a/tasks/{}/assessment/populations/{population}/members?organisation_id=org-a&client_id=client-a",
            receipt.task_id
        )
    };
    let status_of = |url: String, expected_session: Option<&'static str>| {
        let client = client.clone();
        let cookie = cookie.clone();
        async move {
            let mut request = client.get(&url).header("Cookie", &cookie);
            if let Some(value) = expected_session {
                request = request.header("X-Expected-Session", value);
            }
            request.send().await.unwrap().status().as_u16()
        }
    };
    assert_eq!(
        status_of(route(&format!("pop-{}", "9".repeat(40))), None).await,
        403
    );
    assert_eq!(status_of(route(&ap), Some("not-this-session")).await, 412);
    // A revoked engagement assignment refuses the read; restored, it reads.
    sqlx::query("UPDATE public.engagement_assignments SET active=false WHERE actor_id='actor-a' AND organisation_id='org-a'")
        .execute(&mut admin)
        .await
        .unwrap();
    assert_eq!(status_of(route(&ap), None).await, 403);
    sqlx::query("UPDATE public.engagement_assignments SET active=true WHERE actor_id='actor-a' AND organisation_id='org-a'")
        .execute(&mut admin)
        .await
        .unwrap();
    assert_eq!(status_of(route(&ap), None).await, 200);
    // When the viewer cannot read the exact original (here its registered
    // digest no longer matches, set by the test administrator with triggers
    // off and restored at once), every cell text, key and measure read from
    // it is withheld on both routes; counts and positions stay.
    let digest: String =
        sqlx::query_scalar("SELECT digest FROM public.evidence_originals WHERE id='ap-population'")
            .fetch_one(&mut admin)
            .await
            .unwrap();
    let swap = |to: String| {
        format!(
            "SET session_replication_role = replica; UPDATE public.evidence_originals SET digest='{to}' WHERE id='ap-population'; RESET session_replication_role"
        )
    };
    sqlx::raw_sql(&swap("0".repeat(64)))
        .execute(&mut admin)
        .await
        .unwrap();
    let hidden: serde_json::Value = serde_json::from_slice(
        &client
            .get(&work_url)
            .header("Cookie", &cookie)
            .send()
            .await
            .unwrap()
            .bytes()
            .await
            .unwrap(),
    )
    .unwrap();
    let (_, withheld) = members("&disposition=excluded".into()).await;
    sqlx::raw_sql(&swap(digest))
        .execute(&mut admin)
        .await
        .unwrap();
    let s1 = hidden["assessment"]["samples"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["key"] == "s1")
        .unwrap();
    assert_eq!(
        (
            s1["keys_withheld"].as_bool(),
            s1["keys"].as_array().map(Vec::len),
            s1["substitutions"].as_array().map(Vec::len)
        ),
        (Some(true), Some(0), Some(0))
    );
    assert!(
        hidden["assessment"]["populations"]
            .as_array()
            .unwrap()
            .iter()
            .all(|p| p["filename"].is_null())
    );
    assert!(
        !hidden["assessment"].to_string().contains("INV-0"),
        "no key of the original appears"
    );
    assert_eq!(
        (
            withheld["values_withheld"].as_bool(),
            withheld["total"].as_str()
        ),
        (Some(true), Some("50"))
    );
    for m in withheld["members"].as_array().unwrap() {
        assert!(m["subject"].is_null());
        assert!(
            m["cells"]
                .as_array()
                .unwrap()
                .iter()
                .all(|c| c["text"].is_null() && c["location"].is_string())
        );
        assert!(
            m["values"]
                .as_array()
                .unwrap()
                .iter()
                .all(|v| v["value"].is_null() && v["measure"].is_null())
        );
    }
    assert!(
        !withheld["members"].to_string().contains("INV-0")
            && !withheld["members"].to_string().contains("USD")
    );

    database_guards_refuse_altered_coverage_records(&mut admin, &mut owner, &pool).await;
    batch_and_row_guards_refuse_one_bad_row(&mut admin, false).await;
    batch_and_row_guards_refuse_one_bad_row(&mut owner, true).await;

    stop.send(true).unwrap();
    worker.await.unwrap();
    server.abort();
    zobba_infrastructure::analysis::docker::remove_all_test_resources().await;
}

/// Each stored member of a population (by key): disposition, reason, subject.
async fn dispositions(
    admin: &mut PgConnection,
    key: &str,
) -> Vec<(String, Option<String>, Option<String>)> {
    sqlx::query_as(
        "SELECT m.disposition,m.reason,m.subject FROM public.assessment_population_members m JOIN public.assessment_populations p ON p.id=m.population_id WHERE p.document->>'key'=$1 ORDER BY m.ordinal",
    )
    .bind(key)
    .fetch_all(admin)
    .await
    .unwrap()
}
/// The closed limitation codes and counts of a population's summary.
async fn limitations(
    admin: &mut PgConnection,
    key: &str,
    sample: bool,
) -> Vec<(String, Option<i64>)> {
    sqlx::query_as(
        "SELECT l->>'code',(l->>'count')::bigint FROM public.assessment_summaries s JOIN public.assessment_populations p ON p.id=s.population_id, jsonb_array_elements(s.document->'summary'->'limitations') l WHERE p.document->>'key'=$1 AND (s.sample_id IS NOT NULL)=$2 ORDER BY 1",
    )
    .bind(key)
    .bind(sample)
    .fetch_all(admin)
    .await
    .unwrap()
}

/// The exact coverage JSON the web parses (`web/tests/fixtures/task-coverage.json`),
/// with generated identifiers and digests replaced by stable ones. Set
/// `ZOBBA_UPDATE_COVERAGE_FIXTURE=1` to rewrite it after an intended change.
fn coverage_fixture(assessment: &serde_json::Value, members: &serde_json::Value) {
    let mut ids: Vec<String> = Vec::new();
    fn normalise(value: &mut serde_json::Value, ids: &mut Vec<String>) {
        match value {
            serde_json::Value::Object(map) => {
                for (key, field) in map.iter_mut() {
                    if let serde_json::Value::String(text) = &*field {
                        let generated = matches!(
                            key.as_str(),
                            "invocation_id" | "methodology_binding_id" | "job_id" | "version"
                        ) || (text.len() == 64
                            && text.bytes().all(|b| b.is_ascii_hexdigit()))
                            || text.split_once('-').is_some_and(|(p, rest)| {
                                matches!(p, "crit" | "basis" | "pop" | "sample" | "summary")
                                    && rest.len() == 40
                            });
                        if generated {
                            let text = text.clone();
                            let index = ids.iter().position(|v| *v == text).unwrap_or_else(|| {
                                ids.push(text.clone());
                                ids.len() - 1
                            });
                            *field = if text.len() == 64 {
                                serde_json::json!(format!("{:064x}", index + 1))
                            } else {
                                serde_json::json!(format!("id-{}", index + 1))
                            };
                        }
                    } else {
                        normalise(field, ids);
                    }
                }
            }
            serde_json::Value::Array(items) => {
                for item in items.iter_mut() {
                    if let serde_json::Value::String(text) = &*item {
                        if let Some(index) = ids.iter().position(|v| v == text) {
                            *item = serde_json::json!(format!("id-{}", index + 1));
                        }
                    } else {
                        normalise(item, ids);
                    }
                }
            }
            _ => {}
        }
    }
    let mut value = serde_json::json!({
        "populations": assessment["populations"],
        "samples": assessment["samples"],
        "summaries": assessment["summaries"],
        "criteria": assessment["criteria"],
        "members": members,
    });
    normalise(&mut value, &mut ids);
    let text = serde_json::to_string_pretty(&value).unwrap() + "\n";
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../web/tests/fixtures/task-coverage.json");
    if std::env::var_os("ZOBBA_UPDATE_COVERAGE_FIXTURE").is_some() {
        std::fs::write(&path, &text).unwrap();
    }
    assert_eq!(
        std::fs::read_to_string(&path).unwrap_or_default(),
        text,
        "the web fixture is the exact API JSON; rerun with ZOBBA_UPDATE_COVERAGE_FIXTURE=1"
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

/// A copy of the full population's summary under a new ID and ordinal, with
/// one column (and its document field) changed: the database recounts it.
fn forged_summary(sets: &[(&str, &str, &str)]) -> String {
    forged_from(
        "s.sample_id IS NULL AND s.received_rows=1256 AND s.ordinal=0",
        None,
        sets,
    )
}
/// The same copy of another stored summary (`filter` over `s`), optionally
/// under another answer invocation (`invocation`, a SQL expression) whose
/// ordinal 1 is free. A path value `DELETE` removes that document key.
fn forged_from(filter: &str, invocation: Option<&str>, sets: &[(&str, &str, &str)]) -> String {
    let id = format!("summary-{:040x}", 0xf00du32);
    let mut document = format!(
        "jsonb_set(jsonb_set(s.document,'{{id}}',to_jsonb('{id}'::text)),'{{ordinal}}','1')"
    );
    if let Some(invocation) = invocation {
        document =
            format!("jsonb_set({document},'{{invocation_id}}',to_jsonb(({invocation})::text))");
    }
    let mut columns = vec![
        "organisation_id",
        "client_id",
        "engagement_id",
        "task_id",
        "cycle_id",
        "actor_id",
        "invocation_id",
        "methodology_binding_id",
        "execution_epoch",
        "basis_id",
        "population_id",
        "sample_id",
        "aggregation",
        "conclusion",
        "completeness",
        "completeness_reason",
        "reconciliation",
        "received_rows",
        "unkeyed",
        "duplicate_rows",
        "distinct_subjects",
        "excluded_out_of_period",
        "scope_unknown_period_unparsed",
        "scope_unknown_period_missing",
        "scope_unknown_conflicting_duplicate",
        "in_scope",
        "selected",
        "failing_subjects",
        "meets_every_applicable",
        "unresolved_subjects",
        "not_applicable_to_any",
        "failing_opportunities",
        "statistical_inference",
        "summary_digest",
        "digest",
    ]
    .into_iter()
    .map(|c| (c, format!("s.{c}")))
    .collect::<Vec<_>>();
    if let Some(invocation) = invocation
        && let Some(entry) = columns.iter_mut().find(|(c, _)| *c == "invocation_id")
    {
        entry.1 = format!("({invocation})");
    }
    for (column, path, value) in sets {
        // `PLUS` is the stored count plus one; `SAMPLE` names sample s1.
        let (json, sql) = match *value {
            "PLUS" => (format!("to_jsonb(s.{column}+1)"), format!("s.{column}+1")),
            "SAMPLE" => {
                let id = "(SELECT id FROM public.assessment_samples WHERE document->>'key'='s1')";
                (format!("to_jsonb({id})"), id.to_string())
            }
            v if v.starts_with('"') => (format!("'{v}'"), format!("'{}'", v.trim_matches('"'))),
            v => (format!("'{v}'"), v.to_string()),
        };
        document = if *value == "DELETE" {
            format!("({document}) #- '{{summary,{path}}}'")
        } else if path.is_empty() {
            format!("jsonb_set({document},'{{{column}}}',{json})")
        } else {
            format!("jsonb_set({document},'{{summary,{path}}}',{json})")
        };
        if let Some(entry) = columns.iter_mut().find(|(c, _)| c == column) {
            entry.1 = sql;
        }
    }
    let names: Vec<&str> = columns.iter().map(|(c, _)| *c).collect();
    let values: Vec<String> = columns.iter().map(|(_, v)| v.clone()).collect();
    format!(
        "INSERT INTO public.assessment_summaries({},ordinal,id,document) SELECT {},1,'{id}',{document} FROM public.assessment_summaries s WHERE {filter}",
        names.join(","),
        values.join(",")
    )
}

/// Records are immutable even for the owner and under the fixture reset;
/// the summary guard recounts every count; every refusal is checked by its
/// own message.
async fn database_guards_refuse_altered_coverage_records(
    admin: &mut PgConnection,
    owner: &mut PgConnection,
    pool: &sqlx::PgPool,
) {
    let tables = [
        "assessment_populations",
        "assessment_population_members",
        "assessment_samples",
        "assessment_sample_members",
        "assessment_opportunities",
        "assessment_summaries",
    ];
    for table in tables {
        let statement = format!("UPDATE public.{table} SET organisation_id=organisation_id");
        assert_refused(
            &refused(admin, &statement).await,
            "coverage records are immutable",
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
        assert_refused(&message, "coverage records are immutable", &statement);
        reset.rollback().await.unwrap();
        assert!(
            sqlx::query(&format!("DELETE FROM public.{table}"))
                .execute(pool)
                .await
                .is_err(),
            "runtime deleted from {table}"
        );
        let statement = format!("DELETE FROM public.{table}");
        assert_refused(
            &refused(admin, &statement).await,
            "coverage records are immutable",
            &statement,
        );
        let statement = format!("TRUNCATE public.{table} CASCADE");
        assert_refused(
            &refused(admin, &statement).await,
            "coverage records are retained",
            &statement,
        );
        // The migration owner (the tables' owner) gets no exception: forced
        // RLS gives it no rows to change, and TRUNCATE is refused.
        let changed = sqlx::query(&format!(
            "UPDATE public.{table} SET organisation_id=organisation_id"
        ))
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
        assert_refused(
            &refused(owner, &statement).await,
            "coverage records are retained",
            &statement,
        );
    }
    // The only escape is an explicit fixture reset in a *_test database,
    // shown in a rolled-back transaction.
    let before: i64 =
        sqlx::query_scalar("SELECT count(*) FROM public.assessment_population_members")
            .fetch_one(&mut *admin)
            .await
            .unwrap();
    let mut reset = admin.begin().await.unwrap();
    sqlx::query("SET LOCAL zobba.disposable_fixture_reset='on'")
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
    let kept: i64 = sqlx::query_scalar("SELECT count(*) FROM public.assessment_population_members")
        .fetch_one(&mut *admin)
        .await
        .unwrap();
    assert_eq!(kept, before);

    // Forged summaries: each changes one count (or the conclusion) and keeps
    // every CHECK satisfied, so only the recounting guard refuses it.
    let cases: Vec<(String, &'static str)> = vec![
        (
            forged_summary(&[
                ("failing_subjects", "failing", "21"),
                ("meets_every_applicable", "meets_every_applicable", "959"),
            ]),
            "a summary count is not the stored count: failing_subjects",
        ),
        (
            forged_summary(&[
                ("in_scope", "in_scope", "1201"),
                ("not_applicable_to_any", "not_applicable_to_any", "201"),
            ]),
            "a summary count is not the stored count: in_scope",
        ),
        (
            forged_summary(&[("failing_opportunities", "failing_opportunities", "20")]),
            "a summary count is not the stored count: failing_opportunities",
        ),
        (
            forged_summary(&[("conclusion", "conclusion", r#""exceptions_found""#)]),
            "a summary concludes only what its counts allow",
        ),
    ];
    // Each counted column on its own (a population count moves no CHECK).
    let count = "a summary count is not the stored count: ";
    let mut cases = cases;
    for (column, path, value) in [
        ("received_rows", "received_rows", "1257"),
        ("unkeyed", "unkeyed", "1"),
        ("duplicate_rows", "duplicate_rows", "7"),
        ("distinct_subjects", "distinct_subjects", "1251"),
        ("excluded_out_of_period", "excluded_out_of_period", "51"),
        (
            "scope_unknown_period_unparsed",
            "scope_unknown_period_unparsed",
            "1",
        ),
        (
            "scope_unknown_period_missing",
            "scope_unknown_period_missing",
            "1",
        ),
        (
            "scope_unknown_conflicting_duplicate",
            "scope_unknown_conflicting_duplicate",
            "1",
        ),
    ] {
        cases.push((
            forged_summary(&[(column, path, value)]),
            Box::leak(format!("{count}{column}").into_boxed_str()),
        ));
    }
    cases.push((
        forged_summary(&[
            ("unresolved_subjects", "unresolved", "21"),
            ("meets_every_applicable", "meets_every_applicable", "959"),
        ]),
        "a summary count is not the stored count: unresolved_subjects",
    ));
    cases.push((
        forged_summary(&[
            ("meets_every_applicable", "meets_every_applicable", "961"),
            ("not_applicable_to_any", "not_applicable_to_any", "199"),
        ]),
        "a summary count is not the stored count: meets_every_applicable",
    ));
    // Each per-criterion field, a missing key, a count written as a string,
    // the reasons, the criterion and its order.
    for (path, value) in [
        ("criteria,0,applicable", "1001"),
        ("criteria,0,not_applicable", "201"),
        ("criteria,0,applicability_unknown", "1"),
        ("criteria,0,met", "976"),
        ("criteria,0,not_met", "16"),
        ("criteria,0,undetermined", "9"),
        ("criteria,0,execution_failed", "1"),
        ("criteria,0,not_evaluated", "1"),
        ("criteria,0,met_unreviewed", "1"),
        ("criteria,0,undetermined_by_reason", "{}"),
        ("criteria,0,met", "DELETE"),
        ("criteria,0,met", "\"975\""),
        (
            "criteria,0,criterion_id",
            "\"crit-0000000000000000000000000000000000000000\"",
        ),
    ] {
        cases.push((
            forged_summary(&[("", path, value)]),
            "a summary count is not the stored count: criterion",
        ));
    }
    // A sample summary's selected count.
    cases.push((
        forged_from(
            "s.sample_id=(SELECT id FROM public.assessment_samples WHERE document->>'key'='s1')",
            None,
            &[
                ("selected", "selected", "26"),
                ("not_applicable_to_any", "not_applicable_to_any", "PLUS"),
            ],
        ),
        "a summary count is not the stored count: selected",
    ));
    // The conclusion branches: "no exception found" only for the complete
    // clean population; never for its sample, never with scope-unknown or
    // unkeyed rows, never for an inconclusive population.
    let free =
        "(SELECT invocation_id FROM public.assessment_populations WHERE document->>'key'='low')";
    let dated = "s.population_id=(SELECT id FROM public.assessment_populations WHERE document->>'key'='dated')";
    cases.push((
        forged_from(
            &format!("{dated} AND s.sample_id IS NULL"),
            Some(free),
            &[("conclusion", "conclusion", "\"inconclusive\"")],
        ),
        "a summary concludes only what its counts allow: no_exception_found",
    ));
    cases.push((
        forged_from(
            &format!("{dated} AND s.sample_id IS NOT NULL"),
            Some(free),
            &[("conclusion", "conclusion", "\"no_exception_found\"")],
        ),
        "a summary concludes only what its counts allow: inconclusive",
    ));
    cases.push((
        forged_from(
            "s.population_id=(SELECT id FROM public.assessment_populations WHERE document->>'key'='edge')",
            Some(free),
            &[("conclusion", "conclusion", "\"no_exception_found\"")],
        ),
        "a summary concludes only what its counts allow: inconclusive",
    ));
    // Row guards of a summary: its population's completeness, a sample of
    // its population, its own basis.
    cases.push((
        forged_from(
            "s.population_id=(SELECT id FROM public.assessment_populations WHERE document->>'key'='filtered')",
            Some(free),
            &[("completeness_reason", "completeness_reason", "\"row_bound\"")],
        ),
        "a summary states its population's completeness and reconciliation",
    ));
    cases.push((
        forged_from(
            &format!("{dated} AND s.sample_id IS NOT NULL"),
            Some(free),
            &[("sample_id", "", "SAMPLE")],
        ),
        "a summary reads a sample of its population",
    ));
    cases.push((
        forged_from(
            &format!("{dated} AND s.sample_id IS NULL"),
            Some(free),
            &[(
                "basis_id",
                "",
                "\"basis-ffffffffffffffffffffffffffffffffffffffff\"",
            )],
        ),
        "a summary reads a population of its own Task and basis",
    ));
    for (statement, expected) in &cases {
        assert_refused(&refused(admin, statement).await, expected, statement);
    }
    // Positive control: the unaltered copy reaches the uniqueness of one
    // summary per population, not a count guard.
    let copy = forged_summary(&[]);
    let message = refused(admin, &copy).await;
    assert!(
        message.contains("duplicate key value violates unique constraint"),
        "the unaltered copy reaches only the one-summary uniqueness: {message}"
    );

    // The document environment admits only the exact trusted program over
    // one JSON string literal: an appended line, or a literal holding a
    // character outside the trusted encoder's set, is refused.
    let job = |program: &str| {
        format!(
            "INSERT INTO public.analysis_jobs SELECT (jsonb_populate_record(NULL::public.analysis_jobs, to_jsonb(j) || jsonb_build_object('id','job-forged-{n}','operation_id','op-forged-{n}','program',{program}))).* FROM public.analysis_jobs j WHERE j.id=(SELECT job_id FROM public.assessment_populations WHERE document->>'key'='low')",
            n = program.len()
        )
    };
    for program in [
        "j.program || '# appended' || chr(10)",
        // The sheet name inside the literal, with a character the encoder
        // never writes unescaped (the program text holds no "Low").
        "replace(j.program, 'Low', 'Lo#w')",
    ] {
        let statement = job(program);
        assert_refused(
            &refused(admin, &statement).await,
            "only the trusted document program runs in the document environment",
            &statement,
        );
    }
    // Positive control: the exact program passes the guard and reaches only
    // the job's operation (one job per operation; a new one has no operation).
    let statement = job("j.program").replace("'op-forged-9'", "j.operation_id");
    let message = refused(admin, &statement).await;
    assert!(
        message.contains("duplicate key value violates unique constraint")
            && !message.contains("trusted document program"),
        "{message}"
    );
}

/// A statement refused inside a transaction, rolled back to a savepoint so
/// the next case runs on the same state; the database's own words.
async fn refused_in(tx: &mut PgConnection, statement: &str) -> String {
    sqlx::query("SAVEPOINT guard_case")
        .execute(&mut *tx)
        .await
        .unwrap();
    let message = sqlx::query(statement)
        .execute(&mut *tx)
        .await
        .expect_err(statement)
        .to_string();
    sqlx::query("ROLLBACK TO SAVEPOINT guard_case")
        .execute(&mut *tx)
        .await
        .unwrap();
    message
}
async fn accepted_in(tx: &mut PgConnection, statement: &str) -> u64 {
    sqlx::query(statement)
        .execute(&mut *tx)
        .await
        .unwrap_or_else(|e| panic!("{statement}: {e}"))
        .rows_affected()
}
async fn text_of(tx: &mut PgConnection, sql: &str) -> String {
    sqlx::query_scalar(sql)
        .fetch_one(&mut *tx)
        .await
        .unwrap_or_else(|e| panic!("{sql}: {e}"))
}

/// `INSERT ... SELECT` copies of stored rows of `table` under new keys:
/// every column comes from the stored row, overridden by the jsonb
/// expression `overrides` (over `t`, the stored row).
fn copy(table: &str, overrides: &str, filter: &str) -> String {
    format!(
        "INSERT INTO public.{table} SELECT (jsonb_populate_record(NULL::public.{table}, to_jsonb(t) || {overrides})).* FROM public.{table} t WHERE {filter}"
    )
}

/// Story 24.2 review (J): every row guard, statement-level batch guard and
/// deferred count guard refuses a forgery, each by its own words. Batches
/// are multi-row `INSERT ... SELECT` copies of the stored rows in which
/// exactly one row is bad; the unaltered copy is accepted (the positive
/// control). Run once as the administrator and once as the migration owner
/// under the runtime's scope settings, so the trigger, not RLS, refuses.
async fn batch_and_row_guards_refuse_one_bad_row(conn: &mut PgConnection, as_owner: bool) {
    let mut tx = conn.begin().await.unwrap();
    if as_owner {
        sqlx::query("SELECT set_config('zobba.organisation_id','org-a',true),set_config('zobba.client_id','client-a',true),set_config('zobba.engagement_id','engagement-a',true),set_config('zobba.actor_id','actor-a',true)")
            .execute(&mut *tx)
            .await
            .unwrap();
    }
    let ap = text_of(
        &mut tx,
        "SELECT id FROM public.assessment_populations WHERE document->>'key'='ap'",
    )
    .await;
    let inv1 = text_of(
        &mut tx,
        "SELECT invocation_id FROM public.assessment_populations WHERE document->>'key'='ap'",
    )
    .await;
    // Turn 4 recorded a sample but no population: its invocation can hold one.
    let inv4 = text_of(
        &mut tx,
        "SELECT invocation_id FROM public.assessment_samples WHERE document->>'key'='s1'",
    )
    .await;
    let s1 = text_of(
        &mut tx,
        "SELECT id FROM public.assessment_samples WHERE document->>'key'='s1'",
    )
    .await;
    let low_job = text_of(
        &mut tx,
        "SELECT job_id FROM public.assessment_populations WHERE document->>'key'='low'",
    )
    .await;
    let p2 = format!("pop-{}", "e".repeat(40));
    let s2 = format!("sample-{}", "e".repeat(40));
    let check = |m: &str, table: &str| {
        assert!(
            m.contains("violates check constraint") && m.contains(table),
            "{m}"
        )
    };

    // ---- population row guards and derived-completeness CHECKs
    let population = |cols: &str, doc: &str| {
        copy(
            "assessment_populations",
            &format!(
                "jsonb_build_object('id','{p2}','invocation_id','{inv4}') || {cols} || jsonb_build_object('document', t.document || jsonb_build_object('id','{p2}','invocation_id','{inv4}') || {doc})"
            ),
            "t.document->>'key'='ap'",
        )
    };
    let both = |pairs: &str| population(pairs, pairs);
    let none = "'{}'::jsonb";
    for (statement, expected) in [
        (both("jsonb_build_object('exhaustive',false)"), None),
        (both("jsonb_build_object('last_row',t.last_row+1)"), None),
        (both("jsonb_build_object('declared_count',1251)"), None),
        (both("jsonb_build_object('job_id',NULL)"), None),
        (
            both(&format!("jsonb_build_object('job_id','{low_job}')")),
            Some(
                "a population names the enumeration job that read its sheet, header row and columns",
            ),
        ),
        (
            both(&format!(
                "jsonb_build_object('original_sha256','{}')",
                "f".repeat(64)
            )),
            Some("a population reads a registered original by its digest"),
        ),
        (
            both(&format!(
                "jsonb_build_object('basis_id','basis-{}')",
                "f".repeat(40)
            )),
            Some("a population belongs to a basis of its own Task"),
        ),
        (
            both(&format!(
                "jsonb_build_object('supersedes','pop-{}')",
                "1".repeat(40)
            )),
            Some("a population version succeeds one of its own Task"),
        ),
        (
            both("jsonb_build_object('methodology_binding_id','another-binding')"),
            Some("a coverage record belongs to its answer invocation and its binding"),
        ),
    ] {
        let message = refused_in(&mut tx, &statement).await;
        match expected {
            Some(words) => assert_refused(&message, words, &statement),
            None => check(&message, "assessment_populations"),
        }
    }
    assert_eq!(accepted_in(&mut tx, &population(none, none)).await, 1);

    // ---- members: one bad row in a copy of all 1,256
    let members = |cond: &str, cols: &str, doc: &str| {
        copy(
            "assessment_population_members",
            &format!(
                "jsonb_build_object('population_id','{p2}','document', t.document || jsonb_build_object('population_id','{p2}') || CASE WHEN {cond} THEN {doc} ELSE '{{}}'::jsonb END) || CASE WHEN {cond} THEN {cols} ELSE '{{}}'::jsonb END"
            ),
            &format!("t.population_id='{ap}'"),
        )
    };
    let duplicate = text_of(&mut tx, &format!("SELECT min(ordinal)::text FROM public.assessment_population_members WHERE population_id='{ap}' AND disposition='duplicate_row'")).await;
    for (statement, words) in [
        (
            members(
                "t.ordinal=0",
                "jsonb_build_object('ordinal',1256)",
                "jsonb_build_object('ordinal',1256)",
            ),
            "a member is a received row of a population of its own Task",
        ),
        (
            members(
                "t.ordinal=5",
                "jsonb_build_object('task_id','task-other')",
                none,
            ),
            "a member is a received row of a population of its own Task",
        ),
        (
            members(
                &format!("t.ordinal={duplicate}"),
                "jsonb_build_object('duplicate_of',0)",
                "jsonb_build_object('duplicate_of',0)",
            ),
            "a duplicate row collapses into the first row of its subject",
        ),
    ] {
        assert_refused(&refused_in(&mut tx, &statement).await, words, &statement);
    }
    assert_eq!(
        accepted_in(&mut tx, &members("false", none, none)).await,
        1256
    );

    // ---- a sample and its selected items
    let sample = |cols: &str| {
        copy(
            "assessment_samples",
            &format!(
                "jsonb_build_object('id','{s2}','invocation_id','{inv1}','document', t.document || jsonb_build_object('id','{s2}','invocation_id','{inv1}')) || {cols}"
            ),
            &format!("t.id='{s1}'"),
        )
    };
    let statement = sample(&format!(
        "jsonb_build_object('population_id','pop-{}')",
        "2".repeat(40)
    ));
    assert_refused(
        &refused_in(&mut tx, &statement).await,
        "a sample selects from a population of its own Task",
        &statement,
    );
    assert_eq!(accepted_in(&mut tx, &sample(none)).await, 1);
    let selected = |cond: &str, bad: &str| {
        copy(
            "assessment_sample_members",
            &format!(
                "jsonb_build_object('sample_id','{s2}') || CASE WHEN {cond} THEN {bad} ELSE '{{}}'::jsonb END"
            ),
            &format!("t.sample_id='{s1}'"),
        )
    };
    for statement in [
        selected(
            "t.ordinal=0",
            "jsonb_build_object('member_ordinal',0,'subject','INV-00001')",
        ),
        selected("t.ordinal=3", "jsonb_build_object('ordinal',25)"),
    ] {
        assert_refused(
            &refused_in(&mut tx, &statement).await,
            "a selected item is an in-scope member of the sampled population",
            &statement,
        );
    }
    assert_eq!(accepted_in(&mut tx, &selected("false", none)).await, 25);

    // ---- opportunities over the copied population
    let (criterion, ordinal): (String, i32) = sqlx::query_as(&format!("SELECT criterion_id,member_ordinal FROM public.assessment_opportunities WHERE population_id='{ap}' AND verdict='met' ORDER BY 1,2 LIMIT 1"))
        .fetch_one(&mut *tx)
        .await
        .unwrap();
    let k = format!("t.criterion_id='{criterion}' AND t.member_ordinal={ordinal}");
    let opportunities = |cond: &str, bad: &str, filter: &str| {
        copy(
            "assessment_opportunities",
            &format!(
                "jsonb_build_object('population_id','{p2}','inputs', replace(t.inputs::text,'{ap}','{p2}')::jsonb) || CASE WHEN {cond} THEN {bad} ELSE '{{}}'::jsonb END"
            ),
            &format!("t.population_id='{ap}' AND {filter}"),
        )
    };
    for (statement, words) in [
        (
            opportunities(
                &k,
                "jsonb_build_object('member_ordinal',0,'subject','INV-00001')",
                "true",
            ),
            "an opportunity is one in-scope member of its population",
        ),
        (
            opportunities(&k, "jsonb_build_object('task_id','task-other')", "true"),
            "an opportunity reads a criterion of its population's basis in its own Task",
        ),
        (
            opportunities(
                &k,
                &format!(
                    "jsonb_build_object('inputs', replace(replace(t.inputs::text,'{ap}','{p2}'),'{p2}#'||t.member_ordinal||'/','{p2}#99999/')::jsonb)"
                ),
                "true",
            ),
            "a rule opportunity reads only its member's own cells",
        ),
        (
            opportunities(&k, "jsonb_build_object('inputs','[]'::jsonb)", "true"),
            "a decided verdict reads its facts",
        ),
    ] {
        assert_refused(&refused_in(&mut tx, &statement).await, words, &statement);
    }
    // A summary reads every opportunity: with one missing it is refused (B),
    // so no opportunity can be missing once a population is summarised.
    let summary = copy(
        "assessment_summaries",
        &format!(
            "jsonb_build_object('id','summary-{e}','invocation_id','{inv4}','ordinal',1,'population_id','{p2}','document', t.document || jsonb_build_object('id','summary-{e}','invocation_id','{inv4}','ordinal',1,'population_id','{p2}'))",
            e = "e".repeat(40)
        ),
        &format!("t.population_id='{ap}' AND t.sample_id IS NULL"),
    );
    sqlx::query("SAVEPOINT partial")
        .execute(&mut *tx)
        .await
        .unwrap();
    accepted_in(
        &mut tx,
        &opportunities("false", none, &format!("NOT ({k})")),
    )
    .await;
    assert_refused(
        &refused_in(&mut tx, &summary).await,
        "a summary reads every opportunity of every criterion of its basis",
        &summary,
    );
    sqlx::query("ROLLBACK TO SAVEPOINT partial")
        .execute(&mut *tx)
        .await
        .unwrap();
    let all: i64 = sqlx::query_scalar(&format!(
        "SELECT count(*) FROM public.assessment_opportunities WHERE population_id='{ap}'"
    ))
    .fetch_one(&mut *tx)
    .await
    .unwrap();
    assert_eq!(
        accepted_in(&mut tx, &opportunities("false", none, "true")).await as i64,
        all
    );
    // With every opportunity the same summary is accepted: the database
    // recounts exactly the stored rows of the copied population.
    assert_eq!(accepted_in(&mut tx, &summary).await, 1);
    tx.rollback().await.unwrap();

    // ---- the deferred count guards, refused at COMMIT
    let mut tx = conn.begin().await.unwrap();
    if as_owner {
        sqlx::query("SELECT set_config('zobba.organisation_id','org-a',true),set_config('zobba.client_id','client-a',true),set_config('zobba.engagement_id','engagement-a',true),set_config('zobba.actor_id','actor-a',true)")
            .execute(&mut *tx)
            .await
            .unwrap();
    }
    accepted_in(&mut tx, &population(none, none)).await;
    accepted_in(&mut tx, &copy(
        "assessment_population_members",
        &format!("jsonb_build_object('population_id','{p2}','document', t.document || jsonb_build_object('population_id','{p2}'))"),
        &format!("t.population_id='{ap}' AND t.ordinal < 1255"),
    )).await;
    let message = tx
        .commit()
        .await
        .expect_err("a population one member short")
        .to_string();
    assert_refused(
        &message,
        "a population holds exactly its counted members",
        "commit",
    );
    let mut tx = conn.begin().await.unwrap();
    if as_owner {
        sqlx::query("SELECT set_config('zobba.organisation_id','org-a',true),set_config('zobba.client_id','client-a',true),set_config('zobba.engagement_id','engagement-a',true),set_config('zobba.actor_id','actor-a',true)")
            .execute(&mut *tx)
            .await
            .unwrap();
    }
    accepted_in(&mut tx, &sample(none)).await;
    accepted_in(
        &mut tx,
        &copy(
            "assessment_sample_members",
            &format!("jsonb_build_object('sample_id','{s2}')"),
            &format!("t.sample_id='{s1}' AND t.ordinal < 24"),
        ),
    )
    .await;
    let message = tx
        .commit()
        .await
        .expect_err("a sample one item short")
        .to_string();
    assert_refused(
        &message,
        "a sample holds exactly its selected items",
        "commit",
    );
}
