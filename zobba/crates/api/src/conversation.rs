//! Finite conversation reads share ordinary Task capacity. They never hold a
//! database connection or writer lock while waiting for a viewer.
use crate::{
    auth::{AuthState, ErrorResponse},
    tasks::{CommandKindRequest, TaskEventResponse, TaskResponse, cursor, failure},
};
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::HeaderMap,
    response::{IntoResponse, Response},
    routing::get,
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use utoipa::ToSchema;
use zobba_application::{conversation::ConversationRead, task::TaskError};
use zobba_domain::{
    conversation::{
        ConversationActivity, ConversationFeed, ConversationHistory, ConversationMessage,
        ConversationSnapshot,
    },
    identity::{Scope, valid_scope_id},
    task::CommandKind,
};
use zobba_infrastructure::conversation::ConversationRepository;

#[derive(Clone)]
pub(crate) struct ConversationHttpState {
    identity: AuthState,
    repository: ConversationRepository,
}
pub(crate) fn router(pool: PgPool, identity: AuthState) -> Router {
    Router::new()
        .route("/engagements/{engagement_id}/conversation", get(snapshot))
        .route(
            "/engagements/{engagement_id}/conversation/history",
            get(history),
        )
        .route(
            "/engagements/{engagement_id}/conversation/events",
            get(events),
        )
        .with_state(ConversationHttpState {
            identity,
            repository: ConversationRepository::new(pool),
        })
}

