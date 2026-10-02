//! Scoped standing authority, immutable operation history and the dispatch cutoff.
//! Only the owned gateway receives a consumed attempt; all remote I/O is outside
//! these transactions. Current narrowing and Task controls share their lock order.
use crate::{scope, task};
use rand::{RngCore, rngs::OsRng};
use serde::{Serialize, de::DeserializeOwned};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Postgres, Row, Transaction, postgres::PgRow};
use zobba_application::{
    operation::{OperationError as Error, OperationStore, wire::*},
    task::TaskError,
};
use zobba_domain::{
    identity::{Scope, valid_scope_id},
    permissions::*,
    task::ClaimBasis,
};

type Tx = Transaction<'static, Postgres>;
#[derive(Clone)]
pub struct OperationRepository {
    pool: PgPool,
}
impl OperationRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}
fn unavailable(_: sqlx::Error) -> Error {
    Error::Unavailable
}
fn from_task(error: TaskError) -> Error {
    match error {
        TaskError::Denied => Error::Denied,
        TaskError::Fenced => Error::Fenced,
        _ => Error::Unavailable,
    }
}
fn token() -> String {
    let mut b = [0u8; 32];
    OsRng.fill_bytes(&mut b);
    b.iter().map(|v| format!("{v:02x}")).collect()
}
fn hash(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|v| format!("{v:02x}"))
        .collect()
}
fn encode<T: Serialize>(value: &T) -> Result<String, Error> {
    serde_json::to_string(value).map_err(|_| Error::Invalid)
}
fn decode<T: DeserializeOwned>(value: &str) -> Result<T, Error> {
    serde_json::from_str(value).map_err(|_| Error::Unavailable)
}
fn field<T>(row: &PgRow, name: &str) -> Result<T, Error>
where
    for<'a> T: sqlx::Decode<'a, Postgres> + sqlx::Type<Postgres>,
{
    row.try_get(name).map_err(unavailable)
}
fn shared(kind: PolicyKind) -> bool {
    matches!(
        kind,
        PolicyKind::Organisation | PolicyKind::Member | PolicyKind::Account
    )
}
fn policy_key(s: &Scope, kind: PolicyKind, subject: &str) -> String {
    if shared(kind) {
        format!("{}_{}", kind.as_str(), subject)
    } else {
        format!(
            "{}:{}{}:{}{}:{}",
            s.client_id.len(),
            s.client_id,
            s.engagement_id.len(),
            s.engagement_id,
            kind.as_str(),
            subject
        )
    }
}
async fn read_fence(tx: &mut Tx, s: &Scope) -> Result<(), Error> {
    let allowed:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM public.engagements WHERE organisation_id=$1 AND client_id=$2 AND id=$3)")
        .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id).fetch_one(&mut **tx).await.map_err(unavailable)?;
    if allowed { Ok(()) } else { Err(Error::Denied) }
}
async fn clock(tx: &mut Tx) -> Result<i64, Error> {
    sqlx::query_scalar("SELECT floor(extract(epoch from clock_timestamp()))::bigint")
        .fetch_one(&mut **tx)
        .await
        .map_err(unavailable)
}
async fn lock(pool: &PgPool, actor: &str, s: &Scope) -> Result<Tx, Error> {
    let mut tx = scope::begin(pool, actor, s).await.map_err(|e| match e {
        scope::ScopeError::Denied => Error::Denied,
        _ => Error::Unavailable,
    })?;
    // Organisation policies are shared across engagements. Always acquire this
    // lock before the existing engagement row, never after a Task/control lock.
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,205))")
        .bind(&s.organisation_id)
        .execute(&mut *tx)
        .await
        .map_err(unavailable)?;
    sqlx::query("SELECT id FROM public.engagements WHERE organisation_id=$1 AND client_id=$2 AND id=$3 FOR UPDATE").bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id).fetch_optional(&mut *tx).await.map_err(unavailable)?.ok_or(Error::Denied)?;
    Ok(tx)
}
async fn admin(tx: &mut Tx, actor: &str, s: &Scope) -> Result<bool, Error> {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM public.organisation_memberships WHERE organisation_id=$1 AND actor_id=$2 AND 'admin'=ANY(roles))").bind(&s.organisation_id).bind(actor).fetch_one(&mut **tx).await.map_err(unavailable)
}
async fn authorize_policy(
    tx: &mut Tx,
    actor: &str,
    s: &Scope,
    doc: &PolicyDocument,
) -> Result<(), Error> {
    if admin(tx, actor, s).await? {
        return Ok(());
    }
    let task_id = match doc.kind {
        PolicyKind::Task => doc.subject_id.clone(),
        PolicyKind::Delegation => {
            let mut parent = doc.parent.clone().ok_or(Error::Denied)?;
            let mut seen = Vec::new();
            loop {
                if parent.kind == PolicyKind::Task {
                    break parent.subject_id;
                }
                if parent.kind != PolicyKind::Delegation
                    || seen.len() >= DELEGATION_MAX
                    || seen.contains(&parent.subject_id)
                {
                    return Err(Error::Denied);
                }
                seen.push(parent.subject_id.clone());
                let next = load_policy(tx, s, parent.kind, &parent.subject_id).await?;
                if next.reference() != parent || next.revoked {
                    return Err(Error::Denied);
                }
                parent = next.parent.ok_or(Error::Denied)?;
            }
        }
        _ => return Err(Error::Denied),
    };
    let row = task::task(tx, &task_id).await.map_err(from_task)?;
    if field::<String>(&row, "accountable_actor")? != actor {
        return Err(Error::Denied);
    }
    Ok(())
}
async fn load_policy(
    tx: &mut Tx,
    s: &Scope,
    kind: PolicyKind,
    subject: &str,
) -> Result<PolicyDocument, Error> {
    let text:Option<String>=sqlx::query_scalar("SELECT v.document FROM public.permission_heads h JOIN public.permission_versions v ON (v.organisation_id,v.policy_key,v.version)=(h.organisation_id,h.policy_key,h.current_version) WHERE h.organisation_id=$1 AND h.policy_key=$2")
        .bind(&s.organisation_id).bind(policy_key(s,kind,subject)).fetch_optional(&mut **tx).await.map_err(unavailable)?;
    let doc: StoredPolicy = decode(&text.ok_or(Error::Denied)?)?;
    if doc.0.kind != kind || doc.0.subject_id != subject || !doc.0.is_valid() {
        return Err(Error::Unavailable);
    }
    Ok(doc.0)
}
async fn write_policy(
    tx: &mut Tx,
    s: &Scope,
    doc: &PolicyDocument,
    snapshot: Option<&AuthoritySnapshot>,
    key: Option<&str>,
) -> Result<PolicyReference, Error> {
    let pkey = policy_key(s, doc.kind, &doc.subject_id);
    let current:Option<i64>=sqlx::query_scalar("SELECT current_version FROM public.permission_heads WHERE organisation_id=$1 AND policy_key=$2").bind(&s.organisation_id).bind(&pkey).fetch_optional(&mut **tx).await.map_err(unavailable)?;
    if doc.version != current.unwrap_or(0) as u64 + 1 {
        return Err(Error::Conflict);
    }
    let (client, engagement) = if shared(doc.kind) {
        (None, None)
    } else {
        (Some(&s.client_id), Some(&s.engagement_id))
    };
    let accepted = snapshot
        .map(|v| encode(&StoredAuthority(v.clone())))
        .transpose()?;
    let document = encode(&StoredPolicy(doc.clone()))?;
    if document.len() > 131_072 || accepted.as_ref().is_some_and(|v| v.len() > 1_048_576) {
        return Err(Error::Invalid);
    }
    sqlx::query("INSERT INTO public.permission_versions(organisation_id,policy_key,client_id,engagement_id,kind,subject_id,version,document,accepted_snapshot,actor_id,command_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)")
        .bind(&s.organisation_id).bind(&pkey).bind(client).bind(engagement).bind(doc.kind.as_str()).bind(&doc.subject_id).bind(doc.version as i64).bind(document).bind(accepted).bind(&doc.actor_id).bind(key).execute(&mut **tx).await.map_err(unavailable)?;
    sqlx::query("INSERT INTO public.permission_heads(organisation_id,policy_key,client_id,engagement_id,current_version) VALUES($1,$2,$3,$4,$5) ON CONFLICT(organisation_id,policy_key) DO UPDATE SET current_version=EXCLUDED.current_version")
        .bind(&s.organisation_id).bind(&pkey).bind(client).bind(engagement).bind(doc.version as i64).execute(&mut **tx).await.map_err(unavailable)?;
    Ok(doc.reference())
}
async fn accepted(tx: &mut Tx, s: &Scope, task_id: &str) -> Result<AuthoritySnapshot, Error> {
    let value:Option<String>=sqlx::query_scalar("SELECT v.accepted_snapshot FROM public.permission_heads h JOIN public.permission_versions v ON (v.organisation_id,v.policy_key,v.version)=(h.organisation_id,h.policy_key,h.current_version) WHERE h.organisation_id=$1 AND h.policy_key=$2")
        .bind(&s.organisation_id).bind(policy_key(s,PolicyKind::Task,task_id)).fetch_optional(&mut **tx).await.map_err(unavailable)?.flatten();
    let data: StoredAuthority = decode(&value.ok_or(Error::Denied)?)?;
    if !data.0.is_valid() || data.0.scope != *s || data.0.task_id != task_id {
        return Err(Error::Denied);
    }
    Ok(data.0)
}
async fn current(tx: &mut Tx, accepted: &AuthoritySnapshot) -> Result<AuthoritySnapshot, Error> {
    let s = &accepted.scope;
    let mut now = accepted.clone();
    now.organisation = load_policy(tx, s, PolicyKind::Organisation, &s.organisation_id).await?;
    now.engagement = load_policy(tx, s, PolicyKind::Engagement, &s.engagement_id).await?;
    now.member = load_policy(tx, s, PolicyKind::Member, &accepted.actor_id).await?;
    now.account = load_policy(tx, s, PolicyKind::Account, &accepted.account.subject_id).await?;
    now.task = load_policy(tx, s, PolicyKind::Task, &accepted.task_id).await?;
    now.delegations.clear();
    for ancestor in &accepted.delegations {
        now.delegations
            .push(load_policy(tx, s, PolicyKind::Delegation, &ancestor.subject_id).await?);
    }
    Ok(now)
}

