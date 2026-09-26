---
title: 'Retained decision history on the Execution Timeline: an answered Escalation and a superseded pause are inspectable entries'
type: 'fix'
created: '2026-09-25'
status: 'in-progress'
review_loop_iteration: 0
implementation_authorised: true
implementation_authorisation: 'Owner, 2026-09-26: "go, new branches OK" (implement 10.6 to 10.10 on new branches); wording approved 2026-09-26 ("approve all")'
baseline_revision: 'e8728b0c874b9f4e8981f07fbc6b707e819f372b'
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

## Approved wording and layout (owner, 2026-09-26)

The owner approved these sentences and this layout on 2026-09-26 ("approve all"). They answer
this story's Ask First items for wording and for the Timeline's row hierarchy. Put each sentence
in a words module and pin it with a test that reads it back. `{name}` comes through `ActorName`;
`{step}` names a step the way Story 10.6's pause entries do (`apps/web/src/runs/pause-words.ts`),
for example: "Inspect the record" for E-000102 on LoanCore.

**Answered Escalations: a new section on the Execution Timeline tab, beside Story 10.6's "Pauses
and resumes" section.**
- Section heading: "Escalation answers"
- Section intro: "Each Escalation a person answered: the answer, who gave it, and when."
- Entry title: the kind, in the existing words (`ESCALATION_KIND_WORDS`): "Choose candidate",
  "Unnamed value", "Retry or skip".
- Who answered: "Answered by {name} at {time}."
- The answer, when it is a candidate: "Answer: chose candidate {n} of {m}."
- The answer, when it is a fixed option: "Answer: {option}." `{option}` is the platform's own
  option words: "Retry", "Skip", "Abort", "Mark the record ambiguous", "Mark the record
  Unevaluated and continue" (the labels of `FIXED_ESCALATION_OPTIONS` in
  `packages/application/src/runs/waits.ts` and of the mark-ambiguous option in
  `packages/application/src/runs/execute-agent-work-item.ts`).
- An abort: "The Run was canceled by this answer."
- Where it was raised: "Raised at {step}."
- A historical record whose step is not recorded: "The step this Escalation was raised at was not
  recorded."
- Link: "Open in Replay"
- The question and the candidate text that the Audit Agent wrote are never shown as the
  platform's words. At most they show in the existing untrusted-content box (`UntrustedText`).

**A pause the Run never reached: a new entry in "Pauses and resumes".**
- Entry title: "Pause request"
- Who asked: "Requested by {name} at {time}."
- What happened: "The Run ended before the pause took effect, so its own outcome stands." (It
  copies the existing cancellation sentence "The Run ended before the cancellation was performed,
  so its own outcome stands.")
- The same entry also covers a superseded "pause after this inspection" request
  (`lifecycle.deferred-pause-superseded`, from the workspace).

A sentence this list does not hold is still Ask First.


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
