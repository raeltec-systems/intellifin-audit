//! Exact human decisions and safe finite reads share ordinary Task capacity.
//! Session cookies remain the identity authority; browser headers only refuse.
use crate::auth::{AuthState, ErrorResponse};
use axum::{
    Json, Router,
    extract::{
        Path, Query, State,
        rejection::{JsonRejection, PathRejection, QueryRejection},
    },
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get as route_get, post},
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use utoipa::ToSchema;
use zobba_application::{
    identity::IdentityError,
    operation::{OperationError, OperationStore},
};
use zobba_domain::{
    identity::{Scope, valid_scope_id},
    permissions::{
        Action, Attachment, AttemptHistoryEntry, CanonicalOperation, DecisionCommand,
        DecisionHistoryEntry, ObservationHistoryEntry, ObservationSource, Operation,
        OperationDecision, OperationHistory, OperationHistoryQuery, OperationState, PolicyKind,
        PolicyReference, Purpose, RevocationCommand, SourceFact,
    },
};
use zobba_infrastructure::operation::OperationRepository;

#[derive(Clone)]
pub(crate) struct OperationHttpState {
    identity: AuthState,
    repository: OperationRepository,
}

pub(crate) fn router(pool: PgPool, identity: AuthState) -> Router {
    Router::new()
        .route("/engagements/{engagement_id}/operations", route_get(list))
        .route(
            "/engagements/{engagement_id}/operations/{operation_id}",
            route_get(get),
        )
        .route(
            "/engagements/{engagement_id}/operations/{operation_id}/decisions",
            post(decide),
        )
        .route(
            "/engagements/{engagement_id}/operations/{operation_id}/history",
            route_get(history),
        )
        .route(
            "/engagements/{engagement_id}/permissions/{authority_id}/revoke",
            post(revoke),
        )
        .with_state(OperationHttpState {
            identity,
            repository: OperationRepository::new(pool),
        })
}

fn failure(error: OperationError) -> Response {
    let status = match error {
        OperationError::Invalid => StatusCode::BAD_REQUEST,
        OperationError::Denied => StatusCode::FORBIDDEN,
        OperationError::Conflict | OperationError::Fenced | OperationError::NeedsDecision => {
            StatusCode::CONFLICT
        }
        OperationError::Capacity => StatusCode::TOO_MANY_REQUESTS,
        OperationError::Unavailable => StatusCode::SERVICE_UNAVAILABLE,
    };
    (
        status,
        Json(ErrorResponse {
            error: error.code(),
        }),
    )
        .into_response()
}

/// Browser revisions and Unix-second expiries have one lossless decimal encoding.
fn positive_decimal(value: &str) -> Result<u64, OperationError> {
    if value.is_empty()
        || value.len() > 19
        || value.starts_with('0')
        || !value.bytes().all(|b| b.is_ascii_digit())
    {
        return Err(OperationError::Invalid);
    }
    value
        .parse::<u64>()
        .ok()
        .filter(|v| *v <= i64::MAX as u64)
        .ok_or(OperationError::Invalid)
}

fn expected_actor_matches(headers: &HeaderMap, actor: &str) -> bool {
    let mut expected = headers.get_all("x-expected-actor").iter();
    expected.next().is_some_and(|value| {
        expected.next().is_none()
            && value
                .to_str()
                .ok()
                .is_some_and(|value| valid_scope_id(value) && value == actor)
    })
}

