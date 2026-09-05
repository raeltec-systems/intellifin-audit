---
title: 'Story 3.7: Evaluate corroborated Observations deterministically and raise Exceptions'
type: 'feature'
created: '2026-09-05'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/docs/contracts/observation-registration-v1.md'
  - '{project-root}/docs/contracts/structural-snapshot-v1.md'
  - '{project-root}/docs/contracts/deterministic-evaluation-v1.md'
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

- 2026-09-05 — The evaluation seam is BUILT by the adapter stage rather than injected into
  it, and `AdapterExecutionDependencies.evaluation` is replaced by `exceptions` (the
  fingerprint key as a port). `ruleEvaluation` needs the frozen plan, the frozen included
  population and the Reference Source bytes the Run's own Session Steps froze; a composition
  root holds none of the three, so a seam it supplied could only ever be `NO_EVALUATION` —
  the Story 3.6 corroboration lesson, one story along. `NO_EVALUATION` remains for a
  producer with no compiled conditions.
- 2026-09-05 — The Exception fingerprint key is `EXCEPTION_FINGERPRINT_KEY`, the worker's
  alone. Absent, adapter execution is DISABLED by name (the `CREDENTIAL_TOKENS` trade)
  rather than the worker refusing to boot or an Exception being written unfingerprinted.
- 2026-09-05 — A non-applicable condition stores the compiler's own `COMPLIANT` and records
  `condition does not apply to this record` in its diagnostic. §B.1's evaluation shape has
  no `applicable` field, and the record's value is the compiler's fixed reduction over these
  values, so a second reduction here would be a second engine. The diagnostic is what lets
  Story 3.8's count of APPLICABLE conditions exclude it.
- 2026-09-05 — P-3 case D4 (TX-500007) has no per-record evaluation and cannot have one: the
  row carries no `processed_time`, so Story 3.2's frozen inclusion rule marks it
  INDETERMINATE and it never reaches an Observation. Its Inconclusive is the
  `complete-inclusion` population Gate's. The golden test pins that this is the only case
  reached that way and asserts the row's disposition and reason. No expectation was edited.
- 2026-09-05 — `docs/contracts/deterministic-evaluation-v1.md` records the whole rule, in
  the shape Stories 3.2-3.6 each use.

## Review Triage Log

## Verification

**Commands:**
- `pnpm typecheck`, `pnpm boundaries`, `pnpm test` (alone) — expected: pass.
- `pnpm db:migrate` then `pnpm test:integration` — expected: the new generation applied, all pass against PostgreSQL 18 on a `test`- or `ci`-named database.
- `pnpm db:generate` — expected: no drift.
- `pnpm build`, `pnpm --filter @intellifin/web build`, `pnpm test:e2e` — expected: pass, no accessibility violations.

## Auto Run Result

Status: done
Blocking condition: none

**Implemented.** `evaluateComplianceRecord` is wired in — no second rules engine. The
evaluator supplies the values, the addendum H evidence facts and the frozen Reference
Source data, and the reduction is the compiler's own. Generation 23 adds `run_exception`
with a derived id and an HMAC-SHA-256 fingerprint over five keys with the Run
deliberately absent, so a recurring finding fingerprints the same; two triggers make it
un-updatable and undeletable while its Observation stands.

**The seam is built by the stage, not injected** — a composition root has none of the
three things evaluation needs (frozen plan, frozen population, Reference Source bytes),
so there is no injection point where evaluation can be switched off. Same shape as 3.6.

**Both named traps are mutation-proven.** Forcing first-wins on the duplicate population
key failed P-3 D5; merging RoleMatrix entries by role failed P-2 D5-c. The tests can fail,
which is the only property that makes them worth having.

**Golden reconciliation runs through the production pipeline.** Every named per-record
case in both expectation files matches, asserted again in the browser suite against the
real worker, the real Northstar service and a real database.

**One correction to the main thread's earlier count, and it is right.** P-3 case D4
(TX-500007) has an empty `processed_time`, so the frozen inclusion rule marks it
INDETERMINATE: it never enters the population and never becomes an Observation, and its
Inconclusive comes from the `complete-inclusion` population Gate — exactly as addendum
§C requires for a missing transaction time. The 4/4/4 figure counted expectation entries
rather than records reaching evaluation. A test pins that this is the ONLY case reached
that way and asserts the row's disposition and reason, so the branch cannot quietly
swallow a record that genuinely went missing.

**Verification — independently re-run in the main thread against PostgreSQL 18.4:**
typecheck PASS; boundaries PASS (364 modules); `db:migrate` schemaVersion 23; unit
2408/2408; integration 288/288; `db:generate` no drift; both builds PASS; browser + axe
109/109 with zero accessibility violations.

**Residual risk.** `EXCEPTION_FINGERPRINT_KEY` is worker-only; absent, adapter execution
is disabled by name rather than writing an unfingerprinted Exception.
