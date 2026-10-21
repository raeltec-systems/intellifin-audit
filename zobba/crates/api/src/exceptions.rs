//! Story 24.3b: Task-scoped exceptions and the effective summary.
//!
//! Every not_met result is an immutable occurrence of its exception; an
//! exception's status is derived on every read and never stored. The list
//! route returns every exception of a Task with its status, the exact
//! counts and the newest effective summaries; the detail route one page of
//! an exception's occurrences and every disposition. A person closes or
//! reopens an exception through an authenticated POST (Origin, session CSRF,
//! the expected-actor fence and a request key idempotent per actor): only an
//! Audit manager or the Task's accountable person may, a closure cites at
//! least one verified evidence reference, and no failing count ever drops
//! because of a disposition. There are no waivers.
use std::{collections::BTreeMap, sync::Arc, time::Duration};

use axum::{
    Json, Router,
    extract::{
        Path, Query, State,
        rejection::{JsonRejection, QueryRejection},
    },
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use tokio::sync::Semaphore;
use utoipa::ToSchema;
use zobba_application::{
    assessment::{
        coverage::SummaryRecord,
        exception::{EffectiveSummaryRecord, ExceptionDispositionRecord, ExceptionView},
    },
    disposition::PersonReader,
    exception::{ExceptionDispositionError, save_exception_disposition},
    task::TaskError,
};
use zobba_domain::{
    citation::{CitationSource, Locator},
    exception::{
        ExceptionDispositionKind, ExceptionDispositionRequest, NOT_REMEDIATION, status_words,
        valid_exception_id,
    },
    identity::valid_scope_id,
};
use zobba_infrastructure::{
    assessment::{
        AssessmentRepository,
        exception::{ExceptionDetail, ExceptionsReadError, ExceptionsView},
    },
    citation::{CitationRepository, ViewerOriginal},
    evidence::{EvidenceRepository, s3::S3EvidenceObjects},
    identity::secret_hash,
};

use crate::tasks::{TaskScopeQuery, failure};

type Originals = BTreeMap<String, ViewerOriginal>;

#[derive(Clone)]
pub(crate) struct ExceptionState {
    identity: crate::auth::AuthState,
    assessments: AssessmentRepository,
    citations: CitationRepository,
    evidence: EvidenceRepository,
    objects: Option<Arc<S3EvidenceObjects>>,
}

pub(crate) fn router(
    pool: sqlx::PgPool,
    identity: crate::auth::AuthState,
    objects: Option<Arc<S3EvidenceObjects>>,
) -> Router {
    let capacity = Arc::new(Semaphore::new(4));
    Router::new()
        .route(
            "/engagements/{engagement_id}/tasks/{task_id}/assessment/exceptions",
            get(list),
        )
        .route(
            "/engagements/{engagement_id}/tasks/{task_id}/assessment/exceptions/{exception_id}",
            get(detail),
        )
        .route(
            "/engagements/{engagement_id}/tasks/{task_id}/assessment/exceptions/{exception_id}/dispositions",
            post(dispose),
        )
        .with_state(ExceptionState {
            identity,
            assessments: AssessmentRepository::new(pool.clone()),
            citations: CitationRepository::new(pool.clone()),
            evidence: EvidenceRepository::new(pool),
            objects,
        })
        .layer(axum::extract::DefaultBodyLimit::max(64 * 1024))
        .layer(axum::middleware::from_fn(
            move |request: axum::extract::Request, next: axum::middleware::Next| {
                let capacity = capacity.clone();
                async move {
                    let Ok(_permit) = capacity.try_acquire_owned() else {
                        return failure(TaskError::Capacity);
                    };
                    match tokio::time::timeout(Duration::from_secs(60), next.run(request)).await {
                        Ok(response) => response,
                        Err(_) => failure(TaskError::Unavailable),
                    }
                }
            },
        ))
}

/// A person's disposition of one exception. It never changes an occurrence,
/// a revision or a verdict.
#[derive(Serialize, ToSchema)]
pub struct ExceptionDispositionResponse {
    pub id: String,
    pub exception_id: String,
    pub actor_id: String,
    /// The person's public label, when known.
    #[schema(required = true)]
    pub actor_label: Option<String>,
    /// `closed` or `reopened`.
    pub kind: String,
    /// The person's words (attributed data), at most 2,000 UTF-8 bytes.
    #[schema(max_length = 2000)]
    pub rationale: String,
    /// Verified evidence references; a quote is withheld from a viewer who
    /// cannot read its original now.
    #[schema(max_items = 8)]
    pub references: Vec<crate::answers::CitationSourceResponse>,
    #[schema(required = true, pattern = "^[0-9]+$")]
    pub recorded_us: Option<String>,
}

/// One exception of a Task with its derived status (never stored).
#[derive(Serialize, ToSchema)]
pub struct ExceptionResponse {
    pub id: String,
    /// The criterion lineage (its first version's ID).
    pub criterion_root: String,
    pub subject: String,
    /// `open`, `resolved_by_evidence`, `replaced_by_human_judgment` or
    /// `closed_by_disposition`.
    pub status: String,
    /// `not_met` while any current observation of its lineage and subject
    /// fails; otherwise `proposed_met` (an unreviewed model proposal would
    /// resolve it once accepted), `person_undetermined` (a person replaced
    /// the failing judgment with undetermined) or `not_observed`.
    pub latest_observed: String,
    /// What the status means, in words. An open exception the latest
    /// revision did not observe says that this is not evidence of
    /// remediation.
    pub status_words: String,
    /// The exact number of its occurrences.
    #[schema(pattern = "^[0-9]+$")]
    pub occurrences: String,
    /// The exact number of its dispositions; at most 16 may be saved.
    #[schema(pattern = "^[0-9]+$")]
    pub dispositions: String,
    /// The record its first occurrence names.
    pub first_source_kind: String,
    pub first_source_id: String,
    #[schema(required = true, pattern = "^[0-9]+$")]
    pub recorded_us: Option<String>,
    /// Its newest disposition.
    #[schema(required = true)]
    pub disposition: Option<ExceptionDispositionResponse>,
}

/// Exact exception counts by derived status.
#[derive(Serialize, ToSchema)]
pub struct ExceptionCountsResponse {
    #[schema(pattern = "^[0-9]+$")]
    pub total: String,
    #[schema(pattern = "^[0-9]+$")]
    pub open: String,
    #[schema(pattern = "^[0-9]+$")]
    pub resolved_by_evidence: String,
    #[schema(pattern = "^[0-9]+$")]
    pub replaced_by_human_judgment: String,
    #[schema(pattern = "^[0-9]+$")]
    pub closed_by_disposition: String,
    /// Distinct exception subjects (never more than the total).
    #[schema(pattern = "^[0-9]+$")]
    pub subjects: String,
}

/// A closed limitation of an effective summary and its sentence.
#[derive(Serialize, ToSchema)]
pub struct EffectiveLimitationResponse {
    pub code: String,
    #[schema(required = true, pattern = "^[0-9]+$")]
    pub count: Option<String>,
    pub text: String,
}

/// Counts per criterion the 24.2 summary does not carry.
#[derive(Serialize, ToSchema)]
pub struct EffectiveCriterionResponse {
    pub criterion_id: String,
    #[schema(pattern = "^[0-9]+$")]
    pub human_replaced: String,
    #[schema(pattern = "^[0-9]+$")]
    pub pending_reconsideration: String,
    #[schema(pattern = "^[0-9]+$")]
    pub undisposed: String,
    #[schema(pattern = "^[0-9]+$")]
    pub superseded: String,
}

/// One listed exception of an effective summary.
#[derive(Serialize, ToSchema)]
pub struct ListedExceptionResponse {
    pub id: String,
    pub subject: String,
    pub criterion_root: String,
    pub status: String,
    pub latest_observed: String,
}

/// An effective summary version: the 24.2 partition over current
/// revisions and dispositions (its denominators are the 24.2 ones), with
/// the exceptions of its own subjects under its basis's criterion lineages
/// by derived status. The database recounted every number.
#[derive(Serialize, ToSchema)]
pub struct EffectiveSummaryResponse {
    pub id: String,
    #[schema(required = true)]
    pub supersedes: Option<String>,
    /// `effective_partition_v1`.
    pub aggregation: String,
    /// Counts are lower bounds when false; the total is then not known.
    pub exact: bool,
    /// The effective conclusion: the summary's own conclusion, except that
    /// it is `inconclusive` instead of `no_exception_found` while an
    /// exception of its subjects is open.
    pub conclusion: String,
    pub summary: crate::coverage::CoverageSummaryResponse,
    #[schema(max_items = 16)]
    pub criteria: Vec<EffectiveCriterionResponse>,
    pub exceptions: ExceptionCountsResponse,
    /// The first 50 exceptions in (subject, criterion lineage, ID) byte
    /// order; `exceptions.total` is exact.
    #[schema(max_items = 50)]
    pub listed: Vec<ListedExceptionResponse>,
    #[schema(max_items = 7)]
    pub effective_limitations: Vec<EffectiveLimitationResponse>,
    #[schema(required = true, pattern = "^[0-9]+$")]
    pub recorded_us: Option<String>,
}

/// One page of a Task's exceptions (50, C-ordered by subject, criterion
/// lineage and ID), the exact counts by status over all of them, whether the
/// viewer may close or reopen one, and the newest effective summaries.
#[derive(Serialize, ToSchema)]
pub struct ExceptionsResponse {
    #[schema(max_items = 50)]
    pub exceptions: Vec<ExceptionResponse>,
    /// Exact counts over every exception of the Task, never over the page.
    pub counts: ExceptionCountsResponse,
    /// The `cursor` of the next page, when more exceptions follow.
    #[schema(required = true, pattern = "^exc-[0-9a-f]{40}$")]
    pub next_cursor: Option<String>,
    /// The viewer is an Audit manager or the Task's accountable person.
    pub may_close: bool,
    /// The sentence an open exception the latest revision did not observe
    /// carries.
    pub not_remediation: String,
    #[schema(max_items = 16)]
    pub effective_summaries: Vec<EffectiveSummaryResponse>,
    #[schema(pattern = "^[0-9]+$")]
    pub total_effective_summaries: String,
}

/// One occurrence of an exception: a not_met result.
#[derive(Serialize, ToSchema)]
pub struct OccurrenceResponse {
    /// `evaluation`, `revision`, `opportunity` or `disposition`.
    pub source_kind: String,
    pub source_id: String,
    #[schema(required = true)]
    pub population_id: Option<String>,
    #[schema(required = true, pattern = "^[0-9]+$")]
    pub member_ordinal: Option<String>,
    pub criterion_id: String,
    pub basis_id: String,
    /// `deterministic`, `model_proposal` or `human`.
    pub origin: String,
    /// The digests of the inputs it read.
    #[schema(max_items = 32)]
    pub evidence: Vec<String>,
    #[schema(pattern = "^[0-9]+$")]
    pub source_us: String,
    /// Its place in the exception's order (commit order, never clock time).
    #[schema(pattern = "^[0-9]+$")]
    pub seq: String,
}

/// One exception, one page of its occurrences (oldest first) and every
/// disposition.
#[derive(Serialize, ToSchema)]
pub struct ExceptionDetailResponse {
    pub exception: ExceptionResponse,
    #[schema(max_items = 50)]
    pub occurrences: Vec<OccurrenceResponse>,
    #[schema(max_items = 16)]
    pub dispositions: Vec<ExceptionDispositionResponse>,
    #[schema(required = true, pattern = "^[0-9]+$")]
    pub next_cursor: Option<String>,
}

fn disposition_response(
    record: &ExceptionDispositionRecord,
    label: Option<String>,
    originals: &Originals,
) -> ExceptionDispositionResponse {
    let r = &record.request;
    ExceptionDispositionResponse {
        id: record.id.clone(),
        exception_id: r.exception_id.clone(),
        actor_id: record.actor_id.clone(),
        actor_label: label.filter(|l| !l.is_empty()),
        kind: r.kind.as_str().into(),
        rationale: r.rationale.clone(),
        references: record
            .references
            .iter()
            .map(|(source, sha)| {
                crate::answers::source_response(
                    source,
                    crate::answers::exact_original(originals, &source.original_id, Some(sha)),
                    (crate::answers::CitationVerificationResponse::Verified, None),
                )
            })
            .collect(),
        recorded_us: record.recorded_us.map(|u| u.to_string()),
    }
}

fn exception_response(view: &ExceptionView, originals: &Originals) -> ExceptionResponse {
    ExceptionResponse {
        id: view.record.id.clone(),
        criterion_root: view.record.criterion_root.clone(),
        subject: view.record.subject.clone(),
        status: view.status.as_str().into(),
        latest_observed: view.latest_observed.as_str().into(),
        status_words: status_words(view.status, view.latest_observed),
        occurrences: view.occurrences.to_string(),
        dispositions: view.dispositions.to_string(),
        first_source_kind: view.record.first_source_kind.as_str().into(),
        first_source_id: view.record.first_source_id.clone(),
        recorded_us: view.record.recorded_us.map(|u| u.to_string()),
        disposition: view
            .disposition
            .as_ref()
            .map(|(d, label)| disposition_response(d, Some(label.clone()), originals)),
    }
}

fn counts_response(c: &zobba_domain::exception::ExceptionCounts) -> ExceptionCountsResponse {
    ExceptionCountsResponse {
        total: c.total.to_string(),
        open: c.open.to_string(),
        resolved_by_evidence: c.resolved_by_evidence.to_string(),
        replaced_by_human_judgment: c.replaced_by_human_judgment.to_string(),
        closed_by_disposition: c.closed_by_disposition.to_string(),
        subjects: c.subjects.to_string(),
    }
}

pub(crate) fn effective_response(r: &EffectiveSummaryRecord) -> EffectiveSummaryResponse {
    let e = &r.effective;
    let exact = e.exact();
    let inner = SummaryRecord {
        id: r.id.clone(),
        task_id: r.task_id.clone(),
        cycle_id: r.cycle_id.clone(),
        invocation_id: r.invocation_id.clone(),
        ordinal: r.ordinal,
        methodology_binding_id: r.methodology_binding_id.clone(),
        execution_epoch: r.execution_epoch,
        basis_id: r.basis_id.clone(),
        population_id: r.population_id.clone(),
        sample_id: r.sample_id.clone(),
        summary: e.summary.clone(),
        summary_digest: r.summary_digest.clone(),
        digest: r.digest.clone(),
        recorded_us: r.recorded_us,
    };
    EffectiveSummaryResponse {
        id: r.id.clone(),
        supersedes: r.supersedes.clone(),
        aggregation: zobba_domain::exception::EFFECTIVE_AGGREGATION.into(),
        exact,
        conclusion: e.conclusion.as_str().into(),
        summary: crate::coverage::summary(&inner),
        criteria: e
            .criteria
            .iter()
            .map(|c| EffectiveCriterionResponse {
                criterion_id: c.criterion_id.clone(),
                human_replaced: c.human_replaced.to_string(),
                pending_reconsideration: c.pending_reconsideration.to_string(),
                undisposed: c.undisposed.to_string(),
                superseded: c.superseded.to_string(),
            })
            .collect(),
        exceptions: counts_response(&e.exceptions),
        listed: e
            .listed
            .iter()
            .map(|l| ListedExceptionResponse {
                id: l.id.clone(),
                subject: l.subject.clone(),
                criterion_root: l.criterion_root.clone(),
                status: l.status.as_str().into(),
                latest_observed: l.latest_observed.as_str().into(),
            })
            .collect(),
        effective_limitations: e
            .limitations
            .iter()
            .map(|l| EffectiveLimitationResponse {
                code: l.code.as_str().into(),
                count: l.count.map(|n| n.to_string()),
                text: l.words(exact),
            })
            .collect(),
        recorded_us: r.recorded_us.map(|u| u.to_string()),
    }
}

fn reference_ids<'a>(records: impl Iterator<Item = &'a ExceptionDispositionRecord>) -> Vec<String> {
    let mut ids: Vec<String> = records
        .flat_map(|d| d.references.iter().map(|(s, _)| s.original_id.clone()))
        .collect();
    ids.sort();
    ids.dedup();
    ids
}

