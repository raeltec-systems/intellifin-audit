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
        JobRecord, SandboxState,
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
            .run_next(&basis, &ModelCancellation::new())
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
    nothing_sensitive_is_recorded(&mut world).await;
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
        .collect();
    assert_eq!(
        statuses,
        [
            "admitted",
            "possibly_started",
            "running",
            "completed",
            "collected"
        ]
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
    assert_eq!(receipt["rejected"].as_array().unwrap().len(), 9);
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
        world.sandbox.status(&handle).await.unwrap(),
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
        let run = analysis.run_next(&basis, &cancellation);
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
        world.sandbox.status(&handle).await.unwrap(),
        SandboxState::Running,
        "the job outlived its worker"
    );
    // The worker's reconciliation path after a restart: lookup and resumed watch.
    let composition = world.composition();
    assert!(composition.reconcile(&route(&receipt)).await);
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
        .recover("actor-a", &scope(), &job.job.id, &ModelCancellation::new())
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
            .run_next(&basis, &ModelCancellation::new())
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
        .run_next(&replacement, &ModelCancellation::new())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(done.latest.status, JobStatus::Collected);
    let statuses: Vec<String> = world
        .statuses(&job.job.id)
        .await
        .into_iter()
        .map(|s| s.0)
        .collect();
    assert_eq!(
        statuses,
        [
            "admitted",
            "absent",
            "possibly_started",
            "running",
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
