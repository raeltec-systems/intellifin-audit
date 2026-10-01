//! OIDC relying party. Provider tokens never leave this adapter.
//!
//! The maintained verifier owns JOSE, signature, issuer, audience, expiry and nonce
//! validation. This adapter adds endpoint/body/deadline limits, strict issued-at
//! and authorized-party checks, and a coalesced bounded key-rotation retry.
use base64::Engine;
use openidconnect::{
    AccessToken, AccessTokenHash, AuthenticationFlow, AuthorizationCode, ClaimsVerificationError,
    ClientId, ClientSecret, CsrfToken, EndpointMaybeSet, EndpointNotSet, EndpointSet, HttpRequest,
    HttpResponse, IssuerUrl, JsonWebKeySetUrl, Nonce, OAuth2TokenResponse, PkceCodeChallenge,
    PkceCodeVerifier, RedirectUrl, Scope, SignatureVerificationError, TokenResponse,
    core::{
        CoreClient, CoreIdToken, CoreIdTokenVerifier, CoreJsonWebKeySet, CoreJwsSigningAlgorithm,
        CoreProviderMetadata, CoreResponseType,
    },
};
use std::{
    fmt,
    path::PathBuf,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{
    sync::{Mutex, RwLock},
    time::Instant,
};
use url::Url;
use zobba_domain::membership::normalize_email;

const HTTP_DEADLINE: Duration = Duration::from_secs(5);
const OPERATION_DEADLINE: Duration = Duration::from_secs(12);
const KEY_REFRESH_INTERVAL: Duration = Duration::from_secs(5);
const KEY_CACHE_TTL: Duration = Duration::from_secs(300);
const MAX_METADATA_BYTES: usize = 256 * 1024;
const MAX_TOKEN_BYTES: usize = 64 * 1024;
const MAX_ISSUED_AGE: i64 = 600;
const MAX_FUTURE_SKEW: i64 = 30;
const MAX_TOKEN_LIFETIME: i64 = 3600;

type ProviderClient = CoreClient<
    EndpointSet,
    EndpointNotSet,
    EndpointNotSet,
    EndpointNotSet,
    EndpointMaybeSet,
    EndpointMaybeSet,
>;

/// Diagnostics intentionally carry no provider messages, claims, URLs or tokens.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OidcError {
    InvalidConfiguration,
    ProviderUnavailable,
    InvalidResponse,
}

impl fmt::Display for OidcError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::InvalidConfiguration => "Identity configuration is invalid",
            Self::ProviderUnavailable => "Identity provider is unavailable",
            Self::InvalidResponse => "Sign-in response could not be verified",
        })
    }
}
impl std::error::Error for OidcError {}

/// Configuration is explicit: request Host/forwarded headers never select a destination.
/// Deliberate fixture mode admits only the isolated loopback issuer and app hosts.
#[derive(Clone)]
pub struct OidcConfig {
    pub issuer: String,
    pub client_id: String,
    pub client_secret: String,
    pub public_origin: String,
    pub redirect_uri: String,
    pub authorization_origin: Option<String>,
    pub ca_file: Option<PathBuf>,
    pub local_fixtures: bool,
}

