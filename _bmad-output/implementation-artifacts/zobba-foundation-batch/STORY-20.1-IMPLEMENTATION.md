# Story 20.1 implementation checkpoint

30 September 2026. Canonical source:
[`spec-20-1-reproducible-zobba-workspace.md`](../spec-20-1-reproducible-zobba-workspace.md).
Story 20.1 is accepted after implementation, consolidated review patches and
independent targeted verification. See [review evidence](REVIEW-20.1.md).
This checkpoint does not claim remote CI or later stories are implemented.

## Delivered behavior

`zobba/` is an independent Cargo and pnpm workspace. Rust 1.98.1, Node 24.20.0,
pnpm 11.25.0 and exact direct dependency versions/lockfiles are recorded.
Domain and application ports depend inward; SQLx stays in infrastructure.
API, worker and migration CLI are explicit entrypoints. There is no legacy
compiler, Node domain bridge, audit table, authentication bypass or agent.

Only `zobba-cli migrate --runtime-role zobba_app` applies the versioned bootstrap.
It serializes preflight/migration and safely repeats against the current schema.
Runtime startup uses a restricted role and a bounded read-only database check;
it refuses unmigrated/foreign/altered schemas, unsupported PostgreSQL versions,
owner/elevated roles and accidental metadata-write privileges. It checks the
marker, migration versions/checksums, columns, constraints and unexpected
schema objects. API and worker independently expose liveness and readiness;
database loss returns 503 readiness while they remain live.

The Pair React/Vite shell shows real API health, labelled on-request checking,
keyboard retry and truthful unavailable states. API-owned Rust handlers/types
emit OpenAPI; `pnpm check` compares both the document and generated TypeScript
against those sources. Selected identity/font/token bytes and provenance are
recorded in [`zobba/REUSE.md`](../../../zobba/REUSE.md).

`Zobba foundation` CI runs only this workspace and disposable PostgreSQL 18.4.
Its distinct name avoids the historical Release workflow's `CI` trigger.
Setup, separate roles, explicit migrations and all checks are documented in
[`zobba/README.md`](../../../zobba/README.md). Historical files remain intact.

## Verification observed in this cloud instance

All commands ran from `zobba/` with the pinned tools and dedicated synthetic
development/test databases. Tests and smoke were sequential on the test database.

- `cargo fmt --check` passed.
- `cargo clippy --workspace --all-targets --locked -- -D warnings` passed.
- `cargo test --workspace --locked` passed after the review patch: four unit
  tests, two direct-test endpoint guard cases and one expanded real PostgreSQL
  contract (seven executed tests). The database contract covers fresh/repeat,
  ownership/column writes/SET ROLE, foreign schema and executable view refusal,
  altered columns/defaults/constraints/indexes/RLS/persistence/types/rules,
  marker and migration refusal, atomic interruption/retry, lock contention and
  a post-connect network blackhole bounded by the migration deadline.
- `cargo build --workspace --bins --locked` passed inside process smoke.
- `pnpm install --frozen-lockfile`, `pnpm check` and `pnpm build` passed;
  two health-parser tests executed and deliberate stale-type drift was refused.
- `python3 scripts/check-boundaries.py` passed. The committed Python regression
  suite now passes 44 cases, including URL aliases/overrides, raw/concatenated
  Rust source paths, unresolved dynamic includes, inherited TypeScript resolver
  bases, Vite re-export/imported-config escapes and proxy pause/recovery.
  Earlier eight isolated dependency-graph mutations were also refused.
- `python3 scripts/smoke.py` passed: invalid URL containing a synthetic secret
  produced only the stable error code; both processes refused an unmigrated
  database; CLI migration succeeded twice; both health contracts matched; cutting
  only test proxy connections caused 503 readiness with 200 liveness; restoration
  required those same processes to recover readiness. Startup and dependency-loss
  telemetry contained only allowlisted service/error codes.
- Playwright inspected actual healthy and unavailable shell states; keyboard
  refresh retained focus, SVG/font assets loaded, and 1280, 390 and 320 pixel
  widths had no overflow. Healthy browser run had no console/page errors or
  framework overlay. Desktop/mobile captures were visually inspected.
- The committed `ZOBBA_BROWSER_EXECUTABLE=/usr/bin/chromium pnpm test:browser`
  regression passed 1/1 on the final test-database build after recovery smoke.
  It verifies actual HTTP 503, visible Unavailable, restoration through the same
  API process, keyboard Check again focus and a 390-pixel viewport.
- Workflow YAML structure and source whitespace checks passed. The verbatim
  upstream OFL notice retains its original trailing space on line22; that exact
  preserved asset is excluded from the whitespace check. Remote CI is unrun.

## Bounded behavior and independent acceptance

Story 20.1 migrates empty databases and repeats only the exact current bootstrap.
It does not yet support previous-version upgrades or rolling compatibility.
Story 20.2 must explicitly admit valid previous migration prefixes while retaining
foreign-schema refusal. No paid service, real data or deployment was used.

The root reviewer accepted the patched implementation after independent targeted
retests; root owns the final specification/sprint acceptance and commit. The expanded database
contract also passed on a separate local synthetic database owned by a
NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOINHERIT migrator. A separate test-admin binding
created and removed unsafe roles and the interruption fixture; normal migration
and runtime connections retained their restricted roles.

## Review patch regressions

- Foreign `public.current_setting` and a volatile view under an owned metadata
  name are refused before invocation. Catalog references are qualified and
  physical metadata structure is inspected before data.
- Runtime checks include column privileges, reachable NOINHERIT/SET ROLE
  authority, differing session/current users, replication and a named set of
  powerful predefined roles. The harmless `pg_monitor` case succeeds. Migration
  uses that same target-role check before changes and after default/granted ACLs.
- SQLx ledger creation, migration and grants share one outer transaction. An
  injected DDL interruption leaves the pre-migration snapshot unchanged and retry
  succeeds. Malformed, empty and nonempty foreign partial ledgers are refused.
- A competing migrator waits on the migration lock without changing definitions,
  data or ACLs. A proxy blackholes replies after the lock request: the ten-second
  whole-session deadline closes the connection, releases the lock and permits retry.
- Destructive-test admission compares normalized full endpoint sets, explicit
  database identities and configured development bindings before reset. Direct
  guard cases include IPv4, IPv6, mapped IPv6, decoded names and partial DNS overlap.
- The browser regression uses the real API, Vite and a database socket proxy.
  Removing only the Unavailable label branch causes the exact visible-status
  assertion to fail (`Ready` instead of `Unavailable`); the source was restored.
  No request interception or invented application response supplies that state.
