---
title: 'Story 3.5: Seal Evidence with reservation and digest verification'
type: 'feature'
created: '2026-09-05'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/docs/contracts/observation-registration-v1.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Story 3.2 reserves, uploads and verifies the population artifacts, but each producer does it by hand and nothing seals the package. There is no rule that a Run cannot end with a required artifact missing, no record of an abandoned reservation, and no distinction between a mismatch found during a Run and one found afterwards.

**Approach:** Make reservation, verification and sealing one owned mechanism every producer goes through. Every artifact is reserved under an idempotency key and a unique provisional object key before upload; the store verifies availability, size and digest before one transaction marks it Registered; and every terminal transition seals the package, refusing to seal while a required artifact is unregistered and marking open reservations abandoned.

## Boundaries & Constraints

**Always:** Reserve before upload, with an idempotency key that makes a retried production reuse the same reservation rather than minting a second object. Verify availability, size and SHA-256 against the recorded values before the single transaction that marks an artifact Registered. Run `SealPackage` on EVERY terminal transition, whatever the outcome: it seals only when every artifact marked `required` is Registered and verified, marks every still-open reservation `abandoned`, and lists those abandonments on the Result and the export. Preserve Evidence already registered forever: a later Source change, a retired registration or an expired provider retention never removes it, and every evaluated record and Exception keeps tracing to its Observations, Evidence, Steps and version. A digest mismatch detected DURING the Run ends it `RUN_FAILED`; the same mismatch detected AFTER the Run is an Audit Trail integrity event flagged on the Result and exports, changes no state, and is corrected only by a new Run.

**Block If:** Sealing would have to delete or rewrite an artifact to succeed.

**Never:** Do not replace, repair or re-upload bytes that fail verification. Do not seal a package with a required artifact missing. Do not let an integrity event discovered after the Run mutate the sealed outcome.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Normal artifact | An adapter extract is produced | Reserved with an idempotency key and unique object key, uploaded, verified for availability, size and digest, then Registered in one transaction | Atomic |
| Retried production | The same artifact produced twice after a crash | The same reservation and object key are reused; exactly one Registered artifact exists | No second object |
| Terminal with everything present | Run reaches any terminal state, all required artifacts Registered | Package sealed; no open reservations remain | None |
| Terminal with a required artifact missing | A required artifact never registered | Package is not sealed as complete; the gap is named on the Result | Honest incompleteness |
| Open reservation at the end | An upload never completed | Reservation marked `abandoned` and listed on the Result and export | Never silently dropped |
| Mismatch during the Run | Stored bytes disagree with the recorded digest while running | `RUN_FAILED`; bytes untouched | Terminal |
| Mismatch after the Run | The same disagreement found later | Audit Trail integrity event flagged on the Result and exports; no state change | New Run required to correct |

</intent-contract>

## Code Map

- `packages/application/src/runs/execution-ports.ts` — `EvidenceStore` (`read`, `putIfAbsent`), `AdapterEvidenceRecord` with its `RESERVED | REGISTERED | ABANDONED` state, and the execution context. The sealing port and the reservation key belong here.
- `packages/application/src/runs/acquire-population.ts` (lines 196-258) and `packages/application/src/runs/execute-adapter-steps.ts` — the two producers that reserve, upload and verify by hand today. Both must go through the owned mechanism this story adds rather than repeating the sequence.
- `packages/infrastructure/src/evidence/s3-evidence-store.ts` — `putIfAbsent` sends `IfNoneMatch: '*'` and reads back to compare. Note the recorded risk: a backend that ignores the header overwrites and the read-back still passes, so immutability currently rests on the backend honouring it.
- `packages/infrastructure/src/runs/adapter-execution-repository.ts` — `saveEvidence`, and the guarded transaction every write goes through.
- `packages/infrastructure/drizzle/0018_jittery_scream.sql`, `0019_curvy_lord_tyger.sql`, `0020_*.sql` — `population_evidence` and `run_evidence` with their state CHECKs. A generation 21 migration adds the package seal and the `required` flag; raise `SUPPORTED_SCHEMA_MIN`/`MAX` together and list any new table in `tests/integration/schema-compat.test.ts`.
- `packages/domain/src/audit-event.ts` — `FORBIDDEN_PAYLOAD_KEYS`, which refuses credential-shaped keys outright. An integrity event names artifacts, never their bytes or a credential.
- `docs/contracts/population-acquisition-v1.md` and `observation-registration-v1.md` — the existing digest and verification language this story generalises.
- `tests/integration/population.test.ts`, `tests/integration/adapter-execution.test.ts` — the database-name guard, `seed()`, and the in-memory `EvidenceStore` exposing `objects` for tamper cases.

