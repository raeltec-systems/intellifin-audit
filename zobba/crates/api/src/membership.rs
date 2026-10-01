//! Bounded organisation administration. Reserved Task controls use their own lane.
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
    membership::{self as application, MembershipError, MembershipStore},
};
use zobba_domain::identity::valid_scope_id;
use zobba_infrastructure::{identity::secret_hash, membership::MembershipRepository};

#[derive(Clone)]
pub(crate) struct MembershipState {
    identity: AuthState,
    repository: MembershipRepository,
}
pub(crate) fn router(pool: sqlx::PgPool, identity: AuthState) -> Router {
    let repository = MembershipRepository::new(pool, identity.configured_issuer().to_owned());
    let capacity = Arc::new(Semaphore::new(4));
    Router::new()
        .route("/membership/organisations", get(organisations))
        .route("/membership/organisations/{organisation_id}", get(snapshot))
        .route(
            "/membership/organisations/{organisation_id}/members",
            post(save_member),
        )
        .route(
            "/membership/organisations/{organisation_id}/members/{actor_id}/assignments",
            get(member_assignments),
        )
        .route(
            "/membership/organisations/{organisation_id}/invitations",
            post(invite),
        )
        .route(
            "/membership/organisations/{organisation_id}/invitations/revoke",
            post(revoke_invitation),
        )
        .route("/membership/invitations/accept", post(accept))
        .route("/membership/invitations/preview", post(preview))
        .with_state(MembershipState {
            identity,
            repository,
        })
        .layer(DefaultBodyLimit::max(32 * 1024))
        .layer(axum::middleware::from_fn(
            move |request: axum::extract::Request, next: axum::middleware::Next| {
                let capacity = capacity.clone();
                async move {
                    let Ok(_permit) = capacity.try_acquire_owned() else {
                        return failure(MembershipError::Capacity);
                    };
                    match tokio::time::timeout(Duration::from_secs(6), next.run(request)).await {
                        Ok(response) => response,
                        Err(_) => failure(MembershipError::Unavailable),
                    }
                }
            },
        ))
}
fn failure(error: MembershipError) -> Response {
    let status = match error {
        MembershipError::Invalid => StatusCode::BAD_REQUEST,
        MembershipError::Denied | MembershipError::InvitationRefused => StatusCode::FORBIDDEN,
        MembershipError::Conflict | MembershipError::LastAdmin => StatusCode::CONFLICT,
        MembershipError::Capacity => StatusCode::TOO_MANY_REQUESTS,
        MembershipError::Unavailable => StatusCode::SERVICE_UNAVAILABLE,
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
    Membership(MembershipError),
}
impl IntoResponse for AuthenticationFailure {
    fn into_response(self) -> Response {
        match self {
            Self::Identity(error) => auth::failure(error),
            Self::Membership(error) => failure(error),
        }
    }
}
async fn current(
    state: &MembershipState,
    headers: &HeaderMap,
    mutation: bool,
) -> Result<(CurrentSession, MembershipRepository), AuthenticationFailure> {
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
            return Err(AuthenticationFailure::Membership(MembershipError::Denied));
        }
    }
    let token = auth::cookie(headers, auth::SESSION_COOKIE)
        .ok_or(AuthenticationFailure::Membership(MembershipError::Denied))?;
    Ok((
        current,
        state
            .repository
            .clone()
            .with_session_hash(secret_hash(&token)),
    ))
}
fn outcome<T: Serialize>(result: Result<T, MembershipError>) -> Response {
    match result {
        Ok(value) => Json(value).into_response(),
        Err(error) => failure(error),
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct OrganisationQuery {
    after: Option<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SnapshotQuery {
    members_after: Option<String>,
    invitations_after: Option<String>,
    engagements_after: Option<String>,
}

/// Application roles are fixed; provider roles never grant application authority.
#[derive(Clone, Copy, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum MembershipRole {
    Auditor,
    AuditManager,
    Admin,
}
impl From<MembershipRole> for String {
    fn from(value: MembershipRole) -> Self {
        let role = match value {
            MembershipRole::Auditor => zobba_domain::identity::AuditRole::Auditor,
            MembershipRole::AuditManager => zobba_domain::identity::AuditRole::AuditManager,
            MembershipRole::Admin => zobba_domain::identity::AuditRole::Admin,
        };
        role.as_str().to_owned()
    }
}

#[derive(Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum MembershipInvitationStatus {
    Pending,
    Accepted,
    Revoked,
    Expired,
}

#[derive(Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum MembershipReceiptKind {
    SaveMember,
    Invite,
    RevokeInvitation,
    Accept,
}

