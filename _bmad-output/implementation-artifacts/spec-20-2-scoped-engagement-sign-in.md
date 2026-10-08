---
title: '20.2 — Sign in to an explicitly scoped engagement'
type: feature
created: '2026-09-30'
status: done
story_key: 20-2-sign-in-to-an-explicitly-scoped-engagement
review_loop_iteration: 0
baseline_commit: 9c272c960342313055f053b917841a3cbc3c90f6
authorization: 'Owner authorised Stories 20.1–20.4, specifications and routine choices without intermediate approval.'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-20-context.md'
  - '{project-root}/_bmad-output/specs/spec-IntelliFin Audit/SPEC.md'
---

<frozen-after-approval reason="owner-authorised Story20.2 intent and batch boundaries">

## Intent

**Problem:** The verified workspace has no identity or engagement boundary. An auditor needs to reach only currently assigned client work.

**Approach:** Add real OIDC sign-in, Rust server sessions, current application membership, scoped transactions with forced RLS, and a Pair engagement chooser.

## Boundaries & Constraints

**Always:** Follow canonical20.2, CAP17, AD1/8/10/12/35/38/48 and active experience. Use issuer/subject identity, current role sets and explicit organisation/client/engagement scope. Admin alone grants no audit access. Preserve20.1 refusal, explicit migrations and inward boundaries. Local synthetic proof uses a separate actual IdP.

**Ask First:** Paid resources, real customer credentials/data, production identity/deployment or destructive historical changes. Routine implementation and isolated fixtures are authorised.

**Never:** Test-auth bypasses, browser-held provider tokens, email/IdP-role authority, legacy Node domain dependencies, invitations/admin UI, Task/evidence tables or customer SSO qualification claims.

## I/O & Edge-Case Matrix

| Scenario | Input / state | Expected behaviour | Error handling |
|---|---|---|---|
| Sign in | Real code flow; valid issuer, audience, signature, state, nonce and PKCE | Fresh secure opaque server session; chooser contains assigned engagements | Unassigned account gets no client work |
| Forged/replayed response | Bad claims, state/binding, verifier, algorithm, key, expiry or repeated code | No application session or membership created from unverified claims | Bounded fixed diagnostic; no secrets |
| Scoped access | Two organisations/clients/engagements; guessed or mismatched IDs; reused pool connection | Application checks, FORCE RLS and scoped references deny cross-scope reads/writes | No foreign contents; commit/rollback clears scope |
| Changed authority | Removal, expiry, logout or audit-role demotion to Admin-only | Next request uses current authority; invalid session terminates | Clear cached protected UI and cookie as applicable |
| Browser attack/failure | Wrong Origin/CSRF, fixation, unavailable/slow IdP or DB | Mutations refuse; UI gives recoverable honest state | No insecure fallback, raw provider errors or automatic access |
| Schema upgrade | Empty DB or verified20.1 prefix | Explicit migration reaches20.2; repeat safe | Foreign/altered/newer states refuse without mutation |

</frozen-after-approval>

## Code Map

- `zobba/crates/infrastructure/src/lib.rs`:20.1 validates exactly two tables, disallows DML/RLS/functions and one migration. Extend its versioned schema/grant contract deliberately; preserve physical checks before reads, catalog safety, atomic migration and restricted roles. Never rewrite `0001_bootstrap.sql`.
- `zobba/crates/{domain,application,api}/`: owned meanings/ports and Axum composition. `zobba-cli openapi` plus `web/scripts/generate-api.mjs` owns the HTTP/type seam; health and worker remain independently usable.
- `zobba/web/{src/App.tsx,vite.config.ts,tests/browser/}`: current Pair assets, styles and actual-browser harness. Vite strips `/api`; external callback retains that prefix. Boundary guard requires directly inspected configs, not composed Vite exports/inherited resolver overrides.
- Published `openidconnect4.0.1`/`oauth2 5.0` sources: full relying-party library, compatible with pinned Rust; pair with `reqwest0.12.28`. It omits `azp` verification, defaults to permissive `iat`, buffers uncapped HTTP bodies and does not refresh JWKS automatically. Address these explicitly. Separate pinned `oidc-provider9.12.2` is fixture infrastructure only.

## Tasks & Acceptance

