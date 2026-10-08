//! Native model dispatch custody and exact current catalogue admission.
//! Every transaction is short; no SQL connection spans provider I/O.
pub mod native;
use crate::{knowledge, operation, scope, task};
use rand::{RngCore, rngs::OsRng};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Postgres, Row, Transaction};
use std::sync::Arc;
use zobba_application::{
    model::{wire::*, *},
    operation::{ModelToolBinding, OperationError, OperationStore},
};
use zobba_domain::{
    identity::{Scope, valid_scope_id},
    permissions::{CanonicalOperation, Operation},
    task::ClaimBasis,
};
type Tx = Transaction<'static, Postgres>;

pub use zobba_application::model::ModelQualificationSource;
struct Unqualified;
impl ModelQualificationSource for Unqualified {
    fn qualified(&self, _: &ModelProfile) -> bool {
        false
    }
}
#[derive(Clone)]
pub struct ModelRepository {
    pool: PgPool,
    qualifications: Arc<dyn ModelQualificationSource>,
    session_hash: String,
}
fn db(_: sqlx::Error) -> ModelError {
    ModelError::Unavailable
}
fn op(error: OperationError) -> ModelError {
    match error {
        OperationError::Invalid => ModelError::Invalid,
        OperationError::Denied | OperationError::NeedsDecision => ModelError::Denied,
        OperationError::Conflict => ModelError::Conflict,
        OperationError::Capacity => ModelError::Capacity,
        OperationError::Fenced => ModelError::Fenced,
        OperationError::Unavailable => ModelError::Unavailable,
    }
}
fn knowledge_error(error: zobba_application::knowledge::KnowledgeError) -> ModelError {
    use zobba_application::knowledge::KnowledgeError;
    match error {
        KnowledgeError::Unavailable => ModelError::Unavailable,
        KnowledgeError::Capacity => ModelError::Capacity,
        KnowledgeError::Invalid | KnowledgeError::Cycle => ModelError::Invalid,
        KnowledgeError::Conflict => ModelError::Conflict,
        KnowledgeError::Denied | KnowledgeError::Ineligible => ModelError::Denied,
    }
}
fn task_error(error: zobba_application::task::TaskError) -> ModelError {
    match error {
        zobba_application::task::TaskError::Denied => ModelError::Denied,
        zobba_application::task::TaskError::Fenced => ModelError::Fenced,
        _ => ModelError::Unavailable,
    }
}
fn as_operation(error: ModelError) -> OperationError {
    match error {
        ModelError::Invalid | ModelError::Malformed | ModelError::Identity => {
            OperationError::Invalid
        }
        ModelError::Denied => OperationError::Denied,
        ModelError::Conflict => OperationError::Conflict,
        ModelError::Capacity => OperationError::Capacity,
        ModelError::Fenced | ModelError::Unqualified | ModelError::Unsupported => {
            OperationError::Fenced
        }
        _ => OperationError::Unavailable,
    }
}
fn encode(value: &impl Serialize, max: usize) -> Result<Value, ModelError> {
    let bytes = serde_json::to_vec(value).map_err(|_| ModelError::Invalid)?;
    // JSONB inserts spaces/normalizes escapes; leave an independent envelope margin.
    if bytes.len() > max / 2 {
        return Err(ModelError::Capacity);
    }
    serde_json::from_slice(&bytes).map_err(|_| ModelError::Invalid)
}
fn decode<T: DeserializeOwned>(value: Value) -> Result<T, ModelError> {
    serde_json::from_value(value).map_err(|_| ModelError::Unavailable)
}
fn token() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
/// Bind the complete bounded portable payload to the existing Permissions input
/// classification vocabulary. The caller owns classification and the canonical
/// Send operation; this helper neither chooses a destination nor grants authority.
/// Key and volatile claim-owner identifiers do not enter the native payload.
pub fn bind_disclosure(request: &mut ModelRequest) -> Result<(), ModelError> {
    request.disclosure.attachments = payload_attachments(request)?;
    Ok(())
}
fn payload_attachments(
    request: &ModelRequest,
) -> Result<Vec<zobba_domain::permissions::Attachment>, ModelError> {
    request.validate()?;
    let mut payload =
        serde_json::to_value(StoredRequest(request.clone())).map_err(|_| ModelError::Invalid)?;
    let object = payload.as_object_mut().ok_or(ModelError::Invalid)?;
    for field in ["disclosure", "key", "basis"] {
        object.remove(field);
    }
    let bytes = serde_json::to_vec(&payload).map_err(|_| ModelError::Invalid)?;
    if bytes.len() > 1024 * 1024 {
        return Err(ModelError::Capacity);
    }
    Ok(request
        .input_classes
        .iter()
        .enumerate()
        .map(|(index, class)| {
            let mut digest = Sha256::new();
            digest.update(b"zobba-model-disclosure-v1\0");
            digest.update((class.len() as u64).to_be_bytes());
            digest.update(class.as_bytes());
            digest.update((bytes.len() as u64).to_be_bytes());
            digest.update(&bytes);
            zobba_domain::permissions::Attachment {
                id: format!("model-input-{index:02}"),
                digest: format!("{:x}", digest.finalize()),
                classification: class.clone(),
            }
        })
        .collect())
}
fn verify_disclosure_binding(request: &ModelRequest) -> Result<(), ModelError> {
    if request.disclosure.attachments != payload_attachments(request)? {
        return Err(ModelError::Conflict);
    }
    Ok(())
}
async fn current_configuration(tx: &mut Tx, request: &ModelRequest) -> Result<(), ModelError> {
    let org = &request.basis.scope.organisation_id;
    let profile: Option<Value> = sqlx::query_scalar("SELECT document FROM public.model_profiles WHERE organisation_id=$1 AND id=$2 ORDER BY revision DESC LIMIT 1")
        .bind(org).bind(&request.profile.id).fetch_optional(&mut **tx).await.map_err(db)?;
    let catalogue: Option<Value> = sqlx::query_scalar("SELECT document FROM public.model_catalogues WHERE organisation_id=$1 AND id=$2 ORDER BY revision DESC LIMIT 1")
        .bind(org).bind(&request.catalogue.id).fetch_optional(&mut **tx).await.map_err(db)?;
    let profile: StoredProfile = decode(profile.ok_or(ModelError::Fenced)?)?;
    let catalogue: StoredCatalog = decode(catalogue.ok_or(ModelError::Fenced)?)?;
    if profile.0 != request.profile
        || catalogue.0 != request.catalogue
        || !profile.0.enabled
        || !catalogue.0.enabled
    {
        return Err(ModelError::Fenced);
    }
    Ok(())
}
fn without_replay(exchange: &ToolExchange) -> ToolExchange {
    ToolExchange {
        preceding: vec![],
        ..exchange.clone()
    }
}
const MAX_HISTORY_DEPENDENCIES: usize = 256;
const MAX_HISTORY_EDGES: usize = MAX_HISTORY_DEPENDENCIES * MAX_HISTORY_ITEMS;

