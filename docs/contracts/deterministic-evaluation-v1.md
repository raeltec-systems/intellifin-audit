# Deterministic evaluation and Exceptions contract, schema 1

This is the normative contract for turning a corroborated Observation into an evaluation and,
where a control failed, into a permanent Exception. It is the last seam of
[observation registration v1](observation-registration-v1.md), and it runs inside the one
registration transaction, over the records exactly as they are being stored.

It is implemented by `packages/domain/src/runs/evaluation.ts` (what an evaluation MEANS) and
`packages/application/src/runs/rule-evaluation.ts` (the seam that supplies it with the frozen
inputs). Neither reads `fixtures/northstar/expectations/` — those files are DATA (AD-12) and
only tests read them.

## There is one rules engine, and it is Story 2.4's

`evaluateComplianceRecord` in `packages/domain/src/procedures/plan-compiler.ts` already
implements the approval rule, the permission-pair rule, the closed applicability grammar, the
exact decimal comparisons and the conservative evidence handling — over the conditions the
Procedure Version FROZE and under the compiler version it froze them with. This contract wires
an Observation into that function and maps the answer back onto §B.1's evaluation shape.

A second engine would agree with the first on every case anybody thought to try and diverge on
the first one nobody did, and the divergence would be an audit conclusion. The reduction is the
same one function too: `reduceComplianceEvaluations`, Exception then Unevaluated then Compliant,
with an absent evaluation represented rather than filtered out.

Nothing here consults a model, re-derives a condition from authored prose, or reads anything
outside the three frozen inputs below. Evaluation is **pure**: no clock, no store, no I/O. That
is two requirements, not hygiene — it runs inside a PostgreSQL transaction, and the story's own
acceptance criterion is that repeating it over identical Observations under the same version
yields identical results.

## The three frozen inputs

| Input | Where it comes from | Why it is not read from somewhere else |
| --- | --- | --- |
| the compiled conditions | `plan.inputs` — the version's frozen `complianceConditions`, compiler version and threshold | a current Procedure could have moved |
| the included population | `run_population_row`, as Story 3.2 froze it | `plan.observations` is the UNION across every Target System: P-3 declares `amount`, `currency` and `processed_time`, which live in the population and not in the approvals system |
| the Reference Sources | the bytes the Session Steps froze, re-read through `freezeArtifact`/`readRegisteredArtifact` | what the evaluator consults must be what the freeze established, not what was fetched |

The seam is **built by the stage**, not injected into it. A composition root holds none of the
three, so a seam it supplied could only ever be `NO_EVALUATION` — which is exactly how an
adapter Run would come to register every Observation as unevaluated forever with nothing saying
so. `NO_EVALUATION` remains for a producer with no compiled conditions.

## The values a rule may read

Only the Template's **declared** Observation fields
(`COMPLIANCE_OBSERVATION_FIELDS[templateId]`), and nothing else. The population rows and the
extraction rows both carry columns no condition names — P-2's `username` and P-3's `memo` are
the seeded prompt-like strings — and a value no rule can read is a value no rule can be steered
by. They are Evidence, they are frozen, they are served verbatim, and they do not enter the map.

The population supplies the base and the Observation's own grounded attributes win: the Target
System's reading of a field is what was observed. A field is read through `Object.hasOwn`, so a
Target System answering with `constructor` addresses nothing.

`found` is §B.1's three-valued state narrowed to the boolean the compiled grammar reads. An
`ambiguous` match has **no** boolean reading and is left absent, so a condition naming `found`
is `missing or invalid Observation field found` rather than quietly false.

### The population record must be unique

`populationValues` is `null` unless the included population carries **exactly one** row for the
record key. A duplicate primary key is an Evidence Quality Gate event and the two rows genuinely
disagree — P-3's TX-500008 is 210,000.00 in one row and 215,000.00 in the other — so first-wins,
last-wins and a union each answer a question the population cannot answer. `null` makes the
record ambiguous, which is Unevaluated.

