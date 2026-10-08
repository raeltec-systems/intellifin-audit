//! Durable Task meanings. These types imply no model, tool or audit execution.
use crate::identity::{Scope, valid_scope_id};

pub const COMMAND_CONTENT_MAX: usize = 4_000;
pub const TASK_PAGE_SIZE: usize = 100;
pub const EVENT_PAGE_SIZE: usize = 100;
pub const MAX_DELIVERY_BATCH: usize = 8;
/// Open (non-stopped) Tasks per engagement; Create and Continue refuse beyond it.
pub const MAX_OPEN_TASKS: usize = 100;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CommandKind {
    Create,
    Guide,
    Pause,
    Resume,
    Stop,
    Continue,
}

impl CommandKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Create => "create",
            Self::Guide => "guide",
            Self::Pause => "pause",
            Self::Resume => "resume",
            Self::Stop => "stop",
            Self::Continue => "continue",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "create" => Some(Self::Create),
            "guide" => Some(Self::Guide),
            "pause" => Some(Self::Pause),
            "resume" => Some(Self::Resume),
            "stop" => Some(Self::Stop),
            "continue" => Some(Self::Continue),
            _ => None,
        }
    }

    /// Guidance and cessation admission have capacity independent of work/reads.
    pub const fn is_control(self) -> bool {
        matches!(self, Self::Guide | Self::Pause | Self::Stop)
    }
}

/// Equality represents the owned, parsed meaning, independent of JSON key order.
/// The repository additionally binds the key and meaning to author and full scope.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TaskCommand {
    pub key: String,
    pub kind: CommandKind,
    pub task_id: Option<String>,
    pub cycle_id: Option<String>,
    pub content: Option<String>,
    /// Optional explicit audit context belongs to Create/Guide exact meaning.
    /// Guide replaces context at a safe boundary; omission leaves it unchanged.
    pub context: Option<crate::methodology::TaskContext>,
}

impl TaskCommand {
    pub fn is_valid(&self) -> bool {
        if !valid_scope_id(&self.key)
            || self
                .context
                .as_ref()
                .is_some_and(|context| !context.is_valid())
            || (!matches!(self.kind, CommandKind::Create | CommandKind::Guide)
                && self.context.is_some())
        {
            return false;
        }
        let target = match (&self.task_id, &self.cycle_id) {
            (Some(task), Some(cycle)) => valid_scope_id(task) && valid_scope_id(cycle),
            _ => false,
        };
        let content = self.content.as_deref().is_some_and(|value| {
            !value.trim().is_empty()
                && value.len() <= COMMAND_CONTENT_MAX
                && !value
                    .chars()
                    .any(|ch| ch.is_control() && !matches!(ch, '\n' | '\r' | '\t'))
        });
        match self.kind {
            CommandKind::Create => self.task_id.is_none() && self.cycle_id.is_none() && content,
            CommandKind::Guide => target && content,
            CommandKind::Pause
            | CommandKind::Resume
            | CommandKind::Stop
            | CommandKind::Continue => target && self.content.is_none(),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReceiptStatus {
    Received,
}

impl ReceiptStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Received => "received",
        }
    }
}

/// Immutable admission acknowledgement. Applied and cessation are separate facts.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CommandReceipt {
    pub command_id: String,
    pub task_id: String,
    pub cycle_id: String,
    pub event_cursor: String,
    pub status: ReceiptStatus,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TaskState {
    Ready,
    Running,
    Paused,
    Stopped,
    Waiting,
}

