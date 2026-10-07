//! Conversational engagement setup (Story 22.2 AC4). Every member message is
//! committed before it is interpreted. Interpretation is deterministic and
//! server-side; client lookup and establishment are owner-mediated functions.
//! Confirmation creates the client (when new), the engagement and its period, the
//! creator's assignment and the first Task in one transaction.
use crate::{scope, task};
use rand::{RngCore, rngs::OsRng};
use serde_json::{Value, json};
use sqlx::{PgPool, Postgres, Row, Transaction, postgres::PgRow};
use zobba_application::{
    engagement_setup::{EngagementSetups, SetupError},
    task::TaskError,
};
use zobba_domain::{
    engagement_setup::{
        self as domain, ClientCandidate, Established, MAX_OPEN_SETUPS, MAX_SETUP_MESSAGES,
        MemberInput, Period, Reply, SetupAuthor, SetupFacts, SetupMessage, SetupOrganisation,
        SetupState, SetupView, Step,
    },
    identity::{Scope, valid_scope_id, valid_scope_label},
    task::{CommandKind, CommandReceipt, ReceiptStatus, TaskCommand},
};

type Tx = Transaction<'static, Postgres>;

#[derive(Clone)]
pub struct EngagementSetupRepository {
    pool: PgPool,
    session_hash: Option<String>,
}

impl EngagementSetupRepository {
    pub fn new(pool: PgPool) -> Self {
        Self {
            pool,
            session_hash: None,
        }
    }
    /// Bind the verified cookie's digest; SQL rechecks it after every authority lock.
    pub fn with_session_hash(mut self, hash: String) -> Self {
        self.session_hash = Some(hash);
        self
    }
}

fn database(error: sqlx::Error) -> SetupError {
    match &error {
        sqlx::Error::Database(failure) => match failure.code().as_deref() {
            Some("Z0001") => SetupError::Invalid,
            Some("Z0002" | "42501") => SetupError::Denied,
            Some("Z0003" | "23505") => SetupError::Conflict,
            Some("Z0006") => SetupError::DailyLimit,
            _ => SetupError::Unavailable,
        },
        _ => SetupError::Unavailable,
    }
}
fn task_error(error: TaskError) -> SetupError {
    match error {
        TaskError::Denied => SetupError::Denied,
        TaskError::Invalid => SetupError::Invalid,
        TaskError::Conflict | TaskError::Capacity | TaskError::Fenced => SetupError::Conflict,
        TaskError::Unavailable => SetupError::Unavailable,
    }
}
fn get<T>(row: &PgRow, name: &str) -> Result<T, SetupError>
where
    for<'a> T: sqlx::Decode<'a, Postgres> + sqlx::Type<Postgres>,
{
    row.try_get(name).map_err(|_| SetupError::Unavailable)
}
fn generated(prefix: &str) -> String {
    let mut bytes = [0u8; 16];
    OsRng.fill_bytes(&mut bytes);
    domain::generated_id(prefix, &bytes)
}
fn candidate(value: &Value) -> Result<ClientCandidate, SetupError> {
    let candidate = ClientCandidate {
        id: value["client_id"]
            .as_str()
            .ok_or(SetupError::Unavailable)?
            .to_owned(),
        name: value["client_name"]
            .as_str()
            .ok_or(SetupError::Unavailable)?
            .to_owned(),
    };
    if candidate.is_valid() {
        Ok(candidate)
    } else {
        Err(SetupError::Unavailable)
    }
}
fn candidates(value: &Value) -> Result<Vec<ClientCandidate>, SetupError> {
    value
        .as_array()
        .ok_or(SetupError::Unavailable)?
        .iter()
        .map(candidate)
        .collect()
}
fn candidates_json(values: &[ClientCandidate]) -> Value {
    Value::Array(
        values
            .iter()
            .map(|c| json!({"client_id": c.id, "client_name": c.name}))
            .collect(),
    )
}

const SETUP_COLUMNS: &str = "id,organisation_id,idempotency_key,objective,state,candidates,resolved_client_id,resolved_client_name,new_client_name,to_char(period_start,'YYYY-MM-DD') AS period_start,to_char(period_end,'YYYY-MM-DD') AS period_end,receipt,message_count";

