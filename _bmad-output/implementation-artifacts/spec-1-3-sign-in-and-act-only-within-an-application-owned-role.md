---
title: 'Story 1.3: Sign in and act only within an application-owned role'
type: 'feature'
created: '2026-09-02'
status: 'done'
baseline_revision: 'da944faf17c7c18f4d5e35d0f273b2b07d98fde2'
baseline_commit: 'da944faf17c7c18f4d5e35d0f273b2b07d98fde2'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/CLAUDE.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
warnings:
  - oversized
deferred:
  - summary: >-
      Sign-out is never audited, so the chain records how sessions begin but not how they end.
    evidence: |-
      handleAuthRequest intercepts only POST /api/auth/sign-in/email and passes every
      other Better Auth endpoint through untouched. There is no security.sign-out event
      anywhere. FR-45 asks for security activity generally; this story's matrix covers
      only sign-in and denial.
    location: >-
      apps/web/src/sign-in-route.ts
    severity: medium
  - summary: >-
      Assigning or revoking a role produces no audit event, so the privilege change behind a denial is invisible.
    evidence: |-
      scripts/seed-identity.mts writes user_role with raw SQL and appends nothing; the
      integration test revokes with a bare DELETE. Denials are audited but their cause
      is not. Story 1.5 owns user and role management and is the natural home.
    location: >-
      scripts/seed-identity.mts
    severity: medium
  - summary: >-
      No route calls requireAction, so the audited-denial path has no production caller.
    evidence: |-
      requireAction and authorizeCommand are exercised by unit and integration tests but
      by no shipped handler; /api/session uses requireSession and reads the role directly.
      This story forbids creating Procedure, Run, Evidence and administration routes, so
      the first real caller arrives with Story 1.4 or 1.5. Wire one then.
    location: >-
      apps/web/src/require-role.ts
    severity: medium
  - summary: >-
      createSeedAuth, the factory with sign-up enabled, is reachable from apps/web through the infrastructure barrel.
    evidence: |-
      packages/infrastructure/src/identity/index.ts re-exports it, so nothing but
      convention stops a composition root constructing it. The repo already has the
      right pattern for this: the no-migrator-in-apps dependency-cruiser reachability
      rule, added after the migrator leaked into the web bundle.
    location: >-
      packages/infrastructure/src/identity/index.ts
    severity: medium
  - summary: >-
      Next never actually invokes the middleware under test; only the exported function is called.
    evidence: |-
      middleware.test.ts calls middleware() directly with a synthetic NextRequest, so
      config.matcher and Next's file-convention discovery are never exercised. The CI
      smoke assertions added in this pass narrow the gap but do not close it. Next 16
      also warns the middleware convention is deprecated in favour of proxy.
    location: >-
      apps/web/middleware.ts
    severity: medium
  - summary: >-
      Session lifetime and cookie policy are left entirely to Better Auth defaults.
    evidence: |-
      auth.ts sets no session.expiresIn, updateAge, cookiePrefix or trustedOrigins, and
      session-cookie.ts hard-codes a name derived from the default prefix. A defaults
      change would break the middleware into a redirect loop for signed-in users.
    location: >-
      packages/infrastructure/src/identity/auth.ts
    severity: medium
  - summary: >-
      A deep link into a protected page loses its destination; sign-in always lands on the root.
    evidence: |-
      The middleware redirects to a bare /sign-in with no return parameter and the page
      navigates unconditionally to /. A signed-in user visiting /sign-in is also not
      redirected away. Story 1.4 owns the shell and is the right place to fix this.
    location: >-
      apps/web/middleware.ts
    severity: low
  - summary: >-
      The sign-in form has accessibility defects and no test.
    evidence: |-
      The error paragraph carries both role="alert" and aria-live="polite", is not linked
      to the fields with aria-describedby, sits after the form in DOM order and takes no
      focus. The page exports no metadata. Story 1.4 owns the styled surface and the
      WCAG 2.1 AA gate.
    location: >-
      apps/web/app/sign-in/page.tsx
    severity: low
---

<intent-contract>

## Intent

