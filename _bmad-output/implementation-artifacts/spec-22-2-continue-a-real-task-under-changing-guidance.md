---
title: '22.2 — Continue a real Task under changing guidance (work loop, AC1–3)'
type: 'feature'
created: '2026-10-07'
status: 'in-review'
baseline_commit: 'ed0d95bdaa70da22b547189fda88c54ca678df64'
story_key: 22-2-continue-a-real-task-under-changing-guidance
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-22-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-22-1-route-native-models-through-a-current-tool-catalog.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A Task cannot do real work. The worker runs only an inert sleeping child. Guidance overwrites the brief and cancels in-flight work. A message cannot be sent without an exact target. The Task card does not show current work or a next action.

**Approach:** Add a durable model work-cycle loop to the worker. It uses the 22.1 coordinator, admitted tools and the owned gateway, and records each step as a fact. Guidance is received at once and applied at the next step boundary, with that boundary recorded. An untargeted direction is routed deterministically, or Zobba asks one targeting question. Pause/Stop cancel a stalled call through the existing independent lane. AC4 (conversational engagement setup) is deferred to its own spec.

## Boundaries & Constraints

**Always:**
- Every invocation is bound to its Task, cycle, step, intent revision and execution epoch.
- Tool proposals pass the existing `admit_tool` and current-Permissions consumption.
- Model text, retrieved text and skill text are never authority.
- Restart rebuilds history from durable invocation, result and receipt facts, never from conversation text.
- Guidance never cancels work. Only Pause/Stop (execution epoch) or ownership loss cancel it.
- A turn whose producing intent is stale may finish and is recorded, but its proposals are not admitted. The next turn reconsiders them against the applied brief.
- Routing never calls a model.
- Preserve migrations and catalogues 1–11 byte for byte. Schema 12 is additive.

**Ask First:**
- Any live provider call, credential, or composition that enables a non-fixture qualification source.
- Changing the reserved control-lane capacities.

**Never:**
- AC4 engagement creation.
- Interrupt-now.
- Context compaction (22.3).
- Budget settlement (22.7).
- Variable-argument tools.
- A global chat that controls every Task.
- Model-owned durable state.
- Inferring a target from model output.
- Treating a waiting Task as a completed objective.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| First cycle | Create on an engagement with a bound method and a fixture-qualified profile | Card shows the objective, the method binding, a current-work step, and the next action attributed to an invocation | No qualified profile: the Task stays inert and the card says the model is unavailable |
| Tool step | The turn proposes a catalogue tool | Admit, consume, dispatch, receipt, then a ToolExchange in history and the next turn | Refused admission is a step fact; no dispatch |
| Guide mid-call | Guide arrives during a running turn | Received names the target Task now. The turn finishes, and its proposals are recorded as superseded and not admitted. Applied names the boundary step. The next turn uses the new brief | Duplicate retry returns the original receipt |
| Superseded guidance | Two Guides | Brief revisions are listed in order, each with applied boundary and `superseded_by` | — |
| Untargeted, one Task | Direction with no target, exactly one non-stopped Task | Guide is admitted to that Task; the receipt names it | — |
| Untargeted, ≥2 Tasks | Same input with two Tasks | Durable targeting question listing the candidates; nothing is applied | Answer with a stale or foreign Task id is refused |
| Answer, multi-target | Select both Tasks | One Guide per target with a derived idempotency key; separate Received/Applied for each | Retry creates no duplicates |
| Stalled provider | Provider stalls; Pause/Stop sent | Control 202 within reserved capacity; call cancelled; Pausing becomes Paused after observed quiescence | A consumed tool with unknown effect remains `reconciliation_required` |
| Restart | Worker killed mid-turn or mid-tool | Same invocation key recovers; consumed attempts reconcile; no replay | — |

</frozen-after-approval>

## Code Map

All paths are under `zobba/`.

**Task command model**
- `crates/domain/src/task.rs` -- defines `CommandKind`/`is_control` :10/44, `TaskSnapshot` :199 and `ClaimBasis` :240.
- `crates/application/src/task.rs` -- defines the ports `TaskCommands` :41, `TaskExecution::current` :111 and `TaskError::Fenced`.
- `crates/infrastructure/src/task.rs`:
  - `admit` :174 makes Guide bump `intent_revision` and makes every command abandon admitted claims :294.
  - `coordinate` :431-457 applies commands in batches and overwrites `working_brief` :437.
  - `valid_basis` :848 requires `applied_intent==intent_revision`, which is why Guide currently cancels work.
  - `current` :751/771 renews ownership.
- `migrations/0003_tasks.sql` -- holds `tasks`, `task_commands` (immutable, idempotency unique), and `task_events`, which allow one received and one applied event per command.
- `crates/infrastructure/src/knowledge.rs:775` -- `project_guide`.

**Worker**
- `crates/worker/src/lib.rs` -- `coordinate_with` :41 runs one future per Task and at most 4 children. `advance` :111 runs coordinate, consume, execute, observe, reconcile.
- `crates/worker/src/executor.rs:72` -- polls `current()` every 200 ms with a 2 s timeout and kills and joins the inert child. Model cancellation must reuse this poll.
- `crates/worker/src/gateway.rs` -- the owned operation dispatch, exercised by `worker/tests/gateway_process.rs`.

