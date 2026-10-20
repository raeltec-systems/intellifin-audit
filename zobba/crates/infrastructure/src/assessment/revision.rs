//! Story 24.3a: evaluation revisions, carried facts and human dispositions.
//! Revisions and carries are written under the exact claim producer's
//! custody (like every 24.1 record); dispositions under the person's exact
//! session, role and assignment. Every row is immutable (`revision_guard`,
//! `revision_batch`, `revision_complete`, `revision_first`,
//! `revision_immutable`); reads verify each stored document against its
//! digest. A chain head is always found by an exact query.
use std::collections::BTreeMap;

use super::{
    Tx, claimed, document_of, evaluation_from, fact_from, same, scoped, task_error, to_json,
    unavailable,
};
use crate::task;
use sqlx::{Row, postgres::PgRow};
use zobba_application::{
    assessment::{
        EvaluationRecord, FactRecord, MAX_BASIS_FACTS, MAX_OUTLINE_RECORDS, document_digest,
        revision::{
            BasisRevisions, CarryRecord, ChainHead, DispositionRecord, HistoryEntry, HistoryPage,
            InvocationRevisions, MAX_OUTLINE_RECONSIDERATIONS, Reconsideration, RevisionRecord,
            RevisionSnapshot, RevisionStore,
        },
    },
    citation::ReadingError,
    disposition::{DispositionError, DispositionStore, RevisionTarget},
    task::TaskError,
};
use zobba_domain::{
    assessment::Origin,
    citation::Locator,
    identity::{Scope, valid_scope_id},
    revision::{Concern, DispositionKind, HISTORY_PAGE, valid_revision_id},
    task::ClaimBasis,
};

use super::AssessmentRepository;

fn revision_from(row: &PgRow) -> Result<RevisionRecord, ReadingError> {
    let (document, created) = document_of(row)?;
    RevisionRecord::from_document(&document, Some(created)).ok_or(ReadingError::Unavailable)
}
fn disposition_from(row: &PgRow) -> Result<DispositionRecord, ReadingError> {
    let (document, created) = document_of(row)?;
    DispositionRecord::from_document(&document, Some(created)).ok_or(ReadingError::Unavailable)
}
async fn carry_from(tx: &mut Tx, row: &PgRow) -> Result<CarryRecord, ReadingError> {
    let (document, created) = document_of(row)?;
    let basis_id: String = row.try_get("basis_id").map_err(unavailable)?;
    let ids: Vec<String> = sqlx::query_scalar("SELECT fact_id FROM public.assessment_basis_carried_facts WHERE basis_id=$1 ORDER BY fact_id COLLATE \"C\" LIMIT $2")
        .bind(&basis_id)
        .bind(MAX_BASIS_FACTS as i64 + 1)
        .fetch_all(&mut **tx)
        .await
        .map_err(unavailable)?;
    if ids.len() > MAX_BASIS_FACTS {
        return Err(ReadingError::Unavailable);
    }
    let record = CarryRecord::from_document(&document, ids, Some(created))
        .ok_or(ReadingError::Unavailable)?;
    if record.basis_id != basis_id {
        return Err(ReadingError::Unavailable);
    }
    Ok(record)
}

/// The latest revision row of each chain and the latest disposition of each
/// chain's head: exact reads over the listed chains.
async fn heads_of(
    tx: &mut Tx,
    task_id: &str,
    firsts: Vec<EvaluationRecord>,
) -> Result<Vec<ChainHead>, ReadingError> {
    if firsts.is_empty() {
        return Ok(vec![]);
    }
    let ids: Vec<&String> = firsts.iter().map(|e| &e.id).collect();
    let rows = sqlx::query("SELECT r.document,r.digest,r.created_us,c.id AS chain FROM unnest($2::text[]) c(id) CROSS JOIN LATERAL (SELECT x.document,x.digest,x.created_us FROM public.assessment_evaluation_revisions x WHERE x.task_id=$1 AND x.chain_id=c.id ORDER BY x.revision DESC LIMIT 1) r")
        .bind(task_id)
        .bind(&ids)
        .fetch_all(&mut **tx)
        .await
        .map_err(unavailable)?;
    let mut latest: BTreeMap<String, RevisionRecord> = BTreeMap::new();
    for row in &rows {
        let record = revision_from(row)?;
        let chain: String = row.try_get("chain").map_err(unavailable)?;
        if record.chain_id != chain {
            return Err(ReadingError::Unavailable);
        }
        latest.insert(chain, record);
    }
    let head_ids: Vec<String> = firsts
        .iter()
        .map(|e| latest.get(&e.id).map_or(e.id.clone(), |r| r.id.clone()))
        .collect();
    let rows = sqlx::query("SELECT d.document,d.digest,d.created_us,h.id AS head FROM unnest($2::text[]) h(id) CROSS JOIN LATERAL (SELECT x.document,x.digest,x.created_us FROM public.assessment_dispositions x WHERE x.task_id=$1 AND x.revision_id=h.id ORDER BY x.created_us DESC, x.id COLLATE \"C\" DESC LIMIT 1) d")
        .bind(task_id)
        .bind(&head_ids)
        .fetch_all(&mut **tx)
        .await
        .map_err(unavailable)?;
    let mut decided: BTreeMap<String, DispositionRecord> = BTreeMap::new();
    for row in &rows {
        let record = disposition_from(row)?;
        let head: String = row.try_get("head").map_err(unavailable)?;
        if record.request.revision_id != head {
            return Err(ReadingError::Unavailable);
        }
        decided.insert(head, record);
    }
    Ok(firsts
        .into_iter()
        .map(|first| {
            let head = latest.remove(&first.id);
            let head_id = head.as_ref().map_or(first.id.clone(), |h| h.id.clone());
            ChainHead {
                disposition: decided.remove(&head_id),
                first,
                head,
            }
        })
        .collect())
}

