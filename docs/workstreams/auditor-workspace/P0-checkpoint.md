# Auditor Workspace — P0 checkpoint

Status: in development. This is not P0 capability acceptance, a completed co-working
release, a deployment, or authorization to merge. Owner: Israel Muyoba.

## Baseline and scope

- Feature branch: `feat/auditor-workspace-v1-1`, created from current main
  `44fb5966dd085f53625d5f9ac77a466a9c18805f` on 19 September 2026.
- Exact main tree verified locally: `81dd148fd173282f8435768ea67fe639397227d0`.
  Existing stale worktrees were not reused as branch ancestry. Each recovered file was
  checked against its GitHub blob SHA; all 1,736 blobs matched.
- Baseline documents: [v1.1 specification](spec-v1.1.md) and [challenge log](challenge-log.md).
- D1 is resolved by the owner's instruction: retain the complete target co-working
  promise. No implicit limited-pilot acceptance. Existing model and browser providers
  remain unchanged. No new execution engine, target access or deployment was introduced.

## Delivered at this checkpoint

The [interactive prototype](../../prototypes/auditor-workspace/index.html) shows:

1. Conversation left, isolated-workspace stage right, current-work summary outside the
   transcript, native captured identity/status text, separate capture and connection labels,
   keyboard/pointer divider, expand/focus and native specimen size.
2. One contextual execution decision, a named record/target and candidate confirmation,
   coverage impact and a safe unresolved choice. History has no reactivated answer buttons.
3. A compact record queue and inspector: approved expectation, captured fields, individual
   assessments, unloaded evidence distinguished from missing evidence, capture/source/Replay
   links, and explicit review distinct from opening an image.

The prototype is deliberately identified as a disconnected synthetic fixture on every
screen. It does not use real audit data, run a model, invoke execution commands, fetch
registered evidence, authenticate with LoanCore, or persist domain decisions. Local
session storage holds prototype draft/layout/filter preferences only. Its sample counts
are fixture data, not production coverage. The native-size view is an HTML specimen,
not proof of legibility of an actual target screenshot. The pending/applied simulator
exercises the proposed interaction language, not worker correctness.

The two older contracts are reconciled: provider handles remain infrastructure-private;
resume retains committed work and restarts the interrupted attempt from the frozen plan.

## Verification

- Prototype script syntax check: passed locally.
- Exact repository restore and `git diff --check`: passed locally.
- Pinned-runtime typecheck/boundaries/unit, PostgreSQL integration, container checks and
  design browser, full application browser and hydrated abuse jobs all passed on
  candidate `196f423`; see the executed evidence below.
- Added 12 browser cases (six state/viewport cases plus six interaction cases), including
  accessibility, 1440×900 and 1280×800 geometry, candidate confirmation, inert history,
  pending versus applied simulation, contextual questions, no substring shortcut,
  evidence/review separation, Replay selection, presentation reload and keyboard resize.
- A 720×450 layout checks the CSS viewport equivalent of 200% zoom at 1440×900. It is not
  a manual screen-reader session or a real browser zoom/accessibility certification.
- Cloud-browser navigation to the local server returned `ERR_BLOCKED_BY_CLIENT`.
  The normal repository CI browser suite is the execution route for these tests.
- The fast `workspace-design` job supplements, and does not replace or weaken, normal
  typecheck, boundary, unit, PostgreSQL, security and application browser jobs.

## Capability matrix at pinned main

| Capability | Existing code / reuse point | P0 conclusion |
|---|---|---|
| One workspace per Run | Infrastructure `browser-execution.ts`; private `LiveWorkspace.context/page`; `run_workspace` checkpoint | Reuse; no second browser/engine |
| Action-linked evidence | `captureWebTree`, `agent-capture.ts`, registered frame routes and worker-signed read grants | Existing contract; no continuous-video claim |
| Safe near-live preview | No sampler/subscription port or privacy coordinator; standalone `frame` capture is refused by the adapter | Not proven; needs same-workspace producer and viewer fencing plus measured Solari run |
| Stored credential entry | Dedicated no-capture action, `CredentialGuard`, narrow authentication POST | Reuse; not secure human assistance |
| Authentication handoff | No input owner/lease, privacy epoch, web identity/rights verification contract or approved SSO-flow catalogue | Not available; P6 security work and actual target/provider test required |
| Provider recording | Off; post-release provider recording/replay methods are not a safe preview | Keep off; no attempt to enable it |
| Strategy steering | Frozen ordered plan exists; no explicit versioned selectable strategy graph with predecessor/max-attempt contract | G2 open; do not reinterpret old instructions as executable capabilities |
| Pause / wait / result review | Existing authoritative commands, one-open-wait constraint and review/sealing transaction | Reuse; no chat-owned second result or queue lifecycle |
| Record paging | Existing detail reads are artifact/observation-first; no immutable multi-request review snapshot | P1 must implement and test full population/unit semantics in PostgreSQL |

