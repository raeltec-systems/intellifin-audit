//! Conversational engagement setup (Story 22.2 AC4). A pure, deterministic state
//! machine: objective → client → period → confirm → established. Nothing here calls
//! a model, reads storage or infers a client or period from free text other than
//! the member's own explicit answer.
use crate::identity::{valid_scope_id, valid_scope_label};
use crate::methodology::valid_date;

/// Open (not established, not cancelled) setups per actor in one organisation.
pub const MAX_OPEN_SETUPS: usize = 8;
/// Engagements an actor may establish in one organisation per UTC day.
pub const MAX_ESTABLISHED_PER_DAY: usize = 20;
/// Messages (member and Zobba) retained by one setup.
pub const MAX_SETUP_MESSAGES: usize = 200;
/// Message slots kept free for a cancellation and its reply, so a full setup can
/// always be closed.
pub const CANCEL_RESERVE: usize = 2;
/// Candidates listed by a client question. A wider match is refused, not truncated.
pub const MAX_CLIENT_CANDIDATES: usize = 20;
/// Organisations listed per page by the setup organisation read.
pub const ORGANISATION_PAGE: usize = 50;
/// The first objective, in UTF-8 bytes.
pub const OBJECTIVE_MAX: usize = crate::task::COMMAND_CONTENT_MAX;
/// An answer is short free text (a client name or a period), in UTF-8 bytes.
pub const ANSWER_MAX: usize = 400;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SetupState {
    /// Objective persisted, not yet interpreted.
    Objective,
    Client,
    ClientChoice,
    NewClient,
    Period,
    Confirm,
    Established,
    Cancelled,
}

impl SetupState {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Objective => "objective",
            Self::Client => "client",
            Self::ClientChoice => "client_choice",
            Self::NewClient => "new_client",
            Self::Period => "period",
            Self::Confirm => "confirm",
            Self::Established => "established",
            Self::Cancelled => "cancelled",
        }
    }
    pub fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "objective" => Self::Objective,
            "client" => Self::Client,
            "client_choice" => Self::ClientChoice,
            "new_client" => Self::NewClient,
            "period" => Self::Period,
            "confirm" => Self::Confirm,
            "established" => Self::Established,
            "cancelled" => Self::Cancelled,
            _ => return None,
        })
    }
    /// Counts toward [`MAX_OPEN_SETUPS`] and accepts further member messages.
    pub const fn is_open(self) -> bool {
        !matches!(self, Self::Established | Self::Cancelled)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ClientCandidate {
    pub id: String,
    pub name: String,
}

impl ClientCandidate {
    pub fn is_valid(&self) -> bool {
        valid_scope_id(&self.id) && valid_scope_label(&self.name)
    }
}

/// The explicit audit period; inclusive ISO calendar dates with start ≤ end.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Period {
    pub start: String,
    pub end: String,
}

/// What the setup has resolved so far. Only explicit member answers populate it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SetupFacts {
    pub state: SetupState,
    pub candidates: Vec<ClientCandidate>,
    pub client: Option<ClientCandidate>,
    pub new_client_name: Option<String>,
    pub period: Option<Period>,
}

impl SetupFacts {
    pub fn opened() -> Self {
        Self {
            state: SetupState::Objective,
            candidates: Vec::new(),
            client: None,
            new_client_name: None,
            period: None,
        }
    }
}

/// A member message, already shape-validated, in its owned meaning.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MemberInput {
    Objective(String),
    Text(String),
    ChooseClient(String),
    NewClient(bool),
    /// Return to the client question; a known period is kept.
    ChangeClient,
    /// Return to the period question from the summary.
    ChangePeriod,
    Confirm,
    Cancel,
}

impl MemberInput {
    pub const fn kind(&self) -> &'static str {
        match self {
            Self::Objective(_) => "objective",
            Self::Text(_) => "text",
            Self::ChooseClient(_) => "choose_client",
            Self::NewClient(_) => "new_client",
            Self::ChangeClient => "change_client",
            Self::ChangePeriod => "change_period",
            Self::Confirm => "confirm",
            Self::Cancel => "cancel",
        }
    }
    pub fn is_valid(&self) -> bool {
        match self {
            Self::Objective(text) => valid_text(text, OBJECTIVE_MAX),
            Self::Text(text) => valid_text(text, ANSWER_MAX),
            Self::ChooseClient(id) => valid_scope_id(id),
            Self::NewClient(_)
            | Self::ChangeClient
            | Self::ChangePeriod
            | Self::Confirm
            | Self::Cancel => true,
        }
    }
    /// Retained display text for the member's own turn.
    pub fn display(&self) -> String {
        match self {
            Self::Objective(text) | Self::Text(text) => text.clone(),
            Self::ChooseClient(id) => format!("Chose client {id}"),
            Self::NewClient(true) => "Create this client".into(),
            Self::NewClient(false) => "Do not create this client".into(),
            Self::ChangeClient => "Change client".into(),
            Self::ChangePeriod => "Change audit period".into(),
            Self::Confirm => "Confirm".into(),
            Self::Cancel => "Cancel setup".into(),
        }
    }
}

