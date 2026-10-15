//! Cookie sessions and browser-bound OIDC code flow. Only fixed errors reach clients.
use axum::{
    Json, Router,
    extract::{Query, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Redirect, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;
use utoipa::ToSchema;
use zobba_application::{
    BootstrapError,
    identity::{CurrentAuthority, CurrentSession, IdentityError},
};
use zobba_infrastructure::{
    RuntimeDatabase,
    identity::{IdentityRepository, LOGIN_SECONDS, SESSION_SECONDS, random_secret, secret_matches},
    oidc::{OidcConfig, OidcProvider},
};

pub(crate) const SESSION_COOKIE: &str = "__Host-zobba-session";
const LOGIN_COOKIE: &str = "__Host-zobba-login";

#[derive(Clone)]
pub struct AuthState {
    pub(crate) repository: IdentityRepository,
    origin: String,
    config: Option<OidcConfig>,
    provider: Arc<Mutex<ProviderState>>,
}

#[derive(Default)]
struct ProviderState {
    provider: Option<OidcProvider>,
    retry_after: Option<tokio::time::Instant>,
}

impl AuthState {
    pub fn from_environment(database: &RuntimeDatabase) -> Result<Self, BootstrapError> {
        let config = OidcConfig::from_env().map_err(|_| BootstrapError::InvalidConfiguration)?;
        let origin = match std::env::var("ZOBBA_PUBLIC_ORIGIN") {
            Ok(value) => {
                let url =
                    url::Url::parse(&value).map_err(|_| BootstrapError::InvalidConfiguration)?;
                if url.scheme() != "https"
                    || url.host_str().is_none()
                    || !url.username().is_empty()
                    || url.password().is_some()
                    || url.path() != "/"
                    || url.query().is_some()
                    || url.fragment().is_some()
                    || value != url.origin().ascii_serialization()
                {
                    return Err(BootstrapError::InvalidConfiguration);
                }
                value
            }
            Err(_) if config.is_none() => String::new(),
            Err(_) => return Err(BootstrapError::InvalidConfiguration),
        };
        Ok(Self {
            repository: IdentityRepository::new(database.pool().clone()),
            origin,
            config,
            provider: Arc::new(Mutex::new(ProviderState::default())),
        })
    }

    async fn provider(&self) -> Result<OidcProvider, IdentityError> {
        let mut slot = self.provider.lock().await;
        if let Some(provider) = slot.provider.as_ref() {
            return Ok(provider.clone());
        }
        if slot
            .retry_after
            .is_some_and(|deadline| deadline > tokio::time::Instant::now())
        {
            return Err(IdentityError::Unavailable);
        }
        let config = self.config.clone().ok_or(IdentityError::Unavailable)?;
        // Set before awaiting so cancellation cannot turn a failed/slow discovery
        // into an immediate retry storm for requests queued on the same mutex.
        slot.retry_after = Some(tokio::time::Instant::now() + Duration::from_secs(15));
        let provider = match OidcProvider::initialize(config).await {
            Ok(provider) => provider,
            Err(_) => {
                slot.retry_after = Some(tokio::time::Instant::now() + Duration::from_secs(5));
                return Err(IdentityError::Unavailable);
            }
        };
        slot.provider = Some(provider.clone());
        slot.retry_after = None;
        Ok(provider)
    }

    pub(crate) async fn current(
        &self,
        headers: &HeaderMap,
    ) -> Result<CurrentSession, IdentityError> {
        let token = cookie(headers, SESSION_COOKIE).ok_or(IdentityError::Unauthenticated)?;
        self.repository.session(&token).await
    }

    pub(crate) async fn current_read(
        &self,
        headers: &HeaderMap,
    ) -> Result<CurrentSession, IdentityError> {
        let current = self.current(headers).await?;
        // The cookie remains the authority. A browser composing several reads
        // may only add this refusal precondition; it cannot select a session.
        if !expected_session_matches(headers, &current.csrf_token) {
            return Err(IdentityError::SessionChanged);
        }
        Ok(current)
    }

    /// Reserved Task controls use the same identity rules through their own pool.
    pub(crate) fn with_repository(mut self, repository: IdentityRepository) -> Self {
        self.repository = repository;
        self
    }

    pub(crate) fn permits_mutation(&self, headers: &HeaderMap, csrf: &str) -> bool {
        valid_mutation(headers, &self.origin, csrf)
    }

    pub(crate) fn configured_issuer(&self) -> &str {
        self.config
            .as_ref()
            .map_or("", |config| config.issuer.as_str())
    }
}

pub fn router(state: AuthState) -> Router {
    Router::new()
        .route("/auth/login", get(login))
        .route("/auth/callback", get(callback))
        .route("/auth/session", get(session))
        .route("/auth/logout", post(logout))
        .merge(crate::engagements::router())
        .with_state(state)
}

pub(crate) fn cookie(headers: &HeaderMap, name: &str) -> Option<String> {
    let mut values = headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(';'))
        .filter_map(|part| part.trim().split_once('='))
        .filter(|(key, _)| *key == name)
        .map(|(_, value)| value);
    let value = values.next()?;
    if value.len() > 128 || values.next().is_some() {
        return None;
    }
    Some(value.to_owned())
}

fn set_cookie(response: &mut Response, name: &str, value: &str, age: i64) {
    let value = format!("{name}={value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age={age}");
    if let Ok(value) = HeaderValue::from_str(&value) {
        response.headers_mut().append(header::SET_COOKIE, value);
    }
}

#[derive(Serialize, ToSchema)]
pub struct ErrorResponse {
    pub error: &'static str,
}

pub(crate) fn failure(error: IdentityError) -> Response {
    let status = match error {
        IdentityError::Unauthenticated => StatusCode::UNAUTHORIZED,
        IdentityError::SessionChanged => StatusCode::PRECONDITION_FAILED,
        IdentityError::Denied => StatusCode::FORBIDDEN,
        IdentityError::Unavailable => StatusCode::SERVICE_UNAVAILABLE,
        IdentityError::InvalidResponse
        | IdentityError::ExpiredLoginConsumed
        | IdentityError::InvalidScope => StatusCode::BAD_REQUEST,
        IdentityError::Capacity => StatusCode::TOO_MANY_REQUESTS,
    };
    // A delayed unauthorized response may belong to an older cookie than the
    // browser now holds. Only explicit logout expires the browser cookie.
    (
        status,
        Json(ErrorResponse {
            error: error.code(),
        }),
    )
        .into_response()
}

fn expected_session_matches(headers: &HeaderMap, csrf: &str) -> bool {
    let mut expected = headers.get_all("x-expected-session").iter();
    let Some(value) = expected.next() else {
        return true;
    };
    expected.next().is_none()
        && value.to_str().ok().is_some_and(|value| {
            !value.is_empty() && value.len() <= 128 && secret_matches(csrf, value)
        })
}

pub(crate) fn wants_html(headers: &HeaderMap) -> bool {
    headers
        .get(header::ACCEPT)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| {
            value
                .split(',')
                .any(|item| item.trim().starts_with("text/html"))
        })
}

