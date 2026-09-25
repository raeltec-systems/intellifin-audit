---
title: 'Live channel correction: notify every Run-chain append, and never lose the last refresh'
type: 'fix'
created: '2026-09-25'
status: 'ready-for-dev'
review_loop_iteration: 0
implementation_authorised: false
context:
  - '_bmad-output/implementation-artifacts/legacy-review-closure-register.md'
  - '_bmad-output/planning-artifacts/epics.md'
  - 'docs/contracts/live-timeline-channel-v1.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The closure register (Story 10.1, §3.1 item 1 and Story 5.1) found that at least
three families of events appended to a Run's audit chain issue no `NOTIFY run_timeline` in their
transaction: `evidence-access.*` (web frame and inspector reads; worker grant decisions),
`notification.in-app-delivery` and `notification.email-delivery` (worker), and the evaluation
review's `security.denied`. `docs/contracts/live-timeline-channel-v1.md` defines a Timeline event
as one of the Run's audit-chain events and requires the NOTIFY in the appending transaction. The
owner decided on 2026-09-25 (resolution B) to keep that meaning and repair the omissions, not to
redefine "Timeline event" to fit them. The register also found that `BellLive` drops a second
qualifying event inside its one-second window and schedules no later re-read, so a short burst can
leave the bell and the Overview one refresh short.

**Approach:** Issue the NOTIFY for every Run-aggregate append, at the one place every append
passes through if that is the smallest correct change, and prove it with transaction rollback and
reconnect behaviour. Make the bell's throttled refresh trailing: a throttle may delay, never drop,
the final refresh. Notifications stay wake-ups; every surface still reads the stored chain.

## Boundaries & Constraints

**Always:**
- A rolled-back append wakes nothing; a committed append wakes every open stream on that Run
  once, in order, and a reconnect with the last-seen `seq` receives it exactly once.
- The stored chain stays the only authority. No payload travels on the channel.
- The Overview keeps refreshing through the bell's shared subscription (owner decision
  2026-09-25); the test proves the shared mechanism refreshes the Overview's counts.
- A burst of qualifying events ends with the rendered bell count and Overview counts including
  the last relevant committed change, without a reload.

**Ask First:**
- Any change to the channel contract's wording beyond recording what is now true.
- Any new event type, migration or trigger-based NOTIFY.
- Making any of these event families a visible row on a surface (not required by this story).

**Never:**
- Narrow the definition of "Timeline event" or the "every append" guarantee.
- Start before explicit implementation authorisation (story preparation only, 2026-09-25).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Omitted family committed | `evidence-access.*`, `notification.*-delivery` or the review's `security.denied` appended and committed | Every open stream on the Run receives the envelope once, in order; `Last-Event-ID` resume replays it once | N/A |
| Append rolled back | the unit of work fails after the append | No wake-up, no envelope; the stream's next heartbeat sends nothing new | N/A |
| Reconnect during a burst | stream dropped after `seq` N; events N+1..N+k commit | Resume from N replays N+1..N+k in order, none twice | N/A |
| Bell burst | two or more qualifying events inside the one-second window | One deferred re-read after the window; the final rendered state includes the last committed change | N/A |

</frozen-after-approval>

## Code Map

- `packages/infrastructure/src/db/audit-events.ts` (`appendAuditEvent`) -- the one append path; today it notifies only for conversation-narrated events
- `packages/infrastructure/src/runs/evidence-read-grant-repository.ts`, `packages/application/src/runs/evidence-read-grant.ts` -- `evidence-access.*` appends
- `packages/infrastructure/src/notifications/notification-delivery.ts` -- delivery outcome appends
- `packages/application/src/runs/evaluation-review.ts` -- the review's `security.denied` append
- `packages/infrastructure/src/runs/run-timeline-channel.ts`, `tests/integration/run-timeline-channel.test.ts` -- the channel and its rollback and reconnect proof
- `apps/web/src/shell/BellLive.tsx`, `apps/web/src/runs/LiveBanner.tsx` (`useThrottledRefresh`) -- the trailing refresh
- `docs/contracts/live-timeline-channel-v1.md` -- unchanged in meaning; its sentence stays true

## Tasks & Acceptance

**Execution:**

- the NOTIFY for every Run-aggregate append, and the rollback case
- the trailing bell refresh
- tests: integration (rollback, reconnect, each omitted family), unit (`BellLive` burst), browser (bell and Overview after a burst, no reload)

**Acceptance Criteria:** as `epics.md`, Story 10.7.
