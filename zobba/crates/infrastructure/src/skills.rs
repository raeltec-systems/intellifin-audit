//! Immutable installed techniques and current, scoped selection eligibility.
//! A selection creates no operation, claim, decision, wakeup or execution.
use crate::{identity::random_secret, methodology, operation, scope, task};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Postgres, Row, Transaction};
use std::{cell::RefCell, collections::BTreeMap, net::SocketAddr};
use zobba_application::{methodology as method, skills::*};
use zobba_domain::{
    identity::{Scope, valid_scope_id},
    permissions::{self, AuthoritySnapshot, SourceBinding},
    skills as domain,
};

type Tx = Transaction<'static, Postgres>;
// This explicit output bound participates in the skills-only 8 MiB browser
// envelope proof. User-supplied selection reasons retain their separate limit.
const INSPECTION_REASON_MAX: usize = 256;
const REQUEST_CAPABILITY_COMPARISONS_MAX: usize = 1_048_576;

#[derive(Clone)]
pub struct SkillsRepository {
    pool: PgPool,
    session_hash: String,
    qualification_source: Option<SourceBinding>,
}

#[derive(Deserialize)]
struct StoredInspection {
    revision: u64,
    selection_revision: u64,
    versions: Vec<SkillVersion>,
    selections: Vec<Selection>,
}

#[derive(Deserialize)]
struct CurrentFence {
    observed_at: i64,
    method_allowed: bool,
    authority_actor_current: bool,
}

struct TaskInspection {
    stored: StoredInspection,
    methodology: method::Binding,
    execution_epoch: u64,
    task_state: String,
    method_allowed: bool,
    authority: Option<AuthoritySnapshot>,
    current_authority: Result<AuthoritySnapshot, SkillsError>,
    authority_actor_current: bool,
    authority_fingerprint: String,
    observed_at: i64,
    memo: RefCell<InspectionMemo>,
}

struct InspectionMemo {
    remaining_comparisons: usize,
    capabilities: BTreeMap<String, permissions::CapabilityInspection>,
    versions: BTreeMap<String, Inspection>,
}

impl Default for InspectionMemo {
    fn default() -> Self {
        Self {
            remaining_comparisons: REQUEST_CAPABILITY_COMPARISONS_MAX,
            capabilities: BTreeMap::new(),
            versions: BTreeMap::new(),
        }
    }
}

impl TaskInspection {
    fn capability(
        &self,
        need: &permissions::CapabilityNeed,
        current: &AuthoritySnapshot,
        accepted: &AuthoritySnapshot,
    ) -> permissions::CapabilityInspection {
        // Exact serialized query meaning, excluding the manifest's display ID.
        // Cache lifetime is this one immutable scoped authority/time snapshot.
        let key = json!([
            need.purpose.as_str(),
            need.action.as_str(),
            need.account_id,
            need.environment_id,
            need.destination,
            need.resource_id,
            need.recipients,
            need.attachment_classifications,
            need.requires_attachments,
            need.source.as_ref().map(|s| (
                &s.source_id,
                &s.ledger_id,
                &s.endpoint_digest,
                s.contract_version
            ))
        ])
        .to_string();
        let mut memo = self.memo.borrow_mut();
        if let Some(inspection) = memo.capabilities.get(&key) {
            return inspection.clone();
        }
        let inspection = permissions::inspect_capability_with_work_budget(
            need,
            current,
            accepted,
            self.observed_at,
            &mut memo.remaining_comparisons,
        );
        memo.capabilities.insert(key, inspection.clone());
        inspection
    }
}

