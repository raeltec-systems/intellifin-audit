---
title: "Architecture Reviewer Gate — Technology Reality (revision 2)"
artifact: "../ARCHITECTURE-SPINE.md"
reviewed: 2026-09-01
review_type: configured-technology-reality
spine_revision: 2
verdict: conditional-pass
counts:
  critical: 0
  high: 1
  medium: 2
  low: 6
method: "Every Stack row re-fetched from registry.npmjs.org/<pkg>/latest and nodejs.org/dist/index.json on 2026-09-01; every revision-2 vendor capability claim checked against vendor documentation or the package's published README."
---

# Technology Reality Review — Spine revision 2

## Verdict

**Conditional pass.** Every version in the Stack table exists on its registry today; 19 of 23 rows are still the current release and the remaining four drifted by same-day patch releases published after the memlog's verification. Node.js 24.20.0 remains the active LTS ("Krypton") and satisfies every declared engine range in the stack. The revision-2 additions — LISTEN/NOTIFY + SSE, application-owned Schedules over a pg-boss tick, Resend idempotency, the pg-boss wait/wake pattern, and the Railway/Better Auth/Solari-browser claims carried from revision 1 — are all reality-checked and fit their assigned use.

The gate is conditional because of one High finding: AD-4 states that the Solari **sandbox** SDK implements `DesktopExecution` including *structural snapshot capture (control tree for desktop)*, and neither the `@solarisdk/sandbox` package nor Solari's VM/Desktop documentation exposes any accessibility or control tree — only screenshot, mouse, keyboard, shell `exec`, filesystem, clipboard and process actions. The capability the spine assigns to the vendor has to be built inside the VM by the project. The memlog already records this as an open question; the spine text has not yet caught up with it.

## 1. Stack table — registry check (2026-09-01)

| Row | Spine | Registry / vendor today | Status |
| --- | --- | --- | --- |
| Node.js | 24.20.0 LTS | nodejs.org dist index: v24.20.0, lts "Krypton", 2026-08-26; v26.8.1 is Current (not LTS) | Current LTS |
| TypeScript | 7.0.2 | 7.0.2 | Current (see TR2-03 for fit) |
| Next.js | 16.3.4 | 16.3.4 (engines node >=20.9.0; peer react ^19) | Current |
| React | 19.2.8 | 19.2.8 | Current |
| PostgreSQL | 18.6 | postgresql.org versioning table: 18 → current minor 18.6, supported to 2030-11-14 | Current |
| pnpm | 11.25.0 | 11.25.0 | Current |
| Drizzle ORM / Kit | 0.45.2 / 0.31.10 | 0.45.2 / 0.31.10 (peer postgres >=3, pg >=8) | Current |
| postgres.js | 3.4.9 | 3.4.9 | Current |
| pg-boss | 12.29.0 | 12.29.0 (published 2026-08-30; engines node >=22.12.0; deps pg ^8.23, cron-parser ^5.10) | Current |
| Better Auth | 1.7.2 | 1.7.2 (peers next ^16, drizzle-orm ^0.45.2, react ^19, pg ^8) | Current |
| Vercel AI SDK | 7.0.87 | **7.0.89** (7.0.88 at 17:01 UTC, 7.0.89 at 18:30 UTC on 2026-09-01; engines node >=22; peer zod ^4.1.8) | Drifted, same day |
| @ai-sdk/openai / anthropic | 4.0.53 / 4.0.46 | **4.0.55 / 4.0.47** (both published 18:31 UTC 2026-09-01) | Drifted, same day |
| @solarisdk/browser | 0.1.2 | 0.1.2 (published 2026-09-01; dep patchright-core 1.62.2; engines node >=20) | Current |
| @solarisdk/sandbox | 0.1.2 | 0.1.2 (published 2026-07-20; dep @solarisdk/core; engines node >=18) | Current (see TR2-01 for fit) |
| Resend | 6.25.0 | 6.25.0 (published 2026-08-28; engines node >=20) | Current |
| @aws-sdk/client-s3 | 3.1123.0 | **3.1124.0** (published 18:54 UTC 2026-09-01) | Drifted, same day |
| Zod | 4.5.4 | 4.5.4 | Current |
| Pino | 10.3.1 | 10.3.1 | Current |
| @sentry/nextjs / @sentry/node | 10.73.0 / 10.73.0 | 10.73.0 / 10.73.0 (peer next ^16) | Current |
| Vitest | 4.1.11 | 4.1.11 (engines node >=24 accepted) | Current |
| Playwright | 1.62.1 | 1.62.1 (`playwright` and `@playwright/test`) | Current (see TR2-09) |
| Railway | "managed PoC platform" | docs.railway.com; bucket and networking limits re-verified below | Claims match |

