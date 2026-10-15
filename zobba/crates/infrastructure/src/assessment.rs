//! Story 24.1 assessment records. Every write runs under the exact claim
//! producer's custody and current Task authority; every record is an
//! immutable row (`assessment_guard`, `assessment_complete`,
//! `assessment_immutable`) holding its canonical document and SHA-256. An
//! identical retry returns the original; a different one is refused. Reads
//! verify each stored document against its digest and key columns.
use crate::{scope, task, work::producer};
use serde_json::Value;
use sqlx::{PgPool, Postgres, Row, Transaction, postgres::PgRow};
use zobba_application::{
    assessment::{
        AssessmentSnapshot, AssessmentStore, BasisRecord, CriterionRecord, EvaluationRecord,
        FactRecord, InvocationAssessment, JobState, MAX_BASIS_FACTS, MAX_OUTLINE_RECORDS,
        document_digest,
    },
    citation::ReadingError,
    task::TaskError,
};
use zobba_domain::{
    citation::Verification,
    identity::{Scope, valid_scope_id},
    model::JsonValue,
    task::ClaimBasis,
};

type Tx = Transaction<'static, Postgres>;
const ASSESSMENT_LOCK: i64 = 2_401;

#[derive(Clone)]
pub struct AssessmentRepository {
    pool: PgPool,
}
impl AssessmentRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

fn unavailable(_: sqlx::Error) -> ReadingError {
    ReadingError::Unavailable
}
fn refusal(error: sqlx::Error) -> ReadingError {
    match &error {
        sqlx::Error::Database(database)
            if matches!(
                database.code().as_deref(),
                Some("23514" | "23505" | "23503")
            ) =>
        {
            ReadingError::Invalid
        }
        _ => ReadingError::Unavailable,
    }
}
fn task_error(error: TaskError) -> ReadingError {
    match error {
        TaskError::Fenced => ReadingError::Fenced,
        TaskError::Denied => ReadingError::Denied,
        TaskError::Invalid => ReadingError::Invalid,
        _ => ReadingError::Unavailable,
    }
}
/// The claim's own transaction (organisation advisory 205, then the
/// engagement row, then the exact consumed claim producer) and a per-record
/// writer lock.
async fn claimed(pool: &PgPool, basis: &ClaimBasis, key: &str) -> Result<Tx, ReadingError> {
    let mut tx = task::lock(pool, &basis.actor_id, &basis.scope)
        .await
        .map_err(task_error)?;
    producer(&mut tx, basis).await.map_err(task_error)?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,$2))")
        .bind(key)
        .bind(ASSESSMENT_LOCK)
        .execute(&mut *tx)
        .await
        .map_err(unavailable)?;
    Ok(tx)
}
async fn scoped(pool: &PgPool, actor: &str, s: &Scope) -> Result<Tx, ReadingError> {
    if !valid_scope_id(actor) || !s.is_valid() {
        return Err(ReadingError::Denied);
    }
    scope::begin(pool, actor, s).await.map_err(|e| match e {
        scope::ScopeError::Denied => ReadingError::Denied,
        _ => ReadingError::Unavailable,
    })
}

fn to_json(value: &JsonValue) -> Value {
    match value {
        JsonValue::Null => Value::Null,
        JsonValue::Bool(b) => Value::Bool(*b),
        JsonValue::Integer(n) => Value::from(*n),
        JsonValue::String(s) => Value::String(s.clone()),
        JsonValue::Array(items) => Value::Array(items.iter().map(to_json).collect()),
        JsonValue::Object(map) => {
            Value::Object(map.iter().map(|(k, v)| (k.clone(), to_json(v))).collect())
        }
    }
}

/// The stored document, verified against its digest column.
fn document_of(row: &PgRow) -> Result<(JsonValue, i64), ReadingError> {
    let document: Value = row.try_get("document").map_err(unavailable)?;
    let digest: String = row.try_get("digest").map_err(unavailable)?;
    let created: i64 = row.try_get("created_us").map_err(unavailable)?;
    let document = crate::work::json_value(&document).ok_or(ReadingError::Unavailable)?;
    if document_digest(&document) != digest {
        return Err(ReadingError::Unavailable);
    }
    Ok((document, created))
}
fn criterion_from(row: &PgRow) -> Result<CriterionRecord, ReadingError> {
    let (document, created) = document_of(row)?;
    CriterionRecord::from_document(&document, Some(created)).ok_or(ReadingError::Unavailable)
}
fn basis_from(row: &PgRow) -> Result<BasisRecord, ReadingError> {
    let (document, created) = document_of(row)?;
    BasisRecord::from_document(&document, Some(created)).ok_or(ReadingError::Unavailable)
}
fn fact_from(row: &PgRow) -> Result<FactRecord, ReadingError> {
    let (document, created) = document_of(row)?;
    FactRecord::from_document(&document, Some(created)).ok_or(ReadingError::Unavailable)
}
fn evaluation_from(row: &PgRow) -> Result<EvaluationRecord, ReadingError> {
    let (document, created) = document_of(row)?;
    EvaluationRecord::from_document(&document, Some(created)).ok_or(ReadingError::Unavailable)
}

/// An identical retry returns the stored record; a different one is refused.
fn same<T: Clone + PartialEq>(
    stored: T,
    proposed: &T,
    strip: impl Fn(&T) -> T,
) -> Result<T, ReadingError> {
    if strip(&stored) == strip(proposed) {
        Ok(stored)
    } else {
        Err(ReadingError::Invalid)
    }
}

const COLUMNS: &str = "document,digest,created_us";

