//! Durable native-model orchestration. No retry, tool dispatch, or authority is
//! inferred from model success. SQL owners implement the atomic current checks.
pub mod wire;
use std::{
    future::Future,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

use crate::knowledge::{RecordReference, RecordStatus, VerifyKnowledge};
pub use zobba_domain::model::*;
use zobba_domain::{
    identity::{Scope, valid_scope_id},
    permissions::{Action, CanonicalOperation, Operation, SET_MAX},
    task::ClaimBasis,
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ContextEntry {
    pub source_id: String,
    pub input_class: String,
    pub knowledge: Option<RecordReference>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ContextManifest {
    /// Verified in the disclosure transaction under the same Task/engagement
    /// locks, not as an earlier independent observation of current authority.
    pub verification: VerifyKnowledge,
    pub entries: Vec<ContextEntry>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ModelRequest {
    pub key: String,
    pub basis: ClaimBasis,
    pub profile: ModelProfile,
    pub catalogue: ToolCatalog,
    /// Exact owned operation describing disclosure to the profile destination.
    /// Accepted and current Permissions must both authorize it before I/O.
    pub disclosure: CanonicalOperation,
    pub context: ContextManifest,
    pub input_classes: Vec<String>,
    pub messages: Vec<ModelMessage>,
    /// Ordered owned history follows messages. Tool call/results are an exact
    /// complete pair; their data cannot create a new trusted message role.
    pub history: Vec<HistoryItem>,
    pub effort: Effort,
    pub max_output_tokens: u32,
    pub structured_output: Option<ArgumentSchema>,
}
/// Trusted application composition supplies requests and manifests. There is no
/// public raw-prompt endpoint: a source cannot choose System, input classes,
/// knowledge references, destination, profile, or the disclosure operation.
pub trait ModelQualificationSource: Send + Sync {
    /// Registration must match account/provider/model/capability revision/destination
    /// and qualification class exactly. Admin declarations are not proof.
    fn qualified(&self, profile: &ModelProfile) -> bool;
}
impl ModelRequest {
    pub fn validate(&self) -> Result<(), ModelError> {
        let basis = &self.basis;
        if !valid_scope_id(&self.key)
            || !basis.scope.is_valid()
            || [
                &basis.actor_id,
                &basis.task_id,
                &basis.cycle_id,
                &basis.claim_id,
                &basis.worker_id,
                &basis.process_instance,
            ]
            .iter()
            .any(|v| !valid_scope_id(v))
            || basis.owner_epoch <= 0
            || basis.execution_epoch <= 0
            || basis.intent_revision <= 0
            || !self.profile.is_valid()
            || !self.catalogue.is_valid()
            || !self.disclosure.is_valid()
            || self.disclosure.action != Action::Send
            || self.disclosure.destination != self.profile.destination
            || self.disclosure.account_id != self.profile.account_id
            || self.max_output_tokens == 0
            || self.max_output_tokens > self.profile.max_output_tokens
        {
            return Err(ModelError::Invalid);
        }
        if !self.profile.enabled || !self.catalogue.enabled {
            return Err(ModelError::Fenced);
        }
        if self.profile.qualification == Qualification::Unqualified {
            return Err(ModelError::Unqualified);
        }
        if ((!self.catalogue.tools.is_empty()
            || self
                .history
                .iter()
                .any(|item| matches!(item, HistoryItem::ToolExchange(_))))
            && !self.profile.capabilities.tools)
            || (self.structured_output.is_some() && !self.profile.capabilities.structured_output)
            || (self.effort != Effort::None && !self.profile.capabilities.reasoning)
        {
            return Err(ModelError::Unsupported);
        }
        if self
            .structured_output
            .as_ref()
            .is_some_and(|s| !s.is_valid())
        {
            return Err(ModelError::Invalid);
        }
        if self.messages.is_empty()
            || self.messages.len() > MAX_MESSAGES
            || self.history.len() > MAX_HISTORY_ITEMS
            || self.messages.iter().map(|m| m.text.len()).sum::<usize>() > MAX_INPUT_BYTES
            || self.context.entries.len() > MAX_MESSAGES
            || self.input_classes.is_empty()
            || self.input_classes.len() > SET_MAX
        {
            return Err(ModelError::Capacity);
        }
        if self.input_classes.iter().any(|v| !valid_scope_id(v))
            || !self.input_classes.windows(2).all(|p| p[0] < p[1])
        {
            return Err(ModelError::Invalid);
        }
        let verification = &self.context.verification;
        if verification.expected_execution_epoch != basis.execution_epoch as u64
            || !valid_scope_id(&verification.expected_methodology_binding_id)
            || verification.exact
            || verification.include_inactive
            || verification.items.len() > 50
            || verification.items.iter().any(|v| {
                !valid_scope_id(&v.id)
                    || !valid_revision(v.revision)
                    || v.status != RecordStatus::Current
            })
            || verification
                .items
                .iter()
                .enumerate()
                .any(|(i, v)| verification.items[..i].iter().any(|p| p.id == v.id))
        {
            return Err(ModelError::Invalid);
        }
        for (i, entry) in self.context.entries.iter().enumerate() {
            if !valid_scope_id(&entry.source_id)
                || !self.input_classes.contains(&entry.input_class)
                || self.context.entries[..i]
                    .iter()
                    .any(|e| e.source_id == entry.source_id)
                || entry.knowledge.as_ref().is_some_and(|r| {
                    !verification
                        .items
                        .iter()
                        .any(|v| v.id == r.id && v.revision == r.revision)
                })
            {
                return Err(ModelError::Invalid);
            }
        }
        if verification.items.iter().any(|v| {
            !self.context.entries.iter().any(|e| {
                e.knowledge
                    .as_ref()
                    .is_some_and(|r| r.id == v.id && r.revision == v.revision)
            })
        }) {
            return Err(ModelError::Invalid);
        }
        let historical_messages = || {
            self.history.iter().filter_map(|item| match item {
                HistoryItem::Message(message) => Some(message),
                HistoryItem::ToolExchange(_) => None,
            })
        };
        for (i, message) in self
            .messages
            .iter()
            .chain(historical_messages())
            .enumerate()
        {
            if !valid_text(&message.text, MAX_INPUT_BYTES) {
                return Err(ModelError::Invalid);
            }
            if message.role == MessageRole::Tool {
                return Err(ModelError::Unsupported);
            }
            if message.role == MessageRole::System {
                if i != 0 || message.source_id.is_some() {
                    return Err(ModelError::Invalid);
                }
            } else if !message
                .source_id
                .as_ref()
                .is_some_and(|id| self.context.entries.iter().any(|e| &e.source_id == id))
            {
                return Err(ModelError::Invalid);
            }
        }
        let mut history_bytes = 0usize;
        let mut history_calls = std::collections::BTreeSet::new();
        let mut history_attempts = std::collections::BTreeSet::new();
        for item in &self.history {
            match item {
                HistoryItem::Message(message) => history_bytes += message.text.len(),
                HistoryItem::ToolExchange(exchange) => {
                    if !exchange.is_valid()
                        || !history_calls.insert(&exchange.call_id)
                        || !history_attempts.insert(&exchange.result.attempt_id)
                        || !self
                            .context
                            .entries
                            .iter()
                            .any(|entry| entry.source_id == exchange.result.source_id)
                    {
                        return Err(ModelError::Invalid);
                    }
                    exchange.tool.resolve(&exchange.arguments)?;
                    history_bytes += exchange
                        .arguments
                        .bounded_bytes()
                        .ok_or(ModelError::Capacity)?
                        + exchange.result.content.len()
                        + exchange.tool.description.len()
                        + exchange
                            .tool
                            .input_schema
                            .bounded_bytes()
                            .ok_or(ModelError::Capacity)?
                        + exchange
                            .tool
                            .output_schema
                            .bounded_bytes()
                            .ok_or(ModelError::Capacity)?;
                }
            }
            if history_bytes > MAX_HISTORY_BYTES {
                return Err(ModelError::Capacity);
            }
        }
        if self.context.entries.iter().any(|entry| {
            !self
                .messages
                .iter()
                .chain(historical_messages())
                .any(|m| m.source_id.as_ref() == Some(&entry.source_id))
                && !self.history.iter().any(|item| matches!(item, HistoryItem::ToolExchange(exchange) if exchange.result.source_id == entry.source_id))
        }) {
            return Err(ModelError::Invalid);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Default)]
pub struct ModelCancellation(Arc<AtomicBool>);
impl ModelCancellation {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn cancel(&self) {
        self.0.store(true, Ordering::Release);
    }
    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }
}
pub trait ModelTransport: Send + Sync {
    fn invoke(
        &self,
        request: &ModelRequest,
        cancellation: &ModelCancellation,
    ) -> impl Future<Output = TransportOutcome> + Send;
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Invocation {
    pub id: String,
    pub key: String,
    pub request: ModelRequest,
    /// None after durable prepare means possibly accepted/unknown. Recovery
    /// returns this fact and never creates another outbound request.
    pub outcome: Option<TransportOutcome>,
}
/// Exact receipt custody. Never log, serialize for clients, or clone this token.
pub struct DispatchPermit {
    pub invocation_id: String,
    pub receipt_capability: String,
}
pub enum PreparedInvocation {
    Dispatch(DispatchPermit),
    Recovered(Box<Invocation>),
}
pub trait ModelStore: Send + Sync {
    /// Under the existing organisation/engagement/Task fences, recheck exact
    /// profile/catalogue versions, trusted qualification, knowledge references,
    /// exact historical invocation/call/operation/attempt terminal receipts,
    /// accepted/current Permissions and producing basis; durably mark the
    /// possible-disclosure cutoff. No transaction may span provider I/O.
    fn prepare(
        &self,
        actor: &str,
        scope: &Scope,
        request: &ModelRequest,
    ) -> impl Future<Output = Result<PreparedInvocation, ModelError>> + Send;
    /// Append an exact late fact using receipt custody even after revocation.
    /// This receipt grants no audience and no further execution authority.
    fn complete(
        &self,
        permit: &DispatchPermit,
        outcome: &TransportOutcome,
    ) -> impl Future<Output = Result<Invocation, ModelError>> + Send;
    fn current_audience(
        &self,
        actor: &str,
        scope: &Scope,
        invocation_id: &str,
    ) -> impl Future<Output = Result<(), ModelError>> + Send;
    fn get(
        &self,
        actor: &str,
        scope: &Scope,
        invocation_id: &str,
    ) -> impl Future<Output = Result<Invocation, ModelError>> + Send;
    /// Atomically validate terminal success, exact tool/arguments/catalogue,
    /// current basis and accepted/current Permissions, then bind the invocation
    /// and call to the existing canonical operation admission transaction.
    /// The current basis may belong to a replacement owner but must retain the
    /// original Task/cycle/intent/execution epoch. Producing invocation facts
    /// remain immutable; recovering them never grants the old owner authority.
    fn admit_tool(
        &self,
        actor: &str,
        scope: &Scope,
        basis: &ClaimBasis,
        invocation_id: &str,
        call_id: &str,
        operation_key: &str,
    ) -> impl Future<Output = Result<Operation, ModelError>> + Send;
}

pub struct ModelCoordinator<S, T> {
    pub store: S,
    pub transport: T,
}
impl<S: ModelStore, T: ModelTransport> ModelCoordinator<S, T> {
    pub async fn invoke(
        &self,
        actor: &str,
        scope: &Scope,
        request: &ModelRequest,
        cancellation: &ModelCancellation,
    ) -> Result<Invocation, ModelError> {
        request.validate()?;
        if request.basis.actor_id != actor || &request.basis.scope != scope {
            return Err(ModelError::Denied);
        }
        let invocation = match self.store.prepare(actor, scope, request).await? {
            PreparedInvocation::Recovered(invocation) => *invocation,
            PreparedInvocation::Dispatch(permit) => {
                let mut outcome = if cancellation.is_cancelled() {
                    TransportOutcome {
                        events: vec![],
                        actual_provider: request.profile.provider,
                        actual_model: None,
                        response_id: None,
                        usage: Usage::default(),
                        completion: Completion::Cancelled,
                    }
                } else {
                    self.transport.invoke(request, cancellation).await
                };
                if let Err(error) = validate_completion(request, &outcome) {
                    outcome = retain_failed_evidence(outcome, error);
                }
                self.store.complete(&permit, &outcome).await?
            }
        };
        self.store
            .current_audience(actor, scope, &invocation.id)
            .await?;
        Ok(invocation)
    }
}

fn retain_failed_evidence(mut outcome: TransportOutcome, error: ModelError) -> TransportOutcome {
    // Reject executable/structured material but preserve attributable partial
    // text and known usage. A provider identity mismatch never erases a charge.
    let mut bytes = 0usize;
    outcome.events = outcome
        .events
        .into_iter()
        .take(MAX_EVENTS)
        .filter_map(|event| {
            let (item_id, text) = match &event.kind {
                EventKind::TextDelta { item_id, text } | EventKind::Refusal { item_id, text } => {
                    (item_id, text)
                }
                _ => return None,
            };
            if !valid_external_id(item_id)
                || !valid_text(text, MAX_OUTPUT_BYTES)
                || bytes + text.len() > MAX_OUTPUT_BYTES
            {
                return None;
            }
            bytes += text.len();
            Some(event)
        })
        .enumerate()
        .map(|(index, mut event)| {
            event.sequence = index as u64;
            event
        })
        .collect();
    if outcome
        .actual_model
        .as_ref()
        .is_some_and(|id| !valid_external_id(id))
    {
        outcome.actual_model = None;
    }
    if outcome
        .response_id
        .as_ref()
        .is_some_and(|id| !valid_external_id(id))
    {
        outcome.response_id = None;
    }
    if outcome
        .usage
        .actual_service_tier
        .as_ref()
        .is_some_and(|tier| !valid_external_id(tier))
    {
        outcome.usage.actual_service_tier = None;
    }
    if outcome.completion != Completion::Failed(ModelError::Identity) {
        outcome.completion = Completion::Failed(error);
    }
    outcome
}

pub fn validate_completion(
    request: &ModelRequest,
    outcome: &TransportOutcome,
) -> Result<(), ModelError> {
    outcome.validate(&request.profile)?;
    for event in &outcome.events {
        match &event.kind {
            EventKind::ToolProposal {
                name, arguments, ..
            } => {
                request.catalogue.resolve(name, arguments)?;
            }
            EventKind::Structured { value, .. } => {
                let schema = request
                    .structured_output
                    .as_ref()
                    .ok_or(ModelError::Unsupported)?;
                if !schema.accepts(value) {
                    return Err(ModelError::Malformed);
                }
            }
            _ => {}
        }
    }
    Ok(())
}
pub fn validated_tool(
    invocation: &Invocation,
    call_id: &str,
) -> Result<(ToolDescriptor, CanonicalOperation), ModelError> {
    let outcome = invocation.outcome.as_ref().ok_or(ModelError::Conflict)?;
    validate_completion(&invocation.request, outcome)?;
    if outcome.completion != Completion::Succeeded {
        return Err(ModelError::Conflict);
    }
    for event in &outcome.events {
        if let EventKind::ToolProposal {
            call_id: actual,
            name,
            arguments,
        } = &event.kind
            && actual == call_id
        {
            let descriptor = invocation
                .request
                .catalogue
                .tools
                .iter()
                .find(|t| &t.name == name)
                .ok_or(ModelError::Invalid)?;
            return Ok((descriptor.clone(), descriptor.resolve(arguments)?));
        }
    }
    Err(ModelError::Invalid)
}

#[cfg(test)]
mod tests;
