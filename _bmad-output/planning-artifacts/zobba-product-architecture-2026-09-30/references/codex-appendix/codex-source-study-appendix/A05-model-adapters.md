# 05 — Model adapters (Codex `8ffd91e42aa001b7e897bea812b02f89264f9fa0`)

Area: provider coupling, wire format, streaming assembly, retries, usage, continuation, credentials.
Paths are relative to the Codex repo root. Licence: Apache-2.0 (`LICENSE`; `license = "Apache-2.0"` at
`codex-rs/Cargo.toml:L167`, all cited crates use `license.workspace = true`; `NOTICE` credits only Ratatui).
Evidence labels sit on each finding heading and on [TEST]/[INFERENCE] bullets; the unlabelled "Problem solved",
"General vs local" and "Audit harness" lines are reviewer analysis and count as [INFERENCE].

## Summary (10 lines)

1. One wire protocol only: `WireApi::Responses`; `wire_api = "chat"` and `ollama-chat` are hard config errors — there is no Chat Completions path to study.
2. Provider = serialized `ModelProviderInfo` (URL, auth source, retry knobs, flags) + runtime `ModelProvider` trait (capability upper bounds, auth recovery, error mapping, model catalogue); two impls (generic, Amazon Bedrock).
3. Built-ins: `openai`, `amazon-bedrock`, `amazon-bedrock-runtime`, `ollama`, `lmstudio`; all others come from `config.toml`; Azure is detected by name/URL heuristics.
4. Requests are stateless: `store:false`, full history resent over HTTP, reasoning returned as `reasoning.encrypted_content` and round-tripped; `previous_response_id` is used only on the Responses WebSocket transport (default: built-in OpenAI only) after a *completed* response.
5. Streaming never accumulates function-argument deltas; whole items are committed on `response.output_item.done`, and tools run before `response.completed`.
6. Retries: HTTP layer (4 retries, 200 ms base, 5xx/transport, never 429) nested inside a stream layer (5 retries, rebuilds the prompt from history; unbounded connection retries on by default); no idempotency key or response-id dedup.
7. Usage comes only from `response.completed`; per-response/turn/thread records are persisted; UI context % = last `total_tokens` vs 95 % window minus a 12 000-token baseline.
8. Model capabilities: bundled `models.json` (472 KB) + remote `/models` from the Codex backend (hosted); unknown slugs get a fallback with no `apply_patch` tool.
9. Hosted-only: ChatGPT auth/refresh, Codex backend routes, WebSocket v2, Responses Lite, remote compaction (encrypted), realtime, rate-limit headers, safety buffering, model catalogue.
10. Verdict: implement a provider-neutral adapter independently; adopt the item-done commit, typed two-layer retry, capability upper bound and credential-isolating proxy patterns.

## 1. Provider abstraction and selection

**F1 — Exactly one wire protocol (Responses). [OBSERVED]**
Problem solved: keep one internal item model and one streaming parser instead of maintaining lossy per-protocol mappings.
`WireApi` has one variant (`codex-rs/model-provider-info/src/lib.rs:L101-L108`); its deserializer maps `"chat"`
to `CHAT_WIRE_API_REMOVED_ERROR` (`L97`, `L119-L131`); `ollama-chat` is rejected at provider lookup
(`L98-L99`; `codex-rs/core/src/config/mod.rs:L3821-L3834`). `ModelClientSession::stream` matches only
`WireApi::Responses` (`codex-rs/core/src/client.rs:L2218-L2270`). `grep -rn "chat/completions|ChatCompletion|WireApi::Chat"`
outside `vendor/` returned nothing.
- [TEST] `test_deserialize_chat_wire_api_shows_helpful_error` (`codex-rs/model-provider-info/src/model_provider_info_tests.rs:L187-L197`) fails if `chat` is accepted again or the error text changes.
- [INFERENCE] Chat-Completions question: nothing is mapped and everything is lost — a chat-only backend is usable only behind an external `/v1/responses` translator. The internal item model (`ResponseItem`) *is* the OpenAI Responses schema.
- General vs local: dropping the second protocol is a product simplification, not a local-environment constraint.
- Audit harness: a single internal schema is fine, but it should be vendor-neutral and versioned. **IMPLEMENT INDEPENDENTLY** — Codex has deleted its only second adapter, so there is no multi-provider mapping to lift.

