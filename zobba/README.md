# Zobba foundation

This independent workspace builds the Rust API, worker, explicit migration CLI
and Pair web interface through Story 20.2. Real OIDC sign-in creates opaque Rust
server sessions; current membership limits engagement selection to explicitly
assigned work. Health reports the actual database state. Task execution, audit
conclusions, real computers and customer SSO qualification remain later capabilities.

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
- OpenSSL for the HTTPS identity fixture, and a PostgreSQL admin client such as
  `psql` for initial role/database provisioning and browser fixtures.
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
privileges. Migration grants narrow identity/session operations, current assigned
engagement reads and engagement-name updates protected by forced RLS. Runtime
cannot change identity activation, roles or assignments. Schema changes never run
at startup.

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
the same valid schema. It accepts empty databases, an exactly verified Story 20.1
prefix, or the exact Story 20.2 schema. Physical catalog checks precede metadata
reads; migration checksums, changes and restricted grants are validated atomically.
Foreign, altered and newer states refuse without mutation. API and worker read
only `ZOBBA_RUNTIME_DATABASE_URL` and
refuse an unmigrated, foreign, altered or incompatible schema. Do not provide
migration credentials to deployed runtime processes. The generic legacy
`DATABASE_URL` is never used by this workspace.

## Local HTTPS sign-in and verification


Set up the independent pinned `oidc-provider` fixture once, then source its
private generated configuration in every shell starting the fixture, API or web:

```sh
pnpm fixture:setup
. fixtures/oidc/.local/env.sh
cargo run -p zobba-cli --locked -- seed-local
pnpm fixture:start
```

Run migrations first and seed before the first synthetic sign-in. Then start the
API and web as below in separate shells. The explicit `seed-local` command requires
`ZOBBA_LOCAL_FIXTURES=1`, a loopback HTTPS issuer and a loopback migration database.
The first successful seed records its issuer in owner-controlled bootstrap metadata.
Repeating with that issuer preserves deleted, disabled and expired authority;
it does not recreate missing memberships or assignments.
A different issuer cannot rebind existing fixture identities. Seed runs as one
owner transaction, restoring forced RLS before commit; runtime cannot perform it.

Synthetic accounts `auditor-a` and `manager-a` (Audit manager plus Admin) reach
Northstar / Alder Manufacturing / FY2026 audit; `auditor-b` reaches
Meridian / Beacon Services / FY2026 review. `admin-only` and `unassigned` get no
client work. The password is generated into ignored, permission-restricted
`fixtures/oidc/.local/fixture.json`; do not copy it into logs or source control.
See [fixture instructions](fixtures/oidc/README.md).

The app uses HTTPS `localhost:5173`; the IdP uses HTTPS `127.0.0.1:9443`, keeping
cookies on distinct hosts. Register exactly
`https://localhost:5173/api/auth/callback`; Vite strips `/api` for Axum's
`/auth/callback`. Trust the generated CA for manual browser use. Rust verifies
TLS with the explicit fixture CA. Certificate-ignore is confined to the owned
synthetic browser tests. Health remains available at `/status`, and API/worker
health remains usable without OIDC configuration; sign-in then reports unavailable.

Ordinary OIDC configuration supplies `ZOBBA_OIDC_ISSUER`, `ZOBBA_OIDC_CLIENT_ID`,
`ZOBBA_OIDC_CLIENT_SECRET`, `ZOBBA_PUBLIC_ORIGIN` and
`ZOBBA_OIDC_REDIRECT_URI`. `ZOBBA_OIDC_AUTHORIZATION_ORIGIN` can authorize a
separate trusted hosted-login/token origin, as needed by Cognito; JWKS stays on
the issuer origin. Never derive these URLs from request headers. Loopback identity
and custom CA settings require deliberate fixture mode. No customer or production
identity deployment has been qualified by this slice.