impl AssessmentStore for AssessmentRepository {
    async fn invocation_records(
        &self,
        basis: &ClaimBasis,
        invocation_id: &str,
    ) -> Result<InvocationAssessment, ReadingError> {
        if !valid_scope_id(invocation_id) {
            return Err(ReadingError::Invalid);
        }
        let mut tx = scoped(&self.pool, &basis.actor_id, &basis.scope).await?;
        // Bounded by construction: at most 8 criteria, 1 basis, 64 facts and
        // the per-answer evaluation bound.
        async fn rows(
            tx: &mut Tx,
            table: &str,
            task_id: &str,
            invocation_id: &str,
        ) -> Result<Vec<PgRow>, ReadingError> {
            sqlx::query(&format!("SELECT {COLUMNS} FROM public.{table} WHERE task_id=$1 AND invocation_id=$2 ORDER BY ordinal"))
                .bind(task_id)
                .bind(invocation_id)
                .fetch_all(&mut **tx)
                .await
                .map_err(unavailable)
        }
        let task_id = basis.task_id.as_str();
        let criteria = rows(&mut tx, "assessment_criteria", task_id, invocation_id)
            .await?
            .iter()
            .map(criterion_from)
            .collect::<Result<_, _>>()?;
        let bases = rows(&mut tx, "assessment_bases", task_id, invocation_id)
            .await?
            .iter()
            .map(basis_from)
            .collect::<Result<_, _>>()?;
        let facts = rows(&mut tx, "assessment_facts", task_id, invocation_id)
            .await?
            .iter()
            .map(fact_from)
            .collect::<Result<_, _>>()?;
        let evaluations = rows(&mut tx, "assessment_evaluations", task_id, invocation_id)
            .await?
            .iter()
            .map(evaluation_from)
            .collect::<Result<_, _>>()?;
        tx.commit().await.map_err(unavailable)?;
        Ok(InvocationAssessment {
            criteria,
            bases,
            facts,
            evaluations,
        })
    }
    async fn criteria(
        &self,
        basis: &ClaimBasis,
        ids: &[String],
    ) -> Result<Vec<CriterionRecord>, ReadingError> {
        let ids: Vec<&String> = ids.iter().filter(|id| valid_scope_id(id)).collect();
        if ids.is_empty() {
            return Ok(vec![]);
        }
        let mut tx = scoped(&self.pool, &basis.actor_id, &basis.scope).await?;
        let found = sqlx::query("SELECT document,digest,created_us FROM public.assessment_criteria WHERE task_id=$1 AND id = ANY($2) ORDER BY created_us,id COLLATE \"C\"")
            .bind(&basis.task_id)
            .bind(&ids)
            .fetch_all(&mut *tx)
            .await
            .map_err(unavailable)?
            .iter()
            .map(criterion_from)
            .collect::<Result<_, _>>()?;
        tx.commit().await.map_err(unavailable)?;
        Ok(found)
    }
    async fn basis_record(
        &self,
        basis: &ClaimBasis,
        id: &str,
    ) -> Result<Option<BasisRecord>, ReadingError> {
        if !valid_scope_id(id) {
            return Ok(None);
        }
        let mut tx = scoped(&self.pool, &basis.actor_id, &basis.scope).await?;
        let found = sqlx::query("SELECT document,digest,created_us FROM public.assessment_bases WHERE task_id=$1 AND id=$2")
            .bind(&basis.task_id)
            .bind(id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(unavailable)?
            .as_ref()
            .map(basis_from)
            .transpose()?;
        tx.commit().await.map_err(unavailable)?;
        Ok(found)
    }
    async fn latest_basis_with(
        &self,
        basis: &ClaimBasis,
        criterion_id: &str,
    ) -> Result<Option<BasisRecord>, ReadingError> {
        let mut tx = scoped(&self.pool, &basis.actor_id, &basis.scope).await?;
        let found = sqlx::query("SELECT b.document,b.digest,b.created_us FROM public.assessment_bases b JOIN public.assessment_basis_criteria k ON (k.organisation_id,k.client_id,k.engagement_id,k.basis_id)=(b.organisation_id,b.client_id,b.engagement_id,b.id) WHERE b.task_id=$1 AND k.criterion_id=$2 ORDER BY b.created_us DESC,b.id COLLATE \"C\" DESC LIMIT 1")
            .bind(&basis.task_id)
            .bind(criterion_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(unavailable)?
            .as_ref()
            .map(basis_from)
            .transpose()?;
        tx.commit().await.map_err(unavailable)?;
        Ok(found)
    }
    async fn facts(
        &self,
        basis: &ClaimBasis,
        basis_id: &str,
    ) -> Result<Vec<FactRecord>, ReadingError> {
        let mut tx = scoped(&self.pool, &basis.actor_id, &basis.scope).await?;
        let rows = sqlx::query("SELECT document,digest,created_us FROM public.assessment_facts WHERE task_id=$1 AND basis_id=$2 ORDER BY subject COLLATE \"C\",name COLLATE \"C\" LIMIT $3")
            .bind(&basis.task_id)
            .bind(basis_id)
            .bind(MAX_BASIS_FACTS as i64 + 1)
            .fetch_all(&mut *tx)
            .await
            .map_err(unavailable)?;
        // An exact read: more facts than a basis may hold is never a cut list.
        if rows.len() > MAX_BASIS_FACTS {
            return Err(ReadingError::Capacity);
        }
        let facts = rows.iter().map(fact_from).collect::<Result<_, _>>()?;
        tx.commit().await.map_err(unavailable)?;
        Ok(facts)
    }
    async fn evaluation(
        &self,
        basis: &ClaimBasis,
        basis_id: &str,
        criterion_id: &str,
        subject: &str,
    ) -> Result<Option<EvaluationRecord>, ReadingError> {
        let mut tx = scoped(&self.pool, &basis.actor_id, &basis.scope).await?;
        let found = sqlx::query("SELECT document,digest,created_us FROM public.assessment_evaluations WHERE task_id=$1 AND basis_id=$2 AND criterion_id=$3 AND subject=$4")
            .bind(&basis.task_id)
            .bind(basis_id)
            .bind(criterion_id)
            .bind(subject)
            .fetch_optional(&mut *tx)
            .await
            .map_err(unavailable)?
            .as_ref()
            .map(evaluation_from)
            .transpose()?;
        tx.commit().await.map_err(unavailable)?;
        Ok(found)
    }
    async fn job_state(
        &self,
        basis: &ClaimBasis,
        job_id: &str,
    ) -> Result<Option<JobState>, ReadingError> {
        if !valid_scope_id(job_id) {
            return Ok(None);
        }
        let mut tx = scoped(&self.pool, &basis.actor_id, &basis.scope).await?;
        // The same definition as the database guard: the job's latest event
        // that is not a collection (a `collected` event repeats the outcome
        // before it).
        let latest: Option<Option<String>> = sqlx::query_scalar("SELECT (SELECT e.status FROM public.analysis_job_events e WHERE e.job_id=j.id AND e.status<>'collected' ORDER BY e.sequence DESC LIMIT 1) FROM public.analysis_jobs j WHERE j.id=$1 AND j.task_id=$2")
            .bind(job_id)
            .bind(&basis.task_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(unavailable)?;
        tx.commit().await.map_err(unavailable)?;
        Ok(latest.map(|status| match status.as_deref() {
            Some("completed") => JobState::Completed,
            Some("failed" | "limit_exceeded" | "stopped") => JobState::Failed,
            _ => JobState::Pending,
        }))
    }
    async fn evaluations_of(
        &self,
        basis: &ClaimBasis,
        basis_id: &str,
        criterion_id: &str,
    ) -> Result<Vec<EvaluationRecord>, ReadingError> {
        let mut tx = scoped(&self.pool, &basis.actor_id, &basis.scope).await?;
        let rows = sqlx::query("SELECT document,digest,created_us FROM public.assessment_evaluations WHERE task_id=$1 AND basis_id=$2 AND criterion_id=$3 ORDER BY subject COLLATE \"C\" LIMIT $4")
            .bind(&basis.task_id)
            .bind(basis_id)
            .bind(criterion_id)
            .bind(MAX_BASIS_FACTS as i64 + 1)
            .fetch_all(&mut *tx)
            .await
            .map_err(unavailable)?;
        // One per subject, and a basis holds at most MAX_BASIS_FACTS facts.
        if rows.len() > MAX_BASIS_FACTS {
            return Err(ReadingError::Capacity);
        }
        let found = rows.iter().map(evaluation_from).collect::<Result<_, _>>()?;
        tx.commit().await.map_err(unavailable)?;
        Ok(found)
    }
    async fn record_criterion(
        &self,
        basis: &ClaimBasis,
        record: &CriterionRecord,
    ) -> Result<CriterionRecord, ReadingError> {
        if record.task_id != basis.task_id || record.cycle_id != basis.cycle_id {
            return Err(ReadingError::Invalid);
        }
        let document = record.document();
        let mut tx = claimed(&self.pool, basis, &format!("assessment:{}", record.id)).await?;
        let select =
            "SELECT document,digest,created_us FROM public.assessment_criteria WHERE id=$1";
        if let Some(row) = sqlx::query(select)
            .bind(&record.id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(unavailable)?
        {
            let stored = criterion_from(&row)?;
            tx.commit().await.map_err(unavailable)?;
            return same(stored, record, |r| CriterionRecord {
                recorded_us: None,
                ..r.clone()
            });
        }
        let s = &basis.scope;
        sqlx::query("INSERT INTO public.assessment_criteria(organisation_id,client_id,engagement_id,task_id,cycle_id,actor_id,invocation_id,ordinal,id,methodology_binding_id,execution_epoch,kind,authority_kind,authority_verified,authority_reason,supersedes,document,digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)")
            .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id)
            .bind(&record.task_id).bind(&record.cycle_id).bind(&basis.actor_id)
            .bind(&record.invocation_id).bind(record.ordinal as i32).bind(&record.id)
            .bind(&record.methodology_binding_id).bind(record.execution_epoch as i64)
            .bind(record.criterion.method.kind().as_str())
            .bind(record.criterion.authority.kind().as_str())
            .bind(record.authority.verified)
            .bind(record.authority.reason.map(|r| r.as_str()))
            .bind(&record.criterion.supersedes)
            .bind(to_json(&document)).bind(document_digest(&document))
            .execute(&mut *tx).await.map_err(refusal)?;
        let row = sqlx::query(select)
            .bind(&record.id)
            .fetch_one(&mut *tx)
            .await
            .map_err(unavailable)?;
        let stored = criterion_from(&row)?;
        task::admission_fence(&mut tx, &basis.actor_id, s, None)
            .await
            .map_err(task_error)?;
        tx.commit().await.map_err(unavailable)?;
        Ok(stored)
    }
    async fn record_basis(
        &self,
        basis: &ClaimBasis,
        record: &BasisRecord,
    ) -> Result<BasisRecord, ReadingError> {
        if record.task_id != basis.task_id || record.cycle_id != basis.cycle_id {
            return Err(ReadingError::Invalid);
        }
        let document = record.document();
        let mut tx = claimed(&self.pool, basis, &format!("assessment:{}", record.id)).await?;
        let select = "SELECT document,digest,created_us FROM public.assessment_bases WHERE id=$1";
        if let Some(row) = sqlx::query(select)
            .bind(&record.id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(unavailable)?
        {
            let stored = basis_from(&row)?;
            tx.commit().await.map_err(unavailable)?;
            return same(stored, record, |r| BasisRecord {
                recorded_us: None,
                ..r.clone()
            });
        }
        let s = &basis.scope;
        let b = &record.basis;
        sqlx::query("INSERT INTO public.assessment_bases(organisation_id,client_id,engagement_id,task_id,cycle_id,actor_id,invocation_id,ordinal,id,methodology_binding_id,execution_epoch,period_from,period_to,supersedes,document,digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::date,$13::date,$14,$15,$16)")
            .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id)
            .bind(&record.task_id).bind(&record.cycle_id).bind(&basis.actor_id)
            .bind(&record.invocation_id).bind(record.ordinal as i32).bind(&record.id)
            .bind(&record.methodology_binding_id).bind(record.execution_epoch as i64)
            .bind(b.period_from.render()).bind(b.period_to.render()).bind(&b.supersedes)
            .bind(to_json(&document)).bind(document_digest(&document))
            .execute(&mut *tx).await.map_err(refusal)?;
        for (ordinal, criterion) in b.criteria.iter().enumerate() {
            sqlx::query("INSERT INTO public.assessment_basis_criteria(organisation_id,client_id,engagement_id,task_id,actor_id,basis_id,ordinal,criterion_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)")
                .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id)
                .bind(&record.task_id).bind(&basis.actor_id).bind(&record.id)
                .bind(ordinal as i32).bind(criterion)
                .execute(&mut *tx).await.map_err(refusal)?;
        }
        let row = sqlx::query(select)
            .bind(&record.id)
            .fetch_one(&mut *tx)
            .await
            .map_err(unavailable)?;
        let stored = basis_from(&row)?;
        task::admission_fence(&mut tx, &basis.actor_id, s, None)
            .await
            .map_err(task_error)?;
        tx.commit().await.map_err(refusal)?;
        Ok(stored)
    }
    async fn record_fact(
        &self,
        basis: &ClaimBasis,
        record: &FactRecord,
    ) -> Result<FactRecord, ReadingError> {
        if record.task_id != basis.task_id
            || record.cycle_id != basis.cycle_id
            || record.sources.len() != record.fact.sources.len()
        {
            return Err(ReadingError::Invalid);
        }
        let document = record.document();
        let mut tx = claimed(&self.pool, basis, &format!("assessment:{}", record.id)).await?;
        let select = "SELECT document,digest,created_us FROM public.assessment_facts WHERE id=$1";
        if let Some(row) = sqlx::query(select)
            .bind(&record.id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(unavailable)?
        {
            let stored = fact_from(&row)?;
            tx.commit().await.map_err(unavailable)?;
            return same(stored, record, |r| FactRecord {
                recorded_us: None,
                ..r.clone()
            });
        }
        let s = &basis.scope;
        let f = &record.fact;
        let value_kind = match &f.state {
            zobba_domain::assessment::FactState::Value(value) => value.kind().as_str(),
            zobba_domain::assessment::FactState::Unavailable(_) => "unavailable",
            zobba_domain::assessment::FactState::Ambiguous { .. } => "ambiguous",
        };
        sqlx::query("INSERT INTO public.assessment_facts(organisation_id,client_id,engagement_id,task_id,cycle_id,actor_id,invocation_id,ordinal,id,methodology_binding_id,execution_epoch,basis_id,subject,subject_unit,name,value_kind,support,support_reason,rule,job_id,subject_grounded,measure_grounded,document,digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)")
            .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id)
            .bind(&record.task_id).bind(&record.cycle_id).bind(&basis.actor_id)
            .bind(&record.invocation_id).bind(record.ordinal as i32).bind(&record.id)
            .bind(&record.methodology_binding_id).bind(record.execution_epoch as i64)
            .bind(&record.basis_id).bind(&f.subject).bind(&f.subject_unit).bind(&f.name)
            .bind(value_kind).bind(record.support.as_str())
            .bind(record.support.reason().map(|r| r.as_str()))
            .bind(f.rule.map(|r| r.as_str())).bind(&f.job_id)
            .bind(record.grounding.subject).bind(record.grounding.measure)
            .bind(to_json(&document)).bind(document_digest(&document))
            .execute(&mut *tx).await.map_err(refusal)?;
        for (ordinal, source) in record.sources.iter().enumerate() {
            sqlx::query("INSERT INTO public.assessment_fact_sources(organisation_id,client_id,engagement_id,task_id,actor_id,fact_id,ordinal,original_id,locator,quote,original_sha256,verification,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)")
                .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id)
                .bind(&record.task_id).bind(&basis.actor_id).bind(&record.id)
                .bind(ordinal as i32).bind(&source.source.original_id)
                .bind(source.source.locator.as_ref().map(|l| l.render()))
                .bind(&source.source.quote).bind(&source.original_sha256)
                .bind(match source.verification {
                    Verification::Verified => "verified",
                    Verification::Unverified(_) => "unverified",
                })
                .bind(source.verification.reason().map(|r| r.as_str()))
                .execute(&mut *tx).await.map_err(refusal)?;
        }
        let row = sqlx::query(select)
            .bind(&record.id)
            .fetch_one(&mut *tx)
            .await
            .map_err(unavailable)?;
        let stored = fact_from(&row)?;
        task::admission_fence(&mut tx, &basis.actor_id, s, None)
            .await
            .map_err(task_error)?;
        // The deferred completeness check runs here.
        tx.commit().await.map_err(refusal)?;
        Ok(stored)
    }
    async fn record_evaluation(
        &self,
        basis: &ClaimBasis,
        record: &EvaluationRecord,
    ) -> Result<EvaluationRecord, ReadingError> {
        if record.task_id != basis.task_id
            || record.cycle_id != basis.cycle_id
            || !record.outcome.is_valid()
            || record.output_digest != record.computed_digest()
        {
            return Err(ReadingError::Invalid);
        }
        let document = record.document();
        let mut tx = claimed(&self.pool, basis, &format!("assessment:{}", record.id)).await?;
        let select =
            "SELECT document,digest,created_us FROM public.assessment_evaluations WHERE id=$1";
        if let Some(row) = sqlx::query(select)
            .bind(&record.id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(unavailable)?
        {
            let stored = evaluation_from(&row)?;
            tx.commit().await.map_err(unavailable)?;
            return same(stored, record, |r| EvaluationRecord {
                recorded_us: None,
                ..r.clone()
            });
        }
        let s = &basis.scope;
        let o = &record.outcome;
        sqlx::query("INSERT INTO public.assessment_evaluations(organisation_id,client_id,engagement_id,task_id,cycle_id,actor_id,invocation_id,ordinal,id,methodology_binding_id,execution_epoch,basis_id,criterion_id,subject,applicability,execution,verdict,reason,origin,document,output_digest,digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)")
            .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id)
            .bind(&record.task_id).bind(&record.cycle_id).bind(&basis.actor_id)
            .bind(&record.invocation_id).bind(record.ordinal as i32).bind(&record.id)
            .bind(&record.methodology_binding_id).bind(record.execution_epoch as i64)
            .bind(&record.basis_id).bind(&record.criterion_id).bind(&record.subject)
            .bind(o.applicability.as_str()).bind(o.execution.as_str())
            .bind(o.verdict.map(|v| v.as_str())).bind(o.reason.map(|r| r.as_str()))
            .bind(o.origin.as_str())
            .bind(to_json(&document)).bind(&record.output_digest).bind(document_digest(&document))
            .execute(&mut *tx).await.map_err(refusal)?;
        let row = sqlx::query(select)
            .bind(&record.id)
            .fetch_one(&mut *tx)
            .await
            .map_err(unavailable)?;
        let stored = evaluation_from(&row)?;
        task::admission_fence(&mut tx, &basis.actor_id, s, None)
            .await
            .map_err(task_error)?;
        tx.commit().await.map_err(unavailable)?;
        Ok(stored)
    }
    async fn snapshot(&self, basis: &ClaimBasis) -> Result<AssessmentSnapshot, ReadingError> {
        let mut tx = scoped(&self.pool, &basis.actor_id, &basis.scope).await?;
        let snapshot = snapshot(&mut tx, &basis.task_id).await?;
        tx.commit().await.map_err(unavailable)?;
        Ok(snapshot)
    }
}

/// The Task's newest records of each kind (bounded), oldest first, and the
/// exact totals.
async fn snapshot(tx: &mut Tx, task_id: &str) -> Result<AssessmentSnapshot, ReadingError> {
    async fn newest(
        tx: &mut Tx,
        table: &'static str,
        task_id: &str,
        limit: usize,
    ) -> Result<(Vec<PgRow>, u64), ReadingError> {
        let rows = sqlx::query(&format!("SELECT * FROM (SELECT document,digest,created_us,id FROM public.{table} WHERE task_id=$1 ORDER BY created_us DESC,id COLLATE \"C\" DESC LIMIT $2) r ORDER BY created_us,id COLLATE \"C\""))
            .bind(task_id)
            .bind(limit as i64)
            .fetch_all(&mut **tx)
            .await
            .map_err(unavailable)?;
        let total: i64 = sqlx::query_scalar(&format!(
            "SELECT count(*) FROM public.{table} WHERE task_id=$1"
        ))
        .bind(task_id)
        .fetch_one(&mut **tx)
        .await
        .map_err(unavailable)?;
        Ok((rows, total as u64))
    }
    let (bases, total_bases) = newest(tx, "assessment_bases", task_id, MAX_OUTLINE_RECORDS).await?;
    let (criteria, total_criteria) =
        newest(tx, "assessment_criteria", task_id, MAX_OUTLINE_RECORDS).await?;
    let (facts, total_facts) = newest(tx, "assessment_facts", task_id, MAX_BASIS_FACTS).await?;
    let (evaluations, total_evaluations) = newest(
        tx,
        "assessment_evaluations",
        task_id,
        MAX_OUTLINE_RECORDS * 4,
    )
    .await?;
    let bases: Vec<BasisRecord> = bases.iter().map(basis_from).collect::<Result<_, _>>()?;
    // Exact fact counts of the listed bases, never counted from a sample.
    let ids: Vec<&String> = bases.iter().map(|b| &b.id).collect();
    let counts: Vec<(String, i64)> = sqlx::query_as("SELECT basis_id,count(*) FROM public.assessment_facts WHERE task_id=$1 AND basis_id = ANY($2) GROUP BY basis_id")
        .bind(task_id)
        .bind(&ids)
        .fetch_all(&mut **tx)
        .await
        .map_err(unavailable)?;
    Ok(AssessmentSnapshot {
        bases,
        basis_fact_counts: counts
            .into_iter()
            .map(|(id, count)| (id, count as u64))
            .collect(),
        criteria: criteria
            .iter()
            .map(criterion_from)
            .collect::<Result<_, _>>()?,
        facts: facts.iter().map(fact_from).collect::<Result<_, _>>()?,
        evaluations: evaluations
            .iter()
            .map(evaluation_from)
            .collect::<Result<_, _>>()?,
        total_bases,
        total_criteria,
        total_facts,
        total_evaluations,
    })
}

impl AssessmentRepository {
    /// Viewer read (current audit scope by RLS): the Task's recent assessment
    /// records. Source quotes are returned to the API, which withholds them
    /// for an original the viewer cannot read.
    pub async fn view(
        &self,
        actor: &str,
        s: &Scope,
        task_id: &str,
    ) -> Result<AssessmentSnapshot, TaskError> {
        if !valid_scope_id(task_id) {
            return Err(TaskError::Denied);
        }
        let mut tx = scoped(&self.pool, actor, s).await.map_err(|e| match e {
            ReadingError::Denied | ReadingError::Fenced => TaskError::Denied,
            _ => TaskError::Unavailable,
        })?;
        let exists: Option<String> = sqlx::query_scalar("SELECT id FROM public.tasks WHERE id=$1")
            .bind(task_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|_| TaskError::Unavailable)?;
        if exists.is_none() {
            return Err(TaskError::Denied);
        }
        let snapshot = snapshot(&mut tx, task_id)
            .await
            .map_err(|_| TaskError::Unavailable)?;
        task::admission_fence(&mut tx, actor, s, None).await?;
        tx.commit().await.map_err(|_| TaskError::Unavailable)?;
        Ok(snapshot)
    }
}

// ------------------------------------------------------------- Story 24.2

use zobba_application::assessment::coverage::{
    CoverageSnapshot, CoverageStore, InvocationCoverage, MAX_OUTLINE_COVERAGE, MemberRecord,
    OpportunityRecord, PopulationRecord, SampleRecord, SummaryRecord,
};
use zobba_domain::{
    assessment::{Applicability, EvaluationReason, Execution, Origin, Outcome, Verdict},
    coverage::{Disposition, MAX_POPULATION_ROWS},
};

/// Rows one INSERT statement carries (members, opportunities, selections).
const BATCH: usize = 1_000;

fn population_from(row: &PgRow) -> Result<PopulationRecord, ReadingError> {
    let (document, created) = document_of(row)?;
    PopulationRecord::from_document(&document, Some(created)).ok_or(ReadingError::Unavailable)
}
fn summary_from(row: &PgRow) -> Result<SummaryRecord, ReadingError> {
    let (document, created) = document_of(row)?;
    SummaryRecord::from_document(&document, Some(created)).ok_or(ReadingError::Unavailable)
}

/// One population's members, verified against their digests and the
/// population's own received-row count (an exact read, never a cut list).
async fn members_of(
    tx: &mut Tx,
    population: &PopulationRecord,
) -> Result<Vec<MemberRecord>, ReadingError> {
    let rows = sqlx::query("SELECT document,digest,ordinal FROM public.assessment_population_members WHERE population_id=$1 ORDER BY ordinal LIMIT $2")
        .bind(&population.id)
        .bind(i64::from(MAX_POPULATION_ROWS) + 1)
        .fetch_all(&mut **tx)
        .await
        .map_err(unavailable)?;
    if rows.len() as u64 != population.counts.received_rows {
        return Err(ReadingError::Unavailable);
    }
    rows.iter()
        .enumerate()
        .map(|(i, row)| {
            let document: Value = row.try_get("document").map_err(unavailable)?;
            let digest: String = row.try_get("digest").map_err(unavailable)?;
            let document = crate::work::json_value(&document).ok_or(ReadingError::Unavailable)?;
            let record = MemberRecord::from_document(&document, &population.population)
                .ok_or(ReadingError::Unavailable)?;
            if record.digest != digest
                || record.member.ordinal as usize != i
                || record.population_id != population.id
            {
                return Err(ReadingError::Unavailable);
            }
            Ok(record)
        })
        .collect()
}

/// A sample with its selected subjects (in their stored order).
async fn sample_of(tx: &mut Tx, row: &PgRow) -> Result<SampleRecord, ReadingError> {
    let (document, created) = document_of(row)?;
    let id: String = row.try_get("id").map_err(unavailable)?;
    let selected: Vec<String> = sqlx::query_scalar("SELECT subject FROM public.assessment_sample_members WHERE sample_id=$1 ORDER BY ordinal LIMIT $2")
        .bind(&id)
        .bind(i64::from(MAX_POPULATION_ROWS) + 1)
        .fetch_all(&mut **tx)
        .await
        .map_err(unavailable)?;
    SampleRecord::from_document(&document, selected, Some(created)).ok_or(ReadingError::Unavailable)
}

fn opportunity_from(row: &PgRow) -> Result<OpportunityRecord, ReadingError> {
    let text =
        |name: &str| -> Result<String, ReadingError> { row.try_get(name).map_err(unavailable) };
    let maybe = |name: &str| -> Result<Option<String>, ReadingError> {
        row.try_get(name).map_err(unavailable)
    };
    let inputs: Value = row.try_get("inputs").map_err(unavailable)?;
    let inputs = inputs
        .as_array()
        .ok_or(ReadingError::Unavailable)?
        .iter()
        .map(|i| {
            Some((
                i.get("id")?.as_str()?.to_string(),
                i.get("digest")?.as_str()?.to_string(),
            ))
        })
        .collect::<Option<Vec<_>>>()
        .ok_or(ReadingError::Unavailable)?;
    let ordinal: i32 = row.try_get("member_ordinal").map_err(unavailable)?;
    let record = OpportunityRecord {
        population_id: text("population_id")?,
        criterion_id: text("criterion_id")?,
        member_ordinal: u32::try_from(ordinal).map_err(|_| ReadingError::Unavailable)?,
        subject: text("subject")?,
        invocation_id: text("invocation_id")?,
        outcome: Outcome {
            applicability: Applicability::parse(&text("applicability")?)
                .ok_or(ReadingError::Unavailable)?,
            execution: Execution::parse(&text("execution")?).ok_or(ReadingError::Unavailable)?,
            verdict: match maybe("verdict")? {
                Some(v) => Some(Verdict::parse(&v).ok_or(ReadingError::Unavailable)?),
                None => None,
            },
            reason: match maybe("reason")? {
                Some(r) => Some(EvaluationReason::parse(&r).ok_or(ReadingError::Unavailable)?),
                None => None,
            },
            origin: Origin::parse(&text("origin")?).ok_or(ReadingError::Unavailable)?,
            inputs,
        },
        output_digest: text("output_digest")?,
        evaluation_id: maybe("evaluation_id")?,
    };
    // A rule opportunity's digest is recomputed from its own fields.
    if !record.outcome.is_valid()
        || (record.evaluation_id.is_none() && record.output_digest != record.computed_digest())
    {
        return Err(ReadingError::Unavailable);
    }
    Ok(record)
}
const OPPORTUNITY_COLUMNS: &str = "population_id,criterion_id,member_ordinal,subject,invocation_id,applicability,execution,verdict,reason,origin,output_digest,evaluation_id,inputs";

async fn opportunities_of(
    tx: &mut Tx,
    task_id: &str,
    population_id: &str,
    criterion_id: &str,
) -> Result<Vec<OpportunityRecord>, ReadingError> {
    let rows = sqlx::query(&format!("SELECT {OPPORTUNITY_COLUMNS} FROM public.assessment_opportunities WHERE task_id=$1 AND population_id=$2 AND criterion_id=$3 ORDER BY member_ordinal LIMIT $4"))
        .bind(task_id)
        .bind(population_id)
        .bind(criterion_id)
        .bind(i64::from(MAX_POPULATION_ROWS) + 1)
        .fetch_all(&mut **tx)
        .await
        .map_err(unavailable)?;
    if rows.len() > MAX_POPULATION_ROWS as usize {
        return Err(ReadingError::Capacity);
    }
    rows.iter().map(opportunity_from).collect()
}

impl CoverageStore for AssessmentRepository {
    async fn invocation_coverage(
        &self,
        basis: &ClaimBasis,
        invocation_id: &str,
    ) -> Result<InvocationCoverage, ReadingError> {
        if !valid_scope_id(invocation_id) {
            return Err(ReadingError::Invalid);
        }
        let mut tx = scoped(&self.pool, &basis.actor_id, &basis.scope).await?;
        let task_id = basis.task_id.as_str();
        let populations = sqlx::query("SELECT document,digest,created_us FROM public.assessment_populations WHERE task_id=$1 AND invocation_id=$2 ORDER BY ordinal")
            .bind(task_id).bind(invocation_id).fetch_all(&mut *tx).await.map_err(unavailable)?
            .iter().map(population_from).collect::<Result<_, _>>()?;
        let sample_rows = sqlx::query("SELECT document,digest,created_us,id FROM public.assessment_samples WHERE task_id=$1 AND invocation_id=$2 ORDER BY ordinal")
            .bind(task_id).bind(invocation_id).fetch_all(&mut *tx).await.map_err(unavailable)?;
        let mut samples = Vec::new();
        for row in &sample_rows {
            samples.push(sample_of(&mut tx, row).await?);
        }
        let summaries = sqlx::query("SELECT document,digest,created_us FROM public.assessment_summaries WHERE task_id=$1 AND invocation_id=$2 ORDER BY ordinal")
            .bind(task_id).bind(invocation_id).fetch_all(&mut *tx).await.map_err(unavailable)?
            .iter().map(summary_from).collect::<Result<_, _>>()?;
        tx.commit().await.map_err(unavailable)?;
        Ok(InvocationCoverage {
            populations,
            samples,
            summaries,
        })
    }
    async fn population(
        &self,
        basis: &ClaimBasis,
        id: &str,
    ) -> Result<Option<PopulationRecord>, ReadingError> {
        if !valid_scope_id(id) {
            return Ok(None);
        }
        let mut tx = scoped(&self.pool, &basis.actor_id, &basis.scope).await?;
        let found = sqlx::query("SELECT document,digest,created_us FROM public.assessment_populations WHERE task_id=$1 AND id=$2")
            .bind(&basis.task_id).bind(id).fetch_optional(&mut *tx).await.map_err(unavailable)?
            .as_ref().map(population_from).transpose()?;
        tx.commit().await.map_err(unavailable)?;
        Ok(found)
    }
    async fn members(
        &self,
        basis: &ClaimBasis,
        population_id: &str,
    ) -> Result<Vec<MemberRecord>, ReadingError> {
        let mut tx = scoped(&self.pool, &basis.actor_id, &basis.scope).await?;
        let Some(population) = sqlx::query("SELECT document,digest,created_us FROM public.assessment_populations WHERE task_id=$1 AND id=$2")
            .bind(&basis.task_id).bind(population_id).fetch_optional(&mut *tx).await.map_err(unavailable)?
            .as_ref().map(population_from).transpose()?
        else {
            return Ok(vec![]);
        };
        let members = members_of(&mut tx, &population).await?;
        tx.commit().await.map_err(unavailable)?;
        Ok(members)
    }
    async fn record_population(
        &self,
        basis: &ClaimBasis,
        record: &PopulationRecord,
        members: &[MemberRecord],
    ) -> Result<PopulationRecord, ReadingError> {
        if record.task_id != basis.task_id
            || record.cycle_id != basis.cycle_id
            || members.len() as u64 != record.counts.received_rows
            || members.iter().any(|m| m.population_id != record.id)
        {
            return Err(ReadingError::Invalid);
        }
        let document = record.document();
        let mut tx = claimed(&self.pool, basis, &format!("assessment:{}", record.id)).await?;
        let select =
            "SELECT document,digest,created_us FROM public.assessment_populations WHERE id=$1";
        if let Some(row) = sqlx::query(select)
            .bind(&record.id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(unavailable)?
        {
            let stored = population_from(&row)?;
            tx.commit().await.map_err(unavailable)?;
            return same(stored, record, |r| PopulationRecord {
                recorded_us: None,
                ..r.clone()
            });
        }
        let s = &basis.scope;
        let c = &record.counts;
        let p = &record.population;
        sqlx::query("INSERT INTO public.assessment_populations(organisation_id,client_id,engagement_id,task_id,cycle_id,actor_id,invocation_id,ordinal,id,methodology_binding_id,execution_epoch,basis_id,supersedes,original_id,original_sha256,subject_unit,exhaustive,truncated,header_row,last_row,rows_read,declared_count,job_id,received_rows,unkeyed,duplicate_rows,distinct_subjects,excluded_out_of_period,scope_unknown_period_unparsed,scope_unknown_period_missing,scope_unknown_conflicting_duplicate,in_scope,completeness,completeness_reason,reconciliation,document,digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37)")
            .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id)
            .bind(&record.task_id).bind(&record.cycle_id).bind(&basis.actor_id)
            .bind(&record.invocation_id).bind(record.ordinal as i32).bind(&record.id)
            .bind(&record.methodology_binding_id).bind(record.execution_epoch as i64)
            .bind(&record.basis_id).bind(&p.supersedes).bind(&p.original_id).bind(&record.original_sha256)
            .bind(&p.subject_unit).bind(p.exhaustive).bind(record.truncated)
            .bind(p.header_row as i32).bind(record.last_row as i32).bind(record.rows_read as i32)
            .bind(record.declared_count.map(|n| n as i64)).bind(&record.job_id)
            .bind(c.received_rows as i32).bind(c.unkeyed as i32).bind(c.duplicate_rows as i32)
            .bind(c.distinct_subjects as i32).bind(c.excluded_out_of_period as i32)
            .bind(c.scope_unknown_period_unparsed as i32).bind(c.scope_unknown_period_missing as i32)
            .bind(c.scope_unknown_conflicting_duplicate as i32).bind(c.in_scope as i32)
            .bind(record.completeness.as_str()).bind(record.completeness.reason().map(|r| r.as_str()))
            .bind(record.reconciliation.as_str())
            .bind(to_json(&document)).bind(document_digest(&document))
            .execute(&mut *tx).await.map_err(refusal)?;
        for chunk in members.chunks(BATCH) {
            let ordinal: Vec<i32> = chunk.iter().map(|m| m.member.ordinal as i32).collect();
            let row: Vec<i32> = chunk.iter().map(|m| m.member.row as i32).collect();
            let subject: Vec<Option<String>> =
                chunk.iter().map(|m| m.member.subject.clone()).collect();
            let disposition: Vec<&str> = chunk
                .iter()
                .map(|m| m.member.disposition.kind().as_str())
                .collect();
            let reason: Vec<Option<&str>> = chunk
                .iter()
                .map(|m| m.member.disposition.reason().map(|r| r.as_str()))
                .collect();
            let duplicate: Vec<Option<i32>> = chunk
                .iter()
                .map(|m| m.member.disposition.duplicate_of().map(|d| d as i32))
                .collect();
            let documents: Vec<String> = chunk
                .iter()
                .map(|m| zobba_domain::context::canonical_json(&m.document(p)))
                .collect();
            let digests: Vec<&str> = chunk.iter().map(|m| m.digest.as_str()).collect();
            sqlx::query("INSERT INTO public.assessment_population_members(organisation_id,client_id,engagement_id,task_id,actor_id,population_id,ordinal,row_number,subject,disposition,reason,duplicate_of,document,digest) SELECT $1,$2,$3,$4,$5,$6,o,r,s,d,x,u,j::jsonb,g FROM unnest($7::int[],$8::int[],$9::text[],$10::text[],$11::text[],$12::int[],$13::text[],$14::text[]) AS t(o,r,s,d,x,u,j,g) ORDER BY o")
                .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id)
                .bind(&record.task_id).bind(&basis.actor_id).bind(&record.id)
                .bind(&ordinal).bind(&row).bind(&subject).bind(&disposition).bind(&reason).bind(&duplicate)
                .bind(&documents).bind(&digests)
                .execute(&mut *tx).await.map_err(refusal)?;
        }
        let row = sqlx::query(select)
            .bind(&record.id)
            .fetch_one(&mut *tx)
            .await
            .map_err(unavailable)?;
        let stored = population_from(&row)?;
        task::admission_fence(&mut tx, &basis.actor_id, s, None)
            .await
            .map_err(task_error)?;
        // The deferred member recount runs here.
        tx.commit().await.map_err(refusal)?;
        Ok(stored)
    }
    async fn sample(
        &self,
        basis: &ClaimBasis,
        id: &str,
    ) -> Result<Option<SampleRecord>, ReadingError> {
        if !valid_scope_id(id) {
            return Ok(None);
        }
        let mut tx = scoped(&self.pool, &basis.actor_id, &basis.scope).await?;
        let row = sqlx::query("SELECT document,digest,created_us,id FROM public.assessment_samples WHERE task_id=$1 AND id=$2")
            .bind(&basis.task_id).bind(id).fetch_optional(&mut *tx).await.map_err(unavailable)?;
        let found = match &row {
            Some(row) => Some(sample_of(&mut tx, row).await?),
            None => None,
        };
        tx.commit().await.map_err(unavailable)?;
        Ok(found)
    }
    async fn record_sample(
        &self,
        basis: &ClaimBasis,
        record: &SampleRecord,
    ) -> Result<SampleRecord, ReadingError> {
        if record.task_id != basis.task_id || record.cycle_id != basis.cycle_id {
            return Err(ReadingError::Invalid);
        }
        let document = record.document();
        let mut tx = claimed(&self.pool, basis, &format!("assessment:{}", record.id)).await?;
        let select =
            "SELECT document,digest,created_us,id FROM public.assessment_samples WHERE id=$1";
        if let Some(row) = sqlx::query(select)
            .bind(&record.id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(unavailable)?
        {
            let stored = sample_of(&mut tx, &row).await?;
            tx.commit().await.map_err(unavailable)?;
            return same(stored, record, |r| SampleRecord {
                recorded_us: None,
                ..r.clone()
            });
        }
        let s = &basis.scope;
        let p = &record.sample;
        sqlx::query("INSERT INTO public.assessment_samples(organisation_id,client_id,engagement_id,task_id,cycle_id,actor_id,invocation_id,ordinal,id,methodology_binding_id,execution_epoch,population_id,method,seed,algorithm,size,statistical_inference,document,digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,false,$17,$18)")
            .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id)
            .bind(&record.task_id).bind(&record.cycle_id).bind(&basis.actor_id)
            .bind(&record.invocation_id).bind(record.ordinal as i32).bind(&record.id)
            .bind(&record.methodology_binding_id).bind(record.execution_epoch as i64)
            .bind(&record.population_id).bind(p.method.kind().as_str())
            .bind(p.method.seed().map(|seed| seed.to_string()))
            .bind(p.method.seed().map(|_| zobba_domain::coverage::SAMPLE_ALGORITHM))
            .bind(record.selected.len() as i32)
            .bind(to_json(&document)).bind(document_digest(&document))
            .execute(&mut *tx).await.map_err(refusal)?;
        // Each selected subject names its member, read under the same lock.
        let members: Vec<(String, i32)> = sqlx::query_as("SELECT subject,ordinal FROM public.assessment_population_members WHERE population_id=$1 AND disposition='in_scope' AND subject = ANY($2)")
            .bind(&record.population_id).bind(&record.selected)
            .fetch_all(&mut *tx).await.map_err(unavailable)?;
        let ordinal_of: std::collections::BTreeMap<&str, i32> =
            members.iter().map(|(s, o)| (s.as_str(), *o)).collect();
        let selected: Vec<(usize, &String, i32)> = record
            .selected
            .iter()
            .enumerate()
            .map(|(i, subject)| ordinal_of.get(subject.as_str()).map(|o| (i, subject, *o)))
            .collect::<Option<_>>()
            .ok_or(ReadingError::Invalid)?;
        for chunk in selected.chunks(BATCH) {
            let ordinal: Vec<i32> = chunk.iter().map(|(i, _, _)| *i as i32).collect();
            let subject: Vec<&str> = chunk.iter().map(|(_, s, _)| s.as_str()).collect();
            let member: Vec<i32> = chunk.iter().map(|(_, _, o)| *o).collect();
            sqlx::query("INSERT INTO public.assessment_sample_members(organisation_id,client_id,engagement_id,task_id,actor_id,sample_id,ordinal,subject,member_ordinal) SELECT $1,$2,$3,$4,$5,$6,o,s,m FROM unnest($7::int[],$8::text[],$9::int[]) AS t(o,s,m) ORDER BY o")
                .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id)
                .bind(&record.task_id).bind(&basis.actor_id).bind(&record.id)
                .bind(&ordinal).bind(&subject).bind(&member)
                .execute(&mut *tx).await.map_err(refusal)?;
        }
        let row = sqlx::query(select)
            .bind(&record.id)
            .fetch_one(&mut *tx)
            .await
            .map_err(unavailable)?;
        let stored = sample_of(&mut tx, &row).await?;
        task::admission_fence(&mut tx, &basis.actor_id, s, None)
            .await
            .map_err(task_error)?;
        tx.commit().await.map_err(refusal)?;
        Ok(stored)
    }
    async fn opportunities(
        &self,
        basis: &ClaimBasis,
        population_id: &str,
        criterion_id: &str,
    ) -> Result<Vec<OpportunityRecord>, ReadingError> {
        let mut tx = scoped(&self.pool, &basis.actor_id, &basis.scope).await?;
        let found = opportunities_of(&mut tx, &basis.task_id, population_id, criterion_id).await?;
        tx.commit().await.map_err(unavailable)?;
        Ok(found)
    }
    async fn record_opportunities(
        &self,
        basis: &ClaimBasis,
        records: &[OpportunityRecord],
    ) -> Result<(), ReadingError> {
        let Some(first) = records.first() else {
            return Ok(());
        };
        if records.iter().any(|r| {
            r.population_id != first.population_id
                || r.criterion_id != first.criterion_id
                || r.invocation_id != first.invocation_id
                || !r.outcome.is_valid()
                || (r.evaluation_id.is_none() && r.output_digest != r.computed_digest())
        }) {
            return Err(ReadingError::Invalid);
        }
        let key = format!("assessment:{}/{}", first.population_id, first.criterion_id);
        let mut tx = claimed(&self.pool, basis, &key).await?;
        let stored = opportunities_of(
            &mut tx,
            &basis.task_id,
            &first.population_id,
            &first.criterion_id,
        )
        .await?;
        if !stored.is_empty() {
            tx.commit().await.map_err(unavailable)?;
            return if stored == records {
                Ok(())
            } else {
                Err(ReadingError::Invalid)
            };
        }
        let s = &basis.scope;
        for chunk in records.chunks(BATCH) {
            let member: Vec<i32> = chunk.iter().map(|r| r.member_ordinal as i32).collect();
            let subject: Vec<&str> = chunk.iter().map(|r| r.subject.as_str()).collect();
            let applicability: Vec<&str> = chunk
                .iter()
                .map(|r| r.outcome.applicability.as_str())
                .collect();
            let execution: Vec<&str> = chunk.iter().map(|r| r.outcome.execution.as_str()).collect();
            let verdict: Vec<Option<&str>> = chunk
                .iter()
                .map(|r| r.outcome.verdict.map(|v| v.as_str()))
                .collect();
            let reason: Vec<Option<&str>> = chunk
                .iter()
                .map(|r| r.outcome.reason.map(|x| x.as_str()))
                .collect();
            let origin: Vec<&str> = chunk.iter().map(|r| r.outcome.origin.as_str()).collect();
            let digest: Vec<&str> = chunk.iter().map(|r| r.output_digest.as_str()).collect();
            let evaluation: Vec<Option<&str>> =
                chunk.iter().map(|r| r.evaluation_id.as_deref()).collect();
            let inputs: Vec<String> = chunk
                .iter()
                .map(|r| {
                    Value::Array(
                        r.outcome
                            .inputs
                            .iter()
                            .map(|(id, digest)| serde_json::json!({"id": id, "digest": digest}))
                            .collect(),
                    )
                    .to_string()
                })
                .collect();
            sqlx::query("INSERT INTO public.assessment_opportunities(organisation_id,client_id,engagement_id,task_id,actor_id,invocation_id,population_id,criterion_id,member_ordinal,subject,applicability,execution,verdict,reason,origin,output_digest,evaluation_id,inputs) SELECT $1,$2,$3,$4,$5,$6,$7,$8,m,s,a,e,v,x,o,d,k,i::jsonb FROM unnest($9::int[],$10::text[],$11::text[],$12::text[],$13::text[],$14::text[],$15::text[],$16::text[],$17::text[],$18::text[]) AS t(m,s,a,e,v,x,o,d,k,i) ORDER BY m")
                .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id)
                .bind(&basis.task_id).bind(&basis.actor_id).bind(&first.invocation_id)
                .bind(&first.population_id).bind(&first.criterion_id)
                .bind(&member).bind(&subject).bind(&applicability).bind(&execution).bind(&verdict)
                .bind(&reason).bind(&origin).bind(&digest).bind(&evaluation).bind(&inputs)
                .execute(&mut *tx).await.map_err(refusal)?;
        }
        task::admission_fence(&mut tx, &basis.actor_id, s, None)
            .await
            .map_err(task_error)?;
        tx.commit().await.map_err(refusal)?;
        Ok(())
    }
    async fn summary_for(
        &self,
        basis: &ClaimBasis,
        population_id: &str,
        sample_id: Option<&str>,
    ) -> Result<Option<SummaryRecord>, ReadingError> {
        let mut tx = scoped(&self.pool, &basis.actor_id, &basis.scope).await?;
        let found = sqlx::query("SELECT document,digest,created_us FROM public.assessment_summaries WHERE task_id=$1 AND population_id=$2 AND sample_id IS NOT DISTINCT FROM $3")
            .bind(&basis.task_id).bind(population_id).bind(sample_id)
            .fetch_optional(&mut *tx).await.map_err(unavailable)?
            .as_ref().map(summary_from).transpose()?;
        tx.commit().await.map_err(unavailable)?;
        Ok(found)
    }
    async fn record_summary(
        &self,
        basis: &ClaimBasis,
        record: &SummaryRecord,
    ) -> Result<SummaryRecord, ReadingError> {
        if record.task_id != basis.task_id
            || record.cycle_id != basis.cycle_id
            || !record.summary.is_consistent()
            || record.summary_digest != record.summary.digest()
        {
            return Err(ReadingError::Invalid);
        }
        let document = record.document();
        let mut tx = claimed(&self.pool, basis, &format!("assessment:{}", record.id)).await?;
        let select =
            "SELECT document,digest,created_us FROM public.assessment_summaries WHERE id=$1";
        if let Some(row) = sqlx::query(select)
            .bind(&record.id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(unavailable)?
        {
            let stored = summary_from(&row)?;
            tx.commit().await.map_err(unavailable)?;
            return same(stored, record, |r| SummaryRecord {
                recorded_us: None,
                ..r.clone()
            });
        }
        insert_summary(&mut tx, basis, record, &document).await?;
        let row = sqlx::query(select)
            .bind(&record.id)
            .fetch_one(&mut *tx)
            .await
            .map_err(unavailable)?;
        let stored = summary_from(&row)?;
        task::admission_fence(&mut tx, &basis.actor_id, &basis.scope, None)
            .await
            .map_err(task_error)?;
        tx.commit().await.map_err(refusal)?;
        Ok(stored)
    }
    async fn coverage_snapshot(
        &self,
        basis: &ClaimBasis,
    ) -> Result<CoverageSnapshot, ReadingError> {
        let mut tx = scoped(&self.pool, &basis.actor_id, &basis.scope).await?;
        let snapshot = coverage_snapshot(&mut tx, &basis.task_id).await?;
        tx.commit().await.map_err(unavailable)?;
        Ok(snapshot)
    }
}

