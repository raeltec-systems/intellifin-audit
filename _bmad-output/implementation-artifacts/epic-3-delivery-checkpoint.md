# Epic 3 delivery checkpoint

Status: in progress. No Epic 3 story is complete yet.

## Delivery scope

Implement and validate Stories 3.1–3.11 through the real web, worker, PostgreSQL and Evidence storage paths. Demonstrate P-2 and P-3 golden outcomes, failure paths and sealed Results. Commit and push each verified story, then provide a human-readable report and PR for review.

Base: `3eddd4943e63bb16a48988d776f104f8a4caae12` on `codex/epic-3-adapter-runs`, including the pending Epic 2 release notes from PR 22 atop merged PR 21. Production remains on `12ec596dc3d23907a80a7d395c343a54c4375d5a`.

## Current checkpoint

- Epic context compiled and verified.
- Story 3.1 specification ready and implementation underway through the BMAD implementation handoff.
- Local Node 24.20.0 and isolated PostgreSQL 18.6 on port 55433 are available. Preflight found approximately 2.2 GB free disk and 2.4 GB free memory. Preserve bounded concurrency.
- Railway production reports SUCCESS for PostgreSQL, web, worker and Northstar. This is a status check, not Epic 3 deployment verification.

## Verification discipline

- Reuse the pinned runtime and the existing isolated test environment. Check service readiness after resuming.
- Run focused checks while implementing. Run full required gates once the story is stable; rerun only where new changes or failures justify it.
- Keep integration, browser, unit boundary tests and production builds serial. Boundary tests temporarily plant source violations.
- Perform browser verification before production web builds. Record actual commands, counts and failures in each story spec.
- Keep test logs and evidence outside temporary cleanup targets. Do not delete any previously refused cleanup target.
- Before the epic is reported complete, audit every acceptance criterion against delivered behavior and actual test evidence, then write the readable report under this directory.

## Planning boundaries to retain

- Story 3.6 implements `sheet` and `json` corroboration; four substrate kinds remain in the shared contract. Browser/desktop extraction arrives with agent-driven execution.
- Story 3.11 explicitly defers the five-second live channel to Epic 5. Request-time reads must show update time and refresh affordance.
- Owner resolved adapter retry policy: one automatic extra bounded cycle, then FAILED; incomplete coverage yields INCONCLUSIVE. No human retry/skip Escalation on adapter Work Items. Normative addendum, architecture, SPEC, Story 3.8 and context updated; downstream reviews must revalidate this scoped exception.
- The stored activated succession chain owns version selection, not version numbers or timestamps. Null activation is pending and never transfers ownership.

## Remaining stories

3.1 initiation; 3.2 population acquisition; 3.3 Targets/References; 3.4 Observation batches; 3.5 Evidence sealing; 3.6 corroboration; 3.7 evaluation/Exceptions; 3.8 full Gate/limits; 3.9 Result sealing; 3.10 cancel/rerun; 3.11 Runs surfaces.

## Investigation notes for the next stories

- AD-5/AD-11 require a private S3-compatible EvidenceStore, conditional object creation, byte/digest verification, and application-mediated reads. The declared Railway config has no bucket wiring yet; infrastructure currently has no S3 SDK dependency (architecture pins AWS S3 SDK 3.1124.0). Implement and verify the storage port, keeping production provisioning distinct from local verification. Do not store binary Evidence in PostgreSQL or a container's ephemeral filesystem as the production solution.
- Unknown inclusion values need an explicit persisted indeterminate decision. They must fail inclusion/mandatory-value reconciliation, remain visible, and prevent zero-record Pass; never silently treat missing processed_time or an invalid numeric field as an ordinary exclusion. Preserve duplicate rows by ordinal.
- Source declaration protocol must define exactly which bytes/digest representation it declares. Prefer independently generated payload/declaration fixtures with a versioned representation; raw capture SHA-256 remains separate from any declared canonical JSON digest. Do not calculate the expected declaration from the adapter response itself.

- Planning correction from primary review: AD-2 freezes the Population Source contract, and the interpreter contract reads `inputs.sourceSnapshot.contract`. Execute that stored contract and verify its own digest; do not substitute the current mutable binding or refuse a frozen version merely because a later binding edit minted a new Draft. Credential capability enforcement remains a separate current security boundary. The scout's proposed current-binding digest recheck is not authoritative.

