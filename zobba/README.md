# Zobba foundation

This independent workspace builds the Rust API, worker, explicit migration CLI
and Pair web shell for Story 20.1. Health reports the actual database state.
Authentication, engagement work, audit execution and real computers are later
capabilities; this bootstrap does not claim them.

Run every command below from `zobba/`. The historical repository-root Node
application has its own workspace and database. Zobba does not import that
application, run its compiler or use its migrations.

## Prerequisites

- Rust **1.98.1**, including `rustfmt` and `clippy` (selected by
  `rust-toolchain.toml`), and a native compiler/linker.
- Node **24.20.0** and pnpm **11.25.0**, selected by `.nvmrc` and `package.json`.
- PostgreSQL **18**, a dedicated development database and a second disposable
  database whose name ends in `_test`. Docker is optional.
- Python **3.11+** for the dependency/process checks; no Python packages required.
- A PostgreSQL admin client such as `psql` for initial role/database provisioning.
  Runtime builds and smoke checks do not require `psql`.

With Rustup, nvm and Corepack installed:

```sh
rustup toolchain install 1.98.1 --profile minimal --component rustfmt --component clippy
nvm use
corepack enable
corepack prepare pnpm@11.25.0 --activate
pnpm install --frozen-lockfile
cargo build --workspace --locked
```

Use equivalent tool activation on hosts with managed installations. Preserve TLS
and package verification. The application depends on the pins and environment
variables, not a machine-specific setup directory.

## Database setup

Provision fresh databases on your local PostgreSQL 18 server. For example, run
the following in an administrator's interactive `psql` session. The password
commands prompt securely; use these local credentials only in local settings.

```sql
CREATE ROLE zobba_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
\password zobba_migrator
CREATE ROLE zobba_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
\password zobba_app
CREATE DATABASE zobba_dev OWNER zobba_migrator;
CREATE DATABASE zobba_local_test OWNER zobba_migrator;
REVOKE ALL ON DATABASE zobba_dev FROM PUBLIC;
REVOKE ALL ON DATABASE zobba_local_test FROM PUBLIC;
GRANT CONNECT ON DATABASE zobba_dev, zobba_local_test TO zobba_app;
```

The migrator owns schema objects. The runtime role must be a distinct, nonowner
role without superuser, BYPASSRLS, role/database creation or schema creation
privileges. Migration grants that role only usage and read access to bootstrap
metadata. It does not grant domain writes or enable schema changes at startup.
Admission and live readiness conservatively traverse membership edges with any
INHERIT, SET or ADMIN option, including mixed paths and ADMIN self-regrant. Unsafe
role attributes, dangerous predefined roles and direct table MAINTAIN grants are
refused; harmless `pg_monitor` membership remains supported. This conservative
closure can also refuse memberships whose combined options cannot immediately be
used by a single session. Use separate monitoring identities for such ambiguous
membership graphs.

The exact bootstrap inventory also refuses public collations, operators, operator
classes/families, conversions, text-search objects, extended statistics and all
database event triggers. These objects are foreign even if the two bootstrap
tables otherwise match. Migration preflight and runtime checks share this rule.

Copy `.env.example` to ignored `.env` and replace the local placeholders. URL-encode
special characters in passwords. Existing managed environments may already export
the four database variables and need no file. The processes read environment
variables, not `.env` files automatically. To load your local file:

```sh
set -a
. ./.env
set +a
```

Only the explicit CLI command applies migrations:

```sh
cargo run -p zobba-cli --locked -- migrate --runtime-role zobba_app
```

This command reads `ZOBBA_MIGRATION_DATABASE_URL`; repeating it is safe against
the same valid schema. Story 20.1 accepts an empty database or this exact bootstrap
schema; it does not yet implement upgrade paths from prior schema versions or
rolling release compatibility. Future schema stories must add their own validated
migration paths. API and worker read only `ZOBBA_RUNTIME_DATABASE_URL` and
refuse an unmigrated, foreign, altered or incompatible schema. Do not provide
migration credentials to deployed runtime processes. The generic legacy
`DATABASE_URL` is never used by this workspace.

## Start the processes

After migrating, start each command in a separate shell with the runtime variable
loaded:

```sh
cargo run -p zobba-api --locked
```

```sh
cargo run -p zobba-worker --locked
```

```sh
pnpm dev
```

The default API is `127.0.0.1:4310`; the worker is `127.0.0.1:4311`.
`ZOBBA_API_BIND` and `ZOBBA_WORKER_BIND` override them. The web development server
uses port **5173** and proxies its health requests to the API; set
`ZOBBA_API_PROXY_TARGET` if the API address changes. It displays unavailable state when the API
or database cannot provide current readiness; it does not invent work.