**Problem:** The deployed application has no identity at all: every route is public, no user exists, and nothing decides what a signed-in person may do. Epic 1's remaining stories and all of Epic 2 add Procedure, Run, Evidence, and administration surfaces that must never be reachable by the wrong person, so the boundary has to exist before they do.

**Approach:** Add Better Auth for identity and session only, keep role assignment in an application-owned `identity` module that is read fresh on every request, and put a default-deny guard in front of every route so a future route is protected unless it is explicitly listed as public. Encode the EXPERIENCE.md action-gating table as a pure domain policy with its verbatim denial strings, and append sign-in and denial events to the `platform` audit chain built in Story 1.2.

## Boundaries & Constraints

**Always:**
- Better Auth establishes identity and session only. The role comes from the application's own `user_role` table, never from Better Auth's user record, and never from a claim in the session token (AD-7).
- The role is resolved per request. Revoking or changing it takes effect on the next request without invalidating or ending the existing session (AD-7).
- Route protection is default-deny: everything is protected unless it matches an explicit public allowlist. A new route added later is protected without anyone remembering to protect it.
- A refused request returns no protected data and no detail beyond the denial reason — no user existence disclosure on a failed sign-in.
- Denial reasons specified in the EXPERIENCE.md table are reproduced character-exact, including the trailing full stop.
- `better-auth` may be imported only from `packages/infrastructure` or `apps/web`. The role model, the gating policy, and their tests contain no vendor types (AD-1).
- The new migration is generation 3: it seeds `INSERT INTO "schema_meta" ("version") VALUES (3)` and raises `SUPPORTED_SCHEMA_MAX` to 3 in the same commit.
- Audit payloads and telemetry carry no password, token, session cookie, or raw credential.

**Block If:**
- The EXPERIENCE.md action-gating table and FR-2 disagree on which role may perform an action.
- Delivering this requires changing an approved requirement, an AD, or a pinned dependency major.

**Never:**
- No user-management UI, no invite or password-reset flow, no self-registration — Story 1.5 owns managing users and roles.
- No Ledger Signal shell, sidebar, or design-system components — Story 1.4 owns the shell. The sign-in page here is unstyled and minimal.
- No Procedure, Run, Evidence, Exception, Live View, or Replay routes. This story protects those route families; it does not create them.
- No SSO, federation, provisioning, or multi-tenancy (spine Deferred).
- No role cached in a cookie, JWT claim, or in-memory map that could outlive a revocation.
- No seeding of users at process startup, and no committed credentials.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Sign-in succeeds | Correct email and password for a user holding a role | Session established; `security.sign-in` appended to `platform` with `outcome: 'success'`, `source: 'web'`, `actor.id` = user id | No error expected |
| Sign-in fails, known email | Registered email, wrong password | Refused with the same generic message as an unknown email; `security.sign-in` appended with `outcome: 'failure'`, `actor.id` = user id | No user-existence disclosure |
| Sign-in fails, unknown email | Email matching no user | Refused identically; event appended with `actor.id: 'unknown'` and `payload.subjectHash` = SHA-256 of the lower-cased email | Never store the raw address |
| Unauthenticated protected request | No session cookie, path in any protected family | 401 with an empty body for API routes, redirect to `/sign-in` for pages; no protected data in either | No stack, no route detail |
| Signed-in, no role assigned | Valid session, no `user_role` row | Treated as holding no role: every gated action denied and audited | Default deny, never a default role |
| Out-of-role action | PoC Administrator invokes `procedure.author` | 403 with body `{"reason":"PoC Administrator cannot author Procedures or start Runs."}`; `security.denied` appended with `outcome: 'denied'` | Reason is the verbatim table string |
| Author approves own version | Audit Manager is the version's author | Denied with `"You cannot approve a version you authored."` | Author identity supplied as policy context |
| Role revoked mid-session | Role row deleted while a session is live | The next request is denied and audited; the session itself is not terminated | No abrupt sign-out |
| Audit append fails | Database unavailable during sign-in | The sign-in is refused; a session is never established without its event | Fail closed, never silently unaudited |

</intent-contract>

## Code Map

