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
- **The supported schema range is a build constant, never an environment variable.** `SUPPORTED_SCHEMA_MIN`/`SUPPORTED_SCHEMA_MAX` in `packages/infrastructure/src/db/compat.ts`. As `SCHEMA_RANGE_MIN`/`SCHEMA_RANGE_MAX` it drifted: the Story 1.2 release migrated production to generation 2 while Railway still declared `1..1`, so web refused to start against a database its own release had just migrated, and the deploy failed its healthcheck. An image ships a fixed set of migrations, so only the image knows what it supports. **A new migration must raise `SUPPORTED_SCHEMA_MAX` in the same commit**; `db/schema-range.test.ts` reads the migrations and fails when the two disagree.
- **`.railway/railway.ts` declares the intended shape; it does not apply it.** Railway variables are live state, changed in the dashboard or through the connector. Anything that must not drift between them belongs in code, not in `env:`.
- **`.railway/railway.ts` is never compiled here.** `railway` is not a workspace dependency, so no typecheck, boundary check, or test touches that file. Its only validation is `railway config plan`.

### Audit events and telemetry (added with Story 1.2)

- **The audit hash input is `previous_hash_bytes || RFC 8785 canonical JSON`, hashed once with SHA-256.** The canonical envelope has exactly eleven keys (`actor`, `aggregateId`, `correlationId`, `eventId`, `eventType`, `occurredAt`, `outcome`, `payload`, `sequence`, `sessionId`, `source`) and deliberately excludes both hashes. Never feed a caller-shaped `JSON.stringify` to the hash; `canonicalizeAuditEvent` in `packages/domain/src/audit-event.ts` is the only canonicalizer. `tests/fixtures/audit-chain-golden.json` was produced independently with Python `rfc8785` + `hashlib`; re-verify against a non-TypeScript implementation if the envelope ever changes.
- **Sequences come from a locked `audit_event_heads` row, never from a sequence object.** The append does `INSERT ... ON CONFLICT DO NOTHING` then `SELECT ... FOR UPDATE`; PostgreSQL makes the conflicting insert wait for the in-flight transaction, so two first appends to one aggregate still get 1 then 2. Events with no natural aggregate chain under `platform`.
- **Do not add `pino` or `@sentry/node` to `serverExternalPackages` in `apps/web/next.config.ts`.** They are dependencies of `@intellifin/infrastructure`, not of `apps/web`. Under pnpm's isolated `node_modules` an externalized `require` from `.next/server` cannot resolve them. Next must keep bundling them through `transpilePackages`.
- **`drizzle-kit generate` needs `DATABASE_URL` set but never connects.** Any syntactically valid URL is enough to run the CI drift check locally.
- **`next build` cannot run from a path containing a space on Windows.** Turbopack fails to canonicalize the percent-encoded path. It is unrelated to app code; the web image is built in CI on Linux.

### Forms and controls (added with Story 1.5)

- **Every `<form>` names its `method`, and a control that mutates state never depends on JavaScript alone.** Three times now the same defect shipped: the sign-in form had no `method`, so a submission beating hydration would have put the password in the URL; the sign-out control was an `onClick` that fetched, so a click before hydration did nothing at all and looked like success; `UserForm` then repeated the sign-in mistake with a new user's initial password. A form with no method submits as a GET, and whatever was typed lands in history, the Referer header and every access log. `apps/web/src/form-method.test.ts` scans every `.tsx` and fails on a form without one. JavaScript may enhance a control; it may never be the only path.
- **A Server Action authorizes for itself.** It is a separate POST endpoint Next exposes by id, so reaching the page that renders it is not a precondition for invoking it. The page's `requireServerAction` protects the page; each action calls it again before reading input.
- **An object lookup keyed by request input needs `Object.hasOwn`.** `ACTION_RULES['constructor']` returned `Object.prototype.constructor` and threw where a denial belonged; `SECTION_LABELS['toString']` made a function into a breadcrumb label. A plain-object index is not a map.
- **Never assert a contract against a copy of itself.** Denial strings, ribbon copy and empty-state sentences are read from the UX artifacts on disk; badge treatments are checked against the stylesheet, not the module that lists them. A test comparing a file with itself proves only that the file agrees with itself.

### Identity and roles (added with Story 1.3)

