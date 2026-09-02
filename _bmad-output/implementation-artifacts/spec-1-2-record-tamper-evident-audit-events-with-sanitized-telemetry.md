---
title: 'Story 1.2: Record tamper-evident audit events with sanitized telemetry'
type: 'feature'
created: '2026-09-02'
status: 'blocked'
baseline_revision: 'eed8b80ecb2b1b6f8ddda875e0b5b99f6e91b5dc'
baseline_commit: 'eed8b80ecb2b1b6f8ddda875e0b5b99f6e91b5dc'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/CLAUDE.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
warnings:
  - oversized
deferred: []
---

<intent-contract>

## Intent

**Problem:** IntelliFin has no product audit-event model, atomic recorder, or chain verifier, while web and worker still write unsanitized hand-built JSON. Later security, configuration, and Run timelines therefore lack attributable, tamper-evident history and safe operational diagnostics.

**Approach:** Establish one application-owned audit unit of work backed by a per-aggregate PostgreSQL hash chain, then route web, worker, Pino, and Sentry data through one allowlist sanitizer while preserving the audit event's correlation identifier.

## Boundaries & Constraints

**Always:** Keep event vocabulary and validation in `domain`, ports and unit-of-work contracts in `application`, and PostgreSQL/Pino/Sentry implementations in `infrastructure`. Store actor type/id, event type, UTC time, source, outcome, session id, correlation id, aggregate id, sequence, payload, previous hash, and event hash. Use `platform` when no natural aggregate exists. Allocate a gapless sequence under a locked aggregate-head row; genesis uses 32 zero bytes. Hash `previousHashBytes || RFC8785CanonicalEventBytes` with SHA-256. Use UUIDv7 event ids. Expose append and full-chain verification, no update/delete API. Permit only documented scalar telemetry keys; remove credential, Evidence, provider/tool, snapshot, signed-URL, prompt, and AI input/output data before every sink. Configure Pino static redaction and Sentry with PII capture off plus sanitizing hooks as defense in depth. Keep migration release-only and support schema generations 1..2 during rollout.

**Block If:** An implementation requires a different chain format, a write path for historical events, raw sensitive data in telemetry, a new external service, or a migration outside CI/release.

**Never:** Put Drizzle, Node crypto, Pino, or Sentry types in `domain`/`application`; use caller-shaped `JSON.stringify` as canonical bytes; log raw unknown error messages; mix operational telemetry with product audit evidence; capture secrets or Evidence in audit payloads; migrate at process startup.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| First event | New aggregate | Sequence 1, zero genesis hash, valid SHA-256 link | Transaction rolls back on invalid metadata |
| Concurrent append | Two writes to one aggregate | Unique gapless sequences in commit order; both verify | Lock/retry failures leave neither a partial event nor an advanced head |
| Tampered history | Stored field, payload, link, or sequence changed | Verification identifies the first invalid event | Return a typed verification failure without leaking payload data |
| System event | No natural aggregate | Event chains under `platform` | Missing required attribution/correlation is rejected |
| Hostile telemetry | Nested passwords, tokens, Evidence, prompts, URLs, or raw errors | Pino output and Sentry envelopes contain only allowlisted scalars | Unsupported keys/values are dropped; sink failure does not break product work |

</intent-contract>

## Code Map

- `packages/domain/src/index.ts` -- seed barrel; add and export audit-event value types, JSON validation, canonical envelope contract, and chain-verification result.
- `packages/application/src/index.ts` -- seed barrel; add and export `AuditEventWriter`, `AuditChainReader`, `AuditUnitOfWork`, clock, and UUIDv7-owned ports without vendor types.
- `packages/infrastructure/src/db/{client.ts,schema.ts,index.ts}` -- reuse `createDb`; add head/event tables and the transaction-backed unit of work.
- `packages/infrastructure/drizzle/0001_worker_heartbeat.sql` -- generation-1 precedent; add the next generated/reviewed migration and stamp generation 2.
- `packages/infrastructure/src/{config.ts,telemetry/**}` -- extend root-owned config and implement the shared allowlist, Pino logger, and optional Sentry sink.
- `apps/web/instrumentation.ts`, `apps/worker/src/{main.ts,startup.ts}` -- replace raw JSON/error logging at both composition roots with injected sanitized telemetry.
- `tests/integration/{schema-compat.test.ts,*.test.ts}` -- update the exact-table contract and prove real PostgreSQL locking, rollback, append, and tamper detection.

