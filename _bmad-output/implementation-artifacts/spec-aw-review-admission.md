---
title: 'AW hardening: admit concurrent review readers without stale-snapshot retry storms'
type: fix
status: done
baseline_commit: 4e2791d95abd1134ad7e7cb9a7cd57a4e7661fa0
review_loop_iteration: 1
context:
  - '/workspaces/intellifin-audit/.claude/worktrees/pr51-review-admission/AGENTS.md'
---

## Workspace and ownership

Work ONLY in `/workspaces/intellifin-audit/.claude/worktrees/pr51-review-admission`, branch
`fix/pr51-review-admission`. It is an isolated checkout of the pushed renewal candidate.
The main workspace has another agent's answer implementation and migration59: do not edit
or build there. Own `packages/infrastructure/src/runs/record-review-repository.ts`, its
focused integration tests and this spec. No migration, wider API or shared document edits.
Do not commit or push; parent owns review, validation, integration and authorized push.

## Evidence and intent

CI35532244865 passed667/668 PostgreSQL tests; the eight-reader test in
`tests/integration/record-review.test.ts` exceeded30seconds. Logs at the main workspace's
ignored `.playwright/pr51/logs/renewal-ci-integration.log` show repeated40001 failures.
`readPage` establishes a Serializable snapshot in `context()` before blocking on the
actor/Run advisory lock. Waiters then materialize1,000rows using stale snapshots and fail
late, repeatedly doing the expensive work. Do not hide this by increasing the test timeout.

## Chosen fix

For cursorless creation, make `pg_try_advisory_xact_lock` the first SQL statement in the
existing Serializable transaction, before context/authorization/projection. An unavailable
lock returns a private admission-busy sentinel, ends that transaction, then waits with
bounded jitter outside the transaction before trying afresh. Waiting must not retain a
database transaction or pool connection. Use a10second monotonic admission deadline;
keep cheap contention attempts separate from the existing bounded40001/40P01 retries.
Sanitize exhausted admission as unavailable, without SQL/parameters or internal errors.

The admission deadline also bounds waiting for a pooled connection. Race the transaction
promise against a monotonic deadline, and fence the callback both before its first SQL
statement and after the try-lock returns. An expired queued callback completes without
reading context or projecting rows; its eventual rejection remains observed. Successful
admission cancels the timer so an accepted transaction is awaited through commit/rollback.

After successful admission, authorize freshly and retain the existing coherent projection,
bounded cleanup and at-most-two actor/Run snapshots. Keep Serializable isolation: the
try-lock SELECT itself establishes a snapshot and a narrow acquire/commit edge still needs
the existing serialization retry fence. Cursor paging and other read methods stay unchanged.
No process-local authority/cache, session-level advisory locks, reserved-connection adapter,
global table lock or new schema. Installed postgres.js reserved handles lack runtime begin
and explicit per-connection disposal despite their types; do not build on that mismatch.

## Required verification

- Preserve and pass the existing eight-concurrent-first-read test and two-snapshot bound.
- Prove no expensive projection while another transaction owns admission; a waiting reader
  releases a one-connection pool so an independent query can complete before lock release.
- Prove role revocation while waiting is observed after admission and no snapshot is created.
- Prove another actor/Run is independent, and transaction failure releases admission,
  rolls back new snapshot rows, and restores evicted snapshots before a fresh read succeeds.
- Prove a saturated one-connection pool cannot extend admission beyond its deadline;
  release the pool afterward and prove the abandoned callback completes without projecting.
- Prove an existing cursor pages successfully while cursorless admission is held.
- Prove held admission eventually refuses within its bounded deadline, without leaking
  raw errors. Use real PostgreSQL barriers and durable assertions; no weakened timeouts or
  sleeps as evidence. Backoff itself may use bounded timer delays.
- Retain an actual before/after timing observation if practical, while distinguishing this
  regression proof from the full measured-capacity gate.

## Parent handoff

Pinned Node24.20.0 is at `/home/codespace/nvm/versions/node/v24.20.0/bin`; pnpm11.25.0
dependencies are installed in this worktree. Parent owns disposable DB creation/migration,
PG execution and broad checks. Run lightweight type/focused units only; report exact test
commands and readiness. A schema58 database named `intellifin_admission_test` will be used.

