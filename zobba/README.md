# Zobba foundation

This independent workspace builds the Rust API, worker, explicit migration CLI
and Pair web interface through Story 20.6. Real OIDC sign-in creates opaque Rust
server sessions; current membership limits engagement selection to explicitly
assigned work. Durable Task commands and an inert worker survive process restarts
without inventing execution outcomes. Health reports the actual database state.
The engagement conversation retains attributed messages, factual Task cards and
plain working briefs. Standing Permissions now qualify exact recorded operations
through an owned local gateway. Live model/tool execution, audit conclusions, real computers and
customer SSO qualification remain later capabilities.

## Organisation administration

Open **Organisation administration** from the engagement chooser. A current Admin
selects an organisation explicitly, edits a member's three application roles and
engagement assignments, and uses ordinary **Save membership**. Administration shows
only the membership and assignment metadata needed for this work. Admin alone
never opens an engagement, reads audit content or grants sign-off; an assigned
Auditor or Audit manager role remains separately required.

Invitations are private copyable links, with no email sender or delivery claim.
The browser generates a random 32-byte secret and places it in the link fragment;
opening the link removes that fragment from browser history immediately. The
secret travels to the owned API only in a POST body, and only its digest is
persisted. Keep the original private link until acceptance is confirmed.

The recipient sees the verified organisation, fixed roles, named assignments and
expiry before explicitly accepting while signed in. Preview and acceptance require a
signed, verified email claim from the configured issuer, bound to the exact
current server session by an OIDC callback within five minutes. Email local-part
case is preserved; ASCII domain case is normalized. This verifies fresh claims,
not forced provider password or MFA reauthentication. Missing or unverified email,
or a well-typed string that is not a supported email address, still permits ordinary
sign-in without invitation proof. Malformed claim JSON types, such as `email: 123`
or `email_verified: "true"`, fail sign-in through the pinned OIDC decoder; there is
no alternate parser or signature-verification bypass. If fresh sign-in is needed,
reopen the original private link afterwards.

Invitations fix roles and assignments, expire after five minutes to seven days,
and refuse a wrong recipient or issuer, a departed/demoted inviter, revocation,
expiry or an already-existing organisation member. Saves and invitation actions
carry an organisation version and immutable request key. An exact retry returns
the original attributable receipt; a changed payload or stale version conflicts.
Keep an uncertain command in the current page and use its explicit retry action.
A temporary access-check failure hides its private recovery state until the same
actor and exact session are verified again. Replacing the session, even for the
same person, discards old drafts, private links and pending recovery state.
An accepted receipt is historical: replay never restores subsequently removed
membership or assignments.

Membership changes use schema 5's narrow, inventoried SQL functions through the
non-owner runtime pool. Forced audit RLS remains enabled. Writes lock organisation
205 before sorted engagements, recheck current Admin/session authority, preserve
the last active non-expiring Admin, and retain immutable attribution. Narrowing advances
affected Task execution epochs, abandons unused claims and revokes affected
delegation. Consumed effects and late factual receipts remain available for
reconciliation. Regrant does not revive old execution, and unrelated organisations
remain usable through the same identity session. There are no computer or
connector revocation hooks yet.

Membership routes live under `/membership/organisations`,
`/membership/invitations/preview` and `/membership/invitations/accept`; the generated OpenAPI document describes their
exact bodies. Lists use bounded pages of 50, and replacement commands and new
invitations contain at most 100 assignments. Existing members with more assignments
remain administrable: inspect their named assignments and expiry on separate pages,
preserve the full set while changing membership, or explicitly remove selected
assignments. Replacement is refused until the existing set fits the command bound;
off-page assignments are never silently dropped. An opened editor retains its
assignment editing mode even if expiry changes the current assignment count.
Ordinary Saves preserve retained assignment expiry, including expiry that passes
while editing. Newly selected assignments carry an explicit per-scope renewal
intent; retaining a selection never renews it implicitly. To regrant an expired
scope, reopen the editor and deliberately select that omitted assignment.
Explicit renewal of an existing finite assignment fences that scope's old
execution even if its deadline is still future and therefore remains unchanged.
Extending or clearing a finite membership expiry likewise fences the member's
old execution across that organisation. This prevents expiry during the Save
from restoring an old execution basis. Unchanged expiry and retained selections
preserve unaffected work. Member
expiry can be extended or cleared explicitly, and the
workspace distinguishes expired access from an active Boolean flag.
All administration uses ordinary bounded capacity, leaving
the reserved Guide/Pause/Stop lane independent. Migrate explicitly with the normal
CLI; API and worker startup still only validate the exact schema and privileges.
Schema 5 requires stored membership and assignment expiries to be null or Unix
seconds in `1..=253402300799`. An exceptional older row outside that business range
refuses the upgrade with `membership_expiry_out_of_range`; the transaction preserves
its old schema and data. An operator must deliberately correct the invalid expiry
before retrying. Migration never silently clears or clamps an existing expiry.

Schema 7 requires **every organisation to retain an active Admin membership with
no expiry, linked to an active application identity**. Additional temporary Admins
remain eligible to administer while their membership is active and unexpired.
Pending invitations, inactive identities/memberships and finite expiries do not
satisfy continuity. Ordinary Save refuses an unsafe change with `last_admin`:
establish another active non-expiring Admin first. Refusal rolls back membership,
version, receipt and revocation changes together; no extra approval step is added.
Owner SQL identifies the affected organisation in the error detail. HTTP exposes
only the stable public `last_admin` code, also in `X-Zobba-Error-Code`, so the
replacement guidance does not depend on error-body delivery.

Before upgrading schema 6, run this read-only preflight through the authorised
migration owner connection (ordinary runtime cannot enumerate this authority):

```sql
SELECT o.id AS organisation_requiring_explicit_remediation
FROM public.organisations o
WHERE NOT EXISTS (
  SELECT 1 FROM public.organisation_memberships m
  JOIN public.identities i ON i.id = m.actor_id
  WHERE m.organisation_id = o.id AND m.active AND i.active
    AND m.expires_at IS NULL AND 'admin' = ANY(m.roles)
)
ORDER BY o.id;
```

Any rows require explicit, authorised remediation before retrying migration. Use
an existing eligible Admin's ordinary Save to establish the permanent replacement
where possible. If no eligible Admin remains, a separately authorised operator
must establish the correct identity/membership through owner SQL; this document
does not grant recovery authority. The migration reports `admin_continuity_required`
and leaves schema, migration ledger and authority unchanged. It never promotes or
reactivates anyone, removes an expiry, or assumes the synthetic development database
may be reset. The migration freezes authority-table writes before its preflight;
a concurrent schema-6 narrowing is checked after that write commits.

Database triggers cover owner membership edits/removal, identity lifecycle changes,
organisation provisioning and concurrent transactions. Create an organisation and
its first qualifying Admin in one **READ COMMITTED** transaction; deferred checks
also allow explicit replacement in one transaction. In a real (non-fixture)
environment use the reviewed operator command, with `ZOBBA_MIGRATION_DATABASE_URL`
set to the database owner:

```sh
zobba-cli provision-organisation --organisation-id <id> --organisation-name <name> \
  --issuer <exact ZOBBA_OIDC_ISSUER> --subject <OIDC sub> --display-name <name>
```

It requires the exact current schema, reuses an existing identity for that
issuer/subject (otherwise creates `oidc-<base64url SHA-256>`), and inserts the
organisation plus an active, non-expiring `admin` membership, retrying the whole
transaction on deadlock/serialization/lock timeout. An exact retry prints
`already_provisioned` and exits 0; any differing organisation, membership or an
inactive identity refuses (`organisation_conflict`, `identity_inactive`, ...)
without changing anything. It never promotes, reactivates or clears an expiry,
and prints only fixed codes and IDs. The deployed run is in
`deploy/RUNBOOK.md` (after "Then create the first administrator user"). The CLI sets migration
isolation to READ COMMITTED. Direct continuity mutations or direct migration 7
under REPEATABLE READ/SERIALIZABLE refuse with SQLSTATE `0A000`; restart the whole
transaction at READ COMMITTED. Authority-table TRUNCATE is refused, including
TRUNCATE CASCADE. There is no audit-history cascade deletion.

Identity deactivation/deletion remains an owner-only lifecycle operation; runtime
has no such privilege and there is no identity-administration product route.
An identity required by any organisation cannot be deactivated; multi-organisation
changes refuse atomically. Referenced identities remain protected by existing
NO ACTION foreign keys, preserving receipts and historical attribution. A harmless
unreferenced identity can still be removed. External IdP account availability is
outside this invariant, and no emergency recovery exception is introduced.

Application operations lock organisation advisory key 205 before engagement and
identity locks. Direct owner identity writes can acquire the identity row first
and invert that order; PostgreSQL safely aborts a deadlock victim (`40P01`) or a
bounded lock wait (`55P03`). Roll back and retry the complete transaction, then
recheck authority. For planned owner lifecycle work, lock the affected organisation
advisory keys in sorted organisation order before changing identity rows; concurrent
new membership can still require a safe retry. A retry is never permission to
ignore `last_admin` or a foreign-key refusal.

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
engagement reads and engagement-name updates protected by forced RLS. Task grants
separately bound scoped state, content-free wakeup routing and exact-attempt
receipt observations. Runtime cannot change identity activation, roles or
assignments. Schema changes never run at startup.

Admission and live readiness conservatively traverse membership edges with any
INHERIT, SET or ADMIN option, including mixed paths and ADMIN self-regrant. Unsafe
role attributes, dangerous predefined roles and table MAINTAIN grants are refused,
including MAINTAIN on otherwise runtime-writable tables. Harmless `pg_monitor`
membership remains supported. This closure can also refuse membership combinations
that a single session cannot immediately use; use separate monitoring identities
for those ambiguous graphs.

Exact schema inventory also refuses public collations, operators, operator
classes/families, conversions, text-search objects, extended statistics and all
database event triggers, even when the accepted schema tables otherwise match.
Migration preflight and runtime validation share these checks.

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
the same valid schema. It accepts empty databases, exactly verified published
schema 1–11 prefixes, or current schema 12. Physical catalog checks precede metadata
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

`fixture:setup` invokes `pnpm --filter @zobba/oidc-fixture run setup`.
Keep the explicit `run`: `pnpm ... setup` invokes pnpm's own shell setup command
and does not generate the fixture. Repeating fixture setup preserves its keys and
credentials. For an isolated verification directory, including the CI command path:

```sh
fixture_check_root=$(mktemp -d)
export ZOBBA_FIXTURE_DIR="$fixture_check_root/oidc"
pnpm --filter @zobba/oidc-fixture run setup
pnpm fixture:setup
. "$ZOBBA_FIXTURE_DIR/env.sh"
pnpm fixture:test
```

Use a new child path beneath the temporary directory; setup refuses an existing
empty or incomplete fixture directory. With `ZOBBA_FIXTURE_DIR` set, source that
directory's `env.sh` instead of the default path. Keep its generated credentials
private and stop its owned processes before removing it.

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
references independently enforce scope. The browser captures `/auth/session` first
and sends its in-memory CSRF value as `X-Expected-Session` on composed protected
GETs. This optional refusal precondition never chooses the server identity:
the cookie remains authoritative. A mismatch returns HTTP 412 `session_changed`
without setting or expiring cookies. One automatic retry budget spans engagement
composition and conversation reads; a usable verified projection or an explicit
user retry restores that budget. Repeated replacement withdraws the workspace
until the user retries. Generic
401 replies also leave cookies unchanged so a delayed reply cannot delete a newer
sign-in; explicit logout still expires the session cookie.
Auth requests have a 15-second overall
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

## Standing Permissions and recorded operations

Story 20.5 supplies pure policy, versioned authority, exact decisions and a Rust
operation gateway qualified against a real owned local HTTP endpoint. The inert
worker still creates no business proposals. Live connectors, customer accounts,
real computer actions and the full Needs you interface remain later capabilities.
The production library ports are callable by future trusted proposal adapters;
the fault endpoint and crash controls exist only in test executables.

Each immutable operation binds one purpose (Live inspection, Test workflows or
Audit coordination), actual account and environment, logical destination,
recipients, complete reviewed material and its SHA-256, attachment identities and
digests, resource/version and expiry. Inputs are strict and bounded; canonical
bytes use versioned length framing. Logical destination IDs never select a URL.
Live inspection requires a verified read restriction surviving takeover; test
writes require a verified test environment, exact resources and cleanup; audit
coordination is limited to audit resources. Prompts and tool metadata grant nothing.
Attachment ID, SHA-256 and classification must also match immutable trusted source
metadata in PostgreSQL. Runtime access to this registry is SELECT-only; this story
has no document ingestion or metadata registration product. Owned qualification
fixtures register synthetic material through a guarded owner connection. The
source independently checks its actual attachment bytes/classification and exact
resource version atomically with applying an effect, including request expiry.

Current organisation, engagement, member, account and Task limits intersect with
the explicitly accepted immutable Task snapshot and every delegated ancestor.
Current narrowing takes effect at consumption; broader policy requires a new
attributed Task-authority acceptance. Ordinary Task policy revisions retain that
accepted upper bound; a delegation revision requires authority over both its old
root and proposed lineage. Organisation/member/account policies are
shared across an organisation, while engagement/Task/delegation records retain
composite scope. Admin policy configuration still requires current audit access;
Admin alone receives no client data. Policy changes and consumption take the same
organisation advisory lock before the engagement row lock used by Task controls.
The future Story 20.6 membership writer must use these fences too; arbitrary
privileged owner SQL is not an application-authorized mutation contract.

Operation admission uses an explicit durable logical-operation key independent of
owner, attempt and dispatch claim. Identical retries recover the same operation;
changed material or producing Task/cycle/intent/execution meaning conflicts. Each
attempt has an independent one-use claim. Consumption commits before any network
I/O and is the possible-dispatch cutoff. Pause, Stop, guidance or revoked policy
refuses a fresh consumption. Already consumed attempts retain uncertainty; an
inert child receipt cannot confirm cessation while external attempts are unresolved.
Only a current authorized Task coordinator incorporates late facts into Task state.
Admission and consumption validate the exact persisted producing Task claim and
process, including unincorporated terminal receipts. After deferred writes finish,
consumption rechecks the current owner lease and policy/request/decision expiry;
any expiry rolls the transaction back.

The owned gateway uses an explicitly supplied numeric loopback endpoint, no proxy
or redirects, two-second database/source deadlines and a 4 KiB response bound.
Trusted account configuration pins source ID, durable ledger incarnation, endpoint
digest and protocol version in each operation and attempt. Another endpoint or an
empty replacement ledger cannot establish absence for the recorded source.
Recovery queries the source before any new attempt. The test source binds operation
ID plus fingerprint, deduplicates effects and atomically fences absent attempt IDs,
including a delayed old sender. Unknown and asynchronous acceptance remain
unresolved. A new attempt needs source-confirmed absence and fresh Task authority;
this is a qualified local source contract, not a remote exactly-once promise.

Exact receipt capabilities are stored only as digests and convey immutable facts,
including after producer revocation. Stored producer custody distinguishes dispatch
from reconciliation; changing a caller field cannot grant absence authority.
Recovery custody cannot dispatch or read another attempt. Normal polling reuses
in-memory custody and freshly reauthorizes every lookup. The cache retains up to
1,000 entries without evicting unresolved attempts; terminal entries may be replaced.
At most 32 producers
per attempt, 64 attempts and 64 decisions per operation, 1,000 operations per Task,
eight exact rules per policy layer, and 50 records per cursor page bound the
qualification seam. Unresolved attempts and each history collection have cursors.
Repeated process crashes can exhaust the 32 receipt producers for one attempt;
that limit refuses further recovery custody without permitting a new send.

All operation HTTP paths use the existing eight-request ordinary lane and pool;
Guide/Pause/Stop retain their separate capacity. Under
`/engagements/{engagement_id}` with explicit `organisation_id` and `client_id`:

