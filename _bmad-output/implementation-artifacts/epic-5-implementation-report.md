---
title: 'Epic 5 implementation report: watch, control and replay a Run'
type: 'report'
created: '2026-09-10'
status: 'final'
---

> **Epic 5 is code-complete.** All eight stories are implemented and verified locally against
> a real PostgreSQL 18 at schema generation 46, a real Chromium and the real compiled worker.
>
> **Stories 5.1, 5.2 and 5.3 are already on `main`** (PR 25). This branch,
> `codex/epic-5-controls`, carries **5.4, 5.5, 5.7, 5.6 and 5.8** — the revised order, which
> `epic-5-context.md` explains. Nothing on this branch is merged.
> [PR 29](https://github.com/raeltec-systems/intellifin-audit/pull/29) is open against `main`
> and carries the first CI this branch has ever had: `ci.yml` triggers only on a pull request.

## 1. What an auditor can now do

**Watch a Run while it works.** `/runs/<id>/live` shows the agent's own workspace screen,
which Step is running, what the last Tool Action did, how many Observations exist so far, and
the auditor's frozen Audit Instructions. It updates itself: one Server-Sent-Events channel
carries nothing but the Run's audit-chain sequence numbers, and every number makes the page
re-read from PostgreSQL. So a frame on screen is a registered artifact whose digest was
verified when the platform froze it, never a value that travelled over a stream.

**Hold a Run, and let it go again.** Pause is honoured at the agent's next Tool Action
boundary, so the unit in flight finishes and commits — its Evidence, its Observations and its
Step Execution all survive. The Run then holds in `PAUSED` with a 30-minute deadline; resume
before it and the Run continues, leave it and the Run ends Inconclusive. The interrupted
attempt is marked `SUPERSEDED` and **given back**: pausing is not the agent failing, so it
does not spend one of the Work Item's bounded retries.

**Stop a Run, or raise a hand.** Cancel and Flag to Audit Manager are on Live View beside
Pause. A flag has no execution effect at all — the Run carries on exactly as it was — and the
Audit Managers are notified through the notification path that already existed.

**Answer an Escalation without leaving the screen.** When the agent stops for a question, the
panel appears in place, above the workspace screen rather than over it, and the answer resumes
the Run from the same page.

**Say plainly when the connection is lost.** After 15 seconds of silence the page says it is
not updating; after 60 it says the connection is lost and **withdraws every control**, because
a control that acts on a state the page can no longer see is worse than no control.

**Replay any finished Run.** `/runs/<id>/replay` plays back the session from assets the
platform owns — frames, sanitized actions, Session Steps, Escalations and Observation deltas —
with the Workspace Provider unreachable. It starts paused at the first frame, offers a
scrubber and a jump list, and re-executes nothing.

## 2. What this branch changed

| | |
|---|---|
| Migrations | **45** (`run_wait.kind = 'pause'`, four new CHECKs, the `opened_by` backfill) and **46** (`run_flag`, `notification.kind = 'flag'`, the three-arm `notification_context`, the immutability trigger). `SUPPORTED_SCHEMA_MIN`/`MAX` are both 46. |
| New surfaces | `/runs/<id>/replay`. Live View gained Pause/Resume, Cancel, Flag and the Escalation panel. Run Detail's rail now offers **Replay** on a terminal Run. |
| New contracts | `docs/contracts/run-pause-v1.md`, `run-flag-v1.md`, `replay-v1.md`; `live-view-v1.md` gained the control-gate and Escalation sections. |
| New browser journeys | `pause-resume`, `flag-run`, `live-drop`, `live-escalation` (Flow 3), `replay`. |
| Commits | 7, from `584582e` (Story 5.4) to `0fc8a7c` (Story 5.8). |

## 3. How it was verified

Everything below was run here, on this branch, against a real PostgreSQL 18 at generation 46,
a real Chromium, and — where a story needed one — the compiled worker process from
`apps/worker/dist/main.js`.

| Gate | Result |
|---|---|
| `pnpm -r typecheck` + root tests typecheck | clean |
| `pnpm test` (unit) | **3,955 passed**, 195 files |
| `pnpm test:integration` | **531 passed**, 44 files |
| `pnpm boundaries` (AD-1) | clean, 568 modules cruised |
| Playwright + axe | **full suite green** — see §3.1 |
| Migration paths | fresh install and 32 → 46 upgrade compared column, constraint and trigger counts; identical shape |
| Mutation testing | 3 guards for Story 5.5, each restored byte-for-byte and confirmed with `diff -q` |

Two things are asserted the hard way rather than the convenient way:

- **Replay is proven with the provider blocked at the network.** `tests/e2e/replay.spec.ts`
  aborts *every* destination but the application's own origin, counts the attempts, and
  requires the surface to render whole with the count at zero. A later change that reached for
  a provider fails there rather than in a deployment whose provider happened to answer.
- **The no-JavaScript path for Flag is proven in a browser with JavaScript off.** Flag is the
  one control here with no confirmation dialog, so it is the one that can work without script,
  and `flag-run.spec.ts` runs that case with `javaScriptEnabled: false`.

### 3.1 What the browser suite covers

Every new surface is scanned by axe against WCAG 2.1 AA with **no allowlist of accepted
violations**. The Flow 3 journey (`live-escalation.spec.ts`) starts where an auditor starts —
Initiate Run from Procedure Detail — then watches the Run, meets the Escalation the live
channel delivers, answers it in place, pauses with the 30-minute deadline measured on the wait
row, and resumes.

### 3.2 What is NOT claimed

- **Everything in §3 is LOCAL verification.** The remote verdict is CI on
  [PR 29](https://github.com/raeltec-systems/intellifin-audit/pull/29), which is the first CI
  this branch has had; read the five checks there rather than this table for it.
- **Story 5.2's live recording leg is unproven and cannot be proven here.** This environment
  holds no Solari key, and recording cannot be enabled for a session that already exists, so
  every recording case runs against a synthetic provider.
- **Story 5.4's worker-boundary leg is proven below the browser.** The journey calls the same
  `performPause` the three stages call at their boundaries rather than starting a worker and
  racing it to one; which marker a boundary reads, what it supersedes and that the attempt is
  given back are proven in the application and integration suites, and one of those is killed
  by mutation.

## 4. Decisions worth knowing

**A pause is a wait; a flag is not.** `run_wait` gained a `pause` kind because every mechanism
a wait already has — the one-open index, the delayed wake, the revision compare-and-set, the
recovery sweep — is exactly what a *held* Run needs. `run_flag` is its own table for the
mirror-image reason: a flag holds nothing, so all four would be machinery with no meaning, and
the one-open index would have made flagging a Run mutually exclusive with pausing it.

**A flag's note never enters the audit chain.** The chain is immutable, so anything that
reaches it can never be taken out, and a note is free text a person types. Only its length and
its digest are recorded; the note itself lives on a row that can be deleted with its Run.

**A resume restarts the current Step Execution, and this follows the story spec over
EXPERIENCE.md.** EXPERIENCE.md line 292 says the agent continues from the next Tool Action;
Story 5.4's acceptance criteria say the current Step Execution restarts from its first. The
story spec is the acceptance criteria and is the safer of the two — a page held for thirty
minutes is not the page the agent left. **This is reported rather than edited away**; it needs
your decision (§5).

**Live View's controls are withdrawn by a client-side gate, and that gate is honesty rather
than the guarantee.** With no JavaScript there is no channel to lose and no gate to close;
what actually refuses a stale action is the command, which re-reads the Run under its own row
lock. A withdrawn control is a person not being invited to do something that would be refused.

**Replay reaches nothing outside this platform, and that is a property of what it can reach.**
Every prop the viewer takes is a row PostgreSQL already holds; there is no provider client, no
workspace port and no outbound fetch anywhere on the path.

## 5. What needs you

Three of these are decisions only you can take. Two are one-line answers.

1. **Merge [PR 29](https://github.com/raeltec-systems/intellifin-audit/pull/29)** once its
   five checks are green. The PR is open with this report linked; opening it is what started
   the first CI this branch has had, so §3 above is local verification and CI is the remote
   one. The merge decision is yours — nothing here merges itself.
2. **Rotate the Solari API key** that was pasted into chat earlier in this engagement. It must
   be treated as disclosed.
3. **Set Solari recording retention to minimum.** `@solarisdk/browser@0.1.3` exposes no
   retention control at all, so this is an action against the provider account rather than a
   line of code. Recording also stays **off by default** — it is metered, and turning it on is
   a cost decision this build must not take for you. A Run made before it is switched on has
   no provider recording, permanently; Replay does not need one.
4. **Settle the resume semantics** (§4). Two options:
   - **Keep the current behaviour** — the Step Execution restarts from its first Tool Action.
     *Recommended.* It is the story's own acceptance criteria and the safer reading: a page
     held for thirty minutes may have changed underneath the agent.
   - **Follow EXPERIENCE.md line 292** — continue from the next Tool Action. Cheaper in model
     turns, and it trusts a page the agent has not looked at for up to half an hour.
5. **Confirm the desktop deferral.** `fixtures/northstar/datasets/systems.json` still says
   Epic 3 for LedgerDesk while `epics.md` places the desktop kind in Epic 7. You reaffirmed
   Epic 7 on 2026-09-06; the fixture text is the last place that disagrees. Nothing is blocked
   by it.

## 6. Where to look

- Contracts: `docs/contracts/live-view-v1.md`, `run-pause-v1.md`, `run-flag-v1.md`,
  `replay-v1.md`, `live-timeline-channel-v1.md`, `replay-asset-set-v1.md`.
- Verification level by story: `_bmad-output/implementation-artifacts/epic-5-story-status.md`.
- The decisions and the traps they came from: the four `2026-09-10` entries at the top of
  `CLAUDE.md`.
