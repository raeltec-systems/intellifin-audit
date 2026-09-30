---
title: 'Story 20.1 independent review fixes and integration evidence'
type: bugfix
created: '2026-09-30'
status: done
baseline_commit: 9c272c960342313055f053b917841a3cbc3c90f6
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="owner explicitly authorized the four reproduced fixes on a separate branch">

## Intent

**Problem:** Story 20.1 passes its initial tests but admits unsafe database role configurations, direct MAINTAIN grants and foreign collations; its browser proxy misroutes IPv6 and omitted-port PGPORT URLs.

**Approach:** Close all four refusal/endpoint gaps with retained regressions, preserve successful ordinary bootstrap and Pair health behavior, and give Story 20.2 a narrow independently verified patch.

## Boundaries & Constraints

**Always:** Work ONLY in `/workspace/zobba-fixes-20-1` on `codex/zobba-20-1-review-fixes`, based on pinned9c272c960342313055f053b917841a3cbc3c90f6. Use PostgreSQL18 synthetic fixtures and supported pinned tools. Preserve existing successful contracts, secret-safe diagnostics, bounded waits, atomicity and inward boundaries. Record patch evidence here.

**Ask First:** Deployment, paid resources, customer data or external security changes.

**Never:** Touch another worktree, reset/merge/push foundation-batch or Story20.2, contact its engineer, edit shared story/sprint tracking or shared CLAUDE.md, broaden domain schema, deploy, push, or commit (root will commit after verification). The role finding requires unsafe database grants; health endpoints are not an exploit.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected behavior | Error handling |
|---|---|---|---|
| Safe roles | Restricted runtime, including harmless monitoring role | Normal migration/startup/readiness | Ready |
| Mixed authority | runtime SET to bridge, bridge INHERIT dangerous predefined role | Refuse migration/runtime admission and live readiness | unsafe_runtime_role |
| ADMIN authority | runtime ADMIN on migrator without SET/INHERIT | Refuse before it can regrant itself SET | unsafe_runtime_role |
| Direct maintenance | MAINTAIN on either bootstrap table | Refuse migration/runtime admission and live readiness | unsafe_runtime_role |
| Foreign inventory | Collation or other omitted public catalog object before/after bootstrap | Refuse without mutation | schema_mismatch |
| Browser endpoints | Bracketed IPv6; omitted URL port with PGPORT; explicit URL port | Proxy connects to correct TCP target | Bounded clear failure for invalid values |
| Regression | Ordinary bootstrap and real socket loss/recovery | Existing processes and UI recover, keyboard focus retained | Honest unavailable state |

</frozen-after-approval>

## Code Map

- `zobba/crates/infrastructure/src/lib.rs`: `check_effective_role` lines79–98 only computes USAGE/SET reachability from login, checks dangerous predefined names, omits direct MAINTAIN; `inventory` lines115–133 omits collations/operators/conversions/text-search/event triggers. CLI and startup/readiness share these checks. Keep existing signature/ports.
- `zobba/crates/infrastructure/tests/bootstrap.rs`: one serial destructive contract uses shared support guards, exact no-mutation snapshots and fixture admin. Extend existing authority fixtures with mixed-role and ADMIN-only cases; prove actual capability in fixture then refusal. Include live database.check refusal/recovery. Preserve harmless pg_monitor test.
- Existing atomic-interruption fixture creates an event trigger in pg_catalog. If inventory rejects event triggers, adapt interruption proof to still exercise transaction rollback rather than simply changing its expectation to schema_mismatch. A narrowly scoped fixture injection can arrange trigger after preflight via lock coordination, or use another interruption mechanism.
- `zobba/web/tests/browser/runtime.ts:50`: WHATWG hostname retains `[::1]`; hardcoded5432 ignores PGPORT. Extract/test a small shared endpoint resolver; Node24 executes .ts via stripping for node:test if helpful. Keep source boundary checker satisfied.
- `zobba/web/tests/browser/health.spec.ts`, `playwright.config.ts`: owned real PostgreSQL-proxy loss/recovery test. Retain UI behavior; actual browser endpoint runs required. No need alter product React/CSS.
- `zobba/README.md`, browser README: update exact supported/refused behavior if needed; avoid legacy commands.
- This new artifact is the sole patch specification/evidence record. Preserve all other planning/status files.

