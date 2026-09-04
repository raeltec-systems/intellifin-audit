---
title: 'Read the re-derived executable plan before submitting'
type: 'feature'
created: '2026-09-04'
status: 'ready-for-dev'
review_loop_iteration: 0
baseline_commit: 'TBD — set at implementation start; depends on Story 2.5 landing first'
deferred: []
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A Draft now carries every authored section, but nothing turns those sections into the executable plan a Run would follow, and an Auditor cannot read what would actually execute before submitting it.

**Approach:** Derive the executable plan from the frozen version data as a queued `procedures` worker job — never inside a web request — record every derivation attempt whether it succeeded or not, and render the result as a read-only plan preview that states "Cannot derive: {reason}" when the plan is underivable.

## Boundaries & Constraints

**Always:** Derive the plan in a queued worker job owned by `procedures`. Record EVERY re-derivation attempt, successful or not, with its outcome and time. Freeze the compiler version on the version, so identical frozen inputs always derive an identical plan (NFR-4). Store the compiled plan as a versioned durable contract — a validated schema plus an explicit `schemaVersion` — so a later executor consumes it byte-for-byte and never re-derives it (AD-14). Queue a re-derivation whenever a saved section changes. Show the preview read-only: Session Steps, ordered Plan Steps per Target System, Observations to capture, compiled and Agent-Judged conditions, credential references, limits, and the model identity when a model was used. When the plan cannot be derived, state "Cannot derive: {reason}" and record the reason. Call the configured model through one owned `ModelGateway` port and record its identity and prompt version on the version. VALIDATE every model response against the durable plan contract before storing it, and treat the response as untrusted data — never as instructions, and never stored raw.

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
- [ ] Add the queue dependency (`pg-boss`, the pinned major) and wire a `procedures` job queue: enqueue from the application layer through an owned port, consume in `apps/worker`. The web app enqueues; it never derives.
- [ ] `packages/domain/src/procedures/executable-plan.ts` — the durable plan contract (explicit `schemaVersion`, validated shape) and the DETERMINISTIC derivation from frozen version data: Session Steps, ordered Plan Steps per Target System, Observations to capture, conditions with their compiled/Agent-Judged status, credential references, limits. Same inputs must always give the same bytes.
- [ ] Install the stack this story needs and that nothing currently installs: the pinned `pg-boss` for the queue, and the Vercel AI SDK with its Anthropic provider for the model. Add the model settings (provider, model id, prompt version, and the API key) to `packages/infrastructure/src/config.ts` and `.env.example`, read ONLY in a composition root — never as ambient env inward.
- [ ] Add the `ModelGateway` port (application-owned) and its real Anthropic-backed implementation in infrastructure. Derivation CALLS it when a model is configured, validates the response against the durable plan contract before storing anything, and records the model identity and prompt version on the version. A response that fails contract validation is a derivation FAILURE with a stated reason, never a stored plan. With no model configured, derivation still succeeds deterministically and records that no model was used, so CI — which holds no credential — stays green.
- [ ] `packages/application/src/procedures/derive-plan.ts` — the command the worker job runs: derive, store the plan or the failure reason, record the attempt, and append its audit event. Guard and refuse exactly as the other Draft commands do.
- [ ] Enqueue a re-derivation from every existing Draft-save command when the saved data changes; a no-op save enqueues nothing.
- [ ] Infrastructure: generation-12 typed columns for the stored plan, its attempts and the derivability signal, with shape CHECKs using `coalesce(..., false)`; hand-appended `INSERT INTO schema_meta`; `SUPPORTED_SCHEMA_MIN`/`MAX` raised in the SAME commit.
- [ ] `apps/web` — the read-only preview with no edit controls, the re-deriving and re-derived states, and the "Cannot derive: {reason}" state. Below the responsive floor the Builder rule already applies.
- [ ] Domain, application, integration and e2e tests — determinism (derive twice, compare bytes), every matrix row, a recorded failed attempt, rollback, a held-open-transaction concurrency case, and a WCAG scan of the preview. Record reusable decisions in `CLAUDE.md`.

**Acceptance Criteria:**
- Given a Draft whose section is saved, when the save changes stored data, then a derivation job is enqueued and no derivation runs inside the web request.
- Given identical frozen version data, when the plan is derived twice, then both derivations produce byte-identical plans under the same frozen compiler version.
- Given a version the plan cannot be derived from, when derivation runs, then the preview states "Cannot derive: {reason}", the derivability signal is false, and the failed attempt is recorded with its reason.
- Given a derived plan, when the Auditor reads the preview, then it shows Session Steps, ordered Plan Steps per Target System, Observations, conditions with their status, credential REFERENCES, limits, and the model identity only when a model was used — with no edit control anywhere.
- Given a stored plan whose shape does not validate against its `schemaVersion`, when the version is read, then the plan reads as absent rather than as a plan.
- Given a configured model, when derivation runs, then the gateway is called, the derived plan is stored, and the model identity and prompt version are recorded on the version.
- Given a model response that does not satisfy the durable plan contract, when derivation runs, then no plan is stored and the attempt is recorded as a failure with its reason.
- Given no model is configured, when derivation runs, then it still succeeds deterministically and records that no model was used, so a run without a credential is not blocked.

## Spec Change Log

## Design Notes

**The model is genuinely in the loop — decided by the product owner.** An earlier draft of this spec proposed a deterministic-only derivation on the grounds that no model credential was configured. That is overridden: the deployment WILL configure a model, and the model path must be real enough to demonstrate working, not stubbed. So the AI SDK and its Anthropic provider are installed and `ModelGateway` has a real implementation.

Two constraints still shape it. NFR-4 requires a Rule-Classified evaluation to be reproducible from identical frozen inputs, so the compiled, rule-bearing parts of the plan stay deterministic and the model never silently changes them. And CI holds no credential, so derivation must still succeed without one — otherwise "Cannot derive" would block Submit on every version and Story 2.7 would be untestable in CI. The resolution is that the model participates and is recorded when configured, derivation degrades deterministically when it is not, and the tests inject a fake gateway so the model path is exercised in CI without a key while a real key proves it end to end.

**A model response is untrusted input.** It is validated against the durable plan contract before it is stored, and it is data, never instructions. This is the same discipline Epic 4 later applies to retrieved content.

**The queue is real, not simulated.** AD-3/AD-23 make "never inside a web request" the point of the story; a synchronous derivation hidden behind a promise would satisfy the tests and not the requirement.

**Generation numbering.** Story 2.5 takes generation 11; this story takes 12. If 2.5 has not landed, renumber both this migration and the compat range together.

## Verification

- `pnpm typecheck`, `pnpm boundaries`, `pnpm test` — all pass.
- `pnpm db:migrate`, `pnpm db:generate`, `pnpm test:integration` — migrates to generation 12, no drift, PostgreSQL 18 checks pass.
- `pnpm build`, `pnpm --filter @intellifin/web build`, `pnpm test:e2e` — builds and Builder journeys pass, including every WCAG 2.1 AA scan.
