//! Story 22.6 investigation facts. Every write runs under the exact claim
//! producer's custody and current Task authority; the skill gate is the same
//! eligibility projection `SkillsStore::current_use` uses, recomputed in the
//! write's own transaction. Records are immutable (`investigation_guard`,
//! `investigation_immutable`); an identical retry returns the original.
use crate::{scope, skills::SkillsRepository, task, work::producer};
use serde_json::{Value, json};
use sqlx::{PgPool, Postgres, Row, Transaction, postgres::PgRow};
use zobba_application::{
    citation::ReadingError,
    investigation::{
        FetchOutcome, Gate, GateFacts, InvestigationRecord, InvestigationStore, InvocationFacts,
        ListedSkill, ListedStatus, MAX_CONTEXT_FACTS, MAX_RECORD_BYTES, MAX_RECORDED_NOTES,
        MethodFetch, SkillListing, SkillUse, StoredNote, UsedSkill,
    },
    skills::{CapabilityStatus, CatalogStatus, EligibilityStatus, Manifest},
    task::TaskError,
};
use zobba_domain::{
    identity::{Scope, valid_scope_id},
    investigation::{GapReason, MethodNote, NoteKind, NoteSource, UseKind, UseOutcome, UseReason},
    skills as domain,
    task::ClaimBasis,
};

type Tx = Transaction<'static, Postgres>;
const INVESTIGATION_LOCK: i64 = 2_206;

#[derive(Clone)]
pub struct InvestigationRepository {
    pool: PgPool,
}
impl InvestigationRepository {
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
fn skills_error(error: zobba_application::skills::SkillsError) -> ReadingError {
    match error {
        zobba_application::skills::SkillsError::Denied => ReadingError::Fenced,
        zobba_application::skills::SkillsError::Invalid => ReadingError::Invalid,
        _ => ReadingError::Unavailable,
    }
}
fn field<T>(row: &PgRow, name: &str) -> Result<T, ReadingError>
where
    T: for<'r> sqlx::Decode<'r, Postgres> + sqlx::Type<Postgres>,
{
    row.try_get(name).map_err(unavailable)
}
/// The claim's own transaction: organisation advisory 205, then the engagement
/// row (both in `task::lock`), the exact consumed claim producer, then a
/// per-record writer lock. `skills_work` takes advisory 205 again (a
/// transaction-level advisory lock is reentrant, so this is free) before its
/// own engagement and Task row locks, so the order is always 205 → engagement
/// → Task, the same order skill status writers (`skills_admin`) and
/// `skills_task` use. No lock this file takes is acquired out of that order,
/// so these transactions cannot deadlock with a concurrent status change.
async fn claimed(pool: &PgPool, basis: &ClaimBasis, key: Option<&str>) -> Result<Tx, ReadingError> {
    let mut tx = task::lock(pool, &basis.actor_id, &basis.scope)
        .await
        .map_err(task_error)?;
    producer(&mut tx, basis).await.map_err(task_error)?;
    if let Some(key) = key {
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,$2))")
            .bind(key)
            .bind(INVESTIGATION_LOCK)
            .execute(&mut *tx)
            .await
            .map_err(unavailable)?;
    }
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

/// One claim's fresh eligibility projection.
async fn inspect(
    pool: &PgPool,
    tx: &mut Tx,
    basis: &ClaimBasis,
) -> Result<crate::skills::WorkInspection, ReadingError> {
    SkillsRepository::new(pool.clone())
        .for_work_claim(&basis.claim_id, &basis.process_instance)
        .work_inspection(tx, &basis.scope, &basis.task_id)
        .await
        .map_err(skills_error)
}

fn need_status(
    manifest: &Manifest,
    inspection: &zobba_application::skills::Inspection,
) -> Vec<(String, CapabilityStatus)> {
    manifest
        .needs
        .iter()
        .map(|need| {
            (
                need.tool.clone(),
                inspection
                    .needs
                    .iter()
                    .find(|n| n.id == need.id)
                    .map_or(CapabilityStatus::Unavailable, |n| n.status),
            )
        })
        .collect()
}

/// Enabled, method-compatible versions are listed, with their need status.
fn listing_of(inspection: &crate::skills::WorkInspection) -> SkillListing {
    let skills = inspection
        .versions
        .iter()
        .filter(|(version, eligibility, compatibility)| {
            version.status == CatalogStatus::Enabled
                && inspection.method_allowed
                && *compatibility == domain::MethodCompatibility::Applicable
                && matches!(
                    eligibility.status,
                    EligibilityStatus::Eligible
                        | EligibilityStatus::Unavailable
                        | EligibilityStatus::Forbidden
                )
        })
        .map(|(version, eligibility, _)| {
            let manifest = &version.command.manifest;
            ListedSkill {
                version_id: version.id.clone(),
                skill_id: manifest.id.clone(),
                skill_version: manifest.version.clone(),
                name: manifest.name.clone(),
                description: manifest.description.clone(),
                digest: version.digest.clone(),
                status: if eligibility.selectable() {
                    ListedStatus::Available
                } else if eligibility.status == EligibilityStatus::Forbidden {
                    ListedStatus::Forbidden
                } else {
                    ListedStatus::Unavailable
                },
                needs: need_status(manifest, eligibility),
            }
        })
        .collect();
    SkillListing {
        methodology_binding_id: inspection.methodology_binding_id.clone(),
        execution_epoch: inspection.execution_epoch,
        catalog_revision: inspection.catalog_revision,
        skills,
    }
}

