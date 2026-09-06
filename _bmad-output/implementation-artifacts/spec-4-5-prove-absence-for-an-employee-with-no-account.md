---
title: 'Story 4.5: Prove absence for an employee with no account'
type: 'feature'
created: '2026-09-06'
status: 'ready-for-dev'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-fixture-map.md'
  - '{project-root}/docs/contracts/observation-registration-v1.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** "No account found" is the finding P-1's condition C1 is looking for — a terminated
employee with no live account is the COMPLIANT case. So an agent that searched badly, timed out,
or read half a result page and then reported "not found" manufactures a passing control. An
absence is the one claim where believing the agent is the same as fabricating Evidence.

**Approach:** The absence machinery already exists and is already proven — `judgeAbsence` in
`packages/domain/src/runs/observation.ts` takes three legs and fails on any one of them, and
Story 3.4 built it for the adapter path. This story supplies its three inputs from the AGENT
path: the query keys come from the sanitized `type` Tool Action, the empty-result page is
captured as a Structural Snapshot and frozen, and completeness comes from the result page being
consumed to its end. Nothing new judges an absence.

## Boundaries & Constraints

**Always:** The query string compared is the one the SANITIZED `type` Tool Action actually put
into the search box — never a value the agent reported having searched for. It is compared,
after §B normalization, with the population record's value for EVERY declared search key: P-1
declares `employee_id` AND `full_name`, so an agent that searched one of them has not proven
anything and the record stays `UNINSPECTED`. That rule is `judgeAbsence`'s loop and already
exists; this story must supply all the declared keys to it, not the first. The empty-result page
is captured as a Structural Snapshot, frozen through `freezeArtifact`, LINKED on the Observation
and REGISTERED — `empty-result-unlinked` and `empty-result-unregistered` are separate failures
because a snapshot named but not stored and a snapshot stored but not named are different lies.
Completeness means the result page was consumed to its end: no truncation, no unfollowed
pagination, no silent timeout. `extractionComplete: false` makes the absence dishonest.

**Never:** Never let a failed leg produce a Compliant. A dishonest absence is `UNINSPECTED`,
which the generation-20 composite foreign key already makes impossible to evaluate COMPLIANT —
so this is enforced below the command as well as in it. Never trim, case-fold or numeric-parse a
query key comparison: §B's rule is exact normalized identifiers, and `judgeAbsence` compares
opaque strings deliberately. Never treat a search that returned rows as an absence: zero rows is
the absence path, one matching row is Story 4.4, more than one is Story 4.7's Escalation.

**Scope:** P-1's C1 golden cases. The addendum §D silent-timeout / partial-pagination case and
the mistyped-search-key case must both yield `UNINSPECTED` and an Inconclusive Run.

## I/O & Edge-Case Matrix

| Input | Expected |
|---|---|
| Both declared keys searched, both matching the record, empty page frozen and linked, page fully consumed | `found: 'false'`, coverage `COVERED` under a `found-or-proven-absent` Template, C1 Compliant |
| Only `employee_id` searched | `query-key-missing` → `UNINSPECTED` |
| `employee_id` searched with a mistyped value | `query-key-mismatch` → `UNINSPECTED` (addendum §D mistyped-search-key case) |
| Result page truncated by a silent timeout | `extraction-incomplete` → `UNINSPECTED` (addendum §D partial-pagination case) |
| Empty-result snapshot named but never registered | `empty-result-unregistered` → `UNINSPECTED` |
| No absence proof supplied at all | `absence-proof-missing` → `UNINSPECTED` |
| The Template's coverage rule is `must-appear` (P-2) | `UNINSPECTED` whatever the proof — the rule decides, not the proof. Already true; assert it |
| Run contains one `UNINSPECTED` record | §H per-record coverage fails → `INCONCLUSIVE`, never a false Compliant absence |

## Code Map

**Modified:**
- `packages/application/src/runs/execute-agent-work-item.ts` — the absence branch. Builds
  `ObservationAbsenceProof` from the sanitized Tool Actions and the frozen empty-result
  snapshot, and hands it to `registerObservations`, which already judges it.
- `apps/web/src/runs/` — the Observation card states the absence and which legs proved it, in
  words. A record marked absent with no visible proof is what this story exists to prevent, so
  the surface says what was searched and where the empty page is.

**Reused unchanged:** `judgeAbsence`, `isHonestAbsence`, `observationCoverage`,
`ABSENCE_FAILURES`, the composite foreign key, the §H coverage row.

**New:** nothing in the domain. If this story finds itself adding an absence rule, that is a
signal the adapter path and the agent path have diverged and it must be reconciled instead.

## Tasks & Acceptance

1. **Query keys from the sanitized Tool Action.** Every declared search key, with the value
   actually typed. The derivation is the platform's, from the recorded action, never the agent's
   narration.
2. **The empty-result Structural Snapshot.** Captured, frozen, linked, registered.
3. **Completeness.** The result page consumed to its end; a timeout or an unfollowed page sets
   `extractionComplete: false`.
4. **The golden §D cases.** Both the silent-timeout/partial-pagination case and the
   mistyped-search-key case produce `UNINSPECTED` and an Inconclusive Run, asserted against the
   expectation files read OFF DISK (AD-12).
5. **The surface.** The absence and its proof legs are visible on the Observation card.

## Design Notes

**Why nothing new is written in the domain.** `judgeAbsence` was built in Story 3.4 with the
adapter path as its first caller and a closed `ABSENCE_FAILURES` vocabulary. Story 1.7's lesson
— "a story that repeats another's shape inherits its defects" — cuts the other way here: a
second absence judge written for the agent path would agree with the first on every case
anybody thought to try and diverge on the first one nobody did, and each would look correct
because each would be checked only against itself. The one judge, two producers.

**Why the sanitized Tool Action and not the agent's report.** AD-9. The agent's narration is
agent-generated content and cannot be a source of platform facts. The `type` action is a
recorded platform event; its query string is a fact about what the browser did.

## Verification

- Unit: each of the six `ABSENCE_FAILURES` reachable from the agent path.
- Integration: an absence Work Item against real PostgreSQL, with the empty-result snapshot
  really frozen and really registered.
- Browser: the P-1 journey for an employee with no LoanCore account, end to end through the real
  worker, asserting the golden expectation.
- Mutation: supply only the first declared search key and prove a test fails.

## Auto Run Result

_Not yet run._
