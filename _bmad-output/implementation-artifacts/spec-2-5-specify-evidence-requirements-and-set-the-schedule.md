---
title: 'Specify Evidence Requirements and set the Schedule'
type: 'feature'
created: '2026-09-04'
status: 'done'
review_loop_iteration: 0
baseline_commit: '0c744fab107e0346a586c49fed461aaf737399a2'
baseline_revision: 'cf42cc6288f0099a7ee9497728dc1626700a73cd'
followup_review_recommended: true
deferred:
  - summary: >-
      Audit older Builder editors for the token-only refresh pattern while wiring Story 2.6 saves.
    evidence: |-
      DraftBuilder and older section forms initialize editable values once but adopt refreshed whole-row tokens. Story 2.5 now has a tested section state machine; the earlier editors need the same concurrency audit before Epic 2 completion.
    location: >-
      apps/web/src/procedures/DraftBuilder.tsx and older section forms
    severity: high
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A Draft can now name its population, its Target Systems and its Compliance Rule, but it cannot say what evidence a Run must capture, nor when the Run happens. The last two Builder sections are still Template prose.

**Approach:** Make Evidence Requirements and Schedule editable on a Draft. Persist typed, version-owned evidence requirements and a typed Schedule (frequency + fixed UTC start + the recorded period-derivation rule) through the same audited, whole-row-guarded command shape the population, target and compliance sections already use.

## Boundaries & Constraints

**Always:** Store evidence requirements as typed, version-owned data, per declared attribute. Every attribute value must be grounded in a Structural Snapshot or a source file excerpt — a screenshot or a recording segment alone is never grounding. An attribute may instead be declared model-read, which is recorded as such and exempts it from deterministic grounding rather than pretending it is grounded. For agent-driven Target Systems, Structural Snapshot and screenshot are platform-captured and are recorded as such, not chosen. Store the Schedule as a frequency (`once`, `daily`, `weekly`, `monthly`) with a fixed UTC start time, and record the period-derivation rule per frequency on the version. A `manual-upload` Population Source binding is valid ONLY with a `once` Schedule; every other frequency requires a versioned-file or read-only-API binding, and the pairing is a completeness blocker stated inline. Authorize before parsing, validate in the domain, guard the entire Draft row, detect a no-op, return the new token, and commit each change with its audit event.

**Ask First:** Changes to the evidence vocabulary, the grounding rule, the frequency vocabulary, or the period-derivation rules beyond what the epic context records.

**Never:** Capture evidence, execute or schedule a Run, derive a period, compute `handover_at`, derive plans, or implement submission/approval. The version RECORDS its derivation rule; it never runs it.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Evidence save | Declared attributes on a Draft | Persist typed requirements and survive reload | Atomic state/event |
| Grounding rule | Attribute grounded only by screenshot or recording | Refuse with a stated reason naming the attribute | No state/event change |
| Model-read attribute | Attribute declared model-read | Accept and record it as model-read, no deterministic grounding required | Recorded, never inferred |
| Schedule save | Frequency and fixed UTC start | Persist frequency, start time and the recorded derivation rule | Atomic state/event |
| Upload/frequency pairing | `manual-upload` binding with a non-`once` frequency | State the blocker inline on both sections; it is a completeness blocker | Saveable, surfaced, never silent |
| Invalid/stale edit | Unknown kind or frequency, malformed start time, non-Draft, old row token | Refuse with a stated reason | No state/event change |

</frozen-after-approval>

## Code Map

- `packages/domain/src/procedures/compliance-draft.ts` and `target-draft.ts` — mirror their shape: a `Draft*Fields` group, a structural validator, bounded sizes, and `complianceObject`/`complianceExactKeys`-style shape helpers. Reuse, never re-implement.
- `packages/domain/src/procedures/procedure-version.ts` — `DRAFT_SECTION_HEADINGS` already ends `'Evidence Requirements'`, `'Schedule'`; both become editable, leaving TWO read-only sections (Control, Objective).
- `packages/domain/src/procedures/templates.ts` — seed structured evidence/schedule defaults per Template alongside the pinned prose, the way `defaultTargets` and the compliance defaults are seeded.
- `packages/domain/src/procedures/population-draft.ts` — the binding kind the upload/frequency pairing reads; do not duplicate its vocabulary.
- `packages/application/src/procedures/update-compliance-draft.ts` — the command template: authorize, validate, `unitOfWork.execute`, `findVersionForUpdate`, non-DRAFT refusal, `procedureVersionRowVersion` guard, no-op detection, one audit event, `throw new Refused(...)` inside and convert outside.
- `packages/application/src/procedures/{ports,create-procedure}.ts` — extend `ProcedureVersionRecord`/`ProcedureVersionView` and add the new fields to `procedureVersionRowVersion`.
- `packages/infrastructure/src/db/{schema,compat}.ts`, `packages/infrastructure/drizzle/` — generation 11, typed columns with shallow shape CHECKs, Template backfill, and `SUPPORTED_SCHEMA_MIN`/`MAX` raised to 11 in the SAME commit.
- `apps/web/src/procedures/{ComplianceRuleForm,BuilderSections,DraftBuilder}.tsx` and `apps/web/app/procedures/[id]/builder/actions.ts` — add two editors sharing the one row-version token; reuse `Banner`, `Button`, `ConfirmDialog`.
- `packages/infrastructure/src/telemetry/sentry.ts` — allowlist the new command's failure message or it will not typecheck.

