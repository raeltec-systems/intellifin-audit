//! Explicit catalog installation and scoped technique selection; no invocation endpoint.
use crate::auth::{self, AuthState, ErrorResponse};
use crate::membership::MembershipAssignmentOption;
use crate::methodology::{
    MethodologyApplicability, MethodologyAssignmentScope, MethodologyBinding,
};
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
    skills::{self as application, SkillsError, SkillsStore},
};
use zobba_domain::identity::{Scope, valid_scope_id};
use zobba_infrastructure::{identity::secret_hash, skills::SkillsRepository};

#[derive(Clone)]
pub(crate) struct SkillsState {
    identity: AuthState,
    repository: SkillsRepository,
}
pub(crate) fn router(pool: sqlx::PgPool, identity: AuthState) -> Router {
    let capacity = Arc::new(Semaphore::new(4));
    Router::new()
        .route("/skills/organisations/{organisation_id}", get(catalog))
        .route(
            "/skills/organisations/{organisation_id}/assignments",
            get(assignment_options),
        )
        .route(
            "/skills/organisations/{organisation_id}/versions/{version_id}/history",
            get(status_history),
        )
        .route(
            "/engagements/{engagement_id}/skills/impacts",
            get(selection_impact),
        )
        .route(
            "/skills/organisations/{organisation_id}/install",
            post(install),
        )
        .route(
            "/skills/organisations/{organisation_id}/status",
            post(set_status),
        )
        .route(
            "/engagements/{engagement_id}/tasks/{task_id}/skills",
            get(discover),
        )
        .route(
            "/engagements/{engagement_id}/tasks/{task_id}/skills/select",
            post(select),
        )
        .route(
            "/engagements/{engagement_id}/tasks/{task_id}/skills/selections/{selection_id}",
            get(current_use),
        )
        .with_state(SkillsState {
            identity,
            repository: SkillsRepository::new(pool),
        })
        .layer(DefaultBodyLimit::max(1024 * 1024))
        .layer(axum::middleware::from_fn(
            move |request: axum::extract::Request, next: axum::middleware::Next| {
                let capacity = capacity.clone();
                async move {
                    let Ok(_permit) = capacity.try_acquire_owned() else {
                        return failure(SkillsError::Capacity);
                    };
                    match tokio::time::timeout(Duration::from_secs(6), next.run(request)).await {
                        Ok(response) => response,
                        Err(_) => failure(SkillsError::Unavailable),
                    }
                }
            },
        ))
}
fn failure(error: SkillsError) -> Response {
    let status = match error {
        SkillsError::Invalid => StatusCode::BAD_REQUEST,
        SkillsError::Denied => StatusCode::FORBIDDEN,
        SkillsError::Conflict | SkillsError::Ineligible => StatusCode::CONFLICT,
        SkillsError::Capacity => StatusCode::TOO_MANY_REQUESTS,
        SkillsError::Unavailable => StatusCode::SERVICE_UNAVAILABLE,
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
    Skills(SkillsError),
}

impl IntoResponse for AuthenticationFailure {
    fn into_response(self) -> Response {
        match self {
            Self::Identity(error) => auth::failure(error),
            Self::Skills(error) => failure(error),
        }
    }
}

async fn current(
    state: &SkillsState,
    headers: &HeaderMap,
    mutation: bool,
) -> Result<(CurrentSession, SkillsRepository), AuthenticationFailure> {
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
            return Err(AuthenticationFailure::Skills(SkillsError::Denied));
        }
    }
    let token = auth::cookie(headers, auth::SESSION_COOKIE)
        .ok_or(AuthenticationFailure::Skills(SkillsError::Denied))?;
    Ok((
        current,
        state
            .repository
            .clone()
            .with_session_hash(secret_hash(&token)),
    ))
}
fn revision(value: &str) -> Result<u64, SkillsError> {
    let parsed = value.parse::<u64>().map_err(|_| SkillsError::Invalid)?;
    if parsed > i64::MAX as u64 || parsed.to_string() != value {
        return Err(SkillsError::Invalid);
    }
    Ok(parsed)
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SkillStatus {
    Enabled,
    Disabled,
    Recalled,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SkillResourceKind {
    Text,
    Script,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SkillTool {
    LiveReadV1,
    TestReadV1,
    TestWriteV1,
    TestSendV1,
    AuditReadV1,
    AuditWriteV1,
    AuditSendV1,
    AnalysisV1,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SkillCapabilityStatus {
    Unavailable,
    Forbidden,
    CompatibleNeedsExactDetails,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SkillCapabilityBoundKind {
    Organisation,
    Engagement,
    Member,
    Account,
    Task,
    Delegation,
}

#[derive(Serialize, ToSchema)]
pub struct SkillCapabilityBound {
    pub accepted: bool,
    #[schema(value_type = SkillCapabilityBoundKind)]
    pub kind: String,
    #[schema(minimum = 0, maximum = 7)]
    pub delegation_depth: Option<usize>,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SkillEligibilityStatus {
    Eligible,
    Unavailable,
    Forbidden,
    Disabled,
    Recalled,
    Inapplicable,
    MethodologyBlocked,
    TaskBlocked,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct SkillSource {
    #[schema(min_length = 1, max_length = 2000)]
    pub reference: String,
    #[schema(min_length = 1, max_length = 2000)]
    pub revision: String,
    #[schema(min_length = 1, max_length = 2000)]
    pub license: String,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct SkillInput {
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub id: String,
    #[schema(min_length = 1, max_length = 200)]
    pub label: String,
    pub required: bool,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct SkillNeed {
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub id: String,
    #[serde(deserialize_with = "tool_identifier")]
    #[schema(value_type = SkillTool)]
    pub tool: String,
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub account_id: Option<String>,
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub environment_id: Option<String>,
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub destination: Option<String>,
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub resource_id: Option<String>,
    #[schema(max_items = 16)]
    pub recipients: Vec<String>,
    #[schema(max_items = 16)]
    pub attachment_classifications: Vec<String>,
    pub requires_attachments: bool,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct SkillResource {
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub id: String,
    #[serde(deserialize_with = "resource_kind")]
    #[schema(value_type = SkillResourceKind)]
    pub kind: String,
    /// Exact UTF-8 resource bytes: 32 KiB per resource and 128 KiB in aggregate.
    /// Nonempty under Unicode White_Space; only LF, CR and tab controls allowed.
    /// U+FEFF, indentation and line endings are preserved; scripts remain inert.
    #[schema(min_length = 1, max_length = 32768)]
    pub content: String,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct SkillManifest {
    #[schema(minimum = 1, maximum = 1)]
    pub schema_version: u16,
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub id: String,
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub version: String,
    #[schema(min_length = 1, max_length = 200)]
    pub name: String,
    #[schema(min_length = 1, max_length = 2000)]
    pub description: String,
    pub source: SkillSource,
    #[schema(max_items = 32)]
    pub inputs: Vec<SkillInput>,
    #[schema(max_items = 32)]
    pub outputs: Vec<String>,
    #[schema(max_items = 16)]
    pub needs: Vec<SkillNeed>,
    #[schema(max_items = 32)]
    pub method_version_ids: Vec<String>,
    #[schema(max_items = 16)]
    pub resources: Vec<SkillResource>,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct InstallSkillRequest {
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub key: String,
    #[schema(pattern = "^(0|[1-9][0-9]*)$")]
    pub expected_revision: String,
    pub assignment: MethodologyAssignmentScope,
    pub applicability: MethodologyApplicability,
    pub manifest: SkillManifest,
    pub enabled: bool,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ChangeSkillStatusRequest {
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub key: String,
    #[schema(pattern = "^(0|[1-9][0-9]*)$")]
    pub expected_revision: String,
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub version_id: String,
    pub status: SkillStatus,
    #[schema(min_length = 1, max_length = 2000)]
    pub reason: String,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct SkillResourceDigest {
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub id: String,
    #[schema(pattern = "^[a-f0-9]{64}$")]
    pub digest: String,
}

#[derive(Serialize, ToSchema)]
pub struct SkillVersion {
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub id: String,
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub actor_id: String,
    #[schema(minimum = 0, maximum = 253402300799i64)]
    pub installed_at: i64,
    #[schema(pattern = "^(0|[1-9][0-9]*)$")]
    pub revision: String,
    pub command: InstallSkillRequest,
    #[schema(pattern = "^[a-f0-9]{64}$")]
    pub digest: String,
    #[schema(max_items = 16)]
    pub resource_digests: Vec<SkillResourceDigest>,
    pub status: SkillStatus,
    #[schema(pattern = "^(0|[1-9][0-9]*)$")]
    pub status_revision: String,
    pub status_event: SkillStatusEvent,
}

#[derive(Serialize, ToSchema)]
pub struct SkillCatalogSnapshot {
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub organisation_id: String,
    #[schema(pattern = "^(0|[1-9][0-9]*)$")]
    pub revision: String,
    #[schema(max_items = 128)]
    pub versions: Vec<SkillVersion>,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SkillAssignmentKind {
    Client,
    Engagement,
}

#[derive(Serialize, ToSchema)]
pub struct SkillClientAssignmentOption {
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub client_id: String,
    #[schema(min_length = 1, max_length = 200)]
    pub client_name: String,
}

#[derive(Serialize, ToSchema)]
pub struct SkillAssignmentPage {
    #[schema(max_items = 50)]
    pub clients: Vec<SkillClientAssignmentOption>,
    #[schema(max_items = 50)]
    pub engagements: Vec<MembershipAssignmentOption>,
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub next_after: Option<String>,
}

#[derive(Serialize, ToSchema)]
pub struct SkillStatusEvent {
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub event_id: String,
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub actor_id: String,
    #[schema(minimum = 0, maximum = 253402300799i64)]
    pub recorded_at: i64,
    #[schema(pattern = "^(0|[1-9][0-9]*)$")]
    pub revision: String,
    pub status: SkillStatus,
    #[schema(min_length = 1, max_length = 2000)]
    pub reason: Option<String>,
}

#[derive(Serialize, ToSchema)]
pub struct SkillStatusHistory {
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub version_id: String,
    #[schema(max_items = 50)]
    pub events: Vec<SkillStatusEvent>,
    #[schema(pattern = "^(0|[1-9][0-9]*)$")]
    pub next_before_revision: Option<String>,
}

#[derive(Serialize, ToSchema)]
pub struct SkillImpactCursor {
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub task_id: String,
    #[schema(pattern = "^[1-9][0-9]*$")]
    pub revision: String,
}

#[derive(Serialize, ToSchema)]
pub struct SkillSelectionImpact {
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub task_id: String,
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub selection_id: String,
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub selector_id: String,
    #[schema(minimum = 0, maximum = 253402300799i64)]
    pub selected_at: i64,
    #[schema(pattern = "^(0|[1-9][0-9]*)$")]
    pub selection_revision: String,
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub version_id: String,
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub skill_id: String,
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub skill_version: String,
    #[schema(pattern = "^[a-f0-9]{64}$")]
    pub digest: String,
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub methodology_binding_id: String,
    #[schema(pattern = "^(0|[1-9][0-9]*)$")]
    pub execution_epoch: String,
    #[schema(pattern = "^(0|[1-9][0-9]*)$")]
    pub catalog_revision: String,
    pub status: SkillStatus,
    #[schema(pattern = "^(0|[1-9][0-9]*)$")]
    pub status_revision: String,
}

#[derive(Serialize, ToSchema)]
pub struct SkillSelectionImpactPage {
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub organisation_id: String,
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub client_id: String,
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub engagement_id: String,
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub version_id: Option<String>,
    #[schema(max_items = 50)]
    pub selections: Vec<SkillSelectionImpact>,
    pub next_after: Option<SkillImpactCursor>,
}

#[derive(Serialize, ToSchema)]
pub struct SkillCatalogReceipt {
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub event_id: String,
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub organisation_id: String,
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub actor_id: String,
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub version_id: String,
    #[schema(pattern = "^(0|[1-9][0-9]*)$")]
    pub revision: String,
    pub status: SkillStatus,
    #[schema(pattern = "^(0|[1-9][0-9]*)$")]
    pub affected_selections: String,
}

#[derive(Serialize, ToSchema)]
pub struct SkillNeedInspection {
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub id: String,
    #[schema(value_type = SkillTool)]
    pub tool: String,
    pub status: SkillCapabilityStatus,
    /// Server-owned explanation, at most 256 UTF-8 bytes.
    #[schema(min_length = 1, max_length = 256)]
    pub reason: String,
    #[schema(minimum = 0, maximum = 253402300799i64)]
    pub refresh_at: Option<i64>,
    pub blocking_bound: Option<SkillCapabilityBound>,
}

#[derive(Serialize, ToSchema)]
pub struct SkillInspection {
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub version_id: String,
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub skill_id: String,
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub skill_version: String,
    #[schema(pattern = "^[a-f0-9]{64}$")]
    pub digest: String,
    #[schema(pattern = "^(0|[1-9][0-9]*)$")]
    pub catalog_revision: String,
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub methodology_binding_id: String,
    #[schema(pattern = "^(0|[1-9][0-9]*)$")]
    pub execution_epoch: String,
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub authority_actor_id: Option<String>,
    pub status: SkillEligibilityStatus,
    /// Server-owned explanation, at most 256 UTF-8 bytes.
    #[schema(min_length = 1, max_length = 256)]
    pub reason: String,
    #[schema(max_items = 16)]
    pub needs: Vec<SkillNeedInspection>,
    #[schema(minimum = 0, maximum = 253402300799i64)]
    pub observed_at: i64,
    #[schema(pattern = "^[a-f0-9]{64}$")]
    pub dependency_fingerprint: String,
}

#[derive(Serialize, ToSchema)]
pub struct SkillSelection {
    #[schema(pattern = "^(0|[1-9][0-9]*)$")]
    pub execution_epoch: String,
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub id: String,
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub task_id: String,
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub selector_id: String,
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub authority_actor_id: Option<String>,
    #[schema(minimum = 0, maximum = 253402300799i64)]
    pub selected_at: i64,
    #[schema(pattern = "^(0|[1-9][0-9]*)$")]
    pub revision: String,
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub version_id: String,
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub skill_id: String,
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub skill_version: String,
    #[schema(pattern = "^[a-f0-9]{64}$")]
    pub digest: String,
    #[schema(min_length = 1, max_length = 2000)]
    pub reason: String,
    pub methodology: MethodologyBinding,
    #[schema(pattern = "^(0|[1-9][0-9]*)$")]
    pub catalog_revision: String,
    #[schema(pattern = "^[a-f0-9]{64}$")]
    pub dependency_fingerprint: String,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct SelectSkillRequest {
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub key: String,
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub version_id: String,
    #[schema(min_length = 1, max_length = 2000)]
    pub reason: String,
    #[schema(pattern = "^(0|[1-9][0-9]*)$")]
    pub expected_catalog_revision: String,
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub expected_methodology_binding_id: String,
    #[schema(pattern = "^(0|[1-9][0-9]*)$")]
    pub expected_execution_epoch: String,
    #[schema(pattern = "^(0|[1-9][0-9]*)$")]
    pub expected_selection_revision: String,
}

#[derive(Serialize, ToSchema)]
pub struct SkillSelectionView {
    pub selection: SkillSelection,
    pub current: SkillInspection,
}

#[derive(Serialize, ToSchema)]
pub struct SkillCandidate {
    pub version: SkillVersion,
    pub inspection: SkillInspection,
}

#[derive(Serialize, ToSchema)]
pub struct TaskSkillsResponse {
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub task_id: String,
    #[schema(pattern = "^(0|[1-9][0-9]*)$")]
    pub catalog_revision: String,
    #[schema(pattern = "^(0|[1-9][0-9]*)$")]
    pub selection_revision: String,
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub methodology_binding_id: String,
    #[schema(pattern = "^(0|[1-9][0-9]*)$")]
    pub execution_epoch: String,
    #[schema(max_items = 128)]
    pub candidates: Vec<SkillCandidate>,
    #[schema(max_items = 128)]
    pub selections: Vec<SkillSelectionView>,
    #[schema(minimum = 0, maximum = 253402300799i64)]
    pub observed_at: i64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SkillScopeQuery {
    organisation_id: String,
    client_id: String,
}
fn task_scope(
    query: Result<Query<SkillScopeQuery>, QueryRejection>,
    engagement_id: String,
    task_id: &str,
) -> Result<Scope, SkillsError> {
    let Query(query) = query.map_err(|_| SkillsError::Denied)?;
    let scope = Scope {
        organisation_id: query.organisation_id,
        client_id: query.client_id,
        engagement_id,
    };
    if !scope.is_valid() || !valid_scope_id(task_id) {
        return Err(SkillsError::Denied);
    }
    Ok(scope)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SkillAssignmentQuery {
    kind: SkillAssignmentKind,
    client_id: Option<String>,
    after: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SkillHistoryQuery {
    before_revision: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SkillImpactQuery {
    organisation_id: String,
    client_id: String,
    version_id: Option<String>,
    after_task_id: Option<String>,
    after_revision: Option<String>,
}

#[utoipa::path(get, path="/skills/organisations/{organisation_id}/assignments", operation_id="skills_assignment_options", security(("server_session"=[])),
params(("organisation_id"=String,Path),("kind"=SkillAssignmentKind,Query),("client_id"=Option<String>,Query,description="Required for engagement choices; absent for client choices"),("after"=Option<String>,Query),("X-Expected-Session"=Option<String>,Header)),
responses((status=200,body=SkillAssignmentPage),(status=400,body=ErrorResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=409,body=ErrorResponse),(status=412,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn assignment_options(
    State(state): State<SkillsState>,
    headers: HeaderMap,
    Path(organisation): Path<String>,
    query: Result<Query<SkillAssignmentQuery>, QueryRejection>,
) -> Response {
    let (current, repository) = match current(&state, &headers, false).await {
        Ok(value) => value,
        Err(error) => return error.into_response(),
    };
    if !valid_scope_id(&organisation) {
        return failure(SkillsError::Denied);
    }
    let Ok(Query(query)) = query else {
        return failure(SkillsError::Invalid);
    };
    let query = application::AssignmentOptionsQuery {
        kind: match query.kind {
            SkillAssignmentKind::Client => application::AssignmentKind::Client,
            SkillAssignmentKind::Engagement => application::AssignmentKind::Engagement,
        },
        client_id: query.client_id,
        after: query.after,
    };
    if !query.is_valid() {
        return failure(SkillsError::Invalid);
    }
    match repository
        .assignment_options(&current.identity.id, &organisation, &query)
        .await
    {
        Ok(value) => Json(SkillAssignmentPage::from(value)).into_response(),
        Err(error) => failure(error),
    }
}

#[utoipa::path(get, path="/skills/organisations/{organisation_id}/versions/{version_id}/history", operation_id="skills_status_history", security(("server_session"=[])),
params(("organisation_id"=String,Path),("version_id"=String,Path),("before_revision"=Option<String>,Query),("X-Expected-Session"=Option<String>,Header)),
responses((status=200,body=SkillStatusHistory),(status=400,body=ErrorResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=409,body=ErrorResponse),(status=412,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn status_history(
    State(state): State<SkillsState>,
    headers: HeaderMap,
    Path((organisation, version)): Path<(String, String)>,
    query: Result<Query<SkillHistoryQuery>, QueryRejection>,
) -> Response {
    let (current, repository) = match current(&state, &headers, false).await {
        Ok(value) => value,
        Err(error) => return error.into_response(),
    };
    if !valid_scope_id(&organisation) || !valid_scope_id(&version) {
        return failure(SkillsError::Denied);
    }
    let Ok(Query(query)) = query else {
        return failure(SkillsError::Invalid);
    };
    let before = match query.before_revision.as_deref().map(revision).transpose() {
        Ok(value) => value,
        Err(error) => return failure(error),
    };
    match repository
        .status_history(&current.identity.id, &organisation, &version, before)
        .await
    {
        Ok(value) => Json(SkillStatusHistory::from(value)).into_response(),
        Err(error) => failure(error),
    }
}

#[utoipa::path(get, path="/engagements/{engagement_id}/skills/impacts", operation_id="skills_selection_impact", security(("server_session"=[])),
params(("engagement_id"=String,Path),("organisation_id"=String,Query),("client_id"=String,Query),("version_id"=Option<String>,Query,description="Omit to list selections of currently disabled or recalled versions"),("after_task_id"=Option<String>,Query,description="Cursor pair: both task and revision are required"),("after_revision"=Option<String>,Query),("X-Expected-Session"=Option<String>,Header)),
responses((status=200,body=SkillSelectionImpactPage),(status=400,body=ErrorResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=409,body=ErrorResponse),(status=412,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn selection_impact(
    State(state): State<SkillsState>,
    headers: HeaderMap,
    Path(engagement_id): Path<String>,
    query: Result<Query<SkillImpactQuery>, QueryRejection>,
) -> Response {
    let (current, repository) = match current(&state, &headers, false).await {
        Ok(value) => value,
        Err(error) => return error.into_response(),
    };
    let Ok(Query(query)) = query else {
        return failure(SkillsError::Invalid);
    };
    let scope = Scope {
        organisation_id: query.organisation_id,
        client_id: query.client_id,
        engagement_id,
    };
    if !scope.is_valid() || !query.version_id.as_deref().is_none_or(valid_scope_id) {
        return failure(SkillsError::Denied);
    }
    let after = match (query.after_task_id, query.after_revision) {
        (None, None) => None,
        (Some(task_id), Some(value)) => match revision(&value) {
            Ok(revision) => Some(application::ImpactCursor { task_id, revision }),
            Err(error) => return failure(error),
        },
        _ => return failure(SkillsError::Invalid),
    };
    if after.as_ref().is_some_and(|cursor| !cursor.is_valid()) {
        return failure(SkillsError::Invalid);
    }
    match repository
        .selection_impact(
            &current.identity.id,
            &scope,
            query.version_id.as_deref(),
            after.as_ref(),
        )
        .await
    {
        Ok(value) => Json(SkillSelectionImpactPage::from(value)).into_response(),
        Err(error) => failure(error),
    }
}

#[utoipa::path(get, path="/skills/organisations/{organisation_id}", operation_id="skills_catalog", security(("server_session"=[])),
params(("organisation_id"=String,Path),("X-Expected-Session"=Option<String>,Header)),
responses((status=200,body=SkillCatalogSnapshot),(status=400,body=ErrorResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=409,body=ErrorResponse),(status=412,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn catalog(
    State(state): State<SkillsState>,
    headers: HeaderMap,
    Path(organisation): Path<String>,
) -> Response {
    let (current, repository) = match current(&state, &headers, false).await {
        Ok(value) => value,
        Err(error) => return error.into_response(),
    };
    if !valid_scope_id(&organisation) {
        return failure(SkillsError::Denied);
    }
    match repository
        .catalog(&current.identity.id, &organisation)
        .await
    {
        Ok(value) => Json(SkillCatalogSnapshot::from(value)).into_response(),
        Err(error) => failure(error),
    }
}

#[utoipa::path(post, path="/skills/organisations/{organisation_id}/install", operation_id="skills_install", security(("server_session"=[])),
params(("organisation_id"=String,Path),("X-Expected-Session"=Option<String>,Header),("Origin"=String,Header),("X-CSRF-Token"=String,Header),("X-Expected-Actor"=String,Header,description="Required exact current actor refusal fence")),
request_body=InstallSkillRequest,
responses((status=200,body=SkillCatalogReceipt),(status=400,body=ErrorResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=409,body=ErrorResponse),(status=412,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn install(
    State(state): State<SkillsState>,
    headers: HeaderMap,
    Path(organisation): Path<String>,
    body: Result<Json<InstallSkillRequest>, JsonRejection>,
) -> Response {
    let (current, repository) = match current(&state, &headers, true).await {
        Ok(value) => value,
        Err(error) => return error.into_response(),
    };
    if !valid_scope_id(&organisation) {
        return failure(SkillsError::Denied);
    }
    let command = match body {
        Ok(Json(body)) => match application::InstallSkill::try_from(body) {
            Ok(command) if command.is_valid() => command,
            _ => return failure(SkillsError::Invalid),
        },
        Err(_) => return failure(SkillsError::Invalid),
    };
    match repository
        .install(&current.identity.id, &organisation, &command)
        .await
    {
        Ok(value) => Json(SkillCatalogReceipt::from(value)).into_response(),
        Err(error) => failure(error),
    }
}

#[utoipa::path(post, path="/skills/organisations/{organisation_id}/status", operation_id="skills_set_status", security(("server_session"=[])),
params(("organisation_id"=String,Path),("X-Expected-Session"=Option<String>,Header),("Origin"=String,Header),("X-CSRF-Token"=String,Header),("X-Expected-Actor"=String,Header,description="Required exact current actor refusal fence")),
request_body=ChangeSkillStatusRequest,
responses((status=200,body=SkillCatalogReceipt),(status=400,body=ErrorResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=409,body=ErrorResponse),(status=412,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn set_status(
    State(state): State<SkillsState>,
    headers: HeaderMap,
    Path(organisation): Path<String>,
    body: Result<Json<ChangeSkillStatusRequest>, JsonRejection>,
) -> Response {
    let (current, repository) = match current(&state, &headers, true).await {
        Ok(value) => value,
        Err(error) => return error.into_response(),
    };
    if !valid_scope_id(&organisation) {
        return failure(SkillsError::Denied);
    }
    let command = match body {
        Ok(Json(body)) => match application::ChangeSkillStatus::try_from(body) {
            Ok(command) if command.is_valid() => command,
            _ => return failure(SkillsError::Invalid),
        },
        Err(_) => return failure(SkillsError::Invalid),
    };
    match repository
        .set_status(&current.identity.id, &organisation, &command)
        .await
    {
        Ok(value) => Json(SkillCatalogReceipt::from(value)).into_response(),
        Err(error) => failure(error),
    }
}

#[utoipa::path(get, path="/engagements/{engagement_id}/tasks/{task_id}/skills", operation_id="skills_discover", security(("server_session"=[])),
params(("engagement_id"=String,Path),("task_id"=String,Path),("organisation_id"=String,Query),("client_id"=String,Query),("X-Expected-Session"=Option<String>,Header)),
responses((status=200,body=TaskSkillsResponse),(status=400,body=ErrorResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=409,body=ErrorResponse),(status=412,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn discover(
    State(state): State<SkillsState>,
    headers: HeaderMap,
    Path((engagement_id, task_id)): Path<(String, String)>,
    query: Result<Query<SkillScopeQuery>, QueryRejection>,
) -> Response {
    let (current, repository) = match current(&state, &headers, false).await {
        Ok(value) => value,
        Err(error) => return error.into_response(),
    };
    let scope = match task_scope(query, engagement_id, &task_id) {
        Ok(value) => value,
        Err(error) => return failure(error),
    };
    match repository
        .discover(&current.identity.id, &scope, &task_id)
        .await
    {
        Ok(value) => Json(TaskSkillsResponse::from(value)).into_response(),
        Err(error) => failure(error),
    }
}

#[utoipa::path(post, path="/engagements/{engagement_id}/tasks/{task_id}/skills/select", operation_id="skills_select", security(("server_session"=[])),
params(("engagement_id"=String,Path),("task_id"=String,Path),("organisation_id"=String,Query),("client_id"=String,Query),("X-Expected-Session"=Option<String>,Header),("Origin"=String,Header),("X-CSRF-Token"=String,Header),("X-Expected-Actor"=String,Header,description="Required exact current actor refusal fence")),
request_body=SelectSkillRequest,
responses((status=200,body=SkillSelectionView),(status=400,body=ErrorResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=409,body=ErrorResponse),(status=412,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn select(
    State(state): State<SkillsState>,
    headers: HeaderMap,
    Path((engagement_id, task_id)): Path<(String, String)>,
    query: Result<Query<SkillScopeQuery>, QueryRejection>,
    body: Result<Json<SelectSkillRequest>, JsonRejection>,
) -> Response {
    let (current, repository) = match current(&state, &headers, true).await {
        Ok(value) => value,
        Err(error) => return error.into_response(),
    };
    let scope = match task_scope(query, engagement_id, &task_id) {
        Ok(value) => value,
        Err(error) => return failure(error),
    };
    let command = match body {
        Ok(Json(body)) => match application::SelectSkill::try_from(body) {
            Ok(command) if command.is_valid() => command,
            _ => return failure(SkillsError::Invalid),
        },
        Err(_) => return failure(SkillsError::Invalid),
    };
    match repository
        .select(&current.identity.id, &scope, &task_id, &command)
        .await
    {
        Ok(value) => Json(SkillSelectionView::from(value)).into_response(),
        Err(error) => failure(error),
    }
}

#[utoipa::path(get, path="/engagements/{engagement_id}/tasks/{task_id}/skills/selections/{selection_id}", operation_id="skills_current_use", security(("server_session"=[])),
params(("engagement_id"=String,Path),("task_id"=String,Path),("organisation_id"=String,Query),("client_id"=String,Query),("selection_id"=String,Path),("X-Expected-Session"=Option<String>,Header)),
responses((status=200,body=SkillSelectionView),(status=400,body=ErrorResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=409,body=ErrorResponse),(status=412,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn current_use(
    State(state): State<SkillsState>,
    headers: HeaderMap,
    Path((engagement_id, task_id, selection_id)): Path<(String, String, String)>,
    query: Result<Query<SkillScopeQuery>, QueryRejection>,
) -> Response {
    let (current, repository) = match current(&state, &headers, false).await {
        Ok(value) => value,
        Err(error) => return error.into_response(),
    };
    let scope = match task_scope(query, engagement_id, &task_id) {
        Ok(value) => value,
        Err(error) => return failure(error),
    };
    if !valid_scope_id(&selection_id) {
        return failure(SkillsError::Denied);
    }
    match repository
        .current_use(&current.identity.id, &scope, &task_id, &selection_id)
        .await
    {
        Ok(value) => Json(SkillSelectionView::from(value)).into_response(),
        Err(error) => failure(error),
    }
}

fn tool_identifier<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<String, D::Error> {
    let value = String::deserialize(deserializer)?;
    if zobba_domain::skills::ToolId::parse(&value).is_none() {
        return Err(serde::de::Error::custom("unknown skill tool"));
    }
    Ok(value)
}
fn resource_kind<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<String, D::Error> {
    let value = String::deserialize(deserializer)?;
    if zobba_domain::skills::ResourceKind::parse(&value).is_none() {
        return Err(serde::de::Error::custom("unknown resource kind"));
    }
    Ok(value)
}

impl From<SkillSource> for application::Source {
    fn from(value: SkillSource) -> Self {
        Self {
            reference: value.reference,
            revision: value.revision,
            license: value.license,
        }
    }
}

impl From<application::Source> for SkillSource {
    fn from(value: application::Source) -> Self {
        Self {
            reference: value.reference,
            revision: value.revision,
            license: value.license,
        }
    }
}

impl From<SkillInput> for application::Input {
    fn from(value: SkillInput) -> Self {
        Self {
            id: value.id,
            label: value.label,
            required: value.required,
        }
    }
}

impl From<application::Input> for SkillInput {
    fn from(value: application::Input) -> Self {
        Self {
            id: value.id,
            label: value.label,
            required: value.required,
        }
    }
}

impl From<SkillNeed> for application::ToolNeed {
    fn from(value: SkillNeed) -> Self {
        Self {
            id: value.id,
            tool: value.tool,
            account_id: value.account_id,
            environment_id: value.environment_id,
            destination: value.destination,
            resource_id: value.resource_id,
            recipients: value.recipients,
            attachment_classifications: value.attachment_classifications,
            requires_attachments: value.requires_attachments,
        }
    }
}

impl From<application::ToolNeed> for SkillNeed {
    fn from(value: application::ToolNeed) -> Self {
        Self {
            id: value.id,
            tool: value.tool,
            account_id: value.account_id,
            environment_id: value.environment_id,
            destination: value.destination,
            resource_id: value.resource_id,
            recipients: value.recipients,
            attachment_classifications: value.attachment_classifications,
            requires_attachments: value.requires_attachments,
        }
    }
}

impl From<SkillResource> for application::Resource {
    fn from(value: SkillResource) -> Self {
        Self {
            id: value.id,
            kind: value.kind,
            content: value.content,
        }
    }
}

impl From<application::Resource> for SkillResource {
    fn from(value: application::Resource) -> Self {
        Self {
            id: value.id,
            kind: value.kind,
            content: value.content,
        }
    }
}

impl From<SkillManifest> for application::Manifest {
    fn from(value: SkillManifest) -> Self {
        Self {
            schema_version: value.schema_version,
            id: value.id,
            version: value.version,
            name: value.name,
            description: value.description,
            source: value.source.into(),
            inputs: value.inputs.into_iter().map(Into::into).collect(),
            outputs: value.outputs,
            needs: value.needs.into_iter().map(Into::into).collect(),
            method_version_ids: value.method_version_ids,
            resources: value.resources.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<application::Manifest> for SkillManifest {
    fn from(value: application::Manifest) -> Self {
        Self {
            schema_version: value.schema_version,
            id: value.id,
            version: value.version,
            name: value.name,
            description: value.description,
            source: value.source.into(),
            inputs: value.inputs.into_iter().map(Into::into).collect(),
            outputs: value.outputs,
            needs: value.needs.into_iter().map(Into::into).collect(),
            method_version_ids: value.method_version_ids,
            resources: value.resources.into_iter().map(Into::into).collect(),
        }
    }
}

impl TryFrom<InstallSkillRequest> for application::InstallSkill {
    type Error = SkillsError;
    fn try_from(value: InstallSkillRequest) -> Result<Self, Self::Error> {
        Ok(Self {
            key: value.key,
            expected_revision: revision(&value.expected_revision)?,
            assignment: value.assignment.into(),
            applicability: value.applicability.into(),
            manifest: value.manifest.into(),
            enabled: value.enabled,
        })
    }
}

impl From<application::InstallSkill> for InstallSkillRequest {
    fn from(value: application::InstallSkill) -> Self {
        Self {
            key: value.key,
            expected_revision: value.expected_revision.to_string(),
            assignment: value.assignment.into(),
            applicability: value.applicability.into(),
            manifest: value.manifest.into(),
            enabled: value.enabled,
        }
    }
}

impl TryFrom<ChangeSkillStatusRequest> for application::ChangeSkillStatus {
    type Error = SkillsError;
    fn try_from(value: ChangeSkillStatusRequest) -> Result<Self, Self::Error> {
        Ok(Self {
            key: value.key,
            expected_revision: revision(&value.expected_revision)?,
            version_id: value.version_id,
            status: value.status.into(),
            reason: value.reason,
        })
    }
}

impl From<application::ResourceDigest> for SkillResourceDigest {
    fn from(value: application::ResourceDigest) -> Self {
        Self {
            id: value.id,
            digest: value.digest,
        }
    }
}

impl From<application::SkillVersion> for SkillVersion {
    fn from(value: application::SkillVersion) -> Self {
        Self {
            id: value.id,
            actor_id: value.actor_id,
            installed_at: value.installed_at,
            revision: value.revision.to_string(),
            command: value.command.into(),
            digest: value.digest,
            resource_digests: value.resource_digests.into_iter().map(Into::into).collect(),
            status: value.status.into(),
            status_revision: value.status_revision.to_string(),
            status_event: value.status_event.into(),
        }
    }
}

impl From<application::CatalogSnapshot> for SkillCatalogSnapshot {
    fn from(value: application::CatalogSnapshot) -> Self {
        Self {
            organisation_id: value.organisation_id,
            revision: value.revision.to_string(),
            versions: value.versions.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<application::AssignmentPage> for SkillAssignmentPage {
    fn from(value: application::AssignmentPage) -> Self {
        Self {
            clients: value
                .clients
                .into_iter()
                .map(|client| SkillClientAssignmentOption {
                    client_id: client.client_id,
                    client_name: client.client_name,
                })
                .collect(),
            engagements: value
                .engagements
                .into_iter()
                .map(|engagement| MembershipAssignmentOption {
                    client_id: engagement.client_id,
                    client_name: engagement.client_name,
                    engagement_id: engagement.engagement_id,
                    engagement_name: engagement.engagement_name,
                })
                .collect(),
            next_after: value.next_after,
        }
    }
}

impl From<application::StatusEvent> for SkillStatusEvent {
    fn from(value: application::StatusEvent) -> Self {
        Self {
            event_id: value.event_id,
            actor_id: value.actor_id,
            recorded_at: value.recorded_at,
            revision: value.revision.to_string(),
            status: value.status.into(),
            reason: value.reason,
        }
    }
}

impl From<application::StatusHistory> for SkillStatusHistory {
    fn from(value: application::StatusHistory) -> Self {
        Self {
            version_id: value.version_id,
            events: value.events.into_iter().map(Into::into).collect(),
            next_before_revision: value
                .next_before_revision
                .map(|revision| revision.to_string()),
        }
    }
}

impl From<application::ImpactCursor> for SkillImpactCursor {
    fn from(value: application::ImpactCursor) -> Self {
        Self {
            task_id: value.task_id,
            revision: value.revision.to_string(),
        }
    }
}

impl From<application::SelectionImpact> for SkillSelectionImpact {
    fn from(value: application::SelectionImpact) -> Self {
        Self {
            task_id: value.task_id,
            selection_id: value.selection_id,
            selector_id: value.selector_id,
            selected_at: value.selected_at,
            selection_revision: value.selection_revision.to_string(),
            version_id: value.version_id,
            skill_id: value.skill_id,
            skill_version: value.skill_version,
            digest: value.digest,
            methodology_binding_id: value.methodology_binding_id,
            execution_epoch: value.execution_epoch.to_string(),
            catalog_revision: value.catalog_revision.to_string(),
            status: value.status.into(),
            status_revision: value.status_revision.to_string(),
        }
    }
}

impl From<application::SelectionImpactPage> for SkillSelectionImpactPage {
    fn from(value: application::SelectionImpactPage) -> Self {
        Self {
            organisation_id: value.organisation_id,
            client_id: value.client_id,
            engagement_id: value.engagement_id,
            version_id: value.version_id,
            selections: value.selections.into_iter().map(Into::into).collect(),
            next_after: value.next_after.map(Into::into),
        }
    }
}

impl From<application::CapabilityBound> for SkillCapabilityBound {
    fn from(value: application::CapabilityBound) -> Self {
        Self {
            accepted: value.accepted,
            kind: value.kind,
            delegation_depth: value.delegation_depth,
        }
    }
}

impl From<application::CatalogReceipt> for SkillCatalogReceipt {
    fn from(value: application::CatalogReceipt) -> Self {
        Self {
            event_id: value.event_id,
            organisation_id: value.organisation_id,
            actor_id: value.actor_id,
            version_id: value.version_id,
            revision: value.revision.to_string(),
            status: value.status.into(),
            affected_selections: value.affected_selections.to_string(),
        }
    }
}

impl From<application::NeedInspection> for SkillNeedInspection {
    fn from(value: application::NeedInspection) -> Self {
        Self {
            id: value.id,
            tool: value.tool,
            status: value.status.into(),
            reason: value.reason,
            refresh_at: value.refresh_at,
            blocking_bound: value.blocking_bound.map(Into::into),
        }
    }
}

impl From<application::Inspection> for SkillInspection {
    fn from(value: application::Inspection) -> Self {
        Self {
            version_id: value.version_id,
            skill_id: value.skill_id,
            skill_version: value.skill_version,
            digest: value.digest,
            catalog_revision: value.catalog_revision.to_string(),
            methodology_binding_id: value.methodology_binding_id,
            execution_epoch: value.execution_epoch.to_string(),
            authority_actor_id: value.authority_actor_id,
            status: value.status.into(),
            reason: value.reason,
            needs: value.needs.into_iter().map(Into::into).collect(),
            observed_at: value.observed_at,
            dependency_fingerprint: value.dependency_fingerprint,
        }
    }
}

impl From<application::Selection> for SkillSelection {
    fn from(value: application::Selection) -> Self {
        Self {
            execution_epoch: value.execution_epoch.to_string(),
            id: value.id,
            task_id: value.task_id,
            selector_id: value.selector_id,
            authority_actor_id: value.authority_actor_id,
            selected_at: value.selected_at,
            revision: value.revision.to_string(),
            version_id: value.version_id,
            skill_id: value.skill_id,
            skill_version: value.skill_version,
            digest: value.digest,
            reason: value.reason,
            methodology: value.methodology.into(),
            catalog_revision: value.catalog_revision.to_string(),
            dependency_fingerprint: value.dependency_fingerprint,
        }
    }
}

impl TryFrom<SelectSkillRequest> for application::SelectSkill {
    type Error = SkillsError;
    fn try_from(value: SelectSkillRequest) -> Result<Self, Self::Error> {
        Ok(Self {
            key: value.key,
            version_id: value.version_id,
            reason: value.reason,
            expected_catalog_revision: revision(&value.expected_catalog_revision)?,
            expected_methodology_binding_id: value.expected_methodology_binding_id,
            expected_execution_epoch: revision(&value.expected_execution_epoch)?,
            expected_selection_revision: revision(&value.expected_selection_revision)?,
        })
    }
}

impl From<application::SelectionView> for SkillSelectionView {
    fn from(value: application::SelectionView) -> Self {
        Self {
            selection: value.selection.into(),
            current: value.current.into(),
        }
    }
}

impl From<application::Candidate> for SkillCandidate {
    fn from(value: application::Candidate) -> Self {
        Self {
            version: value.version.into(),
            inspection: value.inspection.into(),
        }
    }
}

impl From<application::Discovery> for TaskSkillsResponse {
    fn from(value: application::Discovery) -> Self {
        Self {
            task_id: value.task_id,
            catalog_revision: value.catalog_revision.to_string(),
            selection_revision: value.selection_revision.to_string(),
            methodology_binding_id: value.methodology_binding_id,
            execution_epoch: value.execution_epoch.to_string(),
            candidates: value.candidates.into_iter().map(Into::into).collect(),
            selections: value.selections.into_iter().map(Into::into).collect(),
            observed_at: value.observed_at,
        }
    }
}

impl From<SkillStatus> for application::CatalogStatus {
    fn from(value: SkillStatus) -> Self {
        match value {
            SkillStatus::Enabled => Self::Enabled,
            SkillStatus::Disabled => Self::Disabled,
            SkillStatus::Recalled => Self::Recalled,
        }
    }
}

impl From<application::CatalogStatus> for SkillStatus {
    fn from(value: application::CatalogStatus) -> Self {
        match value {
            application::CatalogStatus::Enabled => Self::Enabled,
            application::CatalogStatus::Disabled => Self::Disabled,
            application::CatalogStatus::Recalled => Self::Recalled,
        }
    }
}

impl From<application::CapabilityStatus> for SkillCapabilityStatus {
    fn from(value: application::CapabilityStatus) -> Self {
        match value {
            application::CapabilityStatus::Unavailable => Self::Unavailable,
            application::CapabilityStatus::Forbidden => Self::Forbidden,
            application::CapabilityStatus::CompatibleNeedsExactDetails => {
                Self::CompatibleNeedsExactDetails
            }
        }
    }
}

impl From<application::EligibilityStatus> for SkillEligibilityStatus {
    fn from(value: application::EligibilityStatus) -> Self {
        match value {
            application::EligibilityStatus::Eligible => Self::Eligible,
            application::EligibilityStatus::Unavailable => Self::Unavailable,
            application::EligibilityStatus::Forbidden => Self::Forbidden,
            application::EligibilityStatus::Disabled => Self::Disabled,
            application::EligibilityStatus::Recalled => Self::Recalled,
            application::EligibilityStatus::Inapplicable => Self::Inapplicable,
            application::EligibilityStatus::MethodologyBlocked => Self::MethodologyBlocked,
            application::EligibilityStatus::TaskBlocked => Self::TaskBlocked,
        }
    }
}
