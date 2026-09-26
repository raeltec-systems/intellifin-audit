# Pausing and resuming a Run — v1

Story 5.4 (FR-25, AD-16, UX-DR25). Generation 45.

A person may hold a Running Run and start it again later without cancelling it.
Committed work remains recorded. Resume restarts the interrupted Step Execution as a
new attempt from the frozen plan; it does not resume a hidden model conversation or
promise to continue at the next browser action. See the attempt semantics below.

## A pause is a WAIT, and it is not an Escalation

It is stored in `run_wait` under `kind = 'pause'`. Reusing that table is what gives a pause
four mechanisms it would otherwise need copies of:

| Mechanism | What it gives the pause |
| --- | --- |
| `run_wait_one_open` (unique on `run_id` where `closed_at IS NULL`) | A Run waiting on an answer cannot be paused, and a paused Run cannot raise an Escalation. |
| The delayed pg-boss wake at `deadline` | What ends an abandoned pause `INCONCLUSIVE`. |
| `audit_run.revision` compare-and-set | What refuses a resume against a state nobody saw. |
| `recoverableWaits` | What finds a pause whose wake was lost. |

Two copies of any of those would agree on every case anybody tried and diverge on the first
one nobody did.

It is **not** an Escalation, and every reader says which it means:

* No question is asked, and no Audit Manager is notified. Story 5.5's Flag is the control
  that deliberately reaches them.
* The inbox and the bell exclude it **without a kind filter**: their one visibility
  predicate requires `audit_run.state = 'AWAITING_AUDITOR'`, and a pause holds the Run in
  `PAUSED`. The state IS the exclusion, which is stronger than a filter to remember.
* `EscalationWait` is a TYPE. The Escalation panel and `answerEscalation` take one, so a
  pause cannot reach either — it does not compile — and `readOpenEscalation` narrows at the
  read rather than the surface filtering.
* `waitClosureKindFor` derives the closure from the row's own kind, and generation 45's
  `run_wait_closure` CHECK refuses `kind='pause' AND closure_kind='answer'` and
  `kind<>'pause' AND closure_kind='resume'` outright. Three statements of one rule, in the
  order this codebase always uses: the producer cannot ask, the command would not honour
  it, the database refuses to hold it.
* **A Run that ENDS while it is holding a wait withdraws the question** (generation 47).
  `RUN_CANCEL_TRANSITIONS` gives a `PAUSED` and an `AWAITING_AUDITOR` Run to the COMMAND —
  no worker is holding either — so cancelling one performs the terminal transition there
  and then, and before this it left the wait `closed_at` NULL for ever: a row asserting an
  open question about a Run that is over, which then sat in `recoverableWaits`' BOUNDED page
  permanently. `completeRun` withdraws it inside the terminal transaction, and the same
  three statements hold: `withdrawOpenWait` writes the kind and the actor itself so no
  caller can name a person or dress a withdrawal as an answer; generation 47's fifth
  `run_wait_closure` arm pins `closure_kind='withdrawn'` to `actor='run-terminal'` with no
  answer; and `audit_run_no_open_wait`, a DEFERRED constraint trigger beside generations 21
  and 25, refuses a terminal Run that still holds one, so a path that forgets fails to
  commit rather than shipping the row. `execution.wait-withdrawn` records which question
  went — by kind and identity, never its text — because a question vanishing from somebody's
  inbox with nothing in the chain is the shape this codebase keeps finding.

## Who performs the transition

`RUN_PAUSE_TRANSITIONS` has ONE row — `RUNNING → PAUSED`, `performedBy: 'worker'` — and
that is the contract rather than an omission. AD-16 makes a pause take effect *at the next
Tool Action boundary*, which only a Run a worker is executing has: a `QUEUED` Run has no
boundary to reach, and an `AWAITING_AUDITOR` Run is already stopped (EXPERIENCE.md disables
Pause there by name, with the sentence `RUN_PAUSE_REFUSALS.AWAITING` states).

So:

1. `PauseRun` records a durable marker on `audit_run` and appends
   `lifecycle.run-pause-requested`. The Run stays `RUNNING`. **The command never reports
   that the Run is paused** — the worker performs that transition.
2. The stage, at its next boundary and inside the guarded transaction it already commits
   at, sees the marker and calls `performPause`: the Run state, the superseded Step
   Execution, the checkpoint, the wait row, its wake and `lifecycle.run-paused` commit
   together or not at all. A `PAUSED` Run with no wait row would be a Run nothing could
   ever end.
3. `ResumeRun` closes the wait by `resume` under the expected revision, returns the Run to
   `RUNNING` and appends `lifecycle.run-resumed`. Nothing is enqueued: `RUNNING` is what
   every recovery sweep's read requires, so returning the Run to it IS the handover, and a
   second dispatch would race the sweep for one lease.

