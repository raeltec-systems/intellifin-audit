# Durable Escalation, version 1

The typed human-in-the-loop wait: how an agent asks, how a person answers, what happens
when nobody does, and what the agent is allowed to learn from the answer (Epic 4, Story
4.7, FR-27, AD-16). Normative for every producer that stops for a human.

Read with `agent-execution-v1.md` (what raises a wait) and `agent-limits-recovery-v1.md`
(the retry cycle a `Retry` answer grants).

## Purpose

An agent that cannot proceed must stop and ask, rather than guess. The question is a KIND
with a closed answer set the platform owns; the answer that comes back is an option ID and
nothing else. A wait is durable, is bounded by its own deadline independently of the Run
timeout, and can be closed exactly once.

## Vocabulary

| Term | Meaning |
|---|---|
| Kind | `ESCALATION_KINDS` (`packages/application/src/runs/escalation-kind.ts`): `choose-candidate`, `unnamed-value`, `retry-or-skip`. A dependency-free leaf, so wait commands and notification ports can both import it without a cycle |
| Wait | One `run_wait` row: `wait_id`, `run_id`, `kind`, `options`, `deadline`, and the four closure columns |
| Closure kind | `WAIT_CLOSURE_KINDS` = `answer`, `timeout` |
| Option | `{id, label}`. Reserved ids are `ESCALATION_OPTION_IDS`: `mark-ambiguous`, `mark-unevaluated`, `continue`, `abort`, `retry`, `skip` |
| Run revision | `audit_run.revision`, incremented by a trigger on any real row change; the compare-and-set token for every human-in-the-loop command |
| Pending wait | `run_agent_work.pending_wait` — the agent's durable intent, written before the wait exists |

`AWAITING_AUDITOR_TIMEOUT_MS` is 4 hours.

## The closed option vocabulary

`FIXED_ESCALATION_OPTIONS` in `waits.ts`, in user-facing order:

| Kind | Options |
|---|---|
| `unnamed-value` | `mark-unevaluated` ("Mark the record Unevaluated and continue"), `abort` ("Abort") |
| `retry-or-skip` | `retry` ("Retry"), `skip` ("Skip"), `abort` ("Abort") |
| `choose-candidate` | the caller's candidates, then `mark-ambiguous` ("Mark the record ambiguous") — appended by `optionForKind` in `execute-agent-work-item.ts` |

1. **The platform owns the option set for the two fixed kinds.** `normalizeOptions(kind,
   options)` returns `FIXED_ESCALATION_OPTIONS[kind]` for any kind other than
   `choose-candidate` and never looks at what the caller passed — so a fixture-supplied
   label cannot remove the `Abort` safety action.
2. **Candidate options are bounded and cannot impersonate a reserved answer.**
   `normalizeOptions` requires at least two entries, requires the LAST to be exactly
   `mark-ambiguous`, requires every other id to match
   `/^[A-Za-z0-9][A-Za-z0-9:._/-]{0,254}$/`, to be outside
   `RESERVED_ESCALATION_OPTION_IDS`, to be unique, and to carry a non-blank label of at
   most 500 characters. Any deviation refuses the whole raise as `malformed`.
3. **The database pins the kind and requires a non-empty option array.**
   `run_wait_kind` and `run_wait_options` (`jsonb_typeof = 'array' AND
   jsonb_array_length > 0`), migration `0034_lethal_romulus.sql`.

## Raising a wait

`raiseEscalation(dependencies, input)` — one transaction, in `PostgresWaitRepository`.

4. **The input shape is closed.** `validRaiseMetadata` refuses any key outside
   `['runId','kind','options','stepId','supportingEvidenceIds']`, requires `runId` to be a
   UUID and the kind to be a member, bounds `supportingEvidenceIds` at 100 UUIDs, and
   requires `stepId` to match the identifier pattern.
5. **One open wait per Run.** `createWait` refuses when a wait with `closed_at IS NULL`
   already exists, and `run_wait_one_open` is a partial UNIQUE index on `run_id WHERE
   closed_at IS NULL`.
6. **A wait can only be opened on a `RUNNING` Run.** `createWait` returns `not-running`
   otherwise, and the state change is
   `UPDATE audit_run SET state='AWAITING_AUDITOR', revision=revision+1 WHERE state='RUNNING'`
   — a zero-row update throws.
