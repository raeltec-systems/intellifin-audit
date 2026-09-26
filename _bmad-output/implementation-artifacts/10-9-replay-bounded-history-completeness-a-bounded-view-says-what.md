---
title: 'Replay bounded-history completeness: a bounded view says what it covers, and the rest stays reachable'
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
  - 'docs/contracts/replay-v1.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The closure register (Story 10.1, Story 5.8 limitation (2)) found that on Replay's
default view the reads of waits, Observation-registration deltas and Exceptions stop at
`REPLAY_PAGE_SIZE` (500) with no total and no "bound" sentence, and the page uses only the first
500 Exceptions. So the Observation count beside a frame can be too low after 500 registration
events, and a jump target beyond the bound is missing with nothing saying so. That affects the
claim that Replay exposes the complete retained Run. The owner decided on 2026-09-25 that this is
residual work; Replay is not redesigned.

**Approach:** Give every bounded read an exact total beside its bounded page (the pattern
`readFrames` and the inspection pages already use), say in words what the view covers, never
present a bounded number as a total, and give the reader a way to the remaining retained material
through pagination, continuation or the existing `?workItem=` inspection path.

## Boundaries & Constraints

**Always:**
- A bounded view says what it covers; a displayed count is either exact or labelled as bounded.
- The remaining retained material is reachable: pagination, continuation or the existing
  inspection path; a jump target beyond the bound is never silently absent.
- Proven with a fixture that exceeds the relevant limits, in a browser, with WCAG 2.1 AA.

**Ask First:**
- Any new sentence (owner confirms wording before it is built).
- Raising `REPLAY_PAGE_SIZE` or `REPLAY_FRAME_LIMIT` instead of presenting the bound.

**Never:**
- Redesign Replay, re-execute an action, or reach a provider.
- Start before explicit implementation authorisation (story preparation only, 2026-09-25).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Under the bound | fewer than 500 of each kind | Unchanged: exact counts, every jump target listed | N/A |
| Over the bound | more than 500 waits, deltas or Exceptions | The view says it is bounded and what it covers; counts are exact or labelled; the rest is reachable | N/A |
| Jump target beyond the bound | an Escalation raised after the 500th delta | Listed as reachable through continuation or the inspection path, never silently absent | N/A |

</frozen-after-approval>

## Approved wording (owner, 2026-09-26)

The owner approved these sentences on 2026-09-26 ("approve all"). They answer this story's Ask
First item for wording. Put each sentence in a words module and pin it with a test that reads it
back. `{shown}` and `{total}` are exact numbers.

- Jump list, Escalations past the bound: "Showing the first {shown} of {total} Escalations."
- Jump list, Exceptions past the bound: "Showing the first {shown} of {total} Exceptions."
- How to reach the rest: "To see one of the rest, open its record in the record review and choose
  Replay."
- The Observation count beside each frame is EXACT: it is read from the database for each frame,
  not counted from a bounded page of registration events. So the existing sentence "{count} had
  been registered when this screen was captured." stays true, and no new sentence is needed.

The owner did not approve raising `REPLAY_PAGE_SIZE` or `REPLAY_FRAME_LIMIT`; they stay as they
are. A sentence this list does not hold is still Ask First.


## Code Map

- `packages/infrastructure/src/runs/run-detail-repository.ts` (`readWaits`, `readObservationDeltas`, `REPLAY_PAGE_SIZE`, `readFrames` for the total-beside-page pattern)
- `apps/web/app/runs/[id]/replay/page.tsx`, `apps/web/src/runs/ReplayViewer.tsx`, `apps/web/src/runs/replay.ts` (`replayJumpTargets`, `resolveFrameWorkItems`)
- `tests/e2e/replay.spec.ts`, `tests/e2e/selected-replay.spec.ts` -- the browser proof; add the over-the-bound fixture

## Tasks & Acceptance

**Execution:**

- exact totals beside the bounded reads, and the "what this covers" presentation
- the continuation or inspection path for the rest
- tests: integration (totals), unit (presentation branches), browser (over-the-bound fixture, WCAG 2.1 AA)

**Acceptance Criteria:** as `epics.md`, Story 10.9.
