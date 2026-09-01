---
name: IntelliFin Audit — Continuous Assurance
description: >
  Visual design contract for IntelliFin Audit, the agentic continuous-auditing and assurance
  surface inside the IntelliFin Business Suite. Inherits the IntelliFin Design System
  ("Ledger Signal"): navy foundation, teal as the single interaction signal, gold reserved for
  brand. Extends it with an audit-native semantic layer that keeps Run lifecycle, Evidence
  Quality Gate, System Outcome and Auditor Review visually distinct at all times.
colors:
  brand:
    navy: "#102A43"        # var(--navy-900) — sidebar, headings, primary text
    teal: "#0F766E"        # var(--teal-700) — every interactive element, and nothing else
    gold: "#C0942F"        # var(--gold-500) — brand mark only; never status, never buttons
  surface:
    page: "{colors.raw.grey50}"        # var(--bg-page)
    card: "{colors.raw.white}"         # var(--bg-surface)
    sunken: "{colors.raw.grey100}"     # var(--bg-sunken) — table headers, code blocks
    sidebar: "{colors.brand.navy}"     # var(--bg-sidebar)
    selected: "#F0FDFA"                # var(--bg-selected)
  border:
    default: "#E2E8F0"     # var(--border-default) — all hairlines
    strong: "#CBD5E1"      # var(--border-strong) — inputs, secondary buttons
    selected: "#0D9488"    # var(--border-selected)
  text:
    primary: "{colors.brand.navy}"     # var(--text-primary)
    secondary: "#475569"               # var(--text-secondary)
    muted: "#64748B"                   # var(--text-muted)
    inverse: "#FFFFFF"                 # var(--text-inverse)
    link: "{colors.brand.teal}"        # var(--text-link)
  semantic:
    success: { bg: "#F0FDF4", border: "#BBF7D0", text: "#15803D" }   # Pass, gate passed, compliant
    warning: { bg: "#FFFBEB", border: "#FDE68A", text: "#92400E" }   # Inconclusive, gate not passed, Submitted
    danger:  { bg: "#FEF2F2", border: "#FECACA", text: "#B91C1C" }   # Control Failure, Run Failed, Exception
    info:    { bg: "#EFF6FF", border: "#BFDBFE", text: "#1D4ED8" }   # Running, Approved, Under review
    neutral: { bg: "#F1F5F9", border: "#E2E8F0", text: "#475569" }   # Queued, Completed, Draft, no conclusion
    neutralSolid: "#64748B"                                           # Canceled, Finalized, Not an Exception
  focus: "#14B8A6"         # var(--focus-ring)
  raw:
    white: "#FFFFFF"
    grey50: "#F8FAFC"
    grey100: "#F1F5F9"
typography:
  family:
    sans: "Inter, 'Segoe UI', system-ui, sans-serif"      # var(--font-sans)
    mono: "ui-monospace, SFMono-Regular, Menlo, monospace" # [ASSUMPTION] identifiers only
  scale:
    pageTitle: { size: 20, line: 28, weight: 600 }   # screen titles, Run identifiers
    cardTitle: { size: 16, line: 24, weight: 600 }   # section and card headings
    subTitle:  { size: 14, line: 20, weight: 600 }
    body:      { size: 14, line: 21, weight: 400 }   # outcome statements, long prose
    bodySm:    { size: 13, line: 18, weight: 400 }   # tables, detail, list rows
    caption:   { size: 12, line: 16, weight: 400 }   # field labels, meta
    overline:  { size: 12, line: 16, weight: 500, transform: uppercase, tracking: "0.02em" }
  numerals: tabular          # font-feature-settings 'tnum' on every numeric surface
  maxWeight: 600
rounded:
  sm: 4        # var(--radius-sm) — inputs, inline code blocks, inline callouts
  md: 6        # var(--radius-md) — buttons, filter chips, selects, banners
  lg: 8        # var(--radius-lg) — cards, tables, modals
  pill: 999    # var(--radius-pill) — status badges, avatars, step markers
spacing:
  base: 4
  gutter: 24        # page gutter and section gap
  cardPadding: 20
  cardPaddingDense: "14px 20px"   # card headers and table-adjacent rows
  rowHeight: 36
  rowHeightDense: 32
  sidebar: 240
  topBar: 56
  contentMax: 1320
  railWidth: 340