## Tasks & Acceptance

**Execution:**
- `packages/domain/src/runs/evidence.ts` (new) — the artifact kinds, the `required` rule per Template, the seal state and the pure "is this package sealable" decision.
- `packages/application/src/runs/seal-package.ts` (new) — `SealPackage` on every terminal transition: seal only when every required artifact is Registered and verified, mark open reservations `abandoned`, and record both on the Result.
- `packages/application/src/runs/execution-ports.ts` — the reservation and sealing ports; one idempotency key type used by both producers.
- `packages/application/src/runs/acquire-population.ts`, `execute-adapter-steps.ts` — reserve and register through the owned mechanism.
- `packages/infrastructure/` generation 21, schema, `db/compat.ts`, `tests/integration/schema-compat.test.ts` — seal state, `required`, and CHECKs pinning both.
- Tests — domain tests for the sealable decision; application tests for retried production reusing one reservation, for sealing with a required artifact missing, and for both mismatch timings; integration coverage of every matrix row against real PostgreSQL.

**Acceptance Criteria:**
- Given an artifact produced twice after a crash, when it is reserved again, then the same reservation and object key are reused and exactly one Registered artifact exists.
- Given any terminal transition, when it commits, then the package seals only if every required artifact is Registered and verified, and every open reservation is marked abandoned and listed on the Result.
- Given a digest mismatch during the Run, when it is detected, then the Run ends RUN_FAILED and the stored bytes are untouched.
- Given the same mismatch detected after the Run, when it is found, then it is an Audit Trail integrity event on the Result and exports, with no state change.

## Spec Change Log

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

**Implemented.** Reservation, verification and sealing are one owned mechanism both
producers go through. An Evidence id is derived rather than minted, so a retried
production reuses one reservation. `SealPackage` runs on every terminal transition.

**The seal rules are enforced by database constraint triggers, the first in this
repository, because they span rows:** a Run may not reach a terminal state without a
package row (deferred, so a branch that forgets to seal fails to commit); a SEALED package
may not exist while a required artifact is unregistered; a sealed package freezes its
Run's Evidence and can never be updated.

**`required` is a flag on a RESERVATION, not a checklist of kinds a Template could have.**
A Run that never reserved a Reference Source is not incomplete for an artifact nobody
asked for; a Run that reserved one and never registered it is. This is what lets P-3,
which has no Reference Source, seal a complete package while P-2 cannot seal without the
RoleMatrix it actually consulted.

**Three defects found in existing work:** the acquisition envelope was verified against
the copy still in memory rather than read back from the store, which proved nothing about
what was stored; artifact abandonment happened in two places, so the seal found nothing
open and the Result listed no abandonment — the exact defect this story exists to prevent;
and `putIfAbsent` now reads before writing, so immutability no longer rests solely on the
backend honouring `IfNoneMatch`. The residual two-writer race is documented rather than
claimed away.

**Verification — independently re-run in the main thread against PostgreSQL 18.4:**
typecheck PASS; boundaries PASS (356 modules); `db:migrate` schemaVersion 21; unit
2305/2305; integration 281/281 including the three database refusals; `db:generate` no
drift; both builds PASS; browser + axe 109/109 with zero accessibility violations.

**Residual risks.** Nothing calls `verifySealedPackage` on a schedule; a sweep cadence is
an operational decision this story was not given. There is no export surface yet, so the
abandonment lists are carried on the seal row and rendered on the Run page; Story 3.9/3.11
owns the export. No production path writes COMPLETED yet, so the sealed-and-complete case
is exercised through the real repository and real triggers rather than a shipped path;
Story 3.9 adds it. `adapter-extraction` is deliberately not required: a failed Work Item
is already INCONCLUSIVE at the Gate, and requiring it would mean no INCONCLUSIVE Run could
ever hold a complete package.
