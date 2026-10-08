---
title: '20.3 — Accept task commands once and recover them after restart'
type: feature
created: '2026-09-30'
status: done
story_key: 20-3-accept-task-commands-once-and-recover-them-after-restart
review_loop_iteration: 0
baseline_commit: f6cf6bade4ceff910184b03f4e50601db39cd24a
authorization: 'Owner authorised the full canonical Stories20.1–20.4, specifications and routine engineering choices without intermediate approval.'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-20-context.md'
---

<frozen-after-approval reason="owner-authorised Story20.3 intent and batch boundaries">

## Intent

**Problem:** Scoped sign-in exists, but accepted objectives and controls have no durable Task authority.

**Approach:** Implement atomic Task commands, recoverable work cycles and fenced worker ownership, verified with a bounded inert executor.

## Boundaries & Constraints

**Always:** Follow canonical20.3, CAP18/19 and AD36/37/38. Preserve current scope, explicit migrations and inward Rust boundaries. Separate Received, Applied and observed quiescence; keep accountable human, worker ownership, execution epoch and intent distinct.

**Ask First:** Paid resources, customer credentials/data, production deployment or destructive historical changes. Local fixtures and ordinary choices are authorised.

**Never:** Model/tool/computer dispatch, audit conclusions, conversation UI, legacy domain dependencies, lease-expiry-as-quiescence or blind replay after possible dispatch. Story20.4 owns conversation;20.5 owns the full operation/Permissions gateway.

## I/O & Edge-Case Matrix

| Scenario | Input / state | Expected behaviour | Error handling |
|---|---|---|---|
| Retry | Concurrent same author/scope/key/meaning; changed target or payload | One command, original immutable receipt | Reauthorise; changed meaning conflicts |
| Interruption | Rollback or crash around admission/claim/commit | No uncommitted acceptance; committed work reconstructs | Preserve ambiguous consumed activity; no blind retry |
| Ownership | Competing workers; expired owner/epoch | Only current owner advances work | Stale producer can submit exact receipt only |
| Guidance | New intent under still-valid owner | Durable Received; Applied at work boundary; old proposals/unconsumed claims fenced | Consumed claim remains attributable and possibly dispatched |
| Control | Busy/stalled/waiting Task; Pause/Stop | Prompt scoped receipt and execution fence, then factual cessation | Pending remains pending; other Tasks continue |
| Continuation | Paused/stopped Task and retained guidance | Explicit Resume retains cycle; Continue after Stop creates cycle | Guidance, reconnect or stale control never resumes implicitly |
| Revocation | Removed membership or foreign/guessed scope | No new reads, claims or transitions | Narrow late facts disclose no protected projection |

</frozen-after-approval>

## Code Map

- `zobba/crates/domain/src/lib.rs:7`, `application/src/identity.rs:35`: schema2 and inward async-port pattern; add owned Task meanings/ports.
- `infrastructure/src/lib.rs:125,171,247,334`: exact grants/catalog/prefix checks, four-connection pool and atomic explicit migrator. Add migration3; preserve0001/0002 bytes and v1/v2 catalogs.
- `infrastructure/src/scope.rs:11,27`: retain one transaction with local context; extend reset to receipt context. `tests/support/mod.rs:57` owns disposable-DB guards.
- `api/src/auth.rs:99,331`, `api/src/lib.rs:74`: fresh session and exact Origin/CSRF; compose a reserved control path without weakening sign-in. Owned OpenAPI comes through CLI/generator.
- `worker/src/main.rs:58`: health-only process; add dispatcher/coordinator. Crate paths above are relative to `zobba/crates/`. `zobba/README.md:158`, existing tests/scripts and `.github/workflows/zobba.yml` own retained gates.

## Tasks & Acceptance

**Execution:**
- [x] `zobba/crates/{domain,application}/src/task.rs` — typed commands, lifecycle, receipts and ports; unit-test the matrix and invalid transitions.
- [x] `zobba/migrations/0003_tasks.sql`, `crates/infrastructure/src/{task,dispatcher}.rs` — atomic admission, scope, commit-ordered events, wakeups, ownership, intent/claim fences and receipt-only recovery; extend exact schema/grant validation.
- [x] `zobba/crates/api/src/tasks.rs` — bounded authenticated admission/read endpoints, canonical idempotency, reserved controls, owned contracts and fixed diagnostics.
- [x] `zobba/crates/worker/` — bounded polling, delivery leases, current-authority coordinator, cancellable inert children and truthful recovery/shutdown.
- [x] `zobba/crates/*/tests/`, `scripts/`, CI and READMEs — actual concurrency/crash/process proofs, retained20.1/20.2 gates, reusable `CLAUDE.md` decisions and implementation evidence.

**Acceptance Criteria:**
- Given accepted commands, process loss never erases receipts or duplicates committed transitions.
- Given stalled execution, controls remain independently admissible and name the exact Task/cycle.
- Given changed intent, ownership alone cannot validate an obsolete proposal or unused claim.
- Given only this foundation, no result implies model, audit or computer execution.

## Spec Change Log

## Design Notes

Create/Guide/Pause/Resume/Stop/Continue are explicit commands. Canonical meaning includes author, composite scope, kind, target Task/cycle and content; serialization order is irrelevant. Retry returns the original Received receipt, with Applied a separate fact. Derive the accountable actor from the session. Atomically commit command, receipt, state, event and wakeup before acknowledgement. Serialize a per-engagement event counter with commit; expose cursors as strings. Use consistent engagement→Task→command/wakeup locking and no external waits inside transactions.

