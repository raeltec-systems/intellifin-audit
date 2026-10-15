---
title: '20.4 — Keep one engagement conversation with attributed task cards'
type: feature
created: '2026-09-30'
status: done
story_key: 20-4-keep-one-engagement-conversation-with-attributed-task-cards
review_loop_iteration: 0
baseline_commit: 1c598ca55511c6e27d6cc3a2e2b836912c2a9adf
authorization: 'Owner authorised Stories 20.1–20.4, specifications and routine engineering choices without intermediate approval.'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-20-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-Zobba-2026-09-25/DESIGN.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-Zobba-2026-09-25/EXPERIENCE.md'
---

<frozen-after-approval reason="owner-authorised canonical Story20.4 and batch demonstration">

## Intent

**Problem:** Scoped sign-in and durable Tasks exist, but people cannot coordinate their work in the browser.

**Approach:** Deliver one engagement conversation with explicitly targeted messages, attributable Task cards, retained guidance and truthful controls using the verified Task authority.

## Boundaries & Constraints

**Always:** Follow canonical20.4 and active Pair experience. Preserve current membership, atomic command/message binding, original receipts, independent controls and bounded resources. Distinguish unsent, received, applied and factually ceased work.

**Ask First:** Paid resources, customer credentials/data, deployment or destructive historical changes. Local synthetic fixtures and ordinary engineering choices are authorised.

**Never:** Fake agent answers, inferred routing, real computer, audit completion, browser tokens, legacy domain dependency or replay after possible dispatch. Preserve accepted migrations/catalogs1–3; add a version only if required.

## I/O & Edge-Case Matrix

| Scenario | Input / state | Expected behaviour | Error handling |
|---|---|---|---|
| Attribution | CreateA/CreateB/GuideA while inspectingB | Durable author/audience/scope/command/Task binding; two cards; composer target unchanged | No ambiguous or inferred target |
| Lost acknowledgement | Accepted request, lost response, reload and retry | Original key/meaning/receipt; one message/card and ordered history | Changed meaning409; uncertain remains retryable |
| Guidance | Received then Applied; API/worker/tab interruption | Plain working brief and history survive; original objective remains distinct | Never imply model understanding or restart |
| Controls | PauseA/StopB during execution | Pending until factual cessation; Resume same cycle, Continue new cycle | Unknown stays unknown; stale targets refuse |
| Delivery | Concurrent snapshots/events, burst, outage or slow viewer | Ordered string cursors, bounded replay, explicit reconnect/resync | Never skip omitted rows or invent progress |
| Inspection | Events/resize while drafting or inspecting | Composer, pin/selection and focus stay usable | Opening another Task never retargets sends |
| Authority | Revalidation, logout, revocation or actor/scope switch | Current audience every read; obsolete callbacks ignored | Withdraw protected content; never replay another actor/scope's outbox |
| Accessibility | Keyboard and320/390px viewports | Visible scope/target, reachable controls, Enter/ShiftEnter, Escape/focus return | No page overflow, focus theft or colour-only states |

</frozen-after-approval>

## Code Map

- `zobba/crates/domain/src/task.rs:189`, `application/src/task.rs:41`, `infrastructure/src/task.rs:139,270,308`: authoritative Task/command/event contracts and atomic admission; reuse their data, not a second acceptance engine. Current events lack message content/author and need a durable read projection.
- `zobba/crates/api/src/tasks.rs:36,235,287,350,540`: independent control admission and bounded owned contracts; conversation reads belong on ordinary capacity. Derive author from session and current engagement audience.
- `zobba/web/src/App.tsx:46,103,130,207`: access refresh currently unmounts selected content; preserve draft/inspection/focus without weakening fail-closed reads or persistent logout intent. `auth.ts`, `engagements.ts` own validated session/scope requests.
- `zobba/web/src/styles.css`, `public/assets/`, `design/zobba-tokens.json`: reuse Pair assets/Hanken Grotesk. Active reference screens24,33 and32a–d are in `planning-artifacts/ux-designs/zobba-design-system-v1.0/reference-screens/` under `_bmad-output/`; inspect actual images. Their HTML prototype is simulated reference only.
- `zobba/web/tests/browser/{auth-runtime,auth.spec,runtime}.ts`, `crates/api/tests/tasks_http.rs`, worker process tests: owned HTTPS OIDC/PostgreSQL/process fixtures. Extend actual worker lifecycle; serialize destructive suites by database. Read accepted20.3 spec/report for exact lifecycle and limits.

