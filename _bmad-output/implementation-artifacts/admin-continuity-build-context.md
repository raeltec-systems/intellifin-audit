# Admin continuity implementation context

Owner approval, 1 October 2026 (Africa/Lusaka): every organisation must retain an active, non-expiring Admin membership linked to an active identity; temporary additional Admins remain allowed. Unicode checkpoint `9a76c5c` and Story 20.6 are accepted. Branch `codex/zobba-foundation-batch`; no merge, deployment or next batch.

The implementation agent owns production code, migration/catalogue 7, tests, synthetic fixtures, `zobba/README.md` and execution checkboxes in its spec. The coordinator owns planning/status/decision documents, final review and evidence packaging. Do not commit or push from the implementation agent. Do not invoke bmad-build recursively. Inspect CLAUDE.md working rules. Root already read cloud runtime/setup skills; no new cloud configuration required. A read-only scout's detailed map is available locally at `/tmp/zobba-admin-identity-scout.md`.

## Boundary facts at the accepted 9a76c5c baseline

- Runtime can INSERT identity id/issuer/subject/display_name and UPDATE display_name only. Identity `active` changes/deletion occur through owner SQL, with no product endpoint. Preserve this boundary. Existing identity foreign keys are NO ACTION and protect historical attribution.
- Organisation memberships use forced RLS; migration 5 adds owner-only policies for narrow SECURITY DEFINER functions. Schema validation rejects unknown objects and currently all non-internal triggers. Any new triggers/functions must receive exact fingerprint/ACL/ownership validation; never broadly allow triggers.
- Existing lock order is org advisory key 205, engagements, identity FOR SHARE. Owner UPDATE/DELETE row triggers start holding identity rows, so test possible inversion and safe abort. Plain advisory+EXISTS is insufficient under REPEATABLE READ.
- Schema catalogue versions currently inferred by exact table inventory; a same-table schema revision needs deliberate version recognition without executing unverified public functions. Migration ledger is bounded to seven rows and needs adjusting for version 7. Preserve all published catalogue bytes.
- Existing synthetic org-b has only an auditor. Give synthetic first provisioning an explicit dedicated Admin-only identity; do not promote the existing auditor or widen current Admin test scopes. Test fixtures with ownerless organisations likewise need realistic atomic provisioning. Migration must instead refuse invalid existing data.

## Isolated verification environment

Source `/workspace/zobba-build-tools/activate-tests.sh` for Rust 1.98.1, Node 24.20.0, pnpm 11.25.0, PostgreSQL 18.4 and local Chromium. The file clears development DB URLs. Work from `/workspace/intellifin-audit/zobba`. Network access is available; no external service provisioning is authorised.

- PostgreSQL `127.0.0.1:55434`.
- Restricted Rust disposable database `zobba_patch20_3_test`: migration role `zobba_patch20_3_owner`, runtime `zobba_patch20_3_app`, admin `zobba_local_admin`.
- Browser disposable database `zobba_story_20_test`: migration/admin `zobba_local_admin`, runtime `zobba_app`.
- Never reset/migrate development `zobba_story_20` or stop its IdP port 9443. Test IdP uses 9444; serialize Rust/API/browser suites and own only test services you start.
- Private fixture environment `/tmp/zobba-20-6-idp/env.sh` may be sourced but never printed or copied into logs. Preserve `/tmp/zobba-development-recovery-20-6/`.
- Prior safe Rust runner `/tmp/zobba-21-1-repair-run-rust.sh` and recorded commands under `zobba-foundation-batch/story-21.1-unicode/commands.sh.txt` show activation/URLs. Create separate new runners/logs with explicit exit receipts. Do not overwrite prior evidence.
- Browser plugin unavailable; use repository Playwright and installed Chromium with real OIDC/PostgreSQL/S3 test fixtures. No detached substitute frontend.
- Watch free disk before builds. Only if necessary remove this workspace's disposable Cargo incremental outputs; do not remove unknown processes/data.
- Retain new raw logs under `/tmp/zobba-admin-continuity/` with per-command exit receipts. Coordinator will publish selected `.txt` evidence (repository ignores `*.log`).

The implementation agent may use bounded, non-overlapping subagents if useful, but retains exclusive ownership of test services/databases and must serialize consumers. Report complete executed counts, commands and limitations. The coordinator performs independent review after implementation.
