---
title: 'AW P3: approved manager control-transfer authority'
type: feature
created: '2026-09-20'
status: done
baseline_commit: 00de6c32b0c5d3be00599f9ceb2d03855ba691a8
review_loop_iteration: 1
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/docs/workstreams/auditor-workspace/spec-v1.1.md'
  - '{project-root}/_bmad-output/implementation-artifacts/decision-aw-manager-transfer-d3.md'
---

## Authority decision

D3 was explicitly approved by the user on 20 September 2026: a separately granted `run.control-transfer` permission for an Audit Manager, required reason and audited epoch change. Administrator status alone is insufficient. Preserve accepted safety holds and independent answer, approval and review permissions. No further routine approval is required to implement this agreed flow; merge/deployment remain outside scope.

## Intent and boundaries

Allow a currently eligible, separately permitted manager to take the active controller lease for themselves after reviewing its current holder and providing a reason. Freeze the observed epoch in the confirmation. Transfer is a distinct command, not an acquire bypass, and must not reopen a terminal Run or silently resume work. Current holder release and normal expired/unheld acquisition continue unchanged.

Add the permission to the existing user-administration workflow: only an actor authorized for `administration.users.manage` can grant or revoke it, and only an Audit Manager may receive it. Do not automatically grant it to existing managers or administrators. Role removal/demotion clears the grant atomically so promotion later cannot resurrect authority. Retain grant/revocation audit receipts. Changing these grants must not change existing last-administrator or author/approver safeguards.

## Command and persistence contract

- Server derives actor/session, fresh role and fresh explicit grant. Browser supplies only exact Run, observed epoch, request key and bounded reason through a governed input boundary.
- Acquire the canonical Run lock, then reauthorize and validate active state, epoch and intended self-holder. A concurrent role/grant revocation must serialize or make the transfer fail; adopt one documented lock order consistent with administration and other Run commands.
- Retain the reason in governed encrypted content and safe references in events. Do not put free-form reasons in notifications, logs, event payloads or queue data. Content availability and exact request meaning are checked when confirming; an unknown outcome retains its original identity.
- Transfer writes the new holder, monotonic epoch, PostgreSQL-time expiry and exact event/receipt in one transaction. Bind this exceptional live-holder transition to an explicit immutable transfer marker and matching event; preserve ordinary lease guards. No generic SQL flag may bypass the live-holder guard.
- Same actor/Run/key and exact payload replays the original receipt after fresh authorization without a second epoch change. Changed payload conflicts. A receipt proves a past transfer; current ownership always comes from a fresh read.
- Unapplied discretionary directions remain tied to their original epoch and are superseded/refused at consumption. Never clear or change accepted Pause/Stop, open question/options, frozen plan, evaluation or Result authority. No new execution job is created merely because control changes.

## Locking and safety classification

Transfer uses `audit_run FOR UPDATE`, then the acting manager's stable `auth_user` row
lock, then fresh role/grant reads and lease/receipt writes. Role/grant administration
retains its ordered administrator-holder locking, then locks BOTH actor and target
`auth_user` rows in sorted user-ID order, and never acquires a Run lock. A stable identity lock is necessary when a role or
grant row is absent. Include both actor and subject authorization races in the test matrix;
preserve the existing last-administrator protection and audit-head lock order.

An **accepted deferred inspection Pause is already a safety latch**. Its existing contract
deliberately survives later role/lease changes. Transfer must preserve it, just as it
preserves accepted immediate Pause and Stop. Do not add a worker epoch rejection that
cancels this accepted latch. Epoch invalidation applies to unconfirmed discretionary
proposals and to future queued strategy directions, whose execution fences belong to the
frozen-strategy slice. Prove that transfer invalidates a stale Resume/steering proposal
while the accepted deferred Pause still applies at its named boundary.

## Interface

Show transfer only to a freshly eligible manager. The review names the current controller, the manager taking control, the reason and consequences for outstanding discretionary directions. Keep keyboard focus/cancel behavior consistent with existing confirmation dialogs. On both viewers show the resulting named controller and truthful command history; discard stale async ownership reads. A failure or unknown outcome does not restore the previous owner from a receipt. Read-only observers receive the authorized safe receipt projection without access to withheld reason content.