#[derive(Clone, Copy, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PurposeRequest {
    LiveInspection,
    TestWorkflows,
    AuditCoordination,
}
impl From<PurposeRequest> for Purpose {
    fn from(value: PurposeRequest) -> Self {
        match value {
            PurposeRequest::LiveInspection => Self::LiveInspection,
            PurposeRequest::TestWorkflows => Self::TestWorkflows,
            PurposeRequest::AuditCoordination => Self::AuditCoordination,
        }
    }
}
impl From<Purpose> for PurposeRequest {
    fn from(value: Purpose) -> Self {
        match value {
            Purpose::LiveInspection => Self::LiveInspection,
            Purpose::TestWorkflows => Self::TestWorkflows,
            Purpose::AuditCoordination => Self::AuditCoordination,
        }
    }
}
#[derive(Clone, Copy, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ActionRequest {
    Read,
    Write,
    Send,
}
impl From<ActionRequest> for Action {
    fn from(value: ActionRequest) -> Self {
        match value {
            ActionRequest::Read => Self::Read,
            ActionRequest::Write => Self::Write,
            ActionRequest::Send => Self::Send,
        }
    }
}
impl From<Action> for ActionRequest {
    fn from(value: Action) -> Self {
        match value {
            Action::Read => Self::Read,
            Action::Write => Self::Write,
            Action::Send => Self::Send,
        }
    }
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct AttachmentRequest {
    /// Immutable logical material identity; never a credential or download capability.
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub id: String,
    #[schema(min_length = 64, max_length = 64, pattern = "^[a-f0-9]{64}$")]
    pub digest: String,
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub classification: String,
}
impl From<AttachmentRequest> for Attachment {
    fn from(v: AttachmentRequest) -> Self {
        Self {
            id: v.id,
            digest: v.digest,
            classification: v.classification,
        }
    }
}
impl From<Attachment> for AttachmentRequest {
    fn from(v: Attachment) -> Self {
        Self {
            id: v.id,
            digest: v.digest,
            classification: v.classification,
        }
    }
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CanonicalOperationRequest {
    /// Canonical request contract version, currently 1.
    #[schema(minimum = 1, maximum = 1)]
    pub version: u16,
    pub purpose: PurposeRequest,
    pub action: ActionRequest,
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub account_id: String,
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub environment_id: String,
    /// Exact logical destination, never a caller-selected URL or credential.
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub destination: String,
    /// Sorted unique logical recipient identities; order is canonical and substitutions refuse.
    #[schema(max_items = 16)]
    pub recipients: Vec<String>,
    /// Exact reviewed material, at most 4000 UTF-8 bytes.
    #[schema(max_length = 4000)]
    pub material: String,
    #[schema(min_length = 64, max_length = 64, pattern = "^[a-f0-9]{64}$")]
    pub material_digest: String,
    /// Sorted by unique attachment ID; complete immutable material identities.
    #[schema(max_items = 16)]
    pub attachments: Vec<AttachmentRequest>,
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub resource_id: String,
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub resource_version: String,
    /// Exact positive Unix seconds represented as decimal text.
    #[schema(pattern = "^[1-9][0-9]{0,18}$", max_length = 19)]
    pub expires_at: String,
}
impl TryFrom<CanonicalOperationRequest> for CanonicalOperation {
    type Error = OperationError;
    fn try_from(v: CanonicalOperationRequest) -> Result<Self, Self::Error> {
        Ok(Self {
            version: v.version,
            purpose: v.purpose.into(),
            action: v.action.into(),
            account_id: v.account_id,
            environment_id: v.environment_id,
            destination: v.destination,
            recipients: v.recipients,
            material: v.material,
            material_digest: v.material_digest,
            attachments: v.attachments.into_iter().map(Into::into).collect(),
            resource_id: v.resource_id,
            resource_version: v.resource_version,
            expires_at: positive_decimal(&v.expires_at)? as i64,
        })
    }
}
impl From<CanonicalOperation> for CanonicalOperationRequest {
    fn from(v: CanonicalOperation) -> Self {
        Self {
            version: v.version,
            purpose: v.purpose.into(),
            action: v.action.into(),
            account_id: v.account_id,
            environment_id: v.environment_id,
            destination: v.destination,
            recipients: v.recipients,
            material: v.material,
            material_digest: v.material_digest,
            attachments: v.attachments.into_iter().map(Into::into).collect(),
            resource_id: v.resource_id,
            resource_version: v.resource_version,
            expires_at: v.expires_at.to_string(),
        }
    }
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct OperationDecisionRequest {
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub key: String,
    #[schema(pattern = "^[1-9][0-9]{0,18}$", max_length = 19)]
    pub expected_revision: String,
    /// The complete request read and reviewed by this actor. Any material change refuses.
    pub request: CanonicalOperationRequest,
    /// Decision expiry cannot exceed request expiry. Positive Unix seconds as decimal text.
    #[schema(pattern = "^[1-9][0-9]{0,18}$", max_length = 19)]
    pub expires_at: String,
    /// False records an exact refusal; true cannot override a hard prohibition.
    pub allow: bool,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum OperationStateResponse {
    NeedsDecision,
    Ready,
    PossiblyDispatched,
    Accepted,
    Completed,
    Absent,
    Revoked,
}
impl From<OperationState> for OperationStateResponse {
    fn from(v: OperationState) -> Self {
        match v {
            OperationState::NeedsDecision => Self::NeedsDecision,
            OperationState::Ready => Self::Ready,
            OperationState::PossiblyDispatched => Self::PossiblyDispatched,
            OperationState::Accepted => Self::Accepted,
            OperationState::Completed => Self::Completed,
            OperationState::Absent => Self::Absent,
            OperationState::Revoked => Self::Revoked,
        }
    }
}
#[derive(Serialize, ToSchema)]
pub struct OperationResponse {
    pub id: String,
    pub task_id: String,
    pub cycle_id: String,
    /// Immutable producing actor; the reading or deciding actor does not replace it.
    pub actor_id: String,
    /// Immutable producing Task epoch; methodology history identifies its exact criteria.
    #[schema(pattern = "^(0|[1-9][0-9]{0,18})$", max_length = 19)]
    pub execution_epoch: String,
    /// Exact immutable Task methodology binding used by the producer.
    pub methodology_binding_id: String,
    pub request: CanonicalOperationRequest,
    #[schema(min_length = 64, max_length = 64, pattern = "^[a-f0-9]{64}$")]
    pub request_digest: String,
    #[schema(pattern = "^[1-9][0-9]{0,18}$", max_length = 19)]
    pub revision: String,
    /// Provider acceptance is distinct from a completed effect; possible dispatch remains uncertain.
    pub state: OperationStateResponse,
}
impl From<Operation> for OperationResponse {
    fn from(v: Operation) -> Self {
        Self {
            id: v.id,
            task_id: v.task_id,
            cycle_id: v.cycle_id,
            actor_id: v.actor_id,
            execution_epoch: v.execution_epoch.to_string(),
            methodology_binding_id: v.methodology_binding_id,
            request: v.request.into(),
            request_digest: v.request_digest,
            revision: v.revision.to_string(),
            state: v.state.into(),
        }
    }
}
#[derive(Serialize, ToSchema)]
pub struct OperationsResponse {
    #[schema(max_items = 50)]
    pub operations: Vec<OperationResponse>,
    /// Exclusive operation ID; null means no further rows for this exact Task.
    #[schema(required = true)]
    pub next_cursor: Option<String>,
}
#[derive(Serialize, ToSchema)]
pub struct OperationDecisionResponse {
    pub id: String,
    pub operation_id: String,
    pub actor_id: String,
    #[schema(min_length = 64, max_length = 64, pattern = "^[a-f0-9]{64}$")]
    pub request_digest: String,
    #[schema(pattern = "^[1-9][0-9]{0,18}$", max_length = 19)]
    pub expected_revision: String,
    #[schema(pattern = "^[1-9][0-9]{0,18}$", max_length = 19)]
    pub expires_at: String,
    pub allowed: bool,
}
impl From<OperationDecision> for OperationDecisionResponse {
    fn from(v: OperationDecision) -> Self {
        Self {
            id: v.id,
            operation_id: v.operation_id,
            actor_id: v.actor_id,
            request_digest: v.request_digest,
            expected_revision: v.expected_revision.to_string(),
            expires_at: v.expires_at.to_string(),
            allowed: v.allowed,
        }
    }
}

#[derive(Clone, Copy, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PolicyKindRequest {
    Organisation,
    Engagement,
    Member,
    Account,
    Task,
    Delegation,
}
impl From<PolicyKindRequest> for PolicyKind {
    fn from(v: PolicyKindRequest) -> Self {
        match v {
            PolicyKindRequest::Organisation => Self::Organisation,
            PolicyKindRequest::Engagement => Self::Engagement,
            PolicyKindRequest::Member => Self::Member,
            PolicyKindRequest::Account => Self::Account,
            PolicyKindRequest::Task => Self::Task,
            PolicyKindRequest::Delegation => Self::Delegation,
        }
    }
}
impl From<PolicyKind> for PolicyKindRequest {
    fn from(v: PolicyKind) -> Self {
        match v {
            PolicyKind::Organisation => Self::Organisation,
            PolicyKind::Engagement => Self::Engagement,
            PolicyKind::Member => Self::Member,
            PolicyKind::Account => Self::Account,
            PolicyKind::Task => Self::Task,
            PolicyKind::Delegation => Self::Delegation,
        }
    }
}
#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct PermissionRevocationRequest {
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub key: String,
    pub kind: PolicyKindRequest,
    #[schema(pattern = "^[1-9][0-9]{0,18}$", max_length = 19)]
    pub expected_version: String,
}
#[derive(Serialize, ToSchema)]
pub struct PermissionRevocationResponse {
    pub kind: PolicyKindRequest,
    pub subject_id: String,
    #[schema(pattern = "^[1-9][0-9]{0,18}$", max_length = 19)]
    pub version: String,
}
impl From<PolicyReference> for PermissionRevocationResponse {
    fn from(v: PolicyReference) -> Self {
        Self {
            kind: v.kind.into(),
            subject_id: v.subject_id,
            version: v.version.to_string(),
        }
    }
}

#[derive(Serialize, ToSchema)]
pub struct DecisionHistoryResponse {
    /// Exact persisted decision key, scoped to the recorded actor and engagement.
    pub key: String,
    pub decision: OperationDecisionResponse,
    /// Server recording time, positive Unix seconds as decimal text.
    #[schema(pattern = "^[1-9][0-9]{0,18}$", max_length = 19)]
    pub recorded_at: String,
}
impl From<DecisionHistoryEntry> for DecisionHistoryResponse {
    fn from(v: DecisionHistoryEntry) -> Self {
        Self {
            key: v.key,
            decision: v.decision.into(),
            recorded_at: v.recorded_at.to_string(),
        }
    }
}
#[derive(Serialize, ToSchema)]
pub struct AttemptHistoryResponse {
    pub id: String,
    pub operation_id: String,
    #[schema(pattern = "^[1-9][0-9]{0,18}$", max_length = 19)]
    pub number: String,
    #[schema(pattern = "^(0|[1-9][0-9]{0,18})$", max_length = 19)]
    pub execution_epoch: String,
    /// Exact immutable binding effective when this attempt was admitted.
    pub methodology_binding_id: String,
    #[schema(min_length = 64, max_length = 64, pattern = "^[a-f0-9]{64}$")]
    pub request_digest: String,
    #[schema(pattern = "^[1-9][0-9]{0,18}$", max_length = 19)]
    pub recorded_at: String,
    /// Non-secret logical source identity; never an endpoint URL or capability.
    #[schema(required = true)]
    pub source_id: Option<String>,
    /// Non-secret source ledger identity bound when this attempt was admitted.
    #[schema(required = true)]
    pub ledger_id: Option<String>,
}
impl From<AttemptHistoryEntry> for AttemptHistoryResponse {
    fn from(v: AttemptHistoryEntry) -> Self {
        Self {
            id: v.id,
            operation_id: v.operation_id,
            number: v.number.to_string(),
            execution_epoch: v.execution_epoch.to_string(),
            methodology_binding_id: v.methodology_binding_id,
            request_digest: v.request_digest,
            recorded_at: v.recorded_at.to_string(),
            source_id: v.source_id,
            ledger_id: v.ledger_id,
        }
    }
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SourceFactResponse {
    Unknown,
    Accepted,
    Completed,
    AuthoritativelyAbsent,
}
impl From<SourceFact> for SourceFactResponse {
    fn from(v: SourceFact) -> Self {
        match v {
            SourceFact::Unknown => Self::Unknown,
            SourceFact::Accepted => Self::Accepted,
            SourceFact::Completed => Self::Completed,
            SourceFact::AuthoritativelyAbsent => Self::AuthoritativelyAbsent,
        }
    }
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ObservationSourceResponse {
    Dispatch,
    Reconciliation,
}
impl From<ObservationSource> for ObservationSourceResponse {
    fn from(v: ObservationSource) -> Self {
        match v {
            ObservationSource::Dispatch => Self::Dispatch,
            ObservationSource::Reconciliation => Self::Reconciliation,
        }
    }
}
#[derive(Serialize, ToSchema)]
pub struct ObservationHistoryResponse {
    pub id: String,
    pub attempt_id: String,
    /// A recorded source fact. Unknown or Accepted proves neither completion nor absence.
    pub fact: SourceFactResponse,
    pub source: ObservationSourceResponse,
    #[schema(pattern = "^[1-9][0-9]{0,18}$", max_length = 19)]
    pub recorded_at: String,
}
impl From<ObservationHistoryEntry> for ObservationHistoryResponse {
    fn from(v: ObservationHistoryEntry) -> Self {
        Self {
            id: v.id,
            attempt_id: v.attempt_id,
            fact: v.fact.into(),
            source: v.source.into(),
            recorded_at: v.recorded_at.to_string(),
        }
    }
}
#[derive(Serialize, ToSchema)]
pub struct OperationHistoryResponse {
    pub operation_id: String,
    /// Immutable decisions in ID order, including the persisted decider and exact expiry.
    #[schema(max_items = 50)]
    pub decisions: Vec<DecisionHistoryResponse>,
    #[schema(max_items = 50)]
    pub attempts: Vec<AttemptHistoryResponse>,
    #[schema(max_items = 50)]
    pub observations: Vec<ObservationHistoryResponse>,
    /// Exclusive decision ID; null means this fresh page exhausted that collection.
    #[schema(required = true)]
    pub decision_next_cursor: Option<String>,
    /// Exclusive attempt ID; each history collection has its own continuation.
    #[schema(required = true)]
    pub attempt_next_cursor: Option<String>,
    /// Exclusive observation ID. Restart from the first page to discover new records.
    #[schema(required = true)]
    pub observation_next_cursor: Option<String>,
}
impl From<OperationHistory> for OperationHistoryResponse {
    fn from(v: OperationHistory) -> Self {
        Self {
            operation_id: v.operation_id,
            decisions: v.decisions.into_iter().map(Into::into).collect(),
            attempts: v.attempts.into_iter().map(Into::into).collect(),
            observations: v.observations.into_iter().map(Into::into).collect(),
            decision_next_cursor: v.decision_next_cursor,
            attempt_next_cursor: v.attempt_next_cursor,
            observation_next_cursor: v.observation_next_cursor,
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ScopeQuery {
    organisation_id: String,
    client_id: String,
}
impl ScopeQuery {
    fn scope(self, engagement_id: String) -> Result<Scope, OperationError> {
        let scope = Scope {
            organisation_id: self.organisation_id,
            client_id: self.client_id,
            engagement_id,
        };
        if scope.is_valid() {
            Ok(scope)
        } else {
            Err(OperationError::Denied)
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ListQuery {
    organisation_id: String,
    client_id: String,
    task_id: String,
    after_operation_id: Option<String>,
}

async fn mutation_scope(
    state: &OperationHttpState,
    headers: &HeaderMap,
    engagement_id: String,
    query: Result<Query<ScopeQuery>, QueryRejection>,
) -> Result<(String, Scope), IdentityError> {
    let current = state.identity.current(headers).await?;
    if !expected_actor_matches(headers, &current.identity.id)
        || !state
            .identity
            .permits_mutation(headers, &current.csrf_token)
    {
        return Err(IdentityError::Denied);
    }
    let scope = query
        .map_err(|_| IdentityError::Denied)?
        .0
        .scope(engagement_id)
        .map_err(|_| IdentityError::Denied)?;
    Ok((current.identity.id, scope))
}
#[utoipa::path(post,path="/engagements/{engagement_id}/operations/{operation_id}/decisions",operation_id="decide_operation",security(("server_session"=[])),params(("engagement_id"=String,Path),("organisation_id"=String,Query),("client_id"=String,Query),("Origin"=String,Header,description="Exact configured HTTPS application origin"),("X-CSRF-Token"=String,Header,description="Current session-bound token"),("X-Expected-Actor"=String,Header,description="Required refusal fence for the current session actor; never supplies author authority",min_length=1,max_length=128,pattern="^[A-Za-z0-9_-]+$"),("operation_id"=String,Path)),request_body=OperationDecisionRequest,responses((status=200,body=OperationDecisionResponse),(status=400,body=ErrorResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=409,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn decide(
    State(state): State<OperationHttpState>,
    headers: HeaderMap,
    path: Result<Path<(String, String)>, PathRejection>,
    query: Result<Query<ScopeQuery>, QueryRejection>,
    body: Result<Json<OperationDecisionRequest>, JsonRejection>,
) -> Response {
    let Path((engagement_id, operation_id)) = match path {
        Ok(path) => path,
        Err(_) => return failure(OperationError::Invalid),
    };
    let (actor, scope) = match mutation_scope(&state, &headers, engagement_id, query).await {
        Ok(v) => v,
        Err(e) => return crate::auth::failure(e),
    };
    if !valid_scope_id(&operation_id) {
        return failure(OperationError::Invalid);
    }
    let command = (|| {
        let Json(body) = body.map_err(|_| OperationError::Invalid)?;
        Ok::<_, OperationError>(DecisionCommand {
            key: body.key,
            operation_id,
            expected_revision: positive_decimal(&body.expected_revision)?,
            request: body.request.try_into()?,
            expires_at: positive_decimal(&body.expires_at)? as i64,
            allow: body.allow,
        })
    })();
    let command = match command {
        Ok(v) => v,
        Err(e) => return failure(e),
    };
    match state.repository.decide(&actor, &scope, &command).await {
        Ok(value) => Json(OperationDecisionResponse::from(value)).into_response(),
        Err(error) => failure(error),
    }
}
#[utoipa::path(post,path="/engagements/{engagement_id}/permissions/{authority_id}/revoke",operation_id="revoke_permission",security(("server_session"=[])),params(("engagement_id"=String,Path),("organisation_id"=String,Query),("client_id"=String,Query),("Origin"=String,Header,description="Exact configured HTTPS application origin"),("X-CSRF-Token"=String,Header,description="Current session-bound token"),("X-Expected-Actor"=String,Header,description="Required refusal fence for the current session actor; never supplies author authority",min_length=1,max_length=128,pattern="^[A-Za-z0-9_-]+$"),("authority_id"=String,Path)),request_body=PermissionRevocationRequest,responses((status=200,body=PermissionRevocationResponse),(status=400,body=ErrorResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=409,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn revoke(
    State(state): State<OperationHttpState>,
    headers: HeaderMap,
    path: Result<Path<(String, String)>, PathRejection>,
    query: Result<Query<ScopeQuery>, QueryRejection>,
    body: Result<Json<PermissionRevocationRequest>, JsonRejection>,
) -> Response {
    let Path((engagement_id, authority_id)) = match path {
        Ok(path) => path,
        Err(_) => return failure(OperationError::Invalid),
    };
    let (actor, scope) = match mutation_scope(&state, &headers, engagement_id, query).await {
        Ok(v) => v,
        Err(e) => return crate::auth::failure(e),
    };
    if !valid_scope_id(&authority_id) {
        return failure(OperationError::Invalid);
    }
    let command = (|| {
        let Json(body) = body.map_err(|_| OperationError::Invalid)?;
        Ok::<_, OperationError>(RevocationCommand {
            key: body.key,
            kind: body.kind.into(),
            subject_id: authority_id,
            expected_version: positive_decimal(&body.expected_version)?,
        })
    })();
    let command = match command {
        Ok(v) => v,
        Err(e) => return failure(e),
    };
    match state.repository.revoke(&actor, &scope, &command).await {
        Ok(value) => Json(PermissionRevocationResponse::from(value)).into_response(),
        Err(error) => failure(error),
    }
}
#[utoipa::path(get,path="/engagements/{engagement_id}/operations/{operation_id}",operation_id="get_operation",security(("server_session"=[])),params(("engagement_id"=String,Path),("organisation_id"=String,Query),("client_id"=String,Query),("X-Expected-Session"=Option<String>,Header,description="Optional current session-bound CSRF read precondition; mismatch refuses without changing cookies",min_length=1,max_length=128),("operation_id"=String,Path)),responses((status=200,body=OperationResponse),(status=400,body=ErrorResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=409,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse),(status=412,description="Session changed; refresh composed reads without replacing the cookie",body=ErrorResponse)))]
pub(crate) async fn get(
    State(state): State<OperationHttpState>,
    headers: HeaderMap,
    path: Result<Path<(String, String)>, PathRejection>,
    query: Result<Query<ScopeQuery>, QueryRejection>,
) -> Response {
    let Path((engagement_id, operation_id)) = match path {
        Ok(path) => path,
        Err(_) => return failure(OperationError::Invalid),
    };
    let current = match state.identity.current_read(&headers).await {
        Ok(v) => v,
        Err(e) => return crate::auth::failure(e),
    };
    let scope = match query
        .map_err(|_| OperationError::Denied)
        .and_then(|Query(q)| q.scope(engagement_id))
    {
        Ok(v) => v,
        Err(e) => return failure(e),
    };
    if !valid_scope_id(&operation_id) {
        return failure(OperationError::Denied);
    }
    match state
        .repository
        .get(&current.identity.id, &scope, &operation_id)
        .await
    {
        Ok(value) => Json(OperationResponse::from(value)).into_response(),
        Err(error) => failure(error),
    }
}
#[utoipa::path(get,path="/engagements/{engagement_id}/operations",operation_id="list_operations",security(("server_session"=[])),params(("engagement_id"=String,Path),("organisation_id"=String,Query),("client_id"=String,Query),("X-Expected-Session"=Option<String>,Header,description="Optional current session-bound CSRF read precondition; mismatch refuses without changing cookies",min_length=1,max_length=128),("task_id"=String,Query,description="Exact Task whose operation history is requested"),("after_operation_id"=Option<String>,Query,description="Exclusive operation ID from next_cursor")),responses((status=200,body=OperationsResponse),(status=400,body=ErrorResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=409,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse),(status=412,description="Session changed; refresh composed reads without replacing the cookie",body=ErrorResponse)))]
pub(crate) async fn list(
    State(state): State<OperationHttpState>,
    headers: HeaderMap,
    path: Result<Path<String>, PathRejection>,
    query: Result<Query<ListQuery>, QueryRejection>,
) -> Response {
    let Path(engagement_id) = match path {
        Ok(path) => path,
        Err(_) => return failure(OperationError::Invalid),
    };
    let current = match state.identity.current_read(&headers).await {
        Ok(v) => v,
        Err(e) => return crate::auth::failure(e),
    };
    let Query(query) = match query {
        Ok(v) => v,
        Err(_) => return failure(OperationError::Invalid),
    };
    if !valid_scope_id(&query.task_id)
        || query
            .after_operation_id
            .as_deref()
            .is_some_and(|v| !valid_scope_id(v))
    {
        return failure(OperationError::Invalid);
    }
    let scope = match (ScopeQuery {
        organisation_id: query.organisation_id,
        client_id: query.client_id,
    })
    .scope(engagement_id)
    {
        Ok(v) => v,
        Err(e) => return failure(e),
    };
    match state
        .repository
        .list(
            &current.identity.id,
            &scope,
            &query.task_id,
            query.after_operation_id.as_deref(),
        )
        .await
    {
        Ok(page) => Json(OperationsResponse {
            operations: page.operations.into_iter().map(Into::into).collect(),
            next_cursor: page.next_cursor,
        })
        .into_response(),
        Err(error) => failure(error),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct HistoryQuery {
    organisation_id: String,
    client_id: String,
    after_decision_id: Option<String>,
    after_attempt_id: Option<String>,
    after_observation_id: Option<String>,
}
#[utoipa::path(get,path="/engagements/{engagement_id}/operations/{operation_id}/history",operation_id="get_operation_history",security(("server_session"=[])),
    params(("engagement_id"=String,Path),("operation_id"=String,Path),("organisation_id"=String,Query),("client_id"=String,Query),
        ("X-Expected-Session"=Option<String>,Header,description="Optional current session-bound CSRF read precondition; mismatch refuses without changing cookies",min_length=1,max_length=128),
        ("after_decision_id"=Option<String>,Query,description="Exclusive decision ID from decision_next_cursor",min_length=1,max_length=128,pattern="^[A-Za-z0-9_-]+$"),
        ("after_attempt_id"=Option<String>,Query,description="Exclusive attempt ID from attempt_next_cursor",min_length=1,max_length=128,pattern="^[A-Za-z0-9_-]+$"),
        ("after_observation_id"=Option<String>,Query,description="Exclusive observation ID from observation_next_cursor",min_length=1,max_length=128,pattern="^[A-Za-z0-9_-]+$")),
    responses((status=200,description="Fresh authenticated history: up to50 immutable records per independent collection, ordered by ID; restart pages to discover newly recorded facts",body=OperationHistoryResponse),
        (status=400,body=ErrorResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=412,description="Session changed; refresh reads without replacing the cookie",body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn history(
    State(state): State<OperationHttpState>,
    headers: HeaderMap,
    path: Result<Path<(String, String)>, PathRejection>,
    query: Result<Query<HistoryQuery>, QueryRejection>,
) -> Response {
    let Path((engagement_id, operation_id)) = match path {
        Ok(v) => v,
        Err(_) => return failure(OperationError::Invalid),
    };
    let current = match state.identity.current_read(&headers).await {
        Ok(v) => v,
        Err(e) => return crate::auth::failure(e),
    };
    let Query(query) = match query {
        Ok(v) => v,
        Err(_) => return failure(OperationError::Invalid),
    };
    let scope = match (ScopeQuery {
        organisation_id: query.organisation_id,
        client_id: query.client_id,
    })
    .scope(engagement_id)
    {
        Ok(v) => v,
        Err(e) => return failure(e),
    };
    let query = OperationHistoryQuery {
        after_decision_id: query.after_decision_id,
        after_attempt_id: query.after_attempt_id,
        after_observation_id: query.after_observation_id,
    };
    if !valid_scope_id(&operation_id) || !query.is_valid() {
        return failure(OperationError::Invalid);
    }
    match state
        .repository
        .history(&current.identity.id, &scope, &operation_id, &query)
        .await
    {
        Ok(value) => Json(OperationHistoryResponse::from(value)).into_response(),
        Err(error) => failure(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    #[test]
    fn actor_fence_is_required_unique_and_never_adopts_another_actor() {
        let mut headers = HeaderMap::new();
        assert!(!expected_actor_matches(&headers, "actor-a"));
        headers.insert("x-expected-actor", HeaderValue::from_static("actor-a"));
        assert!(expected_actor_matches(&headers, "actor-a"));
        assert!(!expected_actor_matches(&headers, "actor-b"));
        headers.append("x-expected-actor", HeaderValue::from_static("actor-a"));
        assert!(!expected_actor_matches(&headers, "actor-a"));
        for value in ["", "bad actor", &"a".repeat(129)] {
            headers.insert("x-expected-actor", HeaderValue::from_str(value).unwrap());
            assert!(!expected_actor_matches(&headers, value));
        }
    }

    #[test]
    fn decimal_wire_authority_is_lossless_and_unambiguous() {
        for value in ["1", "9007199254740993", "9223372036854775807"] {
            assert_eq!(positive_decimal(value).unwrap().to_string(), value);
        }
        for value in [
            "",
            "0",
            "01",
            "-1",
            "+1",
            "1.0",
            "1e3",
            " 1",
            "9223372036854775808",
            "18446744073709551616",
        ] {
            assert!(positive_decimal(value).is_err(), "{value}");
        }
    }
}
