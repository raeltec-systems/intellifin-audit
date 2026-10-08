use super::*;

fn config() -> OidcConfig {
    OidcConfig {
        issuer: "https://cognito-idp.eu-west-1.amazonaws.com/example".into(),
        client_id: "application-client".into(),
        client_secret: "synthetic-client-secret".into(),
        public_origin: "https://app.example.test".into(),
        redirect_uri: "https://app.example.test/api/auth/callback".into(),
        authorization_origin: Some("https://login.example.test".into()),
        ca_file: None,
        local_fixtures: false,
    }
}

#[test]
fn configuration_keeps_destinations_explicit_and_https() {
    assert!(config().validate().is_ok());
    for issuer in [
        "http://issuer.example.test",
        "https://name:secret@issuer.example.test",
        "https://issuer.example.test?override=1",
        "https://issuer.example.test#fragment",
        "https://127.0.0.1:9443",
        "https://[::1]:9443",
        "https://localhost:9443",
    ] {
        let mut configuration = config();
        configuration.issuer = issuer.into();
        assert_eq!(
            configuration.validate(),
            Err(OidcError::InvalidConfiguration)
        );
    }
    for redirect in [
        "https://evil.example.test/api/auth/callback",
        "https://app.example.test:443/other",
        "https://app.example.test/api/auth/callback?next=evil",
        "https://app.example.test/api/auth/callback#token",
    ] {
        let mut configuration = config();
        configuration.redirect_uri = redirect.into();
        assert_eq!(
            configuration.validate(),
            Err(OidcError::InvalidConfiguration)
        );
    }
}

#[test]
fn fixture_ca_requires_deliberate_local_and_cookie_isolated_hosts() {
    let mut configuration = config();
    configuration.ca_file = Some("/tmp/synthetic-ca.pem".into());
    assert!(configuration.validate().is_err());
    configuration.local_fixtures = true;
    assert!(configuration.validate().is_err());
    configuration.issuer = "https://127.0.0.1:9443".into();
    configuration.public_origin = "https://localhost:5173".into();
    configuration.redirect_uri = "https://localhost:5173/api/auth/callback".into();
    configuration.authorization_origin = None;
    assert!(configuration.validate().is_ok());
    configuration.public_origin = "https://127.0.0.1:5173".into();
    configuration.redirect_uri = "https://127.0.0.1:5173/api/auth/callback".into();
    assert!(configuration.validate().is_err());
}

#[test]
fn protocol_inputs_have_rfc_and_resource_bounds() {
    assert!(valid_verifier(&"a".repeat(43)));
    assert!(valid_verifier(&"~".repeat(128)));
    assert!(!valid_verifier(&"a".repeat(42)));
    assert!(!valid_verifier(&"a".repeat(129)));
    assert!(!valid_verifier(&"%".repeat(43)));
    assert!(binding_value(&"_".repeat(32)));
    assert!(!binding_value(&"a".repeat(31)));
    assert!(!binding_value(&"a".repeat(257)));
    assert!(!binding_value(&"\n".repeat(32)));
}

