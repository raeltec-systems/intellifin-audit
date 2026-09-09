---
title: 'Story 5.3: Watch a Running Run in Live View'
type: 'feature'
created: '2026-09-09'
status: 'review'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-IntelliFin Audit-2026-09-01/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/planning-artifacts/epics.md'
  - '{project-root}/docs/contracts/live-view-v1.md'
  - '{project-root}/docs/contracts/live-timeline-channel-v1.md'
warnings: []
deferred:
  - 'Pause and Resume are Story 5.4; Flag to Audit Manager is Story 5.5. Live View ships READ-ONLY: a disabled control whose action does not exist yet is worse than a control that is not there. Cancel already exists on Run Detail and this surface links to it.'
  - 'The Step scrubber is Replay''s control (Story 5.8), so `session-viewer.scrubber-pill-height` stays deferred in `tokens.test.ts`.'
  - 'Story 5.2 has not run, so no Run in this repository has a provider recording. Live View shows FRAMES, which DESIGN.md already calls the platform''s Replay asset set; provider video, when retained, is a supplementary link a later story adds.'
  - 'The Escalation panel in place (UX-DR24) is Story 5.6. An Awaiting Auditor Run shows the AWAITING chrome here and its Escalation on Run Detail.'
---

<intent-contract>

## Intent

**Problem:** FR-24 requires an auditor to be able to watch an agent Run as it happens —
the workspace screen, the current Step, the Work Item, the Observations and the Evidence
as registered — and NFR-7 puts five seconds on it. Story 5.1 built the channel; nothing
uses it to show a screen. Today an auditor watching a Run sees a Timeline of row titles
and has no way to see what the agent is looking at.

**Approach:** one new surface, `/runs/<id>/live`, reached from the Run Detail rail's
**Watch** control and from a notification, exactly as EXPERIENCE.md's navigation map says.
It is a SERVER read on every refresh: the live channel carries sequence numbers, each one
makes the page re-read, and every fact on screen is what PostgreSQL held when the request
was served. The workspace screen is the newest REGISTERED `screenshot` bound through
`run_evidence_capture` to the `run_tool_action` that captured it, served by the Run's own
protected route, which consumes a worker-signed Evidence read grant on the server and
verifies the registered digest before answering the bytes.

## Boundaries & Constraints

- **No second read path for Evidence.** A frame goes through the Story 4.4 grant, with a
  third locator (`frame`) that names the KIND of read: a `frame` grant requires a
  `screenshot` of `image/png`, every other locator still requires a Structural Snapshot
  with an implemented substrate. Generation 42 widens the published binding trigger to
  admit both kinds and changes nothing else. `downloadWithGrant` is extracted so the
  snapshot cell inspector and the frame reader share one implementation of poll, verify,
  record.
- **The web never touches object storage.** `no-evidence-store-in-web` still fails the
  build on it, and no signed URL, bucket name or store host is ever in the markup or in a
  response header. The structural claim is asserted: every `src` on this surface is under
  `/api/runs/<id>/`.
- **Read-only.** No Pause, no Resume, no Flag, no Cancel. See `deferred`.
- **A stage that is empty says why.** Queued, awaiting the first frame, adapter-only, or
  unreadable: four sentences, one of them EXPERIENCE.md's own. An empty stage that says
  nothing reads as "fine", which a supervision surface must never do.
- **QUEUED gets no session word at all.** Stretching `LIVE` over a Run that has not
  started would print a fact that is not true — the "Active version: Draft" rule.
- **Everything a Target System supplied is untrusted.** The captured location and every
  diagnostic go through `UntrustedText`; the Audit Instructions are the auditor's own
  words in an inert `<pre>`.
- **NFR-7 needs an event.** `registerAgentCapture` now appends
  `execution.capture-registered` in the same transaction that registers the capture and
  notifies the channel, so a frame appears when it is captured rather than at whatever
  event happens to be appended next.

## Delivered

- `apps/web/src/runs/live-view.ts` (chrome vocabulary and its total map over `RUN_STATES`,
  dot classes, the planned-Step count read from the frozen plan, Step and frame narration,
  the four stage sentences) and `LiveViewer.tsx` (the session viewer) with `EndedBanner`.
- `apps/web/app/runs/[id]/live/page.tsx`: authorize, then read; the live banner while the
  Run is active and the ended Banner when it is not.
- `apps/web/src/runs/WatchControl.tsx`, rendered by `RunDetailFrame`.
- `apps/web/app/api/runs/[id]/frames/[evidenceId]/route.ts`, plus
  `apps/web/src/runs/evidence-grant-download.ts` (the shared grant consumption, extracted
  from the snapshot reader) and `evidence-frame-reader.ts`.
- `packages/application/src/runs/evidence-read-grant.ts`: `FRAME_LOCATOR`,
  `FRAME_MEDIA_TYPE`, the kind branch at issuance; `agent-capture.ts`: the capture event.
