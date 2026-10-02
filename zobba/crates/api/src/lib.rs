//! Owned HTTP interface. OpenAPI is generated from these handler and wire types.
pub mod auth;
pub mod conversation;
pub mod engagements;
pub mod evidence;
pub mod membership;
pub mod methodology;
pub mod operations;
pub mod tasks;
use axum::{Json, Router, extract::State, http::StatusCode, routing::get};
use serde::Serialize;
use utoipa::{OpenApi, ToSchema};
use zobba_application::readiness;
use zobba_infrastructure::RuntimeDatabase;

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Service {
    Api,
    Worker,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum HealthStatus {
    Live,
    Ready,
    Unavailable,
}

#[derive(Serialize, ToSchema)]
pub struct HealthResponse {
    pub service: Service,
    pub status: HealthStatus,
    #[schema(required = true)]
    pub schema_version: Option<u32>,
}

#[utoipa::path(get, path = "/health/live", responses((status = 200, description = "Process is serving; does not assert database readiness", body = HealthResponse)))]
async fn live() -> Json<HealthResponse> {
    Json(HealthResponse {
        service: Service::Api,
        status: HealthStatus::Live,
        schema_version: None,
    })
}

#[utoipa::path(get, path = "/health/ready", responses((status = 200, description = "Runtime role and exact schema verified", body = HealthResponse), (status = 503, description = "Database or schema unavailable", body = HealthResponse)))]
async fn ready(State(database): State<RuntimeDatabase>) -> (StatusCode, Json<HealthResponse>) {
    match readiness(&database).await {
        Ok(version) => (
            StatusCode::OK,
            Json(HealthResponse {
                service: Service::Api,
                status: HealthStatus::Ready,
                schema_version: Some(version.0),
            }),
        ),
        Err(error) => {
            eprintln!("api: {}", error.code());
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(HealthResponse {
                    service: Service::Api,
                    status: HealthStatus::Unavailable,
                    schema_version: None,
                }),
            )
        }
    }
}

pub fn router(database: RuntimeDatabase) -> Router {
    Router::new()
        .route("/health/live", get(live))
        .route("/health/ready", get(ready))
        .with_state(database)
}

pub fn authenticated_router(database: RuntimeDatabase, identity: auth::AuthState) -> Router {
    let objects = std::env::var("ZOBBA_EVIDENCE_BUCKET")
        .ok()
        .and_then(|bucket| {
            match zobba_infrastructure::evidence::s3::S3EvidenceObjects::from_env(&bucket) {
                Ok(objects) => Some(objects),
                Err(_) => {
                    eprintln!("api: evidence_unavailable");
                    None
                }
            }
        });
    authenticated_router_with_evidence(database, identity, objects)
}

/// Explicit dependency composition. Insecure fixture transports are constructed
/// only by test targets, never by a production environment-variable switch.
pub fn authenticated_router_with_evidence(
    database: RuntimeDatabase,
    identity: auth::AuthState,
    objects: Option<zobba_infrastructure::evidence::s3::S3EvidenceObjects>,
) -> Router {
    let task_routes = tasks::router(&database, identity.clone());
    let membership_routes = membership::router(database.pool().clone(), identity.clone());
    let methodology_routes = methodology::router(database.pool().clone(), identity.clone());
    let evidence_routes = evidence::router(database.pool().clone(), identity.clone(), objects);
    router(database)
        .merge(auth::router(identity))
        .merge(task_routes)
        .merge(membership_routes)
        .merge(methodology_routes)
        .merge(evidence_routes)
        .layer(axum::middleware::from_fn(
            |request: axum::extract::Request, next: axum::middleware::Next| async move {
                let login_document =
                    request.uri().path() == "/auth/login" && auth::wants_html(request.headers());
                let evidence_io = evidence::is_io_request(&request);
                let deadline = if evidence_io { 120 } else { 15 };
                let mut response = match tokio::time::timeout(
                    std::time::Duration::from_secs(deadline),
                    next.run(request),
                )
                .await
                {
                    Ok(response) => response,
                    Err(_) if login_document => auth::login_failure(
                        zobba_application::identity::IdentityError::Unavailable,
                        true,
                    ),
                    Err(_) if evidence_io => {
                        evidence::failure(zobba_application::evidence::EvidenceError::Unavailable)
                    }
                    Err(_) => {
                        auth::failure(zobba_application::identity::IdentityError::Unavailable)
                    }
                };
                response.headers_mut().insert(
                    axum::http::header::CACHE_CONTROL,
                    axum::http::HeaderValue::from_static("no-store"),
                );
                response.headers_mut().insert(
                    axum::http::header::REFERRER_POLICY,
                    axum::http::HeaderValue::from_static("no-referrer"),
                );
                response.headers_mut().insert(
                    axum::http::header::X_CONTENT_TYPE_OPTIONS,
                    axum::http::HeaderValue::from_static("nosniff"),
                );
                response
            },
        ))
}

