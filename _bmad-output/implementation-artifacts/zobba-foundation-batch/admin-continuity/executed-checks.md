Executed commands and selected final receipts (working directory `/workspace/intellifin-audit/zobba`):

- Source `/workspace/zobba-build-tools/activate-tests.sh` before every toolchain command.
- `bash /tmp/zobba-admin-continuity/run-rust.sh` — `cargo test --workspace --locked --offline` with real isolated PostgreSQL/OIDC; final `rust-tests.txt`, `rust-tests.exit`, `rust-counts.json`.
- `cargo test -p zobba-infrastructure --test admin_continuity --test bootstrap --locked --offline` — focused direct-SQL/upgrade/tamper run in `continuity-bootstrap.txt`, `.exit` (6 passed).
- `bash /tmp/zobba-admin-continuity/run-static.sh` — exact final formatter, Clippy, workspace build, web check/build commands; `fmt-complete`, `clippy-complete`, `build-complete`, `web-check-final`, `web-build-final` files.
- `pnpm fixture:test` — `fixture-tests.txt`, `.exit` (56 passed).
- `python3 -B -m unittest discover -s scripts -p 'test_*.py'` — `python-guards.txt`, `.exit` (47 passed).
- `python3 scripts/check-boundaries.py` — `boundaries.txt`, `.exit`.
- `bash /tmp/zobba-admin-continuity/run-smoke.sh` — repository `python3 scripts/smoke.py`, which itself builds bins, reruns bootstrap, checks exact refusals/health, interrupts its own DB proxy and proves process recovery.
- `bash /tmp/zobba-admin-continuity/run-browser.sh` — explicitly guarded browser disposable-schema reset followed by full `pnpm test:browser --workers=1 --retries=0`, real owned API/OIDC/PostgreSQL/S3 fixtures and installed Chromium. Browser plugin not available. Target flow: membership administration -> ordinary Save that narrows the last permanent Admin -> actionable refusal with unchanged state -> permanent replacement -> successful temporary-Admin Save.
- SHA-256 comparison of every published migration/catalogue 1–6 with `published-prefix-baseline.json`; `published-prefix-verification.json` confirms all 12 unchanged.

Retained initial failures and corrections:

- `capture.txt`, `.exit=3`: ad hoc catalogue capture initially used psql without an enclosing transaction; migration7's LOCK TABLE correctly refused. `capture-2` uses psql `-1` and succeeded.
- `web-check.txt`: initial concurrent web generated-API check ran before `schema-v7.catalog` had been created; `web-check-complete` and final full check passed after catalogue capture.
- `rust-tests-initial-compile.txt`, `.exit=101`: new migration concurrency test used tokio::spawn with SQLx migrator's non-Send future; changed to tokio::join! without changing transaction assertions.
- `rust-tests-initial-fixture.txt`, `.exit=101`: old evidence fixture tried ALTER TABLE after deferred Admin-check events (55006). Removed obsolete RLS toggles from all affected seed/test helpers; existing owner policies now preserve FORCE RLS continuously. Complete full workspace rerun passed.

The Rust aggregate counts retain 3 expected ignored helper entry points. Their owning tests explicitly invoke them with `--ignored` and guarded synthetic configuration: `composition::production_constructor_child` (four configurations, each required to report 1 passed), `gateway_worker_helper`, and `reliability_worker_helper`. No database suite is skipped.


Browser baseline and final repair sequence (preserved separately):

