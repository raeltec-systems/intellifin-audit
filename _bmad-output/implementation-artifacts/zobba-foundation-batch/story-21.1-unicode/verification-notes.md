# Story 21.1 Unicode repair verification

Production baseline: `26271284b03d5114f6ead2146092c5e1a50fdd7c`.
The negative unit and browser runs occurred before either production source file was edited.

- Shared JSON matrix: 366 cases independently applied to filename and each of five source fields (2,196 cases per runtime). Covers FEFF in all four positions, exact values and drafts, Unicode White_Space, C0/C1 controls, path separators, null/empty values, non-normalized Unicode, and six UTF-8 byte-boundary patterns.
- Baseline unit run: all 2,196 cases executed; six field tests failed with exactly seven accepted FEFF cases each (42 mismatches).
- Baseline browser run: all three regressions failed for the expected poisoned-panel/input refusal, with zero unexpected console or page errors. An earlier browser attempt also exposed a test-only Chromium 401 status-text variant; that attempt is retained separately as `negative-browser-initial-harness.txt`.
- Rust server behavior remains unchanged: the matrix validates API DTO deserialization, domain validation and exact serialization. All 3 API contract tests passed.
- Final frontend check: generated API validation, TypeScript, and all 107 unit tests passed. Production build passed.
- Final Rust gates: formatter passed; 20 domain unit tests and 2 doc tests passed; workspace/all-target Clippy with warnings denied passed.
- Browser plugin unavailable. Repository Playwright uses installed Chromium, actual HTTPS OIDC, guarded disposable PostgreSQL `zobba_story_20_test`, and owned S3 fixture. One worker, zero retries. No development database or IdP 9443 was targeted.
- Final selected Chromium run: **57 passed, 0 failed, 0 skipped, zero retries**, 4.6 minutes, explicit command exit 0. Includes every evidence scenario plus authentication and account-binding suites.
- Three new browser cases verify five mixed API-created registered originals, five mixed API-created pending reservations recovered after reload with identical requests/IDs/bytes, and all-five-field source entry preserving FEFF with Rust whitespace trimming. They passed with zero unexpected console/page errors.
- `mixed-registered-originals.png` was visually inspected: evidence panel renders beside the continuing conversation without error overlay or broken layout.
- All twelve published migrations/catalogues match the before snapshot; `published-hashes.check` records the checks.

`commands.sh.txt` records the replay commands and `exit-receipts.txt` records command exit statuses. `browser.txt` is the complete final selected browser-suite record; its final runner summary and the explicit browser exit receipt establish completion.

No server acceptance, persistence, migration, catalogue, authority or admin policy change; no commit, push or deployment by the implementer. Independent acceptance/publication remain coordinator-owned.

Archived raw logs use `.txt` names so repository log-ignore rules do not exclude them. Temporary execution still writes `.log` files.

After review, the full selected suite again passed 57/57 with exit 0. Its exact
source manifest and browser test snapshot are retained separately. A single
cursor-placement line was then added for the screenshot; the final three Unicode
cases passed again (28.5 seconds, exit 0). `capture-only-source-delta.txt` proves
that limited difference. Current console receipts and screenshots come from this
final focused run. The earlier 55/57 run with two Chromium suggested-name
expectation failures is retained under `filename-fallback-run/`; the actual
FEFF-only suggested filename is `download`. No production change was needed.

Publication checks preserve raw tool receipts verbatim, including runner-emitted trailing whitespace. Git whitespace checks passed for source, Markdown/JSON and replay scripts; verbatim text receipts and captured source/diffs are excluded from that formatting check. All archive files are staged and linked.
