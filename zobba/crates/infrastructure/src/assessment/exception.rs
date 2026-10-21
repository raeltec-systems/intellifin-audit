//! Story 24.3b: exceptions, exception dispositions and effective summaries.
//!
//! Occurrences are written by the database (`exception_record`) in the
//! statement that records each not_met result; no Rust path inserts one.
//! Statuses are derived on every read: the database lists an exception's
//! current observations (`assessment_exception_observations`), its latest
//! occurrence and its latest disposition, and trusted Rust code derives the
//! status (`zobba_domain::exception::exception_status`). The effective
//! summary guard derives each status again in SQL and refuses a summary
//! whose counts disagree. Exception dispositions are saved under the
//! person's exact session, assignment and closing authority.
use std::collections::{BTreeMap, BTreeSet};

use super::{
    COLUMNS, OPPORTUNITY_COLUMNS, Tx, claimed, document_of, evaluation_from, opportunity_from,
    refusal, revision::heads_of, same, scoped, task_error, to_json, unavailable,
};
use crate::task;
use serde_json::Value;
use sqlx::{Row, postgres::PgRow};
use zobba_application::{
    assessment::{
        EvaluationRecord,
        coverage::OpportunityRecord,
        document_digest,
        exception::{
            EffectiveRow, EffectiveSummaryRecord, ExceptionDispositionRecord, ExceptionRecord,
            ExceptionSnapshot, ExceptionStore, ExceptionView, MAX_OUTLINE_EFFECTIVE,
            OccurrenceRecord, effective_row,
        },
    },
    citation::ReadingError,
    exception::{ExceptionDispositionError, ExceptionDispositionStore, ExceptionTarget},
    task::TaskError,
};
use zobba_domain::{
    assessment::{Execution, Verdict},
    coverage::MAX_POPULATION_ROWS,
    exception::{
        EFFECTIVE_AGGREGATION, ExceptionCounts, ExceptionDispositionKind, ExceptionEntry,
        ExceptionFacts, ExceptionStatus, LatestObserved, OCCURRENCE_PAGE, Observation,
        ObservationKind, Occurrence, OccurrenceSource, exception_status, valid_exception_id,
    },
    identity::{Scope, valid_scope_id},
    revision::{EffectiveOrigin, ReviewState, RevisionCause},
    task::ClaimBasis,
};

use super::AssessmentRepository;

fn effective_from_row(row: &PgRow) -> Result<EffectiveSummaryRecord, ReadingError> {
    let (document, created) = document_of(row)?;
    EffectiveSummaryRecord::from_document(&document, Some(created)).ok_or(ReadingError::Unavailable)
}
fn exception_disposition_from(row: &PgRow) -> Result<ExceptionDispositionRecord, ReadingError> {
    let (document, created) = document_of(row)?;
    ExceptionDispositionRecord::from_document(&document, Some(created))
        .ok_or(ReadingError::Unavailable)
}

fn strings(value: &Value) -> Option<Vec<String>> {
    match value {
        Value::Null => Some(vec![]),
        Value::Array(items) => items.iter().map(|i| i.as_str().map(String::from)).collect(),
        _ => None,
    }
}
fn text(value: &Value, key: &str) -> Option<Option<String>> {
    match value.get(key)? {
        Value::Null => Some(None),
        Value::String(s) => Some(Some(s.clone())),
        _ => None,
    }
}

/// One current observation as the database lists it.
fn observation_of(value: &Value) -> Option<Observation> {
    Some(Observation {
        kind: ObservationKind::parse(text(value, "kind")??.as_str())?,
        id: text(value, "id")??,
        at_us: value.get("at_us")?.as_i64()?,
        verdict: match text(value, "verdict")? {
            Some(v) => Some(Verdict::parse(&v)?),
            None => None,
        },
        execution: match text(value, "execution")? {
            Some(v) => Some(Execution::parse(&v)?),
            None => None,
        },
        origin: match text(value, "origin")? {
            Some(v) => Some(EffectiveOrigin::parse(&v)?),
            None => None,
        },
        review: ReviewState::parse(text(value, "review")??.as_str())?,
        causes: strings(value.get("causes")?)?
            .iter()
            .map(|c| RevisionCause::parse(c))
            .collect::<Option<Vec<_>>>()?,
        criterion_id: text(value, "criterion_id")?,
        evidence: strings(value.get("evidence")?)?,
    })
}
fn occurrence_fact_of(value: &Value) -> Option<Occurrence> {
    Some(Occurrence {
        seq: value.get("seq")?.as_i64()?,
        at_us: value.get("at_us")?.as_i64()?,
        criterion_id: text(value, "criterion_id")??,
        evidence: strings(value.get("evidence")?)?,
    })
}

/// The exception page facts of chosen exceptions, in one statement: the
/// database's derived status, every current observation, every occurrence
/// and the newest disposition. Trusted Rust code derives each status again
/// from the same facts and refuses a disagreement.
const FACTS: &str = "WITH s AS MATERIALIZED (SELECT * FROM public.assessment_exception_statuses($1,$2,$3,$4,$5)),
  o AS MATERIALIZED (SELECT * FROM public.assessment_exception_observations($1,$2,$3,$4,$5))
 SELECT s.id, s.subject, s.criterion_root, s.status, s.latest_observed,
  (SELECT coalesce(jsonb_agg(jsonb_build_object('kind',o.kind,'id',o.id,'at_us',o.at_us,'verdict',o.verdict,'execution',o.execution,'origin',o.origin,'review',o.review,'causes',to_jsonb(o.causes),'criterion_id',o.criterion_id,'evidence',to_jsonb(public.assessment_evidence(o.inputs)))),'[]'::jsonb)
     FROM o WHERE o.exception_id=s.id) AS observations,
  (SELECT coalesce(jsonb_agg(jsonb_build_object('seq',y.seq,'at_us',y.source_us,'criterion_id',y.criterion_id,'evidence',to_jsonb(y.evidence))),'[]'::jsonb)
     FROM public.assessment_exception_occurrences y WHERE y.task_id=$4 AND y.exception_id=s.id) AS occurrences,
  d.kind AS decision, d.seq AS decided_seq
 FROM s LEFT JOIN LATERAL (SELECT z.kind, z.seq FROM public.assessment_exception_dispositions z
   WHERE z.task_id=$4 AND z.exception_id=s.id ORDER BY z.seq DESC LIMIT 1) d ON true
 ORDER BY s.subject COLLATE \"C\", s.criterion_root COLLATE \"C\", s.id COLLATE \"C\"";

/// Exceptions a Task holds at most (the writer refuses the next one).
pub const MAX_TASK_EXCEPTIONS: usize = 20_000;
/// Exceptions one page lists (the counts are over all of them).
pub const EXCEPTION_PAGE: usize = 50;

