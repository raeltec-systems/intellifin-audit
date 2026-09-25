---
title: 'Design-acceptance register and review of the 23 reference screens'
story: '18.2 (NE-8 8.1)'
created: '2026-09-25'
updated: '2026-09-25'
revision: 2
status: 'open — 22 rows open (B1–B16 from Proposal 5 §5; B17–B22 added by the owner), none closed; Part D signed off by the owner on 2026-09-25 as a documentary screen review'
---

# Design-acceptance register

**Purpose.** D-5-6 (Proposal 5, approved 2026-09-25): a surface the Zobba design pack does not cover is designed under the pack's rules and reviewed before the affected user-facing implementation is built. Where a story combines backend prerequisites with an undesigned surface, it is split: the prerequisite part proceeds and the surface part waits for its design review — never a guessed UI, never unrelated infrastructure blocked by an unfinished screen. **This register is a story-entry criterion:** a story part named in Part B does not start its surface work until its row is closed. D-5-4 and D-5-6 also require the pack's 23 reference screens to be reviewed against the six-scene acceptance set before the shell story 18.3 begins; Parts A, C and D are that review, and Proposal 5 §4a lists this record as Slice 0's design item ("The 23-screen review record").

**Date:** 2026-09-25 · **Revision:** 2 · **Owner sign-off:** given on 2026-09-25 for the documentary screen review and its recorded findings, with the decisions in Part D. The sign-off closes no register row and authorises no implementation.

| Revision | Date | Change |
|---|---|---|
| 1 | 2026-09-25 | The review of the 23 screens (Parts A, C), the sixteen rows of P5 §5 (Part B) and six questions for the owner (Part D). |
| 2 | 2026-09-25 | The owner's decisions on Part D items 1–6 applied: rows B17–B22 added (B22 as bounded sub-rows by slice); the `epics.md` gate lines corrected to the surface-part rule; Stop while a task waits; the narrow and intermediate widths rule (B.3); the Engagements empty sentence; the reconciled Settings sections; the design priorities for 18.3 (Part E). |

**Abbreviations.** EXP = EXPERIENCE.md revision 2 · DES = DESIGN.md revision 2 · 4b = Proposal 4b · P5 = Proposal 5 · RS = reference screen · R1–R12 = the pack's EXPERIENCE-RULES · "row n" = 4b §5 row n · Flow A–L = EXP §8 · P1–P19 = the pack's PATTERNS. Story parts use the Epic numbering of `epics.md` (Proposal 7: NE-8 8.x → 18.(x+1), so 8.1 → 18.2; every other NE-n story s.x → Epic 10+n story x).

## Baseline documents

Paths are relative to `_bmad-output/planning-artifacts/`.

| Document | Version used |
|---|---|
| `ux-designs/zobba-design-system-v1.0/` — the Zobba design pack: `reference-screens/README.md` and the 23 PNGs, `HANDOFF.md`, `EXPERIENCE-RULES.md`, `DESIGN-SYSTEM.md`, `COMPONENT-INVENTORY.md`, `PATTERNS.md` | v1.0, 25 Sep 2026 |
| `ux-designs/ux-Zobba-2026-09-25/EXPERIENCE.md` | revision 2, final, 2026-09-25 |
| `ux-designs/ux-Zobba-2026-09-25/DESIGN.md` | revision 2, 2026-09-25 |
| `course-correction-2026-09-24/proposal-4b-zobba-design-reconciliation.md` | approved 2026-09-25 |
| `course-correction-2026-09-24/proposal-5-epics.md` (§4a–§4c, §5) | approved 2026-09-25 at `a762795` |
| `epics.md` (story parts of Epics 11–19) with Proposal 7's numbering | as filed |
| `../implementation-artifacts/18-2-review-the-pack-s-23-reference-screens-against-the-six-scene.md` | the story |

## Standing rules