fn database_error(error: sqlx::Error) -> SkillsError {
    match error.as_database_error().and_then(|e| e.code()).as_deref() {
        Some("Z0001") => SkillsError::Invalid,
        Some("Z0002") => SkillsError::Denied,
        Some("Z0003") => SkillsError::Conflict,
        Some("Z0006") => SkillsError::Capacity,
        _ => SkillsError::Unavailable,
    }
}
fn task_error(error: zobba_application::task::TaskError) -> SkillsError {
    match error {
        zobba_application::task::TaskError::Denied => SkillsError::Denied,
        _ => SkillsError::Unavailable,
    }
}
fn method_error(error: method::MethodologyError) -> SkillsError {
    match error {
        method::MethodologyError::Denied => SkillsError::Denied,
        _ => SkillsError::Unavailable,
    }
}
fn encode(value: &impl Serialize) -> Result<Value, SkillsError> {
    serde_json::to_value(value).map_err(|_| SkillsError::Invalid)
}
fn decode<T: DeserializeOwned>(value: Value) -> Result<T, SkillsError> {
    serde_json::from_value(value).map_err(|_| SkillsError::Unavailable)
}
fn hash(value: &[u8]) -> String {
    format!("{:x}", Sha256::digest(value))
}
fn token() -> Result<String, SkillsError> {
    random_secret().map_err(|_| SkillsError::Unavailable)
}
fn manifest_digests(manifest: &Manifest) -> Result<(String, Vec<ResourceDigest>), SkillsError> {
    let manifest = manifest.to_domain().ok_or(SkillsError::Invalid)?;
    let bytes = manifest.canonical_bytes().ok_or(SkillsError::Invalid)?;
    let resources = manifest
        .resources
        .iter()
        .map(|resource| ResourceDigest {
            id: resource.id.clone(),
            digest: hash(resource.content.as_bytes()),
        })
        .collect();
    Ok((hash(&bytes), resources))
}
fn verify_version(version: &SkillVersion) -> Result<(), SkillsError> {
    if !version.command.is_valid() {
        return Err(SkillsError::Unavailable);
    }
    let (digest, resources) =
        manifest_digests(&version.command.manifest).map_err(|_| SkillsError::Unavailable)?;
    if digest != version.digest || resources != version.resource_digests {
        return Err(SkillsError::Unavailable);
    }
    Ok(())
}