## Tasks & Acceptance

**Execution:**
- [x] Adapter: fix effective authority, direct MAINTAIN and foreign inventory refusal.
- [x] Database regressions: safe positive, all unsafe fixtures, no mutation, existing live refusal/recovery; strengthen catalog snapshots for new objects.
- [x] Browser endpoint resolution and retained IPv6/PGPORT/precedence/invalid-input cases.
- [x] Documentation and final evidence here; no shared story/sprint/CLAUDE edits.

**Acceptance Criteria:**
- Given each reproduced unsafe fixture, when CLI/runtime checks run, then refusal is explicit and no migration mutation occurs; live readiness refuses then recovers after fixture removal.
- Given supported database endpoints, when the browser harness runs, then actual IPv6 and omitted-port PGPORT socket routes work and recover after database loss.
- Given the pinned workspace, when every prior gate runs, then build/type/lint/guard/database/process/browser checks pass without modifying historical code or Story20.2.

## Spec Change Log

## Design Notes

Remote foundation tip at start still equals the baseline; no newer20.2 remote commit is visible. Adapter/bootstrap tests are likely20.2 overlap. Do not adopt later work. Effective-role authority must handle mixed paths and ADMIN regrant capability; a conservative refusal of unsupported memberships is acceptable if documented, but preserve benign monitoring grants. Inventory should cover public collations/operators/operator families/classes/conversions/text-search objects and event triggers without weakening exact-table or preflight safety.

## Verification

Use `. /workspace/zobba-review-tools/activate.sh` for preserved exact tools and isolated local test cluster variables. Cluster is currently stopped; start only `/workspace/zobba-review-tools/pgdata` with its preserved PostgreSQL18.4 binary, using port55439. Root independently runs all gates; implementation agent may run focused tests sequentially, report completion before root uses the same database. Use separate Cargo output (`CARGO_TARGET_DIR` if needed) and web install within this worktree. No other agent owns files in this worktree.

Commands: cargo fmt/check, strict Clippy, locked cargo test/build, frozen pnpm install/check/build, 44+ Python guards, boundaries, process smoke, owned browser regression, IPv6/PGPORT endpoint regression runs. Parent reviews real screenshots and diffs before committing.


### Implementation evidence — 2026-09-30

Implementation was confined to the pinned fixes worktree. No push, deployment or
shared planning/status/CLAUDE edits occurred. Root commits this patch only after
the independent final gates below. The frontmatter context list was empty.

- `check_effective_role` now takes a recursive conservative closure over INHERIT,
  SET and ADMIN membership options. This covers mixed paths and self-regrant
  authority while retaining the `pg_monitor` positive case. As permitted by the
  design notes, some unusable mixed memberships can be conservatively refused;
  that limitation is documented in the bootstrap README.
- Table authority checks now include direct MAINTAIN. Catalog inventory now
  includes public collations, operators, operator classes/families, conversions,
  text-search configurations/dictionaries/parsers/templates, extended statistics,
  and database event triggers.
- Retained database fixtures prove ADMIN self-regrant inside a rolled-back
  transaction, server-file role inheritance after SET, and actual VACUUM via
  MAINTAIN on each metadata table. New cases assert migration/startup refusal,
  exact no-mutation snapshots, and existing-session readiness refusal/recovery.
  Foreign catalog fixtures exercise empty and installed schemas where applicable;
  extended statistics require installed tables. Snapshot coverage includes these
  catalog objects, public functions/types, event triggers and membership edges.
