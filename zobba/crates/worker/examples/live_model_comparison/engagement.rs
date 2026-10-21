//! The one fixed synthetic engagement and audit Task, set up the same way for
//! every run (copied from `crates/worker/tests/work_product.rs`, which stays
//! untouched): the same disposable `_test` database reset, the same uploaded
//! documents, the same firm method, criteria and template, the same Task
//! objective and the same continuation guidance. Then the real worker
//! coordinator runs the Task, and the real authenticated API exports it.
use sha2::{Digest, Sha256};
use sqlx::{Connection, Executor, PgConnection};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::net::TcpListener;
use zobba_application::{
    analysis::{AnalysisSettings, AnalysisTarget},
    evidence::EvidenceObjects,
    methodology::{MethodologyStore, SaveMethodology},
    model::{Capabilities, ModelProfile, ModelQualificationSource, Qualification, ToolCatalog},
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
    task::{CommandKind, CommandReceipt, TaskCommand, TaskState},
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
    model::ModelRepository,
    operation::OperationRepository,
    task::TaskRepository,
};
use zobba_worker::{
    executor,
    gateway::Gateway,
    work::{Composition, ReadingComposition},
};

use crate::config::{Mode, RunPlan};
use crate::meter::{Meter, Metered, StopReason};
use crate::qualification::{FIXTURE_CAPABILITY_REVISION, LIVE_CAPABILITY_REVISION};

const REPOSITORY: &str = "127.0.0.1:5000/zobba/analysis-general";
const NAMESPACE: &str = "6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e";
pub const ISSUER: &str = "https://127.0.0.1:4443";
const SCOPE_QUERY: &str = "organisation_id=org-a&client_id=client-a";

/// The Task objective, identical for every run.
pub const OBJECTIVE: &str = "Audit the 2026 accounts payable approvals and write the working paper.
1. Test every 2026 invoice of the AP population export (AP population.xlsx) against the firm method AP-1: an invoice above 1,000.00 USD needs an approval, and the approval must come before payment.
2. For the AP invoice listing (AP invoices.xlsx), check that every invoice above 1,000.00 USD has an approver, and use the approval roles document (AP approval roles 2026.txt) to test segregation of duties under AP-2: the approver must not be the person who requested the invoice.
3. Record the working paper on the firm template AP working paper FY2026 (objective, results and conclusion), state every figure in a checked claim that cites its record, and list the limitations of the evidence.";

/// The guidance the harness gives when a cycle ends without a recorded work
/// product, identical for every run and every round.
pub const CONTINUE_GUIDANCE: &str = "Continue the Task. Finish the testing the objective asks for, then record the working paper on the firm template ap-wp:1 with its objective, results and conclusion sections completed. State every figure in a checked claim that cites its record, and correct every block the platform refused.";

/// The documents of the engagement: (original ID, file).
pub fn documents(repo: &Path, harness: &Path) -> Vec<(&'static str, PathBuf)> {
    let fixtures = repo.join("zobba/fixtures/documents");
    vec![
        ("ap-population", fixtures.join("AP population.xlsx")),
        ("ap-invoices", fixtures.join("AP invoices.xlsx")),
        ("ap-policy", fixtures.join("AP policy.txt")),
        ("ap-roles", harness.join("fixtures").join(crate::truth::ROLES_FILE)),
    ]
}

pub fn scope() -> Scope {
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
pub fn sha(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn source() -> SourceBinding {
    SourceBinding {
        source_id: "analysis-sandbox".into(),
        ledger_id: "analysis-ledger".into(),
        endpoint_digest: "a".repeat(64),
        contract_version: 1,
    }
}
/// The disclosure template: the model provider is the destination, bound to
/// the run's (non-secret) account label.
fn disclosure(account: &str, destination: &str) -> CanonicalOperation {
    let material = "Synthetic method investigation";
    CanonicalOperation {
        version: 1,
        purpose: Purpose::AuditCoordination,
        action: Action::Send,
        account_id: account.into(),
        environment_id: "audit-environment".into(),
        destination: destination.into(),
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
fn target(account: &str) -> AnalysisTarget {
    AnalysisTarget {
        account_id: account.into(),
        environment_id: "audit-environment".into(),
        destination: "analysis-sandbox".into(),
        resource_id: "analysis-resource".into(),
        resource_version: "v1".into(),
        classification: "audit".into(),
        lifetime_seconds: 3_600,
    }
}
fn policy(kind: PolicyKind, subject: &str, account: &str, destination: &str) -> PolicyDocument {
    let d = disclosure(account, destination);
    let t = target(account);
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
            account_id: account.into(),
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

/// A firm AP method: AP-1 (approval, before payment) and AP-2 (segregation
/// of duties), and the one working-paper template both requirements bind.
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
                 "evidence_checks":null,"ratings":null,"templates":[{"id":"ap-wp","version":"1"}],"review_rules":null,"suitable_skills":null},
                {"id":"AP-2","label":"Segregation of duties","mandatory":true,
                 "criteria":["The approver of an invoice is not the person who requested it"],"populations":["AP invoices"],
                 "evidence_checks":null,"ratings":null,"templates":[{"id":"ap-wp","version":"1"}],"review_rules":null,"suitable_skills":null}
            ]},
        "source": {"kind":"authored","reference":null,"note":"Synthetic AP method for the model comparison"}
    }))
    .unwrap()
}

