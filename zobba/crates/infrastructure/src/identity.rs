//! Server-only identity control plane and scoped read adapter.
//! No provider access/refresh/ID token is persisted or returned to callers.
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use rand::{RngCore, rngs::OsRng};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use zobba_application::identity::{CurrentAuthority, CurrentSession, IdentityError};
use zobba_domain::identity::{
    AuditRole, ENGAGEMENT_PAGE_SIZE, Engagement, EngagementPage, Identity, Scope,
};

use crate::scope;

pub const LOGIN_SECONDS: i64 = 300;
pub const LOGIN_CAPACITY: i64 = 1_000;
pub const EXPIRY_CLEANUP_BATCH: i64 = 128;
// The init-plan reads at most one expiry-index batch; the outer TID scan visits
// only those physical rows. A primary-key IN join may instead scan the backlog.
// Kept visible for the retained PostgreSQL EXPLAIN plan contract.
pub const LOGIN_EXPIRY_CLEANUP_SQL: &str = "DELETE FROM public.login_attempts WHERE ctid=ANY(ARRAY(SELECT ctid FROM public.login_attempts WHERE expires_at <= $1 ORDER BY expires_at,state_hash LIMIT $2))";
pub const SESSION_EXPIRY_CLEANUP_SQL: &str = "DELETE FROM public.sessions WHERE ctid=ANY(ARRAY(SELECT ctid FROM public.sessions WHERE expires_at <= $1 ORDER BY expires_at,token_hash LIMIT $2))";

pub const SESSION_SECONDS: i64 = 28_800;

pub fn random_secret() -> Result<String, IdentityError> {
    let mut bytes = [0u8; 32];
    OsRng
        .try_fill_bytes(&mut bytes)
        .map_err(|_| IdentityError::Unavailable)?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

pub fn secret_hash(value: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(value.as_bytes()))
}

