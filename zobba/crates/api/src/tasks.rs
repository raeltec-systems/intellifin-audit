//! Bounded scoped commands. Controls reserve authentication and database capacity.
use std::{sync::Arc, time::Duration};

use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Path, Query, State, rejection::JsonRejection},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get as route_get, post},
};
use serde::{Deserialize, Serialize};
use sqlx::postgres::PgPoolOptions;
use tokio::sync::Semaphore;
use utoipa::ToSchema;
use zobba_application::task::{TaskCommands, TaskError};
use zobba_domain::{
    identity::{Scope, valid_scope_id},
    task::{
        Cessation, CommandKind, CommandReceipt, TaskCommand, TaskEvent, TaskSnapshot, TaskState,
    },
};
use zobba_infrastructure::{RuntimeDatabase, identity::IdentityRepository, task::TaskRepository};

use crate::auth::{AuthState, ErrorResponse};

const REQUEST_BYTES: usize = 32 * 1_024;
const REQUEST_DEADLINE: Duration = Duration::from_secs(6);

#[derive(Clone)]
pub(crate) struct TaskHttpState {
    pub(crate) identity: AuthState,
    pub(crate) repository: TaskRepository,
    control: bool,
    /// Trusted qualification composition for availability reads. Production
    /// installs none, so `model_available` is honestly false.
    pub(crate) models: Option<zobba_infrastructure::model::ModelRepository>,
}

pub(crate) fn router(database: &RuntimeDatabase, identity: AuthState) -> Router {
    // Connect lazily to the already validated endpoint. Neither work nor normal
    // authentication/read traffic can occupy these two control connections.
    let control_pool = PgPoolOptions::new()
        .max_connections(2)
        .acquire_timeout(Duration::from_secs(1))
        .connect_lazy_with(database.pool().connect_options().as_ref().clone());
    let controls = Router::new()
        .route("/engagements/{engagement_id}/task-controls", post(control))
        .route(
            "/engagements/{engagement_id}/task-directions",
            post(crate::work::direct),
        )
        .route(
            "/engagements/{engagement_id}/task-questions",
            route_get(crate::work::questions),
        )
        .route(
            "/engagements/{engagement_id}/task-questions/{question_id}/answer",
            post(crate::work::answer),
        )
        .with_state(TaskHttpState {
            identity: identity
                .clone()
                .with_repository(IdentityRepository::new(control_pool.clone())),
            repository: TaskRepository::new(control_pool),
            control: true,
            models: None,
        });
    let conversation = crate::conversation::router(database.pool().clone(), identity.clone());
    let operations = crate::operations::router(database.pool().clone(), identity.clone());
    let ordinary = Router::new()
        .route("/engagements/{engagement_id}/task-commands", post(admit))
        .route("/engagements/{engagement_id}/tasks", route_get(list))
        .route(
            "/engagements/{engagement_id}/tasks/{task_id}",
            route_get(get),
        )
        .route(
            "/engagements/{engagement_id}/task-events",
            route_get(events),
        )
        .route(
            "/engagements/{engagement_id}/tasks/{task_id}/work",
            route_get(crate::work::get_work),
        )
        .with_state(TaskHttpState {
            identity,
            repository: TaskRepository::new(database.pool().clone()),
            control: false,
            models: None,
        })
        .merge(conversation)
        .merge(operations);
    bounded(ordinary, 8).merge(bounded(controls, 4))
}

fn bounded(router: Router, capacity: usize) -> Router {
    let capacity = Arc::new(Semaphore::new(capacity));
    router
        .layer(DefaultBodyLimit::max(REQUEST_BYTES))
        .layer(axum::middleware::from_fn(
            move |request: axum::extract::Request, next: axum::middleware::Next| {
                let capacity = capacity.clone();
                async move {
                    let Ok(_permit) = capacity.try_acquire_owned() else {
                        return failure(TaskError::Capacity);
                    };
                    match tokio::time::timeout(REQUEST_DEADLINE, next.run(request)).await {
                        Ok(response) => response,
                        Err(_) => failure(TaskError::Unavailable),
                    }
                }
            },
        ))
}

