//! Firm requirements are configuration, never audit authority. Resolution is
//! independent of Save ordering and preserves each inherited mandatory field.
use std::collections::{BTreeMap, BTreeSet};

use crate::identity::{Scope, valid_scope_id, valid_scope_label};

pub const MAX_REQUIREMENTS: usize = 100;
pub const MAX_FIELD_VALUES: usize = 32;
pub const MAX_TEXT_CHARS: usize = 2_000;
pub const MAX_TIMESTAMP: i64 = 253_402_300_799;
pub const MAX_DEFINITION_BYTES: usize = 200_000;
pub const MAX_TEMPLATES: usize = 32;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum AssignmentKind {
    Firm,
    Client,
    Engagement,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AssignmentScope {
    pub kind: AssignmentKind,
    pub client_id: Option<String>,
    pub engagement_id: Option<String>,
}

impl AssignmentScope {
    pub fn is_valid(&self) -> bool {
        match self.kind {
            AssignmentKind::Firm => self.client_id.is_none() && self.engagement_id.is_none(),
            AssignmentKind::Client => {
                self.client_id.as_deref().is_some_and(valid_scope_id)
                    && self.engagement_id.is_none()
            }
            AssignmentKind::Engagement => {
                self.client_id.as_deref().is_some_and(valid_scope_id)
                    && self.engagement_id.as_deref().is_some_and(valid_scope_id)
            }
        }
    }

    pub fn includes(&self, scope: &Scope) -> bool {
        self.is_valid()
            && self
                .client_id
                .as_ref()
                .is_none_or(|id| id == &scope.client_id)
            && self
                .engagement_id
                .as_ref()
                .is_none_or(|id| id == &scope.engagement_id)
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct TaskContext {
    pub audit_area: Option<String>,
    pub period_start: Option<String>,
    pub period_end: Option<String>,
}

impl TaskContext {
    pub fn is_valid(&self) -> bool {
        self.audit_area.as_deref().is_none_or(valid_scope_label)
            && valid_period(self.period_start.as_deref(), self.period_end.as_deref())
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Applicability {
    pub audit_area: Option<String>,
    pub period_start: Option<String>,
    pub period_end: Option<String>,
}

impl Applicability {
    pub fn is_valid(&self) -> bool {
        self.audit_area.as_deref().is_none_or(valid_scope_label)
            && valid_period(self.period_start.as_deref(), self.period_end.as_deref())
    }

    fn is_unconditional(&self) -> bool {
        self.audit_area.is_none() && self.period_start.is_none()
    }
}

pub fn valid_date(value: &str) -> bool {
    if value.len() != 10 || !value.is_ascii() {
        return false;
    }
    let bytes = value.as_bytes();
    if bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes
            .iter()
            .enumerate()
            .any(|(index, byte)| index != 4 && index != 7 && !byte.is_ascii_digit())
    {
        return false;
    }
    let Ok(year) = value[..4].parse::<u16>() else {
        return false;
    };
    let Ok(month) = value[5..7].parse::<u8>() else {
        return false;
    };
    let Ok(day) = value[8..].parse::<u8>() else {
        return false;
    };
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if year % 400 == 0 || (year % 4 == 0 && year % 100 != 0) => 29,
        2 => 28,
        _ => return false,
    };
    year > 0 && (1..=days).contains(&day)
}

fn valid_period(start: Option<&str>, end: Option<&str>) -> bool {
    match (start, end) {
        (None, None) => true,
        (Some(start), Some(end)) => valid_date(start) && valid_date(end) && start <= end,
        _ => false,
    }
}

pub fn valid_text(value: &str) -> bool {
    !value.is_empty()
        && value.trim() == value
        && value.chars().count() <= MAX_TEXT_CHARS
        && !value.chars().any(char::is_control)
}

/// Template prose preserves indentation, line endings and trailing newlines.
/// The section must contain text, and permits only ordinary layout controls.
pub fn valid_template_content(value: &str) -> bool {
    !value.trim().is_empty()
        && value.chars().count() <= MAX_TEXT_CHARS
        && !value
            .chars()
            .any(|character| character.is_control() && !matches!(character, '\n' | '\r' | '\t'))
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VersionReference {
    pub id: String,
    pub version: String,
}

impl VersionReference {
    pub fn is_valid(&self) -> bool {
        valid_scope_id(&self.id) && valid_scope_id(&self.version)
    }
}

/// None inherits a field. Some(empty) clears an optional field. Mandatory
/// inherited values are additive and cannot be removed by a narrower scope.
#[derive(Clone, Debug, PartialEq, Eq)]
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

impl Requirement {
    pub fn is_valid(&self) -> bool {
        valid_scope_id(&self.id)
            && self.label.as_deref().is_none_or(valid_scope_label)
            && [
                &self.criteria,
                &self.populations,
                &self.evidence_checks,
                &self.ratings,
                &self.review_rules,
            ]
            .into_iter()
            .all(|field| valid_values(field, |value| valid_text(value)))
            && [&self.templates, &self.suitable_skills]
                .into_iter()
                .all(|field| valid_values(field, VersionReference::is_valid))
    }
}

fn valid_values<T: PartialEq>(field: &Option<Vec<T>>, valid: impl Fn(&T) -> bool) -> bool {
    field.as_ref().is_none_or(|values| {
        values.len() <= MAX_FIELD_VALUES
            && values
                .iter()
                .enumerate()
                .all(|(index, value)| valid(value) && !values[..index].contains(value))
    })
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Definition {
    pub name: String,
    pub neutral_starter: bool,
    pub default_context: TaskContext,
    pub templates: Vec<TemplateDefinition>,
    pub requirements: Vec<Requirement>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TemplateSection {
    pub id: String,
    pub title: String,
    pub content: String,
    pub required: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TemplateDefinition {
    pub id: String,
    pub version: String,
    pub name: String,
    pub sections: Vec<TemplateSection>,
}

impl TemplateDefinition {
    pub fn is_valid(&self) -> bool {
        valid_scope_id(&self.id)
            && valid_scope_id(&self.version)
            && valid_scope_label(&self.name)
            && !self.sections.is_empty()
            && self.sections.len() <= MAX_FIELD_VALUES
            && self.sections.iter().enumerate().all(|(index, section)| {
                valid_scope_id(&section.id)
                    && valid_scope_label(&section.title)
                    && valid_template_content(&section.content)
                    && self.sections[..index]
                        .iter()
                        .all(|prior| prior.id != section.id)
            })
    }
}

impl Definition {
    pub fn is_valid(&self) -> bool {
        valid_scope_label(&self.name)
            && self.default_context.is_valid()
            && self.templates.len() <= MAX_TEMPLATES
            && self.templates.iter().enumerate().all(|(index, template)| {
                template.is_valid()
                    && self.templates[..index].iter().all(|previous| {
                        previous.id != template.id || previous.version != template.version
                    })
            })
            && self.requirements.len() <= MAX_REQUIREMENTS
            && self.requirements.iter().enumerate().all(|(index, value)| {
                value.is_valid()
                    && self.requirements[..index]
                        .iter()
                        .all(|previous| previous.id != value.id)
            })
            && self.content_bytes() <= MAX_DEFINITION_BYTES
    }

    fn content_bytes(&self) -> usize {
        let mut size = self.name.len();
        size += self
            .templates
            .iter()
            .map(|template| {
                template.id.len()
                    + template.version.len()
                    + template.name.len()
                    + template
                        .sections
                        .iter()
                        .map(|section| {
                            section.id.len() + section.title.len() + section.content.len()
                        })
                        .sum::<usize>()
            })
            .sum::<usize>();
        for requirement in &self.requirements {
            size += requirement.id.len() + requirement.label.as_ref().map_or(0, String::len);
            size += [
                &requirement.criteria,
                &requirement.populations,
                &requirement.evidence_checks,
                &requirement.ratings,
                &requirement.review_rules,
            ]
            .into_iter()
            .filter_map(Option::as_ref)
            .flatten()
            .map(String::len)
            .sum::<usize>();
            size += [&requirement.templates, &requirement.suitable_skills]
                .into_iter()
                .filter_map(Option::as_ref)
                .flatten()
                .map(|reference| reference.id.len() + reference.version.len())
                .sum::<usize>();
        }
        size
    }
}

/// The adapter supplies current assignment slots at `now`, including recalls.
/// Historical attributed versions remain stored separately from these inputs.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Candidate {
    pub version_id: String,
    pub assignment: AssignmentScope,
    pub applicability: Applicability,
    pub available_at: i64,
    pub recalled: bool,
    pub definition: Definition,
}

/// Exact template content remains usable after its containing assignment is
/// superseded. The producing configuration's scope, availability, recall and
/// neutral standing still govern that content; its old criteria do not return.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TemplateSource {
    pub version_id: String,
    pub revision: u64,
    pub assignment: AssignmentScope,
    pub available_at: i64,
    pub recalled: bool,
    pub neutral_starter: bool,
    pub templates: Vec<TemplateDefinition>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ResolutionStatus {
    Resolved,
    Neutral,
    Incomplete,
    Ambiguous,
    Recalled,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResolvedRequirement {
    pub requirement: Requirement,
    pub source_version_ids: Vec<String>,
    pub field_sources: Vec<FieldSource>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FieldSource {
    pub field: String,
    pub version_ids: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResolvedTemplate {
    pub template: TemplateDefinition,
    pub source_version_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Resolution {
    pub status: ResolutionStatus,
    pub context: TaskContext,
    pub version_ids: Vec<String>,
    pub requirements: Vec<ResolvedRequirement>,
    pub templates: Vec<ResolvedTemplate>,
    /// Join these IDs to requirement field sources and template source IDs.
    /// Unrelated/default-only configuration cannot change their standing.
    pub neutral_source_version_ids: Vec<String>,
    pub issues: Vec<String>,
    pub reason: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ContextMatch {
    Applies,
    Missing,
    Outside,
}

fn context_match(applicability: &Applicability, context: &TaskContext) -> ContextMatch {
    if let (Some(expected), Some(actual)) = (&applicability.audit_area, &context.audit_area)
        && expected != actual
    {
        return ContextMatch::Outside;
    }
    if let (Some(start), Some(end), Some(actual_start), Some(actual_end)) = (
        &applicability.period_start,
        &applicability.period_end,
        &context.period_start,
        &context.period_end,
    ) && (actual_end < start || actual_start > end)
    {
        return ContextMatch::Outside;
    }
    if applicability.audit_area.is_some() && context.audit_area.is_none()
        || applicability.period_start.is_some() && context.period_start.is_none()
    {
        return ContextMatch::Missing;
    }
    if let (Some(start), Some(end), Some(actual_start), Some(actual_end)) = (
        &applicability.period_start,
        &applicability.period_end,
        &context.period_start,
        &context.period_end,
    ) && (actual_start < start || actual_end > end)
    {
        // A Task straddling a policy change needs an explicit split or decision.
        return ContextMatch::Missing;
    }
    ContextMatch::Applies
}

fn merge_field<T: Clone + PartialEq>(
    inherited: &mut Option<Vec<T>>,
    supplied: &Option<Vec<T>>,
    retain: bool,
) {
    let Some(values) = supplied else { return };
    if retain {
        let inherited = inherited.get_or_insert_with(Vec::new);
        for value in values {
            if !inherited.contains(value) {
                inherited.push(value.clone());
            }
        }
    } else {
        *inherited = Some(values.clone());
    }
}

fn merge_requirement(inherited: &mut Requirement, supplied: &Requirement) {
    let retain = inherited.mandatory;
    inherited.mandatory |= supplied.mandatory;
    if supplied.label.is_some() {
        inherited.label.clone_from(&supplied.label);
    }
    merge_field(&mut inherited.criteria, &supplied.criteria, retain);
    merge_field(&mut inherited.populations, &supplied.populations, retain);
    merge_field(
        &mut inherited.evidence_checks,
        &supplied.evidence_checks,
        retain,
    );
    merge_field(&mut inherited.ratings, &supplied.ratings, retain);
    merge_field(&mut inherited.templates, &supplied.templates, retain);
    merge_field(&mut inherited.review_rules, &supplied.review_rules, retain);
    merge_field(
        &mut inherited.suitable_skills,
        &supplied.suitable_skills,
        retain,
    );
}

fn supplied_fields(requirement: &Requirement) -> [(&'static str, bool, bool); 9] {
    [
        (
            "label",
            requirement.label.is_some(),
            requirement.label.is_some(),
        ),
        ("mandatory", true, requirement.mandatory),
        (
            "criteria",
            requirement.criteria.is_some(),
            requirement.criteria.as_ref().is_some_and(|v| !v.is_empty()),
        ),
        (
            "populations",
            requirement.populations.is_some(),
            requirement
                .populations
                .as_ref()
                .is_some_and(|v| !v.is_empty()),
        ),
        (
            "evidence_checks",
            requirement.evidence_checks.is_some(),
            requirement
                .evidence_checks
                .as_ref()
                .is_some_and(|v| !v.is_empty()),
        ),
        (
            "ratings",
            requirement.ratings.is_some(),
            requirement.ratings.as_ref().is_some_and(|v| !v.is_empty()),
        ),
        (
            "templates",
            requirement.templates.is_some(),
            requirement
                .templates
                .as_ref()
                .is_some_and(|v| !v.is_empty()),
        ),
        (
            "review_rules",
            requirement.review_rules.is_some(),
            requirement
                .review_rules
                .as_ref()
                .is_some_and(|v| !v.is_empty()),
        ),
        (
            "suitable_skills",
            requirement.suitable_skills.is_some(),
            requirement
                .suitable_skills
                .as_ref()
                .is_some_and(|v| !v.is_empty()),
        ),
    ]
}

fn update_field_sources(resolved: &mut ResolvedRequirement, supplied: &Requirement, version: &str) {
    for (field, present, nonempty) in supplied_fields(supplied) {
        if !present {
            continue;
        }
        let retain = resolved.requirement.mandatory && field != "label";
        if retain && !nonempty {
            continue;
        }
        if let Some(source) = resolved
            .field_sources
            .iter_mut()
            .find(|source| source.field == field)
        {
            if !retain {
                source.version_ids.clear();
            }
            if !source.version_ids.iter().any(|id| id == version) {
                source.version_ids.push(version.into());
            }
        } else {
            resolved.field_sources.push(FieldSource {
                field: field.into(),
                version_ids: vec![version.into()],
            });
        }
    }
}

fn neutral_template() -> ResolvedTemplate {
    ResolvedTemplate {
        template: TemplateDefinition {
            id: "neutral_working_paper".into(), version: "1".into(),
            name: "Neutral working-paper starter (not firm methodology)".into(),
            sections: [
                ("objective", "Objective", "Describe the objective and scope."),
                ("work", "Work performed", "Record work performed and cite its evidence."),
                ("basis", "Unresolved basis", "Identify missing criteria, review rules and limits; withhold dependent conclusions."),
            ].into_iter().map(|(id, title, content)| TemplateSection {
                id: id.into(), title: title.into(), content: content.into(), required: false,
            }).collect(),
        },
        source_version_id: "builtin_neutral_v1".into(),
    }
}

/// Resolve broad defaults, then field-wise scope/area/period specificity.
/// Equal-specificity assignments remain ambiguous; no timestamp breaks a tie.
/// Missing criteria blocks only a dependent conclusion, not discovery/drafting.
pub fn resolve(
    candidates: &[Candidate],
    scope: &Scope,
    context: &TaskContext,
    now: i64,
) -> Resolution {
    resolve_with_templates(candidates, &[], scope, context, now)
}

/// Historical sources supply only exact template content and provenance.
/// Revision orders identical template declarations to preserve the original
/// source; it never selects a policy or changes business applicability.
pub fn resolve_with_templates(
    candidates: &[Candidate],
    historical_sources: &[TemplateSource],
    scope: &Scope,
    context: &TaskContext,
    now: i64,
) -> Resolution {
    let mut result = Resolution {
        status: ResolutionStatus::Neutral,
        context: context.clone(),
        version_ids: Vec::new(),
        requirements: Vec::new(),
        templates: Vec::new(),
        neutral_source_version_ids: Vec::new(),
        issues: Vec::new(),
        reason: String::new(),
    };
    if !scope.is_valid() || !context.is_valid() {
        result.status = ResolutionStatus::Incomplete;
        result.issues.push("invalid_context".into());
        result.reason =
            "The Task context must be valid before binding applicable requirements.".into();
        return result;
    }
    let mut available: Vec<_> = candidates
        .iter()
        .filter(|candidate| candidate.available_at <= now && candidate.assignment.includes(scope))
        .collect();
    available.sort_by(|left, right| {
        (left.assignment.kind, &left.version_id).cmp(&(right.assignment.kind, &right.version_id))
    });
    // Only unconditional assignments can provide defaults: deriving context
    // from a conditional policy would assume its own applicability.
    let mut defaults = TaskContext::default();
    let mut default_scope = None;
    let mut same_scope_defaults: Option<&TaskContext> = None;
    let mut ambiguous = false;
    for candidate in &available {
        if candidate.recalled || !candidate.applicability.is_unconditional() {
            continue;
        }
        let supplied = &candidate.definition.default_context;
        if default_scope == Some(candidate.assignment.kind) {
            if same_scope_defaults.is_some_and(|previous| previous != supplied) {
                ambiguous = true;
                result.issues.push("conflicting_default_context".into());
            }
        } else {
            default_scope = Some(candidate.assignment.kind);
            same_scope_defaults = Some(supplied);
        }
        if supplied.audit_area.is_some() {
            defaults.audit_area.clone_from(&supplied.audit_area);
        }
        if supplied.period_start.is_some() {
            defaults.period_start.clone_from(&supplied.period_start);
            defaults.period_end.clone_from(&supplied.period_end);
        }
    }
    if result.context.audit_area.is_none() {
        result.context.audit_area = defaults.audit_area;
    }
    if result.context.period_start.is_none() {
        result.context.period_start = defaults.period_start;
        result.context.period_end = defaults.period_end;
    }
    let mut selected = Vec::new();
    for candidate in available {
        match context_match(&candidate.applicability, &result.context) {
            ContextMatch::Applies => selected.push(candidate),
            ContextMatch::Missing => result
                .issues
                .push(format!("unresolved_applicability:{}", candidate.version_id)),
            ContextMatch::Outside => {}
        }
    }
    selected.sort_by_key(|candidate| {
        (
            candidate.assignment.kind,
            candidate.applicability.audit_area.is_some(),
            candidate.applicability.period_start.is_some(),
            &candidate.version_id,
        )
    });
    let mut ranks = BTreeSet::new();
    let mut requirements: BTreeMap<String, ResolvedRequirement> = BTreeMap::new();
    let mut templates: BTreeMap<(String, String), ResolvedTemplate> = BTreeMap::new();
    let mut recalled = false;
    let mut source_standing: BTreeMap<String, bool> = selected
        .iter()
        .map(|candidate| {
            (
                candidate.version_id.clone(),
                candidate.definition.neutral_starter,
            )
        })
        .collect();
    for candidate in &selected {
        let rank = (
            candidate.assignment.kind,
            candidate.applicability.audit_area.is_some(),
            candidate.applicability.period_start.is_some(),
        );
        if !ranks.insert(rank) {
            ambiguous = true;
            result.issues.push("overlapping_assignments".into());
        }
        result.version_ids.push(candidate.version_id.clone());
        recalled |= candidate.recalled;
        for template in &candidate.definition.templates {
            let key = (template.id.clone(), template.version.clone());
            if let Some(existing) = templates.get(&key) {
                if &existing.template != template {
                    ambiguous = true;
                    result.issues.push(format!(
                        "conflicting_template:{}:{}",
                        template.id, template.version
                    ));
                }
            } else {
                templates.insert(
                    key,
                    ResolvedTemplate {
                        template: template.clone(),
                        source_version_id: candidate.version_id.clone(),
                    },
                );
            }
        }
        for supplied in &candidate.definition.requirements {
            match requirements.get_mut(&supplied.id) {
                Some(existing) => {
                    update_field_sources(existing, supplied, &candidate.version_id);
                    merge_requirement(&mut existing.requirement, supplied);
                    existing
                        .source_version_ids
                        .push(candidate.version_id.clone());
                }
                None => {
                    requirements.insert(
                        supplied.id.clone(),
                        ResolvedRequirement {
                            requirement: supplied.clone(),
                            source_version_ids: vec![candidate.version_id.clone()],
                            field_sources: supplied_fields(supplied)
                                .into_iter()
                                .filter(|(_, present, _)| *present)
                                .map(|(field, _, _)| FieldSource {
                                    field: field.into(),
                                    version_ids: vec![candidate.version_id.clone()],
                                })
                                .collect(),
                        },
                    );
                }
            }
        }
    }
    // Current selected definitions remain a self-contained fallback for the
    // pure resolver. Available saved historical declarations carry their real
    // revision and therefore supply the original source when present.
    let current_sources: Vec<_> = selected
        .iter()
        .map(|candidate| TemplateSource {
            version_id: candidate.version_id.clone(),
            revision: u64::MAX,
            assignment: candidate.assignment.clone(),
            available_at: candidate.available_at,
            recalled: candidate.recalled,
            neutral_starter: candidate.definition.neutral_starter,
            templates: candidate.definition.templates.clone(),
        })
        .collect();
    let mut template_sources: Vec<_> = historical_sources
        .iter()
        .chain(&current_sources)
        .filter(|source| source.available_at <= now && source.assignment.includes(scope))
        .collect();
    template_sources.sort_by(|left, right| {
        (left.revision, left.assignment.kind, &left.version_id).cmp(&(
            right.revision,
            right.assignment.kind,
            &right.version_id,
        ))
    });
    let mut exact_templates: BTreeMap<(String, String), (&TemplateDefinition, &TemplateSource)> =
        BTreeMap::new();
    let mut conflicting_templates = BTreeSet::new();
    for source in template_sources {
        for template in &source.templates {
            let key = (template.id.clone(), template.version.clone());
            if let Some((original, _)) = exact_templates.get(&key) {
                if *original != template {
                    conflicting_templates.insert(key);
                }
            } else {
                exact_templates.insert(key, (template, source));
            }
        }
    }
    result.requirements = requirements.into_values().collect();
    for resolved in &result.requirements {
        for reference in resolved.requirement.templates.iter().flatten() {
            if !exact_templates.contains_key(&(reference.id.clone(), reference.version.clone())) {
                result.issues.push(format!(
                    "missing_template:{}:{}",
                    reference.id, reference.version
                ));
            }
        }
        if resolved
            .requirement
            .criteria
            .as_ref()
            .is_none_or(Vec::is_empty)
        {
            result
                .issues
                .push(format!("missing_criteria:{}", resolved.requirement.id));
        }
        if resolved
            .requirement
            .review_rules
            .as_ref()
            .is_none_or(Vec::is_empty)
        {
            result
                .issues
                .push(format!("missing_review_rules:{}", resolved.requirement.id));
        }
    }
    let bound_template_keys: BTreeSet<_> = result
        .requirements
        .iter()
        .flat_map(|resolved| resolved.requirement.templates.iter().flatten())
        .map(|reference| (reference.id.clone(), reference.version.clone()))
        .collect();
    for key in bound_template_keys {
        if conflicting_templates.contains(&key) {
            ambiguous = true;
            result
                .issues
                .push(format!("conflicting_template:{}:{}", key.0, key.1));
        }
        if let Some((template, source)) = exact_templates.get(&key) {
            recalled |= source.recalled;
            source_standing.insert(source.version_id.clone(), source.neutral_starter);
            result.templates.push(ResolvedTemplate {
                template: (*template).clone(),
                source_version_id: source.version_id.clone(),
            });
        }
    }
    if result.templates.is_empty() {
        result.templates.push(neutral_template());
        source_standing.insert("builtin_neutral_v1".into(), true);
    }
    let mut contributing_sources = BTreeSet::new();
    for resolved in &result.requirements {
        for (field, _, nonempty) in supplied_fields(&resolved.requirement) {
            if !nonempty || matches!(field, "label" | "mandatory") {
                continue;
            }
            if let Some(source) = resolved
                .field_sources
                .iter()
                .find(|source| source.field == field)
            {
                contributing_sources.extend(source.version_ids.iter().cloned());
            }
        }
    }
    contributing_sources.extend(
        result
            .templates
            .iter()
            .map(|template| template.source_version_id.clone()),
    );
    result.neutral_source_version_ids = contributing_sources
        .iter()
        .filter(|id| source_standing.get(*id) == Some(&true))
        .cloned()
        .collect();
    let all_neutral = contributing_sources.len() == result.neutral_source_version_ids.len();
    if result.requirements.is_empty() {
        result.issues.push("missing_criteria".into());
        result.issues.push("missing_review_rules".into());
    }
    result.issues.sort();
    result.issues.dedup();
    result.status = if recalled {
        ResolutionStatus::Recalled
    } else if ambiguous {
        ResolutionStatus::Ambiguous
    } else if result
        .issues
        .iter()
        .any(|issue| issue.starts_with("unresolved_"))
    {
        ResolutionStatus::Incomplete
    } else if all_neutral {
        ResolutionStatus::Neutral
    } else if !result.issues.is_empty() {
        ResolutionStatus::Incomplete
    } else {
        ResolutionStatus::Resolved
    };
    result.reason = match result.status {
        ResolutionStatus::Resolved => "Applied exact saved versions by firm, client and engagement scope, audit area and business period; mandatory inherited requirements remain in force.",
        ResolutionStatus::Neutral => "Neutral working-paper starter; no adopted complete firm methodology is established. Discovery and drafting may continue; missing criteria or review rules block their dependent conclusions or issuance.",
        ResolutionStatus::Incomplete => "The binding is incomplete: applicability, criteria or review rules need resolution. Independent discovery and drafting may continue.",
        ResolutionStatus::Ambiguous => "Overlapping assignments or defaults need an explicit applicability decision; latest Save does not choose policy.",
        ResolutionStatus::Recalled => "An applicable version is recalled and cannot authorize new use. Preserve the original binding and reconcile consumed work before replacement.",
    }.into();
    if !all_neutral && !result.neutral_source_version_ids.is_empty() {
        result.reason.push_str(" Some requirement fields or templates remain labelled neutral; their exact source versions are identified separately.");
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scope() -> Scope {
        Scope {
            organisation_id: "firm".into(),
            client_id: "client".into(),
            engagement_id: "engagement".into(),
        }
    }

    fn context() -> TaskContext {
        TaskContext {
            audit_area: Some("Access controls".into()),
            period_start: Some("2025-01-01".into()),
            period_end: Some("2025-12-31".into()),
        }
    }

    fn requirement(id: &str, mandatory: bool) -> Requirement {
        Requirement {
            id: id.into(),
            label: Some("Leaver access".into()),
            mandatory,
            criteria: Some(vec![
                "Disable access on the contractual termination date".into(),
            ]),
            populations: Some(vec!["All leavers in the business period".into()]),
            evidence_checks: Some(vec!["Reconcile source coverage".into()]),
            ratings: Some(vec!["Exception where access remains".into()]),
            templates: None,
            review_rules: Some(vec!["Review supported conclusions".into()]),
            suitable_skills: None,
        }
    }

    fn candidate(id: &str, kind: AssignmentKind) -> Candidate {
        Candidate {
            version_id: id.into(),
            assignment: AssignmentScope {
                kind,
                client_id: (kind != AssignmentKind::Firm).then(|| "client".into()),
                engagement_id: (kind == AssignmentKind::Engagement).then(|| "engagement".into()),
            },
            applicability: Applicability::default(),
            available_at: 100,
            recalled: false,
            definition: Definition {
                name: "Firm audit methodology".into(),
                neutral_starter: false,
                default_context: TaskContext::default(),
                templates: Vec::new(),
                requirements: vec![requirement("leavers", true)],
            },
        }
    }

    fn template() -> TemplateDefinition {
        TemplateDefinition {
            id: "working_paper".into(),
            version: "4".into(),
            name: "Firm working paper".into(),
            sections: vec![TemplateSection {
                id: "conclusion".into(),
                title: "Supported conclusion".into(),
                content: "Relate the conclusion to criteria and cited evidence.".into(),
                required: true,
            }],
        }
    }

    fn historical_source(candidate: &Candidate, revision: u64) -> TemplateSource {
        TemplateSource {
            version_id: candidate.version_id.clone(),
            revision,
            assignment: candidate.assignment.clone(),
            available_at: candidate.available_at,
            recalled: candidate.recalled,
            neutral_starter: candidate.definition.neutral_starter,
            templates: candidate.definition.templates.clone(),
        }
    }

    fn template_reference() -> VersionReference {
        VersionReference {
            id: "working_paper".into(),
            version: "4".into(),
        }
    }

    fn empty_override(id: &str) -> Candidate {
        let mut adopted = candidate(id, AssignmentKind::Engagement);
        adopted.definition.requirements.clear();
        adopted
    }

    #[test]
    fn adopted_empty_and_default_only_overrides_cannot_relabel_neutral_requirements() {
        let mut starter = candidate("starter", AssignmentKind::Firm);
        starter.definition.neutral_starter = true;
        for has_defaults in [false, true] {
            let mut adopted = empty_override("adopted");
            if has_defaults {
                adopted.definition.default_context = context();
            }
            let result = resolve(&[starter.clone(), adopted], &scope(), &context(), 200);
            assert_eq!(result.status, ResolutionStatus::Neutral);
            assert_eq!(result.version_ids, ["starter", "adopted"]);
            assert!(
                result
                    .neutral_source_version_ids
                    .contains(&"starter".into())
            );
            assert!(
                !result
                    .neutral_source_version_ids
                    .contains(&"adopted".into())
            );
        }
    }

    #[test]
    fn label_only_adopted_override_preserves_substantive_neutral_standing() {
        let mut starter = candidate("starter", AssignmentKind::Firm);
        starter.definition.neutral_starter = true;
        let mut adopted = empty_override("adopted");
        adopted.definition.requirements.push(Requirement {
            id: "leavers".into(),
            label: Some("Local label".into()),
            mandatory: false,
            criteria: None,
            populations: None,
            evidence_checks: None,
            ratings: None,
            templates: None,
            review_rules: None,
            suitable_skills: None,
        });
        let result = resolve(&[starter, adopted], &scope(), &context(), 200);
        assert_eq!(result.status, ResolutionStatus::Neutral);
        assert_eq!(
            result.requirements[0].requirement.label.as_deref(),
            Some("Local label")
        );
        assert!(
            result.requirements[0]
                .field_sources
                .iter()
                .any(|source| { source.field == "label" && source.version_ids == ["adopted"] })
        );
        assert!(
            result
                .neutral_source_version_ids
                .contains(&"starter".into())
        );
    }

    #[test]
    fn partial_adoption_identifies_remaining_neutral_fields_without_new_completeness_gate() {
        let mut starter = candidate("starter", AssignmentKind::Firm);
        starter.definition.neutral_starter = true;
        starter.definition.requirements[0].mandatory = false;
        let mut adopted = empty_override("adopted");
        adopted.definition.requirements.push(Requirement {
            id: "leavers".into(),
            label: None,
            mandatory: false,
            criteria: Some(vec!["Adopted firm criterion".into()]),
            populations: None,
            evidence_checks: None,
            ratings: None,
            templates: None,
            review_rules: None,
            suitable_skills: None,
        });
        let result = resolve(&[starter, adopted], &scope(), &context(), 200);
        assert_eq!(result.status, ResolutionStatus::Resolved);
        assert!(result.issues.is_empty());
        assert!(
            result
                .neutral_source_version_ids
                .contains(&"starter".into())
        );
        assert!(result.reason.contains("remain labelled neutral"));
        let fields = &result.requirements[0].field_sources;
        assert!(
            fields
                .iter()
                .any(|source| source.field == "criteria" && source.version_ids == ["adopted"])
        );
        assert!(
            fields
                .iter()
                .any(|source| source.field == "review_rules" && source.version_ids == ["starter"])
        );
    }

    #[test]
    fn replaced_optional_neutral_fields_do_not_taint_adopted_requirement_provenance() {
        let mut starter = candidate("starter", AssignmentKind::Firm);
        starter.definition.neutral_starter = true;
        starter.definition.requirements[0].mandatory = false;
        let mut adopted = candidate("adopted", AssignmentKind::Engagement);
        adopted.definition.requirements[0].mandatory = false;
        adopted.definition.templates.push(template());
        adopted.definition.requirements[0].templates = Some(vec![template_reference()]);
        let result = resolve(&[starter, adopted], &scope(), &context(), 200);
        assert_eq!(result.status, ResolutionStatus::Resolved);
        assert!(result.neutral_source_version_ids.is_empty());
        assert!(!result.reason.contains("remain labelled neutral"));
    }

    #[test]
    fn exact_historical_template_survives_successor_without_reintroducing_old_policy() {
        let mut prior = candidate("prior", AssignmentKind::Firm);
        prior.definition.templates.push(template());
        prior.definition.neutral_starter = true;
        prior.definition.requirements[0].id = "superseded_requirement".into();
        let historical = historical_source(&prior, 1);
        let mut successor = candidate("successor", AssignmentKind::Firm);
        successor.definition.requirements[0].templates = Some(vec![template_reference()]);
        let result = resolve_with_templates(&[successor], &[historical], &scope(), &context(), 200);
        assert_eq!(result.status, ResolutionStatus::Resolved);
        assert_eq!(result.version_ids, ["successor"]);
        assert_eq!(result.requirements.len(), 1);
        assert_eq!(result.requirements[0].requirement.id, "leavers");
        assert_eq!(result.templates[0].template, template());
        assert_eq!(result.templates[0].source_version_id, "prior");
        assert_eq!(result.neutral_source_version_ids, ["prior"]);
    }

    #[test]
    fn historical_template_sources_respect_scope_and_availability() {
        let mut prior = candidate("prior", AssignmentKind::Engagement);
        prior.definition.templates.push(template());
        let mut source = historical_source(&prior, 1);
        let mut successor = candidate("successor", AssignmentKind::Firm);
        successor.definition.requirements[0].templates = Some(vec![template_reference()]);
        source.assignment.client_id = Some("foreign_client".into());
        let foreign = resolve_with_templates(
            &[successor.clone()],
            &[source.clone()],
            &scope(),
            &context(),
            200,
        );
        assert_eq!(foreign.status, ResolutionStatus::Incomplete);
        assert!(
            foreign
                .issues
                .contains(&"missing_template:working_paper:4".into())
        );
        source.assignment.client_id = Some("client".into());
        source.available_at = 201;
        let future = resolve_with_templates(&[successor], &[source], &scope(), &context(), 200);
        assert_eq!(future.status, ResolutionStatus::Incomplete);
        assert!(
            future
                .issues
                .contains(&"missing_template:working_paper:4".into())
        );
    }

    #[test]
    fn template_copy_preserves_original_neutrality_and_recall_independent_of_input_order() {
        let mut original = candidate("original", AssignmentKind::Firm);
        original.definition.templates.push(template());
        original.definition.neutral_starter = true;
        original.recalled = true;
        let original_source = historical_source(&original, 1);
        let mut copied = candidate("copy", AssignmentKind::Firm);
        copied.definition.templates.push(template());
        copied.definition.requirements[0].templates = Some(vec![template_reference()]);
        let copied_source = historical_source(&copied, 2);
        let first = resolve_with_templates(
            &[copied.clone()],
            &[copied_source.clone(), original_source.clone()],
            &scope(),
            &context(),
            200,
        );
        let reverse = resolve_with_templates(
            &[copied],
            &[original_source, copied_source],
            &scope(),
            &context(),
            200,
        );
        assert_eq!(first, reverse);
        assert_eq!(first.status, ResolutionStatus::Recalled);
        assert_eq!(first.templates[0].source_version_id, "original");
        assert_eq!(first.neutral_source_version_ids, ["original"]);
    }

    #[test]
    fn unrelated_recalled_historical_template_does_not_restrict_current_basis() {
        let mut historical = candidate("unrelated", AssignmentKind::Firm);
        historical.definition.templates.push(template());
        historical.recalled = true;
        let current = candidate("current", AssignmentKind::Firm);
        let result = resolve_with_templates(
            &[current],
            &[historical_source(&historical, 1)],
            &scope(),
            &context(),
            200,
        );
        assert_eq!(result.status, ResolutionStatus::Resolved);
        assert_eq!(result.templates[0].source_version_id, "builtin_neutral_v1");
        assert!(
            !result
                .neutral_source_version_ids
                .contains(&"unrelated".into())
        );
    }

    #[test]
    fn validates_real_business_dates_and_complete_ordered_periods() {
        for good in ["0001-01-01", "2000-02-29", "2024-02-29", "9999-12-31"] {
            assert!(valid_date(good), "{good}");
        }
        for bad in [
            "0000-01-01",
            "1900-02-29",
            "2025-02-29",
            "2026-04-31",
            "2026-1-01",
            "2026-01-01Z",
            "２０２６-01-01",
        ] {
            assert!(!valid_date(bad), "{bad}");
        }
        let mut value = context();
        assert!(value.is_valid());
        value.period_end = None;
        assert!(!value.is_valid());
        value.period_end = Some("2024-12-31".into());
        assert!(!value.is_valid());
    }

    #[test]
    fn labels_text_and_templates_share_rust_unicode_whitespace_edges() {
        for good in [
            "\u{feff}Method",
            "Method\u{feff}",
            "Firm\u{00a0}policy",
            "Firm\u{3000}policy",
            "方法 · 2026",
        ] {
            assert!(valid_text(good), "{good:?}");
            assert!(valid_scope_label(good), "{good:?}");
            let mut template = template();
            template.name = good.into();
            template.sections[0].title = good.into();
            template.sections[0].content = good.into();
            assert!(template.is_valid(), "{good:?}");
        }
        for bad in [
            "\u{00a0}Method",
            "Method\u{3000}",
            "\u{0085}Method",
            "Method\u{0085}",
            "Firm\u{0001}policy",
            "Firm\u{007f}policy",
        ] {
            assert!(!valid_text(bad), "{bad:?}");
            assert!(!valid_scope_label(bad), "{bad:?}");
        }
    }

    #[test]
    fn template_prose_preserves_multiline_layout_without_accepting_other_controls() {
        let mut value = template();
        let prose = "\tEvidence:\r\n  Record exact citations.\n\u{feff}Conclusion\n";
        value.sections[0].content = prose.into();
        assert!(value.is_valid());
        assert_eq!(value.sections[0].content, prose);
        for invalid in [
            "\r\n\t ",
            "Evidence\u{0001}citation",
            "Evidence\u{0085}citation",
        ] {
            value.sections[0].content = invalid.into();
            assert!(!value.is_valid(), "{invalid:?}");
        }
        value.sections[0].content = "A valid section".into();
        value.sections[0].title = "Evidence\nConclusion".into();
        assert!(!value.is_valid());
    }

    #[test]
    fn neutral_defaults_cannot_hide_an_unresolved_conditional_assignment() {
        let mut neutral = candidate("neutral", AssignmentKind::Firm);
        neutral.definition.neutral_starter = true;
        let mut conditional = candidate("conditional", AssignmentKind::Engagement);
        conditional.applicability.audit_area = Some("Revenue".into());
        let result = resolve(
            &[neutral, conditional],
            &scope(),
            &TaskContext::default(),
            200,
        );
        assert_eq!(result.status, ResolutionStatus::Incomplete);
        assert!(
            result
                .issues
                .contains(&"unresolved_applicability:conditional".into())
        );
    }

    #[test]
    fn validates_stable_ids_duplicates_unicode_and_aggregate_size() {
        let mut value = candidate("v1", AssignmentKind::Firm).definition;
        assert!(value.is_valid());
        value.requirements.push(value.requirements[0].clone());
        assert!(!value.is_valid());
        value.requirements.pop();
        value.requirements[0].criteria = Some(vec!["same".into(), "same".into()]);
        assert!(!value.is_valid());
        value.requirements[0].criteria = Some(vec!["界".repeat(2_000)]);
        assert!(value.is_valid());
        value.requirements[0].id = "foreign/requirement".into();
        assert!(!value.is_valid());
        value.requirements[0].id = "leavers".into();
        value.requirements[0].criteria = Some(
            (0..32)
                .map(|i| format!("{i}{}", "界".repeat(1_990)))
                .collect(),
        );
        value.requirements[0].populations = value.requirements[0].criteria.clone();
        assert!(!value.is_valid());
    }

    #[test]
    fn scoped_partial_override_preserves_every_inherited_mandatory_field() {
        let mut firm = candidate("firm_v1", AssignmentKind::Firm);
        firm.definition
            .requirements
            .push(requirement("independent_requirement", true));
        firm.definition.templates.push(template());
        firm.definition.requirements[0].templates = Some(vec![VersionReference {
            id: "working_paper".into(),
            version: "4".into(),
        }]);
        let mut engagement = candidate("engagement_v1", AssignmentKind::Engagement);
        let local = &mut engagement.definition.requirements[0];
        local.mandatory = false;
        local.criteria = Some(vec!["Additional exception condition".into()]);
        local.populations = Some(Vec::new());
        local.evidence_checks = None;
        local.ratings = Some(Vec::new());
        local.templates = Some(Vec::new());
        local.review_rules = Some(Vec::new());
        let resolved = resolve(&[engagement, firm], &scope(), &context(), 200);
        assert_eq!(resolved.status, ResolutionStatus::Resolved);
        assert_eq!(resolved.version_ids, ["firm_v1", "engagement_v1"]);
        assert_eq!(resolved.requirements.len(), 2);
        let leavers = resolved
            .requirements
            .iter()
            .find(|r| r.requirement.id == "leavers")
            .unwrap();
        assert!(leavers.requirement.mandatory);
        assert_eq!(leavers.requirement.criteria.as_ref().unwrap().len(), 2);
        assert_eq!(leavers.requirement.populations.as_ref().unwrap().len(), 1);
        assert_eq!(leavers.requirement.ratings.as_ref().unwrap().len(), 1);
        assert_eq!(leavers.requirement.templates.as_ref().unwrap().len(), 1);
        assert_eq!(leavers.requirement.review_rules.as_ref().unwrap().len(), 1);
        let population_source = leavers
            .field_sources
            .iter()
            .find(|source| source.field == "populations")
            .unwrap();
        assert_eq!(population_source.version_ids, ["firm_v1"]);
        let criteria_source = leavers
            .field_sources
            .iter()
            .find(|source| source.field == "criteria")
            .unwrap();
        assert_eq!(criteria_source.version_ids, ["firm_v1", "engagement_v1"]);
        assert_eq!(resolved.templates[0].source_version_id, "firm_v1");
    }

    #[test]
    fn optional_fields_replace_individually_without_erasing_other_inheritance() {
        let mut firm = candidate("firm_v1", AssignmentKind::Firm);
        firm.definition.requirements[0].mandatory = false;
        let mut client = candidate("client_v1", AssignmentKind::Client);
        client.definition.requirements[0].mandatory = false;
        client.definition.requirements[0].criteria = Some(vec!["Client optional advice".into()]);
        client.definition.requirements[0].populations = None;
        client.definition.requirements[0].ratings = Some(Vec::new());
        let result = resolve(&[firm, client], &scope(), &context(), 200);
        let requirement = &result.requirements[0];
        assert_eq!(
            requirement.requirement.criteria.as_ref().unwrap(),
            &["Client optional advice"]
        );
        assert_eq!(
            requirement.requirement.populations.as_ref().unwrap(),
            &["All leavers in the business period"]
        );
        assert!(requirement.requirement.ratings.as_ref().unwrap().is_empty());
        assert_eq!(
            requirement
                .field_sources
                .iter()
                .find(|source| source.field == "criteria")
                .unwrap()
                .version_ids,
            ["client_v1"]
        );
    }

    #[test]
    fn unavailable_future_assignment_does_not_displace_historical_business_policy() {
        let mut applicable = candidate("older_save", AssignmentKind::Firm);
        applicable.applicability.period_start = Some("2025-01-01".into());
        applicable.applicability.period_end = Some("2025-12-31".into());
        let mut other_period = candidate("newer_save", AssignmentKind::Firm);
        other_period.applicability.period_start = Some("2026-01-01".into());
        other_period.applicability.period_end = Some("2026-12-31".into());
        let mut scheduled = applicable.clone();
        scheduled.version_id = "future_activation".into();
        scheduled.available_at = 500;
        let result = resolve(
            &[other_period, scheduled, applicable],
            &scope(),
            &context(),
            200,
        );
        assert_eq!(result.status, ResolutionStatus::Resolved);
        assert_eq!(result.version_ids, ["older_save"]);
    }

    #[test]
    fn equal_rank_overlap_is_explicit_and_independent_of_input_order() {
        let first = candidate("first", AssignmentKind::Firm);
        let mut second = candidate("second", AssignmentKind::Firm);
        second.available_at = 150;
        let forward = resolve(&[first.clone(), second.clone()], &scope(), &context(), 200);
        let reverse = resolve(&[second, first], &scope(), &context(), 200);
        assert_eq!(forward, reverse);
        assert_eq!(forward.status, ResolutionStatus::Ambiguous);
        assert!(forward.issues.contains(&"overlapping_assignments".into()));
    }

    #[test]
    fn straddling_business_period_is_incomplete_instead_of_selecting_one_policy() {
        let mut early = candidate("early", AssignmentKind::Firm);
        early.applicability.period_start = Some("2025-01-01".into());
        early.applicability.period_end = Some("2025-06-30".into());
        let mut late = candidate("late", AssignmentKind::Firm);
        late.applicability.period_start = Some("2025-07-01".into());
        late.applicability.period_end = Some("2025-12-31".into());
        let result = resolve(&[early, late], &scope(), &context(), 200);
        assert_eq!(result.status, ResolutionStatus::Incomplete);
        assert!(result.version_ids.is_empty());
        assert!(
            result
                .issues
                .contains(&"unresolved_applicability:early".into())
        );
        assert!(
            result
                .issues
                .contains(&"unresolved_applicability:late".into())
        );
    }

    #[test]
    fn optional_task_context_uses_firm_defaults_and_explicit_context_wins() {
        let mut firm = candidate("firm", AssignmentKind::Firm);
        firm.definition.default_context = context();
        let mut area = candidate("area", AssignmentKind::Firm);
        area.applicability.audit_area = context().audit_area;
        let result = resolve(
            &[firm.clone(), area.clone()],
            &scope(),
            &TaskContext::default(),
            200,
        );
        assert_eq!(result.status, ResolutionStatus::Resolved);
        assert_eq!(result.context, context());
        assert_eq!(result.version_ids, ["firm", "area"]);
        let explicit = TaskContext {
            audit_area: Some("Revenue".into()),
            ..context()
        };
        let result = resolve(&[firm, area], &scope(), &explicit, 200);
        assert_eq!(result.context, explicit);
        assert_eq!(result.version_ids, ["firm"]);
    }

    #[test]
    fn conditional_assignment_cannot_supply_its_own_missing_context() {
        let mut conditional = candidate("conditional", AssignmentKind::Firm);
        conditional.applicability.audit_area = context().audit_area;
        conditional.definition.default_context = context();
        let result = resolve(&[conditional], &scope(), &TaskContext::default(), 200);
        assert_eq!(result.status, ResolutionStatus::Incomplete);
        assert_eq!(result.context, TaskContext::default());
        assert!(result.version_ids.is_empty());
    }

    #[test]
    fn neutral_starter_and_incomplete_criteria_do_not_claim_firm_adoption() {
        let neutral = resolve(&[], &scope(), &TaskContext::default(), 200);
        assert_eq!(neutral.status, ResolutionStatus::Neutral);
        assert_eq!(neutral.templates[0].source_version_id, "builtin_neutral_v1");
        assert!(
            neutral.templates[0]
                .template
                .name
                .contains("not firm methodology")
        );
        let mut incomplete = candidate("incomplete", AssignmentKind::Firm);
        incomplete.definition.requirements[0].criteria = None;
        let result = resolve(&[incomplete], &scope(), &context(), 200);
        assert_eq!(result.status, ResolutionStatus::Incomplete);
        assert!(result.issues.contains(&"missing_criteria:leavers".into()));
        assert!(
            result
                .reason
                .contains("Independent discovery and drafting may continue")
        );
    }

    #[test]
    fn recall_blocks_affected_basis_and_foreign_scope_never_contributes() {
        let mut recalled = candidate("recalled", AssignmentKind::Firm);
        recalled.recalled = true;
        let mut foreign = candidate("foreign", AssignmentKind::Engagement);
        foreign.assignment.client_id = Some("other_client".into());
        let result = resolve(&[recalled, foreign], &scope(), &context(), 200);
        assert_eq!(result.status, ResolutionStatus::Recalled);
        assert_eq!(result.version_ids, ["recalled"]);
    }

    #[test]
    fn template_reference_binds_exact_content_and_missing_version_is_incomplete() {
        let mut firm = candidate("firm", AssignmentKind::Firm);
        firm.definition.templates.push(template());
        firm.definition.requirements[0].templates = Some(vec![VersionReference {
            id: "working_paper".into(),
            version: "4".into(),
        }]);
        let resolved = resolve(&[firm.clone()], &scope(), &context(), 200);
        assert_eq!(resolved.status, ResolutionStatus::Resolved);
        assert_eq!(resolved.templates[0].template, template());
        assert_eq!(resolved.templates[0].source_version_id, "firm");
        firm.definition.requirements[0].templates.as_mut().unwrap()[0].version = "5".into();
        let incomplete = resolve(&[firm], &scope(), &context(), 200);
        assert_eq!(incomplete.status, ResolutionStatus::Incomplete);
        assert!(
            incomplete
                .issues
                .contains(&"missing_template:working_paper:5".into())
        );
    }

    #[test]
    fn same_template_version_cannot_silently_change_content_in_narrower_scope() {
        let mut firm = candidate("firm", AssignmentKind::Firm);
        firm.definition.templates.push(template());
        let mut client = candidate("client", AssignmentKind::Client);
        let mut changed = template();
        changed.sections[0].content = "Different instructions".into();
        client.definition.templates.push(changed);
        let result = resolve(&[firm, client], &scope(), &context(), 200);
        assert_eq!(result.status, ResolutionStatus::Ambiguous);
        assert!(
            result
                .issues
                .contains(&"conflicting_template:working_paper:4".into())
        );
    }
}
