//! Real S3 HTTP requests plus the application custody sequence. No database or
//! cloud credentials are needed; the metadata port below records registration.
#[path = "support/s3_protocol.rs"]
mod s3_protocol;

use hyper::Method;
use object_store::{ObjectStore, PutMode, PutOptions, PutPayload, path::Path};
use s3_protocol::{Fixture, RequestRecord, StoredVersion, query_value, validate_fixture_endpoint};
use std::{
    net::SocketAddr,
    process::Command,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};
use tokio::{io::AsyncWriteExt, net::TcpListener, sync::oneshot, time::timeout};
use zobba_application::evidence::{
    self, EvidenceError, EvidenceMetadata, EvidenceObjects, ObjectError, StoredEvidence,
    StoredReservation,
};
use zobba_domain::{evidence::*, identity::Scope};
use zobba_infrastructure::evidence::s3::{S3EvidenceObjects, storage_namespace};

struct Metadata {
    reservation: StoredReservation,
    registered: Mutex<Option<RegisteredEvidence>>,
    registration_count: AtomicUsize,
}

impl Metadata {
    fn new(objects: &S3EvidenceObjects, bytes: &[u8]) -> Self {
        Self {
            reservation: StoredReservation {
                reservation: Reservation {
                    id: "server_owned_reservation".into(),
                    actor_id: "fixture-actor".into(),
                    scope: scope(),
                    request: ReservationRequest {
                        key: "request-key".into(),
                        filename: "original.txt".into(),
                        identity: objects.measure(bytes),
                        source: SourceAssertions::default(),
                    },
                    reserved_at: 1,
                },
                namespace: objects.namespace().into(),
                registered: None,
            },
            registered: Mutex::new(None),
            registration_count: AtomicUsize::new(0),
        }
    }

    fn id(&self) -> &str {
        &self.reservation.reservation.id
    }

    fn assert_no_receipt(&self) {
        assert!(self.registered.lock().unwrap().is_none());
        assert_eq!(self.registration_count.load(Ordering::SeqCst), 0);
    }
}

impl EvidenceMetadata for Metadata {
    async fn reserve(
        &self,
        _: &str,
        _: &Scope,
        _: &ReservationRequest,
        _: &str,
    ) -> Result<StoredReservation, EvidenceError> {
        unreachable!()
    }
    async fn reservation(
        &self,
        _: &str,
        _: &Scope,
        id: &str,
    ) -> Result<StoredReservation, EvidenceError> {
        assert_eq!(id, self.id());
        let mut result = self.reservation.clone();
        result.registered = self.registered.lock().unwrap().clone();
        Ok(result)
    }
    async fn recover(
        &self,
        _: &str,
        _: &Scope,
        _: Option<&str>,
    ) -> Result<EvidencePage<Reservation>, EvidenceError> {
        unreachable!()
    }
    async fn list(
        &self,
        _: &str,
        _: &Scope,
        _: Option<&str>,
    ) -> Result<EvidencePage<RegisteredEvidence>, EvidenceError> {
        unreachable!()
    }
    async fn search(
        &self,
        _: &str,
        _: &Scope,
        _: &EvidenceSearchQuery,
    ) -> Result<EvidenceSearchPage, EvidenceError> {
        unreachable!()
    }
    async fn inspect(&self, _: &str, _: &Scope, _: &str) -> Result<StoredEvidence, EvidenceError> {
        Ok(StoredEvidence {
            evidence: self
                .registered
                .lock()
                .unwrap()
                .clone()
                .ok_or(EvidenceError::Denied)?,
            namespace: self.reservation.namespace.clone(),
        })
    }
    async fn register(
        &self,
        _: &str,
        _: &Scope,
        id: &str,
        namespace: &str,
        version: &str,
        identity: &ContentIdentity,
    ) -> Result<RegisteredEvidence, EvidenceError> {
        assert_eq!(id, self.id());
        assert_eq!(namespace, self.reservation.namespace);
        assert_eq!(identity, &self.reservation.reservation.request.identity);
        assert!(!version.is_empty() && version != "null");
        let result = RegisteredEvidence {
            reservation: self.reservation.reservation.clone(),
            version: version.into(),
            registered_at: 2,
        };
        *self.registered.lock().unwrap() = Some(result.clone());
        self.registration_count.fetch_add(1, Ordering::SeqCst);
        Ok(result)
    }
    async fn authorize(&self, _: &str, _: &Scope) -> Result<(), EvidenceError> {
        Ok(())
    }
    async fn register_captured(
        &self,
        actor: &str,
        scope: &Scope,
        id: &str,
        namespace: &str,
        version: &str,
        identity: &ContentIdentity,
        capture: &zobba_application::knowledge::EvidenceCapture,
    ) -> Result<RegisteredEvidence, EvidenceError> {
        // This object-custody fixture acknowledges the explicit producer payload;
        // durable projection is exercised by the real knowledge repository suite.
        assert!(capture.excerpt.is_some() || capture.omission.is_some());
        self.register(actor, scope, id, namespace, version, identity)
            .await
    }
}