## Tasks & Acceptance

**Execution:**
- [x] `packages/domain/src/procedures/evidence-draft.ts` — `DraftEvidenceFields` (typed requirements + typed Schedule), the evidence vocabulary, the grounding rule, the model-read declaration, the frequency vocabulary, the recorded period-derivation rule, bounded sizes, and the pure `evidenceBlockersFor` completeness diagnostics including the upload/frequency pairing.
- [x] `packages/domain/src/procedures/templates.ts` — structured evidence and schedule defaults per Template; preserve the pinned prose the §C test asserts.
- [x] `packages/application/src/procedures/update-evidence-draft.ts` — two edits (`evidence-requirements`, `schedule`) in one audited, guarded command with no-op detection and a returned token; export it from the package index.
- [x] `packages/application/src/procedures/{ports,create-procedure}.ts` — extend the record, the view and `procedureVersionRowVersion` to cover the new fields.
- [x] `packages/infrastructure/` — generation-11 migration with shape CHECKs using `coalesce(..., false)` and `jsonb_array_length`, hand-appended `INSERT INTO schema_meta`, repository read/write, and the compat range raised in the same commit.
- [x] `apps/web/src/procedures/EvidenceScheduleForm.tsx` (or two forms) wired into `BuilderSections`/`DraftBuilder`, with a new Server Action that authorizes for itself; every `<form>` names `method="post"`.
- [x] Domain tests, command tests, `tests/integration/procedures.test.ts`, `tests/e2e/procedures.spec.ts` — cover every matrix row, rollback, a held-open-transaction concurrency case, reload, keyboard access and a WCAG scan. Record reusable decisions in `CLAUDE.md`.

**Acceptance Criteria:**
- Given a Draft, when the Auditor opens the Builder, then Evidence Requirements and Schedule are editable and exactly TWO sections remain read-only under the pinned sentence.
- Given an attribute grounded only by a screenshot or a recording segment, when the Auditor saves, then the save is refused with a reason naming the attribute, and nothing is written.
- Given an attribute declared model-read, when the Auditor saves and reloads, then it survives recorded as model-read and is not required to be deterministically grounded.
- Given a `manual-upload` binding and a `daily` Schedule, when either section is saved, then the pairing blocker is stated inline on the surface and never silently accepted.
- Given a saved Schedule, when the version is read back, then its frequency, fixed UTC start time and recorded period-derivation rule survive unchanged, and no Run, period or handover has been computed.
- Given a stale row token or a non-DRAFT version, when either edit is saved, then it is refused with a stated reason and no state or event changes.

## Spec Change Log

- 2026-09-04: Implementation review retained the frozen intent. Capture metadata follows actual selected Targets at creation, save and upgrade; Template evidence suggestions remain authored defaults. Added executable upgrade and browser regressions, and explicit section-baseline/request acknowledgement handling for refreshed tokens. No vocabulary, grounding exemption or frequency/period rule changed.

## Review Triage Log

### 2026-09-04 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 16: (high 4, medium 10, low 2)
- defer: 1: (high 1, medium 0, low 0)
- reject: 0
- addressed_findings:
  - `[high]` `[patch]` Backfill capture metadata now reads persisted Target selections rather than Template assumptions.
  - `[high]` `[patch]` Pristine Schedule values refresh with their token; dirty values retain a conflicting baseline.
  - `[high]` `[patch]` Dirty Evidence no longer silently adopts permission to overwrite another author's refreshed section.
  - `[medium]` `[patch]` Grounding validation runs after authoritative capture derivation under the row lock.
  - `[medium]` `[patch]` Successful normalized Evidence saves acknowledge submitted values while retaining in-flight edits.
  - `[low]` `[patch]` Schedule and Evidence edits clear prior success feedback.
  - `[medium]` `[patch]` Schedule validation marks the actual invalid field.
  - `[medium]` `[patch]` Evidence rows retain stable identifiers and focus after removal.
  - `[medium]` `[patch]` Duplicate attribute names are detected inline using trimmed, case-insensitive comparison.
  - `[low]` `[patch]` Period labels describe calendar coverage in human language.
  - `[medium]` `[patch]` Lost responses state an unknown outcome and require inspecting the saved version before retry.
  - `[medium]` `[patch]` Executed generation-10-to-11 upgrade fixtures cover all Templates, lifecycle states and selected/removed Target kinds, retaining every prior field.
  - `[medium]` `[patch]` Browser coverage checks forced capture controls, including newly added rows and deselection.
  - `[high]` `[patch]` A late successful response cannot clear a conflict from a newer refresh.
  - `[medium]` `[patch]` Old prop/token pairs cannot downgrade an acknowledged token; the hook uses the tested request/refresh state machine.
  - `[medium]` `[patch]` New P-1 drafts no longer claim platform capture before any Target is selected.