/// Chains in the lineage of one basis and one criterion version: every
/// evaluation whose basis and criterion have the same lineage roots.
const LINEAGE: &str = "WITH RECURSIVE
 bup(id,sup,n) AS (SELECT b.id,b.supersedes,0 FROM public.assessment_bases b WHERE b.task_id=$1 AND b.id=$2
   UNION ALL SELECT b.id,b.supersedes,u.n+1 FROM public.assessment_bases b JOIN bup u ON b.id=u.sup WHERE u.n < 64),
 broot AS (SELECT id FROM bup ORDER BY n DESC LIMIT 1),
 btree(id) AS (SELECT id FROM broot UNION SELECT b.id FROM public.assessment_bases b JOIN btree t ON b.supersedes=t.id WHERE b.task_id=$1),
 cup(id,sup,n) AS (SELECT c.id,c.supersedes,0 FROM public.assessment_criteria c WHERE c.task_id=$1 AND c.id=$3
   UNION ALL SELECT c.id,c.supersedes,u.n+1 FROM public.assessment_criteria c JOIN cup u ON c.id=u.sup WHERE u.n < 64),
 croot AS (SELECT id FROM cup ORDER BY n DESC LIMIT 1),
 ctree(id) AS (SELECT id FROM croot UNION SELECT c.id FROM public.assessment_criteria c JOIN ctree t ON c.supersedes=t.id WHERE c.task_id=$1)
SELECT e.document,e.digest,e.created_us FROM public.assessment_evaluations e
 WHERE e.task_id=$1 AND e.basis_id IN (SELECT id FROM btree) AND e.criterion_id IN (SELECT id FROM ctree)
 ORDER BY e.subject COLLATE \"C\", e.id COLLATE \"C\" LIMIT $4";
/// Chains one lineage may hold in one read (subjects are bounded per basis).
const MAX_LINEAGE_CHAINS: usize = 16 * MAX_BASIS_FACTS;

