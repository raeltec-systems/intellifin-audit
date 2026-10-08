---
title: '22.1 follow-up — Accept and replay Claude thinking blocks in the native Anthropic adapter'
type: 'feature'
created: '2026-10-08'
status: 'draft'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-22-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-22-1-route-native-models-through-a-current-tool-catalog.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Current Claude models (`claude-sonnet-5-5`, `claude-opus-5-5`, `claude-haiku-5-5`) always think, so their streamed answers carry `thinking` (and sometimes `redacted_thinking`) blocks. Our native Anthropic adapter rejects any block other than text or tool_use, and it cannot send those blocks back. Claude requires the blocks to be sent back unchanged before the tool_use in the next request. So no current Claude model can qualify or run.

**Approach:** Parse thinking blocks as opaque reasoning, held separately from answer text and evidence. Keep them with the tool exchange they came from, and replay them byte for byte in that assistant turn. The existing disclosure binding covers them because it hashes the whole stored request. Then the qualification runner can dry-run and execute on `claude-sonnet-5-5`.

## Boundaries & Constraints

**Always:**
- **Accepted stream content:** `thinking` (with `thinking_delta` and `signature_delta`) and `redacted_thinking` (with `data`) blocks are accepted. Any other unknown block or delta type still fails closed.
- **Answer text, evidence and receipts:**
  - Thinking text is never answer text, never evidence and never knowledge, and it never feeds the work-loop answer text or the 22.3 context.
  - It is kept only for replay.
  - Receipts and logs record only byte counts, block counts and hashes, never thinking text or signatures.
- **Replay order:**
  - Replay keeps the model's original order of non-tool content blocks (thinking, redacted_thinking and text) that precede the tool_use blocks of that response.
  - It sends them unchanged, then the tool_use blocks.
  - Blocks belong to one invocation and are rendered once per invocation group.
- **Bounds:** signature, redacted data and thinking text are each bounded and validated, with a printable-ASCII rule for signature and data. They count toward the existing output, history and request byte caps. Over a cap → fail closed.
- **Old records:** stored requests and outcomes without the new field keep their exact bytes (the field is omitted when empty), so old disclosure bindings still verify.
- **Request body:** the adapter still sends no `thinking`, `temperature`, `budget_tokens` or forced `tool_choice`. The `Effort::None` guard stays.
- **Work loop:** the work loop carries an invocation's blocks into the tool exchange it records, so a production tool continuation replays them too.

**Ask First:**
- Any live provider call (the paid run is a separate, already-approved step after this story).
- Sending a `thinking` or `effort` request parameter.
- Any migration or catalogue change.

**Never:**
- Show thinking text in the UI or API.
- Summarize or modify a block.
- Replay blocks to a different model or provider.
- Accept OpenAI reasoning items (still out of scope).
- Weaken the disclosure binding.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Thinking then tool call | thinking(empty text, signature) → tool_use | One reasoning item and one tool proposal; the continuation's assistant turn is `[thinking{thinking,signature}, tool_use]`, with the bytes identical | — |
| Text-only answer with thinking | thinking → text | Text delivered; reasoning kept in the outcome, not in the text | — |
| Redacted block | redacted_thinking{data} → tool_use | Replayed as `{type:"redacted_thinking",data}` | — |
| Interleaved text | thinking, text, tool_use | Replay keeps all three, in order | — |
| Missing or oversized signature, bad charset, delta for the wrong block type | — | Stream rejected | Existing fail-closed `WireError` |
| Old stored request with no field | — | Binding verifies; bytes unchanged | — |
| Continuation on a different model | Exchange with blocks, request model ≠ origin | Blocks not sent | Conflict, if the exchange's origin model is known to differ |

</frozen-after-approval>

## Code Map

All paths are under `zobba/`.

**Parser and request body: `crates/infrastructure/src/model/native.rs`**
- Limits at :13-17: `MAX_FRAME_BYTES` 256 KiB, `MAX_ARGUMENT_BYTES` 32 KiB. `identity()` at :987 allows only 256 bytes, so do not use it for signatures.
- `ParsedEvent` :931, `OutputItem` :964, `Part` :974.
- `anthropic()` :1447: `content_block_start` :1466 (unsupported arm :1519), deltas :1537 (unsupported :1567), stop :1570, `message_stop` :1597 → `release_tools` :1425.
- `ParsedStream::outcome()` :655-745 maps to `EventKind`. The structured path sets `valid=false` on non-text events (:687-698); keep that.
- Request body: `request_body()` :161-247; Effort guard :176; Anthropic body :214-229.
- `native_history()` :439-492; the Anthropic grouping by `invocation_id` is at :475-486, and this is where the replay goes.

**Domain types: `crates/domain/src/model.rs`**
- `HistoryItem` :450, `ToolExchange` :455 with `is_valid` :475.
- `EventKind` :506, `TransportOutcome` :540 with `validate` around :607.
- Add the reasoning variant and type here.

**Application: `crates/application/src/model.rs` and `crates/application/src/model/wire.rs`**
- `model.rs`:
  - `ModelRequest::validate` history byte accounting :213-250.
  - `retain_failed_evidence` :396-455 must never keep reasoning.
  - `validate_completion` :457.
