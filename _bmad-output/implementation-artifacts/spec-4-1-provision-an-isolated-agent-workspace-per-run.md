---
title: 'Story 4.1: Provision an isolated Agent Workspace per Run'
type: 'feature'
created: '2026-09-06'
status: 'ready-for-dev'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-browser-provider-decision.md'
  - '{project-root}/docs/contracts/executable-plan-v1.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Every later story in this epic runs inside a workspace that does not exist. There
is no browser, no place to sign in, no boundary around what a Run may reach, and nothing that
guarantees one Run cannot see another's session. Epic 3 refuses an agent-driven Target System
BY NAME at the execution stage; this is the first half of removing that refusal.

**Approach:** Add the application-owned `BrowserExecution` port and provision one workspace per
Run that needs one, bound to that Run for its lifetime, confined to the Procedure Version's
frozen allowed origins, released at the Run's end, and reaped by a sweep if anything is left
behind. The provider is Solari, driven through the Playwright client API; a local browser is
the same code path for tests.

## Boundaries & Constraints

**Always:** A workspace exists ONLY for a Run whose frozen plan has an agent-driven Session
Step (AD-4) — an adapter-only Run provisions nothing and is unchanged by this story. The
workspace is created at the Run's first agent Session Step, bound to that Run, and its identity
(the provider session identifier) is carried on the durable checkpoint so a restarted worker
finds it rather than making a second one. Egress is confined to the Version's frozen allowed
origins by request interception; every other destination is DENIED before it leaves and the
denial is recorded as a security event. Workspace creation that fails after bounded retries is
a Session Step exhaustion, which §E makes `RUN_FAILED`. The workspace is released on every
terminal transition, and a periodic sweep reaps any workspace whose Run is already terminal or
absent and revokes its credentials (NFR-5). `attach(WorkspaceRef)` and `release` are
conformance requirements of the port (AD-16), because a Run that resumes after a wait must
reattach to the workspace it left rather than sign in again. The port is implemented once,
against the Playwright client API; whether it drives a Solari session or a local browser is a
composition-root choice and never a second implementation.

**Block If:** The Solari SDK cannot be reached from this environment AND the local mode cannot
stand in for it well enough to verify the story's own acceptance criteria. Say so rather than
weakening a criterion.

**Never:** Do not implement sign-in, credentials, navigation, capture, Observations or
Escalations — those are Stories 4.2 to 4.7. Do not let the provider SDK become reachable from
`apps/web` (AD-10). Do not put a credential, a session token or a provider endpoint into a
checkpoint, an audit payload, a Timeline event, a log field or an error message. Do not enable
the provider's proxy or stealth escalation: an escalation ladder that swaps egress mid-session
is the opposite of confining a Run to its frozen origins. Do not claim process isolation the
local mode does not have.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Agent Run | A plan with an agent-driven Session Step | One workspace, bound to the Run, identity on the checkpoint | — |
| Adapter-only Run | No agent-driven Step | No workspace provisioned at all | Unchanged from Epic 3 |
| Restart mid-Run | Worker dies holding a workspace | The resumed claim reattaches by the stored identity | Never a second workspace |
| Reattach impossible | The workspace is gone | Recorded, and the Run re-signs in under the Session Step budget (4.2) | Exhaustion is `RUN_FAILED` |
| Allowed origin | A request inside the frozen origins | Permitted | — |
| Any other destination | A request outside them | Denied before it leaves, security event recorded | Never silently dropped |
| Creation fails | Provider unavailable after bounded retries | Session Step exhausted → `RUN_FAILED` | Distinguish a plan refusal from an outage |
| Terminal transition | A Run reaches any terminal state | Workspace released, credentials revoked | Idempotent |
| Orphan | A workspace whose Run is terminal or absent | Reaped by the sweep, credentials revoked | Bounded page per tick |
| Two Runs at once | Two agent Runs overlapping | Neither can see the other's session or storage | Proven by a negative test |

</intent-contract>

## Code Map

- `packages/application/src/runs/execution-ports.ts` — where `BrowserExecution` belongs, beside
  the adapter ports. `packages/application` has NO host types (`lib: ["ES2024"]`, no
  `@types/node`) — that absence is the compiler-enforced half of AD-11 — so the port is
  structural: no `Page`, no `Browser`, no provider type crosses it.