Guide advances intent at admission; the worker applies it to the working brief before claiming work under that intent. Plain retained text is not an AI understanding claim. Paused/stopped guidance never restarts execution. Stop ends the cycle; stale cycle controls cannot affect a continuation. Separate database-time owner leases, owner epochs, execution epochs, intent and Task revision. Persist admitted/consumed inert claims and their actual producing basis; consumption atomically rechecks current authority and every fence.

Discover only bounded, content-free wakeup routing metadata under explicit narrow grants/policy; then derive immutable scope and recheck recorded execution authority in a fresh scoped transaction. Delivery lease is neither Task ownership nor permission. Browser-session expiry alone does not revoke background authority. No BYPASSRLS, SECURITY DEFINER or broad tenant read. Revocation blocks new activity and cancels the locally tracked child without rereading revoked content. Polling recovers lost notifications.

Consumption mints an exact-attempt receipt capability, storing only its digest; exclude it from dispatcher results, browser responses and logs. A separate transaction-local, FORCE-RLS receipt context permits only bounded immutable inert observations, including from stale/revoked producers. It grants no Task reads, proposals, ownership, new execution or transitions. Identical receipts deduplicate; contradictory reuse refuses. An authorised coordinator may incorporate facts later. No public receipt endpoint is needed.

Confirm completion/cancellation only after the actual child joins. A witnessed exact process-instance exit proves termination, not success. Lease expiry, timeout, Stop and cancellation requests prove neither. A consumed claim lost in an abrupt crash remains reconciliation-required; replacement ownership never invents quiescence or replays it. Keep such Tasks waiting while other Tasks and controls remain usable. This honest limit avoids building a fictitious external reconciler in20.3.

Bound requests, open Tasks, command batches, children, DB connections and polling. Reserve control admission/authentication independently of ordinary reads and worker execution; release connections during inert work/waits. Preserve secret-free diagnostics. Routine limits and mechanics are implementer choices, recorded and tested. Use `. /workspace/zobba-build-tools/activate.sh`; main test DB is isolated, and the independent reviewer has its own. Keep running dev4310/5173/9443 usable; migrate explicitly when ready.

Implement only20.3 and return for independent review without committing or pushing; root owns final specification/status acceptance.

## Verification

- Run real PostgreSQL concurrent identical/changed commands, admission rollback/lost acknowledgement, competing/expired owners, crash before/after claim consumption and commit, and commit-ordered event races. Reauthorise duplicate reads.
- Race guidance against claim admission/consumption under the same owner. Retain consumed uncertainty; reject old intent/cycle/epoch. Prove narrow late receipts after Stop/expiry/revocation, wrong capability/scope refusal, contradictory receipt conflict and pooled context cleanup.
- Stall an actual inert child while admitting Pause/Stop; distinguish accepted from joined cessation. Test two Tasks, explicit Resume/Continue, process restart and missing notifications. No fake completion or ignored matrix rows.
- Verify missing/foreign scope and Admin-only denial; metadata-only dispatcher and restricted grants; current membership without browser-session dependence; resource bounds and reserved control responsiveness.
- Preserve fresh/v1/v2/repeat migrations and refusal without mutation. Run `cargo fmt --check`, workspace locked Clippy/test/build with real IdP/PG, frozen pnpm, `pnpm check`, `pnpm build`, Python guards/boundaries/smoke and all23 existing browser cases, adapting schema assertions only. Record independent acceptance before done/push.

## Suggested Review Order

**Admission and authority**

- Commit original receipts and scoped wakeups atomically before acknowledging commands.
  [task.rs:139](../../zobba/crates/infrastructure/src/task.rs#L139)

- Keep command, execution and receipt meanings inside domain and application boundaries.
  [task.rs:41](../../zobba/crates/application/src/task.rs#L41)

- Separate dispatcher leases from scoped scheduling and preserve exact schema verification.
  [0003_tasks.sql:58](../../zobba/migrations/0003_tasks.sql#L58)

**Recovery and control**

- Bound database work and retain uncertainty after possible dispatch.
  [lib.rs:40](../../zobba/crates/worker/src/lib.rs#L40)

- Observe child exit concurrently with authority checks and shutdown.
  [executor.rs:72](../../zobba/crates/worker/src/executor.rs#L72)

- Withdraw readiness when coordination fails; bound shutdown without inventing receipts.
  [supervision.rs:31](../../zobba/crates/worker/src/supervision.rs#L31)

- Reserve independently bounded HTTP capacity for guidance and controls.
  [tasks.rs:36](../../zobba/crates/api/src/tasks.rs#L36)

**Verification and operation**

- Exercise actual process cutoffs, stalled transport and exact late-fact retry.
  [reliability_process.rs:1](../../zobba/crates/worker/tests/reliability_process.rs#L1)

- Verify real HTTP saturation, committed acknowledgement loss and complete event pagination.
  [tasks_http.rs:1](../../zobba/crates/api/tests/tasks_http.rs#L1)

- Map every acceptance row to executed evidence and retained limits.
  [story-20-3-implementation-evidence.md:1](story-20-3-implementation-evidence.md#L1)