7. **The agent's durable intent is bound to the wait in the same transaction.**
   `createWait` reads `run_agent_work` for a `WAITING` row with `wait_id IS NULL` and a
   non-null `pending_wait`, and updates it only when `pending_wait->>'kind'` and
   `pending_wait->'options'` match the wait exactly; anything but one updated row throws
   `Escalation does not match the durable agent intent`. "The agent may crash immediately
   after this transaction commits."
8. **Everything commits together.** The `run_wait` insert, the `RUNNING →
   AWAITING_AUDITOR` transition, the `execution.escalation-raised` audit event with
   `notifyTimeline`, one `notification` row per recipient, and exactly ONE pg-boss wake job
   are all inside the one transaction opened by `PostgresWaitRepository.transaction`.
9. **Lock order is `audit_run`, then `run_wait`, then the notification chain.**
   `withRunExecutionContext` (`adapter-execution-repository.ts`) takes
   `SELECT ... FROM audit_run ... FOR UPDATE` first; `readWait` selects `run_wait ... FOR
   UPDATE`; notification and audit writes follow.
10. **The wake job is delayed to the deadline, once.** `sendWake` calls `queue.send` with
    `startAfter = deadline`, `singletonKey = 'wait:<waitId>'`,
    `singletonSeconds = AWAITING_AUDITOR_TIMEOUT_MS / 1000`, `retryLimit: 3`,
    `retryDelay: 5`, `expireInSeconds: 180`, on the SAME transaction handle
    (`queueDatabase(tx)`), and throws when `send` returns `null`. The singleton slot is
    "defence in depth"; the open-wait unique index is the authoritative guard.
11. **The raise event carries references, never the question.** `auditWaitPayload` records
    `waitId`, `kind`, `optionIds`, `deadline` and — only when supplied — `stepId` and
    `supportingEvidenceIds`.

## Notifications (generation 35)

12. **Recipients are the Run's initiator plus every current Audit Manager,
    deduplicated.** `escalationNotificationRecipients(current.initiatorId, await new
    DrizzleNotificationRecipientReader(tx).auditManagerIds())`, read on the transaction's
    own connection.
13. **The send key is stable, so a replay cannot double-deliver.**
    `createEscalationNotification` produces `sendKey: 'escalation:<waitId>:<recipientId>'`
    and carries only the safe projection — Procedure id and name, version id and number,
    Run id, wait id, escalation kind and deadline. No question, no Evidence, no value.
14. **A notification must match the wait it claims.** `notification_escalation_binding`
    (migration `0035_curvy_ravenous.sql`) joins `run_wait` to `audit_run` and requires the
    same `wait_id`, `run_id`, `kind`, `deadline`, `procedure_id` and `version_id`.
15. **The escalation columns are all-or-nothing.** `notification_escalation_context`
    requires `run_id`, `wait_id`, `escalation_kind` and `deadline` to be present for kind
    `escalation` and absent for every other kind; `notification_kind` adds `escalation` to
    the closed set.

## Answering

`answerEscalationAction(request)` in `apps/web/app/runs/actions.ts` →
`answerEscalation(dependencies, {session, request})` in `waits.ts`.

16. **The Server Action authorizes for itself, before it reads the input.**
    `requireServerAction('escalation.answer')` is the first statement; only then is the
    request shape validated. A Server Action is its own POST endpoint addressed by an id in
    the client bundle, so reaching the page is not a precondition.
17. **The request shape is closed at both boundaries.** The action's
    `validAnswerEscalationRequest` and the command's `parseAnswerRequest` both refuse any
    key outside `['runId','waitId','expectedRunRevision','answerOptionId','note']`, require
    UUIDs, a safe non-negative integer revision, an option id matching the identifier
    pattern, and a `note` that is `null` or 1–500 non-blank characters.
18. **The role is re-read INSIDE the transaction.** `context.authorizationRoles.findRole`
    then `authorizeAction(role, 'escalation.answer')`; a revocation between the outer check
    and the lock throws the private `Revoked`, which rolls the transaction back and records
    the denial through `recordAuthorizationDenial` outside it. A refusal returned from
    inside a unit of work would commit.
19. **The answer must be one of the wait's own options.** `wait.options.find(...)` →
    `invalid-option`. The stored option set is what is checked, not a copy.
20. **Closure is compare-and-set on the Run revision.** `closeWait({expectedRunRevision,
    ...})`; `stale-revision` returns "This Run changed while you were answering. Reload the
    Run."
