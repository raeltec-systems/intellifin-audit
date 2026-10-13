//! Flow contracts with in-memory ports. The real PostgreSQL, Docker and
//! object-store paths are proven by the infrastructure integration suite.
use super::*;
use crate::evidence::MeasuredObject;
use std::{
    collections::HashMap,
    sync::Mutex,
    task::{Context, Poll, Waker},
};
use zobba_domain::permissions::{
    AttemptHistoryEntry, AuthoritySnapshot, DecisionCommand, Operation, OperationAttemptPage,
    OperationCustody, OperationDecision, OperationHistory, OperationPage, OperationState,
    PolicyDocument, PolicyReference, RevocationCommand, SourceBinding,
};

fn run<F: Future>(future: F) -> F::Output {
    let mut future = std::pin::pin!(future);
    let mut context = Context::from_waker(Waker::noop());
    loop {
        if let Poll::Ready(value) = future.as_mut().poll(&mut context) {
            return value;
        }
    }
}
fn no_delay(_: Duration) -> Pin<Box<dyn Future<Output = ()> + Send>> {
    Box::pin(async {})
}
fn digest(bytes: &[u8]) -> String {
    // Deterministic stand-in for SHA-256: the application never hashes itself.
    let mut state: [u64; 4] = [0xcbf29ce484222325, 0x84222325cbf29ce4, 7, 11];
    for (i, b) in bytes.iter().enumerate() {
        let lane = i % 4;
        state[lane] = (state[lane] ^ u64::from(*b)).wrapping_mul(0x100000001b3);
    }
    state.iter().map(|v| format!("{v:016x}")).collect()
}
fn scope() -> Scope {
    Scope {
        organisation_id: "org".into(),
        client_id: "client".into(),
        engagement_id: "engagement".into(),
    }
}
fn basis(process: &str) -> ClaimBasis {
    ClaimBasis {
        actor_id: "actor".into(),
        scope: scope(),
        task_id: "task".into(),
        cycle_id: "cycle".into(),
        claim_id: "claim".into(),
        worker_id: "worker".into(),
        process_instance: process.into(),
        owner_epoch: 1,
        execution_epoch: 1,
        intent_revision: 1,
    }
}
fn target() -> AnalysisTarget {
    AnalysisTarget {
        account_id: "analysis-account".into(),
        environment_id: "analysis-environment".into(),
        destination: "analysis-sandbox".into(),
        resource_id: "analysis-resource".into(),
        resource_version: "v1".into(),
        classification: "audit".into(),
        lifetime_seconds: 3600,
    }
}
const PROGRAM: &str = "SECRET-PROGRAM-TEXT = open('/input/orig-a').read()\n";
const INPUT: &[u8] = b"SECRET-INPUT-BYTES";
fn request() -> AnalysisRequest {
    AnalysisRequest {
        environment_id: GENERAL_ENVIRONMENT_ID.into(),
        image_digest: GENERAL_IMAGE_DIGEST.into(),
        program: PROGRAM.into(),
        program_sha256: digest(PROGRAM.as_bytes()),
        inputs: vec![AnalysisInput {
            original_id: "orig-a".into(),
            digest: digest(INPUT),
        }],
        limits: AnalysisLimits {
            wall_seconds: 2,
            ..AnalysisLimits::DEFAULT
        },
    }
}

