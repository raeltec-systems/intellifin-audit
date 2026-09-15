---
title: 'Code review: Epic 5 stories 5.4 to 5.8'
type: 'code-review'
created: '2026-09-11'
updated: '2026-09-15'
status: 'complete — twenty of twenty layers; repairs on codex/epic-2-procedure-builder'
---

# Code review — Epic 5, stories 5.4 to 5.8

Per-story adversarial review of the five stories that shipped in PR 29, against their
acceptance criteria in `epics.md` §Epic 5, and the repairs made from it.

## Coverage — READ THIS FIRST

Four layers per story. **Ten completed on 2026-09-11; the other ten failed on a session rate
limit and ran on 2026-09-15.** Every layer read its story's diff in full (line counts stated in
each findings file) and wrote to `scratchpad/cr5/findings/`.

| Story | Blind | Edge case | Verification gap | Acceptance |
|---|---|---|---|---|
| 5.4 Pause and resume | ✅ 09-11 | ✅ 09-15 | ✅ 09-15 | ✅ 09-15 |
| 5.5 Cancel and flag | ✅ 09-11 | ✅ 09-11 | ✅ 09-15 | ✅ 09-11 |
| 5.6 Answer in place | ✅ 09-11 | ✅ 09-11 | ✅ 09-11 | ✅ 09-11 |
| 5.7 Stream drops / Run ends | ✅ 09-15 | ✅ 09-11 | ✅ 09-15 | ✅ 09-15 |
| 5.8 Replay | ✅ 09-15 | ✅ 09-11 | ✅ 09-15 | ✅ 09-15 |

**Nothing below is rated from a report alone.** Every finding marked FIXED was read in the code
on `main` at `b5e2ea6`, repaired, and — where a unit or browser test can see it — proven by
mutation: the test run against the fix removed and required to fail. The status of each proof
is stated; a proof this environment could not run says so rather than being implied.

## How the 09-11 Medium list was wrong

The first report listed ~35 Medium findings marked `[unverified]` — rated from the reviewers'
text, never read in the code. Reading them found: **most real, several worse than Medium, two
not reachable as described, and one whose spec pinned the defect as the expected value.** The
shape that recurred most is a rule fixed in one sibling and not the other, in the same file.

---

## Fixed in this round

Each row: what was wrong, where, what proves it now. "Mutation: killed" means the named test
fails against the fix removed.

### 5.4 — Pause and resume

| # | Finding | Fix | Proof |
|---|---|---|---|
| F1 | **A `PAUSED` Run whose wait cannot be read rendered NOTHING.** `PauseBanners` needed the wait AND `openedBy`, or the pause marker — which the honouring boundary clears by design. `readOpenEscalation` answers all-nulls on an authorization refusal, so a held Run ending Inconclusive in 30 minutes showed a page saying nothing. `OpenEscalationSection`, twenty lines above, was fixed for exactly this in 5.6. | `detail.tsx` `PauseBanners`: the sibling's branch table — full banner, DANGER banner (`PAUSE_COPY.unreadable`), nothing. | `PauseBanners.test.ts` (new; the component had none). Mutation: killed. |
| F2 | **No countdown.** EXPERIENCE.md asks for one at 115, 149 and 292; the banner printed two absolute timestamps. The Escalation sibling had a clock. | `WaitCountdown.tsx`: the arithmetic shared by both surfaces (`countdownText`, `remainingMilliseconds` moved out of `EscalationPanel`); `role="timer"`, no live region (the 5.6 decision). `PauseBanners` renders it from `readAt`. | `PauseBanners.test.ts`; `EscalationPanel.test.ts` unchanged and green. Mutation: killed. |
| F3 | **The banner printed the auditor's UUID** — "Paused by 019a3c…" — where EXPERIENCE.md says "Paused by Daniel Okonjo". `pause-resume.spec.ts:153` asserted the id, pinning the defect. | `PauseBanners` takes `names` from `ActorNameReader`; both call sites resolve `opened_by` and `pause_requested_by`. Spec asserts the name and that the id is absent. | `PauseBanners.test.ts`. Mutation: killed. Browser: `pause-resume.spec.ts` (see Verification). |
| F4 | **`$&` in a name rewrote the sentence.** `.replace('{actor}', name)` with a string pattern expands `$&`, `` $` ``, `$'`; chained calls let a value containing `{time}` be substituted next. Also in `FLAG_COPY.by`. | `fillTemplate` in `copy.ts`: replacer FUNCTION, one pass, unknown placeholder left visible. Used by the pause banner and the flag list. | `PauseBanners.test.ts` hostile-name case. Mutation (chained replace restored): killed. |
| F5 | **Resume offered a request it could not send, then answered a lost-response sentence.** With `runRevision === null` (same all-null read as F1) the button was live and the click said "The resume could not be confirmed" — nothing was sent. The early return also skipped `setAttempt`, so a repeat click was never re-announced. | Resume withdrawn with `PAUSE_COPY.unreadable` as its reason; the guard behind it says why and bumps `attempt`. | Read; covered by the withdrawn-control pattern already tested for `RunFlagControl`. No new mutation. |
| F6 | **`resumeRun`'s `expired` refusal said "the Run is Inconclusive"** — a state the delayed wake writes, reachable before the wake runs, so a reload still showed PAUSED and offered Resume, and every click repeated the claim. | Sentence says the deadline passed and to reload for the recorded outcome. `superseded` discriminated on closure kind (the `answerEscalation` shape), new `closed` code. | `pause-run.test.ts`: two cases at reachable states. Mutation (old sentence restored): killed. |

