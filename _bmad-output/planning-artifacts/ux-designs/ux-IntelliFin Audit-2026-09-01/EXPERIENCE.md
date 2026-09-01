---
name: IntelliFin Audit
status: final
created: 2026-09-01
updated: 2026-09-01
sources:
  - ../../briefs/brief-IntelliFin Audit-2026-08-31/brief.md
  - ../../prds/prd-IntelliFin Audit-2026-08-31/prd.md
  - ../../prds/prd-IntelliFin Audit-2026-08-31/addendum.md
  - ./DESIGN.md
  - ./claude/DESIGN-HANDOFF-NOTES.md
---

# IntelliFin Audit — Experience Spine

`DESIGN.md` is the visual identity reference; this spine is the experience. Both inherit the IntelliFin Design System. Requirement identifiers (FR-n, NFR-n, UJ-n, addendum §x) are the PRD's, revision 2. → Composition reference: `claude/mockups/IntelliFin Audit.dc.html`; `reconcile-claude-design.md` lists where the prototype predates revision 2. This spine wins on conflict.

## Foundation

Desktop-first responsive web, single surface, three roles (Auditor, Audit Manager, PoC Administrator; FR-2). The IntelliFin Design System supplies the shell (Sidebar, top bar, EnvironmentRibbon) and base components; IntelliFin Audit adds the audit-native patterns named in `DESIGN.md.Components`. Synthetic PoC environment: Northstar Financial Group, one tenant, UTC everywhere.

The primary mental model is **Procedure → Run → Agent Workspace → Evidence → Result → Auditor Review** (PRD §1). The agent's work is the core experience; the Result is what the Auditor is accountable for. Four things the interface never does: let a human map a value the Compliance Rule does not name, let free text reach the agent, let an unsealed or Inconclusive Result be submitted, or present an empty list as a passed control.

## Information Architecture

| Surface | Reached from | Purpose | Primary object |
| --- | --- | --- | --- |
| Overview | Sidebar (default) | What ran, what needs attention, what changed, whether Evidence is trustworthy | Needs-attention list |
| Procedures | Sidebar | Procedures with their Active version, Schedule, next Run, last outcome; "New procedure" | Procedure card |
| Procedure Builder | Procedures → New procedure; Procedure Detail → New version | Author or revise a Procedure from a Template (FR-4..FR-12) | Plan preview |
| Procedure Detail | Procedures → name | Versions and their states, approval, Schedule, Run history, Initiate Run | Active version |
| Version review | Notification; Procedure Detail → Submitted version | Audit Manager approves or rejects with diff (FR-13) | Diff |
| Runs | Sidebar; Overview → All Runs | Filter and inspect Runs; upcoming and missed scheduled Runs (FR-48) | Run row |
| Run Detail | Any Run identifier | Tabs: Result · Evidence · Exceptions · Review · Execution Timeline | Conclusion triptych |
| Live View | Run Detail (active Run) → Watch; notification | Watch, pause, cancel, answer Escalations, flag (FR-24..FR-28) | Session viewer |
| Replay | Run Detail (terminal Run) → Replay | Replay from the Timeline and Replay asset set (FR-30) | Session viewer |
| Exception Detail | Run Detail → Exceptions → identifier | Provenance, grounding, per-condition evaluations, disposition (FR-41, FR-42) | Provenance chain |
| Review | Sidebar | Results awaiting decision; finalized Results (FR-43) | Queue row |
| Notifications | Top bar bell; email link | Awaiting Auditor and flagged Runs with time remaining (FR-28) | Notification row |
| Administration | Sidebar (PoC Administrator only) | Users and roles, Target System registrations, Population Source bindings, Workspace Provider and Audit Runner health, diagnostics (FR-7, FR-49) | Registration row |

Sidebar areas: Overview · Procedures · Runs · Review · Administration, with counts on Runs (active) and Review (awaiting). Run Detail, Exception Detail, Live View, and Replay highlight Runs; Builder, Procedure Detail, and Version review highlight Procedures. Breadcrumbs on every detail surface ("Runs / RUN-2437 / Live"). Modal stacks one level deep.

Closure: every UJ lands on a surface above; every surface is entered by at least one Key Flow below.