fn history_is_acyclic(
    graph: &std::collections::BTreeMap<String, std::collections::BTreeSet<String>>,
) -> bool {
    let mut incoming: std::collections::BTreeMap<&str, usize> =
        graph.keys().map(|id| (id.as_str(), 0)).collect();
    for dependencies in graph.values() {
        for id in dependencies {
            let Some(count) = incoming.get_mut(id.as_str()) else {
                return false;
            };
            *count += 1;
        }
    }
    let mut ready: Vec<&str> = incoming
        .iter()
        .filter_map(|(id, count)| (*count == 0).then_some(*id))
        .collect();
    let mut visited = 0;
    while let Some(id) = ready.pop() {
        visited += 1;
        for dependency in &graph[id] {
            let count = incoming
                .get_mut(dependency.as_str())
                .expect("graph membership checked");
            *count -= 1;
            if *count == 0 {
                ready.push(dependency);
            }
        }
    }
    visited == graph.len()
}

/// Verify, under the current consuming basis, every earlier invocation whose
/// content this request actually carries: the origin of each included tool
/// exchange and of each entry that names a dependency (an earlier answer),
/// transitively through the content those invocations themselves carried.
/// Content that is not sent needs no current authority; a withdrawn source can
/// therefore stop being disclosed without refusing every later turn.
async fn history_authority(
    tx: &mut Tx,
    actor: &str,
    request: &ModelRequest,
) -> Result<(), ModelError> {
    use std::collections::{BTreeMap, BTreeSet};
    let mut pending = vec![request.clone()];
    let mut graph = BTreeMap::<String, BTreeSet<String>>::new();
    let mut exchanges = BTreeMap::<(String, String), ToolExchange>::new();
    let mut contexts = Vec::new();
    let mut edges = 0usize;
    // Distinct answer origins, bounded like exchanges.
    let mut answers = BTreeSet::<String>::new();
    while let Some(part) = pending.pop() {
        let mut origins: Vec<(String, Option<&ToolExchange>, Option<&ModelMessage>)> = part
            .history
            .iter()
            .filter_map(|item| match item {
                HistoryItem::ToolExchange(exchange) => Some((
                    exchange.invocation_id.clone(),
                    Some(exchange.as_ref()),
                    None,
                )),
                HistoryItem::Message(_) => None,
            })
            .collect();
        for entry in &part.context.entries {
            let Some(origin) = &entry.depends_on else {
                continue;
            };
            // The dependent content must be a message carrying exactly this
            // source; validation guarantees one exists.
            let message = part
                .messages
                .iter()
                .chain(part.history.iter().filter_map(|item| match item {
                    HistoryItem::Message(m) => Some(m),
                    HistoryItem::ToolExchange(_) => None,
                }))
                .find(|m| m.source_id.as_ref() == Some(&entry.source_id))
                .ok_or(ModelError::Invalid)?;
            origins.push((origin.clone(), None, Some(message)));
        }
        for (origin, exchange, answer) in origins {
            if let Some(exchange) = exchange {
                let identity = (exchange.invocation_id.clone(), exchange.call_id.clone());
                if let Some(previous) = exchanges.get(&identity) {
                    // Replay blocks move to the first exchange an invocation
                    // still has in context, so they are compared separately:
                    // each carried copy must be the producer's exact blocks,
                    // sent to the provider and model that produced them.
                    if without_replay(previous) != without_replay(exchange) {
                        return Err(ModelError::Conflict);
                    }
                    if !exchange.preceding.is_empty() {
                        let original = load(tx, &origin).await?;
                        verify_replay(&original, exchange, &part.profile)?;
                    }
                    continue;
                }
                if exchanges.len() >= MAX_HISTORY_DEPENDENCIES {
                    return Err(ModelError::Capacity);
                }
            }
            let original = load(tx, &origin).await?;
            original.request.validate()?;
            if original.request.basis.scope != request.basis.scope
                || original.request.basis.task_id != request.basis.task_id
                || original.request.basis.actor_id != request.basis.actor_id
            {
                return Err(ModelError::Denied);
            }
            if let Some(exchange) = exchange {
                verify_replay(&original, exchange, &part.profile)?;
                let (tool, canonical) = validated_tool(&original, &exchange.call_id)?;
                if tool != exchange.tool || tool.resolve(&exchange.arguments)? != canonical {
                    return Err(ModelError::Conflict);
                }
                let bound:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM public.model_tool_bindings WHERE operation_id=$1 AND invocation_id=$2 AND call_id=$3)")
                    .bind(&exchange.result.operation_id).bind(&exchange.invocation_id).bind(&exchange.call_id).fetch_one(&mut **tx).await.map_err(db)?;
                if !bound {
                    return Err(ModelError::Conflict);
                }
                operation::model_history_access(
                    tx,
                    &request.basis.actor_id,
                    &exchange.result.operation_id,
                    &exchange.result.attempt_id,
                    exchange.result.fact,
                )
                .await
                .map_err(op)?;
                exchanges.insert(
                    (exchange.invocation_id.clone(), exchange.call_id.clone()),
                    exchange.clone(),
                );
            } else {
                // A dependent answer must be exactly the labelled answer of an
                // invocation that answered, attributed to the model.
                let Some(message) = answer else {
                    return Err(ModelError::Invalid);
                };
                if original.outcome.is_none()
                    || message.role != MessageRole::Assistant
                    || message.source_id.as_deref().is_none_or(|source| {
                        message.text
                            != zobba_application::work::earlier_answer_envelope(source, &original)
                    })
                {
                    return Err(ModelError::Conflict);
                }
                if answers.insert(origin.clone()) && answers.len() > MAX_HISTORY_DEPENDENCIES {
                    return Err(ModelError::Capacity);
                }
            }
            if !graph.contains_key(&original.id) {
                if graph.len() >= MAX_HISTORY_DEPENDENCIES {
                    return Err(ModelError::Capacity);
                }
                let mut dependencies: BTreeSet<String> = original
                    .request
                    .history
                    .iter()
                    .filter_map(|item| {
                        if let HistoryItem::ToolExchange(exchange) = item {
                            Some(exchange.invocation_id.clone())
                        } else {
                            None
                        }
                    })
                    .collect();
                dependencies.extend(
                    original
                        .request
                        .context
                        .entries
                        .iter()
                        .filter_map(|entry| entry.depends_on.clone()),
                );
                edges += dependencies.len();
                if edges > MAX_HISTORY_EDGES {
                    return Err(ModelError::Capacity);
                }
                graph.insert(original.id.clone(), dependencies);
                // Repeated cumulative history shares exact source verification
                // in this transaction, under the current consuming Task basis.
                let mut verification = original.request.context.verification.clone();
                verification.expected_execution_epoch =
                    request.context.verification.expected_execution_epoch;
                verification.expected_methodology_binding_id = request
                    .context
                    .verification
                    .expected_methodology_binding_id
                    .clone();
                if !contexts.contains(&verification) {
                    knowledge::verify_in_transaction(
                        tx,
                        actor,
                        &request.basis.scope,
                        &request.basis.task_id,
                        &verification,
                    )
                    .await
                    .map_err(knowledge_error)?;
                    contexts.push(verification);
                }
                pending.push(original.request);
            }
        }
    }
    if !history_is_acyclic(&graph) {
        return Err(ModelError::Denied);
    }
    Ok(())
}
/// Exact knowledge references one invocation of a Task cycle recorded as its
/// verified context. Used to rebuild compaction digests from durable facts.
pub(crate) async fn verification_items(
    tx: &mut Tx,
    task_id: &str,
    cycle_id: &str,
    id: &str,
) -> Result<Vec<(String, u64)>, ModelError> {
    let invocation = load(tx, id).await?;
    let basis = &invocation.request.basis;
    if basis.task_id != task_id || basis.cycle_id != cycle_id {
        return Err(ModelError::Denied);
    }
    Ok(invocation
        .request
        .context
        .verification
        .items
        .iter()
        .map(|v| (v.id.clone(), v.revision))
        .collect())
}
async fn audience(tx: &mut Tx, actor: &str, request: &ModelRequest) -> Result<(), ModelError> {
    let b = &request.basis;
    history_authority(tx, actor, request).await?;
    knowledge::verify_in_transaction(
        tx,
        actor,
        &b.scope,
        &b.task_id,
        &request.context.verification,
    )
    .await
    .map_err(knowledge_error)?;
    // The exact current scope of both the viewer and accountable actor is checked
    // by the knowledge owner, including server-time expiries at the final fence.
    let row = task::task(tx, &b.task_id).await.map_err(task_error)?;
    if row.try_get::<String, _>("accountable_actor").map_err(db)? != b.actor_id
        || row.try_get::<String, _>("cycle_id").map_err(db)? != b.cycle_id
        || row.try_get::<i64, _>("intent_revision").map_err(db)? != b.intent_revision
        || row.try_get::<i64, _>("execution_epoch").map_err(db)? != b.execution_epoch
    {
        return Err(ModelError::Fenced);
    }
    Ok(())
}
/// Exact immutable invocation facts for the work loop's own Task and cycle,
/// read under the caller's claim-bound Task fence. This grants no audience:
/// any disclosure of these facts is checked again by `prepare`.
pub(crate) async fn load_for_cycle(
    tx: &mut Tx,
    basis: &ClaimBasis,
    id: &str,
) -> Result<Invocation, ModelError> {
    if !valid_scope_id(id) {
        return Err(ModelError::Invalid);
    }
    let invocation = load(tx, id).await?;
    let original = &invocation.request.basis;
    if original.actor_id != basis.actor_id
        || original.scope != basis.scope
        || original.task_id != basis.task_id
        || original.cycle_id != basis.cycle_id
    {
        return Err(ModelError::Denied);
    }
    Ok(invocation)
}
async fn load(tx: &mut Tx, id: &str) -> Result<Invocation, ModelError> {
    let row = sqlx::query("SELECT key,request FROM public.model_invocations WHERE id=$1")
        .bind(id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(db)?
        .ok_or(ModelError::Denied)?;
    let request: StoredRequest = decode(row.try_get("request").map_err(db)?)?;
    let outcome: Option<Value> =
        sqlx::query_scalar("SELECT document FROM public.model_results WHERE invocation_id=$1")
            .bind(id)
            .fetch_optional(&mut **tx)
            .await
            .map_err(db)?;
    Ok(Invocation {
        id: id.into(),
        key: row.try_get("key").map_err(db)?,
        request: request.0,
        outcome: outcome
            .map(decode::<StoredOutcome>)
            .transpose()?
            .map(|v| v.0),
    })
}
async fn flush(tx: &mut Tx) -> Result<(), ModelError> {
    sqlx::query("SET CONSTRAINTS ALL IMMEDIATE")
        .execute(&mut **tx)
        .await
        .map_err(db)?;
    Ok(())
}
impl ModelRepository {
    pub fn new(pool: PgPool) -> Self {
        Self {
            pool,
            qualifications: Arc::new(Unqualified),
            session_hash: String::new(),
        }
    }
    pub fn with_qualification_source(mut self, source: Arc<dyn ModelQualificationSource>) -> Self {
        self.qualifications = source;
        self
    }
    pub fn with_session_hash(mut self, hash: String) -> Self {
        self.session_hash = hash;
        self
    }
    /// Current profile and catalogue selectable for this organisation: the
    /// latest revision of each, enabled and (profile) trusted-qualified. The
    /// profile with the lowest ID (byte order) is chosen, then the lowest-ID
    /// catalogue usable with that profile (tools require its tool capability),
    /// so the pair is consistent and deterministic. None means the model is
    /// unavailable; an unreadable stored document is an error, never skipped.
    pub async fn selection(
        &self,
        actor: &str,
        selected: &Scope,
    ) -> Result<Option<(ModelProfile, ToolCatalog)>, ModelError> {
        const LIMIT: i64 = 256;
        let mut tx = task::begin(&self.pool, actor, selected)
            .await
            .map_err(task_error)?;
        let org = &selected.organisation_id;
        let profiles: Vec<Value> = sqlx::query_scalar("SELECT document FROM (SELECT DISTINCT ON (id COLLATE \"C\") id,document FROM public.model_profiles WHERE organisation_id=$1 ORDER BY id COLLATE \"C\", revision DESC) p ORDER BY id COLLATE \"C\" LIMIT $2")
            .bind(org).bind(LIMIT + 1).fetch_all(&mut *tx).await.map_err(db)?;
        let catalogues: Vec<Value> = sqlx::query_scalar("SELECT document FROM (SELECT DISTINCT ON (id COLLATE \"C\") id,document FROM public.model_catalogues WHERE organisation_id=$1 ORDER BY id COLLATE \"C\", revision DESC) c ORDER BY id COLLATE \"C\" LIMIT $2")
            .bind(org).bind(LIMIT + 1).fetch_all(&mut *tx).await.map_err(db)?;
        tx.commit().await.map_err(db)?;
        if profiles.len() as i64 > LIMIT || catalogues.len() as i64 > LIMIT {
            return Err(ModelError::Capacity);
        }
        let profiles = profiles
            .into_iter()
            .map(|v| decode::<StoredProfile>(v).map(|p| p.0))
            .collect::<Result<Vec<_>, _>>()?;
        let catalogues = catalogues
            .into_iter()
            .map(|v| decode::<StoredCatalog>(v).map(|c| c.0))
            .collect::<Result<Vec<_>, _>>()?;
        let Some(profile) = profiles
            .into_iter()
            .find(|p| p.enabled && p.is_valid() && self.qualifications.qualified(p))
        else {
            return Ok(None);
        };
        let catalogue = catalogues.into_iter().find(|c| {
            c.enabled && c.is_valid() && (c.tools.is_empty() || profile.capabilities.tools)
        });
        Ok(catalogue.map(|catalogue| (profile, catalogue)))
    }
    async fn admin(&self, tx: &mut Tx, actor: &str, org: &str) -> Result<(), ModelError> {
        if !crate::identity::valid_secret(&self.session_hash) {
            return Err(ModelError::Denied);
        }
        let allowed: bool = sqlx::query_scalar("SELECT public.model_configuration_admin($1,$2,$3)")
            .bind(actor)
            .bind(org)
            .bind(&self.session_hash)
            .fetch_one(&mut **tx)
            .await
            .map_err(db)?;
        if allowed {
            Ok(())
        } else {
            Err(ModelError::Denied)
        }
    }
    async fn save(
        &self,
        actor: &str,
        org: &str,
        kind: &str,
        id: &str,
        revision: u64,
        document: Value,
    ) -> Result<(), ModelError> {
        if !valid_scope_id(actor)
            || !valid_scope_id(org)
            || !valid_scope_id(id)
            || !valid_revision(revision)
        {
            return Err(ModelError::Invalid);
        }
        let mut tx = scope::begin_actor(&self.pool, actor)
            .await
            .map_err(|_| ModelError::Unavailable)?;
        sqlx::query("SELECT set_config('zobba.organisation_id',$1,true),set_config('zobba.model_session_hash',$2,true),pg_advisory_xact_lock(hashtextextended($1,205))").bind(org).bind(&self.session_hash).execute(&mut *tx).await.map_err(db)?;
        self.admin(&mut tx, actor, org).await?;
        let table = match kind {
            "profile" => "model_profiles",
            "catalogue" => "model_catalogues",
            _ => return Err(ModelError::Invalid),
        };
        let previous: Option<Value> = sqlx::query_scalar(&format!(
            "SELECT document FROM public.{table} WHERE organisation_id=$1 AND id=$2 AND revision=$3"
        ))
        .bind(org)
        .bind(id)
        .bind(revision as i64)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db)?;
        if let Some(previous) = previous {
            return if previous == document {
                tx.commit().await.map_err(db)
            } else {
                Err(ModelError::Conflict)
            };
        }
        let next:i64=sqlx::query_scalar(&format!("SELECT coalesce(max(revision),0)+1 FROM public.{table} WHERE organisation_id=$1 AND id=$2")).bind(org).bind(id).fetch_one(&mut *tx).await.map_err(db)?;
        if next != revision as i64 {
            return Err(ModelError::Conflict);
        }
        let (count,bytes):(i64,i64)=sqlx::query_as(&format!("SELECT count(*),coalesce(sum(octet_length(document::text)),0)::bigint FROM public.{table} WHERE organisation_id=$1")).bind(org).fetch_one(&mut *tx).await.map_err(db)?;
        if count >= 256 || bytes >= 4 * 1024 * 1024 {
            let previous: Option<Value> = sqlx::query_scalar(&format!("SELECT document FROM public.{table} WHERE organisation_id=$1 AND id=$2 ORDER BY revision DESC LIMIT 1"))
                .bind(org).bind(id).fetch_optional(&mut *tx).await.map_err(db)?;
            // Each already-enabled profile/catalogue has one reserved narrowing
            // transition. At capacity it cannot be enabled again, so restrictions
            // remain bounded and cannot be prevented by ordinary history growth.
            if document.get("enabled") != Some(&Value::Bool(false))
                || previous.as_ref().and_then(|v| v.get("enabled")) != Some(&Value::Bool(true))
            {
                return Err(ModelError::Capacity);
            }
        }
        sqlx::query(&format!("INSERT INTO public.{table}(organisation_id,id,revision,actor_id,document) VALUES($1,$2,$3,$4,$5)")).bind(org).bind(id).bind(revision as i64).bind(actor).bind(document).execute(&mut *tx).await.map_err(db)?;
        flush(&mut tx).await?;
        self.admin(&mut tx, actor, org).await?;
        tx.commit().await.map_err(db)
    }
    pub async fn save_profile(
        &self,
        actor: &str,
        org: &str,
        profile: &ModelProfile,
    ) -> Result<(), ModelError> {
        if !profile.is_valid() {
            return Err(ModelError::Invalid);
        }
        self.save(
            actor,
            org,
            "profile",
            &profile.id,
            profile.revision,
            encode(&StoredProfile(profile.clone()), 65536)?,
        )
        .await
    }
    pub async fn save_catalogue(
        &self,
        actor: &str,
        org: &str,
        catalogue: &ToolCatalog,
    ) -> Result<(), ModelError> {
        if !catalogue.is_valid() {
            return Err(ModelError::Invalid);
        }
        self.save(
            actor,
            org,
            "catalogue",
            &catalogue.id,
            catalogue.revision,
            encode(&StoredCatalog(catalogue.clone()), 524288)?,
        )
        .await
    }
}
impl ModelStore for ModelRepository {
    async fn prepare(
        &self,
        actor: &str,
        selected: &Scope,
        request: &ModelRequest,
    ) -> Result<PreparedInvocation, ModelError> {
        request.validate()?;
        if actor != request.basis.actor_id || selected != &request.basis.scope {
            return Err(ModelError::Denied);
        }
        let document = encode(&StoredRequest(request.clone()), 1048576)?;
        let mut tx = task::lock(&self.pool, actor, selected)
            .await
            .map_err(task_error)?;
        let existing: Option<String>=sqlx::query_scalar("SELECT id FROM public.model_invocations WHERE organisation_id=$1 AND actor_id=$2 AND key=$3").bind(&selected.organisation_id).bind(actor).bind(&request.key).fetch_optional(&mut *tx).await.map_err(db)?;
        if let Some(id) = existing {
            let original = load(&mut tx, &id).await?;
            let before = &original.request.basis;
            let now = &request.basis;
            if before.actor_id != now.actor_id
                || before.scope != now.scope
                || before.task_id != now.task_id
                || before.cycle_id != now.cycle_id
                || before.intent_revision != now.intent_revision
                || before.execution_epoch != now.execution_epoch
            {
                return Err(ModelError::Conflict);
            }
            // A replacement owner can recover the same logical invocation. The
            // original worker/claim/attempt identity remains immutable history.
            let mut logical = request.clone();
            logical.basis = before.clone();
            if original.request != logical {
                return Err(ModelError::Conflict);
            }
            audience(&mut tx, actor, &original.request).await?;
            tx.commit().await.map_err(db)?;
            return Ok(PreparedInvocation::Recovered(Box::new(original)));
        }
        if !self.qualifications.qualified(&request.profile) {
            return Err(ModelError::Unqualified);
        }
        current_configuration(&mut tx, request).await?;
        verify_disclosure_binding(request)?;
        audience(&mut tx, actor, request).await?;
        operation::model_disclosure(&mut tx, &request.basis, &request.disclosure)
            .await
            .map_err(op)?;
        let count: i64 =
            sqlx::query_scalar("SELECT count(*) FROM public.model_invocations WHERE task_id=$1")
                .bind(&request.basis.task_id)
                .fetch_one(&mut *tx)
                .await
                .map_err(db)?;
        if count >= 1024 {
            return Err(ModelError::Capacity);
        }
        let id = token();
        let secret = crate::identity::random_secret().map_err(|_| ModelError::Unavailable)?;
        let b = &request.basis;
        sqlx::query("INSERT INTO public.model_invocations(organisation_id,client_id,engagement_id,id,task_id,cycle_id,actor_id,key,profile_id,profile_revision,catalogue_id,catalogue_revision,request,receipt_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)").bind(&selected.organisation_id).bind(&selected.client_id).bind(&selected.engagement_id).bind(&id).bind(&b.task_id).bind(&b.cycle_id).bind(actor).bind(&request.key).bind(&request.profile.id).bind(request.profile.revision as i64).bind(&request.catalogue.id).bind(request.catalogue.revision as i64).bind(document).bind(hash(secret.as_bytes())).execute(&mut *tx).await.map_err(db)?;
        flush(&mut tx).await?;
        current_configuration(&mut tx, request).await?;
        verify_disclosure_binding(request)?;
        audience(&mut tx, actor, request).await?;
        operation::model_disclosure(&mut tx, b, &request.disclosure)
            .await
            .map_err(op)?;
        if !self.qualifications.qualified(&request.profile) {
            return Err(ModelError::Unqualified);
        }
        tx.commit().await.map_err(db)?;
        Ok(PreparedInvocation::Dispatch(DispatchPermit {
            invocation_id: id,
            receipt_capability: secret,
        }))
    }
    async fn complete(
        &self,
        permit: &DispatchPermit,
        outcome: &TransportOutcome,
    ) -> Result<Invocation, ModelError> {
        if !valid_scope_id(&permit.invocation_id)
            || !crate::identity::valid_secret(&permit.receipt_capability)
        {
            return Err(ModelError::Denied);
        }
        let mut tx = scope::begin_actor(&self.pool, "model-receipt")
            .await
            .map_err(|_| ModelError::Unavailable)?;
        sqlx::query("SELECT set_config('zobba.actor_id','',true),set_config('zobba.model_invocation',$1,true),set_config('zobba.model_receipt_hash',$2,true),pg_advisory_xact_lock(hashtextextended($1,211))").bind(&permit.invocation_id).bind(hash(permit.receipt_capability.as_bytes())).execute(&mut *tx).await.map_err(db)?;
        let mut invocation = load(&mut tx, &permit.invocation_id).await?;
        validate_completion(&invocation.request, outcome)?;
        if let Some(existing) = &invocation.outcome {
            if existing != outcome {
                return Err(ModelError::Conflict);
            }
        } else {
            let s = &invocation.request.basis.scope;
            sqlx::query("INSERT INTO public.model_results(organisation_id,client_id,engagement_id,invocation_id,document) VALUES($1,$2,$3,$4,$5)").bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id).bind(&invocation.id).bind(encode(&StoredOutcome(outcome.clone()),2097152)?).execute(&mut *tx).await.map_err(db)?;
            invocation.outcome = Some(outcome.clone());
        }
        tx.commit().await.map_err(db)?;
        Ok(invocation)
    }
    async fn current_audience(
        &self,
        actor: &str,
        selected: &Scope,
        id: &str,
    ) -> Result<(), ModelError> {
        self.get(actor, selected, id).await.map(|_| ())
    }
    async fn get(&self, actor: &str, selected: &Scope, id: &str) -> Result<Invocation, ModelError> {
        if !valid_scope_id(id) {
            return Err(ModelError::Invalid);
        }
        let mut tx = task::lock(&self.pool, actor, selected)
            .await
            .map_err(task_error)?;
        let invocation = load(&mut tx, id).await?;
        if invocation.request.basis.scope != *selected {
            return Err(ModelError::Denied);
        }
        audience(&mut tx, actor, &invocation.request).await?;
        tx.commit().await.map_err(db)?;
        Ok(invocation)
    }
    async fn admit_tool(
        &self,
        actor: &str,
        selected: &Scope,
        basis: &ClaimBasis,
        id: &str,
        call_id: &str,
        key: &str,
    ) -> Result<Operation, ModelError> {
        let invocation = self.get(actor, selected, id).await?;
        let (_, request) = validated_tool(&invocation, call_id)?;
        operation::OperationRepository::new(self.pool.clone())
            .with_model_qualification_source(self.qualifications.clone())
            .admit_model_tool(
                actor,
                selected,
                basis,
                key,
                &request,
                &ModelToolBinding {
                    invocation_id: id.into(),
                    call_id: call_id.into(),
                },
            )
            .await
            .map_err(op)
    }
}

