//! Real PostgreSQL and OS-process proof. This target resets only guarded *_test DBs.
use sqlx::{Connection, Executor, PgConnection, PgPool, postgres::PgPoolOptions};
use std::{
    process::Stdio,
    time::{Duration, Instant},
};
use tokio::process::{Child, Command};
use zobba_application::task::{TaskCommands, TaskError};
use zobba_domain::{
    identity::Scope,
    task::{Cessation, CommandKind, CommandReceipt, TaskCommand, TaskState},
};
use zobba_infrastructure::{
    database_options, dispatcher::Dispatcher, fixture::seed_local_configured, migrate,
    task::TaskRepository,
};

#[path = "../../infrastructure/tests/support/mod.rs"]
mod support;

fn scope() -> Scope {
    Scope {
        organisation_id: "org-a".into(),
        client_id: "client-a".into(),
        engagement_id: "engagement-a".into(),
    }
}

fn create(key: &str) -> TaskCommand {
    TaskCommand {
        key: key.into(),
        kind: CommandKind::Create,
        task_id: None,
        cycle_id: None,
        content: Some("Bounded inert process verification; no audit work".into()),
    }
}

fn control(key: &str, kind: CommandKind, receipt: &CommandReceipt) -> TaskCommand {
    TaskCommand {
        key: key.into(),
        kind,
        task_id: Some(receipt.task_id.clone()),
        cycle_id: Some(receipt.cycle_id.clone()),
        content: (kind == CommandKind::Guide).then(|| "Retained guidance while paused".into()),
    }
}

