//! Own-binary inert subprocesses and the optional model work-cycle executor.
//! The inert child has no shell, model, tools, audit or desktop work.
use crate::diagnostics::{Code, Diagnostics};
use std::{future::Future, path::PathBuf, process::Stdio, time::Duration};
use tokio::{process::Command, sync::watch};
use zobba_application::{BootstrapError, task::TaskError};
use zobba_domain::task::{ClaimBasis, Observation};

const DEFAULT_DURATION_MS: u64 = 500;
pub const MAX_DURATION_MS: u64 = 30_000;
const AUTHORITY_POLL: Duration = Duration::from_millis(200);
const AUTHORITY_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Clone)]
pub struct Config {
    executable: PathBuf,
    duration_ms: u64,
    diagnostics: Diagnostics,
}

impl Config {
    pub fn from_environment() -> Result<Self, BootstrapError> {
        let duration_ms = match std::env::var("ZOBBA_INERT_DURATION_MS") {
            Ok(value) => value
                .parse()
                .map_err(|_| BootstrapError::InvalidConfiguration)?,
            Err(std::env::VarError::NotPresent) => DEFAULT_DURATION_MS,
            Err(_) => return Err(BootstrapError::InvalidConfiguration),
        };
        Self::new(
            std::env::current_exe().map_err(|_| BootstrapError::InvalidConfiguration)?,
            duration_ms,
        )
    }

    pub fn new(executable: PathBuf, duration_ms: u64) -> Result<Self, BootstrapError> {
        if !(10..=MAX_DURATION_MS).contains(&duration_ms) {
            return Err(BootstrapError::InvalidConfiguration);
        }
        Ok(Self {
            executable,
            duration_ms,
            diagnostics: Diagnostics::default(),
        })
    }

    pub fn diagnostics(&self) -> Diagnostics {
        self.diagnostics.clone()
    }
}

/// Internal child mode has no database access, environment credentials, output,
/// or operation selector. It sleeps for a bounded duration and exits normally.
pub async fn child_mode(arguments: &[String]) -> Result<(), BootstrapError> {
    if arguments.len() != 3
        || arguments[0] != "--inert-child"
        || !zobba_domain::identity::valid_scope_id(&arguments[2])
    {
        return Err(BootstrapError::InvalidConfiguration);
    }
    let duration_ms: u64 = arguments[1]
        .parse()
        .map_err(|_| BootstrapError::InvalidConfiguration)?;
    if !(10..=MAX_DURATION_MS).contains(&duration_ms) {
        return Err(BootstrapError::InvalidConfiguration);
    }
    tokio::time::sleep(Duration::from_millis(duration_ms)).await;
    Ok(())
}

/// None means the actual process could not be joined, so there is no factual
/// receipt. The consumed claim stays reconciliation-required; never replay it.
pub async fn execute<F, Fut>(
    config: &Config,
    basis: &ClaimBasis,
    mut shutdown: watch::Receiver<bool>,
    mut current: F,
) -> Option<Observation>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<bool, TaskError>>,
{
    if *shutdown.borrow() {
        return Some(Observation::NotStarted);
    }
    let mut child = match Command::new(&config.executable)
        .arg("--inert-child")
        .arg(config.duration_ms.to_string())
        .arg(&basis.process_instance)
        .env_clear()
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
    {
        Ok(child) => child,
        Err(_) => {
            config.diagnostics.record(Code::ProcessStartFailed);
            return Some(Observation::NotStarted);
        }
    };
    let mut ticker = tokio::time::interval(AUTHORITY_POLL);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let authority = async {
        loop {
            ticker.tick().await;
            match tokio::time::timeout(AUTHORITY_TIMEOUT, current()).await {
                Ok(Ok(true)) => {}
                Ok(Ok(false)) => return,
                _ => {
                    config.diagnostics.record(Code::AuthorityFailed);
                    return;
                }
            }
        }
    };
    // Authority I/O is a sibling future: a stalled socket cannot stop polling
    // the actual exit, shutdown signal or hard deadline.
    tokio::pin!(authority);
    tokio::select! {
        biased;
        status = child.wait() => return match status {
            Ok(status) => Some(if status.success() { Observation::Completed } else { Observation::Exited }),
            Err(_) => { config.diagnostics.record(Code::ProcessJoinUnconfirmed); None },
        },
        _ = shutdown.changed() => {},
        _ = tokio::time::sleep(Duration::from_millis(MAX_DURATION_MS + 1_000)) => {},
        _ = &mut authority => {},
    }
    // Requesting a kill proves nothing. Only a successful exact-handle join
    // authorises cancellation; a timeout remains reconciliation-required.
    let _ = child.start_kill();
    match tokio::time::timeout(Duration::from_secs(2), child.wait()).await {
        Ok(Ok(_)) => Some(Observation::Cancelled),
        _ => {
            config.diagnostics.record(Code::ProcessJoinUnconfirmed);
            None
        }
    }
}

