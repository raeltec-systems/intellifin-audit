---
title: 'Story 4.7: Raise typed Escalations as durable waits'
type: 'feature'
created: '2026-09-06'
status: 'ready-for-dev'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-fixture-map.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** An agent that cannot decide something must be able to STOP and ask, and the
question has to survive a worker restart, fire exactly once when nobody answers, and never fire
twice. An in-memory wait is a question that vanishes on a deploy; a job without a singleton key
is a question answered twice by two workers.

**Approach:** One kind-agnostic wait record and one wake handler serve every Escalation kind —
and, later, Pause. The Run enters `AWAITING_AUDITOR`, the wait row and exactly one durable job
commit in the same transaction, and the job's payload names the wait and nothing else.

## Boundaries & Constraints

**Always:** The wait record is `{kind, options, deadline, closed_at?, closure_kind?,
answer_option_id?, actor?}` and is KIND-AGNOSTIC — the same record and the same wake handler
serve *choose candidate*, *unnamed value*, *retry or skip* and, later, Pause (AD-16). Exactly
one durable job is created in the SAME transaction as the state change, with
`startAfter = deadline` (4 hours), singleton key `wait:<wait id>`, and payload
`{schemaVersion, runId, waitId}` ONLY — Story 2.6 established that a producer must use
`fromDrizzle(transaction, sql)` for both the pg-boss constructor lookup and the send, or it
escapes the transaction or deadlocks a single-connection pool. The answer sets are CLOSED and
are the addendum's, in FR-27's order, with no recommendation attached to any of them. The agent
receives ONLY the chosen option identifier — no note, no rationale, no free text (AD-9). The
question shown to a human is labelled agent-generated and rendered inert, never an instruction
channel back to the agent.

**Never:** Never raise an Escalation for a case the platform can decide. A search with exactly
ONE grounded key match is resolved by the platform with no Escalation; ZERO rows is an absence
claim and goes to Story 4.5's path, never to an Escalation. Two result rows carrying the SAME
grounded key are not a unique match and DO raise *choose candidate* — that is the trap, because
a duplicate key looks like a match to anything counting rows carelessly, and Story 3.7 already
recorded the population-side version of it (a record key the population carries twice resolves
to `null`, never to one of the rows). Never let an answer evaluate a record, change scope,
credentials, tools or the Compliance Rule.

**Scope:** Raising the wait and its durable job. ANSWERING it from Run Detail, and the
notifications, are Story 4.8. Both stories share the wait row, so its shape is decided here and
is not revisited there.

## I/O & Edge-Case Matrix

| Input | Expected |
|---|---|
| Search returns exactly one row with a matching grounded key | Platform resolves it. No Escalation |
| Search returns zero rows | Absence path (4.5). No Escalation |
| Search returns two rows, different grounded keys, one matching | Platform resolves it. No Escalation |
| Search returns two rows with the SAME grounded key | *choose candidate* — not a unique match |
| Search returns several plausible rows, no unique key match | *choose candidate*, candidate rows and their grounded keys stored as supporting Evidence |
| Answer set for *choose candidate* | Exactly: choose by the declared secondary key (full name for the hero), or mark the record ambiguous |
| A record chosen by secondary key | Flagged `human-matched` in every Result, list and export — `OBSERVATION_MATCH_ORIGINS` already carries the value |
| A compiled condition meets a value outside the set it names | *unnamed value*; condition Unevaluated with `rule does not name value <v>`; answers: mark Unevaluated and continue, or abort |
| A Step Execution's retry budget exhausted | *retry or skip*; answers: retry (one more bounded cycle, counted against the Run-level Step Execution limit), skip (Work Item `UNINSPECTED`), abort. Work Item `AWAITING` while open |
| A second exhaustion after "retry" | Work Item `FAILED`; the Run CONTINUES |
| The same wait raised twice | The singleton key refuses the second job; the wait row is unique on its id |

## Code Map

**New:**
- `packages/domain/src/runs/escalation.ts` — the kinds, the CLOSED answer sets in FR-27's order,
  and the wait record's shape. Data, not markup: a table, transcribed, with a test that reads
  the addendum off disk — the `GATE_CHECKS` and `OUTCOME_ROWS` discipline.
- `packages/application/src/runs/raise-escalation.ts` — the command. Refuses a kind whose
  condition the platform could have decided.
- `packages/infrastructure/src/runs/wait-repository.ts` + the migration (generation 27):
  `run_wait`, with a partial unique index making at most one OPEN wait per Run.

**Modified:**
- `packages/domain/src/runs/run.ts` — `AWAITING_AUDITOR` becomes reachable. The state is already
  in the §E vocabulary and in the CHECK; nothing is added to either.
- `packages/application/src/runs/execute-agent-steps.ts` — raises, then yields.

## Tasks & Acceptance

1. **The wait record and its migration.** Kind-agnostic, one open wait per Run, a real foreign
   key to the Run, and a trigger refusing an UPDATE that reopens a closed wait — the
   `run_gate_check` and `run_exception` discipline.
2. **The three kinds and their closed answer sets**, transcribed from the addendum with a test
   that reads it off disk.
3. **The durable job**: one, in the same transaction, `startAfter = deadline`, singleton
   `wait:<wait id>`, payload of exactly three keys.
4. **The platform decides what it can.** One grounded key match resolves; zero rows is absence;
   two rows sharing a key is NOT unique.
5. **The agent receives only the option identifier.**
6. **`AWAITING_AUDITOR` reachable**, with the Work Item `AWAITING` for *retry or skip*.

## Design Notes

**Why kind-agnostic.** The addendum says so, and the reason is the one this repository keeps
learning: a table that grows one row per story stops being a table. Pause is a later epic and
must not need a second wait mechanism, so the record carries `kind` as data and the wake handler
reads it.

**Why the payload is three keys.** A job payload is durable and is replayed. Anything else in it
is a fact frozen at raise time that may be false at wake time — the Story 2.6 lesson about
authoring digests versus row-version tokens, one layer along. The wake handler reads the wait
row, which is current.

**The deadline is 4 hours and is not a Run limit.** It bounds the WAIT, not the Run; the Run's
own limits are frozen in the plan and keep running independently, exactly as Solari's rolling
idle window does not become a Run deadline.

## Verification

- Unit: the answer sets against the addendum on disk; the raise conditions, including the
  two-rows-one-key case.
- Integration: the wait and its job committing together against real PostgreSQL; a held-open
  transaction proving the singleton key refuses a second job; a restart leaving the wait open.
- Mutation: make one grounded key match raise an Escalation and prove a test fails.

## Auto Run Result

_Not yet run._
