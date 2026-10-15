# 03 — Tool registry and dispatch (native tools, MCP, hooks, approvals)

Pinned: Codex `8ffd91e42aa001b7e897bea812b02f89264f9fa0` (2026-09-29). Paths are relative to the Codex repo root. Licence: Apache-2.0 (root `LICENSE`; `NOTICE` names OpenAI and a Ratatui MIT derivation). Every crate cited uses `license.workspace = true` (`codex-rs/Cargo.toml` L167).

## Summary (10 lines)

1. `ToolExecutor<Invocation>` binds each tool's model-visible `ToolSpec` to its runtime. Core layers `CoreToolRuntime` on top for hooks, telemetry and argument rewrites.
2. A new `ToolRegistry` and `ToolRouter` are built for every sampling step and kept in `StepContext`. The advertised list and the dispatch table therefore come from one snapshot.
3. A model call is matched by exact `ToolName` (namespace plus name). The only aliases are for the default namespace. MCP names are sanitised, prefixed, hashed and capped at 128 bytes.
4. No JSON-Schema validation of arguments exists. Handlers deserialise with serde, and specs set `strict:false`. A parse error returns `FunctionCallOutput{success:false}` to the model and the turn continues.
5. Exposure (`Direct`/`Deferred`/`CodeModeOnly`/`Hidden`) is presentation only. Authorisation comes from the `ToolPolicy` allowlist at registration, `PreToolUse` hooks, the approval pipeline and MCP revalidation at call time.
6. Approval precedence is hooks, then the Guardian auto-reviewer, then the user. The decision is one of Approved, ApprovedForSession, ApprovedExecpolicyAmendment, ApprovedMcpPolicyAmendment, NetworkPolicyAmendment, Denied, TimedOut or Abort.
7. The session cache is an in-memory map from a JSON key to a decision. Approved command prefixes are appended as `prefix_rule(allow)` to `CODEX_HOME/rules/default.rules`. Neither record identifies the approver.
8. MCP uses stdio (environment cleared, then an allowlist) or streamable HTTP with OAuth (rmcp 3.2.0). The defaults are a 30 s startup timeout and a 300 s tool timeout. Each call uses its own catalog snapshot and revalidates the tool.
9. Hooks are compatible with Claude Code (12 events) and run as commands or MCP tools with a 600 s default timeout. Trust is hash-pinned, but a hook that times out, crashes or returns bad JSON **fails open**.
10. The Apps, plugin-install and hosted `web_search` paths need OpenAI/ChatGPT services. Core dispatch, MCP, hooks and approvals do not.

---

## F1. Tool abstraction and registry [ADOPT PATTERN]

- **Problem.** What the model is told about a tool must stay consistent with what actually executes.
- **Code.**
  - [OBSERVED] `ToolExecutor` has `tool_name()`, `spec()`, `exposure()`, `search_info()`, `supports_parallel_tool_calls()` and `handle() -> Result<Box<dyn ToolOutput>, FunctionCallError>` (`codex-rs/tools/src/tool_executor.rs:L101-L130`).
  - [OBSERVED] `ToolPayload` is one of `Function{arguments:String}`, `ToolSearch` or `Custom{input}` (`codex-rs/tools/src/tool_payload.rs:L5-L11`).
  - [OBSERVED] `FunctionCallError` is `RespondToModel(String)` or `Fatal(String)` (`codex-rs/tools/src/function_call_error.rs:L4-L10`).
  - [OBSERVED] `ToolOutput::to_response_item(call_id, payload)` builds the model item (`codex-rs/tools/src/tool_output.rs:L11-L68`).
  - [OBSERVED] `CoreToolRuntime` adds `pre_tool_use_payload`, `with_updated_hook_input`, `post_tool_use_payload`, `wait_until_ready`, `mcp_server_name`, `matches_kind` and `create_diff_consumer` (streamed argument diffs) (`codex-rs/core/src/tools/registry.rs:L57-L189`).
- **State ownership.**
  - [OBSERVED] The registry is `ToolRegistry{tools: IndexMap<ToolName, RegisteredTool{runtime: Arc<dyn CoreToolRuntime>, exposure}>, first_collision, tool_policy: Arc<ToolPolicy>}` (`registry.rs:L288-L299`).
  - [OBSERVED] `ToolRouter` owns the registry and `model_visible_specs: Arc<[ToolSpec]>` (`codex-rs/core/src/tools/router.rs:L73-L81`), and `StepContext.tool_router: Arc<ToolRouter>` (`codex-rs/core/src/session/step_context.rs:L21-L41`).
  - [INFERENCE] The structure is immutable after construction, so no lock is needed.
- **Registration.**
  - [OBSERVED] `register_trusted*` drops tools that the policy disallows. A duplicate calls `error_or_panic`, which panics in debug builds and logs in release builds (`registry.rs:L339-L357`; `codex-rs/core/src/util.rs:L81-L87`).
  - [OBSERVED] `register_external*` (MCP, dynamic and extension tools) refuses the reserved plain names `exec_command` and `shell_command`. It records the first collision instead of panicking (`registry.rs:L379-L413`).
