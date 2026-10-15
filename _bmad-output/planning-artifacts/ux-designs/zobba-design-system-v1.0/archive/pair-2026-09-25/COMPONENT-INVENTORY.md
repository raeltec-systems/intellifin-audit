# Zobba component inventory

Each entry covers purpose, variants and states, anatomy, key tokens, behaviour, accessibility and where not to use it. Token names refer to [DESIGN-TOKENS.md](DESIGN-TOKENS.md). The RS numbers point to the [reference screens](reference-screens/README.md).

## Foundations

### Zobba mark
- **Purpose:** identifies Zobba and its working state.
- **Variants:** color · mono · reverse · reverse-mono · `-small` (13–19px) · `-micro` (≤ 12px). **States:** idle · working · waiting · complete (BRAND §2, DESIGN-SYSTEM §4).
- **Anatomy:** two forms on the 32 grid.
- **Tokens:** `color.accent.default`, `color.text.primary`, motion.mark-*.
- **Behaviour:** one animated mark per region, always beside activity text.
- **Accessibility:** `aria-hidden="true"`; the text carries the meaning.
- **Don't** use it as a bullet, avatar per message, loader or result indicator.

### Wordmark and lockups
- Supplied as SVGs only (see [ASSET-MANIFEST.md](ASSET-MANIFEST.md)). The sidebar uses the horizontal lockup at 20px.
- **Accessibility:** `alt="Zobba"`.
- **Don't** set it as live text.

### Semantic glyph
- **Purpose:** supports a status word.
- **Variants:** ✓ pass · ! exception · ▲ warning · ◐ inconclusive or limitation · ○ pending · ✕ didn't run · ‖ paused.
- **Accessibility:** `aria-hidden`; the word is the label.
- **Don't** use a glyph without its word.

## Navigation

### Sidebar
- **Variants:** expanded (248) · rail (52) · narrow sheet.
- **Anatomy:** lockup · primary items · section labels · engagement entries · recent tasks · Connections · Settings · user.
- **States:** item default · hover (`surface.hover`) · active (Paper + hairline ring) · needs-attention badge · task working or waiting mark.
- **Accessibility:** `nav` landmark, `aria-current="page"`, badge label "2 need attention", rail tooltips.
- **Don't** add a GRC hierarchy (Controls, Risks, Findings trees) or Library.

### Page header
- 60px with title, context line and at most two actions.
- **Don't** put KPI tiles in it.

## Conversation

### Composer
- **Purpose:** the single input for intent, guidance, questions and answers.
- **Anatomy:** text area · + (add sources or files, context, skill) · context chips (engagement, permissions, attached sources) · Stop (while working) · Send.
- **States:**

| State | Treatment |
|---|---|
| Empty | `border.input`, placeholder "Describe what you want to check, analyse or prepare", Send disabled |
| Focused | 1.5px Iris border + 4px wash ring |
| Engagement selected | Engagement chip; permissions chip "Permissions: reads selected sources" |
| Source added | Attachment chip with file name, size and remove ✕ |
| Zobba working | Placeholder "Add guidance or ask a question"; Stop shown; Send sends guidance |
| Waiting for clarification | Placeholder "Answer, or give other guidance"; suggested replies above |
| Disabled | Only when no engagement is permitted or the execution environment is unavailable, with the reason shown in the composer |

- **Model and effort chip:** "[Model] · [Effort] ▾". It opens the model menu (DESIGN-SYSTEM §5b). Accessibility: a button labelled "Model and reasoning effort, Claude Opus 5.5, High"; the menu is `role="menu"` with radio items; effort is a radio group; disabled models state their reason in `aria-description`.
- **Guidance acknowledgement:** "○ Guidance queued for the next step" appears under the message. When applied, the activity line reads "✓ Applied your guidance · …".
- **Stop:** outlined, with a ■ glyph. It stops the current step and Zobba confirms what was kept. Stop is not the same as sending guidance.
- **Tokens:** `radius.composer`, `color.border.input`, `focus.composer`.
- **Accessibility:** labelled textarea. Enter sends and Shift+Enter adds a new line. Stop is reachable by keyboard (Esc twice when the composer has focus) and announces "Stopped".
- **Don't** replace it with forms for starting work.

