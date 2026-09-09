---
title: 'Story 4.12: Evaluate the 24-hour disablement window through the complete evidence path'
type: 'feature'
created: '2026-09-08'
status: 'in-progress'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-fixture-map.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-loancore-authentication-decision.md'
  - '{project-root}/_bmad-output/planning-artifacts/prds/prd-IntelliFin Audit-2026-08-31/addendum.md'
  - '{project-root}/docs/contracts/deterministic-evaluation-v1.md'
  - '{project-root}/docs/contracts/capture-grounding-absence-v1.md'
warnings: []
deferred:
  - 'Builder authoring of the mapping and the variant Evidence Requirement is part of the hero-workflow usability pass (codex/epic-4-hero-ux); this story freezes and proves the contract, and the Builder validator (`apps/web/app/procedures/[id]/builder/actions.ts`) already accepts a `mapping` key.'
  - 'A deployed LoanCore registration must gain the `Disabled time` label pattern through the authorized configuration flow. The catalogue and the seed script carry it; a live registration is a digest-bearing change that mints platform-authored Drafts for the Procedures that reference it, which is the existing Story 2.8 ripple and not something this story performs.'
---

<intent-contract>

## Intent

**Problem:** Addendum §C names a 24-hour disablement-window variant of P-1's C1
(`disabled_time - termination_time <= 24h`, exactly 24 hours Compliant) and §D seeds its boundary
case (E-000105), but nothing supplied either instant to the rule: the population carried a
termination DATE under `termination_effective_date`, LoanCore's page never showed when an account
was disabled, and compiler 1's `termination_time` field had no declared source. A rule with no
evidence path is a sentence, not a control.

**Approach (owner decision 2, 2026-09-08, addendum §0b):** one bounded story that authors, freezes
and proves the complete path — an explicit per-condition population field mapping for the
termination instant; the disablement instant as a labelled attribute on LoanCore's own account
page, captured through the approved interfaces and grounded at a locator in registered bytes;
employee identity correlation by the platform's existing one-key-one-group rule; compiler 1's
duration comparison over UTC-normalized instants with the frozen boundary. It is deliberately NOT
a universal mapping platform.

## Boundaries & Constraints

- **Versioned contract, no rewrite of frozen versions.** `mapping` is an OPTIONAL key on
  `ComplianceConditionInput` (time fields only, at most `COMPLIANCE_LIMITS.mappings`, one column
  per field across the version), omitted when absent so every legacy row recompiles byte for
  byte. Existing Approved, Active and Retired versions are untouched.
- **Never a hidden fixture import.** The disablement instant is rendered by the synthetic
  system (`apps/northstar/src/loancore.ts`, `Disabled time`), registered as a label pattern in
  `fixtures/northstar/datasets/systems.json`, declared in `loancore-accounts.json`
  (`declared_attribute_labels.disabled_time`), and frozen with the version. Runtime code reads no
  expectation file.
- **Variant labels are captured only when asked for.** `variantAttributeLabels` on the P-1
  Template; `attributeLabelFor(template, name, requested)` offers and accepts `Disabled time`
  only when the version's Evidence Requirements name `disabled_time` and the target's frozen
  `attribute_label_patterns` permit the label. Default P-1 Runs capture nothing new.
- **No guessed correlation.** A mapping to a column the source does not carry supplies nothing
  (`missing or invalid Observation field termination_time`); `termination_effective_date` is never
  promoted to an instant; a page whose identity cell is another employee registers nothing.
- **C1 and C2 are unchanged.** C3 is authored BESIDE the explicit status rule in the canonical
  fixture (`canonicalLoanCoreCompliance({ disablementWindow: true })`); an Active account has no
  disablement instant and C1 is what makes that an Exception while C3 stays Unevaluated.

## Delivered

- Domain: `PopulationFieldMapping`, `normalizeFieldMappings`, `complianceFieldMappings`,
  `conditionKeysAccepted` (`plan-compiler.ts`, `compliance-draft.ts`); `observationRuleValues`
  applies mappings after same-named columns and under grounded attributes (`runs/evaluation.ts`);
  `variantAttributeLabels` + `attributeLabelFor` (`templates.ts`); addendum §C sentence transcribed.
- Application: planner offers and capture accepts the variant label when requested
  (`agent-tool-planner.ts`, `agent-observation.ts`); human-decision labels through
  `attributeLabelFor`; rule evaluation passes the version's mappings.
- Synthetic systems and fixtures: LoanCore renders `Disabled time`; catalogue label pattern;
  `startCanonicalLeaverSource(id, { terminationTime: true })` joins the PeopleHub instant into a
  separately declared single-case source with its own signed cover sheet.
- Web: the Builder validator accepts `mapping` on a condition.
- Contracts: `docs/contracts/deterministic-evaluation-v1.md` (mapping section),
  `docs/contracts/capture-grounding-absence-v1.md` (variant-label invariants).

## Acceptance (owner's list, each with its proof)

| Owner requirement | Proof |
|---|---|
| Below 24h Compliant, exactly 24h Compliant (inclusive), above 24h Exception | `packages/domain/src/procedures/disablement-window.test.ts`; `execute-agent-work-item.test.ts` (one second past, exclusive boundary) |
| Equivalent instants with different offsets | `disablement-window.test.ts` |
| Missing or invalid timestamps | `disablement-window.test.ts`; `execute-agent-work-item.test.ts` (page without `Disabled time` fails `required-evidence`) |
| Wrong-employee correlation refused | `execute-agent-work-item.test.ts` (a page for another employee registers nothing) |
| Date-only source cannot substantiate | `disablement-window.test.ts`; `tests/unit/canonical-loancore-compliance.test.ts`; `tests/e2e/disablement-window-journey.spec.ts` second case (Inconclusive, naming `termination_time`) |
| Both timestamps through approved interfaces, locators and provenance | `tests/e2e/disablement-window-journey.spec.ts` first case (declared source + cover sheet over HTTP; LoanCore page capture grounded at a `$.nodes[i].value` locator in REGISTERED bytes, same record group as the identity; inspector shows the label and the cell; PASS after C2 confirmation) |
| §D E-000105 golden boundary case | `tests/unit/canonical-loancore-compliance.test.ts` reads the datasets and the expectation file |
| Frozen versions preserved; contract versioned | Optional key omitted when absent; `plan-compiler` recompilation tests unchanged |

## Verification status

- Implemented: yes (this branch).
- Locally verified: domain, application, web and Northstar unit suites and typechecks pass; the
  compiled-worker browser journey `disablement-window-journey.spec.ts` is run against a local
  PostgreSQL 18, the real worker, the real synthetic LoanCore and a real object store (result
  recorded in the engineering continuation log).
- Remotely verified: no. The hosted CI browser gate runs the journey on the pushed candidate.
- Owner-reviewed: no. Deployed: no.

</intent-contract>
