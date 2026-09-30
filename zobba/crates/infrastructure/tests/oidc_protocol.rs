//! Actual HTTPS authorization-code/PKCE exchanges against the independent
//! oidc-provider fixture. Run after setup/start and sourcing its generated env.sh.
use serde_json::{Value, json};
use std::{
    io::Write,
    path::PathBuf,
    process::{Command, Stdio},
    time::{Duration, Instant},
};
use zobba_infrastructure::oidc::{OidcConfig, OidcError, OidcProvider};

// The fixture controls are process-wide. Keep separately selectable regressions
// isolated even when Cargo runs this binary with several test threads.
static FIXTURE_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
const VERIFIER: &str = "correct-pkce-verifier-with-at-least-43-characters-123456789";
const NONCE: &str = "independent-login-nonce-binding-123456789";

struct Fixture {
    configuration: OidcConfig,
    directory: PathBuf,
    script: PathBuf,
    http: reqwest::Client,
    admin_secret: String,
}

impl Fixture {
    fn from_environment() -> Self {
        let configuration = OidcConfig::from_env()
            .expect("valid explicit OIDC fixture configuration")
            .expect("source fixtures/oidc/.local/env.sh before protocol tests");
        assert!(configuration.local_fixtures, "requires local synthetic IdP");
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/oidc");
        let directory = std::env::var_os("ZOBBA_FIXTURE_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| root.join(".local"));
        let values: Value = serde_json::from_slice(
            &std::fs::read(directory.join("fixture.json")).expect("read synthetic configuration"),
        )
        .expect("valid synthetic configuration");
        let certificate = reqwest::Certificate::from_pem(
            &std::fs::read(directory.join("ca.pem")).expect("read synthetic CA"),
        )
        .expect("valid synthetic CA");
        let http = reqwest::Client::builder()
            .add_root_certificate(certificate)
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(8))
            .build()
            .expect("construct verified TLS fixture client");
        Self {
            configuration,
            directory,
            script: root.join("flow.mjs"),
            http,
            admin_secret: values["admin_secret"]
                .as_str()
                .expect("synthetic fixture admin key")
                .to_owned(),
        }
    }

    async fn control(&self, operation: &str, body: Value) {
        let response = self
            .http
            .post(format!("{}/__admin/{operation}", self.configuration.issuer))
            .bearer_auth(&self.admin_secret)
            .header("content-type", "application/json")
            .body(serde_json::to_vec(&body).unwrap())
            .send()
            .await;
        assert!(response.is_ok(), "fixture control connection failed");
        assert!(
            response.unwrap().status().is_success(),
            "fixture control refused"
        );
    }

    async fn scenario(&self, scenario: &str) {
        self.control("scenario", json!({"scenario": scenario}))
            .await;
    }

    async fn status(&self) -> Value {
        let response = self
            .http
            .get(format!("{}/__admin/status", self.configuration.issuer))
            .bearer_auth(&self.admin_secret)
            .send()
            .await
            .expect("fixture status connection");
        assert!(response.status().is_success());
        serde_json::from_slice(&response.bytes().await.expect("fixture status body"))
            .expect("fixture status JSON")
    }

