---
title: 'Bind a Population Source with an inclusion rule and declared count'
type: 'feature'
created: '2026-09-04'
status: 'done'
review_loop_iteration: 0
baseline_commit: '9982386434ef42d7ebbc35ecd9263443b8263b51'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A new Procedure Draft contains Template prose but cannot yet define its effective period, business scope, or the registered Population Source and filter a future Run must acquire.

**Approach:** Make the Period and scope and Population Source binding Builder sections editable on a Draft. Persist a validated, version-owned source snapshot, structured inclusion rule, explicit period/scope, and the two Gate policy flags through an audited, optimistic-concurrency command.

## Boundaries & Constraints

**Always:** Keep the Procedures module as the owner of version meaning; resolve a selected source through a source-owned port, never a direct cross-module table read. Persist the source's exact binding id, digest, and five-field digest contract; reuse `bindingDigest`, do not create another source digest. Store a date-only `{ from, to }` explicit period with real Gregorian dates, `from <= to`, inclusive UTC semantics, and a verbatim scope statement. Use inclusion-rule schema version 1: `{ schemaVersion: 1, all: Predicate[] }`, where each predicate names a declared column and is one of text equality, decimal comparison (`eq`, `neq`, `gt`, `gte`, `lt`, `lte`), or `within-period`; an empty list means include all. Bind only active sources, but preserve an existing Draft's saved snapshot after its source is retired. Validate manual-upload only with `once`, surface the exact count warning for `none`, and persist zero-record-Pass plus versioned-duplicate permission separately. Authorize before parsing input; validate in the domain; guard the whole version row; write state and audit event in one transaction.

**Ask First:** A new inclusion-rule operator, implicit type coercion, a source kind, or a schedule meaning beyond the stated contract.

**Never:** Acquire or upload a source, parse/filter a Run population, calculate a declared count, execute Gate rules, derive scheduled periods, derive a plan, submit/approve, or modify another module's tables. Do not silently replace an incompatible Template predicate with include-all or remap an unknown declared column.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Valid Draft edit | Active source, valid period/scope/rule, current row token | Version stores source snapshot, flags, and section values; one audited change | Transaction commits all or none |
| Manual upload + recurring schedule | `manual-upload` with daily/weekly/monthly | Exact manual-upload blocker | No write |
| No count declaration | Source mechanism `none` | Visible exact warning and stored Draft blocker | Submission remains later work |
| Invalid rule | Unknown column/operator, malformed decimal/date, or over bound | Refuse the edit | No write or audit change |
| Stale source/version | Version or source contract changed after render | Refuse without attaching unseen source data | Re-read under transaction guard |
| Retired source | New selection is retired | Refuse new selection; retain an already saved historical snapshot | No historical rewrite |

</frozen-after-approval>

## Code Map

- `packages/domain/src/procedures/procedure-version.ts` — extend the version-owned Draft contract and its structural validator.
- `packages/domain/src/procedures/templates.ts` — express each Template's typed default rule; map P-1's `termination_date` intent to the actual declared field explicitly.
- `packages/domain/src/sources/population-source.ts` — reuse kind, declared-count, and binding-digest definitions unchanged.
- `packages/application/src/procedures/{ports,create-procedure}.ts` — add the source-reader port and audited Draft update command; extend the full-row token.
- `packages/infrastructure/src/{db/schema.ts,procedures/procedure-repository.ts,procedures/procedures-unit-of-work.ts}` — migrate and persist typed version fields through transaction-scoped adapters.
- `apps/web/app/procedures/[id]/builder/{page,actions}.tsx` and `apps/web/src/procedures/` — replace the two read-only section cards with accessible, confirmation-backed editors; retain other cards read-only.
- `packages/application/src/sources/ports.ts` and `packages/infrastructure/src/sources/binding-repository.ts` — expose source eligibility without allowing Procedures to query source tables directly.

## Tasks & Acceptance

