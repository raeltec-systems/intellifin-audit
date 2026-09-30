# AGENTS.md

## Active Zobba baseline — 30 September 2026

For **new Zobba work**, the owner-accepted design revision 3 and the
[active baseline index](_bmad-output/planning-artifacts/ACTIVE-BASELINE.md)
supersede the older product/architecture/planning descriptions and pointers in
the managed context below. This is a brownfield course correction, not a restart
of product discovery. The current application is still TypeScript/Node; the
accepted target is an own Rust backend, fresh schema, engagement conversation
coordinating Tasks, real managed computers and standing Permissions.

The active SPEC remains `_bmad-output/specs/spec-IntelliFin Audit/SPEC.md`;
read its adopted companions. Active UX is `ux-designs/ux-Zobba-2026-09-25/`.
The new backlog begins at Epic 20 in `planning-artifacts/epics.md`; the normal
`implementation-artifacts/sprint-status.yaml` is its sole active queue. Historical
epics/status and prior contracts are archived without rewriting completion.
Do not resume an older unfinished story as new-build work merely because it is
still on disk. Use an explicit new story ID and the first-batch handoff.

Use current BMAD workflows: `bmad-correct-course` for cross-artifact changes;
`bmad-prd`, `bmad-architecture`, `bmad-ux` and `bmad-spec` for owned documents;
`bmad-create-epics-and-stories` then `bmad-sprint-planning` for planning;
`bmad-build` for implementation. Preserve stable identifiers; retired does not
mean completed. Old code/tests are reuse evidence, not a requirement for a second
engine or Node domain authority. No application rewrite/deployment is claimed by
the planning consolidation. Current runtime commands below still describe the
existing application until an implementation story supplies Rust commands.

<!-- bmad:context -->
<!-- Verified 2026-09-01 against 6c93db5. Managed by bmad-project-context; edits inside this block are replaced on refresh. Keep anything you want preserved outside the markers. -->

## intellifin-audit

Planning workspace and application monorepo for IntelliFin Audit, an audit-execution platform where an Auditor defines an Audit Procedure once and an autonomous Audit Agent runs it under human review. The pnpm monorepo exists as of Story 1.1: `apps/web` (Next.js 16), `apps/worker` (Node), `packages/{domain,application,infrastructure}`, `tests/*`, on PostgreSQL 18. Planning artifacts live under `_bmad-output/` and still lead the code; human working rules and the decision log live in `CLAUDE.md`.

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
- Needs a database: `pnpm db:migrate`, `pnpm db:generate` and `pnpm test:integration` all read `DATABASE_URL` and require PostgreSQL 18. Migrations run only in `release.yml` and in CI's throwaway database — never at process startup (AD-15).
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

## Codex adaptation of the shared working rules

New Story 20.1 bootstrap commands live in [`zobba/README.md`](zobba/README.md).
Enter `zobba/` for its independent Cargo/pnpm workspaces; the managed commands
above still target historical Node code. API and worker startup only validate;
only `zobba-cli migrate --runtime-role <role>` changes the fresh schema. Real
bootstrap tests require explicitly configured, disposable `*_test` databases.

`CLAUDE.md` is the shared decision log and the source for the repository's general
working practices. Codex follows those practices subject to its active system,
developer, and tool instructions. This section records the platform-specific
translation so that the two instruction files do not silently disagree.

- **Finish the requested scope.** Complete each requested item, verify changes in
  proportion to their risk, and report a concrete blocker only when one remains.
- **Act within scope; preserve question intent.** Take reversible, low-cost actions
  needed to complete an implementation request. For a question, review, or diagnosis,
  answer before making changes unless the request also authorizes them.
- **Keep communication short and clear.** Use plain language, give exact paths and
  commands when they help, and state the result before the implementation detail.
- **Record reusable repository decisions.** Add a concise, shared workflow decision or
  gotcha to `CLAUDE.md` in the same change that established it. Follow the managed-block
  rules above for planning artifacts and `.memlog.md` files.

### Model and delegation routing

The model-family names in `CLAUDE.md` describe Claude environments and are not a
requirement to emulate unavailable models. For Codex:

- Use the least costly available capability that can safely complete the work. The
  active runtime selects the primary model; choose a subagent model only when the
  runtime exposes that choice and the task benefits from it.
- Parallelize independent, non-overlapping work only when the active Codex
  instructions permit delegation. Never create a subagent merely to satisfy the
  `CLAUDE.md` parallelism preference, and never give two agents overlapping files or
  authority.
- Keep useful work moving in the main task while permitted subagents run. Reconcile
  their results in the main task and retain the same verification standard.
- Active system/developer instructions, user direction, safety requirements, and
  available tools take precedence over this adaptation and over Claude-specific model
  names or routing guidance.

### Epic delivery protocol

- Draft specifications and make final review decisions with the highest-reasoning GPT
  model the runtime makes available (currently `gpt-5.6-sol`; use a more capable GPT
  successor when available). This model owns the final technical judgement.
- Use the fast GPT tier (currently `gpt-5.6-luna` at maximum reasoning) for bounded,
  independent scouting and audit fan-outs. Give each subagent a non-overlapping scope;
  the highest-reasoning model reconciles its findings before a decision is made.
- When blocked on a technical decision, consult the highest-reasoning available GPT
  model first. Ask the user only if that review cannot resolve a genuine product,
  authority, or external-state decision. Present at most two recommended options with
  their trade-offs when user input is required.
- Record important reusable implementation decisions and gotchas in `CLAUDE.md` in the
  same change that exposed them.
- At the end of an epic, create a readable report under
  `_bmad-output/implementation-artifacts/` that states what changed, how it was
  verified, decisions made, and any remaining user action. Link that report in the PR
  summary; it is the human-readable review surface, not a substitute for the diff.
- Commit and push each story only after implementation, validation, and required tests
  pass. Continue through the authorized epic without asking for routine approvals.
  The epic report must explain delivered behavior, actual verification results,
  important decisions, and remaining user action. For a decision that needs the user,
  present at most two options with reasons and a recommendation. Do not expect the
  user to read the full PR diff to understand the delivery.
