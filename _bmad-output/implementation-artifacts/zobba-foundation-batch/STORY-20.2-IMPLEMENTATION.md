# Story 20.2 implementation checkpoint

30 September 2026. Canonical source:
[`spec-20-2-scoped-engagement-sign-in.md`](../spec-20-2-scoped-engagement-sign-in.md).
Implementation, post-review local gates and independent acceptance pass. All 18
consolidated BMAD findings are closed; root accepts the story for its checkpoint.
See [the review record](REVIEW-20.2.md) for independently reproduced evidence.
This report does not claim remote CI, deployment or customer SSO qualification.

## Delivered behavior

An actual OIDC authorization-code flow with S256 PKCE creates an opaque Rust
server session only after verified issuer, subject, signature, audience,
authorized-party, nonce and time claims. One-use browser-bound login attempts are
consumed before exchange. State, browser binding and session tokens are hashed in
PostgreSQL; provider tokens are discarded. Secure host-only cookies, exact Origin
and session-bound CSRF protect POST logout. Invalid callbacks preserve a current
session and unrelated current login binding; successful replacement rotates and
revokes its previous token. Expired
or inactive identities terminate sessions on the next request.

The Pair web interface shows current identity, assigned engagement choices and
explicit organisation/client/engagement scope. Admin-only and unassigned users
see no client work. Fifty-entry pages use complete composite cursors, authorize
each page again, and preserve explicit saved scopes independently of the page.
Changed roles, removed or expired assignments and dependency
failures withdraw protected content. Keyboard focus survives revalidation after
the replacement view commits, with a heading fallback when its old control has
disappeared. Sign-out intent survives automatic reads; retries perform sign-out
with fresh CSRF when needed, and 401 means already signed out. Native sign-in failures provide a fixed recovery
page; no Task, evidence, audit result or computer capability is fabricated.

Application checks and forced PostgreSQL RLS both use current membership and
assignment. Shared transactions retain one pooled connection and set actor/scope
locally. Composite references prevent mismatched ownership. The runtime has
narrow identity/session grants and actual scoped engagement-name UPDATE
permission, but cannot change activation, memberships, roles or assignments.

Explicit migration 0002 leaves 0001 unchanged. Fresh databases, verified 20.1
prefixes and repeat 20.2 migration succeed. Exact physical catalog contracts,
checksums, policies, grants and enabled FK trigger enforcement reject foreign,
altered and newer states before untrusted metadata reads or mutation. API and
worker startup remain read-only and independently useful.

The separate pinned HTTPS `oidc-provider` fixture has real password login,
code/PKCE and signed tokens. Generated keys, certificates and credentials are
ignored and private. Explicit local seeding supplies two organisations with
distinct clients/engagements, assigned auditors, a manager with combined roles,
Admin-only and unassigned identities. It requires deliberate loopback fixture
configuration, never runs at startup, and repeats without reactivating authority.
Rust TLS verification is always enabled. The app and IdP use distinct localhost
and 127.0.0.1 cookie hosts.

## Verification observed in this cloud instance

All commands ran in `zobba/` using Rust 1.98.1, Node 24.20.0, pnpm 11.25.0 and
PostgreSQL 18.4. Database suites used the guarded disposable test database
sequentially. No matrix row was skipped.