fn entry_of(row: &PgRow) -> Result<ExceptionEntry, ReadingError> {
    let get =
        |name: &str| -> Result<String, ReadingError> { row.try_get(name).map_err(unavailable) };
    fn parse<T>(value: Value, f: fn(&Value) -> Option<T>) -> Result<Vec<T>, ReadingError> {
        value
            .as_array()
            .ok_or(ReadingError::Unavailable)?
            .iter()
            .map(f)
            .collect::<Option<Vec<_>>>()
            .ok_or(ReadingError::Unavailable)
    }
    let observations: Vec<Observation> = parse(
        row.try_get("observations").map_err(unavailable)?,
        observation_of,
    )?;
    let occurrences: Vec<Occurrence> = parse(
        row.try_get("occurrences").map_err(unavailable)?,
        occurrence_fact_of,
    )?;
    let decision: Option<String> = row.try_get("decision").map_err(unavailable)?;
    let decided: Option<i32> = row.try_get("decided_seq").map_err(unavailable)?;
    let decision = match (decision, decided) {
        (Some(kind), Some(at)) => Some((
            ExceptionDispositionKind::parse(&kind).ok_or(ReadingError::Unavailable)?,
            i64::from(at),
        )),
        (None, None) => None,
        _ => return Err(ReadingError::Unavailable),
    };
    if occurrences.is_empty() {
        return Err(ReadingError::Unavailable);
    }
    let facts = ExceptionFacts {
        occurrences,
        decision,
        observations,
    };
    let (status, latest_observed) = exception_status(&facts);
    // The database derived the same status from the same facts, or the read
    // is not trusted.
    if ExceptionStatus::parse(&get("status")?) != Some(status)
        || LatestObserved::parse(&get("latest_observed")?) != Some(latest_observed)
    {
        return Err(ReadingError::Unavailable);
    }
    Ok(ExceptionEntry {
        id: get("id")?,
        subject: get("subject")?,
        criterion_root: get("criterion_root")?,
        status,
        latest_observed,
    })
}

/// These exceptions of one Task with their status derived in Rust and
/// checked against the database's (at most a page of them).
async fn derived(
    tx: &mut Tx,
    s: &Scope,
    task_id: &str,
    ids: &[String],
) -> Result<Vec<ExceptionEntry>, ReadingError> {
    if ids.is_empty() {
        return Ok(vec![]);
    }
    let rows = sqlx::query(FACTS)
        .bind(&s.organisation_id)
        .bind(&s.client_id)
        .bind(&s.engagement_id)
        .bind(task_id)
        .bind(ids)
        .fetch_all(&mut **tx)
        .await
        .map_err(unavailable)?;
    rows.iter().map(entry_of).collect()
}

/// Every exception of one Task under these criterion lineages, with the
/// database's set-based derived status (an exact read; the Task holds at
/// most `MAX_TASK_EXCEPTIONS`).
async fn entries(
    tx: &mut Tx,
    s: &Scope,
    task_id: &str,
    roots: &[String],
) -> Result<Vec<ExceptionEntry>, ReadingError> {
    let ids: Vec<String> = sqlx::query_scalar("SELECT id FROM public.assessment_exceptions WHERE task_id=$1 AND criterion_root = ANY($2) LIMIT $3")
        .bind(task_id).bind(roots).bind(MAX_TASK_EXCEPTIONS as i64 + 1)
        .fetch_all(&mut **tx).await.map_err(unavailable)?;
    if ids.len() > MAX_TASK_EXCEPTIONS {
        return Err(ReadingError::Capacity);
    }
    if ids.is_empty() {
        return Ok(vec![]);
    }
    let rows: Vec<(String, String, String, String, String)> = sqlx::query_as("SELECT id, subject, criterion_root, status, latest_observed FROM public.assessment_exception_statuses($1,$2,$3,$4,$5) ORDER BY subject COLLATE \"C\", criterion_root COLLATE \"C\", id COLLATE \"C\"")
        .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id).bind(task_id).bind(&ids)
        .fetch_all(&mut **tx).await.map_err(unavailable)?;
    rows.into_iter()
        .map(|(id, subject, criterion_root, status, latest)| {
            Ok(ExceptionEntry {
                id,
                subject,
                criterion_root,
                status: ExceptionStatus::parse(&status).ok_or(ReadingError::Unavailable)?,
                latest_observed: LatestObserved::parse(&latest).ok_or(ReadingError::Unavailable)?,
            })
        })
        .collect()
}

/// Exact counts by derived status of every exception of a Task: per
/// criterion lineage root and status, and the distinct subjects, in one
/// aggregate statement (never a list, never a bounded page).
struct StatusCounts {
    by_root: Vec<(String, ExceptionStatus, u64)>,
    subjects: u64,
}
impl StatusCounts {
    fn total(&self) -> ExceptionCounts {
        let mut c = ExceptionCounts {
            subjects: self.subjects,
            ..ExceptionCounts::default()
        };
        for (_, status, n) in &self.by_root {
            c.total += n;
            match status {
                ExceptionStatus::Open => c.open += n,
                ExceptionStatus::ResolvedByEvidence => c.resolved_by_evidence += n,
                ExceptionStatus::ReplacedByHumanJudgment => c.replaced_by_human_judgment += n,
                ExceptionStatus::ClosedByDisposition => c.closed_by_disposition += n,
            }
        }
        c
    }
}
async fn status_counts(
    conn: &mut sqlx::PgConnection,
    s: &Scope,
    task_id: &str,
) -> Result<StatusCounts, ReadingError> {
    let rows: Vec<(Option<String>, Option<String>, i64, i64)> = sqlx::query_as("WITH s AS MATERIALIZED (SELECT * FROM public.assessment_exception_statuses($1,$2,$3,$4,NULL))
      SELECT g.criterion_root, g.status, g.n, (SELECT count(DISTINCT s.subject) FROM s) FROM (SELECT criterion_root, status, count(*) AS n FROM s GROUP BY 1,2) g
      UNION ALL SELECT NULL, NULL, 0, (SELECT count(DISTINCT s.subject) FROM s)")
        .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id).bind(task_id)
        .fetch_all(&mut *conn).await.map_err(unavailable)?;
    let mut counts = StatusCounts {
        by_root: vec![],
        subjects: 0,
    };
    for (root, status, n, subjects) in rows {
        counts.subjects = subjects as u64;
        if let (Some(root), Some(status)) = (root, status) {
            counts.by_root.push((
                root,
                ExceptionStatus::parse(&status).ok_or(ReadingError::Unavailable)?,
                n as u64,
            ));
        }
    }
    Ok(counts)
}

