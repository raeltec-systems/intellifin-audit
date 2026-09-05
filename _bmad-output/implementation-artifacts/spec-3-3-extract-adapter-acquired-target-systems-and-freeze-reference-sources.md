---
title: 'Story 3.3: Extract adapter-acquired Target Systems and freeze Reference Sources'
type: 'feature'
created: '2026-09-05'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/docs/contracts/executable-plan-v1.md'
  - '{project-root}/docs/contracts/population-acquisition-v1.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** A Run acquires its Population Source and then stops. Nothing executes the frozen plan's per-target steps, so no Reference Source is acquired, no adapter reads a Target System, no Work Item exists, and no Observation is ever produced. P-2 and P-3 cannot reach a conclusion.

**Approach:** Add the execution stage after population acquisition. Interpret the already-frozen plan: acquire every Reference Source as a Session Step before any Work Item, then run one adapter Work Item per adapter-acquired Target System, each with its own state, Step Executions, Evidence and Timeline segment, executed sequentially and resumably. Retrieve the read-only API token just in time through a new credential seam that no other layer can reach.

## Boundaries & Constraints

**Always:** Read the stored frozen plan and its `inputs.targets` snapshots; never re-derive steps or consult a current registration. Classify a target by its FROZEN contract kind: `read-only-api` is an adapter-acquired Target System and gets exactly one Work Item; `versioned-file` and `manual-upload` are Reference Sources, acquired as Session Steps before any Work Item, and get no Work Item. Preserve the frozen step ids in Step Execution provenance. Register, digest and freeze each acquired Reference Source artifact into Evidence with the reserve-then-upload-then-verify sequence Story 3.2 established, over the exact served bytes. Every state change, Evidence row, Observation, audit event and Timeline notification for one unit commits in one transaction, guarded by the checkpoint revision and the Work Item lease, exactly as `acquirePopulation` guards its own. Work Items execute sequentially and a failed Work Item never stops the Run. Resolve credentials through a resolver port that returns an opaque token, used only for the outbound request; the value never reaches an audit payload, Timeline event, log field, Evidence artifact, checkpoint, queue job, error message or the web process. Honour the frozen `stepTimeoutSeconds`, `runTimeoutSeconds` and `retriesPerStep`.

**Block If:** The frozen plan would have to change shape or gain an action kind to express Reference Source acquisition. It does not: the classification above reads bytes that are already there.

**Never:** Do not add or rename an action kind, change `semantics()`, or otherwise move the canonical plan bytes. Do not corroborate against a Structural Snapshot (Story 3.6), evaluate conditions or raise Exceptions (3.7), run the Run-level Gate (3.8), seal a Result (3.9), or build the Runs tabs (3.11). Do not batch Observation registration, carry Observation digests in the registration event, run per-Observation Gate checks, or implement the `found = false` completeness rules — Story 3.4 owns those, and this story must leave its shape additive. Do not import anything under `fixtures/northstar/expectations/` from runtime code (AD-12). Do not put the extraction adapter or the credential resolver in the infrastructure barrel.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| P-2 reference then extraction | Ready population, RoleMatrix (`versioned-file`) and AccessGate (`read-only-api`) targets | RoleMatrix acquired as a Session Step first and frozen into Evidence; then one AccessGate Work Item covering the whole population, one Observation per active account with a grounded role list | Atomic per unit |
| P-3 extraction | Ready population, ApproveNow target | One Work Item per extraction; every included transaction gets a grounded approval Observation with `found` in `{true,false,ambiguous}` | Atomic per unit |
| Just-in-time credential | Target with an opaque `credentialRef` | Resolver supplies the token at the moment of the request; retrieval is audited by reference only | Missing or unresolvable reference fails the Work Item, never the token value in the message |
| Secret containment | Any completed Run | No audit payload, Timeline event, log field, Evidence artifact, checkpoint or error contains the token | Asserted directly against stored rows and objects |
| Work Item failure | One target unreachable after its bounded retries | That Work Item is FAILED with a diagnostic; remaining Work Items still run; the Run stays RUNNING | Run is not failed by one item |
| Resume | Worker killed mid-extraction, job redelivered | The completed units are not repeated, the interrupted unit resumes under a fresh lease, and Evidence identity is stable | No duplicate Evidence, no duplicate Observation |
| Reference source tampered | Stored artifact bytes no longer match the registered digest | Terminal integrity failure; the stored bytes are never replaced | Run Failed |

