//! Portable model meaning. Provider output is data, never execution authority.
use std::collections::{BTreeMap, BTreeSet};

use crate::{
    identity::valid_scope_id,
    permissions::{CanonicalOperation, SourceFact},
};

pub const MAX_MESSAGES: usize = 128;
pub const MAX_INPUT_BYTES: usize = 256 * 1024;
pub const MAX_OUTPUT_BYTES: usize = 256 * 1024;
pub const MAX_EVENTS: usize = 4096;
pub const MAX_TOOLS: usize = 32;
pub const MAX_CATALOGUE_BYTES: usize = 128 * 1024;
pub const MAX_TOOL_ARGUMENT_BYTES: usize = 32 * 1024;
pub const MAX_JSON_DEPTH: usize = 16;
pub const MAX_JSON_NODES: usize = 4096;
pub const MAX_OUTPUT_TOKENS: u32 = 16_384;
pub const MAX_HISTORY_ITEMS: usize = 64;
pub const MAX_HISTORY_BYTES: usize = 256 * 1024;
pub const MAX_TOOL_RESULT_BYTES: usize = 64 * 1024;
/// Opaque provider reasoning kept only for exact replay. These bounds are
/// separate from the 256-byte identity limit: a Claude signature is long.
pub const MAX_REASONING_TEXT_BYTES: usize = 128 * 1024;
pub const MAX_REASONING_SIGNATURE_BYTES: usize = 16 * 1024;
pub const MAX_REDACTED_REASONING_BYTES: usize = 64 * 1024;
/// Non-tool content blocks replayed before one invocation's tool calls.
pub const MAX_REPLAY_BLOCKS: usize = 32;

macro_rules! vocabulary {
    ($name:ident { $($variant:ident => $value:literal),+ $(,)? }) => {
        #[derive(Clone, Copy, Debug, PartialEq, Eq)]
        pub enum $name { $($variant),+ }
        impl $name {
            pub const fn as_str(self) -> &'static str { match self { $(Self::$variant => $value),+ } }
            pub fn parse(value: &str) -> Option<Self> { match value { $($value => Some(Self::$variant),)+ _ => None } }
        }
    }
}
vocabulary!(Provider { OpenAi => "openai", Anthropic => "anthropic" });
vocabulary!(Qualification { Unqualified => "unqualified", Fixture => "fixture", Live => "live" });
vocabulary!(Effort { None => "none", Low => "low", Medium => "medium", High => "high" });
vocabulary!(MessageRole { System => "system", User => "user", Assistant => "assistant", Tool => "tool" });
vocabulary!(Effect { Read => "read", Write => "write", Send => "send" });
vocabulary!(CancellationSemantics { LocalOnly => "local_only", SourceConfirmed => "source_confirmed" });
vocabulary!(IdempotencySemantics { None => "none", ExactKey => "exact_key" });
vocabulary!(ReconciliationSemantics { Required => "required", SourceLookup => "source_lookup" });
vocabulary!(OutputCompleteness { Complete => "complete", MayBePartial => "may_be_partial" });
vocabulary!(ModelError {
    Invalid => "invalid_model_request", Denied => "model_access_denied", Conflict => "model_conflict",
    Fenced => "model_fenced", Unqualified => "model_unqualified", Unsupported => "model_unsupported",
    Capacity => "model_capacity", Malformed => "model_malformed", Identity => "model_identity_mismatch",
    Timeout => "model_timeout", RateLimited => "model_rate_limited", Provider => "model_provider_error",
    Transport => "model_transport_error", Redirect => "model_redirect_refused", Unavailable => "model_unavailable"
});
impl std::fmt::Display for ModelError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}
impl std::error::Error for ModelError {}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Capabilities {
    pub tools: bool,
    pub structured_output: bool,
    pub reasoning: bool,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ModelProfile {
    pub id: String,
    pub revision: u64,
    pub provider: Provider,
    pub model: String,
    /// Nonsecret owned credential/account binding, never model-selected.
    pub account_id: String,
    pub destination: String,
    pub capability_revision: String,
    /// Declarative provenance only. A trusted adapter registry must corroborate
    /// the exact provider/model/destination/capability revision and this class.
    pub qualification: Qualification,
    pub enabled: bool,
    pub capabilities: Capabilities,
    pub max_output_tokens: u32,
}
pub fn valid_external_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 200
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'.' | b':'))
}
impl ModelProfile {
    pub fn is_valid(&self) -> bool {
        valid_scope_id(&self.id)
            && valid_revision(self.revision)
            && valid_external_id(&self.model)
            && valid_scope_id(&self.account_id)
            && valid_scope_id(&self.destination)
            && valid_scope_id(&self.capability_revision)
            && (1..=MAX_OUTPUT_TOKENS).contains(&self.max_output_tokens)
    }
}
pub fn valid_revision(value: u64) -> bool {
    value > 0 && value <= i64::MAX as u64
}

