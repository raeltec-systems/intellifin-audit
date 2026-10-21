//! Organisation-level conversational engagement setup (Story 22.2 AC4).
//! Deterministic server-side resolution only; no model is called.
use crate::auth::{self, AuthState, ErrorResponse};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Path, Query, State, rejection::JsonRejection},
    http::{HeaderMap, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use std::{sync::Arc, time::Duration};
use tokio::sync::Semaphore;
use utoipa::ToSchema;
use zobba_application::engagement_setup::{EngagementSetups, SetupError};
use zobba_domain::{
    engagement_setup::{
        ANSWER_MAX, ClientCandidate, MAX_CLIENT_CANDIDATES, MAX_ESTABLISHED_PER_DAY,
        MAX_OPEN_SETUPS, MAX_SETUP_MESSAGES, MemberInput, OBJECTIVE_MAX, SetupAuthor, SetupState,
        SetupView,
    },
    identity::valid_scope_id,
};
use zobba_infrastructure::{engagement_setup::EngagementSetupRepository, identity::secret_hash};

#[derive(Clone)]
pub(crate) struct SetupHttpState {
    identity: AuthState,
    repository: EngagementSetupRepository,
}

pub(crate) fn router(pool: sqlx::PgPool, identity: AuthState) -> Router {
    // Reads and writes have separate bounded permits, so reads can never starve
    // a confirmation or a cancellation.
    let reads = Arc::new(Semaphore::new(4));
    let writes = Arc::new(Semaphore::new(4));
    Router::new()
        .route("/engagement-setups/organisations", get(organisations))
        .route(
            "/organisations/{organisation_id}/engagement-setups",
            get(list).post(open),
        )
        .route(
            "/organisations/{organisation_id}/engagement-setups/{setup_id}",
            get(read),
        )
        .route(
            "/organisations/{organisation_id}/engagement-setups/{setup_id}/messages",
            post(message),
        )
        .route(
            "/organisations/{organisation_id}/engagement-setups/{setup_id}/confirm",
            post(confirm),
        )
        .with_state(SetupHttpState {
            identity,
            repository: EngagementSetupRepository::new(pool),
        })
        .layer(DefaultBodyLimit::max(16 * 1024))
        .layer(axum::middleware::from_fn(
            move |request: axum::extract::Request, next: axum::middleware::Next| {
                let capacity = if request.method() == Method::GET {
                    reads.clone()
                } else {
                    writes.clone()
                };
                async move {
                    let Ok(_permit) = capacity.try_acquire_owned() else {
                        return failure(SetupError::Unavailable, StatusCode::TOO_MANY_REQUESTS);
                    };
                    match tokio::time::timeout(Duration::from_secs(6), next.run(request)).await {
                        Ok(response) => response,
                        Err(_) => error(SetupError::Unavailable),
                    }
                }
            },
        ))
}

fn failure(error: SetupError, status: StatusCode) -> Response {
    (
        status,
        Json(ErrorResponse {
            error: error.code(),
        }),
    )
        .into_response()
}
fn error(error: SetupError) -> Response {
    let status = match error {
        SetupError::Invalid => StatusCode::BAD_REQUEST,
        SetupError::Denied | SetupError::Rejected => StatusCode::FORBIDDEN,
        SetupError::NotFound => StatusCode::NOT_FOUND,
        SetupError::Conflict
        | SetupError::ConfirmFailed
        | SetupError::OpenLimit
        | SetupError::DailyLimit
        | SetupError::MessageLimit => StatusCode::CONFLICT,
        SetupError::Unavailable => StatusCode::SERVICE_UNAVAILABLE,
    };
    failure(error, status)
}

async fn authorized(
    state: &SetupHttpState,
    headers: &HeaderMap,
    mutation: bool,
) -> Result<(String, EngagementSetupRepository), Box<Response>> {
    let current = state
        .identity
        .current_read(headers)
        .await
        .map_err(|failure| Box::new(auth::failure(failure)))?;
    if mutation {
        let mut values = headers.get_all("x-expected-actor").iter();
        let expected = values.next().and_then(|value| value.to_str().ok());
        if expected != Some(current.identity.id.as_str())
            || values.next().is_some()
            || !state
                .identity
                .permits_mutation(headers, &current.csrf_token)
        {
            // A request fence, not lost access: the caller should reload.
            return Err(Box::new(error(SetupError::Rejected)));
        }
    }
    let token = auth::cookie(headers, auth::SESSION_COOKIE)
        .ok_or_else(|| Box::new(error(SetupError::Denied)))?;
    Ok((
        current.identity.id,
        state
            .repository
            .clone()
            .with_session_hash(secret_hash(&token)),
    ))
}

#[derive(Serialize, ToSchema)]
pub struct SetupOrganisationResponse {
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub organisation_id: String,
    #[schema(min_length = 1, max_length = 200)]
    pub organisation_name: String,
}
/// The server's setup bounds, so clients never restate them.
#[derive(Serialize, ToSchema)]
pub struct SetupLimitsResponse {
    pub open_setups: u32,
    /// Engagements one actor may establish in one organisation per UTC day.
    pub established_per_day: u32,
    pub setup_messages: u32,
    pub client_candidates: u32,
    /// The first objective, in UTF-8 bytes.
    pub objective_bytes: u32,
    /// One answer (a client name or a period), in UTF-8 bytes.
    pub answer_bytes: u32,
}
#[derive(Serialize, ToSchema)]
pub struct SetupOrganisationsResponse {
    /// Organisations where the caller holds a current auditor or audit manager
    /// role, in C (byte) order of their IDs.
    #[schema(max_items = 50)]
    pub organisations: Vec<SetupOrganisationResponse>,
    /// Another page exists after the last organisation listed.
    pub more: bool,
    pub limits: SetupLimitsResponse,
}
#[derive(Deserialize, ToSchema, utoipa::IntoParams)]
#[serde(deny_unknown_fields)]
pub struct SetupOrganisationsQuery {
    /// The last organisation ID of the previous page.
    #[param(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub after: Option<String>,
}

#[derive(Clone, Copy, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SetupStateResponse {
    Objective,
    Client,
    ClientChoice,
    NewClient,
    Period,
    Confirm,
    Established,
    Cancelled,
}
impl From<SetupState> for SetupStateResponse {
    fn from(value: SetupState) -> Self {
        match value {
            SetupState::Objective => Self::Objective,
            SetupState::Client => Self::Client,
            SetupState::ClientChoice => Self::ClientChoice,
            SetupState::NewClient => Self::NewClient,
            SetupState::Period => Self::Period,
            SetupState::Confirm => Self::Confirm,
            SetupState::Established => Self::Established,
            SetupState::Cancelled => Self::Cancelled,
        }
    }
}

