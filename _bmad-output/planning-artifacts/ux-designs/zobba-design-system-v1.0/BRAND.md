# Zobba brand

Status: **approved identity, v1.0 (25 Sep 2026)**. The baseline is the final Pair identity board (`source/Zobba Identity Final.dc.html`). This document finishes the specification. It doesn't reopen any decision.

## 1. Foundation

| | |
|---|---|
| Product | **Zobba** |
| Descriptor | The audit agent |
| Company | Raeltec Systems Limited ("by Raeltec") |
| Concept | Pair |
| Personality | Collegial, capable, practical, unfussy, professional, modern. Trustworthy without pretending to be infallible. |
| Product idea | Claude Code / Codex for developers → Zobba for auditors: a conversation-led agent harness that does real audit work and produces real artifacts. |

### Pair

Zobba's work is always a relationship between two things:

```text
claim ↔ evidence
conversation ↔ artifact
auditor ↔ Zobba
expected ↔ actual
source ↔ conclusion
```

The symbol is two forms held against the same centre line, offset so that neither one completes the other. Zobba's job is to bring them level and to show where they don't agree. The same idea carries into the wordmark (the second b is stepped down), the working state (the forms move toward level while Zobba compares) and the layout (conversation beside the work).

Pair is a concept, not a pattern. Don't repeat paired shapes, split layouts or doubled motifs as decoration on screens.

### Relationships

- **Auditor and Zobba.** The auditor directs the work and is accountable for it. Zobba does the work inside its permissions, shows what supports each result, and asks at meaningful boundaries. Zobba is never the preparer or reviewer of record.
- **Zobba and Raeltec.** Raeltec endorses Zobba. The endorsement appears in external contexts only (§5).
- **Zobba and Kobba.** Both are Raeltec products and their names rhyme. That rhyme and the Raeltec endorsement are the only intended family signals. Zobba must not read as a Kobba module. The comparison against Kobba's current identity is still outstanding (see [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md) Q1).

### Visual principles

1. **Recede during work.** Brand presence during a task is limited to a 14px working mark and one presence chip.
2. **Iris means Zobba, never an audit result.**
3. **Chrome is Zobba. The artifact is the methodology's.**
4. **Calm and document-oriented.** Warm neutrals and hairlines; few cards; no gradients, glows or illustration in the product.
5. **Words carry state.** Every status has a word. Colour and glyphs support the word and never replace it.

## 2. Logo system

Implementers use the supplied SVGs in [`assets/`](assets/). Never rebuild the logo with CSS or live font text. See [ASSET-MANIFEST.md](ASSET-MANIFEST.md) for every file.

### Symbol

- The grid is 32 × 32 units. Each form is 11 × 18 units, with outer corners at radius 5.5 (fully round) and inner corners at radius 1.2, so each form has one flat face toward the centre line.
- The forms are offset vertically by 6 units, the left form at y 4–22 and the right at y 10–28. They overlap for 12 units: the "comparison band".
- The channel between the forms is **2 units** at 20px and above. It widens to **2.8 units** at 13–19px (the `-small` files) and **3.6 units** at 12px and below (the `-micro` files), so the forms never merge.
- Colour: the left form is Graphite and the right form is Iris. On dark surfaces, the left form is white and the right form is Iris light.
- It must not read as a pause button, chain links, quotation marks, an infinity sign or two people. The flat inner faces and the offset prevent each of those readings. Don't alter them.

### Wordmark

- Title case: **Zobba**. The outlines are Hanken Grotesk 600, tracked −28/1000, with the b–b pair set at −50/1000.
- **Stepped bb.** The second b's ascender is cut at x-height plus 50% of the ascender extension (595/1000 units), leaving a clear stem above the bowl. It must still read as **bb**: never as "ba", "b a", "bp", "br" or a missing letter. Check it at 16px before any change.
- *Refinement in this pass:* the board version cut the ascender closer to x-height (about 35% remained) and was set at weight 650 from a variable font. The outlined asset now uses the static 600 master and keeps 50% of the ascender, which reads as bb at every tested size. A type designer should still redraw the stepped b (Q2).
- Lowercase "zobba" and an unstepped "Zobba" exist only as validation references in `assets/reference/`. Don't use them.

### Lockups

| Lockup | Construction | Use |
|---|---|---|
| Horizontal (primary) | Symbol visible height = cap height. Gap = one form width (11 grid units). | Product sidebar, sign-in, documentation |
| Symbol only | 32-grid symbol | App icon source, tab, rail, working states |
| Endorsed | Horizontal lockup + "by Raeltec" in Hanken 500 at 42% of wordmark size, baseline-aligned, gap 0.28 × wordmark size, Graphite 500 (`#5E5A52`) or `#B8B3A8` on dark | Marketing, sign-in, About, proposals, external PDFs, installer |
| Provenance | One-colour horizontal lockup or micro symbol | Artifact footer "Prepared with Zobba", print |

**Clear space:** the width of one form on all sides.

**Minimum sizes**

