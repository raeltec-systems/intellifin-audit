//! Immutable, version-pinned S3 originals. The application owns admission,
//! orchestration and authority checks; this adapter bounds each storage request.

use std::{fmt::Write as _, time::Duration};

use bytes::Bytes;
use futures_util::{StreamExt, stream::BoxStream};
use object_store::aws::{AmazonS3, AmazonS3Builder, AmazonS3ConfigKey, S3ConditionalPut};
use object_store::list::{PaginatedListOptions, PaginatedListStore};
use object_store::path::Path;
use object_store::{
    ClientConfigKey, Error as StoreError, GetOptions, ObjectStore, PutMode, PutOptions, PutPayload,
    RetryConfig,
};
use sha2::{Digest as _, Sha256};
use tokio::time::timeout;
use url::Url;
use zobba_application::evidence::{EvidenceObjects, MeasuredObject, ObjectError};
use zobba_domain::{evidence::ContentIdentity, identity::valid_scope_id};

pub use zobba_domain::evidence::MAX_ORIGINAL_BYTES;
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
const HEALTH_PREFIX: &str = "__health/sentinel/";

/// Contains no storage-provider details and no credentials. Store this identity
/// with reservations and originals so a changed deployment cannot retarget them.
pub fn storage_namespace(endpoint: &str, bucket: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"zobba-evidence-s3-v1\0");
    hasher.update(endpoint.as_bytes());
    hasher.update(b"\0");
    hasher.update(bucket.as_bytes());
    hex_digest(&hasher.finalize())
}

fn hex_digest(bytes: &[u8]) -> String {
    let mut digest = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        let _ = write!(digest, "{byte:02x}");
    }
    digest
}

fn production_builder(builder: AmazonS3Builder, bucket: &str) -> AmazonS3Builder {
    builder
        .with_bucket_name(bucket)
        .with_allow_http(false)
        .with_skip_signature(false)
        // Preserve the configured trusted CAs, proxy and client timeouts.
        .with_config(
            AmazonS3ConfigKey::Client(ClientConfigKey::AllowInvalidCertificates),
            "false",
        )
        .with_conditional_put(S3ConditionalPut::ETagMatch)
        .with_retry(RetryConfig {
            max_retries: 0,
            retry_timeout: Duration::from_secs(1),
            ..Default::default()
        })
}

fn configured_endpoint(builder: &AmazonS3Builder) -> Result<Option<String>, ObjectError> {
    // The SDK's service-specific endpoint takes precedence over AWS_ENDPOINT.
    let endpoint = builder
        .get_config_value(&AmazonS3ConfigKey::S3Endpoint)
        .or_else(|| builder.get_config_value(&AmazonS3ConfigKey::Endpoint));
    let region = builder
        .get_config_value(&AmazonS3ConfigKey::Region)
        .unwrap_or_else(|| "us-east-1".into());
    let default_endpoint = format!("https://s3.{region}.amazonaws.com");
    let parsed = Url::parse(endpoint.as_deref().unwrap_or(&default_endpoint))
        .map_err(|_| ObjectError::Unavailable)?;
    if parsed.scheme() != "https"
        || parsed.host().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(ObjectError::Unavailable);
    }
    // Parsing validates transport only. Do not replace the SDK's raw input with
    // a normalized URL: a trailing slash changes its virtual-hosted object path.
    // Absence must also remain distinct: only the SDK's default virtual-hosted
    // endpoint adds the bucket to the regional hostname.
    Ok(endpoint)
}

fn configured_namespace(builder: &AmazonS3Builder, bucket: &str) -> Result<String, ObjectError> {
    // With an explicit endpoint, virtual-hosted mode addresses endpoint/key;
    // path mode addresses endpoint/bucket/key. S3 Express can select a zonal
    // endpoint instead of the regional default. Include every input affecting
    // that choice so configuration changes cannot retarget a historical key.
    let endpoint = configured_endpoint(builder)?;
    let virtual_hosted = builder
        .get_config_value(&AmazonS3ConfigKey::VirtualHostedStyleRequest)
        .unwrap_or_else(|| "false".into());
    let express = builder
        .get_config_value(&AmazonS3ConfigKey::S3Express)
        .unwrap_or_else(|| "false".into());
    let region = builder
        .get_config_value(&AmazonS3ConfigKey::Region)
        .unwrap_or_else(|| "us-east-1".into());
    let mut hasher = Sha256::new();
    hasher.update(b"zobba-evidence-s3-config-v2\0");
    for field in [
        endpoint.as_deref(),
        Some(bucket),
        Some(virtual_hosted.as_str()),
        Some(express.as_str()),
        Some(region.as_str()),
    ] {
        match field {
            Some(value) => {
                hasher.update([1]);
                hasher.update((value.len() as u64).to_be_bytes());
                hasher.update(value.as_bytes());
            }
            None => hasher.update([0]),
        }
    }
    Ok(hex_digest(&hasher.finalize()))
}

