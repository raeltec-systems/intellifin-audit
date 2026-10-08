---
title: '22.1 — Route native models through a current tool catalog'
type: feature
created: '2026-10-03'
status: done
story_key: 22-1-route-native-models-through-a-current-tool-catalog
baseline_commit: 67a290173dea7212b600d00ec5bad3f5bd52a6c0
review_loop_iteration: 0
authorization: 'Owner authorised local implementation/review; live qualification requires separate permissions and spend.'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-22-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/batch-21-6-22-2-build-context.md'
---

<frozen-after-approval reason="owner-authorised canonical Story22.1 with explicit live-qualification boundary">

## Intent

**Problem:** The Rust Task foundation has no native model transport or attributable model/tool invocation boundary.

**Approach:** Add native OpenAI Responses and Anthropic Messages adapters behind portable application ports, durable profile/catalogue/invocation facts and exact current-authority tool admission. Keep the continuing autonomous work loop in22.2.

## Boundaries & Constraints

**Always:** Attribute Task/cycle/attempt and producing intent/execution basis, requested/actual provider/model, effort, capability/profile revision, destination, disclosed input classes/context manifest, tool catalogue and usage/completion certainty. Validate current disclosure before outbound I/O and current audience before publishing late results. Keep immutable history, current restrictions, bounded streams and control cancellation. Preserve schemas1–10 and existing Permissions/Task owners.

**Ask First:** Live provider calls, credentials, processing destinations, spend, hosting and deployment. Prepare a concrete minimal qualification request after local verification; fixtures do not satisfy live qualification.

**Never:** Codex subprocess authority, provider-owned durable conversations, automatic external-effect replay, silent fallback, credential/context leakage, model-controlled destinations/accounts or skills becoming qualified from declarations/fixtures.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Native request | Current approved profile and exact Task/context/catalogue | Native wire request; durable attributable dispatch cutoff before I/O | Unqualified/incompatible profile refuses explicitly |
| Streaming | Text, supported structured output, tool deltas, refusal and usage | Portable ordered events with exact identities; provisional output stays identifiable | Unsupported capability/event or inconsistent identity fails closed |
| Framing | Split UTF-8/CRLF/multiline SSE, oversized/deep JSON | Incremental bounded decoder; complete validated arguments only | Malformed, duplicate keys and caps give safe classified errors |
| Tool admission | Successful terminal response with complete tool proposal | Resolve canonical identity/version/account/effective args; atomically bind invocation/catalogue and existing operation | Unknown tool, substituted account, stale catalogue or invalid schema refuses |
| Current authority | Profile/catalogue disablement, membership/Permissions change, intent/Pause/Stop race | Recheck at disclosure, admission and claim consumption under owner fences | No stale grant or fresh dispatch; historical effects remain facts |
| Partial/failure | EOF, refusal, timeout,429/5xx, redirect, cancellation | Partial/possibly accepted invocation recorded, unknown usage honest; no executable partial calls | No hidden retry/fallback or duplicate dispatch |
| Recovery | Restart or repeated logical invocation/operation key | Recover exact durable facts without resending or changing meaning | Conflict explicit; uncertain effects use existing reconciliation |
| Hostile content | Tool/source text requests authority or includes instructions | Attributed data, no new trusted role or credential exposure | No execution from text; safe logs/public projections |

</frozen-after-approval>

## Code Map

Paths are relative to `zobba/`.

- New `crates/domain/src/model.rs`, `application/src/model.rs`, `infrastructure/src/model/` — portable types/validation, ports/coordinator, separate native wire adapters and SQL persistence; pinned reqwest/Tokio/Serde/futures suffice.
- `application/src/operation.rs:OperationStore`, `infrastructure/src/operation.rs:{admit,consume}` — existing sole Permissions gateway. Persist exact canonical tool/catalogue/argument binding to the operation; recheck it inside both transactions, not only before admission.
- `infrastructure/src/task.rs:lock` — organisation advisory205, engagement and Task fences. Profile/catalogue changes join these fences; no SQL transaction spans provider I/O.
- `infrastructure/src/skills.rs:{new,current_use}` — no production-qualified capability source by default; preserve it. `application/src/knowledge.rs:KnowledgeStore::verify` checks exact references/basis; independent inspections are not an atomic outbound grant.
- `migrations/0011_model.sql`, `infrastructure/src/lib.rs`, new schema11 catalogue and bootstrap tests — additive owned persistence, forced RLS, non-owner runtime and exact validation.
- `api/src` — expose permitted profile/invocation provenance as needed without secrets; no autonomous loop or pretend model progress. Coordinate shared module declarations with21.6.

## Tasks & Acceptance

