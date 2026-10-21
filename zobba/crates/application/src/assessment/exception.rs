//! Story 24.3b: Task-scoped exceptions and the effective summary.
//!
//! Every not_met result becomes an immutable occurrence of its exception,
//! written by trusted database code in the statement that records the
//! result. An exception's status is derived, never stored
//! (`zobba_domain::exception::exception_status`). When the agent asks
//! `summarise_effective`, trusted code reruns the 24.2 count over the current
//! chain heads and dispositions, counts the exceptions of the basis's
//! criterion lineages by derived status, and the database recounts every
//! number. The model never counts, never writes an exception or a status and
//! never disposes of one: exception dispositions are a person's, through the
//! authenticated API (`crate::exception`).
use std::{
    collections::{BTreeMap, BTreeSet},
    future::Future,
};

use super::{
    Assessment, AssessmentStore, BasisRecord, Map, as_obj, document_digest, envelope_from, get_opt,
    get_str, int, obj, opt, record_id, s, turn_basis,
};
use crate::{
    citation::{CitationReader, ReadingError},
    investigation::bounded,
    model::Invocation,
};
use zobba_domain::{
    assessment::CriterionKind,
    citation::{CitationSource, CitedAnswer},
    coverage::Disposition,
    exception::{
        EffectiveCriterion, EffectiveOpportunity, EffectiveSummary, ExceptionDispositionRequest,
        ExceptionEntry, ExceptionStatus, LatestObserved, OccurrenceSource, effective_from,
        exception_disposition_document, exception_disposition_from, status_words,
        summarise_effective,
    },
    model::JsonValue,
    revision::EffectiveOrigin,
    task::ClaimBasis,
};

/// Effective summaries the outline lists; the rest are counted.
pub const MAX_OUTLINE_EFFECTIVE: usize = 16;

/// One exception as trusted code recorded it (its status is derived).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExceptionRecord {
    pub id: String,
    pub task_id: String,
    pub actor_id: String,
    pub criterion_root: String,
    pub subject: String,
    pub first_source_kind: OccurrenceSource,
    pub first_source_id: String,
    pub recorded_us: Option<i64>,
}

/// One occurrence of an exception: a not_met result.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OccurrenceRecord {
    pub exception_id: String,
    pub source_kind: OccurrenceSource,
    pub source_id: String,
    pub population_id: Option<String>,
    pub member_ordinal: Option<u32>,
    pub criterion_id: String,
    pub basis_id: String,
    pub origin: EffectiveOrigin,
    pub evidence: Vec<String>,
    pub source_us: i64,
    pub actor_id: String,
}

/// A stored exception disposition: who decided what about one exception.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExceptionDispositionRecord {
    pub id: String,
    pub task_id: String,
    pub actor_id: String,
    pub request: ExceptionDispositionRequest,
    /// Each reference with the exact original digest it was verified against.
    pub references: Vec<(CitationSource, String)>,
    pub digest: String,
    pub recorded_us: Option<i64>,
}
impl ExceptionDispositionRecord {
    pub fn document(&self) -> JsonValue {
        exception_disposition_document(
            &self.id,
            &self.task_id,
            &self.actor_id,
            &self.request,
            &self.references,
        )
    }
    pub fn from_document(document: &JsonValue, recorded_us: Option<i64>) -> Option<Self> {
        let map: &Map = as_obj(document)?;
        let (request, references) = exception_disposition_from(document)?;
        let record = Self {
            id: get_str(map, "id")?.into(),
            task_id: get_str(map, "task_id")?.into(),
            actor_id: get_str(map, "actor_id")?.into(),
            request,
            references,
            digest: document_digest(document),
            recorded_us,
        };
        (record.document() == *document).then_some(record)
    }
}