impl RevisionStore for AssessmentRepository {
    async fn invocation_revisions(
        &self,
        basis: &ClaimBasis,
        invocation_id: &str,
    ) -> Result<InvocationRevisions, ReadingError> {
        if !valid_scope_id(invocation_id) {
            return Err(ReadingError::Invalid);
        }
        let mut tx = scoped(&self.pool, &basis.actor_id, &basis.scope).await?;
        let rows = sqlx::query("SELECT document,digest,created_us,basis_id FROM public.assessment_basis_carries WHERE task_id=$1 AND invocation_id=$2 ORDER BY ordinal")
            .bind(&basis.task_id)
            .bind(invocation_id)
            .fetch_all(&mut *tx)
            .await
            .map_err(unavailable)?;
        let mut carries = Vec::new();
        for row in &rows {
            carries.push(carry_from(&mut tx, row).await?);
        }
        let revisions = sqlx::query("SELECT document,digest,created_us FROM public.assessment_evaluation_revisions WHERE task_id=$1 AND invocation_id=$2 ORDER BY ordinal")
            .bind(&basis.task_id)
            .bind(invocation_id)
            .fetch_all(&mut *tx)
            .await
            .map_err(unavailable)?
            .iter()
            .map(revision_from)
            .collect::<Result<_, _>>()?;
        tx.commit().await.map_err(unavailable)?;
        Ok(InvocationRevisions { carries, revisions })
    }
    async fn carry(
        &self,
        basis: &ClaimBasis,
        basis_id: &str,
    ) -> Result<Option<CarryRecord>, ReadingError> {
        if !valid_scope_id(basis_id) {
            return Ok(None);
        }
        let mut tx = scoped(&self.pool, &basis.actor_id, &basis.scope).await?;
        let row = sqlx::query("SELECT document,digest,created_us,basis_id FROM public.assessment_basis_carries WHERE task_id=$1 AND basis_id=$2")
            .bind(&basis.task_id)
            .bind(basis_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(unavailable)?;
        let found = match &row {
            Some(row) => Some(carry_from(&mut tx, row).await?),
            None => None,
        };
        tx.commit().await.map_err(unavailable)?;
        Ok(found)
    }
    async fn effective_facts(
        &self,
        basis: &ClaimBasis,
        basis_id: &str,
    ) -> Result<Vec<FactRecord>, ReadingError> {
        let mut tx = scoped(&self.pool, &basis.actor_id, &basis.scope).await?;
        // The basis's own facts, and the facts carried into it by reference
        // that it does not record itself (the same rule as the guards).
        let rows = sqlx::query("SELECT f.document,f.digest,f.created_us FROM public.assessment_facts f WHERE f.task_id=$1 AND (f.basis_id=$2 OR (EXISTS(SELECT 1 FROM public.assessment_basis_carried_facts c WHERE c.basis_id=$2 AND c.fact_id=f.id) AND NOT EXISTS(SELECT 1 FROM public.assessment_facts o WHERE o.basis_id=$2 AND o.subject=f.subject AND o.name=f.name))) ORDER BY f.subject COLLATE \"C\", f.name COLLATE \"C\" LIMIT $3")
            .bind(&basis.task_id)
            .bind(basis_id)
            .bind(MAX_BASIS_FACTS as i64 + 1)
            .fetch_all(&mut *tx)
            .await
            .map_err(unavailable)?;
        if rows.len() > MAX_BASIS_FACTS {
            return Err(ReadingError::Capacity);
        }
        let facts = rows.iter().map(fact_from).collect::<Result<_, _>>()?;
        tx.commit().await.map_err(unavailable)?;
        Ok(facts)
    }
    async fn facts_by_id(
        &self,
        basis: &ClaimBasis,
        ids: &[String],
    ) -> Result<Vec<FactRecord>, ReadingError> {
        let ids: Vec<&String> = ids.iter().filter(|id| valid_scope_id(id)).collect();
        if ids.is_empty() {
            return Ok(vec![]);
        }
        let mut tx = scoped(&self.pool, &basis.actor_id, &basis.scope).await?;
        let found = sqlx::query("SELECT document,digest,created_us FROM public.assessment_facts WHERE task_id=$1 AND id = ANY($2) ORDER BY id COLLATE \"C\"")
            .bind(&basis.task_id)
            .bind(&ids)
            .fetch_all(&mut *tx)
            .await
            .map_err(unavailable)?
            .iter()
            .map(fact_from)
            .collect::<Result<_, _>>()?;
        tx.commit().await.map_err(unavailable)?;
        Ok(found)
    }
    async fn heads(
        &self,
        basis: &ClaimBasis,
        basis_id: &str,
        criterion_id: &str,
    ) -> Result<Vec<ChainHead>, ReadingError> {
        if !valid_scope_id(basis_id) || !valid_scope_id(criterion_id) {
            return Ok(vec![]);
        }
        let mut tx = scoped(&self.pool, &basis.actor_id, &basis.scope).await?;
        let rows = sqlx::query(LINEAGE)
            .bind(&basis.task_id)
            .bind(basis_id)
            .bind(criterion_id)
            .bind(MAX_LINEAGE_CHAINS as i64 + 1)
            .fetch_all(&mut *tx)
            .await
            .map_err(unavailable)?;
        if rows.len() > MAX_LINEAGE_CHAINS {
            return Err(ReadingError::Capacity);
        }
        let firsts: Vec<EvaluationRecord> =
            rows.iter().map(evaluation_from).collect::<Result<_, _>>()?;
        let heads = heads_of(&mut tx, &basis.task_id, firsts).await?;
        tx.commit().await.map_err(unavailable)?;
        // One chain per subject in a lineage (`revision_first`).
        if heads.windows(2).any(|w| w[0].subject() == w[1].subject()) {
            return Err(ReadingError::Unavailable);
        }
        Ok(heads)
    }
    async fn record_carry(
        &self,
        basis: &ClaimBasis,
        record: &CarryRecord,
    ) -> Result<CarryRecord, ReadingError> {
        if record.task_id != basis.task_id
            || record.cycle_id != basis.cycle_id
            || record.fact_ids.len() > MAX_BASIS_FACTS
            || record.fact_ids.windows(2).any(|w| w[0] >= w[1])
        {
            return Err(ReadingError::Invalid);
        }
        let document = record.document();
        let mut tx = claimed(
            &self.pool,
            basis,
            &format!("assessment:{}", record.basis_id),
        )
        .await?;
        let select = "SELECT document,digest,created_us,basis_id FROM public.assessment_basis_carries WHERE id=$1";
        if let Some(row) = sqlx::query(select)
            .bind(&record.id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(unavailable)?
        {
            let stored = carry_from(&mut tx, &row).await?;
            tx.commit().await.map_err(unavailable)?;
            return same(stored, record, |r| CarryRecord {
                recorded_us: None,
                ..r.clone()
            });
        }
        let s = &basis.scope;
        sqlx::query("INSERT INTO public.assessment_basis_carries(organisation_id,client_id,engagement_id,task_id,cycle_id,actor_id,invocation_id,ordinal,id,methodology_binding_id,execution_epoch,basis_id,from_basis_id,carried,document,digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)")
            .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id)
            .bind(&record.task_id).bind(&record.cycle_id).bind(&basis.actor_id)
            .bind(&record.invocation_id).bind(record.ordinal as i32).bind(&record.id)
            .bind(&record.methodology_binding_id).bind(record.execution_epoch as i64)
            .bind(&record.basis_id).bind(&record.from_basis_id).bind(record.fact_ids.len() as i32)
            .bind(to_json(&document)).bind(document_digest(&document))
            .execute(&mut *tx).await.map_err(super::refusal)?;
        // Every carried fact in one statement: the batch guard checks them
        // together.
        sqlx::query("INSERT INTO public.assessment_basis_carried_facts(organisation_id,client_id,engagement_id,task_id,actor_id,basis_id,fact_id,from_basis_id) SELECT $1,$2,$3,$4,$5,$6,f,$7 FROM unnest($8::text[]) f")
            .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id)
            .bind(&record.task_id).bind(&basis.actor_id).bind(&record.basis_id)
            .bind(&record.from_basis_id).bind(&record.fact_ids)
            .execute(&mut *tx).await.map_err(super::refusal)?;
        let row = sqlx::query(select)
            .bind(&record.id)
            .fetch_one(&mut *tx)
            .await
            .map_err(unavailable)?;
        let stored = carry_from(&mut tx, &row).await?;
        task::admission_fence(&mut tx, &basis.actor_id, s, None)
            .await
            .map_err(task_error)?;
        // The deferred completeness check runs here.
        tx.commit().await.map_err(super::refusal)?;
        Ok(stored)
    }
    async fn record_revision(
        &self,
        basis: &ClaimBasis,
        record: &RevisionRecord,
    ) -> Result<RevisionRecord, ReadingError> {
        if record.task_id != basis.task_id
            || record.cycle_id != basis.cycle_id
            || !record.is_consistent()
        {
            return Err(ReadingError::Invalid);
        }
        let document = record.document();
        let mut tx = claimed(
            &self.pool,
            basis,
            &format!("assessment:{}", record.chain_id),
        )
        .await?;
        let select = "SELECT document,digest,created_us FROM public.assessment_evaluation_revisions WHERE id=$1";
        if let Some(row) = sqlx::query(select)
            .bind(&record.id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(unavailable)?
        {
            let stored = revision_from(&row)?;
            tx.commit().await.map_err(unavailable)?;
            return same(stored, record, |r| RevisionRecord {
                recorded_us: None,
                ..r.clone()
            });
        }
        let s = &basis.scope;
        let o = &record.outcome;
        let causes: Vec<&str> = record.causes.iter().map(|c| c.as_str()).collect();
        sqlx::query("INSERT INTO public.assessment_evaluation_revisions(organisation_id,client_id,engagement_id,task_id,cycle_id,actor_id,invocation_id,ordinal,id,methodology_binding_id,execution_epoch,chain_id,revision,predecessor_id,basis_id,criterion_id,subject,applicability,execution,verdict,reason,origin,causes,document,output_digest,digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)")
            .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id)
            .bind(&record.task_id).bind(&record.cycle_id).bind(&basis.actor_id)
            .bind(&record.invocation_id).bind(record.ordinal as i32).bind(&record.id)
            .bind(&record.methodology_binding_id).bind(record.execution_epoch as i64)
            .bind(&record.chain_id).bind(record.revision as i32).bind(&record.predecessor_id)
            .bind(&record.basis_id).bind(&record.criterion_id).bind(&record.subject)
            .bind(o.applicability.as_str()).bind(o.execution.as_str())
            .bind(o.verdict.map(|v| v.as_str())).bind(o.reason.map(|r| r.as_str()))
            .bind(o.origin.as_str()).bind(&causes)
            .bind(to_json(&document)).bind(&record.output_digest).bind(document_digest(&document))
            .execute(&mut *tx).await.map_err(super::refusal)?;
        let row = sqlx::query(select)
            .bind(&record.id)
            .fetch_one(&mut *tx)
            .await
            .map_err(unavailable)?;
        let stored = revision_from(&row)?;
        task::admission_fence(&mut tx, &basis.actor_id, s, None)
            .await
            .map_err(task_error)?;
        tx.commit().await.map_err(super::refusal)?;
        Ok(stored)
    }
    async fn revision_snapshot(
        &self,
        basis: &ClaimBasis,
    ) -> Result<RevisionSnapshot, ReadingError> {
        let mut tx = scoped(&self.pool, &basis.actor_id, &basis.scope).await?;
        let snapshot = revision_snapshot(&mut tx, &basis.task_id).await?;
        tx.commit().await.map_err(unavailable)?;
        Ok(snapshot)
    }
}