/// Replace supplies the complete assignment set and refuses legacy sets above
/// 100. Preserve requires an empty assignments array and keeps every assignment;
/// remove revokes only the listed assignments, including across paged legacy sets.
#[derive(Default, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum MembershipAssignmentMode {
    #[default]
    Replace,
    Preserve,
    Remove,
}
impl From<MembershipAssignmentMode> for application::AssignmentMode {
    fn from(value: MembershipAssignmentMode) -> Self {
        match value {
            MembershipAssignmentMode::Replace => Self::Replace,
            MembershipAssignmentMode::Preserve => Self::Preserve,
            MembershipAssignmentMode::Remove => Self::Remove,
        }
    }
}

// Reusable scalar schemas retain the same bounds wherever a field is used.
macro_rules! membership_string_schema {
    ($name:ident, $minimum:literal, $maximum:literal, $pattern:literal, $description:literal) => {
        pub struct $name;
        impl utoipa::PartialSchema for $name {
            fn schema() -> utoipa::openapi::RefOr<utoipa::openapi::schema::Schema> {
                utoipa::openapi::schema::ObjectBuilder::new()
                    .schema_type(utoipa::openapi::schema::Type::String)
                    .min_length(Some($minimum))
                    .max_length(Some($maximum))
                    // ECMAScript `$` also matches before a final newline; the
                    // server validators require the actual end of the string.
                    .pattern(Some(concat!($pattern, r"(?![\s\S])")))
                    .description(Some($description))
                    .into()
            }
        }
        impl utoipa::ToSchema for $name {}
    };
}
membership_string_schema!(
    MembershipIdentifier,
    1,
    128,
    "^[A-Za-z0-9_-]+$",
    "A bounded ASCII application identifier; also used for idempotency keys."
);
membership_string_schema!(
    MembershipVersion,
    1,
    19,
    "^(0|[1-9][0-9]{0,17}|[1-8][0-9]{18}|9[01][0-9]{17}|92[01][0-9]{16}|922[0-2][0-9]{15}|9223[0-2][0-9]{14}|92233[0-6][0-9]{13}|922337[01][0-9]{12}|92233720[0-2][0-9]{10}|922337203[0-5][0-9]{9}|9223372036[0-7][0-9]{8}|92233720368[0-4][0-9]{7}|922337203685[0-3][0-9]{6}|9223372036854[0-6][0-9]{5}|92233720368547[0-6][0-9]{4}|922337203685477[0-4][0-9]{3}|9223372036854775[0-7][0-9]{2}|922337203685477580[0-7])$",
    "Canonical nonnegative decimal through 9223372036854775807; no signs or leading zeros."
);
membership_string_schema!(
    MembershipRecipientEmail,
    3,
    254,
    "^(?=.{1,64}@)[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$",
    "ASCII address with a local part of 1–64 characters and DNS-style domain labels. Preserve local-part case; lowercase the domain."
);
membership_string_schema!(
    MembershipInvitationSecret,
    43,
    43,
    "^[A-Za-z0-9_-]{43}$",
    "Private random 32-byte base64url capability. POST bodies only; never query strings or logs."
);
membership_string_schema!(
    MembershipAssignmentCursor,
    3,
    257,
    "^[A-Za-z0-9_-]{1,128}\\.[A-Za-z0-9_-]{1,128}$",
    "Exclusive cursor containing a client identifier, a dot, then an engagement identifier."
);

