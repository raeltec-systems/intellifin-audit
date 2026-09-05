---
title: 'Read the re-derived executable plan before submitting'
type: 'feature'
created: '2026-09-04'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
baseline_commit: '38c96ca5882029899c5c5b09c9b2b5a4297ee882'
baseline_revision: '38c96ca5882029899c5c5b09c9b2b5a4297ee882'
deferred: []
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A Draft now carries every authored section, but nothing turns those sections into the executable plan a Run would follow, and an Auditor cannot read what would actually execute before submitting it.

**Approach:** Derive the executable plan from the frozen version data as a queued `procedures` worker job — never inside a web request — record every derivation attempt whether it succeeded or not, and render the result as a read-only plan preview that states "Cannot derive: {reason}" when the plan is underivable.

## Boundaries & Constraints

**Always:** Derive the plan in a queued worker job owned by `procedures`. Record EVERY re-derivation attempt, successful or not, with its outcome and time. Freeze the compiler version on the version, so identical frozen inputs always derive an identical plan (NFR-4). Store the compiled plan as a versioned durable contract — a validated schema plus an explicit `schemaVersion` — so a later executor consumes it byte-for-byte and never re-derives it (AD-14). Queue a re-derivation whenever a saved section changes. Show the preview read-only: Session Steps, ordered Plan Steps per Target System, Observations to capture, compiled and Agent-Judged conditions, credential references, limits, and the model identity when a model was used. When the plan cannot be derived, state "Cannot derive: {reason}" and record the reason. Call the configured model through one owned, PROVIDER-AGNOSTIC `ModelGateway` port and record the provider, the model identity and the prompt version on the version. The provider is an infrastructure detail behind the port; nothing in domain or application names one. VALIDATE every model response against the durable plan contract before storing it, and treat the response as untrusted data — never as instructions, and never stored raw.

**Ask First:** Changes to the durable plan contract's shape or to the compiler-version freezing rule. That a model participates is SETTLED: the deployment will configure one, and the model path must be real enough to demonstrate.

**Never:** Derive a plan inside a web request. Execute the plan, contact a Target System, resolve a credential value, or capture evidence. Implement submission or approval — Story 2.7 owns those; this story only supplies the derivability signal Submit will read. Put a credential VALUE anywhere; the preview shows credential REFERENCES only. Re-derive at execution time.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Queued derivation | A saved section change on a Draft | A job is enqueued; the preview shows re-deriving, then the derived plan and its time | Never runs in the web request |
| Deterministic derivation | The same frozen version data derived twice | Byte-identical plan and the same compiler version | Recorded both times |
| Underivable plan | A version missing what the plan needs | "Cannot derive: {reason}" naming the reason; the derivability signal is false | Attempt still recorded |
| Attempt recording | Derivation fails or throws | The failed attempt is recorded with its reason and time | No partial plan stored |
| Durable contract | A stored plan read back | Validates against the schema and its `schemaVersion` | A plan failing validation reads as absent |
| Preview surface | A derived plan | Read-only: no edit control anywhere in the preview | Editing happens only in the originating section |

</frozen-after-approval>

## Code Map

- `packages/domain/src/procedures/plan-compiler.ts` — NOTE: despite its name this file is Story 2.4's COMPLIANCE compiler (predicates, evaluation, reduction). The executable-plan derivation is NEW; put it in `packages/domain/src/procedures/executable-plan.ts` and do not overload the 2.4 module.
- `packages/domain/src/procedures/{target-draft,compliance-draft,evidence-draft,population-draft}.ts` — the frozen inputs the plan derives from. Read them; never restate their vocabularies.
- `packages/application/src/procedures/ports.ts` — extend `ProcedureVersionRecord`/`View` with the stored plan, its derivation attempts and the derivability signal; add the new fields to `procedureVersionRowVersion`.
- `packages/application/src/procedures/update-compliance-draft.ts` — the audited, whole-row-guarded command template to follow for the derivation-recording command.
- `apps/worker/src/{main,startup}.ts` — today the worker only runs a heartbeat. The queue consumer is added here; the release/CI migrator remains the only migrator.
- `packages/infrastructure/src/telemetry/sentry.ts` — allowlist every new telemetry message and field key, or they will not typecheck and a field would be dropped silently.
- `apps/web/src/procedures/` — the read-only preview component, reused later by Story 2.7's Version review.

## Tasks & Acceptance

