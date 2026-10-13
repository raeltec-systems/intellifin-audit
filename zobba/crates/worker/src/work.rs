//! Optional model work-cycle composition. Production `coordinate` installs no
//! qualification source, so it keeps the inert executor; only an injected
//! trusted composition (fixture qualification in tests) enables model work.
use std::{future::Future, pin::Pin, sync::Arc};

use sqlx::PgPool;
use zobba_application::{
    model::{
        ModelCancellation, ModelCoordinator, ModelQualificationSource, ModelRequest,
        ModelTransport, TransportOutcome,
    },
    operation::OperationError,
    work::{CycleEnd, SettledAttempt, ToolDispatch, WorkLoop, WorkSettings, settled_attempt},
};
use zobba_domain::{
    context::ContextBudget,
    permissions::{CanonicalOperation, SourceFact},
    task::ClaimBasis,
};
use zobba_infrastructure::{
    model::{ModelRepository, bind_disclosure},
    operation::OperationRepository,
    task::TaskRepository,
};

use crate::gateway::Gateway;

pub type CycleFuture<'a> = Pin<Box<dyn Future<Output = Option<CycleEnd>> + Send + 'a>>;

/// Runs one claim's work cycle. `None` means no qualified profile and
/// enabled catalogue are selectable: the caller keeps the inert executor. A
/// configuration that cannot be read is `Some(CycleEnd::Unavailable)`.
pub trait WorkRunner: Send + Sync {
    fn run<'a>(
        &'a self,
        basis: &'a ClaimBasis,
        cancellation: &'a ModelCancellation,
    ) -> CycleFuture<'a>;
    /// Reconcile durable external work for a Task the coordinator left waiting
    /// (for example a lost analysis job). Never dispatches. True means a later
    /// coordination should observe resolved facts.
    /// Bounded and shutdown-aware: it must never follow a long external job
    /// inline, because the coordinator awaits it.
    fn reconcile<'a>(
        &'a self,
        route: &'a zobba_domain::task::WakeupRoute,
        shutdown: tokio::sync::watch::Receiver<bool>,
    ) -> Pin<Box<dyn Future<Output = bool> + Send + 'a>> {
        let _ = (route, shutdown);
        Box::pin(async { false })
    }
}

struct Shared<T>(Arc<T>);
impl<T: ModelTransport> ModelTransport for Shared<T> {
    fn invoke(
        &self,
        request: &ModelRequest,
        cancellation: &ModelCancellation,
    ) -> impl Future<Output = TransportOutcome> + Send {
        self.0.invoke(request, cancellation)
    }
}

struct GatewayDispatch {
    gateway: Gateway,
    operations: OperationRepository,
}
impl ToolDispatch for GatewayDispatch {
    async fn dispatch(
        &self,
        basis: &ClaimBasis,
        operation_id: &str,
    ) -> Result<(String, SourceFact), OperationError> {
        self.gateway
            .dispatch_attempt(&self.operations, basis, operation_id)
            .await
    }
    async fn settled(
        &self,
        basis: &ClaimBasis,
        operation_id: &str,
    ) -> Result<Option<SettledAttempt>, OperationError> {
        settled_attempt(
            &self.operations,
            &basis.actor_id,
            &basis.scope,
            operation_id,
        )
        .await
    }
}

/// Trusted composition: qualification source, transport, owned gateway and the
/// disclosure template. None of these values come from a message or a model.
pub struct Composition<T> {
    pub pool: PgPool,
    pub qualifications: Arc<dyn ModelQualificationSource>,
    pub transport: Arc<T>,
    pub gateway: Gateway,
    pub disclosure: CanonicalOperation,
    pub input_class: String,
    pub max_output_tokens: u32,
    /// Trusted profile context limit and Task setting, in conservative tokens.
    pub context: ContextBudget,
}