**Execution:**
- [x] `crates/{domain,application}/src/model.rs` — bounded portable requests/events, profile/catalogue contracts, completion validation and invocation/admission coordinator.
- [x] `crates/infrastructure/src/model/` — both real native HTTP/SSE adapters, cancellation/deadlines and explicit unsupported/error behavior; local wire fixture constructors stay guarded.
- [x] `migrations/0011_model.sql`, schema/bootstrap and operation repository — durable invocation/profile/catalogue facts, exact admission/consumption bindings, current-authority and recovery.
- [x] `crates/*/tests`, relevant API contracts and `README.md` — execute matrix/native fixtures/PG races, record safe evidence and concrete live qualification procedure.
- [x] Qualification record — one provider qualified the provider-neutral adapter contract: OpenAI `gpt-6-luna` run 2 passed text, tool call and continuation ([receipts](zobba-foundation-batch/qualification-receipts/README.md)). Each other provider is qualified separately when the owner activates it (keys plus its own approved run); that is an activation gate, not a Story 22.1 gate.

**Acceptance Criteria:**
- Given a Task selects a qualified provider profile, when its request runs, then model/version, disclosed input classes and tool-catalogue revision are attributable to the invocation.
- Given output requests a tool, when admission runs, then canonical tool/account/arguments are checked against current Permissions before any operation is claimed.
- Given streaming fails or capabilities change, when a call ends or retries, then partial output remains identifiable, external effects are not blindly replayed and unsupported fallback is explicit.

## Spec Change Log

- 2026-10-07 (owner): The adapter is provider-neutral, so one live qualification proves its contract. OpenAI run 2 is that proof. Anthropic qualification was deferred (no budget) and no longer blocks this story. A provider without its own qualification receipt stays unqualified and cannot be selected; activating it later needs its keys and its own approved qualification run.

## Design Notes

Use native Responses (`store:false`) and native Messages envelopes, not one protocol emulated through the other. Initially reconstruct from owned portable history; no implicit continuation IDs. Disable redirects/automatic retries. Successful tool-item JSON alone is not terminal invocation success. Catalogue snapshots reject normalized-name collisions and bind exact schemas/effects/cancellation/reconciliation semantics. Trusted adapter registration supplies capability availability; ordinary Admin configuration cannot fabricate qualification. Keep fixture and live qualification classes distinct. Provider cancellation proves local termination, not provider non-execution or zero charge.

## Verification

Run domain/application tests, actual local HTTP/SSE fixtures for both adapters, PostgreSQL authority/catalogue/Pause/Stop races and exact recovery, populated schema10→11 upgrade/prefix/RLS checks, fmt/strict Clippy/build, relevant API contracts and combined regression checks. Assert native request shapes and actual send counts, fragmented streams, no calls from partials, no secret/public-error leakage and responsive cancellation. Every matrix row needs executed evidence. Root schedules shared builds/services; independent review precedes a coherent checkpoint. Live qualification remains separately blocked until approved and executed.

Executed local verification is recorded in the [checkpoint and evidence](zobba-foundation-batch/story-21.6-22.1/README.md): 371 Rust passes, 183 web passes, 159 browser passes with zero retries, and the supplemental guards/process smoke. Independent source review and targeted repair rechecks are recorded separately from root's suite executions.

Local implementation is verified. Live qualification closed with OpenAI `gpt-6-luna` run 2 (2026-10-07). Anthropic remains unqualified until the owner activates and qualifies it; that does not block this story. Story 22.2 remains queued.

The owner's subsequent final-dispatch expiry repair is recorded separately in
the [repair specification](spec-22-1-final-dispatch-expiry-repair.md) and
[repair evidence](zobba-foundation-batch/story-22.1-expiry-repair/README.md).
Model/history validation precedes the final authority fence; later policy reads
cannot leave recorded source access, the lease or permission time stale.
The repair did not itself close live qualification or advance Story 22.2.

## Suggested Review Order

**Invocation ownership**

- Prepare attributable native calls through existing Task and Permissions owners.
  [model.rs:344](../../zobba/crates/application/src/model.rs#L344)

- Persist additive model facts without rewriting accepted schemas.
  [0011_model.sql:1](../../zobba/migrations/0011_model.sql#L1)

- Verify cumulative history and current dependencies without multiplying shared ancestry.
  [mod.rs:198](../../zobba/crates/infrastructure/src/model/mod.rs#L198)

- Admit recovered proposals under current ownership while retaining their producing basis.
  [mod.rs:623](../../zobba/crates/infrastructure/src/model/mod.rs#L623)

**Native transport**

- Bound native I/O, retain usage and prevent incomplete output from authorising tools.
  [native.rs:337](../../zobba/crates/infrastructure/src/model/native.rs#L337)

**Qualification boundary**

- Consume a specific approval before credentials or network access.
  [model_qualification.rs:203](../../zobba/crates/infrastructure/examples/model_qualification.rs#L203)

**Verification**

- Exercise repeated real SQL history, exact lease renewal and conflicting duplicates.
  [model_execution.rs:1042](../../zobba/crates/infrastructure/tests/operations/model_execution.rs#L1042)

- Inspect local results and the live-qualification record.
  [README.md:1](zobba-foundation-batch/story-21.6-22.1/README.md#L1)
