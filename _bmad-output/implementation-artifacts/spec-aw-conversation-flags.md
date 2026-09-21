---
title: 'AW P3: confirm a manager flag from the Run conversation'
type: feature
created: '2026-09-20'
status: in-progress
baseline_commit: 00de6c32b0c5d3be00599f9ceb2d03855ba691a8
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/docs/workstreams/auditor-workspace/spec-v1.1.md'
---

<frozen-after-approval reason="user authorized completion of the PR 51 workstream">

## Intent

**Problem:** The conversation recognizes a flag request but cannot deliver it to the existing manager-attention workflow. A lost response must not create repeated flags or notifications from the same proposal.

**Approach:** Persist a governed flag proposal and explicitly confirm its retained note through the existing `flagRun` command, in the same transaction as the exact interaction receipt. Separate new proposals remain distinct flags.

## Boundaries & Constraints

**Always:** Reuse `run.flag`, existing eligible Run states and notification recipient rules. Bind actor, Run, proposal and retained note digest. Reauthorize first confirmations and receipt recovery. Lock readable original/proposal content; decrypt the stored note during confirmation instead of accepting replacement text. Preserve immutable event/flag identity and explain that a flag requests manager attention without pausing work.

**Ask First:** D2 before real-data admission. D3 manager control-transfer is unrelated to requesting manager attention and grants no new authority here.

**Never:** Pause, resume, cancel, transfer control, alter evidence or outcome, notify anyone outside existing authorized recipients, copy chat text into the immutable event or notification payload, reuse a proposal for a different note, or merge/deploy.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Proposal | Exact flag request with optional bounded note | Display request and optional note; no notification yet | Unsupported prose asks clarification |
| Confirmation | Original actor, current permission, eligible Run, readable proposal | One existing flag and its authorized notifications, exact applied receipt | Atomic domain/receipt transaction |
| Lost response | Same proposal retried, including concurrently | Recover same flag/event/notification set | No second flag |
| Another proposal | Same actor and identical or different note, new proposal | Separate explicit flag | Never deduplicate distinct human statements |
| Changed/forged input | Extra fields, another Run/actor/command or browser-supplied note | Refuse before mutation | Exact confirmation envelope |
| Revoked/removed/corrupt | Role revoked or either governed body unavailable | Refuse new confirmation | No stale-modal action |
| Terminal race | Run ends before first confirmation | Existing flag refusal | Historical applied receipt remains recoverable with current access |
| Write failure | Flag, notification, event or receipt write fails | All writes roll back | Same proposal remains safe to retry |
| Unknown delivery | Confirmation request outcome unavailable | Keep exact confirmation identity and explain uncertainty | No fresh proposal silently created |

</frozen-after-approval>

## Code Map

- `packages/application/src/runs/run-conversation.ts`: extend typed command/proposal DTO and bounded flag interpretation. Keep exact `flag` / `flag: note` supported; ordinary-language aliases must be explicit whole-message forms with no conditional/negated consent inference.
- `packages/infrastructure/src/runs/run-conversation-repository.ts`: persist note in governed encrypted content and an immutable proposal anchor with digest/length only. Existing intake fingerprint protects request-key meaning. Confirmation accepts only `{runId,commandId}`, locks canonical Run then command and both content rows, authorizes freshly and calls `flagRun` on the same transaction. Validate stored note digest before execution. Recovery checks the exact retained flag and event; no outcome inferred from any flag on the Run.
- `packages/application/src/runs/flag-run.ts`: trusted optional conversational command metadata, never an untrusted request field. Preserve direct-control semantics where separate direct requests create separate flags. Include command identity in the existing domain event when supplied by the adapter; the note still stays out of that event and notification payloads.
- `packages/infrastructure/src/runs/` existing `PostgresRunFlagRepository` and unit-of-work: permit `Database | Transaction` composition if necessary, retaining same Run lock/fresh role/notification transaction. Follow its actual file location rather than adding a duplicate adapter.
- `packages/infrastructure/src/runs/run-interaction-projection.ts`, domain audit validator, schema and next migration: typed flag command anchor and exact applied-event guard. Join authoritative flag row by Run/flag ID, proposer, session, time and note digest/length. Use explicit null-safe checks for an absent note. Preserve immutable command/receipt lifecycle and previous command guards.
- `apps/web/src/runs/run-conversation-actions.ts`, `RunConversation.tsx`, `RunWorkspaceConversation.tsx`: server action, Review flag dialog naming manager attention, safe note rendering and applied/refused/unknown copy. Keep LiveGate/desktop; flag does not require a controller lease. Applied receipt can link the retained flag history without exposing internal IDs as the main label.

## Tasks & Acceptance

- [x] Implement bounded interpretation and governed immutable flag proposal.
- [x] Compose existing flag handler and event-linked confirmation with idempotent recovery.
- [ ] Add migration/schema/event validation and direct SQL negative receipt tests.
- [x] Render explicit consequence, retained note, truthful applied/refused state and lost-response recovery.
- [ ] Prove every matrix row with focused unit and PostgreSQL tests, including duplicate/distinct concurrent confirmation, rollback and note removal.
- [ ] Prove browser confirmation, response-loss retry, revocation and persisted one-flag/notification counts.
- [ ] Update P3 checkpoint, continuation report and reusable decisions in `CLAUDE.md` with executed evidence.

