---
title: 'Story 1.5: Manage users and roles'
type: 'feature'
created: '2026-09-02'
status: 'in-review'
baseline_revision: 'f19a5066b6b263f8a06d716d96fc91b5e7152de9'
baseline_commit: 'f19a5066b6b263f8a06d716d96fc91b5e7152de9'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/CLAUDE.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
warnings:
  - oversized
deferred:
  - id: 'ending-another-persons-session'
    summary: >-
      There is no way to end somebody else's session. `SessionWriter` exists and is wired
      only to self sign-out, and role revocation deliberately leaves the session alive
      (AD-7), so a departing or compromised account keeps whatever session it already
      holds until that session expires.
    evidence: >-
      `packages/application/src/identity/ports.ts` declares `SessionWriter.revokeSession`;
      the only caller is `signOut` in `record-sign-out.ts`, reached only from
      `apps/web/src/sign-out-route.ts` for the caller's OWN session. Proven by
      `tests/integration/manage-users.test.ts` — "clears a role, keeping the account and
      its sessions" asserts the session row survives a revocation. Better Auth's own
      `revoke-session`, `revoke-sessions` and `revoke-other-sessions` endpoints are now
      refused (`SERVED_AUTH_ENDPOINTS` in `apps/web/src/sign-in-route.ts`) because they
      end sessions with nothing in the audit chain; an audited administrator-facing
      version needs its own story.
    why_deferred: >-
      It is a new audited command with its own surface, its own confirmation weight and
      its own event type, on a session model this story does not otherwise touch.
  - id: 'javascript-only-sign-in'
    summary: >-
      The sign-in form works only once React has hydrated. Its `method="post"` keeps a
      pre-hydration submission from putting the password in a URL, so it fails safe and
      visibly — the person stays on the sign-in page — but it does not work without
      JavaScript, unlike the sign-out control this story rebuilt.
    evidence: >-
      `apps/web/src/sign-in-form.tsx` submits through `fetch`; the form's own comment
      records that a native POST to `/sign-in` has no handler and answers 405.
    why_deferred: >-
      A server-side path means a POST route reproducing the non-disclosure rules and the
      rate-limit handling that `handleAuthRequest` owns (Story 1.3), including the 429
      and 503 answers. That is Story 1.3's surface, not this one's.
  - id: 'user-list-pagination-and-search'
    summary: >-
      The user list returns at most `USER_LIST_LIMIT` (200) accounts, oldest first, and
      says so when it truncates. There is no paging and no search.
    evidence: >-
      `USER_LIST_LIMIT` in `packages/infrastructure/src/identity/role-repository.ts`;
      `UsersPanel` renders the truncation notice.
    why_deferred: >-
      The PoC has a handful of accounts. Paging is a surface change with its own query,
      URL state and accessibility work, and the limit removes the unbounded query that
      actually mattered.
---

<intent-contract>

## Intent

**Problem:** A user can only be created by an operator running `pnpm seed:identity` from a shell with the database URL and a password in the environment. A PoC Administrator has no way to add an Auditor, and no way to change or remove a role. Worse, a role change today writes `user_role` with no audit event at all, so the privilege change behind an audited denial is itself invisible.

**Approach:** Give the Administration surface a user list and two audited commands — create a user, and set a user's role — behind the authorization path Story 1.4 wired. Every mutation names its prior and new value in one `configuration` audit event committed in the same transaction as the change, and every mutation is confirmed with a routine dialog. Public self-registration stays impossible.

## Boundaries & Constraints

**Always:**
- The publicly mounted Better Auth handler keeps `disableSignUp: true`. A user is created only by an authorized, audited application command; there is never a public path to account creation.
- Every mutation is authorized through `requireAction('administration.users.manage')` on the server, which resolves the role fresh and audits refusals. Hiding the surface is never the control.
- The role write and its audit event commit in one transaction, or neither happens. The event records the actor, the subject user, the prior value and the new value; a first assignment records the prior value as `null`.
- A role change takes effect on the subject's next request without ending their session (AD-7).
- A PoC Administrator cannot author Procedures, start Runs, approve anything, or alter Evidence, evaluations, Results or reviews, and this surface introduces no override, escalation or impersonation path.
- Mutating actions use the routine confirmation dialog and state the consequence; the result appears as a Banner.
- No password is ever logged, audited, echoed in a response, or placed in a URL.
- An email address never enters the audit chain as `actor.id` or in a payload; the subject is identified by user id (`SAFE_ID_PATTERN` has no `@`).

