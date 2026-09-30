//! Read-only engagement conversation projected from immutable accepted commands.
use crate::{
    identity::Scope,
    task::{CommandKind, TaskEvent, TaskSnapshot},
};

pub const CONVERSATION_PAGE_SIZE: usize = 100;
pub const CONVERSATION_REPLAY_LIMIT: u64 = 1_000;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConversationMessage {
    pub command_id: String,
    pub key: String,
    pub author_id: String,
    pub author_label: String,
    pub kind: CommandKind,
    pub task_id: String,
    pub cycle_id: String,
    pub target_task_id: Option<String>,
    pub target_cycle_id: Option<String>,
    pub content: Option<String>,
    pub received_cursor: String,
    pub applied_cursor: Option<String>,
}

/// Latest retained Received or Applied fact, independent of displayed pages.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConversationActivity {
    pub cursor: String,
    pub task_id: String,
}

/// All state and receipt facts are from one database statement snapshot. Lists
/// are explicitly partial; callers never interpret a page as complete history.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConversationSnapshot {
    pub scope: Scope,
    pub watermark: String,
    pub latest_activity: Option<ConversationActivity>,
    pub messages: Vec<ConversationMessage>,
    pub before_cursor: Option<String>,
    pub tasks: Vec<TaskSnapshot>,
    pub next_task_cursor: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConversationHistory {
    pub scope: Scope,
    pub watermark: String,
    pub messages: Vec<ConversationMessage>,
    pub before_cursor: Option<String>,
}

/// Events invalidate current state; a fresh snapshot atomically replaces it.
/// `next_cursor` advances only over returned events, never omitted events. A
/// gap or replay overflow requires a new snapshot, not optimistic progress.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConversationFeed {
    pub scope: Scope,
    pub watermark: String,
    pub events: Vec<TaskEvent>,
    pub next_cursor: String,
    pub has_more: bool,
    pub resync_required: bool,
}
