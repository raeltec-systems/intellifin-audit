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

## Positive authentication checkpoint

The prior marker accepted arbitrary accounts and suffixes. The new exact-account unit regression fails against `8e3389e03de953b88bb9d14ed858b208f6803d7f`; repaired auth/browser/application tests pass (65 in the focused root run; 111 in the combined Northstar/action suite). Failed form submission discards the potentially secret-bearing page with context/browser close fallbacks, retaining provider cleanup identity. Authentication redirects must remain within the selected target, even if another destination is also configured. Real-browser regression adds fresh/valid-existing/stale/unrelated/invalid/wrong-account/suffix/cross-target/failed-submit cases. Local Chromium is unavailable; these browser tests await hosted CI and are not yet accepted.

## Verified repair baseline

`966e4780fa83d1e0c0a6c7b7fbc91a2f66135ab9` is pushed and all CI 34130364168 jobs pass: typecheck/boundaries/unit; PostgreSQL 18 fresh migration, schema drift, 392 integration tests (25 files), including real populated sealed upgrade and 10 real Chromium authentication cases; container build/startup guards; full accessibility and shell browser suite. This is the verified A/B/C repair baseline, not Epic4 acceptance.

This further migration-regression checkpoint replaces placeholder evidence digests with actual synthetic artifact bytes and their SHA-256 digests and verifies those bytes after upgrade and repeat migration. The final-schema migrator still runs unchanged. Its hosted verification is pending. Next: complete4.4 capture and registration plus the4.6 model loop, then durable waits/review and golden/negative journeys.

Remote acceptance blocker confirmed by read-only inspection: no local Solari credential; Railway production worker `84394c42-5018-4cb4-9a7a-707b2ca1fe4a` in project `ade2dc6b-9e91-4ecf-bba8-68638389125d`, environment `1ea4d58f-afab-498f-9dcd-a195e0009026`, has no `SOLARI_API_KEY`. OAuth returns variable names only. Existing Northstar domain is `northstar-production-b312.up.railway.app`; no infrastructure or variables were changed. Model key names exist in production but their values are not available to this checkout. No live-provider acceptance or deployment claimed.

## Story4.4 registration checkpoint (incomplete story)

Identity/value grounding split now refuses the entire Observation batch through the existing registration command. Removing that guard causes the new regression to fail; restoring it passes all81 focused domain/application Observation tests. The13-key wire schema and digest contract remain unchanged. This checkpoint is locally tested; hosted CI and actual capture/worker/persistence/UI journey remain required.4.4 is not complete.

## Story4.4 structural substrate checkpoint (incomplete story)

The web_tree parser, media type and corroboration are implemented for bounded grouped semantic nodes, with controls distinct from data cells. Optional completion metadata requires a producer-specific postcondition; no declared count is inferred from node count. Independent Python golden fixture plus parser/corroboration negatives pass24 focused tests. Domain typecheck/build pass. Desktop remains explicitly unsupported. Capture, persistent work-item execution and inspector wiring are still in progress;4.4 is not accepted.

## Story4.4 artifact storage checkpoint (incomplete story)

Generation33 adds structural-snapshot/screenshot kinds to the existing Evidence storage contract, retaining the existing sealing guards. Each kind has a distinct stable reservation/object key.29 focused artifact/schema-range tests pass; the migration was generated from the schema, with the explicit generation marker and build compatibility range added. The producer is not yet wired, so this checkpoint is not an accepted agent journey. Hosted fresh/populated/drift gates will test this generation.

## Supported-substrate regression correction

CI34132656180 on f3ba33e20e5dcee49623e73aba686ed60ab86e72 passes container and full browser/accessibility gates. Unit and PostgreSQL suites each fail one stale test expecting web_tree to be unsupported. The desktop_tree case now retains unsupported rejection coverage; malformed web_tree explicitly fails corroboration-unavailable without matched identity or attributes. Seven focused application tests pass locally. Hosted verification of this correction is pending; no story acceptance claimed.