Sources: <https://registry.npmjs.org/> (`/<package>/latest` and full package documents for publish times), <https://nodejs.org/dist/index.json>, <https://www.postgresql.org/support/versioning/>.

## 2. Findings

### TR2-01 — High — The Solari desktop surface has no accessibility/control tree; AD-4's "Solari … sandbox SDKs implement [structural snapshot capture]" assigns the vendor a capability it does not expose

**What the vendor actually provides.** The `@solarisdk/sandbox` README describes "ephemeral compute sandboxes — with an optional desktop — and drive them with a computer-use action API"; `sandboxes.createDesktop()` returns a `Desktop` handle. The unified `@solarisdk/sdk` README enumerates the entire desktop action surface: `exec`, `fs` (read/readText/write/list), `mouse` (move/click/down/up/scroll), `keyboard` (type/press/down/up), `screenshot`, `display.set`, `clipboard`, `process` (list/kill), `health`, plus a VNC `streamUrl`. Solari's VM documentation lists the same methods plus `open()`, `execStream()`, `pause()`, `setTimeout()`, `stream.start()`, and explicitly contains no accessibility tree, UI element tree, AT-SPI, or find-element capability. The Sandboxes page states a sandbox is "a machine for running code and automation, with no screen"; the GUI product is the VM/Desktop (`@solarisdk/desktop` / `solari.desktops`). No page mentions a11y, AT-SPI, or a structural snapshot for desktops. (A Daytona issue turned up by search proposes exposing "the Linux accessibility tree so agents can locate UI elements by role, name, bounds, and state" — that is a competitor's roadmap, not Solari's.)

**What this implies for AD-4/AD-18.** The `DesktopExecution` conformance contract requires "structural snapshot capture (… control tree for desktop)" and AD-18 requires snapshots "captured by the platform's … DesktopExecution adapter at the Tool Action that read the attributes". With Solari, the only deterministic channels into the desktop are `exec`/`execStream` and `fs`, and custom templates can `aptInstall` packages and `runCommands` on "the standard Ubuntu desktop". A control-tree snapshot is therefore achievable only if the project builds it inside the VM image: (a) an in-VM AT-SPI dump (e.g. `python3-pyatspi` / `at-spi2-core` on the Ubuntu desktop template) invoked through `desktop.exec` immediately after the reading Tool Action, or (b) the synthetic LedgerDesk application exposing its own structured snapshot (local endpoint or file) read through `exec`/`fs`. Either way the Solari SDK is transport, not the snapshot producer, and the focused-record identity / window-title binding in AD-18 must come from that in-VM component too. If neither is built, the spine's own fallback applies: LedgerDesk attributes become model-read and the hero Procedure's LedgerDesk conditions become `AGENT_JUDGED`, which weakens the Rule-Classified `account_status` story in the PRD.

**Required disposition.** Amend AD-4 so the desktop path reads: the `DesktopExecution` adapter obtains control-tree snapshots from an in-VM snapshot agent (AT-SPI dump or LedgerDesk snapshot endpoint) executed through the Solari desktop `exec`/`fs` actions on a project-owned template; the Solari SDK provides session, action transport, screenshots, and VNC stream only. Move the memlog's open question into the spine's Deferred/Open list with its owner and trigger, and bind the LedgerDesk template build (Ubuntu desktop template with AT-SPI enabled, or in-app snapshot) as a prerequisite for any Rule-Classified desktop condition. Consider listing `@solarisdk/desktop` (or `@solarisdk/sdk`) rather than `@solarisdk/sandbox`, since Solari's docs place desktops in the VM product; the sandbox package works (`createDesktop()`), but the name misdescribes the capability used.

Sources: <https://registry.npmjs.org/@solarisdk/sandbox>, <https://registry.npmjs.org/@solarisdk/sdk>, <https://registry.npmjs.org/@solarisdk/desktop>, <https://docs.getsolari.com/desktops>, <https://docs.getsolari.com/sandboxes>, <https://docs.getsolari.com/templates>, <https://github.com/daytonaio/daytona/issues/4445>.

### TR2-02 — Medium — Railway's edge closes HTTP responses after 5 minutes without data and after 15 minutes regardless; SSE streams must heartbeat and reconnect by design