impl<T: ModelTransport + 'static> WorkRunner for Composition<T> {
    fn run<'a>(
        &'a self,
        basis: &'a ClaimBasis,
        cancellation: &'a ModelCancellation,
    ) -> CycleFuture<'a> {
        Box::pin(async move {
            let models = ModelRepository::new(self.pool.clone())
                .with_qualification_source(self.qualifications.clone());
            // Only an explicit absence of a selectable configuration keeps
            // the inert executor. A database or decode error fails closed.
            let (profile, catalogue) = match models.selection(&basis.actor_id, &basis.scope).await {
                Ok(Some(selection)) => selection,
                Ok(None) => return None,
                Err(_) => return Some(CycleEnd::Unavailable),
            };
            let max_output_tokens = self.max_output_tokens.min(profile.max_output_tokens);
            let work = WorkLoop {
                steps: TaskRepository::new(self.pool.clone()),
                coordinator: ModelCoordinator {
                    store: models,
                    transport: Shared(self.transport.clone()),
                },
                reading: zobba_application::work::NoReading,
                dispatch: GatewayDispatch {
                    gateway: self.gateway.clone(),
                    operations: OperationRepository::new(self.pool.clone())
                        .with_model_qualification_source(self.qualifications.clone()),
                },
                settings: WorkSettings {
                    profile,
                    catalogue,
                    disclosure: self.disclosure.clone(),
                    input_class: self.input_class.clone(),
                    max_output_tokens,
                    context: self.context,
                },
                bind: bind_disclosure,
                delay: |duration| Box::pin(tokio::time::sleep(duration)),
            };
            Some(work.run(basis, cancellation).await)
        })
    }
}

/// Story 22.5 trusted composition of the agent's reading tools: the same work
/// loop, answering with cited answers, plus native page reads (one
/// disclosure-bound request per page through the same qualified transport)
/// and model-written programs, both run through the 22.4 analysis sandbox.
/// The originals' classification, the analysis target and the sandbox come
/// from trusted configuration, never from a model or a message.
pub struct ReadingComposition<T, X, O> {
    pub base: Composition<T>,
    pub sandbox: Arc<X>,
    pub objects: Arc<O>,
    pub allowlist: Vec<zobba_domain::analysis::AnalysisEnvironment>,
    pub analysis_settings: zobba_application::analysis::AnalysisSettings,
    pub analysis: zobba_application::analysis::AnalysisTarget,
    /// The firm's classification of registered originals, disclosed with a page.
    pub classification: String,
}

impl<T, X, O> WorkRunner for ReadingComposition<T, X, O>
where
    T: ModelTransport + 'static,
    X: zobba_application::analysis::AnalysisSandbox + 'static,
    O: zobba_application::evidence::EvidenceObjects + 'static,
{
    fn run<'a>(
        &'a self,
        basis: &'a ClaimBasis,
        cancellation: &'a ModelCancellation,
    ) -> CycleFuture<'a> {
        Box::pin(async move {
            let base = &self.base;
            let models = ModelRepository::new(base.pool.clone())
                .with_qualification_source(base.qualifications.clone());
            let (profile, catalogue) = match models.selection(&basis.actor_id, &basis.scope).await {
                Ok(Some(selection)) => selection,
                Ok(None) => return None,
                Err(_) => return Some(CycleEnd::Unavailable),
            };
            let max_output_tokens = base.max_output_tokens.min(profile.max_output_tokens);
            let readers = ModelCoordinator {
                store: models.clone(),
                transport: Shared(base.transport.clone()),
            };
            let store = zobba_infrastructure::citation::CitationRepository::new(base.pool.clone());
            let operations = OperationRepository::new(base.pool.clone())
                .with_model_qualification_source(base.qualifications.clone());
            let jobs = zobba_infrastructure::analysis::AnalysisRepository::new(base.pool.clone());
            let settings = zobba_application::reading::ReadingSettings {
                profile: profile.clone(),
                catalogue: catalogue.clone(),
                disclosure: base.disclosure.clone(),
                input_class: base.input_class.clone(),
                classification: self.classification.clone(),
                max_output_tokens,
                analysis: self.analysis.clone(),
                bind: bind_disclosure,
            };
            let reading = zobba_application::reading::Reading {
                models: &readers,
                store: &store,
                operations: &operations,
                jobs: &jobs,
                sandbox: &*self.sandbox,
                objects: &*self.objects,
                allowlist: &self.allowlist,
                analysis_settings: self.analysis_settings,
                settings: &settings,
            };
            let work = WorkLoop {
                steps: TaskRepository::new(base.pool.clone()),
                coordinator: ModelCoordinator {
                    store: models,
                    transport: Shared(base.transport.clone()),
                },
                reading,
                dispatch: GatewayDispatch {
                    gateway: base.gateway.clone(),
                    operations: OperationRepository::new(base.pool.clone())
                        .with_model_qualification_source(base.qualifications.clone()),
                },
                settings: WorkSettings {
                    profile,
                    catalogue,
                    disclosure: base.disclosure.clone(),
                    input_class: base.input_class.clone(),
                    max_output_tokens,
                    context: base.context,
                },
                bind: bind_disclosure,
                delay: |duration| Box::pin(tokio::time::sleep(duration)),
            };
            Some(Box::pin(work.run(basis, cancellation)).await)
        })
    }
}
