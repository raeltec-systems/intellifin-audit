//! Producer-driven working knowledge contracts against guarded real PostgreSQL.
//! Only this entrypoint resets the disposable database. No knowledge row is seeded.
use std::{collections::BTreeMap, sync::Arc, time::Duration};

use sha2::{Digest, Sha256};
use sqlx::{Connection, Executor, PgConnection, PgPool, postgres::PgPoolOptions};
use tokio::sync::Mutex;
use zobba_application::{
    evidence::{
        self, EvidenceError, EvidenceMetadata, EvidenceObjects, MeasuredObject, ObjectError,
    },
    knowledge::*,
    task::TaskCommands,
};
use zobba_domain::{
    evidence::{ContentIdentity, RegisteredEvidence, ReservationRequest, SourceAssertions},
    identity::Scope,
    task::{CommandKind, CommandReceipt, TaskCommand},
};
use zobba_infrastructure::{
    database_options,
    evidence::EvidenceRepository,
    fixture::seed_local_configured,
    identity::{IdentityRepository, secret_hash},
    knowledge::KnowledgeRepository,
    migrate,
    task::TaskRepository,
};

mod support;

const ISSUER: &str = "https://127.0.0.1:4443";
const APP: &str = "knowledge-contract";

fn scope() -> Scope {
    Scope {
        organisation_id: "org-a".into(),
        client_id: "client-a".into(),
        engagement_id: "engagement-a".into(),
    }
}
fn destination() -> Scope {
    Scope {
        engagement_id: "engagement-later".into(),
        ..scope()
    }
}
fn other_client() -> Scope {
    Scope {
        client_id: "client-other".into(),
        engagement_id: "engagement-other".into(),
        ..scope()
    }
}
fn supporting_scope() -> Scope {
    Scope {
        engagement_id: "engagement-support".into(),
        ..scope()
    }
}

/// Immutable object port; the application verifies the exact bytes and digest.
/// PostgreSQL registration and knowledge capture use their production repositories.
#[derive(Clone, Default)]
struct Objects {
    bytes: Arc<Mutex<BTreeMap<String, Vec<u8>>>>,
    version: Option<String>,
}
impl EvidenceObjects for Objects {
    fn namespace(&self) -> &str {
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    }
    fn measure(&self, bytes: &[u8]) -> ContentIdentity {
        ContentIdentity {
            sha256: format!("{:x}", Sha256::digest(bytes)),
            size: bytes.len() as u64,
        }
    }
    async fn put_if_absent(&self, id: &str, bytes: Vec<u8>) -> Result<String, ObjectError> {
        let mut objects = self.bytes.lock().await;
        if objects.contains_key(id) {
            return Err(ObjectError::AlreadyExists);
        }
        objects.insert(id.into(), bytes);
        Ok(self
            .version
            .as_deref()
            .unwrap_or("immutable-version-1")
            .into())
    }
    async fn latest_version(&self, id: &str) -> Result<Option<String>, ObjectError> {
        Ok(self.bytes.lock().await.contains_key(id).then(|| {
            self.version
                .as_deref()
                .unwrap_or("immutable-version-1")
                .into()
        }))
    }
    async fn get_version(
        &self,
        id: &str,
        namespace: &str,
        version: &str,
    ) -> Result<MeasuredObject, ObjectError> {
        if namespace != self.namespace()
            || version != self.version.as_deref().unwrap_or("immutable-version-1")
        {
            return Err(ObjectError::VersionUnavailable);
        }
        let bytes = self
            .bytes
            .lock()
            .await
            .get(id)
            .cloned()
            .ok_or(ObjectError::Unavailable)?;
        Ok(MeasuredObject {
            identity: self.measure(&bytes),
            bytes,
        })
    }
}

struct HeldRead {
    objects: Objects,
    entered: Arc<tokio::sync::Notify>,
    release: Arc<tokio::sync::Notify>,
}
impl EvidenceObjects for HeldRead {
    fn namespace(&self) -> &str {
        self.objects.namespace()
    }
    fn measure(&self, bytes: &[u8]) -> ContentIdentity {
        self.objects.measure(bytes)
    }
    async fn put_if_absent(&self, id: &str, bytes: Vec<u8>) -> Result<String, ObjectError> {
        self.objects.put_if_absent(id, bytes).await
    }
    async fn latest_version(&self, id: &str) -> Result<Option<String>, ObjectError> {
        self.objects.latest_version(id).await
    }
    async fn get_version(
        &self,
        id: &str,
        namespace: &str,
        version: &str,
    ) -> Result<MeasuredObject, ObjectError> {
        let bytes = self.objects.get_version(id, namespace, version).await?;
        self.entered.notify_one();
        self.release.notified().await;
        Ok(bytes)
    }
}

struct Fixture {
    pool: PgPool,
    knowledge: KnowledgeRepository,
    manager: KnowledgeRepository,
    tasks: TaskRepository,
    manager_tasks: TaskRepository,
    evidence: EvidenceRepository,
    objects: Objects,
    identities: IdentityRepository,
    auditor_token: String,
}
impl Fixture {
    async fn new(pool: PgPool) -> Self {
        let identities = IdentityRepository::new(pool.clone());
        let auditor_token = identities
            .establish_session(ISSUER, "auditor-a", "Auditor", None)
            .await
            .unwrap();
        let manager_token = identities
            .establish_session(ISSUER, "manager-a", "Manager", None)
            .await
            .unwrap();
        let auditor_hash = secret_hash(&auditor_token);
        let manager_hash = secret_hash(&manager_token);
        Self {
            knowledge: KnowledgeRepository::new(pool.clone())
                .with_session_hash(auditor_hash.clone()),
            manager: KnowledgeRepository::new(pool.clone()).with_session_hash(manager_hash.clone()),
            tasks: TaskRepository::new(pool.clone()).with_session_hash(auditor_hash.clone()),
            manager_tasks: TaskRepository::new(pool.clone()).with_session_hash(manager_hash),
            evidence: EvidenceRepository::new(pool.clone()).with_session_hash(auditor_hash),
            objects: Objects::default(),
            identities,
            auditor_token,
            pool,
        }
    }
    async fn task(&self, key: &str, selected_scope: &Scope) -> CommandReceipt {
        self.tasks
            .admit(
                "actor-a",
                selected_scope,
                &TaskCommand {
                    key: key.into(),
                    kind: CommandKind::Create,
                    task_id: None,
                    cycle_id: None,
                    content: Some(
                        "Inspect supported knowledge without an external operation account".into(),
                    ),
                    context: None,
                },
            )
            .await
            .unwrap()
    }
    fn guide(key: &str, task: &CommandReceipt, text: &str) -> TaskCommand {
        TaskCommand {
            key: key.into(),
            kind: CommandKind::Guide,
            task_id: Some(task.task_id.clone()),
            cycle_id: Some(task.cycle_id.clone()),
            content: Some(text.into()),
            context: None,
        }
    }
    async fn acquire(&self, key: &str, filename: &str, bytes: &[u8]) -> RegisteredEvidence {
        self.acquire_at(&scope(), key, filename, bytes).await
    }
    async fn acquire_at(
        &self,
        selected_scope: &Scope,
        key: &str,
        filename: &str,
        bytes: &[u8],
    ) -> RegisteredEvidence {
        let request = ReservationRequest {
            key: key.into(),
            filename: filename.into(),
            identity: self.objects.measure(bytes),
            source: SourceAssertions {
                system: Some("User asserted synthetic ledger".into()),
                source_version: Some("asserted-version".into()),
                coverage: Some("A selected synthetic sample, not a complete population".into()),
                ..SourceAssertions::default()
            },
        };
        let reserved = self
            .evidence
            .reserve(
                "actor-a",
                selected_scope,
                &request,
                self.objects.namespace(),
            )
            .await
            .unwrap();
        evidence::acquire(
            &self.evidence,
            &self.objects,
            "actor-a",
            selected_scope,
            &reserved.reservation.id,
            bytes.to_vec(),
        )
        .await
        .unwrap()
    }
}