**Verified and dismissed as described (5.4):** the reviewer's "a second tab is told Inconclusive
with somebody else's timestamp" path (`superseded`) is NOT reachable through `resumeRun` — the
guard at `pause-run.ts:342` refuses a closed wait as `not-paused` under the row lock before
`closeWait` runs. The first two tests written modelled the reviewer's path and both received
`not-paused`; the rewritten tests assert what actually happens. The `superseded` arm is kept as
the sibling's defensive shape and said to be that.

### 5.5 — Cancel and flag

| # | Finding | Fix | Proof |
|---|---|---|---|
| F7 | **The inbox dropped every flag once Escalations filled the bound, and the bell counted them.** `openFor` returns `[...escalations, ...flags].slice(0, 100)`; `countOpenFor` adds both unbounded. The ordering was right (only a wait expires) and documented; the silence was the defect. | `notifications/page.tsx` reads the bell's own count and renders `NOTIFICATIONS_BOUNDED` — "Showing the first N of M…" — when it exceeds the list. | Read. The `openFor` array contract is used by 15 tests and is unchanged. |
| F8 | **The flag note stayed fully editable under a closed gate**, unlike the Escalation note. | `readOnly` + `aria-disabled` + a `describedby` reason when the gate closes or the outcome is unknown. | `RunFlagControl.test.ts` green; browser gate journey (see Verification). |

### 5.6 — Answer in place

| # | Finding | Fix | Proof |
|---|---|---|---|
| F9 | **The Escalation note was withdrawn with native `disabled`** — unfocusable, its reason unreachable by keyboard — against the contract's own "`aria-disabled`, never `disabled`". | `readOnly` + `aria-disabled` + a visible/describedby reason. | `EscalationPanel.test.ts` green (its mutation-proven H3/H4 cases untouched). |

### 5.7 — The gate

