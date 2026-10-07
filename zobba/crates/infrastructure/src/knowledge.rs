//! Durable, bounded projections of source owners. No object I/O occurs here.
use crate::{identity::random_secret, scope};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Postgres, Row, Transaction};
use std::collections::BTreeSet;
use zobba_application::knowledge::*;
use zobba_domain::{
    evidence::RegisteredEvidence,
    identity::{Scope, valid_scope_id},
};
type Tx = Transaction<'static, Postgres>;
const CLOSURE_LIMIT: usize = 256;
#[derive(Clone)]
pub struct KnowledgeRepository {
    pool: PgPool,
    session_hash: String,
}
fn db(error: sqlx::Error) -> KnowledgeError {
    if error
        .as_database_error()
        .and_then(|error| error.code())
        .as_deref()
        == Some("Z0002")
    {
        KnowledgeError::Denied
    } else {
        KnowledgeError::Unavailable
    }
}
fn enc(v: &impl Serialize) -> Result<Value, KnowledgeError> {
    serde_json::to_value(v).map_err(|_| KnowledgeError::Invalid)
}
fn dec<T: DeserializeOwned>(v: Value) -> Result<T, KnowledgeError> {
    serde_json::from_value(v).map_err(|_| KnowledgeError::Unavailable)
}
/// Omission reasons describe categories, not counts of inaccessible sources.
/// Retain first-emission order while making the typed response set-like.
fn unique_omissions(omissions: &mut Vec<Omission>) {
    let mut seen = Vec::new();
    omissions.retain(|reason| {
        if seen.contains(reason) {
            false
        } else {
            seen.push(reason.clone());
            true
        }
    });
}
fn token() -> Result<String, KnowledgeError> {
    random_secret().map_err(|_| KnowledgeError::Unavailable)
}
fn stable(parts: &[&str]) -> String {
    let mut h = Sha256::new();
    for p in parts {
        h.update((p.len() as u64).to_be_bytes());
        h.update(p.as_bytes());
    }
    format!("{:x}", h.finalize())
}
async fn now(tx: &mut Tx) -> Result<i64, KnowledgeError> {
    sqlx::query_scalar("SELECT floor(extract(epoch FROM clock_timestamp()))::bigint")
        .fetch_one(&mut **tx)
        .await
        .map_err(db)
}
async fn select_scope(tx: &mut Tx, s: &Scope) -> Result<(), KnowledgeError> {
    sqlx::query("SELECT set_config('zobba.organisation_id',$1,true),set_config('zobba.client_id',$2,true),set_config('zobba.engagement_id',$3,true)").bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id).execute(&mut **tx).await.map_err(db)?;
    Ok(())
}
fn source_scope(s: &KnowledgeScope) -> Option<Scope> {
    Some(Scope {
        organisation_id: s.organisation_id.clone(),
        client_id: s.client_id.clone()?,
        engagement_id: s.engagement_id.clone()?,
    })
}
async fn audit(tx: &mut Tx, actor: &str, s: &Scope) -> Result<bool, KnowledgeError> {
    let allowed: bool = sqlx::query_scalar("SELECT public.knowledge_audit($1,$2,$3,$4)")
        .bind(actor)
        .bind(&s.organisation_id)
        .bind(&s.client_id)
        .bind(&s.engagement_id)
        .fetch_one(&mut **tx)
        .await
        .map_err(db)?;
    if allowed {
        let check = json!([[actor, s.organisation_id, s.client_id, s.engagement_id]]);
        sqlx::query("SELECT set_config('zobba.knowledge_checks',CASE WHEN coalesce(nullif(current_setting('zobba.knowledge_checks',true),''),'[]')::jsonb @> $1 THEN coalesce(nullif(current_setting('zobba.knowledge_checks',true),''),'[]') ELSE (coalesce(nullif(current_setting('zobba.knowledge_checks',true),''),'[]')::jsonb || $1)::text END,true)").bind(check).execute(&mut **tx).await.map_err(db)?;
    }
    Ok(allowed)
}

impl KnowledgeRepository {
    pub fn new(pool: PgPool) -> Self {
        Self {
            pool,
            session_hash: String::new(),
        }
    }
    pub fn with_session_hash(mut self, hash: String) -> Self {
        self.session_hash = hash;
        self
    }
    async fn current(&self, tx: &mut Tx, actor: &str, org: &str) -> Result<(), KnowledgeError> {
        let ok:bool=sqlx::query_scalar("SELECT public.evidence_session_locked($1,$2) AND EXISTS(SELECT 1 FROM public.organisation_memberships WHERE organisation_id=$3 AND actor_id=$1 AND active AND (expires_at IS NULL OR expires_at>floor(extract(epoch FROM clock_timestamp()))::bigint)) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(nullif(current_setting('zobba.knowledge_checks',true),''),'[]')::jsonb) c WHERE NOT public.knowledge_audit(c->>0,c->>1,c->>2,c->>3))").bind(actor).bind(&self.session_hash).bind(org).fetch_one(&mut **tx).await.map_err(db)?;
        if ok {
            Ok(())
        } else {
            Err(KnowledgeError::Denied)
        }
    }
    async fn begin(&self, actor: &str, org: &str) -> Result<Tx, KnowledgeError> {
        if !valid_scope_id(actor)
            || !valid_scope_id(org)
            || !crate::identity::valid_secret(&self.session_hash)
        {
            return Err(KnowledgeError::Denied);
        }
        let mut tx = scope::begin_actor(&self.pool, actor)
            .await
            .map_err(|_| KnowledgeError::Unavailable)?;
        sqlx::query("SELECT set_config('zobba.organisation_id',$1,true),pg_advisory_xact_lock(hashtextextended($1,205))").bind(org).execute(&mut *tx).await.map_err(db)?;
        self.current(&mut tx, actor, org).await?;
        Ok(tx)
    }
    async fn scoped(
        &self,
        actor: &str,
        s: &Scope,
        other: Option<&Scope>,
    ) -> Result<Tx, KnowledgeError> {
        if !s.is_valid() {
            return Err(KnowledgeError::Denied);
        }
        let mut tx = self.begin(actor, &s.organisation_id).await?;
        let mut scopes = vec![s.clone()];
        if let Some(o) = other {
            if o.organisation_id != s.organisation_id || o.client_id != s.client_id {
                return Err(KnowledgeError::Denied);
            }
            scopes.push(o.clone());
        }
        scopes.sort_by(|a, b| {
            (&a.client_id, &a.engagement_id).cmp(&(&b.client_id, &b.engagement_id))
        });
        scopes.dedup();
        for selected in scopes {
            select_scope(&mut tx, &selected).await?;
            if !audit(&mut tx, actor, &selected).await? {
                return Err(KnowledgeError::Denied);
            }
            sqlx::query("SELECT id FROM public.engagements WHERE organisation_id=$1 AND client_id=$2 AND id=$3 FOR UPDATE").bind(&selected.organisation_id).bind(&selected.client_id).bind(&selected.engagement_id).fetch_optional(&mut *tx).await.map_err(db)?.ok_or(KnowledgeError::Denied)?;
        }
        select_scope(&mut tx, s).await?;
        Ok(tx)
    }
    async fn finish(
        &self,
        tx: &mut Tx,
        actor: &str,
        s: &Scope,
        consumer: Option<&str>,
    ) -> Result<(), KnowledgeError> {
        select_scope(tx, s).await?;
        sqlx::query("SET CONSTRAINTS ALL IMMEDIATE")
            .execute(&mut **tx)
            .await
            .map_err(db)?;
        self.current(tx, actor, &s.organisation_id).await?;
        if !audit(tx, actor, s).await?
            || match consumer {
                Some(c) => !audit(tx, c, s).await?,
                None => false,
            }
        {
            return Err(KnowledgeError::Denied);
        }
        Ok(())
    }
    /// Exact command facts survive loss of a separate supporting source. Only
    /// their protected projection is withdrawn; the immutable receipt is untouched.
    #[allow(clippy::too_many_arguments)]
    async fn replay_record(
        &self,
        tx: &mut Tx,
        actor: &str,
        consumer: &str,
        s: &Scope,
        task_id: &str,
        record: KnowledgeRecord,
        destination: Option<(&Scope, &str, &str)>,
    ) -> Result<Option<KnowledgeView>, KnowledgeError> {
        sqlx::query("SAVEPOINT knowledge_receipt_view")
            .execute(&mut **tx)
            .await
            .map_err(db)?;
        let refreshed = async {
            let destination_status = if let Some((scope, task, owner)) = destination {
                Some(
                    assess(tx, actor, owner, scope, task, &record)
                        .await?
                        .standing(),
                )
            } else {
                None
            };
            let mut current = checked_view(tx, actor, consumer, s, task_id, record).await?;
            if let Some((status, reason)) = destination_status
                && status != RecordStatus::Current
            {
                current = scoped_view(current.record, status, reason, s)
            }
            self.finish(tx, actor, s, Some(consumer)).await?;
            Ok::<_, KnowledgeError>(current)
        }
        .await;
        match refreshed {
            Ok(current) => {
                sqlx::query("RELEASE SAVEPOINT knowledge_receipt_view")
                    .execute(&mut **tx)
                    .await
                    .map_err(db)?;
                Ok(Some(current))
            }
            Err(KnowledgeError::Denied) => {
                // This also restores source-check custody and exact scope after
                // a failed disclosure attempt. Required Task/session fences stay.
                sqlx::query("ROLLBACK TO SAVEPOINT knowledge_receipt_view")
                    .execute(&mut **tx)
                    .await
                    .map_err(db)?;
                sqlx::query("RELEASE SAVEPOINT knowledge_receipt_view")
                    .execute(&mut **tx)
                    .await
                    .map_err(db)?;
                self.finish(tx, actor, s, Some(consumer)).await?;
                Ok(None)
            }
            Err(error) => Err(error),
        }
    }
}
async fn task(tx: &mut Tx, s: &Scope, id: &str) -> Result<(String, u64, u64), KnowledgeError> {
    if !valid_scope_id(id) {
        return Err(KnowledgeError::Invalid);
    }
    select_scope(tx, s).await?;
    let r=sqlx::query("SELECT accountable_actor,revision,execution_epoch FROM public.tasks WHERE id=$1 FOR UPDATE").bind(id).fetch_optional(&mut **tx).await.map_err(db)?.ok_or(KnowledgeError::Denied)?;
    Ok((
        r.try_get("accountable_actor").map_err(db)?,
        r.try_get::<i64, _>("revision").map_err(db)? as u64,
        r.try_get::<i64, _>("execution_epoch").map_err(db)? as u64,
    ))
}
async fn load(
    tx: &mut Tx,
    org: &str,
    id: &str,
    rev: Option<u64>,
) -> Result<KnowledgeRecord, KnowledgeError> {
    let v:Value=sqlx::query_scalar("SELECT document FROM public.knowledge_records WHERE organisation_id=$1 AND id=$2 AND ($3::bigint IS NULL OR revision=$3) ORDER BY revision DESC LIMIT 1").bind(org).bind(id).bind(rev.map(|r|r as i64)).fetch_optional(&mut **tx).await.map_err(db)?.ok_or(KnowledgeError::Denied)?;
    dec(v)
}
async fn insert(tx: &mut Tx, recorder: &str, r: &KnowledgeRecord) -> Result<(), KnowledgeError> {
    let v = enc(r)?;
    if serde_json::to_vec(&v)
        .map_err(|_| KnowledgeError::Invalid)?
        .len()
        > 60_000
    {
        return Err(KnowledgeError::Capacity);
    }
    sqlx::query("INSERT INTO public.knowledge_records(organisation_id,id,revision,actor_id,client_id,engagement_id,owner_id,document) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(organisation_id,id,revision) DO NOTHING").bind(&r.scope.organisation_id).bind(&r.id).bind(r.revision as i64).bind(recorder).bind(&r.scope.client_id).bind(&r.scope.engagement_id).bind(&r.scope.owner_id).bind(v).execute(&mut **tx).await.map_err(db)?;
    Ok(())
}
async fn revision(tx: &mut Tx, s: &KnowledgeScope) -> Result<u64, KnowledgeError> {
    let n:i64=sqlx::query_scalar("SELECT count(*) FROM public.knowledge_events WHERE organisation_id=$1 AND client_id IS NOT DISTINCT FROM $2 AND engagement_id IS NOT DISTINCT FROM $3 AND owner_id IS NOT DISTINCT FROM $4").bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id).bind(&s.owner_id).fetch_one(&mut **tx).await.map_err(db)?;
    Ok(n as u64)
}
/// Durable receipts retain command facts and an exact immutable record pointer.
/// Full views are disclosure projections; their prose and current reasons must
/// not consume receipt capacity or become a cached authorization decision.
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredReceipt {
    storage_format: u8,
    event_id: String,
    revision: u64,
    record_reference: Option<RecordReference>,
    affected_ids: Vec<String>,
    affected_destinations: Vec<String>,
}
async fn previous(
    tx: &mut Tx,
    actor: &str,
    org: &str,
    key: &str,
    command: &Value,
) -> Result<Option<KnowledgeReceipt>, KnowledgeError> {
    let Some(row)=sqlx::query("SELECT command,receipt FROM public.knowledge_events WHERE organisation_id=$1 AND actor_id=$2 AND key=$3").bind(org).bind(actor).bind(key).fetch_optional(&mut **tx).await.map_err(db)? else{return Ok(None)};
    if row.try_get::<Value, _>("command").map_err(db)? != *command {
        return Err(KnowledgeError::Conflict);
    }
    let document: Value = row.try_get("receipt").map_err(db)?;
    // Compatibility for an already accepted full receipt. Its caller still
    // refreshes every record before disclosure, just like compact receipts.
    if document.get("storage_format").is_none() {
        return Ok(Some(dec(document)?));
    }
    let stored: StoredReceipt = dec(document)?;
    if stored.storage_format != 1 {
        return Err(KnowledgeError::Unavailable);
    }
    let record = if let Some(reference) = stored.record_reference {
        match load(tx, org, &reference.id, Some(reference.revision)).await {
            Ok(record) => Some(view(record, RecordStatus::Current, None)),
            Err(KnowledgeError::Denied) => None,
            Err(error) => return Err(error),
        }
    } else {
        None
    };
    Ok(Some(KnowledgeReceipt {
        event_id: stored.event_id,
        revision: stored.revision,
        record,
        affected_ids: stored.affected_ids,
        affected_destinations: stored.affected_destinations,
    }))
}
async fn receipt(
    tx: &mut Tx,
    actor: &str,
    s: &KnowledgeScope,
    key: &str,
    command: &Value,
    result: &KnowledgeReceipt,
) -> Result<(), KnowledgeError> {
    if result.affected_ids.len() > CLOSURE_LIMIT
        || result.affected_destinations.len() > 50
        || result
            .affected_ids
            .iter()
            .chain(&result.affected_destinations)
            .any(|id| !valid_scope_id(id))
    {
        return Err(KnowledgeError::Capacity);
    }
    let stored = StoredReceipt {
        storage_format: 1,
        event_id: result.event_id.clone(),
        revision: result.revision,
        record_reference: result.record.as_ref().map(|view| RecordReference {
            id: view.record.id.clone(),
            revision: view.record.revision,
        }),
        affected_ids: result.affected_ids.clone(),
        affected_destinations: result.affected_destinations.clone(),
    };
    let document = enc(&stored)?;
    if serde_json::to_vec(&document)
        .map_err(|_| KnowledgeError::Invalid)?
        .len()
        > 60_000
    {
        return Err(KnowledgeError::Capacity);
    }
    sqlx::query("INSERT INTO public.knowledge_events(organisation_id,id,actor_id,key,client_id,engagement_id,owner_id,command,receipt) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)").bind(&s.organisation_id).bind(&result.event_id).bind(actor).bind(key).bind(&s.client_id).bind(&s.engagement_id).bind(&s.owner_id).bind(command).bind(document).execute(&mut **tx).await.map_err(db)?;
    Ok(())
}

