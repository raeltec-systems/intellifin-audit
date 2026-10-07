//! Durable work-cycle facts and deterministic routing. Nothing here calls a model,
//! interprets model output, or grants Task, tool or Permissions authority.
use crate::{identity::valid_scope_id, permissions::SourceFact};

/// One cycle examines at most this many model turns before it must wait for
/// guidance. A text-only turn ends the cycle earlier as `waiting`.
pub const MAX_TURNS_PER_CYCLE: usize = 16;
/// Steps per cycle: each turn plus at most its bounded tool proposals.
pub const MAX_STEPS_PER_CYCLE: usize = 4096;
pub const MAX_ROUTING_CANDIDATES: usize = 32;
pub const BRIEF_PAGE_SIZE: usize = 50;
pub const STEP_LABEL_MAX: usize = 200;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StepKind {
    ModelTurn,
    ToolStep,
}

impl StepKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ModelTurn => "model_turn",
            Self::ToolStep => "tool_step",
        }
    }
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "model_turn" => Some(Self::ModelTurn),
            "tool_step" => Some(Self::ToolStep),
            _ => None,
        }
    }
}

/// Recorded outcome of one step. Statuses are facts about this step, never an
/// audit conclusion: `responded` means the model returned text, not that the
/// objective is complete.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StepStatus {
    /// Model turn with complete tool proposals eligible for admission.
    Proposed,
    /// Model turn with text only. The Task waits for guidance.
    Responded,
    /// Model turn or proposal produced under an intent that is no longer
    /// current. Recorded, never admitted; the next turn reconsiders it.
    Superseded,
    /// Model turn that did not succeed (refusal, failure, cancellation or an
    /// unknown possibly accepted outcome). No proposal is executable.
    Failed,
    /// Tool proposal admitted, consumed, dispatched and resolved.
    Completed,
    /// Tool proposal refused at admission or consumption; no dispatch.
    Refused,
    /// Consumed tool attempt whose effect is unknown.
    ReconciliationRequired,
}

impl StepStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Proposed => "proposed",
            Self::Responded => "responded",
            Self::Superseded => "superseded",
            Self::Failed => "failed",
            Self::Completed => "completed",
            Self::Refused => "refused",
            Self::ReconciliationRequired => "reconciliation_required",
        }
    }
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "proposed" => Some(Self::Proposed),
            "responded" => Some(Self::Responded),
            "superseded" => Some(Self::Superseded),
            "failed" => Some(Self::Failed),
            "completed" => Some(Self::Completed),
            "refused" => Some(Self::Refused),
            "reconciliation_required" => Some(Self::ReconciliationRequired),
            _ => None,
        }
    }
    pub const fn valid_for(self, kind: StepKind) -> bool {
        match kind {
            StepKind::ModelTurn => matches!(
                self,
                Self::Proposed | Self::Responded | Self::Superseded | Self::Failed
            ),
            StepKind::ToolStep => matches!(
                self,
                Self::Completed | Self::Refused | Self::Superseded | Self::ReconciliationRequired
            ),
        }
    }
}

/// The next action the recorded facts imply. It is attributed to the
/// invocation that proposed it; it is not a promise that it will execute.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum NextAction {
    /// Admit the named catalogue tool proposed by the invocation.
    Tool { name: String },
    /// Run another model turn under the applied brief.
    ModelTurn,
    /// Wait for human guidance; the model responded without a tool proposal.
    AwaitGuidance,
    /// Wait for reconciliation of a possibly dispatched effect.
    Reconcile,
}

impl NextAction {
    pub fn descriptor(&self) -> String {
        match self {
            Self::Tool { name } => format!("tool:{name}"),
            Self::ModelTurn => "model_turn".into(),
            Self::AwaitGuidance => "await_guidance".into(),
            Self::Reconcile => "reconcile".into(),
        }
    }
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "model_turn" => Some(Self::ModelTurn),
            "await_guidance" => Some(Self::AwaitGuidance),
            "reconcile" => Some(Self::Reconcile),
            _ => value
                .strip_prefix("tool:")
                .filter(|name| !name.is_empty() && name.len() <= 128)
                .map(|name| Self::Tool { name: name.into() }),
        }
    }
}

/// One durable step fact. Restart reconstructs work from these facts plus the
/// referenced invocation, operation and receipt records, never from chat text.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TaskStep {
    pub task_id: String,
    pub cycle_id: String,
    pub ordinal: u32,
    pub kind: StepKind,
    pub intent_revision: u64,
    pub execution_epoch: u64,
    pub invocation_id: Option<String>,
    pub call_id: Option<String>,
    pub operation_id: Option<String>,
    pub attempt_id: Option<String>,
    /// Exact terminal receipt disposition of a completed tool step.
    pub fact: Option<SourceFact>,
    pub status: StepStatus,
    pub next_action: Option<NextAction>,
    /// Fixed platform label describing the step, never model text.
    pub current_work: String,
}

