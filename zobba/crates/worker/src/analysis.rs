//! Analysis job composition (Story 22.4). Production configures only the
//! Fargate sandbox; the local Docker sandbox exists solely behind the
//! infrastructure `test-docker-sandbox` feature, which no production build
//! enables, and this module refuses to select it.
use crate::{
    diagnostics::{Code, Diagnostics},
    work::{CycleFuture, WorkRunner},
};
use sqlx::PgPool;
use std::{
    future::Future,
    pin::Pin,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::watch;
use zobba_application::{
    BootstrapError,
    analysis::{Analysis, AnalysisError, AnalysisSandbox, AnalysisSettings, JobRecord, Watch},
    evidence::EvidenceObjects,
    model::ModelCancellation,
    work::CycleEnd,
};
use zobba_domain::{
    analysis::{AnalysisEnvironment, JobStatus, server_allowlist},
    task::{ClaimBasis, WakeupRoute},
};
use zobba_infrastructure::{analysis::AnalysisRepository, operation::OperationRepository};

/// One claim processes at most this many jobs before yielding.
const JOBS_PER_CLAIM: usize = 16;
/// Recovery outside a claim follows a running job at most this long, then
/// detaches (the job keeps running) so it never blocks the coordinator.
pub const RECONCILE_WATCH: Duration = Duration::from_secs(30);

fn delay(duration: Duration) -> Pin<Box<dyn Future<Output = ()> + Send>> {
    Box::pin(tokio::time::sleep(duration))
}
pub const SETTINGS: AnalysisSettings = AnalysisSettings {
    poll: Duration::from_millis(500),
    stop_confirmation: Duration::from_secs(60),
    provisioning: Duration::from_secs(600),
    collect_attempts: 3,
    delay,
};

/// Trusted composition: pool, the configured sandbox, the evidence object store
/// and the server allowlist. Nothing here comes from a request.
pub struct AnalysisComposition<X, O> {
    pub pool: PgPool,
    pub sandbox: Arc<X>,
    pub objects: Arc<O>,
    pub allowlist: Vec<AnalysisEnvironment>,
    pub settings: AnalysisSettings,
    pub reconcile_watch: Duration,
    pub diagnostics: Diagnostics,
}
impl<X, O> AnalysisComposition<X, O> {
    pub fn new(pool: PgPool, sandbox: Arc<X>, objects: Arc<O>, diagnostics: Diagnostics) -> Self {
        Self {
            pool,
            sandbox,
            objects,
            allowlist: server_allowlist(),
            settings: SETTINGS,
            reconcile_watch: RECONCILE_WATCH,
            diagnostics,
        }
    }
}

/// Settled for the Task's purposes: no further automatic work on this job.
fn settled(record: &JobRecord) -> bool {
    matches!(
        record.latest.status,
        JobStatus::Collected | JobStatus::Stopped | JobStatus::Unknown
    )
}

/// What one `run_next` result means for the claim's cycle.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Step {
    /// Settled; continue with the next job.
    Continue,
    /// No job needs work.
    Idle,
    /// End the cycle (and record this diagnostic, if any).
    End(CycleEnd, Option<Code>),
}
pub fn step(result: &Result<Option<JobRecord>, AnalysisError>) -> Step {
    match result {
        Ok(None) => Step::Idle,
        Ok(Some(record)) if record.latest.status == JobStatus::Unknown => {
            Step::End(CycleEnd::Reconcile, Some(Code::AnalysisUnresolved))
        }
        Ok(Some(record)) if record.latest.status == JobStatus::Stopped => {
            Step::End(CycleEnd::Fenced, None)
        }
        Ok(Some(record)) if settled(record) => Step::Continue,
        // Absent and retryable under a new claim, or not yet settled: end
        // this cycle without guessing.
        Ok(Some(_)) => Step::End(CycleEnd::Bounded, None),
        Err(_) => Step::End(CycleEnd::Failed, Some(Code::AnalysisFailed)),
    }
}

