---
title: "Story 1.8 review — the connectivity probe, the seeding path, and the boundary rules"
lens: "probe / seed / boundaries"
date: 2026-09-02
---

# Story 1.8 review — probe, seed, boundaries

Diff reviewed: `git diff c79ce07..HEAD` (branch `claude/codebase-architecture-overview-pv0nt7`, commit `cabff89`).

Scope: `packages/infrastructure/src/registrations/probe-runner.ts` and `probe.ts`, the telemetry
changes, the `source` field added to the two commands, `scripts/seed-northstar.mts`,
`tests/integration/probe.test.ts`, `tests/unit/boundaries.test.ts`, `tests/e2e/northstar.*`,
`playwright.config.ts`, `apps/worker/package.json`, `packages/infrastructure/package.json`.

Everything below was reproduced against Node 24.20.0 / pnpm 11.25.0 and the generation-6
integration database at `postgres://postgres:postgres@localhost:55432/intellifin_ci`, with a real
local HTTP/HTTPS target server. Every plant and mutation was reverted; `git status` is clean of
them.

---

## BLOCKER

### B-1. The probe entry point silently does nothing when it is reached through a symlink — which is exactly the deployed worker container

`packages/infrastructure/src/registrations/probe-runner.ts:189`

```ts
const isEntryPoint = process.argv[1] === fileURLToPath(import.meta.url);
```

`process.argv[1]` keeps the path as it was typed (Node makes it absolute but does **not** resolve
symlinks). `import.meta.url` is the **realpath**. Under pnpm's isolated `node_modules`,
`node_modules/@intellifin/infrastructure` is a symlink into `node_modules/.pnpm/...`, so the two
are never equal and the whole `if (isEntryPoint)` block is skipped. The process prints nothing and
exits **0**.

Reproduced against the exact tree the worker image ships — `apps/worker/Dockerfile` builds it with
`pnpm --filter @intellifin/worker --prod deploy --legacy /out`:

```
$ pnpm --filter @intellifin/worker --prod deploy --legacy /out
$ cd /out && DATABASE_URL=... node node_modules/@intellifin/infrastructure/dist/registrations/probe-runner.js
(no output)
exit=0
```

A probe module dropped in beside it confirms the mechanism:

```
argv1     = /out/node_modules/@intellifin/infrastructure/dist/registrations/dbg.mjs
meta.url  = /out/node_modules/.pnpm/@intellifin+infrastructure@file+.../dist/registrations/dbg.mjs
equal     = false
import.meta.main = true
```

The same guard is in `packages/infrastructure/src/db/migrate.ts:54`, so the release migrator has the
identical failure mode the moment it is invoked through a symlinked path. Both are "exit 0, did
nothing" — the worst shape a pipeline entry point can have.

Patch (both files):

```ts
// `process.argv[1]` keeps the symlinked path pnpm's node_modules hands us; `import.meta.url`
// is the realpath, so comparing them is false in every deployed tree and the entry point
// silently no-ops. `import.meta.main` is the question we actually mean.
const isEntryPoint = import.meta.main;
```

Node 24 supports `import.meta.main`; verified `true` in the symlinked tree above. Add a test that
runs the built runner through a symlinked path and asserts it emits `Probe sweep complete`.

### B-2. The sweep reads through the surface's paged list, so it can probe nothing and report success

`packages/infrastructure/src/registrations/probe-runner.ts:138`

```ts
const registrations = await new DrizzleRegistrationRepository(db).listRegistrations();
```

`DrizzleRegistrationRepository` defaults to `REGISTRATION_LIST_LIMIT = 200`
(`registration-repository.ts:43,126,143`), ordered by `display_name`, and the query does **not**
filter on `status`. Retired rows are read, count against the 200, and are then skipped in the loop.
Because "a registration is never deleted; retirement is a status", retired rows accumulate forever.

Reproduced. 9 active Northstar registrations, plus 201 retired rows named `AAAA ZZFILLER 0001…`
(sorting before every real name):

```
active=9  total=221
$ node packages/infrastructure/dist/registrations/probe-runner.js
{"level":"info",...,"message":"Probe sweep complete","probed":0,"probeReachable":0,"probeUnreachable":0,"probeSkipped":0}
```

Nine live systems, `probed: 0`, exit 0, and the Administration surface keeps saying "Never probed"
for all of them with nothing anywhere saying why.