/// The distinct lineage roots of these criterion versions.
async fn roots_of(tx: &mut Tx, s: &Scope, ids: &[String]) -> Result<Vec<String>, ReadingError> {
    let roots: Vec<Option<String>> = sqlx::query_scalar("SELECT DISTINCT public.assessment_criterion_root($1,$2,$3,c) AS root FROM unnest($4::text[]) c ORDER BY root")
        .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id).bind(ids)
        .fetch_all(&mut **tx).await.map_err(unavailable)?;
    // A criterion version this Task does not hold has no lineage.
    roots
        .into_iter()
        .map(|r| r.ok_or(ReadingError::Unavailable))
        .collect::<Result<BTreeSet<_>, _>>()
        .map(|r| r.into_iter().collect())
}

/// The effective outcome of every opportunity of one population, derived in
/// Rust from the stored opportunities, chain heads and dispositions.
async fn outcomes_of(
    tx: &mut Tx,
    task_id: &str,
    population_id: &str,
) -> Result<Vec<EffectiveRow>, ReadingError> {
    let limit = 16 * i64::from(MAX_POPULATION_ROWS);
    let rows = sqlx::query(&format!("SELECT {OPPORTUNITY_COLUMNS} FROM public.assessment_opportunities WHERE task_id=$1 AND population_id=$2 ORDER BY criterion_id COLLATE \"C\", member_ordinal LIMIT $3"))
        .bind(task_id).bind(population_id).bind(limit + 1)
        .fetch_all(&mut **tx).await.map_err(unavailable)?;
    if rows.len() as i64 > limit {
        return Err(ReadingError::Capacity);
    }
    let opportunities: Vec<OpportunityRecord> = rows
        .iter()
        .map(opportunity_from)
        .collect::<Result<_, _>>()?;
    let ids: Vec<&String> = opportunities
        .iter()
        .filter_map(|o| o.evaluation_id.as_ref())
        .collect();
    let firsts: Vec<EvaluationRecord> = sqlx::query(&format!(
        "SELECT {COLUMNS} FROM public.assessment_evaluations WHERE task_id=$1 AND id = ANY($2)"
    ))
    .bind(task_id)
    .bind(&ids)
    .fetch_all(&mut **tx)
    .await
    .map_err(unavailable)?
    .iter()
    .map(evaluation_from)
    .collect::<Result<_, _>>()?;
    let heads = heads_of(tx, task_id, firsts).await?;
    let head_bases: Vec<String> = heads.iter().map(|h| h.basis_id().to_string()).collect();
    let superseded: BTreeSet<String> = sqlx::query_scalar(
        "SELECT supersedes FROM public.assessment_bases WHERE task_id=$1 AND supersedes = ANY($2)",
    )
    .bind(task_id)
    .bind(&head_bases)
    .fetch_all(&mut **tx)
    .await
    .map_err(unavailable)?
    .into_iter()
    .collect();
    let heads: BTreeMap<String, _> = heads
        .into_iter()
        .map(|h| (h.chain_id().to_string(), h))
        .collect();
    opportunities
        .iter()
        .map(|o| {
            let head = match &o.evaluation_id {
                Some(id) => Some(heads.get(id).ok_or(ReadingError::Unavailable)?),
                None => None,
            };
            let superseded = head.is_some_and(|h| superseded.contains(h.basis_id()));
            Ok(effective_row(o, head, superseded))
        })
        .collect()
}

const EFFECTIVE_SELECT: &str =
    "SELECT document,digest,created_us FROM public.assessment_effective_summaries";

async fn newest_effective_in(
    tx: &mut Tx,
    task_id: &str,
    population_id: &str,
    sample_id: Option<&str>,
) -> Result<Option<EffectiveSummaryRecord>, ReadingError> {
    sqlx::query(&format!("{EFFECTIVE_SELECT} WHERE task_id=$1 AND population_id=$2 AND sample_id IS NOT DISTINCT FROM $3 ORDER BY created_us DESC, id COLLATE \"C\" DESC LIMIT 1"))
        .bind(task_id).bind(population_id).bind(sample_id)
        .fetch_optional(&mut **tx).await.map_err(unavailable)?
        .as_ref().map(effective_from_row).transpose()
}

/// The Task's newest effective summaries (bounded, oldest first), the exact
/// exception counts by status of the whole Task and under each of its newest
/// basis versions. The counts are one aggregate statement inside a
/// savepoint: when it cannot be read now (capacity or a statement timeout),
/// the snapshot says so instead of failing the turn.
async fn exception_snapshot(
    tx: &mut Tx,
    s: &Scope,
    task_id: &str,
) -> Result<ExceptionSnapshot, ReadingError> {
    let rows = sqlx::query("SELECT document,digest,created_us FROM (SELECT document,digest,created_us,id FROM public.assessment_effective_summaries WHERE task_id=$1 ORDER BY created_us DESC, id COLLATE \"C\" DESC LIMIT $2) r ORDER BY created_us, id COLLATE \"C\"")
        .bind(task_id)
        .bind(MAX_OUTLINE_EFFECTIVE as i64)
        .fetch_all(&mut **tx)
        .await
        .map_err(unavailable)?;
    let summaries: Vec<EffectiveSummaryRecord> = rows
        .iter()
        .map(effective_from_row)
        .collect::<Result<_, _>>()?;
    let total: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM public.assessment_effective_summaries WHERE task_id=$1",
    )
    .bind(task_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(unavailable)?;
    let mut snapshot = ExceptionSnapshot {
        summaries,
        total_summaries: total as u64,
        ..ExceptionSnapshot::default()
    };
    let exceptions: i64 =
        sqlx::query_scalar("SELECT count(*) FROM public.assessment_exceptions WHERE task_id=$1")
            .bind(task_id)
            .fetch_one(&mut **tx)
            .await
            .map_err(unavailable)?;
    if exceptions == 0 {
        return Ok(snapshot);
    }
    // The newest basis versions (at most 4): those a newer one does not
    // supersede.
    let latest: Vec<(String, Value)> = sqlx::query_as("SELECT b.id, b.document->'criteria' FROM public.assessment_bases b WHERE b.task_id=$1 AND NOT EXISTS(SELECT 1 FROM public.assessment_bases n WHERE n.task_id=b.task_id AND n.supersedes=b.id) ORDER BY b.created_us DESC, b.id COLLATE \"C\" DESC LIMIT 4")
        .bind(task_id)
        .fetch_all(&mut **tx)
        .await
        .map_err(unavailable)?;
    let mut lineages = Vec::new();
    for (basis_id, criteria) in latest {
        let criteria = strings(&criteria).ok_or(ReadingError::Unavailable)?;
        let roots: BTreeSet<String> = roots_of(tx, s, &criteria).await?.into_iter().collect();
        lineages.push((basis_id, roots));
    }
    let mut savepoint = sqlx::Acquire::begin(&mut **tx).await.map_err(unavailable)?;
    match status_counts(&mut savepoint, s, task_id).await {
        Ok(counts) => {
            savepoint.commit().await.map_err(unavailable)?;
            for (basis_id, roots) in lineages {
                let mut n = [0u64; 4];
                for (root, status, count) in &counts.by_root {
                    if roots.contains(root) {
                        n[match status {
                            ExceptionStatus::Open => 0,
                            ExceptionStatus::ResolvedByEvidence => 1,
                            ExceptionStatus::ReplacedByHumanJudgment => 2,
                            ExceptionStatus::ClosedByDisposition => 3,
                        }] += count;
                    }
                }
                snapshot.bases.insert(basis_id, n);
            }
            snapshot.task = Some(counts.total());
        }
        // Not knowable now: said in the outline, never a failed turn.
        Err(ReadingError::Unavailable | ReadingError::Capacity) => {
            savepoint.rollback().await.map_err(unavailable)?;
            snapshot.unavailable = true;
        }
        Err(error) => return Err(error),
    }
    Ok(snapshot)
}

