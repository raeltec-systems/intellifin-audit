---
title: Story 1.6 review — persistence, migrations, transactions and boundaries
lens: data
date: 2026-09-02
---

# Story 1.6 review — data lens

Scope: migration 0005 and its metadata, `db/schema.ts`, `db/compat.ts` and their tests,
the registrations unit of work, repository and probe module, `.dependency-cruiser.cjs`
and `tests/unit/boundaries.test.ts`, the two integration suites, both Vitest configs and
`packages/infrastructure/package.json`.

Everything below was run, not read. Baseline `2c692c3`; live database
`postgres://postgres:postgres@localhost:55432/intellifin_ci`, PostgreSQL 18.6, already at
generation 5.

## Verdict

**No BLOCKER.** The six things I was asked to break did not break:

| # | Question | Answer |
|---|---|---|
| 1 | Do the CHECK constraints enforce what their comments claim? | Yes — all five, proven by hand, including the empty-array trap |
| 2 | Does `SUPPORTED_SCHEMA_MAX` equal the highest seeded generation? | Yes — 5, in the same commit, guarded by a test that reads the migrations |
| 3 | Are the registration write and the audit append one transaction on one connection? | Yes — proven by mutation: giving the writer the pool makes exactly the two atomicity tests fail |
| 4 | Does `no-target-system-probe-in-apps` actually fire? | Yes — direct, subpath and transitive spellings all caught |
| 5 | AD-1 / AD-10 violations? | None. `pnpm boundaries` clean over 163 modules; nothing under `apps/` reaches the probe |
| 6 | Does `@intellifin/infrastructure/probe` work from source and from `dist`? | Yes — `types` resolves to `src`, runtime resolves to `dist`, verified by import |

Four SHOULDs and five CONSIDERs follow. Three of them are about guards that read as
protection and are not.

---

## 1. Migration 0005 and the rolling deploy

`packages/infrastructure/drizzle/0005_clumsy_freak.sql`

Two `CREATE TABLE`s, one `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY` between the two
new tables, one `INSERT INTO schema_meta`. No existing table is touched, so no existing
table is locked and no generation-4 query can see a changed shape. `drizzle-kit generate`
reports no drift against `schema.ts` (`No schema changes, nothing to migrate`), so the
hand-appended `schema_meta` line is the only difference between the file and the
generator's output — which is the documented convention.

For a process already running the generation-4 image, 0005 is invisible: it never selects
from either new table, and the AD-15 guard (`assertSchemaSupported`) runs at boot only.
That is genuinely backward compatible, as the file's header claims.

See CONSIDER-1 for the restart case.

### The constraints, tested by hand

Every statement below ran inside `BEGIN; ... ROLLBACK;`. `$D64` is `repeat('a', 64)`.
Table is empty before and after (`select count(*)` = 0 for both tables).

```sql
-- A1 baseline, must be ACCEPTED
INSERT INTO target_system_registration (registration_id, display_name, kind, credential_ref, permitted_actions, digest)
VALUES (gen_random_uuid(),'ok','web','ref-1',ARRAY['navigate','search'],'aaaa…64');
-- INSERT 0 1
```

```sql
-- A2 a write action
… permitted_actions = ARRAY['navigate','create-record'] …
-- ERROR: new row for relation "target_system_registration" violates check constraint
--        "target_system_registration_actions_read_only"
```

```sql
-- A3 THE ONE THE COMMENT IS ABOUT: an empty array
… permitted_actions = ARRAY[]::text[] …
-- ERROR: new row for relation "target_system_registration" violates check constraint
--        "target_system_registration_actions_present"
```

`cardinality` does what the comment says. For completeness, the same database confirms
why `array_length` would not have:

```
=> select array_length(ARRAY[]::text[], 1) is null;  -- t   (and a NULL CHECK passes)
=> select cardinality(ARRAY[]::text[]);              -- 0
```