**Execution:**
- [x] Add the queue dependency (`pg-boss`, the pinned major) and wire a `procedures` job queue: enqueue from the application layer through an owned port, consume in `apps/worker`. The web app enqueues; it never derives.
- [x] `packages/domain/src/procedures/executable-plan.ts` — the durable plan contract (explicit `schemaVersion`, validated shape) and the DETERMINISTIC derivation from frozen version data: Session Steps, ordered Plan Steps per Target System, Observations to capture, conditions with their compiled/Agent-Judged status, credential references, limits. Same inputs must always give the same bytes.
- [x] Install the stack this story needs and that nothing currently installs: the pinned `pg-boss` for the queue, and the Vercel AI SDK with BOTH the Anthropic and OpenAI providers for the model. Add the model settings (provider, model id, prompt version, and the API key) to `packages/infrastructure/src/config.ts` and `.env.example`, read ONLY in a composition root — never as ambient env inward.
- [x] Add the `ModelGateway` port (application-owned) and TWO real implementations in infrastructure — Anthropic-backed and OpenAI-backed — selected by configuration. Adding a third provider must mean adding one adapter, never touching the command. Derivation CALLS it when a model is configured, validates the response against the durable plan contract before storing anything, and records the model identity and prompt version on the version. A response that fails contract validation is a derivation FAILURE with a stated reason, never a stored plan. With no model configured, derivation still succeeds deterministically and records that no model was used, so CI — which holds no credential — stays green.
- [x] `packages/application/src/procedures/derive-plan.ts` — the command the worker job runs: derive, store the plan or the failure reason, record the attempt, and append its audit event. Guard and refuse exactly as the other Draft commands do.
- [x] Enqueue a re-derivation from every existing Draft-save command when the saved data changes; a no-op save enqueues nothing.
- [x] Infrastructure: generation-12 typed columns for the stored plan, its attempts and the derivability signal, with shape CHECKs using `coalesce(..., false)`; hand-appended `INSERT INTO schema_meta`; `SUPPORTED_SCHEMA_MIN`/`MAX` raised in the SAME commit.
- [x] `apps/web` — the read-only preview with no edit controls, the re-deriving and re-derived states, and the "Cannot derive: {reason}" state. Below the responsive floor the Builder rule already applies.
- [x] Domain, application, integration and e2e tests — determinism (derive twice, compare bytes), every matrix row, a recorded failed attempt, rollback, a held-open-transaction concurrency case, and a WCAG scan of the preview. Record reusable decisions in `CLAUDE.md`.

**Acceptance Criteria:**
- Given a Draft whose section is saved, when the save changes stored data, then a derivation job is enqueued and no derivation runs inside the web request.
- Given identical frozen version data, when the plan is derived twice, then both derivations produce byte-identical plans under the same frozen compiler version.
- Given a version the plan cannot be derived from, when derivation runs, then the preview states "Cannot derive: {reason}", the derivability signal is false, and the failed attempt is recorded with its reason.
- Given a derived plan, when the Auditor reads the preview, then it shows Session Steps, ordered Plan Steps per Target System, Observations, conditions with their status, credential REFERENCES, limits, and the model identity only when a model was used — with no edit control anywhere.
- Given a stored plan whose shape does not validate against its `schemaVersion`, when the version is read, then the plan reads as absent rather than as a plan.
- Given a configured model, when derivation runs, then the gateway is called, the derived plan is stored, and the PROVIDER, model identity and prompt version are recorded on the version.
- Given either configured provider, when the same frozen inputs are derived, then both produce a plan that satisfies the durable contract — the command is unchanged by which provider ran.
- Given a model response that does not satisfy the durable plan contract, when derivation runs, then no plan is stored and the attempt is recorded as a failure with its reason.
- Given no model is configured, when derivation runs, then it still succeeds deterministically and records that no model was used, so a run without a credential is not blocked.

## Spec Change Log

- 2026-09-04: Root finalized the queue transaction, stale-result and deterministic model-conformance design from installed dependency types and the frozen intent. Story 2.5 is committed/pushed as 38c96ca and supplies the tested shared editor state machine. The queue/provider dependencies are already installed; preserve their pins. No frozen intent or existing durable contract was changed.


## Design Notes

### Implementation decisions (2026-09-04)

- Normative schema-1/compiler-1 action interpretation: [Executable plan contract](../../docs/contracts/executable-plan-v1.md). The action vocabulary and frozen inputs bind exact Template lookup keys, registered secondary-key corroboration, absence completeness, ambiguity, grounding, coverage and condition evaluation; canonical step text explains those semantics without granting a model new authority.