/// The summary row: every count is a column, recounted by the guard.
pub async fn insert_summary(
    tx: &mut Tx,
    basis: &ClaimBasis,
    record: &SummaryRecord,
    document: &JsonValue,
) -> Result<(), ReadingError> {
    let s = &basis.scope;
    let m = &record.summary;
    let c = &m.counts;
    let p = &m.partition;
    sqlx::query("INSERT INTO public.assessment_summaries(organisation_id,client_id,engagement_id,task_id,cycle_id,actor_id,invocation_id,ordinal,id,methodology_binding_id,execution_epoch,basis_id,population_id,sample_id,aggregation,conclusion,completeness,completeness_reason,reconciliation,received_rows,unkeyed,duplicate_rows,distinct_subjects,excluded_out_of_period,scope_unknown_period_unparsed,scope_unknown_period_missing,scope_unknown_conflicting_duplicate,in_scope,selected,failing_subjects,meets_every_applicable,unresolved_subjects,not_applicable_to_any,failing_opportunities,statistical_inference,document,summary_digest,digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,false,$35,$36,$37)")
        .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id)
        .bind(&record.task_id).bind(&record.cycle_id).bind(&basis.actor_id)
        .bind(&record.invocation_id).bind(record.ordinal as i32).bind(&record.id)
        .bind(&record.methodology_binding_id).bind(record.execution_epoch as i64)
        .bind(&record.basis_id).bind(&record.population_id).bind(&record.sample_id)
        .bind(zobba_domain::coverage::AGGREGATION_RULE).bind(m.conclusion.as_str())
        .bind(m.completeness.as_str()).bind(m.completeness.reason().map(|r| r.as_str()))
        .bind(m.reconciliation.as_str())
        .bind(c.received_rows as i32).bind(c.unkeyed as i32).bind(c.duplicate_rows as i32)
        .bind(c.distinct_subjects as i32).bind(c.excluded_out_of_period as i32)
        .bind(c.scope_unknown_period_unparsed as i32).bind(c.scope_unknown_period_missing as i32)
        .bind(c.scope_unknown_conflicting_duplicate as i32).bind(c.in_scope as i32)
        .bind(m.selected.map(|n| n as i32))
        .bind(p.failing as i32).bind(p.meets_every_applicable as i32)
        .bind(p.unresolved as i32).bind(p.not_applicable_to_any as i32)
        .bind(m.failing_opportunities as i32)
        .bind(to_json(document)).bind(&record.summary_digest).bind(document_digest(document))
        .execute(&mut **tx).await.map_err(refusal)?;
    Ok(())
}

