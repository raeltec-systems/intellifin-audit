# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Working rules

Repository guidelines, layout, and project policy live in `AGENTS.md`. Read that too.

## This is a living document

This file is the one shared place for decisions that affect how anyone — agent or developer — works with this codebase. When we hit a gotcha and agree on a workflow, record it here (see "Codebase decisions and gotchas" at the bottom) so a later agent does not re-decide it differently. Keep entries short: the decision, the reason, one line each. Update this file in the same commit as the work that produced the decision.

## Done means done

Not half done. Not done except for the part you decided to skip. And not a report about how it will be done.

Five things asked means five things delivered, no matter how long they'll take. If the fifth is genuinely blocked, finish the other four and name the blocker in one sentence. The specific blocker. Not "this needs more investigation."

## Act. Don't ask

Reversible and cheap? Do it, then tell me. Research, data pulls, analysis, drafts, refactors inside the scope I gave you, testing an API. A question costs me more than a re-run costs you.

Ask first only for: anything reaching an audience, anything we cannot undo, anything expensive.

Something is broken? Fix it. Reporting an issue you could have fixed turns your work into my to-do list.

## A question is a question

When I ask a question, answer it. Do not implement it.

"Should we use X?" is not "migrate everything to X." "What would it take to add Y?" is not "add Y."

When in doubt, assume it's a question. Answer first. Act when I say go.

## Speed and model routing

When running as a frontier-tier model (Fable, Opus, or their successors): optimize for wall-clock speed. Finish tasks quickly.

Route work to the cheapest model family that does it well. Never burn top-tier intelligence on routine work. The tiers, from cheapest to most capable — use whichever models from each tier are available:

- **Small/fast tier** (Haiku family): trivial mechanical work — file lookups, simple renames, formatting.
- **Mid tier** (Sonnet family): routine work — search, bulk edits, boilerplate, verification, running test suites.
- **Frontier tier** (Opus, Fable/Mythos family): hard reasoning that can run independently — architecture calls, tricky debugging, concurrency and correctness work. The top model (Fable) is costly; reserve it for work that actually needs it.

- Parallelize aggressively. Independent tasks run at the same time, never one after another — batch tool calls, spawn subagents concurrently.
- Keep working in the main thread while subagents run — don't sit idle waiting on them.
- Don't over-deliberate. Enough info to act = act. No long option surveys for decisions with an obvious default.
- Speed never trades away quality: same rigor, same verification, same "done means done". If parallelizing risks a worse result, slow down.
- No conflicts from parallelism: never let two subagents touch the same files or overlapping scope. Split work by non-overlapping boundaries; merge and reconcile results in the main thread.

## Short responses

It's been a long day and my brain is fried, talk to me like I'm 5.

Small words, short sentences, short paragraphs. If you have to use a big word, explain it right after. Only return what's actually necessary.

Just tell me what you did, did it work, what do I do now.

If I have to decide something: 2 options max, the context I need to pick fast, and which one you'd go with.

Keep paths and commands exact.

Always use ASD-STE100 Simplified Technical English when you talk to me.

# About this repository

## What it is

**IntelliFin Audit** is an audit-execution platform: an auditor defines an Audit Procedure once and delegates its repeated execution to an autonomous Audit Agent, whose work stays observable, replayable, evidence-backed, and subject to human review.

This repository is both a BMAD v6.11 planning workspace and, since Story 1.1, the application monorepo itself. Planning artifacts under `_bmad-output/` still lead the code: the product is specified before it is built. `AGENTS.md` holds the verified agent block; refresh it with `/bmad-project-context`.

## Layout

```
apps/web/               Next.js 16 UI and route handlers; composition root (src/bootstrap.ts)
apps/worker/            Node worker; composition root (src/main.ts), heartbeat loop
packages/domain/        Entities, value objects, state machines. Imports nothing outward
packages/application/   Commands, queries, owned ports. Imports only domain
packages/infrastructure/ Drizzle, postgres.js, config, migrations. Implements the ports
tests/fixtures/         Frozen golden and adversarial data
tests/integration/      Real PostgreSQL 18 contracts
tests/unit/             Cross-cutting unit tests (the AD-1 boundary check)
tests/e2e/              Playwright journeys
.github/workflows/      ci.yml (PR gate) and release.yml (the only migrator)
.railway/railway.ts     Declared Railway shape; validated only by `railway config plan`
_bmad/                  BMAD install: config, manifests, shared Python scripts (installer-managed, read-only)
_bmad-output/           Everything the planning workflow produces (the real work product)
  planning-artifacts/
    briefs/             Product brief
    prds/               PRD + addendum + reviews + .memlog.md
    ux-designs/         UX handoff
    architecture/       Architecture spine + reviews
  implementation-artifacts/  Epic context, per-story specs, sprint status
.claude/skills/         49 BMAD skills as rendered for Claude Code
.agents/skills/         Byte-identical copy of the same skills (IDE-neutral path)
.github/agents/         Thin GitHub Copilot stubs that forward into .agents/skills/
```