- No EvidenceStore, token resolver, acquisition adapter or Run consumer existed at the baseline. CredentialProvider currently describes capabilities only. Preserve that safe registration seam; execution needs a separate just-in-time secret seam whose values never reach the audit/log/queue/Result contracts.
- Northstar API count files are generated independently in Python, but currently omit digest, effective period and explicit generation timestamp. Complete the source-side metadata contract before expecting successful Gate freshness/integrity. Never manufacture an independent declaration from the adapter's own parsed response.
- Northstar CSV bytes include a synthetic first line and second-line headers. Hash the raw bytes, retain duplicates, and preserve exclusions with reasons. A missing inclusion field is indeterminate, never an ordinary excluded record that can disappear from the Gate.
- RoleMatrix JSON preserves separate policy entries; the generated CSV flattens them to role/permission pairs and loses entry boundaries. Do not merge conflicting role entries into a single permission set. The source artifact used for evaluation must retain enough structure to reproduce this ambiguity.
- `evaluateComplianceRecord` in `packages/domain/src/procedures/plan-compiler.ts` already implements deterministic approval and permission-pair rules, decimal boundaries and conservative evidence inputs. Reuse it through the evaluation module; do not create a second rules engine. Its non-applicable conditions are marked `applicable: false`; published applicable-condition counts must respect that flag.
- Full P-2 and P-3 fixture populations intentionally end Inconclusive. Demonstrate Pass and Control Failure with independently declared scoped datasets/cases as well as the full bad-data populations; never change expected outcomes to fit the implementation.
- Main owns `tests/e2e/runs.spec.ts`; Story 3.1 implementation agent owns feature files and focused backend tests. Heavy verification is serial and handed back to main after focused checks.

## Story 3.1 verification checkpoint

- Generation 15 migrated successfully on local PostgreSQL 18.6.
- 28 focused unit/action tests and 9 focused integration tests passed. Full package/web/root-test typecheck and `pnpm build` passed before the browser follow-up edits.
- First browser run reached the saved queued Run and passed its accessibility scan, then a test assertion mistook a raw SQL bigint sequence string for a number. Fixed the assertion with explicit conversion.
- Browser also exposed a POST method casing hydration mismatch, now corrected. The subsequent lost-response test was interrupted when Turbopack compaction exhausted disk; it is not a passing verification result.
- Stopped only the task-owned Playwright/Next/Northstar process tree. Cleaned the exact interrupted synthetic database fixture, preserving audit history. No browser server is currently running.
- Added `INTELLIFIN_LOW_DISK=1` persistent development/build cache opt-out. The completed browser rerun passed all 6 checks, including real lost-response recovery; production web build also passed.
- Automatic approval review rejected deletion of `apps/web/.next/dev/cache/turbopack` with `blocked by policy`. The user was asked to remove this stopped generated cache manually. Do not retry its deletion or route around the refusal. No source file truncation was observed; new migration and package build preceded the disk error.
- Pre-review full unit run passed 1,986/1,987; fixed the quoted schema marker and passed all 3 schema-range tests. Full integration run passed 222/223; updated the exact schema-15 inventory and passed all 6 compatibility tests. Final types, boundaries (317 modules), drift and production web build passed. These results predate the review patches below.
- Space subsequently recovered externally: preflight observed 2.41 GiB disk and 5.16 GiB RAM free with low-disk mode enabled. The Temp environment helper had disappeared; stopped the inadvertently started wrong-patch Node test immediately, without counting it. Recreated a durable, uncommitted helper at `C:/Users/opc/tools/intellifin-epic2-test/epic3-env.ps1`, with new synthetic E2E accounts and secrets in the same isolated database. All commands now begin with `$ErrorActionPreference = 'Stop'` and load this helper. Never print or commit its values.

## Story 3.1 formal review checkpoint

- All four BMAD review layers returned: blind, edge cases, verification gaps and intent alignment. The story is `in-review`, still uncommitted.
- Accepted recovery fixes: persist an opaque request token scoped to the trusted initiator and exact request, recover the original Run even if terminal, and return existing active links before ownership resolution. Fresh initiation still permits terminal reruns.
- Accepted integrity/testing fixes: composite Procedure/version FK, narrow conflict handling, epoch-based lineage comparisons, committed NOTIFY and denial-audit assertions, corrupted lineage refusal, direct Run Detail access/error coverage and stronger isolated-test guarding. Implementation agent owns feature files and focused tests for this pass; main owns reports and final full verification.
- Generation 16 will carry the additional review constraints and request association, without rewriting applied generation 15. Reverify migration, types, suites, browser and production build after the patches return.
- Marked preflight memory reporting informational and separated required verification commands from executed outcomes. Performance speculation and non-JavaScript confirmation enhancement were not accepted as defects in this initiation contract.
- Full review patch is outside the repo at `C:/Users/opc/tools/intellifin-epic2-test/verification/epic3/story31-review.patch`; screenshot and logs are in that same durable folder.
- Remote `main` remains `12ec596dc3d23907a80a7d395c343a54c4375d5a`. Continue through all Epic 3 stories after Story 3.1 is verified and pushed; do not mark the epic complete at the first story.