fn view(r: KnowledgeRecord, status: RecordStatus, reason: Option<String>) -> KnowledgeView {
    let current = status == RecordStatus::Current;
    let assertion = r.kind == KnowledgeKind::Assertion;
    let personal = r.kind == KnowledgeKind::Preference;
    KnowledgeView {
        record: r,
        status,
        status_reason: reason,
        can_correct: current && assertion,
        can_exclude: current && !personal,
        can_forget: current && !personal,
        can_reuse: current && !personal,
        can_undo: current && personal,
    }
}
fn scoped_view(
    record: KnowledgeRecord,
    status: RecordStatus,
    reason: Option<String>,
    scope: &Scope,
) -> KnowledgeView {
    let origin = record.scope == KnowledgeScope::engagement(scope);
    let mut result = view(record, status, reason);
    result.can_correct &= origin;
    result.can_reuse &= origin;
    result
}
async fn status(
    tx: &mut Tx,
    r: &KnowledgeRecord,
    destination: &str,
) -> Result<(RecordStatus, Option<String>), KnowledgeError> {
    let newest: Option<i64> = sqlx::query_scalar(
        "SELECT max(revision) FROM public.knowledge_records WHERE organisation_id=$1 AND id=$2",
    )
    .bind(&r.scope.organisation_id)
    .bind(&r.id)
    .fetch_one(&mut **tx)
    .await
    .map_err(db)?;
    let invalid:Option<Value>=sqlx::query_scalar("SELECT document FROM public.knowledge_invalidations WHERE organisation_id=$1 AND record_id=$2 AND revision=$3 AND (document->>'destination_task_id' IS NULL OR document->>'destination_task_id'=$4) ORDER BY id COLLATE \"C\" DESC LIMIT 1").bind(&r.scope.organisation_id).bind(&r.id).bind(r.revision as i64).bind(destination).fetch_optional(&mut **tx).await.map_err(db)?;
    if let Some(v) = invalid {
        return Ok((
            dec(v["status"].clone())?,
            v["reason"].as_str().map(str::to_owned),
        ));
    }
    if newest.is_some_and(|n| n as u64 > r.revision) {
        return Ok((
            RecordStatus::Corrected,
            Some("A later attributable revision replaces this context.".into()),
        ));
    }
    Ok((RecordStatus::Current, None))
}
async fn record_access(
    tx: &mut Tx,
    actor: &str,
    consumer: &str,
    r: &KnowledgeRecord,
) -> Result<(), KnowledgeError> {
    if let Some(s) = source_scope(&r.scope) {
        if !audit(tx, actor, &s).await? || !audit(tx, consumer, &s).await? {
            return Err(KnowledgeError::Denied);
        }
    } else if r.scope.owner_id.as_deref() != Some(actor) || actor != consumer {
        return Err(KnowledgeError::Denied);
    }
    Ok(())
}
#[derive(Default)]
struct Applicability {
    omission: Option<Omission>,
    support_omission: Option<Omission>,
    unknown_source: bool,
}
impl Applicability {
    fn observe(&mut self, source: &Period, consumer: &Period, support: bool) {
        if source.start.is_none() && source.end.is_none() {
            self.unknown_source = true;
            return;
        }
        let omission = match source.to_domain().eligibility(&consumer.to_domain()) {
            zobba_domain::knowledge::PeriodEligibility::Eligible => return,
            zobba_domain::knowledge::PeriodEligibility::Unknown => Omission::UnknownPeriod,
            zobba_domain::knowledge::PeriodEligibility::Outside => Omission::OutsidePeriod,
        };
        if self.omission.is_none() || omission == Omission::OutsidePeriod {
            self.omission = Some(omission.clone());
        }
        if support && (self.support_omission.is_none() || omission == Omission::OutsidePeriod) {
            self.support_omission = Some(omission);
        }
    }
}
struct Assessment {
    status: RecordStatus,
    reason: Option<String>,
    applicability: Applicability,
}
impl Assessment {
    fn is_current(&self) -> bool {
        self.status == RecordStatus::Current && self.applicability.omission.is_none()
    }
    fn standing(&self) -> (RecordStatus, Option<String>) {
        if self.status == RecordStatus::Current {
            let reason = match self.applicability.omission {
                Some(Omission::UnknownPeriod) => Some(
                    "Known-period context cannot support a Task whose business period is unknown.",
                ),
                Some(_) => Some(
                    "An exact known-period record or supporting source does not cover this context's business period.",
                ),
                None => None,
            };
            if let Some(reason) = reason {
                return (RecordStatus::Invalidated, Some(reason.into()));
            }
        }
        (self.status, self.reason.clone())
    }
}
/// Iterative bounded closure: all source authority is checked before a claim may
/// be ranked or serialized. No inaccessible source text or provenance survives.
async fn assess(
    tx: &mut Tx,
    actor: &str,
    consumer: &str,
    destination: &Scope,
    task_id: &str,
    root: &KnowledgeRecord,
) -> Result<Assessment, KnowledgeError> {
    select_scope(tx, destination).await?;
    let consumer_period = if task_id.is_empty() {
        Period::default()
    } else {
        let binding = crate::methodology::current_binding(tx, task_id)
            .await
            .map_err(|_| KnowledgeError::Unavailable)?;
        Period {
            start: binding.resolution.context.period_start,
            end: binding.resolution.context.period_end,
        }
    };
    let mut stack = vec![root.clone()];
    let mut seen = BTreeSet::new();
    let mut resulting = status(tx, root, task_id).await?;
    let mut applicability = Applicability::default();
    while let Some(r) = stack.pop() {
        if !seen.insert((r.id.clone(), r.revision)) {
            continue;
        }
        if seen.len() > CLOSURE_LIMIT {
            return Err(KnowledgeError::Capacity);
        }
        if r.scope.organisation_id != destination.organisation_id
            || r.scope
                .client_id
                .as_ref()
                .is_some_and(|client| client != &destination.client_id)
        {
            return Err(KnowledgeError::Denied);
        }
        record_access(tx, actor, consumer, &r).await?;
        let support = (r.id.as_str(), r.revision) != (root.id.as_str(), root.revision);
        applicability.observe(&r.period, &consumer_period, support);
        if support && root.period.start.is_some() {
            applicability.observe(&r.period, &root.period, true);
        }
        let st = status(tx, &r, task_id).await?;
        if st.0 != RecordStatus::Current && r.id != root.id {
            resulting = (
                RecordStatus::Invalidated,
                Some("An exact supporting revision is no longer current.".into()),
            );
        }
        for dependency in &r.dependencies {
            match dependency {
                Dependency::Knowledge {
                    id,
                    revision,
                    scope,
                } => {
                    let next = load(tx, &scope.organisation_id, id, Some(*revision)).await?;
                    if next.scope != *scope {
                        return Err(KnowledgeError::Denied);
                    }
                    stack.push(next);
                }
                Dependency::Evidence {
                    evidence_id,
                    storage_version,
                    digest,
                    scope,
                } => {
                    let source = source_scope(scope).ok_or(KnowledgeError::Denied)?;
                    if source.organisation_id != destination.organisation_id
                        || source.client_id != destination.client_id
                        || !audit(tx, actor, &source).await?
                        || !audit(tx, consumer, &source).await?
                    {
                        return Err(KnowledgeError::Denied);
                    }
                    select_scope(tx, &source).await?;
                    let ok:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM public.evidence_originals WHERE id=$1 AND version=$2 AND digest=$3)").bind(evidence_id).bind(storage_version).bind(digest).fetch_one(&mut **tx).await.map_err(db)?;
                    if !ok {
                        return Err(KnowledgeError::Denied);
                    }
                    // Registered identity and user assertions provide no
                    // certified business period for the original bytes.
                    applicability.unknown_source = true;
                    let corrected:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM public.knowledge_source_corrections WHERE organisation_id=$1 AND original_id=$2)").bind(&source.organisation_id).bind(evidence_id).fetch_one(&mut **tx).await.map_err(db)?;
                    if corrected {
                        resulting = (
                            RecordStatus::Invalidated,
                            Some(
                                "The registered supporting source has an explicit correction."
                                    .into(),
                            ),
                        );
                    }
                }
                Dependency::Guide {
                    command_id,
                    task_id,
                    cycle_id,
                    scope,
                } => {
                    let source = source_scope(scope).ok_or(KnowledgeError::Denied)?;
                    if source.organisation_id != destination.organisation_id
                        || source.client_id != destination.client_id
                        || !audit(tx, actor, &source).await?
                        || !audit(tx, consumer, &source).await?
                    {
                        return Err(KnowledgeError::Denied);
                    }
                    select_scope(tx, &source).await?;
                    let row=sqlx::query("SELECT methodology_context FROM public.task_commands WHERE id=$1 AND task_id=$2 AND cycle_id=$3 AND kind='guide'").bind(command_id).bind(task_id).bind(cycle_id).fetch_optional(&mut **tx).await.map_err(db)?.ok_or(KnowledgeError::Denied)?;
                    let context: Option<Value> = row.try_get("methodology_context").map_err(db)?;
                    let period = if let Some(context) = context {
                        Period {
                            start: context["period_start"].as_str().map(str::to_owned),
                            end: context["period_end"].as_str().map(str::to_owned),
                        }
                    } else {
                        Period::default()
                    };
                    applicability.observe(&period, &consumer_period, true);
                    if root.period.start.is_some() {
                        applicability.observe(&period, &root.period, true);
                    }
                }
                Dependency::Methodology { .. } | Dependency::Skill { .. } => {
                    return Err(KnowledgeError::Ineligible);
                }
            }
        }
    }
    select_scope(tx, destination).await?;
    Ok(Assessment {
        status: resulting.0,
        reason: resulting.1,
        applicability,
    })
}
async fn eligible_destination(
    tx: &mut Tx,
    r: &KnowledgeRecord,
    s: &Scope,
    task: &str,
) -> Result<bool, KnowledgeError> {
    if r.scope.organisation_id != s.organisation_id
        || r.scope
            .client_id
            .as_ref()
            .is_some_and(|client| client != &s.client_id)
    {
        return Ok(false);
    }
    if r.scope.owner_id.is_some() {
        return Ok(true);
    }
    if r.scope == KnowledgeScope::engagement(s) {
        return Ok(true);
    }
    let allowed:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM public.knowledge_publications p WHERE p.organisation_id=$1 AND p.record_id=$2 AND p.revision=$3 AND p.client_id=$4 AND p.engagement_id=$5 AND p.task_id=$6 AND p.kind='reuse' AND NOT EXISTS(SELECT 1 FROM public.knowledge_withdrawals w WHERE (w.organisation_id,w.publication_id)=(p.organisation_id,p.id)))").bind(&s.organisation_id).bind(&r.id).bind(r.revision as i64).bind(&s.client_id).bind(&s.engagement_id).bind(task).fetch_one(&mut **tx).await.map_err(db)?;
    Ok(allowed)
}
async fn checked_view(
    tx: &mut Tx,
    actor: &str,
    consumer: &str,
    s: &Scope,
    task_id: &str,
    r: KnowledgeRecord,
) -> Result<KnowledgeView, KnowledgeError> {
    Ok(checked_context(tx, actor, consumer, s, task_id, r).await?.0)
}
async fn checked_context(
    tx: &mut Tx,
    actor: &str,
    consumer: &str,
    s: &Scope,
    task_id: &str,
    r: KnowledgeRecord,
) -> Result<(KnowledgeView, Applicability), KnowledgeError> {
    if !eligible_destination(tx, &r, s, task_id).await? {
        return Err(KnowledgeError::Denied);
    }
    let assessed = assess(tx, actor, consumer, s, task_id, &r).await?;
    let (st, reason) = assessed.standing();
    let mut r = r;
    if let Some(d) = &mut r.direction {
        select_scope(tx, &source_scope(&r.scope).ok_or(KnowledgeError::Denied)?).await?;
        let applied:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM public.task_events WHERE command_id=$1 AND kind='applied')").bind(&d.command_id).fetch_one(&mut **tx).await.map_err(db)?;
        d.standing = if applied {
            "Applied to the original Task/cycle; historical decision for this context."
        } else {
            "Received for the original Task/cycle; application is pending."
        }
        .into();
    }
    select_scope(tx, s).await?;
    Ok((scoped_view(r, st, reason, s), assessed.applicability))
}
async fn invalidate(
    tx: &mut Tx,
    actor: &str,
    r: &KnowledgeRecord,
    status: RecordStatus,
    reason: &str,
    task: Option<&str>,
) -> Result<(), KnowledgeError> {
    sqlx::query("INSERT INTO public.knowledge_invalidations(organisation_id,id,record_id,revision,actor_id,client_id,engagement_id,owner_id,document) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)").bind(&r.scope.organisation_id).bind(token()?).bind(&r.id).bind(r.revision as i64).bind(actor).bind(&r.scope.client_id).bind(&r.scope.engagement_id).bind(&r.scope.owner_id).bind(json!({"status":status,"reason":reason,"destination_task_id":task,"recorded_at":now(tx).await?})).execute(&mut **tx).await.map_err(db)?;
    Ok(())
}
async fn assertion_dependencies(
    tx: &mut Tx,
    actor: &str,
    consumer: &str,
    s: &Scope,
    task: &str,
    r: &KnowledgeRecord,
) -> Result<(), KnowledgeError> {
    let mut stack = r.dependencies.clone();
    let mut seen = BTreeSet::new();
    while let Some(d) = stack.pop() {
        if let Dependency::Knowledge {
            id,
            revision,
            scope,
        } = d
        {
            if id == r.id {
                return Err(KnowledgeError::Cycle);
            }
            if !seen.insert((id.clone(), revision)) {
                continue;
            }
            if seen.len() > CLOSURE_LIMIT {
                return Err(KnowledgeError::Capacity);
            }
            let child = load(tx, &scope.organisation_id, &id, Some(revision)).await?;
            stack.extend(child.dependencies);
        }
    }
    let assessed = assess(tx, actor, consumer, s, task, r).await?;
    if assessed.status != RecordStatus::Current || assessed.applicability.support_omission.is_some()
    {
        return Err(KnowledgeError::Ineligible);
    }
    Ok(())
}
fn new_record(
    id: String,
    actor: &str,
    scope: KnowledgeScope,
    at: i64,
    kind: KnowledgeKind,
    text: String,
) -> KnowledgeRecord {
    KnowledgeRecord {
        id,
        revision: 1,
        actor_id: actor.into(),
        recorded_at: at,
        scope,
        kind,
        text,
        period: Period::default(),
        certainty: Certainty::Asserted,
        uncertainty: None,
        dependencies: vec![],
        source: None,
        direction: None,
        preference: None,
        supersedes: None,
    }
}
/// Called by the sole Guide owner in its admission transaction, including exact
/// receipt replay. The immutable command identity is the deduplication identity.
pub(crate) async fn project_guide(
    tx: &mut Tx,
    s: &Scope,
    recorder: &str,
    command: &str,
) -> Result<(), KnowledgeError> {
    let row=sqlx::query("SELECT author_id,content,task_id,cycle_id,received_at,methodology_context FROM public.task_commands WHERE id=$1 AND kind='guide'").bind(command).fetch_optional(&mut **tx).await.map_err(db)?;
    let Some(row) = row else { return Ok(()) };
    let id = stable(&["guide", command]);
    let author: String = row.try_get("author_id").map_err(db)?;
    let task_id: String = row.try_get("task_id").map_err(db)?;
    let cycle_id: String = row.try_get("cycle_id").map_err(db)?;
    let Some(accepted): Option<i64> = row.try_get("received_at").map_err(db)? else {
        return Ok(());
    };
    let mut r = new_record(
        id,
        &author,
        KnowledgeScope::engagement(s),
        accepted,
        KnowledgeKind::Decision,
        row.try_get("content").map_err(db)?,
    );
    r.certainty = Certainty::UserDirected;
    if let Some(context) = row
        .try_get::<Option<Value>, _>("methodology_context")
        .map_err(db)?
    {
        r.period = Period {
            start: context["period_start"].as_str().map(str::to_owned),
            end: context["period_end"].as_str().map(str::to_owned),
        };
    }
    r.direction=Some(DirectionBasis{command_id:command.into(),task_id:task_id.clone(),cycle_id:cycle_id.clone(),standing:"Received for the original Task/cycle; historical decision, not a universal instruction.".into()});
    r.dependencies.push(Dependency::Guide {
        command_id: command.into(),
        task_id,
        cycle_id,
        scope: r.scope.clone(),
    });
    insert(tx, recorder, &r).await
}
async fn verify_original(
    tx: &mut Tx,
    s: &Scope,
    e: &RegisteredEvidence,
) -> Result<(), KnowledgeError> {
    if e.reservation.scope != *s {
        return Err(KnowledgeError::Denied);
    }
    select_scope(tx, s).await?;
    let request = &e.reservation.request;
    let exact = json!({"key":request.key,"filename":request.filename,"sha256":request.identity.sha256,"size":request.identity.size,"system":request.source.system,"account":request.source.account,"source_version":request.source.source_version,"selection":request.source.selection,"coverage":request.source.coverage});
    let ok:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM public.evidence_originals WHERE id=$1 AND version=$2 AND digest=$3 AND size=$4 AND actor_id=$5 AND request::jsonb=$6 AND reserved_at=$7 AND registered_at=$8)").bind(&e.reservation.id).bind(&e.version).bind(&request.identity.sha256).bind(request.identity.size as i64).bind(&e.reservation.actor_id).bind(exact).bind(e.reservation.reserved_at).bind(e.registered_at).fetch_one(&mut **tx).await.map_err(db)?;
    if !ok {
        return Err(KnowledgeError::Conflict);
    }
    let corrected:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM public.knowledge_source_corrections WHERE organisation_id=$1 AND original_id=$2)").bind(&s.organisation_id).bind(&e.reservation.id).fetch_one(&mut **tx).await.map_err(db)?;
    if corrected {
        return Err(KnowledgeError::Ineligible);
    }
    Ok(())
}
fn evidence_dependency(e: &RegisteredEvidence) -> Dependency {
    Dependency::Evidence {
        evidence_id: e.reservation.id.clone(),
        storage_version: e.version.clone(),
        digest: e.reservation.request.identity.sha256.clone(),
        scope: KnowledgeScope::engagement(&e.reservation.scope),
    }
}
async fn excerpt_record(
    tx: &mut Tx,
    recorder: &str,
    e: &RegisteredEvidence,
    x: &CapturedExcerpt,
) -> Result<KnowledgeRecord, KnowledgeError> {
    if x.text.len() > MAX_EXCERPT_BYTES
        || x.byte_end < x.byte_start
        || x.byte_end - x.byte_start != x.text.len() as u64
        || x.original_size != e.reservation.request.identity.size
        || x.byte_end > x.original_size
    {
        return Err(KnowledgeError::Invalid);
    }
    let id = stable(&[
        "excerpt",
        &e.reservation.id,
        &e.version,
        &x.byte_start.to_string(),
        &x.byte_end.to_string(),
    ]);
    let mut r = new_record(
        id,
        &e.reservation.actor_id,
        KnowledgeScope::engagement(&e.reservation.scope),
        e.registered_at,
        KnowledgeKind::Observation,
        x.text.clone(),
    );
    r.certainty = Certainty::SourceStates;
    r.dependencies.push(evidence_dependency(e));
    r.source = Some(SourceLocation {
        evidence_id: e.reservation.id.clone(),
        storage_version: e.version.clone(),
        digest: e.reservation.request.identity.sha256.clone(),
        byte_start: x.byte_start,
        byte_end: x.byte_end,
        original_size: x.original_size,
        partial: x.partial,
        field_path: None,
    });
    insert(tx, recorder, &r).await?;
    Ok(r)
}
/// A pending registration remains durable even for the compatibility register
/// port. acquire and exact recovery consume it using verified, pinned bytes.
pub(crate) async fn pending_capture(
    tx: &mut Tx,
    actor: &str,
    e: &RegisteredEvidence,
) -> Result<(), KnowledgeError> {
    let s = &e.reservation.scope;
    sqlx::query("INSERT INTO public.knowledge_captures(organisation_id,client_id,engagement_id,original_id,actor_id,revision,document) VALUES($1,$2,$3,$4,$5,1,$6) ON CONFLICT DO NOTHING").bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id).bind(&e.reservation.id).bind(actor).bind(json!({"state":"pending","omission":"legacy_not_captured","version":e.version})).execute(&mut **tx).await.map_err(db)?;
    Ok(())
}
pub(crate) async fn capture_registered(
    tx: &mut Tx,
    actor: &str,
    e: &RegisteredEvidence,
    capture: &EvidenceCapture,
) -> Result<Vec<KnowledgeRecord>, KnowledgeError> {
    let s = &e.reservation.scope;
    match verify_original(tx, s, e).await {
        Ok(()) | Err(KnowledgeError::Ineligible) => {}
        Err(error) => return Err(error),
    }
    let mut records = vec![];
    if let Some(x) = &capture.excerpt {
        records.push(excerpt_record(tx, actor, e, x).await?)
    }
    for assertion in &capture.assertions {
        let expected = match assertion.field_path.as_str() {
            "source.system" => &e.reservation.request.source.system,
            "source.account" => &e.reservation.request.source.account,
            "source.source_version" => &e.reservation.request.source.source_version,
            "source.selection" => &e.reservation.request.source.selection,
            "source.coverage" => &e.reservation.request.source.coverage,
            _ => return Err(KnowledgeError::Invalid),
        };
        if expected.as_deref() != Some(&assertion.text) {
            return Err(KnowledgeError::Invalid);
        }
        let id = stable(&[
            "source-assertion",
            &e.reservation.id,
            &e.version,
            &assertion.field_path,
        ]);
        let mut r = new_record(
            id,
            &e.reservation.actor_id,
            KnowledgeScope::engagement(s),
            e.registered_at,
            KnowledgeKind::Assertion,
            assertion.text.clone(),
        );
        r.dependencies.push(evidence_dependency(e));
        r.source = Some(SourceLocation {
            evidence_id: e.reservation.id.clone(),
            storage_version: e.version.clone(),
            digest: e.reservation.request.identity.sha256.clone(),
            byte_start: 0,
            byte_end: 0,
            original_size: e.reservation.request.identity.size,
            partial: true,
            field_path: Some(assertion.field_path.clone()),
        });
        insert(tx, actor, &r).await?;
        records.push(r);
    }
    let document = json!({"state":"captured","omission":capture.omission,"version":e.version,"partial":capture.excerpt.as_ref().is_some_and(|x|x.partial)});
    let old:Option<Value>=sqlx::query_scalar("SELECT document FROM public.knowledge_captures WHERE organisation_id=$1 AND original_id=$2 ORDER BY revision DESC LIMIT 1").bind(&s.organisation_id).bind(&e.reservation.id).fetch_optional(&mut **tx).await.map_err(db)?;
    if old.as_ref() != Some(&document) {
        sqlx::query("INSERT INTO public.knowledge_captures(organisation_id,client_id,engagement_id,original_id,actor_id,revision,document) SELECT $1,$2,$3,$4,$5,coalesce(max(revision),0)+1,$6 FROM public.knowledge_captures WHERE organisation_id=$1 AND original_id=$4").bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id).bind(&e.reservation.id).bind(actor).bind(document).execute(&mut **tx).await.map_err(db)?;
    }
    Ok(records)
}
async fn publication_view(tx: &mut Tx, p: &Value) -> Result<KnowledgeView, KnowledgeError> {
    let r: KnowledgeRecord = dec(p["record"].clone())?;
    let active: bool = sqlx::query_scalar("SELECT public.knowledge_release_active($1,$2)")
        .bind(&r.scope.organisation_id)
        .bind(&r.id)
        .fetch_one(&mut **tx)
        .await
        .map_err(db)?;
    let mut v = view(
        r,
        if active {
            RecordStatus::Current
        } else {
            RecordStatus::Withdrawn
        },
        None,
    );
    v.can_correct = false;
    v.can_exclude = false;
    v.can_forget = false;
    v.can_reuse = false;
    v.can_undo = false;
    Ok(v)
}
/// Recheck exact context references and Task basis within the caller's existing
/// organisation/engagement/Task fence. This grants no outbound authority itself.
pub(crate) async fn verify_in_transaction(
    tx: &mut Tx,
    actor: &str,
    s: &Scope,
    task_id: &str,
    command: &VerifyKnowledge,
) -> Result<String, KnowledgeError> {
    if command.items.len() > KNOWLEDGE_PAGE_SIZE
        || (command.exact && command.items.len() != 1)
        || command.expected_execution_epoch > i64::MAX as u64
        || !valid_scope_id(&command.expected_methodology_binding_id)
        || command.items.iter().any(|item| {
            !valid_scope_id(&item.id) || item.revision == 0 || item.revision > i64::MAX as u64
        })
        || command
            .items
            .iter()
            .map(|item| &item.id)
            .collect::<BTreeSet<_>>()
            .len()
            != command.items.len()
    {
        return Err(KnowledgeError::Invalid);
    }
    let (consumer, _, epoch) = task(tx, s, task_id).await?;
    if !audit(tx, &consumer, s).await? {
        return Err(KnowledgeError::Denied);
    }
    let binding = crate::methodology::current_binding(tx, task_id)
        .await
        .map_err(|_| KnowledgeError::Unavailable)?;
    if epoch != command.expected_execution_epoch
        || binding.id != command.expected_methodology_binding_id
    {
        return Err(KnowledgeError::Conflict);
    }
    for expected in &command.items {
        let publication:Option<Value>=sqlx::query_scalar("SELECT document FROM public.knowledge_publications WHERE organisation_id=$1 AND id=$2 AND client_id=$3 AND engagement_id=$4 AND kind='preference'").bind(&s.organisation_id).bind(&expected.id).bind(&s.client_id).bind(&s.engagement_id).fetch_optional(&mut **tx).await.map_err(db)?;
        let (current, applicability) = if let Some(publication) = publication {
            (
                publication_view(tx, &publication).await?,
                Applicability::default(),
            )
        } else {
            let record = load(
                tx,
                &s.organisation_id,
                &expected.id,
                Some(expected.revision),
            )
            .await?;
            checked_context(tx, actor, &consumer, s, task_id, record).await?
        };
        if current.record.revision != expected.revision || current.status != expected.status {
            return Err(KnowledgeError::Conflict);
        }
        if !command.exact {
            if !command.include_inactive && current.status != RecordStatus::Current {
                return Err(KnowledgeError::Ineligible);
            }
            if applicability.omission.is_some() {
                return Err(KnowledgeError::Ineligible);
            }
        }
    }
    if !audit(tx, actor, s).await? || !audit(tx, &consumer, s).await? {
        return Err(KnowledgeError::Denied);
    }
    // Dependency checks may have visited other engagements. Recheck their
    // server-time membership expiries immediately before returning the joint
    // grant to an outbound caller, just as the browser repository finish does.
    let dependencies_current: bool = sqlx::query_scalar("SELECT NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(nullif(current_setting('zobba.knowledge_checks',true),''),'[]')::jsonb) c WHERE NOT public.knowledge_audit(c->>0,c->>1,c->>2,c->>3))")
        .fetch_one(&mut **tx).await.map_err(db)?;
    if !dependencies_current {
        return Err(KnowledgeError::Denied);
    }
    Ok(consumer)
}
/// Bounded current knowledge the Task's accountable actor may use as model
/// context, read inside the caller's existing claim-bound Task fence. Uses the
/// same candidate stream and per-record checks as `inspect`, but discloses only
/// Current records with no applicability omission. Withdrawn, forgotten,
/// excluded, corrected or invalidated records are never returned. Preference
/// publications are presentation settings, not facts, and are not context.
/// Every returned reference is verified again at disclosure by
/// `verify_in_transaction`; this read grants no use by itself.
pub(crate) async fn task_context_in_transaction(
    tx: &mut Tx,
    actor: &str,
    s: &Scope,
    task_id: &str,
    max_items: usize,
    max_text_bytes: usize,
) -> Result<Vec<KnowledgeView>, KnowledgeError> {
    let (consumer, _, _) = task(tx, s, task_id).await?;
    if consumer != actor || !audit(tx, &consumer, s).await? {
        return Err(KnowledgeError::Denied);
    }
    let mut items: Vec<KnowledgeView> = vec![];
    let mut text_bytes = 0usize;
    let mut cursor: Option<String> = None;
    let mut examined = 0usize;
    'scan: while examined < 1024 && items.len() < max_items {
        let batch = (1024 - examined).min(51);
        let rows=sqlx::query("SELECT id,document FROM (SELECT DISTINCT ON (id COLLATE \"C\") id,revision,document FROM public.knowledge_records WHERE organisation_id=$1 AND (client_id=$2 OR owner_id=$3) AND id COLLATE \"C\">coalesce($4,'') COLLATE \"C\" ORDER BY id COLLATE \"C\",revision DESC) latest ORDER BY id COLLATE \"C\" LIMIT $5").bind(&s.organisation_id).bind(&s.client_id).bind(actor).bind(&cursor).bind(batch as i64).fetch_all(&mut **tx).await.map_err(db)?;
        let count = rows.len();
        for row in rows {
            let id: String = row.try_get("id").map_err(db)?;
            let document: Value = row.try_get("document").map_err(db)?;
            cursor = Some(id.clone());
            examined += 1;
            let record: KnowledgeRecord = dec(document)?;
            if record.id != id {
                return Err(KnowledgeError::Unavailable);
            }
            let (view, applicability) =
                match checked_context(tx, actor, &consumer, s, task_id, record).await {
                    Ok(checked) => checked,
                    // Not visible to this Task, or support unavailable: omit.
                    Err(
                        KnowledgeError::Denied
                        | KnowledgeError::Capacity
                        | KnowledgeError::Ineligible,
                    ) => continue,
                    Err(e) => return Err(e),
                };
            if view.status != RecordStatus::Current || applicability.omission.is_some() {
                continue;
            }
            if text_bytes + view.record.text.len() > max_text_bytes {
                break 'scan;
            }
            text_bytes += view.record.text.len();
            items.push(view);
            if items.len() == max_items {
                break 'scan;
            }
        }
        if count < batch {
            break;
        }
    }
    select_scope(tx, s).await?;
    if !audit(tx, actor, s).await? {
        return Err(KnowledgeError::Denied);
    }
    let dependencies_current: bool = sqlx::query_scalar("SELECT NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(nullif(current_setting('zobba.knowledge_checks',true),''),'[]')::jsonb) c WHERE NOT public.knowledge_audit(c->>0,c->>1,c->>2,c->>3))")
        .fetch_one(&mut **tx).await.map_err(db)?;
    if !dependencies_current {
        return Err(KnowledgeError::Denied);
    }
    Ok(items)
}
impl KnowledgeStore for KnowledgeRepository {
    async fn verify(
        &self,
        actor: &str,
        s: &Scope,
        task_id: &str,
        command: &VerifyKnowledge,
    ) -> Result<(), KnowledgeError> {
        let mut tx = self.scoped(actor, s, None).await?;
        let consumer = verify_in_transaction(&mut tx, actor, s, task_id, command).await?;
        self.finish(&mut tx, actor, s, Some(&consumer)).await?;
        tx.commit().await.map_err(db)?;
        Ok(())
    }
    async fn inspect(
        &self,
        actor: &str,
        s: &Scope,
        task_id: &str,
        query: &KnowledgeQuery,
    ) -> Result<KnowledgePage, KnowledgeError> {
        if !query.is_valid() {
            return Err(KnowledgeError::Invalid);
        }
        let mut tx = self.scoped(actor, s, None).await?;
        let (consumer, _, epoch) = task(&mut tx, s, task_id).await?;
        if !audit(&mut tx, &consumer, s).await? {
            return Err(KnowledgeError::Denied);
        }
        let binding = crate::methodology::current_binding(&mut tx, task_id)
            .await
            .map_err(|_| KnowledgeError::Unavailable)?;
        // Legacy Guides remain exact immutable sources. An inspector actively repairs
        // missing bounded projections; replay also repairs independently of this page.
        let guides:Vec<String>=sqlx::query_scalar("SELECT c.id FROM public.task_commands c WHERE c.kind='guide' AND c.received_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.knowledge_records k WHERE k.organisation_id=c.organisation_id AND k.document->'direction'->>'command_id'=c.id) ORDER BY c.id COLLATE \"C\" LIMIT 51").fetch_all(&mut *tx).await.map_err(db)?;
        for id in guides.iter().take(50) {
            project_guide(&mut tx, s, actor, id).await?;
        }
        let mut omissions = vec![];
        let legacy:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM public.task_commands WHERE kind='guide' AND received_at IS NULL)").fetch_one(&mut *tx).await.map_err(db)?;
        if guides.len() > 50 || legacy {
            omissions.push(Omission::LegacyNotCaptured)
        }
        let mut items = vec![];
        let mut cursor = query.after.clone();
        let mut examined = 0usize;
        let mut incomplete = false;
        let mut scan_limited = false;
        loop {
            let batch = (1024 - examined).min(51);
            if batch == 0 {
                scan_limited = true;
                break;
            }
            // One ordered stream is essential: independently capped producer
            // pages cannot certify a common continuation prefix.
            let rows=sqlx::query("SELECT id,document,publication FROM (SELECT id,document,false AS publication FROM (SELECT DISTINCT ON (id COLLATE \"C\") id,revision,document FROM public.knowledge_records WHERE organisation_id=$1 AND (client_id=$2 OR owner_id=$3) AND id COLLATE \"C\">coalesce($4,'') COLLATE \"C\" ORDER BY id COLLATE \"C\",revision DESC) latest UNION ALL SELECT id,document,true AS publication FROM public.knowledge_publications WHERE organisation_id=$1 AND client_id=$2 AND engagement_id=$5 AND kind='preference' AND id COLLATE \"C\">coalesce($4,'') COLLATE \"C\") candidates ORDER BY id COLLATE \"C\" LIMIT $6").bind(&s.organisation_id).bind(&s.client_id).bind(actor).bind(&cursor).bind(&s.engagement_id).bind(batch as i64).fetch_all(&mut *tx).await.map_err(db)?;
            let count = rows.len();
            if count == 0 {
                break;
            }
            for row in rows {
                let id: String = row.try_get("id").map_err(db)?;
                let document: Value = row.try_get("document").map_err(db)?;
                let publication: bool = row.try_get("publication").map_err(db)?;
                cursor = Some(id.clone());
                examined += 1;
                let candidate = if publication {
                    publication_view(&mut tx, &document).await.map(|view| {
                        (
                            view,
                            Applicability {
                                unknown_source: true,
                                ..Applicability::default()
                            },
                        )
                    })
                } else {
                    let record: KnowledgeRecord = dec(document)?;
                    if record.id != id {
                        return Err(KnowledgeError::Unavailable);
                    }
                    checked_context(&mut tx, actor, &consumer, s, task_id, record).await
                };
                let (v, applicability) = match candidate {
                    Ok(v) => v,
                    Err(KnowledgeError::Denied) => continue,
                    Err(KnowledgeError::Capacity | KnowledgeError::Ineligible) => {
                        if !omissions.contains(&Omission::UnavailableSupport) {
                            omissions.push(Omission::UnavailableSupport)
                        }
                        continue;
                    }
                    Err(e) => return Err(e),
                };
                if let Some(omission) = applicability.omission {
                    omissions.push(omission);
                    continue;
                }
                if v.status != RecordStatus::Current && !query.include_inactive {
                    if !omissions.contains(&Omission::InvalidatedSupport) {
                        omissions.push(Omission::InvalidatedSupport)
                    }
                    continue;
                }
                if applicability.unknown_source {
                    omissions.push(Omission::UnknownPeriod)
                }
                if query
                    .text
                    .as_ref()
                    .is_some_and(|q| !v.record.text.to_lowercase().contains(&q.to_lowercase()))
                {
                    continue;
                }
                if v.record
                    .source
                    .as_ref()
                    .is_some_and(|source| source.partial)
                    && !omissions.contains(&Omission::PartialSource)
                {
                    omissions.push(Omission::PartialSource)
                }
                items.push(v);
                if items.len() > KNOWLEDGE_PAGE_SIZE {
                    incomplete = true;
                    break;
                }
            }
            if items.len() > KNOWLEDGE_PAGE_SIZE || count < batch {
                break;
            }
            if examined == 1024 {
                scan_limited = true;
                break;
            }
        }
        select_scope(&mut tx, s).await?;
        let missing:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM public.evidence_originals e WHERE NOT EXISTS(SELECT 1 FROM public.knowledge_captures c WHERE c.organisation_id=e.organisation_id AND c.original_id=e.id AND c.document->>'state'='captured'))").fetch_one(&mut *tx).await.map_err(db)?;
        if missing {
            omissions.push(Omission::UnavailableSupport)
        }
        let unsupported:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM public.knowledge_captures WHERE organisation_id=$1 AND client_id=$2 AND engagement_id=$3 AND document->>'omission'='unsupported_format')").bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id).fetch_one(&mut *tx).await.map_err(db)?;
        if unsupported {
            omissions.push(Omission::UnsupportedFormat)
        }
        let mut result = KnowledgePage {
            task_id: task_id.into(),
            revision: revision(&mut tx, &KnowledgeScope::engagement(s)).await?,
            execution_epoch: epoch,
            methodology_binding_id: binding.id,
            items: vec![],
            next_after: None,
            omissions,
        };
        for v in items {
            if result.items.len() == KNOWLEDGE_PAGE_SIZE {
                incomplete = true;
                break;
            }
            result.items.push(v);
            if serde_json::to_vec(&result)
                .map_err(|_| KnowledgeError::Unavailable)?
                .len()
                > MAX_KNOWLEDGE_BYTES - 8192
            {
                result.items.pop();
                incomplete = true;
                break;
            }
        }
        if incomplete || scan_limited {
            result.next_after = result.items.last().map(|v| v.record.id.clone());
        }
        if incomplete {
            result.omissions.push(Omission::BoundedPage)
        }
        if scan_limited {
            result.omissions.push(Omission::ScanLimit)
        }
        unique_omissions(&mut result.omissions);
        self.finish(&mut tx, actor, s, Some(&consumer)).await?;
        tx.commit().await.map_err(db)?;
        Ok(result)
    }
    async fn exact(
        &self,
        actor: &str,
        s: &Scope,
        task_id: &str,
        id: &str,
        revision: u64,
    ) -> Result<KnowledgeView, KnowledgeError> {
        if !valid_scope_id(id) || revision == 0 || revision > i64::MAX as u64 {
            return Err(KnowledgeError::Invalid);
        }
        let mut tx = self.scoped(actor, s, None).await?;
        let (consumer, _, _) = task(&mut tx, s, task_id).await?;
        let published:Option<Value>=sqlx::query_scalar("SELECT document FROM public.knowledge_publications WHERE organisation_id=$1 AND id=$2 AND client_id=$3 AND engagement_id=$4 AND kind='preference'").bind(&s.organisation_id).bind(id).bind(&s.client_id).bind(&s.engagement_id).fetch_optional(&mut *tx).await.map_err(db)?;
        let result = if let Some(p) = published {
            let v = publication_view(&mut tx, &p).await?;
            if v.record.revision != revision {
                return Err(KnowledgeError::Denied);
            }
            v
        } else {
            let r = load(&mut tx, &s.organisation_id, id, Some(revision)).await?;
            checked_view(&mut tx, actor, &consumer, s, task_id, r).await?
        };
        self.finish(&mut tx, actor, s, Some(&consumer)).await?;
        tx.commit().await.map_err(db)?;
        Ok(result)
    }
    async fn mutate(
        &self,
        actor: &str,
        s: &Scope,
        task_id: &str,
        c: &KnowledgeCommand,
    ) -> Result<KnowledgeReceipt, KnowledgeError> {
        if !c.is_valid() {
            return Err(KnowledgeError::Invalid);
        }
        let destination = match &c.action {
            KnowledgeAction::Reuse {
                destination_engagement_id,
                ..
            } => Some(Scope {
                organisation_id: s.organisation_id.clone(),
                client_id: s.client_id.clone(),
                engagement_id: destination_engagement_id.clone(),
            }),
            _ => None,
        };
        let mut tx = self.scoped(actor, s, destination.as_ref()).await?;
        // Task locks are likewise ordered when reuse names a second Task.
        let mut tasks = vec![(s.clone(), task_id.to_owned())];
        if let (
            KnowledgeAction::Reuse {
                destination_task_id,
                ..
            },
            Some(dest),
        ) = (&c.action, &destination)
        {
            tasks.push((dest.clone(), destination_task_id.clone()))
        }
        tasks.sort_by(|a, b| (&a.0.engagement_id, &a.1).cmp(&(&b.0.engagement_id, &b.1)));
        let mut consumer = String::new();
        let mut destination_consumer = String::new();
        for (sc, id) in tasks {
            let (owner, _, _) = task(&mut tx, &sc, &id).await?;
            if sc == *s && id == task_id {
                consumer = owner.clone()
            }
            if destination.as_ref() == Some(&sc)
                && matches!(&c.action, KnowledgeAction::Reuse { destination_task_id, .. } if destination_task_id == &id)
            {
                destination_consumer = owner
            }
        }
        select_scope(&mut tx, s).await?;
        if !audit(&mut tx, &consumer, s).await? {
            return Err(KnowledgeError::Denied);
        }
        let scope = KnowledgeScope::engagement(s);
        let command = json!({"scope":scope,"task_id":task_id,"command":c});
        if serde_json::to_vec(&command)
            .map_err(|_| KnowledgeError::Invalid)?
            .len()
            > 60_000
        {
            return Err(KnowledgeError::Capacity);
        }
        if let Some(mut previous) =
            previous(&mut tx, actor, &s.organisation_id, &c.key, &command).await?
        {
            let destination_view = if let (
                Some(dest),
                KnowledgeAction::Reuse {
                    destination_task_id,
                    ..
                },
            ) = (&destination, &c.action)
            {
                if !audit(&mut tx, &destination_consumer, dest).await? {
                    return Err(KnowledgeError::Denied);
                }
                Some((
                    dest,
                    destination_task_id.as_str(),
                    destination_consumer.as_str(),
                ))
            } else {
                None
            };
            if let Some(record) = previous.record.take() {
                previous.record = self
                    .replay_record(
                        &mut tx,
                        actor,
                        &consumer,
                        s,
                        task_id,
                        record.record,
                        destination_view,
                    )
                    .await?;
            } else {
                self.finish(&mut tx, actor, s, Some(&consumer)).await?;
            }
            tx.commit().await.map_err(db)?;
            return Ok(previous);
        }
        let rev = revision(&mut tx, &scope).await?;
        if c.expected_revision != rev {
            return Err(KnowledgeError::Conflict);
        }
        let at = now(&mut tx).await?;
        let mut result = KnowledgeReceipt {
            event_id: token()?,
            revision: rev + 1,
            record: None,
            affected_ids: vec![],
            affected_destinations: vec![],
        };
        match &c.action {
            KnowledgeAction::Assert { assertion } | KnowledgeAction::Correct { assertion, .. } => {
                let prior = if let KnowledgeAction::Correct { target, .. } = &c.action {
                    let r = load(
                        &mut tx,
                        &s.organisation_id,
                        &target.id,
                        Some(target.revision),
                    )
                    .await?;
                    if r.scope != scope
                        || r.kind != KnowledgeKind::Assertion
                        || !assess(&mut tx, actor, &consumer, s, task_id, &r)
                            .await?
                            .is_current()
                    {
                        return Err(KnowledgeError::Ineligible);
                    }
                    Some(r)
                } else {
                    None
                };
                let mut r = new_record(
                    prior.as_ref().map_or_else(token, |r| Ok(r.id.clone()))?,
                    actor,
                    scope.clone(),
                    at,
                    KnowledgeKind::Assertion,
                    assertion.text.clone(),
                );
                r.period = assertion.period.clone();
                r.uncertainty = assertion.uncertainty.clone();
                r.dependencies = assertion.dependencies.clone();
                if let Some(old) = &prior {
                    r.revision = old.revision + 1;
                    r.supersedes = Some(RecordReference {
                        id: old.id.clone(),
                        revision: old.revision,
                    });
                    result.affected_ids.push(old.id.clone())
                }
                // A new candidate has no persisted status yet; validate exact supports first.
                assertion_dependencies(&mut tx, actor, &consumer, s, task_id, &r).await?;
                insert(&mut tx, actor, &r).await?;
                if let (Some(old), KnowledgeAction::Correct { reason, .. }) = (&prior, &c.action) {
                    invalidate(&mut tx, actor, old, RecordStatus::Corrected, reason, None).await?;
                }
                result.record = Some(checked_view(&mut tx, actor, &consumer, s, task_id, r).await?);
            }
            KnowledgeAction::Exclude { target, reason }
            | KnowledgeAction::Forget { target, reason } => {
                let r = load(
                    &mut tx,
                    &s.organisation_id,
                    &target.id,
                    Some(target.revision),
                )
                .await?;
                let v = checked_view(&mut tx, actor, &consumer, s, task_id, r.clone()).await?;
                if v.status != RecordStatus::Current || r.scope.owner_id.is_some() {
                    return Err(KnowledgeError::Ineligible);
                }
                let st = if matches!(c.action, KnowledgeAction::Forget { .. }) {
                    RecordStatus::Forgotten
                } else {
                    RecordStatus::Excluded
                };
                // Exclusion from a named destination cannot erase its shared origin.
                invalidate(
                    &mut tx,
                    actor,
                    &r,
                    st,
                    reason,
                    if r.scope != scope {
                        Some(task_id)
                    } else {
                        None
                    },
                )
                .await?;
                result.affected_ids.push(r.id.clone());
                result.record = Some(scoped_view(r, st, Some(reason.clone()), s));
            }
            KnowledgeAction::Reuse {
                target,
                destination_task_id,
                reason,
                ..
            } => {
                let r = load(
                    &mut tx,
                    &s.organisation_id,
                    &target.id,
                    Some(target.revision),
                )
                .await?;
                if r.scope != scope || r.scope.owner_id.is_some() {
                    return Err(KnowledgeError::Denied);
                }
                if !assess(&mut tx, actor, &consumer, s, task_id, &r)
                    .await?
                    .is_current()
                {
                    return Err(KnowledgeError::Ineligible);
                }
                let dest = destination.as_ref().ok_or(KnowledgeError::Invalid)?;
                if !audit(&mut tx, &destination_consumer, dest).await?
                    || !assess(
                        &mut tx,
                        actor,
                        &destination_consumer,
                        dest,
                        destination_task_id,
                        &r,
                    )
                    .await?
                    .is_current()
                {
                    return Err(KnowledgeError::Ineligible);
                }
                sqlx::query("INSERT INTO public.knowledge_publications(organisation_id,id,record_id,revision,actor_id,client_id,engagement_id,task_id,kind,document) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'reuse',$9)").bind(&s.organisation_id).bind(&result.event_id).bind(&r.id).bind(r.revision as i64).bind(actor).bind(&dest.client_id).bind(&dest.engagement_id).bind(destination_task_id).bind(json!({"source":r.scope,"reason":reason,"recorded_at":at})).execute(&mut *tx).await.map_err(db)?;
                result
                    .affected_destinations
                    .push(dest.engagement_id.clone());
                result.record = Some(view(r, RecordStatus::Current, None));
            }
            KnowledgeAction::CorrectSource {
                predecessor_id,
                replacement_id,
                expected_source_revision,
                reason,
            } => {
                for id in [predecessor_id, replacement_id] {
                    let exists: bool = sqlx::query_scalar(
                        "SELECT EXISTS(SELECT 1 FROM public.evidence_originals WHERE id=$1)",
                    )
                    .bind(id)
                    .fetch_one(&mut *tx)
                    .await
                    .map_err(db)?;
                    if !exists {
                        return Err(KnowledgeError::Denied);
                    }
                }
                let current:i64=sqlx::query_scalar("SELECT coalesce(max(revision),0) FROM public.knowledge_source_corrections WHERE organisation_id=$1 AND original_id=$2").bind(&s.organisation_id).bind(predecessor_id).fetch_one(&mut *tx).await.map_err(db)?;
                if current as u64 != *expected_source_revision {
                    return Err(KnowledgeError::Conflict);
                }
                let mut pending = vec![replacement_id.clone()];
                let mut seen = BTreeSet::new();
                while let Some(id) = pending.pop() {
                    if id == *predecessor_id {
                        return Err(KnowledgeError::Cycle);
                    }
                    if !seen.insert(id.clone()) {
                        continue;
                    }
                    if seen.len() > CLOSURE_LIMIT {
                        return Err(KnowledgeError::Capacity);
                    }
                    let next:Vec<String>=sqlx::query_scalar("SELECT DISTINCT replacement_id COLLATE \"C\" FROM public.knowledge_source_corrections WHERE organisation_id=$1 AND original_id=$2 ORDER BY replacement_id COLLATE \"C\" LIMIT 257").bind(&s.organisation_id).bind(id).fetch_all(&mut *tx).await.map_err(db)?;
                    if next.len() > CLOSURE_LIMIT {
                        return Err(KnowledgeError::Capacity);
                    }
                    pending.extend(next);
                }
                sqlx::query("INSERT INTO public.knowledge_source_corrections(organisation_id,client_id,engagement_id,original_id,revision,replacement_id,actor_id,document) VALUES($1,$2,$3,$4,$5,$6,$7,$8)").bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id).bind(predecessor_id).bind(current+1).bind(replacement_id).bind(actor).bind(json!({"reason":reason,"recorded_at":at,"key":c.key})).execute(&mut *tx).await.map_err(db)?;
                result.affected_ids.push(predecessor_id.clone());
            }
        }
        receipt(&mut tx, actor, &scope, &c.key, &command, &result).await?;
        self.finish(&mut tx, actor, s, Some(&consumer)).await?;
        if let Some(dest) = destination
            && (!audit(&mut tx, actor, &dest).await?
                || !audit(&mut tx, &destination_consumer, &dest).await?)
        {
            return Err(KnowledgeError::Denied);
        }
        tx.commit().await.map_err(db)?;
        Ok(result)
    }
    async fn source_status(
        &self,
        actor: &str,
        s: &Scope,
        id: &str,
    ) -> Result<SourceStatus, KnowledgeError> {
        if !valid_scope_id(id) {
            return Err(KnowledgeError::Invalid);
        }
        let mut tx = self.scoped(actor, s, None).await?;
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM public.evidence_originals WHERE id=$1)",
        )
        .bind(id)
        .fetch_one(&mut *tx)
        .await
        .map_err(db)?;
        if !exists {
            return Err(KnowledgeError::Denied);
        }
        let correction=sqlx::query("SELECT revision,replacement_id,actor_id,document FROM public.knowledge_source_corrections WHERE organisation_id=$1 AND original_id=$2 ORDER BY revision DESC LIMIT 1").bind(&s.organisation_id).bind(id).fetch_optional(&mut *tx).await.map_err(db)?;
        let capture=sqlx::query("SELECT revision,document FROM public.knowledge_captures WHERE organisation_id=$1 AND original_id=$2 ORDER BY revision DESC LIMIT 1").bind(&s.organisation_id).bind(id).fetch_optional(&mut *tx).await.map_err(db)?;
        let mut result = SourceStatus {
            evidence_id: id.into(),
            source_revision: 0,
            replacement_id: None,
            correction_actor_id: None,
            correction_recorded_at: None,
            correction_reason: None,
            capture_revision: 0,
            omissions: vec![],
        };
        if let Some(row) = correction {
            result.source_revision = row.try_get::<i64, _>("revision").map_err(db)? as u64;
            result.replacement_id = Some(row.try_get("replacement_id").map_err(db)?);
            result.correction_actor_id = Some(row.try_get("actor_id").map_err(db)?);
            let document: Value = row.try_get("document").map_err(db)?;
            result.correction_recorded_at = document["recorded_at"].as_i64();
            result.correction_reason = document["reason"].as_str().map(str::to_owned);
            result.omissions.push(Omission::InvalidatedSupport)
        }
        if let Some(row) = capture {
            result.capture_revision = row.try_get::<i64, _>("revision").map_err(db)? as u64;
            let doc: Value = row.try_get("document").map_err(db)?;
            if doc["state"] != "captured" {
                result.omissions.push(Omission::UnavailableSupport)
            } else if !doc["omission"].is_null() {
                result.omissions.push(dec(doc["omission"].clone())?)
            }
            if doc["partial"] == true {
                result.omissions.push(Omission::PartialSource)
            }
        } else {
            result.omissions.push(Omission::LegacyNotCaptured)
        }
        unique_omissions(&mut result.omissions);
        self.finish(&mut tx, actor, s, None).await?;
        tx.commit().await.map_err(db)?;
        Ok(result)
    }
    async fn preference(
        &self,
        actor: &str,
        org: &str,
    ) -> Result<PreferenceSnapshot, KnowledgeError> {
        let mut tx = self.begin(actor, org).await?;
        let result = preference_snapshot(&mut tx, actor, org).await?;
        self.current(&mut tx, actor, org).await?;
        tx.commit().await.map_err(db)?;
        Ok(result)
    }
    async fn observe_layout(
        &self,
        actor: &str,
        org: &str,
        c: &ObserveLayout,
    ) -> Result<PreferenceSnapshot, KnowledgeError> {
        if !c.is_valid() {
            return Err(KnowledgeError::Invalid);
        }
        let mut tx = self.begin(actor, org).await?;
        let command = enc(c)?;
        if serde_json::to_vec(&command)
            .map_err(|_| KnowledgeError::Invalid)?
            .len()
            > 60_000
        {
            return Err(KnowledgeError::Capacity);
        }
        let old:Option<Value>=sqlx::query_scalar("SELECT document FROM public.knowledge_layout_events WHERE organisation_id=$1 AND actor_id=$2 AND key=$3").bind(org).bind(actor).bind(&c.key).fetch_optional(&mut *tx).await.map_err(db)?;
        if let Some(old) = old {
            if old != command {
                return Err(KnowledgeError::Conflict);
            }
        } else {
            if revision(&mut tx, &KnowledgeScope::personal(org, actor)).await?
                != c.expected_revision
            {
                return Err(KnowledgeError::Conflict);
            }
            sqlx::query("INSERT INTO public.knowledge_layout_events(organisation_id,actor_id,key,opening_id,ordinal,document) SELECT $1,$2,$3,$4,coalesce(max(ordinal),0)+1,$5 FROM public.knowledge_layout_events WHERE organisation_id=$1 AND actor_id=$2").bind(org).bind(actor).bind(&c.key).bind(&c.opening_id).bind(command).execute(&mut *tx).await.map_err(db)?;
            let snapshot = preference_snapshot(&mut tx, actor, org).await?;
            let observations=sqlx::query("SELECT key,opening_id,ordinal,document FROM (SELECT DISTINCT ON (opening_id COLLATE \"C\") key,opening_id,ordinal,document FROM public.knowledge_layout_events WHERE organisation_id=$1 AND actor_id=$2 AND ordinal>$3 AND document->>'kind' IS NULL ORDER BY opening_id COLLATE \"C\",ordinal DESC) o ORDER BY ordinal DESC LIMIT 2").bind(org).bind(actor).bind(snapshot.consumed_through as i64).fetch_all(&mut *tx).await.map_err(db)?;
            let observations = observations
                .into_iter()
                .map(|r| {
                    let doc: Value = r.try_get("document").map_err(db)?;
                    let value: InspectionLayout = dec(doc["value"].clone())?;
                    Ok(zobba_domain::knowledge::LayoutObservation {
                        id: r.try_get("key").map_err(db)?,
                        opening_id: r.try_get("opening_id").map_err(db)?,
                        sequence: r.try_get::<i64, _>("ordinal").map_err(db)? as u64,
                        value: value.to_domain(),
                    })
                })
                .collect::<Result<Vec<_>, KnowledgeError>>()?;
            let explicit = snapshot
                .current
                .as_ref()
                .and_then(|r| r.record.preference.as_ref())
                .is_some_and(|p| !p.inferred);
            if let Some(learned) = zobba_domain::knowledge::learn_layout(
                &observations,
                snapshot.consumed_through,
                explicit,
            ) {
                let value = InspectionLayout::from(learned.value);
                let r = save_preference(&mut tx, actor, org, value, true, learned.observation_ids)
                    .await?;
                let key = stable(&["learn", &c.key]);
                let result = KnowledgeReceipt {
                    event_id: token()?,
                    revision: snapshot.revision + 1,
                    record: Some(view(r, RecordStatus::Current, None)),
                    affected_ids: vec![],
                    affected_destinations: vec![],
                };
                receipt(
                    &mut tx,
                    actor,
                    &KnowledgeScope::personal(org, actor),
                    &key,
                    &json!({"learned_from":c}),
                    &result,
                )
                .await?;
                consume_observations(&mut tx, actor, org, &key).await?;
            }
        }
        let result = preference_snapshot(&mut tx, actor, org).await?;
        self.current(&mut tx, actor, org).await?;
        tx.commit().await.map_err(db)?;
        Ok(result)
    }
    async fn mutate_preference(
        &self,
        actor: &str,
        org: &str,
        c: &PreferenceCommand,
    ) -> Result<KnowledgeReceipt, KnowledgeError> {
        if !c.is_valid() {
            return Err(KnowledgeError::Invalid);
        }
        let mut tx = self.begin(actor, org).await?;
        let command = enc(c)?;
        if serde_json::to_vec(&command)
            .map_err(|_| KnowledgeError::Invalid)?
            .len()
            > 60_000
        {
            return Err(KnowledgeError::Capacity);
        }
        let scope = KnowledgeScope::personal(org, actor);
        if let Some(mut result) = previous(&mut tx, actor, org, &c.key, &command).await? {
            if let Some(v) = &mut result.record {
                let (st, reason) = status(&mut tx, &v.record, "").await?;
                *v = view(v.record.clone(), st, reason);
            }
            self.current(&mut tx, actor, org).await?;
            tx.commit().await.map_err(db)?;
            return Ok(result);
        }
        let rev = revision(&mut tx, &scope).await?;
        if rev != c.expected_revision {
            return Err(KnowledgeError::Conflict);
        }
        let mut result = KnowledgeReceipt {
            event_id: token()?,
            revision: rev + 1,
            record: None,
            affected_ids: vec![],
            affected_destinations: vec![],
        };
        match &c.action {
            PreferenceAction::Save { value } => {
                let r = save_preference(&mut tx, actor, org, *value, false, vec![]).await?;
                consume_observations(&mut tx, actor, org, &c.key).await?;
                result.record = Some(view(r, RecordStatus::Current, None));
            }
            PreferenceAction::Undo { target } => {
                let r = load(&mut tx, org, &target.id, Some(target.revision)).await?;
                if r.scope != scope || r.kind != KnowledgeKind::Preference {
                    return Err(KnowledgeError::Denied);
                }
                invalidate(
                    &mut tx,
                    actor,
                    &r,
                    RecordStatus::Withdrawn,
                    "Owner withdrew this preference; retained history is not a future setting.",
                    None,
                )
                .await?;
                let publications=sqlx::query("SELECT id,engagement_id FROM public.knowledge_publications WHERE organisation_id=$1 AND actor_id=$2 AND record_id=$3 AND revision=$4 ORDER BY id COLLATE \"C\" LIMIT 51").bind(org).bind(actor).bind(&r.id).bind(r.revision as i64).fetch_all(&mut *tx).await.map_err(db)?;
                if publications.len() > 50 {
                    return Err(KnowledgeError::Capacity);
                }
                for p in publications {
                    let id: String = p.try_get("id").map_err(db)?;
                    withdraw(&mut tx, actor, org, &id).await?;
                    let destination: String = p.try_get("engagement_id").map_err(db)?;
                    // Every release is withdrawn, while the receipt names each
                    // affected engagement only once, in publication-ID order.
                    if !result.affected_destinations.contains(&destination) {
                        result.affected_destinations.push(destination);
                    }
                }
                consume_observations(&mut tx, actor, org, &c.key).await?;
                result.affected_ids.push(r.id.clone());
                result.record = Some(view(
                    r,
                    RecordStatus::Withdrawn,
                    Some(
                        "Owner withdrew this preference; retained history is not a future setting."
                            .into(),
                    ),
                ));
            }
            PreferenceAction::Publish {
                target,
                client_id,
                engagement_id,
            } => {
                let r = load(&mut tx, org, &target.id, Some(target.revision)).await?;
                if r.scope != scope
                    || r.kind != KnowledgeKind::Preference
                    || status(&mut tx, &r, "").await?.0 != RecordStatus::Current
                {
                    return Err(KnowledgeError::Ineligible);
                }
                let destination = Scope {
                    organisation_id: org.into(),
                    client_id: client_id.clone(),
                    engagement_id: engagement_id.clone(),
                };
                select_scope(&mut tx, &destination).await?;
                if !audit(&mut tx, actor, &destination).await? {
                    return Err(KnowledgeError::Denied);
                }
                sqlx::query("SELECT id FROM public.engagements WHERE organisation_id=$1 AND client_id=$2 AND id=$3 FOR UPDATE").bind(org).bind(client_id).bind(engagement_id).fetch_optional(&mut *tx).await.map_err(db)?.ok_or(KnowledgeError::Denied)?;
                let count:i64=sqlx::query_scalar("SELECT count(*) FROM public.knowledge_publications WHERE organisation_id=$1 AND actor_id=$2 AND kind='preference'").bind(org).bind(actor).fetch_one(&mut *tx).await.map_err(db)?;
                if count >= 50 {
                    return Err(KnowledgeError::Capacity);
                }
                let basis = r.preference.as_ref().ok_or(KnowledgeError::Invalid)?;
                if basis.name != "task_inspection_layout" {
                    return Err(KnowledgeError::Ineligible);
                }
                let mut released = new_record(
                    result.event_id.clone(),
                    actor,
                    KnowledgeScope::engagement(&destination),
                    now(&mut tx).await?,
                    KnowledgeKind::PublishedPreference,
                    format!("Optional task inspection layout: {:?}", basis.value),
                );
                released.certainty = Certainty::ExplicitPreference;
                released.preference = Some(PreferenceBasis {
                    name: "task_inspection_layout".into(),
                    value: basis.value,
                    inferred: false,
                    rule: None,
                    observation_ids: vec![],
                });
                let document =
                    json!({"record":released,"private_origin":{"id":r.id,"revision":r.revision}});
                sqlx::query("INSERT INTO public.knowledge_publications(organisation_id,id,record_id,revision,actor_id,client_id,engagement_id,kind,document) VALUES($1,$2,$3,$4,$5,$6,$7,'preference',$8)").bind(org).bind(&result.event_id).bind(&r.id).bind(r.revision as i64).bind(actor).bind(client_id).bind(engagement_id).bind(document).execute(&mut *tx).await.map_err(db)?;
                result.affected_destinations.push(engagement_id.clone());
                result.record = Some(view(r, RecordStatus::Current, None));
                if !audit(&mut tx, actor, &destination).await? {
                    return Err(KnowledgeError::Denied);
                }
            }
            PreferenceAction::Withdraw { publication_id } => {
                let p=sqlx::query("SELECT engagement_id FROM public.knowledge_publications WHERE organisation_id=$1 AND id=$2 AND actor_id=$3").bind(org).bind(publication_id).bind(actor).fetch_optional(&mut *tx).await.map_err(db)?.ok_or(KnowledgeError::Denied)?;
                withdraw(&mut tx, actor, org, publication_id).await?;
                result
                    .affected_destinations
                    .push(p.try_get("engagement_id").map_err(db)?);
            }
        }
        receipt(&mut tx, actor, &scope, &c.key, &command, &result).await?;
        sqlx::query("SET CONSTRAINTS ALL IMMEDIATE")
            .execute(&mut *tx)
            .await
            .map_err(db)?;
        self.current(&mut tx, actor, org).await?;
        tx.commit().await.map_err(db)?;
        Ok(result)
    }
    async fn record_excerpt(
        &self,
        actor: &str,
        s: &Scope,
        c: &CaptureExcerpt,
        e: &RegisteredEvidence,
        x: &CapturedExcerpt,
    ) -> Result<KnowledgeReceipt, KnowledgeError> {
        if !c.is_valid()
            || c.evidence_id != e.reservation.id
            || c.byte_start != x.byte_start
            || c.byte_end != x.byte_end
        {
            return Err(KnowledgeError::Invalid);
        }
        let mut tx = self.scoped(actor, s, None).await?;
        let command = json!({"scope":KnowledgeScope::engagement(s),"command":c});
        if serde_json::to_vec(&command)
            .map_err(|_| KnowledgeError::Invalid)?
            .len()
            > 60_000
        {
            return Err(KnowledgeError::Capacity);
        }
        if let Some(mut result) =
            previous(&mut tx, actor, &s.organisation_id, &c.key, &command).await?
        {
            if let Some(record) = result.record.take() {
                result.record = self
                    .replay_record(&mut tx, actor, actor, s, "", record.record, None)
                    .await?;
            } else {
                self.finish(&mut tx, actor, s, None).await?;
            }
            tx.commit().await.map_err(db)?;
            return Ok(result);
        }
        verify_original(&mut tx, s, e).await?;
        let r = excerpt_record(&mut tx, actor, e, x).await?;
        let (st, reason) = assess(&mut tx, actor, actor, s, "", &r).await?.standing();
        let scope = KnowledgeScope::engagement(s);
        let result = KnowledgeReceipt {
            event_id: token()?,
            revision: revision(&mut tx, &scope).await? + 1,
            record: Some(view(r, st, reason)),
            affected_ids: vec![],
            affected_destinations: vec![],
        };
        receipt(&mut tx, actor, &scope, &c.key, &command, &result).await?;
        self.finish(&mut tx, actor, s, None).await?;
        tx.commit().await.map_err(db)?;
        Ok(result)
    }
    async fn recover_capture(
        &self,
        actor: &str,
        s: &Scope,
        key: &str,
        e: &RegisteredEvidence,
        capture: &EvidenceCapture,
    ) -> Result<KnowledgeReceipt, KnowledgeError> {
        if !valid_scope_id(key) {
            return Err(KnowledgeError::Invalid);
        }
        let mut tx = self.scoped(actor, s, None).await?;
        let command = json!({"kind":"recover_capture","evidence_id":e.reservation.id,"version":e.version,"digest":e.reservation.request.identity.sha256});
        let prior = previous(&mut tx, actor, &s.organisation_id, key, &command).await?;
        let eligible = match verify_original(&mut tx, s, e).await {
            Ok(()) => true,
            Err(KnowledgeError::Ineligible) if prior.is_some() => false,
            Err(error) => return Err(error),
        };
        // Eligible retries revisit the original beyond the early receipt. A
        // correction cannot erase the old receipt or authorize new source use.
        let records = if eligible {
            capture_registered(&mut tx, actor, e, capture).await?
        } else {
            vec![]
        };
        let prior = if eligible && prior.is_some() {
            previous(&mut tx, actor, &s.organisation_id, key, &command).await?
        } else {
            prior
        };
        if let Some(mut result) = prior {
            if let Some(record) = result.record.take() {
                result.record = self
                    .replay_record(&mut tx, actor, actor, s, "", record.record, None)
                    .await?;
            } else {
                self.finish(&mut tx, actor, s, None).await?;
            }
            tx.commit().await.map_err(db)?;
            return Ok(result);
        }
        let scope = KnowledgeScope::engagement(s);
        let current_record = if let Some(r) = records.first() {
            let (st, reason) = assess(&mut tx, actor, actor, s, "", r).await?.standing();
            Some(view(r.clone(), st, reason))
        } else {
            None
        };
        let result = KnowledgeReceipt {
            event_id: token()?,
            revision: revision(&mut tx, &scope).await? + 1,
            record: current_record,
            affected_ids: records.into_iter().map(|r| r.id).collect(),
            affected_destinations: vec![],
        };
        receipt(&mut tx, actor, &scope, key, &command, &result).await?;
        self.finish(&mut tx, actor, s, None).await?;
        tx.commit().await.map_err(db)?;
        Ok(result)
    }
}
async fn withdraw(tx: &mut Tx, actor: &str, org: &str, id: &str) -> Result<(), KnowledgeError> {
    let at = now(tx).await?;
    sqlx::query("INSERT INTO public.knowledge_withdrawals(organisation_id,publication_id,actor_id,document) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING").bind(org).bind(id).bind(actor).bind(json!({"recorded_at":at,"reason":"Owner withdrew the exact publication."})).execute(&mut **tx).await.map_err(db)?;
    Ok(())
}
async fn consumed(tx: &mut Tx, actor: &str, org: &str) -> Result<u64, KnowledgeError> {
    let n:i64=sqlx::query_scalar("SELECT coalesce(max(ordinal),0) FROM public.knowledge_layout_events WHERE organisation_id=$1 AND actor_id=$2 AND document->>'kind'='consume'").bind(org).bind(actor).fetch_one(&mut **tx).await.map_err(db)?;
    Ok(n as u64)
}
async fn consume_observations(
    tx: &mut Tx,
    actor: &str,
    org: &str,
    key: &str,
) -> Result<(), KnowledgeError> {
    let key = stable(&["consume", key]);
    sqlx::query("INSERT INTO public.knowledge_layout_events(organisation_id,actor_id,key,opening_id,ordinal,document) SELECT $1,$2,$3,$3,coalesce(max(ordinal),0)+1,'{\"kind\":\"consume\"}'::jsonb FROM public.knowledge_layout_events WHERE organisation_id=$1 AND actor_id=$2 ON CONFLICT DO NOTHING").bind(org).bind(actor).bind(key).execute(&mut **tx).await.map_err(db)?;
    Ok(())
}
async fn save_preference(
    tx: &mut Tx,
    actor: &str,
    org: &str,
    value: InspectionLayout,
    inferred: bool,
    ids: Vec<String>,
) -> Result<KnowledgeRecord, KnowledgeError> {
    let id = stable(&["task_inspection_layout", org, actor]);
    let prior = match load(tx, org, &id, None).await {
        Ok(r) => Some(r),
        Err(KnowledgeError::Denied) => None,
        Err(e) => return Err(e),
    };
    let mut r = new_record(
        id,
        actor,
        KnowledgeScope::personal(org, actor),
        now(tx).await?,
        KnowledgeKind::Preference,
        format!("Task inspection layout: {value:?}"),
    );
    r.certainty = if inferred {
        Certainty::Learned
    } else {
        Certainty::ExplicitPreference
    };
    r.preference = Some(PreferenceBasis {
        name: "task_inspection_layout".into(),
        value,
        inferred,
        rule: inferred.then(|| zobba_domain::knowledge::PREFERENCE_RULE.into()),
        observation_ids: ids,
    });
    if let Some(prior) = prior {
        r.revision = prior.revision + 1;
        r.supersedes = Some(RecordReference {
            id: prior.id,
            revision: prior.revision,
        })
    }
    insert(tx, actor, &r).await?;
    Ok(r)
}
async fn preference_snapshot(
    tx: &mut Tx,
    actor: &str,
    org: &str,
) -> Result<PreferenceSnapshot, KnowledgeError> {
    let scope = KnowledgeScope::personal(org, actor);
    let id = stable(&["task_inspection_layout", org, actor]);
    let current = match load(tx, org, &id, None).await {
        Ok(r) => {
            let (st, reason) = status(tx, &r, "").await?;
            (st == RecordStatus::Current).then(|| view(r, st, reason))
        }
        Err(KnowledgeError::Denied) => None,
        Err(e) => return Err(e),
    };
    let rows:Vec<Value>=sqlx::query_scalar("SELECT p.document||jsonb_build_object('withdrawn',EXISTS(SELECT 1 FROM public.knowledge_withdrawals w WHERE (w.organisation_id,w.publication_id)=(p.organisation_id,p.id))) FROM public.knowledge_publications p WHERE p.organisation_id=$1 AND p.actor_id=$2 AND p.kind='preference' ORDER BY p.id COLLATE \"C\" LIMIT 50").bind(org).bind(actor).fetch_all(&mut **tx).await.map_err(db)?;
    let mut publications = vec![];
    for p in rows {
        let r: KnowledgeRecord = dec(p["record"].clone())?;
        let mut v = view(
            r,
            if p["withdrawn"].as_bool() == Some(true) {
                RecordStatus::Withdrawn
            } else {
                RecordStatus::Current
            },
            None,
        );
        v.can_correct = false;
        v.can_exclude = false;
        v.can_forget = false;
        v.can_reuse = false;
        v.can_undo = v.status == RecordStatus::Current;
        publications.push(v)
    }
    Ok(PreferenceSnapshot {
        organisation_id: org.into(),
        owner_id: actor.into(),
        revision: revision(tx, &scope).await?,
        current,
        publications,
        consumed_through: consumed(tx, actor, org).await?,
    })
}
