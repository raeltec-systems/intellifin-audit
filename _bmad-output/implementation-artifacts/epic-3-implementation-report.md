---
title: 'Epic 3 implementation report: adapter Runs end to end'
type: 'report'
created: '2026-09-05'
status: 'draft'
---

> **Draft.** Sections 3 to 7 are completed as the remaining stories land. Sections 1 and 2
> describe behaviour that is already delivered and verified.

## 1. What an adapter Run now does, end to end

An adapter Run is a Procedure Version executing itself against synthetic Target Systems, with
every stage refusing rather than guessing when it cannot prove what it needs.

**Initiate.** An auditor names a Procedure and an inclusive date period. The platform walks
the activated succession chain to find which version owns that period — not by version number
and not by approval time, because neither expresses succession — and refuses if the lineage is
broken, forked or unreadable. The Run row, its dispatch job, its first chained Timeline event
and the notification of it all commit together.

**Acquire the population.** A worker claims the Run under a bounded lease, fetches the bound
Population Source, and reconciles it against a declaration generated independently of the
data. The exact bytes and that declaration are hashed as a pair and the digest is committed
BEFORE the object is written, so a resumed attempt verifies the pair it already promised
rather than fetching a fresh declaration for old bytes. The frozen inclusion rule then sorts
every row into included, excluded with a reason, or indeterminate.

**Freeze the Reference Sources.** Each `versioned-file` Target System is acquired once, as a
Session Step, before any Work Item runs. Its bytes are frozen as Evidence, and every rule that
later consults it reads those bytes and not a fresh fetch.

**Extract.** Each `api` Target System becomes one Work Item. The worker resolves a credential
that has nowhere to live — the resolved object has a reference and a method that sets a
header, and no field holding a value, so serialising it yields the reference alone. The
response is frozen as Evidence first and parsed second, because a response that is not a
declared collection is still what the system said, and an inconclusive Run keeps its partial
Evidence. A `web` or `desktop` Target System is refused BY NAME rather than skipped: skipping
would let a Run conclude about a system nothing read.

**Register the Observations.** Every producer goes through one transactional contract. The
rows, their per-Observation check outcomes, their corroboration verdicts, their evaluations,
the audit event carrying every digest, and the Timeline notification commit together or not at
all. Each Observation's identity is derived from the Work Item and the record key rather than
minted, so a redelivered batch reaches the rows it already wrote instead of duplicating them.
A record the Target System does not carry is an honest absence only if the adapter derived a
query key for every declared search key, stored an empty result as Evidence, and completed its
extraction. Missing any one, nobody proved they looked.

**Corroborate.** The stage that froze the artifact re-reads it. A declared attribute's
grounding is resolved in the stored Structural Snapshot at its locator and compared with what
was captured, as canonical bytes, so three spellings of the same number stay three different
things. "Nothing could read it" and "it read differently" are recorded as different words:
only the second accuses the Observation of being wrong.

**Evaluate.** The version's already-compiled conditions are applied inside the same
transaction, with origin RULE and no free-text rationale, because a rationale is where
retrieved content gets quoted back as the reason for an outcome. Money is compared on scaled
integers. A role expanded from half a file is refused as incomplete rather than read as a role
with fewer permissions. The first Exception creates its row with a fingerprint that
deliberately excludes the Run, so the same finding recurring next month is recognisable as the
same one.

**Gate, seal and publish.** Every addendum H row not already answered per Observation is
decided when the last Work Item completes, and the outcome table is applied in order with the
first matching row winning. Evidence falling short is Inconclusive; execution or integrity
failing is Run Failed. Canceled is never produced by a timeout, because that state's whole
meaning is that a person cancelled.

## 2. The central invariant, and where it actually lives

**An uninspected, excluded, ambiguous or contradicted record is never Compliant.**

That sentence is not enforced by a rule a command has to remember. It is a composite foreign
key. An evaluation row carries the coverage state and the corroboration verdict of the
Observation it belongs to, held to that Observation's own values by a foreign key over the
three columns together, under a constraint that forbids a Compliant value beside a
contradicted corroboration. Claiming the right coverage in the evaluation row does not help:
the pair has to exist in the Observation.

No command, no migration and no database session can route around it. The command refuses
first, so a caller gets a named refusal rather than a constraint violation, but the constraint
is what makes the guarantee true rather than intended.

Above it sit two more layers of the same idea. A failing per-Observation check sets the
evidence facts incomplete, and the compiler then records every condition on that record
Unevaluated — so a Gate failure outranks a rule verdict without a second rule deciding that it
should. And the conservative reduction is fixed at Exception, then Unevaluated, then
Compliant, so no ordering accident can promote a record.

Two independent adversarial reviews of the five landed stories tried to find a path around it
and could not.

## 3. Verification actually run

Every story was gated twice: by the agent that implemented it, and independently in the main
thread against a real PostgreSQL 18 before it was committed. The independent run is what the
numbers below come from. A story was never committed on a reported result.

Each run covers: typecheck, the dependency-boundary check, the migration, the unit suite run
alone, the integration suite against real PostgreSQL, a schema-drift check, both builds, and
the browser suite with an accessibility gate that has no allowlist.

| Story | Schema | Unit | Integration | Browser |
|---|---|---|---|---|
| 3.3 Extract and freeze Reference Sources | 19 | 2184 | 262 | 109 |
| 3.4 Register Observations | 20 | 2266 | 270 | 109 |
| 3.5 Seal Evidence | 21 | 2305 | 281 | 109 |
| 3.6 Corroborate against the snapshot | 22 | 2367 | 285 | 109 |
| 3.7 Evaluate and raise Exceptions | 23 | 2408 | 288 | 109 |
| 3.8 The Run-level Gate | 24 | 2450 | 303 | 109 |

Zero accessibility violations on every browser run.

Two independent adversarial reviews then read the five landed stories against the contracts
and the golden fixtures. The golden reconciliation agreed on all twelve named per-record
cases. Seven defects were found around the evaluator rather than in it, and are repaired in
their own commits; section 4 records the decisions those repairs settled.