fn facts(row: &PgRow) -> Result<SetupFacts, SetupError> {
    let state = SetupState::parse(&get::<String>(row, "state")?).ok_or(SetupError::Unavailable)?;
    let client = match (
        get::<Option<String>>(row, "resolved_client_id")?,
        get::<Option<String>>(row, "resolved_client_name")?,
    ) {
        (Some(id), Some(name)) => Some(ClientCandidate { id, name }),
        (None, None) => None,
        _ => return Err(SetupError::Unavailable),
    };
    let period = match (
        get::<Option<String>>(row, "period_start")?,
        get::<Option<String>>(row, "period_end")?,
    ) {
        (Some(start), Some(end)) => Some(Period { start, end }),
        (None, None) => None,
        _ => return Err(SetupError::Unavailable),
    };
    Ok(SetupFacts {
        state,
        candidates: candidates(&get::<Value>(row, "candidates")?)?,
        client,
        new_client_name: get(row, "new_client_name")?,
        period,
    })
}

fn established(receipt: &Value) -> Result<Established, SetupError> {
    let text = |name: &str| {
        receipt[name]
            .as_str()
            .map(str::to_owned)
            .ok_or(SetupError::Unavailable)
    };
    Ok(Established {
        scope: Scope {
            organisation_id: text("organisation_id")?,
            client_id: text("client_id")?,
            engagement_id: text("engagement_id")?,
        },
        engagement_name: text("engagement_name")?,
        receipt: CommandReceipt {
            command_id: text("command_id")?,
            task_id: text("task_id")?,
            cycle_id: text("cycle_id")?,
            event_cursor: text("event_cursor")?,
            status: ReceiptStatus::Received,
        },
    })
}

fn member_input(kind: &str, content: &str, payload: &Value) -> Result<MemberInput, SetupError> {
    Ok(match kind {
        "objective" => MemberInput::Objective(content.to_owned()),
        "text" => MemberInput::Text(content.to_owned()),
        "choose_client" => MemberInput::ChooseClient(
            payload["client_id"]
                .as_str()
                .ok_or(SetupError::Unavailable)?
                .to_owned(),
        ),
        "new_client" => {
            MemberInput::NewClient(payload["accept"].as_bool().ok_or(SetupError::Unavailable)?)
        }
        "confirm" => MemberInput::Confirm,
        "cancel" => MemberInput::Cancel,
        _ => return Err(SetupError::Unavailable),
    })
}
fn member_payload(input: &MemberInput) -> Value {
    match input {
        MemberInput::ChooseClient(id) => json!({ "client_id": id }),
        MemberInput::NewClient(accept) => json!({ "accept": accept }),
        _ => json!({}),
    }
}
fn reply_payload(reply: &Reply) -> Value {
    let mut payload = serde_json::Map::new();
    if let Some(prompt) = reply.prompt() {
        payload.insert("prompt".into(), json!(prompt));
    }
    match reply {
        Reply::ChooseClient(list) => {
            payload.insert("candidates".into(), candidates_json(list));
        }
        Reply::ProposeNewClient(name) => {
            payload.insert("client_name".into(), json!(name));
        }
        Reply::Refused(refusal) => {
            payload.insert("refusal".into(), json!(refusal.code()));
        }
        _ => {}
    }
    Value::Object(payload)
}

impl EngagementSetupRepository {
    fn hash(&self) -> Result<&str, SetupError> {
        self.session_hash.as_deref().ok_or(SetupError::Denied)
    }
    /// The exact session (locked against logout) and a current audit membership.
    /// Admin alone is not authority: the membership policy admits only
    /// auditor/audit_manager roles of an active identity.
    async fn begin(&self, actor: &str, organisation: &str) -> Result<Tx, SetupError> {
        if !valid_scope_id(actor) || !valid_scope_id(organisation) {
            return Err(SetupError::Denied);
        }
        let hash = self.hash()?;
        let mut tx = scope::begin_actor(&self.pool, actor)
            .await
            .map_err(|error| match error {
                scope::ScopeError::Denied => SetupError::Denied,
                scope::ScopeError::Unavailable => SetupError::Unavailable,
            })?;
        let allowed: bool = sqlx::query_scalar("SELECT public.evidence_session_locked($1,$2) AND EXISTS(SELECT 1 FROM public.organisation_memberships WHERE organisation_id=$3 AND actor_id=$1)")
            .bind(actor).bind(hash).bind(organisation).fetch_one(&mut *tx).await.map_err(database)?;
        if allowed {
            Ok(tx)
        } else {
            Err(SetupError::Denied)
        }
    }

