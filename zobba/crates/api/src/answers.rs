//! Story 22.5 cited answers of a Task's current cycle. The answer text is
//! returned exactly as the model produced it; trusted verification adds a
//! result per source and never edits it. A citation never grants source
//! access: the quote, filename and storage version of a source the current
//! viewer cannot read are withheld, leaving only its closed verification.
use axum::{
    Json,
    extract::{Path, Query, State},
    http::HeaderMap,
    response::{IntoResponse, Response},
};
use serde::Serialize;
use utoipa::ToSchema;
use zobba_application::{citation::ReadingError, model::ModelStore, task::TaskError, work};
use zobba_domain::{
    citation::{CitationSource, Locator, Verification},
    identity::valid_scope_id,
    model::ModelError,
};
use zobba_infrastructure::citation::ViewerOriginal;

use crate::auth::ErrorResponse;
use crate::tasks::{TaskHttpState, TaskScopeQuery, failure};

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum CitationVerificationResponse {
    Verified,
    Unverified,
    /// Trusted verification of this answer failed; the source was not checked.
    Unchecked,
}

#[derive(Serialize, ToSchema)]
pub struct CitationSourceResponse {
    /// Exact registered original the model cited.
    pub original_id: String,
    /// False when the current viewer cannot read this original, or when
    /// verification did not establish the exact original. Its quote,
    /// filename, version, digest and location are then withheld.
    pub readable: bool,
    pub filename: Option<String>,
    /// Exact storage version and SHA-256 for evidence navigation.
    pub version: Option<String>,
    pub sha256: Option<String>,
    /// Canonical locator (`page:2`, `cell:Sheet1!B4`, `bytes:16-24`, ...).
    pub locator: Option<String>,
    /// Human label of the locator (`Page 2`, `Sheet1!B4`).
    pub location: Option<String>,
    /// Half-open byte range for a plain-text locator.
    pub byte_start: Option<u64>,
    pub byte_end: Option<u64>,
    /// The model's quoted text, at most 1000 UTF-8 bytes.
    pub quote: Option<String>,
    pub verification: CitationVerificationResponse,
    /// Closed reason when unverified: `not_found_at_location`,
    /// `location_missing`, `source_unreadable` or `page_only`.
    pub reason: Option<String>,
}

#[derive(Serialize, ToSchema)]
pub struct AnswerSegmentResponse {
    /// Exact segment text. Concatenating all segments gives the answer.
    pub text: String,
    /// Sources of this span, empty when the span is uncited.
    pub sources: Vec<CitationSourceResponse>,
}

#[derive(Serialize, ToSchema)]
pub struct CitedAnswerResponse {
    pub invocation_id: String,
    /// The unchanged answer text.
    pub text: String,
    pub segments: Vec<AnswerSegmentResponse>,
    /// Limitations the model stated about what it could not read.
    pub limitations: Vec<String>,
    /// True when trusted verification of this answer could not be completed;
    /// every source is then `unchecked`.
    pub verification_failed: bool,
}

#[derive(Serialize, ToSchema)]
pub struct TaskAnswersResponse {
    /// Verified answers of the current cycle, oldest first, at most 20.
    pub answers: Vec<CitedAnswerResponse>,
}

fn reading(error: ReadingError) -> TaskError {
    match error {
        ReadingError::Denied => TaskError::Denied,
        // A stored record that does not parse is a server fault, not a refusal.
        ReadingError::Invalid => TaskError::Unavailable,
        ReadingError::Fenced => TaskError::Fenced,
        ReadingError::Capacity => TaskError::Capacity,
        ReadingError::Unavailable => TaskError::Unavailable,
    }
}

