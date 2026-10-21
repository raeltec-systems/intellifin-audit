//! Ordinary Admin Save and scoped, inspectable Task methodology bindings.
use crate::auth::{self, AuthState, ErrorResponse};
use axum::{
    Json, Router,
    extract::{
        DefaultBodyLimit, Path, Query, State,
        rejection::{JsonRejection, QueryRejection},
    },
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use std::{sync::Arc, time::Duration};
use tokio::sync::Semaphore;
use utoipa::ToSchema;
use zobba_application::{
    identity::CurrentSession,
    methodology::{self as application, MethodologyError, MethodologyStore},
};
use zobba_domain::{
    identity::{Scope, valid_scope_id},
    methodology as domain,
};
use zobba_infrastructure::{identity::secret_hash, methodology::MethodologyRepository};

#[derive(Clone)]
pub(crate) struct MethodologyState {
    identity: AuthState,
    repository: MethodologyRepository,
}

pub(crate) fn router(pool: sqlx::PgPool, identity: AuthState) -> Router {
    let capacity = Arc::new(Semaphore::new(4));
    Router::new()
        .route(
            "/methodology/organisations/{organisation_id}",
            get(snapshot),
        )
        .route(
            "/methodology/organisations/{organisation_id}/save",
            post(save),
        )
        .route(
            "/methodology/organisations/{organisation_id}/recall",
            post(recall),
        )
        .route(
            "/engagements/{engagement_id}/tasks/{task_id}/methodology",
            get(task_basis),
        )
        .with_state(MethodologyState {
            identity,
            repository: MethodologyRepository::new(pool),
        })
        // A bounded 200,000-byte definition can expand when JSON escapes text.
        .layer(DefaultBodyLimit::max(1024 * 1024))
        .layer(axum::middleware::from_fn(
            move |request: axum::extract::Request, next: axum::middleware::Next| {
                let capacity = capacity.clone();
                async move {
                    let Ok(_permit) = capacity.try_acquire_owned() else {
                        return failure(MethodologyError::Capacity);
                    };
                    match tokio::time::timeout(Duration::from_secs(6), next.run(request)).await {
                        Ok(response) => response,
                        Err(_) => failure(MethodologyError::Unavailable),
                    }
                }
            },
        ))
}

fn failure(error: MethodologyError) -> Response {
    let status = match error {
        MethodologyError::Invalid => StatusCode::BAD_REQUEST,
        MethodologyError::Denied => StatusCode::FORBIDDEN,
        MethodologyError::Conflict | MethodologyError::Recalled => StatusCode::CONFLICT,
        MethodologyError::Capacity => StatusCode::TOO_MANY_REQUESTS,
        MethodologyError::Unavailable => StatusCode::SERVICE_UNAVAILABLE,
    };
    (
        status,
        Json(ErrorResponse {
            error: error.code(),
        }),
    )
        .into_response()
}

enum AuthenticationFailure {
    Identity(zobba_application::identity::IdentityError),
    Methodology(MethodologyError),
}

impl IntoResponse for AuthenticationFailure {
    fn into_response(self) -> Response {
        match self {
            Self::Identity(error) => auth::failure(error),
            Self::Methodology(error) => failure(error),
        }
    }
}

async fn current(
    state: &MethodologyState,
    headers: &HeaderMap,
    mutation: bool,
) -> Result<(CurrentSession, MethodologyRepository), AuthenticationFailure> {
    let current = state
        .identity
        .current_read(headers)
        .await
        .map_err(AuthenticationFailure::Identity)?;
    if mutation {
        let mut values = headers.get_all("x-expected-actor").iter();
        let expected = values.next().and_then(|value| value.to_str().ok());
        if expected != Some(current.identity.id.as_str())
            || values.next().is_some()
            || !state
                .identity
                .permits_mutation(headers, &current.csrf_token)
        {
            return Err(AuthenticationFailure::Methodology(MethodologyError::Denied));
        }
    }
    let token = auth::cookie(headers, auth::SESSION_COOKIE)
        .ok_or(AuthenticationFailure::Methodology(MethodologyError::Denied))?;
    Ok((
        current,
        state
            .repository
            .clone()
            .with_session_hash(secret_hash(&token)),
    ))
}

#[derive(Clone, Default, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct MethodologyTaskContext {
    #[schema(min_length = 1, max_length = 200)]
    pub audit_area: Option<String>,
    /// Inclusive business date, YYYY-MM-DD. Both period dates are required together.
    #[schema(pattern = "^[0-9]{4}-[0-9]{2}-[0-9]{2}$")]
    pub period_start: Option<String>,
    #[schema(pattern = "^[0-9]{4}-[0-9]{2}-[0-9]{2}$")]
    pub period_end: Option<String>,
}

