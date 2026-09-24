---
title: 'AW P3: confirm an answer to its exact open question'
type: feature
created: '2026-09-20'
status: done
baseline_commit: 4e2791d95abd1134ad7e7cb9a7cd57a4e7661fa0
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/docs/workstreams/auditor-workspace/spec-v1.1.md'
---

<frozen-after-approval reason="user authorized completion of the PR 51 workstream">

## Intent

**Problem:** `answer:` text currently produces an inert proposal. The composer also reads the latest wait at submission, so an old draft can accidentally target a newer question. Auditors need to resolve an actual agent question through the conversation without changing its options or execution authority.

**Approach:** Capture a server-derived question anchor when drafting begins. Resolve ordinary answer text only against that exact question's finite options. Persist a proposal naming the chosen option and its question; confirmation invokes `answerEscalation` atomically and records the existing domain outcome. The existing decision card remains usable.

## Boundaries & Constraints

**Always:** Bind Run, wait ID, revision, question/options digest, deadline, chosen option and proposing actor. Obtain authority and server time after the canonical Run lock. Confirm only retained, readable intake AND proposal content. Store bounded text in governed encrypted content; events carry identities/digests, never the chat or credentials. Retain the exact request and draft anchor through unknown responses. Authorize retries afresh; distinguish historical success from current Run state.

**Ask First:** Any new role permission. This slice reuses `escalation.answer` without a controller requirement.

**Never:** Resolve an answer against a replacement question, infer consent from unrelated prose, forward a human note to the worker/model, alter option meanings, bypass existing wait closure/expiry/revision guards, turn a pause into an escalation, or merge/deploy.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Exact choice | Current question, unique option ID or label | Display question, chosen option, consequences and deadline for confirmation | No effect on intake |
| Ambiguous prose | Multiple matches, unsupported alias, conditional or negated answer | Clarify with the current permitted choices | No executable proposal |
| Draft crosses questions | Draft began at W1; W2 now open | Retain W1 identity and refuse it | Never retarget to W2 |
| Context changes | Option text/meaning/digest, revision or deadline changes | Refuse stale proposal before closure | Explain what must be refreshed |
| First confirmation | Fresh permission and exact live wait | Existing typed answer closes once and worker wakes normally | One effect and receipt transaction |
| Response lost / duplicate | Same proposal confirmed again/concurrently | Recover its original exact event and closed-wait receipt | No second answer or dispatch |
| Different answer wins | Another proposal/card closes question first | Refuse and show recorded outcome | Never claim the loser's option applied |
| Expired / revoked / removed | Deadline passed, role revoked, or either content body missing/corrupt | Refuse before mutation | Audited denial where applicable |
| Abort option | Explicitly selected and confirmed abort | Existing cancellation/sealed partial result behavior | Do not invent a new cancellation path |
| Transaction failure | Event, receipt or notification write fails | All wait/state/queue changes roll back | Retry same proposal safely |

</frozen-after-approval>

## Code Map

- `packages/application/src/runs/run-conversation.ts`: strict question-anchor/request/command DTOs; bounded option resolver and clarification. Existing interpreter recognizes only `answer:`; support unique whole-message option labels/IDs when a question anchor exists, and explicit safe aliases only for their declared option kind. Exact Run safety phrases retain precedence; never use substring matching.
- `apps/web/src/runs/escalation-read.ts`, `apps/web/app/runs/[id]/workspace/page.tsx`: derive a safe question context from the same locked wait/revision read. Include full option semantics in the canonical digest, not merely display labels. Shared canonicalization belongs below the web layer.
- `apps/web/src/runs/RunConversation.tsx`: capture question anchor beside `draftInspection` on the first nonempty draft; display its subject/question and stale status. A refresh must neither erase an uncertain request identity nor replace its question. Clear only on accepted message or explicit new draft. Bind selected source context independently of current worker position.
- `packages/infrastructure/src/runs/run-conversation-repository.ts`: add immutable answer proposal, exact retained command confirmation, joined content locks, typed refusal and reauthorized receipt recovery. Invoke `answerEscalation` using `PostgresWaitRepository(tx)` and the outer transaction's audit writer/time; no reparsing client text on confirm.
- `packages/application/src/runs/waits.ts`: add trusted optional command metadata to `AnswerEscalationDependencies`, never to the untrusted answer request. Domain event must bind command, exact question/options and revision when called conversationally; preserve existing direct-card behavior and abort path.
- `packages/infrastructure/src/runs/run-interaction-projection.ts`, `packages/domain/src/audit-event.ts`, schema and next migration: receipt derives from exact successful `execution.escalation-answered` plus closed wait actor/option/time and immutable proposal metadata. SQL rejects null/malformed/foreign bindings; no effectful state without authoritative event. Preserve older command guards.
- `apps/web/src/runs/run-conversation-actions.ts`, `RunWorkspaceConversation.tsx`: authenticated exact `{runId,commandId}` confirmation and readable modal. The chosen option is never replaced by browser-supplied text. Recheck LiveGate/desktop and server authority, refresh durable card/receipts.