/// Deliberately bounded JSON subset: fractional/exponential numbers are not part
/// of this first contract. Decoders must reject duplicate object keys before
/// constructing this value, since maps cannot retain evidence of duplication.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum JsonValue {
    Null,
    Bool(bool),
    Integer(i64),
    String(String),
    Array(Vec<JsonValue>),
    Object(BTreeMap<String, JsonValue>),
}
impl JsonValue {
    pub fn is_valid(&self) -> bool {
        self.bounded_bytes().is_some()
    }
    /// Conservative JSON byte bound, including escaping and container framing.
    pub fn bounded_bytes(&self) -> Option<usize> {
        let mut pending = vec![(self, 0usize)];
        let mut nodes = 0usize;
        let mut bytes = 0usize;
        while let Some((value, depth)) = pending.pop() {
            nodes += 1;
            if depth > MAX_JSON_DEPTH || nodes > MAX_JSON_NODES {
                return None;
            }
            match value {
                Self::String(value) => bytes += quoted_bytes(value),
                Self::Array(values) => {
                    if values.len() > MAX_JSON_NODES {
                        return None;
                    }
                    bytes += 2 + values.len();
                    pending.extend(values.iter().map(|v| (v, depth + 1)));
                }
                Self::Object(values) => {
                    if values.len() > MAX_JSON_NODES {
                        return None;
                    }
                    bytes += 2
                        + values.len() * 2
                        + values.keys().map(|v| quoted_bytes(v)).sum::<usize>();
                    pending.extend(values.values().map(|v| (v, depth + 1)));
                }
                Self::Integer(_) => bytes += 20,
                Self::Null | Self::Bool(_) => bytes += 5,
            }
            if bytes > MAX_TOOL_ARGUMENT_BYTES {
                return None;
            }
        }
        Some(bytes)
    }
}
fn quoted_bytes(value: &str) -> usize {
    2 + value
        .bytes()
        .map(|b| match b {
            b'"' | b'\\' => 2,
            0..=31 => 6,
            _ => 1,
        })
        .sum::<usize>()
}