## Implementation handoff

Cursorless reads now try the transaction-scoped actor/Run lock before context reads.
Busy admission returns a private symbol, completes the transaction, and backs off for
25–75ms (capped by the remaining monotonic ten-second deadline). Admission attempts
do not consume the existing eight-attempt serialization/deadlock retry budget.
Exhausted admission returns only `{ status: 'unavailable' }`.

Four additional real-PostgreSQL tests cover a one-connection pool completing an
independent query while admission remains held, no context/projection before admission,
other actor/Run progress, role revocation committed while waiting, a real duplicate-key
failure after materializing 1,000 snapshot rows with rollback and admission release,
and bounded held-lock refusal. Barriers use completed PostgreSQL operations; timer
deadlines only fail broken barriers. The existing eight-reader and two-snapshot
assertions remain unchanged. Its elapsed time is retained in
`test-results/record-review-admission-timing.json`, explicitly scoped to regression
proof rather than the full measured-capacity gate. The recorded before observation
is the original CI eight-reader timeout beyond 30 seconds.

Verification on 2026-09-20 before the review follow-up:

- `pnpm --filter @intellifin/infrastructure typecheck` passed.
- `pnpm exec tsc -p tsconfig.root-tests.json --noEmit` passed.
- `pnpm exec vitest run apps/web/src/runs/RecordReview.test.ts` passed all 4 tests.
- Parent ran the real PostgreSQL focused suite against schema58
  `intellifin_admission_test`: all 21 tests passed. The eight-reader regression took
  4.24 seconds; held admission returned unavailable in 10.09 seconds. Parent retained
  `.playwright/pr51/logs/admission-focused-integration.log`. These observations close
  the focused regression proof, not the full measured-capacity gate.
- `git diff --check` passed.

Parent owns final review and broad validation; no migration, shared document, API,
commit or push changes were made by the implementation agent.

## Review follow-up

Closed the unbounded pool-queue path with an acquisition-only deadline and late-callback
fences. Busy attempts still finish their transaction before backing off. A queued expired
attempt may receive a connection later solely to complete its transaction; it cannot issue
the try-lock SELECT, read authorization, or materialize a snapshot. The timer rechecks the
monotonic clock before expiry to avoid a rounded timer firing early.

The two added PostgreSQL regressions cover saturated-pool expiry and cursor paging under
held admission. The rollback regression now starts with two snapshots, observes eviction
inside the failing transaction, and compares both prior headers and all rows after rollback.
There are 23 focused cases; parent must rerun PostgreSQL validation for these final changes.

Admission fixture setup now releases its owner if reader creation fails, closes a reader
whose connection probe fails, and resolves an abandoned owner barrier. A transaction-local
lock timeout bounds fixture lock acquisition. Cleanup restores roles and closes clients
even if releasing a held transaction fails.

Review follow-up checks: infrastructure typecheck, root integration-test TypeScript
typecheck, and `git diff --check` passed. Parent owns the final 23-case PostgreSQL result.

## Final review and verification

Three independent reviews identified pool-queue expiry, cleanup, cursor-independence and rollback-preservation gaps. These are corrected. Final PostgreSQL run passed23/23 in41.6seconds: eight readers completed in2.1seconds; pool-queue expiry10.06seconds and held admission10.07seconds. The preceding loaded invocation passed21/23; its paging assertion incorrectly rejected legitimate metadata reads, and eight-reader admission exhausted its deadline under concurrent heavy verification. The assertion was corrected and the unchanged deadline passed in isolation. This is regression evidence, not measured-capacity gate closure.

Infrastructure/root-tests TypeScript, four focused units, dependency boundaries and diff checks passed. Broad main-worktree checks were interrupted after review required answer changes; no full-suite pass is claimed for this fix before its own CI. No schema changes.

## Suggested Review Order

- Bound admission before projection, release waiting transactions, and reject late pool arrivals.
  [record-review-repository.ts:114](../../packages/infrastructure/src/runs/record-review-repository.ts#L114)

- Prove contention, deadline, cursor independence, and rollback of prior snapshot eviction.
  [record-review.test.ts:518](../../tests/integration/record-review.test.ts#L518)
