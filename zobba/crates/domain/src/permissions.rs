//! Pure, exact operation meaning and intersected standing Permissions.
//! Callers supply trusted current records; prompts and transport metadata never
//! supply account restrictions or authority. No network/persistence types enter.
mod history;
pub use history::*;
#[cfg(test)]
mod tests;
use crate::{
    identity::{Scope, valid_scope_id},
    task::ClaimBasis,
};

pub const OPERATION_VERSION: u16 = 1;
pub const MATERIAL_MAX: usize = 4_000;
pub const SET_MAX: usize = 16;
// Eight maximal rules per hard/standing bound keep all thirteen documents of a
// complete accepted authority snapshot below its one-MiB durable byte envelope.
pub const POLICY_RULES_MAX: usize = 8;
pub const DELEGATION_MAX: usize = 8;
pub const OPERATION_PAGE_SIZE: usize = 50;
pub const MAX_TIMESTAMP: i64 = 253_402_300_799;

macro_rules! vocabulary {
    ($name:ident { $($variant:ident => $value:literal),+ $(,)? }) => {
        #[derive(Clone, Copy, Debug, PartialEq, Eq)]
        pub enum $name { $($variant),+ }
        impl $name {
            pub const fn as_str(self) -> &'static str { match self { $(Self::$variant => $value),+ } }
            pub fn parse(value: &str) -> Option<Self> { match value { $($value => Some(Self::$variant),)+ _ => None } }
        }
    }
}
vocabulary!(Purpose { LiveInspection => "live_inspection", TestWorkflows => "test_workflows", AuditCoordination => "audit_coordination" });
vocabulary!(Action { Read => "read", Write => "write", Send => "send" });
vocabulary!(PolicyKind { Organisation => "organisation", Engagement => "engagement", Member => "member", Account => "account", Task => "task", Delegation => "delegation" });
vocabulary!(EnvironmentKind { Live => "live", Test => "test", Audit => "audit" });
vocabulary!(ReadRestriction { None => "none", SourceReadOnly => "source_read_only", ValidatedAdapter => "validated_adapter" });
vocabulary!(OperationState { NeedsDecision => "needs_decision", Ready => "ready", PossiblyDispatched => "possibly_dispatched", Accepted => "accepted", Completed => "completed", Absent => "absent", Revoked => "revoked" });
vocabulary!(SourceFact { Unknown => "unknown", Accepted => "accepted", Completed => "completed", AuthoritativelyAbsent => "authoritatively_absent" });

pub fn valid_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn ordered_ids(values: &[String]) -> bool {
    values.len() <= SET_MAX
        && values.iter().all(|v| valid_scope_id(v))
        && values.windows(2).all(|p| p[0] < p[1])
}
fn valid_time(value: i64) -> bool {
    (1..=MAX_TIMESTAMP).contains(&value)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Attachment {
    pub id: String,
    pub digest: String,
    pub classification: String,
}

/// An owned logical destination, account and environment, never a caller-picked
/// network URL or credential handle. A fixed adapter resolves these identifiers.
/// Arrays have a single canonical order; no implicit trimming/case rewriting.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CanonicalOperation {
    pub version: u16,
    pub purpose: Purpose,
    pub action: Action,
    pub account_id: String,
    pub environment_id: String,
    pub destination: String,
    pub recipients: Vec<String>,
    pub material: String,
    pub material_digest: String,
    pub attachments: Vec<Attachment>,
    pub resource_id: String,
    pub resource_version: String,
    pub expires_at: i64,
}

impl CanonicalOperation {
    pub fn is_valid(&self) -> bool {
        self.version == OPERATION_VERSION
            && [
                &self.account_id,
                &self.environment_id,
                &self.destination,
                &self.resource_id,
                &self.resource_version,
            ]
            .iter()
            .all(|v| valid_scope_id(v))
            && ordered_ids(&self.recipients)
            && self.material.len() <= MATERIAL_MAX
            && !self
                .material
                .chars()
                .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
            && valid_digest(&self.material_digest)
            && self.attachments.len() <= SET_MAX
            && self.attachments.iter().all(|a| {
                valid_scope_id(&a.id)
                    && valid_digest(&a.digest)
                    && valid_scope_id(&a.classification)
            })
            && self.attachments.windows(2).all(|p| p[0].id < p[1].id)
            && valid_time(self.expires_at)
            && (self.action != Action::Send || !self.recipients.is_empty())
    }