**Block If:**
- Delivering this requires a public sign-up path, or an impersonation or role-escalation mechanism.
- Delivering this requires changing an approved requirement, an AD, or a pinned dependency major.

**Never:**
- No Target System registrations, Population Source bindings or diagnostics — Stories 1.6, 1.7 and 9.2 own those Administration tabs.
- No invite emails, password reset, or self-service profile editing.
- No user deletion. Removing a role is the revocation mechanism; deleting the account would orphan its audit history.
- No bulk import, no CSV, no scripted mutation surface.
- No role cached anywhere, and no role written into a Better Auth field.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Administrator lists users | Signed in as `poc-administrator` | Each user with their current role, or "No role" | No password material in the response |
| Administrator creates a user | New address, name, role | Account created, role assigned, one `configuration` event with `priorRole: null` | Both writes commit together or neither |
| Duplicate address | Address already registered | Refused with a stated reason; no second account, no event | The existing account is unchanged |
| Administrator changes a role | User holds `auditor`, set to `audit-manager` | Role updated; one event carries `priorRole: 'auditor'`, `newRole: 'audit-manager'` | Committed atomically |
| Administrator removes a role | User holds `auditor`, role cleared | `user_role` row removed; event carries `newRole: null` | The account and its sessions survive |
| Change takes effect | Subject has a live session when their role changes | Their next request is authorized against the new role; the session is not ended | Never an abrupt sign-out |
| Audit append fails | Database error during the command | The role change does not happen and the surface says so | Fail closed; never an unaudited privilege change |
| Auditor reaches the surface | Signed in as `auditor`, types the path | Refused with the verbatim reason, refusal audited, no user data in the response | The list is never rendered |
| Administrator attempts a gated action | Any `procedure.*`, `result.*`, `evaluation.*` action | Refused with the stated reason; no override exists anywhere | Proven over the whole action set |
| Public sign-up attempt | `POST /api/auth/sign-up/email` | Refused by the running application | Anonymous account creation stays impossible |

</intent-contract>

## Code Map

- `packages/domain/src/identity/roles.ts` -- `ROLES`, `authorizeAction`, `DENIAL_REASONS`. `administration.users.manage` already exists and is administrator-only. The "no override path" criterion is a test over `GATED_ACTIONS` x `poc-administrator`, not new policy.
- `packages/application/src/identity/ports.ts` -- `RoleRepository` is read-only (`findRole`). This story adds the write port and a user-creation port beside it, both in plain types.
- `packages/application/src/identity/authorize.ts` -- `authorizeCommand` resolves the role and audits refusals inside the unit of work. The new commands reuse it; they never re-implement the check.
- `packages/infrastructure/src/db/audit-events.ts:123` -- `PostgresAuditUnitOfWork.execute` gives one transaction. The role write must happen **inside** that callback so the change and its event share it.
- `packages/domain/src/audit-event.ts:9-20` -- `AUDIT_EVENT_FAMILIES` already has `configuration`; `eventType` must match `^configuration\.[a-z0-9]+([._-][a-z0-9]+)*$`. `FORBIDDEN_PAYLOAD_KEYS` will reject any key ending in `password`.
- `packages/infrastructure/src/identity/role-repository.ts:18` -- `DrizzleRoleRepository` reads `user_role` with no cache. Add the write here; it must accept a transaction so it can join the unit of work.
- `packages/infrastructure/src/identity/auth.ts:112,121` -- `createAuth` has `allowSignUp: false` and is what the route mounts; `createSeedAuth` has `allowSignUp: true` and is how `scripts/seed-identity.mts` creates users. The admin command needs the same privileged capability server-side. Reaching it from a route is only safe because `requireAction` gates the command; an integration test must keep proving the mounted handler still refuses `sign-up/email`.
- `packages/infrastructure/src/db/schema.ts` -- `user_role` has `user_id`, `role`, `assigned_at`, `assigned_by`. `assigned_by` has no foreign key (a Story 1.4 deferred finding); this story starts writing it for real, so decide whether to add the constraint. If a migration is added it is generation 4 and `SUPPORTED_SCHEMA_MAX` rises in the same commit or `schema-range.test.ts` fails.
- `apps/web/app/administration/page.tsx` -- the Story 1.4 surface; today it calls `requireServerAction` and renders an `EmptyState`. The list replaces the empty state; the refusal branch stays exactly as it is.
- `apps/web/src/design/ConfirmDialog.tsx` -- the three weights. Every mutation here is `routine`; it restates the consequence.
- `apps/web/src/design/DataTable.tsx` -- `<th scope>`, caption, focusable first cell, no row click handler. The user list uses it.
- `apps/web/src/require-role.ts` / `apps/web/src/server-session.ts` -- `requireServerAction` and the React-`cache`d session resolution. Server Actions must go through the same path; a Server Action is a POST endpoint and is **not** covered by the page's check.
- `scripts/seed-identity.mts` -- the operator path. It stays: the first administrator has to exist before anyone can sign in and use this surface.
- `tests/e2e/accounts.ts` -- the two seeded accounts and the saved sessions the browser suite reuses.

