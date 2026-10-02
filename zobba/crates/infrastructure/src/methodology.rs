//! Admin configuration and scoped immutable Task bases share organisation fences.
use crate::{identity::random_secret, scope, task};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use sqlx::{PgPool, Postgres, Transaction};
use zobba_application::{methodology::*, task::TaskError};
use zobba_domain::{
    identity::{Scope, valid_scope_id},
    methodology as domain,
};

type Tx = Transaction<'static, Postgres>;
#[derive(Clone)]
pub struct MethodologyRepository {
    pool: PgPool,
    session_hash: String,
}
fn database_error(error: sqlx::Error) -> MethodologyError {
    match error.as_database_error().and_then(|e| e.code()).as_deref() {
        Some("Z0001") => MethodologyError::Invalid,
        Some("Z0002") => MethodologyError::Denied,
        Some("Z0003") => MethodologyError::Conflict,
        Some("Z0006") => MethodologyError::Capacity,
        _ => MethodologyError::Unavailable,
    }
}
fn encode(value: &impl Serialize) -> Result<Value, MethodologyError> {
    serde_json::to_value(value).map_err(|_| MethodologyError::Invalid)
}
fn decode<T: DeserializeOwned>(value: Value) -> Result<T, MethodologyError> {
    serde_json::from_value(value).map_err(|_| MethodologyError::Unavailable)
}
fn opaque() -> Result<String, MethodologyError> {
    random_secret().map_err(|_| MethodologyError::Unavailable)
}
fn task_error(error: MethodologyError) -> TaskError {
    match error {
        MethodologyError::Denied => TaskError::Denied,
        MethodologyError::Invalid => TaskError::Invalid,
        MethodologyError::Capacity => TaskError::Capacity,
        _ => TaskError::Unavailable,
    }
}
async fn now(tx: &mut Tx) -> Result<i64, MethodologyError> {
    sqlx::query_scalar("SELECT floor(extract(epoch FROM clock_timestamp()))::bigint")
        .fetch_one(&mut **tx)
        .await
        .map_err(database_error)
}
async fn task_document(
    tx: &mut Tx,
    id: &str,
    action: &str,
    value: Value,
) -> Result<Value, MethodologyError> {
    sqlx::query_scalar("SELECT public.methodology_task($1,$2,$3)")
        .bind(id)
        .bind(action)
        .bind(value)
        .fetch_one(&mut **tx)
        .await
        .map_err(database_error)
}
async fn resolution(
    tx: &mut Tx,
    s: &Scope,
    id: &str,
    context: &TaskContext,
    at: i64,
) -> Result<(Resolution, Vec<String>), MethodologyError> {
    let value: Value = sqlx::query_scalar("SELECT public.methodology_candidates($1,$2,$3,$4)")
        .bind(&s.organisation_id)
        .bind(&s.client_id)
        .bind(&s.engagement_id)
        .bind(at)
        .fetch_one(&mut **tx)
        .await
        .map_err(database_error)?;
    let versions: Vec<VersionRecord> = decode(value)?;
    let candidates: Vec<_> = versions.iter().map(VersionRecord::candidate).collect();
    let ids = candidates
        .iter()
        .filter(|candidate| candidate.available_at <= at)
        .map(|candidate| candidate.version_id.clone())
        .collect();
    let template_versions: Vec<VersionRecord> =
        decode(task_document(tx, id, "templates", json!({"at":at})).await?)?;
    let template_sources: Vec<_> = template_versions
        .iter()
        .map(VersionRecord::template_source)
        .collect();
    Ok((
        domain::resolve_with_templates(&candidates, &template_sources, s, &context.to_domain(), at)
            .into(),
        ids,
    ))
}
async fn pending_resolution(
    tx: &mut Tx,
    s: &Scope,
    id: &str,
    context: &TaskContext,
    at: i64,
) -> Result<(Resolution, Vec<String>), MethodologyError> {
    let value = task_document(tx, id, "candidates", json!({"at":at})).await?;
    let versions: Vec<VersionRecord> = decode(value)?;
    let candidates: Vec<_> = versions.iter().map(VersionRecord::candidate).collect();
    let ids = candidates
        .iter()
        .filter(|candidate| candidate.available_at <= at)
        .map(|candidate| candidate.version_id.clone())
        .collect();
    let template_versions: Vec<VersionRecord> =
        decode(task_document(tx, id, "templates", json!({"at":at})).await?)?;
    let template_sources: Vec<_> = template_versions
        .iter()
        .map(VersionRecord::template_source)
        .collect();
    Ok((
        domain::resolve_with_templates(&candidates, &template_sources, s, &context.to_domain(), at)
            .into(),
        ids,
    ))
}
impl MethodologyRepository {
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
    async fn write(
        &self,
        actor: &str,
        org: &str,
        kind: &str,
        command: Value,
    ) -> Result<Receipt, MethodologyError> {
        if !valid_scope_id(actor) || !valid_scope_id(org) {
            return Err(MethodologyError::Invalid);
        }
        let mut tx = scope::begin_actor(&self.pool, actor)
            .await
            .map_err(|_| MethodologyError::Unavailable)?;
        let value: Value =
            sqlx::query_scalar("SELECT public.methodology_write($1,$2,$3,$4,$5,$6,$7)")
                .bind(actor)
                .bind(&self.session_hash)
                .bind(org)
                .bind(kind)
                .bind(command)
                .bind(opaque()?)
                .bind(opaque()?)
                .fetch_one(&mut *tx)
                .await
                .map_err(database_error)?;
        let result = decode(value)?;
        tx.commit().await.map_err(database_error)?;
        Ok(result)
    }
}
impl MethodologyStore for MethodologyRepository {
    async fn snapshot(&self, actor: &str, org: &str) -> Result<Snapshot, MethodologyError> {
        if !valid_scope_id(actor) || !valid_scope_id(org) {
            return Err(MethodologyError::Invalid);
        }
        let mut tx = scope::begin_actor(&self.pool, actor)
            .await
            .map_err(|_| MethodologyError::Unavailable)?;
        let value: Value = sqlx::query_scalar("SELECT public.methodology_read($1,$2,$3)")
            .bind(actor)
            .bind(&self.session_hash)
            .bind(org)
            .fetch_one(&mut *tx)
            .await
            .map_err(database_error)?;
        let result = decode(value)?;
        tx.commit().await.map_err(database_error)?;
        Ok(result)
    }
    async fn save(
        &self,
        actor: &str,
        org: &str,
        command: &SaveMethodology,
    ) -> Result<Receipt, MethodologyError> {
        if !command.is_valid() {
            return Err(MethodologyError::Invalid);
        }
        self.write(actor, org, "save", encode(command)?).await
    }
    async fn recall(
        &self,
        actor: &str,
        org: &str,
        command: &RecallMethodology,
    ) -> Result<Receipt, MethodologyError> {
        if !command.is_valid() {
            return Err(MethodologyError::Invalid);
        }
        self.write(actor, org, "recall", encode(command)?).await
    }
    async fn task_basis(
        &self,
        actor: &str,
        s: &Scope,
        id: &str,
    ) -> Result<TaskBasis, MethodologyError> {
        if !valid_scope_id(id) {
            return Err(MethodologyError::Invalid);
        }
        let mut tx = task::lock(&self.pool, actor, s)
            .await
            .map_err(|e| match e {
                TaskError::Denied => MethodologyError::Denied,
                _ => MethodologyError::Unavailable,
            })?;
        let allowed: bool = sqlx::query_scalar("SELECT public.evidence_session_locked($1,$2)")
            .bind(actor)
            .bind(&self.session_hash)
            .fetch_one(&mut *tx)
            .await
            .map_err(database_error)?;
        if !allowed {
            return Err(MethodologyError::Denied);
        }
        let value = task_document(&mut tx, id, "read", Value::Null).await?;
        let change_key = if value["pending_context"].is_null() {
            "pending_event"
        } else {
            "pending_context"
        };
        let context: TaskContext = decode(if change_key == "pending_context" {
            value[change_key]["context"].clone()
        } else {
            value["context"].clone()
        })?;
        let pending = if value[change_key].is_null() {
            None
        } else {
            let mut change = value[change_key].clone();
            let at = now(&mut tx).await?;
            let effective_at = if change_key == "pending_context" {
                at
            } else {
                at.max(change["available_at"].as_i64().unwrap_or(at))
            };
            change["resolution"] = encode(
                &pending_resolution(&mut tx, s, id, &context, effective_at)
                    .await?
                    .0,
            )?;
            Some(decode(change)?)
        };
        let result = TaskBasis {
            task_id: id.into(),
            current: decode(value["current"].clone())?,
            pending,
            history: decode(value["history"].clone())?,
            notices: decode(value["notices"].clone())?,
            recalled: decode(value["recalled"].clone())?,
        };
        tx.commit().await.map_err(database_error)?;
        Ok(result)
    }
}