- `packages/domain/src/audit-event.ts:6-27,216` -- the audit vocabulary to reuse: `AUDIT_EVENT_FAMILIES` already has `security`, `AUDIT_EVENT_OUTCOMES` already has `success | failure | denied`, `AUDIT_EVENT_SOURCES` already has `web`. `validateAuditEventDraft` enforces `SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,254}$/` on `actor.id`, `sessionId` and `correlationId` — **an email address cannot be an `actor.id`** because `@` is not in that set. `FORBIDDEN_PAYLOAD_KEYS` (line 109) rejects any key ending in `password`/`token`/`secret`/`credential`.
- `packages/domain/src/index.ts:15` -- barrel; add `export * from './identity/index.js'`.
- `packages/application/src/audit/ports.ts` -- `AuditEventWriter.append(draft)`, `AuditUnitOfWork.execute(work)`. The exact call shape is `await unitOfWork.execute(({ auditEvents }) => auditEvents.append(draft))`.
- `packages/application/src/index.ts:19-20` -- barrel; add the identity ports and the authorization use case.
- `packages/infrastructure/src/db/audit-events.ts:123` -- `PostgresAuditUnitOfWork(db, deps?)`; `db` comes from `createDb(sql)`.
- `packages/infrastructure/src/db/schema.ts` -- four tables today (`schema_meta`, `worker_heartbeat`, `audit_event_heads`, `audit_events`); add the Better Auth tables and `user_role` here.
- `packages/infrastructure/src/db/compat.ts:26-27` -- `SUPPORTED_SCHEMA_MIN = 1`, `SUPPORTED_SCHEMA_MAX = 2`. Raise the max to 3.
- `packages/infrastructure/drizzle/0002_same_kinsey_walden.sql:35` -- the precedent: a generated migration with a hand-appended `INSERT INTO "schema_meta" ("version") VALUES (2)`. `drizzle-kit generate` does not write that line; add it by hand.
- `packages/infrastructure/src/db/schema-range.test.ts` -- fails unless `SUPPORTED_SCHEMA_MAX` equals the highest seeded generation, gapless from 1.
- `packages/infrastructure/src/telemetry/sanitize.ts:1-24` -- `TELEMETRY_FIELD_KEYS` allowlist; it has no `role`, `userId`, `action`, or `outcome` key. Adding one is the intended extension point.
- `packages/infrastructure/src/telemetry/sentry.ts:9-20` -- `TELEMETRY_MESSAGES` allowlist; a new log message must be added here or it is dropped.
- `apps/web/src/bootstrap.ts:23-30,51-77` -- `WebRuntime` exposes `config`, `sql`, `schemaVersion`, `postgresMajor`, `supportedSchemaRange` but **no Drizzle `Database` and no telemetry**. Both are needed to append an audit event from a route; add them here rather than opening a second connection.
- `apps/web/app/api/health/route.ts` -- the established route-handler pattern: `dynamic = 'force-dynamic'`, `Response.json(..., { headers: { 'cache-control': 'no-store' } })`, and `reasonFor()` at line 40 showing that an unauthenticated endpoint echoes only our own error messages, never a driver error. Keep `/api/health` public.
- `apps/web/src/health-route.test.ts:9` -- the route-test template: `vi.mock('./bootstrap')`, then `await import('../app/api/health/route')` inside each test so the mock is in effect.
- `.dependency-cruiser.cjs:103` -- `no-vendor-sdk-in-business-code` already lists `better-auth` among the forbidden specifiers for `domain` and `application`.
- `tests/unit/boundaries.test.ts` -- plants one violating file per rule and asserts the rule name fires; add a `better-auth` case.
- `tests/integration/schema-compat.test.ts:60-74` -- asserts the exact table list; it must be updated for generation 3 or it fails.
- `tests/integration/audit-events.test.ts:54-72` -- `FixedClock`/`FixedIds` doubles and the `describe.skipIf(!databaseUrl)` + prefix-namespaced cleanup pattern to copy.

## Tasks & Acceptance