impl TaskStep {
    pub fn is_valid(&self) -> bool {
        let optional = |value: &Option<String>| value.as_ref().is_none_or(|v| valid_scope_id(v));
        valid_scope_id(&self.task_id)
            && valid_scope_id(&self.cycle_id)
            && (self.ordinal as usize) < MAX_STEPS_PER_CYCLE
            && self.status.valid_for(self.kind)
            && self.intent_revision > 0
            && self.execution_epoch > 0
            && optional(&self.invocation_id)
            && optional(&self.operation_id)
            && optional(&self.attempt_id)
            && self.call_id.as_ref().is_none_or(|v| {
                !v.is_empty()
                    && v.len() <= 200
                    && v.bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"_.:-".contains(&b))
            })
            && match self.kind {
                StepKind::ModelTurn => self.call_id.is_none() && self.operation_id.is_none(),
                StepKind::ToolStep => self.invocation_id.is_some() && self.call_id.is_some(),
            }
            && (self.invocation_id.is_some() || self.status == StepStatus::Failed)
            && match self.status {
                StepStatus::Completed => {
                    self.fact.is_some_and(SourceFact::is_resolved)
                        && self.operation_id.is_some()
                        && self.attempt_id.is_some()
                }
                StepStatus::ReconciliationRequired => {
                    self.fact.is_none() && self.operation_id.is_some() && self.attempt_id.is_some()
                }
                _ => self.fact.is_none(),
            }
            && !self.current_work.is_empty()
            && self.current_work.len() <= STEP_LABEL_MAX
            && !self.current_work.chars().any(char::is_control)
    }
}

/// One accepted brief revision with its separate application fact.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BriefRevision {
    pub command_id: String,
    pub task_id: String,
    pub cycle_id: String,
    pub content: String,
    pub received_cursor: u64,
    /// Number of steps the cycle had recorded when the brief was applied, i.e.
    /// the boundary before step `applied_boundary`. None: not yet applied.
    pub applied_boundary: Option<u32>,
    pub applied_cursor: Option<u64>,
    /// The later accepted revision that replaced this one, if any.
    pub superseded_by: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RoutingCandidate {
    pub task_id: String,
    pub cycle_id: String,
    pub objective: String,
}

/// A durable targeting question. Nothing is applied until an answer names
/// candidates that are still current.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RoutingQuestion {
    pub id: String,
    pub key: String,
    pub content: String,
    pub candidates: Vec<RoutingCandidate>,
    /// Selected Task IDs and the Guide command each produced, once answered.
    pub answer: Option<Vec<RoutedGuide>>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RoutedGuide {
    pub task_id: String,
    pub cycle_id: String,
    pub command_id: String,
    pub event_cursor: String,
}

/// Why a Task card needs the auditor, derived only from recorded facts.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Attention {
    AwaitingGuidance,
    ReconciliationRequired,
    StepFailed,
    CycleBounded,
}

impl Attention {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::AwaitingGuidance => "awaiting_guidance",
            Self::ReconciliationRequired => "reconciliation_required",
            Self::StepFailed => "step_failed",
            Self::CycleBounded => "cycle_bounded",
        }
    }
}

/// Durable work projection for one Task card. Nothing here is model text.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TaskWork {
    pub task_id: String,
    pub cycle_id: String,
    pub methodology_binding_id: Option<String>,
    pub methodology_status: Option<String>,
    /// Most recent steps of the current cycle, in ordinal order.
    pub steps: Vec<TaskStep>,
    /// Most recent brief revisions, newest first.
    pub briefs: Vec<BriefRevision>,
    pub current_work: Option<String>,
    pub next_action: Option<NextAction>,
    /// The invocation that proposed `next_action`, when one did.
    pub next_action_invocation_id: Option<String>,
    pub attention: Option<Attention>,
}

/// Result of admitting an untargeted direction.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Direction {
    Routed(crate::task::CommandReceipt),
    Asked(RoutingQuestion),
}

/// Derive the card's position from recorded steps and Task state.
pub fn summarise(
    steps: &[TaskStep],
    waiting: bool,
    reconciliation: bool,
) -> (
    Option<String>,
    Option<NextAction>,
    Option<String>,
    Option<Attention>,
) {
    let Some(last) = steps.last() else {
        return (None, None, None, None);
    };
    let turns = steps
        .iter()
        .filter(|step| step.kind == StepKind::ModelTurn)
        .count();
    let next_invocation = match (&last.next_action, last.kind) {
        (Some(NextAction::Tool { .. }), _) | (Some(NextAction::AwaitGuidance), _) => {
            last.invocation_id.clone()
        }
        _ => None,
    };
    let attention = if reconciliation || last.status == StepStatus::ReconciliationRequired {
        Some(Attention::ReconciliationRequired)
    } else if last.status == StepStatus::Failed {
        Some(Attention::StepFailed)
    } else if waiting && last.status == StepStatus::Responded {
        Some(Attention::AwaitingGuidance)
    } else if waiting && turns >= MAX_TURNS_PER_CYCLE {
        Some(Attention::CycleBounded)
    } else {
        None
    };
    (
        Some(last.current_work.clone()),
        last.next_action.clone(),
        next_invocation,
        attention,
    )
}

