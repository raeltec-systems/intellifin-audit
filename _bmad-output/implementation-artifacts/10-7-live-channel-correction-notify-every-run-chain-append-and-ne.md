---
title: 'Live channel correction: notify every Run-chain append, and never lose the last refresh'
type: 'fix'
created: '2026-09-25'
status: 'in-review'
review_loop_iteration: 0
implementation_authorised: true
implementation_authorisation: 'Owner, 2026-09-26: "go, new branches OK" (implement 10.6 to 10.10 on new branches)'
baseline_revision: '429e08cf703fee6c5320f17b5983948709fd5bdf'
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

## Verification (2026-09-26)

**Commits** on `claude/10-7-live-channel` (not pushed): `9d4a0bbe` (the trailing bell re-read and
its unit test), `d11f35c3` (the append-level NOTIFY and the channel tests), `6eff369c` (the
browser test, the contract note and the decision log), and the commit that adds this record.

**What changed.**

- `packages/infrastructure/src/db/audit-events.ts`: `appendAuditEvent` issues
  `NOTIFY run_timeline, '{"runId","sequence"}'` for every append whose aggregate is a Run, in the
  appending transaction and before anything below it can return early. The conversation
  narration's own notify, which sat after an early return (a conversation at 1,000,000
  messages), is removed; the append's own covers it. The writers' `notifyTimeline` ports stay:
  they spell the payload the same way, so PostgreSQL folds the two into one wake-up. No
  migration, no trigger, no new event type.
- `apps/web/src/shell/BellLive.tsx`: the re-read uses `useThrottledRefresh` (trailing), the
  throttle Run Detail, the Runs list and Live View already share. A burst ends with one deferred
  re-read at the end of the one-second window. The Overview re-reads through it and opens no
  stream of its own.
- `docs/contracts/live-timeline-channel-v1.md`: the list-stream note now records which events
  the badge re-reads on (it said Escalation events only; flags and Run endings were added in
  Stories 5.5 and 5.7). The sentence "Every append issues NOTIFY" is unchanged, and is now true.

**Tests.**

- Integration, `tests/integration/run-timeline-channel.test.ts`, six new cases, each through the
  REAL writer: Evidence access from the worker and the web; both notification deliveries, on two
  per-Run streams and the list stream; the evaluation review's `security.denied`; an append whose
  unit of work fails after its work wakes nothing, and its committed retry arrives once; a resume
  from the last-seen sequence during a burst, with events committed between the LISTEN and the
  replay; any writer's append wakes its Run, and a Procedure's chain or a Run-shaped id that names
  no Run wakes nothing. Each stream is opened after its replay, with the heartbeat a minute away
  and a five-second deadline, so only a wake-up can deliver in time; the wake-ups are also counted
  on a separate LISTEN. Before the fix, the three family cases, the rollback case and the resume
  case failed for that reason. 12 of 12 pass, five times in a row.
- Unit, `apps/web/src/shell/BellLive.test.ts`, five cases: a burst ends with one deferred re-read
  at the window's end, a burst longer than one window keeps following, an event after the window
  re-reads at once, and an event outside the filter never re-reads. Two failed against the old
  throttle.
- Browser, `tests/e2e/bell-burst.spec.ts`: two Runs flagged through the real command inside one
  throttle window (the page's clock is fixed, so the second event lands inside the window on any
  machine). The bell and the Overview's attention list show the second flag without a reload, and
  the one open subscription on the page is the bell's list stream. It passed in all five runs:
  three alone, one among fourteen live-surface specs, one in the full browser suite.

**Whole suites** (Node 24.20.0, PostgreSQL 18, database `lane_b_test` at generation 61):
`pnpm -r typecheck` and the root-tests typecheck clean; `pnpm boundaries` clean (802 modules);
`pnpm test` 5394 of 5394; `pnpm test:integration` 785 of 786; the full browser suite 285 passed
and 12 skipped by their own opt-in conditions (for example the preview specs, which need
`WORKSPACE_PREVIEW_PROOF=1`). The one integration failure is not this story's:
`agent-isolation.test.ts` "keeps concurrent authenticated Runs on the same origin in separate
cookie and storage contexts" fails intermittently (3 of 4 runs on this machine) with an
`unavailable` Tool Action when Run B captures a snapshot after Run A is released. That test uses
no database, and its modules never reach the changed append path.

**Mutations, each killed.**

| Mutation | Killed by |
|---|---|
| No append-level notify | six channel cases |
| A notify for every aggregate (no Run guard) | the non-Run case |
| The payload spelled `{sequence, runId}` | the list-stream case, `[2, 2, 3, 4]` |
| The old leading-edge `BellLive` | `bell-burst.spec.ts` (bell stays at "1 unread"); two unit cases |
