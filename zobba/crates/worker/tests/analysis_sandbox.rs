//! Story 22.4 proof: real PostgreSQL operation custody, the real repository,
//! the real worker composition and executor authority poll, real S3-protocol
//! evidence objects, and the TEST-ONLY local Docker sandbox running hostile
//! programs for real. Requires a guarded `_test` database and a Docker engine
//! with the pinned general analysis image; it fails, never skips, without them.
use sha2::{Digest, Sha256};
use sqlx::{Connection, Executor, PgConnection, postgres::PgPoolOptions};
use std::{
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use zobba_application::{
    analysis::{
        Analysis, AnalysisError, AnalysisJobs, AnalysisSandbox, AnalysisSettings, AnalysisTarget,
        JobRecord, SandboxState, Watch,
    },
    evidence::EvidenceObjects,
    model::ModelCancellation,
    operation::OperationStore,
    task::TaskCommands,
};
use zobba_domain::{
    analysis::*,
    identity::Scope,
    permissions::{
        AccountRestriction, Action, AuthoritySnapshot, EnvironmentKind, OperationHistoryQuery,
        PermissionBounds, PermissionRule, PolicyDocument, PolicyKind, Purpose, ReadRestriction,
        SourceBinding, SourceFact,
    },
    task::{
        ClaimBasis, CommandKind, CommandReceipt, ConsumedAttempt, Decision, Observation,
        TaskCommand, WakeupRoute,
    },
};
use zobba_infrastructure::{
    RuntimeDatabase,
    analysis::{AnalysisRepository, docker::DockerSandbox},
    database_options,
    evidence::s3::S3EvidenceObjects,
    fixture::seed_local_configured,
    migrate,
    operation::OperationRepository,
    task::TaskRepository,
};
use zobba_worker::{
    analysis::AnalysisComposition, diagnostics::Diagnostics, executor, work::WorkRunner,
};

#[path = "../../infrastructure/tests/support/s3_protocol.rs"]
mod s3_protocol;
#[path = "../../infrastructure/tests/support/mod.rs"]
mod support;

const REPOSITORY: &str = "mirror.gcr.io/library/python";
const PROGRAM_SENTINEL: &str = "PROGRAM-SENTINEL-7f3a";
const INPUT_SENTINEL: &str = "INPUT-SENTINEL-91bc";
const OUTPUT_SENTINEL: &str = "OUTPUT-SENTINEL-c04d";
const NAMESPACE: &str = "5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d";

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
fn target() -> AnalysisTarget {
    AnalysisTarget {
        account_id: "analysis-account".into(),
        environment_id: "analysis-environment".into(),
        destination: "analysis-sandbox".into(),
        resource_id: "analysis-resource".into(),
        resource_version: "v1".into(),
        classification: "audit".into(),
        lifetime_seconds: 3_600,
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
fn policy(kind: PolicyKind, subject: &str) -> PolicyDocument {
    let t = target();
    let bounds = PermissionBounds {
        rules: vec![PermissionRule {
            purpose: Purpose::AuditCoordination,
            action: Action::Write,
            account_id: t.account_id.clone(),
            environment_id: t.environment_id.clone(),
            destination: t.destination.clone(),
            resource_id: t.resource_id.clone(),
            recipients: vec![],
            attachment_classifications: vec!["audit".into()],
            expires_at: 4_102_444_800,
        }],
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
            account_id: t.account_id.clone(),
            environment_id: t.environment_id.clone(),
            environment: EnvironmentKind::Audit,
            read_restriction: ReadRestriction::None,
            restriction_survives_takeover: false,
            test_environment_verified: false,
            test_resources: vec![],
            test_cleanup_id: None,
            audit_resources: vec![t.resource_id],
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
fn limits(wall_seconds: u32) -> AnalysisLimits {
    AnalysisLimits {
        cpu_millis: 1_000,
        memory_mib: 256,
        pids: 64,
        wall_seconds,
        output_total_bytes: 4 * 1024 * 1024,
        output_file_bytes: 1024 * 1024,
        output_files: 16,
    }
}

struct World {
    pool: sqlx::PgPool,
    admin: PgConnection,
    store: OperationRepository,
    jobs: AnalysisRepository,
    tasks: TaskRepository,
    sandbox: Arc<DockerSandbox>,
    objects: Arc<S3EvidenceObjects>,
    allowlist: Vec<AnalysisEnvironment>,
    authority: AuthoritySnapshot,
    input_digest: String,
}
impl World {
    fn analysis(
        &self,
    ) -> Analysis<'_, OperationRepository, AnalysisRepository, DockerSandbox, S3EvidenceObjects>
    {
        Analysis {
            store: &self.store,
            jobs: &self.jobs,
            sandbox: &self.sandbox,
            objects: &self.objects,
            allowlist: &self.allowlist,
            settings: SETTINGS,
        }
    }
    fn composition(&self) -> AnalysisComposition<DockerSandbox, S3EvidenceObjects> {
        let mut composition = AnalysisComposition::new(
            self.pool.clone(),
            self.sandbox.clone(),
            self.objects.clone(),
            Diagnostics::default(),
        );
        composition.settings = SETTINGS;
        composition
    }
    /// A new Task with accepted authority and a consumed producing claim.
    async fn task(&self, name: &str) -> (CommandReceipt, ClaimBasis) {
        let (receipt, basis, _) = self.task_attempt(name).await;
        (receipt, basis)
    }
    async fn task_attempt(&self, name: &str) -> (CommandReceipt, ClaimBasis, ConsumedAttempt) {
        let receipt = self
            .tasks
            .admit(
                "actor-a",
                &scope(),
                &TaskCommand {
                    context: None,
                    key: name.into(),
                    kind: CommandKind::Create,
                    task_id: None,
                    cycle_id: None,
                    content: Some(format!("Synthetic analysis case {name}")),
                },
            )
            .await
            .unwrap();
        let mut authority = self.authority.clone();
        authority.task_id = receipt.task_id.clone();
        authority.task = policy(PolicyKind::Task, &receipt.task_id);
        authority.task.actor_id = "actor-a".into();
        self.store
            .accept_authority("actor-a", &scope(), &receipt.task_id, &authority)
            .await
            .unwrap();
        let (basis, attempt) = self.claim(&receipt, &format!("worker-{name}")).await;
        (receipt, basis, attempt)
    }
    async fn claim(&self, receipt: &CommandReceipt, worker: &str) -> (ClaimBasis, ConsumedAttempt) {
        let decision = self
            .tasks
            .coordinate(&route(receipt), worker)
            .await
            .unwrap();
        let Decision::Execute(basis) = decision else {
            panic!("expected an executable claim, got {decision:?}");
        };
        let attempt = self.tasks.consume(&basis).await.unwrap();
        (attempt.basis.clone(), attempt)
    }
    fn request(&self, program: &str, limits: AnalysisLimits) -> AnalysisRequest {
        AnalysisRequest {
            environment_id: GENERAL_ENVIRONMENT_ID.into(),
            image_digest: GENERAL_IMAGE_DIGEST.into(),
            program: format!("# {PROGRAM_SENTINEL}\n{program}"),
            program_sha256: sha(format!("# {PROGRAM_SENTINEL}\n{program}").as_bytes()),
            inputs: vec![AnalysisInput {
                original_id: "analysis-input-a".into(),
                digest: self.input_digest.clone(),
            }],
            limits,
        }
    }
    async fn run(&self, name: &str, program: &str, limits: AnalysisLimits) -> JobRecord {
        let (_, basis) = self.task(name).await;
        self.analysis()
            .admit(&target(), &basis, name, &self.request(program, limits))
            .await
            .unwrap();
        self.analysis()
            .run_next(&basis, &ModelCancellation::new(), &mut Vec::new())
            .await
            .unwrap()
            .unwrap()
    }
    async fn statuses(&mut self, job_id: &str) -> Vec<(String, Option<String>)> {
        sqlx::query_as("SELECT status,reason FROM public.analysis_job_events WHERE job_id=$1 ORDER BY sequence")
            .bind(job_id)
            .fetch_all(&mut self.admin)
            .await
            .unwrap()
    }
    async fn containers(&self, handle: &str) -> usize {
        let output = tokio::process::Command::new("docker")
            .args([
                "ps",
                "-aq",
                "--filter",
                &format!("label=zobba.analysis.handle={handle}"),
            ])
            .output()
            .await
            .unwrap();
        String::from_utf8_lossy(&output.stdout)
            .split_whitespace()
            .count()
    }
}
fn route(receipt: &CommandReceipt) -> WakeupRoute {
    WakeupRoute {
        id: receipt.task_id.clone(),
        actor_id: "actor-a".into(),
        scope: scope(),
        task_id: receipt.task_id.clone(),
    }
}
async fn wait_for(world: &World, job_id: &str, wanted: JobStatus) -> JobRecord {
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        let record = world.jobs.job("actor-a", &scope(), job_id).await.unwrap();
        if record.latest.status == wanted {
            return record;
        }
        assert!(
            Instant::now() < deadline,
            "job did not reach {wanted:?}: {:?}",
            record.latest
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

async fn image_present() {
    let image = format!("{REPOSITORY}@{GENERAL_IMAGE_DIGEST}");
    let present = tokio::process::Command::new("docker")
        .args(["image", "inspect", &image])
        .output()
        .await
        .expect("a Docker engine is required for the hostile analysis fixtures")
        .status
        .success();
    if !present {
        let pulled = tokio::process::Command::new("docker")
            .args(["pull", &image])
            .status()
            .await
            .unwrap()
            .success();
        assert!(
            pulled,
            "the pinned analysis image {image} must be available"
        );
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn measured_analysis_runs_hostile_programs_in_an_isolated_sandbox() {
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
    seed_local_configured("https://127.0.0.1:4443", &configuration.migration)
        .await
        .unwrap();
    let mut admin = PgConnection::connect(&configuration.admin).await.unwrap();
    configuration.guard_connection(&mut admin).await;
    let database = RuntimeDatabase::connect(&configuration.runtime)
        .await
        .unwrap();
    let pool = PgPoolOptions::new()
        .max_connections(8)
        .connect_with(database_options(&configuration.runtime).unwrap())
        .await
        .unwrap();

    // Immutable original, registered by the guarded owner fixture.
    let s3 = s3_protocol::Fixture::start().await;
    let objects = Arc::new(
        S3EvidenceObjects::new(
            s3_protocol::build_fixture_store(&s3.endpoint).unwrap(),
            NAMESPACE.into(),
        )
        .unwrap(),
    );
    let input = format!("account,amount\nA-1,10\nA-2,32\n# {INPUT_SENTINEL}\n").into_bytes();
    let input_digest = sha(&input);
    let version = objects
        .put_if_absent("analysis-input-a", input.clone())
        .await
        .unwrap();
    let request = format!(
        r#"{{"key":"analysis-input","filename":"ledger.csv","sha256":"{input_digest}","size":{},"system":null,"account":null,"source_version":null,"selection":null,"coverage":null}}"#,
        input.len()
    );
    sqlx::query("INSERT INTO public.evidence_reservations(id,organisation_id,client_id,engagement_id,actor_id,key,request,digest,size,namespace) VALUES('analysis-input-a','org-a','client-a','engagement-a','actor-a','analysis-input',$1,$2,$3,$4)")
        .bind(&request).bind(&input_digest).bind(input.len() as i64).bind(NAMESPACE).execute(&mut admin).await.unwrap();
    sqlx::query("INSERT INTO public.evidence_originals SELECT r.*, $1, r.reserved_at FROM public.evidence_reservations r WHERE id='analysis-input-a'")
        .bind(&version).execute(&mut admin).await.unwrap();
    sqlx::query("INSERT INTO public.trusted_attachment_metadata(organisation_id,client_id,engagement_id,source_key,attachment_id,digest,classification) VALUES('org-a','client-a','engagement-a','16:analysis-sandbox15:analysis-ledger','analysis-input-a',$1,'audit')")
        .bind(&input_digest).execute(&mut admin).await.unwrap();

    let store = OperationRepository::new(pool.clone());
    let authority = AuthoritySnapshot {
        scope: scope(),
        actor_id: "actor-a".into(),
        task_id: "placeholder".into(),
        organisation: policy(PolicyKind::Organisation, "org-a"),
        engagement: policy(PolicyKind::Engagement, "engagement-a"),
        member: policy(PolicyKind::Member, "actor-a"),
        account: policy(PolicyKind::Account, "analysis-account"),
        task: policy(PolicyKind::Task, "placeholder"),
        delegations: vec![],
    };
    for document in [
        &authority.organisation,
        &authority.engagement,
        &authority.member,
        &authority.account,
    ] {
        store
            .save_policy("actor-manager", &scope(), document)
            .await
            .unwrap();
    }
    let staging = std::env::temp_dir().join(format!("zobba-analysis-{}", std::process::id()));
    let mut world = World {
        pool: pool.clone(),
        admin,
        store,
        jobs: AnalysisRepository::new(pool.clone()),
        tasks: TaskRepository::new(pool.clone()),
        sandbox: Arc::new(DockerSandbox::explicit_test(REPOSITORY, &staging).unwrap()),
        objects,
        allowlist: server_allowlist(),
        authority,
        input_digest,
    };

    happy_path(&mut world).await;
    credential_probe(&mut world).await;
    hostile_outputs(&mut world).await;
    exhaustion(&mut world).await;
    stop_during_run(&mut world).await;
    lost_job_recovery(&mut world).await;
    absent_before_start_is_retryable(&mut world).await;
    changed_retry_and_unlisted_environment(&mut world).await;
    hostile_tree_is_always_recorded(&mut world).await;
    collectors_agree_on_one_tree().await;
    stage_script_verifies_pinned_inputs().await;
    nothing_sensitive_is_recorded(&mut world).await;
    database_guards_refuse_owner_writes(&mut world).await;
    coordinator_reconciles_a_lost_running_job(&mut world).await;
    production_worker_refuses_the_docker_sandbox(&configuration).await;

    zobba_infrastructure::analysis::docker::remove_all_test_resources().await;
    let _ = std::fs::remove_dir_all(PathBuf::from(&staging));
    database.pool().close().await;
    s3.stop().await;
}

async fn happy_path(world: &mut World) {
    let program = format!(
        r#"
import csv
rows = [r for r in csv.reader(open('/input/analysis-input-a')) if r and not r[0].startswith('#')][1:]
total = sum(int(r[1]) for r in rows)
open('/output/summary.csv', 'w').write(f'rows,total\n{{len(rows)}},{{total}}\n# {OUTPUT_SENTINEL}\n')
"#
    );
    let record = world.run("happy", &program, limits(60)).await;
    assert_eq!(
        record.latest.status,
        JobStatus::Collected,
        "{:?}",
        world.statuses(&record.job.id).await
    );
    let statuses: Vec<String> = world
        .statuses(&record.job.id)
        .await
        .into_iter()
        .map(|s| s.0)
        // A fast program may exit before any poll observes it running.
        .filter(|s| s != "running")
        .collect();
    assert_eq!(
        statuses,
        ["admitted", "possibly_started", "completed", "collected"]
    );
    let descendants = world
        .jobs
        .descendants("actor-a", &scope(), &record.job.id)
        .await
        .unwrap();
    assert_eq!(descendants.len(), 1);
    let expected = format!("rows,total\n2,42\n# {OUTPUT_SENTINEL}\n").into_bytes();
    let d = &descendants[0];
    assert_eq!(
        (d.path.as_str(), d.media_type.as_str()),
        ("summary.csv", "text/csv")
    );
    assert_eq!(
        d.identity.sha256,
        sha(&expected),
        "trusted code measured the hash"
    );
    assert_eq!(d.parents, ["analysis-input-a"]);
    let stored = world
        .objects
        .get_version(&d.id, &d.namespace, &d.version)
        .await
        .unwrap();
    assert_eq!(
        stored.bytes, expected,
        "pinned read-back of the immutable descendant"
    );
    let attempt = record.latest.attempt_id.clone().unwrap();
    let history = world
        .store
        .history(
            "actor-a",
            &scope(),
            &record.job.operation_id,
            &OperationHistoryQuery::default(),
        )
        .await
        .unwrap();
    assert_eq!(history.attempts.len(), 1);
    assert!(
        history
            .observations
            .iter()
            .any(|o| o.attempt_id == attempt && o.fact == SourceFact::Completed)
    );
    assert_eq!(
        world.containers(&attempt).await,
        0,
        "the sandbox was discarded after collection"
    );
}

async fn credential_probe(world: &mut World) {
    let program = r#"
import json, os, socket
results = {}
for host, port in [('169.254.169.254', 80), ('169.254.170.2', 80), ('1.1.1.1', 443), ('8.8.8.8', 53)]:
    try:
        socket.create_connection((host, port), timeout=2).close()
        results[host] = 'connected'
    except OSError as error:
        results[host] = type(error).__name__
try:
    socket.getaddrinfo('example.com', 443)
    results['dns'] = 'resolved'
except OSError as error:
    results['dns'] = type(error).__name__
results['environment'] = sorted(os.environ)
results['uid'] = os.getuid()
results['docker_socket'] = os.path.exists('/var/run/docker.sock')
for path in ['/output/probe-root', '/input/new', '/job/new']:
    try:
        open(path, 'w').write('x')
        results[path] = 'writable'
    except OSError as error:
        results[path] = type(error).__name__
open('/output/report.json', 'w').write(json.dumps(results))
"#;
    let record = world.run("credential-probe", program, limits(60)).await;
    assert_eq!(record.latest.status, JobStatus::Collected);
    let descendants = world
        .jobs
        .descendants("actor-a", &scope(), &record.job.id)
        .await
        .unwrap();
    let report = descendants
        .iter()
        .find(|d| d.path == "report.json")
        .unwrap();
    let bytes = world
        .objects
        .get_version(&report.id, &report.namespace, &report.version)
        .await
        .unwrap()
        .bytes;
    let report: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    for host in [
        "169.254.169.254",
        "169.254.170.2",
        "1.1.1.1",
        "8.8.8.8",
        "dns",
    ] {
        assert!(
            !matches!(report[host].as_str(), Some("connected" | "resolved")),
            "network reached {host}: {report}"
        );
    }
    let names: Vec<&str> = report["environment"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect();
    // Only the pinned image's own public defaults and the runtime's hostname
    // and home exist; no host, worker, AWS, proxy or model variable reaches it.
    for name in &names {
        assert!(
            [
                "PATH",
                "HOME",
                "HOSTNAME",
                "LANG",
                "LC_CTYPE",
                "GPG_KEY",
                "PYTHON_VERSION",
                "PYTHON_SHA256"
            ]
            .contains(name),
            "unexpected variable {name} reached the job"
        );
    }
    for host in [
        "ZOBBA_OPENAI_API_KEY",
        "ZOBBA_ANTHROPIC_API_KEY",
        "HTTPS_PROXY",
        "AWS_ACCESS_KEY_ID",
    ] {
        assert!(!names.contains(&host));
    }
    assert_ne!(report["uid"], 0, "the job is not root");
    assert_eq!(report["docker_socket"], false);
    for path in ["/input/new", "/job/new"] {
        assert_ne!(report[path], "writable", "{path} must be read-only");
    }
}

async fn hostile_outputs(world: &mut World) {
    let program = r#"
import os, socket
open('/output/safe.csv', 'w').write('ok\n')
os.symlink('/etc/passwd', '/output/link.csv')
open('/output/hard.csv', 'w').write('h\n')
os.link('/output/hard.csv', '/output/hard2.csv')
os.mkfifo('/output/pipe.csv')
open('/output/A.csv', 'w').write('upper\n')
open('/output/a.csv', 'w').write('lower\n')
open('/output/bad\x07name.csv', 'w').write('x\n')
open('/output/program.sh', 'w').write('#!/bin/sh\n')
os.mkdir('/output/nested')
open('/output/nested/deep.json', 'w').write('{}')
s = socket.socket(socket.AF_UNIX); s.bind('/output/sock.csv')
"#;
    let record = world.run("hostile-outputs", program, limits(60)).await;
    assert_eq!(record.latest.status, JobStatus::Collected);
    let descendants = world
        .jobs
        .descendants("actor-a", &scope(), &record.job.id)
        .await
        .unwrap();
    let paths: Vec<&str> = descendants.iter().map(|d| d.path.as_str()).collect();
    assert_eq!(
        paths,
        ["nested/deep.json", "safe.csv"],
        "only safe siblings are registered"
    );
    let (receipt, mut reasons) = world
        .jobs
        .receipt("actor-a", &scope(), &record.job.id)
        .await
        .unwrap()
        .unwrap();
    reasons.sort();
    assert_eq!(
        reasons,
        [
            "case_collision",
            "case_collision",
            "control_character",
            "fifo",
            "hardlink",
            "hardlink",
            "media_type",
            "socket",
            "symlink"
        ]
    );
    let text = receipt.to_string();
    for name in [".csv", ".sh", "passwd", "upper", "nested"] {
        assert!(
            !text.contains(name),
            "receipt names rejected content {name}"
        );
    }
    assert_eq!(receipt["rejected_count"], 9);
    assert_eq!(receipt["rejected_by_reason"]["hardlink"], 2);
}

async fn exhaustion(world: &mut World) {
    // Fork bomb: the PID limit holds and wall time ends the job.
    let fork =
        "import os\nwhile True:\n    try:\n        os.fork()\n    except OSError:\n        pass\n";
    let started = Instant::now();
    let record = world
        .run(
            "fork-bomb",
            fork,
            AnalysisLimits {
                pids: 32,
                ..limits(4)
            },
        )
        .await;
    let statuses = world.statuses(&record.job.id).await;
    assert!(
        statuses
            .iter()
            .any(|s| s.0 == "limit_exceeded" && s.1.as_deref() == Some("wall_time")),
        "{statuses:?}"
    );
    assert!(started.elapsed() < Duration::from_secs(40), "bounded");

    let memory = "chunks = []\nwhile True:\n    chunks.append(bytearray(16 * 1024 * 1024))\n";
    let record = world
        .run(
            "memory-hog",
            memory,
            AnalysisLimits {
                memory_mib: 128,
                ..limits(60)
            },
        )
        .await;
    let statuses = world.statuses(&record.job.id).await;
    assert!(
        statuses
            .iter()
            .any(|s| s.0 == "limit_exceeded" && s.1.as_deref() == Some("memory")),
        "{statuses:?}"
    );

    let spin = "while True:\n    pass\n";
    let record = world.run("infinite-loop", spin, limits(3)).await;
    let statuses = world.statuses(&record.job.id).await;
    assert!(
        statuses
            .iter()
            .any(|s| s.0 == "limit_exceeded" && s.1.as_deref() == Some("wall_time")),
        "{statuses:?}"
    );

    // One GiB of output: the per-file rlimit kills it and nothing oversize registers.
    let big = "chunk = b'z' * (1024 * 1024)\nwith open('/output/big.txt', 'wb') as f:\n    for _ in range(1024):\n        f.write(chunk)\n";
    let record = world.run("one-gib-output", big, limits(60)).await;
    let statuses = world.statuses(&record.job.id).await;
    assert!(
        statuses.iter().any(|s| s.0 == "limit_exceeded"
            && matches!(s.1.as_deref(), Some("output_file" | "output_total"))),
        "{statuses:?}"
    );
    let descendants = world
        .jobs
        .descendants("actor-a", &scope(), &record.job.id)
        .await
        .unwrap();
    assert!(
        descendants.is_empty(),
        "no oversize descendant: {descendants:?}"
    );

    // Many files: the total-bytes volume bound fills and the job is limited.
    let many = "chunk = b'y' * (900 * 1024)\nfor i in range(64):\n    open(f'/output/part{i}.txt', 'wb').write(chunk)\n";
    let record = world.run("total-output", many, limits(60)).await;
    let statuses = world.statuses(&record.job.id).await;
    assert!(
        statuses
            .iter()
            .any(|s| s.0 == "limit_exceeded" && s.1.as_deref() == Some("output_total")),
        "{statuses:?}"
    );
    let descendants = world
        .jobs
        .descendants("actor-a", &scope(), &record.job.id)
        .await
        .unwrap();
    assert!(
        descendants.iter().map(|d| d.identity.size).sum::<u64>() <= limits(60).output_total_bytes
    );
}

async fn stop_during_run(world: &mut World) {
    let (receipt, basis) = world.task("stop-during-run").await;
    let request = world.request("import time\nwhile True:\n    time.sleep(1)\n", limits(120));
    let job = world
        .analysis()
        .admit(&target(), &basis, "stop-during-run", &request)
        .await
        .unwrap();
    let composition = world.composition();
    let config = executor::Config::new(PathBuf::from("/bin/false"), 10).unwrap();
    let (_shutdown, receiver) = tokio::sync::watch::channel(false);
    let tasks = world.tasks.clone();
    let run_basis = basis.clone();
    let run = tokio::spawn(async move {
        let outcome = executor::execute_work(
            &config,
            &run_basis,
            receiver,
            || tasks.current(&run_basis),
            &composition,
        )
        .await;
        matches!(outcome, executor::WorkExecution::Observed(_))
    });
    let running = wait_for(world, &job.job.id, JobStatus::Running).await;
    let handle = running.latest.attempt_id.clone().unwrap();
    assert_eq!(
        world
            .sandbox
            .status(&handle, &server_allowlist()[0])
            .await
            .unwrap(),
        SandboxState::Running
    );
    world
        .tasks
        .admit(
            "actor-a",
            &scope(),
            &TaskCommand {
                context: None,
                key: "stop-during-run-stop".into(),
                kind: CommandKind::Stop,
                task_id: Some(receipt.task_id.clone()),
                cycle_id: Some(receipt.cycle_id.clone()),
                content: None,
            },
        )
        .await
        .unwrap();
    assert!(
        tokio::time::timeout(Duration::from_secs(30), run)
            .await
            .unwrap()
            .unwrap()
    );
    let stopped = wait_for(world, &job.job.id, JobStatus::Stopped).await;
    assert_eq!(stopped.latest.reason.as_deref(), Some("stopped"));
    assert!(
        world
            .jobs
            .descendants("actor-a", &scope(), &job.job.id)
            .await
            .unwrap()
            .is_empty(),
        "a stopped job is discarded"
    );
    assert_eq!(
        world.containers(&handle).await,
        0,
        "termination confirmed, then discarded"
    );
}

async fn lost_job_recovery(world: &mut World) {
    let (receipt, basis) = world.task("lost-job").await;
    let program = format!(
        "import time\ntime.sleep(4)\nopen('/output/late.txt', 'w').write('{OUTPUT_SENTINEL}')\n"
    );
    let request = world.request(&program, limits(60));
    let job = world
        .analysis()
        .admit(&target(), &basis, "lost-job", &request)
        .await
        .unwrap();
    {
        let cancellation = ModelCancellation::new();
        let analysis = world.analysis();
        let mut skip = Vec::new();
        let run = analysis.run_next(&basis, &cancellation, &mut skip);
        tokio::pin!(run);
        tokio::select! {
            _ = &mut run => panic!("the long job finished before the simulated loss"),
            _ = async {
                loop {
                    if world.jobs.job("actor-a", &scope(), &job.job.id).await.unwrap().latest.status == JobStatus::Running { break; }
                    tokio::time::sleep(Duration::from_millis(50)).await;
                }
            } => {}
        }
        // Dropping the future is the abrupt loss of the worker mid-run.
    }
    let record = world
        .jobs
        .job("actor-a", &scope(), &job.job.id)
        .await
        .unwrap();
    let handle = record.latest.attempt_id.clone().unwrap();
    assert_eq!(
        world
            .sandbox
            .status(&handle, &server_allowlist()[0])
            .await
            .unwrap(),
        SandboxState::Running,
        "the job outlived its worker"
    );
    // The worker's reconciliation path after a restart: lookup and resumed watch.
    let composition = world.composition();
    let (_shutdown, receiver) = tokio::sync::watch::channel(false);
    assert!(composition.reconcile(&route(&receipt), receiver).await);
    let record = world
        .jobs
        .job("actor-a", &scope(), &job.job.id)
        .await
        .unwrap();
    assert_eq!(record.latest.status, JobStatus::Collected);
    let history = world
        .store
        .history(
            "actor-a",
            &scope(),
            &job.job.operation_id,
            &OperationHistoryQuery::default(),
        )
        .await
        .unwrap();
    assert_eq!(history.attempts.len(), 1, "no duplicate run");
    assert_eq!(
        world
            .jobs
            .descendants("actor-a", &scope(), &job.job.id)
            .await
            .unwrap()
            .len(),
        1
    );
}

async fn absent_before_start_is_retryable(world: &mut World) {
    let (receipt, basis, claim) = world.task_attempt("absent-before-start").await;
    let request = world.request("open('/output/retried.txt', 'w').write('ok')\n", limits(60));
    let job = world
        .analysis()
        .admit(&target(), &basis, "absent-before-start", &request)
        .await
        .unwrap();
    // The worker dies after the consumption cutoff, before its durable
    // possibly-started fact: the sandbox was never called.
    let consumed = world
        .store
        .consume(&basis, &job.job.operation_id)
        .await
        .unwrap();
    let recovered = world
        .analysis()
        .recover(
            "actor-a",
            &scope(),
            &job.job.id,
            &ModelCancellation::new(),
            Watch::default(),
        )
        .await
        .unwrap();
    assert_eq!(recovered.latest.status, JobStatus::Absent);
    assert_eq!(
        recovered.latest.attempt_id.as_deref(),
        Some(consumed.attempt_id.as_str())
    );
    assert_eq!(world.containers(&consumed.attempt_id).await, 0);
    // A late fact from the lost process is fenced by the database guard.
    let late = sqlx::query("INSERT INTO public.analysis_job_events(organisation_id,client_id,engagement_id,job_id,sequence,status,attempt_id) VALUES('org-a','client-a','engagement-a',$1,2,'possibly_started',$2)")
        .bind(&job.job.id).bind(&consumed.attempt_id).execute(&mut world.admin).await;
    assert!(late.is_err(), "an absent attempt cannot start later");
    // The same claim process cannot retry; a replacement claim can.
    assert_eq!(
        world
            .analysis()
            .run_next(&basis, &ModelCancellation::new(), &mut Vec::new())
            .await
            .err(),
        Some(AnalysisError::Fenced)
    );
    // The lost producer's claim ends; a replacement owner may retry only the
    // source-confirmed absence under the unchanged cycle, intent and epoch.
    world
        .tasks
        .observe(&claim, Observation::Exited)
        .await
        .unwrap();
    sqlx::query(
        "UPDATE public.tasks SET owner_until=clock_timestamp()-interval '1 second' WHERE id=$1",
    )
    .bind(&receipt.task_id)
    .execute(&mut world.admin)
    .await
    .unwrap();
    let (replacement, _) = world.claim(&receipt, "worker-replacement").await;
    let done = world
        .analysis()
        .run_next(&replacement, &ModelCancellation::new(), &mut Vec::new())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(done.latest.status, JobStatus::Collected);
    let statuses: Vec<String> = world
        .statuses(&job.job.id)
        .await
        .into_iter()
        .map(|s| s.0)
        // A fast program may exit before any poll observes it running.
        .filter(|s| s != "running")
        .collect();
    assert_eq!(
        statuses,
        [
            "admitted",
            "absent",
            "possibly_started",
            "completed",
            "collected"
        ]
    );
    let history = world
        .store
        .history(
            "actor-a",
            &scope(),
            &job.job.operation_id,
            &OperationHistoryQuery::default(),
        )
        .await
        .unwrap();
    assert_eq!(history.attempts.len(), 2);
}

async fn changed_retry_and_unlisted_environment(world: &mut World) {
    let (_, basis) = world.task("changed-retry").await;
    let request = world.request("print('one')\n", limits(60));
    let original = world
        .analysis()
        .admit(&target(), &basis, "changed-retry", &request)
        .await
        .unwrap();
    let again = world
        .analysis()
        .admit(&target(), &basis, "changed-retry", &request)
        .await
        .unwrap();
    assert_eq!(
        again.job.id, original.job.id,
        "exact retry returns the original job"
    );
    let changed = world.request("print('two')\n", limits(60));
    assert_eq!(
        world
            .analysis()
            .admit(&target(), &basis, "changed-retry", &changed)
            .await
            .err(),
        Some(AnalysisError::Conflict)
    );
    let mut wider = request.clone();
    wider.limits.wall_seconds = 30;
    assert_eq!(
        world
            .analysis()
            .admit(&target(), &basis, "changed-retry", &wider)
            .await
            .err(),
        Some(AnalysisError::Conflict)
    );
    let unchanged = world
        .jobs
        .job("actor-a", &scope(), &original.job.id)
        .await
        .unwrap();
    assert_eq!(unchanged.job.request, request, "original job unchanged");
    let operations_before: i64 = sqlx::query_scalar("SELECT count(*) FROM public.operations")
        .fetch_one(&mut world.admin)
        .await
        .unwrap();
    let mut unlisted = world.request("print(1)\n", limits(60));
    unlisted.environment_id = "custom-image".into();
    assert_eq!(
        world
            .analysis()
            .admit(&target(), &basis, "unlisted", &unlisted)
            .await
            .err(),
        Some(AnalysisError::Unlisted)
    );
    let mut digest = world.request("print(1)\n", limits(60));
    digest.image_digest = format!("sha256:{}", "0".repeat(64));
    assert_eq!(
        world
            .analysis()
            .admit(&target(), &basis, "unlisted-digest", &digest)
            .await
            .err(),
        Some(AnalysisError::Unlisted)
    );
    let operations_after: i64 = sqlx::query_scalar("SELECT count(*) FROM public.operations")
        .fetch_one(&mut world.admin)
        .await
        .unwrap();
    assert_eq!(
        operations_before, operations_after,
        "refused before any operation or consumption"
    );
}

async fn nothing_sensitive_is_recorded(world: &mut World) {
    for (table, column) in [
        ("analysis_job_events", "to_jsonb(t)::text"),
        ("analysis_descendants", "to_jsonb(t)::text"),
        ("analysis_rejections", "to_jsonb(t)::text"),
        ("operations", "request"),
        ("operation_receipts", "to_jsonb(t)::text"),
        ("operation_attempts", "to_jsonb(t)::text"),
    ] {
        for sentinel in [PROGRAM_SENTINEL, INPUT_SENTINEL, OUTPUT_SENTINEL] {
            let leaked: i64 = sqlx::query_scalar(&format!(
                "SELECT count(*) FROM public.{table} t WHERE {column} LIKE '%' || $1 || '%'"
            ))
            .bind(sentinel)
            .fetch_one(&mut world.admin)
            .await
            .unwrap();
            assert_eq!(leaked, 0, "{table} carries {sentinel}");
        }
    }
    // The program text exists only where staging reads it.
    let stored: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM public.analysis_jobs WHERE program LIKE '%' || $1 || '%'",
    )
    .bind(PROGRAM_SENTINEL)
    .fetch_one(&mut world.admin)
    .await
    .unwrap();
    assert!(stored > 0);
}

async fn production_worker_refuses_the_docker_sandbox(configuration: &support::Configuration) {
    for value in ["docker", "local"] {
        let output = tokio::process::Command::new(env!("CARGO_BIN_EXE_zobba-worker"))
            .env_clear()
            .env("ZOBBA_RUNTIME_DATABASE_URL", &configuration.runtime)
            .env("ZOBBA_WORKER_BIND", "127.0.0.1:0")
            .env("ZOBBA_ANALYSIS_SANDBOX", value)
            .output()
            .await
            .unwrap();
        assert!(!output.status.success());
        assert_eq!(
            String::from_utf8_lossy(&output.stderr).trim(),
            "worker: invalid_configuration"
        );
    }
}

async fn hostile_tree_is_always_recorded(world: &mut World) {
    // More entries than a collector reports, names past the path bound, an
    // unreadable directory and more regular files than slots: collection still
    // happens and the receipt (counts plus a bounded sample) still fits.
    let program = r#"
import os
os.makedirs('/output/a-locked/inner')
open('/output/a-locked/inner/x.txt', 'w').write('x')
os.chmod('/output/a-locked', 0)
deep = '/output/b-' + 'x' * 200
os.makedirs(deep)
open(deep + '/' + 'y' * 200 + '.txt', 'w').write('long')
for i in range(20):
    open(f'/output/c-{i:02}.txt', 'w').write(str(i))
os.makedirs('/output/z-many')
for i in range(1100):
    open(f'/output/z-many/{i:04}.txt', 'w').close()
"#;
    let record = world
        .run(
            "hostile-tree",
            program,
            AnalysisLimits {
                output_files: 16,
                ..limits(120)
            },
        )
        .await;
    assert_eq!(
        record.latest.status,
        JobStatus::Collected,
        "{:?}",
        world.statuses(&record.job.id).await
    );
    let (receipt, reasons) = world
        .jobs
        .receipt("actor-a", &scope(), &record.job.id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(receipt["truncated"], true);
    assert_eq!(receipt["rejected_count"], reasons.len());
    assert!(receipt["rejected_sample"].as_array().unwrap().len() <= RECEIPT_REJECTION_SAMPLE);
    assert!(receipt.to_string().len() < 65_536);
    for reason in [
        "collection_truncated",
        "too_long",
        "not_regular",
        "too_many_files",
    ] {
        assert!(
            reasons.iter().any(|r| r == reason),
            "missing {reason}: {:?}",
            receipt["rejected_by_reason"]
        );
    }
    let descendants = world
        .jobs
        .descendants("actor-a", &scope(), &record.job.id)
        .await
        .unwrap();
    assert_eq!(descendants.len(), 16, "every slot holds a safe sibling");
}

async fn docker_python(arguments: &[&str], stdin: &str) -> (bool, String) {
    use tokio::io::AsyncWriteExt;
    let image = format!("{REPOSITORY}@{GENERAL_IMAGE_DIGEST}");
    let mut command = tokio::process::Command::new("docker");
    command
        .arg("run")
        .arg("--rm")
        .arg("-i")
        .args(arguments)
        .args([&image, "python3", "-I", "-"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    let mut child = command.spawn().unwrap();
    let mut pipe = child.stdin.take().unwrap();
    pipe.write_all(stdin.as_bytes()).await.unwrap();
    drop(pipe);
    let output = tokio::time::timeout(Duration::from_secs(120), child.wait_with_output())
        .await
        .unwrap()
        .unwrap();
    (
        output.status.success(),
        format!(
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        ),
    )
}

/// The Fargate collector (uploads) and the Docker collector (stdout) are one
/// script: run both modes over the same hostile tree and compare every fact.
async fn collectors_agree_on_one_tree() {
    let harness = format!(
        r#"
import base64, contextlib, io, json, os, socket, types
COLLECT = {source:?}
m = types.ModuleType("collect")
exec(COLLECT, m.__dict__)
os.makedirs('/output/nested/deeper')
open('/output/nested/deeper/a.csv', 'w').write('a\n')
open('/output/safe.txt', 'w').write('safe')
open('/output/big.txt', 'wb').write(b'b' * 5000)
os.symlink('/etc/passwd', '/output/link.txt')
os.mkfifo('/output/pipe.txt')
open('/output/hard.txt', 'w').write('h')
os.link('/output/hard.txt', '/output/hard2.txt')
socket.socket(socket.AF_UNIX).bind('/output/sock.txt')
deep = '/output/l-' + 'x' * 200
os.makedirs(deep)
open(deep + '/' + 'y' * 100 + '.txt', 'w').write('long')
os.makedirs('/output/locked/inner')
os.chmod('/output/locked', 0)
for i in range(6):
    open(f'/output/s-{{i}}.txt', 'w').write('s' * 10)
for i in range(3):
    open(f'/output/t-{{i}}.txt', 'w').write('t')
per, total, files = 4096, 40, 5
buffer = io.StringIO()
with contextlib.redirect_stdout(buffer):
    m.local(per, total, files)
local = json.loads(buffer.getvalue())
captured = {{}}
m.upload = lambda url, data: captured.__setitem__(url, data)
json.dump({{"slots": [f"slot-{{i}}" for i in range(files)], "manifest": "manifest",
           "output_file_bytes": per, "output_total_bytes": total}}, open('/control/collect.json', 'w'))
m.fargate()
remote = json.loads(captured['manifest'])
def from_local(e):
    return ({{k: v for k, v in e.items() if k != 'content'}},
            base64.b64decode(e['content']) if 'content' in e else None)
def from_remote(e):
    return ({{k: v for k, v in e.items() if k != 'slot'}},
            captured[f"slot-{{e['slot']}}"] if 'slot' in e else None)
agree = (local['truncated'] == remote['truncated'] and local['used'] == remote['used']
         and [from_local(e) for e in local['entries']] == [from_remote(e) for e in remote['entries']])
print(json.dumps({{"agree": agree,
    "kinds": sorted({{e['kind'] for e in local['entries']}}),
    "withheld": sorted({{e['withheld'] for e in local['entries'] if 'withheld' in e}})}}))
"#,
        source = zobba_infrastructure::analysis::docker::COLLECTOR
    );
    let (ok, output) = docker_python(
        &[
            "--network",
            "none",
            "--user",
            "65534:65534",
            "--cap-drop",
            "ALL",
            "--tmpfs",
            "/output:uid=65534,gid=65534,mode=0700",
            "--tmpfs",
            "/control:uid=65534,gid=65534,mode=0700",
        ],
        &harness,
    )
    .await;
    assert!(ok, "{output}");
    let result: serde_json::Value =
        serde_json::from_str(output.lines().last().unwrap_or_default()).unwrap();
    assert_eq!(result["agree"], true, "{output}");
    assert_eq!(
        result["kinds"],
        serde_json::json!(["directory", "fifo", "other", "regular", "socket", "symlink"])
    );
    assert_eq!(
        result["withheld"],
        serde_json::json!(["budget", "slots", "too_long", "unreadable"])
    );
}

/// The trusted Fargate stage script, run against a local manifest server:
/// pinned inputs and program land read-only, and a digest mismatch stops it.
async fn stage_script_verifies_pinned_inputs() {
    use http_body_util::Full;
    use hyper::{Response, body::Bytes, server::conn::http1, service::service_fn};
    use hyper_util::rt::TokioIo;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let input = b"account,amount\nA-1,10\n".to_vec();
    let program = b"print('staged')\n".to_vec();
    let manifest = |input_sha: &str| {
        serde_json::json!({
            "inputs": [{"name": "orig-a", "size": input.len(), "sha256": input_sha, "url": format!("http://127.0.0.1:{port}/input")}],
            "program": {"size": program.len(), "sha256": sha(&program), "url": format!("http://127.0.0.1:{port}/program")},
            "collect": {"manifest": "m", "slots": ["s0"], "output_file_bytes": 10, "output_total_bytes": 10},
        })
        .to_string()
        .into_bytes()
    };
    let files = Arc::new(std::collections::HashMap::from([
        ("/good".to_owned(), manifest(&sha(&input))),
        ("/tampered".to_owned(), manifest(&"0".repeat(64))),
        ("/input".to_owned(), input.clone()),
        ("/program".to_owned(), program.clone()),
    ]));
    let server = tokio::spawn(async move {
        loop {
            let (stream, _) = listener.accept().await.unwrap();
            let files = files.clone();
            tokio::spawn(async move {
                let _ = http1::Builder::new()
                    .serve_connection(
                        TokioIo::new(stream),
                        service_fn(move |request: hyper::Request<hyper::body::Incoming>| {
                            let body = files.get(request.uri().path()).cloned();
                            async move {
                                Ok::<_, std::convert::Infallible>(match body {
                                    Some(bytes) => Response::new(Full::new(Bytes::from(bytes))),
                                    None => Response::builder()
                                        .status(404)
                                        .body(Full::new(Bytes::new()))
                                        .unwrap(),
                                })
                            }
                        }),
                    )
                    .await;
            });
        }
    });
    let stage = include_str!("../../../deploy/qualification/analysis/stage.py");
    let check = r#"
import hashlib, json, os, stat
def info(path):
    mode = stat.S_IMODE(os.stat(path).st_mode)
    return [oct(mode), hashlib.sha256(open(path, 'rb').read()).hexdigest() if os.path.isfile(path) else None]
print(json.dumps({p: info(p) for p in ['/input', '/input/orig-a', '/job', '/job/program', '/control/collect.json', '/output']}))
"#;
    let mounts = [
        "--network",
        "host",
        "--user",
        "0:0",
        "--cap-drop",
        "ALL",
        "--tmpfs",
        "/input",
        "--tmpfs",
        "/job",
        "--tmpfs",
        "/control",
        "--tmpfs",
        "/output",
    ];
    let run = |path: &str| {
        let mut arguments: Vec<String> = mounts.iter().map(|v| (*v).to_owned()).collect();
        arguments.extend([
            "-e".into(),
            format!("ZOBBA_STAGE_URL=http://127.0.0.1:{port}{path}"),
        ]);
        arguments
    };
    let good = run("/good");
    let good: Vec<&str> = good.iter().map(String::as_str).collect();
    let (ok, output) = docker_python(
        &good,
        &format!("exec(compile({stage:?}, 'stage', 'exec'))\nexec({check:?})"),
    )
    .await;
    assert!(ok, "{output}");
    let facts: serde_json::Value =
        serde_json::from_str(output.lines().last().unwrap_or_default()).unwrap();
    assert_eq!(
        facts["/input/orig-a"],
        serde_json::json!(["0o444", sha(&input)])
    );
    assert_eq!(
        facts["/job/program"],
        serde_json::json!(["0o444", sha(&program)])
    );
    assert_eq!(facts["/input"][0], "0o555");
    assert_eq!(facts["/control/collect.json"][0], "0o444");
    let tampered = run("/tampered");
    let tampered: Vec<&str> = tampered.iter().map(String::as_str).collect();
    let (ok, output) = docker_python(
        &tampered,
        &format!("exec(compile({stage:?}, 'stage', 'exec'))"),
    )
    .await;
    assert!(!ok, "a digest mismatch must stop staging: {output}");
    server.abort();
}

/// Each guard refuses a direct owner write that the trusted path never makes.
async fn database_guards_refuse_owner_writes(world: &mut World) {
    async fn fabricated(world: &mut World, name: &str, last: &[&str]) -> (String, String) {
        let (_, basis) = world.task(name).await;
        let job = world
            .analysis()
            .admit(
                &target(),
                &basis,
                name,
                &world.request("print(1)\n", limits(60)),
            )
            .await
            .unwrap();
        let consumed = world
            .store
            .consume(&basis, &job.job.operation_id)
            .await
            .unwrap();
        for (sequence, status) in last.iter().enumerate() {
            sqlx::query("INSERT INTO public.analysis_job_events(organisation_id,client_id,engagement_id,job_id,sequence,status,attempt_id) VALUES('org-a','client-a','engagement-a',$1,$2,$3,$4)")
                .bind(&job.job.id).bind(sequence as i32 + 1).bind(status).bind(&consumed.attempt_id)
                .execute(&mut world.admin).await.unwrap();
        }
        (job.job.id, consumed.attempt_id)
    }
    async fn descendant(
        world: &mut World,
        job: &str,
        attempt: &str,
        path: &str,
        fold: &str,
        parents: &str,
    ) -> Result<(), sqlx::Error> {
        let id = format!("guard-{}", &sha(format!("{job}{path}").as_bytes())[..24]);
        sqlx::query("INSERT INTO public.analysis_descendants(organisation_id,client_id,engagement_id,id,job_id,attempt_id,path,fold_key,parents,digest,size,media_type,namespace,version) VALUES('org-a','client-a','engagement-a',$1,$2,$3,$4,$5,$6::jsonb,$7,1,'text/plain',$8,'v1')")
            .bind(id).bind(job).bind(attempt).bind(path).bind(fold).bind(parents)
            .bind("e".repeat(64)).bind(NAMESPACE)
            .execute(&mut world.admin).await.map(|_| ())
    }
    let parents = r#"["analysis-input-a"]"#;
    // Outputs exist only after confirmed termination of the current attempt.
    let (stopped, stopped_attempt) =
        fabricated(world, "guard-stopped", &["possibly_started", "stopped"]).await;
    assert!(
        descendant(world, &stopped, &stopped_attempt, "a.txt", "a.txt", parents)
            .await
            .is_err()
    );
    let (unknown, unknown_attempt) =
        fabricated(world, "guard-unknown", &["possibly_started", "unknown"]).await;
    assert!(
        descendant(world, &unknown, &unknown_attempt, "a.txt", "a.txt", parents)
            .await
            .is_err()
    );
    let (job, attempt) =
        fabricated(world, "guard-completed", &["possibly_started", "completed"]).await;
    // Wrong parents and a non-current attempt are refused.
    assert!(
        descendant(world, &job, &attempt, "a.txt", "a.txt", r#"["other"]"#)
            .await
            .is_err()
    );
    assert!(
        descendant(world, &job, &stopped_attempt, "a.txt", "a.txt", parents)
            .await
            .is_err()
    );
    // A valid descendant, then a case-fold duplicate of it, is refused.
    descendant(
        world,
        &job,
        &attempt,
        "Stra\u{df}e.txt",
        &fold_key("Stra\u{df}e.txt"),
        parents,
    )
    .await
    .unwrap();
    assert!(
        descendant(
            world,
            &job,
            &attempt,
            "STRASSE.txt",
            &fold_key("STRASSE.txt"),
            parents
        )
        .await
        .is_err(),
        "the folded key is unique per job"
    );
    // A collection receipt that does not match its rows is refused.
    let mismatch = sqlx::query("INSERT INTO public.analysis_job_events(organisation_id,client_id,engagement_id,job_id,sequence,status,attempt_id,receipt) VALUES('org-a','client-a','engagement-a',$1,3,'collected',$2,$3::jsonb)")
        .bind(&job).bind(&attempt)
        .bind(r#"{"descendants":[],"rejected_count":1,"rejected_sample":[]}"#)
        .execute(&mut world.admin).await;
    assert!(mismatch.is_err());
    // A start refusal needs MAX_START_ATTEMPTS attempts.
    let (absent, absent_attempt) = fabricated(world, "guard-absent", &["absent"]).await;
    let refused = sqlx::query("INSERT INTO public.analysis_job_events(organisation_id,client_id,engagement_id,job_id,sequence,status,attempt_id,reason) VALUES('org-a','client-a','engagement-a',$1,2,'failed',$2,'start_refused')")
        .bind(&absent).bind(&absent_attempt).execute(&mut world.admin).await;
    assert!(refused.is_err());
    // Every analysis record is immutable, even for the owner.
    for statement in [
        "UPDATE public.analysis_jobs SET program=program WHERE id=$1",
        "UPDATE public.analysis_job_events SET reason=reason WHERE job_id=$1",
        "UPDATE public.analysis_descendants SET path=path WHERE job_id=$1",
    ] {
        assert!(
            sqlx::query(statement)
                .bind(&job)
                .execute(&mut world.admin)
                .await
                .is_err(),
            "{statement}"
        );
    }
}

/// End to end through the coordinator: a Task left waiting on a lost running
/// job is reconciled by `advance` (bounded watch, collection), never re-run.
async fn coordinator_reconciles_a_lost_running_job(world: &mut World) {
    let (receipt, basis) = world.task("coordinated-loss").await;
    let program = format!(
        "import time\ntime.sleep(3)\nopen('/output/late.txt', 'w').write('{OUTPUT_SENTINEL}')\n"
    );
    let job = world
        .analysis()
        .admit(
            &target(),
            &basis,
            "coordinated-loss",
            &world.request(&program, limits(60)),
        )
        .await
        .unwrap();
    {
        let cancellation = ModelCancellation::new();
        let analysis = world.analysis();
        let mut skip = Vec::new();
        let run = analysis.run_next(&basis, &cancellation, &mut skip);
        tokio::pin!(run);
        tokio::select! {
            _ = &mut run => panic!("the job finished before the simulated loss"),
            _ = async {
                loop {
                    if world.jobs.job("actor-a", &scope(), &job.job.id).await.unwrap().latest.status == JobStatus::Running { break; }
                    tokio::time::sleep(Duration::from_millis(50)).await;
                }
            } => {}
        }
    }
    // The lost worker's Task lease runs out.
    sqlx::query(
        "UPDATE public.tasks SET owner_until=clock_timestamp()-interval '1 second' WHERE id=$1",
    )
    .bind(&receipt.task_id)
    .execute(&mut world.admin)
    .await
    .unwrap();
    let mut composition = world.composition();
    composition.reconcile_watch = Duration::from_secs(20);
    let config = executor::Config::new(PathBuf::from("/bin/false"), 10).unwrap();
    let (shutdown, receiver) = tokio::sync::watch::channel(false);
    let coordinator = tokio::spawn(zobba_worker::coordinate_runner(
        zobba_infrastructure::dispatcher::Dispatcher::new(world.pool.clone()),
        world.tasks.clone(),
        config,
        Some(Arc::new(composition) as Arc<dyn WorkRunner>),
        receiver,
    ));
    let collected = wait_for_long(world, &job.job.id, JobStatus::Collected, 120).await;
    shutdown.send(true).unwrap();
    tokio::time::timeout(Duration::from_secs(60), coordinator)
        .await
        .unwrap()
        .unwrap();
    let history = world
        .store
        .history(
            "actor-a",
            &scope(),
            &job.job.operation_id,
            &OperationHistoryQuery::default(),
        )
        .await
        .unwrap();
    assert_eq!(history.attempts.len(), 1, "never re-run");
    assert!(history.observations.iter().any(|o| o.attempt_id
        == collected.latest.attempt_id.clone().unwrap()
        && o.fact == SourceFact::Completed));
    assert_eq!(
        world
            .jobs
            .descendants("actor-a", &scope(), &job.job.id)
            .await
            .unwrap()
            .len(),
        1
    );
}

async fn wait_for_long(world: &World, job_id: &str, wanted: JobStatus, seconds: u64) -> JobRecord {
    let deadline = Instant::now() + Duration::from_secs(seconds);
    loop {
        let record = world.jobs.job("actor-a", &scope(), job_id).await.unwrap();
        if record.latest.status == wanted {
            return record;
        }
        assert!(
            Instant::now() < deadline,
            "job did not reach {wanted:?}: {:?}",
            record.latest
        );
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}