/// Read-only authority inspection in the caller's existing organisation →
/// engagement → Task transaction. The accepted actor is never replaced by the
/// viewer. No operation, decision, claim or wakeup is created by this query.
pub(crate) async fn skill_authority(
    tx: &mut Tx,
    s: &Scope,
    task_id: &str,
) -> Result<Option<(AuthoritySnapshot, Result<AuthoritySnapshot, Error>, String)>, Error> {
    let value: Option<String> = sqlx::query_scalar("SELECT v.accepted_snapshot FROM public.permission_heads h JOIN public.permission_versions v ON (v.organisation_id,v.policy_key,v.version)=(h.organisation_id,h.policy_key,h.current_version) WHERE h.organisation_id=$1 AND h.policy_key=$2")
        .bind(&s.organisation_id)
        .bind(policy_key(s, PolicyKind::Task, task_id))
        .fetch_optional(&mut **tx)
        .await
        .map_err(unavailable)?
        .flatten();
    let Some(value) = value else { return Ok(None) };
    let accepted: StoredAuthority = decode(&value)?;
    if !accepted.0.is_valid() || accepted.0.scope != *s || accepted.0.task_id != task_id {
        return Err(Error::Unavailable);
    }
    let current = current(tx, &accepted.0).await;
    let fingerprint = match &current {
        Ok(now) => hash(format!("{}:{}", value, encode(&StoredAuthority(now.clone()))?).as_bytes()),
        Err(Error::Denied) => hash(format!("{value}:current-authority-missing").as_bytes()),
        Err(_) => return Err(Error::Unavailable),
    };
    Ok(Some((accepted.0, current, fingerprint)))
}
async fn operation_row(tx: &mut Tx, id: &str) -> Result<PgRow, Error> {
    sqlx::query("SELECT * FROM public.operations WHERE id=$1")
        .bind(id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(unavailable)?
        .ok_or(Error::Denied)
}
async fn latest_fact(tx: &mut Tx, attempt: &str) -> Result<SourceFact, Error> {
    let value:Option<String>=sqlx::query_scalar("SELECT outcome FROM public.operation_receipts WHERE attempt_id=$1 ORDER BY CASE outcome WHEN 'completed' THEN 0 WHEN 'absent' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,created_at DESC,id DESC LIMIT 1").bind(attempt).fetch_optional(&mut **tx).await.map_err(unavailable)?;
    Ok(match value.as_deref() {
        Some("completed") => SourceFact::Completed,
        Some("absent") => SourceFact::AuthoritativelyAbsent,
        Some("pending") => SourceFact::Accepted,
        _ => SourceFact::Unknown,
    })
}
async fn decision_row(tx: &mut Tx, id: &str) -> Result<Option<PgRow>, Error> {
    sqlx::query("SELECT * FROM public.operation_decisions WHERE operation_id=$1 ORDER BY allow ASC,created_at DESC,id DESC LIMIT 1").bind(id).fetch_optional(&mut **tx).await.map_err(unavailable)
}
fn decision_projection(row: &PgRow) -> Result<OperationDecision, Error> {
    let command: StoredDecision = decode(&field::<String>(row, "decision")?)?;
    Ok(OperationDecision {
        id: field(row, "id")?,
        operation_id: field(row, "operation_id")?,
        actor_id: field(row, "actor_id")?,
        request_digest: field(row, "request_digest")?,
        expected_revision: command.0.expected_revision,
        expires_at: field(row, "expires_at")?,
        allowed: field(row, "allow")?,
    })
}
async fn project(tx: &mut Tx, row: &PgRow) -> Result<Operation, Error> {
    let request: StoredCanonical = decode(&field::<String>(row, "request")?)?;
    let accepted: StoredAuthority = decode(&field::<String>(row, "authority_snapshot")?)?;
    let now = clock(tx).await?;
    let id: String = field(row, "id")?;
    let mut state = match current(tx, &accepted.0).await {
        Ok(c) => match evaluate(&request.0, &c, &accepted.0, now) {
            PermissionVerdict::Denied => OperationState::Revoked,
            PermissionVerdict::NeedsDecision => OperationState::NeedsDecision,
            PermissionVerdict::Standing => OperationState::Ready,
        },
        Err(Error::Denied) => OperationState::Revoked,
        Err(e) => return Err(e),
    };
    let producing: StoredBasis = decode(&field::<String>(row, "basis")?)?;
    let task = sqlx::query(
        "SELECT state,cycle_id,intent_revision,execution_epoch FROM public.tasks WHERE id=$1",
    )
    .bind(&producing.0.task_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(unavailable)?
    .ok_or(Error::Denied)?;
    if !matches!(
        field::<String>(&task, "state")?.as_str(),
        "ready" | "running"
    ) || field::<String>(&task, "cycle_id")? != producing.0.cycle_id
        || field::<i64>(&task, "intent_revision")? != producing.0.intent_revision
        || field::<i64>(&task, "execution_epoch")? != producing.0.execution_epoch
        || !crate::methodology::new_use_allowed(tx, &producing.0.task_id)
            .await
            .map_err(from_task)?
    {
        state = OperationState::Revoked;
    }
    if let Some(decision) = decision_row(tx, &id).await? {
        if !field::<bool>(&decision, "allow")? {
            state = OperationState::Revoked;
        } else if state == OperationState::NeedsDecision
            && field::<i64>(&decision, "expires_at")? > now
        {
            state = OperationState::Ready;
        }
    }
    if let Some(attempt)=sqlx::query("SELECT a.id,c.state FROM public.operation_attempts a JOIN public.operation_claims c ON c.attempt_id=a.id WHERE a.operation_id=$1 ORDER BY a.attempt_number DESC LIMIT 1").bind(&id).fetch_optional(&mut **tx).await.map_err(unavailable)?
        && field::<String>(&attempt,"state")?=="consumed" {
        state=match latest_fact(tx,&field::<String>(&attempt,"id")?).await?{SourceFact::Unknown=>OperationState::PossiblyDispatched,SourceFact::Accepted=>OperationState::Accepted,SourceFact::Completed=>OperationState::Completed,SourceFact::AuthoritativelyAbsent=>OperationState::Absent};
    }
    Ok(Operation {
        source: decode::<StoredSource>(&field::<String>(row, "source_binding")?)?.0,
        id,
        task_id: field(row, "task_id")?,
        cycle_id: field(row, "cycle_id")?,
        actor_id: field(row, "actor_id")?,
        execution_epoch: producing.0.execution_epoch as u64,
        methodology_binding_id: crate::methodology::binding_at_execution_epoch(
            tx,
            &producing.0.task_id,
            producing.0.execution_epoch,
        )
        .await
        .map_err(from_task)?,
        request: request.0,
        request_digest: field(row, "request_digest")?,
        revision: 1,
        state,
    })
}
async fn verify_basis(tx: &mut Tx, b: &ClaimBasis) -> Result<(), Error> {
    let row = task::task(tx, &b.task_id).await.map_err(from_task)?;
    if !task::valid_basis(&row, b).map_err(from_task)?
        || !crate::methodology::new_use_allowed(tx, &b.task_id)
            .await
            .map_err(from_task)?
    {
        return Err(Error::Fenced);
    }
    let claim = sqlx::query("SELECT * FROM public.task_claims WHERE id=$1 AND state IN ('admitted','consumed') AND NOT EXISTS(SELECT 1 FROM public.task_observations o WHERE o.claim_id=task_claims.id)")
        .bind(&b.claim_id).fetch_optional(&mut **tx).await.map_err(unavailable)?.ok_or(Error::Fenced)?;
    if !task::claim_matches(&claim, b).map_err(from_task)? {
        return Err(Error::Fenced);
    }
    Ok(())
}

fn source_key(source: &SourceBinding) -> String {
    format!(
        "{}:{}{}:{}",
        source.source_id.len(),
        source.source_id,
        source.ledger_id.len(),
        source.ledger_id
    )
}
async fn verify_material(
    tx: &mut Tx,
    s: &Scope,
    source: &SourceBinding,
    request: &CanonicalOperation,
) -> Result<(), Error> {
    if !source.is_valid() {
        return Err(Error::Denied);
    }
    for attachment in &request.attachments {
        let trusted:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM public.trusted_attachment_metadata WHERE organisation_id=$1 AND client_id=$2 AND engagement_id=$3 AND source_key=$4 AND attachment_id=$5 AND digest=$6 AND classification=$7)")
            .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id).bind(source_key(source)).bind(&attachment.id).bind(&attachment.digest).bind(&attachment.classification).fetch_one(&mut **tx).await.map_err(unavailable)?;
        if !trusted {
            return Err(Error::Denied);
        }
    }
    Ok(())
}
async fn dispatch_authority(
    tx: &mut Tx,
    id: &str,
    request: &CanonicalOperation,
    accepted: &AuthoritySnapshot,
    source: &SourceBinding,
) -> Result<(), Error> {
    let current = current(tx, accepted).await?;
    if current
        .account
        .account
        .as_ref()
        .is_none_or(|v| v.source != *source)
        || accepted
            .account
            .account
            .as_ref()
            .is_none_or(|v| v.source != *source)
    {
        return Err(Error::Denied);
    }
    verify_material(tx, &accepted.scope, source, request).await?;
    let now = clock(tx).await?;
    let decision = decision_row(tx, id).await?;
    if decision
        .as_ref()
        .map(|d| field::<bool>(d, "allow"))
        .transpose()?
        == Some(false)
    {
        return Err(Error::Denied);
    }
    match evaluate(request, &current, accepted, now) {
        PermissionVerdict::Denied => Err(Error::Denied),
        PermissionVerdict::Standing => Ok(()),
        PermissionVerdict::NeedsDecision => {
            let decision = decision.ok_or(Error::NeedsDecision)?;
            if field::<i64>(&decision, "expires_at")? <= now {
                return Err(Error::NeedsDecision);
            }
            Ok(())
        }
    }
}
async fn recovery_authority(
    tx: &mut Tx,
    actor: &str,
    attempt: &PgRow,
    row: &PgRow,
) -> Result<(), Error> {
    if field::<String>(row, "actor_id")? != actor {
        return Err(Error::Denied);
    }
    let accepted: StoredAuthority = decode(&field::<String>(row, "authority_snapshot")?)?;
    let request: StoredCanonical = decode(&field::<String>(row, "request")?)?;
    let source: StoredSource = decode(&field::<String>(row, "source_binding")?)?;
    let current = current(tx, &accepted.0).await?;
    if !source.0.is_valid()
        || !current.is_valid()
        || current.documents().any(|d| d.revoked)
        || current
            .account
            .account
            .as_ref()
            .is_none_or(|v| v.source != source.0 || !v.permits(&request.0))
        || field::<String>(attempt, "source_binding")? != encode(&source)?
    {
        return Err(Error::Denied);
    }
    let now = clock(tx).await?;
    let mut lookup_request = request.0;
    lookup_request.expires_at = now + 1;
    if current
        .documents()
        .any(|d| !d.hard.covers(&lookup_request, now))
    {
        return Err(Error::Denied);
    }
    Ok(())
}