## Code map

Use `packages/domain/src/identity/roles.ts` for role eligibility and a dedicated persisted grant through identity ports/repository; role eligibility alone must not satisfy transfer. Extend the existing `manage-users` application service and administration UI for explicit grant/revoke. Reuse `run-control-lease.ts`, its PostgreSQL repository and current read publication for the distinct transfer command. Add governed reason content via the established content boundary rather than raw audit JSON. Extend schema/migrations, compatibility and strict event validators. Consult all lease and queued-direction consumers before changing the guard.

## Acceptance matrix

Prove eligible manager with grant; manager without grant; administrator and auditor denial; role/grant revocation before and during lock wait; demotion/promotion without grant resurrection; two competing transfers; same actor reacquisition; exact lost-response retry; changed reason/epoch conflict; missing/corrupt/removed reason; SQL forged marker/event; transfer rollback; terminal refusal; both viewer updates; ordinary release/acquire; stale direction rejection at real worker boundary; accepted safety hold preservation; open question and existing review permissions unchanged.

Run focused unit and PostgreSQL grant/lease/conversation tests, authenticated manager/admin/two-viewer browser journeys, real worker discretionary fencing and complete type/boundary/unit checks. Parent coordinates databases and browser processes. Update D3 decision surface, P3 checkpoint, continuation report and shared decisions with actual verification. Approval is recorded; do not leave this slice disabled merely because older documents still call D3 pending.

## §0 Implementation readiness and dependencies

This is an additive implementation of approved D3. Existing role, author/approver,
last-administrator, exact-question-answer and safety-latch invariants remain binding.
The answer slice must be committed before required identity ports or migration 0060
are introduced. No schema changes belong in answer migration 0059. The implementation
may proceed without another authority decision; completion requires the verification
matrix below, not this readiness status.

## Exact identity contract

- Add `ExplicitPermission = 'run.control-transfer'` in the domain identity policy. Add
  the action to the action vocabulary with Audit Manager role eligibility. Full
  `authorizeAction` requires a server-supplied explicit permission as well as that role;
  `authorizeActionRole` remains eligibility preflight and cannot authorize transfer alone.
  No existing role receives an implicit grant and the administrator denial stays intact.
- `PermissionGrantState` is `{ granted: boolean; revision: number }`. Missing storage
  reads as `{ granted: false, revision: 0 }`. Retain a row after revocation, incrementing
  revision on each actual toggle; re-grant therefore cannot be mistaken for an older
  grant. No-op writes create neither a revision nor an audit event.
- `PermissionGrantReader.readGrant(userId, permission)` reads storage afresh.
  `PermissionGrantWriter` extends it with
  `setGrant({ userId, permission, granted, assignedBy }): Promise<PermissionGrantState>`.
  The writer is transaction-bound and rejects revision overflow. `IdentityUnitOfWorkContext`
  requires `permissions: PermissionGrantWriter`; no optional default silently skips it.
- `RoleWriter.lockUser(userId): Promise<boolean>` locks the stable `auth_user` row and
  reports whether it exists. Grant and role commands lock ordered administrator-holder
  rows first, then distinct actor/subject identities sorted by user ID, then reread actor
  role and subject role/grant. User creation locks administrator holders and actor identity
  before fresh authorization. An absent role/grant row is not a substitute for that lock.
- `ManagedUser.runControlTransferGrant` is a required `PermissionGrantState`, loaded by
  the existing directory. Administration exposes a separate grant/revoke control for
  managers; creating/promoting a manager never checks it automatically.
- `setUserRunControlTransferGrant` accepts the authenticated session, correlation ID,
  subject user ID, desired `granted` boolean and required `expectedGrantRevision` integer.
  It authorizes administration before input/subject reads; reauthorizes under locks;
  requires the subject's current role to be Audit Manager for granting; compares the
  revision even when the requested boolean equals the current value; and toggles plus
  appends one `configuration.user-permission-changed` event in the same unit of work.
  Revoking a retained grant is permitted even if a corrupt/legacy role is ineligible.
- The grant event has exactly `subjectUserId`, `permission`, `priorGranted`, `granted`,
  `priorRevision`, `revision`, and `cause` (`administration` or `role-change`). Its actor
  is the current administrator; no email, name or free-form reason enters this event.
