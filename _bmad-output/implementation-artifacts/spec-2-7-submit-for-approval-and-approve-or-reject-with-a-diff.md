---
title: 'Submit for approval and approve or reject with a diff'
type: 'feature'
created: '2026-09-04'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
baseline_commit: '7e47280f292535f65bbb78522e1a4965c76bb1f4'
baseline_revision: '7e47280f292535f65bbb78522e1a4965c76bb1f4'
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
- [x] Build the notification mechanism, which does not exist yet: a `NotificationSender` port owned by the application, a notifications table (generation 13), idempotent send keys, an in-app surface, and worker-side delivery. In-app only for the PoC (AD-20). The row is written in the SAME transaction as the state change; delivery is the worker's job.
- [x] `packages/domain/src/procedures/version-decision.ts` — the decision record (actor, time, prior state, decision, rationale, aggregate revision), the rationale requirement for rejection, and the pure section-by-section diff between two versions, including the first-version case.
- [x] `packages/application/src/procedures/{submit-version,decide-version}.ts` — Submit, Approve, Reject and Edit-after-rejection as audited commands over the existing transitions, each requiring the expected revision, each appending its audit event and its notification rows in one transaction. Approval freezes the reviewed fields and stores the diff.
- [x] Infrastructure: generation-13 columns for the frozen review record, the decision fields and the stored diff, with shape CHECKs; hand-appended `INSERT INTO schema_meta`; `SUPPORTED_SCHEMA_MIN`/`MAX` raised in the SAME commit.
- [x] `apps/web` — the Version review surface: the section-by-section diff, the reused read-only plan preview, Approve unavailable to the author carrying the exact sentence as its stated reason, and Reject behind a rationale confirmation dialog. Submit on the Builder is disabled with its reason listed in the unavailable-actions panel and as its accessible description, never a tooltip alone.
- [x] Domain, application, integration and e2e tests — every matrix row, a held-open-transaction concurrency case proving the second decision loses its precondition, rollback, notification idempotency, keyboard access and a WCAG scan. Record reusable decisions in `CLAUDE.md`.

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

### Implementation decisions prepared before handoff (2026-09-04)