**Model layer (Story 22.1)**
- `crates/application/src/model.rs`:
  - `ModelRequest` :34 and `validate` :61.
  - `ModelCancellation` :258.
  - `ModelCoordinator::invoke` :348, which makes no retries.
  - `validated_tool` :472.
- `crates/infrastructure/src/model/mod.rs`:
  - `bind_disclosure` :102 must be called again after any change to history or messages.
  - `current_configuration` :145.
  - `ModelRepository::new` :359 starts unqualified; the qualification source is injected through `with_qualification_source` :366.
  - `prepare` :495 recovers a call with the same key.
  - `admit_tool` :623.
- `crates/infrastructure/src/model/native.rs` -- `invoke` :346 polls cancellation every 10 ms. `loopback()` :122 is available only under `cfg(test)`; expose a constructor gated by a test feature for the worker process fixtures.
- `crates/infrastructure/tests/operations/model_execution.rs` -- the loop pattern to reuse: `cumulative_history` :1042 (key → bind → prepare → complete → admit → consume → observe → ToolExchange). The fixtures `FixtureQualification`/`profile`/`catalogue` are at :22-53, and the stalling `Fixture` is in `src/model/native_tests.rs:34`.

**Methodology and knowledge**
- `crates/application/src/methodology.rs:395` -- `task_basis` (`current.id`).
- `crates/application/src/knowledge.rs:408-433` -- `verify`/`exact` for `ContextManifest`.

**API and web**
- `crates/api/src/tasks.rs`:
  - The control pool (2 connections) is at :39-51 and limits are at :72.
  - The `/task-controls` route accepts `is_control` kinds :435.
  - `TaskResponse` :244.
- `web/src/ConversationWorkspace.tsx` -- the composer target is chosen at :318, the card is at :296, inspection is at :350-378, and the receipt line is at :287.
- OpenAPI: regenerate with `cargo run -p zobba-cli --locked -- openapi` and `pnpm api:generate`.

**Schema**
- `crates/domain/src/lib.rs:16` `SCHEMA_VERSION`.
- `crates/infrastructure/src/lib.rs` -- the ledger read uses `LIMIT 12` at :843 (raise it to 13), and the per-version catalogue chain starts at :795.

## Tasks & Acceptance

**Execution:**
- [x] `migrations/0012_work_cycle.sql`, `schema-v12.catalog`, `domain/src/lib.rs`, `infrastructure/src/lib.rs`
  - Action: add `task_steps` (Task, cycle, ordinal, kind model_turn/tool_step, intent_revision, invocation_id/operation_id, status, superseded, next_action descriptor, current-work label). Add `task_routing_questions` (message, candidates, answer). Add a boundary column on the applied event or on a step link. Add RLS and grants.
  - Rationale: durable facts so restart resumes without chat.
- [x] `domain/src/task.rs`, `domain/src/work.rs` (new) -- add step, brief-revision and routing types, the deterministic routing rule and the invocation key derivation (task, cycle, intent, ordinal).
- [x] `infrastructure/src/task.rs`
  - Action:
    - Split basis validity. An in-flight turn stays current while only the intent changed. Admission and consumption still require the applied intent.
    - Apply guidance only at a step boundary and record that boundary.
    - Admit untargeted direction through the routing rule.
    - Add routing questions, answers (multi-target derived keys) and brief-revision reads.
  - Rationale: AC2 and AC3.
- [x] `infrastructure/src/model/mod.rs`
  - Action: read the current profile and catalogue for the engagement. Expose a test-feature loopback adapter.
  - Rationale: the loop needs to select the profile.
- [x] `application/src/work.rs` (new), `worker/src/{lib.rs,executor.rs,work.rs}`
  - Action:
    - The work-cycle executor assembles context: system constraints, method binding, brief, verified knowledge, owned history.
    - It invokes, records the step, and admits, consumes, dispatches and observes tools.
    - It bounds a cycle at 16 turns. A text-only turn makes the Task `waiting`.
    - It cancels through `ModelCancellation` from the existing `current()` poll.
    - With no injected qualification source it keeps the inert executor.
  - Rationale: AC1 and responsive control.
- [x] `api/src/{tasks.rs,conversation.rs}` and OpenAPI
  - Action:
    - Card fields: method binding, current work, next action with invocation id, attention.
    - Untargeted direction admission.
    - Routing-question read and answer on the control lane.
    - Brief revisions.
  - Rationale: AC1–3.
- [x] `web/src/ConversationWorkspace.tsx` (+ api client)
  - Action: render the card fields, an "Any Task / ask me" composer target, the targeting question with multi-select, per-target receipts, and brief revisions with superseded status. Show model text as untrusted.
  - Rationale: UX-DR42.