- **Tests.**
  - [TEST] `registry_rejects_default_namespace_alias_collisions` (`codex-rs/core/src/tools/registry_tests.rs:L244-L281`) would detect `lookup` and `functions.lookup` becoming two separate tools.
  - [TEST] `reserved_command_tools_reject_external_runtimes_without_a_builtin` (`registry_tests.rs:L311-L342`) would detect an external tool taking over `exec_command`.
  - [TEST] `strict_tool_collisions_reject_external_and_synthetic_duplicates` (`codex-rs/core/src/tools/spec_plan_tests.rs:L1863-L2033`) asserts `ToolCollision` and the message `duplicate tool: …`.
- **Defaults.** [OBSERVED] `error_on_tool_collisions` defaults to false (`codex-rs/core/src/config/mod.rs:L3779-L3785`), so a colliding external tool is dropped with only a warning.
- **Scope.** The spec/runtime binding, the typed payload union and the two-level error type are generally useful. The list of reserved names is specific to Codex.
- **Audit harness difference.** A collision should be a hard configuration error. The tool's identity should carry a version or digest so that records show which definition ran.

## F2. Per-step tool plan, depending on model and config [ADOPT PATTERN]

- **Problem.** Models, providers, features and environments need different tool sets. The set must not drift between the moment it is advertised and the moment a call executes.
- **Code.**
  - [OBSERVED] `built_tools` → `build_tool_router` runs inside step capture (`codex-rs/core/src/session/mod.rs:L3842-L3851`). The turn loop captures a new step before each sampling request, "so context, advertised tools, and tool calls share one request view" (`codex-rs/core/src/session/turn.rs:L461-L498`).
  - [OBSERVED] `ToolCallRuntime` keeps that `step_context` for any call that executes later (`codex-rs/core/src/tools/parallel.rs:L44-L51`).
  - [OBSERVED] Build order in `build_tool_router` (`codex-rs/core/src/tools/spec_plan.rs:L123-L188`):
    1. Core sources: shell, MCP resources, utility tools and collaboration tools. All are skipped when `ToolPolicy.require_managed_sandbox` is set and the permission profile is not managed (`L1016-L1036`).
    2. MCP tools (`codex-rs/core/src/mcp_tool_exposure.rs:L64-L161`), with the per-server `omit_tools_from` policy (`spec_plan.rs:L190-L270`).
    3. Extension tools, then dynamic client tools (`L1426-L1456`).
    4. Hosted specs (`L622-L651`).
    5. Finalise: Code Mode `exec`/`wait`, the `tool_search` executor and collision checks (`L349-L518`).
- **Model and provider inputs.** [OBSERVED]
  - `shell_type` (the value `Disabled` removes the shell tools, `L1083-L1088`)
  - `apply_patch_tool_type` (`L1269-L1272`)
  - `experimental_supported_tools` (`L1178-L1233`)
  - `supports_search_tool` together with the provider capability `namespace_tools` (`L653-L666`)
  - `use_responses_lite`, which removes hosted tools (`L628-L630`)
  - `tool_mode` / CodeMode (`codex-rs/core/src/tools/mod.rs:L75-L97`)
  - `multi_agent_version` (`spec_plan.rs:L672-L684`)
- [OBSERVED] `build_prompt` always sends `parallel_tool_calls: true` (`turn.rs:L1589-L1604`). The specs are serialised as Responses `tools` (`codex-rs/core/src/client.rs:L902-L913`).
- **Tests.** [TEST] `allowed_tools_filter_sources_before_code_mode_and_discovery` (`spec_plan_tests.rs:L517-L600`) asserts that an empty allowlist leaves no registered or visible tools, and that a partial allowlist keeps only the listed tools. It would detect the policy being applied after discovery.
- **Defaults.** [OBSERVED]
  - Stable and on: `ShellTool`, `UnifiedExec`, `ViewImage` and `SleepTool` (`codex-rs/features/src/lib.rs:L968-L996`); `Apps` (`L1368-L1372`); `ToolSuggest` (`L1446-L1449`); `Plugins` (`L1458-L1461`).
  - UnderDevelopment and off: `CodeMode` (`L1064-L1067`), `ExecPermissionApprovals` (`L1214-L1217`), `RequestPermissionsTool` (`L1232-L1235`), `ExecutedToolCallMetadata` (`L1058-L1061`) and `TokenBudget` (`L1710-L1713`).
- **Audit harness difference.** Persist the plan snapshot (names and spec digests) with each step. A reviewer can then prove what the agent was offered.

## F3. Matching a call to a handler [ADOPT PATTERN]

- [OBSERVED] `ToolRouter::build_tool_call` maps these items (`router.rs:L247-L300`):
  - `FunctionCall{name, namespace, arguments, call_id}` → `ToolName::new(ns,name).with_default_namespace()` with a `Function` payload
  - a client `ToolSearchCall` → `tool_search`
  - `CustomToolCall` → a `Custom` payload
  - Everything else, including the legacy `LocalShellCall`, is not dispatched.
