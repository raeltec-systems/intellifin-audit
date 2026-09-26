---
title: 'Lost connection and lost acknowledgement: a server refresh is not stream recovery, and a rendering error claims only what it knows'
type: 'fix'
created: '2026-09-25'
status: 'in-review'
review_loop_iteration: 0
implementation_authorised: true
implementation_authorisation: 'Owner, 2026-09-26: "go, new branches OK" (implement 10.6 to 10.10 on new branches)'
baseline_revision: '429e08cf703fee6c5320f17b5983948709fd5bdf'
deferred:
  - summary: >-
      A full document load (a browser Reload, the boundary's "Reload this page" link, or the ended sentence's "Refresh to continue") starts a fresh clock, so while the stream is still down Pause, Cancel and Flag stay enabled until that page itself counts 60 seconds.
    evidence: |-
      RUN_STREAM_CLOCKS lives for the document (useLiveTimeline.ts), and liveGateReason closes only for lost, ended, runEnded and viewport. It was already true of a browser reload before this change; the in-document hand-off cannot cover a new document.
    location: >-
      apps/web/src/runs/useLiveTimeline.ts
    severity: medium
  - summary: >-
      The no-JavaScript flag result page is the response to a POST and the flag has no request token, so a browser reload (after its confirmation prompt) writes a second run_flag and notifies every Audit Manager again.
    evidence: |-
      Named by this change. A Post/Redirect/Get from flagRunFormAction or a request token would close it.
    location: >-
      apps/web/app/runs/actions.ts
    severity: medium
  - summary: >-
      The Administration thrown and lost paths still say "Nothing was changed."
    evidence: |-
      RoleControl, UserForm, BindingForm, RegistrationForm and the UNAVAILABLE sentence in three admin actions.ts files; named by this change. New wording needs the owner.
    location: >-
      apps/web/src/admin
    severity: low
  - summary: >-
      Unknown-outcome sentences are retyped between apps/web/app/runs/actions.ts and their surfaces.
    evidence: |-
      PAUSE_UNKNOWN and RESUME_UNKNOWN (actions.ts:96-97) against copy.ts:474-475; CANCEL_UNKNOWN (:60) against RunCancelControl.tsx:78; RERUN_UNKNOWN (:61) against RunLifecycleActions.tsx:80. The flag's was unified by this change.
    location: >-
      apps/web/app/runs/actions.ts:60
    severity: low
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

## Review Triage Log

### 2026-09-26 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 12: (high 0, medium 1, low 11)
- defer: 4: (high 0, medium 2, low 2)
- reject: 4: (high 0, medium 0, low 4)
- addressed_findings:
  - `[medium]` `[patch]` A new connection sent no frame until its first heartbeat ten seconds later, so with `open` no longer a frame a quiet, healthy stream read `stale` around every planned 14-minute renewal and after a soft navigation, and quick moves between Run pages could reach `lost`. The route now sends a heartbeat as soon as its LISTEN is armed and its first catch-up is read; `open` changes nothing.
  - `[low]` `[patch]` The boundary's reload link kept the query only in an untested client path; it now reads `usePathname` and `useSearchParams` on server and client.
  - `[low]` `[patch]` Hand-off edges in `useLiveTimeline`: a same-millisecond re-render bail-out, a frame between leaving and stopping, and `lastSeq` across a key change. Taking the larger of the server cursor and `lastSeq` was not applied: it can skip the frame that says the Run ended (CLAUDE.md, Story 10.8 note).
  - `[low]` `[patch]` `live-stream.test.ts` did not observe `onChange`; the layout-effect ordering and the Workspace claim were unpinned.
  - `[low]` `[patch]` Four separate "nothing changed" patterns missed rewordings; one shared pattern (`nothing-changed.ts`).
  - `[low]` `[patch]` The approved boundary wording gained a row in EXPERIENCE.md, and all five sentences are pinned to it on disk.
  - `[low]` `[patch]` Contract and doc comments that disagreed with the code (`ended`, `LiveStatusInputs`, the stale count after a hand-off); the full-document-load behaviour is named.
  - `[low]` `[patch]` CLAUDE.md: four superseded entries marked; the hydration and dev-overlay lesson recorded.
  - `[low]` `[patch]` The story record: later commits, the failed and fixed full-suite run, the approval after the build, and what Stories 5.5 and 5.7 need next.
  - `[low]` `[patch]` `live-drop.spec.ts`: the Flag submit re-enabled on recovery, the comment, a visible reason, and axe on Run Detail in the inherited `lost` state.
  - `[low]` `[patch]` A render test for a refused flag's own message.
  - `[low]` `[patch]` The deployed harness counted a 404 or a denied Evidence link as opened.

