---
title: 'Immutable versions and platform-authored drafts'
type: 'feature'
created: '2026-09-04'
status: 'ready-for-dev'
review_loop_iteration: 0
baseline_commit: 'TBD — set at implementation start; depends on Story 2.7 landing first'
deferred: []
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** An approved version can still be edited, nothing decides whether it may go straight to `ACTIVE`, and a change to a registration an Active version depends on silently invalidates what was approved.

**Approach:** Make the frozen fields of an approved or active version truly immutable, decide at approval whether the version needs a Regression Run before it activates, and mint a platform-authored Draft automatically — in the same unit of work — whenever a referenced registration or the platform's own model, prompt or tool configuration changes.

## Boundaries & Constraints

**Always:** Treat an `APPROVED` or `ACTIVE` version's frozen fields as immutable, enforced by the database as well as by the command, so nothing — no command, migration or psql session — can edit what was reviewed. Make "New version" the only path to a new definition: a Draft copy of the Active version. At approval, compare the version's configuration tuple (model, prompt version, tool configuration, registration digests) against the prior Active version of the same Procedure; when it differs, compute `handover_at` and mark the version as requiring a Regression Run before `ACTIVE`; otherwise move `APPROVED → ACTIVE` immediately. A FIRST version never requires a Regression Run. On a `RegistrationChanged` event for a Target System or Population Source an Active version references, mint a new platform-authored Draft in the SAME unit of work as the event, and keep the prior version's Schedule running until the new draft is itself approved. Treat a platform-side model, prompt or tool configuration change identically. Put every platform-authored Draft through the same `DRAFT → SUBMITTED → APPROVED | REJECTED` machine. Warn before a registration save that would ripple into Procedures, naming how many.

**Ask First:** Changes to what the configuration tuple contains, to the Regression-Run rule, or to what "immutable" covers.

**Never:** Shortcut a platform-authored Draft to `ACTIVE`. Execute a Regression Run or a Run, or run a Schedule — the version only carries the requirement. Perform Schedule handover at a period boundary, which is a later epic. Recompute a registration digest here: `registrations` owns it and already publishes when it moves.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Immutability | An edit to a frozen field of an `APPROVED` or `ACTIVE` version | Refused with a stated reason | Refused by the database too, not only the command |
| First version approval | No prior Active version | `APPROVED → ACTIVE` immediately; no Regression Run required | Recorded |
| Unchanged tuple | Tuple equals the prior Active version's | `APPROVED → ACTIVE` immediately | Recorded |
| Changed tuple | Tuple differs from the prior Active version's | `handover_at` computed; the version is marked as requiring a Regression Run and does NOT activate | No activation |
| Registration change | `RegistrationChanged` for a registration an Active version references | A platform-authored Draft is minted in the same unit of work, stating what changed | All or nothing with the event |
| Platform config change | Model, prompt or tool configuration changes | The identical path, through the same state machine | No shortcut to Active |
| New version | "New version" on an Active version | A Draft copy is created, editable | The Active version is untouched |
| Ripple warning | A registration save affecting n Procedures | The count is stated before the save commits | The save still requires confirmation |

</frozen-after-approval>

## Code Map

- `packages/domain/src/procedures/procedure-version.ts` — `PROCEDURE_VERSION_TRANSITIONS` already carries `APPROVED → ACTIVE` and `ACTIVE → RETIRED`; this story supplies the trigger for the first, not a new edge.
- `packages/application/src/procedures/decide-version.ts` (Story 2.7) — approval is where the tuple comparison hooks in; extend it rather than adding a parallel approval path.
- `packages/domain/src/registrations/target-system.ts` — the digest is `registrations`' to compute. Story 1.6 publishes `configuration.registration-changed` ONLY when one of the six digest-bearing fields moves, and `configuration.registration-annotated` otherwise, precisely so a rename does not mint a draft. Consume the first; ignore the second.
- `packages/infrastructure/src/registrations/registration-repository.ts` and the registrations unit of work — the platform-authored Draft is minted inside the SAME unit of work that records the registration change, so the two commit together.
- `packages/application/src/procedures/create-procedure.ts` — `procedureVersionRowVersion` and the Draft-creation shape a "New version" copy reuses.
- `apps/web/app/procedures/[id]/` and `apps/web/app/administration/registrations/` — the Procedure Detail states and the pre-save ripple warning.