| Path | Contract |
|---|---|
| `GET /operations?task_id=<id>&after_operation_id=<optional id>` | Freshly scoped bounded operation page |
| `GET /operations/{operation_id}` | Exact operation and factual outcome |
| `GET /operations/{operation_id}/history` | Persisted decider/expiry/key, attempts and source observations; independent optional `after_decision_id`, `after_attempt_id`, `after_observation_id` cursors |
| `POST /operations/{operation_id}/decisions` | Exact current request/revision/expiry and allow/refuse |
| `POST /permissions/{authority_id}/revoke` | Exact policy kind/subject/version and durable key |

Only the accountable Task actor or a currently assigned Audit manager may decide
an exact permission request, including retries. Peer Auditor guidance authority
does not grant permission-decision authority; Admin alone remains insufficient.
Mutation requests require the configured Origin, current session CSRF and
`X-Expected-Actor`; read requests support `X-Expected-Session`. Decimal revisions
and expiry values use strings. Projections exclude capability secrets, producer
custody, internal policy snapshots and raw connection handles. History retains safe
source/ledger identities, not endpoint digests or execution bindings. Cursor pages
walk bounded immutable history; restart at the first page to discover new concurrent
records, since these cursors are not a change feed. These contracts
provide the decision seam for Story 25.2; no new browser decision UI is claimed.

Run the focused qualification suites serially against the same guarded disposable
PostgreSQL database, with the fixture environment sourced for HTTP configuration:

```sh
cargo test --locked -p zobba-infrastructure --test operations -- --test-threads=1
cargo test --locked -p zobba-api --test operations_http -- --test-threads=1
cargo test --locked -p zobba-worker --test gateway_process -- --test-threads=1
```

The process harness executes the real repository and gateway in child processes
against PostgreSQL and an owned HTTP source. It crashes after consumption and after
effect/before receipt, loses acknowledgements, delays old senders, tests pending
and unknown results, and proves ordinary database connections are released across
remote I/O. It does not bind IdP port 9444 or contact a live connector.

## Durable Tasks and the inert worker

Create, Guide, Pause, Resume, Stop and Continue are explicit commands scoped to
one organisation/client/engagement and exact Task/work cycle. The authenticated
session supplies the accountable author. Repeating the same idempotency key and
meaning returns the original immutable **Received** receipt after current access
is checked again; changing the meaning conflicts. **Applied** is a separate durable
fact. Admission commits the command, receipt, state, event and wakeup together.
Engagement event cursors are strings and follow transaction commit order. The
coordinator persists an application cursor and reads only the next indexed command
batch; retained applied history is never rescanned under the engagement lock.
Open-task admission uses a scoped partial index that excludes stopped history.

Guidance advances intent at admission and applies to the working brief at a work
boundary. Worker ownership, execution epoch, intent revision and Task revision
are separate fences. A still-valid owner cannot use an old-intent proposal or
unconsumed claim. Guidance received while paused or stopped does not resume work.
Resume retains the paused cycle; Continue after Stop creates a new cycle. Controls
for an old cycle cannot affect its continuation. Guide/Pause/Stop authentication and
admission reserve two database connections independently of ordinary requests.

Task API paths share `/engagements/{engagement_id}` and require the explicit
`organisation_id` and `client_id` query parameters plus a current server session:

| Path beneath the engagement | Operation |
|---|---|
| `POST /task-commands` | Create, Resume or Continue |
| `POST /task-controls` | Guide, Pause or Stop through reserved capacity |
| `GET /tasks?after_task_id=<optional Task ID>` | Page scoped Tasks in ID order |
| `GET /tasks/{task_id}` | Read one exact scoped Task |
| `GET /task-events?after=<decimal>` | Read bounded durable events after a cursor |

Task pages return up to 100 `tasks` and a `next_cursor`; null means exhausted.
Use the exclusive cursor as `after_task_id` to reach retained stopped Tasks beyond
the active-work limit. Known Task IDs open independently of the current page.
Each engagement admits at most 100 open Tasks. Stopped Tasks remain retained;
Continue must acquire capacity again before opening a new cycle.

POST requests require the exact configured Origin and `X-CSRF-Token` from
`/auth/session`. JSON has `key`, `kind` and, where applicable, `task_id`, `cycle_id`
and `content`. Create requires content and no target; Guide requires content and
an exact Task/cycle; other commands require the exact target and no content.
Keys are 1–128 ASCII letters, digits, underscores or hyphens, content is at most
4,000 UTF-8 bytes, and the complete JSON body is at most 32 KiB. Accepted requests
return HTTP 202 with `command_id`, `task_id`, `cycle_id`, `event_cursor` and
`status: "received"`. At most eight ordinary and four control requests are
admitted concurrently, with a six-second deadline per Task request. Capacity
refusal is retryable; it is not a receipt.

The worker runs only bounded inert child processes. It polls durable wakeups every
200 ms, runs at most four children, and holds no database connection while a child
runs or waits. `ZOBBA_INERT_DURATION_MS` sets the synthetic activity duration
(default 500 ms, range 10–30,000 ms); cancellation is requested after 31 seconds.
Each database port call has a two-second client deadline, startup connection has
seven seconds, and cancellation join has two seconds. An unconfirmed join remains
uncertain. Authority polling runs concurrently with the exact child join and
shutdown signals. The supervisor withdraws readiness if coordination exits and
bounds graceful shutdown to 20 seconds. Fixed operational error codes are limited
to one message per code per five seconds, with counters for suppressed repeats.
The child receives no inherited environment or connected standard streams.
An observed inert result leaves the Task waiting with a confirmed observation;
it does not complete an audit objective or establish model, tool or computer work.

Pause/Stop receipt and observed cessation are different facts. The coordinator
cancels and joins its exact child before reporting a termination observation.
A timeout, lease expiry or cancellation request alone never proves cessation.
Consuming an activity claim is the possible-dispatch cutoff: an abrupt crash after
consumption leaves reconciliation required, and replacement ownership cannot replay
that activity. Other Tasks and control admission continue to operate.

A stale or revoked producer can submit only a bounded immutable observation for
its exact consumed attempt using a private receipt capability. Only the digest is
stored. That context grants no Task read, new execution or transition; contradictory
reuse conflicts. A currently authorized coordinator may incorporate the fact later.
There is no public late-receipt endpoint. Dispatcher discovery returns bounded
content-free routing metadata and rechecks execution authority in a fresh scoped
transaction; browser-session expiry alone does not revoke background membership.
Delivery leases live in `task_deliveries`: dispatcher context cannot mutate the
coordinator-owned wakeup scheduling fields, even with direct runtime SQL. Execution
meanings live in domain and coordination/receipt ports in application; SQL and
process adapters implement those inward contracts.

The worker retries an identical joined observation at most five times with 500 ms
backoff. A prolonged database outage can exhaust retries and lose the local fact;
the consumed attempt remains uncertain, never silently replayed. Process fault
wrappers exist only in integration-test executables, with no production fault or
authentication bypass. The normally ignored process-helper entry is explicitly
executed by the reliability scenario as a child process.

## Engagement conversation and recoverable input

The browser uses one conversation per exact organisation/client/engagement tuple.
Its audience is the engagement's current assigned members. Message authors remain
attributed after role changes, and the Task's accountable human has a separate
label. Reads project the authoritative command rows and immutable Received/Applied
facts; there is no second message-admission engine or new migration in Story20.4.
The accepted migration bytes and schema3 catalog contracts remain unchanged.

| Path beneath `/engagements/{engagement_id}` | Bounded read contract |
|---|---|
| `GET /conversation` | One consistent snapshot: exact scope/audience, watermark, latest100 messages, first100 current Tasks and pagination cursors |
| `GET /conversation/history?through=<watermark>&before=<cursor>` | Previous100 messages, ascending within each page; Applied facts are restricted to the fixed watermark |
| `GET /conversation/events?after=<cursor>` | Up to100 ordered invalidation facts, unchanged input cursor on an empty/resync response, `has_more` and `resync_required` |

All routes also require `organisation_id` and `client_id`. The snapshot and its
watermark come from one PostgreSQL statement snapshot; it holds no writer lock and
never waits for a viewer. History optionally filters by exact `task_id`. A future
cursor, gap or backlog over1,000 events explicitly requires a new snapshot. Never
advance an event cursor over omitted rows. Cursors remain decimal strings through
SQL, JSON and browser validation, including values above JavaScript's safe integer
range. The current Task projection is separate from the latest history page.

The browser polls finite pages every two seconds with eight-second request
limits and no overlapping poll loop. An event invalidates the snapshot; a bounded
fresh snapshot replaces the live page. Historical pages retain their fixed
watermark, and later Task pages refresh from their current page cursor. Each
rendered page holds at most100 messages and100 Tasks; opening a known Task reads
its exact ID independently. Earlier messages and Latest messages expose bounded
history navigation. A failed or malformed read withdraws server projections and
shows reconnecting state. JSON reads cap the decompressed body at4MiB.

The composer explicitly chooses New Task or Guide plus an exact Task/cycle.
Opening, pinning or following inspection never retargets input. Local draft edits
are separate from saved requests. Before transmission, the browser stores exact
actor, composite scope, key, kind, target/cycle and content in IndexedDB; a
storage failure refuses sending. No session or CSRF token is stored. Reloading
reads only that actor/scope's outbox and never automatically replays a request.
An exact durable echo reconciles by author, key and full meaning. Otherwise
Check original request resends the same immutable request to recover its receipt.
A409 refusal can be dismissed; an uncertain request cannot be silently discarded.

Recovery storage uses one IndexedDB authority. A strict-durability transaction
atomically checks immutable meaning and quotas, then commits before transmission.
It allows eight pending requests per actor/scope, with two places reserved for
Pause/Stop; across the origin it allows 64, with four places reserved for Pause/Stop.
Reads use a bounded actor/scope index; other binding payloads never enter the current
view. Same-binding notifications trigger reads without replay. Failed notification
cannot undo a durable handoff. Unavailable storage or a failed commit prevents
transmission, and uncertain requests have no silent expiry. Controller disposal
closes its connection after existing transactions finish.

The earlier, unshipped local-storage preview is not a second recovery authority.
Its bytes are preserved; an own-binding pending preview record prevents new sends
until recovered. Detection scans at most 2,048 key names without reading other
bindings' payloads. Synthetic fixture resets belong to the development harness.

Every browser mutation sends `X-Expected-Actor` with the App-verified actor and
session-bound CSRF. The header is a refusal fence, never an author or grant of
authority; server sessions still derive the author. Initial commands use the
current in-memory verified Session. Guide/Pause/Stop, including retries, freshly
check session, actor, CSRF and current membership in the reserved admission lane
before idempotency lookup. They do not wait on ordinary access GETs. Other retries
first revalidate session and the exact engagement. A changed actor, stale session
or revoked scope withdraws the view and never substitutes another actor's session
into the saved operation.

Same-scope access revalidation hides the protected surface while keeping its
nodes, independent draft, selection and focus mounted. Success restores that
view; failure, logout or actor/scope change withdraws it. Abort controllers and
access/read generations prevent older callbacks from restoring withdrawn work.
Same-account session rotation retains the mounted workspace only after fresh
session-bound reads verify the same actor and scope. A different account starts
its own workspace even when both accounts can open the same engagement.
Sign-out intent remains independent of automatic focus/visibility/timer refresh.

Received never means Applied. Applied means retained direction reached a working
boundary; it asserts no model understanding. Waiting does not mean the audit
objective completed. Pausing/Stopping remain pending until cessation is confirmed;
reconciliation required remains unresolved. Resume uses the same cycle and Continue
creates a new one. Work products remain honestly empty in this foundation.

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
| `GET /health/ready` | 200, `status: "ready"`, `schema_version: 11` | 503, `status: "unavailable"`, `schema_version: null` |

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
cargo test --locked -p zobba-infrastructure --example model_qualification
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

The [Task PostgreSQL contract](crates/infrastructure/tests/task.rs) runs concurrent
identical and changed commands, competing owners, same-owner guidance races,
consumed uncertainty, late receipts after revocation, one-connection context reset,
and pagination beyond 100 retained Tasks. Its test-admin-only deferred trigger
holds an actual admission at commit, proving no premature receipt or cursor, then
forces rollback or releases competing commits in order. The fixture is created
and removed only inside the guarded disposable database. The worker's process
suite separately joins actual inert children and exercises restart and Stop.

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
twice, and checks exact API/worker liveness and readiness. The bootstrap contract
also replays the exact published v1 and v2 migration bytes and ledger checksums,
proves both prefixes upgrade without rewriting historical ledger rows, and rejects
altered prefix catalogs or checksums without mutation. It then cuts only its
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
These foundation stories create no deployment or customer launch configuration.

## Qualification environment as code (Story 20.7a)

`deploy/` holds the qualification environment as code: one container image
(`deploy/Containerfile`), pinned Terraform for an isolated two-zone AWS
environment (`deploy/qualification/`) and a manual, approval-gated release
workflow. Operators follow [`deploy/RUNBOOK.md`](deploy/RUNBOOK.md). It is
verified offline only: Terraform tests use a mocked AWS provider, plus policy
scans, workflow lint and an image build/smoke in the `qualification-infrastructure`
CI job. **No live deployment exists or is qualified;** the live apply, restore
and reconciliation proof is Story 20.7b.


## Immutable scoped evidence (Story 21.1)

Schema 6 adds immutable owner-scoped reservations and registered originals.
Migrations 1–5 and their catalogues retain their published bytes. Runtime grants
permit scoped inserts and reads, never original update or deletion. The exact
session is checked after organisation and engagement locks; a narrow inventoried
owner function locks that session against logout without granting session UPDATE.
No database transaction or authority lock spans storage I/O.

An auditor reserves one immutable original with an actor/scope-bound retry key,
SHA-256, byte count, filename and source assertions. The server assigns its opaque
identity, records reservation time, and conditionally writes its owned object key.
It independently reads the returned non-null storage version before registering
measured identity and the verified acquisition time. Reservation time is distinct
from acquisition completion: a recovered reservation may be older. Replaying the
same reservation or registration returns the exact original result; changed
meaning conflicts. An uncertain conditional create probes the latest version and,
only when the key is absent in an available bucket, permits one more conditional
create. Incomplete material is quarantined and excluded from registered evidence.

Acquisition is always **direct upload**. Entered source system, account, source
version, selection and coverage are attributed assertions; omitted values are
unknown. The verified storage version is separate from the asserted source version.
Matching hashes prove byte identity, not truth, completeness or audit sufficiency.
Evidence remains separate from work products and executable instructions.

Set `ZOBBA_EVIDENCE_BUCKET` to enable production S3 composition. Standard AWS
configuration supplies region, endpoint, credentials and trusted CA/proxy settings.
Missing or invalid configuration leaves evidence storage explicitly unavailable
and the conversation/Tasks usable. Configuration presence alone does not establish
bucket readiness. The builder requires signed HTTPS, validates certificates and
keeps configured trusted CAs/proxies. Bucket versioning is required: absent or
literal `null` version IDs are refused. Namespace fingerprints retain the raw
effective endpoint setting (including absence and trailing slash), bucket, region,
addressing mode and S3 Express configuration. Omitted and explicit endpoints are
distinct because the SDK can address them differently. Changing these cannot
silently retarget registered originals. Restoring the matching configuration is required to
read an older namespace. No live connector or paid service is configured by tests.

S3 permissions are limited to `s3:PutObject` on owned `evidence/` keys,
`s3:GetObject`/`s3:GetObjectVersion` for metadata and pinned reads, plus
`s3:ListBucket` conditioned to the `__health/sentinel/` readiness prefix. The
bounded list distinguishes a missing object from an unavailable bucket; it is not
atomic with a later write. Service-level IAM/KMS/versioning, SigV4 acceptance and a
real invalid-certificate TLS handshake require separate deployment qualification.
The local protocol fixture makes no claim to prove those service properties.

