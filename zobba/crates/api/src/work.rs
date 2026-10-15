//! Task work projection, untargeted direction and targeting questions.
//! Direction and answers use the reserved control lane: they produce Guides,
//! which never wait on a model. Work and question reads are ordinary traffic.
//! No model text is returned by these routes.
use axum::{
    Json,
    extract::{Path, Query, State, rejection::JsonRejection},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use zobba_application::{assessment::AssessmentSnapshot, task::TaskError};
use zobba_domain::{
    assessment::{Authority, AuthorityReason, CriterionMethod, FactState, FactValue, Measure},
    citation::{UnverifiedReason, Verification},
    context::{CompactionSummary, OmissionCategory, SourceStatus},
    identity::valid_scope_id,
    work::{
        Attention, BriefRevision, Direction, NextAction, RoutedGuide, RoutingQuestion, StepKind,
        StepReason, StepStatus, TaskStep, TaskWork,
    },
};

use crate::auth::ErrorResponse;
use crate::tasks::{CommandReceiptResponse, TaskHttpState, TaskScopeQuery, failure};

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum StepKindResponse {
    ModelTurn,
    ToolStep,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum StepStatusResponse {
    Proposed,
    Responded,
    Superseded,
    Failed,
    Completed,
    Refused,
    ReconciliationRequired,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AttentionResponse {
    AwaitingGuidance,
    ReconciliationRequired,
    StepFailed,
    CycleBounded,
    /// Zobba recorded a contextual question about the method that no later
    /// guidance has been applied after. The auditor answers through Guide.
    MethodQuestion,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum StepReasonResponse {
    /// The owned constraints, objective, method, brief and unresolved decisions
    /// alone exceeded the context budget; nothing was sent to a model.
    ContextBudget,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SourceStatusResponse {
    Current,
    Withdrawn,
    Corrected,
    Invalidated,
}

/// A knowledge revision an earlier compacted turn used, with its standing when
/// the record was made.
#[derive(Serialize, ToSchema)]
pub struct CompactionSourceResponse {
    pub id: String,
    #[schema(pattern = "^[0-9]+$")]
    pub revision: String,
    pub status: SourceStatusResponse,
}

/// Why material was left out of a request. A category never means absence.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum OmissionCategoryResponse {
    StepsCompacted,
    DigestsOmitted,
    KnowledgeBudget,
    KnowledgeUnusable,
    StaleSources,
    StaleContent,
    SkillsBudget,
}

/// Count of material left out by category. An omission never means absence.
#[derive(Serialize, ToSchema)]
pub struct OmissionResponse {
    pub category: OmissionCategoryResponse,
    pub count: u32,
}

/// A durable context compaction record: a deterministic digest of recorded step
/// facts (never a model summary, never evidence). The covered raw steps remain
/// inspectable.
#[derive(Serialize, ToSchema)]
pub struct CompactionResponse {
    pub sequence: u32,
    pub first_ordinal: u32,
    pub last_ordinal: u32,
    /// SHA-256 of the canonical digest, reproducible from the database.
    #[schema(pattern = "^[0-9a-f]{64}$")]
    pub digest_sha256: String,
    #[schema(max_items = 512)]
    pub sources: Vec<CompactionSourceResponse>,
    #[schema(max_items = 7)]
    pub omissions: Vec<OmissionResponse>,
    #[schema(pattern = "^[0-9]+$")]
    pub estimated_tokens: String,
    /// Server time the record was made, in seconds since the Unix epoch.
    #[schema(pattern = "^[0-9]+$")]
    pub created_at: String,
}

/// One immutable recorded step. Labels are fixed platform text, never model output.
#[derive(Serialize, ToSchema)]
pub struct TaskStepResponse {
    pub ordinal: u32,
    pub kind: StepKindResponse,
    pub status: StepStatusResponse,
    #[schema(pattern = "^[0-9]+$")]
    pub intent_revision: String,
    #[schema(pattern = "^[0-9]+$")]
    pub execution_epoch: String,
    #[schema(required = true)]
    pub invocation_id: Option<String>,
    #[schema(required = true)]
    pub operation_id: Option<String>,
    /// `model_turn`, `await_guidance`, `reconcile` or `tool:<catalogue name>`.
    #[schema(required = true)]
    pub next_action: Option<String>,
    #[schema(max_length = 200)]
    pub current_work: String,
    /// Model turns: authorised knowledge records left out of the turn's context.
    pub knowledge_omitted: u32,
    /// Fixed reason the platform ended a failed turn without sending it.
    #[schema(required = true)]
    pub reason: Option<StepReasonResponse>,
    /// Model turns: conservative token estimate of the planned request.
    #[schema(required = true, pattern = "^[0-9]+$")]
    pub estimated_input_tokens: Option<String>,
    /// Model turns: input tokens the provider reported, when known.
    #[schema(required = true, pattern = "^[0-9]+$")]
    pub actual_input_tokens: Option<String>,
}

/// An accepted brief revision. Received and applied are separate facts.
#[derive(Serialize, ToSchema)]
pub struct BriefRevisionResponse {
    pub command_id: String,
    pub cycle_id: String,
    /// Retained plain text supplied by a person; no model understanding is asserted.
    pub content: String,
    #[schema(pattern = "^[0-9]+$")]
    pub received_cursor: String,
    /// Recorded step count of the cycle when applied; null until applied.
    #[schema(required = true)]
    pub applied_boundary: Option<u32>,
    #[schema(required = true, pattern = "^[0-9]+$")]
    pub applied_cursor: Option<String>,
    /// The later accepted revision that replaced this one.
    #[schema(required = true)]
    pub superseded_by: Option<String>,
}

#[derive(Serialize, ToSchema)]
pub struct TaskWorkResponse {
    pub task_id: String,
    pub cycle_id: String,
    /// False when no qualified profile and enabled catalogue are selectable here:
    /// the Task stays inert and no model is called.
    pub model_available: bool,
    #[schema(required = true)]
    pub methodology_binding_id: Option<String>,
    #[schema(required = true)]
    pub methodology_status: Option<String>,
    #[schema(required = true)]
    pub current_work: Option<String>,
    #[schema(required = true)]
    pub next_action: Option<String>,
    /// The invocation that proposed `next_action`.
    #[schema(required = true)]
    pub next_action_invocation_id: Option<String>,
    #[schema(required = true)]
    pub attention: Option<AttentionResponse>,
    /// The most recent recorded steps of the current cycle, in order.
    #[schema(max_items = 50)]
    pub steps: Vec<TaskStepResponse>,
    /// All steps recorded in the current cycle; earlier ones may be omitted above.
    pub total_steps: u32,
    #[schema(max_items = 50)]
    pub briefs: Vec<BriefRevisionResponse>,
    /// The most recent context compaction records of the current cycle, oldest first.
    #[schema(max_items = 20)]
    pub compactions: Vec<CompactionResponse>,
    /// All compaction records of the current cycle.
    pub total_compactions: u32,
    /// Story 22.6: the exact method and skill versions this cycle used, its
    /// gaps, questions and Zobba statements. Null when not composed or when
    /// it could not be read; `investigation_unavailable` says which.
    #[schema(required = true)]
    pub investigation: Option<InvestigationResponse>,
    /// True when investigation is composed but its facts could not be read
    /// for this response. The rest of the work view is unaffected.
    pub investigation_unavailable: bool,
    /// Story 24.1: the Task's assessment basis versions, criterion versions,
    /// typed facts and evaluations. Null when not composed or not readable;
    /// `assessment_unavailable` says which.
    #[schema(required = true)]
    pub assessment: Option<AssessmentResponse>,
    pub assessment_unavailable: bool,
}

/// A fact the criterion needs, with its type and (for a decimal) measure.
#[derive(Serialize, ToSchema)]
pub struct RequiredFactResponse {
    pub name: String,
    /// `identifier`, `text`, `boolean`, `enum`, `decimal`, `date` or `instant`.
    pub fact_type: String,
    /// ISO 4217 currency code or unit name, for a decimal.
    #[schema(required = true)]
    pub measure: Option<String>,
}

/// One immutable criterion version. Its assertion is attributed agent text;
/// its authority was checked by trusted code.
#[derive(Serialize, ToSchema)]
pub struct AssessmentCriterionResponse {
    pub id: String,
    pub invocation_id: String,
    /// The agent's local name for it in its answer.
    pub key: String,
    #[schema(required = true)]
    pub supersedes: Option<String>,
    #[schema(max_length = 1000)]
    pub assertion: String,
    /// `rule` (decided by trusted code) or `judgment` (proposed by the model).
    pub kind: String,
    /// `method` or `original`.
    pub authority_kind: String,
    pub authority_verified: bool,
    /// Closed reason when the authority is unverified.
    #[schema(required = true)]
    pub authority_reason: Option<String>,
    /// Method authority: requirement and 0-based criterion ordinal.
    #[schema(required = true)]
    pub requirement_id: Option<String>,
    #[schema(required = true)]
    pub criterion_ordinal: Option<u32>,
    #[schema(required = true, pattern = "^[0-9a-f]{64}$")]
    pub authority_text_sha256: Option<String>,
    /// Original authority: the cited quote and its verification.
    #[schema(required = true)]
    pub authority_source: Option<crate::answers::CitationSourceResponse>,
    #[schema(required = true)]
    pub effective_from: Option<String>,
    #[schema(required = true)]
    pub effective_to: Option<String>,
    /// The applicability test, in platform words.
    #[schema(required = true)]
    pub applicability: Option<String>,
    /// The rule predicate, in platform words.
    #[schema(required = true)]
    pub rule: Option<String>,
    #[schema(required = true, max_length = 2000)]
    pub rubric: Option<String>,
    #[schema(max_items = 8)]
    pub required_facts: Vec<RequiredFactResponse>,
    pub methodology_binding_id: String,
    #[schema(pattern = "^[0-9]+$")]
    pub execution_epoch: String,
}

/// A population or sample reference to a registered original.
#[derive(Serialize, ToSchema)]
pub struct PopulationReferenceResponse {
    pub original_id: String,
    pub unit: String,
    pub selection: String,
    /// The registered digest pinned when the basis was recorded; null when it
    /// was not a registered original.
    #[schema(required = true, pattern = "^[0-9a-f]{64}$")]
    pub sha256: Option<String>,
    /// The filename, only when the viewer may read that exact original now.
    #[schema(required = true)]
    pub filename: Option<String>,
}

/// One immutable assessment basis version.
#[derive(Serialize, ToSchema)]
pub struct AssessmentBasisResponse {
    pub id: String,
    pub invocation_id: String,
    pub key: String,
    #[schema(required = true)]
    pub supersedes: Option<String>,
    pub objective: String,
    #[schema(max_items = 16)]
    pub criteria: Vec<String>,
    /// Business period, civil dates (`YYYY-MM-DD`).
    pub period_from: String,
    pub period_to: String,
    #[schema(required = true)]
    pub as_of: Option<String>,
    #[schema(max_items = 8)]
    pub population: Vec<PopulationReferenceResponse>,
    #[schema(max_items = 8)]
    pub limitations: Vec<String>,
    pub methodology_binding_id: String,
    #[schema(pattern = "^[0-9]+$")]
    pub execution_epoch: String,
}

/// One immutable typed fact observation and its verified sources.
#[derive(Serialize, ToSchema)]
pub struct AssessmentFactResponse {
    pub id: String,
    pub invocation_id: String,
    pub basis_id: String,
    /// Exactly as stated (leading zeros kept).
    pub subject: String,
    pub subject_unit: String,
    pub name: String,
    /// A fact type, `unavailable` or `ambiguous`.
    pub value_kind: String,
    /// True when the fact states a value the viewer may not see: the value
    /// is read from its source quote, and none of its sources is an exact
    /// original the viewer may read now. The value fields are then null.
    pub value_withheld: bool,
    /// Canonical value text (decimal `1250.00`, date, RFC 3339 instant).
    #[schema(required = true)]
    pub value: Option<String>,
    #[schema(required = true)]
    pub measure: Option<String>,
    /// Exact decimal: digit-string mantissa and scale (no float).
    #[schema(required = true, pattern = "^-?[0-9]+$")]
    pub mantissa: Option<String>,
    #[schema(required = true)]
    pub scale: Option<u32>,
    /// An instant in UTC; `value` keeps the source offset.
    #[schema(required = true)]
    pub utc: Option<String>,
    #[schema(required = true)]
    pub offset_minutes: Option<i32>,
    /// Unavailable reason or ambiguous candidate count.
    #[schema(required = true)]
    pub unavailable_reason: Option<String>,
    #[schema(required = true)]
    pub candidates: Option<u32>,
    #[schema(required = true)]
    pub rule: Option<String>,
    /// `supported`, `unsupported` or `no_value`.
    pub support: String,
    #[schema(required = true)]
    pub support_reason: Option<String>,
    /// The subject was found at, or beside, a verified source of the value.
    pub subject_grounded: bool,
    /// For a decimal: its currency or unit was found at, or beside, a
    /// verified source; otherwise it is only the agent's claim.
    #[schema(required = true)]
    pub measure_grounded: Option<bool>,
    #[schema(required = true)]
    pub job_id: Option<String>,
    #[schema(max_items = 4)]
    pub sources: Vec<crate::answers::CitationSourceResponse>,
    pub methodology_binding_id: String,
    #[schema(pattern = "^[0-9]+$")]
    pub execution_epoch: String,
}

#[derive(Serialize, ToSchema)]
pub struct EvaluationInputResponse {
    pub fact_id: String,
    #[schema(pattern = "^[0-9a-f]{64}$")]
    pub digest: String,
}

/// A model's judgment of a judgment criterion, in words. Pending human
/// disposition; there is no confidence score.
#[derive(Serialize, ToSchema)]
pub struct JudgmentResponse {
    pub supporting: Vec<String>,
    pub contrary: Vec<String>,
    #[schema(max_length = 2000)]
    pub rationale: String,
    #[schema(max_length = 2000)]
    pub uncertainty: String,
}

/// One immutable evaluation. Applicability, execution, verdict and origin
/// are separate fields; only an applicable, completed evaluation on
/// supported facts can be met or not_met.
#[derive(Serialize, ToSchema)]
pub struct AssessmentEvaluationResponse {
    pub id: String,
    pub invocation_id: String,
    pub basis_id: String,
    pub criterion_id: String,
    pub subject: String,
    /// `applicable`, `not_applicable` or `unknown`.
    pub applicability: String,
    /// `completed` or `failed`.
    pub execution: String,
    /// `met`, `not_met`, `undetermined`, or null (no verdict).
    #[schema(required = true)]
    pub verdict: Option<String>,
    #[schema(required = true)]
    pub reason: Option<String>,
    /// `deterministic` or `model_proposal`.
    pub origin: String,
    #[schema(max_items = 32)]
    pub inputs: Vec<EvaluationInputResponse>,
    #[schema(pattern = "^[0-9a-f]{64}$")]
    pub output_digest: String,
    #[schema(required = true)]
    pub judgment: Option<JudgmentResponse>,
    pub methodology_binding_id: String,
    #[schema(pattern = "^[0-9]+$")]
    pub execution_epoch: String,
}

#[derive(Serialize, ToSchema)]
pub struct AssessmentResponse {
    /// The Task's newest records of each kind, oldest first; earlier ones
    /// may be omitted (see the totals).
    #[schema(max_items = 64)]
    pub bases: Vec<AssessmentBasisResponse>,
    #[schema(pattern = "^[0-9]+$")]
    pub total_bases: String,
    #[schema(max_items = 64)]
    pub criteria: Vec<AssessmentCriterionResponse>,
    #[schema(pattern = "^[0-9]+$")]
    pub total_criteria: String,
    #[schema(max_items = 1024)]
    pub facts: Vec<AssessmentFactResponse>,
    #[schema(pattern = "^[0-9]+$")]
    pub total_facts: String,
    #[schema(max_items = 256)]
    pub evaluations: Vec<AssessmentEvaluationResponse>,
    #[schema(pattern = "^[0-9]+$")]
    pub total_evaluations: String,
}

/// One recorded skill use: a load, a resource fetch or a script run. Content
/// is never returned here; a use names the exact version and digest.
#[derive(Serialize, ToSchema)]
pub struct SkillUseResponse {
    pub invocation_id: String,
    /// `load`, `resource` or `script`.
    pub kind: String,
    pub ordinal: u32,
    pub version_id: String,
    #[schema(required = true)]
    pub resource_id: Option<String>,
    #[schema(required = true)]
    pub skill_id: Option<String>,
    #[schema(required = true)]
    pub skill_version: Option<String>,
    #[schema(required = true)]
    pub name: Option<String>,
    #[schema(required = true, pattern = "^[0-9a-f]{64}$")]
    pub digest: Option<String>,
    /// `loaded`, `fetched`, `completed`, `failed` or `unavailable`.
    pub outcome: String,
    /// Closed reason of a failed or unavailable use.
    #[schema(required = true)]
    pub reason: Option<String>,
    #[schema(required = true)]
    pub job_id: Option<String>,
    pub methodology_binding_id: String,
    #[schema(pattern = "^[0-9]+$")]
    pub execution_epoch: String,
}

/// A gap, contextual question or Zobba statement about one requirement. A
/// statement points at answer segments whose citations support it; nothing
/// marks a requirement complete.
#[derive(Serialize, ToSchema)]
pub struct MethodNoteResponse {
    pub invocation_id: String,
    pub ordinal: u32,
    /// `agent` (Zobba's answer) or `platform` (a deterministic fact).
    pub source: String,
    #[schema(required = true)]
    pub requirement_id: Option<String>,
    /// `gap`, `question` or `statement`.
    pub kind: String,
    /// Retained text as written, shown as attributed data.
    #[schema(max_length = 1000)]
    pub text: String,
    #[schema(required = true)]
    pub reason: Option<String>,
    #[schema(max_items = 8)]
    pub segments: Vec<u32>,
    pub methodology_binding_id: String,
    #[schema(pattern = "^[0-9]+$")]
    pub execution_epoch: String,
    /// For a question: true while no guidance has been applied after its
    /// turn. Always false for gaps and statements.
    pub open: bool,
}

#[derive(Serialize, ToSchema)]
pub struct UsedSkillResponse {
    pub version_id: String,
    pub skill_id: String,
    pub skill_version: String,
    #[schema(pattern = "^[0-9a-f]{64}$")]
    pub digest: String,
}

/// Zobba's own investigation record of its latest answered turn: method,
/// skill, model and tool provenance. Separate from the working brief.
#[derive(Serialize, ToSchema)]
pub struct InvestigationRecordResponse {
    pub invocation_id: String,
    pub methodology_binding_id: String,
    #[schema(pattern = "^[0-9]+$")]
    pub execution_epoch: String,
    pub method_status: String,
    #[schema(max_items = 64)]
    pub method_version_ids: Vec<String>,
    #[schema(max_items = 64)]
    pub skills: Vec<UsedSkillResponse>,
    pub provider: String,
    pub model: String,
    pub profile_id: String,
    #[schema(pattern = "^[0-9]+$")]
    pub profile_revision: String,
    pub catalogue_id: String,
    #[schema(pattern = "^[0-9]+$")]
    pub catalogue_revision: String,
    #[schema(max_items = 64)]
    pub tools: Vec<String>,
    pub gaps: u32,
    pub questions: u32,
    pub statements: u32,
    /// Notes beyond the recorded bound, counted and not recorded.
    pub omitted_notes: u32,
    /// Skill, method version and tool entries beyond the record bound.
    pub omitted_items: u32,
    /// Individually invalid answer requests and notes left out on decode.
    pub discarded_requests: u32,
}

#[derive(Serialize, ToSchema)]
pub struct InvestigationResponse {
    /// The Task's current binding and the exact method versions it resolves.
    pub methodology_binding_id: String,
    pub method_status: String,
    #[schema(max_items = 64)]
    pub method_version_ids: Vec<String>,
    /// This cycle's newest skill uses, in record order; earlier ones may be
    /// omitted (see `total_skills`).
    #[schema(max_items = 512)]
    pub skills: Vec<SkillUseResponse>,
    /// Every skill use recorded in this cycle.
    #[schema(pattern = "^[0-9]+$")]
    pub total_skills: String,
    /// This cycle's newest method notes, in record order; earlier ones may be
    /// omitted (see `total_notes`).
    #[schema(max_items = 1024)]
    pub notes: Vec<MethodNoteResponse>,
    /// Every method note recorded in this cycle.
    #[schema(pattern = "^[0-9]+$")]
    pub total_notes: String,
    #[schema(required = true)]
    pub record: Option<InvestigationRecordResponse>,
    /// Questions of the whole cycle with no guidance applied after their turn.
    pub open_questions: u32,
}

fn investigation(
    view: zobba_infrastructure::investigation::InvestigationView,
) -> InvestigationResponse {
    let open: std::collections::BTreeSet<(String, u32)> =
        view.open_questions.iter().cloned().collect();
    InvestigationResponse {
        open_questions: view.open_questions.len() as u32,
        total_skills: view.total_uses.to_string(),
        total_notes: view.total_notes.to_string(),
        methodology_binding_id: view.methodology_binding_id,
        method_status: view.method_status,
        method_version_ids: view.method_version_ids,
        skills: view
            .uses
            .into_iter()
            .map(|u| SkillUseResponse {
                invocation_id: u.invocation_id,
                kind: u.kind.as_str().into(),
                ordinal: u.ordinal,
                version_id: u.version_id,
                resource_id: u.resource_id,
                skill_id: u.facts.as_ref().map(|f| f.skill_id.clone()),
                skill_version: u.facts.as_ref().map(|f| f.skill_version.clone()),
                name: u.facts.as_ref().map(|f| f.name.clone()),
                digest: u.facts.as_ref().map(|f| f.digest.clone()),
                outcome: u.outcome.as_str().into(),
                reason: u.reason.map(|r| r.as_str().into()),
                job_id: u.job_id,
                methodology_binding_id: u.methodology_binding_id,
                execution_epoch: u.execution_epoch.to_string(),
            })
            .collect(),
        notes: view
            .notes
            .into_iter()
            .map(|n| MethodNoteResponse {
                open: n.note.kind == zobba_domain::investigation::NoteKind::Question
                    && open.contains(&(n.invocation_id.clone(), n.ordinal)),
                invocation_id: n.invocation_id,
                ordinal: n.ordinal,
                source: n.source.as_str().into(),
                requirement_id: n.note.requirement_id,
                kind: n.note.kind.as_str().into(),
                text: n.note.text,
                reason: n.note.reason.map(|r| r.as_str().into()),
                segments: n.note.segments,
                methodology_binding_id: n.methodology_binding_id,
                execution_epoch: n.execution_epoch.to_string(),
            })
            .collect(),
        record: view.record.map(|r| InvestigationRecordResponse {
            invocation_id: r.invocation_id,
            methodology_binding_id: r.methodology_binding_id,
            execution_epoch: r.execution_epoch.to_string(),
            method_status: r.method_status,
            method_version_ids: r.method_version_ids,
            skills: r
                .skills
                .into_iter()
                .map(|s| UsedSkillResponse {
                    version_id: s.version_id,
                    skill_id: s.skill_id,
                    skill_version: s.skill_version,
                    digest: s.digest,
                })
                .collect(),
            provider: r.provider,
            model: r.model,
            profile_id: r.profile_id,
            profile_revision: r.profile_revision.to_string(),
            catalogue_id: r.catalogue_id,
            catalogue_revision: r.catalogue_revision.to_string(),
            tools: r.tools,
            gaps: r.gaps,
            questions: r.questions,
            statements: r.statements,
            omitted_notes: r.omitted_notes,
            omitted_items: r.omitted_items,
            discarded_requests: r.discarded_requests,
        }),
    }
}

type Originals = std::collections::BTreeMap<String, zobba_infrastructure::citation::ViewerOriginal>;

/// Every original an assessment snapshot cites or references.
fn assessment_originals(view: &AssessmentSnapshot) -> Vec<String> {
    let mut ids = std::collections::BTreeSet::new();
    for fact in &view.facts {
        ids.extend(fact.sources.iter().map(|s| s.source.original_id.clone()));
    }
    for criterion in &view.criteria {
        if let Authority::Original(source) = &criterion.criterion.authority {
            ids.insert(source.original_id.clone());
        }
    }
    for basis in &view.bases {
        ids.extend(basis.basis.population.iter().map(|p| p.original_id.clone()));
    }
    ids.into_iter().collect()
}

fn verified_source(
    source: &zobba_domain::citation::VerifiedSource,
    originals: &Originals,
) -> crate::answers::CitationSourceResponse {
    use crate::answers::CitationVerificationResponse as V;
    let original = crate::answers::exact_original(
        originals,
        &source.source.original_id,
        source.original_sha256.as_deref(),
    );
    crate::answers::source_response(
        &source.source,
        original,
        match source.verification {
            Verification::Verified => (V::Verified, None),
            Verification::Unverified(reason) => (V::Unverified, Some(reason.as_str().into())),
        },
    )
}

fn measure(m: Option<&Measure>) -> Option<String> {
    m.map(Measure::label)
}

fn assessment(view: AssessmentSnapshot, originals: &Originals) -> AssessmentResponse {
    AssessmentResponse {
        total_bases: view.total_bases.to_string(),
        total_criteria: view.total_criteria.to_string(),
        total_facts: view.total_facts.to_string(),
        total_evaluations: view.total_evaluations.to_string(),
        bases: view
            .bases
            .iter()
            .map(|b| AssessmentBasisResponse {
                id: b.id.clone(),
                invocation_id: b.invocation_id.clone(),
                key: b.basis.key.clone(),
                supersedes: b.basis.supersedes.clone(),
                objective: b.basis.objective.clone(),
                criteria: b.basis.criteria.clone(),
                period_from: b.basis.period_from.render(),
                period_to: b.basis.period_to.render(),
                as_of: b.basis.as_of.map(|i| i.render()),
                population: b
                    .basis
                    .population
                    .iter()
                    .zip(&b.population_sha256)
                    .map(|(p, sha)| PopulationReferenceResponse {
                        original_id: p.original_id.clone(),
                        unit: p.unit.clone(),
                        selection: p.selection.clone(),
                        sha256: sha.clone(),
                        filename: crate::answers::exact_original(
                            originals,
                            &p.original_id,
                            sha.as_deref(),
                        )
                        .and_then(|o| o.filename.clone()),
                    })
                    .collect(),
                limitations: b.basis.limitations.clone(),
                methodology_binding_id: b.methodology_binding_id.clone(),
                execution_epoch: b.execution_epoch.to_string(),
            })
            .collect(),
        criteria: view
            .criteria
            .iter()
            .map(|c| {
                let (requirement_id, criterion_ordinal, authority_source) =
                    match &c.criterion.authority {
                        Authority::Method {
                            requirement_id,
                            criterion_ordinal,
                        } => (Some(requirement_id.clone()), Some(*criterion_ordinal), None),
                        Authority::Original(source) => (
                            None,
                            None,
                            Some(verified_source(
                                &zobba_domain::citation::VerifiedSource {
                                    source: source.clone(),
                                    original_sha256: c.authority.original_sha256.clone(),
                                    verification: if c.authority.verified {
                                        Verification::Verified
                                    } else {
                                        Verification::Unverified(match c.authority.reason {
                                            Some(AuthorityReason::LocationMissing) => {
                                                UnverifiedReason::LocationMissing
                                            }
                                            Some(AuthorityReason::SourceUnreadable) => {
                                                UnverifiedReason::SourceUnreadable
                                            }
                                            Some(AuthorityReason::PageOnly) => {
                                                UnverifiedReason::PageOnly
                                            }
                                            _ => UnverifiedReason::NotFoundAtLocation,
                                        })
                                    },
                                },
                                originals,
                            )),
                        ),
                    };
                AssessmentCriterionResponse {
                    id: c.id.clone(),
                    invocation_id: c.invocation_id.clone(),
                    key: c.criterion.key.clone(),
                    supersedes: c.criterion.supersedes.clone(),
                    assertion: c.criterion.assertion.clone(),
                    kind: c.criterion.method.kind().as_str().into(),
                    authority_kind: c.criterion.authority.kind().as_str().into(),
                    authority_verified: c.authority.verified,
                    authority_reason: c.authority.reason.map(|r| r.as_str().into()),
                    requirement_id,
                    criterion_ordinal,
                    authority_text_sha256: c.authority.text_sha256.clone(),
                    authority_source,
                    effective_from: c.criterion.effective_from.map(|d| d.render()),
                    effective_to: c.criterion.effective_to.map(|d| d.render()),
                    applicability: c.criterion.applicability.as_ref().map(|p| p.describe()),
                    rule: match &c.criterion.method {
                        CriterionMethod::Rule(p) => Some(p.describe()),
                        CriterionMethod::Judgment { .. } => None,
                    },
                    rubric: match &c.criterion.method {
                        CriterionMethod::Judgment { rubric } => Some(rubric.clone()),
                        CriterionMethod::Rule(_) => None,
                    },
                    required_facts: c
                        .criterion
                        .required_facts
                        .iter()
                        .map(|r| RequiredFactResponse {
                            name: r.name.clone(),
                            fact_type: r.kind.as_str().into(),
                            measure: measure(r.measure.as_ref()),
                        })
                        .collect(),
                    methodology_binding_id: c.methodology_binding_id.clone(),
                    execution_epoch: c.execution_epoch.to_string(),
                }
            })
            .collect(),
        facts: view
            .facts
            .iter()
            .map(|f| {
                let (
                    value_kind,
                    value,
                    measure_label,
                    mantissa,
                    scale,
                    utc,
                    offset,
                    reason,
                    candidates,
                ) = match &f.fact.state {
                    FactState::Value(v) => {
                        let (mantissa, scale) = match v {
                            FactValue::Decimal { value, .. } => (
                                Some(value.mantissa.to_string()),
                                Some(u32::from(value.scale)),
                            ),
                            _ => (None, None),
                        };
                        let (utc, offset) = match v {
                            FactValue::Instant(i) => {
                                (Some(i.render_utc()), Some(i32::from(i.offset_minutes)))
                            }
                            _ => (None, None),
                        };
                        (
                            v.kind().as_str().to_string(),
                            Some(v.text()),
                            measure(v.measure()),
                            mantissa,
                            scale,
                            utc,
                            offset,
                            None,
                            None,
                        )
                    }
                    FactState::Unavailable(r) => (
                        "unavailable".into(),
                        None,
                        None,
                        None,
                        None,
                        None,
                        None,
                        Some(r.as_str().to_string()),
                        None,
                    ),
                    FactState::Ambiguous { candidates } => (
                        "ambiguous".into(),
                        None,
                        None,
                        None,
                        None,
                        None,
                        None,
                        None,
                        Some(*candidates),
                    ),
                };
                // The value is read from the source quote: it is shown only
                // when one of its sources is an exact original the viewer
                // may read now (21.6: knowledge never grants the original).
                let valued = value.is_some();
                let readable = f.sources.iter().any(|s| {
                    crate::answers::exact_original(
                        originals,
                        &s.source.original_id,
                        s.original_sha256.as_deref(),
                    )
                    .is_some()
                });
                let withheld = valued && !readable;
                let (value, mantissa, scale, utc, offset) = if withheld {
                    (None, None, None, None, None)
                } else {
                    (value, mantissa, scale, utc, offset)
                };
                AssessmentFactResponse {
                    id: f.id.clone(),
                    invocation_id: f.invocation_id.clone(),
                    basis_id: f.basis_id.clone(),
                    subject: f.fact.subject.clone(),
                    subject_unit: f.fact.subject_unit.clone(),
                    name: f.fact.name.clone(),
                    value_kind,
                    value_withheld: withheld,
                    value,
                    measure: measure_label,
                    mantissa,
                    scale,
                    utc,
                    offset_minutes: offset,
                    unavailable_reason: reason,
                    candidates,
                    rule: f.fact.rule.map(|r| r.as_str().into()),
                    support: f.support.as_str().into(),
                    support_reason: f.support.reason().map(|r| r.as_str().into()),
                    subject_grounded: f.grounding.subject,
                    measure_grounded: f.grounding.measure,
                    job_id: f.fact.job_id.clone(),
                    sources: f
                        .sources
                        .iter()
                        .map(|s| verified_source(s, originals))
                        .collect(),
                    methodology_binding_id: f.methodology_binding_id.clone(),
                    execution_epoch: f.execution_epoch.to_string(),
                }
            })
            .collect(),
        evaluations: view
            .evaluations
            .iter()
            .map(|e| AssessmentEvaluationResponse {
                id: e.id.clone(),
                invocation_id: e.invocation_id.clone(),
                basis_id: e.basis_id.clone(),
                criterion_id: e.criterion_id.clone(),
                subject: e.subject.clone(),
                applicability: e.outcome.applicability.as_str().into(),
                execution: e.outcome.execution.as_str().into(),
                verdict: e.outcome.verdict.map(|v| v.as_str().into()),
                reason: e.outcome.reason.map(|r| r.as_str().into()),
                origin: e.outcome.origin.as_str().into(),
                inputs: e
                    .outcome
                    .inputs
                    .iter()
                    .map(|(id, digest)| EvaluationInputResponse {
                        fact_id: id.clone(),
                        digest: digest.clone(),
                    })
                    .collect(),
                output_digest: e.output_digest.clone(),
                judgment: e.judgment.as_ref().map(|j| JudgmentResponse {
                    supporting: j.supporting.clone(),
                    contrary: j.contrary.clone(),
                    rationale: j.rationale.clone(),
                    uncertainty: j.uncertainty.clone(),
                }),
                methodology_binding_id: e.methodology_binding_id.clone(),
                execution_epoch: e.execution_epoch.to_string(),
            })
            .collect(),
    }
}

fn compaction(record: CompactionSummary) -> CompactionResponse {
    CompactionResponse {
        sequence: record.sequence,
        first_ordinal: record.first_ordinal,
        last_ordinal: record.last_ordinal,
        digest_sha256: record.digest_sha256,
        sources: record
            .sources
            .into_iter()
            .map(|source| CompactionSourceResponse {
                id: source.id,
                revision: source.revision.to_string(),
                status: match source.status {
                    SourceStatus::Current => SourceStatusResponse::Current,
                    SourceStatus::Withdrawn => SourceStatusResponse::Withdrawn,
                    SourceStatus::Corrected => SourceStatusResponse::Corrected,
                    SourceStatus::Invalidated => SourceStatusResponse::Invalidated,
                },
            })
            .collect(),
        omissions: record
            .omissions
            .into_iter()
            .map(|(category, count)| OmissionResponse {
                category: match category {
                    OmissionCategory::StepsCompacted => OmissionCategoryResponse::StepsCompacted,
                    OmissionCategory::DigestsOmitted => OmissionCategoryResponse::DigestsOmitted,
                    OmissionCategory::KnowledgeBudget => OmissionCategoryResponse::KnowledgeBudget,
                    OmissionCategory::KnowledgeUnusable => {
                        OmissionCategoryResponse::KnowledgeUnusable
                    }
                    OmissionCategory::StaleSources => OmissionCategoryResponse::StaleSources,
                    OmissionCategory::StaleContent => OmissionCategoryResponse::StaleContent,
                    OmissionCategory::SkillsBudget => OmissionCategoryResponse::SkillsBudget,
                },
                count,
            })
            .collect(),
        estimated_tokens: record.estimated_tokens.to_string(),
        created_at: record.created_at.max(0).to_string(),
    }
}

fn step(step: TaskStep) -> TaskStepResponse {
    TaskStepResponse {
        ordinal: step.ordinal,
        kind: match step.kind {
            StepKind::ModelTurn => StepKindResponse::ModelTurn,
            StepKind::ToolStep => StepKindResponse::ToolStep,
        },
        status: match step.status {
            StepStatus::Proposed => StepStatusResponse::Proposed,
            StepStatus::Responded => StepStatusResponse::Responded,
            StepStatus::Superseded => StepStatusResponse::Superseded,
            StepStatus::Failed => StepStatusResponse::Failed,
            StepStatus::Completed => StepStatusResponse::Completed,
            StepStatus::Refused => StepStatusResponse::Refused,
            StepStatus::ReconciliationRequired => StepStatusResponse::ReconciliationRequired,
        },
        intent_revision: step.intent_revision.to_string(),
        execution_epoch: step.execution_epoch.to_string(),
        invocation_id: step.invocation_id,
        operation_id: step.operation_id,
        next_action: step.next_action.as_ref().map(NextAction::descriptor),
        current_work: step.current_work,
        knowledge_omitted: step.knowledge_omitted,
        reason: step.reason.map(|reason| match reason {
            StepReason::ContextBudget => StepReasonResponse::ContextBudget,
        }),
        estimated_input_tokens: step.estimated_input_tokens.map(|v| v.to_string()),
        actual_input_tokens: step.actual_input_tokens.map(|v| v.to_string()),
    }
}

fn brief(brief: BriefRevision) -> BriefRevisionResponse {
    BriefRevisionResponse {
        command_id: brief.command_id,
        cycle_id: brief.cycle_id,
        content: brief.content,
        received_cursor: brief.received_cursor.to_string(),
        applied_boundary: brief.applied_boundary,
        applied_cursor: brief.applied_cursor.map(|v| v.to_string()),
        superseded_by: brief.superseded_by,
    }
}

fn work_response(
    work: TaskWork,
    model_available: bool,
    view: Option<zobba_infrastructure::investigation::InvestigationView>,
    investigation_unavailable: bool,
    assessed: Option<AssessmentResponse>,
    assessment_unavailable: bool,
) -> TaskWorkResponse {
    let questions = view.as_ref().map_or(0, |view| view.open_questions.len());
    let attention = match work.attention {
        None | Some(Attention::AwaitingGuidance) if questions > 0 => {
            Some(AttentionResponse::MethodQuestion)
        }
        attention => attention.map(|attention| match attention {
            Attention::AwaitingGuidance => AttentionResponse::AwaitingGuidance,
            Attention::ReconciliationRequired => AttentionResponse::ReconciliationRequired,
            Attention::StepFailed => AttentionResponse::StepFailed,
            Attention::CycleBounded => AttentionResponse::CycleBounded,
        }),
    };
    TaskWorkResponse {
        investigation: view.map(investigation),
        investigation_unavailable,
        assessment: assessed,
        assessment_unavailable,
        task_id: work.task_id,
        cycle_id: work.cycle_id,
        model_available,
        methodology_binding_id: work.methodology_binding_id,
        methodology_status: work.methodology_status,
        current_work: work.current_work,
        next_action: work.next_action.as_ref().map(NextAction::descriptor),
        next_action_invocation_id: work.next_action_invocation_id,
        attention,
        steps: work.steps.into_iter().map(step).collect(),
        total_steps: work.total_steps,
        briefs: work.briefs.into_iter().map(brief).collect(),
        compactions: work.compactions.into_iter().map(compaction).collect(),
        total_compactions: work.total_compactions,
    }
}

#[utoipa::path(get,path="/engagements/{engagement_id}/tasks/{task_id}/work",operation_id="get_task_work",security(("server_session"=[])),
    params(("X-Expected-Session"=Option<String>,Header,description="Optional session-bound read precondition from the in-memory session CSRF token; mismatch refuses without changing the cookie",min_length=1,max_length=128),("engagement_id"=String,Path),("task_id"=String,Path),("organisation_id"=String,Query),("client_id"=String,Query)),
    responses((status=412,description="Session changed",body=ErrorResponse),(status=200,description="Recorded work facts for the Task card; a waiting Task is not a completed objective",body=TaskWorkResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn get_work(
    State(state): State<TaskHttpState>,
    headers: HeaderMap,
    Path((engagement_id, task_id)): Path<(String, String)>,
    query: Result<Query<TaskScopeQuery>, axum::extract::rejection::QueryRejection>,
) -> Response {
    let current = match state.identity.current_read(&headers).await {
        Ok(current) => current,
        Err(error) => return crate::auth::failure(error),
    };
    let scope = match query
        .map_err(|_| TaskError::Denied)
        .and_then(|Query(query)| query.scope(engagement_id))
    {
        Ok(scope) => scope,
        Err(error) => return failure(error),
    };
    if !valid_scope_id(&task_id) {
        return failure(TaskError::Denied);
    }
    let work = match state
        .repository
        .work(&current.identity.id, &scope, &task_id)
        .await
    {
        Ok(work) => work,
        Err(error) => return failure(error),
    };
    let model_available = match &state.models {
        Some(models) => matches!(
            models.selection(&current.identity.id, &scope).await,
            Ok(Some(_))
        ),
        None => false,
    };
    // An investigation read failure never fails the work view: the facts are
    // left out and a fixed marker says they could not be read.
    let (view, investigation_unavailable) = match &state.investigations {
        Some(investigations) => match investigations
            .view(&current.identity.id, &scope, &task_id)
            .await
        {
            Ok(view) => (Some(view), false),
            Err(_) => (None, true),
        },
        None => (None, false),
    };
    // The same rule for assessment records: a read failure leaves them out
    // with a fixed marker. Source quotes, filenames and versions are shown
    // only for an exact original the viewer may read now.
    let (assessed, assessment_unavailable) = match (&state.assessments, &state.answers) {
        (Some(assessments), Some((citations, _))) => {
            match assessments
                .view(&current.identity.id, &scope, &task_id)
                .await
            {
                Ok(snapshot) => {
                    let ids = assessment_originals(&snapshot);
                    match citations
                        .viewer_originals(&current.identity.id, &scope, &ids)
                        .await
                    {
                        Ok(originals) => (Some(assessment(snapshot, &originals)), false),
                        Err(_) => (None, true),
                    }
                }
                Err(_) => (None, true),
            }
        }
        _ => (None, false),
    };
    Json(work_response(
        work,
        model_available,
        view,
        investigation_unavailable,
        assessed,
        assessment_unavailable,
    ))
    .into_response()
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct DirectionRequest {
    /// Author and scope bind this key. Identical retries return the original outcome.
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub key: String,
    /// Exact retained guidance text, at most 4000 UTF-8 bytes.
    #[schema(min_length = 1, max_length = 4000)]
    pub content: String,
}

#[derive(Serialize, ToSchema)]
pub struct RoutingCandidateResponse {
    pub task_id: String,
    pub cycle_id: String,
    pub objective: String,
}

#[derive(Serialize, ToSchema)]
pub struct RoutedGuideResponse {
    pub task_id: String,
    pub cycle_id: String,
    pub command_id: String,
    #[schema(pattern = "^[0-9]+$")]
    pub event_cursor: String,
}

/// A durable targeting question. Nothing is applied until it is answered.
#[derive(Serialize, ToSchema)]
pub struct RoutingQuestionResponse {
    pub id: String,
    pub key: String,
    pub content: String,
    #[schema(max_items = 100)]
    pub candidates: Vec<RoutingCandidateResponse>,
    /// One Guide receipt per selected target, once answered.
    #[schema(required = true)]
    pub answer: Option<Vec<RoutedGuideResponse>>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DirectionOutcome {
    Routed,
    Asked,
}

#[derive(Serialize, ToSchema)]
pub struct DirectionResponse {
    pub outcome: DirectionOutcome,
    /// Present when exactly one Task received the direction as Guidance.
    #[schema(required = true)]
    pub receipt: Option<CommandReceiptResponse>,
    /// Present when two or more Tasks could receive it.
    #[schema(required = true)]
    pub question: Option<RoutingQuestionResponse>,
}

#[derive(Serialize, ToSchema)]
pub struct RoutingQuestionsResponse {
    #[schema(max_items = 20)]
    pub questions: Vec<RoutingQuestionResponse>,
    /// More (older) questions exist beyond this page.
    pub has_more: bool,
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct AnswerRequest {
    /// Candidate Task IDs from the question; at least one.
    #[schema(min_items = 1, max_items = 100)]
    pub selected: Vec<String>,
}

fn guide(guide: RoutedGuide) -> RoutedGuideResponse {
    RoutedGuideResponse {
        task_id: guide.task_id,
        cycle_id: guide.cycle_id,
        command_id: guide.command_id,
        event_cursor: guide.event_cursor,
    }
}

fn question(question: RoutingQuestion) -> RoutingQuestionResponse {
    RoutingQuestionResponse {
        id: question.id,
        key: question.key,
        content: question.content,
        candidates: question
            .candidates
            .into_iter()
            .map(|c| RoutingCandidateResponse {
                task_id: c.task_id,
                cycle_id: c.cycle_id,
                objective: c.objective,
            })
            .collect(),
        answer: question
            .answer
            .map(|guides| guides.into_iter().map(guide).collect()),
    }
}

/// Session, actor fence, CSRF and scope for a control-lane mutation.
async fn mutation(
    state: &TaskHttpState,
    headers: &HeaderMap,
    engagement_id: String,
    query: Result<Query<TaskScopeQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<(String, zobba_domain::identity::Scope, String), Box<Response>> {
    let current = state
        .identity
        .current(headers)
        .await
        .map_err(|error| Box::new(crate::auth::failure(error)))?;
    let mut expected = headers.get_all("x-expected-actor").iter();
    if let Some(value) = expected.next()
        && (expected.next().is_some()
            || value
                .to_str()
                .ok()
                .is_none_or(|actor| !valid_scope_id(actor) || actor != current.identity.id))
    {
        return Err(Box::new(failure(TaskError::Denied)));
    }
    if !state
        .identity
        .permits_mutation(headers, &current.csrf_token)
    {
        return Err(Box::new(failure(TaskError::Denied)));
    }
    let scope = query
        .map_err(|_| TaskError::Denied)
        .and_then(|Query(query)| query.scope(engagement_id))
        .map_err(|error| Box::new(failure(error)))?;
    let token = crate::auth::cookie(headers, crate::auth::SESSION_COOKIE)
        .ok_or_else(|| Box::new(failure(TaskError::Denied)))?;
    Ok((
        current.identity.id,
        scope,
        zobba_infrastructure::identity::secret_hash(&token),
    ))
}

#[utoipa::path(post,path="/engagements/{engagement_id}/task-directions",operation_id="admit_task_direction",security(("server_session"=[])),
    params(
        ("engagement_id"=String,Path,min_length=1,max_length=128,pattern="^[A-Za-z0-9_-]+$"),
        ("organisation_id"=String,Query,min_length=1,max_length=128,pattern="^[A-Za-z0-9_-]+$"),
        ("client_id"=String,Query,min_length=1,max_length=128,pattern="^[A-Za-z0-9_-]+$"),
        ("Origin"=String,Header,description="Exact configured HTTPS application origin"),
        ("X-CSRF-Token"=String,Header,description="Current session-bound token")
        ,("X-Expected-Actor"=Option<String>,Header,description="Optional additional refusal fence",min_length=1,max_length=128,pattern="^[A-Za-z0-9_-]+$")
    ),request_body=DirectionRequest,
    responses((status=202,description="Reserved lane. Routed to the only open Task that accepts guidance, or a durable targeting question; never routed by a model",body=DirectionResponse),(status=400,body=ErrorResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=409,description="No Task can receive guidance, or the key was reused with different text",body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn direct(
    State(state): State<TaskHttpState>,
    headers: HeaderMap,
    Path(engagement_id): Path<String>,
    query: Result<Query<TaskScopeQuery>, axum::extract::rejection::QueryRejection>,
    body: Result<Json<DirectionRequest>, JsonRejection>,
) -> Response {
    let (actor, scope, session) = match mutation(&state, &headers, engagement_id, query).await {
        Ok(context) => context,
        Err(response) => return *response,
    };
    let Ok(Json(body)) = body else {
        return failure(TaskError::Invalid);
    };
    match state
        .repository
        .clone()
        .with_session_hash(session)
        .direct(&actor, &scope, &body.key, &body.content)
        .await
    {
        Ok(Direction::Routed(receipt)) => (
            StatusCode::ACCEPTED,
            Json(DirectionResponse {
                outcome: DirectionOutcome::Routed,
                receipt: Some(receipt.into()),
                question: None,
            }),
        )
            .into_response(),
        Ok(Direction::Asked(asked)) => (
            StatusCode::ACCEPTED,
            Json(DirectionResponse {
                outcome: DirectionOutcome::Asked,
                receipt: None,
                question: Some(question(asked)),
            }),
        )
            .into_response(),
        Err(error) => failure(error),
    }
}

#[utoipa::path(get,path="/engagements/{engagement_id}/task-questions",operation_id="list_task_questions",security(("server_session"=[])),
    params(("X-Expected-Session"=Option<String>,Header,description="Optional session-bound read precondition",min_length=1,max_length=128),("engagement_id"=String,Path),("organisation_id"=String,Query),("client_id"=String,Query)),
    responses((status=412,description="Session changed",body=ErrorResponse),(status=200,description="The caller's most recent targeting questions, newest first",body=RoutingQuestionsResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn questions(
    State(state): State<TaskHttpState>,
    headers: HeaderMap,
    Path(engagement_id): Path<String>,
    query: Result<Query<TaskScopeQuery>, axum::extract::rejection::QueryRejection>,
) -> Response {
    let current = match state.identity.current_read(&headers).await {
        Ok(current) => current,
        Err(error) => return crate::auth::failure(error),
    };
    let scope = match query
        .map_err(|_| TaskError::Denied)
        .and_then(|Query(query)| query.scope(engagement_id))
    {
        Ok(scope) => scope,
        Err(error) => return failure(error),
    };
    match state
        .repository
        .questions(&current.identity.id, &scope)
        .await
    {
        Ok((found, has_more)) => Json(RoutingQuestionsResponse {
            questions: found.into_iter().map(question).collect(),
            has_more,
        })
        .into_response(),
        Err(error) => failure(error),
    }
}

#[utoipa::path(post,path="/engagements/{engagement_id}/task-questions/{question_id}/answer",operation_id="answer_task_question",security(("server_session"=[])),
    params(
        ("engagement_id"=String,Path,min_length=1,max_length=128,pattern="^[A-Za-z0-9_-]+$"),
        ("question_id"=String,Path,min_length=1,max_length=128,pattern="^[A-Za-z0-9_-]+$"),
        ("organisation_id"=String,Query,min_length=1,max_length=128,pattern="^[A-Za-z0-9_-]+$"),
        ("client_id"=String,Query,min_length=1,max_length=128,pattern="^[A-Za-z0-9_-]+$"),
        ("Origin"=String,Header,description="Exact configured HTTPS application origin"),
        ("X-CSRF-Token"=String,Header,description="Current session-bound token")
        ,("X-Expected-Actor"=Option<String>,Header,description="Optional additional refusal fence",min_length=1,max_length=128,pattern="^[A-Za-z0-9_-]+$")
    ),request_body=AnswerRequest,
    responses((status=202,description="One Guide per selected target with a derived key; an identical retry returns the same receipts",body=RoutingQuestionResponse),(status=400,body=ErrorResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=409,description="A selected Task is stale, foreign, or the question was answered differently",body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn answer(
    State(state): State<TaskHttpState>,
    headers: HeaderMap,
    Path((engagement_id, question_id)): Path<(String, String)>,
    query: Result<Query<TaskScopeQuery>, axum::extract::rejection::QueryRejection>,
    body: Result<Json<AnswerRequest>, JsonRejection>,
) -> Response {
    let (actor, scope, session) = match mutation(&state, &headers, engagement_id, query).await {
        Ok(context) => context,
        Err(response) => return *response,
    };
    let Ok(Json(body)) = body else {
        return failure(TaskError::Invalid);
    };
    if body.selected.is_empty() || body.selected.len() > zobba_domain::work::MAX_ROUTING_CANDIDATES
    {
        return failure(TaskError::Invalid);
    }
    match state
        .repository
        .clone()
        .with_session_hash(session)
        .answer(&actor, &scope, &question_id, &body.selected)
        .await
    {
        Ok(answered) => (StatusCode::ACCEPTED, Json(question(answered))).into_response(),
        Err(error) => failure(error),
    }
}