#[derive(Serialize, ToSchema)]
pub struct SetupClientResponse {
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub client_id: String,
    #[schema(min_length = 1, max_length = 200)]
    pub client_name: String,
}
impl From<ClientCandidate> for SetupClientResponse {
    fn from(value: ClientCandidate) -> Self {
        Self {
            client_id: value.id,
            client_name: value.name,
        }
    }
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SetupAuthorResponse {
    Member,
    Zobba,
}

#[derive(Serialize, ToSchema)]
pub struct SetupMessageResponse {
    pub ordinal: u32,
    pub author: SetupAuthorResponse,
    /// Member: objective, text, choose_client, new_client, change_client, change_period, confirm or cancel.
    /// Zobba: question, refusal, summary, established or cancelled.
    pub kind: String,
    /// Retained member text, or Zobba's fixed deterministic sentence; at most 4000 UTF-8 bytes.
    #[schema(min_length = 1)]
    pub content: String,
    #[schema(required = true)]
    pub reply_to: Option<u32>,
    /// Closed prompt for a Zobba question: client, client_choice, new_client, period or confirm.
    #[schema(required = true)]
    pub prompt: Option<String>,
    #[schema(max_items = 20)]
    pub candidates: Vec<SetupClientResponse>,
    /// Closed refusal code; the content carries the reason.
    #[schema(required = true)]
    pub refusal: Option<String>,
}

#[derive(Serialize, ToSchema)]
pub struct SetupEstablishedResponse {
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub organisation_id: String,
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub client_id: String,
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub engagement_id: String,
    #[schema(min_length = 1, max_length = 200)]
    pub engagement_name: String,
    /// The first Task's immutable Received receipt.
    pub receipt: crate::tasks::CommandReceiptResponse,
}

#[derive(Serialize, ToSchema)]
pub struct SetupResponse {
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub id: String,
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub organisation_id: String,
    /// The idempotency key of the opening objective.
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub key: String,
    /// At most 4000 UTF-8 bytes.
    #[schema(min_length = 1)]
    pub objective: String,
    pub state: SetupStateResponse,
    #[schema(max_items = 20)]
    pub candidates: Vec<SetupClientResponse>,
    /// An existing client resolved from the member's explicit answer.
    #[schema(required = true)]
    pub client: Option<SetupClientResponse>,
    /// A new client the member explicitly agreed to create on confirmation.
    #[schema(required = true, min_length = 1, max_length = 200)]
    pub new_client_name: Option<String>,
    #[schema(required = true, pattern = "^[0-9]{4}-[0-9]{2}-[0-9]{2}$")]
    pub period_start: Option<String>,
    #[schema(required = true, pattern = "^[0-9]{4}-[0-9]{2}-[0-9]{2}$")]
    pub period_end: Option<String>,
    #[schema(required = true)]
    pub established: Option<SetupEstablishedResponse>,
    #[schema(max_items = 200)]
    pub messages: Vec<SetupMessageResponse>,
}
impl From<SetupView> for SetupResponse {
    fn from(value: SetupView) -> Self {
        let facts = value.facts;
        Self {
            id: value.id,
            organisation_id: value.organisation_id,
            key: value.key,
            objective: value.objective,
            state: facts.state.into(),
            candidates: facts.candidates.into_iter().map(Into::into).collect(),
            client: facts.client.map(Into::into),
            new_client_name: facts.new_client_name,
            period_start: facts.period.as_ref().map(|p| p.start.clone()),
            period_end: facts.period.map(|p| p.end),
            established: value.established.map(|done| SetupEstablishedResponse {
                organisation_id: done.scope.organisation_id,
                client_id: done.scope.client_id,
                engagement_id: done.scope.engagement_id,
                engagement_name: done.engagement_name,
                receipt: done.receipt.into(),
            }),
            messages: value
                .messages
                .into_iter()
                .map(|m| SetupMessageResponse {
                    ordinal: m.ordinal,
                    author: match m.author {
                        SetupAuthor::Member => SetupAuthorResponse::Member,
                        SetupAuthor::Zobba => SetupAuthorResponse::Zobba,
                    },
                    kind: m.kind,
                    content: m.content,
                    reply_to: m.reply_to,
                    prompt: m.prompt,
                    candidates: m.candidates.into_iter().map(Into::into).collect(),
                    refusal: m.refusal,
                })
                .collect(),
        }
    }
}
#[derive(Serialize, ToSchema)]
pub struct SetupsResponse {
    /// The caller's open setups in this organisation, oldest first.
    #[schema(max_items = 8)]
    pub setups: Vec<SetupResponse>,
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct OpenSetupRequest {
    /// Actor and organisation bind this key; an identical retry returns the original setup.
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub key: String,
    /// The first objective, at most 4000 UTF-8 bytes.
    #[schema(min_length = 1)]
    pub objective: String,
}

#[derive(Clone, Copy, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SetupMessageKind {
    Text,
    ChooseClient,
    NewClient,
    ChangeClient,
    ChangePeriod,
    Cancel,
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct SetupMessageRequest {
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub key: String,
    pub kind: SetupMessageKind,
    /// Required only for text: a client name or an explicit ISO period, at most
    /// 400 UTF-8 bytes.
    #[schema(min_length = 1)]
    pub content: Option<String>,
    /// Required only for choose_client: one of the listed candidates.
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub client_id: Option<String>,
    /// Required only for new_client: explicit acceptance or decline.
    pub accept: Option<bool>,
}
impl SetupMessageRequest {
    fn input(self) -> Option<MemberInput> {
        match (self.kind, self.content, self.client_id, self.accept) {
            (SetupMessageKind::Text, Some(text), None, None) => Some(MemberInput::Text(text)),
            (SetupMessageKind::ChooseClient, None, Some(id), None) => {
                Some(MemberInput::ChooseClient(id))
            }
            (SetupMessageKind::NewClient, None, None, Some(accept)) => {
                Some(MemberInput::NewClient(accept))
            }
            (SetupMessageKind::ChangeClient, None, None, None) => Some(MemberInput::ChangeClient),
            (SetupMessageKind::ChangePeriod, None, None, None) => Some(MemberInput::ChangePeriod),
            (SetupMessageKind::Cancel, None, None, None) => Some(MemberInput::Cancel),
            _ => None,
        }
    }
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ConfirmSetupRequest {
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub key: String,
}

fn view(result: Result<SetupView, SetupError>) -> Response {
    match result {
        Ok(view) => (StatusCode::OK, Json(SetupResponse::from(view))).into_response(),
        Err(failure) => error(failure),
    }
}

#[utoipa::path(get,path="/engagement-setups/organisations",operation_id="list_setup_organisations",security(("server_session"=[])),
    params(SetupOrganisationsQuery,("X-Expected-Session"=Option<String>,Header,description="Optional session-bound read precondition",min_length=1,max_length=128)),
    responses((status=200,body=SetupOrganisationsResponse),(status=400,body=ErrorResponse),(status=401,body=ErrorResponse),(status=403,description="access_denied: no current auditor or audit manager role; engagement_setup_request_rejected: the CSRF, origin or expected-actor fence refused the request (reload)",body=ErrorResponse),(status=412,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn organisations(
    State(state): State<SetupHttpState>,
    headers: HeaderMap,
    query: Result<Query<SetupOrganisationsQuery>, axum::extract::rejection::QueryRejection>,
) -> Response {
    let (actor, repository) = match authorized(&state, &headers, false).await {
        Ok(value) => value,
        Err(response) => return *response,
    };
    let Ok(Query(query)) = query else {
        return error(SetupError::Invalid);
    };
    match repository
        .organisations(&actor, query.after.as_deref())
        .await
    {
        Ok(found) => Json(SetupOrganisationsResponse {
            more: found.more,
            limits: SetupLimitsResponse {
                open_setups: MAX_OPEN_SETUPS as u32,
                established_per_day: MAX_ESTABLISHED_PER_DAY as u32,
                setup_messages: MAX_SETUP_MESSAGES as u32,
                client_candidates: MAX_CLIENT_CANDIDATES as u32,
                objective_bytes: OBJECTIVE_MAX as u32,
                answer_bytes: ANSWER_MAX as u32,
            },
            organisations: found
                .organisations
                .into_iter()
                .map(|o| SetupOrganisationResponse {
                    organisation_id: o.id,
                    organisation_name: o.name,
                })
                .collect(),
        })
        .into_response(),
        Err(failure) => error(failure),
    }
}

#[utoipa::path(get,path="/organisations/{organisation_id}/engagement-setups",operation_id="list_engagement_setups",security(("server_session"=[])),
    params(("organisation_id"=String,Path,min_length=1,max_length=128,pattern="^[A-Za-z0-9_-]+$"),("X-Expected-Session"=Option<String>,Header,description="Optional session-bound read precondition",min_length=1,max_length=128)),
    responses((status=200,body=SetupsResponse),(status=401,body=ErrorResponse),(status=403,description="access_denied: no current auditor or audit manager role; engagement_setup_request_rejected: the CSRF, origin or expected-actor fence refused the request (reload)",body=ErrorResponse),(status=412,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn list(
    State(state): State<SetupHttpState>,
    headers: HeaderMap,
    Path(organisation_id): Path<String>,
) -> Response {
    let (actor, repository) = match authorized(&state, &headers, false).await {
        Ok(value) => value,
        Err(response) => return *response,
    };
    match repository.open_setups(&actor, &organisation_id).await {
        Ok(setups) => Json(SetupsResponse {
            setups: setups.into_iter().map(Into::into).collect(),
        })
        .into_response(),
        Err(failure) => error(failure),
    }
}

#[utoipa::path(post,path="/organisations/{organisation_id}/engagement-setups",operation_id="open_engagement_setup",security(("server_session"=[])),
    params(
        ("organisation_id"=String,Path,min_length=1,max_length=128,pattern="^[A-Za-z0-9_-]+$"),
        ("Origin"=String,Header,description="Exact configured HTTPS application origin"),
        ("X-CSRF-Token"=String,Header,description="Current session-bound token"),
        ("X-Expected-Actor"=String,Header,description="Expected current actor; refusal fence only",min_length=1,max_length=128,pattern="^[A-Za-z0-9_-]+$")
    ),request_body=OpenSetupRequest,
    responses((status=200,description="The objective is persisted, then Zobba asks for what is missing. An identical retry returns the original setup",body=SetupResponse),(status=400,body=ErrorResponse),(status=401,body=ErrorResponse),(status=403,description="access_denied: no current auditor or audit manager role; engagement_setup_request_rejected: the CSRF, origin or expected-actor fence refused the request (reload)",body=ErrorResponse),(status=409,description="Key reused with a different objective, or engagement_setup_open_limit",body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn open(
    State(state): State<SetupHttpState>,
    headers: HeaderMap,
    Path(organisation_id): Path<String>,
    body: Result<Json<OpenSetupRequest>, JsonRejection>,
) -> Response {
    let (actor, repository) = match authorized(&state, &headers, true).await {
        Ok(value) => value,
        Err(response) => return *response,
    };
    let Ok(Json(body)) = body else {
        return error(SetupError::Invalid);
    };
    view(
        repository
            .open(&actor, &organisation_id, &body.key, &body.objective)
            .await,
    )
}

#[utoipa::path(get,path="/organisations/{organisation_id}/engagement-setups/{setup_id}",operation_id="get_engagement_setup",security(("server_session"=[])),
    params(("organisation_id"=String,Path,min_length=1,max_length=128,pattern="^[A-Za-z0-9_-]+$"),("setup_id"=String,Path,min_length=1,max_length=128,pattern="^[A-Za-z0-9_-]+$"),("X-Expected-Session"=Option<String>,Header,description="Optional session-bound read precondition",min_length=1,max_length=128)),
    responses((status=200,body=SetupResponse),(status=401,body=ErrorResponse),(status=403,description="access_denied: no current auditor or audit manager role; engagement_setup_request_rejected: the CSRF, origin or expected-actor fence refused the request (reload)",body=ErrorResponse),(status=404,description="engagement_setup_not_found: no such setup for this actor here",body=ErrorResponse),(status=412,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn read(
    State(state): State<SetupHttpState>,
    headers: HeaderMap,
    Path((organisation_id, setup_id)): Path<(String, String)>,
) -> Response {
    let (actor, repository) = match authorized(&state, &headers, false).await {
        Ok(value) => value,
        Err(response) => return *response,
    };
    view(repository.get(&actor, &organisation_id, &setup_id).await)
}

#[utoipa::path(post,path="/organisations/{organisation_id}/engagement-setups/{setup_id}/messages",operation_id="answer_engagement_setup",security(("server_session"=[])),
    params(
        ("organisation_id"=String,Path,min_length=1,max_length=128,pattern="^[A-Za-z0-9_-]+$"),
        ("setup_id"=String,Path,min_length=1,max_length=128,pattern="^[A-Za-z0-9_-]+$"),
        ("Origin"=String,Header,description="Exact configured HTTPS application origin"),
        ("X-CSRF-Token"=String,Header,description="Current session-bound token"),
        ("X-Expected-Actor"=String,Header,description="Expected current actor; refusal fence only",min_length=1,max_length=128,pattern="^[A-Za-z0-9_-]+$")
    ),request_body=SetupMessageRequest,
    responses((status=200,description="The message is persisted, then answered deterministically. A refused answer is a retained Zobba refusal; the setup stays open",body=SetupResponse),(status=400,body=ErrorResponse),(status=401,body=ErrorResponse),(status=403,description="access_denied: no current auditor or audit manager role; engagement_setup_request_rejected: the CSRF, origin or expected-actor fence refused the request (reload)",body=ErrorResponse),(status=404,description="engagement_setup_not_found: no such setup for this actor here",body=ErrorResponse),(status=409,description="Key reused with a different meaning, closed setup, or engagement_setup_message_limit",body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn message(
    State(state): State<SetupHttpState>,
    headers: HeaderMap,
    Path((organisation_id, setup_id)): Path<(String, String)>,
    body: Result<Json<SetupMessageRequest>, JsonRejection>,
) -> Response {
    let (actor, repository) = match authorized(&state, &headers, true).await {
        Ok(value) => value,
        Err(response) => return *response,
    };
    let Ok(Json(body)) = body else {
        return error(SetupError::Invalid);
    };
    let key = body.key.clone();
    let Some(input) = body.input() else {
        return error(SetupError::Invalid);
    };
    if !valid_scope_id(&key) {
        return error(SetupError::Invalid);
    }
    view(
        repository
            .message(&actor, &organisation_id, &setup_id, &key, &input)
            .await,
    )
}

#[utoipa::path(post,path="/organisations/{organisation_id}/engagement-setups/{setup_id}/confirm",operation_id="confirm_engagement_setup",security(("server_session"=[])),
    params(
        ("organisation_id"=String,Path,min_length=1,max_length=128,pattern="^[A-Za-z0-9_-]+$"),
        ("setup_id"=String,Path,min_length=1,max_length=128,pattern="^[A-Za-z0-9_-]+$"),
        ("Origin"=String,Header,description="Exact configured HTTPS application origin"),
        ("X-CSRF-Token"=String,Header,description="Current session-bound token"),
        ("X-Expected-Actor"=String,Header,description="Expected current actor; refusal fence only",min_length=1,max_length=128,pattern="^[A-Za-z0-9_-]+$")
    ),request_body=ConfirmSetupRequest,
    responses((status=200,description="One transaction created the client (when new), the engagement with its period, the creator's assignment and the first Task. A retry or a concurrent confirmation returns the original receipt",body=SetupResponse),(status=400,body=ErrorResponse),(status=401,body=ErrorResponse),(status=403,description="access_denied: no current auditor or audit manager role; engagement_setup_request_rejected: the CSRF, origin or expected-actor fence refused the request (reload)",body=ErrorResponse),(status=404,description="engagement_setup_not_found: no such setup for this actor here",body=ErrorResponse),(status=409,description="Not ready to confirm, key reused, engagement_setup_message_limit, engagement_setup_daily_limit or engagement_setup_confirm_failed. A refusal after the confirmation was saved is retained as a Zobba turn; replaying that key repeats it and never establishes",body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn confirm(
    State(state): State<SetupHttpState>,
    headers: HeaderMap,
    Path((organisation_id, setup_id)): Path<(String, String)>,
    body: Result<Json<ConfirmSetupRequest>, JsonRejection>,
) -> Response {
    let (actor, repository) = match authorized(&state, &headers, true).await {
        Ok(value) => value,
        Err(response) => return *response,
    };
    let Ok(Json(body)) = body else {
        return error(SetupError::Invalid);
    };
    view(
        repository
            .confirm(&actor, &organisation_id, &setup_id, &body.key)
            .await,
    )
}
