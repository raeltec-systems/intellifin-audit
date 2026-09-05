---
title: 'Story 3.4: Register Observations in the one wire schema, in batches'
type: 'feature'
created: '2026-09-05'
status: 'draft'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/docs/contracts/executable-plan-v1.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Story 3.3 produces Observations and writes them, but each Work Item writes on its own terms. Nothing makes a batch one transaction, nothing carries the Observation digests into the event that records them, and nothing decides whether a `found = false` Observation is honest absence or a record nobody actually looked at. Until that seam exists the Gate and the evaluator cannot treat an adapter Run like any other Run.

**Approach:** Make Observation registration one transactional contract every producer goes through. A batch commits in a single transaction with a single Timeline event carrying every Observation's digest, the per-Observation checks and the deterministic evaluation run inside that same transaction, and a `found = false` Observation is valid only when it can prove it looked.

## Boundaries & Constraints

**Always:** Register a batch in exactly one transaction: the Observation rows, their per-Observation check outcomes, their evaluations, the audit event and the Timeline notification commit together or not at all. The registration event carries each Observation's digest over the RFC 8785 canonical JSON of the wire record through the shared `canonicalJson`, so a row changed before finalization is detectable. The digest covers the wire record only, never a mutable operational field such as an attempt counter, a lease or a revision. Enforce the whole addendum B.1 wire schema on every Observation whatever produced it, under its explicit `schemaVersion`. A `found = false` Observation is valid only with, for every declared search key, an Adapter-Action-derived query key equal to the record's normalized key value, a stored empty-result response artifact registered as Evidence, and a passing extraction-completeness check; failing any of the three makes the covered record `UNINSPECTED`, which can never be Compliant. Registration is idempotent under redelivery: re-registering the same batch produces no duplicate row, evaluation or event. Leave explicit seams where Story 3.6's corroboration and Story 3.7's evaluator plug in, and call them through those seams rather than inlining either.

**Block If:** The addendum B.1 wire schema and the shape Story 3.3 stored disagree in a way that cannot be reconciled without rewriting rows Story 3.3 already writes.

**Never:** Do not implement corroboration against a Structural Snapshot (3.6), the compiled condition rules (3.7), or the Run-level Gate rows (3.8). Do not treat a missing response artifact as an empty result. Do not let a batch partially commit. Do not import anything under `fixtures/northstar/expectations/` from runtime code.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Batch registration | A completed extraction batch | One transaction; one Timeline event carrying every Observation digest; checks and evaluations committed with the rows | Nothing partially visible |
| Digest detects a change | A stored row edited after registration | The recorded digest no longer matches and the mismatch is raised | Integrity failure |
| Honest absence | `found = false` with derived query key, stored empty-result artifact and complete extraction | Valid Observation; record covered and evaluable | None |
| Dishonest absence | `found = false` missing any of the three | Covered record is `UNINSPECTED`, never Compliant | Refused as a valid absence |
| Wire schema violation | A missing required field, or `found = true` with no grounded identity | Refused before the transaction commits | Batch fails, nothing written |
| Redelivered batch | The same batch delivered twice | Exactly one set of rows, evaluations and events | Idempotent |
| Offset capture time | `observedAt` carrying a source offset | Stored normalized to UTC with the original retained | Never silently shifted |
| Large batch | More Observations than one statement should carry | Batched inside the one transaction, order preserved | Still atomic |

</intent-contract>

## Code Map

