# Foundation owner-review repair checkpoint

Date: 2026-10-01. Branch: `codex/zobba-foundation-batch`.
Parent: `ac47de0204219aafdf85b364be71ec83cd3f8321`.
Accepted integration source: `bbf79f36ee022835f95bb006c883a142e8d087da`.

The three requested repairs are complete, independently reviewed and verified on
the combined foundation. The commit containing this record is the repaired
checkpoint; its parent and integration source are pinned above.

## Repairs

1. Selectively integrated the accepted bootstrap checks without replacing newer
   infrastructure. Runtime admission follows INHERIT, SET and ADMIN membership
   paths, refuses MAINTAIN even on otherwise writable domain tables, and rejects
   the omitted foreign catalogs and event triggers. Schema 3's narrow grants,
   schema 1/2 upgrades and transactional rollback remain intact. All three SQL
   migrations, three catalog snapshots, catalog-signature SQL and both lockfiles
   are [byte-identical to the parent](owner-review-repairs/preserved-schema-and-locks.txt).
2. Protected browser reads now carry a captured-session refusal precondition.
   The server derives identity from the cookie and returns 412 when the expected
   session differs. GETs use that fence; Task/control/logout mutation contracts
   retain their previous CSRF/actor checks. One automatic recovery budget spans
   engagement and conversation reads. Repeated replacement withdraws the
   workspace until explicit retry, including after tab visibility changes.
   Verified same-account drafts/focus survive; another account remounts the
   workspace. Stale 401 responses cannot delete the replacement cookie.
3. `fixture:setup` explicitly invokes
   `pnpm --filter @zobba/oidc-fixture run setup`. CI calls the root shortcut and
   checks its generated output, using an isolated runner-temporary directory.
   Fresh and repeated setup, actual TLS discovery, generated-file preservation,
   private permissions and the exact CI preparation block were executed. Setup
   prints the configured env.sh path.

## Executed verification

Pinned local tools: Rust 1.98.1, Node 24.20.0, pnpm 11.25.0, PostgreSQL 18.4 and
Chromium 151. Tests used guarded, disposable databases. The complete Rust run
used restricted migration/runtime roles and an independent synthetic HTTPS OIDC
fixture. The superuser-migrator fallback was separately exercised.

| Gate | Result |
|---|---|
| Rust workspace | [83 passed](owner-review-repairs/rust-workspace.txt), zero failed; one helper discovery entry is deliberately ignored and executed by its passing reliability parent |
| Bootstrap, restricted and superuser configurations | [3/3](owner-review-repairs/bootstrap-restricted.txt) and [3/3](owner-review-repairs/bootstrap-superuser.txt); no skipped fixtures |
| Web contracts, TypeScript and units | 78 passed; production build passed |
| HTTPS OIDC fixture and exact CI setup block | [46 passed](owner-review-repairs/fixture-ci.txt) |
| Python guards and dependency boundaries | 47 passed; boundaries passed |
| Formatting, strict Clippy, locked builds and frozen pnpm install | Passed |
| Process smoke | Passed: repeated explicit migration, startup refusal, exact health, socket loss and same-process recovery |
| Actual full Chromium suite | [56 passed](owner-review-repairs/browser-full.txt) in 4.5 minutes; zero failures, skips or retries; additional [PGPORT health case passed](owner-review-repairs/browser-pgport-health.txt) |
| IPv4/IPv6 and PGPORT endpoint/proxy sockets | 5 passed; actual socket disconnect and recovery |
| Authenticated nondefault PGPORT relay | 1 passed; actual CLI migration, psql, sign-in and membership withdrawal/recovery; retained in the normal browser suite |

The main reproducible commands are `cargo fmt --check`,
`cargo clippy --workspace --all-targets --locked -- -D warnings`,
`cargo test --workspace --locked`, `cargo build --workspace --locked`,
`pnpm install --frozen-lockfile`, `pnpm check`, `pnpm build`,
`python3 -B -m unittest discover -s scripts -p 'test_*.py'`,
`python3 scripts/check-boundaries.py`, `python3 scripts/smoke.py`, and
`pnpm test:browser`, from `zobba/` with the documented disposable bindings and
fixture environment. These are local executions of the CI commands; no hosted CI
run, deployment or merge is claimed.