impl SkillsRepository {
    pub fn new(pool: PgPool) -> Self {
        Self {
            pool,
            session_hash: String::new(),
            qualification_source: None,
        }
    }
    pub fn with_session_hash(mut self, hash: String) -> Self {
        self.session_hash = hash;
        self
    }
    /// Fixture-only server configuration matching the owned gateway contract.
    /// The browser/manifest cannot qualify a tool or provide this binding. This
    /// records adapter compatibility only and never contacts or starts a source.
    pub fn with_qualification_source(
        mut self,
        address: SocketAddr,
        source: SourceBinding,
    ) -> Result<Self, SkillsError> {
        if !address.ip().is_loopback()
            || address.port() == 0
            || !source.is_valid()
            || source.endpoint_digest != hash(address.to_string().as_bytes())
        {
            return Err(SkillsError::Invalid);
        }
        self.qualification_source = Some(source);
        Ok(self)
    }
    async fn task_document(
        &self,
        tx: &mut Tx,
        id: &str,
        action: &str,
        mut value: Value,
    ) -> Result<Value, SkillsError> {
        value["session_hash"] = json!(self.session_hash);
        sqlx::query_scalar("SELECT public.skills_task($1,$2,$3)")
            .bind(id)
            .bind(action)
            .bind(value)
            .fetch_one(&mut **tx)
            .await
            .map_err(database_error)
    }
    async fn lock(&self, actor: &str, s: &Scope, id: &str) -> Result<Tx, SkillsError> {
        if !valid_scope_id(actor) || !s.is_valid() || !valid_scope_id(id) {
            return Err(SkillsError::Denied);
        }
        let mut tx = task::lock(&self.pool, actor, s).await.map_err(task_error)?;
        task::task(&mut tx, id).await.map_err(task_error)?;
        Ok(tx)
    }
    async fn inspect_locked(
        &self,
        tx: &mut Tx,
        s: &Scope,
        id: &str,
    ) -> Result<TaskInspection, SkillsError> {
        let stored: StoredInspection =
            decode(self.task_document(tx, id, "inspect", json!({})).await?)?;
        for version in &stored.versions {
            verify_version(version)?;
        }
        let methodology = methodology::current_binding(tx, id)
            .await
            .map_err(method_error)?;
        let row = task::task(tx, id).await.map_err(task_error)?;
        let execution_epoch = row
            .try_get::<i64, _>("execution_epoch")
            .map_err(database_error)? as u64;
        let task_state = row.try_get("state").map_err(database_error)?;
        let (authority, current_authority, authority_fingerprint) =
            match operation::skill_authority(tx, s, id).await {
                Ok(Some((accepted, current, fingerprint))) => (
                    Some(accepted),
                    current.map_err(|_| SkillsError::Unavailable),
                    fingerprint,
                ),
                Ok(None) => (
                    None,
                    Err(SkillsError::Unavailable),
                    "acceptance-missing".into(),
                ),
                Err(_) => (
                    None,
                    Err(SkillsError::Unavailable),
                    "authority-unavailable".into(),
                ),
            };
        // One final storage call rechecks the exact session, both actors and the
        // method cutoff after all potentially blocking loads. Its server time is
        // also used for every hard-policy deadline in the pure projection.
        let fence: CurrentFence = decode(
            self.task_document(
                tx,
                id,
                "fence",
                json!({
                    "actor_id":authority.as_ref().map(|accepted| &accepted.actor_id)
                }),
            )
            .await?,
        )?;
        Ok(TaskInspection {
            stored,
            methodology,
            execution_epoch,
            task_state,
            method_allowed: fence.method_allowed,
            authority,
            current_authority,
            authority_actor_current: fence.authority_actor_current,
            authority_fingerprint,
            observed_at: fence.observed_at,
            memo: RefCell::new(InspectionMemo::default()),
        })
    }
    fn eligibility(
        &self,
        basis: &TaskInspection,
        version: &SkillVersion,
    ) -> Result<Inspection, SkillsError> {
        if let Some(inspection) = basis.memo.borrow().versions.get(&version.id) {
            return Ok(inspection.clone());
        }
        let manifest = version
            .command
            .manifest
            .to_domain()
            .ok_or(SkillsError::Unavailable)?;
        let status = match basis.methodology.resolution.status {
            method::ResolutionStatus::Resolved => {
                zobba_domain::methodology::ResolutionStatus::Resolved
            }
            method::ResolutionStatus::Neutral => {
                zobba_domain::methodology::ResolutionStatus::Neutral
            }
            method::ResolutionStatus::Incomplete => {
                zobba_domain::methodology::ResolutionStatus::Incomplete
            }
            method::ResolutionStatus::Ambiguous => {
                zobba_domain::methodology::ResolutionStatus::Ambiguous
            }
            method::ResolutionStatus::Recalled => {
                zobba_domain::methodology::ResolutionStatus::Recalled
            }
        };
        let applicability = domain::method_compatibility(
            &manifest,
            &version.command.applicability.to_domain(),
            &basis.methodology.resolution.context.to_domain(),
            status,
            &basis.methodology.resolution.version_ids,
        );
        let needs: Vec<_> = manifest.needs.iter().map(|need| {
            let mut result = NeedInspection { id: need.id.clone(), tool: need.tool.as_str().into(),
                status: CapabilityStatus::Unavailable, reason: "An accepted Task authority and qualified source are required".into(), refresh_at: None, blocking_bound: None };
            if let Some(query) = need.capability_need() {
                if let Some(accepted) = &basis.authority {
                    if !basis.authority_actor_current {
                        result.status = CapabilityStatus::Forbidden;
                        result.reason = "The Task's accepted authority actor no longer has current audit access".into();
                    } else { match &basis.current_authority {
                        Ok(current) => {
                            let policy = basis.capability(&query,current,accepted);
                            result.status = match policy.status {
                                permissions::CapabilityStatus::Forbidden => CapabilityStatus::Forbidden,
                                permissions::CapabilityStatus::Unavailable => CapabilityStatus::Unavailable,
                                permissions::CapabilityStatus::CompatibleNeedsExactDetails => CapabilityStatus::CompatibleNeedsExactDetails,
                            };
                            result.reason = format!("Permissions: {}. Exact actions still require current admission and any decision",policy.reason.as_str());
                            if policy.reason == permissions::CapabilityReason::QueryCapacity {
                                result.reason = "Capability inspection reached its bounded work limit; this need is unavailable until an exact-version check can complete".into();
                            }
                            result.refresh_at = policy.refresh_at;
                            result.blocking_bound = policy.blocking_bound.map(Into::into);
                            if result.status == CapabilityStatus::CompatibleNeedsExactDetails
                                && self.qualification_source.as_ref().is_none_or(|source| accepted.account.account.as_ref().is_none_or(|account| account.source != *source)) {
                                result.status = CapabilityStatus::Unavailable;
                                result.reason = "No qualified owned source supports this tool here; policy possibilities do not establish execution availability".into();
                            }
                        }
                        Err(_) => result.reason = "Current Permissions cannot be read reliably; refresh or repair Task authority".into(),
                    }}
                }
            } else { result.reason = "This recognized analysis tool is not implemented or qualified".into(); }
            result
        }).collect();
        let (status, reason) = match version.status {
            CatalogStatus::Disabled => (
                EligibilityStatus::Disabled,
                "Admin disabled this version; retained selections are history",
            ),
            CatalogStatus::Recalled => (
                EligibilityStatus::Recalled,
                "Admin recalled this version; affected selections cannot be used",
            ),
            CatalogStatus::Enabled if !basis.method_allowed => (
                EligibilityStatus::MethodologyBlocked,
                "The Task methodology has a pending current change or recalled source",
            ),
            CatalogStatus::Enabled
                if applicability == domain::MethodCompatibility::Inapplicable =>
            {
                (
                    EligibilityStatus::Inapplicable,
                    "This exact version does not apply to the Task's current methodology or audit context",
                )
            }
            CatalogStatus::Enabled if applicability == domain::MethodCompatibility::Unavailable => {
                (
                    EligibilityStatus::Unavailable,
                    "Required methodology or audit context is incomplete or unavailable",
                )
            }
            CatalogStatus::Enabled
                if needs
                    .iter()
                    .any(|need| need.status == CapabilityStatus::Forbidden) =>
            {
                (
                    EligibilityStatus::Forbidden,
                    "A declared required capability is forbidden by the Task's accepted/current authority",
                )
            }
            CatalogStatus::Enabled
                if needs
                    .iter()
                    .any(|need| need.status == CapabilityStatus::Unavailable) =>
            {
                (
                    EligibilityStatus::Unavailable,
                    "A declared required capability is unavailable; no compatibility conclusion permits selection",
                )
            }
            CatalogStatus::Enabled => (
                EligibilityStatus::Eligible,
                "Technique selection is compatible; it grants no operation authority and performs no execution",
            ),
        };
        if reason.len() > INSPECTION_REASON_MAX
            || needs
                .iter()
                .any(|need| need.reason.len() > INSPECTION_REASON_MAX)
        {
            return Err(SkillsError::Unavailable);
        }
        let fingerprint = hash(&serde_json::to_vec(&json!({"catalog_revision":basis.stored.revision,
            "version_id":version.id,"digest":version.digest,"status_revision":version.status_revision,
            "methodology_binding_id":basis.methodology.id,"execution_epoch":basis.execution_epoch,
            "method_allowed":basis.method_allowed,"authority_actor_current":basis.authority_actor_current,
            "task_state":basis.task_state,
            "authority":basis.authority_fingerprint,"qualified_source":self.qualification_source.as_ref().map(|s| (&s.source_id,&s.ledger_id,&s.endpoint_digest,s.contract_version))
        })).map_err(|_| SkillsError::Unavailable)?);
        let inspection = Inspection {
            version_id: version.id.clone(),
            skill_id: manifest.id,
            skill_version: manifest.version,
            digest: version.digest.clone(),
            catalog_revision: basis.stored.revision,
            methodology_binding_id: basis.methodology.id.clone(),
            execution_epoch: basis.execution_epoch,
            authority_actor_id: basis.authority.as_ref().map(|a| a.actor_id.clone()),
            status,
            reason: reason.into(),
            needs,
            observed_at: basis.observed_at,
            dependency_fingerprint: fingerprint,
        };
        basis
            .memo
            .borrow_mut()
            .versions
            .insert(version.id.clone(), inspection.clone());
        Ok(inspection)
    }
    fn selection_view(
        &self,
        basis: &TaskInspection,
        selection: &Selection,
    ) -> Result<SelectionView, SkillsError> {
        let version = basis
            .stored
            .versions
            .iter()
            .find(|version| version.id == selection.version_id)
            .ok_or(SkillsError::Unavailable)?;
        let mut current = self.eligibility(basis, version)?;
        if current.status == EligibilityStatus::Eligible
            && (selection.methodology.id != basis.methodology.id
                || selection.execution_epoch != basis.execution_epoch)
        {
            current.status = EligibilityStatus::MethodologyBlocked;
            current.reason = "The Task basis changed after this selection; choose again explicitly against the current binding".into();
        }
        if current.reason.len() > INSPECTION_REASON_MAX {
            return Err(SkillsError::Unavailable);
        }
        Ok(SelectionView {
            selection: selection.clone(),
            current,
        })
    }
    async fn write(
        &self,
        actor: &str,
        org: &str,
        kind: &str,
        command: Value,
        digest: &str,
        resources: Value,
    ) -> Result<CatalogReceipt, SkillsError> {
        if !valid_scope_id(actor) || !valid_scope_id(org) {
            return Err(SkillsError::Denied);
        }
        let mut tx = scope::begin_actor(&self.pool, actor)
            .await
            .map_err(|_| SkillsError::Unavailable)?;
        let value: Value =
            sqlx::query_scalar("SELECT public.skills_write($1,$2,$3,$4,$5,$6,$7,$8,$9)")
                .bind(actor)
                .bind(&self.session_hash)
                .bind(org)
                .bind(kind)
                .bind(command)
                .bind(token()?)
                .bind(token()?)
                .bind(digest)
                .bind(resources)
                .fetch_one(&mut *tx)
                .await
                .map_err(database_error)?;
        let result = decode(value)?;
        tx.commit().await.map_err(database_error)?;
        Ok(result)
    }
    async fn admin_read<T: DeserializeOwned>(
        &self,
        actor: &str,
        org: &str,
        action: &str,
        document: Value,
    ) -> Result<T, SkillsError> {
        if !valid_scope_id(actor) || !valid_scope_id(org) {
            return Err(SkillsError::Denied);
        }
        let mut tx = scope::begin_actor(&self.pool, actor)
            .await
            .map_err(|_| SkillsError::Unavailable)?;
        let value: Value = sqlx::query_scalar("SELECT public.skills_admin($1,$2,$3,$4,$5)")
            .bind(actor)
            .bind(&self.session_hash)
            .bind(org)
            .bind(action)
            .bind(document)
            .fetch_one(&mut *tx)
            .await
            .map_err(database_error)?;
        let result = decode(value)?;
        tx.commit().await.map_err(database_error)?;
        Ok(result)
    }
}

