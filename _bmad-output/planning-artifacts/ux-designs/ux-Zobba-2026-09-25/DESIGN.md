---
name: Zobba
status: final
revision: 2
description: Visual contract for Zobba's chrome, generated from the Zobba design pack v1.0; the pack's tokens/zobba-tokens.json is the canonical machine-readable token source and this frontmatter restates it; artifacts keep the firm template's typography.
created: 2026-09-25
updated: 2026-09-25
amended: "2026-09-25 — aligned with EXPERIENCE.md after the owner's 18.2 screen-review decisions (design-acceptance register, Part D items 3, 5 and 6); no visual value changed"
supersedes: '../ux-IntelliFin Audit-2026-09-01/DESIGN.md (final, 2026-09-01), retained for the compiler-1 Run-path surfaces until their disposition stories'
sources:
  - ../zobba-design-system-v1.0/BRAND.md
  - ../zobba-design-system-v1.0/DESIGN-SYSTEM.md
  - ../zobba-design-system-v1.0/DESIGN-TOKENS.md
  - ../zobba-design-system-v1.0/tokens/zobba-tokens.json
  - ../zobba-design-system-v1.0/COMPONENT-INVENTORY.md
  - ../zobba-design-system-v1.0/ASSET-MANIFEST.md
  - ../zobba-design-system-v1.0/EXPERIENCE-RULES.md
  - ../zobba-design-system-v1.0/OPEN-QUESTIONS.md
  - ../zobba-design-system-v1.0/HANDOFF.md
  - ./EXPERIENCE.md
  - ../../prds/prd-IntelliFin Audit-2026-08-31/prd.md
  - ../../course-correction-2026-09-24/proposal-4-ux-experience.md
  - ../../course-correction-2026-09-24/proposal-4b-zobba-design-reconciliation.md
  - ../ux-IntelliFin Audit-2026-09-01/DESIGN.md
colors:
  # Semantic aliases, DESIGN-TOKENS.md §2 and tokens/zobba-tokens.json `semantic.color`, resolved values.
  # Name mapping is mechanical: `color.<a>.<b>[.<c>]` becomes `<a>-<b>[-<c>]`. Comments name the primitive and the use.
  text-primary: '#1C1B19'                # graphite.900 · Body text, headings
  text-secondary: '#3D3A35'              # graphite.600 · Supporting text, table cells in secondary columns
  text-tertiary: '#5E5A52'               # graphite.500 · Metadata, captions, section labels
  text-placeholder: '#716D64'            # graphite.400 · Input placeholder, Next activity line
  text-disabled: '#8C8578'               # graphite.300 · Disabled labels (not for essential information)
  text-inverse: '#F4F1EA'                # ivory.100 · Text on graphite surfaces
  text-inverse-secondary: '#B8B3A8'      # ivory.300 · Secondary text on graphite
  text-link: '#4C3FB8'                   # iris.600 · Links and inline actions
  text-link-hover: '#3B2F99'             # iris.700 · Link hover and pressed
  text-on-accent-wash: '#3B2F99'         # iris.700 · Presence chip, citation, selection tag
  surface-sidebar: '#EFEDE8'             # graphite.50 · Sidebar and rail (Linen)
  surface-canvas: '#FBFAF7'              # graphite.20 · Conversation surface (Canvas)
  surface-panel: '#FFFFFF'               # graphite.0 · Workspace panel (Paper)
  surface-artifact-surround: '#F6F5F1'   # graphite.30 · Area around an artifact page
  surface-artifact-page: '#FFFFFF'       # graphite.0 · Artifact page
  surface-raised: '#FFFFFF'              # graphite.0 · Cards, popovers, menus, drawers
  surface-user-message: '#EFEDE8'        # graphite.50 · Auditor message bubble
  surface-subtle: '#F3F1EC'              # graphite.40 · Inconclusive chip, quiet fills
  surface-hover: '#F3F1EC'               # graphite.40 · Row and nav hover
  surface-selected: '#FFFFFF'            # graphite.0 · Active nav item (with hairline ring)
  surface-selected-accent: '#F6F5FD'     # iris.50 · Selected block, selected table row, row being processed
  surface-attention: '#FFFBF3'           # amber.25 · Row needing attention (e.g. reconnect)
  surface-dark-base: '#1C1B19'           # graphite.900 · Marketing, notifications, future dark mode
  surface-dark-raised: '#2A2926'         # graphite.800 · Raised on dark
  border-dark: '#3A3935'                 # graphite.700 · Lines on dark
  border-hairline: '#E3E0D8'             # graphite.100 · Dividers, panel edges, card borders
  border-divider-inner: '#EFEDE8'        # graphite.50 · Row dividers inside tables and cards
  border-control: '#CCC8BD'              # graphite.200 · Chips, secondary buttons (decorative boundary)
  border-input: '#8F8A7F'                # graphite.250 · Composer, inputs, selects, reply options (3:1 boundary)
  border-strong: '#1C1B19'               # graphite.900 · Selected filter chip, tab underline
  action-primary-bg: '#1C1B19'           # graphite.900 · Primary buttons (Allow and send, Save, Send)
  action-primary-fg: '#FFFFFF'           # graphite.0 · Primary button label
  action-primary-hover: '#2A2926'        # graphite.800 · Primary hover
  action-secondary-border: '#8F8A7F'     # graphite.250 · Secondary button border
  action-disabled-bg: '#E3E0D8'          # graphite.100 · Disabled send
  action-disabled-fg: '#716D64'          # graphite.400 · Disabled send glyph
  accent-default: '#4C3FB8'              # iris.600 · Zobba presence, links, focus
  accent-strong: '#3B2F99'               # iris.700 · Accent text on wash
  accent-wash: '#EEECFA'                 # iris.100 · Presence chip, citation chip, focus ring halo
  accent-on-dark: '#B9B0F5'              # iris.300 · Accent on dark surfaces only
  selection-text: '#DAD5FA'              # iris.200 · Native text selection, active citation
  focus-ring: '#4C3FB8'                  # iris.600 · 2px focus ring
  status-pass-fg: '#1E6B35'              # green.700 · No exception
  status-pass-bg: '#EAF4EC'              # green.50
  status-exception-fg: '#B42318'         # red.700 · Exception, failure, Still active
  status-exception-bg: '#FDECEA'         # red.50
  status-warning-fg: '#8A4B06'           # amber.700 · Warning, needs attention
  status-warning-bg: '#FDF3E2'           # amber.50
  status-inconclusive-fg: '#3D3A35'      # graphite.600 · Inconclusive, coverage limitation
  status-inconclusive-bg: '#F3F1EC'      # graphite.40
  status-inconclusive-border: '#8C8578'  # graphite.300 · 1px dashed
  status-pending-fg: '#3D3A35'           # graphite.600 · Not reviewed
  status-pending-border: '#CCC8BD'       # graphite.200 · 1px solid outline
  diff-added-bg: '#E8E4DA'               # graphite.75 · Added content background
  diff-added-underline: '#1C1B19'        # graphite.900 · 1.5px underline
  diff-removed-fg: '#6F6B63'             # stone.removed · Removed content, struck through
  overlay-scrim: 'rgba(28,27,25,0.32)'   # no primitive · Behind a modal dialog on desktop, full-screen sheets on narrow
  overlay-drawer-shadow: 'rgba(28,27,25,0.10)'   # no primitive · Drawer edge shadow
primitives:
  # Primitive palette, DESIGN-TOKENS.md §1 and tokens/zobba-tokens.json `primitive.color`.
  # Never referenced by a component; components reference the semantic `colors` above.
  graphite:
    '0': '#FFFFFF'
    '20': '#FBFAF7'
    '30': '#F6F5F1'
    '40': '#F3F1EC'
    '50': '#EFEDE8'
    '75': '#E8E4DA'
    '100': '#E3E0D8'
    '150': '#D6D2C8'
    '200': '#CCC8BD'
    '250': '#8F8A7F'
    '300': '#8C8578'
    '400': '#716D64'
    '500': '#5E5A52'
    '600': '#3D3A35'
    '700': '#3A3935'
    '800': '#2A2926'
    '900': '#1C1B19'
  ivory:
    '100': '#F4F1EA'
    '300': '#B8B3A8'
  iris:
    '50': '#F6F5FD'
    '100': '#EEECFA'
    '200': '#DAD5FA'
    '300': '#B9B0F5'
    '600': '#4C3FB8'
    '700': '#3B2F99'
  green:
    '50': '#EAF4EC'
    '700': '#1E6B35'
  red:
    '50': '#FDECEA'
    '700': '#B42318'
  amber:
    '25': '#FFFBF3'
    '50': '#FDF3E2'
    '700': '#8A4B06'
  stone:
    removed: '#6F6B63'
typography:
  # DESIGN-TOKENS.md §4 and tokens/zobba-tokens.json `type`. Hanken Grotesk at 400, 500, 600 only;
  # IBM Plex Mono for identifiers and references only. Tables and counts use tabular-nums.
  # Artifacts use the methodology template's typography, not these tokens.
  family:
    ui: Hanken Grotesk
    mono: IBM Plex Mono
    fallback: '"Segoe UI", system-ui, sans-serif'
  display:             # Marketing hero only
    fontFamily: '{typography.family.ui}'
    fontSize: 60px
    lineHeight: 66px
    fontWeight: '600'
    letterSpacing: -0.035em
  greeting:            # Home greeting
    fontFamily: '{typography.family.ui}'
    fontSize: 38px
    lineHeight: 46px
    fontWeight: '600'
    letterSpacing: -0.022em
  page-title:          # Page header title (Engagement, Search, Settings)
    fontFamily: '{typography.family.ui}'
    fontSize: 16px
    lineHeight: 21px
    fontWeight: '600'
    letterSpacing: '0'
  panel-title:         # Workspace panel title
    fontFamily: '{typography.family.ui}'
    fontSize: 14px
    lineHeight: 19px
    fontWeight: '600'
    letterSpacing: '0'
  result:              # Readable conclusion of a scheduled result (19/28 narrow)
    fontFamily: '{typography.family.ui}'
    fontSize: 20px
    lineHeight: 30px
    fontWeight: '500'
    letterSpacing: -0.005em
  section:             # Section headings inside pages
    fontFamily: '{typography.family.ui}'
    fontSize: 13px
    lineHeight: 18px
    fontWeight: '600'
    letterSpacing: '0'
  heading:             # Task title
    fontFamily: '{typography.family.ui}'
    fontSize: 15px
    lineHeight: 20px
    fontWeight: '600'
    letterSpacing: '0'
  body:                # Conversation, Zobba replies, auditor messages (15/23 in bubbles)
    fontFamily: '{typography.family.ui}'
    fontSize: 15px
    lineHeight: 24px
    fontWeight: '400'
    letterSpacing: '0'
  ui:                  # Navigation, lists, rows
    fontFamily: '{typography.family.ui}'
    fontSize: 14px
    lineHeight: 20px
    fontWeight: '400|500|600'
    letterSpacing: '0'
  label:               # Buttons, chips, form labels
    fontFamily: '{typography.family.ui}'
    fontSize: 13px
    lineHeight: 18px
    fontWeight: '500|600'
    letterSpacing: '0'
  meta:                # Metadata, captions, section labels (600)
    fontFamily: '{typography.family.ui}'
    fontSize: 12px
    lineHeight: 16px
    fontWeight: '400'
    letterSpacing: '0'
  table-head:          # Table headers
    fontFamily: '{typography.family.ui}'
    fontSize: 12px
    lineHeight: 16px
    fontWeight: '600'
    letterSpacing: '0'
  table-cell:          # Table cells; tabular-nums
    fontFamily: '{typography.family.ui}'
    fontSize: 13px
    lineHeight: 18px
    fontWeight: '400'
    letterSpacing: '0'
  id:                  # Identifiers and references only (the pack writes the size as 12/18 IBM Plex Mono)
    fontFamily: '{typography.family.mono}'
    fontSize: 12px
    lineHeight: 18px
    fontWeight: '400'
    letterSpacing: '0'
  chip:                # Status and presence chips
    fontFamily: '{typography.family.ui}'
    fontSize: 12px
    lineHeight: 16px
    fontWeight: '600'
    letterSpacing: '0'
rounded:
  # DESIGN-TOKENS.md §6, `radius`. Uses (DESIGN-SYSTEM §2): 4 citation chips, 6 selection tags,
  # 8 buttons, inputs and tables, 12 cards and confirmations, 16 message bubbles, 18 composer, pill chips.
  xs: 4px
  sm: 6px
  md: 8px
  lg: 12px
  xl: 16px
  composer: 18px
  pill: 999px
  icon: 22.5%