```sql
-- A4 a NULL element smuggled into the array
… ARRAY['navigate', NULL]::text[] …
-- ERROR: … "target_system_registration_actions_read_only"   (containment is false, so it is refused)

-- A5 kind outside the vocabulary  ('mainframe')
-- ERROR: … "target_system_registration_kind_vocabulary"

-- A6 status outside the vocabulary  ('deleted')
-- ERROR: … "target_system_registration_status_vocabulary"

-- A7 an UPPER-CASE digest
-- ERROR: … "target_system_registration_digest_format"

-- A8 a 63-character digest
-- ERROR: … "target_system_registration_digest_format"

-- A9 64 hex characters + a trailing newline (the POSIX `$` anchor question)
… digest = 'aaaa…64' || E'\n' …
-- ERROR: … "target_system_registration_digest_format"

-- A14 64 hex characters + newline + junk
… digest = 'aaaa…64' || E'\ndeadbeef' …
-- ERROR: … "target_system_registration_digest_format"

-- A10 a probe state outside the vocabulary ('degraded')
-- ERROR: … "target_system_probe_state_vocabulary"

-- A11 a multidimensional array hiding a write action
… ARRAY[ARRAY['navigate'],ARRAY['delete-record']] …
-- ERROR: … "target_system_registration_actions_read_only"   (`<@` flattens; it is caught)

-- A12 an UPDATE, not an INSERT, to a write action
-- ERROR: … "target_system_registration_actions_read_only"

-- A13 an UPDATE to an empty action list
-- ERROR: … "target_system_registration_actions_present"
```

Two anchoring answers worth recording, because both are the kind of thing a reviewer
assumes: PostgreSQL's POSIX `~` is **not** newline-sensitive by default, so `$` means end
of string and A9/A14 are refused; and array containment `<@` flattens a multidimensional
array, so A11 is refused. Neither is an accident waiting to happen.

The one thing the constraint set does **not** refuse is a duplicate:

```sql
-- A15 duplicates, ACCEPTED
… ARRAY['navigate','navigate'] …
-- INSERT 0 1
```

See CONSIDER-3.

---

## 2. `SUPPORTED_SCHEMA_MAX`

`packages/infrastructure/src/db/compat.ts:27` — `SUPPORTED_SCHEMA_MAX = 5`, in the same
commit as `0005_clumsy_freak.sql`, which seeds generation 5. `schema-range.test.ts` reads
the migrations folder, extracts every seeded generation, and asserts the max matches and
that 1..max is seeded with no gaps. It passes. The database reports `max(version) = 5`.

Nothing to raise here.

---

## 3. One transaction, one connection — and the proof

`packages/infrastructure/src/registrations/registrations-unit-of-work.ts:39-44` opens
exactly one `this.db.transaction(...)` and hands the callback a context whose two writers
are both built over the same `transaction` handle:
`createAuditEventWriter(transaction, …)` and `new DrizzleRegistrationWriter(transaction)`.
`DrizzleRegistrationWriter`'s constructor takes `Transaction`
(`registration-repository.ts:181`), a type defined at `db/client.ts:35` as the parameter
Drizzle passes to a transaction callback — so a writer bound to the pool does not
typecheck. Drizzle's postgres-js transaction reserves one connection for its lifetime, so
this is one connection as well as one transaction.

I looked for a second connection on the write path and found none inside the unit of
work. Two reads happen deliberately outside it, on pool connections, and both are correct:
`authorizeCommand` resolves the role before the write
(`register-target-system.ts:408`), and `refuseUnlessReadOnly` appends its refusal event in
its **own** unit of work (`register-target-system.ts:379`) precisely because that event
must commit while nothing is stored. The prior digest the change event names is read
*inside* the transaction, under `FOR UPDATE` (`registration-repository.ts:184-192`), which
is the Story 1.5 lesson applied.

### Atomicity, proven by mutation

The integration suite's two atomicity tests pass. That on its own proves nothing — a
suite that would pass with the guarantee removed is not a test. So I removed it:

```
// registrations-unit-of-work.ts:42, temporarily
- registrations: new DrizzleRegistrationWriter(transaction),
+ registrations: new DrizzleRegistrationWriter(this.db as never),
```

Result, `pnpm test:integration tests/integration/registrations.test.ts`:

```
× stores nothing when the audit append fails
× leaves the registration untouched when the change event cannot be appended
  Tests  2 failed | 14 passed (16)
```

Exactly the two atomicity tests, and only those. Reverted; the file is byte-identical to
the committed version and the suite is 16/16 green again. The append failure is forced by
an id generator that produces a value the canonical envelope rejects, so the throw lands
**after** the state write inside the same transaction — the ordering the claim is about.
The database is left clean (0 registration rows, 0 probe rows, 0 `story-1-6-%` users).

`tests/integration/schema-compat.test.ts` also passes and now asserts the exact
generation-5 table list, so an accidental extra table would fail rather than be absorbed.

---

## 4. `no-target-system-probe-in-apps` — it fires, with one blind spot

Baseline: `pnpm boundaries` → `✔ no dependency violations found (163 modules cruised)`.

I planted a real violating import in `apps/web/src/` three ways and ran the check each
time.

**Plant 1, relative path** (what `boundaries.test.ts` uses):
```
error no-target-system-probe-in-apps: apps/web/src/__review_plant__/violation.ts → packages/infrastructure/src/registrations/probe.ts
x 1 dependency violations (1 errors, 0 warnings). 164 modules cruised.
```

**Plant 2, the realistic spelling** `import { recordProbe } from '@intellifin/infrastructure/probe'` — caught, same rule, same resolved path. This matters: `boundaries.test.ts` only ever tests the relative spelling, and the package-subpath spelling is the one a developer would actually write.

**Plant 3, transitive** — I added `export * from './probe.js';` to
`packages/infrastructure/src/registrations/index.ts` and changed nothing else. 36
violations, every existing `apps/web` and `apps/worker` module that reaches the barrel:
```
error no-target-system-probe-in-apps: apps/web/src/bootstrap.ts → packages/infrastructure/src/registrations/probe.ts
error no-target-system-probe-in-apps: apps/worker/src/main.ts → packages/infrastructure/src/registrations/probe.ts
… 34 more
```
`reachable: true` works. The day someone adds the probe to a barrel, the build stops.

All plants reverted; `pnpm boundaries` is back to `163 modules, no violations`.

**The rule does not depend on `exclude` of `node_modules`** — `node_modules` is in
`doNotFollow` (`.dependency-cruiser.cjs:176`), and `exclude` is scoped to
`^(apps|packages)/...`. That part is right. But see SHOULD-1: the `exclude` it *does*
have opens a different hole in this same rule.

`tests/unit/boundaries.test.ts` passes all 9 cases (21s) including the two new probe cases.

---

## 5. AD-1 and AD-10

Clean. `pnpm boundaries` finds nothing, `pnpm -r typecheck` passes, and grepping `apps/`
for the probe finds only UI copy about the `never-probed` state and comments explaining
why the module is unreachable. `apps/web`'s only new infrastructure import is
`ManifestCredentialProvider` + `credentialCapabilityManifest` in `bootstrap.ts`, which is
configuration read at a composition root — AD-11-shaped, not an outbound call.

The read path cannot probe by construction: `DrizzleRegistrationRepository`
(`registration-repository.ts:123-171`) is a `SELECT` with a `LEFT JOIN` onto
`target_system_probe` and has no writer and no client. `recordProbe` is the only writer
and lives outside every barrel.

`packages/domain` and `packages/application` are untouched by anything in this lens.

---

## 6. The `./probe` subpath export

`packages/infrastructure/package.json:20-23` declares
`"./probe": { "types": "./src/registrations/probe.ts", "default": "./dist/registrations/probe.js" }`,
matching the `./migrate` precedent exactly.

