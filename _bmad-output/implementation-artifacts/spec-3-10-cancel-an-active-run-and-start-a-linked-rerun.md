---
title: 'Story 3.10: Cancel an active Run and start a linked rerun'
type: 'feature'
created: '2026-09-05'
status: 'ready-for-dev'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/docs/contracts/executable-plan-v1.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** A Run that is stuck, mis-scoped or started by mistake can only be left to
finish. There is no way to stop one, and no way to start a replacement that records why it
exists. FR-26 requires both, and the Run Detail states EXPERIENCE.md specifies for Queued,
Running and Canceled all name a Cancel control that does not exist.

**Approach:** Add one `CancelRun` command that writes a cancellation REQUEST, and let the
owner of the Run's current stage perform the state transition. A `QUEUED` Run has no owner
running, so the web command performs `CANCELED` itself and removes the dispatch job in the
same transaction. A `RUNNING` Run is owned by a worker holding a lease, so the request is
recorded and the worker performs the transition at its next checkpoint boundary — never
mid-unit. Then let any terminal Run be followed by a new linked Run that records its
predecessor and the reason it exists, leaving the predecessor untouched.

## Boundaries & Constraints

**Always:** `CancelRun` is authorized under `run.cancel` and audited whether it is granted
or refused. Cancellation is permitted from every active state — `QUEUED`, `RUNNING`,
`PAUSED`, `AWAITING_AUDITOR` — and the command is written for all four even though Epic 3
produces only the first two. A `QUEUED` Run is transitioned to `CANCELED` by the web
command inside one transaction that also removes its dispatch job, so no worker can pick it
up afterwards. A `RUNNING` Run gets a durable `cancel_requested` marker carrying the
requesting actor, the time and the reason; the worker reads it at its next checkpoint
boundary, stops before starting further Target System work, and performs the `CANCELED`
transition in a checkpoint transaction of its own. Evidence already registered is preserved
exactly as it stands, including a partial artifact, and stays traceable from the Run.
`CANCELED` is reserved for explicit human cancellation and is NEVER produced by a timeout,
a limit, a Gate failure or an execution failure — those produce `INCONCLUSIVE` or
`RUN_FAILED` as Stories 3.8 and 3.3 already decide. A rerun of any terminal Run creates a
NEW Run recording the predecessor Run id and the stated reason, resolving the period owner
afresh the way `initiateRun` does, and the predecessor Run row, its Evidence, its
Observations and its Result are never changed. Every transition and every rerun link
appends a Timeline event with the actor and the reason.

**Block If:** Performing a cancellation at a checkpoint boundary would require abandoning a
transaction that is already partly committed, rather than stopping between units.

**Never:** Do not interrupt a unit of work mid-commit to cancel. Do not produce `CANCELED`
from a timeout, a limit, a Gate failure or an execution failure. Do not mutate the
predecessor Run in any way when a rerun is created. Do not delete or truncate Evidence on
cancellation. Do not add a Pause or Resume control, an Escalation, or a Live View: those
are Epic 5. Do not let the web make an outbound Target System call to stop anything (AD-10);
the worker owns stopping its own work.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Cancel a queued Run | `QUEUED` | Web transitions to `CANCELED` and removes the dispatch job in one transaction | Atomic; no worker pickup afterwards |
| Cancel a running Run | `RUNNING` | `cancel_requested` recorded; the worker transitions at its next checkpoint boundary | Never mid-unit |
| Cancel refused | Terminal Run, or a role without `run.cancel` | Refused with the stated reason; nothing changes | Denial audited |
| Race: cancel meets dispatch | Cancel commits as the worker claims the Run | Exactly one of the two wins; the loser sees the committed state and stops | Claim-then-recheck |
| Duplicate cancel | Cancel requested twice | One `cancel_requested`, one `CANCELED`, one event | Idempotent |
| Evidence on cancel | Artifacts already registered, one partial | All preserved and traceable, partial marked as partial | Never removed |
| Limit exhausted | A frozen limit exhausted mid-Run | `INCONCLUSIVE`, never `CANCELED` | Reserved state |
| Rerun | Any terminal Run | New linked Run recording predecessor and reason; owner resolved afresh | Predecessor unchanged |
| Rerun of an active Run | `QUEUED`/`RUNNING` | Refused with a stated reason | No state change |
| Rerun when another Run is active for the period | An active Run exists for that Procedure and period | Refused with the existing Run named | Same rule as initiation |
| Rerun after the version retired | Period owner is no longer `ACTIVE` | Refused with the initiation refusal sentence | Never a stale owner |

