//! Native provider transports. Wire text never supplies destinations or authority.

use serde::de::{DeserializeSeed, MapAccess, SeqAccess, Visitor};
use serde_json::{Map, Number, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::time::Duration;
use zobba_application::model::{ModelCancellation, ModelRequest, ModelTransport};
use zobba_domain::model::{
    ArgumentSchema, Completion, Effort, EventKind, HistoryItem, JsonValue, MessageRole, ModelError,
    ModelEvent, Provider, Qualification, ToolExchange, TransportOutcome, Usage,
};

const MAX_FRAME_BYTES: usize = 256 * 1024;
const MAX_STREAM_BYTES: usize = 2 * 1024 * 1024;
const MAX_EVENTS: usize = 4096;
const MAX_JSON_DEPTH: usize = zobba_domain::model::MAX_JSON_DEPTH;
const MAX_ARGUMENT_BYTES: usize = zobba_domain::model::MAX_TOOL_ARGUMENT_BYTES;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum WireError {
    Malformed,
    Limit,
    Unsupported,
    Identity,
    Incomplete,
    Cancelled,
    Deadline,
    Network,
    RateLimited,
    Unavailable,
    Http,
    Redirect,
}

/// The transport's destination and credential are installed by trusted runtime
/// configuration. They cannot be selected by messages, tools, or model output.
/// No Debug implementation is provided because this type holds a credential.
pub struct NativeAdapter {
    provider: Provider,
    account_id: String,
    destination: String,
    endpoint: url::Url,
    credential: reqwest::header::HeaderValue,
    http: reqwest::Client,
    deadline: Duration,
    fixture: bool,
}

impl NativeAdapter {
    fn http_policy() -> reqwest::ClientBuilder {
        reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .https_only(true)
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(60))
    }

    /// Produce the exact native request bytes for local review. This performs no
    /// I/O and excludes the runtime credential, which is only an HTTP header.
    pub fn preview(&self, request: &ModelRequest) -> Result<Vec<u8>, ModelError> {
        self.request_body(request)
    }

    pub fn openai(
        credential: &str,
        account_id: &str,
        destination: &str,
    ) -> Result<Self, ModelError> {
        Self::new(Provider::OpenAi, credential, account_id, destination)
    }

    pub fn anthropic(
        credential: &str,
        account_id: &str,
        destination: &str,
    ) -> Result<Self, ModelError> {
        Self::new(Provider::Anthropic, credential, account_id, destination)
    }

    fn new(
        provider: Provider,
        credential: &str,
        account_id: &str,
        destination: &str,
    ) -> Result<Self, ModelError> {
        if credential.is_empty()
            || credential.len() > 8192
            || !zobba_domain::identity::valid_scope_id(destination)
            || !zobba_domain::identity::valid_scope_id(account_id)
        {
            return Err(ModelError::Invalid);
        }
        let secret = match provider {
            Provider::OpenAi => format!("Bearer {credential}"),
            Provider::Anthropic => credential.to_owned(),
        };
        let mut credential =
            reqwest::header::HeaderValue::from_str(&secret).map_err(|_| ModelError::Invalid)?;
        credential.set_sensitive(true);
        let endpoint = url::Url::parse(match provider {
            Provider::OpenAi => "https://api.openai.com/v1/responses",
            Provider::Anthropic => "https://api.anthropic.com/v1/messages",
        })
        .map_err(|_| ModelError::Invalid)?;
        let http = Self::http_policy()
            .build()
            .map_err(|_| ModelError::Unavailable)?;
        Ok(Self {
            provider,
            account_id: account_id.to_owned(),
            destination: destination.to_owned(),
            endpoint,
            credential,
            http,
            deadline: Duration::from_secs(60),
            fixture: false,
        })
    }

    /// Deliberately unavailable to production builds and integration consumers.
    #[cfg(test)]
    fn loopback(provider: Provider, endpoint: &str, deadline: Duration) -> Self {
        let endpoint = url::Url::parse(endpoint).unwrap();
        assert_eq!(endpoint.scheme(), "http");
        assert_eq!(endpoint.host_str(), Some("127.0.0.1"));
        let mut adapter = Self::new(
            provider,
            "synthetic-fixture-key",
            "fixture-account",
            "fixture-destination",
        )
        .unwrap();
        adapter.endpoint = endpoint;
        adapter.http = Self::http_policy()
            .https_only(false)
            .no_proxy()
            .build()
            .unwrap();
        adapter.deadline = deadline;
        adapter.fixture = true;
        adapter
    }

    fn request_body(&self, request: &ModelRequest) -> Result<Vec<u8>, ModelError> {
        request.validate()?;
        if request.profile.provider != self.provider
            || request.profile.destination != self.destination
            || request.profile.account_id != self.account_id
        {
            return Err(ModelError::Identity);
        }
        if (self.fixture && request.profile.qualification != Qualification::Fixture)
            || (!self.fixture && request.profile.qualification != Qualification::Live)
        {
            return Err(ModelError::Unqualified);
        }
        // Reasoning blocks need a separate portable contract. Declaring their
        // capabilities cannot silently enable them.
        if request.effort != Effort::None {
            return Err(ModelError::Unsupported);
        }
        if self.provider == Provider::OpenAi
            && request.structured_output.as_ref().is_some_and(|schema| {
                !matches!(schema, ArgumentSchema::Object { .. }) || !openai_strict_schema(schema)
            })
        {
            return Err(ModelError::Unsupported);
        }
        let schema = request.structured_output.as_ref().map(schema_json);
        let mut body = match self.provider {
            Provider::OpenAi => {
                let input = native_history(request, Provider::OpenAi);
                let tools: Vec<Value> = request
                    .catalogue
                    .tools
                    .iter()
                    .map(|tool| {
                        serde_json::json!({
                            "type": "function", "name": tool.name, "description": tool.description,
                            "parameters": schema_json(&tool.input_schema), "strict": false
                        })
                    })
                    .collect();
                let mut body = serde_json::json!({"model": request.profile.model, "input": input, "tools": tools,
                    "stream": true, "store": false, "service_tier": "default", "max_output_tokens": request.max_output_tokens});
                // An OpenAI reasoning model reasons by default (gpt-6-luna
                // defaults to medium). Effort is already None here, so a
                // declared reasoning model is explicitly held to no reasoning;
                // reasoning output items remain unsupported and fail closed.
                // A non-reasoning model would refuse this field, so it is sent
                // only when the profile declares the capability.
                if request.profile.capabilities.reasoning {
                    body["reasoning"] = serde_json::json!({"effort": "none"});
                }
                body
            }
            Provider::Anthropic => {
                let messages = native_history(request, Provider::Anthropic);
                let tools: Vec<Value> = request.catalogue.tools.iter().map(|tool| serde_json::json!({
                    "name": tool.name, "description": tool.description, "input_schema": schema_json(&tool.input_schema)
                })).collect();
                let mut body = serde_json::json!({"model": request.profile.model, "messages": messages, "tools": tools,
                    "stream": true, "service_tier": "standard_only", "max_tokens": request.max_output_tokens});
                if let Some(system) = request
                    .messages
                    .iter()
                    .find(|message| message.role == MessageRole::System)
                {
                    body["system"] = Value::String(system.text.clone());
                }
                body
            }
        };
        if let Some(schema) = schema {
            match self.provider {
                Provider::OpenAi => {
                    body["text"] = serde_json::json!({"format": {"type": "json_schema", "name": "response", "strict": true, "schema": schema}})
                }
                Provider::Anthropic => {
                    body["output_config"] =
                        serde_json::json!({"format": {"type": "json_schema", "schema": schema}})
                }
            }
        }
        let bytes = serde_json::to_vec(&body).map_err(|_| ModelError::Invalid)?;
        if bytes.len() > MAX_STREAM_BYTES {
            return Err(ModelError::Capacity);
        }
        Ok(bytes)
    }

    async fn send(&self, body: Vec<u8>, state: &mut ParsedStream) -> Result<(), WireError> {
        let builder = self
            .http
            .post(self.endpoint.clone())
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .header(reqwest::header::ACCEPT, "text/event-stream");
        let builder = match self.provider {
            Provider::OpenAi => {
                builder.header(reqwest::header::AUTHORIZATION, self.credential.clone())
            }
            Provider::Anthropic => builder
                .header("x-api-key", self.credential.clone())
                .header("anthropic-version", "2023-06-01"),
        };
        // Exactly one send. No retry, continuation token, redirected request, or
        // fallback endpoint is ever issued after possible provider acceptance.
        let mut response = builder.body(body).send().await.map_err(|error| {
            if error.is_timeout() {
                WireError::Deadline
            } else {
                WireError::Network
            }
        })?;
        if response.status().is_redirection() {
            return Err(WireError::Redirect);
        }
        let status_error = if response.status().as_u16() == 429 {
            Some(WireError::RateLimited)
        } else if response.status().is_server_error() {
            Some(WireError::Unavailable)
        } else if !response.status().is_success() {
            Some(WireError::Http)
        } else {
            None
        };
        state.http_error = status_error;
        if response.headers().len() > 64
            || response
                .content_length()
                .is_some_and(|length| length > MAX_STREAM_BYTES as u64)
        {
            return Err(WireError::Limit);
        }
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.split(';').next())
            .map(str::trim);
        if content_type.is_some_and(|value| value.eq_ignore_ascii_case("application/json")) {
            // This adapter requested streaming. An unexpected JSON envelope is
            // never a successful fallback, but bounded billing evidence must
            // survive the protocol failure or provider HTTP error.
            let body_error = loop {
                match response.chunk().await {
                    Ok(Some(chunk)) => {
                        if state.json_body.len().saturating_add(chunk.len()) > MAX_FRAME_BYTES {
                            break Some(WireError::Limit);
                        }
                        state.json_body.extend_from_slice(&chunk);
                    }
                    Ok(None) => break None,
                    Err(_) => break Some(WireError::Network),
                }
            };
            let metadata = strict_json(&state.json_body, MAX_FRAME_BYTES).and_then(|value| {
                if status_error.is_some() {
                    // A failure body may contribute usage, but cannot replace the
                    // known HTTP classification or assert a successful identity.
                    state.usage_metadata(self.provider, &value, true)
                } else {
                    state.metadata(self.provider, &value, true, false)
                }
            });
            state.json_body.clear();
            if let Some(error) = body_error {
                return Err(error);
            }
            metadata?;
            return Err(status_error.unwrap_or(WireError::Unsupported));
        }
        if let Some(error) = status_error {
            return Err(error);
        }
        if content_type.is_none_or(|value| !value.eq_ignore_ascii_case("text/event-stream")) {
            return Err(WireError::Malformed);
        }
        let mut decoder = SseDecoder::default();
        while let Some(chunk) = response.chunk().await.map_err(|_| WireError::Network)? {
            let (ready, framing_error) = match decoder.push(&chunk) {
                Ok(ready) => (ready, None),
                Err(error) => (std::mem::take(&mut decoder.ready), Some(error)),
            };
            // Interpret the valid prefix even when a later line in the same
            // transport chunk is malformed. Chunk boundaries are not evidence.
            for event in ready {
                match self.provider {
                    Provider::OpenAi => state.openai(event)?,
                    Provider::Anthropic => state.anthropic(event)?,
                }
            }
            if let Some(error) = framing_error {
                return Err(error);
            }
        }
        decoder.finish()?;
        if !state.terminal {
            return Err(WireError::Incomplete);
        }
        Ok(())
    }
}

