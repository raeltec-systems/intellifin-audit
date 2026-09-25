---
title: 'Lost connection and lost acknowledgement: a server refresh is not stream recovery, and a rendering error claims only what it knows'
type: 'fix'
created: '2026-09-25'
status: 'ready-for-dev'
review_loop_iteration: 0
implementation_authorised: false
context:
  - '_bmad-output/implementation-artifacts/legacy-review-closure-register.md'
  - '_bmad-output/planning-artifacts/epics.md'
  - 'docs/contracts/live-view-v1.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Two findings of the closure register (Story 10.1) conflict with accepted behaviour.
(1) Story 5.7: `useLiveTimeline` resets its last-message time whenever its `[url, cursor]` effect
runs, and a server re-read that moves the cursor re-runs it. So a re-read during a drop (for
example `BellLive` refreshing because another Run ended) can show `live` for up to 15 seconds and
reopen the controls for up to 60 seconds while the stream is still disconnected. (2) Story 5.5:
after an action committed and its acknowledgement was lost, the route boundary
(`apps/web/app/error.tsx`) says "Couldn't load this page. Nothing was changed." — an unconditional
claim that the committed-flag case shows false. The owner decided on 2026-09-25 that both are
residual work, not limitations.

**Approach:** Tie the silence clock and the gate to the stream's own signals only. Make the
generic rendering error state only what it knows, and let an action-specific message say that
nothing changed only when its recorded outcome establishes it.

## Boundaries & Constraints

**Always:**
- Only a frame or a heartbeat from the stream itself returns the status to `live` and reopens
  the gate. A server refresh, a cursor change or a remount never does.
- The generic rendering error states only what it knows (candidate wording, owner to confirm:
  "This page could not be loaded. Check the Run's current state before repeating your last
  action."). Reloading the page never resubmits the action.
- The committed-flag case keeps exactly one `run_flag` row and one notification
  (`flag-run.spec.ts`), and the new wording is asserted there.
- Every sentence lives in `copy.ts` or a words module and is pinned by a test that reads it back.

**Ask First:**
- The final wording of the boundary sentence (EXPERIENCE.md's own sentence is being replaced).
- Any change to the 15-second and 60-second thresholds or to `RUN_ENDING_EVENTS`.

**Never:**
- Weaken the lost-connection gate or the terminal latch.
- Start before explicit implementation authorisation (story preparation only, 2026-09-25).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Re-read during a drop | status `lost`; another Run ends; `BellLive` calls `router.refresh()`; the cursor moves | Status stays `lost`, the sentence stays, every live control stays `aria-disabled` | N/A |
| Stream returns | a frame or heartbeat arrives | Status `live`, gate open | N/A |
| Committed action, lost acknowledgement | a flag committed; the RSC response was dropped | The boundary states only what it knows; no claim that nothing changed; reload shows the flag and does not resubmit | N/A |
| Refused action | the command refused before writing | The action's own message may say that nothing changed, because the refusal establishes it | N/A |

</frozen-after-approval>

## Code Map

- `apps/web/src/runs/useLiveTimeline.ts` (the effect at the `[url, cursor]` dependency; `lastMessageAt`), `apps/web/src/runs/live-status.ts` -- the silence clock and the gate reason
- `apps/web/src/runs/LiveGate.tsx` -- the gate over the controls
- `tests/e2e/live-drop.spec.ts` -- the lost-stream journeys; add the re-read-during-a-drop case
- `apps/web/app/error.tsx`, `apps/web/src/design/copy.ts` -- the boundary sentence
- `tests/e2e/flag-run.spec.ts:184` -- the committed-flag case

## Tasks & Acceptance

**Execution:**

- the silence clock and gate correction, with its browser test
- the boundary sentence, with the copy test and the flag journey
- tests: unit (`live-status`), browser (both journeys), WCAG 2.1 AA on the changed surfaces

**Acceptance Criteria:** as `epics.md`, Story 10.8.
