---
title: 'Story 3.2: Acquire the Population Source deterministically'
type: feature
created: '2026-09-05'
status: done
baseline_revision: 7171603e7a82669c65a6866e98a78831bd782f6e
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/CLAUDE.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
warnings: [oversized]
deferred: []
---

<intent-contract>

## Intent

**Problem:** Initiated Runs have durable jobs but no consumer. Auditors need a preserved, independently reconciled population before evaluation can start.

**Approach:** Execute the frozen population-acquisition Session Step in the worker, preserve the original snapshot as Evidence, deterministically parse and apply inclusion, and persist resumable progress and visible diagnostics. Compare independent declarations with actual acquisition; never infer success from a download alone.

## Boundaries & Constraints

**Always:** Consume the stored validated plan and frozen source contract, checking its own digest; later mutable binding changes cannot substitute another source. Bind the separately persisted Run period without rewriting the frozen plan. Preserve duplicate rows, exact strings, source order and original bytes. Reconcile declared count/digest before inclusion counts. Each exclusion has a reason; invalid values remain explicit indeterminate records and prevent a Pass. Use decimal-string arithmetic and UTC-inclusive dates. State, checkpoint and Timeline commit together; external HTTP/object I/O runs outside database transactions. Reserve Evidence before upload, use stable keys and conditional writes, verify stored size/digest before registration. Enforce frozen retry/time/step bounds across restart. Runtime startup never migrates. Secrets and source bodies never enter logs or queue errors.

**Block If:** A product-contract conflict cannot be resolved from normative contracts. Missing production credentials must be reported as deployment setup, not replaced with a test store or guessed secret.

**Never:** Read expectations to produce results; call a model or recompile a frozen plan; overwrite existing Evidence; store binary Evidence in PostgreSQL or production ephemeral disk; count indeterminate records as ordinary exclusions; convert currencies. Do not implement Target extraction, Observation evaluation, complete Result sealing or the full dashboard in this story. Do not merge, deploy, or alter production resources.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| File acquisition | Valid frozen versioned CSV and independent cover sheet | Preserved snapshot Evidence, exact rows, included/excluded reasons, completed population Session Step and POPULATION_READY checkpoint | Run remains RUNNING for later stages |
| API acquisition | Complete supported JSON response and independent count/digest declaration | Same population contract and raw Evidence as file path; declared generation/schema/period checked | No self-declared expected count |
| Boundary | USD decimal 100000.00, 99999.99, non-USD and timezone offset dates | Exact threshold included; lower/non-USD excluded with reason; UTC period applied | No float rounding or exchange conversion |
| Malformed inclusion value | Missing or invalid required date/decimal/text | Row retained as indeterminate with diagnostic; no zero-record Pass | Reconciliation fails safely |
| Reconciliation | Truncated rows, wrong digest, wrong schema, period mismatch, incomplete pagination | Evidence retained with separate failed checks; INCONCLUSIVE | Never advance population-ready or pretend completion |
| Empty | Known complete zero included rows | INCONCLUSIVE unless frozen zeroRecordPass; opted-in case may advance to later Gates | Opt-in never overrides another failed check |
| Retry exhaustion | HTTP failure/timeout through initial attempt plus frozen three retries | Persist attempts; RUN_FAILED after exhaustion | No human escalation for Session Step |
| Restart/duplicate | Crash after reservation/upload or repeated concurrent job | Reconcile same reservation/object and checkpoint; no duplicate rows/effects; only current claim commits | Bounded lease and stale-claim rejection |
| Tamper | Stored Evidence differs from registered digest during resume | RUN_FAILED with sanitized integrity diagnostic | Never replace damaged bytes |
| Frozen identity | Binding changed after approval; Run period differs from draft period | Stored approved source and Run period used, plan bytes unchanged | Unsupported plan/adapter refuses safely |

</intent-contract>

## Code Map

