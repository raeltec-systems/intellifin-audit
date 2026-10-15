# Zobba experience rules

Input for the BMAD agent to reconcile into the existing experience rules. **This document does not modify the approved course-correction artifacts.** Where it differs from them, [HANDOFF.md §4](HANDOFF.md) lists the difference for reconciliation.

Each rule references its components ([COMPONENT-INVENTORY.md](COMPONENT-INVENTORY.md)) and reference screens ([reference-screens/](reference-screens/README.md)).

## 1. Conversation is primary

- **R1.1** The auditor expresses intent in conversation. There are no forms for starting audit work. *(Composer, Conversation · RS 01, 02)*
- **R1.2** Zobba's replies are unboxed first-person text, with no avatar on each reply. Auditor messages sit on a Linen bubble. *(Conversation · RS 02)*
- **R1.3** Zobba reports meaningful activity (what it is doing, and to which object) beneath its reply. It doesn't narrate every tool call. *(Activity · RS 02, 03)*
- **R1.4** Guidance and Stop are separate actions. Guidance typed while Zobba works is acknowledged as "Guidance queued for the next step" and later as "Applied your guidance · …". Stop halts the current step, keeps the work so far and says what was kept. *(Composer, Activity · RS 02, 03)*
- **R1.5** Clarifying questions are asked only when the answer changes the work. There is one question per turn, with suggested replies plus free text. The paused step is named. *(Clarification · RS 08)*

## 2. Workspace appears when useful

- **R2.1** The workspace panel opens when there is something to inspect: working data, a browser session, a document, an artifact, evidence, changes, draft correspondence or a scheduled-result detail. It closes without losing the conversation. *(Workspace panel · RS 03, 04, 05, 09)*
- **R2.2** Incoming work never replaces what the auditor is inspecting. If the panel is **pinned** or has been interacted with in the last 30 seconds, new content appears as a card in the conversation ("Working data · Open"), not in the panel. *(Workspace panel)*
- **R2.3** Pin, Expand and Close are always present in the panel header, along with a "From [task]" source line.
- **R2.4** Browser sessions are read-only unless permissions say otherwise. "Take over" hands control to the auditor, and Zobba pauses until it is handed back. *(Browser workspace · RS 04)*

## 3. Artifacts belong to the methodology

- **R3.1** Chrome is Zobba. The artifact page uses the firm template's typography, layout, reference scheme and colours. *(Artifact · RS 05, 07)*
- **R3.2** Prepared by and Reviewed by name accountable people. Zobba is never the preparer or reviewer.
- **R3.3** "Prepared with Zobba · draft n · ref" is footer provenance metadata, on by default and switchable off per firm. It must not imply a review or sign-off that didn't happen.
- **R3.4** Selection, citation chips and diff marks are workspace overlays. They are not exported.
- **R3.5** Artifact states are Draft → In review → Approved → Issued (plus Superseded). Each transition is a human action and names the person and date.

## 4. Evidence

- **R4.1** Every conclusion and result in an artifact is traceable: **claim → citation → preview → full evidence → back to claim**. *(Citation, Evidence drawer · RS 05, 06)*
- **R4.2** Evidence shows readable identity first (source, location, what it supports), then technical provenance behind "Technical details".
- **R4.3** Source locations by type:

| Type | Location format |
|---|---|
| Spreadsheet | File › sheet › rows or cells (HR leavers Q3.xlsx › Leavers › rows 2–24) |
| PDF | File › page, highlighted region |
| Document | File › section › paragraph or table |
| Email or message | Sender, date, subject › quoted passage |
| Image | File › highlighted region |
| System record | System › record id › field(s) (AccessGate › AG-91002 › sign-in history) |
| Browser capture | Site › page › captured time, highlighted element |

- **R4.4** The originating claim stays highlighted and recoverable while evidence is open. Esc returns focus to it.

## 5. Changes

- **R5.1** Corrections are made through conversation or direct edits. An edit the auditor explicitly requests on a draft saves as a new draft ("Draft 2 saved · View changes · Undo"). There is no approval ceremony after each edit. *(Changes · RS 07)*
- **R5.2** Zobba doesn't silently change a conclusion. Changes that Zobba proposes itself are offered for the auditor to accept.
- **R5.3** The diff is typographic: removed text is struck, and added text is underlined on a neutral background. There is no red or green.
- **R5.4** Changes to **approved or issued** work create a new version that returns to review, with the approved version preserved.
- **R5.5** The Changes summary counts the edits and additions, and names changed limitations and conclusions explicitly.

## 6. Permissions

- **R6.1** The term is **Permissions**. Never Mandate. Access means user access in the audit, never Zobba's authority.
- **R6.2** At a glance: "Can read selected sources and work on copies. Asks before sending messages or invitations. View permissions." This appears on the engagement, in the composer chip and in the confirmation footer. *(Permissions · RS 09, 10, 16)*
- **R6.3** The detail view has these sections: Can read · Can write · Asks first · Never · Scheduled checks · Connections · Administrator limits, plus Change permissions and **Activity record**.
- **R6.4** The Activity record answers "What did Zobba actually do?". Each external action shows the decision basis ("allowed by Daniel Okonjo") and the actual outcome.
- **R6.5** The examples in these screens reflect this engagement's configuration. They are not universal grants or guarantees.

