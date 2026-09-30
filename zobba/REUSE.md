# Selected source reuse

Story 20.1 reuses only the accepted Pair identity and token assets listed below.
The application shell and health checks are new implementation; no prototype logic,
legacy application packages, schema, fixtures, or backend code enter this workspace.

## Exact source

Repository baseline: `a4041ee2b5bb4c10410ee3fa9bb16482a5b6b57d`.
All source paths in the table are relative to
`_bmad-output/planning-artifacts/ux-designs/zobba-design-system-v1.0/` at that revision.
The assets are copied byte for byte, including SVG provenance metadata.
`web/src/styles.css` uses selected unchanged semantic colours, spacing, radii,
and typography from the copied token source and active `ux-Zobba-2026-09-25/DESIGN.md`.

| Destination in zobba/ | Original path | SHA-256 |
| --- | --- | --- |
| `web/public/assets/zobba-lockup-color.svg` | `assets/lockup/zobba-lockup-color.svg` | `4d7ac4d7fc0f236b3c76ec2884977ea83984cfe642327bdb86d8ef802360a8b5` |
| `web/public/assets/zobba-symbol-color.svg` | `assets/symbol/zobba-symbol-color.svg` | `b55dc95bb95fa4570ab718af6f46d7d0f82df9fe5e7e85fee060b4a9103951a9` |
| `web/public/assets/favicon.svg` | `assets/favicon/favicon.svg` | `0c79bcd4be4b180e0b1fa117306721f870796e64f5992bddef92d93ad4838d4b` |
| `web/public/assets/fonts/HankenGrotesk-wght.ttf` | `assets/fonts/HankenGrotesk-wght.ttf` | `813b3f8fa0965405669a89b38e51bbefd95eef6b8e20d1cb2d8c10cce062662f` |
| `web/public/assets/fonts/OFL-HankenGrotesk.txt` | `assets/fonts/OFL-HankenGrotesk.txt` | `e02ccb89a86839b22feff7872ff5cc355cc0f58318d29eee20e2cf83a612f16d` |
| `web/src/design/zobba-tokens.json` | `tokens/zobba-tokens.json` | `feafa32ea4f50171df702578e3f35489b6782715287192b0def872e7dabb69ff` |

## Rights and notices

The Pair symbol, lockup, favicon and token design are supplied first-party Zobba
identity material. `BRAND.md` identifies the company as Raeltec Systems Limited.
The supplied pack grants no separate open-source licence for its brand identity;
reuse here is within the owner's authorised Zobba implementation, not a grant
for unrelated redistribution or trademark use.

Hanken Grotesk is licensed under **SIL Open Font License 1.1**. The complete
upstream notice is retained beside the unmodified font at
`web/public/assets/fonts/OFL-HankenGrotesk.txt` and is included in the web build.
The baseline asset manifest records its source as Google Fonts
`ofl/hankengrotesk`, retrieved 30 September 2026:
<https://github.com/google/fonts/tree/main/ofl/hankengrotesk>.
The immutable revision and content hash above identify the exact bundled bytes;
no unverified upstream commit is asserted. The Pair lockup outlines derive from
Hanken Grotesk 600, as recorded in the original Pair asset manifest.
IBM Plex Mono is not bundled or fetched by this shell.

## Adapted verification

- Copy verification compared every listed asset with `git show` at the exact
  baseline and recorded the hashes above; SVG metadata and the font notice remain intact.
- `pnpm check` compares the owned OpenAPI document with the Rust emitter, checks
  generated TypeScript freshness, strict TypeScript and refusal
  of malformed, mismatched, wrong-service and false-ready health responses.
- Browser inspection checks that the supplied Pair SVGs and local font load,
  real health updates render, retry works, and desktop/narrow layouts remain readable.
- Prototype interaction checks and mock Tasks/computer views are not inherited
  as claims about this application.
