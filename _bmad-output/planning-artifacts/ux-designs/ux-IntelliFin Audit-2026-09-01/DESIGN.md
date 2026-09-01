---
name: IntelliFin Audit
status: final
description: Visual design contract for IntelliFin Audit, the agentic audit-execution surface inside the IntelliFin Business Suite. Inherits the IntelliFin Design System ("Ledger Signal") and specifies only the audit-native delta — a state-family layer that keeps Procedure Version, Run lifecycle, Evidence Quality Gate, Result outcome, Auditor Review, Exception, evaluation origin, and Work Item state visually distinct at all times.
created: 2026-09-01
updated: 2026-09-01
sources:
  - ../../briefs/brief-IntelliFin Audit-2026-08-31/brief.md
  - ../../prds/prd-IntelliFin Audit-2026-08-31/prd.md
  - ../../prds/prd-IntelliFin Audit-2026-08-31/addendum.md
  - ./EXPERIENCE.md
  - ./claude/DESIGN.md
  - ./claude/DESIGN-HANDOFF-NOTES.md
colors:
  # Inherited from the IntelliFin Design System tokens/colors.css. No new hues.
  navy: '#102A43'                 # --navy-900 · sidebar, headings, primary text
  navy-800: '#243B53'
  navy-700: '#334E68'
  navy-100: '#D9E2EC'
  teal: '#0F766E'                 # --teal-700 · every interactive element, and nothing else
  teal-800: '#115E59'
  teal-500: '#14B8A6'
  gold: '#C0942F'                 # --gold-500 · brand mark only; never status, never buttons
  surface-page: '#F8FAFC'
  surface-card: '#FFFFFF'
  surface-sunken: '#F1F5F9'       # table headers, code blocks, panels
  surface-sidebar: '#102A43'
  surface-selected: '#F0FDFA'
  border-default: '#E2E8F0'
  border-strong: '#CBD5E1'
  border-selected: '#0D9488'
  text-primary: '#102A43'
  text-secondary: '#475569'
  text-muted: '#64748B'
  text-inverse: '#FFFFFF'
  text-link: '#0F766E'
  focus: '#0F766E'                # [ASSUMPTION] teal-700, not the parent's teal-500 (#14B8A6 is 2.5:1 on white, below the 3:1 non-text minimum)
  success-bg: '#F0FDF4'
  success-border: '#BBF7D0'
  success-text: '#15803D'
  warning-bg: '#FFFBEB'
  warning-border: '#FDE68A'
  warning-text: '#92400E'
  danger-bg: '#FEF2F2'
  danger-border: '#FECACA'
  danger-text: '#B91C1C'
  danger-solid: '#B91C1C'
  info-bg: '#EFF6FF'
  info-border: '#BFDBFE'
  info-text: '#1D4ED8'
  info-solid: '#1D4ED8'           # "needs a human" — Awaiting Auditor, Pending Confirmation, Agent-Judged pending, Work Item Awaiting
  neutral-bg: '#F1F5F9'
  neutral-border: '#E2E8F0'
  neutral-text: '#475569'
  neutral-solid: '#64748B'
  scrim: '#102A43'                # navy at {spacing.scrim-opacity}
