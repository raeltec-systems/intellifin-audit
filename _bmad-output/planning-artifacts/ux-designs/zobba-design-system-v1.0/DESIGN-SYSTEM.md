# Zobba design system

This document covers foundations, layout, surfaces, iconography, motion, navigation, status, data, forms, search, connections, states, responsive behaviour and accessibility. Token values are in [DESIGN-TOKENS.md](DESIGN-TOKENS.md), and components are specified in [COMPONENT-INVENTORY.md](COMPONENT-INVENTORY.md). Interaction rules are in [EXPERIENCE-RULES.md](EXPERIENCE-RULES.md).

Items marked **[added]** were not specified by an earlier board and were completed in this pass, consistent with the approved system.

## 1. Layout

### Desktop grid

- The reference frame is 1280 × 800. Layout is built from fixed chrome plus flexible regions. There is no 12-column grid, because the product is a harness, not a page.
- The spacing scale is 4, 8, 12, 16, 20, 24, 32, 40 and 48. Page gutters are 32px (24px in conversation and 18px inside panels).

| Region | Size |
|---|---|
| Sidebar, expanded | 248px, Linen |
| Rail, collapsed | 52px, Linen; symbol + icons |
| Header | 52px task and panel headers; 60px page headers (Engagement, Scheduled, Connections, Permissions) |
| Conversation | Flexible, minimum 400px. Reading content is capped at 720px. |
| Workspace panel | Default 540px, minimum usable 420px, maximum 62% of the window. User-resizable in 20px steps. |
| Evidence drawer | 470px, overlays the right edge of the workspace |
| Page content (Search, list pages) | Maximum 800px, centred |
| Reading measure | 60–75 characters (about 72ch at 15px) |
| Artifact page surround | `surface.artifact-surround`, 18–28px padding, page shadow `shadow.page` |

### Layout modes

1. **Conversation only.** Sidebar plus conversation. This is the default for starting and for questions.
2. **Conversation and workspace.** The panel opens beside the conversation when there is something useful to inspect. The conversation keeps at least 400px, and the sidebar stays expanded while the window is 1280px or wider.
3. **Workspace focus.** Expand collapses the sidebar to the rail and gives the panel about 62% of the width. The conversation stays visible at 400–430px (Changes, Evidence).
4. **Full-screen workspace.** A second Expand (or ⌘⇧F) takes the whole window for browser sessions or large tables. The conversation becomes a bar at the bottom with the composer, Stop and the presence chip, so Stop and pending decisions stay reachable.
5. **Artifact inspection.** Same as focus mode. The page is rendered on the surround, and selection and citations are overlays.
6. **Evidence drawer.** A drawer over the right of the workspace. The claim stays visible and highlighted to its left. Esc or "Back to claim" closes it.
7. **Narrow screens.** See §13.

## 2. Surfaces, radii and elevation

| Level | Surface | Border and shadow | Examples |
|---|---|---|---|
| 0 | Canvas `#FBFAF7`, Linen sidebar | none | Conversation, sidebar |
| 1 | Paper `#FFFFFF` | 1px hairline | Workspace panel, cards, composer, tables |
| 1a | Artifact page on surround | `shadow.page` | Working paper |
| 2 | Paper | hairline + `shadow.popover` | Citation preview, menus, tooltips |
| 3 | Paper | hairline + `shadow.drawer` | Evidence drawer |
| 4 | Paper | `shadow.dialog` + scrim | Dialogs, used only where unavoidable: destructive confirmation in Settings, sign-in |

- Radii: 4 for citation chips, 6 for selection tags, 8 for buttons, inputs and tables, 12 for cards and confirmations, 16 for message bubbles, 18 for the composer and pill (999) for chips.
- **Hover:** `surface.hover` fill on rows and nav items, and the link colour moves to Iris strong. There is no lift or shadow on hover.
- **Selected:** a nav item gets a Paper fill with a hairline ring. A claim, block or table row gets an Iris outline or inset bar with `surface.selected-accent`.
- **Disabled:** `text.disabled` label and `action.disabled` fill. It is never the only indication of why something is unavailable, so a disabled control shows the reason as helper text or a tooltip.
- **Avoid cards.** Use lists with hairlines. Cards are for discrete objects only: a confirmation, an attachment, a working-data link.

## 3. Iconography