**F2 — Config record vs runtime provider. [OBSERVED]**
Problem solved: target OpenAI, Bedrock, local OSS servers or any Responses-compatible gateway by configuration, with provider-specific auth and features behind one trait.
`ModelProviderInfo` (`lib.rs:L134-L202`) carries `base_url`, `model_catalog_url`, `env_key`, `experimental_bearer_token`,
command `auth`, `gateway_oauth`, `aws`, `query_params`, static/env headers, `request_max_retries`,
`stream_max_retries`, `stream_idle_timeout_ms`, `websocket_connect_timeout_ms`, `requires_openai_auth`,
`supports_websockets`, `supports_standalone_web_search`. `to_api_provider` (`L420-L469`) defaults the base URL to
`https://chatgpt.com/backend-api/codex` for ChatGPT-family auth modes, else `https://api.openai.com/v1`, adds a managed
residency header, and fixes HTTP retry policy (`base_delay 200 ms`, `retry_429:false`, `retry_5xx:true`,
`retry_transport:true`, `L448-L454`). Built-ins (`L651-L684`) are OpenAI, Bedrock Mantle, Bedrock Runtime, and
`gpt-oss` providers at `localhost:11434/v1` / `localhost:1234/v1` (override via `CODEX_OSS_PORT`/`CODEX_OSS_BASE_URL`,
`L728-L745`); user providers only *extend* the map, except Bedrock endpoint/auth/header overrides (`L686-L726`).
Selection order: managed requirement → CLI → `model_provider` in config → `"openai"` (`core/src/config/mod.rs:L3821-L3835`).
Runtime trait `ModelProvider` (`codex-rs/model-provider/src/provider.rs:L141-L352`): `capabilities()` returns
`ProviderCapabilities{namespace_tools, image_generation, web_search, external_web_access, remote_compaction}`
documented as a provider-owned *upper bound* (`L46-L70`); `include_internal_metadata` is true only for the runtime flag (built-in OpenAI) or an `api.openai.com`/ChatGPT
host (`L146-L155`); `is_recoverable_auth_error`, `recover_from_unauthorized` (`L205-L229`); `map_api_error` (`L231`);
`responses_api_provider` (ChatGPT workspace routing, `L249-L284`); `models_manager` (`L319`). `create_model_provider`
(`L369-L390`) picks `AmazonBedrockModelProvider` by *display-name* match, else `ConfiguredModelProvider`, which grants
remote compaction V2 to OpenAI or to `is_azure_responses_provider` (name `azure` or URL markers,
`codex-rs/codex-api/src/provider.rs:L4-L25`; `provider.rs:L461-L473`). Bedrock: no image generation, web search only on
Mantle, no external web access (`codex-rs/model-provider/src/amazon_bedrock/mod.rs:L277-L285`), and it forces
`use_responses_lite=false` and the default service tier (`amazon_bedrock/catalog.rs:L91-L135`).
- [TEST] `openai_provider_enables_remote_compaction`, `configured_provider_remote_compaction_matches_provider_support` (`provider.rs:L756-L806`) detect drift in the OpenAI/Azure heuristic; `capabilities_enable_web_search_but_disable_image_generation` and `runtime_capabilities_disable_web_search_and_support_v2_remote_compaction` (`amazon_bedrock/mod.rs:L686-L722`) detect Bedrock capability drift.
- Limitation: identity by name (`is_openai(): name == "OpenAI"`, `lib.rs:L608-L610`) and URL substrings.
- General vs local: capability bounds and provider-owned recovery are general; localhost OSS providers, env-var keys and name heuristics are single-user CLI conveniences.
- Audit harness: providers must be tenant-scoped, immutable, versioned records with server-evaluated capabilities. **ADOPT PATTERN** — the capability upper bound plus provider-owned auth recovery/error mapping is a clean seam; the name heuristics are not.

## 2. Request construction and continuation

**F3 — The HTTP request is a stateless full-history resend. [OBSERVED]**
Problem solved: build a complete, self-describing request per model call, so no server-side conversation state is needed (`store:false`).
`ModelClient::build_responses_request` (`client.rs:L885-L1008`) builds `ResponsesApiRequest`
(`codex-rs/codex-api/src/common.rs:L278-L304`):

| Field | Value | Reference |
|---|---|---|
| `input` | whole prompt history; image `detail` normalised (`original` downgraded unless supported, dropped in Lite) | `core/src/client_common.rs:L59-L117` |
| `instructions`,`tools` | base instructions + raw JSON tools; in Responses Lite both move into `input` (`AdditionalTools` + developer message) and `instructions=""` | `client.rs:L902-L938` |
| `tool_choice` / `parallel_tool_calls` | `"auto"` / `prompt.parallel_tool_calls && !use_responses_lite`, and `build_prompt` hard-codes `true` | `client.rs:L994-L995`; `core/src/session/turn.rs:L1598` |
| `reasoning` | resolved effort; summary only if the model accepts it and it is not `none`; `context:"all_turns"` only in Lite | `client.rs:L863-L882` |
| `store` / `stream` / `include` | `false` / `true` / `["reasoning.encrypted_content"]` | `client.rs:L959`, `L997` |
| `prompt_cache_key` | override, `{source}:{parent_thread_id}` for internal sessions, else session id | `client.rs:L575-L589`, `L976` |
| `service_tier` | model-resolved; `None` for Bedrock | `client.rs:L977-L982` |
| `text` | verbosity (if supported) + JSON-schema output (`codex_output_schema`, strict) | `common.rs:L393-L411` |

No `max_output_tokens` exists on the struct. For non-OpenAI providers the wire copy strips
`internal_chat_message_metadata_passthrough` and `encrypted_function_args` (`client.rs:L940-L951`); unprefixed item ids
are removed (`L1010-L1019`); `ConfigurationUpdate` effort items are filtered unless OpenAI + model support
(`L552-L558`, `L899`). zstd compression only for Codex-backend auth on OpenAI (`L1617-L1627`; feature
`enable_request_compression` Stable, default on, `codex-rs/features/src/lib.rs:L1291-L1296`). A 15 MiB soft cap sheds only
tool metadata (`core/src/client_tool_metadata.rs:L10-L41`).
- [TEST] `azure_responses_request_does_not_store_and_preserves_prefixed_item_ids` (`core/tests/suite/client.rs:L3148-L3368`) asserts `store:false`, `stream:true`, prefixed ids kept and unprefixed ids dropped; `responses_lite_sets_all_turns_context_and_disables_parallel_tool_calls` (`L2697-L2733`) asserts Lite semantics.
- Hosted: Responses Lite is OpenAI-internal (header `x-openai-internal-codex-responses-lite`, `client.rs:L176-L177`, `L2337-L2344`; Bedrock forces it off).
- General vs local: full resend with client-held reasoning is general to stateless LLM APIs; Lite, cache keys and internal metadata are OpenAI-specific.
- Audit harness: a full resend is reproducible — the request can be hashed and stored as evidence — but encrypted reasoning is opaque to auditors. **ADAPT IDENTIFIED CODE** — the field-level builder is compact; replace OpenAI-only fields with capability-gated options.

