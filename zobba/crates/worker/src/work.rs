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
    work::{CycleEnd, ToolDispatch, WorkLoop, WorkSettings},
};
use zobba_domain::{
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
/// enabled catalogue are selectable: the caller keeps the inert executor.
pub trait WorkRunner: Send + Sync {
    fn run<'a>(
        &'a self,
        basis: &'a ClaimBasis,
        cancellation: &'a ModelCancellation,
    ) -> CycleFuture<'a>;
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
            let (profile, catalogue) = models
                .selection(&basis.actor_id, &basis.scope)
                .await
                .ok()
                .flatten()?;
            let max_output_tokens = self.max_output_tokens.min(profile.max_output_tokens);
            let work = WorkLoop {
                steps: TaskRepository::new(self.pool.clone()),
                coordinator: ModelCoordinator {
                    store: models,
                    transport: Shared(self.transport.clone()),
                },
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
                },
                bind: bind_disclosure,
            };
            Some(work.run(basis, cancellation).await)
        })
    }
}