impl<X, O> AnalysisComposition<X, O>
where
    X: AnalysisSandbox + 'static,
    O: EvidenceObjects + 'static,
{
    async fn cycle(
        &self,
        basis: &ClaimBasis,
        cancellation: &ModelCancellation,
    ) -> Option<CycleEnd> {
        let store = OperationRepository::new(self.pool.clone());
        let jobs = AnalysisRepository::new(self.pool.clone());
        let analysis = Analysis {
            store: &store,
            jobs: &jobs,
            sandbox: self.sandbox.as_ref(),
            objects: self.objects.as_ref(),
            allowlist: &self.allowlist,
            settings: self.settings,
        };
        let mut worked = false;
        // A job whose recovery fails is skipped for the rest of this claim.
        let mut skip = Vec::new();
        for _ in 0..JOBS_PER_CLAIM {
            if cancellation.is_cancelled() {
                return Some(CycleEnd::Fenced);
            }
            let result = analysis.run_next(basis, cancellation, &mut skip).await;
            if !skip.is_empty() {
                self.diagnostics.record(Code::AnalysisFailed);
            }
            match step(&result) {
                Step::Idle => break,
                Step::Continue => worked = true,
                Step::End(end, code) => {
                    if let Some(code) = code {
                        self.diagnostics.record(code);
                    }
                    return Some(end);
                }
            }
        }
        // No analysis job: leave the claim to the ordinary executor.
        worked.then_some(CycleEnd::Waiting)
    }

    /// Lost-job recovery for a Task whose consumed attempts left it waiting:
    /// restricted receipt custody, sandbox lookup, a bounded resumed watch or
    /// collection. Never dispatches, never stops a job, and detaches on
    /// shutdown. True when every job reached a settled or retryable fact.
    pub async fn recover_task(&self, route: &WakeupRoute, shutdown: &ModelCancellation) -> bool {
        let store = OperationRepository::new(self.pool.clone());
        let jobs = AnalysisRepository::new(self.pool.clone());
        let analysis = Analysis {
            store: &store,
            jobs: &jobs,
            sandbox: self.sandbox.as_ref(),
            objects: self.objects.as_ref(),
            allowlist: &self.allowlist,
            settings: self.settings,
        };
        use zobba_application::analysis::AnalysisJobs;
        let Ok(pending) = jobs
            .pending(&route.actor_id, &route.scope, &route.task_id)
            .await
        else {
            self.diagnostics.record(Code::AnalysisFailed);
            return false;
        };
        if pending.is_empty() {
            return false;
        }
        let watch = Watch {
            until: Some(Instant::now() + self.reconcile_watch),
            detach: Some(shutdown),
        };
        let mut resolved = true;
        // Recovery never requests a stop: this token is never cancelled.
        let no_stop = ModelCancellation::new();
        for record in pending {
            if shutdown.is_cancelled() {
                return false;
            }
            match analysis
                .recover(
                    &route.actor_id,
                    &route.scope,
                    &record.job.id,
                    &no_stop,
                    watch,
                )
                .await
            {
                Ok(record) if settled(&record) || record.latest.status.retryable() => {}
                Ok(_) => resolved = false,
                Err(_) => {
                    self.diagnostics.record(Code::AnalysisFailed);
                    resolved = false;
                }
            }
        }
        resolved
    }
}

