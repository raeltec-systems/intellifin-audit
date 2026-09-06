# The sealed Result, schema 1

This is the normative contract for the System Outcome of a Run and for the Result that
publishes it. It implements addendum §E.1's outcome table and §E's "Result sealing"
sentence. The vocabulary and the decision live in `packages/domain/src/runs/outcome.ts`,
the published document in `packages/domain/src/runs/result.ts`, the one transactional
command in `packages/application/src/runs/complete-run.ts`, and the row is `run_result`
(generation 25).

## The table is a transcription, and the ORDER is the contract

`OUTCOME_ROWS` has exactly the seven rows of addendum §E.1, in the addendum's own order,
with the first, second and fourth cells transcribed verbatim.
`tests/unit/outcome-rules.test.ts` reads §E.1 **off disk** and compares them cell by cell —
a table asserted against a copy of itself proves only that it equals itself, and this one
decides what an audit Run concluded.

| # | Evidence or execution state | Evaluation state | Outcome |
| --- | --- | --- | --- |
| 1 | Run canceled | Not completed | `CANCELED` |
| 2 | Run-level failure after bounded retries, or denied action | Not completed | `RUN_FAILED` |
| 3 | Gate fails; or Pause or Escalation timed out | Not authoritative | `INCONCLUSIVE` |
| 4 | Gate passes | Any Agent-Judged evaluation pending | `PENDING_CONFIRMATION` (unsealed) |
| 5 | Gate passes, sealed | Any condition `UNEVALUATED` and no Exception counts | `INCONCLUSIVE` |
| 6 | Gate passes, sealed | Any Exception counts | `CONTROL_FAILURE` |
| 7 | Gate passes, sealed | Every condition Compliant | `PASS` |

The rows apply **in order** and the **first matching row wins**. That is why they are an
array of predicates rather than a chain of conditionals somebody can reorder without
noticing: a Gate failure on a Run that also raised an Exception is `INCONCLUSIVE`, and the
only thing that makes it so is that row 3 sits above row 6. Both golden populations
exercise exactly that — P-2 raises three Exceptions and P-3 four, and both are Inconclusive.

**All seven rows are implemented even though this epic can reach only five.** Epic 3
produces evaluations of origin `RULE` only, so nothing is ever `pending` and row 4 cannot
fire; row 5 fires "by human rejection", which is Epic 6. Both are written, ordered and
tested with a constructed state, because the order is the contract and a table that grows
one row per epic ends up not being a table.

## A passed Gate is necessary and never sufficient

The Gate asks whether the Evidence supports a conclusion; the outcome asks what that
conclusion is. Deriving either from the other — reading "the Gate passed" out of the
absence of an Exception, or "no Exception" out of a passing Gate — is the mistake this
story exists to prevent.

So `gatePassed` is READ from the twenty `run_gate_check` rows Story 3.8 wrote, and the
evaluation facts are READ from the `run_observation_evaluation` rows Story 3.7 wrote.
**Fewer than twenty rows is not a pass either**: a Run stopped by a limit, a denial or a
Session Step failure never reached the Gate and has no rows at all, and an unrun Gate is
not a passed Gate — the same fail-closed reading `snapshot-generation-unknown` takes.

`run_result_pass_requires_gate` says the necessary half where nothing can route around it:
a `PASS` row cannot exist with `gate_passed = false`, from a command, a migration or psql.

## Two rows' preconditions are the ORDER

Rows 4 to 7 all carry "Gate passes" in their evidence cell, and none of their predicates
mentions the Gate. They do not have to: row 3 matches whenever the Gate did not pass, so by
the time the walk reaches row 4 it did. Writing the precondition into each predicate as
well would be four copies of one fact, and the copies are what drift.

## Row 5's parenthetical is provenance, not a predicate

§E.1 reads "Any condition on any record `UNEVALUATED` (by human rejection) and no Exception
counts". The parenthetical names the case the row was written for — every other way a
condition ends up Unevaluated is caught by a §H row above. It is deliberately NOT part of
the predicate: made one, an `UNEVALUATED` of any other origin would match no row at all and
fall through to row 7, whose own cell requires "every condition on every record Compliant".
A table with a hole in it is worse than a table with a wide row, and "Excluded, uninspected
and Unevaluated records are never counted Compliant" is the rule this keeps.

The golden data has the case: P-2's `AG-1008` carries an empty role list, so its rule is
`missing or invalid Observation field roles` and its evaluation is `UNEVALUATED` — and NO
§H row fails for it. `mandatory-values` tests a declared field for `undefined`, `null` or
`''`, and an empty array is none of the three. In that population three other records do
fail §H rows, so the Gate fails anyway; a population whose only defect were AG-1008 would
pass its Gate with a record nobody evaluated, and row 5 is what makes it Inconclusive
rather than a Pass.

With the parenthetical read as provenance, the table is TOTAL: rows 1 to 3 cover every
terminal state but `COMPLETED`, and rows 4 to 7 partition (pending) × (Exception) ×
(Unevaluated). `systemOutcome` throws `UnmatchedOutcomeError` rather than defaulting,
because a default would quietly become the eighth row.

## `sealed` means final, and only one outcome is not