#[derive(Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct MembershipAssignment {
    #[schema(value_type = MembershipIdentifier)]
    pub client_id: String,
    #[schema(value_type = MembershipIdentifier)]
    pub engagement_id: String,
}

/// One assignment selected in a membership Save. Renewal is an explicit choice
/// for this scope; omitting it has the same meaning as false for exact retries.
#[derive(Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct MembershipAssignmentChange {
    #[schema(value_type = MembershipIdentifier)]
    pub client_id: String,
    #[schema(value_type = MembershipIdentifier)]
    pub engagement_id: String,
    /// True explicitly renews this scope if its stored assignment expired or
    /// became inactive. A future active expiry is preserved. Remove mode must use false.
    #[serde(default)]
    #[schema(default = false)]
    pub renew: bool,
}

#[derive(Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct MembershipAssignmentOption {
    #[schema(value_type = MembershipIdentifier)]
    pub client_id: String,
    #[schema(min_length = 1, max_length = 200)]
    pub client_name: String,
    #[schema(value_type = MembershipIdentifier)]
    pub engagement_id: String,
    #[schema(min_length = 1, max_length = 200)]
    pub engagement_name: String,
}

#[derive(Serialize, ToSchema)]
pub struct MembershipMemberAssignment {
    #[schema(value_type = MembershipIdentifier)]
    pub client_id: String,
    #[schema(min_length = 1, max_length = 200)]
    pub client_name: String,
    #[schema(value_type = MembershipIdentifier)]
    pub engagement_id: String,
    #[schema(min_length = 1, max_length = 200)]
    pub engagement_name: String,
    #[schema(required = true, minimum = 1, maximum = 253402300799_i64)]
    pub expires_at: Option<i64>,
}

#[derive(Serialize, ToSchema)]
pub struct MembershipMemberAssignments {
    #[schema(value_type = MembershipIdentifier)]
    pub organisation_id: String,
    #[schema(value_type = MembershipIdentifier)]
    pub actor_id: String,
    #[schema(value_type = MembershipVersion)]
    pub version: String,
    pub total: u64,
    #[schema(max_items = 50)]
    pub assignments: Vec<MembershipMemberAssignment>,
    #[schema(required = true, value_type = Option<MembershipAssignmentCursor>)]
    pub next_cursor: Option<String>,
}

#[derive(Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct MembershipOrganisation {
    #[schema(value_type = MembershipIdentifier)]
    pub organisation_id: String,
    #[schema(min_length = 1, max_length = 200)]
    pub organisation_name: String,
    #[schema(value_type = MembershipVersion)]
    pub version: String,
}

#[derive(Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct MembershipOrganisations {
    #[schema(max_items = 50)]
    pub organisations: Vec<MembershipOrganisation>,
    #[schema(required = true, value_type = Option<MembershipIdentifier>)]
    pub next_cursor: Option<String>,
}

#[derive(Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct MembershipMember {
    #[schema(value_type = MembershipIdentifier)]
    pub actor_id: String,
    #[schema(max_length = 256)]
    pub display_name: String,
    #[schema(max_items = 3)]
    pub roles: Vec<MembershipRole>,
    pub active: bool,
    #[schema(required = true, minimum = 1, maximum = 253402300799_i64)]
    pub expires_at: Option<i64>,
    /// Effective assignments in this organisation, including any beyond the bounded preview.
    pub assignments_count: u64,
    /// False requires the paged assignment endpoint; the preview must not be used as a replacement set.
    pub assignments_complete: bool,
    #[schema(max_items = 100)]
    pub assignments: Vec<MembershipAssignment>,
}

#[derive(Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct MembershipInvitation {
    #[schema(value_type = MembershipIdentifier)]
    pub id: String,
    #[schema(value_type = MembershipRecipientEmail)]
    pub recipient_email: String,
    #[schema(min_items = 1, max_items = 3)]
    pub roles: Vec<MembershipRole>,
    #[schema(max_items = 100)]
    pub assignments: Vec<MembershipAssignment>,
    #[schema(value_type = MembershipIdentifier)]
    pub inviter_actor_id: String,
    #[schema(minimum = 1, maximum = 253402300799_i64)]
    pub expires_at: i64,
    pub status: MembershipInvitationStatus,
}

