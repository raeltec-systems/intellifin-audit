---
title: 'Story 3.6: Corroborate Observations against the stored Structural Snapshot'
type: 'feature'
created: '2026-09-05'
status: 'in-progress'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/docs/contracts/observation-registration-v1.md'
  - '{project-root}/docs/contracts/evidence-package-v1.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** An adapter asserts what it saw and nothing checks it. Without re-reading the stored snapshot, a wrong or invented attribute value is indistinguishable from a correct one, and an Observation stands on the adapter's word alone.

**Approach:** Re-read every declared attribute and the grounded identity from the stored Structural Snapshot with one deterministic domain extractor, and mark each attribute matched or contradictory. A contradiction, an ambiguous match or an identity that does not re-read to the population key can never be Compliant.

## Boundaries & Constraints

**Always:** The Structural Snapshot contract enumerates exactly four substrate kinds, `web_tree`, `desktop_tree`, `sheet` and `json`, each with its locator grammar and its label rule (accessible name, control name, header cell, property key path). One domain extractor implements `sheet` and `json` here; `web_tree` and `desktop_tree` are explicit unimplemented cases, not silent fallthroughs. An attribute is `matched` when the re-read value equals `originalValue` AND the re-read label matches the label the Procedure Version declares; anything else is `contradictory`. For a `found = true` Observation the re-read grounded identity must equal the normalized population record key. Matching uses exact normalized keys: identifiers are strings that keep leading zeros, so `007` never matches `7`; date-times normalize to UTC with the source offset preserved; originals and the transformation history are retained. Unmatched and multiply matched records stay visible and are never Compliant. A `contradictory` attribute makes the record `UNEVALUATED` and fails the Run-level check `INCONCLUSIVE`; a `found = ambiguous` Observation makes its Work Item `AMBIGUOUS`, the record `UNEVALUATED` and the Run `INCONCLUSIVE`.

**Block If:** A declared attribute's locator grammar is ambiguous enough that two defensible extractors would disagree on the same snapshot.

**Never:** Do not implement `web_tree` or `desktop_tree` extraction. Do not perform any I/O in the extractor: it consumes stored bytes only. Do not repair a contradiction by preferring one side.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Sheet attribute matches | Re-read value and label equal the declared ones | `matched` | None |
| Json attribute contradicts | Re-read value differs | `contradictory`; record `UNEVALUATED`; Run `INCONCLUSIVE` | Never repaired |
| Label drift | Value equal, declared label differs | `contradictory` | Same as above |
| Identity corroboration | `found = true` | Re-read identity equals the normalized record key | Mismatch is not Compliant |
| Leading zeros | Population key `007`, extracted `7` | Not a match | Never coerced |
| Offset time | Source time with an offset | Normalized to UTC, original retained | Never silently shifted |
| Ambiguous | `found = ambiguous` | Work Item `AMBIGUOUS`, record `UNEVALUATED`, Run `INCONCLUSIVE` | None |
| Unimplemented substrate | `web_tree` or `desktop_tree` snapshot | Explicit unimplemented case | Never a silent pass |

</intent-contract>

## Code Map

- `packages/application/src/runs/register-observations.ts` — the registration transaction Story 3.4 built, and the `NO_CORROBORATION` seam it left. This story fills that seam; it does not add a second call site.
- `packages/domain/src/runs/observation.ts` — `ObservationAttribute` already carries `originalValue`, `normalizedValue`, `grounding {evidenceId, locator, label, extractedText}` and a `corroboration` slot that is `null` today. The extractor writes that slot; do not reshape the record.
- `packages/domain/src/runs/evidence.ts` and `docs/contracts/evidence-package-v1.md` — how a stored artifact is addressed and verified. The extractor consumes stored bytes through the Evidence the Observation already names, and performs no I/O of its own.
- `packages/application/src/runs/execute-adapter-steps.ts` — `normalizeObservationValue` and the `$.collection[i].field` locator shape the adapter writes today. The extractor must re-read exactly that grammar.
- `packages/domain/src/runs/population.ts` — the closed collection envelope, exported by Story 3.4, and the row shapes a `json` snapshot presents.
- `packages/infrastructure/drizzle/0020_*.sql`, `0021_*.sql` and `packages/infrastructure/src/db/schema.ts` — `run_observation`, `run_observation_check`, `run_observation_evaluation` and their coverage constraints. A generation 22 migration stores the corroboration verdict per attribute; raise `SUPPORTED_SCHEMA_MIN`/`MAX` together and list any new table in `tests/integration/schema-compat.test.ts`.
- `fixtures/northstar/generated/role-matrix.csv` — a `sheet` substrate whose header row is the label rule, and whose `entry` ordinal Story 3.3 added so a doubly-declared role stays ambiguous.
- `tests/integration/adapter-execution.test.ts`, `tests/integration/population.test.ts` — the harnesses, the database-name guard and the in-memory `EvidenceStore`.

## Tasks & Acceptance

**Execution:**
- `packages/domain/src/runs/structural-snapshot.ts` (new) — the four substrate kinds with their locator grammar and label rule, and the ONE extractor implementing `sheet` and `json`. `web_tree` and `desktop_tree` are explicit unimplemented cases. Pure: bytes in, verdict out, no I/O.
- `packages/domain/src/runs/observation.ts` — the corroboration verdict type and the rule that a `contradictory` attribute makes the record `UNEVALUATED`.
- `packages/application/src/runs/register-observations.ts` — fill the corroboration seam; keep the transaction and the digest unchanged.
- `packages/infrastructure/` generation 22, schema, `db/compat.ts`, `tests/integration/schema-compat.test.ts` — persist the per-attribute verdict with CHECKs pinning its vocabulary.
- Tests — domain tests for both substrates including the leading-zero and offset cases; a golden vector for the extractor produced independently, not from the extractor; integration coverage of every matrix row.

**Acceptance Criteria:**
- Given a `sheet` or `json` snapshot, when the extractor re-reads an attribute's locator, then it is `matched` only when both the value equals `originalValue` and the re-read label matches the declared label, and `contradictory` otherwise.
- Given a `found = true` Observation, when identity corroboration runs, then the re-read grounded identity must equal the normalized population record key.
- Given population key `007` and an extracted `7`, when they are compared, then they never match.
- Given a `contradictory` attribute or a `found = ambiguous` Observation, when the record is judged, then it is `UNEVALUATED` and can never be Compliant.

## Spec Change Log

## Review Triage Log

## Verification

**Commands:**
- `pnpm typecheck`, `pnpm boundaries`, `pnpm test` (alone) — expected: pass.
- `pnpm db:migrate` then `pnpm test:integration` — expected: the new generation applied, all pass against PostgreSQL 18 on a `test`- or `ci`-named database.
- `pnpm db:generate` — expected: no drift.
- `pnpm build`, `pnpm --filter @intellifin/web build`, `pnpm test:e2e` — expected: pass, no accessibility violations.
