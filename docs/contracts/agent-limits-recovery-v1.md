# Agent limits and recovery, version 1

What bounds an agent Run, what a bounded unit is allowed to retry, and what happens when a
worker dies in the middle of one (Epic 4, Stories 4.1 and 4.4–4.6, NFR-8, AD-15, AD-16).
Normative for every stage that claims a Run.

Read with `agent-execution-v1.md` (the loop), `agent-workspace-v1.md` (the browser and its
reaper) and `run-level-gate-v1.md` (what the §H rows mean).

## Purpose

Model and browser work is metered, slow and interruptible. Three things must hold at once:
a Run can never spend more than its Version froze; a transient failure of one unit must not
cost the Run; and a process that dies must leave enough durable state for another process
to finish, without repeating paid work and without inventing a second workspace.

## Vocabulary

| Term | Meaning |
|---|---|
| Frozen limits | `plan.limits`: `runStepExecutions`, `runTimeoutSeconds`, `runTokens`, `stepTimeoutSeconds`, `retriesPerStep`. Compiler-1 values, frozen with the Version |
| Cycle | `attemptsPerCycle(limits)` = `retriesPerStep + 1` attempts |
| Turn ledger | `run_agent_turn`, one row per model call, `(run_id, sequence)` |
| Agent access checkpoint | `run_agent_execution` — the sign-in / public-access phase |
| Agent work checkpoint | `run_agent_work` — the Work Item loop |
| Workspace checkpoint | `run_workspace` — `PROVISIONING`, `OPEN`, `RETRY`, `FAILED`, `RELEASED` |
| Lease | `lease_until` on a checkpoint; a claim past it may be taken over |

## Token accounting

1. **The reservation is committed before any provider I/O.**
   `executeAgentModelTurn` (`execute-agent-model-turn.ts`) writes a `RESERVED`
   `run_agent_turn` row and a checkpoint with the raised `reservedTokens`, and only then
   calls `gateway.propose`.
2. **The reservation is conservative and covers the whole envelope.**
   `agentTurnReservation` = `utf8Bytes(JSON.stringify(envelope)).length` (one input token
   per UTF-8 byte) + `max(primary.maxOutputTokens, fallback?.maxOutputTokens ?? 0)` + 8192,
   doubled when a fallback identity exists. The envelope is
   `{schemaVersion, phase, objective, retrieved, tools}` plus `evaluation` for that phase —
   "omitting those fields here would under-reserve the Run before I/O".
3. **The check is against reserved AND spent.** `prior.tokens + prior.reservedTokens +
   reserve.total > plan.limits.runTokens` returns `{kind: 'limit'}` and no call is made.
4. **Measured usage replaces the reservation; unknown usage does not become zero.** On
   success, `tokens += response.usage.totalTokens` and `reservedTokens` retains
   `min(reserve.total, reserve.perAttempt * unaccountedProviderAttempts)`. On a gateway
   error, `tokens += known.usage?.totalTokens ?? 0` and the reservation is retained in full
   when `usage === null`.
5. **The limit reads both counters.** `runLimit(...)` in `execute-agent-work-item.ts`
   passes `tokens: checkpoint.tokens + checkpoint.reservedTokens` to `exhaustedRunLimit`.
6. **A turn's `reserved_tokens` can never be edited.** `validate_agent_turn` (migration
   `0034_lethal_romulus.sql`) permits exactly one update, `RESERVED → COMPLETED|FAILED`,
   with `reserved_tokens`, `run_id`, `sequence`, `work_item_id`, `step_execution_id` and
   `snapshot_evidence_id` all unchanged. `run_agent_turn_counts` requires
   `sequence > 0 AND reserved_tokens > 0`.

## Where the Run limits are applied

`exhaustedRunLimit(usage, limits)` (`packages/domain/src/runs/limits.ts`) checks in §E.1's
order — Step Executions, elapsed time, tokens — and reaching a limit is `>=`, not `>`. A
plan this build cannot read still falls back to `EXECUTABLE_PLAN_LIMITS`: "Unbounded is not
one of the answers."

7. **At the claim.** The pending-wait transaction compares `clock.now()` against
   `runStartedAt + runTimeoutSeconds * 1000` and, when past, writes a `TERMINAL` checkpoint
   with `run-time-limit` and calls `runRunLevelGate(..., limitCause: 'run-time-limit')`.
8. **Before every Work Item.** `runLimit(stepExecutions, checkpoint, plan, clock)` in the
   item loop, before `item.attempts += 1` and before the Step Execution is created.
