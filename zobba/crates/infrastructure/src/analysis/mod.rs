//! Story 22.4 analysis job persistence and sandbox adapters.
//!
//! The repository holds no SQL transaction across sandbox or object I/O. Every
//! call is freshly scoped (RLS) and every status fact is serialized per job by a
//! transaction advisory lock and checked again by the database guard.
#[cfg(feature = "test-docker-sandbox")]
pub mod docker;
pub mod fargate;
pub mod sigv4;

use crate::scope;
use serde_json::{Value, json};
use sqlx::{PgPool, Postgres, Row, Transaction, postgres::PgRow};
use zobba_application::{
    analysis::{
        AnalysisError, AnalysisJob, AnalysisJobs, CollectionReceipt, Descendant, JobFact,
        JobRecord, OriginalRef, Rejection, Transition,
    },
    operation::wire::StoredCanonical,
};
use zobba_domain::{
    analysis::{
        AnalysisInput, AnalysisLimits, AnalysisRequest, JobStatus, RECEIPT_REJECTION_SAMPLE,
    },
    evidence::ContentIdentity,
    identity::{Scope, valid_scope_id},
    task::ClaimBasis,
};

type Tx = Transaction<'static, Postgres>;
const JOB_LOCK: i64 = 2_204;
const PENDING_LIMIT: i64 = 16;

#[derive(Clone)]
pub struct AnalysisRepository {
    pool: PgPool,
}
impl AnalysisRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

fn unavailable(_: sqlx::Error) -> AnalysisError {
    AnalysisError::Unavailable
}
fn field<T>(row: &PgRow, name: &str) -> Result<T, AnalysisError>
where
    T: for<'r> sqlx::Decode<'r, Postgres> + sqlx::Type<Postgres>,
{
    row.try_get(name).map_err(unavailable)
}
async fn begin(pool: &PgPool, actor: &str, s: &Scope) -> Result<Tx, AnalysisError> {
    if !valid_scope_id(actor) || !s.is_valid() {
        return Err(AnalysisError::Denied);
    }
    scope::begin(pool, actor, s).await.map_err(|e| match e {
        scope::ScopeError::Denied => AnalysisError::Denied,
        _ => AnalysisError::Unavailable,
    })
}
async fn lock_job(tx: &mut Tx, job_id: &str) -> Result<(), AnalysisError> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,$2))")
        .bind(job_id)
        .bind(JOB_LOCK)
        .execute(&mut **tx)
        .await
        .map_err(unavailable)?;
    Ok(())
}
fn refusal(error: sqlx::Error) -> AnalysisError {
    match &error {
        sqlx::Error::Database(database)
            if matches!(
                database.code().as_deref(),
                Some("23514" | "23505" | "23503")
            ) =>
        {
            AnalysisError::Conflict
        }
        _ => AnalysisError::Unavailable,
    }
}

