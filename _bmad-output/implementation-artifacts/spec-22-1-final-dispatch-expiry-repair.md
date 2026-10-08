---
title: '22.1 — Enforce expiry after model/history validation'
type: bugfix
created: '2026-10-03'
status: done
baseline_commit: 6aaca7aab3463fb00e4f411e9b488eef5b2fa290
review_loop_iteration: 0
parent_story: 22-1-route-native-models-through-a-current-tool-catalog
authorization: 'Owner explicitly requested this local repair, deterministic tests and repaired checkpoint; no live calls or deployment.'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-22-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/batch-21-6-22-2-build-context.md'
---

<frozen-after-approval reason="explicit owner repair request; ordinary engineering already authorised">

## Intent

**Problem:** Operation consumption performs its final lease and Permissions checks before model/history validation. That validation can cross an expiry boundary and still commit a dispatch cutoff.

**Approach:** Complete validation before the final fresh permission and lease checks. Prove each time-sensitive refusal through the real gateway and PostgreSQL transaction, with separate deterministic regressions.

## Boundaries & Constraints

**Always:** Keep existing organisation/engagement/Task fencing, exact model/history checks and deferred-write flushing. Lease, request and exact approval expiry must independently refuse dispatch, roll back all staged dispatch records and yield zero gateway sends. Each test must reach validation while valid, cross expiry there, return the specific authority error, and finish below the gateway timeout.

**Ask First:** Live qualification, external credentials, processing or spending approval, deployment.

**Never:** Raise gateway/SQL/lease deadlines, replace expiry enforcement with cancellation/timeout, introduce production delay hooks, change published schema, weaken existing checks, merge/deploy or start 22.2. Story 22.1 remains in progress until its separate live-provider qualification completes.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| Lease | Model-bound operation and valid request/approval; owner lease expires during final validation | No send; all staged attempts/claims/capabilities rolled back | Exact Fenced refusal, below gateway timeout |
| Request | Valid owner and approval; canonical request expires during final validation | No send; staged dispatch records rolled back | Exact Denied refusal, below gateway timeout |
| Approval | Valid owner and request; required exact approval expires during final validation | No send; staged dispatch records rolled back | Exact NeedsDecision refusal, below gateway timeout |
| Current valid operation | All authority remains valid through validation and final checks | One committed cutoff and ordinary dispatch/recovery semantics | Existing duplicate, replacement and recovery tests remain passing |

</frozen-after-approval>

## Code Map

Paths are relative to `zobba/`.

- `crates/infrastructure/src/operation.rs:consume` — stages attempt/claim/capability/wakeup, flushes constraints, currently calls verify_basis then dispatch_authority then check_bound_operation. Move bounded model/history validation ahead of final fresh checks, preserving early rejection and transaction ownership.
- `crates/infrastructure/src/model/mod.rs:{check_bound_operation,check_proposal,audience,history_authority}` — real model binding, qualification and cumulative-history validation; use existing injectable ModelQualificationSource for a test-only controlled validation delay if suitable.
- `crates/infrastructure/tests/operations/model_execution.rs` — reusable profile/catalogue, complete invocation and tool-binding examples, exact recovery and history fixtures. Existing operations aggregate covers Permissions/deferred expiry.
- `crates/worker/src/gateway.rs:{Gateway::dispatch,database_call}` — actual outward owner with two-second store timeout. Regression must receive specific expiry errors before this timeout, not Unavailable.
- `crates/worker/tests/gateway_process.rs`, `support/fault_endpoint.rs` and shared infrastructure test support — guarded disposable database, actual loopback source and send counts. Add separate named tests, factoring reusable fixtures when appropriate; do not create circular crate dependencies.
- `CLAUDE.md` — record reusable final-check ordering rule; root owns story status and checkpoint evidence. All existing migrations/catalogues and browser sources are read-only for this repair.

## Tasks & Acceptance

**Execution:**
- [x] `crates/infrastructure/src/operation.rs` — complete model/history validation before final fresh authority checks and commit.
- [x] `crates/worker/tests/` — add three separately named deterministic lease/request/approval expiry tests through the real repository and Gateway, with valid initial authority, a proven final-validation delay, explicit elapsed-time bounds, zero sends and zero staged dispatch rows afterward. Keep historical invocation/admitted operation facts intact.
- [x] `CLAUDE.md` — document why validation and deferred writes precede the last time-sensitive checks.
- [x] Repair evidence — run each new test against the old order to demonstrate failure, restore the repair and verify focused operations/gateway suites plus formatting and strict Clippy. Root records source identities, exits and independent review; do not commit or push from an implementation agent.

