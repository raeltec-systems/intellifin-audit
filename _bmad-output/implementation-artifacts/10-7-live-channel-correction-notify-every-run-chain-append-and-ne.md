---
title: 'Live channel correction: notify every Run-chain append, and never lose the last refresh'
type: 'fix'
created: '2026-09-25'
status: 'in-progress'
baseline_commit: '429e08cf703fee6c5320f17b5983948709fd5bdf'
review_loop_iteration: 0
implementation_authorised: true
authorisation: 'Owner continuation instruction and PR #54, 2026-09-26; supersedes preparation-only flag.'
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

## Continuation — 2026-09-26

The owner explicitly authorised implementation in the handoff and continuation request; PR #54 also records authorisation on 26 September. The older preparation-only state is historical. Current remote branches and recent PRs were checked before taking over: no pushed Story 10.7 implementation was found. Claude scratch work is not recovered. Branch `codex/story-10-7-live-channel` starts at main `429e08cf703fee6c5320f17b5983948709fd5bdf`, with no dependency on unmerged Story 11.1. Preserve all frozen intent. Do not merge or deploy. Run targeted unit and PostgreSQL channel checks, typecheck/boundaries, and the required browser burst proof; record any actual environment limit honestly. Do not commit or push from the implementation subagent.

## Implementation checkpoint — 2026-09-26

- Moved the Run NOTIFY into the common audit append path, outside conversation
  narration and before its size-cap return. Existing command-level notifications
  remain compatible: PostgreSQL coalesces identical channel/payload notifications
  within one transaction. No contract wording, migration, event type or UI row changed.
- `BellLive` now uses the existing `useThrottledRefresh` trailing throttle, preserving
  the Overview's shared subscription.
- Added a fake-time BellLive burst regression; PostgreSQL regressions for seven
  omitted type/source pairs, held commit, two open Run streams, list wake-ups, paged
  reconnect and rollback/heartbeat; and a browser burst regression with real flag
  commits and exact bell/Overview counts, checked without a reload.
- Verified locally with Node 24.20.0 / pnpm 11.25.0: targeted unit tests **11 passed**;
  `pnpm typecheck` passed (including root integration/browser TypeScript);
  `pnpm boundaries` passed over **802 modules**.
- **Still in progress:** PostgreSQL and browser regressions are written but have not
  run locally. The managed environment rejected the user/group operations needed to
  start the disposable PostgreSQL server. Hosted PostgreSQL/browser execution remains
  required before these acceptance legs can be claimed.

### Review corrections — 2026-09-26

- Added the conversation-cap boundary regression: a valid immutable annotation at
  sequence 1,000,000, followed by a narratable shared-writer append with no separate
  command notification. The test checks the exact list envelope/raw wake-up and that
  conversation metadata did not grow.
- Held-transaction staging now propagates append rejection and always releases and
  observes the transaction. Rollback proof explicitly requires a heartbeat and a
  completed reconnect replay. The browser burst counter matches this fixture's Run.
- PostgreSQL and browser acceptance remain pending hosted execution; these additional
  assertions are not claimed as passed merely because they compile.

### Hosted preview regression correction — 2026-09-26

CI `36229159682`, preview job `108368875487`, failed the existing disconnected-viewer
assertion: after setting the second context offline, the labelled preview region was
absent instead of displaying unavailable/out-of-date. The preview fetch catch retains
that region; the installed Next refresh implementation instead falls back to hard
browser navigation on failed RSC data. Newly notified evidence reads can leave a
scheduled page refresh at the disconnection boundary.

The shared throttle now keeps the required read dirty while the browser explicitly
reports offline, checks again when dispatching a timer, and flushes once on `online`.
It removes its timer/listener on cleanup. No event-family filter, stream health rule,
gate, timeout threshold or user-facing copy changed. Saved-frame URLs/keys remain stable
and cacheable; preview polling itself appends no events, so no sustained read/refresh
feedback loop was established by the code review.

Two fake-time tests cover a pending read becoming offline and an event received already
offline, including reconnect coalescing and cleanup. The bell/Overview browser proof
now additionally forces a scheduled read across an offline interval and requires its
final stored counts on return. The existing worker-preview proof retains all assertions
and also checks document identity across disconnection/recovery. Targeted local unit
checks pass **13 tests**; hosted browser/preview verification of this correction is
still required. This guards dispatch while already offline, not a network failure that
starts after a refresh request is in flight.

Local verification after the offline-dispatch correction: `pnpm typecheck` passed for
all packages and root tests; `pnpm boundaries` passed (802 modules); `git diff --check`
was clean. No hosted preview/browser pass is implied by these local checks.

### Browser fixture correction — 2026-09-26

Hosted candidate `7fc33a9` passed 5,394 unit tests, 783 PostgreSQL integration tests
(including nine channel cases), database/hydrated mutation checks, all 15 protected
preview checks, design checks and containers. Full browser CI `36229646300` passed
284 tests but failed the new burst fixture before opening the page: its first flag
was correctly refused because the Run was QUEUED. No refresh assertion was reached.

The fixture now seeds a RUNNING Run with held population and execution checkpoints
in one transaction, matching the established flag journey. The command's state guard
is unchanged. Flag assertions now report refusal reasons, and fixture cleanup removes
real notifications, flags and held checkpoints before deleting the Run. A new hosted
run must still prove the full browser journey; prior passing suites do not close it.