/// The list response for a viewer. Counts are over every exception of the
/// Task (one aggregate), never over the listed page.
pub(crate) fn exceptions_response(
    view: &ExceptionsView,
    originals: &Originals,
) -> ExceptionsResponse {
    ExceptionsResponse {
        exceptions: view
            .exceptions
            .iter()
            .map(|e| exception_response(e, originals))
            .collect(),
        counts: counts_response(&view.counts),
        next_cursor: view.next.clone(),
        may_close: view.may_close,
        not_remediation: NOT_REMEDIATION.into(),
        effective_summaries: view.summaries.iter().map(effective_response).collect(),
        total_effective_summaries: view.total_summaries.to_string(),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ListQuery {
    organisation_id: String,
    client_id: String,
    cursor: Option<String>,
}

fn not_found() -> Response {
    (
        StatusCode::NOT_FOUND,
        Json(crate::auth::ErrorResponse {
            error: "exception_not_found",
        }),
    )
        .into_response()
}
fn bad_cursor() -> Response {
    (
        StatusCode::BAD_REQUEST,
        Json(crate::auth::ErrorResponse {
            error: "exception_cursor_invalid",
        }),
    )
        .into_response()
}

#[utoipa::path(get,path="/engagements/{engagement_id}/tasks/{task_id}/assessment/exceptions",operation_id="list_exceptions",security(("server_session"=[])),
    params(("X-Expected-Session"=Option<String>,Header,description="Optional session-bound read precondition from the in-memory session CSRF token; mismatch refuses without changing the cookie",min_length=1,max_length=128),("engagement_id"=String,Path),("task_id"=String,Path),("organisation_id"=String,Query),("client_id"=String,Query),
        ("cursor"=Option<String>,Query,description="next_cursor of the previous page",pattern="^exc-[0-9a-f]{40}$")),
    responses((status=200,description="One page (50) of the Task's exceptions with their derived status, exact counts by status over all of them, and the newest effective summaries",body=ExceptionsResponse),(status=400,description="exception_cursor_invalid for a cursor that names no exception of this Task",body=crate::auth::ErrorResponse),(status=401,body=crate::auth::ErrorResponse),(status=403,body=crate::auth::ErrorResponse),(status=412,description="Session changed",body=crate::auth::ErrorResponse),(status=429,body=crate::auth::ErrorResponse),(status=503,body=crate::auth::ErrorResponse)))]
