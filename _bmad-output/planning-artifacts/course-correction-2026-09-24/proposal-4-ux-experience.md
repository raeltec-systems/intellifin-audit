# Proposal 4 of 7 (revised) — UX and interaction design: EXPERIENCE.md revision 2 and the DESIGN.md delta

Status: revised on 2026-09-24 after the owner's eight edit groups (D-4-1..4 taken as below); awaiting owner approval. Builds on the approved PRD text (Proposals 1–2) and the approved architecture (3a–3d) and expresses them as an experience. **The governing distinction: conversation initiates and directs real work; the harness enforces how that work happens. The auditor experiences a capable assistant, not a permissions console.** Provenance collection, permission evaluation and execution bookkeeping stay in the harness; the auditor meets the information and decisions needed to direct and review the work.

Baseline: EXPERIENCE.md (final, 2026-09-01, plus the 2026-09-11 and 2026-09-22 owner sections); DESIGN.md (final, 2026-09-01); the web inventory in `analysis-web-ux.md`. The one existing "conversation" (Auditor Workspace v1.1) is a fixed-vocabulary command console over one Run with no model reply; its receipt-bound commands, encrypted content, server-side interpretation before action and audit-chained history are reused as plumbing, not as the destination.

Owner decisions on Proposal 4:

| Decision | Choice |
|---|---|
| D-4-1 | **Taken: conversation-primary workspace.** Conversation is the default focus. The inspection panel opens when the auditor selects an artifact, evidence item, source, memory item or working view, and can be resized, expanded or closed without losing the conversation or the selected context. Activity is collapsed or summarised by default and expands on demand; important questions, limitations and unresolved actions stay visible without the activity log open. No layout requires three permanently visible work regions beside the main navigation. Navigation: Engagements · Needs you · Settings, with scheduled checks and legacy procedures discoverable as views inside Engagements. |
| D-4-2 | **Amended.** The gate determines whether a confirmation is required. The action's consequences determine its presentation and confirmation weight. One coherent decision surface per decision, never a card followed by a dialog repeating it. Ordinary drafts carry no blanket approval requirement. |
| D-4-3 | **Taken with amended presentation.** Material limitations and outcomes are explained in ordinary audit language. Internal states and claim classifications are available through inspection and a review mode, not in the default reading experience. |
| D-4-4 | **Taken.** Review is organised around the artifact or decision, with claim-level inspection available. Substantive judgement remains possible without turning every calculation into an approval request. |

Each change states: what EXPERIENCE.md says now, what it says in revision 2, why, and the UX acceptance obligation it creates.

---

## U1 — Foundation, mental model and the four things the interface never does

**Now:** "Procedure → Run → Agent Workspace → Evidence → Result → Auditor Review"; "Four things the interface never does: … let free text reach the agent …"; single tenant.

**Revision 2:**

> The primary mental model is **Engagement → Conversation and Agent Tasks → Sources, Evidence and Working Material → Artifacts → Decisions and Review → optionally an approved recurring check and its Runs** (PRD §1, rev 4). Conversation directs the work; artifacts are what is reviewed; evidence is what artifacts stand on. The agent's work is the core experience; the auditor is accountable for what is issued.
>
> Four things the interface never does: let a message, a document, a skill or a memory item grant authority; represent a pending, unsupported or disputed assertion as a verified finding or conclusion; present an empty list, an empty folder or an incomplete search as a passed control or a proven absence; represent a draft or an unapproved rendering as approved or formally issued.
>
> **Candidate findings stay visible with their actual status.** A candidate may contain a supported condition and an unresolved cause; review operates on those distinctions and never hides the candidate. When self-review cannot complete, the draft is shown as a labelled draft with its limitations; the interface neither implies review happened nor suppresses the work.
>
> **Sharing a draft is not issuance.** Authorised sharing of a clearly identified working draft for feedback is distinct from formal issuance: it follows the destination, disclosure and confirmation requirements that apply, and retains the exact shared version and receipt. Formal issuance requires the approvals and rendering checks applicable to that deliverable. Marking a file "draft" cannot bypass a prohibited disclosure or conceal a material rendering defect.
>
> Multi-tenant from the first release. Each active working conversation has an explicit engagement and client context, named in the workspace header in readable words (workspace name, client name, engagement title). Lists may show items from several authorised clients, each clearly attributed; listing them combines nothing into one agent context and grants no cross-client access. Switching engagements carries no attachments, selected resources, pending confirmations or unsent drafts into the new engagement.