fn valid_text(text: &str, max: usize) -> bool {
    !text.trim().is_empty()
        && text.len() <= max
        && !text
            .chars()
            .any(|ch| ch.is_control() && !matches!(ch, '\n' | '\r' | '\t'))
}

/// Why an answer is refused. The setup stays open in the same state.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Refusal {
    InvalidClientName,
    TooManyClients,
    NotACandidate,
    AnswerNewClient,
    PeriodFormat,
    PeriodInvalidDate,
    PeriodOrder,
    ConfirmOrCancel,
    NotApplicable,
    /// The setup is established or cancelled; nothing was changed.
    SetupClosed,
    /// Confirmation refused: the member no longer holds audit access.
    ConfirmDenied,
    /// Confirmation refused: the setup was no longer ready to confirm.
    ConfirmConflict,
    /// Confirmation refused: the daily establishment limit is reached.
    DailyLimit,
    /// Confirmation failed while establishing; nothing was created.
    ConfirmFailed,
}

impl Refusal {
    pub const fn code(self) -> &'static str {
        match self {
            Self::InvalidClientName => "invalid_client_name",
            Self::TooManyClients => "too_many_clients",
            Self::NotACandidate => "not_a_candidate",
            Self::AnswerNewClient => "answer_new_client",
            Self::PeriodFormat => "period_format",
            Self::PeriodInvalidDate => "period_invalid_date",
            Self::PeriodOrder => "period_order",
            Self::ConfirmOrCancel => "confirm_or_cancel",
            Self::NotApplicable => "not_applicable",
            Self::SetupClosed => "setup_closed",
            Self::ConfirmDenied => "confirm_denied",
            Self::ConfirmConflict => "confirm_conflict",
            Self::DailyLimit => "daily_limit",
            Self::ConfirmFailed => "confirm_failed",
        }
    }
    pub fn parse(code: &str) -> Option<Self> {
        [
            Self::InvalidClientName,
            Self::TooManyClients,
            Self::NotACandidate,
            Self::AnswerNewClient,
            Self::PeriodFormat,
            Self::PeriodInvalidDate,
            Self::PeriodOrder,
            Self::ConfirmOrCancel,
            Self::NotApplicable,
            Self::SetupClosed,
            Self::ConfirmDenied,
            Self::ConfirmConflict,
            Self::DailyLimit,
            Self::ConfirmFailed,
        ]
        .into_iter()
        .find(|refusal| refusal.code() == code)
    }
    pub fn reason(self) -> String {
        match self {
            Self::InvalidClientName => {
                "A client name is 1–200 characters without control characters.".into()
            }
            Self::TooManyClients => format!(
                "More than {MAX_CLIENT_CANDIDATES} clients match that name. Use the exact client name."
            ),
            Self::NotACandidate => "Choose one of the listed clients.".into(),
            Self::AnswerNewClient => "Confirm or decline creating this client.".into(),
            Self::PeriodFormat => {
                "Give the audit period as two ISO dates, for example 2026-01-01 to 2026-12-31."
                    .into()
            }
            Self::PeriodInvalidDate => "One of those dates does not exist in the calendar.".into(),
            Self::PeriodOrder => "The period must start on or before its end date.".into(),
            Self::ConfirmOrCancel => {
                "Confirm the summary, change the client or period, or cancel this setup.".into()
            }
            Self::NotApplicable => "That answer does not apply at this step.".into(),
            Self::SetupClosed => "This setup is closed. Nothing was changed.".into(),
            Self::ConfirmDenied => {
                "Not confirmed: you no longer hold an auditor or audit manager role here. Nothing was created.".into()
            }
            Self::ConfirmConflict => {
                "Not confirmed: the setup changed before confirmation. Nothing was created.".into()
            }
            Self::DailyLimit => format!(
                "Not confirmed: you have set up {MAX_ESTABLISHED_PER_DAY} engagements here today (UTC). Nothing was created."
            ),
            Self::ConfirmFailed => {
                "Not confirmed: the engagement could not be created. Nothing was created; confirm again to retry.".into()
            }
        }
    }
}