#[derive(Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct MembershipSnapshot {
    #[schema(value_type = MembershipIdentifier)]
    pub organisation_id: String,
    #[schema(min_length = 1, max_length = 200)]
    pub organisation_name: String,
    #[schema(value_type = MembershipVersion)]
    pub version: String,
    #[schema(max_items = 50)]
    pub members: Vec<MembershipMember>,
    #[schema(required = true, value_type = Option<MembershipIdentifier>)]
    pub members_next_cursor: Option<String>,
    #[schema(max_items = 50)]
    pub invitations: Vec<MembershipInvitation>,
    #[schema(required = true, value_type = Option<MembershipIdentifier>)]
    pub invitations_next_cursor: Option<String>,
    #[schema(max_items = 50)]
    pub engagements: Vec<MembershipAssignmentOption>,
    #[schema(required = true, value_type = Option<MembershipAssignmentCursor>)]
    pub engagements_next_cursor: Option<String>,
}

#[derive(Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct MembershipReceipt {
    #[schema(value_type = MembershipIdentifier)]
    pub event_id: String,
    #[schema(value_type = MembershipIdentifier)]
    pub organisation_id: String,
    #[schema(value_type = MembershipIdentifier)]
    pub actor_id: String,
    #[schema(required = true, value_type = Option<MembershipIdentifier>)]
    pub subject_actor_id: Option<String>,
    #[schema(required = true, value_type = Option<MembershipIdentifier>)]
    pub invitation_id: Option<String>,
    #[schema(value_type = MembershipVersion)]
    pub version: String,
    pub kind: MembershipReceiptKind,
}

#[derive(Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct SaveMemberRequest {
    #[schema(value_type = MembershipIdentifier)]
    pub key: String,
    #[schema(value_type = MembershipVersion)]
    pub expected_version: String,
    #[schema(value_type = MembershipIdentifier)]
    pub actor_id: String,
    /// Unique application roles; an active membership must have at least one.
    #[schema(max_items = 3)]
    pub roles: Vec<MembershipRole>,
    pub active: bool,
    /// Unix seconds through 9999-12-31T23:59:59Z; null explicitly clears membership expiry.
    #[schema(required = true, minimum = 1, maximum = 253402300799_i64)]
    pub expires_at: Option<i64>,
    #[serde(default)]
    #[schema(default = "replace")]
    pub assignment_mode: MembershipAssignmentMode,
    #[schema(max_items = 100)]
    pub assignments: Vec<MembershipAssignmentChange>,
}

#[derive(Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct InviteMemberRequest {
    #[schema(value_type = MembershipIdentifier)]
    pub key: String,
    #[schema(value_type = MembershipVersion)]
    pub expected_version: String,
    #[schema(value_type = MembershipRecipientEmail)]
    pub recipient_email: String,
    /// Unique roles fixed for this invitation; acceptance cannot broaden them.
    #[schema(min_items = 1, max_items = 3)]
    pub roles: Vec<MembershipRole>,
    #[schema(max_items = 100)]
    pub assignments: Vec<MembershipAssignment>,
    #[schema(minimum = 300, maximum = 604800)]
    pub expires_in_seconds: u32,
    /// Private random 32-byte base64url invitation value. POST bodies only; never a query, log or projection.
    #[schema(value_type = MembershipInvitationSecret)]
    pub secret: String,
}

#[derive(Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct RevokeInvitationRequest {
    #[schema(value_type = MembershipIdentifier)]
    pub key: String,
    #[schema(value_type = MembershipVersion)]
    pub expected_version: String,
    #[schema(value_type = MembershipIdentifier)]
    pub invitation_id: String,
}