spacing:
  # DESIGN-TOKENS.md §5 (`space`) and §9 (`layout`, prefixed `layout-` here). The JSON writes pixel values unitless.
  '0': 0px
  '1': 4px
  '2': 8px
  '3': 12px
  '4': 16px
  '5': 20px
  '6': 24px
  '8': 32px
  '10': 40px
  '12': 48px
  layout-sidebar: 248px
  layout-rail: 52px
  layout-header: 52px
  layout-header-page: 60px
  layout-conversation-min: 400px
  layout-conversation-max-reading: 720px
  layout-panel-default: 540px
  layout-panel-min: 420px
  layout-panel-max-ratio: 62%
  layout-drawer: 470px
  layout-composer-home: 720px
  layout-page-content-max: 800px
  layout-reading-measure: 72ch
breakpoint:
  # DESIGN-TOKENS.md §14. Ranges in CSS pixels; what changes at each is in the body, Layout.
  mobile: 0–599
  tablet: 600–1023
  desktop: 1024–1599
  desktop-reference: 1280×800
  large: 1600+
border:
  # DESIGN-TOKENS.md §7.
  hairline: 1px
  input: 1px
  input-focus: 1.5px
  diff-underline: 1.5px
  selection: 2px
shadow:
  # DESIGN-TOKENS.md §8. Elevation levels are in the body, Tokens.
  composer: '0 2px 10px rgba(28,27,25,.05)'
  page: '0 1px 3px rgba(28,27,25,.08)'
  popover: '0 12px 32px rgba(28,27,25,.14)'
  drawer: '-12px 0 32px rgba(28,27,25,.10)'
  dialog: '0 24px 64px rgba(28,27,25,.20)'
motion:
  # DESIGN-TOKENS.md §13. All UI motion drops to an instant change under reduced motion.
  duration-instant: 80ms
  duration-hover: 120ms
  duration-fast: 160ms
  duration-panel: 200ms
  duration-drawer: 220ms
  duration-mark-complete: 1100ms
  duration-mark-working-cycle: 3600ms
  easing-standard: 'cubic-bezier(.2,0,0,1)'
  easing-exit: 'cubic-bezier(.4,0,1,1)'
  easing-mark-working: 'cubic-bezier(.45,0,.25,1)'
  easing-mark-settle: 'cubic-bezier(.2,.7,.2,1)'
  mark-travel: '3 grid units (9.4% of symbol height)'
icon:
  # DESIGN-TOKENS.md §10. Outline only.
  grid: 24px
  dense: 20px
  small: 16px
  stroke: '2px (1.5px at 16px)'
  cap: round
  join: round
  corner-radius: 2.5px
focus:
  # DESIGN-TOKENS.md §11.
  ring: '2px solid color.focus.ring, offset 2px'
  composer: '1.5px color.accent.default border + 0 0 0 4px color.accent.wash'
selection:
  # DESIGN-TOKENS.md §12.
  block: '0 0 0 2px color.accent.default + color.surface.selected-accent, radius 2'
  row: 'inset 2px 0 0 color.accent.default + color.surface.selected-accent'
  text: 'color.selection.text'
  tag: 'color.accent.strong on color.accent.wash, radius 6'
---

# Zobba — Visual Design Contract

Revision 2 of the visual design contract, and the first under the product name **Zobba** ("The audit agent", by Raeltec; formerly IntelliFin Audit). It consolidates the approved Proposal 4 (U4, U5, U10, U11) and Proposal 4b (§2, §3, §5 rows 1, 3, 6, 8, 12, 15, §6a, §8, §10) against the Zobba design pack v1.0 filed at `../zobba-design-system-v1.0/`. No implementation is authorised by this document.

## 1. Precedence and scope

- **The pack is the authoritative visual and interaction specification.** `../zobba-design-system-v1.0/` (BRAND, DESIGN-SYSTEM, DESIGN-TOKENS with `tokens/zobba-tokens.json`, EXPERIENCE-RULES, COMPONENT-INVENTORY, PATTERNS, ASSET-MANIFEST and `assets/`, the 23 reference screens) is the design input (its HANDOFF §4; Proposal 4b governing rule). This document restates the pack's tokens in a machine-readable frontmatter and adds the audit-native state-family layer (section 5). It does not change a pack value.
- **Canonical token source.** `tokens/zobba-tokens.json` is the canonical machine-readable token source. The frontmatter above restates it. Where the pack's JSON and its markdown disagree, the JSON value is used and the disagreement is recorded in section 8.
- **On conflict:** `./EXPERIENCE.md` revision 2 governs behaviour and copy; this document governs visual values (tokens, sizes, treatments, glyphs). Between an approved requirement or contract and the pack, Proposal 4b §5 lists the conflict and its smallest amendment, and section 5 of this document applies the rows that affect status presentation.
- **The Zobba chrome replaces "Ledger Signal".** The Ledger Signal token set (navy, teal, gold; Inter; the IntelliFin Design System inheritance) is retired for the chrome. The previous contract, `../ux-IntelliFin Audit-2026-09-01/DESIGN.md` (final, 2026-09-01), remains the visual contract for the compiler-1 Run-path surfaces (Run Detail, Live View, Replay, the Procedure Builder and version review, Exception Detail) until each surface's disposition story lands (Proposal 4 U2, D-3d-4, Proposal 7).
- **Artifacts are not restyled by the chrome** (pack R3.1–R3.4). Working papers and reports use the firm template's typography, layout, reference scheme and colours. Prepared by and Reviewed by name accountable people; Zobba is never the preparer or reviewer. "Prepared with Zobba · draft n · ref" is footer provenance, on by default and firm-controlled (Q3 as decided in Proposal 4b §6a), and never implies a review or sign-off. Selection, citation chips and diff marks are workspace overlays and are not exported. Iris and the symbol never appear inside a client working-paper body.
- **Light-only working UI in the first release** (Proposal 4b §6a, Q4). The dark tokens (`surface-dark-base`, `surface-dark-raised`, `border-dark`, `accent-on-dark`, `text-inverse`, `text-inverse-secondary`) are used for marketing and notification assets only; their existence does not imply a dark application theme.
- **Icons: Lucide at 2px is the provisional implementation selection** (Proposal 4b §6a, Q5), subject to the visual and accessibility requirements in section 3 (Icon). The pack supplies no icon source.
- **History.** The prototype contract at `../ux-IntelliFin Audit-2026-09-01/claude/DESIGN.md` was already superseded by the 2026-09-01 contract and stays as history. It is not a contract for either chrome.

## 2. Identity

### Pair

Zobba's work is always a relationship between two things: claim and evidence, conversation and artifact, auditor and Zobba, expected and actual, source and conclusion (BRAND §1). The symbol is two forms held against the same centre line, offset so that neither completes the other; Zobba's job is to bring them level and show where they do not agree. The wordmark's stepped second b, the working state (the forms move toward level while Zobba compares) and the layout (conversation beside the work) carry the same idea. Pair is a concept, not a pattern: paired shapes, split layouts or doubled motifs are not repeated as decoration.

### Core palette

**Graphite, Linen and Iris.** Approved brand names: Graphite `#1C1B19`, Iris `#4C3FB8`, Iris strong `#3B2F99`, Iris wash `#EEECFA`, Iris light `#B9B0F5`, Linen `#EFEDE8`, Canvas `#FBFAF7`, Paper `#FFFFFF` (DESIGN-TOKENS §1).

**Iris means "Zobba is here" or "you can act on this". It never carries an audit result** (BRAND §3).

| Iris is permitted | Iris is prohibited |
|---|---|
| Symbol right form | Result chips (pass, exception, inconclusive) |
| Presence chip "Zobba is …" | Exception or pass counts |
| Working rows, the current activity mark | Buttons that approve, sign off or send (primary buttons are Graphite) |
| Links, citation chips, evidence references | Artifact body and exported documents |
| Focus rings, composer focus | Charts of audit results |
| Selection of a claim, block or row | Large fills, gradients, marketing washes |

**Audit semantics are independent of the brand** (BRAND §3). Green is available for "no exception" because the brand is not green.

| Meaning | Treatment |
|---|---|
| No exception / pass | `#1E6B35` on `#EAF4EC`, ✓ |
| Exception / failure | `#B42318` on `#FDECEA`, ! |
| Warning | `#8A4B06` on `#FDF3E2`, ▲ |
| Inconclusive / coverage limitation | `#3D3A35` on `#F3F1EC`, 1px dashed `#8C8578` border, ◐ |
| Pending review | `#3D3A35` with a `#CCC8BD` outline, ○ |
| Changes: added | 1.5px Graphite underline on `#E8E4DA` |
| Changes: removed | Struck through, `#6F6B63` |

### Filed assets

Implementers use the supplied SVGs. The logo is never rebuilt with CSS or live font text. All paths are relative to `../zobba-design-system-v1.0/assets/` (ASSET-MANIFEST).

| Asset | Files | Status | Use |
|---|---|---|---|
| Symbol, colour | `symbol/zobba-symbol-color.svg` · `symbol/zobba-symbol-small-color.svg` · `symbol/zobba-symbol-micro-color.svg` | Final geometry | Default on light: ≥ 20px, 13–19px (wider channel), ≤ 12px (widest channel) |
| Symbol, one colour | `symbol/zobba-symbol-mono.svg` · `symbol/zobba-symbol-small-mono.svg` · `symbol/zobba-symbol-micro-mono.svg` | Final geometry | One colour, Graphite: print, provenance |
| Symbol, reverse | `symbol/zobba-symbol-reverse.svg` · `symbol/zobba-symbol-small-reverse.svg` · `symbol/zobba-symbol-micro-reverse.svg` | Final geometry | White + Iris light on dark surfaces |
| Symbol, reverse one colour | `symbol/zobba-symbol-reverse-mono.svg` · `symbol/zobba-symbol-small-reverse-mono.svg` · `symbol/zobba-symbol-micro-reverse-mono.svg` | Final geometry | White only: photography, OS templates |
| Symbol, raster provenance | `symbol/png/zobba-symbol-micro-mono-10.png` · `symbol/png/zobba-symbol-micro-mono-12.png` | Final geometry | Raster provenance (@2x) at 10px and 12px |
| Wordmark | `wordmark/zobba-wordmark-graphite.svg` · `wordmark/zobba-wordmark-reverse.svg` | Production-ready, pending specialist drawing (Q2) | Wordmark alone on light; on dark (`#F4F1EA`) |
| Horizontal lockup | `lockup/zobba-lockup-color.svg` · `lockup/zobba-lockup-mono.svg` · `lockup/zobba-lockup-reverse.svg` | Production-ready, pending specialist drawing (Q2) | Primary; one colour; on dark. Product sidebar at 20px, sign-in, documentation |
| Endorsed lockup | `lockup/zobba-lockup-endorsed-color.svg` · `lockup/zobba-lockup-endorsed-reverse.svg` | Production-ready, pending specialist drawing (Q2) | "Zobba by Raeltec": marketing, sign-in, About, proposals, external PDFs, installer |
| Provenance lockup | `lockup/zobba-provenance-mono.svg` | Production-ready, pending specialist drawing (Q2) | Artifact footer, print |
| App icon | `icon/zobba-app-icon-dark.svg` (≥ 32px) · `icon/zobba-app-icon-dark-small.svg` (16–24px) · `icon/zobba-app-icon-light.svg` · `icon/zobba-app-icon-light-small.svg` | Final geometry | Graphite rounded square (radius 22.5%), symbol at 64% scale; light variant for light docks and marketing |
| App icon, raster | `icon/png/zobba-app-icon-{dark,light}-{512,256,96,48,32,24,16}.png` | Final geometry | Raster exports |
| Notification template | `icon/zobba-notification-template-black.svg` · `icon/zobba-notification-template-white.svg` | Final geometry | OS notification and menu-bar template (filed for later; see section 8, Q6) |
| Favicon | `favicon/favicon.svg` · `favicon/favicon-16.png` · `favicon/favicon-32.png` · `favicon/favicon-48.png` | Final geometry | Modern browsers; fallback and `.ico` source |
| Reference only | `reference/zobba-wordmark-lowercase-reference.svg` · `reference/zobba-wordmark-unstepped-reference.svg` | Reference only | Validation comparison. Not approved; never shipped |

