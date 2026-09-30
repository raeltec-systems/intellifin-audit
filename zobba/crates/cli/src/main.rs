use std::process::ExitCode;
use utoipa::OpenApi;
use zobba_application::BootstrapError;

#[tokio::main]
async fn main() -> ExitCode {
    match run().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("cli: {}", error.code());
            ExitCode::FAILURE
        }
    }
}

async fn run() -> Result<(), BootstrapError> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.as_slice() {
        [command] if command == "seed-local" => {
            zobba_infrastructure::fixture::seed_local().await?;
            eprintln!("cli: fixtures_ready");
            Ok(())
        }
        [command] if command == "openapi" => {
            let document = zobba_api::ApiDocument::openapi()
                .to_pretty_json()
                .map_err(|_| BootstrapError::InvalidConfiguration)?;
            println!("{document}");
            Ok(())
        }
        [command, option, role] if command == "migrate" && option == "--runtime-role" => {
            let url = std::env::var("ZOBBA_MIGRATION_DATABASE_URL")
                .map_err(|_| BootstrapError::InvalidConfiguration)?;
            zobba_infrastructure::migrate(&url, role).await?;
            eprintln!("cli: schema_ready");
            Ok(())
        }
        _ => Err(BootstrapError::InvalidConfiguration),
    }
}
