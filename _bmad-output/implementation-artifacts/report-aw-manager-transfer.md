# Manager control transfer: implementation review

Status (21 September 2026): implemented locally on PR #51 after three independent reviews and corrections. Local implementation verification is complete, including both authenticated manager-transfer journeys and passing evidence for all 17 controller/workspace regression cases. Fresh pushed-candidate CI remains required. Nothing is merged, deployed or admitted for real-data use.

An administrator can explicitly grant or revoke Run control-transfer permission for an Audit Manager. Managers receive no automatic grant. Demotion or role removal revokes it atomically; promotion cannot restore it. Revision checks prevent stale administration decisions from overwriting newer grants.

An eligible manager reviews the named controller, provides an encrypted governed reason and confirms the exact controller epoch. One transaction changes the lease, advances the epoch once and records an immutable event and receipt. Transfer does not resume execution, answer a question or remove accepted immediate/deferred Pause or Stop requests. Existing answer, approval and review permissions remain independent.

Reason text is excluded from audit events and notifications. Missing, corrupt or removed content refuses first confirmation; removal does not erase an applied receipt. Recovery retains the exact account-bound request. Reloading an unconfirmed proposal still requires review. A historical receipt never establishes current ownership.

Migration 0060 binds the exceptional live-controller transition to its proposal, lease marker, event and receipt. Stable identity and Run locks serialize grant/role revocation and competing transfers. No permission is granted by the migration.

## Review and verification

Three independent review layers completed. Reconciled corrections cover governed-content tombstones, account-bound recovery, receipt-only terminal lookup, dismissible unknown outcomes, repeated validation failures, bounded long reasons/focus, operational availability, actual grant visibility and indexed UUID lookup.

Completed local checks:

- Full unit suite: 4,886/4,886 across 256 files.
- Fresh PostgreSQL 18 full integration suite: 731/731 across 53 files.
- Package typechecks and root-test typecheck passed. The root compiler needed a 2 GB heap; its earlier 768 MB attempt exhausted memory. A subsequent new cleanup assertion needed explicit discriminated-union narrowing, which is corrected.
- Dependency boundaries: 701 modules, no violations.
- Final affected assertion/action unit tests: 21/21.
- Package build and migration generation passed; no schema drift.
- Actual Chromium worker safety-boundary proof: four deferred-Pause cases passed, including manager transfer during intermediate and final inspections.

Final transfer module rerun: 21/21 passed, including cleanup of synthetic accounts followed by a valid platform chain with 26 retained events. Both authenticated Chromium manager journeys passed without retries (1.6 minutes): grant/review/reload/lost response with observer narration, and historical/terminal receipt recovery with account-change isolation. All three authentication setup cases passed. The combined controller/workspace invocation passed 16/17. The remaining failure came from a renewal-test route callback outliving its test and surfacing in the following heartbeat case. Cleanup now releases injected gates and awaits active route handlers. The final strengthened pair passed 2/2 with zero retries (1.4 minutes). An intermediate rerun reported a missing Resume dialog; the original test did not establish that the opener succeeded before waiting for renewal. The test now asserts that prerequisite immediately. An isolated diagnostic passed with only the expected acquire invalidation, and static review found no D3 path that closes established confirmation during checking. Preserve this intermittent observation for combined hardening; do not describe the original 16/17 invocation as green. Temporary diagnostics were removed. All four workspace cases and the corrected explicit queued-Stop retry passed. A workspace restart interrupted the local PostgreSQL container; it was replaced using the retained volume. The resulting connection-refused invocation is recorded as failed, with no cases claimed as passing.

## Failures retained and corrections

The initial combined PostgreSQL run passed 729/731. The exact inventory omitted four migration-60 tables, and transfer fixture cleanup incorrectly removed part of the shared platform audit chain. Both are corrected; the fresh complete rerun passed 731/731. Cleanup now retains platform events and asserts a valid nonempty chain after removing synthetic accounts.

The first full unit run passed 4,884/4,885. The schema-range checker required the existing quoted schema seed convention; migration 0060 now follows it. The final complete rerun passed 4,886/4,886. An earlier negative storage test matched Drizzle's wrapper instead of the exact PostgreSQL cause; its SQLSTATE/message assertion now targets that cause.

The first manager browser invocation timed out during cold route compilation and is not a pass. The successful current verification used the same assertions. Its fresh route compilation completed within the existing timeout. The preceding setup attempt failed because the restarted Codespace had lost the temporary cache symlink target; restoring that directory fixed startup.

The pushed Replay candidate, 00de6c3, has five passing CI jobs and 255/258 passing browser tests. The three failures were a fixture cleanup deadlock, a later empty Procedures assertion after retained fixture data, and an explicit Stop retry racing authoritative receipt refresh. Local fixes acquire the Run lock before deleting children and hold competing refreshes until the real exact retry settles. Original request, receipt and domain-effect assertions remain. The answer-cleanup/empty-list pair and explicit queued-Stop retry passed on the corrected candidate.

## Limits and remaining work

One selected-Replay large-history read took 30,771.9 ms in the passing combined database run, versus approximately 586–656 ms in prior runs. Semantics passed; this timing remains unexplained and does not establish measured capacity. Retain and investigate it during performance acceptance.

D3 authority was explicitly approved on 20 September. D2 remains required before real-data handling. This slice does not close the seven overall workspace proof gates, deliver private authentication input or authorize merge/deployment.

## Fresh CI correction — shared platform history

CI 35570477577 on 86f3528 passed 728/731 PostgreSQL cases; the transfer module's cleanup hook and three later platform-chain assertions failed. The worker-journey fixture still deleted its manager-grant event before deleting its synthetic account. Depending on file order, another fixture later cleared the complete platform chain and masked the hole. The earlier local 731/731 result remains real but did not establish order independence.

A separate invocation of the missing-workspace journey reproduced the corruption: its test passed but subsequent platform verification returned false. Cleanup now retains that event and verifies a nonempty valid chain immediately after account removal. On the existing schema-60 test database, the same journey passed, then all 21 transfer cases and 57 administration/source/registration cases passed in explicit sequential invocations. The final platform chain was valid with 68 events. No production audit facts or hash-chain guards changed. Fresh CI must verify the correction.