fn scope() -> Scope {
    Scope {
        organisation_id: "org".into(),
        client_id: "client".into(),
        engagement_id: "engagement".into(),
    }
}

fn adapter(fixture: &Fixture) -> S3EvidenceObjects {
    S3EvidenceObjects::new(
        fixture.store(),
        storage_namespace(&fixture.endpoint, "fixture-bucket"),
    )
    .unwrap()
    .with_request_timeout(Duration::from_secs(2))
    .unwrap()
}

async fn acquire(
    metadata: &Metadata,
    objects: &S3EvidenceObjects,
    bytes: &[u8],
) -> Result<RegisteredEvidence, EvidenceError> {
    evidence::acquire(
        metadata,
        objects,
        "fixture-actor",
        &scope(),
        metadata.id(),
        bytes.to_vec(),
    )
    .await
}

fn puts(records: &[RequestRecord]) -> Vec<&RequestRecord> {
    records.iter().filter(|r| r.method == Method::PUT).collect()
}

fn gets(records: &[RequestRecord]) -> Vec<&RequestRecord> {
    records
        .iter()
        .filter(|r| r.method == Method::GET && r.path != "/fixture-bucket")
        .collect()
}

#[tokio::test]
async fn conditional_create_is_signed_versioned_and_independently_read_back() {
    let fixture = Fixture::start().await;
    let objects = adapter(&fixture);
    let bytes = b"owned evidence original";
    let metadata = Metadata::new(&objects, bytes);
    let receipt = acquire(&metadata, &objects, bytes).await.unwrap();
    assert_eq!(receipt.version, "v1");
    assert_eq!(receipt.reservation.request.identity, objects.measure(bytes));
    let records = fixture.state.records();
    let writes = puts(&records);
    assert_eq!(writes.len(), 1);
    assert_eq!(writes[0].if_none_match.as_deref(), Some("*"));
    assert!(writes[0].authorization_present);
    let reads = gets(&records);
    assert_eq!(reads.len(), 1);
    assert_eq!(
        query_value(&reads[0].query, "versionId").as_deref(),
        Some("v1")
    );
    let lists: Vec<_> = records
        .iter()
        .filter(|r| r.path == "/fixture-bucket")
        .collect();
    assert_eq!(lists.len(), 1);
    assert_eq!(
        query_value(&lists[0].query, "prefix").as_deref(),
        Some("__health/sentinel/")
    );
    assert_eq!(
        query_value(&lists[0].query, "max-keys").as_deref(),
        Some("1")
    );
    fixture.stop().await;
}

#[tokio::test]
async fn lost_put_ack_is_reconciled_with_head_and_pinned_read_without_second_write() {
    let fixture = Fixture::start().await;
    fixture
        .state
        .drop_next_put_ack
        .store(true, Ordering::SeqCst);
    let objects = adapter(&fixture);
    let bytes = b"committed before connection closes";
    let metadata = Metadata::new(&objects, bytes);
    assert_eq!(
        acquire(&metadata, &objects, bytes).await.unwrap().version,
        "v1"
    );
    let records = fixture.state.records();
    assert_eq!(puts(&records).len(), 1);
    assert_eq!(
        records.iter().filter(|r| r.method == Method::HEAD).count(),
        1
    );
    assert_eq!(gets(&records).len(), 1);
    fixture.stop().await;
}

