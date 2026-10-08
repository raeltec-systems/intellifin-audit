# Pair asset manifest · active

The original `assets/{wordmark,symbol,lockup,icon,favicon,reference}` SVG/PNG sets are unchanged; see the [original inventory](archive/pair-2026-09-25/ASSET-MANIFEST.md) for their provenance and variants. `tokens/zobba-tokens.json`, BRAND.md and DESIGN-TOKENS.md retain the original visual values.

New runnable references:

- `source/zobba-working-environment.html` — offline prototype shell.
- `source/zobba-working-environment.css` — Pair token-based styling.
- `source/zobba-working-environment.js` — in-memory synthetic state transitions, no external operations.
- `reference-screens/24-*` through `34-*` — rendered current desktop/narrow states; numbered sub-states under RS31 and RS32.
- `source/verify-reference.cjs` — reproducible local render and interaction checks; requires externally supplied Puppeteer and Chromium.
- `reference-screens/verification.json` — scope and local render/interaction results.
- `assets/fonts/HankenGrotesk-wght.ttf` and `OFL-HankenGrotesk.txt` — original Hanken Grotesk variable font, Google Fonts repository `ofl/hankengrotesk`, retrieved 30 September 2026; SIL Open Font License. Source: https://github.com/google/fonts/tree/main/ofl/hankengrotesk . This preserves the existing brand type and makes the prototype offline-readable.

Old reference screen compositions and editable runtime sources are explicitly superseded; [FILE-LEDGER.md](FILE-LEDGER.md) records their archive. Brand drawing sources remain under `source/` as identity history, not competing product flows.
