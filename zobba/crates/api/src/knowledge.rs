//! Freshly authorised scoped working context; records and receipts grant no execution authority.
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
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use std::{sync::Arc, time::Duration};
use tokio::sync::Semaphore;
use utoipa::ToSchema;
use zobba_application::{
    identity::CurrentSession,
    knowledge::{self as application, KnowledgeError, KnowledgeStore},
};
use zobba_domain::identity::{Scope, valid_scope_id};
use zobba_infrastructure::{
    evidence::{EvidenceRepository, s3::S3EvidenceObjects},
    identity::secret_hash,
    knowledge::KnowledgeRepository,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum KnowledgeScopeKind {
    Personal,
    Firm,
    Client,
    Engagement,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct KnowledgeScope {
    pub kind: KnowledgeScopeKind,
    pub organisation_id: String,
    pub client_id: Option<String>,
    pub engagement_id: Option<String>,
    pub owner_id: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct KnowledgePeriod {
    pub start: Option<String>,
    pub end: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum KnowledgeKind {
    Decision,
    Observation,
    Assertion,
    Preference,
    PublishedPreference,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Certainty {
    UserDirected,
    SourceStates,
    Asserted,
    Learned,
    ExplicitPreference,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum KnowledgeRecordStatus {
    Current,
    Corrected,
    Excluded,
    Forgotten,
    Invalidated,
    Withdrawn,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct KnowledgeRecordReference {
    pub id: String,
    #[schema(pattern = "^(0|[1-9][0-9]*)$")]
    pub revision: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum KnowledgeDependency {
    Evidence {
        evidence_id: String,
        storage_version: String,
        digest: String,
        scope: KnowledgeScope,
    },
    Guide {
        command_id: String,
        task_id: String,
        cycle_id: String,
        scope: KnowledgeScope,
    },
    Knowledge {
        id: String,
        #[schema(pattern = "^(0|[1-9][0-9]*)$")]
        revision: String,
        scope: KnowledgeScope,
    },
    Methodology {
        version_id: String,
    },
    Skill {
        selection_id: String,
        task_id: String,
    },
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct KnowledgeSourceLocation {
    pub evidence_id: String,
    pub storage_version: String,
    pub digest: String,
    pub byte_start: u64,
    pub byte_end: u64,
    pub original_size: u64,
    pub partial: bool,
    pub field_path: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct KnowledgeDirectionBasis {
    pub command_id: String,
    pub task_id: String,
    pub cycle_id: String,
    pub standing: String,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum KnowledgeInspectionLayout {
    Standard,
    Expanded,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct KnowledgePreferenceBasis {
    pub name: String,
    pub value: KnowledgeInspectionLayout,
    pub inferred: bool,
    pub rule: Option<String>,
    pub observation_ids: Vec<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct KnowledgeRecord {
    pub id: String,
    #[schema(pattern = "^(0|[1-9][0-9]*)$")]
    pub revision: String,
    pub actor_id: String,
    pub recorded_at: i64,
    pub scope: KnowledgeScope,
    pub kind: KnowledgeKind,
    #[schema(max_length = 16384)]
    pub text: String,
    pub period: KnowledgePeriod,
    pub certainty: Certainty,
    pub uncertainty: Option<String>,
    #[schema(max_items = 32)]
    pub dependencies: Vec<KnowledgeDependency>,
    pub source: Option<KnowledgeSourceLocation>,
    pub direction: Option<KnowledgeDirectionBasis>,
    pub preference: Option<KnowledgePreferenceBasis>,
    pub supersedes: Option<KnowledgeRecordReference>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct KnowledgeView {
    pub record: KnowledgeRecord,
    pub status: KnowledgeRecordStatus,
    pub status_reason: Option<String>,
    pub can_correct: bool,
    pub can_exclude: bool,
    pub can_forget: bool,
    pub can_reuse: bool,
    pub can_undo: bool,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum KnowledgeOmission {
    UnsupportedFormat,
    UnknownPeriod,
    OutsidePeriod,
    InvalidatedSupport,
    CaptureCapacity,
    LegacyNotCaptured,
    PartialSource,
    BoundedPage,
    ScanLimit,
    UnavailableSupport,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct KnowledgeQuery {
    /// Exclusive last-disclosed record or publication ID in C order; omitted starts at the first candidate. Use next_after unchanged. No cursor is disclosed when no eligible item is returned.
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub after: Option<String>,
    /// Case-insensitive Unicode lowercase substring match on authorized, applicable record text, without trimming. Empty text matches any eligible record. At most 200 Unicode scalar values; C0/C1 controls are refused.
    #[schema(max_length = 200, pattern = r"^[^\u0000-\u001F\u007F-\u009F]*$")]
    pub text: Option<String>,
    /// False by default. True includes authorized inactive history; it never bypasses current source authority or period applicability.
    #[schema(default = false)]
    pub include_inactive: bool,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct KnowledgePage {
    pub task_id: String,
    #[schema(pattern = "^(0|[1-9][0-9]*)$")]
    pub revision: String,
    #[schema(pattern = "^(0|[1-9][0-9]*)$")]
    pub execution_epoch: String,
    pub methodology_binding_id: String,
    #[schema(max_items = 50)]
    pub items: Vec<KnowledgeView>,
    pub next_after: Option<String>,
    pub omissions: Vec<KnowledgeOmission>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct KnowledgeAssertion {
    #[schema(max_length = 16384)]
    pub text: String,
    pub period: KnowledgePeriod,
    pub uncertainty: Option<String>,
    #[schema(max_items = 32)]
    pub dependencies: Vec<KnowledgeDependency>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum KnowledgeAction {
    Assert {
        assertion: KnowledgeAssertion,
    },
    Correct {
        target: KnowledgeRecordReference,
        assertion: KnowledgeAssertion,
        reason: String,
    },
    Exclude {
        target: KnowledgeRecordReference,
        reason: String,
    },
    Forget {
        target: KnowledgeRecordReference,
        reason: String,
    },
    Reuse {
        target: KnowledgeRecordReference,
        destination_engagement_id: String,
        destination_task_id: String,
        reason: String,
    },
    CorrectSource {
        predecessor_id: String,
        replacement_id: String,
        #[schema(pattern = "^(0|[1-9][0-9]*)$")]
        expected_source_revision: String,
        reason: String,
    },
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct KnowledgeCommand {
    pub key: String,
    #[schema(pattern = "^(0|[1-9][0-9]*)$")]
    pub expected_revision: String,
    pub action: KnowledgeAction,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct KnowledgeReceipt {
    pub event_id: String,
    #[schema(pattern = "^(0|[1-9][0-9]*)$")]
    pub revision: String,
    pub record: Option<KnowledgeView>,
    pub affected_ids: Vec<String>,
    pub affected_destinations: Vec<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct KnowledgeObserveLayout {
    pub key: String,
    #[schema(pattern = "^(0|[1-9][0-9]*)$")]
    pub expected_revision: String,
    pub opening_id: String,
    pub value: KnowledgeInspectionLayout,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum KnowledgePreferenceAction {
    Save {
        value: KnowledgeInspectionLayout,
    },
    Undo {
        target: KnowledgeRecordReference,
    },
    Publish {
        target: KnowledgeRecordReference,
        client_id: String,
        engagement_id: String,
    },
    Withdraw {
        publication_id: String,
    },
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct KnowledgePreferenceCommand {
    pub key: String,
    #[schema(pattern = "^(0|[1-9][0-9]*)$")]
    pub expected_revision: String,
    pub action: KnowledgePreferenceAction,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct KnowledgePreferenceSnapshot {
    pub organisation_id: String,
    pub owner_id: String,
    #[schema(pattern = "^(0|[1-9][0-9]*)$")]
    pub revision: String,
    pub current: Option<KnowledgeView>,
    pub publications: Vec<KnowledgeView>,
    #[schema(pattern = "^(0|[1-9][0-9]*)$")]
    pub consumed_through: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct KnowledgeCaptureExcerpt {
    pub key: String,
    pub evidence_id: String,
    pub byte_start: u64,
    pub byte_end: u64,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct KnowledgeRecoveryRequest {
    pub key: String,
}

#[derive(Clone)]
pub(crate) struct KnowledgeState {
    identity: AuthState,
    repository: KnowledgeRepository,
    evidence: EvidenceRepository,
    objects: Option<Arc<S3EvidenceObjects>>,
}

pub(crate) fn router(
    pool: sqlx::PgPool,
    identity: AuthState,
    objects: Option<Arc<S3EvidenceObjects>>,
) -> Router {
    let capacity = Arc::new(Semaphore::new(4));
    let io_capacity = Arc::new(Semaphore::new(2));
    let io = Router::new()
        .route(
            "/engagements/{engagement_id}/knowledge/excerpts",
            post(excerpt),
        )
        .route(
            "/engagements/{engagement_id}/knowledge/evidence/{evidence_id}/recover",
            post(recover),
        )
        .layer(axum::middleware::from_fn(
            move |request: axum::extract::Request, next: axum::middleware::Next| {
                let capacity = io_capacity.clone();
                async move {
                    let Ok(_permit) = capacity.try_acquire_owned() else {
                        return failure(KnowledgeError::Capacity);
                    };
                    match tokio::time::timeout(Duration::from_secs(120), next.run(request)).await {
                        Ok(response) => response,
                        Err(_) => failure(KnowledgeError::Unavailable),
                    }
                }
            },
        ));
    Router::new()
        .route("/knowledge/organisations/{organisation_id}/preference/verify",post(verify_preference))
        .route("/engagements/{engagement_id}/knowledge/evidence/{evidence_id}/verify",post(verify_source))
        .route("/engagements/{engagement_id}/knowledge/evidence/{evidence_id}",get(source_status))
        .route("/engagements/{engagement_id}/tasks/{task_id}/knowledge/verify", post(verify))
        .route("/engagements/{engagement_id}/tasks/{task_id}/knowledge", get(inspect))
        .route("/engagements/{engagement_id}/tasks/{task_id}/knowledge/records/{record_id}/revisions/{revision}", get(exact))
        .route("/engagements/{engagement_id}/tasks/{task_id}/knowledge/commands", post(mutate))
        .route("/knowledge/organisations/{organisation_id}/preference", get(preference).post(mutate_preference))
        .route("/knowledge/organisations/{organisation_id}/preference/observations", post(observe_layout))
        .layer(axum::middleware::from_fn(move |request: axum::extract::Request,next: axum::middleware::Next| {
            let capacity=capacity.clone();
            async move { let Ok(_permit)=capacity.try_acquire_owned() else { return failure(KnowledgeError::Capacity); };
                match tokio::time::timeout(Duration::from_secs(6),next.run(request)).await { Ok(response)=>response,Err(_)=>failure(KnowledgeError::Unavailable) }
            }
        }))
        .merge(io)
        .layer(DefaultBodyLimit::max(256 * 1024))
        .with_state(KnowledgeState { identity,repository:KnowledgeRepository::new(pool.clone()),evidence:EvidenceRepository::new(pool),objects })
}

fn failure(error: KnowledgeError) -> Response {
    let status = match error {
        KnowledgeError::Invalid => StatusCode::BAD_REQUEST,
        KnowledgeError::Denied => StatusCode::FORBIDDEN,
        KnowledgeError::Conflict | KnowledgeError::Ineligible | KnowledgeError::Cycle => {
            StatusCode::CONFLICT
        }
        KnowledgeError::Capacity => StatusCode::TOO_MANY_REQUESTS,
        KnowledgeError::Unavailable => StatusCode::SERVICE_UNAVAILABLE,
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
    Knowledge(KnowledgeError),
}
impl IntoResponse for AuthenticationFailure {
    fn into_response(self) -> Response {
        match self {
            Self::Identity(error) => auth::failure(error),
            Self::Knowledge(error) => failure(error),
        }
    }
}
async fn current(
    state: &KnowledgeState,
    headers: &HeaderMap,
    mutation: bool,
) -> Result<(CurrentSession, KnowledgeRepository, EvidenceRepository), AuthenticationFailure> {
    let session = state
        .identity
        .current_read(headers)
        .await
        .map_err(AuthenticationFailure::Identity)?;
    if mutation {
        let mut actors = headers.get_all("x-expected-actor").iter();
        if actors.next().and_then(|v| v.to_str().ok()) != Some(session.identity.id.as_str())
            || actors.next().is_some()
            || !state
                .identity
                .permits_mutation(headers, &session.csrf_token)
        {
            return Err(AuthenticationFailure::Knowledge(KnowledgeError::Denied));
        }
    }
    let token = auth::cookie(headers, auth::SESSION_COOKIE)
        .ok_or(AuthenticationFailure::Knowledge(KnowledgeError::Denied))?;
    let hash = secret_hash(&token);
    Ok((
        session,
        state.repository.clone().with_session_hash(hash.clone()),
        state.evidence.clone().with_session_hash(hash),
    ))
}

fn revision(value: &str) -> Result<u64, KnowledgeError> {
    let parsed = value.parse::<u64>().map_err(|_| KnowledgeError::Invalid)?;
    if parsed > i64::MAX as u64 || parsed.to_string() != value {
        return Err(KnowledgeError::Invalid);
    }
    Ok(parsed)
}
const REVISIONS: &[&str] = &[
    "revision",
    "execution_epoch",
    "expected_revision",
    "expected_source_revision",
    "consumed_through",
    "source_revision",
    "capture_revision",
];
/// The HTTP numeric-string boundary is explicit and symmetric. Arbitrary prose
/// is never interpreted; only the fixed typed revision fields are translated.
fn numeric_fields(value: &mut serde_json::Value, to_browser: bool) -> Result<(), KnowledgeError> {
    match value {
        serde_json::Value::Object(fields) => {
            for (name, value) in fields {
                if REVISIONS.contains(&name.as_str()) && !value.is_null() {
                    *value = if to_browser {
                        serde_json::Value::String(
                            value
                                .as_u64()
                                .filter(|v| *v <= i64::MAX as u64)
                                .ok_or(KnowledgeError::Unavailable)?
                                .to_string(),
                        )
                    } else {
                        serde_json::Value::from(revision(
                            value.as_str().ok_or(KnowledgeError::Invalid)?,
                        )?)
                    };
                } else {
                    numeric_fields(value, to_browser)?;
                }
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                numeric_fields(item, to_browser)?;
            }
        }
        _ => {}
    }
    Ok(())
}
fn incoming<S: Serialize, T: DeserializeOwned>(source: S) -> Result<T, KnowledgeError> {
    let mut value = serde_json::to_value(source).map_err(|_| KnowledgeError::Invalid)?;
    numeric_fields(&mut value, false)?;
    serde_json::from_value(value).map_err(|_| KnowledgeError::Invalid)
}
fn outgoing<S: Serialize>(source: S) -> Response {
    let result = (|| {
        let mut value = serde_json::to_value(source).map_err(|_| KnowledgeError::Unavailable)?;
        numeric_fields(&mut value, true)?;
        // Page and source-status omissions are unique reason categories. Keep
        // this final wire invariant even if future producers combine causes.
        if let Some(omissions) = value
            .get_mut("omissions")
            .and_then(serde_json::Value::as_array_mut)
        {
            let mut seen = Vec::new();
            omissions.retain(|reason| {
                if seen.contains(reason) {
                    false
                } else {
                    seen.push(reason.clone());
                    true
                }
            });
        }
        let bytes = serde_json::to_vec(&value).map_err(|_| KnowledgeError::Unavailable)?;
        if bytes.len() > application::MAX_KNOWLEDGE_BYTES {
            return Err(KnowledgeError::Capacity);
        }
        Ok(value)
    })();
    match result {
        Ok(value) => Json(value).into_response(),
        Err(error) => failure(error),
    }
}
impl TryFrom<KnowledgeCommand> for application::KnowledgeCommand {
    type Error = KnowledgeError;
    fn try_from(value: KnowledgeCommand) -> Result<Self, Self::Error> {
        incoming(value)
    }
}
impl TryFrom<KnowledgePreferenceCommand> for application::PreferenceCommand {
    type Error = KnowledgeError;
    fn try_from(value: KnowledgePreferenceCommand) -> Result<Self, Self::Error> {
        incoming(value)
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ScopeQuery {
    organisation_id: String,
    client_id: String,
    after: Option<String>,
    text: Option<String>,
    #[serde(default)]
    include_inactive: bool,
}
fn scope(
    query: Result<Query<ScopeQuery>, QueryRejection>,
    engagement_id: String,
) -> Result<(Scope, application::KnowledgeQuery), KnowledgeError> {
    let Query(query) = query.map_err(|_| KnowledgeError::Invalid)?;
    let scope = Scope {
        organisation_id: query.organisation_id,
        client_id: query.client_id,
        engagement_id,
    };
    let query = application::KnowledgeQuery {
        after: query.after,
        text: query.text,
        include_inactive: query.include_inactive,
    };
    if !scope.is_valid() || !query.is_valid() {
        return Err(KnowledgeError::Invalid);
    }
    Ok((scope, query))
}
#[utoipa::path(
    get,
    path = "/engagements/{engagement_id}/tasks/{task_id}/knowledge",
    operation_id = "knowledge_inspect",
    description = "Returns at most 50 currently authorized views in C-ordered ID order after checking applicability and support. At most 1024 candidates are examined; scan_limit reports a partial scan, not absence. Exact record/revision lookup remains independent of page reachability.",
    security(("server_session" = [])),
    params(
        ("engagement_id" = String, Path),
        ("organisation_id" = String, Query),
        ("client_id" = String, Query),
        ("task_id" = String, Path),
        ("after" = Option<String>, Query, description = "Exclusive last-disclosed record or publication ID in C order; omitted starts at the first candidate. Use next_after unchanged. No cursor is disclosed when no eligible item is returned.", min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$"),
        ("text" = Option<String>, Query, description = "Case-insensitive Unicode lowercase substring match on authorized, applicable record text, without trimming. Empty text matches any eligible record. At most 200 Unicode scalar values; C0/C1 controls are refused.", max_length = 200, pattern = r"^[^\u0000-\u001F\u007F-\u009F]*$"),
        ("include_inactive" = Option<bool>, Query, description = "False by default. True includes authorized inactive history; it never bypasses current source authority or period applicability."),
        ("X-Expected-Session" = Option<String>, Header)
    ),
    responses((status=200,body=KnowledgePage),(status=400,body=ErrorResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=409,body=ErrorResponse),(status=412,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse))
)]
pub(crate) async fn inspect(
    State(state): State<KnowledgeState>,
    headers: HeaderMap,
    Path((engagement_id, task_id)): Path<(String, String)>,
    query: Result<Query<ScopeQuery>, QueryRejection>,
) -> Response {
    let (current, repository, _) = match current(&state, &headers, false).await {
        Ok(value) => value,
        Err(error) => return error.into_response(),
    };
    let (scope, query) = match scope(query, engagement_id) {
        Ok(value) => value,
        Err(error) => return failure(error),
    };
    if !valid_scope_id(&task_id) {
        return failure(KnowledgeError::Invalid);
    }
    match repository
        .inspect(&current.identity.id, &scope, &task_id, &query)
        .await
    {
        Ok(value) => outgoing(value),
        Err(error) => failure(error),
    }
}
#[utoipa::path(get,path="/engagements/{engagement_id}/tasks/{task_id}/knowledge/records/{record_id}/revisions/{revision}",operation_id="knowledge_exact",security(("server_session"=[])),params(("engagement_id"=String,Path),("organisation_id"=String,Query),("client_id"=String,Query),("task_id"=String,Path),("record_id"=String,Path),("revision"=String,Path),("X-Expected-Session"=Option<String>,Header)),responses((status=200,body=KnowledgeView),(status=400,body=ErrorResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=409,body=ErrorResponse),(status=412,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn exact(
    State(state): State<KnowledgeState>,
    headers: HeaderMap,
    Path((engagement_id, task_id, id, version)): Path<(String, String, String, String)>,
    query: Result<Query<ScopeQuery>, QueryRejection>,
) -> Response {
    let (current, repository, _) = match current(&state, &headers, false).await {
        Ok(value) => value,
        Err(error) => return error.into_response(),
    };
    let (scope, _query) = match scope(query, engagement_id) {
        Ok(value) => value,
        Err(error) => return failure(error),
    };
    if !valid_scope_id(&task_id) {
        return failure(KnowledgeError::Invalid);
    }
    let version = match revision(&version) {
        Ok(value) => value,
        Err(error) => return failure(error),
    };
    if !valid_scope_id(&id) {
        return failure(KnowledgeError::Invalid);
    }
    match repository
        .exact(&current.identity.id, &scope, &task_id, &id, version)
        .await
    {
        Ok(value) => outgoing(value),
        Err(error) => failure(error),
    }
}
#[utoipa::path(post,path="/engagements/{engagement_id}/tasks/{task_id}/knowledge/commands",operation_id="knowledge_mutate",security(("server_session"=[])),params(("engagement_id"=String,Path),("organisation_id"=String,Query),("client_id"=String,Query),("task_id"=String,Path),("X-Expected-Session"=Option<String>,Header),("Origin"=String,Header),("X-CSRF-Token"=String,Header),("X-Expected-Actor"=String,Header)),request_body=KnowledgeCommand,responses((status=200,body=KnowledgeReceipt),(status=400,body=ErrorResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=409,body=ErrorResponse),(status=412,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn mutate(
    State(state): State<KnowledgeState>,
    headers: HeaderMap,
    Path((engagement_id, task_id)): Path<(String, String)>,
    query: Result<Query<ScopeQuery>, QueryRejection>,
    body: Result<Json<KnowledgeCommand>, JsonRejection>,
) -> Response {
    let (current, repository, _) = match current(&state, &headers, true).await {
        Ok(value) => value,
        Err(error) => return error.into_response(),
    };
    let (scope, _query) = match scope(query, engagement_id) {
        Ok(value) => value,
        Err(error) => return failure(error),
    };
    if !valid_scope_id(&task_id) {
        return failure(KnowledgeError::Invalid);
    }
    let command: application::KnowledgeCommand = match body {
        Ok(Json(value)) => match incoming(value) {
            Ok(value) => value,
            Err(error) => return failure(error),
        },
        Err(_) => return failure(KnowledgeError::Invalid),
    };
    if !command.is_valid() {
        return failure(KnowledgeError::Invalid);
    }
    match repository
        .mutate(&current.identity.id, &scope, &task_id, &command)
        .await
    {
        Ok(value) => outgoing(value),
        Err(error) => failure(error),
    }
}
#[utoipa::path(get,path="/knowledge/organisations/{organisation_id}/preference",operation_id="knowledge_preference",security(("server_session"=[])),params(("organisation_id"=String,Path),("X-Expected-Session"=Option<String>,Header)),responses((status=200,body=KnowledgePreferenceSnapshot),(status=400,body=ErrorResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=409,body=ErrorResponse),(status=412,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn preference(
    State(state): State<KnowledgeState>,
    headers: HeaderMap,
    Path(organisation): Path<String>,
) -> Response {
    let (current, repository, _) = match current(&state, &headers, false).await {
        Ok(value) => value,
        Err(error) => return error.into_response(),
    };
    if !valid_scope_id(&organisation) {
        return failure(KnowledgeError::Invalid);
    }
    match repository
        .preference(&current.identity.id, &organisation)
        .await
    {
        Ok(value) => outgoing(value),
        Err(error) => failure(error),
    }
}
#[utoipa::path(post,path="/knowledge/organisations/{organisation_id}/preference",operation_id="knowledge_mutate_preference",security(("server_session"=[])),params(("organisation_id"=String,Path),("X-Expected-Session"=Option<String>,Header),("Origin"=String,Header),("X-CSRF-Token"=String,Header),("X-Expected-Actor"=String,Header)),request_body=KnowledgePreferenceCommand,responses((status=200,body=KnowledgeReceipt),(status=400,body=ErrorResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=409,body=ErrorResponse),(status=412,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn mutate_preference(
    State(state): State<KnowledgeState>,
    headers: HeaderMap,
    Path(organisation): Path<String>,
    body: Result<Json<KnowledgePreferenceCommand>, JsonRejection>,
) -> Response {
    let (current, repository, _) = match current(&state, &headers, true).await {
        Ok(value) => value,
        Err(error) => return error.into_response(),
    };
    if !valid_scope_id(&organisation) {
        return failure(KnowledgeError::Invalid);
    }
    let command: application::PreferenceCommand = match body {
        Ok(Json(value)) => match incoming(value) {
            Ok(value) => value,
            Err(error) => return failure(error),
        },
        Err(_) => return failure(KnowledgeError::Invalid),
    };
    if !command.is_valid() {
        return failure(KnowledgeError::Invalid);
    }
    match repository
        .mutate_preference(&current.identity.id, &organisation, &command)
        .await
    {
        Ok(value) => outgoing(value),
        Err(error) => failure(error),
    }
}
#[utoipa::path(post,path="/knowledge/organisations/{organisation_id}/preference/observations",operation_id="knowledge_observe_layout",security(("server_session"=[])),params(("organisation_id"=String,Path),("X-Expected-Session"=Option<String>,Header),("Origin"=String,Header),("X-CSRF-Token"=String,Header),("X-Expected-Actor"=String,Header)),request_body=KnowledgeObserveLayout,responses((status=200,body=KnowledgePreferenceSnapshot),(status=400,body=ErrorResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=409,body=ErrorResponse),(status=412,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn observe_layout(
    State(state): State<KnowledgeState>,
    headers: HeaderMap,
    Path(organisation): Path<String>,
    body: Result<Json<KnowledgeObserveLayout>, JsonRejection>,
) -> Response {
    let (current, repository, _) = match current(&state, &headers, true).await {
        Ok(value) => value,
        Err(error) => return error.into_response(),
    };
    if !valid_scope_id(&organisation) {
        return failure(KnowledgeError::Invalid);
    }
    let command: application::ObserveLayout = match body {
        Ok(Json(value)) => match incoming(value) {
            Ok(value) => value,
            Err(error) => return failure(error),
        },
        Err(_) => return failure(KnowledgeError::Invalid),
    };
    if !command.is_valid() {
        return failure(KnowledgeError::Invalid);
    }
    match repository
        .observe_layout(&current.identity.id, &organisation, &command)
        .await
    {
        Ok(value) => outgoing(value),
        Err(error) => failure(error),
    }
}
fn evidence_error(error: zobba_application::evidence::EvidenceError) -> Response {
    use zobba_application::evidence::EvidenceError;
    failure(match error {
        EvidenceError::Denied => KnowledgeError::Denied,
        EvidenceError::Invalid => KnowledgeError::Invalid,
        EvidenceError::Conflict => KnowledgeError::Conflict,
        EvidenceError::Capacity => KnowledgeError::Capacity,
        _ => KnowledgeError::Unavailable,
    })
}
#[utoipa::path(post,path="/engagements/{engagement_id}/knowledge/excerpts",operation_id="knowledge_excerpt",security(("server_session"=[])),params(("engagement_id"=String,Path),("organisation_id"=String,Query),("client_id"=String,Query),("X-Expected-Session"=Option<String>,Header),("Origin"=String,Header),("X-CSRF-Token"=String,Header),("X-Expected-Actor"=String,Header)),request_body=KnowledgeCaptureExcerpt,responses((status=200,body=KnowledgeReceipt),(status=400,body=ErrorResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=409,body=ErrorResponse),(status=412,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn excerpt(
    State(state): State<KnowledgeState>,
    headers: HeaderMap,
    Path(engagement_id): Path<String>,
    query: Result<Query<ScopeQuery>, QueryRejection>,
    body: Result<Json<KnowledgeCaptureExcerpt>, JsonRejection>,
) -> Response {
    let (current, repository, metadata) = match current(&state, &headers, true).await {
        Ok(value) => value,
        Err(error) => return error.into_response(),
    };
    let (scope, _) = match scope(query, engagement_id) {
        Ok(value) => value,
        Err(error) => return failure(error),
    };
    let command: application::CaptureExcerpt = match body {
        Ok(Json(value)) => match incoming(value) {
            Ok(value) => value,
            Err(error) => return failure(error),
        },
        Err(_) => return failure(KnowledgeError::Invalid),
    };
    if !valid_scope_id(&command.key)
        || !valid_scope_id(&command.evidence_id)
        || command.byte_end <= command.byte_start
        || command.byte_end - command.byte_start > application::MAX_EXCERPT_BYTES as u64
    {
        return failure(KnowledgeError::Invalid);
    }
    let Some(objects) = state.objects else {
        return failure(KnowledgeError::Unavailable);
    };
    let (evidence, bytes) = match zobba_application::evidence::read_original(
        &metadata,
        objects.as_ref(),
        &current.identity.id,
        &scope,
        &command.evidence_id,
    )
    .await
    {
        Ok(value) => value,
        Err(error) => return evidence_error(error),
    };
    let excerpt = match zobba_application::evidence::capture_range(
        &bytes,
        command.byte_start,
        command.byte_end,
    ) {
        Ok(value) => value,
        Err(error) => return evidence_error(error),
    };
    match repository
        .record_excerpt(&current.identity.id, &scope, &command, &evidence, &excerpt)
        .await
    {
        Ok(value) => outgoing(value),
        Err(error) => failure(error),
    }
}
#[utoipa::path(post,path="/engagements/{engagement_id}/knowledge/evidence/{evidence_id}/recover",operation_id="knowledge_recover",security(("server_session"=[])),params(("engagement_id"=String,Path),("organisation_id"=String,Query),("client_id"=String,Query),("evidence_id"=String,Path),("X-Expected-Session"=Option<String>,Header),("Origin"=String,Header),("X-CSRF-Token"=String,Header),("X-Expected-Actor"=String,Header)),request_body=KnowledgeRecoveryRequest,responses((status=200,body=KnowledgeReceipt),(status=400,body=ErrorResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=409,body=ErrorResponse),(status=412,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn recover(
    State(state): State<KnowledgeState>,
    headers: HeaderMap,
    Path((engagement_id, evidence_id)): Path<(String, String)>,
    query: Result<Query<ScopeQuery>, QueryRejection>,
    body: Result<Json<KnowledgeRecoveryRequest>, JsonRejection>,
) -> Response {
    let (current, repository, metadata) = match current(&state, &headers, true).await {
        Ok(value) => value,
        Err(error) => return error.into_response(),
    };
    let (scope, _) = match scope(query, engagement_id) {
        Ok(value) => value,
        Err(error) => return failure(error),
    };
    let key = match body {
        Ok(Json(value)) if valid_scope_id(&value.key) && valid_scope_id(&evidence_id) => value.key,
        _ => return failure(KnowledgeError::Invalid),
    };
    let Some(objects) = state.objects else {
        return failure(KnowledgeError::Unavailable);
    };
    let (evidence, bytes) = match zobba_application::evidence::read_original(
        &metadata,
        objects.as_ref(),
        &current.identity.id,
        &scope,
        &evidence_id,
    )
    .await
    {
        Ok(value) => value,
        Err(error) => return evidence_error(error),
    };
    let capture =
        zobba_application::evidence::capture_evidence(&bytes, &evidence.reservation.request.source);
    match repository
        .recover_capture(&current.identity.id, &scope, &key, &evidence, &capture)
        .await
    {
        Ok(value) => outgoing(value),
        Err(error) => failure(error),
    }
}

#[cfg(test)]
mod envelope_tests {
    use super::*;
    use application as app;

    #[test]
    fn inspection_query_uses_optional_defaults_and_refuses_malformed_inputs() {
        let parse = |parameters: &[(&str, &str)]| {
            let mut url = url::Url::parse("https://example.test/knowledge").unwrap();
            url.query_pairs_mut()
                .append_pair("organisation_id", "org-a")
                .append_pair("client_id", "client-a")
                .extend_pairs(parameters.iter().copied());
            let uri = url.as_str().parse().unwrap();
            scope(
                Query::<ScopeQuery>::try_from_uri(&uri),
                "engagement-a".into(),
            )
        };
        let (_, default) = parse(&[]).unwrap();
        assert_eq!(default, app::KnowledgeQuery::default());
        let (_, explicit) = parse(&[
            ("after", "A_9-last"),
            ("text", "  Évidence 😀  "),
            ("include_inactive", "true"),
        ])
        .unwrap();
        assert_eq!(explicit.after.as_deref(), Some("A_9-last"));
        assert_eq!(explicit.text.as_deref(), Some("  Évidence 😀  "));
        assert!(explicit.include_inactive);
        assert!(
            !parse(&[("include_inactive", "false")])
                .unwrap()
                .1
                .include_inactive
        );
        for parameters in [
            vec![("include_inactive", "1")],
            vec![("include_inactive", "")],
            vec![("after", "")],
            vec![("text", "line\nbreak")],
            vec![("after", "one"), ("after", "two")],
            vec![("unknown", "value")],
        ] {
            assert!(matches!(parse(&parameters), Err(KnowledgeError::Invalid)));
        }
    }

    #[test]
    fn application_kinds_have_identical_declared_wire_variants() {
        for kind in [
            app::KnowledgeKind::Decision,
            app::KnowledgeKind::Observation,
            app::KnowledgeKind::Assertion,
            app::KnowledgeKind::Preference,
            app::KnowledgeKind::PublishedPreference,
        ] {
            let actual = serde_json::to_value(kind).unwrap();
            let declared: KnowledgeKind = serde_json::from_value(actual.clone()).unwrap();
            assert_eq!(serde_json::to_value(declared).unwrap(), actual);
        }
        for omission in [
            app::Omission::UnsupportedFormat,
            app::Omission::UnknownPeriod,
            app::Omission::OutsidePeriod,
            app::Omission::InvalidatedSupport,
            app::Omission::CaptureCapacity,
            app::Omission::LegacyNotCaptured,
            app::Omission::PartialSource,
            app::Omission::BoundedPage,
            app::Omission::ScanLimit,
            app::Omission::UnavailableSupport,
        ] {
            let actual = serde_json::to_value(omission).unwrap();
            let declared: KnowledgeOmission = serde_json::from_value(actual.clone()).unwrap();
            assert_eq!(serde_json::to_value(declared).unwrap(), actual);
        }
    }

    #[tokio::test]
    async fn combined_omissions_emit_the_shared_browser_parser_contract() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../web/tests/fixtures/knowledge-omissions-wire.json"
        ))
        .unwrap();
        // Deliberately combine two typed cause emissions. This is a response
        // composition fixture, not a persisted or supported-knowledge producer.
        let page = app::KnowledgePage {
            task_id: "task-a".into(),
            revision: 9_007_199_254_740_993,
            execution_epoch: 12,
            methodology_binding_id: "binding-a".into(),
            items: vec![],
            next_after: None,
            omissions: vec![
                app::Omission::UnavailableSupport,
                app::Omission::UnknownPeriod,
                app::Omission::UnavailableSupport,
            ],
        };
        let source = app::SourceStatus {
            evidence_id: "original-a".into(),
            source_revision: 0,
            replacement_id: None,
            capture_revision: 2,
            omissions: vec![app::Omission::PartialSource, app::Omission::PartialSource],
            correction_actor_id: None,
            correction_recorded_at: None,
            correction_reason: None,
        };
        for (response, name) in [
            (outgoing(page), "page"),
            (outgoing(source), "source_status"),
        ] {
            assert_eq!(response.status(), StatusCode::OK);
            let bytes = axum::body::to_bytes(response.into_body(), app::MAX_KNOWLEDGE_BYTES)
                .await
                .unwrap();
            let actual: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
            assert_eq!(
                actual, fixture[name],
                "actual API response differs from shared parser contract"
            );
        }
    }
    #[test]
    fn maximal_fifty_record_wire_page_stays_within_ordinary_four_mib_reader() {
        let id = "a".repeat(128);
        let scope = app::KnowledgeScope {
            kind: app::ScopeKind::Engagement,
            organisation_id: id.clone(),
            client_id: Some(id.clone()),
            engagement_id: Some(id.clone()),
            owner_id: None,
        };
        let mut record = app::KnowledgeRecord {
            id: id.clone(),
            revision: i64::MAX as u64,
            actor_id: id.clone(),
            recorded_at: 253_402_300_799,
            scope: scope.clone(),
            kind: app::KnowledgeKind::Observation,
            text: "\"".repeat(app::MAX_EXCERPT_BYTES),
            period: app::Period {
                start: Some("0001-01-01".into()),
                end: Some("9999-12-31".into()),
            },
            certainty: app::Certainty::SourceStates,
            uncertainty: Some("😀".repeat(2000)),
            dependencies: (0..app::MAX_DEPENDENCIES)
                .map(|_| app::Dependency::Evidence {
                    evidence_id: id.clone(),
                    storage_version: "\"".repeat(256),
                    digest: "f".repeat(64),
                    scope: scope.clone(),
                })
                .collect(),
            source: Some(app::SourceLocation {
                evidence_id: id.clone(),
                storage_version: "\"".repeat(256),
                digest: "f".repeat(64),
                byte_start: 10_000_000,
                byte_end: 10_016_384,
                original_size: 10_485_760,
                partial: true,
                field_path: Some("source.source_version".into()),
            }),
            direction: Some(app::DirectionBasis {
                command_id: id.clone(),
                task_id: id.clone(),
                cycle_id: id.clone(),
                standing: "received; historical Task-local direction".into(),
            }),
            preference: Some(app::PreferenceBasis {
                name: "task_inspection_layout".into(),
                value: app::InspectionLayout::Expanded,
                inferred: true,
                rule: Some("task-inspection-layout-v1".into()),
                observation_ids: vec![id.clone(); 2],
            }),
            supersedes: Some(app::RecordReference {
                id: id.clone(),
                revision: i64::MAX as u64,
            }),
        };
        // The aggregate record bound is smaller than independently maximal fields.
        // Fill it up to 60,000 bytes, reserving jsonb whitespace inside the 64 KiB DB bound.
        let record_bytes = serde_json::to_vec(&record).unwrap().len();
        let remove = record_bytes.saturating_sub(60_000).div_ceil(2);
        record.text.truncate(
            record
                .text
                .len()
                .checked_sub(remove)
                .expect("dependency manifest alone must fit"),
        );
        assert!(!record.text.is_empty());
        assert!(serde_json::to_vec(&record).unwrap().len() >= 59_998);
        let view = app::KnowledgeView {
            record,
            status: app::RecordStatus::Invalidated,
            status_reason: Some("😀".repeat(2000)),
            can_correct: true,
            can_exclude: true,
            can_forget: true,
            can_reuse: true,
            can_undo: true,
        };
        let page = app::KnowledgePage {
            task_id: id.clone(),
            revision: i64::MAX as u64,
            execution_epoch: i64::MAX as u64,
            methodology_binding_id: id.clone(),
            items: vec![view.clone(); 50],
            next_after: Some(id.clone()),
            omissions: vec![
                app::Omission::UnsupportedFormat,
                app::Omission::UnknownPeriod,
                app::Omission::OutsidePeriod,
                app::Omission::InvalidatedSupport,
                app::Omission::CaptureCapacity,
                app::Omission::LegacyNotCaptured,
                app::Omission::PartialSource,
                app::Omission::BoundedPage,
                app::Omission::ScanLimit,
                app::Omission::UnavailableSupport,
            ],
        };
        let mut value = serde_json::to_value(page).unwrap();
        numeric_fields(&mut value, true).unwrap();
        let bytes = serde_json::to_vec(&value).unwrap().len();
        assert!(
            bytes <= application::MAX_KNOWLEDGE_BYTES,
            "maximal serialized page {bytes} exceeds ordinary reader cap"
        );
        eprintln!("maximal knowledge page envelope: {bytes} bytes");
        let mut preferences = serde_json::to_value(app::PreferenceSnapshot {
            organisation_id: id.clone(),
            owner_id: id.clone(),
            revision: i64::MAX as u64,
            current: Some(view.clone()),
            publications: vec![view.clone(); 50],
            consumed_through: i64::MAX as u64,
        })
        .unwrap();
        numeric_fields(&mut preferences, true).unwrap();
        let preference_bytes = serde_json::to_vec(&preferences).unwrap().len();
        assert!(preference_bytes <= application::MAX_KNOWLEDGE_BYTES);
        let mut receipt = serde_json::to_value(app::KnowledgeReceipt {
            event_id: id.clone(),
            revision: i64::MAX as u64,
            record: Some(view),
            affected_ids: vec![id.clone(); 4096],
            affected_destinations: vec![id; 4096],
        })
        .unwrap();
        numeric_fields(&mut receipt, true).unwrap();
        let receipt_bytes = serde_json::to_vec(&receipt).unwrap().len();
        assert!(receipt_bytes <= application::MAX_KNOWLEDGE_BYTES);
        eprintln!(
            "maximal preference envelope: {preference_bytes} bytes; conservative receipt envelope: {receipt_bytes} bytes"
        );
    }
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
pub struct KnowledgeSourceStatus {
    pub correction_actor_id: Option<String>,
    pub correction_recorded_at: Option<i64>,
    pub correction_reason: Option<String>,
    pub evidence_id: String,
    #[schema(pattern = "^(0|[1-9][0-9]*)$")]
    pub source_revision: String,
    pub replacement_id: Option<String>,
    #[schema(pattern = "^(0|[1-9][0-9]*)$")]
    pub capture_revision: String,
    pub omissions: Vec<KnowledgeOmission>,
}
#[utoipa::path(get,path="/engagements/{engagement_id}/knowledge/evidence/{evidence_id}",operation_id="knowledge_source_status",security(("server_session"=[])),params(("engagement_id"=String,Path),("evidence_id"=String,Path),("organisation_id"=String,Query),("client_id"=String,Query),("X-Expected-Session"=Option<String>,Header)),responses((status=200,body=KnowledgeSourceStatus),(status=400,body=ErrorResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=409,body=ErrorResponse),(status=412,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn source_status(
    State(state): State<KnowledgeState>,
    headers: HeaderMap,
    Path((engagement_id, evidence_id)): Path<(String, String)>,
    query: Result<Query<ScopeQuery>, QueryRejection>,
) -> Response {
    let (current, repository, _) = match current(&state, &headers, false).await {
        Ok(value) => value,
        Err(error) => return error.into_response(),
    };
    let (scope, _) = match scope(query, engagement_id) {
        Ok(value) => value,
        Err(error) => return failure(error),
    };
    if !valid_scope_id(&evidence_id) {
        return failure(KnowledgeError::Invalid);
    }
    match repository
        .source_status(&current.identity.id, &scope, &evidence_id)
        .await
    {
        Ok(value) => outgoing(value),
        Err(error) => failure(error),
    }
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct KnowledgeVerificationItem {
    pub id: String,
    #[schema(pattern = "^[1-9][0-9]*$")]
    pub revision: String,
    pub status: KnowledgeRecordStatus,
}
#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct KnowledgeVerificationRequest {
    pub query: KnowledgeQuery,
    #[schema(pattern = "^(0|[1-9][0-9]*)$")]
    pub expected_execution_epoch: String,
    pub expected_methodology_binding_id: String,
    #[schema(max_items = 50)]
    pub items: Vec<KnowledgeVerificationItem>,
    /// Read-only exact historical inspection; at most one exact revision.
    #[serde(default)]
    pub exact: bool,
}
#[derive(Serialize, ToSchema)]
pub struct KnowledgeVerificationResponse {
    pub verified: bool,
}

/// A bounded read carried by POST to keep exact source references out of URLs.
/// This is disclosure verification, not command admission or an execution grant.
#[utoipa::path(post,path="/engagements/{engagement_id}/tasks/{task_id}/knowledge/verify",operation_id="knowledge_verify",security(("server_session"=[])),params(("engagement_id"=String,Path),("task_id"=String,Path),("organisation_id"=String,Query),("client_id"=String,Query),("X-Expected-Session"=Option<String>,Header),("Origin"=String,Header),("X-CSRF-Token"=String,Header),("X-Expected-Actor"=String,Header)),request_body=KnowledgeVerificationRequest,responses((status=200,body=KnowledgeVerificationResponse),(status=400,body=ErrorResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=409,body=ErrorResponse),(status=412,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn verify(
    State(state): State<KnowledgeState>,
    headers: HeaderMap,
    Path((engagement_id, task_id)): Path<(String, String)>,
    query: Result<Query<ScopeQuery>, QueryRejection>,
    body: Result<Json<KnowledgeVerificationRequest>, JsonRejection>,
) -> Response {
    let (current, repository, _) = match current(&state, &headers, true).await {
        Ok(value) => value,
        Err(error) => return error.into_response(),
    };
    let (scope, _) = match scope(query, engagement_id) {
        Ok(value) => value,
        Err(error) => return failure(error),
    };
    let input = match body {
        Ok(Json(value)) => value,
        Err(_) => return failure(KnowledgeError::Invalid),
    };
    if !valid_scope_id(&task_id)
        || !valid_scope_id(&input.expected_methodology_binding_id)
        || input.items.len() > application::KNOWLEDGE_PAGE_SIZE
        || input.exact && input.items.len() != 1
    {
        return failure(KnowledgeError::Invalid);
    }
    let expected_epoch = match revision(&input.expected_execution_epoch) {
        Ok(value) => value,
        Err(error) => return failure(error),
    };
    let query: application::KnowledgeQuery = match incoming(input.query) {
        Ok(value) => value,
        Err(error) => return failure(error),
    };
    if !query.is_valid() {
        return failure(KnowledgeError::Invalid);
    }
    let mut requested = Vec::with_capacity(input.items.len());
    for item in input.items {
        let version = match revision(&item.revision) {
            Ok(v) if v > 0 => v,
            _ => return failure(KnowledgeError::Invalid),
        };
        if !valid_scope_id(&item.id) || requested.iter().any(|(id, _, _)| id == &item.id) {
            return failure(KnowledgeError::Invalid);
        }
        let status: application::RecordStatus = match incoming(item.status) {
            Ok(value) => value,
            Err(error) => return failure(error),
        };
        requested.push((item.id, version, status));
    }
    let command = application::VerifyKnowledge {
        expected_execution_epoch: expected_epoch,
        expected_methodology_binding_id: input.expected_methodology_binding_id,
        items: requested
            .into_iter()
            .map(|(id, revision, status)| application::VerificationItem {
                id,
                revision,
                status,
            })
            .collect(),
        exact: input.exact,
        include_inactive: query.include_inactive,
    };
    if let Err(error) = repository
        .verify(&current.identity.id, &scope, &task_id, &command)
        .await
    {
        return failure(error);
    }

    Json(KnowledgeVerificationResponse { verified: true }).into_response()
}

#[derive(Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct KnowledgePreferenceVerificationRequest {
    #[schema(pattern = "^(0|[1-9][0-9]*)$")]
    pub expected_revision: String,
}
#[derive(Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct KnowledgeSourceVerificationRequest {
    #[schema(pattern = "^(0|[1-9][0-9]*)$")]
    pub expected_source_revision: String,
    #[schema(pattern = "^(0|[1-9][0-9]*)$")]
    pub expected_capture_revision: String,
}
#[utoipa::path(post,path="/knowledge/organisations/{organisation_id}/preference/verify",operation_id="knowledge_verify_preference",security(("server_session"=[])),params(("organisation_id"=String,Path),("X-Expected-Session"=Option<String>,Header),("Origin"=String,Header),("X-CSRF-Token"=String,Header),("X-Expected-Actor"=String,Header)),request_body=KnowledgePreferenceVerificationRequest,responses((status=200,body=KnowledgeVerificationResponse),(status=400,body=ErrorResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=409,body=ErrorResponse),(status=412,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn verify_preference(
    State(state): State<KnowledgeState>,
    headers: HeaderMap,
    Path(organisation): Path<String>,
    body: Result<Json<KnowledgePreferenceVerificationRequest>, JsonRejection>,
) -> Response {
    let (current, repository, _) = match current(&state, &headers, true).await {
        Ok(value) => value,
        Err(error) => return error.into_response(),
    };
    if !valid_scope_id(&organisation) {
        return failure(KnowledgeError::Invalid);
    }
    let expected = match body {
        Ok(Json(value)) => match revision(&value.expected_revision) {
            Ok(value) => value,
            Err(error) => return failure(error),
        },
        Err(_) => return failure(KnowledgeError::Invalid),
    };
    match repository
        .preference(&current.identity.id, &organisation)
        .await
    {
        Ok(value) if value.revision == expected => {
            Json(KnowledgeVerificationResponse { verified: true }).into_response()
        }
        Ok(_) => failure(KnowledgeError::Conflict),
        Err(error) => failure(error),
    }
}
#[utoipa::path(post,path="/engagements/{engagement_id}/knowledge/evidence/{evidence_id}/verify",operation_id="knowledge_verify_source",security(("server_session"=[])),params(("engagement_id"=String,Path),("evidence_id"=String,Path),("organisation_id"=String,Query),("client_id"=String,Query),("X-Expected-Session"=Option<String>,Header),("Origin"=String,Header),("X-CSRF-Token"=String,Header),("X-Expected-Actor"=String,Header)),request_body=KnowledgeSourceVerificationRequest,responses((status=200,body=KnowledgeVerificationResponse),(status=400,body=ErrorResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=409,body=ErrorResponse),(status=412,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn verify_source(
    State(state): State<KnowledgeState>,
    headers: HeaderMap,
    Path((engagement_id, evidence_id)): Path<(String, String)>,
    query: Result<Query<ScopeQuery>, QueryRejection>,
    body: Result<Json<KnowledgeSourceVerificationRequest>, JsonRejection>,
) -> Response {
    let (current, repository, _) = match current(&state, &headers, true).await {
        Ok(value) => value,
        Err(error) => return error.into_response(),
    };
    let (scope, _) = match scope(query, engagement_id) {
        Ok(value) => value,
        Err(error) => return failure(error),
    };
    if !valid_scope_id(&evidence_id) {
        return failure(KnowledgeError::Invalid);
    }
    let (source, capture) = match body {
        Ok(Json(value)) => match (
            revision(&value.expected_source_revision),
            revision(&value.expected_capture_revision),
        ) {
            (Ok(source), Ok(capture)) => (source, capture),
            _ => return failure(KnowledgeError::Invalid),
        },
        Err(_) => return failure(KnowledgeError::Invalid),
    };
    match repository
        .source_status(&current.identity.id, &scope, &evidence_id)
        .await
    {
        Ok(value) if value.source_revision == source && value.capture_revision == capture => {
            Json(KnowledgeVerificationResponse { verified: true }).into_response()
        }
        Ok(_) => failure(KnowledgeError::Conflict),
        Err(error) => failure(error),
    }
}