- `wire.rs` (all types use `deny_unknown_fields`):
  - `EventKindWire` :243, `TransportOutcomeWire` :286, `ToolExchangeWire` :639.
  - Precedent for keeping old bytes: `ContextEntryWire.depends_on` :326 uses `serde(default, skip_serializing_if)`.

**Work loop: `crates/application/src/work.rs`**
- `ToolExchange` is built at :904. Attach the invocation's reasoning blocks there, on the first exchange of the invocation group.

**Disclosure: `crates/infrastructure/src/model/mod.rs`**
- `payload_attachments` :106 hashes the whole `StoredRequest`, so replayed blocks are bound automatically. No binding code change is expected.
- The outcome document is capped at 2 MiB. No migration is needed: these are jsonb columns (`migrations/0011_model.sql`).

**Qualification runner: `crates/infrastructure/examples/model_qualification.rs`**
- Caps: `OUTPUT_TOKENS` :17 and `MAX_BODY_BYTES` :18.
- `continuation()` :135-153.
- Dry-run preview :278 uses `"provider-call-placeholder"`.
- `execute_reserved` :331-391 passes only call_id/args at :380.
- Manifest text is at :295. Its `approved_substitution` must name the reasoning-block substitution.
- Tests: `retained_synthetic_output_reconstructs_both_native_continuations` :677.

**Existing tests: `crates/infrastructure/src/model/native_tests.rs`**
- Fixtures: `anthropic_tool` :485, `sse` :206, `history_request` :249.
- Tests to extend:
  - `owned_tool_history_uses_exact_native_call_result_linkage_without_new_authority` :274
  - `multiple_owned_calls_from_one_invocation_keep_correlated_native_groups` :364
  - `inconsistent_event_identities_and_unsupported_events_fail_closed` :1018
  - `strict_decoding_bounds_frames_stream_events_depth_and_duplicate_keys` :1660
  - The assertion at :773 that no `thinking` param is sent must still hold.

## Tasks & Acceptance

**Execution:**
- [ ] `crates/domain/src/model.rs` -- Add a reasoning block type (`kind: thinking|redacted`, plus `thinking`/`signature` or `data`) with bounded validation. Add `EventKind::Reasoning{item_id, block}`. Add an ordered `ToolExchange.preceding: Vec<ReplayBlock>` (reasoning or text), which only the first exchange of an invocation group may carry. Extend `validate` and the byte accounting. -- Domain is the single source of truth.
- [ ] `crates/application/src/model/wire.rs` and `crates/application/src/model.rs` -- Add the wire mirrors, with the new field skipped when empty. Make sure reasoning is never retained as evidence and is counted in the history and output caps. -- Portable and byte-stable.
- [ ] `crates/infrastructure/src/model/native.rs` -- Parse the thinking and redacted blocks and their deltas into the outcome, preserving content order relative to text and tool_use. Replay the preceding blocks in the Anthropic assistant turn in `native_history`. -- This is the core fix.
- [ ] `crates/application/src/work.rs` -- Copy the outcome's ordered pre-tool blocks into the recorded first `ToolExchange`. -- Production continuations work too.
- [ ] `crates/infrastructure/examples/model_qualification.rs` -- `continuation()` takes the preceding blocks. The dry run uses a synthetic placeholder thinking block (empty text, placeholder signature). Execute substitutes the real blocks. Raise `OUTPUT_TOKENS` to 4096 and `MAX_BODY_BYTES` to 65536, and update the manifest wording. -- Lets the runner qualify thinking models.
- [ ] Tests (`native_tests.rs`, `crates/application/src/model/tests.rs`, `work_cycle.rs` where a fixture already exists) -- Cover every matrix row, an old-bytes golden test, and an assertion that the body has no thinking param.

**Acceptance Criteria:**
- Given a recorded Sonnet-5.5-shaped SSE stream with thinking then tool_use, when parsed and continued, then the continuation body's assistant content is the original blocks in order, byte-identical, followed by tool_use.
- Given `--dry-run --providers anthropic --anthropic-model claude-sonnet-5-5`, then the manifest prints, and the continuation payload contains the placeholder thinking block before tool_use and fits `MAX_BODY_BYTES`.
- Given any receipt, log or API response, then no thinking text or signature appears.

## Verification

Run first: `. /tmp/zobba-env.sh` (PostgreSQL at :55434; use `?sslmode=disable` for bootstrap and smoke). No live provider calls, no commits.

**Commands (from `zobba/`):**
- `cargo fmt --check && cargo clippy --locked --workspace --all-targets -- -D warnings` -- expected: clean.
- `cargo test --locked --workspace -- --test-threads=1` -- expected: all pass.
- `cargo run -q --locked -p zobba-infrastructure --example model_qualification -- --dry-run --providers anthropic --max-usd 1 --anthropic-account zobba-test --anthropic-model claude-sonnet-5-5 --spend-evidence owner-approved-2026-10-08-usd1-anthropic-credit --receipt-dir ../_bmad-output/implementation-artifacts/zobba-foundation-batch/qualification-receipts` -- expected: exit 0 and a manifest hash. Record the hash in the spec.
- `cargo run -p zobba-cli --locked -- openapi`, then `pnpm check` -- expected: unchanged or regenerated cleanly. The only allowed failures are the two known IPv6 tests.