impl ExceptionStore for AssessmentRepository {
    async fn invocation_effective(
        &self,
        basis: &ClaimBasis,
        invocation_id: &str,
    ) -> Result<Vec<EffectiveSummaryRecord>, ReadingError> {
        let mut tx = scoped(&self.pool, &basis.actor_id, &basis.scope).await?;
        let rows = sqlx::query(&format!(
            "{EFFECTIVE_SELECT} WHERE task_id=$1 AND invocation_id=$2 ORDER BY ordinal"
        ))
        .bind(&basis.task_id)
        .bind(invocation_id)
        .fetch_all(&mut *tx)
        .await
        .map_err(unavailable)?;
        let found = rows
            .iter()
            .map(effective_from_row)
            .collect::<Result<_, _>>()?;
        tx.commit().await.map_err(unavailable)?;
        Ok(found)
    }
    async fn effective_outcomes(
        &self,
        basis: &ClaimBasis,
        population_id: &str,
    ) -> Result<Vec<EffectiveRow>, ReadingError> {
        let mut tx = scoped(&self.pool, &basis.actor_id, &basis.scope).await?;
        let rows = outcomes_of(&mut tx, &basis.task_id, population_id).await?;
        tx.commit().await.map_err(unavailable)?;
        Ok(rows)
    }
    async fn criterion_roots(
        &self,
        basis: &ClaimBasis,
        criterion_ids: &[String],
    ) -> Result<Vec<String>, ReadingError> {
        let mut tx = scoped(&self.pool, &basis.actor_id, &basis.scope).await?;
        let roots = roots_of(&mut tx, &basis.scope, criterion_ids).await?;
        tx.commit().await.map_err(unavailable)?;
        Ok(roots)
    }
    async fn exception_entries(
        &self,
        basis: &ClaimBasis,
        roots: &[String],
    ) -> Result<Vec<ExceptionEntry>, ReadingError> {
        let mut tx = scoped(&self.pool, &basis.actor_id, &basis.scope).await?;
        let found = entries(&mut tx, &basis.scope, &basis.task_id, roots).await?;
        tx.commit().await.map_err(unavailable)?;
        Ok(found)
    }
    async fn newest_effective(
        &self,
        basis: &ClaimBasis,
        population_id: &str,
        sample_id: Option<&str>,
    ) -> Result<Option<EffectiveSummaryRecord>, ReadingError> {
        let mut tx = scoped(&self.pool, &basis.actor_id, &basis.scope).await?;
        let found = newest_effective_in(&mut tx, &basis.task_id, population_id, sample_id).await?;
        tx.commit().await.map_err(unavailable)?;
        Ok(found)
    }
    async fn record_effective(
        &self,
        basis: &ClaimBasis,
        record: &EffectiveSummaryRecord,
    ) -> Result<EffectiveSummaryRecord, ReadingError> {
        if record.task_id != basis.task_id
            || record.cycle_id != basis.cycle_id
            || !record.effective.is_consistent()
            || record.summary_digest != record.effective.digest()
        {
            return Err(ReadingError::Invalid);
        }
        let document = record.document();
        let mut tx = claimed(&self.pool, basis, &format!("assessment:{}", record.id)).await?;
        // The guard recounts every opportunity and exception of a population
        // of up to 20,000 members: a bounded longer statement limit; past it
        // the write is a recorded capacity refusal (24.3b review A).
        sqlx::query("SET LOCAL statement_timeout = 60000")
            .execute(&mut *tx)
            .await
            .map_err(unavailable)?;
        let select = format!("{EFFECTIVE_SELECT} WHERE id=$1");
        if let Some(row) = sqlx::query(&select)
            .bind(&record.id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(unavailable)?
        {
            let stored = effective_from_row(&row)?;
            tx.commit().await.map_err(unavailable)?;
            return same(stored, record, |r| EffectiveSummaryRecord {
                recorded_us: None,
                ..r.clone()
            });
        }
        let s = &basis.scope;
        let e = &record.effective;
        let m = &e.summary;
        let p = &m.partition;
        let x = &e.exceptions;
        let sum = |f: fn(&zobba_domain::exception::EffectiveCounts) -> u64| -> i32 {
            e.criteria.iter().map(f).sum::<u64>() as i32
        };
        sqlx::query("INSERT INTO public.assessment_effective_summaries(organisation_id,client_id,engagement_id,task_id,cycle_id,actor_id,invocation_id,ordinal,id,methodology_binding_id,execution_epoch,basis_id,population_id,sample_id,supersedes,aggregation,conclusion,completeness,completeness_reason,reconciliation,in_scope,selected,failing_subjects,meets_every_applicable,unresolved_subjects,not_applicable_to_any,failing_opportunities,human_replaced,pending_reconsideration,undisposed,superseded,exceptions_total,exceptions_open,exceptions_resolved,exceptions_replaced,exceptions_closed,exception_subjects,statistical_inference,document,summary_digest,digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,false,$38,$39,$40)")
            .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id)
            .bind(&record.task_id).bind(&record.cycle_id).bind(&basis.actor_id)
            .bind(&record.invocation_id).bind(record.ordinal as i32).bind(&record.id)
            .bind(&record.methodology_binding_id).bind(record.execution_epoch as i64)
            .bind(&record.basis_id).bind(&record.population_id).bind(&record.sample_id)
            .bind(&record.supersedes)
            .bind(EFFECTIVE_AGGREGATION).bind(m.conclusion.as_str())
            .bind(m.completeness.as_str()).bind(m.completeness.reason().map(|r| r.as_str()))
            .bind(m.reconciliation.as_str())
            .bind(m.counts.in_scope as i32).bind(m.selected.map(|n| n as i32))
            .bind(p.failing as i32).bind(p.meets_every_applicable as i32)
            .bind(p.unresolved as i32).bind(p.not_applicable_to_any as i32)
            .bind(m.failing_opportunities as i32)
            .bind(sum(|c| c.human_replaced)).bind(sum(|c| c.pending_reconsideration))
            .bind(sum(|c| c.undisposed)).bind(sum(|c| c.superseded))
            .bind(x.total as i32).bind(x.open as i32).bind(x.resolved_by_evidence as i32)
            .bind(x.replaced_by_human_judgment as i32).bind(x.closed_by_disposition as i32)
            .bind(x.subjects as i32)
            .bind(to_json(&document)).bind(&record.summary_digest).bind(document_digest(&document))
            .execute(&mut *tx).await.map_err(refusal)?;
        let row = sqlx::query(&select)
            .bind(&record.id)
            .fetch_one(&mut *tx)
            .await
            .map_err(unavailable)?;
        let stored = effective_from_row(&row)?;
        task::admission_fence(&mut tx, &basis.actor_id, &basis.scope, None)
            .await
            .map_err(task_error)?;
        tx.commit().await.map_err(refusal)?;
        Ok(stored)
    }
    async fn exception_snapshot(
        &self,
        basis: &ClaimBasis,
    ) -> Result<ExceptionSnapshot, ReadingError> {
        let mut tx = scoped(&self.pool, &basis.actor_id, &basis.scope).await?;
        let snapshot = exception_snapshot(&mut tx, &basis.scope, &basis.task_id).await?;
        tx.commit().await.map_err(unavailable)?;
        Ok(snapshot)
    }
}

