//! Scoped immutable originals. One admission lane bounds uploads and verified reads.
use std::{sync::Arc, time::Duration};

use axum::{
    Json, Router,
    body::{Body, to_bytes},
    extract::{DefaultBodyLimit, Path, Query, Request, State, rejection::JsonRejection},
    http::{HeaderMap, HeaderValue, Method, StatusCode, header},
    middleware::{Next, from_fn_with_state},
    response::{IntoResponse, Response},
    routing::{get, put},
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use tokio::sync::Semaphore;
use utoipa::ToSchema;
use zobba_application::{
    evidence::{EvidenceError, EvidenceMetadata, EvidenceObjects, acquire, read_original},
    identity::{CurrentSession, IdentityError},
};
use zobba_domain::{
    evidence::{
        ContentIdentity, EvidenceSearchCoverage, EvidenceSearchQuery, RegisteredEvidence,
        Reservation, ReservationRequest, SourceAssertions, plain_preview,
    },
    identity::{Scope, valid_scope_id},
};
use zobba_infrastructure::{
    evidence::{EvidenceRepository, s3::S3EvidenceObjects},
    identity::{secret_hash, secret_matches},
};

use crate::{
    auth::{AuthState, ErrorResponse, SESSION_COOKIE, cookie},
    engagements::ScopeResponse,
};

const MAX_ORIGINAL_BYTES: usize = 10 * 1024 * 1024;
const IO_DEADLINE: Duration = Duration::from_secs(120);

#[derive(Clone)]
pub(crate) struct EvidenceHttpState {
    identity: AuthState,
    pool: PgPool,
    objects: Option<Arc<S3EvidenceObjects>>,
}

pub(crate) fn router(
    pool: PgPool,
    identity: AuthState,
    objects: Option<Arc<S3EvidenceObjects>>,
) -> Router {
    let lane = Arc::new(Semaphore::new(2));
    let io = Router::new()
        .route(
            "/engagements/{engagement_id}/evidence-reservations/{reservation_id}/upload",
            put(upload),
        )
        .route(
            "/engagements/{engagement_id}/evidence/{evidence_id}/preview",
            get(preview),
        )
        .route(
            "/engagements/{engagement_id}/evidence/{evidence_id}/download",
            get(download),
        )
        .layer(from_fn_with_state(lane, admitted_io));
    Router::new()
        .route(
            "/engagements/{engagement_id}/evidence-reservations",
            get(recover).post(reserve),
        )
        .route("/engagements/{engagement_id}/evidence", get(list))
        .route(
            "/engagements/{engagement_id}/evidence/{evidence_id}",
            get(inspect),
        )
        .layer(DefaultBodyLimit::max(32 * 1024))
        .merge(io)
        .with_state(EvidenceHttpState {
            identity,
            pool,
            objects,
        })
}

async fn admitted_io(State(lane): State<Arc<Semaphore>>, request: Request, next: Next) -> Response {
    let Ok(_permit) = lane.try_acquire_owned() else {
        return failure(EvidenceError::Capacity);
    };
    // This precedes extraction or polling of the upload body. The permit remains
    // held through the completed read, registration and final authority check.
    match tokio::time::timeout(IO_DEADLINE, next.run(request)).await {
        Ok(response) => response,
        Err(_) => failure(EvidenceError::Unavailable),
    }
}

/// The global ordinary deadline must not cut short this separately bounded lane.
pub(crate) fn is_io_request(request: &Request) -> bool {
    let parts: Vec<_> = request.uri().path().split('/').collect();
    matches!(parts.as_slice(), ["", "engagements", _, "knowledge", "excerpts"] if request.method() == Method::POST)
        || matches!(parts.as_slice(), ["", "engagements", _, "knowledge", "evidence", _, "recover"] if request.method() == Method::POST)
        || matches!(parts.as_slice(), ["", "engagements", _, "evidence-reservations", _, "upload"] if request.method() == Method::PUT)
        || matches!(parts.as_slice(), ["", "engagements", _, "evidence", _, "preview" | "download"] if request.method() == Method::GET || request.method() == Method::HEAD)
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct EvidenceContentIdentity {
    #[schema(pattern = "^[0-9a-f]{64}$")]
    pub sha256: String,
    #[schema(minimum = 0, maximum = 10485760)]
    pub size: u64,
}
impl From<ContentIdentity> for EvidenceContentIdentity {
    fn from(value: ContentIdentity) -> Self {
        Self {
            sha256: value.sha256,
            size: value.size,
        }
    }
}
impl From<EvidenceContentIdentity> for ContentIdentity {
    fn from(value: EvidenceContentIdentity) -> Self {
        Self {
            sha256: value.sha256,
            size: value.size,
        }
    }
}

/// Each populated value is the acquisition actor's assertion; null means unknown.
#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct EvidenceSourceAssertions {
    #[schema(required = true, max_length = 2000)]
    pub system: Option<String>,
    #[schema(required = true, max_length = 2000)]
    pub account: Option<String>,
    /// Asserted source-system version, separate from the measured storage version.
    #[schema(required = true, max_length = 2000)]
    pub source_version: Option<String>,
    #[schema(required = true, max_length = 2000)]
    pub selection: Option<String>,
    #[schema(required = true, max_length = 2000)]
    pub coverage: Option<String>,
}
impl From<SourceAssertions> for EvidenceSourceAssertions {
    fn from(value: SourceAssertions) -> Self {
        Self {
            system: value.system,
            account: value.account,
            source_version: value.source_version,
            selection: value.selection,
            coverage: value.coverage,
        }
    }
}
impl From<EvidenceSourceAssertions> for SourceAssertions {
    fn from(value: EvidenceSourceAssertions) -> Self {
        Self {
            system: value.system,
            account: value.account,
            source_version: value.source_version,
            selection: value.selection,
            coverage: value.coverage,
        }
    }
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct EvidenceReservationRequest {
    #[schema(min_length = 1, max_length = 128)]
    pub key: String,
    #[schema(min_length = 1, max_length = 255)]
    pub filename: String,
    pub identity: EvidenceContentIdentity,
    pub source: EvidenceSourceAssertions,
}
impl From<EvidenceReservationRequest> for ReservationRequest {
    fn from(value: EvidenceReservationRequest) -> Self {
        Self {
            key: value.key,
            filename: value.filename,
            identity: value.identity.into(),
            source: value.source.into(),
        }
    }
}
impl From<ReservationRequest> for EvidenceReservationRequest {
    fn from(value: ReservationRequest) -> Self {
        Self {
            key: value.key,
            filename: value.filename,
            identity: value.identity.into(),
            source: value.source.into(),
        }
    }
}

#[derive(Serialize, ToSchema)]
pub struct EvidenceReservationResponse {
    pub id: String,
    pub actor_id: String,
    pub scope: ScopeResponse,
    pub request: EvidenceReservationRequest,
    /// Server-recorded reservation time, Unix seconds; registration completes acquisition.
    pub reserved_at: i64,
}
impl From<Reservation> for EvidenceReservationResponse {
    fn from(value: Reservation) -> Self {
        Self {
            id: value.id,
            actor_id: value.actor_id,
            scope: value.scope.into(),
            request: value.request.into(),
            reserved_at: value.reserved_at,
        }
    }
}

#[derive(Serialize, ToSchema)]
pub struct EvidenceResponse {
    pub reservation: EvidenceReservationResponse,
    /// Immutable storage version independently confirmed by a bounded pinned read.
    pub version: String,
    pub registered_at: i64,
}
impl From<RegisteredEvidence> for EvidenceResponse {
    fn from(value: RegisteredEvidence) -> Self {
        Self {
            reservation: value.reservation.into(),
            version: value.version,
            registered_at: value.registered_at,
        }
    }
}

#[derive(Serialize, ToSchema)]
pub struct EvidencePageResponse {
    /// Storage configuration is present; this does not assert bucket readiness.
    pub storage_configured: bool,
    #[schema(max_items = 50)]
    pub items: Vec<EvidenceResponse>,
    #[schema(required = true)]
    pub next_cursor: Option<String>,
    /// Canonical literal query, trimmed using Rust Unicode whitespace rules;
    /// at most 200 UTF-8 bytes. Empty text browses registered originals.
    #[schema(max_length = 200)]
    pub query: String,
    pub coverage: EvidenceSearchCoverageResponse,
}
#[derive(Serialize, ToSchema)]
pub struct EvidenceSearchCoverageResponse {
    #[schema(minimum = 0, maximum = 256)]
    pub examined_count: usize,
    #[schema(minimum = 256, maximum = 256)]
    pub candidate_limit: usize,
    /// No remaining C-ordered candidates for this read, iff next_cursor is null.
    /// This never establishes source completeness or absence before the cursor.
    pub complete: bool,
}
impl From<EvidenceSearchCoverage> for EvidenceSearchCoverageResponse {
    fn from(value: EvidenceSearchCoverage) -> Self {
        Self {
            examined_count: value.examined_count,
            candidate_limit: value.candidate_limit,
            complete: value.complete,
        }
    }
}
#[derive(Serialize, ToSchema)]
pub struct EvidenceReservationPageResponse {
    #[schema(max_items = 50)]
    pub items: Vec<EvidenceReservationResponse>,
    #[schema(required = true)]
    pub next_cursor: Option<String>,
}
#[derive(Serialize, ToSchema, PartialEq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum EvidencePreviewKind {
    PlainText,
    DownloadOnly,
}
#[derive(Serialize, ToSchema, Debug)]
pub struct EvidencePreviewResponse {
    pub kind: EvidencePreviewKind,
    #[schema(required = true, max_length = 65536)]
    pub text: Option<String>,
    pub truncated: bool,
}

/// Raw original bytes, not a JSON array or a base64-encoded string.
#[derive(ToSchema)]
#[schema(value_type = String, format = Binary)]
pub struct EvidenceBinary(pub Vec<u8>);

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct EvidenceScopeQuery {
    organisation_id: String,
    client_id: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct EvidencePageQuery {
    organisation_id: String,
    client_id: String,
    after: Option<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct EvidenceSearchPageQuery {
    organisation_id: String,
    client_id: String,
    after: Option<String>,
    q: Option<String>,
}
type ScopeQuery = Result<Query<EvidenceScopeQuery>, axum::extract::rejection::QueryRejection>;
type PageQuery = Result<Query<EvidencePageQuery>, axum::extract::rejection::QueryRejection>;
type SearchPageQuery =
    Result<Query<EvidenceSearchPageQuery>, axum::extract::rejection::QueryRejection>;

enum HttpError {
    Identity(IdentityError),
    Evidence(EvidenceError),
}
impl From<IdentityError> for HttpError {
    fn from(error: IdentityError) -> Self {
        Self::Identity(error)
    }
}
impl From<EvidenceError> for HttpError {
    fn from(error: EvidenceError) -> Self {
        Self::Evidence(error)
    }
}
impl IntoResponse for HttpError {
    fn into_response(self) -> Response {
        match self {
            Self::Identity(error) => crate::auth::failure(error),
            Self::Evidence(error) => failure(error),
        }
    }
}

struct Authority {
    current: CurrentSession,
    scope: Scope,
    repository: EvidenceRepository,
}

async fn authority(
    state: &EvidenceHttpState,
    headers: &HeaderMap,
    engagement_id: String,
    query: ScopeQuery,
    mutation: bool,
) -> Result<Authority, HttpError> {
    let current = state
        .identity
        .current_read(headers)
        .await
        .map_err(HttpError::Identity)?;
    if mutation
        && !state
            .identity
            .permits_mutation(headers, &current.csrf_token)
    {
        return Err(EvidenceError::Denied.into());
    }
    let mut expected = headers.get_all("x-expected-actor").iter();
    if let Some(value) = expected.next()
        && (expected.next().is_some() || value.to_str().ok() != Some(&current.identity.id))
    {
        return Err(EvidenceError::Denied.into());
    }
    let Query(query) = query.map_err(|_| EvidenceError::Denied)?;
    let scope = Scope {
        organisation_id: query.organisation_id,
        client_id: query.client_id,
        engagement_id,
    };
    if !scope.is_valid() {
        return Err(EvidenceError::Denied.into());
    }
    let token = cookie(headers, SESSION_COOKIE).ok_or(IdentityError::Unauthenticated)?;
    let repository =
        EvidenceRepository::new(state.pool.clone()).with_session_hash(secret_hash(&token));
    repository
        .authorize(&current.identity.id, &scope)
        .await
        .map_err(HttpError::Evidence)?;
    Ok(Authority {
        current,
        scope,
        repository,
    })
}

async fn final_authority(
    state: &EvidenceHttpState,
    headers: &HeaderMap,
    authority: &Authority,
) -> Result<(), HttpError> {
    let now = state
        .identity
        .current_read(headers)
        .await
        .map_err(HttpError::Identity)?;
    if now.identity.id != authority.current.identity.id
        || !secret_matches(&now.csrf_token, &authority.current.csrf_token)
    {
        return Err(IdentityError::SessionChanged.into());
    }
    authority
        .repository
        .authorize(&authority.current.identity.id, &authority.scope)
        .await
        .map_err(HttpError::Evidence)
}

fn split_page(query: PageQuery) -> Result<(ScopeQuery, Option<String>), HttpError> {
    let Query(query) = query.map_err(|_| EvidenceError::Denied)?;
    if query
        .after
        .as_deref()
        .is_some_and(|value| !valid_scope_id(value))
    {
        return Err(EvidenceError::Denied.into());
    }
    Ok((
        Ok(Query(EvidenceScopeQuery {
            organisation_id: query.organisation_id,
            client_id: query.client_id,
        })),
        query.after,
    ))
}

#[utoipa::path(post, path="/engagements/{engagement_id}/evidence-reservations", operation_id="reserve_evidence", security(("server_session"=[])),
    params(("engagement_id"=String,Path),("organisation_id"=String,Query),("client_id"=String,Query),("Origin"=String,Header),("X-CSRF-Token"=String,Header),("X-Expected-Session"=Option<String>,Header)), request_body=EvidenceReservationRequest,
    responses((status=200,description="Original immutable reservation, including exact retries",body=EvidenceReservationResponse),(status=400,body=ErrorResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=409,description="Changed retry conflicts, or evidence_reservation_limit: 100 incomplete reservations for this actor/scope; finish an existing reservation to free a slot. No automatic expiry or abandonment is available.",body=ErrorResponse),(status=412,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn reserve(
    State(state): State<EvidenceHttpState>,
    headers: HeaderMap,
    Path(engagement_id): Path<String>,
    query: ScopeQuery,
    body: Result<Json<EvidenceReservationRequest>, JsonRejection>,
) -> Response {
    let authority = match authority(&state, &headers, engagement_id, query, true).await {
        Ok(value) => value,
        Err(response) => return response.into_response(),
    };
    let Some(objects) = state.objects.as_ref() else {
        return failure(EvidenceError::Unavailable);
    };
    let request: ReservationRequest = match body {
        Ok(Json(body)) => body.into(),
        Err(_) => return failure(EvidenceError::Invalid),
    };
    let result = authority
        .repository
        .reserve(
            &authority.current.identity.id,
            &authority.scope,
            &request,
            objects.namespace(),
        )
        .await;
    match result {
        Ok(stored) => match final_authority(&state, &headers, &authority).await {
            Ok(()) => Json(EvidenceReservationResponse::from(stored.reservation)).into_response(),
            Err(response) => response.into_response(),
        },
        Err(error) => failure(error),
    }
}

#[utoipa::path(get, path="/engagements/{engagement_id}/evidence-reservations", operation_id="recover_evidence_reservations", security(("server_session"=[])),
    params(("engagement_id"=String,Path),("organisation_id"=String,Query),("client_id"=String,Query),("after"=Option<String>,Query),("X-Expected-Session"=Option<String>,Header)),
    responses((status=200,description="Owner-only incomplete reservations under current scope",body=EvidenceReservationPageResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=412,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn recover(
    State(state): State<EvidenceHttpState>,
    headers: HeaderMap,
    Path(engagement_id): Path<String>,
    query: PageQuery,
) -> Response {
    let (query, after) = match split_page(query) {
        Ok(value) => value,
        Err(response) => return response.into_response(),
    };
    let authority = match authority(&state, &headers, engagement_id, query, false).await {
        Ok(value) => value,
        Err(response) => return response.into_response(),
    };
    match authority
        .repository
        .recover(
            &authority.current.identity.id,
            &authority.scope,
            after.as_deref(),
        )
        .await
    {
        Ok(page) => match final_authority(&state, &headers, &authority).await {
            Ok(()) => Json(EvidenceReservationPageResponse {
                items: page.items.into_iter().map(Into::into).collect(),
                next_cursor: page.next_cursor,
            })
            .into_response(),
            Err(response) => response.into_response(),
        },
        Err(error) => failure(error),
    }
}

#[utoipa::path(get, path="/engagements/{engagement_id}/evidence", operation_id="list_evidence", security(("server_session"=[])),
    params(("engagement_id"=String,Path),("organisation_id"=String,Query),("client_id"=String,Query),("after"=Option<String>,Query,description="Last examined C-ordered candidate; restart without a cursor when q changes"),("q"=Option<String>,Query,description="Literal substring of filename or attributed source fields after context-independent per-scalar Unicode lowercase; no normalization or full case folding. At most 200 UTF-8 bytes after Rust Unicode whitespace trim, controls refused and FEFF preserved. No original-content search."),("X-Expected-Session"=Option<String>,Header)),
    responses((status=200,description="At most 50 matches from at most 256 examined current-scope candidates. Partial empty pages retain continuation; no page proves document meaning or source completeness.",body=EvidencePageResponse),(status=400,description="evidence_invalid: shorten the search to 200 UTF-8 bytes, remove control characters or restart with a valid cursor",body=ErrorResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=412,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn list(
    State(state): State<EvidenceHttpState>,
    headers: HeaderMap,
    Path(engagement_id): Path<String>,
    query: SearchPageQuery,
) -> Response {
    let Query(query) = match query {
        Ok(value) => value,
        Err(_) => return failure(EvidenceError::Invalid),
    };
    let scope = Ok(Query(EvidenceScopeQuery {
        organisation_id: query.organisation_id,
        client_id: query.client_id,
    }));
    let authority = match authority(&state, &headers, engagement_id, scope, false).await {
        Ok(value) => value,
        Err(response) => return response.into_response(),
    };
    let Some(query) = EvidenceSearchQuery::new(query.q.as_deref().unwrap_or(""), query.after)
    else {
        return failure(EvidenceError::Invalid);
    };
    match authority
        .repository
        .search(&authority.current.identity.id, &authority.scope, &query)
        .await
    {
        Ok(page) => match final_authority(&state, &headers, &authority).await {
            Ok(()) => Json(EvidencePageResponse {
                storage_configured: state.objects.is_some(),
                items: page.items.into_iter().map(Into::into).collect(),
                next_cursor: page.next_cursor,
                query: query.query,
                coverage: page.coverage.into(),
            })
            .into_response(),
            Err(response) => response.into_response(),
        },
        Err(error) => failure(error),
    }
}

#[utoipa::path(get, path="/engagements/{engagement_id}/evidence/{evidence_id}", operation_id="inspect_evidence", security(("server_session"=[])),
    params(("engagement_id"=String,Path),("evidence_id"=String,Path),("organisation_id"=String,Query),("client_id"=String,Query),("X-Expected-Session"=Option<String>,Header)),
    responses((status=200,body=EvidenceResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=412,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn inspect(
    State(state): State<EvidenceHttpState>,
    headers: HeaderMap,
    Path((engagement_id, id)): Path<(String, String)>,
    query: ScopeQuery,
) -> Response {
    let authority = match authority(&state, &headers, engagement_id, query, false).await {
        Ok(value) => value,
        Err(response) => return response.into_response(),
    };
    match authority
        .repository
        .inspect(&authority.current.identity.id, &authority.scope, &id)
        .await
    {
        Ok(stored) => match final_authority(&state, &headers, &authority).await {
            Ok(()) => Json(EvidenceResponse::from(stored.evidence)).into_response(),
            Err(response) => response.into_response(),
        },
        Err(error) => failure(error),
    }
}

#[utoipa::path(put, path="/engagements/{engagement_id}/evidence-reservations/{reservation_id}/upload", operation_id="upload_evidence", security(("server_session"=[])),
    params(("engagement_id"=String,Path),("reservation_id"=String,Path),("organisation_id"=String,Query),("client_id"=String,Query),("Origin"=String,Header),("X-CSRF-Token"=String,Header),("X-Expected-Session"=Option<String>,Header)), request_body(content=EvidenceBinary,content_type="application/octet-stream"),
    responses((status=200,description="Independently verified original registered, or identical receipt replay",body=EvidenceResponse),(status=400,body=ErrorResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=409,body=ErrorResponse),(status=412,body=ErrorResponse),(status=413,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn upload(
    State(state): State<EvidenceHttpState>,
    headers: HeaderMap,
    Path((engagement_id, id)): Path<(String, String)>,
    query: ScopeQuery,
    body: Body,
) -> Response {
    let authority = match authority(&state, &headers, engagement_id, query, true).await {
        Ok(value) => value,
        Err(response) => return response.into_response(),
    };
    let Some(objects) = state.objects.as_ref() else {
        return failure(EvidenceError::Unavailable);
    };
    if headers
        .get(header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .is_some_and(|size| size > MAX_ORIGINAL_BYTES as u64)
    {
        return failure(EvidenceError::TooLarge);
    }
    // Refuse unknown/foreign reservations before the first body byte is polled.
    if let Err(error) = authority
        .repository
        .reservation(&authority.current.identity.id, &authority.scope, &id)
        .await
    {
        return failure(error);
    }
    let bytes = match to_bytes(body, MAX_ORIGINAL_BYTES).await {
        Ok(bytes) => bytes.to_vec(),
        Err(_) => return failure(EvidenceError::TooLarge),
    };
    let result = acquire(
        &authority.repository,
        objects.as_ref(),
        &authority.current.identity.id,
        &authority.scope,
        &id,
        bytes,
    )
    .await;
    // Even a storage/integrity failure must not disclose an old audience's
    // object state after authority changed while the request was in flight.
    if let Err(response) = final_authority(&state, &headers, &authority).await {
        return response.into_response();
    }
    match result {
        Ok(evidence) => Json(EvidenceResponse::from(evidence)).into_response(),
        Err(error) => failure(error),
    }
}

#[utoipa::path(get, path="/engagements/{engagement_id}/evidence/{evidence_id}/preview", operation_id="preview_evidence", security(("server_session"=[])),
    params(("engagement_id"=String,Path),("evidence_id"=String,Path),("organisation_id"=String,Query),("client_id"=String,Query),("X-Expected-Session"=Option<String>,Header)),
    responses((status=200,description="Inert valid plain UTF-8 only; at most 64 KiB and 100 lines",body=EvidencePreviewResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=412,body=ErrorResponse),(status=413,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn preview(
    State(state): State<EvidenceHttpState>,
    headers: HeaderMap,
    Path((engagement_id, id)): Path<(String, String)>,
    query: ScopeQuery,
) -> Response {
    read(state, headers, engagement_id, id, query, true).await
}

#[utoipa::path(get, path="/engagements/{engagement_id}/evidence/{evidence_id}/download", operation_id="download_evidence", security(("server_session"=[])),
    params(("engagement_id"=String,Path),("evidence_id"=String,Path),("organisation_id"=String,Query),("client_id"=String,Query),("X-Expected-Session"=Option<String>,Header)),
    responses((status=200,description="Authenticated verified original; attachment, no-store, nosniff, no-referrer",body=EvidenceBinary,content_type="application/octet-stream"),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=412,body=ErrorResponse),(status=413,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn download(
    State(state): State<EvidenceHttpState>,
    headers: HeaderMap,
    Path((engagement_id, id)): Path<(String, String)>,
    query: ScopeQuery,
) -> Response {
    read(state, headers, engagement_id, id, query, false).await
}

async fn read(
    state: EvidenceHttpState,
    headers: HeaderMap,
    engagement_id: String,
    id: String,
    query: ScopeQuery,
    preview: bool,
) -> Response {
    let authority = match authority(&state, &headers, engagement_id, query, false).await {
        Ok(value) => value,
        Err(response) => return response.into_response(),
    };
    let Some(objects) = state.objects.as_ref() else {
        return failure(EvidenceError::Unavailable);
    };
    let result = read_original(
        &authority.repository,
        objects.as_ref(),
        &authority.current.identity.id,
        &authority.scope,
        &id,
    )
    .await;
    if let Err(response) = final_authority(&state, &headers, &authority).await {
        return response.into_response();
    }
    let (evidence, bytes) = match result {
        Ok(value) => value,
        Err(error) => return failure(error),
    };
    if preview {
        return Json(preview_text(&evidence.reservation.request.filename, &bytes)).into_response();
    }
    let mut response = bytes.into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/octet-stream"),
    );
    response.headers_mut().insert(
        header::CONTENT_DISPOSITION,
        safe_disposition(&evidence.reservation.request.filename),
    );
    response.headers_mut().insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static("sandbox; default-src 'none'"),
    );
    response
}

fn preview_text(filename: &str, bytes: &[u8]) -> EvidencePreviewResponse {
    let unsupported = || EvidencePreviewResponse {
        kind: EvidencePreviewKind::DownloadOnly,
        text: None,
        truncated: false,
    };
    let extension = filename
        .rsplit_once('.')
        .map(|(_, extension)| extension.to_ascii_lowercase());
    if !matches!(
        extension.as_deref(),
        Some("txt" | "csv" | "tsv" | "log" | "md")
    ) {
        return unsupported();
    }
    let Some((text, truncated)) = plain_preview(bytes) else {
        return unsupported();
    };
    EvidencePreviewResponse {
        kind: EvidencePreviewKind::PlainText,
        text: Some(text),
        truncated,
    }
}

fn safe_disposition(filename: &str) -> HeaderValue {
    HeaderValue::from_str(&format!(
        "attachment; filename=\"{}\"",
        safe_filename(filename)
    ))
    .expect("sanitized ASCII filename")
}

fn safe_filename(filename: &str) -> String {
    // ASCII attachment fallback cannot inject quotes, separators or headers; the
    // original attributed filename remains visible in authenticated metadata.
    let safe: String = filename
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .collect();
    let safe = safe.trim_matches('.');
    if safe.is_empty() {
        return "evidence-original".into();
    }
    if let Some((base, extension)) = safe.rsplit_once('.')
        && !extension.is_empty()
        && extension.len() <= 20
        && extension.bytes().all(|byte| byte.is_ascii_alphanumeric())
    {
        let base_limit = 120 - extension.len() - 1;
        return format!("{}.{extension}", &base[..base.len().min(base_limit)]);
    }
    safe[..safe.len().min(120)].trim_end_matches('.').into()
}

pub(crate) fn failure(error: EvidenceError) -> Response {
    let (status, code) = match error {
        EvidenceError::Denied => (StatusCode::FORBIDDEN, "access_denied"),
        EvidenceError::Invalid => (StatusCode::BAD_REQUEST, "evidence_invalid"),
        EvidenceError::Conflict => (StatusCode::CONFLICT, "evidence_conflict"),
        EvidenceError::Unavailable => (StatusCode::SERVICE_UNAVAILABLE, "evidence_unavailable"),
        EvidenceError::Capacity => (StatusCode::TOO_MANY_REQUESTS, "evidence_capacity"),
        EvidenceError::ReservationLimit => (StatusCode::CONFLICT, "evidence_reservation_limit"),
        EvidenceError::Integrity => (StatusCode::SERVICE_UNAVAILABLE, "evidence_integrity"),
        EvidenceError::TooLarge => (StatusCode::PAYLOAD_TOO_LARGE, "evidence_too_large"),
    };
    let mut response = (status, Json(ErrorResponse { error: code })).into_response();
    if error == EvidenceError::Capacity {
        response
            .headers_mut()
            .insert(header::RETRY_AFTER, HeaderValue::from_static("1"));
    }
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    use tower::ServiceExt;
    use zobba_domain::evidence::PREVIEW_BYTES;

    fn bounded_test_router(lane: Arc<Semaphore>) -> Router {
        Router::new()
            .route(
                "/upload",
                put(|body: Body| async move {
                    let _ = to_bytes(body, MAX_ORIGINAL_BYTES).await;
                    StatusCode::OK
                }),
            )
            .layer(from_fn_with_state(lane, admitted_io))
    }

    fn stalled_request(polled: Arc<AtomicBool>) -> Request {
        let stream = futures_util::stream::poll_fn(move |_| {
            polled.store(true, Ordering::SeqCst);
            std::task::Poll::<Option<Result<bytes::Bytes, std::io::Error>>>::Pending
        });
        Request::builder()
            .method(Method::PUT)
            .uri("/upload")
            .body(Body::from_stream(stream))
            .unwrap()
    }

    #[tokio::test(start_paused = true)]
    async fn admission_precedes_body_polling_and_120_second_deadline_releases_capacity() {
        let lane = Arc::new(Semaphore::new(2));
        let app = bounded_test_router(lane.clone());
        let first_polled = Arc::new(AtomicBool::new(false));
        let second_polled = Arc::new(AtomicBool::new(false));
        let first = tokio::spawn(app.clone().oneshot(stalled_request(first_polled.clone())));
        let second = tokio::spawn(app.clone().oneshot(stalled_request(second_polled.clone())));
        tokio::task::yield_now().await;
        assert!(first_polled.load(Ordering::SeqCst) && second_polled.load(Ordering::SeqCst));
        let excess_polled = Arc::new(AtomicBool::new(false));
        let refused = app
            .clone()
            .oneshot(stalled_request(excess_polled.clone()))
            .await
            .unwrap();
        assert_eq!(refused.status(), StatusCode::TOO_MANY_REQUESTS);
        assert!(
            !excess_polled.load(Ordering::SeqCst),
            "fail-fast refusal never polls incoming bytes"
        );
        tokio::time::advance(Duration::from_secs(119)).await;
        assert!(
            !first.is_finished() && !second.is_finished(),
            "evidence I/O has its own longer bounded budget"
        );
        tokio::time::advance(Duration::from_secs(1)).await;
        assert_eq!(
            first.await.unwrap().unwrap().status(),
            StatusCode::SERVICE_UNAVAILABLE
        );
        assert_eq!(
            second.await.unwrap().unwrap().status(),
            StatusCode::SERVICE_UNAVAILABLE
        );
        assert_eq!(lane.available_permits(), 2);
        let cancelled =
            tokio::spawn(app.oneshot(stalled_request(Arc::new(AtomicBool::new(false)))));
        tokio::task::yield_now().await;
        assert_eq!(lane.available_permits(), 1);
        cancelled.abort();
        assert!(cancelled.await.unwrap_err().is_cancelled());
        assert_eq!(lane.available_permits(), 2);
    }

    #[test]
    fn preview_caps_bytes_on_utf8_boundaries_and_lines_without_parsers() {
        let text = "é".repeat(PREVIEW_BYTES);
        let preview = preview_text("plain.txt", text.as_bytes());
        assert_eq!(preview.kind, EvidencePreviewKind::PlainText);
        assert_eq!(preview.text.unwrap().len(), PREVIEW_BYTES);
        assert!(preview.truncated);
        let text = "line\n".repeat(101);
        let preview = preview_text("plain.csv", text.as_bytes());
        assert_eq!(preview.text.unwrap().lines().count(), 100);
        assert!(preview.truncated);
        let preview = preview_text("plain.txt", "é".repeat(PREVIEW_BYTES / 2).as_bytes());
        assert!(!preview.truncated);
        for (name, bytes) in [
            ("active.html", &b"<b>active</b>"[..]),
            ("active.svg", &b"<svg/>"[..]),
            ("wrong.txt", &b"\xef\xbb\xbf <html>active</html>"[..]),
            ("image.txt", &b"a\0b"[..]),
            ("invalid.txt", &b"\xff"[..]),
            ("sheet.xlsx", &b"valid text"[..]),
        ] {
            let preview = preview_text(name, bytes);
            assert_eq!(preview.kind, EvidencePreviewKind::DownloadOnly);
            assert!(preview.text.is_none());
        }
    }

    #[test]
    fn attachment_filename_is_bounded_and_cannot_add_headers_or_paths() {
        let value = safe_disposition("../../unsafe\";\r\nContent-Type:text/html.svg");
        let value = value.to_str().unwrap();
        assert!(value.starts_with("attachment; filename=\""));
        assert_eq!(value.matches('"').count(), 2);
        assert!(!value.contains('\r') && !value.contains('\n') && !value.contains('/'));
        assert!(safe_disposition(&"é".repeat(1000)).to_str().unwrap().len() < 150);
    }

    #[test]
    fn attachment_filename_preserves_bounded_extensions_with_shared_browser_rules() {
        for (input, expected) in [
            (
                format!("{}.PDF", "a".repeat(200)),
                format!("{}.PDF", "a".repeat(116)),
            ),
            (
                format!("{}.abcdefghijklmnopqrst", "a".repeat(200)),
                format!("{}.abcdefghijklmnopqrst", "a".repeat(99)),
            ),
            (
                format!("{}.abcdefghijklmnopqrstu", "a".repeat(200)),
                "a".repeat(120),
            ),
            ("é💡 statement.csv".into(), "___statement.csv".into()),
            ("Résumé.tsv".into(), "R_sum_.tsv".into()),
            ("😺.txt".into(), "_.txt".into()),
            (
                "../unsafe\\name\r\n.txt".into(),
                "_unsafe_name__.txt".into(),
            ),
            (
                format!("{}.{}", "x".repeat(119), "z".repeat(21)),
                "x".repeat(119),
            ),
            ("...report...txt...".into(), "report...txt".into()),
            (
                "../folder\\bad\";\r\n.csv".into(),
                "_folder_bad____.csv".into(),
            ),
            ("...".into(), "evidence-original".into()),
            ("".into(), "evidence-original".into()),
            (".profile".into(), "profile".into()),
            ("report...".into(), "report".into()),
        ] {
            assert_eq!(safe_filename(&input), expected);
            assert!(expected.len() <= 120);
            assert_eq!(
                safe_disposition(&input).to_str().unwrap(),
                format!("attachment; filename=\"{expected}\"")
            );
        }
    }

    #[tokio::test]
    async fn durable_reservation_limit_is_distinct_from_transient_io_capacity() {
        for (error, status, code, retry_after) in [
            (
                EvidenceError::ReservationLimit,
                StatusCode::CONFLICT,
                "evidence_reservation_limit",
                None,
            ),
            (
                EvidenceError::Conflict,
                StatusCode::CONFLICT,
                "evidence_conflict",
                None,
            ),
            (
                EvidenceError::Capacity,
                StatusCode::TOO_MANY_REQUESTS,
                "evidence_capacity",
                Some("1"),
            ),
        ] {
            let response = failure(error);
            assert_eq!(response.status(), status);
            assert_eq!(
                response
                    .headers()
                    .get(header::RETRY_AFTER)
                    .map(|value| value.to_str().unwrap()),
                retry_after
            );
            let body = to_bytes(response.into_body(), 1024).await.unwrap();
            assert_eq!(
                serde_json::from_slice::<serde_json::Value>(&body).unwrap(),
                serde_json::json!({"error": code})
            );
        }
    }
}