**F4 — `previous_response_id` only on WebSocket v2, only after a completed response. [OBSERVED]**
Problem solved: avoid re-uploading an ever-growing history on every tool round-trip, without risking a continuation from a response the client never saw complete.
Only `ResponseCreateWsRequest` has `previous_response_id` (`common.rs:L331-L361`). `prepare_websocket_request`
(`client.rs:L1429-L1447`) uses it only when (a) the previous stream delivered `LastResponse` (the oneshot is sent only on
`Completed`, `L2440-L2446`), (b) `get_incremental_items` proves new input = previous input + previous output (+ suffix)
(`L1384-L1417`), and (c) `responses_request_properties_match` (`L337-L392`) finds every non-input field equal (its
destructuring is exhaustive so a new field forces a decision). Otherwise it sends a full create. Prewarm sends
`generate:false` (`L2015`, `L2157-L2207`). Headers: `OpenAI-Beta: responses_websockets=2026-02-06` (`L175`, `L1321-L1324`).
`previous_response_not_found` and the 60-minute `websocket_connection_limit_reached` map to `ApiError::Retryable`
(`codex-rs/codex-api/src/endpoint/responses_websocket.rs:L163-L167`, `L619-L646`). WebSocket is used only when
`supports_websockets` (default true only for built-in OpenAI; custom providers may opt in) and not disabled (`client.rs:L1024-L1033`); HTTP 426 falls back
(`L1506-L1507`, `L1921-L1922`); exhausting stream retries switches the whole session to HTTP permanently
(`core/src/responses_retry.rs:L119-L135`; `client.rs:L648-L666`). AWS SigV4 providers may not enable websockets
(`model-provider-info/src/lib.rs:L297-L303`).
- [TEST] `responses_websocket_v2_after_error_uses_full_create_without_previous_response_id` (`core/tests/suite/client_websockets.rs:L2410-L2508`) detects a failed response being used as a continuation base; `responses_websocket_creates_when_non_input_request_fields_change` (`L2288`); `responses_websocket_connection_limit_error_reconnects_and_completes` (`L1912`); `core/tests/suite/websocket_fallback.rs:L34/L86/L210` (426 fallback, fallback after retries, stickiness).
- Hosted: requires OpenAI's WebSocket v2 service with connection-scoped state.
- General vs local: connection reuse and prewarm are latency optimisations for one interactive user.
- Audit harness: connection-scoped server state is non-durable and not replayable. **DO NOT ADOPT** as a correctness mechanism; keep the full-resend path authoritative.

## 3. Streaming assembly

**F5 — No partial tool-argument accumulator; whole items commit on `output_item.done`. [OBSERVED]**
Problem solved: turn an SSE/WebSocket event stream into complete, typed items with bounded memory and clear end-of-response semantics.
`spawn_response_stream` (`codex-rs/codex-api/src/sse/responses.rs:L37-L104`) first emits header-derived events
(`openai-model`→`ServerModel`, rate limits, `X-Models-Etag`, `x-reasoning-included`, captures `x-codex-turn-state`),
then a spawned task runs `process_sse_with_treatment` (`L524-L667`) into `mpsc(1600)` (`L73`).
`process_responses_event` (`L344-L506`):

| Wire event | Result |
|---|---|
| `response.output_item.done` | `OutputItemDone(ResponseItem)`; a parse failure is only `debug!`-logged and dropped (`L353-L359`) |
| `response.output_item.added` / `output_text.delta` | `OutputItemAdded` / `OutputTextDelta` |
| `response.custom_tool_call_input.delta` | `ToolCallInputDelta` (display only, `L366-L376`) |
| `response.function_call_arguments.delta/.done` | ignored (`L481-L491`) |
| reasoning summary/text deltas | `Reasoning*` events |
| `response.completed` | `Completed{id, usage, usage_metadata, end_turn}`, task ends |
| `response.incomplete` | `interrupted`→`Completed{end_turn:false}`; `content_filter`→`ContentFilter`; other→`Stream("Incomplete response returned, reason: …")` (`L418-L463`) |
| `response.failed` | classified error held until EOF (`L413-L417`, `L640-L647`) |