typography:
  # Every role uses {typography.sans} unless its comment says mono. Comments name where the role lives.
  sans:
    fontFamily: "Inter, 'Segoe UI', system-ui, sans-serif"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"   # [ASSUMPTION] parent system has no mono token; identifiers, values, digests, timestamps, locators, Tool Actions
  page-title:          # screen titles; Run and Exception identifiers as h1 (mono)
    fontFamily: '{typography.sans.fontFamily}'
    fontSize: 20px
    lineHeight: 28px
    fontWeight: '600'
  card-title:          # card and section headings, dialog titles
    fontFamily: '{typography.sans.fontFamily}'
    fontSize: 16px
    lineHeight: 24px
    fontWeight: '600'
  sub-title:           # panel headings (execution failure, safe next action, untrusted content), rail card headings
    fontFamily: '{typography.sans.fontFamily}'
    fontSize: 14px
    lineHeight: 20px
    fontWeight: '600'
  body:                # outcome statements, objectives, Escalation questions, long prose
    fontFamily: '{typography.sans.fontFamily}'
    fontSize: 14px
    lineHeight: 21px
    fontWeight: '400'
  body-sm:             # table cells and values (mono when the value is data)
    fontFamily: '{typography.sans.fontFamily}'
    fontSize: 13px
    lineHeight: 18px
    fontWeight: '400'
  body-sm-relaxed:     # detail copy in rows, diagnostics, narration
    fontFamily: '{typography.sans.fontFamily}'
    fontSize: 13px
    lineHeight: 19px
    fontWeight: '400'
  row-title:           # row titles, links, first cells
    fontFamily: '{typography.sans.fontFamily}'
    fontSize: 13px
    lineHeight: 18px
    fontWeight: '500'
  caption:             # field labels, metadata labels
    fontFamily: '{typography.sans.fontFamily}'
    fontSize: 12px
    lineHeight: 16px
    fontWeight: '400'
  caption-relaxed:     # hints, notes, rule text under Gate rows
    fontFamily: '{typography.sans.fontFamily}'
    fontSize: 12px
    lineHeight: 17px
    fontWeight: '400'
  overline:            # uppercase section labels, table headers, status words, chips
    fontFamily: '{typography.sans.fontFamily}'
    fontSize: 12px
    lineHeight: 16px
    fontWeight: '500'
    letterSpacing: 0.02em
  micro:               # avatar initials, step-marker numbers, file metadata
    fontFamily: '{typography.sans.fontFamily}'
    fontSize: 11px
    lineHeight: 15px
    fontWeight: '500'
rounded:
  sm: 4px        # inputs, inline code, call boxes, notes
  md: 6px        # buttons, chips, selects, banners, panels
  lg: 8px        # cards, tables, dialogs
  full: 999px    # badges, avatars, step markers, scrubber pills
spacing:
  '1': 4px
  '2': 8px
  '3': 12px
  '4': 16px
  '5': 20px
  '6': 24px
  gutter: 24px
  card-padding: 20px
  card-header-padding: 14px 20px
  row-padding: 12px 20px
  row-padding-dense: 9px 20px
  sidebar: 240px
  top-bar: 56px
  ribbon: 32px
  content-max: 1320px
  builder-max: 880px
  rail: 340px
  rail-procedure: 380px
  rail-exception: 360px
  rail-session: 320px
  control-sm: 32px
  control-md: 36px
  chip: 28px
  tabs: 38px
  badge-sm: 20px
  badge-md: 24px
  dialog: 560px
  scrim-opacity: '0.45'
