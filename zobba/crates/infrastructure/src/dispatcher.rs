//! Content-free durable delivery. A delivery lease never grants Task authority.
use sqlx::{PgPool, Row};
use zobba_application::task::TaskError;
use zobba_domain::identity::{Scope, valid_scope_id};

use zobba_application::task::TaskDelivery;
pub use zobba_domain::task::{
    ClaimBasis, ConsumedAttempt, Decision, MAX_DELIVERY_BATCH, Observation, WakeupRoute,
};

#[derive(Clone)]
pub struct Dispatcher {
    pool: PgPool,
}

impl Dispatcher {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Only immutable routing columns escape discovery. There is deliberately
    /// no join to Tasks, commands, identities, claims or receipts here.
    pub async fn take(&self, limit: usize, worker_id: &str) -> Result<Vec<WakeupRoute>, TaskError> {
        if limit == 0 || limit > MAX_DELIVERY_BATCH || !valid_scope_id(worker_id) {
            return Err(TaskError::Unavailable);
        }
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|_| TaskError::Unavailable)?;
        clear_context(&mut tx).await?;
        let rows = sqlx::query(
            "WITH candidates AS (
                SELECT d.wakeup_id FROM public.task_deliveries d JOIN public.task_wakeups w ON w.id=d.wakeup_id
                WHERE w.pending AND w.available_at <= clock_timestamp()
                  AND (d.delivery_until IS NULL OR d.delivery_until < clock_timestamp())
                ORDER BY d.delivery_until NULLS FIRST, w.available_at, w.id LIMIT $1 FOR UPDATE OF d SKIP LOCKED
             ) UPDATE public.task_deliveries d
               SET delivery_owner=$2, delivery_until=clock_timestamp()+interval '5 seconds'
               FROM candidates c,public.task_wakeups w WHERE d.wakeup_id=c.wakeup_id AND w.id=d.wakeup_id
               RETURNING w.id,w.actor_id,w.organisation_id,w.client_id,w.engagement_id,w.task_id",
        )
        .bind(limit as i64)
        .bind(worker_id)
        .fetch_all(&mut *tx)
        .await
        .map_err(|_| TaskError::Unavailable)?;
        let routes = rows
            .into_iter()
            .map(|row| {
                Ok(WakeupRoute {
                    id: row.try_get("id").map_err(|_| TaskError::Unavailable)?,
                    actor_id: row
                        .try_get("actor_id")
                        .map_err(|_| TaskError::Unavailable)?,
                    task_id: row.try_get("task_id").map_err(|_| TaskError::Unavailable)?,
                    scope: Scope {
                        organisation_id: row
                            .try_get("organisation_id")
                            .map_err(|_| TaskError::Unavailable)?,
                        client_id: row
                            .try_get("client_id")
                            .map_err(|_| TaskError::Unavailable)?,
                        engagement_id: row
                            .try_get("engagement_id")
                            .map_err(|_| TaskError::Unavailable)?,
                    },
                })
            })
            .collect::<Result<Vec<_>, TaskError>>()?;
        tx.commit().await.map_err(|_| TaskError::Unavailable)?;
        Ok(routes)
    }

    /// A short retry delay bounds denied/unknown recovery polling. Changing
    /// pending or available_at remains the scoped coordinator's responsibility.
    pub async fn release(&self, route: &WakeupRoute, worker_id: &str) -> Result<(), TaskError> {
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|_| TaskError::Unavailable)?;
        clear_context(&mut tx).await?;
        sqlx::query("UPDATE public.task_deliveries SET delivery_owner=NULL,delivery_until=clock_timestamp()+interval '1 second' WHERE wakeup_id=$1 AND delivery_owner=$2")
            .bind(&route.id).bind(worker_id).execute(&mut *tx).await.map_err(|_| TaskError::Unavailable)?;
        tx.commit().await.map_err(|_| TaskError::Unavailable)
    }
}

async fn clear_context(tx: &mut sqlx::Transaction<'_, sqlx::Postgres>) -> Result<(), TaskError> {
    sqlx::query("SELECT set_config('zobba.actor_id','',true),set_config('zobba.organisation_id','',true),set_config('zobba.client_id','',true),set_config('zobba.engagement_id','',true),set_config('zobba.receipt_claim','',true),set_config('zobba.receipt_hash','',true),set_config('zobba.receipt_org','',true),set_config('zobba.receipt_client','',true),set_config('zobba.receipt_engagement','',true),set_config('zobba.dispatcher','on',true)")
        .execute(&mut **tx).await.map_err(|_| TaskError::Unavailable)?;
    Ok(())
}

impl TaskDelivery for Dispatcher {
    async fn take(&self, limit: usize, worker_id: &str) -> Result<Vec<WakeupRoute>, TaskError> {
        Dispatcher::take(self, limit, worker_id).await
    }
    async fn release(&self, route: &WakeupRoute, worker_id: &str) -> Result<(), TaskError> {
        Dispatcher::release(self, route, worker_id).await
    }
}
