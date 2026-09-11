# Guided authoring continuation

## Baseline and branch

- Checked 2026-09-11: PR #29 is open, not merged; parent head is
  `2ab2995e154885e006985cf49fb43f83ec32d878`; main is
  `55b61e2d5c24aeabe804279e8d41ef6e64ed3097`.
- Clean fresh checkout; no prior feature branch or uncommitted user work.
- Branch: `codex/epic-2-guided-authoring`; draft PR base: `codex/epic-5-controls`.
- CI's PR base filter is extended to the parent for this stacked review. Its main-only
  release trigger is unchanged. No merge or deployment is authorised.

## Story 2.15 checkpoint

Implemented: source contract, labelled synthetic risk defaults, unset criterion references,
editable draft context, human attribution and plan invalidation, frozen lifecycle context,
14-row manager comparison and unchanged 12-row historical comparisons. No data migration
or historical backfill is needed for these JSON sections.

Local verification on the first checkpoint's source tree:
- Exact Node 24.20.0 and pnpm 11.25.0; frozen-lockfile install.
- `pnpm typecheck`: passed, including root test types.
- `pnpm test`: 4,002 passed across 197 files.
- `pnpm boundaries`: 575 modules, no violations.
- New PostgreSQL lifecycle and historical-review tests are written; execution pending
  the disposable PostgreSQL setup or hosted CI. Browser gates remain pending.
- An earlier unit run found one outdated reference-section count; corrected, full rerun passed.

This checkpoint is implemented and locally checked, not yet accepted as fully verified.
Commit identities and hosted/database/browser results are added at subsequent checkpoints.

## Remaining authorised work

1. Complete Story 2.15 real-PostgreSQL and browser checks; correct any failures.
2. Story 2.9: guided layout and durable saved-content acknowledgements.
3. Story 2.10: bounded OpenAI writing operation, visible suggestions, safe explicit acceptance.
4. Full final gates, screenshots and independent-review handoff.

Stories 2.11–2.14 remain subsequent work. Live OpenAI authoring is not yet tested. Installed
SDK versions: ai 7.0.89, @ai-sdk/openai 4.0.58, @ai-sdk/anthropic 4.0.47. The requested
product model is gpt-5.6-terra, independent of plan-check and audit-Run model configuration.

## Pushed first checkpoint and Story 2.9 candidate

- Published context commit `65c1615a7bda06b92f123ee5330b37f292431f44` and CI-base
  commit `22da7d0f27b07e72aef5304c0df78dfe03db66ea` in draft PR #30.
- CLI Git had no push credentials. The authenticated GitHub connector published equivalent
  atomic commits; both resulting tree SHAs were checked against the locally tested trees.
  Local original commits remain preserved under the local-first-checkpoint branch.
- CI run 34590523241: first checkpoint typecheck/unit/boundaries, real PostgreSQL18
  migrations/integration, container build/startup checks passed. Browser jobs pending.
- Story 2.9 implemented: responsive outline, separate durable review metadata, explicit
  clarification, saved revision/actor acknowledgement, conservative invalidation, no
  inherited reviews on new versions. Migration48 adds nullable metadata without backfill.
- Local candidate: typecheck and boundaries pass. 4,027/4,028 units pass; the remaining
  planted-boundary test fails because workspace synchronization creates a disappearing
  .rsync-tmp file. Rechecking the same tests outside the synchronized directory.
- Real populated47 upgrade test added; runtime DB/browser verification goes through CI.
- No authoring credentials present (AUTHORING_OPENAI_API_KEY / OPENAI_API_KEY / MODEL_API_KEY
  unset, no local env files). Live authoring verification remains blocked.


## Story 2.9 published checkpoint and focused corrections

- Pushed `62e97c4ace1d68df769dcba484089c318630aa72`, identical tree to local
  `bed2016c848fb5e41db3072aabf7206b463c859c`. Local planted-boundary recheck outside
  workspace synchronization passed all 26 cases. Other 4,027 units, typecheck and
  boundaries passed on the checkpoint tree.
- Hosted CI 34592479249: unit/typecheck/boundaries, container and agent-abuse gates passed.
  PostgreSQL found three historical seed fixtures calling today's repository before
  migration48. Corrected to raw historical-column inserts; preservation assertions retained.
- Browser failures identified non-exact Frequency locators, old desktop-only expectations,
  pre-hydration navigation and a test helper mutating SSR markup. Corrected the navigation
  with native links and deferred helper mutation until hydration. Focused UI assertions
  pass (57 including the new writing UI); full hosted browser recheck remains required.
- First CI 34590523241 finished: PostgreSQL, unit/boundaries/typecheck, container and abuse
  gates passed; browser failed obsolete Objective locators, corrected in the next checkpoint.
- Story2.10 is implemented locally with synthetic command/SDK tests; publication and full
  integration/browser acceptance are in progress. No live provider test has been performed.


## Story2.10 implementation and verification candidate

- Correction checkpoint pushed: `f9b6962c6c0146f37b2293b82748187f1ce7d428`, tree
  `a1586413ec1c1d907716d2c3a9e58c628705aec7`, matching locally checked `6499b51`.
  Isolated typecheck and41 focused UI/style tests passed. Hosted CI34595023824 is running.
