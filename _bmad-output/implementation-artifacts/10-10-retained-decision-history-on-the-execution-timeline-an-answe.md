---
title: 'Retained decision history on the Execution Timeline: an answered Escalation and a superseded pause are inspectable entries'
type: 'fix'
created: '2026-09-25'
status: 'ready-for-dev'
review_loop_iteration: 0
implementation_authorised: false
context:
  - '_bmad-output/implementation-artifacts/legacy-review-closure-register.md'
  - '_bmad-output/planning-artifacts/epics.md'
  - 'docs/contracts/durable-escalation-v1.md'
  - 'docs/contracts/run-pause-v1.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Legacy Stories 4.8 (AC 4) and 5.6 (AC 3) say that an answered or aborted Escalation
"becomes a Timeline entry", and Story 5.4 (AC 3) says a superseded pause is "recorded as superseded
on the Timeline". The closure register (Story 10.1) found that the Execution Timeline tab renders
no Escalation row and no superseded-pause row; only the chain events exist
(`execution.escalation-answered`, `lifecycle.pause-superseded`), and Replay lists the Escalation
as a jump target. The owner decided on 2026-09-25 that an event in the audit chain is not a
user-visible history entry: the storage evidence stands as proven, and the missing presentation is
this story's.

**Approach:** Add a compact, inspectable entry or link on the Execution Timeline tab for each
completed decision, read from the stored chain and wait rows: the decision, the actor (a name),
the time, and the related Work Item and Step where one exists. No full expanded panel.

## Boundaries & Constraints

**Always:**
- The entry is read from durable records; nothing is inferred by nearest time. A historical
  decision whose related work cannot be established says so.
- Words come from the existing modules (`ESCALATION_KIND_WORDS`, `ActorName`), pinned by tests.
- WCAG 2.1 AA on the changed tab; the entry is reachable by keyboard.

**Ask First:**
- Any new sentence (owner confirms wording before it is built).
- Any change to the Timeline's row hierarchy beyond adding these entries.

**Never:**
- Rewrite, backfill or re-sign a historical audit event.
- Show the question, options or note text as the platform's own prose (untrusted content rules).
- Start before explicit implementation authorisation (story preparation only, 2026-09-25).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Answered Escalation | a closed `run_wait` with `closure_kind = 'answer'` and its `execution.escalation-answered` event | A compact entry: kind, the chosen answer, the actor's name, the time, the Work Item and Step; links to Replay's jump target | N/A |
| Aborted Escalation | `closure_kind = 'answer'`, option `abort`, the Run `CANCELED` | The entry says abort, with actor and time | N/A |
| Superseded pause | `lifecycle.pause-superseded` at the terminal transition | A compact entry: requested by whom, when, and that the Run ended first | N/A |
| Historical record | a decision whose Step cannot be established from durable records | The entry shows the decision and says the related work is not recorded | N/A |

</frozen-after-approval>

## Code Map

- `packages/infrastructure/src/runs/run-detail-repository.ts` (`RunTimelineRead`) -- the Timeline read; add the decision entries
- `apps/web/src/runs/Timeline.tsx`, `apps/web/app/runs/[id]/timeline/page.tsx` -- the tab
- `apps/web/src/design/plain-words.ts` (`ESCALATION_KIND_WORDS`), `apps/web/src/runs/ActorName.tsx` -- the words
- `tests/e2e/escalations.spec.ts`, `tests/e2e/live-escalation.spec.ts`, `tests/e2e/pause-resume.spec.ts` -- journeys that produce the decisions; assert the entries

## Tasks & Acceptance

**Execution:**

- the read and the entries
- tests: integration (the read on PostgreSQL 18), unit (words and branches), browser (each entry, WCAG 2.1 AA)

**Acceptance Criteria:** as `epics.md`, Story 10.10.