- [OBSERVED] `with_default_namespace` maps `None` and `""` to `"functions"` (`codex-rs/protocol/src/tool_name.rs:L39-L51`). The lookup is an `IndexMap::get` on that key (`registry.rs:L491-L495`).
- [OBSERVED] Dispatch does **not** check `exposure`: `dispatch_any_with_state` runs any registered runtime (`registry.rs:L552-L573`). `Hidden` is documented as "registered for dispatch without exposing it to the model" (`codex-rs/tools/src/tool_executor.rs:L78-L79`).
- [INFERENCE] A deferred or hidden tool therefore runs if the model emits its exact name. Exposure is not an authorisation boundary.
- [OBSERVED] MCP names are made as follows: the name is sanitised to `[A-Za-z0-9_]` and gets the `mcp__` prefix; on collision it gets a 12-hex SHA-1 suffix; the result is capped at 128 bytes. The raw `tool.name` is kept for the protocol call (`codex-rs/codex-mcp/src/tools.rs:L1-L61`, `L105-L110`, `L225-L234`; `codex-rs/codex-mcp/src/mcp/mod.rs:L576-L591`).
- [TEST] `build_tool_call_normalizes_default_function_and_custom_namespaces` (`codex-rs/core/src/tools/router_tests.rs:L272-L306`) would detect `None`, `""` and `"functions"` producing different keys.
- **Audit harness difference.** At dispatch, check that the called name was advertised in the plan or discovered by search in this turn.

## F4. Argument validation and malformed arguments [IMPLEMENT INDEPENDENTLY]

- [OBSERVED] Arguments are validated only by serde. `parse_arguments` returns `RespondToModel("failed to parse function arguments: {err}")` (`codex-rs/core/src/tools/handlers/mod.rs:L86-L93`); it has 54 call sites.
- [OBSERVED] Unknown fields are handled differently per handler. `ExecCommandArgs` accepts them silently (`codex-rs/core/src/tools/handlers/unified_exec.rs:L27-L50`). The multi-agent v2, sleep and async-message structs use `deny_unknown_fields` (for example `codex-rs/core/src/tools/handlers/sleep.rs:L33`).
- [OBSERVED] Specs set `strict: false` (for example `plan_spec.rs:L49`); the field carries "TODO: Validation" (`codex-rs/tools/src/responses_api.rs:L32-L45`).
- Not found: a JSON-Schema validator. I grepped `Cargo.toml` files for `jsonschema|boon|valico` and `.rs` files for `jsonschema::|JSONSchema::compile`, with no hits.
- **Error path.** [OBSERVED] A registry `Err(RespondToModel)` is turned by `failure_response` into a `FunctionCallOutput` (or a custom or empty tool-search output). It has `success: Some(false)` and the same `call_id` (`parallel.rs:L99-L111`, `L303-L328`). It is recorded to history (`turn.rs:L2472-L2500`), and a follow-up model request follows.
- [OBSERVED] An unknown tool gives `RespondToModel("unsupported call: …")` (`registry.rs:L552-L573`, `L853-L858`). A payload of the wrong kind gives `Fatal(... incompatible payload)` (`registry.rs:L585-L601`). MCP arguments are parsed only as JSON; invalid JSON gives a `CallToolResult` error, and the arguments are never checked against `inputSchema` (`codex-rs/core/src/mcp_tool_call.rs:L145-L160`).
- [INFERENCE] `Fatal` does not stop the turn in release builds. `handle_tool_call` returns `Err(CodexErr::Fatal)` (`parallel.rs:L108`), but `drain_in_flight` only calls `error_or_panic` and continues (`turn.rs:L2494-L2496`). The missing output later becomes a synthetic `"aborted"` (F6).
- [INFERENCE] A client `tool_search` call whose arguments do not parse is answered with an empty `call_id` (`codex-rs/core/src/stream_events_utils.rs:L399-L425`), which normalisation treats as an orphan. I grepped the error string and found no test.
- **Tests.**
  - [TEST] `update_plan_tool_rejects_malformed_payload` (`codex-rs/core/tests/suite/tool_harness.rs:L231-L320`) asserts that the next request carries the parse error with `success` false and no `PlanUpdate`. It would detect a turn failure, or the plan being applied, on bad arguments.
  - [TEST] `custom_tool_unknown_returns_custom_output_error` (`codex-rs/core/tests/suite/tools.rs:L328-L375`) asserts the exact output `unsupported custom tool call: unsupported_tool`.
  - [TEST] `fatal_tool_error_stops_turn_and_reports_error` (`codex-rs/core/src/session/tests.rs:L12950-L12997`) asserts only that dispatch returns `Fatal`. Despite its name, it does not check that the turn stops.
- **Audit harness difference.** Validate against the declared schema, reject unknown fields and fail closed before hooks or approvals run. Record each rejection as evidence.

## F5. What binds identity, arguments, permissions and result [ADAPT IDENTIFIED CODE]