Open at the 2026-09-26 pause: browser verification of the connect-heartbeat, boundary, hand-off and
live-drop patches (P1, P2, P4, P10) and of the screenshot fixes in `110c3baa`; the root typecheck,
boundaries and the full unit suite after `110c3baa`; and the record update below, which is a draft.

## Record update draft (not yet applied, 2026-09-26)

## Record of implementation (2026-09-26)

Branch `claude/10-8-lost-connection`, from `429e08c`; not pushed.

**The silence clock.** `LiveClock` in `live-status.ts` moves only on a frame the stream itself
sends (a Timeline event or a heartbeat). `followLiveStream` in the new `live-stream.ts` is the
subscription, moved out of `useLiveTimeline`'s effect so the unit suite can drive it with a
fake `EventSource`; a new cursor closes one connection and opens the next without touching the
clock. `open` (the route answering a connection) is not a frame and is not listened for: the
route answers before it arms its LISTEN, and a stream that then delivers nothing must not read
`live` again every two seconds. What makes a new connection heard at once is the stream: the
channel sends one heartbeat as soon as a stream is armed and caught up, before its first
periodic tick (review P1). A remount takes the clock the last subscription to the same stream
left (`createLiveClockHandOff`), with everything it said — `lost`, `ended`, `stale` or `live` —
and without the time no subscriber was listening; so Live View, Run Detail and the Auditor
Workspace, which follow the same per-Run stream, keep saying `lost` across a move between them.
A subscription closes its connection before it leaves its clock, begins from its own page's
cursor, and repaints through `nextLiveTick` (review P3). The 15-second and 60-second
thresholds, the gate reasons and `RUN_ENDING_EVENTS` are unchanged.

**The route boundary.** `apps/web/app/error.tsx` no longer says that nothing was changed. Its
words are in `apps/web/src/design/route-boundary-words.ts`; its one control is a plain link to
the page's own address, query included, built from `usePathname()` and `useSearchParams()`
(a GET, which cannot resubmit and needs no script), in place of `reset()`, which re-rendered
the page as it was before the action. The flag action's unknown-outcome sentence now comes
from `FLAG_COPY`. The deployed harness matches the boundary's heading, pinned to the module,
and also fails an Evidence link on a status of 400 or more, the not-found heading and the
refused-Run page (review P12).

**Wording.** Built first as PROPOSED, because the owner was not reachable when the story was
implemented; the owner approved all five on 2026-09-26 ("approve all"), and `feddc2d8` removed
the PROPOSED marks with the words unchanged.
- Run pages (banner title): "This page could not be loaded. Check the Run's current state before
  repeating your last action." (the candidate in epics.md, verbatim, pinned there by a test)
- Any other page: "This page could not be loaded. Check the current state before repeating your
  last action."
- Body: "Reload this page to read it again. Reloading from here does not repeat your last
  action. If the page keeps failing, tell a PoC Administrator."
- Control: "Reload this page". The heading "This page could not be loaded" is unchanged.
- EXPERIENCE.md now has ONE state-table row for the route boundary, beside "Any | Action
  failed", holding the five sentences and saying that "Action failed" stays for a refused
  action (review P6). No other row changed. `route-boundary-words.test.ts` pins all five
  against that row on disk and keeps the epics.md pin for the Run sentence.

**Review patches (2026-09-26).**
- P1 (`cc9306ae`): the connect heartbeat in `openRunTimelineStream`, on both streams, none when
  the LISTEN or the first read fails; `open` changes nothing (`streamOpened` removed); a
  handed-on `live` clock stays `live`. `live-timeline.spec.ts`'s return-to-live wait is back to
  its original 15 s. Contracts: `live-timeline-channel-v1.md` (the heartbeat bullet) and
  `live-view-v1.md`. Tests: `run-timeline-connect.test.ts` (engine, fake chain),
  `tests/integration/run-timeline-connect.test.ts` (real PostgreSQL, a new file so 10.7's
  edits to `run-timeline-channel.test.ts` do not meet these), and
  `tests/unit/live-channel-cadence.test.ts`: the real engine and the real subscription through
  an emulated `EventSource`, with `HEARTBEAT_MS`, `STREAM_LIFETIME_MS` and the retry of
  `RETRY_FRAME` imported, sampled every second: a planned renewal whose last heartbeat is
  9.9 s old at the end, a page move 9 s after the last heartbeat, and a page moved every 5 s
  for 60 s — `live` at every sample. It is a root unit test, so it imports the channel's own
  constants and nothing is restated.
- P2 (`aafda82d`): the reload link keeps the query on the server render too. An SSR test with
  a mocked `useSearchParams`; the lost-acknowledgement journey runs on
  `/runs/<id>/live?view=lost-acknowledgement` and asserts the link's `href`.
