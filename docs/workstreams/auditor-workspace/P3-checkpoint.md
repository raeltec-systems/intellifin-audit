# Auditor Workspace — P3 control checkpoint

Status: first control path in development. This is not completion of P3 or the
co-working release. No merge or deployment is authorized.

## First implemented path

The exact, unqualified `pause now` interpretation calls the existing `pauseRun`
handler through the enclosing conversation transaction. Its server-generated command
identity is persisted on the existing pause marker and follows the existing worker
pause/finalization events. The command projection records received, interpreted, queued,
applied or refused/superseded without taking ownership of execution.

- Intake, immutable interpretation, marker, request audit event, narration and encrypted
  reply commit together. All role, wait and audit dependencies share one connection.
- Same semantic safety shortcut and idempotency key replay the original intake after a
  fresh access check. A changed operation conflicts. A second actor cannot claim an
  already pending request; the original marker remains unchanged.
- A queued receipt means the Run is still running. Only the existing worker pause event
  makes the receipt applied. Existing terminal finalization can instead supersede it.
- The accepted safety latch survives subsequent revocation. New requests/replays and
  reads still reauthorize. A second command cannot revive a terminal receipt.
- PostgreSQL guards receipt ordering, immutable metadata, exact intake membership and
  causal event/actor/Run identity, including the exact pause intake event. Receipt
  reads fail closed for missing or changed source facts. Public command IDs are server-issued provenance,
  never client-supplied authority.
- The receipt reads the current command state separately from immutable message text.
  The UI names its time and keeps technical IDs in the existing details disclosure.
- Safety admission has a separate bounded limiter from ordinary questions/notes. There
  is no model/provider call under the transaction and no new execution engine. Exact
  pause drops unrelated selected-record/wait context, skips record fact reads and does
  not consume the ordinary question rate bucket or depend on its message quota. The
  absolute bounded history limit still fails closed.

## Verification in progress

The application pause/finalization unit checks pass (56 tests), together with focused
conversation checks, TypeScript and boundary checks. Migration generation is clean.
These checks are not application acceptance proof.

New PostgreSQL tests exercise the actual transaction-bound pause and worker context:
retry/conflict, competing requester, forged receipt rejection, rollback, revocation,
worker application and cancellation supersession. The actual compiled-worker browser
journey is being extended to submit the message while execution is active, prove the
queued/applied persisted states, then resume through the existing UI. Neither new
proof is claimed passed until normal CI executes it.

The preceding candidate `4a88960` passed 601 of 602 PostgreSQL tests, including all
12 conversation tests. Its remaining failure was the newly added pause composition
assertion comparing an int with a bigint returned as text. The test now explicitly
casts the bounded source event sequence. Type/boundary/unit, P0 browser and container
checks passed on that candidate; full browser outcome is recorded in the P2 checkpoint.

## Remaining P3 scope

Controller lease/epoch fencing across all entrypoints, confirmed Resume/Stop, exact
request answers from conversation, deferred record-bound pause, flag actions and
versioned frozen strategy capabilities remain to implement and verify. Legacy plans
without a strategy graph cannot be steered into a new lookup. Existing buttons retain
their current domain checks. Ordinary explanatory Q&A remains deterministic and bounded;
it is not yet the full explanation/interpreter experience.

G5 still needs real process-kill/race and mixed-version rollback proof. Generation 53
retains the existing exact schema-generation startup guard; a prior image refuses this
new schema rather than half-serving it. This is not a claim that rollback has been
proven. G7 still needs the specified workload benchmark. G1 auditor study, G3 preview/
private-input isolation, and D2/D3 policy/authority decisions remain open.

## Worker-boundary correction

Review of the actual P-4 runner found a missing lifecycle check after its specialized
page-model turn. The follow-up invokes the existing boundary before registration,
retaining cancellation priority and attempt-restart semantics. The interrupted completed
model turn remains attached to its superseded attempt; the resumed successful read is
verified separately. The compiled-worker browser journey now checks queued/applied
PostgreSQL receipts and Resume before preserving the unchanged golden negative result.
This proof is still pending normal CI.