- `setUserRole` revokes any live transfer grant before demotion/removal within the same
  transaction and appends its separate grant-change event alongside the role-change
  event. Promotion and role re-assignment never resurrect a tombstoned grant. All writes
  roll back if either event or the last-administrator check fails. A revoked actor is
  denied under the lock, then its denial is audited after rollback.

## Transfer command and storage design

Use a distinct transfer application service and repository adjunct; ordinary acquire,
renew and release semantics and their existing application port remain intact.

1. `proposeRunControlTransfer` accepts exact `{ runId, expectedEpoch, requestKey, reason }`.
   UUIDs are normalized; epoch is a positive PostgreSQL integer; reason is required,
   trimmed once, valid Unicode, at most 1,000 characters and 4,000 UTF-8 bytes. Reject
   obvious secret-like content before persistence. Unknown fields and client actor,
   holder, permission or expiry fields are refused. Server captures the current live
   holder and requires another eligible holder; expired/unheld uses ordinary acquire,
   and the manager who already holds control uses ordinary renewal.
2. Proposal admission locks Run then actor identity, reads current role/grant, samples
   PostgreSQL time after all blocking locks, and requires active Run and exact live epoch.
   Governed encrypted reason and immutable proposal metadata commit atomically. Exact
   actor/Run/request-key retries compare a keyed fingerprint of the canonical request;
   a changed reason or epoch conflicts. Replay follows fresh authorization and precedes
   current-lease validation, so an old proposal is recoverable without retargeting it.
3. `confirmRunControlTransfer` accepts only `{ runId, commandId }`, authenticates the
   original actor, takes the same locks and reads fresh role/grant. A valid historical
   receipt can be recovered after reauthorization without claiming current ownership.
   First application requires readable reason content, exact proposal Run/actor/epoch/
   prior holder and a still-live lease. Expiry requires a fresh acquisition flow. Never
   bind confirmation to a newly read holder. The new holder is the session actor only.
4. Transfer changes holder, advances the observed epoch by exactly one, and grants the
   standard 120-second lease using PostgreSQL time. It appends
   `lifecycle.run-control-lease-transferred`, stores its exact immutable applied receipt
   and sends only the existing timeline notification in the same transaction. Event
   payload contains operation, command/request identity, prior/new epoch and holder,
   governed reason reference, updated/expiry instants; it contains no reason text.
5. Migration 0060 adds a revisioned `user_permission_grant`, immutable transfer proposal,
   governed transfer content, immutable applied transfer receipt and a nullable
   `run_control_lease.transfer_command_id` marker. Use same-Run composite FKs where a
   Run and command coexist; keys are scoped to actor + Run + request key. Match existing
   content encryption, tombstone and retention contracts. Delete retained metadata only
   with its owning identity/Run aggregate; do not weaken guards for fixture cleanup.
6. Grant storage guards require a current manager for `granted=true`, retain revocations,
   and require a matching exact grant-change event for each new revision at commit.
   Demotion/removal with a live grant is refused at commit unless the same transaction
   revokes it. Role/grant SQL mutation acquires stable identity locks; SQL callers cannot
   bypass serialization by deleting an absent grant row or omitting application locks.
7. A lease's transfer marker changes only for a new, exact, not-yet-applied proposal.
   The special live-holder branch validates prior live lease, epoch, actor role/grant
   and governed content. A boolean/session setting is never sufficient. Fact insertion
   validates the actual resulting lease; deferred constraints bind proposal, transition,
   exact event and receipt. Subsequent renew/release/acquire preserve the historical
   marker while using ordinary guards. Receipt recovery validates retained immutable
   facts independently of current lease/Run state, so compound later transitions remain
   valid. Add negative SQL tests for marker-only, event-only and receipt-only forgeries.
8. Acquire/renew/release must retain the last transfer marker in their SQL update shape.
   Transfer history appears in the authorized safe conversation/timeline projection.
   Reason read is separately authorized and governed; unavailable/removed reason does
   not invalidate an already committed receipt but prevents first confirmation.