pub fn valid_secret(value: &str) -> bool {
    value.len() == 43
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

pub fn secret_matches(expected: &str, supplied: &str) -> bool {
    let expected = Sha256::digest(expected.as_bytes());
    let supplied = Sha256::digest(supplied.as_bytes());
    expected
        .iter()
        .zip(supplied.iter())
        .fold(0u8, |difference, (a, b)| difference | (a ^ b))
        == 0
}

pub struct LoginAttempt {
    pub nonce: String,
    pub pkce_verifier: String,
}

#[derive(Clone)]
pub struct IdentityRepository {
    pool: PgPool,
}

impl IdentityRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn begin_login(
        &self,
        state: &str,
        browser_binding: &str,
        nonce: &str,
        verifier: &str,
    ) -> Result<(), IdentityError> {
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|_| IdentityError::Unavailable)?;
        // Refresh the snapshot after waiting for the admission lock, even when a
        // deployment configures a repeatable-read default for connections.
        sqlx::query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED")
            .execute(&mut *tx)
            .await
            .map_err(|_| IdentityError::Unavailable)?;
        // All admissions serialize across processes. Count and insertion share the
        // lock/transaction, so concurrent public requests cannot oversubscribe.
        sqlx::query("SELECT pg_catalog.pg_advisory_xact_lock(9026020002)")
            .execute(&mut *tx)
            .await
            .map_err(|_| IdentityError::Unavailable)?;
        let cutoff: i64 =
            sqlx::query_scalar("SELECT extract(epoch FROM statement_timestamp())::bigint")
                .fetch_one(&mut *tx)
                .await
                .map_err(|_| IdentityError::Unavailable)?;
        sqlx::query(LOGIN_EXPIRY_CLEANUP_SQL)
            .bind(cutoff)
            .bind(EXPIRY_CLEANUP_BATCH)
            .execute(&mut *tx)
            .await
            .map_err(|_| IdentityError::Unavailable)?;
        // Limit the count even if an owner imported an oversized backlog.
        let outstanding: i64 = sqlx::query_scalar("SELECT count(*) FROM (SELECT 1 FROM public.login_attempts WHERE expires_at > $1 LIMIT $2) outstanding")
            .bind(cutoff).bind(LOGIN_CAPACITY).fetch_one(&mut *tx).await.map_err(|_| IdentityError::Unavailable)?;
        if outstanding >= LOGIN_CAPACITY {
            tx.commit().await.map_err(|_| IdentityError::Unavailable)?;
            return Err(IdentityError::Capacity);
        }
        sqlx::query("INSERT INTO public.login_attempts(state_hash,browser_hash,nonce,pkce_verifier,expires_at) VALUES($1,$2,$3,$4,$5)")
            .bind(secret_hash(state)).bind(secret_hash(browser_binding)).bind(nonce).bind(verifier).bind(cutoff + LOGIN_SECONDS)
            .execute(&mut *tx).await.map_err(|_| IdentityError::Unavailable)?;
        tx.commit().await.map_err(|_| IdentityError::Unavailable)
    }

    /// Only a matching state AND browser binding consume an attempt. Unrelated
    /// callbacks leave another in-flight login intact. The single DELETE commits
    /// before contacting the IdP; even an expired matched attempt is consumed.
    pub async fn consume_login(
        &self,
        state: &str,
        browser_binding: &str,
    ) -> Result<LoginAttempt, IdentityError> {
        if !valid_secret(state) || !valid_secret(browser_binding) {
            return Err(IdentityError::InvalidResponse);
        }
        let row: Option<(String, String, bool)> = sqlx::query_as("DELETE FROM public.login_attempts WHERE state_hash=$1 AND browser_hash=$2 RETURNING nonce,pkce_verifier,expires_at>extract(epoch FROM statement_timestamp())::bigint")
            .bind(secret_hash(state)).bind(secret_hash(browser_binding)).fetch_optional(&self.pool).await.map_err(|_| IdentityError::Unavailable)?;
        match row {
            Some((nonce, pkce_verifier, true)) => Ok(LoginAttempt {
                nonce,
                pkce_verifier,
            }),
            Some((_, _, false)) => Err(IdentityError::ExpiredLoginConsumed),
            None => Err(IdentityError::InvalidResponse),
        }
    }

    pub async fn establish_session(
        &self,
        issuer: &str,
        subject: &str,
        display_name: &str,
        previous_token: Option<&str>,
    ) -> Result<String, IdentityError> {
        if issuer.len() > 2048
            || subject.is_empty()
            || subject.len() > 255
            || display_name.len() > 256
        {
            return Err(IdentityError::InvalidResponse);
        }
        let token = random_secret()?;
        let actor_id = random_secret()?;
        let csrf = random_secret()?;
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|_| IdentityError::Unavailable)?;
        let (id, active): (String, bool) = sqlx::query_as("INSERT INTO public.identities(id,issuer,subject,display_name) VALUES($1,$2,$3,$4) ON CONFLICT(issuer,subject) DO UPDATE SET display_name=EXCLUDED.display_name RETURNING id,active")
            .bind(actor_id).bind(issuer).bind(subject).bind(display_name)
            .fetch_one(&mut *tx).await.map_err(|_| IdentityError::Unavailable)?;
        if !active {
            return Err(IdentityError::Unauthenticated);
        }
        if let Some(previous) = previous_token {
            sqlx::query("DELETE FROM public.sessions WHERE token_hash=$1")
                .bind(secret_hash(previous))
                .execute(&mut *tx)
                .await
                .map_err(|_| IdentityError::Unavailable)?;
        }
        let cutoff: i64 =
            sqlx::query_scalar("SELECT extract(epoch FROM statement_timestamp())::bigint")
                .fetch_one(&mut *tx)
                .await
                .map_err(|_| IdentityError::Unavailable)?;
        sqlx::query(SESSION_EXPIRY_CLEANUP_SQL)
            .bind(cutoff)
            .bind(EXPIRY_CLEANUP_BATCH)
            .execute(&mut *tx)
            .await
            .map_err(|_| IdentityError::Unavailable)?;
        sqlx::query("INSERT INTO public.sessions(token_hash,actor_id,csrf_token,expires_at) VALUES($1,$2,$3,$4)")
            .bind(secret_hash(&token)).bind(id).bind(csrf).bind(cutoff + SESSION_SECONDS)
            .execute(&mut *tx).await.map_err(|_| IdentityError::Unavailable)?;
        tx.commit().await.map_err(|_| IdentityError::Unavailable)?;
        Ok(token)
    }

    pub async fn logout(&self, token: &str) -> Result<(), IdentityError> {
        sqlx::query("DELETE FROM public.sessions WHERE token_hash=$1")
            .bind(secret_hash(token))
            .execute(&self.pool)
            .await
            .map_err(|_| IdentityError::Unavailable)?;
        Ok(())
    }
}

type EngagementRow = (String, String, String, String, String, String, Vec<String>);

fn engagement_from_row(row: EngagementRow) -> Engagement {
    Engagement {
        scope: Scope {
            organisation_id: row.0,
            client_id: row.2,
            engagement_id: row.4,
        },
        organisation_name: row.1,
        client_name: row.3,
        engagement_name: row.5,
        roles: row
            .6
            .iter()
            .filter_map(|value| AuditRole::parse(value))
            .collect(),
    }
}

