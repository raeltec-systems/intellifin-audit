---
name: Zobba
status: final
revision: 2
created: 2026-09-25
updated: 2026-09-25
supersedes: "EXPERIENCE.md (final, 2026-09-01) at ../ux-IntelliFin Audit-2026-09-01/EXPERIENCE.md, which stays in force for the compiler-1 Run path surfaces until their disposition story"
sources:
  - ../../prds/prd-IntelliFin Audit-2026-08-31/prd.md  # revision 4
  - ../../prds/prd-IntelliFin Audit-2026-08-31/addendum.md
  - ./DESIGN.md  # revision 2
  - ../zobba-design-system-v1.0/BRAND.md
  - ../zobba-design-system-v1.0/DESIGN-SYSTEM.md
  - ../zobba-design-system-v1.0/EXPERIENCE-RULES.md
  - ../zobba-design-system-v1.0/PATTERNS.md
  - ../zobba-design-system-v1.0/COMPONENT-INVENTORY.md
  - ../zobba-design-system-v1.0/HANDOFF.md
  - ../zobba-design-system-v1.0/OPEN-QUESTIONS.md
  - ../../course-correction-2026-09-24/proposal-4-ux-experience.md  # approved 2026-09-24
  - ../../course-correction-2026-09-24/proposal-4b-zobba-design-reconciliation.md  # approved 2026-09-25
---

# Zobba — Experience Spine

**Precedence.** `DESIGN.md` (revision 2) is the visual reference. The Zobba design pack (`../zobba-design-system-v1.0/`) is the authoritative visual and interaction specification. Where the approved reconciliation (Proposal 4b §5, §6, §6a, §7) amended a screen, a default or a sentence, the reconciliation governs. On conflict between this spine and `DESIGN.md`, behaviour and copy follow this spine; visual values (tokens, sizes, treatments) follow `DESIGN.md`. The 23 reference screens are illustrative, except the fixed labels and safety-critical message patterns adopted as exact copy (§11). The approved conversation-led direction and its safeguards (Proposals 1–3d, 4) are preserved; nothing in the pack overrides them silently, and nothing here overrides the pack silently either: each conflict and its amendment is listed in Proposal 4b §5 and restated where it applies below.

Requirement identifiers (FR-n, NFR-n, UJ-n, addendum §x) are the PRD's, revision 4. Rule identifiers R1–R12 are EXPERIENCE-RULES', P1–P19 are PATTERNS', RS nn are the reference screens'. Owner constraints that bind every section: **"No implementation is authorised."** and **"Do not change application code or retire existing tests prematurely merely to make the planning documents pass; tests move with their corresponding implementation and legacy disposition."**

Approval of this interaction contract is not approval of an unseen rendered interface: representative desktop and narrow-screen mockups or a prototype are reviewed before the shell is built (§11).

## 1. Foundation

**Zobba** ("The audit agent", by Raeltec) is a conversation-led audit harness: the auditor directs real audit work in conversation, Zobba does it inside its Permissions, shows what supports each result and asks at meaningful boundaries, and the auditor is accountable for what is issued. Web, desktop-first, responsive; light-only working UI in the first release (Q4).

**The Pair.** The identity is two forms held against one centre line — claim ↔ evidence, conversation ↔ artifact, auditor ↔ Zobba, expected ↔ actual, source ↔ conclusion. Pair is a concept, never a decorative pattern. **Iris means "Zobba is here" (or "you can act on this"), never an audit result**: no result chip, count, approval, sign-off or send button uses Iris. Audit semantics are independent of the brand (BRAND §3). The mark identifies the actor; a semantic chip identifies the outcome; they never merge.

**Voice.** In conversation Zobba speaks in the first person, unboxed, with no avatar per reply ("I found…", "I couldn't establish…", "I need your permission before sending these."). Chrome and system events use the third person ("Zobba is analysing", "Zobba needs your input"). Zobba never refers to itself in the third person inside conversation. Every entry is attributed (Agent, Auditor, Platform); attribution establishes who is speaking, and an "untrusted" warning is not repeated on every ordinary message.

**Mental model.** **Engagement → Conversation and Agent Tasks → Sources, Evidence and Working Material → Artifacts → Decisions and Review → optionally an approved recurring check and its Runs** (PRD §1, rev 4). Conversation directs the work; artifacts are what is reviewed; evidence is what artifacts stand on. The governing distinction: conversation initiates and directs real work; the harness enforces how that work happens. The auditor experiences a capable assistant, not a permissions console.

**Four things the interface never does:**

1. Let a message, a document, a skill or a memory item grant authority.
2. Represent a pending, unsupported or disputed assertion as a verified finding or conclusion.
3. Present an empty list, an empty folder or an incomplete search as a passed control or a proven absence.
4. Represent a draft or an unapproved rendering as approved or formally issued.

**Candidate findings stay visible with their actual status.** A candidate may contain a supported condition and an unresolved cause; review operates on those distinctions and never hides the candidate. When self-review cannot complete, the draft is shown as a labelled draft with its limitations; the interface neither implies review happened nor suppresses the work.

**Sharing a draft is not issuance.** Authorised sharing of a clearly identified working draft for feedback follows the destination, disclosure and confirmation requirements that apply, and retains the exact shared version and receipt. Formal issuance requires the approvals and rendering checks applicable to that deliverable. Marking a file "draft" cannot bypass a prohibited disclosure or conceal a material rendering defect.

**Chrome is Zobba; the artifact is the methodology's** (R3.1). Artifact pages use the firm template's typography, layout, reference scheme and colours. Prepared by and Reviewed by name accountable people; Zobba is never the preparer or reviewer of record (R3.2).

**Multi-tenant from the first release.** Each active working conversation has an explicit engagement and client context, named in the workspace header in readable words (workspace name, client name, engagement title). Lists and search may show items from several authorised clients, each attributed; listing them combines nothing into one agent context and grants no cross-client access. Switching engagements carries no attachments, selected resources, pending confirmations or unsent drafts into the new engagement.

**Roles.** Three tenant roles, as capability groups: **Auditor**, **Audit manager**, **Admin** (FR-94). There is no standalone Methodology owner, Partner or Approver role in this release. The existing identifier `poc-administrator` is displayed "Admin" until the dedicated rename story (D-4b-1). Engagement assignments (lead auditor, auditor, reviewer) are scoped responsibilities, not tenant roles. Details in §7.

## 2. Navigation and information architecture

Sidebar (DESIGN-SYSTEM §5, D-4b-2), fixed labels:

```text
New task
Search
Scheduled checks
─ Engagements
─ Recent tasks
Connections
Settings
User
```

- **Reviews** is a first-level item shown to people with assigned review responsibilities and the required capabilities, not to everyone carrying a role label (FR-94). **Settings › Administration** is shown to Admin.
- **There is no first-level Needs you page.** The complete attention view — every authorised open question, confirmation, reconciliation case, memory proposal, review request and result needing attention — is reachable from the notification panel (bell) as one linked view. Home's Continue list and the needs-attention badges are entry points, never the only way to discover an outstanding decision.
- **Library is not first level**; its jobs are covered by Engagements, Search and Settings › Methodology and skills. Skills are met where they are used: the composer's + menu, activity lines ("Using Leaver access test v3") and How it ran. Permissions belong to each engagement, not to global navigation.
- Active item: Paper fill, hairline ring, weight 600; Iris is not used for navigation. Task rows carry the working mark while running, the waiting mark while waiting, nothing when idle. A needs-attention badge is a Graphite count with an accessible label ("2 need attention"); Connections shows "▲ n" when a connection needs reconnecting.

