//! Explicit organisation/client/engagement selection after current session lookup.
use crate::auth::{AuthState, ErrorResponse, failure};
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::HeaderMap,
    response::{IntoResponse, Response},
    routing::get,
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use zobba_application::identity::{CurrentAuthority, IdentityError};
use zobba_domain::identity::{Engagement, Scope};

#[derive(Serialize, ToSchema)]
pub struct ScopeResponse {
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub organisation_id: String,
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub client_id: String,
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub engagement_id: String,
}
impl From<Scope> for ScopeResponse {
    fn from(value: Scope) -> Self {
        Self {
            organisation_id: value.organisation_id,
            client_id: value.client_id,
            engagement_id: value.engagement_id,
        }
    }
}

#[derive(Serialize, ToSchema)]
pub struct EngagementResponse {
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub organisation_id: String,
    /// 1–200 Unicode scalars; no C0/C1 controls or leading/trailing Unicode White_Space.
    #[schema(min_length = 1, max_length = 200)]
    pub organisation_name: String,
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub client_id: String,
    /// 1–200 Unicode scalars; no C0/C1 controls or leading/trailing Unicode White_Space.
    #[schema(min_length = 1, max_length = 200)]
    pub client_name: String,
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub engagement_id: String,
    /// 1–200 Unicode scalars; no C0/C1 controls or leading/trailing Unicode White_Space.
    #[schema(min_length = 1, max_length = 200)]
    pub engagement_name: String,
    pub roles: Vec<String>,
}
impl From<Engagement> for EngagementResponse {
    fn from(value: Engagement) -> Self {
        Self {
            organisation_id: value.scope.organisation_id,
            organisation_name: value.organisation_name,
            client_id: value.scope.client_id,
            client_name: value.client_name,
            engagement_id: value.scope.engagement_id,
            engagement_name: value.engagement_name,
            roles: value
                .roles
                .into_iter()
                .map(|role| role.as_str().to_owned())
                .collect(),
        }
    }
}
#[derive(Serialize, ToSchema)]
pub struct EngagementsResponse {
    #[schema(max_items = 50)]
    pub engagements: Vec<EngagementResponse>,
    /// Continue after this complete scope tuple; null means no further current assignments.
    #[schema(required = true)]
    pub next_cursor: Option<ScopeResponse>,
}

#[derive(Deserialize, Default)]
pub(crate) struct PageQuery {
    after_organisation_id: Option<String>,
    after_client_id: Option<String>,
    after_engagement_id: Option<String>,
}
impl PageQuery {
    fn cursor(self) -> Result<Option<Scope>, IdentityError> {
        match (
            self.after_organisation_id,
            self.after_client_id,
            self.after_engagement_id,
        ) {
            (None, None, None) => Ok(None),
            (Some(organisation_id), Some(client_id), Some(engagement_id)) => {
                let scope = Scope {
                    organisation_id,
                    client_id,
                    engagement_id,
                };
                if scope.is_valid() {
                    Ok(Some(scope))
                } else {
                    Err(IdentityError::InvalidScope)
                }
            }
            _ => Err(IdentityError::InvalidScope),
        }
    }
}

pub(crate) fn router() -> Router<AuthState> {
    Router::new()
        .route("/engagements", get(list))
        .route("/engagements/{engagement_id}", get(open))
}