components:
  sidebar: "{IntelliFinDesignSystem.Sidebar}"
  button: "{IntelliFinDesignSystem.Button}"
  statusBadge: "{IntelliFinDesignSystem.StatusBadge}"
  banner: "{IntelliFinDesignSystem.Banner}"
  environmentRibbon: "{IntelliFinDesignSystem.EnvironmentRibbon}"
  emptyState: "{IntelliFinDesignSystem.EmptyState}"
  tabs: "{IntelliFinDesignSystem.Tabs}"
  icon: "{IntelliFinDesignSystem.Icon}"
  audit:
    conclusionTriptych: { columns: 3, dividers: "{colors.border.default}", radius: "{rounded.lg}" }
    gateChecklist: { rowGrid: "20px 220px 1fr", rowPadding: "9px 20px" }
    provenanceChain: { markerSize: 22, connector: "1px {colors.border.default}", stepGap: 16 }
    reconciliationTable: { labelColumn: "60%", valueAlign: right, valueFont: "{typography.family.mono}" }
    evidenceItem: { grid: "repeat(3, 1fr)", gap: "8px 20px" }
    untrustedBlock: { border: "{colors.semantic.warning.border}", body: "{typography.family.mono}" }
---

# Brand & Style

IntelliFin Audit is a surface of the IntelliFin Business Suite, not a separate product. It inherits
the locked **Route C — "Ledger Signal"** direction: navy foundation, teal as the single interaction
signal, gold for brand pride only. The audit domain adds one requirement the parent system does not
have: four independent state families must never be confused with one another. That constraint —
not decoration — drives everything below.

