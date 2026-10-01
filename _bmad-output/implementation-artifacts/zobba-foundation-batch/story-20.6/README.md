# Story 20.6 verification outputs

See [implementation evidence](../../story-20-6-implementation-evidence.md),
[independent review](../REVIEW-20.6.md) and the
[159-file source manifest](../SOURCE-MANIFEST-20.6.json).
[results.json](results.json) records final commands, outcomes and original output
hashes. Text copies remove terminal colour codes and trailing whitespace; empty
formatting output means success. Focused results and explicitly named `failed-`
fixture runs are separate from final acceptance evidence.

## Environment and commands

Local verification used Rust 1.98.1, Node 24.20.0, pnpm 11.25.0, PostgreSQL 18.4
and installed Chromium 151. No Browser plugin was available, so repository
Playwright drove real Chromium. Browser integration used the signed HTTPS OIDC
fixture and actual Rust API/worker/PostgreSQL. Isolated mocked browser checks by
independent reviewers are separately identified in their reports.

Commands run from `zobba/` with the installed toolchain and explicit guarded
test URLs. The complete Rust and smoke paths use `zobba_patch20_3_test` on
`127.0.0.1:55434`, restricted owner `zobba_patch20_3_owner`, separate runtime
`zobba_patch20_3_app`, and fixture administrator `zobba_local_admin`. Browser
uses separate `zobba_story_20_test` and runtime `zobba_app`. Suites serialize per
database; the final smoke ran on patch while browser ran on story. Test IdP 9444
was owned and cleaned; development IdP 9443 was preserved.

- [Static commands](commands-static.sh.txt): frozen install, generated/types and
  web 89, fixture 54, Python 47, boundaries, fmt, Clippy and builds.
- [Rust commands](commands-rust.sh.txt): 129 passed across 30 groups; two ignored
  discovery entrypoints are real subprocess helpers invoked by their parents.
- [Browser commands](commands-browser.sh.txt): issuer-safe guarded reset then all
  72 Chromium scenarios; no failure or skip. `ZOBBA_BROWSER_EXECUTABLE` points to
  `/usr/bin/chromium`.
- [Smoke commands](commands-smoke.sh.txt): repeated explicit migration, strict
  startup refusal, exact health, database loss and same-process recovery.

These scripts preserve the executed local profile, not private fixture `env.sh`
contents. The reusable setup and CI entry points remain in `zobba/README.md` and
the GitHub workflow. The foundation branch push does not trigger hosted CI;
this package makes no claim of a hosted run.

## Preservation and recovery

[Published prefixes](published-prefixes.json) verifies unchanged migration and
catalogue bytes for versions 1–4. The separately reviewed local development
incident repair preserved 32 application tables, the published ledger and
existing function authority. See [local-recovery.json](local-recovery.json),
[strict readiness](local-recovery-ready.txt), and
[independent recovery review](reviews/local-recovery-review.md).

`local-unpublished-draft-repair.sql.txt` is the exact one-time incident evidence.
Its target, original ledger and old catalogue guards deliberately reject another
database or state. It is not an application migration or reusable checksum repair
command. Backups, sessions, application-row contents and row fingerprints are
excluded from Git.
