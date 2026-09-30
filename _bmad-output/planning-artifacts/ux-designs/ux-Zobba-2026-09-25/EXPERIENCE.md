---
name: Zobba
status: final
revision: 3
created: 2026-09-25
updated: 2026-09-30
sources:
  - ../../zobba-product-architecture-2026-09-30/Zobba-Product-and-Architecture-Design.md
  - ../../prds/prd-IntelliFin Audit-2026-08-31/prd.md
  - ./DESIGN.md
  - ../zobba-design-system-v1.0/reference-screens/README.md
---

# Zobba · Experience

**Active contract for the new build.** The accepted revision 3 design governs; [DESIGN.md](DESIGN.md) supplies Pair tokens. Previous procedure-first and September 25 interaction contracts are [historical](archive/revision-2/EXPERIENCE.md). They do not impose compiler-1, narrow command phrases, a synthetic read-only viewer or blanket approval steps on the new product. Existing runtime tests using old documents remain legacy implementation obligations until their behavior is adapted.

## Foundation

Responsive web, with a **continuing engagement conversation coordinating several Tasks**. A Task owns its objective, history, decisions, work products, computer use and delegated work. The computer is a resource, not the task's memory. Auditor, Audit manager and Admin remain the three roles. Admin configuration authority does not confer audit sign-off. Team review is independent where required; eligible solo use is labelled **Self-reviewed**.

The first complete experience uses applicable methodology, installed skills and authorised working knowledge before substantive evaluation. Conversation, real computer work, isolated analysis, evidence, review and recovery belong in that experience. The clean Rust backend, fresh schema and standing Permissions are settled design input, not questions raised by this spine.

## Information Architecture

| Surface | Entry and purpose | Reference coverage |
|---|---|---|
| Home / Engagements | Locate authorised work; selecting an engagement establishes client context. A first objective can establish the engagement conversationally. | Spine-only; engagement mocked in RS24 |
| Engagement conversation | Delegate several objectives, change priorities, answer attributed questions and return after absence. | RS24, RS33 |
| Task history | Open a work card; inspect Working brief, activity, decisions, guidance and exact outputs; return to coordinating conversation. | RS25, RS30 |
| Companion panel / Needs you | Active work, persistent input requests, Computers, stable Work products shelf, Permissions. | RS24–25 |
| Workspace | Computer, Data, Documents, Evidence and Changes beside the conversation; narrow screens switch views. | RS26–32, RS34; Data/Changes spine-only |
| Permissions / Connections | Inspect actual account, source, purpose and effect bounds; set or revoke permitted standing rules. | Spine-only; prototype explanatory overlay |
| Scheduled work / Check | Inspect reviewed method, sources, criteria, owner, delegation, schedule, occurrences and incomplete/missed work. | Spine-only; prototype explanatory overlay |
| Reviews / work-product review | Review an exact version with citations, limitations and anchored notes; issue separately. | Spine-only; paper visible in RS26 |
| Search | Find only authorised work, with client and period labels; partial index is explicit. | Spine-only |
| Settings → Methodology and skills | Admin edits, validates and Saves versioned methodology, templates and skills; shows dependent work affected. | Spine-only |
| Settings → People, models, budgets | Membership/roles, permitted processing, model defaults and spending limits. | Spine-only |

The [reference index](../zobba-design-system-v1.0/reference-screens/README.md) identifies mocked states and runnable interactions. Spine-only means designed here, not deferred from the first complete product where needed. A prototype simulation is not proof of backend behavior.

## Voice and Tone

First-person assistant prose; “Zobba is…” in status chrome. State what happened, what is supported, what needs someone and what continues. Ask only when the answer changes the work. A question names conflicting sources, consequence and a recommended choice when supported. Keep normal details in readable language; expose technical provenance on request.

| Use | Avoid |
|---|---|
| “Received · leaver task”, then “Applied · contractual termination date” | Read/seen pretending that guidance was applied |
| “Details submitted. Verifying the account.” | “Signed in” based only on form submission |
| “Pausing leaver task and its helpers. Shared-account work continues.” | “Paused” before quiescence or a global “Pause” with hidden scope |
| “Computer reconnecting. No current frame.” | A stale image labelled live |
| “Three exceptions are supported; LoanCore coverage is incomplete.” | Completed meaning passed, complete coverage or approved |
| “Self-reviewed by Daniel” | AI checked or self-reviewed presented as independent review |

