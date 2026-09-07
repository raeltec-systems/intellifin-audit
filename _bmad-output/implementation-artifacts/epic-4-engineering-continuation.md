# Epic 4 engineering continuation

Status: INCOMPLETE — not accepted, not merged.

## Baseline and handoff

- Branch: `codex/epic-4-agent-runs`; draft PR #24.
- Historical review: `b6bcd466749c56d2c37f8d8a46669dcf0f32d001`.
- Remote inspected: `94978c99622997eaa5eccf968ab210b3a91c2969`; main `12ec596dc3d23907a80a7d395c343a54c4375d5a`. PR #23 remains open.
- Source recovered from GitHub Actions artifact 10009524638; ZIP SHA-256 `9689165b431c0745754ab6ea3a3fc9f4ae19a3471cebcec347b39021b0554e4c`, verified locally. Checkout was clean.
- Prior repairs preserved: migration `380a4ff744f73558fa7ef6bf3e7260cdf1638e16`; provider identity `e0fe4f362485faa1a40bb57c50d29ce2689d9317`; authentication `15d01389bbe2d272f44a0a8ae515ecb061fe7507`.
- Chromium installation is present in the PostgreSQL CI job (`663c959`), preserved.
- Snapshot workflow and delivery payload were already absent. Removed the remaining branch-writing delivery workflow in pushed commit `9a5f2eb370f9e2db28192c0c441354c35cd18a4a`. All inspected delivery runs had terminated.

## First reproduced failure and checkpoint

At `94978c9`, root TypeScript checking failed with `TS1161: Unterminated regular expression literal` in `tests/integration/sealed-evidence-upgrade.test.ts`. The transport had inserted a literal newline in a regex. This checkpoint restores its intended escaped newline; root TypeScript checking then passes using Node 24.20.0 and the repository's TypeScript dependency. This is a test-compilation repair, not populated-migration acceptance.

Current-head CI run 34098512827 ended `action_required`. Green run 34098492301 tested `982fd78`, before the migration repair, and is not evidence for that repair. No gate is waived.

## Remaining work

- Re-run real PostgreSQL 18 fresh and populated upgrade tests; inspect migration compatibility and historical evidence preservation.
- Verify provider-identity and authentication regressions, including cleanup discoverability and approved positive authentication postconditions.
- Stories 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11 remain `ready-for-dev` in the inspected sprint file and are not accepted.
- Complete the specified real worker/application/persistence journeys and all required gates.
- Live Solari audit acceptance remains unverified; a public-page smoke or local Chromium run does not meet it.

Next action: validate this checkpoint through normal CI and repair the first remaining regression before story implementation. No merge or deployment is authorized by this checkpoint's status.

## Populated-upgrade verification checkpoints

- `7c6ab687acfe2c3a115550cbfefebc02ac7d19b6`: 3041 unit tests, full typecheck, boundaries and workspace build pass locally with Node 24.20.0 / pnpm 11.25.0. Hosted CI verifies typecheck/unit/boundaries and container builds. PostgreSQL revealed incorrect assertions in the inherited migration regression.
- `245fc301dc7070e83c24697965a69271e0ecc628`: assert the Drizzle error's PostgreSQL cause.
- `d2930961a2fdf957b78c0192baff906e4fadc1e1`: assert actual sealed-trigger SQLSTATE 23514. CI 34129224665 passes 384 integration tests and reaches the successful populated upgrade, then fails because the test treats a timestamp string as a Date.
- This checkpoint normalizes that timestamp and checks complete evidence, population, snapshot, outcome and seal rows after repeat migration. Real PostgreSQL acceptance remains pending this checkpoint's CI; no claim of acceptance.

Generation 32 compatibility: the preserved repair changes only transactional locks and trigger suspension/restoration around the existing backfill; transformations remain identical. Databases already at generation 32 do not rerun it (the migrator uses the migration journal timestamp); no reset, rollback, or manual replay is required. Databases at generation 31 run the guarded form. The populated test exercises the real migrator and real protection triggers, including transactional rollback. This is an explicit compatibility plan for the inherited historical-file repair, not permission to alter later applied migrations casually.

## Provider cleanup checkpoint

Persisted provider mismatch regression retains original mode, workspace id and expiry, calls no attach/release/create, and leaves the failed cleanup row discoverable. The additional terminal-expiry regression fails against `56a6b12718832c8a8c2734ed31351827c895029b` (provider error escapes) and passes with this repair: all 20 workspace tests pass. Expired Solari cleanup records `workspace-expired`; unexpired release failures still preserve the cleanup reference for retry. Application typecheck passed. This is local regression evidence; hosted integration remains required.

Checkpoint transport note: `162d030014a42e489638fe568f68475ad63418ae` accidentally contained a truncated decision-log read. `56a6b12718832c8a8c2734ed31351827c895029b` immediately restores the full local copy. No history was rewritten. Subsequent uploads compare the complete local Git tree to the remote tree before advancing the branch.
