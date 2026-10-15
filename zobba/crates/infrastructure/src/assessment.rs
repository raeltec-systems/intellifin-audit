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
