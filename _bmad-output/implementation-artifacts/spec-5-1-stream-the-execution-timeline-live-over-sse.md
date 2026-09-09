---
title: 'Story 5.1: Stream the Execution Timeline live over SSE'
type: 'feature'
created: '2026-09-09'
status: 'review'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-IntelliFin Audit-2026-09-01/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/planning-artifacts/epics.md'
  - '{project-root}/docs/contracts/live-timeline-channel-v1.md'
warnings: []
deferred:
  - 'Overview counts do not exist yet (the Overview page renders an empty state), so there is nothing there to subscribe; the hook is ready for the story that adds them.'
  - 'Live View itself (the session viewer, frames, chrome) is Story 5.3; this story delivers the channel, the subscriptions on the surfaces that exist, and the stale indicator those surfaces show.'
---

<intent-contract>

## Intent

**Problem:** Every Run surface is a request-time read behind `Updated {time}. Refresh.`
(UX-DR35). A person watching a Run reloads to learn anything, and Live View (5.3), the
Runs list and the notification badge cannot reflect progress within 5 seconds (FR24,
NFR7) without a live channel. The writer half of AD-17 already exists — every Timeline
append fires `pg_notify('run_timeline', {runId, sequence})` in its own transaction — and
nothing listens.

**Approach (AD-17):** one Server-Sent Events route per Run, `GET /api/runs/<id>/events`,
that LISTENs on `run_timeline`, replays every chain event with `seq > cursor` from
`audit_events` in order before streaming new ones, sends a keepalive at most every 30
seconds, ends its own stream under 15 minutes so reconnects are planned, and tears down
its LISTEN on abort. One list channel, `GET /api/runs/events`, forwards notifications for
the Runs list and the badge. The client resumes with its last-seen `seq`, so no event is
skipped and none delivered twice. No WebSocket, no Redis, no provider stream: live state
is read from PostgreSQL and nothing else.

## Boundaries & Constraints

- **The stream carries the chain's ENVELOPE, never its payload.** `seq`, `eventType`,
  `occurredAt`, `outcome`, `source`. A payload can hold every Observation digest of a
  batch and every diagnostic that quotes Target-System text; the surfaces re-read what
  they render from PostgreSQL at the sequence they were told about, through the readers
  they already use. The envelope is enough to reconcile a cursor, to say which kind of
  thing happened, and to refresh.
- **Gapless means read from the table, never from the notification.** A notification
  is a wake-up. On every wake-up and on every keepalive tick the route reads
  `sequence > lastSent` for the Run, ordered, so a lost or coalesced notification cannot
  lose an event, and `lastSent` only ever increases, so nothing is sent twice. The LISTEN
  is armed BEFORE the replay from the cursor, so an event committed during the replay is
  read by the wake-up that follows it.
