---
title: 'Enforce the approved non-expiring Admin safeguard'
type: feature
created: '2026-10-01'
status: done
baseline_commit: '9a76c5c8aa38f8e7c16ab95bb1f47b7d70f4057a'
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/implementation-artifacts/admin-continuity-build-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Currently eligible temporary Admins can all expire, and identity deactivation bypasses the membership-only guard.

**Approach:** Enforce the owner-approved invariant: every organisation retains at least one active, non-expiring Admin membership linked to an active application identity. Additional temporary Admins remain allowed. This is a scoped follow-up to accepted Story 20.6; no next batch is authorised.

## Boundaries & Constraints

**Always:** Enforce atomically across membership edits/removal, identity deactivation/removal, concurrent transactions and first organisation provisioning. Preserve ordinary Save, attributed receipts, authority rechecks, audit isolation and revocation fencing. Published migrations/catalogues 1–6 remain byte-identical. Upgrade invalid existing organisations only after explicit remediation; migration never invents authority.

**Ask First:** New identity-administration product authority, emergency recovery exceptions or policy changes. Routine engineering is approved.

**Never:** Merge, deploy, incur cloud costs, start another story, reset the development database, grant runtime identity-deactivation/deletion power, cascade-delete audit history, silently promote/reactivate members or clear expiries. External IdP availability is outside the invariant.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Last qualifying Admin | Remove, deactivate, demote or set expiry; peers temporary/inactive/pending | Refuse atomically; unchanged versions/receipts/authority | Stable last_admin / actionable ordinary-Save message |
| Replacement exists | Active identity and active Admin membership with NULL expiry | Ordinary edits, temporary Admins and deactivation work | No extra approval |
| Concurrency | Two expiries; two identity deactivations; expiry versus deactivation in both orders | At most one unsafe narrowing commits; invariant survives | Guard refusal or safe transaction retry/abort |
| Higher isolation | Stale repeatable-read/serializable snapshot after another narrowing | Cannot commit ownerless state | Serialization failure or explicit isolation refusal |
| Identity removal | Referenced Admin versus unreferenced identity | Last Admin protected; historical FKs retained; harmless deletion succeeds | Atomic guard/FK refusal |
| Multiple organisations | Identity is a required Admin in any organisation | Deactivation refuses in all organisations atomically | No partial change |
| Provision/upgrade | New org plus first Admin; valid/invalid schema-6 data | Atomic provisioning; valid upgrade preserves authority; invalid upgrade rolls back | Actionable preflight/remediation instructions |
| Existing contracts | Temporary Admin access, accepted invitation, retry, stale version, ordinary unchanged edits | Current authority/receipts/assignment expiry and audit boundaries preserved | Existing errors unchanged |

</frozen-after-approval>

## Code Map

- `zobba/migrations/0005_membership_administration.sql`, `0006_evidence.sql` — frozen authority functions, organisation lock 205 and owner RLS policies; add migration 7.
- `zobba/crates/infrastructure/src/{lib.rs,catalog-signature.sql,schema-v*.catalog}` — exact catalogues, function ACLs, migration ledger and grants; new trigger support must remain exact and reject tampering.
- `zobba/crates/infrastructure/src/{membership.rs,identity.rs,fixture.rs}` — stable Z0004 mapping, owner-only identity lifecycle, synthetic first provisioning.
- `zobba/crates/infrastructure/tests/{membership,bootstrap,identity}*` — real PostgreSQL boundaries, upgrades and concurrency; all disposable fixtures must satisfy the invariant.
- `zobba/web/src/{membership.ts,MembershipWorkspace.tsx}` and `zobba/web/tests/browser/membership.spec.ts` — membership error decoding/editor and real-browser regressions.

## Tasks & Acceptance

**Execution:**
- [x] Add database invariant, schema-7 verification and explicit upgrade refusal; preserve existing catalogue security and migration checksums.
- [x] Keep API/UI ordinary Save with actionable last-Admin error; document operator preflight and lifecycle limitations in `zobba/README.md`.
- [x] Correct synthetic fixtures without granting existing auditors new Admin authority; cover every matrix row with executed tests.
- [x] Verify meaningful race schedules with barriers/locks, runtime privilege denial and trigger/function tamper rejection, plus browser refusal and successful replacement/temporary-Admin Save.
- [x] Run combined checks and retain evidence for independent review; the coordinator then owns final review, evidence publication and the authorised push.