components:
  # Inherited from the IntelliFin Design System bundle (IntelliFinDesignSystem_92c78d), an external UI system
  # that lives in the IntelliFin Business Suite repository, not here; references are by name per the DESIGN.md
  # spec's UI-system inheritance pattern. Every token value this document needs is restated above.
  sidebar: '{IntelliFinDesignSystem.Sidebar}'
  button: '{IntelliFinDesignSystem.Button}'
  status-badge: '{IntelliFinDesignSystem.StatusBadge}'   # extended locally with the info-solid family, see status-badge-info-solid
  status-badge-info-solid:
    background: '{colors.info-solid}'
    border: '{colors.info-solid}'
    text: '{colors.text-inverse}'
  banner: '{IntelliFinDesignSystem.Banner}'
  environment-ribbon: '{IntelliFinDesignSystem.EnvironmentRibbon}'
  empty-state: '{IntelliFinDesignSystem.EmptyState}'
  tabs: '{IntelliFinDesignSystem.Tabs}'
  icon: '{IntelliFinDesignSystem.Icon}'
  # Audit-specific patterns composed from tokens
  card:
    background: '{colors.surface-card}'
    border: '1px solid {colors.border-default}'
    radius: '{rounded.lg}'
    shadow: none
  conclusion-triptych:
    columns: 3
    cell-padding: 16px 20px
    divider: '1px solid {colors.border-default}'
    statement-background: '{colors.surface-page}'
    statement-type: '{typography.body}'
  gate-checklist:
    row-grid: 20px 220px minmax(0, 1fr)
    row-padding: '{spacing.row-padding-dense}'
    group-label: '{typography.overline}'
  timeline-row:
    grid: 28px 20px minmax(0, 1fr) 110px
    row-padding: '{spacing.row-padding}'
    call-box-background: '{colors.surface-page}'
    call-box-font: '{typography.mono}'
    indent-per-level: 20px
  provenance-chain:
    marker-size: 22px
    marker-radius: '{rounded.full}'
    connector: '1px solid {colors.border-default}'
    step-gap: 16px
  evaluation-card:
    border: '1px solid {colors.border-default}'
    origin-badge: '{components.status-badge}'
    confidence-font: '{typography.mono}'
  grounding-inspector:
    label-font: '{typography.caption}'
    value-font: '{typography.mono}'
    corroboration-badge: '{components.status-badge}'
  reconciliation-table:
    label-width: 60%
    value-align: right
    value-font: '{typography.mono}'
  evidence-item:
    grid: repeat(3, minmax(0, 1fr))
    gap: 8px 20px
    kind-badge: '{components.status-badge}'
    note-background: '{colors.warning-bg}'
    note-border: '1px solid {colors.warning-border}'
  version-diff:
    changed-section-border: '1px solid {colors.warning-border}'
    added-value-background: '{colors.success-bg}'
    removed-value-background: '{colors.danger-bg}'
    value-font: '{typography.mono}'
  data-table:
    header-background: '{colors.surface-sunken}'
    header-type: '{typography.overline}'
    header-text: '{colors.text-secondary}'
    header-padding: 8px 20px
    cell-padding: 9px 20px
    row-border: '1px solid {colors.surface-sunken}'
    first-cell-type: '{typography.row-title}'
  exception-row:
    padding: '{spacing.row-padding}'
    identifier-font: '{typography.mono}'
    state-badge: '{components.status-badge}'
  notification-row:
    padding: '{spacing.row-padding}'
    countdown-font: '{typography.mono}'
    unread-marker: '{colors.info-solid}'
  untrusted-block:
    border: '1px solid {colors.warning-border}'
    body-font: '{typography.mono}'
    body-background: '{colors.surface-sunken}'
  unavailable-actions-panel:
    background: '{colors.surface-sunken}'
    radius: '{rounded.md}'
    padding: 10px 14px
  safe-next-action-panel:
    background: '{colors.warning-bg}'
    border: '1px solid {colors.warning-border}'
    text: '{colors.warning-text}'
  execution-failure-panel:
    background: '{colors.danger-bg}'
    border: '1px solid {colors.danger-border}'
    text: '{colors.danger-text}'
  escalation-panel:
    background: '{colors.info-bg}'
    border: '1px solid {colors.info-border}'
    heading-text: '{colors.info-text}'
    question-background: '{colors.surface-sunken}'
    question-font: '{typography.body-sm-relaxed}'
  session-viewer:
    chrome-background: '{colors.navy}'
    chrome-text: '{colors.navy-100}'
    live-dot: '{colors.danger-solid}'
    replay-dot: '{colors.teal-500}'
    paused-dot: '{colors.neutral-solid}'
    awaiting-dot: '{colors.info-solid}'
    stage-background: '{colors.surface-sunken}'
    stage-min-height: 430px
    scrubber-pill-height: 8px
  builder-section:
    label-width: 150px
    label-type: '{typography.overline}'
    plan-row-font: '{typography.mono}'
  confirmation-dialog:
    width: '{spacing.dialog}'
    radius: '{rounded.lg}'
    shadow: 0 12px 32px rgba(16,42,67,0.24)
    scrim: '{colors.scrim}'
  filter-chip:
    height: '{spacing.chip}'
    radius: '{rounded.md}'
    pressed-background: '{colors.teal}'
    pressed-text: '{colors.text-inverse}'
---

# Brand & Style

IntelliFin Audit is a surface of the IntelliFin Business Suite, not a separate product. It inherits the locked **Route C — "Ledger Signal"** direction of the IntelliFin Design System: navy foundation, teal as the single interaction signal, gold for the brand mark only. This document specifies the audit-native delta and nothing else; every token above that is not audit-specific is the parent system's value, restated so that `{…}` references in this document resolve without the parent bundle.

The audit domain adds one requirement the parent system does not have: eight independent state families must never be confused with one another — Procedure Version, Run lifecycle, Evidence Quality Gate, Result outcome, Auditor Review, Exception, evaluation origin, and Work Item state. In this document, "Step" unqualified means a Timeline step at any level (Session Step, Plan Step, or Step Execution). That constraint, not decoration, drives the color, badge, and layout rules below.

Tone in the interface is that of an audit workpaper: factual, restrained, specific. Sentence case everywhere. Every conclusion names what was tested, on which Evidence, and under which Procedure Version. Where the system cannot conclude, it says so plainly ("Evidence incomplete. No control conclusion issued.") rather than softening or hiding it.