#[test]
fn pinned_claim_decoder_keeps_optional_evidence_and_malformed_types_distinct() {
    use openidconnect::core::CoreIdTokenClaims;
    use serde_json::json;

    let identity = json!({
        "iss": "https://issuer.example.test",
        "sub": "auditor-a",
        "aud": "application-client",
        "iat": 1_800_000_000,
        "exp": 1_800_000_300,
        "nonce": "bound-nonce"
    });
    for evidence in [
        json!({}),
        json!({"email": null, "email_verified": null}),
        json!({"email": "auditor@example.test", "email_verified": false}),
        json!({"email": "recipient@@example.test", "email_verified": true}),
    ] {
        let mut claims = identity.clone();
        claims
            .as_object_mut()
            .unwrap()
            .extend(evidence.as_object().unwrap().clone());
        assert!(serde_json::from_value::<CoreIdTokenClaims>(claims).is_ok());
    }
    for (field, malformed) in [
        ("email", json!(123)),
        ("email", json!(true)),
        ("email", json!([])),
        ("email", json!({})),
        ("email_verified", json!("true")),
        ("email_verified", json!(1)),
        ("email_verified", json!([])),
        ("email_verified", json!({})),
        ("sub", json!(123)),
        ("aud", json!({})),
        ("iat", json!("not-a-time")),
        ("exp", json!([])),
    ] {
        let mut claims = identity.clone();
        claims[field] = malformed;
        assert!(
            serde_json::from_value::<CoreIdTokenClaims>(claims).is_err(),
            "{field}"
        );
    }
    // The SDK's duplicate-field refusal remains intact, including a null first value.
    for duplicate in [
        r#""email":null,"email":"auditor@example.test""#,
        r#""email_verified":null,"email_verified":true"#,
        r#""sub":"first","sub":"second""#,
    ] {
        let raw = format!(
            r#"{{"iss":"https://issuer.example.test","sub":"auditor-a","aud":"application-client","iat":1800000000,"exp":1800000300,{duplicate}}}"#
        );
        let error = serde_json::from_str::<CoreIdTokenClaims>(&raw).unwrap_err();
        assert!(error.to_string().contains("duplicate field"));
    }
}

#[tokio::test]
async fn http_rejects_untrusted_url_and_method_before_network_io() {
    let http = BoundedHttp {
        client: reqwest::Client::new(),
        policy: DestinationPolicy::Endpoints {
            token: Url::parse("https://issuer.example.test/token").unwrap(),
            jwks: Url::parse("https://issuer.example.test/jwks").unwrap(),
        },
    };
    for (method, url) in [
        ("GET", "https://issuer.example.test/token"),
        ("POST", "https://issuer.example.test/jwks"),
        ("GET", "https://issuer.example.test/other"),
        ("GET", "https://attacker.example.test/jwks"),
        ("GET", "http://issuer.example.test/jwks"),
        ("GET", "https://issuer.example.test/jwks?override=1"),
    ] {
        let request = openidconnect::http::Request::builder()
            .method(method)
            .uri(url)
            .body(Vec::new())
            .unwrap();
        assert_eq!(
            http.execute(request).await.unwrap_err(),
            OidcError::InvalidConfiguration
        );
    }
}

#[test]
fn public_diagnostics_are_fixed_and_have_no_provider_source() {
    use std::error::Error;
    for error in [
        OidcError::InvalidConfiguration,
        OidcError::ProviderUnavailable,
        OidcError::InvalidResponse,
    ] {
        assert!(error.to_string().len() < 80);
        assert!(error.source().is_none());
    }
}

#[test]
fn signing_key_size_and_count_bound_synchronous_verification_work() {
    use openidconnect::core::CoreJsonWebKey;
    let valid = CoreJsonWebKey::new_rsa(vec![128; 256], vec![1, 0, 1], None);
    assert!(bounded_keys(&CoreJsonWebKeySet::new(vec![valid.clone()])).is_ok());
    assert!(bounded_keys(&CoreJsonWebKeySet::new(vec![valid; 33])).is_err());
    for (modulus, exponent) in [
        (vec![128; 128], vec![1, 0, 1]),
        (vec![128; 513], vec![1, 0, 1]),
        (vec![0; 256], vec![1, 0, 1]),
        (vec![128; 256], vec![1]),
        (vec![128; 256], vec![2]),
        (vec![128; 256], vec![1; 5]),
    ] {
        let key = CoreJsonWebKey::new_rsa(modulus, exponent, None);
        assert!(bounded_keys(&CoreJsonWebKeySet::new(vec![key])).is_err());
    }
}

#[tokio::test(start_paused = true)]
async fn verification_keys_expire_at_five_minutes_without_extending_on_attempt() {
    let mut cache = KeyCache {
        keys: CoreJsonWebKeySet::new(Vec::new()),
        generation: 7,
        refreshed_at: Instant::now(),
        last_attempt: None,
    };
    tokio::time::advance(Duration::from_secs(299)).await;
    assert_eq!(cache.fresh_snapshot().unwrap().1, 7);
    cache.last_attempt = Some(Instant::now());
    tokio::time::advance(Duration::from_secs(1)).await;
    assert!(cache.fresh_snapshot().is_none());
}