pub(crate) async fn check_proposal(
    tx: &mut Tx,
    b: &ClaimBasis,
    binding: &ModelToolBinding,
    request: &CanonicalOperation,
    qualifications: Option<&dyn ModelQualificationSource>,
) -> Result<(), OperationError> {
    let invocation = load(tx, &binding.invocation_id)
        .await
        .map_err(as_operation)?;
    if !qualifications.is_some_and(|source| source.qualified(&invocation.request.profile)) {
        return Err(OperationError::Fenced);
    }
    let original = &invocation.request.basis;
    if original.actor_id != b.actor_id
        || original.scope != b.scope
        || original.task_id != b.task_id
        || original.cycle_id != b.cycle_id
        || original.intent_revision != b.intent_revision
        || original.execution_epoch != b.execution_epoch
    {
        return Err(OperationError::Fenced);
    }
    current_configuration(tx, &invocation.request)
        .await
        .map_err(as_operation)?;
    audience(tx, &b.actor_id, &invocation.request)
        .await
        .map_err(as_operation)?;
    let (_, canonical) = validated_tool(&invocation, &binding.call_id).map_err(as_operation)?;
    if canonical != *request {
        return Err(OperationError::Conflict);
    }
    Ok(())
}
pub(crate) async fn verify_binding_retry(
    tx: &mut Tx,
    id: &str,
    binding: Option<&ModelToolBinding>,
) -> Result<(), OperationError> {
    let existing: Option<(String, String)> = sqlx::query_as(
        "SELECT invocation_id,call_id FROM public.model_tool_bindings WHERE operation_id=$1",
    )
    .bind(id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|_| OperationError::Unavailable)?;
    match (existing, binding) {
        (None, None) => Ok(()),
        (Some((invocation, call)), Some(b))
            if invocation == b.invocation_id && call == b.call_id =>
        {
            Ok(())
        }
        _ => Err(OperationError::Conflict),
    }
}
pub(crate) async fn insert_binding(
    tx: &mut Tx,
    b: &ClaimBasis,
    id: &str,
    binding: &ModelToolBinding,
    request: &CanonicalOperation,
) -> Result<(), OperationError> {
    let digest = hash(&request.canonical_bytes().ok_or(OperationError::Invalid)?);
    let s = &b.scope;
    sqlx::query("INSERT INTO public.model_tool_bindings(organisation_id,client_id,engagement_id,operation_id,invocation_id,call_id,request_digest) VALUES($1,$2,$3,$4,$5,$6,$7)").bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id).bind(id).bind(&binding.invocation_id).bind(&binding.call_id).bind(digest).execute(&mut **tx).await.map_err(|e|if e.as_database_error().is_some_and(|e|e.is_unique_violation()){OperationError::Conflict}else{OperationError::Unavailable})?;
    Ok(())
}
pub(crate) async fn check_bound_operation(
    tx: &mut Tx,
    id: &str,
    b: &ClaimBasis,
    request: &CanonicalOperation,
    qualifications: Option<&dyn ModelQualificationSource>,
) -> Result<(), OperationError> {
    let existing:Option<(String,String,String)>=sqlx::query_as("SELECT invocation_id,call_id,request_digest FROM public.model_tool_bindings WHERE operation_id=$1").bind(id).fetch_optional(&mut **tx).await.map_err(|_|OperationError::Unavailable)?;
    if let Some((invocation_id, call_id, digest)) = existing {
        if digest != hash(&request.canonical_bytes().ok_or(OperationError::Invalid)?) {
            return Err(OperationError::Conflict);
        }
        check_proposal(
            tx,
            b,
            &ModelToolBinding {
                invocation_id,
                call_id,
            },
            request,
            qualifications,
        )
        .await?;
    }
    Ok(())
}

