//! Story 24.3a: evaluation revision history and human dispositions.
//!
//! A person (a currently assigned Auditor or Audit manager; Admin alone is
//! refused) saves a disposition of one exact revision through an
//! authenticated POST: Origin, session CSRF, the expected-actor fence and a
//! request key that is idempotent per actor. Each evidence reference is
//! verified at write time; an unverified one refuses the whole request (409
//! `reference_unverified`, naming its index). A disposition on a revision
//! that is no longer the head is refused (409 `revision_superseded`, naming
//! the head). A rule verdict is never replaced (400 `not_replaceable`). The
//! history route lists a chain's revisions in order with an exact count; a
//! fact's value is withheld from a viewer who cannot read its original now.
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
    assessment::revision::{ChainHead, DispositionRecord, HistoryEntry},
    disposition::{DispositionError, PersonReader, save_disposition},
    task::TaskError,
};
use zobba_domain::{
    assessment::Verdict,
    citation::{CitationSource, Locator},
    identity::valid_scope_id,
    revision::{Concern, DispositionKind, DispositionRequest, effective, valid_revision_id},
};
use zobba_infrastructure::{
    assessment::AssessmentRepository,
    citation::{CitationRepository, ViewerOriginal},
    evidence::{EvidenceRepository, s3::S3EvidenceObjects},
    identity::secret_hash,
};

use crate::{
    auth::AuthState,
    tasks::{TaskScopeQuery, failure},
    work::{EvaluationInputResponse, JudgmentResponse},
};

type Originals = BTreeMap<String, ViewerOriginal>;

#[derive(Clone)]
pub(crate) struct RevisionState {
    identity: AuthState,
    assessments: AssessmentRepository,
    citations: CitationRepository,
    evidence: EvidenceRepository,
    objects: Option<Arc<S3EvidenceObjects>>,
}