Railway's public-networking limits state: "Idle HTTP/1.1 connections are closed after 60 seconds between requests"; HTTP requests "can run for up to 15 minutes if data keeps transferring" and are "closed after 5 minutes with no data transferred"; "Websocket connections are exempt from these duration and inactivity limits, and can stay open indefinitely". SSE is a plain HTTP response, so a Live View stream on Railway is cut at 15 minutes at most, and earlier if the worker emits nothing for 5 minutes (a Run sitting in `AWAITING_AUDITOR` will do exactly that). HTTP/2 is supported, which avoids the browser's six-connection-per-host limit for the dashboard's per-list streams.

Next.js 16.3.4's route handler docs confirm streaming `Response(new ReadableStream(...))` from a `GET` handler and that `GET` handlers are dynamic by default since 15.0, so the framework side is fine.

**Required disposition.** In AD-17 / the Live-channel convention, bind: (1) a server heartbeat comment at an interval far below 5 minutes (15–30 s also feeds the 15 s stale indicator), (2) client auto-reconnect with `Last-Event-ID`/`after=<seq>` cursor replay (already implied), (3) a stream lifetime cap below 15 minutes so reconnects are planned rather than proxy-forced, and (4) LISTEN subscription teardown on `request.signal` abort so cut streams do not leak listeners. State explicitly that the WebSocket exemption is *not* a reason to switch transports for the PoC.

Sources: <https://docs.railway.com/networking/public-networking/specs-and-limits>, <https://nextjs.org/docs/app/api-reference/file-conventions/route>.

### TR2-03 — Medium — TypeScript 7.0.2 works with Next.js 16.3.4 only through an experimental CLI checker, and the pnpm-workspace layout has an open incompatibility

TypeScript 7 ships the Go compiler and no longer provides the JavaScript compiler API. Next.js 16.3 handles this by running the project-local `tsc` CLI during `next build` (`experimental.useTypeScriptCli`, on by default) — the docs warn "This feature is currently experimental and subject to change, it's not recommended for production", that Next-specific code frames and route/page error rewriting are lost, and that `next build` exits if you opt out while on TS 7. Issue vercel/next.js#96589 (open, filed 2026-08-04 against 16.3.0) reports that Next.js's new TypeScript verification breaks monorepos where `typescript` is not resolvable as v7 from the Next app package itself; the only workarounds are declaring `typescript: ^7` at the root or in `apps/web/package.json`. Better Auth has an open `tsgo` declaration-emit issue (#10560, TS2883 for `oauthProviderClient()`), relevant only if `packages/*` emit declarations. Vitest and drizzle-kit do not depend on the TS compiler API, so they are unaffected.

**Required disposition.** Keep TypeScript 7.0.2 but record in the Stack notes: `typescript@^7` must be a direct dependency of `apps/web` (not hoisted only at the workspace root); CI type-checking runs `tsc --noEmit`/`tsgo` per package in addition to `next build`; shared packages avoid declaration emit of Better Auth client types until #10560 closes; and the team accepts that the Next.js checker is experimental with a documented fallback of pinning `typescript@6.x` if it regresses.

Sources: <https://nextjs.org/docs/app/api-reference/config/typescript#using-typescript-7>, <https://nextjs.org/docs/app/api-reference/config/next-config-js/useTypeScriptCli>, <https://github.com/vercel/next.js/issues/96589>, <https://github.com/vercel/next.js/discussions/95633>, <https://github.com/better-auth/better-auth/issues/10560>.

### TR2-04 — Low — Four seed versions drifted by same-day patch releases

`ai` 7.0.89, `@ai-sdk/openai` 4.0.55, `@ai-sdk/anthropic` 4.0.47 and `@aws-sdk/client-s3` 3.1124.0 were published between 17:01 and 18:54 UTC on 2026-09-01, after the memlog's version entries. The spine already says exact versions "pass to the lockfile once bootstrapped" and AD-11 binds majors only, so this is not an architecture error; the table should either be refreshed at bootstrap or annotated "as of 2026-09-01 midday UTC". Nothing in the patch stream changes the AD-9 provider-adapter decision (peer `zod ^4.1.8` is satisfied by 4.5.4).

Source: <https://registry.npmjs.org/ai>, <https://registry.npmjs.org/@ai-sdk/openai>, <https://registry.npmjs.org/@ai-sdk/anthropic>, <https://registry.npmjs.org/@aws-sdk/client-s3>.

### TR2-05 — Low — pg-boss has no "release" primitive; AD-16's "releases the job and schedules a deadline wake" must be spelled as complete-plus-deferred-send

