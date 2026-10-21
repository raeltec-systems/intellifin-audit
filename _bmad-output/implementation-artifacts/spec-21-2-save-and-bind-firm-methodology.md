---
title: '21.2 — Save and bind applicable firm methodology'
type: feature
created: '2026-10-02'
status: done
story_key: 21-2-save-and-bind-applicable-firm-methodology
baseline_commit: 38d76b019db1e5cb637f8c66e6cde3947c3415b2
review_loop_iteration: 0
authorization: 'Owner authorised the next batch and routine specification/engineering choices.'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-21-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/batch-21-2-21-4-build-context.md'
---

<frozen-after-approval reason="owner-authorised canonical Story 21.2">

## Intent

**Problem:** Tasks lack saved, inspectable firm requirements and templates.

**Approach:** Admin saves immutable configuration and assignments; Tasks record applicable bindings and handle changes explicitly.

## Boundaries & Constraints

**Always:** Current authority, exact retries, attributed versions, mandatory inheritance and separate availability/business dates. Preserve foundation controls, Admin continuity and published migrations/catalogues 1–7. Label neutral starters; missing criteria block dependent conclusions only.

**Ask First:** Paid qualification, customer data, deployment or new authority policy.

**Never:** Second approver, chat-derived policy, automatic evidence installation, silent rebinding, edited issued history, Node authority or evaluation/model claims.

## I/O & Edge-Case Matrix

| Scenario | Input / state | Required result / refusal |
|---|---|---|
| Save | Current Admin, valid expected revision | Atomically create version, assignment, diff/source attribution and impact fact; invalid/stale Save changes nothing |
| Retry / Undo | Lost receipt or prior version selected | Exact replay; changed meaning conflicts; Undo creates a successor |
| Resolve | Firm/client/engagement assignments and audit area/period | Field-wise inheritance, exact versions and reason; preserve mandatory rules; ambiguity remains explicit |
| Timing | Scheduled activation; historically effective criteria | Resolve availability separately from business dates; never choose policy merely by latest Save |
| New Task | With or without explicit area/period | Atomic binding before work; labelled neutral/incomplete basis if insufficient context; no mandatory picker |
| Existing Task | New-only or apply-to-active edit | Keep original binding or stage an attributable safe-boundary change with visible impact; fence stale unused work |
| In flight / recall | Consumed work or recalled version | Retain original basis/receipt rights; reconcile before switching; recall prevents affected new use |
| Authority | Foreign IDs, revocation or replaced session | No leaked settings, client work or drafts; Admin configuration grants no audit access |

</frozen-after-approval>

## Code Map

- `zobba/crates/infrastructure/src/task.rs` — `admit` atomically creates work; switch binding after `coordinate` reconciles consumed effects. Preserve `current` and receipt-only `observe`.
- `zobba/crates/{domain,application}/src/task.rs`, `crates/api/src/tasks.rs` — command/HTTP meaning; optional Create/Guide context participates in replay and recovered conversation meaning.
- `zobba/crates/infrastructure/src/{membership,scope,lib}.rs` — Admin authority, ordered locks and exact schema/grants; add schema8.
- `zobba/web/src/{App,ConversationWorkspace,MembershipWorkspace}.tsx` — audience ownership, inspection and Save patterns; generate API through CLI.
- Accepted design §3.3 and canonical21.2 govern; legacy compiler is reference only.

## Tasks & Acceptance

**Execution:**
- [x] `zobba/crates/{domain,application}/src/methodology.rs` — bounded definitions, resolver, validation and binding/impact ports plus executable examples.
- [x] `zobba/migrations/0008_methodology.sql`, `crates/infrastructure/src/{methodology,task,operation,lib}.rs` — scoped storage, activation/current-use guards, catalogue and fixture/reset contracts.
- [x] `zobba/crates/api/src/methodology.rs`, composition/OpenAPI and `web/src/{methodology,MethodologyWorkspace,TaskMethodology}.*` — Admin editor/impact preview and Task basis; retain conversation/recovery.
- [x] `zobba/crates/*/tests`, `web/tests` — matrix regressions, README and evidence; renew after review repairs.

**Acceptance Criteria:**
- Given valid Admin input, when Save commits, then version and assignment are attributable and immutable without another approver.
- Given an assigned Task, when its basis resolves, then exact criteria/templates, period and reason are inspectable.
- Given an edit affecting existing work, when activation is selected, then bindings and rework remain explicit and in-flight history stays intact.
- Given inherited requirements and historical dates, when override or Undo saves, then mandatory rules survive and business applicability remains correct.