/// The same fresh gate as `current_use` + `Inspection::selectable()`.
fn gate_of(inspection: &crate::skills::WorkInspection, version_id: &str) -> Gate {
    let Some((version, eligibility, compatibility)) = inspection
        .versions
        .iter()
        .find(|(version, _, _)| version.id == version_id)
    else {
        return Gate::Refused(UseReason::NotListed, None);
    };
    let manifest = &version.command.manifest;
    let facts = GateFacts {
        version_id: version.id.clone(),
        skill_id: manifest.id.clone(),
        skill_version: manifest.version.clone(),
        name: manifest.name.clone(),
        digest: version.digest.clone(),
        catalog_revision: inspection.catalog_revision,
        dependency_fingerprint: eligibility.dependency_fingerprint.clone(),
    };
    let refused = match version.status {
        CatalogStatus::Disabled => Some(UseReason::Disabled),
        CatalogStatus::Recalled => Some(UseReason::Recalled),
        CatalogStatus::Enabled if !inspection.method_allowed => Some(UseReason::MethodologyBlocked),
        CatalogStatus::Enabled if *compatibility != domain::MethodCompatibility::Applicable => {
            Some(UseReason::Inapplicable)
        }
        CatalogStatus::Enabled
            if !matches!(inspection.task_state.as_str(), "ready" | "running") =>
        {
            Some(UseReason::TaskBlocked)
        }
        CatalogStatus::Enabled if eligibility.status == EligibilityStatus::Forbidden => {
            Some(UseReason::Forbidden)
        }
        CatalogStatus::Enabled if !eligibility.selectable() => Some(UseReason::ToolUnavailable),
        CatalogStatus::Enabled => None,
    };
    match refused {
        Some(reason) => Gate::Refused(reason, Some(facts)),
        None => Gate::Allowed(facts, Box::new(manifest.clone())),
    }
}