## Voice and Tone

Microcopy. Brand voice lives in `DESIGN.md.Brand & Style`.

| Do | Don't |
| --- | --- |
| "Evidence Quality Gate passed. 11 accounts across 6 terminated employees evaluated; 1 Exception." | "Great news — the run finished!" |
| "Evidence incomplete. No control conclusion issued." | "Something went wrong." |
| "Waiting for you: the search for E-005102 returned two candidates. Choose by full name or mark the record ambiguous." | "The AI isn't sure — can you help it out?" |
| "Result is unsealed: 1 Agent-Judged evaluation awaits your confirmation." | "Pending AI review" |
| "Only an Audit Manager can approve a submitted Result." | disabled button with no reason |
| "This Run remains unchanged." after every corrective action | implying a rerun edits history |

Rules: sentence case; domain nouns capitalized as defined terms (Run, Result, Evidence, Exception, Procedure Version, System Outcome, Auditor Review, Target System, Population Source); the agent is "the Audit Agent" or "the agent", never "it thinks" or "it wants"; every guard sentence names the object it protects ("The Rule-Classified evaluation and the sealed outcome remain unchanged and visible."). Identifiers, timestamps (ISO 8601 UTC, original offset retained), amounts (`USD 250,000.00`), counts with thousands separators, periods as `2026-08-25 → 2026-08-31`, durations as `3m 41s`, absent values as `—`.

## Component Patterns

Behavioral. Visual specs live in `DESIGN.md.Components`.