## Tasks & Acceptance

**Execution:**
- `packages/application/src/identity/ports.ts` -- add `RoleWriter` (set and clear a role, transaction-scoped) and `UserCreator` (create an account, returning its id) as inward-owned ports -- keeps Better Auth and Drizzle out of the application layer.
- `packages/application/src/identity/manage-users.ts` -- `createUserWithRole` and `setUserRole`: authorize, read the prior role, write, and append one `configuration.user-created` / `configuration.role-changed` event carrying actor, subject, prior and new value, all inside one unit of work -- one place decides, writes and audits, so a privilege change cannot happen unaudited.
- `packages/application/src/identity/manage-users.test.ts` -- prior/new values including the `null` cases, and that a failing append leaves the role unchanged.
- `packages/infrastructure/src/identity/role-repository.ts` -- implement `RoleWriter` over the transaction handle; no cache, no read-modify-write outside the transaction.
- `packages/infrastructure/src/identity/user-creator.ts` -- implement `UserCreator` using the privileged auth instance, server-side only.
- `apps/web/app/administration/page.tsx` -- render the user list with `DataTable`; keep the refusal branch unchanged.
- `apps/web/app/administration/actions.ts` -- Server Actions for both commands, each calling `requireServerAction('administration.users.manage')` **first** -- a Server Action is its own POST endpoint and the page's check does not protect it.
- `apps/web/src/admin/UserForm.tsx`, `RoleControl.tsx` -- the create form and the role control, each confirming through the routine dialog and reporting the outcome in a Banner.
- `apps/web/app/administration/actions.test.ts` -- an unauthenticated and an auditor caller are refused **by the action itself**, not only by the page.
- `tests/unit/no-override-path.test.ts` -- assert that for every entry in `GATED_ACTIONS`, `authorizeAction('poc-administrator', action)` denies everything outside the administration family, with the stated reason -- the "no override path" criterion, proven over the whole set rather than by example.
- `tests/integration/manage-users.test.ts` -- against real PostgreSQL: create, change and clear a role each append exactly one event with the right prior and new values; a live session sees the new role on its next resolution and the session row survives; a forced append failure leaves `user_role` unchanged; and the mounted `createAuth` handler still refuses `sign-up/email`.
- `tests/e2e/administration.spec.ts` -- an administrator creates a user and changes a role through the real UI with the confirmation dialog; an auditor is refused; axe finds no WCAG 2.1 AA violation on the populated surface.
- `CLAUDE.md` -- record that a Server Action needs its own authorization check, and that user creation is an audited command rather than a public endpoint.

**Acceptance Criteria:**
- Given a PoC Administrator, when they create a user or change a role, then the change is written and exactly one `configuration` event records the actor, the subject, the prior value and the new value.
- Given a user with a live session, when an administrator changes their role, then their next request is authorized against the new role and their session is not ended.
- Given an Auditor or an unauthenticated caller, when they invoke the administration Server Actions directly, then each is refused by the action itself and the refusal is audited.
- Given the whole gated action set, when a PoC Administrator is evaluated against it, then every non-administration action is denied with its stated reason and no override path exists.
- Given a failure appending the audit event, when a role change is attempted, then the role is unchanged.
- Given the running application, when `POST /api/auth/sign-up/email` is called, then it is refused.

## Spec Change Log

