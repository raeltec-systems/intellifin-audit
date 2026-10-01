---
title: '20.6 — Administer membership without granting audit authority'
type: feature
created: '2026-10-01'
status: done
story_key: 20-6-administer-membership-without-granting-audit-authority
review_loop_iteration: 0
baseline_commit: 3db538252b2833ca2ecb4342fb7ca9d69cb7582c
authorization: 'Owner accepted 20.5 and approved the next batch; ordinary engineering choices and story specifications are authorised without another approval checkpoint.'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-20-context.md'
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="owner-authorised canonical Story 20.6">

## Intent

**Problem:** Membership currently requires fixture/owner SQL. Admin needs ordinary invitations, role changes and assignments with immediate, durable revocation.

**Approach:** Add an organisation administration surface and owned Rust membership authority. Accept invitations through verified identity, protect the last Admin and preserve historical authorship.

## Boundaries & Constraints

**Always:** Three existing roles; ordinary validated Save; explicit organisation. Admin alone sees necessary membership/assignment metadata, never audit content or sign-off. Current server identity governs every read, write and retry. Revocation joins the organisation-205 then engagement lock order and cannot revive old execution after regrant.

**Ask First:** Paid infrastructure, external invitation delivery, real customer data/accounts or deployment.

**Never:** Provider roles as application authority, broad runtime membership DML, owner database credentials in API, hidden audit access, deleting authorship, changing published migrations/catalogues 1–4, or claiming absent computer/connector hooks are implemented.

## I/O & Edge-Case Matrix

| Scenario | Input/state | Expected behaviour | Failure handling |
|---|---|---|---|
| Admin Save | Current Admin, exact organisation/version/key | Attributable role or assignment change | Stale version or changed retry conflicts |
| Invitation | Named verified recipient, fixed roles/assignments, expiry | Private one-use invitation; explicit authenticated acceptance | Wrong issuer/recipient, unverified claim, expiry/revocation or departed inviter refuses; never silently overwrite an existing member |
| Retry | Lost acceptance/Save acknowledgement | Recover original exact receipt once | Never regrant authority revoked afterward |
| Last Admin | Concurrent demotion/removal | At least one active eligible Admin remains | Refuse unsafe change atomically |
| Revocation | Removal/narrowing races dispatch or control | Affected scope access and unused claims refuse; old execution/delegation stays fenced after regrant | Other organisations remain available; consumed effects retain uncertainty and late receipts |
| Audience | Admin-only, combined role, foreign organisation, replaced session | Separate administration and assigned audit access | No old data/draft or cross-tenant existence disclosure |

</frozen-after-approval>

## Code Map

- `zobba/crates/infrastructure/src/identity.rs:139`, `oidc.rs:188`, `api/src/auth.rs:298` — verified OIDC identity becomes an opaque session; add session-bound verified recipient proof without trusting profile input.
- `zobba/crates/infrastructure/src/scope.rs:13`, `migrations/0002_identity_scope.sql` — transaction-local actor/scope and forced audit RLS. Administration must not broaden those audit policies accidentally.
- `zobba/crates/infrastructure/src/operation.rs:94`, `task.rs:76` — organisation-205 → engagement → Task fences. Preserve immutable decisions/attempts and late receipt custody.
- `zobba/crates/infrastructure/src/lib.rs:81` — exact runtime privilege/inventory/catalogue verification and explicit migrations; add schema 5, preserving older prefixes.
- `zobba/web/src/App.tsx:80`, `auth.ts:65`, `api/src/operations.rs` — reuse bounded session-bound reads, CSRF/expected-actor writes and ordinary capacity; keep reserved controls independent.
- `zobba/fixtures/oidc/`, `crates/infrastructure/tests/`, `web/tests/browser/account-binding.spec.ts` — actual verified-claim, PostgreSQL and account-switch regressions; legacy user administration is reference only.

## Tasks & Acceptance

**Execution:**
- [x] `crates/domain/src/membership.rs`, `application/src/membership.rs` — bounded role/invitation/assignment meanings, versioned commands, attributable receipts and current-authority ports.
- [x] `migrations/0005_membership_administration.sql`, `infrastructure/src/{membership,lib}.rs` — narrow owned administration persistence, immutable events, last-Admin serialization and durable revocation; schema/privilege refusal regressions.
- [x] `infrastructure/src/{oidc,identity,scope,task,operation}.rs`, `api/src/auth.rs`, `fixtures/oidc/` — verified recipient proof and revocation integration without replacing existing identity/scope/receipt authority.
- [x] `api/src/membership.rs`, `openapi.json`, `web/src/generated/api.ts` — authenticated bounded administration and explicit invitation acceptance; exact idempotency and fresh audience.
- [x] `web/src/{App,MembershipWorkspace}.tsx`, `web/src/membership.ts`, styles and tests — real Admin/member/assignment/invitation flows with keyboard/narrow states and honest saved/error/conflict feedback.
- [x] `crates/*/tests/`, `web/tests/browser/`, `README.md`, `CLAUDE.md` — prove every matrix row, update reusable setup/contracts and record precise remaining limits.