/// One exception with its derived status, for a viewer or the panel.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExceptionView {
    pub record: ExceptionRecord,
    pub status: ExceptionStatus,
    pub latest_observed: LatestObserved,
    /// Exact number of its occurrences.
    pub occurrences: u64,
    /// Its newest disposition and the person's public label.
    pub disposition: Option<(ExceptionDispositionRecord, String)>,
}

/// An immutable effective summary version.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EffectiveSummaryRecord {
    pub id: String,
    pub task_id: String,
    pub cycle_id: String,
    pub invocation_id: String,
    pub ordinal: u32,
    pub methodology_binding_id: String,
    pub execution_epoch: u64,
    pub basis_id: String,
    pub population_id: String,
    pub sample_id: Option<String>,
    /// The newest effective summary of the same population and sample when
    /// this one was recorded.
    pub supersedes: Option<String>,
    pub effective: EffectiveSummary,
    /// The canonical digest of `effective.document()`.
    pub summary_digest: String,
    pub digest: String,
    pub recorded_us: Option<i64>,
}
impl EffectiveSummaryRecord {
    pub fn document(&self) -> JsonValue {
        let mut fields = envelope_doc!("effective_summary", self);
        fields.extend([
            ("basis_id", s(&self.basis_id)),
            ("population_id", s(&self.population_id)),
            ("sample_id", opt(self.sample_id.as_deref())),
            ("supersedes", opt(self.supersedes.as_deref())),
            ("effective", self.effective.document()),
            ("summary_digest", s(&self.summary_digest)),
        ]);
        obj(fields)
    }
    pub fn from_document(document: &JsonValue, recorded_us: Option<i64>) -> Option<Self> {
        let map = as_obj(document)?;
        let e = envelope_from(map, "effective_summary")?;
        let effective_map = as_obj(map.get("effective")?)?;
        let summary = super::coverage::summary_from(as_obj(effective_map.get("summary")?)?)?;
        let effective = effective_from(effective_map, summary)?;
        let record = Self {
            id: e.id,
            task_id: e.task_id,
            cycle_id: e.cycle_id,
            invocation_id: e.invocation_id,
            ordinal: e.ordinal,
            methodology_binding_id: e.binding,
            execution_epoch: e.epoch,
            basis_id: get_str(map, "basis_id")?.into(),
            population_id: get_str(map, "population_id")?.into(),
            sample_id: get_opt(map, "sample_id")?,
            supersedes: get_opt(map, "supersedes")?,
            summary_digest: get_str(map, "summary_digest")?.into(),
            effective,
            digest: document_digest(document),
            recorded_us,
        };
        (record.summary_digest == record.effective.digest() && record.document() == *document)
            .then_some(record)
    }
}

/// The effective outcome of one opportunity of a population.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EffectiveRow {
    pub criterion_id: String,
    pub opportunity: EffectiveOpportunity,
}

/// The effective outcome of one opportunity: a judgment opportunity resolves
/// to its chain head under the head's newest disposition, a rule
/// opportunity is itself. `superseded` says the head reads a basis version a
/// later version supersedes. The database derives the same row
/// (`assessment_effective_outcomes`) and recounts from it.
pub fn effective_row(
    opportunity: &super::coverage::OpportunityRecord,
    head: Option<&super::revision::ChainHead>,
    superseded: bool,
) -> EffectiveRow {
    let row = |outcome: &zobba_domain::assessment::Outcome,
               decision: Option<zobba_domain::revision::Decision>,
               superseded: bool| {
        let effective = zobba_domain::revision::effective(outcome, decision);
        EffectiveRow {
            criterion_id: opportunity.criterion_id.clone(),
            opportunity: EffectiveOpportunity {
                subject: opportunity.subject.clone(),
                verdict: effective.verdict,
                applicability: outcome.applicability,
                execution: outcome.execution,
                reason: if effective.review == zobba_domain::revision::ReviewState::Replaced {
                    None
                } else {
                    outcome.reason
                },
                origin: effective.origin,
                review: effective.review,
                superseded,
            },
        }
    };
    match head {
        Some(head) if opportunity.evaluation_id.is_some() => row(
            head.outcome(),
            head.disposition
                .as_ref()
                .map(|d| zobba_domain::revision::Decision {
                    kind: d.request.kind,
                    verdict: d.request.verdict,
                }),
            superseded,
        ),
        _ => row(&opportunity.outcome, None, false),
    }
}

