---
title: 'Specify Evidence Requirements and set the Schedule'
type: 'feature'
created: '2026-09-04'
status: 'in-progress'
review_loop_iteration: 0
baseline_commit: '0c744fab107e0346a586c49fed461aaf737399a2'
deferred: []
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
- [ ] `packages/domain/src/procedures/evidence-draft.ts` — `DraftEvidenceFields` (typed requirements + typed Schedule), the evidence vocabulary, the grounding rule, the model-read declaration, the frequency vocabulary, the recorded period-derivation rule, bounded sizes, and the pure `evidenceBlockersFor` completeness diagnostics including the upload/frequency pairing.
- [ ] `packages/domain/src/procedures/templates.ts` — structured evidence and schedule defaults per Template; preserve the pinned prose the §C test asserts.
- [ ] `packages/application/src/procedures/update-evidence-draft.ts` — two edits (`evidence-requirements`, `schedule`) in one audited, guarded command with no-op detection and a returned token; export it from the package index.
- [ ] `packages/application/src/procedures/{ports,create-procedure}.ts` — extend the record, the view and `procedureVersionRowVersion` to cover the new fields.
- [ ] `packages/infrastructure/` — generation-11 migration with shape CHECKs using `coalesce(..., false)` and `jsonb_array_length`, hand-appended `INSERT INTO schema_meta`, repository read/write, and the compat range raised in the same commit.
- [ ] `apps/web/src/procedures/EvidenceScheduleForm.tsx` (or two forms) wired into `BuilderSections`/`DraftBuilder`, with a new Server Action that authorizes for itself; every `<form>` names `method="post"`.
- [ ] Domain tests, command tests, `tests/integration/procedures.test.ts`, `tests/e2e/procedures.spec.ts` — cover every matrix row, rollback, a held-open-transaction concurrency case, reload, keyboard access and a WCAG scan. Record reusable decisions in `CLAUDE.md`.

**Acceptance Criteria:**
- Given a Draft, when the Auditor opens the Builder, then Evidence Requirements and Schedule are editable and exactly TWO sections remain read-only under the pinned sentence.
- Given an attribute grounded only by a screenshot or a recording segment, when the Auditor saves, then the save is refused with a reason naming the attribute, and nothing is written.
- Given an attribute declared model-read, when the Auditor saves and reloads, then it survives recorded as model-read and is not required to be deterministically grounded.
- Given a `manual-upload` binding and a `daily` Schedule, when either section is saved, then the pairing blocker is stated inline on the surface and never silently accepted.
- Given a saved Schedule, when the version is read back, then its frequency, fixed UTC start time and recorded period-derivation rule survive unchanged, and no Run, period or handover has been computed.
- Given a stale row token or a non-DRAFT version, when either edit is saved, then it is refused with a stated reason and no state or event changes.

## Spec Change Log

## Design Notes

The period-derivation rules are RECORDED, not executed: `daily` → previous calendar day, `weekly` → previous Mon–Sun, `monthly` → previous calendar month, `once` → the explicit Period from Story 2.2. Execution, Regression Runs and handover are later epics. The upload/frequency pairing is the one cross-section invariant in this story: it reads the Story 2.2 binding kind and must not restate that vocabulary. Platform-captured evidence for agent-driven systems is recorded as platform-captured rather than offered as a choice, because capture happens at execution.

## Verification

- `pnpm typecheck`, `pnpm boundaries`, `pnpm test` — all pass.
- `pnpm db:migrate`, `pnpm db:generate`, `pnpm test:integration` — migrates to generation 11, no drift, PostgreSQL 18 checks pass.
- `pnpm build`, `pnpm --filter @intellifin/web build`, `pnpm test:e2e` — builds and Builder journeys pass, including every WCAG 2.1 AA scan.
