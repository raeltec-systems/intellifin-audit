---
title: 'Epic 3 implementation report: adapter Runs end to end'
type: 'report'
created: '2026-09-05'
revised: '2026-09-06'
status: 'final'
---

> **Final.** Every section describes behaviour that is delivered and independently verified
> against a real database, a real worker and the real synthetic services.
>
> **Revised 2026-09-06 after the owner's review.** Section 8 asked for four decisions; the owner
> took all of them and they are now built, not pending. Section 9 is the revised close-out the
> review asked for: the exact branch and commit carrying each repair, the gates re-run after
> each, and what is deliberately not claimed. **Nothing is merged.**

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

### Ten more, found after I called it done

Marking the pull request ready for review triggered an automated review, which posted ten
findings. **All ten were real.** Four contradicted an invariant `CLAUDE.md` already states in
words — the strongest signal a finding is genuine, because the rule was written down correctly
and implemented incompletely.

| | What actually happened |
|---|---|
| **A bucket outage recorded as tampering** | The missing-object check counted `NoSuchBucket`, so a deleted or misconfigured bucket made every read return nothing — which `verifySealedPackage` reads as a genuinely absent artifact. One outage would have written a permanent `object-missing` finding and its `failure.evidence-integrity` event against every artifact of every terminal Run the sweep reached. S3 answers `NoSuchBucket` with **HTTP 404**, so deleting the name alone would not have fixed it; the name is now tested first |
| **A fully covered Run sealing Inconclusive** | `readGateObservations` capped at `POPULATION_LIMITS.rows`, but the matrix is records × required systems. Every dropped **covered** cell read as missing coverage |
| **Runs queued with no consumer** | The whole population block sat inside `if (evidence.enabled)`, so with no `EVIDENCE_S3_*` no `runs` consumer was registered while Initiate Run stayed enabled |
| **Runs stranded mid-flight** | With storage but no credential manifest, the job was acknowledged after acquisition and the Run stayed `RUNNING` at `POPULATION_READY` with Evidence already frozen, selected by neither sweep |
| **An "exact" Gate total that was not** | `rows.length` of a read limited to 100,000, written into an immutable Gate row and a published Result |
| **A bad cursor rendering an empty page** | The comparison against a scalar subquery goes NULL for every row. Its test **asserted the defect**, three lines under a comment saying the opposite |

The last two are the direct cost of an earlier repair on this same pull request: letting the
worker start without a bucket rather than crashing was right; leaving the work that depends on
it startable was not. `stopUnexecutableRun` now ends such a Run `RUN_FAILED` through
`completeRun`, so the Result and package seal satisfy the deferred triggers rather than dodging
them, and it fabricates no checkpoint and no reservation.

Two findings touched decisions recorded as deliberate. Both decisions survive and the narrower
defect underneath each is fixed:

- **Cancellation at the final boundary.** The outcome a Run *earned* still wins — at the adapter
  stage that is a sealed conclusion one transaction away, and §E.1's `canceled` row matches on
  the state alone, so honouring it would record `gatePassed: false, checks: 0` over twenty Gate
  rows. What was missing is that the marker was answered by **nothing**. `completeRun` now
  appends `lifecycle.cancellation-superseded`, with the **system** as actor rather than the
  requester — naming them would say they caused an outcome they did not.
- **`DELETE` after sealing** stays permitted, because removing a whole Run is what teardown
  does. Refused now is deleting an Evidence row while its sealed package survives.

I swept for further instances of both patterns and found none; two nearby sites are correctly
written, and one is the working model the Gate total fix copies. Schema advances to **27**;
unit **2,749**, integration **340**, browser **124** with zero accessibility violations.

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

## 7. Whether the epic is actually done

**Yes, against a bar that was corrected once during the work.**

The brief assumed eight demonstrable terminal outcomes. Six are demonstrable in this epic and
two are not, and the two are named rather than counted:

| Outcome | Proven by |
|---|---|
| Inconclusive, segregation-of-duties | The full golden population, real worker |
| Inconclusive, high-value approvals | The full golden population, real worker |
| Pass | A clean synthetic source, real worker |
| Control Failure | The same source with one conflicting account, real worker |
| Run Failed | A Session Step failing after bounded retries |
| Canceled | A human cancellation, with frozen Evidence preserved |
| Pending Confirmation | **Not reachable.** Needs an Agent-Judged evaluation; Epic 4 |
| Completed to Inconclusive | **Not reachable.** Needs a human rejection; Epic 6 |