### A role expansion is a LIST of entries

`RoleExpansion` is `{complete, entries[]}`, never a map keyed by role, and `readRoleExpansion`
reads the served CSV through the same RFC 4180 parser the population and the Structural Snapshot
use. The `entry` ordinal is the boundary: the RoleMatrix declares `AMBIGUOUS_DUAL` twice with
different permissions, and merging them yields `CREATE_PAYMENT + RELEASE_PAYMENT` — a prohibited
pair, and a confident Control Failure where the contract requires Unevaluated.

Every failure is `NO_ROLE_EXPANSION`, which `evaluateRule` treats exactly as it treats an absent
expansion (`incomplete role expansion`, therefore Unevaluated). A role expanded from half a file
is indistinguishable from a role with fewer permissions, and the second reads as Compliant.
Exactly one artifact must be readable as an expansion: zero is incomplete, and so is more than
one, because choosing between two policy files is the same ambiguity one level up.

## The evidence facts, and the Gate outranking the rule

`observationEvidenceFacts` is where the per-record Gate outcome **outranks** the rule verdict:

| Fact | True when |
| --- | --- |
| `inspected` | `coverage` is `COVERED` |
| `complete` | every per-Observation check PASSED |
| `ambiguous` | `coverage` is `AMBIGUOUS`, or the population cannot say which record this is |
| `contradictory` | the corroboration rollup is `CONTRADICTORY` |
| `absenceProven` | `found = false` and `coverage` is `COVERED` |

A record with any failing check is not `complete`, and the compiler then records every condition
`UNEVALUATED` — including one the rule would have called an Exception. An Exception raised on a
record whose identity did not corroborate is a finding about a record nobody has established the
identity of.

Because the facts are derived from the coverage and the corroboration, a `COMPLIANT` is
structurally unreachable for a record that is not `COVERED` or whose snapshot contradicts it.
`UNSUPPORTABLE_COMPLIANT` is a second lock on that same door and never turns while the two
agree; it exists because such a value is REFUSED by `registerObservations` and by the
`run_observation_evaluation` composite foreign key, which would roll the whole batch, the Work
Item and the Step Execution back. Degrading an outcome is the right failure; destroying a Run is
not. `evaluation.test.ts` asserts the agreement rather than the unreachable branch.

## The row that is written

Every evaluation this evaluator produces carries origin **`RULE`** — including one that records
an Agent-Judged condition as Unevaluated, because the origin says which evaluator wrote the row
and the deterministic one did. `confirmation` and `confidence` are `null`: §B.1 gives both to an
Agent-Judged evaluation and to no other.

`rationale` is deliberately `null`. A rule's reason is its diagnostics; a free-text rationale is
where retrieved content gets quoted back as the reason for an outcome, which is exactly what the
seeded prompt-like memos exist to catch.

`diagnostic` carries the compiler's own reasons, joined and bounded by the column that holds
them. Two are load-bearing and quoted verbatim:

- **`rule does not name value <v>`** — an attribute value no compiled condition names, with the
  value exactly as it was observed.
- **`condition does not apply to this record`** (`CONDITION_NOT_APPLICABLE`) — the frozen
  applicability predicate said this condition is not about this record. Compiler 1 gives such a
  condition `COMPLIANT`, which is the value stored, because the record's evaluation is the
  compiler's fixed reduction over these values. The reason is recorded so the §H count of
  APPLICABLE conditions (Story 3.8) can exclude it: a row saying only `COMPLIANT` is
  indistinguishable from a rule that was evaluated and passed.

## The Exception

The **first `EXCEPTION`** recorded for a record creates its Exception, in the same transaction
as the evaluation that raised it. There is no later step and no second call site: a control
failure and the durable record of it commit together or neither happens.