Each planning-artifact folder is named `<type>-IntelliFin Audit-<date>/` — **the name contains a space**. Quote every path.

## The planning chain and its state

```
brief → PRD (+addendum) → UX handoff → architecture spine → epics/stories → sprint → build
```

Each stage carries a `.memlog.md` (append-only decision log) and, when reviewed, `review-*.md` / `recheck-*.md` files. Check a document's frontmatter `status` (`draft` or `final`) and `revision` before trusting it. A downstream artifact derived from an earlier revision is stale until re-derived; the PRD's §0 says which ones.

The PRD is the source of truth for product decisions. `prd.md` holds requirements (FR-n, NFR-n, SM-n); `addendum.md` holds normative detail (state models, Evidence Quality Gate rules, Template contracts, golden-dataset seeds, FR migration map). Read both.

## Commands

BMAD scripts run with `uv` and need Python 3.11+. Run them from the repository root.

```bash
# Resolve a skill's customization (what a skill reads on activation)
uv run _bmad/scripts/resolve_customization.py --skill .claude/skills/bmad-prd --key workflow

# Resolve the central config layers
uv run _bmad/scripts/resolve_config.py

# Append to a workspace memlog (never edit .memlog.md by hand)
uv run _bmad/scripts/memlog.py append --workspace "<artifact folder>" --type <decision|change|override|assumption|event> --text "<one line, reason included>"

# Run one skill's Python tests (tests declare their own deps via PEP 723 headers)
uv run --with pytest --with ruamel.yaml pytest .claude/skills/bmad-sprint-planning/scripts/tests/test_sprint_plan.py

# Run a single test
uv run --with pytest --with ruamel.yaml pytest ".claude/skills/bmad-review/scripts/tests/test_word_metrics.py::test_name"

# All skill tests
uv run --with pytest --with ruamel.yaml pytest .claude/skills/*/scripts/tests
```

### Monorepo commands

Node 24.20.0 and pnpm 11.25.0 exactly. Run `nvm use` (reads `.nvmrc`) then `corepack enable` first; `engine-strict` is on, so another Node major fails the install.

```bash
pnpm install                 # workspace install (--frozen-lockfile in CI)
pnpm -r typecheck            # per-package tsc --noEmit
pnpm boundaries              # AD-1 dependency-cruiser check
pnpm test                    # Vitest unit tests, no database needed
pnpm test:integration        # needs DATABASE_URL and a migrated PostgreSQL 18
pnpm db:migrate              # needs DATABASE_URL; release/CI only, never at startup
pnpm db:generate             # writes a new Drizzle migration; needs DATABASE_URL
pnpm build                   # packages then worker
pnpm dev                     # builds packages, then Next.js dev for apps/web
```

There is no lint step yet.

## Working with BMAD skills

- Invoke skills by name (`/bmad-prd`, `/bmad-architecture`, `/bmad-review`, ...). Deprecated names (`bmad-create-prd`, `bmad-editorial-review`, ...) forward to the current skill.
- Skills spawn subagents for reviews and reconciliation. Each reviewer writes its full report to a file in the artifact folder and returns only a summary; the main thread never holds full review text.
- Every product decision made during a skill run is logged to the artifact's `.memlog.md` via the script above, in the same turn it is made.
- `_bmad/config.toml`, `_bmad/config.user.toml`, and `_bmad/_config/*` are installer-managed. Do not edit; override in `_bmad/custom/config.toml` instead.

## Codebase decisions and gotchas

- **Bash `cd` persists between calls.** Use absolute paths or `...`; a relative path after an earlier `cd` will miss.
- **Planning-artifact folders have a space in the name.** Always quote paths under `_bmad-output/`.
- **Memlog writes go through `memlog.py` only.** Hand edits break the append-only guarantee the resume logic depends on.
- **Reviews are files, not chat.** Reviewer subagents write `review-<slug>.md` / `recheck-<slug>.md` next to the artifact and return a summary; the parent reads the file only when drilling into a finding.
- **Revising an upstream artifact invalidates downstream ones.** After a PRD revision, the architecture spine and UX handoff must be re-derived; say so in the PRD §0 and in the PR.
- **`.claude/skills` and `.agents/skills` are copies, not symlinks.** A change to a skill must be made in both, or re-rendered by the installer.

### Monorepo (added with Story 1.1)