/// One adapter for the configured namespace. There is deliberately no internal
/// semaphore: callers hold the shared evidence lane from before body collection
/// until the final authority check, including every request through this port.
pub struct S3EvidenceObjects {
    store: AmazonS3,
    namespace: String,
    request_timeout: Duration,
}

impl S3EvidenceObjects {
    /// Production construction always signs HTTPS requests and validates TLS.
    /// Credentials, CA trust and proxy configuration use the standard AWS chain.
    pub fn from_env(bucket: &str) -> Result<Self, ObjectError> {
        if bucket.is_empty() || bucket.len() > 255 || bucket.chars().any(char::is_control) {
            return Err(ObjectError::Unavailable);
        }
        let builder = production_builder(AmazonS3Builder::from_env(), bucket);
        let namespace = configured_namespace(&builder, bucket)?;
        let store = builder.build().map_err(|_| ObjectError::Unavailable)?;
        Self::new(store, namespace)
    }

    /// Explicit composition seam. A fixture may inject its owned numeric-loopback
    /// connector from test code; production has no insecure transport switch.
    pub fn new(store: AmazonS3, namespace: String) -> Result<Self, ObjectError> {
        if namespace.len() != 64
            || !namespace
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(ObjectError::NamespaceMismatch);
        }
        Ok(Self {
            store,
            namespace,
            request_timeout: REQUEST_TIMEOUT,
        })
    }

    /// Deployments and tests may tighten the deadline, never raise its ceiling.
    pub fn with_request_timeout(mut self, value: Duration) -> Result<Self, ObjectError> {
        if value.is_zero() || value > REQUEST_TIMEOUT {
            return Err(ObjectError::Unavailable);
        }
        self.request_timeout = value;
        Ok(self)
    }

    async fn probe_bucket(&self) -> Result<(), ObjectError> {
        timeout(
            self.request_timeout,
            self.store.list_paginated(
                Some(HEALTH_PREFIX),
                PaginatedListOptions {
                    max_keys: Some(1),
                    ..Default::default()
                },
            ),
        )
        .await
        .map_err(|_| ObjectError::DeadlineExceeded)?
        .map(|_| ())
        .map_err(|_| ObjectError::Unavailable)
    }

    async fn get_version_inner(
        &self,
        path: &Path,
        version: &str,
    ) -> Result<MeasuredObject, ObjectError> {
        let result = self
            .store
            .get_opts(
                path,
                GetOptions::new().with_version(Some(version.to_owned())),
            )
            .await
            .map_err(|_| ObjectError::Unavailable)?;
        if result.meta.version.as_deref() != Some(version) {
            return Err(ObjectError::VersionUnavailable);
        }
        let metadata_size = result.meta.size;
        if metadata_size > MAX_ORIGINAL_BYTES as u64 {
            return Err(ObjectError::TooLarge);
        }
        let bytes = read_get_stream(result.into_stream()).await?;
        let identity = self.measure(&bytes);
        if identity.size != metadata_size {
            return Err(ObjectError::Integrity);
        }
        Ok(MeasuredObject { bytes, identity })
    }
}

impl EvidenceObjects for S3EvidenceObjects {
    fn namespace(&self) -> &str {
        &self.namespace
    }

    fn measure(&self, bytes: &[u8]) -> ContentIdentity {
        ContentIdentity {
            size: bytes.len() as u64,
            sha256: hex_digest(&Sha256::digest(bytes)),
        }
    }