pub(crate) fn login_failure(error: IdentityError, html: bool) -> Response {
    if html {
        let status = if error == IdentityError::Capacity {
            StatusCode::TOO_MANY_REQUESTS
        } else {
            StatusCode::SERVICE_UNAVAILABLE
        };
        (status, axum::response::Html("<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Sign-in unavailable · Zobba</title><body><main><h1>Sign-in is temporarily unavailable</h1><p>We could not connect securely to complete sign-in. Please try again.</p><p><a href=\"/\">Return to Zobba</a></p></main></body></html>"))
            .into_response()
    } else {
        failure(error)
    }
}

#[utoipa::path(get,path="/auth/login",responses((status=303,description="Redirect to trusted OIDC sign-in with one-use state and PKCE"),(status=429,description="Outstanding sign-in capacity reached; try again later",content((ErrorResponse="application/json"),(String="text/html"))),(status=503,description="Recoverable sign-in failure; native browser navigation receives an HTML return link",content((ErrorResponse="application/json"),(String="text/html")))))]
async fn login(State(state): State<AuthState>, headers: HeaderMap) -> Response {
    let html = wants_html(&headers);
    let result = async move {
        let provider = state.provider().await?;
        let oauth_state = random_secret()?;
        let binding = random_secret()?;
        let nonce = random_secret()?;
        let verifier = random_secret()?;
        let location = provider
            .authorization_url(&oauth_state, &nonce, &verifier)
            .map_err(|_| IdentityError::Unavailable)?;
        state
            .repository
            .begin_login(&oauth_state, &binding, &nonce, &verifier)
            .await?;
        let mut response = Redirect::to(&location).into_response();
        set_cookie(&mut response, LOGIN_COOKIE, &binding, LOGIN_SECONDS);
        Ok::<_, IdentityError>(response)
    }
    .await;
    result.unwrap_or_else(|error| login_failure(error, html))
}

#[derive(Deserialize)]
struct CallbackQuery {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

#[utoipa::path(get,path="/auth/callback",security(("login_binding"=[])),
    params(
        ("state"=String,Query,description="Exact one-use state from the current login attempt",min_length=43,max_length=43,pattern="^[A-Za-z0-9_-]+$"),
        ("code"=Option<String>,Query,description="One-use provider authorization code; required unless error is present",min_length=1,max_length=4096),
        ("error"=Option<String>,Query,description="Provider denial code; never reflected to clients",max_length=128)
    ),responses((status=303,description="Verified success rotates session; failure returns only fixed sign-in status to configured app. Clear only matching consumed binding."),(status=400,description="Invalid response when no application origin is configured",body=ErrorResponse),(status=503,description="Whole-request deadline exceeded",body=ErrorResponse)))]