| # | Finding | Fix | Proof |
|---|---|---|---|
| F10 | **`ConfirmDialog` refused a confirm SILENTLY when the gate was closed, and a gate closing mid-flight never dismissed the dialog** (every Run dialog's `onCancel` is `if (!busy)`; `busy` was not a dependency). No test reached either half. | The refusal is stated (`role="alert"`); Confirm carries `aria-disabled`; the effect re-runs when `busy` clears and states the reason while it cannot dismiss. | `live-drop.spec.ts` "dismisses a confirmation that was already open…": opens the dialog, lets the stream go lost, asserts dismissal and `cancel_requested_by IS NULL`. Cannot be a unit test (portal container is effect-set; SSR renders nothing). Mutation = the effect deleted (see Verification). The `handleConfirm` refusal is same-tick defence a browser cannot deterministically reach; stated, not claimed. |
| F11 | **`useDesktopViewport` threw where `matchMedia` is absent or predates `addEventListener`** (Safari 13), and a throw in an effect takes the WHOLE surface to the route boundary — to close a gate. | Guarded; with no way to observe a viewport the gate stays open, its own stated default. | Read; `LiveGate.test.ts` green. |
| F12 | **`docs/contracts/live-view-v1.md` said the gate has THREE reasons and `runEnded` outranks the others; the code has four and `viewport` outranks everything.** The 1024px section said the rule was stylesheet-only. | Contract corrected: four reasons in priority order; the 1024px section says the controls' withdrawal is a client verdict and why not a server one. | Doc. |

### 5.8 — Replay

| # | Finding | Fix | Proof |
|---|---|---|---|
| F13 | **The jump list printed `choose-candidate` at an auditor**, in a monospace span — the plain-words defect reintroduced on a new surface. `replay.spec.ts:308,361` asserted the key, pinning it. Three layers found this independently. | `ESCALATION_KIND_WORDS` in `plain-words.ts` (typed against the application union; `EscalationPanel` drops its private copy); `escalationKindWord` is `Object.hasOwn`-guarded because the stored kind arrives typed `string` (seventh occurrence). Spec asserts the words. | `plain-words.test.ts`, `replay.test.ts`. Mutations (key printed; guard dropped): killed. |
| F14 | **"No frame was captured here" for frames the database holds** past `REPLAY_FRAME_LIMIT` — the story's own rule inverted. | A null-frame row says which of THREE things is true, decided by the resolver and never inferred from a count (see F19): `none-captured` under a complete read, `none-before` for an Escalation raised before the first frame, `not-read` under a bounded read — the last claiming neither that a frame exists nor that none was captured. | `replay.test.ts` four cases, `ReplayViewer.test.ts` three; mutations M2–M4 in Verification. |
| F15 | **Work Item and Exception jumps matched on nullable `run_tool_action.work_item_id`** while the same page resolved the system name through the Step Execution. | `resolveFrameWorkItems` in `replay.ts`: one rule, applied before the jump list. | `replay.test.ts` two cases. |
| F16 | **Adapter Session Step rows printed `digest: null`** — "No artifact registered." under a sentence promising the digest, over Evidence the fixture seeds. | `page.tsx` reads `readEvidenceItems` (already on the repository) and maps evidence id → digest. | `replay.spec.ts` asserts a 64-hex digest and the absence of the false sentence (see Verification). |
| F17 | **`replay.spec.ts` raced its own worker.** It seeds a bare `RUNNING` Run while the worker it spawns for frame grants is up; the population recovery sweep (every 5 s) claimed one as abandoned, reserved a REQUIRED artifact, and generation 21 refused the seal — the Story 5.3 trap, in a spec that copied `live-view.spec.ts`'s columns and not its checkpoints. Found by the run that was meant to observe F16. | The Run row, a `POPULATION_READY` population claim and an `EXECUTING` agent claim commit in ONE transaction (all four sweep predicates read against); the agent phase is set `TERMINAL` after the terminal transition; teardown deletes the population rows a lost race leaves. | Proven by the rows: `population_execution` at `RETRY`, claimed 5 s after the insert, and a `RESERVED` required `population_evidence`. Re-run green (see Verification). |

### After the PR opened — Codex's two findings, both real, both in code this PR wrote

Both have the same shape: a fix that stopped one line early.

| # | Finding | Fix | Proof |
|---|---|---|---|
| F18 | **The `matchMedia` guard returned BEFORE subscribing on a Safari 13 list** (`addListener` only, no `addEventListener`), so a tablet rotated across the 1024px floor kept its mount-time verdict and the supervision controls stayed live below the documented read-only floor. The guard this PR added to replace a throw, one line too early. | `subscribeViewport` in `live-status.ts`: `addEventListener` where the list has it, the legacy pair where only that exists, a list with neither observed once and never thrown on; `useDesktopViewport` calls it. Pure, so the branch no browser here can reach is unit-tested. | `live-status.test.ts`, three list shapes. **M1** deletes the legacy branch: the Safari 13 case fails. |
| F19 | **"Its frame is beyond the frames shown" was INFERRED from the global frame count.** Under a bounded read a Work Item that captured nothing was said to have a frame the page had not read, and an Escalation raised before the first frame — decidable under any bound, because the read holds the EARLIEST frames — got the same false sentence. F14's fix, one inference too far. | The resolver carries the reason: `ReplayJumpTarget` is a discriminated union (a frame with no reason, or a reason with no frame; a null index with no reason does not compile), `replayJumpTargets` takes `framesTotal` and decides `none-captured` / `none-before` / `not-read`, and the viewer's `absenceSentence` is exhaustive over that vocabulary. The bounded sentence is `not among the {shown} frames shown`. | `replay.test.ts` four cases, `ReplayViewer.test.ts` three. **M2** makes every null `not-read`: the complete-read case fails. **M3** infers the Escalation from the bound: the "even when the read bound" case fails. **M4** renders every reason as "no frame was captured here": two viewer cases fail. |

---

## Named, NOT fixed here — with the reason

Each is real. Each is either a product decision, a change wider than a review repair, or work
that belongs in its own commit with its own proof. None is silent.

**Owner decisions needed**

- **N1 — `app/error.tsx` says "Nothing was changed" over a committed flag** (from the 09-11 round).
  The sentence is EXPERIENCE.md's own and the boundary catches two failures with one claim.
  Product wording; bounded (`flag-run.spec.ts` asserts one row after a dropped acknowledgement).
- **Flag is rendered AFTER `LiveViewer`; Pause/Resume and Cancel before it.** 5.5's final
  criterion and UX-DR24 place all three together. Deliberate and documented in the diff; a stated
  criterion nonetheless.
- **`lifecycle.run-resumed` records no Step, and `run-paused` records none at two of three
  boundaries.** 5.4's AC says "resume records actor, time, and Step". A payload shape decision on
  an immutable chain, not a review repair.

**Wider than a repair — next commit(s), each with its own proof**

- **`readWaits` and `readObservationDeltas` bound at 500 with no total and no "it bound" sentence**
  (`run-detail-repository.ts:510,542`); `readFlags` bounds at 20 the same way. `readFrames` already
  returns `{rows,total}` — the shape to copy. Mechanical, but touches infra + page + viewer + tests.
- **`LiveGate` swaps `TerminalGate` for `SubscribedGate` when `cursor` flips to null, remounting
  `children`** — a typed flag note and a lost-response recovery banner vanish at the moment the Run
  ends. Fixing it means one component type with an unconditional subscription hook; the window is
  the second before controls are withdrawn anyway. Named, with that analysis.
- **`failure.frame-missing` is never flagged on Replay** (5.2's AC "flagged on Replay and export").
  The Replay page reads no Result; `framesMissing` has zero readers under `apps/web`.
- **The 1024px floor is two copies of one number** (`LIVE_VIEW_DESKTOP_MIN_PX` and `globals.css`
  `max-width: 1023px`) with the only test sampling 900 and 1280. Needs a stylesheet-reading test.
- **`RUN_ENDING_EVENTS` is pinned against retyped literals**, never against the producer constants
  in `complete-run.ts` / `cancel-run.ts`; both browser cases reach terminal via cancel, so
  `lifecycle.result-sealed` never crosses the gate in a test.
- **The adapter-stage pause arm is driven by no test**; **`pauseRunAction`/`resumeRunAction` have
  none** while `cancelRunAction` beside them has five; **no DB-backed test flags a Run with a real
  `audit-manager`** — `accounts.ts` has no manager state. (This environment now seeds one, so the
  follow-up is unblocked.)
- **`Digest.test.ts`'s tag scanner fails open** (a role outside its denylist is permitted; a tag it
  cannot terminate is skipped) and **`tokens.test.ts`'s scrubber-pill assertion is a whole-file
  substring** three other rules already satisfy — both demonstrated by the 5.8 verification layer.
- **`readObservationDeltas`'s payload key is asserted nowhere end to end.**

**Small, true, low-risk — batched for a tidy-up commit**

- Two UUID rules for one path (`actions.ts:98` vs `pause-run.ts:180`); `performPause(context as
  never)` in three test files; "after 30 minutes" as prose beside `PAUSED_TIMEOUT_MS`;
  `copy.test.ts` walking a two-file list; `PAUSE_UNKNOWN`/`RESUME_UNKNOWN`/`FLAG_UNKNOWN` retyped in
  `actions.ts`; the Rerun button's inline lost-response sentence; `ReplayViewer`'s Space guard is
  dead (the scrubber and jump list are SIBLINGS of the keyed element, so their keydown never reaches
  it) and arrows/Home/End check no modifier (Alt+ArrowLeft cancels browser Back); `Play` on a
  zero-frame Run latches; `epic-5-story-status.md` records generation 46 as 41 triggers (27);
  `durable-escalation-v1.md` names two identifiers renamed earlier.

## Dismissed

- *A run-ending event naming a different Run latches the gate* (5.7). The subscription URL is
  Run-scoped. **[verified false, 09-11]**
- *`EventSource` undefined leaves every control usable* (5.7). Reachable only outside a browser.
  Low.
- *Second-tab resume told Inconclusive with another's timestamp* (5.4). Not reachable through the
  command; see F6. **[verified 09-15]**

## Verification

Unit and typecheck gates, and the browser journeys over the touched surfaces, are recorded below
as they were run — a claim about a suite this environment did not run is not made.

**Gates, run on this machine against the working tree that is committed (Node 24.20.0, pnpm 11.25.0):**

| Gate | Result |
|---|---|
| `pnpm -r typecheck` | exit 0 (every workspace package) |
| `tsc -p tsconfig.root-tests.json` (root tests, after the spec change) | exit 0 |
| `pnpm boundaries` | exit 0 |
| `pnpm test` (Vitest, no database) | **206 files, 4201 of 4201 passed**, exit 0; re-run after F18/F19: **4209 of 4209**, exit 0 |
| `pnpm test:integration` | **not run here.** This round adds no repository, migration or worker code — `countOpenFor` already existed for the bell — so the integration suite is CI's to run on the PR. Stated, not assumed. |
| Full browser suite | **not run here**; the specs over every touched surface were (below). CI runs the full suite. |

**Unit mutations, each run against the fix removed and required to fail (files copied aside and restored from the copy, never `git checkout --`):**

| Fix | Mutation | Result |
|---|---|---|
| F1 `PauseBanners` unreadable wait | fall through to the request banner for `pause === null` | KILLED |
| F2 countdown | `WaitCountdown` removed from the Paused banner | KILLED |
| F3 plain words on Replay | print `wait.kind` instead of `escalationKindWord(wait.kind)` | KILLED |
| F3 `Object.hasOwn` guard | plain index into `ESCALATION_KIND_WORDS` | KILLED (`constructor` case) |
| F4 person's name on the Paused banner | print `pause.openedBy` | KILLED |
| F7 `fillTemplate` | chained `String.replace` restored | KILLED (`$&` case) |
| F6 `resumeRun` expired refusal | old "the Run is Inconclusive" sentence restored | KILLED |
| F9 inbox bound | `openTotal > open.length` short-circuited to `false` | KILLED (the `1 of 137` case) |
| F18 Safari 13 fallback | legacy `addListener` branch deleted | KILLED |
| F19 reason carried | every null index decided `not-read` | KILLED (complete-read case) |
| F19 reason carried | the Escalation's reason inferred from the bound | KILLED (bounded Escalation case) |
| F19 sentence | every reason rendered as "no frame was captured here" | KILLED (two viewer cases) |

**Browser, Playwright against the real web server, worker, Northstar and PostgreSQL 18 at generation 49:**

- Touched surfaces, fixes in place — `live-drop.spec.ts`, `pause-resume.spec.ts`, `replay.spec.ts`, `live-escalation.spec.ts`: **14 passed, 1 failed** (3.4 m). The failure was `replay.spec.ts`'s seed racing the spec's own worker — F17, diagnosed from the rows it left (`population_execution` at `RETRY` five seconds after the insert, a `RESERVED` required `population_evidence`), not from the assertion. The new dialog-dismissal test, the pause-resume name assertions and the live-escalation journey are in the 14.
- F8 `ConfirmDialog` mutation — the auto-dismiss EFFECT deleted, `live-drop.spec.ts -g "dismisses a confirmation"` re-run: **KILLED** at `expect(dialog).toHaveCount(0)`; source restored (two `cancelRef.current()` calls present). The `handleConfirm` same-tick refusal is defence a browser cannot deterministically reach and is not claimed as proven.
- `replay.spec.ts` after F17, alone: **7 passed** (55 s) — the whole-Run test now runs its adapter-digest assertions (a 64-hex digest rendered, "No artifact registered." absent). The two runs before it never reached a test: the first timed out Playwright's 180-second web-server wait while Turbopack compiled `/api/health` from a cold cache, the second failed the auth setup's 10-second shell assertion while `/sign-in` (10.7 s) and `/` compiled on their first request — the documented cold-`.next` case in CLAUDE.md, and the honest answer is a run with the cache warm. No product assertion was re-run after a genuine failure.
- The test database was checked after the run: 0 Runs, 0 Procedures, 0 `population_evidence`, 0 `run_evidence` — the widened teardown cleans up after itself.

**The one thing this round did not prove and says so:** the Escalation panel and flag note gating (F11, F12) are asserted by the unit suite on the `readOnly`/`aria-disabled` attributes only; that they are withdrawn in a live browser when the gate closes follows from the same `LiveGate` verdict `live-drop.spec.ts` already proves for the three controls, and is not separately re-asserted here.

## Note on the review harness

Two things cost a round each and are in CLAUDE.md so they cost nobody a third: editing a file
Next watches while a Playwright test sat inside its 60-second silence window remounted the page
and reset the silence clock (the failure read exactly like a product finding about reconnects);
and parallel shell calls share one working directory, so a relative path in one is decided by the
other's `cd`.
