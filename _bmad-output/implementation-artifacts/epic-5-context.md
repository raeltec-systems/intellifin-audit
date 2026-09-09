---
title: 'Epic 5 context: watch, pause and replay the agent'
type: 'epic-context'
created: '2026-09-09'
status: 'final'
---

# Epic 5 context

## What the epic is

Epic 4 made a Run work a web Target System on its own and stop for a person when it could
not proceed safely. Epic 5 lets a person WATCH that work as it happens, pause and resume it,
cancel or flag it from the screen they are watching, answer an Escalation in place, and
later replay any terminal Run from assets the platform owns, with the Workspace Provider
unreachable. Eight stories (`epics.md` §Epic 5); the delivery is the LISTEN/NOTIFY plus SSE
live channel, the shared session viewer, durable pause and resume, the Replay asset set
captured during execution, and the Replay surface.

## What is already true on the Epic 4 candidate, and must not be re-decided

- **The NOTIFY half of AD-17 exists.** Every Timeline append already issues
  `pg_notify('run_timeline', {runId, sequence})` inside the appending transaction
  (`runs-unit-of-work.ts` `notifyTimeline`; every worker stage and web command reaches it
  through its context). `sequence` is the Run aggregate's audit-chain sequence, allocated
  under the `audit_event_heads` row lock: gapless and commit-ordered across web and worker
  writers. The Run's Timeline events are its chain events, `audit_events` rows with
  `aggregate_id = run_id`, unique on `(aggregate_id, sequence)`. Nothing LISTENs yet.
- **The routes are already protected.** `route-access.ts` names the `live-view` family
  (`/runs/<id>/live`, `/api/runs/<id>/events`) and the `replay` family; default-deny covers
  them before a page exists. Viewing a Run is gated by `run.initiate` (`openRun`), which the
  events route reuses; `run.pause`, `run.resume`, `run.cancel` and `run.flag` are in the
  gating table already.
- **Run Detail and the Runs list deliberately do not poll.** `RefreshBanner` is the
  contract's `Updated {time}. Refresh.` link with no JavaScript, and both surfaces say Epic 5
  adds the live channel. UX-DR35: no auto-refresh of detail pages except Live View. The
  subscribing surfaces are Live View, Run Detail while the Run is active, the Runs list,
  Overview counts and the notification badge, on ONE channel (AD-17); everything else stays
  a request-time read.
- **Durable waits exist.** `run_wait` holds one open wait per Run with kind, options and
  deadline; pg-boss singleton `wait:<id>` with `startAfter = deadline`; closure commands lock
  the row under the expected Run revision. `PAUSED` is in the state vocabulary and in
  `RUN_CANCEL_TRANSITIONS`, and nothing produces it. Pause is a new wait KIND on the same
  mechanism with a 30-minute deadline (AD-16), never a second queue or an in-memory wait.
- **Every agent Tool Action already freezes a Structural Snapshot and a PNG screenshot**
  bound to the action through `run_evidence_capture`, with credential-entry actions
  recorded as `SUPPRESSED` (generation 29). A Replay frame is that screenshot; the sanitized
  action is the `run_tool_action` row; the Observation delta is the registration event.
  Story 5.2 adds the `replay` role and the `frame_missing` event; it does not add a second
  capture path, and `replay`-role artifacts never gate `SealPackage` (AD-5).
- **Workspace reattach is bounded by the provider.** Within one process `attach` reattaches;
  across a worker restart a Solari session cannot be reattached (`@solarisdk/browser@0.1.3`
  has no `sessions.get`), and the documented path is release, recreate, fresh positive
  authentication (`workspaceReplaced`). AD-16's resume uses exactly that path and records
  it; it never claims a reattach that did not happen.
- **`SOLARI_RECORDING` is threaded and off.** Turning it on is a metered cost decision and
  cannot be applied to an existing session. Story 5.2's "copy the recording into platform
  storage" is conditional on it and is NOT the source of Replay: the platform-owned frames
  are. A Run made before it is switched on has no provider recording, permanently.