- P3 (`cc9306ae`): (a) `nextLiveTick` for every repaint; (b) `endLiveSubscription` closes the
  connection before it leaves the clock, called from the layout cleanup; (c)
  `beginLiveSubscription` resets the cursor when the stream changes. Each rule is unit-tested
  in `live-status.test.ts` / `live-stream.test.ts`; the hook's wiring (the layout effect, the
  cleanup order, the one `setNow`) is pinned by a source scan in `useLiveTimeline.test.ts`,
  because this suite has no DOM to mount a hook into and runs no effect. Declined: "when the
  server cursor moves past it, take the larger of the two". The pages read the chain head
  BESIDE their content (`Promise.all` in `live/page.tsx` and `workspace/page.tsx`), so the head
  can be ahead of what the page rendered, and a stream resumed from it would skip the frame
  that says the Run ended: the page would stay `RUNNING` with live controls. And the old code
  did not follow the server's number on a re-read either: at `429e08c` `lastSeqRef` was seeded
  once (`useRef(cursor ?? 0)`) and every re-run opened `?after=${lastSeqRef.current}`; it took
  the server's number only at mount, which the new code still does.
- P4 (`cc9306ae`, `1a58ca27`): `live-stream.test.ts` counts `onChange` calls; the
  `useLayoutEffect` is pinned by the source scan, with the reason; the live-drop journey moves
  Live View → Run Detail → Auditor Workspace and back, and every page says `lost` at once.
- P5 (`aafda82d`): `NOTHING_CHANGED_CLAIM` in `design/nothing-changed.ts`, used at all four
  places; `nothing-changed.test.ts` lists 17 phrasings it must catch (the six the old patterns
  missed among them) and 9 real sentences it must not.
- P6 (`aafda82d`): the EXPERIENCE.md row above.
- P7 (`cc9306ae`, `c9bef102`): `live-view-v1.md`'s gate table defines `ended` as the browser
  reporting CLOSED; `LiveStatusInputs` documents `ended`, `everConnected` and the shifted
  `lastMessageAt`; the contract says the stale count is the silence this document listened
  through; the full-document-load gap is named in the contract, below and in CLAUDE.md.
- P8 (`c9bef102`): CLAUDE.md's Story 10.8 note carries the review's rules and the `1ee6a204`
  lesson; the four older entries are marked `[FIXED]` or `[SUPERSEDED]`.
- P10 (`1a58ca27`): recovery re-checks Flag's submit too; the cost of a fresh clock is stated
  correctly; the reason is asserted visible, not found in `textContent`; axe scans Run Detail in
  the inherited `lost` state. The boundary's non-Run variant IS reachable, and
  `tests/e2e/route-boundary.spec.ts` (`aafda82d`) scans it: a dropped Users search on
  `/administration/users?q=…`, its sentence, its link with the query, WCAG 2.1 AA, and the
  link followed.
- P11 (`f08e8335`): `RunFlagControl.test.ts` renders every `RUN_FLAG_REFUSALS` sentence in the
  danger banner, with no unknown-outcome sentence, withdrawal or reload link.
- P12 (`29364577`): the harness change above, pinned in `acceptance-sentences.test.ts`.
  `not-found.tsx` ("… Nothing was changed.") is NOT only a GET's page: see "Named, not fixed".

**Screenshot review (2026-09-26).** Each new or changed state was captured at 1280×800 with
the existing browser fixtures (a throwaway spec, deleted) and read as a reader would: the
route boundary on a Run page and on an Administration page with its link focused; Live View
connecting, stale, `lost` (flag disclosure closed, then open) and recovered; Run Detail and
the Auditor Workspace in the inherited `lost` state; and Run Detail's toolbar with a pause
requested, paused and with an Escalation open. What was off, and fixed (SCREENSHOT-COMMIT):
- A link drawn as a button carried the browser's underline through its label: the boundary's
  "Reload this page", Run Detail's Watch and every other link-button. `.ls-button` sets
  `text-decoration: none`.
- In the `lost` state Pause, Cancel and Acquire control were greyed with no visible reason:
  the gate's sentence was each control's visually hidden description, and its only visible
  copy was inside the closed flag disclosure, which is the tooltip-only explanation DESIGN.md
  forbids. `LiveGateNote` states the stream's reason (`lost` or `ended`) once, in the page
  header under the meta line, on Live View and on the Auditor Workspace, for as long as the
  gate is closed. The narrow-viewport reason is already the stage's own sentence, and
  `runEnded` lasts only until the controls are removed. `LiveGateNote.test.ts`;
  `live-drop.spec.ts` asserts the note painted with the disclosure closed and gone after
  recovery, and the flag's caption painted (a 1px clipped copy is not "visible").
