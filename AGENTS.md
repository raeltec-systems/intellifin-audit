# AGENTS.md

<!-- bmad:context -->
<!-- Verified 2026-09-01 against 6c93db5. Managed by bmad-project-context; edits inside this block are replaced on refresh. Keep anything you want preserved outside the markers. -->

## intellifin-audit

Planning workspace for IntelliFin Audit, an audit-execution platform where an Auditor defines an Audit Procedure once and an autonomous Audit Agent runs it under human review. No application code yet; the decided stack is a pnpm monorepo (Next.js 16 web, Node worker, PostgreSQL 18) described in the architecture spine. Planning artifacts live under `_bmad-output/`; human working rules and the decision log live in `CLAUDE.md`.

## Policy

- Never edit `_bmad/config.toml`, `_bmad/config.user.toml`, or `_bmad/_config/`; they are installer-managed. Override in `_bmad/custom/config.toml`.
- Never hand-edit a `.memlog.md`; append with `uv run _bmad/scripts/memlog.py append --workspace "<folder>" --type <type> --text "..."`.
- Change a skill in both `.claude/skills/` and `.agents/skills/`; they are copies, not symlinks, and `.github/agents/` stubs load from `.agents/`.
- Never push to `main`; work on a branch and merge through a pull request.

## Where things are

- Product truth: `_bmad-output/planning-artifacts/prds/prd-IntelliFin Audit-2026-08-31/prd.md` plus `addendum.md` (state models, Gate rules, Template contracts, golden datasets).
- Build contract: `_bmad-output/specs/spec-IntelliFin Audit/SPEC.md` and its `companions:` list.
- Architecture invariants AD-1..23: `_bmad-output/planning-artifacts/architecture/architecture-IntelliFin Audit-2026-09-01/ARCHITECTURE-SPINE.md`.
- UX: `_bmad-output/planning-artifacts/ux-designs/ux-IntelliFin Audit-2026-09-01/DESIGN.md` and `EXPERIENCE.md`.
- Work breakdown: `_bmad-output/planning-artifacts/epics.md` (9 epics, 76 stories).

## Running and verifying

- Use Node 24.20.0 and pnpm 11.25.0: `nvm use` (reads `.nvmrc`), then `corepack enable`. `engine-strict` is on, so another Node major fails the install.
- Monorepo, from the repository root: `pnpm install`, `pnpm -r typecheck`, `pnpm boundaries` (AD-1 dependency-cruiser check), `pnpm test` (Vitest unit tests).
- Needs a database: `pnpm db:migrate` and `pnpm test:integration` both read `DATABASE_URL` and require PostgreSQL 18. `pnpm db:generate` writes a new Drizzle migration.
- Run BMAD scripts with `uv run <script>`, never plain `python`; they declare their own dependencies in PEP 723 headers.
- Skill tests: `uv run --with pytest --with ruamel.yaml pytest .claude/skills/*/scripts/tests`.
- Lint a spine with `uv run .claude/skills/bmad-architecture/scripts/lint_spine.py --workspace "<architecture folder>"`; passing the file path fails.

## Conventions that differ from defaults

- Every planning-artifact folder name contains a space; quote every path under `_bmad-output/`.
- Identifiers are stable and never renumbered: FR-n, NFR-n, AD-n, CAP-n, UX-DRn, Story N.M. Retire, never reuse.
- `UNEVALUATED` is an evaluation value with an origin (RULE, AGENT_JUDGED, HUMAN), never an origin.
- Revising an upstream artifact invalidates downstream ones; say so in the artifact's §0 and in the PR.

## Known pitfalls

- Bash `cd` persists between tool calls; a relative path after an earlier `cd` misses. Use absolute paths.
- Shell `for` loops split folder names on the space; use quoted arrays or Python.
- `## Epic N:` appears twice in `epics.md` (the Epic List and the section); anchor on `\n## Epic N:` when slicing.
- `lint_spine.py` rejects AD IDs out of document order and any `{placeholder}` token in routes; write `<run-id>`.

<!-- /bmad:context -->