- **Fresh clone, no build:** `types` points at source, so it typechecks with nothing
  built. Confirmed indirectly — `tsc` resolved `@intellifin/infrastructure/probe` in
  `tests/integration/registrations.test.ts:28` without complaint (the only errors that run
  produced were about `@intellifin/application`; see SHOULD-2).
- **Built dist:** `tsconfig.build.json` includes `src/**/*.ts`, so `pnpm build` emits
  `dist/registrations/probe.{js,d.ts}` — verified present. From `apps/worker`:
  ```
  $ node -e "import('@intellifin/infrastructure/probe').then(m=>console.log(Object.keys(m)))"
  OK exports: [ 'recordProbe' ]
  ```
- **Vitest:** both configs alias the subpath ahead of the bare package specifier
  (`vitest.config.ts:21`, `tests/integration/vitest.config.ts:36`), so it resolves to
  source rather than an unbuilt `dist`. The integration suite imports it and passes.

Nothing to raise.

---

# Findings

## BLOCKER

None.

## SHOULD

### SHOULD-1 — the `dist` half of two boundary rules is dead, and an import into `dist` escapes the check entirely

`.dependency-cruiser.cjs:183` (the `exclude` path), against `:100` and `:113`.

Both `no-migrator-in-apps` and `no-target-system-probe-in-apps` match
`^packages/infrastructure/(src|dist)/...`. The `dist` alternative can never match,
because `exclude` drops `^(apps|packages)/[^/]+/(dist|\.next)/` from the graph — and an
**excluded path is not rule-checked at all**, which is the exact trap CLAUDE.md already
records for `node_modules`.

Proven. With `dist` built, planting this in `apps/web/src/`:

```ts
import { recordProbe } from '../../../../packages/infrastructure/dist/registrations/probe.js';
```

gives:

```
warn no-orphans: apps/web/src/__dist_plant__/violation.ts → apps/web/src/__dist_plant__/violation.ts
✔ no dependency violations found (164 modules cruised, 1 warnings)
```

The check **passes**. The orphan warning is the tell: the module's only dependency was
dropped, so dependency-cruiser thinks it has none. Today's realistic spellings all resolve
to `src` (the `types` condition wins), so this is a latent hole rather than a live one —
but it is a hole in the rule this story adds, and its shape is the one the codebase has
already been bitten by twice.

**Patch (verified).** Move built output from `exclude` to `doNotFollow`, so those modules
stay in the graph and stay rule-checked while their contents are not traversed:

```js
  options: {
-   doNotFollow: { path: 'node_modules' },
+   doNotFollow: { path: ['node_modules', '^(apps|packages)/[^/]+/(dist|\\.next)/'] },
    exclude: {
-     path: '^(apps|packages)/[^/]+/(dist|\\.next)/|^(apps|packages)/.+\\.d\\.ts$',
+     path: '^(apps|packages)/.+\\.d\\.ts$',
    },
```

With that applied, the clean run is unchanged
(`✔ no dependency violations found (163 modules cruised)`) and the same dist plant now
fails:

```
error no-target-system-probe-in-apps: apps/web/src/__dist_plant__/violation.ts → packages/infrastructure/dist/registrations/probe.js
x 1 dependency violations (1 errors, 0 warnings). 165 modules cruised.
```

Add a case to `tests/unit/boundaries.test.ts` planting the `dist` spelling, so this cannot
regress. (That case needs `pnpm build` to have run; guard it with `existsSync` on the dist
file and skip otherwise, rather than making the unit suite depend on a build.)

Also worth updating the CLAUDE.md gotcha, which currently says only "never `exclude`
`node_modules`". The rule is broader: **never `exclude` anything a rule's `to.path`
mentions.**

### SHOULD-2 — `tests/integration/` is typechecked by nothing, and the root cannot resolve `@intellifin/application`

`package.json:14` (`typecheck`), `tsconfig.e2e.json:12` (`include`), root
`package.json:26-34` (devDependencies), against
`tests/integration/registrations.test.ts:12`.