- On Live View the flag opener had no size class, so it sat shorter and higher than Pause and
  Cancel beside it. It takes `ls-button--sm`, the size `Button` gives its neighbours.
- Run Detail's toolbar laid Pause out in a centred column under "Acquire control": each group
  is also an `.ls-stack`, whose column direction the toolbar rule did not override. The groups
  are rows, and the control panel's sentence and its button read as one phrase on the same
  line as the Run's other actions.
- `live-drop.spec.ts` waits for each address when it steps back twice: in the throwaway spec a
  second `goBack` issued while the first was still committing landed on another page.
Looked at and left, with the reason: the Run-page boundary has no trail (the page's own trail
names the Procedure, which the boundary cannot read without the data that failed, and a UUID
crumb is the defect UX-02 removed; the sidebar marks Runs), while the Administration boundary
keeps the shell's; the heading and the banner title both begin "This page could not be
loaded", which are the owner's approved words; the session chrome says LIVE while the
connection is lost, because EXPERIENCE.md's "Stream lost" row changes the banner and the
controls and not the chrome; and on Run Detail the controls stay usable under the inherited
`lost` banner, because the gate is Live View's and the Workspace's (Story 5.7).

**Verification.**
Commits: `d2c7add9`, `402caf9e`, `84a56164`, `1ba0ffdc`, `6d5cb64d`, `e8e51225`, `1ee6a204`,
`feddc2d8` (the owner's approval), then the review patches `cc9306ae`, `aafda82d`,
`f08e8335`, `29364577`, `1a58ca27`, `c9bef102`, and this record.

Before the review: full unit suite 296 files, 5,447 tests passed; the web typecheck, the
root-tests typecheck and `pnpm boundaries` passed; `live-drop`, `live-timeline`, `live-view`
and `live-escalation` 18 of 18 and `flag-run` 6 of 6. The coordinator's FULL browser suite then
failed one case, `flag-run.spec.ts:185`: the journey clicked the native `<details>` before
React had hydrated, React reported the mismatch, and `next dev`'s overlay POSTed
`/__nextjs_original-stack-frames` to symbolicate it, which the test counted as a resubmission.
`1ee6a204` waits for `data-client-ready` before touching the disclosure and excludes
`/__nextjs*` from the counter (every other POST, a Server Action's to the page URL included,
still counts); `flag-run.spec.ts` then passed three runs in a row with no hydration mismatch
and no `/__nextjs*` POST, and making the boundary link also POST to the page URL failed
`expect(posts)` with that URL. The earlier line "Not run: the full browser suite" was wrong:
the coordinator ran it.

After the review: VERIFY-RESULTS

**Named, not fixed.**
- The Administration controls' client catch branches (`RoleControl`, `UserForm`,
  `BindingForm`, `RegistrationForm`) and the administration actions' `UNAVAILABLE` sentence
  still say "Nothing was changed." when a Server Action throws or its response is lost: the
  same defect class, on surfaces this story does not own.
- Without JavaScript a flag's result page is the answer to a POST, so the browser's own Reload
  offers to resubmit it (the boundary's link does not).
- A FULL document load starts a fresh clock: the browser's Reload, the boundary's "Reload this
  page" and the `ended` sentence's "Refresh to continue" load a new document that reads
  `connecting` and then `stale`, neither a gate reason, so while the stream is still down its
  live controls stay enabled until that page has itself counted 60 seconds. Deferred by the
  review as a follow-up; the command still refuses a stale action.
- The not-found page can follow a committed Server Action. Any `revalidatePath` makes Next
  re-render the CURRENT page in the action's response (`skipPageRendering` in Next 16's action
  handler), and a Builder Submit is taken on `/procedures/<id>/builder`, which calls
  `notFound()` for a version that is no longer a Draft — so the committed Submit's own response
  renders "Page not found … Nothing was changed." until `VersionActions` pushes to the version
  page. Found by reading, not reproduced. Every other `notFound()` in `app/` is reached only by
  a GET of an address that does not resolve (no action deletes a Procedure, version,
  registration, binding or Run). Its wording is unchanged, as the review asked.
- The first subscription of a page opens from the chain head the page read beside its
  content, so a head ahead of the content can skip a terminal frame at first mount. It is the
  race the declined half of P3(c) would have extended to every re-read.

**Closure.** When this story is accepted, Stories 5.5 and 5.7 have no residual work left: the
closure register's §3.3 names only Story 10-8 for each (`legacy-review-closure-register.md`,
the 5.5 and 5.7 rows of the status table), so both can leave `review`. `sprint-status.yaml`
is not edited here.
