use std::process::ExitCode;
use utoipa::OpenApi;
use zobba_application::BootstrapError;
use zobba_infrastructure::provision::{OrganisationProvision, ProvisionError};

#[tokio::main]
async fn main() -> ExitCode {
    match run().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(code) => {
            eprintln!("cli: {code}");
            ExitCode::FAILURE
        }
    }
}

async fn run() -> Result<(), &'static str> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.as_slice() {
        [command] if command == "seed-local" => {
            zobba_infrastructure::fixture::seed_local()
                .await
                .map_err(BootstrapError::code)?;
            eprintln!("cli: fixtures_ready");
            Ok(())
        }
        [command] if command == "openapi" => {
            let document = zobba_api::ApiDocument::openapi()
                .to_pretty_json()
                .map_err(|_| BootstrapError::InvalidConfiguration.code())?;
            println!("{document}");
            Ok(())
        }
        [command, option, role] if command == "migrate" && option == "--runtime-role" => {
            let url = migration_url()?;
            zobba_infrastructure::migrate(&url, role)
                .await
                .map_err(BootstrapError::code)?;
            eprintln!("cli: schema_ready");
            Ok(())
        }
        [command, options @ ..] if command == "provision-organisation" => {
            let request = provision_request(options).map_err(ProvisionError::code)?;
            let url = migration_url()?;
            let outcome = zobba_infrastructure::provision::provision_organisation(&url, &request)
                .await
                .map_err(ProvisionError::code)?;
            // Fixed code and opaque IDs only: never the issuer, subject or URL.
            eprintln!(
                "cli: {} organisation_id={} identity_id={}",
                outcome.code(),
                request.organisation_id(),
                outcome.identity_id()
            );
            Ok(())
        }
        _ => Err(BootstrapError::InvalidConfiguration.code()),
    }
}

fn migration_url() -> Result<String, &'static str> {
    std::env::var("ZOBBA_MIGRATION_DATABASE_URL")
        .map_err(|_| BootstrapError::InvalidConfiguration.code())
}

const PROVISION_OPTIONS: [&str; 5] = [
    "--organisation-id",
    "--organisation-name",
    "--issuer",
    "--subject",
    "--display-name",
];

/// Each option exactly once, as `--name value` pairs; unknown or repeated
/// options refuse. Values pass verbatim to the domain validators.
fn provision_request(options: &[String]) -> Result<OrganisationProvision, ProvisionError> {
    let mut values: [Option<&str>; 5] = [None; 5];
    if options.len() != 2 * PROVISION_OPTIONS.len() {
        return Err(ProvisionError::Bootstrap(
            BootstrapError::InvalidConfiguration,
        ));
    }
    for [name, value] in options.as_chunks::<2>().0 {
        let slot = PROVISION_OPTIONS
            .iter()
            .position(|option| option == name)
            .ok_or(ProvisionError::Bootstrap(
                BootstrapError::InvalidConfiguration,
            ))?;
        if values[slot].replace(value.as_str()).is_some() {
            return Err(ProvisionError::Bootstrap(
                BootstrapError::InvalidConfiguration,
            ));
        }
    }
    let [
        Some(id),
        Some(name),
        Some(issuer),
        Some(subject),
        Some(display),
    ] = values
    else {
        return Err(ProvisionError::Bootstrap(
            BootstrapError::InvalidConfiguration,
        ));
    };
    OrganisationProvision::new(id, name, issuer, subject, display)
}

#[cfg(test)]
mod tests {
    use super::*;

    const ISSUER: &str = "https://cognito-idp.eu-west-2.amazonaws.com/eu-west-2_AbC123";

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|v| (*v).to_owned()).collect()
    }

    fn full() -> Vec<String> {
        args(&[
            "--organisation-id",
            "org-1",
            "--organisation-name",
            "Northstar",
            "--issuer",
            ISSUER,
            "--subject",
            "sub-1",
            "--display-name",
            "Casey Admin",
        ])
    }

    #[test]
    fn parses_options_in_any_order() {
        let request = provision_request(&full()).unwrap();
        assert_eq!(request.organisation_id(), "org-1");
        let mut reordered = full();
        reordered.rotate_left(4);
        assert_eq!(provision_request(&reordered).unwrap(), request);
    }

    #[test]
    fn refuses_missing_repeated_unknown_and_dangling_options() {
        let invalid = ProvisionError::Bootstrap(BootstrapError::InvalidConfiguration);
        let mut missing = full();
        missing.truncate(8);
        assert_eq!(provision_request(&missing), Err(invalid));
        let mut repeated = full();
        repeated[8] = "--subject".into();
        assert_eq!(provision_request(&repeated), Err(invalid));
        let mut unknown = full();
        unknown[0] = "--organisation".into();
        assert_eq!(provision_request(&unknown), Err(invalid));
        let mut dangling = full();
        dangling.push("--subject".into());
        assert_eq!(provision_request(&dangling), Err(invalid));
        assert_eq!(provision_request(&[]), Err(invalid));
    }

    #[test]
    fn delegates_value_validation_to_domain_rules() {
        let mut bad_id = full();
        bad_id[1] = "org 1".into();
        assert_eq!(
            provision_request(&bad_id),
            Err(ProvisionError::InvalidOrganisationId)
        );
        let mut padded = full();
        padded[3] = "Northstar\u{2003}".into();
        assert_eq!(
            provision_request(&padded),
            Err(ProvisionError::InvalidOrganisationName)
        );
        let mut http = full();
        http[5] = "http://idp.example/pool".into();
        assert_eq!(provision_request(&http), Err(ProvisionError::InvalidIssuer));
    }
}