- `exception_id` is **derived**, never minted: RFC 9562 §5.8 UUIDv8 over a SHA-256 of the
  canonical JSON of `[runId, observationId]`. Run-stable, so a redelivered batch reaches the row
  it already wrote instead of raising a second finding about one record. A unique index on
  `observation_id` says the same thing where no command can route around it, and the insert is
  `ON CONFLICT DO NOTHING`: the existing Exception stands.
- `fingerprint` is **HMAC-SHA-256** over the RFC 8785 canonical JSON of exactly five keys —
  `condition_ids`, `population_record_key`, `procedure_id`, `target_system`, `template_id` —
  written key by key and never by spread. The **Run is deliberately absent**: a fingerprint
  identifies the FINDING, so the same control failure recurring next month fingerprints the same
  and is recognisable as the same finding. The Run is on the row beside it.
- It is **keyed**, not a plain digest: an unkeyed hash over a small closed vocabulary of record
  keys and condition ids is a dictionary anybody holding the fingerprints can invert, and the row
  it is written into is permanent. `fingerprint_key_id` is retained beside every fingerprint so
  a rotated key still says which key produced which value.
- The key reaches the evaluator as an `ExceptionFingerprinter` **port with no field holding it**:
  `JSON.stringify` of that object yields `{"keyId":"…"}`, so no checkpoint, audit payload,
  Timeline event, log field or error message has anywhere to pick the secret up from. It is
  `EXCEPTION_FINGERPRINT_KEY`, the worker's alone; without it the adapter stage is **disabled by
  name**, exactly as an absent `CREDENTIAL_TOKENS` disables it. An Exception with no fingerprint
  must not exist, and no evaluation happens at all without a key.
- The row carries the conditions that failed and every reason the rules gave — **every violating
  permission pair**, verbatim.
- Generation 23 puts two rules below the command, because neither is a CHECK: an Exception can
  never be **UPDATEd**, and it can never be **DELETEd while the Observation it was raised on
  still exists**. Removing a whole Observation is a different act — it takes the record and its
  digest with it, and the registration event still names both — so the foreign key cascades and
  the deferred constraint trigger passes at commit.

The registration event carries `exceptions` and `exceptionIds`, so a row that later went missing
is still accounted for in the chain.

## The golden populations

`tests/unit/golden-evaluation.test.ts` runs both golden populations through this pipeline and
asserts every named per-record case of `fixtures/northstar/expectations/p-2-sod-conflicts.json`
and `p-3-high-value-approvals.json`; `tests/e2e/population.spec.ts` asserts the P-2 cases again
against a real Run of the real Procedure through the real synthetic service.

**If a case disagrees with the implementation, the implementation is wrong.** The expectations
are frozen and the compiled rules are frozen; a disagreement is a finding, not a licence to edit
either.

Two cases punish a reasonable-looking shortcut and both are asserted against the datasets on
disk, so removing either from the DATA fails the test rather than making the implementation look
right:

- **P-2 account AG-1007 appears twice with different role lists.** The extraction carries it
  twice too, so the match is `ambiguous` and nothing resolves it; the population carries it twice
  as well, so `populationValues` is `null`. Any dedupe produces a confident wrong answer.
- **RoleMatrix declares `AMBIGUOUS_DUAL` twice with conflicting permissions.** Merging them
  reports a Control Failure where the contract requires Unevaluated.

P-3's TX-500007 carries no `processed_time`, so the frozen inclusion rule cannot place it in or
out of the Period: Story 3.2 marks the row INDETERMINATE and it never reaches an Observation. Its
Inconclusive is the population Gate's, not a per-record evaluation, and the golden test pins that
this is the only case reached that way.

Both full golden populations end **Inconclusive** by design.

## What this contract does not decide

The Run-level Gate rows, the applicable-condition counts and the mapping of a failing Gate to
`INCONCLUSIVE` (Story 3.8); Result sealing and publication (3.9); and any Agent-Judged
evaluation, which this epic does not have.