/// Caller already holds organisation, engagement and Task locks in that order.
pub(crate) async fn bind_new_task(
    tx: &mut Tx,
    s: &Scope,
    id: &str,
    context: Option<&domain::TaskContext>,
) -> Result<(), TaskError> {
    let context = context.cloned().unwrap_or_default();
    let context = TaskContext {
        audit_area: context.audit_area,
        period_start: context.period_start,
        period_end: context.period_end,
    };
    let at = now(tx).await.map_err(task_error)?;
    let actor: String = sqlx::query_scalar("SELECT current_setting('zobba.actor_id')")
        .fetch_one(&mut **tx)
        .await
        .map_err(|_| TaskError::Unavailable)?;
    let (resolved, candidate_version_ids) = resolution(tx, s, id, &context, at)
        .await
        .map_err(task_error)?;
    let binding = Binding {
        context_command_id: None,
        // SQL assigns the effective Task epoch while retaining the caller's locks.
        execution_epoch: 0,
        id: opaque().map_err(task_error)?,
        bound_at: at,
        actor_id: actor,
        resolution: resolved,
        candidate_version_ids,
    };
    task_document(tx, id, "bind", json!({"binding":binding,"context":context}))
        .await
        .map_err(task_error)?;
    Ok(())
}
/// Re-resolution happens only after the coordinator reconciles consumed work.
pub(crate) async fn apply_pending(tx: &mut Tx, s: &Scope, id: &str) -> Result<bool, TaskError> {
    let at = now(tx).await.map_err(task_error)?;
    let value = task_document(tx, id, "read", json!({"at": at}))
        .await
        .map_err(task_error)?;
    let change_key = if value["pending_context"].is_null() {
        "pending_event"
    } else {
        "pending_context"
    };
    if value.is_null() || value[change_key].is_null() {
        return Ok(false);
    }
    if value[change_key]["available_at"]
        .as_i64()
        .is_some_and(|when| when > at)
    {
        return Ok(false);
    }
    let context: TaskContext = decode(if change_key == "pending_context" {
        value[change_key]["context"].clone()
    } else {
        value["context"].clone()
    })
    .map_err(task_error)?;
    let (resolved, candidate_version_ids) = pending_resolution(tx, s, id, &context, at)
        .await
        .map_err(task_error)?;
    let binding = Binding {
        context_command_id: None,
        execution_epoch: 0,
        candidate_version_ids,
        id: opaque().map_err(task_error)?,
        bound_at: at,
        actor_id: value[change_key]["actor_id"]
            .as_str()
            .ok_or(TaskError::Unavailable)?
            .into(),
        resolution: resolved,
    };
    let applied = task_document(tx, id, "apply", encode(&binding).map_err(task_error)?)
        .await
        .map_err(task_error)?;
    decode(applied).map_err(task_error)
}
pub(crate) async fn new_use_allowed(tx: &mut Tx, id: &str) -> Result<bool, TaskError> {
    decode(
        task_document(tx, id, "allowed", Value::Null)
            .await
            .map_err(task_error)?,
    )
    .map_err(task_error)
}
pub(crate) async fn pending_activation(tx: &mut Tx, id: &str) -> Result<Option<i64>, TaskError> {
    decode(
        task_document(tx, id, "next", Value::Null)
            .await
            .map_err(task_error)?,
    )
    .map_err(task_error)
}