impl OidcConfig {
    pub fn from_env() -> Result<Option<Self>, OidcError> {
        let optional = |name| {
            std::env::var(name).map(Some).or_else(|e| match e {
                std::env::VarError::NotPresent => Ok(None),
                _ => Err(OidcError::InvalidConfiguration),
            })
        };
        let Some(issuer) = optional("ZOBBA_OIDC_ISSUER")? else {
            if [
                "ZOBBA_OIDC_CLIENT_ID",
                "ZOBBA_OIDC_CLIENT_SECRET",
                "ZOBBA_OIDC_REDIRECT_URI",
                "ZOBBA_OIDC_AUTHORIZATION_ORIGIN",
                "ZOBBA_OIDC_CA_FILE",
            ]
            .iter()
            .any(|key| std::env::var_os(key).is_some())
            {
                return Err(OidcError::InvalidConfiguration);
            }
            return Ok(None);
        };
        let required = |name| optional(name)?.ok_or(OidcError::InvalidConfiguration);
        let local_fixtures = match optional("ZOBBA_LOCAL_FIXTURES")?.as_deref() {
            Some("1") => true,
            None | Some("0") => false,
            _ => return Err(OidcError::InvalidConfiguration),
        };
        let config = Self {
            issuer,
            client_id: required("ZOBBA_OIDC_CLIENT_ID")?,
            client_secret: required("ZOBBA_OIDC_CLIENT_SECRET")?,
            public_origin: required("ZOBBA_PUBLIC_ORIGIN")?,
            redirect_uri: required("ZOBBA_OIDC_REDIRECT_URI")?,
            authorization_origin: optional("ZOBBA_OIDC_AUTHORIZATION_ORIGIN")?,
            ca_file: optional("ZOBBA_OIDC_CA_FILE")?.map(PathBuf::from),
            local_fixtures,
        };
        config.validate()?;
        Ok(Some(config))
    }

    fn validate(&self) -> Result<(), OidcError> {
        let issuer = secure_url(&self.issuer)?;
        let origin = configured_origin(&self.public_origin)?;
        let redirect = secure_url(&self.redirect_uri)?;
        let authorization = self
            .authorization_origin
            .as_deref()
            .map(configured_origin)
            .transpose()?;
        if redirect.origin() != origin.origin()
            || redirect.path() != "/api/auth/callback"
            || self.client_id.is_empty()
            || self.client_id.len() > 255
            || self.client_id.chars().any(char::is_control)
            || self.client_secret.is_empty()
            || self.client_secret.len() > 4096
        {
            return Err(OidcError::InvalidConfiguration);
        }
        if self.local_fixtures {
            if issuer.host_str() != Some("127.0.0.1")
                || origin.host_str() != Some("localhost")
                || authorization
                    .as_ref()
                    .is_some_and(|url| url.origin() != issuer.origin())
            {
                return Err(OidcError::InvalidConfiguration);
            }
        } else if self.ca_file.is_some()
            || [&issuer, &origin]
                .into_iter()
                .chain(authorization.iter())
                .any(|url| !matches!(url.host(), Some(url::Host::Domain(host)) if host != "localhost"))
        {
            return Err(OidcError::InvalidConfiguration);
        }
        Ok(())
    }
}

fn secure_url(value: &str) -> Result<Url, OidcError> {
    let url = Url::parse(value).map_err(|_| OidcError::InvalidConfiguration)?;
    if value.len() > 2048
        || url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(OidcError::InvalidConfiguration);
    }
    Ok(url)
}

fn configured_origin(value: &str) -> Result<Url, OidcError> {
    let url = secure_url(value)?;
    if url.path() != "/" {
        return Err(OidcError::InvalidConfiguration);
    }
    Ok(url)
}

/// Only these signed, verified claims cross into private session persistence.
pub struct VerifiedIdentity {
    pub issuer: String,
    pub subject: String,
    pub display_name: String,
    pub verified_email: Option<String>,
}

#[derive(Clone)]
pub struct OidcProvider {
    config: Arc<OidcConfig>,
    client: ProviderClient,
    http: BoundedHttp,
    jwks_uri: JsonWebKeySetUrl,
    keys: Arc<RwLock<KeyCache>>,
    refresh: Arc<Mutex<()>>,
}

struct KeyCache {
    keys: CoreJsonWebKeySet,
    generation: u64,
    refreshed_at: Instant,
    last_attempt: Option<Instant>,
}

impl KeyCache {
    fn fresh_snapshot(&self) -> Option<(CoreJsonWebKeySet, u64)> {
        (self.refreshed_at.elapsed() < KEY_CACHE_TTL).then(|| (self.keys.clone(), self.generation))
    }
}

impl OidcProvider {
    pub async fn initialize(config: OidcConfig) -> Result<Self, OidcError> {
        config.validate()?;
        tokio::time::timeout(OPERATION_DEADLINE, Self::initialize_inner(config))
            .await
            .map_err(|_| OidcError::ProviderUnavailable)?
    }