Every original is at most 10 MiB. Two shared API I/O slots are acquired fail-fast
before upload body collection and retained through verified reads and final
current-session/scope checks. Upload, preview and download have a total 120-second
budget; each full storage request, including its body, has 20 seconds and no hidden
SDK retries. Metadata retains 15 seconds. Guide/Pause/Stop keep separate capacity.
Reservation JSON is bounded to 32 KiB, each source assertion to 2,000 UTF-8 bytes,
and the filename to 255 bytes. Lists and owner-only incomplete recovery use
exclusive opaque cursors with at most 50 items per page, ordered by ASCII bytes
independently of database locale. Each actor/scope may hold at most 100 incomplete
reservations. Reaching that durable limit returns `409 evidence_reservation_limit`
without `Retry-After`: waiting does not free a slot. Complete an existing reserved
original to free one slot; exact reservation replay remains available at the limit.
This story has no abandonment, deletion or expiry lifecycle for incomplete custody.
If the matching original bytes cannot be recovered, that incomplete reservation
continues to occupy its slot. This differs from the temporary two-request I/O
limit, which returns `429 evidence_capacity` with `Retry-After: 1`.

Routes below `/engagements/{engagement_id}` require explicit `organisation_id`
and `client_id` and an authenticated current session. Mutations additionally
require Origin and CSRF. Optional `X-Expected-Session` and `X-Expected-Actor`
headers are refusal preconditions, not authority; the owned browser always
supplies them to bind reads and mutations to its verified audience:

| Route | Meaning |
| --- | --- |
| `POST /evidence-reservations` | Reserve or recover an identical reservation key |
| `GET /evidence-reservations` | Page the current owner's incomplete custody |
| `PUT /evidence-reservations/{reservation_id}/upload` | Conditional upload, verified read-back and registration |
| `GET /evidence` | Page registered originals and storage-configuration status |
| `GET /evidence/{evidence_id}` | Inspect current scoped provenance |
| `GET /evidence/{evidence_id}/preview` | Inert plain UTF-8 preview, at most 64 KiB / 100 lines |
| `GET /evidence/{evidence_id}/download` | Authenticated verified original bytes |

Unsupported binaries and markup are download-only. Responses preserve no-store,
no-referrer and nosniff; downloads use a sanitized attachment filename. There are
no presigned/public URLs. The browser verifies its exact audience after completed
reads and before creating or activating a Blob download; changed account, session
or scope withdraws previous private state. Reload recovery requires explicit
reselection of the identical file and uses the existing reservation. An in-memory
or browser draft never authorizes a retry for a replacement session. Current
same-owner recovery remains explicit and does not delete durable custody.

`crates/infrastructure/tests/evidence_s3.rs` uses actual `object_store` S3 HTTP
requests against an owned numeric-loopback protocol fixture. API HTTP tests combine
that fixture with guarded disposable PostgreSQL. Browser tests use the test-only
`evidence_fixture` Cargo target and Node protocol fixture; the ordinary production
binary has no insecure-transport environment switch. Fixture credentials are
synthetic, redirects and proxies are disabled only in that test connector, and
fixture listeners and processes are cleaned up on failure/teardown. Browser
checks require the explicit `ZOBBA_TEST_ADMIN_DATABASE_URL` for that same guarded
throwaway database. New evidence authority mutations use bounded asynchronous
admin SQL so the Node database proxy can continue forwarding API transactions. The full
verification commands above cover these targets, schema 5→6 and browser continuity.

## Find registered sources without losing provenance (Story 21.6)

The current engagement's Evidence library searches registered filenames and the
five attributed source fields. `GET /evidence?q=...&after=...` compares literal
substrings after mapping each Unicode scalar to lowercase independently. It does
not normalize text or apply full Unicode case folding, and never searches document
contents or interprets their meaning. Queries permit at most 200 UTF-8 bytes after Rust
Unicode whitespace trimming and reject control characters before trimming.
Accepted original metadata, including format characters such as U+FEFF, remains
unchanged. Incomplete reservations retain their separate owner-only recovery path.

Each request fetches at most 257 current-scope candidates in byte/C order, using
one only as lookahead, examines at most 256 and returns at most 50 matches.
`query` echoes the canonical query. `coverage` records `examined_count`,
`candidate_limit: 256` and `complete`. The exclusive `next_cursor` is the last
examined candidate, which may not match. It is null exactly when this read reaches
the end of the remaining stream. Reaching 50 results stops consumption before any
later eligible match; reaching 256 candidates keeps continuation even on an empty
page. Reset the cursor when changing a query. Neither a complete scan nor a
partial/empty page establishes business completeness or absence of relevant work.

Results show exact original and storage version, composite scope, acquisition
actor/time and registration standing, alongside explicitly attributed source
assertions. Inspection distinguishes those facts from a bounded inert preview and
a verified original download. Task knowledge can open its exact scope/ID/version/
SHA-256 source in the same library without replacing conversation ownership or
searching another engagement. Source access remains independently current; loss
of a supporting source withdraws its projection while the separately authorized
destination remains recoverable. Downloads verify the pinned original's size and
digest before creating a short-lived Blob URL. Closing an inspector returns focus
to a visible opener or a permitted fallback.

Relevant checks from `zobba/` are `cargo test -p zobba-domain --lib evidence::`,
`cargo test -p zobba-application --lib evidence::`,
`cargo test -p zobba-api --test evidence_contract`, and the existing PostgreSQL
`evidence`, `evidence_http` and object-store `evidence_s3` targets. Run guarded
database targets serially. Web checks include `node --test web/tests/evidence.test.mjs`
and `pnpm --filter @zobba/web exec playwright test evidence-search.spec.ts` plus
existing evidence and knowledge regression suites. The search journey exercises
dense and sparse continuation, held-response replacement, actual revocation,
390px keyboard return, exact downloaded bytes and knowledge-to-library navigation.
Actual execution results and inspected safe screenshots are recorded in the
story delivery evidence; command availability alone is not a verification claim.

## Firm methodology and Task bindings (Story 21.2)

Schema 8 adds immutable methodology versions, scoped assignments, source attribution,
Save/recall receipts, impact records and Task binding history. The published
migration and catalogue prefix 1–7 remains unchanged. Settings → Methodology and
skills uses ordinary Admin Save, with no second approver. Admin configuration
access does not grant access to client audit work or audit sign-off.

A Save binds its complete meaning to the organisation, current actor and retry
key, and checks the expected organisation configuration revision. The same command
returns the same committed receipt even after a later Save; changed meaning under
that key conflicts. Invalid or stale Saves roll back all state. A successor names
the version it replaces. Undo copies a selected prior definition into a new
attributed successor; it never edits historical versions. Source interpretations
remain entered proposals until the explicit Save.

Assignments select firm, client or engagement scope and optional audit area and
business period. Availability is an independent UTC timestamp. Resolution uses
scope and applicability, preserves incomplete or overlapping applicability as an
explicit issue, and never selects a policy merely because it was saved most
recently. Only unconditional assignments provide default context; explicit Create
context wins. Requirements have stable IDs and mandatory standing. An omitted
field inherits; an explicitly empty optional field clears that field. Narrower
assignments retain inherited mandatory fields. The binding records exact versions,
per-field contributors, resolved criteria and exact template content/version.
Missing criteria or templates produce a labelled incomplete/neutral basis for
future dependent conclusions; they do not prevent conversation or inert work.
There is no audit evaluation or model invocation in this story.

Create accepts optional `context` with `audit_area`, `period_start` and
`period_end`; omitted context requires no picker. The Task and its binding commit
atomically, and context is part of exact retry meaning. Attributed Guide commands
may later replace the Task's explicit context; omission leaves context unchanged.
Context changes stage an inspectable binding change and wait for the same safe
boundary as active configuration changes. The resulting binding retains the exact
Guide command ID, even after later configuration changes. A resolved period remains
fixed when later firm defaults change. Each binding retains its immutable eligible candidate
pool separately from versions that actually supply requirements, so later area or
period corrections preserve originally available mandatory policies without
importing unrelated new-only Saves. Task inspection shows the current basis,
its reason, history, pending change and retained-work notices.

The default activation is new Tasks only: existing Tasks retain their bindings
and receive an attributable update notice. Applying to active Tasks stages a
change and fences unused claims and new operation dispatch. Consumed work retains
its original basis and exact receipt rights. The coordinator incorporates consumed
inert and external facts before switching the binding and execution epoch at a
safe boundary. It applies only explicit active changes, preserving unrelated
new-only changes outside that Task's binding. Pause and Stop remain in effect.
Scheduled changes include Tasks created between Save and availability and retain
durable wakeups until availability. Recall blocks affected
new use regardless of pinning without rewriting original bindings or outcomes.
Each binding records the first execution epoch it governs. Existing operation
and paginated attempt-history inspections expose their immutable producing epoch
and exact methodology binding ID; Task controls and later rebinding cannot change
that association. Migrated pre-methodology work resolves to its labelled neutral
epoch-zero binding, without implying that later criteria governed it.
Durable impact facts support later evaluation/review consumers; this story does
not implement their draft-recomputation or issuance workflows.

Protected routes require the current cookie session. Reads support the
`X-Expected-Session` refusal fence; mutations additionally require Origin, CSRF and
`X-Expected-Actor`. Exact session and current authority are checked after the
shared organisation/engagement lock waits. New configuration tables are owner-only
with forced RLS, accessed through narrow inventoried functions; the runtime gains
no direct table reads or writes.

| Route | Purpose |
| --- | --- |
| `GET /methodology/organisations/{organisation_id}` | Current Admin configuration and assignment metadata |
| `POST /methodology/organisations/{organisation_id}/save` | Validated immutable Save, successor or Undo |
| `POST /methodology/organisations/{organisation_id}/recall` | Attributable current-use restriction |
| `GET /engagements/{engagement_id}/tasks/{task_id}/methodology` | Current scoped audit reader's exact Task basis and history; query includes `organisation_id` and `client_id` |

Definitions are bounded to 100 requirements, 32 values per field, 32 templates and
32 sections per template. Labels use at most 200 Unicode scalar values; text and
template prose use at most 2,000. Template content retains exact whitespace and
supports multiline prose. Stable IDs use the existing bounded ASCII identifier
contract. The stored command envelope and cumulative configuration/history budgets
add durable capacity limits: 128 versions and 512 KiB of saved commands per
organisation, with a 1 MiB Task binding-history reservation and an explicit
capacity refusal above 512 engagement assignment options. Exact replay and
recall remain available at capacity. The
browser retains a frozen request for explicit retry and keeps private editor
state bound to its verified actor, organisation and exact session.

To prevent an accepted transition from failing later for space, each pending
binding reserves 4,096 bytes plus 16 times the organisation's aggregate saved
configuration bytes. This conservative admission reservation can refuse a Save or
context Guide before actual binding-history occupancy reaches 1 MiB. Refusal rolls
back the command and its effects; ordinary guidance without context, original
receipt recovery and recall remain available.

Run the workspace gates listed above. The methodology database contract covers
Admin/session isolation, atomic versions and retries, and concurrent Save/Create
orders. The operation contract includes real consumed-effect reconciliation,
new-only isolation, recall and durable scheduled activation; the browser contract
uses the actual API, PostgreSQL and OIDC fixtures for Save, Undo and inspection.

## Installed skills and technique selection (Story 21.3)

Schema 9 adds explicitly installed skill versions, immutable installation/status
receipts and scoped Task selection history. Published migrations and catalogue
snapshots 1–8 remain unchanged. Settings → Methodology and skills lets a current
Admin install a structured package, save an edited package under a new exact
version, enable/disable it, and recall faulty versions. Installation records its
actor, exact source/revision/license, purpose, inputs/outputs, applicability,
method compatibility, declared capabilities and SHA-256 manifest/resource digests.
Structural validation and an Admin installation are not independent content
certification. Script resources remain inert UTF-8 data; no resource is launched.
An acquired file named `SKILL.md`, a hostile document or an archive stays evidence
and never installs itself or grants source access.

Task discovery reads the immutable current methodology binding, its execution
basis and exact field/template source dependencies. It does not select today's
latest assignments. Optional techniques cannot erase mandatory methodology or
turn suitable-skill advice into obligatory invocation. Pure techniques may be
selected without an accepted operation authority when their exact applicability
is satisfied, including under an otherwise neutral or incomplete method.

Every declared capability is required. Permissions intersects whole correlated
rule regions across the Task's accepted and current hard bounds, including every
delegation ancestor and account/source restriction. The selector's policy never
substitutes for the Task's accepted actor. Hard denial is `forbidden`; missing
authority, unreadable state, unsupported tools and bounded-query exhaustion are
`unavailable`. Surviving possibilities are `compatible_needs_exact_details`:
the future exact operation must still pass current admission, any decision and
consumption. Empty standing coverage does not deny a capability.

The default API has no qualified operation or analysis adapter for skill use.
Pure techniques are selectable; required unqualified tools remain unavailable
even when their policy possibilities are compatible. The optional
`SkillsRepository::with_qualification_source` constructor is server-owned,
loopback-only synthetic qualification configuration. It requires the exact
source, ledger, endpoint digest and contract version; neither browser nor
manifest can supply qualification. This story invokes no model, analysis worker
or resource, and creates no operation, decision, claim or wakeup.

Selection records the actual selector, exact version/digest, reason, catalogue
revision, full methodology binding, current execution epoch and an opaque
dependency fingerprint. Discovery is advisory. Selection serializes fresh
checks with Admin restrictions, Permissions and methodology changes; stale
expected revisions refuse without mutation. Exact lost-response retry returns
the original receipt with freshly evaluated eligibility alongside it. Disable
blocks new selection/use; recall identifies affected selections and permanently
blocks that version. Historical selections and already-consumed receipts remain
inspectable. A changed Task basis requires explicit reselection. Selection never
resumes a paused or stopped Task.

`SkillsStore::current_use` independently rechecks current technique eligibility;
it performs no invocation and is not an operation permission. Future invocation
must pass this gate and the existing exact-operation gates. Catalogue/selection
transactions finish deferred writes before their final current-time session,
actor and methodology checks. Admin catalogue access grants no audit access.

Limits are explicit: 128 installed versions and 2 MiB stored installation
commands per organisation; 128 selections and 1 MiB retained selection receipts
per Task. A manifest permits 32 inputs, 32 outputs, 16 conjunctive needs, 32 exact
method versions and 16 resources. Each resource is at most 32 KiB of UTF-8; all
resources total at most 128 KiB and the canonical manifest at most 200,000 bytes.
Permissions projection retains at most 256 regions and performs at most 65,536
comparisons per need, with 1,048,576 comparisons shared by one scoped inspection.
Identical needs and version inspections are reused only within that immutable
Task/authority/time read; each historical selection still checks its own method
and epoch. Exhausted needs remain explicitly unavailable alongside inspectable
catalogue metadata and retained receipts. Exact selection/current-use assesses
only the requested version with a fresh budget. Disable/recall and exact
retry remain available at capacity. Revisions/epochs use canonical decimal
strings on the API; resource bytes preserve Unicode and multiline layout.
Skills responses have a separate 8 MiB browser read bound; ordinary JSON reads
retain their 4 MiB bound. Current inspection explanations are bounded to 256
UTF-8 bytes. The response-envelope contract includes duplicated
current inspections, redacted blocking bounds, resource digests, receipt wrappers
and current status provenance; assignment labels are independently paginated.
An explicit need outside the Task's single accepted account is forbidden even
when other declared needs fit that account; the inspector never searches another
account for authority. Missing Task acceptance is unavailable.


Admin assignment choices use separate pages of 50 clients or engagements, so a
large organisation or a failing Methodology read cannot hide installed skills or
restriction controls. Each installed version exposes its current status event's
actor, server time, revision and exact reason; transition history is separately
paged newest-first, 50 events at a time. Catalogue reads remain bounded as events
grow. Audit users can locate disabled/recalled selections from the selected
engagement and open their exact Tasks. This impact read filters current audit
scope before disclosure and pages 50 historical references at a time; Admin-only
configuration still exposes counts without Task access.

