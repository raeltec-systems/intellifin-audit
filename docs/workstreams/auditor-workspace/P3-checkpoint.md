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
  pause drops unrelated selected-record context, skips record fact reads and does
  not consume the ordinary question rate bucket or depend on its message quota. The
  absolute bounded history limit still fails closed. Explicit wait replies retain their
  request-bound interpretation and are not silently turned into Run commands.

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

## First P3 CI result

On `8fec5ff`, normal CI `35453444876` passed type/boundary/unit, P0 browser and
container checks. PostgreSQL completed with 601 passed and three failed: the pause
fixture accidentally attached an explicit wait-reply context (correctly preventing an
unqualified shortcut), cancellation teardown omitted its newly sealed evidence package,
and the exact schema inventory still named generation 52. Follow-up repairs retain
the interpreter rule, clean up the actual terminal package, and list the two generation
53 tables. The new pause application proof is not yet passed. Browser results remain
pending on this candidate.


## Second P3 database result

On `f89b1a0`, normal CI `35454413253` passed 603 of 604 PostgreSQL tests. The
cancellation supersession case and schema inventory passed. The remaining pause test
reached its changed-operation check with an out-of-range selected record, correctly
receiving malformed-envelope refusal before idempotency reconciliation. The follow-up
asserts that refusal and separately sends a valid changed-operation envelope with the
same key to test conflict. Later worker application/rollback/revocation assertions in
that case remain unproven until the rerun. Type/boundary/unit checks passed all 4,646
tests, P0 browser and container checks passed. Application-browser results are pending.
The preceding `8fec5ff` browser job was superseded and canceled, not passed.


## Actual worker/browser pause proof on `f89b1a0`

The browser result for CI `35454413253` is now complete: 228 passed, two failed, with
the compiled-worker journey passed. While the real worker was held at its test-only
boundary, the UI submitted the exact pause message and PostgreSQL retained its
received/interpreted/queued receipts. Releasing the worker produced the existing pause
wait and the applied receipt linked to the exact source event; the pause marker cleared.
Reload read that receipt, existing Resume started a fresh attempt, and the canonical
golden Inconclusive result remained unchanged. Native image/record inspection passed
in the same journey. This is application evidence, distinct from the unit/model tests.

The two unrelated browser failures and retained artifact digest are recorded in P2.
The remaining PostgreSQL pause test still requires the corrected-envelope rerun before
its later application, rollback and revocation assertions can be claimed. No gate is
closed by the passing browser case alone.


## Controller/confirmed Resume implementation candidate

Generation 54 adds a retained Run controller fence. Acquire/release/expiry advance its
epoch; authorized renewals retain it. PostgreSQL time is sampled after the existing Run
row lock. Lease changes, lifecycle audit events and the existing timeline wake commit
together. Expiry is a system observation with the triggering auditor explicitly named
as observer. No controller-transfer permission or implicit manager takeover is granted.

The shared Resume handler checks current role, Run revision, the live holder and exact
epoch under the same transaction as closing the existing pause wait. Run Detail, Live
View and Auditor Workspace share a confirmation dialog which captures the epoch and
revision the auditor actually confirmed. Every production caller must explicitly supply
the server policy; clients cannot supply that policy or actor. A retained row always
fences Resume even after feature disable. Pause, Stop and eligible exact-wait answers
keep their existing authority and accepted safety latches.

Mode-off deliberately disables **new enrollment**, while enrolled Runs retain protected
acquire/renew/release and Resume recovery. It neither deletes the fence nor strands an
already-paused Run. This is a compatible-application recovery rule, not proof an old
image can use generation 54. Exact schema compatibility still refuses old images.

Focused application/action tests pass (76); affected component checks pass (23);
application/infrastructure/web/root TypeScript and 675-module boundary checks pass.
These counts describe local verification only. New real-PostgreSQL cases cover competing
holders, same-actor reacquisition, expiry, revocation, rollback and a transaction begun
before expiry but blocked on the actual Run lock until after expiry. A new two-context
browser case holds an actual Resume POST across release/reacquisition and checks the
unchanged Run, open wait, revision and persisted audit chain. These integration/browser
cases still require normal CI execution.

This bounded slice is not all P3: confirmed chat Resume/Stop, command receipts for the
rest of the catalogue, exact contextual replies, deferred subject-target pause, flags
and frozen strategy capabilities remain. Renewal currently has epoch fencing and
unknown-response recovery, but no payload-keyed renewal receipt; do not claim its retry
is exactly once. Continuous named-controller display beyond the paused control surface
and the approved D3 transfer flow also remain. G5 process-kill/queue/mixed-version proof
and G7 measured capacity are not supplied by these tests.


## First controller CI observations

On `379699d`, normal CI `35457445681` passed migration 54, schema drift checking,
all 609 PostgreSQL integration tests across 50 files, and the database mutation job.
All 14 conversation cases and all five new controller cases passed, including the real
Run-lock/expiry probe. Container/startup and P0 browser checks also passed. The full
application browser and hydrated abuse jobs were still running at this entry. The type/boundary/unit job
passed TypeScript/boundaries and 4,690 unit tests; its one failure identified a
nonexistent caption class in the controller component. The follow-up uses the existing
class and passes the unchanged 34-case stylesheet contract locally. No completed green
CI result is claimed from these partial observations.


## Completed controller browser run and fixture repair

CI `35457445681` completed: focused authoring 16 passed; full application browser
189 passed, 22 failed and 20 not run. The compiled-worker journey passed with controller
acquisition, confirmed Resume, persisted conversational pause, native evidence and
record inspection, retaining the golden Inconclusive result. Hydrated abuse also passed.

Record review reached its 1440/1280 inspector captures, paging and role-revocation
checks, then failed to restore the shared Auditor because its fixture bound a raw Date
through postgres.js. Later authenticated cases failed or could not start. The repair
encodes the timestamp explicitly, including the same latent controller-fixture cleanup
bug. A separate live-escalation assertion now includes the actual lease-acquired event.
No authorization check is weakened. The new workspace layout, stale-tab controller
proof and Replay selection cases remain unverified until the clean normal-CI rerun.

Browser artifact `10589361619` reports SHA-256
`ba4135ee7adee8d7812b70db8a2a54df8a2b175c0929f5704d4277b86b96d6a4`.
The completed run is failed, not a passing checkpoint or closure of a proof gate.
