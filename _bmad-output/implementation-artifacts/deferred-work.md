- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-bootstrap-the-monorepo-and-deploy-web-and-worker.md`
  summary: Give the worker heartbeat a consumer: a staleness threshold surfaced on the Administration diagnostics surface and a Railway restart policy tied to it.
  evidence: The worker writes `seen_at` every 30 seconds but no route, test, or alert reads it; Story 9.2 (diagnostics) is the natural home.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-bootstrap-the-monorepo-and-deploy-web-and-worker.md`
  summary: Wire Playwright: a `test:e2e` script, a config under `tests/e2e`, and a CI step, once the first UI story (1.4) exists.
  evidence: `@playwright/test` is pinned at the root with no config, script, or CI step; `tests/e2e` holds only a `.gitkeep`.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-bootstrap-the-monorepo-and-deploy-web-and-worker.md`
  summary: Drop the root-only `typescript@6.0.3` pin once dependency-cruiser supports TypeScript 7; `scripts/check-boundaries.mjs` will fail loudly rather than silently if the pin is removed early.
  evidence: With TypeScript 7 at the root, dependency-cruiser 18.2.0 cruises zero modules and exits 0 (reproduced 2026-09-02 after a clean reinstall).

- source_spec: `_bmad-output/implementation-artifacts/spec-21-1-preserve-evidence-unicode-values.md`
  summary: Align evidence request validation for malformed UTF-16 wire strings in a focused follow-up.
  evidence: Pre-existing browser TextEncoder measurement substitutes isolated surrogates while retaining the input string; Rust JSON decoding refuses their escaped wire form. The U+FEFF repair changes neither behaviour. Add wire-level parity cases and client refusal without narrowing valid server values.

- source_spec: `_bmad-output/implementation-artifacts/spec-21-1-preserve-evidence-unicode-values.md`
  summary: Provide an accessible display description for evidence filenames composed entirely of invisible Unicode characters while preserving immutable metadata.
  evidence: Existing filename rendering can appear blank for accepted U+200B and similar strings; U+FEFF-only values expose the same display limitation after this repair. Raw metadata, identity and byte access now work, but a labelled display representation is a separate presentational follow-up.

- source_spec: `_bmad-output/implementation-artifacts/spec-20-6-admin-continuity-safeguard.md`
  summary: Consider scoped read-only identity activity or a continuity indicator in membership administration.
  evidence: The existing membership projection reports membership activity and expiry but does not expose application identity activity; an owner-deactivated identity can therefore retain a visibly active membership. The approved safeguard enforces the full predicate in the database, its refusal explicitly requires an active account, and operator preflight identifies invalid continuity. No identity-management UI or authority is added in this follow-up.

- source_spec: `_bmad-output/implementation-artifacts/spec-21-3-install-and-select-trusted-skills.md`
  summary: Existing Story21.2 unsent methodology edits are lost after a transient session-check outage unmounts the workspace; retain exact-session draft custody in a focused batch follow-up.
  evidence: `zobba/web/src/MethodologyWorkspace.tsx` keeps `draft`, recall reason and selected organisation only in component state, while `App.tsx:149–159` switches a failed session read to an unavailable view that unmounts it. `methodology.ts:265–276` retains only submitted uncertain actions. Independent source inspection confirmed this predates Story21.3; the existing browser recovery proof covers submitted delivery, not unsent edits.

- source_spec: `_bmad-output/implementation-artifacts/spec-21-4-remember-scoped-working-knowledge-with-its-basis.md`
  summary: Closed the Story 21.3 follow-up for unsent methodology edit and recall custody within this batch.
  evidence: Exact actor/session/organisation memory custody now survives actual session-check outage and App unmount. Recovery requires the workspace’s own fresh current-Admin read; replacement, denial, logout, cancellation and success clear private custody, without automatic submission. The previous component fails the intended restored-editor assertion; the repaired four-case browser invocation passes. See `zobba-foundation-batch/story-21.4/methodology-custody/README.md` and the final Story 21.4 verification record for manifests, negative-control restoration, independent review and combined coverage. The original discovery entry above is retained.

- source_spec: none
  summary: Story 22.2 AC4 — establish a new scoped engagement and assignment conversationally from the first objective (authorised client and period resolved) before acquiring material, with no procedure or skill-selection wizard.
  evidence: Split on 2026-10-07 (owner chose S) from the Story 22.2 Task work-loop spec (AC1–3); independently shippable and touches engagement-creation authority, so it gets its own spec and review. Story 22.2 is not done until this is delivered.

- source_spec: `_bmad-output/implementation-artifacts/spec-22-2-ac4-establish-engagement-conversationally.md`
  summary: Use the engagement's stored audit period as the default methodology context (period_start/period_end) for Tasks created in that engagement.
  evidence: Schema 13 stores the period on the engagement, but nothing reads it yet; the AC4 design note leaves methodology use to a later change without changing the Story 21.2 binding rules.

- source_spec: `_bmad-output/implementation-artifacts/spec-22-3-compact-context-without-inventing-authority-or-evidence.md`
  summary: The context budget has no production source: no model profile field and no per-Task setting feeds `ContextBudget`, and the budget reserves no output tokens.
  evidence: `Composition.context` is supplied only as `ContextBudget::DEFAULT` (128,000); `ContextBudget::effective()` never subtracts `max_output_tokens`.

- source_spec: `_bmad-output/implementation-artifacts/spec-22-3-compact-context-without-inventing-authority-or-evidence.md`
  summary: No test upgrades a populated schema-13 database (existing `task_steps` and `model_invocations` rows) to schema 14.
  evidence: The upgrade tests reach 14 only from schemas 8, 9 and 10, and `model_upgrade_contract` asserts that the model tables are empty.

- source_spec: `_bmad-output/implementation-artifacts/spec-22-1-anthropic-thinking-blocks.md`
  summary: Structured-output requests to a current Claude model always fail as Malformed, because the structured path treats any non-text event (including thinking) as invalid.
  evidence: native.rs outcome schema loop sets valid=false on Reasoning events; the spec deliberately kept that rule. Current Claude models always think, so structured output needs a reasoning-aware rule before any feature relies on it.

- source_spec: `_bmad-output/implementation-artifacts/spec-22-3-compact-context-without-inventing-authority-or-evidence.md`
  summary: One work-loop pass sends thousands of repeated knowledge, methodology and command lookups to the database, so a pass can take 4–5 seconds in a debug build.
  evidence: A fully logged compaction test step ran about 83,000 short statements in 29 seconds (about 9.4 s inside the database). Production renews the 5-second owner lease every 200 ms, so this is cost and latency, not a correctness failure.

- source_spec: none
  summary: Story 20.7b — live qualification proof: disposable apply/destroy evidence, actual Cognito login, release-only migration refusal against the deployed database, backup/PITR restore to a separate environment with restored scope/receipt verification, the beyond-horizon effect reconciliation fixture, and actual spend reporting.
  evidence: Owner chose to split Story 20.7 (2026-10-13). No AWS account or budget exists yet (AWS startup credit application pending); 20.7a delivers the Terraform, image, release workflow and runbook verified offline. 25.4 still requires 20.7b.

- source_spec: `_bmad-output/implementation-artifacts/spec-20-7a-qualification-environment-infrastructure.md`
  summary: Database TLS uses sslmode=require, so no runtime, migrator or bootstrap connection verifies the RDS server certificate (verify-full with the RDS CA bundle in the image).
  evidence: The URL parser allows only sslmode/application_name query keys, so sslrootcert cannot be passed today; the spec chose require on purpose and 20.7b must decide before real data.

- source_spec: `_bmad-output/implementation-artifacts/spec-20-7a-qualification-environment-infrastructure.md`
  summary: The evidence bucket relies on versioning only; there is no S3 Object Lock, deny-delete bucket policy or MFA delete for original evidence versions.
  evidence: Review found any administrator can delete evidence versions; immutable custody needs a storage-level control and a retention decision from the owner.

- source_spec: `_bmad-output/implementation-artifacts/spec-20-7a-qualification-environment-infrastructure.md`
  summary: The qualification account has no CloudTrail trail, no CloudWatch alarms (ALB 5xx, unhealthy targets, task failures, RDS storage/CPU), no SNS topic and no RDS storage autoscaling; the budget is the only alert.
  evidence: Each adds monthly cost, so it needs an owner cost decision together with the AWS credit budget.

- source_spec: `_bmad-output/implementation-artifacts/spec-20-7a-qualification-environment-infrastructure.md`
  summary: The CloudFront response headers policy sets no Content-Security-Policy or Permissions-Policy for the web shell.
  evidence: A correct CSP needs the web app's actual script, style and connect sources; it was not in the 20.7a spec.

- source_spec: `_bmad-output/implementation-artifacts/spec-20-7a-qualification-environment-infrastructure.md`
  summary: The release workflow does not read ECR image scan findings (scan_on_push) before deploying, and the release role has no ecr:DescribeImageScanFindings.
  evidence: Scanning runs but its result never gates a release.

- source_spec: `_bmad-output/implementation-artifacts/spec-22-4-run-measured-analysis-in-an-isolated-workspace.md`
  summary: Live Fargate qualification of analysis jobs — a real isolated job in AWS with credential/metadata denial, terminate/restart reconciliation and staging/collection over real presigned S3 URLs.
  evidence: Owner kept 22.4 as one story (2026-10-13) but no AWS account exists yet; the Fargate adapter is verified offline only and the live proof joins Story 20.7b.

- source_spec: `_bmad-output/implementation-artifacts/spec-22-4-run-measured-analysis-in-an-isolated-workspace.md`
  summary: No production entry point admits an analysis job yet — no HTTP route, model tool or composition builds an analysis target, so the worker can run and recover jobs nothing can create.
  evidence: The 22.4 spec put model-tool exposure out of scope; Analysis::admit is called only from tests. The later model-tool story must add admission, policy and attachment classification.

- source_spec: `_bmad-output/implementation-artifacts/spec-22-4-run-measured-analysis-in-an-isolated-workspace.md`
  summary: There is no operator command, endpoint or runbook procedure to reconcile an analysis job recorded as unknown, although the domain and database allow unknown → terminal for explicit reconciliation.
  evidence: pending() excludes unknown jobs, so they leave automatic handling; the Task gets only a Reconcile cycle end and an analysis_unresolved diagnostic.

- source_spec: `_bmad-output/implementation-artifacts/spec-22-4-run-measured-analysis-in-an-isolated-workspace.md`
  summary: Analysis admission sets operation expires_at from the worker's local clock (unix_now) instead of database time used by the other authority checks.
  evidence: Clock skew between worker and database could admit an operation with a wrong expiry.

- source_spec: `_bmad-output/implementation-artifacts/spec-22-4-run-measured-analysis-in-an-isolated-workspace.md`
  summary: The analysis application tests use the real wall clock (busy-loops of 1–2 s) instead of an injected clock.
  evidence: Instant::now() is called directly; the wall-time tests are slow and timing-dependent.
