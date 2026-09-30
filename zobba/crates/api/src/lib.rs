//! Owned HTTP interface. OpenAPI is generated from these handler and wire types.
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

#[derive(OpenApi)]
#[openapi(
    info(
        title = "Zobba owned HTTP interface",
        version = "1.0.0",
        description = "Bootstrap service health only. No audit, identity or Task capability is implied."
    ),
    paths(live, ready),
    components(schemas(HealthResponse, Service, HealthStatus))
)]
pub struct ApiDocument;