- **The role never comes from Better Auth and is never cached.** Better Auth establishes identity and session only; the role lives in the application-owned `user_role` table and `DrizzleRoleRepository.findRole` reads it on every request. A role in a cookie, a JWT claim, or an in-memory map survives its own revocation, which AD-7 forbids. `GET /api/session` is the observable proof: delete the row and the next call reports `role: null` while the session row stays.
- **Route protection is default-deny with one explicit allowlist.** `apps/web/src/route-access.ts` is the only place a path becomes public (`/sign-in`, `/api/health`, `/api/auth/**`, Next static output, root files). `apps/web/middleware.ts` is the outer gate and can only see whether a session cookie exists; the real decision is `requireAction` in `apps/web/src/require-role.ts`, which resolves the session, reads the role, applies the domain policy, and audits the refusal. Adding a route family needs no change here — it is protected already.
- **The gating table lives in `packages/domain/src/identity/roles.ts` and nowhere else.** The five denial strings are copied character-for-character from EXPERIENCE.md "Roles and Action Gating"; every unspecified cell says `Your role does not permit this action.` `roles.test.ts` checks all 24 actions x 3 roles. FR-2's "cannot approve a version they authored" is scoped to `procedure.version.approve`; rejecting one's own version stays allowed.
- **An email address cannot be an audit `actor.id`.** `SAFE_ID_PATTERN` excludes `@`. A failed sign-in for an unknown address records `actor.id: 'unknown'` with `payload.subjectHash` = SHA-256 of the lower-cased address; a known address records that user's id. The address itself never enters the chain.
- **A sign-in that cannot be audited is undone.** `apps/web/src/sign-in-route.ts` appends `security.sign-in` before returning the cookie; if the append fails it deletes the session row and answers 503. Every failed attempt is rewritten to one 401 and one sentence, so an unknown address and a wrong password are indistinguishable; a 429 keeps its status and says so, because a rate limit tells nobody whether a user exists.
- **`instrumentation.ts` must stay edge-safe.** Adding `middleware.ts` made Next compile `instrumentation.ts` for the edge runtime as well. The Node-only work lives in `apps/web/src/boot.ts` behind a dynamic import inside the `NEXT_RUNTIME === 'nodejs'` branch; a top-level import of the infrastructure barrel there pulls postgres.js, Pino and `process.exit` into the edge bundle. Next 16 also warns that the `middleware` file convention is deprecated in favour of `proxy`; the spec names `middleware.ts`, so it stays until a story moves it.
- **`apps/web` uses extensionless relative imports.** Its tsconfig is `moduleResolution: bundler`; a `./telemetry.js` specifier typechecks but fails `next build` with "Module not found".
- **Users are created by `pnpm seed:identity` only.** Better Auth has `disableSignUp: true`, so the running application has no sign-up endpoint at all; `createSeedAuth` is the one instance that can create a user and only the operator script constructs it. The password comes from `SEED_PASSWORD` in the environment, never from an argument.
- **`next.config.ts` sets `agentRules: false`.** Without it `next dev` writes its own `AGENTS.md` and `CLAUDE.md` into `apps/web`; this repository already owns both names for the agent block and this decision log.
- **A production web build refuses a plain-http `BETTER_AUTH_URL`.** Better Auth marks the session cookie `Secure` only for an https origin, so `loadConfig` rejects http when `NODE_ENV` is production — which Next's standalone server sets for itself. `http://localhost` works under `pnpm dev` only; the CI smoke container passes a placeholder `https://` origin it never has to resolve.
- **Sign-in rate limiting is declared explicitly and stored in PostgreSQL.** Better Auth's default limiter is off outside production and counts in process memory; `/api/auth/**` is the only publicly allowlisted surface and the deployment can run more than one container, so `auth_rate_limit` (generation 3) holds the counters and the rules are stated in `identity/auth.ts`.
- **The middleware matcher is `/(.*)` and decides nothing.** A negative lookahead there is a second allowlist in another language that nothing tests, and it fails exactly as a slash-less prefix does — `(?!_next/image)` also skips `/_next/imagery`. `isPublicPath` is the only allowlist.
- **The root `package.json` links `@intellifin/domain` and `@intellifin/infrastructure` as devDependencies.** Without them `scripts/*.mts` cannot resolve the workspace packages under pnpm's isolated `node_modules`.

### Application shell and Ledger Signal tokens (added with Story 1.4)

