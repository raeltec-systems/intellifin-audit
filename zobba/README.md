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
the last eligible Admin, and retain immutable attribution. Narrowing advances
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
schema 1–4 prefixes, or current schema 5. Physical catalog checks precede metadata
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
| `GET /health/ready` | 200, `status: "ready"`, `schema_version: 5` | 503, `status: "unavailable"`, `schema_version: null` |

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
