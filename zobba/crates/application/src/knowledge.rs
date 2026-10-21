//! Attributable working context. Retrieval and exact receipt recovery always
//! require fresh source, destination, viewer and accountable-Task authority.
use serde::{Deserialize, Serialize};
use std::future::Future;
use zobba_domain::identity::{Scope, valid_scope_id};

pub const KNOWLEDGE_PAGE_SIZE: usize = 50;
pub const MAX_KNOWLEDGE_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_EXCERPT_BYTES: usize = 16 * 1024;
pub const MAX_DEPENDENCIES: usize = 32;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum KnowledgeError {
    Invalid,
    Denied,
    Conflict,
    Capacity,
    Unavailable,
    Ineligible,
    Cycle,
}
impl KnowledgeError {
    pub const fn code(self) -> &'static str {
        match self {
            Self::Invalid => "invalid_knowledge",
            Self::Denied => "access_denied",
            Self::Conflict => "knowledge_conflict",
            Self::Capacity => "knowledge_capacity",
            Self::Unavailable => "knowledge_unavailable",
            Self::Ineligible => "knowledge_ineligible",
            Self::Cycle => "knowledge_dependency_cycle",
        }
    }
}
impl std::fmt::Display for KnowledgeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.code())
    }
}
impl std::error::Error for KnowledgeError {}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScopeKind {
    Personal,
    Firm,
    Client,
    Engagement,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KnowledgeScope {
    pub kind: ScopeKind,
    pub organisation_id: String,
    pub client_id: Option<String>,
    pub engagement_id: Option<String>,
    pub owner_id: Option<String>,
}
impl KnowledgeScope {
    pub fn engagement(scope: &Scope) -> Self {
        Self {
            kind: ScopeKind::Engagement,
            organisation_id: scope.organisation_id.clone(),
            client_id: Some(scope.client_id.clone()),
            engagement_id: Some(scope.engagement_id.clone()),
            owner_id: None,
        }
    }
    pub fn personal(organisation: &str, actor: &str) -> Self {
        Self {
            kind: ScopeKind::Personal,
            organisation_id: organisation.into(),
            client_id: None,
            engagement_id: None,
            owner_id: Some(actor.into()),
        }
    }
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Period {
    pub start: Option<String>,
    pub end: Option<String>,
}
impl Period {
    pub fn is_valid(&self) -> bool {
        self.to_domain().is_valid()
    }
    pub fn to_domain(&self) -> zobba_domain::knowledge::Period {
        zobba_domain::knowledge::Period {
            start: self.start.clone(),
            end: self.end.clone(),
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KnowledgeKind {
    Decision,
    Observation,
    Assertion,
    Preference,
    PublishedPreference,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Certainty {
    UserDirected,
    SourceStates,
    Asserted,
    Learned,
    ExplicitPreference,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RecordStatus {
    Current,
    Corrected,
    Excluded,
    Forgotten,
    Invalidated,
    Withdrawn,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecordReference {
    pub id: String,
    pub revision: u64,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Dependency {
    Evidence {
        evidence_id: String,
        storage_version: String,
        digest: String,
        scope: KnowledgeScope,
    },
    Guide {
        command_id: String,
        task_id: String,
        cycle_id: String,
        scope: KnowledgeScope,
    },
    Knowledge {
        id: String,
        revision: u64,
        scope: KnowledgeScope,
    },
    Methodology {
        version_id: String,
    },
    Skill {
        selection_id: String,
        task_id: String,
    },
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SourceLocation {
    pub evidence_id: String,
    pub storage_version: String,
    pub digest: String,
    pub byte_start: u64,
    pub byte_end: u64,
    pub original_size: u64,
    pub partial: bool,
    pub field_path: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DirectionBasis {
    pub command_id: String,
    pub task_id: String,
    pub cycle_id: String,
    pub standing: String,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InspectionLayout {
    Standard,
    Expanded,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PreferenceBasis {
    pub name: String,
    pub value: InspectionLayout,
    pub inferred: bool,
    pub rule: Option<String>,
    pub observation_ids: Vec<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct KnowledgeRecord {
    pub id: String,
    pub revision: u64,
    pub actor_id: String,
    pub recorded_at: i64,
    pub scope: KnowledgeScope,
    pub kind: KnowledgeKind,
    pub text: String,
    pub period: Period,
    pub certainty: Certainty,
    pub uncertainty: Option<String>,
    pub dependencies: Vec<Dependency>,
    pub source: Option<SourceLocation>,
    pub direction: Option<DirectionBasis>,
    pub preference: Option<PreferenceBasis>,
    pub supersedes: Option<RecordReference>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct KnowledgeView {
    pub record: KnowledgeRecord,
    pub status: RecordStatus,
    pub status_reason: Option<String>,
    pub can_correct: bool,
    pub can_exclude: bool,
    pub can_forget: bool,
    pub can_reuse: bool,
    pub can_undo: bool,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Omission {
    UnsupportedFormat,
    UnknownPeriod,
    OutsidePeriod,
    InvalidatedSupport,
    CaptureCapacity,
    LegacyNotCaptured,
    PartialSource,
    BoundedPage,
    ScanLimit,
    UnavailableSupport,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KnowledgeQuery {
    pub after: Option<String>,
    pub text: Option<String>,
    pub include_inactive: bool,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct KnowledgePage {
    pub task_id: String,
    pub revision: u64,
    pub execution_epoch: u64,
    pub methodology_binding_id: String,
    pub items: Vec<KnowledgeView>,
    pub next_after: Option<String>,
    pub omissions: Vec<Omission>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Assertion {
    pub text: String,
    pub period: Period,
    pub uncertainty: Option<String>,
    pub dependencies: Vec<Dependency>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum KnowledgeAction {
    Assert {
        assertion: Assertion,
    },
    Correct {
        target: RecordReference,
        assertion: Assertion,
        reason: String,
    },
    Exclude {
        target: RecordReference,
        reason: String,
    },
    Forget {
        target: RecordReference,
        reason: String,
    },
    Reuse {
        target: RecordReference,
        destination_engagement_id: String,
        destination_task_id: String,
        reason: String,
    },
    CorrectSource {
        predecessor_id: String,
        replacement_id: String,
        expected_source_revision: u64,
        reason: String,
    },
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KnowledgeCommand {
    pub key: String,
    pub expected_revision: u64,
    pub action: KnowledgeAction,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct KnowledgeReceipt {
    pub event_id: String,
    pub revision: u64,
    pub record: Option<KnowledgeView>,
    pub affected_ids: Vec<String>,
    pub affected_destinations: Vec<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ObserveLayout {
    pub key: String,
    pub expected_revision: u64,
    pub opening_id: String,
    pub value: InspectionLayout,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum PreferenceAction {
    Save {
        value: InspectionLayout,
    },
    Undo {
        target: RecordReference,
    },
    Publish {
        target: RecordReference,
        client_id: String,
        engagement_id: String,
    },
    Withdraw {
        publication_id: String,
    },
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PreferenceCommand {
    pub key: String,
    pub expected_revision: u64,
    pub action: PreferenceAction,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PreferenceSnapshot {
    pub organisation_id: String,
    pub owner_id: String,
    pub revision: u64,
    pub current: Option<KnowledgeView>,
    pub publications: Vec<KnowledgeView>,
    pub consumed_through: u64,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CaptureExcerpt {
    pub key: String,
    pub evidence_id: String,
    pub byte_start: u64,
    pub byte_end: u64,
}
/// Internal trusted projection, built only from independently verified originals.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CapturedExcerpt {
    pub text: String,
    pub byte_start: u64,
    pub byte_end: u64,
    pub original_size: u64,
    pub partial: bool,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CapturedAssertion {
    pub field_path: String,
    pub text: String,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EvidenceCapture {
    pub excerpt: Option<CapturedExcerpt>,
    pub assertions: Vec<CapturedAssertion>,
    pub omission: Option<Omission>,
}

/// Fresh source-correction and capture standing. The original remains immutable;
/// revisions identify the exact current mutation basis, never cached access.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SourceStatus {
    pub correction_actor_id: Option<String>,
    pub correction_recorded_at: Option<i64>,
    pub correction_reason: Option<String>,
    pub evidence_id: String,
    pub source_revision: u64,
    pub replacement_id: Option<String>,
    pub capture_revision: u64,
    pub omissions: Vec<Omission>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VerificationItem {
    pub id: String,
    pub revision: u64,
    pub status: RecordStatus,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VerifyKnowledge {
    pub expected_execution_epoch: u64,
    pub expected_methodology_binding_id: String,
    pub items: Vec<VerificationItem>,
    pub exact: bool,
    pub include_inactive: bool,
}

pub trait KnowledgeStore: Send + Sync {
    /// One transaction verifies exact references/status and the Task basis together.
    /// A success is a current disclosure observation, never a cached use grant.
    fn verify(
        &self,
        actor: &str,
        scope: &Scope,
        task: &str,
        command: &VerifyKnowledge,
    ) -> impl Future<Output = Result<(), KnowledgeError>> + Send;

    fn source_status(
        &self,
        actor: &str,
        scope: &Scope,
        evidence_id: &str,
    ) -> impl Future<Output = Result<SourceStatus, KnowledgeError>> + Send;

    /// Page at most 50 after a stable ASCII/C-collated ID. Filter every source,
    /// current correction, viewer and Task consumer before ranking or counting.
    fn inspect(
        &self,
        actor: &str,
        scope: &Scope,
        task: &str,
        query: &KnowledgeQuery,
    ) -> impl Future<Output = Result<KnowledgePage, KnowledgeError>> + Send;
    /// Exact lookup remains usable beyond page/candidate bounds.
    fn exact(
        &self,
        actor: &str,
        scope: &Scope,
        task: &str,
        id: &str,
        revision: u64,
    ) -> impl Future<Output = Result<KnowledgeView, KnowledgeError>> + Send;
    fn mutate(
        &self,
        actor: &str,
        scope: &Scope,
        task: &str,
        command: &KnowledgeCommand,
    ) -> impl Future<Output = Result<KnowledgeReceipt, KnowledgeError>> + Send;
    fn preference(
        &self,
        actor: &str,
        organisation: &str,
    ) -> impl Future<Output = Result<PreferenceSnapshot, KnowledgeError>> + Send;
    fn observe_layout(
        &self,
        actor: &str,
        organisation: &str,
        command: &ObserveLayout,
    ) -> impl Future<Output = Result<PreferenceSnapshot, KnowledgeError>> + Send;
    fn mutate_preference(
        &self,
        actor: &str,
        organisation: &str,
        command: &PreferenceCommand,
    ) -> impl Future<Output = Result<KnowledgeReceipt, KnowledgeError>> + Send;
    /// Called after object I/O. Reauthorize source/session and validate exact
    /// registered version/digest and current correction state in this transaction.
    fn record_excerpt(
        &self,
        actor: &str,
        scope: &Scope,
        command: &CaptureExcerpt,
        evidence: &zobba_domain::evidence::RegisteredEvidence,
        excerpt: &CapturedExcerpt,
    ) -> impl Future<Output = Result<KnowledgeReceipt, KnowledgeError>> + Send;
    /// Exact automatic-capture repair, including source assertions and omissions.
    /// Capture capacity never requires uploading or modifying the original again.
    fn recover_capture(
        &self,
        actor: &str,
        scope: &Scope,
        key: &str,
        evidence: &zobba_domain::evidence::RegisteredEvidence,
        capture: &EvidenceCapture,
    ) -> impl Future<Output = Result<KnowledgeReceipt, KnowledgeError>> + Send;
}

impl KnowledgeQuery {
    pub fn is_valid(&self) -> bool {
        self.after.as_deref().is_none_or(valid_scope_id)
            && self.text.as_ref().is_none_or(|text| {
                text.chars().count() <= 200 && !text.chars().any(char::is_control)
            })
    }
}

impl KnowledgeScope {
    pub fn is_valid(&self) -> bool {
        valid_scope_id(&self.organisation_id)
            && self.client_id.as_deref().is_none_or(valid_scope_id)
            && self.engagement_id.as_deref().is_none_or(valid_scope_id)
            && self.owner_id.as_deref().is_none_or(valid_scope_id)
            && match self.kind {
                ScopeKind::Personal => {
                    self.owner_id.is_some()
                        && self.client_id.is_none()
                        && self.engagement_id.is_none()
                }
                ScopeKind::Firm => {
                    self.owner_id.is_none()
                        && self.client_id.is_none()
                        && self.engagement_id.is_none()
                }
                ScopeKind::Client => {
                    self.owner_id.is_none()
                        && self.client_id.is_some()
                        && self.engagement_id.is_none()
                }
                ScopeKind::Engagement => {
                    self.owner_id.is_none()
                        && self.client_id.is_some()
                        && self.engagement_id.is_some()
                }
            }
    }
    pub fn to_engagement(&self) -> Option<Scope> {
        if !self.is_valid() || self.kind != ScopeKind::Engagement {
            return None;
        }
        Some(Scope {
            organisation_id: self.organisation_id.clone(),
            client_id: self.client_id.clone()?,
            engagement_id: self.engagement_id.clone()?,
        })
    }
}
fn valid_revision(revision: u64) -> bool {
    revision > 0 && revision <= i64::MAX as u64
}
fn valid_expected_revision(revision: u64) -> bool {
    revision < i64::MAX as u64
}
pub fn valid_storage_version(version: &str) -> bool {
    !version.is_empty()
        && version != "null"
        && version.len() <= 512
        && !version.chars().any(char::is_control)
}
pub fn valid_digest(digest: &str) -> bool {
    digest.len() == 64
        && digest
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}
impl RecordReference {
    pub fn is_valid(&self) -> bool {
        valid_scope_id(&self.id) && valid_revision(self.revision)
    }
}
impl Dependency {
    pub fn is_valid(&self) -> bool {
        match self {
            Self::Evidence {
                evidence_id,
                storage_version,
                digest,
                scope,
            } => {
                valid_scope_id(evidence_id)
                    && valid_storage_version(storage_version)
                    && valid_digest(digest)
                    && scope.is_valid()
                    && scope.kind == ScopeKind::Engagement
            }
            Self::Guide {
                command_id,
                task_id,
                cycle_id,
                scope,
            } => {
                [command_id, task_id, cycle_id]
                    .into_iter()
                    .all(|id| valid_scope_id(id))
                    && scope.is_valid()
                    && scope.kind == ScopeKind::Engagement
            }
            Self::Knowledge {
                id,
                revision,
                scope,
            } => valid_scope_id(id) && valid_revision(*revision) && scope.is_valid(),
            Self::Methodology { version_id } => valid_scope_id(version_id),
            Self::Skill {
                selection_id,
                task_id,
            } => valid_scope_id(selection_id) && valid_scope_id(task_id),
        }
    }
}
impl Assertion {
    pub fn is_valid(&self) -> bool {
        zobba_domain::knowledge::valid_text(&self.text)
            && self.period.is_valid()
            && self
                .uncertainty
                .as_deref()
                .is_none_or(zobba_domain::methodology::valid_text)
            && self.dependencies.len() <= MAX_DEPENDENCIES
            && self.dependencies.iter().all(Dependency::is_valid)
            && self
                .dependencies
                .iter()
                .enumerate()
                .all(|(index, dependency)| !self.dependencies[..index].contains(dependency))
    }
}
impl KnowledgeCommand {
    pub fn is_valid(&self) -> bool {
        valid_scope_id(&self.key)
            && valid_expected_revision(self.expected_revision)
            && match &self.action {
                KnowledgeAction::Assert { assertion } => assertion.is_valid(),
                KnowledgeAction::Correct {
                    target,
                    assertion,
                    reason,
                } => {
                    target.is_valid()
                        && assertion.is_valid()
                        && zobba_domain::methodology::valid_text(reason)
                }
                KnowledgeAction::Exclude { target, reason }
                | KnowledgeAction::Forget { target, reason } => {
                    target.is_valid() && zobba_domain::methodology::valid_text(reason)
                }
                KnowledgeAction::Reuse {
                    target,
                    destination_engagement_id,
                    destination_task_id,
                    reason,
                } => {
                    target.is_valid()
                        && valid_scope_id(destination_engagement_id)
                        && valid_scope_id(destination_task_id)
                        && zobba_domain::methodology::valid_text(reason)
                }
                KnowledgeAction::CorrectSource {
                    predecessor_id,
                    replacement_id,
                    expected_source_revision,
                    reason,
                } => {
                    valid_scope_id(predecessor_id)
                        && valid_scope_id(replacement_id)
                        && predecessor_id != replacement_id
                        && valid_expected_revision(*expected_source_revision)
                        && zobba_domain::methodology::valid_text(reason)
                }
            }
    }
}
impl ObserveLayout {
    pub fn is_valid(&self) -> bool {
        valid_scope_id(&self.key)
            && valid_expected_revision(self.expected_revision)
            && valid_scope_id(&self.opening_id)
    }
}
impl PreferenceCommand {
    pub fn is_valid(&self) -> bool {
        valid_scope_id(&self.key)
            && valid_expected_revision(self.expected_revision)
            && match &self.action {
                PreferenceAction::Save { .. } => true,
                PreferenceAction::Undo { target } => target.is_valid(),
                PreferenceAction::Publish {
                    target,
                    client_id,
                    engagement_id,
                } => {
                    target.is_valid() && valid_scope_id(client_id) && valid_scope_id(engagement_id)
                }
                PreferenceAction::Withdraw { publication_id } => valid_scope_id(publication_id),
            }
    }
}
impl CaptureExcerpt {
    pub fn is_valid(&self) -> bool {
        valid_scope_id(&self.key)
            && valid_scope_id(&self.evidence_id)
            && self.byte_start < self.byte_end
            && self.byte_end <= zobba_domain::evidence::MAX_ORIGINAL_BYTES as u64
            && self.byte_end - self.byte_start <= MAX_EXCERPT_BYTES as u64
    }
}
impl InspectionLayout {
    pub const fn to_domain(self) -> zobba_domain::knowledge::InspectionLayout {
        match self {
            Self::Standard => zobba_domain::knowledge::InspectionLayout::Standard,
            Self::Expanded => zobba_domain::knowledge::InspectionLayout::Expanded,
        }
    }
}
impl From<zobba_domain::knowledge::InspectionLayout> for InspectionLayout {
    fn from(value: zobba_domain::knowledge::InspectionLayout) -> Self {
        match value {
            zobba_domain::knowledge::InspectionLayout::Standard => Self::Standard,
            zobba_domain::knowledge::InspectionLayout::Expanded => Self::Expanded,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn scope_and_mutation_validation_do_not_create_generic_publication() {
        let personal = KnowledgeScope::personal("org", "owner");
        assert!(personal.is_valid());
        assert!(
            !KnowledgeScope {
                kind: ScopeKind::Firm,
                ..personal
            }
            .is_valid()
        );
        let command = KnowledgeCommand {
            key: "assert".into(),
            expected_revision: 0,
            action: KnowledgeAction::Assert {
                assertion: Assertion {
                    text: "\u{feff}asserted\r\ntext".into(),
                    period: Period::default(),
                    uncertainty: None,
                    dependencies: vec![],
                },
            },
        };
        assert!(command.is_valid());
        assert!(
            !KnowledgeCommand {
                expected_revision: u64::MAX,
                ..command
            }
            .is_valid()
        );
        assert!(
            !CaptureExcerpt {
                key: "excerpt".into(),
                evidence_id: "evidence".into(),
                byte_start: u64::MAX,
                byte_end: 4
            }
            .is_valid()
        );
    }
    #[test]
    fn partial_periods_and_forged_evidence_identity_are_rejected() {
        assert!(
            !Period {
                start: Some("2026-01-01".into()),
                end: None
            }
            .is_valid()
        );
        assert!(
            !Period {
                start: Some("2026-02-30".into()),
                end: Some("2026-12-31".into())
            }
            .is_valid()
        );
        assert!(
            !Dependency::Evidence {
                evidence_id: "e".into(),
                storage_version: "null".into(),
                digest: "a".repeat(64),
                scope: KnowledgeScope::engagement(&Scope {
                    organisation_id: "o".into(),
                    client_id: "c".into(),
                    engagement_id: "e".into()
                })
            }
            .is_valid()
        );
    }
}