/// The Task's exception and effective-summary state for the outline.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ExceptionSnapshot {
    /// Newest effective summaries (oldest first) and the exact total.
    pub summaries: Vec<EffectiveSummaryRecord>,
    pub total_summaries: u64,
    /// Per basis version: exact counts of the exceptions of its criterion
    /// lineages by derived status (open, resolved, replaced, closed).
    pub bases: BTreeMap<String, [u64; 4]>,
}

/// Durable exception and effective-summary records under the exact claim
/// producer's custody. Exact checks use exact queries.
pub trait ExceptionStore: Send + Sync {
    fn invocation_effective(
        &self,
        basis: &ClaimBasis,
        invocation_id: &str,
    ) -> impl Future<Output = Result<Vec<EffectiveSummaryRecord>, ReadingError>> + Send;
    /// The effective outcome of every opportunity of one population (exact):
    /// a judgment opportunity resolved to its chain head under the head's
    /// newest disposition, a rule opportunity as itself.
    fn effective_outcomes(
        &self,
        basis: &ClaimBasis,
        population_id: &str,
    ) -> impl Future<Output = Result<Vec<EffectiveRow>, ReadingError>> + Send;
    /// The distinct lineage roots of these criterion versions of this Task.
    fn criterion_roots(
        &self,
        basis: &ClaimBasis,
        criterion_ids: &[String],
    ) -> impl Future<Output = Result<Vec<String>, ReadingError>> + Send;
    /// Every exception of this Task under these criterion lineages, with its
    /// derived status (an exact read).
    fn exception_entries(
        &self,
        basis: &ClaimBasis,
        roots: &[String],
    ) -> impl Future<Output = Result<Vec<ExceptionEntry>, ReadingError>> + Send;
    /// The newest effective summary of a population and sample.
    fn newest_effective(
        &self,
        basis: &ClaimBasis,
        population_id: &str,
        sample_id: Option<&str>,
    ) -> impl Future<Output = Result<Option<EffectiveSummaryRecord>, ReadingError>> + Send;
    fn record_effective(
        &self,
        basis: &ClaimBasis,
        record: &EffectiveSummaryRecord,
    ) -> impl Future<Output = Result<EffectiveSummaryRecord, ReadingError>> + Send;
    fn exception_snapshot(
        &self,
        basis: &ClaimBasis,
    ) -> impl Future<Output = Result<ExceptionSnapshot, ReadingError>> + Send;
}

// ---------------------------------------------------------------- lines

/// How an effective summary is said: never a count as a total when the
/// population is incomplete.
pub fn effective_line(record: &EffectiveSummaryRecord) -> String {
    let e = &record.effective;
    let m = &e.summary;
    let p = &m.partition;
    let exact = e.exact();
    let n = |v: u64| {
        if exact {
            v.to_string()
        } else {
            format!("at least {v}")
        }
    };
    let x = &e.exceptions;
    format!(
        "Effective summary {} of population {}{}: conclusion {}; subjects failing {} · meeting every applicable criterion {} · unresolved {} · not applicable to any {}; failing opportunities {} (not records); exceptions {} ({} open · {} resolved by evidence · {} replaced by human judgment · {} closed by disposition) over {} distinct subjects{}{}",
        record.id,
        record.population_id,
        record
            .sample_id
            .as_deref()
            .map(|s| format!(" over the selected items of sample {s}"))
            .unwrap_or_default(),
        m.conclusion.as_str(),
        n(p.failing),
        n(p.meets_every_applicable),
        n(p.unresolved),
        n(p.not_applicable_to_any),
        n(m.failing_opportunities),
        x.total,
        x.open,
        x.resolved_by_evidence,
        x.replaced_by_human_judgment,
        x.closed_by_disposition,
        x.subjects,
        if exact {
            ""
        } else {
            "; the total is not known"
        },
        if e.limitations.is_empty() {
            ".".to_string()
        } else {
            format!(
                ". Limitations: {}",
                e.limitations
                    .iter()
                    .map(|l| l.words(exact))
                    .collect::<Vec<_>>()
                    .join(" ")
            )
        }
    )
}