#[utoipa::path(get,path="/engagements/{engagement_id}/tasks/{task_id}/answers",operation_id="get_task_answers",security(("server_session"=[])),
    params(("X-Expected-Session"=Option<String>,Header,description="Optional session-bound read precondition from the in-memory session CSRF token; mismatch refuses without changing the cookie",min_length=1,max_length=128),("engagement_id"=String,Path),("task_id"=String,Path),("organisation_id"=String,Query),("client_id"=String,Query)),
    responses((status=412,description="Session changed",body=ErrorResponse),(status=200,description="Cited answers with each source's trusted verification; the answer text is unchanged",body=TaskAnswersResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn get_answers(
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
    let Some((citations, invocations)) = &state.answers else {
        return failure(TaskError::Unavailable);
    };
    let actor = &current.identity.id;
    let stored = match citations.answers(actor, &scope, &task_id).await {
        Ok(stored) => stored,
        Err(error) => return failure(reading(error)),
    };
    // One batched lookup of every cited original, as the viewer sees it now.
    let ids: Vec<String> = stored
        .iter()
        .flat_map(|v| v.citations.iter())
        .flat_map(|c| c.sources.iter().map(|s| s.source.original_id.clone()))
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect();
    let originals = match citations.viewer_originals(actor, &scope, &ids).await {
        Ok(originals) => originals,
        Err(error) => return failure(reading(error)),
    };
    let mut answers = Vec::new();
    for verification in stored {
        // The invocation read rechecks the viewer's current audience.
        let invocation = match invocations
            .get(actor, &scope, &verification.invocation_id)
            .await
        {
            Ok(invocation) => invocation,
            Err(ModelError::Denied) => continue,
            Err(ModelError::Capacity) => return failure(TaskError::Capacity),
            Err(ModelError::Fenced) => return failure(TaskError::Fenced),
            Err(_) => return failure(TaskError::Unavailable),
        };
        // A read-only intermediate turn is not an answer.
        let Some(answer) = work::cited_answer(&invocation).filter(|a| a.is_answer()) else {
            continue;
        };
        let failed = verification.failed;
        let mut segments = Vec::new();
        for (index, segment) in answer.segments.iter().enumerate() {
            let sources = if failed {
                segment
                    .sources
                    .iter()
                    .map(|source| unchecked(source))
                    .collect()
            } else {
                verification
                    .citations
                    .iter()
                    .find(|c| c.segment as usize == index)
                    .map(|citation| {
                        citation
                            .sources
                            .iter()
                            .map(|verified| {
                                // Only the exact original verification read is navigable.
                                let original = verified.original_sha256.as_ref().and_then(|sha| {
                                    originals
                                        .get(&verified.source.original_id)
                                        .filter(|o| &o.sha256 == sha)
                                });
                                source_response(
                                    &verified.source,
                                    original,
                                    match verified.verification {
                                        Verification::Verified => {
                                            (CitationVerificationResponse::Verified, None)
                                        }
                                        Verification::Unverified(reason) => (
                                            CitationVerificationResponse::Unverified,
                                            Some(reason.as_str().to_string()),
                                        ),
                                    },
                                )
                            })
                            .collect()
                    })
                    .unwrap_or_default()
            };
            segments.push(AnswerSegmentResponse {
                text: segment.text.clone(),
                sources,
            });
        }
        answers.push(CitedAnswerResponse {
            invocation_id: verification.invocation_id,
            text: answer.text(),
            segments,
            limitations: answer.limitations.clone(),
            verification_failed: failed,
        });
    }
    Json(TaskAnswersResponse { answers }).into_response()
}

fn unchecked(source: &CitationSource) -> CitationSourceResponse {
    // No exact original was established, so nothing is navigable.
    source_response(source, None, (CitationVerificationResponse::Unchecked, None))
}

fn source_response(
    source: &CitationSource,
    original: Option<&ViewerOriginal>,
    (verification, reason): (CitationVerificationResponse, Option<String>),
) -> CitationSourceResponse {
    let readable = original.is_some();
    let locator = source.locator.as_ref().filter(|_| readable);
    let (byte_start, byte_end) = match locator {
        Some(Locator::Bytes { start, end }) => (Some(*start), Some(*end)),
        _ => (None, None),
    };
    CitationSourceResponse {
        original_id: source.original_id.clone(),
        readable,
        filename: original.and_then(|o| o.filename.clone()),
        version: original.map(|o| o.version.clone()),
        sha256: original.map(|o| o.sha256.clone()),
        locator: locator.map(Locator::render),
        location: locator.map(Locator::label),
        byte_start,
        byte_end,
        quote: readable.then(|| source.quote.clone()),
        verification,
        reason,
    }
}