## Component Patterns

| Component | Behavior |
|---|---|
| Navigation and header | Engagement is always visible; Task/account scope accompanies affected controls. Changing client never carries source material implicitly. |
| Conversation and composer | Remain available during model/computer work. Persist accepted input and bind its intended Task/question. General discussion does not cancel assigned work. Ambiguous consequential direction asks which Task before applying. |
| Task card | Shows objective, owner, current work/need, and Open. A card links the same Task everywhere; no duplicate work from opening it. |
| Companion panel | Requests remain reachable after scrolling. Since your last visit distinguishes material changes, ready outputs, unresolved questions and limitations. Work-product links open stable versioned objects. |
| Question and receipt | Bind short/free-text answers to a specific current question; record decision author and effect on work. Required methodology is not changed by an auditor's chat reply. Guidance Received precedes Applied. |
| Workspace panel | Opening is inspection. Selection, pinning or editing suspends following until **Follow Zobba**. New work arrives as an Open card; a timer never replaces inspected work. Close returns to conversation without stopping. |
| Work product and evidence | Show title/version/originating Task, coverage, limitations and truthful review state. Claim → citation → preview/full evidence → Back to claim preserves focus. Explicit draft edits create a version without a second approval ceremony. Reviewed/issued versions remain fixed. |
| Computer and control strip | Show actual browser/desktop, application account, environment, freshness and named controller. Watch is separate from Take over. Pause/Stop apply to the named Task and helpers; computer takeover affects that computer and dependent work. |
| Private sign-in | Inline request opens protected application session, names verified destination, role and purpose. No passwords/MFA in chat. Submitted → Verifying → Account verified are separate facts. Not now retains the request and states what continues. Account mismatch stays unavailable. |
| Permissions decision | Routine work covered by standing Permissions proceeds. An uncovered action names account, environment, purpose, destination, recipients/material and effect. Allow this action binds those details. Set a standing rule is bounded, inspectable and revocable; it cannot exceed Admin limits. |
| Changes and review | Material changes to a conclusion are visible. Team and solo labels stay distinct; Admin alone cannot review/issue. A review challenge opens support and version changes. Issuance is a separate authorised human action. |
| Methodology, skills and Check editor | Admin uses ordinary validated Save; no second-approver ceremony. Version bindings and material effects on current work are visible. Check promotion captures criterion meaning, coverage, evidence obligations, ownership and schedule; the applicable review rule governs material method revisions. |
| Search and connections | Distinguish account consent, reachable sources and effective Permissions. Expired/partial sources never produce a successful empty result. Account rebind is explicit and verified. |

## State Patterns

Task activity, human attention, computer connectivity, external effect, evaluation and review are separate dimensions. One Task can work while a branch needs input. A work cycle can finish with limitations.

| State / surface | Visible contract and next action |
|---|---|
| New engagement / empty task list | Start with an objective. No mandatory procedure wizard or method/skill picker. Resolve client scope before acquiring/disclosing client material. |
| Cold load / failed load | Named loading state, then real content or error. Unknown counts stay unknown; failed Needs you read is never “Nothing needs you”. |
| Working / Needs input | Named activity or specific question, responsible person, blocked work and independent work that continues. |
| Needs sign-in | Destination, account/role and purpose; open private session or defer. Other viewers see no private frames. |
| Details submitted / Verifying / Account verified | Submission receipt is not authentication success. Automation waits for the intended account/application check. Wrong role, failed MFA or uncertain environment names the remaining need. |
| Transferring control / Human controlling | Human input remains unavailable until agent input is fenced. Once transferred, show the person's name. Another viewer requests control rather than competing. |
| Handback / Reconnecting | Re-observe and verify account/application and pending effects before using the computer. Human disconnect leaves it paused, never silently handed back. No live claim for a missing/stale frame. |
| Pausing / Paused | Accepted pause then confirmed quiescence or explicit unresolved condition. Task and its helpers pause; other Tasks continue. Resume is explicit. |
| Stopping / Stopped | Stop admission and delegated work; retain evidence/drafts. Reconcile already dispatched effects. Unknown external outcome remains unknown after Stop. A new cycle is needed to resume the objective. |
| Scheduled work | Stopping an occurrence leaves future Check runs enabled unless separately disabled. Display next occurrence/owner and whether deadline or access was missed. |
| Budget or readiness wait | Tell what is waiting, retained and still available. Preparing computer is not a live session; useful independent work can proceed. Stop and earned outputs remain accessible. |
| Partial acquisition / unsupported content | State missing coverage or unreadable part and its consequence. No silent omission; conclusions limited accordingly. |
| External effect uncertain | “The request was attempted; its outcome is unconfirmed.” Provide reconciliation, not blind retry. Provider acceptance and completed effect are distinct. |
| Draft / Ready for team review | Name exact version and unresolved matters. Completed work does not approve a conclusion. |
| Independently reviewed / Self-reviewed / Issued | Name accountable person and version; solo label never implies independence. Issued history preserved; material change creates successor review. |
| Empty search / connections / Checks | Explain what would appear and a relevant next step; incomplete source/index is explicit. |
| Settings invalid / save failed | Keep edits and show validation cause. Do not claim saved or effective until durable Save succeeds. |
| Permission revoked / offline | Explain what cannot proceed. Keep a typed draft when safe; show Not sent until received durably. A local input echo confers no execution authority. |