## Tasks & Acceptance

**Execution:**
- [x] `zobba/crates/{domain,application,infrastructure}/src/` — durable scoped conversation/message/Task read models with bounded consistent snapshot, history and cursor recovery; preserve exact schema/grant checks.
- [x] `zobba/crates/api/src/`, `openapi.json`, `web/src/generated/api.ts` — authenticated audience-checked projection endpoints and owned generated contracts; retain command/control authority.
- [x] `zobba/web/src/{App.tsx,conversation.ts,conversation-state.ts}` — validated projection client, identity/scope-bound recoverable outbox, independent editable draft, explicit targeting and race-safe access lifecycle; unit-test matrix edges.
- [x] `zobba/web/src/{ConversationWorkspace.tsx,styles.css}` — active Pair conversation/cards/inspection, factual controls, narrow view switching, accessible focus and honest empty work-product shelf.
- [x] `zobba/crates/*/tests/`, `web/tests/`, `scripts/`, READMEs and `CLAUDE.md` — actual PostgreSQL/HTTP/browser interruption/retry/scope proofs, all retained gates, recorded demonstration and reusable decisions.

**Acceptance Criteria:**
- Given two accepted Tasks, when users return after interruption, then one conversation retains correctly attributed messages, receipts, guidance and cards.
- Given a slow or disconnected viewer, when control is submitted, then it remains independently admissible and its cessation display follows facts.
- Given this foundation build, when users inspect work, then they see no claim of model, audit or computer execution.

## Spec Change Log

## Design Notes

Use the engagement tuple as conversation identity. Audience is currently assigned engagement members; there is no private-message or audience-expansion mode. Project accepted command rows and their immutable Received/Applied facts, or an equally atomic durable representation. Never accept a browser message separately. Return author identity/label, exact target/cycle/scope, objective, accountable human and factual state without exposing capability secrets. Retain history after role changes while checking current reader access.

Define a race-proof consistent snapshot/watermark and bounded ordered history/feed contract. Finite cursor polling is acceptable; no database connection waits for viewers. Bound pages, client buffers and catch-up work; handle gaps/overflow with explicit resynchronisation. Cursors remain decimal strings, never floating-point numbers. Complete history remains pageable; current state is not reconstructed by pretending the latest page is the whole conversation.

Persist exact pending key, meaning, actor and composite scope before sending; storage failure must not silently transmit an unrecoverable request. Separate next editable draft from bounded uncertain outbox items. Retrying uses original target/cycle/content; material edits require a new explicit request. Reconcile optimistic echoes with durable command identity. Fresh access precedes retry; never expose/replay old content under another actor/scope. Withdrawal must clear protected rendered/server projections; successful same-scope revalidation retains local draft, selection and focus.

Composer explicitly selects New Task or Guide named Task/cycle, independently of inspection/pinning/Follow Zobba. Incoming events never steal focus or silently change pending meaning. Received is not Applied; Applied means added to the plain working brief. Inert completion means Waiting, not objective completion. Render Pausing/Stopping until confirmed; reconciliation-required activity remains unresolved. Guide alone never resumes. Controls always name their exact Task/cycle.

Match Pair hierarchy: Linen navigation, Canvas conversation, Paper cards/composer/workspace, Graphite primary Send and Iris focus/links. Cards name objective, human owner, scope, state and Open. Keep readable conversation and inspection panes; collapse navigation then switch views before squeezing. Narrow Conversation/Workspace tabs preserve the composer target, >=44px controls and scope. Escape closes inspection and returns focus. Support reduced motion, forced colours and400% zoom. Show a concise foundation-limit notice and honestly empty work-product shelf; unavailable capabilities must not masquerade as working buttons.