Audit-head locking comes last, after Run/identity/lease state locks. Administration never
waits on a Run row. No operation holding an audit-head lock may subsequently acquire the
identity locks used here. The concurrency tests hold actual PostgreSQL locks to verify
both actor-role and subject-grant revocation paths, not mocked read ordering alone.

## Task, file and acceptance map

| Task | Exact implementation surface | Required acceptance |
| --- | --- | --- |
| D3-T1 domain policy and identity ports | `packages/domain/src/identity/roles.ts`, `roles.test.ts`; `packages/application/src/identity/ports.ts`, `manage-users.ts`, `manage-users.test.ts` | AC1–AC4 |
| D3-T2 identity persistence and administration | `packages/infrastructure/src/identity/role-repository.ts`, `identity-unit-of-work.ts`; `apps/web/app/administration/actions.ts`, `actions.test.ts`, `actions-audit.test.ts`, `page.tsx`; `apps/web/src/admin/UsersPanel.tsx`, new `TransferPermissionControl.tsx` and test | AC1–AC4, AC12 |
| D3-T3 governed transfer service | new `packages/application/src/runs/run-control-transfer.ts` and test; application `index.ts`; new infrastructure `runs/run-control-transfer-repository.ts`; `runs/run-control-lease-repository.ts`; infrastructure `index.ts` | AC5–AC10 |
| D3-T4 storage and immutable facts | `packages/infrastructure/src/db/schema.ts`, `compat.ts`; `drizzle/0060_*`, generated snapshot/journal; `packages/domain/src/audit-event.ts` and dedicated tests; `packages/infrastructure/src/runs/run-interaction-projection.ts` | AC3, AC7–AC11 |
| D3-T5 controller confirmation and updates | `apps/web/src/runs/RunControllerLease.tsx` (also owns the existing provider); `apps/web/app/runs/control-actions.ts`, `control-actions.test.ts`; `apps/web/app/api/runs/[id]/control/route.ts`, `route.test.ts`; `packages/application/src/runs/run-conversation-events.ts` for safe narration | AC5–AC8, AC10–AC12 |
| D3-T6 persistent and browser proof | `tests/integration/manage-users.test.ts`, `run-control-lease.test.ts`, new `run-control-transfer.test.ts`; new `tests/e2e/run-control-transfer.spec.ts`, manager/second-viewer fixtures | All ACs |
| D3-T7 delivery accounting | this spec, D3 decision record, P3 checkpoint, continuation report, `CLAUDE.md` (after answer commit) | Actual verification and remaining user actions recorded |

D3-T5 extends the existing provider in `RunControllerLease.tsx`; it does not introduce
a parallel controller ownership state machine.

### Acceptance criteria

- **AC1 Grant authority:** administrator can explicitly grant/revoke for a manager;
  manager/auditor/no-role cannot administer grants; administrator/auditor cannot receive
  transfer authority; a manager without a grant cannot transfer. Domain full authorization
  denies omitted or false grants and arbitrary claimed roles.
- **AC2 Administration concurrency:** unchanged expected revision permits an actual toggle;
  changed revision, including revoke/re-grant ABA, refuses. No-op produces no event.
  Actor revocation while waiting for identity locks refuses; missing subject refuses.
- **AC3 Non-resurrection:** demotion/removal revokes atomically, promotion remains ungranted;
  SQL cannot commit an ineligible live grant or erase its retained revision. Existing
  last-administrator and author/approver protections stay valid.
- **AC4 Atomic audit:** role/grant and exact event commit together; injected append failure
  rolls both back. No identity email, password or free text appears in grant events.
- **AC5 Proposal and review:** bounded reason is governed, exact current holder/epoch is
  captured and displayed, keyboard review/cancel works, stale/terminal/unheld/expired/
  same-holder admission refuses, no Run effect occurs before confirmation.
- **AC6 Current authority:** role or grant revoked before or during blocked confirmation
  prevents transfer; actual identity locking serializes revocation that loses the race.
  Reacquisition by the same actor advances the epoch and invalidates stale proposals.
- **AC7 Exact retries:** response loss retains payload/key or command ID; exact retry returns
  its old receipt without a second epoch change; changed reason/epoch conflicts. Read-only
  observers see safe receipt history. Historical receipt never restores ownership locally.