## Tasks & Acceptance

- [x] Implement strict question anchor, unique finite option resolution and frozen draft context.
- [x] Persist governed proposals and exact atomic answer confirmation with lost-response receipts.
- [x] Add schema/event guards, migration/snapshot and compatible runtime schema declaration.
- [x] Render proposal review, current decision, typed refusal and applied receipt consistently.
- [x] Prove all matrix rows with focused unit/PostgreSQL tests, including direct SQL guard negatives and concurrent distinct choices.
- [x] Prove authenticated browser draft W1/W2, lost response, role revocation and actual compiled worker consumption of a selected choice.
- [x] Record actual results and reusable decisions in P3 checkpoint, continuation report and `CLAUDE.md`.

**Acceptance:** Given a current question, when an authorized auditor confirms its uniquely resolved choice, then the exact existing wait is answered once and the worker consumes that recorded option. Given changed question context or uncertain delivery, when the same draft/proposal is submitted or retried, then it can never answer a different question or repeat its effect.

## Design Notes

This is one slice of the full continuation; manager flags, broader explanation, frozen strategies, preview/auth and final acceptance remain required. Reuse established Stop/Resume identity patterns without copying weak receipt checks. No provider/API changes are required. Parent coordinates database/browser runs so worker recovery cannot consume unrelated test fixtures. A code-map path is a starting point; follow the current repository if a sibling implementation moved.

### Implementation decisions — 20 September 2026

The canonical question envelope must bind Run and wait identity, wait kind, Run revision,
deadline, the ordered complete option objects, and the exact raised-event identity with
its step, evidence and work-item references. Include the question/rationale source identity
and a digest of the exact question presented; do not bind an unrelated latest model turn.
Candidate option IDs are snapshot-relative, so preserve the raised step/evidence binding
and validate it against the existing snapshot-bound decision mechanism. Missing or
inconsistent source context makes conversational answering unavailable; the existing
decision card retains its own established rules. Keep text in governed content, with
only safe identities and digests in events.

Initially accept only a uniquely matching whole-message option ID or label (with the
existing explicit `answer:` prefix optionally removed, whitespace trimmed and case folded).
Do not invent synonyms or strip negation/conditions. Ambiguity produces a clarification;
the broader interpreter slice can propose additional choices under the same confirmation
contract. Exact Run safety phrases keep their established precedence.

Inject or decorate the nested wait context's actual audit writer: `answerEscalation`
writes through `context.auditEvents`, so an outer unit-of-work dependency alone does not
share its event clock. Bind the authoritative answer event and closed wait atomically.
Keep answer proposals lease-independent in every client opener, rendered affordance,
confirmation guard and invalidation effect. Preserve the exact pending intake request
across current-wait and selected-record changes; those changes may not retarget it.

Abort remains the existing answer-handler cancellation path. Conversation metadata belongs
on `execution.escalation-answered`; an answer command must not masquerade as a Stop command
in cancellation-marker guards. Do not pass chat text as the handler's human note. Retain
the existing worker recovery scheduling rather than creating a second wake job. Verify
actual P1 candidate consumption with the compiled-worker harness and valid pending-wait
snapshot fixtures; the P4 deferred-pause fixture cannot provide this evidence.

## Verification

