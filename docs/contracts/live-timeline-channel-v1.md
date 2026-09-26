# Live Timeline channel v1

The wire contract between the web server and a browser for the Run Execution Timeline
(AD-17). Consumers: Live View, Run Detail while the Run is active, the Runs list, the
notification badge. Version 1; a change to a field's meaning is a new version.

## Source

The Run's Timeline events are its audit-chain events: `audit_events` rows with
`aggregate_id = <run id>`, `sequence` allocated under the `audit_event_heads` row lock,
gapless and commit-ordered across writers. Every append to a Run's chain issues
`NOTIFY run_timeline, '{"runId":"<run id>","sequence":<n>}'` in the appending transaction;
an append to any other chain (a Procedure's, the platform chain) issues none. The
notification is a wake-up only: what is streamed is always read from the table.

The payload is spelled exactly that way everywhere, keys in that order. A transaction may
notify twice for one event (the append, and the writer's own port), and PostgreSQL delivers
the two as ONE notification only because their bytes are identical: it folds identical
(channel, payload) pairs of one transaction. A source scan
(`packages/infrastructure/src/runs/run-timeline-channel.test.ts`) requires that spelling at
every notify site.

## Per-Run stream

`GET /api/runs/<run id>/events[?after=<seq>]`, `Accept: text/event-stream`.

- Authorization: the `run.initiate` gate, before the Run is resolved. 401 unauthenticated;
  403 with `{"reason"}` and an audited denial; 404 after authorization for a Run that
  does not exist; 400 for a cursor that is not a non-negative integer.
- Cursor: the `Last-Event-ID` request header (what `EventSource` sends on a reconnect),
  else `after` in the query, else `0`. The header wins because a reconnect carries both
  and only the header is current. The first frames replay every event with
  `sequence > cursor`, in order, then the stream goes live.
- Frames, each terminated by a blank line:
  - `retry: 2000` once, at the start.
  - `id: <seq>` / `event: timeline` / `data: {"runId","seq","eventType","occurredAt","outcome","source"}`
    — one per Timeline event. `seq` is the chain sequence (a number), `occurredAt` an ISO
    8601 UTC instant, `eventType` the chain's closed `family.name`, `outcome` and
    `source` the chain's own fields. No payload travels: a consumer re-reads what it
    renders from the server at that sequence.
  - `event: heartbeat` / `data: {"at":"<ISO instant>"}` every 10 seconds while no
    Timeline event is sent. A client that has seen no frame for 15 seconds is stale, for
    60 seconds has lost the stream (UX-DR25).
  - `event: end` / `data: {"reason":"lifetime"|"unavailable"}` and then the response
    closes: `lifetime` after 14 minutes, so the client reconnects on its own schedule;
    `unavailable` when the server could not read the chain. `EventSource` reconnects
    after `retry` with `Last-Event-ID`, so no event is lost across the boundary.
- Guarantees: every event with `sequence > cursor` is delivered exactly once and in
  sequence order for the life of one stream; across a reconnect from the last-seen
  `seq`, the same holds. The route tears down its LISTEN when the request is aborted.

## List stream

`GET /api/runs/events`, same authorization, no cursor. For every `run_timeline`
notification it reads the named row and forwards the same envelope as
`event: timeline` / `data: {"runId","seq","eventType","occurredAt","outcome","source"}`,
with the same heartbeat and lifetime frames. It forwards one frame per notification, so it
forwards an event once because every notifier of that event spells the payload the same
way (see Source). It exists so a list and a badge can refresh (the badge only on the events
`changesOpenWaits` in `apps/web/src/shell/BellLive.tsx` names); it makes no replay
guarantee — a refresh reads the whole list — which is why it carries no `id`.

## When a surface re-reads

The streams carry every append. The Run surfaces (Run Detail, the Runs list, Live View,
the Auditor Workspace) re-read on every event except three families that no surface
renders: `evidence-access.*` (a read grant decided, a read recorded), `notification.*` (a
delivery recorded) and `security.denied` (a person refused an action). The reason is
evidence access: every read of a frame or a snapshot cell appends its grant decision and its
read record, both `evidence-access.*`, to the Run's own chain, so a surface that re-read on
them would re-read itself, about once a second, for as long as it is open on an active Run.
The rule is `refreshesSurface` in `apps/web/src/runs/refresh-events.ts`. It is an exclusion
list, so a family added later re-reads by default. The badge re-reads only on the events
`changesOpenWaits` names.

## What this contract does not decide

Which surfaces subscribe (UX-DR35 decides), what a surface reads when it re-reads, and how
Live View renders a frame (Stories 5.2 and 5.3).