**Why:** Proposal 1 §1; 3a C1–C2; 3b C7; 3c C9; FR-3, FR-55, FR-67, FR-74, FR-90. **Acceptance:** a candidate finding with an unresolved cause is shown with both statuses; review unavailable leaves a labelled draft; an authorised draft share is labelled as a draft and receipted; final issuance without the required approval is refused; switching engagements leaves the previous engagement's unsent draft behind and brings nothing across.

## U2 — Information architecture (D-4-1)

**Now:** sidebar Overview · Procedures · Runs · Reviews · Notifications · Administration; Builder, Procedure Detail and Version review as top-level surfaces.

**Revision 2:**

| Surface | Reached from | What it is |
|---|---|---|
| **Engagements** | sidebar | The person's engagements, drafts first, then by recent activity. **Views** within it: Scheduled checks (every active check the person may see, with its next run, even when nothing needs attention); Legacy procedures (compiler-1 Procedures, reachable by their authorised auditors and reviewers, never administrator-only). "New" opens a conversation immediately. |
| **Engagement Workspace** | an engagement | The conversation thread is the default focus. An **inspection panel** opens beside it on selection (artifact, evidence item, source, memory item, working view, live browser workspace) and can be resized, expanded to full width or closed; the conversation and the selected context survive either. An **activity summary** sits above the composer (current step in audit words, open questions, unresolved actions) and expands into the full activity view on demand. |
| **Needs you** | sidebar, bell | One list across engagements of actual decisions, problems and reviews: questions, confirmations, reconciliations, review requests, approvals, memory proposals, scheduled results that need attention. Each row names the engagement and client, the item, a readable deadline (date, time, time zone) where one exists, and one action. Ordinary completed runs stay in activity and history, not here. Replaces Overview, Notifications and Reviews as navigation; the review queue's independence rules stay. |
| **Artifact** (full page) | the panel's "Open full" | Versions, matters needing review, citations, dependencies, decisions, renderings; the same content as the panel with room. |
| **Run** (full page) | Scheduled checks, the activity view, a scheduled result | The existing Run Detail semantics (execution, assessment, evidence checks, review) reached from the engagement; Live View and Replay for browser sessions. |
| **View workspace** | the activity summary of any task using a browser | The authorised live browser workspace and its controls (pause, stop, take control, answer), for Agent Tasks as for Runs; never only on legacy Run pages. |
| **Settings** | sidebar, and from the conversation when a connection is needed | Connections (mine), Methodology (packs, skills — owners only), Users, Systems and Sources (administrators), the administrator ceiling and disclosure policy. Returning from Settings lands on the work that sent the person there. |

Breadcrumb: Engagement / Workspace; Engagement / Artifact name; Engagement / Run. The shell's one-landmark rule and `rendersOwnTrail` discipline carry over.

**Why:** Proposal 1 §1; 3a C2; 3c C10; owner edit 3. **Acceptance:** a first request needs no name; an active schedule is found when Needs you is empty; a legacy Procedure is opened by its auditor; opening a citation keeps the claim being reviewed and offers a return; Settings opened from the conversation returns to the same work.

## U3 — Interaction primitives (the reversal)

**Now:** "Free text reaches the agent nowhere. Escalation notes and rationale fields are recorded only." "Rejected — chat-first agent UI."

**Revision 2:**

> **Conversation directs real work.** Submitting a request can start authorised analysis, retrieval, drafting and other permitted operations without a separate "Run" button or a confirmation for each step. "Compare these two files and show me the differences" makes the agent examine and compare the authorised files; it does not produce a plan the auditor must approve before every routine step.
>
> The message expresses the auditor's intent; the harness validates, authorises, executes and records the resulting operations. Neither model output nor external content bypasses that boundary.
>
> The interface asks for a decision only when information, authority or the applicable workflow genuinely requires one. A contextual free-text answer ("Use the March extract") resolves the open clarification it answers: the application records it against that question and resumes after validation; the auditor need not repeat it through an option button. Exact, revision-bound controls remain for external-effect confirmation, independent approval and the other decisions that require them; an explicit authorised "remember this preference" is its own retention confirmation.
>
> **Every agent entry is attributed** (Agent, Auditor, Platform) and carries its kind where the kind matters: plan proposal, question, candidate finding, decision request, memory proposal, security notice. Agent prose is rendered as agent prose; attribution establishes who is speaking, and an intrusive "untrusted" warning is not repeated on every ordinary message.
>
> **Streaming shows status, never a verdict**: a draft streams as drafting; a candidate finding appears with its status after the self-review step; nothing streams as verified. New activity is indicated without forcing scroll or focus away from an older message or evidence region the person is inspecting.

