//! Current-authority operation persistence and the sole trusted external gateway.
pub mod wire;
use std::{fmt, future::Future};
use zobba_domain::{
    identity::Scope,
    permissions::{
        AuthoritySnapshot, CanonicalOperation, ConsumedOperation, DecisionCommand, Operation,
        OperationAttemptPage, OperationDecision, OperationPage, PolicyDocument, PolicyReference,
        RevocationCommand, SourceFact,
    },
    task::ClaimBasis,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OperationError {
    Invalid,
    Denied,
    Conflict,
    Capacity,
    Unavailable,
    Fenced,
    NeedsDecision,
}
impl OperationError {
    pub const fn code(self) -> &'static str {
        match self {
            Self::Invalid => "invalid_operation",
            Self::Denied => "access_denied",
            Self::Conflict => "operation_conflict",
            Self::Capacity => "operation_capacity",
            Self::Unavailable => "operation_unavailable",
            Self::Fenced => "operation_fenced",
            Self::NeedsDecision => "operation_needs_decision",
        }
    }
}
impl fmt::Display for OperationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.code())
    }
}
impl std::error::Error for OperationError {}

/// Exact immutable native model proposal identity. It supplies provenance only;
/// both admission and consumption recheck the current catalogue and Permissions.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ModelToolBinding {
    pub invocation_id: String,
    pub call_id: String,
}

/// Every scoped call reauthorizes current membership. Mutations use the shared
/// engagement/Task fences and a single short transaction. No DB connection spans
/// gateway I/O. Scope and policy lookups are trusted, never operation-supplied.
pub trait OperationStore: Send + Sync {
    fn save_policy(
        &self,
        actor: &str,
        scope: &Scope,
        policy: &PolicyDocument,
    ) -> impl Future<Output = Result<PolicyReference, OperationError>> + Send;
    /// Explicit attributable Task acceptance is the sole way to widen the frozen
    /// upper bound. The repository verifies every supplied version is current.
    fn accept_authority(
        &self,
        actor: &str,
        scope: &Scope,
        task_id: &str,
        authority: &AuthoritySnapshot,
    ) -> impl Future<Output = Result<PolicyReference, OperationError>> + Send;
    /// The caller durably chooses one logical-intent key before submission. The
    /// repository binds that key to actor/scope/Task/cycle/intent/execution and the
    /// exact canonical request, independently of worker, claim and attempt IDs.
    /// A replacement owner retrieves the same operation; material reuse conflicts.
    fn admit(
        &self,
        actor: &str,
        scope: &Scope,
        basis: &ClaimBasis,
        operation_key: &str,
        request: &CanonicalOperation,
    ) -> impl Future<Output = Result<Operation, OperationError>> + Send;
    fn admit_model_tool(
        &self,
        actor: &str,
        scope: &Scope,
        basis: &ClaimBasis,
        operation_key: &str,
        request: &CanonicalOperation,
        binding: &ModelToolBinding,
    ) -> impl Future<Output = Result<Operation, OperationError>> + Send {
        let _ = (actor, scope, basis, operation_key, request, binding);
        async { Err(OperationError::Unavailable) }
    }
    fn decide(
        &self,
        actor: &str,
        scope: &Scope,
        decision: &DecisionCommand,
    ) -> impl Future<Output = Result<OperationDecision, OperationError>> + Send;
    fn revoke(
        &self,
        actor: &str,
        scope: &Scope,
        command: &RevocationCommand,
    ) -> impl Future<Output = Result<PolicyReference, OperationError>> + Send;
    fn get(
        &self,
        actor: &str,
        scope: &Scope,
        id: &str,
    ) -> impl Future<Output = Result<Operation, OperationError>> + Send;
    fn list(
        &self,
        actor: &str,
        scope: &Scope,
        task_id: &str,
        after: Option<&str>,
    ) -> impl Future<Output = Result<OperationPage, OperationError>> + Send;
    /// Read bounded immutable decision, attempt and observation records under
    /// fresh scope authority. Every collection has an independent ID cursor;
    /// no execution or receipt capability is disclosed by this projection.
    fn history(
        &self,
        actor: &str,
        scope: &Scope,
        operation_id: &str,
        query: &zobba_domain::permissions::OperationHistoryQuery,
    ) -> impl Future<Output = Result<zobba_domain::permissions::OperationHistory, OperationError>> + Send;
    /// Atomically rechecks all current and accepted policy/lineage and Task
    /// fences, then consumes exactly once. Commit is the possible-dispatch cutoff.
    fn consume(
        &self,
        basis: &ClaimBasis,
        operation_id: &str,
    ) -> impl Future<Output = Result<ConsumedOperation, OperationError>> + Send;
    /// Exact late receipt only: never adopts a new audience or execution authority.
    fn observe(
        &self,
        attempt: &ConsumedOperation,
        fact: SourceFact,
    ) -> impl Future<Output = Result<(), OperationError>> + Send;
    fn unresolved(
        &self,
        actor: &str,
        scope: &Scope,
        task_id: &str,
        after: Option<&str>,
    ) -> impl Future<Output = Result<OperationAttemptPage, OperationError>> + Send;
    /// Revalidate reusable receipt custody before each source lookup. This port
    /// never mints another capability, dispatches, or changes Task state.
    fn reauthorize_recovery(
        &self,
        actor: &str,
        scope: &Scope,
        custody: &ConsumedOperation,
    ) -> impl Future<Output = Result<(), OperationError>> + Send;
    /// Grants only restricted observation custody after fresh audience checks.
    /// Recovery MUST query the source before any newly admitted/consumed attempt.
    fn recover(
        &self,
        actor: &str,
        scope: &Scope,
        attempt_id: &str,
    ) -> impl Future<Output = Result<ConsumedOperation, OperationError>> + Send;
}

/// Implementations resolve a fixed owned endpoint; request destination labels do
/// not select arbitrary hosts. Calls/results/retries must be independently bounded.
pub trait OperationGateway: Send + Sync {
    fn dispatch(
        &self,
        attempt: &ConsumedOperation,
    ) -> impl Future<Output = Result<SourceFact, OperationError>> + Send;
    /// AuthoritativelyAbsent requires a source contract that also fences delayed
    /// dispatch of this exact attempt. Empty search or timeout is Unknown.
    fn lookup(
        &self,
        attempt: &ConsumedOperation,
    ) -> impl Future<Output = Result<SourceFact, OperationError>> + Send;
}