Patch: give the sweep its own read instead of borrowing a UI method whose limit exists for a UI
reason.

```ts
// packages/infrastructure/src/registrations/registration-repository.ts
/** Every ACTIVE registration, unpaged. The surface's 200-row limit is a rendering budget;
 *  a sweep that inherited it would silently stop probing the 201st system. */
async listActiveRegistrationsForProbe(): Promise<readonly TargetSystemRegistration[]> {
  const rows = await this.db.select({ ...SELECTION })
    .from(targetSystemRegistration)
    .where(eq(targetSystemRegistration.status, 'active'))
    .orderBy(asc(targetSystemRegistration.registrationId));
  ...
}
```

and in `runProbeSweep`, call it. Then `probed` equals the active count by construction. Add an
integration case: 201 retired rows sorting first plus one active row, assert `probed === 1`.

### B-3. `PROBE_TIMEOUT_MS` bounds the fetch, not the process — an unread response body parks the sweep indefinitely

`packages/infrastructure/src/registrations/probe-runner.ts:72-80` (`defaultFetcher`) and
`:105-117` (`probeOrigins`).

The status is the whole answer, so the body is never read — which is right for NFR-6 and wrong for
the socket. An unconsumed `fetch` body is never released, the connection stays open, and the event
loop cannot drain. `clearTimeout(timer)` in the `finally` disarms the only thing that would have
torn it down.

Reproduced against a local server that sends headers, writes five bytes, and then holds the
connection (`/slowbody`). One registration, `PROBE_TIMEOUT_MS=3000`:

```
$ time node packages/infrastructure/dist/registrations/probe-runner.js
{"level":"info","time":"...:28:40.002Z",...,"message":"Probe sweep complete","probed":1,...}
real  1m45.914s
```

The sweep finished in 0.75 s. The process then sat for **105 more seconds**. A bare-`fetch`
reduction is worse — it never exited at all inside a 200 s bound:

```
mode=leak   : status 200 after 49ms ... killed at 200s (exit 124)
mode=cancel : status 200 after 49ms ... EXIT at 55ms
abort-in-finally : status 200 ... EXIT at 50ms
```

Consequences: `pnpm probe` hangs long past its own deadline; `tests/e2e/northstar.spec.ts:191`
gives the child process `timeout: 90_000`, which a single such system blows; and the probe keeps
reading bytes from a customer's system it has already decided about.

Patch (`probeOrigins`, one line, verified above):

```ts
    } finally {
      clearTimeout(timer);
      // The status was the whole answer, so the body is never read — and an unread body is
      // an open socket the process cannot exit past. The deadline bounds the fetch; this
      // bounds the process.
      controller.abort();
    }
```

Belt and braces in `defaultFetcher`: `await response.body?.cancel().catch(() => undefined);` before
returning. Add a unit case with a fetcher that resolves while leaving a stream open, and an
assertion on the runner's own exit — the current suite cannot see this at all, because every test
passes a fake `Fetcher` that has no body.

---

## SHOULD

### S-4. The documented operator command cannot run in the worker image, and nothing schedules a sweep

`apps/worker/package.json:10` — `"probe": "pnpm --filter @intellifin/infrastructure probe"`, which
is `"pnpm build && node dist/registrations/probe-runner.js"`
(`packages/infrastructure/package.json:40`). The module docblock
(`probe-runner.ts:20-22`) names `pnpm --filter @intellifin/worker probe` as the way to run it.

In the production deploy tree:

```
$ cd /out && pnpm --filter @intellifin/infrastructure probe
No projects matched the filters in "/out"
$ ls /out/node_modules/.bin/tsc
no tsc
```

The runtime stage is a bare `node:24.20.0-bookworm-slim` with a flattened `--prod deploy` — no
workspace to filter, no `pnpm` activated, no TypeScript to run `pnpm build` with. `.railway/railway.ts`
declares no cron, job or second command for the probe either, so in the deployed product the sweep
never runs and every registration reads "Never probed" forever.

Patch: make the worker script the thing that actually works in the image, and stop rebuilding on
every invocation —

```json
"probe": "node node_modules/@intellifin/infrastructure/dist/registrations/probe-runner.js"
```

(with B-1 fixed, this is the path that runs). Then declare how it is scheduled: either a Railway
cron service, or an interval in the worker's own loop that spawns the entry point as a child
process — an interval that *imports* it is refused by `no-target-system-probe-in-apps`, which is
the rule working as designed. `tests/e2e/northstar.spec.ts` invokes the raw `dist` path directly,
so the pnpm chain is exercised by nothing.