Use `. /workspace/zobba-build-tools/activate.sh`. Dev API4310/Vite5173/IdP9443 are owned synthetic services; preserve exact fixture authority. Tests use dedicated guarded databases; independent reviewer has a separate fixture. No paid environment. Implement only20.4, without commit/push or spec/status acceptance; root owns final judgment.

## Verification

- Actual restricted PostgreSQL and HTTP: atomic attribution, two-client isolation, snapshot/event races, complete bounded pagination, burst/gap/resync, changed meaning, revocation and independently responsive controls. Preserve old migration bytes and upgrade/refusal tests.
- Actual OIDC browser: two Tasks, GuideA while inspectingB, lost committed ACK plus reload/same-key recovery,409 on changed meaning, retained accepted/applied guidance after actual API/worker interruption, pending/confirmed Pause/Stop, explicit Resume/Continue and honest consumed-crash uncertainty. No mocked success as final demonstration.
- Retain all23 prior browser scenarios, adapting selectors to the new truthful UI; preserve their authority/focus assertions. Add keyboard320/390px, pin/follow, refresh/logout/old-scope callback races, unavailable/storage-failure and bounded delivery tests. Capture and visually inspect running1280/390/320px screens; record a reproducible demonstration and limits.
- Run fmt, locked workspace Clippy/test/build with actual PostgreSQL/IdP, frozen pnpm, check/build, fixture tests, Python guards/boundaries/smoke and retained/new browsers. Record independent acceptance before done/push.

## Suggested Review Order

**Coordinating experience**

- Keep explicit message targeting independent of inspection and factual Task controls.
  [ConversationWorkspace.tsx:49](../../zobba/web/src/ConversationWorkspace.tsx#L49)

**Durable recovery**

- Resolve admission only after a strict durable transaction completes.
  [conversation-outbox.ts:105](../../zobba/web/src/conversation-outbox.ts#L105)

- Check immutable meaning and reserved capacity atomically across browser tabs.
  [conversation-outbox.ts:172](../../zobba/web/src/conversation-outbox.ts#L172)

- Treat persistence as the handoff across access revalidation without losing the next draft.
  [conversation-state.ts:276](../../zobba/web/src/conversation-state.ts#L276)

- Preserve exact retries and known receipts while fencing asynchronous authority changes.
  [conversation-state.ts:340](../../zobba/web/src/conversation-state.ts#L340)

**Authoritative reads and access**

- Read scoped messages, current Tasks, activity and watermark from one consistent database snapshot.
  [infrastructure/conversation.rs:172](../../zobba/crates/infrastructure/src/conversation.rs#L172)

- Expose bounded authenticated projections through ordinary read capacity.
  [api/conversation.rs:252](../../zobba/crates/api/src/conversation.rs#L252)

- Hide protected content during access checks while preserving mounted state for verified recovery.
  [App.tsx:68](../../zobba/web/src/App.tsx#L68)

- Recheck session authority and expected actor before command admission or idempotent receipt lookup.
  [tasks.rs:387](../../zobba/crates/api/src/tasks.rs#L387)

**Verification**

- Exercise real sign-in, two Tasks, retained guidance and API/worker interruption.
  [conversation.spec.ts:59](../../zobba/web/tests/browser/conversation.spec.ts#L59)

- Prove received controls separately from observed cessation and explicit cycle transitions.
  [conversation.spec.ts:128](../../zobba/web/tests/browser/conversation.spec.ts#L128)

- Hold an actual write transaction to verify quota, control capacity and before-send durability.
  [conversation-locks.spec.ts:180](../../zobba/web/tests/browser/conversation-locks.spec.ts#L180)

- Verify scoped database consistency, bounded history, races and cursor recovery against PostgreSQL.
  [tests/conversation.rs:47](../../zobba/crates/infrastructure/tests/conversation.rs#L47)