    async fn lock_setup(
        tx: &mut Tx,
        actor: &str,
        organisation: &str,
        setup: &str,
    ) -> Result<PgRow, SetupError> {
        if !valid_scope_id(setup) {
            return Err(SetupError::Denied);
        }
        sqlx::query(&format!("SELECT {SETUP_COLUMNS} FROM public.engagement_setups WHERE id=$1 AND organisation_id=$2 AND actor_id=$3 FOR UPDATE"))
            .bind(setup).bind(organisation).bind(actor)
            .fetch_optional(&mut **tx).await.map_err(database)?.ok_or(SetupError::Denied)
    }

    async fn view(
        tx: &mut Tx,
        actor: &str,
        organisation: &str,
        setup: &str,
    ) -> Result<SetupView, SetupError> {
        let row = sqlx::query(&format!("SELECT {SETUP_COLUMNS} FROM public.engagement_setups WHERE id=$1 AND organisation_id=$2 AND actor_id=$3"))
            .bind(setup).bind(organisation).bind(actor)
            .fetch_optional(&mut **tx).await.map_err(database)?.ok_or(SetupError::Denied)?;
        let rows = sqlx::query("SELECT ordinal,author,kind,content,payload,reply_to FROM public.engagement_setup_messages WHERE setup_id=$1 ORDER BY ordinal LIMIT 200")
            .bind(setup).fetch_all(&mut **tx).await.map_err(database)?;
        let mut messages = Vec::with_capacity(rows.len());
        for row in &rows {
            let payload: Value = get(row, "payload")?;
            messages.push(SetupMessage {
                ordinal: get::<i32>(row, "ordinal")? as u32,
                author: match get::<String>(row, "author")?.as_str() {
                    "member" => SetupAuthor::Member,
                    "zobba" => SetupAuthor::Zobba,
                    _ => return Err(SetupError::Unavailable),
                },
                kind: get(row, "kind")?,
                content: get(row, "content")?,
                reply_to: get::<Option<i32>>(row, "reply_to")?.map(|value| value as u32),
                prompt: payload["prompt"].as_str().map(str::to_owned),
                candidates: match payload.get("candidates") {
                    Some(list) => candidates(list)?,
                    None => Vec::new(),
                },
                refusal: payload["refusal"].as_str().map(str::to_owned),
            });
        }
        let receipt: Option<Value> = get(&row, "receipt")?;
        Ok(SetupView {
            id: get(&row, "id")?,
            organisation_id: get(&row, "organisation_id")?,
            key: get(&row, "idempotency_key")?,
            objective: get(&row, "objective")?,
            facts: facts(&row)?,
            established: receipt.as_ref().map(established).transpose()?,
            messages,
        })
    }

    #[allow(clippy::too_many_arguments)]
    async fn insert_message(
        tx: &mut Tx,
        organisation: &str,
        actor: &str,
        setup: &str,
        ordinal: i32,
        key: Option<&str>,
        kind: &str,
        content: &str,
        payload: &Value,
        reply_to: Option<i32>,
    ) -> Result<(), SetupError> {
        let author = if key.is_some() { "member" } else { "zobba" };
        sqlx::query("INSERT INTO public.engagement_setup_messages(organisation_id,setup_id,actor_id,ordinal,author,idempotency_key,kind,content,payload,reply_to) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)")
            .bind(organisation).bind(setup).bind(actor).bind(ordinal).bind(author).bind(key).bind(kind).bind(content).bind(payload).bind(reply_to)
            .execute(&mut **tx).await.map_err(database)?;
        sqlx::query(
            "UPDATE public.engagement_setups SET message_count=message_count+1 WHERE id=$1",
        )
        .bind(setup)
        .execute(&mut **tx)
        .await
        .map_err(database)?;
        Ok(())
    }

