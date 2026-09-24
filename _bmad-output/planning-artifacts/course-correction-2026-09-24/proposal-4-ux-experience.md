# Proposal 4 of 7 — UX and interaction design: EXPERIENCE.md revision 2 and the DESIGN.md delta

Status: draft for owner review on 2026-09-24; awaiting a / e / s. Builds on the approved PRD text (Proposals 1–2) and the approved architecture (3a–3d) and expresses them as an experience: an auditor directing capable, connected work through conversation, with artifacts, evidence and working activity available to inspect. It is not a conversation box in front of the Builder. Provenance collection, permission evaluation and execution bookkeeping stay in the harness; the auditor meets the information and decisions needed to direct and review the work.

Baseline: EXPERIENCE.md (final, 2026-09-01, plus the 2026-09-11 and 2026-09-22 owner sections); DESIGN.md (final, 2026-09-01); the web inventory in `analysis-web-ux.md`. The one existing "conversation" (Auditor Workspace v1.1) is a fixed-vocabulary command console over one Run with no model reply; its receipt-bound commands, encrypted content, server-side interpretation before action and audit-chained history are reused as plumbing, not as the destination.

Owner decisions this proposal asks for:

| Decision | Proposed choice |
|---|---|
| D-4-1 | **Shell and information architecture.** The primary surface is the **Engagement Workspace**: a conversation thread, an artifact panel beside it, and an activity rail. Top-level navigation becomes Engagements · Needs you · Settings (Connections, Methodology, Users, Systems). Runs, Procedures, Reviews and Notifications leave the sidebar; each is reached from inside an engagement or from Needs you. Legacy compiler-1 surfaces stay reachable from Settings → Legacy procedures until Proposal 7's disposition completes. |
| D-4-2 | **Confirmation weights follow gate outcomes.** `allowed` operations never prompt. `needs-confirmation` uses the existing *Routine* weight and always shows the bound material details (recipient, time, title, destination, resource). Approval, issue and promotion use *Routine with rationale* where the pack requires a rationale. *Finalization* stays for issue. A stale confirmation is refused with the change named and re-asked; there is no "confirm anyway". |
| D-4-3 | **Limitations, uncertainty and failure are shown as audit facts, never as infrastructure.** Every claim, output and scheduled result carries chips from closed vocabularies (support status, input quality, invocation outcome) with a one-line meaning; a connector error, a sandbox limit, an unknown-after-dispatch or a denied operation is a sentence about the work and a next step, and the technical detail sits under Technical details as today. |
| D-4-4 | **Reviews are organised around the artifact or decision, not the claim.** Claim-level records exist underneath every working paper and are opened from a citation; a person reviews a version, confirms a proposal, answers a question or approves a definition, and never fills a provenance field or approves an intermediate calculation. |

Each change states: what EXPERIENCE.md says now, what it says in revision 2, why, and which tests pin it.

---

## U1 — Foundation, mental model and the four things the interface never does

**Now:** "Procedure → Run → Agent Workspace → Evidence → Result → Auditor Review"; "Four things the interface never does: … let free text reach the agent …"; single tenant.

**Revision 2:**

> The primary mental model is **Engagement → Conversation and Agent Tasks → Sources, Evidence and Working Material → Artifacts → Decisions and Review → optionally an approved recurring check and its Runs** (PRD §1, rev 4). Conversation is how work is directed; artifacts are what is reviewed; evidence is what artifacts stand on. The agent's work is the core experience; the auditor is accountable for what is issued.
>
> Four things the interface never does: let a message, a document or a memory item grant authority; present an unsupported or pending claim as a finding; present an empty list, an empty folder or an incomplete search as a passed control or a proven absence; let a draft or an unapproved rendering be issued or sent.
>
> Multi-tenant from the first release: the shell names the tenant, the client and the engagement the person is working in, and never shows two clients on one screen.

**Why:** Proposal 1 §1; 3a C1; FR-3, FR-55, FR-67, FR-74. **Tests:** `copy.test.ts` (foundation sentences), the shell tests naming tenant and engagement.

## U2 — Information architecture (D-4-1)

**Now:** sidebar Overview · Procedures · Runs · Reviews · Notifications · Administration; Builder, Procedure Detail and Version review as top-level surfaces.

**Revision 2:**