- **2026-09-02 — `assigned_by` gets its foreign key.** The Code Map left the decision open. It is added: generation 4 (`0004_aberrant_caretaker.sql`) references `auth_user(id)` `ON DELETE SET NULL`, and `SUPPORTED_SCHEMA_MAX` rises to 4 in the same commit. `CASCADE` was rejected — deleting the administrator who granted a role would delete the role, a silent revocation nothing audited. An attribution column that can hold any string is not an attribution, and this story is the first thing that writes it.
- **2026-09-02 — one composing client component beyond the two named.** `apps/web/src/admin/UsersPanel.tsx` holds the surface's single Banner and passes an `onResult` callback to `UserForm` and `RoleControl`. EXPERIENCE.md puts the result of a mutating action in *a* Banner on the surface; a banner inside each control is several live regions competing to announce. `roles.ts` beside them holds the labels and the option list, derived from `ROLES`.
- **2026-09-02 — `DataTable`'s first-cell `href` becomes optional.** The user list has no detail surface. The contract's rule ("every row's first cell is a link; no row-level click handlers") exists so a row is never a click target a keyboard cannot reach; a table with no target satisfies it, and inventing an `href` to a page that does not exist would satisfy the letter while sending people to a 404. There is still no `onRowClick` prop, so the structural guarantee is unchanged.
- **2026-09-02 — the user creator does not trust Better Auth's answer.** Discovered while writing `tests/integration/manage-users.test.ts`: Better Auth 1.7.2 answers a sign-up for an ALREADY REGISTERED address with a fabricated user object — a fresh id, no row written, no error raised. Taken at its word the command would have written a role and a `configuration.user-created` event for a subject that never existed. `BetterAuthUserCreator` now checks the address before and re-reads the returned id after; the `user_role` foreign key is the third line of the same defence.
- **2026-09-02 — the identity unit of work is new infrastructure.** `PostgresIdentityUnitOfWork` yields the audit appender plus `RoleWriter`, `UserCreator` and `SessionWriter`, all bound to one transaction. Better Auth joins that transaction because the Drizzle adapter uses whatever handle it is given, so an account, its role and their event commit together or not at all — proven by "creates no account when the audit append fails".
### Review pass 2 (three review passes, applied 2026-09-02)

- **Lockout guards.** Nothing stopped an administrator demoting themselves or removing the last `poc-administrator`, and with no sign-up endpoint and no user deletion, recovery from either is shell access plus `pnpm seed:identity`. `setUserRole` now refuses a self-change before it opens a transaction, and refuses any change leaving zero holders — counted INSIDE the transaction, after a `SELECT ... FOR UPDATE` over the holders taken BEFORE the write. The lock is the part that matters: under READ COMMITTED two administrators demoting each other each count one remaining holder and both commit. The integration test holds the first transaction open across the second, and fails when the lock is removed.
- **Open redirect.** `sign-out-route.ts` built its `Location` from `request.url`, whose host behind a proxy comes from the client's `Host` header — a forged one redirects the browser to an attacker origin at the moment its cookies are cleared. Both redirects in `apps/web` now use a relative path; `middleware.ts` had the same construction via `request.nextUrl` and no longer uses `NextResponse.redirect`.
- **The form-method guard did not guard.** It asserted `/\bmethod=/`, so `method="get"` — the credential-in-URL defect itself — passed; it matched tags with `[^>]*`, which truncates at the `=>` of a JSX handler; and it scanned `.tsx` only, missing `sign-out-route.ts`, which emits raw HTML. Rewritten to require `post`, parse the tag brace- and quote-aware, scan `.ts` too, and tolerate an unstatable path. Mutation-tested three ways.
- **Silence after a Server Action.** `UserForm` and `RoleControl` wrapped the action in `try/finally` with no `catch`, so a rejection stopped the spinner and showed nothing — the sign-out defect class again. Both now catch and report a Banner.
- **Unaudited auth endpoints.** Probing the mounted handler found `revoke-session`, `revoke-sessions`, `revoke-other-sessions`, `update-user`, `change-password`, `change-email`, `delete-user` and `reset-password` all live on the publicly allowlisted `/api/auth/**`, none audited. `/api/auth/` is now an ALLOWLIST of three (`sign-in/email`, `sign-out`, `get-session`); everything else answers 404 before the runtime is touched.
- **Untrusted Server Action input**, a case-insensitive unique index on `lower(email)` in generation 4, a lazily built privileged auth instance, optimistic concurrency on the role change, a no-op that writes nothing, and a bounded user list — each recorded in CLAUDE.md.