- Submission reads the persisted successful plan and current authoring digest; it never invokes a compiler or model. Check all completeness requirements from saved sections, including missing source, explicit period/scope, required targets/instructions, conditions, grounding and Schedule. Do not assume narrow blocker arrays cover missing sections. A pending, failed, stale or absent plan disables Submit with the same command reason.
- Resolve approval authorship from durable trusted storage, never an action argument. Backfill creation provenance from existing audit events; missing provenance must fail closed. Track humans who actually author this version so an Audit Manager cannot edit somebody else's Draft and approve those edits. Keep platform creation provenance distinct from human authorship and the responsible author who receives rejection notifications. A platform successor retains its predecessor's responsible human author; normal human edits remain subject to self-approval protection. No caller may nominate an unrelated author to bypass the rule.
- Keep permission policy in the shared authorization path. If authorization needs trusted context loaded after a role-only preflight, implement that preflight from the same action-policy table and then resolve full context before mutation. Never manufacture an author id or authorize an approve request as a different action. Recheck the locked version's authorship and expected revision before approval; denial auditing names the requested action.
- Store the reviewed definition and section diff as typed data with a schema version. A first review expands every section. Compare against the preceding version of the same Procedure, preserving the precise baseline identity in the review record; Story 2.8 separately chooses the prior activated version for configuration comparison.
- Use a notification-owned transactional writer and identity-owned recipient reader joined to the procedures UnitOfWork. Submission creates one durable pending in-app delivery per current Audit Manager; rejection addresses the responsible author. The worker delivers idempotently through NotificationSender. Readers return only the signed-in user's delivered notifications, and the notification links to the reviewed version. Do not send email or external messages.
- AD-20 also requires approval notification to the responsible author. Include it in the same transaction as approval and prove rollback/idempotency alongside rejection; the shorter story matrix does not remove this context requirement.
- Prove state/event/notification atomicity with a forced rollback, idempotent delivery replay, and two held-open competing decisions. Prove another author cannot self-approve after editing an existing Draft, unauthenticated/forged action context cannot bypass permission, and a user cannot read another user's notification.
- Reuse the stored plan preview and design-system unavailable-action panel. The rejection dialog must require storable rationale, retain input after refusal, manage focus and keyboard dismissal, and expose the reason accessibly. Approval and rejection must show the saved decision and immutable review, not a success toast that leaves a stale editable page.
- Verification on this Windows host is serial: dot-source C:/Users/opc/AppData/Local/Temp/intellifin-epic2-env.ps1; use maxWorkers=1 for Vitest. Build shared packages before browser checks, and validate PostgreSQL readiness before starting them.
- The epic's browser proof includes the P-1 hero Procedure: create from the Terminated Users Retaining Access Template, author/bind required sections through the Builder, let the real queued worker derive it, submit, sign in as a different Audit Manager and review/decide. Seed registrations/accounts as fixtures if necessary, but do not seed a pre-approved version or directly replace the authored version to bypass the workflow being proved. Actual audit Run execution remains a later epic.
- Authorship follows creation and actual authored-definition changes, not every event on the aggregate. Worker attempt starts/completions, queue recovery and a human retrying derivation do not author the definition. Preserve these operational records after submission/approval without weakening the expected-revision check or rewriting the frozen plan. Read persisted derivation outcomes from the final Story2.6 ports rather than assuming attempts have only three terminal outcomes.
- For the P-1 journey, exercise the actual worker composition root/process as well as the web process, not only startProceduresWorker with an injected application handler. A test-only Node preload or equivalent isolated HTTP fixture may intercept provider HTTP for the real installed SDK, so the configured provider → queue worker → stored plan → preview chain is proved without a paid credential. Keep fixture interception out of production code and do not add a test-only public endpoint or unsafe production provider-URL override. Continue to distinguish this complete synthetic-HTTP wiring proof from live model quality/provider acceptance, which still requires a deployment credential.
- Close earlier authoring-surface verification gaps while proving the integrated Builder journey: author a valid custom inclusion clause over a declared source column, independently enable the duplicate-key permission, save and reload both values. Extend focused browser concurrency proof to Population Source and Target/Instruction edits, including conflict reset and a committed response lost before acknowledgement. The shared state machine already has unit coverage and Period/Schedule/Compliance browser checks; these additional cases verify the remaining forms' wiring rather than introducing a different concurrency policy.

### Pre-review implementation verification (2026-09-05)

This checkpoint predates the twelve formal-review repairs. Its passing results are retained as history; repaired-code acceptance requires the later verification and follow-up review results.

- `pnpm typecheck` and `pnpm boundaries` passed (291 modules); root test TypeScript was checked again after browser fixture changes.
- `pnpm test --maxWorkers=1`: 75 files, 1,917 tests passed.
- `pnpm db:generate`: no schema drift, including the submitted-review snapshot. `pnpm db:migrate`: PostgreSQL 18, generation 13. `pnpm test:integration --maxWorkers=1`: 13 files, 178 tests passed, including held-open concurrency, one-connection authorization, rollback, notification privacy/idempotency, trusted provenance backfill and stable predecessor review snapshots.
- `pnpm build` and `pnpm --filter @intellifin/web build` passed. `pnpm test:e2e`: all 94 cases passed with no retries (6.0 minutes), including keyboard/WCAG checks, actual worker/installed Anthropic SDK over synthetic HTTP, live-worker authoring, reject/Edit/re-submit/approve, private delivered notifications, and lost committed responses.
- Earlier browser failures exposed two obsolete notification-stub assertions and a known failed P-1 fixture; the assertions now follow the delivered-notification surface and the exact leftover fixture was removed. A subsequent local development auth 404 was resolved by preserving the generated Next cache outside the repository and rebuilding it, following the existing cache gotcha. The final complete browser run exited zero.
- Runtime executor/activation remains outside this story. Synthetic HTTP proves provider wiring, not live model quality or deployment credential acceptance. No implementation task remains incomplete; formal review and commit remain with the epic coordinator.

## Review Triage Log

