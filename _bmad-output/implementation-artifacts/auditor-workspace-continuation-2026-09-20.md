# Auditor Workspace continuation — 20 September 2026

Status: implementation in progress on `feat/auditor-workspace-v1-1`, PR #51.
No merge or deployment is authorized by this continuation.

## Verified starting point

Candidate `0298911c83358d82608b85ceb30ade589d5d100c` passed all six jobs in
[CI 35491390288](https://github.com/raeltec-systems/intellifin-audit/actions/runs/35491390288).
The run finished at 05:44 UTC on 20 September. Full application/browser accessibility
completed with 235 passing tests, focused authoring with 16, and P0 with 12. Unit/type/
boundaries, PostgreSQL migrations/integration/guard mutations, container checks and
hydrated worker/UI abuse all passed. These numbers describe their separate runs and
must not be added as a unique-test count.

This supersedes the pending-CI statements in the P3/P4 checkpoints for conversational
Resume, the inspector-filter readability repair, and the role-revocation console-test
correction. The lost-response conversational Resume browser journey passed. These
results close none of the seven overall proof gates.

## Delivery sequence

1. Confirmed conversational Stop through existing cancellation ownership, followed by
   exact-question answers and manager flags; complete the bounded explanation/intent experience.
2. Retry-safe controller renewal and continuous ownership visibility. Implement manager
   transfer under the separately granted authority approved in D3 on 20 September.
3. Versioned frozen strategies, predecessor/attempt prerequisites and worker consumption.
4. Complete selected-record/conversation/evidence/history synchronization and deep Replay.
5. Shared-workspace preview and exclusive private authentication assistance, with privacy
   fencing and validated handback for the declared synthetic flow.
6. Combined recovery/rollback, queue races, privacy, capacity and end-to-end acceptance.

These are sequential implementation slices of the user's complete request. A completed
slice does not defer or silently remove the remaining scope.

## Environment repair

The missing `uv` executable was an environment issue. Installed uv 0.12.17 at
`/home/codespace/.local/bin/uv` (already on PATH) and successfully rendered the build workflow.
Installed the pinned Node 24.20.0 runtime, pnpm 11.25.0 dependencies and Playwright's
Chromium. Prepared an isolated PostgreSQL 18 container and migrated it to baseline 56.
Only synthetic browser-test accounts were created. No production data or service was used.

## Decisions and proof gates

D2 must define/approve retention, sensitive-content removal, exports and provider-data
handling before real audit data is admitted. The user approved D3 manager control-transfer
authority on 20 September: an Audit Manager also needs a separately granted permission,
a required reason and audited epoch change; administrator status alone is insufficient.
Implementation and verification remain pending. See [the recorded D3 decision](decision-aw-manager-transfer-d3.md).
Neither decision prevents other synthetic development.

G1 auditor usability, G2 frozen strategies, G3 preview/private input, G4 data governance,
G5 recovery/rollback, G6 complete record-query evidence and G7 measured capacity remain
open. The implementation and executed proof for each later slice will be recorded below.

## Confirmed Stop — implemented and verified in CI

The conversation now retains a Stop proposal and requires explicit confirmation. It
uses the existing cancellation handler: a claimed worker receives a durable request,
and its normal safe boundary records cancellation and seals the partial Result.
Retrying the same proposal recovers its own recorded receipt. Role checks, governed
content availability, Run revision and frozen-plan identity are rechecked server-side.

Three independent reviews identified additional database-binding, governed-content
concurrency and verification gaps; those corrections are now implemented. The local
verification below applies to the corrected candidate. Pushed commit
`1c1ea0de064d68415c6398930e331742a6a88666` subsequently passed all six jobs in
[CI 35528130988](https://github.com/raeltec-systems/intellifin-audit/actions/runs/35528130988):
typecheck/boundaries/units, PostgreSQL migrations/integration/guard mutations,
container checks, P0 browser checks, full application/accessibility browsers and
hydrated worker/UI abuse. This supersedes the pending-CI statements for the Stop slice.
The run recorded 4,745 unit tests, 660 integration tests, 239 full-suite browser tests,
16 focused authoring tests and 12 P0 checks passing. The browser counts overlap and are
separate suite results, not an additive unique-test count.

### Review corrections and latest local proof

The corrected candidate makes an accepted cancellation marker immutable and binds it
to its Stop command, Run and actor. Applied receipts require the actual canceled Run
and sealed partial Result/package. Confirmation locks both governed content bodies;
post-lock authority refusal is audited. Stale proposals lose their confirmation affordance,
and exact Stop remains a Run-wide proposal when a question is open. The worker recovery
journey now kills the process after acceptance and must recover the same durable request.

- The expanded conversation integration suite passed **58/58** on a freshly migrated
  PostgreSQL 18 database (`intellifin_stop_final_test`). It covers concurrent confirmations,
  forged event/marker bindings, removed/corrupt proposal content, a removal race, changed
  plan, actual confirmation rollback, sealed-outcome checks and pause supersession.
- The other **602/602** integration tests passed in a separate disposable database.
  This run used the same candidate except the final migration tightening of worker/web
  prior-state ownership; the fresh 58-test run includes that final guard.
- Full TypeScript checks and final build passed. The corrected focused unit run passed
  39 tests. All 26 boundary tests passed in an isolated rerun after the earlier timeouts.
- The final unit run passed **4,719/4,719**, with the **26/26** dependency-boundary
  tests verified separately after earlier resource-related timeouts.
- All **seven targeted product browser journeys** passed across the combined run and
  isolated warm-route golden rerun, with zero Playwright retries. This includes terminal
  receipt reconciliation plus exact authenticated replay; queued lost-response retry;
  revoked Stop authority; controller races; Resume recovery; the golden P-4 result;
  and a real worker SIGKILL after Stop acceptance followed by normal recovery, one exact
  applied receipt, retained screenshot and sealed canceled Result.
- The combined run had nine passes and one cold-compilation failure. Its unchanged golden
  journey passed separately (four including setup) after route warming. Earlier external
  SIGTERM failures coincided with low available memory. Optional disk-backed Turbopack
  eviction resolved this host constraint; no worker deadline or product assertion changed.
- Final web TypeScript passed after the local-memory configuration and equivalent positive
  Node-runtime startup guard. The pushed candidate's remote CI has now passed as recorded above.

All seven overall gates remain open. Next: retry-safe controller renewal and continuously
fresh ownership, followed by exact question answers, flags, frozen strategies, fuller
explanation, complete review synchronization, protected preview/authentication and acceptance.
No merge or deployment has occurred.

## Controller renewal — implemented and locally verified

Renewals retain an immutable actor/Run/request-key receipt and recover the original
result without extending the lease twice. The browser retains uncertain requests across
reloads, renews on a stable schedule and withdraws stale ownership. Open Resume/deferred
confirmations remain visible during a brief ownership check but cannot submit until it
finishes; actual ownership loss or an epoch change invalidates an unsubmitted decision.

Browser verification exposed Next's shared Server Action queue: a held ownership read
could block later safety commands. Ownership reads now use a separately authorized,
uncached GET route with cancellation, generation checks and conservative expiry. The
corrected browser regression has proved safety Pause commits while a read remains held.

The complete PostgreSQL 18 suite passed **668/668 tests across 51 files** on 20 September
at 19:13 UTC, including all 13 lease tests, real 120-second expiry, exact duplicate
recovery, revocation, rollback, compound transactions and forged receipt guards. The
focused route/action/lease/storage unit run passed **65/65**. All application package
typechecks passed; the root test TypeScript invocation exceeded its local 768 MB heap cap
and then passed unchanged with a 1,536 MB cap. All **17 targeted browser journeys passed**
with zero retries. After separating expired-read warnings from mutation refusals, the
three affected browser checks passed again, including removal of the old warning after
a fresh read. These three overlap the 17 journeys and are not an additional unique count.

Two existing route-test modules exposed cold-import timing problems during the full unit
run. Their route imports now happen in an explicit setup hook before request assertions,
following the existing session-route pattern. All **20 tests** in those two modules passed
on the corrected rerun. The full unit run recorded **4,772 passes and four timing failures**.
The three route failures passed in that 20-test rerun; the remaining boundary timeout
and clean-workspace boundary check passed in isolation. All **4,776 cases** therefore
have a passing result across these runs; the original full invocation was not green.
All 26 boundary cases passed across the full run and recheck.

Final build, complete TypeScript and schema-drift checks passed at 19:23 UTC. The
renewal commit's own remote CI remains pending. See [the renewal specification and
review order](spec-aw-controller-renewal.md). The seven overall proof gates stay open.
