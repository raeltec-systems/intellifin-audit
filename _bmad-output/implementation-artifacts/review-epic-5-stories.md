---
title: 'Code review: Epic 5 stories 5.4 to 5.8'
type: 'code-review'
created: '2026-09-11'
status: 'partial'
---

# Code review — Epic 5, stories 5.4 to 5.8

Per-story adversarial review of the five stories on `codex/epic-5-controls` (PR 29), against
their acceptance criteria in `epics.md` §Epic 5.

## Coverage — READ THIS FIRST

Four layers were requested per story (Blind Hunter, Edge Case Hunter, Verification Gap,
Acceptance Auditor). **Ten of the twenty completed; ten failed on a session rate limit.**

| Story | Blind | Edge case | Verification gap | Acceptance |
|---|---|---|---|---|
| 5.4 Pause and resume | ✅ | ❌ | ❌ | ❌ |
| 5.5 Cancel and flag | ✅ | ✅ | ❌ | ✅ |
| 5.6 Answer in place | ✅ | ✅ | ✅ | ✅ |
| 5.7 Stream drops / Run ends | ❌ | ✅ | ❌ | ❌ |
| 5.8 Replay | ❌ | ✅ | ❌ | ❌ |

**Only Story 5.6 got the full review.** 5.4 and 5.7 and 5.8 are substantially under-reviewed —
5.4 in particular has the largest diff and only one layer. **This is not a clean bill of health
for any story but 5.6.**

Severity below is mine, not the reviewers'. Findings marked **[verified]** I confirmed by
reading the code; **[demonstrated]** were proven by a reviewer running a mutation against the
suite; the rest are rated from the report and are marked **[unverified]**.

---

## High

### H1 — A pause honoured at one boundary strands the Step Execution for ever (5.4) **[verified]**
`packages/application/src/runs/execute-agent-work-item.ts:1065`

`lifecycleBoundary()` is called with no `inFlight`, although `item` and `execution` are both in
scope — this call sits inside `finishObservation`, with a Step Execution running. Every other
mid-item boundary (`:1264`, `:1487`, `:1597`, `:1649`) passes `{ item, execution }`; only the
pre-item boundary at `:1156` legitimately omits it.

The helper guards its supersede-and-give-back logic behind `if (inFlight !== undefined)`. So a
pause honoured here:

- leaves the Step Execution in `RUNNING` for ever — which `run-pause-v1.md` says must never
  happen ("leaving it `RUNNING` would make an interrupted attempt indistinguishable from a
  live one");
- does **not** give the attempt back, contradicting "The attempt is GIVEN BACK";
- never writes `superseded_by`.

The same call site then returns `retry: true`, asking the queue to redeliver a job for a Run
that has just become `PAUSED` — every other pause boundary returns `retry: false` deliberately.

Neither new work-item test reaches this boundary: the two cases cover the pre-item and
model-turn boundaries only.

**Fix:** pass `{ item, execution }` at `:1065` as its four siblings do.

### H2 — A lost flag response does not block the retry, so one click can flag twice (5.5) **[verified]**
`apps/web/src/runs/RunFlagControl.tsx:63-80`

Found independently by three layers. On `unknownOutcome` the component renders a reload link
and leaves the form and its submit button live — it spreads only the gate's `disabledReason`.
`RunCancelControl.tsx:85-87`, extracted in the same change, has exactly the missing arm
(`unknown ? { disabledReason: LOST_RESPONSE } : {}`).

`flagId` is minted (`dependencies.ids.next()`) and the story deliberately designed no request
token, so a retry after a committed-but-unacknowledged flag writes a second `run_flag` row and
a second full recipient fan-out of `notification` rows.

`docs/contracts/run-flag-v1.md` states the opposite in as many words: "the surface blocks the
retry and asks for a reload".

**Fix:** add the `unknown` arm to the submit button, matching the sibling control.

### H3 — The story's headline accessibility guarantee is verified by nothing (5.6) **[demonstrated]**
`apps/web/src/runs/EscalationPanel.tsx:144, :203`

The reviewer ran two mutations against the full `apps/web/src` suite:

- removing the announcing effect, so the polite region is empty for the life of the panel and a
  screen-reader user is told nothing at all → **1073/1073 pass**;
- freezing the announcement at `milestones.open`, so `ten-minutes`, `one-minute` and `expired`
  are never announced → **1073/1073 pass**.

The cause: unit tests render with `renderToStaticMarkup` under `environment: 'node'`, so
`useEffect` never runs and `announcement` is always `''`. The one test that mentions the
sentences asserts their **absence**, which both mutations preserve. The browser journey never
reads the region, and axe has no rule requiring a live region to have content.

`escalationMilestone` itself is well pinned at both sides of every rung — but nothing connects
its output to anything a user perceives.

**Fix:** assert the region's text in `live-escalation.spec.ts`, where the DOM is real.

### H4 — The "clock is not a live region" guard is an attribute-order substring (5.6) **[demonstrated]**
`apps/web/src/runs/EscalationPanel.test.ts:194`

The guard is `expect(html).not.toContain('role="timer" aria-live')`. The reviewer rewrote the
element as `<p aria-live="polite" aria-atomic="true" role="timer">` — restoring the exact Story
4.8 defect this story was written to remove, a clock that announces itself once a second for a
four-hour wait — and the full suite passed **1073/1073**. The companion assertion
`toContain('aria-live="polite"')` is then satisfied by the clock itself, even if the real region
were deleted.

The repo already has the right idiom, in `tests/e2e/sign-in.spec.ts:38`:
`await expect(alert).not.toHaveAttribute('aria-live', /.*/)`.

**Fix:** assert on the element, not on a substring of React's attribute ordering.

---

## Medium

**5.4 — pause (one layer only, so this list is certainly incomplete)** *[unverified]*

- `PauseBanners` renders **nothing** for a `PAUSED` Run whose wait cannot be read: the first arm
  needs `pause !== null && pause.openedBy !== null`, the second needs `run.pauseRequest`, which
  the honouring boundary has already cleared. A held Run that will end Inconclusive in thirty
  minutes says nothing about being paused. Absence rendered as normality.
- In that same state `RunPauseControls` still offers Resume and answers the click with
  "The resume could not be confirmed" — a sentence reserved for a genuinely lost response,
  describing an outcome that did not occur.
- Three resume refusals assert things the command has not established: an authorization denial
  is reported as `code: 'malformed'`; `not-awaiting`/`missing` become "That Run does not exist.";
  and `superseded` is reported as "This pause timed out at {time}; the Run is Inconclusive." with
  `at` set to the instant somebody *else* resumed it.
- The pause marker's documented meaning ("requested and NOT yet honoured") stops holding at the
  terminal transition — `CompleteRun` appends `lifecycle.pause-superseded` without clearing it,
  and a test asserts the leftover. Only `isActiveRunState` hides it from readers today.
- `RUN_PAUSE_TRANSITIONS` is consulted by the command and the UI but never where the transition
  is performed: `saveCheckpoint` writes the state with no `AND state='RUNNING'`.
- Both `honourPause` test helpers call `performPause(context as never)`. `WaitContext` does not
  declare `openPauseWait`/`clearPauseRequest`; the calls work only because extra properties
  survive a spread. Renaming either breaks two journeys at runtime with no compile error.
- `actions.ts` re-implements the pause/resume parsers with a **different** UUID rule from the
  command's (version nibble unconstrained vs `[1-8]`). `cancelRunAction` beside it delegates.
- `PAUSE_COPY.confirmConsequence` hard-codes "after 30 minutes" while `PAUSED_TIMEOUT_MS` is the
  real window, and `copy.test.ts` pins only `banner`.
- `copy.test.ts`'s "never retypes that sentence" walks a hard-coded two-file list — the
  documented "a test that walks a list enforces the list, not the rule" trap.

**5.5 — cancel and flag** *[unverified except where noted]*

- **Flag is not beside Pause/Resume and Cancel**, which is what 5.5's final criterion and UX-DR24
  state. It renders *after* `LiveViewer`; the other two render before it. Deliberate and
  documented in the diff, but it is a stated criterion — **decision needed**.
- No DB-backed test flags a Run with a real `audit-manager` row. The integration test seeds a
  second *auditor* and asserts one notification; the browser spec asserts the same. "Every Audit
  Manager is notified" — the sentence the control shows the user — is proven only against an
  in-memory stub.
- The merged inbox trims to `bounded` after concatenating, so a viewer with enough open
  escalations sees **no flags at all** while the bell keeps counting them.
- `readFlags` caps at 20 and the Live View page passes no limit: a partial flag history reads as
  complete.
- A note containing a lone surrogate or NUL turns a deterministic input refusal into an unknown
  outcome, telling the auditor to reload repeatedly.
- The 500-character bound exists in five places, pinned to none (`run.test.ts` asserts the
  constant against itself), and is applied pre-trim in the command while the database applies it
  post-trim.
- `flag-run.spec.ts` asserts `toEqual` on the notification list, so a concurrent spec's
  audit-manager row makes it fail intermittently. `arrayContaining` is the fix.

**5.6 — answer in place**

- The skip link does not move focus: `<section id="open-escalation">` has no `tabIndex={-1}`, so
  the fragment link scrolls and sets a focus starting point only. AC2 says it "moves focus to the
  panel", and the decision *not* to auto-focus rests on the link working. `AppShell.tsx:67` already
  carries the comment explaining exactly this. **Three layers found it.**
- The link also sits mid-document, below nothing and above its own target, so it is unreachable
  by forward Tab from anywhere else on the page — while `position: fixed` makes it look like a
  top-of-document skip link.
- The chrome does not carry a countdown when it flips to AWAITING (AC1, EXPERIENCE.md:160).
  `SessionChrome` is untouched; the only countdown is inside a different card.
- The milestone region announces the current rung on **mount**, not on a crossing. With a
  four-hour window, opening from the bell with 90 seconds left announces "10 minutes remain", and
  `milestones.open` is never spoken at all.
- `escalationMilestone` is memoryless, so "a ladder that never goes back up" is a property of the
  wall clock, not of the code.
- A second Escalation while the panel stays mounted carries over the stale note, banner and
  disabled fieldset — no `key={waitId}`.
- The success Banner is destroyed by the `router.refresh()` that proves the answer worked.
- The open Escalation never states its timeout consequence (Inconclusive), though the pause
  sibling does.
- `live-escalation.spec.ts` races its own fixture (`seedAgentContext` notifies nothing after
  `raise`), and its teardown omits `run_gate_check` on the one spec in the family that initiates
  a real Run.

**5.7 — the gate** *[unverified; only one layer ran]*

- `ConfirmDialog` ignores the gate while the action is in flight, so all three Run dialogs can be
  left undismissable; and a confirm pressed while the gate is closed is refused silently, with no
  reason shown — which DESIGN.md forbids.
- When `cursor` flips number→null, `TerminalGate` replaces `SubscribedGate` at the same position,
  so the children **remount** — losing a typed flag note and any lost-response recovery banner.
- A reconnect that opens but delivers no frame resets the silence clock, so the gate reopens on a
  socket handshake rather than on knowing what the Run is doing.
- Below 1024px the viewport reason wins over `runEnded`, so a phone reader is told to open a
  desktop to supervise a Run that has already finished.
- `window.matchMedia` absent, or a MediaQueryList without `addEventListener`, throws in the effect
  and takes the whole surface down.
- `RunFlagControl`'s note textarea is not inside a disabled fieldset when the gate closes, unlike
  `EscalationPanel`.

**5.8 — replay** *[unverified; only one layer ran]*

- A jump target whose frames lie past `REPLAY_FRAME_LIMIT` is reported as "no frame was captured
  here" for frames the database holds — the inverse of the story's own rule that a pill which
  opens nothing must say so.
- Frames are matched to Work Items on `run_tool_action.work_item_id`, which is nullable;
  `page.tsx:118` already resolves through the Step Execution instead.
- `ReplayViewer`'s arrow/Home/End handling is not scoped to the viewer the way Space is, and
  checks no modifier — so `Alt+ArrowLeft` cancels browser Back and steps a frame.
- Play on a zero-frame Run latches to Pause; a single-frame Run's Play appears broken.
- Up to 500 scrubber pills are each a tab stop, with no roving tabindex, and nothing scrolls the
  current pill into view.
- Two Target Systems with the same display name collide as React keys, so one system's frozen
  Audit Instructions can render against another.
- `Digest.test.ts`'s tag scanner **fails open**: a tag it cannot parse is silently skipped.

---

## Deferred (pre-existing, not caused by this change)

- `docs/contracts/durable-escalation-v1.md:106,258` still name `notification_escalation_context`
  and `escalationNotificationRecipients`, both renamed in an earlier story.
- `epic-5-story-status.md` records generation 46 as "539/764/**41**" triggers. Generation 45 is 26
  and 46 adds one, so it should be 27; CLAUDE.md's generation 47 entry says 28. A verification
  claim that is wrong in a number is worse than one that is absent.

## Dismissed

- *A run-ending event naming a different Run latches the gate* (5.7). The subscription URL is
  Run-scoped, so another Run's event cannot arrive on it. **[verified false]**
- *`EventSource` undefined leaves every control usable for ever* (5.7). True of the code path, but
  reachable only outside a browser, where there is no interactivity to gate. Downgraded to low.

---

## Note on review conditions

A second agent was working in this repository throughout. One reviewer observed a planted
mutation in `EscalationPanel.tsx` mid-run and correctly reviewed the committed diff instead; the
working tree was clean when checked. Reviews taken while another agent mutates the tree are worth
treating with suspicion — this one survived it, but only because the reviewer noticed.