    async fn store(tx: &mut Tx, setup: &str, facts: &SetupFacts) -> Result<(), SetupError> {
        let (client_id, client_name) = match &facts.client {
            Some(client) => (Some(client.id.as_str()), Some(client.name.as_str())),
            None => (None, None),
        };
        sqlx::query("UPDATE public.engagement_setups SET state=$2,candidates=$3,resolved_client_id=$4,resolved_client_name=$5,new_client_name=$6,period_start=$7::date,period_end=$8::date WHERE id=$1")
            .bind(setup).bind(facts.state.as_str()).bind(candidates_json(&facts.candidates)).bind(client_id).bind(client_name)
            .bind(facts.new_client_name.as_deref()).bind(facts.period.as_ref().map(|p| p.start.as_str())).bind(facts.period.as_ref().map(|p| p.end.as_str()))
            .execute(&mut **tx).await.map_err(database)?;
        Ok(())
    }

    async fn lookup(
        &self,
        tx: &mut Tx,
        actor: &str,
        organisation: &str,
        name: &str,
    ) -> Result<Vec<ClientCandidate>, SetupError> {
        let value: Value =
            sqlx::query_scalar("SELECT public.engagement_setup_clients($1,$2,$3,$4)")
                .bind(actor)
                .bind(self.hash()?)
                .bind(organisation)
                .bind(name)
                .fetch_one(&mut **tx)
                .await
                .map_err(database)?;
        candidates(&value)
    }

    /// Answer every committed member message that has no reply yet, in order.
    /// Confirmation messages are answered only by the establishing transaction.
    async fn answer(
        &self,
        actor: &str,
        organisation: &str,
        setup: &str,
    ) -> Result<SetupView, SetupError> {
        let mut tx = self.begin(actor, organisation).await?;
        let row = Self::lock_setup(&mut tx, actor, organisation, setup).await?;
        let mut facts = facts(&row)?;
        let mut count = get::<i32>(&row, "message_count")?;
        let pending = sqlx::query("SELECT m.ordinal,m.kind,m.content,m.payload FROM public.engagement_setup_messages m WHERE m.setup_id=$1 AND m.author='member' AND m.kind<>'confirm' AND NOT EXISTS(SELECT 1 FROM public.engagement_setup_messages r WHERE r.setup_id=m.setup_id AND r.reply_to=m.ordinal) ORDER BY m.ordinal")
            .bind(setup).fetch_all(&mut *tx).await.map_err(database)?;
        for message in &pending {
            if !facts.state.is_open() || count as usize >= MAX_SETUP_MESSAGES {
                break;
            }
            let input = member_input(
                &get::<String>(message, "kind")?,
                &get::<String>(message, "content")?,
                &get::<Value>(message, "payload")?,
            )?;
            let mut step = domain::interpret(&facts, &input, None);
            if let Step::LookupClients(name) = &step {
                let lookup = self.lookup(&mut tx, actor, organisation, name).await?;
                step = domain::interpret(&facts, &input, Some(&lookup));
            }
            let Step::Next(next, reply) = step else {
                return Err(SetupError::Unavailable);
            };
            Self::store(&mut tx, setup, &next).await?;
            Self::insert_message(
                &mut tx,
                organisation,
                actor,
                setup,
                count,
                None,
                reply.kind(),
                &reply.text(&next),
                &reply_payload(&reply),
                Some(get::<i32>(message, "ordinal")?),
            )
            .await?;
            count += 1;
            facts = next;
        }
        let view = Self::view(&mut tx, actor, organisation, setup).await?;
        tx.commit().await.map_err(database)?;
        Ok(view)
    }

    async fn by_key(
        tx: &mut Tx,
        actor: &str,
        organisation: &str,
        key: &str,
    ) -> Result<Option<PgRow>, SetupError> {
        sqlx::query("SELECT setup_id,ordinal,kind,content,payload FROM public.engagement_setup_messages WHERE organisation_id=$1 AND actor_id=$2 AND idempotency_key=$3")
            .bind(organisation).bind(actor).bind(key).fetch_optional(&mut **tx).await.map_err(database)
    }

