//! Admin methodology document proposals (Story 22.6 AC4). A proposal is
//! editable configuration data; only the ordinary validated Save makes a
//! method effective. Production composes no proposal transport.
use crate::{
    auth::{self, AuthState, ErrorResponse},
    methodology::{MethodologyDefinition, MethodologySource},
};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Path, State, rejection::JsonRejection},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
};
use serde::{Deserialize, Serialize};
use std::{sync::Arc, time::Duration};
use tokio::sync::Semaphore;
use utoipa::ToSchema;
use zobba_application::{
    model::{ModelCancellation, ModelQualificationSource},
    proposal::{
        MAX_PROPOSAL_DOCUMENT_BYTES, ProposalError, ProposalResult, ProposalStore, Proposals,
        ProposeMethodology, StoredProposal, exact_retry,
    },
};
use zobba_domain::{identity::valid_scope_id, work::sha256_hex};
use zobba_infrastructure::{
    evidence::s3::S3EvidenceObjects, identity::secret_hash, model::native::NativeAdapter,
    proposal::ProposalRepository,
};

/// Drafts in flight at once; reads have their own limit and never wait on it.
const PROPOSAL_WRITES: usize = 2;
const PROPOSAL_READS: usize = 8;
/// How long a POST waits for its draft before answering with the recorded
/// status (in progress). The draft itself continues detached.
const PROPOSAL_WAIT: Duration = Duration::from_secs(10);
/// Large enough for a 200,000-byte document after JSON escaping.
const PROPOSAL_BODY_BYTES: usize = 2 * 1024 * 1024;

/// Explicit composition of the Admin proposal path.
#[derive(Clone)]
pub struct ProposalComposition {
    pub objects: Option<Arc<S3EvidenceObjects>>,
    /// None in production: no live qualification has been approved.
    pub transport: Option<Arc<NativeAdapter>>,
    pub qualifications: Arc<dyn ModelQualificationSource>,
}

#[derive(Clone)]
pub(crate) struct ProposalState {
    identity: AuthState,
    repository: ProposalRepository,
    composition: ProposalComposition,
    writes: Arc<Semaphore>,
}

pub(crate) fn router(
    pool: sqlx::PgPool,
    identity: AuthState,
    composition: ProposalComposition,
) -> Router {
    let reads = Arc::new(Semaphore::new(PROPOSAL_READS));
    Router::new()
        .route(
            "/methodology/organisations/{organisation_id}/proposals",
            get(list).post(propose),
        )
        .route(
            "/methodology/organisations/{organisation_id}/proposals/{proposal_id}",
            get(read),
        )
        .with_state(ProposalState {
            identity,
            repository: ProposalRepository::new(pool)
                .with_qualification_source(composition.qualifications.clone()),
            composition,
            writes: Arc::new(Semaphore::new(PROPOSAL_WRITES)),
        })
        .layer(DefaultBodyLimit::max(PROPOSAL_BODY_BYTES))
        .layer(axum::middleware::from_fn(
            move |request: axum::extract::Request, next: axum::middleware::Next| {
                let reads = reads.clone();
                async move {
                    // A POST takes its own write permit, held by the detached
                    // draft; reads are limited separately.
                    let _permit = if request.method() == axum::http::Method::POST {
                        None
                    } else {
                        match reads.try_acquire_owned() {
                            Ok(permit) => Some(permit),
                            Err(_) => return failure(ProposalError::Capacity),
                        }
                    };
                    match tokio::time::timeout(Duration::from_secs(14), next.run(request)).await {
                        Ok(response) => response,
                        Err(_) => failure(ProposalError::Unavailable),
                    }
                }
            },
        ))
}

fn failure(error: ProposalError) -> Response {
    let status = match error {
        ProposalError::Invalid => StatusCode::BAD_REQUEST,
        ProposalError::Denied => StatusCode::FORBIDDEN,
        ProposalError::Conflict => StatusCode::CONFLICT,
        ProposalError::Capacity => StatusCode::TOO_MANY_REQUESTS,
        ProposalError::Unavailable | ProposalError::Integrity => StatusCode::SERVICE_UNAVAILABLE,
    };
    (
        status,
        Json(ErrorResponse {
            error: error.code(),
        }),
    )
        .into_response()
}