/// Supported explicit schema subset. Objects always reject undeclared keys.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ArgumentSchema {
    String {
        max_bytes: u32,
        enumeration: Vec<String>,
    },
    Integer {
        minimum: i64,
        maximum: i64,
    },
    Boolean,
    Array {
        items: Box<ArgumentSchema>,
        max_items: u32,
    },
    Object {
        properties: BTreeMap<String, ArgumentSchema>,
        required: Vec<String>,
    },
    Constant(JsonValue),
}
impl ArgumentSchema {
    pub fn is_valid(&self) -> bool {
        self.bounded_bytes().is_some()
    }
    pub fn bounded_bytes(&self) -> Option<usize> {
        let mut pending = vec![(self, 0usize)];
        let mut nodes = 0usize;
        let mut bytes = 0usize;
        while let Some((schema, depth)) = pending.pop() {
            nodes += 1;
            bytes += 128;
            if depth > MAX_JSON_DEPTH || nodes > MAX_JSON_NODES {
                return None;
            }
            match schema {
                Self::String {
                    max_bytes,
                    enumeration,
                } => {
                    if *max_bytes as usize > MAX_TOOL_ARGUMENT_BYTES
                        || enumeration.len() > 128
                        || enumeration.iter().any(|v| v.len() > *max_bytes as usize)
                        || enumeration.iter().collect::<BTreeSet<_>>().len() != enumeration.len()
                    {
                        return None;
                    }
                    bytes += enumeration.iter().map(|v| quoted_bytes(v)).sum::<usize>();
                }
                Self::Integer { minimum, maximum } if minimum > maximum => return None,
                Self::Array { items, max_items } => {
                    if *max_items as usize > MAX_JSON_NODES {
                        return None;
                    }
                    pending.push((items, depth + 1));
                }
                Self::Object {
                    properties,
                    required,
                } => {
                    if properties.len() > 128
                        || properties.keys().any(|k| !valid_scope_id(k))
                        || required.iter().any(|k| !properties.contains_key(k))
                        || required.iter().collect::<BTreeSet<_>>().len() != required.len()
                    {
                        return None;
                    }
                    bytes += properties
                        .keys()
                        .chain(required.iter())
                        .map(|v| quoted_bytes(v))
                        .sum::<usize>();
                    pending.extend(properties.values().map(|v| (v, depth + 1)));
                }
                Self::Constant(value) => bytes += value.bounded_bytes()?,
                _ => {}
            }
            if bytes > MAX_TOOL_ARGUMENT_BYTES {
                return None;
            }
        }
        Some(bytes)
    }
    pub fn accepts(&self, value: &JsonValue) -> bool {
        self.is_valid() && value.is_valid() && self.matches(value)
    }
    fn matches(&self, value: &JsonValue) -> bool {
        match (self, value) {
            (
                Self::String {
                    max_bytes,
                    enumeration,
                },
                JsonValue::String(value),
            ) => {
                value.len() <= *max_bytes as usize
                    && (enumeration.is_empty() || enumeration.contains(value))
            }
            (Self::Integer { minimum, maximum }, JsonValue::Integer(value)) => {
                minimum <= value && value <= maximum
            }
            (Self::Boolean, JsonValue::Bool(_)) => true,
            (Self::Array { items, max_items }, JsonValue::Array(values)) => {
                values.len() <= *max_items as usize && values.iter().all(|v| items.matches(v))
            }
            (
                Self::Object {
                    properties,
                    required,
                },
                JsonValue::Object(values),
            ) => {
                required.iter().all(|k| values.contains_key(k))
                    && values
                        .iter()
                        .all(|(k, v)| properties.get(k).is_some_and(|s| s.matches(v)))
            }
            (Self::Constant(expected), value) => expected == value,
            _ => false,
        }
    }
    /// Initial tools expose an exact prepared operation. Every argument, including
    /// account, resource, material and digest, is fixed by owned configuration.
    pub fn for_operation(operation: &CanonicalOperation) -> Self {
        let JsonValue::Object(values) = operation_arguments(operation) else {
            unreachable!()
        };
        let required = values.keys().cloned().collect();
        Self::Object {
            properties: values
                .into_iter()
                .map(|(k, v)| (k, Self::Constant(v)))
                .collect(),
            required,
        }
    }
}

