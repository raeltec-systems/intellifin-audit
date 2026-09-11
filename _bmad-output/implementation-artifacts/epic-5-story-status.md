---
title: 'Epic 5 story status by verification level'
type: 'status'
created: '2026-09-09'
branch: 'codex/epic-5-live-replay, from codex/epic-4-agent-runs @ 9da4df6'
---

# Epic 5 story status by verification level

The same five levels as `epic-4-story-status.md`: Implemented (code and tests on the
branch), Locally verified (real PostgreSQL 18, the real commands, a real browser on a
developer host), Remotely verified (hosted CI on the exact commit), Owner-reviewed,
Deployed.

| Story | Implemented | Locally verified | Remotely verified | Owner-reviewed | Deployed |
|---|---|---|---|---|---|
| 5.1 Stream the Execution Timeline live over SSE | yes | yes: 24 unit, 6 integration with the real commands, 3 browser journeys with axe (`spec-5-1-…`, Verification status) | CI `34318755939` green in all five jobs on `3a426a4` (PR 25) | no | no |
| 5.2 Capture the platform-owned Replay asset set | yes | yes: 3,764 unit (7 on `copyRecording`), 9 integration on generation 44 with the real repository and its four CHECKs, both migration paths compared column/constraint/trigger (526/751/40), 3 mutations killed | pending on PR 25 | no | no |
| 5.3 Watch a Running Run in Live View | yes | yes: 42 unit, 5 integration on generation 42, 9 browser journeys with axe and the real worker signing grants, 2 mutations killed (`spec-5-3-…`, Verification status) | pending on PR 25 | no | no |
| 5.4 Pause and resume a Running Run | yes | yes: 3,854 unit (16 on the commands, 4 on the three stage boundaries, 2 mutations killed), 17 integration on generation 45 against real PostgreSQL 18 including all five new CHECKs in both directions and the `opened_at` backfill read off the migration on disk, 2 browser journeys with axe (`pause-resume.spec.ts`); both migration paths reach 45 with identical shape (532/759/26). **Re-verified 2026-09-10 on a clean database run ALONE**: 43 integration files / 515 tests green, and 22 browser tests green across `escalations`, `live-view`, `pause-resume` and `runs` | pending | no | no |
| 5.5 Cancel and flag from Live View | yes | yes: 3,901 unit (27 on the command, 8 on the notification ports and the control, 4 on the domain vocabulary, 3 mutations killed), 16 integration on generation 46 against real PostgreSQL 18 including the immutability trigger, the note CHECK in both directions and all three arms of `notification_context`, 8 browser tests with axe (`flag-run.spec.ts`) one of which runs with `javaScriptEnabled: false`; both migration paths reach 46 with identical shape (539/764/41) | pending | no | no |
| 5.6 Answer an Escalation without leaving Live View | yes | yes: 3,925 unit (8 on the milestone ladder and the polite region, 3 on the shared mount's branch table, 1 pinning the skip link to EXPERIENCE.md on disk), 531 integration across 44 files, `pnpm boundaries` clean over 563 modules, 88 browser tests green with axe — one of them the Flow 3 journey `live-escalation.spec.ts`, which initiates the Run through the real surface, answers a choose-candidate Escalation in place and then pauses and resumes with the 30-minute deadline measured on the wait row | pending | no | no |
| 5.7 Live View when the stream drops or the Run ends | yes | yes: 3,918 unit (19 on `live-status`, 4 SSR renders of the gate itself), 531 integration across 44 files, `pnpm boundaries` clean over 562 modules, 140 browser tests green with axe across every web surface — 4 of them the new `live-drop.spec.ts`, whose terminal case HOLDS the server re-read so the `runEnded` window is observable | pending | no | no |
| 5.8 Replay any terminal Run | yes | yes: 3,955 unit (11 on the jump arithmetic, 9 SSR renders of the surface, 5 new ones on the widened `aria-label` scanner), 531 integration across 44 files, `pnpm boundaries` clean over 568 modules, 145 browser tests green with axe — 7 of them `replay.spec.ts`, which runs with EVERY off-origin destination aborted at the network and asserts the count is zero | pending | no | no |

**Story 5.2's live leg is unproven and cannot be proven here.** The recording copy runs
against a synthetic provider in every test: this environment holds no Solari key, and
`SOLARI_RECORDING` cannot be turned on for a session that already exists. And
`@solarisdk/browser@0.1.3` has no retention control at all, so "provider retention is set
to minimum" is an owner action against the provider account rather than a line of code.
Both are recorded in `docs/contracts/replay-asset-set-v1.md`.

**Story 5.4's worker-boundary leg is proven below the browser, not in it.** The journey
drives the real surface, the real commands and a real database, and calls the SAME
`performPause` the three stages call at their boundaries rather than starting a worker and
racing it to one. Which marker a boundary reads, what it supersedes, that the attempt is
given back and that a cancellation wins are proven in `execute-agent-work-item.test.ts`,
`execute-agent-steps.test.ts` and `tests/integration/pause-run.test.ts`, and the first of
those is killed by mutation.

**Story 5.4 follows epics.md over EXPERIENCE.md on one point, and the owner should settle
it.** EXPERIENCE.md line 292 says "on resume the agent continues from the next Tool Action";
Story 5.4's acceptance criteria say the current Step Execution restarts from its FIRST Tool
Action as a new attempt marked superseded. The story spec was followed — it is the
acceptance criteria and is the safer of the two, because a browser page held for thirty
minutes is not the page the agent left. The disagreement is reported rather than edited
away; `docs/contracts/run-pause-v1.md` states which was chosen and why.

**Epic 5 is code-complete on this branch.** All eight stories are implemented and locally
verified against a real PostgreSQL 18 at generation 46, a real Chromium and the real worker
process. Nothing is remotely verified yet: `ci.yml` triggers only on a pull request to
`main` and on a push to `main`, so no CI has run on `codex/epic-5-controls` since PR 25.

**Story 5.8 needed no migration and no new capture path**, which is Story 5.2's asset set
doing its job: `role`, `failure.frame-missing` and the recording copy were built so that the
surface rendering them would be a read. The one schema-adjacent change is that
`session-viewer.scrubber-pill-height` moved out of `tokens.test.ts`'s DEFERRED list, where
it had been since Story 1.4.

**Story 5.6 repaired two defects it did not introduce.** The Escalation countdown carried
`role="timer" aria-live="polite"` from Story 4.8, so a screen-reader user heard the clock read
out once a second for the whole wait instead of EXPERIENCE.md's two milestones; and the skip
link said `Skip to open Escalation` where the Accessibility rules say `Go to open Escalation`,
because it was typed inline in the component rather than pinned in `copy.ts`. Both are fixed
and both now have tests that read the artifact off disk.

**And it found a fixture trap that three browser specs carried.**
`{ ...activeRunVersion(...), controlName }` overrides a plan AUTHORING input after the fixture
has frozen its review, so the version can never own a period — the surface then says "No
executable Active version owns that period", which is a sentence about periods for a defect
that has nothing to do with periods. All three specs passed, because each seeds `audit_run`
directly; only a journey that clicks Initiate Run can see it. Repaired in all three.

**Story 5.7's verification repaired Story 5.5's fallout in `escalations.spec.ts`.** Story
5.5 renamed the inbox's open section and the plain-words pass replaced the printed
escalation kind with the question it means; neither re-ran that file, so its region locator
matched nothing, its `count()` returned zero and the bell assertion failed naming the wrong
thing. Both locators are repaired, the region is named once, the bell/inbox comparison
re-reads both sides together, and the row now asserts the plain-words question is present
AND that the identifier is not. Story 5.5's row above is unchanged: its own subject was
proven, and this is a test that was not re-run rather than a product defect.

## The PR 29 review round

Codex reviewed the branch and left ten findings. **Nine reproduced and nine are fixed. The
tenth was examined and is not a defect.** Full account in
`epic-5-implementation-report.md` §3.3 and, with the traps, in the two `2026-09-10` entries
at the top of `CLAUDE.md`.

| Finding | Verification level |
|---|---|
| A timed-out pause recorded an **Escalation** — wrong event type, wrong actor, wrong prior state, in a row that can never be corrected | Unit + integration; all three now derived from the wait's own kind |
| Story 5.7's gate withdrew only the controls that ASKED it (three holes: the Escalation panel, an open `ConfirmDialog`, the sub-1024px rule) | Gate moved into `ConfirmDialog`; unit + browser, mutation-killed |
| Replay joined 500 frames against reads capped at 50 (four places) | `REPLAY_PAGE_SIZE`; integration test reads past a Run Detail page |
| The inbox applied its limit twice and added the results | Unit + integration |
| **`[FIXED, generation 47]`** A cancelled `PAUSED` Run left its wait open for ever, occupying `recoverableWaits`' bounded page permanently | Unit + integration + SQL boundary + the deferred trigger; backfill proven on a generation-46 database seeded with the real defect; 2 mutations killed |
| **`[NOT A DEFECT]`** Pause takes no expected revision where Resume does | Examined: a pause records a marker and performs no transition, so AD-16's "at the next boundary, whenever that is" is its whole meaning; the staleness that matters is caught under the command's own row lock. Reasoning recorded at `parsePauseRequest` and in `run-pause-v1.md` |

Two verification lessons from the round, both now in `CLAUDE.md`:

- **A test whose fixture the server never sees cannot assert what the server does.**
  `live-drop.spec.ts` asserted a resume at SYNTHETIC sequences the chain never held; it
  passed here every time and failed in CI twice. Renamed to what it proves.
- **A test's NAME is a claim** — twice in one round. "Renders read-only below 1024px"
  asserted a sentence and nothing else, which is exactly why the viewport hole could sit
  under a green test named for the rule it was not checking.

Order of implementation and why: `epic-5-context.md`. The order was revised after 5.3:
5.7 moves to after 5.4 and 5.5, because its central criterion disables controls that do not
exist until those stories build them. Two of its three criteria are already met by 5.1 and
5.3; the third lands with the controls it governs.

## The journey a person walks

Not a story, and the reason it is here: the owner could not test the product, and the block
was not in Epic 5. It is in `epic-5-implementation-report.md` §3.4 and in the top `2026-09-10`
entry of `CLAUDE.md`.

| Finding | Verification level |
|---|---|
| **No deployment could approve a Procedure Version.** Approval is an Audit Manager's alone AND is denied to the version's own author; the environment held one auditor and one administrator | `seed-demo-accounts.yml` seeds three accounts; run against production 2026-09-10 |
| **The whole journey through the interface was never tested end to end** — each half was, and the seam between them was not | `tests/e2e/owner-walkthrough.spec.ts`: real web server, real worker process, real object store, real PostgreSQL, real synthetic systems; reaches the golden P-2 Inconclusive with eleven Observations and four failed Gate rows |
| The Builder named suggested systems the deployment does not have and said nothing about it | Unit (`target-suggestions.test.ts`) + browser; the caption states one of three things per system |

One test lesson from it, in `CLAUDE.md`:

- **A spec that selects seeded rows passes on a developer's machine and fails on a runner.**
  CI's browser job deliberately does not run `seed-northstar`, so the walkthrough makes its own
  registration and binding from the catalogue's own values. It also needed RoleMatrix beside
  AccessGate: a `versioned-file` Target System is what turns a role name into permissions, and
  without it no role expands and the Run reproduces only part of its golden outcome.
