---
name: Zobba
status: final
revision: 3
created: 2026-09-25
updated: 2026-09-30
description: Active Pair visual contract for Zobba's continuing audit working environment. Existing tokens and assets retained; firm work products keep their own templates.
sources:
  - ../../zobba-product-architecture-2026-09-30/Zobba-Product-and-Architecture-Design.md
  - ../zobba-design-system-v1.0/BRAND.md
  - ../zobba-design-system-v1.0/tokens/zobba-tokens.json
  - ./EXPERIENCE.md
colors:
  text-primary: '#1C1B19'
  text-secondary: '#3D3A35'
  text-tertiary: '#5E5A52'
  text-placeholder: '#716D64'
  surface-canvas: '#FBFAF7'
  surface-sidebar: '#EFEDE8'
  surface-panel: '#FFFFFF'
  surface-artifact-surround: '#F6F5F1'
  border-hairline: '#E3E0D8'
  border-input: '#8F8A7F'
  accent: '#4C3FB8'
  accent-strong: '#3B2F99'
  accent-wash: '#EEECFA'
  attention: '#FFFBF3'
  warning-text: '#8A4B06'
  pass-text: '#1E6B35'
  exception-text: '#B42318'
  diff-added: '#E8E4DA'
  diff-removed: '#6F6B63'
typography:
  body:
    fontFamily: "'Hanken Grotesk', 'Segoe UI', system-ui, sans-serif"
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 24px
  ui:
    fontFamily: "'Hanken Grotesk', 'Segoe UI', system-ui, sans-serif"
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  title:
    fontFamily: "'Hanken Grotesk', 'Segoe UI', system-ui, sans-serif"
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 21px
  meta:
    fontFamily: "'Hanken Grotesk', 'Segoe UI', system-ui, sans-serif"
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  mono:
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace"
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 18px
rounded:
  sm: 6px
  md: 8px
  lg: 12px
  xl: 16px
  composer: 18px
  full: 9999px
spacing:
  '1': 4px
  '2': 8px
  '3': 12px
  '4': 16px
  '5': 20px
  '6': 24px
  '8': 32px
components:
  primary-action:
    background: '{colors.text-primary}'
    foreground: '{colors.surface-panel}'
    radius: '{rounded.md}'
  composer:
    background: '{colors.surface-panel}'
    border: '{colors.border-input}'
    radius: '{rounded.composer}'
  work-card:
    background: '{colors.surface-panel}'
    border: '{colors.border-hairline}'
    radius: '{rounded.lg}'
  focus:
    color: '{colors.accent}'
    width: 2px
    offset: 2px
---

# Zobba · Design

This is the active visual spine. [EXPERIENCE.md](EXPERIENCE.md) owns behavior. These spines govern reference screens; accepted product and architecture revision 3 governs scope. [Prior revision 2](archive/revision-2/DESIGN.md) is historical. No application implementation is implied.

## Brand & Style

Keep the supplied **Pair** identity: Graphite, Linen, Canvas, Paper and Iris; Hanken Grotesk; the outlined stepped-b wordmark and paired symbol. Zobba feels like a calm place to do work with an assistant. The conversation is readable, the work is close by and the audit basis can be inspected. No replacement mascot or Dots artwork.

Use the original [brand assets](../zobba-design-system-v1.0/assets/) and [token source](../zobba-design-system-v1.0/tokens/zobba-tokens.json). The frontmatter is a compact subset, not a second palette. The firm's own template governs exported work-product typography, reference scheme, logo and required sections.

## Colors

Use {colors.surface-sidebar} for navigation, {colors.surface-canvas} for conversation and {colors.surface-panel} for work. {colors.accent} marks Zobba presence, links, focus and selection. Graphite is the primary action color. A status includes a word; color alone never means working, failed or reviewed. Red/green are reserved for actual evaluation meaning, not change tracking.

The unchanged token source records contrast: primary text on Canvas 16.49:1; tertiary text 6.57:1; Iris on Canvas 7.42:1; input boundary on Canvas 3.29:1. Use {colors.border-input} where a control boundary is needed; hairlines only separate content. Essential helper text never uses a disabled-text color.