#[derive(Default)]
struct StoreState {
    operations: HashMap<String, (String, CanonicalOperation)>,
    attempts: Vec<(String, String, String)>, // (operation, attempt, process)
    facts: HashMap<String, Vec<(OperationCustody, SourceFact)>>,
    consumed: usize,
}
#[derive(Default)]
struct Store(Mutex<StoreState>);
impl Store {
    fn facts(&self, attempt: &str) -> Vec<SourceFact> {
        self.0
            .lock()
            .unwrap()
            .facts
            .get(attempt)
            .map(|f| f.iter().map(|v| v.1).collect())
            .unwrap_or_default()
    }
    fn custody(
        &self,
        operation_id: &str,
        attempt: &str,
        custody: OperationCustody,
    ) -> ConsumedOperation {
        let state = self.0.lock().unwrap();
        let (_, request) = state.operations.get(operation_id).unwrap();
        ConsumedOperation {
            source: SourceBinding {
                source_id: "s".into(),
                ledger_id: "l".into(),
                endpoint_digest: "a".repeat(64),
                contract_version: 1,
            },
            custody,
            basis: basis("p"),
            operation_id: operation_id.into(),
            attempt_id: attempt.into(),
            claim_id: "claim".into(),
            request: request.clone(),
            request_digest: "b".repeat(64),
            receipt_capability: "c".repeat(64),
        }
    }
}
impl OperationStore for Store {
    async fn save_policy(
        &self,
        _: &str,
        _: &Scope,
        _: &PolicyDocument,
    ) -> Result<PolicyReference, OperationError> {
        unimplemented!()
    }
    async fn accept_authority(
        &self,
        _: &str,
        _: &Scope,
        _: &str,
        _: &AuthoritySnapshot,
    ) -> Result<PolicyReference, OperationError> {
        unimplemented!()
    }
    async fn admit(
        &self,
        _: &str,
        _: &Scope,
        _: &ClaimBasis,
        key: &str,
        request: &CanonicalOperation,
    ) -> Result<Operation, OperationError> {
        if !request.is_valid() || request.material_digest != digest(request.material.as_bytes()) {
            return Err(OperationError::Invalid);
        }
        let mut state = self.0.lock().unwrap();
        let id = match state.operations.iter().find(|(_, (k, _))| k == key) {
            Some((id, (_, existing)))
                if existing.material == request.material
                    && existing.attachments == request.attachments =>
            {
                id.clone()
            }
            Some(_) => return Err(OperationError::Conflict),
            None => {
                let id = format!("operation-{}", state.operations.len());
                state
                    .operations
                    .insert(id.clone(), (key.into(), request.clone()));
                id
            }
        };
        let request = state.operations[&id].1.clone();
        Ok(Operation {
            source: SourceBinding {
                source_id: "s".into(),
                ledger_id: "l".into(),
                endpoint_digest: "a".repeat(64),
                contract_version: 1,
            },
            id,
            task_id: "task".into(),
            cycle_id: "cycle".into(),
            actor_id: "actor".into(),
            execution_epoch: 1,
            methodology_binding_id: "m".into(),
            request,
            request_digest: "b".repeat(64),
            revision: 1,
            state: OperationState::Ready,
        })
    }
    async fn decide(
        &self,
        _: &str,
        _: &Scope,
        _: &DecisionCommand,
    ) -> Result<OperationDecision, OperationError> {
        unimplemented!()
    }
    async fn revoke(
        &self,
        _: &str,
        _: &Scope,
        _: &RevocationCommand,
    ) -> Result<PolicyReference, OperationError> {
        unimplemented!()
    }
    async fn get(&self, _: &str, _: &Scope, _: &str) -> Result<Operation, OperationError> {
        unimplemented!()
    }
    async fn list(
        &self,
        _: &str,
        _: &Scope,
        _: &str,
        _: Option<&str>,
    ) -> Result<OperationPage, OperationError> {
        unimplemented!()
    }
    async fn history(
        &self,
        _: &str,
        _: &Scope,
        operation_id: &str,
        _: &OperationHistoryQuery,
    ) -> Result<OperationHistory, OperationError> {
        let state = self.0.lock().unwrap();
        Ok(OperationHistory {
            operation_id: operation_id.into(),
            decisions: vec![],
            attempts: state
                .attempts
                .iter()
                .enumerate()
                .filter(|(_, a)| a.0 == operation_id)
                .map(|(n, a)| AttemptHistoryEntry {
                    id: a.1.clone(),
                    operation_id: operation_id.into(),
                    number: n as u64 + 1,
                    execution_epoch: 1,
                    methodology_binding_id: "m".into(),
                    request_digest: "b".repeat(64),
                    recorded_at: 1,
                    source_id: None,
                    ledger_id: None,
                })
                .collect(),
            observations: vec![],
            decision_next_cursor: None,
            attempt_next_cursor: None,
            observation_next_cursor: None,
        })
    }
    async fn consume(
        &self,
        b: &ClaimBasis,
        operation_id: &str,
    ) -> Result<ConsumedOperation, OperationError> {
        {
            let mut state = self.0.lock().unwrap();
            if let Some(last) = state
                .attempts
                .iter()
                .rev()
                .find(|a| a.0 == operation_id)
                .cloned()
            {
                let absent = state
                    .facts
                    .get(&last.1)
                    .is_some_and(|f| f.iter().any(|v| v.1 == SourceFact::AuthoritativelyAbsent));
                if !absent || last.2 == b.process_instance {
                    return Err(OperationError::Fenced);
                }
            }
            state.consumed += 1;
            let attempt = format!("{:064x}", state.consumed);
            state
                .attempts
                .push((operation_id.into(), attempt, b.process_instance.clone()));
        }
        let attempt = self.0.lock().unwrap().attempts.last().unwrap().1.clone();
        Ok(self.custody(operation_id, &attempt, OperationCustody::Dispatch))
    }
    async fn observe(&self, a: &ConsumedOperation, fact: SourceFact) -> Result<(), OperationError> {
        let mut state = self.0.lock().unwrap();
        let facts = state.facts.entry(a.attempt_id.clone()).or_default();
        let observed = facts.last().map_or(SourceFact::Unknown, |v| v.1);
        if a.custody == OperationCustody::Dispatch && fact == SourceFact::AuthoritativelyAbsent {
            return Err(OperationError::Invalid);
        }
        if !fact.can_follow(observed) {
            return Err(OperationError::Conflict);
        }
        facts.push((a.custody, fact));
        Ok(())
    }
    async fn unresolved(
        &self,
        _: &str,
        _: &Scope,
        _: &str,
        _: Option<&str>,
    ) -> Result<OperationAttemptPage, OperationError> {
        unimplemented!()
    }
    async fn reauthorize_recovery(
        &self,
        _: &str,
        _: &Scope,
        _: &ConsumedOperation,
    ) -> Result<(), OperationError> {
        unimplemented!()
    }
    async fn recover(
        &self,
        _: &str,
        _: &Scope,
        attempt_id: &str,
    ) -> Result<ConsumedOperation, OperationError> {
        let operation = self
            .0
            .lock()
            .unwrap()
            .attempts
            .iter()
            .find(|a| a.1 == attempt_id)
            .ok_or(OperationError::Denied)?
            .0
            .clone();
        Ok(self.custody(&operation, attempt_id, OperationCustody::ReceiptOnly))
    }
}

