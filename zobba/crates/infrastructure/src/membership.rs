//! Runtime-only adapter for inventoried membership SQL entry points.
use crate::{identity::random_secret, scope};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use zobba_application::membership::*;
use zobba_domain::{
    identity::valid_scope_id,
    membership::{normalize_email, valid_invitation_secret},
};
#[derive(Clone)]
pub struct MembershipRepository {
    pool: PgPool,
    issuer: String,
    session_hash: String,
}
fn database_error(error: sqlx::Error) -> MembershipError {
    match error.as_database_error().and_then(|e| e.code()).as_deref() {
        Some("Z0001") => MembershipError::Invalid,
        Some("Z0002") => MembershipError::Denied,
        Some("Z0003") => MembershipError::Conflict,
        Some("Z0004") => MembershipError::LastAdmin,
        Some("Z0005") => MembershipError::InvitationRefused,
        Some("Z0006") => MembershipError::Capacity,
        _ => MembershipError::Unavailable,
    }
}
fn encode(value: &impl Serialize) -> Result<Value, MembershipError> {
    serde_json::to_value(value).map_err(|_| MembershipError::Invalid)
}
fn decode<T: DeserializeOwned>(value: Value) -> Result<T, MembershipError> {
    serde_json::from_value(value).map_err(|_| MembershipError::Unavailable)
}
fn digest(secret: &str) -> String {
    format!("{:x}", Sha256::digest(secret.as_bytes()))
}
fn opaque_id() -> Result<String, MembershipError> {
    random_secret().map_err(|_| MembershipError::Unavailable)
}
fn canonicalize(command: &mut Value) {
    if let Some(roles) = command.get_mut("roles").and_then(Value::as_array_mut) {
        roles.sort_by(|a, b| a.as_str().cmp(&b.as_str()));
    }
    if let Some(assignments) = command.get_mut("assignments").and_then(Value::as_array_mut) {
        assignments.sort_by(|a, b| {
            (a["client_id"].as_str(), a["engagement_id"].as_str())
                .cmp(&(b["client_id"].as_str(), b["engagement_id"].as_str()))
        });
    }
}
impl MembershipRepository {
    pub fn new(pool: PgPool, issuer: String) -> Self {
        Self {
            pool,
            issuer,
            session_hash: String::new(),
        }
    }
    /// Bind the verified cookie's digest; SQL checks it again after authority locks.
    pub fn with_session_hash(mut self, hash: String) -> Self {
        self.session_hash = hash;
        self
    }
    async fn read<T: DeserializeOwned>(
        &self,
        actor: &str,
        org: Option<&str>,
        members: Option<&str>,
        invitations: Option<&str>,
        engagements: Option<&str>,
    ) -> Result<T, MembershipError> {
        if !valid_scope_id(actor)
            || org.is_some_and(|v| !valid_scope_id(v))
            || [members, invitations]
                .into_iter()
                .flatten()
                .any(|v| !valid_scope_id(v))
            || engagements.is_some_and(|v| {
                v.split_once('.')
                    .is_none_or(|(c, e)| !valid_scope_id(c) || !valid_scope_id(e))
            })
        {
            return Err(MembershipError::Invalid);
        }
        let mut tx = scope::begin_actor(&self.pool, actor)
            .await
            .map_err(|_| MembershipError::Unavailable)?;
        let value: Value = sqlx::query_scalar("SELECT public.membership_read($1,$2,$3,$4,$5,$6)")
            .bind(actor)
            .bind(&self.session_hash)
            .bind(org)
            .bind(members)
            .bind(invitations)
            .bind(engagements)
            .fetch_one(&mut *tx)
            .await
            .map_err(database_error)?;
        let result = decode(value)?;
        tx.commit().await.map_err(database_error)?;
        Ok(result)
    }
    async fn write(
        &self,
        actor: &str,
        org: &str,
        kind: &str,
        mut command: Value,
    ) -> Result<Receipt, MembershipError> {
        if !valid_scope_id(actor) || !valid_scope_id(org) {
            return Err(MembershipError::Invalid);
        }
        canonicalize(&mut command);
        let mut tx = scope::begin_actor(&self.pool, actor)
            .await
            .map_err(|_| MembershipError::Unavailable)?;
        let value: Value =
            sqlx::query_scalar("SELECT public.membership_write($1,$2,$3,$4,$5,$6,$7,$8)")
                .bind(actor)
                .bind(&self.session_hash)
                .bind(org)
                .bind(kind)
                .bind(command)
                .bind(opaque_id()?)
                .bind(opaque_id()?)
                .bind(&self.issuer)
                .fetch_one(&mut *tx)
                .await
                .map_err(database_error)?;
        let result = decode(value)?;
        tx.commit().await.map_err(database_error)?;
        Ok(result)
    }
}
impl MembershipStore for MembershipRepository {
    async fn organisations(
        &self,
        actor: &str,
        after: Option<&str>,
    ) -> Result<OrganisationsPage, MembershipError> {
        self.read(actor, None, after, None, None).await
    }
    async fn snapshot(
        &self,
        actor: &str,
        organisation: &str,
        members_after: Option<&str>,
        invitations_after: Option<&str>,
        engagements_after: Option<&str>,
    ) -> Result<Snapshot, MembershipError> {
        self.read(
            actor,
            Some(organisation),
            members_after,
            invitations_after,
            engagements_after,
        )
        .await
    }
    async fn member_assignments(
        &self,
        actor: &str,
        organisation: &str,
        target: &str,
        after: Option<&str>,
    ) -> Result<MemberAssignmentsPage, MembershipError> {
        if ![actor, organisation, target]
            .into_iter()
            .all(valid_scope_id)
            || after.is_some_and(|v| {
                v.split_once('.')
                    .is_none_or(|(c, e)| !valid_scope_id(c) || !valid_scope_id(e))
            })
        {
            return Err(MembershipError::Invalid);
        }
        let mut tx = scope::begin_actor(&self.pool, actor)
            .await
            .map_err(|_| MembershipError::Unavailable)?;
        let value: Value =
            sqlx::query_scalar("SELECT public.membership_assignments($1,$2,$3,$4,$5)")
                .bind(actor)
                .bind(&self.session_hash)
                .bind(organisation)
                .bind(target)
                .bind(after)
                .fetch_one(&mut *tx)
                .await
                .map_err(database_error)?;
        let result = decode(value)?;
        tx.commit().await.map_err(database_error)?;
        Ok(result)
    }
    async fn save_member(
        &self,
        actor: &str,
        organisation: &str,
        command: &SaveMember,
    ) -> Result<Receipt, MembershipError> {
        if !command.is_valid() {
            return Err(MembershipError::Invalid);
        }
        self.write(actor, organisation, "save_member", encode(command)?)
            .await
    }
    async fn invite(
        &self,
        actor: &str,
        organisation: &str,
        command: &InviteCommand,
    ) -> Result<Receipt, MembershipError> {
        if !command.is_valid() {
            return Err(MembershipError::Invalid);
        }
        let mut value = encode(command)?;
        value
            .as_object_mut()
            .ok_or(MembershipError::Invalid)?
            .remove("secret");
        value["secret_hash"] = Value::String(digest(&command.secret));
        value["recipient_issuer"] = Value::String(self.issuer.clone());
        value["recipient_email"] = Value::String(
            normalize_email(&command.recipient_email).ok_or(MembershipError::Invalid)?,
        );
        self.write(actor, organisation, "invite", value).await
    }
    async fn revoke_invitation(
        &self,
        actor: &str,
        organisation: &str,
        command: &RevokeInvitation,
    ) -> Result<Receipt, MembershipError> {
        if !command.is_valid() {
            return Err(MembershipError::Invalid);
        }
        self.write(actor, organisation, "revoke_invitation", encode(command)?)
            .await
    }
    async fn preview(
        &self,
        actor: &str,
        session_hash: &str,
        secret: &str,
    ) -> Result<InvitationPreview, MembershipError> {
        if !valid_scope_id(actor) || !valid_invitation_secret(secret) {
            return Err(MembershipError::Invalid);
        }
        let mut tx = scope::begin_actor(&self.pool, actor)
            .await
            .map_err(|_| MembershipError::Unavailable)?;
        let value: Value = sqlx::query_scalar("SELECT public.membership_preview($1,$2,$3,$4)")
            .bind(actor)
            .bind(session_hash)
            .bind(digest(secret))
            .bind(&self.issuer)
            .fetch_one(&mut *tx)
            .await
            .map_err(database_error)?;
        let result = decode(value)?;
        tx.commit().await.map_err(database_error)?;
        Ok(result)
    }
    async fn accept(
        &self,
        actor: &str,
        session_hash: &str,
        secret: &str,
        key: &str,
    ) -> Result<Receipt, MembershipError> {
        if !valid_scope_id(actor) || !valid_scope_id(key) || !valid_invitation_secret(secret) {
            return Err(MembershipError::Invalid);
        }
        let mut tx = scope::begin_actor(&self.pool, actor)
            .await
            .map_err(|_| MembershipError::Unavailable)?;
        let value: Value = sqlx::query_scalar("SELECT public.membership_accept($1,$2,$3,$4,$5,$6)")
            .bind(actor)
            .bind(session_hash)
            .bind(digest(secret))
            .bind(key)
            .bind(opaque_id()?)
            .bind(&self.issuer)
            .fetch_one(&mut *tx)
            .await
            .map_err(database_error)?;
        let result = decode(value)?;
        tx.commit().await.map_err(database_error)?;
        Ok(result)
    }
}
