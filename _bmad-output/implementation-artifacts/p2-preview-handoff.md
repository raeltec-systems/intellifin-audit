# P2 isolated implementation handoff

Production source is stable in `/workspaces/intellifin-audit/.claude/worktrees/pr51-near-live-preview`, branch `feat/pr51-near-live-preview`, baseline `a45345593e883e825c8c4437fee2d7e266ee6eed`. Nothing committed or pushed; root workspace untouched.

145 focused units passed; 47 affected browser/session cases passed again after final ownership/cleanup changes. Infrastructure, web, worker and root test types passed; diff whitespace check passed. DB, migration generation/application, builds, real browser/worker proof, measured cadence and independent review remain with parent. The unit admission seam replaces the existing action body; do not describe it as real credential/browser proof.

Configuration: both services need `WORKSPACE_PREVIEW_MODE=synthetic-local`, the same `WORKSPACE_PREVIEW_SECRET` of at least 32 characters, and optional `WORKSPACE_PREVIEW_PORT` (4311 default). Non-production only. Fixed single worker and web share the same loopback host/network namespace. Worker workspace must be local, with only loopback target origins; no Solari, recording, remote routing or D2 real data. Preview unavailable elsewhere.

Migration0061 SQL/schema draft is ready after manager0060. No journal/snapshot/compat changes were made. Add generation61 through the normal repository workflow before testing. Run `pnpm exec vitest run --config tests/integration/vitest.config.ts tests/integration/workspace-preview.test.ts` only after that sequence. This fixture exercises real DB constraints, without bypass flags or migrations at startup.

Parent browser proof still needs: genuine stored sign-in with crossing screenshot/registered capture, two viewers showing the existing Page without new Page/viewport mutation, delayed decode across private/role/session/runtime changes, terminal/release/unavailable transitions, and actual sample/capture/delivery percentile measurements. A fixed local synthetic target is necessary. No acceptance gate has been claimed closed.

## Executable browser proof handoff

`tests/e2e/workspace-preview.spec.ts` and `tests/fixtures/workspace-preview-browser.ts`
now author ten opt-in cases against the **compiled production browser adapter and broker,
real Chromium, real PostgreSQL metadata and the running application preview route**.
This is not a separately running agent worker process or a provider/model acceptance test.
The fixture starts its own loopback target on an ephemeral port and the production broker
on `WORKSPACE_PREVIEW_PORT`. Parent starts the web service only; do not start a worker or
another broker on that port. The frozen fixture target and adapter allowlist name the same
loopback destination. No action implementation, screenshot pixels, decoder success,
authorization response or clock is substituted.

Cases cover two distinct authenticated sessions; real changing JPEG samples tied to the
existing agent Page and durable Run/workspace/revision/runtime; no new Page or viewport
mutation; no recording; real saved-credential form POST with a crossing preview JPEG or
registered-capture PNG; zeroed rejected buffers; later ordinary capture availability;
real image decode completion held across private input, role revocation, session expiry,
replacement runtime and worker lease loss; and preview withdrawal after actual worker-boundary
cancellation (including sealed Result) and adapter release. Screenshot wrappers delay only
the completion of an actual Chromium screenshot. Decoder wrappers wait for actual decoding
before introducing the race. The tests never persist preview pixels as Evidence. The
registered-capture cases exercise the production artifact-producing adapter path, not the
later Evidence registration transaction or a complete agent job.

The browser fixture restores synthetic role/session changes and drains injected gates,
then closes broker/browser/target and removes its Run. Cleanup failures are attached; an
existing assertion failure remains the primary failure. The existing PostgreSQL preview
test's invalid direct terminal-state write was replaced with `cancelRun` followed by
`performCancellation` in the real cancellation repository transaction.

After parent generates/applies 0060 then 0061 and builds packages, use an isolated local/CI
database whose name contains `test` or `ci`. Seed the normal E2E accounts and ensure
`E2E_PASSWORD` matches the seed. Configure the web process and test process with:

```sh
export WORKSPACE_PREVIEW_MODE=synthetic-local
export WORKSPACE_PREVIEW_PORT=4311
# Supply the same synthetic-only WORKSPACE_PREVIEW_SECRET (at least 32 characters)
# to web and tests. Do not place it in the committed handoff or command output.
unset SOLARI_API_KEY MODEL_API_KEY ANTHROPIC_API_KEY OPENAI_API_KEY
export PLAYWRIGHT_BASE_URL=http://localhost:3000
export WORKSPACE_PREVIEW_PROOF=1
pnpm exec playwright test tests/e2e/workspace-preview.spec.ts --project=chromium --workers=1
```

`PLAYWRIGHT_BASE_URL` means the parent already started the web service with the preview
configuration; it prevents Playwright from starting its default web/Northstar services.
The normal setup project still performs real application sign-ins. The preview suite is
explicitly skipped in ordinary E2E runs without `WORKSPACE_PREVIEW_PROOF=1`; that skip is
not evidence that the P2 gate passed. A selected enabled run fails on missing configuration,
missing schema, unavailable broker port, bad authentication or unavailable preview.

Run the metadata suite separately after migration:

```sh
pnpm exec vitest run --config tests/integration/vitest.config.ts tests/integration/workspace-preview.test.ts
```

