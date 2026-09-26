---
title: 'Retained decision history on the Execution Timeline: an answered Escalation and a superseded pause are inspectable entries'
type: 'fix'
created: '2026-09-25'
status: 'in-progress'
review_loop_iteration: 0
implementation_authorised: true
baseline_commit: '3d999798db9d861efe3be66f97a93d2ebdaaf489'
authorisation: 'Owner request, 2026-09-26: implement remaining legacy stories in parallel.'
context:
  - '_bmad-output/implementation-artifacts/legacy-review-closure-register.md'
  - '_bmad-output/planning-artifacts/epics.md'
  - 'docs/contracts/durable-escalation-v1.md'
  - 'docs/contracts/run-pause-v1.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Legacy Stories 4.8 (AC 4) and 5.6 (AC 3) say that an answered or aborted Escalation
"becomes a Timeline entry", and Story 5.4 (AC 3) says a superseded pause is "recorded as superseded
on the Timeline". The closure register (Story 10.1) found that the Execution Timeline tab renders
no Escalation row and no superseded-pause row; only the chain events exist
(`execution.escalation-answered`, `lifecycle.pause-superseded`), and Replay lists the Escalation
as a jump target. The owner decided on 2026-09-25 that an event in the audit chain is not a
user-visible history entry: the storage evidence stands as proven, and the missing presentation is
this story's.

**Approach:** Add a compact, inspectable entry or link on the Execution Timeline tab for each
completed decision, read from the stored chain and wait rows: the decision, the actor (a name),
the time, and the related Work Item and Step where one exists. No full expanded panel.

## Boundaries & Constraints

**Always:**
- The entry is read from durable records; nothing is inferred by nearest time. A historical
  decision whose related work cannot be established says so.
- Words come from the existing modules (`ESCALATION_KIND_WORDS`, `ActorName`), pinned by tests.
- WCAG 2.1 AA on the changed tab; the entry is reachable by keyboard.

**Ask First:**
- Any new sentence (owner confirms wording before it is built).
- Any change to the Timeline's row hierarchy beyond adding these entries.

**Never:**
- Rewrite, backfill or re-sign a historical audit event.
- Show the question, options or note text as the platform's own prose (untrusted content rules).
- Start before explicit implementation authorisation (story preparation only, 2026-09-25).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Answered Escalation | a closed `run_wait` with `closure_kind = 'answer'` and its `execution.escalation-answered` event | A compact entry: kind, the chosen answer, the actor's name, the time, the Work Item and Step; links to Replay's jump target | N/A |
| Aborted Escalation | `closure_kind = 'answer'`, option `abort`, the Run `CANCELED` | The entry says abort, with actor and time | N/A |
| Superseded pause | `lifecycle.pause-superseded` at the terminal transition | A compact entry: requested by whom, when, and that the Run ended first | N/A |
| Historical record | a decision whose Step cannot be established from durable records | The entry shows the decision and says the related work is not recorded | N/A |

</frozen-after-approval>

## Code Map

- `packages/infrastructure/src/runs/run-detail-repository.ts` (`RunTimelineRead`) -- the Timeline read; add the decision entries
- `apps/web/src/runs/Timeline.tsx`, `apps/web/app/runs/[id]/timeline/page.tsx` -- the tab
- `apps/web/src/design/plain-words.ts` (`ESCALATION_KIND_WORDS`), `apps/web/src/runs/ActorName.tsx` -- the words
- `tests/e2e/escalations.spec.ts`, `tests/e2e/live-escalation.spec.ts`, `tests/e2e/pause-resume.spec.ts` -- journeys that produce the decisions; assert the entries

## Tasks & Acceptance

**Execution:**

- the read and the entries
- tests: integration (the read on PostgreSQL 18), unit (words and branches), browser (each entry, WCAG 2.1 AA)

**Acceptance Criteria:** as `epics.md`, Story 10.10.

## Implementation checkpoint — 2026-09-26

Owner authorised implementation in the current request. The frozen intent above is unchanged.
The code reads immutable answer/raise records and same-Run closed waits, and displays named
actors, fixed answer words or labelled untrusted candidate text, timestamps and exact work
links. A historical missing Step reuses `ESCALATION_PANEL_COPY.noStep`; missing Work Item
and unavailable name are short labels, not new sentences. Superseded pauses reuse the existing
`Pause requested.`, `Superseded` and Run-state words with both request and completion times.
No new sentence or row hierarchy has been introduced.

- [x] Bounded durable decision read, exact total, sequence continuation and selected-wait resolution.
- [x] Compact answer/abort/superseded pause entries; existing vocabulary; no question/note projection.
- [x] Six new unit branches and 63 existing RunDetail tests passed (69 total).
- [x] Full monorepo and root-test typecheck; dependency boundaries (804 modules) passed.
- [ ] PostgreSQL 18 integration acceptance: tests written, requires hosted execution.
- [ ] Browser/axe acceptance: answered candidate work link and abort/superseded-pause journeys written, requires hosted execution.
- [ ] BMAD independent review and matrix verification, owned by the parent workflow.

Replay escalation deep links use `?wait=<wait-id>#replay-escalation-<wait-id>`. The same-Run
wait-ID page resolver is Story 10.9's dependency for a target beyond the first Replay page;
Story 10.10 must be verified and delivered with that resolver available. Timeline itself uses
`?wait=<wait-id>#wait-<wait-id>` and resolves all retained decision pages independently.

No migrations, historical rewrites, external renames, deployment, merge or tenancy approvals.
Local PostgreSQL/browser execution is unavailable in this managed environment, so tests are
not represented as passing before hosted CI runs. Status remains in progress.

### Review repair checkpoint

Accepted independent review findings: corrected UUID/text SQL joins; selected waits now resolve
only from the same qualified decision relation; uppercase UUIDs normalize; malformed, repeated,
unknown, foreign and conflicting selectors never fall back to unrelated history. Invalid or absent
selection uses the existing 404 flow. Active Run decisions keep exact Timeline Work Item links;
terminal-only Replay links appear after completion. Superseded pause related work remains
explicitly unrecorded. PostgreSQL tests now cover unique, ambiguous and foreign evidence-turn
bindings. The composed browser test follows a Timeline decision beyond Replay's first 500 waits,
activates its jump with the keyboard and verifies the exact rendered frame plus axe.

Targeted verification after repairs: 80 tests passed (7 decision rendering, 10 selection parser,
63 existing RunDetail). Earlier full suite: 5,395 passed; one boundary-mutation fixture failed
because dependency-cruiser saw a disappearing `.rsync-tmp/violation.ts` (not a product assertion).
No false full-suite pass is recorded. PostgreSQL/browser proof still requires hosted CI.

### Composed checkpoint verification

This branch is stacked on Story 10.9 commit `3d999798db9d861efe3be66f97a93d2ebdaaf489`
(PR #57), so its Replay destinations exist in the tested tree. The shared large-history
fixture contains one 500-wait expansion, the real answer envelope and the composed
Timeline-to-Replay keyboard/capture assertion. No branch or PR was merged.

The composed tree passed 166 targeted Replay/Timeline/RunDetail tests, full typecheck
and boundaries (807 modules). Frozen-policy candidate labels are redacted before
projection if a lookup key is sensitive or policy is unavailable; UI also fails closed.
Unrelated Timeline section selectors remain compatible with pause-history pagination.
Hosted PostgreSQL and browser results are still required before completion.

CI base filter now includes `codex/story-10-9`; the original stacked PR did not trigger CI under the old main/Epic-5-only filter. No missing workflow was counted as a pass.