- **AC8 Competing transfers:** two managers can propose from one epoch; at most one applies.
  The loser sees truthful stale-context refusal; both viewers show the eventual named holder
  and discard older asynchronous reads.
- **AC9 Governed content:** missing/corrupt/removed proposal reason refuses first confirmation;
  removal after application retains safe historical proof. No reason leaks through logs,
  event JSON, notification payloads, queue data or observer projections.
- **AC10 Storage truth:** forged marker, omitted lease change, wrong actor/epoch, altered
  event, missing receipt and independent partial commits are rejected by real SQL. Receipt
  insertion/audit/notification failures roll back transfer. Ordinary renew/release/acquire
  still work after transfer, including compound transitions and later historical recovery.
- **AC11 Safety and fencing:** stale unconfirmed Resume/steering is rejected; accepted immediate
  Pause, deferred inspection Pause and Stop survive and apply at their named safe boundary.
  Open question/options, frozen plan, evaluations and Result authority are unchanged. No
  execution job is created solely by transfer. Actual worker proof covers the existing
  deferred-pause boundary; future queued strategy consumers are tested when that slice exists.
- **AC12 Delivery:** focused domain/application, real PostgreSQL grant/lease/transfer and
  authenticated administration/two-viewer tests pass. Parent runs package build, complete
  type/boundary/unit checks and required browser/worker journeys, then records exact evidence.

## Required-port consumer audit

Direct implementers are `DrizzleRoleWriter`, `PostgresIdentityUnitOfWork`,
`DrizzleUserDirectory`, and the in-memory world in `manage-users.test.ts`.
`apps/web/src/sign-out-route.test.ts` supplies an identity-unit-of-work fake and must
supply the new required ports even though sign-out does not consume them.
`apps/web/app/administration/actions-audit.test.ts` mocks identity composition and must
track the new grant writer/action. `tests/integration/manage-users.test.ts` and
`tests/integration/procedure-authoring.test.ts` construct the real identity UoW;
`apps/web/src/bootstrap.ts` and sign-out composition remain compatible through it.
`UsersPanel.tsx` and administration page/tests consume `ManagedUser`; every fixture
must explicitly state the grant/revision instead of inferring it from role.
The exhaustive domain role matrix must add the new action and explicit grant context;
`tests/unit/no-override-path.test.ts` must keep administrator denial comprehensive.
Required ports intentionally surface unlisted inferred mocks during typechecking; do
not make grant checks optional to accommodate a test double.


## Parent integration

Integrated onto the already reviewed native POST and selected Replay head `00de6c3`.
The only textual conflict was the shared decision log: preserve the native POST correction
and append the independent manager-transfer decisions. The revised 21-case PostgreSQL
transfer module passed after replacing a terminal fixture's direct state write with the
actual queued cancellation handler and sealed Result. Full combined verification follows.

## Suggested Review Order

- Authorize the dedicated action and retain an exact governed review.
  [run-control-transfer.ts:76](../../packages/application/src/runs/run-control-transfer.ts#L76)

- Serialize authority and ownership changes with their immutable receipt.
  [run-control-transfer-repository.ts:13](../../packages/infrastructure/src/runs/run-control-transfer-repository.ts#L13)

- Enforce transfer and grant invariants beneath application commands.
  [0060_same_yellow_claw.sql:1](../../packages/infrastructure/drizzle/0060_same_yellow_claw.sql#L1)

- Keep administration grants explicit and revision-bound.
  [TransferPermissionControl.tsx:14](../../apps/web/src/admin/TransferPermissionControl.tsx#L14)

- Recover proposals and receipts without inferring current ownership.
  [RunControllerLease.tsx:24](../../apps/web/src/runs/RunControllerLease.tsx#L24)

- Verify storage races, rollback, safety preservation and retained platform history.
  [run-control-transfer.test.ts:1](../../tests/integration/run-control-transfer.test.ts#L1)

- Exercise both authenticated viewers and historical recovery in Chromium.
  [run-control-transfer.spec.ts:67](../../tests/e2e/run-control-transfer.spec.ts#L67)

- Read actual verification results and remaining acceptance limits.
  [report-aw-manager-transfer.md:1](report-aw-manager-transfer.md#L1)
