# Story 21.3 implementation handoff

Implementation and required verification are complete on the frozen source. No commit, push, deployment, execution runtime or new authority policy was introduced. Parent-owned formal BMAD reviews are underway; review triage and final story/status/evidence publication remain with the parent.

Admin can explicitly install immutable versioned manifests/resources, inspect exact provenance/digests and applicability, author a new version, enable/disable and terminally recall. Scoped Task discovery and selection use the exact current methodology binding and Task epoch, distinguish the actual selector from the accepted Permissions actor, retain history and recover exact immutable receipts with fresh eligibility. Acquired Markdown and a real ZIP remain inert evidence.

Capability projection preserves whole tuples and correlated recipient/classification alternatives across accepted/current hard bounds and delegation. Proven denial is Forbidden; missing acceptance/current policy, unsupported adapters or exhausted work is Unavailable. Current-source qualification is server-owned and loopback-only for fixtures; default production routes have no qualified operation/analysis runtime. Pure techniques remain selectable. A standalone current_use read is not an invocation grant; future invocation must recheck in its actual admission/consumption transaction.

## Review entrypoints

Paths are relative to the repository's `zobba/` workspace:

- Domain/application: `crates/domain/src/skills.rs`, `crates/domain/src/permissions.rs` plus `skills/tests.rs` and `permissions/capability_tests.rs`; `crates/application/src/skills.rs` defines public types and separate Admin/audit ports.
- Transactions/schema: `crates/infrastructure/src/skills.rs`, its six unit tests, transaction-local loaders in `operation.rs` and `methodology.rs`; `migrations/0009_skills.sql`, `schema-v9.catalog`, bootstrap integration and `tests/skills.rs`. Deferred writes finish before the final current method/authority/session/time fence. Policy/session writers serialize under existing locks.
- HTTP/browser: `crates/api/src/skills.rs`, `tests/skills.rs`, `tests/skills_contract.rs`, generated OpenAPI/types; `web/src/{SkillCatalog,TaskSkills,SkillDetails,useSkillInspection,skills}` and integration into Settings/Task views. Private draft and exact-retry ownership stays bound to verified identity/session/scope.
- Verification: `web/tests/skills.test.mjs`, `web/tests/browser/skills.spec.ts`, `README.md`, and root `CLAUDE.md`. Full tracked plus untracked source is represented by the final manifest; new untracked implementation files must be included in review.

## Evidence and limits

All eleven gates passed. Full Rust: 275 passed, 0 failed, 3 parent-spawned helper entrypoints intentionally ignored standalone. Chromium: 115 passed, 0 failed, one worker, zero retries, 16.6 minutes. Web contracts 150; Python 47; fixture 56. Formatting, strict all-target Clippy, Rust/web builds, generated API drift, boundaries and real process smoke passed. Exact commands/cwds/counts/hashes are in `gate-receipts.json`; inspected passing Rust/browser/smoke logs and exit receipts are in `receipts/`. Earlier failing attempts remain private with sanitized dispositions in `verification.md`.

`matrix.md` maps all frozen rows and ACs to actual execution. `integration-contract.md` records public IDs/types/routes, current-use semantics, expiry/freshness, adapter limits, immutable binding/source rules and storage/work/wire limits. Catalogue admission caps 128 versions/2 MiB commands; Task history caps 128 selections/1 MiB full receipts. Capability work caps 256 regions and 65,536 comparisons per need, 1,048,576 per immutable request with scoped memo reuse; exhaustion retains metadata/history with Unavailable. Skill reads alone use 8 MiB; ordinary reads remain 4 MiB. Conservative complete wire envelopes are 6,057,567/3,599,828 bytes for discovery/catalogue.

`source-reconciliation.json` proves the 220-file final source exactly matches the full Chromium start. The full Rust start differs only in the later browser test edits; final TypeScript/API/contracts/build checks cover them. `published-prefixes-1-8.json` verifies all 16 published files byte-identical to 643ed095314d42f576106effd287703824003c73. Five full-run screenshots were opened and inspected, including 390px layouts and truthful opaque archive handling. Publication is restricted to `publication-allowlist.json`; no private failure traces, auth headers or fixture configuration are included.

All owned test listeners stopped. Protected existing development listeners 4310/9443/9445 were preserved. No ordinary technical decisions or implementation gaps remain. The production adapter absence and non-invocation scope are deliberate consumer limitations, not test substitutions for an implemented runtime.
