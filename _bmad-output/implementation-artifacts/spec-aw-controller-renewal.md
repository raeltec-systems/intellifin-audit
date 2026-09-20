---
title: 'AW P3: recover controller renewal and keep ownership visible'
type: feature
created: '2026-09-20'
status: done
baseline_commit: 1c1ea0de064d68415c6398930e331742a6a88666
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/docs/workstreams/auditor-workspace/spec-v1.1.md'
---

<frozen-after-approval reason="user authorized completion of the PR 51 workstream">

## Intent

**Problem:** A lost renewal response cannot be retried with its own durable receipt. The controller display can retain stale ownership, and its interval restarts on every refreshed read, allowing frequent Run events to delay renewal indefinitely.

**Approach:** Bind each renewal to a client request key, actor, Run and expected epoch; persist its result with the lease/event transaction. Maintain a stable renewal schedule and a fresh, conservative display of ownership across visible tabs and existing control surfaces.

## Boundaries & Constraints

**Always:** Use PostgreSQL time after the canonical Run lock. Freshly authorize receipt reads and mutations. Same actor/Run/key and payload return the original result without another extension/event. Changed payload conflicts. A receipt is historical evidence, not a claim of current authority. Preserve monotonic epoch and existing 120-second duration/30-second renewal policy. A hidden/disconnected view must not renew. Existing pause/Stop/exact-answer authority remains independent of ownership.

**Authority boundary:** D3 was approved on 20 September 2026 and is recorded in `decision-aw-manager-transfer-d3.md`. Implement it in its dedicated transfer slice; this renewal slice does not grant transfer authority.

**Never:** Revive an expired epoch; silently reacquire after an uncertain response; renew concurrently from one component; trust client time for authority; weaken database guards; merge or deploy.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| First renewal | Authorized live holder and fresh key | Same epoch, server-time expiry, retained event-linked receipt | All changes atomic |
| Response lost | Same key/epoch/actor retried | Original receipt, no later expiry or extra event | Retry retains original payload |
| Conflict | Same key with another epoch/operation | Refuse changed meaning | Original receipt retained |
| Ownership changed | Replay after release/reacquire | Original receipt only; fresh read shows current owner | Never restore old lease |
| Revocation | Role revoked before initial/retry request | Refuse access and mutation | No stale actor authority |
| Frequent events | Refreshes arrive faster than 30 seconds | Renewal still happens on stable cadence | No starvation |
| Read fails/lease expires | No confirmed current ownership | Visible unavailable/expired state; dependent controls disabled | No indefinite “You control” |
| Hidden tab | Tab hidden during timer | No renewal; refresh on return | Old epoch stays fenced |

</frozen-after-approval>

## Code Map

- `packages/application/src/runs/run-control-lease.ts`: `executeLeaseCommand`, exact request parser, `RunControlLeaseContext`, `persistTransition`; add bounded renewal receipt port and request identity while preserving existing acquire/release callers.
- `packages/infrastructure/src/runs/run-control-lease-repository.ts`: canonical Run lock, `runControlServerTime`, projection reads. Persist renewal receipt in this same transaction; exact result must bind the retained domain event.
- `packages/infrastructure/src/db/schema.ts`, `drizzle/`, `src/db/compat.ts`: additive immutable receipt schema, generation/journal/snapshot and truthful runtime range. Choose next unused migration after the prior slice is complete.
- `apps/web/app/runs/control-actions.ts`: server-authorized command/read boundary. Return receipt/current-state meaning separately; unknown outcomes remain explicit.
- `apps/web/src/runs/RunControllerLease.tsx`: current `setInterval` effect depends on `read`, so each successful refresh restarts it. Refactor timer lifetime, in-flight guard and retry identity independently of projected reads. Discard stale async reads after Run switch/unmount; preserve shared onRead callback.
- `apps/web/src/runs/RunPauseControls.tsx`, `apps/web/app/runs/[id]/workspace/page.tsx`: all ownership surfaces share the component; inspect QUEUED and terminal rendering without inventing authority.
- `packages/application/src/runs/run-control-lease.test.ts`, `tests/integration/run-control-lease.test.ts`, `tests/e2e/run-controller-lease.spec.ts`: unit authority matrix, real row-lock concurrency and authenticated browser receipt recovery.

## Tasks & Acceptance

**Execution:**
- [x] Add strict renewal identity and immutable result receipt through application/repository/schema/event validation.
- [x] Add exact same-payload replay and changed-payload refusal before current epoch admission, after fresh authority checks.
- [x] Repair renewal scheduling, retry unknown result using the original request, and clear stale ownership conservatively.
- [x] Prove concurrent duplicate renewal, no repeated expiry extension, rollback, revocation and replay after ownership changes in PostgreSQL.
- [x] Prove browser lost response, frequent invalidations, hidden/visible transitions and independent tabs without relaxing LiveGate or existing role tests.
- [x] Record actual proof and reusable scheduling/idempotency decisions in P3 checkpoint and `CLAUDE.md`.