The descriptive intent review's alternatives are resolved by the existing epic context: UTC time of day, version-wide evidence declarations without an attribute-to-system association, and saveable incomplete drafts whose submission completeness is implemented in Story 2.7. No new product authority was inferred.

## Design Notes

The period-derivation rules are RECORDED, not executed: `daily` → previous calendar day, `weekly` → previous Mon–Sun, `monthly` → previous calendar month, `once` → the explicit Period from Story 2.2. Execution, Regression Runs and handover are later epics. The upload/frequency pairing is the one cross-section invariant in this story: it reads the Story 2.2 binding kind and must not restate that vocabulary. Platform-captured evidence for agent-driven systems is recorded as platform-captured rather than offered as a choice, because capture happens at execution.

## Verification

### Recorded verification, 2026-09-04

- Remote work resumed at `cf42cc6288f0099a7ee9497728dc1626700a73cd`; review must include the original Story 2.5 implementation after `0c744fab107e0346a586c49fed461aaf737399a2`, as well as the resume fixes.
- Node 24.20.0 / pnpm 11.25.0: full typecheck and workspace build passed after the implementation fixes. Dependency boundaries passed; migration reached schema 11; drift generation reported no changes.
- The final full unit suite passed all 1,797 tests across 63 files with one worker and a 30-second test timeout. This includes the request/refresh state-machine additions and all domain, command and Server Action regressions.
- Native PostgreSQL 18.6, TLS/password authentication: all 151 integration tests passed after the final capture changes, including the 59 procedures cases. The executable upgrade test covers 96 combinations of Template, lifecycle state and Target kind/removal and checks preservation of every prior field.
- All 89 browser tests passed after the fixes, including WCAG scans, actual save/reload, forced capture controls on existing and added rows, target deselection, duplicate names and focus, unrelated refresh with dirty inputs, edits during a held successful response, and a committed save whose response is lost.
- The Server Action boundary suite passed all 55 cases. A browser account-creation check after disabling argument logging found neither the test password nor argument traces in the captured log.
- Four independent review layers and a focused follow-up found the patches recorded above. Root reconciled the findings and reviewed the request/refresh state machine. Final full typecheck and production web build passed after the last code changes; every required gate is green.
- Docker startup/socket and Windows virtual-memory failures prevented container verification. Native PostgreSQL removed that blocker. Initial memory/cold-import failures were rerun successfully; the later browser startup failure was resolved by restoring the local database and preserving the stale generated Next cache outside the repository. No application database was used.

### Required checks (acceptance targets, not recorded results)

- `pnpm typecheck`, `pnpm boundaries`, `pnpm test` — all pass.
- `pnpm db:migrate`, `pnpm db:generate`, `pnpm test:integration` — migrates to generation 11, no drift, PostgreSQL 18 checks pass.
- `pnpm build`, `pnpm --filter @intellifin/web build`, `pnpm test:e2e` — builds and Builder journeys pass, including every WCAG 2.1 AA scan.

### Matrix coverage

| Matrix row | Executed evidence |
| --- | --- |
| Evidence save | Command and real-database persistence/audit tests; browser evidence save/reload journey |
| Grounding rule | Domain and command refusals with no state/event mutation; real-database refusal; browser inline named-attribute refusal |
| Model-read attribute | Domain, command and database assertions; browser save/reload |
| Schedule save | Command/database typed values and matching period rule; browser save/reload and response-order regressions |
| Upload/frequency pairing | Pure helper and guarded-save tests; browser warning in both sections and removal after a compatible binding |
| Invalid/stale edit | Domain/Server Action shape checks; non-Draft and stale-token refusals; real held-open transaction race and rollback assertions |

## Auto Run Result

- Implemented typed, version-owned evidence and UTC Schedule authoring with grounding rules, model-read exemption, current-target capture metadata, editable Template defaults, upload/frequency diagnostics, audited atomic writes and full-row concurrency protection.
- Files changed: domain evidence/defaults and tests; application evidence/target commands and tests; generation-11 SQL/schema/snapshot and integration tests; Builder forms, shared section state machine, action tests and browser journeys; Next logging configuration; shared working rules, review records and the draft epic delivery report.
- Review breakdown: 16 patches applied (high 4, medium 10, low 2), one pre-existing cross-editor audit deferred to Story 2.6 within this epic, zero rejected findings. Follow-up review recommended: true; patched score is `3 × 10 + 2 = 32`, and four patched findings were high severity. A focused follow-up review and event-sequence regressions were performed.
- Verification is recorded above. This story is ready for the reviewed branch commit and push required by the user's epic delivery protocol; no push to main or merge is authorized by this completion record.
- Residual scope: earlier Builder editors need the same token/field refresh audit during Story 2.6 wiring. No evidence capture, Run execution, scheduler, plan derivation or approval is claimed by this story.
