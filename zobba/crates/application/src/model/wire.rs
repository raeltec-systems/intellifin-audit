//! Owned persistence codecs. Native infrastructure must reject duplicate keys,
//! depth/size overflow and malformed JSON before constructing portable values.
use super::*;
use crate::{
    knowledge::VerificationItem,
    operation::wire::{StoredBasis, StoredCanonical, StoredFact},
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use zobba_domain::permissions::SourceFact;

#[derive(Serialize, Deserialize)]
#[serde(remote = "Provider", rename_all = "snake_case")]
enum ProviderWire {
    #[serde(rename = "openai")]
    OpenAi,
    Anthropic,
}

#[derive(Serialize, Deserialize)]
#[serde(remote = "Qualification", rename_all = "snake_case")]
enum QualificationWire {
    Unqualified,
    Fixture,
    Live,
}

#[derive(Serialize, Deserialize)]
#[serde(remote = "Effort", rename_all = "snake_case")]
enum EffortWire {
    None,
    Low,
    Medium,
    High,
}

#[derive(Serialize, Deserialize)]
#[serde(remote = "MessageRole", rename_all = "snake_case")]
enum MessageRoleWire {
    System,
    User,
    Assistant,
    Tool,
}

#[derive(Serialize, Deserialize)]
#[serde(remote = "Effect", rename_all = "snake_case")]
enum EffectWire {
    Read,
    Write,
    Send,
}

#[derive(Serialize, Deserialize)]
#[serde(remote = "CancellationSemantics", rename_all = "snake_case")]
enum CancellationSemanticsWire {
    LocalOnly,
    SourceConfirmed,
}

#[derive(Serialize, Deserialize)]
#[serde(remote = "IdempotencySemantics", rename_all = "snake_case")]
enum IdempotencySemanticsWire {
    None,
    ExactKey,
}

#[derive(Serialize, Deserialize)]
#[serde(remote = "ReconciliationSemantics", rename_all = "snake_case")]
enum ReconciliationSemanticsWire {
    Required,
    SourceLookup,
}

#[derive(Serialize, Deserialize)]
#[serde(remote = "OutputCompleteness", rename_all = "snake_case")]
enum OutputCompletenessWire {
    Complete,
    MayBePartial,
}

#[derive(Serialize, Deserialize)]
#[serde(remote = "ModelError", rename_all = "snake_case")]
enum ModelErrorWire {
    Invalid,
    Denied,
    Conflict,
    Fenced,
    Unqualified,
    Unsupported,
    Capacity,
    Malformed,
    Identity,
    Timeout,
    RateLimited,
    Provider,
    Transport,
    Redirect,
    Unavailable,
}

#[derive(Serialize, Deserialize)]
#[serde(remote = "Capabilities", deny_unknown_fields)]
struct CapabilitiesWire {
    tools: bool,
    structured_output: bool,
    reasoning: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StoredCapabilities(#[serde(with = "CapabilitiesWire")] pub Capabilities);

#[derive(Serialize, Deserialize)]
#[serde(remote = "ModelProfile", deny_unknown_fields)]
struct ModelProfileWire {
    id: String,
    revision: u64,
    #[serde(with = "ProviderWire")]
    provider: Provider,
    model: String,
    account_id: String,
    destination: String,
    capability_revision: String,
    #[serde(with = "QualificationWire")]
    qualification: Qualification,
    enabled: bool,
    #[serde(with = "CapabilitiesWire")]
    capabilities: Capabilities,
    max_output_tokens: u32,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StoredProfile(#[serde(with = "ModelProfileWire")] pub ModelProfile);

#[derive(Serialize, Deserialize)]
#[serde(remote = "JsonValue", rename_all = "snake_case", deny_unknown_fields)]
enum JsonValueWire {
    Null,
    Bool(bool),
    Integer(i64),
    String(String),
    Array(#[serde(with = "json_values")] Vec<JsonValue>),
    Object(#[serde(with = "json_map")] BTreeMap<String, JsonValue>),
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StoredJson(#[serde(with = "JsonValueWire")] pub JsonValue);
#[derive(Serialize, Deserialize)]
#[serde(
    remote = "ArgumentSchema",
    rename_all = "snake_case",
    deny_unknown_fields
)]
enum ArgumentSchemaWire {
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
        #[serde(with = "boxed_schema")]
        items: Box<ArgumentSchema>,
        max_items: u32,
    },
    Object {
        #[serde(with = "schema_map")]
        properties: BTreeMap<String, ArgumentSchema>,
        required: Vec<String>,
    },
    Constant(#[serde(with = "JsonValueWire")] JsonValue),
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StoredSchema(#[serde(with = "ArgumentSchemaWire")] pub ArgumentSchema);

#[derive(Serialize, Deserialize)]
#[serde(remote = "ToolDescriptor", deny_unknown_fields)]
struct ToolDescriptorWire {
    name: String,
    version: u64,
    description: String,
    #[serde(with = "canonical")]
    operation: CanonicalOperation,
    #[serde(with = "ArgumentSchemaWire")]
    input_schema: ArgumentSchema,
    #[serde(with = "ArgumentSchemaWire")]
    output_schema: ArgumentSchema,
    #[serde(with = "EffectWire")]
    effect: Effect,
    #[serde(with = "CancellationSemanticsWire")]
    cancellation: CancellationSemantics,
    #[serde(with = "IdempotencySemanticsWire")]
    idempotency: IdempotencySemantics,
    #[serde(with = "ReconciliationSemanticsWire")]
    reconciliation: ReconciliationSemantics,
    #[serde(with = "OutputCompletenessWire")]
    completeness: OutputCompleteness,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StoredToolDescriptor(#[serde(with = "ToolDescriptorWire")] pub ToolDescriptor);

#[derive(Serialize, Deserialize)]
#[serde(remote = "ToolCatalog", deny_unknown_fields)]
struct ToolCatalogWire {
    id: String,
    revision: u64,
    enabled: bool,
    #[serde(with = "tools")]
    tools: Vec<ToolDescriptor>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StoredCatalog(#[serde(with = "ToolCatalogWire")] pub ToolCatalog);

#[derive(Serialize, Deserialize)]
#[serde(remote = "ModelMessage", deny_unknown_fields)]
struct ModelMessageWire {
    #[serde(with = "MessageRoleWire")]
    role: MessageRole,
    text: String,
    source_id: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StoredModelMessage(#[serde(with = "ModelMessageWire")] pub ModelMessage);

#[derive(Serialize, Deserialize)]
#[serde(remote = "Usage", deny_unknown_fields)]
struct UsageWire {
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    #[serde(default)]
    actual_service_tier: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StoredUsage(#[serde(with = "UsageWire")] pub Usage);

#[derive(Serialize, Deserialize)]
#[serde(
    remote = "EventKind",
    tag = "kind",
    rename_all = "snake_case",
    deny_unknown_fields
)]
enum EventKindWire {
    TextDelta {
        item_id: String,
        text: String,
    },
    ToolProposal {
        call_id: String,
        name: String,
        #[serde(with = "JsonValueWire")]
        arguments: JsonValue,
    },
    Structured {
        item_id: String,
        #[serde(with = "JsonValueWire")]
        value: JsonValue,
    },
    Refusal {
        item_id: String,
        text: String,
    },
    Usage(#[serde(with = "UsageWire")] Usage),
}
#[derive(Serialize, Deserialize)]
#[serde(remote = "Completion", rename_all = "snake_case", deny_unknown_fields)]
enum CompletionWire {
    Succeeded,
    Refused,
    Incomplete,
    Failed(#[serde(with = "ModelErrorWire")] ModelError),
    Cancelled,
}
#[derive(Serialize, Deserialize)]
#[serde(remote = "ModelEvent", deny_unknown_fields)]
struct ModelEventWire {
    sequence: u64,
    #[serde(with = "EventKindWire")]
    kind: EventKind,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StoredModelEvent(#[serde(with = "ModelEventWire")] pub ModelEvent);

#[derive(Serialize, Deserialize)]
#[serde(remote = "TransportOutcome", deny_unknown_fields)]
struct TransportOutcomeWire {
    #[serde(with = "events")]
    events: Vec<ModelEvent>,
    #[serde(with = "ProviderWire")]
    actual_provider: Provider,
    actual_model: Option<String>,
    response_id: Option<String>,
    #[serde(with = "UsageWire")]
    usage: Usage,
    #[serde(with = "CompletionWire")]
    completion: Completion,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StoredOutcome(#[serde(with = "TransportOutcomeWire")] pub TransportOutcome);

#[derive(Serialize, Deserialize)]
#[serde(remote = "VerificationItem", deny_unknown_fields)]
struct VerificationItemWire {
    id: String,
    revision: u64,
    status: RecordStatus,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StoredVerificationItem(#[serde(with = "VerificationItemWire")] pub VerificationItem);

#[derive(Serialize, Deserialize)]
#[serde(remote = "VerifyKnowledge", deny_unknown_fields)]
struct VerifyKnowledgeWire {
    expected_execution_epoch: u64,
    expected_methodology_binding_id: String,
    #[serde(with = "verification_items")]
    items: Vec<VerificationItem>,
    exact: bool,
    include_inactive: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StoredVerifyKnowledge(#[serde(with = "VerifyKnowledgeWire")] pub VerifyKnowledge);

#[derive(Serialize, Deserialize)]
#[serde(remote = "ContextEntry", deny_unknown_fields)]
struct ContextEntryWire {
    source_id: String,
    input_class: String,
    knowledge: Option<RecordReference>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StoredContextEntry(#[serde(with = "ContextEntryWire")] pub ContextEntry);

#[derive(Serialize, Deserialize)]
#[serde(remote = "ContextManifest", deny_unknown_fields)]
struct ContextManifestWire {
    #[serde(with = "VerifyKnowledgeWire")]
    verification: VerifyKnowledge,
    #[serde(with = "context_entries")]
    entries: Vec<ContextEntry>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StoredContextManifest(#[serde(with = "ContextManifestWire")] pub ContextManifest);

#[derive(Serialize, Deserialize)]
#[serde(remote = "ModelRequest", deny_unknown_fields)]
struct ModelRequestWire {
    key: String,
    #[serde(with = "basis")]
    basis: ClaimBasis,
    #[serde(with = "ModelProfileWire")]
    profile: ModelProfile,
    #[serde(with = "ToolCatalogWire")]
    catalogue: ToolCatalog,
    #[serde(with = "canonical")]
    disclosure: CanonicalOperation,
    #[serde(with = "ContextManifestWire")]
    context: ContextManifest,
    input_classes: Vec<String>,
    #[serde(with = "messages")]
    messages: Vec<ModelMessage>,
    #[serde(default, with = "history_items")]
    history: Vec<HistoryItem>,
    #[serde(with = "EffortWire")]
    effort: Effort,
    max_output_tokens: u32,
    #[serde(with = "optional_schema")]
    structured_output: Option<ArgumentSchema>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StoredRequest(#[serde(with = "ModelRequestWire")] pub ModelRequest);

#[derive(Serialize, Deserialize)]
#[serde(remote = "Invocation", deny_unknown_fields)]
struct InvocationWire {
    id: String,
    key: String,
    #[serde(with = "ModelRequestWire")]
    request: ModelRequest,
    #[serde(with = "optional_outcome")]
    outcome: Option<TransportOutcome>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StoredInvocation(#[serde(with = "InvocationWire")] pub Invocation);

mod json_values {
    use super::*;
    pub fn serialize<S: serde::Serializer>(
        value: &[JsonValue],
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        value
            .iter()
            .cloned()
            .map(StoredJson)
            .collect::<Vec<_>>()
            .serialize(serializer)
    }
    pub fn deserialize<'de, D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> Result<Vec<JsonValue>, D::Error> {
        let value = Vec::<StoredJson>::deserialize(deserializer)?;
        Ok(value.into_iter().map(|v| v.0).collect())
    }
}
mod json_map {
    use super::*;
    pub fn serialize<S: serde::Serializer>(
        value: &BTreeMap<String, JsonValue>,
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        value
            .iter()
            .map(|(k, v)| (k.clone(), StoredJson(v.clone())))
            .collect::<BTreeMap<_, _>>()
            .serialize(serializer)
    }
    pub fn deserialize<'de, D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> Result<BTreeMap<String, JsonValue>, D::Error> {
        let value = BTreeMap::<String, StoredJson>::deserialize(deserializer)?;
        Ok(value.into_iter().map(|(k, v)| (k, v.0)).collect())
    }
}
mod schema_map {
    use super::*;
    pub fn serialize<S: serde::Serializer>(
        value: &BTreeMap<String, ArgumentSchema>,
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        value
            .iter()
            .map(|(k, v)| (k.clone(), StoredSchema(v.clone())))
            .collect::<BTreeMap<_, _>>()
            .serialize(serializer)
    }
    pub fn deserialize<'de, D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> Result<BTreeMap<String, ArgumentSchema>, D::Error> {
        let value = BTreeMap::<String, StoredSchema>::deserialize(deserializer)?;
        Ok(value.into_iter().map(|(k, v)| (k, v.0)).collect())
    }
}
mod tools {
    use super::*;
    pub fn serialize<S: serde::Serializer>(
        value: &[ToolDescriptor],
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        value
            .iter()
            .cloned()
            .map(StoredToolDescriptor)
            .collect::<Vec<_>>()
            .serialize(serializer)
    }
    pub fn deserialize<'de, D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> Result<Vec<ToolDescriptor>, D::Error> {
        let value = Vec::<StoredToolDescriptor>::deserialize(deserializer)?;
        Ok(value.into_iter().map(|v| v.0).collect())
    }
}
mod events {
    use super::*;
    pub fn serialize<S: serde::Serializer>(
        value: &[ModelEvent],
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        value
            .iter()
            .cloned()
            .map(StoredModelEvent)
            .collect::<Vec<_>>()
            .serialize(serializer)
    }
    pub fn deserialize<'de, D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> Result<Vec<ModelEvent>, D::Error> {
        let value = Vec::<StoredModelEvent>::deserialize(deserializer)?;
        Ok(value.into_iter().map(|v| v.0).collect())
    }
}
mod verification_items {
    use super::*;
    pub fn serialize<S: serde::Serializer>(
        value: &[VerificationItem],
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        value
            .iter()
            .cloned()
            .map(StoredVerificationItem)
            .collect::<Vec<_>>()
            .serialize(serializer)
    }
    pub fn deserialize<'de, D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> Result<Vec<VerificationItem>, D::Error> {
        let value = Vec::<StoredVerificationItem>::deserialize(deserializer)?;
        Ok(value.into_iter().map(|v| v.0).collect())
    }
}
mod context_entries {
    use super::*;
    pub fn serialize<S: serde::Serializer>(
        value: &[ContextEntry],
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        value
            .iter()
            .cloned()
            .map(StoredContextEntry)
            .collect::<Vec<_>>()
            .serialize(serializer)
    }
    pub fn deserialize<'de, D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> Result<Vec<ContextEntry>, D::Error> {
        let value = Vec::<StoredContextEntry>::deserialize(deserializer)?;
        Ok(value.into_iter().map(|v| v.0).collect())
    }
}
mod messages {
    use super::*;
    pub fn serialize<S: serde::Serializer>(
        value: &[ModelMessage],
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        value
            .iter()
            .cloned()
            .map(StoredModelMessage)
            .collect::<Vec<_>>()
            .serialize(serializer)
    }
    pub fn deserialize<'de, D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> Result<Vec<ModelMessage>, D::Error> {
        let value = Vec::<StoredModelMessage>::deserialize(deserializer)?;
        Ok(value.into_iter().map(|v| v.0).collect())
    }
}
mod optional_schema {
    use super::*;
    pub fn serialize<S: serde::Serializer>(
        value: &Option<ArgumentSchema>,
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        value.clone().map(StoredSchema).serialize(serializer)
    }
    pub fn deserialize<'de, D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> Result<Option<ArgumentSchema>, D::Error> {
        let value = Option::<StoredSchema>::deserialize(deserializer)?;
        Ok(value.map(|v| v.0))
    }
}
mod optional_outcome {
    use super::*;
    pub fn serialize<S: serde::Serializer>(
        value: &Option<TransportOutcome>,
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        value.clone().map(StoredOutcome).serialize(serializer)
    }
    pub fn deserialize<'de, D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> Result<Option<TransportOutcome>, D::Error> {
        let value = Option::<StoredOutcome>::deserialize(deserializer)?;
        Ok(value.map(|v| v.0))
    }
}
mod basis {
    use super::*;
    pub fn serialize<S: serde::Serializer>(
        value: &ClaimBasis,
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        StoredBasis(value.clone()).serialize(serializer)
    }
    pub fn deserialize<'de, D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> Result<ClaimBasis, D::Error> {
        let value = StoredBasis::deserialize(deserializer)?;
        Ok(value.0)
    }
}
mod canonical {
    use super::*;
    pub fn serialize<S: serde::Serializer>(
        value: &CanonicalOperation,
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        StoredCanonical(value.clone()).serialize(serializer)
    }
    pub fn deserialize<'de, D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> Result<CanonicalOperation, D::Error> {
        let value = StoredCanonical::deserialize(deserializer)?;
        Ok(value.0)
    }
}
mod boxed_schema {
    use super::*;
    pub fn serialize<S: serde::Serializer>(
        value: &ArgumentSchema,
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        StoredSchema(value.clone()).serialize(serializer)
    }
    pub fn deserialize<'de, D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> Result<Box<ArgumentSchema>, D::Error> {
        let value = StoredSchema::deserialize(deserializer)?;
        Ok(Box::new(value.0))
    }
}

#[derive(Serialize, Deserialize)]
#[serde(remote = "ToolResult", deny_unknown_fields)]
struct ToolResultWire {
    source_id: String,
    operation_id: String,
    attempt_id: String,
    #[serde(with = "fact")]
    fact: SourceFact,
    content: String,
    is_error: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StoredToolResult(#[serde(with = "ToolResultWire")] pub ToolResult);
#[derive(Serialize, Deserialize)]
#[serde(remote = "ToolExchange", deny_unknown_fields)]
struct ToolExchangeWire {
    invocation_id: String,
    call_id: String,
    #[serde(with = "ToolDescriptorWire")]
    tool: ToolDescriptor,
    #[serde(with = "JsonValueWire")]
    arguments: JsonValue,
    #[serde(with = "ToolResultWire")]
    result: ToolResult,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StoredToolExchange(#[serde(with = "ToolExchangeWire")] pub ToolExchange);
#[derive(Serialize, Deserialize)]
#[serde(remote = "HistoryItem", rename_all = "snake_case", deny_unknown_fields)]
enum HistoryItemWire {
    Message(#[serde(with = "ModelMessageWire")] ModelMessage),
    ToolExchange(#[serde(with = "boxed_exchange")] Box<ToolExchange>),
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StoredHistoryItem(#[serde(with = "HistoryItemWire")] pub HistoryItem);
mod boxed_exchange {
    use super::*;
    pub fn serialize<S: serde::Serializer>(
        value: &ToolExchange,
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        StoredToolExchange(value.clone()).serialize(serializer)
    }
    pub fn deserialize<'de, D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> Result<Box<ToolExchange>, D::Error> {
        Ok(Box::new(StoredToolExchange::deserialize(deserializer)?.0))
    }
}
mod history_items {
    use super::*;
    pub fn serialize<S: serde::Serializer>(
        value: &[HistoryItem],
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        value
            .iter()
            .cloned()
            .map(StoredHistoryItem)
            .collect::<Vec<_>>()
            .serialize(serializer)
    }
    pub fn deserialize<'de, D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> Result<Vec<HistoryItem>, D::Error> {
        Ok(Vec::<StoredHistoryItem>::deserialize(deserializer)?
            .into_iter()
            .map(|v| v.0)
            .collect())
    }
}
mod fact {
    use super::*;
    pub fn serialize<S: serde::Serializer>(
        value: &SourceFact,
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        StoredFact(*value).serialize(serializer)
    }
    pub fn deserialize<'de, D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> Result<SourceFact, D::Error> {
        Ok(StoredFact::deserialize(deserializer)?.0)
    }
}