Skill authoring uses Unicode scalar and UTF-8 byte limits, preserves invalid
input, and associates actionable errors with its controls. Unsent installation,
edit, status and selection drafts survive transient session-check unmounts in
bounded memory under their exact actor/session and organisation/scope/Task owner.
They remain hidden until that owner is freshly authorised; replacement, denial,
logout, cancellation and success discard them. Recovery preserves original basis
and never submits automatically. Methodology unsent-draft custody follows the
same ownership boundary in Story 21.4 below.


## Scoped working knowledge (Story 21.4)

The Task inspector’s **What Zobba is using** combines independently authorised
methodology, selected technique references and working knowledge. Each fragment
identifies its exact Task epoch and method binding. A changed or unavailable basis
withholds that fragment. This inspection prepares later work; it does not claim
that a model consumed the records or that a skill executed.

Accepted Guide commands automatically produce attributable historical decisions,
including the original Task/cycle and Received/Applied standing. They remain local
directions, not universal engagement instructions. Changes to live direction still
use Guide. Supported UTF-8 acquisitions automatically record a bounded exact source
excerpt and separate assertions from populated acquisition metadata. Source text
means “this source states this”; supplied interpretations remain assertions. Source
identity includes registered original, immutable storage version, digest and byte
range. BOM, CRLF and Unicode bytes are preserved. Unsupported binary formats retain
an explicit extraction omission. Capture neither evaluates truth nor proves full
coverage or a business period.

The inspector supports attributable assertions and corrections, destination-local
exclusion/forgetting, exact historical inspection, and explicit reuse in a named
same-client engagement and Task. Reuse requires current source and destination
access separately for the human viewer and the Task’s existing accountable actor.
It retains source ACLs and does not widen the Task’s scope or grant an operation.
An explicit source correction links two registered originals in the same scope,
retains both, checks the expected correction revision and invalidates dependent
context. Equal filenames, digests or supplied version labels never infer replacement.

Two matching explicit Expand/Reduce choices on distinct inspection openings can
learn the owner-private `task_inspection_layout` setting. Later openings apply it
where screen width permits; automatic resets do not train it. Inspection identifies
the deterministic rule and events. Undo consumes the observed history, removes the
future default and withdraws active publications of that exact revision. A captured
preference revision also fences delayed observations after Undo or an explicit Save.
Explicit settings take precedence over learned defaults.

The owner may release only that exact typed presentation value to an assigned
engagement. Recipients see the optional setting without receiving private source
events or other personal text. Editing a private preference does not replace a
previous publication. Publications can be withdrawn; retained receipts remain audit
history. Arbitrary prose cannot use this release path. Firm context continues to
come from saved Admin methodology, with its existing ownership and provenance.

Knowledge reads filter current source access and dependency validity before search
or disclosure. Period-limited records require a compatible known Task period;
unknown periods and partial retrieval stay explicit. Before browser disclosure,
non-text verification rechecks the exact shown references and current Task basis
in one transaction. Preference and source inspectors have their own current-read
verification. These bounded POSTs are reads, not automatic commands. Pages contain
at most 50 records with byte/ASCII keyset ordering across knowledge and released
preferences. Each request examines at most 1,024 combined candidates. Reaching
that ceiling reports a scan-limit omission; a partial page can continue from its
last eligible record. If none is eligible, no safe cursor is exposed and later
records may remain omitted. Text filtering runs after current source checks and
does not bypass that scan limit. Exact record/revision lookup and exact
original capture recovery remain available beyond the search page. Ordinary JSON
responses retain the 4 MiB reader bound. Individual stored records and commands
have a conservative 60,000-byte JSON admission bound; dependency traversal is
bounded to 256 exact revisions. Preferences retain at most 50 publications.
Restrictions and exact retry use their existing identities rather than creating
new source records. Durable command receipts retain bounded event facts and exact
record references; each response rebuilds the record view with current status and
access checks. This keeps maximum-length restriction reasons usable for already
accepted records without duplicating their full text into receipt storage. Empty
results never establish absence.

Schema 10 is an additive migration. The published migration/catalogue prefix 1–9
is preserved. New Guide commands receive a server timestamp; earlier commands keep
an explicit unknown (`NULL`) time and are not presented as newly captured timed
decisions. Registered originals without a completed derivative can be recovered
from **Source working knowledge**, using a freshly authorised pinned object read.
Acquisition and exact Guide retries revisit their owned derivative path. No object
read holds a database transaction. Original evidence and command receipts survive
correction, withdrawal and future-context exclusion.
An exact knowledge-command retry preserves the accepted event identity when a
separate supporting source becomes inaccessible, withholding the protected record.
Current session and originating/destination Task scope remain required.

The focused methodology follow-up also retains unsent edits and recall reasons in
bounded memory across a transient session-check outage. Recovery waits for the same
actor/session and that editor’s own fresh Admin read. Replacement, denial, sign-out,
cancel and successful completion discard the draft. It is never stored in browser
storage or automatically submitted.

## Native model transport and current tools (Story 22.1)

Schema 11 adds append-only model profile/catalogue revisions, attributable dispatch
cutoffs, immutable results and exact model-call-to-operation bindings. Published
migration and catalogue files 1–10 remain unchanged. New tables enforce scoped RLS;
the non-owner runtime cannot rewrite or delete model history. Admin profile and
catalogue saves require the current Admin session and share organisation advisory
205 with Task controls and Permissions. Admin-only identities can read and revise
configuration without receiving audit-workspace access. A successor or disablement prevents new
use of an older snapshot while preserving its historical invocation facts.

`ModelRepository::new` has no qualified providers. Trusted server composition must
supply a `ModelQualificationSource` that corroborates the exact provider account,
provider, model, destination, capability revision and fixture/live class. Native
adapters also bind a non-secret account/project identifier and reject a different
profile account before I/O. An operator must tie that identifier to the configured
credential; the label alone does not prove provider account identity. Saving an
Admin document
or passing deterministic fixtures cannot establish live qualification. The same
source must be installed on the operation repository consuming model proposals;
its default configuration refuses model-bound operations. Installed skills keep
their independent existing qualification gates.

Requests are assembled by trusted application code, with exact Task/cycle/claim,
producing intent/execution basis, profile and catalogue, input classes, context
manifest and a canonical Send disclosure operation. `bind_disclosure` deterministically
binds the entire portable input (including history, catalogue and schema) to exact
SHA-256 attachments for every declared input class. Permissions therefore checks
the actual payload's complete classification set; a changed payload requires new
binding and current authority. There is no public raw-prompt endpoint. Current
knowledge dependencies, Task controls, profile/catalogue,
qualification and accepted/current Permissions are checked in the same short
transaction before the durable possible-disclosure cutoff. Provider I/O holds no
SQL connection. An exact retry or replacement owner recovers the original
invocation without resending. A missing result means possibly accepted and unknown
usage, never proof of non-execution or zero charge.

The native adapters call only OpenAI `https://api.openai.com/v1/responses` with
`store:false`, and Anthropic `https://api.anthropic.com/v1/messages`. Their credentials
belong to adapter configuration and are absent from requests, database facts and
public errors. Redirects and automatic retries are disabled. Neither adapter uses
provider-owned conversations or implicit continuation IDs. Typed history carries
complete paired calls and attributed results. The repository verifies the original
successful proposal, exact operation binding, consumed attempt, terminal receipt
and current source access before reuse. A receipt confirms execution disposition,
not the truth of source content. Hostile result text remains tool data. Streams and
JSON have
independent frame, depth, node, argument, output and aggregate byte limits;
fragmented UTF-8, CRLF and multiline SSE are decoded incrementally. Text and tool
items remain provisional until validated terminal completion. A cancellation
proves local termination, not provider non-execution or an absence of charges.

Text, explicit structured output and complete canonical tool proposals are
supported. The initial schema subset supports bounded strings, integer numbers,
booleans, arrays, closed objects and constants. Fractional/exponential numbers and
unrecognized provider events fail explicitly. Reasoning effort other than `None`
is currently unsupported and must not be declared as an available profile
capability. Tool descriptors currently describe exact prepared operations:
account, destination, resource, material, digest and every effective argument are
fixed by the catalogue. This is not an arbitrary variable-argument tool resolver.
A future investigation tool needs a trusted versioned resolver that validates its
arguments, derives and persists an exact canonical operation, and participates in
both admission and consumption checks. Normalized tool-name collisions and
substituted arguments are refused. A successful complete proposal can be atomically
admitted only through
the existing Permissions gateway; consumption repeats the current checks. Partial,
refused, failed or unsupported completions cannot produce executable operations.
Consumed effects retain existing reconciliation and receipt custody after controls
or restrictions change.

Local verification includes actual loopback HTTP/SSE fixtures for both providers,
portable parser/coordinator tests, the PostgreSQL operation contract's model
cases, and populated schema 10→11/bootstrap/runtime-role contracts. Run the
workspace gates above; these checks do not contact a live model provider.

Live qualification remains blocked until the owner explicitly approves the exact
provider accounts, credentials, destinations, model identifiers, input classes,
request/token limits and spend ceiling. No current application configuration is
live-qualified. The reviewable qualification plan uses only synthetic material:
for each provider, one text request, one exact inert tool proposal and one request
reconstructed with that owned tool result. The local tool must never perform an
external effect. Record exact native request counts, model identities, completion,
usage and safe evidence; retain a failed/unknown outcome honestly. Enforce the
approved ceiling through account/provider limits or a reviewed price-and-token
bound before the first paid request. Only executed evidence can support a later
trusted live registration. The default API and worker still start no model loop;
continuing autonomous Task work belongs to Story 22.2.

The proposed non-reasoning smoke profiles are `gpt-4.1-2025-04-14` and
`claude-sonnet-4-6`; public availability does not establish account entitlement.
The budget's `gpt-6.1-sol` and `claude-opus-5-5` profiles require later reasoning
support and separate qualification. No approved model is silently substituted.
Native requests explicitly select Standard processing, and usage retains the
provider's reported tier. Unknown or unexpected live tiers cannot establish a
successful qualified invocation or release executable proposals.

The proposed envelope is six synthetic requests and **USD20 of API-token usage
before taxes**, pending owner approval. Reserving each model's full documented
context capacity for every attempt, plus 1,024 output tokens, gives USD16.7416224
at the reviewed Standard tariffs, including Anthropic's 10% US geography premium.
This deliberately exceeds the expected short-probe usage; the 16KiB body cap is
not a proof of billed input tokens. It is not an account-wide limit or invoice
guarantee. No deposits, subscriptions, hosted tools or infrastructure are included.
The exact accounts, applicable tariffs and any required tax allowance must be
resolved in the reviewed manifest before execution.

Use only `ZOBBA_OPENAI_API_KEY` and `ZOBBA_ANTHROPIC_API_KEY` through secure
settings, with explicit non-secret account/key mappings. Generic global API keys
are not a fallback. A USD20 environment confirmation acknowledges the reviewed
reservation; it does not enforce provider billing. Continuation previews are
templates: only the validated provider call ID may change, and each transmitted
body's hash is recorded.

The local qualification plan can be inspected without credentials or provider
requests:

```sh
cargo run --locked -p zobba-infrastructure --example model_qualification -- --dry-run
cargo test --locked -p zobba-infrastructure --example model_qualification
```

The default plan uses explicitly pending account labels and spending evidence.
Before execution, regenerate it with the approved `--openai-account`,
`--anthropic-account`, exact model options, non-secret `--spend-evidence` reference
and an existing retained `--receipt-dir`. Review that manifest and its SHA-256.
The execution guard requires the exact approved manifest hash, an approval ID
and the reviewed USD20 pre-tax reservation confirmation. It atomically consumes the approval
before reading a key or attempting a request. An interrupted or failed approval
cannot be reused; retain the receipt directory. These guards do not establish
permission to execute, verify an account label against a key, or enforce provider
billing. No live execution is approved in this checkpoint.

## Continuing a real Task under changing guidance (Story 22.2)

Schema 12 is additive; published migrations and catalogues 1–11 are unchanged.
It adds append-only `task_steps`, `task_guidance_applications`,
`task_routing_questions`, `task_routing_answers` and `task_work_claims`, with
forced scoped RLS and SELECT/INSERT-only runtime grants, plus a `step` Task event.

The worker runs a durable model work cycle only when a trusted composition is
injected (`coordinate_work`): a qualification source, transport, owned gateway
and disclosure template. Production `coordinate` installs none, so every Task
keeps the inert executor and the card reports the model unavailable. Each turn
uses the 22.1 coordinator with key `turn-` + SHA-256(Task, cycle, applied
intent, step ordinal, profile ID and revision, catalogue ID and revision), so a
configuration change after a crash cannot replay an old receipt; each recorded step (model turn or tool step) is an
immutable fact written under the exact claim producer's custody. Tool proposals
pass `admit_tool` and current-Permissions consumption, then the owned gateway.
A cycle is bounded at 16 turns; a text-only turn leaves the Task `waiting`, which
is never a completed objective. While any step of the cycle is
`reconciliation_required` and unresolved, no new turn starts and no further
proposal is dispatched. A turn that responded or failed under the applied brief
is not repeated on an owner takeover; only newly applied guidance (or, after a
failed turn, an explicit Resume/Continue) starts another paid turn. Guidance to a
`waiting` Task wakes it: the Guide is applied at the boundary and the next turn
runs with the new brief. Only a current Permissions refusal is recorded
`refused`; other admission or dispatch failures are `failed`. Consecutive fenced
retries are bounded (3, with backoff). A step write that replays an existing
ordinal must match every stored field; a differing retry is a conflict.

Guidance never cancels work. `current()` checks only owner, execution epoch and
cycle (continuation); admission, disclosure and consumption additionally require
the applied intent. A Guide is Received at once and applied at the next step
boundary, recorded in `task_guidance_applications` with the boundary ordinal. A
turn whose producing intent is stale is recorded as `superseded` and its
proposals are never admitted; the next turn reconsiders them by catalogue name
under the applied brief. Pause/Stop bump the execution epoch, so the existing
200 ms authority poll cancels a stalled provider call. A work claim lost with its
producer is taken over by a fresh owner: the same invocation key recovers
without resending, and consumed tool attempts go through the existing
reconciliation without replay.

A replacement producer rebuilds each tool step from immutable operation history
(`settled_attempt`) before any consumption: an attempt with a resolved source
fact is recorded `completed` with that fact and enters later turns as an owned
`ToolExchange`; a consumed attempt without one is `reconciliation_required`. A
completed or possibly dispatched operation is never recorded as refused and is
never resent. A fence after admission (guidance or a control changed before
consumption) is `superseded`, not `refused`. Historical turns, including those of
an earlier applied intent, are read by exact identity within the claim's own Task
and cycle; `prepare` still checks every disclosure.

Each turn's context includes the Task's current authorised knowledge (at most 16
records and 64 KiB of text; a record that does not fit is skipped, and the count
of left-out records is stated in the context and recorded on the step), read under the boundary's Task fence with the same
per-record checks as knowledge inspection. Each record is an exact `{id,
revision}` context entry under a bounded derived source ID and a `current` verification item, so `prepare`
re-verifies it at disclosure. Withdrawn, forgotten, excluded, corrected or
invalidated records are omitted and never disclosed; preference publications are
not context. The OS-level proof in `crates/worker/tests/work_process.rs`
re-executes the test binary as a worker process and SIGKILLs it mid-turn and
mid-tool, because the production binary deliberately composes no qualification
source and has no fixture flag.