- [x] Tests:
  - Domain unit tests for routing and keys.
  - Infrastructure PostgreSQL tests for every row of the matrix, including the concurrent Guide-versus-turn completion race.
  - Worker process tests with a stalling loopback provider, restart, and Pause/Stop responsiveness.
  - API HTTP tests.
  - Chromium two-Task routing, reconnect and keyboard tests.
  - Rationale: proves AC1–3.

**Acceptance Criteria:**
- Given a user starts audit work with a fixture-qualified profile, when the first cycle runs, then the Task shows its objective, bound method, current work and a next action attributed to an invocation.
- Given guidance arrives while a provider or tool call runs, when it is accepted, then its receipt names the target Tasks. Application at a step boundary is reported separately, and superseded guidance stays inspectable.
- Given routing is ambiguous or Pause/Stop arrives, when the independent control path handles it, then Zobba asks only the needed targeting question, or applies the named control without waiting for a stalled model.
- Given the worker restarts, when it resumes, then it continues from durable step and invocation facts, with no replayed tool effect.

## Design Notes

**Guidance applied at the boundary.** Today `valid_basis` ties every check to the applied intent, so a Guide kills in-flight work. That contradicts UX-DR42 ("new guidance do[es] not implicitly cancel work"). Keep two checks:
- `continuation_current`: owner and execution epoch only. It is used by the executor poll.
- `admission_current`: the current check plus applied intent. It is used by `admit_tool`/`consume`.

Reconcile any existing inert tests that expect a Guide to cancel; do not delete them.

**Deterministic routing.** Routing stays deterministic so the control path never waits on a model. "Semantic" in this story means that the explicit target, a reply to a question, and the single-candidate rule are resolved by the server.

## Verification

**Environment:** first run `. /tmp/zobba-env.sh`. It sets Node 24.20.0, pnpm 11.25.0 and the three `ZOBBA_TEST_*` URLs for the disposable PostgreSQL 18.6 database `zobba_local_test` on port 55434. Never commit, push or call a live provider.

**Commands** (run from `zobba/`, sequentially, against a guarded `*_test` PostgreSQL 18 database):
- `cargo fmt --check && cargo clippy --locked --all-targets -- -D warnings` -- expected: clean.
- `cargo test --locked --workspace -- --test-threads=1` -- expected: all pass, including the new tasks/worker/model tests.
- `cargo run -p zobba-cli --locked -- openapi` then `pnpm check && pnpm test && pnpm test:browser` -- expected: generated types match; unit and Chromium suites pass with zero retries.

## Implementation Notes (2026-10-07)

Executed locally against the disposable `zobba_local_test` (recreated with UTF-8
encoding; the provided database was SQL_ASCII and could not run migration 0002):

- `cargo fmt --check`, `cargo clippy --locked --all-targets -D warnings`: clean.
- `cargo test --locked --workspace --no-fail-fast -- --test-threads=1`: all pass.
  New: domain `work` (routing, keys, SHA-256 vectors), infrastructure
  `operations/work_cycle.rs` (first cycle, refused admission, Guide mid-call
  superseded, Guide/turn race x4, two Guides `superseded_by`, stalled Pause,
  restart mid-turn and mid-tool, routing single/ask/answer/retry/stale/foreign),
  worker `work_process.rs` (real coordinator + executor poll + loopback native
  transport: stalled Pause, Resume, abort and takeover without resend), API
  `tasks_http.rs` work/direction/question/answer. The bootstrap blackhole case
  needs `sslmode=disable` (server TLS hides the proxied query) and
  `oidc_protocol` needs the running OIDC fixture; both pass under those
  conditions and are unrelated to this story.
- `pnpm check`: OpenAPI/types current, tsc clean, 184 unit tests; 2 IPv6
  (`::1`) endpoint tests fail only because the sandbox has no IPv6.
- `pnpm test:browser`: 161 passed, zero retries (includes new `routing.spec.ts`).

Known limits: model availability on the card is false in production (no
qualification source is installed in the API); the work card is fetched in the
Task inspection panel, not in each conversation task card.

Follow-up (2026-10-07, before review):
- Tool steps are rebuilt from immutable operation history before any consumption.
  A completed attempt is `completed` with its fact and enters history as a
  `ToolExchange`; an attempt with an unknown outcome is `reconciliation_required`;
  a fence after admission is `superseded`. None is recorded as `refused`, and
  none is resent. Historical turns (including earlier-intent turns) are read by
  exact identity in the claim's own Task/cycle; `prepare` still checks disclosure.
- Context includes current authorised knowledge (16 records, 64 KiB) with exact
  references, verified again at disclosure; withdrawn records are omitted.
- OS-level proof: `work_process.rs` re-executes the test binary as a worker
  process and SIGKILLs it mid-turn and mid-tool. The production binary has no
  qualification source or fixture flag, so it cannot run model work itself.
- With `?sslmode=disable` on the three test URLs, `bootstrap.rs` (3/3) and
  `scripts/smoke.py` pass. Full gates: fmt and clippy clean; workspace tests 385
  passed, 0 failed, 4 ignored (45 binaries, single-threaded); `pnpm check` 184/186
  (the same 2 IPv6 sandbox failures); browser 161 passed.
