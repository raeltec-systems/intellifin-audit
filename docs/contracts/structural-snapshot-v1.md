# Structural Snapshot corroboration contract, schema 1

This is the normative contract for re-reading a stored Structural Snapshot and judging what
an Observation says about it. It is implemented by
`packages/domain/src/runs/structural-snapshot.ts`, composed as the corroboration seam of
[observation registration v1](observation-registration-v1.md) by
`packages/application/src/runs/snapshot-corroboration.ts`, and it decides the
`observation-corroboration` check and every attribute's `corroboration` verdict.

An adapter asserts what it saw. Until something re-reads the stored bytes, a wrong or
invented attribute value is indistinguishable from a correct one and the Observation stands
on the adapter's word alone. This is the second opinion.

## Bytes in, verdict out

The extractor performs **no I/O of any kind**. It is handed the bytes the producer already
froze and reaches nothing else — no store, no fetch, no clock. That is not hygiene, it is
two requirements:

- corroboration runs **inside the registration transaction**, so any network call would
  hold a PostgreSQL transaction open across it;
- corroboration runs **before the digest**, so a verdict that could differ between two
  reads of the same bytes would make a redelivered batch produce a different digest and
  read as an integrity failure.

In the adapter stage the bytes are the ones `freezeArtifact` read back out of the object
store and proved equal, byte for byte, to what was uploaded. "The stored Structural
Snapshot" is therefore what the freeze established, not a hopeful description.

There is no corroboration dependency to inject into `executeAdapterSteps` and none to
forget: the stage that froze the artifact is the stage that re-reads it, so no composition
root can register an adapter Observation as unjudged forever. `NO_CORROBORATION` remains
for a producer that genuinely has no snapshot.

## The four substrates

| Substrate | Locator grammar | Label rule | This build |
| --- | --- | --- | --- |
| `web_tree` | a later epic | accessible name | **unimplemented, by name** |
| `desktop_tree` | a later epic | control name | **unimplemented, by name** |
| `sheet` | `$.rows[<index>].<column>` | the header cell | implemented |
| `json` | `$.<collection>[<index>].<field>` | the property key | implemented |

`web_tree` and `desktop_tree` are **explicit** unimplemented cases, never a silent
fallthrough. A snapshot in either reports `corroboration-unsupported` and its check FAILS.
A substrate that quietly answered "matched" for a snapshot nobody read would be the exact
defect this contract exists to remove.

The substrate comes from the **media type registration recorded** beside the artifact's
digest — `application/json` is `json`, `text/csv` is `sheet` — so it is a property of the
frozen artifact rather than a guess about its content. A media type naming no substrate
leaves the caller with no snapshot for that Evidence, which is reported unavailable.

## One locator grammar

`sheet` and `json` share `$.<collection>[<index>].<field>`, which is the shape
`execute-adapter-steps.ts` already writes. Two grammars would agree on every locator anybody
thought to try and diverge on the first one nobody did.

- Neither name segment may contain `.`, `[` or `]`, so the parse is unique: exactly one
  `$.`, one bracketed index and one trailing `.field`.
- The index carries **no leading zero**; `[07]` and `[7]` would otherwise be two spellings
  of one cell.
- For a `sheet` the collection segment is exactly `rows`. A sheet artifact carries one
  table here, and leaving its name free would let two defensible extractors disagree about
  whether `$.rows[0].role` or `$.role-matrix[0].role` addresses it.
- The index is the **0-based data row**: for a sheet, after the header row and after a
  leading `# SYNTHETIC` marker line; for JSON, the position in the named array.
- A field is resolved with `Object.hasOwn`. A locator naming `constructor` or `toString`
  addresses nothing, rather than returning an inherited function.

A `sheet` is parsed by the same RFC 4180 parser the population reconciliation uses, so a
cell address means one thing in this product and not two. A `json` collection is any
envelope key holding an array of objects — not only the four collection names — so a
locator naming `schema` (an array of strings) simply never resolves.

## What `matched` requires

An attribute is `matched` only when **all** of this holds, and `contradictory` otherwise:

1. the locator parses in the grammar above;
2. it resolves to a cell in the stored bytes;
3. the re-read **label**, by the substrate's own label rule, equals the label the grounding
   declares;
4. the re-read **value** equals `originalValue`, compared as RFC 8785 canonical bytes;
5. the grounding's `extractedText` is the text of that value, by the one shared
   `groundedText` rule the capture itself used;
