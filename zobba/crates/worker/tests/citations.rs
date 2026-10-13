//! Story 22.5 proof: the production work coordinator with the trusted reading
//! composition, real PostgreSQL custody, real S3-protocol evidence objects, the
//! TEST-ONLY Docker sandbox running the trusted document program and the
//! model's analysis program in the pinned general image, a native OpenAI
//! loopback provider (never a live provider), and the real cited-answer API.
//! Requires a guarded `_test` database, the OIDC fixture environment and a
//! Docker engine with the pinned image; it fails, never skips, without them.
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
/// One account carries both the model disclosure (Send) and the analysis
/// sandbox (Write); originals are trusted material of its source.
fn source() -> SourceBinding {
    SourceBinding {
        source_id: "analysis-sandbox".into(),
        ledger_id: "analysis-ledger".into(),
        endpoint_digest: "a".repeat(64),
        contract_version: 1,
    }
}
fn disclosure() -> CanonicalOperation {
    let material = "Synthetic cited reading";
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

/// A loopback provider answering requests with `replies` in order (the last
/// repeats), recording each complete request body.
struct Loopback {
    endpoint: String,
    sends: Arc<AtomicUsize>,
    bodies: Arc<std::sync::Mutex<Vec<String>>>,
    _task: tokio::task::JoinHandle<()>,
}
impl Loopback {
    async fn answering(replies: Vec<Vec<u8>>) -> Self {
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
                            seen.lock().unwrap().push(
                                String::from_utf8_lossy(&buffer[end + 4..end + 4 + length])
                                    .into_owned(),
                            );
                            count.fetch_add(1, Ordering::SeqCst);
                            break;
                        }
                    }
                }
                let index = count.load(Ordering::SeqCst).saturating_sub(1);
                let reply = replies.get(index).or(replies.last()).unwrap();
                let _ = socket.write_all(reply).await;
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