fn encode_inputs(inputs: &[AnalysisInput]) -> Value {
    Value::Array(
        inputs
            .iter()
            .map(|i| json!({"original_id": i.original_id, "digest": i.digest}))
            .collect(),
    )
}
fn encode_limits(l: &AnalysisLimits) -> Value {
    json!({"cpu_millis": l.cpu_millis, "memory_mib": l.memory_mib, "pids": l.pids,
        "wall_seconds": l.wall_seconds, "output_total_bytes": l.output_total_bytes,
        "output_file_bytes": l.output_file_bytes, "output_files": l.output_files})
}
fn decode_limits(v: &Value) -> Option<AnalysisLimits> {
    let object = v.as_object()?;
    if object.len() != 7 {
        return None;
    }
    let n = |k: &str| v.get(k)?.as_u64();
    let limits = AnalysisLimits {
        cpu_millis: u32::try_from(n("cpu_millis")?).ok()?,
        memory_mib: u32::try_from(n("memory_mib")?).ok()?,
        pids: u32::try_from(n("pids")?).ok()?,
        wall_seconds: u32::try_from(n("wall_seconds")?).ok()?,
        output_total_bytes: n("output_total_bytes")?,
        output_file_bytes: n("output_file_bytes")?,
        output_files: u32::try_from(n("output_files")?).ok()?,
    };
    limits.is_valid().then_some(limits)
}
fn decode_inputs(v: &Value) -> Option<Vec<AnalysisInput>> {
    v.as_array()?
        .iter()
        .map(|i| {
            let object = i.as_object()?;
            (object.len() == 2).then_some(())?;
            Some(AnalysisInput {
                original_id: i.get("original_id")?.as_str()?.to_owned(),
                digest: i.get("digest")?.as_str()?.to_owned(),
            })
        })
        .collect()
}
fn job_row(row: &PgRow) -> Result<AnalysisJob, AnalysisError> {
    let inputs: Value = field(row, "inputs")?;
    let limits: Value = field(row, "limits")?;
    let request = AnalysisRequest {
        environment_id: field(row, "environment_id")?,
        image_digest: field(row, "image_digest")?,
        program: field(row, "program")?,
        program_sha256: field(row, "program_sha256")?,
        inputs: decode_inputs(&inputs).ok_or(AnalysisError::Integrity)?,
        limits: decode_limits(&limits).ok_or(AnalysisError::Integrity)?,
    };
    if !request.is_valid() {
        return Err(AnalysisError::Integrity);
    }
    Ok(AnalysisJob {
        id: field(row, "id")?,
        scope: Scope {
            organisation_id: field(row, "organisation_id")?,
            client_id: field(row, "client_id")?,
            engagement_id: field(row, "engagement_id")?,
        },
        actor_id: field(row, "actor_id")?,
        task_id: field(row, "task_id")?,
        cycle_id: field(row, "cycle_id")?,
        operation_id: field(row, "operation_id")?,
        request,
    })
}
fn fact_row(row: &PgRow) -> Result<JobFact, AnalysisError> {
    let status: String = field(row, "status")?;
    Ok(JobFact {
        sequence: u32::try_from(field::<i32>(row, "sequence")?)
            .map_err(|_| AnalysisError::Integrity)?,
        status: JobStatus::parse(&status).ok_or(AnalysisError::Integrity)?,
        attempt_id: field(row, "attempt_id")?,
        reason: field(row, "reason")?,
        exit_code: field(row, "exit_code")?,
        at: field(row, "created_at")?,
    })
}
async fn read(tx: &mut Tx, job_id: &str) -> Result<JobRecord, AnalysisError> {
    if !valid_scope_id(job_id) {
        return Err(AnalysisError::Denied);
    }
    let row = sqlx::query("SELECT * FROM public.analysis_jobs WHERE id=$1")
        .bind(job_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(unavailable)?
        .ok_or(AnalysisError::Denied)?;
    let job = job_row(&row)?;
    let latest = sqlx::query(
        "SELECT * FROM public.analysis_job_events WHERE job_id=$1 ORDER BY sequence DESC LIMIT 1",
    )
    .bind(job_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(unavailable)?
    .ok_or(AnalysisError::Integrity)?;
    let latest = fact_row(&latest)?;
    let (started_at, running_at): (Option<i64>, Option<i64>) = match &latest.attempt_id {
        Some(attempt) => (
            sqlx::query_scalar("SELECT created_at FROM public.analysis_job_events WHERE job_id=$1 AND attempt_id=$2 AND status='possibly_started'")
                .bind(job_id).bind(attempt).fetch_optional(&mut **tx).await.map_err(unavailable)?,
            sqlx::query_scalar("SELECT created_at FROM public.analysis_job_events WHERE job_id=$1 AND attempt_id=$2 AND status='running'")
                .bind(job_id).bind(attempt).fetch_optional(&mut **tx).await.map_err(unavailable)?,
        ),
        None => (None, None),
    };
    let attempts: i64 = sqlx::query_scalar(
        "SELECT count(DISTINCT attempt_id) FROM public.analysis_job_events WHERE job_id=$1",
    )
    .bind(job_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(unavailable)?;
    let now: i64 =
        sqlx::query_scalar("SELECT floor(extract(epoch FROM clock_timestamp()))::bigint")
            .fetch_one(&mut **tx)
            .await
            .map_err(unavailable)?;
    Ok(JobRecord {
        job,
        latest,
        started_at,
        running_at,
        attempts: u32::try_from(attempts).map_err(|_| AnalysisError::Integrity)?,
        now,
    })
}
async fn insert_fact(
    tx: &mut Tx,
    job: &AnalysisJob,
    sequence: u32,
    transition: &Transition,
    receipt: Option<&Value>,
) -> Result<(), AnalysisError> {
    let s = &job.scope;
    sqlx::query("INSERT INTO public.analysis_job_events(organisation_id,client_id,engagement_id,job_id,sequence,status,attempt_id,reason,exit_code,receipt) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)")
        .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id).bind(&job.id)
        .bind(sequence as i32).bind(transition.status.as_str()).bind(&transition.attempt_id)
        .bind(transition.reason).bind(transition.exit_code).bind(receipt)
        .execute(&mut **tx).await.map_err(refusal)?;
    Ok(())
}
/// Receipts carry only IDs, digests, sizes, counts and closed codes. Every
/// rejection is its own row; the receipt holds exact counts per reason and a
/// bounded sample, so a hostile tree of any collected size still fits.
pub fn receipt_document(attempt_id: &str, receipt: &CollectionReceipt) -> Value {
    let mut by_reason = serde_json::Map::new();
    for (_, reason) in &receipt.rejected {
        let count = by_reason
            .entry(reason.as_str().to_owned())
            .or_insert(Value::from(0u64));
        *count = Value::from(count.as_u64().unwrap_or(0) + 1);
    }
    json!({
        "attempt_id": attempt_id,
        "descendants": receipt.descendants.iter().map(|(id, digest, size)| json!({"id": id, "sha256": digest, "size": size})).collect::<Vec<_>>(),
        "rejected_count": receipt.rejected.len(),
        "rejected_by_reason": by_reason,
        "rejected_sample": receipt.rejected.iter().take(RECEIPT_REJECTION_SAMPLE).map(|(digest, reason)| json!({"path_sha256": digest, "reason": reason.as_str()})).collect::<Vec<_>>(),
        "output_bytes": receipt.output_bytes,
        "truncated": receipt.truncated,
    })
}

/// Projection of registered descendants for inspection and tests.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoredDescendant {
    pub id: String,
    pub job_id: String,
    pub attempt_id: String,
    pub path: String,
    pub parents: Vec<String>,
    pub identity: ContentIdentity,
    pub media_type: String,
    pub namespace: String,
    pub version: String,
}
impl AnalysisRepository {
    pub async fn descendants(
        &self,
        actor: &str,
        s: &Scope,
        job_id: &str,
    ) -> Result<Vec<StoredDescendant>, AnalysisError> {
        let mut tx = begin(&self.pool, actor, s).await?;
        let rows = sqlx::query(
            "SELECT * FROM public.analysis_descendants WHERE job_id=$1 ORDER BY path COLLATE \"C\" LIMIT 64",
        )
        .bind(job_id)
        .fetch_all(&mut *tx)
        .await
        .map_err(unavailable)?;
        let mut result = Vec::new();
        for row in &rows {
            let parents: Value = field(row, "parents")?;
            result.push(StoredDescendant {
                id: field(row, "id")?,
                job_id: field(row, "job_id")?,
                attempt_id: field(row, "attempt_id")?,
                path: field(row, "path")?,
                parents: parents
                    .as_array()
                    .ok_or(AnalysisError::Integrity)?
                    .iter()
                    .map(|v| {
                        v.as_str()
                            .map(str::to_owned)
                            .ok_or(AnalysisError::Integrity)
                    })
                    .collect::<Result<_, _>>()?,
                identity: ContentIdentity {
                    sha256: field(row, "digest")?,
                    size: field::<i64>(row, "size")? as u64,
                },
                media_type: field(row, "media_type")?,
                namespace: field(row, "namespace")?,
                version: field(row, "version")?,
            });
        }
        tx.commit().await.map_err(unavailable)?;
        Ok(result)
    }
    /// The collection receipt and rejected reasons of a job, if collected.
    pub async fn receipt(
        &self,
        actor: &str,
        s: &Scope,
        job_id: &str,
    ) -> Result<Option<(Value, Vec<String>)>, AnalysisError> {
        let mut tx = begin(&self.pool, actor, s).await?;
        let receipt: Option<Value> = sqlx::query_scalar(
            "SELECT receipt FROM public.analysis_job_events WHERE job_id=$1 AND status='collected'",
        )
        .bind(job_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(unavailable)?;
        let reasons: Vec<String> = sqlx::query_scalar(
            "SELECT reason FROM public.analysis_rejections WHERE job_id=$1 ORDER BY ordinal",
        )
        .bind(job_id)
        .fetch_all(&mut *tx)
        .await
        .map_err(unavailable)?;
        tx.commit().await.map_err(unavailable)?;
        Ok(receipt.map(|r| (r, reasons)))
    }
}

impl AnalysisJobs for AnalysisRepository {
    async fn original(
        &self,
        actor: &str,
        s: &Scope,
        id: &str,
    ) -> Result<Option<OriginalRef>, AnalysisError> {
        if !valid_scope_id(id) {
            return Ok(None);
        }
        let mut tx = begin(&self.pool, actor, s).await?;
        let row = sqlx::query(
            "SELECT namespace,version,digest,size FROM public.evidence_originals WHERE id=$1",
        )
        .bind(id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(unavailable)?;
        let result = row
            .map(|row| {
                Ok::<_, AnalysisError>(OriginalRef {
                    namespace: field(&row, "namespace")?,
                    version: field(&row, "version")?,
                    identity: ContentIdentity {
                        sha256: field(&row, "digest")?,
                        size: field::<i64>(&row, "size")? as u64,
                    },
                })
            })
            .transpose()?;
        tx.commit().await.map_err(unavailable)?;
        Ok(result)
    }

    async fn record(
        &self,
        b: &ClaimBasis,
        operation_id: &str,
        request: &AnalysisRequest,
    ) -> Result<JobRecord, AnalysisError> {
        if !request.is_valid() || !valid_scope_id(operation_id) {
            return Err(AnalysisError::Invalid);
        }
        let mut tx = begin(&self.pool, &b.actor_id, &b.scope).await?;
        lock_job(&mut tx, operation_id).await?;
        let existing: Option<String> =
            sqlx::query_scalar("SELECT id FROM public.analysis_jobs WHERE operation_id=$1")
                .bind(operation_id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(unavailable)?;
        if let Some(id) = existing {
            let record = read(&mut tx, &id).await?;
            if record.job.request != *request
                || record.job.actor_id != b.actor_id
                || record.job.task_id != b.task_id
            {
                return Err(AnalysisError::Conflict);
            }
            tx.commit().await.map_err(unavailable)?;
            return Ok(record);
        }
        // The job must describe exactly the admitted operation of this actor,
        // Task and cycle: its reviewed material is the job's canonical meaning.
        let operation = sqlx::query(
            "SELECT actor_id,task_id,cycle_id,request FROM public.operations WHERE id=$1",
        )
        .bind(operation_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(unavailable)?
        .ok_or(AnalysisError::Denied)?;
        let stored: StoredCanonical =
            serde_json::from_str(&field::<String>(&operation, "request")?)
                .map_err(|_| AnalysisError::Integrity)?;
        if field::<String>(&operation, "actor_id")? != b.actor_id
            || field::<String>(&operation, "task_id")? != b.task_id
            || field::<String>(&operation, "cycle_id")? != b.cycle_id
            || Some(&stored.0.material) != request.canonical_material().as_ref()
            || stored.0.attachments.len() != request.inputs.len()
            || stored
                .0
                .attachments
                .iter()
                .zip(&request.inputs)
                .any(|(a, i)| a.id != i.original_id || a.digest != i.digest)
        {
            return Err(AnalysisError::Conflict);
        }
        let id = crate::identity::random_secret().map_err(|_| AnalysisError::Unavailable)?;
        let s = &b.scope;
        sqlx::query("INSERT INTO public.analysis_jobs(organisation_id,client_id,engagement_id,id,task_id,cycle_id,actor_id,operation_id,environment_id,image_digest,program,program_sha256,inputs,limits) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)")
            .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id).bind(&id)
            .bind(&b.task_id).bind(&b.cycle_id).bind(&b.actor_id).bind(operation_id)
            .bind(&request.environment_id).bind(&request.image_digest).bind(&request.program)
            .bind(&request.program_sha256).bind(encode_inputs(&request.inputs)).bind(encode_limits(&request.limits))
            .execute(&mut *tx).await.map_err(refusal)?;
        let job = AnalysisJob {
            id: id.clone(),
            scope: s.clone(),
            actor_id: b.actor_id.clone(),
            task_id: b.task_id.clone(),
            cycle_id: b.cycle_id.clone(),
            operation_id: operation_id.into(),
            request: request.clone(),
        };
        insert_fact(
            &mut tx,
            &job,
            0,
            &Transition {
                status: JobStatus::Admitted,
                attempt_id: None,
                reason: None,
                exit_code: None,
            },
            None,
        )
        .await?;
        let record = read(&mut tx, &id).await?;
        tx.commit().await.map_err(unavailable)?;
        Ok(record)
    }

    async fn latest_attempt(
        &self,
        actor: &str,
        s: &Scope,
        job_id: &str,
    ) -> Result<Option<String>, AnalysisError> {
        if !valid_scope_id(job_id) {
            return Err(AnalysisError::Denied);
        }
        let mut tx = begin(&self.pool, actor, s).await?;
        let latest: Option<String> = sqlx::query_scalar("SELECT a.id FROM public.operation_attempts a JOIN public.analysis_jobs j ON j.operation_id=a.operation_id WHERE j.id=$1 ORDER BY a.attempt_number DESC LIMIT 1")
            .bind(job_id).fetch_optional(&mut *tx).await.map_err(unavailable)?;
        tx.commit().await.map_err(unavailable)?;
        Ok(latest)
    }

    async fn job(&self, actor: &str, s: &Scope, id: &str) -> Result<JobRecord, AnalysisError> {
        let mut tx = begin(&self.pool, actor, s).await?;
        let record = read(&mut tx, id).await?;
        tx.commit().await.map_err(unavailable)?;
        Ok(record)
    }

    async fn pending(
        &self,
        actor: &str,
        s: &Scope,
        task_id: &str,
    ) -> Result<Vec<JobRecord>, AnalysisError> {
        if !valid_scope_id(task_id) {
            return Err(AnalysisError::Invalid);
        }
        let mut tx = begin(&self.pool, actor, s).await?;
        // Unfinished jobs, plus settled jobs whose source fact was never
        // recorded (a lost observe after a committed settled transition).
        let ids: Vec<String> = sqlx::query_scalar("SELECT j.id FROM public.analysis_jobs j CROSS JOIN LATERAL (SELECT e.status,e.attempt_id FROM public.analysis_job_events e WHERE e.job_id=j.id ORDER BY e.sequence DESC LIMIT 1) l WHERE j.task_id=$1 AND (l.status NOT IN ('collected','stopped','unknown') OR (l.status IN ('collected','stopped') AND NOT EXISTS(SELECT 1 FROM public.operation_receipts r WHERE r.attempt_id=l.attempt_id AND r.outcome IN ('completed','absent'))) OR (l.status='unknown' AND NOT EXISTS(SELECT 1 FROM public.operation_receipts r WHERE r.attempt_id=l.attempt_id))) ORDER BY j.admitted_us, j.id COLLATE \"C\" LIMIT $2")
            .bind(task_id).bind(PENDING_LIMIT).fetch_all(&mut *tx).await.map_err(unavailable)?;
        let mut records = Vec::new();
        for id in ids {
            records.push(read(&mut tx, &id).await?);
        }
        tx.commit().await.map_err(unavailable)?;
        Ok(records)
    }

    async fn append(
        &self,
        actor: &str,
        s: &Scope,
        job_id: &str,
        expected: u32,
        transition: &Transition,
    ) -> Result<JobRecord, AnalysisError> {
        if transition.status == JobStatus::Collected {
            return Err(AnalysisError::Invalid);
        }
        let mut tx = begin(&self.pool, actor, s).await?;
        lock_job(&mut tx, job_id).await?;
        let record = read(&mut tx, job_id).await?;
        if record.latest.sequence != expected || !transition.status.can_follow(record.latest.status)
        {
            return Err(AnalysisError::Conflict);
        }
        insert_fact(&mut tx, &record.job, expected + 1, transition, None).await?;
        let record = read(&mut tx, job_id).await?;
        tx.commit().await.map_err(unavailable)?;
        Ok(record)
    }

    async fn collect(
        &self,
        actor: &str,
        s: &Scope,
        job_id: &str,
        expected: u32,
        attempt_id: &str,
        descendants: &[Descendant],
        rejections: &[Rejection],
        receipt: &CollectionReceipt,
    ) -> Result<JobRecord, AnalysisError> {
        let mut tx = begin(&self.pool, actor, s).await?;
        lock_job(&mut tx, job_id).await?;
        let record = read(&mut tx, job_id).await?;
        if record.latest.sequence != expected
            || !record.latest.status.collectable()
            || record.latest.attempt_id.as_deref() != Some(attempt_id)
        {
            return Err(AnalysisError::Conflict);
        }
        let job = &record.job;
        let parents = Value::Array(
            job.request
                .inputs
                .iter()
                .map(|i| Value::String(i.original_id.clone()))
                .collect(),
        );
        for d in descendants {
            sqlx::query("INSERT INTO public.analysis_descendants(organisation_id,client_id,engagement_id,id,job_id,attempt_id,path,fold_key,parents,digest,size,media_type,namespace,version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)")
                .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id).bind(&d.id)
                .bind(job_id).bind(attempt_id).bind(&d.path).bind(&d.fold_key).bind(&parents)
                .bind(&d.identity.sha256).bind(d.identity.size as i64).bind(d.media_type)
                .bind(&d.namespace).bind(&d.version)
                .execute(&mut *tx).await.map_err(refusal)?;
        }
        for (ordinal, r) in rejections.iter().enumerate() {
            sqlx::query("INSERT INTO public.analysis_rejections(organisation_id,client_id,engagement_id,job_id,attempt_id,ordinal,path_sha256,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8)")
                .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id).bind(job_id)
                .bind(attempt_id).bind(ordinal as i32).bind(&r.path_sha256).bind(r.reason.as_str())
                .execute(&mut *tx).await.map_err(refusal)?;
        }
        let document = receipt_document(attempt_id, receipt);
        insert_fact(
            &mut tx,
            job,
            expected + 1,
            &Transition {
                status: JobStatus::Collected,
                attempt_id: Some(attempt_id.into()),
                reason: receipt.reason,
                exit_code: None,
            },
            Some(&document),
        )
        .await?;
        let record = read(&mut tx, job_id).await?;
        tx.commit().await.map_err(unavailable)?;
        Ok(record)
    }
}