9. **After every paid model turn.** "Provider usage is an observed fact, not an estimate.
   If it exceeded the Run budget, no browser action from that response may execute" — the
   `spentLimit` check runs immediately after `turn.kind === 'completed'`, and again after
   the evaluation-phase turn inside `finishObservation`.
10. **At the commit boundary, under the Run lock.** `stopAtFinalLimit(context)` runs INSIDE
    the guarded transaction that registers Observations and inside the final completion
    transaction: "capture/model I/O and lock acquisition can consume the remaining budget
    even when the action began within the approved limit". A limit found there rolls the
    registration back rather than sealing it.
11. **Exhaustion still records the shared quality Gate.** Every limit path calls
    `runRunLevelGate(context, {run, plan, decidedAt, limitCause})` rather than
    `completeRun` directly, so the twenty §H rows are written truthfully.
    `gateTerminalState(decision, limitCause)` returns `decision.state` when that is
    `RUN_FAILED` or when there is no limit cause, and otherwise
    `runStopFor(limitCause).state` — so passing quality checks cannot repair an exhausted
    budget into `COMPLETED`, and an independent execution failure is not overwritten by a
    limit. A recorded Result already present wins on replay (`result?.runState`).
12. **A cancellation observed at the same boundary beats the limit.**
    `cancellationBoundary()` runs before the limit computation at each item and before each
    action; `performCancellation` then owns the terminal transition.
13. **`CANCELED` is never produced by a limit.** `runStopFor` maps every
    `RunLimitCause` to `INCONCLUSIVE`; `run-step-execution-limit`, `run-time-limit` and
    `run-token-limit` are the whole vocabulary.
14. **Partial Evidence survives every stop.** `preservesPartialEvidence(cause)` returns
    `true` for every `RunStopCause`, "not a flag a caller could set": the package is sealed
    by `SealPackage` at every terminal transition and a `REGISTERED` artifact is never
    demoted.

## Bounded retry for one unit

`attemptsPerCycle = retriesPerStep + 1`. `ADAPTER_RETRY_CYCLES = 2` and
`SESSION_STEP_RETRY_CYCLES = 1`, so `adapterAttemptBudget = attemptsPerCycle * 2` and
`sessionStepAttemptBudget = attemptsPerCycle * 1`. A Run-level Session Step gets one cycle
"because §E maps its failure to `RUN_FAILED` rather than to a coverage gap".

`persistRetry` (`execute-agent-work-item.ts`) implements the Work Item budget:

| Condition | Item state | Effect |
|---|---|---|
| `attempts >= attemptsPerCycle * 2`, or the cycle is exhausted and `cycles >= 2` | `FAILED` | Diagnostic recorded, checkpoint stays `EXECUTING`, the loop advances to the next item, `humanDecision` is cleared |
| `attempts % attemptsPerCycle === 0` (a cycle just ended) and `cycles < 2` | `AWAITING` | A `retry-or-skip` wait is raised; see `durable-escalation-v1.md` |
| otherwise | `IN_PROGRESS` | Checkpoint moves to `RETRY`; the invocation returns `{retry: true}` and the next claim resumes after the lease |

15. **A human `Retry` grants exactly one extra cycle, and it is consumed atomically.** The
    claim sets `item.state = 'IN_PROGRESS'`, `item.cycles = Math.min(2, item.cycles + 1)`,
    and commits that with the closed wait in the SAME transaction — "so redelivery cannot
    increment the grant twice".
16. **A second exhaustion is never a third cycle.** `persistWait` refuses a
    `retry-or-skip` wait when `item.cycles >= 2`: the item goes `FAILED` with its diagnostic
    and the Evidence is preserved — "another answer must not authorize a third cycle".
17. **Typed uncertainty consumes the same bounded cycle as a transport failure.** A model
    response with `uncertainty.kind !== 'none'` goes through `persistWait` with
    `choose-candidate` (when the planner has candidates and the kind is `ambiguous`) or
    `retry-or-skip`, and `persistWait` sets `item.cycles = Math.max(1, item.cycles)` for a
    `retry-or-skip` — so it draws on the same two-cycle budget rather than minting
    unlimited human Retry grants.
18. **A Work Item failure never stops the Run.** The loop continues to the next item; the
    missing coverage is decided by the Run-level Gate, which is what makes such a Run
    `INCONCLUSIVE` rather than `RUN_FAILED`.
19. **Some failures are terminal on the first attempt.** `model-invalid-action` and any
    `terminalSecurityCause` (`browser-denied`, `browser-scope-violation`) call `stopRun`;
    so do `capture-integrity-failed`, `human-decision-refused`, `model-not-configured`,
    `workspace-missing` and `unsupported-frozen-plan`.
