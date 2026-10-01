# Story 20.5 verification outputs

See [implementation evidence](../../story-20-5-implementation-evidence.md) for
results and limits, [independent review](../REVIEW-20.5.md) for findings and repairs,
and [source manifest](../SOURCE-MANIFEST-20.5.json) for the tested source hashes.
The `.txt` files preserve command output with trailing whitespace and empty final
lines removed for repository formatting; the result record also includes the
original output hashes. Empty formatting output means the command succeeded.
Failed intermediate runs have explicit `failed-` names and
are not acceptance evidence.

## Environment and isolation

Verification ran locally on 2026-10-01 using Rust 1.98.1, Node 24.20.0,
pnpm 11.25.0, PostgreSQL 18.4 and installed Chromium 151. The real HTTPS OIDC
fixture runs separately from the Rust application. No Browser plugin was
available; the repository's Playwright suite drove actual Chromium.

The Rust workspace suite used disposable `zobba_patch20_3_test` on
`127.0.0.1:55434`, restricted migration owner `zobba_patch20_3_owner`, nonowner
runtime `zobba_patch20_3_app`, and explicit fixture administrator
`zobba_local_admin`. Smoke and browser suites used separate disposable
`zobba_story_20_test` with `zobba_app` runtime. Suites were serialized within each
database; development data was not reset. Fixture-only administrative writes
arrange adversarial cases and do not grant runtime authority.

## Commands

All commands run from `zobba/`, after activating the installed toolchain and
configuring the guarded test database URLs described above. Rust HTTP tests also
source the independent identity fixture's generated environment. Private fixture
configuration and browser session state are excluded from this package.

```sh
cargo fmt --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
cargo build --workspace --locked
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm fixture:test
python3 -B -m unittest discover -s scripts -p 'test_*.py'
python3 scripts/check-boundaries.py
python3 scripts/smoke.py
pnpm test:browser
```

Smoke precedes browser setup so its deliberate reset establishes the expected
fixture issuer. Browser uses `ZOBBA_BROWSER_EXECUTABLE=/usr/bin/chromium` and
`ZOBBA_BROWSER_OUTPUT_DIR=/tmp/zobba-20-5-final-browser-results`.

Focused repair commands (also covered by the final workspace run):

```sh
cargo test -p zobba-infrastructure --test task --test operations --locked
cargo test -p zobba-api --test operations_http --locked -- --test-threads=1
cargo test -p zobba-worker --test gateway_process --locked -- --test-threads=1
```

Two outer Rust tests are process entry points marked ignored for discovery; the
gateway and reliability harnesses invoke them in actual spawned child processes.
Their presence is not an unexecuted qualification scenario.

The GitHub workflow runs on pull requests, main pushes or manual dispatch.
Pushing this foundation branch does not itself execute hosted CI. These files
record local execution; they do not claim a hosted CI result.