## 7. Confirmation and external actions

- **R7.1** Zobba asks only at meaningful boundaries, meaning anything that leaves Zobba or changes something outside working copies. *(Confirmation · RS 09)*
- **R7.2** There is one decision surface in the conversation, showing what will happen, sender, recipient, content and attachments, date, time and time zone, calendar and invitees, and destination. The drafts are open beside it. There is no second modal.
- **R7.3** Labels are action-specific: **Allow and send · Edit first · Don't send**.
- **R7.4** If any material detail changes after it is presented, the previous decision is invalid and the surface is shown again.
- **R7.5** Outcomes are reported per operation, even when they were approved together:

| Outcome | Message |
|---|---|
| Success | "Sent to Chipo Zulu at 15:06." |
| Failed before sending | "The invitation wasn't sent: Outlook rejected it. Nothing was sent to Chipo." + Retry |
| Unknown after dispatch | "I sent the email, but Outlook didn't confirm delivery. Check Sent items before resending." |
| Partial | "The email was sent at 15:06. The invitation failed: the time conflicts with a room booking." + Edit invitation |

## 8. Review

- **R8.1** Review is a human step with a named person. "Mark as reviewed" records the reviewer and time.
- **R8.2** Review status is shown separately from the assessment and from execution.

## 8a. Roles and model choice

- **R8a.1** Every role uses the same harness. Audit managers add Reviews, and administrators add Settings › Administration. *(RS 20–23)*
- **R8a.2** A preparer cannot review their own work, and an administrator cannot review or approve audit work.
- **R8a.3** Auditors choose the model and reasoning effort in the composer, within what the administrator allows. The choice is recorded per step in How it ran and never appears in the artifact. *(RS 19, 22)*
- **R8a.4** An unavailable model is shown disabled, with the reason. It is never silently hidden when the auditor might expect it.

## 9. Scheduled work

- **R9.1** Suitable finished tasks can be promoted to scheduled checks. They keep the task's method and permissions. *(RS 12, 13)*
- **R9.2** Unattended runs never take "asks first" actions. They wait for the auditor.
- **R9.3** Results lead with a readable conclusion, then Exceptions · Coverage · Evidence · How it ran.
- **R9.4** The mark identifies the actor, and the semantic chip gives the outcome. "Didn't run" is an execution state with no assessment.

## 10. Search

- **R10.1** Search is scope-aware and attributes each result to its client and engagement. Client contexts are never merged, and a task works inside one engagement. *(RS 11)*
- **R10.2** Stale or incomplete indexes are stated in the results.

## 11. Honesty in state

- **R11.1** An unavailable query must not look empty. A partial read must not look complete. An uncertain external action must not look definitely failed or definitely done.
- **R11.2** There are no fake progress indicators. Counts are shown only when they are real ("page 4 of 11", "1,516 accounts compared").
- **R11.3** Limitations are recorded as they are found, referenced (L1, L2) and carried into the artifact.

## 12. Voice and copy

### Fixed labels (use verbatim)

Navigation: New task · Search · Scheduled checks · Engagements · Recent tasks · Connections · Settings.
Presence: Zobba is reading / analysing / comparing / reviewing sign-ins / preparing the working paper / validating conclusions · Zobba needs your input · Zobba needs your permission · Zobba ran this unattended · Zobba completed the [check name].
Permissions: Permissions · Can read · Can write · Asks first · Never · Scheduled checks · Connections · Administrator limits · View permissions · Change permissions · Activity record.
Decisions: Allow and send · Edit first · Don't send · Stop · Undo · View changes · Back to claim · Mark as reviewed · Reconnect.
Status: No exception · Exception · Warning · Inconclusive · Not reviewed · Reviewed by [name] · Didn't run · Paused · Needs reconnecting · Guidance queued for the next step.

### Safety-critical messages (use verbatim patterns)

- Before an external action: "I need your permission before sending these."
- For an uncertain outcome: "I sent the [item], but [system] didn't confirm [delivery]. Check [where] before resending."
- For no action taken: "Nothing has been sent or changed."
- When coverage is incomplete: "I can't treat [source] as the complete population yet."

### Illustrative dialogue

Everything else in the reference screens (Zobba's explanations) is **illustrative**. Agent explanations stay natural and specific to the work, not scripted.

### Rules

- Write in first person in conversation and "Zobba …" in chrome.
- State limitations plainly: "I couldn't establish…", "I can't treat X as complete yet." Don't hedge everything, and never claim certainty the evidence doesn't give.
- Present candidate findings as findings with support: "Two retained access after exit, supported by sign-ins after the exit date (E6)."
- Errors say what happened, what wasn't affected, and what to do. Diagnostics go under Technical details.
- Avoid implementation terms (token, agent run, tool call, context window, LLM), AI hype and exclamation marks.