## Tasks & Acceptance

**Execution:**
- [x] `packages/domain/src/audit-event.ts`, `packages/domain/src/index.ts` -- define validated event metadata, canonical JSON input, forbidden sensitive payload keys, zero-hash genesis, and typed verification results.
- [x] `packages/application/src/audit/**`, `packages/application/src/index.ts` -- define recorder/reader/unit-of-work ports so later state repositories can share the same transaction.
- [x] `packages/infrastructure/src/db/{schema.ts,audit-events.ts,index.ts}`, `packages/infrastructure/drizzle/*` -- add `audit_event_heads` and `audit_events`, locked append/rollback/verification, indexes and constraints, plus schema generation 2.
- [x] `packages/infrastructure/src/telemetry/**`, `packages/infrastructure/src/{config.ts,index.ts}` -- add the scalar allowlist, recursive hostile-key removal, Pino redaction, optional Sentry initialization/hooks, and sink-safe capture API.
- [x] `apps/web/instrumentation.ts`, `apps/worker/src/{main.ts,startup.ts}` -- wire one sanitized logger per process and stop emitting raw error messages.
- [x] `.env.example`, `.github/workflows/ci.yml`, affected tests/fixtures -- declare telemetry options, align schema range 1..2, and add independent golden/tampered vectors plus unit and PostgreSQL coverage for every matrix row.

**Acceptance Criteria:**
- Given security, configuration, lifecycle, Evidence-access, review, export, or failure activity, when it is recorded, then its complete attribution fields and correlation id are committed through the shared unit of work and its chain verifies.
- Given concurrent appends to the same aggregate in PostgreSQL 18, when both commit, then sequences are unique, gapless, commit-ordered, and match independently computed golden hashes.
- Given any persisted event byte is changed, when the chain is verified, then the first damaged sequence is reported without returning sensitive payload content.
- Given credential-shaped and Evidence-shaped values reach web or worker logging and error capture, when Pino and Sentry test sinks are inspected, then none of those values appear and the allowlisted correlation id remains.
- Given the generation-2 migration is applied, when all repository gates run, then typecheck, boundaries, unit tests, migration drift, integration tests, and container builds pass without any startup migration path.

## Spec Change Log

## Review Triage Log

## Design Notes

The canonical event excludes `previous_hash` and `event_hash`; its exact keys are `actor`, `aggregateId`, `correlationId`, `eventId`, `eventType`, `occurredAt`, `outcome`, `payload`, `sequence`, `sessionId`, and `source`. Sort and encode them with RFC 8785. Decode stored hex to 32 bytes, concatenate those bytes with the canonical UTF-8 bytes, and hash once. Verification rebuilds these bytes from stored columns, checks sequence/link continuity, then checks the aggregate head.

## Verification

**Commands:**
- `nvm use; corepack enable; pnpm -r typecheck; pnpm boundaries; pnpm test` -- expected: all offline gates pass on Node 24.20.0.
- `pnpm db:migrate; pnpm db:generate; pnpm test:integration` with `DATABASE_URL` for PostgreSQL 18 -- expected: generation 2 applies, no migration drift remains, and chain concurrency/tamper tests pass.
- `pnpm build` -- expected: packages and worker build with sanitized telemetry wiring.

## Auto Run Result

