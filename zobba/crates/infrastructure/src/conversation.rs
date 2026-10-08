//! Read projections over the existing immutable commands and events; no second
//! acceptance store. Each projection is one MVCC statement, without writer locks
//! or a transaction retained while a viewer waits. Current FORCE-RLS authority is
//! checked within that same statement, including empty conversations.
use serde::Deserialize;
use sqlx::{PgPool, Row};
use zobba_application::{conversation::ConversationRead, task::TaskError};
use zobba_domain::{
    conversation::{
        CONVERSATION_PAGE_SIZE, CONVERSATION_REPLAY_LIMIT, ConversationActivity, ConversationFeed,
        ConversationHistory, ConversationMessage, ConversationSnapshot,
    },
    identity::{Scope, valid_scope_id},
    task::{Cessation, CommandKind, TaskEvent, TaskSnapshot, TaskState},
};

use crate::scope;

#[derive(Clone)]
pub struct ConversationRepository {
    pool: PgPool,
}

impl ConversationRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

fn unavailable(_: impl std::fmt::Debug) -> TaskError {
    TaskError::Unavailable
}

// The visible anchor prevents a concurrent revocation between scope::begin and
// the projection statement from masquerading as an authorised empty response.
const ANCHOR: &str = "WITH visible AS (SELECT id FROM public.engagements WHERE organisation_id=$1 AND client_id=$2 AND id=$3), head AS (SELECT COALESCE((SELECT cursor FROM public.task_counters),0)::bigint AS watermark)";
const MESSAGES: &str = "SELECT c.id AS command_id,c.idempotency_key AS key,c.author_id,left(i.display_name,200) AS author_label,c.kind,c.task_id,c.cycle_id,c.target_task_id,c.target_cycle_id,c.content,c.methodology_context AS context,c.received_cursor::text AS received_cursor,CASE WHEN a.cursor <= COALESCE($4::bigint,(SELECT watermark FROM head)) THEN a.cursor::text END AS applied_cursor FROM (SELECT e.command_id FROM public.task_events e WHERE e.kind='received' AND e.cursor<=COALESCE($4::bigint,(SELECT watermark FROM head)) AND ($5::bigint IS NULL OR e.cursor<$5) AND ($6::text IS NULL OR e.task_id=$6) ORDER BY e.cursor DESC LIMIT 101) p JOIN public.task_commands c ON c.id=p.command_id JOIN public.identities i ON i.id=c.author_id LEFT JOIN public.task_events a ON a.command_id=c.id AND a.kind='applied' ORDER BY c.received_cursor DESC";

#[derive(Deserialize)]
struct MessageRow {
    command_id: String,
    key: String,
    author_id: String,
    author_label: String,
    kind: String,
    task_id: String,
    cycle_id: String,
    target_task_id: Option<String>,
    target_cycle_id: Option<String>,
    content: Option<String>,
    context: Option<zobba_application::methodology::TaskContext>,
    received_cursor: String,
    applied_cursor: Option<String>,
}
impl MessageRow {
    fn into_message(self) -> Result<ConversationMessage, TaskError> {
        Ok(ConversationMessage {
            command_id: self.command_id,
            key: self.key,
            author_id: self.author_id,
            author_label: self.author_label,
            kind: CommandKind::parse(&self.kind).ok_or(TaskError::Unavailable)?,
            task_id: self.task_id,
            cycle_id: self.cycle_id,
            target_task_id: self.target_task_id,
            target_cycle_id: self.target_cycle_id,
            content: self.content,
            context: self.context.map(|context| context.to_domain()),
            received_cursor: self.received_cursor,
            applied_cursor: self.applied_cursor,
        })
    }
}
#[derive(Deserialize)]
struct ActivityRow {
    cursor: String,
    task_id: String,
}
impl From<ActivityRow> for ConversationActivity {
    fn from(activity: ActivityRow) -> Self {
        Self {
            cursor: activity.cursor,
            task_id: activity.task_id,
        }
    }
}
#[derive(Deserialize)]
struct TaskRow {
    id: String,
    cycle_id: String,
    objective: String,
    working_brief: String,
    state: String,
    cessation: String,
    intent_revision: u64,
    revision: u64,
    execution_epoch: u64,
    accountable_actor: String,
    accountable_label: String,
}
impl TaskRow {
    fn into_task(self) -> Result<TaskSnapshot, TaskError> {
        Ok(TaskSnapshot {
            id: self.id,
            cycle_id: self.cycle_id,
            objective: self.objective,
            working_brief: self.working_brief,
            state: TaskState::parse(&self.state).ok_or(TaskError::Unavailable)?,
            cessation: Cessation::parse(&self.cessation).ok_or(TaskError::Unavailable)?,
            intent_revision: self.intent_revision,
            revision: self.revision,
            execution_epoch: self.execution_epoch,
            accountable_actor: self.accountable_actor,
            accountable_label: self.accountable_label,
        })
    }
}
#[derive(Deserialize)]
struct EventRow {
    cursor: String,
    task_id: String,
    cycle_id: String,
    command_id: Option<String>,
    kind: String,
}

