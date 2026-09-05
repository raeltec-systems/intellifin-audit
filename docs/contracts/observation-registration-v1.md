# Observation registration contract, schema 1

This is the normative contract for the seam every Observation goes through, whatever
produced it: the adapter extraction of [adapter extraction v1](adapter-extraction-v1.md)
today, an agent read later. It is implemented by
`packages/application/src/runs/register-observations.ts`, over the wire schema and the
rules in `packages/domain/src/runs/observation.ts`, and it is the only write path to
`run_observation`. There is no `saveObservations` an execution stage can reach past it.

## The batch is the unit

A batch is registered in **exactly one transaction**. The Observation rows, their
per-Observation check outcomes, their per-condition evaluations, the audit event and the
Timeline notification commit together or not at all. A batch larger than one statement
can carry is chunked **inside** that transaction, in order; it is still one batch, one
event and one commit.

A refusal is **thrown**, never returned. A refusal returned from inside a unit of work
commits everything written before it (Stories 1.5–1.7), and "this batch did not happen"
has to be said to PostgreSQL as well as to the caller. The refusal vocabulary is closed
(`ObservationRegistrationRefusal`); it never carries a value, a URL or a message.

## The digest

`observationDigest` is SHA-256 over the RFC 8785 canonical JSON of the wire record,
through the shared `packages/domain/src/canonical-json.ts` — the same serializer the audit
chain, the registration digest and the binding digest use. Two canonicalizers agree on
every value anybody thinks to try and diverge on the first one nobody does.

The envelope is exactly the thirteen §B.1 keys, written key by key and never by spread:

```
attributes, capture_method, evidence_ids, found, identity, match_origin, observation_id,
observed_at, population_record_key, schema_version, step_execution_id, target_system,
work_item_id
```

It covers **nothing operational**. No attempt counter, lease, revision, row version,
coverage state or registration time is in it, because those move for reasons that have
nothing to do with what was observed, and a digest that moved with them would make an
untouched row look tampered with.

`observationBatchDigest` is SHA-256 over the RFC 8785 canonical JSON of the ordered list
of per-Observation digests. The per-row digest detects an edit to a row; the batch digest
detects an edit to a stored digest, a removed row or a reordered batch — none of which a
per-row digest can see, because each surviving row still agrees with itself.

Both are pinned by `tests/fixtures/observation-digest-golden.json`, produced by
`uv run scripts/make-observation-digest-golden.py` with Python `rfc8785` + `hashlib`, its
envelopes written out by hand. A fixture regenerated from the code under test would prove
only that it equals itself.

### Two questions the digest answers

On registration, a record key that is already stored raises two separate questions:

1. **Does the stored row still agree with the digest stored beside it?** An edit to a row
   does not touch its digest column, so comparing a fresh batch against that column alone
   would find them in agreement and see nothing. The stored row is read back out of its
   columns and its digest recomputed. A disagreement is `observation-integrity`.
2. **Is the row this batch describes the same Observation?** `run_observation` is unique
   on `(work_item_id, population_record_key)`, so a genuinely different capture for that
   pair cannot be stored at all. A disagreement is `digest-mismatch`, said rather than
   dropped silently.

## Identity, and idempotency

`observationId` is **derived, not minted**: RFC 9562 §5.8 UUIDv8 over a SHA-256 of the
canonical JSON of `[workItemId, populationRecordKey]`. A redelivered batch therefore
produces byte-identical records, registration finds every digest equal and writes nothing
at all — no row, no check, no evaluation, no event, no notification. A freshly minted
UUIDv7 would make every redelivery look like tampering, and would leave the checks and
evaluations (both keyed by `observation_id`) pointing at an id that exists nowhere.

A partial redelivery registers only what is missing, and its event carries only those
digests.

## Coverage, and honest absence

`coverage` is derived on every registration and stored beside the row:

| `found` | Absence proof | `coverage` |
| --- | --- | --- |
| `true` | — | `COVERED` |
| `false` | all three legs | `COVERED` |
| `false` | any leg missing | `UNINSPECTED` |
| `ambiguous` | — | `AMBIGUOUS` |

§H's per-record coverage counts `found ∈ {true, false}` only, so an ambiguous match is its
own state and never `COVERED`; calling it covered would be a lie in exactly the place the
Gate reads.

An absence is a **finding** rather than a gap only with all three of:

1. an Adapter-Action-derived **query key for every declared search key**
   (`PLAN_LOOKUP_COLUMNS` for the Template), each equal — as an exact opaque string, with
   no trimming, case folding or numeric parsing — to the population record's normalized
   value for that key;
2. a **stored empty-result response registered as Evidence**, linked by the Observation
   and in state `REGISTERED`; a reservation nothing was written to is not a stored
   response, and a missing artifact is never an empty result;
3. a **passing extraction-completeness check**: the response declares itself `complete`,
   the row count it reports is the row count it carries, and its envelope holds no key
   outside `COLLECTION_ENVELOPE_KEYS`. An open envelope would let an alternate
   continuation marker pass unnoticed and turn "this record is not in the system" into
   "this record is not on the page I happened to read". That closed set is the SAME list
   Story 3.2 reconciles an API population against, exported from
   `packages/domain/src/runs/population.ts` — written twice, it diverged on `synthetic`,
   the NFR-13 marker every Northstar response carries, and judged every real extraction
   incomplete.

