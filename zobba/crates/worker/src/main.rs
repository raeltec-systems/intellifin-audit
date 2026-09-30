//! Independent worker process. It does no synthetic audit work at bootstrap.
use axum::{Json, Router, extract::State, http::StatusCode, routing::get};
use serde::Serialize;
use std::{net::SocketAddr, process::ExitCode};
use zobba_application::{BootstrapError, readiness};
use zobba_infrastructure::RuntimeDatabase;

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

async fn ready(State(database): State<RuntimeDatabase>) -> (StatusCode, Json<HealthResponse>) {
    match readiness(&database).await {
        Ok(version) => (
            StatusCode::OK,
            Json(HealthResponse {
                service: "worker",
                status: "ready",
                schema_version: Some(version.0),
            }),
        ),
        Err(error) => {
            eprintln!("worker: {}", error.code());
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

#[tokio::main]
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
    let url = std::env::var("ZOBBA_RUNTIME_DATABASE_URL")
        .map_err(|_| BootstrapError::InvalidConfiguration)?;
    let address: SocketAddr = std::env::var("ZOBBA_WORKER_BIND")
        .unwrap_or_else(|_| "127.0.0.1:4311".into())
        .parse()
        .map_err(|_| BootstrapError::InvalidConfiguration)?;
    let database = RuntimeDatabase::connect(&url).await?;
    let app = Router::new()
        .route("/health/live", get(live))
        .route("/health/ready", get(ready))
        .with_state(database);
    let listener = tokio::net::TcpListener::bind(address)
        .await
        .map_err(|_| BootstrapError::ListenerUnavailable)?;
    eprintln!("worker: ready");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown())
        .await
        .map_err(|_| BootstrapError::ListenerUnavailable)
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