- [OBSERVED] `ToolInvocation{session, turn, step_context, cancellation_token, tracker, call_id, tool_name, source, payload}`. The `source` is `Direct`, `DirectPlaintextMessage` or `CodeMode{cell_id, runtime_tool_call_id}` (`codex-rs/core/src/tools/context.rs:L55-L81`).
- [OBSERVED] The runtime side uses `ToolCtx{session, step_context, cancellation_token, call_id, tool_name}` (`codex-rs/core/src/tools/sandboxing.rs:L350-L356`).
- [OBSERVED] The model's `call_id` is the only join key between call, approval (`codex-rs/core/src/tools/approvals.rs:L53-L63`), hook `tool_use_id` and output.
- [OBSERVED] `ToolCallState{terminal_outcome_reached: AtomicBool, …}` lives outside the abortable task. `notify_tool_finish_if_unclaimed` guarantees exactly one outcome: completed, blocked, failed or aborted (`context.rs:L47-L53`; `registry.rs:L791-L802`). On cancellation, a synthetic "aborted by user after Ns" output keeps the `call_id` (`parallel.rs:L247-L283`, `L330-L347`).
- [OBSERVED] Three trace layers exist:
  - `call_trace` records received and ready events with IDs only (`codex-rs/core/src/tools/call_trace.rs:L1-L88`).
  - `ToolDispatchTrace` writes the payload and response to the rollout trace (`codex-rs/core/src/tools/tool_dispatch_trace.rs:L19-L124`).
  - `ExecutedToolCalls` is an optional, bounded recorder that is off by default (`codex-rs/core/src/tools/executed_tool_calls.rs:L1-L2`, `L48-L67`, `L341-L343`).
- [INFERENCE] The dispatch trace starts (`registry.rs:L551`) before `PreToolUse` hooks can rewrite the input (`registry.rs:L628-L633`). The trace start therefore records the arguments before the rewrite, while the OTel log uses the rewritten payload (`registry.rs:L680`). History keeps the model's original `FunctionCall`.
- **Audit harness difference.** Bind the executed arguments, the approval, the approver and the result into one content-addressed durable record. A hook rewrite must create a new, attributable argument version.

## F6. Call/output pairing before the next request [ADAPT]

- [OBSERVED] `for_prompt` → `normalize_history`. `ensure_call_outputs_present` inserts `FunctionCallOutput("aborted")` after any unanswered call; `remove_orphan_outputs` drops outputs without a call; both use `error_or_panic` for some cases (`codex-rs/core/src/context_manager/history.rs:L578-L595`, `L929-L947`; `codex-rs/core/src/context_manager/normalize.rs:L21-L138`, `L155-L225`).
- [TEST] `normalize_adds_missing_output_for_function_call_inserts_output` (`codex-rs/core/src/context_manager/history_tests.rs:L2435-L2470`) asserts that the synthetic `"aborted"` output immediately follows the call.
- **Audit harness difference.** A synthetic "aborted" hides a lost result. Record an explicit durable "lost/unknown" state and require reconciliation.

## F7. MCP path [ADOPT PATTERN; use the official MCP SDK in TypeScript]

- **Transport.**
  - [OBSERVED] `make_rmcp_client` chooses `Stdio{command,args,env,env_vars,cwd}` or `StreamableHttp{url, headers, bearer_token_env_var}` with OAuth (`codex-rs/codex-mcp/src/rmcp_client.rs:L1167-L1333`).
  - [OBSERVED] Stdio children start from `env_clear()` with `kill_on_drop(true)` (`codex-rs/utils/pty/src/child_command.rs:L94-L103`). They receive `DEFAULT_ENV_VARS` plus the configured names (`codex-rs/rmcp-client/src/utils.rs:L16-L59`, `L163-L175`), in a new process group with explicit file descriptors on Unix (`codex-rs/rmcp-client/src/stdio_server_launcher.rs:L263-L292`).
- **Timeouts and limits.** [OBSERVED]
  - Startup 30 s and tool 300 s (`rmcp_client.rs:L105-L106`). The per-call timeout is the smaller of the server and requested values (`codex-rs/codex-mcp/src/binding.rs:L304-L345`).
  - Listing: at most 100 pages, 2,048 items (8,192 for Apps), 64 KiB cursors and 30 s (`codex-rs/codex-mcp/src/pagination.rs:L9-L13`).
- **Filtering and exposure.** [OBSERVED]
  - `enabled_tools`/`disabled_tools` (`codex-mcp/src/tools.rs:L63-L103`).
  - Tools are `Deferred` when tool search is available and `Direct` otherwise. Agent-plugin tools above 8,000 B each or 64,000 B in total become `Hidden` (`mcp_tool_exposure.rs:L18-L19`, `L85-L158`).
  - Input schemas are sanitised and compacted to 5,000 B, for advertisement only (`codex-rs/tools/src/json_schema.rs:L26-L63`; `codex-rs/tools/src/json_schema/compaction.rs:L15`).
- **Call-time revalidation.** [OBSERVED] `prepare_call_for_tool` checks that the server still exists, that the filter allows the tool, that the tool is in the *current* catalog with the same connector, and that it is model-visible. The call then runs inside `run_with_snapshot`, so a catalog refresh cannot change eligibility mid-call (`codex-rs/codex-mcp/src/connection_manager/tool_catalog.rs:L46-L60`, `L459-L502`; `binding.rs:L320-L323`).
- **Result conversion.** [OBSERVED]
  - A non-null `structuredContent` becomes serialised text. Otherwise text becomes `InputText`, an image a data-URL `InputImage`, audio an `InputAudio`, and resources or unknown blocks become JSON text (`codex-rs/protocol/src/models.rs:L2302-L2337`, `L2344-L2444`).
  - Media the model cannot take is replaced by placeholder text (`mcp_tool_call.rs:L936-L973`).
  - A "Wall time" header is added and the result is truncated to the token budget (`context.rs:L184-L215`).
