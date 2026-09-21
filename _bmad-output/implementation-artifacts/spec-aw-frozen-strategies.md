---
title: 'AW P3: select only a frozen, eligible lookup strategy'
type: feature
created: '2026-09-20'
status: ready-for-dev
baseline_commit: 00de6c32b0c5d3be00599f9ceb2d03855ba691a8
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/docs/workstreams/auditor-workspace/spec-v1.1.md'
---

<frozen-after-approval reason="user authorized completion of the PR 51 workstream">

## Intent

**Problem:** Existing lookup prose does not declare a steerable capability. A request to use a fallback must neither skip the primary lookup nor invent a new approved strategy.

**Approach:** Freeze a canonical versioned capability graph with newly approved procedures. Offer only its currently eligible strategies, bind a confirmed selection to its exact work unit and controller epoch, and consume it at an existing worker boundary. Preserve historical version-1 execution without adding steering authority to old plans.

## Boundaries & Constraints

**Always:** Include graph meaning in derivation equivalence, approval preview and frozen-plan digest. Prerequisites require platform-recorded evidence for the same Run, subject, target and attempt. Authorize proposal, confirmation and consumption. Validate live controller epoch with PostgreSQL time. Preserve original population, predicates, identity keys, evidence requirements, targets and limits. Queued is not applied; identify the exact committed action/effect in a receipt.

**Authority:** D3 manager transfer is approved and implemented separately. This slice uses existing holder authority and must honor transfer epochs.

**Never:** Retrofit a graph to an approved version-1 plan, derive capability from prose, treat a merely attempted search as a complete negative result, change scope or target origins, execute raw chat, fabricate an observation, or merge/deploy.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected behavior | Error handling |
|---|---|---|---|
| New approval | Canonical supported procedure | Versioned graph displayed and frozen with plan | Reject changed graph semantics |
| Historical plan | Version 1, no graph | Original autonomous behavior; no strategy steering | Explain missing capability |
| Eligible fallback | Exact P-1 subject/target; grounded complete zero-match primary search | Offer declared name lookup within its attempt bound | Require confirmation |
| Incomplete primary | Missing, partial, contradictory, foreign or merely attempted search | No fallback selection | Explain unmet prerequisite |
| Different scope | Requested system, population, predicate, evidence waiver or arbitrary URL | Refuse as procedure amendment | No queued tool |
| Stale selection | Worker advances, attempt ends, option consumed, plan or epoch changes | Refuse/supersede original selection | Never retarget |
| Duplicate / lost response | Same proposal and canonical payload | Same receipt; one selected action | Conflict on changed meaning |
| Boundary race | Pause, Stop, revocation or lease expiry before consumption | Existing safety action wins; stale discretionary request has no effect | Durable refusal/supersession |
| Crash / rollback | Worker fails around selection consumption and action registration | Existing checkpoint/action identity reconciles once | No duplicate external action from replay |

</frozen-after-approval>

## Code Map

- `packages/domain/src/procedures/executable-plan.ts`: introduce a strict version-2 graph and retain explicit version-1 validation/derivation. Graph nodes use stable semantic IDs independent of incidental model step labels. Bind target registration, inspect-record action, frozen population lookup key, finite predecessor predicates and maximum attempts. P-1 declares employee-ID first and full-name fallback after a complete zero-match ID result. Other templates declare only capabilities actually executable; do not invent fallback nodes.
- `packages/application/src/procedures/derive-plan.ts`, infrastructure procedure persistence and authoring model adapters/fixtures: carry the versioned contract and graph through canonical derivation, model equivalence and persisted tool configuration. Locate all compiler-version assumptions; old workers must refuse unsupported new plans. Update the normative contract and approved-plan presentation so reviewers see prerequisites and limits before approval.
- `packages/application/src/runs/agent-tool-planner.ts`: reuse grounded search-key and complete-pagination validation to compute pure capability eligibility. Version 2 uses the declared graph; version 1 keeps its existing contract. Selection may restrict the offered tool set only to a currently eligible declared node. Opaque provider tool IDs remain platform-created.
- `packages/application/src/runs/execute-agent-work-item.ts`, `agent-ports.ts`, infrastructure agent work repository: consume a retained selection inside the existing guarded boundary, before model/browser I/O. Link command identity to durable checkpoint/action registration. Recheck permission, epoch, work item/attempt, graph digest, prerequisites and remaining attempts from committed state. Cancel/pause boundaries precede discretionary work. Browser/model calls remain outside database transactions.
- Conversation application/repository/projection and next migration: strict proposal shape carries graph/node identity, subject/target work-unit anchor, prerequisite evidence identities, canonical interpretation digest and expected controller epoch. Confirm receives only retained command identity. Immutable receipts bind exact consumption/action facts; no arbitrary tool arguments in conversation commands.
- Workspace conversation/server actions: display current inspection, target, chosen strategy and prerequisites in the review card. A draft bound to historical evidence does not silently become a current execution request. Explain unavailable capability or stale context. Use existing governed content, lost-response identity and server-owned option patterns.
- Domain/compiler/planner tests, real PostgreSQL conversation/worker tests, and a controlled P-1 browser fixture: cover graph forgery, old-plan refusal, prerequisite provenance, two-controller races, changed work unit, rollback, restart and one actual fallback action. Preserve canonical positive and defective regression datasets.

