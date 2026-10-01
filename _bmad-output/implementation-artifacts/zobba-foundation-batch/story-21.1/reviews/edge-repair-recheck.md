# Story 21.1 independent edge repair recheck

No unresolved source findings remain in the reviewed repair paths. The original edge findings R02–R05 are closed by source inspection. The additional R07 empty-page boundary found during this recheck was repaired and independently rechecked below. Execution of that latest browser regression remains pending.

Reviewed candidate: `/tmp/zobba-review-21-1/final-source.json`, SHA-256 `65098a523fd86d0d6a65f2c20d15f2ae374fdef9437448f2b85fc19f28181597`. All 180 recorded files matched their hashes during this review. The earlier `repaired-source.json` and lead freeze intentionally preserve the candidate preceding the two-file R07 follow-up.

## Original findings

| ID | Closure and actual source evidence |
| --- | --- |
| R02 | Closed. `zobba/crates/infrastructure/src/evidence/mod.rs:225` and `:250` apply `COLLATE "C"` to both cursor comparisons and ordering. `zobba/migrations/0006_evidence.sql:35-36` and catalogue 6 contain matching index collations. `crates/infrastructure/tests/evidence.rs:340-429` checks deterministic mixed-case registry/recovery IDs across page boundaries against byte order. The lead reports a passing restricted PostgreSQL run under non-C default collation; this reviewer did not execute it. |
| R03 | Closed. `zobba/web/src/evidence.ts:15-16,187-204` uses the same 40 KiB encoded bound on save/recover, validates/canonicalizes before saving, and validates recovered request and reservation IDs. This covers the former valid approximately 20 KiB escaped request. `web/tests/browser/evidence-repairs.spec.ts:54-90` retains the exact draft/key across a lost registered upload response and reload and asserts no second PUT. |
| R04 | Closed. `zobba/web/src/EvidenceWorkspace.tsx:176-190` validates the full request before either session storage or `setDraft`; invalid source/filename returns with corrective feedback and keeps the editable state. Storage refusal also occurs before freezing. `web/tests/browser/evidence-repairs.spec.ts:93-112` asserts multibyte source and filename refusal, editable fields, no POST, no persisted draft, and later corrected acquisition. |
| R05 | Closed. `zobba/web/src/EvidenceWorkspace.tsx:163-164` rejects oversized files before measurement, controller creation, persistence or requests and displays the size correction. `web/tests/browser/evidence-repairs.spec.ts:115-125` asserts zero mutations and no recovery draft. |

## Other repair paths and new-regression pass

| ID | Recheck result |
| --- | --- |
| R01 | No unresolved edge found. `infrastructure/src/evidence/s3.rs:62-122` retains optional raw endpoint spelling and hashes tagged, length-framed destination inputs. Omitted/explicit endpoints and trailing slash no longer collapse. The actual SDK signed-destination test matrix begins at `:493`. |
| R06 / R15 | No unresolved edge found. Repository quota refusal is `ReservationLimit`; exact replay precedes quota checks (`infrastructure/src/evidence/mod.rs:175-194`). API mapping at `api/src/evidence.rs:740-759` reserves Retry-After for transient capacity. Browser classification uses a bounded 409 body and a distinct error (`web/src/evidence.ts:92-104`); UI explains finishing existing custody (`EvidenceWorkspace.tsx:108`). Restricted quota proof at `infrastructure/tests/evidence.rs:578-699` checks refusal without insertion, replay/conflict, actor/scope isolation and freeing exactly one place. |
| R07 | Follow-up closed in source. The first repaired candidate preserved a later recovery cursor but hid the entire recovery section when another tab completed its final item. That removed Previous/First while earlier reservations remained. Final `web/src/EvidenceWorkspace.tsx:314-317` keeps the section and navigation for a nonfirst empty cursor and explains the empty page. `web/tests/browser/evidence.spec.ts:318-338` completes the last pending item through the real API, refreshes to zero items and uses Previous to recover the preceding 50. Execution of this added case is pending with the lead. Cursor history remains bounded at `EvidenceWorkspace.tsx:265-286`. |
| R08 | No unresolved edge found. Accepted registration is stored independently before list refresh (`EvidenceWorkspace.tsx:197-212`); failure distinguishes registered provenance from an uncertain upload and rechecks authority before restoring private projections (`:115-137`). The browser regression at `evidence-repairs.spec.ts:153-176` inspects receipt values and absence of retry state during list failure. |
| R09 / R10 | No unresolved edge found. Explicit inspection focus and remembered return target are handled at `EvidenceWorkspace.tsx:69-74,222-246`; pending expected identity and immutable assertions are rendered read-only at `:304-308`. Audience change clears focus, pages and private state. |
| R11 | No unresolved edge found. The browser algorithm at `web/src/evidence.ts:172-177` and API algorithm at `api/src/evidence.rs:704-737` agree on Unicode-scalar replacement, ASCII output, dot trimming, 120-character maximum, bounded final extension and empty fallback. |
| R12 | No unresolved edge found. API binary upload/download schemas reference `EvidenceBinary`; the contract regression in `api/tests/evidence_contract.rs` checks string/binary schema and generated agreement. |
| R13 / R14 | No unresolved edge found in test design. `api/tests/evidence_http/composition.rs:11-142` invokes the production constructor in isolated synthetic configurations and forbids S3 connections. `:188-324` drives complete authenticated middleware with actual authority/reservation checks, checks the 15/120-second distinction and admission refusal, then successfully uploads after timed-out requests release capacity. |
| R16 | No unresolved edge found. `web/tests/browser/evidence.spec.ts:89-95` compares rendered measured hash/size and storage version with the actual receipt and checks asserted/unknown source facts. |

## Verification limits

This was a read-only source/test-design review plus manifest hashing. No test, browser, database or IdP execution was performed, and no source was edited. Only this report was written.

Focused pass counts are the implementation reports' evidence, not independently rerun results. The parent reported that full Rust encountered an existing membership HTTP 503, its standalone rerun passed, and a repeated full run was pending. The latest R07 focused browser execution and subsequent complete gates were also pending at review completion. This report closes source findings; it does not attest that those outstanding gates passed or claim live S3/deployment qualification.
