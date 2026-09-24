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

## Exact-question conversation answers — locally verified

The conversation captures the exact open question when a draft starts: Run, wait,
revision, deadline, raised-event identity and a digest of the complete ordered options
and their source context. Only a unique whole option label or ID produces an answer
proposal. Confirmation uses the existing answer handler without requiring controller
ownership. A draft for an earlier question cannot answer its replacement. Unknown
responses retain the original request; a definite pre-write refusal allows correction.

Migration 59 binds conversational wait closure to the exact command, audit event and
applied receipt. Missing, changed or removed intake/proposal content prevents confirmation.
Duplicate confirmation recovers the original outcome after fresh authorization. The Abort
option retains the established sealed partial cancellation result. Source question and
choice text appear in explicit untrusted-text disclosures, separate from platform instructions.

Three independent reviews produced corrections for source provenance, exact retry identity,
withdrawn content, bounded clarification, stale dialogs and storage-level Run transitions.
The revised PostgreSQL conversation suite passed **87/87**. A final source-removal projection
regression passed separately. The real compiled worker journey passed with zero retries:
it captured a synthetic ambiguous search result, raised its own question, consumed the
conversationally selected snapshot-bound candidate and produced only that candidate's
observation. The fixture substitutes one synthetic Northstar response; this proves the
application/worker contract, not model quality or a real hosted provider.

Five authenticated answer protocol journeys passed: replacement question, lost intake,
visible confirmation retry, a competing answer and revoked permission. Full unit verification
passed 4,785 cases and found one undefined class in the separate Replay slice. After its
correction, all 57 affected UI/stylesheet checks passed. The complete database run passed
all **703 existing and answer-related cases**; the separate selected Replay fixture had
one UUID tie-order expectation failure among its three new cases. Build, complete
package/root TypeScript, boundaries and schema drift passed. All four workspace browser
cases passed on the final rerun, including maximum-length source disclosures, geometry
and accessibility. The existing hydrated history control now gates the test's manual
scrolling; no geometry assertion was relaxed. Combined with the five answer protocol
cases and real-worker journey, ten unique targeted browser journeys have passing evidence
with zero retries. The pushed candidate still needs its own remote CI.

## Renewal CI findings and admission correction

CI 35532244865 for `4e2791d95abd1134ad7e7cb9a7cd57a4e7661fa0` completed with four
successful jobs. PostgreSQL passed 667/668: eight simultaneous 1,000-row record-query
reads exceeded 30 seconds while retaining stale Serializable snapshots during admission.
The correction takes admission before context/projection and releases transactions while
waiting. It bounds pool queuing and lock contention by a monotonic deadline, fences late
callbacks, and preserves fresh authorization and the two-snapshot limit. Cursor paging
bypasses creation admission.

The corrected 23-case PostgreSQL module passed locally; eight 1,000-row readers completed
in 2.1 seconds. Commit `fae6b5667196ec92cef338aa9a73b8b9d569ab7c` is pushed. Its CI
35535380156 has passed all **674 PostgreSQL tests**, units/type/boundaries, container checks,
P0 browser checks and the hydrated worker abuse job. Its full browser job finished
248/249, failing only the same 1280×800 layout assertion. The admission correction is
verified; the complete candidate is not green until the layout fix passes.

The renewal browser job passed 248/249. At 1280×800, wrapping controller controls clipped
the first decision option. The local answer/layout correction retains the 120px history
floor and strict geometry checks, including maximum-length source content. All four
workspace cases now pass locally. No merge or deployment has occurred;
all seven overall proof gates remain open.

## Native POST follow-up from candidate CI

CI 35537277008 passed typecheck/boundaries but its unit job passed 4,785/4,786: the
form-method safety check rejected the flag form's omitted method. The correction keeps
`method="POST"` on the native form and attaches the React action to its submit button,
through an optional typed `Button.formAction` prop. The safety check is unchanged.
All 221 form/flag unit cases passed. Two zero-retry browser journeys passed: actual
JavaScript-disabled submission proves POST with no query and the note in the body,
and the workspace journey proves successful conversation submission with no console errors.
Web and root TypeScript checks passed. The rest of this candidate's CI remains
independent evidence. No merge/deployment or overall proof-gate closure is claimed.


## Selected inspection Replay — implemented and locally verified

An auditor can open a retained inspection beyond the first 500 Replay frames. Dedicated
100-frame pages carry exact action/Step context, global session positions and cumulative
Observation counts from the full history. Links retain the selected inspection and reopen
paused. Invalid or empty selections never substitute another record. Failed protected images
retain their metadata and offer an explicit retry of the same Evidence ID.

Three independent reviews were reconciled. All five PostgreSQL cases passed, including
610-frame pagination, interleaved ownership, deterministic timestamp ties, foreign identity
refusals and a verified 5,508-event chain. The larger page query took 655.7ms locally;
fixture setup took 897.3ms. These measurements do not close capacity acceptance.

Both authenticated browser journeys passed with zero retries across separate runs. The
record-review journey follows its actual inspection link to an empty retained capture set;
the long journey proves late image decoding, reload, paging, playback, integrity refusal,
retry and role revocation. The initial combined invocation recorded one Chromium target
crash; the isolated long journey passed in 49.5 seconds. Browser off-origin telemetry does
not measure server/worker outbound calls.

The final combined local unit suite passed **4,812/4,812 tests across 250 files**. Build,
web/root TypeScript and final dependency boundaries passed. This includes the native POST
correction. See [the Replay specification and suggested review order](spec-aw-selected-replay.md).
Conversation/record/evidence/history synchronization remains required; all seven overall
proof gates remain open. No merge or deployment has occurred.

## Continuation update — 21 September 2026

Manager transfer is implemented locally after the approved D3 decision and three independent
reviews. Managers require an explicit grant and retained reason; confirmation binds the
observed controller epoch. Lost responses recover the exact receipt. Accepted safety holds,
open questions and review permissions remain intact. No automatic grants are introduced.

Combined verification passed 4,886/4,886 unit tests, 731/731 PostgreSQL cases, all package/root
types, dependency boundaries, package build and schema drift checks. Four actual Chromium
worker safety-boundary cases and both authenticated manager browser journeys passed. The
final transfer-module cleanup proof passed 21/21 and retained a valid nonempty platform chain
(26 events). The two previously failing answer-cleanup/empty-list browser cases now pass;
all 17 controller/workspace cases have passing evidence across the combined 16/17 run and the final strengthened 2/2 renewal/heartbeat pair. Original failed invocations remain in the manager report.

The latest pushed head remains 00de6c3: CI completed with five passing jobs and 255/258 browser
cases. Local corrections address cleanup lock order and the explicit queued-Stop retry race.
Final CI will verify the next pushed candidate. See [the manager report](report-aw-manager-transfer.md)
for original failed invocations, corrections and actual evidence.

Near-live viewing, conversation flags and frozen strategies are prepared in isolated worktrees
and await integration/acceptance. Synthetic Northstar identity/read-only proof is prepared;
exclusive private human input and controlled handback are not yet delivered. D2 remains the
real-data boundary. All seven proof gates remain open. A 30.8-second selected-Replay read in
the full database suite needs performance diagnosis despite passing semantic assertions.
Nothing has been merged or deployed.