**Acceptance Criteria:**
- Given frequent Run updates, when a visible connected controller stays on the page, then its legitimate lease renews and its epoch remains stable.
- Given a committed renewal whose response is lost, when the client retries, then only its original expiry/event are returned and fresh state remains authoritative.
- Given expiry or revocation, when the view cannot prove current control, then Resume and discretionary commands are unavailable even if an older renewal receipt succeeded.

## Spec Change Log

### Independent review — 20 September 2026

Three independent reviews found implementation and verification gaps within the existing
contract. Consolidated corrections preserve the original scope: fence reads during every
mutation; retain unresolved renewal identity across Run-state remounts/reloads; distinguish
temporary post-receipt reconciliation from lost ownership; keep historical confirmation
recovery available; compare conversational confirmation epochs; bound pending presentation
without overlapping mutations; avoid duplicate initial reads; and use indexed UUID/key
predicates for strict SQL receipt checks. Add expiry/slow-read, changed-owner recovery,
conversation invalidation, request-key isolation and compound-transaction evidence.

Ownership publication/identity losses are high-impact patches because they undermine the
slice's recovery and visibility guarantees. SQL lookup and duplicate-read issues are
medium-impact patches. Missing regression cases are required verification corrections.
These findings require no new product authority; D3 was separately approved and is recorded
in its dedicated decision surface. Verification remains pending on the corrected candidate.

## Design Notes

Store no chat text in renewal receipts. Scope idempotency to the actor and Run; include operation and expected epoch in comparison. Keep receipts through the Run lifetime to avoid recycling an old key. Browser presentation may conservatively expire a display using elapsed monotonic time from the last server timestamp, but server commands always decide authority. An unknown mutation must retain its exact key until reconciled; reading the current lease alone cannot prove which renewal committed.

Prefer the existing immutable `lifecycle.run-control-lease-renewed` event as the successful receipt, carrying a strict UUID request key and the expected epoch beside its existing resulting lease fields. Add an indexed unique binding for actor/Run/key when present, preserving historical events without keys. Validate the complete event identity and result shape when recovering it; do not synthesize success from the current lease. A separate immutable table is warranted only if an event-backed receipt cannot meet these invariants. Require a key for new renewal requests and update callers/tests; acquire/release retain their existing request contract and unknown-outcome behavior. The parser must reject a renewal key on another operation rather than ignore it.

Keep `onRead` callbacks and current lease/gate/busy state in refs (or an equivalent stable callback design) so routine read projection updates do not restart the timer. Fence overlapping refresh responses by request generation and Run identity. A current role/read failure or elapsed expiry publishes unavailable/not-held ownership to dependent controls immediately; an older successful async response cannot restore it. A successful renewal receipt is followed by a fresh read. Renewals serialize within the component, and retries preserve their payload/key until a definite outcome. Independent tabs may legitimately renew under separate keys; they must never override epochs or conceal a transfer.

## Verification

- `pnpm typecheck`, `pnpm boundaries`, focused lease unit tests, then full unit suite.
- Apply migration only to the disposable PostgreSQL 18 database; `pnpm db:generate` must show no drift.
- Run lease integration and browser tests with zero retries. Parent coordinates database suites to avoid shared fixtures racing.
- Full CI on each pushed candidate is required before claiming remote verification; no merge/deploy.

Implementation handoff: parent coordinates PostgreSQL/browser suites and final review. Do not commit or push; report changes, exact checks and remaining work. Use pinned Node 24.20.0 from `/home/codespace/nvm/versions/node/v24.20.0/bin`. Migration 57 is the current completed baseline. Do not alter other draft specs.

### Resumption checkpoint — 20 September, 18:54 UTC

The environment restarted after review corrections were partially implemented. Preserve
the existing worktree changes. Root owns disposable environment setup and all heavyweight
checks; do not duplicate those runs. The SQL migration and 13-case integration test file
have completed root review and verification (12 cases passed together, then the terminal
case passed with the actual queued cancellation/sealed Result handler). This includes a
real 120-second PostgreSQL expiry. Do not rewrite that work. Schema generation showed no
drift; schema-range tests passed after quoting the version seed. The earlier full unit run
had 4,746 passes, seven route tests skipped after a cold import hook timeout (all seven
passed in isolation), and the subsequently corrected schema-format failure. Full types
passed before the final UI corrections. Temporary logs disappeared with the environment;
final corrected checks must produce new retained verification evidence.