The anti-pattern line becomes: *Rejected — a conversation that bypasses controls, misrepresents what happened, or recreates a form wizard as a sequence of questions.*

**Why:** FR-55, FR-57, FR-61; 3c C9. **Acceptance:** a natural-language request completes permitted work with no start or approval ceremony; a contextual free-text answer resolves its clarification; an instruction inside a source document closes no wait; a confirmation-required action stays blocked until its bound decision is recorded.

## U4 — Component patterns: progressive disclosure

Kept as they are: Status badge, Conclusion triptych, Gate checklist, Grounding inspector, Provenance chain, Evaluation card and confirmation, Confirmation dialog weights (per D-4-2), Untrusted-content rendering for retrieved content, Empty state, Identifier, Timestamp, Reference, Technical details, Banner, DataTable.

Added, each with a **default reading view** and an **inspection view**:

| Pattern | Default | On inspection |
|---|---|---|
| Conversation thread | Chronological, attributed entries; routine work summarised in audit words ("Comparing the three account lists.") with grouped low-level steps; questions and decisions clearly placed, several outstanding ones listed, none pinned over the composer. | Each step's arguments (sanitised), outcome in readable words, receipt, timing. |
| Activity summary and view | The current step and open items above the composer. | The full step list per task; canonical states mapped to readable labels (a write to an output folder is "Saved to the Drafts folder", an unconfirmed send is "Not confirmed by the provider"); internal vocabulary (`write-output`, `unknown-after-dispatch`, `empty-under-contract`, `refresh-unresolved`) appears only here and in Technical details. No manufactured progress percentages; observed activity and actual completion or waiting states. |
| Artifact (panel and page) | A readable working paper, report, table or analysis. Citations visible as unobtrusive marks; material limitations visible in the header and where they apply; pending, contradicted or disputed matters given clear, accessible emphasis. Supported claims carry no inline badge. | **Review mode**: a focused list of matters needing review, each opening its claim with class, support status, citations, validation records and lineage; decisions with their revision binding. |
| Citation | Opens the cited evidence at its locator in the panel (page image with the region, cell, paragraph, message part), with the originating claim kept in view and a return control. | Provenance class, acquisition date and account, extraction limitations. |
| Result and quality summary | One truthful sentence: "The analysis finished. Three exceptions are supported, but the full population has not been established." | Execution, input quality (the independent dimensions, `unknown` shown as unknown), assessment and review, each separately. |
| Decision surface | One coherent surface per decision with the exact material details and an action-specific control: "Create invitation" (resolved date, time, time zone, calendar, recipients), "Save to Drafts" (exact version, destination, draft status), "Approve version", "Issue report". For a reconciliation: only the recovery actions the current state permits; a retry that may duplicate says so and is never presented as safe; a human resolution is recorded as a human resolution. | The bound details' provenance, the gate outcome, the receipt. |
| Memory | An explicit instruction shows "Remembered for your preferences" inline with a link to inspect or correct; an inferred item shows a proposal with scope, source and reason and Confirm / Reject / Edit scope. | The item's verification status, effective dates, supersession. |
| Connection and resources | Provider, account identity, readable names for designated folders, labels and calendars with meaningful location context; state in words; Connect reachable from the conversation and returning to the work. Accounts, granted capabilities and permitted locations are shown as three things; consent alone makes nothing usable. | Scopes granted, canonical identifiers, disconnect consequences. |
| Mandate summary | What the agent may read, draft, save and do in this engagement, and which actions will ask, in plain sentences. | Effective authority per operation, budgets, ceiling. |
| Method and promotion | The selected steps, inputs, checks and criteria as a readable method; "Submit for approval". | The compiler's mapping, unresolved issues, acquisition rules, schedule, responsible person. |
| Scheduled result | The one-sentence summary and the summary word (Pass / Exception / Inconclusive / Failed to run) with supported exceptions listed. | The four statuses separately; "Why inconclusive" opens the Gate checklist. |

