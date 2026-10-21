//! Story 24.2: population, sample and coverage summary records in the work
//! view, and the exact member page of one population. Every count is the
//! stored exact count (a string of digits); a count trusted code could not
//! establish is never shown as a number. Cell texts and subject keys are read
//! from the population's original: they are returned only when the viewer
//! may read that exact original now (24.1 `value_withheld`).
use axum::{
    Json,
    extract::{Path, Query, State},
    http::HeaderMap,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use zobba_application::{
    assessment::coverage::{
        CoverageSnapshot, MemberRecord, PopulationRecord, SampleRecord, SummaryRecord,
    },
    task::TaskError,
};
use zobba_domain::{
    assessment::FactValue,
    coverage::{DispositionKind, MemberValue, PopulationCounts, SampleMethod},
    identity::valid_scope_id,
};

use crate::auth::ErrorResponse;
use crate::tasks::{TaskHttpState, TaskScopeQuery, failure};

type Originals = std::collections::BTreeMap<String, zobba_infrastructure::citation::ViewerOriginal>;

/// Exact counts of a population's received rows. When the population is
/// incomplete each is a lower bound ("at least N found").
#[derive(Serialize, ToSchema)]
pub struct PopulationCountsResponse {
    #[schema(pattern = "^[0-9]+$")]
    pub received_rows: String,
    #[schema(pattern = "^[0-9]+$")]
    pub unkeyed: String,
    #[schema(pattern = "^[0-9]+$")]
    pub duplicate_rows: String,
    #[schema(pattern = "^[0-9]+$")]
    pub distinct_subjects: String,
    #[schema(pattern = "^[0-9]+$")]
    pub excluded_out_of_period: String,
    #[schema(pattern = "^[0-9]+$")]
    pub scope_unknown_period_unparsed: String,
    #[schema(pattern = "^[0-9]+$")]
    pub scope_unknown_period_missing: String,
    #[schema(pattern = "^[0-9]+$")]
    pub scope_unknown_conflicting_duplicate: String,
    #[schema(pattern = "^[0-9]+$")]
    pub in_scope: String,
}
fn counts(c: &PopulationCounts) -> PopulationCountsResponse {
    PopulationCountsResponse {
        received_rows: c.received_rows.to_string(),
        unkeyed: c.unkeyed.to_string(),
        duplicate_rows: c.duplicate_rows.to_string(),
        distinct_subjects: c.distinct_subjects.to_string(),
        excluded_out_of_period: c.excluded_out_of_period.to_string(),
        scope_unknown_period_unparsed: c.scope_unknown_period_unparsed.to_string(),
        scope_unknown_period_missing: c.scope_unknown_period_missing.to_string(),
        scope_unknown_conflicting_duplicate: c.scope_unknown_conflicting_duplicate.to_string(),
        in_scope: c.in_scope.to_string(),
    }
}

/// One typed value column of a population manifest.
#[derive(Serialize, ToSchema)]
pub struct ValueColumnResponse {
    pub header: String,
    pub name: String,
    pub fact_type: String,
    pub rule: String,
    #[schema(required = true)]
    pub measure: Option<String>,
    #[schema(required = true)]
    pub measure_column: Option<String>,
}

/// One immutable population manifest version. Trusted code read every row
/// of the exact original; completeness and reconciliation are derived,
/// never asserted by the model.
#[derive(Serialize, ToSchema)]
pub struct CoveragePopulationResponse {
    pub id: String,
    pub invocation_id: String,
    pub basis_id: String,
    pub key: String,
    #[schema(required = true)]
    pub supersedes: Option<String>,
    pub original_id: String,
    #[schema(pattern = "^[0-9a-f]{64}$")]
    pub original_sha256: String,
    /// Only when the viewer may read that exact original now.
    #[schema(required = true)]
    pub filename: Option<String>,
    #[schema(required = true)]
    pub sheet: Option<String>,
    pub header_row: u32,
    pub subject_unit: String,
    #[schema(max_items = 3)]
    pub grain: Vec<String>,
    #[schema(required = true)]
    pub period_column: Option<String>,
    #[schema(required = true)]
    pub period_rule: Option<String>,
    #[schema(max_items = 8)]
    pub values: Vec<ValueColumnResponse>,
    /// The agent's statement; `false` always means absence is not proven.
    pub exhaustive: bool,
    pub selection: String,
    /// The cited control count, verified at its location by trusted code.
    #[schema(required = true, pattern = "^[0-9]+$")]
    pub declared_count: Option<String>,
    #[schema(required = true)]
    pub control_source: Option<crate::answers::CitationSourceResponse>,
    #[schema(required = true)]
    pub job_id: Option<String>,
    pub last_row: u32,
    pub rows_read: u32,
    pub truncated: bool,
    /// Excel date or date-time cells (no time zone) read as UTC.
    #[schema(pattern = "^[0-9]+$")]
    pub naive_date_times: String,
    /// `complete` or `incomplete`.
    pub completeness: String,
    /// `not_exhaustive`, `row_bound` or `count_mismatch` when incomplete.
    #[schema(required = true)]
    pub incomplete_reason: Option<String>,
    /// `matched`, `mismatch` or `not_declared`.
    pub reconciliation: String,
    pub counts: PopulationCountsResponse,
    pub methodology_binding_id: String,
    #[schema(pattern = "^[0-9]+$")]
    pub execution_epoch: String,
}

#[derive(Serialize, ToSchema)]
pub struct SubstitutionResponse {
    pub replaced: String,
    pub substitute: String,
    pub reason: String,
}

/// One immutable sample manifest version. Trusted code checked every
/// selected key and recomputed a seeded selection. A sample says nothing
/// about the items it did not select: there is no statistical inference.
#[derive(Serialize, ToSchema)]
pub struct CoverageSampleResponse {
    pub id: String,
    pub invocation_id: String,
    pub population_id: String,
    pub key: String,
    /// `all_in_scope`, `judgmental` or `seeded_random`.
    pub method: String,
    #[schema(required = true, pattern = "^[0-9]+$")]
    pub seed: Option<String>,
    #[schema(required = true)]
    pub algorithm: Option<String>,
    pub size: u32,
    pub strata: String,
    pub justification: String,
    #[schema(pattern = "^[0-9]+$")]
    pub selected_count: String,
    /// True when the selected keys (cell texts of the original) are withheld.
    pub keys_withheld: bool,
    #[schema(max_items = 200)]
    pub keys: Vec<String>,
    #[schema(max_items = 16)]
    pub substitutions: Vec<SubstitutionResponse>,
    pub statistical_inference: bool,
    pub methodology_binding_id: String,
    #[schema(pattern = "^[0-9]+$")]
    pub execution_epoch: String,
}

#[derive(Serialize, ToSchema)]
pub struct ReasonCountResponse {
    pub reason: String,
    #[schema(pattern = "^[0-9]+$")]
    pub count: String,
}

/// Exact opportunity counts of one criterion over the in-scope (or
/// selected) subjects.
#[derive(Serialize, ToSchema)]
pub struct CriterionCountsResponse {
    pub criterion_id: String,
    #[schema(pattern = "^[0-9]+$")]
    pub applicable: String,
    #[schema(pattern = "^[0-9]+$")]
    pub not_applicable: String,
    #[schema(pattern = "^[0-9]+$")]
    pub applicability_unknown: String,
    #[schema(pattern = "^[0-9]+$")]
    pub met: String,
    #[schema(pattern = "^[0-9]+$")]
    pub not_met: String,
    #[schema(pattern = "^[0-9]+$")]
    pub undetermined: String,
    pub undetermined_by_reason: Vec<ReasonCountResponse>,
    #[schema(pattern = "^[0-9]+$")]
    pub execution_failed: String,
    #[schema(pattern = "^[0-9]+$")]
    pub not_evaluated: String,
    /// Among `met`: unreviewed model proposals (24.1 judgments). They never
    /// show that no exception exists.
    #[schema(pattern = "^[0-9]+$")]
    pub met_unreviewed: String,
}

/// One closed limitation of a summary, in words beside its exact count.
#[derive(Serialize, ToSchema)]
pub struct LimitationResponse {
    /// `not_evaluated`, `judgment_not_recorded`, `unreviewed_model_judgments`,
    /// `sample_selected_only`, `scope_unknown`, `unkeyed_rows`,
    /// `period_not_checked` or `naive_date_times`.
    pub code: String,
    #[schema(required = true)]
    pub criterion_id: Option<String>,
    #[schema(required = true, pattern = "^[0-9]+$")]
    pub count: Option<String>,
    pub text: String,
}

/// One immutable coverage summary version, recounted by the database.
#[derive(Serialize, ToSchema)]
pub struct CoverageSummaryResponse {
    pub id: String,
    pub invocation_id: String,
    pub basis_id: String,
    pub population_id: String,
    #[schema(required = true)]
    pub sample_id: Option<String>,
    /// `subject_partition_v1`.
    pub aggregation: String,
    /// A closed conclusion; never a pass on an incomplete population, a
    /// sample or zero applicable subjects.
    pub conclusion: String,
    pub completeness: String,
    #[schema(required = true)]
    pub incomplete_reason: Option<String>,
    pub reconciliation: String,
    #[schema(required = true, pattern = "^[0-9]+$")]
    pub declared_count: Option<String>,
    pub counts: PopulationCountsResponse,
    /// The selected items a sample summary covers.
    #[schema(required = true, pattern = "^[0-9]+$")]
    pub selected: Option<String>,
    #[schema(max_items = 16)]
    pub criteria: Vec<CriterionCountsResponse>,
    #[schema(pattern = "^[0-9]+$")]
    pub failing_subjects: String,
    #[schema(pattern = "^[0-9]+$")]
    pub meets_every_applicable: String,
    #[schema(pattern = "^[0-9]+$")]
    pub unresolved_subjects: String,
    #[schema(pattern = "^[0-9]+$")]
    pub not_applicable_to_any: String,
    /// Criterion opportunities, never failing records.
    #[schema(pattern = "^[0-9]+$")]
    pub failing_opportunities: String,
    pub statistical_inference: bool,
    #[schema(max_items = 16)]
    pub limitations: Vec<LimitationResponse>,
    #[schema(pattern = "^[0-9a-f]{64}$")]
    pub summary_sha256: String,
    pub methodology_binding_id: String,
    #[schema(pattern = "^[0-9]+$")]
    pub execution_epoch: String,
}

/// The Task's newest coverage records, oldest first, with exact totals.
pub struct CoverageParts {
    pub populations: Vec<CoveragePopulationResponse>,
    pub total_populations: String,
    pub samples: Vec<CoverageSampleResponse>,
    pub total_samples: String,
    pub summaries: Vec<CoverageSummaryResponse>,
    pub total_summaries: String,
}

/// Every original a coverage snapshot references.
pub fn originals(view: &CoverageSnapshot) -> Vec<String> {
    let mut ids = std::collections::BTreeSet::new();
    for p in view.populations.iter().chain(&view.referenced) {
        ids.insert(p.population.original_id.clone());
        if let Some(control) = &p.control {
            ids.insert(control.source.original_id.clone());
        }
    }
    ids.into_iter().collect()
}

fn readable(originals: &Originals, population: &PopulationRecord) -> bool {
    crate::answers::exact_original(
        originals,
        &population.population.original_id,
        Some(&population.original_sha256),
    )
    .is_some()
}

pub fn population(p: &PopulationRecord, originals: &Originals) -> CoveragePopulationResponse {
    let m = &p.population;
    CoveragePopulationResponse {
        id: p.id.clone(),
        invocation_id: p.invocation_id.clone(),
        basis_id: p.basis_id.clone(),
        key: m.key.clone(),
        supersedes: m.supersedes.clone(),
        original_id: m.original_id.clone(),
        original_sha256: p.original_sha256.clone(),
        filename: crate::answers::exact_original(
            originals,
            &m.original_id,
            Some(&p.original_sha256),
        )
        .and_then(|o| o.filename.clone()),
        sheet: m.sheet.clone(),
        header_row: m.header_row,
        subject_unit: m.subject_unit.clone(),
        grain: m.grain.clone(),
        period_column: m.period.as_ref().map(|(h, _)| h.clone()),
        period_rule: m.period.as_ref().map(|(_, r)| r.as_str().into()),
        values: m
            .values
            .iter()
            .map(|v| ValueColumnResponse {
                header: v.header.clone(),
                name: v.name.clone(),
                fact_type: v.kind.as_str().into(),
                rule: v.rule.as_str().into(),
                measure: v.measure.as_ref().map(|m| m.label()),
                measure_column: v.measure_column.clone(),
            })
            .collect(),
        exhaustive: m.exhaustive,
        selection: m.selection.clone(),
        declared_count: p.declared_count.map(|d| d.to_string()),
        control_source: p
            .control
            .as_ref()
            .map(|c| crate::work::verified_source(c, originals)),
        job_id: p.job_id.clone(),
        last_row: p.last_row,
        rows_read: p.rows_read,
        truncated: p.truncated,
        naive_date_times: p.naive_date_times.to_string(),
        completeness: p.completeness.as_str().into(),
        incomplete_reason: p.completeness.reason().map(|r| r.as_str().into()),
        reconciliation: p.reconciliation.as_str().into(),
        counts: counts(&p.counts),
        methodology_binding_id: p.methodology_binding_id.clone(),
        execution_epoch: p.execution_epoch.to_string(),
    }
}

fn sample(
    s: &SampleRecord,
    view: &CoverageSnapshot,
    originals: &Originals,
) -> CoverageSampleResponse {
    // The keys are cell texts of the sampled population's original (listed,
    // or an older one read exactly by ID).
    let shown = view
        .populations
        .iter()
        .chain(&view.referenced)
        .find(|p| p.id == s.population_id)
        .is_some_and(|p| readable(originals, p));
    CoverageSampleResponse {
        id: s.id.clone(),
        invocation_id: s.invocation_id.clone(),
        population_id: s.population_id.clone(),
        key: s.sample.key.clone(),
        method: s.sample.method.kind().as_str().into(),
        seed: s.sample.method.seed().map(|v| v.to_string()),
        algorithm: matches!(s.sample.method, SampleMethod::SeededRandom { .. })
            .then(|| zobba_domain::coverage::SAMPLE_ALGORITHM.into()),
        size: s.sample.size,
        strata: s.sample.strata.clone(),
        justification: s.sample.justification.clone(),
        selected_count: s.selected.len().to_string(),
        keys_withheld: !shown,
        keys: if shown { s.sample.keys.clone() } else { vec![] },
        substitutions: if shown {
            s.sample
                .substitutions
                .iter()
                .map(|x| SubstitutionResponse {
                    replaced: x.replaced.clone(),
                    substitute: x.substitute.clone(),
                    reason: x.reason.clone(),
                })
                .collect()
        } else {
            vec![]
        },
        statistical_inference: false,
        methodology_binding_id: s.methodology_binding_id.clone(),
        execution_epoch: s.execution_epoch.to_string(),
    }
}

pub(crate) fn summary(r: &SummaryRecord) -> CoverageSummaryResponse {
    let s = &r.summary;
    CoverageSummaryResponse {
        id: r.id.clone(),
        invocation_id: r.invocation_id.clone(),
        basis_id: r.basis_id.clone(),
        population_id: r.population_id.clone(),
        sample_id: r.sample_id.clone(),
        aggregation: zobba_domain::coverage::AGGREGATION_RULE.into(),
        conclusion: s.conclusion.as_str().into(),
        completeness: s.completeness.as_str().into(),
        incomplete_reason: s.completeness.reason().map(|r| r.as_str().into()),
        reconciliation: s.reconciliation.as_str().into(),
        declared_count: match s.reconciliation {
            zobba_domain::coverage::Reconciliation::Mismatch { declared, .. } => {
                Some(declared.to_string())
            }
            zobba_domain::coverage::Reconciliation::Matched => {
                Some(s.counts.distinct_subjects.to_string())
            }
            zobba_domain::coverage::Reconciliation::NotDeclared => None,
        },
        counts: counts(&s.counts),
        selected: s.selected.map(|n| n.to_string()),
        criteria: s
            .criteria
            .iter()
            .map(|c| CriterionCountsResponse {
                criterion_id: c.criterion_id.clone(),
                applicable: c.applicable.to_string(),
                not_applicable: c.not_applicable.to_string(),
                applicability_unknown: c.applicability_unknown.to_string(),
                met: c.met.to_string(),
                not_met: c.not_met.to_string(),
                undetermined: c.undetermined.to_string(),
                undetermined_by_reason: c
                    .undetermined_by_reason
                    .iter()
                    .map(|(reason, count)| ReasonCountResponse {
                        reason: reason.clone(),
                        count: count.to_string(),
                    })
                    .collect(),
                execution_failed: c.execution_failed.to_string(),
                not_evaluated: c.not_evaluated.to_string(),
                met_unreviewed: c.met_unreviewed.to_string(),
            })
            .collect(),
        failing_subjects: s.partition.failing.to_string(),
        meets_every_applicable: s.partition.meets_every_applicable.to_string(),
        unresolved_subjects: s.partition.unresolved.to_string(),
        not_applicable_to_any: s.partition.not_applicable_to_any.to_string(),
        failing_opportunities: s.failing_opportunities.to_string(),
        statistical_inference: false,
        limitations: s
            .limitations
            .iter()
            .map(|l| LimitationResponse {
                code: l.code.as_str().into(),
                criterion_id: l.criterion_id.clone(),
                count: l.count.map(|n| n.to_string()),
                text: l.words(),
            })
            .collect(),
        summary_sha256: r.summary_digest.clone(),
        methodology_binding_id: r.methodology_binding_id.clone(),
        execution_epoch: r.execution_epoch.to_string(),
    }
}

pub fn parts(view: &CoverageSnapshot, originals: &Originals) -> CoverageParts {
    CoverageParts {
        populations: view
            .populations
            .iter()
            .map(|p| population(p, originals))
            .collect(),
        total_populations: view.total_populations.to_string(),
        samples: view
            .samples
            .iter()
            .map(|s| sample(s, view, originals))
            .collect(),
        total_samples: view.total_samples.to_string(),
        summaries: view.summaries.iter().map(summary).collect(),
        total_summaries: view.total_summaries.to_string(),
    }
}

// ----------------------------------------------------------------- members

/// One named cell of a member row.
#[derive(Serialize, ToSchema)]
pub struct MemberCellResponse {
    pub column: String,
    /// Display text; null when blank, over its bound, or withheld.
    #[schema(required = true)]
    pub text: Option<String>,
    #[schema(required = true)]
    pub location: Option<String>,
    /// How the original stored it: `text`, `excel_date` or `excel_datetime`
    /// (an Excel date-time has no time zone).
    pub kind: String,
}

/// One typed value of a member, re-parsed by trusted code.
#[derive(Serialize, ToSchema)]
pub struct MemberValueResponse {
    pub name: String,
    /// `value`, `missing` or `unsupported` (does not parse under its rule).
    pub state: String,
    #[schema(required = true)]
    pub value: Option<String>,
    #[schema(required = true)]
    pub measure: Option<String>,
    #[schema(required = true)]
    pub measure_grounded: Option<bool>,
}

/// One received row and what trusted code decided about it.
#[derive(Serialize, ToSchema)]
pub struct MemberResponse {
    /// 0-based order of receipt.
    pub ordinal: u32,
    /// 1-based row of the original.
    pub row: u32,
    /// The subject key (exact cell texts); null when unkeyed or withheld.
    #[schema(required = true)]
    pub subject: Option<String>,
    /// `in_scope`, `excluded`, `scope_unknown`, `duplicate_row` or `unkeyed`.
    pub disposition: String,
    #[schema(required = true)]
    pub reason: Option<String>,
    /// For a duplicate row, the ordinal of the row it repeats.
    #[schema(required = true)]
    pub duplicate_of: Option<u32>,
    pub cells: Vec<MemberCellResponse>,
    pub values: Vec<MemberValueResponse>,
}

#[derive(Serialize, ToSchema)]
pub struct PopulationMembersResponse {
    pub population: CoveragePopulationResponse,
    /// The disposition filter, or null for every member.
    #[schema(required = true)]
    pub disposition: Option<String>,
    /// The exact count of members matching the filter.
    #[schema(pattern = "^[0-9]+$")]
    pub total: String,
    /// True when cell texts are withheld (the viewer may not read the exact
    /// original now); dispositions, row numbers and counts are still shown.
    pub values_withheld: bool,
    #[schema(max_items = 50)]
    pub members: Vec<MemberResponse>,
    /// Opaque cursor of the next page (members are C-ordered by key, then
    /// receipt order), when there is one.
    #[schema(required = true, pattern = "^[0-9]{1,10}$")]
    pub next_cursor: Option<String>,
}

fn member(m: &MemberRecord, columns: &[String], names: &[String], shown: bool) -> MemberResponse {
    let member = &m.member;
    MemberResponse {
        ordinal: member.ordinal,
        row: member.row,
        subject: member.subject.clone().filter(|_| shown),
        disposition: member.disposition.kind().as_str().into(),
        reason: member.disposition.reason().map(|r| r.as_str().into()),
        duplicate_of: member.disposition.duplicate_of(),
        cells: columns
            .iter()
            .zip(&member.cells)
            .map(|(column, cell)| MemberCellResponse {
                column: column.clone(),
                text: cell.text.clone().filter(|_| shown),
                location: cell.locator.as_ref().map(|l| l.label()),
                kind: cell.kind.as_str().into(),
            })
            .collect(),
        values: names
            .iter()
            .zip(&member.values)
            .map(|(name, value)| {
                let (state, value, measure, grounded) = match value {
                    MemberValue::Missing => ("missing", None, None, None),
                    MemberValue::Unsupported => ("unsupported", None, None, None),
                    MemberValue::Value {
                        value,
                        measure_grounded,
                    } => (
                        "value",
                        Some(value.text()),
                        match value {
                            FactValue::Decimal { measure, .. } => Some(measure.label()),
                            _ => None,
                        },
                        *measure_grounded,
                    ),
                };
                // The measure is read from a currency or unit cell of the
                // original: withheld with the other cell values.
                MemberValueResponse {
                    name: name.clone(),
                    state: state.into(),
                    value: value.filter(|_| shown),
                    measure: measure.filter(|_| shown),
                    measure_grounded: grounded,
                }
            })
            .collect(),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct MembersQuery {
    organisation_id: String,
    client_id: String,
    disposition: Option<String>,
    cursor: Option<String>,
}

#[utoipa::path(get,path="/engagements/{engagement_id}/tasks/{task_id}/assessment/populations/{population_id}/members",operation_id="get_population_members",security(("server_session"=[])),
    params(("X-Expected-Session"=Option<String>,Header,description="Optional session-bound read precondition from the in-memory session CSRF token; mismatch refuses without changing the cookie",min_length=1,max_length=128),("engagement_id"=String,Path),("task_id"=String,Path),("population_id"=String,Path),("organisation_id"=String,Query),("client_id"=String,Query),
        ("disposition"=Option<String>,Query,description="in_scope, excluded, scope_unknown, duplicate_row or unkeyed"),("cursor"=Option<String>,Query,description="next_cursor of the previous page",pattern="^[0-9]{1,10}$")),
    responses((status=412,description="Session changed",body=ErrorResponse),(status=200,description="The exact count of a population's members of one disposition and one page of them, C-ordered by key (a row with no key first), then receipt order",body=PopulationMembersResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=400,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn members(
    State(state): State<TaskHttpState>,
    headers: HeaderMap,
    Path((engagement_id, task_id, population_id)): Path<(String, String, String)>,
    query: Result<Query<MembersQuery>, axum::extract::rejection::QueryRejection>,
) -> Response {
    let current = match state.identity.current_read(&headers).await {
        Ok(current) => current,
        Err(error) => return crate::auth::failure(error),
    };
    let Ok(Query(query)) = query else {
        return failure(TaskError::Denied);
    };
    let scope = match (TaskScopeQuery {
        organisation_id: query.organisation_id,
        client_id: query.client_id,
    })
    .scope(engagement_id)
    {
        Ok(scope) => scope,
        Err(error) => return failure(error),
    };
    if !valid_scope_id(&task_id) || !valid_scope_id(&population_id) {
        return failure(TaskError::Denied);
    }
    let disposition = match query.disposition.as_deref() {
        None => None,
        Some(text) => match DispositionKind::parse(text) {
            Some(kind) => Some(kind),
            None => return failure(TaskError::Invalid),
        },
    };
    let after = match query.cursor.as_deref() {
        None => None,
        Some(text) => match (text.len() <= 10 && text.bytes().all(|b| b.is_ascii_digit()))
            .then(|| text.parse::<u32>().ok())
            .flatten()
        {
            Some(after) => Some(after),
            None => return failure(TaskError::Invalid),
        },
    };
    let (Some(assessments), Some((citations, _))) = (&state.assessments, &state.answers) else {
        return failure(TaskError::Unavailable);
    };
    let page = match assessments
        .member_page(
            &current.identity.id,
            &scope,
            &task_id,
            &population_id,
            disposition,
            after,
        )
        .await
    {
        Ok(Some(page)) => page,
        // A population this Task does not hold is refused like any other
        // record outside the viewer's scope.
        Ok(None) => return failure(TaskError::Denied),
        Err(error) => return failure(error),
    };
    let mut ids = vec![page.population.population.original_id.clone()];
    if let Some(control) = &page.population.control {
        ids.push(control.source.original_id.clone());
    }
    let originals = match citations
        .viewer_originals(&current.identity.id, &scope, &ids)
        .await
    {
        Ok(originals) => originals,
        Err(_) => return failure(TaskError::Unavailable),
    };
    let shown = readable(&originals, &page.population);
    let columns = page.population.population.columns();
    let names: Vec<String> = page
        .population
        .population
        .values
        .iter()
        .map(|v| v.name.clone())
        .collect();
    Json(PopulationMembersResponse {
        population: population(&page.population, &originals),
        disposition: disposition.map(|d| d.as_str().into()),
        total: page.total.to_string(),
        values_withheld: !shown,
        members: page
            .members
            .iter()
            .map(|m| member(m, &columns, &names, shown))
            .collect(),
        next_cursor: page.next.map(|n| n.to_string()),
    })
    .into_response()
}

#[cfg(test)]
mod tests;