The Audit Agent's work is the core product experience: the Auditor builds a Procedure, an Audit Manager approves it, and the Auditor watches the agent execute in its isolated Agent Workspace or replays the recorded session later. The session is evidence-first — every Step is narrated factually, every Tool Action is shown sanitized, and the session always ends at the Evidence Quality Gate and a sealed Result. There is no conversational affordance and no anthropomorphic language; the agent is supervised, not chatted with. The Live View gives the Auditor exactly the controls the PRD grants — pause, resume, cancel, answer an Escalation from its closed answer set, flag to an Audit Manager.

→ Visual reference: `claude/mockups/IntelliFin Audit.dc.html` (Claude Design prototype, built on PRD revision 1 with a partial revision-2 update). Where the prototype and this document disagree, this document wins; `reconcile-claude-design.md` lists every divergence. Between the two spines, visual values (tokens, sizes, treatments) follow this document and behavior and copy follow `EXPERIENCE.md`.

# Colors

Inherited wholesale from the parent `tokens/colors.css`. No new hues are introduced. One new solid is named — `{colors.info-solid}` — for the "needs a human" treatment, because the audit domain has four states that are neither failure nor success but a person's turn. Contrast targets: 4.5:1 for text, 3:1 for non-text indicators. `{colors.text-muted}` is used only on `{colors.surface-card}` and `{colors.surface-page}` (4.8:1 and 4.6:1); table headers on `{colors.surface-sunken}` use `{colors.text-secondary}` (7.0:1). The focus ring is `{colors.focus}` (teal-700, 4.7:1 on white); gold is never used for text below 18.5px and never for status.

**Interaction.** `{colors.teal}` is the only interactive color: links, primary buttons, active tab underline, active nav marker, pressed filter chips; `{colors.focus}` for the focus ring. Nothing decorative is teal, and no status is teal.

**Status.** Every badge carries an icon and a text label, so color is never the sole carrier of meaning. Eight families:

| Family | States | Badge treatment | Icon |
| --- | --- | --- | --- |
| Procedure Version | Draft · Submitted · Approved · Rejected · Active · Retired | neutral · warning · info · danger-outline · neutral-solid · neutral | pencil · clock · check · x-circle · lock · slash |
| Run lifecycle | Queued · Running · Paused · Awaiting Auditor · Completed · Inconclusive · Run Failed · Canceled | neutral · info · neutral · **info-solid** · neutral · warning · danger-outline · neutral-solid | clock · refresh-cw · pause · user · check · alert-triangle · cloud-off · ban |
| Evidence Quality Gate | Passed · Not passed · Incomplete · Not evaluated | success · warning · danger-outline · neutral | shield-check · shield-alert · shield-alert · shield |
| Result outcome | Pass · Control Failure · Pending Confirmation · No conclusion issued | success · danger · **info-solid** · neutral | check-circle-2 · alert-circle · user · slash |
| Auditor Review | Draft · Submitted · Approved · Finalized | neutral · warning · info · neutral-solid | pencil · clock · check · lock |
| Exception | Open · Under Review · Confirmed · Not an Exception | danger-outline · info · danger · neutral-solid | alert-circle · clock · alert-circle · ban |
| Evaluation origin | Rule-Classified · Agent-Judged (pending) · Agent-Judged (confirmed) · Human-classified | neutral · **info-solid** · info · info | braces · user · cpu · user-check |
| Evaluation value | Compliant · Exception · Unevaluated | success · danger · warning | check-circle-2 · alert-circle · help-circle |
| Work Item | Pending · In progress · Awaiting · Observed · Uninspected · Ambiguous · Failed | neutral · info · info-solid · success · warning · warning · danger-outline | clock · refresh-cw · user · check · slash · git-compare · x-circle |

Treatment names resolve to tokens: a plain family name (`neutral`, `info`, `success`, `warning`, `danger`) uses `{colors.<family>-bg}` fill, `{colors.<family>-border}` border, and `{colors.<family>-text}` text; a `-solid` variant uses `{colors.<family>-solid}` fill with `{colors.text-inverse}`; a `-outline` variant uses `{colors.<family>-border}` border and `{colors.<family>-text}` text with no fill. Evaluation value is the ninth row only in the sense that it labels a value, not a state; it is listed so the evaluation card's three words have one treatment.