pub fn operation_arguments(operation: &CanonicalOperation) -> JsonValue {
    let string = |v: &str| JsonValue::String(v.to_owned());
    JsonValue::Object(BTreeMap::from([
        (
            "version".into(),
            JsonValue::Integer(i64::from(operation.version)),
        ),
        ("purpose".into(), string(operation.purpose.as_str())),
        ("action".into(), string(operation.action.as_str())),
        ("account_id".into(), string(&operation.account_id)),
        ("environment_id".into(), string(&operation.environment_id)),
        ("destination".into(), string(&operation.destination)),
        (
            "recipients".into(),
            JsonValue::Array(operation.recipients.iter().map(|v| string(v)).collect()),
        ),
        ("material".into(), string(&operation.material)),
        ("material_digest".into(), string(&operation.material_digest)),
        (
            "attachments".into(),
            JsonValue::Array(
                operation
                    .attachments
                    .iter()
                    .map(|a| {
                        JsonValue::Object(BTreeMap::from([
                            ("id".into(), string(&a.id)),
                            ("digest".into(), string(&a.digest)),
                            ("classification".into(), string(&a.classification)),
                        ]))
                    })
                    .collect(),
            ),
        ),
        ("resource_id".into(), string(&operation.resource_id)),
        (
            "resource_version".into(),
            string(&operation.resource_version),
        ),
        (
            "expires_at".into(),
            JsonValue::Integer(operation.expires_at),
        ),
    ]))
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ToolDescriptor {
    pub name: String,
    pub version: u64,
    pub description: String,
    pub operation: CanonicalOperation,
    pub input_schema: ArgumentSchema,
    pub output_schema: ArgumentSchema,
    pub effect: Effect,
    pub cancellation: CancellationSemantics,
    pub idempotency: IdempotencySemantics,
    pub reconciliation: ReconciliationSemantics,
    pub completeness: OutputCompleteness,
}
impl ToolDescriptor {
    pub fn is_valid(&self) -> bool {
        valid_scope_id(&self.name)
            && self.name.len() <= 64
            && valid_revision(self.version)
            && valid_text(&self.description, 2000)
            && self.operation.is_valid()
            && self.input_schema.is_valid()
            && self.output_schema.is_valid()
            && self.input_schema == ArgumentSchema::for_operation(&self.operation)
            && self.effect.as_str() == self.operation.action.as_str()
    }
    pub fn resolve(&self, arguments: &JsonValue) -> Result<CanonicalOperation, ModelError> {
        if !self.is_valid()
            || !self.input_schema.accepts(arguments)
            || *arguments != operation_arguments(&self.operation)
        {
            return Err(ModelError::Invalid);
        }
        Ok(self.operation.clone())
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ToolCatalog {
    pub id: String,
    pub revision: u64,
    pub enabled: bool,
    pub tools: Vec<ToolDescriptor>,
}
impl ToolCatalog {
    pub fn is_valid(&self) -> bool {
        let mut names = BTreeSet::new();
        let mut bytes = 0usize;
        valid_scope_id(&self.id)
            && valid_revision(self.revision)
            && self.tools.len() <= MAX_TOOLS
            && self.tools.iter().all(|t| {
                bytes += t.description.len()
                    + t.input_schema
                        .bounded_bytes()
                        .unwrap_or(MAX_CATALOGUE_BYTES + 1)
                    + t.output_schema
                        .bounded_bytes()
                        .unwrap_or(MAX_CATALOGUE_BYTES + 1);
                bytes <= MAX_CATALOGUE_BYTES
                    && t.is_valid()
                    && names.insert(t.name.to_ascii_lowercase().replace('-', "_"))
            })
    }
    pub fn resolve(
        &self,
        name: &str,
        arguments: &JsonValue,
    ) -> Result<CanonicalOperation, ModelError> {
        if !self.enabled || !self.is_valid() {
            return Err(ModelError::Fenced);
        }
        self.tools
            .iter()
            .find(|t| t.name == name)
            .ok_or(ModelError::Invalid)?
            .resolve(arguments)
    }
}
pub fn valid_text(value: &str, max: usize) -> bool {
    !value.is_empty()
        && value.len() <= max
        && !value
            .chars()
            .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ModelMessage {
    /// Only owned instructions may use System. Retrieved/source text uses User
    /// or Tool and remains explicitly attributed through source_id.
    pub role: MessageRole,
    pub text: String,
    pub source_id: Option<String>,
}

/// Owned portable history has no provider conversation/continuation handles.
/// Complete exchanges make orphan tool results or executable partial calls
/// unrepresentable. Later conversational text follows as Message entries.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum HistoryItem {
    Message(ModelMessage),
    ToolExchange(Box<ToolExchange>),
}
/// Opaque provider reasoning (Claude `thinking` / `redacted_thinking`). It is
/// never answer text, evidence or knowledge; it exists only so the exact
/// block can be returned unchanged in the same assistant turn. Receipts and
/// logs may record its byte counts and hashes, never its contents.
#[derive(Clone, PartialEq, Eq)]
pub enum ReasoningBlock {
    Thinking { thinking: String, signature: String },
    Redacted { data: String },
}
impl std::fmt::Debug for ReasoningBlock {
    /// Contents are deliberately withheld from diagnostics.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Thinking {
                thinking,
                signature,
            } => f
                .debug_struct("Thinking")
                .field("thinking_bytes", &thinking.len())
                .field("signature_bytes", &signature.len())
                .finish(),
            Self::Redacted { data } => f
                .debug_struct("Redacted")
                .field("data_bytes", &data.len())
                .finish(),
        }
    }
}
/// Signatures and redacted data are opaque provider tokens: printable ASCII.
pub fn valid_opaque_token(value: &str, max: usize) -> bool {
    !value.is_empty() && value.len() <= max && value.bytes().all(|b| (0x20..=0x7e).contains(&b))
}
impl ReasoningBlock {
    pub fn is_valid(&self) -> bool {
        match self {
            // Current Claude models may omit displayed thinking: empty text
            // with a signature is valid and must be replayed as such.
            Self::Thinking {
                thinking,
                signature,
            } => {
                (thinking.is_empty() || valid_text(thinking, MAX_REASONING_TEXT_BYTES))
                    && valid_opaque_token(signature, MAX_REASONING_SIGNATURE_BYTES)
            }
            Self::Redacted { data } => valid_opaque_token(data, MAX_REDACTED_REASONING_BYTES),
        }
    }
    /// Bytes counted against output, history and request caps.
    pub fn bytes(&self) -> usize {
        match self {
            Self::Thinking {
                thinking,
                signature,
            } => thinking.len() + signature.len(),
            Self::Redacted { data } => data.len(),
        }
    }
}
/// A non-tool content block that preceded an invocation's tool calls, in the
/// model's original order. Replayed unchanged, once per invocation group.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ReplayBlock {
    Reasoning(ReasoningBlock),
    Text(String),
}
impl ReplayBlock {
    pub fn is_valid(&self) -> bool {
        match self {
            Self::Reasoning(block) => block.is_valid(),
            Self::Text(text) => valid_text(text, MAX_OUTPUT_BYTES),
        }
    }
    pub fn bytes(&self) -> usize {
        match self {
            Self::Reasoning(block) => block.bytes(),
            Self::Text(text) => text.len(),
        }
    }
}
/// Bounded total bytes of an ordered replay sequence, or None when invalid.
pub fn replay_bytes(blocks: &[ReplayBlock]) -> Option<usize> {
    if blocks.len() > MAX_REPLAY_BLOCKS || !blocks.iter().all(ReplayBlock::is_valid) {
        return None;
    }
    let bytes = blocks.iter().map(ReplayBlock::bytes).sum::<usize>();
    (bytes <= MAX_OUTPUT_BYTES).then_some(bytes)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ToolExchange {
    pub invocation_id: String,
    pub call_id: String,
    /// Frozen historical descriptor. Its presence is not current availability
    /// or permission to invoke the tool again.
    pub tool: ToolDescriptor,
    pub arguments: JsonValue,
    pub result: ToolResult,
    /// The producing invocation's ordered non-tool blocks (reasoning or text)
    /// that preceded its tool calls. Only the first exchange of an invocation
    /// group may carry them; they are replayed only to the same provider and
    /// model that produced them.
    pub preceding: Vec<ReplayBlock>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ToolResult {
    pub source_id: String,
    pub operation_id: String,
    pub attempt_id: String,
    /// Exact receipt disposition. This certifies neither the semantic accuracy
    /// of content nor instructions inside it; content remains attributed data.
    pub fact: SourceFact,
    pub content: String,
    pub is_error: bool,
}
impl ToolExchange {
    pub fn is_valid(&self) -> bool {
        valid_scope_id(&self.invocation_id)
            && valid_external_id(&self.call_id)
            && self.tool.is_valid()
            && self.arguments.is_valid()
            && [
                &self.result.source_id,
                &self.result.operation_id,
                &self.result.attempt_id,
            ]
            .iter()
            .all(|id| valid_scope_id(id))
            && matches!(
                self.result.fact,
                SourceFact::Completed | SourceFact::AuthoritativelyAbsent
            )
            && (self.result.content.is_empty()
                || valid_text(&self.result.content, MAX_TOOL_RESULT_BYTES))
            && replay_bytes(&self.preceding).is_some()
    }
}
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Usage {
    /// None is unknown, including cancellation after possible acceptance.
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    /// Provider-observed pricing tier, never inferred from the requested tier.
    /// None is honest when the provider has not supplied this metadata.
    pub actual_service_tier: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum EventKind {
    TextDelta {
        item_id: String,
        text: String,
    },
    ToolProposal {
        call_id: String,
        name: String,
        arguments: JsonValue,
    },
    Structured {
        item_id: String,
        value: JsonValue,
    },
    Refusal {
        item_id: String,
        text: String,
    },
    /// One complete opaque reasoning block, in content order. Never answer
    /// text or evidence; kept only for exact replay.
    Reasoning {
        item_id: String,
        block: ReasoningBlock,
    },
    Usage(Usage),
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ModelEvent {
    pub sequence: u64,
    pub kind: EventKind,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Completion {
    Succeeded,
    Refused,
    Incomplete,
    Failed(ModelError),
    Cancelled,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TransportOutcome {
    pub events: Vec<ModelEvent>,
    pub actual_provider: Provider,
    pub actual_model: Option<String>,
    pub response_id: Option<String>,
    pub usage: Usage,
    pub completion: Completion,
}
impl TransportOutcome {
    /// Tool-item completion never substitutes for terminal invocation success.
    pub fn validate(&self, profile: &ModelProfile) -> Result<(), ModelError> {
        if self
            .usage
            .actual_service_tier
            .as_ref()
            .is_some_and(|tier| !valid_external_id(tier))
        {
            return Err(ModelError::Malformed);
        }
        let standard_tier = match profile.provider {
            Provider::OpenAi => "default",
            Provider::Anthropic => "standard",
        };
        if (self.actual_provider != profile.provider
            || self
                .actual_model
                .as_ref()
                .is_some_and(|m| m != &profile.model))
            && self.completion != Completion::Failed(ModelError::Identity)
        {
            return Err(ModelError::Identity);
        }
        if (self
            .usage
            .actual_service_tier
            .as_deref()
            .is_some_and(|tier| tier != standard_tier)
            || (profile.qualification == Qualification::Live
                && self.completion == Completion::Succeeded
                && self.usage.actual_service_tier.is_none()))
            && !matches!(self.completion, Completion::Failed(_))
        {
            return Err(ModelError::Identity);
        }
        if self
            .actual_model
            .as_ref()
            .is_some_and(|id| !valid_external_id(id))
            || self
                .response_id
                .as_ref()
                .is_some_and(|id| !valid_external_id(id))
        {
            return Err(ModelError::Malformed);
        }
        if self.events.len() > MAX_EVENTS {
            return Err(ModelError::Capacity);
        }
        let mut bytes = 0usize;
        let mut calls = BTreeSet::new();
        let mut refusal = false;
        let mut usage = None;
        for (index, event) in self.events.iter().enumerate() {
            if event.sequence != index as u64 {
                return Err(ModelError::Malformed);
            }
            match &event.kind {
                EventKind::TextDelta { item_id, text } | EventKind::Refusal { item_id, text } => {
                    if !valid_external_id(item_id) || !valid_text(text, MAX_OUTPUT_BYTES) {
                        return Err(ModelError::Malformed);
                    }
                    bytes += text.len();
                    refusal |= matches!(event.kind, EventKind::Refusal { .. });
                }
                EventKind::Reasoning { item_id, block } => {
                    // Only native Anthropic reasoning blocks are supported;
                    // OpenAI reasoning items remain out of scope.
                    if self.actual_provider != Provider::Anthropic
                        || !valid_external_id(item_id)
                        || !block.is_valid()
                    {
                        return Err(ModelError::Malformed);
                    }
                    bytes += block.bytes();
                }
                EventKind::Structured { item_id, value } => {
                    if !valid_external_id(item_id) || !value.is_valid() {
                        return Err(ModelError::Malformed);
                    }
                    bytes += value.bounded_bytes().ok_or(ModelError::Capacity)?;
                }
                EventKind::ToolProposal {
                    call_id,
                    name,
                    arguments,
                } => {
                    if !valid_external_id(call_id)
                        || !valid_scope_id(name)
                        || !calls.insert(call_id)
                        || !arguments.is_valid()
                        || calls.len() > MAX_TOOLS
                    {
                        return Err(ModelError::Malformed);
                    }
                    bytes += arguments.bounded_bytes().ok_or(ModelError::Capacity)?;
                }
                EventKind::Usage(value) => {
                    if usage.replace(value).is_some() || value != &self.usage {
                        return Err(ModelError::Malformed);
                    }
                }
            }
            if bytes > MAX_OUTPUT_BYTES {
                return Err(ModelError::Capacity);
            }
        }
        if matches!(self.completion, Completion::Succeeded)
            && (refusal || self.actual_model.is_none() || self.response_id.is_none())
        {
            return Err(ModelError::Malformed);
        }
        let replay = self.replay_blocks();
        if !replay.is_empty() && replay_bytes(&replay).is_none() {
            return Err(ModelError::Capacity);
        }
        Ok(())
    }

    /// The ordered non-tool content blocks (reasoning and text) that preceded
    /// this response's tool calls, exactly as produced. Empty unless the
    /// response is a successful native Anthropic response with tool calls:
    /// nothing else is ever replayed. Consecutive text deltas of one content
    /// block form one text block; empty text is not a block.
    pub fn replay_blocks(&self) -> Vec<ReplayBlock> {
        let has_tools = self
            .events
            .iter()
            .any(|e| matches!(e.kind, EventKind::ToolProposal { .. }));
        if self.actual_provider != Provider::Anthropic
            || self.completion != Completion::Succeeded
            || !has_tools
        {
            return vec![];
        }
        let mut blocks = Vec::new();
        let mut text_item: Option<&str> = None;
        for event in &self.events {
            match &event.kind {
                EventKind::ToolProposal { .. } => break,
                EventKind::Reasoning { block, .. } => {
                    blocks.push(ReplayBlock::Reasoning(block.clone()));
                    text_item = None;
                }
                EventKind::TextDelta { item_id, text } => {
                    match (text_item, blocks.last_mut()) {
                        (Some(current), Some(ReplayBlock::Text(existing)))
                            if current == item_id =>
                        {
                            existing.push_str(text)
                        }
                        _ => blocks.push(ReplayBlock::Text(text.clone())),
                    }
                    text_item = Some(item_id);
                }
                _ => {}
            }
        }
        blocks
    }
}

#[cfg(test)]
mod tests;
