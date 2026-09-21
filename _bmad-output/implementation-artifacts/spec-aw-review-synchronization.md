---
title: 'AW P4: follow exact recorded relationships across conversation, findings and Replay'
type: feature
created: '2026-09-20'
status: draft
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/docs/workstreams/auditor-workspace/spec-v1.1.md'
---

<frozen-after-approval reason="user authorized completion of the PR 51 workstream">

## Intent

**Problem:** The current surfaces retain useful IDs but expose only partial links. A finding, decision or conversation message must open its actual record, target, evidence, review history and Replay inspection, even after current execution moves on.

**Approach:** Project bounded typed relationships from existing immutable records and exact same-Run joins. Add durable references only where authored/generated conversation snapshots need them. Render reciprocal links and real decision history; consume the selected-Replay pagination slice for late inspections.

## Boundaries & Constraints

**Always:** Reauthorize every read; bind IDs to the Run and frozen target. Keep multiple targets separate. Preserve selected context and original assessment alongside effective human overlays. Use bounded queries and truthful missing/ambiguous/integrity states. Replay/history navigation is read-only and starts paused. Keep source text inert and protected evidence delivery unchanged.

**Ask First:** D2 for real-data exports/retention; neither is needed for synthetic relationship reads.

**Never:** Attach a message to the current record by inference, choose the first target silently, join by nearest timestamp, invent capture availability, reinterpret an answer against newer facts, send evidence bytes over SSE, or merge/deploy.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected behavior | Error handling |
|---|---|---|---|
| Exact finding | One source/target/observation | Reciprocal record, evidence, Replay and history links | Same-Run authorization on every destination |
| Multiple targets | One record with several inspections | Separate named target relationships | No first-target fallback |
| Historical selection | Worker moves from A to B | Message and links remain bound to A | Explicit stale/missing context |
| Duplicate subject key | Multiple included source rows match | Keep selected row; mark ambiguous inferred inspection relationship | No guessed source ordinal |
| Page-wide P-4 | Table work item affects multiple records | Work-item/evidence/history links without invented single-record ownership | Source ordinal stays null unless explicitly recorded |
| Step-only owner | Tool action has null workItemId | Resolve through its exact step execution | No time-based substitute |
| Escalation | Exact recorded wait and raise event | Correct target/inspection/evidence and read-only closed history | Missing/duplicate binding is unavailable |
| Review overlay | Human decision after agent proposal | Original proposal, effective decision, actor/time and revision together | Preserve immutable original |
| Late Replay | Inspection lies beyond default 500 frames | Exact selected inspection window and reciprocal history | No frame-zero fallback |
| Missing/tampered/foreign | Deleted relation, invalid evidence or cross-Run ID | Distinct truthful unavailable/integrity/denied outcome | No metadata disclosure |
| Many messages | More than one page of related history | Bounded stable membership, explicit pagination | Scope-bound cursor |

</frozen-after-approval>

## Code Map

- Application DTOs in `record-review.ts`, `run-conversation.ts`, `run-conversation-events.ts` and escalation/review contracts: add small typed exact references for record/target/work item, observation/condition, evidence/action, wait and source event. Do not return a recursively expanded graph. One record can expose multiple named inspection contexts; arrays remain bounded by declared plan/read limits.
- New shared infrastructure inspection-context reader, or an equivalent focused existing repository helper: resolve source ordinal only through frozen registration, step, exact subject key and unique included population row. Resolve action ownership via direct work item or exact step execution. Resolve evidence through observation references and registered capture/action rows; retain target ownership. Do not reconstruct relationships independently in browser components.
- `run-conversation-repository.ts` event-context projection and `run-conversation-events.ts`: use immutable source event identities to project target/work/observation/wait/evidence links. Unsupported/missing events can retain truthful narration without invented context. Governed Q&A answers reuse their frozen snapshot references. Preserve tombstones and freshly authorized reads.
- Schema/next migration only if needed for authored/generated message references: use a closed reference vocabulary, same-Run constraints, message membership and uniqueness. Write references atomically with messages; they are read metadata, never a new command authority. Operational references can derive from their immutable source events instead of backfilling during reads.
- `record-review-repository.ts`, evaluation review repository and wait repository: retain exact observation/condition review history and actor labels. Escalation context binds the recorded wait/raise event to its work item; missing or duplicate authoritative bindings are unavailable. For legacy escalation frame landing preserve the documented at-or-before rule, but do not use that timestamp to infer a record relationship.
- Conversation history read port: support a bounded selected-inspection filter and focused-message deep link without loading the entire transcript. Bind snapshot head, actor, Run and filter to a versioned cursor using existing cursor conventions. Reauthorize and apply current content removal on each page. Distinguish empty history from unloaded/unavailable history.
- `RecordReview.tsx`, `EscalationPanel.tsx`, `RunConversation.tsx`, `RunWorkspaceConversation.tsx`, evidence/workspace/Replay routes and `ReplayViewer.tsx`: render meaningful protected links (for example screenshot versus captured fields), separate target context, real review-history entries and reciprocal selected-inspection history. Preserve keyboard focus, draft and scroll position. A remembered deep link must open its exact context or explain why unavailable.

## Tasks & Acceptance

- [ ] Add shared bounded exact-reference projection and same-Run validation.
- [ ] Bind operational narration and governed authored/generated messages to their recorded context.
- [ ] Add stable selected-inspection history paging and exact-message deep links.
- [ ] Render reciprocal record/evidence/Replay/conversation links and actual review overlays/history.
- [ ] Execute multi-target, page-wide, ambiguous, foreign, delayed and beyond-limit relationship tests.
- [ ] Verify a hydrated journey from finding through screenshot, Replay, conversation and original/effective decision.
- [ ] Record exact proof in P4 and the continuation report.

**Acceptance:** Given a recorded finding or decision, an authorized auditor can follow its exact target, evidence, Replay segment and history without re-execution or retargeting. Missing relationships remain explicit and never open another record's capture. Original assessments and later human decisions remain distinguishable.

## Design Notes

Implement after selected Replay paging and governed explanation snapshots so relationship code consumes their stable identities. Avoid a giant omnibus DTO or full-transcript query. The selected record alone does not identify one target, and table-level evidence does not identify one source row. Closed questions and review history are visibly non-actionable. Protect the existing stable record snapshot/cursor and changed-since-list semantics.

## Verification

Typecheck/boundaries, pure relationship and UI tests, PostgreSQL exact-join/cursor/revocation cases with multiple targets and more than 500 frames, bounded query-plan checks, and authenticated keyboard/zoom browser navigation. Synthetic proof does not replace the moderated usability study.
