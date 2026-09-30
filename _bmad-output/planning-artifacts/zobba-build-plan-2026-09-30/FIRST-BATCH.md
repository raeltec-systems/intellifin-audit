# First implementation batch — Stories 20.1–20.4

This is the recommended first **foundation** batch, ready for normal story specification and implementation through the installed `bmad-build`. This planning request does not execute it. The sole backlog is [epics.md](../epics.md); all new statuses start **backlog**, because no new implementation story spec or code has been produced. “Batch ready” means that scope, decisions, dependencies and acceptance are recorded, not that stories are already built or marked ready-for-dev.

| Order | Story | Bounded result | Required verification |
|---|---|---|---|
| 1 | **20.1 — Start the new application from one reproducible workspace** | Minimal Rust/Axum/Tokio/SQLx API and worker, React/Vite shell, owned generated interface and explicit migration/CI entrypoints. | Pinned clean bootstrap, independent health/build checks, boundaries, empty PostgreSQL 18 migration and wrong-schema refusal. |
| 2 | **20.2 — Sign in to an explicitly scoped engagement** | OIDC session, minimum organisation/client/engagement/membership schema, current role and transaction-local database scope. | Positive access plus guessed-ID, cross-tenant/client, pooled-context reset, revoked-session and CSRF/OIDC negative cases. |
| 3 | **20.3 — Accept task commands once and recover them after restart** | Minimal Task/work-cycle/command/events/wakeup schema, one owner epoch, separate intent revision, durable control receipts and inert test executor. | Duplicate/lost-ACK/crash admission, restart, stale owner, same-owner stale-intent claims and accepted-versus-quiesced Pause/Stop. No external effects. |
| 4 | **20.4 — Keep one engagement conversation with attributed task cards** | Durable conversation and explicit Task links, independent composer, named guidance targets, replay cursor and initial Pair shell. | Two Tasks/one conversation, duplicate message receipt, reconnect/gap handling, narrow/keyboard use and no invented model output. |

The chain is **20.1 → 20.2 → 20.3 → 20.4**. A single responsible build agent should complete and verify each before advancing. Parallel scouts may inspect non-overlapping references; shared contract authorship stays explicit. The next dependency-ready work is 20.5 (operation/Permissions contract). That opens early real computer qualification 23.1 while membership, evidence and method work develop. Do not wait for all agent/evaluation/UI work to discover that the intended sign-in profile is unsupported.

## Implementation instructions

Read the active SPEC and its adopted companions, then the named story and the architecture contract register. Generate a bounded story specification through the installed workflow before implementation. Create only schema and interfaces needed by that story. Pin actual supported toolchain/dependency versions in 20.1; no arbitrary latest-version assumption is part of this plan.

Use new application entrypoints and a fresh development schema. Existing Node code and old contract files are reference sources, not required runtime dependencies. Preserve the old tree and useful tests until a later scoped retirement change owns deletion. In this batch, preserve relevant behaviours as fixtures: scoped access, fresh role checks, transaction-local reset, idempotent command admission, stale owner/intent fencing, durable receipts, truthful reconnect and bounded streams. Evidence read-back/registration and effect reconciliation are subsequent owned stories; do not claim they are implemented in this batch.

Use a local OIDC fixture and synthetic users for repeatable first-batch tests. Production identity remains Cognito OIDC with Rust sessions as fixed by AD-48. Local test identity is not a production bypass or successful customer sign-in qualification. No customer credentials, live audit material, provider spend or cloud deployment is necessary to pass the four foundation stories.

Reuse Pair token/asset sources and their licences. For any adopted Codex or legacy code unit, record exact source revision, adapted unit, applicable notices and boundary tests. Do not copy upstream loop/queue authority or treat old green tests as acceptance of a new implementation.

## Explicit workflow entry

To avoid the generic build workflow selecting unrelated historical draft specs, name the new story each time. The first request is:

> Use `$bmad-build` to implement Story **20.1** from `_bmad-output/planning-artifacts/epics.md`, following the accepted revision-3 active SPEC and its adopted companions. Limit this run to Story 20.1. Preserve historical code/planning; implement and verify the new workspace boundary only.

Continue with the same explicit form for **20.2**, **20.3** and **20.4** after each dependency passes. A later user request may authorise the whole batch; the ordered scope and acceptance remain the same. Use the normal `_bmad-output/implementation-artifacts/sprint-status.yaml`, never a parallel Zobba queue. Let the workflow generate its normal story spec/evidence and advance statuses from real results. Do not reuse an old Story 1.x–19.x spec or relabel its completed status.

## Batch exit

A fresh checkout can bootstrap the new workspace, a synthetic authorised person can enter a scoped engagement, and one conversation can persist commands for two distinct Tasks. Lost replies and restarts do not duplicate accepted commands. Pause/Stop and guidance remain attributable and independent of inert executor stalls. Negative scope and stale-state tests pass, and the narrow/keyboard shell stays usable.

The batch does **not** deliver autonomous audit work, native model calls, real connectors/computer/sign-in, firm-method execution, analysis, evidence acquisition, evaluation, review, Checks or customer deployment. Those are explicitly scheduled in the dependency graph and required by the later gates. Its value is a small, testable authority and conversation foundation that the full product can safely grow from.