Untargeted direction (`POST task-directions`, reserved control lane) is routed by
the server, never a model: exactly one open Task that accepts guidance receives
it as Guidance (direction keys are namespaced `direct-`); two to 100 produce one
durable targeting question. An answer (`POST
task-questions/{id}/answer`) names one or more of its candidates; each receives a
Guide with key `route-` + SHA-256(question key, Task), so retries create no
duplicates, and stale or foreign Tasks refuse. `GET tasks/{id}/work` returns the
card projection (bound method, current work, next action with its proposing
invocation, attention, recent steps with the total step count, and brief
revisions with applied boundary and `superseded_by` — only a later revision of
the same cycle that was actually applied supersedes). No route returns model
text. `GET task-questions` uses the ordinary lane and reports `has_more`.

Schema 12 also enforces, at the storage boundary, that a step's attempt and
operation belong to the same Task, cycle and proposing invocation call; that
guidance applications are recorded only for Create/Guide commands; and that an
answer's selection is a distinct subset of the question's candidates, by its
author. These SECURITY INVOKER trigger functions are inventoried and checked at
bootstrap. The browser persists a direction in its own channel of the durable
recovery outbox before sending it, fences late replies, recovers an unconfirmed
direction after reload for an explicit check, and verifies that an answer names
exactly the chosen Tasks. The work card polls while the Task is ready or running.

## Compacting context without inventing authority or evidence (Story 22.3)

Schema 14 is additive; published migrations and catalogues 1–13 are unchanged.
`task_steps` gains nullable `reason` (`context_budget` only, failed model turns
only), `estimated_input_tokens` and `actual_input_tokens` (model turns only). New
`task_context_compactions` holds immutable records: task, cycle, sequence,
covered ordinal range, a bounded JSONB digest with its SHA-256, the knowledge
sources with their status when the record was made, omission counts and the
token estimate. Runtime has SELECT/INSERT only; the SECURITY INVOKER trigger
`work_compaction_guard` refuses a record out of sequence, a non-contiguous range
or a digest that names another record (its identity fields must be JSON numbers
and strings, checked before any cast), and both ends of a range must be recorded
steps. A BEFORE UPDATE trigger, `work_compaction_immutable`, refuses every update,
including one made by a privileged writer. Runtime has no DELETE grant.

Each request is planned (`zobba_domain::context::plan`, pure) under a budget in
conservative tokens: UTF-8 bytes, which are never fewer than the tokens they
encode, plus a per-item allowance. The budget is the minimum of the trusted
profile limit and the Task setting (`WorkSettings.context`, composition
supplied) and never exceeds the request validation caps (128 messages, 64
history items, 256 KiB of messages, 256 KiB of history). Tiers: (1) owned
system constraints and (2) objective, method, brief and unresolved decisions
(open targeting questions naming the Task, superseded proposals by catalogue
name, reconciliation outcomes), plus the tool catalogue and an exact bound on
the omission summary; (3) the newest complete turns as raw history; (4)
compaction digests of older turns; (5) current knowledge; (6) the omission
summary with counts by category. When the uncovered history does not fit
beside the earlier digests, the oldest whole turns are compacted: the record is
persisted before the send, and the request is planned again with it stored, so a
recovering producer builds the identical request. Covered steps are never
expanded again; a later record covers the next range and earlier records remain.
At most one record is made per request. If tiers 1–2 alone exceed the budget,
the re-plan after that record still needs another, or a hard limit is reached
(records per cycle, sources per record, the request caps after assembly), nothing
is sent and the turn is recorded `failed` with reason `context_budget`. A cycle
therefore never stops being recordable. Each turn records its estimate and the
provider's reported input tokens.

A digest is canonical JSON (sorted keys, no whitespace) of step facts only —
ordinals, kinds, statuses, intent and epoch, invocation, call, operation and
attempt identifiers, receipt facts and fixed reasons — plus the knowledge
`{id, revision}` references the covered turns used and fixed limitations. It
contains no model, tool or source text and no platform label, is never a
summary and never evidence. The store rebuilds it from immutable step and
invocation rows and refuses one it cannot reproduce byte for byte. It also
refuses named sources that differ from the rebuilt set and a `steps_compacted`
count other than the covered steps. On read, the SHA-256 is verified over the
domain `canonical_json` serialiser, not over PostgreSQL's jsonb text.
`TaskRepository::rebuild_compaction` returns the stored record and that rebuild
for review. Raw steps,
invocations and results are never altered.

Before disclosure the loop computes, for every earlier invocation, the knowledge
revisions its content depends on (its own verified context plus, transitively,
the invocations whose exchanges or answers it carried) and asks the knowledge
owner for their current standing under the same predicate as disclosure. An
exchange or earlier answer that depends on a withdrawn, corrected or invalidated
revision is replaced by fixed platform facts (tool name, operation, attempt and
receipt fact) and a stale marker naming the source and its status; the current
revision of a corrected record is used if it fits. Only content actually
included carries dependency verification: a model answer's context entry now
names its producing invocation (`depends_on`), and `prepare` verifies the
context of every included exchange's and answer's origin, transitively. A
withdrawn source therefore no longer refuses every later turn; loss of the
viewer's or Task's own scope is still refused. An earlier answer must be the
answered invocation of the same Task, with its exact labelled envelope text, or
the request is refused. Exhausted capacity or unavailability while checking a
standing is not a revocation: the turn ends unavailable, with no stale marker and
no compaction. Reference checks are chunked (512 per read).

Objective, brief, knowledge, tool results, digests and earlier model output are
each wrapped in a `[zobba-data class=<input class> source=<id>]` envelope; any
case of the keyword inside the content is escaped (`zobba\-data`). The input
class is carried by the envelope and is distinct from the firm's data
classification, which alone is bound to Permissions at disclosure (that binding
format is unchanged). Only the owned constraints are System, and tool admission
remains Permissions-only. `GET tasks/{id}/work` adds the step reason and token
counts and the most recent 20 compaction records (no digest body, with
`created_at` in epoch seconds and omission categories as a closed enum); "What
Zobba is using" shows them with their creation time, stale sources and
omissions, and the raw steps stay listed under Current work. One read serves both
panels.

## Measured analysis in an isolated workspace (Story 22.4)

**No production entry point admits an analysis job yet.** No HTTP route, model
tool or composition builds an analysis target, so `Analysis::admit` is called
only by tests. The worker can run and recover jobs that a later model-tool
story will create, with its own admission, policy and attachment classification.

Schema 15 is additive; published migrations and catalogues 1–14 are unchanged.
An analysis job is an exact recorded operation through the existing operation
store: admission, the consume cutoff and dispatch/lookup are Story 20.5's, never
a second ledger. The canonical meaning binds the environment ID and image
digest, the program's SHA-256, every input as `{original id, digest}` and the
limits (`zobba_domain::analysis::AnalysisRequest::canonical_material`). An exact
retry returns the original job; a changed meaning conflicts. The server
allowlist (`server_allowlist`) holds one general image, `general-python-3-13`,
pinned by digest; a request naming anything else is refused before any write.
Limits are bounded by the owner ceiling: 2 vCPU, 4 GiB, 256 PIDs, 15 minutes,
100 MiB of outputs (10 MiB per file, 64 files).

New tables: `analysis_jobs` (with `admitted_us`, the microsecond admission
order that makes pending work oldest-first), `analysis_job_events` (the durable
status: `admitted`, `possibly_started`, `running`, `completed`, `failed`,
`limit_exceeded`, `stopped`, `collected`, `unknown`, `absent`),
`analysis_descendants` and `analysis_rejections`. Runtime has SELECT/INSERT
only; `analysis_event_guard` refuses an out-of-sequence or impossible
transition (a `failed` after `absent` only as `start_refused` after eight
attempts), `analysis_output_guard` admits outputs only for the latest
collectable attempt with parents equal to the job's inputs, and
`analysis_immutable` refuses every update.

Every job reaches a durable outcome:

- `possibly_started` is written before anything is staged. Any failure before
  the sandbox is dispatched (staging, credentials, presigning) is a refusal: the
  attempt is `absent` and retryable under a fresh claim. After
  `MAX_START_ATTEMPTS` (8) such attempts the job is `failed:start_refused` and
  closed with an empty collection.
- The wall limit starts when the sandbox first reports Running; a sandbox that
  never reaches Running within the provisioning bound is stopped. A job whose
  termination cannot be confirmed is `unknown`: never retried automatically and
  no outputs are collected (operator reconciliation is a later story).
- After confirmed termination, collection is attempted a bounded number of
  times. If the outputs cannot be read (for example no collector manifest) the
  terminal fact is still recorded (`completed`, `failed` or
  `limit_exceeded:<reason>`) and the job is closed `collected` with reason
  `collection_unavailable` and no descendants.
- A settled fact whose source observation was lost is found again by
  `pending()` and the observation is re-issued; identical observations are
  idempotent. A job whose recovery fails is skipped so the Task's other jobs
  still run.
- Lost-job recovery (`WorkRunner::reconcile`) uses restricted receipt custody,
  looks the sandbox up and resumes the watch or collection for at most
  `RECONCILE_WATCH` (30 s), detaching (never stopping) on worker shutdown; it
  never dispatches and never blocks the coordinator for a long job.

Outputs are validated by the trusted Rust validator: relative UTF-8 paths, no
`..`, absolute, NUL or control characters, bounded length (255 bytes) and depth
(8), unique — including case-insensitively by one folding rule
(`fold_key`: NFC, Unicode full case folding, NFC), which is also the database
unique key (`analysis_descendants.fold_key`) — regular files only (symlinks,
hard links, devices, FIFOs and sockets are refused), per-file, total and count
limits, the allowlisted media types (`text/csv`, `application/json`,
`text/markdown`, `text/plain`, and since Story 22.5 `image/png` for the
general environment's rendered pages) and a trusted SHA-256. One trusted collector
script (`deploy/qualification/analysis/collect.py`) serves both sandboxes; it
never fails on a hostile entry (unreadable entries are kind `other`, names past
the path bound are withheld as `too_long`, at most 1,024 entries) and says why it
withheld bytes (`slots`, `budget`, `unreadable`), which become `too_many_files`,
`total_too_large` and `not_regular`. Accepted files are registered through 21.1
evidence custody as descendants of the pinned originals.

Receipts and logs hold only IDs, digests, sizes, counts and closed reason codes,
never program text, input bytes or output contents. A receipt carries exact
rejection counts per reason and a sample of at most 32 rejections (every
rejection is its own row), so any collected tree fits its bound. **Accepted
output paths are stored in plain text** in `analysis_descendants.path`: they are
the descendant's name for inspection and provenance. A path is program-chosen
(bounded to 255 bytes) and must be treated as untrusted text; rejected paths are
stored only as SHA-256.

What the job sees. In both sandboxes the program receives no Zobba, AWS, proxy
or model variable, no credential and no task role:

- Docker test sandbox: only the pinned image's own defaults (`PATH`, `LANG`,
  `GPG_KEY`, `PYTHON_VERSION`, `PYTHON_SHA256`) plus `HOSTNAME` and `HOME`;
  `--network none`, so no endpoint at all is reachable.
- Fargate: the image defaults plus what ECS injects into every container
  (`ECS_CONTAINER_METADATA_URI`, `ECS_CONTAINER_METADATA_URI_V4`,
  `ECS_AGENT_URI`, `AWS_EXECUTION_ENV`, `AWS_REGION`, `AWS_DEFAULT_REGION`).
  The ECS task metadata endpoint (`169.254.170.2/v4/...`) is reachable: it
  discloses task metadata (task and container ARNs, image, limits, network,
  stats) but no credentials, because the task has no task role
  (`AWS_CONTAINER_CREDENTIALS_RELATIVE_URI` is never set). Fargate offers no
  way to block it.

Sandboxes. Production configures only Fargate (`ZOBBA_ANALYSIS_SANDBOX=fargate`
with exactly the names in `deploy/qualification/analysis/worker-environment.json`,
which Terraform sets and the Rust tests check). Any other value, including
`docker`, refuses to start. The Fargate job task has no task role and runs in a
dedicated analysis VPC: no internet route, a S3 gateway endpoint restricted to
the job's staging prefix and ECR layers, ECR and Logs interface endpoints only,
and a resolver DNS firewall that answers only those names (fail closed). Only
the trusted stage container receives a presigned manifest URL (lifetime =
provisioning + wall + grace + collection, refused if the signing session ends
sooner); the program runs as 65534 under an in-job `timeout -s KILL <wall>` so
the trusted collector still runs afterwards, with read-only inputs, only
`/output` and `/tmp` writable, no capabilities, no environment and no log
configuration (its stdout and stderr never reach CloudWatch). The task ARN and
the first observed terminal facts are persisted to the staging prefix, so a
finished task stays known after ECS forgets it. The local Docker sandbox exists
only behind the infrastructure `test-docker-sandbox` feature (`--network none`,
read-only root, all capabilities dropped, `no-new-privileges`, non-root,
PID/memory/CPU/file-size limits, tmpfs `/tmp` and output); CI checks that no
release build enables it.

Verification (offline; no AWS call):

```bash
cd zobba
cargo test -p zobba-domain analysis
cargo test -p zobba-application analysis
cargo test -p zobba-infrastructure --lib analysis      # SigV4 vectors, Fargate stub, env contract
cargo test -p zobba-worker --test analysis_sandbox -- --test-threads=1   # guarded _test DB + Docker
terraform -chdir=deploy/qualification test
```

The worker test pulls the pinned image by digest and runs real hostile programs:
a credential probe, symlink/hard-link/FIFO/socket/case-collision outputs, a fork
bomb, memory and output exhaustion, an endless loop, a hostile tree past every
collector bound, Stop during a run, lost-job recovery (directly and through the
coordinator), both collector modes over one tree, the stage script against a
local manifest server, and owner SQL each database guard refuses. Live Fargate
qualification belongs to Story 20.7b.

## Reading documents and citing exact source locations (Story 22.5)

Schema 16 is additive; published migrations and catalogues 1–15 are unchanged.
The agent has two reading tools, both chosen through the fields of its own
structured cited answer (`read_pages`, `programs`); no variable-argument
catalogue tool is added.