`pnpm -r typecheck` covers workspace packages only; the root's second half is
`tsc -p tsconfig.e2e.json`, whose `include` is `["playwright.config.ts", "tests/e2e/**/*.ts"]`.
So `tests/integration/**` and `tests/unit/**` are outside every tsconfig in the repository.

Story 1.6's new `tests/integration/registrations.test.ts` is the first root-level test to
import `@intellifin/application`, and the root does not link it. Running `tsc` over those
folders (temporary config, removed):

```
tests/integration/identity.test.ts(5,55):     error TS2307: Cannot find module '@intellifin/application' or its corresponding type declarations.
tests/integration/manage-users.test.ts(11,8): error TS2307: Cannot find module '@intellifin/application' or its corresponding type declarations.
tests/integration/manage-users.test.ts(597,17): error TS7006: Parameter 'work' implicitly has an 'any' type.
tests/integration/registrations.test.ts(12,8): error TS2307: Cannot find module '@intellifin/application' or its corresponding type declarations.
```

`@intellifin/infrastructure/probe` resolved cleanly — the subpath is fine. It is the
package link that is missing, and nothing noticed because nothing typechecks these files.
The tests run because Vitest aliases the specifier; a type error in a database test is
invisible until it becomes a runtime failure against a real database.

CLAUDE.md already records "The root `package.json` links `@intellifin/domain` and
`@intellifin/infrastructure` as devDependencies" for exactly this reason. The list is now
one short.

**Patch.**

```diff
   "devDependencies": {
     "@intellifin/domain": "workspace:*",
+    "@intellifin/application": "workspace:*",
     "@intellifin/infrastructure": "workspace:*",
```

and widen the root typecheck. Either extend `tsconfig.e2e.json`'s include to
`["playwright.config.ts", "tests/**/*.ts"]`, or add a `tsconfig.tests.json` and chain it:

```diff
-  "typecheck": "pnpm -r typecheck && tsc -p tsconfig.e2e.json --noEmit",
+  "typecheck": "pnpm -r typecheck && tsc -p tsconfig.e2e.json --noEmit && tsc -p tsconfig.tests.json --noEmit",
```

The `TS7006` in `manage-users.test.ts:597` is a real pre-existing `any` that will need
annotating when the gate goes on.

### SHOULD-3 — the empty-array constraint is the one the unit suite does not pin to the migration

`packages/infrastructure/src/db/schema.test.ts:56-72`.

The suite asserts that the generation-5 migration contains the read-only-action CHECK and
the digest-format CHECK, character for character. It does not assert the
`actions_present` one — which is the single constraint the migration's own header and
`schema.ts:349-356` single out as the trap, because the obvious spelling
(`array_length(x, 1) >= 1`) evaluates to NULL on an empty array and therefore **passes**.

Today that is covered only by `tests/integration/registrations.test.ts:462`, which needs a
migrated PostgreSQL 18. A regeneration that emitted `array_length` would sail through
`pnpm test`, and the constraint that is the whole point of the comment would be checked
only in the job most likely to be skipped locally.

**Patch.** In the `target_system_registration check constraints` describe block:

```ts
  it('writes the cardinality form of the non-empty constraint into the generation-5 migration', () => {
    const sql = migration('0005_clumsy_freak.sql');
    expect(sql).toContain(
      `CHECK (cardinality("target_system_registration"."permitted_actions") >= 1)`,
    );
    // `array_length(x, 1)` of an empty array is NULL and a NULL CHECK passes, so the
    // obvious spelling accepts exactly the row this constraint exists to refuse.
    expect(sql).not.toMatch(/array_length\s*\(\s*"target_system_registration"\."permitted_actions"/);
  });
```

### SHOULD-4 — `recordProbe`'s existence check is two statements on two connections, so it does not prevent the failure it is written to prevent

`packages/infrastructure/src/registrations/probe.ts:53-77`.