- Icons use a 24px grid (20px dense, 16px small) with a 2px stroke (1.5px at 16px), round caps and joins, and a 2.5px corner radius. They are outline only.
- Colours: default `text.secondary`, active `text.primary`, disabled `text.disabled`. They are Iris only when the icon itself is a link.
- Three kinds must never be interchanged:
  1. **Interface icons.** Actions and objects: search, attach, pin, expand, close, calendar, file.
  2. **Semantic glyphs.** ✓ ! ▲ ◐ ○ ✕ ‖. These always sit beside a word, in the status colour.
  3. **Zobba mark.** Identifies Zobba as the actor or shows its working state. It is never a bullet or generic icon.
- Don't use shields or locks for Permissions, sparkles or wands for AI, or robot or brain imagery.
- *[added]* The icon source is not supplied. Implement with a library matching these rules (for example Lucide at 2px, which matches the stroke and caps) and record the choice (Q5).

## 4. Motion

### Pair mark states

| State | Form | Motion | Where |
|---|---|---|---|
| Idle | Offset, still | none | Sidebar logo, Home, provenance |
| Working | Offset ↔ level | Each form travels 3 grid units toward level, holds, and returns. 3.6s cycle, `cubic-bezier(.45,0,.25,1)`, infinite while the step runs. | The current activity step, the presence chip, the active recent-task row, the working table row. **One animated mark per view region.** |
| Waiting for you | Level, still; right form as a 1.6-unit outline | none | "Zobba needs your input" or "…your permission", the waiting task row |
| Complete | Level → offset once | 1.1s, `cubic-bezier(.2,.7,.2,1)`, once, then idle | When a task finishes. The result chip carries the outcome. |

- **Reduced motion.** Working is shown level and still, with the activity text unchanged. Complete shows no settle.
- **Prohibited:** motion that implies pass or fail, progress percentages, pulsing, spinning, shimmering "AI" effects, and animating more than one mark in the same region.

### UI motion *[added]*

| Interaction | Duration | Easing | Behaviour |
|---|---|---|---|
| Hover | 120ms | standard | Colour only |
| Composer focus | 120ms | standard | Border to Iris, 4px wash ring |
| Panel open and close | 200ms | standard / exit | Width animates and content fades in after 80ms. The conversation never jumps: its scroll position is preserved. |
| Evidence drawer | 220ms | standard | Slides 24px and fades. The claim stays highlighted. |
| Popover and citation preview | 160ms | standard | Fades with a 4px offset and opens after a 300ms hover delay |
| Selection | 80ms | standard | Outline appears; no motion |
| Task state change | 160ms | standard | Chip text cross-fades. The mark changes state without extra flourish. |

All UI motion drops to an instant change under reduced motion.

## 5. Navigation

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

- **Expanded sidebar (248px):** the lockup at 20px, primary items, section labels (12/16, weight 600, `text.tertiary`), engagement entries ("Client · Engagement"), recent tasks, then Connections, Settings and the user block (name and organisation).
- **Collapsed rail (52px):** symbol, then icons for New task and Search, with a tooltip on each. It is used automatically in workspace focus mode and in Settings.
- **Active item:** Paper fill, hairline ring and weight 600 for the task row. Iris is not used for navigation.
- **Needs attention *[added]*:** a Graphite count badge (for example Scheduled checks "2": results not reviewed plus a check waiting for input). Connections shows "▲ 1" in the warning colour when a connection needs reconnecting. The badge has an accessible label ("2 need attention").
- **Task rows:** the working mark while running, the waiting mark while waiting for the auditor, and nothing when idle.
- **Library is not first level.** Its jobs are covered by Engagements (artifacts per engagement), Search (across authorised work) and Settings › Methodology and skills (templates).
- **Skills** are managed in Settings › Methodology and skills. Auditors meet skills where they are used: the composer's + menu, activity lines ("Using Leaver access test v3") and "How it ran".
- **Permissions** belong to each engagement (engagement page, composer chip, confirmation footer) and are not global navigation.
- **Narrow:** the sidebar becomes a full-screen sheet from a menu button. The task header shows a back control (44px).

## 5a. Roles *[added]*

All roles use the same harness: conversation first, with the workspace beside it. Roles add destinations. They don't create a separate application.