fn use_from(row: &PgRow) -> Result<SkillUse, ReadingError> {
    let skill_id: Option<String> = field(row, "skill_id")?;
    let facts = match skill_id {
        Some(skill_id) => Some(GateFacts {
            version_id: field(row, "version_id")?,
            skill_id,
            skill_version: field::<Option<String>>(row, "skill_version")?
                .ok_or(ReadingError::Unavailable)?,
            name: field::<Option<String>>(row, "name")?.ok_or(ReadingError::Unavailable)?,
            digest: field::<Option<String>>(row, "digest")?.ok_or(ReadingError::Unavailable)?,
            catalog_revision: field::<Option<i64>>(row, "catalog_revision")?.unwrap_or(0) as u64,
            dependency_fingerprint: field::<Option<String>>(row, "dependency_fingerprint")?
                .unwrap_or_default(),
        }),
        None => None,
    };
    let inputs: Value = field(row, "inputs")?;
    let stored = SkillUse {
        task_id: field(row, "task_id")?,
        cycle_id: field(row, "cycle_id")?,
        invocation_id: field(row, "invocation_id")?,
        kind: UseKind::parse(&field::<String>(row, "kind")?).ok_or(ReadingError::Unavailable)?,
        ordinal: field::<i32>(row, "ordinal")? as u32,
        version_id: field(row, "version_id")?,
        resource_id: field(row, "resource_id")?,
        facts,
        methodology_binding_id: field(row, "methodology_binding_id")?,
        execution_epoch: field::<i64>(row, "execution_epoch")? as u64,
        outcome: UseOutcome::parse(&field::<String>(row, "outcome")?)
            .ok_or(ReadingError::Unavailable)?,
        reason: field::<Option<String>>(row, "reason")?
            .map(|r| UseReason::parse(&r).ok_or(ReadingError::Unavailable))
            .transpose()?,
        job_id: field(row, "job_id")?,
        inputs: inputs
            .as_array()
            .ok_or(ReadingError::Unavailable)?
            .iter()
            .map(|v| {
                v.as_str()
                    .map(String::from)
                    .ok_or(ReadingError::Unavailable)
            })
            .collect::<Result<_, _>>()?,
        output: field(row, "output")?,
        recorded_us: Some(field(row, "created_us")?),
    };
    Ok(stored)
}
fn fetch_from(row: &PgRow) -> Result<MethodFetch, ReadingError> {
    Ok(MethodFetch {
        task_id: field(row, "task_id")?,
        cycle_id: field(row, "cycle_id")?,
        invocation_id: field(row, "invocation_id")?,
        ordinal: field::<i32>(row, "ordinal")? as u32,
        part_id: field(row, "part_id")?,
        methodology_binding_id: field(row, "methodology_binding_id")?,
        execution_epoch: field::<i64>(row, "execution_epoch")? as u64,
        outcome: FetchOutcome::parse(&field::<String>(row, "outcome")?)
            .ok_or(ReadingError::Unavailable)?,
        bytes: field::<Option<i64>>(row, "bytes")?.map(|b| b as u64),
        sha256: field(row, "sha256")?,
        recorded_us: Some(field(row, "created_us")?),
    })
}
fn note_from(row: &PgRow) -> Result<StoredNote, ReadingError> {
    let segments: Value = field(row, "segments")?;
    Ok(StoredNote {
        task_id: field(row, "task_id")?,
        cycle_id: field(row, "cycle_id")?,
        invocation_id: field(row, "invocation_id")?,
        ordinal: field::<i32>(row, "ordinal")? as u32,
        source: NoteSource::parse(&field::<String>(row, "source")?)
            .ok_or(ReadingError::Unavailable)?,
        note: MethodNote {
            requirement_id: field(row, "requirement_id")?,
            kind: NoteKind::parse(&field::<String>(row, "kind")?)
                .ok_or(ReadingError::Unavailable)?,
            text: field(row, "text")?,
            reason: field::<Option<String>>(row, "reason")?
                .map(|r| GapReason::parse(&r).ok_or(ReadingError::Unavailable))
                .transpose()?,
            segments: segments
                .as_array()
                .ok_or(ReadingError::Unavailable)?
                .iter()
                .map(|v| {
                    v.as_u64()
                        .map(|n| n as u32)
                        .ok_or(ReadingError::Unavailable)
                })
                .collect::<Result<_, _>>()?,
        },
        methodology_binding_id: field(row, "methodology_binding_id")?,
        execution_epoch: field::<i64>(row, "execution_epoch")? as u64,
        recorded_us: Some(field(row, "created_us")?),
    })
}
pub(crate) fn record_document(record: &InvestigationRecord) -> Value {
    json!({
        "task_id": record.task_id,
        "cycle_id": record.cycle_id,
        "invocation_id": record.invocation_id,
        "methodology_binding_id": record.methodology_binding_id,
        "execution_epoch": record.execution_epoch,
        "method_status": record.method_status,
        "method_version_ids": record.method_version_ids,
        "skills": record.skills.iter().map(|s| json!({
            "version_id": s.version_id, "skill_id": s.skill_id,
            "skill_version": s.skill_version, "digest": s.digest,
        })).collect::<Vec<_>>(),
        "provider": record.provider,
        "model": record.model,
        "profile_id": record.profile_id,
        "profile_revision": record.profile_revision,
        "catalogue_id": record.catalogue_id,
        "catalogue_revision": record.catalogue_revision,
        "tools": record.tools,
        "gaps": record.gaps,
        "questions": record.questions,
        "statements": record.statements,
        "omitted_notes": record.omitted_notes,
        "omitted_items": record.omitted_items,
        "discarded_requests": record.discarded_requests,
    })
}
/// The document under its CHECK bound: list entries are dropped from the end
/// (and counted) until it fits. The ID fields are bounded by their own checks.
fn bounded_record(record: &InvestigationRecord) -> Option<(InvestigationRecord, Value)> {
    let mut record = record.clone();
    loop {
        let document = record_document(&record);
        if document.to_string().len() <= MAX_RECORD_BYTES - 1024 {
            return Some((record, document));
        }
        let longest = [
            record.skills.len(),
            record.method_version_ids.len(),
            record.tools.len(),
        ];
        match longest.iter().enumerate().max_by_key(|(_, n)| **n) {
            Some((_, 0)) | None => return None,
            Some((0, _)) => drop(record.skills.pop()),
            Some((1, _)) => drop(record.method_version_ids.pop()),
            _ => drop(record.tools.pop()),
        }
        record.omitted_items += 1;
    }
}
pub(crate) fn record_from(document: &Value) -> Option<InvestigationRecord> {
    let text = |key: &str| document.get(key)?.as_str().map(String::from);
    let number = |key: &str| document.get(key)?.as_u64();
    let strings = |key: &str| -> Option<Vec<String>> {
        document
            .get(key)?
            .as_array()?
            .iter()
            .map(|v| v.as_str().map(String::from))
            .collect()
    };
    Some(InvestigationRecord {
        task_id: text("task_id")?,
        cycle_id: text("cycle_id")?,
        invocation_id: text("invocation_id")?,
        methodology_binding_id: text("methodology_binding_id")?,
        execution_epoch: number("execution_epoch")?,
        method_status: text("method_status")?,
        method_version_ids: strings("method_version_ids")?,
        skills: document
            .get("skills")?
            .as_array()?
            .iter()
            .map(|s| {
                Some(UsedSkill {
                    version_id: s.get("version_id")?.as_str()?.into(),
                    skill_id: s.get("skill_id")?.as_str()?.into(),
                    skill_version: s.get("skill_version")?.as_str()?.into(),
                    digest: s.get("digest")?.as_str()?.into(),
                })
            })
            .collect::<Option<_>>()?,
        provider: text("provider")?,
        model: text("model")?,
        profile_id: text("profile_id")?,
        profile_revision: number("profile_revision")?,
        catalogue_id: text("catalogue_id")?,
        catalogue_revision: number("catalogue_revision")?,
        tools: strings("tools")?,
        gaps: number("gaps")? as u32,
        questions: number("questions")? as u32,
        statements: number("statements")? as u32,
        omitted_notes: number("omitted_notes").unwrap_or(0) as u32,
        omitted_items: number("omitted_items").unwrap_or(0) as u32,
        discarded_requests: number("discarded_requests").unwrap_or(0) as u32,
    })
}

