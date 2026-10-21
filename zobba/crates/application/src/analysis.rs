//! Measured analysis in an isolated sandbox (Story 22.4): one trusted path.
//!
//! Admission reuses 20.5 operation custody: the job's canonical meaning is the
//! operation material, inputs are its attachments, `admit` binds the logical
//! key and changed meaning conflicts. `consume` is the possible-dispatch
//! cutoff. The sandbox port is the gateway: `start` dispatches the attempt and
//! `status` looks it up, reporting absence only when the adapter has fenced a
//! delayed start. Trusted code stages inputs from immutable originals, and only
//! after confirmed termination collects, validates, measures and registers.
//!
//! Errors, receipts and status facts carry IDs, digests, sizes, counts and
//! closed codes only, never program text, input bytes or output bytes.
use crate::{
    evidence::{EvidenceObjects, ObjectError},
    model::ModelCancellation,
    operation::{OperationError, OperationStore},
};
use std::{
    future::Future,
    pin::Pin,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use zobba_domain::{
    analysis::*,
    evidence::ContentIdentity,
    identity::{Scope, valid_scope_id},
    permissions::{
        Action, CanonicalOperation, ConsumedOperation, OPERATION_VERSION, Purpose, SourceFact,
    },
    task::ClaimBasis,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AnalysisError {
    Invalid,
    /// Environment ID or image digest is not server-allowlisted.
    Unlisted,
    /// An input is not a current registered original with the asserted digest.
    InputMismatch,
    Denied,
    Conflict,
    Capacity,
    Fenced,
    NeedsDecision,
    Unavailable,
    Integrity,
}
impl AnalysisError {
    pub const fn code(self) -> &'static str {
        match self {
            Self::Invalid => "invalid_analysis",
            Self::Unlisted => "analysis_environment_unlisted",
            Self::InputMismatch => "analysis_input_mismatch",
            Self::Denied => "access_denied",
            Self::Conflict => "analysis_conflict",
            Self::Capacity => "analysis_capacity",
            Self::Fenced => "analysis_fenced",
            Self::NeedsDecision => "operation_needs_decision",
            Self::Unavailable => "analysis_unavailable",
            Self::Integrity => "analysis_integrity",
        }
    }
}
impl From<OperationError> for AnalysisError {
    fn from(value: OperationError) -> Self {
        match value {
            OperationError::Invalid => Self::Invalid,
            OperationError::Denied => Self::Denied,
            OperationError::Conflict => Self::Conflict,
            OperationError::Capacity => Self::Capacity,
            OperationError::Unavailable => Self::Unavailable,
            OperationError::Fenced => Self::Fenced,
            OperationError::NeedsDecision => Self::NeedsDecision,
        }
    }
}
impl From<ObjectError> for AnalysisError {
    fn from(value: ObjectError) -> Self {
        match value {
            ObjectError::Integrity | ObjectError::NamespaceMismatch => Self::Integrity,
            _ => Self::Unavailable,
        }
    }
}

/// Trusted operation tuple for analysis, from server configuration only. A
/// request never selects an account, environment, destination or resource.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AnalysisTarget {
    pub account_id: String,
    pub environment_id: String,
    pub destination: String,
    pub resource_id: String,
    pub resource_version: String,
    /// Trusted classification of registered originals staged as inputs.
    pub classification: String,
    /// Operation request lifetime, bounded below the Permissions maxima.
    pub lifetime_seconds: i64,
}
impl AnalysisTarget {
    pub fn operation(&self, request: &AnalysisRequest, now: i64) -> Option<CanonicalOperation> {
        let material = request.canonical_material()?;
        let operation = CanonicalOperation {
            version: OPERATION_VERSION,
            purpose: Purpose::AuditCoordination,
            action: Action::Write,
            account_id: self.account_id.clone(),
            environment_id: self.environment_id.clone(),
            destination: self.destination.clone(),
            recipients: vec![],
            material_digest: String::new(),
            material,
            attachments: request.attachments(&self.classification),
            resource_id: self.resource_id.clone(),
            resource_version: self.resource_version.clone(),
            expires_at: now.checked_add(self.lifetime_seconds)?,
        };
        (self.lifetime_seconds > 0).then_some(operation)
    }
}