impl ModelTransport for NativeAdapter {
    async fn invoke(
        &self,
        request: &ModelRequest,
        cancellation: &ModelCancellation,
    ) -> TransportOutcome {
        let mut state = ParsedStream::default();
        let result = match self.request_body(request) {
            Err(error) => {
                return state.outcome(
                    self.provider,
                    Completion::Failed(error),
                    request.structured_output.as_ref(),
                );
            }
            Ok(body) => {
                tokio::select! {
                    biased;
                    _ = cancelled(cancellation) => Err(WireError::Cancelled),
                    _ = tokio::time::sleep(self.deadline) => Err(WireError::Deadline),
                    result = self.send(body, &mut state) => result,
                }
            }
        };
        if matches!(result, Err(WireError::Deadline | WireError::Cancelled))
            && let Ok(value) = strict_json(&state.json_body, MAX_FRAME_BYTES)
        {
            // Either outer interruption drops send(). Keep complete, bounded
            // JSON metadata already received, just as on a truncated EOF.
            // Cancellation remains cancellation; metadata cannot release tools.
            if state.http_error.is_some() {
                let _ = state.usage_metadata(self.provider, &value, true);
            } else {
                let _ = state.metadata(self.provider, &value, true, false);
            }
        }
        let result = match (result, state.http_error) {
            (Err(error), Some(status)) if error != WireError::Cancelled => Err(status),
            (result, _) => result,
        };
        let mut completion = match result {
            Ok(()) if state.refusal => Completion::Refused,
            Ok(()) => Completion::Succeeded,
            Err(WireError::Cancelled) => Completion::Cancelled,
            Err(WireError::Incomplete) => Completion::Incomplete,
            Err(error) => Completion::Failed(error.model_error()),
        };
        if completion == Completion::Succeeded
            && request.profile.qualification == Qualification::Live
            && state.actual_service_tier.is_none()
        {
            completion = Completion::Failed(ModelError::Identity);
        }
        if state
            .model
            .as_ref()
            .is_some_and(|actual| actual != &request.profile.model)
        {
            completion = Completion::Failed(ModelError::Identity);
        }
        state.outcome(
            self.provider,
            completion,
            request.structured_output.as_ref(),
        )
    }
}