Three distinctions are load-bearing and are enforced by three different treatments:

- **Control Failure** — filled danger badge, `alert-circle`. An audit result.
- **Run Failed** — outlined danger badge, `cloud-off`, always accompanied by an execution-failure panel naming the failed Session Step (workspace creation, Population Source acquisition, Target System sign-in, or Adapter extraction), retries, and error class. A platform result.
- **Inconclusive** — warning badge, `alert-triangle`, always accompanied by the failed Gate checks and a "Safe next action" panel. An evidence result.

**"Needs a human" is one treatment.** Awaiting Auditor, Pending Confirmation, Agent-Judged pending, and a Work Item awaiting an Escalation answer all use `{colors.info-solid}` with the `user` icon. It is the only solid blue in the product, so it reads as "your turn" from across the room without borrowing Inconclusive's warning or Control Failure's danger.

**Completed is neutral.** A Completed lifecycle badge is grey by design; only the Result outcome may be green. **Rejected is never a review state**: rejection is a review event rendered in history, and the Auditor Review badge returns to Draft with a "returned to Draft" annotation. The Rejected badge exists for Procedure Versions only. Gold appears only in the IntelliFin mark (`claude/mockups/assets/interlock-master.svg`, reverse variant on the sidebar).

# Typography

Inter at 400/500/600 only, tabular numerals everywhere a number can appear (`font-feature-settings: 'tnum'` at the root), numeric columns right-aligned. The type scale is the parent system's; the role names above (page-title, card-title, row-title, caption, overline) indicate where each size lives.

Monospace is a data type, not a style. It is used for and only for:

- Run, Exception, Evidence Package, and correlation identifiers; Procedure Version strings;
- record, account, and transaction identifiers; Exception fingerprints;
- ISO 8601 timestamps, record counts, and amounts;
- integrity digests, grounding locators, and extracted text;
- sanitized Tool Actions and Adapter calls on the Execution Timeline.

Prose, labels, headings, status words, and Escalation questions are always Inter.

`[ASSUMPTION]` The parent design system specifies no monospace token; a system monospace stack is used and should be replaced with a self-hosted face at implementation.

# Layout & Spacing

Desktop-first, optimized for 1280–1600px. `{spacing.sidebar}` navy sidebar, `{spacing.top-bar}` top bar, `{spacing.gutter}` page gutter, content capped at `{spacing.content-max}`. A `{spacing.ribbon}` environment ribbon sits above the top bar for the whole PoC ("Synthetic PoC environment — Population Sources and Target Systems are read-only synthetic systems. Results are not assurance conclusions.").

Detail screens use a two-column split: a flexible main column and a rail (`{spacing.rail}` on Overview and Run Detail, `{spacing.rail-procedure}` on Procedure Detail, `{spacing.rail-exception}` on Exception Detail, `{spacing.rail-session}` on Live View and Replay). The rail carries persistent context (cards listed in `EXPERIENCE.md` → Rail cards) so it never competes with the conclusion for vertical position. The Procedure Builder is single-column at `{spacing.builder-max}`.

The rail widths above apply at 1280px and wider. Breakpoint behavior is specified once, in `EXPERIENCE.md` → Responsive & Platform. No separate mobile product is designed.

# Elevation & Depth

Structure comes from 1px hairlines and spacing. Cards carry a border and no shadow. The only shadow in the product is on the confirmation dialog (`{components.confirmation-dialog.shadow}`) over a `{colors.scrim}` scrim. No gradients, no blur, no glass. The session viewer's navy chrome strip and the sidebar are the only large dark fills.

# Shapes

Radii per `rounded` above. The provenance chain uses a 22px pill marker with a 1px vertical connector — a ledger line, not an illustration.

# Components

Inherited from the IntelliFin Design System bundle and used unchanged:

- Sidebar.
- Button — primary · secondary · ghost · destructive; `{spacing.control-sm}` and `{spacing.control-md}`.
- StatusBadge — `{spacing.badge-sm}` in tables and lists, `{spacing.badge-md}` in the triptych and record headers. Extended locally with one family, `info-solid` (`{components.status-badge-info-solid}`); the parent's families are neutral, neutral-solid, info, success, warning, danger, danger-outline.
- Banner, EnvironmentRibbon, EmptyState.
- Tabs — `{spacing.tabs}`.
- Icon — Lucide subset, self-hosted at `claude/mockups/assets/lucide-icons.js`. Added by this document: pause, play, user, user-check, braces, cpu, help-circle, shield, bell, flag, archive, search-x.

