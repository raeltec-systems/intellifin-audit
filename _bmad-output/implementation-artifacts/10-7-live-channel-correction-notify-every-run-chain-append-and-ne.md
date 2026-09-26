---
title: 'Live channel correction: notify every Run-chain append, and never lose the last refresh'
type: 'fix'
created: '2026-09-25'
status: 'done'
review_loop_iteration: 0
implementation_authorised: true
implementation_authorisation: 'Owner, 2026-09-26: "go, new branches OK" (implement 10.6 to 10.10 on new branches)'
baseline_revision: '429e08cf703fee6c5320f17b5983948709fd5bdf'
followup_review_recommended: true
deferred:
  - summary: >-
      The list stream replays nothing, so a change made while it (re)connects, or at its planned 14-minute end, reaches the bell and the Runs list only with the next qualifying event.
    evidence: |-
      openRunTimelineStream forwards the rows a notification names and has no cursor for runId null; a reconnect after end('lifetime') or a drop does not read what was appended in between. Pre-existing; this story made more events reach the list stream but did not add a replay.
    location: >-
      packages/infrastructure/src/runs/run-timeline-channel.ts, apps/web/src/shell/BellLive.tsx
    severity: medium
  - summary: >-
      The shell mounts BellLive only when the layout's open-item count succeeded, so a page whose count read failed gets no live badge updates.
    evidence: |-
      AppShell.tsx:95 renders BellLive inside the branch that has a count; app/layout.tsx:104-110 passes none when countOpenFor throws. Pre-existing.
    location: >-
      apps/web/src/shell/AppShell.tsx:95
    severity: low
  - summary: >-
      useThrottledRefresh measures its window with Date.now, so a backward step of the system clock delays the next re-read by the size of the step.
    evidence: |-
      The deferred re-read is scheduled from lastRefreshAt + REFRESH_THROTTLE_MS - Date.now(); a clock set back makes that interval longer. Pre-existing; a monotonic clock (performance.now) would not move.
    location: >-
      apps/web/src/runs/LiveBanner.tsx
    severity: low
  - summary: >-
      tests/integration/agent-isolation.test.ts "keeps concurrent authenticated Runs on the same origin in separate cookie and storage contexts" fails intermittently under load, at the baseline too.
    evidence: |-
      Measured in the review (P11): at 429e08c it failed 0 of 16 and then 1 of 16 depending on run order, and at this branch 3 of 16 and 1 of 16, always as the second run of a pair, at the same line (a snapshot capture after the other workspace is released, BrowserActionError unavailable). The test loads no file this story changed. Likely in the local browser capture after a release (packages/infrastructure/src/runs/browser-execution.ts).
    location: >-
      tests/integration/agent-isolation.test.ts:100
    severity: low
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

### Review patches (2026-09-26)

Review findings P1 to P11 (one high, three medium, the rest low), fixed in `9e227520` (P1,
P2), `990d934e` (P3), `b1946765` (P5, P6, P8), `142c0321` (P4, P9), `023f9729` (P7, P10) and
`1f4c55ea` (the P1 browser proofs), and recorded (P11) in the commit that adds this section.
Not pushed.

**What changed.**

- **P1, P2.** Once every append woke the channel, the Evidence inspector's own grant read woke
  the inspector again. On an active Run it re-read itself about once a second, and each re-read
  wrote two permanent chain events and one worker grant job. `refreshesSurface`
  (`apps/web/src/runs/refresh-events.ts`) now skips `evidence-access.*`, `notification.*` and
  `security.denied`, which no Run surface renders. It is an exclusion list, so a family added
  later still re-reads. Run Detail and the Runs list mount it through `SurfaceLiveBanner`,
  because both are server components and cannot pass a function. `LiveGate` asks it before it
  re-reads; its Run-ending latch is unchanged. `BellLive`'s filter and `LiveBanner.tsx` are
  unchanged. A source scan refuses any other direct `<LiveBanner` mount and pins both server
  call sites.