async fn cycle_uses(
    tx: &mut Tx,
    task_id: &str,
    cycle_id: &str,
) -> Result<Vec<SkillUse>, ReadingError> {
    // The newest facts, returned in record order: a bounded read never drops
    // the latest uses in favour of the oldest.
    sqlx::query("SELECT * FROM (SELECT * FROM public.task_skill_uses WHERE task_id=$1 AND cycle_id=$2 ORDER BY created_us DESC,invocation_id COLLATE \"C\" DESC,kind COLLATE \"C\" DESC,ordinal DESC LIMIT $3) u ORDER BY created_us,invocation_id COLLATE \"C\",kind COLLATE \"C\",ordinal")
        .bind(task_id)
        .bind(cycle_id)
        .bind(MAX_CONTEXT_FACTS as i64)
        .fetch_all(&mut **tx)
        .await
        .map_err(unavailable)?
        .iter()
        .map(use_from)
        .collect()
}
async fn cycle_count(
    tx: &mut Tx,
    table: &str,
    task_id: &str,
    cycle_id: &str,
) -> Result<u64, ReadingError> {
    let count: i64 = sqlx::query_scalar(&format!(
        "SELECT count(*) FROM public.{table} WHERE task_id=$1 AND cycle_id=$2"
    ))
    .bind(task_id)
    .bind(cycle_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(unavailable)?;
    Ok(count as u64)
}
async fn cycle_notes(
    tx: &mut Tx,
    task_id: &str,
    cycle_id: &str,
) -> Result<Vec<StoredNote>, ReadingError> {
    sqlx::query("SELECT * FROM (SELECT * FROM public.task_method_notes WHERE task_id=$1 AND cycle_id=$2 ORDER BY created_us DESC,invocation_id COLLATE \"C\" DESC,ordinal DESC LIMIT $3) n ORDER BY created_us,invocation_id COLLATE \"C\",ordinal")
        .bind(task_id)
        .bind(cycle_id)
        .bind((MAX_CONTEXT_FACTS * 2) as i64)
        .fetch_all(&mut **tx)
        .await
        .map_err(unavailable)?
        .iter()
        .map(note_from)
        .collect()
}

impl InvestigationStore for InvestigationRepository {
    async fn listing(&self, basis: &ClaimBasis) -> Result<SkillListing, ReadingError> {
        let mut tx = claimed(&self.pool, basis, None).await?;
        let inspection = inspect(&self.pool, &mut tx, basis).await?;
        tx.commit().await.map_err(unavailable)?;
        Ok(listing_of(&inspection))
    }
    async fn gate(&self, basis: &ClaimBasis, version_id: &str) -> Result<Gate, ReadingError> {
        if !valid_scope_id(version_id) {
            return Ok(Gate::Refused(UseReason::NotListed, None));
        }
        let mut tx = claimed(&self.pool, basis, None).await?;
        let inspection = inspect(&self.pool, &mut tx, basis).await?;
        tx.commit().await.map_err(unavailable)?;
        Ok(gate_of(&inspection, version_id))
    }
    async fn record_use(
        &self,
        basis: &ClaimBasis,
        proposed: &SkillUse,
    ) -> Result<(SkillUse, Option<Box<Manifest>>), ReadingError> {
        if proposed.task_id != basis.task_id
            || proposed.cycle_id != basis.cycle_id
            || !valid_scope_id(&proposed.invocation_id)
            || !valid_scope_id(&proposed.version_id)
        {
            return Err(ReadingError::Invalid);
        }
        let key = format!(
            "skill-use:{}:{}:{}",
            proposed.invocation_id,
            proposed.kind.as_str(),
            proposed.ordinal
        );
        let mut tx = claimed(&self.pool, basis, Some(&key)).await?;
        if let Some(row) = sqlx::query("SELECT * FROM public.task_skill_uses WHERE invocation_id=$1 AND kind=$2 AND ordinal=$3")
            .bind(&proposed.invocation_id)
            .bind(proposed.kind.as_str())
            .bind(proposed.ordinal as i32)
            .fetch_optional(&mut *tx)
            .await
            .map_err(unavailable)?
        {
            // The first recorded fact for this request is the fact; a later
            // gate never rewrites it.
            let stored = use_from(&row)?;
            tx.commit().await.map_err(unavailable)?;
            return Ok((stored, None));
        }
        let inspection = inspect(&self.pool, &mut tx, basis).await?;
        let mut stored = proposed.clone();
        stored.recorded_us = None;
        let mut content = None;
        // A refused use keeps its link to a job that already ran (a script
        // refused after its run); it only loses outputs it may not supply.
        let refuse = |stored: &mut SkillUse, reason: UseReason| {
            stored.outcome = UseOutcome::Unavailable;
            stored.reason = Some(reason);
            stored.output = None;
        };
        match gate_of(&inspection, &proposed.version_id) {
            Gate::Refused(reason, facts) => {
                stored.facts = facts;
                refuse(&mut stored, reason);
            }
            Gate::Allowed(facts, _)
                if !zobba_domain::permissions::valid_digest(&facts.dependency_fingerprint) =>
            {
                // A performed use must name its dependency facts; an allowed
                // gate without them is refused with a fixed reason.
                stored.facts = Some(facts);
                refuse(&mut stored, UseReason::ToolUnavailable);
            }
            Gate::Allowed(facts, manifest) => {
                let digest = facts.digest.clone();
                stored.facts = Some(facts);
                let loaded = proposed.kind == UseKind::Load
                    || sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM public.task_skill_uses WHERE task_id=$1 AND cycle_id=$2 AND kind='load' AND outcome='loaded' AND version_id=$3 AND digest=$4 AND methodology_binding_id=$5 AND execution_epoch=$6)")
                        .bind(&basis.task_id)
                        .bind(&basis.cycle_id)
                        .bind(&proposed.version_id)
                        .bind(&digest)
                        .bind(&proposed.methodology_binding_id)
                        .bind(proposed.execution_epoch as i64)
                        .fetch_one(&mut *tx)
                        .await
                        .map_err(unavailable)?;
                if proposed.methodology_binding_id != inspection.methodology_binding_id
                    || proposed.execution_epoch != inspection.execution_epoch
                {
                    // The method changed after the requesting turn.
                    refuse(&mut stored, UseReason::MethodologyBlocked);
                } else if !loaded {
                    refuse(&mut stored, UseReason::NotLoaded);
                } else if stored.outcome != UseOutcome::Unavailable {
                    content = Some(manifest);
                }
            }
        }
        if !stored.is_valid() {
            return Err(ReadingError::Invalid);
        }
        let s = &basis.scope;
        let facts = stored.facts.as_ref();
        sqlx::query("INSERT INTO public.task_skill_uses(organisation_id,client_id,engagement_id,task_id,cycle_id,actor_id,invocation_id,kind,ordinal,version_id,resource_id,skill_id,skill_version,name,digest,catalog_revision,dependency_fingerprint,methodology_binding_id,execution_epoch,outcome,reason,job_id,inputs,output) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)")
            .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id)
            .bind(&stored.task_id).bind(&stored.cycle_id).bind(&basis.actor_id)
            .bind(&stored.invocation_id).bind(stored.kind.as_str()).bind(stored.ordinal as i32)
            .bind(&stored.version_id).bind(&stored.resource_id)
            .bind(facts.map(|f| &f.skill_id)).bind(facts.map(|f| &f.skill_version))
            .bind(facts.map(|f| &f.name)).bind(facts.map(|f| &f.digest))
            .bind(facts.map(|f| f.catalog_revision as i64))
            .bind(facts.map(|f| &f.dependency_fingerprint).filter(|f| !f.is_empty()))
            .bind(&stored.methodology_binding_id).bind(stored.execution_epoch as i64)
            .bind(stored.outcome.as_str()).bind(stored.reason.map(UseReason::as_str))
            .bind(&stored.job_id).bind(json!(stored.inputs)).bind(&stored.output)
            .execute(&mut *tx).await.map_err(refusal)?;
        let row = sqlx::query("SELECT * FROM public.task_skill_uses WHERE invocation_id=$1 AND kind=$2 AND ordinal=$3")
            .bind(&stored.invocation_id)
            .bind(stored.kind.as_str())
            .bind(stored.ordinal as i32)
            .fetch_one(&mut *tx)
            .await
            .map_err(unavailable)?;
        let stored = use_from(&row)?;
        task::admission_fence(&mut tx, &basis.actor_id, s, None)
            .await
            .map_err(task_error)?;
        tx.commit().await.map_err(unavailable)?;
        Ok((stored, content))
    }
    async fn uses(&self, basis: &ClaimBasis) -> Result<Vec<SkillUse>, ReadingError> {
        let mut tx = scoped(&self.pool, &basis.actor_id, &basis.scope).await?;
        let uses = cycle_uses(&mut tx, &basis.task_id, &basis.cycle_id).await?;
        tx.commit().await.map_err(unavailable)?;
        Ok(uses)
    }
    async fn record_fetch(
        &self,
        basis: &ClaimBasis,
        fetch: &MethodFetch,
    ) -> Result<MethodFetch, ReadingError> {
        if fetch.task_id != basis.task_id || fetch.cycle_id != basis.cycle_id {
            return Err(ReadingError::Invalid);
        }
        let key = format!("method-fetch:{}:{}", fetch.invocation_id, fetch.ordinal);
        let mut tx = claimed(&self.pool, basis, Some(&key)).await?;
        let select =
            "SELECT * FROM public.task_method_fetches WHERE invocation_id=$1 AND ordinal=$2";
        if let Some(row) = sqlx::query(select)
            .bind(&fetch.invocation_id)
            .bind(fetch.ordinal as i32)
            .fetch_optional(&mut *tx)
            .await
            .map_err(unavailable)?
        {
            let stored = fetch_from(&row)?;
            tx.commit().await.map_err(unavailable)?;
            // An identical retry returns the fact; a different one is refused.
            let same = MethodFetch {
                recorded_us: None,
                ..stored.clone()
            } == MethodFetch {
                recorded_us: None,
                ..fetch.clone()
            };
            return if same {
                Ok(stored)
            } else {
                Err(ReadingError::Invalid)
            };
        }
        let s = &basis.scope;
        sqlx::query("INSERT INTO public.task_method_fetches(organisation_id,client_id,engagement_id,task_id,cycle_id,actor_id,invocation_id,ordinal,part_id,methodology_binding_id,execution_epoch,outcome,bytes,sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)")
            .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id)
            .bind(&fetch.task_id).bind(&fetch.cycle_id).bind(&basis.actor_id)
            .bind(&fetch.invocation_id).bind(fetch.ordinal as i32).bind(&fetch.part_id)
            .bind(&fetch.methodology_binding_id).bind(fetch.execution_epoch as i64)
            .bind(fetch.outcome.as_str()).bind(fetch.bytes.map(|b| b as i64)).bind(&fetch.sha256)
            .execute(&mut *tx).await.map_err(refusal)?;
        let row = sqlx::query(select)
            .bind(&fetch.invocation_id)
            .bind(fetch.ordinal as i32)
            .fetch_one(&mut *tx)
            .await
            .map_err(unavailable)?;
        let stored = fetch_from(&row)?;
        tx.commit().await.map_err(unavailable)?;
        Ok(stored)
    }
    async fn fetches(&self, basis: &ClaimBasis) -> Result<Vec<MethodFetch>, ReadingError> {
        let mut tx = scoped(&self.pool, &basis.actor_id, &basis.scope).await?;
        let rows = sqlx::query("SELECT * FROM (SELECT * FROM public.task_method_fetches WHERE task_id=$1 AND cycle_id=$2 ORDER BY created_us DESC,invocation_id COLLATE \"C\" DESC,ordinal DESC LIMIT $3) f ORDER BY created_us,invocation_id COLLATE \"C\",ordinal")
            .bind(&basis.task_id)
            .bind(&basis.cycle_id)
            .bind(MAX_CONTEXT_FACTS as i64)
            .fetch_all(&mut *tx)
            .await
            .map_err(unavailable)?;
        let fetches = rows.iter().map(fetch_from).collect::<Result<_, _>>()?;
        tx.commit().await.map_err(unavailable)?;
        Ok(fetches)
    }
    async fn record_notes(
        &self,
        basis: &ClaimBasis,
        invocation_id: &str,
        notes: &[StoredNote],
    ) -> Result<Vec<StoredNote>, ReadingError> {
        if notes.len() > MAX_RECORDED_NOTES
            || notes.iter().any(|n| {
                n.invocation_id != invocation_id
                    || n.task_id != basis.task_id
                    || n.cycle_id != basis.cycle_id
                    || !n.note.is_valid()
            })
        {
            return Err(ReadingError::Invalid);
        }
        let key = format!("method-notes:{invocation_id}");
        let mut tx = claimed(&self.pool, basis, Some(&key)).await?;
        let select =
            "SELECT * FROM public.task_method_notes WHERE invocation_id=$1 ORDER BY ordinal";
        let existing: Vec<StoredNote> = sqlx::query(select)
            .bind(invocation_id)
            .fetch_all(&mut *tx)
            .await
            .map_err(unavailable)?
            .iter()
            .map(note_from)
            .collect::<Result<_, _>>()?;
        if !existing.is_empty() {
            tx.commit().await.map_err(unavailable)?;
            let same = existing.len() == notes.len()
                && existing.iter().zip(notes).all(|(a, b)| {
                    StoredNote {
                        recorded_us: None,
                        ..a.clone()
                    } == StoredNote {
                        recorded_us: None,
                        ..b.clone()
                    }
                });
            return if same {
                Ok(existing)
            } else {
                Err(ReadingError::Invalid)
            };
        }
        let s = &basis.scope;
        for note in notes {
            sqlx::query("INSERT INTO public.task_method_notes(organisation_id,client_id,engagement_id,task_id,cycle_id,actor_id,invocation_id,ordinal,source,requirement_id,kind,text,reason,segments,methodology_binding_id,execution_epoch) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)")
                .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id)
                .bind(&note.task_id).bind(&note.cycle_id).bind(&basis.actor_id)
                .bind(&note.invocation_id).bind(note.ordinal as i32).bind(note.source.as_str())
                .bind(&note.note.requirement_id).bind(note.note.kind.as_str()).bind(&note.note.text)
                .bind(note.note.reason.map(GapReason::as_str)).bind(json!(note.note.segments))
                .bind(&note.methodology_binding_id).bind(note.execution_epoch as i64)
                .execute(&mut *tx).await.map_err(refusal)?;
        }
        let stored = sqlx::query(select)
            .bind(invocation_id)
            .fetch_all(&mut *tx)
            .await
            .map_err(unavailable)?
            .iter()
            .map(note_from)
            .collect::<Result<_, _>>()?;
        tx.commit().await.map_err(unavailable)?;
        Ok(stored)
    }
    async fn notes(&self, basis: &ClaimBasis) -> Result<Vec<StoredNote>, ReadingError> {
        let mut tx = scoped(&self.pool, &basis.actor_id, &basis.scope).await?;
        let notes = cycle_notes(&mut tx, &basis.task_id, &basis.cycle_id).await?;
        tx.commit().await.map_err(unavailable)?;
        Ok(notes)
    }
    async fn record_investigation(
        &self,
        basis: &ClaimBasis,
        record: &InvestigationRecord,
    ) -> Result<(), ReadingError> {
        if record.task_id != basis.task_id || record.cycle_id != basis.cycle_id {
            return Err(ReadingError::Invalid);
        }
        let (bounded, document) = bounded_record(record).ok_or(ReadingError::Invalid)?;
        let key = format!("investigation:{}", record.invocation_id);
        let mut tx = claimed(&self.pool, basis, Some(&key)).await?;
        let existing: Option<Value> = sqlx::query_scalar(
            "SELECT document FROM public.task_investigation_notes WHERE invocation_id=$1",
        )
        .bind(&record.invocation_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(unavailable)?;
        match existing {
            // An identical retry; a different record for the turn is refused.
            Some(existing) => {
                if record_from(&existing).as_ref() != Some(&bounded) {
                    return Err(ReadingError::Invalid);
                }
            }
            None => {
                let s = &basis.scope;
                sqlx::query("INSERT INTO public.task_investigation_notes(organisation_id,client_id,engagement_id,task_id,cycle_id,actor_id,invocation_id,methodology_binding_id,execution_epoch,document) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)")
                    .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id)
                    .bind(&record.task_id).bind(&record.cycle_id).bind(&basis.actor_id)
                    .bind(&record.invocation_id).bind(&record.methodology_binding_id)
                    .bind(record.execution_epoch as i64).bind(document)
                    .execute(&mut *tx).await.map_err(refusal)?;
            }
        }
        tx.commit().await.map_err(unavailable)?;
        Ok(())
    }
    async fn invocation_facts(
        &self,
        basis: &ClaimBasis,
        invocation_id: &str,
    ) -> Result<InvocationFacts, ReadingError> {
        if !valid_scope_id(invocation_id) {
            return Err(ReadingError::Invalid);
        }
        let mut tx = scoped(&self.pool, &basis.actor_id, &basis.scope).await?;
        // Bounded by construction: an invocation has at most 4 loads, 8 part
        // or resource fetches, 2 scripts and 64 notes.
        let uses = sqlx::query("SELECT * FROM public.task_skill_uses WHERE task_id=$1 AND invocation_id=$2 ORDER BY kind COLLATE \"C\",ordinal")
            .bind(&basis.task_id).bind(invocation_id).fetch_all(&mut *tx).await.map_err(unavailable)?
            .iter().map(use_from).collect::<Result<_, _>>()?;
        let fetches = sqlx::query("SELECT * FROM public.task_method_fetches WHERE task_id=$1 AND invocation_id=$2 ORDER BY ordinal")
            .bind(&basis.task_id).bind(invocation_id).fetch_all(&mut *tx).await.map_err(unavailable)?
            .iter().map(fetch_from).collect::<Result<_, _>>()?;
        let notes = sqlx::query("SELECT * FROM public.task_method_notes WHERE task_id=$1 AND invocation_id=$2 ORDER BY ordinal")
            .bind(&basis.task_id).bind(invocation_id).fetch_all(&mut *tx).await.map_err(unavailable)?
            .iter().map(note_from).collect::<Result<_, _>>()?;
        let record: Option<Value> = sqlx::query_scalar("SELECT document FROM public.task_investigation_notes WHERE task_id=$1 AND invocation_id=$2")
            .bind(&basis.task_id).bind(invocation_id).fetch_optional(&mut *tx).await.map_err(unavailable)?;
        let record = record
            .map(|document| record_from(&document).ok_or(ReadingError::Unavailable))
            .transpose()?;
        tx.commit().await.map_err(unavailable)?;
        Ok(InvocationFacts {
            uses,
            fetches,
            notes,
            record,
        })
    }
    async fn loaded(
        &self,
        basis: &ClaimBasis,
        version_id: &str,
        methodology_binding_id: &str,
        execution_epoch: u64,
    ) -> Result<bool, ReadingError> {
        let mut tx = scoped(&self.pool, &basis.actor_id, &basis.scope).await?;
        let loaded: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM public.task_skill_uses WHERE task_id=$1 AND cycle_id=$2 AND kind='load' AND outcome='loaded' AND version_id=$3 AND methodology_binding_id=$4 AND execution_epoch=$5)")
            .bind(&basis.task_id).bind(&basis.cycle_id).bind(version_id).bind(methodology_binding_id).bind(execution_epoch as i64)
            .fetch_one(&mut *tx).await.map_err(unavailable)?;
        tx.commit().await.map_err(unavailable)?;
        Ok(loaded)
    }
    async fn prior_use(
        &self,
        basis: &ClaimBasis,
        recorded: &SkillUse,
    ) -> Result<bool, ReadingError> {
        let mut tx = scoped(&self.pool, &basis.actor_id, &basis.scope).await?;
        let prior: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM public.task_skill_uses u WHERE u.task_id=$1 AND u.cycle_id=$2 AND u.invocation_id<>$3 AND u.kind=$4 AND u.version_id=$5 AND u.resource_id IS NOT DISTINCT FROM $6 AND u.outcome=$7 AND u.methodology_binding_id=$8 AND u.execution_epoch=$9 AND u.created_us < coalesce($10, 9223372036854775807))")
            .bind(&basis.task_id).bind(&basis.cycle_id).bind(&recorded.invocation_id)
            .bind(recorded.kind.as_str()).bind(&recorded.version_id).bind(&recorded.resource_id)
            .bind(recorded.outcome.as_str()).bind(&recorded.methodology_binding_id)
            .bind(recorded.execution_epoch as i64).bind(recorded.recorded_us)
            .fetch_one(&mut *tx).await.map_err(unavailable)?;
        tx.commit().await.map_err(unavailable)?;
        Ok(prior)
    }
    async fn prior_fetch(
        &self,
        basis: &ClaimBasis,
        recorded: &MethodFetch,
    ) -> Result<bool, ReadingError> {
        let mut tx = scoped(&self.pool, &basis.actor_id, &basis.scope).await?;
        let prior: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM public.task_method_fetches f WHERE f.task_id=$1 AND f.cycle_id=$2 AND f.invocation_id<>$3 AND f.part_id=$4 AND f.outcome=$5 AND f.methodology_binding_id=$6 AND f.execution_epoch=$7 AND f.created_us < coalesce($8, 9223372036854775807))")
            .bind(&basis.task_id).bind(&basis.cycle_id).bind(&recorded.invocation_id)
            .bind(&recorded.part_id).bind(recorded.outcome.as_str()).bind(&recorded.methodology_binding_id)
            .bind(recorded.execution_epoch as i64).bind(recorded.recorded_us)
            .fetch_one(&mut *tx).await.map_err(unavailable)?;
        tx.commit().await.map_err(unavailable)?;
        Ok(prior)
    }
    async fn platform_gap_recorded(
        &self,
        basis: &ClaimBasis,
        requirement_id: &str,
        methodology_binding_id: &str,
    ) -> Result<bool, ReadingError> {
        let mut tx = scoped(&self.pool, &basis.actor_id, &basis.scope).await?;
        let recorded: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM public.task_method_notes WHERE task_id=$1 AND cycle_id=$2 AND source='platform' AND reason='criteria_missing' AND requirement_id=$3 AND methodology_binding_id=$4)")
            .bind(&basis.task_id).bind(&basis.cycle_id).bind(requirement_id).bind(methodology_binding_id)
            .fetch_one(&mut *tx).await.map_err(unavailable)?;
        tx.commit().await.map_err(unavailable)?;
        Ok(recorded)
    }
}

