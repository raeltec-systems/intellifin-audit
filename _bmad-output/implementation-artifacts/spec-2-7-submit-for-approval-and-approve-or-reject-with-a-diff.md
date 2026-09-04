---
title: 'Submit for approval and approve or reject with a diff'
type: 'feature'
created: '2026-09-04'
status: 'ready-for-dev'
review_loop_iteration: 0
baseline_commit: 'TBD — set at implementation start; depends on Stories 2.5 and 2.6 landing first'
deferred: []
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A Draft can be fully authored and its plan derived, but there is no way to submit it, and no way for an Audit Manager to review and decide on it. Nothing yet freezes what was reviewed.

**Approach:** Add the Submit, Approve and Reject commands over the existing version state machine, notify the right people inside the same transaction as the state change, and give the Audit Manager a section-by-section diff against the previous version to decide from.

## Boundaries & Constraints

**Always:** Move `DRAFT → SUBMITTED` only when no blocker is outstanding AND the plan is derivable, and notify every Audit Manager in the SAME transaction as the transition. Record for every transition the actor, time, prior state, decision, rationale and the aggregate revision (AD-7), and require the expected revision on every one, so a second concurrent decision on the same version fails its precondition rather than overwriting the first. On approval, freeze what was reviewed: the compiled plan, the Compliance Rule with each condition's compiled/uncompiled status and applicability predicate, Evidence Requirements, Target Systems with their registration digests, the Population Source binding, the model and tool configuration, limits, and the Schedule — and record the approver, the time and the diff. Require a rationale to reject, move `SUBMITTED → REJECTED`, and notify the author. Let "Edit" return a rejected version to `DRAFT`. Authorize every command through the application-owned role policy, and keep credential values out of every payload.

**Ask First:** Changes to what approval freezes, to the notification recipients, or to the state vocabulary.

**Never:** Let a version's own author approve it. Move a version to `ACTIVE`, compute `handover_at`, decide a Regression Run is required, or mint a platform-authored draft — Story 2.8 owns all of that. Execute a plan or a Run. Re-derive the plan here; this story READS the derivability signal Story 2.6 stores. Invent a state or a transition: the vocabulary and the permitted edges are already domain data.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Submit | A Draft with no blocker and a derivable plan | `DRAFT → SUBMITTED`; every Audit Manager notified in the same transaction | Atomic state/event/notification |
| Submit refused | An outstanding blocker or an underivable plan | Refused with the stated reason; Submit stays disabled and the reason is on the page | No state, event or notification |
| Author cannot approve | The version's author opens the review | Approve is unavailable with the exact sentence, and the command refuses it too | Refused server-side, not only hidden |
| Approve | An Audit Manager who did not author it, with the expected revision | `SUBMITTED → APPROVED`; the reviewed fields are frozen; approver, time and diff recorded | Atomic |
| Concurrent approval | Two decisions on one version | The second fails its expected-revision precondition | No second transition |
| Reject | A rationale supplied | `SUBMITTED → REJECTED`; the author notified; the rationale stored and shown | A missing rationale is refused |
| Edit after rejection | A rejected version | `REJECTED → DRAFT`, editable again | Recorded like any transition |
| First version review | No previous version to compare | The diff renders fully expanded rather than empty | Never an empty review |

</frozen-after-approval>

## Code Map

- `packages/domain/src/procedures/procedure-version.ts` — `PROCEDURE_VERSION_TRANSITIONS` and the state vocabulary ALREADY exist as data from Story 2.1. Use them; do not restate the machine.
- `packages/domain/src/identity/roles.ts` — the gating table already carries `procedure.version.approve` and its siblings, and FR-2's "cannot approve a version they authored" is scoped to that action. Extend there, never inline a role check.
- `packages/application/src/procedures/update-compliance-draft.ts` — the audited, guarded command template: authorize, validate, `unitOfWork.execute`, guard, `throw new Refused(...)` inside and convert outside.
- `packages/application/src/procedures/derive-plan.ts` (Story 2.6) — the derivability signal Submit reads. Read it; never re-derive.
- `packages/infrastructure/src/identity/*` — `PostgresIdentityUnitOfWork` shows how a second writer joins one transaction; the notification writer joins the procedures unit of work the same way.
- `apps/web/src/procedures/` — the read-only plan preview from Story 2.6 is REUSED by Version review, not reimplemented.
- `apps/web/src/design/copy.ts` — the author-cannot-approve sentence is pinned to EXPERIENCE.md on disk, like every other quoted sentence.
- `packages/infrastructure/src/telemetry/sentry.ts` — allowlist each new failure message and field key.

