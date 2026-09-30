//! Real-process executor checks. No database or database credentials are used.
use std::{
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
    time::Duration,
};
use tokio::{process::Command, sync::watch, time::timeout};
use zobba_domain::identity::Scope;
use zobba_domain::task::{ClaimBasis, Observation};
use zobba_worker::executor::{Config, MAX_DURATION_MS, execute};

const WORKER: &str = env!("CARGO_BIN_EXE_zobba-worker");
const TEST_TIMEOUT: Duration = Duration::from_secs(5);
static NEXT_INSTANCE: AtomicU64 = AtomicU64::new(1);

fn basis() -> ClaimBasis {
    ClaimBasis {
        actor_id: "test_actor".into(),
        scope: Scope {
            organisation_id: "test_org".into(),
            client_id: "test_client".into(),
            engagement_id: "test_engagement".into(),
        },
        task_id: "test_task".into(),
        cycle_id: "test_cycle".into(),
        claim_id: "test_claim".into(),
        worker_id: "test_worker".into(),
        process_instance: format!(
            "test_process_{}_{}",
            std::process::id(),
            NEXT_INSTANCE.fetch_add(1, Ordering::Relaxed)
        ),
        owner_epoch: 1,
        execution_epoch: 1,
        intent_revision: 1,
    }
}

async fn child_output(arguments: &[&str]) -> std::process::Output {
    timeout(
        TEST_TIMEOUT,
        Command::new(WORKER)
            .args(arguments)
            .env_clear()
            .kill_on_drop(true)
            .output(),
    )
    .await
    .expect("internal child mode must finish without a database")
    .expect("worker binary must start")
}

#[tokio::test]
async fn child_mode_runs_without_database_configuration() {
    let output = child_output(&["--inert-child", "10", "test_process"]).await;
    assert!(output.status.success(), "{output:?}");
    assert!(output.stdout.is_empty());
    assert!(output.stderr.is_empty());
}

#[tokio::test]
async fn child_mode_rejects_malformed_or_unbounded_duration() {
    for duration in [
        "invalid",
        "-1",
        "10.5",
        "0",
        "9",
        "30001",
        "18446744073709551616",
    ] {
        let output = child_output(&["--inert-child", duration, "test_process"]).await;
        assert!(!output.status.success(), "accepted duration {duration}");
        assert!(output.stdout.is_empty());
    }
}

#[tokio::test]
async fn child_mode_rejects_invalid_process_tokens_and_extra_arguments() {
    let long_token = "a".repeat(129);
    for process in ["", "invalid/token", "invalid token", "é", &long_token] {
        let output = child_output(&["--inert-child", "10", process]).await;
        assert!(!output.status.success(), "accepted invalid process token");
        assert!(output.stdout.is_empty());
    }
    for arguments in [
        vec!["--inert-child"],
        vec!["--inert-child", "10"],
        vec!["--inert-child", "10", "test_process", "extra"],
    ] {
        assert!(!child_output(&arguments).await.status.success());
    }
}

#[test]
fn configuration_bounds_execution_duration() {
    for duration in [0, 9, MAX_DURATION_MS + 1, u64::MAX] {
        assert!(Config::new(PathBuf::from(WORKER), duration).is_err());
    }
    for duration in [10, MAX_DURATION_MS] {
        assert!(Config::new(PathBuf::from(WORKER), duration).is_ok());
    }
}

#[tokio::test]
async fn missing_executable_reports_not_started() {
    let basis = basis();
    let missing = std::env::temp_dir()
        .join(&basis.process_instance)
        .join("worker");
    assert!(!missing.exists());
    let config = Config::new(missing, 10).unwrap();
    let (_shutdown, receiver) = watch::channel(false);
    let outcome = execute(&config, &basis, receiver, || async {
        panic!("a failed spawn must not request authority")
    })
    .await;
    assert_eq!(outcome, Some(Observation::NotStarted));
}