| Role | Adds to navigation | Can | Cannot |
|---|---|---|---|
| Auditor (primary) | — | Run tasks in assigned engagements; allow Zobba's external actions within engagement permissions; prepare and submit work | Review own work; change administrator limits |
| Audit manager | **Reviews** (first level, with a count badge) | Everything an auditor can do; review, return with notes, approve; set engagement permissions within administrator limits; see team work in engagements they review | Change administrator limits |
| Methodology owner | — | Maintain skills and templates (Settings › Methodology and skills) | — |
| Administrator | **Settings › Administration** (Users and roles, Models and providers, Connections policy, Administrator limits, Data and retention, Audit log) | Manage people, roles, connections, models and administrator limits | Review or approve audit work |

- **Reviews** lists submitted work and unattended results, grouped as Waiting for your review, Returned with your notes and Reviewed recently. Each row shows the preparer and the review-status chip. An unattended result also shows its assessment chip, separately.
- **Reviewing a paper.** The manager can ask Zobba about the paper, and the answers carry citations. Review notes are anchored to a location in the paper. They are not exported and go to the preparer when the paper is returned. The actions are **Return with n notes** and **Mark as reviewed**. Approval and issue are separate steps.
- **Separation of duties.** An administrator cannot review or approve, and a preparer cannot review their own work.

## 5b. Model and reasoning effort *[added]*

- **In the composer:** a chip reading "[Model] · [Effort] ▾", placed after the context chips and before Stop and Send. It opens a menu:
  - Model list: name, provider and a short note.
  - Unavailable models are shown disabled, with the reason ("Not available here: Northstar data must stay in the EU").
  - Reasoning effort as a segmented control: Low · Medium · High · Max.
  - Footer: "Set by your administrator · recorded in How it ran".
- **Scope.** The choice applies to the current task. A change mid-task applies from the next step and is noted in the activity ("Switched to GPT-6 Sol · High from the next step").
- **Provenance.** The model, provider and effort for each step are recorded in How it ran and in the Activity record. They are not shown on artifact pages.
- **Scheduled checks** keep the model and effort they were created with. If a model is withdrawn, the check pauses and its owner is asked to choose another.
- **Administration › Models and providers:** providers and models, processing region, which engagements each is available for, default model, default effort, and toggles for "Auditors can change the model" and "Auditors can choose Max effort".
- Model names in the reference screens (Claude Opus 5.5, Claude Sonnet 4.6, GPT-6 Sol, GPT-6 Luna, Gemini 3.1 Pro) are current examples. The list comes from configuration, not from design.
- Don't use provider logos in the menu. Use names only, so the menu stays calm and vendor-neutral.

## 6. Status system

The six status dimensions are separate. They never merge into one chip, and brand presence never implies an audit result.

| Dimension | Values (label → meaning) | Visual |
|---|---|---|
| **Execution** (a task or run) | Not started · Running ("Zobba is reading/analysing/…") · Paused · Stopped by you · Completed · Didn't run · Interrupted | Running uses the working mark and Iris chip. Didn't run and Interrupted use ✕ plus exception-red text for the execution state only, with a reason. The rest are neutral text. |
| **Wait** | Needs your input · Needs your permission · Queued (guidance) | Waiting mark, neutral Linen chip |
| **Input and coverage** | Complete · Partial (L-reference) · Unavailable · Stale | ◐ dashed neutral for partial, ▲ warning for unavailable or stale |
| **Audit assessment** | No exception · Exception(s) · Inconclusive · Not assessed | ✓ green · ! red · ◐ dashed neutral · no chip |
| **Review and issue** | Draft · Not reviewed · In review · Reviewed by [name] · Approved · Issued · Superseded | Outline chip. Reviewed, Approved and Issued always name the person and date. |
| **Connection** | Connected · Connecting · Limited · Needs reconnecting · Disabled · Error · Not connected | ● neutral for connected, ▲ warning for needs reconnecting or error, – for disabled, ○ for not connected |

Rules:
- **"Completed" is execution, not assessment.** A completed run can be Inconclusive.
- **"Didn't run" is about the schedule, not the control,** and shows no assessment.
- Every chip has a glyph and a word. Colour is never the only cue.

## 7. Tables and data