### S-5. An undocumented telemetry field is still dropped in silence — the guard has no guard

I cross-checked every `telemetry.info/warn/error/captureError` call and both raw `log()` helpers
against `TELEMETRY_FIELD_KEYS`. **Nothing is being dropped today.** `configKeys` looked like a
candidate (`boot.ts:48` passes `error.keys`) but `ConfigError.keys` is a comma-separated *string*,
not the `issues` array, so it survives.

What is missing is anything that would notice the next one. `Telemetry`'s methods take
`fields?: unknown` (`packages/infrastructure/src/telemetry/logger.ts:40-43`), so the compiler checks
nothing, and `probe-runner.ts:166` has its own `log(..., fields: Record<string, unknown>)`.
Reproduced: adding `workerGeneration: 7` to `apps/worker/src/main.ts:80` typechecks clean and the
field vanishes at runtime. The new test at `telemetry.test.ts:38` asserts five specific keys — it
would not have caught the probe counts before they were added, and it will not catch the sixth.

Verified patch — tighten the facade:

```ts
  info(message: TelemetryMessage, fields?: TelemetryFields): void;
  warn(message: TelemetryMessage, fields?: TelemetryFields): void;
  error(message: TelemetryMessage, fields?: TelemetryFields): void;
  captureError(message: TelemetryMessage, error: unknown, fields?: TelemetryFields): void;
```

I applied this and ran `pnpm -r typecheck`: **green across the whole repository**, no call site
changes needed. With the plant re-applied it fails exactly where it should:

```
src/main.ts(80,97): error TS2353: Object literal may only specify known properties,
  and 'workerGeneration' does not exist in type 'Partial<Record<"action" | ... , TelemetryScalar>>'
```

Do the same for `probe-runner.ts`'s and `migrate.ts`'s local `log()` (`fields: TelemetryFields`).
`sanitizeTelemetryFields` itself keeps `unknown` — it is the runtime defence against hostile
objects and its tests pass them deliberately.

### S-6. `defaultFetcher` is not exported and nothing tests it; the test that claims to is asserting a fake

`probe-runner.test.ts:23` — *"calls a system with GET only, and sends no body and no credentials"* —
constructs a `recording: Fetcher` and asserts what it was handed. That proves the *port's* shape,
which the comment says out loud, but the module's title claim is about `defaultFetcher`, and
`defaultFetcher` is unreachable from any test. `redirect: 'manual'`, `method: 'GET'`, the header set
and the body handling are all unasserted. This is the CLAUDE.md rule "never assert a contract
against a copy of itself" one step removed.

I verified the real behaviour by observation instead, with a local server logging every request:

| claim | result |
|---|---|
| GET only, no body | 12 requests, all `GET`, no body |
| no credentials | no `authorization`, no `cookie`; sends `accept: */*`, `accept-encoding: gzip, deflate`, `user-agent: node` |
| redirect not followed | `/redirect` → 302 → `/elsewhere` **never hit**; recorded `reachable` |
| redirect loop | `/loop` → 302 → recorded `reachable`, one request, no loop |
| TLS failure | self-signed https → `unreachable` |
| non-http scheme | `file:///etc/passwd` → skipped, zero requests |
| 503 | `unreachable` |
| hang | `unreachable` after exactly one deadline |

All correct. Patch: export `defaultFetcher` (or take a `fetch` seam) and test it against a real
`node:http` server in `tests/integration/`, covering redirect-not-followed and body release. As it
stands, deleting `redirect: 'manual'` leaves the suite green.

### S-7. The seed script's idempotency key is the display name, so a changed base URL is a silent no-op that reports success

`scripts/seed-northstar.mts:206,243` compare only `display_name`; `:218` is the only place the base
URL becomes an origin; `:274` prints the base URL as if it had been applied.

Reproduced, after a first run against `http://localhost:4300`:

```
$ NORTHSTAR_BASE_URL=http://localhost:9999 pnpm seed:northstar --admin-email zzadmin@example.test
target system "LoanCore" already registered; leaving it alone
...
seeded 0 target systems and 0 population source bindings against http://localhost:9999
exit 0

AccessGate|{http://localhost:4300/accessgate}
ApproveNow|{http://localhost:4300/approvenow}
```