**Execution:**
- `packages/domain/src/identity/roles.ts` -- define `ROLES` (`auditor`, `audit-manager`, `poc-administrator`), `GATED_ACTIONS`, and `authorizeAction(role, action, context)` returning `{ allowed: true } | { allowed: false, reason: string }`, with the EXPERIENCE.md strings verbatim -- the policy is pure domain data so it can be tested without a database or a framework.
- `packages/domain/src/identity/roles.test.ts` -- table-driven test over every role × action cell, asserting the exact denial string and the author-cannot-approve case -- this is the only place the UX table is enforced.
- `packages/domain/src/index.ts` -- export the identity module.
- `packages/application/src/identity/ports.ts` -- `RoleRepository.findRole(userId)` and `SessionReader.currentSession()` as inward-owned ports returning plain types -- keeps Better Auth and Drizzle out of the application layer (AD-1).
- `packages/application/src/identity/authorize.ts` -- `authorizeCommand({ session, action, context })`: resolve the role through the port, apply the domain policy, and on refusal append `security.denied` inside the unit of work -- one place decides and audits, so no caller can deny without auditing.
- `packages/application/src/identity/record-sign-in.ts` -- `recordSignInAttempt({ outcome, userId, subjectHash, sessionId, correlationId })` appending `security.sign-in` to `platform` -- both success and failure go through one path.
- `packages/application/src/index.ts` -- export the identity ports and use cases.
- `packages/infrastructure/src/db/schema.ts` -- add Better Auth's `auth_user`, `auth_session`, `auth_account`, `auth_verification` and the application-owned `user_role` (user id primary key, role text, `assigned_at`, `assigned_by`, check constraint on the role vocabulary) -- the `auth_` prefix avoids the reserved word `user`, and the separate table is what keeps roles out of the identity provider.
- `packages/infrastructure/drizzle/0003_*.sql` -- generated with `pnpm db:generate`, then hand-append `INSERT INTO "schema_meta" ("version") VALUES (3) ON CONFLICT DO NOTHING;` -- drizzle-kit does not know about the generation convention.
- `packages/infrastructure/src/db/compat.ts` -- raise `SUPPORTED_SCHEMA_MAX` to 3 -- required in the same commit or `schema-range.test.ts` fails.
- `packages/infrastructure/src/identity/auth.ts` -- configure Better Auth over the Drizzle adapter with email and password enabled, table names mapped to the `auth_` prefix, and no role field on the user -- identity and session only.
- `packages/infrastructure/src/identity/role-repository.ts` -- Drizzle implementation of `RoleRepository`, reading `user_role` on every call with no caching -- caching would outlive a revocation.
- `packages/infrastructure/src/telemetry/sanitize.ts` -- add `role`, `userId`, `action` and `outcome` to `TELEMETRY_FIELD_KEYS` -- otherwise sign-in and denial telemetry is silently dropped.
- `packages/infrastructure/src/telemetry/sentry.ts` -- add the new messages to `TELEMETRY_MESSAGES`.
- `apps/web/src/bootstrap.ts` -- add `db` (from `createDb(sql)`) and `telemetry` to `WebRuntime` -- a route cannot append an audit event without them, and a second connection pool would be wrong.
- `apps/web/src/route-access.ts` -- `isPublicPath(pathname)` over an explicit allowlist (`/api/health`, `/api/auth/**`, `/sign-in`, Next static assets) and `PROTECTED_ROUTE_FAMILIES` naming all eight families -- default-deny lives in one testable pure function.
- `apps/web/src/route-access.test.ts` -- assert a representative path from each of the eight families is protected, that the allowlist is exactly as declared, and that an unknown future path is protected -- this is how "every route family" is covered without inventing routes.
- `apps/web/middleware.ts` -- refuse any non-public path without a session cookie: 401 and an empty body for `/api/**`, redirect to `/sign-in` otherwise -- the cheap outer gate that needs no database.
- `apps/web/src/require-role.ts` -- `requireSession(request)` and `requireAction(request, action, context?)` for route handlers: full session lookup, fresh role resolution, and the audited denial -- the middleware cookie check is optimistic, so the real decision happens here.
- `apps/web/src/require-role.test.ts` -- cover no session, session without a role, allowed action, denied action with the exact reason, and revocation taking effect on the next call.
- `apps/web/app/api/auth/[...all]/route.ts` -- mount the Better Auth handler and record both sign-in outcomes through `recordSignInAttempt` -- the only public authentication surface.
- `apps/web/app/api/session/route.ts` -- protected `GET` returning the signed-in user id and freshly resolved role -- the observable proof that role resolution works end to end, and what Story 1.4's shell will read.
- `apps/web/app/sign-in/page.tsx` -- minimal unstyled email and password form posting to the Better Auth endpoint -- makes the story usable without pre-empting Story 1.4's shell.
- `scripts/seed-identity.mts` -- operator-run script creating one user with a role from arguments or environment, never at startup and never with a committed credential -- users must exist before anyone can sign in, and Story 1.5 has not been built.
- `tests/unit/boundaries.test.ts` -- add a case planting a `better-auth` import in `packages/application/src` and asserting `no-vendor-sdk-in-business-code` fires.
- `tests/integration/schema-compat.test.ts` -- update the exact-table contract to the generation-3 list.
- `tests/integration/identity.test.ts` -- against real PostgreSQL: a successful and a failed sign-in each append exactly one `platform` event with the right outcome; a denial appends `security.denied`; deleting the `user_role` row denies the next request while the session row survives; verify the `platform` chain still passes `PostgresAuditChainReader.verify`.
- `.env.example` -- document the Better Auth secret and base URL variables without values.
- `CLAUDE.md` -- record the decisions: roles are never read from Better Auth, the role is never cached, and route protection is default-deny with an explicit allowlist.

