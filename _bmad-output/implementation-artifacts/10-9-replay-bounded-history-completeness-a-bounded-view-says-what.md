---
title: 'Replay bounded-history completeness: a bounded view says what it covers, and the rest stays reachable'
type: 'fix'
created: '2026-09-25'
status: 'in-progress'
review_loop_iteration: 0
implementation_authorised: true
baseline_commit: '429e08cf703fee6c5320f17b5983948709fd5bdf'
context:
  - '_bmad-output/implementation-artifacts/legacy-review-closure-register.md'
  - '_bmad-output/planning-artifacts/epics.md'
  - 'docs/contracts/replay-v1.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The closure register (Story 10.1, Story 5.8 limitation (2)) found that on Replay's
default view the reads of waits, Observation-registration deltas and Exceptions stop at
`REPLAY_PAGE_SIZE` (500) with no total and no "bound" sentence, and the page uses only the first
500 Exceptions. So the Observation count beside a frame can be too low after 500 registration
events, and a jump target beyond the bound is missing with nothing saying so. That affects the
claim that Replay exposes the complete retained Run. The owner decided on 2026-09-25 that this is
residual work; Replay is not redesigned.

**Approach:** Give every bounded read an exact total beside its bounded page (the pattern
`readFrames` and the inspection pages already use), say in words what the view covers, never
present a bounded number as a total, and give the reader a way to the remaining retained material
through pagination, continuation or the existing `?workItem=` inspection path.

## Boundaries & Constraints

**Always:**
- A bounded view says what it covers; a displayed count is either exact or labelled as bounded.
- The remaining retained material is reachable: pagination, continuation or the existing
  inspection path; a jump target beyond the bound is never silently absent.
- Proven with a fixture that exceeds the relevant limits, in a browser, with WCAG 2.1 AA.

**Ask First:**
- Any new sentence (owner confirms wording before it is built).
- Raising `REPLAY_PAGE_SIZE` or `REPLAY_FRAME_LIMIT` instead of presenting the bound.

**Never:**
- Redesign Replay, re-execute an action, or reach a provider.
- Start before explicit implementation authorisation (story preparation only, 2026-09-25).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Under the bound | fewer than 500 of each kind | Unchanged: exact counts, every jump target listed | N/A |
| Over the bound | more than 500 waits, deltas or Exceptions | The view says it is bounded and what it covers; counts are exact or labelled; the rest is reachable | N/A |
| Jump target beyond the bound | an Escalation raised after the 500th delta | Listed as reachable through continuation or the inspection path, never silently absent | N/A |

</frozen-after-approval>

## Code Map

- `packages/infrastructure/src/runs/run-detail-repository.ts` (`readWaits`, `readObservationDeltas`, `REPLAY_PAGE_SIZE`, `readFrames` for the total-beside-page pattern)
- `apps/web/app/runs/[id]/replay/page.tsx`, `apps/web/src/runs/ReplayViewer.tsx`, `apps/web/src/runs/replay.ts` (`replayJumpTargets`, `resolveFrameWorkItems`)
- `tests/e2e/replay.spec.ts`, `tests/e2e/selected-replay.spec.ts` -- the browser proof; add the over-the-bound fixture

## Tasks & Acceptance

**Execution:**

- exact totals beside the bounded reads, and the "what this covers" presentation
- the continuation or inspection path for the rest
- tests: integration (totals), unit (presentation branches), browser (over-the-bound fixture, WCAG 2.1 AA)

**Acceptance Criteria:** as `epics.md`, Story 10.9.

## Implementation record — 2026-09-26

The owner explicitly authorised implementation and parallel story work in this session.
This supersedes the preparation-only flag; frozen copy approval remains separate.

### Implemented and verified locally

- [x] Bounded wait/delta reads carry exact totals; wait/Exception reads support 500-row offsets.
- [x] Default-frame Observation counts aggregate complete retained registration history in SQL.
- [x] Escalation/Exception continuation and same-Run wait deep links; precise retained landing.
- [x] 70 targeted Replay unit/SSR/route tests pass. Full workspace and root-test typechecks pass; boundaries pass (801 modules).
- [ ] New PostgreSQL tests and browser/WCAG over-500 fixture authored; not run locally because this environment cannot start PostgreSQL. Hosted CI is required.
- [ ] Frozen copy acceptance: numeric ranges with existing labels are implemented, but do not satisfy the explicit “in words” sentence requirement. No new sentence is rendered without approval.

### Owner-dependent copy decision

Proposed wording: “Showing Escalations {from}–{to} of {total}.” and “Showing Exceptions {from}–{to} of {total}.”
For a page without rows of a kind, proposed wording: “Showing 0 of {total} Escalations.” / “Showing 0 of {total} Exceptions.”
The existing approved frame sentence refers specifically to frames; the bell sentence refers to expiring/answered questions and cannot describe Replay history truthfully. Approval is needed only to replace the numeric range with these sentences and close that acceptance item.

### Review and continuation

No commit, push, merge, deployment, threshold increase, provider call, migration or replay redesign was performed by this implementation subagent. Root coordinates independent review and hosted proof. Story remains in-progress until copy, database and browser acceptance are complete.

### Review fixes — 2026-09-26

- Valid out-of-range history offsets redirect to the last useful page using exact totals; malformed offsets remain unavailable.
- Late Escalations carry their exact capture Evidence ID. `?capture=<id>` reads one retained same-Run frame through the shared ranked/context query, including no-owner captures and owned captures beyond inspection page one. It preserves global numbering, paused state and reload identity.
- PostgreSQL fixtures mix closed pauses with Escalations at the 500 boundary; filtered totals and wait deep-link cursor remain aligned. New capture tests cover late owned/no-owner/foreign/invalid selections.
- Added an exact-capture browser journey with 610 frames and 502 waits; Story 10.10 owns the composed Timeline→Replay click proof using the shared large-history fixture.
- 80 targeted tests passed before the final browser fixture addition; full typecheck and boundaries rerun for the final candidate below. Database/browser execution remains hosted CI work.

Final local review-fix verification: 80/80 targeted tests passed; `pnpm typecheck` passed (workspace and root tests); `pnpm boundaries` passed (801 modules); `git diff --check` passed. DB/browser fixtures are authored, not locally executed.