| Surface | Reached from | What it is |
| --- | --- | --- |
| Home (RS 01) | New task | Greeting, the composer ("What are we auditing today?") with engagement, Permissions and model chips, starters (Test a control · Analyse a population · Draft a working paper · Plan a walkthrough — skill entry points), and the Continue list. A first request needs no name. |
| Engagement workspace (RS 02–09) | an engagement, a task, Continue, Recent tasks | The conversation is the default focus. A **contextual inspection panel** opens beside it when there is something to inspect and can be pinned, expanded or closed without losing the conversation or the selected context. An **activity summary** above the composer shows the current step in audit words, open questions and unresolved actions, and expands into the full activity view on demand. |
| Engagement page (RS 10) | Engagements | Tasks; working papers and artifacts; scheduled checks; Permissions summary; Team; Client contacts; Sources; Methodology. |
| Artifact (full page) | the panel's "Open full" | Versions, matters needing review, citations, dependencies, decisions, renderings; the panel's content with room. |
| Search (RS 11) | Search | Scope-aware search across authorised work (§3, R10). |
| Scheduled checks (RS 12) | Scheduled checks | Every active check the person may see, with its next run, even when nothing needs attention, each row showing the separate status dimensions (§5). |
| Scheduled result (RS 13) | Scheduled checks, notification, attention view | Actor line; assessment chip; readable conclusion; Exceptions · Coverage · Evidence · How it ran; Mark as reviewed; Discuss this result; suggested follow-up through the confirmation flow. |
| Run (full page) | Scheduled checks, the activity view, a scheduled result | The existing Run Detail semantics (execution, assessment, evidence checks, review); Live View and Replay for browser sessions (§12). |
| View workspace | the activity summary of any task using a browser | The authorised live browser workspace and its controls (pause, stop, take control, answer), for Agent Tasks as for Runs; never only on legacy Run pages. |
| Reviews (RS 20, 21) | Reviews | Queue grouped Waiting for your review · Returned with your notes · Reviewed recently; reviewing a paper with anchored review notes (§4, Flow L). |
| Connections (RS 14) | Connections; the conversation when a connection is needed | The person's user-owned connections (D-4b-3). |
| Settings (RS 15) | Settings | Connections, Methodology and skills (managed by Admin), profile and organisation; a secondary 220px column with the main app on the rail. |
| Settings › Administration (RS 22, 23) | Settings, Admin only | Users and roles, Models and providers, Connections policy, Administrator limits (the Permissions Policy), Data and retention, Audit log. Methodology and skills stays at Settings › Methodology and skills and is managed by Admin. |
| Legacy procedures | a view reachable from Engagements and from Search results of type Procedure `[TO DESIGN]` | Compiler-1 Procedures, their Runs, Run Detail, Live View and Replay, reachable by their authorised auditors and reviewers, never administrator-only (§12). |

**Layout modes** (DESIGN-SYSTEM §1): (1) conversation only — the default for starting and for questions; (2) conversation and workspace — the panel opens beside a conversation of at least 400px; (3) workspace focus — Expand collapses the sidebar to the rail, the panel takes about 62% and the conversation stays visible at 400–430px; (4) full-screen workspace — a second Expand for browser sessions or large tables, with the conversation as a bottom bar holding the composer, Stop and the presence chip; (5) artifact inspection — as focus mode, the page on its surround. The evidence drawer overlays the right edge of the workspace with the claim visible and highlighted to its left. Narrow widths: §10. No layout requires three permanently visible work regions beside the main navigation.

**Returning.** Returning from Settings or Connections lands on the work that sent the person there. Leaving and returning restores the conversation, the selected artifact and version, the task state and pending decisions from their stores (§10).

**Breadcrumbs** on every detail surface: Engagement / Workspace; Engagement / Artifact name; Engagement / Run. The shell's one-landmark rule holds: a page that renders its own trail is the only trail on that page (`rendersOwnTrail`), because two breadcrumb landmarks nobody can tell apart are a defect the automated accessibility gate cannot see.

## 3. Interaction rules

Rules R1–R12 of EXPERIENCE-RULES as amended by Proposal 4b §5, with Proposal 4 U3's primitives.

**Conversation directs real work (R1.1, U3).** The auditor expresses intent in conversation; there are no forms for starting audit work. Submitting a request can start authorised analysis, retrieval, drafting and other permitted operations without a separate "Run" button or a confirmation per step. The message expresses intent; the harness validates, authorises, executes and records the resulting operations. Neither model output nor external content bypasses that boundary. The interface asks for a decision only when information, authority or the applicable workflow genuinely requires one.

**Activity (R1.3, R11.2).** Zobba reports meaningful activity (what it is doing, to which object) beneath its reply, not every tool call. One current step; no percentages; "Step x of y" only for genuinely fixed procedures; counts only when real ("1,516 accounts compared"). Streaming shows status, never a verdict: a draft streams as drafting; a candidate finding appears with its status after self-review; nothing streams as verified. New activity is indicated without forcing scroll or focus away from what the person is inspecting.

**Guidance versus Stop (R1.4, P4, P5; 4b §5 row 1).** Guidance typed while a step runs is acknowledged "Guidance queued for the next step" and, at the next step boundary, "Applied your guidance · …". Guidance that conflicts with completed work is named in the conversation with a question whether to redo it. Stop is a separate control, always reachable. Pressing Stop shows the transient **Stop requested** state (working mark, "Stopping after the current step…") until cessation is recorded; only then does the execution chip read **Stopped by you** and Zobba say what was kept. A completed external effect is never described as undone.

**Clarification (R1.5, P9; 4b §5 row 16).** A question is asked only when the answer changes the work. One question per turn is a presentation default, not a prohibition: two tightly related details may be asked together; never a question-by-question wizard. Suggested replies plus free text ("Or reply in your own words"); the paused step is named. A suggested reply submits its text as the answer. A contextual free-text answer resolves the open clarification it answers: the application records it against that question and resumes after validation. An instruction inside a source document closes no wait.

**Exact controls remain** for external-effect confirmation, independent approval and the other decisions that require them; an explicit authorised "remember this preference" is its own retention confirmation.

**Workspace appears when useful (R2.1–R2.3; Q7 as amended).** The panel opens when there is something to inspect and closes without losing the conversation. Pin · Expand · Close and a "From [task]" source line are always in its header. **Protection:** pinned content, focused or selected content, and material the auditor explicitly opened stay protected while being inspected; quiet reading is inspection. Thirty seconds is a protective heuristic, not permission to replace content at second 31. New content then arrives as a card in the conversation ("Working data · Open").

**Browser (R2.4; 4b §5 row 11).** Browser sessions are **read-only on client systems**. Any write permitted by Permissions is a write-output to a permitted output location, never a source. "Take over" is the existing controller lease: control passes to the auditor and Zobba pauses until it is handed back. Transferring control of another person's running task or Run needs `run.control-transfer` (§7).

**Select a statement and ask (P6).** Selecting a statement in an artifact shows a "Selected · [location]" tag above the auditor's message; the answer carries citations.

**Evidence (R4.1–R4.4).** Every conclusion and result in an artifact is traceable: claim → citation → preview → full evidence → back to claim. Evidence shows readable identity first (source, location, what it supports), technical provenance behind Technical details. The originating claim stays highlighted and recoverable while evidence is open; Esc returns focus to it.

**Changes (R5.1–R5.5).** A direct edit the auditor requests on a draft saves as a new draft ("Draft 2 saved · View changes · Undo") with no approval ceremony. Undo restores the previous draft as a new version; nothing is rewritten. **Zobba proposes; it never silently changes a conclusion**: changes Zobba originates are offered for acceptance. The diff is typographic (struck and underlined, no red or green). Changes to **approved or issued** work create a new version that returns to review, the approved version preserved. The Changes summary counts edits and additions and names changed limitations and conclusions.

**Permissions (R6.1–R6.5).** The term is Permissions, never Mandate; "access" keeps its audit meaning (user access in the audit). The at-a-glance summary is two sentences plus View permissions, on the engagement, in the composer chip and in the confirmation footer; its wording reflects the engagement's configuration, never a universal grant. The detail view presents Effective Permissions in seven sections: **Can read** (read) · **Can write** (draft; write-output to working copies and drafts) · **Asks first** (external-effect and confirm-required) · **Never** (source mutation and Permissions Policy exclusions) · **Scheduled checks** · **Connections** · **Administrator limits**, plus Change permissions and the **Activity record**, which answers "What did Zobba actually do?" with each external action's decision basis and actual outcome. No tokens, no OAuth scopes, no locks or shields.