pg-boss 12's job API is `send` (with `startAfter` as seconds, ISO string or Date; `sendAfter` convenience), `complete`, `fail`, `cancel`/`resume`, `retry`, `deleteJob`, `touch` (heartbeat) and `update`/`upsert` for not-yet-active jobs. There is no operation that hands an active job back to the queue for a later run; a thrown error calls `fail()` and consumes a retry. `expireInSeconds` defaults to 15 minutes and is capped at 24 hours, so a worker cannot hold a job across a multi-hour human wait. All of `send`, `insert`, `fetch` and `complete` accept a `db` option to run inside an existing transaction, and the Drizzle adapter supports both node-postgres and postgres-js drivers.

**Disposition (achievable, wording only).** State the mechanism in AD-16: within the wait transaction the worker persists the checkpoint and wait record, sends the deadline-wake job (`startAfter = deadline`, `db = current transaction`) and then returns from the handler so the current job completes; the resume command sends a resume job the same way. Do not rely on `singletonKey` alone for "one resume job per wait id" — in pg-boss 12 key-based uniqueness depends on the queue policy (`short`/`singleton`/`stately`/`exclusive`) or a `singletonSeconds` slot, and `send` silently returns `null` when throttled; the application-owned unique constraint on the wait record is the correct guard, with pg-boss dedupe as defence in depth. Note that pg-boss brings its own `pg` pool; the worker will run two drivers (postgres.js for Drizzle, pg for pg-boss's own polling) unless pg-boss is constructed with a custom `db`.

Sources: <https://pgboss.io/api/jobs>, <https://pgboss.io/api/workers>, <https://pgboss.io/api/queues>, <https://pgboss.io/api/adapters>, <https://pgboss.io/api/constructor>, <https://github.com/timgit/pg-boss/issues/579>.

### TR2-06 — Low — pg-boss cron semantics confirm AD-19's "never the Schedule of record" choice; the (version, period) uniqueness is an application constraint and is achievable

pg-boss schedules are evaluated every 30 s (`cronMonitorIntervalSeconds`), clock skew is checked every 10 min (`clockMonitorIntervalSeconds`), cron granularity is one minute (sub-60 s settings disable cron processing), and "only 1 job is sent even if multiple instances are running" via throttling. Missed windows while all instances are down are not persisted or replayed — issue #557 requesting a stored `nextExecution` remains open. That is exactly why AD-19 must own periods itself. "One Run per (Procedure Version, effective period) under a unique constraint" is a plain PostgreSQL unique index on the Runs/Schedule-occurrence table inserted in the same transaction as the pg-boss `send` (via the Drizzle adapter), which pg-boss neither helps nor hinders. Schedule "start within 5 minutes" in the acceptance envelope is compatible with the 30 s cron monitor plus a poll tick.

Sources: <https://pgboss.io/api/scheduling>, <https://github.com/timgit/pg-boss/issues/557>, <https://github.com/timgit/pg-boss/issues/427>.

### TR2-07 — Low — Resend idempotency verified; 24-hour key retention means the delivery record, not Resend, is the long-run dedupe

Resend supports an `Idempotency-Key` on `POST /emails` and `POST /emails/batch`; keys are up to 256 characters, "kept in the system for 24 hours", and reuse with a different payload returns 409 `invalid_idempotent_request`. Node SDK usage is `resend.emails.send(payload, { idempotencyKey })`. This fits AD-20's at-least-once sends provided the idempotency key is derived from the notification record id (not from Evidence or Escalation text), and retries older than 24 hours are suppressed by the recorded delivery outcome rather than by the provider.

Source: <https://resend.com/docs/dashboard/emails/idempotency-keys>, <https://registry.npmjs.org/resend>.

### TR2-08 — Low — PostgreSQL NOTIFY and postgres.js LISTEN fit AD-17 as written; record the pooler constraint

PostgreSQL: NOTIFY payloads "must be shorter than 8000 bytes"; notifications inside a transaction "are not delivered until and unless the transaction is committed"; identical (channel, payload) pairs in one transaction are collapsed; the notification queue is 8 GB and commits fail only when it fills because a listener sits in a long transaction. The spine's `run_timeline(run_id, seq)` payload is tiny and commit-time delivery matches AD-3's "before anything else can observe it". postgres.js `sql.listen(channel, onnotify, onlisten)` opens "a dedicated connection … to ensure that you receive notifications instantly", reconnects with backoff, and fires `onlisten` on every (re)connect — the natural hook for cursor replay from the Timeline. LISTEN requires a session-pinned connection, so AD-8/AD-17 should state that the web and worker connect to PostgreSQL directly (Railway's template does not front the database with a transaction-mode pooler); introducing PgBouncer in transaction mode later would break the live channel.

Sources: <https://www.postgresql.org/docs/current/sql-notify.html>, <https://github.com/porsager/postgres#listen--notify>.

### TR2-09 — Low — Solari browser claims verified; Playwright must track Solari's 1.62.x pin, and replay/retention remains undocumented

Solari's browser docs confirm the spine's request-interception claim: the SDK returns a Playwright-shaped browser, "Anything that works in Playwright works on a Solari browser", and "Route handlers let you inspect, modify, mock, or block requests", so an origin allowlist via `page.route` is supported. Accessibility snapshots come from the same Playwright surface (`getByRole`, aria snapshots), satisfying the web half of AD-4. Two constraints to record: the `wsEndpoint` path pins Playwright/Patchright clients to `1.62.x` and `@solarisdk/browser@0.1.2` depends on `patchright-core@1.62.2`, so the Stack's Playwright 1.62.1 must move in lockstep with Solari (CDP connection has no pin); and session recording "captures input values by default" with no documented retention window, which reinforces AD-9's rule that Replay never depends on provider recordings and that credentials are typed only via the platform. Regions remain `us-west` only.

Sources: <https://docs.getsolari.com/browser-api>, <https://docs.getsolari.com/recording>, <https://registry.npmjs.org/@solarisdk/browser>, <https://registry.npmjs.org/patchright-core>.

## 3. Vendor claims verified without finding

| Spine claim | Source check | Result |
| --- | --- | --- |
| Railway Buckets: S3-compatible, private, public-network endpoint only, encrypted at rest, no server-side encryption / versioning / object lock / lifecycle, two-day restore window, no backups or snapshots (AD-5, AD-11) | Railway Storage Buckets docs list exactly those supported and unsupported S3 features, "Buckets are currently only accessible via public networking", "encrypted at rest", "stays restorable for two days" | Matches |
| Better Auth owns PostgreSQL-backed sessions only (AD-7) | Session table `id, token, userId, expiresAt, ipAddress, userAgent`; 7-day expiry with 1-day `updateAge`; `revokeSession/revokeSessions/revokeOtherSessions`; optional cookie cache and secondary storage; peer deps `next ^16`, `drizzle-orm ^0.45.2` | Matches; keep secondary storage off to honour AD-8 |
| Next.js 16 route handler streams SSE (AD-17) | Route handler docs show `new Response(new ReadableStream(...))`; GET dynamic by default since v15 | Matches (see TR2-02 for proxy limits) |
| Node.js 24 LTS satisfies all engines (AD-11) | next >=20.9, pg-boss >=22.12, ai >=22, vitest >=24 accepted, resend/playwright/solari >=20 | Matches |
| PostgreSQL 18 major; pg-boss needs 13+ | postgresql.org: 18.6 current; pgboss.io: "PostgreSQL 13 or higher" | Matches |
| Model IDs `gpt-5.6-sol`, `gpt-5.6-terra`, `claude-sonnet-5` and `ghcr.io/railwayapp-templates/postgres-ssl:18` | Verified in the revision-1 review on the same date; not re-fetched | Carried forward |

## 4. Memlog cross-check

The memlog's version entries (Node 24 LTS, Next 16.3.4, React 19.2.8, PostgreSQL 18.6, pnpm 11.25.0, pg-boss 12.29.0, Drizzle 0.45.2/0.31.10, Better Auth 1.7.2, Solari 0.1.2, S3 3.1123.0, @ai-sdk/openai 4.0.53, @ai-sdk/anthropic 4.0.46, @sentry/node 10.73.0, resend 6.25.0) were all accurate at the time they were recorded; only the four in TR2-04 have since moved. The memlog's revision-2 note that "@solarisdk/sandbox 0.1.2 describes ephemeral compute sandboxes with optional desktops over a computer-use action API" and its open question on AT-SPI are correct; TR2-01 is the spine text lagging the memlog, not a new discovery. The memlog's "pg-boss 12.29.0 includes cron-parser (cron schedules exist but are not the Schedule source of truth)" is confirmed by the dependency list and by the open missed-window issue.

## 5. Remaining Critical or High findings

TR2-01 (High) — resolve by amending AD-4's desktop sentence and promoting the LedgerDesk control-tree prerequisite from memlog question to spine text. No Critical findings.