20. **The lease is recomputed per attempt and clamped by the Run deadline.**
    `checkpointLease(...)` sets `leaseUntil = min(runStartedAt + runTimeoutSeconds*1000,
    now + stepTimeoutSeconds*1000)`; `budget()` in the loop is
    `min(leaseUntil, runDeadline, now + stepTimeoutMs) - now` and throws
    `BrowserActionError('unavailable')` at zero.

## Workspace provisioning, reattachment and lost claims

`provisionWorkspace` (`provision-workspace.ts`). Provider I/O happens strictly BETWEEN
transactions.

21. **A live provisioning lease is left alone.** The claim returns `null` when
    `prior.status === 'PROVISIONING'` and `leaseUntil` is in the future.
22. **A reattach does not spend the provisioning budget.** `reattaching = prior.status ===
    'OPEN'` carries `attempts` forward unchanged and exempts the row from the limit —
    otherwise "a Run that retried its population three times would arrive here with the
    workspace budget already gone".
23. **Reattach happens FIRST whenever an identity is recorded (AD-16).** `attach`
    returning `null` is expected, not exceptional.
24. **The stale identity is released BEFORE a replacement is made**, so "never a second
    workspace" holds across the failure too.
25. **A failed release of a live identity ENDS the attempt and keeps the identity.** The
    private `StaleReleaseFailed` is thrown, never returned, and carries no `cause`
    (the diagnostic vocabulary is closed and an error message is where an endpoint would
    ride into an immutable event). It records `workspace-release-failed`, is RETRYABLE and
    is deliberately not a `WorkspaceFailureCode`; `...checkpoint` carries `workspaceId` and
    `expiresAt` forward unchanged.
26. **An EXPIRED identity is the one branch where a release failure may be swallowed.**
    Past the provider's hard `expiresAt` the session auto-released itself, so the call is a
    courtesy and a replacement is correct whatever it answered.
27. **A losing claim releases only a handle it created itself.** `if (!committed) { if
    (createdByThisClaim) await deps.browser.release(...) }` — "An attached identity is
    still named by the durable row and may now belong to the winning lease; closing it here
    would revoke that worker's live session."
28. **A worker that cannot operate the recorded provider does not relabel it.** A stored
    `workspaceId` whose `mode` differs from `deps.browser.mode` throws
    `WorkspaceProvisionError('policy')`, which is terminal; `mode` is taken from the prior
    row whenever an identity exists.
29. **`FAILED` rows stay reapable.** `reapableRunIds` selects
    `status IN ('PROVISIONING','OPEN','RETRY','FAILED')` with a non-null `workspace_id` and
    a terminal Run state, ordered by `run_id` with a keyset cursor. `FAILED` is exactly
    where a preserved identity lands when the budget is spent.
30. **`PROVISIONING` is a pending prerequisite, not a missing workspace.**
    `PostgresAgentWorkRepository`'s context sets `prerequisitesReady` false while the
    workspace is `PROVISIONING` or `RETRY`, and the claim returns `null` rather than writing
    `workspace-missing`: "A genuinely absent row still reaches the application's existing
    missing-workspace protection."
31. **A confirmed replacement forces the access phase to run again.**
    `provisionWorkspace` returns `workspaceReplaced: true` only after a durable identity was
    released or had expired AND the replacement was committed; `main.ts` passes it to
    `signIn(job, workspaceReplaced)` as `forceReauthentication`.
32. **A workspace is released only once the Run can no longer act.** `releaseWorkspace`
    returns `null` while `run.state` is `QUEUED`, `RUNNING`, `PAUSED` or `AWAITING_AUDITOR`;
    an unexpired identity whose release throws keeps its `workspaceId` on the row so the
    reaper can retry.

## Recovery sweeps

Four `startPopulationRecovery` sweeps are installed in `apps/worker/src/main.ts` (population,
adapter, agent access, agent work), each on its own `recoverableRunIds` read, each bounded
to at most 100 Runs per tick, ordered by `audit_run.initiated_at`. Shutdown chains them:
`stopWorkRecovery → stopAgentRecovery → stopAdapterRecovery → stopPopulation`.

33. **A stage retry is never propagated to the queue.** A redelivery re-verifies the
    population Evidence and can consume one of that stage's four durable attempts, so the
    agent phases keep their own checkpoints and their own sweeps.
34. **Each sweep excludes a live lease and includes an interrupted reattachment.** Both
    agent reads require `audit_run.state = 'RUNNING'` and
    `run_workspace.status IN ('OPEN','RETRY') OR (status='PROVISIONING' AND lease_until <= now())`.
    The access sweep additionally requires `population_execution.status =
    'POPULATION_READY'` and the agent execution row to be absent, `RETRY`, or `EXECUTING`
    with an elapsed lease. The work sweep additionally requires
    `run_agent_execution.status = 'SIGNED_IN'`, `run_execution.status =
    'EXTRACTION_COMPLETE'`, and the work row to be absent, `RETRY`, or
    `EXECUTING`/`WAITING` with an elapsed lease.