pub(crate) async fn list(
    State(state): State<ExceptionState>,
    headers: HeaderMap,
    path: Result<Path<(String, String)>, axum::extract::rejection::PathRejection>,
    query: Result<Query<ListQuery>, QueryRejection>,
) -> Response {
    let current = match state.identity.current_read(&headers).await {
        Ok(current) => current,
        Err(error) => return crate::auth::failure(error),
    };
    let (Ok(Path((engagement_id, task_id))), Ok(Query(query))) = (path, query) else {
        return failure(TaskError::Invalid);
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
    if !valid_scope_id(&task_id) {
        return failure(TaskError::Denied);
    }
    if query
        .cursor
        .as_deref()
        .is_some_and(|c| !valid_exception_id(c))
    {
        return bad_cursor();
    }
    let view = match state
        .assessments
        .exceptions_view(
            &current.identity.id,
            &scope,
            &task_id,
            query.cursor.as_deref(),
        )
        .await
    {
        Ok(view) => view,
        Err(ExceptionsReadError::Cursor) => return bad_cursor(),
        Err(ExceptionsReadError::Task(error)) => return failure(error),
    };
    let ids = reference_ids(
        view.exceptions
            .iter()
            .filter_map(|e| e.disposition.as_ref().map(|(d, _)| d)),
    );
    let originals = match state
        .citations
        .viewer_originals(&current.identity.id, &scope, &ids)
        .await
    {
        Ok(originals) => originals,
        Err(_) => return failure(TaskError::Unavailable),
    };
    Json(exceptions_response(&view, &originals)).into_response()
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct DetailQuery {
    organisation_id: String,
    client_id: String,
    cursor: Option<String>,
}

pub(crate) fn detail_response(
    detail: &ExceptionDetail,
    originals: &Originals,
) -> ExceptionDetailResponse {
    ExceptionDetailResponse {
        exception: exception_response(&detail.view, originals),
        occurrences: detail
            .occurrences
            .iter()
            .map(|o| OccurrenceResponse {
                source_kind: o.source_kind.as_str().into(),
                source_id: o.source_id.clone(),
                population_id: o.population_id.clone(),
                member_ordinal: o.member_ordinal.map(|m| m.to_string()),
                criterion_id: o.criterion_id.clone(),
                basis_id: o.basis_id.clone(),
                origin: o.origin.as_str().into(),
                evidence: o.evidence.clone(),
                source_us: o.source_us.to_string(),
                seq: o.seq.to_string(),
            })
            .collect(),
        dispositions: detail
            .dispositions
            .iter()
            .map(|(d, label)| disposition_response(d, Some(label.clone()), originals))
            .collect(),
        next_cursor: detail.next.map(|n| n.to_string()),
    }
}

#[utoipa::path(get,path="/engagements/{engagement_id}/tasks/{task_id}/assessment/exceptions/{exception_id}",operation_id="get_exception",security(("server_session"=[])),
    params(("X-Expected-Session"=Option<String>,Header,description="Optional session-bound read precondition from the in-memory session CSRF token; mismatch refuses without changing the cookie",min_length=1,max_length=128),("engagement_id"=String,Path),("task_id"=String,Path),("exception_id"=String,Path),("organisation_id"=String,Query),("client_id"=String,Query),
        ("cursor"=Option<String>,Query,description="next_cursor of the previous page (the last listed occurrence's place)",pattern="^[0-9]{1,7}$")),
    responses((status=200,description="One exception, one page of its occurrences (in their order, 50 a page) and every disposition; occurrences are never changed",body=ExceptionDetailResponse),(status=400,body=crate::auth::ErrorResponse),(status=401,body=crate::auth::ErrorResponse),(status=403,body=crate::auth::ErrorResponse),(status=404,description="exception_not_found: no such exception of this Task",body=crate::auth::ErrorResponse),(status=412,description="Session changed",body=crate::auth::ErrorResponse),(status=429,body=crate::auth::ErrorResponse),(status=503,body=crate::auth::ErrorResponse)))]
