---
title: 'Story 4.4: Locate a record, capture Evidence, and register a grounded Observation'
type: 'feature'
created: '2026-09-06'
status: 'ready-for-dev'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-fixture-map.md'
  - '{project-root}/docs/contracts/observation-registration-v1.md'
  - '{project-root}/docs/contracts/structural-snapshot-v1.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Stories 4.1–4.3 give the agent a workspace, a gated action vocabulary and a
credential. Nothing yet produces the thing an audit is made of. A Work Item has to end in an
Observation whose every attribute traces to Evidence this platform captured, or the Run has
learned nothing it can defend.

**Approach:** The agent locates a record, the PLATFORM captures the Structural Snapshot and the
screenshot at the reading Tool Action, and the Observation is registered through the one write
path Story 3.4 already built. Nothing here is a new Observation mechanism: `registerObservations`
already computes the digest, runs the per-Observation checks, corroborates against the stored
snapshot and evaluates the compiled conditions in one transaction. This story supplies the
`web_tree` producer and the agent-path capture, and nothing else.

## Boundaries & Constraints

**Always:** Capture is the PLATFORM's, never the agent's report — the Structural Snapshot and
the screenshot are taken by the platform at the Tool Action that read the page, each bound to
that Tool Action with LoanCore's URL, and each frozen as Evidence through
`freezeArtifact` before anything names it (FR-10, AD-6, AD-18). Every declared attribute
(`account_status`, `username`, `roles`) is grounded in the STRUCTURAL SNAPSHOT with locator,
label and extracted text. A screenshot is never a grounding source: `ObservationGrounding`
already says so in §B.1 and the check that enforces it already exists. The identity attribute is
grounded in the SAME Structural Snapshot as the value attributes — a different snapshot means
the identity and the values were read from two different documents, which is exactly what
corroboration exists to catch. `matchOrigin` is `platform` when the platform's own key match
found the unique row. Registration goes through `registerObservations` with the corroboration
seam built over the bytes `freezeArtifact` just read back, exactly as `executeAdapterSteps`
does — the seam is BUILT by the stage, never injected, so no composition root can register an
agent Observation as unjudged forever.

**Never:** Never add a key to the §B.1 wire schema. It is thirteen keys, pinned by an
independently produced Python vector, and a fourteenth would move every digest in the product.
The "separate `match` provenance node" the acceptance text asks for is therefore the identity
attribute SURFACED as its own provenance node in the inspector — its `grounding.locator` is the
matched search-result row and its `normalizedValue` is compared with `populationRecordKey` —
not a new field. Never let the agent supply a value that was not read from the snapshot: an
attribute the extractor cannot resolve at its locator is `grounding: null`, which the
`required-evidence` check already fails. Never guess at a missing or unreadable field — the
agent stops and reports, the Work Item is `UNINSPECTED`, and a record with no Observation for a
required Target System stays `UNINSPECTED` (FR-20).

**Scope:** The `web_tree` substrate becomes implemented — it is currently
`corroboration-unsupported` BY NAME in `packages/domain/src/runs/structural-snapshot.ts`, and
this story is what implements it. Absence (`found = false`) is Story 4.5. Agent-Judged
evaluations are Story 4.9; the deterministic evaluator that runs here is the one Story 3.7
built.

## I/O & Edge-Case Matrix

| Input | Expected |
|---|---|
| Search by `employee_id` returns exactly one row whose grounded key equals the record key | Open it, capture, register `found: 'true'`, `matchOrigin: 'platform'` |
| `employee_id` returns nothing, `full_name` returns exactly one matching row | Fall back, register with `matchOrigin: 'platform'`; the fallback is recorded on the Timeline |
| Search returns more than one row with a matching grounded key | No unique match — Story 4.7's *choose candidate* Escalation. This story records the candidates and stops |
| A declared attribute is absent from the snapshot | `grounding: null` for it; `required-evidence` FAILS; the Observation is registered with the failing check |
| The snapshot cannot be captured at all | Tool Action fails; the Work Item retries under its budget; no Observation is fabricated |
| The screenshot fails but the snapshot succeeds | Register. A screenshot grounds nothing, so its absence degrades the record's completeness, not its grounding |
| An attribute's locator resolves to a value differing from what was registered | `snapshotCorroboration` writes `contradictory`; `canBeCompliant` is already false for it |
| Identity grounded in a different Evidence item from the values | REFUSE the batch — `identity-grounding-split`, a new `ObservationCheckDiagnostic` on the existing `required-evidence` check |
| `roles` is a list | `originalValue` is the list exactly as presented; `normalizedValue` is the §B normalization; both are canonical JSON, so `"007"` stays distinct from `7` |