- **Auth.** [OBSERVED]
  - Credential storage: keyring, with a fallback to `CODEX_HOME/.credentials.json` (`codex-rs/config/src/types.rs:L128-L143`).
  - OAuth login: a loopback callback on 127.0.0.1, a browser, and a 300 s wait (`codex-rs/rmcp-client/src/perform_oauth_login.rs:L109-L124`, `L559`, `L733-L734`, `L789-L799`).
  - `ChatGpt` auth is only for hosted servers; `EmaAuth` is disabled (`rmcp_client.rs:L1196-L1208`).
- **Elicitation.** [OBSERVED]
  - A server request becomes an `ElicitationRequest` event with a generated id. The answer returns through a `oneshot` keyed by `(server, id)` (`codex-rs/codex-mcp/src/elicitation.rs:L101-L220`).
  - It auto-declines under `auto_deny` or when there is no event channel (`L166-L172`, `L321-L327`). The policy `Never` rejects it (`L552-L559`).
  - Core `ElicitationService` counts outstanding elicitations and pauses tool-result delivery (`codex-rs/core/src/elicitation.rs:L11-L96`).
  - Not found: a timeout on the answer (`rx.await`, `codex-mcp/src/elicitation.rs:L218`).
- **Helper modules.** [OBSERVED]
  - `mcp_tool_approval_templates.rs` renders approval text for Apps tools from an embedded JSON file (`codex-rs/core/src/mcp_tool_approval_templates.rs:L10-L15`, `L71-L73`).
  - `mcp_skill_dependencies.rs` offers to install MCP servers that a skill needs (`codex-rs/core/src/mcp_skill_dependencies.rs:L36-L40`).
  - `hook_mcp_executor.rs` lets hooks call connected MCP tools (`codex-rs/core/src/hook_mcp_executor.rs:L12-L57`).
- **Audit harness difference.** Pin each server's identity and version, validate against `inputSchema`, bound every human wait and keep tokens in a tenant-scoped secret store.

## F8. MCP approvals [DO NOT ADOPT as is; ADOPT the key shape]

- [OBSERVED] `AppToolApproval` defaults to `Auto`; the other values are Prompt, Writes and Approve (`codex-rs/config/src/mcp_types.rs:L26-L34`).
  - In Auto, approval is needed unless `readOnlyHint` is true and `destructiveHint` is not true. Missing annotations mean approval is needed.
  - Writes trusts `readOnlyHint` alone (`mcp_tool_call.rs:L2466-L2497`).
  - The prompt is auto-approved under `AskForApproval::Never` with a Disabled, External or full-write profile (`codex-rs/codex-mcp/src/mcp/mod.rs:L89-L110`).
- [OBSERVED] Answers:
  - "Allow" → `Approved`.
  - "Allow for this session" → `ApprovedForSession`, cached in memory under `{server, plugin_id, connector_id, link_id, tool_name}`.
  - "Allow and don't ask me again" → `ApprovedMcpPolicyAmendment`, persisted to config.
  - Anything else, including no answer → `Abort` (`mcp_tool_call.rs:L1453-L1466`, `L2197-L2285`).
  - Session keys exist only in Auto mode; Prompt and Writes downgrade "remember" to `Approved` (`L1735-L1764`, `L2231-L2246`).
- [TEST] `approval_required_when_annotations_are_absent`, `approval_required_when_destructive_even_if_read_only_true`, `writes_mode_does_not_require_approval_for_read_only_tools` and `prompting_modes_do_not_allow_persistent_remember` (`mcp_tool_call_tests.rs:L379-L440`) would detect an inverted rule. The Writes test passes `destructive=true` and still expects no approval, which pins the trust in `readOnlyHint`.
- **Audit harness difference.** Server annotations are untrusted. An operator-owned policy should set the approval scope. "Remember" must be a durable, attributable, revocable grant.

## F9. Hooks [DO NOT ADOPT fail-open; ADOPT event model and hash-pinned trust]

- **Events.** [OBSERVED] PreToolUse, PermissionRequest, PostToolUse, PreCompact, PostCompact, SessionStart, SessionEnd, UserPromptSubmit, SubagentStart, SubagentStop, Stop and Interrupt (`codex-rs/hooks/src/lib.rs:L23-L36`). Handler types are `command` and `mcp_tool`; `prompt` and `agent` are skipped as unsupported (`codex-rs/config/src/hook_config.rs:L161-L201`; `codex-rs/hooks/src/engine/discovery.rs:L635-L654`).
- **Trust.** [OBSERVED] Hooks come from config layers, `hooks.json` and plugins. A hook that is not managed runs only when its normalised-config hash equals the stored `trusted_hash` (`discovery.rs:L664-L734`, `L775-L821`). `allow_managed_hooks_only` restricts hooks to managed sources (`L83-L116`).
- **Capabilities.** [OBSERVED]
  - PreToolUse can block (exit code 2 with stderr, or `permissionDecision:"deny"`), rewrite the input (`"allow"` with `updatedInput`) and inject `additionalContext` as developer messages (`codex-rs/hooks/src/events/pre_tool_use.rs:L193-L310`; `codex-rs/hooks/src/engine/output_parser.rs:L121-L182`; `codex-rs/core/src/hook_runtime.rs:L849-L873`).
  - PermissionRequest returns Allow or Deny, and any Deny wins (`codex-rs/hooks/src/events/permission_request.rs:L130-L160`).
  - PostToolUse can block the *result* after the tool has run, or replace the output with feedback (`registry.rs:L743-L773`).
