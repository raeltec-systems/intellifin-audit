---
title: '20.5 — Apply standing Permissions to exact recorded operations'
type: feature
created: '2026-10-01'
status: done
story_key: 20-5-apply-standing-permissions-to-exact-recorded-operations
review_loop_iteration: 0
baseline_commit: adaa83a83ea0c1be462f866f127525417b2e0be1
authorization: 'Owner approved the repaired foundation and explicitly authorised proceeding to20.5; routine engineering choices require no further approval.'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-20-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-IntelliFin Audit-2026-09-01/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-IntelliFin Audit-2026-09-01/CONTRACT-REGISTER.md'
  - '{project-root}/_bmad-output/planning-artifacts/zobba-product-architecture-2026-09-30/Zobba-Product-and-Architecture-Design.md'
---

<frozen-after-approval reason="owner-authorised canonical Story20.5">

## Intent

**Problem:** Durable Tasks lack enforceable Permissions and recorded external-operation authority.

**Approach:** Implement canonical20.5: pure policy, versioned authority, exact human decisions, one-use gateway dispatch and factual recovery through a local fault endpoint.

## Boundaries & Constraints

**Always:** Intersect current organisation, engagement, member, account/resource/action, accepted Task and delegation limits. Preserve priority controls and repaired session binding. Each operation has one operating purpose. Retain immutable attribution and bounded secret-free projections.

**Ask First:** Paid infrastructure, customer accounts/data, deployment or destructive historical changes.

**Never:** Domain-wide allow, production writes, live connector catalog, remote exactly-once claims, Node authority, or editing published migrations/catalogs1–3. Full Needs you UI belongs to25.2; deliver its authenticated decision/projection seam here.

## I/O & Edge-Case Matrix

| Scenario | Input / state | Expected behaviour | Failure handling |
|---|---|---|---|
| Standing authority | Exact covered operation | Gateway consumes once without another ceremony | Missing intersection refuses |
| Purpose | Live inspection / Test workflows / Audit coordination | Read restriction / verified test bounds / audit-resource limits | Prompts, hostname labels and tool annotations grant nothing |
| Decision | Uncovered but permissible operation | Human binds account, environment, destination, recipients, material/attachments, resource version, purpose and expiry | Material edit, stale version or expiry invalidates |
| Revision | Policy/grant/delegation change | Narrow immediately; widening never silently enlarges Task authority | Check complete ancestor lineage |
| Cutoff | Stop, Pause, guidance or revocation races consumption | Unconsumed refuses; consumed remains possibly dispatched | No inferred cancellation or blind replay |
| Recovery | Crash before/after effect or lost acknowledgement | Query endpoint; retain operation, attempts and observed facts separately | Pending/unknown never becomes success or absence |
| Disclosure | Changed actor/scope or late producer | Fresh audience on reads; exact late receipt capability only | No secrets, authority adoption or renewed execution |

</frozen-after-approval>

## Code Map

- `zobba/crates/infrastructure/src/task.rs` — `admit`, `coordinate`, `consume`, `valid_basis`: shared engagement lock and owner/cycle/execution/intent fences. Existing inert claims are not business operations. Cessation must include unresolved external attempts.
- `zobba/crates/infrastructure/src/scope.rs`, `identity.rs` — same-transaction current membership and forced RLS; preserve local-context reset and revoked-producer receipt-only access.
- `zobba/crates/infrastructure/src/lib.rs`, `migrations/`, `schema-v3.catalog` — add schema4, extend exact inventory, ledger bounds, narrow grants and runtime authority checks; preserve old bytes.
- `zobba/crates/worker/src/lib.rs`, `application/src/task.rs` — inward ports and bounded recovery; no connection held across remote I/O. Owned gateway must be the sole dispatch path.
- `zobba/crates/api/src/{auth,tasks,conversation}.rs` — reuse current session/actor/CSRF/read fences and bounded HTTP contracts. `api/tests/tasks_http.rs` provides authenticated tests.
- `zobba/crates/infrastructure/tests/{task,bootstrap}.rs`, `worker/tests/reliability_process.rs` — real guarded PostgreSQL, deterministic commit barriers and test-only crash wrappers; `web/tests/browser/` retains56 Chromium regressions.

## Tasks & Acceptance

**Execution:**
- [x] `zobba/crates/domain/src/`, `application/src/` — pure three-purpose policy, exact canonical operation/decision meanings, versioned policy/grants/delegation and gateway/reconciliation ports; test matrix edges.
- [x] `zobba/migrations/0004_permissions_operations.sql`, `crates/infrastructure/src/` — atomic scoped persistence, immutable request/decision/attempt/receipt history, current-authority claim consumption and schema4 upgrade/refusal checks.
- [x] `zobba/crates/worker/src/`, `infrastructure/src/task.rs` — trusted bounded gateway and recovery integrated with Task fences and factual cessation; preserve inert foundation behavior.
- [x] `zobba/crates/api/src/`, `openapi.json`, `web/src/generated/api.ts` — authenticated exact decision/revocation and safe read contracts, ordinary bounded capacity without blocking controls.
- [x] `zobba/crates/*/tests/`, `scripts/`, `README.md`, `CLAUDE.md` — owned fault endpoint, actual transaction/crash/HTTP tests, retained combined checks and reusable decisions.

