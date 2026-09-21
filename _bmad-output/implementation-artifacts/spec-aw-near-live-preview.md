---
title: 'AW P2: view the current agent workspace through protected ephemeral preview'
type: feature
created: '2026-09-20'
status: in-progress
review_loop_iteration: 0
baseline_commit: fae6b5667196ec92cef338aa9a73b8b9d569ab7c
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/docs/workstreams/auditor-workspace/spec-v1.1.md'
---

<frozen-after-approval reason="user authorized completion of the PR 51 workstream">

## Intent

**Problem:** Action-linked captures do not show safe workspace changes between committed actions. Auditors need a fresh view of the actual agent page, with privacy and connection state shown honestly.

**Approach:** Add one bounded sampler per worker-owned workspace and an authenticated application proxy for ephemeral frames. Share a privacy/action coordinator with stored sign-in and the following secure-assistance slice. Preserve registered evidence and Replay as distinct records.

## Boundaries & Constraints

**Always:** Sample the existing agent Page only. Fence every capture and delivery by Run, workspace revision, worker runtime and privacy epoch. Reauthorize each viewer. Exclude all private/authentication intervals; default unavailable on uncertain capability or ownership. Bound capture frequency, bytes, subscribers and in-flight work. Keep evidence/safety traffic independent. Label capture age separately from connection age.

**Ask First:** D2 before real data; external provider acceptance requires its named budget. Synthetic implementation can proceed.

**Never:** Create an observer browser, expose provider endpoints/object-store capabilities, persist preview pixels as evidence, enable recording, resize the agent viewport from a viewer, infer live state from a heartbeat, or merge/deploy.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected behavior | Error handling |
|---|---|---|---|
| Safe active page | One Run, multiple authorized viewers | One sampler; each viewer receives same-workspace epoch-bound frames | Bounded frame/backpressure policy |
| Page changing | Safe sample available | Actual capture time and decoded frame shown | No invented motion |
| Private transition | Capture pending or image decoding | Increment epoch; suppress/discard old work; clear viewer stage | Explicit private gap |
| Stored sign-in | Agent uses saved credential flow | Same suppression coordinator protects input and captures | No credential pixels/DOM |
| Revocation / foreign ID | Actor loses session/role or requests another Run | Refuse fresh delivery | No provider/data disclosure |
| Worker loss | Process-local Page disappears | Expire runtime identity and mark preview unavailable | Never reuse another session |
| Viewer loss / overload | Hidden tab, disconnect or too many requests | Stop/coalesce sampling; truthful stale state | Safety/evidence work proceeds |
| Terminal / release | Workspace closes | Stop sampler and release buffers | Offer retained action evidence/Replay |

</frozen-after-approval>

## Code Map

- `packages/application/src/runs/execution-ports.ts`: add narrow preview/coordinator ports without exposing Page, provider handles or input methods to web/application clients. Tickets contain exact Run/workspace/runtime/privacy identity and monotonic capture sequence.
- `packages/infrastructure/src/runs/browser-execution.ts`: the process-local `LiveWorkspace` owns Browser, Context and reusable Page. Add per-workspace coordination for agent action dispatch, capture and private boundaries. Keep one bounded latest-frame buffer. Validate ticket before capture, after screenshot completion and before publication. Stored-credential sign-in must enter/exit the same private boundary. Close buffers/timers on release and shutdown; recording must be verifiably disabled.
- Workspace persistence, next migration and worker composition: retain only metadata runtime ownership, privacy epoch, sample status/time and expiry. Browser I/O never holds a database lock. Runtime recovery cannot attach a missing in-memory Page or revive an old privacy epoch. Preserve the existing canonical lock/fence order.
- New worker-private broker and authenticated web preview routes: relay bytes transiently over an application-owned channel. Bind short-lived internal requests to worker instance, actor/session, Run, workspace and epoch, and recheck actual database authority. Use a configured private endpoint and authenticated transport; require TLS outside explicit loopback synthetic testing. Do not accept a client-supplied broker URL. Fail closed on wrong worker ownership. Keep body/access logs disabled and do not store frames, cookies or provider URLs in DB/jobs/SSE.
- `apps/worker/src/main.ts` and `apps/web/src/bootstrap.ts`: compose broker/sampler only when capability and explicit configuration are present. Web retains no browser/provider credentials. Document initial supported single-owner routing; do not claim multi-worker routing without an actual owner-resolution implementation and tests.
- `apps/web/src/runs/WorkspaceCaptureView.tsx`, workspace route and new client preview view: show live preview only for a valid current frame, with capture age, pending/private/stale states and explicit action-linked fallback. Recheck epoch immediately before display, revoke object URLs and clear buffers when hidden/revoked/private. Preserve focus/100-percent inspection without changing browser dimensions.
- Preview/coordinator unit tests, PostgreSQL fence tests and real compiled-worker browser fixtures: asynchronous screenshot completion across privacy transitions, decode race, two viewers/one sampler, cross-Run/revoked reads, current workspace proof, stored sign-in suppression, release/crash and load isolation.