    async fn initialize_inner(config: OidcConfig) -> Result<Self, OidcError> {
        let issuer =
            IssuerUrl::new(config.issuer.clone()).map_err(|_| OidcError::InvalidConfiguration)?;
        let issuer_origin = issuer.url().origin();
        let mut builder = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(2))
            .timeout(HTTP_DEADLINE)
            .pool_idle_timeout(Duration::from_secs(30));
        if let Some(path) = &config.ca_file {
            let bytes = std::fs::read(path).map_err(|_| OidcError::InvalidConfiguration)?;
            if bytes.len() > MAX_METADATA_BYTES {
                return Err(OidcError::InvalidConfiguration);
            }
            let certificate = reqwest::Certificate::from_pem(&bytes)
                .map_err(|_| OidcError::InvalidConfiguration)?;
            builder = builder.add_root_certificate(certificate);
        }
        let mut http = BoundedHttp {
            client: builder
                .build()
                .map_err(|_| OidcError::InvalidConfiguration)?,
            policy: DestinationPolicy::Discovery(issuer_origin.clone()),
        };
        // Discovery may retrieve JWKS only at the configured issuer origin. No
        // token-provided URL, redirect or cross-origin metadata is ever followed.
        let metadata = CoreProviderMetadata::discover_async(issuer.clone(), &http)
            .await
            .map_err(|_| OidcError::ProviderUnavailable)?;
        if metadata.issuer().as_str() != config.issuer
            || !metadata
                .id_token_signing_alg_values_supported()
                .contains(&CoreJwsSigningAlgorithm::RsaSsaPkcs1V15Sha256)
        {
            return Err(OidcError::InvalidConfiguration);
        }
        let authorization = secure_url(metadata.authorization_endpoint().as_str())?;
        let token = secure_url(
            metadata
                .token_endpoint()
                .ok_or(OidcError::InvalidConfiguration)?
                .as_str(),
        )?;
        let jwks = secure_url(metadata.jwks_uri().as_str())?;
        let authorization_origin = config
            .authorization_origin
            .as_deref()
            .map(configured_origin)
            .transpose()?
            .map(|url| url.origin())
            .unwrap_or_else(|| issuer_origin.clone());
        if authorization.origin() != authorization_origin
            || (token.origin() != authorization_origin && token.origin() != issuer_origin)
            || jwks.origin() != issuer_origin
        {
            return Err(OidcError::InvalidConfiguration);
        }
        bounded_keys(metadata.jwks()).map_err(|_| OidcError::InvalidConfiguration)?;
        http.policy = DestinationPolicy::Endpoints { token, jwks };
        let jwks_uri = metadata.jwks_uri().clone();
        let keys = metadata.jwks().clone();
        let client = CoreClient::from_provider_metadata(
            metadata,
            ClientId::new(config.client_id.clone()),
            Some(ClientSecret::new(config.client_secret.clone())),
        )
        .set_redirect_uri(
            RedirectUrl::new(config.redirect_uri.clone())
                .map_err(|_| OidcError::InvalidConfiguration)?,
        );
        Ok(Self {
            config: Arc::new(config),
            client,
            http,
            jwks_uri,
            keys: Arc::new(RwLock::new(KeyCache {
                keys,
                generation: 0,
                refreshed_at: Instant::now(),
                last_attempt: None,
            })),
            refresh: Arc::new(Mutex::new(())),
        })
    }

    pub fn authorization_url(
        &self,
        state: &str,
        nonce: &str,
        pkce_verifier: &str,
    ) -> Result<String, OidcError> {
        if !binding_value(state) || !binding_value(nonce) || !valid_verifier(pkce_verifier) {
            return Err(OidcError::InvalidResponse);
        }
        let state = state.to_owned();
        let nonce = nonce.to_owned();
        let (url, _, _) = self
            .client
            .authorize_url(
                AuthenticationFlow::<CoreResponseType>::AuthorizationCode,
                move || CsrfToken::new(state),
                move || Nonce::new(nonce),
            )
            .add_scope(Scope::new("profile".into()))
            .add_scope(Scope::new("email".into()))
            .add_extra_param(
                "claims",
                r#"{"id_token":{"name":null,"email":null,"email_verified":null}}"#,
            )
            .set_pkce_challenge(PkceCodeChallenge::from_code_verifier_sha256(
                &PkceCodeVerifier::new(pkce_verifier.to_owned()),
            ))
            .url();
        Ok(url.to_string())
    }

    /// The caller must consume the browser-bound state before invoking exchange.
    /// Neither access/refresh tokens nor unverified identity escape this method.
    pub async fn exchange(
        &self,
        code: &str,
        verifier: &str,
        nonce: &str,
    ) -> Result<VerifiedIdentity, OidcError> {
        if code.is_empty()
            || code.len() > 4096
            || code.chars().any(char::is_control)
            || !valid_verifier(verifier)
            || !binding_value(nonce)
        {
            return Err(OidcError::InvalidResponse);
        }
        tokio::time::timeout(
            OPERATION_DEADLINE,
            self.exchange_inner(code, verifier, nonce),
        )
        .await
        .map_err(|_| OidcError::ProviderUnavailable)?
    }

    async fn exchange_inner(
        &self,
        code: &str,
        verifier: &str,
        nonce: &str,
    ) -> Result<VerifiedIdentity, OidcError> {
        // The pinned SDK rejects malformed claim JSON types before verification.
        // Only well-typed but absent/unusable recipient evidence gets no proof;
        // never normalize signed JWT bytes or bypass the strict token decoder.
        let response = self
            .client
            .exchange_code(AuthorizationCode::new(code.to_owned()))
            .map_err(|_| OidcError::InvalidConfiguration)?
            .set_pkce_verifier(PkceCodeVerifier::new(verifier.to_owned()))
            .request_async(&self.http)
            .await
            .map_err(|_| OidcError::InvalidResponse)?;
        let id_token = response.id_token().ok_or(OidcError::InvalidResponse)?;
        let (keys, generation) = self.current_keys().await?;
        match self.verify(id_token, &keys, nonce, response.access_token()) {
            Ok(identity) => Ok(identity),
            Err(ClaimsVerificationError::SignatureVerification(
                SignatureVerificationError::NoMatchingKey
                | SignatureVerificationError::CryptoError(_),
            )) => {
                // A provider can replace key material while retaining its kid.
                // Retry only these signature failures, never claim/algorithm errors.
                let (keys, _) = self.refresh_keys(generation).await?;
                self.verify(id_token, &keys, nonce, response.access_token())
                    .map_err(|_| OidcError::InvalidResponse)
            }
            Err(_) => Err(OidcError::InvalidResponse),
        }
    }

    fn verify(
        &self,
        token: &CoreIdToken,
        keys: &CoreJsonWebKeySet,
        nonce: &str,
        access_token: &AccessToken,
    ) -> Result<VerifiedIdentity, ClaimsVerificationError> {
        let verifier = CoreIdTokenVerifier::new_public_client(
            ClientId::new(self.config.client_id.clone()),
            IssuerUrl::new(self.config.issuer.clone()).map_err(|_| {
                ClaimsVerificationError::Other("Invalid identity configuration".into())
            })?,
            keys.clone(),
        )
        .set_allowed_algs([CoreJwsSigningAlgorithm::RsaSsaPkcs1V15Sha256])
        .set_other_audience_verifier_fn(|_| false)
        .set_issue_time_verifier_fn(|issued| {
            let now = unix_now().map_err(|_| "Clock unavailable".to_owned())?;
            if issued.timestamp() > now.saturating_add(MAX_FUTURE_SKEW)
                || issued.timestamp() < now.saturating_sub(MAX_ISSUED_AGE)
            {
                Err("Invalid issue time".into())
            } else {
                Ok(())
            }
        });
        let claims = token.claims(&verifier, &Nonce::new(nonce.to_owned()))?;
        let invalid = || ClaimsVerificationError::Other("Invalid identity claims".into());
        if let Some(expected) = claims.access_token_hash() {
            let actual = AccessTokenHash::from_token(
                access_token,
                token.signing_alg().map_err(|_| invalid())?,
                token.signing_key(&verifier).map_err(|_| invalid())?,
            )
            .map_err(|_| invalid())?;
            if actual != *expected {
                return Err(invalid());
            }
        }
        if claims.issuer().as_str() != self.config.issuer
            || claims.audiences().len() != 1
            || claims
                .authorized_party()
                .is_some_and(|party| party.as_str() != self.config.client_id)
            || claims.expiration().timestamp() <= claims.issue_time().timestamp()
            || claims.expiration().timestamp()
                > claims
                    .issue_time()
                    .timestamp()
                    .saturating_add(MAX_TOKEN_LIFETIME)
            || claims.subject().as_str().is_empty()
            || claims.subject().as_str().len() > 255
            || claims.subject().as_str().chars().any(char::is_control)
        {
            return Err(invalid());
        }
        let display_name = claims
            .name()
            .and_then(|name| name.get(None))
            .map(|name| name.as_str())
            .filter(|name| !name.trim().is_empty())
            .unwrap_or("Signed-in user");
        if display_name.len() > 200 || display_name.chars().any(char::is_control) {
            return Err(invalid());
        }
        Ok(VerifiedIdentity {
            issuer: self.config.issuer.clone(),
            subject: claims.subject().as_str().to_owned(),
            display_name: display_name.to_owned(),
            verified_email: claims
                .email()
                .filter(|_| claims.email_verified() == Some(true))
                .and_then(|email| normalize_email(email.as_str())),
        })
    }

    async fn current_keys(&self) -> Result<(CoreJsonWebKeySet, u64), OidcError> {
        let cache = self.keys.read().await;
        if let Some(snapshot) = cache.fresh_snapshot() {
            return Ok(snapshot);
        }
        let generation = cache.generation;
        drop(cache);
        self.refresh_keys(generation).await
    }

    async fn refresh_keys(&self, generation: u64) -> Result<(CoreJsonWebKeySet, u64), OidcError> {
        // Holding a dedicated refresh mutex coalesces concurrent misses, without
        // blocking valid tokens from reading the current keys during network I/O.
        let _guard = self.refresh.lock().await;
        {
            let mut cache = self.keys.write().await;
            if cache.generation != generation
                || cache
                    .last_attempt
                    .is_some_and(|at| at.elapsed() < KEY_REFRESH_INTERVAL)
            {
                // A failed or throttled refresh never extends the cache lifetime.
                // Concurrent expiry callers must fail closed instead of using old keys.
                return cache.fresh_snapshot().ok_or(OidcError::ProviderUnavailable);
            }
            cache.last_attempt = Some(Instant::now());
        }
        let keys = CoreJsonWebKeySet::fetch_async(&self.jwks_uri, &self.http)
            .await
            .map_err(|_| OidcError::ProviderUnavailable)?;
        bounded_keys(&keys)?;
        let mut cache = self.keys.write().await;
        cache.keys = keys;
        cache.generation = cache.generation.wrapping_add(1);
        cache.refreshed_at = Instant::now();
        Ok((cache.keys.clone(), cache.generation))
    }
}