async fn cancelled(cancellation: &ModelCancellation) {
    while !cancellation.is_cancelled() {
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

/// Reconstruct owned history without provider-owned conversation state. Calls
/// from one prior invocation precede their correlated result blocks, preserving
/// native parallel-call structure while granting no fresh tool authority.
fn native_history(request: &ModelRequest, provider: Provider) -> Vec<Value> {
    let message = |role: MessageRole, text: &str| match provider {
        Provider::OpenAi => serde_json::json!({"role": role.as_str(), "content": text}),
        Provider::Anthropic => {
            serde_json::json!({"role": role.as_str(), "content": [{"type": "text", "text": text}]})
        }
    };
    let mut wire: Vec<Value> = request
        .messages
        .iter()
        .filter(|item| provider == Provider::OpenAi || item.role != MessageRole::System)
        .map(|item| message(item.role, &item.text))
        .collect();
    let mut history = request.history.iter().peekable();
    while let Some(item) = history.next() {
        match item {
            HistoryItem::Message(item) => wire.push(message(item.role, &item.text)),
            HistoryItem::ToolExchange(exchange) => {
                let mut group = vec![exchange.as_ref()];
                while matches!(history.peek(), Some(HistoryItem::ToolExchange(next)) if next.invocation_id == exchange.invocation_id)
                {
                    if let Some(HistoryItem::ToolExchange(next)) = history.next() {
                        group.push(next.as_ref());
                    }
                }
                match provider {
                    Provider::OpenAi => {
                        for exchange in &group {
                            wire.push(serde_json::json!({"type": "function_call", "call_id": exchange.call_id,
                                "name": exchange.tool.name, "arguments": json_value(&exchange.arguments).to_string()}));
                        }
                        for exchange in group {
                            wire.push(serde_json::json!({"type": "function_call_output", "call_id": exchange.call_id,
                                "output": result_content(exchange)}));
                        }
                    }
                    Provider::Anthropic => {
                        let calls: Vec<Value> = group.iter().map(|exchange| serde_json::json!({
                            "type": "tool_use", "id": exchange.call_id, "name": exchange.tool.name,
                            "input": json_value(&exchange.arguments)
                        })).collect();
                        let results: Vec<Value> = group.into_iter().map(|exchange| serde_json::json!({
                            "type": "tool_result", "tool_use_id": exchange.call_id,
                            "content": result_content(exchange), "is_error": exchange.result.is_error
                        })).collect();
                        wire.push(serde_json::json!({"role": "assistant", "content": calls}));
                        wire.push(serde_json::json!({"role": "user", "content": results}));
                    }
                }
            }
        }
    }
    wire
}

fn result_content(exchange: &ToolExchange) -> String {
    let result = &exchange.result;
    serde_json::json!({"source_id": result.source_id, "operation_id": result.operation_id,
        "attempt_id": result.attempt_id, "fact": result.fact.as_str(), "content": result.content,
        "is_error": result.is_error})
    .to_string()
}

impl WireError {
    fn model_error(self) -> ModelError {
        match self {
            Self::Malformed | Self::Incomplete => ModelError::Malformed,
            Self::Limit => ModelError::Capacity,
            Self::Unsupported => ModelError::Unsupported,
            Self::Identity => ModelError::Identity,
            Self::Deadline => ModelError::Timeout,
            Self::Network | Self::Cancelled => ModelError::Transport,
            Self::RateLimited => ModelError::RateLimited,
            Self::Unavailable => ModelError::Unavailable,
            Self::Http => ModelError::Provider,
            Self::Redirect => ModelError::Redirect,
        }
    }
}

fn schema_json(schema: &ArgumentSchema) -> Value {
    match schema {
        ArgumentSchema::String {
            max_bytes,
            enumeration,
        } => {
            let mut value = serde_json::json!({"type": "string", "maxLength": max_bytes});
            if !enumeration.is_empty() {
                value["enum"] = serde_json::json!(enumeration);
            }
            value
        }
        ArgumentSchema::Integer { minimum, maximum } => {
            serde_json::json!({"type": "integer", "minimum": minimum, "maximum": maximum})
        }
        ArgumentSchema::Boolean => serde_json::json!({"type": "boolean"}),
        ArgumentSchema::Array { items, max_items } => {
            serde_json::json!({"type": "array", "items": schema_json(items), "maxItems": max_items})
        }
        ArgumentSchema::Object {
            properties,
            required,
        } => {
            let properties: Map<String, Value> = properties
                .iter()
                .map(|(key, schema)| (key.clone(), schema_json(schema)))
                .collect();
            serde_json::json!({"type": "object", "properties": properties, "required": required, "additionalProperties": false})
        }
        ArgumentSchema::Constant(value) => constant_schema(value),
    }
}

// A constant keeps its exact `enum` value, and complex constants also carry the
// structural shape providers validate: OpenAI refuses any array schema without
// `items` (even outside strict mode), so `{"type":"array","enum":[[]]}` made the
// whole tool request fail before the model saw it.
fn constant_schema(value: &JsonValue) -> Value {
    let mut schema = match value {
        JsonValue::Null => serde_json::json!({"type": "null"}),
        JsonValue::Bool(_) => serde_json::json!({"type": "boolean"}),
        JsonValue::Integer(_) => serde_json::json!({"type": "integer"}),
        JsonValue::String(_) => serde_json::json!({"type": "string"}),
        JsonValue::Array(values) => {
            // No element is ever accepted for an empty constant; `maxItems: 0`
            // carries that, and the item schema only satisfies the shape rule.
            let items = if values.is_empty() {
                serde_json::json!({"type": "string"})
            } else {
                serde_json::json!({"anyOf": values.iter().map(constant_schema).collect::<Vec<_>>()})
            };
            serde_json::json!({"type": "array", "items": items, "minItems": values.len(), "maxItems": values.len()})
        }
        JsonValue::Object(values) => {
            let properties: Map<String, Value> = values
                .iter()
                .map(|(key, value)| (key.clone(), constant_schema(value)))
                .collect();
            serde_json::json!({"type": "object", "properties": properties,
                "required": values.keys().collect::<Vec<_>>(), "additionalProperties": false})
        }
    };
    schema["enum"] = serde_json::json!([json_value(value)]);
    schema
}

/// OpenAI strict output requires an object root and every property of every
/// object to be required. Preserve the portable schema's meaning by refusing
/// incompatible requests before transport rather than rewriting optionality.
fn openai_strict_schema(schema: &ArgumentSchema) -> bool {
    match schema {
        ArgumentSchema::Object {
            properties,
            required,
        } => properties.len() == required.len() && properties.values().all(openai_strict_schema),
        ArgumentSchema::Array { items, .. } => openai_strict_schema(items),
        // Complex constants render as enum-only schemas, without the explicit
        // object/array shapes required by the native strict output contract.
        ArgumentSchema::Constant(JsonValue::Object(_) | JsonValue::Array(_)) => false,
        _ => true,
    }
}

fn json_value(value: &JsonValue) -> Value {
    match value {
        JsonValue::Null => Value::Null,
        JsonValue::Bool(value) => Value::Bool(*value),
        JsonValue::Integer(value) => Value::Number((*value).into()),
        JsonValue::String(value) => Value::String(value.clone()),
        JsonValue::Array(values) => Value::Array(values.iter().map(json_value).collect()),
        JsonValue::Object(values) => Value::Object(
            values
                .iter()
                .map(|(key, value)| (key.clone(), json_value(value)))
                .collect(),
        ),
    }
}

fn portable_json(value: Value) -> Result<JsonValue, WireError> {
    match value {
        Value::Null => Ok(JsonValue::Null),
        Value::Bool(value) => Ok(JsonValue::Bool(value)),
        Value::Number(value) => value
            .as_i64()
            .map(JsonValue::Integer)
            .ok_or(WireError::Malformed),
        Value::String(value) => Ok(JsonValue::String(value)),
        Value::Array(values) => values
            .into_iter()
            .map(portable_json)
            .collect::<Result<Vec<_>, _>>()
            .map(JsonValue::Array),
        Value::Object(values) => values
            .into_iter()
            .map(|(key, value)| portable_json(value).map(|value| (key, value)))
            .collect::<Result<BTreeMap<_, _>, _>>()
            .map(JsonValue::Object),
    }
}

impl ParsedStream {
    fn outcome(
        self,
        provider: Provider,
        mut completion: Completion,
        schema: Option<&ArgumentSchema>,
    ) -> TransportOutcome {
        let mut events: Vec<EventKind> = self
            .events
            .into_iter()
            .filter_map(|event| match event {
                ParsedEvent::Text { item_id, text } if !text.is_empty() => {
                    Some(EventKind::TextDelta { item_id, text })
                }
                ParsedEvent::Refusal { item_id, text } if !text.is_empty() => {
                    Some(EventKind::Refusal { item_id, text })
                }
                ParsedEvent::Tool {
                    call_id,
                    name,
                    arguments,
                } if completion == Completion::Succeeded => Some(EventKind::ToolProposal {
                    call_id,
                    name,
                    arguments,
                }),
                _ => None,
            })
            .collect();
        if let Some(schema) = schema.filter(|_| completion == Completion::Succeeded) {
            let mut text = String::new();
            let mut item_id = None;
            let mut valid = true;
            for event in &events {
                if let EventKind::TextDelta {
                    item_id: id,
                    text: delta,
                } = event
                {
                    valid &= item_id.as_ref().is_none_or(|previous| previous == id);
                    item_id = Some(id.clone());
                    text.push_str(delta);
                } else {
                    valid = false;
                }
            }
            let value = strict_json(text.as_bytes(), MAX_ARGUMENT_BYTES).and_then(portable_json);
            if !valid
                || item_id.is_none()
                || !value.as_ref().is_ok_and(|value| schema.accepts(value))
            {
                completion = Completion::Failed(ModelError::Malformed);
            } else if let (Some(item_id), Ok(value)) = (item_id, value) {
                events.push(EventKind::Structured { item_id, value });
            }
        }
        if completion != Completion::Succeeded {
            events.retain(|event| {
                !matches!(
                    event,
                    EventKind::ToolProposal { .. } | EventKind::Structured { .. }
                )
            });
        }
        let usage = Usage {
            input_tokens: self.input_tokens,
            output_tokens: self.output_tokens,
            actual_service_tier: self.actual_service_tier,
        };
        if usage.input_tokens.is_some()
            || usage.output_tokens.is_some()
            || usage.actual_service_tier.is_some()
        {
            events.push(EventKind::Usage(usage.clone()));
        }
        let events = events
            .into_iter()
            .enumerate()
            .map(|(sequence, kind)| ModelEvent {
                sequence: sequence as u64,
                kind,
            })
            .collect();
        TransportOutcome {
            events,
            actual_provider: provider,
            actual_model: self.model,
            response_id: self.response_id,
            usage,
            completion,
        }
    }
}

#[cfg(test)]
#[path = "native_tests.rs"]
mod tests;

/// UTF-8 is decoded only after a complete line arrives. A partial multi-byte
/// character or CRLF delimiter therefore survives arbitrary transport chunks.
#[derive(Default)]
struct SseDecoder {
    pending: Vec<u8>,
    data: String,
    event: Option<String>,
    frame_bytes: usize,
    total_bytes: usize,
    events: usize,
    ready: Vec<SseEvent>,
}

struct SseEvent {
    event: Option<String>,
    data: String,
}

impl SseDecoder {
    fn push(&mut self, chunk: &[u8]) -> Result<Vec<SseEvent>, WireError> {
        for byte in chunk {
            self.total_bytes = self.total_bytes.saturating_add(1);
            if self.total_bytes > MAX_STREAM_BYTES {
                return Err(WireError::Limit);
            }
            if *byte != b'\n' {
                self.pending.push(*byte);
                if self.pending.len().saturating_add(self.frame_bytes) > MAX_FRAME_BYTES {
                    return Err(WireError::Limit);
                }
                continue;
            }
            let raw = std::mem::take(&mut self.pending);
            let raw = raw.strip_suffix(b"\r").unwrap_or(&raw);
            let line = std::str::from_utf8(raw).map_err(|_| WireError::Malformed)?;
            if line.is_empty() {
                if !self.data.is_empty() {
                    self.events += 1;
                    if self.events > MAX_EVENTS {
                        return Err(WireError::Limit);
                    }
                    self.data.pop(); // SSE joins data lines with exactly one LF.
                    self.ready.push(SseEvent {
                        event: self.event.take(),
                        data: std::mem::take(&mut self.data),
                    });
                }
                self.event = None;
                self.frame_bytes = 0;
                continue;
            }
            self.frame_bytes = self.frame_bytes.saturating_add(line.len() + 1);
            if self.frame_bytes > MAX_FRAME_BYTES {
                return Err(WireError::Limit);
            }
            if line.starts_with(':') {
                continue;
            }
            let (field, value) = line.split_once(':').unwrap_or((line, ""));
            let value = value.strip_prefix(' ').unwrap_or(value);
            match field {
                "data" => {
                    self.data.push_str(value);
                    self.data.push('\n');
                }
                "event" if self.event.is_none() => self.event = Some(value.to_owned()),
                "event" => return Err(WireError::Malformed),
                // IDs and reconnect delays never enable replay or continuation.
                "id" | "retry" => {}
                _ => return Err(WireError::Unsupported),
            }
        }
        Ok(std::mem::take(&mut self.ready))
    }

    fn finish(&self) -> Result<(), WireError> {
        if self.pending.is_empty() && self.data.is_empty() && self.event.is_none() {
            Ok(())
        } else {
            Err(WireError::Incomplete)
        }
    }
}

/// serde_json's default Value decoder accepts duplicate object keys. This seed
/// refuses them at every depth before the provider envelope or tool arguments
/// are interpreted. Errors never contain provider-controlled bytes.
fn strict_json(bytes: &[u8], cap: usize) -> Result<Value, WireError> {
    if bytes.len() > cap {
        return Err(WireError::Limit);
    }
    let mut deserializer = serde_json::Deserializer::from_slice(bytes);
    let value = JsonSeed(0)
        .deserialize(&mut deserializer)
        .map_err(|_| WireError::Malformed)?;
    deserializer.end().map_err(|_| WireError::Malformed)?;
    Ok(value)
}

struct JsonSeed(usize);

impl<'de> DeserializeSeed<'de> for JsonSeed {
    type Value = Value;

    fn deserialize<D>(self, deserializer: D) -> Result<Value, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        if self.0 > MAX_JSON_DEPTH {
            return Err(serde::de::Error::custom("JSON depth limit"));
        }
        deserializer.deserialize_any(self)
    }
}

impl<'de> Visitor<'de> for JsonSeed {
    type Value = Value;

    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("bounded JSON without duplicate keys")
    }

    fn visit_bool<E: serde::de::Error>(self, value: bool) -> Result<Value, E> {
        Ok(Value::Bool(value))
    }

    fn visit_i64<E: serde::de::Error>(self, value: i64) -> Result<Value, E> {
        Ok(Value::Number(value.into()))
    }

    fn visit_u64<E: serde::de::Error>(self, value: u64) -> Result<Value, E> {
        Ok(Value::Number(value.into()))
    }

    fn visit_f64<E: serde::de::Error>(self, value: f64) -> Result<Value, E> {
        Number::from_f64(value)
            .map(Value::Number)
            .ok_or_else(|| E::custom("non-finite JSON number"))
    }

    fn visit_str<E: serde::de::Error>(self, value: &str) -> Result<Value, E> {
        Ok(Value::String(value.to_owned()))
    }

    fn visit_string<E: serde::de::Error>(self, value: String) -> Result<Value, E> {
        Ok(Value::String(value))
    }

    fn visit_unit<E: serde::de::Error>(self) -> Result<Value, E> {
        Ok(Value::Null)
    }

    fn visit_none<E: serde::de::Error>(self) -> Result<Value, E> {
        Ok(Value::Null)
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut sequence: A) -> Result<Value, A::Error> {
        let mut values = Vec::new();
        while let Some(value) = sequence.next_element_seed(JsonSeed(self.0 + 1))? {
            values.push(value);
        }
        Ok(Value::Array(values))
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Value, A::Error> {
        let mut values = Map::new();
        let mut keys = BTreeSet::new();
        while let Some(key) = map.next_key::<String>()? {
            if !keys.insert(key.clone()) {
                return Err(serde::de::Error::custom("duplicate JSON key"));
            }
            let value = map.next_value_seed(JsonSeed(self.0 + 1))?;
            values.insert(key, value);
        }
        Ok(Value::Object(values))
    }
}

#[derive(Clone, Debug)]
enum ParsedEvent {
    Text {
        item_id: String,
        text: String,
    },
    Refusal {
        item_id: String,
        text: String,
    },
    Tool {
        call_id: String,
        name: String,
        arguments: JsonValue,
    },
}

#[derive(Default)]
struct ParsedStream {
    events: Vec<ParsedEvent>,
    response_id: Option<String>,
    model: Option<String>,
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    actual_service_tier: Option<String>,
    http_error: Option<WireError>,
    json_body: Vec<u8>,
    terminal: bool,
    refusal: bool,
    items: BTreeMap<u64, OutputItem>,
    sequence: Option<u64>,
    stop_reason: Option<String>,
}

struct OutputItem {
    id: String,
    kind: String,
    call_id: Option<String>,
    name: Option<String>,
    arguments: String,
    parts: BTreeMap<u64, Part>,
    done: Option<Value>,
}

struct Part {
    kind: String,
    text: String,
    done: bool,
}

fn string<'a>(value: &'a Value, key: &str) -> Result<&'a str, WireError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or(WireError::Malformed)
}