- **Execution.** [OBSERVED]
  - Matched handlers run concurrently. When several rewrite, the last to finish wins. At most 8 async hooks run at once (`codex-rs/hooks/src/engine/dispatcher.rs:L115-L188`; `pre_tool_use.rs:L149-L167`; `codex-rs/hooks/src/engine/command_runner.rs:L54`).
  - Each hook runs by default through a login shell (`-lc`), in a new session, with JSON on stdin and under `timeout()`. Its environment starts empty; then the session's environment snapshot and the hook's own variables are added, with restricted names filtered out. The process tree is killed on drop (`command_runner.rs:L214-L322`, `L325-L357`, `L384-L437`).
  - Timeout: 600 s by default; SessionEnd and Interrupt default to 1 s with a 3 s maximum (`discovery.rs:L740-L763`; `codex-rs/hooks/src/events/session_end.rs:L20-L23`).
- **Fail-open.** [OBSERVED] A spawn error, timeout, non-zero exit other than 2, invalid JSON or a serialisation failure sets `should_block=false`, so the tool proceeds (`pre_tool_use.rs:L205-L212`, `L253-L291`, `L312-L320`).
- **Tests.**
  - [TEST] `pre_tool_use_json_deny_blocks_exec_command_before_execution` (`codex-rs/core/tests/suite/hooks.rs:L3522-L3610`) asserts the "Command blocked by PreToolUse hook" output, that the marker repository was *not* created, and the hook's `tool_name`/`tool_use_id`.
  - [TEST] `hook_drains_output_and_times_out_while_stdin_is_blocked` (`codex-rs/hooks/src/engine/command_runner_tests.rs:L294-L340`) asserts the error "hook timed out after 2s".
  - [TEST] `unsupported_permission_decision_fails_open` (`pre_tool_use.rs:L556-L584`) pins the fail-open behaviour.
- **Local specificity.** [OBSERVED] `exec_command` hooks see only `{"command": cmd}`. They do not see `sandbox_permissions`, `workdir` or `justification` (`codex-rs/core/src/tools/handlers/unified_exec/exec_command.rs:L520-L531`).
- **Audit harness difference.** Policy hooks must fail closed, see the full arguments, and have their decision recorded with the hook's identity and hash.

## F10. The approval decision point in dispatch [ADAPT]

- **Where.**
  - [OBSERVED] `PreToolUse` hooks run first (`registry.rs:L603-L655`), then the handler.
  - [OBSERVED] For exec and patch, `ToolOrchestrator::run` does approval (Skip, NeedsApproval or Forbidden), then a sandboxed attempt. If the sandbox denies it, a second approval with `retry_reason` precedes an escalated attempt (`codex-rs/core/src/tools/orchestrator.rs:L122-L221`, `L372-L448`).
  - [OBSERVED] MCP tools call `maybe_request_mcp_tool_approval` (`mcp_tool_call.rs:L273-L370`).
  - [OBSERVED] The default requirement is: `Never` → Skip; `OnRequest`/`Granular` → NeedsApproval only when the file system is `Restricted`; `UnlessTrusted` → NeedsApproval (`sandboxing.rs:L195-L231`).
- **Routing.** [OBSERVED] `request_approval` asks `PermissionRequest` hooks, then Guardian, then the user (`approvals.rs:L478-L570`). The source (Config, AutomatedReviewer or User) goes to telemetry only (`L873-L885`).
- **Decision shape.**
  - [OBSERVED] `ReviewDecision` (`codex-rs/protocol/src/protocol.rs:L4156-L4194`). `Denied` lets the turn continue; `Abort` interrupts it.
  - [OBSERVED] Denied and TimedOut map to `ToolError::Rejected`, Abort maps to `TurnAborted`, and a stray MCP amendment is rejected (`approvals.rs:L430-L476`).
  - [OBSERVED] The user wait (`request_command_approval`) sends an event and `rx.await`s with **no timeout**. A dropped sender means `Abort` (`codex-rs/core/src/session/mod.rs:L2704-L2808`).
  - [OBSERVED] `notify_approval(approval_id, decision)` carries no approver identity (`session/mod.rs:L3301-L3320`).
  - Not found: a check that the decision is among the offered `available_decisions`. I grepped `app-server/src` and `core/src/session`.