**Why:** 3b C6–C7, 3c C9–C12, 3a C3–C4; owner edit 4. **Acceptance:** a working paper is read normally with no technical detail open; material limitations are visible at once; a source is selected by its readable name; inspection reveals the complete underlying records and never a secret.

## U5 — State families (DESIGN.md delta)

Kept: Procedure Version, Run lifecycle, Evidence Quality Gate, Result outcome, Auditor Review, Exception, Evaluation origin, Work Item.

Added to the state-family table, each with a readable word, treatment and icon, never colour alone; the canonical state name is recorded beside the word so the internal vocabulary maps to it once:

| Family | Readable states |
|---|---|
| Agent Task | Queued · Working · Waiting for you · Paused · Done · Stopped · Failed |
| Artifact review | Draft · Reviewed · Approved · Issued; flag: Needs another look |
| Claim support (review mode only) | Supported · Not yet supported · Contradicted · Awaiting review · Cannot be checked automatically |
| Action outcome | Not sent · Sent, not yet confirmed · Confirmed · Blocked · Failed before sending · Not confirmed by the provider |
| Data quality (inspection only) | Complete · Partial · Empty, as the source states · Unknown |
| Connection | Connecting · Connected · Disconnected · Access revoked · Needs reconnection |
| Memory item | Proposed · Remembered · Replaced · Declined · Retired; secondary: reported by you · supported by a source · disputed · awaiting verification |
| Wait | Waiting for you · Answered · Expired · Withdrawn |

**Why:** D-4-3. **Acceptance:** `status.test.ts` reads DESIGN.md's table off disk and the table and test grow together; no colour-only state.

## U6 — Per-surface states, the truthful sentences

Replaces the Builder, Procedure Detail and Version review rows. Every sentence depends on the **recorded state**, not the broad error category; every empty state names what would appear and what its absence means; every unreadable read is a Banner, never an absence.

| Surface | State | Sentence rule |
|---|---|---|
| Engagements | none | "No engagements yet. Start a conversation to begin." |
| Workspace | draft, client not selected | Header: "Client not selected"; the agent's first reply names what it can reach now and what needs a client. |
| Workspace | read interrupted | "The read did not complete. Material already acquired has been preserved, but coverage is incomplete." Then the remedy the recorded cause supports: Reconnect for an authentication problem; Retry for a temporary failure where retry is safe; Continue with the limited material where permitted. |
| Workspace | action not confirmed by the provider | "The invitation may have been created. The provider did not confirm. This is waiting for reconciliation." Only the permitted recovery actions; a retry that may duplicate says so. |
| Workspace | action blocked | "This attempt was blocked before sending." only where the receipt shows no dispatch; any earlier unresolved attempt stays visible beside it. |
| Workspace | budget reached | "The task reached its budget. What was produced is kept as a draft with its limitations." |
| Workspace | task waiting | The question is listed with the others; unrelated work continues. |
| Artifact | matters needing review | Header: "2 matters need review"; the approval control states whether the pack permits approval with limitations. |
| Artifact | needs another look | The impact record's reason and the version it came from; "Reviewed, unchanged" and "New version" are the two ways out. |
| Artifact | rendering blocked | "This document cannot be approved: the evidence screenshot on page 4 is missing from the rendering." Blocking defects listed; harmless limitations under Technical details. |
| Approval | independence refused | "You cannot approve a version you authored or contributed to." |
| Approval | review context changed | Names the recorded change — a newer version exists, the approval context changed, the rendering changed, a permission expired — and keeps the previously reviewed version open; the latest draft is never substituted silently. |
| Scheduled run | incomplete input | "The check ran, but the application user list was incomplete. The assessment is inconclusive; the three supported exceptions are listed." Expanding shows execution, input, assessment and review separately. |
| Scheduled run | access failure | "The leavers export could not be read: the Drive connection has expired. The check did not run against it." Recovery request to the responsible person. |
| Scheduled run | material change | "The source folder moved outside the approved location. This check needs re-approval before it runs against it." Link to the platform-authored draft. |
| Needs you | loaded, empty | "Nothing needs you. Questions, confirmations, reviews and proposals will appear here." |
| Needs you | not loaded | Banner: "Couldn't load what needs you. Nothing has changed." — never the empty state. |
| Connections | none | "No accounts connected. Connect one to let the agent read the resources you choose." |
| Methodology | no pack | "No methodology configured. You can converse, read permitted files and analyse now; ratings, formal outputs and recurring checks need a methodology." with Select a starter pack / Prepare one from your documents. |
| Unknown information | anywhere | Unknown stays explicit. Work continues where the missing fact does not prevent useful authorised progress; dependent conclusions and actions stay constrained; the agent asks or records a limitation when required. |
| Deadlines | anywhere | Date, time and time zone in words ("by Friday 3 October, 17:00 UTC"); a live countdown only for waits under an hour; action validity shown separately from the response deadline where they differ. |