fn messages(raw: &str) -> Result<(Vec<ConversationMessage>, Option<String>), TaskError> {
    let mut rows: Vec<MessageRow> = serde_json::from_str(raw).map_err(unavailable)?;
    let more = rows.len() > CONVERSATION_PAGE_SIZE;
    rows.truncate(CONVERSATION_PAGE_SIZE);
    let before = more.then(|| {
        rows.last()
            .expect("nonempty bounded page")
            .received_cursor
            .clone()
    });
    let mut messages = rows
        .into_iter()
        .map(MessageRow::into_message)
        .collect::<Result<Vec<_>, _>>()?;
    messages.reverse();
    Ok((messages, before))
}
async fn begin(
    pool: &PgPool,
    actor: &str,
    s: &Scope,
) -> Result<sqlx::Transaction<'static, sqlx::Postgres>, TaskError> {
    if !s.is_valid() {
        return Err(TaskError::Denied);
    }
    let mut tx = scope::begin(pool, actor, s)
        .await
        .map_err(|error| match error {
            scope::ScopeError::Denied => TaskError::Denied,
            scope::ScopeError::Unavailable => TaskError::Unavailable,
        })?;
    // Bound database work too: cancellation/disconnected HTTP cannot leave a
    // long-running projection occupying an ordinary connection indefinitely.
    sqlx::query("SET LOCAL statement_timeout = '3s'")
        .execute(&mut *tx)
        .await
        .map_err(unavailable)?;
    Ok(tx)
}
fn allowed(row: &sqlx::postgres::PgRow) -> Result<(), TaskError> {
    if row.try_get::<bool, _>("allowed").map_err(unavailable)? {
        Ok(())
    } else {
        Err(TaskError::Denied)
    }
}

