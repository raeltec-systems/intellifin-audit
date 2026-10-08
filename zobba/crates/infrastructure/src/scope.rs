//! Every repository operation retains this transaction; it never reacquires a pool connection.
use sqlx::{PgPool, Postgres, Transaction};
use zobba_domain::identity::Scope;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ScopeError {
    Denied,
    Unavailable,
}

/// Chooser reads expose only the verified actor's current audit assignments.
pub async fn begin_actor(
    pool: &PgPool,
    actor_id: &str,
) -> Result<Transaction<'static, Postgres>, ScopeError> {
    if actor_id.is_empty() {
        return Err(ScopeError::Denied);
    }
    let mut tx = pool.begin().await.map_err(|_| ScopeError::Unavailable)?;
    // Authority must refresh after waiting for a membership/engagement fence,
    // even when a deployment changes its default transaction isolation level.
    sqlx::query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED")
        .execute(&mut *tx)
        .await
        .map_err(|_| ScopeError::Unavailable)?;
    sqlx::query("SELECT pg_catalog.set_config('zobba.actor_id',$1,true), pg_catalog.set_config('zobba.organisation_id','',true), pg_catalog.set_config('zobba.client_id','',true), pg_catalog.set_config('zobba.engagement_id','',true), pg_catalog.set_config('zobba.dispatcher','',true), pg_catalog.set_config('zobba.receipt_claim','',true), pg_catalog.set_config('zobba.receipt_hash','',true), pg_catalog.set_config('zobba.receipt_org','',true), pg_catalog.set_config('zobba.receipt_client','',true), pg_catalog.set_config('zobba.receipt_engagement','',true), pg_catalog.set_config('zobba.model_invocation','',true), pg_catalog.set_config('zobba.model_receipt_hash','',true), pg_catalog.set_config('zobba.model_session_hash','',true)")
        .bind(actor_id).execute(&mut *tx).await.map_err(|_| ScopeError::Unavailable)?;
    Ok(tx)
}

/// Install the exact scope, then validate current authority in the SAME transaction.
/// RLS rechecks membership for each statement, including after concurrent revocation.
pub async fn begin(
    pool: &PgPool,
    actor_id: &str,
    scope: &Scope,
) -> Result<Transaction<'static, Postgres>, ScopeError> {
    if [
        &scope.organisation_id,
        &scope.client_id,
        &scope.engagement_id,
    ]
    .iter()
    .any(|id| id.is_empty())
    {
        return Err(ScopeError::Denied);
    }
    let mut tx = begin_actor(pool, actor_id).await?;
    sqlx::query("SELECT pg_catalog.set_config('zobba.organisation_id',$1,true), pg_catalog.set_config('zobba.client_id',$2,true), pg_catalog.set_config('zobba.engagement_id',$3,true)")
        .bind(&scope.organisation_id).bind(&scope.client_id).bind(&scope.engagement_id)
        .execute(&mut *tx).await.map_err(|_| ScopeError::Unavailable)?;
    let allowed: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM public.engagements WHERE organisation_id=$1 AND client_id=$2 AND id=$3)")
        .bind(&scope.organisation_id).bind(&scope.client_id).bind(&scope.engagement_id)
        .fetch_one(&mut *tx).await.map_err(|_| ScopeError::Unavailable)?;
    if !allowed {
        return Err(ScopeError::Denied);
    }
    Ok(tx)
}