| Component | Use | Behavioral rules |
| --- | --- | --- |
| Status badge | Everywhere | Family + icon + word from `DESIGN.md.Colors`; never colour alone. Badge text is the state's exact name. |
| Conclusion triptych | Run Detail → Result | Cells are lifecycle, Gate, outcome. Outcome cell shows Pending Confirmation with count of pending evaluations while unsealed; sealed marker and Result version once sealed. Statement below is generated from the Result (FR-40). No cell is clickable; the tabs are the navigation. |
| Gate checklist | Result (compact), Evidence (expanded) | Rows from addendum §H grouped per-Observation / Run-level. Per-Observation rows update live during a Run (FR-20). Each failed row links to the affected Work Items. Header count derived. |
| Population reconciliation | Result | File-level then inclusion-level rows (FR-33). Excluded rows expand to the exclusion reason list. Empty post-inclusion population renders as Inconclusive unless the version opted in (FR-6). |
| Evaluation card | Result, Exception Detail | One per condition per record. Pending Agent-Judged cards carry Confirm / Reject; Reject opens the rationale dialog and requires Compliant · Exception · Unevaluated. Confirmation increments the Result version; the last confirmation seals the Result (FR-38, FR-40). Rule-Classified cards have no controls; "Record disagreement" lives beside them (FR-44). Low-confidence evaluations show as Unevaluated with the confidence and no controls. |
| Grounding inspector | Exception Detail, Evidence | Click an attribute to open its Structural Snapshot at the locator; corroboration badge explains any mismatch; model-read attributes say so and link to the condition they made Agent-Judged (FR-33). Human-matched badge links to the Escalation answer that matched the record (FR-27). |
| Provenance chain | Exception Detail | Population record → Observation (grounding, corroboration, match origin) → evaluations → Exception → Timeline segment; last step opens Replay at that Tool Action (FR-41). |
| Execution Timeline | Run Detail → Execution Timeline | Nested rows: Session Step › Work Item › Step Execution › Tool Action (FR-29). Collapsed to Work Items by default; Escalations, retries, errors, limits consumed, and version stamps expanded inline. Every row has "Open in Replay". Written live while Running. |
| Session viewer | Live View, Replay | See State Patterns → Live View. Frames are Replay assets; scrubber and Step list jump; Replay never re-executes anything (FR-30). Adapter Session Steps show as log rows. |
| Escalation panel | Live View, Run Detail, notification | One open Escalation per Run. Kind, Step, agent-generated question rendered inert, supporting Evidence, closed answer buttons, optional note "Recorded, not sent to the agent", countdown. Answer opens a routine confirmation; *abort* opens the cancel confirmation (FR-27). After answering, the panel becomes a Timeline entry. |
| Procedure Builder sections | Builder | Template pre-populates every section (addendum §C). Changing any field re-derives the plan; the preview shows "Re-deriving…" then "Re-derived {time}" and the re-derivation is logged (FR-12). Sections validate on blur: missing declared-count mechanism, upload with a non-`once` Schedule, scope-widening instruction, uncompiled condition without applicability, all shown inline with warning colours. Submit is blocked while any blocker or an underivable plan exists, with the reason listed. |
| Compliance Rule editor | Builder | Each condition row: text, compiled/Agent-Judged badge, applicability predicate (default `found = true`), boundary semantics selector for comparisons, tolerance as a compiled numeric condition (FR-9). Confidence threshold for Agent-Judged evaluations set once per version (FR-38). |
| Plan preview | Builder, Procedure Detail, Version review | Read-only rows: Session Steps, Plan Steps per Target System, Observations to capture, compiled and Agent-Judged conditions, credential references, limits, model identity. No Edit controls; editing happens in the sections. |
| Version review | Version review surface | Diff against the previous version by section; approver identity blocked from self-approval with a stated reason (FR-2, FR-13). Approve / Reject with rationale. Approving a version whose model, prompt, tool, or registration digest changed starts the regression Run and shows it inline (FR-15). |
| Action bar + unavailable actions | Run Detail, Exception Detail, Procedure Detail | Actions keep position when disabled; each disabled action's reason appears in the panel and as the button's accessible description. Export Workpaper Bundle is available on any terminal Run (FR-46). |
| Confirmation dialog | All mutating actions | Two weights per `DESIGN.md`. Rationale field required and validated non-empty for reject, disagreement, Not an Exception, and rejecting an Agent-Judged evaluation. Focus trapped; Escape cancels; initial focus on the first field or Cancel. Confirmation result shows as a Banner on the surface the user is on. |
| Filter bar | Runs, Review | Procedure select lists every Procedure; status chips single-select over all eight lifecycle states plus Pending Confirmation and Regression; initiator chips Manual · Schedule (FR-48). Search matches identifier, Procedure, initiator. Clearing filters resets all three. |
| Notification row | Notifications, top-bar menu | One row per Awaiting Auditor or flagged Run: Procedure, Run, Escalation kind, time remaining; opens Live View. Delivered in-app and by email; delivery recorded on the Audit Trail (FR-28). |
| Empty state | Anywhere | Headline + one sentence that names what would appear and refuses to imply a passed control. Never a call to action that mutates. |
| Rail cards | Detail surfaces | Procedure Version and Schedule; Auditor Review state; Change since previous Run (fingerprint-based, only across compatible versions, else "Not comparable — versions differ"); Technical detail → Timeline; Open Escalation (while Awaiting Auditor); Session (Watch or Replay). |

## State Patterns

### State families

| Family | States and transitions | Always accompanied by |
| --- | --- | --- |
| Procedure Version (addendum §E) | Draft → Submitted → Approved / Rejected; Rejected → Draft on edit; Approved → Active (immediately, or after the regression Run) → Retired at the next period boundary after a newer version is Active | Approver, time, diff; regression Run link while Approved-not-Active |
| Run lifecycle (FR-18) | Queued → Running ⇄ Paused; Running → Awaiting Auditor → Running; Running → Completed (Gate pass) or Inconclusive (Gate fail); Completed → Inconclusive only at sealing when a rejection leaves a condition Unevaluated; terminal Run Failed, Canceled | Paused and Awaiting Auditor show a countdown (30 min, 4 h) and what happens at timeout (Inconclusive) |
| Evidence Quality Gate | Not evaluated → Passed / Not passed / Incomplete | Failed rows with diagnostics and Safe next action |
| Result outcome (FR-40) | Pending Confirmation (unsealed) → sealed Pass or Control Failure; No conclusion issued for Inconclusive, Run Failed, Canceled | Result version; pending-evaluation count; sealed marker |
| Auditor Review (addendum §E) | Draft → Submitted → Approved → Finalized; rejection is an event that returns Submitted → Draft | Review history with actor, time, rationale; Finalized locks every mutation with "Mutation is denied and logged." |
| Exception (FR-42) | Open → Under review → Confirmed / Not an Exception | Disposition history; Not an Exception keeps the evaluation and outcome visible |
| Work Item (addendum §E) | Pending → In progress → Observed / Uninspected / Ambiguous / Failed; Ambiguous → In progress on a *choose candidate* answer; In progress → Awaiting (retry or skip) → In progress / Uninspected | Timeline segment; Escalation link while Awaiting |

