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
| Commits | 17: seven story commits from `584582e` (Story 5.4) to `0fc8a7c` (Story 5.8), then the close-out and the **eight review-repair commits** §3.3 describes. |

## 3. How it was verified

Everything below was run here, on this branch, against a real PostgreSQL 18 at generation 46,
a real Chromium, and — where a story needed one — the compiled worker process from
`apps/worker/dist/main.js`.

| Gate | Result |
|---|---|
| `pnpm -r typecheck` + root tests typecheck | clean |
| `pnpm test` (unit) | **3,956 passed**, 195 files |
| `pnpm test:integration` | **533 passed**, 44 files |
| `pnpm boundaries` (AD-1) | clean, 568 modules cruised |
| Playwright + axe | **191 passed**, full suite green — see §3.1 |
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

### 3.3 The review round on this PR

Codex reviewed the branch and left ten findings. **Nine reproduced and nine are fixed.** The
tenth was examined and is not a defect:

- **A `PAUSED` Run that is cancelled left its pause wait open for ever.**
  `RUN_CANCEL_TRANSITIONS` gives such a Run to the command, so cancelling one ended the Run
  while its wait was still open — a row asserting an open question about a Run that is over,
  and one that then occupied `recoverableWaits`' bounded page permanently. Fixed as
  **generation 47**: a `withdrawn` closure kind, a deferred constraint trigger that refuses a
  terminal Run holding an open wait, and an `execution.wait-withdrawn` event. Its backfill
  was proven against a generation-46 database seeded with the real defect.
- **Pause takes no expected revision where Resume does — and that is the contract.** A pause
  records a marker and performs no transition: AD-16 makes it take effect *at the next Tool
  Action boundary, whenever that is*, so the revision the page was rendered at has no bearing
  on it, and refusing on one would refuse a pause for a reason the person could not act on. A
  resume performs `PAUSED → RUNNING` itself and must not run against a state nobody saw,
  which is what its revision is for. The staleness that does matter is caught already, under
  the pause command's own row lock. **This was accepted too readily in the first round and is
  corrected here**; the reasoning is now recorded at `parsePauseRequest` and in
  `run-pause-v1.md`, so it is met rather than re-filed.

Three of the nine were one rule with three holes — Story 5.7's gate withdrew only the
controls that ASKED it — so the gate moved DOWN into `ConfirmDialog`, which every
confirmation in the product already goes through. Four more were one limit in four places:
Replay renders up to 500 frames and then joined each against reads capped at 50.

The most serious was none of those. **A timed-out pause recorded an Escalation**:
`wakeEscalation` hard-coded the event type, the actor and `priorState: 'AWAITING_AUDITOR'`,
so every pause that ran out its thirty minutes wrote, into a row that can never be
corrected, that an Escalation timed out from a state the Run was never in. All three are
derived from the wait's own kind now.

The full round, and the traps inside it, is the top entry in `CLAUDE.md`.

### 3.4 The journey nobody had joined up

The owner could not test the product at all, and the reason was not in Epic 5. **The deployed
environment held one auditor and one administrator, and `procedure.version.approve` belongs to
an Audit Manager alone AND is denied to the version's own author** — so the auditor wrote a
version and was refused as its author, the administrator was refused by role, and the
create → approve → run journey stopped one step in, at a disabled Approve button whose reason
was correct and whose remedy did not exist.

**No suite could notice.** Every suite that approves a version mints its own `audit-manager` by
raw SQL first (`version-review.spec.ts`, `immutable-versions.spec.ts`, `runs.spec.ts`,
`version-decisions.test.ts`), and the browser suite's `ACCOUNTS` fixture holds exactly the two
roles it signs in as. A green suite says nothing about what a deployed environment *contains*.

Three things came out of it:

- **`tests/e2e/owner-walkthrough.spec.ts`** walks the whole journey through the interface —
  create, author four sections, wait for derivation, submit, approve as a manager, initiate,
  read the sealed Result — in about twenty seconds against a real worker, a real object store,
  real PostgreSQL and the real synthetic systems. Each half was already proven and the seam was
  not: `hero-workflow` authors to Submit and stops (no worker runs in it), `version-review`
  drives submit → reject → edit → approve, `clean-source` runs a P-2 Procedure from a version
  it INSERTS. It reproduces the whole golden P-2 outcome — eleven Observations and four failed
  Gate rows, which `p-2-sod-conflicts.json` names as its own reason for Inconclusive.
- **`seed-demo-accounts.yml` seeds three accounts.** An environment that is already seeded needs
  no re-run: a PoC Administrator can add an Audit Manager from Administration → Users, which is
  the same audited command. The workflow was run against production on 2026-09-10, so
  `manager@example.test` exists there now.
- **The Builder says which suggested systems the deployment actually has.** A Template offers
  its defaults by name and a registration is never minted from one — correct, because scope is
  the auditor's to declare — but P-1 suggests LedgerDesk, no deployment registers a desktop
  system because this release cannot execute one, and the caption listed it beside systems that
  *are* registered with nothing telling the two apart. An auditor reading it went looking for a
  system that is not in the picker, and the honest reading of that is that the Procedure cannot
  be built. Each suggestion now says one of three things: ready to add, no system with this name
  is set up here (and who can add it), or a desktop system this release cannot run.

`_bmad-output/implementation-artifacts/owner-walkthrough.md` is the same journey written for a
person, with the exact click path and what to look at when a step stops.

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

Three of these are decisions only you can take. The rest are one-line answers.

1. **Merge [PR 29](https://github.com/raeltec-systems/intellifin-audit/pull/29)** once its
   five checks are green. Every review finding is closed — nine fixed, one examined and
   refuted with the reasoning recorded (§3.3). The PR is open with this report linked; opening it is what started
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
   by it, and the Builder now states the consequence where an auditor meets it (§3.4).
6. **Check the worker's `CREDENTIAL_TOKENS` declares `cred://synthetic/northstar-readonly`.**
   That is the reference the seeded Northstar systems carry. A worker without an entry for it
   fails every adapter Work Item on the first attempt with `credential-unresolved`, and the Run
   reports every record uninspected — a real Result, for the wrong reason. The value is
   synthetic and authenticates nothing; every Northstar system is read-only at the system level
   and ignores it. This session cannot read the variable's value, so it is named rather than
   asserted.

## 6. Where to look

- Contracts: `docs/contracts/live-view-v1.md`, `run-pause-v1.md`, `run-flag-v1.md`,
  `replay-v1.md`, `live-timeline-channel-v1.md`, `replay-asset-set-v1.md`.
- Verification level by story: `_bmad-output/implementation-artifacts/epic-5-story-status.md`.
- The decisions and the traps they came from: the four `2026-09-10` entries at the top of
  `CLAUDE.md`.