async fn wait_blocked(observer: &mut PgConnection) {
    wait_blocked_at_least(observer, 1).await;
}
async fn wait_blocked_at_least(observer: &mut PgConnection, expected: i64) {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(4);
    loop {
        let blocked: i64 = sqlx::query_scalar("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND application_name=$1 AND state='active' AND cardinality(pg_blocking_pids(pid))>0")
            .bind(APP).fetch_one(&mut *observer).await.unwrap();
        if blocked >= expected {
            return;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "knowledge request did not reach the actual PostgreSQL barrier"
        );
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

#[tokio::test]
async fn postgres_knowledge_producers_retrieval_authority_and_mutation_contracts() {
    let config = support::Configuration::from_environment();
    let mut owner = PgConnection::connect(&config.migration).await.unwrap();
    config.guard_connection(&mut owner).await;
    owner.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public; REVOKE CREATE ON SCHEMA public FROM PUBLIC").await.unwrap();
    migrate(
        &config.migration,
        database_options(&config.runtime).unwrap().get_username(),
    )
    .await
    .unwrap();
    seed_local_configured(ISSUER, &config.migration)
        .await
        .unwrap();
    let mut admin = PgConnection::connect(&config.admin).await.unwrap();
    config.guard_connection(&mut admin).await;
    admin.execute("INSERT INTO public.clients(organisation_id,id,name) VALUES('org-a','client-other','Different client');
        INSERT INTO public.engagements(organisation_id,client_id,id,name) VALUES('org-a','client-a','engagement-later','Later same-client audit'),('org-a','client-a','engagement-support','Independently restricted evidential source'),('org-a','client-other','engagement-other','Different client audit');
        INSERT INTO public.engagement_assignments(organisation_id,client_id,engagement_id,actor_id) VALUES('org-a','client-a','engagement-later','actor-a'),('org-a','client-a','engagement-later','actor-manager'),('org-a','client-a','engagement-support','actor-a'),('org-a','client-a','engagement-support','actor-manager'),('org-a','client-other','engagement-other','actor-a');").await.unwrap();
    let pool = PgPoolOptions::new()
        .max_connections(8)
        .connect_with(
            database_options(&config.runtime)
                .unwrap()
                .application_name(APP),
        )
        .await
        .unwrap();
    let fixture = Fixture::new(pool).await;
    producer_identity_and_recovery(&fixture, &mut admin).await;
    maximum_automatic_producer_shapes(&fixture, &mut admin).await;
    deduplicated_capture_keeps_current_exclusion(&fixture).await;
    correction_graph_and_source_replacement(&fixture, &mut admin).await;
    same_client_reuse_checks_viewer_and_accountable_actor(&fixture, &mut admin).await;
    preferences_learn_release_and_consume_undo(&fixture, &mut admin).await;
    oversized_envelope_refuses_before_writes_and_keeps_controls(&fixture, &mut admin).await;
    period_and_keyset_exact_lookup(&fixture).await;
    reuse_qualifies_both_exact_task_consumers(&fixture, &mut admin).await;
    dependency_periods_cannot_be_laundered(&fixture).await;
    publication_capacity_preserves_replay_withdrawal_and_undo(&fixture).await;
    merged_scan_budget_preserves_eligible_tail(&fixture, &mut admin).await;
    maximum_reason_receipts_preserve_large_records(&fixture, &mut admin).await;
    queued_verification_refreshes_source_and_authority(&fixture, &config, &mut admin).await;
    post_io_and_session_fences(&fixture, &config, &mut admin).await;
    fixture.pool.close().await;
}

async fn page(f: &Fixture, selected_scope: &Scope, task: &CommandReceipt) -> KnowledgePage {
    f.knowledge
        .inspect(
            "actor-a",
            selected_scope,
            &task.task_id,
            &KnowledgeQuery::default(),
        )
        .await
        .unwrap()
}
fn reference(record: &KnowledgeRecord) -> RecordReference {
    RecordReference {
        id: record.id.clone(),
        revision: record.revision,
    }
}
fn dependency(record: &KnowledgeRecord) -> Dependency {
    Dependency::Knowledge {
        id: record.id.clone(),
        revision: record.revision,
        scope: record.scope.clone(),
    }
}
fn assertion(text: &str, dependencies: Vec<Dependency>) -> Assertion {
    Assertion {
        text: text.into(),
        period: Period::default(),
        uncertainty: Some(
            "An attributed assertion; not an independently verified conclusion".into(),
        ),
        dependencies,
    }
}
async fn command(
    f: &Fixture,
    task: &CommandReceipt,
    key: &str,
    action: KnowledgeAction,
) -> KnowledgeReceipt {
    let revision = page(f, &scope(), task).await.revision;
    f.knowledge
        .mutate(
            "actor-a",
            &scope(),
            &task.task_id,
            &KnowledgeCommand {
                key: key.into(),
                expected_revision: revision,
                action,
            },
        )
        .await
        .unwrap()
}
async fn asserted(
    f: &Fixture,
    task: &CommandReceipt,
    key: &str,
    text: &str,
    dependencies: Vec<Dependency>,
) -> KnowledgeRecord {
    command(
        f,
        task,
        key,
        KnowledgeAction::Assert {
            assertion: assertion(text, dependencies),
        },
    )
    .await
    .record
    .unwrap()
    .record
}

async fn producer_identity_and_recovery(f: &Fixture, admin: &mut PgConnection) {
    let task = f.task("producer-task", &scope()).await;
    let original_text =
        "\u{feff}Source text\r\nEmoji 🧾 and e\u{301}; preserve every original byte.\r\n";
    let original = f
        .acquire("automatic-original", "ledger.txt", original_text.as_bytes())
        .await;
    let captured_status = f
        .knowledge
        .source_status("actor-a", &scope(), &original.reservation.id)
        .await
        .unwrap();
    assert_eq!(captured_status.evidence_id, original.reservation.id);
    assert_eq!(captured_status.source_revision, 0);
    assert!(captured_status.capture_revision > 0);
    assert!(captured_status.replacement_id.is_none());
    let first = page(f, &scope(), &task).await;
    let observation = first
        .items
        .iter()
        .find(|v| {
            v.record.kind == KnowledgeKind::Observation
                && v.record
                    .source
                    .as_ref()
                    .is_some_and(|s| s.evidence_id == original.reservation.id)
        })
        .expect("verified acquisition automatically records the exact supported excerpt");
    assert_eq!(observation.record.text, original_text);
    assert_eq!(observation.record.actor_id, "actor-a");
    assert_eq!(observation.record.certainty, Certainty::SourceStates);
    assert_eq!(
        observation.record.scope,
        KnowledgeScope::engagement(&scope())
    );
    let source = observation.record.source.as_ref().unwrap();
    assert_eq!(
        (source.byte_start, source.byte_end, source.original_size),
        (0, original_text.len() as u64, original_text.len() as u64)
    );
    assert_eq!(source.storage_version, original.version);
    assert_eq!(source.digest, original.reservation.request.identity.sha256);
    assert!(!source.partial);
    let assertions: Vec<_> = first
        .items
        .iter()
        .filter(|v| {
            v.record.kind == KnowledgeKind::Assertion
                && v.record
                    .source
                    .as_ref()
                    .is_some_and(|s| s.evidence_id == original.reservation.id)
        })
        .collect();
    assert_eq!(
        assertions.len(),
        3,
        "source system, version and coverage retain separate asserted standing"
    );
    assert!(
        assertions
            .iter()
            .all(|v| v.record.certainty == Certainty::Asserted)
    );
    let original_reference = reference(&observation.record);
    let retry = evidence::acquire(
        &f.evidence,
        &f.objects,
        "actor-a",
        &scope(),
        &original.reservation.id,
        original_text.as_bytes().to_vec(),
    )
    .await
    .unwrap();
    assert_eq!(retry, original);
    assert_eq!(
        page(f, &scope(), &task).await,
        first,
        "exact acquisition replay adds no duplicate observations"
    );

    let guide = Fixture::guide(
        "accepted-direction",
        &task,
        "Keep this decision attributable to the original Task and cycle.",
    );
    let receipt = f.tasks.admit("actor-a", &scope(), &guide).await.unwrap();
    let with_direction = page(f, &scope(), &task).await;
    let direction = with_direction
        .items
        .iter()
        .find(|v| {
            v.record
                .direction
                .as_ref()
                .is_some_and(|d| d.command_id == receipt.command_id)
        })
        .expect("accepted Guide is projected atomically");
    let basis = direction.record.direction.as_ref().unwrap();
    assert_eq!(basis.task_id, task.task_id);
    assert_eq!(basis.cycle_id, task.cycle_id);
    assert!(basis.standing.contains("Received") && basis.standing.contains("original Task/cycle"));
    assert_eq!(direction.record.certainty, Certainty::UserDirected);
    assert_eq!(direction.record.text, guide.content.clone().unwrap());
    assert_eq!(
        f.tasks.admit("actor-a", &scope(), &guide).await.unwrap(),
        receipt
    );
    assert_eq!(page(f, &scope(), &task).await, with_direction);
    let wrong_cycle = KnowledgeCommand {
        key: "wrong-guide-cycle".into(),
        expected_revision: with_direction.revision,
        action: KnowledgeAction::Assert {
            assertion: assertion(
                "Unsupported cycle provenance must not be admitted",
                vec![Dependency::Guide {
                    command_id: receipt.command_id.clone(),
                    task_id: task.task_id.clone(),
                    cycle_id: "different-cycle".into(),
                    scope: KnowledgeScope::engagement(&scope()),
                }],
            ),
        },
    };
    assert_eq!(
        f.knowledge
            .mutate("actor-a", &scope(), &task.task_id, &wrong_cycle)
            .await,
        Err(KnowledgeError::Denied),
        "a real Guide command and Task do not authorize a fabricated cycle"
    );
    assert_eq!(
        page(f, &scope(), &task).await,
        with_direction,
        "invalid exact source provenance is atomic"
    );
    let later = f.task("later-direction-context", &scope()).await;
    let historical = f
        .knowledge
        .exact(
            "actor-a",
            &scope(),
            &later.task_id,
            &direction.record.id,
            direction.record.revision,
        )
        .await
        .unwrap();
    assert_eq!(
        historical.record.direction.as_ref().unwrap().task_id,
        task.task_id,
        "retrieval never relabels old guidance as direction to the later Task"
    );

    // Force a missing derivative while retaining the accepted Guide source.
    // Recovery is the real admission retry, not an inserted replacement record.
    sqlx::query("DELETE FROM public.knowledge_records WHERE id=$1")
        .bind(&direction.record.id)
        .execute(&mut *admin)
        .await
        .unwrap();
    assert_eq!(
        f.tasks.admit("actor-a", &scope(), &guide).await.unwrap(),
        receipt
    );
    let recovered = f
        .knowledge
        .exact(
            "actor-a",
            &scope(),
            &task.task_id,
            &direction.record.id,
            direction.record.revision,
        )
        .await
        .unwrap();
    assert_eq!(recovered.record, direction.record);

    // The older metadata-only registration path creates an actual pending capture.
    let bytes = b"registered original survives an interruption before derivative capture";
    let reservation = f
        .evidence
        .reserve(
            "actor-a",
            &scope(),
            &ReservationRequest {
                key: "pending-capture-original".into(),
                filename: "pending.txt".into(),
                identity: f.objects.measure(bytes),
                source: SourceAssertions::default(),
            },
            f.objects.namespace(),
        )
        .await
        .unwrap();
    let version = f
        .objects
        .put_if_absent(&reservation.reservation.id, bytes.to_vec())
        .await
        .unwrap();
    let pending = f
        .evidence
        .register(
            "actor-a",
            &scope(),
            &reservation.reservation.id,
            f.objects.namespace(),
            &version,
            &f.objects.measure(bytes),
        )
        .await
        .unwrap();
    let pending_status = f
        .knowledge
        .source_status("actor-a", &scope(), &pending.reservation.id)
        .await
        .unwrap();
    assert!(
        !pending_status.omissions.is_empty(),
        "exact original status exposes the unfinished capture independently of search pages"
    );
    assert!(
        page(f, &scope(), &task)
            .await
            .omissions
            .contains(&Omission::UnavailableSupport),
        "capture pending state is visible before recovery"
    );
    let recovered_original = evidence::acquire(
        &f.evidence,
        &f.objects,
        "actor-a",
        &scope(),
        &pending.reservation.id,
        bytes.to_vec(),
    )
    .await
    .unwrap();
    assert_eq!(recovered_original, pending);
    let finished_status = f
        .knowledge
        .source_status("actor-a", &scope(), &pending.reservation.id)
        .await
        .unwrap();
    assert!(finished_status.capture_revision > pending_status.capture_revision);
    assert!(
        !finished_status
            .omissions
            .contains(&Omission::LegacyNotCaptured)
    );
    assert!(
        page(f, &scope(), &task)
            .await
            .items
            .iter()
            .any(|v| v.record.text.as_bytes() == bytes)
    );
    assert_eq!(
        f.knowledge
            .exact(
                "actor-a",
                &scope(),
                &task.task_id,
                &original_reference.id,
                original_reference.revision
            )
            .await
            .unwrap()
            .record
            .text,
        original_text
    );

    let unsupported = f
        .acquire("binary-original", "opaque.bin", &[0xff, 0x00, 0x11])
        .await;
    assert!(
        f.knowledge
            .source_status("actor-a", &scope(), &unsupported.reservation.id)
            .await
            .unwrap()
            .omissions
            .contains(&Omission::UnsupportedFormat)
    );
    let binary_page = page(f, &scope(), &task).await;
    assert!(binary_page.omissions.contains(&Omission::UnsupportedFormat));
    assert!(!binary_page.items.iter().any(|v| {
        v.record.kind == KnowledgeKind::Observation
            && v.record
                .source
                .as_ref()
                .is_some_and(|s| s.evidence_id == unsupported.reservation.id)
    }));
    let (_, bytes) = evidence::read_original(
        &f.evidence,
        &f.objects,
        "actor-a",
        &scope(),
        &unsupported.reservation.id,
    )
    .await
    .unwrap();
    assert_eq!(
        bytes,
        [0xff, 0x00, 0x11],
        "unsupported extraction retains immutable original access"
    );
    let large_text = format!("\u{feff}{}", "🧾".repeat(5000));
    let large = f
        .acquire("bounded-large-original", "large.txt", large_text.as_bytes())
        .await;
    let bounded = page(f, &scope(), &task).await;
    let excerpt = bounded
        .items
        .iter()
        .find(|v| {
            v.record.kind == KnowledgeKind::Observation
                && v.record
                    .source
                    .as_ref()
                    .is_some_and(|s| s.evidence_id == large.reservation.id)
        })
        .unwrap();
    let location = excerpt.record.source.as_ref().unwrap();
    assert!(location.partial && location.byte_end < location.original_size);
    assert!(excerpt.record.text.len() <= MAX_EXCERPT_BYTES);
    assert_eq!(
        excerpt.record.text.as_bytes(),
        &large_text.as_bytes()[..location.byte_end as usize]
    );
    assert!(bounded.omissions.contains(&Omission::PartialSource));
    let source_status = f
        .knowledge
        .source_status("actor-a", &scope(), &large.reservation.id)
        .await
        .unwrap();
    assert_eq!(
        source_status.omissions,
        vec![Omission::PartialSource],
        "real bounded acquisition emits one partial-source category despite both recorded partial causes"
    );
    assert_eq!(
        evidence::read_original(
            &f.evidence,
            &f.objects,
            "actor-a",
            &scope(),
            &large.reservation.id
        )
        .await
        .unwrap()
        .1,
        large_text.as_bytes(),
        "capture bounds never truncate the registered original"
    );
}

async fn maximum_automatic_producer_shapes(f: &Fixture, admin: &mut PgConnection) {
    let task = f.task("maximum-producer-task", &scope()).await;
    let objects = Objects {
        version: Some("v".repeat(512)),
        ..Objects::default()
    };
    let pattern = "\t\"\\\r\n";
    let text = format!(
        "{}{}",
        pattern.repeat(MAX_EXCERPT_BYTES / pattern.len()),
        "x".repeat(MAX_EXCERPT_BYTES % pattern.len())
    );
    assert_eq!(text.len(), MAX_EXCERPT_BYTES);
    let asserted = "\\\"".repeat(1000);
    assert_eq!(asserted.len(), 2000);
    let request = ReservationRequest {
        key: "maximum-automatic-original".into(),
        filename: "maximum.txt".into(),
        identity: objects.measure(text.as_bytes()),
        source: SourceAssertions {
            system: Some(asserted.clone()),
            account: Some(asserted.clone()),
            source_version: Some(asserted.clone()),
            selection: Some(asserted.clone()),
            coverage: Some(asserted),
        },
    };
    assert!(request.is_valid());
    let reservation = f
        .evidence
        .reserve("actor-a", &scope(), &request, objects.namespace())
        .await
        .unwrap();
    let evidence = evidence::acquire(
        &f.evidence,
        &objects,
        "actor-a",
        &scope(),
        &reservation.reservation.id,
        text.as_bytes().to_vec(),
    )
    .await
    .unwrap();
    assert_eq!(evidence.version.len(), 512);
    let captured = page(f, &scope(), &task).await;
    let records: Vec<_> = captured
        .items
        .iter()
        .filter(|v| {
            v.record
                .source
                .as_ref()
                .is_some_and(|s| s.evidence_id == evidence.reservation.id)
        })
        .collect();
    assert_eq!(
        records.len(),
        6,
        "maximum supported quote and all five asserted fields capture automatically"
    );
    let observation = records
        .iter()
        .find(|v| v.record.kind == KnowledgeKind::Observation)
        .unwrap();
    assert_eq!(observation.record.text, text);
    assert!(!observation.record.source.as_ref().unwrap().partial);
    assert!(
        records
            .iter()
            .all(|v| serde_json::to_vec(&v.record).unwrap().len() < 60_000)
    );
    let largest: i32 = sqlx::query_scalar("SELECT max(octet_length(document::text)) FROM public.knowledge_records WHERE document->'source'->>'evidence_id'=$1").bind(&evidence.reservation.id).fetch_one(&mut *admin).await.unwrap();
    assert!(
        largest < 60_000,
        "actual persisted maximum producer envelope remains below the conservative record bound: {largest}"
    );
    let guide_text = pattern.repeat(zobba_domain::task::COMMAND_CONTENT_MAX / pattern.len());
    assert_eq!(guide_text.len(), zobba_domain::task::COMMAND_CONTENT_MAX);
    let command = Fixture::guide("maximum-guide", &task, &guide_text);
    let received = f.tasks.admit("actor-a", &scope(), &command).await.unwrap();
    let captured = page(f, &scope(), &task).await;
    let direction = captured
        .items
        .iter()
        .find(|v| {
            v.record
                .direction
                .as_ref()
                .is_some_and(|d| d.command_id == received.command_id)
        })
        .unwrap();
    assert_eq!(direction.record.text, guide_text);
    assert!(serde_json::to_vec(&direction.record).unwrap().len() < 60_000);
    assert_eq!(
        f.tasks.admit("actor-a", &scope(), &command).await.unwrap(),
        received
    );
    assert_eq!(
        evidence::acquire(
            &f.evidence,
            &objects,
            "actor-a",
            &scope(),
            &reservation.reservation.id,
            text.as_bytes().to_vec()
        )
        .await
        .unwrap(),
        evidence
    );
}

async fn deduplicated_capture_keeps_current_exclusion(f: &Fixture) {
    let task = f.task("forgotten-capture-task", &scope()).await;
    let bytes = b"A forgotten observation must not become current through a new recovery key";
    let original = f
        .acquire("forgotten-capture-original", "forgotten.txt", bytes)
        .await;
    let captured = page(f, &scope(), &task).await;
    let observation = captured
        .items
        .iter()
        .find(|v| {
            v.record.kind == KnowledgeKind::Observation
                && v.record
                    .source
                    .as_ref()
                    .is_some_and(|s| s.evidence_id == original.reservation.id)
        })
        .unwrap()
        .record
        .clone();
    command(
        f,
        &task,
        "forget-captured-observation",
        KnowledgeAction::Forget {
            target: reference(&observation),
            reason: "Exclude this exact observation from future working context".into(),
        },
    )
    .await;
    let (registered, verified) = evidence::read_original(
        &f.evidence,
        &f.objects,
        "actor-a",
        &scope(),
        &original.reservation.id,
    )
    .await
    .unwrap();
    let recovered = f
        .knowledge
        .recover_capture(
            "actor-a",
            &scope(),
            "new-recovery-key-after-forget",
            &registered,
            &evidence::capture_evidence(&verified, &registered.reservation.request.source),
        )
        .await
        .unwrap();
    let historical = recovered.record.unwrap();
    assert_eq!(historical.record, observation);
    assert_eq!(historical.status, RecordStatus::Forgotten);
    assert!(!historical.can_forget);
    let excerpt = evidence::capture_range(&verified, 0, verified.len() as u64).unwrap();
    let recaptured = f
        .knowledge
        .record_excerpt(
            "actor-a",
            &scope(),
            &CaptureExcerpt {
                key: "new-excerpt-key-after-forget".into(),
                evidence_id: original.reservation.id,
                byte_start: 0,
                byte_end: verified.len() as u64,
            },
            &registered,
            &excerpt,
        )
        .await
        .unwrap();
    assert_eq!(recaptured.record.unwrap().status, RecordStatus::Forgotten);
    assert!(
        !page(f, &scope(), &task)
            .await
            .items
            .iter()
            .any(|v| v.record.id == observation.id)
    );
}

async fn correction_graph_and_source_replacement(f: &Fixture, _admin: &mut PgConnection) {
    let task = f.task("correction-task", &scope()).await;
    let a = asserted(f, &task, "assert-a", "Assertion A", vec![]).await;
    let b = asserted(
        f,
        &task,
        "assert-b",
        "Assertion B depends on A",
        vec![dependency(&a)],
    )
    .await;
    let c = asserted(
        f,
        &task,
        "assert-c",
        "Assertion C depends on B",
        vec![dependency(&b)],
    )
    .await;
    let revision = page(f, &scope(), &task).await.revision;
    let cyclic = KnowledgeCommand {
        key: "cycle-refused".into(),
        expected_revision: revision,
        action: KnowledgeAction::Correct {
            target: reference(&a),
            assertion: assertion("Cyclic successor", vec![dependency(&c)]),
            reason: "Must not close the dependency cycle".into(),
        },
    };
    assert_eq!(
        f.knowledge
            .mutate("actor-a", &scope(), &task.task_id, &cyclic)
            .await,
        Err(KnowledgeError::Cycle)
    );
    assert_eq!(
        page(f, &scope(), &task).await.revision,
        revision,
        "cycle refusal is atomic"
    );
    let correction = KnowledgeCommand {
        key: "correct-a".into(),
        expected_revision: revision,
        action: KnowledgeAction::Correct {
            target: reference(&a),
            assertion: assertion("Assertion A corrected", vec![]),
            reason: "Original interpretation was wrong".into(),
        },
    };
    let corrected = f
        .knowledge
        .mutate("actor-a", &scope(), &task.task_id, &correction)
        .await
        .unwrap();
    for dependent in [&b, &c] {
        let historical = f
            .knowledge
            .exact(
                "actor-a",
                &scope(),
                &task.task_id,
                &dependent.id,
                dependent.revision,
            )
            .await
            .unwrap();
        assert_eq!(historical.record, *dependent);
        assert_eq!(
            historical.status,
            RecordStatus::Invalidated,
            "correction invalidates transitive support"
        );
    }
    let retained = f
        .knowledge
        .exact("actor-a", &scope(), &task.task_id, &a.id, a.revision)
        .await
        .unwrap();
    assert_eq!(retained.record, a);
    assert_eq!(retained.status, RecordStatus::Corrected);
    assert_eq!(
        f.knowledge
            .mutate("actor-a", &scope(), &task.task_id, &correction)
            .await
            .unwrap(),
        corrected
    );
    let mut changed = correction.clone();
    changed.action = KnowledgeAction::Exclude {
        target: reference(&a),
        reason: "Different meaning".into(),
    };
    assert_eq!(
        f.knowledge
            .mutate("actor-a", &scope(), &task.task_id, &changed)
            .await,
        Err(KnowledgeError::Conflict)
    );

    let original = f
        .acquire("source-before", "same-name.txt", b"same immutable bytes")
        .await;
    let replacement = f
        .acquire("source-after", "same-name.txt", b"same immutable bytes")
        .await;
    let captured = page(f, &scope(), &task).await;
    let old = captured
        .items
        .iter()
        .find(|v| {
            v.record.kind == KnowledgeKind::Observation
                && v.record
                    .source
                    .as_ref()
                    .is_some_and(|s| s.evidence_id == original.reservation.id)
        })
        .unwrap()
        .record
        .clone();
    assert_eq!(
        f.knowledge
            .exact("actor-a", &scope(), &task.task_id, &old.id, old.revision)
            .await
            .unwrap()
            .status,
        RecordStatus::Current,
        "equal filename/digest/asserted version do not implicitly supersede evidence"
    );
    let source_child = asserted(
        f,
        &task,
        "source-child",
        "Interpretation of the original source",
        vec![dependency(&old)],
    )
    .await;
    let source_grandchild = asserted(
        f,
        &task,
        "source-grandchild",
        "Derived from the interpretation",
        vec![dependency(&source_child)],
    )
    .await;
    command(
        f,
        &task,
        "replace-source",
        KnowledgeAction::CorrectSource {
            predecessor_id: original.reservation.id.clone(),
            replacement_id: replacement.reservation.id.clone(),
            expected_source_revision: 0,
            reason: "Explicitly replace the selected source".into(),
        },
    )
    .await;
    let source_status = f
        .knowledge
        .source_status("actor-a", &scope(), &original.reservation.id)
        .await
        .unwrap();
    assert_eq!(source_status.source_revision, 1);
    assert_eq!(
        source_status.correction_actor_id.as_deref(),
        Some("actor-a")
    );
    assert!(
        source_status
            .correction_recorded_at
            .is_some_and(|time| time > 0)
    );
    assert_eq!(
        source_status.correction_reason.as_deref(),
        Some("Explicitly replace the selected source")
    );
    assert_eq!(
        source_status.replacement_id,
        Some(replacement.reservation.id.clone())
    );
    for record in [&old, &source_child, &source_grandchild] {
        assert_eq!(
            f.knowledge
                .exact(
                    "actor-a",
                    &scope(),
                    &task.task_id,
                    &record.id,
                    record.revision
                )
                .await
                .unwrap()
                .status,
            RecordStatus::Invalidated
        );
    }
    let reverse = KnowledgeCommand {
        key: "reverse-source-cycle".into(),
        expected_revision: page(f, &scope(), &task).await.revision,
        action: KnowledgeAction::CorrectSource {
            predecessor_id: replacement.reservation.id.clone(),
            replacement_id: original.reservation.id.clone(),
            expected_source_revision: 0,
            reason: "Must not create a source cycle".into(),
        },
    };
    assert_eq!(
        f.knowledge
            .mutate("actor-a", &scope(), &task.task_id, &reverse)
            .await,
        Err(KnowledgeError::Cycle)
    );
    for evidence in [&original, &replacement] {
        assert_eq!(
            evidence::read_original(
                &f.evidence,
                &f.objects,
                "actor-a",
                &scope(),
                &evidence.reservation.id
            )
            .await
            .unwrap()
            .1,
            b"same immutable bytes"
        );
        assert_eq!(
            evidence::acquire(
                &f.evidence,
                &f.objects,
                "actor-a",
                &scope(),
                &evidence.reservation.id,
                b"same immutable bytes".to_vec()
            )
            .await
            .unwrap(),
            *evidence,
            "source correction preserves original acquisition retry facts"
        );
    }

    let raced = asserted(
        f,
        &task,
        "race-original",
        "Concurrent correction source",
        vec![],
    )
    .await;
    let revision = page(f, &scope(), &task).await.revision;
    let correction = |key: &str, text: &str| KnowledgeCommand {
        key: key.into(),
        expected_revision: revision,
        action: KnowledgeAction::Correct {
            target: reference(&raced),
            assertion: assertion(text, vec![]),
            reason: "Concurrent correction with one exact expected basis".into(),
        },
    };
    let left = correction("race-left", "Left successor");
    let right = correction("race-right", "Right successor");
    let selected_scope = scope();
    let (left_result, right_result) = tokio::join!(
        f.knowledge
            .mutate("actor-a", &selected_scope, &task.task_id, &left),
        f.knowledge
            .mutate("actor-a", &selected_scope, &task.task_id, &right),
    );
    assert!(
        matches!(
            (&left_result, &right_result),
            (Ok(_), Err(KnowledgeError::Conflict)) | (Err(KnowledgeError::Conflict), Ok(_))
        ),
        "one concurrent correction commits and the stale revision refuses atomically: {left_result:?}, {right_result:?}"
    );
    assert_eq!(page(f, &scope(), &task).await.revision, revision + 1);
    assert_eq!(
        f.knowledge
            .exact(
                "actor-a",
                &scope(),
                &task.task_id,
                &raced.id,
                raced.revision
            )
            .await
            .unwrap()
            .record,
        raced
    );
}

async fn same_client_reuse_checks_viewer_and_accountable_actor(
    f: &Fixture,
    admin: &mut PgConnection,
) {
    let origin = f.task("reuse-origin", &scope()).await;
    let later = f.task("reuse-destination", &destination()).await;
    let other = f.task("reuse-other-client", &other_client()).await;
    let evidence = f
        .acquire_at(
            &supporting_scope(),
            "independent-reuse-support",
            "support.txt",
            b"Private supporting bytes from a third engagement",
        )
        .await;
    let source_command = KnowledgeCommand {
        key: "reuse-fact".into(),
        expected_revision: page(f, &scope(), &origin).await.revision,
        action: KnowledgeAction::Assert {
            assertion: assertion(
                "Only this exact later same-client Task may reuse the source",
                vec![Dependency::Evidence {
                    evidence_id: evidence.reservation.id.clone(),
                    storage_version: evidence.version.clone(),
                    digest: evidence.reservation.request.identity.sha256.clone(),
                    scope: KnowledgeScope::engagement(&supporting_scope()),
                }],
            ),
        },
    };
    let source_receipt = f
        .knowledge
        .mutate("actor-a", &scope(), &origin.task_id, &source_command)
        .await
        .unwrap();
    let source = source_receipt.record.as_ref().unwrap().record.clone();
    assert!(
        !page(f, &destination(), &later)
            .await
            .items
            .iter()
            .any(|v| v.record.id == source.id)
    );
    command(
        f,
        &origin,
        "allow-reuse",
        KnowledgeAction::Reuse {
            target: reference(&source),
            destination_engagement_id: destination().engagement_id,
            destination_task_id: later.task_id.clone(),
            reason: "Named later engagement needs the source context".into(),
        },
    )
    .await;
    let reused = page(f, &destination(), &later).await;
    assert!(reused.items.iter().any(|v| v.record == source));
    let unrelated = f.task("reuse-unnamed-destination", &destination()).await;
    assert!(
        !page(f, &destination(), &unrelated)
            .await
            .items
            .iter()
            .any(|v| v.record.id == source.id)
    );
    assert!(
        !page(f, &other_client(), &other)
            .await
            .items
            .iter()
            .any(|v| v.record.id == source.id)
    );
    let bad = KnowledgeCommand {
        key: "cross-client-reuse".into(),
        expected_revision: page(f, &scope(), &origin).await.revision,
        action: KnowledgeAction::Reuse {
            target: reference(&source),
            destination_engagement_id: other_client().engagement_id,
            destination_task_id: other.task_id,
            reason: "Cross-client disclosure is not permitted".into(),
        },
    };
    assert!(matches!(
        f.knowledge
            .mutate("actor-a", &scope(), &origin.task_id, &bad)
            .await,
        Err(KnowledgeError::Denied | KnowledgeError::Invalid | KnowledgeError::Ineligible)
    ));
    let operation_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM public.permission_versions WHERE accepted_snapshot IS NOT NULL",
    )
    .fetch_one(&mut *admin)
    .await
    .unwrap();
    assert_eq!(
        operation_count, 0,
        "internal knowledge retrieval needs no external operation acceptance"
    );

    let committed_events: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM public.knowledge_events WHERE organisation_id='org-a'",
    )
    .fetch_one(&mut *admin)
    .await
    .unwrap();
    for actor in ["actor-a", "actor-manager"] {
        sqlx::query("UPDATE public.engagement_assignments SET active=false WHERE actor_id=$1 AND engagement_id='engagement-support'").bind(actor).execute(&mut *admin).await.unwrap();
        if actor == "actor-a" {
            let recovered = f
                .knowledge
                .mutate("actor-a", &scope(), &origin.task_id, &source_command)
                .await
                .unwrap();
            assert_eq!(recovered.event_id, source_receipt.event_id);
            assert_eq!(recovered.revision, source_receipt.revision);
            assert!(
                recovered.record.is_none(),
                "accepted receipt identity survives source-only revocation without disclosing the dependent record"
            );
            let event_count: i64 = sqlx::query_scalar(
                "SELECT count(*) FROM public.knowledge_events WHERE organisation_id='org-a'",
            )
            .fetch_one(&mut *admin)
            .await
            .unwrap();
            assert_eq!(event_count, committed_events);
            assert!(
                !page(f, &scope(), &origin)
                    .await
                    .items
                    .iter()
                    .any(|item| item.record.id == source.id),
                "the original Task remains authorized while its supporting source is withheld"
            );
        }
        let filtered = f
            .manager
            .inspect(
                "actor-manager",
                &destination(),
                &later.task_id,
                &KnowledgeQuery {
                    text: Some("Only this exact later".into()),
                    ..KnowledgeQuery::default()
                },
            )
            .await
            .unwrap();
        assert!(
            filtered.items.is_empty(),
            "each human and accountable actor must retain every supporting source ACL before query results disclose text or provenance"
        );
        assert!(
            !serde_json::to_string(&filtered)
                .unwrap()
                .contains(&evidence.reservation.id)
        );
        sqlx::query("UPDATE public.engagement_assignments SET active=true WHERE actor_id=$1 AND engagement_id='engagement-support'").bind(actor).execute(&mut *admin).await.unwrap();
        if actor == "actor-a" {
            assert_eq!(
                f.knowledge
                    .mutate("actor-a", &scope(), &origin.task_id, &source_command)
                    .await
                    .unwrap(),
                source_receipt,
                "restoring source authority recovers the original receipt with its current record"
            );
            let event_count: i64 = sqlx::query_scalar(
                "SELECT count(*) FROM public.knowledge_events WHERE organisation_id='org-a'",
            )
            .fetch_one(&mut *admin)
            .await
            .unwrap();
            assert_eq!(event_count, committed_events);
        }
    }

    // The collaborator remains authorised at both ends. The Task's actor does not.
    admin.execute("UPDATE public.engagement_assignments SET active=false WHERE actor_id='actor-a' AND engagement_id='engagement-a'").await.unwrap();
    assert_eq!(
        f.knowledge
            .mutate("actor-a", &scope(), &origin.task_id, &source_command)
            .await,
        Err(KnowledgeError::Denied),
        "stable receipt recovery never bypasses the original Task and session scope"
    );
    let visible = f
        .manager
        .inspect(
            "actor-manager",
            &destination(),
            &later.task_id,
            &KnowledgeQuery::default(),
        )
        .await
        .unwrap();
    assert!(
        !visible.items.iter().any(|v| v.record.id == source.id),
        "collaborator cannot lend origin access to accountable actor"
    );
    assert_eq!(
        f.manager
            .exact(
                "actor-manager",
                &destination(),
                &later.task_id,
                &source.id,
                source.revision
            )
            .await,
        Err(KnowledgeError::Denied)
    );
    admin.execute("UPDATE public.engagement_assignments SET active=true WHERE actor_id='actor-a' AND engagement_id='engagement-a'").await.unwrap();
    assert!(
        page(f, &destination(), &later)
            .await
            .items
            .iter()
            .any(|v| v.record.id == source.id)
    );

    admin.execute("UPDATE public.engagement_assignments SET active=false WHERE actor_id='actor-manager' AND engagement_id='engagement-a'").await.unwrap();
    let visible = f
        .manager
        .inspect(
            "actor-manager",
            &destination(),
            &later.task_id,
            &KnowledgeQuery::default(),
        )
        .await
        .unwrap();
    assert!(
        !visible.items.iter().any(|v| v.record.id == source.id),
        "viewer also needs their own source authority"
    );
    admin.execute("UPDATE public.engagement_assignments SET active=true WHERE actor_id='actor-manager' AND engagement_id='engagement-a'").await.unwrap();
    command(
        f,
        &origin,
        "forget-reused",
        KnowledgeAction::Forget {
            target: reference(&source),
            reason: "Withdraw this claim from future context".into(),
        },
    )
    .await;
    assert!(
        !page(f, &destination(), &later)
            .await
            .items
            .iter()
            .any(|v| v.record.id == source.id)
    );
    assert_eq!(
        f.knowledge
            .exact(
                "actor-a",
                &scope(),
                &origin.task_id,
                &source.id,
                source.revision
            )
            .await
            .unwrap()
            .status,
        RecordStatus::Forgotten
    );
}

async fn preferences_learn_release_and_consume_undo(f: &Fixture, admin: &mut PgConnection) {
    let initial = f.knowledge.preference("actor-a", "org-a").await.unwrap();
    assert!(initial.current.is_none());
    let first = ObserveLayout {
        key: "expand-observation-1".into(),
        expected_revision: initial.revision,
        opening_id: "inspection-opening-1".into(),
        value: InspectionLayout::Expanded,
    };
    let one = f
        .knowledge
        .observe_layout("actor-a", "org-a", &first)
        .await
        .unwrap();
    assert!(one.current.is_none(), "one click is not repeated behavior");
    let second = ObserveLayout {
        key: "expand-observation-2".into(),
        expected_revision: one.revision,
        opening_id: "inspection-opening-2".into(),
        value: InspectionLayout::Expanded,
    };
    let learned = f
        .knowledge
        .observe_layout("actor-a", "org-a", &second)
        .await
        .unwrap();
    let preference = learned
        .current
        .as_ref()
        .expect("repeated explicit display choices learn the allowed preference");
    assert_eq!(preference.record.certainty, Certainty::Learned);
    assert_eq!(
        preference.record.scope,
        KnowledgeScope::personal("org-a", "actor-a")
    );
    let basis = preference.record.preference.as_ref().unwrap();
    assert_eq!(basis.name, "task_inspection_layout");
    assert!(basis.inferred);
    assert_eq!(basis.value, InspectionLayout::Expanded);
    assert_eq!(basis.observation_ids.len(), 2);
    assert!(basis.rule.as_ref().is_some_and(|r| !r.is_empty()));
    assert!(
        f.manager
            .preference("actor-manager", "org-a")
            .await
            .unwrap()
            .current
            .is_none(),
        "learning remains owner-private"
    );
    let published = f
        .knowledge
        .mutate_preference(
            "actor-a",
            "org-a",
            &PreferenceCommand {
                key: "publish-layout".into(),
                expected_revision: learned.revision,
                action: PreferenceAction::Publish {
                    target: reference(&preference.record),
                    client_id: "client-a".into(),
                    engagement_id: "engagement-later".into(),
                },
            },
        )
        .await
        .unwrap();
    assert!(!published.affected_destinations.is_empty());
    let task = f
        .manager_tasks
        .admit(
            "actor-manager",
            &destination(),
            &TaskCommand {
                key: "recipient-layout-task".into(),
                kind: CommandKind::Create,
                task_id: None,
                cycle_id: None,
                content: Some("Inspect explicitly released presentation setting".into()),
                context: None,
            },
        )
        .await
        .unwrap();
    let destination_page = f
        .manager
        .inspect(
            "actor-manager",
            &destination(),
            &task.task_id,
            &KnowledgeQuery::default(),
        )
        .await
        .unwrap();
    let released = destination_page
        .items
        .iter()
        .find(|v| v.record.kind == KnowledgeKind::PublishedPreference)
        .expect("authorized recipient can read the exact typed release");
    assert_eq!(
        released.record.preference.as_ref().unwrap().value,
        InspectionLayout::Expanded
    );
    assert!(
        released
            .record
            .preference
            .as_ref()
            .unwrap()
            .observation_ids
            .is_empty(),
        "private click provenance is not released"
    );
    assert!(
        released.record.dependencies.is_empty(),
        "recipient does not need or receive private-origin ACL dependencies"
    );
    let current = f.knowledge.preference("actor-a", "org-a").await.unwrap();
    let stale_observation = ObserveLayout {
        key: "observation-emitted-before-undo".into(),
        expected_revision: current.revision,
        opening_id: "old-opening-before-undo".into(),
        value: InspectionLayout::Expanded,
    };
    let undo = PreferenceCommand {
        key: "undo-learned-layout".into(),
        expected_revision: current.revision,
        action: PreferenceAction::Undo {
            target: reference(&preference.record),
        },
    };
    let undone = f
        .knowledge
        .mutate_preference("actor-a", "org-a", &undo)
        .await
        .unwrap();
    assert_eq!(
        f.knowledge
            .mutate_preference("actor-a", "org-a", &undo)
            .await
            .unwrap(),
        undone
    );
    let after = f.knowledge.preference("actor-a", "org-a").await.unwrap();
    assert!(after.current.is_none());
    assert!(after.consumed_through >= 2);
    assert_eq!(
        f.knowledge
            .observe_layout("actor-a", "org-a", &stale_observation)
            .await,
        Err(KnowledgeError::Conflict),
        "an observation emitted on the old preference basis cannot arrive after Undo and recreate it"
    );
    for old in [&first, &second] {
        assert!(
            f.knowledge
                .observe_layout("actor-a", "org-a", old)
                .await
                .unwrap()
                .current
                .is_none(),
            "past observations cannot immediately recreate an undone preference"
        );
    }
    assert!(
        !f.manager
            .inspect(
                "actor-manager",
                &destination(),
                &task.task_id,
                &KnowledgeQuery::default()
            )
            .await
            .unwrap()
            .items
            .iter()
            .any(|v| v.record.kind == KnowledgeKind::PublishedPreference),
        "owner Undo withdraws active value releases"
    );
    let emitted_before_save = ObserveLayout {
        key: "observation-emitted-before-explicit-save".into(),
        expected_revision: after.revision,
        opening_id: "opening-before-explicit-save".into(),
        value: InspectionLayout::Standard,
    };
    let explicit = f
        .knowledge
        .mutate_preference(
            "actor-a",
            "org-a",
            &PreferenceCommand {
                key: "explicit-layout-after-undo".into(),
                expected_revision: after.revision,
                action: PreferenceAction::Save {
                    value: InspectionLayout::Expanded,
                },
            },
        )
        .await
        .unwrap()
        .record
        .unwrap()
        .record;
    assert_eq!(explicit.certainty, Certainty::ExplicitPreference);
    let after_save = f.knowledge.preference("actor-a", "org-a").await.unwrap();
    let event_count: i64 = sqlx::query_scalar("SELECT count(*) FROM public.knowledge_layout_events WHERE organisation_id='org-a' AND actor_id='actor-a'").fetch_one(&mut *admin).await.unwrap();
    assert_eq!(
        f.knowledge
            .observe_layout("actor-a", "org-a", &emitted_before_save)
            .await,
        Err(KnowledgeError::Conflict),
        "an observation emitted before an explicit Save cannot arrive afterward on the superseded preference basis"
    );
    assert_eq!(
        f.knowledge.preference("actor-a", "org-a").await.unwrap(),
        after_save,
        "late-event refusal preserves the exact saved preference and consumed horizon"
    );
    let after_refusal_count: i64 = sqlx::query_scalar("SELECT count(*) FROM public.knowledge_layout_events WHERE organisation_id='org-a' AND actor_id='actor-a'").fetch_one(&mut *admin).await.unwrap();
    assert_eq!(
        after_refusal_count, event_count,
        "late-event refusal does not append an observation"
    );
    for index in 0..2 {
        let expected_revision = f
            .knowledge
            .preference("actor-a", "org-a")
            .await
            .unwrap()
            .revision;
        let observed = f
            .knowledge
            .observe_layout(
                "actor-a",
                "org-a",
                &ObserveLayout {
                    key: format!("reduce-after-explicit-{index}"),
                    expected_revision,
                    opening_id: format!("reopened-after-explicit-{index}"),
                    value: InspectionLayout::Standard,
                },
            )
            .await
            .unwrap();
        assert_eq!(
            observed.current.unwrap().record,
            explicit,
            "learning never repeatedly overrides an explicit owner choice"
        );
    }
}

async fn period_and_keyset_exact_lookup(f: &Fixture) {
    let unknown = f.task("unknown-period-task", &scope()).await;
    let source = command(
        f,
        &unknown,
        "period-limited",
        KnowledgeAction::Assert {
            assertion: Assertion {
                text: "Period limited fact for 2026".into(),
                period: Period {
                    start: Some("2026-01-01".into()),
                    end: Some("2026-12-31".into()),
                },
                uncertainty: None,
                dependencies: vec![],
            },
        },
    )
    .await
    .record
    .unwrap()
    .record;
    let unavailable = page(f, &scope(), &unknown).await;
    assert!(!unavailable.items.iter().any(|v| v.record.id == source.id));
    assert!(unavailable.omissions.contains(&Omission::UnknownPeriod));
    let known = f
        .tasks
        .admit(
            "actor-a",
            &scope(),
            &TaskCommand {
                key: "known-period-task".into(),
                kind: CommandKind::Create,
                task_id: None,
                cycle_id: None,
                content: Some("Work in the exact 2026 business period".into()),
                context: Some(zobba_domain::methodology::TaskContext {
                    audit_area: None,
                    period_start: Some("2026-01-01".into()),
                    period_end: Some("2026-12-31".into()),
                }),
            },
        )
        .await
        .unwrap();
    assert!(
        page(f, &scope(), &known)
            .await
            .items
            .iter()
            .any(|v| v.record.id == source.id)
    );
    let mut period_guide = Fixture::guide(
        "period-specific-guide",
        &unknown,
        "This direction applies to the explicitly named 2026 business period",
    );
    period_guide.context = Some(zobba_domain::methodology::TaskContext {
        audit_area: None,
        period_start: Some("2026-01-01".into()),
        period_end: Some("2026-12-31".into()),
    });
    let period_guide_receipt = f
        .tasks
        .admit("actor-a", &scope(), &period_guide)
        .await
        .unwrap();
    let known_context = page(f, &scope(), &known).await;
    let direction = known_context
        .items
        .iter()
        .find(|item| {
            item.record
                .direction
                .as_ref()
                .is_some_and(|basis| basis.command_id == period_guide_receipt.command_id)
        })
        .expect("Guide preserves its own explicitly accepted business period");
    assert_eq!(
        direction.record.period,
        Period {
            start: Some("2026-01-01".into()),
            end: Some("2026-12-31".into())
        }
    );
    assert_eq!(
        direction.record.direction.as_ref().unwrap().task_id,
        unknown.task_id
    );
    let outside = f
        .tasks
        .admit(
            "actor-a",
            &scope(),
            &TaskCommand {
                key: "outside-period-task".into(),
                kind: CommandKind::Create,
                task_id: None,
                cycle_id: None,
                content: Some("Work in a later business period".into()),
                context: Some(zobba_domain::methodology::TaskContext {
                    audit_area: None,
                    period_start: Some("2027-01-01".into()),
                    period_end: Some("2027-12-31".into()),
                }),
            },
        )
        .await
        .unwrap();
    let outside_page = page(f, &scope(), &outside).await;
    assert!(!outside_page.items.iter().any(|v| v.record.id == source.id));
    assert!(outside_page.omissions.contains(&Omission::OutsidePeriod));
    let mut ids = Vec::new();
    for index in 0..55 {
        ids.push(
            asserted(
                f,
                &known,
                &format!("page-assert-{index:02}"),
                &format!("Pagination sentinel {index:02}"),
                vec![],
            )
            .await,
        );
    }
    let query = KnowledgeQuery {
        text: Some("Pagination sentinel".into()),
        ..KnowledgeQuery::default()
    };
    let first = f
        .knowledge
        .inspect("actor-a", &scope(), &known.task_id, &query)
        .await
        .unwrap();
    assert_eq!(first.items.len(), KNOWLEDGE_PAGE_SIZE);
    assert!(first.omissions.contains(&Omission::BoundedPage));
    assert!(serde_json::to_vec(&first).unwrap().len() < MAX_KNOWLEDGE_BYTES);
    let cursor = first.next_after.clone().unwrap();
    assert!(
        first
            .items
            .windows(2)
            .all(|pair| pair[0].record.id.as_bytes() < pair[1].record.id.as_bytes())
    );
    let second = f
        .knowledge
        .inspect(
            "actor-a",
            &scope(),
            &known.task_id,
            &KnowledgeQuery {
                after: Some(cursor.clone()),
                ..query.clone()
            },
        )
        .await
        .unwrap();
    assert_eq!(second.items.len(), 5);
    assert!(second.next_after.is_none());
    assert!(
        second
            .items
            .iter()
            .all(|v| v.record.id.as_bytes() > cursor.as_bytes())
    );
    let exact = &second.items.last().unwrap().record;
    assert_eq!(
        f.knowledge
            .exact(
                "actor-a",
                &scope(),
                &known.task_id,
                &exact.id,
                exact.revision
            )
            .await
            .unwrap()
            .record,
        *exact,
        "exact retrieval remains available beyond the first page"
    );
    let traversed: std::collections::BTreeSet<_> = first
        .items
        .iter()
        .chain(&second.items)
        .map(|v| &v.record.id)
        .collect();
    assert_eq!(traversed, ids.iter().map(|r| &r.id).collect());
}

async fn reuse_qualifies_both_exact_task_consumers(f: &Fixture, admin: &mut PgConnection) {
    let auditor_task = f.task("consumer-pair-auditor", &scope()).await;
    let manager_task = f
        .manager_tasks
        .admit(
            "actor-manager",
            &scope(),
            &TaskCommand {
                key: "consumer-pair-manager".into(),
                kind: CommandKind::Create,
                task_id: None,
                cycle_id: None,
                content: Some("Keep each Task's accountable actor distinct".into()),
                context: None,
            },
        )
        .await
        .unwrap();
    assert_ne!(auditor_task.task_id, manager_task.task_id);
    let original = f
        .acquire_at(
            &supporting_scope(),
            "consumer-pair-source",
            "consumer-pair.txt",
            b"Both independent accountable actors need this original source",
        )
        .await;
    let support = Dependency::Evidence {
        evidence_id: original.reservation.id,
        storage_version: original.version,
        digest: original.reservation.request.identity.sha256,
        scope: KnowledgeScope::engagement(&supporting_scope()),
    };
    let mut source_orders = Vec::new();
    for (label, actor, repository, source, destination, destination_actor) in [
        (
            "auditor-source",
            "actor-a",
            &f.knowledge,
            &auditor_task,
            &manager_task,
            "actor-manager",
        ),
        (
            "manager-source",
            "actor-manager",
            &f.manager,
            &manager_task,
            &auditor_task,
            "actor-a",
        ),
    ] {
        source_orders.push(source.task_id.as_bytes() < destination.task_id.as_bytes());
        let current = repository
            .inspect(actor, &scope(), &source.task_id, &KnowledgeQuery::default())
            .await
            .unwrap();
        let accepted = repository
            .mutate(
                actor,
                &scope(),
                &source.task_id,
                &KnowledgeCommand {
                    key: format!("consumer-{label}-assert"),
                    expected_revision: current.revision,
                    action: KnowledgeAction::Assert {
                        assertion: assertion(
                            "Exact source and destination consumers share this supported context",
                            vec![support.clone()],
                        ),
                    },
                },
            )
            .await
            .unwrap();
        let record = accepted.record.unwrap().record;
        let reuse = KnowledgeCommand {
            key: format!("consumer-{label}-reuse"),
            expected_revision: accepted.revision,
            action: KnowledgeAction::Reuse {
                target: reference(&record),
                destination_engagement_id: scope().engagement_id,
                destination_task_id: destination.task_id.clone(),
                reason: "Both exact Task consumers qualify independently".into(),
            },
        };
        sqlx::query("UPDATE public.engagement_assignments SET active=false WHERE actor_id=$1 AND engagement_id='engagement-support'").bind(destination_actor).execute(&mut *admin).await.unwrap();
        assert_eq!(
            repository
                .exact(
                    actor,
                    &scope(),
                    &source.task_id,
                    &record.id,
                    record.revision
                )
                .await
                .unwrap()
                .status,
            RecordStatus::Current,
            "the source Task and viewer retain their independent source authority"
        );
        assert_eq!(
            repository
                .mutate(actor, &scope(), &source.task_id, &reuse)
                .await,
            Err(KnowledgeError::Denied),
            "same-engagement locking must not replace the destination Task's actor with the source actor"
        );
        let refused_events: i64 =
            sqlx::query_scalar("SELECT count(*) FROM public.knowledge_events WHERE key=$1")
                .bind(&reuse.key)
                .fetch_one(&mut *admin)
                .await
                .unwrap();
        assert_eq!(refused_events, 0);
        sqlx::query("UPDATE public.engagement_assignments SET active=true WHERE actor_id=$1 AND engagement_id='engagement-support'").bind(destination_actor).execute(&mut *admin).await.unwrap();
        let received = repository
            .mutate(actor, &scope(), &source.task_id, &reuse)
            .await
            .unwrap();
        assert_eq!(received.record.as_ref().unwrap().record, record);
        sqlx::query("UPDATE public.engagement_assignments SET active=false WHERE actor_id=$1 AND engagement_id='engagement-support'").bind(destination_actor).execute(&mut *admin).await.unwrap();
        let withheld = repository
            .mutate(actor, &scope(), &source.task_id, &reuse)
            .await
            .unwrap();
        assert_eq!(withheld.event_id, received.event_id);
        assert_eq!(withheld.revision, received.revision);
        assert!(
            withheld.record.is_none(),
            "exact reuse receipt recovery rechecks the same destination consumer before disclosure"
        );
        sqlx::query("UPDATE public.engagement_assignments SET active=true WHERE actor_id=$1 AND engagement_id='engagement-support'").bind(destination_actor).execute(&mut *admin).await.unwrap();
        sqlx::query("UPDATE public.engagement_assignments SET active=false WHERE actor_id=$1 AND engagement_id='engagement-a'").bind(destination_actor).execute(&mut *admin).await.unwrap();
        assert_eq!(
            repository
                .exact(
                    actor,
                    &scope(),
                    &source.task_id,
                    &record.id,
                    record.revision
                )
                .await
                .unwrap()
                .status,
            RecordStatus::Current
        );
        assert_eq!(
            repository
                .mutate(actor, &scope(), &source.task_id, &reuse)
                .await,
            Err(KnowledgeError::Denied),
            "destination Task scope loss remains mandatory even for stable receipt identity"
        );
        sqlx::query("UPDATE public.engagement_assignments SET active=true WHERE actor_id=$1 AND engagement_id='engagement-a'").bind(destination_actor).execute(&mut *admin).await.unwrap();
        assert_eq!(
            repository
                .mutate(actor, &scope(), &source.task_id, &reuse)
                .await
                .unwrap(),
            received
        );
        let replay_events: i64 =
            sqlx::query_scalar("SELECT count(*) FROM public.knowledge_events WHERE key=$1")
                .bind(&reuse.key)
                .fetch_one(&mut *admin)
                .await
                .unwrap();
        assert_eq!(replay_events, 1);
    }
    assert!(
        source_orders.contains(&true) && source_orders.contains(&false),
        "reversing the actual Task pair covers both C-ordered locking branches"
    );

    // The human viewer and destination consumer are the manager. Only the
    // separately accountable source Task actor loses supporting-source access.
    let current = f
        .manager
        .inspect(
            "actor-manager",
            &scope(),
            &auditor_task.task_id,
            &KnowledgeQuery::default(),
        )
        .await
        .unwrap();
    let accepted = f
        .manager
        .mutate(
            "actor-manager",
            &scope(),
            &auditor_task.task_id,
            &KnowledgeCommand {
                key: "source-consumer-before-reuse".into(),
                expected_revision: current.revision,
                action: KnowledgeAction::Assert {
                    assertion: assertion(
                        "The viewer cannot lend supporting-source access to the source Task actor",
                        vec![support],
                    ),
                },
            },
        )
        .await
        .unwrap();
    let record = accepted.record.unwrap().record;
    let reuse = KnowledgeCommand {
        key: "source-consumer-reuse".into(),
        expected_revision: accepted.revision,
        action: KnowledgeAction::Reuse {
            target: reference(&record),
            destination_engagement_id: scope().engagement_id,
            destination_task_id: manager_task.task_id.clone(),
            reason: "Fresh reuse and replay require the same source consumer".into(),
        },
    };
    admin.execute("UPDATE public.engagement_assignments SET active=false WHERE actor_id='actor-a' AND engagement_id='engagement-support'").await.unwrap();
    assert_eq!(
        f.manager
            .mutate("actor-manager", &scope(), &auditor_task.task_id, &reuse)
            .await,
        Err(KnowledgeError::Denied)
    );
    let refused_events: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM public.knowledge_events WHERE key='source-consumer-reuse'",
    )
    .fetch_one(&mut *admin)
    .await
    .unwrap();
    assert_eq!(refused_events, 0);
    admin.execute("UPDATE public.engagement_assignments SET active=true WHERE actor_id='actor-a' AND engagement_id='engagement-support'").await.unwrap();
    let received = f
        .manager
        .mutate("actor-manager", &scope(), &auditor_task.task_id, &reuse)
        .await
        .unwrap();
    admin.execute("UPDATE public.engagement_assignments SET active=false WHERE actor_id='actor-a' AND engagement_id='engagement-support'").await.unwrap();
    let recovered = f
        .manager
        .mutate("actor-manager", &scope(), &auditor_task.task_id, &reuse)
        .await
        .unwrap();
    assert_eq!(recovered.event_id, received.event_id);
    assert_eq!(recovered.revision, received.revision);
    assert!(recovered.record.is_none());
    admin.execute("UPDATE public.engagement_assignments SET active=true WHERE actor_id='actor-a' AND engagement_id='engagement-support'").await.unwrap();
    assert_eq!(
        f.manager
            .mutate("actor-manager", &scope(), &auditor_task.task_id, &reuse)
            .await
            .unwrap(),
        received
    );
    let replay_events: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM public.knowledge_events WHERE key='source-consumer-reuse'",
    )
    .fetch_one(&mut *admin)
    .await
    .unwrap();
    assert_eq!(replay_events, 1);
}