Both unreachable rows are implemented, sit in the addendum's order, and are tested with
constructed state. They are not skipped; they simply cannot be produced by anything this epic
builds.

**Why the golden populations could not show success.** They seed every failure mode at once —
one lists an account twice, the other has a transaction with no processed time — and two Gate
checks deliberately read the SOURCE rather than the included set, because a duplicate that
scoping filters out is still two rows claiming one identity. No inclusion rule escapes them.
That is the datasets working correctly, and it is why a clean source had to be built.

**What "proven" means here.** The real worker process, the real synthetic service over the
network, real PostgreSQL and a real object store. Every assertion reads what the Run actually
stored — the sealed Result, its outcome, the row of the outcome table that decided it, the
Gate rows and the per-record verdicts — and compares it with an expectation file written by
hand before any Run existed.

The Pass and Control Failure populations differ by ONE role on ONE account, and two further
accounts sit one permission short of a prohibited pair, so the rule's boundary is tested
rather than avoided. The fixture was mutated to confirm it can fail: an undeclared role makes
the Pass Run Inconclusive, removing the conflicting role breaks the Control Failure case, and
swapping the two populations breaks both.

**One gap is recorded rather than closed.** No browser journey cancels a Run that has already
acquired Evidence; that seam is proven against the database rather than through the worker
process.

## 8. What the owner decided, and where each decision landed

This section asked for four decisions. **The owner took all of them on 2026-09-06**, and each is
now built rather than pending. Three needed storage and are one migration, **generation 32**,
because they are one release.

| The question as asked | The owner's decision | Where it landed |
|---|---|---|
| A redelivered job past the Run time limit **discards a population** already acquired and verified | Keep it. The limit is unchanged and the Run still ends Inconclusive, but with its Evidence | `stopAtRunLimit` in `acquire-population.ts` — no store read, no durable attempt spent, digests carried through verbatim |
| Replaying an initiation token after a duplicate refusal **redirects into the other auditor's Run** | A token records a DECISION, not a Run | `run_initiation_request` (generation 32) and `docs/contracts/run-request-token-v1.md` |
| **No Evidence table records a capture time**, though FR-31 asks for one on every item | Store it per artifact, never derive it | `captured_at`, `capture_method`, `capture_time_source` on both `run_evidence` and `population_evidence` |
| **The declared record count is never persisted** — only its verdict | Show both numbers, each attributable to the artifact it came from | `declared_count` and `retrieved_count` on `population_snapshot`; the web still may not read object storage |
| **The desktop Target System stays deferred** | Confirmed: Epic 7 | Unchanged. `epics.md` is authoritative; two planning artefacts disagree with it and are reported below, not edited |

Two of those five carry a consequence worth stating plainly:

- **Capture time was only honestly backfillable for one table.** `run_evidence` rows written
  earlier take their instant from the Step Execution that froze the bytes and say so
  (`capture_time_source = 'step-execution'`). `population_evidence` was NOT backfilled, because
  no Step Execution produced that artifact; those rows keep saying **"Capture time was not
  recorded."** There is deliberately no third value meaning "we made one up".
- **`declared_count` was not backfilled either.** The declaration lives in object storage and
  SQL cannot read it; defaulting it to the retrieved count would make every unreconciled
  population look reconciled. `retrieved_count` WAS backfilled, and a CHECK pins it to
  `included + excluded + indeterminate` on every row.

### Still the owner's call, and deliberately not edited

**The desktop deferral is recorded in three places and two of them are wrong.**
`_bmad-output/planning-artifacts/.../epics.md` says **Epic 7** and is authoritative;
`fixtures/northstar/datasets/systems.json` still says Epic 3; `deferred-work.md` does not
mention it at all. These are planning artefacts, and the disagreement is the finding — so it is
reported rather than silently reconciled.

## 9. Revised close-out: which branch and commit carries each repair

Added after the owner's review of 2026-09-06. **Nothing is merged.** Both branches are pushed
and awaiting the review this section exists for.