21. **A wait closes exactly once, and its question is immutable.**
    `run_wait_close_once` (migration `0034_lethal_romulus.sql`) raises on any update to a
    row whose `closed_at` is already set, on any change to `wait_id`, `run_id`, `kind`,
    `options` or `deadline`, and on an update that leaves `closed_at` NULL.
    `run_wait_closure` pins the four closure columns: all NULL; or `answer` with an option
    id and an actor; or `timeout` with no option id and actor exactly `wait-wake`.
22. **A replayed answer observes the durable closure and says which happened.**
    `closeWait` reads the addressed row even after the Run left `AWAITING_AUDITOR`;
    `superseded` becomes `timed-out` (with the recorded time substituted into the sentence)
    when `closureKind === 'timeout'`, and `closed` otherwise.
23. **`abort` closes the wait and then cancels through the one cancellation path.**
    `stateAfterClose` is `AWAITING_AUDITOR` for `abort` and `RUNNING` for every other
    answer; the command then calls `context.requestCancellation(...)` and
    `performCancellation(...)` with reason `Escalation answer: abort`, so `CANCELED` is
    still performed by the single transition owner.
24. **The answer is audited as a human act.** `execution.escalation-answered`, actor
    `{type: 'human', id: session.userId}`, source `web`, payload `waitId`, `kind`,
    `answerOptionId`, `closureKind: 'answer'`, `priorState`, `state`, `occurredAt`, and
    `recordedNote` only when a note was given. The note is a command-side audit field and
    is never sent to an agent.
25. **A successful answer invalidates every Run Detail route.** The action revalidates
    `/runs/<id>` plus `/evidence`, `/exceptions`, `/review`, `/timeline`, and
    `/notifications`, "so a refresh cannot retain an open panel on a sibling tab".

## Timing out

`wakeEscalation(dependencies, job)` — the worker side, `startWaitWorker` and
`startWaitRecovery` in `apps/worker/src/main.ts`.

26. **The job is not trusted beyond its identity.** `parseWaitJob` requires exactly three
    keys, `schemaVersion === 1`, and two UUIDs; everything else is read from the wait row
    under the Run lock.
27. **A wait already answered is `superseded` and a wait not yet due is `early`.**
    `timeoutWait` returns those outcomes and nothing is written.
28. **A timeout seals through `completeRun`.** `timeoutWait` moves the Run under the same
    lock, the `execution.escalation-timeout` event is appended (actor `escalation-wake`,
    outcome `failure`, `state: 'INCONCLUSIVE'`), and then `completeRun(context, {run,
    state: 'INCONCLUSIVE', at, plan})` — "CompleteRun owns the terminal Result and Evidence
    seal and therefore remains the sole sealing path."
29. **A lost wake job is recoverable.** `recoverableWaits(limit)` is the sweep's own read;
    `run_wait_deadline` is a partial index on `deadline WHERE closed_at IS NULL`.

## How the worker resumes

30. **The closed wait is carried by ID, not rediscovered.** The claim in
    `executeAgentWorkItem` requires `closedWait.waitId === current.waitId`,
    `closureKind === 'answer'`, a non-null actor, and an answer that is not `abort`;
    anything else abandons the claim.
31. **At most two other decisions may be retained.**
    `pendingWait.retainedDecisionWaitIds` carries the `choose-candidate` and
    `unnamed-value` decisions across a `retry-or-skip` cycle;
    `retainedBusinessDecisions()` builds that list, and every retained decision must name
    the same `stepId` and include the ORIGINAL capture's `evidenceId` or the Run is stopped
    with `human-decision-refused`.
32. **A `Retry` answer grants one cycle and is consumed with the item in one
    transaction.** See `agent-limits-recovery-v1.md` invariants 15–17.
33. **A `Skip` with no capture is honest absence of coverage, not a fabricated
    Observation.** When no capture binding exists and no supporting Evidence was raised,
    the item becomes `UNINSPECTED` / `insufficient-evidence` and the Gate records the gap.
34. **`mark-unevaluated` suppresses only the unnamed-value preview.**
    `finishObservation` skips the `RULE_DOES_NOT_NAME_VALUE` re-escalation when the closed
    wait (or a retained one) is `unnamed-value` answered `mark-unevaluated`.
35. **A decision is only consumed when the Observation transaction commits.** The
    checkpoint's `waitId`/`pendingWait` are cleared inside the same `guarded` transaction
    that calls `registerObservations`.

## Untrusted question text

