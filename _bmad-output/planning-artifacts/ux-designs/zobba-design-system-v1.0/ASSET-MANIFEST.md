# Asset manifest

All assets are in [`assets/`](assets/). SVGs are vectors with text converted to outlines. No font binaries are included.

## Status key

- **Final geometry:** approved construction, exported as vector; use as supplied.
- **Production-ready, pending specialist drawing:** usable now; to be replaced by a type designer's drawing (Q2) without changing its size or placement.
- **Reference only:** for comparison. Don't ship it.

## Symbol — final geometry

| File | Use | Size range |
|---|---|---|
| `symbol/zobba-symbol-color.svg` | Default symbol on light | ≥ 20px |
| `symbol/zobba-symbol-small-color.svg` | Wider channel | 13–19px |
| `symbol/zobba-symbol-micro-color.svg` | Widest channel | ≤ 12px |
| `symbol/zobba-symbol{,-small,-micro}-mono.svg` | One colour, Graphite | print, provenance |
| `symbol/zobba-symbol{,-small,-micro}-reverse.svg` | White + Iris light on dark | dark surfaces |
| `symbol/zobba-symbol{,-small,-micro}-reverse-mono.svg` | White only | photography, OS templates |
| `symbol/png/zobba-symbol-micro-mono-{10,12}.png` | Raster provenance (@2x) | 10px, 12px |

viewBox is 0 0 32 32, and the symbol keeps its built-in 4-unit margin.

## Wordmark and lockups — production-ready, pending specialist drawing

| File | Use |
|---|---|
| `wordmark/zobba-wordmark-graphite.svg` | Wordmark alone on light |
| `wordmark/zobba-wordmark-reverse.svg` | Wordmark alone on dark (`#F4F1EA`) |
| `lockup/zobba-lockup-color.svg` | Horizontal lockup, primary |
| `lockup/zobba-lockup-mono.svg` | One colour |
| `lockup/zobba-lockup-reverse.svg` | On dark |
| `lockup/zobba-lockup-endorsed-color.svg` | "Zobba by Raeltec", on light |
| `lockup/zobba-lockup-endorsed-reverse.svg` | "Zobba by Raeltec", on dark |
| `lockup/zobba-provenance-mono.svg` | Artifact footer, print |

These are outlined from Hanken Grotesk 600 and 500 (OFL), with the stepped b constructed by cutting the ascender at 595/1000. The height scales from a 1000-unit em: the wordmark viewBox is 726 units high, and the endorsed lockup is 820.

## App icon — final geometry

| File | Use |
|---|---|
| `icon/zobba-app-icon-dark.svg` | Default app icon, ≥ 32px |
| `icon/zobba-app-icon-dark-small.svg` | 16–24px (wider channel) |
| `icon/zobba-app-icon-light.svg`, `-light-small.svg` | Light docks, marketing |
| `icon/png/zobba-app-icon-{dark,light}-{512,256,96,48,32,24,16}.png` | Raster exports |
| `icon/zobba-notification-template-{black,white}.svg` | OS notification and menu-bar template |

OS packaging (.icns, .ico, Windows tile, maskable PWA icon) is not generated. Build it from the 512px PNG and the SVG, keeping the symbol at 64% scale, centred (Q6).

## Favicon — final geometry

| File | Use |
|---|---|
| `favicon/favicon.svg` | Modern browsers |
| `favicon/favicon-{16,32,48}.png` | Fallback and `.ico` source |

## Reference only

| File | Purpose |
|---|---|
| `reference/zobba-wordmark-lowercase-reference.svg` | Validation comparison. Not approved. |
| `reference/zobba-wordmark-unstepped-reference.svg` | Validation comparison. Not approved. |

## Design source

| File | Contents |
|---|---|
| `source/Zobba Identity Final.dc.html` | Approved identity board |
| `source/Zobba Reference Board.dc.html` | All 18 reference screens |
| `source/Zobba Reference Screen.dc.html` | Screen source (prop `screen`) |
| `source/Zobba Pair Mark.dc.html` | Animated mark states (reference implementation of the motion spec) |
| `source/Zobba Wordmark.dc.html`, `source/Zobba Final Screen.dc.html` | Supporting components |

Open the source files in a browser from the `source/` folder (they need `support.js` beside them and `../assets/`). They are design sources, not application code.