/// Outcome of a work-loop attempt as an execution observation.
pub enum WorkExecution {
    /// No qualified profile/catalogue was selectable: run the inert executor.
    Unavailable,
    /// `None` (shutdown, or no confirmed termination of the loop) records no
    /// receipt; a replacement owner takes the durable work claim over without replay.
    Observed(Option<Observation>),
}

/// How a finished cycle is observed. Only a loop that reached its own resting
/// point (waiting for guidance) is `Completed`. A bounded, failed or
/// reconciliation-pending loop exited unsuccessfully: the coordinator's
/// separate operation check keeps any possibly dispatched attempt unresolved
/// for reconciliation, and nothing here claims that it was resolved.
fn observation(end: zobba_application::work::CycleEnd) -> Observation {
    use zobba_application::work::CycleEnd;
    match end {
        CycleEnd::Waiting => Observation::Completed,
        CycleEnd::Fenced => Observation::Cancelled,
        CycleEnd::Bounded | CycleEnd::Failed | CycleEnd::Reconcile | CycleEnd::Unavailable => {
            Observation::Exited
        }
    }
}

pub async fn execute_work<F, Fut>(
    config: &Config,
    basis: &ClaimBasis,
    mut shutdown: watch::Receiver<bool>,
    mut current: F,
    runner: &dyn crate::work::WorkRunner,
) -> WorkExecution
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<bool, TaskError>>,
{
    if *shutdown.borrow() {
        return WorkExecution::Observed(None);
    }
    let cancellation = zobba_application::model::ModelCancellation::new();
    let run = runner.run(basis, &cancellation);
    tokio::pin!(run);
    let mut ticker = tokio::time::interval(AUTHORITY_POLL);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    // The same bounded authority poll as the inert child: Pause/Stop, a new
    // cycle or lost ownership cancels an in-flight model call promptly.
    let authority = async {
        loop {
            ticker.tick().await;
            match tokio::time::timeout(AUTHORITY_TIMEOUT, current()).await {
                Ok(Ok(true)) => {}
                Ok(Ok(false)) => return,
                _ => {
                    config.diagnostics.record(Code::AuthorityFailed);
                    return;
                }
            }
        }
    };
    tokio::pin!(authority);
    let by_shutdown = tokio::select! {
        biased;
        end = &mut run => {
            return match end {
                None => WorkExecution::Unavailable,
                Some(end) => WorkExecution::Observed(Some(observation(end))),
            };
        }
        _ = shutdown.changed() => true,
        _ = &mut authority => false,
    };
    cancellation.cancel();
    match tokio::time::timeout(Duration::from_secs(5), &mut run).await {
        // After cancellation began, never fall back to the inert executor:
        // this claim was being worked and was cancelled.
        Ok(_) if !by_shutdown => WorkExecution::Observed(Some(Observation::Cancelled)),
        _ => {
            if !by_shutdown {
                config.diagnostics.record(Code::ProcessJoinUnconfirmed);
            }
            WorkExecution::Observed(None)
        }
    }
}