type StoredJob = (
    AnalysisJob,
    Vec<JobFact>,
    Vec<Descendant>,
    Vec<Rejection>,
    Option<CollectionReceipt>,
);

#[derive(Default)]
struct Jobs {
    jobs: Mutex<Vec<StoredJob>>,
    fail_next_append: Mutex<bool>,
}
impl Jobs {
    fn record_of(&self, index: usize) -> JobRecord {
        let jobs = self.jobs.lock().unwrap();
        let (job, facts, ..) = &jobs[index];
        let latest = facts.last().unwrap().clone();
        let started_at = facts
            .iter()
            .rev()
            .find(|f| f.status == JobStatus::PossiblyStarted && f.attempt_id == latest.attempt_id)
            .map(|f| f.at);
        JobRecord {
            job: job.clone(),
            latest,
            started_at,
            now: 100,
        }
    }
    fn statuses(&self) -> Vec<JobStatus> {
        self.jobs.lock().unwrap()[0]
            .1
            .iter()
            .map(|f| f.status)
            .collect()
    }
}
impl AnalysisJobs for Jobs {
    async fn original(
        &self,
        _: &str,
        _: &Scope,
        id: &str,
    ) -> Result<Option<OriginalRef>, AnalysisError> {
        Ok((id == "orig-a").then(|| OriginalRef {
            namespace: "n".repeat(64),
            version: "v1".into(),
            identity: ContentIdentity {
                sha256: digest(INPUT),
                size: INPUT.len() as u64,
            },
        }))
    }
    async fn record(
        &self,
        b: &ClaimBasis,
        operation_id: &str,
        request: &AnalysisRequest,
    ) -> Result<JobRecord, AnalysisError> {
        let position = {
            let mut jobs = self.jobs.lock().unwrap();
            match jobs.iter().position(|j| j.0.operation_id == operation_id) {
                Some(index) if jobs[index].0.request == *request => index,
                Some(_) => return Err(AnalysisError::Conflict),
                None => {
                    let id = format!("job-{}", jobs.len());
                    jobs.push((
                        AnalysisJob {
                            id,
                            scope: b.scope.clone(),
                            actor_id: b.actor_id.clone(),
                            task_id: b.task_id.clone(),
                            cycle_id: b.cycle_id.clone(),
                            operation_id: operation_id.into(),
                            request: request.clone(),
                        },
                        vec![JobFact {
                            sequence: 0,
                            status: JobStatus::Admitted,
                            attempt_id: None,
                            reason: None,
                            exit_code: None,
                            at: 1,
                        }],
                        vec![],
                        vec![],
                        None,
                    ));
                    jobs.len() - 1
                }
            }
        };
        Ok(self.record_of(position))
    }
    async fn job(&self, _: &str, _: &Scope, id: &str) -> Result<JobRecord, AnalysisError> {
        let index = self
            .jobs
            .lock()
            .unwrap()
            .iter()
            .position(|j| j.0.id == id)
            .ok_or(AnalysisError::Denied)?;
        Ok(self.record_of(index))
    }
    async fn pending(
        &self,
        _: &str,
        _: &Scope,
        task_id: &str,
    ) -> Result<Vec<JobRecord>, AnalysisError> {
        let count = self.jobs.lock().unwrap().len();
        Ok((0..count)
            .map(|i| self.record_of(i))
            .filter(|r| {
                r.job.task_id == task_id
                    && !matches!(
                        r.latest.status,
                        JobStatus::Collected | JobStatus::Stopped | JobStatus::Unknown
                    )
            })
            .collect())
    }
    async fn append(
        &self,
        _: &str,
        _: &Scope,
        job_id: &str,
        expected: u32,
        t: &Transition,
    ) -> Result<JobRecord, AnalysisError> {
        if std::mem::take(&mut *self.fail_next_append.lock().unwrap()) {
            return Err(AnalysisError::Unavailable);
        }
        let index = {
            let mut jobs = self.jobs.lock().unwrap();
            let index = jobs.iter().position(|j| j.0.id == job_id).unwrap();
            let facts = &mut jobs[index].1;
            let previous = facts.last().unwrap().clone();
            let new_attempt = t.status == JobStatus::PossiblyStarted
                || (t.status == JobStatus::Absent
                    && matches!(previous.status, JobStatus::Admitted | JobStatus::Absent));
            if previous.sequence != expected
                || !t.status.can_follow(previous.status)
                || (new_attempt && facts.iter().any(|f| f.attempt_id == t.attempt_id))
                || (!new_attempt && t.attempt_id != previous.attempt_id)
            {
                return Err(AnalysisError::Conflict);
            }
            facts.push(JobFact {
                sequence: expected + 1,
                status: t.status,
                attempt_id: t.attempt_id.clone(),
                reason: t.reason.map(Into::into),
                exit_code: t.exit_code,
                at: 10,
            });
            index
        };
        Ok(self.record_of(index))
    }
    async fn collect(
        &self,
        a: &str,
        s: &Scope,
        job_id: &str,
        expected: u32,
        attempt: &str,
        descendants: &[Descendant],
        rejections: &[Rejection],
        receipt: &CollectionReceipt,
    ) -> Result<JobRecord, AnalysisError> {
        assert!(self.job(a, s, job_id).await?.latest.status.collectable());
        let record = self
            .append(
                a,
                s,
                job_id,
                expected,
                &Transition {
                    status: JobStatus::Collected,
                    attempt_id: Some(attempt.into()),
                    reason: None,
                    exit_code: None,
                },
            )
            .await?;
        let mut jobs = self.jobs.lock().unwrap();
        let entry = jobs.iter_mut().find(|j| j.0.id == job_id).unwrap();
        entry.2 = descendants.to_vec();
        entry.3 = rejections.to_vec();
        entry.4 = Some(receipt.clone());
        Ok(record)
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Behaviour {
    Exit(i32),
    Oom,
    Forever,
    StartRefused,
    StartUncertainAbsent,
    StartUncertainUnconfirmed,
    StopNeverConfirms,
}
struct Sandbox {
    behaviour: Behaviour,
    entries: Vec<OutputEntry>,
    started: Mutex<Vec<String>>,
    polls: Mutex<u32>,
    stopped: Mutex<bool>,
    discarded: Mutex<Vec<String>>,
    seen_spec: Mutex<Option<SandboxSpec>>,
}
impl Sandbox {
    fn new(behaviour: Behaviour, entries: Vec<OutputEntry>) -> Self {
        Self {
            behaviour,
            entries,
            started: Mutex::default(),
            polls: Mutex::default(),
            stopped: Mutex::default(),
            discarded: Mutex::default(),
            seen_spec: Mutex::default(),
        }
    }
}
impl AnalysisSandbox for Sandbox {
    async fn start(&self, spec: &SandboxSpec) -> Result<(), SandboxError> {
        *self.seen_spec.lock().unwrap() = Some(spec.clone());
        match self.behaviour {
            Behaviour::StartRefused => Err(SandboxError::Refused),
            Behaviour::StartUncertainAbsent | Behaviour::StartUncertainUnconfirmed => {
                Err(SandboxError::Uncertain)
            }
            _ => {
                self.started.lock().unwrap().push(spec.handle.clone());
                Ok(())
            }
        }
    }
    async fn status(&self, handle: &str) -> Result<SandboxState, SandboxError> {
        if !self.started.lock().unwrap().iter().any(|h| h == handle) {
            return Ok(match self.behaviour {
                Behaviour::StartUncertainUnconfirmed => SandboxState::Unconfirmed,
                _ => SandboxState::Absent,
            });
        }
        let stopped = *self.stopped.lock().unwrap();
        let mut polls = self.polls.lock().unwrap();
        *polls += 1;
        Ok(match self.behaviour {
            Behaviour::StopNeverConfirms => SandboxState::Running,
            _ if stopped => SandboxState::Exited {
                exit_code: Some(137),
                out_of_memory: false,
            },
            Behaviour::Exit(code) if *polls > 2 => SandboxState::Exited {
                exit_code: Some(code),
                out_of_memory: false,
            },
            Behaviour::Oom if *polls > 2 => SandboxState::Exited {
                exit_code: Some(137),
                out_of_memory: true,
            },
            _ => SandboxState::Running,
        })
    }
    async fn stop(&self, _: &str) -> Result<(), SandboxError> {
        *self.stopped.lock().unwrap() = true;
        Ok(())
    }
    async fn collect(&self, _: &str, _: &AnalysisLimits) -> Result<Collection, SandboxError> {
        Ok(Collection {
            entries: self.entries.clone(),
            full: false,
            truncated: false,
        })
    }
    async fn discard(&self, handle: &str) -> Result<(), SandboxError> {
        self.discarded.lock().unwrap().push(handle.into());
        Ok(())
    }
}

#[derive(Default)]
struct Objects(Mutex<HashMap<String, Vec<u8>>>);
impl EvidenceObjects for Objects {
    fn namespace(&self) -> &str {
        "nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn"
    }
    fn measure(&self, bytes: &[u8]) -> ContentIdentity {
        ContentIdentity {
            sha256: digest(bytes),
            size: bytes.len() as u64,
        }
    }
    async fn put_if_absent(&self, id: &str, bytes: Vec<u8>) -> Result<String, ObjectError> {
        let mut map = self.0.lock().unwrap();
        if map.contains_key(id) {
            return Err(ObjectError::AlreadyExists);
        }
        map.insert(id.into(), bytes);
        Ok("v1".into())
    }
    async fn latest_version(&self, id: &str) -> Result<Option<String>, ObjectError> {
        Ok(self.0.lock().unwrap().contains_key(id).then(|| "v1".into()))
    }
    async fn get_version(&self, id: &str, _: &str, _: &str) -> Result<MeasuredObject, ObjectError> {
        let bytes = if id == "orig-a" {
            INPUT.to_vec()
        } else {
            self.0
                .lock()
                .unwrap()
                .get(id)
                .cloned()
                .ok_or(ObjectError::Unavailable)?
        };
        Ok(MeasuredObject {
            identity: self.measure(&bytes),
            bytes,
        })
    }
}

fn regular(path: &str, content: &[u8]) -> OutputEntry {
    OutputEntry {
        path: path.as_bytes().to_vec(),
        kind: OutputKind::Regular,
        links: 1,
        size: content.len() as u64,
        content: Some(content.to_vec()),
    }
}
struct World {
    store: Store,
    jobs: Jobs,
    sandbox: Sandbox,
    objects: Objects,
    allowlist: Vec<AnalysisEnvironment>,
}
impl World {
    fn new(behaviour: Behaviour, entries: Vec<OutputEntry>) -> Self {
        Self {
            store: Store::default(),
            jobs: Jobs::default(),
            sandbox: Sandbox::new(behaviour, entries),
            objects: Objects::default(),
            allowlist: server_allowlist(),
        }
    }
    fn analysis(&self) -> Analysis<'_, Store, Jobs, Sandbox, Objects> {
        Analysis {
            store: &self.store,
            jobs: &self.jobs,
            sandbox: &self.sandbox,
            objects: &self.objects,
            allowlist: &self.allowlist,
            settings: AnalysisSettings {
                poll: Duration::ZERO,
                stop_confirmation: Duration::from_millis(50),
                delay: no_delay,
            },
        }
    }
}

#[test]
fn happy_path_registers_measured_descendants_only_after_termination() {
    let world = World::new(
        Behaviour::Exit(0),
        vec![regular("summary.csv", b"total\n3\n")],
    );
    let analysis = world.analysis();
    let admitted = run(analysis.admit(&target(), &basis("p1"), "job-key", &request())).unwrap();
    assert_eq!(admitted.latest.status, JobStatus::Admitted);
    let operation = &world.store.0.lock().unwrap().operations[&admitted.job.operation_id]
        .1
        .clone();
    assert!(!operation.material.contains("SECRET-PROGRAM-TEXT"));
    assert_eq!(operation.attachments[0].id, "orig-a");
    let done = run(analysis.run_next(&basis("p1"), &ModelCancellation::new()))
        .unwrap()
        .unwrap();
    assert_eq!(done.latest.status, JobStatus::Collected);
    assert_eq!(
        world.jobs.statuses(),
        [
            JobStatus::Admitted,
            JobStatus::PossiblyStarted,
            JobStatus::Running,
            JobStatus::Completed,
            JobStatus::Collected
        ]
    );
    let jobs = world.jobs.jobs.lock().unwrap();
    let (_, _, descendants, rejections, receipt) = &jobs[0];
    assert_eq!(descendants.len(), 1);
    assert_eq!(descendants[0].identity.sha256, digest(b"total\n3\n"));
    assert!(rejections.is_empty());
    let receipt = format!("{:?}", receipt.as_ref().unwrap());
    for secret in [
        "SECRET-PROGRAM-TEXT",
        "SECRET-INPUT-BYTES",
        "total",
        "summary",
    ] {
        assert!(!receipt.contains(secret), "receipt leaked {secret}");
    }
    let spec = world.sandbox.seen_spec.lock().unwrap().clone().unwrap();
    assert_eq!(
        spec.inputs[0].bytes, INPUT,
        "staged from the pinned original"
    );
    assert_eq!(world.sandbox.discarded.lock().unwrap().len(), 1);
    let attempt = done.latest.attempt_id.unwrap();
    assert_eq!(
        world.store.facts(&attempt),
        [SourceFact::Accepted, SourceFact::Completed]
    );
    // Exact retry returns the original job; nothing runs again.
    drop(jobs);
    let again = run(analysis.admit(&target(), &basis("p1"), "job-key", &request())).unwrap();
    assert_eq!(again.job.id, done.job.id);
    assert_eq!(world.sandbox.started.lock().unwrap().len(), 1);
}

#[test]
fn changed_meaning_conflicts_and_unlisted_environments_are_refused_before_consumption() {
    let world = World::new(Behaviour::Exit(0), vec![]);
    let analysis = world.analysis();
    run(analysis.admit(&target(), &basis("p1"), "job-key", &request())).unwrap();
    let mut changed = request();
    changed.program = "print(2)\n".into();
    changed.program_sha256 = digest(changed.program.as_bytes());
    assert_eq!(
        run(analysis.admit(&target(), &basis("p1"), "job-key", &changed)),
        Err(AnalysisError::Conflict)
    );
    let mut unlisted = request();
    unlisted.environment_id = "custom-image".into();
    assert_eq!(
        run(analysis.admit(&target(), &basis("p1"), "other-key", &unlisted)),
        Err(AnalysisError::Unlisted)
    );
    let mut digest_changed = request();
    digest_changed.image_digest = format!("sha256:{}", "0".repeat(64));
    assert_eq!(
        run(analysis.admit(&target(), &basis("p1"), "other-key", &digest_changed)),
        Err(AnalysisError::Unlisted)
    );
    let mut lying = request();
    lying.program_sha256 = "e".repeat(64);
    assert_eq!(
        run(analysis.admit(&target(), &basis("p1"), "other-key", &lying)),
        Err(AnalysisError::Invalid)
    );
    let mut missing = request();
    missing.inputs[0].original_id = "not-registered".into();
    assert_eq!(
        run(analysis.admit(&target(), &basis("p1"), "other-key", &missing)),
        Err(AnalysisError::InputMismatch)
    );
    let mut wrong = request();
    wrong.inputs[0].digest = "f".repeat(64);
    assert_eq!(
        run(analysis.admit(&target(), &basis("p1"), "other-key", &wrong)),
        Err(AnalysisError::InputMismatch)
    );
    assert_eq!(
        world.store.0.lock().unwrap().operations.len(),
        1,
        "refusals admitted nothing"
    );
    assert_eq!(world.store.0.lock().unwrap().consumed, 0);
    assert!(
        world.sandbox.seen_spec.lock().unwrap().is_none(),
        "nothing staged"
    );
}

#[test]
fn hostile_outputs_are_refused_by_reason_while_safe_siblings_register() {
    let entries = vec![
        regular("safe.txt", b"ok"),
        regular("../x.txt", b"x"),
        regular("/abs.txt", b"x"),
        OutputEntry {
            kind: OutputKind::Symlink,
            ..regular("link.txt", b"")
        },
        OutputEntry {
            links: 2,
            ..regular("hard.txt", b"x")
        },
        regular("A.txt", b"x"),
        regular("a.txt", b"x"),
        OutputEntry {
            kind: OutputKind::Fifo,
            ..regular("pipe.txt", b"")
        },
    ];
    let world = World::new(Behaviour::Exit(0), entries);
    let analysis = world.analysis();
    run(analysis.admit(&target(), &basis("p1"), "job-key", &request())).unwrap();
    run(analysis.run_next(&basis("p1"), &ModelCancellation::new())).unwrap();
    let jobs = world.jobs.jobs.lock().unwrap();
    let (_, _, descendants, rejections, receipt) = &jobs[0];
    assert_eq!(
        descendants
            .iter()
            .map(|d| d.path.as_str())
            .collect::<Vec<_>>(),
        ["safe.txt"]
    );
    let mut reasons: Vec<&str> = rejections.iter().map(|r| r.reason.as_str()).collect();
    reasons.sort();
    assert_eq!(
        reasons,
        [
            "absolute",
            "case_collision",
            "case_collision",
            "fifo",
            "hardlink",
            "parent_reference",
            "symlink"
        ]
    );
    assert_eq!(receipt.as_ref().unwrap().rejected.len(), 7);
    let text = format!("{:?}", receipt.as_ref().unwrap());
    assert!(
        !text.contains("abs") && !text.contains("pipe"),
        "rejected names are digests only"
    );
}

#[test]
fn limits_are_classified_and_wall_time_stops_the_job() {
    let world = World::new(Behaviour::Oom, vec![]);
    run(world
        .analysis()
        .admit(&target(), &basis("p1"), "k", &request()))
    .unwrap();
    let done = run(world
        .analysis()
        .run_next(&basis("p1"), &ModelCancellation::new()))
    .unwrap()
    .unwrap();
    assert_eq!(world.jobs.statuses()[3], JobStatus::LimitExceeded);
    assert_eq!(
        world.jobs.jobs.lock().unwrap()[0].1[3].reason.as_deref(),
        Some("memory")
    );
    assert_eq!(done.latest.status, JobStatus::Collected);

    let world = World::new(Behaviour::Exit(SIGXFSZ_EXIT), vec![]);
    run(world
        .analysis()
        .admit(&target(), &basis("p1"), "k", &request()))
    .unwrap();
    run(world
        .analysis()
        .run_next(&basis("p1"), &ModelCancellation::new()))
    .unwrap();
    assert_eq!(
        world.jobs.jobs.lock().unwrap()[0].1[3].reason.as_deref(),
        Some("output_file")
    );

    let world = World::new(Behaviour::Exit(3), vec![]);
    run(world
        .analysis()
        .admit(&target(), &basis("p1"), "k", &request()))
    .unwrap();
    run(world
        .analysis()
        .run_next(&basis("p1"), &ModelCancellation::new()))
    .unwrap();
    assert_eq!(world.jobs.statuses()[3], JobStatus::Failed);

    let world = World::new(Behaviour::Forever, vec![]);
    let mut short = request();
    short.limits.wall_seconds = 1;
    run(world.analysis().admit(&target(), &basis("p1"), "k", &short)).unwrap();
    run(world
        .analysis()
        .run_next(&basis("p1"), &ModelCancellation::new()))
    .unwrap();
    assert_eq!(world.jobs.statuses()[3], JobStatus::LimitExceeded);
    assert_eq!(
        world.jobs.jobs.lock().unwrap()[0].1[3].reason.as_deref(),
        Some("wall_time")
    );
    assert!(*world.sandbox.stopped.lock().unwrap());
}

#[test]
fn stop_terminates_confirms_and_discards_without_registration() {
    let world = World::new(Behaviour::Forever, vec![regular("partial.txt", b"x")]);
    run(world
        .analysis()
        .admit(&target(), &basis("p1"), "k", &request()))
    .unwrap();
    let cancellation = ModelCancellation::new();
    cancellation.cancel();
    // A cancelled claim does not start new work.
    let record = run(world.analysis().run_next(&basis("p1"), &cancellation))
        .unwrap()
        .unwrap();
    assert_eq!(record.latest.status, JobStatus::Admitted);
    // Cancelled during the run: the started job is stopped and confirmed.
    let world = World::new(Behaviour::Forever, vec![regular("partial.txt", b"x")]);
    let analysis = world.analysis();
    run(analysis.admit(&target(), &basis("p1"), "k", &request())).unwrap();
    let job = world.jobs.record_of(0);
    let consumed = run(world.store.consume(&basis("p1"), &job.job.operation_id)).unwrap();
    let record = run(world.jobs.append(
        "actor",
        &scope(),
        &job.job.id,
        0,
        &Transition {
            status: JobStatus::PossiblyStarted,
            attempt_id: Some(consumed.attempt_id.clone()),
            reason: None,
            exit_code: None,
        },
    ))
    .unwrap();
    world
        .sandbox
        .started
        .lock()
        .unwrap()
        .push(consumed.attempt_id.clone());
    let cancellation = ModelCancellation::new();
    cancellation.cancel();
    let stopped = run(analysis.follow(
        "actor",
        &scope(),
        record,
        &consumed,
        SandboxState::Running,
        Instant::now(),
        &cancellation,
    ))
    .unwrap();
    assert_eq!(stopped.latest.status, JobStatus::Stopped);
    assert!(
        world.jobs.jobs.lock().unwrap()[0].2.is_empty(),
        "a stopped job registers nothing"
    );
    assert_eq!(world.sandbox.discarded.lock().unwrap().len(), 1);
    assert_eq!(
        world.store.facts(&consumed.attempt_id).last(),
        Some(&SourceFact::Completed)
    );
}

#[test]
fn unconfirmed_stop_or_start_is_unknown_and_never_retried() {
    let world = World::new(Behaviour::StopNeverConfirms, vec![]);
    let mut short = request();
    short.limits.wall_seconds = 1;
    run(world.analysis().admit(&target(), &basis("p1"), "k", &short)).unwrap();
    let record = run(world
        .analysis()
        .run_next(&basis("p1"), &ModelCancellation::new()))
    .unwrap()
    .unwrap();
    assert_eq!(record.latest.status, JobStatus::Unknown);
    let facts = world
        .store
        .facts(record.latest.attempt_id.as_ref().unwrap());
    assert!(
        !facts.iter().any(|f| f.is_resolved()),
        "an unconfirmed stop leaves the attempt unresolved: {facts:?}"
    );
    assert!(
        run(world
            .analysis()
            .run_next(&basis("p2"), &ModelCancellation::new()))
        .unwrap()
        .is_none(),
        "unknown is not pending work"
    );

    let world = World::new(Behaviour::StartUncertainUnconfirmed, vec![]);
    run(world
        .analysis()
        .admit(&target(), &basis("p1"), "k", &request()))
    .unwrap();
    let record = run(world
        .analysis()
        .run_next(&basis("p1"), &ModelCancellation::new()))
    .unwrap()
    .unwrap();
    assert_eq!(record.latest.status, JobStatus::Unknown);
}

#[test]
fn absence_before_start_is_retryable_under_a_new_attempt() {
    for behaviour in [Behaviour::StartRefused, Behaviour::StartUncertainAbsent] {
        let world = World::new(behaviour, vec![]);
        run(world
            .analysis()
            .admit(&target(), &basis("p1"), "k", &request()))
        .unwrap();
        let record = run(world
            .analysis()
            .run_next(&basis("p1"), &ModelCancellation::new()))
        .unwrap()
        .unwrap();
        assert_eq!(record.latest.status, JobStatus::Absent, "{behaviour:?}");
        let attempt = record.latest.attempt_id.clone().unwrap();
        assert_eq!(
            world.store.facts(&attempt),
            [SourceFact::AuthoritativelyAbsent]
        );
        // The same process cannot retry; a new claim process can.
        assert_eq!(
            run(world
                .analysis()
                .run_next(&basis("p1"), &ModelCancellation::new())),
            Err(AnalysisError::Fenced)
        );
    }
}

#[test]
fn lost_job_recovery_resumes_marks_absent_or_collects_without_a_duplicate_run() {
    // Crash after consumption, before the possibly-started fact: absent.
    let world = World::new(Behaviour::Exit(0), vec![regular("out.txt", b"1")]);
    run(world
        .analysis()
        .admit(&target(), &basis("p1"), "k", &request()))
    .unwrap();
    *world.jobs.fail_next_append.lock().unwrap() = true;
    assert_eq!(
        run(world
            .analysis()
            .run_next(&basis("p1"), &ModelCancellation::new())),
        Err(AnalysisError::Unavailable)
    );
    assert!(
        world.sandbox.started.lock().unwrap().is_empty(),
        "no sandbox call without the durable fact"
    );
    // A replacement claim recovers the attempt as absent and runs once.
    let done = run(world
        .analysis()
        .run_next(&basis("p2"), &ModelCancellation::new()))
    .unwrap()
    .unwrap();
    assert_eq!(done.latest.status, JobStatus::Collected);
    assert_eq!(
        world.jobs.statuses(),
        [
            JobStatus::Admitted,
            JobStatus::Absent,
            JobStatus::PossiblyStarted,
            JobStatus::Running,
            JobStatus::Completed,
            JobStatus::Collected
        ]
    );
    assert_eq!(world.sandbox.started.lock().unwrap().len(), 1);

    // Crash while running: recovery resumes the watch on the same sandbox.
    let world = World::new(Behaviour::Exit(0), vec![regular("out.txt", b"1")]);
    run(world
        .analysis()
        .admit(&target(), &basis("p1"), "k", &request()))
    .unwrap();
    let job = world.jobs.record_of(0);
    let consumed = run(world.store.consume(&basis("p1"), &job.job.operation_id)).unwrap();
    run(world.jobs.append(
        "actor",
        &scope(),
        &job.job.id,
        0,
        &Transition {
            status: JobStatus::PossiblyStarted,
            attempt_id: Some(consumed.attempt_id.clone()),
            reason: None,
            exit_code: None,
        },
    ))
    .unwrap();
    world
        .sandbox
        .started
        .lock()
        .unwrap()
        .push(consumed.attempt_id.clone());
    let recovered =
        run(world
            .analysis()
            .recover("actor", &scope(), &job.job.id, &ModelCancellation::new()))
        .unwrap();
    assert_eq!(recovered.latest.status, JobStatus::Collected);
    assert_eq!(
        world.sandbox.started.lock().unwrap().len(),
        1,
        "recovery never dispatches"
    );

    // Possibly started but the sandbox is fenced absent: retryable.
    let world = World::new(Behaviour::Exit(0), vec![]);
    run(world
        .analysis()
        .admit(&target(), &basis("p1"), "k", &request()))
    .unwrap();
    let job = world.jobs.record_of(0);
    let consumed = run(world.store.consume(&basis("p1"), &job.job.operation_id)).unwrap();
    run(world.jobs.append(
        "actor",
        &scope(),
        &job.job.id,
        0,
        &Transition {
            status: JobStatus::PossiblyStarted,
            attempt_id: Some(consumed.attempt_id.clone()),
            reason: None,
            exit_code: None,
        },
    ))
    .unwrap();
    let recovered =
        run(world
            .analysis()
            .recover("actor", &scope(), &job.job.id, &ModelCancellation::new()))
        .unwrap();
    assert_eq!(recovered.latest.status, JobStatus::Absent);
    // A late fact for the fenced attempt is refused.
    assert_eq!(
        run(world.jobs.append(
            "actor",
            &scope(),
            &job.job.id,
            2,
            &Transition {
                status: JobStatus::PossiblyStarted,
                attempt_id: Some(consumed.attempt_id.clone()),
                reason: None,
                exit_code: None
            }
        )),
        Err(AnalysisError::Conflict)
    );

    // Unconfirmable lookup: unknown, no retry.
    let world = World::new(Behaviour::StartUncertainUnconfirmed, vec![]);
    run(world
        .analysis()
        .admit(&target(), &basis("p1"), "k", &request()))
    .unwrap();
    let job = world.jobs.record_of(0);
    let consumed = run(world.store.consume(&basis("p1"), &job.job.operation_id)).unwrap();
    run(world.jobs.append(
        "actor",
        &scope(),
        &job.job.id,
        0,
        &Transition {
            status: JobStatus::PossiblyStarted,
            attempt_id: Some(consumed.attempt_id.clone()),
            reason: None,
            exit_code: None,
        },
    ))
    .unwrap();
    let recovered =
        run(world
            .analysis()
            .recover("actor", &scope(), &job.job.id, &ModelCancellation::new()))
        .unwrap();
    assert_eq!(recovered.latest.status, JobStatus::Unknown);
}