async fn image_present() {
    let image = format!("{REPOSITORY}@{GENERAL_IMAGE_DIGEST}");
    let present = tokio::process::Command::new("docker")
        .args(["image", "inspect", &image])
        .output()
        .await
        .expect("a Docker engine is required for the analysis sandbox")
        .status
        .success();
    assert!(present, "the pinned general image {image} must be available");
}

async fn register(admin: &mut PgConnection, objects: &S3EvidenceObjects, id: &str, path: &Path) {
    let bytes = std::fs::read(path).unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
    let filename = path.file_name().unwrap().to_str().unwrap().to_string();
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

pub struct Engagement {
    pub database: RuntimeDatabase,
    pub pool: sqlx::PgPool,
    /// The fixture admin role: scoring reads only, never writes.
    pub lookup: sqlx::PgPool,
    pub s3: crate::s3_protocol::Fixture,
    pub objects: Arc<S3EvidenceObjects>,
    pub identities: IdentityRepository,
    pub tasks: TaskRepository,
    pub receipt: CommandReceipt,
    pub staging: PathBuf,
    _gateway_listener: TcpListener,
}
impl Engagement {
    pub fn task_id(&self) -> &str {
        &self.receipt.task_id
    }
    pub fn store(&self) -> S3EvidenceObjects {
        S3EvidenceObjects::new(
            crate::s3_protocol::build_fixture_store(&self.s3.endpoint).unwrap(),
            NAMESPACE.into(),
        )
        .unwrap()
    }
}

/// Reset the disposable `_test` database and build the engagement. Panics on
/// any setup failure: nothing has been sent to a provider yet.
pub async fn prepare(plan: &RunPlan, repo: &Path, harness: &Path) -> Engagement {
    image_present().await;
    zobba_infrastructure::analysis::docker::remove_all_test_resources().await;
    let configuration = crate::support::Configuration::from_environment();
    let mut owner = PgConnection::connect(&configuration.migration).await.unwrap();
    configuration.guard_connection(&mut owner).await;
    owner
        .execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public; REVOKE CREATE ON SCHEMA public FROM PUBLIC")
        .await
        .unwrap();
    migrate(
        &configuration.migration,
        database_options(&configuration.runtime).unwrap().get_username(),
    )
    .await
    .unwrap();
    seed_local_configured(ISSUER, &configuration.migration).await.unwrap();
    let mut admin = PgConnection::connect(&configuration.admin).await.unwrap();
    configuration.guard_connection(&mut admin).await;
    let lookup = sqlx::PgPool::connect(&configuration.admin).await.unwrap();
    let database = RuntimeDatabase::connect(&configuration.runtime).await.unwrap();
    let pool = database.pool().clone();

    let s3 = crate::s3_protocol::Fixture::start().await;
    let objects = Arc::new(
        S3EvidenceObjects::new(
            crate::s3_protocol::build_fixture_store(&s3.endpoint).unwrap(),
            NAMESPACE.into(),
        )
        .unwrap(),
    );
    for (id, path) in documents(repo, harness) {
        register(&mut admin, &objects, id, &path).await;
    }

    let (account, destination) = (plan.account.as_str(), plan.destination.as_str());
    let operations = OperationRepository::new(pool.clone());
    let organisation = policy(PolicyKind::Organisation, "org-a", account, destination);
    let engagement = policy(PolicyKind::Engagement, "engagement-a", account, destination);
    let member = policy(PolicyKind::Member, "actor-a", account, destination);
    let account_policy = policy(PolicyKind::Account, account, account, destination);
    for document in [&organisation, &engagement, &member, &account_policy] {
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
    let models = ModelRepository::new(pool.clone()).with_session_hash(secret_hash(&manager_session));
    let (qualification, capability_revision) = match plan.mode {
        Mode::Scripted => (Qualification::Fixture, FIXTURE_CAPABILITY_REVISION),
        Mode::Live => (Qualification::Live, LIVE_CAPABILITY_REVISION),
    };
    models
        .save_profile(
            "actor-manager",
            "org-a",
            &ModelProfile {
                id: "comparison".into(),
                revision: 1,
                provider: plan.provider,
                model: plan.model.clone(),
                destination: plan.destination.clone(),
                account_id: plan.account.clone(),
                capability_revision: capability_revision.into(),
                qualification,
                enabled: true,
                capabilities: Capabilities {
                    tools: false,
                    structured_output: true,
                    reasoning: plan.openai_reasoning,
                    image_input: false,
                },
                max_output_tokens: plan.max_output_tokens,
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
    MethodologyRepository::new(pool.clone())
        .with_session_hash(secret_hash(&manager_session))
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
                key: "comparison-create".into(),
                kind: CommandKind::Create,
                task_id: None,
                cycle_id: None,
                content: Some(OBJECTIVE.into()),
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
        account: account_policy,
        task: policy(PolicyKind::Task, &receipt.task_id, account, destination),
        delegations: vec![],
    };
    authority.task.actor_id = "actor-a".into();
    operations
        .accept_authority("actor-a", &scope(), &receipt.task_id, &authority)
        .await
        .unwrap();
    let staging = std::env::temp_dir().join(format!("zobba-model-comparison-{}", std::process::id()));
    Engagement {
        database,
        pool,
        lookup,
        s3,
        objects,
        identities,
        tasks,
        receipt,
        staging,
        _gateway_listener: TcpListener::bind("127.0.0.1:0").await.unwrap(),
    }
}

/// Start the production work coordinator with the trusted reading,
/// investigation and assessment composition, over the metered transport.
pub fn start_worker(
    e: &Engagement,
    plan: &RunPlan,
    transport: Arc<Metered>,
    qualifications: Arc<dyn ModelQualificationSource>,
) -> (tokio::sync::watch::Sender<bool>, tokio::task::JoinHandle<()>) {
    let gateway_address = e._gateway_listener.local_addr().unwrap();
    let runner: Arc<dyn zobba_worker::work::WorkRunner> = Arc::new(ReadingComposition {
        base: Composition {
            pool: e.pool.clone(),
            qualifications,
            transport,
            gateway: Gateway::qualification(
                gateway_address,
                SourceBinding {
                    endpoint_digest: sha(gateway_address.to_string().as_bytes()),
                    ..source()
                },
            )
            .unwrap(),
            disclosure: disclosure(&plan.account, &plan.destination),
            input_class: "audit".into(),
            max_output_tokens: plan.max_output_tokens,
            context: zobba_domain::context::ContextBudget::DEFAULT,
        },
        sandbox: Arc::new(DockerSandbox::explicit_test(REPOSITORY, &e.staging).unwrap()),
        objects: e.objects.clone(),
        allowlist: server_allowlist(),
        analysis_settings: SETTINGS,
        analysis: target(&plan.account),
        classification: "audit".into(),
        investigation: true,
        assessment: true,
    });
    let config = executor::Config::new(PathBuf::from("/bin/false"), 10).unwrap();
    let (stop, shutdown) = tokio::sync::watch::channel(false);
    let worker = tokio::spawn(zobba_worker::coordinate_work(
        e.database.clone(),
        config,
        runner,
        shutdown,
    ));
    (stop, worker)
}

enum Settle {
    Settled(TaskState),
    MeterStopped(StopReason),
    TimeLimit,
    Error(String),
}

/// The Task's cycle has ended: it waits (or is stopped), no model call is
/// in flight, and both stay so for three polls in a row.
async fn settle(tasks: &TaskRepository, task_id: &str, meter: &Meter, deadline: Instant) -> Settle {
    let mut stable = 0;
    loop {
        let snapshot = meter.snapshot();
        if let Some(reason) = snapshot.stop
            && snapshot.in_flight == 0
        {
            return Settle::MeterStopped(reason);
        }
        if Instant::now() >= deadline {
            return Settle::TimeLimit;
        }
        match tasks.get("actor-a", &scope(), task_id).await {
            Ok(task)
                if matches!(task.state, TaskState::Waiting | TaskState::Stopped)
                    && snapshot.in_flight == 0 =>
            {
                stable += 1;
                if stable >= 3 {
                    return Settle::Settled(task.state);
                }
            }
            Ok(_) => stable = 0,
            Err(error) => return Settle::Error(format!("the Task could not be read: {error}")),
        }
        tokio::time::sleep(Duration::from_millis(700)).await;
    }
}

async fn state_of(tasks: &TaskRepository, task_id: &str) -> Result<TaskState, String> {
    tasks
        .get("actor-a", &scope(), task_id)
        .await
        .map(|t| t.state)
        .map_err(|e| format!("the Task could not be read: {e}"))
}

async fn wait_for(tasks: &TaskRepository, task_id: &str, wanted: fn(TaskState) -> bool, limit: Duration) -> Result<bool, String> {
    let deadline = Instant::now() + limit;
    loop {
        if wanted(state_of(tasks, task_id).await?) {
            return Ok(true);
        }
        if Instant::now() >= deadline {
            return Ok(false);
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

pub async fn agent_versions(lookup: &sqlx::PgPool, task_id: &str) -> Result<i64, String> {
    sqlx::query_scalar("SELECT count(*) FROM public.work_product_versions WHERE task_id=$1 AND author_kind='agent'")
        .bind(task_id)
        .fetch_one(lookup)
        .await
        .map_err(|e| format!("work-product versions could not be read: {e}"))
}

async fn turns_in_cycle(lookup: &sqlx::PgPool, task_id: &str, cycle: &str) -> Result<i64, String> {
    sqlx::query_scalar("SELECT count(*) FROM public.task_steps WHERE task_id=$1 AND cycle_id=$2 AND kind='model_turn'")
        .bind(task_id)
        .bind(cycle)
        .fetch_one(lookup)
        .await
        .map_err(|e| format!("Task steps could not be read: {e}"))
}

fn command(key: String, kind: CommandKind, task_id: &str, cycle: &str, content: Option<&str>) -> TaskCommand {
    TaskCommand {
        context: None,
        key,
        kind,
        task_id: Some(task_id.into()),
        cycle_id: Some(cycle.into()),
        content: content.map(String::from),
    }
}

pub struct DriveOutcome {
    pub stop_reason: String,
    /// Harness rounds: the Create, then each Guide (or Stop/Continue/Guide).
    pub rounds: u32,
    /// The Task's cycles, in the order they were started.
    pub cycles: Vec<String>,
    pub commands: Vec<String>,
    pub errors: Vec<String>,
}

/// Drive the Task until a work product is recorded and its cycle ends, or a
/// cycle, call, time or spend limit is reached. A cycle that ends without a
/// recorded work product gets the fixed continuation guidance; one that used
/// its whole turn bound is stopped and continued as a new cycle first.
pub async fn drive(e: &Engagement, plan: &RunPlan, meter: &Meter) -> DriveOutcome {
    let deadline = Instant::now() + Duration::from_secs(plan.max_minutes * 60);
    let task_id = e.task_id().to_string();
    let mut out = DriveOutcome {
        stop_reason: String::new(),
        rounds: 1,
        cycles: vec![e.receipt.cycle_id.clone()],
        commands: vec!["create".into()],
        errors: vec![],
    };
    let fail = |mut out: DriveOutcome, error: String| {
        out.errors.push(error);
        out.stop_reason = "harness_error".into();
        out
    };
    loop {
        let state = match settle(&e.tasks, &task_id, meter, deadline).await {
            Settle::Settled(state) => state,
            Settle::MeterStopped(reason) => {
                out.stop_reason = reason.as_str().into();
                return out;
            }
            Settle::TimeLimit => {
                out.stop_reason = "time_limit".into();
                return out;
            }
            Settle::Error(error) => return fail(out, error),
        };
        match agent_versions(&e.lookup, &task_id).await {
            Ok(n) if n > 0 => {
                out.stop_reason = "work_product_recorded".into();
                return out;
            }
            Ok(_) => {}
            Err(error) => return fail(out, error),
        }
        if out.rounds >= plan.max_cycles {
            out.stop_reason = "cycle_limit".into();
            return out;
        }
        out.rounds += 1;
        let round = out.rounds;
        let mut cycle = out.cycles.last().cloned().unwrap_or_default();
        let turns = match turns_in_cycle(&e.lookup, &task_id, &cycle).await {
            Ok(turns) => turns,
            Err(error) => return fail(out, error),
        };
        if state == TaskState::Stopped
            || turns >= zobba_domain::work::MAX_TURNS_PER_CYCLE as i64
        {
            if state != TaskState::Stopped {
                let stop = command(format!("comparison-stop-{round}"), CommandKind::Stop, &task_id, &cycle, None);
                if let Err(error) = e.tasks.admit("actor-a", &scope(), &stop).await {
                    return fail(out, format!("Stop was refused: {error}"));
                }
                out.commands.push(format!("stop (round {round})"));
                match wait_for(&e.tasks, &task_id, |s| s == TaskState::Stopped, Duration::from_secs(120)).await {
                    Ok(true) => {}
                    Ok(false) => return fail(out, "the Task did not stop within 120 s".into()),
                    Err(error) => return fail(out, error),
                }
            }
            let next = command(format!("comparison-continue-{round}"), CommandKind::Continue, &task_id, &cycle, None);
            match e.tasks.admit("actor-a", &scope(), &next).await {
                Ok(receipt) => {
                    cycle = receipt.cycle_id.clone();
                    out.cycles.push(receipt.cycle_id);
                    out.commands.push(format!("continue (round {round}, new cycle)"));
                }
                Err(error) => return fail(out, format!("Continue was refused: {error}")),
            }
        }
        let guide = command(
            format!("comparison-guide-{round}"),
            CommandKind::Guide,
            &task_id,
            &cycle,
            Some(CONTINUE_GUIDANCE),
        );
        if let Err(error) = e.tasks.admit("actor-a", &scope(), &guide).await {
            return fail(out, format!("Guide was refused: {error}"));
        }
        out.commands.push(format!("guide (round {round})"));
        // Let the Guide leave the waiting state before settling again.
        if let Err(error) = wait_for(&e.tasks, &task_id, |s| s != TaskState::Waiting, Duration::from_secs(30)).await {
            return fail(out, error);
        }
    }
}

/// A person's browser: the session cookie, its CSRF token and the expected
/// actor, as the web sends them.
pub struct Browser {
    client: reqwest_fixture::Client,
    address: String,
    origin: String,
    token: String,
    csrf: String,
    actor: String,
}
impl Browser {
    pub async fn bytes(&self, route: &str) -> Result<(u16, Vec<u8>, String), String> {
        let response = self
            .client
            .get(format!("{}/engagements/engagement-a/{route}?{SCOPE_QUERY}", self.address))
            .header("Cookie", format!("__Host-zobba-session={}", self.token))
            .header("X-Expected-Session", &self.csrf)
            .send()
            .await
            .map_err(|e| format!("GET {route}: {e}"))?;
        let status = response.status().as_u16();
        let kind = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default()
            .to_string();
        let bytes = response.bytes().await.map_err(|e| format!("GET {route}: {e}"))?;
        Ok((status, bytes.to_vec(), kind))
    }
    pub async fn post(&self, route: &str, body: &serde_json::Value) -> Result<(u16, serde_json::Value), String> {
        let response = self
            .client
            .post(format!("{}/engagements/engagement-a/{route}?{SCOPE_QUERY}", self.address))
            .header("Cookie", format!("__Host-zobba-session={}", self.token))
            .header("Origin", &self.origin)
            .header("X-CSRF-Token", &self.csrf)
            .header("X-Expected-Actor", &self.actor)
            .header("Content-Type", "application/json")
            .body(body.to_string())
            .send()
            .await
            .map_err(|e| format!("POST {route}: {e}"))?;
        let status = response.status().as_u16();
        let bytes = response.bytes().await.map_err(|e| format!("POST {route}: {e}"))?;
        Ok((status, serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null)))
    }
    pub async fn read(&self, route: &str) -> Result<(u16, serde_json::Value), String> {
        let (status, bytes, _) = self.bytes(route).await?;
        Ok((status, serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null)))
    }
}

pub async fn browser(identities: &IdentityRepository, address: &str, subject: &str, actor: &str) -> Result<Browser, String> {
    use zobba_application::identity::CurrentAuthority;
    let token = identities
        .establish_session(ISSUER, subject, subject, None)
        .await
        .map_err(|e| format!("session: {e:?}"))?;
    let session = identities
        .session(&token)
        .await
        .map_err(|e| format!("session: {e:?}"))?;
    Ok(Browser {
        client: reqwest_fixture::Client::builder()
            .timeout(Duration::from_secs(60))
            .build()
            .map_err(|e| e.to_string())?,
        address: address.into(),
        origin: std::env::var("ZOBBA_PUBLIC_ORIGIN")
            .map_err(|_| "load the local OIDC fixture environment (ZOBBA_PUBLIC_ORIGIN)".to_string())?,
        token,
        csrf: session.csrf_token,
        actor: actor.into(),
    })
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct ExportFile {
    pub format: String,
    pub file: String,
    pub bytes: usize,
    pub sha256: String,
    pub digest_matches_api: bool,
    pub valid_package: bool,
}

#[derive(Default)]
pub struct ApiOutcome {
    pub shelf: Option<serde_json::Value>,
    pub view: Option<serde_json::Value>,
    pub exports: Vec<ExportFile>,
    pub errors: Vec<String>,
}

/// Read the shelf and the version view, and export the version as DOCX and
/// XLSX through the real authenticated API, writing the files to `out`.
pub async fn export_through_api(e: &Engagement, product: &str, version_id: &str, version: i32, out: &Path) -> ApiOutcome {
    let mut result = ApiOutcome::default();
    let auth = match zobba_api::auth::AuthState::from_environment(&e.database) {
        Ok(auth) => auth,
        Err(error) => {
            result.errors.push(format!("the API could not start: {error:?}"));
            return result;
        }
    };
    let listener = match TcpListener::bind("127.0.0.1:0").await {
        Ok(listener) => listener,
        Err(error) => {
            result.errors.push(format!("the API could not bind: {error}"));
            return result;
        }
    };
    let address = format!("http://{}", listener.local_addr().unwrap());
    let app = zobba_api::authenticated_router_with_evidence(e.database.clone(), auth, Some(e.store()));
    let server = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    let auditor = match browser(&e.identities, &address, "auditor-a", "actor-a").await {
        Ok(browser) => browser,
        Err(error) => {
            result.errors.push(error);
            server.abort();
            return result;
        }
    };
    let task = e.task_id();
    let base = format!("tasks/{task}/work-products/{product}");
    match auditor.read(&format!("tasks/{task}/work-products")).await {
        Ok((200, shelf)) => result.shelf = Some(shelf),
        Ok((status, body)) => result.errors.push(format!("the shelf answered {status}: {body}")),
        Err(error) => result.errors.push(error),
    }
    match auditor.read(&format!("{base}/versions/{version_id}")).await {
        Ok((200, view)) => {
            let _ = std::fs::write(
                out.join(format!("work-product-v{version}.json")),
                serde_json::to_vec_pretty(&view).unwrap_or_default(),
            );
            result.view = Some(view);
        }
        Ok((status, body)) => result.errors.push(format!("the version view answered {status}: {body}")),
        Err(error) => result.errors.push(error),
    }
    for format in ["docx", "xlsx"] {
        let request = serde_json::json!({"format": format, "key": format!("comparison-{format}")});
        let created = match auditor.post(&format!("{base}/versions/{version_id}/exports"), &request).await {
            Ok((200, body)) => body,
            Ok((status, body)) => {
                result.errors.push(format!("the {format} export answered {status}: {body}"));
                continue;
            }
            Err(error) => {
                result.errors.push(error);
                continue;
            }
        };
        let Some(export_id) = created["id"].as_str() else {
            result.errors.push(format!("the {format} export named no ID: {created}"));
            continue;
        };
        match auditor.bytes(&format!("{base}/exports/{export_id}/content")).await {
            Ok((200, bytes, _kind)) => {
                let file = format!("work-product-v{version}.{format}");
                if let Err(error) = std::fs::write(out.join(&file), &bytes) {
                    result.errors.push(format!("cannot write {file}: {error}"));
                    continue;
                }
                let sha256 = sha(&bytes);
                result.exports.push(ExportFile {
                    format: format.into(),
                    file,
                    bytes: bytes.len(),
                    digest_matches_api: created["digest"].as_str() == Some(sha256.as_str()),
                    valid_package: zobba_domain::work_product::export::unzip(&bytes).is_some(),
                    sha256,
                });
            }
            Ok((status, _, _)) => result.errors.push(format!("the {format} download answered {status}")),
            Err(error) => result.errors.push(error),
        }
    }
    server.abort();
    result
}
