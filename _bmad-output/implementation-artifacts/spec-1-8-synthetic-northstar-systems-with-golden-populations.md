---
title: 'Story 1.8: Synthetic Northstar systems seeded with golden populations'
type: 'feature'
created: '2026-09-02'
status: 'done'
baseline_revision: '0ee0bc1'
baseline_commit: '0ee0bc1'
review_loop_iteration: 1
followup_review_recommended: false
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/CLAUDE.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
deferred: []
---

<intent-contract>

## Intent

**Problem:** Every later epic needs something real to audit. Without the synthetic Northstar systems there is nothing for a Procedure to bind to, nothing for an agent to read, and no seeded case against which a Run's outcome can be judged — so Epic 2 would author Procedures against systems that do not exist and Epic 3 would execute against nothing.

**Approach:** One workspace application serving every synthetic Northstar system — the web surfaces, the read-only APIs with their count endpoints, and the versioned files with signed cover sheets — plus the golden datasets and their expected terminal outcomes as versioned data files that no rule implementation can reach. The worker gains the probe entry point Story 1.6 deferred to here.

## Boundaries & Constraints

**Always:**
- Every system is READ-ONLY at the system level. Any method but `GET` or `HEAD` on any route answers an explicit denial that names the rule, so FR-3 is enforced by the system as well as by the registration allowlist. A denial is a refusal a Run can record, never a silent 404.
- Every dataset carries a synthetic marker, and a test asserts it on EVERY dataset (NFR-13). No production data, no personal data, no real name that resolves to a person, no real domain: every origin is `.synthetic.invalid` or a loopback port.
- Golden datasets, expected terminal outcomes and confirmation scripts are versioned DATA files, separate from any rule implementation (AD-12). Nothing that evaluates a rule may import them, and nothing that produces a Result may be the thing that declares what the Result should be.
- Every declared count is generated independently of anything this product will later use to count: a cover sheet or a count endpoint is written by the fixture generator from the dataset itself, and the Evidence Quality Gate reconciles against it.
- The addendum §D case list is delivered in full for the hero Procedure (P-1) and named case-by-case for the other three, each case carrying its expected TERMINAL outcome.
- Hero-Procedure golden populations stay at or below 20 records, so a live Run is observable.
- The worker invokes the probe as its OWN entry point through `@intellifin/infrastructure/probe`, the way the release migrator is invoked. It never imports the probe into the heartbeat bundle; `pnpm boundaries` already fails on that.
- Identifiers are strings and preserve leading zeros; timestamps are ISO 8601 normalized to UTC with the original offset retained; money is a decimal amount plus an ISO 4217 currency (addendum §B).

**Block If:**
- Delivering this requires creating or modifying a Railway project, service or secret. Declare the shape and stop — that is the user's call, not ours.
- Delivering this requires a new build orchestrator, or a dependency major bump.

**Never:**
- No Adapter, no acquisition, no parsing, no agent. Nothing in this story reads a population into the product; it only makes one exist to be read.
- No Procedure, Procedure Version, Template contract or plan. Epic 2 owns those. The golden datasets are data this story seeds; the Template that names them is authored later.
- No evaluation, no Gate, no Result. This story declares what a Run's outcome SHOULD be; nothing here computes one.
- No LedgerDesk desktop application. The addendum marks its platform an open question, and a desktop sandbox is not in this epic. Named as deferred, with the reason, rather than half-built.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Web surface | `GET` LoanCore account page for a seeded employee | The page renders Status, Username, Roles, Employee ID | A missing employee renders a "not found" page, never a 500 |
| Write attempt | `POST`/`PUT`/`PATCH`/`DELETE` on any route of any system | Explicit denial naming the read-only rule | 405, with a body a Run can record |
| Read-only API | `GET` AccessGate accounts | Synthetic records, JSON, deterministic order | Order is stable across calls; a Run must be reproducible |
| Count endpoint | `GET` the count endpoint of any API source | The declared count, generated from the dataset | Reconcilable by the Gate against the rows returned |
| Cover sheet | `GET` the Leavers export cover sheet | Row count and digest of the file it covers | The digest is over the bytes actually served |
| Config page | `GET` the ProdConsole page | Parameter values, a signed snapshot identifier and an expected parameter count | Both must be extractable from the rendered page |
| Injection case | A seeded prompt-like string in a cell or page | Served verbatim as DATA | Never interpreted, never escaped away — the case exists to be met |
| Synthetic marker | Any dataset file | Carries the marker | A dataset without one fails the suite |
| Probe | The worker's probe entry point runs | One `target_system_probe` row per registration, reachable or unreachable | An unregistered id is discarded, not an error |
| Probe from web | Anything under `apps/web` importing the probe | `pnpm boundaries` fails | Already enforced; a case exists |

</intent-contract>

## Code Map