    async fn put_if_absent(
        &self,
        reservation_id: &str,
        bytes: Vec<u8>,
    ) -> Result<String, ObjectError> {
        let path = object_path(reservation_id)?;
        if bytes.len() > MAX_ORIGINAL_BYTES {
            return Err(ObjectError::TooLarge);
        }
        self.probe_bucket().await?;
        let result = timeout(
            self.request_timeout,
            self.store.put_opts(
                &path,
                PutPayload::from(bytes),
                PutOptions {
                    mode: PutMode::Create,
                    ..Default::default()
                },
            ),
        )
        .await
        .map_err(|_| ObjectError::DeadlineExceeded)?
        .map_err(|error| match error {
            StoreError::AlreadyExists { .. } => ObjectError::AlreadyExists,
            _ => ObjectError::Unavailable,
        })?;
        result
            .version
            .filter(|value| valid_version(value))
            .ok_or(ObjectError::VersionUnavailable)
    }

    async fn latest_version(&self, reservation_id: &str) -> Result<Option<String>, ObjectError> {
        let path = object_path(reservation_id)?;
        // HEAD is metadata only. Never consume an unpinned body to find a version.
        let result = timeout(
            self.request_timeout,
            self.store
                .get_opts(&path, GetOptions::new().with_head(true)),
        )
        .await
        .map_err(|_| ObjectError::DeadlineExceeded)?;
        match result {
            Ok(result) => result
                .meta
                .version
                .filter(|value| valid_version(value))
                .map(Some)
                .ok_or(ObjectError::VersionUnavailable),
            Err(StoreError::NotFound { .. }) => {
                // A HEAD 404 alone cannot distinguish a missing key from bucket
                // loss. A bounded, prefix-scoped probe establishes the context.
                self.probe_bucket().await?;
                Ok(None)
            }
            Err(_) => Err(ObjectError::Unavailable),
        }
    }

    async fn get_version(
        &self,
        reservation_id: &str,
        namespace: &str,
        version: &str,
    ) -> Result<MeasuredObject, ObjectError> {
        if namespace != self.namespace {
            return Err(ObjectError::NamespaceMismatch);
        }
        let path = object_path(reservation_id)?;
        if !valid_version(version) {
            return Err(ObjectError::VersionUnavailable);
        }
        // The deadline includes headers AND the complete bounded response body.
        timeout(self.request_timeout, self.get_version_inner(&path, version))
            .await
            .map_err(|_| ObjectError::DeadlineExceeded)?
    }
}

fn object_path(reservation_id: &str) -> Result<Path, ObjectError> {
    if !valid_scope_id(reservation_id) {
        return Err(ObjectError::Unavailable);
    }
    Ok(Path::from(format!("evidence/{reservation_id}/original")))
}

fn valid_version(version: &str) -> bool {
    !version.is_empty()
        && version != "null"
        && version.len() <= 512
        && !version.chars().any(char::is_control)
}