- Use installed pg-boss 12.29.0 and its fromDrizzle(transaction, sql) adapter so a changed Draft, audit event and derivation job commit or roll back together. No-op saves enqueue nothing. Runtime producers/consumers use migrate:false and createSchema:false; only the release/CI migrator installs/upgrades pg-boss and creates the procedures queue.
- A job carries schemaVersion, versionId and an authoring-input digest, separate from the whole-row optimistic token. Attempts and preview fields invalidate client tokens without changing compiler inputs. Compile/model work outside locks, then lock, compare the authoring digest and atomically record attempt/audit/result. Stale attempts are recorded but never replace a newer preview.
- Freeze compiler version and model configuration/provenance on the version. Keep timestamps, attempt IDs and queue metadata outside canonical plan bytes.
- The deterministic compiler owns executable meaning. The configured model independently derives a candidate from original authored inputs and the schema/action vocabulary, not a supplied completed plan. Validate the entire candidate against the durable schema, then require semantic equivalence to the deterministic contract: rule predicates, applicability, Agent-Judged definitions, system/step coverage and ordering, observation/grounding requirements, credential references and exact limits cannot change. Canonical step IDs/text derive from action kinds and authored references. Reject added/omitted/changed semantics; do not silently normalize them away. Accepted equivalent representations emit the compiler's canonical normal form. This is real model-assisted derivation and conformance checking; model failures affect the outcome. With no configured model, compile the same canonical plan and record no model usage.
- Whole-plan repeatability does not follow from temperature zero or caching arbitrary inference. Provider raw text, incidental wording and secret values are never persisted or logged.
- Read config only at composition roots; both installed real providers live behind the application-owned gateway. Fake gateways exercise success, malformed output, semantic tampering and thrown provider failures. No API key is currently configured in this workspace, so report live-provider verification as an explicit deployment action unless a credential becomes available.
- While wiring every saved section to queue invalidation, audit older Builder editors' token/field refresh behavior. They predate Story2.5 and share a token-only refresh pattern: dirty authored values must not adopt permission to overwrite a concurrently refreshed same section. Reuse the tested section state machine where appropriate; retain whole-row server guards. Resolve this within Epic2 before final delivery.
- On this host dot-source C:/Users/opc/AppData/Local/Temp/intellifin-epic2-env.ps1 for Node24.20/pnpm11.25 and isolated TLS/SCRAM PostgreSQL18.6. Run heavy checks sequentially; unit/integration maxWorkers=1.



**The model is genuinely in the loop — decided by the product owner.** An earlier draft of this spec proposed a deterministic-only derivation on the grounds that no model credential was configured. That is overridden: the deployment WILL configure a model, and the model path must be real enough to demonstrate working, not stubbed. So the AI SDK and its Anthropic provider are installed and `ModelGateway` has a real implementation.

Two constraints still shape it. NFR-4 requires a Rule-Classified evaluation to be reproducible from identical frozen inputs, so the compiled, rule-bearing parts of the plan stay deterministic and the model never silently changes them. And CI holds no credential, so derivation must still succeed without one — otherwise "Cannot derive" would block Submit on every version and Story 2.7 would be untestable in CI. The resolution is that the model participates and is recorded when configured, derivation degrades deterministically when it is not, and the tests inject a fake gateway so the model path is exercised in CI without a key while a real key proves it end to end.

**The provider is configuration, not architecture.** AD-23 names `claude-sonnet-5` as the default "unless configured otherwise", so a second provider behind the same port is within the spine. Both are installed; the deployment picks one. Cost at this story's volume is not the deciding factor — a derivation is a few thousand tokens, so the whole epic costs single-digit to low-double-digit dollars on any of them — but the plan is a DURABLE contract that later Runs consume byte-for-byte, so the provider is recorded on the version and can be compared and switched by configuration rather than by a code change.

**A model response is untrusted input.** It is validated against the durable plan contract before it is stored, and it is data, never instructions. This is the same discipline Epic 4 later applies to retrieved content.

**The queue is real, not simulated.** AD-3/AD-23 make "never inside a web request" the point of the story; a synchronous derivation hidden behind a promise would satisfy the tests and not the requirement.

**Generation numbering.** Story 2.5 takes generation 11; this story takes 12. If 2.5 has not landed, renumber both this migration and the compat range together.

## Verification

Command outcomes on 2026-09-04, using pinned Node 24.20.0/pnpm 11.25.0 and isolated PostgreSQL 18.6/schema 12. Heavy commands ran sequentially. This is a verification summary, not captured stdout.