impl<X, O> WorkRunner for AnalysisComposition<X, O>
where
    X: AnalysisSandbox + 'static,
    O: EvidenceObjects + 'static,
{
    fn run<'a>(
        &'a self,
        basis: &'a ClaimBasis,
        cancellation: &'a ModelCancellation,
    ) -> CycleFuture<'a> {
        Box::pin(self.cycle(basis, cancellation))
    }
    fn reconcile<'a>(
        &'a self,
        route: &'a WakeupRoute,
        shutdown: watch::Receiver<bool>,
    ) -> Pin<Box<dyn Future<Output = bool> + Send + 'a>> {
        Box::pin(async move {
            let detach = ModelCancellation::new();
            let signal = detach.clone();
            let mut shutdown = shutdown;
            let watcher = tokio::spawn(async move {
                while !*shutdown.borrow() {
                    if shutdown.changed().await.is_err() {
                        return;
                    }
                }
                signal.cancel();
            });
            let resolved = self.recover_task(route, &detach).await;
            watcher.abort();
            resolved
        })
    }
}

/// The configured sandbox kind. Only `fargate` is selectable by a process;
/// every other value — including `docker` — fails closed at startup.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SandboxChoice {
    None,
    Fargate,
}
pub fn sandbox_choice(value: Option<&str>) -> Result<SandboxChoice, BootstrapError> {
    match value {
        None => Ok(SandboxChoice::None),
        Some("fargate") => Ok(SandboxChoice::Fargate),
        Some(_) => Err(BootstrapError::InvalidConfiguration),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use zobba_application::analysis::{AnalysisJob, JobFact};
    use zobba_domain::{
        analysis::{AnalysisLimits, GENERAL_ENVIRONMENT_ID, GENERAL_IMAGE_DIGEST},
        identity::Scope,
    };

    fn record(status: JobStatus) -> Result<Option<JobRecord>, AnalysisError> {
        Ok(Some(JobRecord {
            job: AnalysisJob {
                id: "job".into(),
                scope: Scope {
                    organisation_id: "o".into(),
                    client_id: "c".into(),
                    engagement_id: "e".into(),
                },
                actor_id: "a".into(),
                task_id: "t".into(),
                cycle_id: "y".into(),
                operation_id: "op".into(),
                request: zobba_domain::analysis::AnalysisRequest {
                    environment_id: GENERAL_ENVIRONMENT_ID.into(),
                    image_digest: GENERAL_IMAGE_DIGEST.into(),
                    program: "print(1)".into(),
                    program_sha256: "0".repeat(64),
                    inputs: vec![],
                    limits: AnalysisLimits::DEFAULT,
                },
            },
            latest: JobFact {
                sequence: 1,
                status,
                attempt_id: Some("attempt".into()),
                reason: None,
                exit_code: None,
                at: 0,
            },
            started_at: None,
            running_at: None,
            attempts: 1,
            now: 0,
        }))
    }

    #[test]
    fn every_run_result_maps_to_one_cycle_end() {
        assert_eq!(
            step(&record(JobStatus::Unknown)),
            Step::End(CycleEnd::Reconcile, Some(Code::AnalysisUnresolved))
        );
        assert_eq!(
            step(&record(JobStatus::Absent)),
            Step::End(CycleEnd::Bounded, None)
        );
        assert_eq!(
            step(&record(JobStatus::Stopped)),
            Step::End(CycleEnd::Fenced, None)
        );
        assert_eq!(step(&record(JobStatus::Collected)), Step::Continue);
        assert_eq!(
            step(&record(JobStatus::Running)),
            Step::End(CycleEnd::Bounded, None)
        );
        assert_eq!(step(&Ok(None)), Step::Idle);
        assert_eq!(
            step(&Err(AnalysisError::Unavailable)),
            Step::End(CycleEnd::Failed, Some(Code::AnalysisFailed))
        );
    }

    #[test]
    fn only_the_deployment_sandbox_is_selectable_by_configuration() {
        assert_eq!(sandbox_choice(None), Ok(SandboxChoice::None));
        assert_eq!(sandbox_choice(Some("fargate")), Ok(SandboxChoice::Fargate));
        for refused in ["docker", "local", "Docker", "", "fargate "] {
            assert_eq!(
                sandbox_choice(Some(refused)),
                Err(BootstrapError::InvalidConfiguration),
                "{refused:?} must be refused"
            );
        }
    }
}
