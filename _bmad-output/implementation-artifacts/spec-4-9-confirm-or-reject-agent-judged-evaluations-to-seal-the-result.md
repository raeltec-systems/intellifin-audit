---
title: 'Story 4.9: Confirm or reject Agent-Judged evaluations to seal the Result'
type: 'feature'
created: '2026-09-06'
status: 'ready-for-dev'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/docs/contracts/run-result-v1.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** §E.1 row 4 — Pending Confirmation — has never fired. Epic 3 produced evaluations of
origin `RULE` only, so nothing was ever pending, and the row shipped tested with a constructed
state. C2, the privileged-roles judgment, is the first uncompiled condition, and a Result with a
pending Agent-Judged evaluation sits unsealed until a human resolves it.

**Approach:** The agent registers its evaluation with origin `AGENT_JUDGED`, confirmation
`pending`, a confidence and a rationale, in the same registration transaction as the Observation.
An Auditor confirms or rejects each one, and when the last is resolved the Result seals — once.
The outcome table, the seal, the version trigger and the origin vocabulary all already exist.

## Boundaries & Constraints

**Always:** The Agent-Judged evaluation is in the SAME registration transaction as the
Observation — `registerObservations` is the one write path and answers about EVERY Observation
exactly once, refusing anything else as `evaluation-shape`. A confidence BELOW the version's
frozen threshold (default 0.80) stores `UNEVALUATED`, origin `AGENT_JUDGED`, confidence
retained, needing NO confirmation. A confidence EXACTLY EQUAL to the threshold is `pending` and
DOES need confirmation — the boundary is inclusive on the pending side, and a test asserts the
exact equality case because that is the one an implementer flips. Confidence is a DECIMAL
STRING, compared against the frozen `agentJudgedThreshold` which Story 2.4 also stores as a
decimal string: two representations of one quantity is one too many. A missing confidence, or
one outside [0, 1], FAILS wire-schema validation at the adapter boundary and the Step Execution
is retried under its budget.

**Never:** Never seal twice. `SealResult` computes the System Outcome exactly ONCE and
generation 25's trigger permits exactly one update to a Result — the sealing of a pending one,
which must seal and must raise the version by one. Never mutate an evaluation after sealing.
Never let a rejected Agent-Judged evaluation disappear: it stays visible beneath the human
replacement as history. Never show Confirm/Reject on a Rule-Classified card or on a
below-threshold card — the first was not judged by an agent, the second needs no confirmation.

**Scope:** C2 for P-1. The rationale is agent-generated free text and goes through
`UntrustedText`, labelled agent-generated — the deterministic evaluator writes no rationale
precisely so that a free-text reason is always recognisable as the agent's.

## I/O & Edge-Case Matrix

| Input | Expected |
|---|---|
| Confidence 0.95, threshold 0.80 | `pending`, needs confirmation |
| Confidence 0.80, threshold 0.80 | `pending`. The equality case |
| Confidence 0.79, threshold 0.80 | `UNEVALUATED`, origin `AGENT_JUDGED`, confidence retained, no controls |
| Confidence absent, or 1.5, or `"abc"` | Wire-schema validation fails at the adapter boundary; Step Execution retried; nothing registered |
| A Completed unsealed Run | Outcome shows `Pending Confirmation` with `{n} Agent-Judged evaluations await confirmation`; Submit disabled with `Submission is unavailable while the Result is unsealed.` |
| Confirm on a Run that is not `COMPLETED` | Refused |
| Confirm on a sealed Result | Refused |
| Confirm with a stale Result revision | Refused; reload |
| Reject | Rationale dialog with a rationale AND a replacement value (Compliant, Exception, Unevaluated); replacement recorded origin `HUMAN`; rejected evaluation kept beneath as history |
| The last pending evaluation resolved | `SealResult` once; version + 1; every later mutation refused |
| The resolving rejection leaves a condition Unevaluated and no Exception counts | Run `COMPLETED → INCONCLUSIVE`, Evidence preserved — §E.1's only such transition, and it happens only at Result sealing |

## Code Map

**New:**
- `packages/application/src/runs/confirm-evaluation.ts` and `reject-evaluation.ts` — both lock
  the Result row under the expected revision, increment it, and evaluate the seal condition
  INSIDE that lock.
- `apps/web/src/runs/PendingEvaluations.tsx` and its two Server Actions, each authorizing for
  itself before reading input.

**Modified:**
- `packages/application/src/runs/register-observations.ts` — accepts an `AGENT_JUDGED` result
  from the evaluation seam. The bijection check and the refusals do not move.
- `packages/domain/src/runs/observation.ts` — `EVALUATION_CONFIRMATIONS` already carries
  `pending | confirmed | rejected`. Nothing is added.

**Reused unchanged:** `systemOutcome`, `OUTCOME_ROWS`, the generation-25 trigger,
`run_result_pass_requires_gate`, `completeRun`.

## Tasks & Acceptance

1. **Agent-Judged registration** in the Observation's transaction, with the threshold rule and
   its inclusive boundary.
2. **Wire-schema refusal** for a missing or out-of-range confidence, at the adapter boundary.
3. **The Pending Confirmation surface** with the verbatim EXPERIENCE.md copy read off disk.
4. **Confirm and Reject**, locked, revision-guarded, sealing inside the lock.
5. **Seal once**, with the §E.1 row 4 and row 5 paths BOTH exercised against a real database —
   the first time either has been reachable from a real Run.
6. **The `COMPLETED → INCONCLUSIVE` transition** at sealing, asserted.

## Design Notes

**Why row 5 finally has a real producer.** `OUTCOME_ROWS` row 5 is "Unevaluated (by human
rejection)", and Story 3.9 recorded that the parenthetical is PROVENANCE, not a predicate —
made a predicate, an `UNEVALUATED` of any other origin would match no row and fall through to
Pass. This story is the first that can produce a human rejection, so the row's predicate and its
provenance reading are both exercised for real rather than constructed.

**Why the equality case is called out.** `>= threshold` and `> threshold` differ on exactly one
input, and the addendum says equality is pending. A test that only tries 0.95 and 0.79 passes
against both spellings.

## Verification

- Unit: the threshold boundary at, above and below; the wire-schema refusals; seal-once.
- Integration: confirm and reject against real PostgreSQL, with a held-open transaction proving
  the revision guard; the `COMPLETED → INCONCLUSIVE` sealing path.
- Browser: the P-1 journey to Pending Confirmation and through both resolutions. WCAG 2.1 AA.
- Mutation: change the threshold comparison to strict and prove the equality test fails.

## Auto Run Result

_Not yet run._
