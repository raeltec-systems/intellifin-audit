---
title: 'Lost connection and lost acknowledgement: a server refresh is not stream recovery, and a rendering error claims only what it knows'
type: 'fix'
created: '2026-09-25'
status: 'in-review'
review_loop_iteration: 0
implementation_authorised: true
implementation_authorisation: 'Owner, 2026-09-26: "go, new branches OK" (implement 10.6 to 10.10 on new branches)'
baseline_revision: '429e08cf703fee6c5320f17b5983948709fd5bdf'
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

## Record of implementation (2026-09-26)

Branch `claude/10-8-lost-connection`, from `429e08c`; not pushed.

**The silence clock.** `LiveClock` in `live-status.ts` moves only on a frame the stream itself
sends (a Timeline event or a heartbeat). `followLiveStream` in the new `live-stream.ts` is the
subscription, moved out of `useLiveTimeline`'s effect so the unit suite can drive it with a
fake `EventSource`; a new cursor closes one connection and opens the next without touching the
clock. `open` (the route answering a connection) is not a frame: it makes a page that has never
heard from its stream `live` at once, and moves nothing else, because the route answers before
it arms its LISTEN and a stream that then delivers nothing must not read `live` again every two
seconds. A remount takes the clock the last subscription to the same stream left
(`createLiveClockHandOff`), so Live View, Run Detail and the workspace, which follow the same
per-Run stream, keep saying `lost` across a move between them. The 15-second and 60-second
thresholds, the gate reasons and `RUN_ENDING_EVENTS` are unchanged.

**The route boundary.** `apps/web/app/error.tsx` no longer says that nothing was changed. Its
words are in `apps/web/src/design/route-boundary-words.ts`; its one control is a plain link to
the page's own address (a GET, which cannot resubmit and needs no script), in place of
`reset()`, which re-rendered the page as it was before the action. The flag action's
unknown-outcome sentence now comes from `FLAG_COPY`. The deployed harness matches the
boundary's heading, pinned to the module.

**Wording, approved by the owner on 2026-09-26 ("approve all").**
- Run pages (banner title): "This page could not be loaded. Check the Run's current state before
  repeating your last action." (the candidate in epics.md, verbatim, pinned there by a test)
- Any other page: "This page could not be loaded. Check the current state before repeating your
  last action."
- Body: "Reload this page to read it again. Reloading from here does not repeat your last
  action. If the page keeps failing, tell a PoC Administrator."
- Control: "Reload this page". The heading "This page could not be loaded" is unchanged.
- EXPERIENCE.md has no row for the route boundary; its "Action failed" row ("Couldn't {action}.
  Nothing was changed.") is for a refused action, stays true for that case, and was not edited.

**Verification.** Commits `d2c7add9`, `402caf9e`, `84a56164`, `1ba0ffdc`, `6d5cb64d`. Full
unit suite 296 files, 5,447 tests passed; `pnpm --filter @intellifin/web typecheck`, the
root-tests typecheck and `pnpm boundaries` (806 modules) passed. Browser, on the final code:
`live-drop.spec.ts`, `live-timeline.spec.ts`, `live-view.spec.ts` and
`live-escalation.spec.ts` 18 of 18, and `flag-run.spec.ts` 6 of 6 (setup cases apart). Proven by mutation: in the browser, restarting the clock when a connection
opens fails the new journey at sample 3 of 8 with status `live` and every control reopened;
dropping the clock hand-off fails it at the Run Detail step with `connecting`; restoring the
old boundary title fails the committed-flag journey at the new wording. In the unit suites,
seven boundary mutations (old claim, `reset()` button, every page naming a Run, the Runs list
as a Run page, the flag throw claiming nothing changed, the owner's sentence reworded, the
harness looking for the retired sentence) and two `open` mutations each fail a named case.
Not run: the integration suite (no database-backed module changed) and the full browser
suite.

**Named, not fixed (outside this story's scope).** The Administration controls' client catch
branches (`RoleControl`, `UserForm`, `BindingForm`, `RegistrationForm`) and the administration
actions' `UNAVAILABLE` sentence still say "Nothing was changed." when a Server Action throws or
its response is lost: the same defect class, on surfaces this story does not own. Without
JavaScript a flag's result page is the answer to a POST, so the browser's own Reload offers to
resubmit it (the boundary's link does not).