- **2026-09-02 — the sign-out control is a native form, after a defect found in review.** The first implementation was a `fetch` inside an `onClick` handler on a `'use client'` component. Before React hydrates that handler is not attached, so a click was swallowed entirely: no request, no navigation, no message — and at a shared workstation a person walks away believing the session ended. It is now `<form method="post" action="/api/auth/sign-out">` submitted by the browser, answering a 303 to `/sign-in`; the route is idempotent and the failure path answers HTML, because the caller is a browser and not a script. `tests/e2e/administration.spec.ts` runs the journey with `javaScriptEnabled: false`, which fails every time on the old implementation rather than intermittently (verified by reverting it).
- **2026-09-02 — `UserForm` gains `method="post"`.** Found by the same audit. A `<form>` with no method submits as a GET, so a submission that beat hydration would have put the initial password in the URL, in browser history and in every access log — against this story's own "no password is ever ... placed in a URL". The administration controls still require JavaScript by contract (EXPERIENCE.md mandates a focus-trapping confirmation dialog on every administration mutation); the requirement met here is that a pre-hydration submission be safe and visibly do nothing.
- **2026-09-02 — `auth.setup.ts` clears `auth_rate_limit` before the browser suite.** Three consecutive local runs exhausted the real ten-per-minute sign-in limit and the third failed at setup. CI gets a fresh database per run, so this only bites when one database serves repeated runs. The limiter stays enabled throughout; only the budget carried between runs is removed.
- **2026-09-02 — sign-out is implemented as an interception, not a Better Auth passthrough.** Better Auth's `/sign-out` commits the session deletion on its own connection and so cannot be atomic with the event. `apps/web/src/sign-out-route.ts` handles `POST /api/auth/sign-out`, revokes the session row inside the audit transaction, and clears the cookies itself. This is the piece the Design Notes flagged as removable; `SignOutButton.tsx`, that file, and one line in `AppShell.tsx` are the whole of it.

## Review Triage Log

## Design Notes

**Why the write must join the audit transaction.** `PostgresAuditUnitOfWork.execute` opens one PostgreSQL transaction and hands the callback an `auditEvents.append`. If the role were written through a repository bound to the pool instead of that transaction, a failed append would leave the privilege change committed and unrecorded — exactly the state FR-45 exists to prevent. The `RoleWriter` port therefore takes the transaction-scoped handle, and the integration test forces an append failure and asserts `user_role` is untouched.

**Why a Server Action needs its own check.** The Administration page calls `requireServerAction`, but a Server Action is a separate POST endpoint that Next exposes by id; reaching the page is not a precondition for invoking it. Each action authorizes first, before reading any input. The test asserts this against the action, not the page, because that is the surface an attacker has.

**Prior value, and why `null` is a value.** A first assignment records `priorRole: null` and a revocation records `newRole: null`. Both are real transitions and both must be reconstructable from the chain alone, so the event always carries both keys rather than omitting one.

**The administrator knows every password they set, and nothing forces a change.** This
surface has the administrator type an initial password and hand it over directly — there
are no invite emails and no reset flow, because this deployment sends no mail. The
consequence is explicit and accepted: a PoC Administrator holds a working credential for
every account they create, so "PoC Administrator cannot author Procedures" is a policy
boundary rather than a cryptographic one, and the audit chain would attribute anything
done with that credential to the account it belongs to rather than to the administrator.

It is recorded here rather than solved because every solution is a story of its own: a
forced change at first sign-in needs a password-change command, an audited event, and a
gate on every other surface; an invite link needs mail. Neither is in this story's scope,
and both are worse than useless if half-built. What this story does do is keep the blast
radius honest — the password is never stored, logged, audited, echoed or placed in a URL,
the field is cleared as soon as it is used, and the account it creates is one the chain
names from its first request.

`[ASSUMPTION]` The story adds no user deletion. Removing the role is the revocation mechanism; deleting an account would orphan the audit history that names it, which AD-22 forbids in spirit.

**One addition beyond the acceptance criteria, flagged deliberately.** There is still no way to sign out: a session ends only by clearing cookies. Story 1.4 left it out because DESIGN.md specifies the top bar as the notification bell alone, and neither this story's criteria nor 1.4's mention it. For a product whose whole premise is attributable action at a shared workstation, shipping Epic 1 with no sign-out is a security gap that no story owns. This story therefore adds a sign-out control and audits `security.sign-out`, and this note is the flag: if the top bar must stay bell-only, revert this one piece — nothing else depends on it.

## Verification

**Commands:**
- `pnpm -r typecheck` and `pnpm typecheck` -- expected: clean.
- `pnpm boundaries` -- expected: clean; no Better Auth or Drizzle type in `domain` or `application`.
- `pnpm test` -- expected: all pass, including the no-override-path sweep.
- `pnpm build && pnpm --filter @intellifin/web build` -- expected: both succeed.
- `pnpm db:generate` -- expected: no drift, or exactly one generation-4 migration with `SUPPORTED_SCHEMA_MAX` raised in the same commit.
- `pnpm test:integration` -- expected: passes twice in a row against PostgreSQL 18.
- `pnpm test:e2e` -- expected: passes with zero WCAG 2.1 AA violations.

**Manual checks:**
- As an administrator, create a user and change a role, then read the `platform` chain and confirm each event names the actor, the subject, and both values.
