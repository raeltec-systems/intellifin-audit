---
title: 'Story 4.8: Answer an Escalation from Run Detail and notify Audit Managers'
type: 'feature'
created: '2026-09-06'
status: 'in-progress'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
warnings:
  - 'This deployment sends no mail. The email leg is written behind configuration and records an explicit unconfigured delivery outcome rather than silently succeeding. See Design Notes.'
deferred: []
---

<intent-contract>

## Intent

**Problem:** Story 4.7 raises a question and stops the Run. Nobody can answer it. A question
nobody can reach is the same as no question, and a Run stuck four hours from Inconclusive with
its Auditor unaware is worse than one that failed immediately.

**Approach:** The Escalation panel on Run Detail, one command that closes the wait under a lock
with the expected Run revision, and notifications created in the SAME transaction as the state
change. The wait row's shape was decided in 4.7 and is not revisited.

## Boundaries & Constraints

**Always:** Notification records are created in the SAME transaction as the state change, for
the initiating Auditor (or the Procedure author for a scheduled Run) and EVERY Audit Manager,
with idempotent send keys — the Story 2.7 mechanism, whose worker marks delivery by a
conditional update on the unique send key so replay cannot create a second item. Each delivery
OUTCOME is recorded on the Audit Trail. The content names Procedure, Run, Escalation kind and
time remaining, and CONTAINS NO Evidence value, question text or secret — a notification is
delivered to an inbox, which is outside every boundary this platform controls. Closing a wait is
ONE command that locks the wait row, requires it OPEN and requires the expected Run revision; a
second closure attempt fails the precondition. Answering opens a ROUTINE confirmation dialog
(EXPERIENCE.md's weight table), and the optional note is labelled "Recorded, not sent to the
agent" — because it is not.

**Never:** Never let the note reach the agent. Never show a recommendation beside the answer
buttons: the answers are in FR-27's order and the platform expresses no preference, because a
platform that recommends an answer has evaluated the record. Never let an answer submitted after
the deadline succeed — it is refused and the panel says "This Escalation timed out at {time};
the Run is Inconclusive." Never let the wake handler fire on a wait that was already closed: it
is skipped as `superseded`.

**Scope:** Answering, notifying, and the timeout wake. The wait and its job are 4.7's.

## I/O & Edge-Case Matrix

| Input | Expected |
|---|---|
| Run enters `AWAITING_AUDITOR` | Notifications enqueued in that transaction for the Auditor and every Audit Manager |
| An Auditor flags a Run | Same notification path |
| Notification content | Procedure, Run, kind, time remaining. Nothing else. Asserted by a test that refuses any Evidence value in the body |
| The bell | Unread count; one row per Awaiting Auditor or flagged Run; each row opens the Run; empty state reads `No Run is waiting on you.` verbatim |
| An email deep link | The same Run |
| The Escalation panel | Top of EVERY tab while Awaiting Auditor; kind, Step, the inert agent-generated question, supporting Evidence, closed answers in FR-27 order, optional note, countdown |
| Pause while Awaiting Auditor | Disabled, with `A Run waiting on an answer cannot be paused.` verbatim |
| An answer confirmed | Wait closed with `{closed_at, closure_kind, answer_option_id, actor}`; Run resumes; panel becomes a Timeline entry |
| A second closure on the same wait | Refused on the precondition; nothing written |
| A stale Run revision | Refused; reload required |
| *abort* on any kind | Run `CANCELED`, reason `Escalation answer: abort` |
| The wake fires past the deadline, wait still open | Wait closed by timeout; Run `INCONCLUSIVE`; Evidence preserved |
| The wake fires on a closed wait | Skipped as `superseded`. Nothing written |
| An answer after the deadline | Refused; the timeout sentence shown |
| No mail transport configured | The in-app delivery succeeds; the email delivery outcome is recorded `unconfigured` on the Audit Trail. Never recorded as sent |

## Code Map

**New:**
- `packages/application/src/runs/answer-escalation.ts` — the one closing command.
- `packages/infrastructure/src/runs/wait-wake.ts` — the timeout wake handler, its own bounded
  sweep, in the shape `startPopulationRecovery` and the probe runner use.
- `apps/web/src/runs/EscalationPanel.tsx` and the answer Server Action, which authorizes for
  itself before reading input.
- An `EmailNotificationSender` behind configuration, plus the `unconfigured` delivery outcome.

**Modified:**
- `apps/web/src/runs/detail.tsx` — the panel at the top of every tab.
- The Notifications surface and the bell (Story 2.7's) gain the Run rows.

## Tasks & Acceptance

1. **Notifications in the state-change transaction**, to the Auditor (or scheduled-Run author)
   and every Audit Manager, idempotent, with recorded delivery outcomes.
2. **Content containment** — a test that fails if any Evidence value, question text or secret
   can reach a notification body.
3. **The Escalation panel**, with the verbatim copy read from EXPERIENCE.md on disk, per the
   `copy.ts` discipline.
4. **The one closing command**, locked, revision-guarded, idempotent-by-refusal.
5. **The timeout wake**, with `superseded` on an already-closed wait.
6. **abort → `CANCELED`** with the fixed reason, through `performCancellation` — the ONE place a
   Run becomes `CANCELED` (Story 3.10). No second path.

## Design Notes

**The email leg, and why it is written but not claimed.** `NotificationSender` already exists
from Story 2.7 and email is one more implementation of it. What does not exist is a mail
transport: this deployment sends no mail, which is why there are no invite emails and no reset
flow, and why the administrator sets every initial password (recorded as an accepted risk in
Story 1.5). So the email sender is written behind configuration and, with no transport
configured, records the delivery outcome `unconfigured` on the Audit Trail. It never records a
send that did not happen. This follows PR 23's lesson exactly — a duty that cannot run must not
stop the duties that can, and must say by name that it is disabled rather than crashing or
pretending. **Wiring a real transport is an owner decision with a cost, and is named here rather
than taken.**

**Why answering goes through `performCancellation` for abort.** Story 3.10 made it the one place
a Run becomes `CANCELED`, and generation 25's deferred trigger refuses a terminal state without a
Result. A second path here would be a Run nobody can read.

## Verification

- Unit: the closing command's preconditions; `superseded`; the content-containment test.
- Integration: notifications and the state change committing together; a held-open transaction
  proving the second closure fails; the wake against a real queue.
- Browser: the full journey — Escalation raised, notified, answered, Run resumes; and the
  timeout journey. WCAG 2.1 AA, and the panel is a focus-trapping dialog on confirm.
- Mutation: allow a closed wait to be closed again and prove a test fails.

## Auto Run Result

Implementation checkpoint; final Epic4 acceptance remains open. Hosted browser journeys pass at f4892c9 for fresh-authorized Run Detail answers, manager/initiator notification, timeout and closed-option confirmation. PostgreSQL revision, closure and queue races pass; exact notification bell counting has focused regressions. Both hydrated-answer mutations pass in the completed matrix. Email delivery is explicitly unconfigured, never reported sent.

See [engineering report](epic-4-engineering-report.md) and [continuation log](epic-4-engineering-continuation.md) for exact candidate identities, test evidence and blockers. No merge or deployment is claimed.
