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
also allow explicit replacement in one transaction. The CLI sets migration
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
intent, step ordinal); each recorded step (model turn or tool step) is an
immutable fact written under the exact claim producer's custody. Tool proposals
pass `admit_tool` and current-Permissions consumption, then the owned gateway.
A cycle is bounded at 16 turns; a text-only turn leaves the Task `waiting`, which
is never a completed objective.

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
records and 64 KiB of text), read under the boundary's Task fence with the same
per-record checks as knowledge inspection. Each record is an exact `{id,
revision}` context entry and a `current` verification item, so `prepare`
re-verifies it at disclosure. Withdrawn, forgotten, excluded, corrected or
invalidated records are omitted and never disclosed; preference publications are
not context. The OS-level proof in `crates/worker/tests/work_process.rs`
re-executes the test binary as a worker process and SIGKILLs it mid-turn and
mid-tool, because the production binary deliberately composes no qualification
source and has no fixture flag.

Untargeted direction (`POST task-directions`, reserved control lane) is routed by
the server, never a model: exactly one non-stopped Task receives it as Guidance;
two or more produce one durable targeting question. An answer (`POST
task-questions/{id}/answer`) names one or more of its candidates; each receives a
Guide with key `route-` + SHA-256(question key, Task), so retries create no
duplicates, and stale or foreign Tasks refuse. `GET tasks/{id}/work` returns the
card projection (bound method, current work, next action with its proposing
invocation, attention, recent steps and brief revisions with applied boundary and
`superseded_by`). No route returns model text.