## Spec Change Log

- 2 October: clarified the continuing-Task binding path under the owner's routine engineering authorization. An auditor can supply or correct Task-local audit context through the existing attributed Guide command; this does not edit methodology or expand authority. Frozen intent, canonical acceptance and scope remain unchanged.

## Design Notes

Resolve explicit optional area/period against firm defaults and scoped overrides. Unknown semantics are potentially material. Stable requirement IDs and required/optional standing support later21.3/21.4.

Discovery may precede known audit context. A later Guide may explicitly supply or correct that same Task's area/period, with a reason in its accepted content. Stage the resulting binding change until consumed effects reconcile; retain the original basis, exact command/retry meaning and conversation echo. Do not require recreating the Task or editing firm defaults to resolve missing context. A scheduled apply-to-active assignment also covers matching Tasks created before its future cutoff, while preserving their original binding until then.

Fence conflicting unused work at acceptance; apply after consumed effects reconcile. Preserve Pause/Stop and original basis. Durable impact records support future assessment/review without implementing those consumers.

## Verification

Completed 2 October 2026: **225 Rust tests/doc tests across 38 sections, 107 Chromium cases with zero retries, 131 web tests, 56 fixture tests and 47 Python tests**. Formatting, strict all-target Clippy, Rust/web builds, generated contracts, boundaries and process smoke passed. Three ignored helper entrypoints are executed by passing parent contracts. Restricted-owner populated schema 7→8 and all 14 unchanged published prefix files were verified.

Three independent BMAD layers identified 15 bounded repairs, all closed. Subsequent P16 inner-disclosure repair has an old-source negative control, four passing focused cases and two independent closures. The final test-lifecycle repair preserves all privacy/withdrawal assertions; seven focused cases and the full 107-case suite pass. Earlier failed attempts and unresolved original trigger/cold-login causes remain documented; a later pass does not establish those causes.

Nine backend/schema/fixture gates are retained only because applicable source and tests remain byte-identical; final web and browser gates are fresh. All 201 final source hashes, 431 preserved earlier artifacts and separate documentation hashes match. Headless visibility simulation is not native OS tab qualification. See [checkpoint](zobba-foundation-batch/STORY-21.2-CHECKPOINT.md), [matrix](zobba-foundation-batch/story-21.2/repair-2/matrix-execution.md), [final gates](zobba-foundation-batch/story-21.2/repair-2/final-gates.json) and [source audit](zobba-foundation-batch/story-21.2/repair-2/root-final-verification.json).

## Suggested Review Order

**Task methodology contract**

- Each Task retains an exact basis and a separately explained pending change.
  [methodology.rs:347](../../zobba/crates/application/src/methodology.rs#L347)

- Resolve inherited requirements, exact templates and substantive neutral provenance deterministically.
  [methodology.rs:581](../../zobba/crates/domain/src/methodology.rs#L581)

**Current use and immutable history**

- Save configuration, impact and successor identity behind current scoped authority.
  [0008_methodology.sql:98](../../zobba/migrations/0008_methodology.sql#L98)

- Use one resolution cutoff so later activations remain pending.
  [methodology.rs:309](../../zobba/crates/infrastructure/src/methodology.rs#L309)

- Check eligibility after deferred writes before consuming work and issuing receipt capability.
  [task.rs:703](../../zobba/crates/infrastructure/src/task.rs#L703)

**Admin and auditor experience**

- Expose ordinary Save, exact lineage recovery and explicit inheritance controls.
  [MethodologyWorkspace.tsx:132](../../zobba/web/src/MethodologyWorkspace.tsx#L132)

- Show current, pending and historical bases without replacing the continuing conversation.
  [TaskMethodology.tsx:32](../../zobba/web/src/TaskMethodology.tsx#L32)

**Verification and contract**

- Prove rollback when a real activation cutoff crosses a deferred consumption barrier.
  [methodology_cutoff.rs:73](../../zobba/crates/infrastructure/tests/task/methodology_cutoff.rs#L73)

- Exercise differing initial context and actual active-task Save through browser and API.
  [methodology-review.spec.ts:95](../../zobba/web/tests/browser/methodology-review.spec.ts#L95)

- Preserve exact multiline and Unicode semantics in the generated contract.
  [methodology_contract.rs:149](../../zobba/crates/api/tests/methodology_contract.rs#L149)