- **Native reading.** Trusted code (`crates/application/src/reading/document.py`,
  server-owned, never model-written) renders a PDF or image original to PNG
  pages in the 22.4 sandbox, recording each page's text layer if it has one.
  One page is sent per model request as image input. Each request is its own
  recorded `Send` disclosure operation whose attachments include the page
  image (`page-image`, its SHA-256 and the original's classification);
  `reading_guard` refuses a read whose invocation does not disclose exactly
  that rendered image. The OpenAI encoder sends `input_image`; the Anthropic
  encoder refuses image input before any send. At most 4 pages per answer,
  200 pages per document per Task, 2 MiB per page image (rendering retries at lower
  scales; a page that still exceeds the bound is `page_too_large`), 3
  attempts per page. A failure that is a fact about the document (`page_not_found`,
  `page_too_large`, `not_a_paged_document`, `source_unreadable`) is settled
  and never asked again. The transcription enters later turns only as
  labelled model output that depends on the reading invocation; it is never
  evidence. No OCR and no fixed pre-extraction fact database.
- **The model's own analysis program.** One program per answer runs in the
  22.4 sandbox over named registered originals. The general image now carries
  pandas, openpyxl, python-docx, pypdfium2 and the standard `email` package
  (`deploy/qualification/analysis/general/`, hash-pinned wheels, reproducible
  build). Validated text outputs reach the next turn as analysis output; a
  program that fails or hits a limit is recorded as `program_failed` or
  `program_limit` with no outputs.

A cited answer is segments of text, each with up to 8 sources
`{original id, locator, quoted text}`. Locators are canonical: `page:N`,
`cell:Sheet!B4[:C6]`, `paragraph:N`, `table:T:R:C`, `header:Name`, `part:N`,
`bytes:S-E`. After every answer, trusted verification reads the exact cited
original — byte ranges in process; cells, paragraphs, table cells and email
headers/parts by the trusted document program in the sandbox (macros never
run, external links never kept, bounded package expansion); pages from the
stored render's text layer — and records `verified`, or `unverified` with one
closed reason: `not_found_at_location`, `location_missing`,
`source_unreadable` (including an unregistered original, an encrypted or
oversized package, or any failed read) or `page_only` (the page was read
natively as an image, so only the page is confirmed). Normalization is only
whitespace collapsing and NFC. Verification never edits the answer and gives
no confidence score.

New tables: `document_renders`, `document_pages`, `task_page_reads`,
`task_program_runs`, `answer_verifications`, `answer_citations`,
`citation_sources`. Runtime has SELECT/INSERT only; `reading_guard` checks each
insert against the facts it depends on and `reading_immutable` refuses every
update. `GET /engagements/{id}/tasks/{task}/answers` returns the current
cycle's verified answers with the text unchanged and each source's
verification and reason. A citation never grants source access: for an
original the viewer cannot read now, the quote, filename, version and digest
are withheld. The Task work panel shows each cited span with a `Citation`
chip (short filename, `+N` further sources); hover or keyboard focus shows a
card with the file, location, a bounded quote, Open (the evidence viewer at
the cited location of the exact original, a cited byte range marked in the
preview) and, only for an unverified source, "Unverified" with its reason.
Escape dismisses the card; with focus in the chip or card it also returns
focus to the chip, while a card shown by hover alone closes without taking the
key from whatever has focus. The card is positioned against its own chip. When
trusted verification of an answer could not be completed, the answer is still
shown and each source is `unchecked` (`verification_failed: true`); a turn with
no answer text (one that only requested reading) is never listed. One response
that does not parse is skipped with a notice and never blanks the others.

Review-fix rules (2026-10-14): capacity, unavailability, an unsettled or
cancelled job and a transient provider condition never become recorded facts
and never consume a page's 3 attempts; they end the step for a later reclaim.
A page read is offered no tools (its catalogue carries none). A page read in an
earlier cycle is reused: its recorded transcription is shown again and nothing
is disclosed again. The next turn also lists every refused or settled request
with its closed reason and how each earlier citation was verified. Readings are
ordered by database time; when bounds trim, the newest are kept, an oversized
one is skipped and an omission line says so. The render guard pins the trusted
document program by its SHA-256 prefix, as the document-environment admission
does; a model-written program can never output a page image.

The production worker still composes no qualification source, so no model
reads documents in production; `zobba_worker::work::ReadingComposition` is the
trusted composition that tests run.

Verification (offline; no provider call):

```bash
cd zobba
cargo test -p zobba-domain citation
cargo test -p zobba-application citation reading
cargo test -p zobba-infrastructure --lib model::native   # image encoding, Anthropic refusal
cargo test -p zobba-worker --test citations -- --test-threads=1   # guarded _test DB + Docker
pnpm --dir web check
pnpm --dir web exec playwright test tests/browser/citations.spec.ts
```

The worker test runs the production coordinator with the reading composition,
a native OpenAI loopback provider, real S3-protocol originals and the pinned
image: a native page read (one image, one disclosure), a page past the end of a
PDF, the model's program, every verification result above over real xlsx,
docx, PDF, email, plain-text, zip-bomb and encrypted fixtures
(`fixtures/documents/generate.py`), the cited-answer API including withheld
sources, and the database guards. It also reads a JPEG photo and refuses an
oversized PNG page without disclosure, verifies a macro workbook cell (the
macro is never run) and a cell range, records a failing program
(`program_failed`) and an unregistered input (`input_not_registered`), refuses
forged, re-roled or unrecorded transcriptions in a later request (Conflict, not
prepared), lists only answers with text, and reuses the first cycle's page read
in a second cycle. The exact API JSON it receives is
`web/tests/fixtures/task-answers.json`, which the web unit tests parse
(`ZOBBA_UPDATE_ANSWER_FIXTURE=1` rewrites it after an intended change).
Changing schema 16 requires regenerating `crates/infrastructure/src/schema-v16.catalog`
from a migrated disposable database.

## Method and installed skills during investigation (Story 22.6)

Schema 17 is additive; published migrations and catalogues 1–16 are unchanged.
The method and skills reach the model by progressive disclosure, through the
fields of the existing structured cited answer. No catalogue tool is added.

- **Method outline.** Every turn carries a bounded outline of the Task's exact
  methodology binding in tier 2 (never dropped): its version IDs and status,
  each requirement with its label, mandatory flag and fetchable part IDs
  (`criteria/R`, `procedure/R`, `template/T/V`). The agent asks for up to 8 parts
  per answer in `read_method`. Trusted code reads the part from the current
  binding, records a `task_method_fetches` fact, and sends the part in the next
  turn only while it is still current under that binding and execution epoch.
- **Skill listing and loads.** Eligible skills are listed by name, description,
  version, digest and need status only (at most 32 named, the rest counted).
  `use_skills` asks to load up to 4. Each load passes a fresh gate under the
  claim's own custody (new `skills_work` function: consumed claim, current
  owner, epoch and lease): disabled, recalled, inapplicable, methodology or
  Task blocked, forbidden and tool-unavailable versions are refused with a
  closed reason. Each load records an immutable `task_skill_uses` fact
  (version, digest, catalogue revision, binding, epoch). Loaded instructions
  enter later turns as `skill` data, in their own budget tier before knowledge
  (`skills_budget` omission), only while the gate still allows the version and
  only under the same binding and epoch. Further resources are fetched on
  demand by the part ID `skill/V/R`. A skill's declared tool needs never create
  an operation, and selecting or loading a skill grants no execution.
- **Skill scripts.** `run_skill_script` (at most 2 per answer) runs a loaded
  skill's script resource over named registered originals as a 22.4 analysis
  job in the pinned general image only. The use fact names the job ID; the
  guard requires an ended job of this Task over exactly those inputs.
- **Gaps, questions and statements.** `method_notes` (at most 32) are `gap`
  (closed reason: `evidence_unavailable`, `action_not_permitted`,
  `tool_unavailable`, `criteria_missing`, `skill_unavailable`), `question`, or
  `statement` that points at answer segments and so at their verified
  citations. There is no "complete" kind and no numeric confidence. Trusted
  code also records platform gaps deterministically: `criteria_missing` once per
  cycle and binding for a mandatory requirement without criteria, and
  `skill_unavailable` on the requirement that names an unloadable skill. A
  question becomes Task attention (`method_question`) until an applied
  working-brief boundary follows it. A separate investigation record per
  answered turn (`task_investigation_notes`) names the model, catalogue and
  binding used; the human working brief is never changed.
- **Binding changes.** An `active_tasks` Save switches the binding at a safe
  boundary as before. Earlier facts keep their own binding and epoch; content
  loaded or fetched under an earlier binding is not resent, and the next turn
  says so.

`GET /engagements/{id}/tasks/{task}/work` adds `investigation`: method status
and versions, skill uses (outputs withheld), notes, open questions and the
latest record. The work panel's "Method and skills" section shows the method
versions and status, the skills used (name, version, short digest), refused
loads, gaps, questions and "Zobba says" statements with their citation chips.

**Methodology document proposal (AC4).** An Admin uploads a plain text or
Markdown document (at most 200,000 UTF-8 bytes; a longer one is refused with
HTTP 413 `document_too_large`) with
`POST /methodology/organisations/{id}/proposals`. The proposal ID is derived
from the organisation, Admin and request key. Trusted code stores the exact
bytes as configuration evidence (a content-addressed S3 object
`methodology-proposal-…` per organisation and document digest, pinned version,
independent read-back; no Task), records a `disclosure` fact (document
digest, profile and revision, model, Admin) before anything is sent, and asks a
trusted-qualified profile with strict structured output for a draft in the
21.2 editor shape. Every kept field cites an exact quote that trusted code
found in the document (byte range and line). A quote must be at least 12 bytes
or three words and occur exactly once; a value whose quote is not found, is too
short or is ambiguous is left out and listed as unverified, as are values over
a field's limit, a requirement whose label is not found is
not kept, and missing criteria are computed by trusted code. Interpretation
conflicts are kept only with a found quote. A `result` fact records `drafted`
or a closed failure code; a provider failure never fabricates a proposal, and a
draft too large for its record is stored as `proposal_too_large`. The draft
runs detached from the request: a POST waits about 10 seconds, then answers
`in_progress` while the disclosure is within its 600-second send window; a
disclosure without a result after that is `uncertain`. Neither is ever sent
again under the same key, and an exact retry is answered from the recorded
fact before any object store or transport is needed. Drafts and reads have
separate concurrency limits. **A verified quote proves only that the cited
source text exists in the document, not that the proposed value is correct:
the Admin reviews every value before Save.** The proposal carries `imported_proposal` attribution; the
"Draft from a methodology document" panel shows each value with its cited
line and quote, the missing criteria and the conflicts, and "Review in editor"
opens it as a new methodology. Nothing takes effect until the Admin's existing
validated Save. Production composes no proposal transport, so the endpoint
answers `proposal_model_unavailable` until an owner-approved live
qualification exists. PDF and other formats are refused, not guessed: they need
the sandboxed document extraction path, which is not composed for this
configuration path.

New tables: `task_skill_uses`, `task_method_fetches`, `task_method_notes`,
`task_investigation_notes`, `methodology_proposals`. All are immutable
(`investigation_immutable`) under forced RLS with SELECT/INSERT runtime grants;
`investigation_guard` binds each Task fact to its own answer invocation,
binding and epoch, and a proposal result to its disclosure.

Verification (offline; synthetic loopback provider only, no live call):

```bash
cd zobba
cargo test -p zobba-domain investigation citation context
cargo test -p zobba-application investigation proposal
cargo test -p zobba-worker --test investigation -- --test-threads=1   # guarded _test DB + Docker
cargo test -p zobba-api --test methodology_proposal -- --test-threads=1
pnpm --dir web check
pnpm --dir web exec playwright test tests/browser/investigation.spec.ts
```

The worker test runs the production coordinator with the reading and
investigation composition, a native OpenAI loopback provider, S3-protocol
originals and the pinned general image across five turns: outline and listing
only; part fetches, a load, a resource fetch and a script job; agent and
platform gaps, a question and a cited statement; a skill disabled and an
`active_tasks` Save mid-cycle (new binding, earlier facts unchanged, stale
content not resent); and a Guide that answers the question. Its exact API JSON
is `web/tests/fixtures/task-investigation.json`
(`ZOBBA_UPDATE_INVESTIGATION_FIXTURE=1` rewrites it). The API test proves the
proposal path over real HTTP, PostgreSQL and S3 protocol: Admin-only access,
refusal of other formats and of the production composition before any record,
disclosure before result, custody bytes, exact locations, retry without resend,
key conflict, a recorded provider failure, Save as the only effect, and the
database guards. Its JSON is `web/tests/fixtures/methodology-proposal.json`
(`ZOBBA_UPDATE_PROPOSAL_FIXTURE=1`). The browser spec shows both recorded
JSON documents in the real work panel and Admin review screen (keyboard citation
chip, "Review in editor" with no saved version) and checks that the composed
API refuses a proposal without a transport. Changing schema 17 requires regenerating
`crates/infrastructure/src/schema-v17.catalog` from a migrated disposable
database.

## Assessment basis: typed criteria, facts and evaluations (Story 24.1)

Schema 18 is additive; published migrations and catalogues 1–17 are unchanged.
The agent still reads and acts natively. When it is ready to assess, it uses
five optional answer fields (`propose_criteria`, `propose_basis`,
`record_facts`, `evaluate`, `judgments`). The schema adds them only when the
worker composes assessment, so the investigation schema and every older stored
answer keep their bytes. Trusted code records only what it can re-check:

- **Criterion versions** (`assessment_criteria`): assertion, authority (the
  bound method criterion, checked against the current binding, or a registered
  original `{locator, quote}` checked by the 22.5 verifier), effective period,
  applicability test, required facts with types and units or ISO 4217
  currency, and either one closed rule predicate or a judgment rubric. An
  unverified authority is recorded with its reason and can never yield
  `met` or `not_met`. A change is a new version that supersedes the old one.
- **Basis versions** (`assessment_bases`, `assessment_basis_criteria`):
  objective, pinned criterion versions in order, business period and optional
  as-of instant, binding ID and execution epoch, population references to
  registered originals with their digests, and limitations.
- **Facts** (`assessment_facts`, `assessment_fact_sources`): an exact subject
  (leading zeros kept), a typed value (identifier, text, boolean, enum, exact
  decimal as an `i128` mantissa and scale, civil date, or UTC instant with its
  source offset) or `unavailable`/`ambiguous`, and its quoted sources. Each
  quote is verified at its exact location and re-parsed under the declared
  closed rule; a value the source does not show is `unsupported{type_mismatch}`.
  The quote must be the whole value at its location, not part of a longer
  one (`2,500.00` inside `12,500.00`, `No` inside `Notarised`): for a byte
  range trusted code reads two characters on each side; otherwise it is
  `unsupported{partial_value}`. The subject and a decimal's currency or unit
  are **grounded** only when the source shows them beside the value: as whole
  tokens in the value's located text, in a wider byte range that contains it,
  or as the exact quote of another cell in the same spreadsheet row. An
  ungrounded subject or measure is only the agent's claim: any evaluation that
  reads it is `undetermined` (`subject_unverified`, `unit_unverified`), so a EUR
  amount labelled USD never yields `met` or `not_met`. A fact that names a 22.4
  job is recorded only once the job has ended: `unsupported{analysis_failed}`
  when it ended without completing; while it is still running nothing is
  recorded and the agent is told to record it again. A basis holds at most
  1,024 facts, enforced when a fact is written. No floats; no currency or
  time-zone conversion; RFC 3339 `-00:00` (offset unknown) is refused.
- **Evaluations** (`assessment_evaluations`): applicability, execution,
  verdict and origin are separate fields, with a closed reason and the input
  fact IDs and digests. Rule criteria are decided only by the pure
  `domain::assessment::evaluate`; the same inputs give the same output digest.
  Missing, unavailable, ambiguous or unsupported input is `undetermined`, a
  failed analysis is `execution failed` with no verdict, and only an applicable
  evaluation on supported, grounded facts can be `not_met`. The checks run in
  order: an unverified authority decides nothing (not even "does not apply");
  a criterion version not in effect for the basis period or a consulted
  fact's stated effective date does not apply; an undecidable applicability
  keeps its real cause; then a failed analysis fails the execution. Already
  evaluated subjects are set aside before the 64-subject request bound. A
  judgment criterion records the model's verdict, supporting and contrary
  facts, rationale and uncertainty as a `model_proposal`; a judgment that
  cites no facts is `undetermined{missing_fact}`. A database refusal of a
  proposal becomes feedback, never a failed cycle. There is no numeric
  confidence anywhere.

A rule's operator, threshold and fact names are proposed by the agent. The
platform evaluates the rule and verifies the cited authority text, but does
not prove that the rule follows from that text; the panel says "Platform
evaluated the rule Zobba proposed". What became of an answer's proposals
returns to the agent inside the untrusted-content envelope, never as
platform text. The work read withholds a fact's value (and quote) from a
viewer who cannot open any of its originals now.

All six tables refuse UPDATE, DELETE and TRUNCATE, including for the owner;
only an explicit `zobba.disposable_fixture_reset=on` session in a `*_test`
database may clear them. Row guards and deferred checks tie each record to its
own answer invocation, binding and epoch, keep references inside one Task, and
refuse a decided verdict on unsupported facts or an unverified authority. The
Task work read adds an `assessment` section (or `assessment_unavailable`), and
the work panel shows it read-only with the four evaluation words separate.

What is proven offline: the worker suite drives the real coordinator with a
loopback OpenAI-format model, real PostgreSQL custody, S3-protocol originals
(`fixtures/documents/AP invoices.xlsx`, `AP policy.txt`) verified cell by cell
in the test-only Docker sandbox, a failing and a completing analysis job, a
partial quote, a quote not at its location and a EUR amount labelled USD. It
forges rows to check each insert guard, immutability (including under the
fixture reset and for the migration owner) and the 1,024-fact bound by its
own message. `crates/infrastructure/tests/published.rs` pins the bytes of
migrations 0001–0017 and catalogues v1–v17. No live provider is called.