impl OperationStore for OperationRepository {
    async fn history(
        &self,
        actor: &str,
        s: &Scope,
        operation_id: &str,
        query: &OperationHistoryQuery,
    ) -> Result<OperationHistory, Error> {
        if !valid_scope_id(operation_id) || !query.is_valid() {
            return Err(Error::Invalid);
        }
        let mut tx = scope::begin(&self.pool, actor, s)
            .await
            .map_err(|e| match e {
                scope::ScopeError::Denied => Error::Denied,
                _ => Error::Unavailable,
            })?;
        let operation = operation_row(&mut tx, operation_id).await?;
        let decisions=sqlx::query("SELECT *,floor(extract(epoch from created_at))::bigint AS recorded_at FROM public.operation_decisions WHERE operation_id=$1 AND ($2::text IS NULL OR id>$2) ORDER BY id LIMIT 51")
            .bind(operation_id).bind(&query.after_decision_id).fetch_all(&mut *tx).await.map_err(unavailable)?;
        let attempts=sqlx::query("SELECT *,floor(extract(epoch from created_at))::bigint AS recorded_at FROM public.operation_attempts WHERE operation_id=$1 AND ($2::text IS NULL OR id>$2) ORDER BY id LIMIT 51")
            .bind(operation_id).bind(&query.after_attempt_id).fetch_all(&mut *tx).await.map_err(unavailable)?;
        let observations=sqlx::query("SELECT r.*,floor(extract(epoch from r.created_at))::bigint AS recorded_at FROM public.operation_receipts r JOIN public.operation_attempts a ON a.id=r.attempt_id WHERE a.operation_id=$1 AND ($2::text IS NULL OR r.id>$2) ORDER BY r.id LIMIT 51")
            .bind(operation_id).bind(&query.after_observation_id).fetch_all(&mut *tx).await.map_err(unavailable)?;
        fn next(rows: &[PgRow]) -> Result<Option<String>, Error> {
            if rows.len() > OPERATION_HISTORY_PAGE_SIZE {
                Ok(Some(field(&rows[OPERATION_HISTORY_PAGE_SIZE - 1], "id")?))
            } else {
                Ok(None)
            }
        }
        let mut attempt_entries = Vec::new();
        for r in attempts.iter().take(OPERATION_HISTORY_PAGE_SIZE) {
            let source: StoredSource = decode(&field::<String>(r, "source_binding")?)?;
            let basis: StoredBasis = decode(&field::<String>(r, "basis")?)?;
            attempt_entries.push(AttemptHistoryEntry {
                id: field(r, "id")?,
                operation_id: operation_id.into(),
                number: field::<i64>(r, "attempt_number")? as u64,
                execution_epoch: basis.0.execution_epoch as u64,
                methodology_binding_id: crate::methodology::binding_at_execution_epoch(
                    &mut tx,
                    &basis.0.task_id,
                    basis.0.execution_epoch,
                )
                .await
                .map_err(from_task)?,
                request_digest: field(&operation, "request_digest")?,
                recorded_at: field(r, "recorded_at")?,
                source_id: Some(source.0.source_id),
                ledger_id: Some(source.0.ledger_id),
            });
        }
        let result = OperationHistory {
            operation_id: operation_id.into(),
            decision_next_cursor: next(&decisions)?,
            attempt_next_cursor: next(&attempts)?,
            observation_next_cursor: next(&observations)?,
            decisions: decisions
                .iter()
                .take(OPERATION_HISTORY_PAGE_SIZE)
                .map(|r| {
                    Ok(DecisionHistoryEntry {
                        key: field(r, "key")?,
                        decision: decision_projection(r)?,
                        recorded_at: field(r, "recorded_at")?,
                    })
                })
                .collect::<Result<_, Error>>()?,
            attempts: attempt_entries,
            observations: observations
                .iter()
                .take(OPERATION_HISTORY_PAGE_SIZE)
                .map(|r| {
                    Ok(ObservationHistoryEntry {
                        id: field(r, "id")?,
                        attempt_id: field(r, "attempt_id")?,
                        recorded_at: field(r, "recorded_at")?,
                        fact: match field::<String>(r, "outcome")?.as_str() {
                            "unknown" => SourceFact::Unknown,
                            "pending" => SourceFact::Accepted,
                            "completed" => SourceFact::Completed,
                            "absent" => SourceFact::AuthoritativelyAbsent,
                            _ => return Err(Error::Unavailable),
                        },
                        source: match field::<String>(r, "source")?.as_str() {
                            "dispatch" => ObservationSource::Dispatch,
                            "reconciliation" => ObservationSource::Reconciliation,
                            _ => return Err(Error::Unavailable),
                        },
                    })
                })
                .collect::<Result<_, Error>>()?,
        };
        read_fence(&mut tx, s).await?;
        tx.commit().await.map_err(unavailable)?;
        Ok(result)
    }
    async fn reauthorize_recovery(
        &self,
        actor: &str,
        s: &Scope,
        custody: &ConsumedOperation,
    ) -> Result<(), Error> {
        if custody.custody != OperationCustody::ReceiptOnly
            || custody.basis.actor_id != actor
            || custody.basis.scope != *s
            || !valid_digest(&custody.receipt_capability)
        {
            return Err(Error::Denied);
        }
        let mut tx = lock(&self.pool, actor, s).await?;
        let attempt=sqlx::query("SELECT a.*,c.id AS claim_id FROM public.operation_attempts a JOIN public.operation_claims c ON c.attempt_id=a.id WHERE a.id=$1 AND c.state='consumed'")
            .bind(&custody.attempt_id).fetch_optional(&mut *tx).await.map_err(unavailable)?.ok_or(Error::Denied)?;
        let row = operation_row(&mut tx, &field::<String>(&attempt, "operation_id")?).await?;
        let mut basis: StoredBasis = decode(&field::<String>(&attempt, "basis")?)?;
        basis.0.process_instance = custody.basis.process_instance.clone();
        let request: StoredCanonical = decode(&field::<String>(&row, "request")?)?;
        let source: StoredSource = decode(&field::<String>(&row, "source_binding")?)?;
        if basis.0 != custody.basis
            || request.0 != custody.request
            || source.0 != custody.source
            || field::<String>(&row, "id")? != custody.operation_id
            || field::<String>(&row, "request_digest")? != custody.request_digest
            || field::<String>(&attempt, "claim_id")? != custody.claim_id
        {
            return Err(Error::Denied);
        }
        recovery_authority(&mut tx, actor, &attempt, &row).await?;
        sqlx::query("SELECT set_config('zobba.receipt_claim',$1,true),set_config('zobba.receipt_hash',$2,true),set_config('zobba.receipt_org',$3,true),set_config('zobba.receipt_client',$4,true),set_config('zobba.receipt_engagement',$5,true)")
            .bind(&custody.attempt_id).bind(hash(custody.receipt_capability.as_bytes())).bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id).execute(&mut *tx).await.map_err(unavailable)?;
        let valid:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM public.operation_receipt_slots WHERE attempt_id=$1 AND producer_id=$2 AND custody='reconciliation')")
            .bind(&custody.attempt_id).bind(&custody.basis.process_instance).fetch_one(&mut *tx).await.map_err(unavailable)?;
        if !valid {
            return Err(Error::Denied);
        }
        read_fence(&mut tx, s).await?;
        tx.commit().await.map_err(unavailable)
    }

    async fn save_policy(
        &self,
        actor: &str,
        s: &Scope,
        doc: &PolicyDocument,
    ) -> Result<PolicyReference, Error> {
        if !doc.is_valid() || doc.actor_id != actor {
            return Err(Error::Invalid);
        }
        let mut tx = lock(&self.pool, actor, s).await?;
        if doc.created_at > clock(&mut tx).await? {
            return Err(Error::Invalid);
        }
        // Existing custody and the proposed lineage must both authorize a
        // revision. A new parent cannot adopt another Task owner's delegation.
        let existing = sqlx::query("SELECT v.document,v.accepted_snapshot FROM public.permission_heads h JOIN public.permission_versions v ON (v.organisation_id,v.policy_key,v.version)=(h.organisation_id,h.policy_key,h.current_version) WHERE h.organisation_id=$1 AND h.policy_key=$2")
            .bind(&s.organisation_id).bind(policy_key(s,doc.kind,&doc.subject_id)).fetch_optional(&mut *tx).await.map_err(unavailable)?;
        if let Some(row) = &existing {
            let original: StoredPolicy = decode(&field::<String>(row, "document")?)?;
            authorize_policy(&mut tx, actor, s, &original.0).await?;
        }
        authorize_policy(&mut tx, actor, s, doc).await?;
        let retained = if doc.kind == PolicyKind::Task {
            existing
                .as_ref()
                .map(|r| field::<Option<String>>(r, "accepted_snapshot"))
                .transpose()?
                .flatten()
                .map(|v| decode::<StoredAuthority>(&v))
                .transpose()?
                .map(|v| v.0)
        } else {
            None
        };
        let result = write_policy(&mut tx, s, doc, retained.as_ref(), None).await?;
        tx.commit().await.map_err(unavailable)?;
        Ok(result)
    }
    async fn accept_authority(
        &self,
        actor: &str,
        s: &Scope,
        task_id: &str,
        a: &AuthoritySnapshot,
    ) -> Result<PolicyReference, Error> {
        if !a.is_valid()
            || a.scope != *s
            || a.actor_id != actor
            || a.task_id != task_id
            || a.task.actor_id != actor
        {
            return Err(Error::Invalid);
        }
        let mut tx = lock(&self.pool, actor, s).await?;
        let row = task::task(&mut tx, task_id).await.map_err(from_task)?;
        if field::<String>(&row, "accountable_actor")? != actor {
            return Err(Error::Denied);
        }
        for doc in a.documents().filter(|d| d.kind != PolicyKind::Task) {
            let actual = load_policy(&mut tx, s, doc.kind, &doc.subject_id).await?;
            if actual != *doc || doc.revoked {
                return Err(Error::Conflict);
            }
        }
        if a.task.revoked
            || a.documents()
                .any(|d| d.created_at > 0 && d.created_at > a.task.created_at)
            || a.task.created_at > clock(&mut tx).await?
        {
            return Err(Error::Invalid);
        }
        let result = write_policy(&mut tx, s, &a.task, Some(a), None).await?;
        // Explicit acceptance changes future work, never an already recorded
        // operation's immutable authority snapshot or canonical request.
        task::event(
            &mut tx,
            s,
            task_id,
            &field::<String>(&row, "cycle_id")?,
            None,
            "waiting",
        )
        .await
        .map_err(from_task)?;
        tx.commit().await.map_err(unavailable)?;
        Ok(result)
    }
    async fn admit(
        &self,
        actor: &str,
        s: &Scope,
        b: &ClaimBasis,
        operation_key: &str,
        request: &CanonicalOperation,
    ) -> Result<Operation, Error> {
        if !valid_scope_id(operation_key)
            || actor != b.actor_id
            || *s != b.scope
            || !request.is_valid()
            || hash(request.material.as_bytes()) != request.material_digest
        {
            return Err(Error::Invalid);
        }
        let mut tx = lock(&self.pool, actor, s).await?;
        if let Some(row) =
            sqlx::query("SELECT * FROM public.operations WHERE actor_id=$1 AND key=$2")
                .bind(actor)
                .bind(operation_key)
                .fetch_optional(&mut *tx)
                .await
                .map_err(unavailable)?
        {
            let result = project(&mut tx, &row).await?;
            let original: StoredBasis = decode(&field::<String>(&row, "basis")?)?;
            if result.request != *request
                || original.0.task_id != b.task_id
                || original.0.cycle_id != b.cycle_id
                || original.0.intent_revision != b.intent_revision
                || original.0.execution_epoch != b.execution_epoch
            {
                return Err(Error::Conflict);
            }
            tx.commit().await.map_err(unavailable)?;
            return Ok(result);
        }
        verify_basis(&mut tx, b).await?;
        let a = accepted(&mut tx, s, &b.task_id).await?;
        if a.actor_id != actor {
            return Err(Error::Denied);
        }
        let c = current(&mut tx, &a).await?;
        let source = a
            .account
            .account
            .as_ref()
            .ok_or(Error::Denied)?
            .source
            .clone();
        verify_material(&mut tx, s, &source, request).await?;
        if evaluate(request, &c, &a, clock(&mut tx).await?) == PermissionVerdict::Denied {
            return Err(Error::Denied);
        }
        let count: i64 =
            sqlx::query_scalar("SELECT count(*) FROM public.operations WHERE task_id=$1")
                .bind(&b.task_id)
                .fetch_one(&mut *tx)
                .await
                .map_err(unavailable)?;
        if count >= 1000 {
            return Err(Error::Capacity);
        }
        let id = token();
        sqlx::query("INSERT INTO public.operations(organisation_id,client_id,engagement_id,id,task_id,cycle_id,actor_id,key,request,request_digest,authority_snapshot,basis,source_binding) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)")
            .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id).bind(&id).bind(&b.task_id).bind(&b.cycle_id).bind(actor).bind(operation_key).bind(encode(&StoredCanonical(request.clone()))?).bind(hash(&request.canonical_bytes().ok_or(Error::Invalid)?)).bind(encode(&StoredAuthority(a))?).bind(encode(&StoredBasis(b.clone()))?).bind(encode(&StoredSource(source))?).execute(&mut *tx).await.map_err(unavailable)?;
        task::wake(&mut tx, s, &b.task_id, actor)
            .await
            .map_err(from_task)?;
        let row = operation_row(&mut tx, &id).await?;
        let result = project(&mut tx, &row).await?;
        tx.commit().await.map_err(unavailable)?;
        Ok(result)
    }
    async fn decide(
        &self,
        actor: &str,
        s: &Scope,
        d: &DecisionCommand,
    ) -> Result<OperationDecision, Error> {
        if !d.is_valid() {
            return Err(Error::Invalid);
        }
        let mut tx = lock(&self.pool, actor, s).await?;
        let selected_operation = operation_row(&mut tx, &d.operation_id).await?;
        if field::<String>(&selected_operation, "actor_id")? != actor {
            let manager: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM public.organisation_memberships WHERE organisation_id=$1 AND actor_id=$2 AND 'audit_manager'=ANY(roles))")
                .bind(&s.organisation_id).bind(actor).fetch_one(&mut *tx).await.map_err(unavailable)?;
            if !manager {
                return Err(Error::Denied);
            }
        }
        if let Some(row) =
            sqlx::query("SELECT * FROM public.operation_decisions WHERE actor_id=$1 AND key=$2")
                .bind(actor)
                .bind(&d.key)
                .fetch_optional(&mut *tx)
                .await
                .map_err(unavailable)?
        {
            let existing: StoredDecision = decode(&field::<String>(&row, "decision")?)?;
            if existing.0 != *d {
                return Err(Error::Conflict);
            }
            let result = decision_projection(&row)?;
            tx.commit().await.map_err(unavailable)?;
            return Ok(result);
        }
        let row = operation_row(&mut tx, &d.operation_id).await?;
        let op = project(&mut tx, &row).await?;
        if !d.matches(&op, clock(&mut tx).await?) {
            return Err(Error::Conflict);
        }
        let b: StoredBasis = decode(&field::<String>(&row, "basis")?)?;
        let task = task::task(&mut tx, &op.task_id).await.map_err(from_task)?;
        if field::<String>(&task, "cycle_id")? != op.cycle_id
            || field::<i64>(&task, "intent_revision")? != b.0.intent_revision
            || field::<i64>(&task, "execution_epoch")? != b.0.execution_epoch
            || matches!(
                field::<String>(&task, "state")?.as_str(),
                "paused" | "stopped"
            )
        {
            return Err(Error::Fenced);
        }
        let count: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM public.operation_decisions WHERE operation_id=$1",
        )
        .bind(&op.id)
        .fetch_one(&mut *tx)
        .await
        .map_err(unavailable)?;
        if count >= 64 {
            return Err(Error::Capacity);
        }
        let id = token();
        sqlx::query("INSERT INTO public.operation_decisions(organisation_id,client_id,engagement_id,id,operation_id,actor_id,key,request_digest,decision,expires_at,allow) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)")
            .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id).bind(&id).bind(&op.id).bind(actor).bind(&d.key).bind(&op.request_digest).bind(encode(&StoredDecision(d.clone()))?).bind(d.expires_at).bind(d.allow).execute(&mut *tx).await.map_err(unavailable)?;
        task::wake(&mut tx, s, &op.task_id, &op.actor_id)
            .await
            .map_err(from_task)?;
        let result = OperationDecision {
            id,
            operation_id: op.id,
            actor_id: actor.into(),
            request_digest: op.request_digest,
            expected_revision: 1,
            expires_at: d.expires_at,
            allowed: d.allow,
        };
        tx.commit().await.map_err(unavailable)?;
        Ok(result)
    }
    async fn revoke(
        &self,
        actor: &str,
        s: &Scope,
        c: &RevocationCommand,
    ) -> Result<PolicyReference, Error> {
        if !c.is_valid() {
            return Err(Error::Invalid);
        }
        let mut tx = lock(&self.pool, actor, s).await?;
        if let Some(row)=sqlx::query("SELECT document FROM public.permission_versions WHERE organisation_id=$1 AND actor_id=$2 AND command_key=$3").bind(&s.organisation_id).bind(actor).bind(&c.key).fetch_optional(&mut *tx).await.map_err(unavailable)? {
            let previous:StoredPolicy=decode(&field::<String>(&row,"document")?)?;
            if previous.0.kind!=c.kind || previous.0.subject_id!=c.subject_id || previous.0.version!=c.expected_version+1 || !previous.0.revoked{return Err(Error::Conflict)}
            authorize_policy(&mut tx,actor,s,&previous.0).await?;
            return Ok(previous.0.reference())
        }
        let mut doc = load_policy(&mut tx, s, c.kind, &c.subject_id).await?;
        authorize_policy(&mut tx, actor, s, &doc).await?;
        if doc.version != c.expected_version {
            return Err(Error::Conflict);
        }
        doc.version += 1;
        doc.actor_id = actor.into();
        doc.created_at = clock(&mut tx).await?;
        doc.revoked = true;
        let result = write_policy(&mut tx, s, &doc, None, Some(&c.key)).await?;
        tx.commit().await.map_err(unavailable)?;
        Ok(result)
    }
    async fn get(&self, actor: &str, s: &Scope, id: &str) -> Result<Operation, Error> {
        if !valid_scope_id(id) {
            return Err(Error::Invalid);
        }
        let mut tx = scope::begin(&self.pool, actor, s)
            .await
            .map_err(|e| match e {
                scope::ScopeError::Denied => Error::Denied,
                _ => Error::Unavailable,
            })?;
        let row = operation_row(&mut tx, id).await?;
        let result = project(&mut tx, &row).await?;
        read_fence(&mut tx, s).await?;
        tx.commit().await.map_err(unavailable)?;
        Ok(result)
    }
    async fn list(
        &self,
        actor: &str,
        s: &Scope,
        task_id: &str,
        after: Option<&str>,
    ) -> Result<OperationPage, Error> {
        if !valid_scope_id(task_id) || after.is_some_and(|v| !valid_scope_id(v)) {
            return Err(Error::Invalid);
        }
        let mut tx = scope::begin(&self.pool, actor, s)
            .await
            .map_err(|e| match e {
                scope::ScopeError::Denied => Error::Denied,
                _ => Error::Unavailable,
            })?;
        let rows=sqlx::query("SELECT * FROM public.operations WHERE task_id=$1 AND ($2::text IS NULL OR id>$2) ORDER BY id LIMIT $3").bind(task_id).bind(after).bind(OPERATION_PAGE_SIZE as i64+1).fetch_all(&mut *tx).await.map_err(unavailable)?;
        let next_cursor = (rows.len() > OPERATION_PAGE_SIZE)
            .then(|| field::<String>(&rows[OPERATION_PAGE_SIZE - 1], "id"))
            .transpose()?;
        let mut operations = Vec::new();
        for row in rows.iter().take(OPERATION_PAGE_SIZE) {
            operations.push(project(&mut tx, row).await?)
        }
        read_fence(&mut tx, s).await?;
        tx.commit().await.map_err(unavailable)?;
        Ok(OperationPage {
            operations,
            next_cursor,
        })
    }
    async fn consume(
        &self,
        b: &ClaimBasis,
        operation_id: &str,
    ) -> Result<ConsumedOperation, Error> {
        let mut tx = lock(&self.pool, &b.actor_id, &b.scope).await?;
        verify_basis(&mut tx, b).await?;
        let row = operation_row(&mut tx, operation_id).await?;
        let stored: StoredBasis = decode(&field::<String>(&row, "basis")?)?;
        // Ownership may advance only for source-confirmed absence. Intent,
        // execution, Task/cycle and actor can never be silently rebound.
        if stored.0.actor_id != b.actor_id
            || stored.0.scope != b.scope
            || stored.0.task_id != b.task_id
            || stored.0.cycle_id != b.cycle_id
            || stored.0.intent_revision != b.intent_revision
            || stored.0.execution_epoch != b.execution_epoch
        {
            return Err(Error::Fenced);
        }
        let accepted: StoredAuthority = decode(&field::<String>(&row, "authority_snapshot")?)?;
        let request: StoredCanonical = decode(&field::<String>(&row, "request")?)?;
        let source: StoredSource = decode(&field::<String>(&row, "source_binding")?)?;
        dispatch_authority(&mut tx, operation_id, &request.0, &accepted.0, &source.0).await?;
        let latest=sqlx::query("SELECT * FROM public.operation_attempts WHERE operation_id=$1 ORDER BY attempt_number DESC LIMIT 1").bind(operation_id).fetch_optional(&mut *tx).await.map_err(unavailable)?;
        let number = if let Some(latest) = latest {
            let id: String = field(&latest, "id")?;
            if latest_fact(&mut tx, &id).await? != SourceFact::AuthoritativelyAbsent {
                return Err(Error::Fenced);
            }
            let old: StoredBasis = decode(&field::<String>(&latest, "basis")?)?;
            if old.0.process_instance == b.process_instance {
                return Err(Error::Fenced);
            }
            field::<i64>(&latest, "attempt_number")? + 1
        } else {
            1
        };
        if number > 64 {
            return Err(Error::Capacity);
        }
        let attempt = token();
        let claim = token();
        let secret = token();
        sqlx::query("INSERT INTO public.operation_attempts(organisation_id,client_id,engagement_id,id,operation_id,attempt_number,basis,source_binding) VALUES($1,$2,$3,$4,$5,$6,$7,$8)")
            .bind(&b.scope.organisation_id).bind(&b.scope.client_id).bind(&b.scope.engagement_id).bind(&attempt).bind(operation_id).bind(number).bind(encode(&StoredBasis(b.clone()))?).bind(encode(&source)?).execute(&mut *tx).await.map_err(unavailable)?;
        sqlx::query("INSERT INTO public.operation_claims(organisation_id,client_id,engagement_id,id,operation_id,attempt_id,state,consumed_at) VALUES($1,$2,$3,$4,$5,$6,'admitted',NULL)")
            .bind(&b.scope.organisation_id).bind(&b.scope.client_id).bind(&b.scope.engagement_id).bind(&claim).bind(operation_id).bind(&attempt).execute(&mut *tx).await.map_err(unavailable)?;
        sqlx::query("UPDATE public.operation_claims SET state='consumed',consumed_at=clock_timestamp() WHERE id=$1 AND state='admitted'").bind(&claim).execute(&mut *tx).await.map_err(unavailable)?;
        slot(
            &mut tx,
            &b.scope,
            &attempt,
            &b.process_instance,
            &secret,
            "dispatch",
        )
        .await?;
        task::wake(&mut tx, &b.scope, &b.task_id, &b.actor_id)
            .await
            .map_err(from_task)?;
        // Execute deferred write/commit barriers before the final fresh clock
        // check. Expiry rolls back every staged attempt/cutoff/capability write.
        sqlx::query("SET CONSTRAINTS ALL IMMEDIATE")
            .execute(&mut *tx)
            .await
            .map_err(unavailable)?;
        verify_basis(&mut tx, b).await?;
        dispatch_authority(&mut tx, operation_id, &request.0, &accepted.0, &source.0).await?;
        tx.commit().await.map_err(unavailable)?;
        Ok(ConsumedOperation {
            source: source.0,
            basis: b.clone(),
            operation_id: operation_id.into(),
            attempt_id: attempt,
            claim_id: claim,
            request: request.0,
            request_digest: field(&row, "request_digest")?,
            receipt_capability: secret,
            custody: OperationCustody::Dispatch,
        })
    }
    async fn observe(&self, a: &ConsumedOperation, fact: SourceFact) -> Result<(), Error> {
        if !a.basis.scope.is_valid()
            || !valid_digest(&a.receipt_capability)
            || !valid_scope_id(&a.attempt_id)
        {
            return Err(Error::Denied);
        }
        let s = &a.basis.scope;
        let mut tx = scope::begin_actor(&self.pool, "receipt-context")
            .await
            .map_err(|_| Error::Unavailable)?;
        sqlx::query("SELECT set_config('zobba.actor_id','',true),set_config('zobba.receipt_claim',$1,true),set_config('zobba.receipt_hash',$2,true),set_config('zobba.receipt_org',$3,true),set_config('zobba.receipt_client',$4,true),set_config('zobba.receipt_engagement',$5,true)")
            .bind(&a.attempt_id).bind(hash(a.receipt_capability.as_bytes())).bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id).execute(&mut *tx).await.map_err(unavailable)?;
        let custody:Option<String>=sqlx::query_scalar("SELECT custody FROM public.operation_receipt_slots WHERE attempt_id=$1 AND producer_id=$2").bind(&a.attempt_id).bind(&a.basis.process_instance).fetch_optional(&mut *tx).await.map_err(unavailable)?;
        let expected = if a.custody == OperationCustody::Dispatch {
            "dispatch"
        } else {
            "reconciliation"
        };
        if custody.as_deref() != Some(expected) {
            return Err(Error::Denied);
        }
        // Serialize facts for this attempt, including exact late and current
        // recovery capabilities. A terminal contradiction never rewrites history.
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,206))")
            .bind(&a.attempt_id)
            .execute(&mut *tx)
            .await
            .map_err(unavailable)?;
        let observed = latest_fact(&mut tx, &a.attempt_id).await?;
        if a.custody == OperationCustody::Dispatch
            && fact == SourceFact::AuthoritativelyAbsent
            && observed != SourceFact::AuthoritativelyAbsent
        {
            return Err(Error::Invalid);
        }
        if !fact.can_follow(observed) {
            return Err(Error::Conflict);
        }
        if observed == fact && fact != SourceFact::Unknown {
            tx.commit().await.map_err(unavailable)?;
            return Ok(());
        }
        let outcome = match fact {
            SourceFact::Unknown => "unknown",
            SourceFact::Accepted => "pending",
            SourceFact::Completed => "completed",
            SourceFact::AuthoritativelyAbsent => "absent",
        };
        sqlx::query("INSERT INTO public.operation_receipts(organisation_id,client_id,engagement_id,id,attempt_id,producer_id,key,outcome,source) VALUES($1,$2,$3,$4,$5,$6,$7,$7,$8) ON CONFLICT(attempt_id,key) DO NOTHING")
            .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id).bind(token()).bind(&a.attempt_id).bind(&a.basis.process_instance).bind(outcome).bind(if a.custody == OperationCustody::Dispatch{"dispatch"}else{"reconciliation"}).execute(&mut *tx).await.map_err(unavailable)?;
        tx.commit().await.map_err(unavailable)
    }
    async fn unresolved(
        &self,
        actor: &str,
        s: &Scope,
        task_id: &str,
        after: Option<&str>,
    ) -> Result<OperationAttemptPage, Error> {
        if !valid_scope_id(task_id) || after.is_some_and(|v| !valid_scope_id(v)) {
            return Err(Error::Invalid);
        }
        let mut tx = scope::begin(&self.pool, actor, s)
            .await
            .map_err(|e| match e {
                scope::ScopeError::Denied => Error::Denied,
                _ => Error::Unavailable,
            })?;
        let rows=sqlx::query("SELECT a.id,a.operation_id,o.request_digest FROM public.operation_attempts a JOIN public.operations o ON o.id=a.operation_id JOIN public.operation_claims c ON c.attempt_id=a.id WHERE o.task_id=$1 AND ($2::text IS NULL OR a.id>$2) AND c.state='consumed' AND NOT EXISTS(SELECT 1 FROM public.operation_receipts r WHERE r.attempt_id=a.id AND r.outcome IN ('completed','absent')) ORDER BY a.id LIMIT 51").bind(task_id).bind(after).fetch_all(&mut *tx).await.map_err(unavailable)?;
        let next_cursor = if rows.len() > 50 {
            Some(field::<String>(&rows[49], "id")?)
        } else {
            None
        };
        let mut results = Vec::new();
        for row in rows.into_iter().take(50) {
            let id: String = field(&row, "id")?;
            results.push(OperationAttempt {
                observed: latest_fact(&mut tx, &id).await?,
                id,
                operation_id: field(&row, "operation_id")?,
                request_digest: field(&row, "request_digest")?,
            });
        }
        read_fence(&mut tx, s).await?;
        tx.commit().await.map_err(unavailable)?;
        Ok(OperationAttemptPage {
            attempts: results,
            next_cursor,
        })
    }
    async fn recover(
        &self,
        actor: &str,
        s: &Scope,
        attempt_id: &str,
    ) -> Result<ConsumedOperation, Error> {
        let mut tx = lock(&self.pool, actor, s).await?;
        let attempt=sqlx::query("SELECT a.*,c.id AS claim_id FROM public.operation_attempts a JOIN public.operation_claims c ON c.attempt_id=a.id WHERE a.id=$1 AND c.state='consumed'").bind(attempt_id).fetch_optional(&mut *tx).await.map_err(unavailable)?.ok_or(Error::Denied)?;
        let operation_id: String = field(&attempt, "operation_id")?;
        let row = operation_row(&mut tx, &operation_id).await?;
        recovery_authority(&mut tx, actor, &attempt, &row).await?;
        let count: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM public.operation_receipt_producers WHERE attempt_id=$1",
        )
        .bind(attempt_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(unavailable)?;
        if count >= 32 {
            return Err(Error::Capacity);
        }
        let mut b: StoredBasis = decode(&field::<String>(&attempt, "basis")?)?;
        b.0.process_instance = token();
        let secret = token();
        slot(
            &mut tx,
            s,
            attempt_id,
            &b.0.process_instance,
            &secret,
            "reconciliation",
        )
        .await?;
        let request: StoredCanonical = decode(&field::<String>(&row, "request")?)?;
        tx.commit().await.map_err(unavailable)?;
        Ok(ConsumedOperation {
            source: decode::<StoredSource>(&field::<String>(&row, "source_binding")?)?.0,
            basis: b.0,
            operation_id,
            attempt_id: attempt_id.into(),
            claim_id: field(&attempt, "claim_id")?,
            request: request.0,
            request_digest: field(&row, "request_digest")?,
            receipt_capability: secret,
            custody: OperationCustody::ReceiptOnly,
        })
    }
}
async fn slot(
    tx: &mut Tx,
    s: &Scope,
    attempt: &str,
    producer: &str,
    secret: &str,
    custody: &str,
) -> Result<(), Error> {
    sqlx::query("INSERT INTO public.operation_receipt_producers(organisation_id,client_id,engagement_id,attempt_id,producer_id) VALUES($1,$2,$3,$4,$5)")
        .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id).bind(attempt).bind(producer).execute(&mut **tx).await.map_err(unavailable)?;
    sqlx::query("INSERT INTO public.operation_receipt_slots(organisation_id,client_id,engagement_id,attempt_id,producer_id,capability_hash,custody) VALUES($1,$2,$3,$4,$5,$6,$7)")
        .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id).bind(attempt).bind(producer).bind(hash(secret.as_bytes())).bind(custody).execute(&mut **tx).await.map_err(unavailable)?;
    Ok(())
}
