# Selected source reuse

Stories 20.1–20.2 reuse only the accepted Pair identity and token assets listed below.
The application shell, identity flow and health checks are new implementation; no prototype logic,
legacy application packages, schema, fixtures, or backend code enter this workspace.
Story 21.1 adds the explicitly scoped adapter reuse below.

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
- Story 20.2 checks these unchanged assets in real HTTPS login, the assigned
  engagement chooser, selected scope, denial/logout and narrow keyboard states.
  Its maintained `openidconnect` 4.0.1 and `oauth2` 5.0 verifier dependencies are
  locked in Cargo; the independent `oidc-provider` 9.12.2 fixture is locked in
  pnpm. Fixture Node code is test infrastructure, with no legacy domain imports
  and no application authentication bypass.


## Story 21.1 evidence adapter and protocol fixture

Adapted first-party research prototype `/workspace/zobba-evidence-adapter-lab/`
into infrastructure `src/evidence/s3.rs`, `tests/support/s3_protocol.rs` and
`tests/evidence_s3.rs`, through new application-owned custody ports. The scratch
crate is unpublished and has no package licence declaration; this is within the
owner-authorized repository implementation, not a new redistribution licence.

| Prototype file | SHA-256 before adaptation |
| --- | --- |
| `src/lib.rs` | `3389966ed753943478930bddbdad51d5aefc06cb759dfd164099f310a3b633e7` |
| `src/tests.rs` | `5b40471969bc3f66ae9831e642ab422454e1633301e67584faf55646922b3418` |
| `Cargo.toml` | `823e3eeacb3ff1d7f04addc81b99943d44e49e089df960f7fd576a6a9f4c3063` |
| `Cargo.lock` | `9e3dc5dcfd9357b1177a6281f67bbc62879a1498c31e28011b0c1122dd3db21e` |
| `README.md` | `92492e8385bfebcbd9ba427034d80df8ffe76df7acd70350a7809701722c7819` |

The historical TypeScript files `packages/infrastructure/src/evidence/s3-evidence-store.ts`
and `s3-evidence-store.test.ts`, exactly at commit
`4fb496eaee4a676e0875e00ba5b00b913e107899` (2026-09-06), are behavioral references
only. Their hashes are respectively
`8a7fb41193b9168278c904dca3e4a43049d7f94f1d57cc072319901ae6cf45e4` and
`425a459f7369c8991e901cc5e23f73c6873f7071f34a5640e81eb1c8152802cc`.
No legacy package or Node domain authority is transplanted.

Pinned `object_store` 0.14.2 is MIT/Apache-2.0, checksum
`f1796bc93603f78c5760a69f2d58badc9618d22adade0a95385bb2adbae4eb94`.
Fixture-only direct `reqwest` 0.13.5 is MIT OR Apache-2.0, checksum
`16a1cfa75cc186dd73d5818e510e042e40927bccc9c236b061cea97e1eb08029`;
it is also the adapter's transitive HTTP dependency. The existing direct production
reqwest 0.12.28 is retained. `bytes` 1.12.1 is MIT; `futures-util` 0.3.34 is
MIT OR Apache-2.0. The fixture's `http-body-util` 0.1.5, `hyper` 1.11.1 and
`hyper-util` 0.1.21 use MIT. Their upstream source notices remain in the locked
Cargo dependencies; none is vendored with altered licence text.