async fn dependency_periods_cannot_be_laundered(f: &Fixture) {
    let mut tasks = Vec::new();
    for (label, year) in [
        ("known", Some("2026")),
        ("outside", Some("2027")),
        ("unknown", None),
        ("compatible", Some("2026")),
    ] {
        let context = year.map(|year| zobba_domain::methodology::TaskContext {
            audit_area: None,
            period_start: Some(format!("{year}-01-01")),
            period_end: Some(format!("{year}-12-31")),
        });
        tasks.push(
            f.tasks
                .admit(
                    "actor-a",
                    &scope(),
                    &TaskCommand {
                        key: format!("dependency-period-{label}"),
                        kind: CommandKind::Create,
                        task_id: None,
                        cycle_id: None,
                        content: Some(
                            "Evaluate every exact dependency against this Task period".into(),
                        ),
                        context,
                    },
                )
                .await
                .unwrap(),
        );
    }
    let known = &tasks[0];
    let outside = &tasks[1];
    let unknown = &tasks[2];
    let mut source_assertion = assertion("Known 2026 dependency basis", vec![]);
    source_assertion.period = Period {
        start: Some("2026-01-01".into()),
        end: Some("2026-12-31".into()),
    };
    let source = command(
        f,
        known,
        "dependency-period-source",
        KnowledgeAction::Assert {
            assertion: source_assertion,
        },
    )
    .await
    .record
    .unwrap()
    .record;
    let middle = asserted(
        f,
        known,
        "dependency-period-middle",
        "Period closure middle with no invented dates",
        vec![dependency(&source)],
    )
    .await;
    let tail = asserted(
        f,
        known,
        "dependency-period-tail",
        "Period closure tail with no invented dates",
        vec![dependency(&middle)],
    )
    .await;
    assert_eq!(middle.period, Period::default());
    assert_eq!(tail.period, Period::default());
    let compatible = f
        .knowledge
        .exact("actor-a", &scope(), &known.task_id, &tail.id, tail.revision)
        .await
        .unwrap();
    assert_eq!(compatible.status, RecordStatus::Current);
    assert_eq!(compatible.record, tail);
    let reused = command(
        f,
        known,
        "dependency-period-compatible-reuse",
        KnowledgeAction::Reuse {
            target: reference(&tail),
            destination_engagement_id: scope().engagement_id,
            destination_task_id: tasks[3].task_id.clone(),
            reason: "This named Task has a compatible known period".into(),
        },
    )
    .await;
    assert_eq!(reused.record.unwrap().status, RecordStatus::Current);
    let selected = page(f, &scope(), known).await;
    let verify = VerifyKnowledge {
        expected_execution_epoch: selected.execution_epoch,
        expected_methodology_binding_id: selected.methodology_binding_id,
        items: vec![VerificationItem {
            id: tail.id.clone(),
            revision: tail.revision,
            status: RecordStatus::Current,
        }],
        exact: true,
        include_inactive: false,
    };
    f.knowledge
        .verify("actor-a", &scope(), &known.task_id, &verify)
        .await
        .unwrap();
    for (label, consumer, omission, asserted_period) in [
        (
            "outside",
            outside,
            Omission::OutsidePeriod,
            Period {
                start: Some("2027-01-01".into()),
                end: Some("2027-12-31".into()),
            },
        ),
        (
            "unknown",
            unknown,
            Omission::UnknownPeriod,
            Period::default(),
        ),
    ] {
        let before = f
            .knowledge
            .inspect(
                "actor-a",
                &scope(),
                &consumer.task_id,
                &KnowledgeQuery {
                    text: Some("Period closure".into()),
                    ..KnowledgeQuery::default()
                },
            )
            .await
            .unwrap();
        assert!(
            before.items.is_empty(),
            "a new root without dates cannot launder a transitive known-period source"
        );
        assert!(before.omissions.contains(&omission));
        let retained = f
            .knowledge
            .exact(
                "actor-a",
                &scope(),
                &consumer.task_id,
                &tail.id,
                tail.revision,
            )
            .await
            .unwrap();
        assert_eq!(retained.record, tail);
        assert_eq!(retained.status, RecordStatus::Invalidated);
        assert!(
            retained
                .status_reason
                .as_deref()
                .is_some_and(|reason| reason.to_lowercase().contains("period"))
        );
        assert!(
            !retained.can_correct
                && !retained.can_exclude
                && !retained.can_forget
                && !retained.can_reuse
        );
        let mut stale = verify.clone();
        stale.expected_execution_epoch = before.execution_epoch;
        stale.expected_methodology_binding_id = before.methodology_binding_id.clone();
        assert_eq!(
            f.knowledge
                .verify("actor-a", &scope(), &consumer.task_id, &stale)
                .await,
            Err(KnowledgeError::Conflict)
        );
        stale.items[0].status = RecordStatus::Invalidated;
        f.knowledge
            .verify("actor-a", &scope(), &consumer.task_id, &stale)
            .await
            .unwrap();
        for include_inactive in [false, true] {
            let withheld = f
                .knowledge
                .inspect(
                    "actor-a",
                    &scope(),
                    &consumer.task_id,
                    &KnowledgeQuery {
                        text: Some("Period closure".into()),
                        include_inactive,
                        ..KnowledgeQuery::default()
                    },
                )
                .await
                .unwrap();
            assert!(withheld.items.is_empty());
            assert!(withheld.omissions.contains(&omission));
        }
        let mut candidate = assertion(
            "A differently dated root cannot make old support current",
            vec![dependency(&tail)],
        );
        candidate.period = asserted_period;
        assert_eq!(
            f.knowledge
                .mutate(
                    "actor-a",
                    &scope(),
                    &consumer.task_id,
                    &KnowledgeCommand {
                        key: format!("period-launder-{label}"),
                        expected_revision: before.revision,
                        action: KnowledgeAction::Assert {
                            assertion: candidate
                        },
                    }
                )
                .await,
            Err(KnowledgeError::Ineligible)
        );
        assert_eq!(
            f.knowledge
                .mutate(
                    "actor-a",
                    &scope(),
                    &known.task_id,
                    &KnowledgeCommand {
                        key: format!("period-reuse-{label}"),
                        expected_revision: before.revision,
                        action: KnowledgeAction::Reuse {
                            target: reference(&tail),
                            destination_engagement_id: scope().engagement_id,
                            destination_task_id: consumer.task_id.clone(),
                            reason: "Applicability is checked before admitting reuse".into()
                        },
                    }
                )
                .await,
            Err(KnowledgeError::Ineligible)
        );
        assert_eq!(
            page(f, &scope(), consumer).await.revision,
            before.revision,
            "refused use cannot append a receipt"
        );
    }
    let future_source = command(
        f,
        outside,
        "dependency-period-future-source",
        KnowledgeAction::Assert {
            assertion: Assertion {
                text: "A separate source limited to 2027".into(),
                period: Period {
                    start: Some("2027-01-01".into()),
                    end: Some("2027-12-31".into()),
                },
                uncertainty: None,
                dependencies: vec![],
            },
        },
    )
    .await;
    let future_source_record = future_source.record.unwrap().record;
    assert_eq!(
        f.knowledge
            .mutate(
                "actor-a",
                &scope(),
                &known.task_id,
                &KnowledgeCommand {
                    key: "period-correction-incompatible-source".into(),
                    expected_revision: future_source.revision,
                    action: KnowledgeAction::Correct {
                        target: reference(&middle),
                        assertion: assertion(
                            "Changing a claim cannot change its supporting source period",
                            vec![dependency(&future_source_record)]
                        ),
                        reason: "A 2027 dependency cannot support this 2026 Task".into()
                    },
                }
            )
            .await,
        Err(KnowledgeError::Ineligible)
    );
    assert_eq!(
        f.knowledge
            .exact(
                "actor-a",
                &scope(),
                &known.task_id,
                &middle.id,
                middle.revision
            )
            .await
            .unwrap()
            .record,
        middle
    );
    let unknown_source = asserted(
        f,
        unknown,
        "unknown-source-period",
        "This source honestly has no recorded business period",
        vec![],
    )
    .await;
    let unknown_supported = asserted(
        f,
        unknown,
        "unknown-supported-period",
        "Unknown dates stay visibly unknown",
        vec![dependency(&unknown_source)],
    )
    .await;
    assert_eq!(unknown_supported.period, Period::default());
    let inspected = f
        .knowledge
        .inspect(
            "actor-a",
            &scope(),
            &unknown.task_id,
            &KnowledgeQuery {
                text: Some("Unknown dates stay visibly unknown".into()),
                ..KnowledgeQuery::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(inspected.items.len(), 1);
    assert_eq!(inspected.items[0].status, RecordStatus::Current);
    assert!(inspected.omissions.contains(&Omission::UnknownPeriod));
}

async fn oversized_envelope_refuses_before_writes_and_keeps_controls(
    f: &Fixture,
    admin: &mut PgConnection,
) {
    let task = f.task("bounded-envelope-task", &scope()).await;
    let before = page(f, &scope(), &task).await;
    // These syntactically valid references are deliberately never resolved:
    // an over-budget envelope must refuse before any source lookup or write.
    let dependency = Dependency::Evidence {
        evidence_id: "e".repeat(128),
        storage_version: "v".repeat(512),
        digest: "a".repeat(64),
        scope: KnowledgeScope::engagement(&Scope {
            organisation_id: "o".repeat(128),
            client_id: "c".repeat(128),
            engagement_id: "g".repeat(128),
        }),
    };
    let oversized = KnowledgeCommand {
        key: "over-budget-command".into(),
        expected_revision: before.revision,
        action: KnowledgeAction::Assert {
            assertion: Assertion {
                text: "🧾".repeat(MAX_EXCERPT_BYTES / 4),
                period: Period::default(),
                uncertainty: Some("🧾".repeat(2000)),
                dependencies: (0..MAX_DEPENDENCIES)
                    .map(|index| {
                        let mut dependency = dependency.clone();
                        if let Dependency::Evidence { evidence_id, .. } = &mut dependency {
                            *evidence_id = format!("{index:03}{}", "e".repeat(125));
                        }
                        dependency
                    })
                    .collect(),
            },
        },
    };
    assert!(
        oversized.is_valid(),
        "individual field limits are valid; combined envelope is the limiting boundary"
    );
    assert!(serde_json::to_vec(&oversized).unwrap().len() > 60_000);
    assert_eq!(
        f.knowledge
            .mutate("actor-a", &scope(), &task.task_id, &oversized)
            .await,
        Err(KnowledgeError::Capacity)
    );
    let stored: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM public.knowledge_events WHERE key='over-budget-command'",
    )
    .fetch_one(&mut *admin)
    .await
    .unwrap();
    assert_eq!(stored, 0);
    assert_eq!(page(f, &scope(), &task).await.revision, before.revision);
    knowledge_correction_controls_after_refusal(f, &task).await;
    let guidance = Fixture::guide(
        "guide-after-capacity-refusal",
        &task,
        "Ordinary Guide remains available after derived context capacity refuses",
    );
    let original = f.tasks.admit("actor-a", &scope(), &guidance).await.unwrap();
    for (key, kind) in [
        ("pause-after-capacity-refusal", CommandKind::Pause),
        ("stop-after-capacity-refusal", CommandKind::Stop),
    ] {
        f.tasks
            .admit(
                "actor-a",
                &scope(),
                &TaskCommand {
                    key: key.into(),
                    kind,
                    task_id: Some(task.task_id.clone()),
                    cycle_id: Some(task.cycle_id.clone()),
                    content: None,
                    context: None,
                },
            )
            .await
            .unwrap();
    }
    assert_eq!(
        f.tasks.admit("actor-a", &scope(), &guidance).await.unwrap(),
        original,
        "receipt recovery and reserved control capacity remain independent of derivative admission"
    );
}

async fn knowledge_correction_controls_after_refusal(f: &Fixture, task: &CommandReceipt) {
    let evidence = f
        .evidence
        .list("actor-a", &scope(), None)
        .await
        .unwrap()
        .items
        .into_iter()
        .find(|original| original.reservation.request.key == "automatic-original")
        .expect("the previously acquired original remains registered at refusal");
    let (before_evidence, before_bytes) = evidence::read_original(
        &f.evidence,
        &f.objects,
        "actor-a",
        &scope(),
        &evidence.reservation.id,
    )
    .await
    .unwrap();
    let guide_task = f.task("producer-task", &scope()).await;
    let guide = Fixture::guide(
        "accepted-direction",
        &guide_task,
        "Keep this decision attributable to the original Task and cycle.",
    );
    let before_guide = f.tasks.admit("actor-a", &scope(), &guide).await.unwrap();

    let original = asserted(
        f,
        task,
        "assert-after-capacity-refusal",
        "Capacity control proof original",
        vec![],
    )
    .await;
    let corrected = command(
        f,
        task,
        "correct-after-capacity-refusal",
        KnowledgeAction::Correct {
            target: reference(&original),
            assertion: assertion("Capacity control proof corrected", vec![]),
            reason: "Small supported corrections remain available after aggregate refusal".into(),
        },
    )
    .await
    .record
    .unwrap()
    .record;
    assert_eq!(corrected.supersedes, Some(reference(&original)));
    command(
        f,
        task,
        "exclude-after-capacity-refusal",
        KnowledgeAction::Exclude {
            target: reference(&corrected),
            reason: "Exclude the corrected candidate from future context".into(),
        },
    )
    .await;
    let forgotten = asserted(
        f,
        task,
        "forget-candidate-after-capacity-refusal",
        "Capacity control proof forgotten",
        vec![],
    )
    .await;
    command(
        f,
        task,
        "forget-after-capacity-refusal",
        KnowledgeAction::Forget {
            target: reference(&forgotten),
            reason: "Forget this current candidate without removing its immutable history".into(),
        },
    )
    .await;
    for (record, expected_status) in [
        (&original, RecordStatus::Corrected),
        (&corrected, RecordStatus::Excluded),
        (&forgotten, RecordStatus::Forgotten),
    ] {
        let retained = f
            .knowledge
            .exact(
                "actor-a",
                &scope(),
                &task.task_id,
                &record.id,
                record.revision,
            )
            .await
            .unwrap();
        assert_eq!(
            retained.record, *record,
            "capacity-safe correction and restriction preserve exact immutable revisions"
        );
        assert_eq!(retained.status, expected_status);
    }
    let current = f
        .knowledge
        .inspect(
            "actor-a",
            &scope(),
            &task.task_id,
            &KnowledgeQuery {
                text: Some("Capacity control proof".into()),
                ..KnowledgeQuery::default()
            },
        )
        .await
        .unwrap();
    assert!(
        current.items.is_empty(),
        "excluded and forgotten candidates are absent from future context"
    );
    let recovered = evidence::acquire(
        &f.evidence,
        &f.objects,
        "actor-a",
        &scope(),
        &evidence.reservation.id,
        before_bytes.clone(),
    )
    .await
    .unwrap();
    assert_eq!(recovered, before_evidence);
    assert_eq!(
        evidence::read_original(
            &f.evidence,
            &f.objects,
            "actor-a",
            &scope(),
            &evidence.reservation.id
        )
        .await
        .unwrap(),
        (before_evidence, before_bytes)
    );
    assert_eq!(
        f.tasks.admit("actor-a", &scope(), &guide).await.unwrap(),
        before_guide,
        "original Guide receipt recovery remains unchanged after correction and restriction"
    );
}

async fn publication_capacity_preserves_replay_withdrawal_and_undo(f: &Fixture) {
    let initial = f
        .manager
        .preference("actor-manager", "org-a")
        .await
        .unwrap();
    assert!(initial.current.is_none() && initial.publications.is_empty());
    let saved = f
        .manager
        .mutate_preference(
            "actor-manager",
            "org-a",
            &PreferenceCommand {
                key: "publication-ceiling-save".into(),
                expected_revision: initial.revision,
                action: PreferenceAction::Save {
                    value: InspectionLayout::Standard,
                },
            },
        )
        .await
        .unwrap();
    let preference = saved.record.unwrap().record;
    let mut first = None;
    for index in 0..50 {
        let current = f
            .manager
            .preference("actor-manager", "org-a")
            .await
            .unwrap();
        let command = PreferenceCommand {
            key: format!("publication-ceiling-{index:02}"),
            expected_revision: current.revision,
            action: PreferenceAction::Publish {
                target: reference(&preference),
                client_id: "client-a".into(),
                engagement_id: "engagement-later".into(),
            },
        };
        let receipt = f
            .manager
            .mutate_preference("actor-manager", "org-a", &command)
            .await
            .unwrap();
        if index == 0 {
            first = Some((command, receipt));
        }
    }
    let full = f
        .manager
        .preference("actor-manager", "org-a")
        .await
        .unwrap();
    assert_eq!(full.publications.len(), 50);
    assert!(
        full.publications
            .iter()
            .all(|publication| publication.status == RecordStatus::Current)
    );
    let refused = PreferenceCommand {
        key: "publication-ceiling-51".into(),
        expected_revision: full.revision,
        action: PreferenceAction::Publish {
            target: reference(&preference),
            client_id: "client-a".into(),
            engagement_id: "engagement-later".into(),
        },
    };
    assert_eq!(
        f.manager
            .mutate_preference("actor-manager", "org-a", &refused)
            .await,
        Err(KnowledgeError::Capacity)
    );
    assert_eq!(
        f.manager
            .preference("actor-manager", "org-a")
            .await
            .unwrap(),
        full,
        "the fifty-first publication refusal preserves current state and revision"
    );
    let (original_command, original_receipt) = first.unwrap();
    let replay = f
        .manager
        .mutate_preference("actor-manager", "org-a", &original_command)
        .await
        .unwrap();
    assert_eq!(replay.event_id, original_receipt.event_id);
    assert_eq!(replay.revision, original_receipt.revision);
    assert_eq!(
        replay.record.unwrap().record,
        original_receipt.record.unwrap().record
    );
    assert_eq!(
        f.manager
            .preference("actor-manager", "org-a")
            .await
            .unwrap(),
        full,
        "exact replay at admission capacity appends no publication"
    );

    let publication_id = full.publications[0].record.id.clone();
    f.manager
        .mutate_preference(
            "actor-manager",
            "org-a",
            &PreferenceCommand {
                key: "withdraw-at-publication-capacity".into(),
                expected_revision: full.revision,
                action: PreferenceAction::Withdraw {
                    publication_id: publication_id.clone(),
                },
            },
        )
        .await
        .unwrap();
    let restricted = f
        .manager
        .preference("actor-manager", "org-a")
        .await
        .unwrap();
    assert_eq!(
        restricted.publications.len(),
        50,
        "withdrawal retains all fifty historical releases"
    );
    assert_eq!(
        restricted
            .publications
            .iter()
            .find(|publication| publication.record.id == publication_id)
            .unwrap()
            .status,
        RecordStatus::Withdrawn
    );
    let undo = PreferenceCommand {
        key: "undo-at-publication-capacity".into(),
        expected_revision: restricted.revision,
        action: PreferenceAction::Undo {
            target: reference(&preference),
        },
    };
    let undone = f
        .manager
        .mutate_preference("actor-manager", "org-a", &undo)
        .await
        .unwrap();
    assert_eq!(
        undone.affected_destinations,
        vec!["engagement-later".to_owned()],
        "Undo of fifty real releases to one engagement names that destination exactly once"
    );
    let withdrawn = f
        .manager
        .preference("actor-manager", "org-a")
        .await
        .unwrap();
    assert!(withdrawn.current.is_none());
    assert_eq!(withdrawn.publications.len(), 50);
    assert!(
        withdrawn
            .publications
            .iter()
            .all(|publication| publication.status == RecordStatus::Withdrawn)
    );
    let replay = f
        .manager
        .mutate_preference("actor-manager", "org-a", &undo)
        .await
        .unwrap();
    assert_eq!(replay.event_id, undone.event_id);
    assert_eq!(replay.revision, undone.revision);
    assert_eq!(replay.affected_destinations, undone.affected_destinations);
    assert_eq!(
        f.manager
            .preference("actor-manager", "org-a")
            .await
            .unwrap(),
        withdrawn,
        "Undo exact recovery remains available after full publication history is withdrawn"
    );
}

async fn merged_scan_budget_preserves_eligible_tail(f: &Fixture, admin: &mut PgConnection) {
    let selected_scope = Scope {
        organisation_id: "org-a".into(),
        client_id: "client-scan-budget".into(),
        engagement_id: "engagement-scan-budget".into(),
    };
    admin
        .execute(
            "INSERT INTO public.clients(organisation_id,id,name) VALUES('org-a','client-scan-budget','Bounded producer pagination fixture');
             INSERT INTO public.engagements(organisation_id,client_id,id,name) VALUES('org-a','client-scan-budget','engagement-scan-budget','Merged candidate inspection');",
        )
        .await
        .unwrap();
    // Only identity and assignment provisioning uses fixture SQL. Every record,
    // preference, publication, withdrawal and correction below uses its real port.
    for actor in [
        "actor-scan-viewer",
        "actor-scan-publisher-a",
        "actor-scan-publisher-b",
    ] {
        sqlx::query("INSERT INTO public.identities(id,issuer,subject,display_name) VALUES($1,$2,$1,'Scan contract actor')")
            .bind(actor)
            .bind(ISSUER)
            .execute(&mut *admin)
            .await
            .unwrap();
        sqlx::query("INSERT INTO public.organisation_memberships(organisation_id,actor_id,roles) VALUES('org-a',$1,ARRAY['auditor'])")
            .bind(actor)
            .execute(&mut *admin)
            .await
            .unwrap();
        sqlx::query("INSERT INTO public.engagement_assignments(organisation_id,client_id,engagement_id,actor_id) VALUES('org-a','client-scan-budget','engagement-scan-budget',$1)")
            .bind(actor)
            .execute(&mut *admin)
            .await
            .unwrap();
    }
    let viewer_token = f
        .identities
        .establish_session(ISSUER, "actor-scan-viewer", "Scan viewer", None)
        .await
        .unwrap();
    let viewer_hash = secret_hash(&viewer_token);
    let viewer = KnowledgeRepository::new(f.pool.clone()).with_session_hash(viewer_hash.clone());
    let viewer_tasks = TaskRepository::new(f.pool.clone()).with_session_hash(viewer_hash);
    let task = viewer_tasks
        .admit(
            "actor-scan-viewer",
            &selected_scope,
            &TaskCommand {
                key: "merged-scan-task".into(),
                kind: CommandKind::Create,
                task_id: None,
                cycle_id: None,
                content: Some(
                    "Inspect a bounded, ordered producer-created candidate stream".into(),
                ),
                context: None,
            },
        )
        .await
        .unwrap();

    let mut publishers = Vec::new();
    let mut publications = Vec::new();
    for actor in ["actor-scan-publisher-a", "actor-scan-publisher-b"] {
        let token = f
            .identities
            .establish_session(ISSUER, actor, "Scan publisher", None)
            .await
            .unwrap();
        let repository =
            KnowledgeRepository::new(f.pool.clone()).with_session_hash(secret_hash(&token));
        let initial = repository.preference(actor, "org-a").await.unwrap();
        assert!(initial.current.is_none() && initial.publications.is_empty());
        let saved = repository
            .mutate_preference(
                actor,
                "org-a",
                &PreferenceCommand {
                    key: "scan-layout-save".into(),
                    expected_revision: initial.revision,
                    action: PreferenceAction::Save {
                        value: InspectionLayout::Standard,
                    },
                },
            )
            .await
            .unwrap();
        let preference = saved.record.unwrap().record;
        let mut revision = saved.revision;
        let publisher_index = publishers.len();
        for index in 0..50 {
            let receipt = repository
                .mutate_preference(
                    actor,
                    "org-a",
                    &PreferenceCommand {
                        key: format!("scan-release-{index:02}"),
                        expected_revision: revision,
                        action: PreferenceAction::Publish {
                            target: reference(&preference),
                            client_id: selected_scope.client_id.clone(),
                            engagement_id: selected_scope.engagement_id.clone(),
                        },
                    },
                )
                .await
                .unwrap();
            revision = receipt.revision;
            publications.push((receipt.event_id, publisher_index));
        }
        publishers.push((actor, repository, revision));
    }
    publications.sort_by(|left, right| left.0.as_bytes().cmp(right.0.as_bytes()));
    let highest_publication = publications.last().unwrap().0.clone();
    for (publication_id, publisher_index) in publications.iter().take(99) {
        let (actor, repository, revision) = &mut publishers[*publisher_index];
        let receipt = repository
            .mutate_preference(
                actor,
                "org-a",
                &PreferenceCommand {
                    key: format!("scan-withdraw-{publication_id}"),
                    expected_revision: *revision,
                    action: PreferenceAction::Withdraw {
                        publication_id: publication_id.clone(),
                    },
                },
            )
            .await
            .unwrap();
        *revision = receipt.revision;
    }
    let publication_tail = viewer
        .inspect(
            "actor-scan-viewer",
            &selected_scope,
            &task.task_id,
            &KnowledgeQuery::default(),
        )
        .await
        .unwrap();
    assert_eq!(publication_tail.items.len(), 1);
    assert_eq!(publication_tail.items[0].record.id, highest_publication);
    assert_eq!(
        publication_tail.items[0].record.kind,
        KnowledgeKind::PublishedPreference
    );
    assert!(
        publication_tail.next_after.is_none(),
        "ninety-nine filtered publications from two owners do not hide the eligible final publication"
    );

    // Carry receipt revisions instead of inspecting an ever-growing corpus per
    // write. Choose the shape from actual server IDs; never rewrite knowledge IDs.
    // The explicit production bound prevents an accidental unbounded fixture.
    let mut revision = publication_tail.revision;
    let mut records = Vec::new();
    let mut below_publication = 0;
    for index in 0..1500 {
        let receipt = viewer
            .mutate(
                "actor-scan-viewer",
                &selected_scope,
                &task.task_id,
                &KnowledgeCommand {
                    key: format!("scan-candidate-{index:04}"),
                    expected_revision: revision,
                    action: KnowledgeAction::Assert {
                        assertion: assertion(
                            "Ordinary scan candidate without the selected text",
                            vec![],
                        ),
                    },
                },
            )
            .await
            .unwrap();
        revision = receipt.revision;
        let record = receipt.record.unwrap().record;
        if record.id.as_bytes() < highest_publication.as_bytes() {
            below_publication += 1;
        }
        records.push(record);
        if below_publication == 1100 {
            break;
        }
    }
    assert_eq!(
        below_publication, 1100,
        "the bounded producer fixture must establish its measured ordering before exercising pagination"
    );
    records.sort_by(|left, right| left.id.as_bytes().cmp(right.id.as_bytes()));
    let mut merged_ids: Vec<_> = records.iter().map(|record| record.id.clone()).collect();
    merged_ids.extend(publications.iter().map(|publication| publication.0.clone()));
    merged_ids.sort_by(|left, right| left.as_bytes().cmp(right.as_bytes()));
    let boundary = &merged_ids[1023];
    let early = records
        .iter()
        .rev()
        .find(|record| record.id.as_bytes() <= boundary.as_bytes())
        .unwrap();
    let tail = records
        .iter()
        .rev()
        .find(|record| record.id.as_bytes() < highest_publication.as_bytes())
        .unwrap();
    assert!(tail.id.as_bytes() > boundary.as_bytes());
    assert!(tail.id.as_bytes() < highest_publication.as_bytes());
    assert!(
        records
            .iter()
            .position(|record| record.id == tail.id)
            .unwrap()
            >= 1099
    );
    let mut corrected = Vec::new();
    for (label, original) in [("early", early), ("tail", tail)] {
        let receipt = viewer
            .mutate(
                "actor-scan-viewer",
                &selected_scope,
                &task.task_id,
                &KnowledgeCommand {
                    key: format!("scan-select-{label}"),
                    expected_revision: revision,
                    action: KnowledgeAction::Correct {
                        target: reference(original),
                        assertion: assertion(
                            &format!("Optional task inspection layout: Standard; {label} source assertion"),
                            vec![],
                        ),
                        reason: "Select an actual immutable ID for the merged scan contract".into(),
                    },
                },
            )
            .await
            .unwrap();
        revision = receipt.revision;
        corrected.push(receipt.record.unwrap().record);
    }
    let zero = viewer
        .inspect(
            "actor-scan-viewer",
            &selected_scope,
            &task.task_id,
            &KnowledgeQuery {
                text: Some("No candidate contains this scan-budget search phrase".into()),
                ..KnowledgeQuery::default()
            },
        )
        .await
        .unwrap();
    assert!(zero.items.is_empty());
    assert!(zero.next_after.is_none());
    assert!(zero.omissions.contains(&Omission::ScanLimit));
    let query = KnowledgeQuery {
        text: Some("Optional task inspection layout".into()),
        ..KnowledgeQuery::default()
    };
    let first = viewer
        .inspect("actor-scan-viewer", &selected_scope, &task.task_id, &query)
        .await
        .unwrap();
    assert_eq!(first.items.len(), 1);
    assert_eq!(first.items[0].record, corrected[0]);
    assert!(first.omissions.contains(&Omission::ScanLimit));
    assert_eq!(first.next_after.as_deref(), Some(corrected[0].id.as_str()));
    let second = viewer
        .inspect(
            "actor-scan-viewer",
            &selected_scope,
            &task.task_id,
            &KnowledgeQuery {
                after: first.next_after,
                ..query
            },
        )
        .await
        .unwrap();
    assert_eq!(second.items.len(), 2);
    assert_eq!(second.items[0].record, corrected[1]);
    assert_eq!(second.items[1].record.id, highest_publication);
    assert!(second.next_after.is_none());
    assert!(!second.omissions.contains(&Omission::ScanLimit));
    assert!(
        second.items[0].record.id.as_bytes() < second.items[1].record.id.as_bytes(),
        "a higher publication cursor cannot skip eligible knowledge beyond the first scan ceiling"
    );
}

async fn maximum_reason_receipts_preserve_large_records(f: &Fixture, admin: &mut PgConnection) {
    let selected_scope = other_client();
    let source_scope = Scope {
        engagement_id: "engagement-receipt-source".into(),
        ..selected_scope.clone()
    };
    admin
        .execute(
            "INSERT INTO public.engagements(organisation_id,client_id,id,name) VALUES('org-a','client-other','engagement-receipt-source','Immutable receipt capacity sources');
             INSERT INTO public.engagement_assignments(organisation_id,client_id,engagement_id,actor_id) VALUES('org-a','client-other','engagement-receipt-source','actor-a');",
        )
        .await
        .unwrap();
    let task = f.task("receipt-cap-task", &selected_scope).await;
    let guide = Fixture::guide(
        "receipt-cap-guide",
        &task,
        "Keep the original receipt and exact sources available during restrictions",
    );
    let guide_receipt = f
        .tasks
        .admit("actor-a", &selected_scope, &guide)
        .await
        .unwrap();
    let objects = Objects {
        version: Some("v".repeat(512)),
        ..Objects::default()
    };
    let mut originals = Vec::new();
    let mut dependencies = Vec::new();
    for index in 0..MAX_DEPENDENCIES {
        let bytes = format!("Immutable receipt-cap original {index:02}").into_bytes();
        let request = ReservationRequest {
            key: format!("receipt-cap-source-{index:02}"),
            filename: format!("receipt-cap-source-{index:02}.txt"),
            identity: objects.measure(&bytes),
            source: SourceAssertions::default(),
        };
        let reserved = f
            .evidence
            .reserve("actor-a", &source_scope, &request, objects.namespace())
            .await
            .unwrap();
        let original = evidence::acquire(
            &f.evidence,
            &objects,
            "actor-a",
            &source_scope,
            &reserved.reservation.id,
            bytes.clone(),
        )
        .await
        .unwrap();
        dependencies.push(Dependency::Evidence {
            evidence_id: original.reservation.id.clone(),
            storage_version: original.version.clone(),
            digest: original.reservation.request.identity.sha256.clone(),
            scope: KnowledgeScope::engagement(&source_scope),
        });
        originals.push((original, bytes));
    }
    // Size a real, legal producer payload from its actual dependencies. This
    // local value measures the shape only; it is never inserted as fixture data.
    let template = KnowledgeRecord {
        id: "r".repeat(64),
        revision: 1,
        actor_id: "actor-a".into(),
        recorded_at: 1_800_000_000,
        scope: KnowledgeScope::engagement(&selected_scope),
        kind: KnowledgeKind::Assertion,
        text: String::new(),
        period: Period::default(),
        certainty: Certainty::Asserted,
        uncertainty: None,
        dependencies: dependencies.clone(),
        source: None,
        direction: None,
        preference: None,
        supersedes: None,
    };
    let base_size = serde_json::to_vec(&template).unwrap().len();
    assert!(base_size < 58_500);
    let text = "\"".repeat((58_500 - base_size) / 2);
    assert!(text.len() <= MAX_EXCERPT_BYTES);
    let large_assertion = Assertion {
        text,
        period: Period::default(),
        uncertainty: None,
        dependencies: dependencies.clone(),
    };
    assert!(large_assertion.is_valid());
    let maximum_reason = "🧾".repeat(2000);
    assert_eq!(maximum_reason.len(), 8000);
    let mut revision = page(f, &selected_scope, &task).await.revision;
    let mut accepted = Vec::new();
    for label in ["exclude", "forget", "correct"] {
        let command = KnowledgeCommand {
            key: format!("receipt-cap-assert-{label}"),
            expected_revision: revision,
            action: KnowledgeAction::Assert {
                assertion: large_assertion.clone(),
            },
        };
        let receipt = f
            .knowledge
            .mutate("actor-a", &selected_scope, &task.task_id, &command)
            .await
            .unwrap();
        revision = receipt.revision;
        let record = &receipt.record.as_ref().unwrap().record;
        let compact_size = serde_json::to_vec(record).unwrap().len();
        assert!((58_000..60_000).contains(&compact_size));
        accepted.push((label, command, receipt));
    }
    let mut restrictions = Vec::new();
    for (label, assertion_command, assertion_receipt) in &accepted {
        let original = &assertion_receipt.record.as_ref().unwrap().record;
        let (action, expected_status) = match *label {
            "exclude" => (
                KnowledgeAction::Exclude {
                    target: reference(original),
                    reason: maximum_reason.clone(),
                },
                RecordStatus::Excluded,
            ),
            "forget" => (
                KnowledgeAction::Forget {
                    target: reference(original),
                    reason: maximum_reason.clone(),
                },
                RecordStatus::Forgotten,
            ),
            "correct" => (
                KnowledgeAction::Correct {
                    target: reference(original),
                    assertion: assertion(
                        "A compact attributable correction preserves the original supported history",
                        vec![dependencies[0].clone()],
                    ),
                    reason: maximum_reason.clone(),
                },
                RecordStatus::Corrected,
            ),
            _ => unreachable!(),
        };
        let command = KnowledgeCommand {
            key: format!("receipt-cap-{label}"),
            expected_revision: revision,
            action,
        };
        assert!(command.is_valid());
        assert!(serde_json::to_vec(&command).unwrap().len() < 60_000);
        let receipt = f
            .knowledge
            .mutate("actor-a", &selected_scope, &task.task_id, &command)
            .await
            .unwrap();
        revision = receipt.revision;
        let retained = f
            .knowledge
            .exact(
                "actor-a",
                &selected_scope,
                &task.task_id,
                &original.id,
                original.revision,
            )
            .await
            .unwrap();
        assert_eq!(retained.record, *original);
        assert_eq!(retained.status, expected_status);
        assert_eq!(
            retained.status_reason.as_deref(),
            Some(maximum_reason.as_str())
        );
        let recovered_assertion = f
            .knowledge
            .mutate("actor-a", &selected_scope, &task.task_id, assertion_command)
            .await
            .unwrap();
        assert_eq!(recovered_assertion.event_id, assertion_receipt.event_id);
        assert_eq!(recovered_assertion.revision, assertion_receipt.revision);
        assert_eq!(recovered_assertion.record.as_ref(), Some(&retained));
        let full_jsonb_size: i32 = sqlx::query_scalar("SELECT octet_length($1::jsonb::text)")
            .bind(serde_json::to_value(&recovered_assertion).unwrap())
            .fetch_one(&mut *admin)
            .await
            .unwrap();
        assert!(
            full_jsonb_size > 65_536,
            "the current record plus legal reason really exceeds the durable full-receipt constraint"
        );
        assert_eq!(
            f.knowledge
                .mutate("actor-a", &selected_scope, &task.task_id, &command)
                .await
                .unwrap(),
            receipt,
            "a compact durable receipt rehydrates its complete current response"
        );
        let mut changed = command.clone();
        match &mut changed.action {
            KnowledgeAction::Exclude { reason, .. }
            | KnowledgeAction::Forget { reason, .. }
            | KnowledgeAction::Correct { reason, .. } => {
                *reason = "A different reason cannot reuse an accepted command key".into();
            }
            _ => unreachable!(),
        }
        assert_eq!(
            f.knowledge
                .mutate("actor-a", &selected_scope, &task.task_id, &changed)
                .await,
            Err(KnowledgeError::Conflict)
        );
        for event_id in [&assertion_receipt.event_id, &receipt.event_id] {
            let stored_size: i32 = sqlx::query_scalar(
                "SELECT octet_length(receipt::text) FROM public.knowledge_events WHERE organisation_id='org-a' AND id=$1",
            )
            .bind(event_id)
            .fetch_one(&mut *admin)
            .await
            .unwrap();
            assert!(
                stored_size < 4096,
                "durable receipts keep bounded identity, not duplicate record bodies"
            );
        }
        if expected_status == RecordStatus::Corrected {
            let replacement = receipt.record.as_ref().unwrap();
            assert_eq!(replacement.status, RecordStatus::Current);
            assert_eq!(replacement.record.supersedes, Some(reference(original)));
            assert_eq!(
                f.knowledge
                    .exact(
                        "actor-a",
                        &selected_scope,
                        &task.task_id,
                        &replacement.record.id,
                        replacement.record.revision
                    )
                    .await
                    .unwrap(),
                *replacement
            );
        }
        restrictions.push((command, receipt));
    }
    let event_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM public.knowledge_events WHERE organisation_id='org-a' AND key LIKE 'receipt-cap-%'",
    )
    .fetch_one(&mut *admin)
    .await
    .unwrap();
    assert_eq!(
        event_count, 6,
        "restrictions and correction append once; every replay is read-only"
    );
    admin.execute("UPDATE public.engagement_assignments SET active=false WHERE actor_id='actor-a' AND engagement_id='engagement-receipt-source'").await.unwrap();
    let (command, accepted_restriction) = &restrictions[0];
    let withheld = f
        .knowledge
        .mutate("actor-a", &selected_scope, &task.task_id, command)
        .await
        .unwrap();
    assert_eq!(withheld.event_id, accepted_restriction.event_id);
    assert_eq!(withheld.revision, accepted_restriction.revision);
    assert!(
        withheld.record.is_none(),
        "reference receipts still reauthorize every source before rehydrating"
    );
    admin.execute("UPDATE public.engagement_assignments SET active=true WHERE actor_id='actor-a' AND engagement_id='engagement-receipt-source'").await.unwrap();
    assert_eq!(
        f.knowledge
            .mutate("actor-a", &selected_scope, &task.task_id, command)
            .await
            .unwrap(),
        *accepted_restriction
    );
    for (original, bytes) in &originals {
        assert_eq!(
            evidence::read_original(
                &f.evidence,
                &objects,
                "actor-a",
                &source_scope,
                &original.reservation.id
            )
            .await
            .unwrap(),
            (original.clone(), bytes.clone()),
            "large-record correction and restrictions cannot rewrite original bytes or metadata"
        );
    }
    let (original, bytes) = &originals[0];
    assert_eq!(
        evidence::acquire(
            &f.evidence,
            &objects,
            "actor-a",
            &source_scope,
            &original.reservation.id,
            bytes.clone()
        )
        .await
        .unwrap(),
        *original
    );
    assert_eq!(
        f.tasks
            .admit("actor-a", &selected_scope, &guide)
            .await
            .unwrap(),
        guide_receipt
    );
    let final_event_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM public.knowledge_events WHERE organisation_id='org-a' AND key LIKE 'receipt-cap-%'",
    )
    .fetch_one(&mut *admin)
    .await
    .unwrap();
    assert_eq!(final_event_count, event_count);
}