Truncation detection: EOF before `response.completed` → `Stream("stream closed before response.completed")`
(`L558-L564`); no bytes for `stream_idle_timeout` (default 300 s) → `"idle timeout waiting for SSE"` (`L536-L570`);
malformed frames skipped (`L575-L586`). `FunctionCall.arguments` stays a raw JSON string
(`codex-rs/protocol/src/models.rs:L1074-L1093`) parsed only by the handler; bad JSON becomes a tool output to the model
(`"failed to parse function arguments…"`, `core/src/tools/handlers/mod.rs:L86-L93`). Custom-tool deltas feed a diff
consumer created on `OutputItemAdded` (`turn.rs:L2817-L2834`, `L3034-L3051`) for live patch previews — never execution.
The WebSocket path shares `process_responses_event` but fails immediately on `response.failed`, treats
`Close`/`Binary` as errors, and supports `response.interrupt` with `mode:"discard_partial_items"`
(`responses_websocket.rs:L664-L848`, `L693-L707`).
- [TEST] `parses_tool_call_input_deltas` (`sse/responses.rs:L921-L951`) asserts a function-arguments delta produces no event; `error_when_missing_completed` (`L857-L882`) asserts the EOF error text; `emits_completed_without_stream_end` (`L953-L997`) asserts completion without EOF; `context_window_error_is_fatal` (`L1092-L1102`); `table_driven_event_kinds` (`L1366`) covers unknown kinds.
- [INFERENCE] Risks: a known-type item that fails to deserialize vanishes (neither executed nor recorded, so the next resend omits it); if a server keeps SSE open after `response.failed`, the idle-timeout message replaces the classified error after 300 s (`L565-L570` ignore `response_error`). No idle-timeout unit test found (`grep "idle timeout waiting for SSE"` hits only source).
- General vs local: general to any streamed tool-calling API.
- Audit harness: item-level commit is the right evidence granularity, but unparseable items must fail closed with the raw payload retained. **ADOPT PATTERN** (commit on item-done; deltas are display-only) with fail-closed parsing.

**F6 — Items and tool effects commit before `response.completed`; a retry resends history. [OBSERVED]**
Problem solved: start tools as early as possible (latency) and avoid re-running side effects when a stream breaks.
In `try_run_sampling_request` (`turn.rs:L2525-L3197`), `handle_output_item_done`
(`core/src/stream_events_utils.rs:L315-L433`) records a tool-call item immediately (`L346-L347`) and queues its future in a
turn-owned `FuturesOrdered` (`L349-L357`); non-tool items are recorded too (`L389-L395`). After the loop — also on error —
`drain_in_flight` records tool outputs (`turn.rs:L3161-L3171`). `run_sampling_request` (`L1618-L1751`) then rebuilds the
prompt from `sess.clone_history()` (`L1655-L1661`). So executed tools are not re-run and partial output persists (a
history-level resume; there is no stream resume). `end_turn == Some(false)` forces a follow-up (`L2994-L2996`).
State ownership: the parse task owns the byte stream; the mapper task (`client.rs:L2369-L2522`) owns `items_added` and the
`LastResponse` oneshot and stops on a `consumer_dropped` token (`client_common.rs:L119-L139`); the turn task owns
`in_flight` and parsers; history lives in session state.
- [TEST] `retries_on_early_close` (`core/tests/suite/stream_no_completed.rs:L27-L104`) asserts exactly two requests after a stream without `response.completed`; `dropped_response_stream_traces_cancelled_partial_output` (`core/src/client_tests.rs:L1518`).
- [INFERENCE] Non-idempotency: no idempotency key is sent (`grep -i idempotency` empty; `x-client-request-id` is the thread id, `codex-api/src/endpoint/responses.rs:L86-L90`). A response completed server-side whose stream was lost is billed, never accounted, not deduplicated by response id, and the retry runs on a history that already holds its partial items.
- General vs local: adequate for a watched local CLI session; insufficient where each lost response must be accounted and each tool call proven single.
- Audit harness: needs a durable attempt journal (attempt id, request hash, partial items, lost-usage flag) and call-id-keyed tool execution records that survive crashes. **ADAPT** the drain-then-resend pattern.

## 4. Retries and failure classification

**F7 — Two nested retry layers with typed classification. [OBSERVED]**
Problem solved: separate transient transport faults (cheap resend of identical bytes) from mid-stream loss (rebuild the request) and from terminal user/quota/policy errors.
*HTTP layer* (before the stream starts): `EndpointSession::stream_encoded_json_with` wraps `transport.stream` in
`run_with_retry` (`codex-api/src/endpoint/session.rs:L122-L155`; `codex-rs/codex-client/src/retry.rs:L84-L118`), resending
identical bytes. Defaults: `request_max_retries` 4 (cap 100), 200 ms doubling ±10 % jitter (`retry.rs:L43-L52`), retry on
5xx and timeout/connection/network, never 429 (`retry.rs:L22-L41`). `Retry-After` (seconds or HTTP date) is captured once
as a deadline `Instant` (`codex-rs/http-client/src/retry_after.rs:L15-L50`) and slept to (`retry.rs:L103-L112`).
*Stream layer* (whole sampling request, mid-stream failures included): `handle_response_stream_error`
(`core/src/responses_retry.rs:L56-L172`), `stream_max_retries` 5 (cap 100); delay = server advice else 200 ms doubling
(`protocol/src/error.rs:L389-L438`; `codex-rs/async-utils/src/backoff.rs:L7-L17`). Content-filter retries first inject
developer guidance (`responses_retry.rs:L66-L81`).