impl TaskState {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Ready => "ready",
            Self::Running => "running",
            Self::Paused => "paused",
            Self::Stopped => "stopped",
            Self::Waiting => "waiting",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "ready" => Some(Self::Ready),
            "running" => Some(Self::Running),
            "paused" => Some(Self::Paused),
            "stopped" => Some(Self::Stopped),
            "waiting" => Some(Self::Waiting),
            _ => None,
        }
    }

    /// A valid cycle target is additionally required in the atomic repository.
    /// Repeating an identical key returns its receipt before transition checks.
    pub const fn accepts(self, command: CommandKind, cessation: Cessation) -> bool {
        match command {
            CommandKind::Create => false,
            CommandKind::Guide => true,
            CommandKind::Pause => !matches!(self, Self::Stopped),
            CommandKind::Stop => true,
            CommandKind::Resume => {
                matches!(self, Self::Paused) && matches!(cessation, Cessation::Confirmed)
            }
            CommandKind::Continue => {
                matches!(self, Self::Stopped) && matches!(cessation, Cessation::Confirmed)
            }
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Cessation {
    None,
    Pending,
    Confirmed,
    ReconciliationRequired,
}

impl Cessation {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Pending => "pending",
            Self::Confirmed => "confirmed",
            Self::ReconciliationRequired => "reconciliation_required",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "none" => Some(Self::None),
            "pending" => Some(Self::Pending),
            "confirmed" => Some(Self::Confirmed),
            "reconciliation_required" => Some(Self::ReconciliationRequired),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TaskSnapshot {
    pub id: String,
    pub cycle_id: String,
    pub objective: String,
    pub working_brief: String,
    pub state: TaskState,
    pub cessation: Cessation,
    pub intent_revision: u64,
    pub revision: u64,
    pub execution_epoch: u64,
    pub accountable_actor: String,
    pub accountable_label: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TaskPage {
    pub tasks: Vec<TaskSnapshot>,
    pub next_cursor: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TaskEvent {
    pub cursor: String,
    pub task_id: String,
    pub cycle_id: String,
    pub command_id: Option<String>,
    pub kind: String,
}

/// Content-free routing metadata. Delivery grants no Task or execution authority.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WakeupRoute {
    pub id: String,
    pub actor_id: String,
    pub scope: Scope,
    pub task_id: String,
}

/// The exact producing basis of one inert execution attempt. Ownership, execution
/// epoch and intent are distinct fences; none substitutes for current authority.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ClaimBasis {
    pub actor_id: String,
    pub scope: Scope,
    pub task_id: String,
    pub cycle_id: String,
    pub claim_id: String,
    pub worker_id: String,
    pub process_instance: String,
    pub owner_epoch: i64,
    pub execution_epoch: i64,
    pub intent_revision: i64,
}

/// An exact-attempt receipt capability, never a general execution permission.
/// Consumption is the possible-dispatch cutoff even when no child is witnessed.
/// Deliberately neither Debug, Clone nor Serialize: retain the original capability
/// only for bounded immutable observations, including a stale producer's late fact.
///
/// ```compile_fail
/// use zobba_domain::task::ConsumedAttempt;
/// fn diagnostic(attempt: &ConsumedAttempt) -> String {
///     format!("{attempt:?}")
/// }
/// ```
pub struct ConsumedAttempt {
    pub basis: ClaimBasis,
    pub receipt_capability: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Decision {
    Idle,
    Execute(Box<ClaimBasis>),
    Waiting,
}

/// Factual observation of the exact inert child. No outcome completes an audit
/// objective, proves an external effect, or grants permission to start more work.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Observation {
    /// Successful exit of the actual inert child, after its exact instance joined.
    Completed,
    /// Cancellation was requested and the actual child was subsequently joined.
    Cancelled,
    /// The actual child joined with an unsuccessful exit status.
    Exited,
    /// No child was created: spawning failed or shutdown preceded spawning.
    NotStarted,
}

impl Observation {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Completed => "completed",
            Self::Cancelled => "cancelled",
            Self::Exited => "exited",
            Self::NotStarted => "not_started",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn command(kind: CommandKind) -> TaskCommand {
        TaskCommand {
            context: None,
            key: "retry_key".into(),
            kind,
            task_id: (kind != CommandKind::Create).then(|| "task".into()),
            cycle_id: (kind != CommandKind::Create).then(|| "cycle".into()),
            content: matches!(kind, CommandKind::Create | CommandKind::Guide)
                .then(|| "Retained plain text\nwith guidance".into()),
        }
    }

    #[test]
    fn command_matrix_requires_exact_target_and_content() {
        for kind in [
            CommandKind::Create,
            CommandKind::Guide,
            CommandKind::Pause,
            CommandKind::Resume,
            CommandKind::Stop,
            CommandKind::Continue,
        ] {
            let valid = command(kind);
            assert!(valid.is_valid());
            assert_eq!(CommandKind::parse(kind.as_str()), Some(kind));
            let mut invalid = valid.clone();
            invalid.key = "bad key".into();
            assert!(!invalid.is_valid());
            let mut invalid = valid.clone();
            invalid.cycle_id = if kind == CommandKind::Create {
                Some("cycle".into())
            } else {
                None
            };
            assert!(!invalid.is_valid());
            let mut invalid = valid;
            invalid.content = if matches!(kind, CommandKind::Create | CommandKind::Guide) {
                None
            } else {
                Some("unexpected".into())
            };
            assert!(!invalid.is_valid());
        }
    }

    #[test]
    fn exact_text_is_retained_but_invalid_or_unbounded_content_is_refused() {
        let mut input = command(CommandKind::Create);
        for invalid in [
            " \n\t".into(),
            "x\0y".into(),
            "x".repeat(COMMAND_CONTENT_MAX + 1),
        ] {
            input.content = Some(invalid);
            assert!(!input.is_valid());
        }
        input.content = Some("  meaningful exact text  ".into());
        assert!(input.is_valid());
        let mut changed = input.clone();
        changed.content = Some("meaningful exact text".into());
        assert_ne!(input, changed);
    }

    #[test]
    fn explicit_create_and_guide_context_is_exact_meaning_and_never_chat_policy() {
        let mut create = command(CommandKind::Create);
        create.context = Some(crate::methodology::TaskContext {
            audit_area: Some("revenue".into()),
            period_start: Some("2025-01-01".into()),
            period_end: Some("2025-12-31".into()),
        });
        assert!(create.is_valid());
        let mut changed = create.clone();
        changed.context.as_mut().unwrap().audit_area = Some("inventory".into());
        assert_ne!(create, changed);
        let mut guide = command(CommandKind::Guide);
        guide.context = create.context.clone();
        assert!(guide.is_valid());
        let mut changed_guide = guide.clone();
        changed_guide.context = changed.context;
        assert_ne!(guide, changed_guide);
        for kind in [
            CommandKind::Pause,
            CommandKind::Resume,
            CommandKind::Stop,
            CommandKind::Continue,
        ] {
            let mut control = command(kind);
            control.context = create.context.clone();
            assert!(!control.is_valid());
        }
        create.context.as_mut().unwrap().period_end = Some("2024-12-31".into());
        assert!(!create.is_valid());
    }

    #[test]
    fn resumption_requires_explicit_command_and_observed_cessation() {
        for state in [
            TaskState::Ready,
            TaskState::Running,
            TaskState::Paused,
            TaskState::Stopped,
            TaskState::Waiting,
        ] {
            assert_eq!(TaskState::parse(state.as_str()), Some(state));
            assert!(state.accepts(CommandKind::Guide, Cessation::Pending));
            assert!(!state.accepts(CommandKind::Create, Cessation::None));
            assert_eq!(
                state.accepts(CommandKind::Resume, Cessation::Confirmed),
                state == TaskState::Paused
            );
            assert_eq!(
                state.accepts(CommandKind::Continue, Cessation::Confirmed),
                state == TaskState::Stopped
            );
            for unresolved in [
                Cessation::None,
                Cessation::Pending,
                Cessation::ReconciliationRequired,
            ] {
                assert!(!state.accepts(CommandKind::Resume, unresolved));
                assert!(!state.accepts(CommandKind::Continue, unresolved));
            }
        }
        assert!(!TaskState::Stopped.accepts(CommandKind::Pause, Cessation::Confirmed));
    }
}
