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
                // Turn 6: the answer.
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
    settle(&tasks, &provider, &receipt.task_id, 6).await;
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
    let populations: Vec<(String, String, Option<String>, String, i32, i32, i32, i32, i32, Option<i32>)> = sqlx::query_as(
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
    let rows: Vec<(String, String, Option<String>, String, Vec<Option<i32>>)> = raw
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
    assert_eq!(rows.len(), 4, "{rows:#?}");
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
    // Zero applicable: not a pass.
    assert_eq!(
        (rows[1].0.as_str(), rows[1].4[9], rows[1].4[7]),
        ("no_eligible_items", Some(20), Some(0))
    );
    // A filtered export: absence is not proven.
    assert_eq!(rows[2].0, "no_items_found_absence_not_proven");
    // The sample: 25 selected items, never a population conclusion.
    assert_eq!(rows[3].4[5], Some(25));
    assert_ne!(rows[3].0, "no_exception_found");
    let (selected, inference): (i64, bool) = sqlx::query_as("SELECT (SELECT count(*) FROM public.assessment_sample_members),(SELECT bool_or(statistical_inference) FROM public.assessment_summaries)")
        .fetch_one(&mut admin)
        .await
        .unwrap();
    assert_eq!((selected, inference), (25, false));

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
        (Some("4"), Some("4"))
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

    database_guards_refuse_altered_coverage_records(&mut admin, &mut owner, &pool).await;

    stop.send(true).unwrap();
    worker.await.unwrap();
    server.abort();
    zobba_infrastructure::analysis::docker::remove_all_test_resources().await;
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
    let id = format!("summary-{:040x}", 0xf00du32);
    let mut document = format!(
        "jsonb_set(jsonb_set(s.document,'{{id}}',to_jsonb('{id}'::text)),'{{ordinal}}','1')"
    );
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
    for (column, path, value) in sets {
        document = format!("jsonb_set({document},'{{summary,{path}}}','{value}')");
        if let Some(entry) = columns.iter_mut().find(|(c, _)| c == column) {
            entry.1 = if value.starts_with('"') {
                format!("'{}'", value.trim_matches('"'))
            } else {
                (*value).to_string()
            };
        }
    }
    let names: Vec<&str> = columns.iter().map(|(c, _)| *c).collect();
    let values: Vec<String> = columns.iter().map(|(_, v)| v.clone()).collect();
    format!(
        "INSERT INTO public.assessment_summaries({},ordinal,id,document) SELECT {},1,'{id}',{document} FROM public.assessment_summaries s WHERE s.sample_id IS NULL AND s.received_rows=1256 AND s.ordinal=0",
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
    let cases: Vec<(String, &str)> = vec![
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
    for (statement, expected) in &cases {
        assert_refused(&refused(admin, statement).await, expected, statement);
    }
    // Positive control: the unaltered copy reaches the uniqueness of one
    // summary per population, not a count guard.
    let copy = forged_summary(&[]);
    let message = refused(admin, &copy).await;
    assert!(!message.contains("a summary count"), "{message}");
}
