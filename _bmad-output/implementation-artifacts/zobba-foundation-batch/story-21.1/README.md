# Story 21.1 verification outputs

See [implementation evidence](../../story-21-1-implementation-evidence.md) and
[independent review](../REVIEW-21.1.md). [results.json](results.json) records the
completed final gates: 172 Rust, 95 Chromium, 100 web, 54 fixture and 47 Python
tests, plus smoke, formatting, Clippy, builds and boundaries. The
[180-file manifest](../SOURCE-MANIFEST-21.1.json) identifies the final source.
Pre-repair passes are not substituted for repaired-source execution.

## Environment and command boundaries

Local verification uses Rust 1.98.1, Node 24.20.0, pnpm 11.25.0, PostgreSQL 18.4
and installed Chromium 151. No Browser plugin is available; repository Playwright
drives real Chromium against HTTPS OIDC, Rust API/worker, PostgreSQL and a numeric
loopback S3 protocol fixture. Production transport retains HTTPS/signing/TLS guards.
No live AWS request or paid resource is required by these tests.

Rust and process smoke use `zobba_patch20_3_test` at `127.0.0.1:55434`, restricted
migration owner `zobba_patch20_3_owner`, separate runtime `zobba_patch20_3_app` and
guarded fixture administrator `zobba_local_admin`. Browser tests use separately
guarded `zobba_story_20_test` and runtime `zobba_app`. Destructive suites serialize
per database and own test IdP 9444 exclusively; development and IdP 9443 remain
untouched by Story 21.1. Activation clears development URL bindings.

A fresh disposable `zobba_evidence_r02_test` database uses template0, UTF-8 and
`en_US.utf8` collation. Its default `{a,A,z,Z}` order demonstrably differs from
byte order `{A,Z,a,z}`. Restricted metadata tests require that difference and
prove both registry and recovery page boundaries. This is an additional local
qualification; it is not represented as a hosted CI run.

After the unpublished migration-6 indexes changed during review, the existing
browser test schema was reset only after repository endpoint/development guards
and exact database/user/port checks. Normal explicit migration then installed the
candidate. No published migration was edited or checksum bypass introduced.

## Evidence handling

Text log copies remove terminal colour codes and trailing whitespace; results
record original hashes. Empty formatting logs mean command success. Failed and
focused runs are labelled separately. Private fixture environment/configuration,
credentials, session state, row dumps, browser traces and local development
recovery backups are excluded from Git. Captures use synthetic fixture data.

The reusable setup and CI path remain in `zobba/README.md` and the dedicated
GitHub workflow. `fixture:setup` invokes pnpm `run setup` explicitly. Foundation
branch pushes do not trigger hosted CI; local execution is labelled accordingly.
