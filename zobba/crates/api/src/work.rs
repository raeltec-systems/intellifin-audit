//! Task work projection, untargeted direction and targeting questions.
//! Direction and answers use the reserved control lane: they produce Guides,
//! which never wait on a model. Work and question reads are ordinary traffic.
//! No model text is returned by these routes.
use axum::{
    Json,
    extract::{Path, Query, State, rejection::JsonRejection},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use zobba_application::task::TaskError;
use zobba_domain::{
    identity::valid_scope_id,
    work::{
        Attention, BriefRevision, Direction, NextAction, RoutedGuide, RoutingQuestion, StepKind,
        StepStatus, TaskStep, TaskWork,
    },
};

use crate::auth::ErrorResponse;
use crate::tasks::{CommandReceiptResponse, TaskHttpState, TaskScopeQuery, failure};

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum StepKindResponse {
    ModelTurn,
    ToolStep,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum StepStatusResponse {
    Proposed,
    Responded,
    Superseded,
    Failed,
    Completed,
    Refused,
    ReconciliationRequired,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AttentionResponse {
    AwaitingGuidance,
    ReconciliationRequired,
    StepFailed,
    CycleBounded,
}

/// One immutable recorded step. Labels are fixed platform text, never model output.
#[derive(Serialize, ToSchema)]
pub struct TaskStepResponse {
    pub ordinal: u32,
    pub kind: StepKindResponse,
    pub status: StepStatusResponse,
    #[schema(pattern = "^[0-9]+$")]
    pub intent_revision: String,
    #[schema(pattern = "^[0-9]+$")]
    pub execution_epoch: String,
    #[schema(required = true)]
    pub invocation_id: Option<String>,
    #[schema(required = true)]
    pub operation_id: Option<String>,
    /// `model_turn`, `await_guidance`, `reconcile` or `tool:<catalogue name>`.
    #[schema(required = true)]
    pub next_action: Option<String>,
    #[schema(max_length = 200)]
    pub current_work: String,
    /// Model turns: authorised knowledge records left out of the turn's context.
    pub knowledge_omitted: u32,
}

/// An accepted brief revision. Received and applied are separate facts.
#[derive(Serialize, ToSchema)]
pub struct BriefRevisionResponse {
    pub command_id: String,
    pub cycle_id: String,
    /// Retained plain text supplied by a person; no model understanding is asserted.
    pub content: String,
    #[schema(pattern = "^[0-9]+$")]
    pub received_cursor: String,
    /// Recorded step count of the cycle when applied; null until applied.
    #[schema(required = true)]
    pub applied_boundary: Option<u32>,
    #[schema(required = true, pattern = "^[0-9]+$")]
    pub applied_cursor: Option<String>,
    /// The later accepted revision that replaced this one.
    #[schema(required = true)]
    pub superseded_by: Option<String>,
}

#[derive(Serialize, ToSchema)]
pub struct TaskWorkResponse {
    pub task_id: String,
    pub cycle_id: String,
    /// False when no qualified profile and enabled catalogue are selectable here:
    /// the Task stays inert and no model is called.
    pub model_available: bool,
    #[schema(required = true)]
    pub methodology_binding_id: Option<String>,
    #[schema(required = true)]
    pub methodology_status: Option<String>,
    #[schema(required = true)]
    pub current_work: Option<String>,
    #[schema(required = true)]
    pub next_action: Option<String>,
    /// The invocation that proposed `next_action`.
    #[schema(required = true)]
    pub next_action_invocation_id: Option<String>,
    #[schema(required = true)]
    pub attention: Option<AttentionResponse>,
    /// The most recent recorded steps of the current cycle, in order.
    #[schema(max_items = 50)]
    pub steps: Vec<TaskStepResponse>,
    /// All steps recorded in the current cycle; earlier ones may be omitted above.
    pub total_steps: u32,
    #[schema(max_items = 50)]
    pub briefs: Vec<BriefRevisionResponse>,
}

fn step(step: TaskStep) -> TaskStepResponse {
    TaskStepResponse {
        ordinal: step.ordinal,
        kind: match step.kind {
            StepKind::ModelTurn => StepKindResponse::ModelTurn,
            StepKind::ToolStep => StepKindResponse::ToolStep,
        },
        status: match step.status {
            StepStatus::Proposed => StepStatusResponse::Proposed,
            StepStatus::Responded => StepStatusResponse::Responded,
            StepStatus::Superseded => StepStatusResponse::Superseded,
            StepStatus::Failed => StepStatusResponse::Failed,
            StepStatus::Completed => StepStatusResponse::Completed,
            StepStatus::Refused => StepStatusResponse::Refused,
            StepStatus::ReconciliationRequired => StepStatusResponse::ReconciliationRequired,
        },
        intent_revision: step.intent_revision.to_string(),
        execution_epoch: step.execution_epoch.to_string(),
        invocation_id: step.invocation_id,
        operation_id: step.operation_id,
        next_action: step.next_action.as_ref().map(NextAction::descriptor),
        current_work: step.current_work,
        knowledge_omitted: step.knowledge_omitted,
    }
}

fn brief(brief: BriefRevision) -> BriefRevisionResponse {
    BriefRevisionResponse {
        command_id: brief.command_id,
        cycle_id: brief.cycle_id,
        content: brief.content,
        received_cursor: brief.received_cursor.to_string(),
        applied_boundary: brief.applied_boundary,
        applied_cursor: brief.applied_cursor.map(|v| v.to_string()),
        superseded_by: brief.superseded_by,
    }
}

fn work_response(work: TaskWork, model_available: bool) -> TaskWorkResponse {
    TaskWorkResponse {
        task_id: work.task_id,
        cycle_id: work.cycle_id,
        model_available,
        methodology_binding_id: work.methodology_binding_id,
        methodology_status: work.methodology_status,
        current_work: work.current_work,
        next_action: work.next_action.as_ref().map(NextAction::descriptor),
        next_action_invocation_id: work.next_action_invocation_id,
        attention: work.attention.map(|attention| match attention {
            Attention::AwaitingGuidance => AttentionResponse::AwaitingGuidance,
            Attention::ReconciliationRequired => AttentionResponse::ReconciliationRequired,
            Attention::StepFailed => AttentionResponse::StepFailed,
            Attention::CycleBounded => AttentionResponse::CycleBounded,
        }),
        steps: work.steps.into_iter().map(step).collect(),
        total_steps: work.total_steps,
        briefs: work.briefs.into_iter().map(brief).collect(),
    }
}

#[utoipa::path(get,path="/engagements/{engagement_id}/tasks/{task_id}/work",operation_id="get_task_work",security(("server_session"=[])),
    params(("X-Expected-Session"=Option<String>,Header,description="Optional session-bound read precondition from the in-memory session CSRF token; mismatch refuses without changing the cookie",min_length=1,max_length=128),("engagement_id"=String,Path),("task_id"=String,Path),("organisation_id"=String,Query),("client_id"=String,Query)),
    responses((status=412,description="Session changed",body=ErrorResponse),(status=200,description="Recorded work facts for the Task card; a waiting Task is not a completed objective",body=TaskWorkResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn get_work(
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
    let work = match state
        .repository
        .work(&current.identity.id, &scope, &task_id)
        .await
    {
        Ok(work) => work,
        Err(error) => return failure(error),
    };
    let model_available = match &state.models {
        Some(models) => matches!(
            models.selection(&current.identity.id, &scope).await,
            Ok(Some(_))
        ),
        None => false,
    };
    Json(work_response(work, model_available)).into_response()
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct DirectionRequest {
    /// Author and scope bind this key. Identical retries return the original outcome.
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub key: String,
    /// Exact retained guidance text, at most 4000 UTF-8 bytes.
    #[schema(min_length = 1, max_length = 4000)]
    pub content: String,
}

#[derive(Serialize, ToSchema)]
pub struct RoutingCandidateResponse {
    pub task_id: String,
    pub cycle_id: String,
    pub objective: String,
}

#[derive(Serialize, ToSchema)]
pub struct RoutedGuideResponse {
    pub task_id: String,
    pub cycle_id: String,
    pub command_id: String,
    #[schema(pattern = "^[0-9]+$")]
    pub event_cursor: String,
}

/// A durable targeting question. Nothing is applied until it is answered.
#[derive(Serialize, ToSchema)]
pub struct RoutingQuestionResponse {
    pub id: String,
    pub key: String,
    pub content: String,
    #[schema(max_items = 100)]
    pub candidates: Vec<RoutingCandidateResponse>,
    /// One Guide receipt per selected target, once answered.
    #[schema(required = true)]
    pub answer: Option<Vec<RoutedGuideResponse>>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DirectionOutcome {
    Routed,
    Asked,
}

#[derive(Serialize, ToSchema)]
pub struct DirectionResponse {
    pub outcome: DirectionOutcome,
    /// Present when exactly one Task received the direction as Guidance.
    #[schema(required = true)]
    pub receipt: Option<CommandReceiptResponse>,
    /// Present when two or more Tasks could receive it.
    #[schema(required = true)]
    pub question: Option<RoutingQuestionResponse>,
}

#[derive(Serialize, ToSchema)]
pub struct RoutingQuestionsResponse {
    #[schema(max_items = 20)]
    pub questions: Vec<RoutingQuestionResponse>,
    /// More (older) questions exist beyond this page.
    pub has_more: bool,
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct AnswerRequest {
    /// Candidate Task IDs from the question; at least one.
    #[schema(min_items = 1, max_items = 100)]
    pub selected: Vec<String>,
}

fn guide(guide: RoutedGuide) -> RoutedGuideResponse {
    RoutedGuideResponse {
        task_id: guide.task_id,
        cycle_id: guide.cycle_id,
        command_id: guide.command_id,
        event_cursor: guide.event_cursor,
    }
}

fn question(question: RoutingQuestion) -> RoutingQuestionResponse {
    RoutingQuestionResponse {
        id: question.id,
        key: question.key,
        content: question.content,
        candidates: question
            .candidates
            .into_iter()
            .map(|c| RoutingCandidateResponse {
                task_id: c.task_id,
                cycle_id: c.cycle_id,
                objective: c.objective,
            })
            .collect(),
        answer: question
            .answer
            .map(|guides| guides.into_iter().map(guide).collect()),
    }
}

/// Session, actor fence, CSRF and scope for a control-lane mutation.
async fn mutation(
    state: &TaskHttpState,
    headers: &HeaderMap,
    engagement_id: String,
    query: Result<Query<TaskScopeQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<(String, zobba_domain::identity::Scope, String), Box<Response>> {
    let current = state
        .identity
        .current(headers)
        .await
        .map_err(|error| Box::new(crate::auth::failure(error)))?;
    let mut expected = headers.get_all("x-expected-actor").iter();
    if let Some(value) = expected.next()
        && (expected.next().is_some()
            || value
                .to_str()
                .ok()
                .is_none_or(|actor| !valid_scope_id(actor) || actor != current.identity.id))
    {
        return Err(Box::new(failure(TaskError::Denied)));
    }
    if !state
        .identity
        .permits_mutation(headers, &current.csrf_token)
    {
        return Err(Box::new(failure(TaskError::Denied)));
    }
    let scope = query
        .map_err(|_| TaskError::Denied)
        .and_then(|Query(query)| query.scope(engagement_id))
        .map_err(|error| Box::new(failure(error)))?;
    let token = crate::auth::cookie(headers, crate::auth::SESSION_COOKIE)
        .ok_or_else(|| Box::new(failure(TaskError::Denied)))?;
    Ok((
        current.identity.id,
        scope,
        zobba_infrastructure::identity::secret_hash(&token),
    ))
}

#[utoipa::path(post,path="/engagements/{engagement_id}/task-directions",operation_id="admit_task_direction",security(("server_session"=[])),
    params(
        ("engagement_id"=String,Path,min_length=1,max_length=128,pattern="^[A-Za-z0-9_-]+$"),
        ("organisation_id"=String,Query,min_length=1,max_length=128,pattern="^[A-Za-z0-9_-]+$"),
        ("client_id"=String,Query,min_length=1,max_length=128,pattern="^[A-Za-z0-9_-]+$"),
        ("Origin"=String,Header,description="Exact configured HTTPS application origin"),
        ("X-CSRF-Token"=String,Header,description="Current session-bound token")
        ,("X-Expected-Actor"=Option<String>,Header,description="Optional additional refusal fence",min_length=1,max_length=128,pattern="^[A-Za-z0-9_-]+$")
    ),request_body=DirectionRequest,
    responses((status=202,description="Reserved lane. Routed to the only open Task that accepts guidance, or a durable targeting question; never routed by a model",body=DirectionResponse),(status=400,body=ErrorResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=409,description="No Task can receive guidance, or the key was reused with different text",body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn direct(
    State(state): State<TaskHttpState>,
    headers: HeaderMap,
    Path(engagement_id): Path<String>,
    query: Result<Query<TaskScopeQuery>, axum::extract::rejection::QueryRejection>,
    body: Result<Json<DirectionRequest>, JsonRejection>,
) -> Response {
    let (actor, scope, session) = match mutation(&state, &headers, engagement_id, query).await {
        Ok(context) => context,
        Err(response) => return *response,
    };
    let Ok(Json(body)) = body else {
        return failure(TaskError::Invalid);
    };
    match state
        .repository
        .clone()
        .with_session_hash(session)
        .direct(&actor, &scope, &body.key, &body.content)
        .await
    {
        Ok(Direction::Routed(receipt)) => (
            StatusCode::ACCEPTED,
            Json(DirectionResponse {
                outcome: DirectionOutcome::Routed,
                receipt: Some(receipt.into()),
                question: None,
            }),
        )
            .into_response(),
        Ok(Direction::Asked(asked)) => (
            StatusCode::ACCEPTED,
            Json(DirectionResponse {
                outcome: DirectionOutcome::Asked,
                receipt: None,
                question: Some(question(asked)),
            }),
        )
            .into_response(),
        Err(error) => failure(error),
    }
}

#[utoipa::path(get,path="/engagements/{engagement_id}/task-questions",operation_id="list_task_questions",security(("server_session"=[])),
    params(("X-Expected-Session"=Option<String>,Header,description="Optional session-bound read precondition",min_length=1,max_length=128),("engagement_id"=String,Path),("organisation_id"=String,Query),("client_id"=String,Query)),
    responses((status=412,description="Session changed",body=ErrorResponse),(status=200,description="The caller's most recent targeting questions, newest first",body=RoutingQuestionsResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn questions(
    State(state): State<TaskHttpState>,
    headers: HeaderMap,
    Path(engagement_id): Path<String>,
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
    match state
        .repository
        .questions(&current.identity.id, &scope)
        .await
    {
        Ok((found, has_more)) => Json(RoutingQuestionsResponse {
            questions: found.into_iter().map(question).collect(),
            has_more,
        })
        .into_response(),
        Err(error) => failure(error),
    }
}

#[utoipa::path(post,path="/engagements/{engagement_id}/task-questions/{question_id}/answer",operation_id="answer_task_question",security(("server_session"=[])),
    params(
        ("engagement_id"=String,Path,min_length=1,max_length=128,pattern="^[A-Za-z0-9_-]+$"),
        ("question_id"=String,Path,min_length=1,max_length=128,pattern="^[A-Za-z0-9_-]+$"),
        ("organisation_id"=String,Query,min_length=1,max_length=128,pattern="^[A-Za-z0-9_-]+$"),
        ("client_id"=String,Query,min_length=1,max_length=128,pattern="^[A-Za-z0-9_-]+$"),
        ("Origin"=String,Header,description="Exact configured HTTPS application origin"),
        ("X-CSRF-Token"=String,Header,description="Current session-bound token")
        ,("X-Expected-Actor"=Option<String>,Header,description="Optional additional refusal fence",min_length=1,max_length=128,pattern="^[A-Za-z0-9_-]+$")
    ),request_body=AnswerRequest,
    responses((status=202,description="One Guide per selected target with a derived key; an identical retry returns the same receipts",body=RoutingQuestionResponse),(status=400,body=ErrorResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=409,description="A selected Task is stale, foreign, or the question was answered differently",body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn answer(
    State(state): State<TaskHttpState>,
    headers: HeaderMap,
    Path((engagement_id, question_id)): Path<(String, String)>,
    query: Result<Query<TaskScopeQuery>, axum::extract::rejection::QueryRejection>,
    body: Result<Json<AnswerRequest>, JsonRejection>,
) -> Response {
    let (actor, scope, session) = match mutation(&state, &headers, engagement_id, query).await {
        Ok(context) => context,
        Err(response) => return *response,
    };
    let Ok(Json(body)) = body else {
        return failure(TaskError::Invalid);
    };
    if body.selected.is_empty() || body.selected.len() > zobba_domain::work::MAX_ROUTING_CANDIDATES
    {
        return failure(TaskError::Invalid);
    }
    match state
        .repository
        .clone()
        .with_session_hash(session)
        .answer(&actor, &scope, &question_id, &body.selected)
        .await
    {
        Ok(answered) => (StatusCode::ACCEPTED, Json(question(answered))).into_response(),
        Err(error) => failure(error),
    }
}