- `packages/infrastructure/src/runs/` — the implementation, beside `adapter-extraction-http.ts`
  and `credential-resolver.ts`. It needs its OWN subpath export (`./browser`) and a
  dependency-cruiser rule `no-browser-execution-in-web` in `.dependency-cruiser.cjs`, matching
  `^packages/infrastructure/(src|dist)/runs/browser` from `^apps/web/`, with BOTH spellings
  planted in `tests/unit/boundaries.test.ts`. A new subpath needs an alias in
  `vitest.config.ts` AND `tests/integration/vitest.config.ts` or it resolves to an unbuilt
  `dist`.
- `packages/infrastructure/src/config.ts` — `SOLARI_API_KEY` is read here and nowhere else, the
  way `CREDENTIAL_TOKENS` and `EXCEPTION_FINGERPRINT_KEY` are. Absent, the local mode is used
  and the composition root says so once, by name, in a log line whose message and fields are in
  the telemetry allowlist.
- `apps/worker/src/startup.ts` and `main.ts` — `populationExecution(config)` and
  `adapterExtraction(config)` are the shape to copy: return enabled-with-config or
  disabled-with-a-reason, and let `main.ts` branch. **A worker duty that cannot run must not
  stop the duties that can** — that lesson cost a crashlooping deployment once already.
- `packages/application/src/runs/execute-adapter-steps.ts` — `classifyPlanTargets` already
  refuses `web`/`desktop` by name. This story does NOT remove that refusal; it provisions the
  workspace the later stories need. Say clearly in the code where 4.2 takes over.
- `packages/infrastructure/src/runs/adapter-execution-repository.ts` and the checkpoint in
  `execution-ports.ts` — the workspace identity is a checkpoint field, so a migration adds a
  column. Raise `SUPPORTED_SCHEMA_MIN`/`MAX` together, hand-append the `schema_meta` insert, and
  list any new table in `tests/integration/schema-compat.test.ts`.
- `packages/infrastructure/src/registrations/probe-runner.ts` and
  `packages/infrastructure/src/runs/evidence-integrity-sweep.ts` — the two existing bounded
  sweeps. The workspace reaper is a third of exactly that shape: its OWN read, a bounded page
  per tick, and a stop that lets the active item finish and starts none of the rest.
- `packages/domain/src/runs/execution.ts` — `classifyPlanTargets` is where "this Run needs a
  workspace" is decided, from bytes the Version already froze. It is a pure function of the
  plan; do not add a stored flag.

## Tasks & Acceptance

**Execution:**
- `packages/application/src/runs/execution-ports.ts` — `BrowserExecution` with `create`,
  `attach`, `release`, and the egress policy as an input rather than a setting the
  implementation chooses. Structural types only.
- `packages/infrastructure/src/runs/browser-execution.ts` (new, outside every barrel) — one
  implementation over the Playwright client API, connecting to a Solari session or launching
  locally. Request interception enforces the frozen origins and reports each denial.
- `packages/infrastructure/src/runs/workspace-reaper.ts` (new) — the bounded sweep.
- `packages/infrastructure/` migration — the workspace identity on the checkpoint, plus
  `db/compat.ts` and `tests/integration/schema-compat.test.ts`.
- `apps/worker/` — compose it, branch on availability, log the reason once.
- `.dependency-cruiser.cjs` and `tests/unit/boundaries.test.ts` — the web rule, both spellings.
- Tests — domain tests for "does this Run need a workspace"; application tests for the
  lifecycle and the reattach; integration tests against real PostgreSQL for the checkpoint and
  the reaper; a browser-level test that two concurrent Runs cannot see each other's state; and
  a negative test that a workspace outlives no Run.

**Acceptance Criteria:**
- Given a Run whose plan has an agent-driven Step, when the worker starts it, then exactly one
  workspace is created, bound to that Run, its identity is on the checkpoint, and it is
  released at the Run's end.
- Given an adapter-only Run, when it executes, then no workspace is provisioned at all.
- Given a request to any destination outside the Version's frozen allowed origins, when the
  workspace makes it, then it is denied before it leaves and the denial is a security event.
- Given a worker that dies holding a workspace, when the Run is resumed, then it reattaches by
  the stored identity rather than creating a second one.
- Given workspace creation that fails after bounded retries, when the Session Step exhausts,
  then the Run is `RUN_FAILED`.
- Given a workspace whose Run is terminal or absent, when the sweep runs, then it is released
  and its credentials revoked.
- Given two agent Runs at once, when both are executing, then neither can see the other's
  session, storage or cache, and a negative test proves it.

## Spec Change Log