- `packages/domain/src/runs/observation.ts` — the wire schema Story 3.3 landed: `OBSERVATION_SCHEMA_VERSION`, `ObservationRecord` with `schemaVersion`, `observationId`, `workItemId`, `populationRecordKey`, `targetSystem`, `found` (three-valued: `true | false | ambiguous`), `observedAt`, `stepExecutionId`, `captureMethod`, `matchOrigin`, `identity`, `attributes`, `evidenceIds`, plus `OBSERVATION_LIMITS`. Extend with the digest function and the `found = false` validity rule; do not reshape the record.
- `packages/domain/src/canonical-json.ts` — `canonicalJson`, the ONE RFC 8785 canonicalizer. The Observation digest uses it, as the audit chain and both existing digests do. It refuses a lone surrogate, a non-finite number and a NUL, which is what keeps a digest and a stored value from disagreeing.
- `packages/application/src/runs/execute-adapter-steps.ts` — `buildAdapterObservations` (line 193) produces the records today and `executeAdapterSteps` (line 298) writes them. The batch registration this story owns is what that write becomes.
- `packages/infrastructure/src/runs/adapter-execution-repository.ts` — `saveObservations` (line 244), `saveStepExecution`, `saveWorkItem`, `saveEvidence`, `notifyTimeline` (line 274), all bound to the one transaction `transaction()` opens. Registration commits through these, never through the pool.
- `packages/application/src/runs/execution-ports.ts` — `AdapterExecutionCheckpoint`, `SessionStepRecord`, `WorkItemRecord`, `StepExecutionRecord`, `AcquiredArtifact`, and the evidence and credential ports. Add the registration port and the two seams (corroboration, evaluation) here.
- `packages/infrastructure/drizzle/0019_curvy_lord_tyger.sql` and `packages/infrastructure/src/db/schema.ts` — `run_observation` with its CHECK constraints (`run_observation_schema`, `run_observation_found`, `run_observation_capture`, `run_observation_origin`, `run_observation_identity`, `run_observation_attributes`, `run_observation_evidence`). A generation 20 migration adds the digest column and the coverage state; raise `SUPPORTED_SCHEMA_MIN` and `MAX` together in `db/compat.ts` and list any new table in `tests/integration/schema-compat.test.ts`.
- `packages/application/src/runs/acquire-population.ts` — the audit-event and `notifyTimeline` pattern every stage follows; the registration event is appended the same way.
- `packages/domain/src/audit-event.ts` — how an existing digest is computed over canonical bytes, and which keys are deliberately excluded. The Observation digest follows the same discipline.
- `tests/integration/population.test.ts` — the database-name guard, `seed()` and `dependencies()` with an in-memory `EvidenceStore`. The new registration tests reuse them.

## Tasks & Acceptance

**Execution:**
- `packages/domain/src/runs/observation.ts` — add `observationDigest` over the canonical wire record (excluding operational fields), and `isHonestAbsence` / the `UNINSPECTED` coverage rule for `found = false`. Pure.
- `packages/application/src/runs/execution-ports.ts` — the registration port and the corroboration and evaluation seams, typed so a later story fills them without reshaping the call.
- `packages/application/src/runs/register-observations.ts` (new) — the one transactional registration: rows, per-Observation outcomes, evaluations, audit event with digests, Timeline notification. Idempotent under redelivery.
- `packages/application/src/runs/execute-adapter-steps.ts` — write Observations through the new registration rather than directly.
- `packages/infrastructure/` generation 20, schema, `db/compat.ts`, `tests/integration/schema-compat.test.ts` — the digest and coverage columns with CHECK constraints pinning the digest format and the coverage vocabulary.
- Tests — domain tests for the digest and the absence rule; application tests for atomicity, idempotency and the seams; `tests/integration/` coverage of every matrix row against real PostgreSQL, including a partial-failure case proving nothing is left visible.

**Acceptance Criteria:**
- Given a completed extraction batch, when it is registered, then the rows, per-Observation outcomes, evaluations, audit event and Timeline notification commit in one transaction and the event carries every Observation's digest.
- Given any Observation, when it is registered, then it satisfies the addendum B.1 wire schema under an explicit `schemaVersion`, and a `found = true` Observation with no grounded identity is refused.
- Given a `found = false` Observation lacking a derived query key, a stored empty-result artifact, or a passing extraction-completeness check, when it is registered, then the covered record is `UNINSPECTED` and is never counted Compliant.
- Given the same batch delivered twice, when it is registered again, then no duplicate row, evaluation or event exists.

## Spec Change Log

## Review Triage Log

## Design Notes

The digest is the point of this story, so it must cover the right bytes. It covers the wire record and nothing else: an attempt counter, a lease or a revision changes for operational reasons and would make an honest row look tampered with. Use the shared `canonicalJson` rather than a second serializer, for the reason CLAUDE.md already records — two canonicalizers agree on every value anybody thinks to try and diverge on the first one nobody does.

`found` is already three-valued in the stored shape, which is what lets `ambiguous` reach the Gate as itself rather than as a boolean plus a flag. Keep it that way.

Honest absence is the subtle rule. Three things together make `found = false` a finding rather than a gap: a query key the adapter actually derived, an empty response actually stored as Evidence, and an extraction that actually completed. Any one missing means nobody proved they looked, and the record is `UNINSPECTED`, which can never be Compliant.

## Verification

**Commands:**
- `pnpm typecheck` — expected: 0 errors.
- `pnpm boundaries` — expected: no violations.
- `pnpm test` — expected: all pass, run alone.
- `pnpm db:migrate` then `pnpm test:integration` — expected: the new generation applied and every test passing against real PostgreSQL 18, on a database whose name contains `test` or `ci`.
- `pnpm db:generate` — expected: no drift.
- `pnpm build`, `pnpm --filter @intellifin/web build`, `pnpm test:e2e` — expected: pass, no accessibility violations.