/// Zobba's deterministic reply to one member message.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Reply {
    AskClient,
    ChooseClient(Vec<ClientCandidate>),
    ProposeNewClient(String),
    AskPeriod,
    /// The summary; `duplicate` when this client already has an engagement for
    /// exactly this period (confirmation is still allowed).
    Summary {
        duplicate: bool,
    },
    /// At confirmation a matching client now exists; nothing was created.
    ClientNowExists(Vec<ClientCandidate>),
    /// At confirmation the chosen client no longer exists; nothing was created.
    ClientGone(String),
    Refused(Refusal),
    Cancelled,
}

impl Reply {
    /// Fixed reply kind stored with the Zobba turn.
    pub const fn kind(&self) -> &'static str {
        match self {
            Self::AskClient
            | Self::ChooseClient(_)
            | Self::ProposeNewClient(_)
            | Self::AskPeriod
            | Self::ClientNowExists(_)
            | Self::ClientGone(_) => "question",
            Self::Summary { .. } => "summary",
            Self::Refused(_) => "refusal",
            Self::Cancelled => "cancelled",
        }
    }
    pub fn text(&self, facts: &SetupFacts) -> String {
        match self {
            Self::AskClient => "Which client is this engagement for? Give the client's name.".into(),
            Self::ChooseClient(_) => "More than one client matches that name. Which one is it?".into(),
            Self::ProposeNewClient(name) => format!("No client named “{name}” exists. Create client {name}?"),
            Self::AskPeriod => {
                "What audit period does this engagement cover? Give two ISO dates, for example 2026-01-01 to 2026-12-31.".into()
            }
            Self::ClientNowExists(_) => {
                "A client with that name exists now, so no new client was created. Which client is it? You can also give another name.".into()
            }
            Self::ClientGone(name) => format!(
                "Client “{name}” no longer exists, so nothing was created. Which client is this engagement for?"
            ),
            Self::Summary { duplicate } => {
                let client = match (&facts.client, &facts.new_client_name) {
                    (Some(client), _) => client.name.clone(),
                    (None, Some(name)) => format!("{name} (new client)"),
                    (None, None) => String::new(),
                };
                let period = facts
                    .period
                    .as_ref()
                    .map(|p| format!("{} to {}", p.start, p.end))
                    .unwrap_or_default();
                let warning = if *duplicate {
                    " An engagement for this client with exactly this audit period already exists; confirming creates another one."
                } else {
                    ""
                };
                format!(
                    "Ready to set up: client {client}, audit period {period}.{warning} You will be the only person assigned. Confirm to create the engagement and start the first Task."
                )
            }
            Self::Refused(refusal) => refusal.reason(),
            Self::Cancelled => "Setup cancelled. Nothing was created.".into(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SetupOrganisation {
    pub id: String,
    pub name: String,
}

/// One page of setup organisations in C order; `more` means another page exists.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OrganisationPage {
    pub organisations: Vec<SetupOrganisation>,
    pub more: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SetupAuthor {
    Member,
    Zobba,
}

/// One retained turn. Zobba turns carry the closed prompt kind and candidates.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SetupMessage {
    pub ordinal: u32,
    pub author: SetupAuthor,
    pub kind: String,
    pub content: String,
    pub reply_to: Option<u32>,
    pub prompt: Option<String>,
    pub candidates: Vec<ClientCandidate>,
    pub refusal: Option<String>,
}

/// The establishing receipt: the new scope and the first Task's Received receipt.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Established {
    pub scope: crate::identity::Scope,
    pub engagement_name: String,
    pub receipt: crate::task::CommandReceipt,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SetupView {
    pub id: String,
    pub organisation_id: String,
    pub key: String,
    pub objective: String,
    pub facts: SetupFacts,
    pub established: Option<Established>,
    pub messages: Vec<SetupMessage>,
}

impl Reply {
    /// Closed prompt identifier for a question, used by clients to render controls.
    pub const fn prompt(&self) -> Option<&'static str> {
        match self {
            Self::AskClient | Self::ClientGone(_) => Some("client"),
            Self::ChooseClient(_) | Self::ClientNowExists(_) => Some("client_choice"),
            Self::ProposeNewClient(_) => Some("new_client"),
            Self::AskPeriod => Some("period"),
            Self::Summary { .. } => Some("confirm"),
            Self::Refused(_) | Self::Cancelled => None,
        }
    }
}

/// The member's input was not answered because it needs a client lookup first.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Step {
    /// Call [`interpret`] again with the organisation's matching clients.
    LookupClients(String),
    Next(SetupFacts, Reply),
}

