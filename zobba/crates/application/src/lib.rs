//! Application-owned ports. No SQL, HTTP or vendor error crosses them.
pub mod conversation;
pub mod engagement_setup;
pub mod evidence;
pub mod identity;
pub mod knowledge;
pub mod membership;
pub mod methodology;
pub mod model;
pub mod operation;
pub mod skills;
pub mod task;
pub mod work;
use std::{fmt, future::Future};
use zobba_domain::SchemaVersion;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BootstrapError {
    InvalidConfiguration,
    DatabaseUnavailable,
    UnsupportedPostgres,
    UnsafeRuntimeRole,
    SchemaMismatch,
    MigrationFailed,
    MembershipExpiryOutOfRange,
    AdminContinuityRequired,
    ListenerUnavailable,
}

impl BootstrapError {
    pub const fn code(self) -> &'static str {
        match self {
            Self::InvalidConfiguration => "invalid_configuration",
            Self::DatabaseUnavailable => "database_unavailable",
            Self::UnsupportedPostgres => "unsupported_postgres",
            Self::UnsafeRuntimeRole => "unsafe_runtime_role",
            Self::SchemaMismatch => "schema_mismatch",
            Self::MigrationFailed => "migration_failed",
            Self::MembershipExpiryOutOfRange => "membership_expiry_out_of_range",
            Self::AdminContinuityRequired => "admin_continuity_required",
            Self::ListenerUnavailable => "listener_unavailable",
        }
    }
}

impl fmt::Display for BootstrapError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.code())
    }
}
impl std::error::Error for BootstrapError {}

pub trait SchemaHealth: Send + Sync {
    fn check(&self) -> impl Future<Output = Result<SchemaVersion, BootstrapError>> + Send;
}

pub async fn readiness(port: &impl SchemaHealth) -> Result<SchemaVersion, BootstrapError> {
    port.check().await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diagnostics_are_allowlisted_codes_only() {
        for error in [
            BootstrapError::InvalidConfiguration,
            BootstrapError::DatabaseUnavailable,
            BootstrapError::UnsupportedPostgres,
            BootstrapError::UnsafeRuntimeRole,
            BootstrapError::SchemaMismatch,
            BootstrapError::MigrationFailed,
            BootstrapError::MembershipExpiryOutOfRange,
            BootstrapError::AdminContinuityRequired,
            BootstrapError::ListenerUnavailable,
        ] {
            assert!(
                error
                    .to_string()
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c == '_')
            );
        }
    }
}
