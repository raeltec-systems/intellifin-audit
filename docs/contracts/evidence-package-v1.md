# Evidence package contract, schema 1

This is the normative contract for the seam every Evidence artifact goes through, whatever
produced it: the population acquisition of
[population acquisition v1](population-acquisition-v1.md), the Reference Sources and
adapter extractions of [adapter extraction v1](adapter-extraction-v1.md), and the agent
captures of a later epic. It is implemented by
`packages/application/src/runs/evidence-package.ts` and
`packages/application/src/runs/seal-package.ts`, over the rules in
`packages/domain/src/runs/evidence.ts`, and it generalises the reserve / upload / verify /
register sequence those two stories each wrote by hand.

## Reserve, upload, verify, register — in that order

An artifact is **reserved before it is uploaded**, and the reservation is a NAME rather
than an allocation:

```
idempotency key = evidence-v1:<runId>:<kind>:<scope>
evidenceId      = RFC 9562 §5.8 UUIDv8 over SHA-256 of the canonical JSON of that key
objectKey       = population/<runId>/raw          (and .../acquisition-v1)
                  reference/<runId>/<frozen step id>
                  extraction/<runId>/<frozen step id>
```

`scope` is the FROZEN Session Step id, and the empty string for the Run-level population,
which there is exactly one of. A retried production after a crash therefore re-derives the
same id and the same object key and reuses its reservation, instead of minting a second
object beside the first. This is `observationIdFor`'s lesson (observation registration v1)
applied one layer along: a minted id makes a redelivery indistinguishable from a second
artifact, and here it would leave two objects in the store with one row describing one of
them.

Those object keys are exactly the ones Stories 3.2 and 3.3 already wrote. This document is
where they are spelled, not a new naming scheme: an artifact frozen by an earlier build has
to resolve to the same object.

**Upload is conditional and never overwrites.** `S3EvidenceStore.putIfAbsent` reads first
and reconciles an object that is already there without sending a write at all; only an
absent key is written, with `IfNoneMatch: '*'` covering the window between the two; and the
stored bytes are then read back and compared. Immutability used to rest entirely on the
backend honouring that header. It now rests on it only for the window between the read and
the write, which a leased claim already makes rare. The file-backed store uses `wx`, which
the filesystem makes exclusive outright.

**Verification is availability, size and SHA-256**, against the bytes just sent AND against
any digest a previous attempt already registered, before the single transaction that marks
the artifact `REGISTERED`. Nothing replaces, repairs or re-uploads bytes that fail: a
damaged object is an integrity failure and the bytes stay exactly as they are.

## The states, and who moves them

| State | Means |
| --- | --- |
| `RESERVED` | a name and an object key, with nothing verified behind them yet |
| `REGISTERED` | bytes whose availability, size and SHA-256 were verified against the recorded values |
| `ABANDONED` | a reservation whose upload never completed |

A `REGISTERED` artifact is **never** demoted: Evidence already registered is preserved
forever, and a later Source change, a retired registration or an expired provider retention
never removes it.

**`SealPackage` is the only thing that abandons a reservation.** A producer that abandoned
its own — as `PostgresPopulationRepository.save` and the adapter Work Item both once did —
leaves the seal with nothing open to find, and the Result with nothing to name. A Work Item
that has exhausted both retry cycles leaves its reservation OPEN while the Run continues,
which is true: the Run has not stopped yet.

## `required`, and what it is a property of

`required` is a flag on a RESERVATION, stamped from the frozen Template at reserve time by
`isRequiredArtifact`. A Run that failed before it ever reserved a Reference Source is not
incomplete for an artifact nobody asked for; a Run that reserved one and never registered
it is.

| Kind | Required | Why |
| --- | --- | --- |
| `population` | yes | the Run's own scope; a Result without it cannot be traced |
| `reference-source` | yes | the evaluator consults it; a Run concluding without it concluded against nothing |
| `adapter-extraction` | **no** | see below |