## Code Map

**New:**
- `packages/domain/src/runs/web-tree.ts` — the `web_tree` document shape and its locator
  grammar, extending the one grammar `structural-snapshot.ts` already parses
  (`$.<collection>[<index>].<field>`). No I/O.
- `packages/application/src/runs/execute-agent-work-item.ts` — locate, capture, ground,
  register. Owns the policy; the mechanisms are ports.
- `packages/infrastructure/src/runs/web-tree-capture.ts` — the platform's snapshot capture over
  the browser port from Story 4.1. Outside the barrel the web imports.

**Modified:**
- `packages/domain/src/runs/structural-snapshot.ts` — `web_tree` stops being
  `corroboration-unsupported`; `IMPLEMENTED_SNAPSHOT_SUBSTRATES` gains it.
- `packages/domain/src/runs/observation.ts` — one new diagnostic,
  `identity-grounding-split`. The thirteen wire keys do not move.
- `apps/web/src/runs/` — the grounding inspector opens a `web_tree` snapshot at a locator,
  because `snapshotSubstrateForMediaType` now says it can.

**Reused unchanged:** `registerObservations`, `observationChecks`, `snapshotCorroboration`,
`ruleEvaluation`, `freezeArtifact`, `evidenceIdFor`.

## Tasks & Acceptance

1. **`web_tree` document and locator.** The shape a captured page produces, and its extraction
   under the existing grammar. A Python-produced golden vector, generated by
   `uv run scripts/make-web-tree-golden.py`, whose `producer` the unit test asserts starts with
   `Python` — a vector regenerated from the code under test proves only that it equals itself.
2. **Platform capture at the reading Tool Action.** Snapshot and screenshot, each bound to the
   Tool Action with LoanCore's URL, each frozen through `freezeArtifact`, and the Evidence rows
   written before the Step Execution that names them.
3. **Grounding.** Every declared attribute grounded in the snapshot; identity grounded in the
   SAME snapshot; `identity-grounding-split` refuses the batch otherwise.
4. **Registration.** Through `registerObservations`, with corroboration built over the bytes
   just read back. Per-Observation checks and the deterministic evaluator run in that one
   transaction — which they already do; the task is to prove it for the agent path.
5. **The grounding inspector.** Original value, normalized value, the snapshot at the locator,
   locator and label in mono, corroboration badge with its reason. `UntrustedText` for every
   Target-System-sourced value, per Story 3.11.
6. **`UNINSPECTED` on absence of an Observation.** A required Target System with no Observation
   for a record leaves it `UNINSPECTED`; the agent reports rather than guessing.

## Design Notes

**Why the match node is not a fourteenth key.** §B.1's envelope is frozen and pinned by
`tests/fixtures/observation-digest-golden.json`, produced independently in Python. Adding a key
would move every digest in the product and invalidate the vector that proves the envelope is
what the addendum says. The acceptance text asks that the platform's key match be "recorded as a
separate `match` provenance node comparing the matched-row locator to the record key" — every
part of which the existing `identity` attribute already carries: `grounding.locator` IS the
matched row's locator, `normalizedValue` IS the grounded key, and `matchOrigin: 'platform'`
records who matched. What is missing is only that the inspector presents it as its own node
rather than as one attribute among the others. That is a surface change.

**Why `web_tree` was deliberately unimplemented until now.** Story 3.6 made it
`corroboration-unsupported` BY NAME rather than letting it fall through to "matched", because a
substrate that silently passed for a snapshot nobody read is the defect that story existed to
remove. Implementing it here is the planned removal of that refusal, and the check must go from
FAIL to a real verdict — never to a pass by omission.

## Verification

- Unit: the locator grammar against the Python vector; `identity-grounding-split`; the
  substrate becoming implemented.
- Integration: a Work Item against a real PostgreSQL 18 producing a registered, corroborated,
  evaluated Observation, with the Evidence rows and the Step Execution in the right order.
- Browser: the P-1 LoanCore journey — the agent locates an employee, the platform captures, the
  inspector opens the snapshot at the locator. WCAG 2.1 AA, no allowlist.
- Mutation: invert the identity-same-snapshot check and prove a test fails.

## Auto Run Result

_Not yet run._
