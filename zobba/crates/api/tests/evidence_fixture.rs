//! Browser-only dependency composition; never linked into the production binary.
use std::{net::SocketAddr, process::ExitCode};
use zobba_infrastructure::{
    RuntimeDatabase,
    evidence::s3::{S3EvidenceObjects, storage_namespace},
};

#[path = "../../infrastructure/tests/support/s3_protocol.rs"]
mod s3_protocol;

#[tokio::main]
async fn main() -> ExitCode {
    // Ordinary cargo test discovers this target but must not start a long-lived
    // server. Browser tests explicitly select --serve and own its lifecycle.
    if !std::env::args().any(|argument| argument == "--serve") {
        return ExitCode::SUCCESS;
    }
    match serve().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(()) => {
            eprintln!("evidence fixture: startup unavailable");
            ExitCode::FAILURE
        }
    }
}

async fn serve() -> Result<(), ()> {
    let url = std::env::var("ZOBBA_RUNTIME_DATABASE_URL").map_err(|_| ())?;
    let options = zobba_infrastructure::database_options(&url).map_err(|_| ())?;
    if !options
        .get_database()
        .is_some_and(|database| database.ends_with("_test"))
    {
        return Err(());
    }
    let address: SocketAddr = std::env::var("ZOBBA_API_BIND")
        .map_err(|_| ())?
        .parse()
        .map_err(|_| ())?;
    if !address.ip().is_loopback() {
        return Err(());
    }
    let objects = match std::env::var("ZOBBA_TEST_EVIDENCE_S3_ENDPOINT") {
        Ok(endpoint) => {
            let store = s3_protocol::build_fixture_store(&endpoint).map_err(|_| ())?;
            let namespace = storage_namespace(&endpoint, "fixture-bucket");
            Some(S3EvidenceObjects::new(store, namespace).map_err(|_| ())?)
        }
        Err(std::env::VarError::NotPresent) => None,
        Err(_) => return Err(()),
    };
    let database = RuntimeDatabase::connect(&url).await.map_err(|_| ())?;
    let identity = zobba_api::auth::AuthState::from_environment(&database).map_err(|_| ())?;
    let listener = tokio::net::TcpListener::bind(address)
        .await
        .map_err(|_| ())?;
    axum::serve(
        listener,
        zobba_api::authenticated_router_with_evidence(database, identity, objects),
    )
    .with_graceful_shutdown(async {
        let _ = tokio::signal::ctrl_c().await;
    })
    .await
    .map_err(|_| ())
}