**Acceptance Criteria:**
- Given a user with a role, when they sign in with correct credentials, then a session is established, the role is resolved from `user_role`, and exactly one `security.sign-in` event with `outcome: 'success'` is appended to the `platform` chain.
- Given any of the eight protected route families, when an unauthenticated request targets it, then the response carries no protected data and an automated test asserts that family is protected.
- Given a signed-in user, when they invoke an action their role forbids, then the response carries the verbatim EXPERIENCE.md reason and a `security.denied` event is appended with `outcome: 'denied'`.
- Given a live session, when the user's role row is deleted, then the next request is denied and audited while the session row itself remains.
- Given the whole change, when `pnpm boundaries` runs, then no `better-auth`, Drizzle, or Next type has entered `packages/domain` or `packages/application`.
- Given the generation-3 migration, when `pnpm test` runs, then `schema-range.test.ts` passes, proving `SUPPORTED_SCHEMA_MAX` was raised with it.

## Spec Change Log

## Review Triage Log

### 2026-09-02 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 21: (high 6, medium 11, low 4)
- defer: 8: (medium 6, low 2)
- reject: 3
- addressed_findings:
  - `[high]` `[patch]` `authorize.ts` spread order let a caller-supplied `context.actorId` override the session's identity, defeating author-cannot-approve. Context now spreads first and the session id is forced last.
  - `[high]` `[patch]` `authorApprovingOwnVersion` returned false when `authorId` was absent, so omitting it allowed self-approval. Absence now denies.
  - `[high]` `[patch]` `/_next/image` had no trailing slash in `PUBLIC_PATH_PREFIXES`, making `/_next/imagex/...` public — a hole in default-deny.
  - `[high]` `[patch]` The `!token` branch of `handleAuthRequest` returned 503 without revoking, so Better Auth's session row could survive unaudited.
  - `[high]` `[patch]` No test constructs `createAuth`; the integration suite uses `createSeedAuth`, which has sign-up enabled. Inverting `disableSignUp` would ship anonymous registration on a public path with every test still green.
  - `[high]` `[patch]` `GET /api/session`, named in the spec as the observable proof of role resolution, had no test of any kind.
  - `[medium]` `[patch]` A prototype key (`constructor`) passed the `!rule` check and threw instead of denying; now guarded with `Object.hasOwn`.
  - `[medium]` `[patch]` A 5xx from Better Auth was rewritten as 401 "wrong password", reporting an outage as a credential error.
  - `[medium]` `[patch]` A failed `revokeSessionByToken` was swallowed, leaving an unaudited live session with no operator signal.
  - `[medium]` `[patch]` No rate limit configured on the one public credential endpoint; defaults are off outside production.
  - `[medium]` `[patch]` `BETTER_AUTH_URL` accepted `http://` in production, yielding a cookie without Secure.
  - `[medium]` `[patch]` The middleware page redirect carried no `cache-control: no-store`; a shared cache could serve it to a signed-in user.
  - `[medium]` `[patch]` Three of the five denial strings were asserted against the module that defines them. A test now reads EXPERIENCE.md from disk.
  - `[medium]` `[patch]` `revokeSessionByToken` was exercised only through a mock; deleting by the wrong column would have passed.
  - `[medium]` `[patch]` The integration cleanup left the `platform` row in `audit_event_heads`, so a second run of the file failed chain verification.
  - `[medium]` `[patch]` CI's container smoke test curled only the public `/api/health`, so an absent middleware would pass. It now asserts 307 on `/` and 401 on `/api/session`.
  - `[medium]` `[patch]` The two new `BETTER_AUTH_*` config rules had no test.
  - `[medium]` `[patch]` `SAFE_ID_PATTERN` was duplicated into `correlation.ts` with no drift guard, unlike the diff's two other deliberate duplications.
  - `[low]` `[patch]` "Sign-in refused" named three different conditions, including an availability incident, in the log stream.
  - `[low]` `[patch]` The "unrecognized role value" integration case asserted the missing-row path, not the `isRole` guard, and carried a stray no-op assertion.
  - `[low]` `[patch]` The seed script needs a prior `pnpm build` and nothing said so.