fn identity(value: &Value, key: &str) -> Result<String, WireError> {
    let text = string(value, key)?;
    if text.is_empty() || text.len() > 256 || text.chars().any(char::is_control) {
        return Err(WireError::Identity);
    }
    Ok(text.to_owned())
}

fn index(value: &Value, key: &str) -> Result<u64, WireError> {
    value
        .get(key)
        .and_then(Value::as_u64)
        .filter(|value| *value < 128)
        .ok_or(WireError::Malformed)
}

fn append_bounded(target: &mut String, text: &str, limit: usize) -> Result<(), WireError> {
    if target.len().saturating_add(text.len()) > limit {
        return Err(WireError::Limit);
    }
    target.push_str(text);
    Ok(())
}

impl ParsedStream {
    fn envelope(&mut self, event: SseEvent) -> Result<Value, WireError> {
        if self.terminal {
            return Err(WireError::Malformed);
        }
        let value = strict_json(event.data.as_bytes(), MAX_FRAME_BYTES)?;
        let kind = string(&value, "type")?;
        if event.event.as_deref().is_some_and(|name| name != kind) {
            return Err(WireError::Identity);
        }
        Ok(value)
    }

    fn response_identity(&mut self, value: &Value) -> Result<(), WireError> {
        let id = identity(value, "id")?;
        let model = identity(value, "model")?;
        if self
            .response_id
            .as_ref()
            .is_some_and(|previous| *previous != id)
            || self
                .model
                .as_ref()
                .is_some_and(|previous| *previous != model)
        {
            return Err(WireError::Identity);
        }
        self.response_id = Some(id);
        self.model = Some(model);
        Ok(())
    }

