//! Durable Task ports. Scope, current authority and atomicity belong to every call.
use std::{fmt, future::Future};
use zobba_domain::{
    identity::Scope,
    task::{
        ClaimBasis, CommandReceipt, ConsumedAttempt, Decision, Observation, TaskCommand, TaskEvent,
        TaskPage, TaskSnapshot, WakeupRoute,
    },
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TaskError {
    Invalid,
    Denied,
    Conflict,
    Capacity,
    Unavailable,
    Fenced,
}

impl TaskError {
    pub const fn code(self) -> &'static str {
        match self {
            Self::Invalid => "invalid_task_command",
            Self::Denied => "access_denied",
            Self::Conflict => "task_command_conflict",
            Self::Capacity => "task_capacity",
            Self::Unavailable => "task_unavailable",
            Self::Fenced => "task_fenced",
        }
    }
}

impl fmt::Display for TaskError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.code())
    }
}
impl std::error::Error for TaskError {}

pub trait TaskCommands: Send + Sync {
    fn admit(
        &self,
        actor: &str,
        scope: &Scope,
        command: &TaskCommand,
    ) -> impl Future<Output = Result<CommandReceipt, TaskError>> + Send;
    fn get(
        &self,
        actor: &str,
        scope: &Scope,
        id: &str,
    ) -> impl Future<Output = Result<TaskSnapshot, TaskError>> + Send;
    fn list(
        &self,
        actor: &str,
        scope: &Scope,
        after: Option<&str>,
    ) -> impl Future<Output = Result<TaskPage, TaskError>> + Send;
    fn events(
        &self,
        actor: &str,
        scope: &Scope,
        after: u64,
    ) -> impl Future<Output = Result<Vec<TaskEvent>, TaskError>> + Send;
}

/// Metadata-only durable delivery. A delivery lease is neither Task ownership nor
/// permission: every route must pass fresh scoped execution-authority checks.
pub trait TaskDelivery: Send + Sync {
    /// Acquire at most the owned delivery batch bound, without returning content,
    /// claims or receipt capabilities. Lost notifications never remove this work.
    fn take(
        &self,
        limit: usize,
        worker_id: &str,
    ) -> impl Future<Output = Result<Vec<WakeupRoute>, TaskError>> + Send;

    /// Release only this worker's delivery lease. Scheduling and Task state stay
    /// under the scoped coordinator's authority.
    fn release(
        &self,
        route: &WakeupRoute,
        worker_id: &str,
    ) -> impl Future<Output = Result<(), TaskError>> + Send;
}

/// Current-authority coordination and exact-attempt receipt contract. Concrete
/// persistence and process execution stay outside this application boundary.
/// Callers bound each wait; a cancelled/failed response establishes no rollback,
/// quiescence or safe replay after a possibly committed consumption.
pub trait TaskExecution: Send + Sync {
    /// Reauthorize the recorded actor and immutable scope, apply pending intent at
    /// a work boundary, and fence ownership, cycle, execution epoch and intent.
    fn coordinate(
        &self,
        route: &WakeupRoute,
        worker_id: &str,
    ) -> impl Future<Output = Result<Decision, TaskError>> + Send;

    /// Atomically recheck every fence and consume the claim before possible
    /// dispatch. A lost acknowledgement leaves an uncertain consumed attempt;
    /// replacement ownership must reconstruct it instead of blindly replaying.
    fn consume(
        &self,
        basis: &ClaimBasis,
    ) -> impl Future<Output = Result<ConsumedAttempt, TaskError>> + Send;

    /// Recheck and renew only this exact producing basis under current authority.
    /// A false result or error requests local cancellation; it proves no cessation.
    fn current(&self, basis: &ClaimBasis) -> impl Future<Output = Result<bool, TaskError>> + Send;

    /// Accept only the exact capability's immutable observation. Identical retries
    /// deduplicate; contradictions refuse. Late stale/revoked producers gain no
    /// Task reads, ownership, new execution, or transitions through this port.
    fn observe(
        &self,
        attempt: &ConsumedAttempt,
        outcome: Observation,
    ) -> impl Future<Output = Result<(), TaskError>> + Send;

    /// A freshly authorized coordinator incorporates recorded facts. Lease expiry
    /// and cancellation requests never substitute for observed child termination.
    fn reconcile(
        &self,
        route: &WakeupRoute,
        worker_id: &str,
    ) -> impl Future<Output = Result<(), TaskError>> + Send;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diagnostics_are_fixed_secret_free_codes() {
        for error in [
            TaskError::Invalid,
            TaskError::Denied,
            TaskError::Conflict,
            TaskError::Capacity,
            TaskError::Unavailable,
            TaskError::Fenced,
        ] {
            assert!(
                error
                    .to_string()
                    .chars()
                    .all(|ch| ch.is_ascii_lowercase() || ch == '_')
            );
        }
    }
}