/// Server-side deterministic routing. Never consults a model.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Routing {
    /// Exactly one candidate: admit a Guide to it.
    Target(RoutingCandidate),
    /// Two or more: ask one targeting question listing them.
    Ask(Vec<RoutingCandidate>),
    /// No non-stopped Task exists to receive guidance.
    NoCandidate,
}

/// `candidates` are the scope's non-stopped Tasks. Order is normalised so the
/// question is identical however the caller listed them.
pub fn route_direction(mut candidates: Vec<RoutingCandidate>) -> Routing {
    candidates.sort_by(|a, b| a.task_id.cmp(&b.task_id));
    candidates.dedup_by(|a, b| a.task_id == b.task_id);
    match candidates.len() {
        0 => Routing::NoCandidate,
        1 => Routing::Target(candidates.remove(0)),
        _ => Routing::Ask(candidates),
    }
}

/// Validate an answer against the question's candidates. Unknown (foreign)
/// Task IDs and duplicates are refused; order is normalised.
pub fn answer_selection(question: &RoutingQuestion, selected: &[String]) -> Option<Vec<String>> {
    if selected.is_empty() || selected.len() > MAX_ROUTING_CANDIDATES {
        return None;
    }
    let mut ids: Vec<String> = selected.to_vec();
    ids.sort();
    if ids.windows(2).any(|pair| pair[0] == pair[1])
        || ids
            .iter()
            .any(|id| !question.candidates.iter().any(|c| &c.task_id == id))
    {
        return None;
    }
    Some(ids)
}

fn material(parts: &[&[u8]]) -> Vec<u8> {
    let mut bytes = Vec::new();
    for part in parts {
        bytes.extend_from_slice(&(part.len() as u64).to_be_bytes());
        bytes.extend_from_slice(part);
    }
    bytes
}

/// Logical model invocation key. The same Task, cycle, producing intent and
/// step ordinal always recover the same durable invocation after restart.
pub fn invocation_key(task_id: &str, cycle_id: &str, intent: u64, ordinal: u32) -> String {
    format!(
        "turn-{}",
        sha256_hex(&material(&[
            b"zobba-turn-v1",
            task_id.as_bytes(),
            cycle_id.as_bytes(),
            &intent.to_be_bytes(),
            &ordinal.to_be_bytes(),
        ]))
    )
}

/// Logical operation key for one proposal of one invocation.
pub fn operation_key(invocation_id: &str, call_id: &str) -> String {
    format!(
        "tool-{}",
        sha256_hex(&material(&[
            b"zobba-tool-v1",
            invocation_id.as_bytes(),
            call_id.as_bytes(),
        ]))
    )
}

/// Idempotency key of the Guide an answered question produces for one target.
/// Retrying the answer maps to the same keys and therefore the same receipts.
pub fn routed_guide_key(question_key: &str, task_id: &str) -> String {
    format!(
        "route-{}",
        sha256_hex(&material(&[
            b"zobba-route-v1",
            question_key.as_bytes(),
            task_id.as_bytes(),
        ]))
    )
}

