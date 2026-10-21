# Story 20.3 review record

30 September 2026. Baseline: `f6cf6bade4ceff910184b03f4e50601db39cd24a`.
**Status: accepted after all 15 repairs and independent verification.**

The complete tracked/untracked snapshot was captured without staging: 359,406
bytes, 7,452 lines, SHA-256
`8f8c5ba3307b35741de3c7f094ab216a855c7454c3a1f12531d0b0eb7e71f879`.
Blind, edge-case and verification-gap reviews ran in fresh contexts at the root
model capability. All three results were collected before consolidated triage.

Before review, implementation gates passed: 68 Rust, 46 fixture, 47 Python,
9 web and 23 browser tests; formatting, Clippy, locked builds, generated
contracts, boundaries and process smoke. These passes do not close the findings.

The second agent independently ran the actual restricted-migrator/nonowner-runtime
bootstrap (3), Task database (3), durable process (3), inert subprocess (10) and
domain/application (7) tests. The HTTP target passed its two guards but failed
fixture migration: the reset made `public` admin-owned. Direct restricted SQL
also proved that dispatcher-only context could change scheduling fields, despite
having no Task visibility. The attempted mutation was rolled back. Its evidence
is `/tmp/zobba-independent-20.3/`; source manifest digest is
`334df911682559750339a6d7e0e3bb1712be44d5dddcc9b3d2643ea74e8ed979`.
Migration 1/2 and catalog 1/2 remain unchanged.

## Consolidated repair batch

Root evaluated findings independently and combined only identical claims and
repairs. Each accepted finding is a **patch** within the existing bounded,
scoped, recoverable Task contract; no owner intent or architecture decision is
missing. The frozen specification remains unchanged.

| ID | Finding and consequence | Severity | Required repair and proof |
|---|---|---|---|
| R1 | Worker database futures can wait indefinitely on blackholed TCP, blocking slots or shutdown | high | Bound discovery, coordination, consumption, release, observation and reconciliation with client-side deadlines; preserve uncertain consumption and exact late facts. Test a real local stalled transport and bounded recovery/shutdown. |
| R2 | Awaiting authority inside the timer branch stops observing child exit/shutdown/deadline; successful exit can become cancellation | high | Poll authority concurrently with the exact child join and cancellation signals; preserve factual outcome. Actual child completion and shutdown must remain responsive during a stalled authority future. |
| R3 | Dead coordinator leaves HTTP readiness reporting ready | high | Supervise coordinator termination alongside serving; propagate unexpected exit/failure and withdraw readiness or exit. Exercise unexpected coordinator termination. |
| R4 | Pending-command anti-join rescans retained applied history under the engagement lock | medium | Persist a monotonic application cursor or equivalent indexed pending projection. Preserve every Applied fact and command order; verify substantial applied history plus new bounded work. |
| R5 | Open-task admission scans unbounded stopped history | medium | Add the appropriate scoped partial open-task index and verify actual admission/query behavior with substantial stopped history. Keep the 100-open cap and Continue checks. |
| R6 | Dispatcher-only RLS permits changing coordinator-owned pending/scheduling fields across scopes | high | Enforce the scheduling/lease mutation boundary in PostgreSQL, preserving metadata-only discovery and scoped coordination without BYPASSRLS or SECURITY DEFINER. Add direct restricted negative DML and valid delivery/coordinator controls; update exact schema/grant verification. |
| R7 | Worker execution meanings and coordination/receipt contracts are owned by the infrastructure adapter | medium | Move owned execution types inward and define application-owned coordination/receipt ports. Keep concrete SQL/process wiring at the outer boundary; preserve capability secrecy and actual process tests. |
| R8 | Worker discovery/runner/release/reconcile failures and exhausted late-fact retries are silent | medium | Add bounded, fixed-code, secret-free operational diagnostics/counters. Verify no scope content, credentials or receipt capabilities escape and repeated failures do not flood output. |
| R9 | Request-count bounds and deadline cancellation are unverified | medium | Actual concurrent HTTP tests for independent ordinary/control saturation, permit release after timeout/cancellation, and safe same-key retry after uncertain admission. |
| R10 | Actual process faults omit before-consumption and consumed-before-spawn cutoffs; committed response loss is not exercised | high | Add deterministic test-only fault seams around actual production transitions. Prove unused claims reconstruct safely, consumed-before-spawn remains uncertain, and losing a committed HTTP acknowledgement returns the original receipt without duplicate work. No production test-auth/fault bypass. |
| R11 | Orphan cleanup can signal a reused numeric PID | medium | Use an instance-bound process handle, or let the bounded owned child terminate and verify its exact instance disappears. Never signal a previously matched orphan PID after identity can change. |
| R12 | Oversized-body test also violates domain content limits and cannot detect removing the HTTP byte bound | medium | Pad otherwise-valid JSON with whitespace beyond 32 KiB; assert refusal and no admission, with an accepted below-bound control. |
| R13 | HTTP event tests ignore the returned continuation cursor | medium | Drain more than 100 events using only returned HTTP cursors; assert complete ordered unique delivery and preservation on an empty page. |
| R14 | Late observation retry lacks a transient-failure process proof | high | After an actual joined child, fail the first write and restore within the bounded retry window; retain the exact attempt/capability/outcome and incorporate one observation without another child. |
| R15 | HTTP fixture assumes a superuser migrator by recreating an admin-owned public schema | medium | Reset using the migration owner, keeping admin only for guarded synthetic setup. Independently rerun the actual HTTP scenario with a NOSUPERUSER/NOBYPASSRLS migrator and separate nonowner runtime. |