#[tokio::test]
async fn shutdown_already_requested_reports_not_started() {
    let config = Config::new(PathBuf::from(WORKER), 10).unwrap();
    let (_shutdown, receiver) = watch::channel(true);
    let outcome = execute(&config, &basis(), receiver, || async {
        panic!("shutdown before execution must not request authority")
    })
    .await;
    assert_eq!(outcome, Some(Observation::NotStarted));
}

#[tokio::test]
async fn unsuccessful_actual_child_exit_is_not_completion() {
    let config = Config::new(PathBuf::from(WORKER), 10).unwrap();
    let mut basis = basis();
    // The actual worker child rejects this token and exits unsuccessfully.
    basis.process_instance = "invalid/process".into();
    let (_shutdown, receiver) = watch::channel(false);
    let outcome = timeout(
        TEST_TIMEOUT,
        execute(&config, &basis, receiver, || async { Ok(true) }),
    )
    .await
    .expect("failed child must be joined");
    assert_eq!(outcome, Some(Observation::Exited));
}

#[cfg(target_os = "linux")]
mod observed_process {
    use super::*;
    use std::sync::atomic::AtomicBool;
    use tokio::time::sleep;

    #[derive(Debug, PartialEq, Eq)]
    struct ProcessIdentity {
        pid: u32,
        parent: u32,
        started: u64,
    }

    fn identity(pid: u32) -> Option<ProcessIdentity> {
        let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
        // comm is parenthesized and may itself contain spaces or parentheses.
        let fields: Vec<_> = stat.rsplit_once(") ")?.1.split_whitespace().collect();
        Some(ProcessIdentity {
            pid,
            parent: fields.get(1)?.parse().ok()?,
            started: fields.get(19)?.parse().ok()?,
        })
    }

    fn find_child(process_instance: &str) -> Option<ProcessIdentity> {
        for entry in std::fs::read_dir("/proc").expect("Linux procfs is required") {
            let entry = entry.expect("procfs entry must be readable");
            let Some(pid) = entry
                .file_name()
                .to_str()
                .and_then(|name| name.parse().ok())
            else {
                continue;
            };
            let Ok(command) = std::fs::read(entry.path().join("cmdline")) else {
                continue;
            };
            let arguments: Vec<_> = command.split(|byte| *byte == 0).collect();
            if arguments.get(1).copied() == Some(b"--inert-child".as_slice())
                && arguments.get(3).copied() == Some(process_instance.as_bytes())
                && let Some(child) = identity(pid)
                && child.parent == std::process::id()
            {
                return Some(child);
            }
        }
        None
    }

