---
title: 'Story 3.8: Run the full Evidence Quality Gate and map limit exhaustion to a safe outcome'
type: 'feature'
created: '2026-09-05'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/docs/contracts/observation-registration-v1.md'
  - '{project-root}/docs/contracts/evidence-package-v1.md'
  - '{project-root}/docs/contracts/run-level-gate-v1.md'
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

- 2026-09-05 — The §H row vocabulary is a TRANSCRIPTION and something compares it with the
  addendum: `tests/unit/gate-vocabulary.test.ts` reads the §H table off disk and asserts the
  twenty rows, their order and, per row, whether the diagnostics routed to it can produce
  each state that row's "Failure outcome" cell names. The failure outcome is therefore keyed
  by DIAGNOSTIC rather than by row — §H gives population acquisition and pagination /
  extraction completeness both outcomes, and a table keyed by row cannot express that. The
  whole contract is `docs/contracts/run-level-gate-v1.md`.
- 2026-09-05 — The spec's Always clause names "ambiguous match" and "Target System
  freshness" among the Run-level rows even though both are DECIDED per Observation. Both
  readings are honoured: every §H row is evaluated at Run level, and the six rows Stories
  3.4 and 3.6 decide are ROLLED UP from `run_observation_check` rather than judged a second
  time — which is what the Code Map's "the complement of these, not a second copy" and
  "consumes those results rather than re-running them" mean together.
- 2026-09-05 — Generation 24 adds `population_snapshot.generated_at`. §H's freshness row has
  to name WHICH way a snapshot is unfit — stale, future-dated or unknown — and the stored
  pass/failed boolean beside it can say none of them. This is the one place the Block If
  ("an addendum H row cannot be evaluated because the data it needs was never captured")
  applied; the column captures it now rather than deferring the row. Nullable and NOT
  backfilled: an older row reads as "unknown", which §H makes `INCONCLUSIVE`.
- 2026-09-05 — `PopulationAcquisitionError` gained `'denied'` and `'scope'`, and the HTTP
  adapter maps a 401/403 to the first and a redirect to the second. Without them a denial was
  `!response.ok` — a transport failure, retried three times against a system that would go on
  refusing, with nothing in the chain saying the platform had been told no. §E.1 requires a
  security event and `RUN_FAILED` for exactly this, so it had to be distinguishable.
- 2026-09-05 — A Run-level Session Step gets ONE bounded retry cycle, not the owner's two.
  The owner's second cycle exists to let a Run CONTINUE past a failed unit; §E maps a Session
  Step's failure after bounded retries to `RUN_FAILED`, so a second cycle there buys nothing
  and would only spend the Run's limits.

- 2026-09-05 — The §H unnamed-value row matches §B's own diagnostic sentence, `rule does not
  name value <v>`, and NOT `missing or invalid Observation field <x>`. The two are different
  defects on different rows: a value the condition met and does not name, versus a value it
  names and could not read. Matching the second put every `ambiguous` record on the
  unnamed-value row as well, because an `ambiguous` match has no boolean reading of `found`
  — and only the real golden P-2 journey in `tests/e2e/population.spec.ts` showed it.

## Review Triage Log

## Verification

**Commands:**
- `pnpm typecheck`, `pnpm boundaries`, `pnpm test` (alone) — expected: pass.
- `pnpm db:migrate` then `pnpm test:integration` — expected: the new generation applied, all pass against PostgreSQL 18 on a `test`- or `ci`-named database.
- `pnpm db:generate` — expected: no drift.
- `pnpm build`, `pnpm --filter @intellifin/web build`, `pnpm test:e2e` — expected: pass, no accessibility violations.

## Auto Run Result

Status: done
Blocking condition: none

**Implemented.** All twenty addendum §H rows are decided when the last Work Item completes,
in the addendum's own order, and every Run that reaches the Gate gets twenty rows whatever
happened: a row that found nothing is a PASS that was actually evaluated, and an absent row
is indistinguishable from one nobody wrote. The whole rule is
`docs/contracts/run-level-gate-v1.md`.

**The Gate cannot be left out.** `AdapterExecutionContext` extends `RunGateContext`, so the
stage that finishes the last Work Item already holds everything the Gate needs and no
composition root can omit or switch it off — the seam Stories 3.6 and 3.7 each removed
rather than leave. The Gate rows, every Timeline event, the terminal Run state and the
Evidence package seal commit in ONE transaction, and generation 21's deferred trigger
refuses a Run reaching a terminal state without a package, so a branch that forgot would
fail to commit rather than ship an unsealed Run.

**A failure outcome belongs to the DIAGNOSTIC, not to the row.** The addendum gives two rows
both outcomes, so a table keyed by row loses half the contract. One failure genuinely lands
on two rows and the addendum says so twice.

**The vocabulary is a transcription, and something compares it with the addendum.**
`tests/unit/gate-vocabulary.test.ts` reads the §H table off disk and asserts the row set,
the order, and per row which states that row's failure column names. The upstream check
names became closed unions the routing tables are typed against, so a check added without a
§H row does not compile.

**Two defects were found and fixed outside the story's own work.** A 401 or 403 was reported
as a transport failure, so a Work Item was retried three times against a system that would go
on refusing and the only durable record that the platform had been told no was a transport
count; it is now `denied`, terminal, with the security event §E.1 requires, and a redirect is
`scope`. And `adapter-execution.test.ts`'s teardown had begun failing silently once
`run_gate_check` gained its foreign key, leaking 140 Runs, 237 bindings and 639 queue jobs
into the shared test database and failing unrelated Story 1.7 and 2.6 tests on counts.

**`CANCELED` is never produced here.** `RUN_STOP_STATES` holds only `INCONCLUSIVE` and
`RUN_FAILED`, and a test walks every stop cause. That state is reserved for a person
cancelling, and the outcome rules read it to decide what a human may do next.

**Mutation-proved**: 19 mutations, each watched failing and then reverted. Two survived and
the dead branches they exposed were removed rather than kept as untestable tests.

**Verification — independently re-run in the main thread against PostgreSQL 18:** typecheck
PASS; boundaries PASS; `db:migrate` schemaVersion 24; unit 2450/2450; integration 303/303;
`db:generate` no drift; both builds PASS; browser + axe 109/109 with zero accessibility
violations. Every number matches what the implementing agent reported.

**Residual risks.** The `run-token-limit` mapping is unit-tested but never exercised: the
adapter path calls no model, so the counter is always 0, and it is wired so the agent epic
fills it rather than adding a limit that was never mapped. Two §H rows — workspace access,
and acquisition-unavailable on extraction completeness — can only fail from a Session Step
failure that already stops the Run before the Gate, so they are transcribed backstops tested
in the domain. The Gate's expected-condition count falls back to zero when the frozen plan
cannot be read, which would pass condition completeness for a Run whose plan was unreadable;
carried into the review-repair task rather than left unnamed.
