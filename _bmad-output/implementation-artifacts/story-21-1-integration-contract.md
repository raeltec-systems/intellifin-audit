# Story 21.1 integration contract

Use [the canonical specification](spec-21-1-immutable-evidence.md) and
[compiled Epic 21 context](epic-21-context.md).
The active contract is SPEC revision 3 and adopted companions, not the retired
TypeScript planner contracts. The candidate requires schema 6 after 20.6, a
measured immutable original, read-back before registration, current scope at
registration and disclosure, bounded inert inspection, and no live connector
claims.

## Transplant map and boundaries

- Adapt `/workspace/zobba-evidence-adapter-lab/src/lib.rs` into
  `zobba/crates/infrastructure/src/evidence/s3.rs`; expose it through a new
  `crates/infrastructure/src/evidence/mod.rs` and `src/lib.rs`. Keep AWS
  `AmazonS3`, `GetOptions`, conditional PUT, HTTP and retry types here.
- Move the protocol fixture and its assertions from lab `src/tests.rs` into
  `crates/infrastructure/tests/support/s3_protocol.rs` and
  `crates/infrastructure/tests/evidence_s3.rs`. Reuse the existing integration
  test support pattern in `crates/infrastructure/tests/support/mod.rs`; do not
  make fixture transports a production feature.
- Add domain records under `crates/domain/src/evidence.rs`: opaque reservation
  identity, measured content identity, immutable version reference, source and
  acquisition provenance, and explicit asserted/unknown coverage fields. Do
  not put S3 keys, SQL rows, HTTP types or credentials in domain records.
- Add application-owned ports under `crates/application/src/evidence.rs`,
  following the `CurrentAuthority` / `ConversationRead` / `OperationStore`
  pattern. Keep distinct ports for scoped reservation/registration metadata
  and immutable object I/O. A possible storage contract is bounded
  `put_if_absent`, `latest_version` (metadata only), and `get_version`; return
  an opaque version plus measured bytes/hash/size. Never accept an arbitrary
  key or destination URL from the caller.
- The application service owns the sequence: create/recover the same opaque
  reservation in PostgreSQL, read and measure at most 10 MiB, conditionally
  write the deterministic server-owned key, reconcile any uncertain result,
  read and verify the returned non-null version, then register it in a short
  transaction that rechecks actor, session and scope. No SQL transaction spans
  S3 I/O. Exact retries use the same reservation and content; changed bytes
  conflict. Keep incomplete reservations quarantined and unavailable as
  evidence.
- Infrastructure implements both ports. Repository registration must use the
  schema-6 grants/RLS and the established scope transaction pattern in
  `crates/infrastructure/src/scope.rs`; current membership is rechecked by SQL,
  including after waits. Add a schema-6 migration and
  `crates/infrastructure/src/schema-v6.catalog`, bump
  `zobba_domain::SCHEMA_VERSION` in `crates/domain/src/lib.rs`, and preserve
  catalogues/prefixes 1–5. The current session/engagement authority port is
  `crates/application/src/identity.rs`. Auth cookie and session-freshness
  behavior lives in `crates/api/src/auth.rs`.
- Compose one shared two-permit evidence I/O lane in the API. Acquire before
  collecting upload bodies and fail fast with retryable capacity feedback when
  full. The 120-second total deadline includes body collection, storage,
  registration and the final authority check. Transfer the admission permit
  through storage; do not acquire the same limiter twice. Later downloads and
  previews share the same lane and retain the permit through verified bounded
  reads. Ordinary metadata keeps its 15-second deadline and reserved Pause/Stop
  capacity stays separate. Do not use the conversation client's eight-second
  wrapper for evidence I/O. Buffer at most 10 MiB, verify the pinned version,
  measured size and SHA-256, then recheck exact session and scope before response.
- Add authenticated reserve/upload/list/inspect/preview/download routes in
  `crates/api/src/evidence.rs` (or a focused module wired through
  `crates/api/src/lib.rs`). Expose generated OpenAPI and `web/src/generated/api.ts`
  via `web/scripts/generate-api.mjs`. Keep API errors generic across foreign,
  revoked and missing handles. Preserve `no-store`, `no-referrer` and
  `nosniff`; downloads need safe content disposition and no presigned/public
  URL. The current router applies a blanket 15-second timeout in
  `crates/api/src/lib.rs:78-118`; evidence I/O endpoints (upload, preview and
  download) require the 120-second operation budget. Classify those for a longer
  bounded deadline; ordinary evidence metadata retains the 15-second budget.
- For preview, only valid plain UTF-8 text is inertly previewed, capped at
  64 KiB/100 lines. Unsupported binary originals are download-only. Do not
  execute parsers or render HTML/SVG. Preserve conversation, selected Task and
  keyboard focus when opening and returning from inspection.

## Reservation and audience boundaries