| Condition | Class | Reference |
|---|---|---|
| HTTP 429 `usage_limit_reached` / quota codes / other | UsageLimitReached / QuotaExceeded / RetryLimit (all terminal) | `api_bridge.rs:L181-L253` |
| HTTP 503 `server_is_overloaded` / `slow_down` | ServerOverloaded (terminal) / RateLimitExceeded (retry) | `L101-L125` |
| HTTP 500 / other status | InternalServerError / UnexpectedStatus (retry) | `L179-L180`, `L241-L253` |
| stream `rate_limit_exceeded`,`slow_down` | RateLimitExceeded, delay parsed from "try again in N s/ms" | `sse/responses_error.rs:L82-L88`, `L96-L134` |
| stream context/quota/policy codes | terminal | `L41-L81` |
| stream unknown code | Retryable→Stream (retry) | `L89-L92` |
| transport timeout / connection | RequestTimeout / ConnectionFailed (retry) | `api_bridge.rs:L261-L265` |
| 401 | auth-recovery loop, outside the retry budget | `client.rs:L1777-L1803`, `L2621-L2785` |

Feature `unbounded_connection_retries` (Stable, default on, `features/src/lib.rs:L1297-L1302`): a `ConnectionFailed`
in a non-internal, non-Bedrock sampling turn waits 5 s doubling to 60 s **indefinitely**, without spending the budget
(`responses_retry.rs:L22-L23`, `L92-L117`). Remote compaction caps stream retries at 2 (`core/src/compact_remote_v2.rs:L79`).
- [INFERENCE] Worst case without the unbounded path: 6 stream attempts × 5 HTTP attempts = 30 POSTs per sampling step.
- [TEST] `responses_http_uses_retry_after` (`core/tests/suite/retry_after.rs:L279-L328`) asserts the HTTP layer honours `Retry-After` with two requests; `sse_overload_with_retry_after_is_terminal` (`L1299-L1370`) asserts one request; `map_api_error_distinguishes_http_quota_errors_from_rate_limits` (`codex-api/src/api_bridge_tests.rs:L449-L477`); `rate_limit_error_preserves_retry_delay` (`sse/responses.rs:L999-L1025`, 11.054 s); `connection_failure_pauses_retry_budget_until_provider_is_reachable` (`stream_no_completed.rs:L106-L167`); `streaming_client_retries_on_transport_error` (`codex-api/tests/clients.rs:L428-L484`) asserts identical retried requests.
- General vs local: the classification is general; unbounded connection retries assume a user waiting for the network to return.
- Audit harness: indefinite retries conflict with SLAs and tenant budgets; bound by deadline and budget and journal every attempt. **ADAPT IDENTIFIED CODE** — the classification tables and the `RetryAfter` deadline type are reusable; the retry loop is tied to `Session`.

## 5. Model catalogue, efforts and capabilities

**F8 — Data-driven capabilities: bundled JSON + hosted remote catalogue + fallback. [OBSERVED]**
Problem solved: vary tools, efforts, windows and truncation per model without code changes, and ship new models server-side.
`ModelInfo` (`codex-rs/protocol/src/openai_models.rs:L404-L511`) holds reasoning levels, `shell_type`,
`supports_reasoning_summary_parameter`, `support_verbosity`, `apply_patch_tool_type` (only `Freeform` exists, `L322-L324`),
`web_search_tool_type`, `truncation_policy`, `context_window`/`max_context_window`, `auto_compact_token_limit` (≤ 90 % of
the window, `L525-L536`), `effective_context_window_percent` (default 95, `L389-L391`, `L518-L523`),
`input_modalities`, `use_responses_lite`, `supports_reasoning_effort_updates`, service tiers. There is no model-level max
output or parallel-tool flag; `supports_parallel_tool_calls` is per tool/MCP server (`core/src/tools/router.rs:L239`).
The bundled catalogue `codex-rs/models-manager/models.json` (472,512 bytes, `include_str!` in `models-manager/src/lib.rs:L12-L16`)
lists 11 models: context 272,000 (max 872,000 for most), `apply_patch` freeform, `shell_command`, 10,000-token
truncation, Lite on for all but `gpt-5.5` (read with a JSON dump). Remote refresh: `/models?client_version=` with a 5 s
timeout and 1 MiB cap (`model-provider/src/models_endpoint.rs:L44-L47`), cache file TTL 300 s
(`models-manager/src/manager.rs:L34-L35`), identity-keyed and invalidated on failure (`L579-L649`); API-key users of the
built-in OpenAI provider fetch metadata from the Codex backend, not `/v1/models` (`models_endpoint.rs:L113-L120`). Lookup
is longest-prefix, then one namespace strip (`manager.rs:L855-L920`); a miss yields `model_info_from_slug`: 272k window, no
reasoning levels, `UnifiedExec`, byte truncation, Lite off, **no `apply_patch`** (`models-manager/src/model_info.rs:L99-L150`),
because `apply_patch` is registered only when `apply_patch_tool_type` is set (`core/src/tools/spec_plan.rs:L1269-L1272`), as a
`custom` tool with a Lark grammar (`core/src/tools/handlers/apply_patch_spec.rs:L22-L26`). Efforts:
`resolve_reasoning_effort` maps `Ultra` to the model's multi-agent effort or `Max`, `Persistent` to wire `"disabled"`
(`protocol/src/openai_models/reasoning_effort.rs:L10-L39`); numeric custom efforts serialize as integers
(`codex-api/src/common.rs:L170-L183`).
- [TEST] `get_model_info_tracks_fallback_usage` (`models-manager/src/manager_tests.rs:L747`), `get_model_info_matches_namespaced_suffix` (`L818`), `authoritative_catalog_failure_invalidates_cache_until_refresh_succeeds` (`L1107`), `model_context_window_override_clamps_to_max_context_window` (`models-manager/src/model_info_tests.rs:L252`).
- General vs local: a data-driven catalogue is general; fetching it from the Codex backend is OpenAI-specific.
- Audit harness: the catalogue should be versioned tenant data; unknown models should be refused, not silently degraded. **ADOPT PATTERN** (data-driven capability record with clamped overrides).