**Execution:**
- [x] `zobba/crates/{domain,application}/src/identity.rs` — define typed identity/scope and current-authority ports; delivery/SQL/vendor types remain outside domain. Support combined roles without Admin implying audit authority.
- [x] `zobba/migrations/0002_identity_scope.sql`, `crates/infrastructure/src/{identity,scope}.rs` — add only identity, login/session, organisation/client/engagement and membership/role records; scoped keys, forced RLS and restricted grants. Implement actor-only chooser reads and shared scoped transactions; no pool reacquisition inside a transaction. Admit verified previous migration prefixes and test fresh/upgrade/repeat/refusal.
- [x] `zobba/crates/infrastructure/src/oidc.rs`, `crates/api/src/{auth,engagements}.rs` — use the maintained OIDC verifier and bounded trusted-endpoint HTTP; implement one-use browser-bound login attempts, opaque hashed sessions, current membership, logout and CSRF. Register routes and regenerate owned contracts.
- [x] `zobba/fixtures/oidc/`, `crates/cli/` — provide independent HTTPS IdP and explicit idempotent local synthetic seeding. Require deliberate local-fixture configuration; ordinary deployment cannot enable test login. Generated keys/certificates remain ignored. Seed two organisations, distinct clients/engagements, assigned auditors/managers and unassigned Admin.
- [x] `zobba/web/src/{App,auth,engagements}.*`, `web/vite.config.ts` — implement sign-in, current identity, chooser, visible selected scope, empty/error states and POST logout. Preserve Pair assets, keyboard/focus and narrow usability; display real server state without Task placeholders.
- [x] `zobba/crates/infrastructure/tests/`, `web/tests/browser/`, `scripts/`, `.github/workflows/zobba.yml` — retain protocol, session, scope and migration regressions; adapt bootstrap/browser checks to this slice. Update pins, locks, README, `.env.example`, reuse notes and `CLAUDE.md` with actual commands and limits.

**Acceptance Criteria:**
- Given synthetic assigned and unassigned users, when the actual browser signs in and opens work, then only current assigned scope is available and no production auth bypass exists.
- Given role changes and alternating requests through one physical pooled connection, when reads/writes/joins run or roll back, then current authority and isolation hold at both application and database boundaries.
- Given a fresh checkout or20.1 database, when documented setup and verification run, then migration, HTTPS login/logout and negative fixtures pass without legacy runtime or paid services.

## Spec Change Log

## Design Notes

Use code+PKCE S256, RS256-only and exact configured issuer/client/redirect. Validate `azp` when present, bounded `iat`/expiry and nonce; reject untrusted audiences. Fix endpoint destinations from trusted configuration/discovery, allowing Cognito's distinct hosted-login domain. Bound HTTP bytes, connect/total time and redirects; coalesce unknown-key refresh and retry verification once. Never trust token-supplied key URLs.

Persist expiring hashed state/browser binding with nonce and PKCE verifier; consume once before exchange. Create random hashed server sessions after verified identity; discard provider tokens. Use `__Host-` Secure/HttpOnly/SameSite=Lax cookies, exact configured Origin plus session-bound CSRF on mutations, POST logout and no-store responses. Session lookup is a narrow control-plane repository before engagement selection; tenant repositories require fresh current authority and transaction-local scope. Prevent recursive membership policies. Test a real allowed scoped DML and denied cross-scope DML under the nonowner role, not only missing SQL grants.

Use HTTPS app `localhost` and a different IdP hostname (`127.0.0.1`), since cookies lack port isolation. Register `/api/auth/callback` externally and `/auth/callback` in Axum. Generated local CA trust is fixture configuration; never disable Rust TLS verification. Browser certificate-ignore is confined to local tests. No Host/forwarded-header-derived redirects. Protect credentials/query strings from telemetry and errors.

Local tooling: `. /workspace/zobba-build-tools/activate.sh`; pnpm may need `XDG_DATA_HOME=/tmp/zobba-pnpm-data XDG_CACHE_HOME=/tmp/zobba-pnpm-cache`. Test-admin credentials are solely for synthetic negative fixtures. Existing20.1 API4310/Vite5173 are owned local processes; restart only those as necessary. Browser plugin is unavailable; use owned Playwright/Chromium. Machine paths are conveniences, never product dependencies. Complete only20.2, then report for independent review; routine specification approval is already authorised.