- **P3.** A source scan requires every `pg_notify('run_timeline', …)` in the package to
  stringify an object literal whose keys are `runId` then `sequence`, and names each offender by
  file and line. No notify site changed.
- **P4.** `bell-burst.spec.ts` deletes each Run's children, events and the Run in one
  transaction, the Run locked first.
- **P5, P6, P8.** Words only. The bell re-reads the page only on its own events (an Escalation
  raised, answered or timed out, a Run flagged, a Run ending), so Recent Runs, the versions
  awaiting approval and the Drafts stay as read until navigation, and the bell and a page's
  banner are two instances of one throttle. Before this story a per-Run stream found the three
  families at its next heartbeat (up to ten seconds later), and the list stream never saw them.
  The contract now says that the notify is for a Run's chain only, that the list stream
  forwards an event once only because every notifier spells the payload the same way (pinned
  by P3), and that the Run surfaces skip three families and why; it names the badge's events
  by `changesOpenWaits` instead of keeping a second list. Its Source section already defines a
  Timeline event as an append to a Run's chain, so "every append to a Run's chain" narrows
  nothing.
- **P7.** Two channel cases. A unit of work in a savepoint that rolls back, inside a
  transaction that commits, wakes nothing, and a later commit that takes its sequence arrives
  once. A narrated event appended when the Run's conversation is already full still wakes the
  stream, and the conversation takes no message for it. The bound was cheap to reach: it is
  checked on the conversation's highest sequence, so one message at sequence 1,000,000 fills it.
- **P9.** `OVERVIEW_OPEN_ITEM_LIMIT` lives in `overview-words.ts`. The Overview and the burst
  spec import the one constant, and both flags check, with the same message, that they are
  among the open items the Overview reads.
- **P10.** Every stream and raw LISTEN a channel case opens belongs to the case from the moment
  it is opened, and the case's `finally` closes them all, so a failure during setup no longer
  leaks a listener. The list stream's armed wait is bounded and names what did not happen.

**Tests** (Node 24.20.0, PostgreSQL 18, database `lane_b_test`).

- At `1f4c55ea`: `pnpm typecheck` (every package, then the root tests config) clean;
  `pnpm boundaries` clean, 806 modules; `pnpm test` 5404 of 5404 in 296 files.
- `tests/integration/run-timeline-channel.test.ts`: 14 of 14, three times.
- `tests/e2e/surface-refresh.spec.ts` (new; the inspector case and the Live View case): passed
  three times. `tests/e2e/bell-burst.spec.ts`: passed three times.
- Once each, in one run at `1f4c55ea`: `live-view` (8), `live-drop` (5), `live-timeline` (3),
  `live-escalation` (1), `pause-resume` (3), `flag-run` (6), `escalations` (3), `runs` (12),
  `run-surfaces` (11), `evidence-inspector` (4) and `overview` (3): 59 of 59.

**Mutations, each run and restored.**

| Mutation | Killed by |
|---|---|
| `refreshesSurface` returns true for every event | `refresh-events.test.ts` ("evidence-access.grant-issued: expected true to be false"); `LiveGate.refresh.test.ts` (6 re-reads, not 0) |
| `LiveGate` re-reads on every event | `LiveGate.refresh.test.ts` (6, not 0); `surface-refresh.spec.ts` Live View case (2 re-reads, not 0) |
| `SurfaceLiveBanner` re-reads on every event | `surface-refresh.spec.ts` inspector case (28 `evidence-access.*` events past the heartbeat, not 4) |
| A direct `<LiveBanner` on Run Detail, or on the Runs list | the source scan and the pin, each naming the file |
| The payload keys swapped at `runs/workspace-repository.ts:53` | the P3 scan: "the keys are [sequence, runId]" |
| A spread, an extra `JSON.stringify` argument, a non-literal payload at `db/audit-events.ts:137` | the P3 scan, each with its own named problem |
| The append's notify moved below the conversation's early return | the full-conversation case (`['1']`, not `['1', '2']`) |