#[derive(Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct AcceptInvitationRequest {
    #[schema(value_type = MembershipIdentifier)]
    pub key: String,
    /// Private random 32-byte base64url invitation value. POST bodies only; never a query, log or projection.
    #[schema(value_type = MembershipInvitationSecret)]
    pub secret: String,
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct PreviewInvitationRequest {
    #[schema(value_type = MembershipInvitationSecret)]
    pub secret: String,
}
#[derive(Serialize, ToSchema)]
pub struct InvitationPreviewResponse {
    #[schema(value_type = MembershipIdentifier)]
    pub organisation_id: String,
    #[schema(min_length = 1, max_length = 200)]
    pub organisation_name: String,
    #[schema(value_type = MembershipRecipientEmail)]
    pub recipient_email: String,
    #[schema(min_items = 1, max_items = 3)]
    pub roles: Vec<MembershipRole>,
    #[schema(max_items = 100)]
    pub assignments: Vec<MembershipAssignmentOption>,
    #[schema(minimum = 1, maximum = 253402300799_i64)]
    pub expires_at: i64,
}

#[utoipa::path(post,path="/membership/invitations/preview",operation_id="membership_preview_invitation",security(("server_session"=[])),
    params(("Origin"=String,Header),("X-CSRF-Token"=String,Header),("X-Expected-Actor"=MembershipIdentifier,Header)),
    request_body=PreviewInvitationRequest,
    responses((status=200,description="Current verified recipient's fixed invitation terms; grants no authority",body=InvitationPreviewResponse),
    (status=400,body=ErrorResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=412,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn preview(
    State(state): State<MembershipState>,
    headers: HeaderMap,
    body: Result<Json<PreviewInvitationRequest>, JsonRejection>,
) -> Response {
    let (current, repository) = match current(&state, &headers, true).await {
        Ok(value) => value,
        Err(error) => return error.into_response(),
    };
    let Ok(Json(body)) = body else {
        return failure(MembershipError::Invalid);
    };
    if !zobba_domain::membership::valid_invitation_secret(&body.secret) {
        return failure(MembershipError::Invalid);
    }
    let Some(token) = auth::cookie(&headers, auth::SESSION_COOKIE) else {
        return failure(MembershipError::Denied);
    };
    outcome(
        repository
            .preview(&current.identity.id, &secret_hash(&token), &body.secret)
            .await,
    )
}
impl From<MembershipAssignment> for application::Assignment {
    fn from(value: MembershipAssignment) -> Self {
        Self {
            client_id: value.client_id,
            engagement_id: value.engagement_id,
        }
    }
}
impl From<MembershipAssignmentChange> for application::AssignmentChange {
    fn from(value: MembershipAssignmentChange) -> Self {
        Self {
            client_id: value.client_id,
            engagement_id: value.engagement_id,
            renew: value.renew,
        }
    }
}
impl From<SaveMemberRequest> for application::SaveMember {
    fn from(value: SaveMemberRequest) -> Self {
        Self {
            key: value.key,
            expected_version: value.expected_version,
            actor_id: value.actor_id,
            roles: value.roles.into_iter().map(Into::into).collect(),
            active: value.active,
            expires_at: value.expires_at,
            assignment_mode: value.assignment_mode.into(),
            assignments: value.assignments.into_iter().map(Into::into).collect(),
        }
    }
}
impl From<InviteMemberRequest> for application::InviteCommand {
    fn from(value: InviteMemberRequest) -> Self {
        Self {
            key: value.key,
            expected_version: value.expected_version,
            recipient_email: value.recipient_email,
            roles: value.roles.into_iter().map(Into::into).collect(),
            assignments: value.assignments.into_iter().map(Into::into).collect(),
            expires_in_seconds: value.expires_in_seconds,
            secret: value.secret,
        }
    }
}
impl From<RevokeInvitationRequest> for application::RevokeInvitation {
    fn from(value: RevokeInvitationRequest) -> Self {
        Self {
            key: value.key,
            expected_version: value.expected_version,
            invitation_id: value.invitation_id,
        }
    }
}

#[utoipa::path(get,path="/membership/organisations",operation_id="membership_organisations",security(("server_session"=[])),params(("after"=Option<MembershipIdentifier>,Query),("X-Expected-Session"=Option<String>,Header,description="Additional current session refusal fence")),responses((status=200,body=MembershipOrganisations),(status=400,body=ErrorResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=409,body=ErrorResponse),(status=412,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn organisations(
    State(state): State<MembershipState>,
    headers: HeaderMap,
    query: Result<Query<OrganisationQuery>, QueryRejection>,
) -> Response {
    let (current, repository) = match current(&state, &headers, false).await {
        Ok(value) => value,
        Err(error) => return error.into_response(),
    };
    let Ok(Query(query)) = query else {
        return failure(MembershipError::Invalid);
    };
    outcome(
        repository
            .organisations(&current.identity.id, query.after.as_deref())
            .await,
    )
}

#[utoipa::path(get,path="/membership/organisations/{organisation_id}",operation_id="membership_snapshot",security(("server_session"=[])),params(("members_after"=Option<MembershipIdentifier>,Query),("invitations_after"=Option<MembershipIdentifier>,Query),("engagements_after"=Option<MembershipAssignmentCursor>,Query),("X-Expected-Session"=Option<String>,Header,description="Additional current session refusal fence") ,("organisation_id"=MembershipIdentifier,Path)),responses((status=200,body=MembershipSnapshot),(status=400,body=ErrorResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=409,body=ErrorResponse),(status=412,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn snapshot(
    State(state): State<MembershipState>,
    headers: HeaderMap,
    Path(organisation): Path<String>,
    query: Result<Query<SnapshotQuery>, QueryRejection>,
) -> Response {
    let (current, repository) = match current(&state, &headers, false).await {
        Ok(value) => value,
        Err(error) => return error.into_response(),
    };
    if !valid_scope_id(&organisation) {
        return failure(MembershipError::Denied);
    }
    let Ok(Query(query)) = query else {
        return failure(MembershipError::Invalid);
    };
    outcome(
        repository
            .snapshot(
                &current.identity.id,
                &organisation,
                query.members_after.as_deref(),
                query.invitations_after.as_deref(),
                query.engagements_after.as_deref(),
            )
            .await,
    )
}