| Surface | Reached from | What it is |
|---|---|---|
| **Engagements** | sidebar | The person's engagements, drafts first, then by recent activity; "Start an engagement" creates a draft with only a name. |
| **Engagement Workspace** | an engagement | Three regions: the **conversation thread** (centre), the **artifact panel** (right: the open artifact, evidence item, source snapshot, connection or memory proposal), the **activity rail** (left, collapsible: tasks and their steps, open questions, scheduled runs, recent artifacts). The thread is primary; the panel opens from a citation, a card or the rail and never replaces the thread. |
| **Needs you** | sidebar, bell | One list across engagements: questions waiting, confirmations waiting, reconciliations, review requests, approvals, memory proposals, scheduled results that need attention. Each row names the engagement, the item, the deadline where one exists and one action. Replaces Overview, Notifications and Reviews as navigation; the review queue's independence rules stay. |
| **Artifact** (full page) | the panel's "Open full" | Versions, claims with citations, dependencies, decisions, renderings; the same content as the panel with room. |
| **Run** (full page) | the rail, a scheduled result | The existing Run Detail semantics (execution, assessment, evidence checks, review) in a page reached from the engagement, plus Live View and Replay for browser sessions. Not a top-level list. |
| **Settings** | sidebar | Connections (mine), Methodology (packs, skills — owners only), Users, Systems and Sources (administrators), Legacy procedures (until retired). |

Breadcrumb: Engagement / Workspace; Engagement / Artifact name; Engagement / Run. The shell's one-landmark rule and `rendersOwnTrail` discipline carry over.

**Why:** Proposal 1 §1; 3a C2 (draft engagement); 3c C10 (Needs you is a query over open waits, proposals and decisions). **Tests:** `breadcrumb-rules.test.ts`, shell nav tests, `overview/*.test.ts` (retired with Overview), `review-words.test.ts` (re-derived for Needs you).

## U3 — Interaction primitives (the reversal)

**Now:** "Free text reaches the agent nowhere. Escalation notes and rationale fields are recorded only." "Rejected — chat-first agent UI."

**Revision 2:**