- Event triggers have a separate foreign-inventory refusal test. The atomicity
  fixture holds a SHARE lock on `pg_class`, waits until preflight has finished and
  migration is blocked on catalog writes, installs its interruption trigger,
  releases the lock, and requires `migration_failed` with identical snapshots.
  This retains an actual transactional interruption proof.
- Browser proxy routing uses a shared endpoint resolver that removes IPv6
  brackets and honors explicit URL port, then PGPORT, then 5432. Invalid effective
  ports produce a fixed diagnostic. Unit cases and actual loopback socket tests
  cover IPv4, IPv6, port precedence, omitted-port PGPORT and invalid values.

Focused verification, using the preserved exact tools and isolated PostgreSQL
18.4 cluster on port 55439 (IPv4 and IPv6 listeners):

- `cargo fmt --all` — completed.
- `cargo test --locked -p zobba-infrastructure --test bootstrap` — **3 passed**;
  latest run 21.44 seconds, including retained bounded-lock/blackhole tests.
- `node --test web/tests/database-endpoint.test.mjs` — **3 passed**, including
  actual TCP connections on both loopback families.

The test schema was left empty and the database handed back for root's independent
full gates, process admission tests and actual browser IPv6/PGPORT runs. Those
results and final screenshot review are recorded below; focused adapter/socket
results alone did not establish complete acceptance.

### Review hardening follow-up

- Interruption-fixture connection and catalog-lock acquisition have explicit
  five-second outer bounds and use the adapter's statement/lock timeouts.
  Coordination now matches the current database, migrator identity and a unique
  per-process `application_name` through `pg_stat_activity`/`pg_locks`.
- Membership snapshots follow only configured runtime/migrator and generated
  fixture-role authority paths. They no longer snapshot unrelated cluster-wide
  membership rows. Catalog snapshots also retain text-search mapping and operator
  family operator/procedure dependency rows.
- The browser harness imports the extracted `DatabaseProxy`; retained tests run
  that same class against actual IPv4/IPv6 sockets, verify explicit-port versus
  environment PGPORT routing, disconnect existing sockets, reject new connections
  while disabled, and reconnect after restore. A separate test sets/restores the
  actual PGPORT environment variable and invokes the resolver's default argument.
  Node's erasable TypeScript execution requires no build or parameter properties.
- Latest focused Node endpoint suite: **5 passed**.


## Final independent verification and owner recommendation

**All four reviewed defects are fixed; recommend accepting this isolated patch.**
The original Story 20.1 specification and sprint status are deliberately unchanged.
Root independently ran the final source with Rust 1.98.1, Node 24.20.0,
pnpm 11.25.0 and isolated PostgreSQL 18.4 (restricted migrator/runtime roles).

| Final check | Result |
|---|---|
| Frozen web installation | Passed; lockfiles unchanged |
| Rust formatting; strict workspace/all-target Clippy | Passed |
| Locked Rust workspace tests | 7 passed; expanded real PostgreSQL contract included |
| Locked Rust workspace build | Passed |
| Generated OpenAPI/types, strict TypeScript and web tests | Passed; 7 web tests |
| Production Pair web build | Passed |
| Python guard regressions | 44 passed |
| Dependency boundaries | Passed |
| Process smoke | Passed: repeated migration, refusal, exact health, socket loss, same-process recovery and secret-safe telemetry |
| Real browser: explicit IPv4 endpoint | 1 passed |
| Real browser: explicit IPv6 endpoint | 1 passed |
| Real browser: portless endpoint with nondefault PGPORT | 1 passed |
| Additional independent CLI/API/worker admission probes | All six scenarios passed |
| Source whitespace | Passed |