**Execution:**
- [x] Domain procedures modules — define period, source snapshot, rule predicates, bounds, Template defaults, and validation; add focused unit tests.
- [x] Procedures application ports/command — resolve an active binding, validate a full Draft section update, compare source digest and version token, then append an audited change atomically.
- [x] Infrastructure schema/adapters — add generation 8 fields and constraints, schema compatibility support, transaction-scoped source read, and repository mappings.
- [x] Builder UI/actions — render/edit period, scope, active source, rule clauses, and flags; show inline blockers and exact UX copy; preserve remaining read-only sections.
- [x] Tests — cover domain/application contracts, PostgreSQL constraints and rollback/staleness, Server Action authorization order, Builder accessibility, and migration/schema compatibility; the local PostgreSQL 18 suite passed, while browser execution remains blocked by pre-existing Windows Next.js startup failures.
- [x] `CLAUDE.md` — record reusable decisions and any implementation gotchas in the same change.

**Acceptance Criteria:**
- Given a Draft, when an Auditor saves a valid explicit period and scope, then both are stored on that Draft without implementing scheduled-period derivation.
- Given an active source and valid declared-column rule, when an Auditor saves the binding, then the version retains its exact source contract and digest with an auditable change.
- Given manual upload with a recurring schedule, when the Auditor saves, then the exact manual-upload refusal is shown and nothing changes.
- Given a `none` declared-count source, when it is selected, then the exact count warning is visible and the version records the blocker for later submission.
- Given zero-record-Pass or duplicate permission, when changed, then each is persisted independently on the Draft.
- Given a stale version, changed source digest, retired new source, or invalid rule, when saved, then the command refuses without writing state or an audit event.

## Design Notes

Inclusion rules are deliberately typed data rather than free-form text: Epic 3 can execute exactly the authored version without model interpretation. `within-period` uses the Draft's inclusive UTC date range. The Template prose spelling `termination_date` is not a license to guess: the stored P-1 rule names `termination_effective_date`, and a replacement source must expose an author-selected compatible declared column.

## Verification

**Commands:**
- `pnpm typecheck && pnpm boundaries && pnpm test` — expected: all type, layering, and unit checks pass.
- `pnpm db:generate && pnpm test:integration` — expected: no uncommitted migration drift after the intended migration and PostgreSQL contract tests pass.
- `pnpm build && pnpm --filter @intellifin/web build && pnpm test:e2e` — expected: production build and Builder accessibility journeys pass.

## Suggested Review Order

**Draft update boundary**

- Authorizes first, locks the full version row, and audits each meaningful change.
  [`update-population-draft.ts:22`](../../packages/application/src/procedures/update-population-draft.ts#L22)

**Typed population contract**

- Validates date-only periods, snapshots, predicates, and source-specific Gate blockers.
  [`population-draft.ts:66`](../../packages/domain/src/procedures/population-draft.ts#L66)

- Holds the source-owned registration row while the Procedure freezes its exact contract.
  [`binding-repository.ts:151`](../../packages/infrastructure/src/sources/binding-repository.ts#L151)

- Adds generation-eight storage and conservative database-level shape constraints.
  [`0008_swift_hulk.sql:1`](../../packages/infrastructure/drizzle/0008_swift_hulk.sql#L1)

**Authoring experience**

- Makes the two Draft sections editable while retaining the remaining Builder sections as read-only.
  [`DraftBuilder.tsx:13`](../../apps/web/src/procedures/DraftBuilder.tsx#L13)

- Preserves authorization-before-parsing at the Server Action boundary.
  [`actions.ts:163`](../../apps/web/app/procedures/[id]/builder/actions.ts#L163)

**Evidence and durable guidance**

- Exercises malformed rules, staleness, transaction rollback, and persisted Builder behavior.
  [`procedures.test.ts:570`](../../packages/application/src/procedures/create-procedure.test.ts#L570)

- Records source-snapshot and migration compatibility decisions for later epic work.
  [`CLAUDE.md:399`](../../CLAUDE.md#L399)
