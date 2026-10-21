//! Reviewed operator provisioning of an organisation and its first qualifying
//! Admin in a real (non-fixture) environment. Never called by API/worker startup.
//!
//! One READ COMMITTED owner transaction creates (or reuses) the identity named by
//! the exact OIDC issuer/subject pair, the organisation, and an active,
//! non-expiring Admin membership. The deferred Admin-continuity checks admit the
//! organisation because its Admin membership is inserted in the same transaction.
//! Exact retry reports `already_provisioned`; any other existing state refuses and
//! changes nothing. Nothing existing is promoted, reactivated or has its expiry
//! cleared.
use crate::{check_postgres, check_schema, connect};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use sha2::{Digest, Sha256};
use sqlx::{Connection, PgConnection};
use std::time::Duration;
use zobba_application::BootstrapError;
use zobba_domain::identity::{valid_scope_id, valid_scope_label};

const ATTEMPT_DEADLINE: Duration = Duration::from_secs(10);
const ATTEMPTS: usize = 5;
const ISSUER_MAX: usize = 2048;
const SUBJECT_MAX: usize = 255;

/// Validated operator input. Values are stored verbatim; nothing is trimmed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OrganisationProvision {
    organisation_id: String,
    organisation_name: String,
    issuer: String,
    subject: String,
    display_name: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ProvisionOutcome {
    Provisioned { identity_id: String },
    AlreadyProvisioned { identity_id: String },
}