## Review patch verification update

- Implementation returned with schema 17 (migrations 16 ownership/request token, 17 multi-token associations). Focused tests: 39 unit/action/schema tests, 15 Run integration tests and 6 schema compatibility tests passed; drift is clean. No implementation agent remains running.
- The independent follow-up on idempotency, token scope and repeated recovery returned no findings. Review triage is in the spec: 12 patches (7 medium, 5 low), 2 rejected, no intent gap or bad-spec loop.
- Rebuilt packages/worker/Northstar successfully. Browser run exposed a test race: after a document reload native POST can complete before React shows its modal. Added a `data-client-ready` marker for JavaScript fault injection and a separate no-JavaScript submission/recovery test. Both repeated-lost-response recovery and native terminal-Run recovery now pass.
- Latest full browser run: 9/10 passed. Only initial navigation timed out because cold `/runs/[id]` compilation took just over 10 seconds. Increased that local low-disk-only navigation budget to 30 seconds (normal CI unchanged). A focused rerun of initiation/reload/duplicate/axe is currently running; use the active session in conversation state. All results/logs are in the durable `verification/epic3` folder.
- After that rerun: copy/inspect screenshot, rerun full unit/integration, types/boundaries, and production web build against schema 17. Restore generated-only next-env changes. Complete spec/result/sprint metadata, commit and push Story 3.1, then continue Story 3.2. No Epic 3 story has been committed yet.

### Story 3.1 final gate — 2026-09-05

Reviewed implementation passed 1,995 unit and 229 PostgreSQL integration tests, all typechecks, 317-module boundaries, schema-17 drift, package/worker build and production web build. All 10 browser checks passed across the final 9/10 run and focused cold-route rerun (4/4 including setup); do not describe this as one 10/10 run. Axe zero, no hydration errors, screenshot visually inspected. Generated next-env restored. Story marked done; next is Story 3.2. No Epic 3 production changes authorized or made.

## Story 3.2 implementation checkpoint — 2026-09-05

- Owner narrowed the active scope: finish Story 3.2, review, test, commit and push, then pause. Do not start Story 3.3 until instructed.
- Population interpreter, per-Run revisioned claims, four-attempt retry bound, immutable acquisition-envelope pairing, raw Evidence registration, persisted reconciliation/rows and bounded reason pagination are implemented. The worker uses real HTTP and private S3 adapters; deployment storage values are not provisioned.
- Local schema generation 18 migrated successfully against isolated PostgreSQL 18. Domain population tests: 23 passed. Real database population tests: 6 passed (including duplicate delivery, abandoned lease, upload crash, tamper, retry persistence and Timeline rollback). Root typecheck passed. These are focused implementation results; final browser, full gates and formal review remain pending.
- Final focused implementation batch: 86/86 domain, HTTP, S3 HTTP-contract, file-store, configuration and schema-range tests passed. Population plus schema-compatibility database checks: 12/12 passed. Generation 18 drift is clean. All implementation sessions stopped; main task owns browser/full gates and formal review.

## Story 3.2 complete — owner-directed pause, 2026-09-05

- Final post-review gates passed: 2,099 unit tests, 252 PostgreSQL tests (23 population cases), types, 336-module boundary check, generation 18 migration/no drift, deterministic generator, package/worker/Northstar builds and production web build.
- Five population browser journeys plus three setup checks passed, including actual worker kill/restart mid-upload and abandoned Evidence display. Scanned journeys have zero axe violations; screenshot inspected.
- Four initial independent review perspectives and focused repair reviews completed. Twenty patches addressed; none deferred. Contracts and CLAUDE.md record the decisions and gotchas.
- Reports: `story-3-2-handover.md` for GitHub and `story-3-2-handover.html` for visual review. PR #23 remains the draft review surface; check its live CI results for the pushed commit.
- **Stop here. Story 3.3 is still backlog. The owner explicitly asked to finish 3.2 and pause; this supersedes earlier instructions to continue through the epic.**
- No merge or deployment. Before eventual release the worker requires private S3 configuration; production setup and later execution stages are not claimed as complete.