**(a) `agent-isolation.test.ts` at the baseline.** Run in a detached worktree of `429e08c` with
its own install and this lane's database, interleaved with runs at `1f4c55ea`:

| Condition | Baseline `429e08c` | `1f4c55ea` |
|---|---|---|
| No added load, 4 runs each | 4 passed | 4 passed |
| Four CPU-bound processes; the baseline runs first in each of 16 pairs | 16 passed | 13 passed, 3 failed |
| The same load; `1f4c55ea` runs first in each of 16 pairs | 15 passed, 1 failed | 15 passed, 1 failed |

Four failures are the one case this record already named, at the same line: "keeps concurrent
authenticated Runs on the same origin in separate cookie and storage contexts", line 100, a
`BrowserActionError` of `unavailable` when Run B captures a Structural Snapshot after Run A's
workspace is released. The baseline fails it too, so it is not a regression of this story. All
four were the SECOND run of a pair, and none of the 32 first runs failed it: the first batch's
3 of 16 against 0 of 16 was the order, not the commit. The fifth failure was the first run
after the machine restarted, when Chromium did not launch within the test's 10-second limit
(line 67). The test's module graph holds no file this story changed: it loads
`@intellifin/domain` and `@intellifin/application`, both unchanged since `429e08c`, and ten
infrastructure modules (`runs/browser-execution.ts` and what it imports), none of which is
`db/audit-events.ts`, the one infrastructure source file this story changed.

**(b) What the notify costs.** Evidence reads and grant decisions now issue a NOTIFY, and
PostgreSQL serializes the commits of all notifying transactions on its notification-queue
lock; with P1 they happen at human pace (one page render or one frame load each), not in a loop.

**(c) What the burst proof observes on the Overview.** The Overview shows a count only past its
ten-item bound (`overviewBounded`, when a group holds more than it lists), so
`bell-burst.spec.ts` observes the Overview's re-read through the attention list's rows, which
the same server read returns, not through a count.

## Review Triage Log

### 2026-09-26 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 13: (high 1, medium 3, low 9)
- defer: 3: (high 0, medium 1, low 2)
- reject: 4: (high 0, medium 0, low 4)
- addressed_findings:
  - `[high]` `[patch]` The Evidence inspector re-read itself about once a second on an active Run: each render appends `evidence-access.*` events, which the append now wakes the page's own stream with. Run surfaces no longer re-read on `evidence-access.*`, `notification.*` or `security.denied` (`refresh-events.ts`, `SurfaceLiveBanner`, `LiveGate`); the Run-ending latch stays unconditional. Unit and browser proofs, each killed by mutation.
  - `[medium]` `[patch]` The Runs list re-read on every internal event of any Run; it mounts the same filtered banner, pinned by a source scan.
  - `[medium]` `[patch]` The list stream sends one frame per notification, so once-per-event depends on every `pg_notify('run_timeline', …)` spelling the payload byte-identically; a source scan now pins every site and names each offender.
  - `[medium]` `[patch]` `bell-burst.spec.ts` teardown ran separate statements without locking the Run; it now deletes each Run's rows in one transaction, the Run locked first.
  - `[low]` `[patch]` The `BellLive` JSDoc and the decision-log note said more than the bell re-reads; narrowed to what is true.
  - `[low]` `[patch]` The `audit-events.ts` comment overstated the old delay (a per-Run stream caught up on its 10-second heartbeat); reworded.
  - `[low]` `[patch]` No test for an append in a rolled-back savepoint inside a committed transaction; added.
  - `[low]` `[patch]` No test that the append's notify comes before the conversation's early return; added (a full conversation is one message at sequence 1,000,000).
  - `[low]` `[patch]` The contract note now records only what is true and names the badge's events by `changesOpenWaits`, not a third copy of the list.
  - `[low]` `[patch]` `bell-burst.spec.ts` retyped the Overview's item bound; `OVERVIEW_OPEN_ITEM_LIMIT` is now shared, and both checks give the same message.
  - `[low]` `[patch]` Channel test streams were opened outside `try/finally`; each case now releases every stream and LISTEN it opened.
  - `[low]` `[patch]` The notification-delivery case awaited `armed` with no deadline; bounded, with a message saying what did not happen.
  - `[low]` `[patch]` The verification record gained the `agent-isolation` baseline comparison, the NOTIFY-cost sentence and the Overview-bound statement.