</intent-contract>

## Code Map

- `packages/domain/src/runs/run.ts` — `RUN_STATES` already carries the whole vocabulary
  including `PAUSED`, `AWAITING_AUDITOR` and `CANCELED`; `RunRecord` and `periodOwner` are
  here. Add the ACTIVE-state predicate and the permitted-cancel transition table as DATA
  beside the states, the way `packages/domain/src/procedures/` holds its transitions. The
  domain owns which states may be cancelled; no caller restates it.
- `packages/application/src/runs/initiate-run.ts` — the shape every Run-creating command
  follows: `authorizeCommandRole` first, then the request-token idempotency check, then
  `findActive`, then `findPeriodOwner`, then insert, then `dispatch.enqueue`, then the audit
  event, then `notifyTimeline`. The rerun command is this command with a predecessor. Reuse
  it rather than writing a second creation path; `NO_RUN_OWNER` is the refusal sentence.
- `packages/application/src/runs/ports.ts` — `RunsUnitOfWorkContext` with `runs`,
  `procedures`, `dispatch`, `authorizationRoles`, `auditEvents` and `notifyTimeline`. Add
  the cancellation writer and the dispatch removal here.
- `packages/infrastructure/src/runs/run-repository.ts` — `DrizzleRunRepository` with
  `findRun`, `insert` (its `onConflictDoNothing` over the active-state predicate),
  `findActive`, `bindRequest`, `findRequest`. The cancel transition and the rerun link are
  written here; keep the active-state list in ONE place rather than retyping the `inArray`.
- `packages/infrastructure/src/runs/runs-unit-of-work.ts` and `population-queue.ts` —
  `RUNS_QUEUE`, `startPopulationWorker`, `startPopulationRecovery`. Removing the dispatch
  job for a queued Run goes through pg-boss on the SAME transaction handle
  (`fromDrizzle(transaction, sql)`), exactly as `send` does today; CLAUDE.md records why a
  producer that uses the pool for one call can escape the transaction.
- `packages/application/src/runs/acquire-population.ts` and `execute-adapter-steps.ts` —
  the two worker stages. Each already claims, rechecks and commits; the cancellation check
  belongs at the SAME boundary the lease is renewed, before the next unit starts, and must
  use the state the claim transaction just read rather than a second pool read.
- `packages/application/src/runs/execution-ports.ts` — `PopulationCheckpoint` and
  `AdapterExecutionCheckpoint` carry `revision`, `status` and `leaseUntil`. A cancellation
  observed at a boundary drives the checkpoint to `TERMINAL` and the Run to `CANCELED` in
  one transaction, so the recovery sweep never resumes it.
- `apps/web/app/runs/actions.ts` and `apps/web/app/runs/[id]/page.tsx` — the Server Actions
  and the Run Detail page. A Server Action authorizes for itself FIRST, before it reads any
  input (CLAUDE.md, Story 1.5), and validates shape and bounds at the boundary because its
  argument is untrusted whatever its TypeScript type says.
- `apps/web/src/design/copy.ts` and `apps/web/src/design/ConfirmDialog` — EXPERIENCE.md
  makes cancel and rerun ROUTINE confirmations that restate the consequence. Copy quoted
  from the UX contract lives in `copy.ts` and is pinned by `copy.test.ts` against the
  artifact on disk.
- `packages/domain/src/identity/roles.ts` — the gating table. `run.cancel` is already
  there, and there is deliberately NO `run.rerun`: a rerun starts a new Run, so it is
  gated by `run.initiate`, which the same two roles hold. The table is transcribed from
  EXPERIENCE.md character for character and `roles.test.ts` asserts all 24 actions against
  all 3 roles, so adding a synonym would break a completeness claim. Do not add one.
- `packages/infrastructure/drizzle/` — a new generation adds the cancellation-request
  columns and the rerun link. Raise `SUPPORTED_SCHEMA_MIN` and `MAX` together in
  `db/compat.ts` in the SAME commit, hand-append the `schema_meta` insert, and list any new
  table in `tests/integration/schema-compat.test.ts`.