An extraction is not required because the owner's 2026-09-05 decision already makes a Work
Item that exhausts both retry cycles `FAILED`, the Run continue, and incomplete coverage
become `INCONCLUSIVE` at the Run-level Gate. That is the Gate's judgement, stated once, in
coverage. Making the same fact also make the package incomplete would say it twice in two
vocabularies and would mean no `INCONCLUSIVE` Run could hold a complete package, which
drains the word of meaning. Traceability does not depend on it either: the
`required-evidence` check (observation registration v1) refuses an Observation whose linked
Evidence is not `REGISTERED`, so an Exception can never trace to an extraction that is not
there.

All four Templates agree today. The table is per-Template because `required` becomes a
per-Template question the moment one Template freezes an artifact another does not.

## Sealing

`SealPackage` runs on **EVERY terminal transition, whatever the outcome**, inside the
transaction that commits it. In order:

1. every still-open reservation is marked `abandoned`;
2. completeness is judged over the artifacts **as they will be** — a package judged first
   would seal on a reservation the same transaction was about to abandon;
3. the seal row is written: `SEALED` when every required artifact is `REGISTERED` and
   verified, `INCOMPLETE` otherwise, with the gap and the abandonments listed on it;
4. one `lifecycle.evidence-package-sealed` event is appended and the Timeline notified.

The seal is **idempotent and immutable**: the first seal wins, a second call returns it
unchanged, and the database refuses an UPDATE of the row.

An `INCOMPLETE` package is a truthful record of an incomplete Run, not a failed seal. The
Run's own outcome carries the failure; the event's outcome is `success` so the same fact is
not counted twice.

Sealing can never delete or rewrite an artifact to succeed. The only mutation it can reach
is `abandonArtifacts`, whose SQL is guarded on `state = 'RESERVED'`, so a registered
artifact is unreachable from it even with the wrong id.

## What the database refuses, whatever the command does

Generation 21 puts four rules below the command, where no command, migration or psql
session can route around them:

1. **A Run may not reach a terminal state without a sealed package.** A deferred constraint
   trigger on `audit_run`, so ordering inside the terminal transaction does not matter. This
   is the forcing function behind "run `SealPackage` on every terminal transition": a branch
   that forgets does not ship an unsealed Run, it fails to commit.
2. **A `SEALED` package may not exist while a required artifact of that Run is
   unregistered.** A trigger on the package insert, over both evidence tables.
3. **A sealed package row can never be updated**, and once it exists **its Run's Evidence
   rows are frozen**. The freeze trigger is immediate, not deferred, which is why sealing
   abandons before it inserts.
4. Per-row CHECKs: `REGISTERED` requires a digest and a size; `ABANDONED` requires no
   digest; the seal state and its own `missing_required` list must agree; an integrity
   finding must name a real disagreement.

## A mismatch during the Run, and the same mismatch after it

One fact, two timings, two different consequences.

- **During the Run** — a resume or redelivery re-reads what the Run froze and the stored
  bytes no longer match their registered digest. That is a terminal integrity failure: the
  Run ends `RUN_FAILED` and the bytes are untouched.
- **After the Run** — `verifySealedPackage` reads a SEALED package's registered artifacts
  and compares. A disagreement is an **Audit Trail integrity event**: a
  `failure.evidence-integrity` event and a `run_evidence_integrity` row, flagged on the
  Result and the exports. It changes **no state** — not the Run, not the seal, not the
  Evidence row, not the bytes — and is corrected only by a new Run. The command refuses a
  Run that is not terminal, because during a Run the same disagreement has the other
  consequence.

"Changes no state" is a property of what the command can reach: `SealedPackageContext` has
no writer for a Run state, a seal or an Evidence row. The unique index on
`(evidence_id, object_key, finding)` makes re-verification idempotent, so a sweep run twice
does not multiply one mismatch into two events.

A finding names an artifact and states two digests. A digest is what an auditor compares and
is already in the chain from registration; the artifact's CONTENT is not there and there is
nowhere for it to go. `FORBIDDEN_PAYLOAD_KEYS` refuses a credential-shaped key outright, and
neither event carries a media type, a location or a credential reference.

A store that cannot be read is **not** proof of tampering: a transport failure is reported
to the caller rather than written into an immutable chain as an integrity event.

## What this contract does not decide

Which artifacts a later epic's agent captures and whether they are required; the Run-level
Gate rows (3.8); Result sealing and the Result version (3.9); and who runs
`verifySealedPackage`, on what schedule. Each of those extends this seam; none of them
replaces it.