/// The Task's newest coverage records (bounded), oldest first, and totals.
async fn coverage_snapshot(tx: &mut Tx, task_id: &str) -> Result<CoverageSnapshot, ReadingError> {
    async fn newest(
        tx: &mut Tx,
        table: &'static str,
        task_id: &str,
    ) -> Result<(Vec<PgRow>, u64), ReadingError> {
        let rows = sqlx::query(&format!("SELECT * FROM (SELECT document,digest,created_us,id FROM public.{table} WHERE task_id=$1 ORDER BY created_us DESC,id COLLATE \"C\" DESC LIMIT $2) r ORDER BY created_us,id COLLATE \"C\""))
            .bind(task_id)
            .bind(MAX_OUTLINE_COVERAGE as i64)
            .fetch_all(&mut **tx)
            .await
            .map_err(unavailable)?;
        let total: i64 = sqlx::query_scalar(&format!(
            "SELECT count(*) FROM public.{table} WHERE task_id=$1"
        ))
        .bind(task_id)
        .fetch_one(&mut **tx)
        .await
        .map_err(unavailable)?;
        Ok((rows, total as u64))
    }
    let (populations, total_populations) = newest(tx, "assessment_populations", task_id).await?;
    let (sample_rows, total_samples) = newest(tx, "assessment_samples", task_id).await?;
    let (summaries, total_summaries) = newest(tx, "assessment_summaries", task_id).await?;
    let mut samples = Vec::new();
    for row in &sample_rows {
        samples.push(sample_of(tx, row).await?);
    }
    Ok(CoverageSnapshot {
        populations: populations
            .iter()
            .map(population_from)
            .collect::<Result<_, _>>()?,
        samples,
        summaries: summaries
            .iter()
            .map(summary_from)
            .collect::<Result<_, _>>()?,
        total_populations,
        total_samples,
        total_summaries,
    })
}