- That CI exposed two remaining historical fixture errors: querying the new column before
  its migration, and passing JSON text where postgres expects JSON values. Corrected with
  a preceding-schema absence assertion and explicit sql.json values; original preservation
  and immutable-definition assertions remain, including a post-upgrade mutation refusal.
- Story2.10: separate bounded port, independent OpenAI configuration, durable request
  reservation, minimised audit, human-attributed acceptance through existing draft commands,
  visible comparisons, section-scoped UI state, exact uncertain retries and manual fallback.
  Requests also bind the lifecycle decision history so submission/rejection cannot revive
  a pre-submission suggestion. Migration49 stores bounded request receipts.
- Local targeted checks:31 command cases,16 writing-state cases,4 installed-SDK transport
  cases and7 Server Action trust-boundary cases passed. Workspace build passed. Drizzle
  generation reports no schema drift. Browser collection lists the owner journey and3
  assistance cases with a synthetic collection-only password (no browser execution).
- `node scripts/verify-authoring-provider.mts` exited2 with explicit blocked status and
  zero live calls: dedicated key absent. See guided-authoring-openai.md for secure setup
  and the six-case human faithfulness review. No synthetic result is live-provider evidence.
- Next: finish complete local gates on the fixed tree, publish the atomic writing commit,
  complete hosted PostgreSQL/browser/accessibility gates, inspect the actual PNG captures,
  and record exact source/CI identities in the final review report.


## Complete local candidate gates

- Source snapshot `b08b8cb098f58f7b96860e2e2a221508e4603833`: all4,087 units in203
  files passed in the isolated verification directory, including all planted boundary tests.
  `pnpm typecheck` passed; `pnpm boundaries` passed with590 modules. The sole prior unit
  failure was an unnamed-role div carrying aria-label; changed it to the correct group role.
- `pnpm build` passed and `pnpm db:generate` reported no schema changes. The actual installed
  SDK also round-tripped the test-only HTTP preload successfully, explicitly synthetic.
- The exact candidate is ready for the atomic authoring checkpoint and hosted checks.
  Database and browser results remain required; local PostgreSQL/browser prerequisites
  are unavailable. The CI focused journey runs first for useful failure feedback, followed
  by the unchanged complete browser/accessibility command.

## Published authoring checkpoint and focused review corrections

- Pushed migration fixture correction `181722d67084f525d250e64d3d17b74cf624e060`,
  then authoring checkpoint `bd7bcdad0cdd359fc2c52ced1543b54e8263b038` (exact tree
  `c80537c9c2f0d5f7e7308d0270836bdd060db09d`). Hosted CI run34596609481 started.
- Independent focused code review identified prose containing credential references and
  the objective proposal editor's generic10,000-character limit. The corrections refuse
  recognised/known credential material before provider use without changing manual saves,
  and enforce4,000 objective characters in received responses, editing and acceptance.
  The adapter separately checks that its configured key cannot enter the prompt.
- Added tests for notes, feedback and saved prose, recognised private-key material,
  known opaque references, no provider calls or receipt writes on refusal, manual saves,
  section-specific acceptance and UI limits. Live-provider verification remains blocked.

## Hosted feedback and hydration correction

- On `bd7bcdad0cdd359fc2c52ced1543b54e8263b038`, hosted typecheck/boundaries/unit,
  container verification and the focused guided/owner/writing browser step passed.
  The complete browser suite is still running. PostgreSQL passed548/549 cases, including
  all populated upgrades; the sole failure expected a known-completed receipt to remain
  pending after submission. The adopted contract instead returns an honestly stale ready
  receipt with usage. Its integration case now proves refusal before AND after completion,
  and exact preservation of the submitted row. No acceptance guard was changed.
- The previous full browser run found that readable SSR inputs could be edited before
  their React handlers were installed, losing keystrokes at hydration. Keep one native
  disabled editing fieldset until hydration, then enable it in place. Native outline
  links and saved text remain readable. Preserve all existing dirty/focus assertions;
  identify Evidence groups by their own accessible names and wait for enabled state before
  keyboard focus. The hero journey now actually navigates between editors and review.
- Credential/length corrections passed60 focused unit tests and the pinned typecheck.
  Guided hydration passed24 scoped Guided/Evidence tests. Final hosted verification and
  inspection of the actual screenshot artifacts remain required before handoff.

## Correction checkpoint and screenshot retention

- Credential/limit correction pushed as `fe9b991ff55c55c3270da522e27587dedadd7720`;
  hydration/browser correction pushed as `e7e786e582b9b0fbea872c2e6eeabb52b4bea4c2`.
  Exact tree67c980fa226f921eaccaaa80348e5c920090abba passed68 focused local tests,
  typecheck and boundaries. Hosted run34598107130 passed units and the focused eight-case
  guided/owner/writing browser step. Remaining hosted jobs were still running at this entry.
- The earlier authoring run's full browser/mutation jobs were cancelled by the checkpoint
  push, not passed. Its eight-case focused browser step passed. PNG captures were attached
  by body only, so Playwright gave them opaque filenames; the name-based exporter found none.
  The correction writes each actual screenshot to a named outputPath before attaching it.
  Root-test typechecking passed. No image was generated, recreated or presented as inspected.