Rejected: `auth_account.issuer` claimed unwritable by Better Auth — disproven against the live database, which holds three account rows with `issuer = 'local:credential'`. The cookie-prefix `startsWith` check was claimed forgeable — the outer gate is documented as a hint only and the inner check is authoritative, while an exact match risks breaking Better Auth's own cookie suffixes. A claim that `packages/application` needs its own vitest config — it has no colocated tests.

## Design Notes

**Why the role is never in the token.** AD-7 requires that revoking a role blocks new actions on the next request without ending the session. A role baked into a cookie or JWT survives until that token expires, so revocation would be silently late. `RoleRepository.findRole` therefore runs per request with no cache; the session proves *who*, the `user_role` row decides *what*, and the two are read at different times on purpose.

**Why an email cannot be the audit actor.** `validateAuditEventDraft` restricts `actor.id` to `^[A-Za-z0-9][A-Za-z0-9:._/-]{0,254}$`, which excludes `@`. A failed sign-in for an unknown address therefore records `actor.id: 'unknown'` with `payload.subjectHash` set to the SHA-256 of the lower-cased email. Repeated attempts on one address still correlate, and the immutable chain never stores the address itself. A failed sign-in for a *known* address records that user's id, because attribution is available and FR-45 asks for it.

**Two-layer protection, on purpose.** The middleware cannot reach PostgreSQL — it only sees whether a session cookie is present — so it is an optimistic outer gate that makes an unprotected route impossible by default. The real decision is `requireAction`, which loads the session, resolves the role, applies the domain policy, and audits the refusal. Neither layer alone is sufficient: the first cannot authorize, and the second can be forgotten on a new route.

```ts
// The one shape every gated handler uses.
const decision = await requireAction(request, 'procedure.author');
if (!decision.allowed) {
  return Response.json({ reason: decision.reason }, { status: 403 });
}
```

**Denial strings for unspecified cells.** The EXPERIENCE.md table gives exact copy for five cells and leaves the rest as a bare `—`. Those cells deny with the documented default `"Your role does not permit this action."` rather than inventing role-specific copy; the five specified strings are used verbatim. `[ASSUMPTION]` Confirm this default when Story 1.4 or 1.5 brings the surfaces that show it.

`[ASSUMPTION]` Email and password is the PoC credential mechanism. The spine defers SSO and federation, and Story 1.5 manages users administratively, so there is no self-registration.

## Verification