**Acceptance:** Given an eligible Run and authorized auditor, when a retained flag proposal is confirmed, then its existing manager-attention flag and notifications commit exactly once. Given two distinct proposals, when both are confirmed, then two attributed statements are retained without affecting Run execution.

## Design Notes

Manager attention is a separate authority from D3 control transfer. Existing flags retain their established note storage contract; this synthetic conversational slice must not claim real-data governance approval. A governed conversation removal before confirmation prevents execution, while removal after application cannot rewrite the original fact. Parent coordinates browser and database fixtures. Follow sibling adapters if files move.

## Verification

Pinned Node/pnpm; typecheck, boundary/unit checks; fresh PostgreSQL18 migration/drift plus flag/conversation/notification integration; zero-retry authenticated browser test. Review the notification payloads and retained event keys explicitly for note leakage. No provider or external messaging connector is used.


## Implementation sequence and ownership

Work in the isolated `pr51-conversation-flags` checkout. Manager transfer owns migration
0060 and preview owns 0061. Reserve 0062 for flag storage guards, but do not generate
journal/snapshot/compat changes until the parent sequences those earlier migrations.
Build the application/domain/web slice and draft SQL first. Parent owns heavy database,
browser/full-suite execution, independent review, integration and commits/pushes.
Preserve the native POST correction and selected Replay behavior already in this baseline.


## Initial adapter composition

The existing flag handler now accepts an optional trusted conversation command identity
through its dependencies, never through the untrusted direct request. Its event carries
that reference while notification payloads keep their existing note-free contract. The
PostgreSQL flag repository accepts a transaction for atomic adapter composition. This is
preparatory code only: command admission, confirmation, projection, guards and UI remain.

## Implementation handoff (2026-09-20)

The isolated slice implements governed `flag` / `flag: note` intake, an immutable
`flagAnchor` containing only note digest and length, and `confirmFlag({runId,commandId})`.
Confirmation locks Run, actor identity and both encrypted bodies; decrypts and validates
original note plus exact displayed proposal; then composes the existing `flagRun` with
its authoritative event and interaction receipt in one transaction. Applied recovery
requires current permission and original actor, and remains valid after Run termination
or governed text removal. Role-revocation serialization depends on migration 0060's
identity lock trigger. Direct Flag semantics and recipient selection remain unchanged.

The draft `packages/infrastructure/drizzle/0062_confirmed_conversation_flag.sql` includes
typed anchor checks, exact fact/flag/receipt validation, indexed validated UUID lookup,
unique per-command flag and event identities, atomic receipt constraints, and retained history.
Its note length calculation follows JavaScript UTF-16 length, including supplementary
Unicode. Journal, snapshot, compatibility and schema_meta sequencing remain parent-owned
until migrations 0060 and 0061 are integrated.

Web changes add the dedicated authenticated flag action, inert retained-note rendering,
explicit manager-attention confirmation, lease-independent eligibility, and same-proposal
unknown-response recovery while respecting LiveGate and desktop requirements. Native POST
forms remain intact. Source text is rendered separately from platform consequence copy.

Executed focused verification: 57 tests passed across the bounded flag interpreter (12),
existing conversation interpreter (30), exact flag receipt matcher (2), authenticated flag
action (3), and conversation rendering (10). The existing flag handler's 29 tests also
passed, including trusted context and rollback behavior. Domain, application, infrastructure
and web typechecks passed again after the additional immutable flag-row binding. The final
focused run passed 56 tests across the flag handler (29), bounded flag interpreter (12),
receipt matcher (2), action (3), and renderer (10); the existing conversation interpreter
suite separately passed all 30 cases. `git diff --check` also passed.

Parent validation handoff:

- `tests/integration/conversation-flag.test.ts`: eligible states, exact Unicode note and
  absent note, current recipient set and no note leakage, no Run/lease effects, duplicate
  and distinct concurrent confirmations, semantic-key conflict, cross-actor/Run/envelope
  refusal, role-revocation lock race, original/proposal removal, initially corrupt content,
  wrong-key content, terminal recovery with fresh access, full rollback, SQL malformed
  inserted facts, event-without-receipt refusal, immutable/deletion guards and direct flags.
- `tests/e2e/conversation-flag.spec.ts`: actual authenticated confirmation without a lease,
  inert note text, unchanged open question, exact persisted notification set, lost-response
  retry, account change to a different eligible identity and fresh role revocation.
- Synthetic browser key remains the existing fixture value; no new service/environment
  setting is required beyond integrated schema 0062 and existing conversation configuration.
- PostgreSQL, browser execution, root test TypeScript, full checks, independent reviews,
  final report/checkpoint integration and commits/pushes remain parent-owned and unclaimed.

The existing flag row now carries an optional immutable `interaction_command_id`; direct flags keep null. This trusted optional port argument is written only by the existing handler composition. A unique binding and deferred row constraint prevent a direct flag, orphan row, or another proposal from substituting for the confirmed statement, and require its exact flag/event/receipt transaction.
