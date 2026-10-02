//! Bounded immutable history projections. These records carry attribution and
//! observations, never receipt capabilities, producer secrets or dispatch claims.
use super::{OperationDecision, SourceFact};
use crate::identity::valid_scope_id;

pub const OPERATION_HISTORY_PAGE_SIZE: usize = 50;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct OperationHistoryQuery {
    pub after_decision_id: Option<String>,
    pub after_attempt_id: Option<String>,
    pub after_observation_id: Option<String>,
}
impl OperationHistoryQuery {
    pub fn is_valid(&self) -> bool {
        [
            &self.after_decision_id,
            &self.after_attempt_id,
            &self.after_observation_id,
        ]
        .iter()
        .all(|value| value.as_deref().is_none_or(valid_scope_id))
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DecisionHistoryEntry {
    pub key: String,
    pub decision: OperationDecision,
    pub recorded_at: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AttemptHistoryEntry {
    pub id: String,
    pub operation_id: String,
    pub number: u64,
    pub execution_epoch: u64,
    pub methodology_binding_id: String,
    pub request_digest: String,
    pub recorded_at: i64,
    /// Non-secret logical source identities; never URLs or capability handles.
    pub source_id: Option<String>,
    pub ledger_id: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ObservationSource {
    Dispatch,
    Reconciliation,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ObservationHistoryEntry {
    pub id: String,
    pub attempt_id: String,
    pub fact: SourceFact,
    pub source: ObservationSource,
    pub recorded_at: i64,
}

/// Each immutable collection is independently ordered by ID and bounded at 50.
/// Cursors describe fresh history pages, not an ordered change feed. Restart a
/// collection from its first page to discover records committed during paging.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OperationHistory {
    pub operation_id: String,
    pub decisions: Vec<DecisionHistoryEntry>,
    pub attempts: Vec<AttemptHistoryEntry>,
    pub observations: Vec<ObservationHistoryEntry>,
    pub decision_next_cursor: Option<String>,
    pub attempt_next_cursor: Option<String>,
    pub observation_next_cursor: Option<String>,
}