**`PauseRun` deliberately takes no expected revision and `ResumeRun` does**, which is the
contract and not an omission (examined in the PR 29 review round). A pause records a marker
and performs no transition, so *at the next boundary, whenever that is* is its whole meaning
and the revision the page was rendered at has no bearing on it; a resume performs
`PAUSED → RUNNING` itself and must not run against a state nobody saw. The staleness that
does matter is caught anyway, under the pause command's own row lock: `AWAITING_AUDITOR` is
refused by name and anything that has left `RUNNING` by `runPauseTransition`. A Run still
`RUNNING` at a later revision is exactly the Run the request means to pause.

A cancellation **wins** at every boundary. Ending is stronger than holding, and
`RUN_CANCEL_TRANSITIONS` gives a `PAUSED` Run to the COMMAND — so pausing over a cancelled
Run would leave the request with no worker to honour it.

## The marker means "requested and NOT yet honoured"

Unlike a cancellation marker, which is history and is never cleared, the pause marker is
cleared by the boundary that HONOURS it. That gives it exactly one meaning, and two
consequences follow for free:

* A marker still present at a terminal transition is a request no boundary ever reached, so
  `CompleteRun` appends `lifecycle.pause-superseded` by simply finding one — no state
  comparison, and no way for the two cases to be confused. This is AD-16's "a pause
  requested when no further Tool Action boundary occurs is recorded as superseded on the
  Timeline and the Run proceeds to its terminal state".
* A resume cannot leave a stale marker that re-pauses the Run at the very next boundary.

Who paused a Run, and when, is on the WAIT row (`opened_by`, `opened_at`) — which is what
the Paused banner reads — not on the marker.

## What a resume does to the work in flight

The interrupted attempt is marked `SUPERSEDED` with `superseded_by = 'resume'`; its Tool
Actions stay on the Timeline; the checkpoint goes to `RETRY`; and the stage's recovery
re-claims the Run and starts a NEW attempt from the Work Item's first Tool Action, with the
model re-briefed from the frozen plan and the Work Item and no carried conversation state.

`SUPERSEDED` is a state and not a diagnostic because nothing went wrong: `FAILED` would be
a lie, and leaving the row `RUNNING` would make an interrupted attempt indistinguishable
from a live one.

**The attempt is given back.** A person pausing is not the agent failing, so it does not
spend one of the Work Item's bounded retry cycles — eight pauses would otherwise fail the
item with a diagnostic naming nothing that went wrong. The Run-level `runStepExecutions`
limit still counts the row, because a Step Execution really did start and that count is
`count(*)` over what happened.

**This follows the story spec over EXPERIENCE.md.** EXPERIENCE.md's Flow 3 alternate says
"on resume the agent continues from the next Tool Action"; epics.md Story 5.4 says the
current Step Execution restarts from its first Tool Action as a new attempt. The story spec
is the acceptance criteria and is the safer of the two — a browser page held for thirty
minutes is not the page the agent left, and continuing into it would ground an Observation
in a snapshot nobody re-read. The disagreement is reported to the owner rather than edited
away.

## Where a pause can land

| Stage | Boundary | In flight |
| --- | --- | --- |
| `executeAdapterSteps` | Between units | Nothing; no Step Execution is superseded |
| `executeAgentSteps` | Between Session Steps | Nothing |
| `executeAgentWorkItem` | Every Tool Action boundary | The current Step Execution, superseded |

Population acquisition is deliberately **not** a pause point: a single bounded fetch has no
boundary inside it, so the request simply takes effect at the stage after it. `openPauseWait`
is EXTENDED onto the three stage contexts rather than injected, so a composition root cannot
leave it out.

## Where a pause holds the Run, and which attempt a resume starts (Story 10.6)

Every pause and every resume names its exact plan step and Step Execution attempt from
durable records, read by identity and never paired by time. No event type, column or
migration was added: the facts ride on keys of the events that already exist, and they are
written on NEW events only. A historical event stays as written, and a surface says what it
does not record.

**The pause event (`lifecycle.run-paused`) says where it held the Run.** Every boundary in
the table above passes a required `PauseHold` to `performPause`, and the event records it:

| Key | When | Meaning |
| --- | --- | --- |
| `planStepId` | always | The plan step the Run is held at: the one in flight, or the next one still to run. |
| `heldWorkItemId` | the Work Item stage | The Work Item the Run is held at. |
| `stepExecutionId`, `attempt` | an attempt was in flight | The attempt the pause superseded. |
| `workItemId` | unchanged | Its existing meaning — the in-flight item, or a deferred pause's settled inspection — because the conversation receipts and the interaction receipt guard (generations 55 to 59) read it. |

A pause between units (the sign-in and adapter stages, between Work Items, after a settled
inspection) has no `stepExecutionId`, and the surfaces say that no Step Execution was in
flight. `PauseHold` is REQUIRED on `performPause`, so a boundary cannot forget it — the
lesson of the one mid-item boundary that once passed no in-flight pair.