## Auto Run Result

**Summary.** Every append to a Run's audit chain now issues `NOTIFY run_timeline` in the
appending transaction, as the channel contract already said (at least 18 writers relied on
their own notify, and Evidence access, notification delivery and the evaluation review's
`security.denied` had none). The bell's re-read is trailing, so a burst of flags never loses
its last refresh; the Overview follows through it. Run surfaces do not re-read on the three
internal event families, which stops a self-refresh loop the new notify would otherwise start
on the Evidence inspector.

**Files changed.**
- `packages/infrastructure/src/db/audit-events.ts` — the Run-chain NOTIFY in the append, before any early return; the narration's own notify removed.
- `packages/infrastructure/src/runs/run-timeline-channel.test.ts` — the payload-spelling scan over every notify site.
- `apps/web/src/shell/BellLive.tsx`, `BellLive.test.ts` — trailing throttled re-read and its unit cases.
- `apps/web/src/runs/refresh-events.ts`, `refresh-events.test.ts` — `refreshesSurface`, the exclusion list and its truth table.
- `apps/web/src/runs/SurfaceLiveBanner.tsx`, `detail.tsx`, `apps/web/app/runs/page.tsx` — the filtered banner and its two server call sites.
- `apps/web/src/runs/LiveGate.tsx`, `LiveGate.refresh.test.ts` — Live View asks `refreshesSurface` before it re-reads.
- `apps/web/src/overview/overview-words.ts`, `apps/web/app/page.tsx` — the shared Overview item bound.
- `tests/integration/run-timeline-channel.test.ts` — the channel cases through the real writers.
- `tests/e2e/bell-burst.spec.ts`, `tests/e2e/surface-refresh.spec.ts` — the burst and no-self-refresh browser proofs.
- `docs/contracts/live-timeline-channel-v1.md`, `CLAUDE.md`, this record, `sprint-status.yaml` — contract note, decision log, tracking.

**Review findings.** 20: 13 patched (1 high, 3 medium, 9 low), 3 deferred (1 medium, 2
low), 4 rejected (low). A pre-existing test flake measured during the review is also on the
deferred list.

**Follow-up review recommended: true.** A patched finding was high; patched medium 3 and low
9 give a score of 3 × 3 + 9 = 18.

**Verification.** On the patched head (`1f4c55ea`, record at `a4361cae`), Node 24.20.0,
PostgreSQL 18, database `lane_b_test`: package and root-tests typecheck clean; `pnpm
boundaries` clean (806 modules); `pnpm test` 5,404 of 5,404; the channel integration file 14 of
14 three times; `surface-refresh.spec.ts` and `bell-burst.spec.ts` three times each; 59 of 59
once across the live, pause-resume, flag, escalation, Run and Run Detail, evidence-inspector
and Overview specs. Every mutation in the record was killed. The full integration suite (785
of 786) and the full browser suite (285 passed, 12 skipped by their own opt-ins) were run on
the pre-review head; the one integration failure is the deferred `agent-isolation` flake.

**Residual risks.**
- The full integration and browser suites were not re-run after the review patches; the
  patches were verified by the focused runs above.
- Every Run-chain append now issues a NOTIFY, which serializes those commits on PostgreSQL's
  notification queue lock; evidence reads and grant decisions are human-paced.
- Story 10.8 also edits `docs/contracts/live-timeline-channel-v1.md` and
  `tests/integration/run-timeline-channel.test.ts`, and adds a heartbeat when a stream is
  armed: whichever of the two merges second must reconcile those files and re-run the channel
  tests.
- A separate draft PR by another agent (#55) implements this story too; the owner chose this
  branch.
