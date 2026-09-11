# Flagging a Run to the Audit Managers — v1

Story 5.5 (FR-27, FR-28, UX-DR24). Generation 46.

An Auditor watching a Run can ask the Audit Managers to look at it, with an optional note,
without changing what the Run does.

## A flag is not a wait, and it is not an Escalation

| | Escalation (Story 4.7) | Pause (Story 5.4) | Flag |
| --- | --- | --- | --- |
| Raised by | the platform | a person | a person |
| Holds the Run in | `AWAITING_AUDITOR` | `PAUSED` | nothing — the Run keeps running |
| Has a deadline | yes, 4 hours | yes, 30 minutes | **no** |
| Answered | closed answer set | Resume | **never; there is nothing to answer** |
| Notifies Audit Managers | yes | no | **yes — that is its whole purpose** |

So it is stored in its own table, `run_flag`, and NOT in `run_wait`. Every mechanism
`run_wait` gives a pause — the one-open unique index, the delayed wake, the revision
compare-and-set, the recovery sweep — exists to end a Run that is being held. A flag holds
nothing, so all four would be machinery with no meaning, and `run_wait_one_open` would make
flagging a Run mutually exclusive with pausing it, which nothing asks for.

**It has no execution effect at all.** Nothing on the worker's side reads `run_flag`. That
is a property of what the table is reachable from, not a rule to remember: no stage context
carries a flag reader.

## What it stores, and what it deliberately does not

`run_flag` is one row per flag: `flag_id`, `run_id`, `flagged_by`, `session_id`,
`flagged_at`, and a nullable `note` bounded at 500 characters and refused when blank.

* `flagged_by` is `text` with **no foreign key**, exactly as `audit_run.initiator_id` is.
  A foreign key there would make deleting a user fail on a Run's own history, which is the
  trap `notification_recipient_id_auth_user_id_fk` already sets for the browser teardowns.
* The row is **immutable** — `run_flag_immutable` refuses every `UPDATE` — and cascades
  from `audit_run`, the reading that already makes `run_workspace` and `run_exception`
  cascade: removing a whole Run is a different act from rewriting one record of it.
* `flag_id` is **minted**, not derived. Two flags by one person are two flags, which is the
  truth; a derived id would silently merge a second, later note into the first. A lost
  response is handled the way every other control on these surfaces handles one — the
  surface blocks the retry and asks for a reload — rather than by an idempotency token this
  story was not asked to design.

## The note goes in the table, its DIGEST goes in the chain

`lifecycle.run-flagged` carries `flagId`, `runId`, `noteLength` and `noteDigest`, and never
the note itself. The audit chain is immutable, so anything that enters it can never be
taken out, and a note is free text a person types — the same reason Story 2.3's audit
payloads identify Audit Instructions by text digest and length. An auditor who pastes a
credential into a note has put it in a row that can be deleted with its Run, not in a chain
that cannot.

The notification rows carry **no note either**. `EscalationNotification` already says it in
as many words — "there is intentionally no question, evidence value, note or credential
field here" — and a flag notification is the same projection: Procedure, Run, who flagged
it and when. The note is read on the Run, by someone who has already been authorized to
open it.

## Who is notified, and by what path

FR-28 gives ONE recipient rule for both triggers: "the initiating Auditor — or the
Procedure's author for scheduled Runs — and every Audit Manager". `runNotificationRecipients`
is that rule (it was `escalationNotificationRecipients` until this story, and the rename is
the whole change: a shared rule whose name claimed one of its two callers).

The delivery path is unchanged and shared: the same `notification` table, the same worker
loop, the same conditional-update idempotency boundary, and the same two Audit Trail events
per recipient (`notification.in-app-delivery`, `notification.email-delivery`, the second
`unconfigured` because this deployment configures no transport). `RunNotification` is the
union the delivery functions now take; the row's own `kind` decides the `UPDATE` predicate
rather than the literal `'escalation'` that was there before.

## Which states may be flagged

`RUN_FLAG_STATES` is `RUNNING`, `PAUSED`, `AWAITING_AUDITOR` — the three the acceptance
criterion names, and no fourth. A `QUEUED` Run is deliberately excluded: adding it would be
scope taken sideways, and the control is on the surface that watches a session that has
started.

## How long a flag needs attention

**While its Run is active.** A flag has no deadline and no closure of its own, so what stops
it needing attention is the Run ending — and `isActiveRunState` is the predicate that says
so. There is deliberately no "acknowledge" control: EXPERIENCE.md's Notification row names
no such action, and inventing one would be a product decision taken sideways inside a story
about a button.

The consequence is that the inbox and the bell show a flag with no countdown while an
Escalation shows one. That is honest — a fabricated deadline would be a fact nobody
measured — and it is why `OpenNotification` became a union with a `deadline` only on the
arm that has one, rather than a nullable field every reader has to remember to check.

## Where the controls live

* **Flag** is a Live View control only. EXPERIENCE.md's session-viewer row puts it there —
  "Live controls: Pause / Resume, Cancel, Flag to Audit Manager" — and no Run Detail state
  row mentions it.
* **Cancel** is on both, through ONE component (`RunCancelControl`), extracted from
  `RunLifecycleActions` for the reason `RunPauseControls` was: two copies would agree on
  every case anybody tried and diverge on the first one nobody did. Rerun stays on Run
  Detail, because a terminal Run's Live View is a Replay and has nothing to rerun from.
* **Flag has no confirmation dialog**, and that is the contract rather than an omission.
  EXPERIENCE.md's confirmation table enumerates the actions that get one — submit, approve,
  rerun, export, pause, cancel, answer or abort an Escalation, a scope-expanding Target
  Systems save — and flagging is not among them. It is also the one control here that
  therefore *can* honour the standing rule that JavaScript may enhance a control and never
  be its only path: the form's action IS the Server Action, so a browser with no script
  POSTs to it and gets the page back with the flag recorded, and `useActionState` renders
  the same result either way. `flag-run.spec.ts` proves that in a context with
  `javaScriptEnabled: false`. Pause and cancel are exempt from the rule only because the
  dialog they must have cannot exist without script.

## What a flag does to the bell, and where the actor's NAME comes from

The bell counts open waits AND open flags — two counts added, never a join, because a Run
can carry an open wait and a flag at once and a join would report their product — and
`BellLive` re-reads on `lifecycle.run-flagged` as well as on the escalation events and on
the two ways a Run ends (`lifecycle.run-canceled`, and `lifecycle.result-sealed`, which
every terminal transition appends because `completeRun` is the one place a Run ends).

A Run records its actors as user IDs, because an email address cannot enter the audit chain
and a name can change. Printing one at a reader is the platform speaking its own language
at somebody — the defect the plain-words pass removed from the authoring screens — so every
surface that shows an actor resolves it through one port, `ActorNameReader`. It returns
NAMES only, never addresses, and an id with no row comes back absent so the caller shows
the id, which is honest about what it knows.