### Per-surface states

| Surface | State | Treatment |
| --- | --- | --- |
| Overview | No Runs yet | EmptyState: "No Runs yet. No Procedure has run in this environment. An empty Overview does not mean a control passed." |
| Overview | Nothing needs attention | EmptyState: "Nothing needs attention. No Result awaits confirmation or review, no Run is waiting on you, and none is Inconclusive or Run Failed. This does not imply that any control passed." |
| Overview | Attention items | Ordered: Awaiting Auditor (countdown) · Pending Confirmation · Submitted for review · Approved awaiting finalization · Inconclusive · Run Failed · missed scheduled start. Each row names the Run, Procedure, state, and one action. |
| Procedures | No Procedures | EmptyState with "New procedure" as the only action. |
| Procedure Detail | Draft only | Versions list with Draft badge; "Submit for approval" primary; no Initiate Run. |
| Procedure Detail | Submitted | Approval pending banner naming who can approve; author sees "You cannot approve your own version." |
| Procedure Detail | Approved, regression pending | Regression Run row with its own Run link; Schedule shows "Activates after regression Run passes." |
| Procedure Detail | Active | Schedule with next Run time; Initiate Run enabled; New version creates a Draft copy. |
| Procedure Detail | Retired version selected | Read-only, "Retired {time}; superseded by v{x}." |
| Builder | Template chosen | Every section pre-filled; plan preview derived. |
| Builder | Validation blockers | Inline warnings per section; Submit disabled with a listed reason; plan preview shows "Cannot derive: {reason}". |
| Builder | Upload with scheduled frequency | Blocker: "A manual upload is valid only for a `once` Schedule. Bind a versioned file or an API for weekly Runs." |
| Runs | No matching filters | EmptyState filtered variant with Clear filters. |
| Runs | Missed scheduled start | Row with warning icon, "Missed 06:00 UTC start; not run", link to diagnostics (FR-17). |
| Run Detail | Queued | Triptych: Queued · Not evaluated · No conclusion; Evidence tab empty state "No Evidence collected." |
| Run Detail | Running | Live Gate rows updating; "Watch" in rail; Cancel and Pause enabled. |
| Run Detail | Paused | Banner with countdown "Paused by Daniel Okonjo at {time}. Resumes on your action; ends Inconclusive at {time}." Resume and Cancel enabled. |
| Run Detail | Awaiting Auditor | Escalation panel at the top of every tab; countdown; Answer, Cancel enabled; Pause disabled with reason "A Run waiting on an answer cannot be paused." |
| Run Detail | Completed, unsealed | Outcome Pending Confirmation with "{n} Agent-Judged evaluations await confirmation"; Submit disabled: "Submission is unavailable while the Result is unsealed." |
| Run Detail | Completed, sealed | Pass or Control Failure; Submit enabled for Auditor and Audit Manager. |
| Run Detail | Inconclusive | Failed Gate rows first; Safe next action panel; Submit disabled: "Submission is unavailable for an Inconclusive Run. No conclusion exists to review." Export enabled. |
| Run Detail | Run Failed | Execution-failure panel naming the Session Step, retries, error class; Safe next action; Export enabled. |
| Run Detail | Canceled | "Canceled by {actor} at {elapsed}" or "Canceled by Escalation answer: abort"; Evidence preserved; Export enabled. |
| Run Detail | Regression Run | "Regression Run for v{x}" label; approver confirms Agent-Judged evaluations from the confirmation script; outcome compared to the golden expectation with mismatch listed. |
| Run Detail | Finalized | Every mutating action disabled with "Finalized on {time} by {actor}. Mutation is denied and logged."; integrity flag if a post-Run integrity event exists (FR-35). |
| Live View | Live | Chrome LIVE; frames stream within 5 seconds (NFR-7); Pause, Cancel, Flag; Escalation panel appears in place when raised. Closing the tab does not affect the Run. |
| Live View | Paused | Chrome PAUSED; last frame held; Resume replaces Pause. |
| Live View | Awaiting Auditor | Chrome AWAITING with countdown; Escalation panel focused; workspace screen still visible (FR-24). |
| Live View | Adapter-only Run | No workspace; viewer shows Adapter Session Steps as log rows with counts and digests. |
| Live View | Below 1024px | Read-only; controls disabled with "Open on a desktop browser to supervise this Run." |
| Replay | Any terminal Run | Chrome REPLAY; starts paused at the first frame; jump list of Work Items, Exceptions, Escalations; works with the Workspace Provider unreachable. |
| Exception Detail | Rule-Classified only | No confirm controls; Record disagreement available to Audit Manager. |
| Exception Detail | Includes Agent-Judged pending | Evaluation card with Confirm / Reject; Exception state Open but "counts after confirmation". |
| Exception Detail | Human-matched record | Badge beside identity attribute; link to the Escalation answer. |
| Exception Detail | Untrusted content present | Untrusted block; never rendered as markup. |
| Review | Queue empty | EmptyState: "No Result awaits your decision." |
| Review | Awaiting decision | Rows ordered by submission time; Regression and Pending Confirmation Runs never appear here. |
| Notifications | None | EmptyState: "No Run is waiting on you." |
| Administration | Registration change | Saving a Target System registration warns: "This change creates a platform-authored draft for {n} Procedures and requires approval." (FR-14) |
| Any | Permission denied | Action visible, disabled, reason stated; Administration hidden from non-administrators. |
| Any | Cold load | Skeleton rows matching the layout; no counts shown until loaded. |
| Any | Stale data | Banner "Updated {time}. Refresh." on Run Detail and Runs; Live View refreshes itself. |