- `tests/integration/population.test.ts` and `tests/integration/` siblings — the
  database-name guard, `seed()` and `dependencies()`. A concurrency test must hold the first
  transaction OPEN and observe the second WAITING; starting two promises proves nothing.

## Tasks & Acceptance

**Execution:**
- `packages/domain/src/runs/run.ts` — the active-state predicate and the permitted-cancel
  transitions as data. Pure, with the table asserted state by state.
- `packages/application/src/runs/cancel-run.ts` (new) — authorize, validate, load, refuse a
  terminal Run, then either transition a queued Run and remove its dispatch job in one
  transaction or record `cancel_requested` for a running one. Audited both ways.
- `packages/application/src/runs/rerun.ts` (new) — or an explicit predecessor parameter on
  the existing initiation path, whichever leaves ONE creation path. Records the predecessor
  and the reason; refuses an active predecessor, an active Run for the period, and a period
  with no `ACTIVE` owner.
- `packages/application/src/runs/acquire-population.ts`, `execute-adapter-steps.ts` — read
  the cancellation request at the existing checkpoint boundary and honour it there.
- `packages/infrastructure/` — the migration, the schema, `db/compat.ts`, the repository
  writes, and the transactional dispatch removal.
- `apps/web/` — the Cancel and Rerun Server Actions with their own authorization and bounds
  checks, and the Run Detail controls each state's row in EXPERIENCE.md specifies.
- Tests — domain tests for the transition table; application tests for atomicity,
  idempotency and the refusals; integration tests for every matrix row against real
  PostgreSQL 18, including the held-open race; browser coverage of the confirmation and the
  preserved Evidence, with axe clean.

**Acceptance Criteria:**
- Given a `QUEUED` Run, when an authorized user cancels it, then the Run is `CANCELED` and
  its dispatch job is gone, both in one transaction, and no worker executes it afterwards.
- Given a `RUNNING` Run, when an authorized user cancels it, then a cancellation request is
  recorded and the worker performs the `CANCELED` transition at its next checkpoint
  boundary, never mid-unit, with Evidence already registered preserved.
- Given a Run that ends because a frozen limit was exhausted, when it terminates, then it is
  `INCONCLUSIVE` and never `CANCELED`.
- Given any terminal Run, when an authorized user reruns it, then a new Run exists recording
  the predecessor and the reason, and the predecessor Run, its Evidence and its Result are
  byte-for-byte unchanged.
- Given a role without the action, when either command is attempted, then it is refused with
  the gating table's sentence and the denial is in the audit chain.

## Spec Change Log

## Review Triage Log

## Design Notes

The split between who performs the transition is the whole design. A `QUEUED` Run has no
process holding it, so the web command can and must finish the job — leaving a
`cancel_requested` on a queued Run would mean the Run is cancelled only if a worker
eventually picks it up, which is exactly backwards. A `RUNNING` Run is held under a lease
by a worker mid-transaction, and the only safe place to stop is the boundary the worker
already commits at. That boundary exists: both stages claim, recheck and commit, and the
lease is renewed there.

The race that matters is cancel-meets-claim. Both sides must read the state inside the
transaction that writes, so one of them loses and sees the committed result. Do not read
the state through the pool and then write in a transaction; that is the same defect the
role rechecks in Stories 1.5 and 2.7 were written to avoid.

`CANCELED` being reserved is a load-bearing statement, not a nicety. Addendum §E and FR-26
both say so, and the Run Detail copy tells the reader who cancelled it and when. A timeout
that wrote `CANCELED` would put a sentence naming an actor on a Run nobody touched.

A rerun is a new Run, not a copy. It resolves the period owner afresh, so a rerun after a
version handover runs the version that now owns the period — which is correct, and is why
the refusal for a period with no `ACTIVE` owner has to be the same sentence initiation uses.

## Verification

**Commands:**
- `pnpm typecheck` — expected: 0 errors.
- `pnpm boundaries` — expected: no violations.
- `pnpm test` — expected: all pass, run alone.
- `pnpm db:migrate` then `pnpm test:integration` — expected: the new generation applied and
  every test passing against real PostgreSQL 18, on a database whose name contains `test`
  or `ci`.
- `pnpm db:generate` — expected: no drift.
- `pnpm build`, `pnpm --filter @intellifin/web build`, `pnpm test:e2e` — expected: pass, no
  accessibility violations.

## Auto Run Result