Symbol construction and minimums (BRAND §2, DESIGN-TOKENS §15): 32 × 32 grid; forms 11 × 18, outer radius 5.5, inner radius 1.2, offset 6; channel 2 units at ≥ 20px, 2.8 at 13–19px, 3.6 at ≤ 12px; symbol viewBox `0 0 32 32` with its built-in 4-unit margin. Wordmark: Hanken Grotesk 600 outlines, tracking −28/1000, b–b −50/1000, second b ascender cut at 595/1000. Lockup: symbol visible height = cap height, gap = one form width (11 grid units). Endorsement: "by Raeltec" Hanken 500 at 42% of wordmark size, baseline-aligned, gap 0.28 × size, Graphite 500 (`#5E5A52`) or `#B8B3A8` on dark. Clear space: one form width on all sides. Minimum sizes: symbol on screen 12px (`-micro`); symbol in print or provenance 10px one colour (`-micro-mono`); horizontal lockup 16px wordmark size (≈ 12px cap height); endorsed lockup 24px wordmark size. The endorsement appears only in external contexts (BRAND §5), never in the product sidebar, rail, app icon, notifications or the artifact footer.

Prohibited (BRAND §2): recolouring the forms with a semantic colour or showing ✓, ! or a badge on or beside the symbol; rotating, mirroring, levelling the forms or changing the offset; gradients, glows, shadows, outlines or 3D; lowercase, uppercase, unstepped or live-text wordmarks; the symbol as a bullet, divider, per-message avatar, loading spinner or decoration.

### The Pair mark states

| State | Form | Motion | Where |
|---|---|---|---|
| Idle | Offset, still | none | Sidebar logo, Home, provenance |
| Working | Offset ↔ level | Each form travels `motion.mark-travel` (3 grid units) toward level, holds, and returns. `motion.duration-mark-working-cycle` (3.6s) cycle, `motion.easing-mark-working`, infinite while the step runs | The current activity step, the presence chip, the active recent-task row, the working table row |
| Waiting for you | Level, still; right form as a 1.6-unit outline | none | "Zobba needs your input" or "…your permission", the waiting task row |
| Complete | Level → offset once | `motion.duration-mark-complete` (1.1s), `motion.easing-mark-settle`, once, then idle | When a task finishes. The result chip carries the outcome |

Rules (DESIGN-SYSTEM §4, COMPONENT-INVENTORY): **one animated mark per view region**, always beside activity text; the mark is `aria-hidden="true"` and the adjacent text carries the meaning. **Reduced motion:** Working is shown level and still with the activity text unchanged; Complete shows no settle. **The mark never carries a result:** no motion that implies pass or fail, no progress percentages, no pulsing, spinning or shimmering effects, no loading spinners built from the mark. The reference implementation of the motion is `../zobba-design-system-v1.0/source/Zobba Pair Mark.dc.html`.

## 3. Tokens

The frontmatter restates every token below. Tables here repeat the pack exactly for readers. **Implementation obligation (not a change made now):** after its implementation story, `apps/web/src/design/tokens.test.ts` reads `../zobba-design-system-v1.0/tokens/zobba-tokens.json` (or this frontmatter, which restates it) instead of the 2026-09-01 contract; see section 9.

### Primitive palette (DESIGN-TOKENS §1)

`primitive.*` values are never used directly in components.

| Family | Step | Value |
|---|---|---|
| graphite | 0 | `#FFFFFF` |
| graphite | 20 | `#FBFAF7` |
| graphite | 30 | `#F6F5F1` |
| graphite | 40 | `#F3F1EC` |
| graphite | 50 | `#EFEDE8` |
| graphite | 75 | `#E8E4DA` |
| graphite | 100 | `#E3E0D8` |
| graphite | 150 | `#D6D2C8` |
| graphite | 200 | `#CCC8BD` |
| graphite | 250 | `#8F8A7F` |
| graphite | 300 | `#8C8578` |
| graphite | 400 | `#716D64` |
| graphite | 500 | `#5E5A52` |
| graphite | 600 | `#3D3A35` |
| graphite | 700 | `#3A3935` |
| graphite | 800 | `#2A2926` |
| graphite | 900 | `#1C1B19` |
| ivory | 100 | `#F4F1EA` |
| ivory | 300 | `#B8B3A8` |
| iris | 50 | `#F6F5FD` |
| iris | 100 | `#EEECFA` |
| iris | 200 | `#DAD5FA` |
| iris | 300 | `#B9B0F5` |
| iris | 600 | `#4C3FB8` |
| iris | 700 | `#3B2F99` |
| green | 50 | `#EAF4EC` |
| green | 700 | `#1E6B35` |
| red | 50 | `#FDECEA` |
| red | 700 | `#B42318` |
| amber | 25 | `#FFFBF3` |
| amber | 50 | `#FDF3E2` |
| amber | 700 | `#8A4B06` |
| stone | removed | `#6F6B63` |

### Semantic colour aliases (DESIGN-TOKENS §2)

Components reference these names. The frontmatter key is the token name without `color.` and with `.` replaced by `-`.

| Token | Primitive | Resolved | Use |
|---|---|---|---|
| `color.text.primary` | `graphite.900` | `#1C1B19` | Body text, headings |
| `color.text.secondary` | `graphite.600` | `#3D3A35` | Supporting text, table cells in secondary columns |
| `color.text.tertiary` | `graphite.500` | `#5E5A52` | Metadata, captions, section labels |
| `color.text.placeholder` | `graphite.400` | `#716D64` | Input placeholder, "Next:" activity line |
| `color.text.disabled` | `graphite.300` | `#8C8578` | Disabled labels (not for essential information) |
| `color.text.inverse` | `ivory.100` | `#F4F1EA` | Text on graphite surfaces |
| `color.text.inverse-secondary` | `ivory.300` | `#B8B3A8` | Secondary text on graphite |
| `color.text.link` | `iris.600` | `#4C3FB8` | Links and inline actions |
| `color.text.link-hover` | `iris.700` | `#3B2F99` | Link hover and pressed |
| `color.text.on-accent-wash` | `iris.700` | `#3B2F99` | Presence chip, citation, selection tag |
| `color.surface.sidebar` | `graphite.50` | `#EFEDE8` | Sidebar and rail (Linen) |
| `color.surface.canvas` | `graphite.20` | `#FBFAF7` | Conversation surface (Canvas) |
| `color.surface.panel` | `graphite.0` | `#FFFFFF` | Workspace panel (Paper) |
| `color.surface.artifact-surround` | `graphite.30` | `#F6F5F1` | Area around an artifact page |
| `color.surface.artifact-page` | `graphite.0` | `#FFFFFF` | Artifact page |
| `color.surface.raised` | `graphite.0` | `#FFFFFF` | Cards, popovers, menus, drawers |
| `color.surface.user-message` | `graphite.50` | `#EFEDE8` | Auditor message bubble |
| `color.surface.subtle` | `graphite.40` | `#F3F1EC` | Inconclusive chip, quiet fills |
| `color.surface.hover` | `graphite.40` | `#F3F1EC` | Row and nav hover |
| `color.surface.selected` | `graphite.0` | `#FFFFFF` | Active nav item (with hairline ring) |
| `color.surface.selected-accent` | `iris.50` | `#F6F5FD` | Selected block, selected table row, row being processed |
| `color.surface.attention` | `amber.25` | `#FFFBF3` | Row needing attention (e.g. reconnect) |
| `color.surface.dark.base` | `graphite.900` | `#1C1B19` | Marketing, notifications, future dark mode |
| `color.surface.dark.raised` | `graphite.800` | `#2A2926` | Raised on dark |
| `color.border.dark` | `graphite.700` | `#3A3935` | Lines on dark |
| `color.border.hairline` | `graphite.100` | `#E3E0D8` | Dividers, panel edges, card borders |
| `color.border.divider-inner` | `graphite.50` | `#EFEDE8` | Row dividers inside tables and cards |
| `color.border.control` | `graphite.200` | `#CCC8BD` | Chips, secondary buttons (decorative boundary) |
| `color.border.input` | `graphite.250` | `#8F8A7F` | Composer, inputs, selects, reply options (3:1 boundary) |
| `color.border.strong` | `graphite.900` | `#1C1B19` | Selected filter chip, tab underline |
| `color.action.primary.bg` | `graphite.900` | `#1C1B19` | Primary buttons: Allow and send, Save, Send |
| `color.action.primary.fg` | `graphite.0` | `#FFFFFF` | Primary button label |
| `color.action.primary.hover` | `graphite.800` | `#2A2926` | Primary hover |
| `color.action.secondary.border` | `graphite.250` | `#8F8A7F` | Secondary button border |
| `color.action.disabled.bg` | `graphite.100` | `#E3E0D8` | Disabled send |
| `color.action.disabled.fg` | `graphite.400` | `#716D64` | Disabled send glyph |
| `color.accent.default` | `iris.600` | `#4C3FB8` | Zobba presence, links, focus |
| `color.accent.strong` | `iris.700` | `#3B2F99` | Accent text on wash |
| `color.accent.wash` | `iris.100` | `#EEECFA` | Presence chip, citation chip, focus ring halo |
| `color.accent.on-dark` | `iris.300` | `#B9B0F5` | Accent on dark surfaces only |
| `color.selection.text` | `iris.200` | `#DAD5FA` | Native text selection, active citation |
| `color.focus.ring` | `iris.600` | `#4C3FB8` | 2px focus ring |
| `color.status.pass.fg` | `green.700` | `#1E6B35` | No exception |
| `color.status.pass.bg` | `green.50` | `#EAF4EC` |  |
| `color.status.exception.fg` | `red.700` | `#B42318` | Exception / failure / "Still active" |
| `color.status.exception.bg` | `red.50` | `#FDECEA` |  |
| `color.status.warning.fg` | `amber.700` | `#8A4B06` | Warning, needs attention |
| `color.status.warning.bg` | `amber.50` | `#FDF3E2` |  |
| `color.status.inconclusive.fg` | `graphite.600` | `#3D3A35` | Inconclusive / coverage limitation |
| `color.status.inconclusive.bg` | `graphite.40` | `#F3F1EC` |  |
| `color.status.inconclusive.border` | `graphite.300` | `#8C8578` | 1px dashed |
| `color.status.pending.fg` | `graphite.600` | `#3D3A35` | Not reviewed |
| `color.status.pending.border` | `graphite.200` | `#CCC8BD` | 1px solid outline |
| `color.diff.added.bg` | `graphite.75` | `#E8E4DA` | Added content background |
| `color.diff.added.underline` | `graphite.900` | `#1C1B19` | 1.5px underline |
| `color.diff.removed.fg` | `stone.removed` | `#6F6B63` | Removed content, struck through |
| `color.overlay.scrim` | — | `rgba(28,27,25,0.32)` | Behind a modal dialog on desktop, full-screen sheets on narrow |
| `color.overlay.drawer-shadow` | — | `rgba(28,27,25,0.10)` | Drawer edge shadow |

The pack's own note (DESIGN-TOKENS §2): `color.border.input` (`#8F8A7F`) was added because `#CCC8BD` is only 1.67:1 against white and fails the 3:1 non-text requirement for identifying an input; `#CCC8BD` remains for decorative boundaries. Placeholder text moved from `#7A766D` to `#716D64` because the former is 4.34:1 on Canvas.

### Typography (DESIGN-TOKENS §4)

**Hanken Grotesk** for all UI and chrome, weights 400, 500, 600, never above 600. **IBM Plex Mono** 400, 500 for identifiers and references only (AG-91002, ZB-7F3A). Fallback: `"Segoe UI", system-ui, sans-serif`. Tables and counts use `font-variant-numeric: tabular-nums`. There is no serif; the Home greeting is Hanken 38/46 600 (HANDOFF §4.5). Both families are SIL OFL 1.1; the pack includes no font binaries. Artifacts use the methodology template typography, not these tokens.