## Tasks & Acceptance

- [x] Add version-2 canonical graph, historical compatibility and visible approval meaning.
- [x] Derive eligibility from committed same-unit evidence and enforce it in tool planning.
- [x] Persist and confirm exact selections with actor, controller, graph and work-unit binding.
- [x] Consume at the existing worker boundary with durable action-linked receipts and recovery.
- [x] Render truthful conversation interpretation, consequence and queued/applied/refused states.
- [ ] Execute matrix coverage with units, database guard negatives and a real compiled-worker browser journey.
- [ ] Record contract/version decisions and exact results in `CLAUDE.md`, P3 checkpoint and continuation report.

**Acceptance:** Given an approved graph and satisfied prerequisites, when its current controller confirms a declared strategy, then the worker uses only that eligible capability for the named inspection and records the actual effect. Given absent capability, stale context or missing prerequisites, the same language never authorizes a new action or changes the approved audit scope.

## Design Notes

Keep graph IDs semantic and canonical; incidental model descriptions cannot rename authority. A proposal may go stale while the auditor reads it; refusal is safer than retargeting. Run revision alone is not the discretionary-command revision: ordinary progress must be distinguished from a different work item, attempt or prerequisite state. Paused work restarts under existing Resume semantics, so an old attempt's strategy request must not silently migrate to its replacement. Prefer the existing command/transition ledger and worker checkpoint rather than another executor or queue.

The initial supported steerable fallback is the existing P-1 name lookup. This does not waive the remaining P2/P4/P5/P6 work or imply full proof-gate closure. Parent coordinates migrations and browser/database suites sequentially.

## Verification

Pinned Node/pnpm, full typecheck and boundaries, compiler/planner/command units, schema drift check, fresh PostgreSQL migration and guard/race/recovery tests, authenticated zero-retry browser/worker proof, and pushed-candidate CI. Separate synthetic proof from provider acceptance.


## Sequencing and implementation guidance

Work only in the isolated `pr51-frozen-strategies` checkout. Manager transfer owns0060,
preview0061 and flags0062. Reserve0063, draft SQL/schema without generating journal,
snapshot or compatibility until parent integrates those dependencies. Parent owns heavy
build/database/browser/full-suite verification, independent reviews and commits/pushes.

The current compiler accepts only schema/compiler1. `plan-state.ts` reads the current
compiler constant for new drafts; introduce explicit legacy validation and derivation rather
than reinterpreting stored1 plans as2. Include graph semantics in model-equivalence and
approved preview, while retaining stable semantic IDs independent of generated step prose.
The existing planner already validates primary search provenance and complete zero results;
reuse those validators, preserving snapshot/Run/target/work-unit identity. Do not create a
second executor. A queued selection only becomes applied when its exact permitted action
is committed through the existing action/checkpoint path. Safety boundaries remain first.

Implementation checkpoint: `aw-p3-frozen-strategies-checkpoint.md`. Database/browser execution and final integration verification remain with the parent.