    fn code(&self, provider: &OidcProvider, verifier: &str, nonce: &str) -> String {
        let state = "independent-state-binding-value-123456789";
        let authorization = provider.authorization_url(state, nonce, verifier).unwrap();
        let url = url::Url::parse(&authorization).unwrap();
        let pairs: std::collections::HashMap<_, _> = url.query_pairs().collect();
        assert!(
            pairs
                .get("response_type")
                .is_some_and(|value| value == "code")
        );
        assert!(
            pairs
                .get("code_challenge_method")
                .is_some_and(|value| value == "S256")
        );
        assert!(pairs.get("state").is_some_and(|value| value == state));
        assert!(pairs.get("nonce").is_some_and(|value| value == nonce));
        assert!(!pairs.contains_key("client_secret"));
        let mut child = Command::new("node")
            .arg(&self.script)
            .arg("--stdin")
            .env("ZOBBA_FIXTURE_DIR", &self.directory)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("launch real provider login helper");
        child
            .stdin
            .take()
            .unwrap()
            .write_all(
                &serde_json::to_vec(
                    &json!({"authorization_url": authorization, "account": "auditor-a"}),
                )
                .unwrap(),
            )
            .expect("send authorization through helper stdin");
        let output = child
            .wait_with_output()
            .expect("complete real provider login");
        assert!(output.status.success(), "real provider login helper failed");
        let value: Value = serde_json::from_slice(&output.stdout).expect("provider login result");
        assert!(
            value["state"].as_str() == Some(state),
            "provider returned original state"
        );
        value["code"]
            .as_str()
            .expect("real one-use code")
            .to_owned()
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn actual_provider_protocol_and_bounded_transport_contract() {
    let _guard = FIXTURE_LOCK.lock().await;
    let fixture = Fixture::from_environment();
    fixture.control("reset", json!({})).await;
    let mut untrusted_tls = fixture.configuration.clone();
    untrusted_tls.ca_file = None;
    assert!(
        OidcProvider::initialize(untrusted_tls).await.is_err(),
        "fixture TLS must require the explicit local CA"
    );
    let mut different_issuer = fixture.configuration.clone();
    different_issuer.issuer.push('/');
    assert!(
        OidcProvider::initialize(different_issuer).await.is_err(),
        "discovery issuer must match the exact configured identifier"
    );
    let provider = OidcProvider::initialize(fixture.configuration.clone())
        .await
        .expect("discover actual HTTPS IdP with verified local CA");
    let verifier = "correct-pkce-verifier-with-at-least-43-characters-123456789";
    let nonce = "independent-login-nonce-binding-123456789";
    let code = fixture.code(&provider, verifier, nonce);
    let identity = provider
        .exchange(&code, verifier, nonce)
        .await
        .expect("verified real code exchange");
    assert!(identity.subject == "auditor-a");
    assert!(identity.issuer == fixture.configuration.issuer);
    assert!(identity.display_name == "auditor-a");
    assert!(
        provider.exchange(&code, verifier, nonce).await.is_err(),
        "authorization-code replay denied"
    );

    let code = fixture.code(&provider, verifier, nonce);
    assert!(
        provider
            .exchange(
                &code,
                "wrong-verifier-with-at-least-43-characters-123456789",
                nonce
            )
            .await
            .is_err(),
        "PKCE mismatch denied"
    );
    let code = fixture.code(&provider, verifier, nonce);
    assert!(
        provider
            .exchange(&code, verifier, "wrong-login-nonce-binding-123456789")
            .await
            .is_err(),
        "nonce binding mismatch denied"
    );

    for scenario in [
        "bad_issuer",
        "bad_audience",
        "multi_audience",
        "missing_azp",
        "bad_azp",
        "bad_at_hash",
        "bad_signature",
        "bad_algorithm",
        "no_signature",
        "unknown_key",
        "future_iat",
        "old_iat",
        "bad_expiry",
        "bad_nonce",
        "no_nonce",
        "untrusted_jku",
        "untrusted_x5u",
        "slow_token",
        "redirect_token",
    ] {
        fixture.scenario(scenario).await;
        let code = fixture.code(&provider, verifier, nonce);
        let started = Instant::now();
        assert!(
            provider.exchange(&code, verifier, nonce).await.is_err(),
            "negative protocol scenario admitted: {scenario}"
        );
        assert!(
            started.elapsed() < Duration::from_secs(7),
            "protocol deadline exceeded: {scenario}"
        );
    }
    assert!(
        fixture.status().await["untrusted_key_requests"] == 0,
        "token URLs and redirects must never be fetched"
    );

    // Start from old published keys, then make several real code exchanges return
    // the same newly rotated key. Only one JWKS request may service those misses.
    fixture.control("reset", json!({})).await;
    let provider = OidcProvider::initialize(fixture.configuration.clone())
        .await
        .unwrap();
    let codes: Vec<_> = (0..6)
        .map(|_| fixture.code(&provider, verifier, nonce))
        .collect();
    fixture.scenario("key_rotation").await;
    let mut exchanges = tokio::task::JoinSet::new();
    for code in codes {
        let provider = provider.clone();
        exchanges.spawn(async move { provider.exchange(&code, verifier, nonce).await.is_ok() });
    }
    while let Some(result) = exchanges.join_next().await {
        assert!(
            result.unwrap(),
            "rotated signing key accepted after one refresh"
        );
    }
    assert!(
        fixture.status().await["jwks_requests"] == 2,
        "initial fetch plus one coalesced rotation refresh"
    );

    // A miss whose refreshed document still lacks its key must not cause repeated
    // network work for each request, and does not gain authority from header URLs.
    fixture.control("reset", json!({})).await;
    let provider = OidcProvider::initialize(fixture.configuration.clone())
        .await
        .unwrap();
    let codes: Vec<_> = (0..6)
        .map(|_| fixture.code(&provider, verifier, nonce))
        .collect();
    fixture.scenario("unknown_key").await;
    let mut exchanges = tokio::task::JoinSet::new();
    for code in codes {
        let provider = provider.clone();
        exchanges.spawn(async move { provider.exchange(&code, verifier, nonce).await.is_err() });
    }
    while let Some(result) = exchanges.join_next().await {
        assert!(result.unwrap(), "unknown signing key denied");
    }
    assert!(
        fixture.status().await["jwks_requests"] == 2,
        "unknown-key flood refresh coalesced"
    );

    for scenario in [
        "untrusted_token_endpoint",
        "untrusted_authorization_endpoint",
        "untrusted_jwks_uri",
        "bad_discovery_issuer",
        "slow_discovery",
        "redirect_discovery",
        "slow_jwks",
        "redirect_jwks",
    ] {
        fixture.scenario(scenario).await;
        let started = Instant::now();
        assert!(
            OidcProvider::initialize(fixture.configuration.clone())
                .await
                .is_err(),
            "unbounded initialization scenario admitted: {scenario}"
        );
        assert!(
            started.elapsed() < Duration::from_secs(7),
            "initialization HTTP deadline exceeded: {scenario}"
        );
    }
    assert!(
        fixture.status().await["untrusted_key_requests"] == 0,
        "discovery redirects must never be fetched"
    );
    fixture.control("reset", json!({})).await;
}

async fn response_size_contract(endpoint: &str, chunked: bool) {
    let _guard = FIXTURE_LOCK.lock().await;
    let fixture = Fixture::from_environment();
    fixture.control("reset", json!({})).await;
    let transport = if chunked { "chunked_" } else { "" };
    // Both cases are otherwise-valid provider responses. Unknown JSON padding
    // below the byte limit must pass, so parse errors cannot satisfy refusal.
    fixture
        .scenario(&format!("padded_{transport}{endpoint}"))
        .await;
    let provider = OidcProvider::initialize(fixture.configuration.clone())
        .await
        .expect("valid padded metadata below the response limit");
    let code = fixture.code(&provider, VERIFIER, NONCE);
    assert!(
        provider.exchange(&code, VERIFIER, NONCE).await.is_ok(),
        "bounded valid padding accepted: {transport}{endpoint}"
    );
    fixture
        .scenario(&format!("oversized_{transport}{endpoint}"))
        .await;
    let started = Instant::now();
    if endpoint == "token" {
        let code = fixture.code(&provider, VERIFIER, NONCE);
        assert!(
            provider.exchange(&code, VERIFIER, NONCE).await.is_err(),
            "oversized otherwise-valid token admitted: {transport}{endpoint}"
        );
    } else {
        assert!(
            OidcProvider::initialize(fixture.configuration.clone())
                .await
                .is_err(),
            "oversized otherwise-valid metadata admitted: {transport}{endpoint}"
        );
    }
    assert!(started.elapsed() < Duration::from_secs(7));
    fixture.control("reset", json!({})).await;
}

macro_rules! response_size_test {
    ($name:ident, $endpoint:literal, $chunked:literal) => {
        #[tokio::test]
        async fn $name() {
            response_size_contract($endpoint, $chunked).await;
        }
    };
}

response_size_test!(actual_provider_token_content_length_bound, "token", false);
response_size_test!(actual_provider_token_chunked_bound, "token", true);
response_size_test!(actual_provider_jwks_content_length_bound, "jwks", false);
response_size_test!(actual_provider_jwks_chunked_bound, "jwks", true);
response_size_test!(
    actual_provider_discovery_content_length_bound,
    "discovery",
    false
);
response_size_test!(actual_provider_discovery_chunked_bound, "discovery", true);

#[tokio::test]
async fn actual_provider_recent_expiry_is_rejected_independently_of_issued_at() {
    let _guard = FIXTURE_LOCK.lock().await;
    let fixture = Fixture::from_environment();
    fixture.control("reset", json!({})).await;
    let provider = OidcProvider::initialize(fixture.configuration.clone())
        .await
        .unwrap();
    fixture.scenario("expired").await;
    let code = fixture.code(&provider, VERIFIER, NONCE);
    assert!(
        matches!(
            provider.exchange(&code, VERIFIER, NONCE).await,
            Err(OidcError::InvalidResponse)
        ),
        "a recently expired token with valid issued-at and lifetime must fail"
    );
    assert_eq!(fixture.status().await["jwks_requests"], 1);
    fixture.control("reset", json!({})).await;
}

#[tokio::test]
async fn actual_provider_claim_and_algorithm_failures_do_not_refresh_keys() {
    let _guard = FIXTURE_LOCK.lock().await;
    let fixture = Fixture::from_environment();
    fixture.control("reset", json!({})).await;
    let provider = OidcProvider::initialize(fixture.configuration.clone())
        .await
        .unwrap();
    for scenario in [
        "bad_issuer",
        "bad_audience",
        "multi_audience",
        "missing_azp",
        "bad_azp",
        "bad_at_hash",
        "expired",
        "future_iat",
        "old_iat",
        "bad_expiry",
        "bad_nonce",
        "no_nonce",
        "bad_algorithm",
        "no_signature",
    ] {
        fixture.scenario(scenario).await;
        let code = fixture.code(&provider, VERIFIER, NONCE);
        assert!(provider.exchange(&code, VERIFIER, NONCE).await.is_err());
        assert_eq!(
            fixture.status().await["jwks_requests"],
            1,
            "claim or algorithm failure must not refresh: {scenario}"
        );
    }
    fixture.control("reset", json!({})).await;
}

async fn concurrent_exchanges(
    fixture: &Fixture,
    provider: &OidcProvider,
    expected: Result<(), OidcError>,
) {
    let codes: Vec<_> = (0..6)
        .map(|_| fixture.code(provider, VERIFIER, NONCE))
        .collect();
    let started = Instant::now();
    let mut exchanges = tokio::task::JoinSet::new();
    for code in codes {
        let provider = provider.clone();
        exchanges.spawn(async move { provider.exchange(&code, VERIFIER, NONCE).await.map(|_| ()) });
    }
    while let Some(result) = exchanges.join_next().await {
        assert_eq!(result.unwrap(), expected);
    }
    assert!(started.elapsed() < Duration::from_secs(7));
}

#[tokio::test]
async fn actual_provider_same_kid_replacement_and_invalid_signatures_are_coalesced() {
    let _guard = FIXTURE_LOCK.lock().await;
    let fixture = Fixture::from_environment();
    for (scenario, expected) in [
        ("same_kid_rotation", Ok(())),
        ("bad_signature", Err(OidcError::InvalidResponse)),
    ] {
        fixture.control("reset", json!({})).await;
        let provider = OidcProvider::initialize(fixture.configuration.clone())
            .await
            .unwrap();
        fixture.scenario(scenario).await;
        concurrent_exchanges(&fixture, &provider, expected).await;
        assert_eq!(
            fixture.status().await["jwks_requests"],
            2,
            "one initial fetch plus one coalesced signature refresh: {scenario}"
        );
        let code = fixture.code(&provider, VERIFIER, NONCE);
        assert_eq!(
            provider.exchange(&code, VERIFIER, NONCE).await.map(|_| ()),
            expected
        );
        assert_eq!(fixture.status().await["jwks_requests"], 2);
    }
    fixture.control("reset", json!({})).await;
}

async fn advance_cache_clock(duration: Duration) {
    // Only cache age and its retry interval move. Resume before real HTTPS I/O,
    // keeping real deadlines and provider-issued wall-clock claims meaningful.
    tokio::time::pause();
    tokio::time::advance(duration).await;
    tokio::time::resume();
}

#[tokio::test]
async fn actual_provider_retired_key_is_refused_after_cache_expiry() {
    let _guard = FIXTURE_LOCK.lock().await;
    let fixture = Fixture::from_environment();
    fixture.control("reset", json!({})).await;
    let provider = OidcProvider::initialize(fixture.configuration.clone())
        .await
        .unwrap();
    fixture.scenario("retired_key").await;
    let code = fixture.code(&provider, VERIFIER, NONCE);
    assert!(provider.exchange(&code, VERIFIER, NONCE).await.is_ok());
    assert_eq!(fixture.status().await["jwks_requests"], 1);
    advance_cache_clock(Duration::from_secs(300)).await;
    concurrent_exchanges(&fixture, &provider, Err(OidcError::InvalidResponse)).await;
    assert_eq!(
        fixture.status().await["jwks_requests"],
        2,
        "expired cache refreshes once and refuses a now-retired signing key"
    );
    fixture.control("reset", json!({})).await;
}

#[tokio::test]
async fn actual_provider_expired_cache_refresh_failure_is_closed_and_bounded() {
    let _guard = FIXTURE_LOCK.lock().await;
    let fixture = Fixture::from_environment();
    fixture.control("reset", json!({})).await;
    let provider = OidcProvider::initialize(fixture.configuration.clone())
        .await
        .unwrap();
    fixture.scenario("retired_key_unavailable").await;
    let code = fixture.code(&provider, VERIFIER, NONCE);
    assert!(provider.exchange(&code, VERIFIER, NONCE).await.is_ok());
    advance_cache_clock(Duration::from_secs(300)).await;
    concurrent_exchanges(&fixture, &provider, Err(OidcError::ProviderUnavailable)).await;
    assert_eq!(fixture.status().await["jwks_requests"], 2);
    let code = fixture.code(&provider, VERIFIER, NONCE);
    assert!(matches!(
        provider.exchange(&code, VERIFIER, NONCE).await,
        Err(OidcError::ProviderUnavailable)
    ));
    assert_eq!(
        fixture.status().await["jwks_requests"],
        2,
        "failed expired-cache refresh is throttled without admitting cached keys"
    );
    fixture.scenario("key_rotation").await;
    advance_cache_clock(Duration::from_secs(5)).await;
    let code = fixture.code(&provider, VERIFIER, NONCE);
    assert!(provider.exchange(&code, VERIFIER, NONCE).await.is_ok());
    assert_eq!(fixture.status().await["jwks_requests"], 3);
    fixture.control("reset", json!({})).await;
}