- `packages/infrastructure/src/runs/run-detail-repository.ts`: `readLatestFrame`,
  `readFrame`, `readAgentWorkPosition`, and the workspace identity on the Timeline read.
- `packages/infrastructure/drizzle/0042_frame_read_grant.sql` (generation 42) and the
  `SUPPORTED_SCHEMA_MIN`/`MAX` raise in the same commit.
- `apps/web/src/design/copy.ts`: the three contract sentences, pinned against
  EXPERIENCE.md and DESIGN.md on disk; `globals.css`: the `.ls-session*` rules, with the
  eight `{components.session-viewer}` values moved from deferred to implemented.
- `docs/contracts/live-view-v1.md`.

## Acceptance (each with its proof)

1. Live View renders inside a navy chrome strip with the state dot and word, the workspace
   identity, the isolation note and the Step counter (FR-24, UX-DR24) — SSR component
   test, and a browser journey with axe.
2. The workspace screen streams from the captured frames within 5 seconds (NFR-7) —
   browser, asserting a decoded image whose `src` is the Run's own route, within a
   5-second visibility bound.
3. The current Step, Work Item, Observations and Evidence as registered are shown, and an
   absent one is stated in words — SSR component test.
4. A frame is read only through a worker-signed grant, only as a `screenshot`, and only
   with the registered digest — integration on PostgreSQL 18 with the real issuance, and
   a browser journey where the real worker signs it; unit tests on the route's statuses.
5. An adapter-only Run has no screen and its Session Steps render as log rows (UX-DR25) —
   SSR and browser.
6. Below 1024px the surface is read-only with EXPERIENCE.md's floor sentence (UX-DR25,
   UX-DR36) — browser at 900px and at 1280px.
7. A Queued Run disables Watch with EXPERIENCE.md's own reason, and Live View says the
   same thing — browser, asserting `aria-disabled` and the visible panel sentence.
8. A Run that ends while Live View is open flips the chrome to REPLAY and names the
   terminal state with a link to Run Detail (UX-DR25) — browser, with a window marker
   proving the page re-read on the server rather than reloading.

## Verification status

- **Unit** (42 new tests across 4 files, in a 3,739-test suite that passes): the chrome
  map over the whole `RUN_STATES` vocabulary (no active state maps to REPLAY, every
  terminal one does, an unknown state gets no word); the four dot classes; the planned
  Step count; the frame's `alt` equal to its Step narration; the Tool Action word table
  over `PERMITTED_READ_ACTIONS`; the session viewer's markup (the `src` structural claim,
  the untrusted rendering, the four stage sentences, the absent-in-words rail, the ended
  banner); the frames route (authorize before lookup, 404s, the grant it asks for, the
  PNG headers, 304 without a grant, 503/403/502 mapping, every failure code mapped, no
  driver detail); the three copy constants against the artifacts on disk.
- **Integration** (5 new cases on PostgreSQL 18 at generation 42, in a file whose 14 pass):
  a frame grant issued over a registered screenshot yields the verified PNG and records
  the read; a frame grant over a Structural Snapshot and a cell grant over a screenshot
  are both `scope-mismatch`; tampered bytes fail the Run `RUN_FAILED` with
  `failure.evidence-integrity` and no read recorded; a screenshot with no capture binding
  is not a frame; one Run cannot read another's frame.
- **Browser** (9 cases, 52 seconds, axe clean on Live View): the frame journey runs the
  REAL worker so the grant is really signed, asserts the decoded image, the ETag, the
  `nosniff` and CSP headers, the exact bytes, and that every `src` is same-origin;
  adapter-only; the Queued Watch reason on both surfaces; Watch as a link that needs no
  JavaScript; the responsive floor at 900px and 1280px; and the REPLAY flip on a real
  cancellation with a window marker.
- **Mutation-proven** (both killed, restored from a copy): removing the `screenshot` kind
  check at grant issuance fails the scope-mismatch case; making the capture binding a
  left join fails the "only through its capture binding" case.
- **Migration, both paths**: empty → 42 on a fresh PostgreSQL 18 database; and a POPULATED
  41 → 42 upgrade on a database carrying a real Procedure Version, a Run and both Evidence
  kinds — at 41 a `frame` grant over the registered screenshot is refused by the binding
  guard with generation 41's own message, the real migrator then applies 42 to that same
  database, and afterwards a snapshot grant AND a frame grant both bind while an
  unregistered artifact is still refused and every pre-existing row is unchanged. The
  migration is a `CREATE OR REPLACE FUNCTION` and a `schema_meta` insert: no column is
  added and no constraint is validated, so it cannot fail on existing data.
- **Typecheck** on all six packages and the root test tree; `pnpm boundaries` clean at
  542 modules.
- **Not proven here**: nothing in this story. The remaining Live View rows of
  EXPERIENCE.md — Paused with the last frame held, Awaiting Auditor with the Escalation in
  place, the stream-lost banner disabling controls — belong to Stories 5.4, 5.6 and 5.7,
  which own the controls those rows disable.
- **Hosted CI**: on PR 25.

</intent-contract>
