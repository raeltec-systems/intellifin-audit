//! Pure, exact operation meaning and intersected standing Permissions.
//! Callers supply trusted current records; prompts and transport metadata never
//! supply account restrictions or authority. No network/persistence types enter.
mod history;
pub use history::*;
#[cfg(test)]
mod capability_tests;
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
pub const CAPABILITY_REGIONS_MAX: usize = 256;
pub const CAPABILITY_COMPARISONS_MAX: usize = 65_536;

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
    fn key(&self) -> RuleKey<'_> {
        RuleKey {
            purpose: self.purpose,
            action: self.action,
            account_id: &self.account_id,
            environment_id: &self.environment_id,
            destination: &self.destination,
            resource_id: &self.resource_id,
        }
    }
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
            && deadline_covers(self.expires_at, request.expires_at, now)
            && self.key() == RuleKey::operation(request)
            && contains_all(
                &self.recipients,
                request.recipients.iter().map(String::as_str),
            )
            && contains_all(
                &self.attachment_classifications,
                request
                    .attachments
                    .iter()
                    .map(|v| v.classification.as_str()),
            )
    }
}

/// Shared exact tuple: projected possibilities cannot combine independently
/// matching destinations, accounts or resources from different policy rules.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct RuleKey<'a> {
    purpose: Purpose,
    action: Action,
    account_id: &'a str,
    environment_id: &'a str,
    destination: &'a str,
    resource_id: &'a str,
}
impl<'a> RuleKey<'a> {
    fn operation(request: &'a CanonicalOperation) -> Self {
        Self {
            purpose: request.purpose,
            action: request.action,
            account_id: &request.account_id,
            environment_id: &request.environment_id,
            destination: &request.destination,
            resource_id: &request.resource_id,
        }
    }
}
fn contains_all<'a>(allowed: &[String], requested: impl IntoIterator<Item = &'a str>) -> bool {
    requested
        .into_iter()
        .all(|v| allowed.iter().any(|a| a == v))
}
fn deadline_covers(deadline: i64, requested_deadline: i64, now: i64) -> bool {
    deadline > now && requested_deadline <= deadline
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
        self.permits_key(RuleKey::operation(request))
    }
    /// Necessary account-only compatibility, without projecting policy rules.
    /// Unspecified fields use an account-permitted possibility solely to avoid
    /// claiming a denial from missing details. This never proves a grant.
    fn permits_need(&self, need: &CapabilityNeed) -> bool {
        let possible_resource = match need.purpose {
            Purpose::LiveInspection => "",
            Purpose::TestWorkflows => self.test_resources.first().map_or("", String::as_str),
            Purpose::AuditCoordination => self.audit_resources.first().map_or("", String::as_str),
        };
        self.permits_key(RuleKey {
            purpose: need.purpose,
            action: need.action,
            account_id: need.account_id.as_deref().unwrap_or(&self.account_id),
            environment_id: need
                .environment_id
                .as_deref()
                .unwrap_or(&self.environment_id),
            destination: need.destination.as_deref().unwrap_or(""),
            resource_id: need.resource_id.as_deref().unwrap_or(possible_resource),
        })
    }
    fn permits_key(&self, key: RuleKey<'_>) -> bool {
        if !self.is_valid()
            || self.account_id != key.account_id
            || self.environment_id != key.environment_id
        {
            return false;
        }
        match key.purpose {
            Purpose::LiveInspection => {
                key.action == Action::Read
                    && self.environment == EnvironmentKind::Live
                    && self.read_restriction != ReadRestriction::None
                    && self.restriction_survives_takeover
            }
            Purpose::TestWorkflows => {
                self.environment == EnvironmentKind::Test
                    && self.test_environment_verified
                    && self.test_resources.iter().any(|v| v == key.resource_id)
                    && self.test_cleanup_id.is_some()
            }
            Purpose::AuditCoordination => {
                self.environment == EnvironmentKind::Audit
                    && self.audit_resources.iter().any(|v| v == key.resource_id)
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

/// A server-owned vocabulary maps one required skill need to this bounded
/// projection. Optional tuple fields and required sets only narrow that mapping.
/// This is not an operation: material, resource version, trusted attachment
/// identity and the exact operation deadline remain unresolved.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CapabilityNeed {
    pub purpose: Purpose,
    pub action: Action,
    pub account_id: Option<String>,
    pub environment_id: Option<String>,
    pub destination: Option<String>,
    pub resource_id: Option<String>,
    pub recipients: Vec<String>,
    pub attachment_classifications: Vec<String>,
    pub requires_attachments: bool,
    /// Only a trusted adapter mapping may supply this; never a manifest field.
    pub source: Option<SourceBinding>,
}
impl CapabilityNeed {
    pub fn is_valid(&self) -> bool {
        [
            &self.account_id,
            &self.environment_id,
            &self.destination,
            &self.resource_id,
        ]
        .into_iter()
        .all(|v| v.as_deref().is_none_or(valid_scope_id))
            && ordered_ids(&self.recipients)
            && ordered_ids(&self.attachment_classifications)
            && self.source.as_ref().is_none_or(SourceBinding::is_valid)
    }

    fn permits_region(&self, region: &PermissionRule, now: i64) -> bool {
        region.purpose == self.purpose
            && region.action == self.action
            && [
                (&self.account_id, &region.account_id),
                (&self.environment_id, &region.environment_id),
                (&self.destination, &region.destination),
                (&self.resource_id, &region.resource_id),
            ]
            .into_iter()
            .all(|(required, actual)| required.as_ref().is_none_or(|v| v == actual))
            && deadline_covers(region.expires_at, region.expires_at, now)
            && (self.action != Action::Send || !region.recipients.is_empty())
            && (!self.requires_attachments || !region.attachment_classifications.is_empty())
            && contains_all(
                &region.recipients,
                self.recipients.iter().map(String::as_str),
            )
            && contains_all(
                &region.attachment_classifications,
                self.attachment_classifications.iter().map(String::as_str),
            )
    }
}

vocabulary!(CapabilityStatus {
    Unavailable => "unavailable",
    Forbidden => "forbidden",
    CompatibleNeedsExactDetails => "compatible_needs_exact_details"
});
vocabulary!(CapabilityReason {
    InvalidNeed => "invalid_need",
    InvalidAuthority => "invalid_authority",
    AuthorityIntegrity => "authority_integrity",
    AuthorityReplaced => "authority_replaced",
    AuthorityRevoked => "authority_revoked",
    SourceChanged => "source_changed",
    SourceMismatch => "source_mismatch",
    HardBounds => "hard_bounds",
    AccountBoundary => "account_boundary",
    QueryCapacity => "query_capacity",
    ExactDetailsRequired => "exact_details_required"
});

/// Safe explanation of the first eliminating bound, without disclosing tuples,
/// subjects or recipients. Accepted/current provenance is retained separately.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CapabilityBound {
    pub accepted: bool,
    pub kind: PolicyKind,
    /// Zero-based root-to-leaf position, without exposing the policy subject.
    pub delegation_depth: Option<usize>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CapabilityInspection {
    pub status: CapabilityStatus,
    pub reason: CapabilityReason,
    /// Advisory refresh deadline only. Revocation may invalidate it sooner.
    pub refresh_at: Option<i64>,
    pub blocking_bound: Option<CapabilityBound>,
}
impl CapabilityInspection {
    fn refused(
        status: CapabilityStatus,
        reason: CapabilityReason,
        blocking_bound: Option<CapabilityBound>,
    ) -> Self {
        Self {
            status,
            reason,
            refresh_at: None,
            blocking_bound,
        }
    }
}

/// Structural checks shared by exact admission and advisory inspection. Invalid
/// or altered immutable records are uncertainty, not an authoritative denial.
fn authority_pair_failure(
    current: &AuthoritySnapshot,
    accepted: &AuthoritySnapshot,
    now: i64,
) -> Option<CapabilityInspection> {
    use CapabilityReason as Reason;
    use CapabilityStatus as Status;
    let refuse = |status, reason| Some(CapabilityInspection::refused(status, reason, None));
    if !valid_time(now) || !current.is_valid() || !accepted.is_valid() {
        return refuse(Status::Unavailable, Reason::InvalidAuthority);
    }
    if current.scope != accepted.scope
        || current.actor_id != accepted.actor_id
        || current.task_id != accepted.task_id
        || current.delegations.len() != accepted.delegations.len()
    {
        return refuse(Status::Forbidden, Reason::AuthorityReplaced);
    }
    for (current, accepted) in current.documents().zip(accepted.documents()) {
        if current.kind != accepted.kind || current.subject_id != accepted.subject_id {
            return refuse(Status::Forbidden, Reason::AuthorityReplaced);
        }
        if current.version < accepted.version
            || (current.version == accepted.version && current != accepted)
            || current.created_at > now
            || accepted.created_at > now
        {
            return refuse(Status::Unavailable, Reason::AuthorityIntegrity);
        }
    }
    // Finish checking immutable pair integrity before drawing any policy
    // conclusion, including an otherwise conclusive earlier revocation.
    for (index, (current, accepted)) in current.documents().zip(accepted.documents()).enumerate() {
        for (document, is_accepted) in [(accepted, true), (current, false)] {
            if document.revoked {
                return Some(CapabilityInspection::refused(
                    Status::Forbidden,
                    Reason::AuthorityRevoked,
                    Some(CapabilityBound {
                        accepted: is_accepted,
                        kind: document.kind,
                        delegation_depth: index.checked_sub(5),
                    }),
                ));
            }
        }
    }
    None
}

fn source_matches(current: &AuthoritySnapshot, accepted: &AuthoritySnapshot) -> bool {
    current.account.account.as_ref().map(|v| &v.source)
        == accepted.account.account.as_ref().map(|v| &v.source)
}

struct CapabilityBudget {
    regions: usize,
    comparisons: usize,
}
impl CapabilityBudget {
    fn compare(&mut self) -> Result<(), ()> {
        self.comparisons = self.comparisons.checked_sub(1).ok_or(())?;
        Ok(())
    }

    /// Keep correlated alternative regions intact. Only a complete superset on
    /// the same tuple and with at least the same deadline may subsume another.
    fn insert(
        &mut self,
        regions: &mut Vec<PermissionRule>,
        candidate: PermissionRule,
        now: i64,
    ) -> Result<(), ()> {
        let mut contained = Vec::new();
        for (index, region) in regions.iter().enumerate() {
            self.compare()?;
            if region_contains(region, &candidate, now) {
                return Ok(());
            }
            self.compare()?;
            if region_contains(&candidate, region, now) {
                contained.push(index);
            }
        }
        for index in contained.into_iter().rev() {
            regions.remove(index);
        }
        if regions.len() >= self.regions {
            return Err(());
        }
        regions.push(candidate);
        Ok(())
    }
}
fn region_contains(outer: &PermissionRule, inner: &PermissionRule, now: i64) -> bool {
    outer.key() == inner.key()
        && deadline_covers(outer.expires_at, inner.expires_at, now)
        && contains_all(
            &outer.recipients,
            inner.recipients.iter().map(String::as_str),
        )
        && contains_all(
            &outer.attachment_classifications,
            inner.attachment_classifications.iter().map(String::as_str),
        )
}
fn intersect_regions(left: &PermissionRule, right: &PermissionRule) -> Option<PermissionRule> {
    if left.key() != right.key() {
        return None;
    }
    let mut common = left.clone();
    common.recipients.retain(|v| right.recipients.contains(v));
    common
        .attachment_classifications
        .retain(|v| right.attachment_classifications.contains(v));
    common.expires_at = left.expires_at.min(right.expires_at);
    Some(common)
}

/// Bounded, read-only existence projection over all accepted/current hard
/// bounds. A compatible result says only that some exact details could fit;
/// an exact action may require a decision. It is never dispatch authority.
pub fn inspect_capability(
    need: &CapabilityNeed,
    current: &AuthoritySnapshot,
    accepted: &AuthoritySnapshot,
    now: i64,
) -> CapabilityInspection {
    let mut remaining_comparisons = CAPABILITY_COMPARISONS_MAX;
    inspect_capability_with_work_budget(need, current, accepted, now, &mut remaining_comparisons)
}

/// Share actual comparison work across every required need in one request.
/// Each need retains its own region/comparison ceiling. Early refusals charge
/// only the comparisons performed; structural checks can still establish a
/// denial with no remaining projection work. Exhaustion never proves denial.
pub fn inspect_capability_with_work_budget(
    need: &CapabilityNeed,
    current: &AuthoritySnapshot,
    accepted: &AuthoritySnapshot,
    now: i64,
    remaining_comparisons: &mut usize,
) -> CapabilityInspection {
    let allowance = (*remaining_comparisons).min(CAPABILITY_COMPARISONS_MAX);
    let mut budget = CapabilityBudget {
        regions: CAPABILITY_REGIONS_MAX,
        comparisons: allowance,
    };
    let inspection = inspect_capability_bounded(need, current, accepted, now, &mut budget);
    *remaining_comparisons -= allowance - budget.comparisons;
    inspection
}

fn inspect_capability_bounded(
    need: &CapabilityNeed,
    current: &AuthoritySnapshot,
    accepted: &AuthoritySnapshot,
    now: i64,
    budget: &mut CapabilityBudget,
) -> CapabilityInspection {
    use CapabilityReason as Reason;
    use CapabilityStatus as Status;
    if !need.is_valid() {
        return CapabilityInspection::refused(Status::Unavailable, Reason::InvalidNeed, None);
    }
    if let Some(failure) = authority_pair_failure(current, accepted, now) {
        return failure;
    }
    if !source_matches(current, accepted) {
        return CapabilityInspection::refused(Status::Forbidden, Reason::SourceChanged, None);
    }
    let accounts = [
        accepted.account.account.as_ref(),
        current.account.account.as_ref(),
    ];
    if need.source.as_ref().is_some_and(|source| {
        !accounts
            .iter()
            .all(|a| a.is_some_and(|a| &a.source == source))
    }) {
        return CapabilityInspection::refused(Status::Forbidden, Reason::SourceMismatch, None);
    }
    // Explicit account constraints can establish a denial without any policy
    // projection. Preserve that proof even after earlier needs exhaust the
    // shared work budget, but only after the complete authority integrity check.
    if let Some((is_accepted, _)) = [true, false]
        .into_iter()
        .zip(accounts)
        .find(|(_, account)| !account.is_some_and(|account| account.permits_need(need)))
    {
        return CapabilityInspection::refused(
            Status::Forbidden,
            Reason::AccountBoundary,
            Some(CapabilityBound {
                accepted: is_accepted,
                kind: PolicyKind::Account,
                delegation_depth: None,
            }),
        );
    }
    let capacity =
        || CapabilityInspection::refused(Status::Unavailable, Reason::QueryCapacity, None);
    let mut regions = Vec::new();
    let documents = accepted
        .documents()
        .map(|v| (v, true))
        .chain(current.documents().map(|v| (v, false)));
    for (index, (document, is_accepted)) in documents.enumerate() {
        let bound = Some(CapabilityBound {
            accepted: is_accepted,
            kind: document.kind,
            delegation_depth: (index % (5 + accepted.delegations.len())).checked_sub(5),
        });
        let mut next = Vec::new();
        let mut account_rejected = None;
        for rule in &document.hard.rules {
            if budget.compare().is_err() {
                return capacity();
            }
            if !need.permits_region(rule, now) {
                continue;
            }
            if index == 0 {
                // Every later intersection preserves this exact tuple, so the
                // trusted account predicates remain satisfied. Checking unrelated
                // later alternatives would misattribute a hard-bound failure.
                if let Some((is_accepted, _)) = [true, false]
                    .into_iter()
                    .zip(accounts)
                    .find(|(_, account)| !account.is_some_and(|a| a.permits_key(rule.key())))
                {
                    account_rejected = Some(is_accepted);
                    continue;
                }
                if budget.insert(&mut next, rule.clone(), now).is_err() {
                    return capacity();
                }
            } else {
                for region in &regions {
                    if budget.compare().is_err() {
                        return capacity();
                    }
                    if let Some(common) = intersect_regions(region, rule)
                        && need.permits_region(&common, now)
                        && budget.insert(&mut next, common, now).is_err()
                    {
                        return capacity();
                    }
                }
            }
        }
        if next.is_empty() {
            return CapabilityInspection::refused(
                Status::Forbidden,
                if account_rejected.is_some() {
                    Reason::AccountBoundary
                } else {
                    Reason::HardBounds
                },
                account_rejected
                    .map(|accepted| CapabilityBound {
                        accepted,
                        kind: PolicyKind::Account,
                        delegation_depth: None,
                    })
                    .or(bound),
            );
        }
        regions = next;
    }
    CapabilityInspection {
        status: Status::CompatibleNeedsExactDetails,
        reason: Reason::ExactDetailsRequired,
        refresh_at: regions.iter().map(|r| r.expires_at).min(),
        blocking_bound: None,
    }
}

pub fn evaluate(
    request: &CanonicalOperation,
    current: &AuthoritySnapshot,
    accepted: &AuthoritySnapshot,
    now: i64,
) -> PermissionVerdict {
    if !request.is_valid()
        || request.expires_at <= now
        || authority_pair_failure(current, accepted, now).is_some()
    {
        return PermissionVerdict::Denied;
    }
    for (current, accepted) in current.documents().zip(accepted.documents()) {
        if !current.hard.covers(request, now) || !accepted.hard.covers(request, now) {
            return PermissionVerdict::Denied;
        }
    }
    if !source_matches(current, accepted) {
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
    /// Immutable producer epoch and the exact method binding effective for it.
    pub execution_epoch: u64,
    pub methodology_binding_id: String,
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