| Gate | Observed result |
| --- | --- |
| `cargo fmt --check` | Passed |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | Passed |
| `cargo test --workspace --locked` with actual HTTPS IdP running | 42 tests passed; 0 failed/ignored; includes 12 actual-provider tests and full PostgreSQL contracts |
| `cargo build --workspace --locked` | Passed |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm fixture:test` | 46 tests passed; 0 failed/skipped |
| `pnpm check` | Generated OpenAPI/TypeScript current, strict typecheck and 9 web tests passed |
| `pnpm build` | Passed |
| `python3 -B -m unittest discover -s scripts -p 'test_*.py'` | 47 guard regressions passed |
| `python3 scripts/check-boundaries.py` | Passed; six inward Rust crates, owned web and isolated IdP fixture |
| `python3 scripts/smoke.py` | Passed; explicit migration twice, startup refusal, secret-safe telemetry and same-process API/worker database-loss recovery retained |
| `ZOBBA_BROWSER_EXECUTABLE=/usr/bin/chromium pnpm test:browser` | 23 tests passed; 0 skipped/retries; 1.0 minute |
| Development migration and `seed-local` twice | Passed after guarded reset of only verified synthetic `zobba_story_20`; schema 2 and repeat-safe fixtures |
| Development API readiness and CA-verified HTTPS app → actual IdP password form with current Origin/CSP policies | Passed |
| `git diff --check` | Passed |

The protocol contract uses actual provider-issued authorization codes. It covers
wrong issuer/audience/authorized party; multiple audience and missing authorized
party; signature, algorithm, unsigned token and unknown key; expired/old/future
claims and excessive lifetime; nonce and access-token hash; PKCE mismatch and code
replay; token-supplied key URLs; malicious discovery destinations; successful key
rotation and coalesced concurrent unknown-key refresh; oversized Content-Length
and chunked bodies; slow and redirected token/discovery/JWKS responses. HTTP
bytes, connect/total time, key count/size and full operation duration are bounded.
Same-key-ID replacement and concurrent bad signatures exercise bounded refresh.
Five-minute cache expiry, key retirement and expired-cache failure/recovery use
deterministic clock advancement. Claim/algorithm failures do not refresh keys.

The PostgreSQL contracts cover hashed state/binding/session storage, competing
one-use login consumers, expiry, fixation/rotation/logout replay and inactive
identities. Scope cases alternate principals, organisations and clients on one
verified physical connection, test guessed/mismatched scope and joins, perform
allowed and denied actual DML, exercise composite FKs, and recheck removal,
demotion and expiry. Commit, rollback and cancellation all clear context. Migration
cases include prior-prefix upgrades, checksum/schema/policy/grant tampering and
disabled/replica-only/always-enabled FK trigger refusal without mutation.
Eight separate connections defaulting to REPEATABLE READ are held at the login
admission lock together; explicit READ COMMITTED admission accepts exactly one
at 999/1,000 capacity. Indexed cleanup deletes batches of at most 128 at a fixed
cutoff. Actual production-query EXPLAIN checks against 10,000-row backlogs require
expiry-index lookup and bounded TID deletion. Seed reruns preserve deleted and
disabled authority, including after all fixture authority is removed. Scope
boundary fixtures cover 128-character ASCII IDs and 200-scalar Unicode labels;
pagination traverses 122 assigned scopes with duplicate local IDs.

The browser suite follows the real HTTPS password form and callback. It checks
chooser and selected scope, both organisations, guessed/mismatched IDs, Admin-only
and unassigned denial, combined roles, secure cookie attributes and absence of
provider tokens in browser storage, Origin/CSRF and GET logout refusal, invalid
callback preservation, state/browser-binding/fixation/replay attacks, logout,
current role/membership/session expiry, database loss, focus and narrow layouts.
Two actual successful sign-ins replay the first valid cookie as 401 while the
replacement returns 200. UI cases overlap sign-out with timer/focus/visibility
reads, interrupt the database, lose a successful response, expire sessions and
change CSRF; no retry reopens protected work. Chooser navigation covers 121
assignments and direct access to a later page's scope. A forced restoration-SQL
failure still closes every owned listener.
Sixteen concurrent sign-ins against slow cold discovery all fail within the
bounded deadline, with a recovery page and successful recovery after backoff.

The actual Vite proxy failure test supplies code/state/cookie/authorization
sentinels and verifies they never enter its error logger. Corrupt private fixture
JSON also produces a fixed diagnostic without exposing its contents.

## Review fixes and reusable decisions

The consolidated 18-row review batch is repaired. In addition to the behavior
above, OpenAPI now describes callback query inputs, both cookie authentication
schemes, logout Origin/CSRF headers, cursor constraints and relevant error
responses. Scope/label limits agree across migration constraints, Rust, browser
validation and generated contracts. Only matching consumed login attempts clear
their transient browser cookie; wrong bindings leave the pending attempt intact.
Capacity produces a fixed recoverable 429 response. Fixture request URL parsing
is inside the fixed-error boundary, so malformed local requests do not stop it.

Targeted mutation checks proved the newly retained regressions detect the reviewed
gaps. Removing both HTTP byte checks admitted otherwise valid oversized discovery,
JWKS and token responses: all three Content-Length and all three chunked tests
failed with assertion exit 101. Disabling ID-token expiry failed the separate
recent-expiry test with exit 101. The verifier was restored byte for byte
(SHA-256 `5965243ac2b03fb435161b9ca998d71d4493e5b12c6720adaf2d482af3c6b0dc`),
then all 12 provider tests and the final complete Rust build/test passed.
An isolated copy restoring the old fixture URL-parsing boundary failed precisely
the malformed-request regression; shared fixture source was never weakened.

Independent early review identified disabled internal FK triggers missing from
catalog validation. Exact trigger definitions and ordinary enabled state are now
verified, with startup and migration refusal regressions. Independent verification
also reproduced the corrected refusal and normal FK enforcement.

An unrelated invalid callback must not become GET logout. Failed discovery must
not queue unbounded retries behind its mutex: the API has an overall 15-second
deadline and failed-discovery backoff, in addition to transport deadlines.

Native Chromium exposed two fixture requirements a scripted login helper missed:
`Referrer-Policy: same-origin` preserves a usable Origin on its password POST,
and CSP form-action must permit the exact app origin through the redirect chain.
Strict fixture Origin and CSRF checks remain enforced. React focus restoration
uses the committed view, and Vite proxy errors are sanitized before its built-in
logger. These decisions and actual commands are recorded in `CLAUDE.md` and the
workspace/fixture/browser READMEs.

## Captured evidence and limits

Stable screenshots are retained at
`/workspace/zobba-build-tools/evidence/20.2/`:

- `engagement-chooser-desktop.png`
- `engagement-scope-desktop.png`
- `engagement-scope-mobile.png`
- `admin-empty-state.png`
- `access-unavailable.png`
- `ready-desktop.png`, `unavailable-desktop.png`, `restored-mobile.png`

Post-repair captures are retained under `repair-verified/`, including
`paginated-direct-scope-mobile.png`; the repaired desktop chooser, direct scoped
320px view and unavailable state were visually inspected. Mutation logs are under
`mutation-proof/` in that same evidence directory.

Root independently exercised the refreshed development app after these repairs:
two real sign-ins produced old-cookie 401/new-cookie 200; keyboard-opened scope,
reload and 320px layout passed; held logout survived focus/visibility events and
ended with 401. No page errors occurred. Its inspected screenshots are under
`root-post-review/`.

The implementation agent and root independently inspected the actual renders.
CI is configured to retain browser evidence, but remote CI has not run for this
checkpoint. The local fixture uses disposable in-memory provider
state; it is intentionally not a deployment provider. Invitations,
administration, production identity qualification,
Tasks/evidence/computers and the later stories remain outside 20.2.

The independent reviewer reproduced all 23 browser cases, database and actual
provider checks, inspected the relevant renders and accepted the repaired story
with no material findings. No implementation blocker or additional user decision
remains within Story20.2. Story20.3 is the next dependency-ready build slice.
