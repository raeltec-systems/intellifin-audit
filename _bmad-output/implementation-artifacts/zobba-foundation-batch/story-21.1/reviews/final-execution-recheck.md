# Story 21.1 final independent execution recheck

No unresolved repair or test-completion finding remains in the verification review. R07's previously pending empty-page execution is now closed. The prior repair review's other closures remain supported by the final source and completed combined runs. One receipt limitation is retained explicitly: the full browser run's shell exit status was lost with the tool session; its passing Playwright result is independently evidenced, but a shell exit code of zero is not asserted.

This was read-only inspection and hashing of source and existing artifacts. No tests, database/IdP operations, browser sessions, or source edits were performed. Only this report was written.

## Exact candidate identity

- Independently rehashed all 180 entries in `/tmp/zobba-review-21-1/checkpoint-source.json` and `/tmp/zobba-21-1-repair-source-freeze-final.sha256`: zero current-file mismatches, and identical path/hash mappings between the two manifests.
- Comparison with the previously reviewed `/tmp/zobba-review-21-1/final-source.json` finds exactly one changed file: `zobba/crates/worker/tests/inert_process.rs`, SHA-256 `95cbd7582e1e47725767cc0b7bf850a363d12faae12578f1a6eaf78360eaa11d`. All 179 other entries, including the final R07 browser/source change and production executor, match the reviewed candidate.
- The new test-only change is independently assessed in `/tmp/zobba-review-21-1/worker-test-repair-review.md` and was also inspected for this recheck. `inert_process.rs:284` gives the actual child a 500 ms observation window; `:295–307` places observation and completion inside one total one-second timeout and checks elapsed wall time. The test still requires a polled, permanently pending authority request, exact `Completed` outcome, and exact-child join (`:308–310`). The unchanged production authority timeout is two seconds (`crates/worker/src/executor.rs:11,107`); the separate shutdown proof remains bounded to 500 ms (`inert_process.rs:313–341`).

## Completed execution evidence

| Gate | Independently checked evidence | Disposition |
| --- | --- | --- |
| Full Rust | `/tmp/zobba-21-1-repair-rust-tests.log`: recomputed 34 successful result blocks, 172 passed, zero failed, three ignored helper entrypoints; persistent `/tmp/zobba-21-1-repair-rust-tests.exit` is `0`. Log SHA-256 matches `repair-rust-completion.json`: `f9db14445cee8c739dbc42f372948d5fc0f3cd4c756445e33c3f00676e310951`. | Complete and passed. |
| Ignored Rust helpers | Production configuration child is explicitly invoked by the passing HTTP parent and its selected-test success is asserted (`crates/api/tests/evidence_http/composition.rs:12–76`). Gateway/reliability parents explicitly launch their helpers with `--ignored --exact` (`crates/worker/tests/gateway_process.rs:282–287`, `reliability_process.rs:350–356`). Corresponding parent suites pass in the final log (`:40–47`, `:314–322`, `:342–364`). | Three ignored top-level helper entries are not three unexecuted test obligations. |
| Worker test repair | Isolated `/tmp/zobba-21-1-worker-repair/inert-process.log` records 12/12 passing. Final full Rust log explicitly passes the changed stalled-authority completion test at `:337` and all 12 process tests at `:340`. | Test-only delta is reviewed and covered in isolation and in the full run. |
| Full Chromium | `/tmp/zobba-21-1-repair-browser-full.log`: independently counted 95 passing numbered cases and final `95 passed (12.3m)` at `:103`; actual `/tmp/zobba-21-1-repair-browser-full/.last-run.json` says `passed` with no failed tests. Log SHA-256 matches completion JSON: `49b72454d14a1389b4fd73cc1c1dc9216a68c58e3b562e1c9e249ed42db849d6`. | Suite complete and passed. Shell exit receipt is unavailable; completion JSON accurately says `shell_exit_code: null` and explains the transport loss. Normal owned-fixture cleanup is recorded by the lead, not newly probed by this reviewer. |
| R07 final focused | `/tmp/zobba-21-1-repair-browser-paging-final.log` records 1/1 passing; final full browser log also records the pagination case passing at `:81`. Source `web/tests/browser/evidence.spec.ts:318–338` performs the real completion, retained-cursor refresh to zero rows, empty-page explanation assertion, and Previous navigation back to 50 rows. | R07 final follow-up closed; its former execution-pending qualification is superseded. |
| Process smoke | `/tmp/zobba-21-1-repair-smoke.log:12` records bootstrap 3/3; `:22` records `Zobba process smoke passed.` Persistent `.exit` is `0`. | Complete and passed. |
| Final formatting | `/tmp/zobba-21-1-repair-run-final-static.sh:6` runs `cargo fmt --all --check`; `repair-fmt-final.exit` is `0`, with quiet empty log. | Complete and passed on final source. |
| Final workspace Clippy | Same script `:10` runs `cargo clippy --workspace --all-targets --locked --offline -- -D warnings`; final log records successful completion and `repair-clippy-final.exit` is `0`. | Complete and passed on final source. |

Source paths above are relative to `/workspace/intellifin-audit/zobba`; abbreviated artifact filenames refer to `/tmp/zobba-21-1-...` files specified in the same row.

## Repair coverage retained

R03, R13, R14, R15, and R16 remain closed under the concrete assertions documented in `/tmp/zobba-review-21-1/verification-repair-recheck.md`. In particular, the production-router configured/unconfigured children and composed 15-second versus 120-second deadlines run through the passing HTTP parent; the quota proof still observes exact durable counts, replay/conflict, isolation, and completion releasing one slot. The separate non-C PostgreSQL evidence remains the recorded `en_US.utf8` comparison of default versus explicit C ordering and passing restricted-repository test; the full run is not substituted for that specific qualification. Browser provenance assertions inspect actual rendered hash, size, and storage version. The final full browser run includes the repaired R03/R04/R05/R06/R08/R10 cases (`repair-browser-full.log:63–68`), acquisition/provenance, and final pagination/R07/R09 assertions. The other consolidated R01–R12 source/test closures from the prior repair review are unchanged; R07's only outstanding execution requirement is now satisfied.

## Intermediate failures preserved

The initial repaired full Rust run failed membership HTTP with `membership_unavailable`/503 instead of 200; `/tmp/zobba-21-1-repair-rust-tests-first-failure.log` remains the failure record. The standalone reproduction passed and the final full log explicitly passes the same membership test at `:66`.

The second full Rust attempt failed the worker procfs observation assertion, reporting `Some(Completed)` before the 100 ms child was observed (`repair-rust-tests-second-failure.log:343–344`). The reviewed test-only timing repair addresses that observation window without relaxing the one-second total completion proof or exact-child cleanup; isolated 12/12 and final full 172/172 are the subsequent evidence.

The earlier focused browser run's pagination locator assertion compared whitespace-sensitive combined button text; `/tmp/zobba-21-1-browser-repair-root.log` retains that failure. The corrected filename locator and final empty-page extension are covered by the later focused and full passing browser runs. These final passes supersede the prior pending combined-gate status; none of the intermediate failed runs is represented as passing.