36. **Agent-generated text is labelled and never rendered as platform prose.**
    `EscalationDetails.agentQuestion` is the matching turn's bounded uncertainty rationale;
    `EscalationPanel.tsx` renders it through `<UntrustedText field="AGENT-GENERATED
    question">`, and each `choose-candidate` label through
    `<UntrustedText field="AGENT-GENERATED candidate N">`. The `mark-ambiguous` option is
    excluded from that treatment because its label is platform copy.
37. **The details read is scoped to the one open wait under the Run lock.**
    `readEscalationDetails` returns `null` unless the addressed wait is the currently
    loaded one, is open, and belongs to this Run — "This prevents a caller from using the
    metadata port as a historical event search". It names references only: no Evidence
    bytes, no object-store keys, no credentials.

## Failure classification

| Code | Sentence (`ANSWER_ESCALATION_REFUSALS`) |
|---|---|
| `malformed` | `Choose an open Escalation answer.` (also the code for an authorization denial) |
| `unknown` | `That Escalation does not exist.` |
| `closed` | `That Escalation has already been closed.` |
| `stale-revision` | `This Run changed while you were answering. Reload the Run.` |
| `timed-out` | `This Escalation timed out at {time}; the Run is Inconclusive.` |
| `invalid-option` | `Choose one of the available Escalation answers.` |

`RAISE_ESCALATION_REFUSALS` covers the producer side: `malformed`, `runNotRunning`,
`alreadyOpen`, `unsupported`. A thrown error in the Server Action returns
`unknownOutcome: true` with the panel's own sentence, because a lost response is an unknown
outcome and not a proof that nothing happened.

## What is deliberately NOT guaranteed

- **No email is sent.** `notification.email_outcome` exists in the schema; no email
  transport is configured, so the audited outcome is `unconfigured` (see the Story 4.7
  decision note in `CLAUDE.md`).
- **A wait is not a pause on the Run deadline.** `AWAITING_AUDITOR_TIMEOUT_MS` is
  independent of `plan.limits.runTimeoutSeconds`, and the Run's own limit is re-checked at
  the claim after the answer.
- **An answer conveys only its option ID to the agent.** There is no channel by which a
  note, a label or a question becomes model input; the note is stored on the audit event.
- **`continue` is in `ESCALATION_OPTION_IDS` but is not used by any shipped option set.**
  It is reserved so a candidate cannot claim it.
- **A `choose-candidate` label is text a Target System supplied.** It is bounded and
  labelled untrusted; nothing sanitizes its content.

## Where it is enforced

| Behaviour | Location |
|---|---|
| Kind vocabulary (dependency-free leaf) | `packages/application/src/runs/escalation-kind.ts` |
| Option vocabulary, raise, answer, wake | `packages/application/src/runs/waits.ts` — `FIXED_ESCALATION_OPTIONS`, `normalizeOptions`, `raiseEscalation`, `answerEscalation`, `wakeEscalation`, `parseWaitJob`, `candidateMatchDisposition` |
| Candidate option appending | `packages/application/src/runs/execute-agent-work-item.ts` — `optionForKind`, `persistWait`, `retainedBusinessDecisions` |
| Lock order, atomic create, wake job, notification enqueue | `packages/infrastructure/src/runs/wait-repository.ts` — `PostgresWaitRepository.transaction`, `createWait`, `closeWait`, `timeoutWait`, `sendWake`, `readEscalationDetails`, `recoverableWaits`; `adapter-execution-repository.ts` — `withRunExecutionContext` |
| Worker wake and recovery wiring | `apps/worker/src/main.ts` — `startWaitWorker`, `startWaitRecovery` |
| Server Action guards and revalidation | `apps/web/app/runs/actions.ts` — `answerEscalationAction`, `validAnswerEscalationRequest` |
| Untrusted rendering | `apps/web/src/runs/EscalationPanel.tsx`, `apps/web/src/runs/UntrustedText.tsx` |
| Wait table, closure rules, one open wait | `packages/infrastructure/drizzle/0034_lethal_romulus.sql` — `run_wait`, `run_wait_kind`, `run_wait_options`, `run_wait_closure`, `run_wait_one_open`, `run_wait_deadline`, `run_wait_close_once`, `run_revision_transition` |
| Escalation notifications | `packages/infrastructure/drizzle/0035_curvy_ravenous.sql` — `notification_escalation_context`, `notification_kind`, `notification_escalation_binding`; `packages/application/src/notifications/ports.ts` — `createEscalationNotification`, `escalationNotificationRecipients` |