## Tasks & Acceptance

- [x] Implement the isolated process-local privacy/action coordinator and deterministic race tests; integration remains pending.
- [x] Add privacy/action coordinator and same-Page bounded capture port.
- [x] Add metadata runtime/epoch fencing, private broker and protected proxy delivery (migration draft; parent application pending).
- [x] Integrate sampler lifecycle with agent actions, stored authentication and worker shutdown.
- [x] Render truthful freshness/private/stale modes with readable fixed-viewport inspection.
- [ ] Execute privacy, authority, crash, multi-viewer and decoded-frame browser tests.
- [ ] Record measured synthetic cadence/latency and capability limitations in P2/report.

**Acceptance:** Given an active safe workspace, authorized viewers see fresh frames of that exact agent page without multiplying capture work. Given any private boundary or stale runtime, no crossing frame is published or newly displayed and the interface names the gap. Existing evidence integrity and safety commands remain authoritative.

## Design Notes

Use metadata-only notifications for invalidation. Preview frames are ephemeral and are not added to exported evidence or Replay. A frame received legitimately before privacy transition cannot be erased from a hostile client; test prevention of new delivery and cooperative stage clearing rather than claiming retroactive erasure. Target one frame per second under the named synthetic benchmark, but measure and report actual percentiles instead of claiming G3/G7 closure. Public Solari enablement stays gated until same-session, recording and containment proof is executed.

### Bounded core integration contract — 2026-09-20

The first implemented component is
[`workspace-privacy-coordinator.ts`](../../packages/infrastructure/src/runs/workspace-privacy-coordinator.ts),
with no browser/provider imports and no durable or transport capability. One instance belongs
to one existing `LiveWorkspace` and exact Run/workspace/revision/runtime identity. It starts
unavailable. Only initial, explicitly proven safe admission or verified private handback can
open public work; a blocked or closed instance cannot reopen.

`runAction` covers the complete ordinary browser operation **and its registered captures**.
It reserves priority over preview, permits only one waiting action, and bounds waiting for
an existing capture to ten seconds by default. `capturePreview` admits no queue, at most one
capture each second, and one latest owned frame (512 KiB default, configurable with an 8 MiB
hard ceiling). Failed, crossing, empty, oversized or already stale captures are not published.
Capture start/completion timestamps remain separate; maximum readable frame age defaults to
three seconds on a monotonic clock. Source buffers are cleared after transfer, rejection or
replacement; delivery returns independent transient copies.

`beginPrivate` increments the epoch, clears the frame and signals existing work immediately,
then waits for underlying work to settle before issuing an opaque process-local private token.
No public work is admitted during draining or private input. `runPrivate` accepts only the
same token object and one operation at a time. `handback` performs exclusive verification
and advances to the next public epoch before releasing that exclusive slot. A failed or
throwing verifier stays private; lease revocation or close fences a late successful verifier.
Neither the token nor the callback establishes human authority: the broker must separately
prove the current actor/session/input lease and close input before verification.

A drain timeout remains blocked, signals cancellation and requires disposing the Page; it
does not assert cancellation succeeded. `close` fences immediately and clears retained bytes;
the adapter remains responsible for browser teardown. Callbacks must remain pending until
**all underlying browser promises settle**. The existing `withActionDeadline` timeout race
does not establish that guarantee by itself. Browser integration must track/drain those
promises or close/discard the Page before any subsequent private/public admission. Stored
credential sign-in must enter the private path at dispatch, rather than nesting private entry
inside a public action that would then wait for itself.

The sampler callback must independently prove the current page is eligible for capture,
including credential-bearing surfaces, before screenshotting. Provider recording must be
disabled and validated at workspace creation. Application transport must reauthorize fresh
actor/session and durable runtime/epoch ownership, fence at response write, and fence again
at client decode. `readLatest` checks only this process's current epoch synchronously; it
cannot replace those checks or erase a copy already delivered. This component contains no
provider URL, browser handle, DOM, image cache outside its one buffer, persistence or logs.

These local primitives do not deliver a visible preview yet. Adapter wiring, real I/O drain
proof, metadata runtime ownership, sampler lifecycle, private broker, authenticated proxy,
client invalidation/decode, provider recording proof and measured same-Page acceptance remain
open. No real-data policy or provider capability is inferred from synthetic unit tests.

## Verification

Typecheck/boundaries, coordinator/transport units, fresh PostgreSQL migration/fencing tests, real-worker same-Page and privacy browser proof, and named synthetic capture/decode load measurements. No provider acceptance is inferred from fixtures.