impl ConversationRead for ConversationRepository {
    async fn snapshot(&self, actor: &str, s: &Scope) -> Result<ConversationSnapshot, TaskError> {
        let mut tx = begin(&self.pool, actor, s).await?;
        // Null through selects this statement's head; history binds an explicit
        // fixed cursor. Both use the same bounded immutable command projection.
        let sql = format!(
            "{ANCHOR} SELECT EXISTS(SELECT 1 FROM visible) AS allowed,head.watermark,(SELECT json_build_object('cursor',cursor::text,'task_id',task_id) FROM public.task_events WHERE kind IN ('received','applied') AND cursor<=head.watermark ORDER BY cursor DESC LIMIT 1)::text AS latest_activity,COALESCE((SELECT json_agg(m) FROM ({MESSAGES}) m),'[]')::text AS messages,COALESCE((SELECT json_agg(t) FROM (SELECT id,cycle_id,objective,working_brief,state,cessation,intent_revision,revision,execution_epoch,accountable_actor,(SELECT left(display_name,200) FROM public.identities WHERE id=tasks.accountable_actor) AS accountable_label FROM public.tasks ORDER BY id LIMIT 101) t),'[]')::text AS tasks FROM head"
        );
        let row = sqlx::query(&sql)
            .bind(&s.organisation_id)
            .bind(&s.client_id)
            .bind(&s.engagement_id)
            .bind(None::<i64>)
            .bind(None::<i64>)
            .bind(None::<&str>)
            .fetch_one(&mut *tx)
            .await
            .map_err(unavailable)?;
        allowed(&row)?;
        let watermark = row
            .try_get::<i64, _>("watermark")
            .map_err(unavailable)?
            .to_string();
        let (messages, before_cursor) =
            messages(&row.try_get::<String, _>("messages").map_err(unavailable)?)?;
        let latest_activity = row
            .try_get::<Option<String>, _>("latest_activity")
            .map_err(unavailable)?
            .map(|raw| serde_json::from_str::<ActivityRow>(&raw).map(Into::into))
            .transpose()
            .map_err(unavailable)?;
        let mut rows: Vec<TaskRow> =
            serde_json::from_str(&row.try_get::<String, _>("tasks").map_err(unavailable)?)
                .map_err(unavailable)?;
        let more = rows.len() > CONVERSATION_PAGE_SIZE;
        rows.truncate(CONVERSATION_PAGE_SIZE);
        let next_task_cursor = more.then(|| rows.last().expect("nonempty bounded page").id.clone());
        let tasks = rows
            .into_iter()
            .map(TaskRow::into_task)
            .collect::<Result<Vec<_>, _>>()?;
        tx.commit().await.map_err(unavailable)?;
        Ok(ConversationSnapshot {
            scope: s.clone(),
            watermark,
            latest_activity,
            messages,
            before_cursor,
            tasks,
            next_task_cursor,
        })
    }
    async fn history(
        &self,
        actor: &str,
        s: &Scope,
        through: u64,
        before: Option<u64>,
        task_id: Option<&str>,
    ) -> Result<ConversationHistory, TaskError> {
        let through = i64::try_from(through).map_err(|_| TaskError::Invalid)?;
        let before = before
            .map(i64::try_from)
            .transpose()
            .map_err(|_| TaskError::Invalid)?;
        if task_id.is_some_and(|id| !valid_scope_id(id)) {
            return Err(TaskError::Invalid);
        }
        let mut tx = begin(&self.pool, actor, s).await?;
        let sql = format!(
            "{ANCHOR} SELECT EXISTS(SELECT 1 FROM visible) AS allowed,head.watermark,COALESCE((SELECT json_agg(m) FROM ({MESSAGES}) m),'[]')::text AS messages FROM head"
        );
        let row = sqlx::query(&sql)
            .bind(&s.organisation_id)
            .bind(&s.client_id)
            .bind(&s.engagement_id)
            .bind(through)
            .bind(before)
            .bind(task_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(unavailable)?;
        allowed(&row)?;
        if through > row.try_get::<i64, _>("watermark").map_err(unavailable)? {
            return Err(TaskError::Conflict);
        }
        let (messages, before_cursor) =
            messages(&row.try_get::<String, _>("messages").map_err(unavailable)?)?;
        tx.commit().await.map_err(unavailable)?;
        Ok(ConversationHistory {
            scope: s.clone(),
            watermark: through.to_string(),
            messages,
            before_cursor,
        })
    }
    async fn events(
        &self,
        actor: &str,
        s: &Scope,
        after: u64,
    ) -> Result<ConversationFeed, TaskError> {
        let after_db = i64::try_from(after).map_err(|_| TaskError::Invalid)?;
        let mut tx = begin(&self.pool, actor, s).await?;
        let sql = format!(
            "{ANCHOR} SELECT EXISTS(SELECT 1 FROM visible) AS allowed,head.watermark,COALESCE((SELECT json_agg(e) FROM (SELECT cursor::text AS cursor,task_id,cycle_id,command_id,kind FROM public.task_events WHERE cursor>$4 AND (SELECT watermark FROM head)-$4 BETWEEN 0 AND $5 ORDER BY task_events.cursor LIMIT 101) e),'[]')::text AS events FROM head"
        );
        let row = sqlx::query(&sql)
            .bind(&s.organisation_id)
            .bind(&s.client_id)
            .bind(&s.engagement_id)
            .bind(after_db)
            .bind(CONVERSATION_REPLAY_LIMIT as i64)
            .fetch_one(&mut *tx)
            .await
            .map_err(unavailable)?;
        allowed(&row)?;
        let watermark = row.try_get::<i64, _>("watermark").map_err(unavailable)? as u64;
        let mut rows: Vec<EventRow> =
            serde_json::from_str(&row.try_get::<String, _>("events").map_err(unavailable)?)
                .map_err(unavailable)?;
        let mut resync_required =
            after > watermark || watermark.saturating_sub(after) > CONVERSATION_REPLAY_LIMIT;
        let mut expected = after;
        for row in &rows {
            expected += 1;
            if row.cursor.parse::<u64>().map_err(unavailable)? != expected {
                resync_required = true;
            }
        }
        if rows.len() <= CONVERSATION_PAGE_SIZE && expected != watermark {
            resync_required = true;
        }
        let has_more = !resync_required && rows.len() > CONVERSATION_PAGE_SIZE;
        rows.truncate(CONVERSATION_PAGE_SIZE);
        if resync_required {
            rows.clear();
        }
        let next_cursor = rows
            .last()
            .map_or_else(|| after.to_string(), |event| event.cursor.clone());
        let events = rows
            .into_iter()
            .map(|event| TaskEvent {
                cursor: event.cursor,
                task_id: event.task_id,
                cycle_id: event.cycle_id,
                command_id: event.command_id,
                kind: event.kind,
            })
            .collect();
        tx.commit().await.map_err(unavailable)?;
        Ok(ConversationFeed {
            scope: s.clone(),
            watermark: watermark.to_string(),
            events,
            next_cursor,
            has_more,
            resync_required,
        })
    }
}