Every registration still points at 4300 while the closing line names 9999. `NORTHSTAR_PORT` is an
explicitly supported knob (`tests/e2e/northstar.ts:11-19` derives the unreachable port from it), so
this is a path an operator will take; the probe then reports every system Unreachable and nothing
explains it.

Patch: when a system is already registered, compare the origins it holds with the origins this run
would produce, and say so —

```ts
const existing = registrationsByName.get(system.display_name);
if (existing !== undefined) {
  const wanted = origin(base, system.origin_path);
  if (!existing.allowedOrigins.includes(wanted)) {
    fail(`target system "${system.display_name}" is registered at ${existing.allowedOrigins.join(', ')}, `
       + `not at ${wanted}. Change it on the Administration surface, or seed a fresh database.`);
  }
  say(`target system "${system.display_name}" already registered; leaving it alone`);
  continue;
}
```

Refusing is right rather than silently re-registering: a second registration mints a second digest
for one system, which is the thing the current code correctly avoids.

### S-8. The sweep has a per-origin deadline and no total budget

`probeOrigins` (`:105`) starts a fresh timer per origin and `runProbeSweep` (`:136`) loops
registrations sequentially. Measured: one registration with three dead origins at
`PROBE_TIMEOUT_MS=3000` took 9 s (observed_at deltas in `target_system_probe`). The Server Action
bounds `allowedOrigins` at `MAX.listItems = 100`
(`apps/web/app/administration/registrations/actions.ts:59`), so the worst case at the 5 s default is
100 × 5 s × 200 registrations ≈ 27 hours, and `PROBE_TIMEOUT_MS` is the only lever
(`probe-runner.ts:196`). The docblock at `:180-183` notices half of this ("five seconds times the
number of them") and treats a per-call knob as the answer.

Patch: give the sweep a wall-clock budget as well — a `deadline = now + PROBE_SWEEP_BUDGET_MS`
checked at the top of the registration loop, with anything past it left unprobed and reported as a
`budgetExhausted` count in the summary line (add the key to `TELEMETRY_FIELD_KEYS`). Silence is the
only thing that must not happen.

---

## CONSIDER

### C-9. The seed script validates the fixture file's synthetic marker but not the database

`scripts/seed-northstar.mts:118-124` refuses a catalogue that does not carry
`SYNTHETIC-NORTHSTAR-FIXTURE`. Nothing checks where the rows are going. `DATABASE_URL` pointed at a
production deployment writes 9 fake Target Systems and 6 bindings that, by the project's own rule,
can never be deleted — only retired — plus 15 permanent audit events. `tests/e2e/accounts.ts`
already has `assertThrowawayDatabase` for a far smaller blast radius. Reuse it, or require an
explicit `--i-know-this-is-not-production`.

### C-10. An origin with embedded credentials reads as Unreachable forever, with no explanation

Verified: a registration at `http://zzuser:zzsecret@127.0.0.1:4801/plain` was recorded
`unreachable` and **no request reached the server** — undici rejects a URL carrying credentials
before it opens a socket. The good news is real: no credential is ever sent. But the operator sees a
system that is up reported as down, permanently, with no way to tell it from a real outage.
`probeOrigins` should treat `url.username || url.password` as not-probeable (the same class as
`file:`) so the surface keeps saying "Never probed" rather than making a false claim — and the
registration form should refuse such an origin.

### C-11. The summary counts observations that were not written

`probe-runner.ts:154-159` increments `reachable`/`unreachable` regardless of `recorded`. A
registration deleted between the read and the write is discarded by design
(`probe.ts:recordProbe` returns `false`), but the log line still counts it. Count on `recorded`, or
report a `probeDiscarded` count.

### C-12. `no-target-system-probe-in-apps` does not see a transitive reach through the built barrel

Every spelling I planted fires — relative `src`, relative `dist`, the `@intellifin/infrastructure/probe`
and `/probe-runner` subpaths, `export type` re-export, `await import(...)`, `require()` in a `.cjs`,
from `apps/web/src`, `apps/web/app/**/route.ts`, `apps/worker/src` and the new `apps/northstar/src`,
and — the valuable one — a barrel re-export: appending `export * from './probe-runner.js'` to
`packages/infrastructure/src/registrations/index.ts` made **every existing** `apps/web` import of the
barrel a violation. `reachable: true` works.

The one gap: `doNotFollow` stops the cruise at `dist`, so an import spelled at
`packages/infrastructure/dist/index.js` that reaches the probe *through* `dist` is invisible. Planted
and confirmed: with `export * from './probe-runner.js'` appended to
`packages/infrastructure/dist/registrations/index.js`, a file importing `.../dist/index.js` cruised
clean. Nothing in the repository imports a `dist` barrel path, and a *direct* `dist` import of the
probe is caught, so this is narrow — but it is the same shape as the trap the `exclude`/`doNotFollow`
comment already warns about. Either follow our own `dist` or add a rule forbidding `apps/` from
importing any `packages/*/dist/` path at all, which is a better statement anyway.

### C-13. `refuseUnlessReadOnly` declares `source` required and then defaults it again

`packages/application/src/registrations/register-target-system.ts:478` types
`readonly source: AuditEventSource` (not optional) and `:520` still writes `input.source ?? 'web'`.
Dead coalescing; drop it so the required field is actually required.

For the record, item 5 checks out: `web` is still the default for every existing caller — a repo-wide
grep finds `source:` passed only by `scripts/seed-northstar.mts:235,266` (`'platform'`) and one test.
And the field is validated rather than trusted: `packages/domain/src/audit-event.ts:236` rejects
anything outside `AUDIT_EVENT_SOURCES` and throws, which (per the project's own rule) rolls the unit
of work back. The Server Actions rebuild their input key by key
(`toRegistrationFields`, `toBindingFields`), so a hostile `source` in a hand-made POST cannot ride in.

### C-14. `audit_events.source` and `outcome` have no CHECK constraint

The domain validates both; the database does not. Generation 5 gave the registration table
vocabulary CHECKs precisely because "a constraint tested through the command proves nothing about
the constraint". The chain is the one table where an out-of-vocabulary value can never be corrected.

### C-15. `tests/unit/boundaries.test.ts` plants at a fixed path and cruises the whole repository

Two concurrent runs see each other's plants. I hit this for real — six cases failed with
`expected 'error infrastructure-imports-no-composition-root: …' to contain
'no-vendor-sdk-in-business-code'` — because another session was running the same file. Re-run in
isolation: 13/13 green. Not caused by this diff, but it will read as flakiness in CI the first time
two jobs share a checkout. Plant under a per-process directory
(`__boundary_violation__-${process.pid}`) and add it to the cleanup glob.

---

## Verified correct

- **AD-10 (item 1).** Every spelling I could construct is refused; see C-12 for the list and the one
  gap. All plants reverted; `git status` carries no trace of them.
- **The write path.** `recordProbe`'s single `INSERT … SELECT … WHERE EXISTS … ON CONFLICT DO UPDATE`
  behaves: one row per registration, replaced not appended, and a probe for a removed registration
  returns `false` without erroring. `tests/integration/probe.test.ts` — 5/5 green against
  PostgreSQL 18.6 / generation 6.
- **NFR-6.** `target_system_probe` has exactly four columns and none can hold a response body, header,
  redirect target or error string. Nothing about what the probe saw reaches the log line either.
- **Retirement and desktop systems.** A retired registration is not probed; a registration with no
  probeable origin is skipped rather than called unreachable.
- **The seed script is idempotent (item 4).** Run 1: 9 systems + 6 bindings, 15 audit events. Run 2:
  15 "already registered; leaving it alone" lines, `registered 0 / bound 0`, and the audit table
  unchanged at 250 rows. Events carry `source = platform` and `correlation_id = seed-northstar:<id>`
  exactly as intended. Nothing it writes or prints carries a secret: `credentialRef` is a reference,
  `CREDENTIAL_CAPABILITIES` is a declaration, and the script refuses to start unless the reference is
  declared read-only. (Its one gap is the base-URL case, S-7, and the missing database check, C-9.)
- **Item 6, end to end.** With the 9 seeded systems and Northstar running on 4300: the Administration
  surface rendered "Never probed" 9 times and "Reachable" 0 times; `pnpm probe` wrote 9 `reachable`
  rows; the same page then rendered "Never probed" 0 times, "Reachable" 9 times, each with a UTC
  timestamp. The worker writes, the web reads, and the column stops saying "Never probed" — subject
  to B-1 and S-4, which mean this journey works from a developer checkout and not from the shipped
  container.
- **Workspace install.** `apps/northstar` is a new lockfile importer that neither Dockerfile copies a
  `package.json` for; I simulated the deps stage exactly and `pnpm install --frozen-lockfile`
  succeeded. Not a problem.