## 6. Usage accounting

**F9 — Usage only from `response.completed`; three accumulations; heuristic context %. [OBSERVED]**
Problem solved: show the user cost/context pressure and drive auto-compaction from provider-reported usage.
`ResponseCompletedUsage→TokenUsage` (`sse/responses.rs:L118-L157`): input, cached (`input_tokens_details.cached_tokens`),
cache-write, output, reasoning (`output_tokens_details.reasoning_tokens`), total, `codex_rollout_budget_units`.
`record_observed_response_completed` persists a `TokenUsageRecord` (per response, plus running per-turn and per-thread
sums) to the rollout (`core/src/session/mod.rs:L4690-L4722`; `core/src/state/session.rs:L215-L251`;
`protocol/src/protocol.rs:L2263-L2273`). `record_token_usage_info` updates `TokenUsageInfo{total (sum), last,
model_context_window}` and a per-model tally (`session/mod.rs:L4724-L4770`; `protocol.rs:L2275-L2341`); `TokenCount`
events carry usage + the latest rate-limit snapshot (`session/mod.rs:L4846-L4853`); on context overflow usage is filled to
the window (`L4855-L4861`). The UI's % remaining uses the last `total_tokens` against the usable (95 %) window minus
`BASELINE_TOKENS = 12000` (`protocol.rs:L2419-L2465`; `tui/src/chatwidget.rs:L1124-L1129`; `core/src/session/turn_context.rs:L615-L617`).
Rate limits come only from Codex headers `x-<limit>-primary|secondary-used-percent/window-minutes/reset-at` and credits
(`codex-api/src/rate_limits.rs:L28-L103`, `L263-L268`) or WebSocket `codex.rate_limits` events
(`responses_websocket.rs:L773-L778`); standard `x-ratelimit-*` headers are not parsed (grep empty).
- [TEST] `parses_cache_write_token_usage` (`sse/responses.rs:L802-L828`) pins the field mapping; `observed_response_usage_accumulates_per_turn_and_thread` (`core/tests/suite/token_usage_rollout.rs:L32`).
- [INFERENCE] Failed or lost attempts consume provider tokens with no record; `parse_rate_limit_for_limit` returns `Some` without headers, so every stream emits an empty default snapshot.
- General vs local: the `TokenUsage` shape is general; the 12 000-token baseline and Codex rate-limit headers are product-specific.
- Audit harness: attribute usage per attempt (failures included) and per tenant. **ADAPT** the `TokenUsage` shape and per-response record.

## 7. Continuation extras and hosted services

**F10 — Remote compaction V2 is provider-encrypted and in-band. [OBSERVED]**
Problem solved: shrink history when the context window fills, using the provider's own summariser when available.
With `remote_compaction == V2` (`turn.rs:L1500-L1533`; `core/src/tasks/compact.rs:L48-L70`) Codex appends
`ResponseItem::CompactionTrigger{}` (`core/src/compact_remote_v2_attempt.rs:L78`), streams an ordinary Responses request and
requires exactly one `Compaction{encrypted_content}` output (`compact_remote_v2.rs:L440-L502`); retained messages ≤ 64,000
tokens (`L75`). Otherwise local compaction prompts with `SUMMARIZATION_PROMPT` and stores a `SUMMARY_PREFIX` message
(`core/src/compact.rs:L53-L54`, `L109-L120`, `L356`).
- [TEST] `compact_v2_stream_failure_without_retry_after_exhausts_stream_retries` (`core/tests/suite/retry_after.rs:L676`) and the neighbouring `compact_v2_*` cases.
- General vs local: local summarisation is general; the encrypted item works only against the issuing provider.
- Audit harness: an opaque summary cannot be inspected as evidence. **DO NOT ADOPT** remote compaction; adopt local summarisation with the full transcript retained.

**F11 — Hosted dependencies met in this area. [OBSERVED]**
Problem solved (for OpenAI): first-party features ride on the same client; for others they are capability-gated off.

| Capability | Why hosted | Reference |
|---|---|---|
| ChatGPT login/refresh, workspace routing, sticky `x-codex-turn-state` | `auth.openai.com`, Codex backend | `login/src/auth/manager.rs:L212`; `client.rs:L277-L305` |
| Default base URL for ChatGPT auth | `chatgpt.com/backend-api/codex` | `model-provider-info/src/lib.rs:L77`, `L420-L435` |
| WebSocket v2, Responses Lite, remote compaction | OpenAI servers (WebSocket also any provider declaring it; compaction also Azure/Bedrock) | F3, F4, F10 |
| Model catalogue, rate-limit headers, safety buffering, server-model routing | Codex backend | F8, F9; `sse/responses.rs:L37-L104` |
| Realtime voice | `/v1/realtime/calls`, API key required | `client.rs:L178`; `core/src/realtime_conversation.rs:L1882-L1896` |
| Memories summarise, standalone search, OpenAI Files | `/memories/trace_summarize`, `alpha/search`, `/files` | `client.rs:L179`; `codex-api/src/endpoint/search.rs:L15`; `codex-api/src/files.rs:L19`, `L149` |
| Usage/analytics/tasks | `/wham/*` | `codex-rs/backend-client/src/client.rs:L385-L583` |