- **Caching.**
  - [OBSERVED] `ApprovalStore{map: HashMap<String, ReviewDecision>}` is keyed by serialised JSON and lives in memory only, behind a tokio `Mutex` in `SessionServices` (`sandboxing.rs:L40-L63`).
  - [OBSERVED] The prompt is skipped only when *all* keys are `ApprovedForSession`. Exec keys contain {environment, argv[0], canonical command, cwd, tty, sandbox_permissions, additional_permissions, policy fingerprint}; patch keys are one per file (`sandboxing.rs:L65-L117`; `approvals.rs:L239-L279`, `L700-L731`).
  - [OBSERVED] `ApprovedExecpolicyAmendment{command}` appends `prefix_rule(..., decision="allow")` to `CODEX_HOME/rules/default.rules` and hot-reloads the policy (`codex-rs/core/src/session/handlers.rs:L172-L203`; `codex-rs/core/src/exec_policy.rs:L464-L509`; `codex-rs/protocol/src/approvals.rs:L36-L44`).
  - [OBSERVED] Network approvals cache approved and denied `{environment, host, protocol, port}` sets for the session (`codex-rs/core/src/tools/network_approval.rs:L131-L159`, `L267-L276`, `L893-L1019`).
- [OBSERVED] `ToolError::Rejected` carries both user denials and operational failures. The code has a TODO for a separate variant (`codex-rs/core/src/tools/events.rs:L449-L474`).
- **Tests.**
  - [TEST] `approval_resolution_aborts_turn_when_approval_is_aborted` and `approval_resolution_rejects_mcp_policy_amendment` (`codex-rs/core/src/tools/approvals_tests.rs:L25-L53`).
  - [TEST] `approving_apply_patch_for_session_skips_future_prompts_for_same_file` (`codex-rs/core/tests/suite/approvals.rs:L2147`) panics on a second prompt after `ApprovedForSession`.
- **Audit harness difference.** Decisions must be durable across restarts. Each must record the approver, the time, the argument digest and the scope, and must be revocable. Waits need deadlines. Denial and operational failure must be distinct outcomes.

## F11. Plugins, Apps and Code Mode

- [OBSERVED] **Apps**: the hosted MCP server `codex_apps` at `{chatgpt_base}/backend-api/ps/mcp` with ChatGPT auth (`codex-rs/codex-mcp/src/mcp/mod.rs:L64`, `L602-L634`). It is enabled only for Codex-backend auth (`codex-rs/core/src/session/turn_context.rs:L619-L627`; `codex-rs/features/src/lib.rs:L528-L530`). **Requires hosted service.** Recommendation: DO NOT ADOPT.
- [OBSERVED] **Plugin install suggestions** load through `plugins_manager` with auth, when Apps, Plugins and ToolSuggest are on (`turn.rs:L1812-L1868`; `spec_plan.rs:L657-L662`, `L1253-L1267`). **Requires hosted service.** Recommendation: DO NOT ADOPT.
- [OBSERVED] **Code Mode**: the `exec` and `wait` tools. Nested calls from a V8 script (`v8_enable_sandbox`, run in process or in the `code-mode-host` gRPC process) re-enter `handle_tool_call_with_source` with the `CodeMode` source, so hooks and approvals still apply (`codex-rs/core/src/tools/code_mode/mod.rs:L368-L412`; `codex-rs/code-mode-protocol/src/lib.rs:L52-L53`). [INFERENCE] No hosted service is needed. Recommendation: DO NOT ADOPT for audit, because scripts hide the per-call trail.
- [OBSERVED] **Extensions** (`ext/*`) contribute tools per step, wrapped as external tools (`spec_plan.rs:L330-L346`, `L1477-L1505`).

## Native tool inventory

Handlers are under `codex-rs/core/src/tools/handlers/` unless another path is given.