async fn read_get_stream(
    mut stream: BoxStream<'static, object_store::Result<Bytes>>,
) -> Result<Vec<u8>, ObjectError> {
    let mut bytes = Vec::with_capacity(8192);
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| ObjectError::Unavailable)?;
        if bytes.len().saturating_add(chunk.len()) > MAX_ORIGINAL_BYTES {
            return Err(ObjectError::TooLarge);
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn stream_cap_applies_without_trusting_metadata() {
        let stream =
            futures_util::stream::iter([Ok(Bytes::from(vec![0; MAX_ORIGINAL_BYTES + 1]))]).boxed();
        assert_eq!(read_get_stream(stream).await, Err(ObjectError::TooLarge));
    }

    #[test]
    fn strict_builder_overrides_only_unsafe_switches() {
        let builder = production_builder(
            AmazonS3Builder::new()
                .with_allow_http(true)
                .with_skip_signature(true)
                .with_config(
                    AmazonS3ConfigKey::Client(ClientConfigKey::AllowInvalidCertificates),
                    "true",
                )
                .with_config(
                    AmazonS3ConfigKey::Client(ClientConfigKey::ProxyUrl),
                    "http://proxy.example:8080",
                ),
            "configured-bucket",
        );
        for key in [
            AmazonS3ConfigKey::SkipSignature,
            AmazonS3ConfigKey::Client(ClientConfigKey::AllowInvalidCertificates),
            AmazonS3ConfigKey::Client(ClientConfigKey::AllowHttp),
        ] {
            assert_eq!(builder.get_config_value(&key).as_deref(), Some("false"));
        }
        assert_eq!(
            builder
                .get_config_value(&AmazonS3ConfigKey::Client(ClientConfigKey::ProxyUrl))
                .as_deref(),
            Some("http://proxy.example:8080")
        );
    }

    #[tokio::test]
    async fn production_environment_cannot_disable_signing_or_transport_guards() {
        const CHILD: &str = "ZOBBA_S3_SECURITY_FIXTURE_CHILD";
        if std::env::var_os(CHILD).is_some() {
            use object_store::signer::Signer;

            let builder = production_builder(AmazonS3Builder::from_env(), "fixture-bucket");
            for key in [
                AmazonS3ConfigKey::SkipSignature,
                AmazonS3ConfigKey::Client(ClientConfigKey::AllowInvalidCertificates),
                AmazonS3ConfigKey::Client(ClientConfigKey::AllowHttp),
            ] {
                assert_eq!(builder.get_config_value(&key).as_deref(), Some("false"));
            }
            let objects = S3EvidenceObjects::from_env("fixture-bucket").unwrap();
            let signed = objects
                .store
                .signed_url(
                    hyper::Method::GET,
                    &object_path("original").unwrap(),
                    Duration::from_secs(60),
                )
                .await
                .unwrap();
            assert!(signed.query().unwrap().contains("X-Amz-Signature="));
            return;
        }

        let output = tokio::task::spawn_blocking(|| {
            let mut command = std::process::Command::new(std::env::current_exe().unwrap());
            // Never inherit ambient cloud credentials into this synthetic test.
            for (name, _) in std::env::vars_os() {
                if name.to_string_lossy().starts_with("AWS_") {
                    command.env_remove(name);
                }
            }
            command
                .args([
                    "--exact",
                    "evidence::s3::tests::production_environment_cannot_disable_signing_or_transport_guards",
                    "--nocapture",
                ])
                .env(CHILD, "1")
                .env("AWS_SKIP_SIGNATURE", "true")
                .env("AWS_ALLOW_INVALID_CERTIFICATES", "true")
                .env("AWS_ALLOW_HTTP", "true")
                .env("AWS_ACCESS_KEY_ID", "synthetic-access")
                .env("AWS_SECRET_ACCESS_KEY", "synthetic-secret")
                .env("AWS_REGION", "us-east-1")
                .output()
        })
        .await
        .unwrap()
        .unwrap();
        assert!(
            output.status.success(),
            "security fixture child failed: {}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(String::from_utf8_lossy(&output.stdout).contains("1 passed"));
    }

    #[test]
    fn namespace_covers_effective_endpoint_and_bucket() {
        assert_ne!(
            storage_namespace("https://one", "bucket"),
            storage_namespace("https://two", "bucket")
        );
        assert_ne!(
            storage_namespace("https://one", "first"),
            storage_namespace("https://one", "second")
        );
        let builder = AmazonS3Builder::new()
            .with_endpoint("https://generic.example")
            .with_config(AmazonS3ConfigKey::S3Endpoint, "https://specific.example");
        assert_eq!(
            configured_endpoint(&builder).unwrap(),
            Some("https://specific.example".into())
        );
        for value in [
            "http://example.test",
            "https://user@example.test",
            "https://example.test?bucket=x",
        ] {
            assert_eq!(
                configured_endpoint(&AmazonS3Builder::new().with_endpoint(value)),
                Err(ObjectError::Unavailable)
            );
        }
        let builder = AmazonS3Builder::new().with_endpoint("https://objects.example");
        let namespace = configured_namespace(&builder, "bucket").unwrap();
        assert_ne!(
            namespace,
            configured_namespace(
                &builder.clone().with_virtual_hosted_style_request(true),
                "bucket"
            )
            .unwrap()
        );
        assert_ne!(
            namespace,
            configured_namespace(&builder.clone().with_s3_express(true), "bucket").unwrap()
        );
        assert_ne!(
            namespace,
            configured_namespace(&builder.with_region("eu-west-1"), "bucket").unwrap()
        );
    }

    // Use the SDK's signer to observe its real addressing, without issuing any
    // request or resolving cloud credentials. These URLs never leave the test.
    async fn signed_destination(builder: AmazonS3Builder, bucket: &str) -> (String, String) {
        use object_store::signer::Signer;

        let builder = production_builder(
            builder
                .with_access_key_id("synthetic-access")
                .with_secret_access_key("synthetic-secret"),
            bucket,
        );
        let namespace = configured_namespace(&builder, bucket).unwrap();
        let mut signed = builder
            .build()
            .unwrap()
            .signed_url(
                hyper::Method::GET,
                &object_path("original").unwrap(),
                Duration::from_secs(60),
            )
            .await
            .unwrap();
        assert!(
            signed
                .query_pairs()
                .any(|(key, value)| key == "X-Amz-Signature" && !value.is_empty())
        );
        assert!(
            signed
                .query_pairs()
                .any(|(key, value)| key == "X-Amz-SignedHeaders" && value == "host")
        );
        signed.set_query(None);
        (namespace, signed.into())
    }

    #[tokio::test]
    async fn namespace_preserves_sdk_default_explicit_style_and_slash_destinations() {
        let mut namespaces = std::collections::HashSet::new();
        for (endpoint, virtual_hosted, expected) in [
            (
                None,
                false,
                "https://s3.us-east-1.amazonaws.com/bucket/evidence/original/original",
            ),
            (
                None,
                true,
                "https://bucket.s3.us-east-1.amazonaws.com/evidence/original/original",
            ),
            (
                Some("https://s3.us-east-1.amazonaws.com"),
                false,
                "https://s3.us-east-1.amazonaws.com/bucket/evidence/original/original",
            ),
            (
                Some("https://s3.us-east-1.amazonaws.com"),
                true,
                "https://s3.us-east-1.amazonaws.com/evidence/original/original",
            ),
            (
                Some("https://s3.us-east-1.amazonaws.com/"),
                false,
                "https://s3.us-east-1.amazonaws.com/bucket/evidence/original/original",
            ),
            (
                Some("https://s3.us-east-1.amazonaws.com/"),
                true,
                "https://s3.us-east-1.amazonaws.com//evidence/original/original",
            ),
            (
                Some("https://s3.us-east-1.amazonaws.com//"),
                false,
                "https://s3.us-east-1.amazonaws.com/bucket/evidence/original/original",
            ),
            (
                Some("https://s3.us-east-1.amazonaws.com//"),
                true,
                "https://s3.us-east-1.amazonaws.com///evidence/original/original",
            ),
            (
                Some("https://objects.example/prefix"),
                false,
                "https://objects.example/prefix/bucket/evidence/original/original",
            ),
            (
                Some("https://objects.example/prefix"),
                true,
                "https://objects.example/prefix/evidence/original/original",
            ),
            (
                Some("https://objects.example/prefix/"),
                false,
                "https://objects.example/prefix/bucket/evidence/original/original",
            ),
            (
                Some("https://objects.example/prefix/"),
                true,
                "https://objects.example/prefix//evidence/original/original",
            ),
        ] {
            let mut builder = AmazonS3Builder::new()
                .with_region("us-east-1")
                .with_virtual_hosted_style_request(virtual_hosted);
            if let Some(endpoint) = endpoint {
                builder = builder.with_endpoint(endpoint);
            }
            let (namespace, destination) = signed_destination(builder, "bucket").await;
            assert_eq!(destination, expected);
            // Conservatively distinguish even the configurations whose path
            // mode happens to remove a slash or select the same regional URL.
            assert!(
                namespaces.insert(namespace),
                "namespace collision for {endpoint:?}, virtual-hosted={virtual_hosted}"
            );
        }
    }

    #[tokio::test]
    async fn namespace_tracks_sdk_service_endpoint_priority_and_express_selection() {
        let specific = AmazonS3Builder::new()
            .with_endpoint("https://generic.example")
            .with_config(AmazonS3ConfigKey::S3Endpoint, "https://specific.example/")
            .with_virtual_hosted_style_request(true);
        let first = signed_destination(specific.clone(), "bucket").await;
        assert_eq!(
            first.1,
            "https://specific.example//evidence/original/original"
        );
        assert_eq!(
            first,
            signed_destination(specific.with_endpoint("https://unused.example"), "bucket").await
        );

        let bucket = "bucket--use1-az4--x-s3";
        let regional = signed_destination(AmazonS3Builder::new(), bucket).await;
        let express =
            signed_destination(AmazonS3Builder::new().with_s3_express(true), bucket).await;
        assert_eq!(
            regional.1,
            "https://s3.us-east-1.amazonaws.com/bucket--use1-az4--x-s3/evidence/original/original"
        );
        assert_eq!(
            express.1,
            "https://bucket--use1-az4--x-s3.s3express-use1-az4.us-east-1.amazonaws.com/evidence/original/original"
        );
        assert_ne!(regional.0, express.0);
    }
}
