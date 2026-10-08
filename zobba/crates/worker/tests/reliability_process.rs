//! Fault injection lives only in this integration-test executable. Each helper
//! process runs the production coordinator and real SQL/process adapters.
use sqlx::{Connection, Executor, PgConnection, PgPool, postgres::PgPoolOptions};
use std::{
    future::Future,
    path::PathBuf,
    process::Stdio,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    process::{Child, Command},
    sync::watch,
    task::{JoinHandle, JoinSet},
    time::{sleep, timeout},
};
use zobba_application::task::{TaskCommands, TaskDelivery, TaskError, TaskExecution};
use zobba_domain::{
    identity::Scope,
    task::{
        Cessation, ClaimBasis, CommandKind, ConsumedAttempt, Decision, Observation, TaskCommand,
        TaskState, WakeupRoute,
    },
};
use zobba_infrastructure::{
    database_options, dispatcher::Dispatcher, fixture::seed_local_configured, migrate,
    task::TaskRepository,
};
use zobba_worker::{coordinate_with, executor::Config};

#[path = "../../infrastructure/tests/support/mod.rs"]
mod support;

const WAIT: Duration = Duration::from_secs(25);
static NEXT_DIRECTORY: AtomicU64 = AtomicU64::new(1);

fn scope() -> Scope {
    Scope {
        organisation_id: "org-a".into(),
        client_id: "client-a".into(),
        engagement_id: "engagement-a".into(),
    }
}

fn create(key: &str) -> TaskCommand {
    TaskCommand {
        context: None,
        key: key.into(),
        kind: CommandKind::Create,
        task_id: None,
        cycle_id: None,
        content: Some("Inert reliability process proof".into()),
    }
}