pub(crate) async fn detail(
    State(state): State<ExceptionState>,
    headers: HeaderMap,
    path: Result<Path<(String, String, String)>, axum::extract::rejection::PathRejection>,
    query: Result<Query<DetailQuery>, QueryRejection>,
) -> Response {
    let current = match state.identity.current_read(&headers).await {
        Ok(current) => current,
        Err(error) => return crate::auth::failure(error),
    };
    let (Ok(Path((engagement_id, task_id, exception_id))), Ok(Query(query))) = (path, query) else {
        return failure(TaskError::Invalid);
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
    if !valid_scope_id(&task_id) || !valid_exception_id(&exception_id) {
        return failure(TaskError::Denied);
    }
    let after = match query.cursor.as_deref() {
        None => 0,
        Some(text) => match (text.len() <= 7 && text.bytes().all(|b| b.is_ascii_digit()))
            .then(|| text.parse::<u32>().ok())
            .flatten()
        {
            Some(after) => after,
            None => return failure(TaskError::Invalid),
        },
    };
    let detail = match state
        .assessments
        .exception_detail(&current.identity.id, &scope, &task_id, &exception_id, after)
        .await
    {
        Ok(Some(detail)) => detail,
        Ok(None) => return not_found(),
        Err(error) => return failure(error),
    };
    let ids = reference_ids(detail.dispositions.iter().map(|(d, _)| d));
    let originals = match state
        .citations
        .viewer_originals(&current.identity.id, &scope, &ids)
        .await
    {
        Ok(originals) => originals,
        Err(_) => return failure(TaskError::Unavailable),
    };
    Json(detail_response(&detail, &originals)).into_response()
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ExceptionDispositionCommandRequest {
    /// Request key, idempotent per actor.
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub key: String,
    /// `closed` or `reopened`.
    pub kind: String,
    /// 1–2,000 UTF-8 bytes.
    #[schema(max_length = 2000)]
    pub rationale: String,
    /// `closed` cites at least one.
    #[schema(max_items = 8)]
    pub references: Vec<crate::revisions::DispositionReferenceRequest>,
}

/// A refusal of an exception disposition. `index` names an unverified
/// reference.
#[derive(Serialize, ToSchema)]
pub struct ExceptionDispositionErrorResponse {
    pub error: &'static str,
    #[schema(required = true)]
    pub index: Option<u32>,
}

fn refusal(error: ExceptionDispositionError) -> Response {
    let (status, index) = match &error {
        ExceptionDispositionError::Invalid => (StatusCode::BAD_REQUEST, None),
        ExceptionDispositionError::ReferenceUnverified(i) => {
            (StatusCode::CONFLICT, Some(*i as u32))
        }
        ExceptionDispositionError::AlreadyClosed
        | ExceptionDispositionError::NotClosed
        | ExceptionDispositionError::Conflict
        | ExceptionDispositionError::Capacity => (StatusCode::CONFLICT, None),
        ExceptionDispositionError::NotFound => (StatusCode::NOT_FOUND, None),
        ExceptionDispositionError::Denied | ExceptionDispositionError::NotAuthorised => {
            (StatusCode::FORBIDDEN, None)
        }
        ExceptionDispositionError::Unavailable => (StatusCode::SERVICE_UNAVAILABLE, None),
    };
    (
        status,
        Json(ExceptionDispositionErrorResponse {
            error: error.code(),
            index,
        }),
    )
        .into_response()
}

pub(crate) fn command(
    exception_id: String,
    body: ExceptionDispositionCommandRequest,
) -> Option<ExceptionDispositionRequest> {
    let request = ExceptionDispositionRequest {
        key: body.key,
        exception_id,
        kind: ExceptionDispositionKind::parse(&body.kind)?,
        rationale: body.rationale,
        references: body
            .references
            .into_iter()
            .map(|r| {
                Some(CitationSource {
                    original_id: r.original_id,
                    locator: Some(Locator::parse(&r.locator)?).filter(|l| l.render() == r.locator),
                    quote: r.quote,
                })
            })
            .collect::<Option<Vec<_>>>()?,
    };
    request.is_valid().then_some(request)
}

#[utoipa::path(post,path="/engagements/{engagement_id}/tasks/{task_id}/assessment/exceptions/{exception_id}/dispositions",operation_id="save_exception_disposition",security(("server_session"=[])),
    params(("engagement_id"=String,Path),("task_id"=String,Path),("exception_id"=String,Path),("organisation_id"=String,Query),("client_id"=String,Query),("Origin"=String,Header,description="Exact configured HTTPS application origin"),("X-CSRF-Token"=String,Header,description="Current session-bound token"),("X-Expected-Actor"=String,Header,description="Required refusal fence for the current session actor; never supplies author authority",min_length=1,max_length=128,pattern="^[A-Za-z0-9_-]+$")),
    request_body=ExceptionDispositionCommandRequest,
    responses((status=200,description="The saved disposition (an exact retry returns the original); no occurrence, revision or verdict changes",body=ExceptionDispositionResponse),(status=400,description="exception_disposition_invalid (including a closure without evidence)",body=ExceptionDispositionErrorResponse),(status=401,body=crate::auth::ErrorResponse),(status=403,description="access_denied, or exception_close_forbidden for a person who is neither an Audit manager nor the Task's accountable person",body=ExceptionDispositionErrorResponse),(status=404,body=ExceptionDispositionErrorResponse),(status=409,description="reference_unverified (index), exception_already_closed, exception_not_closed, exception_disposition_conflict or exception_disposition_capacity",body=ExceptionDispositionErrorResponse),(status=429,body=crate::auth::ErrorResponse),(status=503,body=ExceptionDispositionErrorResponse)))]