The additional probes used a separate synthetic database and the built binaries.
Foreign collation before bootstrap refused CLI/API/worker startup without mutation.
For mixed SET/INHERIT, ADMIN-only migrator membership, MAINTAIN on each bootstrap
table, and foreign collation after bootstrap, CLI/startup refused; already-running
API and worker returned 503 and then recovered to 200 after removal, with unchanged
PIDs. Snapshot comparisons established no migration mutation. These unsafe grants
are configuration prerequisites, not exploits through health endpoints.

The root also exercised stalled/rejected HTTP responses against the real shell:
failed checks re-enabled retry after approximately 8.4 seconds and keyboard retry
recovered Ready. These supplemental UI checks preceded the test-only proxy
extraction; the three actual browser gates above were rerun after extraction.

Three independent review lenses inspected the patch. Their actionable test
robustness findings were corrected: bounded/identified interruption coordination,
scoped membership snapshots, dependent catalog records, and actual proxy/env
regressions. Read-only recheck reported no unresolved findings. The existing
atomic-interruption proof still injects failure after preflight and proves rollback;
it was not replaced by a preflight-refusal assertion.

### Actual rendered evidence

The final PGPORT browser run supplied these retained screenshots. Root inspected
all three: loaded Pair assets/font, readable desktop/mobile layout, truthful
Unavailable state and visible retained keyboard focus. The automated browser
checks also cover page identity, no overlay/unexpected errors and no horizontal
overflow at 390px and 320px. Product React/CSS was unchanged.

- [Ready desktop](zobba-20-1-review-fixes-2026-09-30/ready-desktop.png)
- [Unavailable desktop](zobba-20-1-review-fixes-2026-09-30/unavailable-desktop.png)
- [Recovered mobile](zobba-20-1-review-fixes-2026-09-30/restored-mobile.png)

## Integration handoff for Story 20.2

Branch: `codex/zobba-20-1-review-fixes`.
Base: `9c272c960342313055f053b917841a3cbc3c90f6`.
Initial fetch and final remote checks found foundation-batch still at that base;
no published Story 20.2 branch was visible. Unpushed 20.2 changes could not be
assessed. No other worktree, shared tracking, foundation branch or 20.2 engineer
was changed/contacted; nothing was pushed, merged or deployed.

Integrate the isolated commit only from the 20.2 engineer's clean integration
worktree. Expect overlap in `crates/infrastructure/src/lib.rs`, its bootstrap tests
and the two READMEs. Preserve 20.2's migration-prefix/new-schema work and explicitly
port the membership closure, MAINTAIN refusal on bootstrap metadata and foreign
object checks; do not overwrite whole files with this older bootstrap baseline.
20.2's intentionally authorized domain writes/tables need its own scoped policy,
without reopening metadata writes or privileged role paths. The browser changes
are test-harness-only and add two small shared modules plus endpoint/proxy tests.
Run both this patch's regressions and 20.2's full schema/authentication tests on the
combined tree before considering integration complete.

No migrations, production UI, Cargo/pnpm dependencies or generated contracts
changed. Hosted CI, remote TLS, other PostgreSQL versions, deployment and combined
Story 20.2 behavior remain unverified. Conservative role closure deliberately
refuses some unusable membership combinations, as documented in the README.

## Suggested Review Order

- Close reachable authority and reject direct bootstrap maintenance privileges.
  [lib.rs:70](../../zobba/crates/infrastructure/src/lib.rs#L70)
- Refuse foreign catalog objects before migration or runtime admission.
  [lib.rs:119](../../zobba/crates/infrastructure/src/lib.rs#L119)
- Check real browser proxy endpoint routing and connection lifecycle.
  [database-proxy.ts:25](../../zobba/web/tests/browser/database-proxy.ts#L25)
- Inspect no-mutation, authority, catalog and interruption regressions.
  [bootstrap.rs:16](../../zobba/crates/infrastructure/tests/bootstrap.rs#L16)
- Verify environment fallback and actual IPv4/IPv6 proxy failures/recovery.
  [database-endpoint.test.mjs:1](../../zobba/web/tests/database-endpoint.test.mjs#L1)