Both Rust processes expose:

| Request | Healthy response | Dependency failure |
|---|---|---|
| `GET /health/live` | 200, `status: "live"`, `schema_version: null` | Remains live while the process can serve |
| `GET /health/ready` | 200, `status: "ready"`, `schema_version: 1` | 503, `status: "unavailable"`, `schema_version: null` |

Each response also identifies `service: "api"` or `service: "worker"`. Readiness
checks the supported schema through the restricted runtime connection. Startup
refusals and operational failures use stable non-secret diagnostics.

## Verify the workspace

Export both `ZOBBA_TEST_MIGRATION_DATABASE_URL` and
`ZOBBA_TEST_RUNTIME_DATABASE_URL` before the real database checks. They must point
to the same dedicated disposable `_test` database, using distinct roles; the
runtime role is derived from the runtime URL (a bounded lowercase PostgreSQL
identifier). These checks deliberately drop the test schema and
must never receive a development, historical or customer database. Run them
sequentially: integration tests and smoke share that disposable database.
Test URLs require explicit TCP hosts, database names and roles. The guard decodes
identities and resolves host aliases before comparing them with each other and
both configured development URLs; `localhost`, IPv4 loopback and IPv6 loopback
count as the same host. Query parameters are limited to `sslmode`, `ssl-mode` and
`application_name`: routing, database and role overrides are refused before any
schema changes. `PGOPTIONS` is unsupported for destructive checks; an omitted URL
port follows `PGPORT` or defaults to 5432.
The authority-refusal fixtures additionally use
`ZOBBA_TEST_ADMIN_DATABASE_URL`, pointing to that same `_test` database with a
dedicated local/CI administrator. They use it only to arrange and remove unsafe
role fixtures; normal migration and runtime processes do not require it. If it is
absent, the test migrator must itself be a local superuser. The separate admin URL
lets CI verify the normal non-superuser migrator. Runtime smoke processes never
receive the admin or migration credentials.

```sh
cargo fmt --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
cargo build --workspace --locked
pnpm install --frozen-lockfile
pnpm check
pnpm build
python3 -B -m unittest discover -s scripts -p 'test_*.py'
python3 scripts/check-boundaries.py
python3 scripts/smoke.py
# Once Chromium is installed for the owned Playwright dependency:
pnpm test:browser
```

The boundary check reads Cargo's actual workspace metadata, enforces inward crate
dependencies and rejects local paths/imports escaping this workspace or bringing
in the old Node backend. Domain has no crate dependencies; application owns ports;
infrastructure implements them; API and worker compose them. The CLI may consume
the API-owned interface to generate OpenAPI.
The source check resolves literal Rust includes, raw strings and literal
`concat!`/`CARGO_MANIFEST_DIR` paths, and rejects unresolved dynamic inclusion.
TypeScript configuration paths and inherited local JSON configurations must stay
inside this workspace. Vite resolver customization and dynamic configuration are
refused until their resolution can be checked explicitly. Script regressions
exercise these refusals in isolated temporary fixtures without changing sources
or accessing PostgreSQL.

Smoke builds the real binaries, runs the destructive PostgreSQL contract tests,
proves both processes refuse an unmigrated database, invokes the migration CLI
twice, and checks exact API/worker liveness and readiness. It then cuts only its
own PostgreSQL proxy connections to prove 503 readiness while both processes stay
live, then restores forwarding on the same port and requires those same processes
to recover readiness and liveness. It does not stop the database server or alter a shared login role. Child
processes and proxy sockets are cleaned up on failure as well as success. Negative
configuration fixtures and captured startup/dependency-loss logs verify that
telemetry contains only allowlisted service/error codes and no supplied credential
or content sentinel.

The API owns OpenAPI, emitted without a database connection by:

```sh
cargo run -p zobba-cli --locked -- openapi
```

`pnpm check` verifies that checked-in web types match this owned interface, and
`pnpm build` builds only the Pair web shell. See [REUSE.md](REUSE.md) for selected
Pair asset provenance and licences.

The [owned browser regression](web/tests/browser/README.md) starts its own API,
Vite server and database proxy. It proves visible Ready → Unavailable → Ready
through actual socket loss and recovery, keyboard refresh focus and a narrow
viewport. Install its browser with `pnpm --filter @zobba/web exec playwright
install chromium`, or select an existing local Chromium with
`ZOBBA_BROWSER_EXECUTABLE`. The harness never migrates or mutates database content.

The separate [Zobba foundation workflow](../.github/workflows/zobba.yml) runs these
gates with disposable PostgreSQL 18.4 and the workspace's own lockfiles/cache.
Its distinct workflow name keeps it outside the historical deployment trigger.
This story creates no deployment or customer launch configuration.