The UI now has strict bounded sessionStorage request recovery, a Run-wide outstanding
mutation guard, a distinct checking projection, a stable workspace controller owner,
confirmation epoch checks and explicit unknown-result recovery. Review these changes for
completeness. Existing new browser tests cover remount/reload plus changed ownership,
heartbeat preservation, delayed-read expiry, failed/newer-read fencing and hidden tabs.
Finish any missing regression coverage from the review above, especially conversational
Resume/deferred confirmation invalidation and same-actor epoch changes, while keeping
Stop independently usable. Run only focused lightweight unit checks if useful; report
the ready test names to root, who will execute types, PostgreSQL and browser suites.

### Browser transport correction — 20 September, 19:04 UTC

Six browser journeys passed before the delayed-read cases exposed a transport constraint:
the installed Next 16.3.4 Server Action queue serializes ownership reads with mutations.
A hung read prevents later reads and can block renewal or safety actions; a presentation
timeout does not release that framework queue. Move only controller reads to an independent
`GET /api/runs/<id>/control` route using fresh `requireAction(request, 'run.resume')`, then
the existing bounded `readRunControlLease` repository read. Return no-store responses
including denials/errors; use same-origin uncached fetch with AbortController cancellation
and the existing generation/expiry fences. Keep mutation actions and authority unchanged.
Add endpoint boundary tests (unauthenticated, unauthorized, missing, malformed, unavailable,
authorized projection and no-store) and update browser interception to this actual read
transport. Preserve delayed/read-failure cases; do not bypass the queue only in tests.
Parent paused the first browser run to fix this verified defect and will rerun the suite.

## Final local verification — 20 September 2026

- Final package/worker/Northstar build and complete TypeScript check passed with Node 24.20.0; schema generation reported no changes.
- Full PostgreSQL 18 suite: 668/668 tests across 51 files, including all 13 controller cases and real 120-second expiry.
- Full unit run: 4,772 passed and four timing failures. Two route modules now warm their imports before request assertions; all 20 tests in those modules passed. The timed-out boundary case and clean-workspace boundary check passed in isolation. Thus every one of the 4,776 cases has a passing result across these runs; this is not a claim that the original full invocation was green.
- Focused lease/storage/action/GET-route tests: 65/65 passed. All 26 boundary cases passed across the full run and isolated recheck.
- Authenticated browsers: 17/17 targeted journeys, zero retries. After separating stale read warnings from mutation refusals, the three affected journeys passed again; these overlap the 17.
- All eight matrix rows are covered by the executed unit, PostgreSQL and browser checks above. The independent reviews and later browser transport/presentation corrections were reconciled before completion.
- Local logs are retained under the ignored `.playwright/pr51/logs/` directory. The pushed candidate still needs its own remote CI. No merge/deployment or overall proof-gate closure is claimed.

## Suggested Review Order

**Command and receipt contract**

- Authorize before recovering exact historical success; never treat a receipt as current control.
  [run-control-lease.ts:300](../../packages/application/src/runs/run-control-lease.ts#L300)

- Reject malformed retained events before returning their original lease outcome.
  [run-control-lease.ts:149](../../packages/application/src/runs/run-control-lease.ts#L149)

**Durable consistency**

- Bind immutable receipt identity to the lease transition and retain it through Run deletion.
  [0058_large_doomsday.sql:1](../../packages/infrastructure/drizzle/0058_large_doomsday.sql#L1)

- Read indexed actor/Run/key receipts under the existing canonical Run transaction.
  [run-control-lease-repository.ts:1](../../packages/infrastructure/src/runs/run-control-lease-repository.ts#L1)

**Live ownership and recovery**

- Keep a stable renewal cadence while fencing slow reads and uncertain mutations.
  [RunControllerLease.tsx:24](../../apps/web/src/runs/RunControllerLease.tsx#L24)

- Preserve only bounded request identity across remounts and reloads.
  [control-renewal-storage.ts:1](../../apps/web/src/runs/control-renewal-storage.ts#L1)

- Authorize independent uncached reads so a stalled read cannot block safety commands.
  [route.ts:1](../../apps/web/app/api/runs/[id]/control/route.ts#L1)

- Share ownership and retain recoverable confirmations without accepting stale epochs.
  [RunWorkspaceConversation.tsx:28](../../apps/web/src/runs/RunWorkspaceConversation.tsx#L28)

**Verification**

- Exercise actual expiry, duplicates, revoked authority, rollback and forged receipts in PostgreSQL.
  [run-control-lease.test.ts:1](../../tests/integration/run-control-lease.test.ts#L1)

- Prove independent reads, tab visibility, confirmation recovery and receipt replay in authenticated browsers.
  [run-controller-lease.spec.ts:223](../../tests/e2e/run-controller-lease.spec.ts#L223)

- Verify endpoint authorization, no-store responses and redacted failures.
  [route.test.ts:1](../../apps/web/app/api/runs/[id]/control/route.test.ts#L1)