- **Header:** 12/16, weight 600, `text.secondary` on Canvas, sticky within the panel.
- **Rows:** 13/18, 9–10px vertical padding and `border.divider-inner` between rows.
- **Alignment:** numbers and dates right-aligned with tabular figures; identifiers in Plex Mono 12.
- **Selected row:** Iris inset bar (2px) with `surface.selected-accent`. The row being processed shows the working mark and "Matching" in Iris strong.
- **Exception cell:** "! Still active" in exception red, weight 600. It is a cell, not a full-row fill.
- **Limitation:** ◐ in the row's status column with the L-reference ("◐ L1").
- **Matched and unmatched *[added]*:** unmatched records are listed under a group header "Unmatched · n" with a reason column ("No account found", "Name mismatch"). They are neither red nor hidden.
- **Grouping:** a group header row (13px, weight 600) with a count and a collapse chevron.
- **Large populations *[added]*:** virtualise the rows. The footer states "Showing 6 of 23 leavers · 1,516 accounts compared". For more than 10,000 rows, offer filters first and never show a fabricated total.
- **Filters and sorting:** filter chips above the table (All · Still active · Unmatched) and a header click to sort, with an arrow and `aria-sort`.
- **Column resize:** a drag handle in the header gap, with a minimum of 64px and double-click to fit.
- Tables look like professional audit data (a spreadsheet or report), never terminal output.

## 8. Forms and settings

Forms appear in Settings (Connections, Methodology and skills, Permission defaults, Administration, profile, organisation). They never take over ordinary audit work. Anything an auditor needs to decide during a task is asked in the conversation.

| Control | Spec |
|---|---|
| Label | 13/18, weight 600, above the field |
| Input and select | 36px high, radius 8, 1px `border.input`, 12px padding. Focus: 2px Iris ring. |
| Textarea | Minimum 3 lines, resizes vertically |
| Multiselect | Chips inside the field, each with a remove ✕ |
| Checkbox and radio | 16px, 1.5px `border.input`. Checked: Graphite fill with a white glyph. |
| Toggle | 36 × 20, Graphite when on. The label sits to the right and states the "on" meaning. |
| Date and time | Shows the time zone ("10:00 CAT (UTC+2)"). Scheduled checks show UTC plus the local time. |
| File selection | Drop zone plus a button, listing the file name, size and destination |
| Help | 12/16 `text.tertiary` below the field |
| Error | ! and message in exception red below the field, 1.5px red border, message linked with `aria-describedby` |
| Success | ✓ inline "Saved" beside the Save button for 3s. No toast. |

Primary actions are Graphite ("Save changes"). Destructive actions use an exception-red outline and are confirmed in a dialog that names the object.

## 9. Search

- **Scope-aware.** The scope selector reads "All authorised work", or one client or one engagement.
- **Results** are grouped by **client · engagement**. Each result shows its type (Working paper, Task, Source, Scheduled check, Procedure), title, an excerpt with the match in weight 600, the location and the date.
- **Client contexts are never merged.** Results from two clients appear in separate groups, and a task started from a result works inside that result's engagement only.
- States:
  - Empty (recent searches).
  - Loading ("Searching Northstar Bank…" for each scope).
  - Results.
  - No results ("No results in authorised work for 'x'", with the scope named).
  - **Incomplete or stale index** ("▲ Kafue SharePoint results may be incomplete…" plus Reconnect). A partial result must never look complete.
  - Direct-source continuation ("Search the Northstar shared folder directly").

## 10. Scheduled checks

| State | Treatment |
|---|---|
| Active | "Active · Mondays 06:00" |
| Paused | "‖ Paused by you, 2 Oct". No next run. |
| Next run | Date and time with the time zone |
| Running | Working mark + "Zobba is running this check" |
| Waiting for input | Waiting mark + "Waiting for your input" + the reason |
| Completed | "Completed 06:14", then the assessment chip, then the review chip, as separate chips |
| Inconclusive | ◐ dashed chip (assessment) |
| Didn't run | ✕ "Didn't run" + the reason + the recovery action. No assessment. |
| Review pending | ○ Not reviewed, then "Reviewed by [name] · date" |

The Zobba mark (one colour, 14px) identifies the actor ("Zobba ran this unattended"). The semantic chip identifies the outcome. They are never merged.

## 11. Connections

- Rows show the system name, the account or resource identity (for example "daniel.okonjo@lumina-assurance.com", "Northstar organisation connection"), the scope in plain words ("Read-only · users and sign-in history only"), the state and an action.
- The states are: ● Connected · Connecting (spinner-free: "Connecting…" text) · Connected, limited ("Limited to 2 areas") · ▲ Needs reconnecting (reason and consequence: "Search results and the daily change log check are affected") · Error (message plus Technical details) · – Disabled by administrator · ○ Not connected.
- **Personal** connections (your Outlook) and **organisation** connections ("set up by Northstar IT") are labelled differently.
- Always show: "A connection lets Zobba reach a system. It doesn't grant every resource in it: engagement permissions and the system's own access still apply." Never show tokens or OAuth scopes. Technical details live behind a disclosure.