impl From<MethodologyTaskContext> for domain::TaskContext {
    fn from(value: MethodologyTaskContext) -> Self {
        Self {
            audit_area: value.audit_area,
            period_start: value.period_start,
            period_end: value.period_end,
        }
    }
}

impl From<domain::TaskContext> for MethodologyTaskContext {
    fn from(value: domain::TaskContext) -> Self {
        Self {
            audit_area: value.audit_area,
            period_start: value.period_start,
            period_end: value.period_end,
        }
    }
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum MethodologyAssignmentKind {
    Firm,
    Client,
    Engagement,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct MethodologyAssignmentScope {
    pub kind: MethodologyAssignmentKind,
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub client_id: Option<String>,
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub engagement_id: Option<String>,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct MethodologyApplicability {
    #[schema(min_length = 1, max_length = 200)]
    pub audit_area: Option<String>,
    #[schema(pattern = "^[0-9]{4}-[0-9]{2}-[0-9]{2}$")]
    pub period_start: Option<String>,
    #[schema(pattern = "^[0-9]{4}-[0-9]{2}-[0-9]{2}$")]
    pub period_end: Option<String>,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum MethodologyActivationMode {
    NewTasks,
    ActiveTasks,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct MethodologyActivation {
    pub mode: MethodologyActivationMode,
    /// Availability in Unix seconds, independent of business applicability dates.
    #[schema(minimum = 0, maximum = 253402300799i64)]
    pub available_at: i64,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct MethodologyVersionReference {
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub id: String,
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub version: String,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct MethodologyRequirement {
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub id: String,
    #[schema(min_length = 1, max_length = 200)]
    pub label: Option<String>,
    pub mandatory: bool,
    /// Absent fields inherit. Empty arrays cannot erase inherited mandatory controls.
    #[schema(value_type = Option<Vec<MethodologyText>>, max_items = 32)]
    pub criteria: Option<Vec<String>>,
    #[schema(value_type = Option<Vec<MethodologyText>>, max_items = 32)]
    pub populations: Option<Vec<String>>,
    #[schema(value_type = Option<Vec<MethodologyText>>, max_items = 32)]
    pub evidence_checks: Option<Vec<String>>,
    #[schema(value_type = Option<Vec<MethodologyText>>, max_items = 32)]
    pub ratings: Option<Vec<String>>,
    #[schema(value_type = Option<Vec<MethodologyText>>, max_items = 32)]
    pub review_rules: Option<Vec<String>>,
    #[schema(max_items = 32)]
    pub templates: Option<Vec<MethodologyVersionReference>>,
    #[schema(max_items = 32)]
    pub suitable_skills: Option<Vec<MethodologyVersionReference>>,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct MethodologyDefinition {
    #[schema(min_length = 1, max_length = 200)]
    pub name: String,
    pub neutral_starter: bool,
    #[serde(default)]
    pub default_context: MethodologyTaskContext,
    #[schema(max_items = 100)]
    pub requirements: Vec<MethodologyRequirement>,
    #[serde(default)]
    #[schema(max_items = 32)]
    pub templates: Vec<MethodologyTemplateDefinition>,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct MethodologyTemplateDefinition {
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub id: String,
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub version: String,
    #[schema(min_length = 1, max_length = 200)]
    pub name: String,
    #[schema(min_items = 1, max_items = 32)]
    pub sections: Vec<MethodologyTemplateSection>,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct MethodologyTemplateSection {
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub id: String,
    #[schema(min_length = 1, max_length = 200)]
    pub title: String,
    #[schema(value_type = MethodologyTemplateProse)]
    pub content: String,
    pub required: bool,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum MethodologySourceKind {
    Authored,
    ImportedProposal,
    NeutralStarter,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct MethodologySource {
    #[serde(deserialize_with = "source_kind")]
    #[schema(value_type = MethodologySourceKind)]
    pub kind: String,
    #[schema(value_type = Option<MethodologyText>)]
    pub reference: Option<String>,
    #[schema(value_type = Option<MethodologyText>)]
    pub note: Option<String>,
}

/// Nonempty, already-trimmed Unicode text, at most 2,000 characters; controls
/// are refused. Definitions additionally have a 200,000-byte aggregate bound.
pub struct MethodologyText;
impl utoipa::PartialSchema for MethodologyText {
    fn schema() -> utoipa::openapi::RefOr<utoipa::openapi::schema::Schema> {
        utoipa::openapi::schema::ObjectBuilder::new()
            .schema_type(utoipa::openapi::schema::Type::String)
            .min_length(Some(1))
            .max_length(Some(2000))
            .description(Some("Nonempty, already-trimmed Unicode text without control characters; at most 2000 Unicode characters."))
            .into()
    }
}
impl ToSchema for MethodologyText {}

/// Template prose preserves exact Unicode text and layout within the definition's
/// 200,000-byte aggregate bound. Its whitespace rules differ from policy text.
pub struct MethodologyTemplateProse;
impl utoipa::PartialSchema for MethodologyTemplateProse {
    fn schema() -> utoipa::openapi::RefOr<utoipa::openapi::schema::Schema> {
        utoipa::openapi::schema::ObjectBuilder::new()
            .schema_type(utoipa::openapi::schema::Type::String)
            .min_length(Some(1))
            .max_length(Some(2000))
            .description(Some("Preserved Unicode prose containing at least one character outside Unicode White_Space; at most 2000 Unicode characters. LF, CR and tab are allowed; all other control characters are refused. Indentation, line endings, trailing whitespace and U+FEFF are preserved exactly."))
            .into()
    }
}
impl ToSchema for MethodologyTemplateProse {}

fn source_kind<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<String, D::Error> {
    Ok(match MethodologySourceKind::deserialize(deserializer)? {
        MethodologySourceKind::Authored => "authored",
        MethodologySourceKind::ImportedProposal => "imported_proposal",
        MethodologySourceKind::NeutralStarter => "neutral_starter",
    }
    .to_owned())
}

#[derive(Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct SaveMethodologyRequest {
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub key: String,
    /// Canonical decimal revision, bounded by 9223372036854775806 so a successor fits.
    #[schema(min_length = 1, max_length = 19, pattern = "^(0|[1-9][0-9]*)$")]
    pub expected_revision: String,
    pub supersedes: Option<String>,
    pub undo_of: Option<String>,
    pub assignment: MethodologyAssignmentScope,
    pub applicability: MethodologyApplicability,
    pub activation: MethodologyActivation,
    pub definition: MethodologyDefinition,
    pub source: MethodologySource,
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct RecallMethodologyRequest {
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub key: String,
    #[schema(min_length = 1, max_length = 19, pattern = "^(0|[1-9][0-9]*)$")]
    pub expected_revision: String,
    pub version_id: String,
    #[schema(value_type = MethodologyText)]
    pub reason: String,
}

fn revision(value: &str) -> Result<u64, MethodologyError> {
    if value.is_empty()
        || value.len() > 19
        || !value.bytes().all(|byte| byte.is_ascii_digit())
        || (value.len() > 1 && value.starts_with('0'))
    {
        return Err(MethodologyError::Invalid);
    }
    value
        .parse::<u64>()
        .ok()
        .filter(|value| *value <= i64::MAX as u64)
        .ok_or(MethodologyError::Invalid)
}

#[derive(Serialize, ToSchema)]
pub struct MethodologyVersionRecord {
    pub id: String,
    pub actor_id: String,
    pub saved_at: i64,
    #[schema(pattern = "^(0|[1-9][0-9]*)$")]
    pub revision: String,
    pub command: SaveMethodologyRequest,
    pub recalled: bool,
}

#[derive(Serialize, ToSchema)]
pub struct MethodologyImpact {
    pub id: String,
    pub version_id: String,
    pub activation_mode: MethodologyActivationMode,
    #[schema(pattern = "^(0|[1-9][0-9]*)$")]
    pub affected_tasks: String,
    #[schema(pattern = "^(0|[1-9][0-9]*)$")]
    pub pending_tasks: String,
    #[schema(pattern = "^(0|[1-9][0-9]*)$")]
    pub retained_tasks: String,
    /// Unknown or changed semantics are potentially material.
    pub potentially_material: bool,
    pub diff: Vec<String>,
}

#[derive(Serialize, ToSchema)]
pub struct MethodologySnapshot {
    pub organisation_id: String,
    #[schema(pattern = "^(0|[1-9][0-9]*)$")]
    pub revision: String,
    pub versions: Vec<MethodologyVersionRecord>,
    #[schema(max_items = 256)]
    pub impacts: Vec<MethodologyImpact>,
    /// Assignment metadata for current Admins; grants no access to audit work.
    #[schema(max_items = 512)]
    pub engagements: Vec<crate::membership::MembershipAssignmentOption>,
}

#[derive(Serialize, ToSchema)]
pub struct MethodologyReceipt {
    pub event_id: String,
    pub organisation_id: String,
    pub actor_id: String,
    pub version_id: String,
    #[schema(pattern = "^(0|[1-9][0-9]*)$")]
    pub revision: String,
    pub kind: String,
    pub impact: MethodologyImpact,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum MethodologyResolutionStatus {
    Resolved,
    Neutral,
    Incomplete,
    Ambiguous,
    Recalled,
}

#[derive(Serialize, ToSchema)]
pub struct MethodologyResolvedRequirementFields {
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub id: String,
    #[schema(min_length = 1, max_length = 200)]
    pub label: Option<String>,
    pub mandatory: bool,
    /// Resolved inherited values can combine up to 128 saved versions.
    #[schema(value_type = Option<Vec<MethodologyText>>, max_items = 4096)]
    pub criteria: Option<Vec<String>>,
    #[schema(value_type = Option<Vec<MethodologyText>>, max_items = 4096)]
    pub populations: Option<Vec<String>>,
    #[schema(value_type = Option<Vec<MethodologyText>>, max_items = 4096)]
    pub evidence_checks: Option<Vec<String>>,
    #[schema(value_type = Option<Vec<MethodologyText>>, max_items = 4096)]
    pub ratings: Option<Vec<String>>,
    #[schema(value_type = Option<Vec<MethodologyText>>, max_items = 4096)]
    pub review_rules: Option<Vec<String>>,
    #[schema(max_items = 4096)]
    pub templates: Option<Vec<MethodologyVersionReference>>,
    #[schema(max_items = 4096)]
    pub suitable_skills: Option<Vec<MethodologyVersionReference>>,
}

#[derive(Serialize, ToSchema)]
pub struct MethodologyResolvedRequirement {
    pub requirement: MethodologyResolvedRequirementFields,
    #[schema(max_items = 128)]
    pub source_version_ids: Vec<String>,
    pub field_sources: Vec<MethodologyFieldSource>,
}

#[derive(Serialize, ToSchema)]
pub struct MethodologyFieldSource {
    pub field: String,
    #[schema(max_items = 128)]
    pub version_ids: Vec<String>,
}

#[derive(Serialize, ToSchema)]
pub struct MethodologyResolvedTemplate {
    pub template: MethodologyTemplateDefinition,
    pub source_version_id: String,
}

#[derive(Serialize, ToSchema)]
pub struct MethodologyResolution {
    pub status: MethodologyResolutionStatus,
    pub context: MethodologyTaskContext,
    #[schema(max_items = 128)]
    pub version_ids: Vec<String>,
    #[schema(max_items = 12800)]
    pub requirements: Vec<MethodologyResolvedRequirement>,
    #[schema(max_items = 4096)]
    pub templates: Vec<MethodologyResolvedTemplate>,
    /// Up to 128 saved neutral contributors plus the built-in fallback, joined to
    /// requirement field and template source IDs.
    #[schema(max_items = 129)]
    pub neutral_source_version_ids: Vec<String>,
    #[schema(max_items = 32768)]
    pub issues: Vec<String>,
    pub reason: String,
}

#[derive(Serialize, ToSchema)]
pub struct MethodologyBinding {
    pub id: String,
    /// Exact Guide command supplying this context, retained through later bindings.
    #[schema(required = true)]
    pub context_command_id: Option<String>,
    /// Exact version candidates retained for subsequent Task context discovery.
    pub candidate_version_ids: Vec<String>,
    pub bound_at: i64,
    pub actor_id: String,
    /// Task execution epoch from which this exact binding applies.
    #[schema(pattern = "^(0|[1-9][0-9]*)$")]
    pub execution_epoch: String,
    pub resolution: MethodologyResolution,
}

#[derive(Serialize, ToSchema)]
pub struct MethodologyBindingChange {
    pub id: String,
    pub actor_id: String,
    pub requested_at: i64,
    pub resolution: MethodologyResolution,
    pub reason: String,
}

#[derive(Serialize, ToSchema)]
pub struct MethodologyBindingNotice {
    pub id: String,
    pub version_id: String,
    pub actor_id: String,
    pub requested_at: i64,
    pub impact: MethodologyImpact,
}

#[derive(Serialize, ToSchema)]
pub struct TaskMethodologyResponse {
    pub task_id: String,
    pub current: MethodologyBinding,
    pub pending: Option<MethodologyBindingChange>,
    #[schema(max_items = 4096)]
    pub history: Vec<MethodologyBinding>,
    pub recalled: bool,
    #[schema(max_items = 256)]
    pub notices: Vec<MethodologyBindingNotice>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct TaskBasisQuery {
    organisation_id: String,
    client_id: String,
}

#[utoipa::path(get, path="/methodology/organisations/{organisation_id}", operation_id="methodology_snapshot", security(("server_session"=[])),
    params(("organisation_id"=String,Path),("X-Expected-Session"=Option<String>,Header,description="Additional current session refusal fence")),
    responses((status=200,body=MethodologySnapshot),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=412,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn snapshot(
    State(state): State<MethodologyState>,
    headers: HeaderMap,
    Path(organisation): Path<String>,
) -> Response {
    let (current, repository) = match current(&state, &headers, false).await {
        Ok(value) => value,
        Err(error) => return error.into_response(),
    };
    if !valid_scope_id(&organisation) {
        return failure(MethodologyError::Denied);
    }
    match repository
        .snapshot(&current.identity.id, &organisation)
        .await
    {
        Ok(value) => Json(MethodologySnapshot::from(value)).into_response(),
        Err(error) => failure(error),
    }
}

#[utoipa::path(post, path="/methodology/organisations/{organisation_id}/save", operation_id="save_methodology", security(("server_session"=[])),
    params(("organisation_id"=String,Path),("X-Expected-Session"=Option<String>,Header),("Origin"=String,Header),("X-CSRF-Token"=String,Header),("X-Expected-Actor"=String,Header,description="Required exact current actor refusal fence")), request_body=SaveMethodologyRequest,
    responses((status=200,body=MethodologyReceipt),(status=400,body=ErrorResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=409,body=ErrorResponse),(status=412,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn save(
    State(state): State<MethodologyState>,
    headers: HeaderMap,
    Path(organisation): Path<String>,
    body: Result<Json<SaveMethodologyRequest>, JsonRejection>,
) -> Response {
    let (current, repository) = match current(&state, &headers, true).await {
        Ok(value) => value,
        Err(error) => return error.into_response(),
    };
    if !valid_scope_id(&organisation) {
        return failure(MethodologyError::Denied);
    }
    let command = match body {
        Ok(Json(body)) => match application::SaveMethodology::try_from(body) {
            Ok(command) if command.is_valid() => command,
            _ => return failure(MethodologyError::Invalid),
        },
        Err(_) => return failure(MethodologyError::Invalid),
    };
    match repository
        .save(&current.identity.id, &organisation, &command)
        .await
    {
        Ok(value) => Json(MethodologyReceipt::from(value)).into_response(),
        Err(error) => failure(error),
    }
}

#[utoipa::path(post, path="/methodology/organisations/{organisation_id}/recall", operation_id="recall_methodology", security(("server_session"=[])),
    params(("organisation_id"=String,Path),("X-Expected-Session"=Option<String>,Header),("Origin"=String,Header),("X-CSRF-Token"=String,Header),("X-Expected-Actor"=String,Header,description="Required exact current actor refusal fence")), request_body=RecallMethodologyRequest,
    responses((status=200,body=MethodologyReceipt),(status=400,body=ErrorResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=409,body=ErrorResponse),(status=412,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn recall(
    State(state): State<MethodologyState>,
    headers: HeaderMap,
    Path(organisation): Path<String>,
    body: Result<Json<RecallMethodologyRequest>, JsonRejection>,
) -> Response {
    let (current, repository) = match current(&state, &headers, true).await {
        Ok(value) => value,
        Err(error) => return error.into_response(),
    };
    if !valid_scope_id(&organisation) {
        return failure(MethodologyError::Denied);
    }
    let command = match body {
        Ok(Json(body)) => match application::RecallMethodology::try_from(body) {
            Ok(command) if command.is_valid() => command,
            _ => return failure(MethodologyError::Invalid),
        },
        Err(_) => return failure(MethodologyError::Invalid),
    };
    match repository
        .recall(&current.identity.id, &organisation, &command)
        .await
    {
        Ok(value) => Json(MethodologyReceipt::from(value)).into_response(),
        Err(error) => failure(error),
    }
}

#[utoipa::path(get, path="/engagements/{engagement_id}/tasks/{task_id}/methodology", operation_id="task_methodology", security(("server_session"=[])),
    params(("engagement_id"=String,Path),("task_id"=String,Path),("organisation_id"=String,Query),("client_id"=String,Query),("X-Expected-Session"=Option<String>,Header)),
    responses((status=200,body=TaskMethodologyResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=412,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn task_basis(
    State(state): State<MethodologyState>,
    headers: HeaderMap,
    Path((engagement_id, task_id)): Path<(String, String)>,
    query: Result<Query<TaskBasisQuery>, QueryRejection>,
) -> Response {
    let (current, repository) = match current(&state, &headers, false).await {
        Ok(value) => value,
        Err(error) => return error.into_response(),
    };
    let Ok(Query(query)) = query else {
        return failure(MethodologyError::Denied);
    };
    let scope = Scope {
        organisation_id: query.organisation_id,
        client_id: query.client_id,
        engagement_id,
    };
    if !scope.is_valid() || !valid_scope_id(&task_id) {
        return failure(MethodologyError::Denied);
    }
    match repository
        .task_basis(&current.identity.id, &scope, &task_id)
        .await
    {
        Ok(value) => Json(TaskMethodologyResponse::from(value)).into_response(),
        Err(error) => failure(error),
    }
}

// Explicit adapters keep HTTP schemas owned here and preserve every persisted field.
impl From<MethodologyTaskContext> for application::TaskContext {
    fn from(value: MethodologyTaskContext) -> Self {
        Self {
            audit_area: value.audit_area,
            period_start: value.period_start,
            period_end: value.period_end,
        }
    }
}

impl From<application::TaskContext> for MethodologyTaskContext {
    fn from(value: application::TaskContext) -> Self {
        Self {
            audit_area: value.audit_area,
            period_start: value.period_start,
            period_end: value.period_end,
        }
    }
}

impl From<MethodologyAssignmentScope> for application::AssignmentScope {
    fn from(value: MethodologyAssignmentScope) -> Self {
        Self {
            kind: value.kind.into(),
            client_id: value.client_id,
            engagement_id: value.engagement_id,
        }
    }
}

impl From<application::AssignmentScope> for MethodologyAssignmentScope {
    fn from(value: application::AssignmentScope) -> Self {
        Self {
            kind: value.kind.into(),
            client_id: value.client_id,
            engagement_id: value.engagement_id,
        }
    }
}

impl From<MethodologyApplicability> for application::Applicability {
    fn from(value: MethodologyApplicability) -> Self {
        Self {
            audit_area: value.audit_area,
            period_start: value.period_start,
            period_end: value.period_end,
        }
    }
}

impl From<application::Applicability> for MethodologyApplicability {
    fn from(value: application::Applicability) -> Self {
        Self {
            audit_area: value.audit_area,
            period_start: value.period_start,
            period_end: value.period_end,
        }
    }
}

impl From<MethodologyActivation> for application::Activation {
    fn from(value: MethodologyActivation) -> Self {
        Self {
            mode: value.mode.into(),
            available_at: value.available_at,
        }
    }
}

impl From<application::Activation> for MethodologyActivation {
    fn from(value: application::Activation) -> Self {
        Self {
            mode: value.mode.into(),
            available_at: value.available_at,
        }
    }
}

impl From<MethodologyVersionReference> for application::VersionReference {
    fn from(value: MethodologyVersionReference) -> Self {
        Self {
            id: value.id,
            version: value.version,
        }
    }
}

impl From<application::VersionReference> for MethodologyVersionReference {
    fn from(value: application::VersionReference) -> Self {
        Self {
            id: value.id,
            version: value.version,
        }
    }
}

impl From<MethodologyRequirement> for application::Requirement {
    fn from(value: MethodologyRequirement) -> Self {
        Self {
            id: value.id,
            label: value.label,
            mandatory: value.mandatory,
            criteria: value.criteria,
            populations: value.populations,
            evidence_checks: value.evidence_checks,
            ratings: value.ratings,
            review_rules: value.review_rules,
            templates: value
                .templates
                .map(|values| values.into_iter().map(Into::into).collect()),
            suitable_skills: value
                .suitable_skills
                .map(|values| values.into_iter().map(Into::into).collect()),
        }
    }
}

impl From<application::Requirement> for MethodologyRequirement {
    fn from(value: application::Requirement) -> Self {
        Self {
            id: value.id,
            label: value.label,
            mandatory: value.mandatory,
            criteria: value.criteria,
            populations: value.populations,
            evidence_checks: value.evidence_checks,
            ratings: value.ratings,
            review_rules: value.review_rules,
            templates: value
                .templates
                .map(|values| values.into_iter().map(Into::into).collect()),
            suitable_skills: value
                .suitable_skills
                .map(|values| values.into_iter().map(Into::into).collect()),
        }
    }
}

impl From<MethodologyDefinition> for application::Definition {
    fn from(value: MethodologyDefinition) -> Self {
        Self {
            name: value.name,
            neutral_starter: value.neutral_starter,
            default_context: value.default_context.into(),
            requirements: value.requirements.into_iter().map(Into::into).collect(),
            templates: value.templates.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<application::Definition> for MethodologyDefinition {
    fn from(value: application::Definition) -> Self {
        Self {
            name: value.name,
            neutral_starter: value.neutral_starter,
            default_context: value.default_context.into(),
            requirements: value.requirements.into_iter().map(Into::into).collect(),
            templates: value.templates.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<MethodologyTemplateDefinition> for application::TemplateDefinition {
    fn from(value: MethodologyTemplateDefinition) -> Self {
        Self {
            id: value.id,
            version: value.version,
            name: value.name,
            sections: value.sections.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<application::TemplateDefinition> for MethodologyTemplateDefinition {
    fn from(value: application::TemplateDefinition) -> Self {
        Self {
            id: value.id,
            version: value.version,
            name: value.name,
            sections: value.sections.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<MethodologyTemplateSection> for application::TemplateSection {
    fn from(value: MethodologyTemplateSection) -> Self {
        Self {
            id: value.id,
            title: value.title,
            content: value.content,
            required: value.required,
        }
    }
}

impl From<application::TemplateSection> for MethodologyTemplateSection {
    fn from(value: application::TemplateSection) -> Self {
        Self {
            id: value.id,
            title: value.title,
            content: value.content,
            required: value.required,
        }
    }
}

impl From<MethodologySource> for application::SourceAttribution {
    fn from(value: MethodologySource) -> Self {
        Self {
            kind: value.kind,
            reference: value.reference,
            note: value.note,
        }
    }
}

impl From<application::SourceAttribution> for MethodologySource {
    fn from(value: application::SourceAttribution) -> Self {
        Self {
            kind: value.kind,
            reference: value.reference,
            note: value.note,
        }
    }
}

impl From<MethodologyAssignmentKind> for application::AssignmentKind {
    fn from(value: MethodologyAssignmentKind) -> Self {
        match value {
            MethodologyAssignmentKind::Firm => Self::Firm,
            MethodologyAssignmentKind::Client => Self::Client,
            MethodologyAssignmentKind::Engagement => Self::Engagement,
        }
    }
}

impl From<application::AssignmentKind> for MethodologyAssignmentKind {
    fn from(value: application::AssignmentKind) -> Self {
        match value {
            application::AssignmentKind::Firm => Self::Firm,
            application::AssignmentKind::Client => Self::Client,
            application::AssignmentKind::Engagement => Self::Engagement,
        }
    }
}

impl From<MethodologyActivationMode> for application::ActivationMode {
    fn from(value: MethodologyActivationMode) -> Self {
        match value {
            MethodologyActivationMode::NewTasks => Self::NewTasks,
            MethodologyActivationMode::ActiveTasks => Self::ActiveTasks,
        }
    }
}

impl From<application::ActivationMode> for MethodologyActivationMode {
    fn from(value: application::ActivationMode) -> Self {
        match value {
            application::ActivationMode::NewTasks => Self::NewTasks,
            application::ActivationMode::ActiveTasks => Self::ActiveTasks,
        }
    }
}

impl From<application::ResolutionStatus> for MethodologyResolutionStatus {
    fn from(value: application::ResolutionStatus) -> Self {
        match value {
            application::ResolutionStatus::Resolved => Self::Resolved,
            application::ResolutionStatus::Neutral => Self::Neutral,
            application::ResolutionStatus::Incomplete => Self::Incomplete,
            application::ResolutionStatus::Ambiguous => Self::Ambiguous,
            application::ResolutionStatus::Recalled => Self::Recalled,
        }
    }
}

impl TryFrom<SaveMethodologyRequest> for application::SaveMethodology {
    type Error = MethodologyError;
    fn try_from(value: SaveMethodologyRequest) -> Result<Self, Self::Error> {
        Ok(Self {
            key: value.key,
            expected_revision: revision(&value.expected_revision)?,
            supersedes: value.supersedes,
            undo_of: value.undo_of,
            assignment: value.assignment.into(),
            applicability: value.applicability.into(),
            activation: value.activation.into(),
            definition: value.definition.into(),
            source: value.source.into(),
        })
    }
}

impl From<application::SaveMethodology> for SaveMethodologyRequest {
    fn from(value: application::SaveMethodology) -> Self {
        Self {
            key: value.key,
            expected_revision: value.expected_revision.to_string(),
            supersedes: value.supersedes,
            undo_of: value.undo_of,
            assignment: value.assignment.into(),
            applicability: value.applicability.into(),
            activation: value.activation.into(),
            definition: value.definition.into(),
            source: value.source.into(),
        }
    }
}

impl TryFrom<RecallMethodologyRequest> for application::RecallMethodology {
    type Error = MethodologyError;
    fn try_from(value: RecallMethodologyRequest) -> Result<Self, Self::Error> {
        Ok(Self {
            key: value.key,
            expected_revision: revision(&value.expected_revision)?,
            version_id: value.version_id,
            reason: value.reason,
        })
    }
}

impl From<application::VersionRecord> for MethodologyVersionRecord {
    fn from(value: application::VersionRecord) -> Self {
        Self {
            id: value.id,
            actor_id: value.actor_id,
            saved_at: value.saved_at,
            revision: value.revision.to_string(),
            command: value.command.into(),
            recalled: value.recalled,
        }
    }
}

impl From<application::Impact> for MethodologyImpact {
    fn from(value: application::Impact) -> Self {
        Self {
            id: value.id,
            version_id: value.version_id,
            activation_mode: value.activation_mode.into(),
            affected_tasks: value.affected_tasks.to_string(),
            pending_tasks: value.pending_tasks.to_string(),
            retained_tasks: value.retained_tasks.to_string(),
            potentially_material: value.potentially_material,
            diff: value.diff,
        }
    }
}

impl From<application::Snapshot> for MethodologySnapshot {
    fn from(value: application::Snapshot) -> Self {
        Self {
            organisation_id: value.organisation_id,
            revision: value.revision.to_string(),
            versions: value.versions.into_iter().map(Into::into).collect(),
            impacts: value.impacts.into_iter().map(Into::into).collect(),
            engagements: value
                .engagements
                .into_iter()
                .map(|value| crate::membership::MembershipAssignmentOption {
                    client_id: value.client_id,
                    client_name: value.client_name,
                    engagement_id: value.engagement_id,
                    engagement_name: value.engagement_name,
                })
                .collect(),
        }
    }
}

impl From<application::Receipt> for MethodologyReceipt {
    fn from(value: application::Receipt) -> Self {
        Self {
            event_id: value.event_id,
            organisation_id: value.organisation_id,
            actor_id: value.actor_id,
            version_id: value.version_id,
            revision: value.revision.to_string(),
            kind: value.kind,
            impact: value.impact.into(),
        }
    }
}

impl From<application::Requirement> for MethodologyResolvedRequirementFields {
    fn from(value: application::Requirement) -> Self {
        Self {
            id: value.id,
            label: value.label,
            mandatory: value.mandatory,
            criteria: value.criteria,
            populations: value.populations,
            evidence_checks: value.evidence_checks,
            ratings: value.ratings,
            review_rules: value.review_rules,
            templates: value
                .templates
                .map(|values| values.into_iter().map(Into::into).collect()),
            suitable_skills: value
                .suitable_skills
                .map(|values| values.into_iter().map(Into::into).collect()),
        }
    }
}

impl From<application::ResolvedRequirement> for MethodologyResolvedRequirement {
    fn from(value: application::ResolvedRequirement) -> Self {
        Self {
            requirement: value.requirement.into(),
            source_version_ids: value.source_version_ids,
            field_sources: value.field_sources.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<application::FieldSource> for MethodologyFieldSource {
    fn from(value: application::FieldSource) -> Self {
        Self {
            field: value.field,
            version_ids: value.version_ids,
        }
    }
}

impl From<application::ResolvedTemplate> for MethodologyResolvedTemplate {
    fn from(value: application::ResolvedTemplate) -> Self {
        Self {
            template: value.template.into(),
            source_version_id: value.source_version_id,
        }
    }
}

impl From<application::Resolution> for MethodologyResolution {
    fn from(value: application::Resolution) -> Self {
        Self {
            status: value.status.into(),
            context: value.context.into(),
            version_ids: value.version_ids,
            requirements: value.requirements.into_iter().map(Into::into).collect(),
            templates: value.templates.into_iter().map(Into::into).collect(),
            neutral_source_version_ids: value.neutral_source_version_ids,
            issues: value.issues,
            reason: value.reason,
        }
    }
}

impl From<application::Binding> for MethodologyBinding {
    fn from(value: application::Binding) -> Self {
        Self {
            id: value.id,
            context_command_id: value.context_command_id,
            candidate_version_ids: value.candidate_version_ids,
            bound_at: value.bound_at,
            actor_id: value.actor_id,
            execution_epoch: value.execution_epoch.to_string(),
            resolution: value.resolution.into(),
        }
    }
}

impl From<application::BindingChange> for MethodologyBindingChange {
    fn from(value: application::BindingChange) -> Self {
        Self {
            id: value.id,
            actor_id: value.actor_id,
            requested_at: value.requested_at,
            resolution: value.resolution.into(),
            reason: value.reason,
        }
    }
}

impl From<application::TaskBasis> for TaskMethodologyResponse {
    fn from(value: application::TaskBasis) -> Self {
        Self {
            task_id: value.task_id,
            current: value.current.into(),
            pending: value.pending.map(Into::into),
            history: value.history.into_iter().map(Into::into).collect(),
            recalled: value.recalled,
            notices: value.notices.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<application::BindingNotice> for MethodologyBindingNotice {
    fn from(value: application::BindingNotice) -> Self {
        Self {
            id: value.id,
            version_id: value.version_id,
            actor_id: value.actor_id,
            requested_at: value.requested_at,
            impact: value.impact.into(),
        }
    }
}