**Acceptance Criteria:**
- Given covered authority, when competing gateways consume the same claim, then only one dispatches.
- Given a reviewable action, when an authorised person decides, then only the exact current operation is covered and every material substitution refuses.
- Given an effect with a lost acknowledgement, when recovery resumes, then source reconciliation precedes any resubmission and uncertainty remains visible.
- Given retained foundation behavior, when combined checks run, then scope, controls, account switching and schema refusals still pass.

## Spec Change Log

## Design Notes

Use typed immutable canonical requests, independent operation/attempt/claim identities, explicit version/expiry and a persisted authority snapshot. One-off decisions cannot override hard prohibitions. Policy expansion needs an attributable Task authority change. Canonical encoding must reject ambiguous input and substitutions; raw secret-bearing handles never enter public projections. Queryable source absence must be authoritative before a new attempt, with fresh authority; otherwise remain unresolved. Late receipts convey facts only, including after Stop/revocation.

The local adapter is qualification infrastructure, not a live connector. Use a real owned endpoint with test-only fault controls and stable operation lookup; no production fault flags or arbitrary caller-selected network destination. Keep source acceptance, completed effect and unknown outcome distinct. Bound calls, locks, result sizes, retries and history pages.

Implementation lead may delegate disjoint files after agreeing shared contracts; root owns spec/status acceptance, independent review, evidence and push. Do not commit or push from implementation agents. Activate `/workspace/zobba-build-tools/activate.sh`; serialize destructive tests per dedicated guarded database and reserve IdP9444 exclusively. Preserve development processes/data.

## Verification

Run fmt, locked Clippy/test/build, frozen pnpm/check/build, fixture tests, Python guards/boundaries/smoke and full retained browser suite. Prove all matrix rows with executed tests, including actual cutoff races, changed authority/account/content, concurrent consume, restart after consumed/effected/lost-receipt stages, endpoint-query ordering, pending receipts, scoped secret canaries and narrow runtime grants. Test schema3→4 with original ledger preservation and all accepted older prefixes. Record commands, results, limits and independent review before done/push.

Final result: all required local gates passed, including 111 Rust and 56 real
Chromium tests. Independent review findings and the retained Task event regression
were repaired and rechecked. See [implementation evidence](story-20-5-implementation-evidence.md),
[review record](zobba-foundation-batch/REVIEW-20.5.md) and the
[tested source manifest](zobba-foundation-batch/SOURCE-MANIFEST-20.5.json).
Implementation is complete; the sprint entry is `review` for owner acceptance.

## Suggested Review Order

**Operation contract**

- Follow the owned ports from accepted authority through exact decisions, dispatch and recovery.
  [operation.rs:47](../../zobba/crates/application/src/operation.rs#L47)

- Check the intersection of current policy and the accepted Task upper bound.
  [permissions.rs:415](../../zobba/crates/domain/src/permissions.rs#L415)

**Enforcement and durability**

- Inspect immutable records, source binding, scoped policies and narrow runtime grants.
  [0004_permissions_operations.sql:3](../../zobba/migrations/0004_permissions_operations.sql#L3)

- Review the transaction that validates current authority and commits the one-use dispatch cutoff.
  [operation.rs:880](../../zobba/crates/infrastructure/src/operation.rs#L880)

- Verify that external facts and joined children govern factual cessation without overriding controls.
  [task.rs:465](../../zobba/crates/infrastructure/src/task.rs#L465)

**Source and human review**

- Trace bounded source I/O, pinned ledger identity and reusable freshly authorized recovery custody.
  [gateway.rs:87](../../zobba/crates/worker/src/gateway.rs#L87)

- Inspect the session-bound, scoped history seam and its bounded factual response.
  [operations.rs:796](../../zobba/crates/api/src/operations.rs#L796)

**Regression evidence**

- Run the real PostgreSQL policy, claim, expiry, paging and Task-order matrices.
  [operations.rs:1439](../../zobba/crates/infrastructure/tests/operations.rs#L1439)

- Inspect actual crashes, mismatched responses, refusal, source preconditions and polling recovery.
  [gateway_process.rs:489](../../zobba/crates/worker/tests/gateway_process.rs#L489)

- Check retained schema prefixes, restricted migration roles and runtime privilege refusals.
  [bootstrap.rs:1125](../../zobba/crates/infrastructure/tests/bootstrap.rs#L1125)
