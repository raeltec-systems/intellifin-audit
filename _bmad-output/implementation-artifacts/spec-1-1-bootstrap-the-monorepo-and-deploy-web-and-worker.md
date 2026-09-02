---
title: 'Story 1.1: Bootstrap the monorepo and deploy web and worker'
type: 'chore'
created: '2026-09-02'
status: 'in-review'
review_loop_iteration: 0
baseline_commit: '8cf07a45efdee0e84579d06fbc19c7021fbeaf91'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** No application code exists. Every later story needs a running, boundary-enforced pnpm monorepo with CI and two Railway services, and nothing today enforces the architecture spine's dependency direction or its release-only migration rule.

**Approach:** Create the workspace the spine seeds (`apps/web`, `apps/worker`, `packages/domain`, `packages/application`, `packages/infrastructure`, `tests/*`) with the verified stack pins, a machine-enforced dependency-boundary check, a CI pipeline that runs typecheck, boundaries, unit tests, and Drizzle migrations against PostgreSQL 18, a release pipeline that alone applies migrations, and Dockerfiles plus Railway config so web and worker deploy as separate containers with a health route and a worker heartbeat row.

## Boundaries & Constraints

**Always:** Pin exactly the stack seed in the spine (Node 24.20.0, TypeScript 7.0.2, Next.js 16.3.4, React 19.2.8, pnpm 11.25.0, Drizzle ORM 0.45.2 / Kit 0.31.10, postgres.js 3.4.9, pg-boss 12.29.0, Zod 4.5.4, Pino 10.3.1, Sentry 10.73.0, Vitest 4.1.11, Playwright 1.62.1). Enforce AD-1 with dependency-cruiser rules that fail CI: `domain` imports nothing outward, `application` imports only `domain`, and no business code imports Drizzle, pg-boss, Solari, AI SDK, Resend, S3, Better Auth, Next.js, Pino, or Sentry types. Read runtime configuration only in each composition root through a Zod schema; no ambient `process.env` inward. Migrations run only in the release workflow; web and worker check the supported schema range at startup and refuse to start outside it (AD-15). Verify PostgreSQL `server_version` is 18 at bootstrap (AD-11). Commit messages and code carry no model identifiers.

**Ask First:** Substituting a different major for any pinned dependency. Adding Turborepo or any second build orchestrator. Creating or modifying Railway projects, services, or secrets (needs the Railway connector enabled in this chat). Any table beyond `schema_meta` and `worker_heartbeat`.

**Never:** Application features, authentication, roles, UI shell, or audit events (Stories 1.2 onward). Auto-migrating at process startup. Committing secrets or `.env` files. Hand-editing lockfiles. A dependency-boundary rule expressed only in documentation.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Boundary violation | `packages/domain/src/x.ts` imports `drizzle-orm` | `pnpm boundaries` exits non-zero naming the file and rule | CI job fails |
| Clean workspace | Fresh clone, `pnpm install && pnpm -r typecheck && pnpm boundaries && pnpm test` | All exit 0 | N/A |
| Migrations in CI | PR against `main`, PostgreSQL 18 service | `pnpm db:migrate` applies `0000_schema_meta.sql` and `0001_worker_heartbeat.sql`; job green | Job fails on any migration error |
| Unsupported schema | `schema_meta.version` outside the process's declared range | Web and worker exit non-zero at startup with the range and the found version in the log | Process does not serve or poll |
| Wrong PostgreSQL major | `server_version` not 18.x | Startup refuses with the version in the log | Exit non-zero |
| Health | `GET /api/health` on web | `200 {"status":"ok","schema":<n>}` | 503 with reason when the DB check fails |
| Heartbeat | Worker running | One `worker_heartbeat` row upserted every 30 s with `hostname` and `seen_at` (UTC) | Logged error, next tick retries |

</frozen-after-approval>

## Code Map

Greenfield: no code exists. Sources of truth for this story:

- `_bmad-output/planning-artifacts/architecture/architecture-IntelliFin Audit-2026-09-01/ARCHITECTURE-SPINE.md` -- AD-1 (boundaries), AD-8 (Drizzle, reviewed migrations), AD-11 (Railway, two containers, `server_version` check, config only in composition roots), AD-15 (release-only migrations, startup range check); Stack table; Structural Seed tree.
- `_bmad-output/planning-artifacts/epics.md` -- Story 1.1 acceptance criteria.
- `AGENTS.md` -- Running and verifying holds a TODO to record monorepo commands once `package.json` exists.
- Sandbox facts: `node` is 22.22.2 at `/opt/node22`, `nvm` at `/opt/nvm`, `pnpm` 10.33.0 on PATH, `docker` and `psql` present, registry reachable.

## Tasks & Acceptance