| Token | Size / line height (px) | Weight | Tracking | Use |
|---|---|---|---|---|
| `type.display` | 60/66 | 600 | -0.035em | Marketing hero only |
| `type.greeting` | 38/46 | 600 | -0.022em | Home greeting |
| `type.page-title` | 16/21 | 600 | 0 | Page header title (Engagement, Search, Settings) |
| `type.panel-title` | 14/19 | 600 | 0 | Workspace panel title |
| `type.result` | 20/30 | 500 | -0.005em | Readable conclusion of a scheduled result (19/28 narrow) |
| `type.section` | 13/18 | 600 | 0 | Section headings inside pages |
| `type.heading` | 15/20 | 600 | 0 | Task title |
| `type.body` | 15/24 | 400 | 0 | Conversation, Zobba replies, auditor messages (15/23 in bubbles) |
| `type.ui` | 14/20 | 400\|500\|600 | 0 | Navigation, lists, rows |
| `type.label` | 13/18 | 500\|600 | 0 | Buttons, chips, form labels |
| `type.meta` | 12/16 | 400 | 0 | Metadata, captions, section labels (600) |
| `type.table-head` | 12/16 | 600 | 0 | Table headers |
| `type.table-cell` | 13/18 | 400 | 0 | Table cells; tabular-nums |
| `type.id` | 12/18 IBM Plex Mono | 400 | 0 | Identifiers and references only |
| `type.chip` | 12/16 | 600 | 0 | Status and presence chips |

### Space, layout, radius, border (DESIGN-TOKENS §5–§7, §9)

| Space | Value |
|---|---|
| `space.0` | 0px |
| `space.1` | 4px |
| `space.2` | 8px |
| `space.3` | 12px |
| `space.4` | 16px |
| `space.5` | 20px |
| `space.6` | 24px |
| `space.8` | 32px |
| `space.10` | 40px |
| `space.12` | 48px |

| Layout | Value |
|---|---|
| `layout.sidebar` | 248px |
| `layout.rail` | 52px |
| `layout.header` | 52px |
| `layout.header-page` | 60px |
| `layout.conversation-min` | 400px |
| `layout.conversation-max-reading` | 720px |
| `layout.panel-default` | 540px |
| `layout.panel-min` | 420px |
| `layout.panel-max-ratio` | 62% |
| `layout.drawer` | 470px |
| `layout.composer-home` | 720px |
| `layout.page-content-max` | 800px |
| `layout.reading-measure` | 72ch |

| Radius | Value | Use (DESIGN-SYSTEM §2) |
|---|---|---|
| `radius.xs` | 4px | Citation chips |
| `radius.sm` | 6px | Selection tags |
| `radius.md` | 8px | Buttons, inputs, tables |
| `radius.lg` | 12px | Cards, confirmations |
| `radius.xl` | 16px | Message bubbles |
| `radius.composer` | 18px | Composer |
| `radius.pill` | 999px | Chips |
| `radius.icon` | 22.5% | App icon square |

| Border | Value |
|---|---|
| `border.hairline` | 1px |
| `border.input` | 1px |
| `border.input-focus` | 1.5px |
| `border.diff-underline` | 1.5px |
| `border.selection` | 2px |

### Elevation (DESIGN-TOKENS §8, DESIGN-SYSTEM §2)

| Level | Surface | Border and shadow | Examples |
|---|---|---|---|
| 0 | Canvas `#FBFAF7`, Linen sidebar | none | Conversation, sidebar |
| 1 | Paper `#FFFFFF` | 1px hairline | Workspace panel, cards, composer, tables |
| 1a | Artifact page on surround | `shadow.page` | Working paper |
| 2 | Paper | hairline + `shadow.popover` | Citation preview, menus, tooltips |
| 3 | Paper | hairline + `shadow.drawer` | Evidence drawer |
| 4 | Paper | `shadow.dialog` + scrim | Dialogs, used only where unavoidable: destructive confirmation in Settings, sign-in |

| Shadow | Value |
|---|---|
| `shadow.composer` | 0 2px 10px rgba(28,27,25,.05) |
| `shadow.page` | 0 1px 3px rgba(28,27,25,.08) |
| `shadow.popover` | 0 12px 32px rgba(28,27,25,.14) |
| `shadow.drawer` | -12px 0 32px rgba(28,27,25,.10) |
| `shadow.dialog` | 0 24px 64px rgba(28,27,25,.20) |

Hover is a `surface.hover` fill on rows and nav items with the link colour moving to Iris strong; there is no lift or shadow on hover. Avoid cards: use lists with hairlines; cards are for discrete objects only (a confirmation, an attachment, a working-data link). No gradients, glows or illustration in the product (BRAND §1).

### Motion (DESIGN-TOKENS §13, DESIGN-SYSTEM §4)

| Token | Value |
|---|---|
| `motion.duration.instant` | 80ms |
| `motion.duration.hover` | 120ms |
| `motion.duration.fast` | 160ms |
| `motion.duration.panel` | 200ms |
| `motion.duration.drawer` | 220ms |
| `motion.duration.mark-complete` | 1100ms |
| `motion.duration.mark-working-cycle` | 3600ms |
| `motion.easing.standard` | cubic-bezier(.2,0,0,1) |
| `motion.easing.exit` | cubic-bezier(.4,0,1,1) |
| `motion.easing.mark-working` | cubic-bezier(.45,0,.25,1) |
| `motion.easing.mark-settle` | cubic-bezier(.2,.7,.2,1) |
| `motion.mark.travel` | 3 grid units (9.4% of symbol height) |

| Interaction | Duration | Easing | Behaviour |
|---|---|---|---|
| Hover | 120ms | standard | Colour only |
| Composer focus | 120ms | standard | Border to Iris, 4px wash ring |
| Panel open and close | 200ms | standard / exit | Width animates and content fades in after 80ms. The conversation never jumps: its scroll position is preserved |
| Evidence drawer | 220ms | standard | Slides 24px and fades. The claim stays highlighted |
| Popover and citation preview | 160ms | standard | Fades with a 4px offset and opens after a 300ms hover delay |
| Selection | 80ms | standard | Outline appears; no motion |
| Task state change | 160ms | standard | Chip text cross-fades. The mark changes state without extra flourish |

All UI motion drops to an instant change under reduced motion.

### Icon (DESIGN-TOKENS §10, DESIGN-SYSTEM §3)

| Token | Value |
|---|---|
| `icon.grid` | 24px |
| `icon.dense` | 20px |
| `icon.small` | 16px |
| `icon.stroke` | 2px (1.5px at 16px) |
| `icon.cap` | round |
| `icon.join` | round |
| `icon.corner-radius` | 2.5px |

Outline only. Default colour `text.secondary`, active `text.primary`, disabled `text.disabled`; Iris only when the icon itself is a link. Three kinds are never interchanged: **interface icons** (actions and objects: search, attach, pin, expand, close, calendar, file), **semantic glyphs** (✓ ! ▲ ◐ ○ ✕ ‖, always beside a word, in the status colour) and the **Zobba mark** (identifies Zobba as the actor or shows its working state; never a bullet or generic icon). No shields or locks for Permissions, no sparkles or wands for AI, no robot or brain imagery. Lucide at 2px is the provisional interface-icon library (Q5).

### Focus and selection (DESIGN-TOKENS §11–§12)

| Token | Value |
|---|---|
| `focus.ring` | 2px solid color.focus.ring, offset 2px |
| `focus.composer` | 1.5px color.accent.default border + 0 0 0 4px color.accent.wash |
| `selection.block` | 0 0 0 2px color.accent.default + color.surface.selected-accent, radius 2 |
| `selection.row` | inset 2px 0 0 color.accent.default + color.surface.selected-accent |
| `selection.text` | color.selection.text |
| `selection.tag` | color.accent.strong on color.accent.wash, radius 6 |

Focus-ring rules: a visible 2px Iris ring at offset 2px on every interactive element (DESIGN-SYSTEM §14); the composer uses its own 1.5px Iris border with a 4px wash ring. The ring is `#4C3FB8`: 7.75:1 on Paper and 7.42:1 on Canvas, above the 3:1 non-text minimum. A selected nav item uses a Paper fill with a hairline ring, never Iris (DESIGN-SYSTEM §5).

### Calculated contrast (DESIGN-TOKENS §3)

Calculated with the WCAG 2.x relative-luminance formula for the exact pairs used in the reference screens. These are design-level checks; rendering, anti-aliasing and user settings still require verification in the implemented application.

| Pair | Foreground | Background | Used at | Ratio | Result |
|---|---|---|---|---|---|
| text.primary on canvas | `#1C1B19` | `#FBFAF7` | body | 16.49:1 | AAA |
| text.secondary on canvas | `#3D3A35` | `#FBFAF7` | body | 10.85:1 | AAA |
| text.tertiary on canvas | `#5E5A52` | `#FBFAF7` | 12–13px meta | 6.57:1 | AA |
| text.tertiary on sidebar | `#5E5A52` | `#EFEDE8` | 12px section labels | 5.87:1 | AA |
| text.placeholder on panel | `#716D64` | `#FFFFFF` | 15–16px placeholder | 5.16:1 | AA |
| text.placeholder on canvas | `#716D64` | `#FBFAF7` | activity "Next:" | 4.94:1 | AA |
| text.disabled on panel | `#8C8578` | `#FFFFFF` | disabled only | 3.66:1 | AA large only |
| link on panel | `#4C3FB8` | `#FFFFFF` | 13–15px | 7.75:1 | AAA |
| link on canvas | `#4C3FB8` | `#FBFAF7` | 13–15px | 7.42:1 | AAA |
| link on sidebar | `#4C3FB8` | `#EFEDE8` | 13px | 6.62:1 | AA |
| accent.strong on wash | `#3B2F99` | `#EEECFA` | 12px 600 chips | 8.78:1 | AAA |
| accent.strong on selected | `#3B2F99` | `#F6F5FD` | 13px | 9.45:1 | AAA |
| text.primary on selected-accent | `#1C1B19` | `#F6F5FD` | 13px | 15.90:1 | AAA |
| accent.on-dark on graphite | `#B9B0F5` | `#1C1B19` | 14px 600 | 8.68:1 | AAA |
| inverse on graphite | `#F4F1EA` | `#1C1B19` | all | 15.26:1 | AAA |
| inverse-secondary on graphite | `#B8B3A8` | `#1C1B19` | 13–19px | 8.24:1 | AAA |
| primary button label | `#FFFFFF` | `#1C1B19` | 13px 600 | 17.21:1 | AAA |
| pass fg on bg | `#1E6B35` | `#EAF4EC` | 12px 600 | 5.81:1 | AA |
| exception fg on bg | `#B42318` | `#FDECEA` | 12px 600 | 5.75:1 | AA |
| exception fg on panel | `#B42318` | `#FFFFFF` | 13px 600 | 6.57:1 | AA |
| warning fg on bg | `#8A4B06` | `#FDF3E2` | 12px 600 | 6.18:1 | AA |
| warning fg on attention row | `#8A4B06` | `#FFFBF3` | 13px 600 | 6.58:1 | AA |
| inconclusive fg on bg | `#3D3A35` | `#F3F1EC` | 12px 600 | 10.03:1 | AAA |
| diff added text on bg | `#1C1B19` | `#E8E4DA` | 13–15px | 13.56:1 | AAA |
| diff removed on page | `#6F6B63` | `#FFFFFF` | 13–15px | 5.30:1 | AA |
| UI: input border on panel | `#8F8A7F` | `#FFFFFF` | 3:1 non-text | 3.44:1 | ≥3:1 pass |
| UI: input border on canvas | `#8F8A7F` | `#FBFAF7` | 3:1 non-text | 3.29:1 | ≥3:1 pass |
| UI: focus ring on panel | `#4C3FB8` | `#FFFFFF` | 3:1 non-text | 7.75:1 | ≥3:1 pass |
| UI: focus ring on canvas | `#4C3FB8` | `#FBFAF7` | 3:1 non-text | 7.42:1 | ≥3:1 pass |
| UI: control border on panel | `#CCC8BD` | `#FFFFFF` | decorative only | 1.67:1 | below 3:1 |
| UI: inconclusive dashed border | `#8C8578` | `#F3F1EC` | 3:1 non-text | 3.24:1 | ≥3:1 pass |
| UI: symbol iris form on canvas | `#4C3FB8` | `#FBFAF7` | graphic | 7.42:1 | ≥3:1 pass |
| UI: symbol iris-light on graphite | `#B9B0F5` | `#1C1B19` | graphic | 8.68:1 | ≥3:1 pass |