/// The current cycle's method basis, skill uses, notes and latest
/// investigation record, as the current viewer may see them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InvestigationView {
    pub cycle_id: String,
    pub methodology_binding_id: String,
    pub method_status: String,
    pub method_version_ids: Vec<String>,
    /// The newest uses (bounded), in record order, and the exact total.
    pub uses: Vec<SkillUse>,
    pub total_uses: u64,
    /// The newest notes (bounded), in record order, and the exact total.
    pub notes: Vec<StoredNote>,
    pub total_notes: u64,
    /// Open questions of the whole cycle as (invocation, ordinal), and their
    /// exact number. A question is answered once guidance is applied at a
    /// step boundary after the question's model turn: a boundary at ordinal
    /// k is applied before step k runs, so it answers questions of turns
    /// with ordinal < k; a boundary equal to the question's own turn was
    /// applied before that turn and does not answer it. A question whose turn
    /// step is not found stays open.
    pub open_questions: Vec<(String, u32)>,
    pub record: Option<InvestigationRecord>,
}

impl InvestigationRepository {
    /// Viewer read: current audit scope (RLS) and the Task's current binding.
    /// Content never leaves here: skill text, method parts and script outputs
    /// are omitted; uses carry identities, digests and closed reasons.
    pub async fn view(
        &self,
        actor: &str,
        s: &Scope,
        task_id: &str,
    ) -> Result<InvestigationView, TaskError> {
        let map = |error: ReadingError| match error {
            ReadingError::Denied | ReadingError::Fenced => TaskError::Denied,
            ReadingError::Invalid => TaskError::Invalid,
            _ => TaskError::Unavailable,
        };
        if !valid_scope_id(task_id) {
            return Err(TaskError::Denied);
        }
        let mut tx = scoped(&self.pool, actor, s).await.map_err(map)?;
        let cycle_id: String = sqlx::query_scalar("SELECT cycle_id FROM public.tasks WHERE id=$1")
            .bind(task_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|_| TaskError::Unavailable)?
            .ok_or(TaskError::Denied)?;
        let binding = crate::methodology::current_binding(&mut tx, task_id)
            .await
            .map_err(|error| match error {
                zobba_application::methodology::MethodologyError::Denied => TaskError::Denied,
                _ => TaskError::Unavailable,
            })?;
        let mut uses = cycle_uses(&mut tx, task_id, &cycle_id).await.map_err(map)?;
        for skill_use in &mut uses {
            skill_use.output = None;
        }
        let notes = cycle_notes(&mut tx, task_id, &cycle_id)
            .await
            .map_err(map)?;
        let total_uses = cycle_count(&mut tx, "task_skill_uses", task_id, &cycle_id)
            .await
            .map_err(map)?;
        let total_notes = cycle_count(&mut tx, "task_method_notes", task_id, &cycle_id)
            .await
            .map_err(map)?;
        let open_questions: Vec<(String, i32)> = sqlx::query_as("SELECT n.invocation_id,n.ordinal FROM public.task_method_notes n WHERE n.task_id=$1 AND n.cycle_id=$2 AND n.kind='question' AND NOT EXISTS(SELECT 1 FROM public.task_guidance_applications g WHERE g.task_id=n.task_id AND g.cycle_id=n.cycle_id AND g.boundary_ordinal > (SELECT min(s.ordinal) FROM public.task_steps s WHERE s.task_id=n.task_id AND s.cycle_id=n.cycle_id AND s.invocation_id=n.invocation_id AND s.kind='model_turn')) ORDER BY n.created_us,n.invocation_id COLLATE \"C\",n.ordinal LIMIT 1024")
            .bind(task_id)
            .bind(&cycle_id)
            .fetch_all(&mut *tx)
            .await
            .map_err(|_| TaskError::Unavailable)?;
        let record = sqlx::query("SELECT document FROM public.task_investigation_notes WHERE task_id=$1 AND cycle_id=$2 ORDER BY created_us DESC,invocation_id COLLATE \"C\" DESC LIMIT 1")
            .bind(task_id)
            .bind(&cycle_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|_| TaskError::Unavailable)?
            .map(|row| {
                let document: Value = row.try_get("document").map_err(|_| TaskError::Unavailable)?;
                record_from(&document).ok_or(TaskError::Unavailable)
            })
            .transpose()?;
        task::admission_fence(&mut tx, actor, s, None).await?;
        tx.commit().await.map_err(|_| TaskError::Unavailable)?;
        Ok(InvestigationView {
            cycle_id,
            methodology_binding_id: binding.id,
            method_status: zobba_application::investigation::status_text(binding.resolution.status)
                .into(),
            method_version_ids: binding.resolution.version_ids,
            uses,
            total_uses,
            notes,
            total_notes,
            open_questions: open_questions
                .into_iter()
                .map(|(invocation, ordinal)| (invocation, ordinal as u32))
                .collect(),
            record,
        })
    }
}