SDK/type/source inspection is not a live-provider benchmark. The existing dedicated CI
route subsequently ran the bounded live isolation check on the exact candidate, using
the approved synthetic target and existing configured provider. Its persisted release
records are described below. This proves baseline remote workspace isolation, not a
near-live preview or secure human-input capability. Deployment settings were not changed.

## Seven proof gates

| Gate | Present evidence | Remaining before closure |
|---|---|---|
| G1 | Interactive design; 12 passing browser checks and six retained screenshots | Actual target screenshot legibility; five auditors including a manager; 4/5 successful tasks and understanding queued/applied/filtering |
| G2 | Pinned compiler/adapter inspection | Explicit frozen strategy capability graph, legacy compatibility and real predecessor/retry enforcement |
| G3 | Pinned inspection and passing live two-workspace isolation/cleanup | Measured same-Run near-live preview, real private pixels/caches, exclusive input and declared auth/identity/read-only verification |
| G4 | Synthetic-only work | Owner's data-handling policy; encrypted governed content, incident/export/context tests |
| G5 | Existing commands identified for reuse | Atomic bridge, process kills, worker/wait/control races, payload-bound idempotency and mixed-version rollback |
| G6 | Required PostgreSQL projection specified | Actual query plans, 1,000 rows, concurrent stable-snapshot paging, duplicate keys and multi-target counts |
| G7 | Workload retained from v1.1 | Approved measured 10-Run/50-viewer workload, latency, cost/bandwidth and safety/Q&A isolation |

No gate is declared passed by the challenge-log model results.

## Next implementation boundaries

P1: database-backed immutable review snapshots and on-demand selected-record reads;
full source/work-unit denominators, name resolution and integrity-state distinctions.
P2: governed durable conversation, existing live invalidation and same-Run evidence stage;
preview only after the G3 producer/viewer capability passes.
P3: payload-bound commands linked atomically to existing domain effects; exact contexts,
control epochs, safety latches and deferred subject-target pause. Strategy selection is
unavailable for legacy plans lacking an explicit capability graph.
P4: existing evaluation review authority and exact action/evidence Replay links.
P6 precedes final P5 acceptance: secure first-target authentication with privacy fences.
P5: crash/security/model/load/browser verification and complete owner review pack.

Package estimates depend on the provider spike and PostgreSQL query inspection. No
unsupported delivery date or successful CI/provider/persistence claim is made here.

## Owner/external inputs needed at the relevant stage

- Review the three P0 screen designs before broad interface implementation.
- D2: retention, exceptional sensitive-content removal, export and provider-data policy
  before real audit data. Synthetic development can continue without inventing these rules.
- D3: approve the proposed dedicated manager transfer permission, named reason and audited
  control epoch; do not infer this from an administrator role. Existing safety/wait rights
  remain governed by their current handlers.
- Arrange the five-auditor G1 study and a synthetic provider test using the approved account.

No merge or deploy is authorized.

## First executed browser result and correction

Commit `35c2a5beccdd3905d426b78c9757be1eba9fc758`, normal CI run `35434553302`,
design job `105874906885`: **10 passed, 2 failed** on pinned Node 24.20.0 / pnpm
11.25.0 and Chromium 151. No retries. The 1440px active/decision/inspector checks passed;
1280px active exposed a non-focusable scroll region and 1280px decision placed the
composer bottom at 816px in an 800px viewport. The next change makes the screen viewport
keyboard focusable and compacts short-desktop spacing. These failures are retained;
passing re-verification is required rather than removing either assertion.

The existing normal typecheck/boundary/unit job passed on this commit. Other normal CI
jobs were still running at the time of this entry. Local package build and root test
TypeScript checks passed using available Node 24.19.0; that local runtime is not the
repository-approved runtime gate.