### 2026-09-05 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 12: (high 1, medium 10, low 1)
- defer: 0
- reject: 2
- addressed_findings:
  - `[high]` `[patch]` Registered every editor's dirty/conflict/pending/unknown state and rechecked it at submission confirmation.
  - `[medium]` `[patch]` Rendered previous/current executable plan steps separately.
  - `[medium]` `[patch]` Rendered the stored submitted/approved review definition and provenance rather than later live values.
  - `[medium]` `[patch]` Refused an invalid predecessor instead of presenting a first-version review.
  - `[medium]` `[patch]` Validated review ownership, known unique sections, after-values and change flags.
  - `[medium]` `[patch]` Added bounded notification pagination preserving microsecond ordering and recipient privacy.
  - `[medium]` `[patch]` Identified notifications by Procedure name, version and time.
  - `[medium]` `[patch]` Added accessible notification refresh and honest delivery-delay copy.
  - `[low]` `[patch]` Indexed pending notification delivery by its filter/order.
  - `[medium]` `[patch]` Retained past decision rationale through Edit and resubmission.
  - `[medium]` `[patch]` Tested actual previous/current Scope, Evidence, plan and submitted metadata rendering.
  - `[medium]` `[patch]` Proved persisted Evidence/Schedule contributors cannot approve their edits, while no-ops and operational derivation do not add authors.

Follow-up recommendation: **true**, from one high finding and weighted score `3 × 10 + 1 = 31`. Independent source follow-up cleared all twelve repairs without new findings; see [follow-up review](review-2-7-followup.md). The [matrix map](review-2-7-matrix.md) identifies the covering tests. All repaired-code verification passed as recorded below.

## Auto Run Result

Status: done. Implemented audited, revision-guarded submission, independent approval, rejection with rationale and Edit-after-rejection. Submission captures the precise definition and predecessor comparison; approval freezes that review. Durable in-app notifications commit with decisions and are delivered idempotently by the worker. All Builder editors participate in submission gating.

Changed surfaces:

- `packages/domain/src/procedures/version-decision.ts`: typed review, decision history, structural differences and strict snapshot consistency.
- `packages/application/src/procedures/{submit-version,decide-version,submission-guard}.ts`: authorized, transactional lifecycle commands and completeness checks.
- Application identity/authoring ports and commands: trusted responsible author and human contributor provenance, including transactional role checks and denial auditing.
- `packages/application/src/notifications/` and `packages/infrastructure/src/notifications/`: durable enqueue/delivery, recipient-private keyset pagination and cursor validation.
- Infrastructure schema, migration 13 and Procedure repositories: review/history/provenance persistence, creation backfill and transaction composition.
- Web Builder forms, Version review/actions and Notifications page: unsaved/unknown save protection, exact stored review rendering, readable old/new plans, retained history, refresh and pagination.
- Worker composition and browser fixtures: real notification delivery and actual installed provider SDK/worker journey over synthetic HTTP.
- Unit, integration and browser suites: matrix, rollback/concurrency, durable-data corruption, author eligibility, privacy, actual rendering and WCAG/keyboard coverage.
- CLAUDE.md and delivery/review artifacts: reusable decisions, disk-recovery gotcha and human-readable evidence. Story 2.8 planning refinements remain within the authorized epic.

Formal review applied 12 patches (high 1, medium 10, low 1), deferred 0 and rejected 2 suggestions. Follow-up was recommended and completed with no new actionable finding. No production or test source changed after its captured diff.

Final verification on 2026-09-05:

- `pnpm typecheck`: passed, including root test TypeScript.
- `pnpm boundaries`: passed, 296 modules.
- `pnpm test --maxWorkers=1`: 78 files, **1,922 passed**, exit 0.
- Fresh isolated PostgreSQL 18.6 migrated through generation 13; `pnpm db:generate` reported no drift.
- `pnpm test:integration --maxWorkers=1`: 13 files, **192 passed**, exit 0.
- `pnpm build` and `pnpm --filter @intellifin/web build`: passed.
- `pnpm test:e2e`: **95 passed**, no retries, 7.4 minutes, exit 0. All frozen matrix cases have executed coverage.
- `git diff --check`: passed.

Final logs are retained locally under `C:/Users/opc/tools/intellifin-epic2-test/verification/story27-*.log`. The disk interruption invalidated earlier repair runs; the final results above were collected after recovery against a fresh database.

Residual boundaries: provider HTTP is synthetic and does not establish live credential acceptance/model quality. Activation, database-enforced historical immutability and platform successors remain Story 2.8 work. Runs, Regression Run execution and scheduler execution remain later epics. No user decision blocks the next story.