- `packages/domain/src/procedures/executable-plan.ts`: frozen shape, validation and limits (3 retries, 120s Step, 3600s Run, 10000 executions); consume validated stored plan, never build another. `docs/contracts/executable-plan-v1.md`: clarify Run-period binding in interpreter semantics while preserving stored inputs.
- `packages/domain/src/procedures/population-draft.ts`: strict inclusion predicates and Gregorian dates. `compliance-draft.ts` exports `compareComplianceDecimals`; reuse exact decimal comparison. `sources/population-source.ts`: existing immutable five-key v1 source envelope.
- `packages/application/src/runs/ports.ts`, `initiate-run.ts`: existing dispatch contract. Add execution/checkpoint/acquisition/Evidence ports under inward-owned modules, keeping source-specific I/O in infrastructure.
- `packages/infrastructure/src/runs/run-repository.ts`, `runs-unit-of-work.ts`: existing Run persistence and `runs` queue. Add per-Run locking and revisioned claims; avoid holding the global configuration lock during execution. Existing dispatch expiry 180s needs alignment with bounded execution/recovery.
- `packages/infrastructure/src/procedures/procedure-repository.ts`: frozen version validation; expose a Procedures-owned frozen execution reader rather than using current period-owner lookup (the version may have retired after initiation).
- `packages/infrastructure/src/procedures/derivation-queue.ts`: transaction queue bridge, sanitized worker errors and recovery patterns. `apps/worker/src/main.ts`: compose actual consumer/recovery and await clean shutdown.
- `packages/infrastructure/src/db/schema.ts`, `db/compat.ts`, migrations: current generation 17. Add durable Session Step, checkpoint, population snapshot/rows and initial Evidence reservation/item metadata. Generated migrations, journal, compatibility and exact inventory tests advance together.
- `apps/northstar/src/apis.ts`, `files.ts`, `fixtures.ts`: source response shapes and allowlisted artifact serving. API count responses currently lack digest/schema/period. `fixtures/northstar/generate.py`: independent Python producer; file covers SHA-256 of exact served bytes, CSV marker then header, UTF-8/RFC4180. Extend independent API declarations and tests, never runtime expectation imports.
- `fixtures/northstar/generated/*`, `datasets/*`: golden raw data. API collection keys accounts/transactions/employees/approvals, stable source ordering; AccessGate count covers status=Active, not the unfiltered store. Preserve fixture marker and intentional failure cases.
- `packages/infrastructure/src/config.ts`, package.json, pnpm-lock.yaml`: S3 composition. Architecture pins `@aws-sdk/client-s3` 3.1124.0. AWS conditional PutObject with IfNoneMatch `*` prevents overwrite; on existing object, read and verify. Official source: https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html .
- `apps/web/app/runs/[id]/page.tsx`: authorized persisted details. Add small population summary/diagnostics and paginated exclusions so an Auditor can see this story's result. Full tabs and Result remain Story 3.11.
- `tests/integration/runs.test.ts`, `tests/fixtures/active-run-version.ts`, `tests/e2e/runs.spec.ts`: real frozen fixtures and initiation flow; add a separate worker population integration suite with strict local database guard and scoped cleanup.

## Tasks & Acceptance

**Execution:**
- [x] `docs/contracts/population-acquisition-v1.md` and `executable-plan-v1.md`: define exact raw/hash/declaration/parser/inclusion/checkpoint contracts. API digest covers an explicitly versioned deterministic rows representation independently produced in Python; raw response digest is separately preserved. Declaration binds source, generation, schema, effective period and complete extraction. Do not treat a served response's returned count as its independent count. Missing declared metadata fails safely.
- [x] `packages/domain/src/runs/population.ts` and tests: deterministic parsing/inclusion/reconciliation contracts; preserve ordinal, raw values, explicit indeterminate reasons; exact arithmetic and UTC normalization. Reject malformed CSV, duplicate headers, unsupported media/encoding and invalid JSON structures. Bounded bytes/rows and closed format versions.
- [x] `packages/application/src/runs/acquire-population.ts`, execution ports: transactional claim/reserve, external fetch/store, transactional verified register/row/checkpoint/event. Initial claim records started time and attempt count; timeout/retry state survives restart. Successful stage acknowledges its job only with durable POPULATION_READY; later stories consume that checkpoint. Terminal failures record reason and partial Evidence; Story 3.5/3.9 extend common sealing.
- [x] `packages/infrastructure/src/runs/`, `src/evidence/`, `db/`: repositories, real HTTP adapter, private S3 store and release migration. Production S3 must be the real supported backend; local file backend is explicit test-only. Reject URL credentials/fragments, non-HTTP protocols, redirects and any advertised count/page URL outside the frozen source origin/path contract; bounded GET reads only. A v1 public synthetic source has no CredentialRef; do not infer or send credentials. Explicit frozen source CredentialRef authoring and just-in-time authenticated acquisition are a known Story 3.3 dependency, not a claim of this story.
- [x] `fixtures/northstar/generate.py`, generated declarations, Northstar serving/tests: independent API digests/metadata (including explicit generated_at and effective_period producer fields), deterministic regeneration and vectors. Generation identifiers are not timestamps; preserve that distinction for freshness checks. Keep existing cover-sheet bytes and seeded truncation/missing-value/duplicate cases meaningful. Preserve raw extraction even when reconciliation fails.
- [x] `apps/worker/src/main.ts`, queue adapter/recovery: wire worker to real handler, validate queued identity against stored Run, sanitize errors, resume abandoned claims, no runtime schema migration. Queue transport retries must not reset domain retry counters. Stop own workers cleanly.
- [x] `apps/web/app/runs/[id]/page.tsx` and population view/query: show persisted counts, Evidence identity/digest and ordered reasons with bounded pagination; independent role gate before data access. No raw object URLs or secret/source-body dumps.
- [x] `tests/integration/population.test.ts`, domain/adapter tests and `tests/e2e/population.spec.ts`: cover every matrix row; actual queue consumer + local Northstar + object storage + PostgreSQL journey, crash/duplicate/rollback tests, original bytes verification, browser summary/failure and axe. Include S3 adapter HTTP contract test (conditional headers, existing-object verify, mismatched/missing bytes), not only a mocked application port.
- [x] `CLAUDE.md`, story/checkpoint/sprint artifacts: decisions, actual verification and remaining deployment setup, in same reviewed change.

**Acceptance Criteria:**
- Given an Active file/API Procedure, when an Auditor starts a Run and the actual worker processes it, then the refreshed Run page shows preserved population counts and explicit reasons matching database and object-store evidence.
- Given a failed independent declaration or missing inclusion value, when the worker reconciles the snapshot, then the page shows Inconclusive and a named diagnostic with preserved partial evidence.
- Given acquisition exhausts its bounded attempts, when recovery runs after a restart, then the Run is Run Failed and attempt totals do not reset.

## Spec Change Log

## Review Triage Log

### 2026-09-05 — Review pass 1

- intent_gap: 0
- bad_spec: 0
- patch: 17: (high 4, medium 12, low 1)
- defer: 0
- reject: 2
- Classification rationale: these are localized implementation defects and missing regression cases with a single correction under the existing intent and explicit contract; the intended behavior and story boundaries do not need reinterpretation or re-derivation. The restored implementation agent could not be re-engaged, so the parent applied production fixes and delegated non-overlapping test files.
- addressed_findings:
  - `[medium]` `[patch]` Verify the independently produced file-cover signature during acquisition.
  - `[medium]` `[patch]` Refuse unsupported cover digest algorithms even with a valid signature.
  - `[high]` `[patch]` Compare API response version, representation and ordered schema with its independent declaration.
  - `[high]` `[patch]` Close the API envelope so alternate and nested pagination markers cannot pass completeness.
  - `[medium]` `[patch]` Bound I/O and completion commit by the original overall execution deadline.
  - `[medium]` `[patch]` Compare Content-Length only for identity encoding; bound Fetch-decoded compressed bytes directly.
  - `[medium]` `[patch]` Preserve acquired unsupported/missing-media response bytes before failed parsing.
  - `[medium]` `[patch]` Preserve invalid declaration strings as escaped JSON in the acquisition envelope and fail reconciliation safely.
  - `[medium]` `[patch]` Replace per-byte/per-character memory amplification with bounded UTF-8/hex chunks, an exact-size encoder and sliced CSV fields; test the full 16 MiB boundary.
  - `[high]` `[patch]` Isolate each recovery Run failure so subsequent selected Runs still execute.
  - `[medium]` `[patch]` Stop selecting additional recovery handlers during shutdown and await the active handler only.
  - `[medium]` `[patch]` Record each Timeline check's own outcome, including failed retry attempts.
  - `[low]` `[patch]` Show abandoned Evidence as stopped rather than verification pending.
  - `[medium]` `[patch]` Verify reason pagination beyond 50 with mixed included/excluded/indeterminate rows and no missing or repeated ordinals.
  - `[medium]` `[patch]` Verify both late success and failure after another handler takes over the expired lease.
  - `[high]` `[patch]` Verify both registered Evidence objects on population-ready job redelivery; never overwrite tampered bytes.
  - `[medium]` `[patch]` Kill and restart the actual worker after envelope storage; verify stable Evidence identity, attempts and bytes through the browser composition.

Follow-up review required: high severity present; weighted score `3 × 12 + 1 = 37`.
No change was made inside the intent contract. Full verification after repairs is recorded below.

### 2026-09-05 — Review pass 2 (focused repair review)

- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 2, low 0)
- defer: 0
- reject: 0
- addressed_findings:
  - `[medium]` `[patch]` A failed population-ready storage recheck now consumes a durable attempt and enters recoverable RETRY, then uses a leased verification-only retry without reinserting rows. Exhaustion terminates under the same frozen limit.
  - `[medium]` `[patch]` Recheck the verification deadline after hashing stored objects and around any recovery completion transaction.

Follow-up review required: weighted score `3 × 2 = 6`; focused reviewer re-engaged on the corrected paths and database regressions.

### 2026-09-05 — Review pass 3 (retry repair recheck)

- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 1, low 0)
- defer: 0
- reject: 0
- addressed_findings:
  - `[medium]` `[patch]` Treat a transient database/Timeline rollback during successful reverification as retryable, matching initial acquisition; do not mislabel it as object corruption.

Follow-up score `3 × 1 = 3`; no additional review is required by the scoring rule. Earlier required repair reviews have been completed. The final integration suite includes this rollback regression.

## Design Notes

Use separate durable tables for large rows and immutable Evidence metadata, not a giant checkpoint containing raw bytes. Reserve stable object identity before upload and reconcile existing bytes on restart; never pair old bytes with a newly fetched declaration. Persist declaration/acquisition identity together before external upload or store a versioned acquisition envelope so recovery has the original pair. Separate raw snapshot Evidence from parsed rows; a digest over normalized JSON cannot be mislabeled as the raw HTTP digest.

Evaluate every inclusion predicate; any invalid or missing required input makes the row indeterminate, even when another predicate is false. Otherwise a false predicate excludes with its explicit reason. Report rows in = included + excluded + indeterminate and fail the normative complete inclusion check until indeterminate is zero. Preserve duplicate keys as rows; later mandatory/duplicate Gates consume them. Known zero may advance only when opted in and all population checks pass; no Result is fabricated here.

This is the first consumer stage, not the complete epic. Ready Runs stay Running until subsequent stages are implemented. Failure transitions must be compatible with common Evidence/Result sealing in Stories 3.5/3.9. No production bucket is provisioned in this story: code/config and local contract verification must be real, and final epic handover must identify required deployment values.

## Verification

Load the private durable local helper `C:/Users/opc/tools/intellifin-epic2-test/epic3-env.ps1` with ErrorActionPreference Stop before pinned commands. Never print or commit secrets. Run heavyweight checks serially; do not remove rejected caches or unrelated resources. Implementation runs focused tests, migrations, types and drift first, reports sessions stopped, then main runs full gates.

- Focused population/domain/HTTP/S3 and real PostgreSQL worker tests: every matrix row executes and passes.
- `uv run fixtures/northstar/generate.py`: generated artifacts reproducible; independent vectors pass.
- `pnpm db:migrate`, `pnpm db:generate`: exact new generation and no drift.
- `pnpm test --maxWorkers=1 --testTimeout=30000`, `pnpm test:integration --maxWorkers=1`, `pnpm typecheck`, `pnpm boundaries`: all pass.
- `pnpm build`; actual worker/Northstar/storage browser journey via Playwright, then production web build with local low-disk settings. Inspect screenshot and axe, restore generated-only next-env if changed.

### Focused implementation results — 2026-09-05

- `pnpm db:migrate`: passed on isolated PostgreSQL 18; schema generation 18 applied. `pnpm db:generate`: no drift after the generated migration and compatibility inventory update.
- `pnpm typecheck`: passed, including root integration/browser tests (before the final declaration adapter test edits).
- Focused domain/HTTP/S3/file/config/schema-range batch: 86 tests passed across 6 files. S3 tests exercise an HTTP server and conditional requests, not only a mocked application port.
- `pnpm test:integration tests/integration/population.test.ts tests/integration/schema-compat.test.ts --maxWorkers=1`: 12 passed. Includes durable retry totals, duplicate claims, abandoned leases, upload crash recovery, envelope tamper, declaration mismatch, exact raw bytes and Timeline rollback.
- All implementation-owned verification sessions stopped. Main task owns final browser, full verification, formal review, commit and push. Owner instruction is to pause after Story 3.2; do not begin Story 3.3.
- Remaining deployment setup: provision private S3-compatible storage and set the documented EVIDENCE_S3 variables. No production resources were changed.

### Matrix coverage audit

Audited on 2026-09-05: every row below ran and passed in the 2,079-test unit suite, 238-test PostgreSQL suite (including all nine population cases), or six-check population browser run (three sign-in/setup checks and three actual-worker journeys). No skipped case counts as evidence. Subsequent review fixes require appropriate re-verification.

| Intent matrix row | Executable coverage |
| --- | --- |
| File acquisition | Browser `file population is processed by the queue and preserves original Evidence`; database exact-bytes/duplicates/checkpoint case |
| API acquisition | Domain versioned API digest/completeness case; browser LedgerFlow acquisition through the actual worker and AWS S3 client |
| Boundary | Domain all-predicate and arbitrary-precision cases; browser transaction IDs at the USD threshold, below it and in another currency |
| Malformed inclusion value | Domain invalid-value dominance and missing values; browser TX-500007 remains indeterminate |
| Reconciliation | Parameterized independent declaration failures; API completeness case; truncated-file browser count/digest diagnostics |
| Empty | Domain zero-record opt-in with valid and malformed headers; opt-in cannot override another failure |
| Retry exhaustion | Database four attempts across fresh repository/handler instances and Run Failed outcome |
| Restart/duplicate | Database concurrent live claim, abandoned lease, upload resume and Timeline rollback cases |
| Tamper | Database changed acquisition-envelope refusal; S3 HTTP existing-object mismatch refusal |
| Frozen identity | Database changed binding plus July Run over August authoring period, exact stored plan/review text unchanged; valid unsupported workspace-first plan refuses |

Additional database coverage enforces the persisted overall execution timeout after restart without another acquisition. Browser verification supplies the real worker composition root with isolated HTTP object storage; it does not inject the population handler or select a production file-store fallback.

### Full local verification before independent review — 2026-09-05

- Generator reproduced every existing output byte-for-byte.
- Unit suite: 2,079 passed in 87 files. PostgreSQL integration suite: 238 passed in 16 files, including nine population cases.
- `pnpm typecheck`: passed for every package, web/worker and root browser/integration tests. `pnpm boundaries`: passed, 332 modules.
- `pnpm db:migrate`: generation 18; `pnpm db:generate`: no drift.
- `pnpm build` and production web build: passed.
- Population browser suite: six checks passed (three setup, three journeys), actual worker, real S3 client, Northstar and PostgreSQL; zero axe violations, screenshot inspected.
- Older version-review journeys: two passed in the first completed run; approval journey failed only because its inbox selector matched another Procedure's notice, then passed in a four-check focused rerun after scoping the assertion. An earlier combined browser run passed the three population journeys but Next later exhausted host memory; it is not counted as a successful full run.
- Remote main remains `12ec596`; branch matches its remote before the Story 3.2 commit. No merge or deployment was performed.

### Final verification after review repairs — 2026-09-05

- Full unit suite: **2,099 passed in 89 files**. Includes independent SHA-256 vectors and maximum-size 16 MiB envelope/CSV processing.
- Full PostgreSQL suite: **252 passed in 16 files**, including **23 population cases**. Additional review coverage proves registered-object tamper rejection, reason pagination, stale success/failure after lease takeover, deadline rollback, malformed declaration preservation and durable ready-verification retries/Timeline rollback.
- Population browser suite: **eight checks passed (three setup, five journeys)**. Actual worker process killed after envelope storage, restarted against the same database/store and recovered with stable Evidence identity and attempt 2. The test advances only the dead worker's lease; source-refetch prohibition is independently proven in database tests. Zero axe violations in scanned journeys; saved Run-page screenshot inspected.
- `pnpm typecheck`: all packages and root tests passed. `pnpm boundaries`: **336 modules**, no violations.
- `pnpm db:migrate`: generation **18**. `pnpm db:generate`: no drift. Python producer regenerated fixtures byte-for-byte.
- `pnpm build` and production web build: passed. Browser checks preceded the production build; generated-only `next-env.d.ts` restored afterward.
- Logs: `C:/Users/opc/tools/intellifin-epic2-test/verification/epic3/story32-reviewed-*.log`, plus `story32-review-browser.log`. Prereview results remain separate. All local verification processes finished.
- Remote refs rechecked before commit: origin/main `12ec596dc3d23907a80a7d395c343a54c4375d5a`; feature branch had no remote divergence. Remote CI is reported on PR #23 after push, separately from these local outcomes.
- Final test-only refinement: hold the replacement claim in ACQUIRING while releasing the superseded success/failure, so status checks alone cannot satisfy the test. The 23-case population suite and root test typecheck passed again. No production behavior changed; this completes the original stale-claim verification finding. The implementation commit's remote unit/type/boundary and 252-case database jobs also passed; final-head CI remains authoritative on the PR.

## Auto Run Result

- **Implemented:** the supported frozen population-acquisition stage, independent reconciliation, immutable raw Evidence, durable recovery and visible Run diagnostics. Population-ready remains Running for later stages.
- **Changed files:** domain population parser/inclusion and UTF-8 helpers; application acquisition/envelope/ports; infrastructure HTTP/S3 adapters, queue/repository, schema 18 and configuration; worker composition; Run page; independent Northstar producer/fixtures/serving; unit, integration and browser tests; contracts, CLAUDE.md, sprint/checkpoint and human reports. The reviewed file manifest and complete diff are retained in the local verification folder.
- **Review:** 20 patches across three passes (4 high, 15 medium, 1 low), zero deferred, two rejected. Four independent initial perspectives and two focused repair reviews completed. Final pass: 0 high, 1 medium, 0 low; score **3**, so `followup_review_recommended: false`. Earlier required follow-up reviews have been performed.
- **Verification:** final commands and actual outcomes above; no skipped test counted. HTML report checked at desktop/mobile widths and visually inspected.
- **Residual limits:** private production S3 configuration is required and was not provisioned; local HTTP storage proves adapter behavior, not production policy/connectivity. No authenticated source acquisition or later Epic 3 stages are claimed. No merge/deployment occurred.
- **Handover:** [readable report](story-3-2-handover.md), [visual report](story-3-2-handover.html), [PR #23](https://github.com/raeltec-systems/intellifin-audit/pull/23). Owner-directed stopping point is Story 3.2; **do not begin 3.3 until instructed**.