| Asset | Minimum |
|---|---|
| Symbol on screen | 12px (`-micro`) |
| Symbol in print or provenance | 10px, one colour (`-micro-mono`) |
| Horizontal lockup | 16px wordmark size (≈ 12px cap height) |
| Endorsed lockup | 24px wordmark size, so that "by Raeltec" is at least 10px |

### Versions

- Full colour on light, the default.
- Reverse on Graphite or other dark surfaces: white and Iris light.
- One colour, Graphite, for print, provenance, fax-like reproduction and monochrome templates.
- Reverse one colour, white, for photography and OS template contexts.

### App, favicon and notification icons

- **App icon:** Graphite rounded square (radius 22.5% of the width), with the symbol at 64% scale in white and Iris light. A light variant (Linen square with a hairline) is for light docks and marketing. Supplied at 512, 256, 96, 48, 32, 24 and 16px. The icon uses the `-small` channel at 24px and below.
- **Favicon:** a colour symbol on a transparent ground (`favicon.svg`, plus 16, 32 and 48px PNGs).
- **Notification icon:** a one-colour template symbol, black or white, as the OS requires. Notifications state the result in words and the icon never carries it.

### Prohibited treatments

- Recolouring the forms with any semantic colour (green, red, amber) or showing a ✓, ! or badge on or beside the symbol.
- Rotating, mirroring, levelling the forms or changing the offset.
- Gradients, glows, shadows, outlines or 3D effects.
- Lowercase, uppercase or unstepped wordmarks, or live-text wordmarks.
- Using the symbol as a bullet, divider, avatar on every message, loading spinner or decoration.
- Placing the symbol or Iris inside a client working-paper body.
- Adding "by Raeltec" to the product sidebar, app icon, notifications or the artifact footer.

## 3. Colour

The core palette is **Graphite, Linen and Iris**. The full tokens are in [DESIGN-TOKENS.md](DESIGN-TOKENS.md).

**Iris (`#4C3FB8`) means "Zobba is here" or "you can act on this".** It never communicates an audit result.

| Iris is permitted | Iris is prohibited |
|---|---|
| Symbol right form | Result chips (pass, exception, inconclusive) |
| Presence chip "Zobba is …" | Exception or pass counts |
| Working rows, the current activity mark | Buttons that approve, sign off or send (primary buttons are Graphite) |
| Links, citation chips, evidence references | Artifact body and exported documents |
| Focus rings, composer focus | Charts of audit results |
| Selection of a claim, block or row | Large fills, gradients, marketing washes |

Audit semantics are independent of the brand:

| Meaning | Treatment |
|---|---|
| No exception / pass | `#1E6B35` on `#EAF4EC`, ✓ |
| Exception / failure | `#B42318` on `#FDECEA`, ! |
| Warning | `#8A4B06` on `#FDF3E2`, ▲ |
| Inconclusive / coverage limitation | `#3D3A35` on `#F3F1EC`, 1px dashed `#8C8578` border, ◐ |
| Pending review | `#3D3A35` with a `#CCC8BD` outline, ○ |
| Changes: added | 1.5px Graphite underline on `#E8E4DA` |
| Changes: removed | Struck through, `#6F6B63` |

Green is available for "no exception" because the brand isn't green.

## 4. Typography

- **Hanken Grotesk** is used for all chrome and UI, at weights 400, 500 and 600 and never above 600. It is licensed under the SIL Open Font License 1.1 and sourced from Google Fonts / github.com/marcologous/hanken-grotesk.
- **IBM Plex Mono** is used for identifiers and references only (AG-91002, ZB-7F3A). It is licensed under SIL OFL 1.1 and sourced from github.com/IBM/plex.
- There is no serif. Documentary authority comes from the firm's own template.
- Artifacts use the methodology template's typefaces. Zobba doesn't impose Hanken on deliverables.
- The full scale is in [DESIGN-TOKENS.md §4](DESIGN-TOKENS.md). No font binaries are included in this package.

## 5. Raeltec endorsement

| Context | Endorsed ("Zobba by Raeltec") | Zobba alone |
|---|---|---|
| Marketing site, hero, nav | ✓ | |
| Sign-in, About, installer | ✓ | |
| Proposals, external PDFs, pilot material | ✓ | |
| Product sidebar, rail | | ✓ |
| App icon, favicon, notifications | | ✓ (symbol) |
| Artifact footer provenance | | ✓ ("Prepared with Zobba") |

## 6. Voice

| Surface | Voice | Examples |
|---|---|---|
| Chrome and system events | Third person, "Zobba …" | Zobba is analysing · Zobba needs your input · Zobba needs your permission · Zobba ran this unattended · Zobba completed the weekly check |
| Conversation | First person | "I found…" · "I noticed…" · "I couldn't establish…" · "I've prepared…" · "I need your permission before sending these." |

Zobba doesn't refer to itself in the third person inside conversation. The full copy rules are in [EXPERIENCE-RULES.md §12](EXPERIENCE-RULES.md).

## 7. Marketing

There is one restrained hero: Graphite ground, the endorsed lockup, "The audit agent" eyebrow, the headline "Every finding, next to its evidence." and one real product screen. Don't use AI clichés ("revolutionise", "transform", "unlock", "next-generation", "AI-powered auditing"), illustrations, gradients or Iris washes.