- **The design system is built here, under the parent's names.** DESIGN.md inherits the IntelliFin Design System bundle, which lives in the Business Suite repository and is not in this one, so it restates every token value it needs. `apps/web/src/design/` therefore implements Sidebar, Button, StatusBadge, Banner, EnvironmentRibbon, EmptyState, Tabs and Icon locally under exactly those names, which keeps a later swap to the real bundle an import change rather than a rewrite.
- **`ux-designs/.../DESIGN.md` is the token source; `ux-designs/.../claude/DESIGN.md` is superseded.** The `claude/` copy is the pre-revision-2 prototype contract — four state families, no `info-solid`, two dialog weights, two breakpoints. Never read it as a contract. Between the two live spines, behaviour and copy follow EXPERIENCE.md and visual values follow DESIGN.md; both beat the prototype mockup.
- **Token values live in `apps/web/app/tokens.css` and nowhere else.** Names are mechanical: `colors.<k>` → `--color-<k>`, `typography.<role>.<prop>` → `--type-<role>-<kebab>`, `rounded.<k>` → `--rounded-<k>`, `spacing.<k>` → `--spacing-<k>`. `src/design/tokens.test.ts` parses DESIGN.md's frontmatter and this file and fails on any drift; it also fails if `globals.css` restates a documented hex instead of referencing the token.
- **The status vocabulary is data, not markup.** `src/design/status.ts` holds all nine DESIGN.md rows; `StatusBadge` takes only a family and a state and derives the word, treatment and icon, so a badge without an icon or with an unknown state cannot be written. `status.test.ts` reads the markdown table off disk, so a transcription error fails rather than looking plausible.
- **Hiding a nav item is presentation; it is never the control.** The sidebar removes Administration for non-administrators via `authorizeAction`, and `app/administration/page.tsx` independently calls `requireAction` — the first production caller of the audited authorization path. Adding a privileged surface means adding the server-side call, not only hiding the link.
- **Server components reach the session through `apps/web/src/server-session.ts`.** `require-role.ts` takes a `Request` and must stay free of `next/headers` so its unit tests run under plain Node; `server-session.ts` builds a `Request` from the incoming headers and delegates. One decision path, two entry points.
- **A disabled action is `aria-disabled`, not `disabled`.** A `disabled` element cannot be focused, so its accessible description is unreachable by keyboard — which turns the required reason into the tooltip-only explanation DESIGN.md forbids. `Button` refuses activation in its handler instead, and `UnavailableActions` renders the same sentence visibly, sharing one DOM node through `disabledReasonId`.
- **The focus ring is declared once, in `globals.css`, and components have no stylesheet to suppress it in.** It is `#0F766E` everywhere, and the rule sets outline and offset only — a `border-radius` there changes every control's corner shape on focus. Inside the navy sidebar the offset is 0 and a 4px white shadow sits BEHIND the outline, so white shows at 2-4px, outside the ring: with the default 2px offset the ring is drawn at 2-4px and a white band at 0-2px sits between element and ring, leaving the ring's outer edge against navy at 2.7:1. For the same contrast reason the active nav marker on that one dark surface is `--color-teal-500`, not `--color-teal`.
- **Playwright runs `next dev`, never a production build.** A production build sets `NODE_ENV=production`, where `loadConfig` refuses the plain-http `BETTER_AUTH_URL` the suite serves on. Run `pnpm build` first: the dev server and `pnpm seed:identity` both resolve workspace packages through their `dist` output.
- **`pnpm test:e2e` needs a migrated PostgreSQL 18 and the two seeded accounts.** `E2E_AUDITOR_EMAIL`, `E2E_ADMIN_EMAIL` and `E2E_PASSWORD` name them; CI's `e2e` job migrates, seeds and installs Chromium before running. A WCAG 2.1 AA violation fails the pull request and there is no allowlist of accepted violations.
- **`text-muted` is for `surface-card` and `surface-page` only.** DESIGN.md scopes it, and the arithmetic agrees: on `surface-sunken` it is 4.39:1, under AA. An `aria-disabled` control is live text, so the disabled button writes in `text-secondary` (6.9:1).
- **`/badges` is unlinked on purpose.** It renders every badge in the vocabulary plus one live instance of each component, so axe has something to scan and the dialog specs have a dialog to open. It is protected by default-deny like every other route, and everything on it below the vocabulary is labelled illustrative.
- **Any object lookup keyed by request input needs `Object.hasOwn`.** A plain `MAP[key]` inherits from `Object.prototype`, so `key = 'toString'` or `'constructor'` returns a function and the code carries on with it. This has now bitten three times: `ACTION_RULES[action]` in the gating policy (Story 1.3), and `SECTION_LABELS[segment]` in the breadcrumbs (Story 1.4, where the segment comes straight from the URL bar). Guard the lookup, or use a `Map`.
- **`decodeURIComponent` throws on a malformed escape.** `/runs/%E0%A4%A` is a URL anybody can type; unguarded, the URIError takes down every page under the shell. Wrap it and fall back to the raw text — `readableSegment` in `apps/web/src/shell/breadcrumb-rules.ts`.
- **Copy quoted from the UX contract lives in `apps/web/src/design/copy.ts`.** A sentence typed inline in a component is pinned against nothing: the component and its test get retyped together and both drift from DESIGN.md. `copy.test.ts` reads DESIGN.md and EXPERIENCE.md off disk and requires each string character for character, the way `tests/unit/denial-strings.test.ts` does for the refusal strings.
- **A variant name needs a rule that paints it.** `status.test.ts` proves the vocabulary matches the contract and `tokens.test.ts` proves the values do; neither notices a missing class. Delete `.ls-badge--danger-outline` and four states render as plain text with the suite green. `stylesheet.test.ts` reads `globals.css` and requires a rule for every badge treatment, banner tone, button variant and shell class.
- **`aria-disabled`, never `disabled`, on an action with a reason.** A `disabled` element cannot be focused, so its `aria-describedby` reason is unreachable by keyboard — the tooltip-only explanation DESIGN.md forbids. `Button` refuses activation in its handler; `shell.spec.ts` clicks one to prove it.
- **`aria-modal` stops nothing on its own.** `ConfirmDialog` portals to `<body>`, sets `inert` on `#ls-app`, locks body scroll, and binds its key handler to `document` — a handler on the scrim element stops firing the moment a backdrop click moves focus to `<body>`, which silently breaks Escape.
- **Playwright specs sign in twice, in `auth.setup.ts`, and reuse the state.** `/sign-in/email` is rate limited to ten attempts a minute and the limiter is real production behaviour; a suite that signs in per test spends the budget and then fails on its own load. `E2E_PASSWORD` has no default, deliberately.
- **The suite must use `localhost`, never `127.0.0.1`.** Next's dev server blocks cross-origin requests to its own dev resources and does not treat the two spellings as one host: the browser is refused `/_next/hmr`, the client runtime never boots, and every page renders server-side only with no button working.
- **`pnpm -r typecheck` skips the workspace root.** `playwright.config.ts`, `scripts/` and everything under `tests/` live there, so the root `pnpm typecheck` script runs `tsc -p tsconfig.root-tests.json` after it, and CI calls the root script. That config was `tsconfig.e2e.json` and covered `tests/e2e/` alone, so `tests/unit/` and `tests/integration/` were typechecked by nothing at all — the root also has to link every workspace package those suites import, or the import resolves to nothing and the file is silently unchecked.

