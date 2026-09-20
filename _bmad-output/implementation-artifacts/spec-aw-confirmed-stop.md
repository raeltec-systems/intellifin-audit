---
title: 'AW P3: confirmed conversational Stop'
type: feature
created: '2026-09-20'
status: done
baseline_commit: 0298911c83358d82608b85ceb30ade589d5d100c
review_loop_iteration: 1
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/docs/workstreams/auditor-workspace/spec-v1.1.md'
---

<frozen-after-approval reason="user authorized continuation of the complete PR 51 workstream">

## Intent

**Problem:** The workspace recognizes Stop but only directs the auditor to another control. An auditor must be able to review and explicitly confirm the conversation proposal, then see the real cancellation outcome.

**Approach:** Extend the existing immutable interaction ledger and cancellation command. Bind the proposal to the current Run revision and frozen plan; confirmation calls the same cancellation handler as existing controls inside the receipt transaction. Existing worker ownership and evidence preservation remain authoritative. This is the first delivery slice of the full continuation, not a narrowing of the user's remaining P2–P6 scope.

## Boundaries & Constraints

**Always:** Follow AW-001–008 and AW-104. Recheck current actor authority after the canonical Run lock. Exact Stop is a proposal, never an immediate action. Questions, quoted text, negations and qualified prose grant no cancellation consent. Cancellation remains independent of a control lease. Protect retry identity and minimize content retained in audit events. Use the real cancellation handler and its queue/worker boundaries. Keep existing non-conversation controls compatible. Every queued/applied receipt must bind its exact authoritative event, actor, Run and command. Keep unknown response recovery honest.

**Ask First:** D2 before real-data admission and D3 before manager transfer authority; neither is needed for this synthetic Stop slice.

**Never:** Merge, deploy, weaken authorization, change outcome/evidence rules, invent success from accepted text, claim full proof-gate closure, or send conversation text to execution tools.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Proposal | Exact Stop on an active Run | Immutable confirmation proposal; no cancellation | No effect before confirmation |
| Immediate cancellation | Confirm original proposal on QUEUED/PAUSED/waiting Run | Existing command cancels and seals; exact applied receipt | Transaction rolls back as a unit on error |
| Worker cancellation | Confirm while RUNNING | Queued receipt, then applied only at actual worker cancellation | Never say stopped while still queued |
| Lost response | Retry same confirmation before or after worker completion | Same command and outcome; one effect/event chain | No refreshed context or second request |
| Changed context | Different Run revision or frozen plan before initial confirmation | Refuse original proposal | Review fresh state |
| Revocation/forgery | Other actor, revoked actor, wrong Run/command, corrupt or removed proposal | Refuse; no cancellation | Bounded safe reason |
| Terminal/competing stop | Run completed or another command already owns cancellation | Truthful refusal/supersession; no claimed ownership | Preserve first requester |
| Question | “Should I stop?” or “do not stop” | Read-only explanation/clarification | No proposal execution |

</frozen-after-approval>

## Code Map

- `packages/application/src/runs/run-conversation.ts`: exact interpreter, request parser, public proposal/receipt types; currently kinds pause-now, pause-after-inspection, resume.
- `packages/infrastructure/src/runs/run-conversation-repository.ts`: `append`, `read`, `confirmResume` are the existing transaction, governed-content, idempotency and confirmation patterns. Reuse them without copy-pasting permission policy.
- `packages/application/src/runs/cancel-run.ts`: `cancelRun` and `performCancellation` own cancellation and sealing; optional server-created interaction context must not be accepted from untrusted callers.
- `packages/domain/src/runs/run.ts`, `packages/infrastructure/src/runs/run-repository.ts`, `runs-unit-of-work.ts`: durable cancellation marker and repository. Preserve command identity to the worker if required. Cancellation repository must compose with an outer transaction just as pause/wait does.
- `packages/infrastructure/src/runs/run-interaction-projection.ts`: audit writer projects authoritative effects. `packages/infrastructure/src/db/schema.ts` and `drizzle/0056_confirmed_conversation_resume.sql` show immutable proposal and exact-event SQL guards. Add migration 57 with matching snapshot/journal and schema generation; do not rewrite historical migrations.
- `packages/infrastructure/src/db/audit-events.ts` and domain audit event schemas: retain closed payload validation for any optional command identity.
- `apps/web/src/runs/RunWorkspaceConversation.tsx`, `RunConversation.tsx`, `run-conversation-actions.ts`: proposal review, consequence/confirmation and server action. Match the existing Stop dialog's consequence weight; keep LiveGate.
- `tests/integration/run-conversation.test.ts`, `tests/e2e/run-controller-lease.spec.ts`, existing cancellation unit/integration/worker browser journeys: reusable fixtures and actual persistence proof. Search sibling marker readers before extending the shape.