**Acceptance Criteria:**
- Given a current Admin, when an invitation is issued and the verified recipient accepts, then only its current authorised roles/assignments are recorded with both actors.
- Given concurrent attempts to remove the last Admin, when they commit, then one eligible Admin remains.
- Given current or previously revoked membership/assignment, when old sessions, claims or delegation are used, then new disclosure/dispatch refuses while factual history remains intact.
- Given Admin-only and combined roles, when configuration and engagement views open, then their distinct capabilities are explicit and no audit authority comes from Admin alone.

## Spec Change Log

## Design Notes

Use private copyable invitations; no email sender or Sent label. Bind configured issuer and signed verified email to a session established through an OIDC callback within five minutes; this is fresh claim verification, not a claim that the provider forced password/MFA reauthentication. Preserve email local-part case; lowercase ASCII domain. Missing verified email permits existing sign-in but refuses invitation acceptance. Put invitation secrets in fragments, remove them from history and POST as bodies. Before explicit Accept, show the fixed organisation, roles, assignments and expiry behind the same recipient and current-inviter checks; acceptance checks them again. Bound lifetime, lists and receipts; exclude secrets from logs/projections.

Use narrow inventoried SQL entry points for owner-mediated writes; pin definitions/search paths/ownership/EXECUTE and explicitly preserve FORCE RLS. Never supply an owner pool. Recheck Admin after locks. Org-205 then sorted engagement locks serialize narrowing, Task execution-epoch advancement and abandonment of unused Task/operation claims. Revoke affected delegation durably; retain consumed facts. Existing sessions lose affected scope access without global logout. Regrant cannot revive old execution. Ordinary edits need no second approver.

Paths under `crates/`, `migrations/`, `fixtures/` and `web/` are relative to `zobba/`. The lead may delegate disjoint files after agreeing contracts; serialize schema edits. Root owns spec/status, review, commits and pushes. Use `/workspace/zobba-build-tools/activate-tests.sh` for test shells: it loads the toolchain and unsets the non-test development migration/runtime URLs. Supply an explicit guarded `*_test` URL for any CLI invocation. The lead exclusively owns guarded `zobba_story_20_test` and `zobba_patch20_3_test` on localhost:55434 plus test IdP 9444 until handback; serialize destructive suites per database. Patch roles are `zobba_patch20_3_owner`/`zobba_patch20_3_app`, fixture administrator `zobba_local_admin`. Never reset development or stop IdP 9443. Resolve ordinary choices within this contract.

## Verification

Run formatting, locked warnings-as-errors Clippy/test/build, frozen pnpm/check/build, fixture tests, Python guards, boundaries, process smoke then real Chromium. Cover actual invitation replay/expiry/issuer/email failures, concurrent last-Admin removal, Save conflicts, both revocation/consumption orders, late facts, revoke/regrant, foreign scope and role changes in browser. Prove schema 4→5 and unchanged 1–4 bytes under restricted owner/runtime roles. Record executed results and independent review before completion.

## Suggested Review Order

**Request and authority boundaries**

- See separate administration routes and shared session-bound request handling.
  [membership.rs:29](../../zobba/crates/api/src/membership.rs#L29)

- Follow locked writes, verified recipient terms and immutable receipt recovery.
  [0005_membership_administration.sql:186](../../zobba/migrations/0005_membership_administration.sql#L186)

- Inspect affected-scope fencing and conservative finite-grant renewal.
  [0005_membership_administration.sql:146](../../zobba/migrations/0005_membership_administration.sql#L146)

- Check exact function inventory, ownership, security attributes and runtime grants.
  [lib.rs:198](../../zobba/crates/infrastructure/src/lib.rs#L198)

- Bind signed recipient evidence to the callback-created session.
  [auth.rs:298](../../zobba/crates/api/src/auth.rs#L298)

**Browser behavior**

- Preserve opened assignment semantics, expiry and explicit renewal intent.
  [MembershipWorkspace.tsx:144](../../zobba/web/src/MembershipWorkspace.tsx#L144)

- Withdraw private state on audience changes and retain sign-out intent.
  [MembershipWorkspace.tsx:312](../../zobba/web/src/MembershipWorkspace.tsx#L312)

**Verification and operation**

- Force real expiry between fencing and write, then verify durable authority.
  [expiry_split.rs:1](../../zobba/crates/infrastructure/tests/membership/expiry_split.rs#L1)

- Exercise invitations, account changes, paging and expired-editor flows in Chromium.
  [membership.spec.ts:1](../../zobba/web/tests/browser/membership.spec.ts#L1)

- Read final checks, independent findings, local recovery and remaining limits.
  [story-20-6-implementation-evidence.md:1](story-20-6-implementation-evidence.md#L1)
