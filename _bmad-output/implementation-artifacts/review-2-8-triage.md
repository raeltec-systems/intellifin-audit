# Story 2.8 — formal review triage

Date: 2026-09-05. Baseline: `73d577a6fd0eba73f4b07cc71013d313675dd655`. Full tracked/untracked diff captured without staging at `C:/Users/opc/tools/intellifin-epic2-test/evidence/story28-review.diff`, 240,776 bytes, SHA-256 `31078947807d724d81354f8531bcd630df3c2301ba85449c04e16e2b25e2f208`.

All four reviewers were launched before triage. Runtime capacity required the fourth to start when a slot became available. Initial gates passed: 1,932 unit, 204 integration, 96 browser tests, types, boundaries, builds and no schema drift. These describe the pre-repair checkpoint.

Status: all twelve patches implemented and independently cleared. Final full verification passed 1,950 unit, 209 integration and 96 browser tests, plus types, boundaries, migration/no drift and package/production builds. Focused checks passed 26 unit, 17 integration and four browser cases.

Repair checkpoint: package build and full typecheck passed, followed by 26 focused unit tests. The stable repair diff was captured at `C:/Users/opc/tools/intellifin-epic2-test/evidence/story28-followup.diff` (281,095 bytes; SHA-256 `bd4cf7fea98d73fd5e51932afe9aa0daabca4c6ef4c008d099d0f0865727b31a`). Independent follow-up review and remaining serial verification are running; no final sign-off is implied.

| ID | Severity | Route | Required repair |
|---|---|---|---|
| P1 | medium | patch | Resolve selected version directly; keep new and historical versions accessible beyond 100 entries; test the boundary. |
| P2 | high | patch | Recheck New version authorization under the transaction lock and audit a concurrent revocation refusal without writes. |
| P3 | medium | patch | Discover affected registration/source versions before strict reads, retaining refusal for affected corruption. |
| P4 | low | patch | Refuse unsupported prompt/tool publication kinds rather than mislabeling model-only behavior. Preserve fixed supported compiler contracts. |
| P5 | medium | patch | New Procedure creation adopts published current model/revision under its transaction, using environment fallback only before publication. |
| P6 | low | patch | Strict external configuration shape validation before property access or writes. |
| P7 | low | patch | Compare complete publication identity on replay and retain the actual current revision separately from tuple no-op semantics. |
| P8 | medium | patch | Resolve real succession on Version review and detail; do not report unloaded history as absent. |
| P9 | low | patch | Capture correlated safe telemetry for New version failures. |
| P10 | medium | patch | Synchronous New version submission guard plus duplicate and committed-response-loss proof. |
| P11 | medium | patch | Assert recurring activation's exact boundary in persisted lifecycle, succession and display. |
| P12 | medium | patch | Assert exact changed Target/Source snapshots, preserved predecessor and derivation consumption. |

Counts: intent_gap 0; bad_spec 0; patch 12 (high 1, medium 7, low 4); defer 0; reject 2. Follow-up review is required: one high finding and weighted score 25.

The two rejected claims are additional raw-SQL protection for all configuration/replay tables and a new platform-Draft notification. The former is not the frozen-definition SQL contract and does not change reviewed snapshots; the latter adds a notification event absent from the intent's existing notification rules. They do not invalidate the separate replay metadata or visibility repairs.

The explicit release entry point, fixed supported prompt/interpreter, absence of execution, and reuse of owner-module digest functions are established by the captured intent and loaded context. Privileged schema removal is not an achievable ordinary database invariant. No owner decision or frozen-intent change is needed. Repairs complete authorization, access, authoritative configuration wiring, input validation and verification without adding a new tuple or execution rule.