- Initial full `pnpm test:browser --workers=1 --retries=0` finished **97 passed, 2 failed / 99**, exit 1, in 9.0 minutes. `browser.txt`, `browser.exit`, `browser-results/` remain untouched.
- The evidence lost-upload-acknowledgement/restart case failed during its owner SQL fixture restoration, not its UI assertions. PostgreSQL confirmed identity-row → organisation-lock inversion against an API organisation-lock → identity-share reader. Sanitized fixed SQL and wait graph: `browser-baseline-fixture-deadlock.txt`. Repaired restoration by taking sorted organisation locks first and awaiting SQL asynchronously, with cleanup in the same transaction; production guard unchanged.
- The new Admin journey failed at Playwright `datetime-local.fill` before any Save because Chromium rejected redundant zero seconds. Used canonical minute input `2099-01-01T00:00`; epoch and behavior assertions unchanged.
- Root review additionally found optional 409 error decoding could wait forever on an open response body. Bounded optional decoding to 250ms and 4096 actual bytes, cancels best effort without awaiting source cancellation, always falls back to the known AccessError409. Existing successful JSON reader unchanged. Added stalled/partial/unclosed/oversized/dishonest-length/cancellation-stall and normal decoded-last_admin checks.
- `bash /tmp/zobba-admin-continuity/run-browser-targeted.sh` runs `pnpm test:browser evidence.spec.ts membership.spec.ts --grep 'lost upload acknowledgement|ordinary Save refuses' --workers=1 --retries=0` after a guarded disposable reset: **2 passed, 0 failed**, 14.5 seconds, exit 0. `browser-targeted.txt`, `browser-targeted.exit`, `browser-targeted-results/` include both new journey screenshots.
- `bash /tmp/zobba-admin-continuity/run-web-repaired.sh` runs final-source `pnpm check` (**111 passed, 0 failed/skipped**, plus TypeScript/generated API) and `pnpm build`; both exit 0 (`web-check-repaired`, `web-build-repaired`). These supersede the earlier 108-test web check.
- `bash /tmp/zobba-admin-continuity/run-browser-final.sh` is the full final-source browser rerun, unique `browser-final.txt`, `browser-final.exit`, `browser-final-results/`.
- No Rust, SQL or fixture-provider source changed during the browser/web repairs; `rust-final-source-manifest.json` records all crates/migrations bytes for later confirmation.

Final full browser rerun completed **99 passed, 0 failed, 0 skipped**, 8.6 minutes, exit 0. Both previously failed cases passed, including the complete last-Admin refusal/replacement journey. Final source manifest confirms all 183 files unchanged during the run; Rust-specific manifest confirms all 104 crates/migrations files unchanged since their final checks.


Final post-review repair checkpoint — 1 October 2026

The 183-file / 111-web-test results above are the preserved pre-review checkpoint. The definitive post-review implementation and verification are recorded in [review-repair-executed-checks.md](review-repair-executed-checks.md); earlier failed attempts remain preserved with their corrections.

All eleven review repairs are complete. Final checks passed: full Rust workspace 176 passed, 0 failed, 3 expected ignored helper entrypoints exercised by their parent tests; focused SQL/membership/fixture 10 passed; web check 113 passed plus TypeScript/generated-API equality; fixture tests 56 passed; Python guards 47 passed; formatting, strict Clippy, workspace/web builds, boundaries and process smoke all exit 0. Definitive full browser run is **99 passed, 0 failed, 0 skipped**, 8.5 minutes, exit 0: `review-repair-browser-verified.txt`, `review-repair-browser-verified.exit`, and `review-repair-browser-verified-results/`. The separately focused full membership file passed 17 cases.

Final source manifest `review-repair-verified-source-manifest.json` contains 184 files; `review-repair-verified-source-verification.json` confirms all match after the final browser run. The only delta from the passed post-review Rust/smoke/static/unit/build source is the independently reviewed browser response observer in `web/tests/browser/membership.spec.ts`, recorded in `review-repair-verified-source-delta.json`; production source is unchanged. This one journey buffers real upstream responses for reliable exact-JSON observation; separate uninstrumented browser cases and delayed/stalled-body client checks cover the production read/cancellation behavior. Published migrations/catalogues 1–6 remain byte-identical. Final receipts, source map and remaining deliberate limitations are summarized in `review-repair-final-checks.json`, `review-repair-source-map.md` and `review-repair-handoff.md`.