#[utoipa::path(
    get,
    path = "/membership/organisations/{organisation_id}/members/{actor_id}/assignments",
    operation_id = "membership_member_assignments",
    security(("server_session"=[])),
    params(
        ("organisation_id"=MembershipIdentifier,Path),
        ("actor_id"=MembershipIdentifier,Path),
        ("after"=Option<MembershipAssignmentCursor>,Query),
        ("X-Expected-Session"=Option<String>,Header,min_length=1,max_length=128,description="Additional current session refusal fence")
    ),
    responses(
        (status=200,description="Current Admin's bounded page of effective member assignments",body=MembershipMemberAssignments),
        (status=400,body=ErrorResponse),
        (status=401,body=ErrorResponse),
        (status=403,body=ErrorResponse),
        (status=412,body=ErrorResponse),
        (status=429,body=ErrorResponse),
        (status=503,body=ErrorResponse)
    )
)]
pub(crate) async fn member_assignments(
    State(state): State<MembershipState>,
    headers: HeaderMap,
    Path((organisation, actor)): Path<(String, String)>,
    query: Result<Query<OrganisationQuery>, QueryRejection>,
) -> Response {
    let (current, repository) = match current(&state, &headers, false).await {
        Ok(value) => value,
        Err(error) => return error.into_response(),
    };
    if !valid_scope_id(&organisation) || !valid_scope_id(&actor) {
        return failure(MembershipError::Denied);
    }
    let Ok(Query(query)) = query else {
        return failure(MembershipError::Invalid);
    };
    outcome(
        repository
            .member_assignments(
                &current.identity.id,
                &organisation,
                &actor,
                query.after.as_deref(),
            )
            .await,
    )
}