- **Node 24.20.0 and pnpm 11.25.0 are hard pins.** `.nvmrc` + `engine-strict=true`. Run `nvm use && corepack enable` before any `pnpm` command; Node 22 fails the install on purpose.
- **pnpm 11 blocks dependency build scripts.** The allowlist lives in `pnpm-workspace.yaml` under `allowBuilds:` (a name-to-boolean map). The pnpm 10 keys `pnpm.onlyBuiltDependencies` in `package.json` and `onlyBuiltDependencies:` in the workspace file are silently ignored.
- **Root pins `typescript@6.0.3`, packages pin `typescript@7.0.2`.** dependency-cruiser 18.2.0 cannot use the TypeScript 7 API; with 7 at the root it cruises zero modules and exits 0. Verified twice (2026-09-02): a first TS 7 test only looked green because pnpm had left the old 6.0.3 peer linked. `pnpm boundaries` now runs `scripts/check-boundaries.mjs`, which fails on a zero-module cruise. Drop the root pin only when dependency-cruiser supports TS 7.
- **Keep `node_modules` out of dependency-cruiser's `exclude`.** Excluded paths are not rule-checked, so excluding `node_modules`, a bare `dist/`, or a bare `\.d\.ts$` silently hides vendor imports whose entry point lives there and disables the AD-1 vendor rules. `doNotFollow` is the right knob; `exclude` is scoped to `^(apps|packages)/`.
- **Workspace packages export TypeScript source for types and `dist` for runtime.** Typecheck and Vitest work from a fresh clone with no build; anything that actually runs (`apps/worker`, Docker images) must run `pnpm build` first.
- **`pnpm db:migrate` runs `packages/infrastructure/src/db/migrate.ts` over postgres.js, not `drizzle-kit migrate`.** drizzle-kit connects with `pg`, which treats `sslmode=require` as `verify-full` and so rejects Railway's self-signed certificate with `SELF_SIGNED_CERT_IN_CHAIN`; its progress spinner also overwrites the driver's error, so the release log said only "Exit status 1". CI now runs the Railway `postgres-ssl:18` image with `sslmode=require` so this fails in CI, not in a release.
- **Migrations are release-only (AD-15).** Never call `drizzle-kit migrate` from app code or a startup path. `packages/infrastructure/drizzle/0001_worker_heartbeat.sql` also seeds `schema_meta.version = 1`; bump that with the next generation.
- **`packages/domain` and `packages/application` deliberately omit `types: ["node"]`.** Without the Node ambient types, `process.env` does not typecheck there at all — the AD-11 "no ambient env inward" rule is enforced by the compiler, not only by dependency-cruiser. Do not add `types: ["node"]` to either tsconfig to silence an error; move the code that needs the environment into a composition root or `packages/infrastructure/src/config.ts`.
- **dependency-cruiser rule patterns must not nest quantifiers.** It runs every `path` regex through a catastrophic-backtracking check and, on a hit, rejects the entire rule set — the cruise then exits non-zero with "Bailing out" and no rule is actually evaluated. Prefer several simple patterns in a `path` array over one clever combined regex.
- **Never `exclude` `node_modules` in `.dependency-cruiser.cjs`.** An excluded path is not rule-checked, so excluding it (or a bare `dist/` or `\.d\.ts$`) silently hides vendor imports whose entry point lives there and disables the AD-1 vendor rules. `doNotFollow` is the right knob; `exclude` stays scoped to `^(apps|packages)/`.
- **`.railway/railway.ts` is never compiled here.** `railway` is not a workspace dependency, so no typecheck, boundary check, or test touches that file. Its only validation is `railway config plan`.

### Audit events and telemetry (added with Story 1.2)

- **The audit hash input is `previous_hash_bytes || RFC 8785 canonical JSON`, hashed once with SHA-256.** The canonical envelope has exactly eleven keys (`actor`, `aggregateId`, `correlationId`, `eventId`, `eventType`, `occurredAt`, `outcome`, `payload`, `sequence`, `sessionId`, `source`) and deliberately excludes both hashes. Never feed a caller-shaped `JSON.stringify` to the hash; `canonicalizeAuditEvent` in `packages/domain/src/audit-event.ts` is the only canonicalizer. `tests/fixtures/audit-chain-golden.json` was produced independently with Python `rfc8785` + `hashlib`; re-verify against a non-TypeScript implementation if the envelope ever changes.
- **Sequences come from a locked `audit_event_heads` row, never from a sequence object.** The append does `INSERT ... ON CONFLICT DO NOTHING` then `SELECT ... FOR UPDATE`; PostgreSQL makes the conflicting insert wait for the in-flight transaction, so two first appends to one aggregate still get 1 then 2. Events with no natural aggregate chain under `platform`.
- **Do not add `pino` or `@sentry/node` to `serverExternalPackages` in `apps/web/next.config.ts`.** They are dependencies of `@intellifin/infrastructure`, not of `apps/web`. Under pnpm's isolated `node_modules` an externalized `require` from `.next/server` cannot resolve them. Next must keep bundling them through `transpilePackages`.
- **`drizzle-kit generate` needs `DATABASE_URL` set but never connects.** Any syntactically valid URL is enough to run the CI drift check locally.
- **`next build` cannot run from a path containing a space on Windows.** Turbopack fails to canonicalize the percent-encoded path. It is unrelated to app code; the web image is built in CI on Linux.