fn bounded_keys(keys: &CoreJsonWebKeySet) -> Result<(), OidcError> {
    if keys.keys().is_empty() || keys.keys().len() > 32 {
        return Err(OidcError::InvalidResponse);
    }
    let mut rsa_found = false;
    for key in keys.keys() {
        let value = serde_json::to_value(key).map_err(|_| OidcError::InvalidResponse)?;
        if value["kty"] == "RSA" {
            // Keep synchronous signature work bounded as well as HTTP memory.
            // Cognito and the local provider use 2048-bit RSA with exponent 65537.
            let decode = |field: &str| {
                value[field]
                    .as_str()
                    .filter(|encoded| encoded.len() <= 684)
                    .and_then(|encoded| {
                        base64::engine::general_purpose::URL_SAFE_NO_PAD
                            .decode(encoded)
                            .ok()
                    })
                    .ok_or(OidcError::InvalidResponse)
            };
            let modulus = decode("n")?;
            let exponent = decode("e")?;
            if !(256..=512).contains(&modulus.len())
                || modulus.first().is_none_or(|byte| *byte < 128)
                || exponent.is_empty()
                || exponent.len() > 4
                || exponent.first() == Some(&0)
            {
                return Err(OidcError::InvalidResponse);
            }
            let exponent = exponent
                .iter()
                .fold(0_u64, |value, byte| (value << 8) | u64::from(*byte));
            if exponent < 3 || exponent % 2 == 0 {
                return Err(OidcError::InvalidResponse);
            }
            rsa_found = true;
        }
    }
    if !rsa_found {
        return Err(OidcError::InvalidResponse);
    }
    Ok(())
}