/// One page of a population's members for the viewer.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MemberPage {
    pub population: PopulationRecord,
    /// The exact count of members of this disposition (all when None).
    pub total: u64,
    pub members: Vec<MemberRecord>,
    /// The ordinal after which the next page starts, when there is one.
    pub next: Option<u32>,
}
/// Members one page shows.
pub const MEMBER_PAGE: usize = 50;

impl AssessmentRepository {
    /// Viewer read (current audit scope by RLS): the Task's recent coverage
    /// records.
    pub async fn coverage_view(
        &self,
        actor: &str,
        s: &Scope,
        task_id: &str,
    ) -> Result<CoverageSnapshot, TaskError> {
        if !valid_scope_id(task_id) {
            return Err(TaskError::Denied);
        }
        let mut tx = scoped(&self.pool, actor, s).await.map_err(|e| match e {
            ReadingError::Denied | ReadingError::Fenced => TaskError::Denied,
            _ => TaskError::Unavailable,
        })?;
        let exists: Option<String> = sqlx::query_scalar("SELECT id FROM public.tasks WHERE id=$1")
            .bind(task_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|_| TaskError::Unavailable)?;
        if exists.is_none() {
            return Err(TaskError::Denied);
        }
        let snapshot = coverage_snapshot(&mut tx, task_id)
            .await
            .map_err(|_| TaskError::Unavailable)?;
        task::admission_fence(&mut tx, actor, s, None).await?;
        tx.commit().await.map_err(|_| TaskError::Unavailable)?;
        Ok(snapshot)
    }
    /// Viewer read: the exact count of a population's members of one
    /// disposition and one page of them, in receipt order after `after`.
    pub async fn member_page(
        &self,
        actor: &str,
        s: &Scope,
        task_id: &str,
        population_id: &str,
        disposition: Option<zobba_domain::coverage::DispositionKind>,
        after: Option<u32>,
    ) -> Result<Option<MemberPage>, TaskError> {
        if !valid_scope_id(task_id) || !valid_scope_id(population_id) {
            return Err(TaskError::Denied);
        }
        let mut tx = scoped(&self.pool, actor, s).await.map_err(|e| match e {
            ReadingError::Denied | ReadingError::Fenced => TaskError::Denied,
            _ => TaskError::Unavailable,
        })?;
        let row = sqlx::query("SELECT document,digest,created_us FROM public.assessment_populations WHERE task_id=$1 AND id=$2")
            .bind(task_id).bind(population_id)
            .fetch_optional(&mut *tx).await.map_err(|_| TaskError::Unavailable)?;
        let Some(population) = row
            .as_ref()
            .map(population_from)
            .transpose()
            .map_err(|_| TaskError::Unavailable)?
        else {
            tx.commit().await.map_err(|_| TaskError::Unavailable)?;
            return Ok(None);
        };
        let kind = disposition.map(|d| d.as_str());
        let total: i64 = sqlx::query_scalar("SELECT count(*) FROM public.assessment_population_members WHERE population_id=$1 AND ($2::text IS NULL OR disposition=$2)")
            .bind(population_id).bind(kind)
            .fetch_one(&mut *tx).await.map_err(|_| TaskError::Unavailable)?;
        let rows = sqlx::query("SELECT document,digest FROM public.assessment_population_members WHERE population_id=$1 AND ($2::text IS NULL OR disposition=$2) AND ordinal > $3 ORDER BY ordinal LIMIT $4")
            .bind(population_id).bind(kind).bind(after.map_or(-1, |a| a as i64))
            .bind(MEMBER_PAGE as i64 + 1)
            .fetch_all(&mut *tx).await.map_err(|_| TaskError::Unavailable)?;
        let mut members = Vec::new();
        for row in rows.iter().take(MEMBER_PAGE) {
            let document: Value = row
                .try_get("document")
                .map_err(|_| TaskError::Unavailable)?;
            let digest: String = row.try_get("digest").map_err(|_| TaskError::Unavailable)?;
            let document = crate::work::json_value(&document).ok_or(TaskError::Unavailable)?;
            let record = MemberRecord::from_document(&document, &population.population)
                .ok_or(TaskError::Unavailable)?;
            if record.digest != digest {
                return Err(TaskError::Unavailable);
            }
            members.push(record);
        }
        let next = (rows.len() > MEMBER_PAGE)
            .then(|| members.last().map(|m| m.member.ordinal))
            .flatten();
        task::admission_fence(&mut tx, actor, s, None).await?;
        tx.commit().await.map_err(|_| TaskError::Unavailable)?;
        // Disposition kinds of the page agree with the filter.
        if let Some(kind) = disposition
            && members.iter().any(|m| m.member.disposition.kind() != kind)
        {
            return Err(TaskError::Unavailable);
        }
        let _ = Disposition::InScope;
        Ok(Some(MemberPage {
            population,
            total: total as u64,
            members,
            next,
        }))
    }
}