### Auditor message
- Linen bubble, radius 16, right-aligned, maximum 380px (70% on narrow).
- An optional "Selected · [location]" tag above it shows the context.

### Zobba response
- Unboxed 15/24 text in the first person, at most 720px wide. **Streaming:** text appears in sentence-sized chunks, and the working mark sits on the activity line, not the text.
- **Accessibility:** live region at step granularity.

### Question and clarification
- A bold question line with suggested replies (reply chips with `border.input`) and "Or reply in your own words". The chrome chip reads "Zobba needs your input" with the waiting mark.
- **Don't** use a form card.

### Limitation
- An inline activity line "◐ … · recorded as limitation L1". On narrow screens it is a dashed neutral callout so it stays visible.

### Candidate finding
- Stated in prose with citations. It becomes an exception in data or an artifact only in the artifact.
- **Don't** colour the prose.

### Explanation and correction
- Plain prose. A correction ends with "Draft n saved · View changes · Undo".

### Citation
- **Purpose:** links a claim to evidence.
- **Anatomy:** a chip with 12/16 weight 600 text in `accent.strong` on `accent.wash`, radius 4 ("E6", "E6.2").
- **States:** default · hover (preview after 300ms) · active or open (`selection.text` + 1.5px Iris ring).
- **Accessibility:** a button with the full name, "Evidence E6.2, AccessGate sign-ins, Kelvin Chanda".

### System event
- A 12/16 `text.tertiary` centred line ("Draft 2 saved · 2 Oct 14:52", "Daniel allowed sending · 15:06").
- **Don't** use one for Zobba's own reasoning.

## Agent activity

### Activity list
- **Anatomy:** a 16px glyph column plus text. The completed step is ✓ in `text.tertiary`. The current step shows the working mark, a 600-weight line and a detail line with **Inspect** and **Technical details**. A limitation shows ◐. The next step is "Next: …" in placeholder colour.
- **Rules:** one current step; no percentages; "Step x of y" only for genuinely fixed procedures; lines describe the activity and its object ("Comparing 23 leavers against 1,516 accounts").
- **Accessibility:** a list, with the current item marked `aria-current="step"`.

### Presence chip
- The working mark plus "Zobba is …" in Iris strong on Iris wash. The waiting version is the waiting mark plus "Zobba needs …" in Graphite on Linen.
- **Don't** show a result in it.

## Workspace

### Workspace panel
- **Anatomy:** header (title, "From [task] · state", Pin · Expand · Close) · optional toolbar (filters, tabs) · content.
- **States:** open · pinned · focus · full-screen · resizing.
- **Replacement rule:** new content never replaces a pinned or recently used panel (EXPERIENCE R2.2).
- **Types:** working data, browser, document, artifact, evidence, changes, draft correspondence, scheduled-result detail.
- **Accessibility:** a `complementary` region labelled by its title; F6 reaches it; Close returns focus to the conversation.

### Browser view
- A URL bar in Plex Mono, back and forward, "Take over", and the page content. The footer notes what is being captured.
- The read-only state is stated in the header.

### Working-data view
- Filter chips, a table (see Data) and a footer count.

## Artifacts

### Artifact page
- A white page on the surround with the firm template inside. The panel header gives the type, draft number and review state.
- **Anatomy (firm-owned):** header, title, prepared and reviewed by, sections, results, conclusion, limitations, footer with provenance.
- **Zobba overlays:** selection outline, citations and diff.
- **Don't** apply Zobba type or colour to the page body.

### Provenance footer
- A 10px mono micro mark plus "Prepared with Zobba · draft n · ref ZB-xxxx". It can be switched off per firm.

### Artifact state chip
- Draft · Not reviewed · In review · Reviewed by [name] · Approved · Issued · Superseded. Outline chips.

