---
title: 'Foundation owner-review repairs before Story 20.5'
type: 'bugfix'
created: '2026-10-01'
status: 'done'
baseline_commit: 'ac47de0204219aafdf85b364be71ec83cd3f8321'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-20-context.md'
---

<frozen-after-approval reason="Owner explicitly authorized this repair batch and verification">

## Intent

**Problem:** The foundation lacks accepted bootstrap admission fixes, permits a stale session response to preserve another account's private workspace, and invokes pnpm's built-in setup instead of the OIDC fixture script.

**Approach:** Selectively integrate `bbf79f36ee022835f95bb006c883a142e8d087da`, bind protected reads to the session being composed, and exercise the corrected documented setup and CI commands.

## Boundaries & Constraints

**Always:** Preserve schema versions 1–3, published migrations/catalog bytes, narrowly permitted runtime writes, durable command semantics and outbox safety. Cookie-derived server identity remains authority; client session expectations only refuse mismatches. Preserve same-account/scope draft and focus during revalidation. Verify with actual PostgreSQL and browser runs, independent review, and coherent evidence.

**Ask First:** New paid services or scope outside these repairs.

**Never:** Merge, deploy, start Story 20.5, rewrite the architecture, blindly replace newer infrastructure with schema-1 files, replay uncertain commands, or mutate shared development data. Do not record credentials.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Current bootstrap | Clean and existing schema 3; schema 1/2 upgrades | Accepted startup, repeatability and exact upgrades remain valid | Existing bounded rollback behavior |
| Role authority | Inherited, SET, ADMIN and mixed membership paths; direct MAINTAIN including newer runtime-writable tables | Unsafe runtime refused; snapshots unchanged | Sanitized refusal |
| Foreign inventory | Accepted foreign catalog families and event triggers | Refuse preflight without mutation | Inventory regressions execute |
| Migration interruption | Trigger installed after migration blocks | Transaction rollback and bounded failure preserved | Full snapshot unchanged |
| Endpoint routing | IPv4, bracketed IPv6, explicit port, PGPORT, default port | Correct real socket target and reconnect behavior | Invalid ports fail without credentials |
| Same-engagement switch | Hold completed auditor-A session response; manager-A signs in another tab; release A | Original tab shows verified manager identity, never re-exposes A draft; no command replay | Bounded fresh-session retry; fail closed if unstable |
| Session replacement | Bound GET uses obsolete session; stale unauthorized response | Refusal without deleting the new valid cookie | Distinct mismatch handling; no auth loop |
| Same-account refresh | Revalidation/session rotation with unchanged actor and scope | Private draft and focus retained after verification | Workspace hidden while identity is uncertain |
| Fixture entrypoint | Fresh and repeated documented pnpm setup; CI fixture tests | Script creates usable isolated fixture, tests pass | No pnpm shell setup side effect |

</frozen-after-approval>

## Code Map

- `zobba/crates/infrastructure/src/lib.rs`, `tests/bootstrap.rs` — port recursive authority, unconditional MAINTAIN denial and catalog inventory from accepted commit; retain schema 3 signature/grants/upgrades. Current interruption fixture needs the accepted late-trigger technique.
- `zobba/web/tests/browser/{runtime,database-endpoint,database-proxy}.ts`, `tests/database-endpoint.test.mjs` — accepted endpoint extraction/socket regressions; keep `DatabaseProxy` re-export required by newer auth runtime.
- `zobba/web/src/{App,auth,engagements,conversation,conversation-state}.ts*` — current independently composed session/list reads permit the race; bind all workspace reads and recovery to a captured session.
- `zobba/crates/{api/src/auth.rs,api/src/engagements.rs,application/src/identity.rs}` and other protected GET handlers/contracts — use a session expectation refusal fence, e.g. HTTP 412 without Set-Cookie. Preserve mutation conflict/CSRF behavior. Generic stale 401 must not expire a newer cookie; explicit logout still expires it.
- `zobba/web/tests/browser/account-binding.spec.ts` — deterministic held-response regression and same-account retention checks.
- `zobba/package.json`, `zobba/README.md`, `.github/workflows/zobba.yml` — replace fixture setup with `pnpm --filter @zobba/oidc-fixture run setup`; verify documented/CI path with isolated fixture output.