**One decision surface (R7.1–R7.5; D-4-2).** The gate determines whether a confirmation is required; the action's consequences determine its presentation and weight. Zobba asks only at meaningful boundaries (anything that leaves Zobba or changes something outside working copies). One decision surface per decision, in the conversation, with every material detail (what will happen, sender, recipient, content and attachments, date, time and time zone, calendar and invitees, destination), drafts open beside it, and action-specific labels **Allow and send · Edit first · Don't send**. Never a card followed by a dialog repeating it. A change to any material detail invalidates the decision and re-presents the surface ("Details changed since you last saw this"). Outcomes are reported **per operation**, even when approved together. Ordinary drafts carry no blanket approval requirement.

**Review (R8.1–R8.2).** Review is a named human act; Mark as reviewed records the reviewer and time; review status is shown separately from assessment and execution. Marking as reviewed neither approves nor issues (FR-96).

**Scheduled work (R9; 4b §5 rows 2, 13, 17).** Promotion starts from the task menu or from saying "run this monthly"; schedule details may be proposed from the conversation and confirmed compactly; a mandatory schedule form is not the primary workflow. Both entries reach one promotion path: a reviewed method artifact is constructed by selection, compiled, submitted, independently approved and activated, and the Permissions Version is frozen at approval. Until then the check shows **Awaiting approval**. Eligibility is a valid promotable-method specification, suitable evidence and validation, supported execution steps, Permissions and the required approvals (Q8 as decided). **Unattended execution** cannot authorise itself or perform prohibited effects; it may meet a supported clarification, a review requirement or a recovery condition and then pauses or stops truthfully under its execution contract; notifications route the matter to the responsible person; no response is invented because nobody is watching. Results lead with a readable conclusion, then Exceptions · Coverage · Evidence · How it ran. "Completed" is execution, not assessment; "Didn't run" is an execution state with no assessment.

**Search (R10).** Scope-aware ("All authorised work", one client or one engagement); results grouped by client · engagement; client contexts never merged; a task started from a result works inside that result's engagement only. A stale or incomplete index is stated in the results; a partial result never looks complete.

**Honest state (R11).** An unavailable query never looks empty; a partial read never looks complete; an uncertain external action never looks definitely failed or definitely done. Limitations are recorded as found, referenced L1, L2 and carried into the artifact. Unknown information stays explicit and constrains what depends on it; it never stops useful authorised work.

**Model and effort (4b §6, FR-91–FR-93).** The composer's model chip offers only what administrator policy, the engagement's disclosure restrictions, required capabilities and execution limits permit; unavailable choices are shown disabled with their reason and never hidden where the auditor would expect them. The effort control shows only the choices the selected model supports; an unsupported choice is unavailable or explicitly remapped before use, never silently ignored. A change applies to future model invocations from a safe step boundary and is noted in the activity; it never regenerates completed work, repeats completed operations or modifies earlier records. No automatic task-based routing is implied. Requested and actual configuration is recorded per model invocation and shown in How it ran and the Activity record, not on artifact pages. Higher effort grants no additional budget and no stronger evidential status.

**Voice and copy (R12).** §10 carries Voice and Tone; §11 carries the exact-copy set.

## 4. Component patterns

Behavioural. Visual specifications live in `DESIGN.md` and COMPONENT-INVENTORY.

**Kept from the 2026-09-01 spine:** Status badge, Conclusion triptych, Gate checklist, Grounding inspector, Provenance chain, Evaluation card and confirmation, Confirmation dialog weights (per D-4-2; on the retained Run path), Untrusted-content rendering for retrieved content, Empty state, Identifier, Timestamp, Reference, Technical details, Banner, DataTable. Their behavioural rules are the old spine's.

**Default reading view and inspection view** (Proposal 4 U4, extended with the pack):

| Pattern | Default | On inspection |
| --- | --- | --- |
| Conversation thread | Chronological, attributed entries; auditor messages on a Linen bubble, Zobba's replies unboxed; routine work summarised in audit words with grouped low-level steps; questions and decisions clearly placed, several outstanding ones listed, none pinned over the composer. | Each step's sanitised arguments, outcome in readable words, receipt, timing. |
| Composer | One input for intent, guidance, questions and answers: text area, + (sources, files, context, skill), context chips (engagement, Permissions, attached sources), model chip, Stop while working, Send. Placeholders by state: "Describe what you want to check, analyse or prepare"; "Add guidance or ask a question" while working; "Answer, or give other guidance" while a clarification is open. Disabled only when no engagement is permitted or the execution environment is unavailable, with the reason. | — |
| Model chip | "[Model] · [Effort] ▾"; menu with name, provider and short note; unavailable models disabled with the reason; effort as a segmented control of the choices the model supports. | Requested and actual configuration per invocation in How it ran. |
| Pair mark | One animated mark per view region, always beside activity text; states idle · working · waiting · complete; never a bullet, avatar, loader or result indicator. | — |
| Presence chip | Working mark plus "Zobba is …"; waiting mark plus "Zobba needs your input" or "Zobba needs your permission". Never carries a result. | — |
| Activity list and summary | 16px glyph column plus text: completed steps ✓; the current step with the working mark, a 600-weight line and a detail line with Inspect and Technical details; limitations ◐ with their L-reference; "Next: …". The summary above the composer shows the current step and open items. | The full step list per task; canonical states mapped to readable labels (a write to an output folder is "Saved to the Drafts folder"); internal vocabulary (`write-output`, `unknown-after-dispatch`, `empty-under-contract`, `refresh-unresolved`) appears only here and under Technical details. |
| Workspace panel | Header: title, "From [task] · state", Pin · Expand · Close. Types: working data, browser, document, artifact, evidence, changes, draft correspondence, scheduled-result detail. | — |
| Working-data view | Filter chips, a professional audit table, a footer count ("Showing 6 of 23 leavers · 1,516 accounts compared"); unmatched records grouped "Unmatched · n" with a reason, neither red nor hidden; limitation cells "◐ L1". | Row-level provenance. |
| Browser view | URL bar, back and forward, Take over, page content; header states read-only on client systems; footer states what is being captured. | Capture records. |
| Changes view | Typographic diff; changes summary naming changed limitations and conclusions. | Version lineage. |
| Draft-correspondence view | The drafts beside their decision surface, editable after Edit first. | Material-details binding. |
| Artifact (panel and page) | A readable working paper, report, table or analysis in the firm template. Citations as unobtrusive marks; material limitations visible in the header and where they apply; pending, contradicted or disputed matters given clear, accessible emphasis; supported claims carry no inline badge. Provenance footer "Prepared with Zobba · draft n · ref" on by default, firm-controlled (Q3), never implying a review or sign-off that did not happen. Overlays (selection, citations, diff, review notes) are not exported. | **Review mode**: a focused list of matters needing review, each opening its claim with class, support status, citations, validation records and lineage; decisions with their revision binding. |
| Citation (E-reference) | A chip naming the evidence ("E6", "E6.2"); hover previews after 300ms; click opens the evidence at its locator in the drawer with the originating claim kept in view and **Back to claim**. | Provenance class, acquisition date and account, extraction limitations. |
| Limitation (L-reference) | An inline activity line "◐ … · recorded as limitation L1", carried into the artifact; a dashed neutral callout on narrow screens so it stays visible. | The limitation record. |
| Evidence drawer | Header (id · "cited in …", title, Back to claim); identity grid (Source, Location, Captured, Supports); excerpt with the region highlighted; Open full source; Technical details; other evidence in this task. | — |
| Result and quality summary | One truthful sentence ("The analysis finished. Three exceptions are supported, but the full population has not been established."). | Execution, input and coverage (each dimension, `unknown` shown as unknown), assessment and review, separately. |
| Decision surface | §3; the confirmation card with a material-details grid, Allow and send (Graphite primary), Edit first, Don't send, and a Permissions footer; no auto-focus on Allow. For a reconciliation, only the recovery actions the state permits. | The bound details' provenance, the gate outcome, the receipt. |
| Suggested replies | Pill chips that submit their text as the answer. | — |
| Permissions summary and detail | Two sentences plus View permissions; the seven sections, "Set by … on …", Change permissions, Activity record. | Effective Permissions per operation, budgets, ceiling. |
| Connection card | Provider, account identity, readable names of designated resources with location context, state in words, one action. **Accounts, granted capabilities and permitted locations are shown as three things; consent alone makes nothing usable.** Fixed sentence: "A connection lets Zobba reach a system. It doesn't grant every resource in it: engagement permissions and the system's own access still apply." | Canonical identifiers, disconnect consequences. Never tokens or OAuth scopes. |
| Method and promotion | The selected steps, inputs, checks and criteria as a readable method; Submit for approval. | Compiler mapping, unresolved issues, acquisition rules, schedule, responsible person. |
| Scheduled result | RS 13 anatomy (§2); the one-sentence summary and separate chips; supported exceptions listed. | The dimensions separately; "Why inconclusive" opens the Gate checklist. |
| Reviews queue | Grouped Waiting for your review · Returned with your notes · Reviewed recently; columns item, preparer, state chips, submitted date; an unattended result shows its assessment chip separately. | — |
| Review note | Anchored to a location in the paper ("On L2"), with author and state (draft or sent), in a column beside the page; focusing a note highlights its anchor; not exported to ordinary client-facing renderings. | Author, exact version and location, response, disposition. |
| Review action bar | **Return with n notes** · **Mark as reviewed**, helper "Marking as reviewed records you and the time. Approval and issue are separate steps." Zobba's checks for the reviewer are shown as checks, never as approval. | — |
| Memory | An explicit instruction shows "Remembered for your preferences" inline with a link to inspect or correct; an inferred item shows a proposal with scope, source and reason and Confirm / Reject / Edit scope. | Verification status, effective dates, supersession. |