Reservation creation has an actor/composite-scope-bound idempotency key. Same key
and canonical payload recover the original reservation after a lost response;
changed digest, size, filename or source/account/version/selection/coverage facts
conflict. Freeze the attributed payload once. Bounded owner-scoped incomplete
reservation recovery is distinct from registered evidence. A newly verified
session can explicitly recover its owner's reservation under current scope;
discarding a browser draft never deletes durable custody.

The server records acquisition through direct upload and the authenticated
acquisition actor/time. User-entered source system/account/version/query/coverage
remain attributed assertions or explicit unknowns. Keep source-system version
separate from the storage version verified by read-back; no form input may claim
that a live connector performed this acquisition.

Persist the infrastructure-owned storage namespace/locator with the immutable
version. A changed configured bucket or endpoint must not silently retarget a
historical original; mismatch is explicitly unavailable. Public metadata exposes
opaque evidence identity, never credentials or an arbitrary storage locator.

Registration rechecks the captured exact session and current membership inside
its short transaction **after authority-lock waits**, serialized against logout
and scope changes. Use organisation then engagement lock order. The existing
scope helper checks actor/scope only; it does not replace this exact-session check.
No lock or transaction spans S3 I/O. Check current exact session/scope again after
verified object reads, before constructing a disclosure response.

Download uses a bounded authenticated fetch with the owned expected-session
protocol. Fence held responses across actor/session/scope replacement before
creating or activating a Blob URL. Discard/revoke URLs on audience change or
unmount. A bare native download href bypasses the required client audience fence.
Retain selected Task, accepted guidance and deliberate return focus during evidence
inspection; do not reset the coordinating conversation by changing panels.

## Minimal pinned dependencies

Add these to root `workspace.dependencies`:

```toml
object_store = { version = "=0.14.2", default-features = false, features = ["aws"] }
futures-util = "=0.3.34"
bytes = "=1.12.1"
```

Reference the first three from `crates/infrastructure/Cargo.toml`.
`sha2 = "=0.10.9"`, `tokio = "=1.53.1"`,
and `url = "=2.5.8"` are already workspace pins; Tokio already includes
`io-util`, `time`, `sync`, `net` and `process`. For the owned fixture connector,
put these only in **dev-dependencies** of the infrastructure tests and API test
harness as needed; dev-dependencies do not propagate between crates:

```toml
reqwest = { version = "=0.13.5", default-features = false, features = ["rustls"] }
http-body-util = "=0.1.5"
hyper = { version = "=1.11.1", default-features = false, features = ["http1", "server"] }
hyper-util = { version = "=0.1.21", default-features = false, features = ["http1", "server", "service", "tokio"] }
```

Use
`HttpClient`/`HttpConnector` with `.no_proxy()` and redirects disabled after
numeric-loopback validation. This preserves production `AmazonS3Builder` proxy
and CA trust. The current workspace's direct HTTP client is reqwest 0.12.28;
do not replace it to support the fixture. `object_store` resolves to reqwest
0.13.5 in the tested lockfile.

Retain the production safeguards from lab `build_s3_from_env`: HTTPS only,
signatures forced on, invalid TLS certificates forced off, conditional create,
and zero hidden SDK retries. Override only the invalid-certificate client key
so configured trusted CAs/proxies/timeouts survive. Require a versioned bucket
and reject missing or literal `null` version IDs. Scope object writes/reads to
the server-owned evidence prefix; grant `s3:ListBucket` only with the owned
health-sentinel prefix condition, `s3:PutObject` on owned object keys, and
`s3:GetObject`/`s3:GetObjectVersion` for metadata and pinned reads. The bounded
readiness list distinguishes bucket unavailability from object-key absence,
but it is not atomic with a later PUT.

## Test wiring

Root owns BMAD workflow, specification/status, independent review and commits.
The implementation lead may delegate disjoint files after agreeing interfaces;
serialize schema edits and database suites. After the 20.6 handback, the lead
owns `zobba_story_20_test` (browser/smoke, runtime `zobba_app`) and
`zobba_patch20_3_test` (restricted owner `zobba_patch20_3_owner`, runtime
`zobba_patch20_3_app`) on `127.0.0.1:55434`. Fixture administration is explicitly
`zobba_local_admin`; never widen runtime grants to arrange synthetic rows. Use
`/workspace/zobba-build-tools/activate-tests.sh`, which clears development URLs.
CLI migrations require an explicit guarded test URL. Own only test IdP 9444;
preserve development and IdP 9443. Use installed Chromium at `/usr/bin/chromium`.
Run the complete Rust suite under the restricted owner/runtime profile and
serialize it with other users of that database. Seed/reset the story fixture
before browser login so prior synthetic subjects cannot create an issuer mismatch.

- Rust object-store tests bind an owned numeric-loopback listener to port 0,
  use synthetic credentials, and exercise real `object_store` S3 requests.
  The connector must explicitly ignore proxy variables without changing the
  test process environment. Keep the hostile-proxy regression in a child
  process. Use the separate local fixture transport; never pass cloud
  credentials or a caller-controlled HTTP endpoint to it.
