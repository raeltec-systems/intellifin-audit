//! Explicit Admin installation and scoped audit selection are separate ports.
//! Selection is attributable technique metadata; it never accepts authority,
//! creates an operation/decision, resumes a Task or executes a resource.
use std::{collections::BTreeSet, future::Future};

use serde::{Deserialize, Serialize};
use zobba_domain::{
    identity::{Scope, valid_scope_id},
    skills as domain,
};

use crate::methodology::{self, Applicability, AssignmentScope, Binding};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SkillsError {
    Invalid,
    Denied,
    Conflict,
    Capacity,
    Unavailable,
    Ineligible,
}

impl SkillsError {
    pub const fn code(self) -> &'static str {
        match self {
            Self::Invalid => "invalid_skill",
            Self::Denied => "access_denied",
            Self::Conflict => "skill_conflict",
            Self::Capacity => "skill_capacity",
            Self::Unavailable => "skill_unavailable",
            Self::Ineligible => "skill_ineligible",
        }
    }
}

impl std::fmt::Display for SkillsError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.code())
    }
}
impl std::error::Error for SkillsError {}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Source {
    pub reference: String,
    pub revision: String,
    pub license: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Input {
    pub id: String,
    pub label: String,
    pub required: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ToolNeed {
    pub id: String,
    pub tool: String,
    pub account_id: Option<String>,
    pub environment_id: Option<String>,
    pub destination: Option<String>,
    pub resource_id: Option<String>,
    pub recipients: Vec<String>,
    pub attachment_classifications: Vec<String>,
    pub requires_attachments: bool,
}

impl ToolNeed {
    pub fn to_domain(&self) -> Option<domain::ToolNeed> {
        Some(domain::ToolNeed {
            id: self.id.clone(),
            tool: domain::ToolId::parse(&self.tool)?,
            account_id: self.account_id.clone(),
            environment_id: self.environment_id.clone(),
            destination: self.destination.clone(),
            resource_id: self.resource_id.clone(),
            recipients: self.recipients.clone(),
            attachment_classifications: self.attachment_classifications.clone(),
            requires_attachments: self.requires_attachments,
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Resource {
    pub id: String,
    pub kind: String,
    pub content: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    pub schema_version: u16,
    pub id: String,
    pub version: String,
    pub name: String,
    pub description: String,
    pub source: Source,
    pub inputs: Vec<Input>,
    pub outputs: Vec<String>,
    pub needs: Vec<ToolNeed>,
    pub method_version_ids: Vec<String>,
    pub resources: Vec<Resource>,
}

impl Manifest {
    pub fn to_domain(&self) -> Option<domain::Manifest> {
        Some(domain::Manifest {
            schema_version: self.schema_version,
            id: self.id.clone(),
            version: self.version.clone(),
            name: self.name.clone(),
            description: self.description.clone(),
            source: domain::Source {
                reference: self.source.reference.clone(),
                revision: self.source.revision.clone(),
                license: self.source.license.clone(),
            },
            inputs: self
                .inputs
                .iter()
                .map(|input| domain::Input {
                    id: input.id.clone(),
                    label: input.label.clone(),
                    required: input.required,
                })
                .collect(),
            outputs: self.outputs.clone(),
            needs: self
                .needs
                .iter()
                .map(ToolNeed::to_domain)
                .collect::<Option<_>>()?,
            method_version_ids: self.method_version_ids.clone(),
            resources: self
                .resources
                .iter()
                .map(|resource| {
                    Some(domain::Resource {
                        id: resource.id.clone(),
                        kind: domain::ResourceKind::parse(&resource.kind)?,
                        content: resource.content.clone(),
                    })
                })
                .collect::<Option<_>>()?,
        })
    }

    pub fn is_valid(&self) -> bool {
        self.to_domain().is_some_and(|value| value.is_valid())
    }

    pub fn canonical_bytes(&self) -> Option<Vec<u8>> {
        self.to_domain()?.canonical_bytes()
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InstallSkill {
    pub key: String,
    pub expected_revision: u64,
    pub assignment: AssignmentScope,
    pub applicability: Applicability,
    pub manifest: Manifest,
    pub enabled: bool,
}

impl InstallSkill {
    pub fn is_valid(&self) -> bool {
        valid_scope_id(&self.key)
            && self.expected_revision < i64::MAX as u64
            && self.assignment.to_domain().is_valid()
            && self.applicability.to_domain().is_valid()
            && self.manifest.is_valid()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CatalogStatus {
    Enabled,
    Disabled,
    Recalled,
}

impl CatalogStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Enabled => "enabled",
            Self::Disabled => "disabled",
            Self::Recalled => "recalled",
        }
    }

    /// Recall is permanent for an immutable version. A replacement is installed
    /// with a new version; status changes cannot rewrite recalled content.
    pub const fn can_transition_to(self, next: Self) -> bool {
        !matches!(self, Self::Recalled) || matches!(next, Self::Recalled)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChangeSkillStatus {
    pub key: String,
    pub expected_revision: u64,
    pub version_id: String,
    pub status: CatalogStatus,
    pub reason: String,
}

impl ChangeSkillStatus {
    pub fn is_valid(&self) -> bool {
        valid_scope_id(&self.key)
            && self.expected_revision < i64::MAX as u64
            && valid_scope_id(&self.version_id)
            && zobba_domain::methodology::valid_text(&self.reason)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResourceDigest {
    pub id: String,
    pub digest: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SkillVersion {
    pub id: String,
    pub actor_id: String,
    pub installed_at: i64,
    pub revision: u64,
    pub command: InstallSkill,
    pub digest: String,
    pub resource_digests: Vec<ResourceDigest>,
    pub status: CatalogStatus,
    pub status_revision: u64,
    pub status_event: StatusEvent,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CatalogSnapshot {
    pub organisation_id: String,
    pub revision: u64,
    pub versions: Vec<SkillVersion>,
}

pub const CONFIGURATION_PAGE_SIZE: usize = 50;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AssignmentKind {
    Client,
    Engagement,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AssignmentOptionsQuery {
    pub kind: AssignmentKind,
    pub client_id: Option<String>,
    pub after: Option<String>,
}

impl AssignmentOptionsQuery {
    pub fn is_valid(&self) -> bool {
        self.client_id.as_deref().is_none_or(valid_scope_id)
            && self.after.as_deref().is_none_or(valid_scope_id)
            && match self.kind {
                AssignmentKind::Client => self.client_id.is_none(),
                AssignmentKind::Engagement => self.client_id.is_some(),
            }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClientAssignmentOption {
    pub client_id: String,
    pub client_name: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AssignmentPage {
    pub clients: Vec<ClientAssignmentOption>,
    pub engagements: Vec<crate::membership::AssignmentOption>,
    pub next_after: Option<String>,
}

/// Attributable configuration only; install events have no status-change reason.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct StatusEvent {
    pub event_id: String,
    pub actor_id: String,
    pub recorded_at: i64,
    pub revision: u64,
    pub status: CatalogStatus,
    pub reason: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct StatusHistory {
    pub version_id: String,
    pub events: Vec<StatusEvent>,
    pub next_before_revision: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImpactCursor {
    pub task_id: String,
    pub revision: u64,
}

impl ImpactCursor {
    pub fn is_valid(&self) -> bool {
        valid_scope_id(&self.task_id) && (1..=i64::MAX as u64).contains(&self.revision)
    }
}

/// Exact historical references disclosed only within a currently authorised audit.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SelectionImpact {
    pub task_id: String,
    pub selection_id: String,
    pub selector_id: String,
    pub selected_at: i64,
    pub selection_revision: u64,
    pub version_id: String,
    pub skill_id: String,
    pub skill_version: String,
    pub digest: String,
    pub methodology_binding_id: String,
    pub execution_epoch: u64,
    pub catalog_revision: u64,
    pub status: CatalogStatus,
    pub status_revision: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SelectionImpactPage {
    pub organisation_id: String,
    pub client_id: String,
    pub engagement_id: String,
    pub version_id: Option<String>,
    pub selections: Vec<SelectionImpact>,
    pub next_after: Option<ImpactCursor>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CatalogReceipt {
    pub event_id: String,
    pub organisation_id: String,
    pub actor_id: String,
    pub version_id: String,
    pub revision: u64,
    pub status: CatalogStatus,
    pub affected_selections: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EligibilityStatus {
    Eligible,
    Unavailable,
    Forbidden,
    Disabled,
    Recalled,
    Inapplicable,
    MethodologyBlocked,
    TaskBlocked,
}

impl EligibilityStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Eligible => "eligible",
            Self::Unavailable => "unavailable",
            Self::Forbidden => "forbidden",
            Self::Disabled => "disabled",
            Self::Recalled => "recalled",
            Self::Inapplicable => "inapplicable",
            Self::MethodologyBlocked => "methodology_blocked",
            Self::TaskBlocked => "task_blocked",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityStatus {
    Unavailable,
    Forbidden,
    CompatibleNeedsExactDetails,
}

impl From<zobba_domain::permissions::CapabilityStatus> for CapabilityStatus {
    fn from(value: zobba_domain::permissions::CapabilityStatus) -> Self {
        match value {
            zobba_domain::permissions::CapabilityStatus::Unavailable => Self::Unavailable,
            zobba_domain::permissions::CapabilityStatus::Forbidden => Self::Forbidden,
            zobba_domain::permissions::CapabilityStatus::CompatibleNeedsExactDetails => {
                Self::CompatibleNeedsExactDetails
            }
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct NeedInspection {
    pub id: String,
    pub tool: String,
    pub status: CapabilityStatus,
    pub reason: String,
    pub refresh_at: Option<i64>,
    pub blocking_bound: Option<CapabilityBound>,
}

/// Redacted bound provenance: no subject, rule values, grants or credentials.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CapabilityBound {
    pub accepted: bool,
    pub kind: String,
    pub delegation_depth: Option<usize>,
}

impl From<zobba_domain::permissions::CapabilityBound> for CapabilityBound {
    fn from(value: zobba_domain::permissions::CapabilityBound) -> Self {
        Self {
            accepted: value.accepted,
            kind: value.kind.as_str().into(),
            delegation_depth: value.delegation_depth,
        }
    }
}

impl NeedInspection {
    pub fn from_domain(
        need: &ToolNeed,
        inspection: zobba_domain::permissions::CapabilityInspection,
    ) -> Self {
        Self {
            id: need.id.clone(),
            tool: need.tool.clone(),
            status: inspection.status.into(),
            reason: inspection.reason.as_str().into(),
            refresh_at: inspection.refresh_at,
            blocking_bound: inspection.blocking_bound.map(Into::into),
        }
    }
}

/// A momentary compatibility observation. Its digest and fingerprint identify
/// dependencies for explanation and retries; neither is a bearer capability.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Inspection {
    pub version_id: String,
    pub skill_id: String,
    pub skill_version: String,
    pub digest: String,
    pub catalog_revision: u64,
    pub methodology_binding_id: String,
    /// Current Task epoch, which can exceed the method's effective-from epoch.
    pub execution_epoch: u64,
    /// Task's accepted authority actor, independently of viewer/selector.
    pub authority_actor_id: Option<String>,
    pub status: EligibilityStatus,
    pub reason: String,
    pub needs: Vec<NeedInspection>,
    pub observed_at: i64,
    pub dependency_fingerprint: String,
}

impl Inspection {
    pub fn selectable(&self) -> bool {
        self.status == EligibilityStatus::Eligible
            && self
                .needs
                .iter()
                .all(|need| need.status == CapabilityStatus::CompatibleNeedsExactDetails)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SelectSkill {
    pub key: String,
    pub version_id: String,
    pub reason: String,
    pub expected_catalog_revision: u64,
    pub expected_methodology_binding_id: String,
    pub expected_execution_epoch: u64,
    pub expected_selection_revision: u64,
}

impl SelectSkill {
    pub fn is_valid(&self) -> bool {
        valid_scope_id(&self.key)
            && valid_scope_id(&self.version_id)
            && valid_scope_id(&self.expected_methodology_binding_id)
            && zobba_domain::methodology::valid_text(&self.reason)
            && self.expected_catalog_revision <= i64::MAX as u64
            && self.expected_execution_epoch <= i64::MAX as u64
            && self.expected_selection_revision < i64::MAX as u64
    }
}

/// Immutable historical choice, including exact requirement/field/template
/// provenance through its complete binding. No field asserts execution.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Selection {
    pub id: String,
    pub task_id: String,
    pub selector_id: String,
    pub authority_actor_id: Option<String>,
    pub selected_at: i64,
    pub revision: u64,
    pub version_id: String,
    pub skill_id: String,
    pub skill_version: String,
    pub digest: String,
    pub reason: String,
    pub methodology: Binding,
    pub execution_epoch: u64,
    pub catalog_revision: u64,
    pub dependency_fingerprint: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SelectionView {
    pub selection: Selection,
    pub current: Inspection,
}

/// Replay retains the exact original selection, accompanied by freshly checked
/// current eligibility. The receipt is never permission for another use.
pub type SelectionReceipt = SelectionView;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Candidate {
    pub version: SkillVersion,
    pub inspection: Inspection,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Discovery {
    pub task_id: String,
    pub catalog_revision: u64,
    pub selection_revision: u64,
    pub methodology_binding_id: String,
    pub execution_epoch: u64,
    pub candidates: Vec<Candidate>,
    pub selections: Vec<SelectionView>,
    pub observed_at: i64,
}

/// Include sources outside the assignment-candidate list, including original
/// historical template sources. They remain dependencies, never a substitute
/// for identifying the Task's current whole methodology.
pub fn methodology_dependencies(binding: &Binding) -> Vec<String> {
    let mut dependencies = BTreeSet::new();
    dependencies.extend(binding.resolution.version_ids.iter().cloned());
    for requirement in &binding.resolution.requirements {
        dependencies.extend(requirement.source_version_ids.iter().cloned());
        for source in &requirement.field_sources {
            dependencies.extend(source.version_ids.iter().cloned());
        }
    }
    for template in &binding.resolution.templates {
        dependencies.insert(template.source_version_id.clone());
    }
    dependencies.into_iter().collect()
}

pub fn method_compatibility(
    manifest: &Manifest,
    applicability: &Applicability,
    binding: &Binding,
) -> domain::MethodCompatibility {
    let Some(manifest) = manifest.to_domain() else {
        return domain::MethodCompatibility::Unavailable;
    };
    let status = match binding.resolution.status {
        methodology::ResolutionStatus::Resolved => {
            zobba_domain::methodology::ResolutionStatus::Resolved
        }
        methodology::ResolutionStatus::Neutral => {
            zobba_domain::methodology::ResolutionStatus::Neutral
        }
        methodology::ResolutionStatus::Incomplete => {
            zobba_domain::methodology::ResolutionStatus::Incomplete
        }
        methodology::ResolutionStatus::Ambiguous => {
            zobba_domain::methodology::ResolutionStatus::Ambiguous
        }
        methodology::ResolutionStatus::Recalled => {
            zobba_domain::methodology::ResolutionStatus::Recalled
        }
    };
    domain::method_compatibility(
        &manifest,
        &applicability.to_domain(),
        &binding.resolution.context.to_domain(),
        status,
        &binding.resolution.version_ids,
    )
}

pub trait SkillsStore: Send + Sync {
    /// Current Admin configuration only. Never reveals audit Task context.
    fn catalog(
        &self,
        actor: &str,
        organisation: &str,
    ) -> impl Future<Output = Result<CatalogSnapshot, SkillsError>> + Send;

    /// Independently paginated Admin configuration choices; catalog restriction
    /// controls never depend on the number of clients or engagements.
    fn assignment_options(
        &self,
        actor: &str,
        organisation: &str,
        query: &AssignmentOptionsQuery,
    ) -> impl Future<Output = Result<AssignmentPage, SkillsError>> + Send;

    /// Bounded immutable configuration events, freshly authorised as Admin.
    fn status_history(
        &self,
        actor: &str,
        organisation: &str,
        version: &str,
        before_revision: Option<u64>,
    ) -> impl Future<Output = Result<StatusHistory, SkillsError>> + Send;

    /// Scope-filter before disclosure. With no version filter, locate selections
    /// of currently disabled/recalled versions in this authorised engagement.
    fn selection_impact(
        &self,
        actor: &str,
        scope: &Scope,
        version: Option<&str>,
        after: Option<&ImpactCursor>,
    ) -> impl Future<Output = Result<SelectionImpactPage, SkillsError>> + Send;

    /// Explicit attributable installation. Validate complete bounded resources,
    /// hash exact content and preserve immutable (skill id, version) meaning.
    /// Same actor/key/exact command replays after fresh current authority checks.
    fn install(
        &self,
        actor: &str,
        organisation: &str,
        command: &InstallSkill,
    ) -> impl Future<Output = Result<CatalogReceipt, SkillsError>> + Send;

    /// Disable/recall remain available at capacity. Recall identifies affected
    /// selections; both retain immutable history and consumed operation receipts.
    fn set_status(
        &self,
        actor: &str,
        organisation: &str,
        command: &ChangeSkillStatus,
    ) -> impl Future<Output = Result<CatalogReceipt, SkillsError>> + Send;

    /// Requires exact current audit access. Inspect the Task's accepted actor,
    /// never the viewer's substitute authority. No operation, decision or wakeup.
    fn discover(
        &self,
        actor: &str,
        scope: &Scope,
        task: &str,
    ) -> impl Future<Output = Result<Discovery, SkillsError>> + Send;

    /// One short transaction uses organisation → engagement → Task locks, exact
    /// current session, immutable manifest/status, method and accepted/current
    /// Permissions. Recheck time-sensitive authority after staged writes. An
    /// exact retry returns original history plus current blocked eligibility.
    fn select(
        &self,
        actor: &str,
        scope: &Scope,
        task: &str,
        command: &SelectSkill,
    ) -> impl Future<Output = Result<SelectionReceipt, SkillsError>> + Send;

    /// Independently re-evaluates saved selection, current catalog, method/epoch,
    /// Task state and accepted/current authority before *each* proposed new use.
    /// Ok means an inspection was obtained; consumers must require selectable().
    /// Even eligible inspection does not admit any exact operation or dispatch.
    /// A future invocation must independently pass unchanged exact-operation
    /// admission/decision/consumption gates. Already consumed receipt recovery
    /// does not call this gate and keeps its original custody.
    fn current_use(
        &self,
        actor: &str,
        scope: &Scope,
        task: &str,
        selection: &str,
    ) -> impl Future<Output = Result<SelectionView, SkillsError>> + Send;
}