pub(crate) async fn dispose(
    State(state): State<ExceptionState>,
    headers: HeaderMap,
    path: Result<Path<(String, String, String)>, axum::extract::rejection::PathRejection>,
    query: Result<Query<TaskScopeQuery>, QueryRejection>,
    body: Result<Json<ExceptionDispositionCommandRequest>, JsonRejection>,
) -> Response {
    let current = match state.identity.current(&headers).await {
        Ok(current) => current,
        Err(error) => return crate::auth::failure(error),
    };
    if !crate::operations::expected_actor_matches(&headers, &current.identity.id)
        || !state
            .identity
            .permits_mutation(&headers, &current.csrf_token)
    {
        return crate::auth::failure(zobba_application::identity::IdentityError::Denied);
    }
    let Some(token) = crate::auth::cookie(&headers, crate::auth::SESSION_COOKIE) else {
        return crate::auth::failure(zobba_application::identity::IdentityError::Unauthenticated);
    };
    let (Ok(Path((engagement_id, task_id, exception_id))), Ok(Query(query))) = (path, query) else {
        return refusal(ExceptionDispositionError::Invalid);
    };
    let scope = match query.scope(engagement_id) {
        Ok(scope) => scope,
        Err(_) => return refusal(ExceptionDispositionError::Denied),
    };
    let Ok(Json(body)) = body else {
        return refusal(ExceptionDispositionError::Invalid);
    };
    if !valid_scope_id(&task_id) || !valid_exception_id(&exception_id) {
        return refusal(ExceptionDispositionError::Invalid);
    }
    let Some(request) = command(exception_id, body) else {
        return refusal(ExceptionDispositionError::Invalid);
    };
    let evidence = state
        .evidence
        .clone()
        .with_session_hash(secret_hash(&token));
    let reader = PersonReader {
        metadata: &evidence,
        objects: state.objects.as_deref(),
        store: &state.assessments,
    };
    let actor = current.identity.id.clone();
    match save_exception_disposition(
        &state.assessments,
        &reader,
        &actor,
        &scope,
        &secret_hash(&token),
        &task_id,
        &request,
    )
    .await
    {
        Ok(record) => {
            let ids = reference_ids(std::iter::once(&record));
            let originals = state
                .citations
                .viewer_originals(&actor, &scope, &ids)
                .await
                .unwrap_or_default();
            Json(disposition_response(
                &record,
                Some(current.identity.display_name.clone()),
                &originals,
            ))
            .into_response()
        }
        Err(error) => refusal(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn body(kind: &str, references: usize) -> ExceptionDispositionCommandRequest {
        ExceptionDispositionCommandRequest {
            key: "key-1".into(),
            kind: kind.into(),
            rationale: "The approver confirmed in writing.".into(),
            references: (0..references)
                .map(|_| crate::revisions::DispositionReferenceRequest {
                    original_id: "ap-policy".into(),
                    locator: "bytes:0-8".into(),
                    quote: "Invoices".into(),
                })
                .collect(),
        }
    }
    fn id() -> String {
        format!("exc-{}", "1".repeat(40))
    }

    #[test]
    fn a_command_parses_only_its_closed_vocabulary() {
        assert!(command(id(), body("closed", 1)).is_some());
        assert!(command(id(), body("reopened", 0)).is_some());
        assert!(
            command(id(), body("waived", 1)).is_none(),
            "there are no waivers"
        );
        assert!(
            command(id(), body("closed", 0)).is_none(),
            "a closure cites evidence"
        );
        let mut odd = body("closed", 1);
        odd.references[0].locator = "bytes:00-8".into();
        assert!(command(id(), odd).is_none(), "a locator is canonical");
    }

    #[test]
    fn each_refusal_has_its_status() {
        let status = |e: ExceptionDispositionError| refusal(e).status();
        assert_eq!(
            status(ExceptionDispositionError::Invalid),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            status(ExceptionDispositionError::NotAuthorised),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            status(ExceptionDispositionError::AlreadyClosed),
            StatusCode::CONFLICT
        );
        assert_eq!(
            status(ExceptionDispositionError::NotClosed),
            StatusCode::CONFLICT
        );
        assert_eq!(
            status(ExceptionDispositionError::ReferenceUnverified(2)),
            StatusCode::CONFLICT
        );
        assert_eq!(
            status(ExceptionDispositionError::NotFound),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            status(ExceptionDispositionError::Unavailable),
            StatusCode::SERVICE_UNAVAILABLE
        );
    }
}
