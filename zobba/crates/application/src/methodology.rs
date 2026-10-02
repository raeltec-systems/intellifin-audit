//! Current-authority methodology configuration and Task binding ports. Immutable
//! configuration is administrative metadata; inspecting Task basis requires audit access.
use std::future::Future;

use serde::{Deserialize, Serialize};
use zobba_domain::{
    identity::{Scope, valid_scope_id},
    methodology as domain,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MethodologyError {
    Invalid,
    Denied,
    Conflict,
    Capacity,
    Unavailable,
    Recalled,
}

impl MethodologyError {
    pub const fn code(self) -> &'static str {
        match self {
            Self::Invalid => "invalid_methodology",
            Self::Denied => "access_denied",
            Self::Conflict => "methodology_conflict",
            Self::Capacity => "methodology_capacity",
            Self::Unavailable => "methodology_unavailable",
            Self::Recalled => "methodology_recalled",
        }
    }
}

impl std::fmt::Display for MethodologyError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.code())
    }
}
impl std::error::Error for MethodologyError {}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AssignmentKind {
    Firm,
    Client,
    Engagement,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AssignmentScope {
    pub kind: AssignmentKind,
    pub client_id: Option<String>,
    pub engagement_id: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TaskContext {
    pub audit_area: Option<String>,
    pub period_start: Option<String>,
    pub period_end: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Applicability {
    pub audit_area: Option<String>,
    pub period_start: Option<String>,
    pub period_end: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VersionReference {
    pub id: String,
    pub version: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Requirement {
    pub id: String,
    pub label: Option<String>,
    pub mandatory: bool,
    pub criteria: Option<Vec<String>>,
    pub populations: Option<Vec<String>>,
    pub evidence_checks: Option<Vec<String>>,
    pub ratings: Option<Vec<String>>,
    pub templates: Option<Vec<VersionReference>>,
    pub review_rules: Option<Vec<String>>,
    pub suitable_skills: Option<Vec<VersionReference>>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Definition {
    pub name: String,
    pub neutral_starter: bool,
    #[serde(default)]
    pub default_context: TaskContext,
    #[serde(default)]
    pub templates: Vec<TemplateDefinition>,
    pub requirements: Vec<Requirement>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TemplateSection {
    pub id: String,
    pub title: String,
    pub content: String,
    pub required: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TemplateDefinition {
    pub id: String,
    pub version: String,
    pub name: String,
    pub sections: Vec<TemplateSection>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActivationMode {
    NewTasks,
    ActiveTasks,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Activation {
    pub mode: ActivationMode,
    pub available_at: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SourceAttribution {
    pub kind: String,
    pub reference: Option<String>,
    pub note: Option<String>,
}

impl SourceAttribution {
    pub fn is_valid(&self) -> bool {
        matches!(
            self.kind.as_str(),
            "authored" | "imported_proposal" | "neutral_starter"
        ) && self.reference.as_deref().is_none_or(domain::valid_text)
            && self.note.as_deref().is_none_or(domain::valid_text)
            && (self.kind != "imported_proposal" || self.reference.is_some())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SaveMethodology {
    pub key: String,
    pub expected_revision: u64,
    pub supersedes: Option<String>,
    pub undo_of: Option<String>,
    pub assignment: AssignmentScope,
    pub applicability: Applicability,
    pub activation: Activation,
    pub definition: Definition,
    pub source: SourceAttribution,
}

impl SaveMethodology {
    pub fn is_valid(&self) -> bool {
        valid_scope_id(&self.key)
            && self.expected_revision < i64::MAX as u64
            && self.supersedes.as_deref().is_none_or(valid_scope_id)
            && self.undo_of.as_deref().is_none_or(valid_scope_id)
            && (self.undo_of.is_none() || self.supersedes.is_some())
            && self.assignment.to_domain().is_valid()
            && self.applicability.to_domain().is_valid()
            && (0..=domain::MAX_TIMESTAMP).contains(&self.activation.available_at)
            && self.definition.to_domain().is_valid()
            && self.source.is_valid()
            && (self.source.kind != "neutral_starter" || self.definition.neutral_starter)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecallMethodology {
    pub key: String,
    pub expected_revision: u64,
    pub version_id: String,
    pub reason: String,
}

impl RecallMethodology {
    pub fn is_valid(&self) -> bool {
        valid_scope_id(&self.key)
            && self.expected_revision < i64::MAX as u64
            && valid_scope_id(&self.version_id)
            && domain::valid_text(&self.reason)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct VersionRecord {
    pub id: String,
    pub actor_id: String,
    pub saved_at: i64,
    pub revision: u64,
    pub command: SaveMethodology,
    pub recalled: bool,
}

impl VersionRecord {
    pub fn candidate(&self) -> domain::Candidate {
        domain::Candidate {
            version_id: self.id.clone(),
            assignment: self.command.assignment.to_domain(),
            applicability: self.command.applicability.to_domain(),
            available_at: self.command.activation.available_at,
            recalled: self.recalled,
            definition: self.command.definition.to_domain(),
        }
    }

    pub fn template_source(&self) -> domain::TemplateSource {
        domain::TemplateSource {
            version_id: self.id.clone(),
            revision: self.revision,
            assignment: self.command.assignment.to_domain(),
            available_at: self.command.activation.available_at,
            recalled: self.recalled,
            neutral_starter: self.command.definition.neutral_starter,
            templates: self
                .command
                .definition
                .templates
                .iter()
                .map(TemplateDefinition::to_domain)
                .collect(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Impact {
    pub id: String,
    pub version_id: String,
    pub activation_mode: ActivationMode,
    pub affected_tasks: u64,
    pub pending_tasks: u64,
    pub retained_tasks: u64,
    pub potentially_material: bool,
    pub diff: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Snapshot {
    pub organisation_id: String,
    pub revision: u64,
    pub versions: Vec<VersionRecord>,
    pub impacts: Vec<Impact>,
    pub engagements: Vec<crate::membership::AssignmentOption>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Receipt {
    pub event_id: String,
    pub organisation_id: String,
    pub actor_id: String,
    pub version_id: String,
    pub revision: u64,
    pub kind: String,
    pub impact: Impact,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResolutionStatus {
    Resolved,
    Neutral,
    Incomplete,
    Ambiguous,
    Recalled,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ResolvedRequirement {
    pub requirement: Requirement,
    pub source_version_ids: Vec<String>,
    pub field_sources: Vec<FieldSource>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct FieldSource {
    pub field: String,
    pub version_ids: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ResolvedTemplate {
    pub template: TemplateDefinition,
    pub source_version_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Resolution {
    pub status: ResolutionStatus,
    pub context: TaskContext,
    pub version_ids: Vec<String>,
    pub requirements: Vec<ResolvedRequirement>,
    pub templates: Vec<ResolvedTemplate>,
    #[serde(default)]
    pub neutral_source_version_ids: Vec<String>,
    pub issues: Vec<String>,
    pub reason: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Binding {
    pub id: String,
    /// Immutable eligible pool, including policies outside or unresolved for
    /// this binding's context. Subsequent context discovery reuses this pool.
    pub candidate_version_ids: Vec<String>,
    /// Exact attributed Guide that supplied this context, retained thereafter.
    /// Initial Create and legacy neutral bindings have no context Guide.
    pub context_command_id: Option<String>,
    /// First Task execution epoch governed by this immutable binding.
    pub execution_epoch: u64,
    pub bound_at: i64,
    pub actor_id: String,
    pub resolution: Resolution,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BindingChange {
    pub id: String,
    pub actor_id: String,
    pub requested_at: i64,
    pub resolution: Resolution,
    pub reason: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaskBasis {
    pub task_id: String,
    pub current: Binding,
    pub pending: Option<BindingChange>,
    pub history: Vec<Binding>,
    pub recalled: bool,
    pub notices: Vec<BindingNotice>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BindingNotice {
    pub id: String,
    pub version_id: String,
    pub actor_id: String,
    pub requested_at: i64,
    pub impact: Impact,
}

pub trait MethodologyStore: Send + Sync {
    /// Current Admin only. Assignment options expose configuration metadata,
    /// never client work. Snapshot and commands recheck the exact live session.
    fn snapshot(
        &self,
        actor: &str,
        organisation: &str,
    ) -> impl Future<Output = Result<Snapshot, MethodologyError>> + Send;

    /// Atomically checks org revision, stores the immutable version, assignment,
    /// source/diff and impact, and stages active-work changes when requested.
    /// Exact command retries return their receipt; changed meaning conflicts.
    fn save(
        &self,
        actor: &str,
        organisation: &str,
        command: &SaveMethodology,
    ) -> impl Future<Output = Result<Receipt, MethodologyError>> + Send;

    /// Recall fences affected new use, while consumed effects retain receipt
    /// custody and their original binding until reconciliation.
    fn recall(
        &self,
        actor: &str,
        organisation: &str,
        command: &RecallMethodology,
    ) -> impl Future<Output = Result<Receipt, MethodologyError>> + Send;

    /// Requires current audit access to this exact Task scope. Admin alone does
    /// not permit disclosure of Task context, pending changes or history.
    fn task_basis(
        &self,
        actor: &str,
        scope: &Scope,
        task: &str,
    ) -> impl Future<Output = Result<TaskBasis, MethodologyError>> + Send;
}

impl AssignmentScope {
    pub fn to_domain(&self) -> domain::AssignmentScope {
        domain::AssignmentScope {
            kind: match self.kind {
                AssignmentKind::Firm => domain::AssignmentKind::Firm,
                AssignmentKind::Client => domain::AssignmentKind::Client,
                AssignmentKind::Engagement => domain::AssignmentKind::Engagement,
            },
            client_id: self.client_id.clone(),
            engagement_id: self.engagement_id.clone(),
        }
    }
}

impl TaskContext {
    pub fn to_domain(&self) -> domain::TaskContext {
        domain::TaskContext {
            audit_area: self.audit_area.clone(),
            period_start: self.period_start.clone(),
            period_end: self.period_end.clone(),
        }
    }

    pub fn is_valid(&self) -> bool {
        self.to_domain().is_valid()
    }
}

impl From<domain::TaskContext> for TaskContext {
    fn from(value: domain::TaskContext) -> Self {
        Self {
            audit_area: value.audit_area,
            period_start: value.period_start,
            period_end: value.period_end,
        }
    }
}

impl Applicability {
    pub fn to_domain(&self) -> domain::Applicability {
        domain::Applicability {
            audit_area: self.audit_area.clone(),
            period_start: self.period_start.clone(),
            period_end: self.period_end.clone(),
        }
    }
}

impl VersionReference {
    pub fn to_domain(&self) -> domain::VersionReference {
        domain::VersionReference {
            id: self.id.clone(),
            version: self.version.clone(),
        }
    }
}

impl From<domain::VersionReference> for VersionReference {
    fn from(value: domain::VersionReference) -> Self {
        Self {
            id: value.id,
            version: value.version,
        }
    }
}

impl Requirement {
    pub fn to_domain(&self) -> domain::Requirement {
        domain::Requirement {
            id: self.id.clone(),
            label: self.label.clone(),
            mandatory: self.mandatory,
            criteria: self.criteria.clone(),
            populations: self.populations.clone(),
            evidence_checks: self.evidence_checks.clone(),
            ratings: self.ratings.clone(),
            templates: self
                .templates
                .as_ref()
                .map(|values| values.iter().map(VersionReference::to_domain).collect()),
            review_rules: self.review_rules.clone(),
            suitable_skills: self
                .suitable_skills
                .as_ref()
                .map(|values| values.iter().map(VersionReference::to_domain).collect()),
        }
    }
}

impl From<domain::Requirement> for Requirement {
    fn from(value: domain::Requirement) -> Self {
        Self {
            id: value.id,
            label: value.label,
            mandatory: value.mandatory,
            criteria: value.criteria,
            populations: value.populations,
            evidence_checks: value.evidence_checks,
            ratings: value.ratings,
            templates: value
                .templates
                .map(|values| values.into_iter().map(Into::into).collect()),
            review_rules: value.review_rules,
            suitable_skills: value
                .suitable_skills
                .map(|values| values.into_iter().map(Into::into).collect()),
        }
    }
}

impl Definition {
    pub fn to_domain(&self) -> domain::Definition {
        domain::Definition {
            name: self.name.clone(),
            neutral_starter: self.neutral_starter,
            default_context: self.default_context.to_domain(),
            templates: self
                .templates
                .iter()
                .map(TemplateDefinition::to_domain)
                .collect(),
            requirements: self
                .requirements
                .iter()
                .map(Requirement::to_domain)
                .collect(),
        }
    }
}

impl TemplateDefinition {
    pub fn to_domain(&self) -> domain::TemplateDefinition {
        domain::TemplateDefinition {
            id: self.id.clone(),
            version: self.version.clone(),
            name: self.name.clone(),
            sections: self
                .sections
                .iter()
                .map(|section| domain::TemplateSection {
                    id: section.id.clone(),
                    title: section.title.clone(),
                    content: section.content.clone(),
                    required: section.required,
                })
                .collect(),
        }
    }
}

impl From<domain::TemplateDefinition> for TemplateDefinition {
    fn from(value: domain::TemplateDefinition) -> Self {
        Self {
            id: value.id,
            version: value.version,
            name: value.name,
            sections: value
                .sections
                .into_iter()
                .map(|section| TemplateSection {
                    id: section.id,
                    title: section.title,
                    content: section.content,
                    required: section.required,
                })
                .collect(),
        }
    }
}

impl From<domain::Resolution> for Resolution {
    fn from(value: domain::Resolution) -> Self {
        Self {
            status: match value.status {
                domain::ResolutionStatus::Resolved => ResolutionStatus::Resolved,
                domain::ResolutionStatus::Neutral => ResolutionStatus::Neutral,
                domain::ResolutionStatus::Incomplete => ResolutionStatus::Incomplete,
                domain::ResolutionStatus::Ambiguous => ResolutionStatus::Ambiguous,
                domain::ResolutionStatus::Recalled => ResolutionStatus::Recalled,
            },
            context: value.context.into(),
            version_ids: value.version_ids,
            requirements: value
                .requirements
                .into_iter()
                .map(|value| ResolvedRequirement {
                    requirement: value.requirement.into(),
                    source_version_ids: value.source_version_ids,
                    field_sources: value
                        .field_sources
                        .into_iter()
                        .map(|source| FieldSource {
                            field: source.field,
                            version_ids: source.version_ids,
                        })
                        .collect(),
                })
                .collect(),
            templates: value
                .templates
                .into_iter()
                .map(|value| ResolvedTemplate {
                    template: value.template.into(),
                    source_version_id: value.source_version_id,
                })
                .collect(),
            neutral_source_version_ids: value.neutral_source_version_ids,
            issues: value.issues,
            reason: value.reason,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn command() -> SaveMethodology {
        SaveMethodology {
            key: "save_1".into(),
            expected_revision: 0,
            supersedes: None,
            undo_of: None,
            assignment: AssignmentScope {
                kind: AssignmentKind::Firm,
                client_id: None,
                engagement_id: None,
            },
            applicability: Applicability::default(),
            activation: Activation {
                mode: ActivationMode::NewTasks,
                available_at: 100,
            },
            definition: Definition {
                name: "Firm methodology".into(),
                neutral_starter: false,
                default_context: TaskContext::default(),
                templates: Vec::new(),
                requirements: vec![Requirement {
                    id: "leavers".into(),
                    label: Some("Leaver access".into()),
                    mandatory: true,
                    criteria: Some(vec!["Disable access promptly".into()]),
                    populations: None,
                    evidence_checks: None,
                    ratings: None,
                    templates: None,
                    review_rules: Some(vec!["Review supported conclusions".into()]),
                    suitable_skills: None,
                }],
            },
            source: SourceAttribution {
                kind: "authored".into(),
                reference: None,
                note: None,
            },
        }
    }

    #[test]
    fn validated_save_has_bounded_scope_revision_and_separate_activation() {
        let mut save = command();
        assert!(save.is_valid());
        save.expected_revision = i64::MAX as u64;
        assert!(!save.is_valid());
        save.expected_revision = 5;
        save.assignment.kind = AssignmentKind::Engagement;
        assert!(!save.is_valid());
        save.assignment.client_id = Some("client".into());
        save.assignment.engagement_id = Some("engagement".into());
        assert!(save.is_valid());
        save.activation.available_at = -1;
        assert!(!save.is_valid());
        save.activation.available_at = domain::MAX_TIMESTAMP;
        assert!(save.is_valid());
        save.activation.available_at += 1;
        assert!(!save.is_valid());
    }

    #[test]
    fn undo_is_a_new_successor_command_and_retains_exact_retry_meaning() {
        let mut save = command();
        save.undo_of = Some("old_version".into());
        assert!(!save.is_valid());
        save.supersedes = Some("current_version".into());
        assert!(save.is_valid());
        let exact = save.clone();
        assert_eq!(save, exact);
        save.activation.mode = ActivationMode::ActiveTasks;
        assert_ne!(save, exact);
        save = exact.clone();
        save.source.note = Some("A different attribution".into());
        assert_ne!(save, exact);
        save = exact.clone();
        save.definition.default_context.audit_area = Some("Access controls".into());
        assert_ne!(save, exact);
    }

    #[test]
    fn sourced_proposals_need_attribution_and_neutral_source_keeps_its_label() {
        let mut save = command();
        save.source.kind = "imported_proposal".into();
        assert!(!save.is_valid());
        save.source.reference = Some("Internal handbook 2025, section 4".into());
        assert!(save.is_valid());
        save.source.kind = "neutral_starter".into();
        assert!(!save.is_valid());
        save.definition.neutral_starter = true;
        assert!(save.is_valid());
        save.source.kind = "chat_policy".into();
        assert!(!save.is_valid());
    }

    #[test]
    fn historical_business_period_is_not_compared_to_availability_date() {
        let mut save = command();
        save.applicability.period_start = Some("1999-01-01".into());
        save.applicability.period_end = Some("1999-12-31".into());
        save.activation.available_at = 1_800_000_000;
        assert!(save.is_valid());
        save.applicability.period_end = Some("1998-12-31".into());
        assert!(!save.is_valid());
    }

    #[test]
    fn conversion_retains_exact_template_and_requirement_versions() {
        let mut save = command();
        save.definition.templates.push(TemplateDefinition {
            id: "paper".into(),
            version: "2".into(),
            name: "Firm paper".into(),
            sections: vec![TemplateSection {
                id: "basis".into(),
                title: "Basis".into(),
                content: "Record exact requirements and source references".into(),
                required: true,
            }],
        });
        save.definition.requirements[0].templates = Some(vec![VersionReference {
            id: "paper".into(),
            version: "2".into(),
        }]);
        let version = VersionRecord {
            id: "method_v1".into(),
            actor_id: "admin".into(),
            saved_at: 200,
            revision: 1,
            command: save,
            recalled: false,
        };
        let resolved = domain::resolve(
            &[version.candidate()],
            &Scope {
                organisation_id: "firm".into(),
                client_id: "client".into(),
                engagement_id: "engagement".into(),
            },
            &domain::TaskContext::default(),
            200,
        );
        let wire = Resolution::from(resolved);
        assert_eq!(wire.status, ResolutionStatus::Resolved);
        assert_eq!(
            wire.templates[0].template,
            version.command.definition.templates[0]
        );
        assert_eq!(wire.templates[0].source_version_id, "method_v1");
        assert_eq!(
            wire.requirements[0].requirement,
            version.command.definition.requirements[0]
        );
        assert!(
            wire.requirements[0]
                .field_sources
                .iter()
                .any(|source| source.field == "templates" && source.version_ids == ["method_v1"])
        );
    }

    #[test]
    fn recall_needs_current_revision_version_identity_and_reason() {
        let mut recall = RecallMethodology {
            key: "recall".into(),
            expected_revision: 1,
            version_id: "version".into(),
            reason: "Faulty mandatory criterion".into(),
        };
        assert!(recall.is_valid());
        recall.reason = " ".into();
        assert!(!recall.is_valid());
        recall.reason = "Faulty mandatory criterion".into();
        recall.version_id = "foreign/version".into();
        assert!(!recall.is_valid());
    }

    #[test]
    fn historical_template_conversion_retains_source_revision_neutrality_and_recall() {
        let mut saved = command();
        saved.definition.neutral_starter = true;
        saved.definition.templates.push(TemplateDefinition {
            id: "paper".into(),
            version: "1".into(),
            name: "Starter paper".into(),
            sections: vec![TemplateSection {
                id: "basis".into(),
                title: "Basis".into(),
                content: "Identify the applicable basis.".into(),
                required: false,
            }],
        });
        let record = VersionRecord {
            id: "original".into(),
            actor_id: "admin".into(),
            saved_at: 50,
            revision: 7,
            command: saved,
            recalled: true,
        };
        let source = record.template_source();
        assert_eq!(source.version_id, "original");
        assert_eq!(source.revision, 7);
        assert_eq!(source.available_at, 100);
        assert!(source.recalled);
        assert!(source.neutral_starter);
        assert_eq!(
            source.templates[0],
            record.command.definition.templates[0].to_domain()
        );
        let mut current = command();
        current.definition.requirements[0].templates = Some(vec![VersionReference {
            id: "paper".into(),
            version: "1".into(),
        }]);
        let current = VersionRecord {
            id: "current".into(),
            actor_id: "admin".into(),
            saved_at: 100,
            revision: 8,
            command: current,
            recalled: false,
        };
        let wire = Resolution::from(domain::resolve_with_templates(
            &[current.candidate()],
            &[source],
            &Scope {
                organisation_id: "firm".into(),
                client_id: "client".into(),
                engagement_id: "engagement".into(),
            },
            &domain::TaskContext::default(),
            200,
        ));
        assert_eq!(wire.status, ResolutionStatus::Recalled);
        assert_eq!(wire.templates[0].source_version_id, "original");
        assert_eq!(wire.neutral_source_version_ids, ["original"]);
    }
}