The original implementer owns one consolidated repair batch and the specified
post-repair gates. Root and the independent reviewer must accept the repaired
evidence before status advances to done or a checkpoint is pushed.

## Final acceptance

Root accepted R1–R15 after inspecting the repaired boundaries and executed evidence.
Each finding above is closed; no intent gap, specification change or deferred
material finding remains. Review-loop iteration stays zero: one consolidated
patch batch resolved the findings without reopening the frozen contract.

Final implementation gates passed: 78 Rust tests, 46 fixture, 47 Python, 9 web
and 23 browser tests, plus formatting, Clippy, locked builds, generated contracts,
boundaries and actual process smoke. The Rust discovery list contains one ignored
helper that its passing reliability parent explicitly invoked in 13 subprocesses;
no acceptance parent was skipped. Root checked the full workspace result groups
and successful workspace/smoke/browser exit-status records.

The independent second agent accepted all seven specification matrix rows and
R1–R15 on a separate restricted migration-owner/nonowner-runtime PostgreSQL
fixture: 31 tests passed, zero failed (bootstrap 3, Task database 3, HTTP 3, worker
4, durable process 3, inert process 12, reliability 3). Direct dispatcher SQL
proved scheduling updates affect zero rows while delivery-lease updates succeed;
current scoped coordination still succeeds. Probes were rolled back. Both roles
lack SUPERUSER, CREATEROLE, CREATEDB, REPLICATION and BYPASSRLS. Its post-repair
49-file source manifest digest is
`6cae737612535ef7091402064309481d3161db7b12fd2eb50a3788a13880ef04`;
logs remain under `/tmp/zobba-independent-20.3/`. It did not repeat retained
browser/OIDC/full-workspace gates; those were executed by the implementation lead.

Migrations/catalogs 1–2 remain unchanged. Development schema 3 was explicitly
refreshed with exact synthetic fixture/authority preservation and verified ready.
The implementation report records the unexplained earlier local IdP process loss,
successful captured reruns, and the intentional limits on uncertain consumed
activity and exhausted late-fact writes. Neither readiness nor these tests claims
model, audit, real-computer execution, hosted CI or a production deployment.