The doc comment at `:48-52` says "A probe for a registration that has been removed is
discarded rather than failing, because the registration disappearing between the probe and
the write is normal, not an error." The implementation does a `SELECT` on one pool
connection (`:54-59`) and then an `INSERT ... ON CONFLICT` on another (`:61-76`). Nothing
holds the row between them. A registration deleted in that window makes the insert raise
the foreign key, which propagates:

```
=> INSERT INTO target_system_probe (registration_id,state,observed_at,observed_by)
   VALUES ('018f0000-0000-7000-8000-00000000ffff','reachable',now(),'w1');
ERROR:  insert or update on table "target_system_probe" violates foreign key constraint
        "target_system_probe_registration_id_target_system_registration_"
DETAIL:  Key (registration_id)=(018f0000-…ffff) is not present in table "target_system_registration".
```

The window is small and registrations are retired rather than deleted, so this is a
correctness-of-claim issue more than a live defect — but the probe loop Story 1.8 adds
will run this on a timer against every registration, and the integration suite itself
deletes registration rows in `afterAll`. The check also costs an extra round trip on every
observation for a guarantee it does not give.

**Patch.** One statement, which is both atomic and cheaper. The `INSERT ... SELECT` writes
nothing when the registration is gone, and `ON CONFLICT` still handles the replace:

```ts
export async function recordProbe(db: Database, observation: ProbeObservation): Promise<boolean> {
  const written = await db.execute(sql`
    INSERT INTO target_system_probe (registration_id, state, observed_at, observed_by)
    SELECT ${observation.registrationId}::uuid, ${observation.state}, ${observation.observedAt}, ${observation.observedBy}
    WHERE EXISTS (
      SELECT 1 FROM target_system_registration WHERE registration_id = ${observation.registrationId}::uuid
    )
    ON CONFLICT (registration_id) DO UPDATE
      SET state = excluded.state, observed_at = excluded.observed_at, observed_by = excluded.observed_by
    RETURNING registration_id
  `);
  return written.length > 0;
}
```

Add an integration case that deletes the registration between the read and the write (the
`manage-users.test.ts` held-transaction technique) — otherwise the race is untested either
way.

## CONSIDER

### CONSIDER-1 — the migrate-before-deploy window still kills a generation-4 container that restarts

`.github/workflows/release.yml:34-88`, `packages/infrastructure/src/db/compat.ts:27`.

The pipeline is `migrate` → `deploy`. Between them the database is at generation 5 while
every running container is the generation-4 image, whose `SUPPORTED_SCHEMA_MAX` is 4.
Processes that keep running are fine — the guard is boot-time only, and 0005 is invisible
to them. A container that **restarts** in that window (health-check restart, OOM,
autoscale) calls `assertSchemaVersionInRange(5, 1, 4)` and refuses to start, even though
0005 is purely additive and it would serve perfectly.

This is the mirror image of the Story 1.2 incident CLAUDE.md records, and it is a property
of a max-bounded range plus this ordering, not something Story 1.6 introduces. Worth
naming explicitly rather than rediscovering it during an incident. Two honest options:

- **Accept and document.** Add a line to CLAUDE.md: the migrate→deploy window is a period
  in which the previous build cannot boot; keep it short and do not scale during a
  release. Cheapest, and adequate for a PoC.
- **Expand in two releases.** Release N raises `SUPPORTED_SCHEMA_MAX` to `n+1` with no
  migration; release N+1 ships the migration. This makes the running build able to boot
  against the schema its successor installs. It requires relaxing
  `schema-range.test.ts`'s "max equals the highest seeded generation" into "max is the
  highest seeded generation or one more", which weakens the guard that caught the Story
  1.2 class of bug.

I would take the first. The second trades a strong test for a window that only matters if
a container restarts during a two-minute release.

### CONSIDER-2 — `updatedAt` comes from the process clock, not the transaction's

`packages/infrastructure/src/registrations/registration-repository.ts:234` —
`updatedAt: new Date()`.