#[utoipa::path(post,path="/membership/organisations/{organisation_id}/members",operation_id="membership_save_member",security(("server_session"=[])),params(("X-Expected-Session"=Option<String>,Header,description="Additional current session refusal fence") ,("organisation_id"=MembershipIdentifier,Path) ,("Origin"=String,Header),("X-CSRF-Token"=String,Header),("X-Expected-Actor"=MembershipIdentifier,Header,description="Required exact current actor refusal fence")),request_body=SaveMemberRequest,responses((status=200,body=MembershipReceipt),(status=400,description="Invalid membership command; unknown fields, vocabulary and out-of-range values refuse without changes",body=ErrorResponse,examples(("invalidRenewal"=(description="assignments:[{client_id:\"client\",engagement_id:\"engagement\",renew:\"true\"}] is rejected: renew must be a boolean. Remove mode also rejects renew:true; omitted renewal means false.",value=json!({"error":"invalid_membership"}))), ("unknownRole"=(description="A request containing roles:[\"owner\"] is rejected; only auditor, audit_manager and admin are application roles.",value=json!({"error":"invalid_membership"}))), ("noncanonicalVersion"=(description="expected_version:\"01\", a negative value or a decimal above 9223372036854775807 is rejected.",value=json!({"error":"invalid_membership"}))), ("outOfRangeExpiry"=(description="expires_at:253402300800 is rejected; use null or Unix seconds from 1 through 253402300799.",value=json!({"error":"invalid_membership"}))), ("invalidSecret"=(description="An invitation secret shorter or longer than 43 base64url characters is rejected.",value=json!({"error":"invalid_membership"}))))),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=409,body=ErrorResponse),(status=412,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn save_member(
    State(state): State<MembershipState>,
    headers: HeaderMap,
    Path(organisation): Path<String>,
    body: Result<Json<SaveMemberRequest>, JsonRejection>,
) -> Response {
    let (current, repository) = match current(&state, &headers, true).await {
        Ok(value) => value,
        Err(error) => return error.into_response(),
    };
    if !valid_scope_id(&organisation) {
        return failure(MembershipError::Denied);
    }
    let Ok(Json(body)) = body else {
        return failure(MembershipError::Invalid);
    };
    let command: application::SaveMember = body.into();
    if !command.is_valid() {
        return failure(MembershipError::Invalid);
    }
    outcome(
        repository
            .save_member(&current.identity.id, &organisation, &command)
            .await,
    )
}

#[utoipa::path(post,path="/membership/organisations/{organisation_id}/invitations",operation_id="membership_invite",security(("server_session"=[])),params(("X-Expected-Session"=Option<String>,Header,description="Additional current session refusal fence") ,("organisation_id"=MembershipIdentifier,Path) ,("Origin"=String,Header),("X-CSRF-Token"=String,Header),("X-Expected-Actor"=MembershipIdentifier,Header,description="Required exact current actor refusal fence")),request_body=InviteMemberRequest,responses((status=200,body=MembershipReceipt),(status=400,description="Invalid membership command; unknown fields, vocabulary and out-of-range values refuse without changes",body=ErrorResponse,examples(("unknownRole"=(description="A request containing roles:[\"owner\"] is rejected; only auditor, audit_manager and admin are application roles.",value=json!({"error":"invalid_membership"}))), ("noncanonicalVersion"=(description="expected_version:\"01\", a negative value or a decimal above 9223372036854775807 is rejected.",value=json!({"error":"invalid_membership"}))), ("outOfRangeExpiry"=(description="expires_at:253402300800 is rejected; use null or Unix seconds from 1 through 253402300799.",value=json!({"error":"invalid_membership"}))), ("invalidSecret"=(description="An invitation secret shorter or longer than 43 base64url characters is rejected.",value=json!({"error":"invalid_membership"}))))),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=409,body=ErrorResponse),(status=412,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn invite(
    State(state): State<MembershipState>,
    headers: HeaderMap,
    Path(organisation): Path<String>,
    body: Result<Json<InviteMemberRequest>, JsonRejection>,
) -> Response {
    let (current, repository) = match current(&state, &headers, true).await {
        Ok(value) => value,
        Err(error) => return error.into_response(),
    };
    if !valid_scope_id(&organisation) {
        return failure(MembershipError::Denied);
    }
    let Ok(Json(body)) = body else {
        return failure(MembershipError::Invalid);
    };
    let command: application::InviteCommand = body.into();
    if !command.is_valid() {
        return failure(MembershipError::Invalid);
    }
    outcome(
        repository
            .invite(&current.identity.id, &organisation, &command)
            .await,
    )
}