#[tokio::test]
async fn one_uncommitted_put_failure_retries_the_same_conditional_key() {
    let fixture = Fixture::start().await;
    fixture
        .state
        .fail_uncommitted_puts
        .store(1, Ordering::SeqCst);
    let objects = adapter(&fixture);
    let bytes = b"second create may succeed";
    let metadata = Metadata::new(&objects, bytes);
    assert_eq!(
        acquire(&metadata, &objects, bytes).await.unwrap().version,
        "v1"
    );
    let records = fixture.state.records();
    let writes = puts(&records);
    assert_eq!(writes.len(), 2);
    assert_eq!(writes[0].path, writes[1].path);
    assert!(
        writes
            .iter()
            .all(|r| r.if_none_match.as_deref() == Some("*"))
    );
    assert_eq!(
        fixture
            .state
            .objects
            .lock()
            .unwrap()
            .values()
            .next()
            .unwrap()
            .len(),
        1
    );
    fixture.stop().await;
}

#[tokio::test]
async fn both_uncommitted_create_failures_return_no_object_or_receipt() {
    let fixture = Fixture::start().await;
    fixture
        .state
        .fail_uncommitted_puts
        .store(2, Ordering::SeqCst);
    let objects = adapter(&fixture);
    let bytes = b"neither create commits";
    let metadata = Metadata::new(&objects, bytes);
    assert_eq!(
        acquire(&metadata, &objects, bytes).await,
        Err(EvidenceError::Unavailable)
    );
    metadata.assert_no_receipt();
    assert!(fixture.state.objects.lock().unwrap().is_empty());
    assert_eq!(puts(&fixture.state.records()).len(), 2);
    assert!(gets(&fixture.state.records()).is_empty());
    fixture.stop().await;
}

#[tokio::test]
async fn absent_latest_after_409_or_412_retries_without_overwriting() {
    for status in [409, 412] {
        let fixture = Fixture::start().await;
        fixture
            .state
            .conflict_status
            .store(status, Ordering::SeqCst);
        fixture
            .state
            .conflict_uncommitted_puts
            .store(1, Ordering::SeqCst);
        let objects = adapter(&fixture);
        let bytes = b"conditional conflict but no object exists";
        let metadata = Metadata::new(&objects, bytes);
        assert_eq!(
            acquire(&metadata, &objects, bytes).await.unwrap().version,
            "v1"
        );
        let records = fixture.state.records();
        assert_eq!(puts(&records).len(), 2);
        assert!(
            puts(&records)
                .iter()
                .all(|r| r.if_none_match.as_deref() == Some("*"))
        );
        assert_eq!(fixture.state.objects.lock().unwrap().len(), 1);
        fixture.stop().await;
    }
}

#[tokio::test]
async fn repeated_409_or_412_without_commit_returns_no_receipt() {
    for status in [409, 412] {
        let fixture = Fixture::start().await;
        fixture
            .state
            .conflict_status
            .store(status, Ordering::SeqCst);
        fixture
            .state
            .conflict_uncommitted_puts
            .store(2, Ordering::SeqCst);
        let objects = adapter(&fixture);
        let bytes = b"both conflicts remain uncommitted";
        let metadata = Metadata::new(&objects, bytes);
        assert_eq!(
            acquire(&metadata, &objects, bytes).await,
            Err(EvidenceError::Unavailable)
        );
        metadata.assert_no_receipt();
        assert!(fixture.state.objects.lock().unwrap().is_empty());
        assert_eq!(puts(&fixture.state.records()).len(), 2);
        fixture.stop().await;
    }
}

#[tokio::test]
async fn existing_exact_bytes_reconcile_but_changed_bytes_never_overwrite() {
    let fixture = Fixture::start().await;
    let objects = adapter(&fixture);
    let bytes = b"immutable bytes";
    let metadata = Metadata::new(&objects, bytes);
    objects
        .put_if_absent(metadata.id(), bytes.to_vec())
        .await
        .unwrap();
    assert_eq!(
        acquire(&metadata, &objects, bytes).await.unwrap().version,
        "v1"
    );
    let changed = Metadata::new(&objects, b"changed bytes");
    assert_eq!(
        acquire(&changed, &objects, b"changed bytes").await,
        Err(EvidenceError::Integrity)
    );
    changed.assert_no_receipt();
    {
        let stored = fixture.state.objects.lock().unwrap();
        let versions = stored.values().next().unwrap();
        assert_eq!(versions.len(), 1);
        assert_eq!(versions[0].body, bytes);
    }
    fixture.stop().await;
}