    fn usage(&mut self, value: &Value, final_output: bool) -> Result<(), WireError> {
        if value.is_null() {
            return Ok(());
        }
        if !value.is_object() {
            return Err(WireError::Malformed);
        }
        let input = value
            .get("input_tokens")
            .map(|value| value.as_u64().ok_or(WireError::Malformed))
            .transpose();
        let output = value
            .get("output_tokens")
            .map(|value| value.as_u64().ok_or(WireError::Malformed))
            .transpose();
        // Each counter is independent evidence. One malformed field cannot
        // discard its valid counterpart or an earlier observed counter.
        let input_error = match input {
            Ok(Some(input)) if self.input_tokens.is_some_and(|previous| previous != input) => {
                Some(WireError::Identity)
            }
            Ok(Some(input)) => {
                self.input_tokens = Some(input);
                None
            }
            Ok(None) => None,
            Err(error) => Some(error),
        };
        let output_error = match output {
            Ok(Some(output))
                if final_output && self.output_tokens.is_some_and(|previous| previous > output) =>
            {
                Some(WireError::Identity)
            }
            Ok(Some(output)) if final_output => {
                self.output_tokens = Some(output);
                None
            }
            Ok(_) => None,
            Err(error) => Some(error),
        };
        input_error.or(output_error).map_or(Ok(()), Err)
    }