35. **Recovery re-provisions before doing anything else.** `recover` in `main.ts` calls
    `provisionWorkspace`, then `signIn` with the replacement flag, then
    `executeAdapterSteps`, then `inspect` — "A durable sign-in checkpoint cannot
    authenticate a replacement browser."
36. **A pending wait handoff is completed before a claim is taken.** The first transaction
    of `executeAgentWorkItem` finds `status === 'WAITING'` with `waitId === null` and a
    non-null `pendingWait`, and raises the escalation without repeating browser or model
    work.
37. **Every durable write rechecks the claim.** `guarded(...)` requires the checkpoint
    revision to match, the status to be `EXECUTING` and the Run to be `RUNNING`; a `false`
    is a lost claim (`lost-claim`) and nothing is written.

## Terminal versus retryable

| Kind | Terminal | Retryable |
|---|---|---|
| Workspace provisioning (`TERMINAL_CODES`) | `entitlement`, `refused`, `policy`, and any code outside the union (`terminalCode` fails closed) | `unavailable`, `capacity` |
| Workspace release of a live identity | — | always, under the same attempt budget |
| Model gateway (`RETRYABLE_AGENT_MODEL_ERRORS`) | `configuration`, `invalid-request`, `invalid-response`, `canceled`, `provider-refused` | `unavailable`, `timeout` |
| Work Item | gate denials, capture integrity, refused human decision, unsupported plan | transport, contract, model-unavailable/timeout/invalid-response, registration refusal |
| Run limits | always terminal for the Run (`INCONCLUSIVE`) | — |

## What is deliberately NOT guaranteed

- **A provider session created before its identity is committed cannot be released by
  anything here.** `releaseWorkspace` closes such a row so the reaper stops selecting it,
  and says so: "nothing on this side can release a session it cannot name." The window is
  bounded by the provider's own grace timer.
- **Token accounting is conservative, not exact.** Attempts whose usage a provider did not
  report are charged as reservation.
- **`stepTimeoutSeconds` is a per-attempt clamp, not a hard interrupt.** A provider call is
  bounded by `AbortController`; what a remote browser does after an abort is the provider's.
- **A Run resumed after its deadline is stopped, not extended.** There is no path that
  restarts `runStartedAt`; it comes from `population_execution.started_at` on the first
  claim.
- **Reattach across a worker RESTART is impossible with the pinned Solari SDK** — see
  `agent-workspace-v1.md`. The honest path is release, recreate,
  `workspace-reattach-failed`, and a forced re-authentication.

## Where it is enforced

| Behaviour | Location |
|---|---|
| Limit vocabulary, order, budgets, evidence preservation | `packages/domain/src/runs/limits.ts` — `exhaustedRunLimit`, `attemptsPerCycle`, `adapterAttemptBudget`, `sessionStepAttemptBudget`, `runStopFor`, `preservesPartialEvidence` |
| Reservation and durable turn | `packages/application/src/runs/execute-agent-model-turn.ts` — `agentTurnReservation`, `executeAgentModelTurn` |
| Claim, per-item limits, commit-boundary recheck, retry and cycle policy | `packages/application/src/runs/execute-agent-work-item.ts` — `runLimit`, `checkpointLease`, `stopAtFinalLimit`, `persistRetry`, `persistWait`, `guarded` |
| Limit cause reaching the §H rows | `packages/application/src/runs/run-gate.ts` — `runRunLevelGate`, `gateTerminalState` |
| Provisioning, reattachment, stale release, lost claim | `packages/application/src/runs/provision-workspace.ts` — `provisionWorkspace`, `releaseWorkspace`, `StaleReleaseFailed`, `TERMINAL_CODES`, `terminalCode` |
| Recovery reads | `packages/infrastructure/src/runs/agent-execution-repository.ts` and `agent-work-repository.ts` — `recoverableRunIds`; `workspace-repository.ts` — `reapableRunIds` |
| Pending-prerequisite deferral | `agent-work-repository.ts` — `prerequisitesReady` |
| Sweep wiring and shutdown order | `apps/worker/src/main.ts` |
| Turn immutability, reserved-token immutability, checkpoint status vocabulary | `packages/infrastructure/drizzle/0034_lethal_romulus.sql` — `validate_agent_turn`, `run_agent_turn_counts`, `run_agent_work_status`, `run_agent_work_counts` |
