---
title: 'Story 3.8: Run the full Evidence Quality Gate and map limit exhaustion to a safe outcome'
type: 'feature'
created: '2026-09-05'
status: 'in-progress'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/docs/contracts/observation-registration-v1.md'
  - '{project-root}/docs/contracts/evidence-package-v1.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Per-Observation checks exist but nothing runs the Run-level Gate, so a Run could reach a conclusion with a truncated population, a stale snapshot or an unreconciled count. Nothing maps an exhausted limit or a failed Session Step to a safe outcome either.

**Approach:** Run every addendum H check not already checked per Observation when the last Work Item completes, record each outcome and diagnostic as a Timeline event, and map failures, limit exhaustion and Session Step failures to the honest outcome: Inconclusive where Evidence falls short, Run Failed where execution or integrity failed.

## Boundaries & Constraints

**Always:** Run every addendum H row not already covered per Observation: population acquisition, count reconciliation at file and inclusion level, empty population, per-record coverage, condition completeness, pagination and extraction completeness, schema, mandatory values, duplicate primary keys, ambiguous match, snapshot freshness and Target System freshness. A snapshot whose generation time is before the end of the effective period, after Run initiation, or unknown is `INCONCLUSIVE`. An empty mandatory identifier, a duplicate primary key, an unparseable timestamp and an undeclared schema field each raise their own Gate event. Every check outcome and diagnostic is a Timeline event, and a failure moves the Run to `INCONCLUSIVE` with the Result naming the affected systems, checks, Work Items and records. Run-level Step Execution, time or token exhaustion stops the Run `INCONCLUSIVE` with partial Evidence preserved. A Session Step failure after bounded retries, a denied action, or a during-Run integrity mismatch ends the Run `RUN_FAILED`, and a denied action or scope violation is additionally logged as a security event. Per the owner's 2026-09-05 decision, an adapter Work Item that exhausts its first bounded retry cycle automatically receives one more bounded cycle with no human Escalation; both cycles obey the frozen retry limit and every attempt counts against the Run limits. A Work Item that fails does not stop the Run, and the coverage check then yields `INCONCLUSIVE`.

**Block If:** An addendum H row cannot be evaluated because the data it needs was never captured by an earlier story.

**Never:** Do not produce `CANCELED` from a timeout; that state is reserved for explicit human cancellation. Do not let a Gate failure be repaired by re-running a check. Do not seal a Result (3.9).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| All checks pass | Complete, reconciled, fresh Evidence | Gate passes; the Run may proceed to sealing | None |
| Count mismatch | Declared count differs from acquired rows | That row fails with its diagnostic; Run `INCONCLUSIVE` | Timeline event per check |
| Stale snapshot | Generation before period end, after initiation, or unknown | `INCONCLUSIVE` | Named diagnostic |
| Coverage gap | A Work Item FAILED, records uninspected | Run continues, coverage check yields `INCONCLUSIVE` | Never stops the Run |
| Adapter retry cycles | First bounded cycle exhausted | One more bounded cycle automatically, then `FAILED` | No human Escalation |
| Limit exhaustion | Step Execution, time or token limit reached | Run stops `INCONCLUSIVE`, partial Evidence preserved | Safe stop |
| Session Step failure | Failure after bounded retries, or a denied action | `RUN_FAILED`; a denied action also logged as a security event | Terminal |
| In-Run integrity mismatch | Stored bytes disagree with a recorded digest | `RUN_FAILED` | Bytes untouched |

</intent-contract>

## Code Map