#[derive(Serialize, ToSchema)]
pub struct ConversationScopeResponse {
    pub organisation_id: String,
    pub client_id: String,
    pub engagement_id: String,
}
impl From<Scope> for ConversationScopeResponse {
    fn from(s: Scope) -> Self {
        Self {
            organisation_id: s.organisation_id,
            client_id: s.client_id,
            engagement_id: s.engagement_id,
        }
    }
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ConversationAudienceResponse {
    EngagementMembers,
}
#[derive(Serialize, ToSchema)]
pub struct ConversationMessageResponse {
    pub command_id: String,
    pub key: String,
    pub author_id: String,
    /// Current public label of the retained author; role changes do not erase authorship.
    #[schema(max_length = 200)]
    pub author_label: String,
    pub kind: CommandKindRequest,
    pub task_id: String,
    /// Resulting cycle. Continue preserves its old addressed cycle separately below.
    pub cycle_id: String,
    #[schema(required = true)]
    pub target_task_id: Option<String>,
    #[schema(required = true)]
    pub target_cycle_id: Option<String>,
    #[schema(required = true, max_length = 4000)]
    pub content: Option<String>,
    /// Exact optional Create or Guide context retained for durable command recovery.
    pub context: Option<crate::methodology::MethodologyTaskContext>,
    #[schema(pattern = "^[0-9]+$")]
    pub received_cursor: String,
    /// Applied means retained plain text reached a work boundary, not model understanding.
    #[schema(required = true, pattern = "^[0-9]+$")]
    pub applied_cursor: Option<String>,
}
impl From<ConversationMessage> for ConversationMessageResponse {
    fn from(m: ConversationMessage) -> Self {
        Self {
            command_id: m.command_id,
            key: m.key,
            author_id: m.author_id,
            author_label: m.author_label,
            kind: match m.kind {
                CommandKind::Create => CommandKindRequest::Create,
                CommandKind::Guide => CommandKindRequest::Guide,
                CommandKind::Pause => CommandKindRequest::Pause,
                CommandKind::Resume => CommandKindRequest::Resume,
                CommandKind::Stop => CommandKindRequest::Stop,
                CommandKind::Continue => CommandKindRequest::Continue,
            },
            task_id: m.task_id,
            cycle_id: m.cycle_id,
            target_task_id: m.target_task_id,
            target_cycle_id: m.target_cycle_id,
            content: m.content,
            context: m.context.map(Into::into),
            received_cursor: m.received_cursor,
            applied_cursor: m.applied_cursor,
        }
    }
}
#[derive(Serialize, ToSchema)]
pub struct ConversationActivityResponse {
    /// Decimal Received or Applied cursor, no greater than the snapshot watermark.
    #[schema(pattern = "^[1-9][0-9]{0,18}$", max_length = 19)]
    pub cursor: String,
    #[schema(pattern = "^[A-Za-z0-9_-]+$", min_length = 1, max_length = 128)]
    pub task_id: String,
}
impl From<ConversationActivity> for ConversationActivityResponse {
    fn from(activity: ConversationActivity) -> Self {
        Self {
            cursor: activity.cursor,
            task_id: activity.task_id,
        }
    }
}
#[derive(Serialize, ToSchema)]
pub struct ConversationSnapshotResponse {
    pub scope: ConversationScopeResponse,
    pub audience: ConversationAudienceResponse,
    /// All included Task state and receipt facts come from the same statement as this cursor.
    #[schema(pattern = "^[0-9]+$")]
    pub watermark: String,
    /// Latest current-scope Received or Applied fact, independent of message and Task pages.
    #[schema(required = true)]
    pub latest_activity: Option<ConversationActivityResponse>,
    /// Latest 100 accepted commands in ascending Received order; not the complete history.
    #[schema(max_items = 100)]
    pub messages: Vec<ConversationMessageResponse>,
    /// Exclusive Received cursor for the preceding history page at this watermark.
    #[schema(required = true, pattern = "^[0-9]+$")]
    pub before_cursor: Option<String>,
    /// First 100 current Tasks ordered by ID; open any known ID independently.
    #[schema(max_items = 100)]
    pub tasks: Vec<TaskResponse>,
    /// Continue through GET tasks?after_task_id; those pages are fresh current reads.
    #[schema(required = true)]
    pub next_task_cursor: Option<String>,
}
impl From<ConversationSnapshot> for ConversationSnapshotResponse {
    fn from(s: ConversationSnapshot) -> Self {
        Self {
            scope: s.scope.into(),
            audience: ConversationAudienceResponse::EngagementMembers,
            watermark: s.watermark,
            latest_activity: s.latest_activity.map(Into::into),
            messages: s.messages.into_iter().map(Into::into).collect(),
            before_cursor: s.before_cursor,
            tasks: s.tasks.into_iter().map(Into::into).collect(),
            next_task_cursor: s.next_task_cursor,
        }
    }
}
#[derive(Serialize, ToSchema)]
pub struct ConversationHistoryResponse {
    pub scope: ConversationScopeResponse,
    pub audience: ConversationAudienceResponse,
    /// Requested fixed through cursor, including Applied facts only through that cursor.
    #[schema(pattern = "^[0-9]+$")]
    pub watermark: String,
    #[schema(max_items = 100)]
    pub messages: Vec<ConversationMessageResponse>,
    #[schema(required = true, pattern = "^[0-9]+$")]
    pub before_cursor: Option<String>,
}
impl From<ConversationHistory> for ConversationHistoryResponse {
    fn from(s: ConversationHistory) -> Self {
        Self {
            scope: s.scope.into(),
            audience: ConversationAudienceResponse::EngagementMembers,
            watermark: s.watermark,
            messages: s.messages.into_iter().map(Into::into).collect(),
            before_cursor: s.before_cursor,
        }
    }
}
#[derive(Serialize, ToSchema)]
pub struct ConversationFeedResponse {
    pub scope: ConversationScopeResponse,
    pub audience: ConversationAudienceResponse,
    #[schema(pattern = "^[0-9]+$")]
    pub watermark: String,
    /// Invalidation facts; obtain a new consistent snapshot to replace current state.
    #[schema(max_items = 100)]
    pub events: Vec<TaskEventResponse>,
    /// Last returned cursor, or unchanged input. Never advances over omitted facts.
    #[schema(pattern = "^[0-9]+$")]
    pub next_cursor: String,
    pub has_more: bool,
    /// Gap, cursor ahead of server, or backlog exceeding 1000: refresh the snapshot.
    /// Events is empty and next_cursor unchanged; do not infer progress from watermark.
    pub resync_required: bool,
}
impl From<ConversationFeed> for ConversationFeedResponse {
    fn from(s: ConversationFeed) -> Self {
        Self {
            scope: s.scope.into(),
            audience: ConversationAudienceResponse::EngagementMembers,
            watermark: s.watermark,
            events: s.events.into_iter().map(Into::into).collect(),
            next_cursor: s.next_cursor,
            has_more: s.has_more,
            resync_required: s.resync_required,
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ScopeQuery {
    organisation_id: String,
    client_id: String,
}
fn scope(
    engagement_id: String,
    organisation_id: String,
    client_id: String,
) -> Result<Scope, TaskError> {
    let scope = Scope {
        organisation_id,
        client_id,
        engagement_id,
    };
    if scope.is_valid() {
        Ok(scope)
    } else {
        Err(TaskError::Denied)
    }
}

#[utoipa::path(get,path="/engagements/{engagement_id}/conversation",operation_id="get_conversation",security(("server_session"=[])),
    params(("X-Expected-Session"=Option<String>,Header,description="Optional session-bound read precondition from the in-memory session CSRF token; mismatch refuses without changing the cookie",min_length=1,max_length=128),("engagement_id"=String,Path),("organisation_id"=String,Query),("client_id"=String,Query)),
    responses((status=412,description="Session changed; compose fresh reads without replacing the current cookie",body=ErrorResponse),(status=200,description="One consistent current snapshot, bounded messages and Tasks with explicit page continuations",body=ConversationSnapshotResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn snapshot(
    State(state): State<ConversationHttpState>,
    headers: HeaderMap,
    Path(engagement_id): Path<String>,
    query: Result<Query<ScopeQuery>, axum::extract::rejection::QueryRejection>,
) -> Response {
    let current = match state.identity.current_read(&headers).await {
        Ok(current) => current,
        Err(error) => return crate::auth::failure(error),
    };
    let s = match query
        .map_err(|_| TaskError::Denied)
        .and_then(|Query(q)| scope(engagement_id, q.organisation_id, q.client_id))
    {
        Ok(s) => s,
        Err(error) => return failure(error),
    };
    match state.repository.snapshot(&current.identity.id, &s).await {
        Ok(snapshot) => Json(ConversationSnapshotResponse::from(snapshot)).into_response(),
        Err(error) => failure(error),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct HistoryQuery {
    organisation_id: String,
    client_id: String,
    through: String,
    before: Option<String>,
    task_id: Option<String>,
}
#[utoipa::path(get,path="/engagements/{engagement_id}/conversation/history",operation_id="get_conversation_history",security(("server_session"=[])),
    params(("X-Expected-Session"=Option<String>,Header,description="Optional session-bound read precondition from the in-memory session CSRF token; mismatch refuses without changing the cookie",min_length=1,max_length=128),("engagement_id"=String,Path),("organisation_id"=String,Query),("client_id"=String,Query),("through"=String,Query,description="Snapshot watermark bounding retained Received and Applied facts",pattern="^[0-9]+$",max_length=19),("before"=Option<String>,Query,description="Exclusive Received cursor; omitted returns latest page through watermark",pattern="^[0-9]+$",max_length=19),("task_id"=Option<String>,Query,description="Optional exact Task history",min_length=1,max_length=128,pattern="^[A-Za-z0-9_-]+$")),
    responses((status=412,description="Session changed; compose fresh reads without replacing the current cookie",body=ErrorResponse),(status=200,body=ConversationHistoryResponse),(status=400,body=ErrorResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=409,description="Requested watermark is ahead of retained history; resnapshot",body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn history(
    State(state): State<ConversationHttpState>,
    headers: HeaderMap,
    Path(engagement_id): Path<String>,
    query: Result<Query<HistoryQuery>, axum::extract::rejection::QueryRejection>,
) -> Response {
    let current = match state.identity.current_read(&headers).await {
        Ok(current) => current,
        Err(error) => return crate::auth::failure(error),
    };
    let Query(q) = match query {
        Ok(q) => q,
        Err(_) => return failure(TaskError::Invalid),
    };
    let s = match scope(engagement_id, q.organisation_id, q.client_id) {
        Ok(s) => s,
        Err(error) => return failure(error),
    };
    let through = match cursor(Some(&q.through)) {
        Ok(v) => v,
        Err(e) => return failure(e),
    };
    let before = match q.before.as_deref().map(|v| cursor(Some(v))).transpose() {
        Ok(v) => v,
        Err(e) => return failure(e),
    };
    if q.task_id.as_deref().is_some_and(|id| !valid_scope_id(id)) {
        return failure(TaskError::Invalid);
    }
    match state
        .repository
        .history(
            &current.identity.id,
            &s,
            through,
            before,
            q.task_id.as_deref(),
        )
        .await
    {
        Ok(history) => Json(ConversationHistoryResponse::from(history)).into_response(),
        Err(error) => failure(error),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct FeedQuery {
    organisation_id: String,
    client_id: String,
    after: String,
}
#[utoipa::path(get,path="/engagements/{engagement_id}/conversation/events",operation_id="get_conversation_events",security(("server_session"=[])),
    params(("X-Expected-Session"=Option<String>,Header,description="Optional session-bound read precondition from the in-memory session CSRF token; mismatch refuses without changing the cookie",min_length=1,max_length=128),("engagement_id"=String,Path),("organisation_id"=String,Query),("client_id"=String,Query),("after"=String,Query,description="Last delivered decimal cursor or snapshot watermark",pattern="^[0-9]+$",max_length=19)),
    responses((status=412,description="Session changed; compose fresh reads without replacing the current cookie",body=ErrorResponse),(status=200,description="Finite ordered invalidation page; explicit resync for gaps or replay overflow",body=ConversationFeedResponse),(status=400,body=ErrorResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn events(
    State(state): State<ConversationHttpState>,
    headers: HeaderMap,
    Path(engagement_id): Path<String>,
    query: Result<Query<FeedQuery>, axum::extract::rejection::QueryRejection>,
) -> Response {
    let current = match state.identity.current_read(&headers).await {
        Ok(current) => current,
        Err(error) => return crate::auth::failure(error),
    };
    let Query(q) = match query {
        Ok(q) => q,
        Err(_) => return failure(TaskError::Invalid),
    };
    let s = match scope(engagement_id, q.organisation_id, q.client_id) {
        Ok(s) => s,
        Err(error) => return failure(error),
    };
    let after = match cursor(Some(&q.after)) {
        Ok(v) => v,
        Err(e) => return failure(e),
    };
    match state
        .repository
        .events(&current.identity.id, &s, after)
        .await
    {
        Ok(feed) => Json(ConversationFeedResponse::from(feed)).into_response(),
        Err(error) => failure(error),
    }
}