Tone in the interface is that of an audit workpaper: factual, restrained, specific. Sentence case
everywhere. Every conclusion names what was tested, on which evidence, and under which version.
Where the system cannot conclude, it says so plainly ("Evidence incomplete. No control conclusion
issued.") rather than softening or hiding it.

Agent activity is real and, by product decision, a hero experience: the auditor authors a
procedure in plain language, reviews the compiled step plan, activates it, and can **watch the
agent execute in its read-only sandbox** — or replay the recorded session later. The session is
still evidence-first: every step is narrated factually, every tool call is shown sanitised, and the
session always ends at the Evidence Quality Gate and a deterministic Result. There is no
conversational affordance and no anthropomorphic language; the agent is watched, not chatted with.

# Colors

Inherited wholesale from `tokens/colors.css`. No new hues are introduced.

**Interaction.** Teal-700 is the only interactive colour: links, primary buttons, active tab
underline, active nav marker, focus ring (teal-500). Nothing decorative is teal.

**Status.** The four state families each own a distinct badge treatment, and every badge carries an
icon and a text label so colour is never the sole carrier of meaning.

| Family | States | Badge family | Icon |
| --- | --- | --- | --- |
| Run lifecycle | Queued · Running · Completed · Inconclusive · Run Failed · Canceled | neutral · info · neutral · warning · danger-outline · neutral-solid | clock · refresh-cw · check · alert-triangle · cloud-off · ban |
| Evidence Quality Gate | Passed · Not passed · Incomplete · Not evaluated | success · warning · danger-outline · neutral | shield-check · shield-alert · shield-alert · shield-check |
| System Outcome | Pass · Control Failure · No conclusion issued | success · danger · neutral | check-circle-2 · alert-circle · slash |
| Auditor Review | Draft · Submitted · Approved · Rejected · Finalized | neutral · warning · info · danger-outline · neutral-solid | pencil · clock · check · x-circle · lock |

Three distinctions are load-bearing and are enforced by three different treatments:

- **Control Failure** — filled danger badge, `alert-circle`. An audit result.
- **Run Failed** — outlined danger badge, `cloud-off`, always accompanied by an execution-failure
  panel naming the Source, retries and error class. A platform result.
- **Inconclusive** — warning badge, `alert-triangle`, always accompanied by the failed gate checks
  and a "Safe next action" panel. An evidence result.

**Completed is neutral.** A Completed lifecycle badge is grey by design; only the System Outcome
column may be green. Gold appears only in the IntelliFin mark.

# Typography

Inter at 400/500/600 only, tabular numerals everywhere a number can appear, numeric columns
right-aligned.

Monospace is a data type, not a style. It is used for and only for: Run and Exception identifiers,
Procedure Version strings, record and account identifiers, ISO 8601 timestamps, record counts,
amounts, integrity digests, correlation identifiers, artifact names, and sanitised tool calls in the
Execution trace. Prose, labels, headings and status text are always Inter.
`[ASSUMPTION]` The parent design system specifies no monospace token; a system monospace stack is
used and should be replaced with a self-hosted face at implementation.

# Layout & Spacing

Desktop-first, optimised for 1280–1600px. 240px navy sidebar, 56px top bar, 24px page gutter,
content capped at 1320px. A 32px environment ribbon sits above the top bar for the whole PoC.

Detail screens use a two-column split: a flexible main column and a 340px rail. The rail carries
persistent context — review state, change since the previous Run, the route into technical detail —
so those never compete with the conclusion for vertical position.

At 1024px the rail collapses beneath the main column and the Runs table scrolls horizontally with
the Run identifier column holding position. Below 900px the product enters a reading mode: single
column, tables become stacked label/value rows, actions move to the bottom of the record. No
separate mobile product is designed.

# Elevation & Depth

Structure comes from 1px hairlines and spacing. Cards carry a border and no shadow. The only
shadow in the product is on the confirmation modal (`0 12px 32px rgba(16,42,67,.24)`) over a plain
navy scrim at 45%. No gradients, no blur, no glass.

# Shapes

4px inputs and inline code blocks · 6px buttons, chips, banners, selects · 8px cards, tables,
modals · pill badges, avatars and provenance step markers. The provenance chain uses a 22px pill
marker with a 1px vertical connector — a ledger line, not an illustration.

# Components

**Conclusion triptych** (Run Detail). Three equal cells divided by hairlines — Run lifecycle,
Evidence Quality Gate, System Outcome — over a single plain-language statement of what was
evaluated. This is the screen's primary object and the reason the four state families can never be
read as one.

**Evidence Quality Gate checklist.** Nine rows: status icon, check name and status word, diagnostic
detail, and the rule applied. Header states the pass/fail/not-evaluated split. It reads as a trust
checkpoint, not an alert banner; failure states add a "Safe next action" panel rather than a siren.

**Population reconciliation.** Two-column table, labels left, monospace right-aligned values.
Differences are rendered in warning text. Excluded and unevaluated counts are always present.

**Provenance chain** (Exception Detail). Six numbered steps: source record → matched record →
transformation → comparison → rule and version → deterministic Exception. Each step shows the
system that produced it and the raw record as inert monospace text.

**Untrusted source content.** Any retrieved free text that resembles an instruction is displayed in
a warning-bordered block, as `<pre>` plain text, labelled with the field it came from and the
statement that source content cannot change the Run objective, tool scope or classification. Never
rendered as markup.

**Action bar and unavailable actions.** Actions sit in the record header. An action that is
unavailable by role or state keeps its position, is disabled, and its reason is repeated as visible
text in an "Unavailable actions" panel — the explanation is never tooltip-only.

**Confirmation.** Two weights. Routine decisions (submit, approve, rerun, export) use a modal that
restates the consequence. Rejection and disagreement additionally require a rationale field.
Finalization is the heaviest: it names irreversibility in the dialog title and states that Evidence,
Exceptions, Results and reviews become read-only.

**Agent session viewer.** A sandboxed viewport under a navy chrome strip (LIVE/REPLAY state, session
ID, "read-only · isolated credentials", step counter), a step scrubber, and a narration rail
(session steps, current-step narration, sanitised tool call). The viewport renders realistic mock
screens of the systems the agent works in — shared-drive explorer, Excel-like grid with extracted
rows highlighted, target-system login (credentials always masked and runner-injected), identity
console with per-account verdicts, and the closing gate/Result frame. Watching is read-only: cancel
is the only live control.

**Procedure authoring (hybrid).** Three steps: plain-language intent → compiled plan in a
structured editor (objective, sources, population, rule and boundary, schedule, numbered step plan)
→ deliberate activation that names the consequences (immutable version, read-only sandbox, human
review retained).

**Empty states.** Every empty state states what would appear here and explicitly refuses to imply a
passed control.

# Do's and Don'ts

**Do**

- Show lifecycle, gate, outcome and review as four separate objects, in that order.
- Pair every status colour with an icon and a word.
- Name the Source, the check and the record count when Evidence fails.
- Keep the System Outcome visible next to any human disposition that disagrees with it.
- Use monospace for identifiers, values, digests, timestamps and trace data only.
- Give disabled actions a visible reason.

**Don't**

- Don't present Completed as Pass, or an empty Exception list as a compliant control.
- Don't use gold for any status, and don't use green for anything except Pass, a passed gate, and
  compliant records.
- Don't let reviewer disagreement or a "Not an Exception" disposition alter a deterministic result.
- Don't promote agent activity above Evidence or Result, and don't describe it in human terms.
- Don't add KPI card walls, risk heatmaps, charts, or a persistent assistant panel.
- Don't rely on hover to reach an action or on a tooltip to carry an explanation.
