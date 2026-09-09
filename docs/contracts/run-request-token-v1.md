# Run initiation request token contract, schema 1

This is the normative contract for what an initiation request token MEANS: what a first use
of one decides, and what every later use of the same token answers. It is implemented by
`packages/application/src/runs/initiate-run.ts` over `run_initiation_request` (generation
32) and the refusal vocabulary in `packages/domain/src/runs/run.ts`, and it governs both
commands that create a Run — `initiateRun` and `rerunRun`, which share `createRun`.

It exists because the owner took a decision on 2026-09-06 about behaviour this repository
had recorded as an accepted recovery fix.

## What was wrong

A token used to be a BINDING from `(initiator, token)` to a Run id, and a request refused
because another Run already held the Procedure and period was recorded by binding the
caller's token **to that other Run**. Two things followed, and both were defects:

- **A replay walked a caller into somebody else's audit work.** Once the blocking Run
  ended, replaying the token found a row pointing at it, compared its Procedure and period,
  matched, and answered `{ ok: true, runId }` — so the surface redirected the caller into a
  Run a different auditor had initiated, presented as the outcome of their own click.
- **A token had no stable meaning.** The same replay answered a refusal while the blocking
  Run was active and a success afterwards. A person retrying a lost response was told two
  different things by the same button.

## The two properties

**Explicit.** A token's answer is STORED, not re-derived. The first request to reach the
decision point with a token writes what that token means; nothing later re-computes it
against a world that has moved on.

**Stable.** Every later use of the token returns exactly that answer, including the Run id
the refusal offered as a link, for as long as the record exists.

And the property that made the change necessary: **a token is bound only to a Run the
caller's own request created.** A refusal names the blocking Run as a REFERENCE — a Run
everybody with the role already sees in the Runs list — never as the token's answer.

## The record

`run_initiation_request` is keyed by `(initiator_id, request_token)` and holds:

| Column | Meaning |
|---|---|
| `procedure_id`, `period_from`, `period_to` | The SUBJECT the token was decided for |
| `run_id` | The Run **this caller's request created**, or `NULL` |
| `refusal` | The refusal code, or `NULL` |
| `refused_run_id` | The Run the refusal named, when it named one |

`CHECK ((run_id IS NULL) <> (refusal IS NULL))` — exactly one outcome, forever. `(a IS
NULL) <> (b IS NULL)` is boolean <> boolean and is never NULL, so unlike a comparison of the
values themselves this cannot pass by evaluating to NULL. `refused_run_id` is permitted only
beside a refusal: a created Run is `run_id`, and naming it twice would invite a reader to
ask which of the two the token really means.

The write is `ON CONFLICT DO NOTHING`, so the FIRST decision wins and two racing requests
carrying one token still mean one thing.

### The subject is stored, and carries no foreign key

The subject is stored on the record rather than read off a bound Run, because **a refused
request has no Run to read it from** — and it is what `RUN_TOKEN_REUSED` compares against,
so a token reused for a different Procedure or period is refused whether its first use
created a Run or not.

`procedure_id` deliberately has NO foreign key. A request that names a Procedure which does
not exist is exactly the `no-owner` case this record has to be able to hold; a foreign key
there refuses the row and answers the caller a framework 500 instead of the refusal
sentence — for the caller most likely to be probing. `schema-compat.test.ts` asserts the
absence, because an absence nothing checks is one the next `db:generate` quietly restores.

## The refusal vocabulary

Codes, never sentences: a stored sentence is a copy of the wording that drifts the first
time somebody edits the original. `RUN_REQUEST_REFUSALS` in
`packages/domain/src/runs/run.ts` maps each code to the one sentence it states, and
`predecessor-active` is `RUN_RERUN_REFUSALS.STILL_ACTIVE` by reference rather than retyped.

| Code | When | Names |
|---|---|---|
| `already-active` | An active Standard Run already holds this Procedure and period | That Run |
| `no-owner` | No executable `ACTIVE` version owns the period | — |
| `predecessor-active` | A rerun whose predecessor has not ended | The predecessor |

The database pins the same three in a `CHECK`, and a code this build does not recognise is
read back as `null`, which `replay` reads fail-closed as a refusal — never as the success an
unrecognised string must never become.

## What is decided, and what is not

A token is decided once the caller is authorized, the request is well formed, and the
SUBJECT is known. Everything from that point is recorded against it.

Three refusals are deliberately NOT recorded, and each for its own reason:

- **A malformed request.** It is a property of the arguments the caller supplied, so it is
  re-derived identically on every replay.
- **An unknown predecessor** (`RUN_RERUN_REFUSALS.UNKNOWN`). A Run id that does not exist
  never starts existing — ids are minted and never reused — so this is already the same
  answer every time, and there is no subject to record it under.
- **An authorization denial.** AD-7 says the role is read on every request and never
  cached, and a token that remembered a denial would be exactly that cache: a person whose
  role was granted a minute later would still be refused by a stored answer. Authorization
  is the one thing a replay is SUPPOSED to be able to answer differently.

## Order of operations

`rerunRun` consults the token **before** it judges the predecessor's state, so a decided
token answers from its own record and from nothing else. It comes after `findRun` only
because a rerun's subject is the predecessor's Procedure and period.

```
authorize → validate → (rerun: find predecessor) → find token decision
    ├─ decided → replay: subject matches? the stored answer : RUN_TOKEN_REUSED
    └─ undecided → refuse-and-record, or create-and-record
```

## Migration

Generation 32 backfills every existing row's subject from the Run it was bound to — exactly
what the old `replay` read — so no existing token changes what it is compared against. A row
whose bound Run was created by somebody else, or by this caller under a different token, is
rewritten as an `already-active` refusal naming that Run: `{ ok: false, reason:
RUN_ALREADY_ACTIVE, existingRunId }` is literally what that request was answered with at the
time, so this records what happened. What changes is only what a REPLAY of it returns, which
is the decision.

`tests/integration/migrate.test.ts` runs the backfill statements — lifted out of the
migration file rather than retyped — against TEMP tables holding pre-migration rows.