    fn service_tier(&mut self, value: Option<&Value>, expected: &str) -> Result<(), WireError> {
        let Some(value) = value.filter(|value| !value.is_null()) else {
            return Ok(());
        };
        let tier = value
            .as_str()
            .filter(|value| zobba_domain::model::valid_external_id(value))
            .ok_or(WireError::Malformed)?;
        let changed = self
            .actual_service_tier
            .as_deref()
            .is_some_and(|previous| previous != tier);
        // Preserve the actual nonstandard value even when it contradicts an
        // earlier Standard observation; its potential billing consequence is
        // an immutable fact, not permission to accept the output.
        self.actual_service_tier = Some(tier.to_owned());
        if changed || tier != expected {
            return Err(WireError::Identity);
        }
        Ok(())
    }

    fn metadata(
        &mut self,
        provider: Provider,
        value: &Value,
        final_output: bool,
        require_identity: bool,
    ) -> Result<(), WireError> {
        let identity =
            if require_identity || value.get("id").is_some() || value.get("model").is_some() {
                self.response_identity(value)
            } else {
                Ok(())
            };
        let usage = self.usage_metadata(provider, value, final_output);
        // Collect independent bounded facts before propagating a mismatch.
        identity?;
        usage
    }

    fn usage_metadata(
        &mut self,
        provider: Provider,
        value: &Value,
        final_output: bool,
    ) -> Result<(), WireError> {
        let usage = self.usage(&value["usage"], final_output);
        let tier = match provider {
            Provider::OpenAi => self.service_tier(value.get("service_tier"), "default"),
            Provider::Anthropic => {
                self.service_tier(value["usage"].get("service_tier"), "standard")
            }
        };
        tier?;
        usage
    }

    fn item_mut(&mut self, value: &Value) -> Result<&mut OutputItem, WireError> {
        let item = self
            .items
            .get_mut(&index(value, "output_index")?)
            .ok_or(WireError::Identity)?;
        if item.id != string(value, "item_id")? || item.done.is_some() {
            return Err(WireError::Identity);
        }
        Ok(item)
    }