**The resume is named by the attempt it starts.** A resume performs `PAUSED → RUNNING`
before any attempt exists, so it cannot name one; the stage that later starts the held step
writes `resumedWaitId` on that attempt's own start event (`work-item-attempt-started`,
`reference-attempt-started`, `sign-in-attempt-started`, `public-access-attempt-started`).
`RunPauseContext.readPendingResume` is REQUIRED on every stage context: it answers the Run's
LATEST pause wait when it was closed by a resume, its event recorded a `planStepId`, and no
event already names it. `resumeLinker` reads it once per invocation and links only the FIRST
attempt at the held plan step — and at the held Work Item, when the pause named one. A resume
of a pause that recorded no held step is never linked, because nothing says which attempt it
restarted.

**The reads follow those identities.** `readPauseHistory` (every pause of a Run, in the order
they happened: an exact total and a bounded list of `PAUSE_HISTORY_LIMIT`) and
`readPauseEntry` (one pause, for the Paused banner) join the wait row to its event by wait
id, the event to its Step Execution by id, and a resume to its attempt by the `resumedWaitId`
on the attempt's start event. An older pause is read for what it holds: one honoured
mid-attempt named its Step Execution, whose row gives the plan step and the attempt
exactly; one that named nothing reads as `not-recorded`. The Execution Timeline lists the
pauses ("Pauses and resumes"), and the Paused banner says where the pause holds the Run now.
The sentences are proposed wording in `apps/web/src/runs/pause-words.ts`.

## A pause request the Run never honoured, on the Timeline (Story 10.10)

An event in the audit chain is not a history entry a reader can see (owner, 2026-09-25), so a
superseded pause request is an entry titled "Pause request" in "Pauses and resumes" (legacy
5.4 AC 3). It is placed among the pauses by the instant its own record holds — a pause by
when it held the Run, a request by when it was asked for, or, when its record holds no
request time, by when it was recorded as superseded. That orders rows; nothing pairs a
request with a pause, and each pause keeps its ordinal. No event type, column or migration
was added, and no event is rewritten.

`readPauseRequests` (`packages/infrastructure/src/runs/decision-history.ts`) reads the two
events that record a request as superseded, each only from the writer that appends it — the
filter the interaction receipts already apply, so an event dressed as one from any other
writer is not read:

| Event | Writer | What the entry says |
| --- | --- | --- |
| `lifecycle.pause-superseded` | `result-sealer`, `worker`, `failure` | Who asked and when (the event's `requestedBy` and `requestedAt`), and that the Run ended before the pause took effect. |
| `lifecycle.deferred-pause-superseded` | `deferred-pause-coordinator`, `web` or `worker`, `failure` | Who asked (`requestedBy`); when (the `run_deferred_pause` row the event's `commandId` names); the inspection it asked to pause after (that row's Work Item, in this Run, at its plan step); and why: `cancellation` and `run-finalized` say the Run ended first, `immediate-pause` says a request to pause at once replaced it. |

A reason this build does not name, a requester or a time the record does not hold, and an
inspection that does not resolve are each said in words rather than guessed or paired by
time. The read answers an exact total and a bounded list of `PAUSE_REQUEST_LIMIT`, in chain
order. The owner approved "Pause request", "Requested by {name} at {time}." and "The Run ended
before the pause took effect, so its own outcome stands." on 2026-09-26; the other sentences
are proposed wording in `apps/web/src/runs/decision-words.ts`.

## The windows

| Wait kind | Window | Timeout outcome |
| --- | --- | --- |
| Escalation | 4 hours (`AWAITING_AUDITOR_TIMEOUT_MS`) | `INCONCLUSIVE` |
| Pause | 30 minutes (`PAUSED_TIMEOUT_MS`) | `INCONCLUSIVE` |

Both are EXPERIENCE.md's Run-lifecycle row. `waitTimeoutMs(kind)` is the one function that
answers, and the wake's singleton window is the wait's own timeout rather than a constant.

## Generation 45

| Table | Change | Why |
| --- | --- | --- |
| `audit_run` | `pause_requested_at`, `pause_requested_by`, `pause_requested_session` + `audit_run_pause_request` | The request marker, written whole or not at all. |
| `run_step_execution` | `SUPERSEDED` state, `superseded_by` + `run_step_execution_superseded` | An interrupted attempt, and why. Either half alone permits a row that reads as the other. |
| `run_wait` | `pause` kind, `opened_at` (NOT NULL), `opened_by`, `run_wait_opened_by`, kind-aware `run_wait_closure` | The pause itself, who asked for it, and the closure pairing as a database fact. |
| `run_wait` (generation 47) | `withdrawn` closure arm; `audit_run_no_open_wait` deferred constraint trigger | A Run that ends withdraws the question, and cannot commit if it does not. |

`opened_at` is added nullable, backfilled and only then made NOT NULL, because
`ADD COLUMN ... NOT NULL` fails on a populated table. The backfill is EXACT rather than a
guess: every wait the table has ever held is an Escalation created with
`deadline = opened_at + 4 hours`. No DEFAULT is used at any point, so the next producer has
to say when its wait opened rather than silently inheriting `now()`.