#[tokio::test]
async fn registered_retry_reads_same_version_without_another_put() {
    let fixture = Fixture::start().await;
    let objects = adapter(&fixture);
    let bytes = b"same result after registration acknowledgement loss";
    let metadata = Metadata::new(&objects, bytes);
    let first = acquire(&metadata, &objects, bytes).await.unwrap();
    let second = acquire(&metadata, &objects, bytes).await.unwrap();
    assert_eq!(first, second);
    assert_eq!(puts(&fixture.state.records()).len(), 1);
    assert_eq!(gets(&fixture.state.records()).len(), 2);
    fixture.stop().await;
}

#[tokio::test]
async fn missing_or_literal_null_version_never_registers() {
    for literal_null in [false, true] {
        let fixture = Fixture::start().await;
        fixture
            .state
            .omit_version_header
            .store(!literal_null, Ordering::SeqCst);
        fixture
            .state
            .null_version_header
            .store(literal_null, Ordering::SeqCst);
        let objects = adapter(&fixture);
        let bytes = b"versioning required";
        let metadata = Metadata::new(&objects, bytes);
        assert_eq!(
            acquire(&metadata, &objects, bytes).await,
            Err(EvidenceError::Unavailable)
        );
        metadata.assert_no_receipt();
        assert!(gets(&fixture.state.records()).is_empty());
        fixture.stop().await;
    }
}

#[tokio::test]
async fn returned_version_must_match_the_explicitly_requested_version() {
    let fixture = Fixture::start().await;
    let objects = adapter(&fixture);
    objects
        .put_if_absent("original", b"versioned".to_vec())
        .await
        .unwrap();
    fixture
        .state
        .mismatch_next_get_version
        .store(true, Ordering::SeqCst);
    assert_eq!(
        objects
            .get_version("original", objects.namespace(), "v1")
            .await,
        Err(ObjectError::VersionUnavailable)
    );
    fixture.stop().await;
}

#[tokio::test]
async fn newer_latest_object_cannot_substitute_a_registered_original() {
    let fixture = Fixture::start().await;
    let objects = adapter(&fixture);
    let bytes = b"original version";
    let metadata = Metadata::new(&objects, bytes);
    acquire(&metadata, &objects, bytes).await.unwrap();
    fixture
        .state
        .objects
        .lock()
        .unwrap()
        .values_mut()
        .next()
        .unwrap()
        .push(StoredVersion {
            id: "v2".into(),
            body: b"later version".to_vec(),
        });
    let (receipt, read) = evidence::read_original(
        &metadata,
        &objects,
        "fixture-actor",
        &scope(),
        metadata.id(),
    )
    .await
    .unwrap();
    assert_eq!(receipt.version, "v1");
    assert_eq!(read, bytes);
    let records = fixture.state.records();
    assert!(
        gets(&records)
            .iter()
            .all(|r| query_value(&r.query, "versionId").as_deref() == Some("v1"))
    );
    fixture.stop().await;
}

#[tokio::test]
async fn corruption_or_truncation_never_registers_or_discloses_bytes() {
    for truncate in [false, true] {
        let fixture = Fixture::start().await;
        fixture.state.corrupt_get.store(!truncate, Ordering::SeqCst);
        fixture
            .state
            .error_next_get_body
            .store(truncate, Ordering::SeqCst);
        let objects = adapter(&fixture);
        let bytes = b"whole measured original";
        let metadata = Metadata::new(&objects, bytes);
        let result = acquire(&metadata, &objects, bytes).await;
        assert_eq!(
            result,
            Err(if truncate {
                EvidenceError::Unavailable
            } else {
                EvidenceError::Integrity
            })
        );
        metadata.assert_no_receipt();
        fixture.stop().await;
    }
}

#[tokio::test]
async fn later_corruption_is_refused_before_original_disclosure() {
    let fixture = Fixture::start().await;
    let objects = adapter(&fixture);
    let bytes = b"verified original before corruption";
    let metadata = Metadata::new(&objects, bytes);
    acquire(&metadata, &objects, bytes).await.unwrap();
    fixture.state.corrupt_get.store(true, Ordering::SeqCst);
    assert_eq!(
        evidence::read_original(
            &metadata,
            &objects,
            "fixture-actor",
            &scope(),
            metadata.id()
        )
        .await,
        Err(EvidenceError::Integrity)
    );
    assert_eq!(metadata.registration_count.load(Ordering::SeqCst), 1);
    fixture.stop().await;
}