### Managing users and roles (added with Story 1.5)

- **A Server Action needs its own authorization check.** Next exposes each Server Action as its own POST endpoint addressed by an id that appears in the client bundle, so reaching the page it was written beside is not a precondition for invoking it. `app/administration/page.tsx` protects the page and nothing else; `app/administration/actions.ts` calls `requireServerAction` FIRST, before it reads any input, and `actions.test.ts` asserts the refusal against the action rather than the page. A validate-then-authorize action also tells a caller who may not act what the input contract is.
- **A user is created by an audited command, never by a public endpoint.** `disableSignUp: true` stays on the mounted Better Auth instance; `createSeedAuth` is the only instance that can create an account, and `BetterAuthUserCreator` builds it server-side behind `administration.users.manage`. `tests/integration/manage-users.test.ts` re-asserts that the mounted handler still refuses `POST /api/auth/sign-up/email`, because the seed instance is what every other test constructs.
- **Better Auth 1.7.2 answers a duplicate-address sign-up with a fabricated user.** No row is written, no error is raised, and `created.user.id` is a fresh id that exists nowhere — deliberate user-enumeration protection on a public endpoint, and a trap for an administrative one. `BetterAuthUserCreator` therefore checks the address before and re-reads the returned id after, and only a row that is really there counts as created. Never trust `signUpEmail`'s answer on its own.
- **A state change and its audit event share one transaction, through `PostgresIdentityUnitOfWork`.** It hands the command an `IdentityUnitOfWorkContext` in which the audit appender, `DrizzleRoleWriter`, `BetterAuthUserCreator` and `DrizzleSessionWriter` are all bound to the same handle, so there is no reachable writer outside the transaction. Better Auth joins it because the Drizzle adapter uses whatever handle it is given: `createSeedAuth(tx as unknown as Database, config)` puts the account rows inside the transaction and a rollback removes them.
- **A refusal returned from inside a unit of work COMMITS.** Everything written before it survives. `manage-users.ts` throws a private `CommandRefused` instead and converts it to a refusal outside the callback — the only way to say "this did not happen" to PostgreSQL as well as to the caller.
- **The prior role an event records is read inside the write's transaction.** A read through the pool can be answered by a snapshot the write is about to invalidate, so the chain would name a transition that never happened. `RoleWriter` carries `findRole` for exactly this.
- **Role events carry both `priorRole` and `newRole`, and `null` is a value.** A first assignment records `priorRole: null`; a revocation records `newRole: null`. The subject is a user id — an email address cannot enter the chain, and `SAFE_ID_PATTERN` has no `@`.
- **`user_role.assigned_by` is a real foreign key from generation 4, `ON DELETE SET NULL`.** `CASCADE` there would delete a role when the administrator who granted it is deleted, which is a silent privilege revocation nothing audited.
- **`DataTable`'s first-cell `href` is optional.** EXPERIENCE.md's rule is "every row's first cell is a link; no row-level click handlers", and its purpose is that a row must never be a click target a keyboard cannot reach. A table with no detail surface — the user list — satisfies it by having no target; inventing an `href` to a page that does not exist would satisfy the letter and send people to a 404. The structural guarantee is unchanged: there is no `onRowClick` prop.
- **One surface, one Banner.** `UsersPanel` owns the banner and both controls report into it. A banner per control is several live regions racing to announce the same kind of thing.
- **Sign-out revokes the session row itself, in the audit transaction.** Better Auth's own `/sign-out` commits on its own connection, so it cannot be atomic with the event. `apps/web/src/sign-out-route.ts` intercepts `POST /api/auth/sign-out`, runs `signOut` through the identity unit of work, and clears the cookies itself. If the event cannot be appended the session stays live and the caller gets a 503 — the only fail-closed direction a sign-out has.
- **A control that ends a session or mutates state must not depend on hydration.** Sign-out shipped first as a `fetch` inside an `onClick`: a click before React hydrated was swallowed — no request, no navigation, no message — so a person at a shared workstation walked away believing the session ended, and the browser test caught it only when it happened to click inside that window. It is now a real `<form method="post" action="/api/auth/sign-out">` the browser submits itself, answering a **303** to `/sign-in`; the route is idempotent, so a double submit, a resubmitted form or a second tab meets the same redirect rather than a 500. The remaining JavaScript is a double-submit guard that never prevents the first submission. `tests/e2e/administration.spec.ts` runs the journey in a context with `javaScriptEnabled: false` — the assertion that fails every time rather than sometimes.
- **A `<form>` with no `method` submits as a GET.** Any credential in it then lands in the URL, in browser history and in every access log. `sign-in-form.tsx` and `admin/UserForm.tsx` both carry `method="post"` for exactly this, even though both prevent the native submission once hydrated: the guard is for the submission that beats hydration. A POST to a page route has no handler and answers 405, which discloses nothing.
- **Sign-in and the administration mutations still require JavaScript, deliberately.** Both fail SAFE and visibly — a sign-in that does nothing leaves you on the sign-in page, and an administration mutation that does nothing shows no Banner and no changed row — which is the opposite of the sign-out defect, where nothing happening looked like success. The administration controls cannot be made to work without script at all: EXPERIENCE.md requires a focus-trapping confirmation dialog on every administration mutation. Sign-in could be made to work server-side and is worth a later story; it would mean a POST route reproducing the non-disclosure and rate-limit rules `handleAuthRequest` owns.
- **`auth.setup.ts` clears `auth_rate_limit` before the browser suite runs.** `/sign-in/email` allows ten attempts a minute and a full run spends six. CI gets a fresh database each time, but two local runs inside a minute make the second inherit the first's budget and fail on a real production rule — which reads as flakiness and is not. The limiter stays fully enabled during the run and `sign-in.spec.ts` still exercises it; only the spend carried between runs is removed.
- **Telemetry messages are an allowlist.** `TELEMETRY_MESSAGES` in `packages/infrastructure/src/telemetry/sentry.ts` is a closed union; a new `telemetry.info`/`captureError` message must be added there or it will not typecheck.
- **The unit suite now includes `apps/**/app/**/*.test.ts`.** Route handlers and Server Actions live under `app/`, not `src/`, and each is its own endpoint.