async fn queued_verification_refreshes_source_and_authority(
    f: &Fixture,
    config: &support::Configuration,
    admin: &mut PgConnection,
) {
    let task = f.task("queued-verification-task", &scope()).await;
    let original = f
        .acquire(
            "verification-predecessor",
            "verify-old.txt",
            b"Verification race source predecessor",
        )
        .await;
    let replacement = f
        .acquire(
            "verification-replacement",
            "verify-new.txt",
            b"Verification race source replacement",
        )
        .await;
    let selected = f
        .knowledge
        .inspect(
            "actor-a",
            &scope(),
            &task.task_id,
            &KnowledgeQuery {
                text: Some("Verification race source".into()),
                ..KnowledgeQuery::default()
            },
        )
        .await
        .unwrap();
    let record = selected
        .items
        .iter()
        .find(|v| {
            v.record
                .source
                .as_ref()
                .is_some_and(|source| source.evidence_id == original.reservation.id)
        })
        .unwrap()
        .record
        .clone();
    let verification = VerifyKnowledge {
        expected_execution_epoch: selected.execution_epoch,
        expected_methodology_binding_id: selected.methodology_binding_id.clone(),
        items: vec![VerificationItem {
            id: record.id.clone(),
            revision: record.revision,
            status: RecordStatus::Current,
        }],
        exact: true,
        include_inactive: false,
    };
    f.knowledge
        .verify("actor-a", &scope(), &task.task_id, &verification)
        .await
        .unwrap();
    let mut barrier = PgConnection::connect(&config.admin).await.unwrap();
    config.guard_connection(&mut barrier).await;
    barrier
        .execute("BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('org-a',205))")
        .await
        .unwrap();
    let repository = f.knowledge.clone();
    let task_id = task.task_id.clone();
    let correction = KnowledgeCommand {
        key: "verification-source-correction".into(),
        expected_revision: selected.revision,
        action: KnowledgeAction::CorrectSource {
            predecessor_id: original.reservation.id,
            replacement_id: replacement.reservation.id,
            expected_source_revision: 0,
            reason: "Commit a real source correction before queued disclosure verification".into(),
        },
    };
    let correcting = tokio::spawn(async move {
        repository
            .mutate("actor-a", &scope(), &task_id, &correction)
            .await
    });
    wait_blocked_at_least(admin, 1).await;
    let repository = f.knowledge.clone();
    let task_id = task.task_id.clone();
    let requested = verification.clone();
    let verifying = tokio::spawn(async move {
        repository
            .verify("actor-a", &scope(), &task_id, &requested)
            .await
    });
    wait_blocked_at_least(admin, 2).await;
    barrier.execute("COMMIT").await.unwrap();
    correcting.await.unwrap().unwrap();
    assert_eq!(
        verifying.await.unwrap(),
        Err(KnowledgeError::Conflict),
        "queued exact disclosure rechecks source standing after the preceding correction commits"
    );
    let mut retained = verification;
    retained.items[0].status = RecordStatus::Invalidated;
    f.knowledge
        .verify("actor-a", &scope(), &task.task_id, &retained)
        .await
        .unwrap();

    barrier
        .execute("BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('org-a',205))")
        .await
        .unwrap();
    let repository = f.knowledge.clone();
    let task_id = task.task_id.clone();
    let verifying = tokio::spawn(async move {
        repository
            .verify("actor-a", &scope(), &task_id, &retained)
            .await
    });
    wait_blocked(admin).await;
    barrier.execute("UPDATE public.engagement_assignments SET active=false WHERE actor_id='actor-a' AND engagement_id='engagement-a'; COMMIT").await.unwrap();
    assert_eq!(
        verifying.await.unwrap(),
        Err(KnowledgeError::Denied),
        "queued historical verification also rechecks current source authority before disclosing retained provenance"
    );
    admin.execute("UPDATE public.engagement_assignments SET active=true WHERE actor_id='actor-a' AND engagement_id='engagement-a'").await.unwrap();
    barrier.close().await.unwrap();
}

