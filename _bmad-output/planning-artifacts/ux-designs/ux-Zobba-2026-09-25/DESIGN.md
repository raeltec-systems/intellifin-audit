---
name: Zobba
status: final
revision: 2
description: Visual contract for Zobba's chrome, generated from the Zobba design pack v1.0; the pack's tokens/zobba-tokens.json is the canonical machine-readable token source and this frontmatter restates it; artifacts keep the firm template's typography.
created: 2026-09-25
updated: 2026-09-25
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

Forms appear in Settings only (Connections, Methodology and skills, Permission defaults, Administration, profile, organisation) and never take over ordinary audit work; anything an auditor decides during a task is asked in the conversation.

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
| No engagements | "No engagements yet. Your administrator adds engagements, or you can start a task without one." | Look like an error |
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