## Interaction Primitives

**Mouse and keyboard parity.** Every action is a visible control; nothing is hover-only. Row primary cells are links; row actions are persistent links.

- `Tab` order follows reading order; focus ring per `DESIGN.md` never suppressed.
- `Esc` closes the topmost dialog or the Escalation note field; never cancels a Run.
- Space / Enter on scrubber pills and Step rows jump Replay; `←`/`→` step frames when the viewer has focus; `Space` toggles play/pause.
- Filter chips are `aria-pressed` toggle buttons in a labelled group; single-select.
- Confirmation dialogs trap focus, restore it on close, and never auto-confirm.
- Live View polls or streams state within 5 seconds; a stale indicator appears after 15 seconds without an update.
- No drag, no infinite scroll (pagination on Runs), no auto-refresh of detail pages except Live View.
- Free text reaches the agent nowhere. Escalation notes and rationale fields are recorded only.

## Accessibility Floor

Behavioral. Visual contrast lives in `DESIGN.md` (parent-system token pairs tested for WCAG 2.1 AA; gold never for text under 18.5px).

- WCAG 2.1 AA across Overview, Procedures, Builder, Runs, Run Detail, Live View, Replay, Exception Detail, Review, and Administration; automated checks in CI (NFR-11).
- No status by colour alone: every badge carries an icon and a word; every Gate row repeats its status as a word.
- Tables use `<th scope>`; the first cell of every row is a focusable link; captions describe purpose.
- Dialogs are `role="dialog"`, `aria-modal`, titled with the consequence; rationale fields labelled.
- Live regions: `aria-live="polite"` announces Run state changes, new Escalations, and countdown milestones (10 minutes, 1 minute) on Live View and Run Detail; `aria-live="assertive"` for Run Failed.
- Escalation panels are reachable by a skip link ("Go to open Escalation") when present.
- Session viewer frames carry an `alt` narration equal to the Step narration; the scrubber is a labelled group of buttons.
- Long identifiers wrap (`overflow-wrap: anywhere`); Evidence values are never truncated.
- Untrusted source content and agent-generated text are announced as such ("Agent-generated question").

## Responsive & Platform

