# Live Timeline channel v1

The wire contract between the web server and a browser for the Run Execution Timeline
(AD-17). Consumers: Live View, Run Detail while the Run is active, the Runs list, the
notification badge. Version 1; a change to a field's meaning is a new version.

## Source

The Run's Timeline events are its audit-chain events: `audit_events` rows with
`aggregate_id = <run id>`, `sequence` allocated under the `audit_event_heads` row lock,
gapless and commit-ordered across writers. Every append issues
`NOTIFY run_timeline, '{"runId":"<run id>","sequence":<n>}'` in the appending transaction.
The notification is a wake-up only: what is streamed is always read from the table.

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
with the same heartbeat and lifetime frames. It exists so a list and a badge can refresh
(the badge on `execution.escalation-*` events only); it makes no replay guarantee — a
refresh reads the whole list — which is why it carries no `id`.

## What this contract does not decide

Which surfaces subscribe (UX-DR35 decides), what a surface re-reads, and how Live View
renders a frame (Stories 5.2 and 5.3).