- **The Escalation panel exists** (`EscalationPanel.tsx`, Story 4.8): the closed answer set
  with the Abort safety action appended by the application, the inert agent question, the
  countdown and the skip link. Live View mounts the same component (Story 5.6).
- **Cancel exists** (`cancelRun`, Story 3.10, honoured at the Tool Action boundary); Flag to
  Audit Manager does not, and is a new notification kind through the existing durable
  notification tracking (generation 35), not a new queue.
- **The hero-workflow rules hold on every new surface**: a control that mutates state never
  depends on JavaScript alone where it can avoid it; `aria-disabled` with a reason, never
  `disabled`; copy quoted from the UX contract lives in `copy.ts` and is pinned to the
  artifact on disk; every diagnostic and Target-System-sourced value renders through
  `UntrustedText`; a page that renders its own trail stands the shell's down.

## The design rules this epic binds

UX-DR24 (one session viewer for Live View and Replay: navy chrome strip with state dot
and word LIVE / PAUSED / AWAITING / REPLAY, live controls Pause or Resume, Cancel, Flag to
Audit Manager, the Escalation panel; replay controls play or pause, scrubber, jump list;
frames from the Replay asset set; adapter Session Steps as log rows). UX-DR25 (the Live
View surface states, including stale after 15 seconds and reconnecting after 60 with the
controls disabled, and read-only below 1024px). UX-DR26 (Replay starts paused at the first
frame and never re-executes). UX-DR27 (the Escalation panel). UX-DR35 (no auto-refresh
except Live View). AD-16 and AD-17 in the architecture spine are the rules; this document
does not restate them.

## Story order and why

5.1 (the channel: SSE route, LISTEN, cursor replay, heartbeat, lifetime, the subscribing
surfaces, the stale indicator) → 5.3 (Live View as read-only supervision from registered
frames) → 5.7 (stale, lost, ended while open) → 5.2 (the `replay` role, `frame_missing`,
the conditional recording copy) → 5.8 (the Replay surface with the provider blocked at the
network) → 5.4 (pause, resume, superseded pause, deadline to Inconclusive) → 5.5 (cancel
and flag from Live View) → 5.6 (the Escalation answered in place, the Flow 3 journey).

The channel comes first because every other story renders from it, and it can be proven
alone against the real chain: append events through the real commands, read them back over
the stream, cut the stream, resume from the cursor. Live View before Replay because the
frames it shows are the Replay assets, so the renderer is written once (AD-17: "a live
frame is a Replay asset the moment it is registered"). Pause last among the execution
changes because it touches the worker's Tool Action boundary and the wait mechanism, and
it is the one story that can leave a Run in a state nothing else produces yet.

## Migrations expected

One generation per story that needs storage, never invented up front: `run_wait.kind`
gains `pause` and the closure kinds gain `resume` (5.4); `run_evidence` gains a `role`
(`evidence` | `replay`) or a sibling `run_replay_asset` table with reservation, object key,
size, digest and the `frame_missing` / suppressed marks (5.2); `notification.kind` gains
`flag` (5.5). Timeline event types stay inside the nine closed families
(`lifecycle.run-paused`, `lifecycle.run-resumed`, `lifecycle.pause-superseded`,
`lifecycle.run-flagged`, `failure.frame-missing`). `SUPPORTED_SCHEMA_MAX` moves with each.

## The bar for "done"

Each story: unit (reducers, cursor arithmetic, SSE framing), integration (LISTEN/NOTIFY
under a real PostgreSQL 18 with events appended by the real commands; wait closure races
held open in `pg_stat_activity`), browser (the compiled worker against the synthetic
LoanCore; a forced stream drop and resume; Replay with the provider blocked at the
network), axe on every new surface, mutation-harness anchors repointed in the same commit
as any guarded line, a contract document under `docs/contracts/` for every wire or storage
shape a client depends on, and the story status recorded by verification level.