Audit-specific patterns, composed from tokens (behavior in `EXPERIENCE.md`):

**Conclusion triptych** (Run Detail → Result). Three equal cells divided by hairlines — Run lifecycle, Evidence Quality Gate, Result outcome — over a single plain-language statement of what was evaluated. The third cell carries the outcome badge, a sealed/unsealed marker (`lock` when sealed, `user` when Pending Confirmation), and the Result version in `{typography.mono}`, always shown. This is the screen's primary object and the reason the state families can never be read as one.

**Evidence Quality Gate checklist.** Rows grouped under two `{typography.overline}` headers — *Per-Observation checks* and *Run-level checks* — sourced from addendum §H. Each row: status icon, check name and status word, diagnostic detail, and the rule applied. The header count is derived ("18 of 20 checks passed"), never a fixed "9/9". It reads as a trust checkpoint, not an alert banner; failure adds a "Safe next action" panel rather than a siren.

**Execution Timeline row.** Four-column grid (`{components.timeline-row.grid}`); rows nest by 20px per level — Session Step › Work Item › Step Execution › Tool Action. Each row shows a step marker, status icon, name and detail, a sanitized call box in `{typography.mono}`, and a right column with status word and duration. Work Item rows carry the Work Item badge; Escalation rows use the escalation-panel colors inline.

**Data table.** `{components.data-table}`: overline header on a sunken ground, hairline rows, first cell a `{typography.row-title}` link, numeric columns right-aligned in `{typography.mono}`, badges at `{spacing.badge-sm}`. Column sets per table are in `EXPERIENCE.md` → Component Patterns → Data tables.

**Exception list row.** `{components.exception-row}`: identifier link in `{typography.mono}` with the Exception state badge, the condition violated in `{typography.body-sm-relaxed}`, origin badge, masked identity where the binding designates it, and a persistent "Open" link on the right.

**Evidence item card.** `{components.evidence-item}`: header with the Target System or Population Source name and a kind badge (Structural Snapshot · Screenshot · Source excerpt · Recording segment · Adapter extract); a three-column grid of the FR-31 fields — Work Item, Target System, Step, capture method, capture time (UTC), integrity digest — in `{typography.caption}` labels over `{typography.mono}` values; an optional warning note (`note-background`) for partial or preserved-after-cancel artifacts.

**Population reconciliation.** Two-column table, labels left, monospace right-aligned values. File-level rows (declared, parsed, digest) above inclusion-level rows (rows in, included, excluded with reason). Differences are rendered in `{colors.warning-text}`. Excluded, Uninspected, and Unevaluated counts are always present.

**Evaluation card** (Result, Exception Detail). One card per condition on a record: condition text, an origin badge from the evaluation-origin family, a value badge from the evaluation-value family, and for Agent-Judged evaluations the rationale and confidence in `{typography.mono}`. Unevaluated is a value, never an origin; an Unevaluated evaluation still shows its origin. A replaced evaluation is rendered beneath its replacement at `{typography.caption}` in `{colors.text-muted}`.