| Tool | Purpose | File |
|---|---|---|
| exec_command / write_stdin | Run a shell command; write to or poll the session | unified_exec/{exec_command,write_stdin}.rs |
| apply_patch | Apply a file patch | apply_patch.rs |
| update_plan | Plan checklist | plan.rs |
| view_image | Attach a local image | view_image.rs |
| request_user_input | Ask the user (model-only) | request_user_input.rs |
| request_user_input_async / send_message_to_user_async | Asynchronous user messaging (root agent) | request_user_input_async.rs, send_message_to_user_async.rs |
| request_permissions | Request extra sandbox permissions | request_permissions.rs |
| list_mcp_resources / list_mcp_resource_templates / read_mcp_resource | MCP resources | mcp_resource/*.rs |
| tool_search | BM25 over deferred tools (limit 8) | tool_search.rs; `codex-rs/tools/src/tool_discovery.rs:L7` |
| list_available_plugins_to_install / request_plugin_install | Plugin suggestions (hosted) | list_available_plugins_to_install.rs, request_plugin_install.rs |
| clock.curr_time / clock.sleep | Time and sleep | current_time.rs, sleep.rs |
| new_context / get_context_remaining | Token budget | new_context_window.rs, get_context_remaining.rs |
| wait_for_environment | Deferred executor | wait_for_environment.rs |
| test_sync_tool | Test synchronisation | test_sync.rs |
| multi_agent_v1.{spawn_agent, send_input, resume_agent, wait_agent, close_agent} | Multi-agent v1 | multi_agents/*.rs |
| collaboration.{spawn_agent, send_message, followup_task, wait_agent, interrupt_agent, list_agents} | Multi-agent v2 (namespace from `codex-rs/core/src/config/mod.rs:L261`) | multi_agents_v2/*.rs |
| exec / wait | Code Mode | `codex-rs/core/src/tools/code_mode/{execute_handler,wait_handler}.rs` |
| mcp__<server>__.<tool> | Any MCP tool | mcp.rs |
| client dynamic tools | Run by the client; no timeout (`dynamic.rs:L174-L251`) | dynamic.rs |
| web_search (hosted spec) | Run by the OpenAI server (**hosted**) | `codex-rs/core/src/tools/hosted_spec.rs:L14-L46` |

Extension tools. I did not read these handlers; the names come from their constants:

- web.run and image_gen.imagegen: `ext/web-search/src/tool.rs:L41-L42`, `ext/image-generation/src/lib.rs:L8-L9`
- get_goal, create_goal and update_goal: `ext/goal/src/spec.rs:L9-L11`
- memories.{read, search, list, add_ad_hoc_note} and skills.*
- history.* and notes.*: `ext/history-notes/src/tools.rs:L57-L81`
- message-board tools: `ext/agent-message-board/src/tools.rs:L104`

## Hard numbers

| Item | Value | Reference |
|---|---|---|
| MCP startup / tool timeout | 30 s / 300 s | codex-mcp/src/rmcp_client.rs:L105-L106 |
| MCP catalog | 100 pages, 2,048 items (8,192 for Apps), 64 KiB cursor, 30 s | codex-mcp/src/pagination.rs:L9-L13 |
| MCP name | ≤128 B, 12-hex SHA-1 suffix | codex-mcp/src/tools.rs:L225-L227 |
| Schema compaction / MCP description | 5,000 B / 1,000 B | tools/src/json_schema/compaction.rs:L15; tools/src/mcp_tool.rs:L9 |
| Agent-plugin MCP spec budget | 8,000 B each, 64,000 B total | core/src/mcp_tool_exposure.rs:L18-L19 |
| Hook timeout | 600 s (SessionEnd/Interrupt 1 s, maximum 3 s) | hooks/src/engine/discovery.rs:L740-L763 |
| Async hook concurrency | 8 | hooks/src/engine/command_runner.rs:L54 |
| MCP OAuth callback wait | 300 s | rmcp-client/src/perform_oauth_login.rs:L559 |
| Executed-call recorder | 8 KiB / 32 KiB / 256 / 1 MiB | core/src/tools/executed_tool_calls.rs:L48-L54 |
| User approval, elicitation, dynamic-tool wait | no timeout found | session/mod.rs:L2807; codex-mcp/src/elicitation.rs:L218; handlers/dynamic.rs:L216 |

## Reuse candidates

- **`codex-tools`** (`codex-rs/tools`, Apache-2.0).
  - Contents: `ToolExecutor`, `ToolSpec`, `ToolPayload`, `ToolOutput`, `ToolExposure`, and the JSON-Schema subset with sanitisation and compaction.
  - Dependencies: bitflags, codex-code-mode, codex-connectors, codex-features, codex-file-system, codex-extension-items, codex-protocol, codex-utils-*, jsonptr, rmcp, serde, serde_json, thiserror, tracing, urlencoding (`codex-rs/tools/Cargo.toml`).
  - Assessment: coupled to OpenAI Responses item types, code-mode and connectors. Take the pattern; Zobba is TypeScript. Schema compaction (`json_schema.rs`) is the most self-contained part.
- **`codex-hooks`** (`codex-rs/hooks`).
  - Dependencies: codex-config, codex-plugin, codex-protocol, codex-utils-{process, pty, …}, regex, tokio, chrono, uuid, schemars.
  - Assessment: discovery is coupled to Codex config layers and the semantics are fail-open. Reuse the event and JSON contract as a specification only.
- **`codex-rmcp-client` + `rmcp` 3.2.0.**
  - Assessment: in TypeScript, use the official MCP SDK and copy these practices: clear the environment and allowlist variables, kill the process group, prepare a per-call catalog snapshot, revalidate at call time and cap pagination.
- **`context_manager/normalize.rs`** (about 200 lines). Implement independently, failing closed instead of synthesising "aborted".

## Coverage and limits

Read, main paths:

- core `tools/{mod, registry, router, context, approvals, call_trace, tool_dispatch_trace, lifecycle, hosted_spec, catalog_parameters, hook_names}.rs`
- the dispatch parts of `parallel.rs`, the approval parts of `orchestrator.rs` and `sandboxing.rs`, the key parts of `spec_plan.rs`, the recorder API of `executed_tool_calls.rs`
- `handlers/{mod, mcp, dynamic}.rs`, `mcp_tool_call.rs`, `mcp_tool_exposure.rs`, the tool parts of `hook_runtime.rs`, `elicitation.rs`, `normalize.rs`
- in `codex-mcp`: transport, timeouts, naming, pagination, prepare_call and elicitation
- in `rmcp-client`: environment, launcher and OAuth entry points
- in `hooks`: events, parsers, dispatcher, runner and discovery

Not read:

- Guardian internals (`core/src/guardian/*`: timeouts, possible hosted-model use)
- the rest of `network_approval.rs`
- the `unified_exec` and `apply_patch` runtimes
- Code Mode internals and `tool_search` ranking
- the `ext/*` handlers
- MCP OAuth refresh and storage
- the `app-server` approval transport
- test files beyond the named tests

Concurrency belongs to another reviewer. No build or test was run.