</intent-contract>

## Code Map

- `packages/application/src/runs/acquire-population.ts` — the stage template. Copy its claim / lease / revision-recheck / `save`+`event`+`notifyTimeline` discipline verbatim in shape. `event()` (line 28), the claim transaction (line 68), `remaining()` (line 191), reserve→upload→verify (lines 196-258).
- `packages/application/src/runs/execution-ports.ts` — `EvidenceStore`, `PopulationAcquisitionError`, `PopulationCheckpoint`, `PopulationExecutionContext`, `PopulationExecutionRepository`. Extend with the new stage's ports; keep the two-method `EvidenceStore` as is.
- `packages/domain/src/procedures/executable-plan.ts:49` — the closed action enum and plan shape. `sessionSteps` already carries one `extract-adapter` step per api/file target, in authored order; `targetSystems[].planSteps` is always `inspect-record`, `capture-observation`, `evaluate-conditions`. `inputs.targets[].contract.kind` is the classification input. Read only.
- `docs/contracts/executable-plan-v1.md:39-51` — per-target actions and the P-2/P-3 lookup policy. Add a section clarifying interpreter semantics for reference-vs-adapter classification, the way Story 3.2 clarified Run-period binding. Canonical bytes must not move.
- `packages/infrastructure/src/runs/population-repository.ts` — `transaction()` row lock, checkpoint load, `save()` upsert and 500-row batching, `recoverableRunIds`, `notifyTimeline` via `pg_notify('run_timeline', …)`. The new repository mirrors this.
- `packages/infrastructure/src/db/schema.ts:764-815` and `drizzle/0018_jittery_scream.sql` — `audit_run`, `population_execution`, `population_evidence` (`RESERVED|REGISTERED|ABANDONED`), `population_snapshot`, `population_row`. Generation 19 adds the new tables beside them.
- `packages/infrastructure/src/db/compat.ts:40-41` — raise `SUPPORTED_SCHEMA_MIN` and `SUPPORTED_SCHEMA_MAX` to 19 together. `tests/integration/schema-compat.test.ts:70-97` asserts the exact table set and must list every new table.
- `packages/application/src/registrations/ports.ts:61` — `CredentialProvider.describe` returns capability only. The new `CredentialResolver` is a separate port; do not widen this one.
- `packages/infrastructure/src/runs/population-acquisition-http.ts` — bounded GET, `withDeadline` (aborts on dispose), `isRefusedSourceHost`, `sourceUrl` guards, 16 MiB cap. Reuse these guards for both reference acquisition and adapter extraction.
- `packages/infrastructure/src/index.ts:18` — records why `./acquisition` and `./evidence` are outside the barrel. `.dependency-cruiser.cjs` holds `no-population-acquisition-in-web` / `no-evidence-store-in-web`; `tests/unit/boundaries.test.ts` plants both spellings. The new modules follow the same pattern.
- `apps/worker/src/main.ts:96-109` and `apps/worker/src/startup.ts` `populationExecution(config)` — where the new stage is composed and where a missing configuration must disable a stage rather than stop the worker.
- `apps/northstar/src/apis.ts:87-119` — `/accessgate/accounts` (rows carry `roles[]`, 13 accounts, 12 Active) and `/approvenow/approvals` (10 rows). `apps/northstar/src/files.ts` serves `/files/role-matrix.csv` and its cover sheet; `fixtures/northstar/datasets/rolematrix.json` keeps separate policy entries that the CSV flattens — the acquired artifact must retain enough structure to reproduce the `AMBIGUOUS_DUAL` ambiguity.
- `tests/integration/population.test.ts:60-69,103,205` — database-name guard, `seed()`, `dependencies()` with an in-memory `EvidenceStore` exposing `objects`. `tests/fixtures/active-run-version.ts` — `activeRunVersion(...)`. `tests/e2e/population.spec.ts` — synthetic S3, real worker, `READ_ONLY_CREDENTIAL`, `assertThrowawayDatabase`.
- `fixtures/northstar/expectations/p-2-sod-conflicts.json`, `p-3-high-value-approvals.json` — expected per-record outcomes. Data for assertions in tests only; never imported by runtime code.