#[cfg(test)]
mod tests;

impl SkillsStore for SkillsRepository {
    async fn catalog(&self, actor: &str, org: &str) -> Result<CatalogSnapshot, SkillsError> {
        if !valid_scope_id(actor) || !valid_scope_id(org) {
            return Err(SkillsError::Denied);
        }
        let mut tx = scope::begin_actor(&self.pool, actor)
            .await
            .map_err(|_| SkillsError::Unavailable)?;
        let value: Value = sqlx::query_scalar("SELECT public.skills_read($1,$2,$3)")
            .bind(actor)
            .bind(&self.session_hash)
            .bind(org)
            .fetch_one(&mut *tx)
            .await
            .map_err(database_error)?;
        let result: CatalogSnapshot = decode(value)?;
        for version in &result.versions {
            verify_version(version)?;
        }
        // Hashing a full bounded catalogue must not extend an expired Admin
        // session's disclosure rights. The organisation fence keeps content
        // stable while this final read rechecks current Admin/session authority.
        let _: Value = sqlx::query_scalar("SELECT public.skills_read($1,$2,$3)")
            .bind(actor)
            .bind(&self.session_hash)
            .bind(org)
            .fetch_one(&mut *tx)
            .await
            .map_err(database_error)?;
        tx.commit().await.map_err(database_error)?;
        Ok(result)
    }
    async fn assignment_options(
        &self,
        actor: &str,
        org: &str,
        query: &AssignmentOptionsQuery,
    ) -> Result<AssignmentPage, SkillsError> {
        if !query.is_valid() {
            return Err(SkillsError::Invalid);
        }
        self.admin_read(actor, org, "assignment_options", encode(query)?)
            .await
    }
    async fn status_history(
        &self,
        actor: &str,
        org: &str,
        version: &str,
        before_revision: Option<u64>,
    ) -> Result<StatusHistory, SkillsError> {
        if !valid_scope_id(version)
            || before_revision.is_some_and(|revision| !(1..=i64::MAX as u64).contains(&revision))
        {
            return Err(SkillsError::Invalid);
        }
        self.admin_read(
            actor,
            org,
            "history",
            json!({"version_id":version,"before_revision":before_revision}),
        )
        .await
    }
    async fn selection_impact(
        &self,
        actor: &str,
        s: &Scope,
        version: Option<&str>,
        after: Option<&ImpactCursor>,
    ) -> Result<SelectionImpactPage, SkillsError> {
        if !valid_scope_id(actor) || !s.is_valid() {
            return Err(SkillsError::Denied);
        }
        if version.is_some_and(|id| !valid_scope_id(id))
            || after.is_some_and(|cursor| !cursor.is_valid())
        {
            return Err(SkillsError::Invalid);
        }
        let mut tx = task::lock(&self.pool, actor, s).await.map_err(task_error)?;
        let value: Value = sqlx::query_scalar("SELECT public.skills_impact($1,$2)")
            .bind(version)
            .bind(json!({"session_hash":self.session_hash,"after":after}))
            .fetch_one(&mut *tx)
            .await
            .map_err(database_error)?;
        let result = decode(value)?;
        tx.commit().await.map_err(database_error)?;
        Ok(result)
    }
    async fn install(
        &self,
        actor: &str,
        org: &str,
        command: &InstallSkill,
    ) -> Result<CatalogReceipt, SkillsError> {
        if !command.is_valid() {
            return Err(SkillsError::Invalid);
        }
        let (digest, resources) = manifest_digests(&command.manifest)?;
        self.write(
            actor,
            org,
            "install",
            encode(command)?,
            &digest,
            encode(&resources)?,
        )
        .await
    }
    async fn set_status(
        &self,
        actor: &str,
        org: &str,
        command: &ChangeSkillStatus,
    ) -> Result<CatalogReceipt, SkillsError> {
        if !command.is_valid() {
            return Err(SkillsError::Invalid);
        }
        self.write(actor, org, "status", encode(command)?, "", json!([]))
            .await
    }
    async fn discover(&self, actor: &str, s: &Scope, id: &str) -> Result<Discovery, SkillsError> {
        let mut tx = self.lock(actor, s, id).await?;
        let basis = self.inspect_locked(&mut tx, s, id).await?;
        let candidates = basis
            .stored
            .versions
            .iter()
            .map(|version| {
                Ok(Candidate {
                    version: version.clone(),
                    inspection: self.eligibility(&basis, version)?,
                })
            })
            .collect::<Result<_, SkillsError>>()?;
        let selections = basis
            .stored
            .selections
            .iter()
            .map(|selection| self.selection_view(&basis, selection))
            .collect::<Result<_, _>>()?;
        let result = Discovery {
            task_id: id.into(),
            catalog_revision: basis.stored.revision,
            selection_revision: basis.stored.selection_revision,
            methodology_binding_id: basis.methodology.id,
            execution_epoch: basis.execution_epoch,
            candidates,
            selections,
            observed_at: basis.observed_at,
        };
        // Exact viewer/session validity is checked again at the disclosure boundary.
        self.task_document(&mut tx, id, "replay", json!({"key":"disclosure-check"}))
            .await?;
        tx.commit().await.map_err(database_error)?;
        Ok(result)
    }
    async fn select(
        &self,
        actor: &str,
        s: &Scope,
        id: &str,
        command: &SelectSkill,
    ) -> Result<SelectionReceipt, SkillsError> {
        if !command.is_valid() {
            return Err(SkillsError::Invalid);
        }
        let mut tx = self.lock(actor, s, id).await?;
        let replay = self
            .task_document(&mut tx, id, "replay", json!({"key":command.key}))
            .await?;
        if !replay.is_null() {
            if decode::<SelectSkill>(replay["command"].clone())? != *command {
                return Err(SkillsError::Conflict);
            }
            let selection: Selection = decode(replay["receipt"].clone())?;
            let basis = self.inspect_locked(&mut tx, s, id).await?;
            let result = self.selection_view(&basis, &selection)?;
            tx.commit().await.map_err(database_error)?;
            return Ok(result);
        }
        let basis = self.inspect_locked(&mut tx, s, id).await?;
        if command.expected_catalog_revision != basis.stored.revision
            || command.expected_selection_revision != basis.stored.selection_revision
            || command.expected_methodology_binding_id != basis.methodology.id
            || command.expected_execution_epoch != basis.execution_epoch
        {
            return Err(SkillsError::Conflict);
        }
        let version = basis
            .stored
            .versions
            .iter()
            .find(|version| version.id == command.version_id)
            .ok_or(SkillsError::Denied)?;
        let inspected = self.eligibility(&basis, version)?;
        if inspected.status != EligibilityStatus::Eligible {
            return Err(SkillsError::Ineligible);
        }
        let receipt = Selection {
            id: token()?,
            task_id: id.into(),
            selector_id: actor.into(),
            authority_actor_id: inspected.authority_actor_id,
            selected_at: basis.observed_at,
            revision: basis.stored.selection_revision + 1,
            version_id: version.id.clone(),
            skill_id: version.command.manifest.id.clone(),
            skill_version: version.command.manifest.version.clone(),
            digest: version.digest.clone(),
            reason: command.reason.clone(),
            methodology: basis.methodology,
            execution_epoch: basis.execution_epoch,
            catalog_revision: basis.stored.revision,
            dependency_fingerprint: inspected.dependency_fingerprint,
        };
        let selection: Selection = decode(
            self.task_document(
                &mut tx,
                id,
                "select",
                json!({"command":command,"receipt":receipt}),
            )
            .await?,
        )?;
        // Deferred storage work may block across authority or activation expiry.
        // Finish it before the final time-sensitive check; failure rolls back all.
        sqlx::query("SET CONSTRAINTS ALL IMMEDIATE")
            .execute(&mut *tx)
            .await
            .map_err(database_error)?;
        let basis = self.inspect_locked(&mut tx, s, id).await?;
        let result = self.selection_view(&basis, &selection)?;
        if result.current.status != EligibilityStatus::Eligible {
            return Err(SkillsError::Ineligible);
        }
        tx.commit().await.map_err(database_error)?;
        Ok(result)
    }
    async fn current_use(
        &self,
        actor: &str,
        s: &Scope,
        id: &str,
        selection_id: &str,
    ) -> Result<SelectionView, SkillsError> {
        if !valid_scope_id(selection_id) {
            return Err(SkillsError::Denied);
        }
        let mut tx = self.lock(actor, s, id).await?;
        sqlx::query("SET CONSTRAINTS ALL IMMEDIATE")
            .execute(&mut *tx)
            .await
            .map_err(database_error)?;
        let basis = self.inspect_locked(&mut tx, s, id).await?;
        let selection = basis
            .stored
            .selections
            .iter()
            .find(|selection| selection.id == selection_id)
            .ok_or(SkillsError::Denied)?;
        let mut result = self.selection_view(&basis, selection)?;
        if result.current.status == EligibilityStatus::Eligible
            && !matches!(basis.task_state.as_str(), "ready" | "running")
        {
            result.current.status = EligibilityStatus::TaskBlocked;
            result.current.reason =
                "The Task is not running or ready; selecting a technique never resumes work".into();
        }
        if result.current.reason.len() > INSPECTION_REASON_MAX {
            return Err(SkillsError::Unavailable);
        }
        tx.commit().await.map_err(database_error)?;
        Ok(result)
    }
}
