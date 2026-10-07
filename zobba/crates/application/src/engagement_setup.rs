//! Organisation-level engagement setup port (Story 22.2 AC4). Setup is a separate
//! aggregate from the engagement-scoped Task routes and ends by handing off to the
//! ordinary Task Create path in the same establishing transaction.
use std::{fmt, future::Future};
use zobba_domain::engagement_setup::{MemberInput, SetupOrganisation, SetupView};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SetupError {
    Invalid,
    Denied,
    Conflict,
    /// Too many open setups for this actor in the organisation.
    OpenLimit,
    /// Too many engagements established by this actor today (UTC).
    DailyLimit,
    /// The setup retains no more messages.
    MessageLimit,
    Unavailable,
}

impl SetupError {
    pub const fn code(self) -> &'static str {
        match self {
            Self::Invalid => "invalid_engagement_setup",
            Self::Denied => "access_denied",
            Self::Conflict => "engagement_setup_conflict",
            Self::OpenLimit => "engagement_setup_open_limit",
            Self::DailyLimit => "engagement_setup_daily_limit",
            Self::MessageLimit => "engagement_setup_message_limit",
            Self::Unavailable => "engagement_setup_unavailable",
        }
    }
}

impl fmt::Display for SetupError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.code())
    }
}
impl std::error::Error for SetupError {}

/// Every call authenticates the exact session and a current audit membership.
pub trait EngagementSetups: Send + Sync {
    fn organisations(
        &self,
        actor: &str,
    ) -> impl Future<Output = Result<Vec<SetupOrganisation>, SetupError>> + Send;
    fn open_setups(
        &self,
        actor: &str,
        organisation: &str,
    ) -> impl Future<Output = Result<Vec<SetupView>, SetupError>> + Send;
    /// Persists the objective, then interprets it. A retry returns the original setup.
    fn open(
        &self,
        actor: &str,
        organisation: &str,
        key: &str,
        objective: &str,
    ) -> impl Future<Output = Result<SetupView, SetupError>> + Send;
    /// Persists the member message, then interprets it. Confirm is separate.
    fn message(
        &self,
        actor: &str,
        organisation: &str,
        setup: &str,
        key: &str,
        input: &MemberInput,
    ) -> impl Future<Output = Result<SetupView, SetupError>> + Send;
    /// One transaction creates the client (when new), the engagement and period,
    /// the creator's assignment and the first Task.
    fn confirm(
        &self,
        actor: &str,
        organisation: &str,
        setup: &str,
        key: &str,
    ) -> impl Future<Output = Result<SetupView, SetupError>> + Send;
    fn get(
        &self,
        actor: &str,
        organisation: &str,
        setup: &str,
    ) -> impl Future<Output = Result<SetupView, SetupError>> + Send;
}