- API HTTP tests need the existing guarded disposable PostgreSQL test database
  plus that local S3 fixture. Follow
  `crates/infrastructure/tests/support/mod.rs`'s migration/runtime/admin target
  identity guard and explicit `*_test` requirement. Never use the development
  database. Test current scope and same-session requirements in addition to
  API response shape.
- Browser evidence tests use `web/tests/browser/auth-runtime.ts::startAuthRuntime`,
  with real HTTPS OIDC and scoped disposable PostgreSQL. The unauthenticated
  `runtime.ts::startRuntime` remains the health harness. Update schema assertions
  and sanitize object-store/AWS environment in both. Use a test-only Rust API
  harness target with dev dependencies and an injected fixture connector; an
  ordinary production API binary must have no environment switch for insecure
  transport. A numeric-loopback Node S3 protocol fixture implements bounded list,
  HEAD, conditional create and version-pinned GET. The browser talks only to the
  API. Restart the API against the same owned fixture and stored objects; close
  fixture listeners on startup failure and teardown. Keep the production builder
  strict and the synthetic no-proxy/no-redirect transport test-only.
- Exercise reserve/upload/read-back/register, exact replay after lost API or
  DB acknowledgement, changed-content conflict, reload recovery on the same
  reservation, narrow/foreign scope, session/account replacement, revocation
  while upload/read is held, final authority check before disclosure, safe
  headers/filename, inert preview caps, and unchanged conversation/task
  focus. Keep storage unavailable behavior explicit when no S3 configuration
  is supplied.

## Review gaps to close

The repaired prototype passed 24 tests but is not the Story implementation.
Independent adapter review gaps still include: both create attempts fail
without commit (must produce no receipt/object); S3 HTTP 409/412 AlreadyExists
with a missing latest key (currently fail-closed without the second attempt);
shared admission before upload buffering, later download/preview reads and
responsive conversation/Pause/Stop while saturated; SQL exact-replay and lost
reservation/registration acknowledgement recovery;
registration refusal after scope/session revocation during object I/O or a
post-I/O database lock wait; and
reauthorization after buffered read-back before bytes are disclosed. The local
test does not prove SigV4 correctness, a real TLS invalid-certificate
handshake, bucket versioning/IAM/KMS, or AWS behavior. Add integration-level
tests for those behaviors that can be proven locally; keep any service-level
qualification separate and do not imply paid/live infrastructure use.

## Provenance and notices

Prototype files to adapt:

| File | SHA-256 |
|---|---|
| `/workspace/zobba-evidence-adapter-lab/src/lib.rs` | `3389966ed753943478930bddbdad51d5aefc06cb759dfd164099f310a3b633e7` |
| `/workspace/zobba-evidence-adapter-lab/src/tests.rs` | `5b40471969bc3f66ae9831e642ab422454e1633301e67584faf55646922b3418` |
| `/workspace/zobba-evidence-adapter-lab/Cargo.toml` | `823e3eeacb3ff1d7f04addc81b99943d44e49e089df960f7fd576a6a9f4c3063` |
| `/workspace/zobba-evidence-adapter-lab/Cargo.lock` | `9e3dc5dcfd9357b1177a6281f67bbc62879a1498c31e28011b0c1122dd3db21e` |
| `/workspace/zobba-evidence-adapter-lab/README.md` | `92492e8385bfebcbd9ba427034d80df8ffe76df7acd70350a7809701722c7819` |

The lab ran `cargo fmt --all -- --check`, `cargo test --locked --offline`
(24 passed, 0 failed), and `cargo clippy --all-targets --locked --offline -- -D
warnings` via `/workspace/zobba-build-tools/activate-tests.sh`. `object_store`
0.14.2 lock checksum is
`f1796bc93603f78c5760a69f2d58badc9618d22adade0a95385bb2adbae4eb94`
(crate metadata: MIT/Apache-2.0). Fixture-only reqwest 0.13.5 checksum is
`16a1cfa75cc186dd73d5818e510e042e40927bccc9c236b061cea97e1eb08029`
(MIT OR Apache-2.0). Record the prototype source and dependency licenses in
`zobba/REUSE.md` when integrating; the scratch crate is `publish = false` and
does not declare a package license.

The historical TypeScript behavioral reference is
`packages/infrastructure/src/evidence/s3-evidence-store.ts` and its test at
`packages/infrastructure/src/evidence/s3-evidence-store.test.ts`, exactly at
commit `4fb496eaee4a676e0875e00ba5b00b913e107899` (2026-09-06). Their SHA-256
hashes at that commit are `8a7fb41193b9168278c904dca3e4a43049d7f94f1d57cc072319901ae6cf45e4`
and `425a459f7369c8991e901cc5e23f73c6873f7071f34a5640e81eb1c8152802cc`.
The active candidate and Epic context limit this to behavioral reference; do
not transplant the legacy package. Current `zobba/REUSE.md` does not list that
legacy source as reusable code.