## Interaction Primitives

- **UX-DR42 — Coordinating conversation.** One engagement conversation may coordinate many Tasks. Every work card, question, command and resulting output has exact Task/client attribution. Discussion and new guidance do not implicitly cancel work.
- **UX-DR43 — Persistent attention and return.** Needs you and the work-product shelf remain reachable. A return digest describes changes since last visit without inventing progress or hiding limitations.
- **UX-DR44 — Inspection ownership.** Selecting, pinning or editing preserves the current object until explicit Follow Zobba. Keep From Task, Pin, Expand and Close; no 30-second replacement timer.
- **UX-DR45 — Private access and exact receipts.** Protected input excludes model/other viewers/capture/extraction. Distinguish details submitted, access verification and verified account; no automatic handback on human disconnect.
- **UX-DR46 — Scoped control.** Watch, Guide, Pause, Stop, Take over and Hand back are distinct. Controls and receipts name Task/helpers or computer. Pending transfer/cessation remains pending; occurrence Stop does not disable its Check.
- **UX-DR47 — Method, skills and knowledge.** Apply relevant configured method/skill versions and scoped knowledge in the first task. Record explicit direction once. Admin configuration uses ordinary Save; consequential conflicts get focused questions.
- **UX-DR48 — Honest review and recurrence.** Exact-version team review and permitted solo self-review remain distinct. Recurrence preserves audit meaning and evidence/coverage obligations; computer navigation may adapt within them.
- **UX-DR49 — Accessible continuing work.** Composer and controls stay reachable during work; narrow views preserve scope. Live/stale, unreadable/empty and accepted/applied remain distinguishable without color or private reasoning.

UX-DR1–41 retain their historical identities in their original records. These new rules replace conflicting new-build behaviors; no identifier is reused. Controls use native buttons and links. Enter submits conversation, Shift+Enter adds a line, Escape closes an overlay and returns focus. No hidden double-Escape Stop shortcut.

## Accessibility Floor

WCAG 2.2 AA is the implementation floor. Controls have visible labels, focus and at least 44px targets on narrow screens. Dialogs trap focus and return it to the originating request. Status changes announce concise transitions, not every streamed token. Independent scroll regions have names; evidence returns focus to its claim. Follow state and computer control state are available to assistive technology. Honor reduced motion, forced colors and 400% zoom. A live desktop cannot promise accessibility for an inaccessible target application; provide native document/data/evidence alternatives and clearly name unsupported interactions.

Use {colors.accent} for focus, {colors.border-input} for control boundaries and {typography.body} for conversation. These references resolve in DESIGN.md. Prototype rendering and keyboard checks do not substitute for application-wide accessibility tests.

## Responsive & Platform

At usable desktop widths, conversation and workspace remain side by side. Collapse navigation first; switch to separate Conversation/Workspace/Needs you views before either pane becomes unusable. Mobile keeps engagement and selected Task visible with a reachable Pause/Stop. Computer control uses a full-screen view with explicit keyboard/pointer/zoom controls in implementation; warn when the target needs a larger screen. The prototype's small desktop sample is a viewing fixture and does not claim comfortable phone editing or implement real remote input.