Sessions expire after eight hours and use hashed random server tokens with
`__Host-` Secure/HttpOnly/SameSite=Lax cookies. Provider tokens are discarded.
Logout requires POST, the exact configured Origin and session-bound CSRF.
Pending or failed sign-out stays separate from automatic access refresh; retry
continues sign-out, and an already expired session counts as signed out.
Each protected request checks current session/membership; forced RLS and composite
references independently enforce scope. Auth requests have a 15-second overall
deadline, with separate IdP HTTP byte/connect/total limits and discovery backoff.
Verification keys expire from the cache after five minutes. Relevant unknown-key
or signature failures get one coalesced refresh/retry; failed refresh cannot use
an expired cache. Public login admission is capped atomically at 1,000 outstanding
unexpired attempts. Capacity returns a fixed recoverable 429 response. Login and
session expiry cleanup deletes at most 128 indexed rows per operation.

The chooser fetches 50 freshly authorized assignments per page with a complete
organisation/client/engagement cursor; a saved explicit scope opens independently
of the current page. Scope IDs contain 1–128 ASCII letters, digits, underscores or
hyphens. Labels contain 1–200 Unicode scalar values, no C0/C1 controls and no
leading or trailing Unicode White_Space. The database, Rust, generated contract
and browser share these bounds.

`cargo test --workspace --locked` requires the actual fixture running and its
generated environment sourced. The protocol suite exchanges actual codes and
covers issuer/audience/signature/algorithm/key/authorized-party/time/nonce errors,
PKCE, replay, key rotation and oversized/slow/redirected responses. The database
suites exercise hashed state/session tokens, competing one-use login consumption,
logout/expiry/fixation, current authority, scoped DML/joins/composite references,
and commit/rollback/cancellation through one physical pooled connection. Missing
prerequisites fail the tests; matrix rows are never silently skipped.

Run `pnpm test:browser` after smoke and with `ZOBBA_TEST_ADMIN_DATABASE_URL` set
for the same guarded disposable database. The auth harness owns a separate IdP on
port 9444 and an HTTPS app on a free port, and proves login/chooser/denial,
logout/CSRF and retry races, real replacement-session revocation, paginated scope,
revocation/expiry and narrow keyboard use. It retains screenshot
proof in `/tmp/zobba-browser-results`. Never run destructive database suites
concurrently. `pnpm fixture:test` separately validates the independent fixture.

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
uses port **5173** and proxies API requests to the API; set
`ZOBBA_API_PROXY_TARGET` if the API address changes. It displays unavailable state when the API
or database cannot provide current readiness; it does not invent work.

Both Rust processes expose:

| Request | Healthy response | Dependency failure |
|---|---|---|
| `GET /health/live` | 200, `status: "live"`, `schema_version: null` | Remains live while the process can serve |
| `GET /health/ready` | 200, `status: "ready"`, `schema_version: 2` | 503, `status: "unavailable"`, `schema_version: null` |

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
# Keep pnpm fixture:start running in another shell first; see HTTPS setup below.
. fixtures/oidc/.local/env.sh
pnpm fixture:test
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
`pnpm build` builds the Pair web interface. See [REUSE.md](REUSE.md) for selected
Pair asset provenance and licences.

The [owned browser regression](web/tests/browser/README.md) starts its own API,
Vite server and database proxy. It proves visible Ready → Unavailable → Ready
through actual socket loss and recovery, keyboard refresh focus and a narrow
viewport. Install its browser with `pnpm --filter @zobba/web exec playwright
install chromium`, or select an existing local Chromium with
`ZOBBA_BROWSER_EXECUTABLE`. The health harness never migrates or mutates database
content. The authentication harness uses explicit migrations/seeding and the same guarded disposable test
database for synthetic expiry/revocation fixtures.

The separate [Zobba foundation workflow](../.github/workflows/zobba.yml) runs these
gates with disposable PostgreSQL 18.4 and the workspace's own lockfiles/cache.
Its distinct workflow name keeps it outside the historical deployment trigger.
This story creates no deployment or customer launch configuration.
