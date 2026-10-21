//! Bounded projections reauthorize every read; they confer no command authority.
use crate::task::TaskError;
use std::future::Future;
use zobba_domain::{
    conversation::{ConversationFeed, ConversationHistory, ConversationSnapshot},
    identity::Scope,
};

pub trait ConversationRead: Send + Sync {
    fn snapshot(
        &self,
        actor: &str,
        scope: &Scope,
    ) -> impl Future<Output = Result<ConversationSnapshot, TaskError>> + Send;
    fn history(
        &self,
        actor: &str,
        scope: &Scope,
        through: u64,
        before: Option<u64>,
        task_id: Option<&str>,
    ) -> impl Future<Output = Result<ConversationHistory, TaskError>> + Send;
    fn events(
        &self,
        actor: &str,
        scope: &Scope,
        after: u64,
    ) -> impl Future<Output = Result<ConversationFeed, TaskError>> + Send;
}