const ENGAGEMENT_SELECT: &str = "SELECT e.organisation_id,o.name,e.client_id,c.name,e.id,e.name,m.roles FROM public.engagements e JOIN public.clients c ON(c.organisation_id,c.id)=(e.organisation_id,e.client_id) JOIN public.organisations o ON o.id=e.organisation_id JOIN public.organisation_memberships m ON m.organisation_id=e.organisation_id AND m.actor_id=$1 JOIN public.engagement_assignments a ON(a.organisation_id,a.client_id,a.engagement_id,a.actor_id)=(e.organisation_id,e.client_id,e.id,$1) WHERE m.active AND(m.expires_at IS NULL OR m.expires_at>extract(epoch FROM clock_timestamp())::bigint) AND m.roles && ARRAY['auditor','audit_manager']::text[] AND a.active AND(a.expires_at IS NULL OR a.expires_at>extract(epoch FROM clock_timestamp())::bigint)";

impl CurrentAuthority for IdentityRepository {
    async fn session(&self, token: &str) -> Result<CurrentSession, IdentityError> {
        if !valid_secret(token) {
            return Err(IdentityError::Unauthenticated);
        }
        let row: Option<(String,String,String)> = sqlx::query_as("SELECT i.id,i.display_name,s.csrf_token FROM public.sessions s JOIN public.identities i ON i.id=s.actor_id WHERE s.token_hash=$1 AND s.expires_at>extract(epoch FROM clock_timestamp())::bigint AND i.active")
            .bind(secret_hash(token)).fetch_optional(&self.pool).await.map_err(|_| IdentityError::Unavailable)?;
        match row {
            Some((id, display_name, csrf_token)) => Ok(CurrentSession {
                identity: Identity { id, display_name },
                csrf_token,
            }),
            None => {
                self.logout(token).await?;
                Err(IdentityError::Unauthenticated)
            }
        }
    }

    async fn engagements(
        &self,
        actor_id: &str,
        after: Option<&Scope>,
    ) -> Result<EngagementPage, IdentityError> {
        if after.is_some_and(|cursor| !cursor.is_valid()) {
            return Err(IdentityError::Denied);
        }
        let mut tx = scope::begin_actor(&self.pool, actor_id)
            .await
            .map_err(scope_error)?;
        let mut query = ENGAGEMENT_SELECT.to_owned();
        if after.is_some() {
            query.push_str(r#" AND(e.organisation_id COLLATE "C",e.client_id COLLATE "C",e.id COLLATE "C")>($2,$3,$4)"#);
        }
        query.push_str(r#" ORDER BY e.organisation_id COLLATE "C",e.client_id COLLATE "C",e.id COLLATE "C" LIMIT 51"#);
        let mut bound = sqlx::query_as::<_, EngagementRow>(&query).bind(actor_id);
        if let Some(after) = after {
            bound = bound
                .bind(&after.organisation_id)
                .bind(&after.client_id)
                .bind(&after.engagement_id);
        }
        let mut rows = bound
            .fetch_all(&mut *tx)
            .await
            .map_err(|_| IdentityError::Unavailable)?;
        let has_more = rows.len() > ENGAGEMENT_PAGE_SIZE;
        rows.truncate(ENGAGEMENT_PAGE_SIZE);
        let engagements: Vec<_> = rows.into_iter().map(engagement_from_row).collect();
        let next_cursor = has_more.then(|| engagements.last().expect("a full page").scope.clone());
        tx.commit().await.map_err(|_| IdentityError::Unavailable)?;
        Ok(EngagementPage {
            engagements,
            next_cursor,
        })
    }

    async fn engagement(
        &self,
        actor_id: &str,
        selected: &Scope,
    ) -> Result<Engagement, IdentityError> {
        let mut tx = scope::begin(&self.pool, actor_id, selected)
            .await
            .map_err(scope_error)?;
        let row: Option<EngagementRow> = sqlx::query_as(&format!(
            "{ENGAGEMENT_SELECT} AND(e.organisation_id,e.client_id,e.id)=($2,$3,$4)"
        ))
        .bind(actor_id)
        .bind(&selected.organisation_id)
        .bind(&selected.client_id)
        .bind(&selected.engagement_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|_| IdentityError::Unavailable)?;
        tx.commit().await.map_err(|_| IdentityError::Unavailable)?;
        row.map(engagement_from_row).ok_or(IdentityError::Denied)
    }
}

fn scope_error(error: scope::ScopeError) -> IdentityError {
    match error {
        scope::ScopeError::Denied => IdentityError::Denied,
        scope::ScopeError::Unavailable => IdentityError::Unavailable,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn random_tokens_are_opaque_distinct_and_hashes_do_not_store_the_secret() {
        let left = random_secret().unwrap();
        let right = random_secret().unwrap();
        assert!(valid_secret(&left));
        assert!(valid_secret(&right));
        assert_ne!(left, right);
        assert_ne!(secret_hash(&left), left);
        assert!(secret_matches(&left, &left));
        assert!(!secret_matches(&left, &right));
    }
}
