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
        self as domain, CANCEL_RESERVE, ClientCandidate, ClientResolution, Established,
        MAX_CLIENT_CANDIDATES, MAX_ESTABLISHED_PER_DAY, MAX_OPEN_SETUPS, MAX_SETUP_MESSAGES,
        MemberInput, ORGANISATION_PAGE, OrganisationPage, Period, Refusal, Reply, SetupAuthor,
        SetupFacts, SetupMessage, SetupOrganisation, SetupState, SetupView, Step,
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
        "change_client" => MemberInput::ChangeClient,
        "change_period" => MemberInput::ChangePeriod,
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
        Reply::ChooseClient(list) | Reply::ClientNowExists(list) => {
            payload.insert("candidates".into(), candidates_json(list));
        }
        Reply::Summary { duplicate: true } => {
            payload.insert("duplicate".into(), json!(true));
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

/// Why an establishing attempt failed, and the refusal to retain for its
/// confirmation when the failure is definite.
struct Failure {
    error: SetupError,
    refusal: Option<Refusal>,
}
impl From<SetupError> for Failure {
    fn from(error: SetupError) -> Self {
        Self {
            error,
            refusal: None,
        }
    }
}
fn definite(error: sqlx::Error) -> Failure {
    // A database refusal before commit is definite: nothing was created.
    let refusal_is_definite = matches!(error, sqlx::Error::Database(_));
    match database(error) {
        SetupError::Denied => Failure {
            error: SetupError::Denied,
            refusal: Some(Refusal::ConfirmDenied),
        },
        _ if refusal_is_definite => Failure {
            error: SetupError::ConfirmFailed,
            refusal: Some(Refusal::ConfirmFailed),
        },
        other => other.into(),
    }
}

/// The error a retained confirmation refusal repeats on replay.
fn refused(code: &str) -> SetupError {
    match Refusal::parse(code) {
        Some(Refusal::ConfirmDenied) => SetupError::Denied,
        Some(Refusal::DailyLimit) => SetupError::DailyLimit,
        Some(Refusal::ConfirmFailed) => SetupError::ConfirmFailed,
        _ => SetupError::Conflict,
    }
}

/// Room for one more member message and its reply. Each unanswered member
/// message already holds a reply slot, and ordinary messages leave
/// [`CANCEL_RESERVE`] slots so a full setup can always be cancelled.
fn has_room(count: i32, unanswered: i64, cancel: bool) -> bool {
    let reserve = if cancel { 0 } else { CANCEL_RESERVE };
    (count as i64) + unanswered + 2 + reserve as i64 <= MAX_SETUP_MESSAGES as i64
}

impl EngagementSetupRepository {
    fn hash(&self) -> Result<&str, SetupError> {
        self.session_hash.as_deref().ok_or(SetupError::Denied)
    }

    /// Every route: the exact session (locked against logout), an active identity
    /// and an active, unexpired auditor or audit manager membership. Admin alone
    /// is not authority. A writer first takes organisation lock 205, so revocation,
    /// expiry and role changes are decided under the lock.
    async fn begin(&self, actor: &str, organisation: &str, writer: bool) -> Result<Tx, SetupError> {
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
        sqlx::query_scalar::<_, bool>("SELECT public.engagement_setup_access($1,$2,$3,$4)")
            .bind(actor)
            .bind(hash)
            .bind(organisation)
            .bind(writer)
            .fetch_one(&mut *tx)
            .await
            .map_err(database)?;
        Ok(tx)
    }

    async fn lock_setup(
        tx: &mut Tx,
        actor: &str,
        organisation: &str,
        setup: &str,
    ) -> Result<PgRow, SetupError> {
        if !valid_scope_id(setup) {
            return Err(SetupError::NotFound);
        }
        sqlx::query(&format!("SELECT {SETUP_COLUMNS} FROM public.engagement_setups WHERE id=$1 AND organisation_id=$2 AND actor_id=$3 FOR UPDATE"))
            .bind(setup).bind(organisation).bind(actor)
            .fetch_optional(&mut **tx).await.map_err(database)?.ok_or(SetupError::NotFound)
    }

    async fn view(
        tx: &mut Tx,
        actor: &str,
        organisation: &str,
        setup: &str,
    ) -> Result<SetupView, SetupError> {
        if !valid_scope_id(setup) {
            return Err(SetupError::NotFound);
        }
        let row = sqlx::query(&format!("SELECT {SETUP_COLUMNS} FROM public.engagement_setups WHERE id=$1 AND organisation_id=$2 AND actor_id=$3"))
            .bind(setup).bind(organisation).bind(actor)
            .fetch_optional(&mut **tx).await.map_err(database)?.ok_or(SetupError::NotFound)?;
        let rows = sqlx::query("SELECT ordinal,author,kind,content,payload,reply_to FROM public.engagement_setup_messages WHERE setup_id=$1 ORDER BY ordinal LIMIT $2")
            .bind(setup).bind(MAX_SETUP_MESSAGES as i64).fetch_all(&mut **tx).await.map_err(database)?;
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

    #[allow(clippy::too_many_arguments)]
    async fn insert_reply(
        tx: &mut Tx,
        organisation: &str,
        actor: &str,
        setup: &str,
        ordinal: i32,
        reply_to: i32,
        reply: &Reply,
        facts: &SetupFacts,
    ) -> Result<(), SetupError> {
        Self::insert_message(
            tx,
            organisation,
            actor,
            setup,
            ordinal,
            None,
            reply.kind(),
            &reply.text(facts),
            &reply_payload(reply),
            Some(reply_to),
        )
        .await
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
            sqlx::query_scalar("SELECT public.engagement_setup_clients($1,$2,$3,$4,$5)")
                .bind(actor)
                .bind(self.hash()?)
                .bind(organisation)
                .bind(name)
                .bind((MAX_CLIENT_CANDIDATES + 1) as i32)
                .fetch_one(&mut **tx)
                .await
                .map_err(database)?;
        candidates(&value)
    }

    /// A summary says when this client already has an engagement for exactly
    /// this period. Confirmation is still allowed.
    async fn with_duplicate(
        &self,
        tx: &mut Tx,
        actor: &str,
        organisation: &str,
        facts: &SetupFacts,
        reply: Reply,
    ) -> Result<Reply, SetupError> {
        let (Reply::Summary { .. }, Some(client), Some(period)) =
            (&reply, &facts.client, &facts.period)
        else {
            return Ok(reply);
        };
        let duplicate: bool = sqlx::query_scalar(
            "SELECT public.engagement_setup_duplicate($1,$2,$3,$4,$5::date,$6::date)",
        )
        .bind(actor)
        .bind(self.hash()?)
        .bind(organisation)
        .bind(&client.id)
        .bind(&period.start)
        .bind(&period.end)
        .fetch_one(&mut **tx)
        .await
        .map_err(database)?;
        Ok(Reply::Summary { duplicate })
    }

    async fn unanswered(tx: &mut Tx, setup: &str) -> Result<i64, SetupError> {
        sqlx::query_scalar("SELECT count(*) FROM public.engagement_setup_messages m WHERE m.setup_id=$1 AND m.author='member' AND NOT EXISTS(SELECT 1 FROM public.engagement_setup_messages r WHERE r.setup_id=m.setup_id AND r.reply_to=m.ordinal)")
            .bind(setup).fetch_one(&mut **tx).await.map_err(database)
    }

    /// Whether a read must first answer a committed member message. A pending
    /// confirmation of an open setup is left to its own key's replay.
    async fn needs_answer(tx: &mut Tx, setup: &str) -> Result<bool, SetupError> {
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM public.engagement_setup_messages m JOIN public.engagement_setups s ON s.id=m.setup_id WHERE m.setup_id=$1 AND m.author='member' AND (m.kind<>'confirm' OR s.state IN ('established','cancelled')) AND NOT EXISTS(SELECT 1 FROM public.engagement_setup_messages r WHERE r.setup_id=m.setup_id AND r.reply_to=m.ordinal))")
            .bind(setup).fetch_one(&mut **tx).await.map_err(database)
    }

    async fn reply_of(tx: &mut Tx, setup: &str, ordinal: i32) -> Result<Option<PgRow>, SetupError> {
        sqlx::query("SELECT kind,payload FROM public.engagement_setup_messages WHERE setup_id=$1 AND reply_to=$2")
            .bind(setup).bind(ordinal).fetch_optional(&mut **tx).await.map_err(database)
    }

    /// Answer every committed member message that has no reply yet, in order.
    /// A confirmation of an open setup is answered only by its establishing
    /// transaction; once the setup is closed it is answered here.
    async fn answer(
        &self,
        actor: &str,
        organisation: &str,
        setup: &str,
    ) -> Result<SetupView, SetupError> {
        let mut tx = self.begin(actor, organisation, true).await?;
        let row = Self::lock_setup(&mut tx, actor, organisation, setup).await?;
        let mut facts = facts(&row)?;
        let mut count = get::<i32>(&row, "message_count")?;
        let pending = sqlx::query("SELECT m.ordinal,m.kind,m.content,m.payload FROM public.engagement_setup_messages m WHERE m.setup_id=$1 AND m.author='member' AND NOT EXISTS(SELECT 1 FROM public.engagement_setup_messages r WHERE r.setup_id=m.setup_id AND r.reply_to=m.ordinal) ORDER BY m.ordinal")
            .bind(setup).fetch_all(&mut *tx).await.map_err(database)?;
        let receipt: Option<Value> = get(&row, "receipt")?;
        for message in &pending {
            if count as usize >= MAX_SETUP_MESSAGES {
                break;
            }
            let ordinal = get::<i32>(message, "ordinal")?;
            let kind = get::<String>(message, "kind")?;
            if kind == "confirm" {
                match (facts.state, &receipt) {
                    (SetupState::Established, Some(receipt)) => {
                        Self::insert_established(
                            &mut tx,
                            organisation,
                            actor,
                            setup,
                            count,
                            ordinal,
                            &established(receipt)?,
                            receipt["client_name"].as_str(),
                        )
                        .await?;
                    }
                    (SetupState::Cancelled, _) => {
                        Self::insert_reply(
                            &mut tx,
                            organisation,
                            actor,
                            setup,
                            count,
                            ordinal,
                            &Reply::Refused(Refusal::SetupClosed),
                            &facts,
                        )
                        .await?;
                    }
                    _ => continue,
                }
                count += 1;
                continue;
            }
            let input = member_input(
                &kind,
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
            let reply = self
                .with_duplicate(&mut tx, actor, organisation, &next, reply)
                .await?;
            Self::store(&mut tx, setup, &next).await?;
            Self::insert_reply(
                &mut tx,
                organisation,
                actor,
                setup,
                count,
                ordinal,
                &reply,
                &next,
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

    /// Retain a refusal for a confirmation whose establishing transaction failed.
    /// It needs the exact session but not current authority: it records only
    /// that nothing was created.
    async fn record_refusal(
        &self,
        actor: &str,
        organisation: &str,
        setup: &str,
        confirm: i32,
        refusal: Refusal,
    ) -> Result<(), SetupError> {
        let mut tx = scope::begin_actor(&self.pool, actor)
            .await
            .map_err(|_| SetupError::Unavailable)?;
        sqlx::query_scalar::<_, bool>(
            "SELECT public.engagement_setup_refuse($1,$2,$3,$4,$5,$6,$7)",
        )
        .bind(actor)
        .bind(self.hash()?)
        .bind(organisation)
        .bind(setup)
        .bind(confirm)
        .bind(refusal.code())
        .bind(refusal.reason())
        .fetch_one(&mut *tx)
        .await
        .map_err(database)?;
        tx.commit().await.map_err(database)
    }

    /// The outcome a confirmation's retained reply stands for.
    async fn replayed(
        mut tx: Tx,
        actor: &str,
        organisation: &str,
        setup: &str,
        reply: &PgRow,
    ) -> Result<SetupView, SetupError> {
        let kind: String = get(reply, "kind")?;
        let payload: Value = get(reply, "payload")?;
        if kind == "refusal" {
            tx.commit().await.map_err(database)?;
            return Err(refused(payload["refusal"].as_str().unwrap_or_default()));
        }
        let view = Self::view(&mut tx, actor, organisation, setup).await?;
        tx.commit().await.map_err(database)?;
        Ok(view)
    }

    async fn establish(
        &self,
        actor: &str,
        organisation: &str,
        setup: &str,
        confirm: i32,
    ) -> Result<SetupView, SetupError> {
        match self
            .try_establish(actor, organisation, setup, confirm)
            .await
        {
            Ok(view) => view,
            Err(failure) => {
                if let Some(refusal) = failure.refusal {
                    // Best effort: if this also fails the confirmation stays
                    // unanswered and its own key can be replayed safely.
                    let _ = self
                        .record_refusal(actor, organisation, setup, confirm, refusal)
                        .await;
                }
                Err(failure.error)
            }
        }
    }

    /// Answer the confirmation inside the establishing transaction, then commit.
    #[allow(clippy::too_many_arguments)]
    async fn answer_confirm(
        mut tx: Tx,
        actor: &str,
        organisation: &str,
        setup: &str,
        count: i32,
        confirm: i32,
        next: &SetupFacts,
        reply: &Reply,
    ) -> Result<SetupView, Failure> {
        Self::store(&mut tx, setup, next).await?;
        Self::insert_reply(
            &mut tx,
            organisation,
            actor,
            setup,
            count,
            confirm,
            reply,
            next,
        )
        .await?;
        let view = Self::view(&mut tx, actor, organisation, setup).await?;
        tx.commit().await.map_err(database)?;
        Ok(view)
    }

    /// The new client named at confirmation, or what a match now found instead.
    async fn rematch(
        &self,
        tx: &mut Tx,
        actor: &str,
        organisation: &str,
        facts: &SetupFacts,
        name: &str,
    ) -> Result<Option<(SetupFacts, Reply)>, SetupError> {
        let lookup = self.lookup(tx, actor, organisation, name).await?;
        let mut next = facts.clone();
        let found = match domain::resolve_client(name, &lookup) {
            ClientResolution::New(_) => return Ok(None),
            ClientResolution::Resolved(client) => vec![client],
            ClientResolution::Ambiguous(list) => list,
            ClientResolution::TooMany => {
                next.new_client_name = None;
                next.candidates.clear();
                next.state = SetupState::Client;
                return Ok(Some((next, Reply::Refused(Refusal::TooManyClients))));
            }
        };
        next.new_client_name = None;
        next.client = None;
        next.candidates = found.clone();
        next.state = SetupState::ClientChoice;
        Ok(Some((next, Reply::ClientNowExists(found))))
    }

    async fn try_establish(
        &self,
        actor: &str,
        organisation: &str,
        setup: &str,
        confirm: i32,
    ) -> Result<Result<SetupView, SetupError>, Failure> {
        let hash = self.hash()?.to_owned();
        let mut tx = match self.begin(actor, organisation, true).await {
            Ok(tx) => tx,
            Err(SetupError::Denied) => {
                return Err(Failure {
                    error: SetupError::Denied,
                    refusal: Some(Refusal::ConfirmDenied),
                });
            }
            Err(error) => return Err(error.into()),
        };
        let row = Self::lock_setup(&mut tx, actor, organisation, setup).await?;
        if let Some(reply) = Self::reply_of(&mut tx, setup, confirm).await? {
            // A concurrent request already answered this confirmation.
            return Ok(Self::replayed(tx, actor, organisation, setup, &reply).await);
        }
        let current = facts(&row)?;
        let count = get::<i32>(&row, "message_count")?;
        if current.state == SetupState::Established {
            let receipt: Value = get(&row, "receipt")?;
            Self::insert_established(
                &mut tx,
                organisation,
                actor,
                setup,
                count,
                confirm,
                &established(&receipt)?,
                receipt["client_name"].as_str(),
            )
            .await?;
            let view = Self::view(&mut tx, actor, organisation, setup).await?;
            tx.commit().await.map_err(database)?;
            return Ok(Ok(view));
        }
        let refuse = |refusal: Refusal| (current.clone(), Reply::Refused(refusal));
        if current.state != SetupState::Confirm {
            let (next, reply) = refuse(Refusal::ConfirmConflict);
            Self::answer_confirm(
                tx,
                actor,
                organisation,
                setup,
                count,
                confirm,
                &next,
                &reply,
            )
            .await?;
            return Ok(Err(SetupError::Conflict));
        }
        // A new client is created only when no client now matches it, decided
        // under organisation lock 205, which every establishing setup holds.
        if let (None, Some(name)) = (&current.client, &current.new_client_name)
            && let Some((next, reply)) = self
                .rematch(&mut tx, actor, organisation, &current, name)
                .await?
        {
            let view = Self::answer_confirm(
                tx,
                actor,
                organisation,
                setup,
                count,
                confirm,
                &next,
                &reply,
            )
            .await?;
            return Ok(Ok(view));
        }
        let result: Value =
            sqlx::query_scalar("SELECT public.engagement_establish($1,$2,$3,$4,$5,$6,$7)")
                .bind(actor)
                .bind(&hash)
                .bind(organisation)
                .bind(setup)
                .bind(generated("c-"))
                .bind(generated("e-"))
                .bind(MAX_ESTABLISHED_PER_DAY as i32)
                .fetch_one(&mut *tx)
                .await
                .map_err(definite)?;
        let text = |name: &str| {
            result[name]
                .as_str()
                .map(str::to_owned)
                .ok_or(SetupError::Unavailable)
        };
        match result["outcome"].as_str() {
            Some("created") => {}
            Some("established") => {
                // Unreachable while this transaction holds the setup row; kept
                // for a direct caller.
                tx.rollback().await.map_err(database)?;
                return Ok(self.get(actor, organisation, setup).await);
            }
            Some("daily_limit") => {
                let (next, reply) = refuse(Refusal::DailyLimit);
                Self::answer_confirm(
                    tx,
                    actor,
                    organisation,
                    setup,
                    count,
                    confirm,
                    &next,
                    &reply,
                )
                .await?;
                return Ok(Err(SetupError::DailyLimit));
            }
            Some("client_exists") => {
                let name = current.new_client_name.clone().unwrap_or_default();
                let (next, reply) = self
                    .rematch(&mut tx, actor, organisation, &current, &name)
                    .await?
                    .unwrap_or_else(|| refuse(Refusal::ConfirmConflict));
                let view = Self::answer_confirm(
                    tx,
                    actor,
                    organisation,
                    setup,
                    count,
                    confirm,
                    &next,
                    &reply,
                )
                .await?;
                return Ok(Ok(view));
            }
            Some("client_missing") => {
                let gone = current
                    .client
                    .as_ref()
                    .map(|client| client.name.clone())
                    .unwrap_or_default();
                let mut next = current.clone();
                next.client = None;
                next.candidates.clear();
                next.state = SetupState::Client;
                let view = Self::answer_confirm(
                    tx,
                    actor,
                    organisation,
                    setup,
                    count,
                    confirm,
                    &next,
                    &Reply::ClientGone(gone),
                )
                .await?;
                return Ok(Ok(view));
            }
            _ => {
                let (next, reply) = refuse(Refusal::ConfirmConflict);
                Self::answer_confirm(
                    tx,
                    actor,
                    organisation,
                    setup,
                    count,
                    confirm,
                    &next,
                    &reply,
                )
                .await?;
                return Ok(Err(SetupError::Conflict));
            }
        }
        let scope = Scope {
            organisation_id: organisation.to_owned(),
            client_id: text("client_id")?,
            engagement_id: text("engagement_id")?,
        };
        let client_name = text("client_name")?;
        // Enter the new scope in this transaction. The organisation advisory lock
        // is already held; the engagement row is locked in the Task order.
        sqlx::query("SELECT pg_catalog.set_config('zobba.organisation_id',$1,true), pg_catalog.set_config('zobba.client_id',$2,true), pg_catalog.set_config('zobba.engagement_id',$3,true)")
            .bind(&scope.organisation_id).bind(&scope.client_id).bind(&scope.engagement_id)
            .execute(&mut *tx).await.map_err(definite)?;
        let engagement_name: Option<String> = sqlx::query_scalar("SELECT name FROM public.engagements WHERE organisation_id=$1 AND client_id=$2 AND id=$3 FOR UPDATE")
            .bind(&scope.organisation_id).bind(&scope.client_id).bind(&scope.engagement_id)
            .fetch_optional(&mut *tx).await.map_err(definite)?;
        let engagement_name = engagement_name.ok_or(Failure {
            error: SetupError::ConfirmFailed,
            refusal: Some(Refusal::ConfirmFailed),
        })?;
        let objective: String = get(&row, "objective")?;
        let command = TaskCommand {
            key: domain::task_key(setup).ok_or(SetupError::Invalid)?,
            kind: CommandKind::Create,
            task_id: None,
            cycle_id: None,
            content: Some(objective),
            context: None,
        };
        let task_failure = |error: TaskError| match task_error(error) {
            SetupError::Denied => Failure {
                error: SetupError::Denied,
                refusal: Some(Refusal::ConfirmDenied),
            },
            _ => Failure {
                error: SetupError::ConfirmFailed,
                refusal: Some(Refusal::ConfirmFailed),
            },
        };
        let receipt = task::admit_in(&mut tx, actor, &scope, &command)
            .await
            .map_err(task_failure)?;
        task::admission_fence(&mut tx, actor, &scope, Some(&hash))
            .await
            .map_err(task_failure)?;
        let done = Established {
            scope: scope.clone(),
            engagement_name,
            receipt,
        };
        let receipt_json = json!({
            "organisation_id": done.scope.organisation_id,
            "client_id": done.scope.client_id,
            "client_name": client_name,
            "engagement_id": done.scope.engagement_id,
            "engagement_name": done.engagement_name,
            "command_id": done.receipt.command_id,
            "task_id": done.receipt.task_id,
            "cycle_id": done.receipt.cycle_id,
            "event_cursor": done.receipt.event_cursor,
        });
        sqlx::query("UPDATE public.engagement_setups SET state='established',candidates='[]'::jsonb,client_id=$2,engagement_id=$3,task_id=$4,cycle_id=$5,receipt=$6,established_at=floor(extract(epoch FROM clock_timestamp()))::bigint WHERE id=$1")
            .bind(setup).bind(&done.scope.client_id).bind(&done.scope.engagement_id).bind(&done.receipt.task_id).bind(&done.receipt.cycle_id).bind(&receipt_json)
            .execute(&mut *tx).await.map_err(definite)?;
        Self::insert_established(
            &mut tx,
            organisation,
            actor,
            setup,
            count,
            confirm,
            &done,
            Some(&client_name),
        )
        .await
        .map_err(|error| Failure {
            error,
            refusal: Some(Refusal::ConfirmFailed),
        })?;
        let view = Self::view(&mut tx, actor, organisation, setup).await?;
        // A failed commit is uncertain: nothing is retained, and the key's
        // replay finds the setup either established or still confirmable.
        tx.commit().await.map_err(database)?;
        Ok(Ok(view))
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
        client_name: Option<&str>,
    ) -> Result<(), SetupError> {
        let content = match client_name {
            Some(client) => format!(
                "Engagement “{}” for client {client} is set up and its first Task has started. Opening the engagement conversation.",
                done.engagement_name
            ),
            None => format!(
                "Engagement “{}” is set up and its first Task has started. Opening the engagement conversation.",
                done.engagement_name
            ),
        };
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

fn organisation(item: &Value) -> Result<SetupOrganisation, SetupError> {
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
}

impl EngagementSetups for EngagementSetupRepository {
    async fn organisations(
        &self,
        actor: &str,
        after: Option<&str>,
    ) -> Result<OrganisationPage, SetupError> {
        if !valid_scope_id(actor) {
            return Err(SetupError::Denied);
        }
        if after.is_some_and(|cursor| !valid_scope_id(cursor)) {
            return Err(SetupError::Invalid);
        }
        let mut tx = scope::begin_actor(&self.pool, actor)
            .await
            .map_err(|error| match error {
                scope::ScopeError::Denied => SetupError::Denied,
                scope::ScopeError::Unavailable => SetupError::Unavailable,
            })?;
        let value: Value =
            sqlx::query_scalar("SELECT public.engagement_setup_organisations($1,$2,$3,$4)")
                .bind(actor)
                .bind(self.hash()?)
                .bind(after)
                .bind(ORGANISATION_PAGE as i32)
                .fetch_one(&mut *tx)
                .await
                .map_err(database)?;
        tx.commit().await.map_err(database)?;
        let organisations = value["organisations"]
            .as_array()
            .ok_or(SetupError::Unavailable)?
            .iter()
            .map(organisation)
            .collect::<Result<Vec<_>, _>>()?;
        if organisations.len() > ORGANISATION_PAGE {
            return Err(SetupError::Unavailable);
        }
        Ok(OrganisationPage {
            organisations,
            more: value["more"].as_bool().ok_or(SetupError::Unavailable)?,
        })
    }

    async fn open_setups(
        &self,
        actor: &str,
        organisation: &str,
    ) -> Result<Vec<SetupView>, SetupError> {
        let mut tx = self.begin(actor, organisation, false).await?;
        let ids: Vec<String> = sqlx::query_scalar("SELECT id FROM public.engagement_setups WHERE organisation_id=$1 AND actor_id=$2 AND state NOT IN ('established','cancelled') ORDER BY created_at,id COLLATE \"C\" LIMIT $3")
            .bind(organisation).bind(actor).bind(MAX_OPEN_SETUPS as i64).fetch_all(&mut *tx).await.map_err(database)?;
        let mut views = Vec::with_capacity(ids.len());
        let mut pending = Vec::new();
        for id in &ids {
            if Self::needs_answer(&mut tx, id).await? {
                pending.push(views.len());
            }
            views.push(Self::view(&mut tx, actor, organisation, id).await?);
        }
        tx.commit().await.map_err(database)?;
        for index in pending {
            views[index] = self.answer(actor, organisation, &ids[index]).await?;
        }
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
        // Lock 205 also serializes this actor's setups for the open bound.
        let mut tx = self.begin(actor, organisation, true).await?;
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
        let mut tx = self.begin(actor, organisation, true).await?;
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
        let unanswered = Self::unanswered(&mut tx, setup).await?;
        if !has_room(count, unanswered, matches!(input, MemberInput::Cancel)) {
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
        let mut tx = self.begin(actor, organisation, true).await?;
        let row = Self::lock_setup(&mut tx, actor, organisation, setup).await?;
        let state = facts(&row)?.state;
        let ordinal =
            if let Some(existing) = Self::by_key(&mut tx, actor, organisation, key).await? {
                if get::<String>(&existing, "setup_id")? != setup
                    || get::<String>(&existing, "kind")? != "confirm"
                {
                    return Err(SetupError::Conflict);
                }
                let ordinal = get::<i32>(&existing, "ordinal")?;
                // A confirmation's retained answer is its receipt: replaying a
                // refused key repeats the refusal and never establishes.
                if let Some(reply) = Self::reply_of(&mut tx, setup, ordinal).await? {
                    return Self::replayed(tx, actor, organisation, setup, &reply).await;
                }
                ordinal
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
                let unanswered = Self::unanswered(&mut tx, setup).await?;
                if !has_room(count, unanswered, false) {
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
        let mut tx = self.begin(actor, organisation, false).await?;
        let view = Self::view(&mut tx, actor, organisation, setup).await?;
        let pending = Self::needs_answer(&mut tx, setup).await?;
        tx.commit().await.map_err(database)?;
        if pending {
            self.answer(actor, organisation, setup).await
        } else {
            Ok(view)
        }
    }
}