## Review Triage Log

## Design Notes

**Solari is the provider and Playwright is how you drive it.** They were briefly recorded here
as alternatives; they are not. A session hands back a wire-protocol endpoint and the client
connects to it, so the driving code is identical whether the browser is Solari's or local. That
is what makes "the provider can be replaced without redefining what an Audit Run means" true
rather than aspirational — and it is why there must be ONE implementation, with the connection
as a composition-root choice. Two implementations would be two answers to one question.

**The isolation claim must be stated at the strength it actually has.** The acceptance text
says no state, credential or session crosses between Runs. Under Solari that is a separate
managed browser with its own egress. Under the local mode it is a browser context: browser
state is isolated, the worker process is NOT, and egress is policed inside the browser rather
than at the network. Both are in the decision document as a table. Write the weaker one down
wherever the guarantee is claimed rather than letting the stronger sentence cover both.

**The egress allowlist is the Version's frozen origins, and nothing widens it.** Not an
instruction, not a redirect the site chose, not a provider feature. The provider's `proxy:
"smart"` escalation ladder swaps egress mid-session when it detects a block page — exactly the
behaviour a Run must not have — so it stays off, and the reason is written beside the switch
rather than left as an omission.

**A denial is a security event, not a dropped request.** Epic 3 learned this the expensive way:
a refusal reported as a transport failure was retried three times against a system that would
go on refusing, and the only durable record that the platform had been told no was a transport
count. A denied destination here is `security.action-denied` with the destination recorded and
the credential nowhere near it.

**The reaper is a third sweep of an existing shape, not a new pattern.** Its own read, bounded
per tick, stopping cleanly. A background job must not borrow a surface's read — that lesson
already cost a probe sweep that probed nothing while exiting successfully.

## Verification

**Commands:**
- `pnpm typecheck`, `pnpm boundaries`, `pnpm test` (alone) — expected: pass.
- `pnpm db:migrate` then `pnpm test:integration` — expected: the new generation applied, all
  pass against PostgreSQL 18 on a `test`- or `ci`-named database.
- `pnpm db:generate` — expected: no drift.
- `pnpm build`, `pnpm --filter @intellifin/web build`, `pnpm test:e2e` — expected: pass, no
  accessibility violations.

## Auto Run Result

**Delivered 2026-09-06, on `codex/epic-4-agent-runs`. Not committed.**

### What was built

- `workspaceRequirement(plan)` in `packages/domain/src/runs/execution.ts` — a pure function
  of the frozen plan, beside `classifyPlanTargets`. No stored flag.
- `BrowserExecution`, `WorkspaceRef`, `WorkspaceEgressPolicy`, `WorkspaceDenial`,
  `WorkspaceHandle`, `WorkspaceCheckpoint` and the repository port in
  `packages/application/src/runs/execution-ports.ts`. Structural types only.
- `provisionWorkspace` and `releaseWorkspace` in
  `packages/application/src/runs/provision-workspace.ts`.
- `PlaywrightBrowserExecution` in `packages/infrastructure/src/runs/browser-execution.ts`
  (subpath `./browser`, outside every barrel), plus `origin-policy.ts` — the one home of
  `withinOrigin`, which `adapter-extraction-http.ts` now re-exports.
- `PostgresWorkspaceRepository` and `startWorkspaceReaper`.
- Generation 27: `run_workspace`, `SUPPORTED_SCHEMA_MIN`/`MAX` = 27, listed in
  `schema-compat.test.ts`.
- `agentWorkspace(config)` in the worker's `startup.ts`; composed in `main.ts` with the
  reaper outside the storage branch and `closeBrowsers` in the shutdown path.
- `no-browser-execution-in-web` in `.dependency-cruiser.cjs`, both spellings planted;
  `playwright`, `playwright-core`, `@playwright/test` and `patchright-core` added to the
  forbidden vendor list, with a planted case each for application and domain.
- `docs/contracts/agent-workspace-v1.md`, and a Story 4.1 section in `CLAUDE.md`.
- The Run Detail Timeline renders the workspace row and its Step Execution. Without it the
  `create-workspace` attempt would be a `run_step_execution` row nothing on the page shows.

### Decisions taken here

- **`run_workspace` cascades from `audit_run`.** Ten existing teardowns delete `audit_run`
  without knowing the table exists; a foreign key nobody knew about does not fail its own
  suite, it leaves rows behind and fails an unrelated one later on a count. The four tables
  that require an explicit delete record an OUTCOME; a workspace row is operational state,
  and removing a whole Run takes it along — the reading that already makes `run_exception`
  cascade from `run_observation`. Nothing requires a workspace row the way generations 21
  and 25 require a package and a Result, so the cascade breaks no invariant.
- **The Solari path uses `sessions.create()` + `chromium.connect()`, not `solari.launch()`.**
  `launch()` returns a `BrowserSession` typed against the SDK's bundled `patchright-core`,
  which does not assign to `playwright-core`'s types; the two modes would then hold two
  `Browser` types and need either a second code path or an `as`. `Session` is four strings,
  so nothing typed against the fork crosses the module. `launch()`'s health probe is not
  lost: `newContext` plus two route installations are three protocol round trips.
- **An unrecognised `SolariErrorCode` is TERMINAL (`refused`).** The type is widened with
  `| string`; calling an unknown reason transient would retry it four times on the strength
  of not knowing what it is.
- **The egress allowlist is the `web` Targets' origins only.** A `desktop` registration's
  application identity occupies the same envelope slot and is not a URL. A desktop-only
  plan gets an empty allowlist, under which everything is denied.

### Verification, all run here

| Command | Result |
|---|---|
| `pnpm typecheck` | pass (7 projects + `tsconfig.root-tests.json`) |
| `pnpm boundaries` | pass, 414 modules cruised, no violations |
| `pnpm test` (alone) | **2784 passed**, 120 files (baseline 2730) |
| `pnpm db:migrate` | generation 27 applied to PostgreSQL 18 |
| `pnpm test:integration` | **350 passed**, 22 files (baseline 338) |
| `pnpm db:generate` | "No schema changes, nothing to migrate" |
| `pnpm build` | pass |
| `pnpm --filter @intellifin/web build` | pass |
| `pnpm test:e2e` | **124 passed**, 0 failed, no accessibility violations |

Every new test was watched FAIL against a planted mutation before it was kept: 13 on the
command, 5 on the implementation, 5 on the reaper, 4 on the composition root, 3 on the
Timeline, 5 on the domain function, and 2 on the integration proofs (removing the
interception, and sharing one browser context between Runs).

### Three defects found by re-reading, after the first green run

- **A retry counter that counted a success.** `attempts` bounded provisioning failures but
  was incremented on every delivery, including one that only REATTACHED to a healthy
  workspace. `acquirePopulation` asks for a redelivery on any transient transport failure
  and has four attempts of its own, so the fifth delivery would have failed a Run whose
  workspace had been fine every time. An `OPEN` row now carries its count forward and is
  exempt from the limit; a failure moves it to `RETRY` and the next claim counts.
- **`administration.spec.ts` located the signed-in administrator's own row by a hard-coded
  address** while `ACCOUNTS.administrator.email` reads `E2E_ADMIN_EMAIL`. Pointed at a
  differently-named administrator it resolved to somebody else's row — correctly enabled —
  so the failure read as a broken self-demotion guard rather than a wrong locator. It reads
  the configured value now. This was the only browser failure of the first full run, and it
  is unrelated to this story's code.
- **A count that read as a delta and was a total.** The lifecycle event's `denials` carried
  `denied()`, which never resets, so a second boundary reported every refusal the workspace
  had ever had. Renamed `deniedTotal`, and documented as a running total — the record of
  WHICH destinations were refused is the `security.action-denied` events, each appended
  exactly once from a drained log.

### What could NOT be proved here, and why

- **The Solari path end to end.** There is no `SOLARI_API_KEY` in this environment. The
  path is written against the SDK's real types and its error mapping is unit-tested against
  real `SolariError` values, but no session was ever created. Everything verified end to
  end used the LOCAL mode, which is the same code path and the weaker guarantee.
- **Reattach across a worker RESTART.** It is not possible with `@solarisdk/browser@0.1.3`
  and is not possible locally either: the `wsEndpoint` the SDK returns is loopback-wrapped
  by an in-process proxy, there is no `sessions.get`, and a locally launched browser dies
  with its process. So the acceptance criterion's "reattaches by the stored identity" holds
  WITHIN a process (a lost claim, a lease that expired) and the matrix's "reattach
  impossible" row is what a restart takes — release the stale identity, make one
  replacement, record `workspace-reattach-failed`. Both are proved.
- **Process isolation.** The local mode does not have it and this does not claim it. What
  is proved is that two concurrent Runs share no cookie, no `localStorage` and no session.