Pinned Node/pnpm; typecheck, dependency boundaries, targeted and full units; fresh disposable PostgreSQL 18 migrations and drift check; focused conversation/wait/rollback integration; zero-retry authenticated browser and real-worker journey. Only pushed-candidate CI results may be called remote verification.

Implementation handoff: use Node 24.20.0 at
`/home/codespace/nvm/versions/node/v24.20.0/bin` and pnpm 11.25.0. Parent coordinates
PostgreSQL databases, worker/browser processes and all heavyweight verification. Run
focused unit checks and report the exact integration/browser commands for parent execution;
do not run overlapping database suites or change the parent's verification environment.
Use the next migration after the completed renewal slice, including its generated journal,
snapshot and compatibility contract. Preserve other pending spec drafts. Do not commit or
push from the implementation handoff; parent owns final review, checks and authorized push.

## Final verification — 20 September 2026

- All 703 existing and answer-related PostgreSQL cases passed in the complete suite.
  The separate, uncommitted Replay fixture had one tie-order expectation failure; its
  three tests are excluded from this slice's count. The 87 conversation cases are included.
- Full units passed 4,785 cases and exposed one undefined class in the separate Replay
  slice. After correction, all 57 affected UI/stylesheet cases passed. The original full
  invocation was not green; all its cases have passing evidence across these runs.
- Build, complete package/root TypeScript, dependency boundaries and schema drift passed.
  Boundaries reported only the unintegrated, uncommitted preview coordinator as an orphan.
- Five authenticated answer protocol journeys and all four workspace journeys passed,
  with zero retries. The workspace rerun waits for the existing hydrated history control
  before manipulating scroll; geometry and accessibility assertions remain unchanged.
  Maximum source lengths (2,000-character question, 512-character subject, 500-character
  choice) pass at both supported desktop sizes, including expanded source disclosure.
- The actual compiled-worker candidate journey passed separately with zero retries. It
  verifies the exact answer event, wait and receipt, and only the selected candidate's
  resulting Observation. One synthetic Northstar search response supplies ambiguity.

Three independent reviews and parent reconciliation are complete. Review corrections cover
source provenance, governed-content availability, exact retries, legacy fingerprints,
stale confirmation withdrawal, bounded source presentation and storage transition guards.
No real provider, real-data policy, complete P3 or overall proof-gate closure is claimed.
This slice still needs its pushed candidate's own CI; nothing was merged or deployed.

## Suggested Review Order

- Confirm the retained proposal through the existing domain handler and recover its exact outcome.
  [run-conversation-repository.ts:633](../../packages/infrastructure/src/runs/run-conversation-repository.ts#L633)

- Bind the question to its raised event, complete options and captured source.
  [run-conversation-question.ts:8](../../packages/infrastructure/src/runs/run-conversation-question.ts#L8)

- Accept one complete option; never infer aliases, conditions or negated consent.
  [run-conversation.ts:200](../../packages/application/src/runs/run-conversation.ts#L200)

- Reject forged answer effects and preserve immutable event, wait and receipt ownership.
  [0059_confirmed_conversation_answer.sql:65](../../packages/infrastructure/drizzle/0059_confirmed_conversation_answer.sql#L65)

- Keep draft identity and unknown requests stable across question refreshes.
  [RunConversation.tsx:319](../../apps/web/src/runs/RunConversation.tsx#L319)

- Review current retained source and withdraw stale confirmations.
  [RunWorkspaceConversation.tsx:40](../../apps/web/src/runs/RunWorkspaceConversation.tsx#L40)

- Preserve reachable answers, source text and transcript space on supported desktops.
  [RunWorkspaceShell.css:203](../../apps/web/src/runs/RunWorkspaceShell.css#L203)

- Prove actual worker consumption of the selected captured candidate.
  [conversation-answer-worker.spec.ts:319](../../tests/e2e/conversation-answer-worker.spec.ts#L319)

- Verify browser retry, competing answers and revoked authority.
  [conversation-answer.spec.ts:60](../../tests/e2e/conversation-answer.spec.ts#L60)

- Exercise transactional rollback, expired questions and direct storage forgeries.
  [run-conversation.test.ts:1](../../tests/integration/run-conversation.test.ts#L1)