P-1 declares two search keys (`employee_id`, `full_name`); an adapter that indexed one of
them has not proven a record absent, and the record stays `UNINSPECTED`. That is the safe
direction and it is the rule that actually bites.

**An uninspected or ambiguous record can never be Compliant.** That is not only a command
rule: `run_observation_evaluation` carries the coverage state, held to the Observation's
by a composite foreign key, under
`CHECK (value <> 'COMPLIANT' OR coverage = 'COVERED')`. No command, migration or psql
session can route around it.

## Per-Observation checks

`observationChecks` runs every §H check one Observation can answer alone. A failing check
is **recorded, never a refusal**: it is a finding the Run-level Gate (Story 3.8) turns
into `INCONCLUSIVE`. Only a wire-schema violation refuses, because a record that is not in
the schema has no meaning to record.

| Check | Applies to | Passes when |
| --- | --- | --- |
| `identity-corroboration` | `found = true` | the grounded identity's normalized value equals the population record key |
| `search-completeness` | `found = false` | the absence is honest, by the rule above |
| `ambiguous-match` | every Observation | `found` is not `ambiguous` |
| `required-evidence` | every Observation | every linked Evidence item is `REGISTERED`, every grounding names linked Evidence, and every attribute the Observation carries is grounded |
| `freshness` | every Observation | the capture is within the Run: at or after its start, at or before registration |
| `observation-corroboration` | written by the Story 3.6 seam only | that seam says so |

`required-evidence` deliberately does NOT check that every attribute the Procedure
declares is present. `plan.observations` is the union across every Target System of the
Procedure — P-3 declares `amount` and `processed_time`, which live in the population and
not in the approvals system — so requiring all of them of one adapter Observation would
fail a correct Run. Which system supplies which field is not in the frozen plan, so it is
not decidable here; per-record coverage is the Run-level Gate's question (Story 3.8).

A `PASS` never carries a diagnostic and a `FAIL` always does, in the domain and in the
`run_observation_check` CHECK alike: a passing check with a reason attached reads as a
finding to everything downstream, and a failing one with none is a finding nobody can act
on. Diagnostics are a closed vocabulary of constants.

## Capture time

§B: every timestamp is normalized to UTC and the original offset is retained. The wire
record's `observedAt` is the normalized half; `run_observation.observed_at_source` holds
the source text verbatim. Registration refuses a source that does not normalize to the
record's `observedAt`, so a capture time is never silently shifted.

`normalizeObservedAt` does the arithmetic itself rather than trusting `Date.parse`, which
**rolls over** an impossible calendar date instead of refusing it: `2026-02-30T00:00:00Z`
parses happily to 2026-03-02, a two-day shift by the one function whose whole promise is
that it never shifts one.

## The two seams

Neither is inlined here, and both are required dependencies rather than optional ones — a
composition root that could omit them would register every attribute as unjudged forever
with nothing saying so. `NO_CORROBORATION` and `NO_EVALUATION` are the explicit "not yet".

- **Corroboration (Story 3.6)** runs **before the digest**, because §B.1 sets corroboration
  at registration; a value written afterwards would leave every row disagreeing with its
  own digest. Its verdict becomes the `observation-corroboration` check row. It must be
  deterministic over the stored Structural Snapshot, or a redelivery would produce a
  different digest and read as an integrity failure.
- **Evaluation (Story 3.7)** runs inside the registration transaction, over the records
  exactly as they are being stored, so an evaluation can never describe an Observation
  that was not committed. Its output is validated against §B.1's evaluation shape — where
  `UNEVALUATED` is a VALUE and never an origin, and `confirmation` and `confidence` belong
  to an Agent-Judged evaluation and to no other — and a `COMPLIANT` value on a record that
  is not `COVERED` is refused by name rather than left to the constraint.

`confidence` is a **decimal string**, never a binary float: it is compared against the
Procedure Version's frozen `agentJudgedThreshold`, which Story 2.4 stores as a decimal
string for exactly this reason.

## The event

One `execution.observations-registered` event per registered batch, appended inside the
transaction and followed by the Timeline notification. Its payload carries the Work Item,
the Step Execution, the Target System, the schema version, the counts, the coverage
tally, the failing checks by name, `digests` (every registered Observation's digest, in
registration order) and `batchDigest`.

The batch is bounded at `OBSERVATION_LIMITS.batch` — equal to `POPULATION_LIMITS.rows`,
because one adapter Work Item produces at most one Observation per included population
record. It is a refusal, not a truncation. The stated cost of carrying every digest is
that a batch at the cap writes a large immutable payload.

## What this contract does not decide

Corroboration against a stored Structural Snapshot (3.6), the compiled condition rules and
Exceptions (3.7), the Run-level Gate rows and limit mapping (3.8), and Result sealing
(3.9). Each of those extends this seam; none of them replaces it.
