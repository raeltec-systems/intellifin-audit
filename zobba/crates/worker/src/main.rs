//! Independent Task coordinator with a bounded, inert-only child executor.
use axum::{Json, Router, extract::State, http::StatusCode, routing::get};
use serde::Serialize;
use std::{
    net::SocketAddr,
    process::ExitCode,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};
use zobba_application::{BootstrapError, readiness};
use zobba_infrastructure::RuntimeDatabase;
use zobba_worker::{
    analysis::{AnalysisComposition, SandboxChoice, sandbox_choice},
    coordinate, coordinate_work,
    diagnostics::{Code, Diagnostics},
    executor,
    supervision::{supervise, wait_for_shutdown},
};

#[derive(Clone)]
struct HealthState {
    database: RuntimeDatabase,
    coordinator: Arc<AtomicBool>,
    diagnostics: Diagnostics,
}

#[derive(Serialize)]
struct HealthResponse {
    service: &'static str,
    status: &'static str,
    schema_version: Option<u32>,
}

async fn live() -> Json<HealthResponse> {
    Json(HealthResponse {
        service: "worker",
        status: "live",
        schema_version: None,
    })
}

async fn ready(State(state): State<HealthState>) -> (StatusCode, Json<HealthResponse>) {
    let readiness = if state.coordinator.load(Ordering::Acquire) {
        readiness(&state.database).await
    } else {
        Err(BootstrapError::ListenerUnavailable)
    };
    match readiness {
        Ok(version) if state.coordinator.load(Ordering::Acquire) => (
            StatusCode::OK,
            Json(HealthResponse {
                service: "worker",
                status: "ready",
                schema_version: Some(version.0),
            }),
        ),
        _ => {
            state
                .diagnostics
                .record(if state.coordinator.load(Ordering::Acquire) {
                    Code::DatabaseUnavailable
                } else {
                    Code::CoordinatorFailed
                });
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(HealthResponse {
                    service: "worker",
                    status: "unavailable",
                    schema_version: None,
                }),
            )
        }
    }
}

#[tokio::main(worker_threads = 2)]
async fn main() -> ExitCode {
    match run().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("worker: {}", error.code());
            ExitCode::FAILURE
        }
    }
}

async fn run() -> Result<(), BootstrapError> {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    if !arguments.is_empty() {
        return executor::child_mode(&arguments).await;
    }
    let url = std::env::var("ZOBBA_RUNTIME_DATABASE_URL")
        .map_err(|_| BootstrapError::InvalidConfiguration)?;
    let address: SocketAddr = std::env::var("ZOBBA_WORKER_BIND")
        .unwrap_or_else(|_| "127.0.0.1:4311".into())
        .parse()
        .map_err(|_| BootstrapError::InvalidConfiguration)?;
    let database = tokio::time::timeout(
        std::time::Duration::from_secs(7),
        RuntimeDatabase::connect(&url),
    )
    .await
    .map_err(|_| BootstrapError::DatabaseUnavailable)??;
    let config = executor::Config::from_environment()?;
    // Analysis is composed only from explicit deployment configuration. The
    // local Docker sandbox is test-only and cannot be selected here.
    let analysis = match sandbox_choice(std::env::var("ZOBBA_ANALYSIS_SANDBOX").ok().as_deref())? {
        SandboxChoice::None => None,
        SandboxChoice::Fargate => {
            use zobba_infrastructure::{
                analysis::fargate::{CredentialSource, FargateConfig, FargateSandbox},
                evidence::s3::S3EvidenceObjects,
            };
            let fargate =
                FargateConfig::from_environment(zobba_domain::analysis::GENERAL_ENVIRONMENT_ID)
                    .map_err(|_| BootstrapError::InvalidConfiguration)?
                    .ok_or(BootstrapError::InvalidConfiguration)?;
            let sandbox = FargateSandbox::new(fargate, CredentialSource::from_environment())
                .map_err(|_| BootstrapError::InvalidConfiguration)?;
            let bucket = std::env::var("ZOBBA_EVIDENCE_BUCKET")
                .map_err(|_| BootstrapError::InvalidConfiguration)?;
            let objects = S3EvidenceObjects::from_env(&bucket)
                .map_err(|_| BootstrapError::InvalidConfiguration)?;
            Some(Arc::new(AnalysisComposition::new(
                database.pool().clone(),
                Arc::new(sandbox),
                Arc::new(objects),
                config.diagnostics(),
            )))
        }
    };
    let healthy = Arc::new(AtomicBool::new(true));
    let diagnostics = config.diagnostics();
    let panic_diagnostics = diagnostics.clone();
    std::panic::set_hook(Box::new(move |_| {
        panic_diagnostics.record(Code::RunnerFailed);
    }));
    let app = Router::new()
        .route("/health/live", get(live))
        .route("/health/ready", get(ready))
        .with_state(HealthState {
            database: database.clone(),
            coordinator: healthy.clone(),
            diagnostics: diagnostics.clone(),
        });
    let listener = tokio::net::TcpListener::bind(address)
        .await
        .map_err(|_| BootstrapError::ListenerUnavailable)?;
    eprintln!("worker: ready");
    let (shutdown_sender, shutdown_receiver) = tokio::sync::watch::channel(false);
    let coordinator = {
        let shutdown = shutdown_receiver.clone();
        async move {
            match analysis {
                Some(runner) => coordinate_work(database, config, runner, shutdown).await,
                None => coordinate(database, config, shutdown).await,
            }
        }
    };
    let server = async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(wait_for_shutdown(shutdown_receiver))
            .await
    };
    supervise(
        coordinator,
        server,
        shutdown(),
        shutdown_sender,
        healthy,
        diagnostics,
    )
    .await
}

async fn shutdown() {
    #[cfg(unix)]
    {
        if let Ok(mut terminate) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            tokio::select! { _ = tokio::signal::ctrl_c() => {}, _ = terminate.recv() => {} }
            return;
        }
    }
    let _ = tokio::signal::ctrl_c().await;
}