Source locations by type (R4.3) are the display rule for every citation, drawer and review-note anchor: spreadsheet (file › sheet › rows or cells); PDF (file › page, highlighted region); document (file › section › paragraph or table); email or message (sender, date, subject › quoted passage); image (file › highlighted region); system record (system › record id › fields); browser capture (site › page › captured time, highlighted element).

**Design gaps — to be designed under the pack's rules before their story** (Proposal 4b §4, §10). Each is a requirement, not an optional item; Proposal 4's rule for each stands until then:

| Gap | Governing rule |
| --- | --- |
| Memory cards: "Remembered for your preferences", proposal cards, scope and verification status, retirement | U4 Memory row above; 3c C10 |
| Draft engagement without a client; the client-binding moment | 3a C2; §6 "Client not selected" |
| Needs another look flag and impact records on artifacts | 3b C7; a flag, not a state (§5) |
| The reconcile decision surface (keep observing · mark done with reference · retry with duplication warning · abandon) | 3a C2; §6 unknown-outcome sentences |
| Draft sharing versus issuance; PDF export | §1; 3b C7 |
| Promotion review with **Awaiting approval** and **Pending regression** | 3c C12; §5 scheduled-check states |
| Regression case sets and a version pending regression | 3d D-3d-1 |
| Retention decisions, holds, deletion (Data and retention is named, not designed) | 3b C5 |
| Tenant switching for a person in two firms | 3a C1 |
| Legacy procedures view | §12 |
| Invitation create and accept | FR-95; Flow K |
| Model replacement proposal for a scheduled check | FR-93 |
| Organisation connections | deferred (D-4b-3); no screen, no empty section |

## 5. Status system

Six separate dimensions (Proposal 4b §3; DESIGN-SYSTEM §6), replacing Proposal 4 U5. They never merge into one chip; every chip has a glyph and a word; colour is never the only cue; brand presence never implies an audit result.

| Dimension | Readable states | Approved internal state it presents |
| --- | --- | --- |
| Execution | Not started · Running ("Zobba is …") · Stop requested (transient) · Paused · Stopped by you · Completed · Didn't run · Interrupted | Agent Task and Run lifecycle (3a C2, Run path). `Stopped by you` appears only once cessation is recorded. |
| Wait | Needs your input · Needs your permission · Queued (guidance) | `clarify`, `confirm-action`, closed-option waits; guidance is a queued message; `reconcile` shows as "Needs your input · reconciliation". |
| Input and coverage | Complete · Partial (L-reference) · Unavailable · Stale · Unknown · Out of period / Not applicable | `input-quality-v1` dimensions (availability, coverage, freshness, period relevance). The summary chip is derived; it never removes a dimension or implies an unestablished population is complete; expanding it shows each dimension. |
| Audit assessment | No exception · Exception(s) · Inconclusive · Not assessed | Result outcome (`run-result-v1`) and artifact assessment. |
| Review and issue | Draft · Not reviewed · In review · Returned · n notes · Reviewed by [name] · Approved · Issued · Superseded; on a scheduled check also Awaiting approval · Pending regression | `artifact-version-v1` lifecycle records, with `review-requested` (shown "In review") and `returned` (shown "Returned · n notes") added; content stays immutable per version. Reviewed by, Approved and Issued always name the person and date. |
| Connection | Connected · Connecting · Limited · Needs reconnecting · Disabled · Error · Not connected | `connection-v1` (`active`, `pending`, `disabled`, `revoked`, `refresh-unresolved` → Needs reconnecting). |

**Flag, not state:** Needs another look (an artifact whose basis changed; §6).

**Scheduled-check states** (DESIGN-SYSTEM §10 plus 4b §5 rows 2–3): Active ("Active · Mondays 06:00"); Paused ("‖ Paused by you, 2 Oct", no next run); Next run (date and time with time zone); Running ("Zobba is running this check"); Waiting for input (with the reason); Completed (then the assessment chip, then the review chip, as separate chips); Inconclusive (◐ dashed assessment chip); Didn't run (✕, the reason and the recovery action, no assessment); Review pending (○ Not reviewed, then "Reviewed by [name] · date"); **Awaiting approval** and **Pending regression** (no next run while either holds).

**Inspection and review mode only, never default chips:** claim support (Supported · Not yet supported · Contradicted · Awaiting review · Cannot be checked automatically); action outcome per operation (Sent · Sent, not confirmed · Confirmed · Blocked · Failed before sending); data quality per acquisition (Complete · Partial · Empty, as the source states · Unknown).

**Memory item vocabulary** is fixed when the memory screens are designed (§4); Proposal 4 U5's list (Proposed · Remembered · Replaced · Declined · Retired; secondary: reported by you · supported by a source · disputed · awaiting verification) is the input to that design `[TO DESIGN]`.

**Retained Run-path families** — Procedure Version, Run lifecycle, Evidence Quality Gate, Result outcome, Auditor Review, Exception, Evaluation origin, Work Item — keep their states and transitions and live in `DESIGN.md` revision 2; their behaviour on the retained surfaces is the 2026-09-01 spine's (§12). A scheduled-check Run is presented through the six dimensions; its Run Detail keeps the Run-path families.

## 6. Per-surface states

Every sentence depends on the **recorded state**, not the broad error category. Every empty state names what would appear and what its absence means. Every unreadable read is a Banner, never an absence. No optimistic update: a displayed outcome matches the authoritative state.