/// Dependency-free SHA-256 (FIPS 180-4) for deterministic key derivation only.
pub fn sha256_hex(input: &[u8]) -> String {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];
    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
    ];
    let mut message = input.to_vec();
    let bit_length = (input.len() as u64).wrapping_mul(8);
    message.push(0x80);
    while message.len() % 64 != 56 {
        message.push(0);
    }
    message.extend_from_slice(&bit_length.to_be_bytes());
    for block in message.chunks(64) {
        let mut w = [0u32; 64];
        for (i, word) in block.chunks(4).enumerate() {
            w[i] = u32::from_be_bytes([word[0], word[1], word[2], word[3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }
        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh] = h;
        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ (!e & g);
            let t1 = hh
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let t2 = s0.wrapping_add(maj);
            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(t1);
            d = c;
            c = b;
            b = a;
            a = t1.wrapping_add(t2);
        }
        for (slot, value) in h.iter_mut().zip([a, b, c, d, e, f, g, hh]) {
            *slot = slot.wrapping_add(value);
        }
    }
    h.iter().map(|word| format!("{word:08x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn candidate(id: &str) -> RoutingCandidate {
        RoutingCandidate {
            task_id: id.into(),
            cycle_id: format!("{id}-cycle"),
            objective: format!("Objective {id}"),
        }
    }

    #[test]
    fn sha256_matches_published_vectors() {
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(
            sha256_hex(b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
            "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
        );
    }

    #[test]
    fn routing_is_deterministic_and_never_guesses_between_tasks() {
        assert_eq!(route_direction(vec![]), Routing::NoCandidate);
        assert_eq!(
            route_direction(vec![candidate("a")]),
            Routing::Target(candidate("a"))
        );
        let asked = route_direction(vec![candidate("b"), candidate("a"), candidate("a")]);
        assert_eq!(asked, Routing::Ask(vec![candidate("a"), candidate("b")]));
        assert_eq!(
            asked,
            route_direction(vec![candidate("a"), candidate("b")]),
            "listing order does not change the question"
        );
    }

    #[test]
    fn answers_name_only_listed_candidates() {
        let question = RoutingQuestion {
            id: "q".into(),
            key: "k".into(),
            content: "Check the sample".into(),
            candidates: vec![candidate("a"), candidate("b")],
            answer: None,
        };
        assert_eq!(
            answer_selection(&question, &["b".into(), "a".into()]),
            Some(vec!["a".into(), "b".into()])
        );
        for bad in [
            vec![],
            vec!["c".to_string()],
            vec!["a".into(), "a".into()],
            vec!["a".into(), "foreign".into()],
        ] {
            assert_eq!(answer_selection(&question, &bad), None, "{bad:?}");
        }
    }

    #[test]
    fn keys_are_bounded_scope_ids_and_bind_every_component() {
        let base = invocation_key("task", "cycle", 1, 0);
        assert!(valid_scope_id(&base));
        assert_eq!(base, invocation_key("task", "cycle", 1, 0));
        for other in [
            invocation_key("task2", "cycle", 1, 0),
            invocation_key("task", "cycle2", 1, 0),
            invocation_key("task", "cycle", 2, 0),
            invocation_key("task", "cycle", 1, 1),
            // Length prefixes keep component boundaries distinct.
            invocation_key("taskc", "ycle", 1, 0),
        ] {
            assert_ne!(base, other);
        }
        let long = "x".repeat(128);
        assert!(valid_scope_id(&invocation_key(
            &long,
            &long,
            u64::MAX,
            u32::MAX
        )));
        assert!(valid_scope_id(&operation_key(&long, "call:1")));
        assert_ne!(operation_key("i", "c1"), operation_key("i", "c2"));
        let guide = routed_guide_key("question-key", "task-a");
        assert!(valid_scope_id(&guide));
        assert_ne!(guide, routed_guide_key("question-key", "task-b"));
        assert_ne!(guide, routed_guide_key("question-key2", "task-a"));
    }

    #[test]
    fn step_vocabulary_is_closed_and_kind_specific() {
        for status in [
            StepStatus::Proposed,
            StepStatus::Responded,
            StepStatus::Superseded,
            StepStatus::Failed,
            StepStatus::Completed,
            StepStatus::Refused,
            StepStatus::ReconciliationRequired,
        ] {
            assert_eq!(StepStatus::parse(status.as_str()), Some(status));
        }
        assert!(StepStatus::Responded.valid_for(StepKind::ModelTurn));
        assert!(!StepStatus::Responded.valid_for(StepKind::ToolStep));
        assert!(!StepStatus::Completed.valid_for(StepKind::ModelTurn));
        for action in [
            NextAction::Tool {
                name: "send_exact".into(),
            },
            NextAction::ModelTurn,
            NextAction::AwaitGuidance,
            NextAction::Reconcile,
        ] {
            assert_eq!(NextAction::parse(&action.descriptor()), Some(action));
        }
        assert_eq!(NextAction::parse("tool:"), None);
        let mut step = TaskStep {
            task_id: "task".into(),
            cycle_id: "cycle".into(),
            ordinal: 0,
            kind: StepKind::ModelTurn,
            intent_revision: 1,
            execution_epoch: 1,
            invocation_id: Some("invocation".into()),
            call_id: None,
            operation_id: None,
            attempt_id: None,
            fact: None,
            status: StepStatus::Proposed,
            next_action: Some(NextAction::ModelTurn),
            current_work: "Model turn 1".into(),
        };
        assert!(step.is_valid());
        step.call_id = Some("call".into());
        assert!(!step.is_valid());
        step.call_id = None;
        step.invocation_id = None;
        assert!(
            !step.is_valid(),
            "only a failed turn can lack an invocation"
        );
        step.status = StepStatus::Failed;
        assert!(step.is_valid());
        step.current_work = "bad\u{0}label".into();
        assert!(!step.is_valid());
    }
}
