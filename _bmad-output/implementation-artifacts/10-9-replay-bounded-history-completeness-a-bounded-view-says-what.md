---
title: 'Replay bounded-history completeness: a bounded view says what it covers, and the rest stays reachable'
type: 'fix'
created: '2026-09-25'
status: 'blocked'
review_loop_iteration: 0
followup_review_recommended: true
deferred:
  - summary: >-
      Default Replay joins screenshots to independently bounded Tool Action and Step pages.
    evidence: |-
      The first 500 screenshots need not belong to the first 500 actions or steps;
      suppressed or uncaptured actions can exhaust that page first. Stored action
      details and the Step-first record owner may then be presented as absent.
      The handover explicitly names the Tool Action mismatch as separate work.
    location: >-
      apps/web/app/runs/[id]/replay/page.tsx
    severity: medium
implementation_authorised: true
implementation_authorisation: 'Owner, 2026-09-26: "go, new branches OK" (implement 10.6 to 10.10 on new branches); wording approved 2026-09-26 ("approve all")'
baseline_revision: 'e8728b0c874b9f4e8981f07fbc6b707e819f372b'
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

## Approved wording (owner, 2026-09-26)

The owner approved these sentences on 2026-09-26 ("approve all"). They answer this story's Ask
First item for wording. Put each sentence in a words module and pin it with a test that reads it
back. `{shown}` and `{total}` are exact numbers.

- Jump list, Escalations past the bound: "Showing the first {shown} of {total} Escalations."
- Jump list, Exceptions past the bound: "Showing the first {shown} of {total} Exceptions."
- How to reach the rest: "To see one of the rest, open its record in the record review and choose
  Replay."
- The Observation count beside each frame is EXACT: it is read from the database for each frame,
  not counted from a bounded page of registration events. So the existing sentence "{count} had
  been registered when this screen was captured." stays true, and no new sentence is needed.

The owner did not approve raising `REPLAY_PAGE_SIZE` or `REPLAY_FRAME_LIMIT`; they stay as they
are. A sentence this list does not hold is still Ask First.


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


## Review Triage Log

### 2026-09-26 — Continuation review

Four independent reviewers inspected the original `baseline_revision` diff and the
story-specific diff against inherited Story 10.6 (`88c25e0`). The frozen block and original
baseline are unchanged. Merge commit `39271d5` brings in that 10.6 checkpoint without rewriting
history. Review layers: blind hunter, edge-case hunter, verification-gap reviewer, and
intent-alignment auditor. The edge-case and verification-gap reviewers returned no findings;
the blind and intent reviews identified the issues below.

- intent_gap: 1 (high 1): the existing record-inspection continuation does not establish
  individual reachability for omitted Escalations or late session-owned frames. The owner
  approved the bound sentences and an existing inspection path, but not a new continuation
  surface. Keep this as an explicit unresolved delivery decision; no scope acceptance is
  inferred from the approved wording.
- bad_spec: 0
- patch: 3 (medium 2, low 1)
- defer: 1 (medium 1): the inherited independently bounded Timeline join above.
- reject: 1: the selected-inspection page does not display the optional clicked-record counter;
  its `jumped` state starts null and it has no jump buttons. The bounded default-view counter
  was a separate real issue and is fixed.
- addressed_findings:
  - `[medium]` `[patch]` Use SQL's exact `framesThrough` ordinal for in-prefix Escalation
    landing. Re-parsing millisecond timestamps could select a later capture or invent a
    preceding capture. Two regressions failed before the fix and pass after it.
  - `[medium]` `[patch]` Withhold the optional record denominator after a Work Item click
    when the default view is bounded. The exact whole-session counter remains visible.
    Add a browser assertion to the existing over-bound fixture.
  - `[low]` `[patch]` Seed the P-4 browser fixture with retry-or-skip answers, not
    choose-candidate answers which P-4 refuses; give pause rows their own Resume option.

## Remaining continuation decision

The current implementation accurately announces omitted Escalations but does not provide an
individual list/link for Escalations 501 onward. Record inspection pages have no Escalation
jump list. A listed Escalation whose landing frame belongs to no Work Item and is beyond the
prefix has no inspection continuation. A listed late Escalation with an owner opens the page
containing its frame, but starts at that page's first frame; the particular landing within the
page is not preserved. These are concrete limitations, not completed reachability proof.

