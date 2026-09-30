# Zobba design tokens

Canonical token definitions. The machine-readable copy is [`tokens/zobba-tokens.json`](tokens/zobba-tokens.json); both are generated from the same table and must be regenerated together. Do not edit one without the other.

Naming: `primitive.*` are raw palette values and are never used directly in components. `color.*` semantic aliases are what components reference. Component rules in [COMPONENT-INVENTORY.md](COMPONENT-INVENTORY.md) refer to these semantic names.

## 1. Primitive palette

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

Approved brand names: Graphite `#1C1B19`, Iris `#4C3FB8`, Iris strong `#3B2F99`, Iris wash `#EEECFA`, Iris light `#B9B0F5`, Linen `#EFEDE8`, Canvas `#FBFAF7`, Paper `#FFFFFF`.

## 2. Semantic colour aliases

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

**Added in this pass:** `color.border.input` (`#8F8A7F`). The earlier boards used `#CCC8BD` for the composer border, which is only 1.67:1 against white and fails the 3:1 non-text requirement for identifying an input. `#CCC8BD` remains for decorative boundaries (chips, secondary dividers). Placeholder text moved from `#7A766D` to `#716D64` because the former is 4.34:1 on Canvas.

## 3. Calculated contrast

Ratios are calculated with the WCAG 2.x relative-luminance formula for the exact pairs used in the reference screens. They are design-level checks; rendering, anti-aliasing and user settings still require verification in the implemented application.

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

Notes: `text.disabled` (3.66:1) is used only for non-essential disabled labels, which WCAG exempts. `border.control` (1.67:1) is decorative and never the only cue that something is a control; any control using it also has a text label.

## 4. Typography

Family: **Hanken Grotesk** (UI and chrome), weights 400, 500, 600. **IBM Plex Mono** 400, 500 for identifiers and references only. Fallback: `"Segoe UI", system-ui, sans-serif`. Tables and counts use `font-variant-numeric: tabular-nums`. Artifacts use the methodology template typography, not these tokens.

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
| `type.ui` | 14/20 | 400|500|600 | 0 | Navigation, lists, rows |
| `type.label` | 13/18 | 500|600 | 0 | Buttons, chips, form labels |
| `type.meta` | 12/16 | 400 | 0 | Metadata, captions, section labels (600) |
| `type.table-head` | 12/16 | 600 | 0 | Table headers |
| `type.table-cell` | 13/18 | 400 | 0 | Table cells; tabular-nums |
| `type.id` | 12/18 IBM Plex Mono | 400 | 0 | Identifiers and references only |
| `type.chip` | 12/16 | 600 | 0 | Status and presence chips |

## 5. Space

| Token | Value |
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

## 6. Radius

| Token | Value |
|---|---|
| `radius.xs` | 4px |
| `radius.sm` | 6px |
| `radius.md` | 8px |
| `radius.lg` | 12px |
| `radius.xl` | 16px |
| `radius.composer` | 18px |
| `radius.pill` | 999px |
| `radius.icon` | 22.5% |

## 7. Border

| Token | Value |
|---|---|
| `border.hairline` | 1px |
| `border.input` | 1px |
| `border.input-focus` | 1.5px |
| `border.diff-underline` | 1.5px |
| `border.selection` | 2px |

## 8. Shadow

| Token | Value |
|---|---|
| `shadow.composer` | 0 2px 10px rgba(28,27,25,.05) |
| `shadow.page` | 0 1px 3px rgba(28,27,25,.08) |
| `shadow.popover` | 0 12px 32px rgba(28,27,25,.14) |
| `shadow.drawer` | -12px 0 32px rgba(28,27,25,.10) |
| `shadow.dialog` | 0 24px 64px rgba(28,27,25,.20) |

## 9. Layout

| Token | Value |
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

## 10. Icon

| Token | Value |
|---|---|
| `icon.grid` | 24px |
| `icon.dense` | 20px |
| `icon.small` | 16px |
| `icon.stroke` | 2px (1.5px at 16px) |
| `icon.cap` | round |
| `icon.join` | round |
| `icon.corner-radius` | 2.5px |

## 11. Focus

| Token | Value |
|---|---|
| `focus.ring` | 2px solid color.focus.ring, offset 2px |
| `focus.composer` | 1.5px color.accent.default border + 0 0 0 4px color.accent.wash |

## 12. Selection

| Token | Value |
|---|---|
| `selection.block` | 0 0 0 2px color.accent.default + color.surface.selected-accent, radius 2 |
| `selection.row` | inset 2px 0 0 color.accent.default + color.surface.selected-accent |
| `selection.text` | color.selection.text |
| `selection.tag` | color.accent.strong on color.accent.wash, radius 6 |

## 13. Motion

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

## 14. Breakpoint

| Token | Value |
|---|---|
| `breakpoint.mobile` | 0–599 |
| `breakpoint.tablet` | 600–1023 |
| `breakpoint.desktop` | 1024–1599 |
| `breakpoint.desktop-reference` | 1280×800 |
| `breakpoint.large` | 1600+ |

## 15. Wordmark and symbol constants

| Constant | Value |
|---|---|
| Symbol grid | 32 × 32; forms 11 × 18; outer radius 5.5; inner radius 1.2; offset 6 |
| Symbol channel | 2 units at ≥ 20px; 2.8 at 13–19px; 3.6 at ≤ 12px |
| Wordmark | Hanken Grotesk 600 outlines; tracking −28/1000; b–b −50/1000 |
| Stepped b | Second b ascender cut at x-height + 50% of ascender extension (595/1000) |
| Lockup | Symbol visible height = cap height; gap = one form width (11 grid units) |
| Endorsement | "by Raeltec" Hanken 500 at 42% of wordmark size, baseline-aligned, gap 0.28 × size |