async fn current(
    state: &ProposalState,
    headers: &HeaderMap,
    mutation: bool,
) -> Result<(String, ProposalRepository), Box<Response>> {
    let current = state
        .identity
        .current_read(headers)
        .await
        .map_err(|error| Box::new(auth::failure(error)))?;
    if mutation {
        let mut values = headers.get_all("x-expected-actor").iter();
        let expected = values.next().and_then(|value| value.to_str().ok());
        if expected != Some(current.identity.id.as_str())
            || values.next().is_some()
            || !state
                .identity
                .permits_mutation(headers, &current.csrf_token)
        {
            return Err(Box::new(failure(ProposalError::Denied)));
        }
    }
    let token = auth::cookie(headers, auth::SESSION_COOKIE)
        .ok_or_else(|| Box::new(failure(ProposalError::Denied)))?;
    Ok((
        current.identity.id,
        state
            .repository
            .clone()
            .with_session_hash(secret_hash(&token)),
    ))
}

#[derive(Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ProposeMethodologyRequest {
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub key: String,
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub profile_id: String,
    #[schema(min_length = 1, max_length = 200)]
    pub filename: String,
    /// Plain UTF-8 documents only; other formats are refused, not guessed.
    #[schema(value_type = String, pattern = "^text/(plain|markdown)$")]
    pub media_type: String,
    /// The exact document text: at most 200,000 UTF-8 bytes (not
    /// characters). A longer document is refused as `document_too_large`.
    #[schema(min_length = 1, max_length = 200000)]
    pub text: String,
}

#[derive(Serialize, ToSchema)]
pub struct ProposalLocation {
    /// UTF-8 byte offsets of the exact quote, and its 1-based line.
    #[schema(value_type = String)]
    pub start: String,
    #[schema(value_type = String)]
    pub end: String,
    #[schema(value_type = String)]
    pub line: String,
}

#[derive(Serialize, ToSchema)]
pub struct ProposalCitation {
    pub field: String,
    pub quote: String,
    pub location: ProposalLocation,
}

#[derive(Serialize, ToSchema)]
pub struct ProposalConflictResponse {
    pub text: String,
    pub quote: String,
    pub location: ProposalLocation,
}