The browser fixture proves a listed Escalation at frame 501 and an omitted Exception through
record review. It does not prove an omitted Escalation or an arbitrary late landing such as
frame 510. The contract's statement permitting a session-owned target to have no link is not
an owner-approved exemption from the frozen reachability requirement. Story 10.10's composed
deep-link work must be assessed before choosing a shared continuation solution. No new wording
or route is approved by this record.

## Auto Run Result

**In progress; blocked, not done.** Existing implementation: exact full-history Observation
counts, exact totals with the approved bound note, deterministic raise order, and inspection
page links for late owned frames. This continuation merges the authorized 10.6 branch and fixes
precision, a remaining bounded counter, and fixture realism. The three patches give a follow-up
review score of `3 × 2 + 1 = 7`; `followup_review_recommended: true`.

Changed continuation files:
- `apps/web/src/runs/replay.ts`: retain the database's exact landing ordinal.
- `apps/web/src/runs/replay.test.ts`: two timestamp-precision regressions.
- `apps/web/src/runs/ReplayViewer.tsx`: do not imply a bounded record count is exact.
- `tests/e2e/replay-bounded-history.spec.ts`: assert the counter behavior and use valid P-4
  Escalation kinds/options.
- `docs/contracts/replay-v1.md`: exact ordinal and bounded record-counter behavior.
- This story and `CLAUDE.md`: review findings, verification evidence and reusable decision.

Verification is recorded below after the exact-runtime checks finish. Integration, browser and
fresh screenshot review are not claimed from an unexecuted local environment. The existing
historical handover results are pre-merge evidence only. This remains a WIP checkpoint until the
new candidate's required gates and the continuation decision are resolved.

### Verification of the continuation candidate

- Exact runtime: Node **24.20.0**, pnpm **11.25.0**; frozen-lockfile install passed.
- `pnpm typecheck`: passed, including root test types.
- `pnpm boundaries`: passed, 816 modules.
- `pnpm test`: **299 files, 5,518 tests passed**. The precision regressions also ran red
  before the fix (2 failures) and green afterward (36 replay tests).
- `git diff --check`: passed. YAML parsed; the frozen block matches the inherited version.
- A follow-up read-only review of the three patches found no new issue.
- An earlier run on supplied Node 24.19.0 passed 5,515 tests and failed one boundary mutation
  case because a transient `.rsync-tmp/violation.ts` vanished during dependency scanning.
  Its stale ignored fixture was removed after the run ended. The exact-runtime run above is
  the final complete unit result; no test was skipped or weakened.
- Local integration fails its explicit missing-`DATABASE_URL` guard. Provisioning could not
  start PostgreSQL 18 in the available UID-0-only runtime. Chromium download did not provide
  a runnable browser. Full integration/browser and fresh screenshot proof remain unverified
  locally; the existing draft PR CI must verify this new checkpoint before finalization.

This is an explicitly incomplete WIP checkpoint for remote CI and owner review, not a done
story. No main merge, deployment, history rewrite, or PR-ready transition was performed.


### Composed candidate verification (2026-09-26)

Merged published Story 10.6 continuation `eedec7c890dc26f024b8f6350a636743f2b88113`
without rebasing. The combined source passed exact Node 24.20.0 / pnpm 11.25.0 root
TypeScript checks, boundaries (817 modules), and 5,530 unit tests in 300 files.
Verification ran in an isolated `/tmp` worktree at `21ec201`: workspace synchronization
had injected a transient `.rsync-tmp/violation.ts` inside the boundary mutation fixture.
No assertion was weakened or skipped; the complete unchanged gate passed outside that
synchronization path. Fresh PR CI must still supply PostgreSQL/browser verification and
visual acceptance remains open. The latest changes after this gate are this record only.


### Stacked-PR CI admission

The existing CI workflow admitted only PR bases `main` and `codex/epic-5-controls`.
This excluded the handover's stacked PRs based on `claude/10-6-legacy-visibility`,
so publishing their code did not start a verification run. Added that exact base to the
pull-request filter. Job definitions, permissions, test assertions and main-only push
behavior are unchanged. The workflow YAML was parsed and both branch filters checked.