- `pnpm typecheck`: exit 0, monorepo and root test types; rerun after final editor changes.
- `pnpm boundaries`: exit 0, 271 modules. The final unfiltered unit suite also executes the boundary harness against the workspace.
- `pnpm test --maxWorkers=1`: exit 0, **1,854 tests / 70 files**, 117.02 seconds, start 22:09:53 UTC.
- `pnpm db:migrate`: exit 0, schema generation 12. `pnpm db:generate`: exit 0, no schema drift.
- `pnpm test:integration --maxWorkers=1`: exit 0, **163 tests / 11 files**, 45.70 seconds, start 21:56:49 UTC.
- `pnpm build`: exit 0, packages, worker and Northstar. `pnpm --filter @intellifin/web build`: exit 0, optimized production build and TypeScript, rerun after final editor changes.
- `pnpm test:e2e`: exit 0, **91 tests passed**, 4.2 minutes, start 22:12:49 UTC. All WCAG scans passed. The focused Period conflict/lost committed response/reload test passed with its three setup cases, exit 0, 42.3 seconds.

Every matrix row is included in the unfiltered runs: queue/transaction/no-op/rollback, real consumer, repeat bytes, invalid stored plans and held-lock stale outcomes in `tests/integration/derive-plan.test.ts`; deterministic completeness/schema/semantic tests in `tests/unit/executable-plan.test.ts`; all four Templates in `tests/unit/executable-plan-template-contract.test.ts`; thrown/invalid/model-neutral outcomes in `tests/unit/derive-plan.test.ts`; real installed Anthropic/OpenAI SDK protocols with synthetic HTTP in `tests/unit/model-provider-protocol.test.ts`; preview markup in `ExecutablePlanPreview.test.ts`; and real queued pending/failure/success, read-only controls, responsive floor and WCAG scans in `tests/e2e/executable-plan.spec.ts`. The Procedures browser suite covers dirty Period refresh/conflict plus a committed save whose response is deliberately lost, blocking retries until reload shows saved state.

The initial browser run passed 90/91. The new two-tab test required observable hydration readiness before typing on a freshly navigated page. Its focused rerun passed; the lost-response extension then required scoping its notice assertion to the visible paragraph rather than matching accessible disabled-reason spans too. These were test corrections, not suppressed failures.

Pre-review root findings were resolved separately from the upcoming formal review: durable late-attempt recording after submission, normative action interpretation and readable expressions, real installed provider SDK HTTP conformance, honest lost-response recovery in older editors, and absent secondary-key explanation discovered by the all-Template contract suite. No formal review triage count is claimed here.

No live paid provider call was made because no model API key is configured. Both real installed SDK/provider adapters are exercised against synthetic HTTP responses; the browser uses a fake model behind the actual queue. Runtime target execution is outside this story and was not claimed or tested. The external deployment action is to configure a provider credential and exercise a real model-derived candidate against the frozen contract.

Local evidence summary: `C:/Users/opc/AppData/Local/Temp/story26-verification-summary.log` (summary, not raw stdout). Browser report: `playwright-report/index.html`.

### Post-review repair verification

The consolidated formal-review repairs preserve schema 1 and compiler 1. They add audited attempt starts/finalization, bounded transport retries and restart/terminal reconciliation, explicit authorized retry, duplicate-result protection with a current-publisher marker, conservative provider output-budget preflight and supported prompt identity, a summary-only list query, structural editor equality, bounded preview polling, keyless web model identity configuration, unique Step IDs, and rolling-upgrade recovery even after a prior plan succeeded. The retry event is operational provenance, not definition authorship.

Additional real PostgreSQL tests cover final audit failure after committed start, retry exhaustion/restart, live delivery protection, real JSONB key ordering, 120 obsolete terminal digests without starvation, and old-producer writes after a completed successful plan. Command/preview tests cover out-of-order completions and A→B→A inputs at identical clock times; only the current installer retains the published marker. Browser coverage now includes Compliance commit-then-abort recovery and explicit retry after restoring frozen model availability.

Stable-repair results so far: `pnpm typecheck` and `pnpm boundaries` exit 0 (278 modules); `pnpm test --maxWorkers=1` exit 0, **1,892 tests / 73 files**; migration/generation exit 0 with no schema drift; package/worker and optimized web builds exit 0. Final `pnpm test:integration --maxWorkers=1` passed **170 tests / 12 files**, exit 0, 54.70 seconds (22:54:31 UTC start). Final `pnpm test:e2e` passed **92 tests**, exit 0, 4.2 minutes (23:04:08 UTC start), including all WCAG scans. The initial repair browser run passed 91/92 because the new Compliance test attempted Playwright click on an aria-disabled button; the corrected keyboard activation proved the guard and persisted reload, then the complete suite passed. No production behavior was changed for that test correction. Formal review triage and final status are root-owned; this section records implementation verification only.