    async fn establish(
        &self,
        actor: &str,
        organisation: &str,
        setup: &str,
        confirm: i32,
    ) -> Result<SetupView, SetupError> {
        let hash = self.hash()?.to_owned();
        let mut tx = self.begin(actor, organisation).await?;
        let result: Value =
            sqlx::query_scalar("SELECT public.engagement_establish($1,$2,$3,$4,$5,$6)")
                .bind(actor)
                .bind(&hash)
                .bind(organisation)
                .bind(setup)
                .bind(generated("c-"))
                .bind(generated("e-"))
                .fetch_one(&mut *tx)
                .await
                .map_err(database)?;
        let text = |name: &str| {
            result[name]
                .as_str()
                .map(str::to_owned)
                .ok_or(SetupError::Unavailable)
        };
        let row = Self::lock_setup(&mut tx, actor, organisation, setup).await?;
        let count = get::<i32>(&row, "message_count")?;
        let answered: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM public.engagement_setup_messages WHERE setup_id=$1 AND reply_to=$2)")
            .bind(setup).bind(confirm).fetch_one(&mut *tx).await.map_err(database)?;
        if result["established"].as_bool() == Some(true) {
            // A concurrent confirmation won. This one returns the original receipt.
            let receipt: Value = get(&row, "receipt")?;
            let done = established(&receipt)?;
            if !answered && (count as usize) < MAX_SETUP_MESSAGES {
                Self::insert_established(
                    &mut tx,
                    organisation,
                    actor,
                    setup,
                    count,
                    confirm,
                    &done,
                )
                .await?;
            }
            let view = Self::view(&mut tx, actor, organisation, setup).await?;
            tx.commit().await.map_err(database)?;
            return Ok(view);
        }
        let scope = Scope {
            organisation_id: organisation.to_owned(),
            client_id: text("client_id")?,
            engagement_id: text("engagement_id")?,
        };
        // Enter the new scope in this transaction. The organisation advisory lock
        // is already held; the engagement row is locked in the Task order.
        sqlx::query("SELECT pg_catalog.set_config('zobba.organisation_id',$1,true), pg_catalog.set_config('zobba.client_id',$2,true), pg_catalog.set_config('zobba.engagement_id',$3,true)")
            .bind(&scope.organisation_id).bind(&scope.client_id).bind(&scope.engagement_id)
            .execute(&mut *tx).await.map_err(database)?;
        let engagement_name: Option<String> = sqlx::query_scalar("SELECT name FROM public.engagements WHERE organisation_id=$1 AND client_id=$2 AND id=$3 FOR UPDATE")
            .bind(&scope.organisation_id).bind(&scope.client_id).bind(&scope.engagement_id)
            .fetch_optional(&mut *tx).await.map_err(database)?;
        let engagement_name = engagement_name.ok_or(SetupError::Denied)?;
        let objective: String = get(&row, "objective")?;
        let command = TaskCommand {
            key: domain::task_key(setup).ok_or(SetupError::Invalid)?,
            kind: CommandKind::Create,
            task_id: None,
            cycle_id: None,
            content: Some(objective),
            context: None,
        };
        let receipt = task::admit_in(&mut tx, actor, &scope, &command)
            .await
            .map_err(task_error)?;
        task::admission_fence(&mut tx, actor, &scope, Some(&hash))
            .await
            .map_err(task_error)?;
        let done = Established {
            scope: scope.clone(),
            engagement_name,
            receipt,
        };
        let receipt_json = json!({
            "organisation_id": done.scope.organisation_id,
            "client_id": done.scope.client_id,
            "engagement_id": done.scope.engagement_id,
            "engagement_name": done.engagement_name,
            "command_id": done.receipt.command_id,
            "task_id": done.receipt.task_id,
            "cycle_id": done.receipt.cycle_id,
            "event_cursor": done.receipt.event_cursor,
        });
        sqlx::query("UPDATE public.engagement_setups SET state='established',candidates='[]'::jsonb,client_id=$2,engagement_id=$3,task_id=$4,cycle_id=$5,receipt=$6,established_at=floor(extract(epoch FROM clock_timestamp()))::bigint WHERE id=$1")
            .bind(setup).bind(&done.scope.client_id).bind(&done.scope.engagement_id).bind(&done.receipt.task_id).bind(&done.receipt.cycle_id).bind(&receipt_json)
            .execute(&mut *tx).await.map_err(database)?;
        if !answered && (count as usize) < MAX_SETUP_MESSAGES {
            Self::insert_established(&mut tx, organisation, actor, setup, count, confirm, &done)
                .await?;
        }
        let view = Self::view(&mut tx, actor, organisation, setup).await?;
        tx.commit().await.map_err(database)?;
        Ok(view)
    }

    #[allow(clippy::too_many_arguments)]
    async fn insert_established(
        tx: &mut Tx,
        organisation: &str,
        actor: &str,
        setup: &str,
        ordinal: i32,
        confirm: i32,
        done: &Established,
    ) -> Result<(), SetupError> {
        let content = format!(
            "Engagement “{}” is set up and its first Task has started. Opening the engagement conversation.",
            done.engagement_name
        );
        Self::insert_message(
            tx,
            organisation,
            actor,
            setup,
            ordinal,
            None,
            "established",
            &content,
            &json!({
                "client_id": done.scope.client_id,
                "engagement_id": done.scope.engagement_id,
                "task_id": done.receipt.task_id,
            }),
            Some(confirm),
        )
        .await
    }
}