```sh
cargo test -p zobba-domain assessment
cargo test -p zobba-application assessment
cargo test -p zobba-worker --test assessment --locked -- --test-threads=1   # guarded _test DB, OIDC fixture, Docker
ZOBBA_UPDATE_ASSESSMENT_FIXTURE=1 cargo test -p zobba-worker --test assessment --locked -- --test-threads=1   # rewrites web/tests/fixtures/task-assessment.json
pnpm --dir web exec playwright test tests/browser/assessment.spec.ts
```

## Exact population, sample and coverage counts (Story 24.2)

Schema 19 is additive; migrations 0001–0018 and catalogues v1–v18 are
unchanged (`published.rs` now pins 0018 and v18 too). The agent still decides
what to read and how to scope the work; it never counts. Four more optional
answer fields name *where* and *how*, and trusted code does the counting:

- `propose_population` (≤1): a registered original, sheet and 1-based header
  row (workbook) or the whole CSV/plain text, a grain of 1–3 columns (the key
  is the exact cell texts, leading zeros kept), an optional period column and
  rule, up to 8 typed value columns (with a currency/unit column), whether the
  source is exhaustive, and an optional control count cited at its exact
  location. The trusted document program's new `enumerate` mode reads the
  header row and every row to the sheet's last row in the 22.4 sandbox
  (bounds: 20,000 rows, 12 columns, 256 bytes a cell); CSV is read in process
  (RFC 4180, UTF-8). A header that does not match exactly, a missing sheet, or
  a failed or limited read records nothing and is fed back in words, with the
  job ID.
- Each received row becomes one immutable **member** with one disposition:
  `in_scope`, `excluded{out_of_period}`, `scope_unknown{period_unparsed |
  period_missing | conflicting_duplicate}`, `duplicate_row{first}` or
  `unkeyed`. **Completeness** is derived, never asserted: complete only when the
  agent said the source is exhaustive, nothing was truncated, every row to the
  end was read and a cited control count (if any) equals the distinct
  subjects; otherwise `incomplete{not_exhaustive | row_bound | count_mismatch}`.
- `evaluate_population` (≤4): every rule criterion is decided for every
  in-scope member by the 24.1 pure `evaluate`, from the member's own cells (the
  enumeration read is itself the trusted read of the exact original); a
  currency is grounded only by a currency column in the same row. Judgment
  criteria are not bulk-evaluated: they use the newest 24.1 judgment at the
  population's subject unit, else `not_evaluated`.
- `propose_sample` (≤1): `all_in_scope`, `judgmental` or `seeded_random{seed,
  splitmix64-fisher-yates-v1}`. Trusted code checks every key is in scope and
  recomputes a seeded selection (in-house SplitMix64, no crate). There is no
  statistical inference: a sample summary covers the selected items only.
- `summarise` (≤2): the pure `domain::coverage::summarise` (aggregation rule
  `subject_partition_v1`, canonical digest) gives exact counts of rows,
  subjects, exclusions and scope by reason, per criterion (applicable, not
  applicable, unknown; met, not met, undetermined by reason, failed, not
  evaluated), the subject partition (failing, meets every applicable,
  unresolved, not applicable to any) and failing *opportunities* — two
  separately named numbers — and one closed conclusion. Never "no exception
  found" on an incomplete population, a sample, zero applicable subjects,
  scope-unknown subjects, rows with no usable key, or a met that is an
  unreviewed model proposal (a 24.1 judgment nobody has reviewed: counted as
  `met_unreviewed` and said as the limitation `unreviewed_model_judgments`).
  Limitations are closed codes with exact counts, said in words.

The six tables (`assessment_populations`, `_population_members`, `_samples`,
`_sample_members`, `_opportunities`, `_summaries`) refuse UPDATE, DELETE and
TRUNCATE, including for the owner, except an explicit
`zobba.disposable_fixture_reset=on` session in a `*_test` database. The
summary guard recounts every count and the conclusion with exact SQL
aggregates over the stored members and opportunities and refuses any
disagreement by name. Members, selected items and opportunities are guarded
once per statement over its new rows. The work read adds bounded
`populations`, `samples` and `summaries` with exact totals; a members route
(`/tasks/{task}/assessment/populations/{id}/members?disposition=&cursor=`)
gives an exact count and 50-row pages C-ordered by key (a row with no key
first), then receipt order, withholding cell values and measures from a
viewer who cannot open the original now. A CSV record wider or narrower than
its header (for example an unquoted `1,250.00`) is refused, typed Excel dates
and date-times are read as dates (a date-time with no time zone is read as
UTC and counted), a zero-padded number keeps its leading zeros, and formatted
empty rows after the data are not rows. A reclaimed answer reuses its
collected population read. The Coverage panel
says every count in words with its unit, "at least N found" and "the total
is not known" when incomplete, and shows no percentages.

What is proven offline: the worker suite drives the real coordinator with a
loopback model over `fixtures/documents/AP population.xlsx` (1,256 rows, 6
duplicate rows, 50 outside the period; criteria A and B: 15 and 12 not met, 7
failing both): the AC1/AC2 numbers in `AP population expected.json`
(independently computed by `generate.py`), a zero-applicable sheet, a
filtered export, a seeded sample of 25 (its conclusion recounted from its
selected subjects), a count mismatch (1,251 cited, 1,250 found), a header
mismatch, the Edge sheet (a conflicting duplicate, an unparsed and a blank
date, an unkeyed row: inconclusive), the Dated sheet of typed Excel cells
(the one complete "no exception found", and an all-in-scope sample that
concludes nothing about the population) and the Lines sheet (an invoice-line
grain). It forges every summary count, every per-criterion field and each
conclusion branch to check the recount guard by its message; refuses one bad
row in multi-row copies for every batch guard, as the administrator and as
the migration owner under the runtime's scope, and the deferred member and
selected-item counts at commit; refuses an altered document program; checks
route-level withholding, another Task's population (403), a changed session
(412) and a revoked assignment; and checks immutability for each table. No
live provider is called.

```sh
cargo test -p zobba-domain coverage
python3 -I -B crates/application/src/reading/test_document.py
cargo test -p zobba-worker --test coverage --locked -- --test-threads=1   # guarded _test DB, OIDC fixture, Docker
ZOBBA_UPDATE_COVERAGE_FIXTURE=1 cargo test -p zobba-worker --test coverage --locked -- --test-threads=1   # rewrites web/tests/fixtures/task-coverage.json
pnpm --dir web exec playwright test tests/browser/coverage.spec.ts
```

## Revising evaluations without overwriting facts (Story 24.3a)

Schema 20 is additive; migrations 0001–0019 and catalogues v1–v19 are
unchanged (`published.rs` now pins 0019 and v19 too). Story 24.3b
(exception occurrences and the effective summary) adds migration 0021.
Three layers never overwrite each other: **facts** (what a source showed),
**revisions** (what trusted code or the model concluded from a pinned set of
facts) and **dispositions** (what a person decided about one exact revision).

- **Revision chains.** A chain is one Task, basis lineage, criterion lineage
  and subject. Revision 1 is the 24.1 evaluation; every later one is an
  immutable `assessment_evaluation_revisions` row naming exactly the revision
  before it (one successor per head). When the agent asks `evaluate` or
  `judgments` again, trusted code finds the current head, derives the closed
  causes (`inputs_changed`, `criterion_revised`, `basis_revised`,
  `prior_execution_failed`, `reconsideration_requested`) and the fact IDs
  added, removed and replaced by name, and appends a revision. When nothing
  changed, nothing is recorded and the feedback says so; a different judgment
  with no cause is refused as feedback. The model never chooses a predecessor,
  a cause or a disposition. The subject unit is not part of the chain identity
  because 24.1 evaluations do not record it (a documented deviation). A basis
  or criterion version has at most one successor and at most 64 earlier
  versions (refused as feedback when proposed, and by the guard), so every
  lineage walk reaches its root and a chain never forks. Data recorded before
  24.3a may hold two revision-1 evaluations of one subject in a lineage (24.1
  re-evaluated under a successor basis): the newest continues the chain; the
  older stays closed and inspectable — never an error.
- **Carried facts.** To correct a fact, the agent proposes a successor basis
  (`supersedes`), lists it in `carry_facts` (≤1) with the (subject, name)
  pairs to leave out, and records the corrected facts there. Every other
  effective fact of the predecessor is carried **by reference** with its
  original verification (`assessment_basis_carries`,
  `_basis_carried_facts`); the 1,024-fact bound counts carried facts. A
  refused carry stops that successor's evaluation in the same answer (it
  would read only its own facts). `evaluate_population` reads chain heads with
  effective facts; a subject whose judgment was revised is counted as not
  evaluated there (24.3b's effective summary counts its current verdict),
  never with its superseded first verdict.
- **Dispositions.** An assigned Auditor or Audit manager (Admin alone is
  refused) posts `accepted`, `replaced` (a model judgment only; a rule verdict
  is never replaced — `400 not_replaceable`) or `needs_reconsideration`
  (concern `facts | rule | authority | scope`) to
  `POST /tasks/{task}/assessment/revisions/{revision}/dispositions` (a
  person's met or not_met only on an applicable, completed judgment under a
  verified authority — `400 verdict_not_decidable`), with a
  rationale of 1–2,000 UTF-8 bytes and ≤8 evidence references. Each reference
  is verified at save against the exact original the person can open now (a
  plain-text byte range from its bytes; a cell, paragraph or email part
  against a quote trusted code already verified there; a page alone never; a
  quote that is only part of the value there never — the 24.1 whole-value
  rule); one
  unverified reference refuses the whole request (`409 reference_unverified`
  with its index). A key is idempotent per actor: an exact retry returns the
  original only after the session, role and assignment are checked again (a
  revoked actor gets 403), a changed one is `409 disposition_conflict`. The
  guard itself requires the person's own live session (the API sets its hash
  for the write transaction only), so a worker connection cannot save one, and
  an unset scope is a refusal. A disposition on a
  superseded revision is `409 revision_superseded` naming the head. The
  revision row is never changed. `needs_reconsideration` wakes the Task (a
  Task waiting for direction resumes with its own `observed` Task event; a
  paused or stopped one stays so) and the person's concern and words reach the
  model in their own `assessment-reconsiderations` message (class
  `person-input`, attributed to the person, never model output), bounded to
  the newest 8 with the exact count of the rest, separate from the outline so
  its budget can never drop one. Each is a line starting with the structured
  marker `- reconsideration <disposition> of <head> (`; every other text there
  is a JSON-escaped string, so no rationale, document or answer can forge one.
  A reconsideration causes a revision only when the answering turn's request
  listed that exact disposition there (Rust and the database check that one
  message of the stored request), so a replayed earlier answer never answers
  it; a listed one the model was shown never asks for further turns.
- **Reads.** The work read adds each evaluation's `chain` head with its causes,
  newest disposition, the effective verdict and origin (`human` only after
  `replaced`) and a derived review state (`unreviewed`, `accepted`,
  `replaced`, `pending_reconsideration`). The history route
  (`/tasks/{task}/assessment/chains/{chain}/history?cursor=`) lists 50
  revisions a page in revision order with an exact total, the facts they read
  and their dispositions, withholding quotes from a viewer who cannot open the
  original now. The panel shows the causes in words, the history by keyboard
  and a disposition form with a byte counter and verified-source chips; there
  is no confidence score anywhere.

The four tables refuse UPDATE, DELETE and TRUNCATE, including for the owner;
only an explicit `zobba.disposable_fixture_reset=on` session in a `*_test`
database may delete. Guards refuse a revision that does not succeed the
current head, states causes or changes other than the derived ones, reads an
older basis or criterion version than its head, or reads facts that are not
effective; a first evaluation of a subject already evaluated in the lineage;
a disposition by someone not currently assigned, on a non-head, replacing a
rule verdict, beyond 16 per revision, or with an unverified reference; and a
carry that is not exactly its stated facts (checked once per statement).

What is proven offline: the worker suite drives the real coordinator with a
loopback model over `fixtures/documents/AP invoices.xlsx` and `AP policy.txt`:
late evidence on the same basis (revision 2, `inputs_changed`, the approver
added), an unchanged re-evaluation that records nothing, the real API saving a
replaced judgment with a verified policy quote (the evaluation row unchanged),
its exact and changed retries, a rule verdict refused, a superseded revision
refused naming the head, one unverified reference refusing the request, Admin
alone and a revoked assignment refused, then a reconsideration that wakes the
Task and reaches the model as quoted data, answered by a successor basis that
carries the approver by reference and records the corrected amount (revision
3: `inputs_changed`, `basis_revised`, `reconsideration_requested`; the amount
replaced). It checks the history route (pages, cursor, a changed session 412,
another chain 403, Admin 403) and the forged-record guards by their messages,
including a two-row carried-fact insert with exactly one bad row. Review round
1 adds: the resume event; the person-input message and its marker; a
disposition racing a revision (it waits on the chain lock and is refused
naming the new head) and two concurrent revisions of one head (one
successor); a paused Task that stays paused, then one turn that shows the
request and no loop; the 16-disposition cap; a replay after revocation, an
Admin with an assignment and another Task's chain refused; and database
forgeries that each break one rule beside an accepted control (owner UPDATE
and DELETE with forced RLS lifted, carries TRUNCATE alone, RLS under two
engagements, changes three ways, each cause omitted, a false
`prior_execution_failed`, an unshown reconsideration, excepted and shadowed
inputs, older versions, a restarted chain, dispositions without scope or
session, four unverified references, and the 1,024 own+carried bound). No live
provider is called.

```sh
cargo test -p zobba-domain revision
cargo test -p zobba-worker --test revision --locked -- --test-threads=1   # guarded _test DB, OIDC fixture, Docker
ZOBBA_UPDATE_REVISION_FIXTURE=1 cargo test -p zobba-worker --test revision --locked -- --test-threads=1   # rewrites web/tests/fixtures/task-revision.json
pnpm --dir web exec playwright test tests/browser/revision.spec.ts
```

## Task-scoped exceptions and the effective summary (Story 24.3b)

Schema 21 is additive; migrations 0001–0020 and catalogues v1–v20 are
unchanged (`published.rs` pins 0020 and v20 too).

- **Exceptions and occurrences.** An exception is one Task, criterion lineage
  (its first version's ID) and subject (the subject unit is not part of it: 24.1
  evaluations record none — the same documented deviation as 24.3a chains).
  Every not_met result — a 24.1 evaluation, a revision, a rule opportunity, or
  a person's `replaced` not_met — adds an immutable occurrence, written by the
  database (`exception_record`) in the statement that records the result,
  set-based over the statement's rows; the first creates the exception. A
  judgment's population opportunity names a recorded judgment (itself an
  occurrence) and adds none, so re-reading an old judgment over a new
  population version never adds an occurrence. Occurrences and exception
  dispositions of one Task take one Task lock and a place (`seq`) in their
  exception's order, never ordered by clock time. A Task holds at most 20,000
  exceptions; the next write is refused and the agent is told (never a failed
  cycle). Migration 0021 backfills every published not_met result exactly as
  the writer would (the worker proof deletes every exception record under the
  fixture reset, runs the migration's own backfill block and gets the same rows
  and order back). A direct insert that differs in any column from what the
  writer derives is refused by statement-level guards (the writer's own rows,
  inserted inside its trigger, are not derived twice); the four tables refuse
  UPDATE, DELETE and TRUNCATE even for the owner, except DELETE/TRUNCATE under
  the explicit reset in a `*_test` database. A population version has at most
  one successor and 64 earlier versions.