`sealed` is true for every outcome except `PENDING_CONFIRMATION`, which §E.1 itself marks
"(unsealed)" and which is the one Result waiting for something. §E's sentence — "a Result
seals when the Evidence Quality Gate has passed and no condition evaluation is pending" —
describes the `COMPLETED` path, the only path on which sealing is a decision rather than a
consequence; a Canceled, Run Failed or Gate-failed Run has nothing left to decide and its
outcome can never change either. Calling those unsealed would say the opposite, and the
immutability trigger keys on this flag.

`version` is 1 when the row is written. The ONE permitted update is the sealing of a
pending Result, which must set `sealed` and must raise the version by exactly one;
generation 25's trigger refuses everything else, including a re-statement of what is
already there. `DELETE` stays permitted, because removing a whole Run takes its Result with
it — the line generations 21, 23 and 24 all draw.

## Where it runs, and why there is no seam

`completeRun` is called at EVERY terminal transition, inside the transaction that takes it,
by both producers — the population stage for a Run that fails before its first Work Item,
and the adapter stage (through the Run-level Gate) for everything else. `RunResultContext`
is extended by both execution contexts, so there is no dependency to inject and none to
omit. `audit_run_requires_result` is a DEFERRED constraint trigger: a branch that reaches a
terminal state without a Result does not ship a Run nobody can read, it fails to commit.

The order inside the transaction is load-bearing:

1. decide, from the facts, with no writes at all;
2. take the Run state the decision implies — row 5 is §E's `COMPLETED → INCONCLUSIVE`,
   "only at Result sealing";
3. seal the Evidence package AT that state, so the package records the state the Run
   actually reached;
4. publish over the seal, and write the Result.

The outcome is computed **exactly once**: `readResult` returns what is already there and
the command then writes nothing, so a redelivered job cannot recompute an outcome.

## What the Result publishes

Exact totals beside bounded samples of at most `RESULT_SAMPLE_LIMIT` (32) identities,
the discipline `GATE_AFFECTED_LIMIT` imposes on the Gate's rows and for the same reason: a
Run over a hundred thousand records has to be able to commit its own conclusion.

- the **population** of record: rows parsed, included, excluded, indeterminate;
- the **exclusions**, each with the reason the inclusion rule gave, verbatim;
- **inspected and uninspected records per Target System**, from `coverageFindings` — the
  SAME function the §H per-record coverage row is decided by. A Result that derived the
  matrix a second way could disagree with the Gate it reports;
- **per-condition counts** by origin, confirmation state and value (§B.1);
- the Template's **control-specific fields** (§C), per named finding;
- the version's **scope statement, verbatim**;
- the Gate verdict, the Evidence package seal, and one generated sentence;
- the **artifacts the Run actually froze, by identity** — `evidence.artifacts`, a bounded
  sample beside the exact `evidence.registered` count.

The named artifacts are the owner's decision of 2026-09-06. A count alone cannot tell
"Inconclusive with Evidence" from "Inconclusive with nothing": `registered: 1` says a
number, not which artifact, and a reader cannot follow a number to the bytes. The case it
was added for is a Run that acquired, stored and VERIFIED its population and then crossed
its own time limit — the limit is real and unchanged, the Run still ends `INCONCLUSIVE`,
and the population is still there. They are read from `readPackageArtifacts` AFTER the
seal, so they are the same rows in the same transaction the seal counted; abandonment can
only touch a `RESERVED` row, so the count and the list cannot disagree.

An older published document has no `artifacts` key at all, which is a different statement
from an empty list, and the surface says which.

`null` scope means this build could not read the frozen plan — a different statement from a
scope that is empty, and the Result says which.

## The §C control-specific fields

`TEMPLATE_RESULT_FIELDS` is transcribed from each §C block's own Compliant/Exception
sentences:

| Template | Fields | §C sentence |
| --- | --- | --- |
| P-1 | `account_status`, `username`, `roles` | "Exception when `account_status = active`" |
| P-2 | `roles` | "At least one prohibited pair exists; report every pair." |
| P-3 | `decision`, `approver_limit` | "a matching `APPROVED` decision … and the approver's limit is at least the transaction amount" |
| P-4 | `observed_value`, `approved_value` | "Observed and approved normalized values are equal." |

Every name is one the Template DECLARES (`COMPLIANCE_OBSERVATION_FIELDS`), which
`tests/unit/outcome-rules.test.ts` asserts: a field a Template does not declare is a field
no Observation carries and no rule reads.

Only these fields are published. A Result that carried every attribute would publish the
seeded prompt-like strings beside the outcome they must never influence, and the pairs P-2
reports come from the compiled rules' own diagnostics rather than from a second expansion.

## The zero-record Pass

A version that opted in to a zero-record Pass and whose post-inclusion population is empty
seals as `PASS` with every count 0, and its statement says `No record was inspected.` The
opt-in is the VERSION's and it is consumed by the population reconciliation:
`nonempty-population` passes only when the population is non-empty **or** the version opted
in. Without the opt-in that check fails, §H's empty-population row fails, and row 3 wins.
Nothing in this command fabricates a Pass for an empty population.

## What this contract does not decide

Cancellation and the linked rerun (3.10), and how the Result is rendered on the Run Detail
surface (3.11). Human dispositions, Agent-Judged confirmation and the review lifecycle are
Epic 6; §E.1 rows 4 and 5 are written for them and no producer in this epic can reach them.