pub(crate) fn failure(error: TaskError) -> Response {
    let status = match error {
        TaskError::Invalid => StatusCode::BAD_REQUEST,
        TaskError::Denied => StatusCode::FORBIDDEN,
        TaskError::Conflict | TaskError::Fenced => StatusCode::CONFLICT,
        TaskError::Capacity => StatusCode::TOO_MANY_REQUESTS,
        TaskError::Unavailable => StatusCode::SERVICE_UNAVAILABLE,
    };
    (
        status,
        Json(ErrorResponse {
            error: error.code(),
        }),
    )
        .into_response()
}

#[derive(Clone, Copy, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum CommandKindRequest {
    Create,
    Guide,
    Pause,
    Resume,
    Stop,
    Continue,
}

impl From<CommandKindRequest> for CommandKind {
    fn from(value: CommandKindRequest) -> Self {
        match value {
            CommandKindRequest::Create => Self::Create,
            CommandKindRequest::Guide => Self::Guide,
            CommandKindRequest::Pause => Self::Pause,
            CommandKindRequest::Resume => Self::Resume,
            CommandKindRequest::Stop => Self::Stop,
            CommandKindRequest::Continue => Self::Continue,
        }
    }
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct TaskCommandRequest {
    /// Author and composite scope bind this key. Identical retries return the original receipt.
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub key: String,
    pub kind: CommandKindRequest,
    /// Required together with cycle_id except for Create, which requires both absent/null.
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub task_id: Option<String>,
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub cycle_id: Option<String>,
    /// Exact retained text, at most 4000 UTF-8 bytes. Required only for Create and Guide.
    /// Must contain non-whitespace; control characters other than LF, CR and tab are refused.
    #[schema(min_length = 1, max_length = 4000)]
    pub content: Option<String>,
    /// Optional methodology context for Create or Guide. Guide supplies a full
    /// replacement; omitted/null leaves the current context unchanged. Create
    /// does not require a methodology picker before accepting the Task.
    pub context: Option<crate::methodology::MethodologyTaskContext>,
}

impl From<TaskCommandRequest> for TaskCommand {
    fn from(value: TaskCommandRequest) -> Self {
        Self {
            key: value.key,
            kind: value.kind.into(),
            task_id: value.task_id,
            cycle_id: value.cycle_id,
            content: value.content,
            context: value.context.map(Into::into),
        }
    }
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ReceiptStatusResponse {
    Received,
}

#[derive(Serialize, ToSchema)]
pub struct CommandReceiptResponse {
    pub command_id: String,
    pub task_id: String,
    pub cycle_id: String,
    /// Decimal commit-ordered cursor; represented as text to preserve integer precision.
    #[schema(pattern = "^[0-9]+$")]
    pub event_cursor: String,
    /// Admission is durable. Applied and observed cessation are separate event/snapshot facts.
    pub status: ReceiptStatusResponse,
}

impl From<CommandReceipt> for CommandReceiptResponse {
    fn from(value: CommandReceipt) -> Self {
        Self {
            command_id: value.command_id,
            task_id: value.task_id,
            cycle_id: value.cycle_id,
            event_cursor: value.event_cursor,
            status: ReceiptStatusResponse::Received,
        }
    }
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum TaskStateResponse {
    Ready,
    Running,
    Paused,
    Stopped,
    Waiting,
}

impl From<TaskState> for TaskStateResponse {
    fn from(value: TaskState) -> Self {
        match value {
            TaskState::Ready => Self::Ready,
            TaskState::Running => Self::Running,
            TaskState::Paused => Self::Paused,
            TaskState::Stopped => Self::Stopped,
            TaskState::Waiting => Self::Waiting,
        }
    }
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum CessationResponse {
    None,
    Pending,
    Confirmed,
    ReconciliationRequired,
}

impl From<Cessation> for CessationResponse {
    fn from(value: Cessation) -> Self {
        match value {
            Cessation::None => Self::None,
            Cessation::Pending => Self::Pending,
            Cessation::Confirmed => Self::Confirmed,
            Cessation::ReconciliationRequired => Self::ReconciliationRequired,
        }
    }
}

#[derive(Serialize, ToSchema)]
pub struct TaskResponse {
    pub id: String,
    pub cycle_id: String,
    pub objective: String,
    /// Retained plain text; no model understanding or audit result is asserted.
    pub working_brief: String,
    /// Desired control/work state; Paused/Stopped require separate observed cessation.
    pub state: TaskStateResponse,
    pub cessation: CessationResponse,
    #[schema(pattern = "^[0-9]+$")]
    pub intent_revision: String,
    #[schema(pattern = "^[0-9]+$")]
    pub revision: String,
    #[schema(pattern = "^[0-9]+$")]
    pub execution_epoch: String,
    /// Accountable human identity, distinct from worker ownership.
    pub accountable_actor: String,
    /// Current public label of the accountable human, independent of recent message pages.
    #[schema(max_length = 200)]
    pub accountable_label: String,
}

impl From<TaskSnapshot> for TaskResponse {
    fn from(value: TaskSnapshot) -> Self {
        Self {
            id: value.id,
            cycle_id: value.cycle_id,
            objective: value.objective,
            working_brief: value.working_brief,
            state: value.state.into(),
            cessation: value.cessation.into(),
            intent_revision: value.intent_revision.to_string(),
            revision: value.revision.to_string(),
            execution_epoch: value.execution_epoch.to_string(),
            accountable_actor: value.accountable_actor,
            accountable_label: value.accountable_label,
        }
    }
}

#[derive(Serialize, ToSchema)]
pub struct TasksResponse {
    /// Current projection ordered by Task ID; open known IDs independently of this page.
    #[schema(max_items = 100)]
    pub tasks: Vec<TaskResponse>,
    /// Pass this Task ID as after_task_id; null means no further current Tasks.
    #[schema(
        required = true,
        min_length = 1,
        max_length = 128,
        pattern = "^[A-Za-z0-9_-]+$"
    )]
    pub next_cursor: Option<String>,
}

#[derive(Serialize, ToSchema)]
pub struct TaskEventResponse {
    #[schema(pattern = "^[0-9]+$")]
    pub cursor: String,
    pub task_id: String,
    pub cycle_id: String,
    #[schema(required = true)]
    pub command_id: Option<String>,
    /// Fixed event category, including received and applied. No content or capability is included.
    pub kind: String,
}

impl From<TaskEvent> for TaskEventResponse {
    fn from(value: TaskEvent) -> Self {
        Self {
            cursor: value.cursor,
            task_id: value.task_id,
            cycle_id: value.cycle_id,
            command_id: value.command_id,
            kind: value.kind,
        }
    }
}

#[derive(Serialize, ToSchema)]
pub struct TaskEventsResponse {
    #[schema(max_items = 100)]
    pub events: Vec<TaskEventResponse>,
    /// Last returned cursor, or the input cursor on an empty page. Poll again from this value.
    #[schema(pattern = "^[0-9]+$")]
    pub next_cursor: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct TaskScopeQuery {
    organisation_id: String,
    client_id: String,
}

impl TaskScopeQuery {
    pub(crate) fn scope(self, engagement_id: String) -> Result<Scope, TaskError> {
        let scope = Scope {
            organisation_id: self.organisation_id,
            client_id: self.client_id,
            engagement_id,
        };
        if scope.is_valid() {
            Ok(scope)
        } else {
            Err(TaskError::Denied)
        }
    }
}

#[utoipa::path(post,path="/engagements/{engagement_id}/task-commands",operation_id="admit_task_command",security(("server_session"=[])),
    params(
        ("engagement_id"=String,Path,min_length=1,max_length=128,pattern="^[A-Za-z0-9_-]+$"),
        ("organisation_id"=String,Query,min_length=1,max_length=128,pattern="^[A-Za-z0-9_-]+$"),
        ("client_id"=String,Query,min_length=1,max_length=128,pattern="^[A-Za-z0-9_-]+$"),
        ("Origin"=String,Header,description="Exact configured HTTPS application origin"),
        ("X-CSRF-Token"=String,Header,description="Current session-bound token")
        ,("X-Expected-Actor"=Option<String>,Header,description="Optional additional refusal fence: expected current actor, never author authority",min_length=1,max_length=128,pattern="^[A-Za-z0-9_-]+$")
    ),request_body=TaskCommandRequest,
    responses((status=202,description="Durable immutable Received receipt for Create, Resume or Continue; identical retry returns the original",body=CommandReceiptResponse),(status=400,body=ErrorResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=409,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn admit(
    State(state): State<TaskHttpState>,
    headers: HeaderMap,
    Path(engagement_id): Path<String>,
    query: Result<Query<TaskScopeQuery>, axum::extract::rejection::QueryRejection>,
    body: Result<Json<TaskCommandRequest>, JsonRejection>,
) -> Response {
    command(state, headers, engagement_id, query, body).await
}

#[utoipa::path(post,path="/engagements/{engagement_id}/task-controls",operation_id="admit_task_control",security(("server_session"=[])),
    params(
        ("engagement_id"=String,Path,min_length=1,max_length=128,pattern="^[A-Za-z0-9_-]+$"),
        ("organisation_id"=String,Query,min_length=1,max_length=128,pattern="^[A-Za-z0-9_-]+$"),
        ("client_id"=String,Query,min_length=1,max_length=128,pattern="^[A-Za-z0-9_-]+$"),
        ("Origin"=String,Header,description="Exact configured HTTPS application origin"),
        ("X-CSRF-Token"=String,Header,description="Current session-bound token")
        ,("X-Expected-Actor"=Option<String>,Header,description="Optional additional refusal fence: expected current actor, never author authority",min_length=1,max_length=128,pattern="^[A-Za-z0-9_-]+$")
    ),request_body=TaskCommandRequest,
    responses((status=202,description="Reserved admission/authentication for Guide, Pause and Stop; Received is not proof of cessation",body=CommandReceiptResponse),(status=400,body=ErrorResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=409,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn control(
    State(state): State<TaskHttpState>,
    headers: HeaderMap,
    Path(engagement_id): Path<String>,
    query: Result<Query<TaskScopeQuery>, axum::extract::rejection::QueryRejection>,
    body: Result<Json<TaskCommandRequest>, JsonRejection>,
) -> Response {
    command(state, headers, engagement_id, query, body).await
}

async fn command(
    state: TaskHttpState,
    headers: HeaderMap,
    engagement_id: String,
    query: Result<Query<TaskScopeQuery>, axum::extract::rejection::QueryRejection>,
    body: Result<Json<TaskCommandRequest>, JsonRejection>,
) -> Response {
    let current = match state.identity.current(&headers).await {
        Ok(current) => current,
        Err(error) => return crate::auth::failure(error),
    };
    // A persisted outbox belongs to one actor. The server session remains the
    // sole author source; this optional backwards-compatible header only adds a
    // refusal fence when a browser session changes between rendering and POST.
    let mut expected = headers.get_all("x-expected-actor").iter();
    if let Some(value) = expected.next()
        && (expected.next().is_some()
            || value
                .to_str()
                .ok()
                .is_none_or(|actor| !valid_scope_id(actor) || actor != current.identity.id))
    {
        return failure(TaskError::Denied);
    }
    if !state
        .identity
        .permits_mutation(&headers, &current.csrf_token)
    {
        return failure(TaskError::Denied);
    }
    let scope = match query
        .map_err(|_| TaskError::Denied)
        .and_then(|Query(query)| query.scope(engagement_id))
    {
        Ok(scope) => scope,
        Err(error) => return failure(error),
    };
    let command: TaskCommand = match body {
        Ok(Json(command)) => command.into(),
        Err(_) => return failure(TaskError::Invalid),
    };
    if !command.is_valid() || command.kind.is_control() != state.control {
        return failure(TaskError::Invalid);
    }
    let Some(token) = crate::auth::cookie(&headers, crate::auth::SESSION_COOKIE) else {
        return failure(TaskError::Denied);
    };
    match state
        .repository
        .with_session_hash(zobba_infrastructure::identity::secret_hash(&token))
        .admit(&current.identity.id, &scope, &command)
        .await
    {
        Ok(receipt) => (
            StatusCode::ACCEPTED,
            Json(CommandReceiptResponse::from(receipt)),
        )
            .into_response(),
        Err(error) => failure(error),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct TaskListQuery {
    organisation_id: String,
    client_id: String,
    after_task_id: Option<String>,
}

#[utoipa::path(get,path="/engagements/{engagement_id}/tasks",operation_id="list_tasks",security(("server_session"=[])),
    params(("X-Expected-Session"=Option<String>,Header,description="Optional session-bound read precondition from the in-memory session CSRF token; mismatch refuses without changing the cookie",min_length=1,max_length=128),("engagement_id"=String,Path),("organisation_id"=String,Query),("client_id"=String,Query),("after_task_id"=Option<String>,Query,description="Exclusive Task ID cursor from next_cursor",min_length=1,max_length=128,pattern="^[A-Za-z0-9_-]+$")),
    responses((status=412,description="Session changed; compose fresh reads without replacing the current cookie",body=ErrorResponse),(status=200,body=TasksResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn list(
    State(state): State<TaskHttpState>,
    headers: HeaderMap,
    Path(engagement_id): Path<String>,
    query: Result<Query<TaskListQuery>, axum::extract::rejection::QueryRejection>,
) -> Response {
    let current = match state.identity.current_read(&headers).await {
        Ok(current) => current,
        Err(error) => return crate::auth::failure(error),
    };
    let Query(query) = match query {
        Ok(query) => query,
        Err(_) => return failure(TaskError::Denied),
    };
    if query
        .after_task_id
        .as_deref()
        .is_some_and(|id| !valid_scope_id(id))
    {
        return failure(TaskError::Denied);
    }
    let scope = match (TaskScopeQuery {
        organisation_id: query.organisation_id,
        client_id: query.client_id,
    })
    .scope(engagement_id)
    {
        Ok(scope) => scope,
        Err(error) => return failure(error),
    };
    match state
        .repository
        .list(&current.identity.id, &scope, query.after_task_id.as_deref())
        .await
    {
        Ok(page) => Json(TasksResponse {
            tasks: page.tasks.into_iter().map(Into::into).collect(),
            next_cursor: page.next_cursor,
        })
        .into_response(),
        Err(error) => failure(error),
    }
}

#[utoipa::path(get,path="/engagements/{engagement_id}/tasks/{task_id}",operation_id="get_task",security(("server_session"=[])),
    params(("X-Expected-Session"=Option<String>,Header,description="Optional session-bound read precondition from the in-memory session CSRF token; mismatch refuses without changing the cookie",min_length=1,max_length=128),("engagement_id"=String,Path),("task_id"=String,Path),("organisation_id"=String,Query),("client_id"=String,Query)),
    responses((status=412,description="Session changed; compose fresh reads without replacing the current cookie",body=ErrorResponse),(status=200,body=TaskResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn get(
    State(state): State<TaskHttpState>,
    headers: HeaderMap,
    Path((engagement_id, task_id)): Path<(String, String)>,
    query: Result<Query<TaskScopeQuery>, axum::extract::rejection::QueryRejection>,
) -> Response {
    let (actor, scope) = match read_scope(&state, &headers, engagement_id, query).await {
        Ok(value) => value,
        Err(error) => return crate::auth::failure(error),
    };
    if !valid_scope_id(&task_id) {
        return failure(TaskError::Denied);
    }
    match state.repository.get(&actor, &scope, &task_id).await {
        Ok(task) => Json(TaskResponse::from(task)).into_response(),
        Err(error) => failure(error),
    }
}

async fn read_scope(
    state: &TaskHttpState,
    headers: &HeaderMap,
    engagement_id: String,
    query: Result<Query<TaskScopeQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<(String, Scope), zobba_application::identity::IdentityError> {
    let current = state.identity.current_read(headers).await?;
    let scope = query
        .map_err(|_| TaskError::Denied)
        .and_then(|Query(query)| query.scope(engagement_id))
        .map_err(|_| zobba_application::identity::IdentityError::Denied)?;
    Ok((current.identity.id, scope))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct EventsQuery {
    organisation_id: String,
    client_id: String,
    after: Option<String>,
}

pub(crate) fn cursor(value: Option<&str>) -> Result<u64, TaskError> {
    let Some(value) = value else {
        return Ok(0);
    };
    if value.is_empty() || value.len() > 19 || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(TaskError::Invalid);
    }
    value
        .parse::<u64>()
        .ok()
        .filter(|value| *value <= i64::MAX as u64)
        .ok_or(TaskError::Invalid)
}

#[utoipa::path(get,path="/engagements/{engagement_id}/task-events",operation_id="list_task_events",security(("server_session"=[])),
    params(("X-Expected-Session"=Option<String>,Header,description="Optional session-bound read precondition from the in-memory session CSRF token; mismatch refuses without changing the cookie",min_length=1,max_length=128),("engagement_id"=String,Path),("organisation_id"=String,Query),("client_id"=String,Query),("after"=Option<String>,Query,description="Decimal durable cursor; omitted starts at zero",pattern="^[0-9]+$",max_length=19)),
    responses((status=412,description="Session changed; compose fresh reads without replacing the current cookie",body=ErrorResponse),(status=200,description="At most 100 commit-ordered metadata events; repeat from next_cursor to drain/reconnect",body=TaskEventsResponse),(status=400,body=ErrorResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn events(
    State(state): State<TaskHttpState>,
    headers: HeaderMap,
    Path(engagement_id): Path<String>,
    query: Result<Query<EventsQuery>, axum::extract::rejection::QueryRejection>,
) -> Response {
    let current = match state.identity.current_read(&headers).await {
        Ok(current) => current,
        Err(error) => return crate::auth::failure(error),
    };
    let Query(query) = match query {
        Ok(query) => query,
        Err(_) => return failure(TaskError::Invalid),
    };
    let after = match cursor(query.after.as_deref()) {
        Ok(after) => after,
        Err(error) => return failure(error),
    };
    let empty_cursor = query.after.unwrap_or_else(|| "0".to_owned());
    let scope = match (TaskScopeQuery {
        organisation_id: query.organisation_id,
        client_id: query.client_id,
    })
    .scope(engagement_id)
    {
        Ok(scope) => scope,
        Err(error) => return failure(error),
    };
    match state
        .repository
        .events(&current.identity.id, &scope, after)
        .await
    {
        Ok(events) => {
            let next_cursor = events
                .last()
                .map(|event| event.cursor.clone())
                .unwrap_or(empty_cursor);
            Json(TaskEventsResponse {
                events: events.into_iter().map(Into::into).collect(),
                next_cursor,
            })
            .into_response()
        }
        Err(error) => failure(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parsed_meaning_ignores_json_key_order_but_rejects_unknown_fields() {
        let first: TaskCommand = serde_json::from_str::<TaskCommandRequest>(
            r#"{"key":"one","kind":"create","content":"objective"}"#,
        )
        .unwrap()
        .into();
        let retry: TaskCommand = serde_json::from_str::<TaskCommandRequest>(
            r#"{"content":"objective","task_id":null,"cycle_id":null,"kind":"create","key":"one"}"#,
        )
        .unwrap()
        .into();
        assert_eq!(first, retry);
        assert!(
            serde_json::from_str::<TaskCommandRequest>(
                r#"{"key":"one","kind":"create","content":"objective","actor":"other"}"#
            )
            .is_err()
        );
        assert!(
            serde_json::from_str::<TaskCommandRequest>(
                r#"{"key":"one","kind":"create","key":"two","content":"objective"}"#
            )
            .is_err()
        );
    }

    #[test]
    fn cursor_refuses_overflow_signs_and_nondecimal_values() {
        assert_eq!(cursor(None), Ok(0));
        assert_eq!(cursor(Some("9223372036854775807")), Ok(i64::MAX as u64));
        for bad in [
            "",
            "-1",
            "+1",
            "1.0",
            "9223372036854775808",
            "18446744073709551615",
            "1e3",
        ] {
            assert_eq!(cursor(Some(bad)), Err(TaskError::Invalid));
        }
    }

    #[test]
    fn wire_receipt_never_claims_applied_or_exposes_execution_capabilities() {
        let receipt = CommandReceiptResponse::from(CommandReceipt {
            command_id: "command".into(),
            task_id: "task".into(),
            cycle_id: "cycle".into(),
            event_cursor: "9007199254740993".into(),
            status: zobba_domain::task::ReceiptStatus::Received,
        });
        let value = serde_json::to_value(receipt).unwrap();
        assert_eq!(value["status"], "received");
        assert_eq!(value["event_cursor"], "9007199254740993");
        assert_eq!(value.as_object().unwrap().len(), 5);
    }
}