/// The heads of every chain of a Task, as (chain, head ID, head basis,
/// head criterion, subject) rows: one statement used by the counts.
const HEADS: &str = "SELECT e.id AS chain, coalesce(r.id,e.id) AS head_id, coalesce(r.basis_id,e.basis_id) AS basis_id, coalesce(r.criterion_id,e.criterion_id) AS criterion_id, e.subject
 FROM public.assessment_evaluations e LEFT JOIN LATERAL (SELECT x.id,x.basis_id,x.criterion_id FROM public.assessment_evaluation_revisions x WHERE x.chain_id=e.id ORDER BY x.revision DESC LIMIT 1) r ON true
 WHERE e.task_id=$1";

async fn revision_snapshot(tx: &mut Tx, task_id: &str) -> Result<RevisionSnapshot, ReadingError> {
    // Exact counts per basis version: heads under it, revisions recorded
    // under it, and heads under it whose newest disposition asks to
    // reconsider. Bounded to the outline's basis bound (byte order).
    let rows: Vec<(String, i64, i64, i64)> = sqlx::query_as(&format!(
        "WITH h AS ({HEADS}),
          p AS (SELECT h.basis_id FROM h JOIN LATERAL (SELECT d.kind FROM public.assessment_dispositions d WHERE d.revision_id=h.head_id ORDER BY d.created_us DESC, d.id COLLATE \"C\" DESC LIMIT 1) d ON d.kind='needs_reconsideration'),
          b AS (SELECT basis_id FROM h UNION SELECT basis_id FROM public.assessment_evaluation_revisions WHERE task_id=$1)
         SELECT b.basis_id,
           (SELECT count(*) FROM h WHERE h.basis_id=b.basis_id),
           (SELECT count(*) FROM public.assessment_evaluation_revisions r WHERE r.task_id=$1 AND r.basis_id=b.basis_id),
           (SELECT count(*) FROM p WHERE p.basis_id=b.basis_id)
         FROM b ORDER BY b.basis_id COLLATE \"C\" LIMIT $2"
    ))
    .bind(task_id)
    .bind(MAX_OUTLINE_RECORDS as i64)
    .fetch_all(&mut **tx)
    .await
    .map_err(unavailable)?;
    let bases = rows
        .into_iter()
        .map(|(id, heads, revisions, pending)| {
            (
                id,
                BasisRevisions {
                    heads: heads as u64,
                    revisions: revisions as u64,
                    pending: pending as u64,
                },
            )
        })
        .collect();
    let total_revisions: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM public.assessment_evaluation_revisions WHERE task_id=$1",
    )
    .bind(task_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(unavailable)?;
    // Pending reconsiderations: the newest disposition of a head asks to
    // reconsider. Newest first, bounded, with the exact total.
    let rows = sqlx::query(&format!(
        "WITH h AS ({HEADS})
         SELECT h.basis_id, h.criterion_id, h.subject, h.head_id, d.document, d.digest, d.created_us, coalesce(i.display_name, d.actor_id) AS label, count(*) OVER () AS total
         FROM h JOIN LATERAL (SELECT x.document,x.digest,x.created_us,x.actor_id,x.kind,x.id FROM public.assessment_dispositions x WHERE x.revision_id=h.head_id ORDER BY x.created_us DESC, x.id COLLATE \"C\" DESC LIMIT 1) d ON d.kind='needs_reconsideration'
         LEFT JOIN public.identities i ON i.id=d.actor_id
         ORDER BY d.created_us DESC, h.head_id COLLATE \"C\" LIMIT $2"
    ))
    .bind(task_id)
    .bind(MAX_OUTLINE_RECONSIDERATIONS as i64)
    .fetch_all(&mut **tx)
    .await
    .map_err(unavailable)?;
    let mut total_reconsiderations = 0u64;
    let mut reconsiderations = Vec::new();
    for row in &rows {
        let record = disposition_from(row)?;
        total_reconsiderations = row.try_get::<i64, _>("total").map_err(unavailable)? as u64;
        let concern = record.request.concern.unwrap_or(Concern::Facts);
        reconsiderations.push(Reconsideration {
            basis_id: row.try_get("basis_id").map_err(unavailable)?,
            criterion_id: row.try_get("criterion_id").map_err(unavailable)?,
            subject: row.try_get("subject").map_err(unavailable)?,
            head_id: row.try_get("head_id").map_err(unavailable)?,
            actor_label: row.try_get("label").map_err(unavailable)?,
            concern,
            rationale: record.request.rationale.clone(),
        });
    }
    Ok(RevisionSnapshot {
        bases,
        reconsiderations,
        total_reconsiderations,
        total_revisions: total_revisions as u64,
    })
}

fn guard_message(error: &sqlx::Error) -> Option<String> {
    match error {
        sqlx::Error::Database(database) => Some(database.message().to_string()),
        _ => None,
    }
}
fn task_denied(error: TaskError) -> DispositionError {
    match error {
        TaskError::Denied | TaskError::Fenced => DispositionError::Denied,
        _ => DispositionError::Unavailable,
    }
}

/// The exact revision and its chain's current head, in a transaction.
async fn target_in(
    tx: &mut Tx,
    task_id: &str,
    revision_id: &str,
) -> Result<Option<RevisionTarget>, DispositionError> {
    let found: Option<(String, i32, String)> = if revision_id.starts_with("eval-") {
        sqlx::query_as(
            "SELECT id, 1, origin FROM public.assessment_evaluations WHERE task_id=$1 AND id=$2",
        )
        .bind(task_id)
        .bind(revision_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|_| DispositionError::Unavailable)?
    } else {
        sqlx::query_as("SELECT chain_id, revision, origin FROM public.assessment_evaluation_revisions WHERE task_id=$1 AND id=$2")
            .bind(task_id).bind(revision_id)
            .fetch_optional(&mut **tx).await.map_err(|_| DispositionError::Unavailable)?
    };
    let Some((chain_id, revision, origin)) = found else {
        return Ok(None);
    };
    let head: Option<(String, i32)> = sqlx::query_as("SELECT id, revision FROM public.assessment_evaluation_revisions WHERE task_id=$1 AND chain_id=$2 ORDER BY revision DESC LIMIT 1")
        .bind(task_id).bind(&chain_id)
        .fetch_optional(&mut **tx).await.map_err(|_| DispositionError::Unavailable)?;
    let (head_id, head_revision) = head.unwrap_or((chain_id.clone(), 1));
    Ok(Some(RevisionTarget {
        chain_id,
        revision: revision as u32,
        origin: Origin::parse(&origin).ok_or(DispositionError::Unavailable)?,
        head_id,
        head_revision: head_revision as u32,
    }))
}

impl DispositionStore for AssessmentRepository {
    async fn disposition_by_key(
        &self,
        actor: &str,
        scope: &Scope,
        key: &str,
    ) -> Result<Option<DispositionRecord>, DispositionError> {
        let mut tx = scoped(&self.pool, actor, scope).await?;
        let found = sqlx::query("SELECT document,digest,created_us FROM public.assessment_dispositions WHERE actor_id=$1 AND key=$2")
            .bind(actor).bind(key)
            .fetch_optional(&mut *tx).await.map_err(|_| DispositionError::Unavailable)?
            .as_ref().map(disposition_from).transpose()?;
        tx.commit()
            .await
            .map_err(|_| DispositionError::Unavailable)?;
        Ok(found)
    }
    async fn revision_target(
        &self,
        actor: &str,
        scope: &Scope,
        task_id: &str,
        revision_id: &str,
    ) -> Result<Option<RevisionTarget>, DispositionError> {
        if !valid_scope_id(task_id) || !valid_revision_id(revision_id) {
            return Err(DispositionError::Invalid);
        }
        let mut tx = scoped(&self.pool, actor, scope).await?;
        // Only a currently assigned auditor or audit manager (Admin alone is
        // not one) learns anything about the revision.
        task::admission_fence(&mut tx, actor, scope, None)
            .await
            .map_err(task_denied)?;
        let found = target_in(&mut tx, task_id, revision_id).await?;
        tx.commit()
            .await
            .map_err(|_| DispositionError::Unavailable)?;
        Ok(found)
    }
    async fn record_disposition(
        &self,
        actor: &str,
        scope: &Scope,
        session_hash: &str,
        record: &DispositionRecord,
    ) -> Result<DispositionRecord, DispositionError> {
        if record.actor_id != actor || !record.request.is_valid() {
            return Err(DispositionError::Invalid);
        }
        let mut tx = task::lock(&self.pool, actor, scope)
            .await
            .map_err(task_denied)?;
        // The exact session, role and assignment, rechecked inside the
        // write transaction (after the organisation and engagement locks).
        task::admission_fence(&mut tx, actor, scope, Some(session_hash))
            .await
            .map_err(task_denied)?;
        let select = "SELECT document,digest,created_us FROM public.assessment_dispositions WHERE actor_id=$1 AND key=$2";
        if let Some(row) = sqlx::query(select)
            .bind(actor)
            .bind(&record.request.key)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|_| DispositionError::Unavailable)?
        {
            let stored = disposition_from(&row)?;
            tx.commit()
                .await
                .map_err(|_| DispositionError::Unavailable)?;
            return if stored.request == record.request && stored.task_id == record.task_id {
                Ok(stored)
            } else {
                Err(DispositionError::Conflict)
            };
        }
        let accountable: Option<String> =
            sqlx::query_scalar("SELECT accountable_actor FROM public.tasks WHERE id=$1")
                .bind(&record.task_id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(|_| DispositionError::Unavailable)?;
        let Some(accountable) = accountable else {
            return Err(DispositionError::NotFound);
        };
        let document = record.document();
        let r = &record.request;
        let inserted = sqlx::query("INSERT INTO public.assessment_dispositions(organisation_id,client_id,engagement_id,task_id,actor_id,id,key,chain_id,revision,revision_id,kind,concern,verdict,rationale,document,digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)")
            .bind(&scope.organisation_id).bind(&scope.client_id).bind(&scope.engagement_id)
            .bind(&record.task_id).bind(actor).bind(&record.id).bind(&r.key)
            .bind(&record.chain_id).bind(record.revision as i32).bind(&r.revision_id)
            .bind(r.kind.as_str()).bind(r.concern.map(|c| c.as_str())).bind(r.verdict.map(|v| v.as_str()))
            .bind(&r.rationale).bind(to_json(&document)).bind(document_digest(&document))
            .execute(&mut *tx).await;
        if let Err(error) = inserted {
            let message = guard_message(&error).unwrap_or_default();
            drop(tx);
            return Err(if message.contains("current head") {
                // Another revision committed first: name the head now.
                match self
                    .revision_target(actor, scope, &record.task_id, &r.revision_id)
                    .await?
                {
                    Some(target) => DispositionError::RevisionSuperseded(target.head_id),
                    None => DispositionError::NotFound,
                }
            } else if message.contains("cannot be replaced") {
                DispositionError::NotReplaceable
            } else if message.contains("at most 16") {
                DispositionError::Capacity
            } else if message.contains("reference") {
                DispositionError::ReferenceUnverified(0)
            } else if message.contains("assigned auditor") {
                DispositionError::Denied
            } else {
                DispositionError::Unavailable
            });
        }
        if r.kind == DispositionKind::NeedsReconsideration {
            task::wake(&mut tx, scope, &record.task_id, &accountable)
                .await
                .map_err(task_denied)?;
        }
        let row = sqlx::query(
            "SELECT document,digest,created_us FROM public.assessment_dispositions WHERE id=$1",
        )
        .bind(&record.id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|_| DispositionError::Unavailable)?;
        let stored = disposition_from(&row)?;
        tx.commit()
            .await
            .map_err(|_| DispositionError::Unavailable)?;
        Ok(stored)
    }
    async fn verified_quotes(
        &self,
        actor: &str,
        scope: &Scope,
        original_id: &str,
        sha256: &str,
        locator: &Locator,
    ) -> Result<Vec<String>, ReadingError> {
        let mut tx = scoped(&self.pool, actor, scope).await?;
        let rendered = locator.render();
        let quotes: Vec<String> = sqlx::query_scalar("SELECT quote FROM public.assessment_fact_sources WHERE original_id=$1 AND original_sha256=$2 AND locator=$3 AND verification='verified' UNION SELECT quote FROM public.citation_sources WHERE original_id=$1 AND original_sha256=$2 AND locator=$3 AND verification='verified' ORDER BY 1 LIMIT 16")
            .bind(original_id).bind(sha256).bind(&rendered)
            .fetch_all(&mut *tx).await.map_err(unavailable)?;
        tx.commit().await.map_err(unavailable)?;
        Ok(quotes)
    }
}

impl AssessmentRepository {
    /// Viewer read: the current head of each listed chain of a Task, with
    /// the public label of the person who saved the head's newest
    /// disposition.
    pub async fn chains_view(
        &self,
        actor: &str,
        s: &Scope,
        task_id: &str,
        chain_ids: &[String],
    ) -> Result<Vec<(ChainHead, Option<String>)>, TaskError> {
        if !valid_scope_id(task_id) {
            return Err(TaskError::Denied);
        }
        let ids: Vec<&String> = chain_ids.iter().filter(|i| valid_scope_id(i)).collect();
        let mut tx = scoped(&self.pool, actor, s).await.map_err(|e| match e {
            ReadingError::Denied | ReadingError::Fenced => TaskError::Denied,
            _ => TaskError::Unavailable,
        })?;
        let firsts: Vec<EvaluationRecord> = sqlx::query("SELECT document,digest,created_us FROM public.assessment_evaluations WHERE task_id=$1 AND id = ANY($2) ORDER BY id COLLATE \"C\"")
            .bind(task_id).bind(&ids)
            .fetch_all(&mut *tx).await.map_err(|_| TaskError::Unavailable)?
            .iter().map(evaluation_from).collect::<Result<_, _>>().map_err(|_| TaskError::Unavailable)?;
        let heads = heads_of(&mut tx, task_id, firsts)
            .await
            .map_err(|_| TaskError::Unavailable)?;
        let actors: Vec<String> = heads
            .iter()
            .filter_map(|h| h.disposition.as_ref().map(|d| d.actor_id.clone()))
            .collect();
        let labels: BTreeMap<String, String> = sqlx::query_as::<_, (String, String)>(
            "SELECT id, display_name FROM public.identities WHERE id = ANY($1)",
        )
        .bind(&actors)
        .fetch_all(&mut *tx)
        .await
        .map_err(|_| TaskError::Unavailable)?
        .into_iter()
        .collect();
        task::admission_fence(&mut tx, actor, s, None).await?;
        tx.commit().await.map_err(|_| TaskError::Unavailable)?;
        Ok(heads
            .into_iter()
            .map(|h| {
                let label = h
                    .disposition
                    .as_ref()
                    .and_then(|d| labels.get(&d.actor_id).cloned());
                (h, label)
            })
            .collect())
    }

    /// Viewer read: one page of a chain's history (by revision number,
    /// after `after`), with the exact number of its revisions, every
    /// disposition of each listed revision and the facts they read.
    pub async fn history(
        &self,
        actor: &str,
        s: &Scope,
        task_id: &str,
        chain_id: &str,
        after: Option<u32>,
    ) -> Result<Option<HistoryPage>, TaskError> {
        if !valid_scope_id(task_id)
            || !chain_id.starts_with("eval-")
            || !valid_revision_id(chain_id)
        {
            return Err(TaskError::Denied);
        }
        let mut tx = scoped(&self.pool, actor, s).await.map_err(|e| match e {
            ReadingError::Denied | ReadingError::Fenced => TaskError::Denied,
            _ => TaskError::Unavailable,
        })?;
        let unavailable = |_| TaskError::Unavailable;
        let Some(first) = sqlx::query("SELECT document,digest,created_us FROM public.assessment_evaluations WHERE task_id=$1 AND id=$2")
            .bind(task_id).bind(chain_id)
            .fetch_optional(&mut *tx).await.map_err(|_| TaskError::Unavailable)?
            .as_ref().map(evaluation_from).transpose().map_err(unavailable)?
        else {
            task::admission_fence(&mut tx, actor, s, None).await?;
            tx.commit().await.map_err(|_| TaskError::Unavailable)?;
            return Ok(None);
        };
        let total: i64 = sqlx::query_scalar("SELECT 1 + count(*) FROM public.assessment_evaluation_revisions WHERE task_id=$1 AND chain_id=$2")
            .bind(task_id).bind(chain_id)
            .fetch_one(&mut *tx).await.map_err(|_| TaskError::Unavailable)?;
        let after = after.unwrap_or(0);
        let mut later: Vec<RevisionRecord> = sqlx::query("SELECT document,digest,created_us FROM public.assessment_evaluation_revisions WHERE task_id=$1 AND chain_id=$2 AND revision > $3 ORDER BY revision LIMIT $4")
            .bind(task_id).bind(chain_id).bind(after.max(1) as i32).bind(HISTORY_PAGE as i64 + 1)
            .fetch_all(&mut *tx).await.map_err(|_| TaskError::Unavailable)?
            .iter().map(revision_from).collect::<Result<_, _>>().map_err(unavailable)?;
        let head_id: String = sqlx::query_scalar("SELECT coalesce((SELECT id FROM public.assessment_evaluation_revisions WHERE task_id=$1 AND chain_id=$2 ORDER BY revision DESC LIMIT 1), $2)")
            .bind(task_id).bind(chain_id)
            .fetch_one(&mut *tx).await.map_err(|_| TaskError::Unavailable)?;
        let room = if after < 1 {
            HISTORY_PAGE - 1
        } else {
            HISTORY_PAGE
        };
        let more = later.len() > room;
        later.truncate(room);
        let mut ids: Vec<String> = later.iter().map(|r| r.id.clone()).collect();
        if after < 1 {
            ids.insert(0, first.id.clone());
        }
        let rows = sqlx::query("SELECT d.document,d.digest,d.created_us,coalesce(i.display_name,d.actor_id) AS label FROM public.assessment_dispositions d LEFT JOIN public.identities i ON i.id=d.actor_id WHERE d.task_id=$1 AND d.revision_id = ANY($2) ORDER BY d.created_us, d.id COLLATE \"C\"")
            .bind(task_id).bind(&ids)
            .fetch_all(&mut *tx).await.map_err(|_| TaskError::Unavailable)?;
        let mut by_revision: BTreeMap<String, Vec<(DispositionRecord, String)>> = BTreeMap::new();
        for row in &rows {
            let record = disposition_from(row).map_err(unavailable)?;
            let label: String = row.try_get("label").map_err(|_| TaskError::Unavailable)?;
            by_revision
                .entry(record.request.revision_id.clone())
                .or_default()
                .push((record, label));
        }
        let mut entries = Vec::new();
        if after < 1 {
            entries.push(HistoryEntry::first(
                &first,
                by_revision.remove(&first.id).unwrap_or_default(),
            ));
        }
        for r in &later {
            entries.push(HistoryEntry::later(
                r,
                by_revision.remove(&r.id).unwrap_or_default(),
            ));
        }
        let mut fact_ids: Vec<String> = entries
            .iter()
            .flat_map(|e| e.outcome.inputs.iter().map(|(id, _)| id.clone()))
            .collect();
        fact_ids.sort();
        fact_ids.dedup();
        let facts: Vec<FactRecord> = sqlx::query("SELECT document,digest,created_us FROM public.assessment_facts WHERE task_id=$1 AND id = ANY($2) ORDER BY id COLLATE \"C\"")
            .bind(task_id).bind(&fact_ids)
            .fetch_all(&mut *tx).await.map_err(|_| TaskError::Unavailable)?
            .iter().map(fact_from).collect::<Result<_, _>>().map_err(unavailable)?;
        task::admission_fence(&mut tx, actor, s, None).await?;
        tx.commit().await.map_err(|_| TaskError::Unavailable)?;
        let next = more.then(|| entries.last().map(|e| e.revision)).flatten();
        Ok(Some(HistoryPage {
            chain_id: chain_id.into(),
            subject: first.subject.clone(),
            total: total as u64,
            head_id,
            entries,
            next,
            facts,
        }))
    }
}