| Breakpoint | Behavior |
| --- | --- |
| ≥ 1280px | Sidebar visible; two-column detail layouts with rail; session viewer at full stage width. |
| 1024–1279px | Rail stacks under the main column at 1240px; Runs table scrolls horizontally with the identifier column fixed; Live View supervised. |
| 900–1023px | Reading mode: single column; tables become label/value stacks; actions move to the record bottom; Live View read-only. |
| < 900px | Reading mode only; Builder and Version review show "Open on a desktop browser to author or approve." |

Web only; no native surface. Email notifications deep-link to Live View or Run Detail.

## Inspiration & Anti-patterns

- **Lifted from Linear:** hierarchy and restraint; small fixed navigation; sentence case; no dashboards for their own sake.
- **Lifted from GitHub Actions:** the Run as a first-class object with stages, history, and a live log; the Execution Timeline's nested rows.
- **Lifted from Stripe:** density of tables and detail rails without chart walls.
- **Lifted from Vanta / Drata:** control ↔ evidence relationships made navigable, without their marketing gloss.
- **Rejected — chat-first agent UI:** the agent is watched and answered through closed choices, never conversed with.
- **Rejected — SIEM alert walls and heatmaps:** attention is a short ordered list, not a wall.
- **Rejected — exposed RPA builder:** the Builder is audit vocabulary (population, Target System, condition, Evidence), and the plan is read-only.
- **Rejected — ServiceNow / Archer form density:** one section per concept, one column, no nested tabs in the Builder.

## Roles and Action Gating

| Action | Auditor | Audit Manager | PoC Administrator |
| --- | --- | --- | --- |
| Author Procedure, submit version, Initiate Run, pause/resume, cancel, answer Escalation, flag to Audit Manager | ✓ | ✓ | — "PoC Administrator cannot author Procedures or start Runs." |
| Confirm / reject Agent-Judged evaluation, disposition Exceptions, annotate, submit Result | ✓ | ✓ | — "PoC Administrator cannot alter evaluations, Results, or reviews." |
| Approve / reject Procedure Version | — "Only an Audit Manager can approve a Procedure Version." | ✓ unless author: "You cannot approve a version you authored." | — |
| Approve / reject / finalize Result, record disagreement | — "Only an Audit Manager can approve a submitted Result." | ✓ | — |
| Export Workpaper Bundle | ✓ | ✓ | — |
| Manage users, registrations, bindings, diagnostics | — | — | ✓ |

`[ASSUMPTION]` An Audit Manager may confirm evaluations on, submit, and later approve the same Result in the PoC (PRD §12). `[NON-GOAL for PoC]` A Chief Audit Executive role; an executive reads Overview as an Audit Manager with no mutating actions if needed.

## Key Flows

### Flow 1 — Daniel builds the Terminated Users procedure (UJ-1; Daniel Okonjo, IT Auditor, Monday morning)

1. Daniel opens Procedures and chooses the *Terminated Users Retaining Access* Template; the Builder opens with every section pre-filled from addendum §C.
2. He binds the Population Source to the HR leavers export location (versioned file, signed cover sheet) and sets the inclusion rule to `employment_status = Terminated and termination_date within period`.
3. He selects LoanCore (web) and LedgerDesk (desktop); the section shows their kinds, credential references, and expected field labels.
4. He writes the Audit Instructions; one line mentioning a system not registered is flagged inline in warning colour, and he removes it.
5. In the Compliance Rule he sees C1 marked compiled and adds C2 in plain language; it is marked Agent-Judged with applicability `found = true`.
6. He sets Evidence Requirements and a weekly Schedule. The plan preview re-derives each time; the caption reads "Re-derived 09:14:02Z".
7. **Climax:** He reads the plan — two Session Steps, six Plan Steps, the Observations to capture, one Agent-Judged condition, the limits — in audit language, with nothing to edit on it, and presses "Submit for approval". The version badge flips to Submitted and Maya is notified.

Failure: the Population Source binding has no declared-count mechanism → Submit stays disabled with "Population Source must declare an expected record count."

### Flow 2 — Maya approves the procedure (UJ-2; Maya Lindqvist, Audit Manager)

