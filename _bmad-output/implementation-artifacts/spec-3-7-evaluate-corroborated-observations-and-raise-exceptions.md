---
title: 'Story 3.7: Evaluate corroborated Observations deterministically and raise Exceptions'
type: 'feature'
created: '2026-09-05'
status: 'in-progress'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/docs/contracts/observation-registration-v1.md'
  - '{project-root}/docs/contracts/structural-snapshot-v1.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Corroborated Observations exist but nothing applies the version's compiled conditions to them, so no record is ever Compliant or an Exception, and nothing durable records a control failure.

**Approach:** Run the version's already-compiled conditions over each corroborated Observation at registration time, deterministically and with origin `RULE`, deriving the record's evaluation in the fixed order Exception, then Unevaluated, then Compliant, and creating a permanent fingerprinted Exception in the same transaction as the first Exception evaluation.

## Boundaries & Constraints

**Always:** Reuse `evaluateComplianceRecord` in `packages/domain/src/procedures/plan-compiler.ts`, which already implements the approval and permission-pair rules, the decimal boundaries and the conservative evidence handling. Wire it in; do not write a second rules engine. Evaluate inside the registration transaction Story 3.4 owns. Derive the record evaluation in order: Exception, then Unevaluated, then Compliant. Repeat evaluation of identical Observations under the same version yields identical results; no human can override a Rule-Classified evaluation, and a disagreement is recorded separately rather than replacing it. An attribute value no compiled condition names evaluates `UNEVALUATED` with the diagnostic `rule does not name value <v>`, quoting the value verbatim. Respect `applicable: false`: a non-applicable condition is not counted among applicable conditions. The P-3 boundary is inclusive, so exactly USD 100,000.00 requires approval. The first `EXCEPTION` recorded for a record creates the Exception in that same transaction with a Run-stable identifier and an HMAC-SHA-256 fingerprint whose key id is retained; an Exception is never deleted. Unmatched, ambiguous, uninspected and uncorroborated records are never Compliant.

**Block If:** A compiled condition's semantics would have to change to make a golden case come out right. The expectations are data and the rules are frozen; a disagreement is a finding, not a licence to edit either.

**Never:** Do not import anything under `fixtures/northstar/expectations/` from runtime code. Do not create a second evaluator, re-derive a condition from authored prose, or let a model participate. Do not seal a Result (3.9) or run Run-level Gate rows (3.8).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Compliant record | Corroborated, no prohibited pair | `COMPLIANT`, origin `RULE` | None |
| Exception record | A prohibited pair present | `EXCEPTION`, every violating pair reported, Exception created with a fingerprint in the same transaction | Atomic |
| Unnamed value | An attribute value no condition names | `UNEVALUATED`, diagnostic `rule does not name value <v>` | Verbatim value |
| Inclusive boundary | P-3 amount exactly USD 100,000.00 | Approval required; evaluated on that basis | Never off by the boundary |
| Repeat evaluation | Same Observations, same version, run twice | Identical evaluations | Deterministic |
| Non-applicable condition | `applicable: false` | Excluded from applicable counts | Never counted |
| Uncorroborated or ambiguous | Contradictory, ambiguous or uninspected record | Never `COMPLIANT` | Conservative |
| Second Exception for one record | A record already carrying an Exception | The existing Exception stands; no duplicate | Never deleted |

</intent-contract>

## Code Map

- `packages/domain/src/procedures/plan-compiler.ts` — `evaluateComplianceRecord` ALREADY implements the deterministic approval and permission-pair rules, the decimal boundaries and the conservative evidence handling, and `COMPLIANCE_OBSERVATION_FIELDS` declares each Template's fields. Wire it in. A second rules engine is forbidden: two engines agree on every case anybody thinks to try and diverge on the first one nobody does.
- `packages/domain/src/procedures/compliance-draft.ts` — `compareComplianceDecimals`, exact decimal comparison on strings. Money never passes through binary floating point, so the P-3 boundary at exactly 100000.00 is decided on scaled integers.
- `packages/application/src/runs/register-observations.ts` — the `NO_EVALUATION` seam Story 3.4 left, inside the one registration transaction. Fill it there; do not add a second call site, and do not change the pinned digest.
- `packages/domain/src/runs/observation.ts` — `ObservationRecord`, the coverage rule, and the evaluation shape §B.1 defines. Story 3.6 added the corroboration verdict, including the per-attribute slot the evaluator must consult.
- `packages/infrastructure/drizzle/0020_*.sql`, `0022_*.sql` — `run_observation_evaluation` and the three-column foreign key that already makes COMPLIANT unreachable for an uninspected or contradicted record. A generation 23 migration adds the Exception with its fingerprint; raise `SUPPORTED_SCHEMA_MIN`/`MAX` together and list any new table in `tests/integration/schema-compat.test.ts`.
- `packages/domain/src/registrations/target-system.ts` and `packages/domain/src/sha256.ts` — how this codebase computes a keyed digest, and why the domain hand-rolls SHA-256 rather than reaching for `node:crypto`. The Exception fingerprint is HMAC-SHA-256 with its key id retained.
- `fixtures/northstar/expectations/p-2-sod-conflicts.json`, `p-3-high-value-approvals.json` — DATA (AD-12). Runtime code must never import them; tests read them to assert per-record outcomes.

## Tasks & Acceptance

**Execution:**
- `packages/domain/src/runs/evaluation.ts` (new) — the record-evaluation reducer in the fixed order Exception, then Unevaluated, then Compliant; the `rule does not name value <v>` diagnostic quoting the value verbatim; and the Exception identity and HMAC-SHA-256 fingerprint with its retained key id.
- `packages/application/src/runs/register-observations.ts` — fill the evaluation seam, creating the Exception in the same transaction as the first EXCEPTION evaluation for a record.
- `packages/infrastructure/` generation 23, schema, `db/compat.ts`, `tests/integration/schema-compat.test.ts` — the Exception table, its Run-stable identifier, its fingerprint, and a constraint making an Exception undeletable.
- Tests — domain tests for the reducer and the boundary; application tests for the same-transaction Exception and for repeat determinism; integration coverage of every matrix row; and per-record assertions against BOTH golden expectation files, read as data.

**Acceptance Criteria:**
- Given a corroborated record, when its compiled conditions are evaluated, then the evaluation has origin `RULE` and the record derives in the order Exception, then Unevaluated, then Compliant.
- Given identical Observations and the same version, when evaluation repeats, then the results are identical and no human can override a Rule-Classified evaluation.
- Given an attribute value no compiled condition names, when it is evaluated, then it is `UNEVALUATED` with the diagnostic `rule does not name value <v>` quoting the value verbatim.
- Given a P-3 transaction of exactly USD 100,000.00, when the boundary condition is evaluated, then approval is required.
- Given the first EXCEPTION for a record, when it is registered, then the Exception is created in that same transaction with a Run-stable identifier and an HMAC-SHA-256 fingerprint, and is never deleted.
- Given the P-2 and P-3 golden populations, when a Run completes, then every named per-record case matches its expectation file exactly.

## Spec Change Log

## Review Triage Log

## Verification

**Commands:**
- `pnpm typecheck`, `pnpm boundaries`, `pnpm test` (alone) — expected: pass.
- `pnpm db:migrate` then `pnpm test:integration` — expected: the new generation applied, all pass against PostgreSQL 18 on a `test`- or `ci`-named database.
- `pnpm db:generate` — expected: no drift.
- `pnpm build`, `pnpm --filter @intellifin/web build`, `pnpm test:e2e` — expected: pass, no accessibility violations.