The benchmark observes a 15-second changing-screen window with two authenticated sessions.
It attaches `preview-measured-performance.json` before performance assertions. The attachment
contains actual unique displayed sequence IDs, pixel digests, capture/completion/receipt/display
timestamps, capture intervals and duration percentiles, sample age at delivery, display
rate per viewer and p95 capture-to-display. It asserts the normative **at least one unique
displayed frame per second** and **p95 capture-to-display below two seconds**; duplicate
poll responses do not count. Misses remain failing product gates and must prompt source
correction, not relaxed thresholds. No cadence or latency values have been measured yet.

Light verification for the new fixtures: the first root test TypeScript check passed.
The repeated root check after terminal-boundary/runtime additions was terminated with
SIGTERM without compiler diagnostics; it is not counted as passing. A focused compiler
check of the final browser and PostgreSQL preview fixtures (including their imported
harness) passed. No browser, service, database, migration or heavy test was run by the
fixture author. Parent still owns full verification and actual measured results.

### Bounded static fixture/cadence follow-up

The fixture APIs were checked against `PlaywrightBrowserExecution`, the coordinator,
session, metadata store, broker and client. The observed Page is the adapter's retained
Page; JPEG means preview and PNG means the registered-artifact capture path. Both
crossing-buffer assertions observe the actual buffer passed into coordinator ownership.
Stored sign-in uses the real frozen form POST and authenticated-account postcondition.
Replacement runtime changes the durable workspace revision before claiming another
runtime; lease loss expires ownership without manufacturing another Page. Terminal proof
uses the normal cancellation/result seal. Authentication can delete an expired session,
so the session transition now signs in once into a disposable session and expires only
that new session. Shared saved-state sessions stay valid for subsequent tests; cleanup
also deletes the disposable session if authentication has not already removed it.
The local fixture now suppresses incidental favicon requests. Delivery timestamps now
record complete response-body arrival; Playwright's `response` event alone records headers.

The client previously waited 1,000 ms **after** image fetch, decode and fresh authorization
finished. Its start interval was therefore `1,000 ms + work duration`, which imposes a
strictly-below-1-Hz ceiling for positive work duration. Production polling now uses
`startWorkspacePreviewPolling`: a monotonic start-based one-second interval, with the next
timer armed only after the previous poll settles. Work over the interval resumes once
without an overlapping request or accumulated catch-up queue. Stop cancels scheduled work;
the existing component still aborts in-flight reads and checks disposal, visibility,
runtime, revision, privacy epoch, sample identity and sample age after real decoding.

Five focused tests passed: three asynchronous scheduler cases and the existing two
freshness/presentation cases. They verify that work time is included within the interval,
slow polls do not overlap or queue, and stopped/rejected polls retain bounded scheduling.
The focused TypeScript check covers both fixtures, the scheduler tests and the component's
existing tests with Next's ambient CSS declarations; it passed. Whitespace checks passed.
This removes the deterministic client delay; it is **not measured 1-FPS acceptance**.

One unmeasured sampler risk remains for the parent benchmark: the worker's 1,000-ms
`setInterval` reaches the coordinator's 1,000-ms admission throttle after variable database
work. A slightly early admission can be throttled until the following timer tick. The
benchmark records actual capture intervals and unique displayed rates so this can be
distinguished from client delivery delay. Sampler limits and acceptance thresholds were
not changed during this bounded follow-up. No browser/database/services or heavy checks
were run.

Keep root Replay's later LiveViewer error/retry metadata behavior when reconciling. This worktree did not modify LiveViewer or ReplayViewer; only the workspace route imports the new preview component.

Changed files:

- `CLAUDE.md`
- `apps/web/app/runs/[id]/workspace/page.tsx`
- `apps/web/src/bootstrap.ts`
- `apps/worker/src/main.ts`
- `packages/application/src/runs/execution-ports.ts`
- `packages/infrastructure/package.json`
- `packages/infrastructure/src/config.test.ts`
- `packages/infrastructure/src/config.ts`
- `packages/infrastructure/src/db/schema.ts`
- `packages/infrastructure/src/index.ts`
- `packages/infrastructure/src/runs/browser-execution.ts`
- `packages/infrastructure/src/runs/web-tree-capture.ts`
- `_bmad-output/implementation-artifacts/spec-aw-near-live-preview.md`
- `apps/web/app/api/runs/[id]/preview/route.ts`
- `apps/web/src/runs/WorkspacePreview.test.ts`
- `apps/web/src/runs/WorkspacePreview.tsx`
- `packages/infrastructure/drizzle/0061_workspace_preview_metadata.sql`
- `packages/infrastructure/src/runs/browser-io-tracker.test.ts`
- `packages/infrastructure/src/runs/browser-io-tracker.ts`
- `packages/infrastructure/src/runs/browser-preview.test.ts`
- `packages/infrastructure/src/runs/workspace-preview-broker.test.ts`
- `packages/infrastructure/src/runs/workspace-preview-repository.ts`
- `packages/infrastructure/src/runs/workspace-preview-session.test.ts`
- `packages/infrastructure/src/runs/workspace-preview-session.ts`
- `packages/infrastructure/src/runs/workspace-preview-transport.test.ts`
- `packages/infrastructure/src/runs/workspace-preview-transport.ts`
- `packages/infrastructure/src/runs/workspace-privacy-coordinator.test.ts`
- `packages/infrastructure/src/runs/workspace-privacy-coordinator.ts`
- `tests/integration/workspace-preview.test.ts`
