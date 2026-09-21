# Executable Plan contract, schema 2 / compiler 2

New drafts derive an explicit `schemaVersion: 2`, `compilerVersion: "2"` plan.
The immutable approval and plan digest include `capabilityGraph`. Compiler 1 remains
an explicit supported historical contract: it derives and validates the original
schema 1 bytes, without a graph or conversation steering authority. No migration
rewrites a historical plan or approval. A mismatched schema/compiler pair is refused.

The graph is `{schemaVersion: 1, nodes: [...]}`. For P-1, each frozen web target
contributes these nodes in authored target order:

| ID | Target / action | Frozen population key | Prerequisite | Maximum successful searches per inspection attempt |
|---|---|---|---|---|
| `p1.employee-id` | Registration / `inspect-record` | `employee_id` | None | 1 |
| `p1.full-name` | Same registration / `inspect-record` | `full_name` | `p1.employee-id`: complete zero match | 1 |

Other targets and templates have no selectable fallback node. Node IDs are semantic;
model step labels and prose cannot rename or add authority. Equivalence checks retain
graph order, targets, lookup keys, predecessor predicates and limits. Population,
identity matching, origins, registered read actions, evaluation, evidence requirements
and Run limits still use the existing frozen contracts. A name-only candidate still
requires the existing human resolution; selecting a search cannot fabricate identity.

Eligibility uses successful platform-recorded searches with a grounded query control,
exact population value, complete zero-result pagination, and no contradictory record
data. The prerequisite must identify the same Run, target, Work Item, attempt and
Step Execution, plus the committed Tool Action and Structural Snapshot. Missing,
partial, foreign, duplicate or merely attempted searches do not unlock the fallback.

A worker publishes an immutable opportunity from committed captures. The auditor's
draft captures its exact graph/plan digests, subject, target, work/attempt/step,
prerequisite action/evidence and current snapshot IDs, and controller epoch. The
conversation accepts only the declared fixed strategy language with that anchor.
Confirmation accepts only Run and retained command IDs. Governed content must remain
readable. Confirmation queues the selection; it does not claim an executed action.

At the existing worker boundary, Pause and Stop run first. The worker re-reads the
registered snapshot bytes outside database transactions, verifies each digest and
size, and recomputes eligibility through the shared planner. The guarded transaction
then rechecks current role, controller epoch and expiry with PostgreSQL time, exact
inspection context, frozen graph and registered capture identities. It reserves one
Tool Action ID before browser I/O. Only registration of that exact performed search
can append `applied`, in the same transaction as the action. No new worker queue or
executor exists. Model-generated parameters and chat text cannot become tool arguments.

`run_strategy_opportunity`, `run_strategy_selection` and `run_strategy_transition`
retain immutable authority and receipts; `run_strategy_cursor` is only the worker's
current opportunity pointer. PostgreSQL guards enforce source intake, allowed state
transitions, role/lease/context checks, one dispatch per opportunity, and exact audit
and Tool Action identity. SQL verifies registered immutable references; it cannot read
external blob semantics. Blob completion/digest validation belongs to the worker,
which repeats it before consumption.

Replayed confirmation reads the original queued/applied receipt and cannot retarget
work. A dispatch with no committed action is an unknown outcome: a restarted attempt
supersedes the old selection and never dispatches its reserved action again. Existing
autonomous restart semantics may perform newly eligible searches in the new attempt;
that is not recovery of the old selected action. History survives with its Run.

New submitted/frozen review tool configuration names `executable-plan-v2`, while a
historical review retains `executable-plan-v1`. Readers require the interpreter and
compiled schema to agree. Moving an approved Procedure from interpreter 1 to 2 is a
configuration change and therefore uses the existing regression requirement. The
separate platform publication operation remains its existing model-only contract;
this release does not reinterpret or rewrite historical configuration publications.