**Acceptance Criteria:**
- Database enforcement covers direct owner SQL, not only the membership endpoint, without widening runtime privileges.
- Serialisation does not depend on advisory locks refreshing stale higher-isolation snapshots. Identity-to-org lock inversion, if possible for direct SQL, fails closed with documented retry behavior and an executed regression.
- No organisation can commit without a qualifying Admin; first provisioning and replacement in one transaction work. Existing invalid organisations receive an atomic migration refusal and actionable preflight.
- Browser Save explains establishing another active non-expiring Admin first; there is no approval ceremony.

## Spec Change Log

## Design Notes

Existing app ordering is organisation advisory lock → engagements → identity share lock. Owner identity writes acquire identity rows first. A shared guard-row write can force stale higher-isolation transactions to abort; deferred invariant checks can support atomic provisioning and replacement. These are engineering options, not permission to weaken the invariant. Referenced identity deletion remains prohibited by existing NO ACTION FKs.

## Verification

Use the isolated tools/databases and serial fixture ownership in the build context. Run Rust formatting, strict Clippy, full workspace Rust tests with real PostgreSQL/OIDC, web typecheck/unit/build and full Playwright suite, fixture tests, boundary checks and smoke checks. Record exact commands, counts and failures honestly. Check schema-6 → 7 upgrade, invalid-data rollback and published prefix hashes. Do not treat skipped database tests as verification.

## Verification Evidence

The [checkpoint](zobba-foundation-batch/ADMIN-CONTINUITY-CHECKPOINT.md) records final combined checks, exact commands, retained failures and operating limits. The [independent review](zobba-foundation-batch/ADMIN-CONTINUITY-REVIEW.md) records all eleven repairs and the pre-existing projection deferral. Final source hashes correspond to the passing browser run; the only change after Rust/smoke verification was the independently reviewed browser response-observation helper. No next story, merge or deployment was started.

## Suggested Review Order

**Invariant and transaction boundary**

- Define the exact qualifying Admin predicate at the database boundary.
  [0007_admin_continuity.sql:29](../../zobba/migrations/0007_admin_continuity.sql#L29)

- Fence concurrent membership and identity changes; explicitly refuse stale snapshot isolation.
  [0007_admin_continuity.sql:46](../../zobba/migrations/0007_admin_continuity.sql#L46)

- Check final transaction state so provisioning and replacement remain atomic.
  [0007_admin_continuity.sql:80](../../zobba/migrations/0007_admin_continuity.sql#L80)

**Upgrade and trusted schema**

- Freeze authority writers before explicit preflight; never manufacture a replacement.
  [0007_admin_continuity.sql:11](../../zobba/migrations/0007_admin_continuity.sql#L11)

- Keep new trigger helpers private and bound to the verified owner.
  [lib.rs:250](../../zobba/crates/infrastructure/src/lib.rs#L250)

- Recognize schema7 through its exact catalogue before reading public values.
  [lib.rs:479](../../zobba/crates/infrastructure/src/lib.rs#L479)

**Ordinary Save and operator behavior**

- Expose only the stable public refusal code; keep owner diagnostics private.
  [membership.rs:73](../../zobba/crates/api/src/membership.rs#L73)

- Decode actionable refusals without waiting indefinitely for an optional error body.
  [auth.ts:13](../../zobba/web/src/auth.ts#L13)

- Explain replacement requirements without adding an approval step.
  [MembershipWorkspace.tsx:25](../../zobba/web/src/MembershipWorkspace.tsx#L25)

- Document explicit preflight, lifecycle limits and full-transaction retry behavior.
  [README.md:92](../../zobba/README.md#L92)

**Regression evidence and fixtures**

- Prove actual competing changes using observable database lock barriers.
  [admin_continuity.rs:326](../../zobba/crates/infrastructure/tests/admin_continuity.rs#L326)

- Prove upgrade preservation, invalid-data rollback and concurrent preflight behavior.
  [bootstrap.rs:1398](../../zobba/crates/infrastructure/tests/bootstrap.rs#L1398)

- Verify accepted invitations, permanent replacement, receipts and audit isolation.
  [admin_replacement.rs:154](../../zobba/crates/infrastructure/tests/membership/admin_replacement.rs#L154)

- Exercise refusal and replacement through the running browser and actual API.
  [membership.spec.ts:254](../../zobba/web/tests/browser/membership.spec.ts#L254)

- Restore synthetic authority atomically in organisation-before-identity lock order.
  [cleanup.ts:2](../../zobba/web/tests/browser/cleanup.ts#L2)