### Story 1.5 review findings (applied 2026-09-02)

- **A surface that grants roles must not be able to remove the last holder of one.** `setUserRole` refuses a self-role-change, and refuses any change that would leave zero `poc-administrator` rows. Both are enforced in the command; the disabled buttons are courtesy. The count is taken INSIDE the transaction and AFTER the write, behind a `SELECT ... FOR UPDATE` over the holders taken BEFORE it — because under READ COMMITTED two administrators demoting each other each see their own uncommitted write and count one remaining, and both commit into a deployment nobody can administer. Recovery would be shell access and `pnpm seed:identity`.
- **A lock that serializes must be taken in a deterministic order.** `DrizzleRoleWriter.lockHolders` orders by `user_id`; two callers locking the same set in different orders deadlock instead of queueing.
- **A concurrency test that starts two calls at once proves nothing.** They finish quickly enough that one commits before the other reads, and the test passes with the guard removed. `tests/integration/manage-users.test.ts` wraps the unit of work so the first transaction is held OPEN after its work and before its commit, and runs the second inside that window. Verified by removing the lock and watching it fail.
- **Never build a redirect `Location` from `request.url` or `request.nextUrl`.** Behind a proxy the host comes from the client's `Host` header, so a forged one redirects the browser to an attacker's origin — worst of all on the sign-out and sign-in-redirect paths, where the person arrives looking for somewhere to type a password. A relative `Location` is valid (RFC 9110 §10.2.2) and browsers resolve it against the origin they connected to. `middleware.ts` therefore does not use `NextResponse.redirect`, which requires an absolute URL.
- **`/api/auth/**` is an allowlist of three endpoints.** Better Auth mounts many more, and probing the real handler found `revoke-session`, `revoke-sessions`, `revoke-other-sessions`, `update-user`, `change-password`, `change-email`, `delete-user` and `reset-password` all live on the one publicly allowlisted path family, none audited — each ending a session or changing an identity with nothing in the chain. `SERVED_AUTH_ENDPOINTS` in `apps/web/src/sign-in-route.ts` names `sign-in/email`, `sign-out` and `get-session`; everything else answers 404 before the runtime is touched. An allowlist, not a denylist, so a dependency upgrade cannot mount a new endpoint into production unnoticed.
- **A Server Action's argument is untrusted, whatever its TypeScript type says.** `CreateUserFields` is a comment as far as a hand-made POST is concerned: `null`, a number or a missing field reaches `.trim()` and answers a framework 500 to the caller most likely to be probing. `actions.ts` checks shape and bounds length at the boundary — email 254, name 200, password 128, the last because scrypt cost is paid by this process and an unbounded password is unbounded cost bought with one request.
- **A refusal returned from inside a unit of work commits; a refusal thrown rolls back.** Already true of `CommandRefused`; the last-administrator and stale-role guards use the same mechanism because both fire after a write.
- **`Object.hasOwn` for any lookup keyed by request input — fourth occurrence.** `roles.ts` `roleLabelOfValue` took a `<select>` value straight into `ROLE_LABELS[...]`, where `'constructor'` returns an inherited function instead of the fallback. Previous three: `ACTION_RULES`, `SECTION_LABELS`, `ICON_GLYPHS`.
- **A guard needs its own tests, and mutation testing is how you get them.** `form-method.test.ts` asserted `/\bmethod=/`, so `method="get"` passed — the exact defect it existed to prevent — and its `<form\b[^>]*>` pattern truncated at the `=>` of a JSX handler. It now requires `post`, parses the tag brace- and quote-aware, scans `.ts` as well as `.tsx` (a route handler can emit raw HTML, and `sign-out-route.ts` does), and wraps `statSync` so a broken symlink cannot fail the suite.
- **Never assert a response equals the function that produced it.** `sign-out-route.test.ts` compared its cookies with `clearedSessionCookies()`, which proves only that the function was called. The attributes are checked one by one, `Path=/` included: `Path=/api/auth` would leave the session cookie in place on every page with every other assertion green.
- **Better Auth's session-cookie check comes before the database.** `handleSignOut` answers a caller with no session cookie from memory. `/api/auth/**` is publicly allowlisted and this handler intercepts before Better Auth's rate limiter sees the path, so sign-out is not rate limited; without the check every anonymous POST would cost a connection. An authenticated flood limits itself, because the first call deletes the session.
- **Do the risky work inside the route's own `try`.** `handleSignOut` acquired the runtime and resolved the session outside it, so a database outage threw through the route and the caller got a framework 500 instead of the fail-closed page written for that case.
- **The integration suite creates session rows directly instead of signing in.** `/sign-in/email` allows ten attempts a minute and that limiter is real production behaviour stored in PostgreSQL; six sign-ins from one file plus eight from another exceed it and the second file fails on a limiter doing its job. Only the one case that needs a signed Better Auth cookie signs in. Files clean up their own rows — scoped by an address prefix and a correlation-id prefix — and never `DELETE FROM audit_events` wholesale, which would leave `audit_event_heads` pointing past the rows that remain.
- **A test that writes to a database must refuse a database it does not recognize.** `assertThrowawayDatabase` in `tests/e2e/accounts.ts` allows loopback, a container hostname or CI; anything else refuses rather than wiping a real deployment's rate-limit counters.
- **The administrator sets every initial password, and nothing forces a change — an accepted risk.** There are no invite emails and no reset flow because this deployment sends no mail, so a PoC Administrator holds a working credential for every account they create. "PoC Administrator cannot author Procedures" is therefore a policy boundary, not a cryptographic one. Recorded in the spec's Design Notes rather than solved: a forced first-sign-in change needs a password-change command, its own event, and a gate on every surface. What is guaranteed is narrower — the password is never stored, logged, audited, echoed or placed in a URL, and the field is cleared as soon as it is used.
- **Better Auth's `signUpEmail` is not a constraint, and neither is a pre-check.** Generation 4 adds `auth_user_email_lower_uidx` on `lower(email)`, because the column's own unique index is case-sensitive and two concurrent creates of `Dana@x` and `dana@x` both pass any check. `BetterAuthUserCreator` maps SQLSTATE 23505 anywhere in the error's `cause` chain to the same "already has an account" refusal.
- **Build a privileged object only where it is used.** `PostgresIdentityUnitOfWork` constructed `createSeedAuth` — the one sign-up-capable instance — on every identity transaction, including every sign-out and every `security.denied` append. It is built lazily, only when a command actually creates a user.
- **A migration that adds a foreign key validates every existing row.** One non-matching value fails the whole migration and with it the release, so generation 4 runs a `UPDATE ... SET assigned_by = NULL WHERE ... NOT IN (SELECT id FROM auth_user)` first. It clears nothing today; it is there so data written before the column had a meaning cannot stop a release.
- **A branch nothing exercises is a branch that can be inverted silently.** `DataTable`'s first cell became a link-or-text ternary for the user list; `shell.spec.ts` now asserts the link arm on `/badges`, or inverting the ternary would turn every first cell in the product into plain text with a green suite.
- **One Banner, cleared on the next mutation and keyed by a counter.** A stale success sitting through the next attempt describes a change that is no longer in front of the person, and a live region whose text does not change is not re-announced — so two identical failures would be silent after the first. `sign-in-form.tsx` uses the same attempt counter for the same reason.
- **A glob that cannot match is a promise of coverage that does not exist.** `vitest.config.ts` briefly included `apps/**/app/**/*.test.tsx` in a `node` environment with no DOM and no such file.