## Inspiration & Anti-patterns

Dots informs the feeling of a continuing assistant who can work while the person keeps talking, inspect a computer and ask concise contextual questions. The supplied screenshots do not reveal its internals or prove performance. Pair supplies Zobba's identity. Audit methodology, coverage, supported evaluation and accountable team/solo review supply its specialist substance. Do not copy an unbounded Always allow, a vague Thinking overlay, a global assistant memory across clients, or a message receipt that implies application of guidance.

## Key Flows

### 1. Daniel delegates several objectives — RS24, RS33

1. Daniel opens Northstar's engagement conversation and asks for the leaver review, then adds shared-account investigation.
2. Zobba binds applicable methodology, skills and working knowledge and creates/relates attributed Task cards.
3. Daniel asks a general question while work runs; the composer remains available.
4. **Climax:** both work cards report their own progress or need without a new chat for each objective.

Failure: an instruction's target or client is ambiguous; ask that focused question before dependent acquisition/action, while authorised independent work continues.

### 2. Daniel resolves access and a material criterion — RS25, RS27–30

1. Needs you names the sign-in need and policy conflict, with blocked work and the separate task that continues.
2. Daniel privately signs in to the verified destination as the intended read-only auditor.
3. The receipt moves from Submitted to Verifying; automation waits until the account and environment are verified.
4. Daniel answers the specific date question; the applicable task criterion is recorded with attribution, without editing required firm methodology.
5. **Climax:** the correct account and criterion are visible before dependent evaluations proceed.

Failure: wrong account, failed MFA or stale decision leaves a named unresolved request. No password is accepted in conversation, and no guessed answer is supplied.

### 3. Daniel inspects while other work continues — RS26, RS34

1. Daniel opens working paper v2 from the shelf and selects a conclusion.
2. Evidence opens at the cited location; Back to claim restores focus.
3. A separate task produces a new inventory; an Open card appears without replacing the selected paper.
4. **Climax:** Daniel finishes inspection, then explicitly chooses Follow Zobba or another work product.

Failure: evidence is unavailable or coverage incomplete; retain the paper and show the missing basis, not a fabricated preview.

### 4. Daniel takes control and stops only the intended work — RS31–32

1. Daniel watches the actual computer, then chooses Take over.
2. Transfer stays pending until agent input is fenced; Daniel is then named as controller.
3. Hand back rechecks the account, application and pending effects. A lost connection shows Reconnecting and disables input.
4. Daniel pauses or stops the leaver Task and its helpers; the shared-account Task keeps working. A recurring Check stays enabled unless separately disabled.
5. **Climax:** the receipt names what stopped, what was retained and any unresolved effect.

Failure: control or cessation cannot be confirmed; show pending/unresolved, never early success or automatic human-to-agent handback.

### 5. Thandi reviews; Daniel uses solo mode honestly — paper RS26, review spine-only

1. Daniel prepares the exact cited paper version and submits it to assigned eligible manager Thandi.
2. Thandi inspects coverage, limitations and evidence, leaves anchored notes and records the applicable review/approval.
3. Issuance names the exact version and recipients as a separate authorised action.
4. In a permitted solo engagement, Daniel instead performs accountable self-review under its saved method.
5. **Climax:** the shelf/export says Independently reviewed or Self-reviewed truthfully; prior issued versions remain fixed.

Failure: contribution/role/version conflict blocks the required independent review and names the reason. Admin authority alone supplies no sign-off.

### 6. Admin saves a method; Daniel returns to recurring work — spine-only

1. Admin edits sources, criteria, templates or skills and uses validated Save; no second approver is added for ordinary configuration.
2. Affected task bindings and potentially material rework are named; issued history is preserved.
3. Daniel promotes a useful Task into a reviewed Check with meaning, coverage, evidence, owner, delegation and schedule.
4. A later occurrence creates its own linked Task. Daniel returns to a digest with supported changes and outstanding needs.
5. **Climax:** fresh-period work has the same inspectable meaning and honest review labels, rather than blindly replaying clicks.

Failure: source drift, missing coverage, expired delegation or a missed deadline is explicit. A material method revision receives the applicable review; it does not invent an Admin configuration approval ceremony.