- **The pack's closing rule (HANDOFF §7), verbatim:** "**A rendered mockup is not proof** that an integration, security control or execution behaviour works. Permissions enforcement, confirmation invalidation, per-operation outcome reporting and evidence capture must be verified in the implemented system." A verdict in this register accepts a screen as a design reference. It never accepts a screen as proof of behaviour.
- **Every reference screen is illustrative, except the fixed labels and safety-critical message patterns adopted as exact copy:** EXPERIENCE-RULES §12 as amended by 4b §5 rows 13–14 (EXP §11 and EXP's precedence paragraph). Row 14 replaces the pack's uncertain-outcome pattern ("I sent the [item], but [system] didn't confirm [delivery]…") with the two receipt-chosen sentences of EXP §6; row 13 replaces the pack's unattended rule with EXP §3's. EXP §11 also treats the §5 status meanings, the connection sentence, the denial sentences, the standard action labels and the Banner sentences as exact copy. Names, the scenario, model names, Zobba's dialogue and example data are illustrative. Each Part A entry lists the exact copy that appears on that screen; everything else on that screen is illustrative.
- **Precedence** (EXP, opening paragraph): the pack is the authoritative visual and interaction specification; where 4b §5, §6, §6a or §7 amended a screen, a default or a sentence, the amendment governs; behaviour and copy follow EXP; visual values follow DES.
- **Accessibility target:** WCAG 2.2 AA for every new flow, with automated and manual checks and no allowlist of accepted violations (D-4b-6).
- **Narrow and intermediate widths (Part D item 4, decided 2026-09-25).** RS 17 and RS 18 are representative references for the initial shell direction. They are not complete responsive acceptance. Every other state below 600 px and at 600–1023 px is designed and reviewed before the surface that shows it is built (B.3).
- **Surface-part rule (Part D item 2, decided 2026-09-25).** A missing design blocks only the story part that builds the surface needing it, from the slice that first needs it. It never blocks a backend prerequisite or an earlier bounded part. The gate lines in `epics.md` follow Part B.
- **Count:** 23 screens are filed. The pack's HANDOFF §1 and README still say 18 (already recorded in DES §8 item 5).

## Verdicts used in Part A

- **Accepted as illustrative reference** — conforms to EXP apart from illustrative content. Its findings are corrections the owning story part applies under the precedence above.
- **Accepted with amendments applied** — an approved amendment (4b §5 row, §6, §6a or §7) changes what the screen shows. The amended reading governs.
- **Not a scene screen** — a supporting surface outside the six-scene set, accepted as the design reference for its owning story part with the amendments and findings listed.

**The six-scene acceptance set** (EXP §11): (1) a new conversation; (2) active analysis; (3) artifact and citation inspection in reading and review modes; (4) a material decision; (5) an uncertain external effect; (6) an unattended scheduled result. Slice gates (P5 §4b): scenes 1–2 at Slice 1, scenes 3–4 at Slice 2, scene 5 at Slice 3, scene 6 at Slice 4 (story parts 18.10a–d).

---

## Part A — Review of the 23 reference screens

### A.1 Summary

| RS | File | Shows (README) | Scene(s) | Verdict | Reviewed |
|---|---|---|---|---|---|
| 01 | `01-home-desktop-1280x800.png` | Home, Continue list | 1 (entry to 6) | Accepted with amendments applied | Proposal 4b |
| 02 | `02-active-task-desktop-1280x800.png` | Reading; guidance queued; Stop | 1, 2 | Accepted with amendments applied | Proposal 4b |
| 03 | `03-active-task-working-data-desktop-1280x800.png` | Guidance applied; limitation; working data | 2 | Accepted with amendments applied | **First reviewed here** |
| 04 | `04-browser-workspace-desktop-1280x800.png` | Read-only browser session | 2 (browser; 18.8 deferred) | Accepted with amendments applied | **First reviewed here** |
| 05 | `05-artifact-inspection-desktop-1280x800.png` | Draft 1, selected claim, citation preview | 3 | Accepted as illustrative reference | Proposal 4b |
| 06 | `06-evidence-inspection-desktop-1280x800.png` | Evidence drawer, Back to claim | 3 | Accepted as illustrative reference | **First reviewed here** |
| 07 | `07-changes-desktop-1280x800.png` | Correction, draft 2, diff | 3 | Accepted as illustrative reference | Proposal 4b |
| 08 | `08-clarification-desktop-1280x800.png` | Zobba needs your input | 2, 4 | Accepted with amendments applied | Proposal 4b |
| 09 | `09-permission-request-desktop-1280x800.png` | One confirmation surface, drafts | 4, 5 | Accepted with amendments applied | Proposal 4b |
| 10 | `10-engagement-desktop-1280x800.png` | Engagement page | none: supporting surface | Not a scene screen | Proposal 4b |
| 11 | `11-search-desktop-1280x800.png` | Scoped, attributed search | none: supporting surface | Not a scene screen | **First reviewed here** |
| 12 | `12-scheduled-checks-desktop-1280x800.png` | List with separate state dimensions | 6 | Accepted with amendments applied | Proposal 4b |
| 13 | `13-scheduled-result-desktop-1280x800.png` | Unattended result | 6 | Accepted with amendments applied | Proposal 4b |
| 14 | `14-connections-desktop-1280x800.png` | Connection states | none: supporting surface | Not a scene screen | **First reviewed here** (read in 4b, not individually reviewed) |
| 15 | `15-settings-methodology-skills-desktop-1280x800.png` | Settings forms | none: supporting surface | Not a scene screen | **First reviewed here** |
| 16 | `16-permissions-detail-desktop-1280x800.png` | Permissions and Activity record | 5 (partial), supports 4 | Accepted with amendments applied | Proposal 4b |
| 17 | `17-narrow-active-task-390x844.png` | Narrow active task | 2 (narrow) | Accepted with amendments applied | **First reviewed here** |
| 18 | `18-narrow-scheduled-result-390x844.png` | Narrow result | 6 (narrow) | Accepted with amendments applied | **First reviewed here** |
| 19 | `19-composer-model-effort-desktop-1280x800.png` | Composer model and reasoning-effort menu | 1 (serves 2) | Accepted with amendments applied | Proposal 4b |
| 20 | `20-manager-reviews-desktop-1280x800.png` | Audit manager · Reviews queue | none: supporting surface | Not a scene screen | Proposal 4b |
| 21 | `21-manager-review-paper-desktop-1280x800.png` | Audit manager · reviewing a working paper | 3 (reviewer's side) | Accepted with amendments applied | Proposal 4b |
| 22 | `22-admin-models-providers-desktop-1280x800.png` | Administrator · Models and providers | none: supporting surface | Not a scene screen | Proposal 4b |
| 23 | `23-admin-users-roles-desktop-1280x800.png` | Administrator · Users and roles | none: supporting surface | Not a scene screen | Proposal 4b |

Totals: 13 Accepted with amendments applied · 3 Accepted as illustrative reference · 7 Not a scene screen. "Proposal 4b" means the screen was not in 4b §10's list of screens left unreviewed; the eight in that list (03, 04, 06, 11, 14, 15, 17, 18) are reviewed individually here and get the fullest treatment.

### A.2 Per-screen record

Finding identifiers (F01-1 …) are stable references for the owning story parts.

#### RS 01 — Home · `01-home-desktop-1280x800.png`

- **Scenes:** 1; entry to 6 (the Continue list carries the unattended result).
- **Verdict:** Accepted with amendments applied · **Reviewed:** in Proposal 4b.
- **Exact copy on this screen (everything else illustrative):** navigation labels; Inconclusive; Not reviewed.
- **Amendments applied:** 4b §6, FR-92 and §6a Q13 — "Claude Opus 5.5 · High" is an illustrative default; the chip shows the administrator's default and only what policy permits. D-4b-2 — outstanding decisions are reached through the notification panel's attention view, never a first-level Needs you page.
- **Establishes:** EXP §2's Home — the greeting, the composer ("What are we auditing today?") with engagement, Permissions and model chips, the four starters, the Continue list. A Continue row keeps assessment and review as separate chips (EXP §5). The Scheduled checks count and "▲ 1" on Connections act as entry points (EXP §2).
- **Findings:**
  - F01-1 · No notification bell is drawn here or on any of the 23 screens, so the attention view's entry point (EXP §2; D-4b-2) is unillustrated → B14.
  - F01-2 · The engagement chip is preselected. A first request with no engagement (EXP §2 "A first request needs no name"; EXP §6 "Client not selected") is unillustrated → B2.
  - F01-3 · The Permissions chip reads "Reads selected sources" without the word Permissions (COMPONENT-INVENTORY: "Permissions: reads selected sources"). Its visible text or accessible name must identify it as the Permissions summary (EXP §3 Permissions; EXP §10).
  - F01-4 · No first-run empty state (Engagements, Recent tasks; EXP §6) is drawn → Part D item 5 (decided: EXP §6's sentence "No engagements yet. Start a conversation to begin." governs; DES aligned).

#### RS 02 — Active task: reading, guidance queued, Stop · `02-active-task-desktop-1280x800.png`

- **Scenes:** 1 (the first turn of a new conversation), 2.
- **Verdict:** Accepted with amendments applied · **Reviewed:** in Proposal 4b.
- **Exact copy on this screen:** navigation labels; Zobba is reading; Guidance queued for the next step; Stop.
- **Amendments applied:** row 1 — pressing Stop shows the transient Stop requested state (working mark, "Stopping after the current step…") until cessation is recorded; only then does the execution chip read Stopped by you and Zobba say what was kept (EXP §3, §6).
- **Establishes:** conversation-only layout (mode 1); the Linen auditor bubble and the unboxed first-person reply (R1.2); meaningful activity with one current step, a real count ("page 4 of 11"), Inspect and "Next: …" (EXP §3 Activity; R11.2); guidance acknowledged as queued; Stop separate from Send (EXP §3 Guidance versus Stop).
- **Findings:**
  - F02-1 · The task composer drops the engagement and Permissions chips. EXP §4 (Composer) and EXP §3 (the Permissions summary appears "in the composer chip") keep them; the build follows EXP. Also the task composers of RS 03, 04, 05, 08, 09 and 21.
  - F02-2 · The header presence chip and the current activity step both carry the working mark in one conversation region. Only one may animate (EXP §10 "One animated Pair mark per region"; DES §6 Zobba mark).
  - F02-3 · The activity summary above the composer (EXP §2 Engagement workspace; EXP §4 "The summary above the composer shows the current step and open items") is not drawn on any screen → B17 (added by Part D item 1).
  - F02-4 · The header names task, client and engagement but not the tenant workspace (EXP §1 Multi-tenant; 18.3), and no screen draws a breadcrumb trail (EXP §2 Breadcrumbs "Engagement / Workspace"). If the header's engagement line is the trail, 18.3 renders it as the page's one trail.

#### RS 03 — Active task: guidance applied, limitation, working data · `03-active-task-working-data-desktop-1280x800.png`

- **Scenes:** 2.
- **Verdict:** Accepted with amendments applied · **Reviewed:** first reviewed here (4b §10).
- **Exact copy on this screen:** navigation labels; Zobba is analysing; Stop; the safety-critical pattern "I can't treat [source] as the complete population yet." (rendered "…I can't treat it as the complete population yet.").
- **Amendments applied:** row 1 — Stop requested, as RS 02. §6a Q7 — pinned, focused or selected content and material the auditor explicitly opened stay protected while inspected; thirty seconds is a protective heuristic, not permission to replace content at second 31; new content then arrives as a conversation card. Row 15 — L1 presents the Partial input state, which stays a separate dimension.
- **Establishes:**
  - Conversation and workspace (mode 2): the conversation above its 400 px minimum; the panel at its 540 px default; Pin · Expand · Close; the source line "From Test leaver access for Q3 · working copy · updating" (EXP §3 Workspace; DES §4 Desktop frame).
  - Guidance applied at the step boundary: "Applied your guidance · measuring five working days from exit date" (EXP §3; P4).
  - A limitation recorded as it is found, with its L-reference ("◐ … · recorded as limitation L1"), beside the population pattern (EXP §3 Honest state; EXP §11).
  - Working data as professional audit data: filter chips, identifiers in Plex Mono, "! Still active" as a cell and never a row fill, the processed row shown as "Matching", and the footer "Showing 6 of 23 leavers · 1,516 accounts compared so far" (EXP §4 Working-data view; DES §4 Tables).
  - The current step with Inspect and Technical details, then "Next: …" (EXP §4 Activity list).
- **Findings:**
  - F03-1 · "Still active 3" and "Unmatched 0" are running counts while matching continues. The build marks them as in progress, as the panel's "updating" and the footer's "so far" already do, so that a zero never reads as a final result (EXP §3 Honest state; EXP §6 cold load).
  - F03-2 · The working mark sits on the header chip and on the current step, both in the conversation region; only one may animate there (EXP §10). The sidebar row and the panel's "Matching" row are other regions.
  - F03-3 · Composer chips missing, as F02-1.
  - F03-4 · Not drawn: the populated "Unmatched · n" group with its reason column (DES §4 Tables), and the protected-panel case in which incoming work becomes a card on desktop (Q7). The card form appears only on RS 17.

#### RS 04 — Read-only browser session · `04-browser-workspace-desktop-1280x800.png`

- **Scenes:** 2 (active analysis with a browser session). The browser view is story 18.8, deferred from the first acceptance (P5 §6: "View workspace and the browser view (no browser task in the scenario)"). This screen is 18.8's reference.
- **Verdict:** Accepted with amendments applied · **Reviewed:** first reviewed here (4b §10).
- **Exact copy on this screen:** navigation labels; Zobba is reviewing sign-ins; Stop.
- **Amendments applied:** row 11 — the header states "read-only on client systems" (the screen says "read-only connection"); a write that Permissions allow is a write-output to a permitted output location, never to a source (EXP §3 Browser). Row 12 — below 1024 px the live browser view takes a full-screen surface and never hides Stop, open decisions or limitations (EXP §10). Row 10 — AccessGate and its URL are illustrative.
- **Establishes:**
  - Browser view anatomy: the URL in Plex Mono, back and forward, Take over, and a footer saying what will be captured ("Capture will be saved as E6.2") (EXP §4 Browser view; DES §6).
  - Activity that names its object and where it is shown ("Reviewing sign-in activity · Kelvin Chanda — AccessGate admin, read-only · shown in the workspace"); evidence saved as E-references when found ("saved as E6.1").
  - The time zone named on captured times ("Date and time (CAT)").
- **Findings:**
  - F04-1 · "read-only connection" → "read-only on client systems" (row 11).
  - F04-2 · No Pause is drawn. EXP §2 (View workspace: "pause, stop, take control, answer") and 18.8 require pause and Stop at every width.
  - F04-3 · Not drawn: the taken-over state (Zobba paused until handed back), the hand-back control, and the refusal a person meets on another person's task without `run.control-transfer` (EXP §3 Browser; EXP §7).
  - F04-4 · The full-screen workspace (mode 4, the conversation as a bottom bar with composer, Stop and presence chip; EXP §2 Layout modes) is not drawn at any width.
  - F04-5 · Composer chips missing, as F02-1.

#### RS 05 — Draft 1, selected claim, citation preview · `05-artifact-inspection-desktop-1280x800.png`

- **Scenes:** 3 (reading view and citation preview).
- **Verdict:** Accepted as illustrative reference · **Reviewed:** in Proposal 4b.
- **Exact copy on this screen:** navigation labels; Not reviewed (see F05-2).
- **Decisions that govern what is shown:** §6a Q3 — the footer "Prepared with Zobba · draft n · ref" is on by default, firm-controlled, and never implies review. The screen agrees.
- **Establishes:** the working paper in the firm's template on the surround (R3.1); Prepared by names a person and Reviewed by stays pending (R3.2); citations as E-references with a hover preview giving id, title, location, source, date and "Open evidence" (EXP §4 Citation); the selected claim outlined; the reply's artifact card ("open in workspace") and "Select any statement to ask about it or see its evidence" (P6).
- **Findings:**
  - F05-1 · The task header chip "Draft 1 ready" is not a word of any EXP §5 dimension, and it stands where the presence chip goes. The build shows the execution state and the artifact's review-and-issue state as separate chips (EXP §5 "They never merge into one chip").
  - F05-2 · "Draft · not reviewed" pairs two review-and-issue words. Not reviewed presents a submitted version with no review record (DES §5 Review and issue), so an unsubmitted draft shows Draft alone. Also RS 07 and RS 10.
  - F05-3 · The material limitation L1 is absent from the panel header and the artifact header (EXP §4 Artifact: "material limitations visible in the header and where they apply").
  - F05-4 · Review mode ("2 matters need review") is not drawn on this or any screen → B19 (added by Part D item 1); Part C scene 3.
  - F05-5 · "Ask about this working paper" is a contextual placeholder beyond EXP §4's three composer states; it is illustrative.

#### RS 06 — Evidence drawer, Back to claim · `06-evidence-inspection-desktop-1280x800.png`

- **Scenes:** 3.
- **Verdict:** Accepted as illustrative reference · **Reviewed:** first reviewed here (4b §10).
- **Exact copy on this screen:** Back to claim.
- **Establishes:**
  - Workspace focus (mode 3): the sidebar on the rail, the conversation kept visible at about 400 px, the panel pinned ("From Test leaver access for Q3 · pinned"), and the 470 px evidence drawer over the workspace's right edge with the claim highlighted to its left (EXP §2 Layout modes; DES §4).
  - Select a statement and ask (P6): the tag "Selected · Conclusion, paragraph 1" above the auditor's message; the answer cites E3 and E6.2 and opens the evidence beside the conclusion.
  - Drawer anatomy (EXP §4 Evidence drawer; R4.2): "E6.2 · cited in Conclusion ¶1 and Results", title, Back to claim; the identity grid Source · Location · Captured · Supports; the excerpt with its row highlighted by an Iris inset bar; Open full capture; Technical details; "Also in this task: E6.1 …".
  - The time zone named ("Thu 1 Oct 2026, 11:42 CAT"; EXP §10 Formats).
  - Context survives opening evidence: the conversation, the pinned panel and the selection all stay (EXP §11 six-scene set).
- **Findings:**
  - F06-1 · The composer has no model chip, no + and no Send (also RS 07, 17 and 18). This contradicts the pack's own HANDOFF §3 ("Every composer in the reference screens now shows the model chip") and EXP §4 Composer; the build follows EXP §4.
  - F06-2 · Source and Location use "·" separators and mix the system-record and browser-capture forms. EXP §4 makes R4.3's per-type format the display rule (browser capture: site › page › captured time, highlighted element); 18.5a applies it per evidence type.
  - F06-3 · Focus moving to the drawer heading, and Esc or Back to claim returning it to the citation (EXP §10), are behaviour that only the build can prove (DES §7 implementation obligations).
  - F06-4 · The rail's two icons have no visible labels and need accessible names and tooltips (DESIGN-SYSTEM §5). The rail also hides the Scheduled checks count and the Connections warning, so the bell (B14) must stay reachable in focus mode.

#### RS 07 — Correction, draft 2, diff · `07-changes-desktop-1280x800.png`

- **Scenes:** 3 (the changes view inside artifact inspection).
- **Verdict:** Accepted as illustrative reference · **Reviewed:** in Proposal 4b.
- **Exact copy on this screen:** View changes; Undo.
- **Establishes:** a correction the auditor explicitly asks for saves as a new draft, "Draft 2 saved · View changes · Undo", with no approval ceremony (R5.1; EXP §3 Changes); a typographic diff, struck and underlined on a neutral background with no red or green (R5.3); a new limitation L2 carried into the artifact (R11.3); the evidence behind the selected conclusion listed with Open.
- **Findings:**
  - F07-1 · The Changes summary gives counts only ("Changes: 1 edit, 1 addition"). EXP §3 Changes and R5.5 also require it to name the changed conclusion and the changed limitation.
  - F07-2 · "Draft · not reviewed", as F05-2.
  - F07-3 · Composer incomplete, as F06-1.
  - F07-4 · A change that Zobba proposes itself (R5.2: offered for acceptance; story part 18.6b) is not drawn here or anywhere → B20 (added by Part D item 1).

#### RS 08 — Zobba needs your input · `08-clarification-desktop-1280x800.png`

- **Scenes:** 2, 4.
- **Verdict:** Accepted with amendments applied · **Reviewed:** in Proposal 4b.
- **Exact copy on this screen:** navigation labels; Zobba needs your input.
- **Amendments applied:** row 16 — one question per turn is a presentation default, not a prohibition; two tightly related details may be asked together; never a question-by-question wizard (EXP §3 Clarification).
- **Establishes:** the waiting mark and "Zobba needs your input" on the task header and the task row; a bold question with suggested replies and "Or reply in your own words"; the placeholder "Answer, or give other guidance" (EXP §4 Composer); the working data behind the question open beside it, honestly labelled "Not classified yet · waiting for your answer".
- **Findings:**
  - F08-1 · "I've paused this step" does not name the step (EXP §3 Clarification: "the paused step is named"; R1.5). This is a required fact for the illustrative-dialogue tests (EXP §11).
  - F08-2 · No Stop is drawn while the task waits → Part D item 3 (decided: Stop stays available on a nonterminal waiting task; 18.4a and 18.6a apply the correction, and B17 shows the waiting state).
  - F08-3 · A second outstanding question, and its listing in the attention view, are not drawn (EXP §3 Conversation thread: "several outstanding ones listed, none pinned over the composer"; B14).

#### RS 09 — One confirmation surface, drafts · `09-permission-request-desktop-1280x800.png`

- **Scenes:** 4; 5 (the decision that precedes the effect).
- **Verdict:** Accepted with amendments applied · **Reviewed:** in Proposal 4b.
- **Exact copy on this screen:** navigation labels; Zobba needs your permission; Allow and send · Edit first · Don't send; View permissions; "I need your permission before sending these."
- **Amendments applied:** row 14 — after Allow and send, outcomes are reported per operation; the unknown-after-dispatch or provider-accepted sentence is chosen from the receipt; no generic Retry while duplication is possible (EXP §6). Row 10 — Outlook, Teams and the addresses are illustrative; the first acceptance creates one Google Calendar invitation (P5 §4a Slice 3).
- **Establishes:** one decision surface in the conversation carrying every material detail — what will happen, sender, recipient, content and attachments, date, time and time zone, calendar and invitees — with the drafts open beside it (EXP §3 One decision surface; R7.2); Allow and send in Graphite, never Iris; the Permissions footer with its summary and View permissions (R6.2); the drafts labelled "not sent".
- **Findings:**
  - F09-1 · The drafts panel shows "Expand · Close" without Pin. EXP §3 Workspace and R2.3 keep Pin · Expand · Close always present.
  - F09-2 · Not drawn: the invalidated state ("Details changed since you last saw this"), the sending state and the per-operation outcomes (DES §6 Confirmation card states) → Part C scenes 4 and 5.
  - F09-3 · No Stop is drawn while the task waits → Part D item 3 (decided: as F08-2; 18.6c applies the correction to the confirmation surface).

#### RS 10 — Engagement page · `10-engagement-desktop-1280x800.png`

- **Scenes:** none: supporting surface. It is an entry to scene 1 ("Start a task in this engagement") and lists scene 6's check.
- **Verdict:** Not a scene screen — accepted as the reference for the Engagements view in 18.3 · **Reviewed:** in Proposal 4b.
- **Exact copy on this screen:** navigation labels; Permissions; View permissions; Inconclusive; Not reviewed; Reviewed by [name].
- **Amendments applied:** D-4b-5 and 4b §7 — "lead auditor" and "reviewer" are engagement assignments, not tenant roles. The screen agrees.
- **Establishes:** EXP §2's engagement page in full — Tasks; Working papers and artifacts; Scheduled checks; Permissions summary; Team; Client contacts; Sources; Methodology — with assessment and review as separate chips.
- **Findings:**
  - F10-1 · "Issued to client · 3 Sep" names no person. Issued always names the person and the date (EXP §5 Review and issue).
  - F10-2 · "Draft 2 · not reviewed", as F05-2.
  - F10-3 · The task state "Complete" is not the execution word Completed (EXP §5 Execution).
  - F10-4 · "Mondays 06:00 UTC" has no local time (EXP §10 Formats: "scheduled checks show UTC plus the local time").
  - F10-5 · Not drawn: a draft engagement's page (B2) and the Legacy procedures entry from Engagements (EXP §2; B10).

#### RS 11 — Scoped, attributed search · `11-search-desktop-1280x800.png`

- **Scenes:** none: supporting surface (story part 18.14).
- **Verdict:** Not a scene screen — accepted as the reference for 18.14 · **Reviewed:** first reviewed here (4b §10).
- **Exact copy on this screen:** navigation labels; Reconnect.
- **Amendments applied:** D-4b-3 and rows 4 and 18 — RS 14 shows Kafue SharePoint as an organisation connection, which is deferred in the first release; the stale-index notice stays for any user-owned connection. Row 10 — SharePoint and the scenario names are illustrative.
- **Establishes:**
  - The scope selector "Scope: all authorised work" and type filters (EXP §3 Search; R10.1).
  - Results grouped by client · engagement, with a count per group and no merging; each result with its type, title, an excerpt with the match in weight 600, location and date (DES §4 Search states).
  - The stale-index notice directly under the group it qualifies — glyph, sentence, cause, last index date, Reconnect: "▲ Kafue SharePoint results may be incomplete…" (EXP §6 Search; R10.2).
  - The rule stated in words: "Results from different clients are listed separately. A task works inside one engagement."
- **Findings:**
  - F11-1 · A Kafue SharePoint document ("Kafue SharePoint › IA › Procedures") is typed "Procedure", but EXP §2 routes "Search results of type Procedure" to the Legacy procedures view of compiler-1 Procedures. B10's design must tell the two apart.
  - F11-2 · The type filters omit Procedure although a Procedure result is listed (DES §4 Search lists Procedure among the result types).
  - F11-3 · There is no visible page heading. The page needs a title and a heading (WCAG 2.2 success criteria 2.4.2 and 2.4.6; EXP §10).
  - F11-4 · Not drawn: Empty (recent searches), Loading per scope ("Searching Northstar Bank…"), No results with the scope named and a broaden-scope link, and direct-source continuation (EXP §6 Search; DES §4).

#### RS 12 — Scheduled checks list · `12-scheduled-checks-desktop-1280x800.png`

- **Scenes:** 6.
- **Verdict:** Accepted with amendments applied · **Reviewed:** in Proposal 4b.
- **Exact copy on this screen:** navigation labels; Inconclusive; Not reviewed; Didn't run; Paused; Reconnect.
- **Amendments applied:** rows 2–3 — add the Awaiting approval and Pending regression states, with no next run while either holds; a check becomes Active only after independent approval (row 2). Row 13 — "Waiting for your input · two vendor lists found" is an unattended run pausing truthfully, with the matter routed to the responsible person (EXP §3 Scheduled work). FR-93 — a withdrawn model is a recorded execution cause (B13).
- **Establishes:** the separate dimensions on each row — Completed 06:14 (execution) · Inconclusive (assessment) · Not reviewed (review); Didn't run with its reason and recovery action and no assessment; Paused with "None while paused"; the waiting mark with its reason; the rule stated under the table (EXP §5 Scheduled-check states; DES §5).
- **Findings:**
  - F12-1 · "Privileged users review" shows "Completed 1 Oct · reviewed by Ama Mensah" with no assessment chip. This contradicts the page's own footnote and EXP §5 (Completed, then the assessment chip, then the review chip).
  - F12-2 · "reviewed by Ama Mensah" gives no date (EXP §5: Reviewed by … always names the person and the date).
  - F12-3 · The subtitle "Checks you've set up from tasks" is wrong twice: the list holds every check the person may see (EXP §2; RS 20 attributes the Kafue change log check to Bwalya Kunda), and a check is activated only through approval (row 2). No row names its responsible person (Flow G).
  - F12-4 · Times in UTC only (EXP §10 Formats).
  - F12-5 · Not drawn: a Running row ("Zobba is running this check") and a model-withdrawn row.

#### RS 13 — Unattended result · `13-scheduled-result-desktop-1280x800.png`

- **Scenes:** 6.
- **Verdict:** Accepted with amendments applied · **Reviewed:** in Proposal 4b.
- **Exact copy on this screen:** navigation labels; Zobba ran this unattended; Inconclusive; Not reviewed; Mark as reviewed.
- **Amendments applied:** row 15 — "LoanCore 318 accounts, full population unknown" is the Unknown state, kept explicit in its own dimension (see F13-1). Row 2 — "same method and permissions as the Q3 test" means the method artifact selected from the task and the Permissions Version bound at approval. Row 13 — "Ask Chipo for a complete weekly export" prepares drafts and goes through the decision surface; nothing is sent from this button (P13). Row 9 — the notification that leads here is in-app only. Row 1 — a person who stops a scheduled run sees Stop requested until cessation is recorded (not drawn).
- **Establishes:** the scheduled-result anatomy of EXP §2 and §4 — the actor line with the mark ("Zobba ran this unattended · … · created from …"), the assessment chip, one truthful sentence ("Analysis completed. Three supported exceptions were identified, but the overall assessment is inconclusive because the application population was incomplete."), Exceptions · Coverage · Evidence · How it ran, Mark as reviewed, Discuss this result; Completed kept apart from the assessment.
- **Findings:**
  - F13-1 · "◐ Inconclusive · coverage incomplete" merges the assessment and the input-and-coverage dimensions in one chip (EXP §5 "They never merge into one chip"; DES §5 Rules). The build shows ◐ Inconclusive and a separate input chip (Partial or Unknown, with its L-reference). Also RS 18.
  - F13-2 · UTC only (EXP §10 Formats). The header names the client but not the engagement, although a result is a detail surface with an Engagement trail (EXP §2 Breadcrumbs).
  - F13-3 · Not drawn: How it ran expanded with the requested and actual model configuration per invocation (EXP §3 Model and effort; FR-91), and "Why inconclusive" opening the Gate checklist (EXP §4 Scheduled result).

#### RS 14 — Connection states · `14-connections-desktop-1280x800.png`

- **Scenes:** none: supporting surface (18.7a, the minimal list in Slice 1; 18.7c, the full page in Slice 3). Access failures in scenes 2 and 6 are recovered here.
- **Verdict:** Not a scene screen — accepted as the reference for 18.7a and 18.7c with amendments applied · **Reviewed:** first reviewed here (4b §10 notes it was read, not individually reviewed).
- **Exact copy on this screen:** navigation labels; Needs reconnecting; Reconnect; the connection sentence, verbatim: "A connection lets Zobba reach a system. It doesn't grant every resource in it: engagement permissions and the system's own access still apply."
- **Amendments applied:** D-4b-3 and rows 4 and 18 — connections in the first release are user-owned. The three rows labelled "Organisation connection" (AccessGate · Northstar Bank, Kafue SharePoint, Microsoft Teams chat) show a deferred capability and are not built; no empty "Organisation connections" section appears and the label stays reserved (EXP §6 Connections; B11). The LoanCore row ("Not available as a connection · Client supplies extracts to the shared folder") is a source entry and stays (row 4). Row 10 — Outlook, SharePoint and Teams are illustrative; the first acceptance connects Google Drive, Gmail and Calendar.
- **Establishes:**
  - State words with glyphs: ● Connected; Connected with "Limited to 2 areas"; ▲ Needs reconnecting with its reason and consequence ("Sign-in expired Fri 2 Oct. Search results and the daily change log check are affected."); ○ Not connected; – Disabled, "Turned off by your administrator" (EXP §5 Connection; EXP §6).
  - One action per row, with Reconnect the one Graphite action; "▲ 1" on the sidebar item (EXP §2).
  - No tokens or OAuth scopes (EXP §4 Connection card).
- **Findings:**
  - F14-1 · Rows fold account, capability and location into one line, and several omit one of the three (the shared-folder row names no account; the Outlook row names no designated resources). EXP §4 Connection card shows "accounts, granted capabilities and permitted locations … as three things".
  - F14-2 · "asks before sending anything" on the Outlook row is a Permissions statement (Asks first), not a connection capability; the page's own subtitle leaves use to engagement permissions (EXP §3 Permissions; EXP §4).
  - F14-3 · Not drawn: Connecting ("Connecting…", no spinner), Error (message plus Technical details) and the empty state "No accounts connected. Connect one to let the agent read the resources you choose." (EXP §6).
  - F14-4 · Connecting a source — provider consent, choosing designated resources by readable identity, returning to the work (Flow B; 18.7a, Slice 1) — has no screen → B18 (added by Part D item 1).

#### RS 15 — Settings › Methodology and skills · `15-settings-methodology-skills-desktop-1280x800.png`

- **Scenes:** none: supporting surface (18.7b; the undesigned parts are B16).
- **Verdict:** Not a scene screen — accepted as a partial reference for 18.7b with amendments applied · **Reviewed:** first reviewed here (4b §10).
- **Exact copy on this screen:** Asks first.
- **Amendments applied:** D-4b-5 and 4b §7 (FR-94) — there is no Methodology owner. Admin creates, maintains, approves, activates and retires packs, skills and templates as versioned, audited configuration changes, and each pack and skill records its creator, maintainer and approver. "maintained by the Methodology team", "Owner: Methodology team" and the availability value "Draft · owners only" therefore become accountability records and Admin-only visibility. §6a Q8 — "Available to auditors" controls availability only; it is neither sufficient nor necessary for promotion. §6a Q12 — firm templates stay authoritative; a neutral example template serves bootstrap.
- **Establishes:** Settings on the rail with the 220 px secondary column (DES §6 Settings navigation); form controls per DES §4 Forms (label above, help below, a select, a toggle that names its "on" meaning, the Graphite "Save changes"); a skill's effects stated in the Permissions vocabulary ("Asks first — None. This skill only reads sources and writes working copies."); version numbers and Version history.
- **Findings:**
  - F15-1 · "Save changes" edits an active skill (v3) in place. EXP §7 and FR-94 require a new version, approved and activated as an audited configuration change, with approved checks keeping their pack version (16.9) → B16.
  - F15-2 · The README's timeline places RS 15 in Daniel Okonjo's (Auditor) day, yet the screen offers Administration and editable skill fields. EXP §2 shows Administration to Admin only, and EXP §7 with 18.7's check ("an Auditor sees Methodology read-only") gives an Auditor a read-only view that can only propose from documents.
  - F15-3 · The Settings column (Profile · Methodology and skills · Permission defaults · Notifications · Administration) differs from EXP §2 (Connections, Methodology and skills, profile and organisation) → Part D item 6 (decided: the reconciled Settings sections; no standalone Notifications section in this release).
  - F15-4 · The "No methodology configured" state with Select a starter pack / Prepare one from your documents (EXP §6) is not drawn → B16.

#### RS 16 — Permissions and Activity record · `16-permissions-detail-desktop-1280x800.png`

- **Scenes:** 5 (partial: the outcome record); supports 4 (the decision basis).
- **Verdict:** Accepted with amendments applied · **Reviewed:** in Proposal 4b.
- **Exact copy on this screen:** navigation labels; Permissions · Can read · Can write · Asks first · Never · Scheduled checks · Connections · Administrator limits · Change permissions · Activity record.
- **Amendments applied:** 4b §3 — the action-outcome vocabulary (Sent · Sent, not confirmed · Confirmed · Blocked · Failed before sending, plus Not sent; DES §5 and DES §8 item 8) replaces "Sent · accepted" and "Done". Row 2 — "Scheduled checks: Run with these same permissions" becomes: each check runs under the Permissions Version approved with it. D-4b-3 — "Northstar organisation connections" are deferred. FR-92 — "Client data stays in the EU region" is illustrative and may state only what the configured service has established.
- **Establishes:** the seven sections with Change permissions and the Activity record (R6.3; EXP §3); "Set by Daniel Okonjo on 1 Sep 2026 · … within limits set by your administrator"; each external action with its decision basis ("allowed by Daniel Okonjo", "same decision as the email") and its own outcome, per operation, although approved together (R6.4, R7.5); no locks, shields, tokens or scopes.
- **Findings:**
  - F16-1 · "Sent · accepted" joins the send outcome to the invitee's reply, and "accepted" collides with the provider-accepted state, which EXP §5 shows as Sent with delivery not confirmed. The invitee's acceptance is a separate, read-back fact.
  - F16-2 · "Read AccessGate sign-in history · 2 users — Done" sits under "Activity record · external actions", but a read is not an external action, and "Done" is not an outcome word.
  - F16-3 · Not drawn: Sent, not confirmed; Blocked; Failed before sending; and the two receipt-chosen sentences → Part C scene 5.

#### RS 17 — Narrow active task, 390 × 844 · `17-narrow-active-task-390x844.png`

- **Scenes:** 2 (narrow).
- **Verdict:** Accepted with amendments applied · **Reviewed:** first reviewed here (4b §10).
- **Exact copy on this screen:** Zobba is analysing; Stop; the population pattern — deviated (F17-1).
- **Amendments applied:** row 12 — breakpoints 600 / 1024 / 1600; below 600 the conversation is the default view, the workspace opens full-screen with a back control, and the sidebar is a sheet (EXP §10). Row 1 — Stop requested, as RS 02.
- **Establishes:**
  - Below 600 the workspace arrives as a conversation card — "Working data · Leavers matched to accounts · working copy · Open" — instead of a panel (EXP §10; the card form of EXP §3).
  - Stop beside the composer, reachable without scrolling; the limitation as a dashed callout that stays visible ("◐ Limitation L1 · LoanCore listing covers new accounts only") (EXP §10; EXP §4 Limitation).
  - A 44 px back control, and touch targets of at least 44 px (DES §4 Breakpoints).
- **Findings:**
  - F17-1 · "…so I can't treat it as complete yet." departs from the exact pattern "I can't treat [source] as the complete population yet." (EXP §11). RS 03 has the correct form.
  - F17-2 · The header names the task only; EXP §1 requires the conversation's engagement and client in the header.
  - F17-3 · The composer has no model chip and no +, and shortens the working placeholder to "Add guidance" (EXP §4: "Add guidance or ask a question"; HANDOFF §3).
  - F17-4 · The header chip and the current step both carry the working mark (EXP §10).
  - F17-5 · Not drawn at this width: a clarification or permission card pinned above the composer, the full-screen workspace with its back control, and any 600–1023 frame (the overlay sheet over 80 % of the width) → Part D item 4 (decided) and B.3.

#### RS 18 — Narrow unattended result, 390 × 844 · `18-narrow-scheduled-result-390x844.png`

- **Scenes:** 6 (narrow).
- **Verdict:** Accepted with amendments applied · **Reviewed:** first reviewed here (4b §10).
- **Exact copy on this screen:** Zobba ran this unattended; Inconclusive; Not reviewed.
- **Amendments applied:** row 12 (breakpoints, as RS 17); row 15 and F13-1 (split the chip); rows 2, 9 and 13, as RS 13.
- **Establishes:** RS 13's order kept on a phone — the actor line, the assessment chip, the one-sentence conclusion, then Exceptions · Coverage · Evidence · How it ran as 44 px rows with "! 3" in the exception colour; the suggested follow-up; a composer for questions about the result (EXP §2 Scheduled result; EXP §10).
- **Findings:**
  - F18-1 · Mark as reviewed and Discuss this result are absent. Decision surfaces stay usable at every width (EXP §10), and both belong to the result (EXP §2; P13).
  - F18-2 · The "Not reviewed" chip wraps and its second word falls outside the pill. Keep chips on one line or reflow the header (EXP §10; WCAG 2.2 success criterion 1.4.10).
  - F18-3 · "Inconclusive · coverage incomplete" merges two dimensions, as F13-1.
  - F18-4 · The header gives the client and UTC but not the engagement or the local time (EXP §10 Formats; F13-2).
  - F18-5 · No model chip in the composer, as F06-1.
  - F18-6 · With Mark as reviewed gone, the suggested follow-up is the only strong action on the screen. It prepares drafts for the decision surface (row 13) and must not read as the way to close the result.

#### RS 19 — Composer model and reasoning-effort menu · `19-composer-model-effort-desktop-1280x800.png`

- **Scenes:** 1 (the composer of a new conversation); the same chip serves 2.
- **Verdict:** Accepted with amendments applied · **Reviewed:** in Proposal 4b.
- **Exact copy on this screen:** navigation labels.
- **Amendments applied:** 4b §6 (FR-91, FR-92) and §6a Q13 and Q15 — the models, providers, default and the region reason are illustrative, not approved selections. The menu offers only what administrator policy, the engagement's disclosure restrictions, required capabilities and execution limits permit. Effort shows only the choices the selected model supports (Low · Medium · High · Max is not universal), and an unsupported choice is unavailable or explicitly remapped. A change applies from the next safe boundary and is recorded per invocation. No cost is shown to auditors.
- **Establishes:** "[Model] · [Effort] ▾" after the context chips; model name, provider and a short note, with no logos; the disabled model with its reason ("Not available here: Northstar data must stay in the EU"); effort as a segmented control; the footer "Set by your administrator · recorded in How it ran" (EXP §4 Model chip; DES §6).
- **Findings:**
  - F19-1 · "engagement default" presents the default as the engagement's. FR-92 sets a tenant default, and per-engagement availability lives in the disclosure policy (4b §6), so the note should say where the default comes from.
  - F19-2 · "Higher effort is slower; use it for judgement-heavy steps." must not suggest more budget or a stronger evidential status (EXP §3 Model and effort).
  - F19-3 · The mid-task note "Switched to … from the next step" (EXP §6 Composer) is not drawn.

#### RS 20 — Audit manager · Reviews queue · `20-manager-reviews-desktop-1280x800.png`

- **Scenes:** none: supporting surface (18.11; lists scene 6's result).
- **Verdict:** Not a scene screen — accepted as the reference for 18.11 with amendments applied · **Reviewed:** in Proposal 4b.
- **Exact copy on this screen:** navigation labels with Reviews; In review; Returned · n notes; Inconclusive; Not reviewed; Reviewed by [name] — deviated (F20-1).
- **Amendments applied:** row 7 and FR-94 — independence covers authors and substantive contributors ("cannot satisfy a required independent review or approval of work they authored or substantively contributed to"), not only "own work"; Reviews is shown by review responsibility and capability (D-4b-2; the screen's footnote agrees). Row 6 — In review and Returned · n notes are the added lifecycle records (the screen agrees).
- **Establishes:** the three groups, Waiting for your review · Returned with your notes · Reviewed recently; the columns item, Prepared by, state chips, Submitted; an unattended result's assessment chip kept apart from its review chip; Zobba checks and explains while the review decision stays the reviewer's (EXP §4 Reviews queue; FR-96).
- **Findings:**
  - F20-1 · "Reviewed by you · 28 Sep": the fixed label names the person (EXP §5; EXP §11 "Reviewed by [name]").
  - F20-2 · "owner Daniel Okonjo" on a check: the approved term is the check's responsible person (EXP §3 Scheduled work; Flow G), and "owner" echoes the removed Methodology owner role.
  - F20-3 · "Team work in progress" is in the pack (DESIGN-SYSTEM §5a) but not in EXP §2's Reviews row or in 18.11's title. If 18.11 builds it, it stays within the engagements the reviewer is assigned to, as its footnote says (FR-94).

#### RS 21 — Audit manager · reviewing a working paper · `21-manager-review-paper-desktop-1280x800.png`

- **Scenes:** 3 (the reviewer's side: reading, selection, citations, anchored notes).
- **Verdict:** Accepted with amendments applied · **Reviewed:** in Proposal 4b.
- **Exact copy on this screen:** Return with n notes; Mark as reviewed; In review; the Review action bar helper as quoted in EXP §4 ("Marking as reviewed records you and the time. Approval and issue are separate steps.").
- **Amendments applied:** FR-96 (4b §7) — notes are excluded from client-facing renderings by default and included in authorised workpaper, archive and verification exports; this replaces the screen's "They are not part of the exported document." Row 7 — the reviewer must be independent of the author and of substantive contributors. Row 6 — In review is the added lifecycle record.
- **Establishes:** an anchored review note ("On L2 · Ama Mensah · draft") in a column beside the page; "Selected · Limitations, L2" with a cited answer; Zobba's checks shown as checks and never as approval ("Checks run for you: all 14 evidence links open · figures agree with working data · limitations carried into the conclusion"); the action bar with "Approval and issue are separate steps." (EXP §4; FR-96; D-4-4); the reviewer's own model choice (EXP §7).
- **Findings:**
  - F21-1 · The paper reads "Reviewed by: Ama Mensah, in review" before any review is recorded. The rendering must not imply a review that has not happened (EXP §1, the fourth thing the interface never does; R3.2–R3.3): show the assignment as pending until Mark as reviewed records the review.
  - F21-2 · Not drawn: Approve version bound to the revision, the independence refusal ("You cannot approve a version you authored or contributed to."), and the preparer's "Returned · n notes" view (Flow F, Flow L).
  - F21-3 · This is the reviewer's surface. The auditor's review mode ("n matters need review", EXP §4) has no screen → B19; Part C scene 3.
  - F21-4 · RS 21 draws one note on one limitation. Anchoring beyond it — a note on a table cell, a citation or a claim; several notes on one anchor; a note whose anchor moved or disappeared in the revised version (Flow L); the preparer's response and disposition (EXP §4 Review note) — is not drawn. P5 §4a lists "review-note anchoring beyond RS 21" among Slice 3's designs → B21 (added by Part D item 1).

#### RS 22 — Administrator · Models and providers · `22-admin-models-providers-desktop-1280x800.png`

- **Scenes:** none: supporting surface (18.12).
- **Verdict:** Not a scene screen — accepted as the reference for 18.12's Models and providers with amendments applied · **Reviewed:** in Proposal 4b.
- **Exact copy on this screen:** Administrator limits (the Settings item).
- **Amendments applied:** FR-92 and §6a Q13 — the providers, models, regions and defaults are illustrative, not approved selections; the build seeds none of them (18.12's check). FR-93 and row 5 — the helper "Scheduled checks keep the model and effort they were created with. If a model is withdrawn, the check pauses and its owner is asked to choose another." becomes: a check keeps the configuration it was approved with; temporary provider failure, retirement and policy revocation are recorded as distinct causes; a replacement is a proposed configuration change with independent approval and regression, never an in-place choice (B13). §6a Q15 — "Usage by engagement" is the administrators' cost view.
- **Establishes:** providers with their models, processing region, availability and status; the default model and default effort; the two auditor toggles (FR-92); Usage by engagement.
- **Findings:**
  - F22-1 · "Processing region" may show only what the configured service has established, never a declared value (FR-92).
  - F22-2 · "Available for" must be read from the disclosure policy — the one enforcement path — not kept here as a second per-engagement policy (4b §6; FR-92).
  - F22-3 · The page does not say that changing a default leaves active tasks and approved checks unchanged (FR-92).

#### RS 23 — Administrator · Users and roles · `23-admin-users-roles-desktop-1280x800.png`

- **Scenes:** none: supporting surface (18.12, with 11.9–11.11).
- **Verdict:** Not a scene screen — accepted as the reference for 18.12's Users and roles with amendments applied · **Reviewed:** in Proposal 4b.
- **Exact copy on this screen:** the role names (EXP §1, §7), amended below; Invited (the invitation vocabulary, DES §5).
- **Amendments applied:** row 7, 4b §7 (FR-94, FR-95), D-4b-1 and D-4b-5 — three tenant roles only. The Methodology owner row (Kofi Asante) and its role description are removed; "Administrator" is displayed "Admin"; the invitation choices offer Auditor, Audit manager and Admin only; Invite people means Create invitation / Copy invitation link, never email delivery; "Remove access" becomes separate actions — remove from an engagement, remove from the tenant, and the separate account action. The role descriptions state independence over authored and contributed work, and Admin's methodology configuration authority, which is never audit approval.
- **Establishes:** people with their role, engagement assignment ("Both · reviewer") and status, including Invited; a role selector with "What each role can do"; long addresses wrapping (EXP §10 Formats).
- **Findings:**
  - F23-1 · Not drawn: the last-active-Admin refusal and the invitation lifecycle beyond Invited (EXP §6 Users and roles and Invitation, `[TO DESIGN]`; B12).
  - F23-2 · "Both · reviewer" should name the engagements (EXP §10 Formats: rows are named by what a person recognises).
  - F23-3 · "Invited 2 Oct" sits in the Engagements column; a pending invitation's proposed engagement access is its own fact (FR-95).

---

## Part B — Register of undesigned surfaces

The sixteen rows of P5 §5 in P5's order — the thirteen gaps of 4b §4 and §10 (B1–B13) plus the three rows P5 added (B14–B16) — with P5's owners translated to Epic numbering, and the six rows the owner added on 2026-09-25 (B17–B22, Part D item 1; B22 as bounded sub-rows by the slice that first needs each). **Every row is `open`; none is closed.**

**Closing a row.** A row closes only when (1) a design for the surface has been made under the pack's rules — DES tokens and components, EXP behaviour and copy, the row's "must show" points in B.2, its narrow and intermediate-width states (B.3), WCAG 2.2 AA — and (2) that design has been reviewed and the review is recorded in the row (design reference, review date, reviewer). A component variant, an annotated frame or a small interaction prototype can close a row where it is sufficient for the row's must-show points; not every row needs a new full-page design (owner, 2026-09-25). A reviewed design is still not proof of behaviour. Until its row closes, a Built-by part does not start its surface work; its prerequisite parts proceed (D-5-6).

### B.1 Register

| ID | Undesigned surface (P5 §5) | Built by (P5 §5, Epic numbering; the surface part named) | First needed (P5 §5) | Status | Design reference | Review record |
|---|---|---|---|---|---|---|
| B1 | Memory: "Remembered for your preferences", proposal cards, scope and verification status, retirement | 18.9 (NE-8 8.8) | Slice 2 | open | — | — |
| B2 | Draft engagement without a client; the client-binding moment | 18.4a (NE-8 8.3a), with 12.1 (NE-2 2.1) | Slice 1 | open | — | — |
| B3 | Needs-another-look flag and impact records on artifacts | 15.3 (NE-5 5.3); surface 18.5b (NE-8 8.4b) | Slice 2 | open | — | — |
| B4 | `reconcile` decision surface (keep observing · mark done with reference · retry with duplication warning · abandon) | surface 18.6c (NE-8 8.5c), with 12.6 (NE-2 2.6) | Slice 3 | open | — | — |
| B5 | Sharing a working draft versus issuance; PDF export | 15.7 (NE-5 5.7) and 15.6a (5.6a; PDF export 15.6b); surface 18.6c (NE-8 8.5c) | Slice 3 (share); PDF export after Slice 4 | open | — | — |
| B6 | Promotion approval: method review, compiler mapping, unresolved issues, second-person approval; Awaiting approval and Pending regression on Scheduled checks | 19.2–19.3 (NE-9 9.2–9.3); surface 18.13 (NE-8 8.12) | Slice 4 | open | — | — |
| B7 | Regression case sets and a version pending regression | 19.9 (NE-9 9.9): 19.9a, 19.9b | before 19.9 (Slice 4 through 19.9a if the first activation requires regression; otherwise with 19.9b, deferred) | open | — | — |
| B8 | Retention decisions, holds, deletion | 14.10 (NE-4 4.10); "Data and retention" is named in 18.12 | before 14.10's surface (deferred; no deletion is exposed in the first acceptance, P5 §4c) | open | — | — |
| B9 | Tenant switching for a person in two firms | 18.3 (NE-8 8.2) | Slice 1 | open | — | — |
| B10 | Legacy procedures view (compiler-1 Runs, Run Detail, Live View, Replay reachable) | 18.3 (NE-8 8.2) | Slice 1 | open | — | — |
| B11 | Organisation connections | none in the first release — deferred (D-4b-3) | its own contract | open (deferred) | — | — |
| B12 | Invitation creation and acceptance | 11.10 (NE-1 1.10); surface 18.12 (NE-8 8.11) | Slice 3 | open | — | — |
| B13 | The model replacement proposal for a check | 19.11 (NE-9 9.11); replacement path 19.11b | before 19.11's replacement path (19.11b, deferred) | open | — | — |
| B14 | The notification panel's complete attention view | 18.3 (NE-8 8.2) | Slice 1 | open | — | — |
| B15 | Input-quality expansion (Unknown, Out of period beside the pack's chips) | surface 18.5b (NE-8 8.4b) | Slice 2 | open | — | — |
| B16 | Settings › Methodology and skills: pack proposal and approval by Admin | 16.7 (NE-6 6.7; proposal from documents is 16.7c, deferred); surface 18.7b (NE-8 8.6b) | before 16.7's surface (P5 §4a lists "Methodology and skills for Admin" among Slice 2's designs) | open | — | — |
| B17 | The activity summary above the composer, with Stop and the execution state in the working and waiting states | 18.4a (NE-8 8.3a) | Slice 1 | open | — | — |
| B18 | Connecting a source from the conversation: provider consent, designated resources by readable identity, return to the work (Flow B) | surface 18.7a (NE-8 8.6a); prerequisites 13.5–13.7 and 13.8a proceed | Slice 1 | open | — | — |
| B19 | The auditor's review mode: "n matters need review" and each matter opened on its claim | surface 18.5b (NE-8 8.4b); prerequisites 15.1–15.2 proceed | Slice 2 | open | — | — |
| B20 | Acceptance surface for a change Zobba proposes (R5.2) | surface 18.6b (NE-8 8.5b) | Slice 2 | open | — | — |
| B21 | Review-note anchoring beyond RS 21 | surface 18.11 (NE-8 8.10); prerequisite 15.9 proceeds | Slice 3 | open | — | — |
| B22a | Glyphs and treatments still `[TO DESIGN]` that Slice 1 renders: execution (Not started · Stopped by you · Completed), input and coverage (Complete · Unknown), connection (Connecting · Limited), the Data quality and Wait inspection vocabularies, and the Zobba-token treatment for untrusted content (DES §6) | 18.10a (NE-8 8.9a); used by 18.3, 18.4a, 18.5a, 18.6a, 18.7a | Slice 1 | open | — | — |
| B22b | Glyphs and treatments still `[TO DESIGN]` that Slice 2 renders: review and issue (Draft · Superseded) and the Claim support inspection vocabulary | 18.10b (NE-8 8.9b); used by 18.5b, 18.6b | Slice 2 | open | — | — |
| B22c | Glyphs and treatments still `[TO DESIGN]` that Slice 3 renders: review and issue (In review · Returned · Reviewed by [name] · Approved · Issued) and the Action outcome inspection vocabulary | 18.10c (NE-8 8.9c); used by 18.6c, 18.11 | Slice 3 | open | — | — |

### B.2 Governing rule and what each design must show before its part starts

**B1 — Memory.**
- *Governing rule:* EXP §4 Memory ("An explicit instruction shows 'Remembered for your preferences' inline with a link to inspect or correct; an inferred item shows a proposal with scope, source and reason and Confirm / Reject / Edit scope"); EXP §5 memory vocabulary `[TO DESIGN]`; EXP §7 "Confirm a memory proposal" (scope owner or delegate); Flow E.
- *Must show:* (1) the inline "Remembered for your preferences" line with its inspect-or-correct link and no second prompt; (2) the proposal card with scope, source and reason and Confirm / Reject / Edit scope, reachable from the thread and from the attention view (B14), and what a person who does not own the scope meets; (3) the memory vocabulary fixed with glyph and word, verification status as a separate fact on inspection, and replaced and retired items; (4) an inferred item never presented as an instruction.
- *Note:* mechanism 16.2a. `epics.md` gates 18.9 only.

**B2 — Draft engagement without a client; the client-binding moment.**
- *Governing rule:* EXP §2 Home ("A first request needs no name."); EXP §6 Workspace, draft, client not selected ("Header 'Client not selected'; the agent's first reply names what it can reach now and what needs a client."); EXP §1 Multi-tenant; Flow A ("selecting a client when Zobba needs client material").
- *Must show:* (1) a first request from Home with no engagement opening a draft engagement with a provisional, renameable title; (2) the "Client not selected" header and the first reply naming what can be reached now and what needs a client; (3) the binding moment asked in the conversation, never as a form, happening once (11.5), and its effect on the engagement and Permissions chips; (4) switching engagements carrying no attachments, selected resources, pending confirmations or unsent drafts (EXP §1).
- *Note:* corrected on 2026-09-25 (Part D item 2): `epics.md` gates 18.4a only; 18.4b and the backend part 12.1 proceed.

**B3 — Needs-another-look flag and impact records.**
- *Governing rule:* EXP §5 ("Flag, not state: Needs another look"); EXP §6 Artifact, Needs another look ("The impact record's reason and the version it came from; 'Reviewed, unchanged' and 'New version' are the two ways out."); EXP §3 Changes; Flow D.
- *Must show:* (1) the flag beside, never replacing, the review-and-issue chip, with glyph and word; (2) the impact record — its reason, the changed source or claim, and the version it came from; (3) the two ways out and who may take them; (4) flagged dependents in the conversation after a correction or a re-acquired source (Flow D; 14.4).
- *Note:* corrected on 2026-09-25 (Part D item 2): `epics.md` gates 18.5b only; 18.5a (Slice 1) and the backend part 15.3 proceed.

**B4 — `reconcile` decision surface.**
- *Governing rule:* EXP §5 Wait ("`reconcile` shows as 'Needs your input · reconciliation'"); EXP §6 rows "unknown after dispatch", "provider accepted, delivery unconfirmed", "effect awaiting reconciliation" and "action blocked"; EXP §3 One decision surface; row 14.
- *Must show:* (1) only the recovery actions the recorded state permits (keep observing · mark done with reference · retry with duplication warning · abandon), where a retry that may duplicate says so and is never presented as safe; (2) the two receipt-chosen sentences, with no generic Retry while duplication remains possible; (3) a later blocked or failed attempt shown beside the earlier unresolved one, and a human resolution recorded and shown as a human resolution with its reference; (4) its entry in the attention view (B14).
- *Note:* corrected on 2026-09-25 (Part D item 2): `epics.md` gates 18.6c only; 18.6a, 18.6b and the backend part 12.6 proceed.

**B5 — Sharing a working draft versus issuance; PDF export.**
- *Governing rule:* EXP §1 ("Sharing a draft is not issuance"); EXP §6 Artifact, rendering blocked; EXP §7 rows "Share a working draft to an authorised destination" and "Issue a deliverable"; EXP §5 (Issued names the person and the date); P5 §4c Rendered formats.
- *Must show:* (1) the share decision on one decision surface — destination, disclosure, the exact version shared, labelled as a working draft, and its receipt; (2) issuance as a separate path with the approvals it needs, and the refusal when they are missing; (3) rendering blocked, listing the blocking defects, with harmless limitations under Technical details; (4) PDF export shown as unavailable until 15.6b and 17.6b land, never partial.
- *Note:* corrected on 2026-09-25 (Part D item 2): `epics.md` gates the share, issuance-refusal and rendering-blocked surfaces (18.6c, Slice 3) and the PDF export surface (15.6b, deferred); 18.6a, 18.6b and the backends of 15.6a and 15.7 proceed.

**B6 — Promotion approval; Awaiting approval and Pending regression.**
- *Governing rule:* EXP §3 Scheduled work (promotion from the task menu or by saying "run this monthly"; schedule details proposed and confirmed compactly; Awaiting approval until approved; the Permissions Version frozen at approval); EXP §4 "Method and promotion"; EXP §5 scheduled-check states; Flow G; rows 2, 3 and 17.
- *Must show:* (1) both entries — the task menu and "run this monthly" — reaching one path, with the schedule proposed in the conversation and confirmed compactly, and no mandatory schedule form; (2) the readable method view with Submit for approval, and on inspection the compiler mapping and the unresolved issues that block submission; (3) the second person's approval, bound to the version, with the independence refusal; (4) the Awaiting approval and Pending regression chips on the list and the result page, with no next run, and the responsible person named (Flow G).

**B7 — Regression case sets and a version pending regression.**
- *Governing rule:* EXP §5 (Pending regression: no next run); EXP §6 Scheduled check, Awaiting approval / Pending regression ("The state chip; no next run."); P5 §4c Regression.
- *Must show:* (1) a regression case set as a versioned, reviewed object bound to the candidate version, with who reviewed it; (2) Pending regression with no next run and what must happen next; (3) the regression outcome and, for 19.9b, the expected-difference review; (4) the blocked transition shown honestly while the capability is absent (P5 §4c).

**B8 — Retention decisions, holds, deletion.**
- *Governing rule:* EXP §2 Settings › Administration ("Data and retention" is named); EXP §4 design-gap table ("Data and retention is named, not designed"); P5 §4c Retention ("unavailable (never a hidden or partial delete)").
- *Must show:* (1) Data and retention as named and unavailable until 14.10's surface exists; (2) retention decisions and holds, with what each protects, who set it and why; (3) deletion refused while a dependency or hold exists, and otherwise confirmed in a destructive Settings dialog that names the object (DES §4 Forms; EXP §10 Dialogs).

**B9 — Tenant switching.**
- *Governing rule:* EXP §1 Multi-tenant (context "named in the workspace header in readable words (workspace name, client name, engagement title)"; switching carries nothing across); 18.3's check "a person in two firms switches tenants and carries nothing across".
- *Must show:* (1) where the current tenant is named (the header and the user block) and how a person in two firms switches; (2) nothing carried across — attachments, selected resources, pending confirmations, unsent drafts; (3) how outstanding decisions in the other tenant stay discoverable without merging tenants.

**B10 — Legacy procedures view.**
- *Governing rule:* EXP §2 Legacy procedures ("a view reachable from Engagements and from Search results of type Procedure `[TO DESIGN]` … reachable by their authorised auditors and reviewers, never administrator-only"); EXP §12; EXP §13 item 5.
- *Must show:* (1) the two entries, Engagements and a Search result of type Procedure, and how a compiler-1 Procedure is told apart from a procedure document such as RS 11's Kafue SharePoint file (F11-1); (2) compiler-1 Procedures and their Runs in the Zobba chrome, opening Run Detail, Live View and Replay under the 2026-09-01 spine's rules (EXP §12); (3) access for authorised auditors and reviewers, never administrator-only.

**B11 — Organisation connections.**
- *Governing rule:* EXP §6 Connections, organisation connections ("No empty 'Organisation connections' section is shown; the label is reserved (D-4b-3)"); EXP §13 item 1; rows 4 and 18.
- *Must show, when its contract exists:* (1) admin consent and the service identity; (2) availability per engagement; (3) labelling distinct from user-owned connections, with its own validation. Until then RS 14's organisation rows are not built and no empty section is shown.

**B12 — Invitation creation and acceptance.**
- *Governing rule:* EXP §6 Invitation rows ("Invited, with Copy invitation link; expiry shown in words `[TO DESIGN]`"; each refusal "names its recorded cause" `[TO DESIGN]`); EXP §6 Users and roles, last active Admin; Flow K; EXP §7 (Admin creates, copies and revokes invitations); EXP §10 (accessible authentication, redundant entry); FR-95.
- *Must show:* (1) Invite people → recipient, role (Auditor · Audit manager · Admin only), proposed engagement access → Create invitation → Copy invitation link, with the expiry in words; (2) acceptance by the verified intended recipient, meeting WCAG 2.2 accessible authentication; (3) each refusal naming its recorded cause (wrong recipient, expired, replayed, revoked, inviter no longer authorised), with the exact sentences written then and added to the exact-copy set if they are safety-critical (EXP §13 item 6); (4) Invited, Accepted, Expired and Revoked in Users and roles, and revocation.
- *Note:* corrected on 2026-09-25 (Part D item 2): the gate covers the invitation surfaces only — the creation surface in 18.12 and any acceptance surface 11.10 renders — first needed in Slice 3. 11.10's commands, copyable link, verified acceptance path and secret containment proceed in Slice 0 behind the existing surfaces (P5 §4a).

**B13 — Model replacement proposal for a check.**
- *Governing rule:* EXP §6 Scheduled check, model withdrawn, retired or policy revoked ("The execution state with its recorded cause (the three causes are distinct); a replacement is a proposed configuration change awaiting approval and regression `[TO DESIGN]`"); EXP §3 Model and effort; FR-93; row 5.
- *Must show:* (1) temporary provider failure, retirement and policy revocation as distinct recorded causes on the list and on the result; (2) the replacement as a platform-authored proposed configuration change routed to approval and regression, never an in-place choice (RS 22's helper is amended); (3) completed results unchanged.
- *Note:* corrected on 2026-09-25 (Part D item 2): `epics.md` gates 19.11b only (P5 §5: "before 9.11's replacement path"). 19.11a's detection and blocking proceed; its blocked state is shown with its recorded cause under EXP §6's sentence rule on 18.13's surfaces.

**B14 — The notification panel's complete attention view.**
- *Governing rule:* EXP §2 ("The complete attention view — every authorised open question, confirmation, reconciliation case, memory proposal, review request and result needing attention — is reachable from the notification panel (bell) as one linked view"); EXP §6 Attention view, loaded and empty ("Nothing needs you. Questions, confirmations, reviews and proposals will appear here.") and not loaded (Banner "Couldn't load what needs you. Nothing has changed."); EXP §6 Notification, unattended result; D-4b-2.
- *Must show:* (1) the bell's place in the shell and its count's accessible label — no reference screen draws it (F01-1); (2) the linked view listing every kind of item, with engagement and client attribution and a link to the decision; (3) the empty sentence and the not-loaded Banner, never confused; (4) the in-app notification "Zobba completed the [check name]" with the assessment in words.

**B15 — Input-quality expansion.**
- *Governing rule:* EXP §5 Input and coverage (Complete · Partial · Unavailable · Stale · Unknown · Out of period / Not applicable; "The summary chip is derived; it never removes a dimension …; expanding it shows each dimension"); EXP §4 Result and quality summary; row 15; DES §5 (`[TO DESIGN]` treatments and glyphs for Complete, Unknown, Out of period, Not applicable).
- *Must show:* (1) the treatments and glyphs for Out of period and Not applicable, reusing the Complete and Unknown glyphs designed under B22a; (2) the summary chip and its expansion into availability, coverage, freshness and period relevance, with unknown shown as unknown; (3) the chip beside, never merged with, the assessment chip (F13-1 is the counter-example); (4) its narrow-screen form.
- *Note:* mechanism 14.8. Corrected on 2026-09-25 (Part D item 2): `epics.md` gates 18.5b only; the Slice 1 input-and-coverage glyphs are B22a's.

**B16 — Settings › Methodology and skills: pack proposal and approval by Admin.**
- *Governing rule:* EXP §7 methodology row (Auditor and Audit manager: "propose from documents"; Admin: "versioned and audited; creator, maintainer and approver recorded; cannot bypass a platform safeguard, an independent approval or a client or engagement restriction; approved checks keep their pack version"); EXP §6 Methodology, no pack; EXP §2 Settings (Methodology and skills managed by Admin); D-4b-5; 18.7's check "an Auditor sees Methodology read-only".
- *Must show:* (1) the Admin view (RS 15 as amended): a change to an active pack, skill or template creates a new version that is approved and activated as an audited configuration change, never saved in place, and approved checks keep their pack version; (2) accountability records (creator, maintainer and approver as named people) in place of "Owner: Methodology team" and "owners only"; (3) the Auditor's read-only view and the "Prepare one from your documents" entry, unavailable until 16.7c; (4) the "No methodology configured" state with Select a starter pack.
- *Note:* corrected on 2026-09-25 (Part D item 2): `epics.md` gates 18.7b and the "Prepare one from your documents" surface of 16.7c only. 16.7a (its no-methodology sentence is EXP §6 copy), 16.7b's backend (its selection surface is 18.7b's), 18.7a and 18.7c proceed without this row.

**B17 — The activity summary above the composer, with Stop and the execution state.**
- *Governing rule:* EXP §2 Engagement workspace ("An activity summary above the composer shows the current step in audit words, open questions and unresolved actions, and expands into the full activity view on demand."); EXP §4 Activity list and summary ("The summary above the composer shows the current step and open items."); EXP §3 Guidance versus Stop, as amended by Part D item 3; Flow C; R11.2.
- *Must show:* (1) the collapsed summary — the current step in audit words, then each open question and unresolved action, each linking to its decision; (2) its expansion into the full activity view (RS 03's activity anatomy) and its collapse, without moving the conversation; (3) Stop beside the composer and the execution chip in the working state (Stop requested with "Stopping after the current step…", then Stopped by you) and in the waiting state, where Stop stays available on a nonterminal waiting task and Stop requested never says "Stopping after the current step…" when no step is executing (Part D item 3); (4) one animated mark per region (F02-2, F03-2); (5) its narrow and 600–1023 forms (B.3).
- *Note:* prerequisite mechanism 12.2 (task state, step ledger) and 12.9a (task live channel) proceed.

**B18 — Connecting a source from the conversation (Flow B).**
- *Governing rule:* EXP §8 Flow B ("Connections, or the conversation when a connection is needed → provider consent → back with the account, capabilities and readable designated resources shown as three things → return to the work."); EXP §2 Connections row; EXP §4 Connection card; EXP §6 Connections states; D-4b-3; P5 §4a Slice 1 ("Connect a personal Drive and choose designated folders (from the conversation, returning to the work)"); 18.7a's checks ("selection by readable identity; consent alone makes nothing usable; no tokens or scopes shown").
- *Must show:* (1) the conversation card that asks for a connection when a task needs one, naming the provider and why it is needed; (2) the hand-off to provider consent and the return, with consent alone making nothing usable; (3) choosing designated resources by readable identity — names and locations, never identifiers, tokens or scopes — with account, granted capabilities and permitted locations as three things; (4) the return to the work where it stopped, with any read still passing the Permissions gate; (5) Connecting… (spinner-free), a provider refusal or cancel, and Error with Technical details; (6) the resulting row in the minimal Connections list (RS 14 as amended); (7) its narrow and 600–1023 forms (B.3).
- *Note:* the backends 13.5, 13.6, 13.7 and 13.8a proceed; only the conversation and list surfaces of 18.7a wait.

**B19 — The auditor's review mode.**
- *Governing rule:* EXP §4 Artifact (**Review mode**: "a focused list of matters needing review, each opening its claim with class, support status, citations, validation records and lineage; decisions with their revision binding"); EXP §6 Artifact, matters needing review ("Header '2 matters need review'; the approval control states whether the methodology permits approval with limitations."); Flow D; D-4-3 (claim classes and internal states in inspection and review mode only).
- *Must show:* (1) the header count and the entry from reading view into review mode and back; (2) the focused list of matters, each opening its claim with class, support status (B22b's Claim support vocabulary), citations, validation records and lineage; (3) decisions bound to the revision, and what happens when the revision changed under the reader; (4) the approval control stating whether the methodology permits approval with limitations; (5) keyboard order and focus return from a matter to the list; (6) its narrow and 600–1023 forms (B.3).
- *Note:* prerequisites 15.1 and 15.2 proceed.

**B20 — Acceptance surface for a change Zobba proposes.**
- *Governing rule:* EXP §3 Changes ("**Zobba proposes; it never silently changes a conclusion**: changes Zobba originates are offered for acceptance."); R5.2; Flow D; D-4-2 (one coherent decision surface); P5 §4a Slice 2 ("an independently proposed material change follows its applicable decision rules").
- *Must show:* (1) the proposed change as a typographic diff with the affected conclusion, limitation and dependents named; (2) accept, decline and edit-first, with what each does and what stays unchanged; (3) the result — a new version with View changes and Undo — and the declined state with nothing changed; (4) invalidation when the draft changed after the proposal was made; (5) the entry in the attention view (B14); (6) its narrow and 600–1023 forms (B.3).
- *Note:* this is scene 4's main Slice 2 subject, because RS 09's decision is delivered in Slice 3.

**B21 — Review-note anchoring beyond RS 21.**
- *Governing rule:* EXP §4 Review note ("Anchored to a location in the paper ('On L2'), with author and state (draft or sent), in a column beside the page; focusing a note highlights its anchor"; inspection: "Author, exact version and location, response, disposition"); Flow L; FR-96; 15.9's contract (notes anchored to a location in the exact version).
- *Must show:* (1) anchors of each kind the paper has — a paragraph, a table cell, a citation, a claim, a limitation — and several notes on one anchor; (2) the anchor in the revised version: kept, moved, or gone, and how the note says so; (3) the preparer's response and the disposition, and Returned · n notes from the preparer's side (F21-2); (4) keyboard and screen-reader reach from a note to its anchor and back; (5) notes absent from the client rendering and present in the authorised export, as a rendering label only; (6) its narrow and 600–1023 forms (B.3).
- *Note:* prerequisite 15.9 proceeds.

**B22a, B22b, B22c — Glyphs and treatments still `[TO DESIGN]`.**
- *Governing rule:* DES §5 Rules ("Never colour alone"; "`[TO DESIGN]` marks a state for which the pack gives no glyph; a glyph is designed under the pack's rules before the story that renders it"); DES §5 Treatments (the `[TO DESIGN]` treatment row); DES §6 Untrusted-content rendering ("The Zobba-token visual treatment is `[TO DESIGN]`"); DES §8 Designs still to be made ("every `[TO DESIGN]` treatment and glyph in section 5").
- *Must show:* for each state the sub-row names, a glyph and a treatment from the section 3 semantic tokens, with the word as the label and the glyph `aria-hidden`; contrast at WCAG 2.2 AA on every surface the chip appears on; no reuse of Iris for an audit result. B22a also shows the untrusted-content treatment: inert plain text, labelled with where it came from, never rendered as markup.
- *Note:* B1 keeps the memory vocabulary, B6 the Awaiting approval and Pending regression chips, B12 the invitation vocabulary and B15 the Out of period and Not applicable states; no sub-row repeats them. Slice 4 needs no sub-row of its own.

### B.3 Narrow and intermediate widths (Part D item 4)

RS 17 and RS 18 are the representative narrow references for the initial shell direction. Each line below is a responsive state that no screen draws. Its surface part does not build that state until the state is designed and reviewed under the pack's rules (EXP §10; DES §4 Breakpoints: below 600, 600–1023, 1024 and up). A row of B.1 carries its own narrow states in its design.

| Surface part | Slice | States to design and review | Status |
|---|---|---|---|
| 18.3 Shell | 1 | Sidebar as a sheet below 600; the 600–1023 layout; the bell and the attention view at both widths; the header naming tenant, client and engagement at both widths | open |
| 18.4a Home and workspace | 1 | Home below 600 and at 600–1023; the panel as an overlay sheet at 600–1023; the decision card pinned above the composer; the full-screen workspace with its back control | open |
| 18.5a Reading view and evidence | 1 | Evidence as a sheet at 600–1023 and full-screen below 600, returning to the claim (Part C scene 3, item 8) | open |
| 18.6a–c Decision surfaces | 1–3 | The clarify card, the refusal notice, the Zobba-proposed change and the confirm-action and reconcile cards pinned above the composer; the per-operation outcomes at narrow width | open |
| 18.7a, 18.7c Connections | 1, 3 | The connect flow and the Connections list below 600 and at 600–1023 (18.7b's narrow states are part of B16) | open |
| 18.11 Reviews | 3 | The queue and a paper with notes below 600 and at 600–1023 | open |
| 18.12 Administration | 3 | Users and roles, invitations and Models and providers below 600 and at 600–1023 | open |
| 18.13 Scheduled checks | 4 | The list below 600 and at 600–1023 (RS 18 covers the result below 600 only) | open |
| 18.14 Search | 2 | Scope selector and grouped results below 600 and at 600–1023 | open |
| 18.8 View workspace (deferred) | deferred | The full-screen browser below 1024 with its safety controls | open (deferred) |

---

## Part C — Scene coverage

### C.1 Matrix

| Scene | Gate (P5 §4b) | Illustrated by | Register rows that must close before its visual acceptance |
|---|---|---|---|
| 1 · A new conversation | Slice 1 (18.10a) | RS 01, 19, 02; RS 10 (entry from an engagement) | B2, B14, B17, B18, B22a; B9 and B10 through 18.3, the shell the scene is walked in; the Slice 1 lines of B.3 |
| 2 · Active analysis | Slice 1 (18.10a) | RS 02, 03, 08, 17; RS 04 (browser, 18.8 deferred) | B14, B17, B22a; B9 and B10 through 18.3; the Slice 1 lines of B.3 |
| 3 · Artifact and citation inspection, reading and review modes | Slice 2 (18.10b) | RS 05, 06, 07; RS 21 (reviewer's side) | B3, B15, B19, B22b; B21 for the reviewer's side when 18.11 is walked (Slice 3) |
| 4 · A material decision | Slice 2 (18.10b); the external-effect decision is 18.6c, Slice 3 | RS 09, 08, 21; RS 07 (the no-ceremony edit) | B1, B3, B20, B22b; B5 if the decision exercised is a share or an issuance |
| 5 · An uncertain external effect | Slice 3 (18.10c) | RS 09, 16 | B4, B22c; B5 if the effect is a draft share |
| 6 · An unattended scheduled result | Slice 4 (18.10d) | RS 12, 13, 18; entries RS 01, 10, 20 | B6, B14; B7 if the example pack's first activation requires regression (19.9a; P5 §4c). B13 gates only the replacement path (19.11b, deferred; Part D item 2) |

The DES §5 `[TO DESIGN]` glyphs and treatments each scene renders are rows B22a–B22c (Part D item 1). Each scene's narrow and intermediate-width states are in B.3 (Part D item 4).

### C.2 Required behaviours no screen illustrates

**Scene 1 — A new conversation.**
1. A first request with no engagement: the draft engagement, the "Client not selected" header, the first reply naming what can be reached now and what needs a client, and the client-binding moment (EXP §6; Flow A) — B2.
2. The provisional, renameable title, and Zobba's plan editable in the panel (Flow A).
3. The notification bell and the attention view (EXP §2) — B14.
4. The tenant named in the header, tenant switching and the breadcrumb trail (EXP §1, §2) — B9.
5. First-run empty states (Engagements, Recent tasks) and "No methodology configured" (EXP §6).
6. The composer disabled with its reason (EXP §4 Composer).
7. Connecting a source from the conversation and returning to the work (Flow B; 18.7a) — B18.
8. Any narrow or 600–1023 frame — B.3.

**Scene 2 — Active analysis.**
1. Stop requested ("Stopping after the current step…"), then Stopped by you with what was kept (row 1; EXP §6); and Stop on a waiting task, with cessation recorded promptly when no operation is in flight (Part D item 3) — B17.
2. The activity summary above the composer, with open questions and unresolved actions (EXP §2, §4) — B17.
3. Guidance that conflicts with completed work, named with a question (EXP §3; P4).
4. On desktop, incoming work arriving as a conversation card while the panel is pinned or being inspected (EXP §3; Q7); RS 17 shows the card only because of its width.
5. Several outstanding questions listed, none over the composer (EXP §3, §10).
6. The EXP §6 workspace failure states: read interrupted, connection unavailable, unsupported content, self-review could not complete, budget reached, task interrupted with Resume, execution environment unavailable.
7. The refusal notice for an out-of-scope read (18.6a; P5 §4a Slice 1) and the inert rendering of retrieved content (EXP §10).
8. The model change noted in the activity (EXP §3, §6).
9. Returning to a task that restores its pinned panel (P2; EXP §2 Returning).
10. The 600–1023 overlay sheet, and the full-screen browser below 1024 with its safety controls (18.8, deferred).

**Scene 3 — Artifact and citation inspection in reading and review modes.**
1. Review mode: "n matters need review", each opening its claim with class, support status, citations, validation records and lineage, with decisions bound to the revision (EXP §4, §6) — B19.
2. Material limitations in the artifact header (EXP §4).
3. The result and quality summary with each input dimension, Unknown and Out of period kept (EXP §4, §5) — B15.
4. The Needs another look flag and its impact record (EXP §5, §6) — B3.
5. Undo producing a new version, and a Changes summary that names what changed (EXP §3; R5.5).
6. The full-page artifact ("Open full", EXP §2) and the rendering-blocked state (EXP §6).
7. Claim → evidence → return by keyboard (EXP §10) — provable only in the build.
8. Evidence as a sheet at 600–1023 and full-screen below 600, returning to the claim (EXP §10).
9. The preparer's view of Returned · n notes (Flow L) — B21 (18.11, Slice 3).

**Scene 4 — A material decision.**
1. The acceptance surface for a change Zobba proposes (R5.2; 18.6b, Slice 2) — B20; it is scene 4's main Slice 2 subject because RS 09's decision is delivered in Slice 3.
2. The memory-proposal decision — B1.
3. Needs another look: "Reviewed, unchanged" or "New version" — B3.
4. Invalidation ("Details changed since you last saw this"), and "Nothing was sent." after Don't send (EXP §3, §6).
5. Approve version bound to the revision, with rationale where the methodology requires it, and "You cannot approve a version you authored or contributed to." (Flow F; EXP §6, §7); the issue refusal.
6. The decision card pinned above the composer on narrow widths (EXP §10).
7. `role="alert"` announced once and no auto-focus on Allow (EXP §10) — provable only in the build.

**Scene 5 — An uncertain external effect.**
1. The sending state and per-operation outcomes in the conversation: success, failed before sending with Retry, partial with Edit invitation (EXP §6).
2. The two receipt-chosen sentences — unknown after dispatch; provider accepted — with no generic Retry while duplication remains possible (row 14; EXP §6).
3. "Needs your input · reconciliation" and the reconcile surface with only its permitted actions (EXP §5, §6) — B4.
4. A later blocked attempt beside the earlier unresolved one; a human resolution shown as a human resolution (EXP §6).
5. The Activity record's inspection words: Sent, not confirmed; Blocked; Failed before sending (EXP §5).
6. Any narrow frame.

**Scene 6 — An unattended scheduled result.**
1. The in-app notification "Zobba completed the [check name]" with the assessment in words, and the attention view (EXP §6; row 9) — B14.
2. Awaiting approval and Pending regression, with no next run — B6, B7.
3. Running ("Zobba is running this check") (EXP §5).
4. The EXP §6 scheduled-run sentences for an access failure and for a material change that needs re-approval; RS 12 shows only a wait.
5. A withdrawn, retired or revoked model with its recorded cause (EXP §6; FR-93) — B13.
6. "Why inconclusive" opening the Gate checklist; How it ran with the requested and actual model configuration per invocation (EXP §3, §4).
7. After Mark as reviewed, "Reviewed by [name] · date"; the responsible person named on the check (Flow G).
8. UTC plus local time; separate assessment and input chips (F13-1).
9. A No exception result: no screen draws that chip.

---

## Part D — Review record

| Field | Record |
|---|---|
| Date | 2026-09-25 |
| Reviewer | course-correction session agent (documentary review) |
| Scope and method | Each of the 23 PNGs viewed at its filed resolution (1280 × 800; RS 17 and 18 at 390 × 844, @2x), with the README's scenario; each checked against EXP §1–§14, DES §4–§8, 4b §1–§10, P5 §4a–§5 and the story parts in `epics.md` |
| Result | 23 of 23 screens have a verdict: 13 Accepted with amendments applied, 3 Accepted as illustrative reference, 7 Not a scene screen. Screens 03, 04, 06, 11, 14, 15, 17 and 18 are individually reviewed here. |
| Register | Revision 1 opened 16 rows (B1–B16). Revision 2 added 6 rows (B17–B21, and B22 as the sub-rows B22a–B22c) and the narrow-width table B.3. Every row is `open`; none is closed. |
| Slice 0 design item | P5 §4a's "23-screen review record" is complete: the owner signed the documentary review on 2026-09-25. The signature closes no register row. B9, B10 and B14 remain design prerequisites for the affected portions of 18.3 (Part E). |
| Owner sign-off | Given on 2026-09-25 by the owner, in writing in the course-correction session: "Approve the documentary screen review and its recorded findings, incorporating the decisions above." The approval covers the reviewed references and the recorded amendments. It does not close any undesigned-surface row, and it does not authorise implementation. Story 18.3 still needs its applicable design gates and explicit implementation authorisation. |

### Owner decisions on items 1–6 (2026-09-25)

The six questions of revision 1 and the owner's answers. Each answer is applied where the right column says.

| Item | Question (revision 1) | Owner's decision | Applied in |
|---|---|---|---|
| 1 | Register completeness: six gaps had no row | **Add rows or bounded sub-rows** for all six — the activity summary, the contextual connection flow, the auditor's review mode, the acceptance of a Zobba-proposed change, review-note anchoring, and the unresolved glyph and treatment specifications — each mapped to its owning story part and the slice that first needs it. A component variant, an annotated frame or a small interaction prototype can close a row where it is sufficient; not every gap needs a new full-page design. | B.1 and B.2: B17, B18, B19, B20, B21, B22a–B22c; "Closing a row" |
| 2 | Which gate list governs | **Follow Proposal 5's approved surface-part rule.** A missing design blocks the surface that needs it, not an unrelated backend prerequisite or an earlier bounded part. Correct `epics.md`. | Standing rules; the B.2 notes; `epics.md`, 37 gate lines — 31 rewritten, 6 added (table below) |
| 3 | Stop while a task waits | **Yes.** Stop stays available on a nonterminal waiting task, subject to the person's authority. Stopping a waiting task cancels its continuation without treating the outstanding question or confirmation as answered; its work and decision history are kept; a late answer cannot revive the cancelled task. **Stop requested** shows until cessation is recorded. When no operation is in flight, cessation can be recorded promptly, and the product never says "Stopping after the current step" when no step is executing. An already-dispatched external action stays subject to reconciliation: stopping neither undoes it nor resolves an unknown outcome. Stop applies to the selected task only. | EXP §3 Guidance versus Stop, §4 Composer, §6 Workspace rows, §14; B17 must-show (3); F08-2, F09-3 |
| 4 | Narrow-screen coverage | RS 17 and RS 18 are **representative references for the initial shell direction, not complete responsive acceptance.** Other narrow and intermediate-width states are designed and reviewed before their affected surfaces are built. | Standing rules; "Closing a row"; B.3; F17-5 |
| 5 | Engagements empty state | **Confirmed:** "No engagements yet. Start a conversation to begin." DESIGN aligned with EXPERIENCE. | DES §4 empty-states table; EXP §13 item 7 closed; EXP §14; F01-4 |
| 6 | Settings sections | **The reconciled structure:** Profile · Connections · Methodology and skills · Permission defaults · Organisation details · Administration, each shown and editable according to the approved capabilities. Connections leads to the same connection-management surface the sidebar reaches — never a second configuration store. Admin manages methodology configuration and the administrator-controlled defaults; engagement-specific Permissions stay on the engagement; a default never silently alters an active task or an approved check. Administration keeps Users and roles, Models and providers, Connections policy, Administrator limits, Data and retention, and Audit log. A function not yet implemented stays unavailable. **No standalone Notifications section in this release**; the in-app notification panel and the complete attention view stay required. | EXP §2 Settings row, §14; DES §4 Forms and settings, §6 Settings navigation; F15-3 |

**Item 6, one point left for the owner.** EXP §8 Flow J also lists **Systems and Sources** under Administration — the retained compiler-1 Target System registrations and Population Source bindings. The owner's list does not name them. This revision does not remove them from Flow J. They stay retained compiler-1 administration, reachable as today until their disposition story (EXP §12), and are not a section of the reconciled Settings column. The owner confirms or corrects this reading.

**Item 2, the `epics.md` gate lines as corrected.** "none" means the part builds no surface a row governs; its backend proceeds. Where B.3 has a line for an Epic 18 part, the part's gate also names those narrow and intermediate-width states; for the other parts, the narrow states are part of their rows' designs ("Closing a row").

| Story part | Slice | Gate before | Gate after |
|---|---|---|---|
| 11.10 | §4a (Slice 0) | B12 | B12 on its invitation surfaces only (first needed Slice 3); commands, copyable link, verified acceptance path and secret containment proceed |
| 12.1 | 1 | B2 | none; B2 gates 18.4a |
| 12.6 | 3 | B4 | none; B4 gates 18.6c |
| 14.10 | deferred | B8 | B8 on its retention surface only |
| 15.3 | 2 | B3 | none; B3 gates 18.5b |
| 15.6a | 3 | B5 | none; B5 gates 18.6c's share, issuance-refusal and rendering-blocked surfaces |
| 15.6b | deferred | B5 | B5 on the PDF export surface only |
| 15.7 | 3 | B5 | none; B5 gates 18.6c |
| 16.7a | 1 | B16 | none |
| 16.7b | 2 | B16 | none; the selection surface is 18.7b's |
| 16.7c | deferred | B16 | B16 on the "Prepare one from your documents" surface |
| 18.3 | 1 | B9, B10, B14 | B9, B10, B14 (unchanged) |
| 18.4a | 1 | B2 | B2, B17, B22a |
| 18.4b | 2 | B2 | none |
| 18.5a | 1 | B3, B15 | B22a |
| 18.5b | 2 | B3, B15 | B3, B15, B19, B22b |
| 18.6a | 1 | B4, B5 | B22a |
| 18.6b | 2 | B4, B5 | B20, B22b |
| 18.6c | 3 | B4, B5 | B4, B5, B22c |
| 18.7a | 1 | B16 | B18, B22a |
| 18.7b | 2 | B16 | B16 (unchanged) |
| 18.7c | 3 | B16 | B22a (connection states) |
| 18.8 | deferred | — | its B.3 line |
| 18.9 | 2 | B1 | B1 (unchanged) |
| 18.10a | 1 | — | B22a |
| 18.10b | 2 | — | B22b |
| 18.10c | 3 | — | B22c |
| 18.11 | 3 | — | B21, B22c |
| 18.12 | 3 | B12 | B12 (unchanged) |
| 18.13 | 4 | B6 | B6 (unchanged) |
| 18.14 | 2 | — | its B.3 line |
| 19.2 | §4a (Slice 4) | B6 | B6 on any promotion-approval surface this part renders; the compiler proceeds |
| 19.3 | §4a (Slice 4) | B6 | B6 on any promotion-approval surface this part renders; the lifecycle binding proceeds |
| 19.9a | 4 | B7 | B7 on its surfaces (the case set, Pending regression); the regression backend proceeds |
| 19.9b | deferred | B7 | B7 on its surfaces; the backend proceeds |
| 19.11a | 4 | B13 | none; its blocked state follows EXP §6 on 18.13's surfaces |
| 19.11b | deferred | B13 | B13 (unchanged) |

### Statement

The review changes no approved decision: D-4-1..4, D-4b-1..7 and D-5-1..7 stand as approved. The six answers above are the owner's decisions of 2026-09-25, recorded here and applied to EXP, DES and `epics.md` as documentation corrections; item 2 applies D-5-6 as approved and changes nothing in it. The review authorises no implementation. A verdict accepts a screen as a design reference, never as proof of behaviour (HANDOFF §7). No register row is closed.

---

## Part E — Design priorities for 18.3 (owner request, 2026-09-25)

Story 18.3 (the shell, Slice 1) does not start its surface work until rows B9, B10 and B14 close and its B.3 line is designed and reviewed, and until its implementation is explicitly authorised. The designs 18.3 needs, in the recommended order:

| Priority | Design | Why in this place | What 18.3 cannot show without it |
|---|---|---|---|
| 1 | B14 — the notification panel's complete attention view | D-4b-2 removed the Needs you page, so the bell is the only complete route to an outstanding decision; no reference screen draws the bell (F01-1, F06-4); scene 6's result and every waiting decision arrive through it | The bell and its count label; the linked view with engagement and client attribution; the empty sentence versus the not-loaded Banner; 18.3's check "an outstanding decision discoverable from the panel without searching old conversations" |
| 2 | B10 — the Legacy procedures view | It is the only route in the Zobba shell to the compiler-1 Procedures, Runs, Run Detail, Live View and Replay that Epics 4 and 5 built and that stay in service (EXP §12); F11-1 needs it to tell a compiler-1 Procedure from a procedure document | 18.3's check "a legacy Procedure opened by its auditor"; access for auditors and reviewers, never administrator-only |
| 3 | B9 — tenant switching | The header and the user block must name the tenant (EXP §1; F02-4); it is 18.3's own check | The tenant named at both places; the switch; nothing carried across; the other tenant's decisions discoverable without merging tenants |
| 4 | B.3, the 18.3 line — the shell below 600 and at 600–1023 | RS 17 and RS 18 show a task and a result, not the shell | The sidebar as a sheet; the bell and the header at narrow widths |

**What 18.3 does not wait for.** The fixed navigation labels, Reviews by responsibility and capability, the Engagements and Recent tasks lists with their empty sentences (item 5), the Settings column (item 6), and the breadcrumbs with the one-landmark rule are specified by EXP §2 and the pack. They are corrections the story applies under EXP's precedence, not register rows.

**After 18.3, in slice order.** Slice 1: B2 and B17 (18.4a), B18 (18.7a), B22a (18.10a and the Slice 1 parts that render those states), and the Slice 1 lines of B.3. Slice 2: B1, B3, B15, B16, B19, B20, B22b. Slice 3: B4, B5, B12, B21, B22c. Slice 4: B6, and B7 if the example pack's first activation requires regression (P5 §4c). Deferred: B8, B11, B13, and the deferred lines of B.3.