/// Trim Unicode White_Space at the edges; the label rule forbids it there.
pub fn normalize_name(text: &str) -> Option<String> {
    let trimmed = text.trim();
    valid_scope_label(trimmed).then(|| trimmed.to_owned())
}

/// Context-independent Unicode simple case folding (CaseFolding status C+S).
/// Each scalar maps to one scalar, so folding preserves the scalar count. It is
/// derived from the simple case mappings: the lowercase of the single-scalar
/// uppercase. Dotless ı and dotted İ have only Turkic (T) or full (F) foldings and
/// therefore fold to themselves.
pub fn simple_fold(value: &str) -> String {
    value.chars().map(fold_char).collect()
}

fn fold_char(ch: char) -> char {
    if matches!(ch, '\u{0130}' | '\u{0131}') {
        return ch;
    }
    let upper = single(ch.to_uppercase()).unwrap_or(ch);
    single(upper.to_lowercase())
        .or_else(|| single(ch.to_lowercase()))
        .unwrap_or(ch)
}

fn single(mut chars: impl Iterator<Item = char>) -> Option<char> {
    let first = chars.next()?;
    chars.next().is_none().then_some(first)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ClientResolution {
    Resolved(ClientCandidate),
    Ambiguous(Vec<ClientCandidate>),
    New(String),
    TooMany,
}

/// Exact name equality first; otherwise simple-case-folded equality. The lookup
/// may be a superset; only equal names are considered here.
pub fn resolve_client(name: &str, lookup: &[ClientCandidate]) -> ClientResolution {
    // A full lookup page may be incomplete; never guess from a truncated set.
    if lookup.len() > MAX_CLIENT_CANDIDATES {
        return ClientResolution::TooMany;
    }
    let exact: Vec<_> = lookup.iter().filter(|c| c.name == name).cloned().collect();
    let matches = if exact.is_empty() {
        let folded = simple_fold(name);
        lookup
            .iter()
            .filter(|c| simple_fold(&c.name) == folded)
            .cloned()
            .collect()
    } else {
        exact
    };
    match matches.len() {
        0 => ClientResolution::New(name.to_owned()),
        1 => {
            ClientResolution::Resolved(matches.into_iter().next().unwrap_or_else(|| unreachable!()))
        }
        _ => {
            let mut sorted = matches;
            sorted.sort_by(|a, b| a.id.cmp(&b.id));
            ClientResolution::Ambiguous(sorted)
        }
    }
}

/// Explicit ISO dates only: `YYYY-MM-DD to YYYY-MM-DD` or `YYYY-MM-DD/YYYY-MM-DD`.
pub fn parse_period(text: &str) -> Result<Period, Refusal> {
    let text = text.trim();
    let (start, end) = if let Some((start, end)) = text.split_once('/') {
        (start, end)
    } else {
        let mut parts = text.split_whitespace();
        match (parts.next(), parts.next(), parts.next(), parts.next()) {
            (Some(start), Some("to"), Some(end), None) => (start, end),
            _ => return Err(Refusal::PeriodFormat),
        }
    };
    let (start, end) = (start.trim(), end.trim());
    let shaped = |value: &str| {
        value.len() == 10
            && value.bytes().enumerate().all(|(index, byte)| {
                if index == 4 || index == 7 {
                    byte == b'-'
                } else {
                    byte.is_ascii_digit()
                }
            })
    };
    if !shaped(start) || !shaped(end) {
        return Err(Refusal::PeriodFormat);
    }
    if !valid_date(start) || !valid_date(end) {
        return Err(Refusal::PeriodInvalidDate);
    }
    if start > end {
        return Err(Refusal::PeriodOrder);
    }
    Ok(Period {
        start: start.to_owned(),
        end: end.to_owned(),
    })
}

/// One deterministic step. `lookup` is supplied only after [`Step::LookupClients`].
/// Confirmation is not decided here: it is the separate establishing transaction.
pub fn interpret(
    facts: &SetupFacts,
    input: &MemberInput,
    lookup: Option<&[ClientCandidate]>,
) -> Step {
    let stay = |refusal| Step::Next(facts.clone(), Reply::Refused(refusal));
    let mut next = facts.clone();
    if !facts.state.is_open() {
        return stay(Refusal::SetupClosed);
    }
    if matches!(input, MemberInput::Cancel) {
        next.state = SetupState::Cancelled;
        return Step::Next(next, Reply::Cancelled);
    }
    if matches!(input, MemberInput::ChangeClient)
        && matches!(
            facts.state,
            SetupState::ClientChoice
                | SetupState::NewClient
                | SetupState::Period
                | SetupState::Confirm
        )
    {
        next.client = None;
        next.new_client_name = None;
        next.candidates.clear();
        next.state = SetupState::Client;
        return Step::Next(next, Reply::AskClient);
    }
    if matches!(input, MemberInput::ChangePeriod) && facts.state == SetupState::Confirm {
        next.state = SetupState::Period;
        return Step::Next(next, Reply::AskPeriod);
    }
    match (facts.state, input) {
        (SetupState::Objective, MemberInput::Objective(_)) => {
            next.state = SetupState::Client;
            Step::Next(next, Reply::AskClient)
        }
        (SetupState::Client, MemberInput::Text(text)) => search(facts, next, text, lookup),
        (SetupState::ClientChoice, MemberInput::ChooseClient(id)) => {
            match facts.candidates.iter().find(|c| &c.id == id) {
                Some(client) => choose(next, client.clone()),
                None => stay(Refusal::NotACandidate),
            }
        }
        (SetupState::ClientChoice, MemberInput::Text(text)) => {
            let named: Vec<_> = facts
                .candidates
                .iter()
                .filter(|c| c.name == text.trim())
                .collect();
            match named.as_slice() {
                [client] => choose(next, (*client).clone()),
                // Another name is a new search, not a refusal.
                _ => search(facts, next, text, lookup),
            }
        }
        (SetupState::NewClient, MemberInput::NewClient(true)) => after_client(next),
        (SetupState::NewClient, MemberInput::NewClient(false)) => {
            next.new_client_name = None;
            next.state = SetupState::Client;
            Step::Next(next, Reply::AskClient)
        }
        (SetupState::NewClient, _) => stay(Refusal::AnswerNewClient),
        (SetupState::Period, MemberInput::Text(text)) => match parse_period(text) {
            Ok(period) => {
                next.period = Some(period);
                next.state = SetupState::Confirm;
                Step::Next(next, Reply::Summary { duplicate: false })
            }
            Err(refusal) => stay(refusal),
        },
        (SetupState::Confirm, _) => stay(Refusal::ConfirmOrCancel),
        _ => stay(Refusal::NotApplicable),
    }
}

/// A client-name answer: look the name up, then resolve it.
fn search(
    facts: &SetupFacts,
    mut next: SetupFacts,
    text: &str,
    lookup: Option<&[ClientCandidate]>,
) -> Step {
    let Some(name) = normalize_name(text) else {
        return Step::Next(facts.clone(), Reply::Refused(Refusal::InvalidClientName));
    };
    let Some(lookup) = lookup else {
        return Step::LookupClients(name);
    };
    match resolve_client(&name, lookup) {
        ClientResolution::Resolved(client) => choose(next, client),
        ClientResolution::Ambiguous(candidates) => {
            next.client = None;
            next.new_client_name = None;
            next.candidates = candidates.clone();
            next.state = SetupState::ClientChoice;
            Step::Next(next, Reply::ChooseClient(candidates))
        }
        ClientResolution::New(name) => {
            next.new_client_name = Some(name.clone());
            next.client = None;
            next.candidates.clear();
            next.state = SetupState::NewClient;
            Step::Next(next, Reply::ProposeNewClient(name))
        }
        ClientResolution::TooMany => {
            Step::Next(facts.clone(), Reply::Refused(Refusal::TooManyClients))
        }
    }
}

fn choose(mut next: SetupFacts, client: ClientCandidate) -> Step {
    next.client = Some(client);
    next.new_client_name = None;
    next.candidates.clear();
    after_client(next)
}

/// Once the client is known, ask for the period unless it is already known.
fn after_client(mut next: SetupFacts) -> Step {
    if next.period.is_some() {
        next.state = SetupState::Confirm;
        Step::Next(next, Reply::Summary { duplicate: false })
    } else {
        next.state = SetupState::Period;
        Step::Next(next, Reply::AskPeriod)
    }
}

/// Deterministic Task idempotency key for the first Task of a setup.
pub fn task_key(setup_id: &str) -> Option<String> {
    let key = format!("engagement-setup-{setup_id}");
    valid_scope_id(&key).then_some(key)
}

/// Server-generated scope ID: a fixed ASCII prefix and 32 lowercase hex digits.
pub fn generated_id(prefix: &str, random: &[u8; 16]) -> String {
    let mut id = String::with_capacity(prefix.len() + 32);
    id.push_str(prefix);
    for byte in random {
        id.push_str(&format!("{byte:02x}"));
    }
    id
}

#[cfg(test)]
mod tests {
    use super::*;

    fn client(id: &str, name: &str) -> ClientCandidate {
        ClientCandidate {
            id: id.into(),
            name: name.into(),
        }
    }
    fn at(state: SetupState) -> SetupFacts {
        SetupFacts {
            state,
            ..SetupFacts::opened()
        }
    }
    fn next(step: Step) -> (SetupFacts, Reply) {
        match step {
            Step::Next(facts, reply) => (facts, reply),
            Step::LookupClients(name) => panic!("unexpected lookup {name}"),
        }
    }

    #[test]
    fn happy_path_asks_only_for_client_then_period_then_summary() {
        let (facts, reply) = next(interpret(
            &SetupFacts::opened(),
            &MemberInput::Objective("Review leaver access".into()),
            None,
        ));
        assert_eq!(
            (facts.state, &reply),
            (SetupState::Client, &Reply::AskClient)
        );
        let answer = MemberInput::Text("  Alder Manufacturing ".into());
        assert_eq!(
            interpret(&facts, &answer, None),
            Step::LookupClients("Alder Manufacturing".into())
        );
        let lookup = [client("client-a", "Alder Manufacturing")];
        let (facts, reply) = next(interpret(&facts, &answer, Some(&lookup)));
        assert_eq!((facts.state, reply), (SetupState::Period, Reply::AskPeriod));
        assert_eq!(facts.client, Some(lookup[0].clone()));
        let (facts, reply) = next(interpret(
            &facts,
            &MemberInput::Text("2026-01-01 to 2026-12-31".into()),
            None,
        ));
        assert_eq!(
            (facts.state, &reply),
            (SetupState::Confirm, &Reply::Summary { duplicate: false })
        );
        assert_eq!(
            facts.period,
            Some(Period {
                start: "2026-01-01".into(),
                end: "2026-12-31".into()
            })
        );
        assert!(reply.text(&facts).contains("Alder Manufacturing"));
        // Confirmation is decided by the establishing transaction, never here.
        let (same, reply) = next(interpret(&facts, &MemberInput::Confirm, None));
        assert_eq!(same, facts);
        assert_eq!(reply, Reply::Refused(Refusal::ConfirmOrCancel));
    }

    #[test]
    fn ambiguous_folded_clients_ask_and_refuse_outsiders() {
        let facts = at(SetupState::Client);
        let lookup = [client("c2", "ACME"), client("c1", "Acme")];
        let answer = MemberInput::Text("acme".into());
        let (facts, reply) = next(interpret(&facts, &answer, Some(&lookup)));
        assert_eq!(facts.state, SetupState::ClientChoice);
        assert_eq!(
            reply,
            Reply::ChooseClient(vec![client("c1", "Acme"), client("c2", "ACME")])
        );
        assert!(facts.client.is_none() && facts.new_client_name.is_none());
        let (same, reply) = next(interpret(
            &facts,
            &MemberInput::ChooseClient("c3".into()),
            None,
        ));
        assert_eq!(
            (same.state, reply),
            (
                SetupState::ClientChoice,
                Reply::Refused(Refusal::NotACandidate)
            )
        );
        // Typing another name is a new search, not a refusal.
        assert_eq!(
            interpret(&facts, &MemberInput::Text(" Other ".into()), None),
            Step::LookupClients("Other".into())
        );
        let (renamed, reply) = next(interpret(
            &facts,
            &MemberInput::Text("Other".into()),
            Some(&[client("o1", "Other")]),
        ));
        assert_eq!(
            (renamed.state, renamed.client, reply),
            (
                SetupState::Period,
                Some(client("o1", "Other")),
                Reply::AskPeriod
            )
        );
        let (chosen, _) = next(interpret(
            &facts,
            &MemberInput::ChooseClient("c2".into()),
            None,
        ));
        assert_eq!(
            (chosen.state, chosen.client),
            (SetupState::Period, Some(client("c2", "ACME")))
        );
        let (named, _) = next(interpret(&facts, &MemberInput::Text("Acme".into()), None));
        assert_eq!(named.client, Some(client("c1", "Acme")));
    }

    #[test]
    fn exact_match_wins_over_folded_matches() {
        let lookup = [client("c1", "Acme"), client("c2", "ACME")];
        assert_eq!(
            resolve_client("ACME", &lookup),
            ClientResolution::Resolved(client("c2", "ACME"))
        );
        let twins = [client("c1", "Acme"), client("c2", "Acme")];
        assert!(
            matches!(resolve_client("Acme", &twins), ClientResolution::Ambiguous(c) if c.len() == 2)
        );
        let many: Vec<_> = (0..21).map(|i| client(&format!("c{i}"), "acme")).collect();
        assert_eq!(resolve_client("ACME", &many), ClientResolution::TooMany);
    }

    #[test]
    fn new_client_needs_explicit_confirmation_and_decline_keeps_setup_open() {
        let facts = at(SetupState::Client);
        let (facts, reply) = next(interpret(
            &facts,
            &MemberInput::Text("Birch Holdings".into()),
            Some(&[]),
        ));
        assert_eq!(facts.state, SetupState::NewClient);
        assert_eq!(reply, Reply::ProposeNewClient("Birch Holdings".into()));
        assert!(reply.text(&facts).contains("Create client Birch Holdings?"));
        let (same, reply) = next(interpret(&facts, &MemberInput::Text("yes".into()), None));
        assert_eq!(
            (same.state, reply),
            (
                SetupState::NewClient,
                Reply::Refused(Refusal::AnswerNewClient)
            )
        );
        let (declined, reply) = next(interpret(&facts, &MemberInput::NewClient(false), None));
        assert_eq!(
            (declined.state, reply),
            (SetupState::Client, Reply::AskClient)
        );
        assert!(declined.new_client_name.is_none() && declined.state.is_open());
        let (accepted, reply) = next(interpret(&facts, &MemberInput::NewClient(true), None));
        assert_eq!(
            (accepted.state, reply),
            (SetupState::Period, Reply::AskPeriod)
        );
        assert_eq!(accepted.new_client_name.as_deref(), Some("Birch Holdings"));
    }

    #[test]
    fn period_requires_explicit_valid_ordered_iso_dates() {
        let facts = at(SetupState::Period);
        for (text, refusal) in [
            ("", Refusal::PeriodFormat),
            ("last year", Refusal::PeriodFormat),
            ("2026", Refusal::PeriodFormat),
            ("1 Jan 2026 to 31 Dec 2026", Refusal::PeriodFormat),
            ("2026-1-1 to 2026-12-31", Refusal::PeriodFormat),
            ("2026-01-01 until 2026-12-31", Refusal::PeriodFormat),
            (
                "2026-01-01 to 2026-12-31 to 2027-01-01",
                Refusal::PeriodFormat,
            ),
            ("2026-02-30 to 2026-12-31", Refusal::PeriodInvalidDate),
            ("2025-02-29 to 2025-03-01", Refusal::PeriodInvalidDate),
            ("2026-12-31 to 2026-01-01", Refusal::PeriodOrder),
        ] {
            let (same, reply) = next(interpret(&facts, &MemberInput::Text(text.into()), None));
            assert_eq!(
                (same.state, reply),
                (SetupState::Period, Reply::Refused(refusal)),
                "{text}"
            );
        }
        for text in [
            "2024-02-29 to 2024-02-29",
            "2026-01-01/2026-12-31",
            " 2026-01-01 to 2026-12-31 ",
        ] {
            let (done, _) = next(interpret(&facts, &MemberInput::Text(text.into()), None));
            assert_eq!(done.state, SetupState::Confirm, "{text}");
        }
    }

    #[test]
    fn client_and_period_can_be_corrected_from_the_summary() {
        let ready = SetupFacts {
            state: SetupState::Confirm,
            client: Some(client("c1", "Alder")),
            period: Some(Period {
                start: "2026-01-01".into(),
                end: "2026-12-31".into(),
            }),
            ..SetupFacts::opened()
        };
        let (asked, reply) = next(interpret(&ready, &MemberInput::ChangeClient, None));
        assert_eq!(
            (asked.state, &reply),
            (SetupState::Client, &Reply::AskClient)
        );
        assert!(asked.client.is_none() && asked.period.is_some());
        // The known period is kept: a resolved client returns to the summary.
        let (back, reply) = next(interpret(
            &asked,
            &MemberInput::Text("Birch".into()),
            Some(&[client("c2", "Birch")]),
        ));
        assert_eq!(
            (back.state, reply, back.client),
            (
                SetupState::Confirm,
                Reply::Summary { duplicate: false },
                Some(client("c2", "Birch"))
            )
        );
        let (period, reply) = next(interpret(&ready, &MemberInput::ChangePeriod, None));
        assert_eq!(
            (period.state, reply),
            (SetupState::Period, Reply::AskPeriod)
        );
        let (_, reply) = next(interpret(
            &at(SetupState::Client),
            &MemberInput::ChangePeriod,
            None,
        ));
        assert_eq!(reply, Reply::Refused(Refusal::NotApplicable));
        assert!(
            Reply::Summary { duplicate: true }
                .text(&ready)
                .contains("already exists")
        );
        assert!(
            !Reply::Summary { duplicate: false }
                .text(&ready)
                .contains("already exists")
        );
    }

    #[test]
    fn closed_setups_answer_every_message_with_a_fixed_refusal() {
        for state in [SetupState::Established, SetupState::Cancelled] {
            for input in [
                MemberInput::Text("x".into()),
                MemberInput::Cancel,
                MemberInput::ChangeClient,
            ] {
                let (same, reply) = next(interpret(&at(state), &input, None));
                assert_eq!(
                    (same.state, reply),
                    (state, Reply::Refused(Refusal::SetupClosed))
                );
            }
        }
        for refusal in [
            Refusal::SetupClosed,
            Refusal::ConfirmDenied,
            Refusal::DailyLimit,
            Refusal::ConfirmFailed,
        ] {
            assert_eq!(Refusal::parse(refusal.code()), Some(refusal));
        }
        assert_eq!(Refusal::parse("other"), None);
    }

    #[test]
    fn cancel_closes_any_open_setup_and_closed_setups_refuse() {
        for state in [SetupState::Client, SetupState::Period, SetupState::Confirm] {
            let (facts, reply) = next(interpret(&at(state), &MemberInput::Cancel, None));
            assert_eq!(
                (facts.state, reply),
                (SetupState::Cancelled, Reply::Cancelled)
            );
        }
        assert!(!SetupState::Cancelled.is_open() && !SetupState::Established.is_open());
        let (_, reply) = next(interpret(
            &at(SetupState::Period),
            &MemberInput::ChooseClient("c".into()),
            None,
        ));
        assert_eq!(reply, Reply::Refused(Refusal::NotApplicable));
        let (_, reply) = next(interpret(
            &at(SetupState::Client),
            &MemberInput::Text("\u{0001}x".into()),
            None,
        ));
        assert_eq!(reply, Reply::Refused(Refusal::InvalidClientName));
    }

    #[test]
    fn simple_case_folding_is_context_independent_and_length_preserving() {
        for (a, b) in [
            ("Straße", "STRAẞE"),
            ("ſtop", "STOP"),
            ("\u{212A}elvin", "kelvin"),
            ("ΣΊΣΥΦΟΣ", "σίσυφος"),
            ("σίσυφοσ", "σίσυφος"),
            ("ǅemal", "ǆEMAL"),
            ("\u{13F4}\u{13AE}", "\u{13FC}\u{AB7E}"),
        ] {
            assert_eq!(simple_fold(a), simple_fold(b), "{a} {b}");
            assert_eq!(simple_fold(a).chars().count(), a.chars().count());
        }
        // Full (F) and Turkic (T) foldings are not simple foldings.
        assert_ne!(simple_fold("Straße"), simple_fold("STRASSE"));
        assert_ne!(simple_fold("ı"), simple_fold("i"));
        assert_ne!(simple_fold("İ"), simple_fold("i"));
        assert_eq!(simple_fold("İ"), "İ");
    }

    #[test]
    fn inputs_ids_and_keys_are_bounded() {
        assert!(MemberInput::Objective("x".repeat(4000)).is_valid());
        assert!(!MemberInput::Objective("x".repeat(4001)).is_valid());
        assert!(!MemberInput::Objective("   ".into()).is_valid());
        assert!(!MemberInput::Text("x".repeat(401)).is_valid());
        assert!(!MemberInput::ChooseClient("a b".into()).is_valid());
        let id = generated_id("e-", &[0xab; 16]);
        assert_eq!(id.len(), 34);
        assert!(valid_scope_id(&id));
        assert!(task_key(&generated_id("s-", &[1; 16])).is_some());
        assert!(task_key(&"x".repeat(128)).is_none());
        assert!(normalize_name(&"界".repeat(201)).is_none());
        assert_eq!(
            normalize_name("\u{3000}Alder\u{00a0}").as_deref(),
            Some("Alder")
        );
    }
}
