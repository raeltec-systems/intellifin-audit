//! Analysis job composition (Story 22.4). Production configures only the
//! Fargate sandbox; the local Docker sandbox exists solely behind the
//! infrastructure `test-docker-sandbox` feature, which no production build
//! enables, and this module refuses to select it.
use crate::{
    diagnostics::{Code, Diagnostics},
    work::{CycleFuture, WorkRunner},
};
use sqlx::PgPool;
use std::{future::Future, pin::Pin, sync::Arc, time::Duration};
use zobba_application::{
    BootstrapError,
    analysis::{Analysis, AnalysisSandbox, AnalysisSettings, JobRecord},
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

fn delay(duration: Duration) -> Pin<Box<dyn Future<Output = ()> + Send>> {
    Box::pin(tokio::time::sleep(duration))
}
pub const SETTINGS: AnalysisSettings = AnalysisSettings {
    poll: Duration::from_millis(500),
    stop_confirmation: Duration::from_secs(60),
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
        for _ in 0..JOBS_PER_CLAIM {
            if cancellation.is_cancelled() {
                return Some(CycleEnd::Fenced);
            }
            match analysis.run_next(basis, cancellation).await {
                Ok(None) => break,
                Ok(Some(record)) => {
                    worked = true;
                    if record.latest.status == JobStatus::Unknown {
                        self.diagnostics.record(Code::AnalysisUnresolved);
                        return Some(CycleEnd::Reconcile);
                    }
                    if record.latest.status == JobStatus::Stopped {
                        return Some(CycleEnd::Fenced);
                    }
                    if !settled(&record) {
                        // Absent and retryable under a new claim, or awaiting
                        // collection: end this cycle without guessing.
                        return Some(CycleEnd::Bounded);
                    }
                }
                Err(_) => {
                    self.diagnostics.record(Code::AnalysisFailed);
                    return Some(CycleEnd::Failed);
                }
            }
        }
        // No analysis job: leave the claim to the ordinary executor.
        worked.then_some(CycleEnd::Waiting)
    }

    /// Lost-job recovery for a Task whose consumed attempts left it waiting:
    /// restricted receipt custody, sandbox lookup, resumed watch or collection.
    /// Never dispatches. True when every unfinished job reached a settled fact.
    pub async fn recover_task(&self, route: &WakeupRoute) -> bool {
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
        let mut resolved = true;
        let cancellation = ModelCancellation::new();
        for record in pending {
            match analysis
                .recover(&route.actor_id, &route.scope, &record.job.id, &cancellation)
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
    ) -> Pin<Box<dyn Future<Output = bool> + Send + 'a>> {
        Box::pin(self.recover_task(route))
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