// ------------------------------------------------- exception dispositions

fn denied(error: TaskError) -> ExceptionDispositionError {
    match error {
        TaskError::Denied | TaskError::Fenced => ExceptionDispositionError::Denied,
        _ => ExceptionDispositionError::Unavailable,
    }
}
fn down(_: sqlx::Error) -> ExceptionDispositionError {
    ExceptionDispositionError::Unavailable
}

/// Whether the actor is an active Audit manager of the organisation or the
/// Task's accountable person (the guard's own rule). None: no such Task.
async fn may_close(
    tx: &mut Tx,
    actor: &str,
    s: &Scope,
    task_id: &str,
) -> Result<Option<bool>, ExceptionDispositionError> {
    sqlx::query_scalar("SELECT t.accountable_actor=$1 OR EXISTS(SELECT 1 FROM public.organisation_memberships m WHERE (m.organisation_id,m.actor_id)=($2,$1) AND m.active AND 'audit_manager'=ANY(m.roles) AND (m.expires_at IS NULL OR m.expires_at > floor(extract(epoch FROM clock_timestamp()))::bigint)) FROM public.tasks t WHERE t.id=$3")
        .bind(actor).bind(&s.organisation_id).bind(task_id)
        .fetch_optional(&mut **tx).await.map_err(down)
}

/// What a refused exception disposition insert means, by the guard's words.
fn refused(message: &str) -> ExceptionDispositionError {
    if message.contains("is not closed again") {
        ExceptionDispositionError::AlreadyClosed
    } else if message.contains("only a closed exception") {
        ExceptionDispositionError::NotClosed
    } else if message.contains("at most 16") {
        ExceptionDispositionError::Capacity
    } else if message.contains("reference") {
        // Rust verified each reference first: one changed meanwhile.
        ExceptionDispositionError::ReferenceUnverified(0)
    } else if message.contains("accountable person") {
        ExceptionDispositionError::NotAuthorised
    } else if message.contains("assigned auditor") {
        ExceptionDispositionError::Denied
    } else if message.contains("of its own Task") {
        ExceptionDispositionError::NotFound
    } else {
        ExceptionDispositionError::Unavailable
    }
}

const DISPOSITION_SELECT: &str =
    "SELECT document,digest,created_us FROM public.assessment_exception_dispositions";

