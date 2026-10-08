//! Current-authority ports. Transport, database and provider types stay outside.
use std::future::Future;
use zobba_domain::identity::{Engagement, EngagementPage, Identity, Scope};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IdentityError {
    Unauthenticated,
    SessionChanged,
    Denied,
    Unavailable,
    InvalidResponse,
    ExpiredLoginConsumed,
    Capacity,
    InvalidScope,
}

impl IdentityError {
    pub const fn code(self) -> &'static str {
        match self {
            Self::Unauthenticated => "authentication_required",
            Self::SessionChanged => "session_changed",
            Self::Denied => "access_denied",
            Self::Unavailable => "identity_unavailable",
            Self::InvalidResponse => "sign_in_failed",
            Self::ExpiredLoginConsumed => "sign_in_failed",
            Self::Capacity => "login_capacity",
            Self::InvalidScope => "invalid_scope",
        }
    }
}

/// Private evidence from the signed OIDC ID token verified at this session's
/// callback. It is never part of the browser profile or session response.
/// The timestamp records claim verification, not provider password/MFA reauthentication.
#[derive(Clone, PartialEq, Eq)]
pub struct VerifiedRecipientProof {
    pub issuer: String,
    pub email: String,
    pub verified_at: i64,
}

pub struct CurrentSession {
    pub identity: Identity,
    pub csrf_token: String,
    pub recipient_proof: Option<VerifiedRecipientProof>,
}

pub trait CurrentAuthority: Send + Sync {
    fn session(
        &self,
        token: &str,
    ) -> impl Future<Output = Result<CurrentSession, IdentityError>> + Send;
    fn engagements(
        &self,
        actor_id: &str,
        after: Option<&Scope>,
    ) -> impl Future<Output = Result<EngagementPage, IdentityError>> + Send;
    fn engagement(
        &self,
        actor_id: &str,
        scope: &Scope,
    ) -> impl Future<Output = Result<Engagement, IdentityError>> + Send;
}