/// The outline lines: exact exception counts per basis version and the
/// newest effective summaries.
pub fn exception_lines(snapshot: &ExceptionSnapshot) -> Vec<String> {
    let mut lines: Vec<String> = snapshot
        .bases
        .iter()
        .map(|(basis_id, [open, resolved, replaced, closed])| {
            format!(
                "- exceptions under basis {basis_id}: {open} open · {resolved} resolved by evidence · {replaced} replaced by human judgment · {closed} closed by disposition"
            )
        })
        .collect();
    for s in snapshot.summaries.iter().take(MAX_OUTLINE_EFFECTIVE) {
        lines.push(format!("- {}", bounded(&effective_line(s), 1200)));
    }
    lines
}

/// What becomes of an exception's status, in words (for the panel and API).
pub fn exception_words(view: &ExceptionView) -> String {
    status_words(view.status, view.latest_observed)
}

// --------------------------------------------------------------- service

impl<S, C> Assessment<'_, S, C>
where
    S: AssessmentStore
        + super::coverage::CoverageStore
        + super::revision::RevisionStore
        + ExceptionStore,
    C: CitationReader,
{
    /// Step: effective summaries. Trusted code reruns the 24.2 partition
    /// over the current revisions and dispositions; an unchanged result
    /// records nothing.
    #[allow(clippy::too_many_arguments)]
    pub(super) async fn effective_summarise(
        &self,
        basis: &ClaimBasis,
        invocation: &Invocation,
        answer: &CitedAnswer,
        answer_basis: &Option<BasisRecord>,
        existing: &[EffectiveSummaryRecord],
        coverage: &mut super::coverage::AnswerCoverage,
        feedback: &mut Vec<String>,
    ) -> Result<bool, ReadingError> {
        let mut progress = false;
        for (ordinal, request) in answer.summarise_effective.iter().enumerate() {
            let ordinal = ordinal as u32;
            if let Some(found) = existing.iter().find(|s| s.ordinal == ordinal) {
                feedback.push(effective_line(found));
                continue;
            }
            let Some(population) = self
                .population_ref(basis, coverage, &request.population)
                .await?
            else {
                feedback.push(format!(
                    "No effective summary of {} was recorded: it is not a population of this Task.",
                    request.population
                ));
                continue;
            };
            let basis_matches = population.basis_id == request.basis
                || answer_basis
                    .as_ref()
                    .is_some_and(|b| b.id == population.basis_id && b.basis.key == request.basis);
            if !basis_matches {
                feedback.push(format!(
                    "No effective summary of population {} was recorded: it belongs to basis {}, not {}.",
                    population.id, population.basis_id, request.basis
                ));
                continue;
            }
            let sample = match &request.sample {
                None => None,
                Some(reference) => {
                    let found = match &coverage.sample {
                        Some(s) if s.sample.key == *reference || s.id == *reference => {
                            Some(s.clone())
                        }
                        _ => self.store.sample(basis, reference).await?,
                    };
                    match found.filter(|s| s.population_id == population.id) {
                        Some(s) => Some(s),
                        None => {
                            feedback.push(format!(
                                "No effective summary of population {} was recorded: {reference} is not one of its samples.",
                                population.id
                            ));
                            continue;
                        }
                    }
                }
            };
            let Some(target) = self.store.basis_record(basis, &population.basis_id).await? else {
                return Err(ReadingError::Unavailable);
            };
            let criteria = self.store.criteria(basis, &target.basis.criteria).await?;
            let rows = self.store.effective_outcomes(basis, &population.id).await?;
            let mut missing = Vec::new();
            let mut effective = Vec::new();
            for id in &target.basis.criteria {
                let Some(criterion) = criteria.iter().find(|c| &c.id == id) else {
                    return Err(ReadingError::Unavailable);
                };
                let opportunities: Vec<EffectiveOpportunity> = rows
                    .iter()
                    .filter(|r| &r.criterion_id == id)
                    .map(|r| r.opportunity.clone())
                    .collect();
                if opportunities.len() as u64 != population.counts.in_scope {
                    missing.push(id.clone());
                }
                effective.push(EffectiveCriterion {
                    criterion_id: id.clone(),
                    judgment: criterion.criterion.method.kind() == CriterionKind::Judgment,
                    opportunities,
                });
            }
            if !missing.is_empty() {
                feedback.push(format!(
                    "No effective summary of population {} was recorded: {} {} not yet evaluated over it. Ask evaluate_population for each criterion of its basis first.",
                    population.id,
                    missing.join(", "),
                    if missing.len() == 1 { "is" } else { "are" }
                ));
                continue;
            }
            let members = self.members_of(basis, coverage, &population).await?;
            let in_scope: BTreeSet<String> = members
                .iter()
                .filter(|m| m.member.disposition == Disposition::InScope)
                .filter_map(|m| m.member.subject.clone())
                .collect();
            let selected: Option<BTreeSet<String>> = sample
                .as_ref()
                .map(|s| s.selected.iter().cloned().collect());
            let roots = self
                .store
                .criterion_roots(basis, &target.basis.criteria)
                .await?;
            let exceptions = self.store.exception_entries(basis, &roots).await?;
            let summary = summarise_effective(
                &population.facts(),
                &in_scope,
                &effective,
                selected.as_ref(),
                &exceptions,
            );
            let sample_id = sample.map(|s| s.id);
            let newest = self
                .store
                .newest_effective(basis, &population.id, sample_id.as_deref())
                .await?;
            // A rerun over unchanged revisions, dispositions and exceptions
            // records nothing.
            if let Some(found) = newest
                .as_ref()
                .filter(|n| n.summary_digest == summary.digest())
            {
                feedback.push(format!(
                    "The effective summary of population {} is unchanged since {} (same summary digest {}); nothing was recorded.",
                    population.id,
                    found.id,
                    &found.summary_digest[..12]
                ));
                continue;
            }
            let (turn_binding, turn_epoch) = turn_basis(invocation);
            let mut record = EffectiveSummaryRecord {
                id: record_id("esummary", &basis.task_id, &invocation.id, ordinal),
                task_id: basis.task_id.clone(),
                cycle_id: basis.cycle_id.clone(),
                invocation_id: invocation.id.clone(),
                ordinal,
                methodology_binding_id: turn_binding,
                execution_epoch: turn_epoch,
                basis_id: population.basis_id.clone(),
                population_id: population.id.clone(),
                sample_id,
                supersedes: newest.map(|n| n.id),
                summary_digest: summary.digest(),
                effective: summary,
                digest: String::new(),
                recorded_us: None,
            };
            record.digest = document_digest(&record.document());
            match self.store.record_effective(basis, &record).await {
                Ok(stored) => {
                    progress = true;
                    feedback.push(effective_line(&stored));
                }
                // The database recounted and disagreed: a revision, a
                // disposition or an occurrence committed meanwhile. Never a
                // failed cycle: ask again.
                Err(ReadingError::Invalid) => feedback.push(format!(
                    "No effective summary of population {} was recorded: the platform's recount disagreed (a revision, disposition or exception changed meanwhile). Ask summarise_effective again.",
                    population.id
                )),
                Err(error) => return Err(error),
            }
        }
        Ok(progress)
    }
}