## Tasks & Acceptance

**Execution:**
- [x] Extend interpreter-facing types, durable proposal and exact-event guard/projection for Stop.
- [x] Compose cancellation with confirmation under one Run transaction; preserve retry and worker receipt identity.
- [x] Add confirmation UI/server action and truthful queued/applied/refused messages.
- [x] Cover the matrix with meaningful unit, real PostgreSQL and browser/worker tests; preserve existing cancellation and Resume assertions.
- [x] Record the reusable rule in `CLAUDE.md` and actual proof in `docs/workstreams/auditor-workspace/P3-checkpoint.md`; do not report unrun checks as passing.

**Acceptance Criteria:**
- Given an authorized auditor without controller ownership, when the exact Stop proposal is confirmed, then cancellation uses existing authority and reaches the same terminal/evidence behavior as the original control.
- Given a worker-owned cancellation, when the page reloads or the confirmation response is lost, then the durable ledger distinguishes queued from applied and permits recovery without another effect.
- Given other running safety controls, when Stop completes, then existing pause/deferred-pause supersession and retained audit history remain unchanged.

## Spec Change Log

## Design Notes

Stop is a Run-wide safety operation; selection of an old evidence record cannot retarget it. Unlike Resume, it does not require capturing controller authority. A stale proposal must not silently rebind to a new Run state. A replay can report the original durable outcome after state moves forward, but still needs current access authority. Immutable command identity must survive worker restart; an in-memory map is insufficient.

## Verification

- Full TypeScript checks/build and schema generation passed; migration 57 has no schema drift.
- Final unit run: 4,719 passed. The 26 dependency-boundary tests passed separately.
- Fresh PostgreSQL 18: all 58 conversation integration tests passed with final migration 57.
  Other integration suites: 602 passed before the final worker/web prior-state guard tightening;
  the fresh 58-test run includes that guard.
- All seven targeted product browser journeys passed across the combined run and the isolated
  warm-route golden rerun, with zero Playwright retries. Coverage includes terminal and queued
  Stop lost-response recovery, exact replay, revocation, controller races, Resume, the golden
  worker result and actual worker kill/recovery with retained evidence.
- Earlier local attempts were terminated under memory pressure; the cold golden attempt also
  exceeded its fixture deadline. Disk-backed Turbopack eviction and route warming resolved the
  verification environment without changing worker deadlines or product assertions. Final web
  TypeScript passed after the optional local-memory config and startup-import correction.
- Three independent reviews were reconciled before final proof. No overall acceptance gate is
  closed by this slice; the continuation report records remaining work and D2/D3 boundaries.

## Suggested Review Order

- Confirm the retained proposal under current authority and the canonical Run lock.
  [run-conversation-repository.ts:768](../../packages/infrastructure/src/runs/run-conversation-repository.ts#L768)

- Reuse cancellation and preserve command identity through worker completion.
  [cancel-run.ts:137](../../packages/application/src/runs/cancel-run.ts#L137)

- Guard immutable ownership, exact event receipts and canceled sealed outcomes in PostgreSQL.
  [0057_confirmed_conversation_stop.sql:1](../../packages/infrastructure/drizzle/0057_confirmed_conversation_stop.sql#L1)

- Present explicit consequences and recover the same request after uncertain delivery.
  [RunWorkspaceConversation.tsx:32](../../apps/web/src/runs/RunWorkspaceConversation.tsx#L32)

- Prove concurrency, content removal, revoked authority, rollback and forged database bindings.
  [run-conversation.test.ts:121](../../tests/integration/run-conversation.test.ts#L121)

- Exercise authenticated response loss, replay and unchanged cancellation effects.
  [run-controller-lease.spec.ts:273](../../tests/e2e/run-controller-lease.spec.ts#L273)

- Kill the compiled worker after acceptance and verify durable recovery with retained evidence.
  [prodconsole-agent-journey.spec.ts:697](../../tests/e2e/prodconsole-agent-journey.spec.ts#L697)

