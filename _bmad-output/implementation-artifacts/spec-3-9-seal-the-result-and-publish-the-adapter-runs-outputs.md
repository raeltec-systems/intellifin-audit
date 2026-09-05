---
title: "Story 3.9: Seal the Result and publish the adapter Run's outputs"
type: 'feature'
created: '2026-09-05'
status: 'ready-for-dev'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/docs/contracts/evidence-package-v1.md'
  - '{project-root}/docs/contracts/observation-registration-v1.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** A Run can pass its Gate and still say nothing an auditor can act on. There is no System Outcome, no sealed Result, and nothing that reports the population, the exclusions, the coverage or the Template's control-specific fields.

**Approach:** Compute the System Outcome exactly once, in the same transaction that completes the Run, by applying the addendum E.1 outcome table in order and taking the first matching row. Seal the Result so the outcome can never change, and publish everything the Template promises.

## Boundaries & Constraints

**Always:** `SealResult` runs inside `CompleteRun`'s transaction and computes the outcome exactly once. The addendum E.1 rows apply in order and the FIRST matching row wins, across Canceled, Run Failed, Inconclusive, Pending Confirmation, Control Failure and Pass. Pass requires every Gate check passed, the Result sealed, and no condition Exception or Unevaluated; a passed Gate is necessary but never sufficient. Control Failure applies when any Exception counts toward the outcome, and any Unevaluated records are listed. Sealing increments the Result version and the outcome never changes afterwards. Publication reports the population, the exclusions with their reasons, inspected and uninspected records per Target System, per-condition counts by origin and confirmation state, and the Template's control-specific fields from addendum C. Excluded, uninspected and Unevaluated records are never counted Compliant. The version's stored scope statement is shown verbatim. A version that opted in to a zero-record Pass with a post-inclusion population of zero seals as Pass with population 0 and every count 0, and its generated statement says that no record was inspected.

**Block If:** Two outcome rows would both match and the order between them is not fixed by addendum E.1.

**Never:** Do not let any later mutation change a sealed outcome. Do not compute the outcome twice or outside the completing transaction. Do not count an excluded, uninspected or Unevaluated record as Compliant to reach Pass.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Clean Run | Gate all passed, no Exception, no Unevaluated | Pass, sealed, Result version incremented | Once only |
| Exception present | Gate passed, at least one Exception | Control Failure, Unevaluated records listed | Once only |
| Gate failed | Any Gate row failed | Inconclusive; first matching row wins over Control Failure | Ordered table |
| Zero-record opt-in | Opted in, post-inclusion population 0, Gate passed | Pass, population 0, all counts 0, statement says nothing was inspected | Explicit opt-in only |
| Zero-record without opt-in | Population 0, no opt-in | Not Pass | Never fabricated |
| Sealed then mutated | An attempt to change a sealed outcome | Refused | Immutable |
| Scope statement | A stored scope statement | Shown verbatim | Never reworded |

</intent-contract>

## Code Map

- Addendum E.1 in `_bmad-output/planning-artifacts/prds/prd-IntelliFin Audit-2026-08-31/addendum.md` — the outcome table whose rows apply IN ORDER, first match wins, across Canceled, Run Failed, Inconclusive, Pending Confirmation, Control Failure and Pass. Transcribe it; the order is the contract.
- Addendum C — the per-Template control-specific fields the Result must report. P-2 reports every prohibited pair found; P-3 reports the approval decision and the approver limit.
- `packages/application/src/runs/run-gate.ts` and `packages/domain/src/runs/gate.ts` (Story 3.8) — the Gate outcome the Result reports and the INCONCLUSIVE mapping it must not contradict.
- `packages/application/src/runs/seal-package.ts` and `packages/domain/src/runs/evidence.ts` (Story 3.5) — `sealIfTerminal`, the abandonment list, and the constraint trigger that already refuses a terminal Run with no package row. `SealResult` commits in the same transaction as `CompleteRun`.
- `packages/domain/src/runs/evaluation.ts` and `packages/infrastructure/drizzle/0023_*.sql` (Story 3.7) — the per-record evaluations and the Exception rows the Result counts. Counts are by origin and confirmation state.
- `packages/domain/src/runs/observation.ts` — the coverage vocabulary. Excluded, uninspected and Unevaluated records are never counted Compliant, which Story 3.4's composite foreign key already makes unreachable at the database.
- `packages/application/src/runs/acquire-population.ts` and `packages/domain/src/runs/population.ts` — the population, the exclusions with their reasons, and the zero-record opt-in flag the Gate consumes.
- `packages/infrastructure/src/db/schema.ts` and generations 19 through 24 — a generation 25 migration adds the Result with its version and an immutability trigger; raise `SUPPORTED_SCHEMA_MIN`/`MAX` together and list any new table in `tests/integration/schema-compat.test.ts`.
- The version's stored scope statement, on the frozen Procedure Version — shown verbatim, never reworded.

## Tasks & Acceptance

**Execution:**
- `packages/domain/src/runs/outcome.ts` (new) — the addendum E.1 table as ordered data with the first-match rule, and the pure outcome decision. No I/O.
- `packages/domain/src/runs/result.ts` (new) — the published Result shape: population, exclusions with reasons, inspected and uninspected per Target System, per-condition counts by origin and confirmation state, the Template's addendum C fields, and the verbatim scope.
- `packages/application/src/runs/complete-run.ts` (new) — `CompleteRun` with `SealResult` inside its transaction, computing the outcome exactly once, incrementing the Result version, and sealing the Evidence Package in the same commit.
- `packages/infrastructure/` generation 25, schema, `db/compat.ts`, `tests/integration/schema-compat.test.ts` — the Result table, its version, and a trigger making a sealed outcome immutable.
- Tests — domain tests walking every addendum E.1 row in order including a case where two rows could match and the earlier must win; integration coverage of every matrix row; and golden reconciliation asserting both full populations seal Inconclusive with their expected per-record counts.

**Acceptance Criteria:**
- Given a COMPLETED Run with no evaluation pending, when `CompleteRun` runs, then `SealResult` computes the outcome exactly once in the same transaction, and a passed Gate alone never yields Pass.
- Given the addendum E.1 table, when an outcome is computed, then the rows apply in order and the first matching row wins.
- Given a sealed Result, when anything later attempts to change the outcome, then it is refused and the Result version is unchanged.
- Given the Result, when it is published, then it reports the population, the exclusions with reasons, inspected and uninspected per Target System, per-condition counts by origin and confirmation state, and the Template's addendum C fields, with the stored scope shown verbatim.
- Given a version that opted in to a zero-record Pass and a post-inclusion population of zero, when the Gate passes, then the outcome is Pass with every count 0 and a statement saying no record was inspected.

## Spec Change Log

## Review Triage Log

## Verification

**Commands:**
- `pnpm typecheck`, `pnpm boundaries`, `pnpm test` (alone) — expected: pass.
- `pnpm db:migrate` then `pnpm test:integration` — expected: the new generation applied, all pass against PostgreSQL 18 on a `test`- or `ci`-named database.
- `pnpm db:generate` — expected: no drift.
- `pnpm build`, `pnpm --filter @intellifin/web build`, `pnpm test:e2e` — expected: pass, no accessibility violations.