## Verification

- Run all documented20.1 format/lint/locked build, frozen web/type/build, boundary/guard, PostgreSQL and smoke gates, adapted without weakening preserved invariants.
- Add actual IdP success and bad issuer/audience/signature/algorithm/azp/time/nonce/state/browser-binding/PKCE/code-replay/key-rotation fixtures; bounded oversized/slow/redirect responses; fixation/logout replay and CSRF refusal.
- Run real PostgreSQL tests with pool size1: alternating principals/scopes, missing scope, guessed IDs, composite-FK mismatch, current removal/demotion, commit/rollback/cancellation and Admin-only denial. No skipped matrix rows.
- Run owned browser tests for HTTPS login, chooser, protected scope, denial, logout/CSRF, expired authority and narrow/keyboard states; capture evidence. Independently review against canonical20.2 before done/push.


### Executed matrix evidence

All six rows passed locally: actual HTTPS provider/browser sign-in and unassigned denial;
protocol and callback forgery/replay refusals; real single-connection scoped RLS/DML/FK
checks; changed/expired authority and session removal; CSRF, database loss and concurrent
slow-provider bounds with visible recovery; and fresh/verified-prefix/repeat migration
plus altered-schema refusal. No row was skipped. See
[the implementation record](zobba-foundation-batch/STORY-20.2-IMPLEMENTATION.md)
for commands and limits. Three fresh BMAD review layers produced one consolidated
repair batch. All18 findings are closed, and the independent reviewer reproduced
the final23 browser cases, database and actual-provider contracts. Root separately
verified and inspected the rebuilt development app. See
[the accepted review record](zobba-foundation-batch/REVIEW-20.2.md).

## Suggested Review Order

**Identity boundary**

- Keep provider initialization, sessions and request deadlines under one Rust boundary.
  [auth.rs:28](../../zobba/crates/api/src/auth.rs#L28)

- Verify real OIDC claims with bounded transport and refreshed signing keys.
  [oidc.rs:195](../../zobba/crates/infrastructure/src/oidc.rs#L195)

- Atomically bound login admission and consume browser-bound attempts once.
  [identity.rs:69](../../zobba/crates/infrastructure/src/identity.rs#L69)

**Current authority and migration**

- Retain exact scope and current authority on one pooled transaction.
  [scope.rs:27](../../zobba/crates/infrastructure/src/scope.rs#L27)

- Create fresh identity and tenant records with forced RLS and scoped references.
  [0002_identity_scope.sql:2](../../zobba/migrations/0002_identity_scope.sql#L2)

- Verify physical schema and FK enforcement before trusting application metadata.
  [catalog-signature.sql:1](../../zobba/crates/infrastructure/src/catalog-signature.sql#L1)

- Provision synthetic access once without restoring removed authority.
  [fixture.rs:31](../../zobba/crates/infrastructure/src/fixture.rs#L31)

**Pair interaction and recovery**

- Keep selected scope, keyboard focus and logout intent consistent through revalidation.
  [App.tsx:20](../../zobba/web/src/App.tsx#L20)

- Page by complete scope and open authorized assignments independently.
  [engagements.ts:51](../../zobba/web/src/engagements.ts#L51)

- Prevent proxy failures from logging callback secrets.
  [proxy-errors.ts:1](../../zobba/web/proxy-errors.ts#L1)

**Verification and operating instructions**

- Exercise real session, capacity, cleanup and current-authority boundaries.
  [identity.rs:472](../../zobba/crates/infrastructure/tests/identity.rs#L472)

- Use actual HTTPS provider responses and independently valid negative fixtures.
  [oidc_protocol.rs:1](../../zobba/crates/infrastructure/tests/oidc_protocol.rs#L1)

- Verify real sign-in, session races, pagination and accessible recovery.
  [auth.spec.ts:1](../../zobba/web/tests/browser/auth.spec.ts#L1)

- Run the independent workspace without triggering historical deployment.
  [zobba.yml:1](../../.github/workflows/zobba.yml#L1)

- Reproduce local setup and understand qualification limits.
  [README.md:1](../../zobba/README.md#L1)