## Tasks & Acceptance

**Execution:**
- `packages/domain/src/runs/execution.ts` (new) — Session Step, Work Item and Step Execution states with their whole vocabulary and a permitted-transition table beside them; the frozen-kind classification (`referenceTargets`, `adapterTargets`) and the sequential ordering rule. Pure, no I/O.
- `packages/domain/src/runs/observation.ts` (new) — the versioned Observation wire schema from addendum B.1 and its validator: `schemaVersion`, `workItemId`, `populationRecordKey`, `targetSystem`, `found`, `observedAt`, `stepExecutionId`, `captureMethod`, `identity`, `matchOrigin`, declared `attributes[{name, originalValue, normalizedValue, grounding, corroboration}]`. Story 3.4 adds batching and the checks; the shape lands once, here.
- `packages/application/src/runs/execution-ports.ts` — add `CredentialResolver` (opaque token by reference), `AdapterExtractionPort`, `ReferenceAcquisitionPort`, the step/work-item checkpoint types and repository context. Keep secrets out of every returned shape by giving the token type no place in a checkpoint or event.
- `packages/application/src/runs/execute-adapter-steps.ts` (new) — the stage: claim, acquire reference sources in order, then run each adapter Work Item, persisting Observations, Evidence and Timeline per unit; bounded by the frozen limits; resumable and idempotent.
- `packages/infrastructure/src/runs/adapter-extraction-http.ts` (new, outside the barrel, `./extraction` subpath) — the extraction adapter, reusing the acquisition guards and sending the resolved token only on the wire.
- `packages/infrastructure/src/runs/credential-resolver.ts` (new, outside the barrel, `./credentials` subpath) — manifest resolver over a new worker-only configuration value; refuses an ambiguous manifest the way `CREDENTIAL_CAPABILITIES` does.
- `.dependency-cruiser.cjs`, `tests/unit/boundaries.test.ts`, `vitest.config.ts`, `tests/integration/vitest.config.ts` — rules and planted violations keeping both new modules out of `apps/web`, plus the two aliases each new subpath needs.
- `packages/infrastructure/drizzle/` generation 19, `db/schema.ts`, `db/compat.ts`, `tests/integration/schema-compat.test.ts` — new tables with CHECK constraints that pin every enum, digest format and jsonb shape; `cardinality`, never `array_length`.
- `packages/infrastructure/src/runs/adapter-execution-repository.ts` (new) — persistence for the stage, mirroring `PostgresPopulationRepository`.
- `apps/worker/src/main.ts`, `apps/worker/src/startup.ts` — compose the stage; a missing credential manifest disables extraction with a named log line and leaves every other duty running.
- `docs/contracts/adapter-extraction-v1.md` (new) and `docs/contracts/executable-plan-v1.md` — the extraction and reference contract, and the interpreter clarification.
- `apps/web/app/runs/[id]/page.tsx` — show Session Steps and Work Items with their states and diagnostics. Tabs remain Story 3.11.
- Tests — domain unit tests for the state machine, classification and Observation schema; application tests for the stage including resume, failure isolation and secret containment; `tests/integration/adapter-execution.test.ts` against real PostgreSQL covering every matrix row; a browser journey extending `tests/e2e/population.spec.ts` through the real worker.

**Acceptance Criteria:**
- Given a P-2 Run whose population is ready, when the worker runs, then RoleMatrix is acquired as a Session Step before any Work Item and its artifact is registered, digested and frozen into Evidence, and exactly one AccessGate Work Item then produces one Observation per active account carrying a grounded role list.
- Given a P-3 Run, when the worker runs, then each extraction is its own Work Item and every included transaction has a grounded approval Observation whose `found` is one of `true`, `false` or `ambiguous`.
- Given any completed Run, when its audit events, Timeline rows, checkpoints, Evidence objects and logs are inspected, then the read-only API token appears in none of them, while the retrieval is recorded by reference.
- Given one target that cannot be reached, when its bounded retries are exhausted, then that Work Item is FAILED with a diagnostic and the other Work Items still execute.
- Given the worker is killed mid-extraction and the job is redelivered, when it resumes, then completed units are not repeated, Evidence identity is stable, and no duplicate Observation exists.