## In-Run scheduling and G2 inspection

`execute-agent-work-item.ts` constructs work in target-major, subject-minor order,
retaining source ordinal. A logical work item has a stable ID reused by `(stepId,
subjectKey)` across retries; each attempt receives a new Step Execution ID. Therefore a
deferred pause can bind one subject-target work item without reordering. It cannot claim
an all-target subject barrier. `skip` leaves the item `UNINSPECTED`, even when the decision
Step Execution succeeds. An open wait remains the one authoritative wait.

`ExecutablePlan` versions and ordered `sessionSteps`/`planSteps` are not a selectable
strategy graph. `LookupSpec` currently carries key/value/label, and `planAgentTools`
derives lookup progression from attempted searches. G2 requires explicit frozen strategy
identity, predecessor and attempt constraints consumed by both planner and executor;
legacy plans must not gain this steering capability through prose reinterpretation.

## Bounded P1 repair delivered alongside P0

`GroundingInspector` no longer treats an omitted snapshot resolver as proof of a missing
artifact. It says the snapshot has not been loaded for this page. A supplied resolver
returning null still reports unavailable; mismatched evidence and unsupported media keep
their failures. Stored corroboration and escaped source content are unchanged. Five new
rendered regression tests cover those boundaries. The direct local web suite passed
80 files / 1,456 tests and the web TypeScript check passed on Node 24.19.0. Normal CI on
the pinned runtime remains the gate. This repair is not completion of P1's bounded
PostgreSQL record queue or on-demand evidence workflow.

## Executed candidate verification — 19 September 2026

Application/test candidate: `196f423d444264924a632c434fc695a848732579`. Normal CI
[run 35435057064](https://github.com/raeltec-systems/intellifin-audit/actions/runs/35435057064)
uses pinned Node 24.20.0 / pnpm 11.25.0. The design job passed **12/12** with zero
retries in 7.0 seconds. It retains six named desktop screenshots and the HTML report in
[artifact 10581173383](https://github.com/raeltec-systems/intellifin-audit/actions/runs/35435057064/artifacts/10581173383),
ZIP SHA-256 `e404a23cb4aa8bf74cd9a1fb6875642f3b18718c488035c4eedf7bdf00233698`.
Visual inspection confirmed the corrected short-desktop composer fits and the active,
contextual-decision and inspector screens render as intended. The target surface is
still a synthetic HTML specimen; actual screenshot legibility and human G1 study remain.

Normal typecheck/boundary/unit checks passed **232 files / 4,583 tests**. PostgreSQL 18
integration passed **47 files / 571 tests**, followed by the existing guard-mutation
checks. Container image builds and startup refusals passed. Full application browser
and hydrated abuse jobs subsequently passed: all six normal CI jobs succeeded. These existing integration tests do not prove new conversation or
interaction-ledger persistence, which has not yet been implemented.

The existing explicitly selected Solari **isolation-only** workflow
[run 35435430682](https://github.com/raeltec-systems/intellifin-audit/actions/runs/35435430682)
passed its single live case (14.8 seconds including setup) on the exact clean candidate.
It used at most two overlapping Solari sessions, zero model requests, recording off,
and the already-approved synthetic LoanCore target. The label's workflow job title
mentions a live model, but the selected scope made no model calls.

[Retained report 10582268344](https://github.com/raeltec-systems/intellifin-audit/actions/runs/35435430682/artifacts/10582268344)
has ZIP SHA-256 `22dd35e2277a8bd0c86c8e6b93c8a4228891fb0295fafcda9292919afc7ec9dc`.
The report and test confirm separate cookie/local/session/cache state, an authenticated
captured read in B while an operation in A remained pending, rejected cross-Run
references, two persisted egress-denial events, and both `run_workspace` rows `RELEASED`
before provider expiry with null diagnostics. The test also asserts both Runs durably
`CANCELED`, closed browser pages and exactly one release event each. Provider handles
remain in the restricted operational artifact; none are copied into this report.

This live result does **not** prove worker-memory or provider-firewall isolation,
continuous preview timing, private-pixel/capture-cache containment, exclusive human
input, production SSO identity/rights verification or model behavior. G3 remains open.
No rollout, migration of a deployed database, provider recording, provider switch or
parallel execution engine was introduced.