    /// Versioned, length-framed UTF-8/big-endian encoding. SHA-256 is computed by
    /// the infrastructure layer. Invalid/ambiguous inputs have no encoding.
    pub fn canonical_bytes(&self) -> Option<Vec<u8>> {
        if !self.is_valid() {
            return None;
        }
        fn field(out: &mut Vec<u8>, value: &str) {
            out.extend_from_slice(&(value.len() as u32).to_be_bytes());
            out.extend_from_slice(value.as_bytes());
        }
        let mut out = b"zobba-operation\0".to_vec();
        out.extend_from_slice(&self.version.to_be_bytes());
        for value in [
            self.purpose.as_str(),
            self.action.as_str(),
            &self.account_id,
            &self.environment_id,
            &self.destination,
        ] {
            field(&mut out, value);
        }
        out.extend_from_slice(&(self.recipients.len() as u32).to_be_bytes());
        for recipient in &self.recipients {
            field(&mut out, recipient);
        }
        field(&mut out, &self.material);
        field(&mut out, &self.material_digest);
        out.extend_from_slice(&(self.attachments.len() as u32).to_be_bytes());
        for attachment in &self.attachments {
            for value in [
                &attachment.id,
                &attachment.digest,
                &attachment.classification,
            ] {
                field(&mut out, value);
            }
        }
        field(&mut out, &self.resource_id);
        field(&mut out, &self.resource_version);
        out.extend_from_slice(&self.expires_at.to_be_bytes());
        Some(out)
    }
}