#[tokio::test]
async fn missing_bucket_is_unavailable_and_no_put_is_attempted() {
    let fixture = Fixture::start().await;
    fixture.state.bucket_exists.store(false, Ordering::SeqCst);
    let objects = adapter(&fixture);
    assert_eq!(
        objects.put_if_absent("original", vec![]).await,
        Err(ObjectError::Unavailable)
    );
    assert!(puts(&fixture.state.records()).is_empty());
    assert_eq!(
        objects.latest_version("original").await,
        Err(ObjectError::Unavailable)
    );
    fixture.stop().await;
}

#[tokio::test]
async fn missing_key_with_healthy_bucket_is_explicitly_absent() {
    let fixture = Fixture::start().await;
    let objects = adapter(&fixture);
    assert_eq!(objects.latest_version("original").await, Ok(None));
    let records = fixture.state.records();
    assert_eq!(records.len(), 2);
    assert_eq!(records[0].method, Method::HEAD);
    assert_eq!(records[1].path, "/fixture-bucket");
    assert!(gets(&records).is_empty());
    fixture.stop().await;
}

#[tokio::test]
async fn body_claim_mismatch_and_oversize_fail_before_network_io() {
    let fixture = Fixture::start().await;
    let objects = adapter(&fixture);
    let metadata = Metadata::new(&objects, b"expected");
    assert_eq!(
        acquire(&metadata, &objects, b"substitute").await,
        Err(EvidenceError::Conflict)
    );
    let oversize = vec![0; MAX_ORIGINAL_BYTES + 1];
    assert_eq!(
        objects.put_if_absent(metadata.id(), oversize).await,
        Err(ObjectError::TooLarge)
    );
    metadata.assert_no_receipt();
    assert!(fixture.state.records().is_empty());
    fixture.stop().await;
}

#[tokio::test]
async fn ten_mib_is_inclusive_for_put_and_verified_get() {
    let fixture = Fixture::start().await;
    let objects = adapter(&fixture);
    let bytes = vec![0; MAX_ORIGINAL_BYTES];
    let metadata = Metadata::new(&objects, &bytes);
    assert_eq!(
        acquire(&metadata, &objects, &bytes)
            .await
            .unwrap()
            .reservation
            .request
            .identity
            .size,
        MAX_ORIGINAL_BYTES as u64
    );
    fixture.stop().await;
}

#[tokio::test]
async fn oversized_response_metadata_is_refused_before_body_collection() {
    let fixture = Fixture::start().await;
    let store = fixture.store();
    let path = Path::from("evidence/original/original");
    store
        .put_opts(
            &path,
            PutPayload::from(vec![0; MAX_ORIGINAL_BYTES + 1]),
            PutOptions {
                mode: PutMode::Create,
                ..Default::default()
            },
        )
        .await
        .unwrap();
    let objects = adapter(&fixture);
    assert_eq!(
        objects
            .get_version("original", objects.namespace(), "v1")
            .await,
        Err(ObjectError::TooLarge)
    );
    fixture.stop().await;
}

#[tokio::test]
async fn invalid_ids_versions_and_changed_namespace_are_refused_before_network() {
    let fixture = Fixture::start().await;
    let objects = adapter(&fixture);
    assert_eq!(
        objects.get_version("original", "changed", "v1").await,
        Err(ObjectError::NamespaceMismatch)
    );
    for id in ["", "../other", "a/b", "https://foreign.example", "a%2Fb"] {
        assert_eq!(
            objects.put_if_absent(id, vec![]).await,
            Err(ObjectError::Unavailable)
        );
        assert_eq!(
            objects.latest_version(id).await,
            Err(ObjectError::Unavailable)
        );
    }
    for version in ["", "null", "x\r\ny"] {
        assert_eq!(
            objects
                .get_version("original", objects.namespace(), version)
                .await,
            Err(ObjectError::VersionUnavailable)
        );
    }
    assert!(fixture.state.records().is_empty());
    fixture.stop().await;
}

