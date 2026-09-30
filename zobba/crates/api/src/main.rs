use std::{net::SocketAddr, process::ExitCode};
use zobba_application::BootstrapError;
use zobba_infrastructure::RuntimeDatabase;

#[tokio::main]
async fn main() -> ExitCode {
    match run().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("api: {}", error.code());
            ExitCode::FAILURE
        }
    }
}

async fn run() -> Result<(), BootstrapError> {
    let url = std::env::var("ZOBBA_RUNTIME_DATABASE_URL")
        .map_err(|_| BootstrapError::InvalidConfiguration)?;
    let address: SocketAddr = std::env::var("ZOBBA_API_BIND")
        .unwrap_or_else(|_| "127.0.0.1:4310".into())
        .parse()
        .map_err(|_| BootstrapError::InvalidConfiguration)?;
    let database = RuntimeDatabase::connect(&url).await?;
    let identity = zobba_api::auth::AuthState::from_environment(&database)?;
    let listener = tokio::net::TcpListener::bind(address)
        .await
        .map_err(|_| BootstrapError::ListenerUnavailable)?;
    eprintln!("api: ready");
    axum::serve(
        listener,
        zobba_api::authenticated_router(database, identity),
    )
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