| Surface | State | Sentence rule |
| --- | --- | --- |
| Engagements | none | "No engagements yet. Start a conversation to begin." |
| Recent tasks | none | "Tasks you start appear here." |
| Scheduled checks | none | "Turn a finished task into a scheduled check from its menu." |
| Workspace | draft, client not selected | Header "Client not selected"; the agent's first reply names what it can reach now and what needs a client. |
| Workspace | read interrupted | "The read did not complete. Material already acquired has been preserved, but coverage is incomplete." Then the remedy the recorded cause supports: Reconnect for an authentication problem; Retry for a temporary failure where retry is safe; Continue with the limited material where permitted. |
| Workspace | connection unavailable | "I can't reach AccessGate right now, so I haven't read the sign-in history." + Retry (pattern; never looks like "no sign-ins"). |
| Workspace | source incomplete | Limitation line (◐ L1) + what is missing; the fixed pattern "I can't treat [source] as the complete population yet." |
| Workspace | unsupported content | "I couldn't read the scanned pages 5–7 of this PDF." + options (pattern; never skipped silently). |
| Workspace | self-review could not complete | "I couldn't finish validating the conclusions. Here's what I checked and what's left." The draft stays a labelled draft with its limitations. |
| Workspace | execution environment unavailable | "Zobba can't run tasks at the moment. Nothing has been sent or changed." + Technical details. |
| Workspace | task interrupted | "This task stopped at 'Comparing…'. Work so far is saved." + Resume (pattern; never restarts silently). |
| Workspace | Stop pressed, cessation not yet recorded | Working mark, "Stopping after the current step…"; execution chip Stop requested. |
| Workspace | stopped | Execution chip Stopped by you; Zobba says what was kept ("Stopped. Work so far is saved: …"). |
| Workspace | guidance | "Guidance queued for the next step", then "Applied your guidance · …". |
| Workspace | before an external action | "I need your permission before sending these." with the decision surface. |
| Workspace | decision declined | "Nothing was sent." (P10); where nothing at all was sent or changed, "Nothing has been sent or changed." |
| Workspace | operation succeeded | Per operation ("Sent to Chipo Zulu at 15:06." pattern). |
| Workspace | failed before sending | "The invitation wasn't sent: Outlook rejected it. Nothing was sent to Chipo." + Retry (pattern). |
| Workspace | partial | Each operation's own outcome ("The email was sent at 15:06. The invitation failed: the time conflicts with a room booking." + Edit invitation, pattern). |
| Workspace | **unknown after dispatch** | "The send request was attempted, but its outcome has not been confirmed. Check the operation's status before retrying." No generic Retry while duplication remains possible. |
| Workspace | **provider accepted, delivery unconfirmed** | "The provider accepted the message for sending. Delivery has not been confirmed." |
| Workspace | effect awaiting reconciliation | "The invitation may have been created. The provider did not confirm. This is waiting for reconciliation." Only the permitted recovery actions; a retry that may duplicate says so and is never presented as safe; a human resolution is recorded as a human resolution. |
| Workspace | action blocked | "This attempt was blocked before sending." only where the receipt shows no dispatch; any earlier unresolved attempt stays visible beside it. |
| Workspace | budget reached | "The task reached its budget. What was produced is kept as a draft with its limitations." |
| Workspace | task waiting | The question is listed with the others; unrelated work continues. |
| Composer | model unavailable | Shown disabled with its reason from the disclosure or model policy (for example "Not available here: Northstar data must stay in the EU", illustrative). |
| Composer | model change mid-task | Activity notes the switch from the next step (for example "Switched to GPT-6 Sol · High from the next step", illustrative). |
| Composer | policy revoked before the next call | The call is blocked with its recorded cause, shown as the execution state with its reason. |
| Artifact | matters needing review | Header "2 matters need review"; the approval control states whether the methodology permits approval with limitations. |
| Artifact | Needs another look | The impact record's reason and the version it came from; "Reviewed, unchanged" and "New version" are the two ways out. |
| Artifact | rendering blocked | "This document cannot be approved: the evidence screenshot on page 4 is missing from the rendering." Blocking defects listed; harmless limitations under Technical details. |
| Artifact | In review | Review and issue chip In review; the submitted version is fixed. |
| Artifact | returned | "Returned · n notes"; the returned version is unchanged; the notes stay with the next submission. |
| Approval | independence refused | "You cannot approve a version you authored or contributed to." |
| Approval | review context changed | Names the recorded change — a newer version exists, the approval context changed, the rendering changed, a permission expired — and keeps the previously reviewed version open; the latest draft is never substituted silently. |
| Scheduled run | incomplete input | "The check ran, but the application user list was incomplete. The assessment is inconclusive; the three supported exceptions are listed." Expanding shows execution, input, assessment and review separately. |
| Scheduled run | access failure | "The leavers export could not be read: the Drive connection has expired. The check did not run against it." Recovery request to the responsible person. |
| Scheduled run | material change | "The source folder moved outside the approved location. This check needs re-approval before it runs against it." Link to the platform-authored draft. |
| Scheduled run | unattended run meets a decision | Pauses or stops truthfully under its execution contract; the notification routes the matter to the responsible person; nothing is answered on anybody's behalf. |
| Scheduled check | model withdrawn, retired or policy revoked | The execution state with its recorded cause (the three causes are distinct); a replacement is a proposed configuration change awaiting approval and regression `[TO DESIGN]`. |
| Scheduled check | Awaiting approval / Pending regression | The state chip; no next run. |
| Notification | unattended result | "Zobba completed the [check name]" with the assessment in words (for example "Zobba completed the weekly leaver check · inconclusive"). In-app only in this release. |
| Attention view | loaded, empty | "Nothing needs you. Questions, confirmations, reviews and proposals will appear here." |
| Attention view | not loaded | Banner: "Couldn't load what needs you. Nothing has changed." — never the empty state. |
| Search | empty | Recent searches. |
| Search | loading | Per scope ("Searching Northstar Bank…"). |
| Search | no results | "No results in authorised work for 'x'", with the scope named, and a broaden-scope link. |
| Search | incomplete or stale index | "▲ [source] results may be incomplete…" + Reconnect; a partial result never looks complete. |
| Connections | none | "No accounts connected. Connect one to let the agent read the resources you choose." |
| Connections | needs reconnecting | ▲ with the reason and the consequence ("Search results and the daily change log check are affected"). |
| Connections | organisation connections | No empty "Organisation connections" section is shown; the label is reserved (D-4b-3). |
| Methodology | no pack | "No methodology configured. You can converse, read permitted files and analyse now; ratings, formal outputs and recurring checks need a methodology." with Select a starter pack / Prepare one from your documents. |
| Invitation | created | Invited, with Copy invitation link; expiry shown in words `[TO DESIGN]`. |
| Invitation | expired · revoked · refused (wrong recipient, replayed, already used) · inviter no longer authorised | Each refusal names its recorded cause; a forwarded link confers nothing `[TO DESIGN]` for exact sentences. |
| Users and roles | last active Admin | Removal or demotion refused; a pending invitation is not an active replacement `[TO DESIGN]` for the sentence. |
| Any | background work after access removal | Refused with a reason on dispatch, resume or retry `[TO DESIGN]` for the sentence. |
| Any | unknown information | Unknown stays explicit; work continues where the missing fact does not prevent useful authorised progress; dependent conclusions and actions stay constrained; Zobba asks or records a limitation when required. |
| Any | deadlines | Date, time and time zone in words ("by Friday 3 October, 17:00 UTC"); a live countdown only for waits under an hour; action validity shown separately from the response deadline where they differ. |
| Any | cold load | Skeleton rows in tables; activity text in conversation; no spinner with the Zobba mark; no counts until loaded. |
| Any | permission denied | Action visible, disabled, reason stated as helper text and as its accessible description — never tooltip-only, never colour or disabled styling alone. |

The Engagements empty sentence is Proposal 4 U6's; the pack's alternative ("No engagements yet. Your administrator adds engagements, or you can start a task without one.") is not adopted because the approved model creates a draft engagement from a first request (§13).

## 7. Roles and action gating

**Every ✓ means the named role plus current membership, the applicable capability, ownership or delegation, and resource scope; a global role alone reaches nothing.** A pack may require stricter review within supported capabilities, never weaker; an unsupported stricter workflow is blocked. Roles are application-owned, read on every request, never cached. Preparers may inspect, self-check and revise their own work; they cannot satisfy a required independent review or approval of work they authored or substantively contributed to. Review, approval and issuance are separate attributable decisions; the same eligible independent person may satisfy review and approval where the methodology permits, and one review interaction may record both. Role changes cannot erase authorship or contributor history. Admin authority alone confers no audit-review, audit-approval or issuance right; methodology approval is configuration approval, never approval of audit work.

The denial sentences below are quoted verbatim and include the retained compiler-1 sentences pinned by on-disk tests; sentences naming "PoC Administrator" and "Audit Manager" keep that wording until the rename story (D-4b-1) moves them with their tests.