> **The conversation is the request channel.** What the auditor types is model input and never authority; the interface makes the distinction visible: a message is a message, a **decision** is a card with a button, a **confirmation** is a dialog with the bound details, an **answer** to a closed-option question is its option. Nothing the auditor types executes an operation; what executes is a tool call the harness validated, gated and recorded, shown as a **tool-call card** in the thread.
>
> **Every agent statement carries its kind**: message, plan proposal, tool call and result, question, candidate finding, decision request, memory proposal, security notice. Agent text is rendered as agent text (the existing untrusted-content rule extends to the model's prose), never as the platform's.
>
> **Closed-option decisions remain** where an exact bound decision is required (Escalation kinds on the Run path, confirmation of a bound external action, approval). They are not the only way to talk to the agent.
>
> **Streaming shows status, never a verdict**: a draft streams as "drafting"; a finding appears as a candidate with its claim chips only after the self-review step; nothing streams as verified.

The anti-pattern line becomes: *Rejected — a conversation that executes: typing never performs an operation, grants authority or closes a wait; the harness does those through gated, recorded steps the person can see.*

**Why:** FR-55, FR-57, FR-61; 3c C9. **Tests:** `copy.test.ts` (primitives and anti-pattern sentences), the RunConversation tests (re-derived for the engagement thread).

## U4 — Component patterns: what is added, what is kept

Kept as they are: Status badge, Conclusion triptych, Gate checklist, Grounding inspector, Provenance chain, Evaluation card and confirmation, Confirmation dialog weights (extended per D-4-2), Untrusted-content rendering, Empty state ("names what would appear and refuses to imply a passed control"), Identifier, Timestamp, Reference, Technical details, Banner, DataTable.

Added:

| Pattern | Where | Rule |
|---|---|---|
| Conversation thread | Workspace | Chronological; each entry typed and attributed (auditor, agent, platform); tool-call cards collapsed by default and expandable to arguments (sanitised), outcome and receipt; questions and decisions stay pinned at the bottom of the thread until answered. |
| Tool-call card | thread, activity rail | Names the operation in audit words ("Read the leavers export from Drive"), the effect class, the two-axis outcome and data quality as chips, the receipt reference; `denied` shows the closed reason; `unknown-after-dispatch` shows "not confirmed" and the reconcile decision when opened. |
| Artifact panel | Workspace | Header: type, version, review state badge, `needs-reconsideration` flag with reason; body: the content with **claim chips** inline (class and support status); footer: decisions and their revision binding. "Open full", "New version", "Request review", "Approve" (gated). |
| Claim chip | artifact content | Class (`factual`, `assumption`, `hypothesis`, `inference`, `limitation`, `unverified`, `instruction`, `decision`, `recommendation`, `plan`) and, for factual, support status (`supported`, `unsupported`, `contradicted`, `pending-review`, `not-machine-checkable`), each with a one-line meaning on focus; a factual chip opens its citations in the panel. |
| Citation | artifact, thread | Opens the cited evidence at its locator in the panel (Grounding inspector generalised to documents: page image with the region, cell, paragraph, message part); shows provenance class and the acquisition's date and connection. |
| Input-quality strip | artifact header, Run result, source snapshot | The independent dimensions as chips (availability, freshness, coverage, period relevance, provenance) with `unknown` shown as unknown; never a single roll-up word. |
| Decision card | thread, Needs you | A question (`clarify`), a confirmation (`confirm-action`, with the bound material details), a reconciliation (`reconcile`, options keep observing / mark done with reference / retry with the duplication warning / abandon), a closed-option Escalation; deadline shown as a countdown where one exists; a stale confirmation is refused with what changed. |
| Memory proposal card | thread, Needs you | Scope, source message or evidence, verification status, reason; Confirm / Reject / Edit scope; an explicit instruction shows "Recorded" with no card. |
| Connection card | Settings → Connections, Mandate summary | Provider, account identity, scopes granted, state (`active`, `disabled`, `revoked`, `refresh-unresolved`), designated resources; Disconnect (Routine weight) says what stops and what already-dispatched operations it does not undo. |
| Mandate summary | Workspace header, artifact panel for a task | What the agent may read, draft, write and do in this engagement, which operations will ask, and the budget; read-only for the auditor's own authority, editable within the administrator's ceiling through Settings. |
| Method and promotion view | artifact panel for a `promotable-method` artifact | The selected steps, acquisition rules, validations, criteria; the compiler's reviewable mapping; unresolved issues; the schedule; "Submit for approval". |
| Scheduled result card | activity rail, Needs you, Run page | Four statuses side by side — execution, input and coverage, assessment, review or issue — with the summary word beneath; supported exceptions listed even when the assessment is Inconclusive. |

**Why:** 3b C6–C7, 3c C9–C12, 3a C3–C4. **Tests:** `stylesheet.test.ts` scans components for `ls-` classes, so every new class needs a rule; `status.test.ts` and DESIGN.md's table gain the families in U5.

## U5 — State families (DESIGN.md delta)

Kept: Procedure Version, Run lifecycle, Evidence Quality Gate, Result outcome, Auditor Review, Exception, Evaluation origin, Work Item.

Added to the state-family table, each with word, treatment and icon, never colour alone:

| Family | States |
|---|---|
| Agent Task | Queued · Running · Waiting · Paused · Completed · Canceled · Failed |
| Artifact review | Draft · Reviewed · Approved · Issued, plus the `needs-reconsideration` flag treatment |
| Claim support | Supported · Unsupported · Contradicted · Pending review · Not machine-checkable |
| Invocation outcome | Not dispatched · Accepted, pending · Confirmed · Denied · Failed before effect · Unknown after dispatch |
| Data quality | Complete · Partial · Empty under contract · Unknown |
| Connection | Pending · Active · Disabled · Revoked · Refresh unresolved |
| Memory item | Proposed · Active · Superseded · Rejected · Retired, with verification status as a secondary label |
| Wait | Open (countdown) · Answered · Expired · Withdrawn |

`status.test.ts` reads DESIGN.md's table off disk; the table grows and the test grows with it in the same commit.

## U6 — Per-surface states, the truthful sentences

Replaces the Builder, Procedure Detail and Version review rows. Every empty state names what would appear and what its absence means, never the likeliest cause; every unreadable read is a Banner, never an absence.

| Surface | State | Sentence rule |
|---|---|---|
| Engagements | none | "No engagements yet. Start one to begin a conversation." |
| Workspace | draft, no client | Header says "Draft — no client bound"; the agent's first reply names what it can and cannot reach until a client is bound. |
| Workspace | task waiting | The decision card is pinned; the rail shows the wait and its deadline; the thread stays usable for other tasks. |
| Workspace | connection lost mid-task | Card: "Drive stopped answering before the read completed. Nothing was read. Reconnect or continue with the material already acquired." Reconnect goes to Settings. |
| Workspace | operation unknown after dispatch | Card: "The invitation may have been created. The provider did not confirm. The task is waiting for reconciliation." Options per the reconcile decision, with the duplication warning on retry. |
| Workspace | denied operation | Card: "Sending to that address is outside this engagement's authority. Nothing was sent." with the closed reason and no retry. |
| Workspace | budget exhausted | Card: "The task reached its budget. What was produced is kept as a draft with its limitations." |
| Artifact | unsupported claims present | Header count: "2 claims are not yet supported"; approval control explains whether the pack permits approval with limitations. |
| Artifact | needs reconsideration | Flag with the impact record's reason and the version it came from; "Reviewed, unchanged" and "New version" are the two ways out. |
| Artifact | rendering blocked | "This document cannot be approved: the evidence screenshot on page 4 is missing from the rendering." Blocking defects listed; harmless limitations under Technical details. |
| Approval | independence refused | The gating table's sentence: "You cannot approve a version you authored." extended: "…or contributed to." |
| Approval | stale revision | "This version changed since you opened it. Reload to review the current revision." No approve control on the stale one. |
| Scheduled run | incomplete input | Statuses: Execution Completed · Input partial · Assessment Inconclusive · Review not started; exceptions listed; "Why inconclusive" opens the Gate checklist. |
| Scheduled run | access failure | "The leavers export could not be read: the Drive connection expired. The check did not run against it." Recovery request shown to the responsible person. |
| Scheduled run | material change | "The source folder moved outside the approved location. This check needs re-approval before it runs against it." Link to the platform-authored draft. |
| Needs you | none | "Nothing needs you. Questions, confirmations, reviews and proposals will appear here." |
| Connections | none | "No accounts connected. Connect one to let the agent read the resources you choose." |
| Methodology | no pack | "No methodology configured. You can converse, read permitted files and analyse now; ratings, formal outputs and recurring checks need a pack." with Select a starter pack / Prepare one from your documents. |

**Why:** the 2026-09-16 empty-state rule; FR-67, FR-72, FR-88; 3c C11 bootstrap. **Tests:** `copy.test.ts` pins every sentence above against EXPERIENCE.md on disk; the Builder-specific sentence pins are removed with the surfaces.

## U7 — Roles and action gating (extended, not replaced)

The table keeps its three roles and its denial sentences and gains rows; every cell is a sentence, and the platform's mandatory minimum cannot be weakened by a pack:

| Action | Auditor | Audit Manager | PoC Administrator |
|---|---|---|---|
| Start a draft engagement, converse, direct tasks, correct artifacts, answer questions, confirm bound actions within own Mandate | ✓ | ✓ | — "PoC Administrator cannot direct audit work." |
| Connect own accounts, choose designated resources, disconnect | ✓ | ✓ | ✓ (own) |
| Set an engagement's Mandate within the ceiling | ✓ (engagement member) | ✓ | — |
| Set the administrator ceiling (connectors, effect classes, budgets, disclosure policy) | — | — | ✓ |
| Confirm a memory proposal | scope owner or delegate | scope owner or delegate | — |
| Approve an artifact version, a method, a recurring check | per pack, never own or contributed | ✓ unless author or contributor | — |
| Issue a deliverable | per pack | ✓ | — |
| Transfer control of a running task or Run | — | ✓ with `run.control-transfer` | — |
| Manage methodology packs and skills | — | pack owner | ✓ (activation is audited) |
| Manage users, systems, sources | — | — | ✓ |

Denials stay verbatim where they exist; new denial sentences are added to `roles.ts` and to this table in the same commit, and `roles.test.ts` keeps asserting every action × role.

**Why:** 3a C3, D-3d-2, FR-60–63. **Tests:** `roles.test.ts`, `denial-strings.test.ts`.

## U8 — Key flows (replace Flows 0–6)

Each flow names the decision points a person meets and nothing else; everything else is the harness.

- **Flow A — Start an engagement and state an objective.** Sign in → Engagements → Start (name only) → the Workspace opens with the Mandate summary ("you can read your connected Drive; nothing is bound to a client yet") → the auditor writes the objective → the agent replies with what it found, assumed and needs, and proposes a plan artifact → the auditor edits the plan in the panel; the edit is a new version. Decision points: bind a client when the agent asks for client material (one card).
- **Flow B — Connect authorised resources.** Settings → Connections → Connect Google → the provider consent screen → back to Connections with the account, scopes and state → choose designated folders, labels and calendar (canonical identity shown, not a path) → the Mandate summary updates. Decision points: consent at the provider; designated resources.
- **Flow C — Follow the work.** The rail shows the task and each step as it lands; tool-call cards appear in the thread; a question pins a decision card; the auditor can pause, stop, or take control with the existing controls and words; leaving and returning shows the same thread and rail from durable state.
- **Flow D — Inspect and correct an artifact.** A candidate finding card → open in the panel → claim chips → a citation opens the evidence at its locator → the auditor writes the correction in the thread → the agent proposes a new version with the change and the flagged dependents → the auditor accepts the version (a decision, not a form) → the memory proposal card appears.
- **Flow E — Review memory proposals.** Needs you → proposal → Confirm, Reject or Edit scope; an explicit "remember…" shows "Recorded" inline and no card.
- **Flow F — Obtain independent approval.** Request review on a version → the reviewer opens it from Needs you → claims, citations, quality strip, rendering → Approve (Routine with rationale where the pack requires) → the decision is bound to the revision; an author or contributor meets the refusal sentence.
- **Flow G — Promote to a recurring check.** "Run this monthly" in the thread → the agent proposes the method artifact by selection → the method view shows steps, acquisition rules, validations, the mapping, unresolved issues → Submit for approval → a second person approves from Needs you → the schedule and the responsible person are shown on the rail.
- **Flow H — A scheduled run happens without anyone watching.** Needs you shows the scheduled result card with four statuses; Inconclusive lists its supported exceptions and "Why inconclusive"; an access failure shows the recovery request; a material change shows the platform-authored draft.
- **Flow I — Failure, uncertainty and refusal.** The U6 sentences in situ: connection lost, unknown after dispatch with the reconcile decision, denied operation, stale confirmation re-asked, expired wait with the work kept, budget exhausted.
- **Flow J — Administration.** Users; Systems and Sources (legacy registrations retained); the administrator ceiling and disclosure policy; pack activation as an audited change; Legacy procedures.

The acceptance scenario (Proposal 6) walks A–I in order; the flows are generic.

## U9 — What the auditor sees versus what the harness records

| The auditor meets | The harness records without asking |
|---|---|
| an assumption, a question, a coverage limitation, a candidate finding, a confirmation for one external action, a correction's consequences, a memory proposal, a review request, an approval | acquisition records, source snapshots and their quality dimensions, working material revisions, derivations and validation records, execution records, claim classes and citations, support-status transitions, impact records, receipts, ledger steps, audit events |

No surface asks the auditor to fill a provenance field, classify an input's quality, approve a calculation, confirm a routine read or annotate a tool call. Where the harness cannot establish something it says `unknown` and moves on.

## U10 — Accessibility, responsive, voice, formats: retained

Accessibility Floor unchanged (WCAG 2.1 AA, live regions, one landmark per kind, untrusted content announced as such — now including "Agent-generated" on every agent entry). Responsive: the Workspace is desktop-first; below 1024px the panel and rail become sheets over the thread and the thread stays usable; below 900px live controls withdraw as today. Voice and Tone and Formats unchanged; the "speak in audit tasks" discipline of the 2026-09-22 cleanup applies to every tool-call card and status sentence.

## U11 — Tests re-derived in the same commit as the contract

`copy.test.ts` (foundation, primitives, anti-pattern, every U6 sentence), `status.test.ts` and `tokens.test.ts` (U5 families), `stylesheet.test.ts` (U4 classes), `roles.test.ts` and `denial-strings.test.ts` (U7), `breadcrumb-rules.test.ts` and the shell tests (U2), `review-words.test.ts` (Needs you), `runs-list-words.test.ts` and `RunsTable.test.ts` (Run reached from the engagement), the RunConversation and workspace tests (the engagement thread), `administration-words.test.ts` (Connections, Methodology). Builder, Procedure list, Overview and Version-review word tests retire with their surfaces under Proposal 7; their approval-flow assertions move to the artifact approval tests.

## Why

Direction §A, §B, §F; Proposal 1 §1–§2.3; FR-52–63, FR-67, FR-72–76, FR-79, FR-85–90; 3a–3d as approved. No implementation is authorised; EXPERIENCE.md revision 2 and the DESIGN.md delta are the deliverables once approved, and they bind revision 5 of the spine (3d lists them as pending).