1. Maya opens the notification and lands on Version review: sections with a diff against nothing (first version), the plan, credential references, and Target System kinds.
2. She checks that both credentials are read-only audit accounts and that the Schedule is weekly.
3. **Climax:** She approves; the version becomes Active (no regression needed on a first version), the Schedule shows the next Run, and Daniel is notified.

Failure: she authored the version herself → Approve disabled with "You cannot approve a version you authored."

### Flow 3 — Daniel watches the agent work (UJ-3; Daniel, later that morning)

1. From Procedure Detail he presses Initiate Run for August 2026 and opens Live View.
2. The viewer shows the Adapter acquiring the leavers export as a log row with digest and declared count, then the workspace opening LoanCore and signing in with masked credentials.
3. Per-Observation Gate rows tick in the rail as each account is read; the narration names the employee and what was observed.
4. On the seventh employee an Escalation appears in place: *choose candidate*, the two captured result rows with their grounded fields, answers "Choose by full name", "Mark ambiguous", "Abort". The workspace screen stays visible.
5. **Climax:** He chooses by full name; the confirmation restates that the record will be flagged human-matched; the agent continues, finishes LoanCore, and opens LedgerDesk. Daniel closes the tab.

Failure: he pauses to take a call → chrome shows PAUSED with a 30-minute countdown; on resume the agent continues from the next Tool Action.

### Flow 4 — The weekly Run happens without anyone watching (UJ-4; Monday 06:00 UTC)

1. The Schedule starts the Run; Runs shows initiator "Schedule" and the derived period.
2. Two Escalations would have notified Daniel and Maya by email; none is raised.
3. Daniel opens Run Detail over coffee: outcome Pending Confirmation, one Agent-Judged evaluation pending.
4. **Climax:** He opens Replay from the Exception's provenance chain, sees the LedgerDesk role list the agent judged privileged, returns to the evaluation card, confirms, and the Result seals as Control Failure, version 2.

Failure: the scheduled start is missed → Runs shows the missed start with a link to diagnostics; nothing is silently skipped.

### Flow 5 — Maya refuses an unsafe conclusion (UJ-5; Maya)

1. Overview lists RUN-2451 as Inconclusive; she opens it.
2. The Gate checklist leads with two failed rows: per-record coverage (three Work Items Uninspected after a *retry or skip* timeout) and unnamed value (`Suspended` on one LedgerDesk account).
3. The Safe next action panel says: "Add `Suspended` to the disabled set in a new Procedure Version, then initiate a new Run. This Run remains unchanged."
4. **Climax:** Submit is disabled with "Submission is unavailable for an Inconclusive Run"; she confirms no Pass or Control Failure exists, and asks Daniel for a new version.

Failure: none; the flow exists to prove the refusal.

### Flow 6 — Maya reviews, reproduces, and finalizes (UJ-6; Maya)

1. Review lists a submitted, sealed Result; she opens it.
2. In Exception Detail she reads the provenance chain, opens the grounding inspector on `roles`, sees the Structural Snapshot with corroboration matched, and the confirmed Agent-Judged evaluation with Daniel's confirmation.
3. She exports the Workpaper Bundle and reproduces the sampled evaluation offline.
4. She approves; the action bar now offers Finalize Result as a destructive action.
5. **Climax:** The finalization dialog names irreversibility; she confirms; every mutating action disables with "Finalized on {time} by Maya Lindqvist. Mutation is denied and logged."

Failure: she disagrees with a Rule-Classified evaluation → Record disagreement with rationale; the evaluation and sealed outcome stay visible and unchanged.

## Open Questions

1. Rerun blocked by an active Run for the same version and period: offer "Open the active Run" only (recommended) or also "Queue after it completes"? **Owner:** UX. **Revisit:** Runs interaction design.
2. Exception list order: identifier (default) versus amount or elapsed breach as a view preference; never part of the Procedure contract. **Owner:** UX. **Revisit:** Exception list design.
3. Workpaper Bundle format and delivery. **Owner:** Product and UX (PRD Open Question 5).
4. Masked field set per Population Source binding (FR-41). **Owner:** Product. **Revisit:** when binding contracts are authored.
5. Notification on Run completion (not required by the PRD; UJ-4 assumes none). **Owner:** Product. **Revisit:** after the first unattended Runs.
