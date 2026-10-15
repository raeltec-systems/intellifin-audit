# Independent review of worker process-test repair

No findings requiring a change. The test-only adjustment preserves the stalled-authority responsiveness proof and the exact-child completion/join assertions.

## Source identity and scope

A read-only SHA-256 comparison against `/tmp/zobba-review-21-1/final-source.json` checked all 180 manifest entries. Exactly one differs: `zobba/crates/worker/tests/inert_process.rs`, now SHA-256 `95cbd7582e1e47725767cc0b7bf850a363d12faae12578f1a6eaf78360eaa11d`. The other 179 entries match, including the production executor. The supplied `/tmp/zobba-21-1-worker-repair/inert-process.diff` matches the targeted change in the actual test source.

## Assessment

- The preserved full-run failure is an observation-window failure: `/tmp/zobba-21-1-repair-rust-tests-second-failure.log:343–344` reports `Some(Completed)` before procfs observed the actual 100 ms child. It does not report waiting for the authority timeout or an unjoined process. Increasing only this test child's duration to 500 ms gives procfs a larger opportunity to observe the process without changing production execution (`inert_process.rs:284`).
- The new timeout encloses both child observation and execution, beginning before the execution future is first polled (`inert_process.rs:295–305`). It is one total one-second budget, not a fresh one-second allowance after observation. Production `AUTHORITY_TIMEOUT` remains two seconds (`executor.rs:11,107`), so a regression that waits on the permanently pending authority request cannot pass by reaching that timeout.
- The real-wall-clock assertion at `inert_process.rs:306–307` prevents synchronous procfs work from producing a late apparent success merely because Tokio's timeout was not polled promptly. This strengthens enforcement of the stated total bound.
- Authority is still actually requested: the closure sets `requested` only when its async body is polled, then remains permanently pending; the test requires that flag (`inert_process.rs:288–290,308`). An execution path that simply skips authority checks does not pass.
- Completion is still the specific `Some(Observation::Completed)` result, not generic termination, cancellation or timeout (`inert_process.rs:309`). The early-completion-before-observation panic remains (`299`), so the test does not turn the original observation failure into an automatic success.
- The observed process remains tied to its unique per-test process token, actual parent PID, PID and procfs start time (`inert_process.rs:28–32,154–191`). `assert_joined` is unchanged and rejects a surviving or unreaped process with that same identity (`210–217,310`). The test cannot pass by matching an unrelated worker child or accepting a mere kill request.
- The separate stalled-authority shutdown test is unchanged and retains its 500 ms post-shutdown bound, `Cancelled` result and exact-child join check (`inert_process.rs:313–341`). The repair does not relax shutdown responsiveness.

## Evidence and limits

The isolated implementation-team log `/tmp/zobba-21-1-worker-repair/inert-process.log` records all 12 tests passing, including the changed completion case and unchanged stalled-authority shutdown case. The Clippy log records a successful finish; the rustfmt log is empty, consistent with a quiet successful check, but this review did not independently execute either command.

This remains a deliberately bounded real-process test: extreme scheduling or procfs delays can still make it fail. The repair enlarges the observation window and prevents false timing success; it does not claim to eliminate every timing-sensitive failure. Its one-second threshold continues to establish completion well before the actual two-second authority timeout.

No tests, database/IdP actions or source writes were performed during this review. The only write was this report. The full browser run and final full Rust run remain separate pending gates; the isolated 12-test pass is not represented as completion of those gates.