impl ExceptionDispositionStore for AssessmentRepository {
    async fn exception_disposition_by_key(
        &self,
        actor: &str,
        scope: &Scope,
        session_hash: &str,
        key: &str,
    ) -> Result<Option<ExceptionDispositionRecord>, ExceptionDispositionError> {
        let mut tx = scoped(&self.pool, actor, scope).await?;
        // A replay answers only an actor who may dispose now, in this exact
        // session, with closing authority over the original's Task.
        task::admission_fence(&mut tx, actor, scope, Some(session_hash))
            .await
            .map_err(denied)?;
        let found = sqlx::query(&format!(
            "{DISPOSITION_SELECT} WHERE actor_id=$1 AND key=$2"
        ))
        .bind(actor)
        .bind(key)
        .fetch_optional(&mut *tx)
        .await
        .map_err(down)?
        .as_ref()
        .map(exception_disposition_from)
        .transpose()?;
        if let Some(found) = &found
            && may_close(&mut tx, actor, scope, &found.task_id).await? != Some(true)
        {
            return Err(ExceptionDispositionError::NotAuthorised);
        }
        tx.commit().await.map_err(down)?;
        Ok(found)
    }
    async fn exception_target(
        &self,
        actor: &str,
        scope: &Scope,
        task_id: &str,
        exception_id: &str,
    ) -> Result<Option<ExceptionTarget>, ExceptionDispositionError> {
        if !valid_scope_id(task_id) || !valid_exception_id(exception_id) {
            return Err(ExceptionDispositionError::Invalid);
        }
        let mut tx = scoped(&self.pool, actor, scope).await?;
        // Only a currently assigned auditor or audit manager (Admin alone is
        // not one) learns anything about the exception.
        task::admission_fence(&mut tx, actor, scope, None)
            .await
            .map_err(denied)?;
        let found = target_in(&mut tx, actor, scope, task_id, exception_id).await?;
        tx.commit().await.map_err(down)?;
        Ok(found)
    }
    async fn record_exception_disposition(
        &self,
        actor: &str,
        scope: &Scope,
        session_hash: &str,
        record: &ExceptionDispositionRecord,
    ) -> Result<ExceptionDispositionRecord, ExceptionDispositionError> {
        if record.actor_id != actor || !record.request.is_valid() {
            return Err(ExceptionDispositionError::Invalid);
        }
        let mut tx = task::lock(&self.pool, actor, scope).await.map_err(denied)?;
        task::admission_fence(&mut tx, actor, scope, Some(session_hash))
            .await
            .map_err(denied)?;
        let select = format!("{DISPOSITION_SELECT} WHERE actor_id=$1 AND key=$2");
        if let Some(row) = sqlx::query(&select)
            .bind(actor)
            .bind(&record.request.key)
            .fetch_optional(&mut *tx)
            .await
            .map_err(down)?
        {
            let stored = exception_disposition_from(&row)?;
            // A replay is answered only to a person who may still close or
            // reopen it, checked in this very transaction (BH L2).
            if may_close(&mut tx, actor, scope, &stored.task_id).await? != Some(true) {
                return Err(ExceptionDispositionError::NotAuthorised);
            }
            tx.commit().await.map_err(down)?;
            return if stored.request == record.request && stored.task_id == record.task_id {
                Ok(stored)
            } else {
                Err(ExceptionDispositionError::Conflict)
            };
        }
        let document = record.document();
        let r = &record.request;
        // The guard requires this person's own live session for the write
        // transaction only: a worker connection holds none.
        sqlx::query("SELECT set_config('zobba.session_hash',$1,true)")
            .bind(session_hash)
            .execute(&mut *tx)
            .await
            .map_err(down)?;
        let inserted = sqlx::query("INSERT INTO public.assessment_exception_dispositions(organisation_id,client_id,engagement_id,task_id,actor_id,id,key,exception_id,kind,rationale,document,digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)")
            .bind(&scope.organisation_id).bind(&scope.client_id).bind(&scope.engagement_id)
            .bind(&record.task_id).bind(actor).bind(&record.id).bind(&r.key)
            .bind(&r.exception_id).bind(r.kind.as_str()).bind(&r.rationale)
            .bind(to_json(&document)).bind(document_digest(&document))
            .execute(&mut *tx).await;
        if let Err(error) = inserted {
            let (message, code) = match &error {
                sqlx::Error::Database(database) => (
                    database.message().to_string(),
                    database.code().map(|c| c.to_string()),
                ),
                _ => (String::new(), None),
            };
            drop(tx);
            // Two first writes of one key at once: the winner committed;
            // answer it as a replay (with its own authority check) or as a
            // conflict.
            if code.as_deref() == Some("23505") {
                return match self
                    .exception_disposition_by_key(actor, scope, session_hash, &r.key)
                    .await?
                {
                    Some(stored)
                        if stored.request == record.request && stored.task_id == record.task_id =>
                    {
                        Ok(stored)
                    }
                    Some(_) => Err(ExceptionDispositionError::Conflict),
                    None => Err(ExceptionDispositionError::Unavailable),
                };
            }
            return Err(refused(&message));
        }
        let row = sqlx::query(&format!("{DISPOSITION_SELECT} WHERE id=$1"))
            .bind(&record.id)
            .fetch_one(&mut *tx)
            .await
            .map_err(down)?;
        let stored = exception_disposition_from(&row)?;
        tx.commit().await.map_err(down)?;
        Ok(stored)
    }
}

async fn target_in(
    tx: &mut Tx,
    actor: &str,
    s: &Scope,
    task_id: &str,
    exception_id: &str,
) -> Result<Option<ExceptionTarget>, ExceptionDispositionError> {
    let found = derived(tx, s, task_id, &[exception_id.to_string()]).await?;
    let Some(entry) = found.into_iter().next() else {
        return Ok(None);
    };
    let may = may_close(tx, actor, s, task_id).await?.unwrap_or(false);
    Ok(Some(ExceptionTarget {
        exception_id: entry.id,
        task_id: task_id.into(),
        status: entry.status,
        may_close: may,
    }))
}

// ------------------------------------------------------------- viewer

/// The viewer's exceptions of one Task: one page of them (C-ordered by
/// subject, criterion lineage, ID) with their derived status, the exact
/// counts by status over every exception of the Task, whether the viewer may
/// close or reopen one, and the newest effective summaries.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExceptionsView {
    pub exceptions: Vec<ExceptionView>,
    /// Exact counts over every exception of the Task, never over the page.
    pub counts: ExceptionCounts,
    /// The last listed exception, when more follow it.
    pub next: Option<String>,
    pub may_close: bool,
    pub summaries: Vec<EffectiveSummaryRecord>,
    pub total_summaries: u64,
}

/// One exception's detail: its occurrences (one page, in their order) and
/// every disposition with the person's public label.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExceptionDetail {
    pub view: ExceptionView,
    pub occurrences: Vec<OccurrenceRecord>,
    /// The place after which the next page starts, when there is one.
    pub next: Option<u32>,
    pub dispositions: Vec<(ExceptionDispositionRecord, String)>,
}

/// Why a viewer read refused.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExceptionsReadError {
    Task(TaskError),
    /// The cursor names no exception of this Task.
    Cursor,
}
impl From<TaskError> for ExceptionsReadError {
    fn from(error: TaskError) -> Self {
        Self::Task(error)
    }
}

fn record_of(row: &PgRow) -> Result<ExceptionRecord, ReadingError> {
    let get =
        |name: &str| -> Result<String, ReadingError> { row.try_get(name).map_err(unavailable) };
    Ok(ExceptionRecord {
        id: get("id")?,
        task_id: get("task_id")?,
        actor_id: get("actor_id")?,
        criterion_root: get("criterion_root")?,
        subject: get("subject")?,
        first_source_kind: OccurrenceSource::parse(&get("first_source_kind")?)
            .ok_or(ReadingError::Unavailable)?,
        first_source_id: get("first_source_id")?,
        recorded_us: Some(row.try_get("created_us").map_err(unavailable)?),
    })
}
fn occurrence_of(row: &PgRow) -> Result<OccurrenceRecord, ReadingError> {
    let get =
        |name: &str| -> Result<String, ReadingError> { row.try_get(name).map_err(unavailable) };
    let ordinal: Option<i32> = row.try_get("member_ordinal").map_err(unavailable)?;
    let seq: i32 = row.try_get("seq").map_err(unavailable)?;
    Ok(OccurrenceRecord {
        exception_id: get("exception_id")?,
        source_kind: OccurrenceSource::parse(&get("source_kind")?)
            .ok_or(ReadingError::Unavailable)?,
        source_id: get("source_id")?,
        population_id: row.try_get("population_id").map_err(unavailable)?,
        member_ordinal: ordinal.map(|o| o as u32),
        criterion_id: get("criterion_id")?,
        basis_id: get("basis_id")?,
        origin: EffectiveOrigin::parse(&get("origin")?).ok_or(ReadingError::Unavailable)?,
        evidence: row.try_get("evidence").map_err(unavailable)?,
        source_us: row.try_get("source_us").map_err(unavailable)?,
        seq: seq as u32,
        actor_id: get("actor_id")?,
    })
}