impl EngagementSetups for EngagementSetupRepository {
    async fn organisations(&self, actor: &str) -> Result<Vec<SetupOrganisation>, SetupError> {
        if !valid_scope_id(actor) {
            return Err(SetupError::Denied);
        }
        let mut tx = scope::begin_actor(&self.pool, actor)
            .await
            .map_err(|_| SetupError::Unavailable)?;
        let value: Value =
            sqlx::query_scalar("SELECT public.engagement_setup_organisations($1,$2)")
                .bind(actor)
                .bind(self.hash()?)
                .fetch_one(&mut *tx)
                .await
                .map_err(database)?;
        tx.commit().await.map_err(database)?;
        value
            .as_array()
            .ok_or(SetupError::Unavailable)?
            .iter()
            .map(|item| {
                let organisation = SetupOrganisation {
                    id: item["organisation_id"]
                        .as_str()
                        .ok_or(SetupError::Unavailable)?
                        .to_owned(),
                    name: item["organisation_name"]
                        .as_str()
                        .ok_or(SetupError::Unavailable)?
                        .to_owned(),
                };
                if valid_scope_id(&organisation.id) && valid_scope_label(&organisation.name) {
                    Ok(organisation)
                } else {
                    Err(SetupError::Unavailable)
                }
            })
            .collect()
    }

    async fn open_setups(
        &self,
        actor: &str,
        organisation: &str,
    ) -> Result<Vec<SetupView>, SetupError> {
        let mut tx = self.begin(actor, organisation).await?;
        let ids: Vec<String> = sqlx::query_scalar("SELECT id FROM public.engagement_setups WHERE organisation_id=$1 AND actor_id=$2 AND state NOT IN ('established','cancelled') ORDER BY created_at,id LIMIT 8")
            .bind(organisation).bind(actor).fetch_all(&mut *tx).await.map_err(database)?;
        let mut views = Vec::with_capacity(ids.len());
        for id in &ids {
            views.push(Self::view(&mut tx, actor, organisation, id).await?);
        }
        tx.commit().await.map_err(database)?;
        Ok(views)
    }

    async fn open(
        &self,
        actor: &str,
        organisation: &str,
        key: &str,
        objective: &str,
    ) -> Result<SetupView, SetupError> {
        if !valid_scope_id(key) || !MemberInput::Objective(objective.to_owned()).is_valid() {
            return Err(SetupError::Invalid);
        }
        let mut tx = self.begin(actor, organisation).await?;
        // Serialize this actor's setups in the organisation for the open bound.
        sqlx::query("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1 || '/' || $2,213))")
            .bind(organisation).bind(actor).execute(&mut *tx).await.map_err(database)?;
        if let Some(existing) = Self::by_key(&mut tx, actor, organisation, key).await? {
            if get::<String>(&existing, "kind")? != "objective"
                || get::<String>(&existing, "content")? != objective
            {
                return Err(SetupError::Conflict);
            }
            let setup: String = get(&existing, "setup_id")?;
            tx.commit().await.map_err(database)?;
            return self.answer(actor, organisation, &setup).await;
        }
        let open: i64 = sqlx::query_scalar("SELECT count(*) FROM public.engagement_setups WHERE organisation_id=$1 AND actor_id=$2 AND state NOT IN ('established','cancelled')")
            .bind(organisation).bind(actor).fetch_one(&mut *tx).await.map_err(database)?;
        if open >= MAX_OPEN_SETUPS as i64 {
            return Err(SetupError::OpenLimit);
        }
        let setup = generated("s-");
        sqlx::query("INSERT INTO public.engagement_setups(organisation_id,id,actor_id,idempotency_key,objective,state) VALUES($1,$2,$3,$4,$5,'objective')")
            .bind(organisation).bind(&setup).bind(actor).bind(key).bind(objective)
            .execute(&mut *tx).await.map_err(database)?;
        Self::insert_message(
            &mut tx,
            organisation,
            actor,
            &setup,
            0,
            Some(key),
            "objective",
            objective,
            &json!({}),
            None,
        )
        .await?;
        // The objective is durable before any interpretation.
        tx.commit().await.map_err(database)?;
        self.answer(actor, organisation, &setup).await
    }

