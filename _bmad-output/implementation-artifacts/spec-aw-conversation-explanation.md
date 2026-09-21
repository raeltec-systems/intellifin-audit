---
title: 'AW P3: explain recorded evidence and interpret bounded conversational intent'
type: feature
created: '2026-09-20'
status: draft
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/docs/workstreams/auditor-workspace/spec-v1.1.md'
---

<frozen-after-approval reason="user authorized completion of the PR 51 workstream">

## Intent

**Problem:** Generic deterministic replies cannot explain a finding's recorded basis or interpret useful ordinary language. Delayed explanations must retain the selected record and facts they actually explain.

**Approach:** Add a separate bounded explanation/interpreter service over an immutable authorized context snapshot. It can cite approved facts or select a server-owned proposed intent; it cannot execute tools or change audit results. Preserve deterministic safety shortcuts, domain commands and operational receipts.

## Boundaries & Constraints

**Always:** Freeze question/record context at intake. Encrypt retained inputs, snapshots and generated prose using governed conversation storage. Pin provider/model/prompt/schema identity and retain provenance. Treat all prior messages and captured values as inert data. Validate every citation and proposed option against the same snapshot and revalidate domain authority before creating/confirming a proposal. Model work occurs outside database locks. Keep controls and evidence usable during explanation failures.

**Ask First:** D2 before real-data admission. Local proof uses deterministic provider fixtures; external paid-model acceptance needs its named budget.

**Never:** Feed chat into the execution model's governing instructions, let a model invent commands/arguments/options/URLs, use model text as a receipt or rule conclusion, change provider implicitly, log prompts/credentials/provider error bodies, or merge/deploy.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected behavior | Error handling |
|---|---|---|---|
| Evidence question | Selected recorded finding | Cited explanation, record label and as-of timestamp | Missing basis is explicit |
| Delayed answer | Run advances while generating | Answer retains original snapshot and record | Never reinterpret “this record” |
| Ordinary directive | One unambiguous permitted intent | Server validates exact catalog reference and produces reviewable proposal | No execution from model output |
| Qualified language | Quoted, negated, conditional, mixed or ambiguous instruction | Clarification with supported choices | No actionable proposal by inference |
| Hostile source | Captured text requests new roles/tools or changed result | Escaped inert data; no authority change | Reject invalid output |
| Invented citation | Unknown or cross-Run fact/record/evidence reference | Fixed unavailable response | No fabricated link |
| Model failure | Timeout, bad schema, missing pinned provider or exhausted budget | Durable unavailable status; controls still work | Bounded code, no raw error |
| Duplicate / crash | Same question/job, worker loss around generation | One final response and original provenance | Durable retry/fencing |
| Removal / revocation | Governed context removed or actor loses access before finalization | No newly published sensitive answer | Preserve metadata/tombstone policy |

</frozen-after-approval>

## Code Map

- `packages/application/src/runs/run-conversation.ts`: keep the exact deterministic interpreter first. Add separate strict model input/output contracts and validation. Responses are an answer with bounded text and fact IDs, a clarification, or a proposed catalog option ID. A catalog option is a server-created finite reference to an existing typed proposal; it is never a model-created command payload. Existing exact answers/flags/strategies retain their own context and confirmation contracts.
- `packages/infrastructure/src/runs/run-conversation-repository.ts`: `facts()` and `recordReviewProjectionQuery()` supply whitelisted committed facts. In the intake transaction freeze Run/procedure summary, selected ordinal and subject, targets, observation/evaluation/condition values, registered evidence references, current exact question, bounded recent governed conversation and finite eligible proposal catalog. Include as-of time, revision, canonical digest and stable fact IDs. Do not reread current facts as the original question's context later.
- `conversation-content.ts`, schema and next migration: retain encrypted generation input and snapshot, immutable identities/digests, pinned provenance, status, generation fence/lease, response child ID and fixed failure codes. Reuse governed removal/key lifecycle; generation data must not create an undeletable second copy of removed content. Preserve one final response child per intake and expose queued/running/completed/unavailable status through the read DTO.
- New application generation port and infrastructure adapter beside `procedures/model-gateway.ts`: reuse the explicitly configured provider/model identity without fallback. Persist identity before dispatch and verify it on recovery. Record a checked-in conversation prompt/schema version separately from derivation prompt version. The existing agent action/evaluation gateway is not an interpreter. Bound context bytes, output, time, concurrency and attempts; disable provider input/output telemetry.
- Existing pg-boss infrastructure and `apps/worker/src/main.ts`: persist an ID-only generation job atomically with intake. Claim with a durable fence, call the provider outside a transaction, and finalize through a short reauthorized transaction. Recovery scans/queue behavior must not leave running requests stranded. Store generated prose only after strict schema, citation and governed-content validation. A proposed option goes through the same server-owned proposal validation as its deterministic equivalent, never directly to the queue or browser executor.
- `apps/web/src/runs/RunConversation.tsx`, `RunWorkspaceConversation.tsx`: render pending, unavailable, clarification and generated explanation distinctly. Show “Answer based on the evidence recorded at …”, selected subject and protected basis links. Generated prose is escaped text; only validated server DTOs render review controls. Preserve draft/history position and LiveGate.
- Conversation/gateway unit tests, PostgreSQL generation tests and hydrated browser fixtures: held-out phrasing, malicious source content, delayed response after selection/Run changes, duplicate jobs, crash fencing, cancellation, removal/revocation, fabricated citations, unavailable provider and safety-control responsiveness.

## Tasks & Acceptance

- [ ] Freeze bounded governed context and finite eligible proposal catalog at intake.
- [ ] Add pinned model port, strict output/citation validation and inert data serialization.
- [ ] Add durable generation lifecycle, atomic queue intake, recovery and provenance.
- [ ] Route validated interpretations through existing proposal/confirmation handlers only.
- [ ] Render grounded answers, as-of context, clarification and truthful failure states.
- [ ] Execute held-out language, privacy, race, rollback and browser acceptance coverage.
- [ ] Record model/configuration decisions and exact synthetic proof in the shared report.

**Acceptance:** Given a selected finding, when an explanation completes after other work advances, then it cites only the original authorized recorded facts and names that context. Given ordinary language, only a uniquely validated permitted interpretation can become an explicit reviewable proposal; neither model text nor captured instructions can authorize execution.

## Design Notes

Implement after exact command slices so the catalog reuses their contracts. Read-only explanations must not depend on a controller lease. Discretionary proposed actions still require the current holder and exact domain context. A model may help interpret language, but cannot create authority. Ambiguous wording is clarified even when a provider confidently chooses an option. Reserve existing command/receipt capacity separately from generation. Deterministic operational narration remains event-grounded and never incurs a model call per event.

## Verification

Typecheck/boundaries; focused validator/gateway and full unit tests; fresh PostgreSQL migration, queue/fence/privacy tests; zero-retry browser fixture proving stable context and controls during model delay/failure. Report synthetic model proof separately from live-provider language quality and human usability gates.