### Target System registrations (added with Story 1.6)

- **There is one RFC 8785 canonicalizer, and it is `packages/domain/src/canonical-json.ts`.** `canonicalJson` was private inside `audit-event.ts` until the registration digest needed the same bytes. Both digests import it. Two copies would agree on every value anybody thought to try and diverge on the first one nobody did — an escaped lone surrogate, a `-0`, an integer past 2^53 — and each would look correct because each would be checked only against itself.
- **`packages/domain/src/registrations/target-system.ts` is the only place the registration digest is computed (AD-2).** SHA-256 over the RFC 8785 canonical JSON of exactly six keys: `allowed_origins`, `attribute_label_patterns`, `credential_ref`, `kind`, `permitted_actions`, `secondary_key`. A `desktop` system's application identity occupies the `allowed_origins` slot, so the key set is the same for every kind. The projection is written key by key, never a spread: a spread would put the display name, the note and the id into a value a Procedure Version freezes. Nothing recomputes it on read — the adapter stores and returns the number the domain module produced.
- **Origins, label patterns and permitted actions are sets, not lists.** They are trimmed, deduplicated and sorted (UTF-16 code unit, which is what `Array.prototype.sort` does) before hashing, so retyping the same two origins in the other order does not move a digest and mint a platform-authored draft for every Procedure that references it.
- **`packages/domain` hand-rolls SHA-256 and UTF-8 (`sha256.ts`) because it has no `@types/node`.** That absence is the compiler-enforced half of AD-11 — `process.env` does not typecheck there — so `node:crypto` is unreachable and adding the types to get it would trade an invariant for a convenience. It is checked against two implementations that are not it: the Python-produced fixture, and `tests/unit/sha256.test.ts` against `node:crypto` at the block-boundary lengths (55, 56, 63, 64, 119, 120) where a padding mistake hides. `utf8Bytes` REFUSES a lone surrogate rather than substituting U+FFFD as `TextEncoder` does, because that substitution would make two different inputs hash the same.
- **`tests/fixtures/registration-digest-golden.json` is produced by `uv run scripts/make-registration-digest-golden.py`, not by TypeScript.** Python `rfc8785` + `hashlib`, the same precedent as `audit-chain-golden.json`. Its envelopes are written out by hand in the generator, so the projection is checked as well as the hash. The unit test asserts `producer` starts with `Python` — a fixture regenerated from the code under test would prove only that it equals itself.
- **A credential that cannot be proven read-only is refused exactly like one that reports write access**, with the verbatim `Audit credentials must be read-only.`, and the attempt is audited as `configuration.registration-refused`. A provider that throws is treated as `unknown` too: otherwise "the check was unavailable" becomes a path on which an unproven credential is stored.
- **The read-only refusal event is appended in its OWN unit of work, before the write transaction opens.** It must commit while nothing is stored, and those are opposite requirements for one transaction.
- **`CredentialCapabilityReport` has exactly two fields.** A reference and a verdict — there is nowhere a secret could travel, so no response, log or audit payload downstream can carry one by accident. The credential reference is deliberately absent from every audit payload as well: the chain is immutable, so anything credential-shaped that enters it can never be taken out.
- **`CREDENTIAL_CAPABILITIES` is a declaration, not a probe.** A JSON object mapping an opaque reference to `read-only` or `write-capable`, validated at boot. An absent value is an empty manifest, which refuses every registration rather than accepting every one. Reading the capability out of the reference's spelling would make the guarantee a naming convention anybody can satisfy by typing.
- **`configuration.registration-changed` (`RegistrationChanged`) is published only when one of the six moves; every other change is `configuration.registration-annotated`.** Epic 2 turns `RegistrationChanged` into a platform-authored draft, so a rename must not produce one. But the spec's first wording — a non-digest change "publishes nothing" — meant a rename, and worse a RETIREMENT, wrote a row with nothing at all in the chain, which FR-45 forbids. Two event types keep both properties: `registration-annotated` records the change and Epic 2 does not read it. A save that moves one of the six AND a display name carries both halves in the one event (`changedFields`, `annotatedFields`). A save that moves nothing appends nothing. The command asserts the converse too — if the digest moved with no field changed, it throws rather than committing.
- **`array_length(x, 1)` of an empty array is NULL, and a CHECK that evaluates to NULL PASSES.** `target_system_registration_actions_present` uses `cardinality`. Written the obvious way, the constraint accepted exactly the row it existed to refuse; the integration suite's raw-SQL insert is what caught it.
- **Generation 5's CHECK constraints are the layer nothing can route around.** `permitted_actions <@ ARRAY[...]` means no command, migration or psql session can store a write action; `digest ~ '^[0-9a-f]{64}$'` refuses anything that is not a digest. They are asserted with raw SQL in `tests/integration/registrations.test.ts`, because a constraint tested through the command proves nothing about the constraint.
- **The probe module is unreachable from `apps/` and that is a build failure, not a convention.** `packages/infrastructure/src/registrations/probe.ts` is outside every barrel, has its own `@intellifin/infrastructure/probe` subpath, and `no-target-system-probe-in-apps` fails `pnpm boundaries` on any import of it from `apps/` — the web because AD-10 forbids it an outbound call, the worker because Story 1.8 runs it as its own entry point the way the release migrator is invoked. `tests/unit/boundaries.test.ts` plants both violations. **A new subpath export needs a matching alias in `vitest.config.ts` AND `tests/integration/vitest.config.ts`**, or the import resolves to an unbuilt `dist`.
- **The connectivity column reads rows the worker writes and says "Never probed" in words.** A dash or an empty cell is something a reader takes for "fine". `target_system_probe` holds one row per registration — the present, not a history.
- **A registration is never deleted; retirement is a status.** A Run that froze a digest must still be able to resolve it.