- **Derived status, never stored.** On every read the database derives every
  status set-based (`assessment_exception_statuses`) from the exception's
  occurrences, its dispositions and its current observations
  (`assessment_exception_observations`: every chain head of its lineage and
  subject at the head's own record time, a person's `replaced` verdict at its
  own time; each decided rule opportunity of the latest version of a population
  lineage; `absent` when that version no longer holds the subject), and trusted
  Rust code derives the same status for every listed exception and refuses a
  disagreement:
  `closed_by_disposition` (newest disposition is a closure and no later
  occurrence reads evidence the closer did not see), else `open` while any
  current observation is not_met, else `replaced_by_human_judgment` (the
  latest observation is a person's `met`), else `resolved_by_evidence` (the
  latest is a completed `met` — deterministic, or a model proposal a person
  accepted — newer than the newest occurrence, on different evidence, from a
  revision caused by changed inputs or a revised basis, or a later read of the
  same criterion version), else `open`. Owner decisions 2026-10-21: an
  unreviewed model proposal of `met` keeps the exception open ("a model
  proposal suggests this is met; awaiting human review"), and a person's
  `replaced undetermined` keeps it open ("a person marked this undetermined;
  this is not evidence of remediation"). Any other open exception the latest
  observation does not show failing says "not observed in the latest
  revision; this is not evidence of remediation".
- **Exception dispositions.** Only a currently assigned Auditor or Audit
  manager in their own session who is also an Audit manager of the
  organisation or the Task's accountable person may `POST
  /tasks/{task}/assessment/exceptions/{exception}/dispositions` with `closed`
  (≥1 evidence reference, each verified at save like a 24.3a disposition) or
  `reopened` (a closed exception only); anyone else assigned gets `403
  exception_close_forbidden`. There are no waivers. A closure never changes an
  occurrence, a revision or a verdict, and never lowers a failing count. Keys
  are idempotent per actor; an exact replay is answered only after session,
  assignment and closing authority are checked again. Concurrent closures of
  one exception serialise on the Task's exception lock; the second is
  refused. At most 16 per exception.
- **Effective summary.** The agent asks `summarise_effective` (≤2 per answer)
  for a population (and optionally a sample). Trusted code reruns the 24.2
  partition over each opportunity's effective outcome (a judgment opportunity
  resolves to its chain head under the head's newest disposition) with the
  24.2 denominators and "at least"/"total not known" wording, counts per
  criterion the person's replaced verdicts, pending reconsiderations,
  undisposed model proposals and superseded inputs, counts the exceptions of
  the summary's own subjects (in scope, or the sample's selected items) by
  derived status and distinct subjects (the first 50 listed), and states
  closed limitations in words. While an exception of those subjects is open,
  the effective conclusion is never "no exception found" (it is
  `inconclusive`, and the `open_exceptions` limitation says why). The database
  recounts every number with exact SQL (`effective_guard`), including the
  coverage limitations, and refuses a summary that disagrees; the model then
  gets feedback to ask again, never a failed cycle. An unchanged result
  records nothing. Each version supersedes the newest effective summary of the
  same population and sample.
- **Reads.** `GET /tasks/{task}/assessment/exceptions?cursor=` lists one page
  (50) of the exceptions with their status, the exact counts over every one of
  them, `next_cursor`, whether the viewer may close one and the newest
  effective summaries; `GET .../exceptions/{exception}?cursor=` pages its
  occurrences (50, in their order) with every disposition. Admin alone and
  people of another engagement read nothing (403); an unknown exception is
  404. The work panel pages them and lets the accountable person or an Audit
  manager close or reopen by keyboard.
- **Scale.** A population at the 20,000-row ceiling whose rule fails 19,000
  times records, summarises and lists within bounds in the worker proof
  (cycle about 75 s, list 1.7 s, detail 0.2 s). Runtime connections set
  `jit=off` (forced row-level policies inflate estimates past JIT's
  thresholds; a 19,000-exception status read took 24 s with it, 0.7 s
  without). Statement guards and the status functions plan hash joins. The
  Task lease renewal locks only the Task row (`FOR NO KEY UPDATE`), so a
  cycle's own long write no longer starves its lease. Bulk opportunity and
  effective-summary writes run under a bounded 60 s statement limit; a write
  past it is recorded feedback.

Proven offline by `crates/worker/tests/exception.rs` (real worker, loopback
model, real PostgreSQL, real API): occurrences of evaluations, revisions, a
person's replaced not_met and rule opportunities; resolution by an accepted
proposal; an unreviewed met proposal and a person's undetermined kept open; a
closure reopened by unseen evidence and one standing over the same evidence; a
new population version adding no occurrence; the database recount; every
disposition-guard branch; per-column occurrence forgeries and per-field
effective-summary forgeries refused; a Rust/SQL decision parity table;
immutability, RLS, a pid-correlated lock race, the backfill and the
20,000-row scale proof. The SQL `absent` and rule-opportunity observation
paths are proven by the parity table's decision rule, not yet by a worker
scenario with a population version that drops a subject.

## Work products with checked claims (Story 24.4)

Schema 22 is additive; migrations 0001–0021 and catalogues v1–v21 are
unchanged (`published.rs` pins 0021 and v21 too). Review round 1 (schema 24)
is described at the end of this section.

- **The agent drafts; trusted code checks.** An answer may carry one
  `draft_work_product` (a new product or a successor of the latest version) on
  a template of the Task's *current* method binding (the built-in neutral
  starter is allowed and always labelled "Neutral starter (not firm
  methodology)"; any other template is `template_unbound`). Blocks are
  headings, narrative (`narrative` or `judgment`, shown "Zobba's judgment —
  not checked against records"), claims (a sentence plus 1–8 assertions) and
  platform blocks the agent only places (`coverage`, `exceptions`,
  `limitations`; trusted code writes their lines). Each assertion pins a
  record of the same Task and the value it states: an evaluation's effective
  outcome on its current chain head, a summary's exact count or conclusion, an
  exception's derived status, a fact's supported canonical value, a quote
  verified now at its location (whole value, no page-only), or a basis period.
  Every figure in a claim sentence must be one of its asserted values
  (`statement_figures_v1`); narrative may state no figure except closed
  identifier tokens (`A1`, `ISA 315`, `FY2025`); a claim resting only on quotes
  may state no verdict word. A version is recorded only when every check
  passes; otherwise nothing is recorded and per-block feedback (closed reasons
  such as `count_mismatch`, `unsupported_figure`, `superseded_support`,
  `human_block_dropped`) goes back inside the untrusted-content envelope —
  never a failed cycle. The agent keeps earlier blocks by ID and may not change
  or drop a person's block. There is no confidence score and no percentage.
- **Immutable versions; currency derived on read.** `work_products`,
  `work_product_versions`, `work_product_blocks`, `work_product_assertions` and
  `work_product_exports` refuse UPDATE, DELETE and TRUNCATE even for the owner
  (DELETE/TRUNCATE only under the explicit reset in a `*_test` database). The
  database recomputes every assertion against its record in SQL, takes the
  base as the head under a per-product lock (one successor per head; any other
  base is `stale_base` naming the head) and checks kept blocks byte-equal.
  A claim is current or needs refresh with closed reasons
  (`evaluation_revised`, `disposition_changed`, `summary_superseded`,
  `exception_status_changed`, `fact_superseded`, `source_withdrawn`) derived on
  every read; a quote the viewer may not read now is withheld for that viewer,
  never stale. The limitations block lists every cited summary's and basis's
  limitations, exception "not evidence of remediation" sentences, required
  sections not completed and claims needing refresh, in claim order — all from
  records.
- **People edit by new versions.** `POST /tasks/{task}/work-products/{product}/versions`
  (Origin, CSRF, expected actor, session-bound key): a currently assigned
  Auditor or Audit manager (Admin alone is 403) keeps blocks by ID in a new
  order, removes blocks and edits headings, narrative and claim sentences (a
  claim keeps its assertions; its sentence is checked again). The same checks
  refuse with 409 and the same reasons. New assertions come only from the agent.
- **Shelf, inspection and export.** `GET /work-products` and
  `GET /tasks/{task}/work-products` page 50 by ID with an exact total: title,
  kind, version, review state **Draft**, claims needing refresh and required
  sections not completed. `GET .../versions/{version}` shows a version by
  template section (a newer version is announced, never swapped in);
  `GET .../claims/{block}/support` shows each pinned record as the platform
  states it now. `POST .../versions/{version}/exports` renders that exact
  version in process (`zobba-export-v1`: an in-house stored ZIP with CRC-32 and
  minimal OOXML, no new crate) as DOCX or XLSX: source revision and digest on
  the first page and in the footer, page numbers, every template section
  ("Not completed in this version."), numbered claims linked to a Citations
  appendix, "Needs refresh: …" marks, coverage, limitations and "Review state:
  Draft — not reviewed". XLSX text cells are inline strings, never formulas;
  one `SUM` carries its cached total. The same version, format and withheld set
  give identical bytes, stored in the evidence object store; the download
  checks size and digest again and is refused (`409 export_scope_changed`) to
  a viewer whose withheld set differs. No PDF yet. The Task panel shows the
  shelf, the document, claim → support → Back to claim and claim → citation →
  evidence → back with keyboard focus restored, a structured editor with byte
  counters, and DOCX/XLSX downloads checked against their digest.

Proven offline by `crates/worker/tests/work_product.rs` (real worker, loopback
model, real PostgreSQL, real API): a firm working paper recorded with every
claim agreeing, each refusal reason with nothing recorded, the API shelf,
version, support, edit, stale base, Admin refusal and exports, AC3 refresh
after a revision, a disposition and a superseding summary (version 1's digest
unchanged), a refreshed successor, an agent dropping a person's block, a
24-claim scale version (twenty of four counts each), and forged and altered database rows
refused; by
`work_product_office.rs`, which checks the committed fixture DOCX and XLSX
(`fixtures/exports/`) are the writer's exact bytes and opens them in
LibreOffice headless (text, PDF and HTML conversion); and by the web unit and
browser suites over the JSON the worker suite records.

### Review round 1 (schema 24)

Migration 0024 (catalogue v24) is additive; 0001–0023 and v1–v23 are
unchanged (`published.rs` pins 0023 and v23 too). Versions recorded before it
keep rule `statement_figures_v1` and renderer `zobba-export-v1`.

- **Figures and words (`statement_figures_v2`).** Every Unicode numeric
  character, number words ("fourteen", "a dozen"), Roman numerals and dates in
  their written forms count as figures; a pure-number record subject resolves
  only in its own claim, after a word ("Invoice 000123"); the title is checked
  too; a character that changes display without being seen (bidirectional
  controls, zero-width characters) is refused (`hidden_character`). A claim's
  verdict words must agree with the outcome, conclusion, status or count its
  own assertions hold. A heading alone completes no required section.
- **A bad quote never fails a cycle**: a malformed, unknown or unreadable
  quote is a per-block refusal like any other.
- **Withholding.** A fact none of whose verified sources the viewer may read
  is withheld like a quote, and so is the sentence of a claim that restates a
  withheld record (web, API and exports); the withheld set covers both.
- **Currency.** Coverage and exceptions blocks on a superseded summary or
  basis, or whose exception counts changed, say they need refresh; a quote
  whose original a replacement source corrects is `source_withdrawn`; a period
  whose basis a successor supersedes is `basis_superseded`; an acceptance alone
  is not a disposition change. Claims are numbered in template section order.
- **A person's blocks, at their request only.** The agent may change or
  remove a person's block only when that person asked in a Guide request the
  draft names (`request`): it records a proposal (`work_product_proposals`)
  shown to that person as before and after, and the version is recorded only
  when the same person confirms it
  (`POST .../proposals/{proposal}/decision`), "changed by the agent at
  <person>'s request" with the request and confirmation IDs. The database
  refuses any other agent change of a person's block.
- **Frozen exports (`zobba-export-v2`).** A version freezes its people's names,
  each exceptions block's counts and the claims already needing refresh; its
  export shows exactly that, so the same version, format and withheld set give
  the same bytes, stored once under their content's object ID (read back and
  checked before they are recorded). Export IDs are engagement-scoped. The XLSX
  says whether each count is exact or "at least".
- **Nothing is added to a recorded version.** Every block and assertion is
  checked against its version's document when it is written, so an altered
  row of a kept claim, or a block or assertion added to a recorded version
  later, is refused at once (the record check covers blocks written in the
  version; a kept claim equals its predecessor's).

## Establishing an engagement conversationally (Story 22.2 AC4)

Schema 13 is additive; published migrations and catalogues 1–12 are unchanged.
`engagements` gains nullable `period_start`/`period_end` (both or neither, start
≤ end); existing engagements keep an unknown (NULL) period. New
`engagement_setups` and `engagement_setup_messages` are organisation-level, forced
RLS limited to their own actor while that actor holds a current auditor or audit
manager membership. Runtime has SELECT/INSERT on both and narrow column UPDATE on
setups; it still has no INSERT on clients, engagements or assignments.

Every setup route first calls the owner-mediated `engagement_setup_access`: the
exact session, an active identity and an active, unexpired auditor or audit manager
membership. Writers take organisation advisory lock 205 before that check, so
revocation, expiry and role changes are decided under the lock. Lost access is 403
`access_denied`; a CSRF, origin or expected-actor fence is 403
`engagement_setup_request_rejected`; an unknown or another actor's setup is 404
`engagement_setup_not_found`. Reads and writes use separate bounded permits.

A member with a current audit role types a first objective at organisation level
(`POST /organisations/{org}/engagement-setups`). Each member message is committed
before it is interpreted, and a read (`GET` of one setup or the open list) answers
any committed member message that has no reply yet; after a setup closes, such a
message gets the fixed "setup closed" refusal. Interpretation is deterministic and
server-side (no model): Zobba asks for the client, then the audit period, then
shows one summary. A client matches on its exact name, otherwise under
context-independent Unicode simple case folding (`engagement_setup_clients`
returns a bounded superset; the application decides equality). Two or more
matches become a pick list; typing another name there searches again. No match
proposes "Create client X?", created only after explicit acceptance. The period
accepts only explicit ISO dates (`YYYY-MM-DD to YYYY-MM-DD` or
`YYYY-MM-DD/YYYY-MM-DD`) with start ≤ end. From the summary, `change_client` and
`change_period` return to that question (a known period is kept). The summary says
when this client already has an engagement for exactly this period; confirming is
still allowed and the new engagement name gets a ` (2)`-style suffix. Refusals are
retained Zobba turns. A setup holds at most 200 messages; an answer that would not
leave room for its reply and a final cancellation is 409
`engagement_setup_message_limit` before anything is written.

`POST .../{id}/confirm` first retains the confirmation, then establishes in a
second transaction. A new client is created only if no client now matches it
exactly or folded, decided under lock 205; otherwise the setup returns to the pick
list. A chosen client that no longer exists returns the setup to the client
question. The owner-mediated `engagement_establish` rechecks authority, enforces
the daily limit (passed in from the application), creates the client (when new),
the engagement with its period and the creator's assignment, records an
`establish_engagement` entry in `membership_events`, and rechecks authority again.
The same transaction then runs the ordinary Task Create admission; any failure
rolls back every row. Only the creator is assigned. A confirmation that is refused
after it was retained (lost access, daily limit, a changed setup, a failed
establishment) is answered by a retained refusal turn; replaying that key repeats
the refusal (409 `engagement_setup_confirm_failed`, `engagement_setup_daily_limit`,
`engagement_setup_conflict`, or 403) and never establishes. A new confirmation
needs a new key. A confirmation whose establishment never finished (for example a
lost commit) has no answer yet, and replaying its key retries it safely. At most 8
setups may be open per actor and organisation; organisations are listed 50 per
page in C order with an explicit `more` flag and the server's limits. The web
keeps each setup request in its own durable outbox channel (keyed by actor and
organisation) before sending, offers an explicit "Send again" after reload, keeps a
draft per setup, and opens the new engagement conversation on success.