## Review Triage Log

### 2026-09-04 — Review pass and verified follow-up
- intent_gap: 0
- bad_spec: 0
- patch: 16: (high 4, medium 12, low 0)
- defer: 0
- reject: 5: (high 0, medium 0, low 5)
- addressed_findings:
  - `[high]` `[patch]` Section comparison uses canonical structural equality; real PostgreSQL JSONB key order cannot manufacture conflicts.
  - `[high]` `[patch]` An audited durable attempt start precedes compiler/model work; atomic finalization and recovery retain interrupted attempts.
  - `[high]` `[patch]` Terminal/restart recovery reconciles exhausted or orphaned work, rechecks live jobs under the version lock and exposes actionable failure.
  - `[high]` `[patch]` Legacy authoring drift is recovered once, including edits after completed derivation; a bounded keyset sweep advances across Drafts.
  - `[medium]` `[patch]` Classified transient provider failures use the queue's bounded retry metadata; invalid output does not repeat paid calls.
  - `[medium]` `[patch]` Failed current Drafts have an authorized, revision-guarded retry outside the preview, with retry-generation UI state reset.
  - `[medium]` `[patch]` Duplicate completions preserve a valid current plan; a sole current-publisher marker preserves truthful provenance across out-of-order and same-clock A-to-B-to-A derivations.
  - `[medium]` `[patch]` Full model output is conservatively budgeted before paid I/O, with a clear oversized-plan refusal and configurable supported limit.
  - `[medium]` `[patch]` Prompt version identifies actual immutable supported prompt text; unsupported versions fail explicitly.
  - `[medium]` `[patch]` Procedure summaries project bounded metadata instead of loading every plan and attempt history.
  - `[medium]` `[patch]` Pending preview checks back off and pause with honest prolonged-wait feedback.
  - `[medium]` `[patch]` Web composition requires model identity without the provider secret; worker composition requires the secret.
  - `[medium]` `[patch]` Compliance Rule browser coverage proves committed-response loss, blocked retry, saved-value reload and accessibility.
  - `[medium]` `[patch]` Executable step IDs are unique within their provenance contract.
  - `[medium]` `[patch]` Compiler-1 opaque identifier normalization is explicitly exact and permits no equivalence-expanding transforms.
  - `[medium]` `[patch]` Obsolete terminal digests cannot occupy the bounded recovery candidate set and starve current work; a 120-obsolete-job regression proves it.

All four formal layers were launched before collection/triage. The separate highest-capability follow-up found the historical-publisher issue, then confirmed its current-publisher repair and same-clock regression resolved it. No material findings remained. See [follow-up review](review-2-6-followup.md) and the four original review records beside this spec.

## Auto Run Result

- Implemented real transactional queued derivation, deterministic versioned executable plans, configured Anthropic/OpenAI model conformance, read-only preview, durable audited attempts, bounded retry/recovery and safe authoring refresh behavior.
- Files changed: domain executable-plan schema/compiler and normative interpreter contract; application derivation/retry/queue ports and save invalidation; infrastructure provider adapters, queue/recovery, summary projections and generation-12 schema; worker composition; Builder preview/retry/shared editor wiring; unit, real-PostgreSQL and browser regressions; decision log, review records and delivery report. Prepared later-story design notes and the owner's activation-time handover correction are included as planning changes, not claimed runtime delivery.
- Review breakdown: 16 patches applied (high 4, medium 12, low 0), zero deferred in this story, five rejected recommendations. Follow-up review recommended: true; weighted score `3 × 12 = 36`, independently required by four high findings. Follow-up was performed and resolved the remaining provenance finding.
- Verification: final stable-code results are recorded above. Matrix coverage includes all four Templates, real queue/transaction/recovery behavior, both installed SDK protocols, stale/duplicate/late results, preview states, retry and accessibility.
- Residual limits: no live paid-provider call because no API credential is configured; synthetic HTTP proves the installed SDK protocols. Actual audit execution, Regression Runs and scheduler execution remain later epics. Story 2.7 owns submission/approval and the integrated actual-worker hero journey, including additional earlier-form browser wiring checks.