| Action | Auditor | Audit manager | Admin |
| --- | --- | --- | --- |
| Start a conversation, direct tasks, answer questions, confirm bound actions within own Agent Permissions | ✓ | ✓ | — "PoC Administrator cannot direct audit work." |
| Choose model and effort within policy (FR-91) | ✓ | ✓ | — |
| Create, revise and self-check working artifacts; submit for review | ✓ | ✓ | — |
| Review an artifact version: add notes, Return with n notes, Mark as reviewed | per methodology; never own or contributed | ✓ unless author or contributor | — |
| Approve an artifact version under its methodology | per methodology; never own or contributed | ✓ unless author or contributor: "You cannot approve a version you authored or contributed to." | — |
| Issue a deliverable | per methodology | ✓ where a member with issue authority | — |
| Share a working draft to an authorised destination | ✓ within Agent Permissions | ✓ | — |
| Review a method artifact | per methodology | ✓ | — |
| Approve a Procedure Version (compiler-2, promotion) | — "Only an Audit Manager can approve a Procedure Version." | ✓ unless author or contributor: "You cannot approve a version you authored or contributed to." | — |
| Connect own accounts, choose designated resources, disconnect | ✓ | ✓ | ✓ (own) |
| Set an engagement's Permissions within the ceiling | ✓ (member) | ✓ | — |
| Set the administrator ceiling, disclosure policy, model policy and connection policy | — | — | ✓ |
| Confirm a memory proposal | scope owner or delegate | scope owner or delegate | methodology-scope knowledge promotion only; never another person's preference, engagement or client item |
| Create, maintain, approve, activate and retire methodology packs, skills and templates (configuration approval, never audit approval) | propose from documents | propose from documents | ✓ versioned and audited; creator, maintainer and approver recorded; cannot bypass a platform safeguard, an independent approval or a client or engagement restriction; approved checks keep their pack version |
| Transfer control of a running task or Run | — | ✓ with `run.control-transfer` | — |
| Manage users, systems, sources | — | — | ✓ |
| Create, copy and revoke invitations; remove a person from an engagement or the tenant (FR-95) | — | — | ✓ |
| **Retained compiler-1 Run path** (§12): Author Procedure, submit version, Initiate Run, pause/resume, cancel, answer Escalation, flag to Audit Manager | ✓ | ✓ | — "PoC Administrator cannot author Procedures or start Runs." |
| Retained: Confirm / reject Agent-Judged evaluation, assign and disposition Exceptions, annotate, submit Result | ✓ | ✓ | — "PoC Administrator cannot alter evaluations, Results, or reviews." |
| Retained: Approve / reject compiler-1 Procedure Version | — "Only an Audit Manager can approve a Procedure Version." | ✓ unless author: "You cannot approve a version you authored." | — |
| Retained: Approve / reject / finalize Result, record disagreement | — "Only an Audit Manager can approve a submitted Result." | ✓ | — |
| Retained: Export Workpaper Bundle | ✓ | ✓ | — |

Review notes and return are the reviewer's (FR-96): a reviewer is the person holding the review responsibility on the engagement, within the Audit manager role unless the methodology names otherwise. **Reviews** is shown by review responsibility and capability, not by role label. RS 23's invitation choices offer Auditor, Audit manager and Admin only.

## 8. Key flows

Each flow names the decision points a person meets and nothing else; everything else is the harness. Flows are generic. The acceptance scenario (Proposal 6: Lumina Assurance auditing Northstar Bank plc, synthetic data, Google Drive, Gmail and Calendar connectors) walks them; reference-screen names are illustrative.

