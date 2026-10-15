# Stories 21.2–21.4: build context

Owner authorised this batch on 2 October 2026 (Africa/Lusaka), accepting `38d76b019db1e5cb637f8c66e6cde3947c3415b2`. Continue on `codex/zobba-foundation-batch`. Implement and verify 21.2 before its 21.3/21.4 consumers. Root coordinates the installed `bmad-build` workflow, specifications, status, independent review, evidence and commits/pushes. Implementers must not recursively invoke the workflow or commit/push. Routine engineering is authorised; no merge, deployment, paid environment, customer data or later story is authorised.

Use the active SPEC, epic-21-context.md and each scoped story specification. The accepted Rust foundation and published migration/catalogue prefix 1–7 are verified dependencies, not legacy Node contracts. Refer to `CLAUDE.md` for transaction ordering, exact sessions, receipt custody, Unicode parity, safe fixture restoration and browser recovery. Preserve source ownership and test-service ownership across delegation; serialize shared integration files/schema changes.

## Local verification

Activate `/workspace/zobba-build-tools/activate-tests.sh`; work from `/workspace/intellifin-audit/zobba`. Rust 1.98.1, Node 24.20.0, pnpm 11.25.0, PostgreSQL server 18.4 and local Chromium are installed. Activation clears development URLs. Use existing guarded test target helpers; never a bare migrator with an unverified environment.

- PostgreSQL: `127.0.0.1:55434`.
- Rust disposable database: `zobba_patch20_3_test`; migration role `zobba_patch20_3_owner`, runtime `zobba_patch20_3_app`, administrative arrangement role `zobba_local_admin`.
- Browser disposable database: `zobba_story_20_test`; migration/admin `zobba_local_admin`, runtime `zobba_app`.
- Never reset, migrate or otherwise mutate development `zobba_story_20`; never stop its IdP9443. Owned test IdP9444 must have one consumer suite at a time.
- Private fixture environment `/tmp/zobba-20-6-idp/env.sh` may be sourced, never printed or copied. Preserve `/tmp/zobba-development-recovery-20-6/`. Prefer a distinct private fixture directory for each browser batch; explicit setup is `pnpm fixture:setup`, which invokes `pnpm ... run setup`.
- Use installed Chromium and repository Playwright with actual API/OIDC/PostgreSQL/S3 fixtures. Recheck Browser plugin availability when applying the frontend testing skill; previous session had none. No detached substitute UI.
- Prior safe commands and evidence are in `zobba-foundation-batch/admin-continuity/`; copy patterns deliberately, not mechanical script-name substitutions. Retain new logs/exit receipts under `/tmp/zobba-story-21-2/`, then corresponding 21-3/21-4 directories. Never overwrite accepted evidence or publish credentials, sessions, traces or private keys.
- Run shared-database/service consumers serially. Distinct-database suites may overlap only after explicit listener/database ownership review. Await owner SQL asynchronously when a Node database proxy must forward concurrent commits.
- Use guarded restricted-owner real PostgreSQL tests, exact schema/ACL/tamper and populated-upgrade proof, fmt/strict Clippy/build, web generated-contract/type/unit/build, fixture/Python/boundaries, process smoke and real Chromium. Count executed tests honestly; helper ignores require demonstrated parent invocation. Inspect actual screenshots. Report failures and repaired reruns.

## External qualification remains separate

Early23.1 remains dependency-ready. Existing `QUALIFICATION-PROPOSAL.md` proposes a designated nonproduction AWS account, us-east-1, two AZs, seven days/168hours, USD300 ceiling (estimated USD214.13), with one Ubuntu24.04/Chromium m6i.large computer for at most24 running hours and a synthetic password/TOTP target. It still requires owner approval plus named account/operator/window/target and entitlements before provisioning. Billing alerts are not a hard cap. No cloud action is implied by this local batch. Microsoft21.5 and analysis22.4 have separate consent/qualification boundaries.