fn viewer_error(error: ReadingError) -> TaskError {
    match error {
        ReadingError::Denied | ReadingError::Fenced => TaskError::Denied,
        _ => TaskError::Unavailable,
    }
}

/// The views of these derived entries: their records, occurrence counts,
/// disposition counts and newest dispositions with the person's label.
async fn views_of(
    tx: &mut Tx,
    task_id: &str,
    entries: Vec<ExceptionEntry>,
) -> Result<Vec<ExceptionView>, TaskError> {
    let ids: Vec<&String> = entries.iter().map(|e| &e.id).collect();
    let records: BTreeMap<String, ExceptionRecord> = sqlx::query("SELECT id,task_id,actor_id,criterion_root,subject,first_source_kind,first_source_id,created_us FROM public.assessment_exceptions WHERE task_id=$1 AND id = ANY($2)")
        .bind(task_id).bind(&ids)
        .fetch_all(&mut **tx).await.map_err(|_| TaskError::Unavailable)?
        .iter().map(|r| record_of(r).map(|r| (r.id.clone(), r)))
        .collect::<Result<_, _>>().map_err(viewer_error)?;
    let counts: BTreeMap<String, i64> = sqlx::query_as::<_, (String, i64)>("SELECT exception_id, count(*) FROM public.assessment_exception_occurrences WHERE task_id=$1 AND exception_id = ANY($2) GROUP BY exception_id")
        .bind(task_id).bind(&ids)
        .fetch_all(&mut **tx).await.map_err(|_| TaskError::Unavailable)?
        .into_iter().collect();
    let disposed: BTreeMap<String, i64> = sqlx::query_as::<_, (String, i64)>("SELECT exception_id, count(*) FROM public.assessment_exception_dispositions WHERE task_id=$1 AND exception_id = ANY($2) GROUP BY exception_id")
        .bind(task_id).bind(&ids)
        .fetch_all(&mut **tx).await.map_err(|_| TaskError::Unavailable)?
        .into_iter().collect();
    let newest: Vec<PgRow> = sqlx::query("SELECT DISTINCT ON (exception_id) exception_id, document, digest, created_us FROM public.assessment_exception_dispositions WHERE task_id=$1 AND exception_id = ANY($2) ORDER BY exception_id, seq DESC")
        .bind(task_id).bind(&ids)
        .fetch_all(&mut **tx).await.map_err(|_| TaskError::Unavailable)?;
    let mut decided: BTreeMap<String, ExceptionDispositionRecord> = BTreeMap::new();
    for row in &newest {
        let record = exception_disposition_from(row).map_err(viewer_error)?;
        decided.insert(record.request.exception_id.clone(), record);
    }
    let labels = labels_of(tx, decided.values().map(|d| d.actor_id.clone())).await?;
    entries
        .into_iter()
        .map(|e| {
            let record = records.get(&e.id).cloned().ok_or(TaskError::Unavailable)?;
            let disposition = decided.remove(&e.id).map(|d| {
                let label = labels.get(&d.actor_id).cloned().unwrap_or_default();
                (d, label)
            });
            Ok(ExceptionView {
                record,
                status: e.status,
                latest_observed: e.latest_observed,
                occurrences: counts.get(&e.id).copied().unwrap_or(0) as u64,
                dispositions: disposed.get(&e.id).copied().unwrap_or(0) as u64,
                disposition,
            })
        })
        .collect()
}