async fn callback(
    State(state): State<AuthState>,
    headers: HeaderMap,
    query: Result<Query<CallbackQuery>, axum::extract::rejection::QueryRejection>,
) -> Response {
    let mut clear_binding = false;
    let result = async {
        let Query(query) = query.map_err(|_| IdentityError::InvalidResponse)?;
        if query.error.as_ref().is_some_and(|error| error.len() > 128) {
            return Err(IdentityError::InvalidResponse);
        }
        let oauth_state = query
            .state
            .as_deref()
            .ok_or(IdentityError::InvalidResponse)?;
        let binding = cookie(&headers, LOGIN_COOKIE).ok_or(IdentityError::InvalidResponse)?;
        let attempt = match state.repository.consume_login(oauth_state, &binding).await {
            Ok(attempt) => {
                clear_binding = true;
                attempt
            }
            Err(IdentityError::ExpiredLoginConsumed) => {
                clear_binding = true;
                return Err(IdentityError::ExpiredLoginConsumed);
            }
            Err(error) => return Err(error),
        };
        if query.error.is_some() {
            return Err(IdentityError::InvalidResponse);
        }
        let code = query
            .code
            .as_deref()
            .filter(|code| !code.is_empty() && code.len() <= 4096)
            .ok_or(IdentityError::InvalidResponse)?;
        let provider = state.provider().await?;
        let verified = provider
            .exchange(code, &attempt.pkce_verifier, &attempt.nonce)
            .await
            .map_err(|_| IdentityError::InvalidResponse)?;
        let token = state
            .repository
            .establish_verified_session(
                &verified.issuer,
                &verified.subject,
                &verified.display_name,
                verified.verified_email.as_deref(),
                cookie(&headers, SESSION_COOKIE).as_deref(),
            )
            .await?;
        Ok::<_, IdentityError>(token)
    }
    .await;
    let mut response = match result {
        Ok(token) => {
            let mut response = Redirect::to(&format!("{}/", state.origin)).into_response();
            set_cookie(&mut response, SESSION_COOKIE, &token, SESSION_SECONDS);
            response
        }
        Err(_) => {
            if state.origin.is_empty() {
                failure(IdentityError::InvalidResponse)
            } else {
                Redirect::to(&format!("{}/?auth_error=sign_in_failed", state.origin))
                    .into_response()
            }
        }
    };
    if clear_binding {
        set_cookie(&mut response, LOGIN_COOKIE, "", 0);
    }
    response
}

#[derive(Serialize, ToSchema)]
pub struct IdentityResponse {
    pub id: String,
    pub display_name: String,
}

#[derive(Serialize, ToSchema)]
pub struct SessionResponse {
    pub identity: IdentityResponse,
    pub csrf_token: String,
}

#[utoipa::path(get,path="/auth/session",security(("server_session"=[])),params(("X-Expected-Session"=Option<String>,Header,description="Optional session-bound read precondition from the in-memory session CSRF token; mismatch refuses without changing the cookie",min_length=1,max_length=128)),responses((status=412,description="Session changed; compose fresh reads without replacing the current cookie",body=ErrorResponse),(status=200,body=SessionResponse),(status=401,body=ErrorResponse),(status=503,body=ErrorResponse)))]
async fn session(State(state): State<AuthState>, headers: HeaderMap) -> Response {
    match state.current_read(&headers).await {
        Ok(current) => Json(SessionResponse {
            identity: IdentityResponse {
                id: current.identity.id,
                display_name: current.identity.display_name,
            },
            csrf_token: current.csrf_token,
        })
        .into_response(),
        Err(error) => failure(error),
    }
}

fn valid_mutation(headers: &HeaderMap, origin: &str, csrf: &str) -> bool {
    !origin.is_empty()
        && headers.get_all(header::ORIGIN).iter().count() == 1
        && headers.get_all("x-csrf-token").iter().count() == 1
        && headers
            .get(header::ORIGIN)
            .and_then(|value| value.to_str().ok())
            == Some(origin)
        && headers
            .get("x-csrf-token")
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.len() <= 128 && secret_matches(csrf, value))
}

