# AW P3 frozen strategies implementation checkpoint

Implemented in the isolated `feat/pr51-frozen-strategies` worktree from `00de6c3`.
No commits, pushes, services, database migration or browser suite were run here.

New Procedure drafts derive schema/compiler 2 and freeze a canonical capability graph.
Explicit compiler 1 derivation and validation preserve historical approval bytes without
steering authority. P-1's full-name search requires exact committed complete zero-match
employee-ID evidence for the same Run, target, Work Item, attempt and Step Execution.
Other templates gain no invented fallback capability.

The conversation captures one immutable strategy anchor at draft start, reviews its
subject/target, prerequisite evidence and control epoch, and confirms only the retained
command ID. The existing worker re-reads registered bytes/digests, checks the controller
and execution context under the Run lock, reserves one Tool Action ID before I/O, and
records applied only alongside that exact committed action. Retry, wait, stronger safety
and terminal boundaries retire pending selections. A dispatched action without a
committed result remains unknown and is never redispatched as command recovery.

SQL 0063 and schema declarations add four strategy adjunct tables, retained lifecycle
facts, exact audit/action guards and compiler 2 shape support. SQL establishes immutable
registered identity; only the worker can verify external snapshot bytes and completion.
The migration journal, snapshot and compatibility version deliberately await the parent's
0060/0061/0062 integration. The exact schema inventory includes the four new tables;
other feature inventories must be merged by the parent.

Actual verification completed:

- 176 focused tests passed across compiler/equivalence, domain execution, derivation,
  planner, conversation parsing and worker execution.
- 20 web rendering tests passed, including legacy approval copy and queued strategy
  semantics. The 56 worker tests also passed in that run.
- Domain and infrastructure typechecks passed during implementation. Final application,
  web and root test compiler checks exited 0. `git diff --check` passed.

On 2026-09-21, after the parent cleared the verification window, the final bounded
run passed all 60 tests: 56 worker tests (including the cleanup retirement change),
3 strategy server-action tests, and 1 configuration compatibility/regression test.
The command used Node 24.20.0, pnpm 11.25.0, `NODE_OPTIONS=--max-old-space-size=768`
and Vitest `--maxWorkers=1`; it exited 0 in 3.08 seconds. No services, builds, full
typechecks or database/browser suites were started. Source is frozen for parent integration.

Executable heavier proofs are present but have not been run:

- Five cases added to `tests/integration/agent-journey.test.ts` use the existing real
  PostgreSQL/local Chromium fixture: exact applied receipt and replay, confirmation
  rollback, changed controller epoch, revoked role, and unknown dispatched recovery.
  They also attempt direct proposal mutation/deletion, forged prerequisite references,
  and fabricated applied transitions. Cleanup preserves the platform audit chain.
- `tests/e2e/frozen-strategy-journey.spec.ts` uses a dedicated synthetic provider preload
  to hold an eligible fallback while the authenticated auditor reviews/confirms it.
  It checks 1280×800 accessibility/focus, exact transition/action linkage, two bounded
  search keys, preserved canonical absence evidence, and unchanged approval bytes.
  It runs the compiled worker and actual browser. It needs the synthetic conversation
  web configuration, Northstar, freshly migrated PostgreSQL and current compiled builds.

Parent follow-up: integrate this complete diff with the other reserved migrations,
finish focused/whole checks, run fresh migration and schema drift verification, execute
PostgreSQL/browser proofs, perform independent review, and record actual results before
commit/push. This checkpoint claims synthetic proof only, not live provider acceptance.

Final static review also corrected persisted review tool configuration: new approvals
stamp `executable-plan-v2`, readers retain explicit v1/v2 validation and enforce agreement
with compiled schema, and the existing configuration tuple makes a v1→v2 succession
require regression. The new `frozen-strategy-configuration.test.ts` proof passed in
the final bounded run above. Integrated full typechecks and heavier verification remain
with the parent.