## Tasks & Acceptance

**Execution:**
- [ ] Build the notification mechanism, which does not exist yet: a `NotificationSender` port owned by the application, a notifications table (generation 13), idempotent send keys, an in-app surface, and worker-side delivery. In-app only for the PoC (AD-20). The row is written in the SAME transaction as the state change; delivery is the worker's job.
- [ ] `packages/domain/src/procedures/version-decision.ts` — the decision record (actor, time, prior state, decision, rationale, aggregate revision), the rationale requirement for rejection, and the pure section-by-section diff between two versions, including the first-version case.
- [ ] `packages/application/src/procedures/{submit-version,decide-version}.ts` — Submit, Approve, Reject and Edit-after-rejection as audited commands over the existing transitions, each requiring the expected revision, each appending its audit event and its notification rows in one transaction. Approval freezes the reviewed fields and stores the diff.
- [ ] Infrastructure: generation-13 columns for the frozen review record, the decision fields and the stored diff, with shape CHECKs; hand-appended `INSERT INTO schema_meta`; `SUPPORTED_SCHEMA_MIN`/`MAX` raised in the SAME commit.
- [ ] `apps/web` — the Version review surface: the section-by-section diff, the reused read-only plan preview, Approve unavailable to the author carrying the exact sentence as its stated reason, and Reject behind a rationale confirmation dialog. Submit on the Builder is disabled with its reason listed in the unavailable-actions panel and as its accessible description, never a tooltip alone.
- [ ] Domain, application, integration and e2e tests — every matrix row, a held-open-transaction concurrency case proving the second decision loses its precondition, rollback, notification idempotency, keyboard access and a WCAG scan. Record reusable decisions in `CLAUDE.md`.

**Acceptance Criteria:**
- Given a Draft with no blocker and a derivable plan, when the Auditor submits it, then it becomes `SUBMITTED` and every Audit Manager has a notification written in the same transaction.
- Given an outstanding blocker or an underivable plan, when Submit is attempted, then it is refused with the stated reason and nothing changes.
- Given the version's own author, when they open the review, then Approve is unavailable carrying exactly "You cannot approve a version you authored.", and the approve command refuses them server-side as well.
- Given an Audit Manager who did not author it, when they approve with the expected revision, then the version becomes `APPROVED`, the reviewed fields are frozen, and approver, time and diff are recorded.
- Given two approval attempts on one version, when both run against the same revision, then exactly one succeeds and the second fails its expected-revision precondition.
- Given a rejection, when no rationale is supplied, then it is refused; and when one is supplied, the version becomes `REJECTED`, the author is notified, and "Edit" returns it to `DRAFT`.
- Given a first version with nothing to compare against, when it is reviewed, then the diff renders fully expanded rather than empty.

## Spec Change Log

## Design Notes

Story 2.8 depends on how this story computes and stores the diff and the frozen review record, so both are stored as typed, readable data rather than as a rendering. This story deliberately stops at `APPROVED`: the `APPROVED → ACTIVE` edge, `handover_at`, and the Regression-Run requirement are 2.8's, even though the state machine already carries the edge.

Notifications are written transactionally and delivered by the worker. A notification the state change cannot commit with must not exist, which is why the row is written in the command's transaction rather than sent from it; idempotent send keys make redelivery safe.

Approve and Reject are Audit Manager actions and Submit is an Auditor action, per the gating table established in Story 1.3 — a PoC Administrator can do none of them.

## Verification

- `pnpm typecheck`, `pnpm boundaries`, `pnpm test` — all pass.
- `pnpm db:migrate`, `pnpm db:generate`, `pnpm test:integration` — migrates to generation 13, no drift, PostgreSQL 18 checks pass.
- `pnpm build`, `pnpm --filter @intellifin/web build`, `pnpm test:e2e` — builds, Builder and Version review journeys pass, including every WCAG 2.1 AA scan.