    async fn wait_for_child(process_instance: &str) -> ProcessIdentity {
        timeout(TEST_TIMEOUT, async {
            loop {
                if let Some(child) = find_child(process_instance) {
                    return child;
                }
                sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("executor must create its actual child")
    }

    fn assert_joined(child: &ProcessIdentity) {
        // A killed but unreaped zombie still has the same /proc identity. The
        // start time also avoids mistaking reuse of its PID for a surviving child.
        assert_ne!(
            identity(child.pid).as_ref(),
            Some(child),
            "child was not joined"
        );
    }

    #[tokio::test]
    async fn completed_is_reported_only_after_actual_child_is_joined() {
        let config = Config::new(PathBuf::from(WORKER), 1_000).unwrap();
        let basis = basis();
        let (_shutdown, receiver) = watch::channel(false);
        let execution = execute(&config, &basis, receiver, || async { Ok(true) });
        tokio::pin!(execution);
        let child = tokio::select! {
            outcome = &mut execution => panic!("reported {outcome:?} before observing child"),
            child = wait_for_child(&basis.process_instance) => child,
        };
        assert_eq!(identity(child.pid).as_ref(), Some(&child));
        let outcome = timeout(TEST_TIMEOUT, execution)
            .await
            .expect("child must finish");
        assert_eq!(outcome, Some(Observation::Completed));
        assert_joined(&child);
    }

    #[tokio::test]
    async fn revoked_authority_cancels_and_joins_the_exact_child() {
        let config = Config::new(PathBuf::from(WORKER), 10_000).unwrap();
        let basis = basis();
        let current = AtomicBool::new(true);
        let (_shutdown, receiver) = watch::channel(false);
        let execution = execute(&config, &basis, receiver, || async {
            Ok(current.load(Ordering::SeqCst))
        });
        tokio::pin!(execution);
        let child = tokio::select! {
            outcome = &mut execution => panic!("reported {outcome:?} before revocation"),
            child = wait_for_child(&basis.process_instance) => child,
        };
        assert_eq!(identity(child.pid).as_ref(), Some(&child));
        current.store(false, Ordering::SeqCst);
        let outcome = timeout(TEST_TIMEOUT, execution)
            .await
            .expect("revocation must cancel");
        assert_eq!(outcome, Some(Observation::Cancelled));
        assert_joined(&child);
    }

    #[tokio::test]
    async fn shutdown_cancels_and_joins_the_exact_child() {
        let config = Config::new(PathBuf::from(WORKER), 10_000).unwrap();
        let basis = basis();
        let (shutdown, receiver) = watch::channel(false);
        let execution = execute(&config, &basis, receiver, || async { Ok(true) });
        tokio::pin!(execution);
        let child = tokio::select! {
            outcome = &mut execution => panic!("reported {outcome:?} before shutdown"),
            child = wait_for_child(&basis.process_instance) => child,
        };
        assert_eq!(identity(child.pid).as_ref(), Some(&child));
        shutdown.send(true).unwrap();
        let outcome = timeout(TEST_TIMEOUT, execution)
            .await
            .expect("shutdown must cancel");
        assert_eq!(outcome, Some(Observation::Cancelled));
        assert_joined(&child);
    }

    #[tokio::test]
    async fn actual_child_completion_remains_responsive_while_authority_is_stalled() {
        let config = Config::new(PathBuf::from(WORKER), 100).unwrap();
        let basis = basis();
        let requested = AtomicBool::new(false);
        let (_shutdown, receiver) = watch::channel(false);
        let execution = execute(&config, &basis, receiver, || async {
            requested.store(true, Ordering::SeqCst);
            std::future::pending().await
        });
        tokio::pin!(execution);
        let child = tokio::select! {
            outcome = &mut execution => panic!("reported {outcome:?} before observing child"),
            child = wait_for_child(&basis.process_instance) => child,
        };
        let outcome = timeout(Duration::from_millis(500), execution)
            .await
            .expect("actual completion must not wait for the stalled authority timeout");
        assert!(requested.load(Ordering::SeqCst));
        assert_eq!(outcome, Some(Observation::Completed));
        assert_joined(&child);
    }

    #[tokio::test]
    async fn actual_child_shutdown_remains_responsive_while_authority_is_stalled() {
        let config = Config::new(PathBuf::from(WORKER), 10_000).unwrap();
        let basis = basis();
        let requested = AtomicBool::new(false);
        let (shutdown, receiver) = watch::channel(false);
        let execution = execute(&config, &basis, receiver, || async {
            requested.store(true, Ordering::SeqCst);
            std::future::pending().await
        });
        tokio::pin!(execution);
        let child = tokio::select! {
            outcome = &mut execution => panic!("reported {outcome:?} before observing child"),
            child = wait_for_child(&basis.process_instance) => child,
        };
        tokio::select! {
            outcome = &mut execution => panic!("reported {outcome:?} before authority stalled"),
            _ = async {
                while !requested.load(Ordering::SeqCst) {
                    sleep(Duration::from_millis(1)).await;
                }
            } => {},
        }
        shutdown.send(true).unwrap();
        let outcome = timeout(Duration::from_millis(500), execution)
            .await
            .expect("shutdown must not wait for the stalled authority timeout");
        assert_eq!(outcome, Some(Observation::Cancelled));
        assert_joined(&child);
    }
}