**Commands:**
- `pnpm -r typecheck` -- expected: clean, and `packages/domain`/`packages/application` still compile without Node ambient types.
- `pnpm boundaries` -- expected: no violations, non-zero module count, and the new `better-auth` boundary case fires when planted.
- `pnpm test` -- expected: all unit tests pass, including the role table, route-access, require-role, schema-range, and boundary suites.
- `pnpm db:generate` -- expected: exactly one new `0003_*.sql`; confirm by hand that the `schema_meta` version-3 insert was appended.
- `pnpm test:integration` -- expected: passes against migrated PostgreSQL 18, including the sign-in, denial, revocation, and chain-verification cases.
- `pnpm build && pnpm --filter @intellifin/web build` -- expected: both succeed; the Next build must be run locally because it is the gate that catches a release-only import leaking into the web bundle.

**Manual checks:**
- Sign in through `/sign-in` as each of the three roles and confirm `GET /api/session` reports the role that `user_role` holds, not anything from the Better Auth user record.

## Auto Run Result

Status: done

**Implemented.** Better Auth 1.7.2 establishes identity and session only; the role lives in the application-owned `user_role` table and is read fresh on every request, so a revocation blocks the next action without ending the session (AD-7). Route protection is default-deny behind an explicit public allowlist. The EXPERIENCE.md action-gating table is a pure domain policy carrying its five denial strings verbatim, and both sign-in outcomes and every refusal land on the `platform` audit chain.

**Files changed.** `packages/domain/src/identity/*` role vocabulary, 24 gated actions and the policy; `packages/application/src/identity/*` the `RoleRepository`/`SessionReader` ports, `authorizeCommand` and `recordSignInAttempt`; `packages/infrastructure/src/identity/*` the Better Auth instance, role repository and session reader; `packages/infrastructure/src/db/schema.ts` plus `drizzle/0003_mature_the_renegades.sql` for the four `auth_*` tables, `user_role` and `auth_rate_limit` at generation 3, with `SUPPORTED_SCHEMA_MAX` raised alongside; `apps/web/middleware.ts`, `src/route-access.ts`, `src/require-role.ts`, `src/sign-in-route.ts`, `src/bootstrap.ts` and the `api/auth`, `api/session` and `sign-in` routes; `scripts/seed-identity.mts` for operator-run user creation; config, telemetry allowlists, CI and the Railway declaration.

**Review findings.** 21 patches applied, 8 deferred (recorded in frontmatter), 3 rejected. Six patches were high severity: a caller-supplied `actorId` could override the session identity and defeat author-cannot-approve; a missing `authorId` allowed self-approval; `/_next/image` without a trailing slash made look-alike paths public, in both the allowlist and the middleware matcher; the sign-in handler's no-token branch returned 503 without revoking; no test constructed the production auth instance, so inverting `disableSignUp` would have shipped anonymous registration green; and `GET /api/session` had no test at all.

**Follow-up review recommended: true.** Patched findings this pass: high 6, medium 11, low 4. Any high severity sets the flag; the score `3x11 + 1x4 = 37` also clears the threshold of 5.

**Verification.** `pnpm -r typecheck` clean; `pnpm boundaries` clean at 82 modules; `pnpm test` 394 tests across 19 files; `pnpm build` and `pnpm --filter @intellifin/web build` both pass; `pnpm db:generate` reports no drift; `pnpm test:integration` 32 tests against real PostgreSQL 18, run twice to prove the suite is re-runnable after the `audit_event_heads` cleanup fix. The five denial strings were grepped against EXPERIENCE.md and match byte for byte. The `middleware.test.ts` 401 assertion was mutation-checked: leaking a body into the refusal fails it.

**Residual risks.**
- Generation 3 was regenerated rather than amended, replacing `0003_overconfident_mad_thinker.sql`. Verified safe: the live worker reports `schemaVersion 2`, so generation 3 has never been applied to any environment, and `release.yml` on `main` is the only migrator.
- Next never actually invokes the middleware under test; the unit tests call the exported function. The new CI smoke assertions (`GET /` expects 307, `GET /api/session` expects 401) narrow this but do not close it. Next 16 also warns the `middleware` convention is deprecated in favour of `proxy`.
- No shipped route calls `requireAction`, because this story forbids creating the surfaces that would. The audited-denial path is proven by unit and integration tests only until Story 1.4 or 1.5 adds the first gated route.
- Sign-out and role changes are not audited. Both belong with Story 1.5's user management and are recorded in `deferred`.