fn sse_reply(mut values: Vec<serde_json::Value>) -> Vec<u8> {
    for (sequence, value) in values.iter_mut().enumerate() {
        value["sequence_number"] = serde_json::json!(sequence);
    }
    let body: String = values
        .iter()
        .map(|v| format!("event: {}\r\ndata: {v}\r\n\r\n", v["type"].as_str().unwrap()))
        .collect();
    format!(
        "HTTP/1.1 200 Fixture\r\nContent-Type: text/event-stream; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
    .into_bytes()
}
/// A native OpenAI-format streamed text answer; structured output is its JSON.
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

fn src(original: &str, locator: &str, quote: &str) -> serde_json::Value {
    serde_json::json!({"original_id": original, "locator": locator, "quote": quote})
}
fn segment(text: &str, sources: Vec<serde_json::Value>) -> serde_json::Value {
    serde_json::json!({"text": text, "sources": sources})
}

const PROGRAM: &str = "import openpyxl\nbook = openpyxl.load_workbook(open('/input/trial-balance', 'rb'), data_only=True)\nopen('/output/total.txt', 'w').write(f\"Total {book['Sheet1']['B4'].value}\\n\")\n";

/// The model's first answer asks to read a scanned page natively, a page past
/// the end of a PDF, and to run its own analysis program.
fn first_answer() -> String {
    serde_json::json!({
        "segments": [segment("I will read the scanned letter and total the trial balance.", vec![])],
        "limitations": [],
        "read_pages": [
            {"original_id": "scan", "page": 3},
            {"original_id": "contract-pdf", "page": 9},
        ],
        "programs": [{"program": PROGRAM, "inputs": ["trial-balance"]}],
    })
    .to_string()
}
/// The final cited answer: one segment per matrix row.
fn final_answer() -> (String, Vec<&'static str>) {
    let segments = vec![
        ("The trial balance total is 1,250.00.", vec![src("trial-balance", "cell:Sheet1!B4", "1,250.00")]),
        (" Receivables are 500.00.", vec![src("trial-balance", "cell:Sheet1!B3", "500.00")]),
        (
            " Payment is due within 30 days.",
            vec![
                src("contract-docx", "paragraph:2", "Payment is due within 30 days"),
                src("email", "part:1", "payment within 30 days"),
                src("contract-pdf", "page:2", "Payment is due within 30 days."),
            ],
        ),
        (" The fee is 1,250.00.", vec![src("contract-docx", "table:1:1:2", "1,250.00")]),
        (" The letter is signed.", vec![src("scan", "page:3", "Signed by A. Auditor")]),
        (" The email is about payment terms.", vec![src("email", "header:Subject", "Payment terms")]),
        (" The notes agree the balance.", vec![src("notes", "bytes:16-24", "1,250.00")]),
        (" No location was given here.", vec![src("contract-pdf", "", "Payment terms")]),
        (" The oversized workbook could not be checked.", vec![src("zip-bomb", "cell:Sheet1!A1", "anything")]),
        (" The encrypted workbook could not be checked.", vec![src("encrypted", "cell:Sheet1!A1", "anything")]),
        (" An unregistered source is cited.", vec![src("not-registered", "page:1", "secret quote")]),
        (" This closing sentence is not cited.", vec![]),
    ];
    let texts = segments.iter().map(|(t, _)| *t).collect();
    let answer = serde_json::json!({
        "segments": segments.into_iter().map(|(t, s)| segment(t, s)).collect::<Vec<_>>(),
        "limitations": ["Page 9 of the contract does not exist."],
        "read_pages": [],
        "programs": [],
    });
    (answer.to_string(), texts)
}

async fn register(
    admin: &mut PgConnection,
    objects: &S3EvidenceObjects,
    id: &str,
    filename: &str,
) -> String {
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
    digest
}

async fn image_present() {
    let image = format!("{REPOSITORY}@{GENERAL_IMAGE_DIGEST}");
    let present = tokio::process::Command::new("docker")
        .args(["image", "inspect", &image])
        .output()
        .await
        .expect("a Docker engine is required for the reading fixtures")
        .status
        .success();
    if !present {
        let pulled = tokio::process::Command::new("docker")
            .args(["pull", &image])
            .status()
            .await
            .unwrap()
            .success();
        assert!(pulled, "the pinned general image {image} must be available");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn cited_answers_are_read_and_verified_against_exact_originals() {
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
    for (id, filename) in [
        ("trial-balance", "Trial balance.xlsx"),
        ("contract-docx", "Contract.docx"),
        ("contract-pdf", "Contract.pdf"),
        ("scan", "Scanned letter.pdf"),
        ("email", "Payment terms.eml"),
        ("notes", "Notes.txt"),
        ("zip-bomb", "Zip bomb.xlsx"),
        ("encrypted", "Encrypted.xlsx"),
    ] {
        register(&mut admin, &objects, id, filename).await;
    }

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
    let profile = ModelProfile {
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
            image_input: true,
        },
        max_output_tokens: 4_096,
    };
    models
        .save_profile("actor-manager", "org-a", &profile)
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

    let tasks = TaskRepository::new(pool.clone());
    let receipt = tasks
        .admit(
            "actor-a",
            &scope(),
            &TaskCommand {
                context: None,
                key: "cited-reading".into(),
                kind: CommandKind::Create,
                task_id: None,
                cycle_id: None,
                content: Some("Agree the trial balance and payment terms to the originals".into()),
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

    let (final_text, final_segments) = final_answer();
    let provider = Loopback::answering(vec![
        text_reply(&first_answer()),
        text_reply(r#"{"text":"Signed by A. Auditor","unreadable":[]}"#),
        text_reply(&final_text),
    ])
    .await;
    let unused = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let gateway_address = unused.local_addr().unwrap();
    let staging = std::env::temp_dir().join(format!("zobba-citations-{}", std::process::id()));
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
            // No tool is catalogued; the gateway is composed but never dispatches.
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
    });
    let config = executor::Config::new(std::path::PathBuf::from("/bin/false"), 10).unwrap();
    let (stop, shutdown) = tokio::sync::watch::channel(false);
    // The production coordinator: it renews the Task's owner lease beside the
    // loop for the whole reading cycle.
    let worker = tokio::spawn(zobba_worker::coordinate_work(
        database.clone(),
        config,
        runner,
        shutdown,
    ));
    let deadline = Instant::now() + Duration::from_secs(300);
    loop {
        let verified: i64 = sqlx::query_scalar("SELECT count(*) FROM public.answer_verifications")
            .fetch_one(&mut admin)
            .await
            .unwrap();
        let task = tasks
            .get("actor-a", &scope(), &receipt.task_id)
            .await
            .unwrap();
        if verified == 2 && task.state == TaskState::Waiting {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "the cited cycle did not settle: {verified} verified, Task {:?}",
            task.state
        );
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    assert_eq!(
        provider.sends.load(Ordering::SeqCst),
        3,
        "two answer turns and exactly one native page read"
    );

    // One page per request: only the page read carries an image, and exactly one.
    let bodies = provider.bodies.lock().unwrap().clone();
    let images: Vec<usize> = bodies
        .iter()
        .map(|b| b.matches("\"input_image\"").count())
        .collect();
    assert_eq!(images, [0, 1, 0], "no whole document is sent in any request");
    assert!(bodies[1].contains("data:image/png;base64,"));
    std::fs::write(std::env::temp_dir().join("zobba-citations-turn2.json"), &bodies[2]).unwrap();
    assert!(
        bodies[2].contains("Signed by A. Auditor") && bodies[2].contains("Total 1250"),
        "the next turn reads the transcription and the program's validated output"
    );

    // The native read and the page past the end are recorded facts.
    let reads: Vec<(String, i32, String, Option<String>, Option<String>, Option<String>)> =
        sqlx::query_as("SELECT original_id,page,status,reason,image_sha256,invocation_id FROM public.task_page_reads ORDER BY original_id,page")
            .fetch_all(&mut admin)
            .await
            .unwrap();
    assert_eq!(reads.len(), 2, "{reads:?}");
    assert_eq!(
        (reads[0].0.as_str(), reads[0].1, reads[0].2.as_str(), reads[0].3.as_deref()),
        ("contract-pdf", 9, "failed", Some("page_not_found"))
    );
    assert_eq!((reads[1].0.as_str(), reads[1].1, reads[1].2.as_str()), ("scan", 3, "read"));
    let image = reads[1].4.clone().unwrap();
    let page_invocation = reads[1].5.clone().unwrap();
    // Exactly one disclosure operation covers this page image digest.
    let requests: Vec<(String, serde_json::Value)> =
        sqlx::query_as("SELECT id,request FROM public.model_invocations")
            .fetch_all(&mut admin)
            .await
            .unwrap();
    let covering: Vec<&String> = requests
        .iter()
        .filter(|(_, request)| {
            request["disclosure"]["attachments"]
                .as_array()
                .unwrap()
                .iter()
                .any(|a| a["id"] == "page-image" && a["digest"] == image.as_str())
        })
        .map(|(id, _)| id)
        .collect();
    assert_eq!(covering, [&page_invocation]);
    let attachment = requests
        .iter()
        .find(|(id, _)| *id == page_invocation)
        .unwrap()
        .1["disclosure"]["attachments"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["id"] == "page-image")
        .unwrap()
        .clone();
    assert_eq!(attachment["classification"], "audit", "the original's classification");
    assert!(
        !requests.iter().any(|(_, r)| r.to_string().contains("iVBORw0KGgo")),
        "image bytes are never stored in the request"
    );
    // The program ran once in the sandbox; its output reached the next turn.
    let programs: Vec<(String, Option<String>)> =
        sqlx::query_as("SELECT status,reason FROM public.task_program_runs")
            .fetch_all(&mut admin)
            .await
            .unwrap();
    assert_eq!(programs, [("completed".to_string(), None)]);

    // The cited-answer API: verification results with the answer unchanged.
    let token = identities
        .establish_session(ISSUER, "auditor-a", "Alex", None)
        .await
        .unwrap();
    let auth = zobba_api::auth::AuthState::from_environment(&database).unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = format!("http://{}", listener.local_addr().unwrap());
    let app = zobba_api::authenticated_router(database.clone(), auth);
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let client = reqwest_fixture::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .unwrap();
    let response = client
        .get(format!(
            "{address}/engagements/engagement-a/tasks/{}/answers?organisation_id=org-a&client_id=client-a",
            receipt.task_id
        ))
        .header("Cookie", format!("__Host-zobba-session={token}"))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status().as_u16(), 200);
    let body: serde_json::Value = serde_json::from_slice(&response.bytes().await.unwrap()).unwrap();
    let answers = body["answers"].as_array().unwrap();
    assert_eq!(answers.len(), 2);
    let last = &answers[1];
    assert_eq!(last["text"], final_segments.concat(), "the answer text is unchanged");
    let segments = last["segments"].as_array().unwrap();
    let results: Vec<Vec<(String, Option<String>)>> = segments
        .iter()
        .map(|s| {
            s["sources"]
                .as_array()
                .unwrap()
                .iter()
                .map(|source| {
                    (
                        source["verification"].as_str().unwrap().to_string(),
                        source["reason"].as_str().map(String::from),
                    )
                })
                .collect()
        })
        .collect();
    let v = || ("verified".to_string(), None);
    let u = |reason: &str| ("unverified".to_string(), Some(reason.to_string()));
    assert_eq!(
        results,
        vec![
            vec![v()],
            vec![u("not_found_at_location")],
            vec![v(), v(), v()],
            vec![v()],
            vec![u("page_only")],
            vec![v()],
            vec![v()],
            vec![u("location_missing")],
            vec![u("source_unreadable")],
            vec![u("source_unreadable")],
            vec![u("source_unreadable")],
            vec![],
        ],
        "{segments:#?}"
    );
    // Navigation names the exact original; an unreadable source discloses nothing.
    let cell = &segments[0]["sources"][0];
    assert_eq!(cell["location"], "Sheet1!B4");
    assert_eq!(cell["filename"], "Trial balance.xlsx");
    assert_eq!(
        cell["sha256"],
        sha(&std::fs::read(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../fixtures/documents/Trial balance.xlsx")
        )
        .unwrap())
    );
    assert!(cell["version"].is_string());
    let bytes = &segments[6]["sources"][0];
    assert_eq!((bytes["byte_start"].as_u64(), bytes["byte_end"].as_u64()), (Some(16), Some(24)));
    let hidden = &segments[10]["sources"][0];
    assert_eq!(hidden["readable"], false);
    assert!(hidden["quote"].is_null() && hidden["filename"].is_null() && hidden["version"].is_null());
    assert!(!body.to_string().contains("secret quote"));
    assert_eq!(last["limitations"][0], "Page 9 of the contract does not exist.");
    // Without a session nothing is returned.
    let anonymous = client
        .get(format!(
            "{address}/engagements/engagement-a/tasks/{}/answers?organisation_id=org-a&client_id=client-a",
            receipt.task_id
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(anonymous.status().as_u16(), 401);
    server.abort();

    database_guards_refuse_altered_reading_facts(&mut admin).await;

    stop.send(true).unwrap();
    let _ = tokio::time::timeout(Duration::from_secs(15), worker).await;
    zobba_infrastructure::analysis::docker::remove_all_test_resources().await;
    let _ = std::fs::remove_dir_all(&staging);
    s3.stop().await;
}

/// Even a privileged connection cannot rewrite or add reading facts.
async fn database_guards_refuse_altered_reading_facts(admin: &mut PgConnection) {
    for statement in [
        "UPDATE public.citation_sources SET verification='verified', reason=NULL",
        "UPDATE public.task_page_reads SET status='read'",
        "UPDATE public.document_pages SET text_layer='forged'",
        "DELETE FROM public.answer_verifications",
        "INSERT INTO public.task_page_reads SELECT * FROM public.task_page_reads WHERE status='read'",
        "INSERT INTO public.answer_citations(organisation_id,client_id,engagement_id,invocation_id,segment,span_start,span_end) SELECT organisation_id,client_id,engagement_id,invocation_id,63,0,1 FROM public.answer_verifications LIMIT 1",
    ] {
        let mut tx = admin.begin().await.unwrap();
        let refused = sqlx::query(statement).execute(&mut *tx).await;
        assert!(refused.is_err(), "{statement} was accepted");
        tx.rollback().await.unwrap();
    }
}