## Evidence

### Citation preview (popover)
- Evidence id and title, location, source and date, and "Open evidence". Level 2 elevation.

### Evidence drawer
- **Anatomy:** header (id · "cited in …", title, **Back to claim**) · identity grid (Source, Location, Captured, Supports) · excerpt with the relevant row or region highlighted by an Iris inset bar · Open full source · Technical details · other evidence in this task.
- **Accessibility:** a dialog-like region without a scrim; focus moves to the heading; Esc returns to the claim.

## Decisions

### Confirmation card
- **Anatomy:** title ("Send 1 email and 1 calendar invitation"), a material-details grid, action buttons (Allow and send, Graphite primary; Edit first, secondary; Don't send, text) and a permissions footer.
- **States:** pending · invalidated (details changed; the card is re-rendered with "Details changed since you last saw this") · sending · per-operation outcomes.
- **Accessibility:** `role="alert"` on arrival; buttons in order; no auto-focus on Allow.
- **Don't** add a modal or a second confirmation.

### Suggested replies
- Reply chips (radius pill, `border.input`) that submit the text as the auditor's answer.

## Permissions

### Permissions summary
- Two sentences plus "View permissions".

### Permissions detail
- Label and value rows in the seven sections, the "Set by … on …" line, Change permissions and the Activity record.
- **Don't** use lock or shield icons, tokens or scopes.

### Activity record entry
- The action, the outcome (Sent · Sent · accepted · Failed · Unconfirmed), the time and the decision basis.

## Status

### Status chip
- 12/16 weight 600, radius pill, glyph plus word, using the semantic tokens (DESIGN-SYSTEM §6).
- **Don't** combine dimensions in one chip.

### Needs-attention badge
- A Graphite count, or "▲ n" warning for connections.

## Data

### Table
- Header, row, selected row, exception cell, limitation cell, matched and unmatched groups, grouped rows, virtualised body, filter chips, sort, column resize, sticky header, identifiers in mono, tabular numbers (DESIGN-SYSTEM §7).
- **Accessibility:** `table` semantics, `aria-sort`, and an announced row count.

## Review (audit manager)

### Reviews queue
- Grouped list: Waiting for your review · Returned with your notes · Reviewed recently. Columns: item, preparer, state chips, submitted date.
- **Don't** merge review status with the assessment.

### Review note
- Anchored to a paper location ("On L2"), with author and state (draft or sent). It sits in a 230px column beside the page.
- Not exported.
- **Accessibility:** each note is linked to its anchor, and focusing the note highlights the anchor.

### Review action bar
- **Return with n notes** (primary) · **Mark as reviewed** (secondary), with the helper text "Marking as reviewed records you and the time. Approval and issue are separate steps."

## Settings

### Form field, select, multiselect, checkbox, radio, toggle, textarea, date/time, file picker
- Specified in DESIGN-SYSTEM §8.
- **Don't** use them inside a task conversation.

### Review (audit manager)

### Reviews queue
- Grouped list: Waiting for your review · Returned with your notes · Reviewed recently. Columns: item, preparer, state chips, submitted date.
- **Don't** merge review status with the assessment.

### Review note
- Anchored to a paper location ("On L2"), with author and state (draft or sent). It sits in a 230px column beside the page.
- Not exported.
- **Accessibility:** each note is linked to its anchor, and focusing the note highlights the anchor.

### Review action bar
- **Return with n notes** (primary) · **Mark as reviewed** (secondary), with the helper text "Marking as reviewed records you and the time. Approval and issue are separate steps."

## Settings navigation
- A secondary column (220px) with the main app on the rail.

## Feedback

### Inline notice
- A glyph plus sentence plus action (for example "▲ Kafue SharePoint results may be incomplete… Reconnect"). No toast stacks.

### Empty state
- One sentence plus one action (DESIGN-SYSTEM §12). No illustration.

### Error with Technical details
- A plain message, what wasn't affected, the recovery action, then Technical details (collapsed).
