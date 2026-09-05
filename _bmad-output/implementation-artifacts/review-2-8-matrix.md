# Story 2.8 — acceptance evidence map

This map identifies the required proof and its verification history. All final local gates and formal/follow-up reviews are complete; see the final result below and the story specification.

| Frozen scenario | Required and implemented test surface |
|---|---|
| Immutability | Real PostgreSQL attempts to change every protected column on Approved/Active rows, state-plus-field and state-only bypasses, and a Retired definition. Existing command tests refuse authoring outside Draft. |
| First version approval | Lifecycle integration verifies immediate activation with no regression requirement. The complete P-1 browser journey must end Active through the normal approval action. |
| Unchanged tuple | Lifecycle integration approves an unchanged successor and verifies activation and its stored boundary. |
| Changed tuple | Lifecycle integration verifies Approved/pending regression with null activation and handover. Domain tests exercise configuration comparison. |
| Registration change | Both Target and Population Source commands: exact snapshot, atomic Draft/job/event creation, forced rollback, annotation no-op and replay. |
| Platform configuration change | Operational configuration-file function through durable revision, queued job and installed SDK over synthetic HTTP into submitted model metadata; unavailable configuration and unsupported contract refusal; no-op new revision and replay. |
| New version | Application copy/allocation checks and keyboard-driven browser action opening the selected new Draft while leaving Active unchanged. |
| Ripple warning | Actual Target and Source form dialogs distinguish annotation-only and digest-changing edits. Integration observes a competing save waiting behind activation and refuses stale confirmed impact before mutation. |

Additional contract checks:

- Out-of-number-order activation uses the activated chain tip and preserves multiple succession boundaries.
- Approval and activation record separate permitted state-machine edges in the same transaction; forced failure rolls back lineage, state, audit and notifications.
- A→B→A produces distinct changes; historical replay does not mint against later activations.
- Platform responsibility remains human, creation remains platform-authored, and actual human edits prevent self-approval.
- Persisted generation-13 approval remains readable, protected and unactivated after migration.
- Malformed lifecycle/origin/revision data refuses at the reader boundary; submitted/live definition disagreement refuses approval.
- Calendar tests cover exact boundaries, non-midnight launch times, week/month/year changes and once's absence of an automatic boundary.
- Browser coverage displays Draft, Submitted, Rejected, pending regression, platform Draft, Active and Retired states and scans keyboard/WCAG behavior.

Core test files: `tests/integration/immutable-versions.test.ts`, `tests/e2e/immutable-versions.spec.ts`, `tests/e2e/version-review.spec.ts`, `packages/domain/src/procedures/configuration-tuple.test.ts`, plus the existing Procedure command and concurrency suites. Test-source presence alone does not establish that these cases executed successfully.

## Verification progress — 5 September 2026

- Full unit suite: 79 files, 1,932 tests passed. The subsequent approval/activation audit-edge change also passed all 12 decision unit tests.
- Full integration suite after strict lifecycle readers and separate activation auditing: 14 files, 203 tests passed against PostgreSQL 18.6, schema generation 14.
- Type checking, dependency boundaries and schema generation passed; generation reported no drift.
- Focused lifecycle browser scenario passed, including both real ripple-warning forms, states, keyboard New version and accessibility checks. An initial Source assertion reloaded while its save was pending; the test now awaits the saved result before reloading.
- Full browser suite and production web build remain pending. Earlier browser startup memory failures and an interrupted unit run are not counted as passing evidence.
- The first full browser run found a real list-name query defect: an unqualified correlated reference could choose another Procedure's Draft name. Its 89 passes, six failures (including dependent cascades) and one skipped case do not satisfy the full gate. The fix explicitly qualifies the outer Procedure identifier and adds a persisted two-Procedure regression; complete checks are being rerun.
- After the list-query fix, the full PostgreSQL suite passed 14 files and 204 tests, including all 12 immutable-version integration scenarios. The full browser rerun is pending.
- The next browser run passed 95 of 96 tests, including the fixed list and every Story 2.8 scenario. Its sole failure exhausted a 15-second worker-start readiness wait before the worker reported ready; it is not a full passing result. The bounded readiness window is being corrected while preserving the actual ready signal and business assertions.
- With the worker's explicit readiness wait bounded at 45 seconds, the focused review suite passed all six cases (including setup). Production Next build then passed, including optimized compilation, TypeScript and page generation. The final full browser rerun remains pending.

Durable local command logs are under `C:/Users/opc/tools/intellifin-epic2-test/verification/`. Formal review begins after the remaining initial gates pass.

## Initial gate complete

The final full browser run passed all 96 tests without skips or failures in 6.6 minutes (`story28-final-browser-full3.log`). Production build, full integration (204 tests), full unit (1,932 tests plus the subsequent 12 decision-test recheck), package builds, type checking, dependency boundaries and schema generation without drift passed. Source is stable for formal four-layer review. Failed and interrupted attempts above remain diagnostic history, not passing evidence.

## Formal repair verification

All twelve formal findings were implemented and independently cleared. Repaired source passed package build, full typecheck, 26 focused unit tests and 17 focused integration tests. Subsequent focused browser attempts are not yet passing evidence: one was interrupted before tests, one exceeded a short navigation assertion despite reaching the correct Builder, and one exhausted startup while a stale Next cache returned 404 for the existing health route. Both navigation waits now have a reviewed 30-second bound without action retries. PostgreSQL readiness was confirmed; the stale cache was preserved on the same volume and a fresh run started. Final full results remain pending.

The final repaired full unit run passed all 1,950 tests in 81 files (`story28-reviewfix-unit-full4.log`, exit 0, 209.62 seconds), with the established single-worker/15-second local test bound. Earlier interrupted runs and a default-five-second run's two first-load timeouts are not passing evidence. Full integration and remaining checks are continuing.

Repaired full integration passed 209 tests in 14 files. Final typecheck and dependency boundaries passed (307 modules); migration confirmed generation 14 and generation reported no schema changes. After reviewed test-only fixture/selector corrections, focused browser run 8 passed all four cases including setup (workflow 37.7 seconds), with history beyond 100 versions, successor display, one POST and saved v105 under committed-response loss. Full browser and final production build are the remaining local gates.

The final repaired full browser suite passed all 96 tests without skips or failures (`story28-reviewfix-browser-full.log`, exit 0, 7.1 minutes). The final production build remains pending.

## Final local result

All gates passed after repairs: 1,950 unit, 209 integration, 96 browser tests; typecheck, boundaries (307 modules), generation-14 migration/no drift, package build and production web build. Production compiled in 54 seconds, passed TypeScript and generated all routes (`story28-reviewfix-production.log`, exit 0). Twelve repairs were independently cleared, with subsequent test-only corrections reviewed by the coordinator. Earlier pending/failed entries above are chronological evidence, superseded by this result.