`otel-trace-websocket` is an OTLP trace forwarder, not a model transport (`codex-rs/otel-trace-websocket/src/lib.rs:L1-L5`).
`ollama`/`lmstudio` only probe/pull/load models; Ollama must be ≥ 0.13.4 for Responses (`codex-rs/ollama/src/lib.rs:L46-L57`).
- Audit harness: every row is an external dependency to exclude or replace. **DO NOT ADOPT** these hosted paths; keep them behind explicit, default-off capabilities.

## 8. Credentials

**F12 — Header auth vs request signing; single-flight refresh; bounded 401 recovery. [OBSERVED]**
Problem solved: attach the right credential per request, refresh it once under concurrency, and recover from 401 without loops.
`AuthProvider` (`codex-api/src/auth.rs:L30-L71`) offers cheap `add_auth_headers` and async `apply_auth` that may sign the
final URL, headers and body (Bedrock SigV4: `model-provider/src/amazon_bedrock/auth.rs:L307-L350`). Resolution order
(`model-provider/src/auth.rs:L197-L222`, `L292-L325`): `env_key` → `experimental_bearer_token` → unauthenticated when
`!requires_openai_auth` → `CodexAuth` (API key, ChatGPT, external tokens, headers, agent identity, PAT; Bedrock variants
refused here). `BearerAuthProvider` adds `Authorization`, `ChatGPT-Account-ID`, `X-OpenAI-Fedramp`
(`bearer_auth_provider.rs:L31-L47`). `AuthManager` holds `RwLock<CachedAuth>`, two `watch` channels and a
`Semaphore(1)` refresh lock (`login/src/auth/manager.rs:L2042-L2056`); `auth()` refreshes proactively 5 min before JWT
expiry, or after 8 days when no expiry is readable (`L203-L204`, `L2393-L2408`, `L3004-L3027`); `refresh_token` reloads first and refuses account
switches (`L2848-L2882`). On 401 the client loop tries provider-owned recovery once, then `UnauthorizedRecovery`
(reload → refresh → done) (`L1855-L2010`; `client.rs:L2621-L2785`); `current_client_setup` rejects an account change
during setup (`client.rs:L1038-L1099`). Command-backed tokens: 5 s timeout, 300 s refresh
(`protocol/src/config_types.rs:L564-L591`). Storage modes file (`auth.json`, `0o600`)/keyring/auto/ephemeral
(`codex-rs/config/src/types.rs:L116-L126`; `login/src/auth/storage.rs:L39-L66`, `L217`, `L235`); `codex-secrets` stores
age/scrypt-encrypted files keyed by a passphrase kept in the OS keyring (`secrets/src/local.rs:L41-L44`, `L259-L280`) and
offers best-effort regex redaction (`secrets/src/sanitizer.rs:L4-L22`). `responses-api-proxy` isolates the key: it reads
it from stdin, `mlock`s and zeroizes buffers, marks the process non-dumpable (`codex-rs/process-hardening/src/lib.rs:L45-L46`), and forwards only `POST /v1/responses`
(`codex-rs/responses-api-proxy/src/lib.rs:L52-L53`, `L163-L178`, `L215-L219`; `src/read_api_key.rs:L16-L200`; `src/main.rs:L4-L7`).
- [TEST] `unauthorized_recovery_reloads_then_refreshes_tokens` (`login/tests/suite/auth_refresh.rs:L1291`), `auth_refreshes_when_access_token_is_near_expiry` (`L330`), `refresh_token_does_not_retry_after_permanent_failure` (`L869`), `provider_owned_auth_recovery_is_bounded_and_preserves_unauthorized_failures` (`core/src/client_tests.rs:L1695`), `client_setup_rebuilds_chatgpt_refresh_but_rejects_account_switches` (`L363`), `streaming_client_does_not_retry_auth_build_error` (`codex-api/tests/clients.rs:L511`).
- General vs local: `auth.json`/keyring storage and browser OAuth are single-user; the `AuthProvider` seam and the privileged proxy are general.
- Audit harness: per-tenant credentials in a vault, short-lived scoped tokens, and revocation checks per request instead of `auth.json`. **ADOPT PATTERN** — the `AuthProvider` sign-the-final-request seam and the privileged key-holding proxy fit a server; the ChatGPT refresh logic does not.

## 9. Minimal provider-neutral interface (conclusion) [INFERENCE]

An independent multi-provider adapter should abstract:
1. **Request**: ordered neutral items (system/developer/user/assistant text; image by reference + detail; tool call {call_id, name, raw-args string}; tool result {call_id, content parts}; opaque provider blobs such as reasoning), tool specs (name, description, JSON Schema, strict), reasoning effort, output schema, and a capability-gated extras bag.
2. **Stream**: normalised events — created, item-added, text delta, tool-input delta (display only), item-done (full item), usage, completed{end_turn}, typed error — with committed-item semantics as in F5/F6.
3. **Usage**: input, cached-input, cache-write, output, reasoning, total, attributable to request and attempt ids.
4. **Errors/retries**: provider maps its responses to a closed class set (retryable+delay, terminal-user, terminal-quota, context-overflow, auth-recoverable) plus a `RetryAfter` deadline; the harness owns budgets.
5. **Continuation**: default stateless full resend; server-side state (`previous_response_id`, connections) as optional acceleration.
6. **Capabilities** record per provider×model: context window, usable %, modalities, tool-type support, parallel calls, efforts.
7. **Auth**: `apply_auth(request)` so signing providers fit.