#[tokio::test]
async fn complete_get_body_and_bucket_probe_obey_request_deadlines() {
    let fixture = Fixture::start().await;
    let objects = adapter(&fixture)
        .with_request_timeout(Duration::from_millis(50))
        .unwrap();
    objects
        .put_if_absent("original", b"bounded body".to_vec())
        .await
        .unwrap();
    fixture.state.delay_get_body_ms.store(500, Ordering::SeqCst);
    let result = timeout(
        Duration::from_millis(300),
        objects.get_version("original", objects.namespace(), "v1"),
    )
    .await
    .expect("body deadline did not terminate read");
    assert_eq!(result, Err(ObjectError::DeadlineExceeded));
    fixture.state.response_delay_ms.store(500, Ordering::SeqCst);
    assert_eq!(
        objects.put_if_absent("second", vec![]).await,
        Err(ObjectError::DeadlineExceeded)
    );
    assert_eq!(puts(&fixture.state.records()).len(), 1);
    fixture.stop().await;
}

#[tokio::test]
async fn adapter_does_not_acquire_a_second_internal_admission_lane() {
    let fixture = Fixture::start().await;
    fixture.state.response_delay_ms.store(50, Ordering::SeqCst);
    let objects = Arc::new(adapter(&fixture));
    let mut operations = vec![];
    // The API admission lane is the sole owner of concurrency. A second limiter
    // inside storage would serialize this direct port call to two requests.
    for id in ["first", "second", "third"] {
        let objects = Arc::clone(&objects);
        operations.push(tokio::spawn(async move {
            objects.put_if_absent(id, vec![]).await
        }));
    }
    for operation in operations {
        operation.await.unwrap().unwrap();
    }
    assert_eq!(fixture.state.peak_requests.load(Ordering::SeqCst), 3);
    fixture.stop().await;
}

#[tokio::test]
async fn fixture_connector_ignores_hostile_proxy_environment_in_child_process() {
    if std::env::var_os("ZOBBA_S3_PROXY_FIXTURE_CHILD").is_some() {
        let fixture = Fixture::start().await;
        let objects = adapter(&fixture);
        let bytes = b"proxy isolation";
        acquire(&Metadata::new(&objects, bytes), &objects, bytes)
            .await
            .unwrap();
        fixture.stop().await;
        return;
    }
    let listener = TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0)))
        .await
        .unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let accepted = Arc::new(AtomicUsize::new(0));
    let task_accepted = Arc::clone(&accepted);
    let (shutdown, mut rx) = oneshot::channel();
    let proxy_task = tokio::spawn(async move {
        loop {
            tokio::select! {
                result = listener.accept() => {
                    if let Ok((mut socket, _)) = result {
                        task_accepted.fetch_add(1, Ordering::SeqCst);
                        tokio::spawn(async move {
                            let mut request = [0;1024];
                            let _ = tokio::io::AsyncReadExt::read(&mut socket, &mut request).await;
                            let _ = socket.write_all(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await;
                        });
                    }
                }
                _ = &mut rx => break,
            }
        }
    });
    let output = tokio::task::spawn_blocking(move || {
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "fixture_connector_ignores_hostile_proxy_environment_in_child_process",
                "--nocapture",
            ])
            .env("ZOBBA_S3_PROXY_FIXTURE_CHILD", "1");
        for key in [
            "HTTP_PROXY",
            "http_proxy",
            "HTTPS_PROXY",
            "https_proxy",
            "ALL_PROXY",
            "all_proxy",
        ] {
            command.env(key, &endpoint);
        }
        command.env("NO_PROXY", "").env("no_proxy", "").output()
    })
    .await
    .unwrap()
    .unwrap();
    let _ = shutdown.send(());
    proxy_task.await.unwrap();
    assert!(
        output.status.success(),
        "child: {}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(String::from_utf8_lossy(&output.stdout).contains("1 passed"));
    assert_eq!(accepted.load(Ordering::SeqCst), 0);
}

#[test]
fn fixture_transport_requires_numeric_loopback_without_url_extras() {
    for value in [
        "http://127.0.0.1:4567",
        "http://127.42.255.254:4567",
        "http://[::1]:4567",
    ] {
        assert!(validate_fixture_endpoint(value).is_ok());
    }
    for value in [
        "http://localhost:4567",
        "https://127.0.0.1:4567",
        "http://user@127.0.0.1:4567",
        "http://127.0.0.1:4567?q=x",
        "http://127.0.0.1:4567/#fragment",
        "http://127.0.0.1:4567/path",
        "http://192.0.2.7:4567",
        "http://[::]:4567",
        "http://127.0.0.1",
    ] {
        assert!(validate_fixture_endpoint(value).is_err(), "{value}");
    }
}