fn worker(runtime: &str, duration_ms: u64) -> Child {
    Command::new(env!("CARGO_BIN_EXE_zobba-worker"))
        .env_clear()
        .env("ZOBBA_RUNTIME_DATABASE_URL", runtime)
        .env("ZOBBA_WORKER_BIND", "127.0.0.1:0")
        .env("ZOBBA_INERT_DURATION_MS", duration_ms.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .expect("spawn worker")
}

async fn eventually<T, F, Fut>(mut check: F) -> T
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Option<T>>,
{
    let deadline = tokio::time::Instant::now() + Duration::from_secs(20);
    loop {
        if let Some(value) = check().await {
            return value;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "durable process condition did not become true"
        );
        tokio::time::sleep(Duration::from_millis(40)).await;
    }
}

async fn consumed(pool: &PgPool, task: &str, previous: Option<&str>) -> (String, String) {
    eventually(|| async {
        let rows: Vec<(String,String)> = sqlx::query_as("SELECT id,process_instance FROM public.task_claims WHERE task_id=$1 AND state='consumed'")
            .bind(task).fetch_all(pool).await.unwrap();
        rows.into_iter().find(|(id,_)| Some(id.as_str()) != previous)
    }).await
}

async fn observation(pool: &PgPool, claim: &str) -> String {
    eventually(|| async {
        sqlx::query_scalar("SELECT outcome FROM public.task_observations WHERE claim_id=$1")
            .bind(claim)
            .fetch_optional(pool)
            .await
            .unwrap()
    })
    .await
}

async fn state(repository: &TaskRepository, task: &str, expected: TaskState, cessation: Cessation) {
    eventually(|| async {
        let task = repository.get("actor-a", &scope(), task).await.unwrap();
        (task.state == expected && task.cessation == cessation).then_some(())
    })
    .await
}

/// Exact argv token identifies only this test's inert child. Never kill by name.
fn child_pid(instance: &str) -> Option<u32> {
    for entry in std::fs::read_dir("/proc").expect("Linux process proof requires procfs") {
        let entry = entry.ok()?;
        let Some(pid) = entry
            .file_name()
            .to_str()
            .and_then(|name| name.parse::<u32>().ok())
        else {
            continue;
        };
        let Ok(arguments) = std::fs::read(entry.path().join("cmdline")) else {
            continue;
        };
        let args = arguments.split(|byte| *byte == 0).collect::<Vec<_>>();
        if args.get(1).copied() == Some(b"--inert-child".as_slice())
            && args.get(3).copied() == Some(instance.as_bytes())
        {
            return Some(pid);
        }
    }
    None
}

/// Linux start time binds this observation to one process despite PID reuse.
fn process_state(pid: u32) -> Option<(u64, char)> {
    let stat = match std::fs::read_to_string(format!("/proc/{pid}/stat")) {
        Ok(stat) => stat,
        Err(error)
            if error.kind() == std::io::ErrorKind::NotFound || error.raw_os_error() == Some(3) =>
        {
            return None;
        }
        Err(error) => panic!("cannot inspect owned process state: {error}"),
    };
    let fields: Vec<_> = stat
        .rsplit_once(") ")
        .expect("procfs stat contains the command terminator")
        .1
        .split_whitespace()
        .collect();
    Some((
        fields[19].parse().expect("procfs start time is numeric"),
        fields[0]
            .chars()
            .next()
            .expect("procfs process state exists"),
    ))
}

async fn signal(pid: u32, signal: &str) {
    let status = Command::new("/bin/kill")
        .arg(signal)
        .arg(pid.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
        .expect("signal this test's process");
    assert!(status.success());
}

async fn stop_worker(worker: &mut Child) {
    if let Some(pid) = worker.id() {
        signal(pid, "-TERM").await;
        assert!(
            tokio::time::timeout(Duration::from_secs(12), worker.wait())
                .await
                .expect("worker drains exact child handles")
                .unwrap()
                .success()
        );
    }
}

#[tokio::test]
async fn durable_controls_crash_recovery_and_revocation_use_real_children() {
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
        .max_connections(4)
        .connect_with(options)
        .await
        .unwrap();
    let administrator = PgPoolOptions::new()
        .max_connections(2)
        .connect(&configuration.admin)
        .await
        .unwrap();
    let repository = TaskRepository::new(runtime.clone());

    // With no notification mechanism, committed work is still found by polling.
    let first = repository
        .admit("actor-a", &scope(), &create("process_pause"))
        .await
        .unwrap();
    // Repeatedly due old routes must not starve untouched newer routes. A
    // revoked route has exactly this delivery behavior: it stays pending.
    let mut probes = Vec::new();
    for index in 0..3 {
        probes.push(
            repository
                .admit(
                    "actor-a",
                    &scope(),
                    &create(&format!("process_fairness_{index}")),
                )
                .await
                .unwrap(),
        );
    }
    let dispatcher = Dispatcher::new(runtime.clone());
    let mut delivered = std::collections::HashSet::new();
    for _ in 0..4 {
        let route = dispatcher
            .take(1, "fairness_worker")
            .await
            .unwrap()
            .pop()
            .unwrap();
        assert!(
            delivered.insert(route.task_id.clone()),
            "old pending wakeups must not starve later routes"
        );
        dispatcher.release(&route, "fairness_worker").await.unwrap();
        sqlx::query("UPDATE public.task_deliveries SET delivery_until=clock_timestamp()-interval '1 millisecond' WHERE wakeup_id=$1")
            .bind(&route.id).execute(&administrator).await.unwrap();
    }
    for (index, probe) in probes.iter().enumerate() {
        repository
            .admit(
                "actor-a",
                &scope(),
                &control(
                    &format!("process_fairness_stop_{index}"),
                    CommandKind::Stop,
                    probe,
                ),
            )
            .await
            .unwrap();
    }
    let mut original = worker(&configuration.runtime, 10_000);
    let (claim, instance) = consumed(&administrator, &first.task_id, None).await;
    eventually(|| async { child_pid(&instance) }).await;
    let admitted = Instant::now();
    let pause = repository
        .admit(
            "actor-a",
            &scope(),
            &control("process_pause_control", CommandKind::Pause, &first),
        )
        .await
        .unwrap();
    assert!(
        admitted.elapsed() < Duration::from_secs(2),
        "control cannot wait for inert execution"
    );
    assert_eq!(pause.status.as_str(), "received");
    state(
        &repository,
        &first.task_id,
        TaskState::Paused,
        Cessation::Confirmed,
    )
    .await;
    assert_eq!(observation(&administrator, &claim).await, "cancelled");
    assert!(
        child_pid(&instance).is_none(),
        "cessation requires joined child"
    );

    repository
        .admit(
            "actor-a",
            &scope(),
            &control("process_guide", CommandKind::Guide, &first),
        )
        .await
        .unwrap();
    eventually(|| async {
        let task = repository
            .get("actor-a", &scope(), &first.task_id)
            .await
            .unwrap();
        (task.working_brief.contains("Retained guidance") && task.state == TaskState::Paused)
            .then_some(())
    })
    .await;
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM public.task_claims WHERE task_id=$1")
        .bind(&first.task_id)
        .fetch_one(&administrator)
        .await
        .unwrap();
    assert_eq!(count, 1, "guidance never resumes a paused task");
    let resume = repository
        .admit(
            "actor-a",
            &scope(),
            &control("process_resume", CommandKind::Resume, &first),
        )
        .await
        .unwrap();
    assert_eq!(resume.cycle_id, first.cycle_id);
    let (second_claim, second_instance) =
        consumed(&administrator, &first.task_id, Some(&claim)).await;
    eventually(|| async { child_pid(&second_instance) }).await;
    repository
        .admit(
            "actor-a",
            &scope(),
            &control("process_stop", CommandKind::Stop, &first),
        )
        .await
        .unwrap();
    state(
        &repository,
        &first.task_id,
        TaskState::Stopped,
        Cessation::Confirmed,
    )
    .await;
    assert_eq!(
        observation(&administrator, &second_claim).await,
        "cancelled"
    );
    let continued = repository
        .admit(
            "actor-a",
            &scope(),
            &control("process_continue", CommandKind::Continue, &first),
        )
        .await
        .unwrap();
    assert_ne!(continued.cycle_id, first.cycle_id);
    assert!(matches!(
        repository
            .admit(
                "actor-a",
                &scope(),
                &control("process_stale_stop", CommandKind::Stop, &first)
            )
            .await,
        Err(TaskError::Conflict | TaskError::Fenced)
    ));
    let (third_claim, third_instance) =
        consumed(&administrator, &first.task_id, Some(&second_claim)).await;
    eventually(|| async { child_pid(&third_instance) }).await;
    stop_worker(&mut original).await;
    assert_eq!(observation(&administrator, &third_claim).await, "cancelled");
    assert!(
        child_pid(&third_instance).is_none(),
        "graceful shutdown joins its child"
    );

    // Abrupt worker loss removes the only receipt capability and Child handle.
    // Even after the orphan stops, a replacement cannot invent its observation.
    let crashed = repository
        .admit("actor-a", &scope(), &create("process_crash"))
        .await
        .unwrap();
    let mut lost = worker(&configuration.runtime, 10_000);
    let (lost_claim, lost_instance) = consumed(&administrator, &crashed.task_id, None).await;
    let (orphan_pid, orphan_started) = eventually(|| async {
        let pid = child_pid(&lost_instance)?;
        let (started, state) = process_state(pid)?;
        (state != 'Z').then_some((pid, started))
    })
    .await;
    lost.start_kill().unwrap();
    lost.wait().await.unwrap();
    let mut replacement = worker(&configuration.runtime, 100);
    let independent = repository
        .admit("actor-a", &scope(), &create("process_independent"))
        .await
        .unwrap();
    state(
        &repository,
        &independent.task_id,
        TaskState::Waiting,
        Cessation::Confirmed,
    )
    .await;
    state(
        &repository,
        &crashed.task_id,
        TaskState::Waiting,
        Cessation::ReconciliationRequired,
    )
    .await;
    let counts: (i64,i64) = sqlx::query_as("SELECT (SELECT count(*) FROM public.task_claims WHERE task_id=$1),(SELECT count(*) FROM public.task_observations WHERE claim_id=$2)")
        .bind(&crashed.task_id).bind(&lost_claim).fetch_one(&administrator).await.unwrap();
    assert_eq!(
        counts,
        (1, 0),
        "replacement never replays a consumed unknown claim"
    );
    // Its PID is no longer backed by an owned Child handle. Never signal it.
    // Some container init processes do not reap orphans: an exact matching
    // zombie proves kernel termination, not joining, reaping or success. This
    // test observation cannot replace the lost capability's durable receipt.
    eventually(|| async {
        match process_state(orphan_pid) {
            None => Some(()),
            Some((started, state)) if started != orphan_started || state == 'Z' => Some(()),
            _ => None,
        }
    })
    .await;
    assert!(child_pid(&lost_instance).is_none());
    repository
        .admit(
            "actor-a",
            &scope(),
            &control("process_stop_unknown", CommandKind::Stop, &crashed),
        )
        .await
        .unwrap();
    state(
        &repository,
        &crashed.task_id,
        TaskState::Stopped,
        Cessation::ReconciliationRequired,
    )
    .await;
    assert!(matches!(
        repository
            .admit(
                "actor-a",
                &scope(),
                &control("process_continue_unknown", CommandKind::Continue, &crashed)
            )
            .await,
        Err(TaskError::Conflict)
    ));
    stop_worker(&mut replacement).await;

    // Revocation ends new authority while the consumed attempt retains only its
    // exact immutable receipt capability. No public receipt endpoint exists.
    let revoked = repository
        .admit("actor-a", &scope(), &create("process_revocation"))
        .await
        .unwrap();
    let mut revocation_worker = worker(&configuration.runtime, 10_000);
    let (revoked_claim, revoked_instance) = consumed(&administrator, &revoked.task_id, None).await;
    eventually(|| async { child_pid(&revoked_instance) }).await;
    sqlx::query("UPDATE public.organisation_memberships SET active=false WHERE organisation_id='org-a' AND actor_id='actor-a'").execute(&administrator).await.unwrap();
    assert_eq!(
        observation(&administrator, &revoked_claim).await,
        "cancelled"
    );
    assert!(child_pid(&revoked_instance).is_none());
    assert_eq!(
        repository.get("actor-a", &scope(), &revoked.task_id).await,
        Err(TaskError::Denied)
    );
    stop_worker(&mut revocation_worker).await;
    sqlx::query("UPDATE public.organisation_memberships SET active=true WHERE organisation_id='org-a' AND actor_id='actor-a'").execute(&administrator).await.unwrap();

    // Saturated child capacity does not reserve a connection or prevent a
    // control. Releasing one joined child makes room for the fifth Task.
    let mut batch = Vec::new();
    for index in 0..5 {
        batch.push(
            repository
                .admit(
                    "actor-a",
                    &scope(),
                    &create(&format!("process_capacity_{index}")),
                )
                .await
                .unwrap(),
        );
    }
    let task_ids = batch
        .iter()
        .map(|receipt| receipt.task_id.clone())
        .collect::<Vec<_>>();
    let mut bounded_worker = worker(&configuration.runtime, 10_000);
    let active = eventually(|| async {
        let rows: Vec<(String,String)> = sqlx::query_as("SELECT task_id,process_instance FROM public.task_claims WHERE task_id=ANY($1) AND state='consumed'")
            .bind(&task_ids).fetch_all(&administrator).await.unwrap();
        (rows.len() == zobba_worker::MAX_CHILDREN && rows.iter().all(|(_,instance)| child_pid(instance).is_some())).then_some(rows)
    }).await;
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM public.task_claims WHERE task_id=ANY($1)")
            .bind(&task_ids)
            .fetch_one(&administrator)
            .await
            .unwrap();
    assert_eq!(
        count,
        zobba_worker::MAX_CHILDREN as i64,
        "fifth task stays durably pending without a child slot"
    );
    let selected = batch
        .iter()
        .find(|receipt| receipt.task_id == active[0].0)
        .unwrap();
    let last = batch
        .iter()
        .find(|receipt| !active.iter().any(|(task, _)| *task == receipt.task_id))
        .unwrap();
    let admitted = Instant::now();
    repository
        .admit(
            "actor-a",
            &scope(),
            &control("process_capacity_stop", CommandKind::Stop, selected),
        )
        .await
        .unwrap();
    assert!(admitted.elapsed() < Duration::from_secs(2));
    state(
        &repository,
        &selected.task_id,
        TaskState::Stopped,
        Cessation::Confirmed,
    )
    .await;
    let (_, last_instance) = consumed(&administrator, &last.task_id, None).await;
    eventually(|| async { child_pid(&last_instance) }).await;
    stop_worker(&mut bounded_worker).await;
    for (_, instance) in active {
        assert!(child_pid(&instance).is_none());
    }
    assert!(child_pid(&last_instance).is_none());
    runtime.close().await;
    administrator.close().await;
}