impl AssessmentRepository {
    /// Viewer read (current audit scope by RLS): one page of the Task's
    /// exceptions after `after` (an exception ID, the previous page's last),
    /// with their derived status, the exact counts by status over all of
    /// them and the newest effective summaries.
    pub async fn exceptions_view(
        &self,
        actor: &str,
        s: &Scope,
        task_id: &str,
        after: Option<&str>,
    ) -> Result<ExceptionsView, ExceptionsReadError> {
        if !valid_scope_id(task_id) || after.is_some_and(|a| !valid_exception_id(a)) {
            return Err(TaskError::Denied.into());
        }
        let mut tx = scoped(&self.pool, actor, s).await.map_err(viewer_error)?;
        let may = match may_close(&mut tx, actor, s, task_id).await {
            Ok(Some(may)) => may,
            Ok(None) => return Err(TaskError::Denied.into()),
            Err(_) => return Err(TaskError::Unavailable.into()),
        };
        // The keyset page: C-ordered (subject, criterion lineage, ID) after
        // the cursor's exception, one more to know whether others follow.
        let anchor: Option<(String, String)> = match after {
            None => None,
            Some(id) => Some(
                sqlx::query_as("SELECT subject, criterion_root FROM public.assessment_exceptions WHERE task_id=$1 AND id=$2")
                    .bind(task_id).bind(id)
                    .fetch_optional(&mut *tx).await.map_err(|_| TaskError::Unavailable)?
                    .ok_or(ExceptionsReadError::Cursor)?,
            ),
        };
        let mut ids: Vec<String> = sqlx::query_scalar("SELECT id FROM public.assessment_exceptions WHERE task_id=$1
            AND ($2::text IS NULL OR (subject COLLATE \"C\", criterion_root COLLATE \"C\", id COLLATE \"C\") > ($2::text COLLATE \"C\", $3::text COLLATE \"C\", $4::text COLLATE \"C\"))
            ORDER BY subject COLLATE \"C\", criterion_root COLLATE \"C\", id COLLATE \"C\" LIMIT $5")
            .bind(task_id)
            .bind(anchor.as_ref().map(|a| &a.0)).bind(anchor.as_ref().map(|a| &a.1)).bind(after)
            .bind(EXCEPTION_PAGE as i64 + 1)
            .fetch_all(&mut *tx).await.map_err(|_| TaskError::Unavailable)?;
        let more = ids.len() > EXCEPTION_PAGE;
        ids.truncate(EXCEPTION_PAGE);
        let page = derived(&mut tx, s, task_id, &ids)
            .await
            .map_err(viewer_error)?;
        if page.len() != ids.len() {
            return Err(TaskError::Unavailable.into());
        }
        let next = more.then(|| ids.last().cloned()).flatten();
        let counts = status_counts(&mut tx, s, task_id)
            .await
            .map_err(viewer_error)?
            .total();
        let exceptions = views_of(&mut tx, task_id, page).await?;
        let snapshot = exception_snapshot(&mut tx, s, task_id)
            .await
            .map_err(viewer_error)?;
        task::admission_fence(&mut tx, actor, s, None).await?;
        tx.commit().await.map_err(|_| TaskError::Unavailable)?;
        Ok(ExceptionsView {
            exceptions,
            counts,
            next,
            may_close: may,
            summaries: snapshot.summaries,
            total_summaries: snapshot.total_summaries,
        })
    }

    /// Viewer read: one exception, a page of its occurrences (in their order,
    /// after the place `after`) and every disposition.
    pub async fn exception_detail(
        &self,
        actor: &str,
        s: &Scope,
        task_id: &str,
        exception_id: &str,
        after: u32,
    ) -> Result<Option<ExceptionDetail>, TaskError> {
        if !valid_scope_id(task_id) || !valid_exception_id(exception_id) {
            return Err(TaskError::Denied);
        }
        let mut tx = scoped(&self.pool, actor, s).await.map_err(viewer_error)?;
        // Only a person of this engagement learns whether it exists.
        task::admission_fence(&mut tx, actor, s, None).await?;
        let found = derived(&mut tx, s, task_id, &[exception_id.to_string()])
            .await
            .map_err(viewer_error)?;
        let Some(entry) = found.into_iter().next() else {
            tx.commit().await.map_err(|_| TaskError::Unavailable)?;
            return Ok(None);
        };
        let rows = sqlx::query("SELECT exception_id,source_kind,source_id,population_id,member_ordinal,criterion_id,basis_id,origin,evidence,source_us,seq,actor_id FROM public.assessment_exception_occurrences WHERE task_id=$1 AND exception_id=$2 AND seq > $3 ORDER BY seq LIMIT $4")
            .bind(task_id).bind(exception_id).bind(after as i32).bind(OCCURRENCE_PAGE as i64 + 1)
            .fetch_all(&mut *tx).await.map_err(|_| TaskError::Unavailable)?;
        let mut occurrences = rows
            .iter()
            .map(occurrence_of)
            .collect::<Result<Vec<_>, _>>()
            .map_err(viewer_error)?;
        let more = occurrences.len() > OCCURRENCE_PAGE;
        occurrences.truncate(OCCURRENCE_PAGE);
        let next = more.then(|| occurrences.last().map(|o| o.seq)).flatten();
        let dispositions: Vec<ExceptionDispositionRecord> = sqlx::query(&format!(
            "{DISPOSITION_SELECT} WHERE task_id=$1 AND exception_id=$2 ORDER BY seq"
        ))
        .bind(task_id)
        .bind(exception_id)
        .fetch_all(&mut *tx)
        .await
        .map_err(|_| TaskError::Unavailable)?
        .iter()
        .map(exception_disposition_from)
        .collect::<Result<_, _>>()
        .map_err(viewer_error)?;
        let labels = labels_of(&mut tx, dispositions.iter().map(|d| d.actor_id.clone())).await?;
        let mut view = views_of(&mut tx, task_id, vec![entry])
            .await?
            .pop()
            .ok_or(TaskError::Unavailable)?;
        task::admission_fence(&mut tx, actor, s, None).await?;
        tx.commit().await.map_err(|_| TaskError::Unavailable)?;
        let labelled: Vec<(ExceptionDispositionRecord, String)> = dispositions
            .into_iter()
            .map(|d| {
                let label = labels.get(&d.actor_id).cloned().unwrap_or_default();
                (d, label)
            })
            .collect();
        view.disposition = labelled.last().cloned();
        Ok(Some(ExceptionDetail {
            view,
            occurrences,
            next,
            dispositions: labelled,
        }))
    }
}

async fn labels_of(
    tx: &mut Tx,
    actors: impl Iterator<Item = String>,
) -> Result<BTreeMap<String, String>, TaskError> {
    let actors: Vec<String> = actors.collect::<BTreeSet<_>>().into_iter().collect();
    if actors.is_empty() {
        return Ok(BTreeMap::new());
    }
    Ok(sqlx::query_as::<_, (String, String)>(
        "SELECT id, display_name FROM public.identities WHERE id = ANY($1)",
    )
    .bind(&actors)
    .fetch_all(&mut **tx)
    .await
    .map_err(|_| TaskError::Unavailable)?
    .into_iter()
    .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_guard_refusal_maps_to_its_own_error() {
        let cases = [
            (
                "an exception that is closed is not closed again",
                ExceptionDispositionError::AlreadyClosed,
            ),
            (
                "only a closed exception is reopened",
                ExceptionDispositionError::NotClosed,
            ),
            (
                "an exception holds at most 16 dispositions",
                ExceptionDispositionError::Capacity,
            ),
            (
                "an exception disposition reference is a verified quote of a registered original",
                ExceptionDispositionError::ReferenceUnverified(0),
            ),
            (
                "an exception disposition is saved by an audit manager or the Task's accountable person",
                ExceptionDispositionError::NotAuthorised,
            ),
            (
                "an exception disposition is saved by a currently assigned auditor or audit manager in their own session",
                ExceptionDispositionError::Denied,
            ),
            (
                "an exception disposition names an exception of its own Task",
                ExceptionDispositionError::NotFound,
            ),
            ("something else", ExceptionDispositionError::Unavailable),
        ];
        for (message, error) in cases {
            assert_eq!(refused(message), error, "{message}");
        }
    }

    #[test]
    fn an_observation_is_read_exactly_or_not_at_all() {
        let value = serde_json::json!({"kind":"chain","id":"eval-1","at_us":5,"verdict":"met","execution":"completed","origin":"model_proposal","review":"accepted","causes":["inputs_changed"],"criterion_id":"crit-1","evidence":["a"]});
        let o = observation_of(&value).unwrap();
        assert_eq!(o.kind, ObservationKind::Chain);
        assert_eq!(o.causes, vec![RevisionCause::InputsChanged]);
        assert_eq!(o.origin, Some(EffectiveOrigin::ModelProposal));
        assert_eq!(o.review, zobba_domain::revision::ReviewState::Accepted);
        let absent = serde_json::json!({"kind":"absent","id":"pop-1","at_us":5,"verdict":null,"execution":null,"origin":null,"review":"unreviewed","causes":null,"criterion_id":null,"evidence":null});
        let o = observation_of(&absent).unwrap();
        assert_eq!((o.verdict, o.execution, o.origin), (None, None, None));
        let mut bad = value.clone();
        bad["verdict"] = serde_json::json!("probably");
        assert!(
            observation_of(&bad).is_none(),
            "an unknown verdict is unavailable"
        );
        let mut bad = value.clone();
        bad["review"] = serde_json::json!("approved");
        assert!(
            observation_of(&bad).is_none(),
            "an unknown review state is unavailable"
        );
        let mut bad = value;
        bad["causes"] = serde_json::json!(["a_new_cause"]);
        assert!(observation_of(&bad).is_none());
    }
}