## Tasks & Acceptance

**Execution:**
- [x] Infrastructure and browser routing — integrate accepted fixes selectively and run real regressions against isolated restricted test roles.
- [x] API and web session binding — reproduce the owner race before repair, then fix all composed protected reads and prove it in a real browser.
- [x] Package entrypoint and documentation — correct setup, verify fresh/repeat setup and CI fixture command path, document useful gotchas.
- [x] Matrix audit — run every covering test, preserve existing combined checks, and record independent review findings and resolutions.

**Acceptance Criteria:**
- All matrix behaviors have executed evidence, including the actual held completed response reproduction and fixed result.
- The repair checkpoint preserves Stories 20.1–20.4 acceptance and leaves 20.5 unstarted.
- Report independently reviewed source, commands/counts, limitations and pushed foundation SHA; distinguish local CI-equivalent verification from hosted CI.

## Spec Change Log

## Design Notes

The owner authorized execution without routine reconfirmation. This is a repair spec, not a new story; do not regress existing done statuses. If a path differs, use its actual equivalent without expanding intent.

Implementation lead coordinates existing read-only scouts: `owner_schema_repairs` owns infrastructure and endpoint port; `owner_account_race` owns session/API/web and account regression; lead owns package/setup/docs. Delegate those disjoint edits now. Do not commit or push from subagents. Schema tests use the isolated `zobba_patch20_3_test` database with restricted owner/runtime and explicit admin; browser tests use `zobba_story_20_test` and exclusive fixture port 9444. Coordinate leases before destructive tests. Preserve running development services/data.

## Verification

- Source `/workspace/zobba-build-tools/activate.sh` for pinned tools. Use dedicated test URLs; never fall back to development database bindings.
- Run targeted bootstrap/socket, account-binding browser, and isolated setup/fixture checks first; capture the unfixed browser reproduction before changing behavior.
- Combined gates: Rust fmt, Clippy with warnings denied, workspace tests; web typecheck/unit/build; fixture tests; Python boundary/bootstrap/contract guards; contract regeneration drift; smoke and full Chromium browser suite.
- Coordinator performs fresh independent reviews against this spec, then publishes evidence and commits/pushes only the requested foundation branch.

## Completion Evidence

All matrix rows passed, including both migrator configurations and actual browser
negative controls. [Repair checkpoint](zobba-foundation-batch/OWNER-REPAIR-CHECKPOINT.md)
records the 83 Rust, 78 web, 56 browser, 46 fixture and 47 Python results,
independent review, source manifest and retained logs/images. Story 20.5 remains
backlog; no merge, deployment or paid qualification occurred.

## Suggested Review Order

**Session-coherent workspace**

- Share one recovery allowance across scoped access and conversation reads.
  [App.tsx:42](../../zobba/web/src/App.tsx#L42)

- Refuse changed sessions on reads without altering mutation authority or replacement cookies.
  [auth.rs:107](../../zobba/crates/api/src/auth.rs#L107)

**Bootstrap admission**

- Close reachable authority while preserving schema 3 narrow runtime grants.
  [lib.rs:80](../../zobba/crates/infrastructure/src/lib.rs#L80)

- Reject foreign catalog objects before schema inspection or migration.
  [lib.rs:196](../../zobba/crates/infrastructure/src/lib.rs#L196)

**Verification and setup**

- Reproduce the owner race with real cookies and retained uncertain request bytes.
  [account-binding.spec.ts:54](../../zobba/web/tests/browser/account-binding.spec.ts#L54)

- Prove migration and administrative SQL depend on the configured route.
  [auth-database-endpoint.spec.ts:18](../../zobba/web/tests/browser/auth-database-endpoint.spec.ts#L18)

- Preserve real ADMIN capability evidence across supported migrator configurations.
  [bootstrap.rs:661](../../zobba/crates/infrastructure/tests/bootstrap.rs#L661)

- Invoke the package script explicitly rather than pnpm shell setup.
  [package.json:16](../../zobba/package.json#L16)

- Exercise the documented shortcut and isolate fixture output in CI.
  [zobba.yml:90](../../.github/workflows/zobba.yml#L90)
