# Run-level Evidence Quality Gate contract, schema 1

This is the normative contract for the Gate that runs when a Run's last Work Item
completes, and for the mapping from an exhausted limit or a failed unit to a Run outcome.
It implements addendum §H and §E.1's limit-exhaustion mapping. The vocabulary and the
decision live in `packages/domain/src/runs/gate.ts` and
`packages/domain/src/runs/limits.ts`; the one transactional command is
`packages/application/src/runs/run-gate.ts`; the rows are `run_gate_check`
(generation 24).

## The row set is a transcription

`GATE_CHECKS` has exactly the twenty rows of addendum §H, in the addendum's own order.
`tests/unit/gate-vocabulary.test.ts` reads the addendum **off disk** and compares — a list
asserted against a copy of itself proves only that it equals itself, and this one decides
whether an audit Run may conclude.

Every Run that reaches the Gate gets **twenty rows**, whatever happened. A row that found
nothing is a `PASS` that was actually evaluated; an absent row is indistinguishable from a
row nobody wrote.

## Who decides which row

The Gate never re-runs a check somebody else recorded. It **consumes** what earlier stories
stored.

| Source | Rows |
| --- | --- |
| Story 3.2's population reconciliation (`population_snapshot.checks`) | population acquisition, both count-reconciliation rows, empty population, schema, extraction completeness, snapshot freshness |
| Stories 3.4 and 3.6's per-Observation checks (`run_observation_check`) | identity corroboration, search completeness, required Evidence, observation corroboration, ambiguous match, Observation freshness |
| Decided here, from facts those stories captured | workspace and Target System access, per-record coverage, condition completeness, mandatory values, duplicate primary keys, unnamed value, integrity |

A roll-up is not a second copy: it reads the outcome that was recorded. Two
implementations of one rule agree on every case anybody thought to try and diverge on the
first one nobody did, and here the divergence would be an audit conclusion.

`POPULATION_CHECK_DIAGNOSTIC` is typed `Record<PopulationCheckName, GateDiagnostic>` and
`POPULATION_CHECK_NAMES` is the closed union the reconciler itself is typed against, so a
population check added without a §H row does not compile. The per-Observation table is
`Record<ObservationCheckName, GateDiagnostic>` for the same reason.

## The failure outcome belongs to the DIAGNOSTIC

§H gives two rows both outcomes — population acquisition is `RUN_FAILED` when acquisition
cannot complete and `INCONCLUSIVE` when the declaration is absent or contradictory, and
pagination/extraction completeness has the same shape — so a table keyed by row cannot
express the addendum without losing half of it. `GATE_DIAGNOSTIC_STATE` is keyed by
diagnostic and is exhaustive by type.

`RUN_FAILED` outranks `INCONCLUSIVE`. §E.1 applies its rows in order with the
execution-failure row above the Gate-failure row: execution or integrity failing is a
stronger statement than Evidence falling short.

Diagnostics are a **closed vocabulary of constants**: never an error message, never a URL,
never a captured value, never a credential reference. `run_gate_check_diagnostics` pins the
set inside the jsonb by containment, which refuses a number, an object and an undeclared
spelling alike.

## The unnamed-value row matches §B's own sentence

§B is explicit: "when a compiled condition meets an attribute value outside the set it
names, the condition evaluates Unevaluated with diagnostic `rule does not name value
<v>`". `RULE_DOES_NOT_NAME_VALUE` is exported from the compiler and matched by the
repository, so the wording lives in one place.

A value the condition NAMES and could not read is a different defect —
`missing or invalid Observation field <x>` — and belongs to the coverage and
mandatory-value rows. Matching that here put every ambiguous record on the unnamed-value
row too, because an `ambiguous` match has no boolean reading of `found`.

## Each finding is named, and each raises its own Gate event

An empty mandatory identifier, a duplicate primary key, an unparseable timestamp and an
undeclared schema field are four different defects with four different repairs. Each has
its own diagnostic, and the command appends one `execution.gate-checked` Timeline event per
`(row, diagnostic)` pair — plus one per passing row and one summary. Bounded by the
vocabulary (twenty rows, thirty-three diagnostics), never by the population.

Affected identities are recorded as an **exact `total` beside a bounded sample** of at most
`GATE_AFFECTED_LIMIT` (32) systems, Work Items and records. A Run over a hundred thousand
records has to be able to commit its own conclusion; a payload that grew with the
population would be a Run that concluded and could not say so.

## Freshness names WHICH way a snapshot is unfit

`snapshotFreshness` returns `snapshot-stale` (generated before the END of the effective
period), `snapshot-future-dated` (generated after Run initiation) or
`snapshot-generation-unknown` (absent, unreadable, or an impossible calendar date). All
three are `INCONCLUSIVE`; a single passed/failed boolean tells an auditor none of it.

The generation time is stored in `population_snapshot.generated_at` (generation 24), from
the declaration the acquisition preserved. It is nullable and **not backfilled**: a row an
earlier build wrote reads as "unknown", which is the fail-closed direction. It is never
defaulted to `now()` — a fabricated generation time would put a fact nobody measured into
an audit conclusion.

## Per-record coverage is a matrix

Every included population record × every required Target System (the frozen plan's
`api` Targets). A cell is `COVERED`, one of the two unusable states, or missing entirely:

| Cell | Diagnostic |
| --- | --- |
| no Observation at all | `record-uncovered` |
| `UNINSPECTED` (an absence that could not prove it looked) | `record-uninspected` |
| `AMBIGUOUS` (more than one candidate) | `record-ambiguous` |

A record whose key the extraction could not use has no Observation; inventing coverage for
it is exactly the lie this row exists to catch.

## The population field rows

One streaming pass over every parsed row decides schema, mandatory values, duplicate
primary keys and the unparseable timestamps §H folds into mandatory values.

The **required evaluation fields** are the Template's declared Observation fields
INTERSECTED with the binding's declared schema. `COMPLIANCE_OBSERVATION_FIELDS` is the
union across the population and every Target System — P-3 declares `decision`, which lives
in the approvals system — so requiring all of them of a population row would fail a correct
Run. That is the `required-evidence` lesson (observation registration v1) one layer along:
what the population DECLARED it carries is what it must carry.

**Duplicates are counted over every parsed row**, not only the included ones. §H says "No
duplicate Source primary key", and a duplicate that inclusion happened to filter out is
still two Source rows claiming one identity. A version that explicitly permits versioned
records (`allowVersionedDuplicates`) turns the row off.

## Limit exhaustion, and the states this story may produce

`RUN_STOP_TABLE` is a transcription of §E.1:

| Cause | Run state | Security event |
| --- | --- | --- |
| Run-level Step Execution limit | `INCONCLUSIVE` | no |
| Run-level time limit | `INCONCLUSIVE` | no |
| Run-level token limit | `INCONCLUSIVE` | no |
| Session Step failed after bounded retries | `RUN_FAILED` | no |
| denied action | `RUN_FAILED` | **yes** |
| scope violation | `RUN_FAILED` | **yes** |
| in-Run integrity mismatch | `RUN_FAILED` | no |

**`CANCELED` is never produced here.** It is reserved for a person cancelling a Run
(Story 3.10). A timeout that produced it would put a Run nobody cancelled into the one
state whose whole meaning is that somebody did, and the §E.1 outcome rules read that state
to decide what a human may do next.

Partial Evidence is preserved on every stop, and that is a property of the mechanism rather
than a promise made per branch: `SealPackage` runs at every terminal transition and a
`REGISTERED` artifact is never demoted.

The limits are **read from the plan the version froze** (`EXECUTABLE_PLAN_LIMITS` as
carried in `plan.limits`), never restated. Step Executions count ATTEMPTS: a Run that
retried its way to the limit has spent it exactly as one that succeeded would have. Tokens
are zero for every Run of this epic — the adapter path calls no model — and the counter is
passed anyway so the agent epic fills it rather than adding a limit that was never mapped.

## Retry cycles

`attemptsPerCycle` is `plan.limits.retriesPerStep + 1`. From it:

- an **adapter Work Item** gets `ADAPTER_RETRY_CYCLES = 2` — the owner's 2026-09-05
  decision: one automatic extra bounded cycle after the first exhaustion, then `FAILED`,
  the Run CONTINUES, and incomplete coverage becomes `INCONCLUSIVE` at this Gate. No human
  retry-or-skip Escalation on this path.
- a **Run-level Session Step** gets `SESSION_STEP_RETRY_CYCLES = 1`. §E maps its failure to
  `RUN_FAILED`, so a second cycle — which exists to let a Run continue past a failed unit —
  has nothing to buy.

Both cycles obey the frozen per-Step retry limit and every attempt starts a Step Execution,
so every attempt counts against the Run limits.

A **denial, a scope violation, an unresolvable credential and a refused registration** are
terminal for the Work Item whatever the budget says: the same request produces the same
answer. The first two are terminal for the RUN as well, with a `security.action-denied`
event beside the state change.

A 401 or a 403 from a Target System is `denied`, not `transport`. It used to land in
`!response.ok`: the Work Item was retried three times against a system that would go on
refusing, and the only durable record that the platform had been told no was a transport
count.

## Where the Gate runs, and why there is no seam

`AdapterExecutionContext` **extends** `RunGateContext`, so the stage that finishes the last
Work Item already holds everything the Gate needs. There is no dependency to inject and
none to omit — Stories 3.6 and 3.7 both removed such a seam rather than leave one, and a
Gate a composition root could switch off is a Run that concludes without one.

The Gate rows, every Timeline event, the terminal Run state and the Evidence package seal
commit in **one transaction**. Generation 21's deferred constraint trigger refuses a Run
that reaches a terminal state without a package row, so a branch that forgot to seal would
not ship an unsealed Run — it would fail to commit.

## A Gate failure is never repaired by re-running a check

The rows are written once. `readGateChecks` returns what is already there and the command
then writes nothing — not a row, and not a second Timeline event, which an insert guarded
only by `ON CONFLICT DO NOTHING` would still have appended. Generation 24 refuses an
`UPDATE` to `run_gate_check` outright, in a trigger; `DELETE` stays permitted because
removing a Run takes its Gate rows with it, which is a different act from rewriting one
row's outcome.

## What this contract does not decide

Result sealing and the Result version (3.9), cancellation and the linked rerun (3.10), and
how the Gate rows are rendered on the Run Detail surface (3.11). Each of those reads these
rows; none of them replaces the decision that wrote them.