/// Resolve an immutable claim/operation epoch across intervening control fences.
/// Current restrictions still govern use; this is attribution of actual production.
pub(crate) async fn binding_at_execution_epoch(
    tx: &mut Tx,
    id: &str,
    epoch: i64,
) -> Result<String, TaskError> {
    decode(
        task_document(tx, id, "basis", json!({"execution_epoch":epoch}))
            .await
            .map_err(task_error)?,
    )
    .map_err(task_error)
}

/// Stage only context supplied in an attributed, already-admitted Guide command.
/// The immutable Task command retains the request even if a later Guide supersedes it.
pub(crate) async fn stage_context(
    tx: &mut Tx,
    _scope: &Scope,
    id: &str,
    command_id: &str,
    actor: &str,
    context: &domain::TaskContext,
) -> Result<(), TaskError> {
    let context = TaskContext {
        audit_area: context.audit_area.clone(),
        period_start: context.period_start.clone(),
        period_end: context.period_end.clone(),
    };
    task_document(
        tx,
        id,
        "context",
        json!({"command_id":command_id,"actor_id":actor,"context":context}),
    )
    .await
    .map_err(task_error)?;
    Ok(())
}

/// Continue admits future active assignments using the same bounded cohort as Create.
/// The caller retains organisation, engagement and Task locks throughout admission.
pub(crate) async fn enroll_future(tx: &mut Tx, _scope: &Scope, id: &str) -> Result<(), TaskError> {
    let at = now(tx).await.map_err(task_error)?;
    task_document(tx, id, "cohort", json!({"at": at}))
        .await
        .map_err(task_error)?;
    Ok(())
}