Every other timestamp written inside a unit of work comes from the injected `Clock`
(`registrations-unit-of-work.ts:32`), and the column's default is `now()`. This one is the
web process's wall clock, so a registration row and the audit event that records the same
change can carry timestamps that disagree by whatever the process's skew is, and a test
cannot control it. Small, but the whole point of the injected clock is that it is the only
one.

**Patch:** `updatedAt: sql\`now()\`` (transaction start time, consistent with the column
default), or thread the `Clock` into `DrizzleRegistrationWriter` the way the audit writer
takes it.

### CONSIDER-3 — the table accepts a duplicated action, so a row can exist whose stored digest does not describe its stored array

Shown above at A15: `ARRAY['navigate','navigate']` is accepted. The command dedups and
sorts before hashing (`register-target-system.ts:263`, and `target-system.ts` sorts again),
so nothing this application writes can drift. A `psql` session can: it can store
`{navigate,navigate}` alongside the digest of `{navigate}`, and every read path will
report a digest that does not describe the row.

There is no cheap patch — a PostgreSQL CHECK cannot contain the subquery a distinct-count
needs, so enforcing it would mean an `IMMUTABLE` helper function, which is more machinery
than the risk deserves. Record it instead: the digest is the authority, the array is its
input, and the two are only guaranteed consistent for rows this application wrote. If it
ever matters, the enforcement point is a `sorted_distinct(permitted_actions) =
permitted_actions` CHECK backed by an immutable SQL function.

### CONSIDER-4 — the worker cannot host the probe loop in `apps/worker`

`.dependency-cruiser.cjs:112` — `from: { path: '^apps/' }`.

The rule forbids `apps/worker` as well as `apps/web`, and the comment explains why: the
worker will invoke the probe as its own entry point "the way the release migrator is
invoked". That is right, and it means Story 1.8's probe loop cannot live under
`apps/worker/src/` at all — it has to live in `packages/infrastructure` beside
`db/migrate.ts` and be started as `node dist/registrations/probe-loop.js`, or in
`scripts/`. Worth writing down now, because the natural place to reach for is
`apps/worker/src/`, and the failure will arrive as a boundary error at the end of the
story rather than a design decision at the start.

### CONSIDER-5 — `no-orphans` will never notice if the probe's caller never arrives

`probe.ts` imports `drizzle-orm` and `db/schema.js`, so dependency-cruiser does not
consider it an orphan (an orphan needs no dependents *and* no dependencies). It currently
has no caller anywhere under `apps/` or `packages/` — the only import is from
`tests/integration/`, which is not cruised. That is intentional for this story, but there
is no signal that will fire if Story 1.8 slips and the module sits unreferenced. A
`TODO(Story 1.8)` in the module header, or a note in the sprint status, is enough.

---

## What I ran

```bash
pnpm boundaries          # ✔ 163 modules, no violations (baseline and after every revert)
pnpm -r typecheck        # all 5 projects pass
pnpm typecheck           # + tsc -p tsconfig.e2e.json, passes
pnpm build               # emits dist/registrations/probe.{js,d.ts}
DATABASE_URL=… pnpm db:generate   # "No schema changes, nothing to migrate"
npx vitest run tests/unit/boundaries.test.ts \
  packages/infrastructure/src/db/schema.test.ts \
  packages/infrastructure/src/db/schema-range.test.ts        # 19 passed
DATABASE_URL=… npx vitest run --config tests/integration/vitest.config.ts \
  tests/integration/registrations.test.ts \
  tests/integration/schema-compat.test.ts                    # 22 passed
psql …/intellifin_ci   # 15 constraint probes, each in BEGIN … ROLLBACK
```

Every plant, mutation and temporary config in this review was reverted in the same shell
call that created it, and the working tree matches the reviewed commit. One exception is
recorded in the summary handed to the parent: an auto-commit swept a scratch file into
`618079a`; it was removed in `1e89234` and is absent from `HEAD` and from disk.