impl ProvisionOutcome {
    pub const fn code(&self) -> &'static str {
        match self {
            Self::Provisioned { .. } => "organisation_provisioned",
            Self::AlreadyProvisioned { .. } => "already_provisioned",
        }
    }

    pub fn identity_id(&self) -> &str {
        match self {
            Self::Provisioned { identity_id } | Self::AlreadyProvisioned { identity_id } => {
                identity_id
            }
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProvisionError {
    InvalidOrganisationId,
    InvalidOrganisationName,
    InvalidIssuer,
    InvalidSubject,
    InvalidDisplayName,
    /// The organisation exists but is not exactly this organisation with exactly
    /// this active, non-expiring, Admin-only membership.
    OrganisationConflict,
    /// The derived identity ID belongs to a different issuer/subject pair.
    IdentityConflict,
    /// The issuer/subject identity exists but is inactive; it is never reactivated.
    IdentityInactive,
    Bootstrap(BootstrapError),
}

impl ProvisionError {
    pub const fn code(self) -> &'static str {
        match self {
            Self::InvalidOrganisationId => "invalid_organisation_id",
            Self::InvalidOrganisationName => "invalid_organisation_name",
            Self::InvalidIssuer => "invalid_issuer",
            Self::InvalidSubject => "invalid_subject",
            Self::InvalidDisplayName => "invalid_display_name",
            Self::OrganisationConflict => "organisation_conflict",
            Self::IdentityConflict => "identity_conflict",
            Self::IdentityInactive => "identity_inactive",
            Self::Bootstrap(error) => error.code(),
        }
    }
}

impl From<BootstrapError> for ProvisionError {
    fn from(error: BootstrapError) -> Self {
        Self::Bootstrap(error)
    }
}

/// An OIDC issuer is an exact https URL without credentials, query or fragment.
/// The verbatim string must equal the API's configured `ZOBBA_OIDC_ISSUER`.
fn valid_issuer(value: &str) -> bool {
    value.len() <= ISSUER_MAX
        && !value.chars().any(|c| c.is_control() || c.is_whitespace())
        && url::Url::parse(value).is_ok_and(|url| {
            url.scheme() == "https"
                && url.host_str().is_some_and(|host| !host.is_empty())
                && url.username().is_empty()
                && url.password().is_none()
                && url.query().is_none()
                && url.fragment().is_none()
        })
}

/// Matches the sign-in bound (1–255 bytes); subjects are opaque and case-sensitive.
fn valid_subject(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= SUBJECT_MAX
        && !value.chars().any(|c| c.is_control() || c.is_whitespace())
}

impl OrganisationProvision {
    pub fn new(
        organisation_id: &str,
        organisation_name: &str,
        issuer: &str,
        subject: &str,
        display_name: &str,
    ) -> Result<Self, ProvisionError> {
        if !valid_scope_id(organisation_id) {
            return Err(ProvisionError::InvalidOrganisationId);
        }
        if !valid_scope_label(organisation_name) {
            return Err(ProvisionError::InvalidOrganisationName);
        }
        if !valid_issuer(issuer) {
            return Err(ProvisionError::InvalidIssuer);
        }
        if !valid_subject(subject) {
            return Err(ProvisionError::InvalidSubject);
        }
        if !valid_scope_label(display_name) {
            return Err(ProvisionError::InvalidDisplayName);
        }
        Ok(Self {
            organisation_id: organisation_id.to_owned(),
            organisation_name: organisation_name.to_owned(),
            issuer: issuer.to_owned(),
            subject: subject.to_owned(),
            display_name: display_name.to_owned(),
        })
    }

    pub fn organisation_id(&self) -> &str {
        &self.organisation_id
    }

    /// Deterministic ID for a newly created identity. An identity that already
    /// exists for this issuer/subject (for example after a sign-in) keeps its ID.
    pub fn derived_identity_id(&self) -> String {
        derived_identity_id(&self.issuer, &self.subject)
    }
}

/// `oidc-` plus unpadded base64url SHA-256 of `issuer NUL subject`: 48 ASCII
/// characters within the scope-ID alphabet. NUL cannot occur in either value.
pub fn derived_identity_id(issuer: &str, subject: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(issuer.as_bytes());
    digest.update([0]);
    digest.update(subject.as_bytes());
    format!("oidc-{}", URL_SAFE_NO_PAD.encode(digest.finalize()))
}

/// Concurrency outcomes the continuity notes require retrying as a whole
/// transaction: deadlock, serialization, bounded lock wait, and a concurrent
/// insert of the same identity/organisation key.
fn retryable(error: &sqlx::Error) -> bool {
    matches!(error, sqlx::Error::Database(database)
        if matches!(database.code().as_deref(), Some("40P01" | "40001" | "55P03" | "23505")))
}

enum Failure {
    Retry,
    Refuse(ProvisionError),
}

fn database(error: sqlx::Error) -> Failure {
    if retryable(&error) {
        return Failure::Retry;
    }
    match &error {
        sqlx::Error::Database(database) if database.code().as_deref() == Some("Z0004") => {
            Failure::Refuse(BootstrapError::AdminContinuityRequired.into())
        }
        _ => Failure::Refuse(BootstrapError::MigrationFailed.into()),
    }
}

pub async fn provision_organisation(
    url: &str,
    request: &OrganisationProvision,
) -> Result<ProvisionOutcome, ProvisionError> {
    for _ in 0..ATTEMPTS {
        let outcome = tokio::time::timeout(ATTEMPT_DEADLINE, async {
            let mut conn = connect(url).await.map_err(|e| Failure::Refuse(e.into()))?;
            check_postgres(&mut conn)
                .await
                .map_err(|e| Failure::Refuse(e.into()))?;
            let result = attempt(&mut conn, request).await;
            let _ = conn.close().await;
            result
        })
        .await
        .map_err(|_| ProvisionError::Bootstrap(BootstrapError::DatabaseUnavailable))?;
        match outcome {
            Ok(outcome) => return Ok(outcome),
            Err(Failure::Refuse(error)) => return Err(error),
            Err(Failure::Retry) => continue,
        }
    }
    Err(BootstrapError::DatabaseUnavailable.into())
}

async fn attempt(
    conn: &mut PgConnection,
    request: &OrganisationProvision,
) -> Result<ProvisionOutcome, Failure> {
    let mut tx = conn.begin().await.map_err(database)?;
    // The continuity guards refuse snapshot isolation; never inherit a default.
    sqlx::query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED")
        .execute(&mut *tx)
        .await
        .map_err(database)?;
    // Application order: organisation advisory 205 before identity row locks.
    sqlx::query("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1,205))")
        .bind(&request.organisation_id)
        .execute(&mut *tx)
        .await
        .map_err(database)?;
    // Only the exact current schema may be written; provisioning never migrates.
    check_schema(&mut tx, false)
        .await
        .map_err(|e| Failure::Refuse(e.into()))?;

    let existing: Option<(String, bool)> = sqlx::query_as(
        "SELECT id,active FROM public.identities WHERE issuer=$1 AND subject=$2 FOR SHARE",
    )
    .bind(&request.issuer)
    .bind(&request.subject)
    .fetch_optional(&mut *tx)
    .await
    .map_err(database)?;
    let organisation: Option<String> =
        sqlx::query_scalar("SELECT name FROM public.organisations WHERE id=$1 FOR UPDATE")
            .bind(&request.organisation_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(database)?;

    if let Some(name) = organisation {
        // Exact retry only: same name, same issuer/subject identity, and exactly an
        // active, non-expiring, Admin-only membership. The display name may have
        // been refreshed by sign-in and is not compared. Nothing is written.
        let Some((identity_id, active)) = existing else {
            return Err(Failure::Refuse(ProvisionError::OrganisationConflict));
        };
        if name != request.organisation_name || !active {
            return Err(Failure::Refuse(ProvisionError::OrganisationConflict));
        }
        let exact: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM public.organisation_memberships WHERE organisation_id=$1 AND actor_id=$2 AND active AND expires_at IS NULL AND roles=ARRAY['admin']::text[])",
        )
        .bind(&request.organisation_id)
        .bind(&identity_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(database)?;
        if !exact {
            return Err(Failure::Refuse(ProvisionError::OrganisationConflict));
        }
        tx.rollback().await.map_err(database)?;
        return Ok(ProvisionOutcome::AlreadyProvisioned { identity_id });
    }

    let identity_id = match existing {
        Some((_, false)) => return Err(Failure::Refuse(ProvisionError::IdentityInactive)),
        Some((id, true)) => id,
        None => {
            let id = request.derived_identity_id();
            // A concurrent sign-in for the same pair raises 23505 and retries the
            // whole transaction, which then reuses that identity.
            let inserted = sqlx::query(
                "INSERT INTO public.identities(id,issuer,subject,display_name) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING",
            )
            .bind(&id)
            .bind(&request.issuer)
            .bind(&request.subject)
            .bind(&request.display_name)
            .execute(&mut *tx)
            .await
            .map_err(database)?;
            if inserted.rows_affected() != 1 {
                return Err(Failure::Refuse(ProvisionError::IdentityConflict));
            }
            id
        }
    };
    sqlx::query("INSERT INTO public.organisations(id,name) VALUES($1,$2)")
        .bind(&request.organisation_id)
        .bind(&request.organisation_name)
        .execute(&mut *tx)
        .await
        .map_err(database)?;
    sqlx::query(
        "INSERT INTO public.organisation_memberships(organisation_id,actor_id,roles,active,expires_at) VALUES($1,$2,ARRAY['admin']::text[],true,NULL)",
    )
    .bind(&request.organisation_id)
    .bind(&identity_id)
    .execute(&mut *tx)
    .await
    .map_err(database)?;
    check_schema(&mut tx, false)
        .await
        .map_err(|e| Failure::Refuse(e.into()))?;
    // Deferred continuity checks run here; a refusal rolls back every write.
    tx.commit().await.map_err(database)?;
    Ok(ProvisionOutcome::Provisioned { identity_id })
}

#[cfg(test)]
mod tests {
    use super::*;

    const ISSUER: &str = "https://cognito-idp.eu-west-2.amazonaws.com/eu-west-2_AbC123";
    const SUBJECT: &str = "7f1c2a3b-0000-4000-8000-000000000001";

    fn build(id: &str, name: &str, issuer: &str, subject: &str, display: &str) -> ProvisionError {
        OrganisationProvision::new(id, name, issuer, subject, display).unwrap_err()
    }

    #[test]
    fn accepts_exact_values_verbatim() {
        let request =
            OrganisationProvision::new("org_1-A", "Northstar LLP", ISSUER, SUBJECT, "Casey Admin")
                .unwrap();
        assert_eq!(request.organisation_id(), "org_1-A");
        assert_eq!(request.issuer, ISSUER);
        assert!(
            OrganisationProvision::new(&"a".repeat(128), "N", ISSUER, SUBJECT, "C").is_ok(),
            "128-character IDs are in range"
        );
    }

    #[test]
    fn refuses_invalid_organisation_ids() {
        for id in ["", "has space", "dot.ted", "é", &"a".repeat(129)] {
            assert_eq!(
                build(id, "N", ISSUER, SUBJECT, "C"),
                ProvisionError::InvalidOrganisationId,
                "{id}"
            );
        }
    }

    #[test]
    fn refuses_labels_with_unicode_whitespace_edges_or_controls() {
        for name in [
            "",
            " Lead",
            "Trail\u{3000}",
            "\u{85}Next",
            "Bad\u{7}",
            &"x".repeat(201),
        ] {
            assert_eq!(
                build("org", name, ISSUER, SUBJECT, "C"),
                ProvisionError::InvalidOrganisationName
            );
            assert_eq!(
                build("org", "N", ISSUER, SUBJECT, name),
                ProvisionError::InvalidDisplayName
            );
        }
        // U+FEFF is not Unicode White_Space: Rust trim (not ECMAScript) semantics.
        assert!(OrganisationProvision::new("org", "\u{feff}N", ISSUER, SUBJECT, "C").is_ok());
    }

    #[test]
    fn refuses_unsafe_issuers() {
        for issuer in [
            "",
            "http://idp.example/pool",
            "https://user:secret@idp.example/pool",
            "https://idp.example/pool?x=1",
            "https://idp.example/pool#f",
            "https://idp.example/ pool",
            "not a url",
        ] {
            assert_eq!(
                build("org", "N", issuer, SUBJECT, "C"),
                ProvisionError::InvalidIssuer,
                "{issuer}"
            );
        }
        let long = format!("https://idp.example/{}", "a".repeat(2048));
        assert_eq!(
            build("org", "N", &long, SUBJECT, "C"),
            ProvisionError::InvalidIssuer
        );
    }

    #[test]
    fn refuses_invalid_subjects() {
        for subject in ["", "with space", "tab\t", &"s".repeat(256)] {
            assert_eq!(
                build("org", "N", ISSUER, subject, "C"),
                ProvisionError::InvalidSubject
            );
        }
    }

    #[test]
    fn derived_identity_is_stable_scoped_and_pair_separated() {
        let id = derived_identity_id(ISSUER, SUBJECT);
        assert_eq!(id, derived_identity_id(ISSUER, SUBJECT));
        assert_eq!(id.len(), 48);
        assert!(valid_scope_id(&id));
        assert_ne!(
            derived_identity_id("https://a.example/b", "c"),
            derived_identity_id("https://a.example/", "bc")
        );
    }

    #[test]
    fn codes_are_fixed() {
        assert_eq!(
            ProvisionError::OrganisationConflict.code(),
            "organisation_conflict"
        );
        assert_eq!(
            ProvisionError::Bootstrap(BootstrapError::SchemaMismatch).code(),
            "schema_mismatch"
        );
        assert_eq!(
            ProvisionOutcome::AlreadyProvisioned {
                identity_id: "x".into()
            }
            .code(),
            "already_provisioned"
        );
    }
}