## Regression evidence

| Matrix concern | Executed proof |
|---|---|
| Original account-switch race | Hold the completed auditor-A session response, finish manager-A sign-in in another tab sharing the cookie, release it; manager identity appears with an empty composer and no old identity/draft flash |
| Retained private request | A real unconfirmed request remains byte-identical in auditor-A's IndexedDB binding; manager sees neither its recovery content nor a replay |
| Same-account continuity | Rotated session retains the mounted editor, draft, keyboard focus and selection after verification |
| Read consistency and mutation compatibility | All nine protected GETs reject an obsolete session without Set-Cookie; commands, reserved controls and logout retain their CSRF behavior |
| Stale unauthorized response | A delayed actual 401 does not clear the manager's valid cookie |
| Active polling and recovery limits | Actual conversation 412 withdraws the workspace; engagement and conversation mismatches consume one shared allowance; lifecycle events cannot replenish exhaustion, and explicit Retry works |
| Database admission | Real ADMIN self-regrant under restricted roles, PostgreSQL's superuser-promotion refusal, mixed-role authority, MAINTAIN and foreign-object fixtures prove refusal/readiness recovery without mutation |
| Migration atomicity | Install the interruption trigger only after preflight blocks on catalog writes; require failure and an identical snapshot |
| Harness endpoint dependency | Guard original database bindings before wrapping them in an owned relay; disconnected routing must fail at CLI migrate and psql, then recover through the same configured route |

The browser regressions live in
[account-binding.spec.ts](../../../zobba/web/tests/browser/account-binding.spec.ts)
and [auth-database-endpoint.spec.ts](../../../zobba/web/tests/browser/auth-database-endpoint.spec.ts).

The [original owner race failed before repair](owner-review-repairs/owner-race-negative-control.txt):
the original tab retained `auditor-a` and its private unsent draft.
[The captured synthetic browser image](owner-review-repairs/owner-race-before.png)
shows that failure. The [final browser image](owner-review-repairs/owner-race-after.png)
shows manager-A with an empty private composer and no auditor recovery item.
Task fixtures differ between the captured runs. The shared-budget test also
[failed with its new protection disabled](owner-review-repairs/conversation-budget-negative-control.txt),
observing five session reads where two were allowed. Separate [migration](owner-review-repairs/endpoint-migration-negative-control.txt)
and [psql](owner-review-repairs/endpoint-admin-negative-control.txt) bypass controls
failed at their intended assertions. All temporary controls were
removed and exact source restoration checked before final verification.

## Independent review and limits

[Three independent review lenses](REVIEW-OWNER-REPAIRS.md) inspected the full
tracked/untracked diff. Their accepted findings were repaired through the original
implementation lead. Independent recheck reports no remaining product-behavior
or verification gaps. Review also caught the shared retry budget, blocked Retry
visibility state, CI context placement, and authenticated harness routing gaps.

Session replacement is detected through bound reads and existing focus/poll
revalidation; this is not a claim of instantaneous notification between tabs.
Role closure deliberately rejects some unusable mixed membership combinations.
IPv6 coverage is real loopback socket/proxy routing; PostgreSQL qualification
used IPv4.
The existing foundation's inert executor and unfinished model/computer/audit
capabilities remain as documented in the [batch checkpoint](BATCH-CHECKPOINT.md).

[The source manifest](SOURCE-MANIFEST-OWNER-REPAIRS.json) pins all 122
workspace/workflow files. [The completed repair specification](../spec-foundation-owner-review-repairs.md)
contains a suggested review order.

Story 20.5 remains backlog. No next-story implementation, merge, deployment or
paid cloud qualification occurred in this repair batch.