- `packages/infrastructure/src/registrations/probe.ts` — `recordProbe`, written in Story 1.6 and not yet called. One `INSERT ... SELECT ... WHERE EXISTS`; a probe for a registration that no longer exists returns `false`.
- `packages/infrastructure/package.json` — the `./probe` subpath, and `./migrate` as the precedent for an entry point invoked on its own.
- `apps/worker/src/main.ts` — the heartbeat composition root. The probe is a SIBLING entry point, not a branch inside this one.
- `.dependency-cruiser.cjs` — `no-target-system-probe-in-apps` fires for `src` and, since the Story 1.6 review, for `dist` too.
- `scripts/seed-identity.mts` — the precedent for an operator script: built output, no secret in an argument, run by hand.
- `tests/fixtures/` — where `audit-chain-golden.json` and the two digest vectors live. Golden DATASETS are mirrored here from their source, per AD-12.
- `tests/e2e/accounts.ts` — `assertThrowawayDatabase`, the guard any script that writes to a database must use.

## Tasks & Acceptance

**Execution:**
- `apps/northstar/` — one workspace application serving every synthetic system on its own path prefix: LoanCore (web), ProdConsole (web), AccessGate / ApproveNow / PeopleHub (read-only JSON APIs with count endpoints), and the Leavers export, RoleMatrix and ConfigRegistry files with their signed cover sheets. One process, one port, deterministic responses, no database.
- A single read-only middleware in that application: any method but `GET`/`HEAD` answers 405 with an explicit denial. It is applied once, at the top, so a route added later cannot forget it — and a test asserts the denial on EVERY registered route rather than on a sample.
- `fixtures/northstar/datasets/*.json` — the golden populations, one file per source, each carrying the synthetic marker and the addendum §B identifier and timestamp rules.
- `fixtures/northstar/expectations/*.json` — expected terminal outcomes and the confirmation scripts, versioned separately, importable by nothing that evaluates.
- `fixtures/northstar/generate.ts` (or a `uv`-run Python script, matching the golden-vector precedent) — writes the cover sheets and count declarations FROM the datasets, so a declared count is never typed by hand next to the rows it counts.
- `apps/northstar/src/*.test.ts` — the read-only denial on every route, the deterministic order, and the count reconciliation.
- `tests/unit/synthetic-marker.test.ts` — walks every dataset and expectation file and fails on one without the marker (NFR-13).
- `apps/worker/src/probe.ts` — the probe entry point: read the active registrations, attempt a bounded read of each allowlisted origin, write one row through `recordProbe`. Its own `pnpm --filter @intellifin/worker probe` script, invoked like the migrator, never on the heartbeat path.
- `scripts/seed-northstar.mts` — registers the synthetic systems as Target Systems and their sources as Population Source bindings, through the Story 1.6 and 1.7 commands, so the seeded rows are audited exactly like a human's would be.
- `tests/e2e/northstar.spec.ts` — the registrations appear with a digest, the probe writes connectivity the surface then reads, and the connectivity column stops saying "Never probed".
- `CLAUDE.md` — record the fixtures layout, the read-only middleware rule, and the probe entry point.

**Acceptance Criteria:**
- Given the synthetic environment, when it starts, then LoanCore, ProdConsole, AccessGate, ApproveNow, PeopleHub and the three file sources are reachable at allowlisted origins.
- Given any system, when a write action is attempted with the audit credential, then it is refused at the system level with an explicit denial.
- Given the fixtures, when they are seeded, then each Template's golden dataset from addendum §D exists in the relevant system, with declared counts generated independently.
- Given any fixture, when it is inspected, then it contains no production or personal data, and a test asserts the synthetic marker on every dataset.
- Given expected outcomes and confirmation scripts, when they are read, then they are versioned data files that no rule implementation imports.
- Given a registration whose origin is a running Northstar system, when the worker's probe entry point runs, then `target_system_probe` holds one row for it and the Administration surface shows the connectivity instead of "Never probed".

## Spec Change Log

## Review Triage Log

Two review passes: the synthetic systems and their fixtures, and the probe, the seeding
path and the boundaries. **5 BLOCKER, 9 SHOULD, 9 CONSIDER.**

### Blockers

1. **The entry-point guard was disarmed by a symlink — including the RELEASE MIGRATOR.**
   `process.argv[1] === fileURLToPath(import.meta.url)` compares the path as INVOKED with
   the path as RESOLVED. Through a symlink they differ, and pnpm's `node_modules` is
   symlinks, as is any `--prod deploy` tree: the module loads, does nothing, and exits 0.
   For `db/migrate.ts` that is a release reporting success against an unmigrated database,
   after which every process refuses to start on a schema range it does not have. Both
   entry points use `import.meta.main` now, and `entry-point.test.ts` runs a real file
   through a real symlink rather than asserting against a mock.