**Why:** the 2026-09-16 empty-state rule; FR-67, FR-72, FR-88; 3d D-3d-3; owner edit 6. **Acceptance:** a partial acquisition is preserved and said; a temporary outage is distinguished from expired access; a blocked attempt after an earlier uncertain one shows both; an outdated review context names the change and keeps the reviewed version; an unavailable Needs you query shows the Banner, not the empty state.

## U7 — Roles and action gating (extended, not replaced)

The table keeps its three roles and its denial sentences and gains rows. **Every ✓ means the named role plus current membership, the applicable capability, ownership or delegation, and resource scope; a global role alone reaches nothing.** A pack may require stricter review within supported capabilities and never weaker; an unsupported stricter workflow is blocked.

| Action | Auditor | Audit Manager | PoC Administrator |
|---|---|---|---|
| Start a conversation, direct tasks, answer questions, confirm bound actions within own Mandate | ✓ | ✓ | — "PoC Administrator cannot direct audit work." |
| Create, revise and review working artifacts (drafts; no independence rule) | ✓ | ✓ | — |
| Approve an artifact version under its methodology | per pack; never own or contributed | ✓ unless author or contributor | — |
| Review a method artifact | per pack | ✓ | — |
| Approve a Procedure Version (compiler-1 or compiler-2) | — "Only an Audit Manager can approve a Procedure Version." | ✓ unless author or contributor: "You cannot approve a version you authored or contributed to." | — |
| Issue a deliverable | per pack | ✓ where a member with issue authority | — |
| Share a working draft to an authorised destination | ✓ within Mandate | ✓ | — |
| Connect own accounts, choose designated resources, disconnect | ✓ | ✓ | ✓ (own) |
| Set an engagement's Mandate within the ceiling | ✓ (member) | ✓ | — |
| Set the administrator ceiling and disclosure policy | — | — | ✓ |
| Confirm a memory proposal | scope owner or delegate | scope owner or delegate | — (operating Settings confirms nobody's proposal) |
| Propose, approve and activate methodology packs and skills | propose | pack owner approves | activation is an audited administrative act; it never approves content |
| Transfer control of a running task or Run | — | ✓ with `run.control-transfer` | — |
| Manage users, systems, sources | — | — | ✓ |

**Why:** 3a C3, D-3d-2, FR-60–63; owner edit 5. **Acceptance:** no duplicate confirmation; stale material details need a new decision; a routine draft revision needs no formal approval; Procedure self-approval refused; an Audit Manager without engagement membership refused; an administrator cannot activate an unapproved pack or confirm another person's memory proposal.

## U8 — Key flows (replace Flows 0–6)

Each flow names the decision points a person meets and nothing else; everything else is the harness.

- **Flow A — Start and state the objective.** Engagements → New → a conversation opens at once → the auditor writes the objective → a provisional title is generated (renameable) → the agent replies with what it found, assumed and needs, and proposes a plan the auditor can edit in the panel. Decision points: selecting a client when the agent needs client material.
- **Flow B — Connect authorised resources**, from Settings or from the conversation when a connection is needed → provider consent → back with the account, capabilities and readable designated resources → return to the work. Decision points: consent at the provider; designated resources.
- **Flow C — Follow the work.** The activity summary shows the current step in audit words; questions and unresolved actions are listed; pause, stop and take control use the existing words; View workspace opens the live browser for a browser task; leaving and returning restores the conversation, selected artifact and pending decisions from durable state.
- **Flow D — Inspect and correct an artifact.** A candidate finding → the panel in reading view → review mode for the matters needing review → a citation opens the evidence with the claim kept in view → the auditor writes the correction in the thread → the agent proposes a new version with the change and the affected dependents → the auditor accepts the version → a memory proposal appears if the agent inferred one.
- **Flow E — Memory.** "Remember…" shows Remembered inline with a link; a proposal is confirmed, declined or rescoped from the thread or Needs you.
- **Flow F — Independent approval.** Request review → the reviewer opens the version from Needs you → reading view, then review mode → one decision surface: Approve version with rationale where the pack requires → bound to the revision; an author or contributor meets the refusal.
- **Flow G — Promote to a recurring check.** "Run this monthly" → the agent proposes the method by selection → the readable method view → Submit for approval → a second person approves from Needs you → the check appears under Scheduled checks with its next run and responsible person.
- **Flow H — A scheduled run nobody watches.** A result that needs attention appears in Needs you with its one-sentence summary; an ordinary completed run appears under Scheduled checks and history; access failures and material changes carry their U6 sentences.
- **Flow I — Failure, uncertainty and refusal.** The U6 sentences in situ.
- **Flow J — Administration.** Users; Systems and Sources; the ceiling and disclosure policy; pack activation as an audited act; legacy procedures reachable by their auditors.

The acceptance scenario (Proposal 6) walks A–I in order; the flows are generic.

## U9 — What the auditor sees versus what the harness records

| The auditor meets | The harness records without asking |
|---|---|
| an assumption, a question, a coverage limitation, a candidate finding, one decision surface per external action, a correction's consequences, a memory proposal, a review request, an approval | acquisition records, source snapshots and their quality dimensions, working material revisions, derivations and validation records, execution records, claim classes and citations, support-status transitions, impact records, receipts, ledger steps, audit events |

No surface asks the auditor to fill a provenance field, classify an input's quality, approve a calculation, confirm a routine read or annotate a step. Unknown information remains explicit and constrains what depends on it; it never stops useful authorised work.

## U10 — Continuity, control and accessibility across widths

- Essential task status, open questions, confirmation decisions and authorised pause and stop controls remain usable at every supported width. A live browser view may use a dedicated full-screen surface or state its viewing limitation; it never hides the task's safety controls. "Stop requested" is distinguished from confirmed cessation; a completed external effect is never described as undone.
- Leaving and returning restores the relevant conversation, selected artifact and version, task state and pending decisions from their stores. Unsent drafts stay scoped to their engagement. A reconnect never duplicates a submission.
- A waiting task never disables unrelated work; several outstanding questions are organised clearly.
- Accessibility Floor unchanged and demonstrated in the new interactions: keyboard access and focus return for panels and dialogs; citations with meaningful context; status changes announced without reading every streamed token; labels never colour-only; attribution ("Agent") establishes the speaker.
- Voice and Tone and Formats unchanged; the 2026-09-22 "speak in audit tasks" discipline applies to every activity sentence.

## U11 — How the experience is tested

- **Exact-copy tests** cover intentionally fixed product language: status meanings (U5), safety-critical sentences (blocked, not confirmed, cannot be approved, independence refusal), standard action labels and the Banner sentences. They read EXPERIENCE.md and DESIGN.md off disk as today.
- **Agent-generated explanations and the illustrative conversation examples in this document are not exact application copy.** They are tested for required facts, qualifications, prohibited claims and links to the correct records, never one phrasing.
- **Interaction tests** establish what the person can accomplish, which decisions are required, and whether the displayed outcome matches the authoritative state.
- **Browser and visual acceptance** establish layout, readable hierarchy, focus, scrolling, responsive behaviour and preservation of context. The design acceptance set: a new conversation; active analysis; artifact and citation inspection in reading and review modes; a material decision; an uncertain external effect; an unattended scheduled result. Representative desktop and narrow-screen mockups, or an equivalent prototype, are reviewed before the shell is implemented; text and class tests alone establish nothing about the working experience.
- **Implementation obligations, not planning-time changes:** the tests that move with the contract (`copy.test.ts` for the fixed sentences, `status.test.ts` and `tokens.test.ts` for U5, `stylesheet.test.ts` for new classes, `roles.test.ts` and `denial-strings.test.ts` for U7, the shell and breadcrumb tests for U2, the review, runs-list, workspace and administration word tests for their surfaces) change with their implementation and the legacy disposition in Proposal 7. No application code changes and no test is retired to make the planning documents pass.

## Why

Direction §A, §B, §F; Proposal 1 §1–§2.3; FR-52–63, FR-67, FR-72–76, FR-79, FR-85–90; 3a–3d as approved; the owner's edits of 2026-09-24. No implementation is authorised; EXPERIENCE.md revision 2 and the DESIGN.md delta are the deliverables once approved, and they bind revision 5 of the spine (3d lists them as pending).