## Tasks & Acceptance

**Execution:**
- [ ] Enforce immutability in the database as well as the domain: a generation-14 constraint or trigger that refuses an update to a frozen field when the row's state is `APPROVED` or `ACTIVE`, asserted with RAW SQL in the integration suite — a constraint tested only through the command proves nothing about the constraint.
- [ ] `packages/domain/src/procedures/configuration-tuple.ts` — the tuple (model, prompt version, tool configuration, registration digests), its comparison, the first-version rule, and the `handover_at` computation as pure functions.
- [ ] Extend the approval command: compare against the prior Active version, then either activate immediately or mark the version as requiring a Regression Run with its `handover_at`. Record which, and why, on the version.
- [ ] `packages/application/src/procedures/mint-platform-draft.ts` — the handler that consumes `RegistrationChanged` and the platform model/prompt/tool configuration change, and mints a platform-authored Draft copy in the same unit of work, recording what changed and that it requires approval. Idempotent per (version, change), so one change mints one draft.
- [ ] "New version": a Draft copy of the Active version, leaving the Active version untouched.
- [ ] `apps/web` — Procedure Detail states for Draft, Submitted, Rejected, Active, Retired and platform-authored Draft, each with its stated sentence; and the registration-save ripple warning naming the affected Procedure count before the save commits.
- [ ] Domain, application, integration and e2e tests — every matrix row, raw-SQL immutability, the same-unit-of-work minting proved by rolling the event back and finding no draft, idempotent minting, a held-open-transaction concurrency case, keyboard access and a WCAG scan. Record reusable decisions in `CLAUDE.md`.

**Acceptance Criteria:**
- Given an `APPROVED` or `ACTIVE` version, when any frozen field is edited through the command OR through raw SQL, then it is refused and nothing changes.
- Given a first version, when it is approved, then it becomes `ACTIVE` immediately and is not marked as requiring a Regression Run.
- Given a version whose configuration tuple equals the prior Active version's, when it is approved, then it becomes `ACTIVE` immediately.
- Given a version whose tuple differs, when it is approved, then `handover_at` is computed, the version is marked as requiring a Regression Run, and it does NOT become `ACTIVE`.
- Given a `RegistrationChanged` event for a registration an Active version references, when it is recorded, then a platform-authored Draft is minted in the same unit of work — and when that transaction rolls back, no draft exists.
- Given a platform-authored Draft, when it is read, then it states it was created by the platform after the named change and requires approval, and it can only reach `ACTIVE` through the normal machine.
- Given a registration save that would ripple into n Procedures, when it is saved, then the count is stated before the save commits.

## Spec Change Log

## Design Notes

Story 1.6 already split `registration-changed` from `registration-annotated` for exactly this story, so a display-name change must NOT mint a draft. That split is the contract; do not widen the trigger.

The `ACTIVE → RETIRED` edge exists in the machine, but retirement at the first period boundary after a successor is Active is Schedule handover, which the epic places in a later epic. This story records the successor relationship; it does not run a scheduler.

A Regression Run is not executed here either (FR-15, a later epic). Only the version-level requirement and `handover_at` are set, which is what the epic asks for.

Minting must be idempotent: a registration change that fans out to several Active versions mints one draft per version, and re-delivering the same change mints nothing further.

## Verification

- `pnpm typecheck`, `pnpm boundaries`, `pnpm test` — all pass.
- `pnpm db:migrate`, `pnpm db:generate`, `pnpm test:integration` — migrates to generation 14, no drift, PostgreSQL 18 checks pass, including the raw-SQL immutability assertions.
- `pnpm build`, `pnpm --filter @intellifin/web build`, `pnpm test:e2e` — builds and every Procedure Detail state pass, including every WCAG 2.1 AA scan.