- **Flow A — Start and state the objective (P1, P2, P16).** Home's composer (or an engagement's) → the auditor writes the objective → a conversation opens at once with a provisional, renameable title → Zobba replies with what it found, assumed and needs, and proposes a plan the auditor can edit in the panel. Continue and Recent tasks reopen a task at its last state with a pinned panel restored (P2); a Search result starts work inside that result's engagement (P16). Decision points: selecting a client when Zobba needs client material.
- **Flow B — Connect authorised resources (P15).** Connections, or the conversation when a connection is needed → provider consent → back with the account, capabilities and readable designated resources shown as three things → return to the work. Connections are user-owned (D-4b-3). Decision points: consent at the provider; designated resources. Failure: a connection needing reconnection lists the affected items and offers Reconnect.
- **Flow C — Follow the work (P3, P4, P5, P9, P17).** The activity summary shows the current step in audit words; questions and unresolved actions are listed; guidance is queued then applied; Stop shows Stop requested until cessation is recorded; a clarification is answered by a suggested reply or free text; the model chip changes future steps only; View workspace opens the live browser, read-only on client systems, with Take over as the controller lease. Leaving and returning restores the conversation, selected artifact and pending decisions from durable state.
- **Flow D — Inspect and correct an artifact (P6, P7, P8, P14).** A candidate finding → the panel in reading view → review mode for the matters needing review → a citation opens the evidence with the claim kept in view and Back to claim → the auditor selects a statement and says what is wrong → Zobba proposes a new draft with the change and the affected dependents ("Draft 2 saved · View changes · Undo") → the auditor accepts → a memory proposal appears if Zobba inferred one. Approved or issued work returns to review as a new version.
- **Flow E — Memory (no pack pattern; `[TO DESIGN]` per §4).** "Remember…" shows Remembered inline with a link; a proposal is confirmed, declined or rescoped from the thread or the attention view.
- **Flow F — Independent approval (P11, P18).** Request review → the reviewer opens the version from Reviews → reading view, then review mode → one decision surface: Approve version, with rationale where the methodology requires → bound to the revision; an author or contributor meets "You cannot approve a version you authored or contributed to."
- **Flow G — Promote to a recurring check (P12 as amended).** "Run this monthly" in conversation, or the task menu → Zobba proposes the method by selection and the schedule compactly → the readable method view → Submit for approval → the check appears under Scheduled checks as **Awaiting approval** (Pending regression where required) → a second person approves → the check shows Active with its next run and responsible person. The Permissions Version is bound at approval.
- **Flow H — A scheduled run nobody watches (P13, P14, P15).** The run executes unattended; a result that needs attention reaches the attention view and an in-app notification with its one-sentence summary; an ordinary completed run appears under Scheduled checks and history; the auditor reads the conclusion, expands Exceptions, Coverage, Evidence or How it ran, and chooses Mark as reviewed, Discuss this result or a suggested follow-up through the decision surface. Access failures, material changes and decisions met while unattended carry their §6 sentences.
- **Flow I — Failure, uncertainty and refusal (P9, P10, P14).** The §6 sentences in situ: per-operation outcomes, the two unknown-outcome patterns, reconciliation, blocked attempts beside earlier unresolved ones, budget reached, interrupted reads.
- **Flow J — Administration (P19).** Settings › Administration: Users and roles; Models and providers; Connections policy; Administrator limits; Data and retention; Audit log; Systems and Sources; Methodology and skills (packs, skills and templates activated as audited configuration acts); invitations (Flow K); legacy procedures reachable by their auditors, never administrator-only.
- **Flow K — Invite and remove a person (FR-95, P19).** Admin → Users and roles → Invite people → recipient, tenant role (Auditor, Audit manager, Admin) and any proposed engagement access → Create invitation → Copy invitation link → delivered outside Zobba (never by the agent through someone's connected mailbox; email delivery is a later capability) → the recipient signs in with an identity verified as the intended recipient → acceptance checks the invitation's validity and the inviter's current authority → membership. Failure: wrong recipient, expired, replayed and revoked invitations refused with their cause; an inviter who lost authority before acceptance refused. Removal distinguishes removal from an engagement, removal from the tenant and a separate account action; other tenant memberships stay; revocation applies to subsequent requests and to agent dispatch, resume and retry; already-dispatched external actions keep their reconciliation path; the last active Admin cannot be removed or demoted. Screens `[TO DESIGN]` (§4).
- **Flow L — Review with notes and return (FR-96, P18).** The preparer submits for review (In review) → the reviewer opens Reviews → Waiting for your review → the paper, reading view then review mode → asks Zobba about the paper (answers carry citations; Zobba's checks shown as checks, never approval) → adds notes anchored to locations → **Return with n notes** → the preparer sees Returned · n notes, responds and revises → a new version is submitted with the earlier notes and history preserved → **Mark as reviewed** records the reviewer and time → approval and issue follow as separate steps (Flow F). Unresolved substantive notes stay visible under the methodology's rules; notes are absent from client renderings and present in an authorised archive export.

## 9. What the auditor sees versus what the harness records

| The auditor meets | The harness records without asking |
| --- | --- |
| an assumption, a question, a coverage limitation, a candidate finding, one decision surface per external action, a correction's consequences, a memory proposal, a review request, a review note, an approval | acquisition records, source snapshots and their quality dimensions, working material revisions, derivations and validation records, execution records, claim classes and citations, support-status transitions, impact records, receipts, ledger steps, requested and actual model configuration per invocation, audit events |

No surface asks the auditor to fill a provenance field, classify an input's quality, approve a calculation, confirm a routine read or annotate a step. Unknown information remains explicit and constrains what depends on it; it never stops useful authorised work.

## 10. Continuity, control, responsive and accessibility

**Continuity and control.**

- Essential task status, open questions, decision surfaces and authorised pause and Stop controls remain usable at every supported width. "Stop requested" is distinguished from confirmed cessation; a completed external effect is never described as undone.
- Leaving and returning restores the conversation, selected artifact and version, task state and pending decisions from their stores. Unsent drafts stay scoped to their engagement. A reconnect never duplicates a submission.
- A waiting task never disables unrelated work; several outstanding questions are organised clearly and none covers the composer.

**Responsive** (DESIGN-SYSTEM §13; 4b §5 row 12):

| Width | Behaviour |
| --- | --- |
| ≥ 1600 | Panel default 600px; conversation reading content capped at 720px and centred in its region. |
| 1024–1599 (reference 1280 × 800) | As specified in §2. |
| 600–1023 | Sidebar collapses to the rail; the workspace opens as an overlay sheet over 80% of the width with the conversation dimmed but visible; evidence opens as a sheet inside it; the live browser view uses a full-screen surface. |
| < 600 | Conversation is the default view; the workspace opens full-screen with a back control; evidence opens full-screen and returns to the claim; the sidebar is a sheet. |

On every size, Stop, open decisions (clarification, permission) and current material limitations stay reachable without scrolling: Stop beside the composer, the decision card pinned above the composer, limitations inline. Below 1024 a live browser view never hides the task's safety controls. Touch targets are 44px minimum. The retained Run-path surfaces keep their own breakpoints and floors until their disposition (§12).

**Accessibility floor — WCAG 2.2 AA** (D-4b-6), with automated and manual acceptance checks, carried into every new flow (model picker, invitation and sign-in, review notes, panel interactions), including 2.2's dragging alternatives (column resize and panel resize have non-drag alternatives), redundant entry, accessible authentication, target size (24 × 24 desktop, 44 touch) and focus visibility. **No allowlist of accepted violations.**

- Status is never conveyed by colour alone: every chip has a word and a glyph; glyphs and the working mark are `aria-hidden` and the text carries the meaning.
- Keyboard order: sidebar → conversation → composer → workspace → drawer; F6 cycles regions; Esc closes the drawer or popover and returns focus to the originating claim. Visible focus ring (2px Iris, offset 2px) on every interactive element, never suppressed.
- **Claim → evidence → return by keyboard.** A citation is a button named in full ("Evidence E6.2, AccessGate sign-ins, Kelvin Chanda"); opening it moves focus to the drawer heading; Back to claim or Esc returns focus to the citation.
- Conversation updates are announced politely at **step granularity**, never per streamed token; permission and clarification requests use `role="alert"` once; the decision card does not auto-focus Allow.
- Reduced motion honoured: working shown level and still, complete without settle, all UI motion instant. **One animated Pair mark per region.**
- Tables: real table semantics, `<th scope>`, `aria-sort`, announced row counts; the row being processed announced as "Matching". Every row's first cell is a link; no row-level click handlers.
- Dialogs (where unavoidable: destructive confirmation in Settings, sign-in; the retained Run-path confirmation weights) are `role="dialog"`, `aria-modal`, titled with the consequence, trap focus, restore it on close and never auto-confirm.
- A disabled action is `aria-disabled` with its reason reachable as its accessible description, never `disabled` alone and never tooltip-only.
- The composer is a labelled textarea; Enter sends, Shift+Enter adds a line; Stop is reachable by keyboard and announces "Stopped" once cessation is recorded.
- Long identifiers wrap; evidence values are never truncated. Untrusted source content is rendered inert and labelled once per block by its source.
- The DESIGN-SYSTEM §14 "must be verified in the implemented application" list (screen-reader streaming, drawer focus return, table virtualisation, keyboard traps in full-screen and browser sessions, 200% and 400% reflow, forced colours, reduced motion) is an implementation obligation.

**Voice and tone** (carried from the 2026-09-01 spine; R12).

| Do | Don't |
| --- | --- |
| "I can't treat [source] as the complete population yet." | "Something went wrong." |
| "Two retained access after exit, supported by sign-ins after the exit date (E6)." | coloured or hedged prose that states no support |
| "Only an Audit Manager can approve a Procedure Version." | a disabled button with no reason |
| "This Run remains unchanged." after every corrective action on a Run | implying a rerun edits history |

- Sentence case everywhere; column headers uppercase by CSS only.
- **Speak in audit tasks** (2026-09-22): every ordinary screen and every activity sentence is in the auditor's language — prepare, test, supervise, investigate, review. No raw UUID as a primary label; no transport, worker, schema or specification-section language in the ordinary view; all of it stays available under Technical details. Avoid implementation terms (token, agent run, tool call, context window, LLM), AI hype and exclamation marks.
- State limitations plainly ("I couldn't establish…"); don't hedge everything; never claim certainty the evidence does not give. Present candidate findings as findings with support.
- Errors say what happened, what was not affected and what to do; diagnostics go under Technical details. Every guard sentence names the object it protects.
- Status is separate questions, not one: execution, wait, input and coverage, assessment, review and issue, connection. "Completed" is never "reviewed"; evidence checks passing is never "the control passed".
- Defined terms: the retained Run-path surfaces keep the 2026-09-01 spine's capitalised glossary terms; conversation-led surfaces use the pack's fixed labels as written.

**Formats** (carried from the 2026-09-01 spine):

- Identifiers — monospace (IBM Plex Mono), strings that keep leading zeros. A UUID is never the ordinary label of a row, a heading or a pill: the row is named by what a person recognises (the engagement, the artifact, the record, the person) with a short reference beside it and the full identifier under Technical details. Evidence displays as E-references and limitations as L-references.
- Timestamps — readable on ordinary surfaces (`21 Sep 2026, 12:24 UTC`; with seconds where events are ordered), the exact ISO 8601 `Z` instant in the element's `datetime` attribute and under Technical details; original offset retained beside the normalized value where a source supplied one. The time zone is named every time; date and time inputs show it ("10:00 CAT (UTC+2)"); scheduled checks show UTC plus the local time.
- Amounts — currency code first, thousands separators, two decimals: `USD 250,000.00`.
- Counts — thousands separators; comparisons as `1,842 = 1,842`; counts with a noun pluralised by the count, never `1 Observations`; never a fabricated total.
- Periods — `2026-08-25 → 2026-08-31`. Durations — `3m 41s`; countdowns `28m 10s left`, only for waits under an hour.
- Absent values — `—`; source nulls as literal `null`; an unknown fact stays "Unknown", never a dash that reads as "fine".
- Technical detail — identifiers, digests, plan-step ids, HTTP methods and status codes live under one closed disclosure labelled `Technical details`, on every surface that has them; the ordinary reading of a surface never meets one first.

## 11. How the experience is tested

- **Exact-copy tests** cover only intentionally fixed product language: the fixed labels and safety-critical message patterns of EXPERIENCE-RULES §12 as amended by Proposal 4b §5 rows 13–14 (the uncertain-outcome pattern is replaced by the two receipt-chosen sentences in §6; the unattended rule is §3's), the status meanings (§5), the connection sentence (§4), the independence refusal and the other denial sentences (§7), standard action labels, and the Banner sentences. They read this spine and `DESIGN.md` off disk.
- **Fixed labels:** Navigation — New task · Search · Scheduled checks · Engagements · Recent tasks · Connections · Settings. Presence — Zobba is reading / analysing / comparing / reviewing sign-ins / preparing the working paper / validating conclusions · Zobba needs your input · Zobba needs your permission · Zobba ran this unattended · Zobba completed the [check name]. Permissions — Permissions · Can read · Can write · Asks first · Never · Scheduled checks · Connections · Administrator limits · View permissions · Change permissions · Activity record. Decisions — Allow and send · Edit first · Don't send · Stop · Undo · View changes · Back to claim · Mark as reviewed · Reconnect. Status — No exception · Exception · Warning · Inconclusive · Not reviewed · Reviewed by [name] · Didn't run · Paused · Needs reconnecting · Guidance queued for the next step.
- **Safety-critical patterns:** "I need your permission before sending these." · "Nothing has been sent or changed." · "I can't treat [source] as the complete population yet." · unknown after dispatch: "The send request was attempted, but its outcome has not been confirmed. Check the operation's status before retrying." · provider accepted: "The provider accepted the message for sending. Delivery has not been confirmed."
- **Illustrative dialogue is never exact copy.** Zobba's explanations and the conversation examples in this spine and in the reference screens are tested for required facts, qualifications, prohibited claims and links to the correct records, never one phrasing.
- **Interaction tests** establish what the person can accomplish, which decisions are required, and whether the displayed outcome matches the authoritative state.
- **HANDOFF §6 checklist** is part of every UI story's acceptance: identity and colour; conversation and activity; workspace, artifacts and evidence; decisions and permissions; honesty; accessibility.
- **Browser and visual acceptance** establish layout, readable hierarchy, focus, scrolling, responsive behaviour and preservation of context. The **six-scene acceptance set**: a new conversation; active analysis; artifact and citation inspection in reading and review modes; a material decision; an uncertain external effect; an unattended scheduled result. It demonstrates that context survives opening evidence, changing panels, returning to a conversation and receiving new activity, and that questions and safety controls stay usable without covering the composer. Representative desktop and narrow-screen mockups, or an equivalent prototype, are reviewed before the shell is implemented; text and class tests alone establish nothing about the working experience.
- **A rendered mockup is not proof** that an integration, security control or execution behaviour works. Permissions enforcement, confirmation invalidation, per-operation outcome reporting and evidence capture are verified in the implemented system.
- **Design-acceptance register** (Proposal 4b §10): the §4 design gaps — memory proposals and Remembered; draft engagement without a client and the client-binding moment; Needs another look and impact records; the reconcile decision surface; draft sharing versus issuance and PDF export; promotion review, Awaiting approval and Pending regression; regression case sets; retention decisions and holds; tenant switching; legacy procedures; invitation creation and acceptance; the model replacement proposal — are each designed under the pack's rules before their story is built. Reference screens 03, 04, 06, 11, 14, 15, 17 and 18 were not individually reviewed in the reconciliation and are reviewed against the six-scene set in the NE-8 review story (8.1).
- **Implementation obligations, not planning-time changes.** The on-disk tests named in Proposal 4 U11 — `copy.test.ts` for the fixed sentences, `status.test.ts` and `tokens.test.ts` for the status system and tokens, `stylesheet.test.ts` for new classes, `roles.test.ts` and `denial-strings.test.ts` for the gating table, the shell and breadcrumb tests for navigation, and the review, runs-list, workspace and administration word tests for their surfaces — move with their implementation stories and the legacy disposition in Proposal 7. Until then they keep reading the 2026-09-01 spine. No application code changes and no test is retired to make the planning documents pass.

## 12. Retained compiler-1 Run-path surfaces

The Builder, Procedure Detail, Version review, Run Detail (five tabs: Result · Evidence · Exceptions · Review · Execution Timeline), Live View and Replay keep the rules of the 2026-09-01 spine (`../ux-IntelliFin Audit-2026-09-01/EXPERIENCE.md`), including its 2026-09-11 and 2026-09-22 owner sections, until each surface's disposition story lands. They are reached through the Legacy procedures view by their authorised auditors and reviewers, never administrator-only. Their per-surface sentences, confirmation weights, state families, breakpoints and denial sentences stay as written there, and the tests that read that file keep reading it.

Run Detail semantics — execution, assessment and evidence checks as separate questions; the Gate checklist; the Result tab leading with the conclusion; Live View and Replay for browser sessions — are reused for scheduled-check Runs reached from Scheduled checks, a scheduled result or the activity view. View workspace generalises Live View's supervision controls to Agent Tasks. An unreadable read is a Banner there as everywhere.

## 13. Open questions

1. **Organisation-managed and shared service connections** — deferred with their own contract (admin consent, service identity, per-engagement availability, their own validation); the label is reserved. **Owner:** Product and architecture.
2. **OS and push notifications** — deferred with the notification-policy contract; the template icon assets are filed for then. Notifications are in-app in this release.
3. **Q1 Kobba comparison, Q2 type-designer drawing, Q9 notification rendering, Q10 accessibility items that need a built product, Q11 trademark and domain clearance** — remain the stated comparison, asset and validation obligations.
4. **Q6 OS icon packaging** — belongs to the selected delivery surface; icon files authorise no native desktop application or OS notification feature.
5. **Location of the Legacy procedures view** in the pack's navigation — reachable from Engagements and Search per §2; the screen is on the design-acceptance register.
6. **Exact sentences** marked `[TO DESIGN]` in §6 (invitation refusals, last-Admin refusal, background work after access removal, model replacement, invitation expiry) — written when those screens are designed, then added to the exact-copy set if they are safety-critical.
7. **Empty-state wording for Engagements** — this spine keeps Proposal 4 U6's sentence; the pack's variant names an administrator adding engagements, which the approved model does not require. Confirm at the NE-8 review.

Decided and no longer open: Q3 provenance footer, Q4 dark mode, Q5 icons, Q7 panel protection, Q8 promotion eligibility, Q12 templates, Q13 models and defaults, Q14 approval step (no Partner or Approver role), Q15 cost visibility (§14).

## 14. Decision log

| Decision | Date | One line |
| --- | --- | --- |
| D-4-1 | 2026-09-24 | Conversation-primary workspace; contextual inspection panel; activity collapsed by default; no three permanent work regions. Navigation later superseded by D-4b-2. |
| D-4-2 | 2026-09-24 | The gate decides whether a confirmation is required; consequences decide its presentation; one coherent decision surface; ordinary drafts need no blanket approval. |
| D-4-3 | 2026-09-24 | Limitations and outcomes in ordinary audit language; internal states and claim classes in inspection and review mode only. |
| D-4-4 | 2026-09-24 | Review organised around the artifact or decision, with claim-level inspection; no approval request per calculation. |
| D-4b-1 | 2026-09-25 | Zobba and Permissions in product and planning language now; technical renaming in one compatibility-tested story; historical records unchanged. |
| D-4b-2 | 2026-09-25 | Pack navigation (New task · Search · Scheduled checks · Engagements · Recent tasks · Connections · Settings); Reviews by responsibility and capability; no first-level Needs you; attention view from the bell. |
| D-4b-3 | 2026-09-25 | User-owned connections in the first release; organisation-managed connections deferred; the label reserved. |
| D-4b-4 | 2026-09-25 | Model and effort choice within policy, recorded per invocation, applied at a safe boundary; no automatic routing; replacement on a check is a proposed change with approval and regression (FR-91–FR-93). |
| D-4b-5 | 2026-09-25 | Three tenant roles; Admin manages methodology as configuration; independence over authors and contributors; invitations and review notes (FR-94–FR-96). |
| D-4b-6 | 2026-09-25 | WCAG 2.2 AA with automated and manual checks; no allowlist of accepted violations. |
| D-4b-7 | 2026-09-25 | Pack open questions decided individually (Q3 on by default, firm-controlled; Q4 light-only; Q5 Lucide 2px provisional; Q7 protection amended; Q8 eligibility by promotable method; Q12 firm templates plus a neutral bootstrap example; Q13 admin-configurable defaults; Q15 detailed cost to administrators). |
| Role consolidation | 2026-09-25 | Owner: tenant roles are Auditor · Audit manager · Admin; no standalone Methodology owner; `poc-administrator` displayed "Admin" until the rename story. |
| Terminology | 2026-09-25 | Owner: Mandate is named Permissions; a terminology change only, every enforcement rule unchanged. |