Core verification on 2026-09-20: `pnpm exec vitest run
packages/infrastructure/src/runs/workspace-privacy-coordinator.test.ts --maxWorkers=1`
passed **29/29** in 46 ms of test execution. Cases include exact identity mismatch, initial
unavailable state, bounded bytes/cadence/age, action priority, private entry before dispatch,
crossing capture/artifact disposal, overtaken queued action, hung-I/O admission timeout,
exclusive input, verification/handback interleaving, revocation and release. This is isolated
coordination evidence; real browser privacy and G3/G7 acceptance remain unexecuted.

### Approved implementation plan and stable handoff — 2026-09-20

Parent approved the concrete P2 plan before wiring: one coordinator and sampler on
LiveWorkspace; actual browser promise tracking; metadata-only runtime/epoch lease;
authenticated fixed-owner broker and web proxy; cooperative client decode fencing.
The isolated baseline is `a45345593e883e825c8c4437fee2d7e266ee6eed` on
`feat/pr51-near-live-preview`. This implementation does not close D2/G3/G7 or
provider containment/recording gates.

Implemented production path:

- `WorkspacePreviewSession` owns one latest frame, one timer, and one capture at a
  time. It starts unavailable. Initial navigation must establish a safe page with
  capture suppressed before public admission. Private gaps refuse registered
  captures. Saved sign-in requires both the existing authenticated-account proof
  and a fresh safe-page check for handback.
- Actual `withActionDeadline` promises are tracked through AsyncLocalStorage.
  Any unsettled underlying I/O on return closes the coordinator and disposes the
  Page; aborted signals and raced wrapper settlement are never cancellation proof.
- The sampler uses the existing Page without creating a Page or changing viewport.
  It checks the safe page before and after screenshot, zeros rejected/transferred
  buffers, and stops after viewer demand expires. Unsafe samples create a private
  gap. Preview pixels never become registered Evidence, snapshots, jobs, or SSE.
- Generation0061 stores only runtime/revision/privacy/sample metadata. Lease expiry
  is four seconds; the same revision cannot be reclaimed by a new runtime. Actor
  role, session, active Run, current workspace revision and runtime are checked on
  every protected read. A synchronous in-memory fence also runs immediately before
  the broker writes, after its final database check.
- Broker messages are HMAC-bound to actor/session, Run, runtime/revision/epoch,
  timestamp and nonce. Public errors use fixed vocabulary. Web rechecks durable
  authority after receipt. Only an explicitly configured loopback synthetic owner
  is supported: remote routing/TLS and all Solari/recording modes remain disabled.
- Client fetches are same-origin/no-store, bounded, and sequential. Each image is
  decoded off-stage, then a fresh status request must match runtime, revision,
  epoch, sample sequence and capture start time before display. Hide, stale age,
  errors, unmount and changes of Run clear the stage and revoke object URLs.
  Registered action captures remain a separately labelled record.

Explicit bounds: 16 active preview sessions per process; 8 viewer sessions per
workspace; 5-second demand expiry; at most 1 capture/second/workspace; 512 KiB/frame;
3-second maximum sample age; 2-second screenshot deadline; 1-second safe-page and
client decode deadlines; 32 in-flight broker/proxy reads; 40 broker connections;
2 KiB authenticated request; 710,000-byte proxy response; 1,024 retained nonces
with 6-second expiry. No additional preview queue is introduced. Normal action
admission has priority over sampling. Overload returns unavailable.

The migration SQL and schema declaration are drafted as0061. Journal, snapshot,
compatibility range, database application, builds, browser/services and push remain
with parent, after0060. No root source or Replay file was edited. When integrating,
retain root Replay's later optional imageUnavailable/retry metadata semantics in
LiveViewer; this worktree did not edit that file.

Verification handoff: deterministic coordinator, session, actual deadline tracker,
LiveWorkspace admission, broker/proxy authentication and client freshness tests are
provided. The LiveWorkspace seam test replaces the existing action body; it proves
production admission/drain wiring, not a real credential form. PostgreSQL tests are
written in `tests/integration/workspace-preview.test.ts` and are intentionally not
run in this isolated implementation slot. Parent must run those after0061, then
prove real compiled-worker stored sign-in, delayed registered capture and preview,
two viewers/one Page, post-decode private/revocation/crash clearing, and measured
cadence/capture/delivery latency. No percentile or real-browser claim is made here.

Light verification: 145 tests passed across 10 focused unit files; after final ownership/cleanup tightening, all 47 affected browser/session cases passed again. Infrastructure, web, worker and root test TypeScript checks passed. `git diff --check` passed. PostgreSQL, browser, full build, migration drift and independent review are pending parent sequencing.