    fn openai(&mut self, event: SseEvent) -> Result<(), WireError> {
        let value = self.envelope(event)?;
        let sequence = value
            .get("sequence_number")
            .and_then(Value::as_u64)
            .ok_or(WireError::Malformed)?;
        if self.sequence.is_some_and(|previous| sequence <= previous) {
            return Err(WireError::Identity);
        }
        self.sequence = Some(sequence);
        let kind = string(&value, "type")?;
        match kind {
            "response.created" => {
                if self.response_id.is_some() {
                    return Err(WireError::Identity);
                }
                self.metadata(Provider::OpenAi, &value["response"], false, true)?;
            }
            "response.in_progress" => {
                self.require_started()?;
                self.metadata(Provider::OpenAi, &value["response"], false, true)?;
            }
            "response.output_item.added" => {
                self.require_started()?;
                let index = index(&value, "output_index")?;
                let wire = &value["item"];
                let id = identity(wire, "id")?;
                let kind = string(wire, "type")?;
                if !matches!(kind, "message" | "function_call") {
                    return Err(WireError::Unsupported);
                }
                if self.items.contains_key(&index) || self.items.values().any(|item| item.id == id)
                {
                    return Err(WireError::Identity);
                }
                let (call_id, name) = if kind == "function_call" {
                    if !string(wire, "arguments")?.is_empty() {
                        return Err(WireError::Malformed);
                    }
                    (
                        Some(identity(wire, "call_id")?),
                        Some(identity(wire, "name")?),
                    )
                } else {
                    if string(wire, "role")? != "assistant"
                        || wire["content"]
                            .as_array()
                            .is_none_or(|parts| !parts.is_empty())
                    {
                        return Err(WireError::Malformed);
                    }
                    (None, None)
                };
                self.items.insert(
                    index,
                    OutputItem {
                        id,
                        kind: kind.to_owned(),
                        call_id,
                        name,
                        arguments: String::new(),
                        parts: BTreeMap::new(),
                        done: None,
                    },
                );
            }
            "response.content_part.added" => {
                let item = self.item_mut(&value)?;
                let index = index(&value, "content_index")?;
                let kind = string(&value["part"], "type")?;
                if item.kind != "message" || item.parts.contains_key(&index) {
                    return Err(WireError::Identity);
                }
                let field = match kind {
                    "output_text" => "text",
                    "refusal" => "refusal",
                    _ => return Err(WireError::Unsupported),
                };
                if !string(&value["part"], field)?.is_empty() {
                    return Err(WireError::Malformed);
                }
                item.parts.insert(
                    index,
                    Part {
                        kind: kind.to_owned(),
                        text: String::new(),
                        done: false,
                    },
                );
                self.refusal |= kind == "refusal";
            }
            "response.output_text.delta" | "response.refusal.delta" => {
                let refusal = kind == "response.refusal.delta";
                let item = self.item_mut(&value)?;
                let part = item
                    .parts
                    .get_mut(&index(&value, "content_index")?)
                    .ok_or(WireError::Identity)?;
                if part.done || part.kind != if refusal { "refusal" } else { "output_text" } {
                    return Err(WireError::Identity);
                }
                let text = string(&value, "delta")?.to_owned();
                append_bounded(&mut part.text, &text, MAX_FRAME_BYTES)?;
                let item_id = item.id.clone();
                self.events.push(if refusal {
                    ParsedEvent::Refusal { item_id, text }
                } else {
                    ParsedEvent::Text { item_id, text }
                });
                self.refusal |= refusal;
            }
            "response.output_text.done" | "response.refusal.done" => {
                let refusal = kind == "response.refusal.done";
                let item = self.item_mut(&value)?;
                let part = item
                    .parts
                    .get_mut(&index(&value, "content_index")?)
                    .ok_or(WireError::Identity)?;
                let field = if refusal { "refusal" } else { "text" };
                if part.done
                    || part.kind != if refusal { "refusal" } else { "output_text" }
                    || part.text != string(&value, field)?
                {
                    return Err(WireError::Identity);
                }
                part.done = true;
            }
            "response.content_part.done" => {
                let item = self.item_mut(&value)?;
                let part = item
                    .parts
                    .get(&index(&value, "content_index")?)
                    .ok_or(WireError::Identity)?;
                Self::check_part(part, &value["part"])?;
            }
            "response.function_call_arguments.delta" => {
                let item = self.item_mut(&value)?;
                if item.kind != "function_call" {
                    return Err(WireError::Identity);
                }
                append_bounded(
                    &mut item.arguments,
                    string(&value, "delta")?,
                    MAX_ARGUMENT_BYTES,
                )?;
            }
            "response.function_call_arguments.done" => {
                let item = self.item_mut(&value)?;
                if item.kind != "function_call" || item.arguments != string(&value, "arguments")? {
                    return Err(WireError::Identity);
                }
                if !strict_json(item.arguments.as_bytes(), MAX_ARGUMENT_BYTES)?.is_object() {
                    return Err(WireError::Malformed);
                }
                if let Some(name) = value.get("name")
                    && name.as_str() != item.name.as_deref()
                {
                    return Err(WireError::Identity);
                }
            }
            "response.output_item.done" => {
                let item = self
                    .items
                    .get_mut(&index(&value, "output_index")?)
                    .ok_or(WireError::Identity)?;
                if item.done.is_some() {
                    return Err(WireError::Identity);
                }
                Self::check_item(item, &value["item"])?;
                item.done = Some(value["item"].clone());
            }
            "response.completed" => {
                self.require_started()?;
                let response = &value["response"];
                self.metadata(Provider::OpenAi, response, true, true)?;
                if string(response, "status")? != "completed" {
                    return Err(WireError::Incomplete);
                }
                let output = response["output"].as_array().ok_or(WireError::Malformed)?;
                if output.len() != self.items.len() {
                    return Err(WireError::Identity);
                }
                for (index, wire) in output.iter().enumerate() {
                    if self
                        .items
                        .get(&(index as u64))
                        .and_then(|item| item.done.as_ref())
                        != Some(wire)
                    {
                        return Err(WireError::Identity);
                    }
                }
                self.terminal = true;
                if !self.refusal {
                    self.release_tools()?;
                }
            }
            "response.incomplete" | "response.failed" => {
                self.require_started()?;
                self.metadata(Provider::OpenAi, &value["response"], true, true)?;
                return Err(if kind == "response.incomplete" {
                    WireError::Incomplete
                } else {
                    WireError::Unavailable
                });
            }
            "error" => {
                self.metadata(Provider::OpenAi, &value, true, false)?;
                return Err(WireError::Unavailable);
            }
            _ => return Err(WireError::Unsupported),
        }
        Ok(())
    }

    fn require_started(&self) -> Result<(), WireError> {
        self.response_id
            .as_ref()
            .map(|_| ())
            .ok_or(WireError::Identity)
    }

    fn check_part(part: &Part, wire: &Value) -> Result<(), WireError> {
        let field = if part.kind == "refusal" {
            "refusal"
        } else {
            "text"
        };
        if !part.done || part.kind != string(wire, "type")? || part.text != string(wire, field)? {
            return Err(WireError::Identity);
        }
        Ok(())
    }

    fn check_item(item: &OutputItem, wire: &Value) -> Result<(), WireError> {
        if item.id != string(wire, "id")?
            || item.kind != string(wire, "type")?
            || string(wire, "status")? != "completed"
        {
            return Err(WireError::Identity);
        }
        if item.kind == "function_call" {
            if Some(string(wire, "call_id")?) != item.call_id.as_deref()
                || Some(string(wire, "name")?) != item.name.as_deref()
                || string(wire, "arguments")? != item.arguments
            {
                return Err(WireError::Identity);
            }
            if !strict_json(item.arguments.as_bytes(), MAX_ARGUMENT_BYTES)?.is_object() {
                return Err(WireError::Malformed);
            }
        } else {
            if string(wire, "role")? != "assistant" {
                return Err(WireError::Identity);
            }
            let parts = wire["content"].as_array().ok_or(WireError::Malformed)?;
            if parts.len() != item.parts.len() {
                return Err(WireError::Identity);
            }
            for (index, wire) in parts.iter().enumerate() {
                Self::check_part(
                    item.parts.get(&(index as u64)).ok_or(WireError::Identity)?,
                    wire,
                )?;
            }
        }
        Ok(())
    }