#[utoipa::path(get,path="/engagements",security(("server_session"=[])),
    params(("X-Expected-Session"=Option<String>,Header,description="Optional session-bound read precondition from the in-memory session CSRF token; mismatch refuses without changing the cookie",min_length=1,max_length=128),
        ("after_organisation_id"=Option<String>,Query,description="Supply all three cursor fields together",min_length=1,max_length=128,pattern="^[A-Za-z0-9_-]+$"),
        ("after_client_id"=Option<String>,Query,min_length=1,max_length=128,pattern="^[A-Za-z0-9_-]+$"),
        ("after_engagement_id"=Option<String>,Query,min_length=1,max_length=128,pattern="^[A-Za-z0-9_-]+$")
    ),
    responses((status=412,description="Session changed; compose fresh reads without replacing the current cookie",body=ErrorResponse),(status=200,description="Freshly authorized page, ordered by complete scope identity",body=EngagementsResponse),(status=400,description="Incomplete or invalid cursor",body=ErrorResponse),(status=401,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn list(
    State(state): State<AuthState>,
    headers: HeaderMap,
    query: Result<Query<PageQuery>, axum::extract::rejection::QueryRejection>,
) -> Response {
    let current = match state.current_read(&headers).await {
        Ok(current) => current,
        Err(error) => return failure(error),
    };
    let after = match query
        .map_err(|_| IdentityError::InvalidScope)
        .and_then(|Query(query)| query.cursor())
    {
        Ok(cursor) => cursor,
        Err(error) => return failure(error),
    };
    match state
        .repository
        .engagements(&current.identity.id, after.as_ref())
        .await
    {
        Ok(page) => Json(EngagementsResponse {
            engagements: page.engagements.into_iter().map(Into::into).collect(),
            next_cursor: page.next_cursor.map(Into::into),
        })
        .into_response(),
        Err(error) => failure(error),
    }
}

#[derive(Deserialize)]
pub(crate) struct ScopeQuery {
    organisation_id: String,
    client_id: String,
}

#[utoipa::path(get,path="/engagements/{engagement_id}",security(("server_session"=[])),
    params(("X-Expected-Session"=Option<String>,Header,description="Optional session-bound read precondition from the in-memory session CSRF token; mismatch refuses without changing the cookie",min_length=1,max_length=128),
        ("engagement_id"=String,Path,min_length=1,max_length=128,pattern="^[A-Za-z0-9_-]+$"),
        ("organisation_id"=String,Query,min_length=1,max_length=128,pattern="^[A-Za-z0-9_-]+$"),
        ("client_id"=String,Query,min_length=1,max_length=128,pattern="^[A-Za-z0-9_-]+$")
    ),responses((status=412,description="Session changed; compose fresh reads without replacing the current cookie",body=ErrorResponse),(status=200,description="Explicit scope opened independently of chooser page",body=EngagementResponse),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=503,body=ErrorResponse)))]
pub(crate) async fn open(
    State(state): State<AuthState>,
    headers: HeaderMap,
    Path(engagement_id): Path<String>,
    query: Result<Query<ScopeQuery>, axum::extract::rejection::QueryRejection>,
) -> Response {
    let current = match state.current_read(&headers).await {
        Ok(current) => current,
        Err(error) => return failure(error),
    };
    let Query(query) = match query {
        Ok(query) => query,
        Err(_) => return failure(IdentityError::Denied),
    };
    let scope = Scope {
        organisation_id: query.organisation_id,
        client_id: query.client_id,
        engagement_id,
    };
    if !scope.is_valid() {
        return failure(IdentityError::Denied);
    }
    match state
        .repository
        .engagement(&current.identity.id, &scope)
        .await
    {
        Ok(engagement) => Json(EngagementResponse::from(engagement)).into_response(),
        Err(error) => failure(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cursor_requires_one_complete_valid_tuple() {
        assert_eq!(PageQuery::default().cursor(), Ok(None));
        assert_eq!(
            PageQuery {
                after_organisation_id: Some("org".into()),
                ..PageQuery::default()
            }
            .cursor(),
            Err(IdentityError::InvalidScope)
        );
        assert!(
            PageQuery {
                after_organisation_id: Some("org".into()),
                after_client_id: Some("client".into()),
                after_engagement_id: Some("e".repeat(128))
            }
            .cursor()
            .unwrap()
            .is_some()
        );
        assert_eq!(
            PageQuery {
                after_organisation_id: Some("org".into()),
                after_client_id: Some("client".into()),
                after_engagement_id: Some("e".repeat(129))
            }
            .cursor(),
            Err(IdentityError::InvalidScope)
        );
    }
}