- **Authorization is the Run's own.** The route calls `requireAction(request,
  'run.initiate')` — the action `openRun` gates viewing a Run with — before it resolves
  the Run, and answers 404 for a Run that is not there only after that, so an
  unauthenticated probe learns nothing. `route-access.ts` already lists the `live-view`
  family as protected.
- **The keepalive is an SSE event a client can see.** AD-17 says a heartbeat comment; a
  comment line is invisible to `EventSource`, and the 15-second stale rule (UX-DR25,
  NFR7) needs a signal the page can observe. The keepalive is therefore `event: heartbeat`
  every 10 seconds: inside AD-17's bound, and observable. It carries no Timeline content.
- **Lifetime under 15 minutes, by the server.** The stream closes itself at 14 minutes
  with `event: end`, so a reconnect is planned rather than proxy-forced (Railway closes
  responses after 5 minutes idle and 15 total); the heartbeat keeps it from idling.
  `EventSource` reconnects on its own with `Last-Event-ID`, which the route honours as the
  cursor beside `?after=`.
- **No auto-refresh anywhere the contract forbids it.** Run Detail subscribes only while
  the Run is active; a terminal Run keeps the plain `Updated {time}. Refresh.` banner. The
  Runs list subscribes. The bell refreshes only on the event types that change an open
  wait. Nothing else in the application subscribes (UX-DR35).
- **The no-JavaScript path stays.** The `Refresh.` link remains on every subscribing
  surface; the live banner enhances it and never replaces it.
- **No new storage, no migration.** The chain and the NOTIFY already exist.

## Delivered

- `packages/infrastructure/src/runs/run-timeline-channel.ts`: the channel name shared by
  the writers and the listener, the notification parser, the envelope reader and
  `openRunTimelineStream`, the engine that LISTENs, replays, forwards, keeps alive, ends
  itself and tears down; injectable timing so a test can run its whole lifetime in
  milliseconds.
- `apps/web/app/api/runs/[id]/events/route.ts` and `apps/web/app/api/runs/events/route.ts`.
- `apps/web/src/runs/live-status.ts` (the closed status machine: connecting, live, stale,
  lost, ended; thresholds 15 s and 60 s) and `useLiveTimeline`; `LiveRunBanner` on active
  Run Detail, `LiveRunsBanner` on the Runs list, `BellLive` in the shell.
- `docs/contracts/live-timeline-channel-v1.md`: the wire contract.

## Acceptance (each with its proof)

1. A committed Timeline event reaches an open per-Run stream, in order, with its exact
   `seq` — integration, real commands appending (initiate, cancel), real LISTEN.
2. A stream opened with `?after=<seq>` or `Last-Event-ID` replays every later event once
   and in order, then continues live; an event committed during the replay is neither
   skipped nor duplicated — integration.
3. Heartbeats arrive at the configured cadence; the stream ends itself at the configured
   lifetime with `event: end`; an aborted request tears down its listener — integration
   with millisecond timing, and a listener count that returns to what it was.
4. Unauthenticated → 401, wrong role → 403 (audited), unknown Run → 404, bad cursor → 400
   — unit and integration on the route.
5. Run Detail on an active Run reflects a new Timeline event within 5 seconds with no
   reload; the stale indicator appears after 15 seconds without a message and clears when
   the stream is back; a terminal Run has no subscription — browser, with axe.
6. The Runs list refreshes on an event for any Run; the bell count updates when a wait
   opens — browser.

## Verification status

- **Unit** (24 tests, 5 files): the notification parser refuses every malformed shape;
  every `pg_notify(` in the infrastructure source names the channel constant (a source
  walk, not a list); frame formats; heartbeat inside AD-17's bound and under the stale
  rule; lifetime under the proxy cap; the status machine at the 15- and 60-second
  boundaries and with a clock that went backwards; the cursor precedence; the per-Run
  route's 401-before-lookup, 403, 404, 400, 200 headers, cursor forwarding and 503
  without driver detail; the list route's gate; the banner's server markup; the bell's
  event filter.
- **Integration** (6 cases, PostgreSQL 18, events appended by the real `initiateRun` and
  `cancelRun`): replay from 0 then live delivery of the three cancellation events in
  sequence order with nothing repeated across further wake-ups; resume from cursor 2
  with page size 1 yields exactly 3 and 4; from the head, keepalive only; lifetime end
  with `event: end` and the listener released; abort with no end frame and the listener
  released; the list stream forwarding a newly initiated Run read from the chain; a dead
  database answered by `event: end` `unavailable`; every listener taken was released.
- **Browser** (3 journeys, 1.2 minutes, axe clean on Run Detail with the live banner):
  Run Detail on a queued Run shows the terminal state within 5 seconds of the real
  cancellation with a window marker proving no reload, then carries the plain banner;
  with the stream refused at the network the status reads connecting, then stale after
  15 seconds under a warning banner, then live again within the browser's own retry once
  the route is released; the Runs list gains a Run initiated elsewhere without a reload.
- **Typecheck** on infrastructure, web and the root test tree; boundaries; every
  mutation-harness anchor occurs once.
- **Not proven in a browser here**: the bell count changing on a wait, which needs a
  worker-produced Escalation; its filter is unit-tested and the journey lands with the
  Live View Escalation stories (5.6, 5.7). Overview has no counts to subscribe.
- **Hosted CI**: on the Epic 5 pull request when it opens.

</intent-contract>
