---
title: 'Lost connection and lost acknowledgement: a server refresh is not stream recovery, and a rendering error claims only what it knows'
type: 'fix'
created: '2026-09-25'
status: 'in-progress'
baseline_commit: '429e08cf703fee6c5320f17b5983948709fd5bdf'
review_loop_iteration: 0
implementation_authorised: true
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

## Implementation authorization — 2026-09-26

The owner requested implementation of legacy Stories 10.6–10.10 in parallel. This supersedes the preparation-only flag, but does not approve the frozen boundary-copy proposal. Stream recovery is executable independently; final boundary wording remains owner-dependent.

## Execution checkpoint — 2026-09-26

- Stream health now survives cursor-triggered effects and React remounts within the browser
  document. Neither a server read nor `EventSource.open` resets it. A valid timeline frame
  (including duplicate replay) or heartbeat recovers it; duplicate callbacks stay suppressed.
- 15-second stale / 60-second lost thresholds, `RUN_ENDING_EVENTS`, terminal latch and
  refused-command copy are unchanged. Server rendering never populates the health cache.
- Added deterministic hook coverage for refresh, remount, open, silence thresholds, duplicate
  replay, malformed data, permanent closure, URL isolation and listener cleanup.
- Added a browser journey: block the subject stream, reach lost, append its next real chain
  event, end another Run to trigger BellLive's re-read, assert lost sentence and all controls
  remain withdrawn, then recover on heartbeat. Includes WCAG 2.1 AA scan.
- Boundary/flag-journey work remains unimplemented until the frozen wording choice is made.
  The current boundary has BOTH an unconditional title and an unconditional body claim;
  replacing only the title would leave the defect.

### Concrete owner decision: generic boundary copy

Recommended reviewable replacement (not approved or built): keep the existing heading
`This page could not be loaded`, set the banner title to
`This page could not be loaded. Check the Run's current state before repeating your last action.`,
remove the unsupported body claims, and keep the existing `Try again` button calling `reset`.
The sentence will live in `copy.ts`, with a read-back test and the committed-flag journey
asserting the exact sentence and exactly one flag/notification after reload. No mutation retry
will be added. This choice is required by the frozen Ask First boundary above.

### Verification status

- Targeted unit tests: 36 passed across hook, status, gate and banner tests.
- `pnpm typecheck`: passed across all workspaces and root test TypeScript.
- `pnpm boundaries`: passed, 802 modules; `git diff --check`: passed.
- Three independent review layers completed; accepted patches are recorded below. Hosted browser verification remains pending.
- Browser/axe journey is authored but not run locally: PostgreSQL 18 cannot start under the
  managed environment's user-transition restrictions. Hosted CI must supply that proof.
- Story remains in progress; boundary acceptance and browser matrix proof remain outstanding.

### Accepted review patches — 2026-09-26

- Required envelope fields are validated before touching health: blank/missing strings,
  invalid timestamps and invalid sequences do not recover the stream. Future event-family
  names remain allowed. Regression coverage includes the reported empty-ID/type envelope.
- The per-Run terminal latch now survives component remount alongside health. `LiveGate`
  consumes that latch; global list events cannot latch it. Heartbeat recovery never clears
  terminality. Every signal increments the render revision, including signals in the same
  millisecond, so terminal closure is not delayed by a timestamp state equality bailout.
- Browser coverage now exercises actual Run Detail → Watch navigation, requiring a new gate
  node in the same document. The lost clock remains gated; a separate terminal-envelope
  journey holds the server fixture active to prove the cached-snapshot race and subsequent
  heartbeats cannot reopen terminal controls. Neither path uses a production test backdoor.
- Full-unit run reported by the coordinator before these patches: 5,392 passes and two
  boundary mutation-fixture `.rsync-tmp` failures, also encountered on isolated rerun.
  This is not recorded as a green full suite. Standalone boundaries and typecheck passed;
  hosted CI remains necessary. No boundary tests were weakened.