### Story 1.6 review findings (applied 2026-09-02)

- **`JSON.stringify` escapes a lone surrogate, so a guard downstream of it can never fire.** `utf8Bytes` in `sha256.ts` refuses one and this file used to record that as the protection; on the registration path it was unreachable, because `canonicalJson` serialises strings with `JSON.stringify` first. What it cost was a row that permanently disagreed with its own digest: the digest covered the escaped form, while the driver encoded the same string for the wire with U+FFFD substitution and PostgreSQL stored that. **`canonicalJson` is now the refusal point** — for an unpaired surrogate and for a non-finite number, both of which Python `rfc8785` also refuses — and `validateRegistrationFields` turns the throw into a sentence, because it arrives through a Server Action anybody with the role can post to. A serializer that substitutes is the same defect as an encoder that substitutes.
- **What is hashed and what is stored must be the same value.** Origins and label patterns were stored trimmed but not deduplicated, while the digest hashed the deduplicated set. Removing a duplicated origin then changed the column without moving the digest, and the command published `RegistrationChanged` with `priorDigest === newDigest` — an immutable event asserting a transition that did not happen, from which Epic 2 mints a platform-authored draft for every Procedure Version. The command asserts BOTH directions now: six changed with no digest movement, and digest movement with none of the six changed.
- **An optimistic-concurrency token must cover every field the write replaces.** It was the digest, which covers six of the row's ten fields — so `displayName`, `note` and `status` were exactly the fields it could not protect. One administrator retires a registration (the digest does not move), a second saves a note from a tab opened before that, the guard passes, and the write silently sets `status` back to `active`. `registrationRowVersion` hashes all ten. Not `updated_at`: `now()` is a transaction timestamp and two concurrent transactions are not guaranteed to disagree about it.
- **A dependency-cruiser `exclude` disables every rule for the excluded path — including `dist`.** Both probe and migrator rules match `(src|dist)`, and the `dist` half was dead because built output sat in `exclude`, so an import spelled at `packages/infrastructure/dist/...` passed with a `no-orphans` warning as the only trace. Built output is now in `doNotFollow`, which keeps it in the graph. **The rule is broader than "never exclude `node_modules`": never `exclude` anything a rule's `to.path` mentions.** `tests/unit/boundaries.test.ts` plants the `dist` spelling for both rules, guarded on the file existing so a fresh clone skips rather than passes.
- **A port with no host types cannot own a timeout.** `packages/application` has no `setTimeout` — that absence is what stops `process.env` typechecking there (AD-11) — so the deadline on the credential capability check is a required `DeadlinePort` dependency: the command owns the policy, `TimerDeadline` in infrastructure owns the mechanism, and an implementer cannot leave it out.
- **A structural type does not contain anything.** `CredentialCapabilityReport` has two fields, but TypeScript's excess-property check fires only on a fresh literal assigned directly to an annotated type; a class declared `implements CredentialProvider` with an inferred return type can return a `secret` and compile. The containment is the CALL SITE destructuring the two fields it needs and never holding the report. The test that claimed otherwise built a two-key object and asserted it had two keys — a contract compared with a copy of itself. It is now a hostile provider that returns a secret anyway.
- **An answer about a different reference proves nothing.** The provider echoes the reference it was asked about and the command compares it. A real service that batches, caches by a normalized key or resolves an alias can otherwise prove a write-capable credential read-only.
- **An existence check in a separate statement prevents nothing.** `recordProbe` did `SELECT` then `INSERT`, which under a pool is not even one connection, so the row could vanish in between and raise the foreign-key error the check existed to prevent. One `INSERT ... SELECT ... WHERE EXISTS`. A raw statement has no column type to infer from, so the timestamp is sent as ISO text with an explicit `::timestamptz`.
- **`tests/unit/` and `tests/integration/` were outside every tsconfig.** `pnpm -r typecheck` covers workspace packages only, and the root's second half covered `tests/e2e/` alone. The config is now `tsconfig.root-tests.json` and covers `scripts/`, `tests/e2e/`, `tests/integration/` and `tests/unit/` — and the root has to link every workspace package those suites import, or an import resolves to nothing and the file is silently unchecked. Widening it caught four real errors immediately.
- **The constraint whose obvious spelling is wrong is the one that must be pinned.** `schema.test.ts` pinned the read-only and digest CHECKs to the migration and not the `cardinality` one — backwards, since that is where an edit that looks like a tidy-up silently removes the rule. The negative assertion strips comment lines first: the migration's own header names `array_length` to explain why it is not used.
- **A browser assertion against a page rendered before the action cannot fail.** "Nothing was stored" checked a table the server sent before the click. Every such assertion now reloads first — and a reload clears the form as well as the table, so what follows re-fills it. Likewise `'recorded in the audit chain'` matched both the published and the annotated message, so the origin-change test passed with the event never published; it asserts the sentence unique to the published path.
- **A `var(--x)` naming nothing falls back silently.** `.ls-definition dt` read `--font-size-sm`, defined nowhere, and lived on its fallback — the rule looked token-driven and was not. `stylesheet.test.ts` now requires every custom property `globals.css` reads to be defined in `tokens.css` or in `globals.css` itself.
- **A 64-character digest read aloud is unusable.** The visible text stays the full value, because that is what an auditor compares; `spokenDigest` supplies the `aria-label` — first four and last four characters, spaced — which is enough to tell two digests apart by ear.
- **`Object.hasOwn` for any lookup keyed by request input — fifth occurrence, and this time the guards got their own test.** `registrations.ts` had all four guards and nothing exercised them; inverting one now fails four cases.
- **Never `git add -A` while a reviewer subagent is planting and reverting violations.** One review's deliberate AD-10 plant was swept into a commit and pushed, and CI caught it. Stage explicit paths, or commit before the reviewers start.