async fn eventually<T>(mut check: impl AsyncFnMut() -> Option<T>) -> T {
    timeout(WAIT, async {
        loop {
            if let Some(value) = check().await {
                return value;
            }
            sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("process condition must become true within its bound")
}

fn child_present(instance: &str) -> bool {
    std::fs::read_dir("/proc")
        .expect("Linux procfs is required")
        .any(|entry| {
            let Ok(entry) = entry else {
                return false;
            };
            let Ok(command) = std::fs::read(entry.path().join("cmdline")) else {
                return false;
            };
            let arguments: Vec<_> = command.split(|byte| *byte == 0).collect();
            arguments.get(1).copied() == Some(b"--inert-child".as_slice())
                && arguments.get(3).copied() == Some(instance.as_bytes())
        })
}

struct Markers(PathBuf);
impl Markers {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "zobba-process-{}-{}",
            std::process::id(),
            NEXT_DIRECTORY.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir(&path).unwrap();
        Self(path)
    }
    fn has(&self, name: &str) -> bool {
        self.0.join(name).exists()
    }
    fn put(&self, name: &str) {
        std::fs::write(self.0.join(name), b"ready").unwrap();
    }
    async fn wait(&self, name: &str) {
        eventually(async || self.has(name).then_some(())).await;
    }
}
impl Drop for Markers {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

struct GateGuard {
    path: PathBuf,
    finished: bool,
}
impl Drop for GateGuard {
    fn drop(&mut self) {
        if !self.finished {
            let _ = std::fs::write(self.path.join("gate_cancelled"), b"cancelled");
        }
    }
}

#[derive(Clone)]
struct TestPorts {
    delivery: Dispatcher,
    repository: TaskRepository,
    admin: Option<PgPool>,
    role: String,
    mode: String,
    target: String,
    markers: PathBuf,
    gate_taken: Arc<AtomicBool>,
    first_observation: Arc<Mutex<Option<(ClaimBasis, String, Observation)>>>,
}

impl TestPorts {
    fn mark(&self, name: &str) {
        std::fs::write(self.markers.join(name), b"ready").unwrap();
    }

    async fn call<T>(
        &self,
        stage: &str,
        operation: impl Future<Output = Result<T, TaskError>> + Send,
    ) -> Result<T, TaskError> {
        let mut guard = if self.mode.strip_prefix("stall_") == Some(stage)
            && !self.gate_taken.swap(true, Ordering::SeqCst)
        {
            self.mark("gate_entered");
            let guard = GateGuard {
                path: self.markers.clone(),
                finished: false,
            };
            while !self.markers.join("gate_go").exists() {
                sleep(Duration::from_millis(5)).await;
            }
            Some(guard)
        } else {
            None
        };
        let result = operation.await;
        if let Some(guard) = &mut guard {
            guard.finished = true;
        }
        result
    }
}

impl TaskDelivery for TestPorts {
    async fn take(&self, limit: usize, worker: &str) -> Result<Vec<WakeupRoute>, TaskError> {
        self.call("discovery", self.delivery.take(limit, worker))
            .await
    }
    async fn release(&self, route: &WakeupRoute, worker: &str) -> Result<(), TaskError> {
        if route.task_id != self.target {
            return self.delivery.release(route, worker).await;
        }
        self.call("release", self.delivery.release(route, worker))
            .await
    }
}

impl TaskExecution for TestPorts {
    async fn coordinate(&self, route: &WakeupRoute, worker: &str) -> Result<Decision, TaskError> {
        if route.task_id != self.target {
            return self.repository.coordinate(route, worker).await;
        }
        self.call("coordinate", self.repository.coordinate(route, worker))
            .await
    }
    async fn consume(&self, basis: &ClaimBasis) -> Result<ConsumedAttempt, TaskError> {
        if basis.task_id == self.target && self.mode == "before_consume" {
            self.mark("before_consume");
            std::process::exit(81);
        }
        let attempt = self.call("consume", self.repository.consume(basis)).await?;
        if basis.task_id == self.target && self.mode == "after_consume" {
            // The actual transaction committed, but production advance has not
            // received the capability and therefore has not dispatched a child.
            self.mark("after_consume");
            std::process::exit(82);
        }
        Ok(attempt)
    }
    async fn current(&self, basis: &ClaimBasis) -> Result<bool, TaskError> {
        if basis.task_id == self.target && child_present(&basis.process_instance) {
            self.mark("child_witnessed");
        }
        self.repository.current(basis).await
    }
    async fn observe(
        &self,
        attempt: &ConsumedAttempt,
        outcome: Observation,
    ) -> Result<(), TaskError> {
        if self.mode == "receipt_failure" && attempt.basis.task_id == self.target {
            assert!(
                !child_present(&attempt.basis.process_instance),
                "receipt must follow actual child join"
            );
            assert_eq!(outcome, Observation::Completed);
            let first = {
                let mut original = self.first_observation.lock().unwrap();
                if let Some((basis, capability, observed)) = original.as_ref() {
                    assert_eq!(basis, &attempt.basis);
                    assert!(
                        capability == &attempt.receipt_capability,
                        "retry changed exact capability"
                    );
                    assert_eq!(observed, &outcome);
                    false
                } else {
                    *original = Some((
                        attempt.basis.clone(),
                        attempt.receipt_capability.clone(),
                        outcome,
                    ));
                    true
                }
            };
            if first {
                self.mark("child_joined");
                let admin = self.admin.as_ref().unwrap();
                // The guarded role name is a bounded SQL identifier. The failure
                // comes from PostgreSQL, not from a synthetic returned error.
                sqlx::query(&format!(
                    "REVOKE INSERT ON public.task_observations FROM \"{}\"",
                    self.role
                ))
                .execute(admin)
                .await
                .unwrap();
                let result = self.repository.observe(attempt, outcome).await;
                sqlx::query(&format!(
                    "GRANT INSERT ON public.task_observations TO \"{}\"",
                    self.role
                ))
                .execute(admin)
                .await
                .unwrap();
                assert_eq!(result, Err(TaskError::Unavailable));
                self.mark("first_write_failed");
                return result;
            }
            let result = self.repository.observe(attempt, outcome).await;
            if result.is_ok() {
                self.mark("same_receipt_retried");
            }
            return result;
        }
        self.call("observe", self.repository.observe(attempt, outcome))
            .await
    }
    async fn reconcile(&self, route: &WakeupRoute, worker: &str) -> Result<(), TaskError> {
        self.call("reconcile", self.repository.reconcile(route, worker))
            .await
    }
}

/// Spawned explicitly by the scenario below. No fault flag exists in production.
#[tokio::test]
#[ignore = "test-only helper subprocess; the parent supplies guarded configuration"]
async fn reliability_worker_helper() {
    let configuration = support::Configuration::from_environment();
    let mode = std::env::var("ZOBBA_RELIABILITY_TEST_MODE").unwrap();
    let markers = PathBuf::from(std::env::var("ZOBBA_RELIABILITY_TEST_MARKERS").unwrap());
    let target = std::env::var("ZOBBA_RELIABILITY_TEST_TARGET").unwrap();
    let mut options = database_options(&configuration.runtime).unwrap();
    let role = options.get_username().to_owned();
    if let Ok(port) = std::env::var("ZOBBA_RELIABILITY_TEST_PROXY") {
        options = options.host("127.0.0.1").port(port.parse().unwrap());
    }
    let runtime = PgPoolOptions::new()
        .max_connections(4)
        .acquire_timeout(Duration::from_secs(60))
        .connect_with(options)
        .await
        .unwrap();
    let admin = if mode == "receipt_failure" {
        Some(
            PgPoolOptions::new()
                .max_connections(1)
                .connect(&configuration.admin)
                .await
                .unwrap(),
        )
    } else {
        None
    };
    let ports = TestPorts {
        delivery: Dispatcher::new(runtime.clone()),
        repository: TaskRepository::new(runtime.clone()),
        admin,
        role,
        mode,
        target,
        markers,
        gate_taken: Arc::new(AtomicBool::new(false)),
        first_observation: Arc::new(Mutex::new(None)),
    };
    let (shutdown, receiver) = watch::channel(false);
    let mut terminate =
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).unwrap();
    tokio::spawn(async move {
        terminate.recv().await;
        let _ = shutdown.send(true);
    });
    ports.mark("helper_ready");
    let duration = std::env::var("ZOBBA_RELIABILITY_TEST_DURATION")
        .unwrap()
        .parse()
        .unwrap();
    let config = Config::new(PathBuf::from(env!("CARGO_BIN_EXE_zobba-worker")), duration).unwrap();
    coordinate_with(ports.clone(), ports, config, receiver).await;
}

fn helper(
    configuration: &support::Configuration,
    mode: &str,
    task: &str,
    markers: &Markers,
    proxy: Option<u16>,
    duration: u64,
) -> Child {
    let mut command = Command::new(std::env::current_exe().unwrap());
    command
        .args([
            "--ignored",
            "--exact",
            "reliability_worker_helper",
            "--nocapture",
        ])
        .env_clear()
        .env(
            "ZOBBA_TEST_MIGRATION_DATABASE_URL",
            &configuration.migration,
        )
        .env("ZOBBA_TEST_RUNTIME_DATABASE_URL", &configuration.runtime)
        .env("ZOBBA_TEST_ADMIN_DATABASE_URL", &configuration.admin)
        .env("ZOBBA_RELIABILITY_TEST_MODE", mode)
        .env("ZOBBA_RELIABILITY_TEST_TARGET", task)
        .env("ZOBBA_RELIABILITY_TEST_MARKERS", &markers.0)
        .env("ZOBBA_RELIABILITY_TEST_DURATION", duration.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::inherit())
        .kill_on_drop(true);
    if let Some(port) = proxy {
        command.env("ZOBBA_RELIABILITY_TEST_PROXY", port.to_string());
    }
    command.spawn().unwrap()
}

async fn request_shutdown(child: &Child) {
    // This PID is still owned by an unreaped Child handle, so it cannot be reused.
    let result = Command::new("/bin/kill")
        .arg("-TERM")
        .arg(child.id().unwrap().to_string())
        .status()
        .await
        .unwrap();
    assert!(result.success());
}

async fn stop(child: &mut Child) {
    request_shutdown(child).await;
    assert!(
        timeout(Duration::from_secs(18), child.wait())
            .await
            .expect("coordinator shutdown must be bounded with stalled database traffic")
            .unwrap()
            .success()
    );
}

async fn task_state(repository: &TaskRepository, task: &str, cessation: Cessation) {
    eventually(async || {
        let current = repository.get("actor-a", &scope(), task).await.unwrap();
        (current.state == TaskState::Waiting && current.cessation == cessation).then_some(())
    })
    .await;
}

async fn claims(admin: &PgPool, task: &str) -> Vec<(String, String, String)> {
    sqlx::query_as(
        "SELECT id,process_instance,state FROM public.task_claims WHERE task_id=$1 ORDER BY id",
    )
    .bind(task)
    .fetch_all(admin)
    .await
    .unwrap()
}

async fn observation_count(admin: &PgPool, task: &str) -> i64 {
    sqlx::query_scalar("SELECT count(*) FROM public.task_observations o JOIN public.task_claims c ON c.id=o.claim_id WHERE c.task_id=$1")
        .bind(task).fetch_one(admin).await.unwrap()
}

async fn assert_one_completed(admin: &PgPool, task: &str) {
    let rows: Vec<(String, String)> = sqlx::query_as("SELECT o.process_instance,o.outcome FROM public.task_observations o JOIN public.task_claims c ON c.id=o.claim_id WHERE c.task_id=$1")
        .bind(task).fetch_all(admin).await.unwrap();
    assert_eq!(
        rows.len(),
        1,
        "one actual attempt produces one immutable observation"
    );
    assert_eq!(rows[0].1, "completed");
    assert!(!child_present(&rows[0].0));
    let consumed: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM public.task_events WHERE task_id=$1 AND kind='consumed'",
    )
    .bind(task)
    .fetch_one(admin)
    .await
    .unwrap();
    assert_eq!(consumed, 1, "recovery must not dispatch duplicate work");
}

/// Pause both directions without closing either TCP connection or returning an
/// error. Pending bytes remain held until restoration, unlike a disconnect test.
struct BlackholeProxy {
    port: u16,
    paused: watch::Sender<bool>,
    held: Arc<AtomicU64>,
    server: JoinHandle<()>,
}
impl BlackholeProxy {
    async fn start(runtime: &str) -> Self {
        let options = database_options(runtime).unwrap();
        let destination = (options.get_host().to_owned(), options.get_port());
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let (paused, receiver) = watch::channel(false);
        let held = Arc::new(AtomicU64::new(0));
        let counter = held.clone();
        let server = tokio::spawn(async move {
            let mut connections = JoinSet::new();
            loop {
                tokio::select! {
                    accepted = listener.accept() => {
                        let (downstream, _) = accepted.unwrap();
                        let destination = destination.clone();
                        let pause = receiver.clone();
                        let held = counter.clone();
                        connections.spawn(async move {
                            let Ok(upstream) = TcpStream::connect((destination.0.as_str(), destination.1)).await else { return; };
                            let (client_read, client_write) = downstream.into_split();
                            let (server_read, server_write) = upstream.into_split();
                            let _ = tokio::try_join!(
                                relay(client_read, server_write, pause.clone(), held.clone()),
                                relay(server_read, client_write, pause, held));
                        });
                    }
                    _ = connections.join_next(), if !connections.is_empty() => {}
                }
            }
        });
        Self {
            port,
            paused,
            held,
            server,
        }
    }
    fn pause(&self) -> u64 {
        let before = self.held.load(Ordering::SeqCst);
        self.paused.send(true).unwrap();
        before
    }
    fn restore(&self) {
        self.paused.send(false).unwrap();
    }
    async fn wait_for_held_traffic(&self, before: u64) {
        eventually(async || (self.held.load(Ordering::SeqCst) > before).then_some(())).await;
    }
}
impl Drop for BlackholeProxy {
    fn drop(&mut self) {
        self.server.abort();
    }
}

async fn relay(
    mut reader: impl AsyncRead + Unpin,
    mut writer: impl AsyncWrite + Unpin,
    mut paused: watch::Receiver<bool>,
    held: Arc<AtomicU64>,
) -> std::io::Result<()> {
    let mut buffer = [0; 16_384];
    loop {
        let read = reader.read(&mut buffer).await?;
        if read == 0 {
            return Ok(());
        }
        if *paused.borrow() {
            held.fetch_add(1, Ordering::SeqCst);
            while *paused.borrow_and_update() {
                if paused.changed().await.is_err() {
                    return Ok(());
                }
            }
        }
        writer.write_all(&buffer[..read]).await?;
    }
}

#[tokio::test]
async fn production_process_faults_and_blackholed_transport_preserve_exact_facts() {
    let configuration = support::Configuration::from_environment();
    let mut owner = PgConnection::connect(&configuration.migration)
        .await
        .unwrap();
    configuration.guard_connection(&mut owner).await;
    owner.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public; REVOKE CREATE ON SCHEMA public FROM PUBLIC").await.unwrap();
    let options = database_options(&configuration.runtime).unwrap();
    migrate(&configuration.migration, options.get_username())
        .await
        .unwrap();
    seed_local_configured("https://localhost:9443", &configuration.migration)
        .await
        .unwrap();
    let runtime = PgPoolOptions::new()
        .max_connections(2)
        .connect_with(options)
        .await
        .unwrap();
    let admin = PgPoolOptions::new()
        .max_connections(2)
        .connect(&configuration.admin)
        .await
        .unwrap();
    let repository = TaskRepository::new(runtime.clone());

    for (mode, code, consumed) in [("before_consume", 81, false), ("after_consume", 82, true)] {
        let task = repository
            .admit("actor-a", &scope(), &create(mode))
            .await
            .unwrap();
        let markers = Markers::new();
        let mut failed = helper(&configuration, mode, &task.task_id, &markers, None, 600);
        let exit = timeout(WAIT, failed.wait())
            .await
            .expect("fault must exit actual worker process")
            .unwrap();
        assert_eq!(exit.code(), Some(code));
        assert!(
            markers.has(mode),
            "fault must occur at the selected production transition"
        );
        let before = claims(&admin, &task.task_id).await;
        assert_eq!(before.len(), 1);
        assert_eq!(before[0].2, if consumed { "consumed" } else { "admitted" });
        assert!(
            !child_present(&before[0].1),
            "crash cutoff precedes child spawning"
        );
        assert_eq!(observation_count(&admin, &task.task_id).await, 0);
        let slots: i64 =
            sqlx::query_scalar("SELECT count(*) FROM public.task_receipt_slots WHERE claim_id=$1")
                .bind(&before[0].0)
                .fetch_one(&admin)
                .await
                .unwrap();
        assert_eq!(slots, i64::from(consumed));
        let recovery_markers = Markers::new();
        let mut replacement = helper(
            &configuration,
            "normal",
            &task.task_id,
            &recovery_markers,
            None,
            600,
        );
        recovery_markers.wait("helper_ready").await;
        task_state(
            &repository,
            &task.task_id,
            if consumed {
                Cessation::ReconciliationRequired
            } else {
                Cessation::Confirmed
            },
        )
        .await;
        if consumed {
            assert_eq!(claims(&admin, &task.task_id).await, before);
            assert_eq!(observation_count(&admin, &task.task_id).await, 0);
            let independent = repository
                .admit("actor-a", &scope(), &create("after_crash_independent"))
                .await
                .unwrap();
            task_state(&repository, &independent.task_id, Cessation::Confirmed).await;
            assert_one_completed(&admin, &independent.task_id).await;
            assert_eq!(claims(&admin, &task.task_id).await, before);
            assert_eq!(observation_count(&admin, &task.task_id).await, 0);
        } else {
            let after = claims(&admin, &task.task_id).await;
            assert_eq!(after.len(), 2);
            assert!(
                after
                    .iter()
                    .any(|row| row.0 == before[0].0 && row.2 == "abandoned")
            );
            assert_one_completed(&admin, &task.task_id).await;
        }
        assert!(!child_present(&before[0].1));
        stop(&mut replacement).await;
    }

    let receipt = repository
        .admit("actor-a", &scope(), &create("receipt_retry"))
        .await
        .unwrap();
    let markers = Markers::new();
    let mut retrying = helper(
        &configuration,
        "receipt_failure",
        &receipt.task_id,
        &markers,
        None,
        1_000,
    );
    for marker in [
        "child_witnessed",
        "child_joined",
        "first_write_failed",
        "same_receipt_retried",
    ] {
        markers.wait(marker).await;
    }
    task_state(&repository, &receipt.task_id, Cessation::Confirmed).await;
    assert_eq!(claims(&admin, &receipt.task_id).await.len(), 1);
    assert_one_completed(&admin, &receipt.task_id).await;
    let incorporated: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM public.task_events WHERE task_id=$1 AND kind='observed'",
    )
    .bind(&receipt.task_id)
    .fetch_one(&admin)
    .await
    .unwrap();
    assert_eq!(incorporated, 1);
    stop(&mut retrying).await;

    let proxy = BlackholeProxy::start(&configuration.runtime).await;
    for stage in [
        "discovery",
        "coordinate",
        "consume",
        "release",
        "observe",
        "reconcile",
    ] {
        let task = repository
            .admit("actor-a", &scope(), &create(&format!("transport_{stage}")))
            .await
            .unwrap();
        let markers = Markers::new();
        let mut worker = helper(
            &configuration,
            &format!("stall_{stage}"),
            &task.task_id,
            &markers,
            Some(proxy.port),
            600,
        );
        markers.wait("gate_entered").await;
        let held = proxy.pause();
        markers.put("gate_go");
        proxy.wait_for_held_traffic(held).await;
        timeout(Duration::from_secs(4), markers.wait("gate_cancelled"))
            .await
            .expect("every production database stage requires a client-side deadline");
        proxy.restore();
        task_state(&repository, &task.task_id, Cessation::Confirmed).await;
        assert_one_completed(&admin, &task.task_id).await;
        stop(&mut worker).await;
    }

    let task = repository
        .admit("actor-a", &scope(), &create("blackhole_shutdown"))
        .await
        .unwrap();
    let markers = Markers::new();
    let mut worker = helper(
        &configuration,
        "normal",
        &task.task_id,
        &markers,
        Some(proxy.port),
        10_000,
    );
    markers.wait("child_witnessed").await;
    let claim = claims(&admin, &task.task_id).await.pop().unwrap();
    assert!(child_present(&claim.1));
    let held = proxy.pause();
    let shutdown_started = Instant::now();
    request_shutdown(&worker).await;
    proxy.wait_for_held_traffic(held).await;
    assert!(
        timeout(Duration::from_secs(18), worker.wait())
            .await
            .expect("shutdown must drain despite an actual TCP blackhole")
            .unwrap()
            .success()
    );
    assert!(shutdown_started.elapsed() < Duration::from_secs(18));
    assert!(
        !child_present(&claim.1),
        "shutdown must join its actual child"
    );
    assert_eq!(
        observation_count(&admin, &task.task_id).await,
        0,
        "exhausted writes must not pretend a durable observation exists"
    );
    proxy.restore();
    let replacement_markers = Markers::new();
    let mut replacement = helper(
        &configuration,
        "normal",
        &task.task_id,
        &replacement_markers,
        None,
        600,
    );
    replacement_markers.wait("helper_ready").await;
    task_state(
        &repository,
        &task.task_id,
        Cessation::ReconciliationRequired,
    )
    .await;
    assert_eq!(claims(&admin, &task.task_id).await, vec![claim]);
    assert_eq!(observation_count(&admin, &task.task_id).await, 0);
    stop(&mut replacement).await;
    runtime.close().await;
    admin.close().await;
}