Status: blocked
Blocking condition: implementation verification failed -- `pnpm db:migrate` and `pnpm test:integration` cannot run in this environment, so no PostgreSQL-backed acceptance evidence exists.

**Run date:** 2026-09-02 (baseline `eed8b80ecb2b1b6f8ddda875e0b5b99f6e91b5dc`)

### Gates that ran and passed

| Command | Result |
|---------|--------|
| `pnpm -r typecheck` | pass (5 projects) |
| `pnpm boundaries` | pass, 49 modules cruised, no violations |
| `pnpm test` | pass, 8 files / 66 tests |
| `pnpm build` | pass |
| `pnpm db:generate` (drift) | "No schema changes, nothing to migrate" |

Node here is 24.19.0, not the pinned 24.20.0 -- an engine warning only; every gate above still ran.

### Gates that could not run

`pnpm db:migrate` and `pnpm test:integration` need `DATABASE_URL` and a PostgreSQL 18 server. This machine has none: `DATABASE_URL` is unset, and `docker`, `podman`, `psql`, `pg_ctl` and `postgres` are all absent. `tests/integration/audit-events.test.ts:74` is guarded by `describe.skipIf(!databaseUrl)`, so the whole suite is skipped rather than failed.

A deployed Railway database was deliberately **not** used as a substitute: AD-15 and the comment at the head of `.github/workflows/ci.yml` restrict migration to a throwaway CI database, with `release.yml` the only workflow permitted to touch an environment database.

### Matrix test audit -- not satisfied

| Matrix row | Executed coverage |
|------------|-------------------|
| First event | **partial** -- genesis/hash proven offline (`tests/unit/audit-event.test.ts:47`); the "transaction rolls back on invalid metadata" half is skipped (`tests/integration/audit-events.test.ts:166`) |
| Concurrent append | **none** -- only `tests/integration/audit-events.test.ts:88`, skipped |
| Tampered history | **none** -- only `tests/integration/audit-events.test.ts:236` (`it.each` over `tests/fixtures/audit-chain-tampered.json`), skipped |
| System event | **partial** -- `platform` fallback proven offline (`tests/unit/audit-event.test.ts:55`); the rejection half is skipped (`tests/integration/audit-events.test.ts:166`) |
| Hostile telemetry | **full** -- `packages/infrastructure/src/telemetry/telemetry.test.ts` (6 tests) |

Per the Matrix Test Audit rule a covering test that did not run counts as missing, so two rows have no evidence and two more are half-proven.

### Code changed during this run

- `packages/infrastructure/src/telemetry/logger.ts` -- `captureError` now builds its sanitized fields inside `try/catch`, so a field object with a throwing getter cannot escape the error path and break product work.
- `packages/infrastructure/src/telemetry/telemetry.test.ts` -- test for that case.
- `scripts/check-boundaries.mjs`, `tests/unit/boundaries.test.ts` -- the corepack workaround is now scoped to `win32`, leaving the Linux CI command unchanged.
- `CLAUDE.md` -- added the "Audit events and telemetry (Story 1.2)" decisions section.

### To clear the block

Run the `database` job in `.github/workflows/ci.yml`, which starts `ghcr.io/railwayapp-templates/postgres-ssl:18` and sets `DATABASE_URL` with `sslmode=require`. That executes the migration and all five skipped integration tests. Nothing else is known to be outstanding.

### Known non-blocking issues

- `next build` fails locally because the repository path contains a space (`IntelliFin Audit`); Turbopack cannot canonicalize `IntelliFin%20Audit`. Pre-existing, unrelated to this story, and CI builds on Linux.
- `apps/web` bundles `pino` and `@sentry/node` via `transpilePackages`. Do not "fix" this with `serverExternalPackages`: both are dependencies of `@intellifin/infrastructure`, not of `apps/web`, so under pnpm's isolated `node_modules` an external `require` from `.next/server` would not resolve at runtime.