    async fn message(
        &self,
        actor: &str,
        organisation: &str,
        setup: &str,
        key: &str,
        input: &MemberInput,
    ) -> Result<SetupView, SetupError> {
        if !valid_scope_id(key)
            || !input.is_valid()
            || matches!(input, MemberInput::Objective(_) | MemberInput::Confirm)
        {
            return Err(SetupError::Invalid);
        }
        let content = input.display();
        let payload = member_payload(input);
        let mut tx = self.begin(actor, organisation).await?;
        let row = Self::lock_setup(&mut tx, actor, organisation, setup).await?;
        if let Some(existing) = Self::by_key(&mut tx, actor, organisation, key).await? {
            if get::<String>(&existing, "setup_id")? != setup
                || get::<String>(&existing, "kind")? != input.kind()
                || get::<String>(&existing, "content")? != content
                || get::<Value>(&existing, "payload")? != payload
            {
                return Err(SetupError::Conflict);
            }
            tx.commit().await.map_err(database)?;
            return self.answer(actor, organisation, setup).await;
        }
        if !facts(&row)?.state.is_open() {
            return Err(SetupError::Conflict);
        }
        let count = get::<i32>(&row, "message_count")?;
        if count as usize + 2 > MAX_SETUP_MESSAGES {
            return Err(SetupError::MessageLimit);
        }
        Self::insert_message(
            &mut tx,
            organisation,
            actor,
            setup,
            count,
            Some(key),
            input.kind(),
            &content,
            &payload,
            None,
        )
        .await?;
        tx.commit().await.map_err(database)?;
        self.answer(actor, organisation, setup).await
    }

    async fn confirm(
        &self,
        actor: &str,
        organisation: &str,
        setup: &str,
        key: &str,
    ) -> Result<SetupView, SetupError> {
        if !valid_scope_id(key) {
            return Err(SetupError::Invalid);
        }
        let mut tx = self.begin(actor, organisation).await?;
        let row = Self::lock_setup(&mut tx, actor, organisation, setup).await?;
        let state = facts(&row)?.state;
        let ordinal =
            if let Some(existing) = Self::by_key(&mut tx, actor, organisation, key).await? {
                if get::<String>(&existing, "setup_id")? != setup
                    || get::<String>(&existing, "kind")? != "confirm"
                {
                    return Err(SetupError::Conflict);
                }
                get::<i32>(&existing, "ordinal")?
            } else {
                if state == SetupState::Established {
                    // Another confirmation already won: return its original receipt.
                    let view = Self::view(&mut tx, actor, organisation, setup).await?;
                    tx.commit().await.map_err(database)?;
                    return Ok(view);
                }
                if state != SetupState::Confirm {
                    return Err(SetupError::Conflict);
                }
                let count = get::<i32>(&row, "message_count")?;
                if count as usize + 2 > MAX_SETUP_MESSAGES {
                    return Err(SetupError::MessageLimit);
                }
                Self::insert_message(
                    &mut tx,
                    organisation,
                    actor,
                    setup,
                    count,
                    Some(key),
                    "confirm",
                    &MemberInput::Confirm.display(),
                    &json!({}),
                    None,
                )
                .await?;
                count
            };
        if state == SetupState::Established {
            let view = Self::view(&mut tx, actor, organisation, setup).await?;
            tx.commit().await.map_err(database)?;
            return Ok(view);
        }
        // The confirmation is durable before the establishing transaction.
        tx.commit().await.map_err(database)?;
        self.establish(actor, organisation, setup, ordinal).await
    }

    async fn get(
        &self,
        actor: &str,
        organisation: &str,
        setup: &str,
    ) -> Result<SetupView, SetupError> {
        if !valid_scope_id(setup) {
            return Err(SetupError::Denied);
        }
        let mut tx = self.begin(actor, organisation).await?;
        let view = Self::view(&mut tx, actor, organisation, setup).await?;
        tx.commit().await.map_err(database)?;
        Ok(view)
    }
}
