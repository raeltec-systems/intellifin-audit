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

## 4. Decisions taken, and why

These are the decisions a reader would otherwise have to reconstruct from the diff. Every one
is also in `CLAUDE.md` beside the code it governs.

**A Gate row's failure outcome belongs to its diagnostic, not to its row.** The addendum
gives two rows both possible outcomes, so a table keyed by row loses half the contract. One
failure genuinely lands on two rows, and the addendum says so twice.

**Per-record coverage is per Template, and is now machine-readable.** The addendum computes
coverage "per the Template's coverage rule", and the four rules genuinely differ: one names
"found or proven absent" in as many words, while the segregation-of-duties Template is
satisfied only when every account appears in the extraction with a grounded role list. That
rule was prose, so the permissive reading was applied to all four — and an account whose
permissions nothing could read passed its own control. It fails closed to the strict reading,
which can only ever degrade coverage.

**An unaccounted population row is decided at the Gate, not at acquisition.** The addendum's
early-stop rule is about acquisition failing, and an indeterminate row is not that; the Gate
rows are decided after the last Work Item. Exactly one check moved. The outcome is unchanged
— only when it is decided, and what exists by the time it is. Every other check still stops
the Run where it did, because those ask whether the bytes are what they claim, and a Run that
cannot trust its bytes has nothing to execute over.

**An Evidence artifact frozen before it is parsed is named with its attempt.** Otherwise a
retry uploads different bytes to the first attempt's key, the store refuses them, and every
retry dies accusing storage of an integrity failure against a system that is answering
correctly. A crash does not advance the attempt counter, so a resumed attempt keeps its own
key and the earlier idempotency guarantee is untouched.

**A refusal is thrown from inside a unit of work, never returned.** A returned refusal commits
everything written before it. This is the oldest rule in the codebase and it still applies to
every command added here.

**Canceled is never produced by a timeout or a limit.** That state is reserved for a person
cancelling, and the outcome rules read it to decide what a human may do next. A timeout that
wrote it would put a sentence naming an actor on a Run nobody touched.

**The frozen limits are read from the plan, never restated.** A Run is bounded by the contract
its own version froze.

## 5. What is deferred, and named

Nothing here is hidden. Each item is named in the code or a story specification as well.

- **The desktop Target System** and its execution port. Deferred since Epic 1; the desktop
  path is exercised with a registered synthetic desktop rather than a real one.
- **The token limit mapping** is implemented and unit-tested but never exercised, because
  nothing in this epic calls a model. It is wired so the agent epic fills it rather than
  adding a limit that was never mapped.
- **Two Gate rows are transcribed backstops.** They can only fail from a Session Step failure
  that already stops the Run before the Gate runs. They are tested in the domain.
- **A residual storage race.** Object immutability rests on a read before write plus a
  conditional header; two writers landing between one's read and its write, on a backend that
  ignores the header, is still possible. It is written down rather than claimed away.
- **Two findings were left alone deliberately**, because a test pins each as intended
  behaviour and changing them is a contract decision rather than a repair. Both are recorded
  in `CLAUDE.md` for the owner: a redelivered job past the Run time limit discards a
  population that was already acquired and verified, and replaying an initiation token after
  a duplicate refusal redirects into the other auditor's Run.

## 6. How this was built and checked

Each story was specified before it was built, implemented by a separate agent against that
specification, then verified independently in this session against a real database before it
was committed. No story was committed on a reported result; the numbers in section 3 are from
the independent run.

Two adversarial reviews then read the landed stories against the contracts and the golden
fixtures rather than against the code. They agreed on all twelve named per-record cases and
found seven defects around the evaluator, which were repaired in two further passes. Neither
reviewer could construct a path on which a record is counted compliant without inspection.

Where a fix mattered, it was mutation-proven: the fix was inverted, the test was watched
failing, and the fix restored. A test that has never failed is not a test.

**Two interruptions are worth recording rather than hiding.** Three background agents were
killed at once by a session rate limit; one had already written its work, which was picked up
and verified rather than redone. Separately, two mistakes of mine cost time: editing the
verification script while it was running, which corrupted that run, and killing a browser
suite so its cleanup never ran, which left a row that failed an unrelated test afterwards.
Both are now recorded in the project's decision log, and the verification script no longer
exits successfully over a failing step.