    fn release_tools(&mut self) -> Result<(), WireError> {
        let mut calls = BTreeSet::new();
        for item in self.items.values() {
            if let (Some(call_id), Some(name)) = (&item.call_id, &item.name) {
                if !calls.insert(call_id) || item.done.is_none() {
                    return Err(WireError::Identity);
                }
                let arguments =
                    portable_json(strict_json(item.arguments.as_bytes(), MAX_ARGUMENT_BYTES)?)?;
                if !arguments.is_valid() {
                    return Err(WireError::Limit);
                }
                self.events.push(ParsedEvent::Tool {
                    call_id: call_id.clone(),
                    name: name.clone(),
                    arguments,
                });
            }
        }
        Ok(())
    }

    fn anthropic(&mut self, event: SseEvent) -> Result<(), WireError> {
        let value = self.envelope(event)?;
        match string(&value, "type")? {
            "ping" => {}
            "message_start" => {
                if self.response_id.is_some() {
                    return Err(WireError::Identity);
                }
                let message = &value["message"];
                if string(message, "type")? != "message"
                    || string(message, "role")? != "assistant"
                    || message["content"]
                        .as_array()
                        .is_none_or(|parts| !parts.is_empty())
                {
                    return Err(WireError::Malformed);
                }
                self.metadata(Provider::Anthropic, message, false, true)?;
            }
            "content_block_start" => {
                self.require_started()?;
                if self.stop_reason.is_some() {
                    return Err(WireError::Identity);
                }
                let index = index(&value, "index")?;
                if self.items.contains_key(&index) {
                    return Err(WireError::Identity);
                }
                let block = &value["content_block"];
                let kind = string(block, "type")?;
                let (id, call_id, name, parts) = match kind {
                    "text" => {
                        let id = format!(
                            "{}:{index}",
                            self.response_id.as_deref().ok_or(WireError::Identity)?
                        );
                        let text = string(block, "text")?.to_owned();
                        if !text.is_empty() {
                            self.events.push(ParsedEvent::Text {
                                item_id: id.clone(),
                                text: text.clone(),
                            });
                        }
                        (
                            id,
                            None,
                            None,
                            BTreeMap::from([(
                                0,
                                Part {
                                    kind: "text".into(),
                                    text,
                                    done: false,
                                },
                            )]),
                        )
                    }
                    "tool_use" => {
                        if block["input"]
                            .as_object()
                            .is_none_or(|input| !input.is_empty())
                        {
                            return Err(WireError::Malformed);
                        }
                        let id = identity(block, "id")?;
                        (
                            id.clone(),
                            Some(id),
                            Some(identity(block, "name")?),
                            BTreeMap::new(),
                        )
                    }
                    _ => return Err(WireError::Unsupported),
                };
                if self.items.values().any(|item| item.id == id) {
                    return Err(WireError::Identity);
                }
                self.items.insert(
                    index,
                    OutputItem {
                        id,
                        kind: kind.to_owned(),
                        call_id,
                        name,
                        arguments: String::new(),
                        parts,
                        done: None,
                    },
                );
            }
            "content_block_delta" => {
                if self.stop_reason.is_some() {
                    return Err(WireError::Identity);
                }
                let item = self
                    .items
                    .get_mut(&index(&value, "index")?)
                    .ok_or(WireError::Identity)?;
                if item.done.is_some() {
                    return Err(WireError::Identity);
                }
                let delta = &value["delta"];
                match string(delta, "type")? {
                    "text_delta" if item.kind == "text" => {
                        let text = string(delta, "text")?.to_owned();
                        append_bounded(
                            &mut item.parts.get_mut(&0).ok_or(WireError::Identity)?.text,
                            &text,
                            MAX_FRAME_BYTES,
                        )?;
                        self.events.push(ParsedEvent::Text {
                            item_id: item.id.clone(),
                            text,
                        });
                    }
                    "input_json_delta" if item.kind == "tool_use" => append_bounded(
                        &mut item.arguments,
                        string(delta, "partial_json")?,
                        MAX_ARGUMENT_BYTES,
                    )?,
                    _ => return Err(WireError::Unsupported),
                }
            }
            "content_block_stop" => {
                if self.stop_reason.is_some() {
                    return Err(WireError::Identity);
                }
                let item = self
                    .items
                    .get_mut(&index(&value, "index")?)
                    .ok_or(WireError::Identity)?;
                if item.done.is_some() {
                    return Err(WireError::Identity);
                }
                if item.kind == "tool_use"
                    && !strict_json(item.arguments.as_bytes(), MAX_ARGUMENT_BYTES)?.is_object()
                {
                    return Err(WireError::Malformed);
                }
                item.done = Some(Value::Bool(true));
            }
            "message_delta" => {
                self.require_started()?;
                if self.stop_reason.is_some() || self.items.values().any(|item| item.done.is_none())
                {
                    return Err(WireError::Identity);
                }
                self.stop_reason = Some(string(&value["delta"], "stop_reason")?.to_owned());
                self.metadata(Provider::Anthropic, &value, true, false)?;
            }
            "message_stop" => {
                self.require_started()?;
                if self.items.values().any(|item| item.done.is_none()) {
                    return Err(WireError::Incomplete);
                }
                let has_tools = self.items.values().any(|item| item.kind == "tool_use");
                match self.stop_reason.as_deref() {
                    Some("end_turn") if !has_tools => {}
                    Some("tool_use") if has_tools => self.release_tools()?,
                    Some("refusal") => self.refusal = true,
                    Some("max_tokens" | "stop_sequence" | "pause_turn") => {
                        return Err(WireError::Incomplete);
                    }
                    _ => return Err(WireError::Identity),
                }
                self.terminal = true;
            }
            "error" => {
                self.metadata(Provider::Anthropic, &value, true, false)?;
                return Err(match value["error"]["type"].as_str() {
                    Some("rate_limit_error") => WireError::RateLimited,
                    _ => WireError::Unavailable,
                });
            }
            _ => return Err(WireError::Unsupported),
        }
        Ok(())
    }
}
