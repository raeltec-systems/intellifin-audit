---
title: 'Select Target Systems and write Audit Instructions with the scope-widening check'
type: 'feature'
created: '2026-09-04'
status: 'ready-for-dev'
review_loop_iteration: 0
baseline_commit: 'de0b636058f0d11ac45820ed99b987e963ebe413'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Drafts show Template target names and instructions but cannot save registered Target Systems or warn when instructions exceed their scope.

**Approach:** Add Target System selection and per-system Audit Instructions editors, with version-owned registration snapshots and deterministic advisory scope checks.

## Boundaries & Constraints

**Always:** Store each selected registration's id, display name, stored digest, and exact six-field contract, including labels and secondary key. Resolve new selections through a registration-owned transactional reader; require active status and the rendered digest. Retain existing snapshots explicitly without silently refreshing changed or retired registrations. Store instructions verbatim per selected web/desktop registration; API/file systems remain selectable without agent instructions. Keep one ordered selection with unique registration ids. Missing selections, or missing web/desktop coverage for P-1, are completeness diagnostics distinct from advisory scope warnings. Authorize before parsing, validate in the domain, guard the entire Draft row, and commit changes with their audit event. Keep credential references out of audit payloads.

**Ask First:** Changes to the registration digest contract, runtime scope policy, or product meaning beyond FR-7/FR-8.

**Never:** Execute instructions, contact targets, resolve credentials, derive plans, implement submission/approval, create registrations automatically, or read registration tables from Procedures. A scope warning alone must not refuse a save or become a submission blocker; FR-8 explicitly makes it advisory.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Snapshot save | Active systems and current tokens | Save exact contracts and verbatim instructions | Atomic state/event |
| Scope widening | Unselected/unregistered system, forbidden action, outside origin | Name the offending system, action, or origin inline on blur and re-check | Advisory; retain text |
| Correction/removal | Edit or clear flagged instruction | Re-check current text and selection; warning clears | No stale warning |
| Stale selection | Digest changed or newly selected registration retired | Refuse attaching unseen/ineligible data | No write |
| Historical snapshot | Retain saved system after registration change/retirement | Preserve original contract | Never refresh implicitly |
| Invalid/stale edit | Duplicate ids, orphan instruction, invalid text, non-Draft, old row token | Refuse with a stated reason | No state/event change |

</frozen-after-approval>

## Code Map

- `packages/domain/src/registrations/target-system.ts` — reuse `RegistrationDigestEnvelope`, `registrationDigestEnvelope`, `registrationDigest`, `TARGET_SYSTEM_KINDS`, `PERMITTED_READ_ACTIONS`; `MUTATING_VERBS` omits the seeded `disable` verb.
- `packages/domain/src/procedures/{procedure-version,templates,population-draft}.ts` — reuse `initialDraftSections`, `findProcedureTemplate`, and typed Draft validation.
- `packages/application/src/procedures/{ports,create-procedure,update-population-draft}.ts` — extend `ProcedureVersionRecord`, `ProcedureVersionView`, `ProceduresUnitOfWorkContext`, `procedureVersionRowVersion`; reuse `PROCEDURE_AUTHOR_ACTION`, `PROCEDURE_DRAFT_CHANGED_EVENT`, and guarded update semantics.
- `packages/application/src/registrations/ports.ts` and `packages/infrastructure/src/registrations/registration-repository.ts` — extend registration-owned reads; `DrizzleRegistrationRepository.listRegistrations` includes retired rows and truncates at 200, so filtering its result is insufficient.
- `packages/infrastructure/src/procedures/{procedure-repository,procedures-unit-of-work}.ts` — extend `DrizzleProcedureWriter`, `PostgresProceduresUnitOfWork`; follow `DrizzlePopulationSourceReader.findBindingForShare`.
- `apps/web/src/procedures/{DraftBuilder,BuilderSections}.tsx` and `apps/web/app/procedures/[id]/builder/{page.tsx,actions.ts}` — insert section editors; share the returned row token with population and rename saves; reuse `Banner`, `Button`, `ConfirmDialog`, and `Digest`.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/domain/src/procedures/target-draft.ts` — add snapshots, instructions, bounds, validation, completeness diagnostics, and pure scope checker.
- [ ] `packages/domain/src/procedures/{templates,procedure-version}.ts` — add explicit default names/kinds and instructions; preserve pinned prose.
- [ ] `packages/application/src/registrations/ports.ts`, mapped adapters — add eligible reads and shared locks in stable id order.
- [ ] `packages/application/src/procedures/update-target-draft.ts` and existing ports/token — implement audited guarded save with explicit bind/retain semantics, no-op detection, and returned token.
- [ ] `packages/infrastructure/src/db/{schema,compat}.ts`, `packages/infrastructure/drizzle/`, Procedures repository — migrate typed fields, preserve existing Drafts, add shape constraints, and raise schema compatibility together.
- [ ] Builder files above — render defaults, snapshots and instructions; validate on blur, confirm saves, preserve edits, keyboard access, and desktop-width rule.
- [ ] `packages/domain/src/procedures/target-draft.test.ts`, command tests, `tests/integration/procedures.test.ts`, `tests/e2e/procedures.spec.ts` — cover matrix, rollback, concurrency, reloads, accessibility.
- [ ] `fixtures/northstar/expectations/scope-widening-instructions.json` and `CLAUDE.md` — align only stale authoring-expectation prose with advisory FR-8; preserve seed ids/text and execution outcomes; record reusable decisions.

**Acceptance Criteria:**
- Given each Template, when its Draft opens, then its default targets are offered by name; unavailable or ambiguous matches require explicit selection, and P-1 identifies required web and desktop coverage.
- Given selected systems, when the Auditor saves and reloads, then complete registration snapshots and per-agent-system instruction text survive unchanged.
- Given SW-1, SW-2, and SW-3, when checked, then all three produce named advisory warnings before submission exists; permitted Template instructions do not produce false write warnings for read-only status labels.
- Given saved instructions, when Story 2.6 reads the version, then its typed contract supplies the updated verbatim text.

## Spec Change Log

## Design Notes

FR-8 overrides fixture prose saying “refuse to compile.” Runtime code cannot import expectations. Match URL authority and path boundaries: `/loancore-other` is outside `/loancore`. Desktop identity occupies `allowed_origins`. Preserve label patterns; infer no locator mappings. LedgerDesk is deferred; keep missing defaults visible and test a registered synthetic desktop.

## Verification

- `pnpm typecheck`, `pnpm boundaries`, `pnpm test` — all checks pass.
- `pnpm db:generate`, `pnpm test:integration` — no drift; PostgreSQL checks pass.
- `pnpm build`, `pnpm --filter @intellifin/web build`, `pnpm test:e2e` — builds and Builder journeys pass; report Windows startup limits.