### Epic 3 defects — `codex/epic-3-adapter-runs`

| Repair | Commit |
|---|---|
| All ten automated-review findings: `NoSuchBucket` read as tamper evidence, truncated coverage matrix, Runs queued with no consumer, Runs stranded mid-flight, an inexact Gate total, a bad cursor rendering an empty page, DELETE surviving a seal, a cancellation answered by silence, rerun replay, and the reaper read | `4fb496e` |
| This report amended to record those ten | `665c5a3` |

Gate on `4fb496e` against PostgreSQL 18: **2,749 unit · 340 integration · 124 browser**, no
schema drift, both builds. CI green on all four jobs.

### The five owner-review items — `codex/epic-4-agent-runs`

| Item | Commit | State |
|---|---|---|
| 1. Reconcile Epic 4 with the repaired Epic 3 baseline | `6c3ebd6` | Done |
| 2. The workspace replacement path losing its cleanup reference | `beb2825` | Done |
| 3. Configured Solari mode vs live-provider validation | `604b7c3` (decision), and the write-up in this same change | Done — proven live, boundary stated |
| 4. Revisit the LoanCore authentication decision | `604b7c3` (decision) + `c74c6c5` (implementation) | Done |
| 5. The five report decisions above | `717da6f` | Done |

Gates, each run in the main thread after the implementing agent's own run:

| After | Unit | Integration | Browser |
|---|---|---|---|
| `6c3ebd6` | 2,946 | 364 | 133 |
| `beb2825` | 2,949 | 365 | 133 |
| `c74c6c5` | 3,009 | 368 | 134 |
| `717da6f` | 3,027 | 381 | 134 |

No schema drift and both builds clean at every row.

### Item 1: the migration collision, and both paths proven

Both branches claimed generation 27 for different changes — Epic 3's adds triggers only, Epic
4's adds `run_workspace`. **Both changes are preserved.** Epic 3's keeps 27; Epic 4's three
migrations moved up to 28, 29 and 30, which needed exactly one `prevId` rewrite because Epic 3's
migration adds no table and so leaves the table set its successor diffed against unchanged.
`SUPPORTED_SCHEMA_MIN` and `MAX` are both 30.

The owner asked for proof of both paths, and both were run against real PostgreSQL 18:

| Path | Result |
|---|---|
| **Fresh install** — empty database to 30 | Exactly 30 `schema_meta` rows, no duplicate generation |
| **Upgrade** — a generation-26 database to 30 | Same end state |

The two schemas are structurally identical: **392 columns, 575 constraints, 12 triggers**.
Generation 26 is the honest upgrade start, because a database carrying Epic 4's pre-merge 27–29
holds numbers the merge reassigns and no post-merge build can reproduce it. Production is at 14.

### Item 3: what is proven live, and what is not

Full detail is in `epic-4-browser-provider-decision.md`. In one table:

| | Proven |
|---|---|
| Remote session creation | A session id and plan deadline from the gateway in 827 ms |
| Target reachability | `example.com` answered 200 to a navigation made by the remote browser |
| Capture | A 17,202-byte PNG and a DOM read |
| Release | `releaseAndWait` confirmed, then a clean client close |

**Not proven, and not claimed.** A remote browser cannot reach the synthetic Northstar systems,
because they are served on this container's loopback — measured, `ERR_CONNECTION_REFUSED`. So
the golden journeys run on local Chromium, live validation covers the provider against a public
target only, and **local execution is never cited as evidence that the Solari path works**.

### Gate runs that failed, and were repaired rather than smoothed over

- The merge gate caught a guard asserting the composition root's decision as literal source,
  which a reformat had broken. The source form was restored; the guard was not loosened.
- The same run's other two failures were a test database still carrying the pre-merge
  generations. The AD-15 startup guard refusing it was correct behaviour, and the database was
  recreated from zero as CI does every run.

### What this close-out does NOT cover

- **Unfinished agent, live/replay and scheduling work is Epic 4 and later**, kept deliberately
  out of the Epic 3 defect close-out. Stories 4.4 to 4.11 are specified and not implemented.
- **Desktop execution stays deferred to Epic 7.**
- **Neither branch is merged**, per the review.