**Execution:**
- [x] `.nvmrc`, `package.json`, `pnpm-workspace.yaml`, `.npmrc`, `tsconfig.base.json`, `.gitignore` -- root workspace with `packageManager: pnpm@11.25.0`, `engines.node: 24.20.0`, scripts `typecheck`, `boundaries`, `test`, `db:migrate`, `db:generate` -- one entry point for CI and humans.
- [x] `packages/domain`, `packages/application`, `packages/infrastructure` -- each `package.json`, `tsconfig.json`, `src/index.ts` exporting a named placeholder; `application` depends on `domain`, `infrastructure` on both -- the seed the spine fixes.
- [x] `packages/infrastructure/src/config.ts` -- Zod schema for `DATABASE_URL`, `SERVICE_NAME`, `SCHEMA_RANGE_MIN`, `SCHEMA_RANGE_MAX`; exported `loadConfig()` called only by composition roots -- AD-11.
- [x] `packages/infrastructure/src/db/{client.ts,schema.ts,compat.ts}`, `drizzle.config.ts`, `packages/infrastructure/drizzle/0000_schema_meta.sql`, `0001_worker_heartbeat.sql` -- postgres.js client, Drizzle tables `schema_meta(version int, applied_at)` and `worker_heartbeat(hostname pk, seen_at)`, `assertSchemaSupported()` and `assertPostgres18()` -- AD-8, AD-15.
- [x] `apps/web` -- Next.js 16 app with `app/page.tsx` placeholder and `app/api/health/route.ts` returning status and schema version; composition root `src/bootstrap.ts` plus `instrumentation.ts` run both asserts at boot and exit non-zero on refusal -- health route and unsupported-schema ACs.
- [x] `apps/worker/src/main.ts` -- composition root: `loadConfig()`, asserts, then a 30 s heartbeat upsert loop; graceful SIGTERM -- heartbeat AC.
- [x] `.dependency-cruiser.cjs` -- AD-1 rules as listed under Always; `pnpm boundaries` runs it over `apps/` and `packages/`.
- [x] `tests/fixtures/.gitkeep`, `tests/integration/vitest.config.ts`, `tests/e2e/.gitkeep`, `packages/infrastructure/src/config.test.ts`, `tests/integration/schema-compat.test.ts`, plus `tests/unit/boundaries.test.ts`, `apps/web/src/health-route.test.ts`, `tests/integration/heartbeat.test.ts` -- unit test for config validation; integration test for the range and version asserts against `DATABASE_URL`; one covering test per matrix row -- proves the refusal path.
- [x] `.github/workflows/ci.yml` -- on PR: pnpm 11.25.0 via corepack, Node 24.20.0, install, `typecheck`, `boundaries`, `test`, then `db:migrate` and integration tests against a `postgres:18` service.
- [x] `.github/workflows/release.yml` -- on push to `main`: `db:migrate` against `DATABASE_URL` secret, then `railway up` for `web` and `worker` with `RAILWAY_TOKEN` -- AD-15 release-only migrations.
- [x] `apps/web/Dockerfile`, `apps/worker/Dockerfile`, `.railway/railway.ts` -- multi-stage Node 24 images; web health check path `/api/health`; no migrate step in either image. Railway config-as-code (`railway.json`) is deprecated for new services, so the environment shape lives in the IaC file instead.
- [x] Railway: project `intellifin-audit` with services `web`, `worker`, PostgreSQL 18 (`ghcr.io/railwayapp-templates/postgres-ssl:18`); `DATABASE_URL` and `SERVICE_NAME` set per service -- via the Railway connector once enabled (Ask First).
- [x] `AGENTS.md` -- replace the Running and verifying TODO with the four root scripts -- keeps the agent block true.

**Acceptance Criteria:**
- Given a fresh clone, when `pnpm install`, `pnpm -r typecheck`, `pnpm boundaries`, and `pnpm test` run, then all exit 0 and the workspace has the eight seed directories.
- Given a pull request, when CI runs, then typecheck, boundaries, unit tests, and migrations against PostgreSQL 18 all pass, and no workflow other than `release.yml` runs migrations.
- Given both Railway services deployed, when `GET /api/health` is called and the worker log is read, then the route returns 200 with the schema version and a `worker_heartbeat` row is present and fresh.

## Spec Change Log

- 2026-09-02, review loop 1. Finding: the task line for `apps/web` said the asserts run "on first request", contradicting the matrix rows that require both processes to exit non-zero at startup. Amended the task line to boot-time asserts through Next.js `instrumentation.ts`. Known-bad state avoided: a web process that keeps serving `/` against an unsupported schema and only reports it in the health body. Applied as a targeted patch rather than a full re-derivation because the fix is local to one hook. KEEP: the pure assert functions in `packages/infrastructure/src/db/compat.ts` with their unit tests; the `schema_meta` and `worker_heartbeat` migrations; the dependency-cruiser rule set and the spawn-based boundary test.
- 2026-09-02, deviations recorded. (a) `typescript@6.0.3` is pinned at the workspace root only, because dependency-cruiser 18.2.0 silently cruises zero modules under TypeScript 7; every package still pins 7.0.2. This touches the Ask First list and awaits the owner's decision. (b) `@sentry/nextjs` is not installed yet; `pino` and `@sentry/node` are pinned in `packages/infrastructure` and wired by Story 1.2. (c) Railway config-as-code is deprecated for new services, so `.railway/railway.ts` replaces the two `railway.json` files; service settings were applied through the Railway connector. (d) The Railway database is reachable only through a TCP proxy that the sandbox cannot use, so the first migration runs from `release.yml`; until GitHub Actions runs in this repository the deployed web returns 503 and the worker refuses to start, by design.

## Verification

**Commands:**
- `pnpm install && pnpm -r typecheck && pnpm boundaries && pnpm test` -- expected: exit 0.
- `printf 'import "drizzle-orm";\n' >> packages/domain/src/violation.ts && pnpm boundaries; rm packages/domain/src/violation.ts` -- expected: non-zero exit naming `packages/domain/src/violation.ts`.
- `docker run -d --name pg18 -e POSTGRES_PASSWORD=pg -p 5432:5432 postgres:18 && DATABASE_URL=postgres://postgres:pg@localhost:5432/postgres pnpm db:migrate && DATABASE_URL=... pnpm test:integration` -- expected: two migrations applied, integration tests green.

**Manual checks (if no CLI):**
- Railway dashboard shows `web` and `worker` healthy; `GET https://<web-domain>/api/health` returns `{"status":"ok","schema":1}`; `worker_heartbeat` has a row with `seen_at` within the last minute.