async fn post_io_and_session_fences(
    f: &Fixture,
    config: &support::Configuration,
    admin: &mut PgConnection,
) {
    let task = f.task("post-io-task", &scope()).await;
    let original = f
        .acquire(
            "post-io-original",
            "io.txt",
            "\u{feff}Bytes read before access changed 🧾".as_bytes(),
        )
        .await;
    let entered = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    let held = HeldRead {
        objects: f.objects.clone(),
        entered: entered.clone(),
        release: release.clone(),
    };
    let metadata = f.evidence.clone();
    let original_id = original.reservation.id.clone();
    let pending_read = tokio::spawn(async move {
        evidence::read_original(&metadata, &held, "actor-a", &scope(), &original_id).await
    });
    tokio::time::timeout(Duration::from_secs(3), entered.notified())
        .await
        .expect("read reaches immutable object I/O");
    admin.execute("UPDATE public.engagement_assignments SET active=false WHERE actor_id='actor-a' AND engagement_id='engagement-a'").await.unwrap();
    release.notify_one();
    assert_eq!(
        pending_read.await.unwrap(),
        Err(EvidenceError::Denied),
        "completed object bytes cannot cross disclosure after current source access is revoked"
    );
    admin.execute("UPDATE public.engagement_assignments SET active=true WHERE actor_id='actor-a' AND engagement_id='engagement-a'").await.unwrap();
    let (_, bytes) = evidence::read_original(
        &f.evidence,
        &f.objects,
        "actor-a",
        &scope(),
        &original.reservation.id,
    )
    .await
    .unwrap();
    let capture = CaptureExcerpt {
        key: "post-io-excerpt".into(),
        evidence_id: original.reservation.id.clone(),
        byte_start: 3,
        byte_end: 8,
    };
    let excerpt = CapturedExcerpt {
        text: String::from_utf8(bytes[3..8].to_vec()).unwrap(),
        byte_start: 3,
        byte_end: 8,
        original_size: bytes.len() as u64,
        partial: true,
    };
    admin.execute("UPDATE public.engagement_assignments SET active=false WHERE actor_id='actor-a' AND engagement_id='engagement-a'").await.unwrap();
    assert_eq!(
        f.knowledge
            .record_excerpt("actor-a", &scope(), &capture, &original, &excerpt)
            .await,
        Err(KnowledgeError::Denied),
        "bytes already read confer no current authorization at the projection write boundary"
    );
    admin.execute("UPDATE public.engagement_assignments SET active=true WHERE actor_id='actor-a' AND engagement_id='engagement-a'").await.unwrap();
    let good = f
        .knowledge
        .record_excerpt("actor-a", &scope(), &capture, &original, &excerpt)
        .await
        .unwrap();
    assert_eq!(good.record.unwrap().record.text, "Bytes");
    let mut barrier = PgConnection::connect(&config.admin).await.unwrap();
    config.guard_connection(&mut barrier).await;
    barrier
        .execute("BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('org-a',205))")
        .await
        .unwrap();
    let repository = f.knowledge.clone();
    let pending = tokio::spawn(async move {
        repository
            .inspect(
                "actor-a",
                &scope(),
                &task.task_id,
                &KnowledgeQuery::default(),
            )
            .await
    });
    wait_blocked(admin).await;
    f.identities.logout(&f.auditor_token).await.unwrap();
    barrier.execute("COMMIT").await.unwrap();
    assert_eq!(
        pending.await.unwrap(),
        Err(KnowledgeError::Denied),
        "read rechecks its exact session after waiting on the authority fence"
    );
    barrier.close().await.unwrap();
}