/// Current routing availability for operation inspection. Historical consumed
/// effects are projected by their receipt facts independently of this gate.
pub(crate) async fn operation_configuration_current(
    tx: &mut Tx,
    operation_id: &str,
    qualifications: Option<&dyn ModelQualificationSource>,
) -> Result<(), OperationError> {
    let invocation: Option<String> = sqlx::query_scalar(
        "SELECT invocation_id FROM public.model_tool_bindings WHERE operation_id=$1",
    )
    .bind(operation_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|_| OperationError::Unavailable)?;
    if let Some(id) = invocation {
        let invocation = load(tx, &id).await.map_err(as_operation)?;
        if !qualifications.is_some_and(|source| source.qualified(&invocation.request.profile)) {
            return Err(OperationError::Fenced);
        }
        current_configuration(tx, &invocation.request)
            .await
            .map_err(as_operation)?;
        let actor: String = sqlx::query_scalar("SELECT current_setting('zobba.actor_id',true)")
            .fetch_one(&mut **tx)
            .await
            .map_err(|_| OperationError::Unavailable)?;
        audience(tx, &actor, &invocation.request)
            .await
            .map_err(as_operation)?;
    }
    Ok(())
}

#[cfg(test)]
mod history_graph_tests {
    use super::history_is_acyclic;
    use std::collections::{BTreeMap, BTreeSet};

    #[test]
    fn cumulative_history_shares_ancestors_without_becoming_a_cycle() {
        let graph: BTreeMap<String, BTreeSet<String>> = (0..23)
            .map(|turn| {
                (
                    format!("turn-{turn}"),
                    (0..turn).map(|earlier| format!("turn-{earlier}")).collect(),
                )
            })
            .collect();
        assert_eq!(graph.values().map(BTreeSet::len).sum::<usize>(), 253);
        assert!(history_is_acyclic(&graph));
    }

    #[test]
    fn history_cycles_and_missing_nodes_are_refused() {
        for graph in [
            BTreeMap::from([("a".into(), BTreeSet::from(["a".into()]))]),
            BTreeMap::from([
                ("a".into(), BTreeSet::from(["b".into()])),
                ("b".into(), BTreeSet::from(["a".into()])),
            ]),
            BTreeMap::from([("a".into(), BTreeSet::from(["missing".into()]))]),
        ] {
            assert!(!history_is_acyclic(&graph));
        }
    }
}