/// One explicit tuple. There are no glob, hostname, domain or textual allow rules.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PermissionRule {
    pub purpose: Purpose,
    pub action: Action,
    pub account_id: String,
    pub environment_id: String,
    pub destination: String,
    pub resource_id: String,
    pub recipients: Vec<String>,
    pub attachment_classifications: Vec<String>,
    pub expires_at: i64,
}
impl PermissionRule {
    pub fn is_valid(&self) -> bool {
        [
            &self.account_id,
            &self.environment_id,
            &self.destination,
            &self.resource_id,
        ]
        .iter()
        .all(|v| valid_scope_id(v))
            && ordered_ids(&self.recipients)
            && ordered_ids(&self.attachment_classifications)
            && valid_time(self.expires_at)
    }
    pub fn covers(&self, request: &CanonicalOperation, now: i64) -> bool {
        self.is_valid()
            && self.expires_at > now
            && request.expires_at <= self.expires_at
            && self.purpose == request.purpose
            && self.action == request.action
            && self.account_id == request.account_id
            && self.environment_id == request.environment_id
            && self.destination == request.destination
            && self.resource_id == request.resource_id
            && request
                .recipients
                .iter()
                .all(|v| self.recipients.contains(v))
            && request
                .attachments
                .iter()
                .all(|v| self.attachment_classifications.contains(&v.classification))
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PermissionBounds {
    pub rules: Vec<PermissionRule>,
}
impl PermissionBounds {
    pub fn is_valid(&self) -> bool {
        self.rules.len() <= POLICY_RULES_MAX && self.rules.iter().all(PermissionRule::is_valid)
    }
    pub fn covers(&self, request: &CanonicalOperation, now: i64) -> bool {
        self.is_valid() && self.rules.iter().any(|v| v.covers(request, now))
    }
}

/// Trusted account verification, stored in the Account policy version, never
/// accepted from an operation proposal. Test resource and cleanup identities must
/// be explicitly verified; a name containing "test" establishes nothing.
/// Trusted qualified source identity. Ledger incarnation survives a normal
/// endpoint restart; a new/empty ledger must receive another ledger_id. The
/// endpoint digest additionally pins the configured numeric network route.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SourceBinding {
    pub source_id: String,
    pub ledger_id: String,
    pub endpoint_digest: String,
    pub contract_version: u16,
}
impl SourceBinding {
    pub fn is_valid(&self) -> bool {
        valid_scope_id(&self.source_id)
            && valid_scope_id(&self.ledger_id)
            && valid_digest(&self.endpoint_digest)
            && self.contract_version == 1
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AccountRestriction {
    pub source: SourceBinding,
    pub account_id: String,
    pub environment_id: String,
    pub environment: EnvironmentKind,
    pub read_restriction: ReadRestriction,
    pub restriction_survives_takeover: bool,
    pub test_environment_verified: bool,
    pub test_resources: Vec<String>,
    pub test_cleanup_id: Option<String>,
    pub audit_resources: Vec<String>,
}
impl AccountRestriction {
    pub fn is_valid(&self) -> bool {
        self.source.is_valid()
            && valid_scope_id(&self.account_id)
            && valid_scope_id(&self.environment_id)
            && ordered_ids(&self.test_resources)
            && ordered_ids(&self.audit_resources)
            && self.test_cleanup_id.as_deref().is_none_or(valid_scope_id)
    }
    pub fn permits(&self, request: &CanonicalOperation) -> bool {
        if !self.is_valid()
            || self.account_id != request.account_id
            || self.environment_id != request.environment_id
        {
            return false;
        }
        match request.purpose {
            Purpose::LiveInspection => {
                request.action == Action::Read
                    && self.environment == EnvironmentKind::Live
                    && self.read_restriction != ReadRestriction::None
                    && self.restriction_survives_takeover
            }
            Purpose::TestWorkflows => {
                self.environment == EnvironmentKind::Test
                    && self.test_environment_verified
                    && self.test_resources.contains(&request.resource_id)
                    && self.test_cleanup_id.is_some()
            }
            Purpose::AuditCoordination => {
                self.environment == EnvironmentKind::Audit
                    && self.audit_resources.contains(&request.resource_id)
            }
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PolicyReference {
    pub kind: PolicyKind,
    pub subject_id: String,
    pub version: u64,
}
impl PolicyReference {
    pub fn is_valid(&self) -> bool {
        valid_scope_id(&self.subject_id) && (1..=i64::MAX as u64).contains(&self.version)
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PolicyDocument {
    pub schema_version: u16,
    pub kind: PolicyKind,
    pub subject_id: String,
    pub version: u64,
    pub actor_id: String,
    pub created_at: i64,
    pub revoked: bool,
    pub hard: PermissionBounds,
    pub standing: PermissionBounds,
    pub account: Option<AccountRestriction>,
    pub parent: Option<PolicyReference>,
}
impl PolicyDocument {
    pub fn reference(&self) -> PolicyReference {
        PolicyReference {
            kind: self.kind,
            subject_id: self.subject_id.clone(),
            version: self.version,
        }
    }
    pub fn is_valid(&self) -> bool {
        self.schema_version == 1
            && self.reference().is_valid()
            && valid_scope_id(&self.actor_id)
            && valid_time(self.created_at)
            && self.hard.is_valid()
            && self.standing.is_valid()
            && match (&self.account, self.kind) {
                (Some(v), PolicyKind::Account) => v.is_valid() && v.account_id == self.subject_id,
                (None, kind) => kind != PolicyKind::Account,
                _ => false,
            }
            && match (&self.parent, self.kind) {
                (Some(v), PolicyKind::Delegation) => {
                    v.is_valid() && matches!(v.kind, PolicyKind::Task | PolicyKind::Delegation)
                }
                (None, kind) => kind != PolicyKind::Delegation,
                _ => false,
            }
    }
}

/// The accepted snapshot is immutable. Current and accepted documents are both
/// intersected: current narrowing takes effect, widening never silently enlarges
/// a Task. Delegations contain the COMPLETE root-to-leaf chain (bounded at eight).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AuthoritySnapshot {
    pub scope: Scope,
    pub actor_id: String,
    pub task_id: String,
    pub organisation: PolicyDocument,
    pub engagement: PolicyDocument,
    pub member: PolicyDocument,
    pub account: PolicyDocument,
    pub task: PolicyDocument,
    pub delegations: Vec<PolicyDocument>,
}
impl AuthoritySnapshot {
    pub fn documents(&self) -> impl Iterator<Item = &PolicyDocument> {
        [
            &self.organisation,
            &self.engagement,
            &self.member,
            &self.account,
            &self.task,
        ]
        .into_iter()
        .chain(self.delegations.iter())
    }
    pub fn is_valid(&self) -> bool {
        if !self.scope.is_valid()
            || !valid_scope_id(&self.actor_id)
            || !valid_scope_id(&self.task_id)
            || self.delegations.len() > DELEGATION_MAX
        {
            return false;
        }
        if self.organisation.kind != PolicyKind::Organisation
            || self.organisation.subject_id != self.scope.organisation_id
            || self.engagement.kind != PolicyKind::Engagement
            || self.engagement.subject_id != self.scope.engagement_id
            || self.member.kind != PolicyKind::Member
            || self.member.subject_id != self.actor_id
            || self.account.kind != PolicyKind::Account
            || self.task.kind != PolicyKind::Task
            || self.task.subject_id != self.task_id
            || !self.documents().all(PolicyDocument::is_valid)
        {
            return false;
        }
        let mut parent = self.task.reference();
        for (index, delegation) in self.delegations.iter().enumerate() {
            if delegation.kind != PolicyKind::Delegation
                || delegation.parent.as_ref() != Some(&parent)
                || self.delegations[..index]
                    .iter()
                    .any(|v| v.subject_id == delegation.subject_id)
            {
                return false;
            }
            parent = delegation.reference();
        }
        true
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PermissionVerdict {
    Denied,
    NeedsDecision,
    Standing,
}

pub fn evaluate(
    request: &CanonicalOperation,
    current: &AuthoritySnapshot,
    accepted: &AuthoritySnapshot,
    now: i64,
) -> PermissionVerdict {
    if !request.is_valid()
        || !valid_time(now)
        || request.expires_at <= now
        || !current.is_valid()
        || !accepted.is_valid()
        || current.scope != accepted.scope
        || current.actor_id != accepted.actor_id
        || current.task_id != accepted.task_id
        || current.delegations.len() != accepted.delegations.len()
    {
        return PermissionVerdict::Denied;
    }
    for (current, accepted) in current.documents().zip(accepted.documents()) {
        if current.kind != accepted.kind
            || current.subject_id != accepted.subject_id
            || current.version < accepted.version
            || (current.version == accepted.version && current != accepted)
            || current.revoked
            || accepted.revoked
            || current.created_at > now
            || accepted.created_at > now
            || !current.hard.covers(request, now)
            || !accepted.hard.covers(request, now)
        {
            return PermissionVerdict::Denied;
        }
    }
    if current.account.account.as_ref().map(|v| &v.source)
        != accepted.account.account.as_ref().map(|v| &v.source)
    {
        return PermissionVerdict::Denied;
    }
    if ![current, accepted].into_iter().all(|s| {
        s.account
            .account
            .as_ref()
            .is_some_and(|a| a.permits(request))
    }) {
        return PermissionVerdict::Denied;
    }
    if current
        .documents()
        .chain(accepted.documents())
        .all(|v| v.standing.covers(request, now))
    {
        PermissionVerdict::Standing
    } else {
        PermissionVerdict::NeedsDecision
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DecisionCommand {
    pub key: String,
    pub operation_id: String,
    pub expected_revision: u64,
    pub request: CanonicalOperation,
    pub expires_at: i64,
    pub allow: bool,
}
impl DecisionCommand {
    pub fn is_valid(&self) -> bool {
        valid_scope_id(&self.key)
            && valid_scope_id(&self.operation_id)
            && (1..=i64::MAX as u64).contains(&self.expected_revision)
            && self.request.is_valid()
            && valid_time(self.expires_at)
            && self.expires_at <= self.request.expires_at
    }
    pub fn matches(&self, operation: &Operation, now: i64) -> bool {
        self.is_valid()
            && valid_time(now)
            && self.operation_id == operation.id
            && self.expected_revision == operation.revision
            && self.request == operation.request
            && self.expires_at > now
            && operation.request.expires_at > now
            && matches!(
                operation.state,
                OperationState::NeedsDecision | OperationState::Ready
            )
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OperationDecision {
    pub id: String,
    pub operation_id: String,
    pub actor_id: String,
    pub request_digest: String,
    pub expected_revision: u64,
    pub expires_at: i64,
    pub allowed: bool,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RevocationCommand {
    pub key: String,
    pub kind: PolicyKind,
    pub subject_id: String,
    pub expected_version: u64,
}
impl RevocationCommand {
    pub fn is_valid(&self) -> bool {
        valid_scope_id(&self.key)
            && valid_scope_id(&self.subject_id)
            && (1..=i64::MAX as u64).contains(&self.expected_version)
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Operation {
    pub source: SourceBinding,
    pub id: String,
    pub task_id: String,
    pub cycle_id: String,
    pub actor_id: String,
    pub request: CanonicalOperation,
    pub request_digest: String,
    pub revision: u64,
    pub state: OperationState,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OperationPage {
    pub operations: Vec<Operation>,
    pub next_cursor: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OperationAttemptPage {
    pub attempts: Vec<OperationAttempt>,
    pub next_cursor: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OperationAttempt {
    pub id: String,
    pub operation_id: String,
    pub request_digest: String,
    pub observed: SourceFact,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OperationCustody {
    Dispatch,
    ReceiptOnly,
}

/// Receipt custody is deliberately neither Debug, Clone nor Serialize. A recovered
/// copy supplies facts only; it is never a one-use dispatch claim.
///
/// ```compile_fail
/// use zobba_domain::permissions::ConsumedOperation;
/// fn diagnostic(attempt: &ConsumedOperation) -> String {
///     format!("{attempt:?}")
/// }
/// ```
pub struct ConsumedOperation {
    pub source: SourceBinding,
    pub custody: OperationCustody,
    pub basis: ClaimBasis,
    pub operation_id: String,
    pub attempt_id: String,
    pub claim_id: String,
    pub request: CanonicalOperation,
    pub request_digest: String,
    pub receipt_capability: String,
}

impl SourceFact {
    pub const fn is_resolved(self) -> bool {
        matches!(self, Self::Completed | Self::AuthoritativelyAbsent)
    }
    /// Facts can strengthen Unknown/Accepted but terminal observations cannot
    /// contradict one another. Unknown never overwrites a stronger observation.
    pub const fn can_follow(self, earlier: Self) -> bool {
        match earlier {
            Self::Unknown => true,
            Self::Accepted => matches!(self, Self::Accepted | Self::Completed),
            Self::Completed => matches!(self, Self::Completed),
            Self::AuthoritativelyAbsent => matches!(self, Self::AuthoritativelyAbsent),
        }
    }
}