#[utoipa::path(post,path="/auth/logout",security(("server_session"=[])),
    params(
        ("Origin"=String,Header,description="Exactly the configured HTTPS application origin, supplied by the browser"),
        ("X-CSRF-Token"=String,Header,description="Current session-bound CSRF token from GET /auth/session",min_length=43,max_length=43,pattern="^[A-Za-z0-9_-]+$")
    ),responses((status=204,description="Server session deleted and cookie expired"),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=503,body=ErrorResponse)))]
async fn logout(State(state): State<AuthState>, headers: HeaderMap) -> Response {
    let current = match state.current(&headers).await {
        Ok(current) => current,
        Err(error) => return failure(error),
    };
    if !valid_mutation(&headers, &state.origin, &current.csrf_token) {
        return failure(IdentityError::Denied);
    }
    let Some(token) = cookie(&headers, SESSION_COOKIE) else {
        return failure(IdentityError::Unauthenticated);
    };
    if let Err(error) = state.repository.logout(&token).await {
        return failure(error);
    }
    let mut response = StatusCode::NO_CONTENT.into_response();
    set_cookie(&mut response, SESSION_COOKIE, "", 0);
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn read_session_preconditions_are_independent_of_mutation_csrf() {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::ORIGIN,
            HeaderValue::from_static("https://zobba.test"),
        );
        headers.insert("x-csrf-token", HeaderValue::from_static("current"));
        headers.insert("x-expected-session", HeaderValue::from_static("obsolete"));
        assert!(!expected_session_matches(&headers, "current"));
        assert!(valid_mutation(&headers, "https://zobba.test", "current"));

        headers.append("x-expected-session", HeaderValue::from_static("current"));
        assert!(!expected_session_matches(&headers, "current"));
        assert!(valid_mutation(&headers, "https://zobba.test", "current"));

        headers.insert("x-expected-session", HeaderValue::from_static("current"));
        headers.insert("x-csrf-token", HeaderValue::from_static("obsolete"));
        assert!(expected_session_matches(&headers, "current"));
        assert!(!valid_mutation(&headers, "https://zobba.test", "current"));
    }
    #[test]
    fn composed_reads_refuse_changed_or_ambiguous_sessions_without_clearing_cookies() {
        let mut headers = HeaderMap::new();
        assert!(expected_session_matches(&headers, "current"));
        headers.insert("x-expected-session", HeaderValue::from_static("current"));
        assert!(expected_session_matches(&headers, "current"));
        assert!(!expected_session_matches(&headers, "replacement"));
        headers.append("x-expected-session", HeaderValue::from_static("current"));
        assert!(!expected_session_matches(&headers, "current"));
        for value in ["".to_owned(), "x".repeat(129)] {
            headers.insert("x-expected-session", HeaderValue::from_str(&value).unwrap());
            assert!(!expected_session_matches(&headers, &value));
        }
        for error in [
            IdentityError::SessionChanged,
            IdentityError::Unauthenticated,
        ] {
            let response = failure(error);
            assert!(!response.headers().contains_key(header::SET_COOKIE));
            assert_eq!(
                response.status(),
                if error == IdentityError::SessionChanged {
                    StatusCode::PRECONDITION_FAILED
                } else {
                    StatusCode::UNAUTHORIZED
                }
            );
        }
    }
    #[test]
    fn mutations_require_exact_origin_and_session_csrf() {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::ORIGIN,
            HeaderValue::from_static("https://localhost:5173"),
        );
        headers.insert("x-csrf-token", HeaderValue::from_static("session-secret"));
        assert!(valid_mutation(
            &headers,
            "https://localhost:5173",
            "session-secret"
        ));
        assert!(!valid_mutation(
            &headers,
            "https://localhost:5173/",
            "session-secret"
        ));
        assert!(!valid_mutation(
            &headers,
            "https://localhost:5173",
            "different-secret"
        ));
        headers.append(
            header::ORIGIN,
            HeaderValue::from_static("https://localhost:5173"),
        );
        assert!(!valid_mutation(
            &headers,
            "https://localhost:5173",
            "session-secret"
        ));
        headers.insert(
            header::ORIGIN,
            HeaderValue::from_static("https://localhost:5173"),
        );
        headers.append("x-csrf-token", HeaderValue::from_static("session-secret"));
        assert!(!valid_mutation(
            &headers,
            "https://localhost:5173",
            "session-secret"
        ));
        headers.insert("x-csrf-token", HeaderValue::from_static("session-secret"));
        headers.remove(header::ORIGIN);
        assert!(!valid_mutation(
            &headers,
            "https://localhost:5173",
            "session-secret"
        ));
    }
    #[test]
    fn duplicate_cookies_do_not_select_an_ambiguous_session() {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::COOKIE,
            HeaderValue::from_static("__Host-zobba-session=a; __Host-zobba-session=b"),
        );
        assert!(cookie(&headers, SESSION_COOKIE).is_none());
    }
}