- Addendum H in `_bmad-output/planning-artifacts/prds/prd-IntelliFin Audit-2026-08-31/addendum.md` — the authoritative check list. Every row not already checked per Observation runs here. Transcribe it; do not invent or drop a row.
- `packages/domain/src/runs/observation.ts` — the six per-Observation checks Story 3.4 landed, and the coverage vocabulary. Run-level checks are the complement of these, not a second copy.
- `packages/application/src/runs/register-observations.ts` and `execute-adapter-steps.ts` — where per-Observation checks are recorded today, and the checkpoint that carries attempts, the lease and the frozen limits.
- `packages/domain/src/procedures/executable-plan.ts` — `EXECUTABLE_PLAN_LIMITS`: `retriesPerStep: 3`, `stepTimeoutSeconds: 120`, `runStepExecutions: 10000`, `runTimeoutSeconds: 3600`, `runTokens: 1000000`. These are frozen contract values; read them from the plan, never restate them.
- `packages/application/src/runs/acquire-population.ts` — the existing `run-time-limit` mapping to INCONCLUSIVE and `attempt-limit` to RUN_FAILED, and the population checks Story 3.2 already records. The Run-level Gate consumes those results rather than re-running them.
- `packages/application/src/runs/seal-package.ts` — `sealIfTerminal`, which must run on every terminal transition this story causes.
- `packages/domain/src/runs/evidence.ts` — the seal decision and the abandonment list the Result reports.
- `packages/infrastructure/drizzle/0019_*.sql` through `0023_*.sql` and `packages/infrastructure/src/db/schema.ts` — `run_session_step`, `run_work_item`, `run_step_execution` with their state CHECKs. A generation 24 migration stores the Run-level Gate rows; raise `SUPPORTED_SCHEMA_MIN`/`MAX` together and list any new table in `tests/integration/schema-compat.test.ts`.
- `_bmad-output/implementation-artifacts/epic-3-context.md` "Owner decision — 2026-09-05" — the adapter retry exception: one extra bounded cycle, then FAILED, no human Escalation. This supersedes the general Escalation wording for this path only.

## Tasks & Acceptance

**Execution:**
- `packages/domain/src/runs/gate.ts` (new) — the addendum H row vocabulary, each row's diagnostic, and the pure decision mapping a set of check outcomes to INCONCLUSIVE or a pass. No I/O.
- `packages/domain/src/runs/limits.ts` (new) — the safe mapping: Step Execution, time or token exhaustion to INCONCLUSIVE with partial Evidence preserved; Session Step failure after bounded retries, a denied action, or an in-Run integrity mismatch to RUN_FAILED. CANCELED is never produced here.
- `packages/application/src/runs/run-gate.ts` (new) — run every Run-level row when the last Work Item completes, record each outcome and diagnostic as a Timeline event, and take the terminal transition atomically with the seal.
- `packages/application/src/runs/execute-adapter-steps.ts` — the owner's second bounded retry cycle for an adapter Work Item, then FAILED, with the Run continuing.
- `packages/infrastructure/` generation 24, schema, `db/compat.ts`, `tests/integration/schema-compat.test.ts` — Gate rows with CHECKs pinning the row vocabulary and outcome.
- Tests — domain tests for every addendum H row and every limit mapping; integration coverage of each matrix row including a forced Session Step failure, a denied action, and limit exhaustion; and a test proving a failed Work Item does not stop the Run.

**Acceptance Criteria:**
- Given the last Work Item completes, when the Run-level Gate runs, then every addendum H row not already checked per Observation is evaluated and each outcome and diagnostic is a Timeline event.
- Given any Gate row fails, when it is recorded, then the Run moves to INCONCLUSIVE and the Result names the affected systems, checks, Work Items and records.
- Given a snapshot generated before the end of the effective period, after Run initiation, or at an unknown time, when freshness is checked, then the Run is INCONCLUSIVE.
- Given Step Execution, time or token exhaustion, when the limit is reached, then the Run stops INCONCLUSIVE with partial Evidence preserved, and never CANCELED.
- Given a Session Step failure after bounded retries, a denied action, or an in-Run integrity mismatch, when it occurs, then the Run ends RUN_FAILED and a denied action is also logged as a security event.
- Given an adapter Work Item that exhausts its first bounded retry cycle, when execution continues, then it receives exactly one more bounded cycle, then FAILED, the Run continues, and coverage later yields INCONCLUSIVE.

## Spec Change Log

## Review Triage Log

## Verification

**Commands:**
- `pnpm typecheck`, `pnpm boundaries`, `pnpm test` (alone) — expected: pass.
- `pnpm db:migrate` then `pnpm test:integration` — expected: the new generation applied, all pass against PostgreSQL 18 on a `test`- or `ci`-named database.
- `pnpm db:generate` — expected: no drift.
- `pnpm build`, `pnpm --filter @intellifin/web build`, `pnpm test:e2e` — expected: pass, no accessibility violations.