Cannot be made generic without loss: encrypted reasoning round-trip (`reasoning.encrypted_content`, `include`), `store`
and `previous_response_id` semantics, `prompt_cache_key`/`session-id` cache affinity, `custom` Lark-grammar tools
(apply_patch, code mode), hosted `web_search`/`image_generation`/`tool_search`/namespaces, legacy `local_shell` items,
remote compaction's encrypted item, Responses Lite's in-input tools, `ConfigurationUpdate` items, reasoning-summary
delivery modes, service tiers, safety buffering/model re-routing, and the Codex rate-limit header family.

## Hard numbers

| Value | Reference |
|---|---|
| stream idle timeout 300,000 ms; stream retries 5; request retries 4; caps 100/100 | `model-provider-info/src/lib.rs:L63-L72` |
| WebSocket connect timeout 15,000 ms; connection life 60 min (server) | `lib.rs:L68`; `responses_websocket.rs:L164` |
| HTTP backoff base 200 ms ×2 ±10 %; connection retry 5 s→60 s, unbounded | `lib.rs:L450`; `responses_retry.rs:L22-L23` |
| channel capacity 1,600 events (parser and mapper) | `sse/responses.rs:L73`; `client.rs:L2346` |
| soft outgoing message cap 15 MiB | `client_tool_metadata.rs:L10` |
| models cache TTL 300 s; refresh timeout 5 s; catalogue cap 1 MiB | `manager.rs:L35`; `models_endpoint.rs:L44-L47` |
| effective window 95 %; auto-compact ≤ 90 %; UI baseline 12,000 tokens | `openai_models.rs:L389-L391`, `L525-L536`; `protocol.rs:L2419` |
| remote compaction: 2 stream retries, 64,000 retained tokens | `compact_remote_v2.rs:L75-L79` |
| token refresh: 5 min before expiry / 8 days; command token 5 s timeout, 300 s refresh | `manager.rs:L203-L204`; `config_types.rs:L564-L565` |
| image max dimension 2,048 px; OpenAI file upload cap 512 MiB | `utils/image/src/lib.rs:L26`; `codex-api/src/files.rs:L19` |

Feature flags met: `unbounded_connection_retries` (Stable, on), `enable_request_compression` (Stable, on),
`concurrent_reasoning_summaries` (Under development, off, `features/src/lib.rs:L1589-L1594`); `responses_websockets`
and `responses_websockets_v2` are `Removed` (WebSocket is now provider-capability-driven, `L1841-L1851`).

## Coverage and limits

Read: every `core` file named in the task, the request/stream/auth paths of the listed crates, and the cited tests. Not
read in depth: `codex-api/src/endpoint/realtime_*` and `realtime-webrtc` internals, `http-client` proxy/TLS/route-aware pool,
`websocket-client` dialer, `aws-auth` signing internals, `gateway_oauth` flows, agent-identity/workload-identity auth,
`backend-client` beyond endpoint names, `safety_buffering.rs`, `turn_timing`, and the guardian/attestation paths. No code
was executed; every [TEST] names a test that exists, not one observed passing.

## Reuse candidates

| Candidate | Deps (Cargo.toml) | Coherence / changes needed |
|---|---|---|
| `codex-rs/codex-client` (retry policy, `backoff`, `run_with_retry`, `sse_stream`, `Provider` URL builder; ~300 lines) | `codex-http-client`, `eventsource-stream`, `futures`, `http`, `rand`, `tokio`, `tracing`, `url` | Small and coherent; swap `codex-http-client` for plain `reqwest`/`http` types; add attempt journaling hooks. |
| `codex-rs/http-client/src/retry_after.rs` (`RetryAfter` deadline) | `http`, `httpdate`, `tokio` | Liftable as-is (≈50 lines). |
| `codex-rs/codex-api/src/sse/responses.rs` + `responses_error.rs` (Responses SSE parser and failure classifier) | file-level subset of `codex-api/Cargo.toml`: `codex-protocol`, `codex-client`, `serde_json`, `eventsource-stream`, `regex-lite`, `tokio` | Useful as the OpenAI adapter only; decouple from `codex_protocol::ResponseItem`, fail closed on unparseable items. |
| `codex-rs/codex-api/src/api_bridge.rs` (HTTP error classification) | file-level subset: `codex-protocol`, `base64`, `chrono`, `serde_json` | Tables adaptable; strip ChatGPT-plan specifics. |
| `codex-rs/responses-api-proxy` (credential-isolating proxy) | `reqwest` (blocking), `tiny_http`, `zeroize`, `libc`, `codex-process-hardening`, `clap` | Coherent binary; for a server it becomes a per-tenant egress/signing gateway with audit logging. |
| `codex-rs/model-provider/src/provider.rs` trait shape | `codex-api`, `codex-login`, `codex-models-manager`, AWS/auth crates | Too entangled to lift; copy the trait *shape* (capabilities, auth recovery, error mapping, catalogue) — IMPLEMENT INDEPENDENTLY. |

All candidates are Apache-2.0 (workspace licence); attribution and NOTICE retention apply.