**Grounding inspector** (Exception Detail, Evidence). For each attribute: original value, normalized value, the Structural Snapshot it was read from, locator and field label in `{typography.mono}`, and a corroboration badge (matched · contradictory · model-read). A human-matched record carries a `user-check` "Human-matched" badge beside its identity attribute (badge text title-cases the PRD's lowercase flag). The `user` glyph is reserved for "your turn" states.

**Provenance chain** (Exception Detail). Numbered steps in a ledger line: population record → grounded Observation → per-condition evaluations → Exception → Timeline segment, each showing the system that produced it and the raw value as inert monospace text. The last step is a link into Replay.

**Safe next action panel** (`{components.safe-next-action-panel}`) and **execution failure panel** (`{components.execution-failure-panel}`). `{typography.sub-title}` heading with icon, `{typography.body-sm-relaxed}` body, an `error_class` line in `{typography.mono}` on the failure panel. When they appear is in `EXPERIENCE.md` → Per-surface states.

**Untrusted source content.** Any retrieved free text that resembles an instruction — in Evidence or in an Escalation question — is displayed in a warning-bordered block as `<pre>` plain text, labeled with the field it came from and the statement that source content cannot change the Run objective, tool scope, or evaluation. Never rendered as markup.

**Escalation panel** (Live View, Run Detail while Awaiting Auditor). `{components.escalation-panel}` colors; heading with the Escalation kind, the Step, and a countdown in `{typography.mono}`; the agent-generated question in a sunken, inert block labeled "Agent-generated"; supporting Evidence beneath; the closed answer set as a row of secondary buttons; an optional note field labeled "Recorded, not sent to the agent".

**Session viewer** (Live View and Replay). A sandboxed viewport under a navy chrome strip (LIVE · PAUSED · AWAITING · REPLAY state dot and word, each dot from `{components.session-viewer}`, Agent Workspace identifier, "read-only · isolated credentials", Step counter), a Step scrubber built from `{components.session-viewer.scrubber-pill-height}` pills, and a narration rail (Session Steps and Work Items, current-Step narration, sanitized Tool Action, Observations so far). Adapter Session Steps render as a compact log row instead of a screen. Frames are the platform's Replay asset set; provider video, when retained, is a supplementary link. Controls per mode are in `EXPERIENCE.md`.

**Version diff** (Version review). `{components.version-diff}`: one block per Builder section, unchanged sections collapsed, changed sections outlined with `changed-section-border`, added and removed values as inert `{typography.mono}` on the success and danger grounds; the approval action bar (Approve · Reject with rationale) in the header; a Regression Run row inline while one is pending.

**Notification row and top-bar bell.** The top bar carries a `bell` icon with an unread count in `{components.status-badge-info-solid}` colors; each row (`{components.notification-row}`) shows Procedure, Run, Escalation kind, and a countdown in `{typography.mono}`.

**Procedure Builder.** Structured sections in a single column (`{components.builder-section}`): Template and Control · Period and scope · Population Source binding · Target Systems · Audit Instructions · Compliance Rule · Evidence Requirements · Schedule · Plan preview. Each section is a card with an overline label column and a value column. The Compliance Rule editor marks each condition with the evaluation-origin badge its evaluations will carry — Rule-Classified for a compiled condition, Agent-Judged for an uncompiled one — and shows its applicability predicate. The plan preview is read-only: rows in `{typography.mono}` for Session Steps and Plan Steps, with a "Re-derived {time}" caption; there are no Edit controls on plan rows. Scope-widening flags on Audit Instructions use the warning colors inline.

**Action bar and unavailable actions.** Actions sit in the record header at `{spacing.control-sm}`; a disabled action keeps its position, and its reason is visible text in the "Unavailable actions" panel (`{components.unavailable-actions-panel}`), never tooltip-only.

**Confirmation dialog.** A `{spacing.dialog}` modal over `{colors.scrim}` with `{components.confirmation-dialog.shadow}`. Three weights, defined behaviorally in `EXPERIENCE.md`: routine, routine with rationale field, and finalization, which alone uses the destructive primary button.

# Do's and Don'ts

**Do**

- Show Procedure Version, lifecycle, Gate, outcome, and review as separate objects, in that order.
- Pair every status color with an icon and a word; use `{colors.info-solid}` for every "your turn" state and nothing else.
- Name the Session Step, the check, and the record count when Evidence fails.
- Keep the sealed Result outcome visible next to any human disposition that disagrees with it.
- Use monospace for identifiers, values, digests, timestamps, locators, and Tool Actions only.
- Give disabled actions a visible reason.
- Render agent-generated text — narration, Escalation questions, rationales — as inert content, labeled as agent-generated.

**Don't**

- Don't present Completed as Pass, Pending Confirmation as Control Failure, or an empty Exception list as a compliant control.
- Don't use gold for any status, and don't use green for anything except Pass, a passed Gate, a Compliant evaluation, and an Observed Work Item.
- Don't let reviewer disagreement, a "Not an Exception" disposition, or a rejected Agent-Judged evaluation alter a Rule-Classified evaluation or a sealed outcome.
- Don't describe the agent in human terms, and don't add a chat, prompt, or free-text channel to it.
- Don't add KPI card walls, risk heatmaps, charts, or a persistent assistant panel.
- Don't rely on hover to reach an action or on a tooltip to carry an explanation.
- Don't show a "Rejected" review badge; rejection is history.
