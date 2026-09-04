---
title: 'Author the Compliance Rule with compiled and Agent-Judged conditions'
type: 'feature'
created: '2026-09-04'
status: 'in-progress'
review_loop_iteration: 0
baseline_commit: '17fff4b5c1d2401d8346bb47f0085815d569bf24'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Draft conditions are read-only Template prose; rules, applicability, comparisons, and confidence cannot be edited.

**Approach:** Add a Compliance Rule editor and deterministic condition compiler; persist its inputs/output, compiler version, and confidence threshold.

## Boundaries & Constraints

**Always:** Preserve Template wording and stable condition ids. Derive status server-side: supported rules are Rule-Classified; unsupported prose stays verbatim and Agent-Judged. Applicability is always compiled, default `found = true`; invalid applicability is an inline refusal. P-1 C1 applies to all records; C2 applies when found. P-3 covers absent approvals: “No approval” is Exception. Comparisons have explicit inclusive/exclusive semantics; tolerance compiles numerically. Store decimals exactly and one finite confidence threshold within [0,1], default 0.80. Preserve authorization, whole-row concurrency, atomic audit, and dirty edits.

**Ask First:** Changes to FR-9, Template outcomes, or the fixed evaluation order.

**Never:** Execute Runs or authored code, call models, derive Plan Steps, add approval, silently change Population inclusion, or suppress Exceptions. Stories 2.6–2.8 consume/freeze this contract.

## I/O & Edge-Case Matrix

| Scenario | Expected behavior |
|---|---|
| Unsupported prose | Retain Agent-Judged text; invalidate old compiled output |
| Invalid applicability, duplicate ids, bad numbers | Inline refusal; no row/event change |
| Unknown named-set value | Unevaluated; `rule does not name value <v>`; no guessed mapping |
| Missing applicable evaluation | Unevaluated unless another condition is Exception |
| Stale token / non-Draft / wrong role | Refuse; no partial write |
| Unchanged save / failed audit append | No new event / rollback entire edit |

</frozen-after-approval>

## Code Map

- `packages/domain/src/procedures/{templates,procedure-version}.ts`: Template defaults and validated sections; typed conditions become authoritative, legacy prose remains reference.
- `packages/application/src/procedures/{ports,create-procedure,update-target-draft}.ts`: records/views, creation, `procedureVersionRowVersion`, locked audited-save precedent.
- `packages/infrastructure/src/procedures/procedure-repository.ts`: selection, validation, writes; `src/db/{schema,compat}.ts` and `drizzle/` in that package: generation 10.
- `apps/web/src/procedures/{DraftBuilder,BuilderSections}.tsx`, `apps/web/app/procedures/[id]/builder/{page.tsx,actions.ts}`: editor/action and shared token. Reuse `StatusBadge`, `Banner`, `Button`, `ConfirmDialog`, and 900px floor.

## Tasks & Acceptance

**Execution:**

- [ ] Add domain `procedures/compliance-draft.ts` and `plan-compiler.ts`: versioned validated contract, deterministic compiler, exact decimals, and Exception → Unevaluated → Compliant reducer. Bound ids/text/expression size; refuse non-storable text.
- [ ] Use closed typed expressions over declared Observation fields: boolean composition, named sets, numeric/time comparisons, P-2 role expansion/pairs, P-4 baseline comparison. Seed structured defaults alongside pinned prose. Changed text must not retain a Template-derived rule. Persist authored text, AST, applicability, status, schema/compiler versions; reject client-supplied compilation claims.
- [ ] Add application `procedures/update-compliance-draft.ts` and exports. Use the stored supported compiler version, lock/guard, detect no-op, return token. Audit ids/digests/lengths, not raw text. Allowlist its failure message in `packages/infrastructure/src/telemetry/sentry.ts`.
- [ ] Add typed columns, generation-10 Template backfill, SQL shape/range constraints, fail-closed reads, creation defaults, full row token, and compatibility range together; preserve existing edits. Migrate only through release/CI.
- [ ] Add `ComplianceRuleForm.tsx`: text, applicability, comparisons/tolerance, badges, stable-id add/remove, and one Agent-Judged threshold field. Validate on blur/save, confirm saves, preserve dirty edits; four sections remain read-only.
- [ ] Add compiler/command tests; extend `tests/integration/procedures.test.ts`, `tests/e2e/procedures.spec.ts`; record reusable decisions in `CLAUDE.md`.

**Acceptance Criteria:**

1. Four Templates open editable; P-1 C1 compiles, C2 is Agent-Judged. Identical frozen inputs/version produce identical output; edits/threshold survive reload.
2. Supported edits compile; arbitrary prose cannot retain old output. Applicability handles P-1 absence and P-3 missing approval correctly.
3. Pure tests exercise P-3 below/exactly/above USD 100,000, both boundary modes, numeric tolerance, and the optional P-1 24-hour boundary. Population inclusion stays unchanged.
4. Tests prove unnamed-value diagnostics and reduction order, including missing Agent-Judged evaluation. Missing, ambiguous, contradictory, or uninspected evidence cannot yield Compliant.
5. Integration covers backfill, malformed rows, authorization/state/stale guards, rollback, no-op, and concurrent section edits. Browser coverage includes controls, badges, reload, dirty edits, keyboard access and WCAG.

## Verification

Run `pnpm typecheck`, `pnpm boundaries`, `pnpm test`, `pnpm db:generate`, `pnpm test:integration` (PostgreSQL 18), `pnpm build`, `pnpm --filter @intellifin/web build`, `pnpm test:e2e`. Keep builds separate from boundary tests; report unrun gates.

## Spec Change Log

## Design Notes

Pure compilation precedes Story 2.6's queued plan derivation. Later model-read Evidence can change evaluation origin (addendum §B.1); confidence/confirmation and Gate enforcement remain Run work. No unresolved product decision.