pub(crate) fn router(
    pool: sqlx::PgPool,
    identity: AuthState,
    objects: Option<Arc<S3EvidenceObjects>>,
) -> Router {
    let capacity = Arc::new(Semaphore::new(4));
    Router::new()
        .route(
            "/engagements/{engagement_id}/tasks/{task_id}/assessment/chains/{chain_id}/history",
            get(history),
        )
        .route(
            "/engagements/{engagement_id}/tasks/{task_id}/assessment/revisions/{revision_id}/dispositions",
            post(dispose),
        )
        .with_state(RevisionState {
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

/// A person's disposition of one exact revision. It never changes the
/// revision: `replaced` is a separate human verdict.
#[derive(Serialize, ToSchema)]
pub struct DispositionResponse {
    pub id: String,
    /// The exact revision: the 24.1 evaluation (revision 1) or a revision.
    pub revision_id: String,
    pub chain_id: String,
    #[schema(pattern = "^[0-9]+$")]
    pub revision: String,
    pub actor_id: String,
    /// The person's public label, when known.
    #[schema(required = true)]
    pub actor_label: Option<String>,
    /// `accepted`, `replaced` or `needs_reconsideration`.
    pub kind: String,
    /// `facts`, `rule`, `authority` or `scope` (needs_reconsideration only).
    #[schema(required = true)]
    pub concern: Option<String>,
    /// The person's verdict (replaced only).
    #[schema(required = true)]
    pub verdict: Option<String>,
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

/// The current head of one evaluation chain and its review state.
#[derive(Serialize, ToSchema)]
pub struct ChainResponse {
    pub chain_id: String,
    pub head_id: String,
    #[schema(pattern = "^[0-9]+$")]
    pub revision: String,
    pub basis_id: String,
    pub criterion_id: String,
    pub applicability: String,
    pub execution: String,
    #[schema(required = true)]
    pub verdict: Option<String>,
    #[schema(required = true)]
    pub reason: Option<String>,
    pub origin: String,
    /// The head's closed causes (none for revision 1).
    #[schema(max_items = 5)]
    pub causes: Vec<String>,
    /// The verdict after the head's newest disposition.
    #[schema(required = true)]
    pub effective_verdict: Option<String>,
    /// `deterministic`, `model_proposal` or `human`.
    pub effective_origin: String,
    /// `unreviewed`, `accepted`, `replaced` or `pending_reconsideration`.
    pub review: String,
    /// An earlier revision of this chain was accepted (this one is not yet).
    pub earlier_accepted: bool,
    #[schema(required = true)]
    pub disposition: Option<DispositionResponse>,
}

#[derive(Serialize, ToSchema)]
pub struct ReplacedFactResponse {
    pub from: String,
    pub to: String,
}

#[derive(Serialize, ToSchema)]
pub struct ChangesResponse {
    #[schema(max_items = 32)]
    pub added: Vec<String>,
    #[schema(max_items = 32)]
    pub removed: Vec<String>,
    #[schema(max_items = 32)]
    pub replaced: Vec<ReplacedFactResponse>,
}

/// One revision of a chain, unchanged since it was recorded.
#[derive(Serialize, ToSchema)]
pub struct HistoryEntryResponse {
    #[schema(pattern = "^[0-9]+$")]
    pub revision: String,
    pub id: String,
    pub invocation_id: String,
    #[schema(required = true)]
    pub predecessor_id: Option<String>,
    pub basis_id: String,
    pub criterion_id: String,
    pub applicability: String,
    pub execution: String,
    #[schema(required = true)]
    pub verdict: Option<String>,
    #[schema(required = true)]
    pub reason: Option<String>,
    pub origin: String,
    #[schema(max_items = 32)]
    pub inputs: Vec<EvaluationInputResponse>,
    #[schema(pattern = "^[0-9a-f]{64}$")]
    pub output_digest: String,
    #[schema(required = true)]
    pub judgment: Option<JudgmentResponse>,
    #[schema(max_items = 5)]
    pub causes: Vec<String>,
    pub changes: ChangesResponse,
    #[schema(required = true, pattern = "^[0-9]+$")]
    pub recorded_us: Option<String>,
    #[schema(max_items = 16)]
    pub dispositions: Vec<DispositionResponse>,
}

/// One page of a chain's history in revision order, with the exact number
/// of its revisions and the facts the listed revisions read.
#[derive(Serialize, ToSchema)]
pub struct ChainHistoryResponse {
    pub chain_id: String,
    pub subject: String,
    #[schema(pattern = "^[0-9]+$")]
    pub total: String,
    pub head_id: String,
    #[schema(max_items = 50)]
    pub entries: Vec<HistoryEntryResponse>,
    #[schema(max_items = 1600)]
    pub facts: Vec<crate::work::AssessmentFactResponse>,
    /// The revision number after which the next page starts.
    #[schema(required = true, pattern = "^[0-9]+$")]
    pub next_cursor: Option<String>,
}

fn source_of(
    source: &CitationSource,
    sha: &str,
    originals: &Originals,
) -> crate::answers::CitationSourceResponse {
    crate::answers::source_response(
        source,
        crate::answers::exact_original(originals, &source.original_id, Some(sha)),
        (crate::answers::CitationVerificationResponse::Verified, None),
    )
}

pub(crate) fn disposition_response(
    record: &DispositionRecord,
    label: Option<String>,
    originals: &Originals,
) -> DispositionResponse {
    let r = &record.request;
    DispositionResponse {
        id: record.id.clone(),
        revision_id: r.revision_id.clone(),
        chain_id: record.chain_id.clone(),
        revision: record.revision.to_string(),
        actor_id: record.actor_id.clone(),
        actor_label: label,
        kind: r.kind.as_str().into(),
        concern: r.concern.map(|c| c.as_str().into()),
        verdict: r.verdict.map(|v| v.as_str().into()),
        rationale: r.rationale.clone(),
        references: record
            .references
            .iter()
            .map(|(s, sha)| source_of(s, sha, originals))
            .collect(),
        recorded_us: record.recorded_us.map(|u| u.to_string()),
    }
}

/// Every original a set of dispositions references.
pub(crate) fn disposition_originals<'a>(
    records: impl Iterator<Item = &'a DispositionRecord>,
) -> Vec<String> {
    let mut ids: Vec<String> = records
        .flat_map(|d| d.references.iter().map(|(s, _)| s.original_id.clone()))
        .collect();
    ids.sort();
    ids.dedup();
    ids
}

pub(crate) fn chain_response(
    head: &ChainHead,
    label: Option<String>,
    earlier_accepted: bool,
    originals: &Originals,
) -> ChainResponse {
    let o = head.outcome();
    let effective = effective(
        o,
        head.disposition.as_ref().map(DispositionRecord::decision),
    );
    ChainResponse {
        chain_id: head.chain_id().into(),
        head_id: head.head_id().into(),
        revision: head.revision().to_string(),
        basis_id: head.basis_id().into(),
        criterion_id: head.criterion_id().into(),
        applicability: o.applicability.as_str().into(),
        execution: o.execution.as_str().into(),
        verdict: o.verdict.map(|v| v.as_str().into()),
        reason: o.reason.map(|r| r.as_str().into()),
        origin: o.origin.as_str().into(),
        causes: head
            .head
            .as_ref()
            .map(|h| h.causes.iter().map(|c| c.as_str().into()).collect())
            .unwrap_or_default(),
        effective_verdict: effective.verdict.map(|v| v.as_str().into()),
        effective_origin: effective.origin.as_str().into(),
        review: effective.review.as_str().into(),
        earlier_accepted,
        disposition: head
            .disposition
            .as_ref()
            .map(|d| disposition_response(d, label, originals)),
    }
}

fn entry_response(entry: &HistoryEntry, originals: &Originals) -> HistoryEntryResponse {
    let o = &entry.outcome;
    HistoryEntryResponse {
        revision: entry.revision.to_string(),
        id: entry.id.clone(),
        invocation_id: entry.invocation_id.clone(),
        predecessor_id: entry.predecessor_id.clone(),
        basis_id: entry.basis_id.clone(),
        criterion_id: entry.criterion_id.clone(),
        applicability: o.applicability.as_str().into(),
        execution: o.execution.as_str().into(),
        verdict: o.verdict.map(|v| v.as_str().into()),
        reason: o.reason.map(|r| r.as_str().into()),
        origin: o.origin.as_str().into(),
        inputs: o
            .inputs
            .iter()
            .map(|(id, digest)| EvaluationInputResponse {
                fact_id: id.clone(),
                digest: digest.clone(),
            })
            .collect(),
        output_digest: entry.output_digest.clone(),
        judgment: entry.judgment.as_ref().map(|j| JudgmentResponse {
            supporting: j.supporting.clone(),
            contrary: j.contrary.clone(),
            rationale: j.rationale.clone(),
            uncertainty: j.uncertainty.clone(),
        }),
        causes: entry.causes.iter().map(|c| c.as_str().into()).collect(),
        changes: ChangesResponse {
            added: entry.changes.added.clone(),
            removed: entry.changes.removed.clone(),
            replaced: entry
                .changes
                .replaced
                .iter()
                .map(|(from, to)| ReplacedFactResponse {
                    from: from.clone(),
                    to: to.clone(),
                })
                .collect(),
        },
        recorded_us: entry.recorded_us.map(|u| u.to_string()),
        dispositions: entry
            .dispositions
            .iter()
            .map(|(d, label)| disposition_response(d, Some(label.clone()), originals))
            .collect(),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct HistoryQuery {
    organisation_id: String,
    client_id: String,
    cursor: Option<String>,
}

#[utoipa::path(get,path="/engagements/{engagement_id}/tasks/{task_id}/assessment/chains/{chain_id}/history",operation_id="get_evaluation_history",security(("server_session"=[])),
    params(("X-Expected-Session"=Option<String>,Header,description="Optional session-bound read precondition from the in-memory session CSRF token; mismatch refuses without changing the cookie",min_length=1,max_length=128),("engagement_id"=String,Path),("task_id"=String,Path),("chain_id"=String,Path,description="The chain's revision 1: a 24.1 evaluation ID"),("organisation_id"=String,Query),("client_id"=String,Query),
        ("cursor"=Option<String>,Query,description="next_cursor of the previous page",pattern="^[0-9]{1,7}$")),
    responses((status=200,description="The exact number of a chain's revisions and one page of them in revision order, each with its causes, changed facts and dispositions; earlier revisions are never changed",body=ChainHistoryResponse),(status=400,body=crate::auth::ErrorResponse),(status=401,body=crate::auth::ErrorResponse),(status=403,body=crate::auth::ErrorResponse),(status=412,description="Session changed",body=crate::auth::ErrorResponse),(status=429,body=crate::auth::ErrorResponse),(status=503,body=crate::auth::ErrorResponse)))]
pub(crate) async fn history(
    State(state): State<RevisionState>,
    headers: HeaderMap,
    path: Result<Path<(String, String, String)>, axum::extract::rejection::PathRejection>,
    query: Result<Query<HistoryQuery>, QueryRejection>,
) -> Response {
    let current = match state.identity.current_read(&headers).await {
        Ok(current) => current,
        Err(error) => return crate::auth::failure(error),
    };
    let (Ok(Path((engagement_id, task_id, chain_id))), Ok(Query(query))) = (path, query) else {
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
    if !valid_scope_id(&task_id) || !chain_id.starts_with("eval-") || !valid_revision_id(&chain_id)
    {
        return failure(TaskError::Denied);
    }
    let after = match query.cursor.as_deref() {
        None => None,
        Some(text) => match (text.len() <= 7 && text.bytes().all(|b| b.is_ascii_digit()))
            .then(|| text.parse::<u32>().ok())
            .flatten()
        {
            Some(after) => Some(after),
            None => return failure(TaskError::Invalid),
        },
    };
    let page = match state
        .assessments
        .history(&current.identity.id, &scope, &task_id, &chain_id, after)
        .await
    {
        Ok(Some(page)) => page,
        // A chain this Task does not hold is refused like any record
        // outside the viewer's scope.
        Ok(None) => return failure(TaskError::Denied),
        Err(error) => return failure(error),
    };
    let mut ids: Vec<String> = page
        .facts
        .iter()
        .flat_map(|f| f.sources.iter().map(|s| s.source.original_id.clone()))
        .collect();
    ids.extend(disposition_originals(
        page.entries
            .iter()
            .flat_map(|e| e.dispositions.iter().map(|(d, _)| d)),
    ));
    ids.sort();
    ids.dedup();
    let originals = match state
        .citations
        .viewer_originals(&current.identity.id, &scope, &ids)
        .await
    {
        Ok(originals) => originals,
        Err(_) => return failure(TaskError::Unavailable),
    };
    Json(ChainHistoryResponse {
        chain_id: page.chain_id.clone(),
        subject: page.subject.clone(),
        total: page.total.to_string(),
        head_id: page.head_id.clone(),
        entries: page
            .entries
            .iter()
            .map(|e| entry_response(e, &originals))
            .collect(),
        facts: page
            .facts
            .iter()
            .map(|f| crate::work::fact_response(f, &originals))
            .collect(),
        next_cursor: page.next.map(|n| n.to_string()),
    })
    .into_response()
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct DispositionReferenceRequest {
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub original_id: String,
    /// An exact canonical locator (`cell:Sheet1!D7`, `bytes:16-24`, ...).
    #[schema(max_length = 300)]
    pub locator: String,
    /// The exact quoted text at that location.
    #[schema(max_length = 1000)]
    pub quote: String,
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct DispositionCommandRequest {
    /// Request key, idempotent per actor.
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub key: String,
    /// `accepted`, `replaced` or `needs_reconsideration`.
    pub kind: String,
    /// `facts`, `rule`, `authority` or `scope`: exactly for needs_reconsideration.
    pub concern: Option<String>,
    /// `met`, `not_met` or `undetermined`: exactly for replaced.
    pub verdict: Option<String>,
    /// 1–2,000 UTF-8 bytes.
    #[schema(max_length = 2000)]
    pub rationale: String,
    #[schema(max_items = 8)]
    pub references: Vec<DispositionReferenceRequest>,
}

/// A refusal of a disposition. `head_id` names the current head of a
/// superseded revision's chain; `index` names an unverified reference.
#[derive(Serialize, ToSchema)]
pub struct DispositionErrorResponse {
    pub error: &'static str,
    #[schema(required = true)]
    pub head_id: Option<String>,
    #[schema(required = true)]
    pub index: Option<u32>,
}

fn refusal(error: DispositionError) -> Response {
    let (status, head_id, index) = match &error {
        DispositionError::Invalid | DispositionError::NotReplaceable => {
            (StatusCode::BAD_REQUEST, None, None)
        }
        DispositionError::ReferenceUnverified(i) => (StatusCode::CONFLICT, None, Some(*i as u32)),
        DispositionError::RevisionSuperseded(head) => {
            (StatusCode::CONFLICT, Some(head.clone()), None)
        }
        DispositionError::NotFound => (StatusCode::NOT_FOUND, None, None),
        DispositionError::Denied => (StatusCode::FORBIDDEN, None, None),
        DispositionError::Conflict | DispositionError::Capacity => {
            (StatusCode::CONFLICT, None, None)
        }
        DispositionError::Unavailable => (StatusCode::SERVICE_UNAVAILABLE, None, None),
    };
    (
        status,
        Json(DispositionErrorResponse {
            error: error.code(),
            head_id,
            index,
        }),
    )
        .into_response()
}

fn command(revision_id: String, body: DispositionCommandRequest) -> Option<DispositionRequest> {
    let parse_opt = |value: Option<String>, parse: fn(&str) -> bool| match value {
        None => Some(None),
        Some(v) if parse(&v) => Some(Some(v)),
        Some(_) => None,
    };
    let concern = parse_opt(body.concern, |v| Concern::parse(v).is_some())?;
    let verdict = parse_opt(body.verdict, |v| Verdict::parse(v).is_some())?;
    let request = DispositionRequest {
        key: body.key,
        revision_id,
        kind: DispositionKind::parse(&body.kind)?,
        concern: concern.and_then(|c| Concern::parse(&c)),
        verdict: verdict.and_then(|v| Verdict::parse(&v)),
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

#[utoipa::path(post,path="/engagements/{engagement_id}/tasks/{task_id}/assessment/revisions/{revision_id}/dispositions",operation_id="save_disposition",security(("server_session"=[])),
    params(("engagement_id"=String,Path),("task_id"=String,Path),("revision_id"=String,Path,description="The exact revision: a 24.1 evaluation or a revision ID"),("organisation_id"=String,Query),("client_id"=String,Query),("Origin"=String,Header,description="Exact configured HTTPS application origin"),("X-CSRF-Token"=String,Header,description="Current session-bound token"),("X-Expected-Actor"=String,Header,description="Required refusal fence for the current session actor; never supplies author authority",min_length=1,max_length=128,pattern="^[A-Za-z0-9_-]+$")),
    request_body=DispositionCommandRequest,
    responses((status=200,description="The saved disposition (an exact retry returns the original); the revision is unchanged",body=DispositionResponse),(status=400,description="disposition_invalid or not_replaceable",body=DispositionErrorResponse),(status=401,body=crate::auth::ErrorResponse),(status=403,body=crate::auth::ErrorResponse),(status=404,body=DispositionErrorResponse),(status=409,description="reference_unverified (index), revision_superseded (head_id), disposition_conflict or disposition_capacity",body=DispositionErrorResponse),(status=429,body=crate::auth::ErrorResponse),(status=503,body=DispositionErrorResponse)))]
pub(crate) async fn dispose(
    State(state): State<RevisionState>,
    headers: HeaderMap,
    path: Result<Path<(String, String, String)>, axum::extract::rejection::PathRejection>,
    query: Result<Query<TaskScopeQuery>, QueryRejection>,
    body: Result<Json<DispositionCommandRequest>, JsonRejection>,
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
    let (Ok(Path((engagement_id, task_id, revision_id))), Ok(Query(query))) = (path, query) else {
        return refusal(DispositionError::Invalid);
    };
    let scope = match query.scope(engagement_id) {
        Ok(scope) => scope,
        Err(_) => return refusal(DispositionError::Denied),
    };
    let Ok(Json(body)) = body else {
        return refusal(DispositionError::Invalid);
    };
    if !valid_scope_id(&task_id) || !valid_revision_id(&revision_id) {
        return refusal(DispositionError::Invalid);
    }
    let Some(request) = command(revision_id, body) else {
        return refusal(DispositionError::Invalid);
    };
    // Evidence reads are bound to this exact session, like every other
    // person-facing original read.
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
    match save_disposition(
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
            let ids = disposition_originals(std::iter::once(&record));
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
mod tests;