fn unix_now() -> Result<i64, OidcError> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_secs()).ok())
        .ok_or(OidcError::InvalidResponse)
}

fn binding_value(value: &str) -> bool {
    (32..=256).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_".contains(&byte))
}

fn valid_verifier(value: &str) -> bool {
    (43..=128).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-._~".contains(&byte))
}

#[derive(Clone)]
struct BoundedHttp {
    client: reqwest::Client,
    policy: DestinationPolicy,
}

#[derive(Clone)]
enum DestinationPolicy {
    Discovery(url::Origin),
    Endpoints { token: Url, jwks: Url },
}

impl<'c> openidconnect::AsyncHttpClient<'c> for BoundedHttp {
    type Error = OidcError;
    type Future = std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<HttpResponse, OidcError>> + Send + 'c>,
    >;

    fn call(&'c self, request: HttpRequest) -> Self::Future {
        Box::pin(self.execute(request))
    }
}

impl BoundedHttp {
    async fn execute(&self, request: HttpRequest) -> Result<HttpResponse, OidcError> {
        tokio::time::timeout(HTTP_DEADLINE, self.execute_inner(request))
            .await
            .map_err(|_| OidcError::ProviderUnavailable)?
    }

    async fn execute_inner(&self, request: HttpRequest) -> Result<HttpResponse, OidcError> {
        let destination = secure_url(&request.uri().to_string())?;
        let method = request.method();
        let limit = match &self.policy {
            DestinationPolicy::Discovery(origin)
                if method == reqwest::Method::GET && destination.origin() == *origin =>
            {
                MAX_METADATA_BYTES
            }
            DestinationPolicy::Endpoints { token, .. }
                if method == reqwest::Method::POST && destination == *token =>
            {
                MAX_TOKEN_BYTES
            }
            DestinationPolicy::Endpoints { jwks, .. }
                if method == reqwest::Method::GET && destination == *jwks =>
            {
                MAX_METADATA_BYTES
            }
            _ => return Err(OidcError::InvalidConfiguration),
        };
        if request.body().len() > 16 * 1024 {
            return Err(OidcError::InvalidResponse);
        }
        let (parts, body) = request.into_parts();
        let mut response = self
            .client
            .request(parts.method, destination)
            .headers(parts.headers)
            .body(body)
            .send()
            .await
            .map_err(|_| OidcError::ProviderUnavailable)?;
        if response.status().is_redirection()
            || response
                .content_length()
                .is_some_and(|size| size > limit as u64)
            || response.headers().len() > 64
        {
            return Err(OidcError::InvalidResponse);
        }
        let mut output = openidconnect::http::Response::builder().status(response.status());
        for (name, value) in response.headers() {
            output = output.header(name, value);
        }
        let mut body = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| OidcError::ProviderUnavailable)?
        {
            if body.len().saturating_add(chunk.len()) > limit {
                return Err(OidcError::InvalidResponse);
            }
            body.extend_from_slice(&chunk);
        }
        output.body(body).map_err(|_| OidcError::InvalidResponse)
    }
}

#[cfg(test)]
#[path = "oidc_tests.rs"]
mod tests;