6. `normalizedValue` is an **authorized** normalization of that value: the value itself, or
   its UTC normalization. §B normalizes a date-time to UTC and retains the original beside
   it, and compiler 1 authorizes no other transformation.

Nothing is ever repaired by preferring one side. Values are compared as exact opaque
strings through canonical bytes, which distinguish `"007"`, `"7"` and `7` from one another:
a leading zero is never coerced away, and a string is never parsed as a number.

An attribute with **no grounding** is judged `null` rather than contradictory. It was never
captured (§B.1) and `required-evidence` already records that; there is nothing to re-read,
so there is nothing to contradict.

## Identity

For a `found = true` Observation the re-read grounded identity must equal the normalized
population record key. That is the half of §H identity corroboration only a re-read of the
stored snapshot can decide — the other half, that the Observation's own `identity` field
equals the record key, is `identity-corroboration` (observation registration v1) and is
decidable without one.

The identity's verdict is carried **apart** from the declared attributes' verdicts. §B.1
lets a declared attribute share the identity's name, and the two are grounded at different
locators, so one verdict list keyed by name would silently give one of them the other's
answer.

## The diagnostics

The check row's diagnostic is a closed vocabulary, deliberately coarser than the internal
failure names:

| Diagnostic | Means |
| --- | --- |
| `corroboration-unsupported` | the substrate is `web_tree` or `desktop_tree` |
| `corroboration-unavailable` | no snapshot for that Evidence, or bytes nothing could read |
| `corroboration-label-drift` | the value agrees and the label does not |
| `identity-mismatch` | the re-read identity is not the population record key |
| `corroboration-contradictory` | everything else that disagreed |

"Nothing could read it" and "it read differently" are different words on purpose: only the
second accuses the Observation of being wrong, so an unsupported or unavailable snapshot
leaves every attribute's verdict `null` and FAILS the check, rather than marking attributes
`contradictory`.

When several attributes fail, the **first** in a fixed order — the identity, then the
declared attributes as stored — names the diagnostic, so two builds reading the same bytes
report the same one.

## The rollup, and what the database refuses

`observationCorroborationState` rolls the per-attribute verdicts up to one value stored
beside the row, exactly as `coverage` is:

| State | When |
| --- | --- |
| `CONTRADICTORY` | any attribute, the identity included, was re-read and disagreed |
| `MATCHED` | at least one was judged and none disagreed |
| `UNJUDGED` | none was judged — an absence Observation, or a snapshot nobody could read |

`UNJUDGED` is **not a pass**. The `observation-corroboration` check row is where the
difference between "there was nothing to re-read" and "nothing could re-read it" is said.

Generation 22 puts three rules below the command, where no command, migration or psql
session can route around them:

1. **The per-attribute verdict vocabulary**, pinned inside the jsonb: a verdict that is not
   `matched`, `contradictory`, `model-read` or JSON null — on the identity or on any
   attribute — cannot be stored.
2. **The rollup is the derivation**, not a summary somebody remembered to update: a row
   whose `corroboration` disagrees with its own attributes is refused.
3. **A record its own stored snapshot contradicts can never be Compliant.** The composite
   foreign key from `run_observation_evaluation` widens to
   `(observation_id, coverage, corroboration)` and carries
   `CHECK (value <> 'COMPLIANT' OR corroboration <> 'CONTRADICTORY')`. Claiming `MATCHED` in
   the evaluation row does not help: the triple has to exist in `run_observation`. The
   command refuses first, by name (`corroboration-conflict`), so a caller gets a named
   refusal rather than a constraint violation — the Story 3.4 shape, one column along.

## The golden vectors

`tests/fixtures/snapshot-extraction-golden.json` is produced by
`uv run scripts/make-snapshot-extraction-golden.py` with Python's own `csv`, `json`,
`datetime` and PyPI `rfc8785`. The unit test asserts its `producer` starts with `Python`.

A fixture regenerated from the extractor would prove only that it agrees with itself, which
is exactly the property an Observation already has without it. The `sheet` vectors are taken
over the real `fixtures/northstar/generated/role-matrix.csv`, and the test requires the
fixture to hold the bytes that file still holds — including the leading `entry` ordinal that
keeps two conflicting policy entries for one role distinguishable.

## What this contract does not decide

Whether a contradicted record's conditions evaluate to `UNEVALUATED` (3.7 — this contract
only makes `COMPLIANT` unreachable for one), the Run-level Gate rows and the mapping of a
failing corroboration to `INCONCLUSIVE` (3.8), Result sealing (3.9), and the `web_tree` and
`desktop_tree` extraction a later epic's agent captures need.