## Spec Change Log

## Review Triage Log

## Design Notes

The classification is the whole trick, and it needs no contract change. `makePlan` already emits one `extract-adapter` session step per api/file target in authored order, and `inputs.targets[].contract.kind` is frozen alongside it. A `versioned-file` target is consulted by the evaluator and owns no Work Items (addendum: RoleMatrix, "no Work Items"), so its step is Reference Source acquisition; a `read-only-api` target is adapter-acquired and owns exactly one Work Item. Both readings come from bytes that are already frozen, so canonical bytes do not move and every ACTIVE version stays executable. Record this in `executable-plan-v1.md` as interpreter semantics, not as a new action.

The credential seam is new and must stay narrow. `CredentialProvider.describe` proves a reference read-only at registration time and has exactly two fields for that reason; a resolver that returns a token is a different port with a different adapter, reachable only from the worker. Give the token no home in any durable shape: if it cannot be put in a checkpoint or an event, it cannot leak into one.

P-2's extraction reads the same AccessGate API the population came from, because that payload carries the role list; that is the extraction, not a second population read. RoleMatrix must keep its separate policy entries so `AMBIGUOUS_DUAL` stays ambiguous — acquire the JSON structure, not the flattened CSV, if both are available.

## Verification

**Commands:**
- `pnpm typecheck` — expected: 0 errors.
- `pnpm boundaries` — expected: no violations, and the new rules fire on planted imports.
- `pnpm test` — expected: all pass, including the new domain and application tests.
- `pnpm db:migrate` then `pnpm test:integration` — expected: `schemaVersion: 19` and every test passing against real PostgreSQL 18. The database name must contain `test` or `ci`.
- `pnpm db:generate` — expected: no drift.
- `pnpm build` and `pnpm --filter @intellifin/web build` — expected: pass.
- `pnpm test:e2e` — expected: all pass, no accessibility violations.

## Auto Run Result

Status: done
Blocking condition: none

**Implemented.** The execution stage after population acquisition: Reference Sources
acquired as Session Steps before any Work Item and frozen into Evidence, one adapter Work
Item per `api` Target System, Step Executions, Observations in the §B.1 wire schema, and
just-in-time credential resolution. Generation 19 adds six tables.

**Two deliberate deviations from the spec's letter, both correct:**
- The spec named the Population Source binding vocabulary. A Target System's frozen kind
  is `web | desktop | api | versioned-file`; `manual-upload` is not one. Implemented as
  `api` -> one Work Item, `versioned-file` -> Reference Source, `web`/`desktop` -> the
  stage refuses the plan rather than skipping a Target nobody observed.
- "Audited by reference" could not mean putting the reference in the payload:
  `FORBIDDEN_PAYLOAD_KEYS` refuses `credentialref` and would throw. The event names the
  Target System; the frozen `credentialReferences` entry is already in the plan.

**One addition:** a single bounded hop through a system's read-only service index, so a
registration written for the Story 1.8 probe is executable without guessing a path.
Closed shape, same frozen origin, path-boundary matched, second index refused.

**Verification — independently re-run in the main thread against PostgreSQL 18.4:**
typecheck PASS; boundaries PASS (348 modules); `db:migrate` schemaVersion 19; unit
2184/2184; integration 262/262; `db:generate` no drift; package and web builds PASS;
browser + axe 109/109 with zero accessibility violations. The browser gate was re-run here
against a worker rebuilt after the implementation's three late refinements, which its own
full run predated.

**Residual risks.** `systems.json`'s rolematrix-file `attribute_label_patterns` does not
mention the new `entry` column; adding it would move a seeded registration digest, so it
is deliberately out of scope. The Evidence tamper check fires on re-claim, not
continuously; later stages must verify Evidence when they consume it.
