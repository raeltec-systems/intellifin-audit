# Story 21.1 worker process-test repair

Only repository source changed: `zobba/crates/worker/tests/inert_process.rs`, in `actual_child_completion_remains_responsive_while_authority_is_stalled`.

The previous full run returned `Some(Completed)` before the procfs observer found the 100 ms child. The panic was in observation setup, before the responsiveness assertion. The source permits this race: a synchronous scan of global `/proc` runs alongside the actual short-lived child, and test scheduling can miss its lifetime. Failed-run descheduling was not reconstructed.

The approved repair uses a 500 ms actual child and one 1 s timeout around both observation and execution. A monotonic elapsed-time assertion also bounds the operation because synchronous procfs work can delay polling an async timeout. The authority-requested assertion, `Some(Completed)` assertion, and exact PID/start-time joined assertion remain. The entire case must finish before the real executor's 2 s authority timeout. No executor code, production hooks, database, or IdP were changed or used. This provides bounded scheduling tolerance, not a claim of deterministic observation under arbitrary host suspension.

## Verification

All commands run in `/workspace/intellifin-audit/zobba` after sourcing `/workspace/zobba-build-tools/activate-tests.sh`.

- `cargo test -p zobba-worker --test inert_process -- --nocapture`: first repaired run passed 12/12 in 1.04 s. Log: `inert-process.log`.
- `rustfmt --check --edition 2024 crates/worker/tests/inert_process.rs`: passed. Log: `rustfmt.log`.
- `cargo clippy -p zobba-worker --test inert_process -- -D warnings`: passed with no warnings in 23.89 s. Log: `clippy.log`.
- Exact one-file patch: `inert-process.diff`.

The earlier read-only diagnosis attempted the same isolated Cargo test command before this repair. It failed at worker binary linking with SIGBUS, before any test execution, while the workspace overlay was full (58 MB free). Root removed only the reproducible Zobba incremental cache, restoring 12 GB. That environment failure remains separately recorded at `/tmp/zobba-21-1-worker-race-isolated.log`; it is not a failed process test or a retry-until-green result.

Read-only procfs measurements: 10 scans over 582 readable cmdlines, median 5.235 ms, maximum 8.257 ms. These are current-host observations only, at `/tmp/zobba-21-1-worker-race-proc-timings.log`.