#[derive(Serialize, ToSchema)]
pub struct ProposalDisclosureResponse {
    pub filename: String,
    pub media_type: String,
    pub document_sha256: String,
    #[schema(value_type = String)]
    pub document_size: String,
    pub profile_id: String,
    #[schema(value_type = String)]
    pub profile_revision: String,
    pub provider: String,
    pub model: String,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ProposalStatus {
    Drafted,
    Failed,
    /// The document was disclosed and its draft is still within its send
    /// window. Read again later; it is never sent again under the same key.
    InProgress,
    /// The document was possibly sent and no result was recorded within the
    /// send window. It is never sent again under the same key.
    Uncertain,
}

#[derive(Serialize, ToSchema)]
pub struct MethodologyProposalResponse {
    pub id: String,
    pub key: String,
    pub actor_id: String,
    pub disclosure: ProposalDisclosureResponse,
    pub status: ProposalStatus,
    pub reason: Option<String>,
    /// The editable draft in the Save editor shape. It has no effect until a
    /// validated Save.
    pub definition: Option<MethodologyDefinition>,
    pub source: Option<MethodologySource>,
    #[schema(max_items = 4096)]
    pub citations: Vec<ProposalCitation>,
    #[schema(max_items = 64)]
    pub conflicts: Vec<ProposalConflictResponse>,
    #[schema(max_items = 128)]
    pub missing_criteria: Vec<String>,
    #[schema(max_items = 4096)]
    pub unverified: Vec<String>,
}

#[derive(Serialize, ToSchema)]
pub struct MethodologyProposalList {
    #[schema(max_items = 20)]
    pub proposals: Vec<MethodologyProposalResponse>,
}

fn location(l: &zobba_application::proposal::Location) -> ProposalLocation {
    ProposalLocation {
        start: l.start.to_string(),
        end: l.end.to_string(),
        line: l.line.to_string(),
    }
}

fn response(p: StoredProposal) -> MethodologyProposalResponse {
    let in_progress = p.in_progress();
    let disclosure = ProposalDisclosureResponse {
        filename: p.disclosure.filename,
        media_type: p.disclosure.media_type,
        document_sha256: p.disclosure.document_sha256,
        document_size: p.disclosure.document_size.to_string(),
        profile_id: p.disclosure.profile_id,
        profile_revision: p.disclosure.profile_revision.to_string(),
        provider: p.disclosure.provider,
        model: p.disclosure.model,
    };
    let mut out = MethodologyProposalResponse {
        id: p.id,
        key: p.key,
        actor_id: p.actor_id,
        disclosure,
        status: if in_progress {
            ProposalStatus::InProgress
        } else {
            ProposalStatus::Uncertain
        },
        reason: None,
        definition: None,
        source: None,
        citations: vec![],
        conflicts: vec![],
        missing_criteria: vec![],
        unverified: vec![],
    };
    match p.result {
        None => {}
        Some(ProposalResult::Failed { reason }) => {
            out.status = ProposalStatus::Failed;
            out.reason = Some(reason);
        }
        Some(ProposalResult::Drafted(d)) => {
            out.status = ProposalStatus::Drafted;
            out.definition = Some(d.definition.into());
            out.source = Some(d.source.into());
            out.citations = d
                .citations
                .iter()
                .map(|c| ProposalCitation {
                    field: c.field.clone(),
                    quote: c.quote.clone(),
                    location: location(&c.location),
                })
                .collect();
            out.conflicts = d
                .conflicts
                .iter()
                .map(|c| ProposalConflictResponse {
                    text: c.text.clone(),
                    quote: c.quote.clone(),
                    location: location(&c.location),
                })
                .collect();
            out.missing_criteria = d.missing_criteria;
            out.unverified = d.unverified;
        }
    }
    out
}

#[utoipa::path(post, path="/methodology/organisations/{organisation_id}/proposals", operation_id="propose_methodology", security(("server_session"=[])),
    params(("organisation_id"=String,Path),("X-Expected-Session"=Option<String>,Header),("Origin"=String,Header),("X-CSRF-Token"=String,Header),("X-Expected-Actor"=String,Header,description="Required exact current actor refusal fence")), request_body=ProposeMethodologyRequest,
    responses((status=200,description="The recorded proposal: drafted, failed, in progress (still being drafted) or uncertain",body=MethodologyProposalResponse),(status=400,body=ErrorResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=409,body=ErrorResponse),(status=412,body=ErrorResponse),(status=413,description="The document is over 200,000 UTF-8 bytes",body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn propose(
    State(state): State<ProposalState>,
    headers: HeaderMap,
    Path(organisation): Path<String>,
    body: Result<Json<ProposeMethodologyRequest>, JsonRejection>,
) -> Response {
    let (actor, repository) = match current(&state, &headers, true).await {
        Ok(value) => value,
        Err(response) => return *response,
    };
    if !valid_scope_id(&organisation) {
        return failure(ProposalError::Denied);
    }
    let body = match body {
        Ok(Json(body)) => body,
        Err(rejection) if rejection.status() == StatusCode::PAYLOAD_TOO_LARGE => {
            return too_large();
        }
        Err(_) => return failure(ProposalError::Invalid),
    };
    if body.text.len() > MAX_PROPOSAL_DOCUMENT_BYTES {
        return too_large();
    }
    let request = ProposeMethodology {
        key: body.key,
        profile_id: body.profile_id,
        filename: body.filename,
        media_type: body.media_type,
        text: body.text,
    };
    if !request.is_valid() {
        return failure(ProposalError::Invalid);
    }
    // Admin authority is checked first; an exact retry is answered from the
    // recorded fact before an object store or transport is required.
    match repository.by_key(&actor, &organisation, &request.key).await {
        Ok(Some(existing)) => {
            return match exact_retry(existing, &request, &sha256_hex(request.text.as_bytes())) {
                Ok(stored) => Json(response(stored)).into_response(),
                Err(error) => failure(error),
            };
        }
        Ok(None) => {}
        Err(error) => return failure(error),
    }
    let Some(objects) = state.composition.objects.clone() else {
        return failure(ProposalError::Unavailable);
    };
    let Ok(permit) = state.writes.clone().try_acquire_owned() else {
        return failure(ProposalError::Capacity);
    };
    let transport = state.composition.transport.clone();
    let (task_actor, task_organisation, task_repository, task_request) = (
        actor.clone(),
        organisation.clone(),
        repository.clone(),
        request.clone(),
    );
    // The draft runs detached: once the disclosure is recorded, dropping the
    // request (timeout, disconnect) never abandons the possible send before
    // its result is recorded.
    let draft = tokio::spawn(async move {
        let _permit = permit;
        let proposals = Proposals {
            store: &task_repository,
            objects: objects.as_ref(),
            transport: transport.as_deref(),
        };
        proposals
            .propose(
                &task_actor,
                &task_organisation,
                &task_request,
                &ModelCancellation::new(),
            )
            .await
    });
    match tokio::time::timeout(PROPOSAL_WAIT, draft).await {
        Ok(Ok(Ok(stored))) => Json(response(stored)).into_response(),
        Ok(Ok(Err(error))) => failure(error),
        Ok(Err(_)) => failure(ProposalError::Unavailable),
        // Still drafting: answer with the recorded fact (in progress).
        Err(_) => match repository.by_key(&actor, &organisation, &request.key).await {
            Ok(Some(stored)) => Json(response(stored)).into_response(),
            Ok(None) => failure(ProposalError::Unavailable),
            Err(error) => failure(error),
        },
    }
}

fn too_large() -> Response {
    (
        StatusCode::PAYLOAD_TOO_LARGE,
        Json(ErrorResponse {
            error: "document_too_large",
        }),
    )
        .into_response()
}

#[utoipa::path(get, path="/methodology/organisations/{organisation_id}/proposals", operation_id="methodology_proposals", security(("server_session"=[])),
    params(("organisation_id"=String,Path),("X-Expected-Session"=Option<String>,Header)),
    responses((status=200,body=MethodologyProposalList),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=412,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn list(
    State(state): State<ProposalState>,
    headers: HeaderMap,
    Path(organisation): Path<String>,
) -> Response {
    let (actor, repository) = match current(&state, &headers, false).await {
        Ok(value) => value,
        Err(response) => return *response,
    };
    if !valid_scope_id(&organisation) {
        return failure(ProposalError::Denied);
    }
    match repository.list(&actor, &organisation).await {
        Ok(items) => Json(MethodologyProposalList {
            proposals: items.into_iter().map(response).collect(),
        })
        .into_response(),
        Err(error) => failure(error),
    }
}

#[utoipa::path(get, path="/methodology/organisations/{organisation_id}/proposals/{proposal_id}", operation_id="methodology_proposal", security(("server_session"=[])),
    params(("organisation_id"=String,Path),("proposal_id"=String,Path),("X-Expected-Session"=Option<String>,Header)),
    responses((status=200,body=MethodologyProposalResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=404,body=ErrorResponse),(status=412,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn read(
    State(state): State<ProposalState>,
    headers: HeaderMap,
    Path((organisation, id)): Path<(String, String)>,
) -> Response {
    let (actor, repository) = match current(&state, &headers, false).await {
        Ok(value) => value,
        Err(response) => return *response,
    };
    if !valid_scope_id(&organisation) || !valid_scope_id(&id) {
        return failure(ProposalError::Denied);
    }
    match repository.proposal(&actor, &organisation, &id).await {
        Ok(Some(found)) => Json(response(found)).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "proposal_not_found",
            }),
        )
            .into_response(),
        Err(error) => failure(error),
    }
}