## Typography

Use {typography.body} for conversation, {typography.ui} for navigation and tables, {typography.title} for headers and {typography.meta} for attribution. Weights are 400, 500 and 600. Mono is for identifiers and technical values. Unboxed assistant prose stays within a readable measure; user messages use a Linen bubble. No avatar beside every reply. Status never overlaps the prose.

## Layout & Spacing

The original 248px navigation can collapse to a 52px rail when a workspace opens. A 52–64px header retains the engagement and selected Task. Conversation remains at least 400px at a normal desktop layout; workspace starts at 420px. The companion panel holds Active work, Needs you, Computers, Work products and Permissions. It is supporting context, not a dashboard of metrics.

At narrow widths, Conversation, Workspace and Needs you are separate views under the same engagement header. No squeezed two-pane desktop. Keep scoped controls and a return to conversation reachable. Tables can scroll inside their own labelled region; the page does not scroll horizontally. The reference spans 1280×800 desktop and 390×844 narrow, with an intermediate single-workspace arrangement when two usable panes no longer fit.

## Elevation & Depth

Use tone and hairlines for hierarchy. Keep the existing subtle paper/composer shadows. Elevation is reserved for menus, evidence previews and private sign-in dialogs. A privacy cover is a real replacement surface, not blur over sensitive pixels.

## Shapes

Use the existing 4/6/8/12/16px corner scale; the composer is 18px. Pills are short labels and controls. The work page remains a page, without decorative framing. Focus is a 2px Iris ring with 2px offset.

## Components

| Component | Visual treatment | Reference |
|---|---|---|
| Navigation and header | Pair lockup, Linen navigation, clear engagement/context line; named Task when inspected. | RS24, RS30 |
| Conversation and composer | Unboxed assistant prose, Linen user message, Paper composer with input boundary; scoped controls stay separate from Send. | RS24, RS33 |
| Task card | Paper, hairline, 12px corners; objective, owner/context, state and Open action. Never a completion percentage invented from activity. | RS24 |
| Companion panel | Quiet section headings and compact lists; Needs you has a restrained attention surface; shelf lists version, Task and review state. | RS24–25 |
| Question and receipt | One useful question, its consequence and bounded choices; precise inline Received/Applied or sign-in event text. | RS25, RS28–29 |
| Workspace panel | Title, From Task, Pin/Expand/Close; inspection banner with Follow Zobba. | RS26 |
| Work product and evidence | Firm page on neutral surround; citations and selected claim use Iris overlays; coverage and limitations remain legible. | RS26, RS34 |
| Computer and control strip | Actual stream in implementation, account/environment header, freshness and named controller; scoped control strip below. | RS30–32 |
| Private sign-in | Focused Paper dialog, verified destination and role, protected application surface; other viewers receive an opaque privacy cover. | RS27–29 |
| Permissions decision | Concrete action/destination/material; Graphite action, secondary refusal/edit, expandable bounded standing rule. | Spine-only |
| Changes and review | Underline additions on neutral fill; strike removals. Review names the exact version and accountable person, including Self-reviewed. | Spine-only |
| Methodology, skills and Check editor | Simple editable form with sources and validation; ordinary Save for Admin configuration, explicit reviewed method for recurrence. | Spine-only |
| Search and connections | Readable scoped rows; source/account/location separated; empty, partial and access-error text. | Spine-only |

See the [interactive reference and rendered screens](../zobba-design-system-v1.0/reference-screens/README.md). Its simulated desktop is a layout fixture, never a substitute for the real computer required in the product.

## Do's and Don'ts

- Keep Pair assets and token values; make hierarchy with typography and space.
- Preserve the selected work and make task/account/client scope legible.
- Keep product copy free of internal Rust, queue, lease and transport terminology.
- Do not use “Active”, “Connected” or a green dot as proof of task success or review.
- Do not turn raw activity into a scrolling wall of tool calls.
- Do not apply Zobba's typography to a firm's exported working paper.