2. **The probe sweep read the surface's paged list.** Capped at 200 and including retired
   rows — right for a screen, wrong for a job. With enough retired registrations ahead of
   them, every live system fell off the end: the sweep probed nothing, exited 0, and the
   surface went on saying "Never probed". The sweep has its own read now, active-only and
   unpaged.

3. **The probe never released the response body**, so the timeout bounded the fetch and
   not the process: a target that answers and then holds its body kept the sweep alive
   105 seconds past its own completion log, and indefinitely against a server that never
   closes. `controller.abort()` in the `finally`.

4. **The synthetic-marker test walked three hard-coded folders**, so NFR-13 was enforced
   over a list rather than over the fixtures. A planted fourth folder with a real bank
   domain, an email address and an account-shaped number left all 98 cases green.

5. **Addendum §D's ambiguous-role case could not fail** — the account was Active, so C1
   made the record an Exception whichever way C2 went, and C2 is the case.

### The SHOULDs taken

- `telemetry.info(message, fields?: unknown)` let any caller write an undocumented field
  that `sanitizeTelemetryFields` then dropped SILENTLY. It had already happened twice. The
  parameter is typed now: the allowlist is the runtime guard, the type is the compile-time
  one.
- Re-running the seed script with a different base URL printed "seeded … against <the new
  URL>" while every row still named the old one. It now says exactly which origin the row
  has and why it was left alone — an origin is digest-bearing, so repointing it mints a
  platform-authored draft for every Procedure that froze it, and that is a decision, not a
  side effect of running a script twice.
- The two P-1 bindings are alternatives, not interchangeable: the 24-hour boundary needs a
  termination TIME that only PeopleHub carries, and the duplicate-key case exists only in
  the export. Both expectations say so.
- P-2, P-3 and P-4's stale-population case described a reconciliation that reconciles
  exactly, without the "NAMED, NOT SEEDED AS DATA" label its siblings carry.
- `ARTIFACTS` stored a `file` beside a key that must equal it, asserted by nothing.

### Deferred, with reasons

- **No scheduled sweep.** `.railway/railway.ts` schedules nothing and `pnpm --filter
  @intellifin/worker probe` does not run inside the worker image. Both need a Railway
  resource, which is the user's call, and the sweep has no consumer until a surface shows
  staleness (Story 9.2, diagnostics). The entry point exists and is proven end to end.
- **A transitive reach into a `dist` barrel is invisible to dependency-cruiser.** `dist`
  is in `doNotFollow`, so a module inside it is rule-checked but not traversed. Every
  direct spelling fires, including the `dist` path itself; closing the transitive case
  means following built output, which is a boundary-tooling decision of its own.
- **`defaultFetcher` is unexported**, so the test that describes it asserts a fake. Its
  real behaviour was verified by observation during review — GET only, no credentials,
  redirect not followed, loop safe. Exporting it for a test would widen the module's
  surface to make a claim the review already checked.

### Rejected

- Nothing.

## Design Notes

**One application, not six services.** The addendum describes six systems; deploying six is a Railway decision this story is not permitted to take, and six processes make the browser suite six times as fragile for no gain. One process serving six path-prefixed surfaces is the same thing from the registration's point of view — each gets its own allowlisted origin — and it is one thing to start in CI.

**The read-only rule is middleware, not a convention.** Applied once at the top of the application, so a route added by a later story is refused a write without anybody remembering. The test asserts it over the ROUTE TABLE rather than over a list of paths somebody typed, because a test that names its own sample cannot notice the route that was added without one.

**A declared count is generated, never typed.** The whole point of an independently declared count is that it did not come from the thing being counted at Run time. It also must not come from a human typing a number next to the rows: that number is wrong the first time somebody edits the dataset, and a Gate reconciling against a stale declaration reports a truncation that never happened. The generator writes both.

**The injection cases are served verbatim.** A prompt-like string in a cell is the case, so escaping it away at the fixture would delete the test. It is data, it is served as data, and the product's job — later — is to treat it as data.

**`[DEFERRED]` LedgerDesk.** The desktop Target System's platform is an open question in the addendum and needs a desktop sandbox nothing in this epic provides. Named here so Epic 3 picks it up deliberately.

**`[DEFERRED]` Railway deployment of the Northstar service.** Creating a Railway service is explicitly the user's call. `.railway/railway.ts` gains no resource in this story; the shape is described in the pull request instead, and the systems run locally and in CI.

## Verification

**Commands:**
- `pnpm typecheck`, `pnpm boundaries`, `pnpm test` — clean.
- `pnpm build && pnpm --filter @intellifin/web build` — both succeed.
- `pnpm test:integration` twice, `pnpm test:e2e` twice.
- The probe entry point run by hand against a running Northstar service and a migrated database, then the Administration surface read.