## 12. Empty, loading, error and degraded states

| Situation | Message pattern | Must not |
|---|---|---|
| No engagements | "No engagements yet. Your administrator adds engagements, or you can start a task without one." | Look like an error |
| No recent tasks or schedules | "Tasks you start appear here." / "Turn a finished task into a scheduled check from its menu." | |
| No search results | "No results for 'x' in [scope]." + a broaden-scope link | Hide a stale index |
| Connection unavailable | "I can't reach AccessGate right now, so I haven't read the sign-in history." + Retry | Look like "no sign-ins" |
| Source incomplete | Limitation line (◐ L1) + what's missing | Look complete |
| Unsupported content | "I couldn't read the scanned pages 5–7 of this PDF." + options | Skip silently |
| Unable to complete review | "I couldn't finish validating the conclusions. Here's what I checked and what's left." | Claim success |
| Execution environment unavailable | "Zobba can't run tasks at the moment. Nothing has been sent or changed." + Technical details | Blame the user |
| Task interrupted | "This task stopped at 'Comparing…'. Work so far is saved." + Resume | Restart silently |
| External action uncertain | "I sent the email, but Outlook didn't confirm delivery. Check Sent items before resending." | Say it failed |

Loading uses skeleton rows in tables and activity text in conversation. There are no spinners with the Zobba mark.

## 13. Responsive

| Width | Behaviour |
|---|---|
| ≥ 1600 (large) | Panel default 600px; conversation reading content capped at 720px and centred in its region |
| 1024–1599 (desktop, reference 1280 × 800) | As specified |
| 600–1023 (tablet, narrow desktop) | Sidebar collapses to the rail. The workspace opens as an overlay sheet over 80% of the width, with the conversation dimmed but visible at the left edge. Evidence opens as a sheet inside it. |
| < 600 (mobile) | Conversation is the default view. The workspace opens full-screen with a back control. Evidence opens full-screen and returns to the claim. The sidebar is a sheet. |

On every size, **Stop, open decisions (clarification, permission), and current material limitations** stay reachable without scrolling: Stop sits beside the composer, the decision card is pinned above the composer, and limitations are inline in the conversation. Targets are 44px minimum on touch.

## 14. Accessibility

Accessibility is also written into each component in [COMPONENT-INVENTORY.md](COMPONENT-INVENTORY.md). The items below are split by what the design settles, what has been checked at design level, and what can only be proven in the built product.

### Requirements

- Target WCAG 2.2 AA.
- Text contrast is 4.5:1, or 3:1 for text of 18.66px bold / 24px and above. Non-text contrast is 3:1 for input boundaries, focus indicators and meaningful graphics.
- Status is never conveyed by colour alone: every status has a word and a glyph.
- Everything is keyboard operable in a logical order: sidebar → conversation → composer → workspace → drawer. F6 cycles regions. Esc closes the drawer or popover and returns focus to the originating claim.
- A visible focus ring (2px Iris, offset 2px) on every interactive element.
- Reduced motion is honoured (§4).
- Targets are at least 24 × 24px on desktop (WCAG 2.5.8) and 44px on touch.
- **Claim → evidence → return.** A citation is a button named "Evidence E6.2, AccessGate sign-ins, Kelvin Chanda". Opening it moves focus into the drawer heading, and "Back to claim" (or Esc) returns focus to the citation.
- Conversation updates are announced politely (`aria-live="polite"`) at step granularity, not on every token. Permission and clarification requests use `role="alert"` once.
- Tables use real table semantics, `aria-sort` and header scope. The row being processed is announced as "Matching".
- The working mark is `aria-hidden`. The adjacent text carries the meaning.

### Design-level checks (done)

- Contrast is calculated for every colour pair used ([DESIGN-TOKENS.md §3](DESIGN-TOKENS.md)). The input border and placeholder were corrected in this pass.
- The reference screens use words and glyphs for every status.
- Touch targets are 44–48px in the narrow frames.

### Must be verified in the implemented application

- Screen-reader output for streaming conversation, drawer focus return and table virtualisation.
- Keyboard traps in the full-screen workspace and browser sessions.
- Zoom to 200% and 400% reflow, and Windows High Contrast / forced colours (the symbol needs a `forced-color-adjust` fallback to one colour).
- Reduced-motion behaviour, and rendered contrast in dark OS notification templates.