#[utoipa::path(post,path="/membership/organisations/{organisation_id}/invitations/revoke",operation_id="membership_revoke_invitation",security(("server_session"=[])),params(("X-Expected-Session"=Option<String>,Header,description="Additional current session refusal fence") ,("organisation_id"=MembershipIdentifier,Path) ,("Origin"=String,Header),("X-CSRF-Token"=String,Header),("X-Expected-Actor"=MembershipIdentifier,Header,description="Required exact current actor refusal fence")),request_body=RevokeInvitationRequest,responses((status=200,body=MembershipReceipt),(status=400,body=ErrorResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=409,body=ErrorResponse),(status=412,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn revoke_invitation(
    State(state): State<MembershipState>,
    headers: HeaderMap,
    Path(organisation): Path<String>,
    body: Result<Json<RevokeInvitationRequest>, JsonRejection>,
) -> Response {
    let (current, repository) = match current(&state, &headers, true).await {
        Ok(value) => value,
        Err(error) => return error.into_response(),
    };
    if !valid_scope_id(&organisation) {
        return failure(MembershipError::Denied);
    }
    let Ok(Json(body)) = body else {
        return failure(MembershipError::Invalid);
    };
    let command: application::RevokeInvitation = body.into();
    if !command.is_valid() {
        return failure(MembershipError::Invalid);
    }
    outcome(
        repository
            .revoke_invitation(&current.identity.id, &organisation, &command)
            .await,
    )
}

#[utoipa::path(post,path="/membership/invitations/accept",operation_id="membership_accept_invitation",security(("server_session"=[])),params(("X-Expected-Session"=Option<String>,Header,description="Additional current session refusal fence") ,("Origin"=String,Header),("X-CSRF-Token"=String,Header),("X-Expected-Actor"=MembershipIdentifier,Header,description="Required exact current actor refusal fence")),request_body=AcceptInvitationRequest,responses((status=200,body=MembershipReceipt),(status=400,description="Invalid membership command; unknown fields, vocabulary and out-of-range values refuse without changes",body=ErrorResponse,examples(("unknownRole"=(description="A request containing roles:[\"owner\"] is rejected; only auditor, audit_manager and admin are application roles.",value=json!({"error":"invalid_membership"}))), ("noncanonicalVersion"=(description="expected_version:\"01\", a negative value or a decimal above 9223372036854775807 is rejected.",value=json!({"error":"invalid_membership"}))), ("outOfRangeExpiry"=(description="expires_at:253402300800 is rejected; use null or Unix seconds from 1 through 253402300799.",value=json!({"error":"invalid_membership"}))), ("invalidSecret"=(description="An invitation secret shorter or longer than 43 base64url characters is rejected.",value=json!({"error":"invalid_membership"}))))),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=409,body=ErrorResponse),(status=412,body=ErrorResponse),(status=429,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn accept(
    State(state): State<MembershipState>,
    headers: HeaderMap,
    body: Result<Json<AcceptInvitationRequest>, JsonRejection>,
) -> Response {
    let (current, repository) = match current(&state, &headers, true).await {
        Ok(value) => value,
        Err(error) => return error.into_response(),
    };
    let Ok(Json(body)) = body else {
        return failure(MembershipError::Invalid);
    };
    if !valid_scope_id(&body.key)
        || !zobba_domain::membership::valid_invitation_secret(&body.secret)
    {
        return failure(MembershipError::Invalid);
    }
    let Some(token) = auth::cookie(&headers, auth::SESSION_COOKIE) else {
        return failure(MembershipError::Denied);
    };
    outcome(
        repository
            .accept(
                &current.identity.id,
                &secret_hash(&token),
                &body.secret,
                &body.key,
            )
            .await,
    )
}