#[derive(OpenApi)]
#[openapi(
    modifiers(&AuthenticationContract),
    info(
        title = "Zobba owned HTTP interface",
        version = "1.0.0",
        description = "Service health, current scoped identity, durable Task commands, immutable scoped evidence and exact operation decisions under standing Permissions. Provider acceptance and completed effects are distinct; no live connector, model, computer or audit execution is implied."
    ),
    paths(
        live,
        ready,
        auth::login,
        auth::callback,
        auth::session,
        auth::logout,
        engagements::list,
        engagements::open,
        tasks::admit,
        tasks::control,
        tasks::list,
        tasks::get,
        tasks::events,
        conversation::snapshot,
        conversation::history,
        conversation::events,
        operations::list,
        operations::get,
        operations::decide,
        operations::revoke,
        operations::history,
        membership::organisations,
        membership::snapshot,
        membership::member_assignments,
        membership::save_member,
        membership::invite,
        membership::revoke_invitation,
        membership::preview,
        membership::accept,
        methodology::snapshot,
        methodology::save,
        methodology::recall,
        methodology::task_basis,
        evidence::reserve,
        evidence::recover,
        evidence::upload,
        evidence::list,
        evidence::inspect,
        evidence::preview,
        evidence::download
    ),
    components(schemas(
        HealthResponse,
        Service,
        HealthStatus,
        auth::ErrorResponse,
        auth::IdentityResponse,
        auth::SessionResponse,
        engagements::EngagementResponse,
        engagements::EngagementsResponse,
        engagements::ScopeResponse,
        tasks::CommandKindRequest,
        tasks::TaskCommandRequest,
        tasks::ReceiptStatusResponse,
        tasks::CommandReceiptResponse,
        tasks::TaskStateResponse,
        tasks::CessationResponse,
        tasks::TaskResponse,
        tasks::TasksResponse,
        tasks::TaskEventResponse,
        tasks::TaskEventsResponse,
        conversation::ConversationScopeResponse,
        conversation::ConversationAudienceResponse,
        conversation::ConversationMessageResponse,
        conversation::ConversationSnapshotResponse,
        conversation::ConversationHistoryResponse,
        conversation::ConversationFeedResponse,
        operations::PurposeRequest,
        operations::ActionRequest,
        operations::AttachmentRequest,
        operations::CanonicalOperationRequest,
        operations::OperationDecisionRequest,
        operations::OperationDecisionResponse,
        operations::OperationStateResponse,
        operations::OperationResponse,
        operations::OperationsResponse,
        operations::PolicyKindRequest,
        operations::PermissionRevocationRequest,
        operations::PermissionRevocationResponse,
        operations::DecisionHistoryResponse,
        operations::AttemptHistoryResponse,
        operations::SourceFactResponse,
        operations::ObservationSourceResponse,
        operations::ObservationHistoryResponse,
        operations::OperationHistoryResponse,
        membership::MembershipAssignment,
        membership::MembershipAssignmentChange,
        membership::MembershipRole,
        membership::MembershipInvitationStatus,
        membership::MembershipReceiptKind,
        membership::MembershipAssignmentMode,
        membership::MembershipIdentifier,
        membership::MembershipVersion,
        membership::MembershipRecipientEmail,
        membership::MembershipInvitationSecret,
        membership::MembershipAssignmentCursor,
        membership::MembershipMemberAssignment,
        membership::MembershipMemberAssignments,
        membership::MembershipAssignmentOption,
        membership::MembershipOrganisation,
        membership::MembershipOrganisations,
        membership::MembershipMember,
        membership::MembershipInvitation,
        membership::MembershipSnapshot,
        membership::MembershipReceipt,
        membership::SaveMemberRequest,
        membership::InviteMemberRequest,
        membership::RevokeInvitationRequest,
        membership::AcceptInvitationRequest
        ,membership::PreviewInvitationRequest,
        membership::InvitationPreviewResponse,
        methodology::MethodologyTaskContext,
        methodology::MethodologyAssignmentKind,
        methodology::MethodologyAssignmentScope,
        methodology::MethodologyApplicability,
        methodology::MethodologyActivationMode,
        methodology::MethodologyActivation,
        methodology::MethodologyVersionReference,
        methodology::MethodologyRequirement,
        methodology::MethodologyDefinition,
        methodology::MethodologyTemplateDefinition,
        methodology::MethodologyTemplateSection,
        methodology::MethodologySourceKind,
        methodology::MethodologySource,
        methodology::MethodologyText,
        methodology::MethodologyTemplateProse,
        methodology::SaveMethodologyRequest,
        methodology::RecallMethodologyRequest,
        methodology::MethodologyVersionRecord,
        methodology::MethodologyImpact,
        methodology::MethodologySnapshot,
        methodology::MethodologyReceipt,
        methodology::MethodologyResolutionStatus,
        methodology::MethodologyResolvedRequirement,
        methodology::MethodologyResolvedRequirementFields,
        methodology::MethodologyFieldSource,
        methodology::MethodologyResolvedTemplate,
        methodology::MethodologyResolution,
        methodology::MethodologyBinding,
        methodology::MethodologyBindingChange,
        methodology::MethodologyBindingNotice,
        methodology::TaskMethodologyResponse,
        evidence::EvidenceContentIdentity,
        evidence::EvidenceSourceAssertions,
        evidence::EvidenceReservationRequest,
        evidence::EvidenceReservationResponse,
        evidence::EvidenceResponse,
        evidence::EvidencePageResponse,
        evidence::EvidenceReservationPageResponse,
        evidence::EvidencePreviewKind,
        evidence::EvidencePreviewResponse,
        evidence::EvidenceBinary
    ))
)]
pub struct ApiDocument;

struct AuthenticationContract;
impl utoipa::Modify for AuthenticationContract {
    fn modify(&self, document: &mut utoipa::openapi::OpenApi) {
        use utoipa::openapi::security::{ApiKey, ApiKeyValue, SecurityScheme};
        if let Some(components) = document.components.as_mut() {
            components.add_security_scheme("server_session",SecurityScheme::ApiKey(ApiKey::Cookie(ApiKeyValue::with_description("__Host-zobba-session","Opaque server session; Secure, HttpOnly, SameSite=Lax, Path=/; browser managed, never an OIDC provider token"))));
            components.add_security_scheme(
                "login_binding",
                SecurityScheme::ApiKey(ApiKey::Cookie(ApiKeyValue::with_description(
                    "__Host-zobba-login",
                    "One-use current login browser binding; Secure, HttpOnly, SameSite=Lax, Path=/",
                ))),
            );
        }
    }
}