Contrast notes (the pack's): `text.disabled` (3.66:1) is used only for non-essential disabled labels, which WCAG exempts. `border.control` (1.67:1) is decorative and never the only cue that something is a control; any control using it also has a text label. No pair is calculated for text on `surface-attention` other than warning foreground, or for `text.tertiary` on `surface-subtle`; any pair used in implementation that is not in this table is calculated before use (section 7).

## 4. Layout

### Desktop frame (DESIGN-SYSTEM §1)

The reference frame is 1280 × 800 (`breakpoint.desktop-reference`). Layout is fixed chrome plus flexible regions; there is no 12-column grid, because the product is a harness, not a page. Page gutters are 32px (24px in conversation and 18px inside panels).

| Region | Size |
|---|---|
| Sidebar, expanded | `layout.sidebar` 248px, Linen |
| Rail, collapsed | `layout.rail` 52px, Linen; symbol + icons |
| Header | `layout.header` 52px task and panel headers; `layout.header-page` 60px page headers (Engagement, Scheduled, Connections, Permissions) |
| Conversation | Flexible, minimum `layout.conversation-min` 400px; reading content capped at `layout.conversation-max-reading` 720px |
| Workspace panel | Default `layout.panel-default` 540px, minimum usable `layout.panel-min` 420px, maximum `layout.panel-max-ratio` 62% of the window; user-resizable in 20px steps |
| Evidence drawer | `layout.drawer` 470px, overlays the right edge of the workspace |
| Page content (Search, list pages) | Maximum `layout.page-content-max` 800px, centred |
| Reading measure | 60–75 characters (`layout.reading-measure` about 72ch at 15px) |
| Artifact page surround | `surface.artifact-surround`, 18–28px padding, `shadow.page` |

### Layout modes (DESIGN-SYSTEM §1, pack R2.1–R2.3, D-4-1)

No layout requires three permanently visible work regions beside the main navigation (D-4-1). Panel states are open · pinned · focus · full-screen · resizing (COMPONENT-INVENTORY, Workspace panel).

| Mode | Behaviour |
|---|---|
| 1. Conversation only | Sidebar plus conversation. The default for starting and for questions |
| 2. Conversation and workspace panel | The panel opens beside the conversation when there is something useful to inspect. The conversation keeps at least 400px, and the sidebar stays expanded while the window is 1280px or wider. Pin, Expand and Close are always in the panel header with a "From [task]" source line |
| Panel pinned | A state of mode 2 or 3. Incoming work never replaces pinned content, focused or selected content, or material the auditor explicitly opened while it is being inspected; quiet reading is inspection. Thirty seconds of recent interaction is a protective heuristic, not permission to replace content at second 31 (pack R2.2 as amended by Proposal 4b §6a, Q7). New content then arrives as a card in the conversation ("Working data · Open") |
| 3. Workspace focus (panel expanded) | Expand collapses the sidebar to the rail and gives the panel about 62% of the width. The conversation stays visible at 400–430px (Changes, Evidence). Artifact inspection uses this mode: the page is rendered on the surround, and selection and citations are overlays |
| 4. Full-screen workspace (browser view) | A second Expand (or ⌘⇧F) takes the whole window for browser sessions or large tables. The conversation becomes a bar at the bottom with the composer, Stop and the presence chip, so Stop and pending decisions stay reachable. The browser view states "read-only on client systems" in its header (Proposal 4b §5 row 11) |
| Evidence drawer | A drawer over the right of the workspace. The claim stays visible and highlighted to its left. Esc or "Back to claim" closes it |

### Breakpoints (DESIGN-TOKENS §14, DESIGN-SYSTEM §13; Proposal 4b §5 row 12)

The pack's breakpoints 600 / 1024 / 1600 are adopted and replace Proposal 4's "below 900px live controls withdraw" rule.

| Width | Token | Behaviour |
|---|---|---|
| ≥ 1600 | `breakpoint.large` (1600+) | Panel default 600px; conversation reading content capped at 720px and centred in its region |
| 1024–1599 | `breakpoint.desktop` (reference 1280 × 800) | As specified above |
| 600–1023 | `breakpoint.tablet` | Sidebar collapses to the rail. The workspace opens as an overlay sheet over 80% of the width, with the conversation dimmed but visible at the left edge. Evidence opens as a sheet inside it. The live browser view uses a full-screen surface below 1024 |
| < 600 | `breakpoint.mobile` (0–599) | Conversation is the default view. The workspace opens full-screen with a back control. Evidence opens full-screen and returns to the claim. The sidebar is a sheet from a menu button; the task header shows a 44px back control |

On every size, **Stop, open decisions (clarification, permission) and current material limitations** stay reachable without scrolling: Stop sits beside the composer, the decision card is pinned above the composer, and limitations are inline in the conversation. Touch targets are at least 44px. A live browser view may use a dedicated full-screen surface or state its viewing limitation; it never hides the task's safety controls (Proposal 4 U10).

### Navigation (DESIGN-SYSTEM §5, D-4b-2)

Order: New task · Search · Scheduled checks · Engagements · Recent tasks · Connections · Settings · user block. Reviews is added at the first level for people with assigned review responsibilities and the required capabilities (FR-94). Settings › Administration is added for Admin. Expanded sidebar: the lockup at 20px, section labels 12/16 weight 600 `text.tertiary`. Active item: Paper fill, hairline ring, weight 600 for the task row; Iris is not used for navigation. Needs-attention badge: a Graphite count with an accessible label ("2 need attention"); Connections shows "▲ 1" in the warning colour. Task rows show the working mark while running and the waiting mark while waiting; nothing when idle. The complete attention view is reachable from the notification panel (bell) as one linked view (D-4b-2); badges are entry points, never the only way to discover an outstanding decision.

### Tables and data (DESIGN-SYSTEM §7)

| Element | Rule |
|---|---|
| Header | 12/16 weight 600 (`type.table-head`), `text.secondary` on Canvas, sticky within the panel |
| Rows | 13/18 (`type.table-cell`), 9–10px vertical padding, `border.divider-inner` between rows |
| Alignment | Numbers and dates right-aligned with tabular figures; identifiers in Plex Mono 12 (`type.id`) |
| Selected row | `selection.row`: Iris inset bar (2px) with `surface.selected-accent`. The row being processed shows the working mark and "Matching" in Iris strong |
| Exception cell | "! Still active" in `status.exception.fg`, weight 600. A cell, never a full-row fill |
| Limitation | ◐ in the row's status column with the L-reference ("◐ L1") |
| Matched and unmatched | Unmatched records listed under a group header "Unmatched · n" with a reason column ("No account found", "Name mismatch"); neither red nor hidden |
| Grouping | Group header row (13px, weight 600) with a count and a collapse chevron |
| Large populations | Virtualised rows; the footer states "Showing 6 of 23 leavers · 1,516 accounts compared". Above 10,000 rows, filters first; never a fabricated total |
| Filters and sorting | Filter chips above the table (All · Still active · Unmatched); header click to sort with an arrow and `aria-sort` |
| Column resize | Drag handle in the header gap; minimum 64px; double-click to fit |

Tables look like professional audit data (a spreadsheet or report), never terminal output.

### Forms and settings (DESIGN-SYSTEM §8)

Forms appear in Settings only (Profile, Connections, Methodology and skills, Permission defaults, Organisation details, Administration; the reconciled sections of `./EXPERIENCE.md` §2, with no Notifications section in this release) and never take over ordinary audit work; anything an auditor decides during a task is asked in the conversation.

| Control | Spec |
|---|---|
| Label | 13/18, weight 600, above the field |
| Input and select | 36px high, `radius.md` 8, 1px `border.input`, 12px padding. Focus: 2px Iris ring |
| Textarea | Minimum 3 lines, resizes vertically |
| Multiselect | Chips inside the field, each with a remove ✕ |
| Checkbox and radio | 16px, 1.5px `border.input`. Checked: Graphite fill with a white glyph |
| Toggle | 36 × 20, Graphite when on. Label to the right, stating the "on" meaning |
| Date and time | Shows the time zone ("10:00 CAT (UTC+2)"). Scheduled checks show UTC plus the local time |
| File selection | Drop zone plus a button, listing file name, size and destination |
| Help | 12/16 `text.tertiary` below the field |
| Error | ! and message in `status.exception.fg` below the field, 1.5px red border, message linked with `aria-describedby` |
| Success | ✓ inline "Saved" beside the Save button for 3s. No toast |

Primary actions are Graphite ("Save changes"). Destructive actions use an exception-red outline and are confirmed in a dialog (elevation level 4) that names the object.

### Search states (DESIGN-SYSTEM §9)

Scope-aware ("All authorised work", one client or one engagement). Results grouped by **client · engagement**; each result shows its type (Working paper, Task, Source, Scheduled check, Procedure), title, an excerpt with the match in weight 600, location and date. Client contexts are never merged. States: Empty (recent searches) · Loading ("Searching Northstar Bank…" per scope) · Results · No results ("No results in authorised work for 'x'", scope named) · **Incomplete or stale index** ("▲ Kafue SharePoint results may be incomplete…" plus Reconnect; a partial result never looks complete) · Direct-source continuation.

### Empty, loading, error and degraded states (DESIGN-SYSTEM §12)

| Situation | Message pattern | Must not |
|---|---|---|
| No engagements | "No engagements yet. Start a conversation to begin." (`./EXPERIENCE.md` §6, confirmed by the owner on 2026-09-25; the pack's variant is not adopted) | Look like an error |
| No recent tasks or schedules | "Tasks you start appear here." / "Turn a finished task into a scheduled check from its menu." | |
| No search results | "No results for 'x' in [scope]." + a broaden-scope link | Hide a stale index |
| Connection unavailable | "I can't reach AccessGate right now, so I haven't read the sign-in history." + Retry | Look like "no sign-ins" |
| Source incomplete | Limitation line (◐ L1) + what's missing | Look complete |
| Unsupported content | "I couldn't read the scanned pages 5–7 of this PDF." + options | Skip silently |
| Unable to complete review | "I couldn't finish validating the conclusions. Here's what I checked and what's left." | Claim success |
| Execution environment unavailable | "Zobba can't run tasks at the moment. Nothing has been sent or changed." + Technical details | Blame the user |
| Task interrupted | "This task stopped at 'Comparing…'. Work so far is saved." + Resume | Restart silently |
| External action uncertain | Superseded by Proposal 4b §5 row 14: two patterns chosen from the actual receipt. **Unknown after dispatch:** "The send request was attempted, but its outcome has not been confirmed. Check the operation's status before retrying." **Provider accepted:** "The provider accepted the message for sending. Delivery has not been confirmed." No generic Retry while duplication remains possible | Say it failed |

Loading uses skeleton rows in tables and activity text in conversation. There are no spinners with the Zobba mark. Which sentence applies is decided by the recorded state (Proposal 4 U6, as restated in `./EXPERIENCE.md`). The message patterns are illustrative copy except where `./EXPERIENCE.md` names them as fixed.

## 5. Status system

This is the state-family table. It replaces Proposal 4 U5's added families (Agent Task, Artifact review, Connection) with the pack's six status dimensions as amended by Proposal 4b §3 and §5 rows 1, 3, 6 and 15, keeps U5's inspection-only vocabularies, and retains the compiler-1 Run-path families unchanged.

### Rules

- **Never colour alone.** Every chip has a glyph and a word; the word is the label and the glyph is `aria-hidden`. Colour and glyphs support the word and never replace it.
- **Dimensions never merge.** Execution, wait, input and coverage, audit assessment, review and issue, and connection are six separate facts. They are never combined into one chip, and brand presence (Iris, the mark) never implies an audit result.
- **"Completed" is execution, not assessment.** A completed task or run can be Inconclusive. A Completed chip is neutral and never green.
- **"Didn't run" is about the schedule, not the control, and has no assessment.** It is shown with its reason and a recovery action, and no assessment chip appears beside it.
- **"Stopped by you" appears only after cessation is recorded.** Between the press and the recorded cessation the execution state is "Stop requested"; an action already performed is never described as undone (FR-88, Proposal 4 U10, Proposal 4b §5 row 1).
- **The summary chip never removes a dimension.** An input-and-coverage summary never implies that an unestablished population is complete; expanding it shows each `input-quality-v1` dimension separately (Proposal 4b §5 row 15).
- **Internal vocabulary stays in inspection.** Canonical state names (`write-output`, `unknown-after-dispatch`, `empty-under-contract`, `refresh-unresolved`, …) appear only in inspection and Technical details; the default reading view shows the readable word (Proposal 4 U4, D-4-3).
- **Glyphs.** The Glyph column gives the pack's semantic glyph (DESIGN-SYSTEM §3, §6; COMPONENT-INVENTORY, Semantic glyph) or the Zobba mark state (section 2). The pack names no Lucide icon for any status; semantic glyphs are a different kind from interface icons and are not replaced by them. `[TO DESIGN]` marks a state for which the pack gives no glyph; a glyph is designed under the pack's rules before the story that first renders the state.

### Treatments

Every status chip is `type.chip` (12/16, weight 600), `radius.pill`, glyph plus word (COMPONENT-INVENTORY, Status chip).

| Treatment | Tokens | Source |
|---|---|---|
| presence | `color.text.on-accent-wash` on `color.accent.wash` | Presence chip "Zobba is …" (Iris strong on Iris wash) |
| waiting | `color.text.primary` on `color.surface.sidebar` | Presence chip, waiting version (Graphite on Linen) |
| neutral-text | `color.text.secondary`, no fill | DESIGN-SYSTEM §6 "neutral text" |
| exception-text | `color.status.exception.fg`, no fill; with a reason | DESIGN-SYSTEM §6, for an execution state only |
| pass | `color.status.pass.fg` on `color.status.pass.bg` | BRAND §3 |
| exception | `color.status.exception.fg` on `color.status.exception.bg` | BRAND §3 |
| warning | `color.status.warning.fg` on `color.status.warning.bg` | BRAND §3 |
| inconclusive | `color.status.inconclusive.fg` on `color.status.inconclusive.bg`, 1px dashed `color.status.inconclusive.border` | BRAND §3 |
| outline | `color.status.pending.fg`, 1px solid `color.status.pending.border`, no fill | BRAND §3, "Pending review" |
| guidance-line | `color.text.placeholder` line under the auditor's message, not a chip | COMPONENT-INVENTORY, Guidance acknowledgement; HANDOFF §5 (R1.4) |
| no-chip | No chip is rendered | DESIGN-SYSTEM §6, "Not assessed" |
| `[TO DESIGN]` | The pack gives no treatment | Designed under the pack's rules before its story |

### The six status dimensions

Canonical states are those of the approved contracts: the Agent Task state machine (`QUEUED → RUNNING ⇄ WAITING`, `RUNNING ⇄ PAUSED`, `RUNNING → COMPLETED | FAILED`, any active `→ CANCELED`; 3d, `engagement-task-v1`), the Run lifecycle (`RUN_STATES`) and Result outcome (`SYSTEM_OUTCOMES`, `run-result-v1`) for the Run path, `task_wait` kinds (3a C2), `input-quality-v1`, `artifact-version-v1` lifecycle records, and `connection-v1`. Where Proposal 4b gives a per-state mapping it is cited; other per-state mappings are this document's reading of the named contract, and `[MAPPING IN STORY]` marks a mapping the contract story must confirm.

#### Execution (a task or run)

| Word | Canonical state presented | Treatment | Glyph |
|---|---|---|---|
| Not started | Agent Task `QUEUED`; Run `QUEUED` | neutral-text | `[TO DESIGN]` |
| Running | Agent Task `RUNNING`; Run `RUNNING`. Chip reads "Zobba is …" | presence | mark-working |
| Paused | Agent Task `PAUSED`; Run `PAUSED` | neutral-text | ‖ |
| Stop requested | A recorded stop (cancellation) request on an active task or run whose cessation is not yet recorded (3a C2 "stop requested until the worker records cessation"; Proposal 4b §5 row 1). Copy: "Stopping after the current step…" only while a step is executing; on a waiting task with no operation in flight, cessation can be recorded promptly and that sentence is not used (`./EXPERIENCE.md` §3, owner decision 2026-09-25) | presence | mark-working |
| Stopped by you | Agent Task `CANCELED` by explicit cancel, after cessation is recorded; Run `CANCELED` | neutral-text | `[TO DESIGN]` |
| Completed | Agent Task `COMPLETED`; Run `COMPLETED`. Never an assessment | neutral-text | `[TO DESIGN]` |
| Didn't run | A scheduled occurrence for which no execution ran, with its recorded reason and a recovery action. No assessment | exception-text | ✕ |
| Interrupted | Agent Task `FAILED`; Run `RUN_FAILED`; Agent Task `CANCELED` by `wait-expired` or revoked delegation `[MAPPING IN STORY]`. Always with a reason | exception-text | ✕ |

The Run-path `INCONCLUSIVE` state and `AWAITING_AUDITOR` are not execution words: `INCONCLUSIVE` presents as execution ended plus assessment Inconclusive, and `AWAITING_AUDITOR` presents as Wait "Needs your input" `[MAPPING IN STORY]`. Until the legacy procedures view's disposition, Run-path surfaces keep the retained Run lifecycle family below.

#### Wait

| Word | Canonical state presented | Treatment | Glyph |
|---|---|---|---|
| Needs your input | Agent Task `WAITING` on a `clarify` wait or a closed-option wait; a `reconcile` wait shows "Needs your input · reconciliation" (Proposal 4b §3) | waiting | mark-waiting |
| Needs your permission | Agent Task `WAITING` on a `confirm-action` wait | waiting | mark-waiting |
| Queued (guidance) | A guidance message queued for the next step boundary (3c C9), not yet applied. Copy: "Guidance queued for the next step"; when applied the activity line reads "✓ Applied your guidance · …" | guidance-line | ○ |

#### Input and coverage

| Word | Canonical state presented | Treatment | Glyph |
|---|---|---|---|
| Complete | `input-quality-v1`: every dimension (availability, coverage, freshness, period relevance) established | neutral-text | `[TO DESIGN]` |
| Partial | `input-quality-v1` coverage partial, with a limitation record shown by its L-reference ("◐ L1") | inconclusive | ◐ |
| Unavailable | `input-quality-v1` availability not met | warning | ▲ |
| Stale | `input-quality-v1` freshness not met | warning | ▲ |
| Unknown | `input-quality-v1` `unknown` / not established (Proposal 4b §5 row 15). Never shown as complete | `[TO DESIGN]` | `[TO DESIGN]` |
| Out of period | `input-quality-v1` period relevance `outside` (Proposal 4b §5 row 15) | `[TO DESIGN]` | `[TO DESIGN]` |
| Not applicable | `input-quality-v1` period relevance `not applicable` (Proposal 4b §5 row 15) | `[TO DESIGN]` | `[TO DESIGN]` |

#### Audit assessment

| Word | Canonical state presented | Treatment | Glyph |
|---|---|---|---|
| No exception | Result outcome `PASS`; artifact assessment with no exception | pass | ✓ |
| Exception(s) | Result outcome `CONTROL_FAILURE`; artifact assessment with one or more supported exceptions | exception | ! |
| Inconclusive | Result outcome `INCONCLUSIVE`; artifact assessment that cannot conclude | inconclusive | ◐ |
| Not assessed | No assessment recorded: Result outcome `CANCELED` or `RUN_FAILED`, a Didn't run occurrence, or work that makes no assessment | no-chip | none |

Result outcome `PENDING_CONFIRMATION` has no counterpart among the pack's four words; it stays in the retained Result outcome family until the legacy disposition, and its presentation in the new chrome is `[MAPPING IN STORY]` (claim support "Awaiting review" is the nearest inspection word).

#### Review and issue

Reviewed by, Approved and Issued always name the person and date. "Needs another look" (`needs-reconsideration`) is a flag beside the chip, not a state (Proposal 4b §4).

| Word | Canonical state presented | Treatment | Glyph |
|---|---|---|---|
| Draft | `artifact-version-v1` `draft` | outline | `[TO DESIGN]` |
| Not reviewed | A submitted artifact version or an unattended result with no review record | outline | ○ |
| In review | `artifact-version-v1` `review-requested` (Proposal 4b §5 row 6) | outline | `[TO DESIGN]` |
| Returned | `artifact-version-v1` `returned`, shown "Returned · n notes" (Proposal 4b §5 row 6) | outline | `[TO DESIGN]` |
| Reviewed by [name] | `artifact-version-v1` `reviewed` record, with person and date | outline | `[TO DESIGN]` |
| Approved | `artifact-version-v1` `approved` record, with person and date | outline | `[TO DESIGN]` |
| Issued | `artifact-version-v1` `issued` record, with person and date | outline | `[TO DESIGN]` |
| Superseded | A later version of the same artifact exists | outline | `[TO DESIGN]` |
| Awaiting approval | On a scheduled check: the promoted Procedure Version is submitted and awaits its independent approval (Proposal 4b §5 row 2). No next run | outline | `[TO DESIGN]` |
| Pending regression | On a scheduled check: an `APPROVED` version whose configuration requires regression (3d §8; Proposal 4b §5 row 3). No next run | outline | `[TO DESIGN]` |

#### Connection

| Word | Canonical state presented | Treatment | Glyph |
|---|---|---|---|
| Connected | `connection-v1` `active` | neutral-text | ● |
| Connecting | `connection-v1` `pending` (Proposal 4b §3; 3d names it `pending-attempt`). Copy "Connecting…", spinner-free | neutral-text | `[TO DESIGN]` |
| Limited | `connection-v1` `active` with fewer permitted resources than requested ("Limited to 2 areas") `[MAPPING IN STORY]` | neutral-text | `[TO DESIGN]` |
| Needs reconnecting | `connection-v1` `refresh-unresolved` (Proposal 4b §3); provider-side `revoked` `[MAPPING IN STORY]`. Always with reason and consequence | warning | ▲ |
| Disabled | `connection-v1` `disabled` | neutral-text | – |
| Error | A connection failure with a message plus Technical details, not a single `connection-v1` state `[MAPPING IN STORY]` | warning | ▲ |
| Not connected | No connection exists for this user and connector | neutral-text | ○ |

Connections are user-owned in the first release (D-4b-3). The label for organisation connections is reserved in the vocabulary and no empty "Organisation connections" section is shown. Fixed copy: "A connection lets Zobba reach a system. It doesn't grant every resource in it: engagement permissions and the system's own access still apply." Tokens and OAuth scopes are never shown.

### Inspection-only vocabularies

Shown in inspection and review mode only, never as default chips (Proposal 4 U5, D-4-3; Proposal 4b §3). Each carries a glyph and a word when rendered as a chip; treatments are `[TO DESIGN]` unless a row says otherwise, and every treatment uses only the section 3 semantic tokens.

| Vocabulary | Words | Canonical states |
|---|---|---|
| Claim support (review mode only) | Supported · Not yet supported · Contradicted · Awaiting review · Cannot be checked automatically | `artifact-version-v1` claim support status |
| Action outcome (per operation) | Not sent · Sent · Sent, not confirmed · Confirmed · Blocked · Failed before sending | Operation attempt (3d, `engagement-task-v1`): `not-dispatched` → Not sent · `accepted` (provider accepted, delivery not confirmed) → Sent · `possibly-dispatched` / `unresolved` (unknown after dispatch) → Sent, not confirmed · `confirmed` → Confirmed · gate refusal with nothing dispatched → Blocked · failed with no dispatch → Failed before sending. `resolved-by-human` is shown as a human resolution with its reference, never as a provider confirmation. This is the Proposal 4b §3 set (which replaces Proposal 4 U5) plus Not sent for the not-dispatched state; the two unknown-outcome sentences of Proposal 4b §5 row 14 are message patterns, not chips, and "Not confirmed by the provider" is the sentence for the `accepted` case. Matches `./EXPERIENCE.md` §5 |
| Data quality (per acquisition) | Complete · Partial · Empty, as the source states · Unknown | `acquisition-v1` and `input-quality-v1`; "Empty, as the source states" presents `empty-under-contract`; `unknown` shown as unknown |
| Memory item | Proposed · Remembered · Replaced · Declined · Retired; secondary: reported by you · supported by a source · disputed · awaiting verification | `memory-v1`: `proposed` · `active` · `superseded` · `rejected` · `retired`; verification status `user-reported` · `source-supported` · `disputed` · `awaiting-verification` (a separate dimension). Proposal 4 U5's list is the input to the memory screens' design and is fixed then (`./EXPERIENCE.md` §5) `[TO DESIGN]` |
| Wait | Waiting for you · Answered · Expired · Withdrawn | A wait open · closed by an answer · closed at its deadline · withdrawn because its task or run ended |
| Scheduled check | Active · Paused · Next run · Running · Waiting for input · Completed · Inconclusive · Didn't run · Review pending · Awaiting approval · Pending regression | DESIGN-SYSTEM §10 treatments (below) plus Proposal 4b §5 rows 2–3. Awaiting approval and Pending regression are review-and-issue states on the check (table above). No next run while either holds |
| Invitation | Invited · Accepted · Expired · Revoked | `tenancy-v1` invitation lifecycle (FR-95) |

Scheduled check treatments (DESIGN-SYSTEM §10): Active "Active · Mondays 06:00" · Paused "‖ Paused by you, 2 Oct", no next run · Next run date and time with the time zone · Running: working mark + "Zobba is running this check" · Waiting for input: waiting mark + "Waiting for your input" + the reason · Completed "Completed 06:14", then the assessment chip, then the review chip, as separate chips · Inconclusive ◐ dashed chip (assessment) · Didn't run: ✕ "Didn't run" + the reason + the recovery action, no assessment · Review pending: ○ Not reviewed, then "Reviewed by [name] · date". The Zobba mark (one colour, 14px) identifies the actor ("Zobba ran this unattended"); the semantic chip identifies the outcome; they are never merged. Awaiting approval and Pending regression treatments are `[TO DESIGN]` (Proposal 4b §10 register).

### Retained compiler-1 Run-path families (unchanged; `status.test.ts` reads these from the old DESIGN.md until its disposition story)

Copied verbatim from `../ux-IntelliFin Audit-2026-09-01/DESIGN.md` (# Colors, Status). These words, treatments and icons belong to the Ledger Signal token set of that document and apply only to the compiler-1 Run-path surfaces. They are not restyled here. The authoritative copy that `apps/web/src/design/status.test.ts` parses today remains the old file; this copy is for readers and moves only with the disposition story.

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

(`{colors.…}` here resolves against the old document's frontmatter, not this one.) The old document's load-bearing distinctions stay in force on those surfaces: Control Failure (filled danger, `alert-circle`), Run Failed (outlined danger, `cloud-off`, with the execution-failure panel) and Inconclusive (warning, `alert-triangle`, with the failed Gate checks and the Safe next action panel) are three different treatments; "needs a human" is one `info-solid` treatment with the `user` icon; **Completed is neutral**; Rejected is never a review state.

## 6. Components

### Pack components (COMPONENT-INVENTORY, summarised)

Behaviour and copy per component are in `./EXPERIENCE.md` revision 2 and the pack's COMPONENT-INVENTORY and EXPERIENCE-RULES; this table is the visual summary. RS numbers are the pack's reference screens.

| Component | Purpose | Key rules | Token references |
|---|---|---|---|
| Zobba mark | Identifies Zobba and its working state | Variants colour · mono · reverse · reverse-mono · `-small` (13–19px) · `-micro` (≤ 12px); states idle · working · waiting · complete; one animated mark per region, always beside activity text; `aria-hidden`; never a bullet, per-message avatar, loader or result indicator | `color.accent.default`, `color.text.primary`, `motion.*mark*` |
| Wordmark and lockups | Product identity | Supplied SVGs only, never live text; sidebar uses the horizontal lockup at 20px; `alt="Zobba"` | section 2 assets |
| Semantic glyph | Supports a status word | ✓ pass · ! exception · ▲ warning · ◐ inconclusive or limitation · ○ pending · ✕ didn't run · ‖ paused; `aria-hidden`; never without its word | `color.status.*` |
| Sidebar | Primary navigation | Expanded (248) · rail (52) · narrow sheet; item hover `surface.hover`, active Paper + hairline ring; needs-attention badge; working or waiting mark on task rows; `nav` landmark, `aria-current="page"`; no GRC hierarchy, no Library | `layout.sidebar`, `layout.rail`, `color.surface.sidebar`, `color.surface.hover`, `color.surface.selected`, `color.border.hairline` |
| Page header | Page title and context | 60px; title, context line, at most two actions; no KPI tiles | `layout.header-page`, `type.page-title` |
| Composer | The single input for intent, guidance, questions and answers | Text area · + menu · context chips (engagement, permissions, sources) · model and effort chip · Stop (while working) · Send; states Empty, Focused, Engagement selected, Source added, Zobba working, Waiting for clarification, Disabled (only with the reason shown); Enter sends, Shift+Enter new line; never replaced by a form for starting work | `radius.composer`, `color.border.input`, `focus.composer`, `shadow.composer`, `layout.composer-home` |
| Model and effort chip | Choose model and supported reasoning effort within policy (FR-91–FR-93) | "[Model] · [Effort] ▾" after the context chips and before Stop and Send; menu lists name, provider and a short note, no provider logos; unavailable models shown disabled with the reason, never hidden; effort as a segmented control showing only the choices the selected model supports; footer "Set by your administrator · recorded in How it ran"; button labelled "Model and reasoning effort, [model], [effort]", `role="menu"` with radio items, effort a radio group, disabled reasons in `aria-description`; a change applies from the next safe boundary | `color.border.control`, `type.label`, `radius.pill`, `shadow.popover` |
| Guidance acknowledgement | Distinguishes queued guidance from Stop | "○ Guidance queued for the next step" under the message; later "✓ Applied your guidance · …" | `color.text.placeholder` |
| Stop | Stop the current step | Outlined, ■ glyph; shows "Stop requested" until cessation is recorded, then confirms what was kept; keyboard Esc twice in the composer; announces "Stopped"; always reachable at every width | `color.action.secondary.border` |
| Auditor message | The auditor's turn | Linen bubble, radius 16, right-aligned, max 380px (70% narrow); optional "Selected · [location]" tag | `color.surface.user-message`, `radius.xl`, `type.body` (15/23 in bubbles), `selection.tag` |
| Zobba response | Zobba's first-person reply | Unboxed, at most 720px; streams in sentence-sized chunks; mark on the activity line, not the text; live region at step granularity | `type.body`, `layout.conversation-max-reading` |
| Question and clarification | One focused question with suggested replies | Bold question line, reply chips and "Or reply in your own words"; chrome chip "Zobba needs your input" with the waiting mark; two tightly related details may be asked together (Proposal 4b §5 row 16); never a form card | `color.border.input`, `radius.pill` |
| Suggested replies | Submit a reply as the auditor's answer | Reply chips that submit the text as the answer | `radius.pill`, `color.border.input` |
| Limitation | State a coverage limitation inline | "◐ … · recorded as limitation L1"; on narrow screens a dashed neutral callout that stays visible | `color.status.inconclusive.*` |
| Candidate finding | A finding with its support | Prose with citations; becomes an exception in data or an artifact only in the artifact; prose is never coloured | `type.body` |
| Explanation and correction | Plain-prose explanation | A correction ends "Draft n saved · View changes · Undo" | `type.body` |
| Citation | Link a claim to evidence | 12/16 weight 600 chip ("E6", "E6.2"); preview after 300ms hover; active: `selection.text` + 1.5px Iris ring; a button with the full name ("Evidence E6.2, AccessGate sign-ins, Kelvin Chanda") | `color.accent.strong` on `color.accent.wash`, `radius.xs`, `type.chip` |
| System event | Record an event in the conversation | Centred 12/16 line ("Draft 2 saved · 2 Oct 14:52"); never Zobba's own reasoning | `type.meta`, `color.text.tertiary` |
| Activity list | Meaningful activity, not every tool call | 16px glyph column; completed ✓ in `text.tertiary`; one current step with the working mark, a 600-weight line and a detail line with Inspect and Technical details; ◐ for a limitation; "Next: …" in placeholder colour; no percentages; "Step x of y" only for fixed procedures; `aria-current="step"` | `color.text.tertiary`, `color.text.placeholder` |
| Presence chip | "Zobba is …" / "Zobba needs …" | Working: mark + Iris strong on Iris wash; waiting: waiting mark + Graphite on Linen; never shows a result | `color.text.on-accent-wash`, `color.accent.wash`, `color.surface.sidebar` |
| Workspace panel | Inspect working data, browser, document, artifact, evidence, changes, draft correspondence, scheduled-result detail | Header with title, "From [task] · state", Pin · Expand · Close; optional toolbar; states open · pinned · focus · full-screen · resizing; replacement rule (section 4); `complementary` region labelled by its title; F6 reaches it; Close returns focus to the conversation | `layout.panel-*`, `color.surface.panel`, `color.border.hairline`, `type.panel-title` |
| Browser view | Read-only view of a client system | URL bar in Plex Mono, back and forward, "Take over" (the existing control lease; Zobba pauses until handed back), footer noting what is captured; header states "read-only on client systems" | `type.id` |
| Working-data view | Tables of working data | Filter chips, table, footer count | section 4 Tables |
| Artifact page | The firm's working paper or report | White page on the surround with the firm template inside; panel header gives type, draft number and review state; Zobba overlays only (selection, citations, diff); Zobba type and colour never applied to the page body | `color.surface.artifact-surround`, `color.surface.artifact-page`, `shadow.page` |
| Provenance footer | "Prepared with Zobba" | 10px mono micro mark plus "Prepared with Zobba · draft n · ref ZB-xxxx"; on by default, firm-controlled (Q3) | `symbol/zobba-symbol-micro-mono.svg` |
| Artifact state chip | Review-and-issue state of a version | Outline chips: Draft · Not reviewed · In review · Returned · Reviewed by [name] · Approved · Issued · Superseded (section 5) | outline treatment |
| Diff | Show a change typographically | Added: 1.5px Graphite underline on `diff.added.bg`; removed: struck through in `diff.removed.fg`; no red or green | `color.diff.*`, `border.diff-underline` |
| Citation preview | Preview evidence | Evidence id and title, location, source and date, "Open evidence"; elevation 2 | `shadow.popover` |
| Evidence drawer | Inspect evidence and return to the claim | Header (id · "cited in …", title, Back to claim) · identity grid (Source, Location, Captured, Supports) · excerpt with the region highlighted by an Iris inset bar · Open full source · Technical details · other evidence; no scrim; focus to heading; Esc returns to the claim | `layout.drawer`, `shadow.drawer`, `selection.row` |
| Confirmation card (decision surface) | One coherent decision surface per decision | Title, material-details grid, actions **Allow and send** (Graphite primary) · **Edit first** (secondary) · **Don't send** (text), permissions footer; states pending · invalidated ("Details changed since you last saw this") · sending · per-operation outcomes; `role="alert"` on arrival; no auto-focus on Allow; no modal and no second confirmation. Other decisions use their action-specific label ("Create invitation", "Save to Drafts", "Approve version", "Issue report"; Proposal 4 U4) | `color.action.primary.*`, `color.action.secondary.border`, `radius.lg` |
| Permissions summary | What Zobba may do here | Two sentences plus "View permissions" | `type.body` |
| Permissions detail | The seven sections | Can read · Can write · Asks first · Never · Scheduled checks · Connections · Administrator limits; "Set by … on …"; Change permissions; Activity record; no lock or shield icons, tokens or scopes | `type.ui` |
| Activity record entry | Record of an action | Action, per-operation outcome (section 5 inspection vocabulary), time, decision basis | `type.table-cell` |
| Status chip | One status dimension | 12/16 weight 600, pill, glyph plus word; never two dimensions in one chip | section 5 treatments |
| Needs-attention badge | Count needing attention | Graphite count, or "▲ n" warning for connections; accessible label | `color.text.primary`, `color.status.warning.fg` |
| Table | Audit data | Section 4 Tables; `table` semantics, `aria-sort`, announced row count | `type.table-head`, `type.table-cell`, `color.border.divider-inner` |
| Reviews queue | Audit manager's review work | Grouped: Waiting for your review · Returned with your notes · Reviewed recently; columns item, preparer, state chips, submitted date; review status never merged with assessment | section 5 |
| Review note | Anchored review note (FR-96) | Anchored to a paper location ("On L2"), author and state; 230px column beside the page; not exported; focusing the note highlights its anchor | `radius.lg`, `color.border.hairline` |
| Review action bar | Review decisions | **Return with n notes** (primary) · **Mark as reviewed** (secondary), helper "Marking as reviewed records you and the time. Approval and issue are separate steps." | `color.action.primary.*` |
| Form controls | Settings forms | Section 4 Forms; never inside a task conversation | `color.border.input`, `radius.md`, `focus.ring` |
| Settings navigation | Settings sections: Profile · Connections · Methodology and skills · Permission defaults · Organisation details · Administration (Admin only) | Secondary 220px column with the main app on the rail | `color.surface.sidebar` |
| Inline notice | A notice in context | Glyph plus sentence plus action ("▲ Kafue SharePoint results may be incomplete… Reconnect"); no toast stacks | `color.status.warning.*` |
| Empty state | Nothing here yet | One sentence plus one action; no illustration | `type.body` |
| Error with Technical details | A failure the auditor can act on | Plain message, what was not affected, the recovery action, then Technical details (collapsed) | `color.status.exception.fg` |

### Audit-native components kept from the 2026-09-01 contract (Proposal 4 U4)

| Component | Disposition |
|---|---|
| Status badge | Restyled for the Zobba chrome as the **Status chip** with the section 5 six dimensions and treatments. The Run-path Status badge (Ledger Signal families, `info-solid` "needs a human") stays on the old contract for the Run-path surfaces |
| Conclusion triptych | Remains on the old contract for Run Detail. In the Zobba chrome, execution, assessment and review appear as separate chips per section 5; the triptych's rule (three facts never read as one) is kept |
| Gate checklist | Remains on the old contract for the Run path, including "Why inconclusive" from a scheduled result (Proposal 4 U4) until that surface's disposition story restyles it |
| Grounding inspector | Remains on the old contract for Run-path Evidence and Exception Detail. In the chrome, claim-to-evidence inspection is the Citation, Citation preview and Evidence drawer |
| Provenance chain | Remains on the old contract for Exception Detail |
| Evaluation card | Remains on the old contract for Run-path Result and Exception Detail |
| Confirmation dialog weights | The Zobba chrome uses one decision surface per decision (D-4-2): the Confirmation card for external actions, and a level-4 dialog only for destructive confirmation in Settings and sign-in. Confirmation weight follows the action's consequences. Run-path dialogs keep the old contract's three weights |
| Untrusted-content rendering | Rule unchanged and applied everywhere: retrieved content that resembles an instruction is shown as inert plain text, labelled with where it came from, never rendered as markup. The Zobba-token visual treatment is `[TO DESIGN]`; Run-path surfaces keep the old untrusted block |
| Empty state | Restyled: the pack's Empty state (one sentence plus one action, no illustration) and the section 4 degraded-state patterns |
| Identifier | Restyled: `type.id` (IBM Plex Mono 12/18); E-references for evidence and L-references for limitation records (Proposal 4b §1) |
| Timestamp | Restyled under the chrome's typography; formats per `./EXPERIENCE.md`; a time zone is always shown ("10:00 CAT (UTC+2)"; scheduled checks show UTC plus local time) |
| Reference | Restyled: the E- and L-reference display forms and citation chips |
| Technical details | Restyled: a collapsed disclosure, as in Error with Technical details and the evidence drawer |
| Banner | Restyled for the chrome as the Inline notice (no toast stacks); Run-path surfaces keep the old Banner |
| DataTable | Restyled for the chrome as the pack Table (section 4); Run-path tables keep the old `data-table` pattern |

## 7. Accessibility

**Target: WCAG 2.2 AA** (D-4b-6, replacing WCAG 2.1 AA), with automated and manual acceptance checks, carried into every new flow (model picker, invitation and sign-in, review notes, panel interactions). No allowlist of accepted violations.

- **2.2 criteria named explicitly:** dragging movements have a single-pointer alternative (panel resize in 20px steps and column resize need keyboard or button alternatives); redundant entry (information already given in a flow is not requested again); accessible authentication (sign-in and invitation acceptance need no cognitive function test); target size at least 24 × 24px on desktop (2.5.8) and 44px on touch; focus visible (2px Iris ring, offset 2px) and not obscured by sticky headers, the pinned decision card or the full-screen conversation bar.
- **Contrast:** text 4.5:1, or 3:1 for text of 18.66px bold / 24px and above; non-text 3:1 for input boundaries, focus indicators and meaningful graphics. The pack's calculated figures are in section 3; the lowest used text pair is `text.placeholder` on Canvas at 4.94:1, the input boundary is 3.44:1 on Paper and 3.29:1 on Canvas, and the focus ring 7.75:1 / 7.42:1. `text.disabled` (3.66:1) is for non-essential disabled labels only; `border.control` (1.67:1) is decorative and never the only cue.
- **Never colour alone:** every status has a word and a glyph (section 5).
- **Keyboard:** logical order sidebar → conversation → composer → workspace → drawer; F6 cycles regions; Esc closes the drawer or popover and returns focus to the originating claim. Claim → evidence → return: a citation is a button with its full name; opening it moves focus to the drawer heading, and Back to claim or Esc returns focus to the citation.
- **Announcements:** conversation updates `aria-live="polite"` at step granularity, not per token; permission and clarification requests `role="alert"` once. The working mark is `aria-hidden`; the adjacent text carries the meaning.
- **Tables:** real table semantics, `aria-sort`, header scope; the row being processed is announced as "Matching".
- **Reduced motion** honoured (section 2 and section 3, Motion).

**Implementation obligations** — the pack's DESIGN-SYSTEM §14 "must be verified in the implemented application" list (open question Q10), each verified before the story that introduces the surface is accepted:

1. Screen-reader output for streaming conversation, drawer focus return and table virtualisation.
2. Keyboard traps in the full-screen workspace and browser sessions.
3. Zoom to 200% and 400% reflow, and Windows High Contrast / forced colours (the symbol needs a `forced-color-adjust` fallback to one colour).
4. Reduced-motion behaviour, and rendered contrast in dark OS notification templates.

A rendered mockup is not proof that an integration, security control or execution behaviour works; permissions enforcement, confirmation invalidation, per-operation outcome reporting and evidence capture are verified in the implemented system (HANDOFF §7, Proposal 4b §9).

## 8. Token source discrepancies and open items

### Token source discrepancies

The pack's DESIGN-TOKENS.md and `tokens/zobba-tokens.json` were compared entry by entry (33 primitives, 58 semantic aliases, 15 type roles, and the space, radius, border, shadow, layout, icon, focus, selection, motion and breakpoint groups, and 33 contrast pairs). **No value disagrees.** The differences found are of representation and of pack completeness:

1. **Malformed markdown rows in DESIGN-TOKENS §4.** The `type.ui` weight `400|500|600` and the `type.label` weight `500|600` are written with unescaped pipes inside a markdown table, so those two rows render with extra columns. The JSON (`"weight": "400|500|600"`, `"500|600"`) is unambiguous and is used; this document escapes the pipes.
2. **Units.** The JSON writes `space`, `layout` pixel values, `radius` (except `icon`) and `icon.grid`, `icon.dense`, `icon.small`, `icon.corner-radius` as unitless numbers; the markdown writes `px`. The frontmatter restates them with `px`. The value is unchanged.
3. **Family inside a size.** `type.id` is written `12/18 IBM Plex Mono` in both sources; the frontmatter splits it into `fontSize`, `lineHeight` and `fontFamily`.
4. **Specified values that are not tokens.** DESIGN-SYSTEM states values with no token: page gutters 32 / 24 / 18px, panel default 600px at ≥ 1600, panel resize step 20px, artifact surround padding 18–28px, input height 36px, checkbox and radio 16px, toggle 36 × 20, table row padding 9–10px, column minimum 64px, auditor message maximum 380px (70% narrow), review-note column 230px, settings column 220px, lockup at 20px in the sidebar, mark at 14px for the unattended actor line, hover-preview delay 300ms, drawer slide 24px, popover offset 4px, touch targets 44px. They are restated in the body and not added to the frontmatter.
5. **Pack counts out of date.** README, HANDOFF §1 and ASSET-MANIFEST say 18 reference screens (23 are filed); README says PATTERNS P1–P16 (P1–P19 exist); HANDOFF §1 says Q1–Q12 (Q1–Q15 exist).
6. **Duplicated component group.** COMPONENT-INVENTORY repeats "Review (audit manager)" (Reviews queue, Review note, Review action bar) a second time under Settings. The two copies are identical; one is summarised in section 6.
7. **Status vocabulary completed by approved amendments, not by the pack.** DESIGN-SYSTEM §6 lacks Stop requested, Returned, Unknown, Out of period and Not applicable, and §10 lacks Awaiting approval and Pending regression; section 5 adds them per Proposal 4b §5 rows 1, 3, 6 and 15.
8. **Overlapping vocabularies in the sources.** EXPERIENCE-RULES R3.5 lists artifact states Draft → In review → Approved → Issued (+ Superseded) while DESIGN-SYSTEM §6 and Proposal 4b §3 list the review-and-issue dimension; section 5 uses Proposal 4b §3. For action outcomes, Proposal 4 U5 listed "Not sent · Sent, not yet confirmed · Confirmed · Blocked · Failed before sending · Not confirmed by the provider" and COMPONENT-INVENTORY's Activity record entry lists "Sent · Sent · accepted · Failed · Unconfirmed"; Proposal 4b §3 replaced U5, so section 5 and `./EXPERIENCE.md` revision 2 §5 both use the 4b §3 set (Sent · Sent, not confirmed · Confirmed · Blocked · Failed before sending) plus Not sent for the not-dispatched attempt, resolved in this consolidation on 2026-09-25. Outcome sentences follow Proposal 4b §5 row 14 (which also supersedes the pack's EXPERIENCE-RULES R7.5 and §12 unknown-outcome pattern). Connection `pending` (Proposal 4b §3) is `pending-attempt` in 3d.
9. **No Lucide names for statuses.** The pack gives semantic glyph characters, not Lucide icon names, for status; see section 5, Glyphs.

### Open items from the pack (Proposal 4b §6a)

- **Q1 — Kobba comparison.** Missing input and validation: compare Kobba's current wordmark, symbol, palette, typography, icon shape and endorsement against BRAND §1. Until then Zobba stays as approved and Iris is not changed.
- **Q2 — Type-designer drawing** of the stepped-b wordmark and optical versions for 16–24px. Until then the supplied outlined SVGs are used; the replacement keeps size and placement.
- **Q9 — Notification rendering** of the template icon and result wording on Windows and macOS: a validation obligation for the story that ships OS or push notification delivery.
- **Q10 — Accessibility items that need a built product**: the section 7 implementation obligations.
- **Q11 — Trademark and domain clearance** for Zobba and a similarity search for the symbol in software classes: a validation obligation before external use.
- **Q6 — Packaging** belongs to the selected delivery surface. The icon, favicon and notification-template files authorise no native desktop application and no OS notification feature. Notifications are in-app only (AD-20); OS or push delivery stays deferred with the notification-policy contract (Proposal 4b §5 row 9). The template icon files are filed for then.
- Decided in Proposal 4b §6a and applied in this document: Q3 provenance footer (section 1), Q4 light-only working UI (section 1), Q5 Lucide at 2px (sections 1 and 3), Q7 panel protection (section 4). Q8, Q12, Q13, Q14 and Q15 are decided in Proposal 4b §6a and §7 and belong to `./EXPERIENCE.md` and the PRD; they set no visual value.

### Designs still to be made (Proposal 4b §4, §10)

Designed under the pack's rules before each story is built: memory proposals and "Remembered"; the draft engagement without a client and the client-binding moment; the needs-reconsideration flag and impact records; the `reconcile` decision surface; draft sharing versus issuance and PDF export; promotion review, "Awaiting approval" and "Pending regression"; regression case sets; retention decisions and holds; tenant switching; legacy procedures; invitation creation and acceptance; the model replacement proposal for a check; every `[TO DESIGN]` treatment and glyph in section 5. The design-acceptance register (story 18.2, `../../../implementation-artifacts/design-acceptance-register.md`) holds these as rows B1–B22 — including the activity summary, connecting a source from the conversation, the auditor's review mode, the acceptance of a Zobba-proposed change, review-note anchoring and the section 5 glyphs and treatments (B22a–B22c) — and the narrow and intermediate-width states (its table B.3).

## 9. Implementation obligations

These move with their implementation stories. None is a change made now.

- **`apps/web/src/design/tokens.test.ts`** is re-pointed from the 2026-09-01 contract to `../zobba-design-system-v1.0/tokens/zobba-tokens.json` (the canonical source) or to this document's frontmatter, which restates it, when the story that introduces the Zobba token stylesheet lands (Proposal 5 NE-8 story 8.0, identity assets and tokens). Until then it reads the old DESIGN.md and the old `tokens.css`.
- **`apps/web/src/design/status.test.ts`** reads section 5's tables (the six dimensions and the treatment table) when the story that implements the Zobba status chips lands. The retained Run-path families stay read from the old DESIGN.md until each surface's disposition story.
- **`apps/web/src/design/stylesheet.test.ts`** covers every new class the Zobba chrome adds, with its implementation story.
- The pack's HANDOFF §6 acceptance checklist is part of every UI story's acceptance (Proposal 4b §9), alongside exact-copy tests limited to the fixed labels and safety-critical patterns (Proposal 4 U11).

No application code changes and no test is retired to make the planning documents pass.

No implementation is authorised.
