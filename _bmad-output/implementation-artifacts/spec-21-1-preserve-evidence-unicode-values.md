---
title: 'Story 21.1 repair: preserve accepted Unicode evidence metadata'
type: 'bugfix'
created: '2026-10-01'
status: 'done'
story_key: '21-1-acquire-and-inspect-immutable-scoped-evidence'
baseline_commit: '26271284b03d5114f6ead2146092c5e1a50fdd7c'
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-21-context.md'
---

<frozen-after-approval reason="Owner explicitly requested this repair and authorised routine implementation choices">

## Intent

**Problem:** Rust accepts U+FEFF in evidence filenames and source assertions, but JavaScript `trim()` removes it. One immutable API-created record can therefore prevent the whole evidence panel from loading and invalidate recovery drafts.

**Approach:** Align browser validation with the existing server contract. Preserve every already accepted value exactly and prove parity and mixed-record browser recovery.

## Boundaries & Constraints

**Always:** Keep immutable metadata, UTF-8 limits, controls/path restrictions, scope and session fencing. Cover filename and all source fields: system, account, source_version, selection, coverage. Use real API-created records in browser regressions.

**Ask First:** Any narrowing of server acceptance, policy change, paid cloud environment or deployment.

**Never:** Rewrite accepted records, strip U+FEFF from stored values, hide malformed rows to mask this mismatch, change published migrations/catalogues, reset development databases, merge, deploy, or start the next story. Admin-expiry policy is a separate recommendation pending owner approval.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Accepted metadata | U+FEFF leading, trailing, internal or alone in filename / each source field | Both validators accept and preserve exact value | No panel or draft failure |
| Existing restrictions | Empty filename, empty non-null source, edge Unicode White_Space, C0/C1 controls, filename path separators, UTF-8 overflow | Client and server agree on refusal; null source remains valid | Existing validation error |
| Mixed registered records | API-created affected and normal originals in one engagement | Both list, inspect and download with exact metadata and bytes | No poisoned panel |
| Mixed interrupted acquisitions | API-created affected and normal pending reservations | Reload, recover exact request/draft and register original bytes; both remain readable | No silent normalisation or duplicate identity |
| New source entry | U+FEFF entered in any source field | Submission preserves it and follows server whitespace semantics | Existing unrelated input rules remain |

</frozen-after-approval>

## Code Map

- `zobba/web/src/evidence.ts` — `parseReservationRequest` trim affects page parsing and draft recovery. Download sanitation is separate.
- `zobba/web/src/EvidenceWorkspace.tsx` — acquisition source-entry mapping also trims. Preserve recovery and authority logic.
- `zobba/crates/domain/src/evidence.rs` — Rust validators define Unicode White_Space and byte/control rules; production contract unchanged.
- `zobba/crates/api/tests/evidence_contract.rs`, `zobba/web/tests/evidence.test.mjs` — shared parity cases consumed by both runtimes.
- `zobba/web/tests/browser/{evidence.spec.ts,evidence-repairs.spec.ts,auth-runtime.ts}` — real OIDC/API/PostgreSQL/S3 fixture. Assert raw strings; text matchers may normalise U+FEFF.
- `_bmad-output/implementation-artifacts/zobba-foundation-batch/story-21.1/commands-browser.sh.txt` — safe existing fixture invocation.

## Tasks & Acceptance

**Execution:**
- [x] Add shared Rust/browser metadata parity tests and browser regressions; demonstrate failure against the baseline before fixing.
- [x] Repair client validation and new-input handling without changing accepted server values or persistence.
- [x] Run the matrix coverage, frontend checks/build, Rust contract/domain tests, all evidence browser scenarios and session/account-binding regressions. Save bounded, credential-free evidence under `/tmp/zobba-21-1-unicode/`.

**Acceptance Criteria:**
- Both runtimes agree on every parity case for filename and each of the five source fields, including exact preserved U+FEFF strings and byte limits.
- API-created affected and normal records stay readable together; interrupted acquisitions of both recover after reload with exact source values, original bytes and stable identities.
- Independent review finds no unresolved repair blocker; no policy, published migration or production server-contract change is introduced.

## Spec Change Log

## Design Notes

Rust trims Unicode White_Space; ECMAScript additionally trims U+FEFF. Never transform stored metadata. New-input trimming must follow Rust semantics.

Implementer owns code/tests and verification; coordinator owns status, policy proposal and publication. Do not commit/push. Keep the smallest correct patch.

## Verification

- Source `/workspace/zobba-build-tools/activate-tests.sh`. Only disposable `zobba_story_20_test` DB; never development `zobba_story_20` or IdP 9443. Serialize fixture IdP 9444 tests.
- `pnpm --dir zobba/web check` and `build`; expected all checks pass.
- From `zobba/`: `cargo fmt --all -- --check`, `cargo test -p zobba-api --test evidence_contract`, `cargo test -p zobba-domain`, `cargo clippy --workspace --all-targets -- -D warnings`.
- Real Chromium via repository Playwright: existing evidence suites plus new Unicode and account-binding coverage; one worker, zero retries. Browser plugin is unavailable. Capture console failures, exact metadata/bytes assertions and a clean evidence-panel screenshot.
- Preserve published migration/catalogue hashes. Never print credentials or secret environment files; no paid services.

## Suggested Review Order

**Validation**

- Preserve accepted metadata using the existing Rust whitespace contract.
  [evidence.ts:40](../../zobba/web/src/evidence.ts#L40)

- Apply the same semantics to fresh source entry.
  [EvidenceWorkspace.tsx:177](../../zobba/web/src/EvidenceWorkspace.tsx#L177)

**Tests and evidence**

- Share cases across filenames and all five source fields.
  [evidence-metadata-parity.json:2](../../zobba/tests/fixtures/evidence-metadata-parity.json#L2)

- Check server acceptance and exact values through API types.
  [evidence_contract.rs:95](../../zobba/crates/api/tests/evidence_contract.rs#L95)

- Check matching client acceptance and both draft states.
  [evidence.test.mjs:18](../../zobba/web/tests/evidence.test.mjs#L18)

- Prove mixed records, recovery and original downloads in Chromium.
  [evidence-unicode.spec.ts:176](../../zobba/web/tests/browser/evidence-unicode.spec.ts#L176)

**Review and owner decision**

- Read results, preserved failures, independent review and limits.
  [STORY-21.1-UNICODE-REPAIR.md:1](zobba-foundation-batch/STORY-21.1-UNICODE-REPAIR.md#L1)

- Review the separate policy proposal; it is not implemented.
  [ADMIN-EXPIRY-OWNER-DECISION.md:5](zobba-foundation-batch/ADMIN-EXPIRY-OWNER-DECISION.md#L5)