/// Exact registered original location for trusted staging.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OriginalRef {
    pub namespace: String,
    pub version: String,
    pub identity: ContentIdentity,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AnalysisJob {
    pub id: String,
    pub scope: Scope,
    pub actor_id: String,
    pub task_id: String,
    pub cycle_id: String,
    pub operation_id: String,
    pub request: AnalysisRequest,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct JobFact {
    pub sequence: u32,
    pub status: JobStatus,
    pub attempt_id: Option<String>,
    pub reason: Option<String>,
    pub exit_code: Option<i32>,
    pub at: i64,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct JobRecord {
    pub job: AnalysisJob,
    pub latest: JobFact,
    /// When the current attempt was durably marked possibly started.
    pub started_at: Option<i64>,
    /// When the current attempt was first durably observed running.
    pub running_at: Option<i64>,
    /// Distinct attempts this job has consumed.
    pub attempts: u32,
    /// Database clock at the read.
    pub now: i64,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Transition {
    pub status: JobStatus,
    pub attempt_id: Option<String>,
    pub reason: Option<&'static str>,
    pub exit_code: Option<i32>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Descendant {
    pub id: String,
    pub path: String,
    /// The validator's [`fold_key`], the database case-insensitive key.
    pub fold_key: String,
    pub media_type: &'static str,
    pub identity: ContentIdentity,
    pub namespace: String,
    pub version: String,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Rejection {
    pub path_sha256: String,
    pub reason: RejectReason,
}
/// Receipt of a collection: IDs, digests, sizes, counts and closed codes only.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CollectionReceipt {
    pub descendants: Vec<(String, String, u64)>,
    pub rejected: Vec<(String, RejectReason)>,
    pub output_bytes: u64,
    pub truncated: bool,
    /// Closed reason recorded on the collection fact (for example
    /// `collection_unavailable`), when outputs could not be collected.
    pub reason: Option<&'static str>,
}

/// Job persistence. Every call is scoped and freshly authorized; the
/// adapter serializes facts per job and refuses any transition the domain
/// machine (and the database guard) does not permit.
pub trait AnalysisJobs: Send + Sync {
    fn original(
        &self,
        actor: &str,
        scope: &Scope,
        id: &str,
    ) -> impl Future<Output = Result<Option<OriginalRef>, AnalysisError>> + Send;
    /// Idempotent per operation: an identical retry returns the original job.
    fn record(
        &self,
        basis: &ClaimBasis,
        operation_id: &str,
        request: &AnalysisRequest,
    ) -> impl Future<Output = Result<JobRecord, AnalysisError>> + Send;
    fn job(
        &self,
        actor: &str,
        scope: &Scope,
        id: &str,
    ) -> impl Future<Output = Result<JobRecord, AnalysisError>> + Send;
    /// The job operation's highest-numbered consumed attempt, if any.
    fn latest_attempt(
        &self,
        actor: &str,
        scope: &Scope,
        job_id: &str,
    ) -> impl Future<Output = Result<Option<String>, AnalysisError>> + Send;
    /// Bounded jobs of one Task needing automatic work, oldest admitted first:
    /// unfinished jobs, and settled jobs whose source fact is not yet recorded.
    fn pending(
        &self,
        actor: &str,
        scope: &Scope,
        task_id: &str,
    ) -> impl Future<Output = Result<Vec<JobRecord>, AnalysisError>> + Send;
    /// Appends after `expected` (the sequence the caller last read).
    fn append(
        &self,
        actor: &str,
        scope: &Scope,
        job_id: &str,
        expected: u32,
        transition: &Transition,
    ) -> impl Future<Output = Result<JobRecord, AnalysisError>> + Send;
    /// Atomically records descendants, rejections and the collection fact.
    #[allow(clippy::too_many_arguments)]
    fn collect(
        &self,
        actor: &str,
        scope: &Scope,
        job_id: &str,
        expected: u32,
        attempt_id: &str,
        descendants: &[Descendant],
        rejections: &[Rejection],
        receipt: &CollectionReceipt,
    ) -> impl Future<Output = Result<JobRecord, AnalysisError>> + Send;
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StagedInput {
    /// Staged file name under [`INPUT_DIR`]: the original ID.
    pub name: String,
    pub bytes: Vec<u8>,
}
/// Everything a sandbox needs, assembled by trusted code. It contains no
/// credential, broker or model secret, and no caller-selected image.
#[derive(Clone, PartialEq, Eq)]
pub struct SandboxSpec {
    /// The consumed attempt ID: one sandbox per attempt, never reused.
    pub handle: String,
    pub environment: AnalysisEnvironment,
    pub program: Vec<u8>,
    pub inputs: Vec<StagedInput>,
    pub limits: AnalysisLimits,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SandboxState {
    /// Never started, and the adapter has fenced any delayed start.
    Absent,
    /// Created but not yet running.
    Starting,
    Running,
    /// Whole-job termination confirmed.
    Exited {
        exit_code: Option<i32>,
        out_of_memory: bool,
    },
    /// Existence or termination cannot be established.
    Unconfirmed,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SandboxError {
    /// Definitely nothing was created.
    Refused,
    /// The outcome is not known; the caller must look the handle up.
    Uncertain,
    Unavailable,
}
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Collection {
    pub entries: Vec<OutputEntry>,
    /// The output store reached its total capacity.
    pub full: bool,
    /// The collector stopped at its entry bound.
    pub truncated: bool,
}

pub trait AnalysisSandbox: Send + Sync {
    fn start(&self, spec: &SandboxSpec) -> impl Future<Output = Result<(), SandboxError>> + Send;
    /// Look the attempt up. `environment` is the job's allowlisted environment
    /// (an adapter that fences a never-started handle uses its pinned image).
    fn status(
        &self,
        handle: &str,
        environment: &AnalysisEnvironment,
    ) -> impl Future<Output = Result<SandboxState, SandboxError>> + Send;
    /// Request termination. Confirmation is only ever a later `status`.
    fn stop(
        &self,
        handle: &str,
        environment: &AnalysisEnvironment,
    ) -> impl Future<Output = Result<(), SandboxError>> + Send;
    /// Only after confirmed termination; reads, never trusts, the outputs.
    fn collect(
        &self,
        handle: &str,
        limits: &AnalysisLimits,
    ) -> impl Future<Output = Result<Collection, SandboxError>> + Send;
    /// Release sandbox resources after collection or a confirmed stop.
    fn discard(&self, handle: &str) -> impl Future<Output = Result<(), SandboxError>> + Send;
    /// Extra time beyond the wall limit before the worker's own backstop stop,
    /// for a sandbox that enforces the wall limit inside the job itself (and
    /// still collects after that in-job kill).
    fn wall_grace(&self) -> Duration {
        Duration::ZERO
    }
}

pub type Delay = fn(Duration) -> Pin<Box<dyn Future<Output = ()> + Send>>;

#[derive(Clone, Copy)]
pub struct AnalysisSettings {
    pub poll: Duration,
    /// Bound on waiting for a requested stop to be confirmed.
    pub stop_confirmation: Duration,
    /// Bound on a started sandbox first reporting Running.
    pub provisioning: Duration,
    /// Collection attempts after confirmed termination before the job is
    /// durably closed with `collection_unavailable`.
    pub collect_attempts: u32,
    pub delay: Delay,
}

/// How long a caller follows a running attempt. Recovery outside a claim
/// watches only briefly and detaches (never stops) on shutdown; the job keeps
/// running and is looked up again later.
#[derive(Clone, Copy, Default)]
pub struct Watch<'a> {
    pub until: Option<Instant>,
    pub detach: Option<&'a ModelCancellation>,
}
impl Watch<'_> {
    fn detached(&self) -> bool {
        self.until.is_some_and(|until| Instant::now() >= until)
            || self.detach.is_some_and(ModelCancellation::is_cancelled)
    }
}

pub struct Analysis<'a, S, J, X, O> {
    pub store: &'a S,
    pub jobs: &'a J,
    pub sandbox: &'a X,
    pub objects: &'a O,
    pub allowlist: &'a [AnalysisEnvironment],
    pub settings: AnalysisSettings,
}

fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64)
}

/// Exit code of a process killed by SIGXFSZ (128 + 25): a file exceeded its
/// per-file limit.
const SIGXFSZ_EXIT: i32 = 153;
/// Exit code of a process killed by SIGKILL (128 + 9), as an in-job wall-time
/// enforcement reports it.
const SIGKILL_EXIT: i32 = 137;
pub const START_REFUSED: &str = "start_refused";
pub const COLLECTION_UNAVAILABLE: &str = "collection_unavailable";

fn ago(seconds: i64) -> Instant {
    Instant::now()
        .checked_sub(Duration::from_secs(seconds.max(0) as u64))
        .unwrap_or_else(Instant::now)
}

/// How the program's run ended, decided by trusted facts only.
struct Ending {
    killed: Option<(JobStatus, Option<&'static str>)>,
    exit_code: Option<i32>,
    out_of_memory: bool,
    ran_for: Option<Duration>,
}

impl<S, J, X, O> Analysis<'_, S, J, X, O>
where
    S: OperationStore,
    J: AnalysisJobs,
    X: AnalysisSandbox,
    O: EvidenceObjects,
{
    /// Admit one exact job under the producing claim. Refusals for an unlisted
    /// environment or an unverifiable input happen before any operation exists.
    pub async fn admit(
        &self,
        target: &AnalysisTarget,
        basis: &ClaimBasis,
        key: &str,
        request: &AnalysisRequest,
    ) -> Result<JobRecord, AnalysisError> {
        if !request.is_valid() || !valid_scope_id(key) {
            return Err(AnalysisError::Invalid);
        }
        request
            .environment(self.allowlist)
            .ok_or(AnalysisError::Unlisted)?;
        if self.objects.measure(request.program.as_bytes()).sha256 != request.program_sha256 {
            return Err(AnalysisError::Invalid);
        }
        // Only the exact trusted document program runs in the document
        // environment (the one whose outputs may be page images), and it runs
        // nowhere else.
        if (request.environment_id == DOCUMENT_ENVIRONMENT_ID)
            != crate::reading::is_document_program(&request.program)
        {
            return Err(AnalysisError::Invalid);
        }
        for input in &request.inputs {
            let original = self
                .jobs
                .original(&basis.actor_id, &basis.scope, &input.original_id)
                .await?
                .ok_or(AnalysisError::InputMismatch)?;
            if original.identity.sha256 != input.digest {
                return Err(AnalysisError::InputMismatch);
            }
        }
        let mut operation = target
            .operation(request, unix_now())
            .ok_or(AnalysisError::Invalid)?;
        operation.material_digest = self.objects.measure(operation.material.as_bytes()).sha256;
        let admitted = self
            .store
            .admit(&basis.actor_id, &basis.scope, basis, key, &operation)
            .await?;
        self.jobs.record(basis, &admitted.id, request).await
    }

    /// Work on the Task's oldest job needing automatic work under the current
    /// claim. Earlier unresolved attempts are recovered first; a retryable job
    /// is consumed and started. A job whose recovery fails is added to `skip`
    /// and the next one is tried, so one failing job never blocks the rest.
    /// Returns None when no job (outside `skip`) needs work, and the last error
    /// only when every remaining job failed.
    pub async fn run_next(
        &self,
        basis: &ClaimBasis,
        cancellation: &ModelCancellation,
        skip: &mut Vec<String>,
    ) -> Result<Option<JobRecord>, AnalysisError> {
        let pending = self
            .jobs
            .pending(&basis.actor_id, &basis.scope, &basis.task_id)
            .await?;
        let mut failure = None;
        let ids: Vec<String> = pending
            .into_iter()
            .map(|r| r.job.id)
            .filter(|id| !skip.contains(id))
            .collect();
        for id in ids {
            let result = match self
                .recover(
                    &basis.actor_id,
                    &basis.scope,
                    &id,
                    cancellation,
                    Watch::default(),
                )
                .await
            {
                Ok(record) if record.latest.status.retryable() && !cancellation.is_cancelled() => {
                    if record.attempts >= MAX_START_ATTEMPTS {
                        self.refuse_start(&basis.actor_id, &basis.scope, record)
                            .await
                    } else {
                        self.start(basis, record, cancellation).await
                    }
                }
                other => other,
            };
            match result {
                Ok(record) => return Ok(Some(record)),
                Err(error) => {
                    skip.push(id);
                    failure = Some(error);
                }
            }
        }
        failure.map_or(Ok(None), Err)
    }

    /// Work on one exact job of the claim's Task: recover it, and start a
    /// retryable attempt (Story 22.5 trusted document jobs and model programs).
    /// Like `run_next`, a job never dispatches twice; an absent attempt may be
    /// started again under the same bounded start attempts.
    pub async fn run(
        &self,
        basis: &ClaimBasis,
        job_id: &str,
        cancellation: &ModelCancellation,
    ) -> Result<JobRecord, AnalysisError> {
        let record = self
            .recover(
                &basis.actor_id,
                &basis.scope,
                job_id,
                cancellation,
                Watch::default(),
            )
            .await?;
        if !record.latest.status.retryable() || cancellation.is_cancelled() {
            return Ok(record);
        }
        if record.attempts >= MAX_START_ATTEMPTS {
            self.refuse_start(&basis.actor_id, &basis.scope, record)
                .await
        } else {
            self.start(basis, record, cancellation).await
        }
    }

    async fn start(
        &self,
        basis: &ClaimBasis,
        record: JobRecord,
        cancellation: &ModelCancellation,
    ) -> Result<JobRecord, AnalysisError> {
        let (actor, scope) = (&basis.actor_id, &basis.scope);
        let environment = record
            .job
            .request
            .environment(self.allowlist)
            .ok_or(AnalysisError::Unlisted)?
            .clone();
        let consumed = self.store.consume(basis, &record.job.operation_id).await?;
        let attempt = consumed.attempt_id.clone();
        // Durable before any staging or sandbox call. If this write fails the
        // sandbox is never called; recovery later records the attempt absent,
        // which also fences this process if it resumes late.
        let record = self
            .jobs
            .append(
                actor,
                scope,
                &record.job.id,
                record.latest.sequence,
                &Transition {
                    status: JobStatus::PossiblyStarted,
                    attempt_id: Some(attempt.clone()),
                    reason: None,
                    exit_code: None,
                },
            )
            .await?;
        let spec = match self.stage(&record, &environment, &attempt).await {
            Ok(spec) => spec,
            Err(error) => {
                // Nothing was handed to the sandbox: authoritatively absent.
                self.absent(actor, scope, &record, &attempt).await?;
                return Err(error);
            }
        };
        let started = Instant::now();
        let state = match self.sandbox.start(&spec).await {
            Ok(()) => SandboxState::Starting,
            Err(SandboxError::Refused) => {
                return self.absent(actor, scope, &record, &attempt).await;
            }
            Err(_) => self
                .sandbox
                .status(&attempt, &environment)
                .await
                .unwrap_or(SandboxState::Unconfirmed),
        };
        self.follow(
            actor,
            scope,
            record,
            &consumed,
            state,
            started,
            cancellation,
            Watch::default(),
        )
        .await
    }

    /// Trusted staging: exact pinned originals, measured against the job's
    /// recorded digests, and the program measured against its digest.
    async fn stage(
        &self,
        record: &JobRecord,
        environment: &AnalysisEnvironment,
        attempt: &str,
    ) -> Result<SandboxSpec, AnalysisError> {
        let job = &record.job;
        let program = job.request.program.as_bytes().to_vec();
        if self.objects.measure(&program).sha256 != job.request.program_sha256 {
            return Err(AnalysisError::Integrity);
        }
        let mut inputs = Vec::new();
        for input in &job.request.inputs {
            let original = self
                .jobs
                .original(&job.actor_id, &job.scope, &input.original_id)
                .await?
                .ok_or(AnalysisError::InputMismatch)?;
            if original.identity.sha256 != input.digest {
                return Err(AnalysisError::InputMismatch);
            }
            let object = self
                .objects
                .get_version(&input.original_id, &original.namespace, &original.version)
                .await?;
            if object.identity != original.identity
                || self.objects.measure(&object.bytes) != original.identity
            {
                return Err(AnalysisError::Integrity);
            }
            inputs.push(StagedInput {
                name: input.original_id.clone(),
                bytes: object.bytes,
            });
        }
        Ok(SandboxSpec {
            handle: attempt.into(),
            environment: environment.clone(),
            program,
            inputs,
            limits: job.request.limits,
        })
    }

    /// Recovery under fresh audience authority with restricted receipt custody.
    /// Never dispatches; looks the sandbox up, resumes a running watch (bounded
    /// by `watch`), collects a confirmed termination, re-issues a lost source
    /// observation, or records absence or uncertainty.
    pub async fn recover(
        &self,
        actor: &str,
        scope: &Scope,
        job_id: &str,
        cancellation: &ModelCancellation,
        watch: Watch<'_>,
    ) -> Result<JobRecord, AnalysisError> {
        let record = self.jobs.job(actor, scope, job_id).await?;
        let environment = record
            .job
            .request
            .environment(self.allowlist)
            .ok_or(AnalysisError::Unlisted)?
            .clone();
        match record.latest.status {
            JobStatus::Admitted | JobStatus::Absent => {
                // A consumed attempt with no fact naming it was never handed to
                // a sandbox: recording it absent also fences a late starter.
                match self
                    .jobs
                    .latest_attempt(actor, scope, &record.job.id)
                    .await?
                {
                    Some(attempt) if Some(&attempt) != record.latest.attempt_id.as_ref() => {
                        self.absent(actor, scope, &record, &attempt).await
                    }
                    Some(attempt) => {
                        // Identical repeated absence is idempotent at the store.
                        let custody = self.store.recover(actor, scope, &attempt).await?;
                        self.store
                            .observe(&custody, SourceFact::AuthoritativelyAbsent)
                            .await?;
                        Ok(record)
                    }
                    None => Ok(record),
                }
            }
            JobStatus::PossiblyStarted | JobStatus::Running => {
                let attempt = record
                    .latest
                    .attempt_id
                    .clone()
                    .ok_or(AnalysisError::Integrity)?;
                let custody = self.store.recover(actor, scope, &attempt).await?;
                let state = self
                    .sandbox
                    .status(&attempt, &environment)
                    .await
                    .unwrap_or(SandboxState::Unconfirmed);
                let started = ago(record
                    .now
                    .saturating_sub(record.started_at.unwrap_or(record.now)));
                self.follow(
                    actor,
                    scope,
                    record,
                    &custody,
                    state,
                    started,
                    cancellation,
                    watch,
                )
                .await
            }
            status if status.collectable() => {
                let attempt = record
                    .latest
                    .attempt_id
                    .clone()
                    .ok_or(AnalysisError::Integrity)?;
                let custody = self.store.recover(actor, scope, &attempt).await?;
                if record.latest.reason.as_deref() == Some(START_REFUSED) {
                    // Nothing ever ran: close without outputs.
                    return self.close(actor, scope, record, None, None).await;
                }
                // The terminal fact may have committed before its observation.
                match self.store.observe(&custody, SourceFact::Completed).await {
                    Ok(()) | Err(OperationError::Conflict) => {}
                    Err(error) => return Err(error.into()),
                }
                match self
                    .collect_bounded(&attempt, &record.job.request.limits)
                    .await
                {
                    Some(collection) => self.register(actor, scope, record, collection).await,
                    None => {
                        self.close(
                            actor,
                            scope,
                            record,
                            Some(RejectReason::CollectionUnavailable),
                            Some(COLLECTION_UNAVAILABLE),
                        )
                        .await
                    }
                }
            }
            JobStatus::Collected | JobStatus::Stopped => {
                // Settled, but its source fact may never have been recorded.
                let attempt = record
                    .latest
                    .attempt_id
                    .clone()
                    .ok_or(AnalysisError::Integrity)?;
                let custody = self.store.recover(actor, scope, &attempt).await?;
                match self.store.observe(&custody, SourceFact::Completed).await {
                    Ok(()) => Ok(record),
                    // A start refusal closes an attempt that was never started.
                    Err(OperationError::Conflict) => {
                        self.store
                            .observe(&custody, SourceFact::AuthoritativelyAbsent)
                            .await?;
                        Ok(record)
                    }
                    Err(error) => Err(error.into()),
                }
            }
            JobStatus::Unknown => {
                let attempt = record
                    .latest
                    .attempt_id
                    .clone()
                    .ok_or(AnalysisError::Integrity)?;
                let custody = self.store.recover(actor, scope, &attempt).await?;
                match self.store.observe(&custody, SourceFact::Unknown).await {
                    Ok(()) | Err(OperationError::Conflict) => Ok(record),
                    Err(error) => Err(error.into()),
                }
            }
            _ => Ok(record),
        }
    }

    /// After MAX_START_ATTEMPTS attempts that never started, the job is
    /// refused for good: a durable failure and an empty collection.
    async fn refuse_start(
        &self,
        actor: &str,
        scope: &Scope,
        record: JobRecord,
    ) -> Result<JobRecord, AnalysisError> {
        let record = self
            .transition(
                actor,
                scope,
                &record,
                JobStatus::Failed,
                Some(START_REFUSED),
                None,
            )
            .await?;
        self.close(actor, scope, record, None, None).await
    }

    async fn absent(
        &self,
        actor: &str,
        scope: &Scope,
        record: &JobRecord,
        attempt: &str,
    ) -> Result<JobRecord, AnalysisError> {
        let record = self
            .jobs
            .append(
                actor,
                scope,
                &record.job.id,
                record.latest.sequence,
                &Transition {
                    status: JobStatus::Absent,
                    attempt_id: Some(attempt.into()),
                    reason: None,
                    exit_code: None,
                },
            )
            .await?;
        let custody = self.store.recover(actor, scope, attempt).await?;
        self.store
            .observe(&custody, SourceFact::AuthoritativelyAbsent)
            .await?;
        Ok(record)
    }

    async fn transition(
        &self,
        actor: &str,
        scope: &Scope,
        record: &JobRecord,
        status: JobStatus,
        reason: Option<&'static str>,
        exit_code: Option<i32>,
    ) -> Result<JobRecord, AnalysisError> {
        self.jobs
            .append(
                actor,
                scope,
                &record.job.id,
                record.latest.sequence,
                &Transition {
                    status,
                    attempt_id: record.latest.attempt_id.clone(),
                    reason,
                    exit_code,
                },
            )
            .await
    }

    /// Follow a started or recovered attempt to a durable fact. The wall
    /// deadline starts when the sandbox first reports Running.
    #[allow(clippy::too_many_arguments)]
    async fn follow(
        &self,
        actor: &str,
        scope: &Scope,
        mut record: JobRecord,
        custody: &ConsumedOperation,
        mut state: SandboxState,
        started: Instant,
        cancellation: &ModelCancellation,
        watch: Watch<'_>,
    ) -> Result<JobRecord, AnalysisError> {
        let attempt = record
            .latest
            .attempt_id
            .clone()
            .ok_or(AnalysisError::Integrity)?;
        let environment = record
            .job
            .request
            .environment(self.allowlist)
            .ok_or(AnalysisError::Unlisted)?
            .clone();
        let limits = record.job.request.limits;
        let wall = Duration::from_secs(u64::from(limits.wall_seconds));
        let mut running_since = record
            .running_at
            .map(|at| ago(record.now.saturating_sub(at)));
        let mut killed: Option<(JobStatus, Option<&'static str>)> = None;
        loop {
            match state {
                SandboxState::Absent => {
                    return if killed.is_some_and(|(status, _)| status == JobStatus::Stopped) {
                        // A stop removed a never-started sandbox: confirmed stopped.
                        let record = self
                            .transition(
                                actor,
                                scope,
                                &record,
                                JobStatus::Stopped,
                                Some("stopped"),
                                None,
                            )
                            .await?;
                        self.store.observe(custody, SourceFact::Completed).await?;
                        let _ = self.sandbox.discard(&attempt).await;
                        Ok(record)
                    } else if record.latest.status == JobStatus::Running {
                        // A job that was seen running is never declared absent.
                        self.unknown(actor, scope, &record, custody).await
                    } else {
                        // Never ran (including a provisioning timeout that removed
                        // and fenced it): absent, so a fresh attempt may start.
                        let record = self
                            .transition(actor, scope, &record, JobStatus::Absent, None, None)
                            .await?;
                        let recovery = self.store.recover(actor, scope, &attempt).await?;
                        self.store
                            .observe(&recovery, SourceFact::AuthoritativelyAbsent)
                            .await?;
                        Ok(record)
                    };
                }
                SandboxState::Unconfirmed => {
                    return self.unknown(actor, scope, &record, custody).await;
                }
                SandboxState::Exited {
                    exit_code,
                    out_of_memory,
                } => {
                    if killed.is_some_and(|(status, _)| status == JobStatus::Stopped) {
                        let record = self
                            .transition(
                                actor,
                                scope,
                                &record,
                                JobStatus::Stopped,
                                Some("stopped"),
                                exit_code,
                            )
                            .await?;
                        self.store.observe(custody, SourceFact::Completed).await?;
                        let _ = self.sandbox.discard(&attempt).await;
                        return Ok(record);
                    }
                    let ending = Ending {
                        killed,
                        exit_code,
                        out_of_memory,
                        ran_for: running_since.map(|since| since.elapsed()),
                    };
                    return self.terminate(actor, scope, record, custody, ending).await;
                }
                SandboxState::Starting | SandboxState::Running => {
                    if state == SandboxState::Running {
                        if record.latest.status == JobStatus::PossiblyStarted {
                            record = self
                                .transition(actor, scope, &record, JobStatus::Running, None, None)
                                .await?;
                            self.store.observe(custody, SourceFact::Accepted).await?;
                        }
                        if running_since.is_none() {
                            running_since = Some(Instant::now());
                        }
                    }
                    if killed.is_none() {
                        if cancellation.is_cancelled() {
                            killed = Some((JobStatus::Stopped, Some("stopped")));
                        } else if running_since.is_some_and(|since| {
                            since.elapsed() >= wall + self.sandbox.wall_grace()
                        }) || (running_since.is_none()
                            && started.elapsed() >= self.settings.provisioning)
                        {
                            killed = Some((
                                JobStatus::LimitExceeded,
                                Some(LimitReason::WallTime.as_str()),
                            ));
                        } else if watch.detached() {
                            // Stop following; the job continues and is looked
                            // up again by later recovery.
                            return Ok(record);
                        }
                        if killed.is_some() {
                            let _ = self.sandbox.stop(&attempt, &environment).await;
                            let confirm = Instant::now() + self.settings.stop_confirmation;
                            state = self.confirm_stop(&attempt, &environment, confirm).await;
                            continue;
                        }
                    } else {
                        // A requested stop was not confirmed in time.
                        return self.unknown(actor, scope, &record, custody).await;
                    }
                }
            }
            (self.settings.delay)(self.settings.poll).await;
            state = self
                .sandbox
                .status(&attempt, &environment)
                .await
                .unwrap_or(SandboxState::Unconfirmed);
        }
    }

    /// Confirmed termination: collect (bounded), classify, record the terminal
    /// fact and its source observation, then register or close.
    async fn terminate(
        &self,
        actor: &str,
        scope: &Scope,
        record: JobRecord,
        custody: &ConsumedOperation,
        ending: Ending,
    ) -> Result<JobRecord, AnalysisError> {
        let attempt = record
            .latest
            .attempt_id
            .clone()
            .ok_or(AnalysisError::Integrity)?;
        let limits = record.job.request.limits;
        let collection = self.collect_bounded(&attempt, &limits).await;
        let wall = Duration::from_secs(u64::from(limits.wall_seconds));
        let (status, reason) = if let Some((status, reason)) = ending.killed {
            (status, reason)
        } else if ending.out_of_memory {
            (JobStatus::LimitExceeded, Some(LimitReason::Memory.as_str()))
        } else if ending.exit_code == Some(SIGKILL_EXIT)
            && ending.ran_for.is_some_and(|ran| ran >= wall)
        {
            // Killed by the in-job wall-time enforcement.
            (
                JobStatus::LimitExceeded,
                Some(LimitReason::WallTime.as_str()),
            )
        } else if ending.exit_code == Some(SIGXFSZ_EXIT)
            || collection.as_ref().is_some_and(|c| {
                c.entries
                    .iter()
                    .any(|e| e.kind == OutputKind::Regular && e.size > limits.output_file_bytes)
            })
        {
            (
                JobStatus::LimitExceeded,
                Some(LimitReason::OutputFile.as_str()),
            )
        } else if collection.as_ref().is_some_and(|c| c.full) {
            (
                JobStatus::LimitExceeded,
                Some(LimitReason::OutputTotal.as_str()),
            )
        } else if ending.exit_code == Some(0) {
            (JobStatus::Completed, None)
        } else {
            (JobStatus::Failed, Some("exit_status"))
        };
        let record = self
            .transition(actor, scope, &record, status, reason, ending.exit_code)
            .await?;
        // Confirmed termination resolves the dispatched attempt; registration
        // is then trusted collection, retried by recovery if lost.
        self.store.observe(custody, SourceFact::Completed).await?;
        match collection {
            Some(collection) => self.register(actor, scope, record, collection).await,
            None => {
                self.close(
                    actor,
                    scope,
                    record,
                    Some(RejectReason::CollectionUnavailable),
                    Some(COLLECTION_UNAVAILABLE),
                )
                .await
            }
        }
    }

    /// Bounded collection after confirmed termination. None: the outputs could
    /// not be read (for example no manifest after an external stop).
    async fn collect_bounded(&self, attempt: &str, limits: &AnalysisLimits) -> Option<Collection> {
        for round in 0..self.settings.collect_attempts.max(1) {
            if round > 0 {
                (self.settings.delay)(self.settings.poll).await;
            }
            if let Ok(collection) = self.sandbox.collect(attempt, limits).await {
                return Some(collection);
            }
        }
        None
    }

    /// Durably close a terminated job with no registered outputs.
    async fn close(
        &self,
        actor: &str,
        scope: &Scope,
        record: JobRecord,
        rejection: Option<RejectReason>,
        reason: Option<&'static str>,
    ) -> Result<JobRecord, AnalysisError> {
        let attempt = record
            .latest
            .attempt_id
            .clone()
            .ok_or(AnalysisError::Integrity)?;
        let rejections: Vec<Rejection> = rejection
            .map(|reason| Rejection {
                path_sha256: self.objects.measure(b"").sha256,
                reason,
            })
            .into_iter()
            .collect();
        let receipt = CollectionReceipt {
            rejected: rejections
                .iter()
                .map(|r| (r.path_sha256.clone(), r.reason))
                .collect(),
            reason,
            ..CollectionReceipt::default()
        };
        let record = self
            .jobs
            .collect(
                actor,
                scope,
                &record.job.id,
                record.latest.sequence,
                &attempt,
                &[],
                &rejections,
                &receipt,
            )
            .await?;
        let _ = self.sandbox.discard(&attempt).await;
        Ok(record)
    }

    async fn confirm_stop(
        &self,
        attempt: &str,
        environment: &AnalysisEnvironment,
        until: Instant,
    ) -> SandboxState {
        loop {
            let state = self
                .sandbox
                .status(attempt, environment)
                .await
                .unwrap_or(SandboxState::Unconfirmed);
            match state {
                SandboxState::Exited { .. } | SandboxState::Absent | SandboxState::Unconfirmed => {
                    return state;
                }
                _ if Instant::now() >= until => return state,
                _ => {
                    let _ = self.sandbox.stop(attempt, environment).await;
                    (self.settings.delay)(self.settings.poll).await;
                }
            }
        }
    }

    /// Termination or isolation not confirmed: no retry, no outputs.
    async fn unknown(
        &self,
        actor: &str,
        scope: &Scope,
        record: &JobRecord,
        custody: &ConsumedOperation,
    ) -> Result<JobRecord, AnalysisError> {
        let record = self
            .transition(
                actor,
                scope,
                record,
                JobStatus::Unknown,
                Some("unconfirmed"),
                None,
            )
            .await?;
        // An attempt already observed accepted stays unresolved either way.
        match self.store.observe(custody, SourceFact::Unknown).await {
            Ok(()) | Err(OperationError::Conflict) => Ok(record),
            Err(error) => Err(error.into()),
        }
    }

    /// Validate, measure and register descendants through the immutable
    /// evidence object path, then record the collection atomically.
    async fn register(
        &self,
        actor: &str,
        scope: &Scope,
        record: JobRecord,
        collection: Collection,
    ) -> Result<JobRecord, AnalysisError> {
        let attempt = record
            .latest
            .attempt_id
            .clone()
            .ok_or(AnalysisError::Integrity)?;
        let environment = record
            .job
            .request
            .environment(self.allowlist)
            .ok_or(AnalysisError::Unlisted)?;
        let limits = record.job.request.limits;
        let validation = validate_outputs(&collection.entries, &limits, environment);
        let mut descendants = Vec::new();
        let mut receipt = CollectionReceipt {
            truncated: collection.truncated,
            ..CollectionReceipt::default()
        };
        for accepted in &validation.accepted {
            let bytes = collection.entries[accepted.index]
                .content
                .clone()
                .ok_or(AnalysisError::Integrity)?;
            let identity = self.objects.measure(&bytes);
            if identity.size != accepted.size {
                return Err(AnalysisError::Integrity);
            }
            let id = format!(
                "analysis-{}",
                &self
                    .objects
                    .measure(format!("{attempt}\0{}", accepted.path).as_bytes())
                    .sha256[..48]
            );
            let version = put_once(self.objects, &id, bytes.clone()).await?;
            let stored = self
                .objects
                .get_version(&id, self.objects.namespace(), &version)
                .await?;
            if stored.bytes != bytes || stored.identity != identity {
                return Err(AnalysisError::Integrity);
            }
            receipt
                .descendants
                .push((id.clone(), identity.sha256.clone(), identity.size));
            receipt.output_bytes += identity.size;
            descendants.push(Descendant {
                id,
                path: accepted.path.clone(),
                fold_key: accepted.fold_key.clone(),
                media_type: accepted.media_type,
                identity,
                namespace: self.objects.namespace().into(),
                version,
            });
        }
        let mut rejections: Vec<Rejection> = validation
            .rejected
            .iter()
            .map(|r| Rejection {
                path_sha256: self
                    .objects
                    .measure(&collection.entries[r.index].path)
                    .sha256,
                reason: r.reason,
            })
            .collect();
        if collection.truncated {
            rejections.push(Rejection {
                path_sha256: self.objects.measure(b"").sha256,
                reason: RejectReason::CollectionTruncated,
            });
        }
        receipt.rejected = rejections
            .iter()
            .map(|r| (r.path_sha256.clone(), r.reason))
            .collect();
        let record = self
            .jobs
            .collect(
                actor,
                scope,
                &record.job.id,
                record.latest.sequence,
                &attempt,
                &descendants,
                &rejections,
                &receipt,
            )
            .await?;
        let _ = self.sandbox.discard(&attempt).await;
        Ok(record)
    }
}

/// The 21.1 put-if-absent path: an uncertain create is reconciled against the
/// same immutable key and never overwritten.
async fn put_once<O: EvidenceObjects>(
    objects: &O,
    id: &str,
    bytes: Vec<u8>,
) -> Result<String, AnalysisError> {
    for _ in 0..2 {
        match objects.put_if_absent(id, bytes.clone()).await {
            Ok(version) if valid_version(&version) => return Ok(version),
            Ok(_)
            | Err(
                ObjectError::VersionUnavailable
                | ObjectError::AlreadyExists
                | ObjectError::Unavailable
                | ObjectError::DeadlineExceeded,
            ) => {
                if let Some(version) = objects.latest_version(id).await? {
                    if !valid_version(&version) {
                        return Err(AnalysisError::Unavailable);
                    }
                    return Ok(version);
                }
            }
            Err(error) => return Err(error.into()),
        }
    }
    Err(AnalysisError::Unavailable)
}
fn valid_version(version: &str) -> bool {
    !version.is_empty()
        && version != "null"
        && version.len() <= 512
        && !version.chars().any(char::is_control)
}

#[cfg(test)]
pub(crate) mod tests;