**Acceptance Criteria:**
- Given independently expiring lease, request or approval, when final validation crosses that expiry, then the correct refusal occurs before the gateway timeout, no remote send occurs and all staged dispatch records roll back.
- Given current authority, when validation completes, then existing successful consumption, duplicate fencing and source recovery remain valid.

## Spec Change Log

- Independent review identified a source-assignment expiry window widened by the
  reorder: model/history checks can visit another engagement whose assignment
  expires during the subsequent permission reads. Preserve that authority with a
  final database fence after policy/material/decision reads, and add a separate
  regression using a real cross-engagement knowledge dependency. This implements
  the existing no-weakened-checks constraint; frozen owner intent is unchanged.
- Tighten proof of rollback and zero sends: start the wakeup non-pending, measure
  the actual validation gate hold, and count endpoint connections before parsing.

**Review repairs:**
- [x] Finish policy/material/decision reads before the final lease/source/time fence.
- [x] Add the cross-engagement source-expiry regression and verify all final sources.
- [x] Independently recheck the repairs and publish reproducible checkpoint evidence.

## Design Notes

A test that sleeps past the gateway deadline proves cancellation instead of expiry enforcement. Synchronize the final validation phase, isolate which deadline expires, measure the actual dispatch duration, and retain the specific refusal. SQL owner-only fixture controls must stay confined to the guarded disposable database; normal application clocks and policies remain unchanged. Keep the scope narrow; any test refactor must preserve the existing aggregate assertions.

## Verification

Activate the existing test environment and explicit isolated Rust database selectors from the batch context. The root schedules builds/database suites sequentially; do not run shared tests while another owner runs them. Implementer reports when ready for root verification. Root runs the new regressions, demonstrates the old-order failures, then runs `cargo test --locked -p zobba-infrastructure --test operations`, relevant worker gateway tests, `cargo fmt --all -- --check` and `cargo clippy --workspace --all-targets --locked -- -D warnings`. Broaden only for a new concern. No browser or live-provider qualification is implied by this backend repair.

Executed repair verification: **7 gateway passes** (one parent-owned helper ignored),
**5 operations passes**, formatting, architecture boundaries and strict workspace
Clippy. Lease/request/approval refusals completed in 967–990 ms against the unchanged
2,000 ms gateway limit; source assignment expiry refused in 1,004 ms. All four
checked zero connections/sends/staged rows and unchanged historical facts. Negative
controls reproduced the defects with the final tests unchanged. Exact source
identities, raw logs, review dispositions and limitations are in the
[repair evidence](zobba-foundation-batch/story-22.1-expiry-repair/README.md).
Canonical Story 22.1 remains in progress; Story 22.2 remains backlog.

## Suggested Review Order

**Dispatch authority**

- Finish model/history validation before the final fresh authority checks.
  [operation.rs:1163](../../zobba/crates/infrastructure/src/operation.rs#L1163)

- Refresh source scopes, lease and permission time after all policy reads.
  [operation.rs:458](../../zobba/crates/infrastructure/src/operation.rs#L458)

- Retain the shared rule for future dispatch changes.
  [CLAUDE.md:1](../../CLAUDE.md#L1)

**Deterministic proof**

- Exercise separate expiry boundaries through the real gateway and database.
  [final_validation_expiry.rs:880](../../zobba/crates/worker/tests/support/final_validation_expiry.rs#L880)

- Prove staged writes, exact refusals, zero traffic and complete rollback.
  [final_validation_expiry.rs:661](../../zobba/crates/worker/tests/support/final_validation_expiry.rs#L661)

- Gate late policy reads against an actual foreign knowledge dependency.
  [final_validation_expiry.rs:552](../../zobba/crates/worker/tests/support/final_validation_expiry.rs#L552)

- Count accepted connections before request parsing.
  [fault_endpoint.rs:120](../../zobba/crates/worker/tests/support/fault_endpoint.rs#L120)

- Inspect independent review, retained negative controls and exact source records.
  [README.md:1](zobba-foundation-batch/story-22.1-expiry-repair/README.md#L1)
