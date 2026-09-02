---
title: "Story 1.7 review — authorization, persistence and boundaries"
lens: "authorization, persistence, boundaries"
date: 2026-09-02
---

# Story 1.7 review — authorization, persistence, boundaries

Branch `claude/codebase-architecture-overview-pv0nt7`, commit `5e4513e`, diff `184ffa0..HEAD`.
Live database: `postgres://postgres:postgres@localhost:55432/intellifin_ci`, `max(schema_meta.version) = 6`.

Files in this lens:
`apps/web/app/administration/sources/**`, `packages/infrastructure/src/sources/*.ts`,
`packages/infrastructure/drizzle/0006_absent_thanos.sql` + `drizzle/meta/*`,
`packages/infrastructure/src/db/{schema.ts,schema.test.ts,compat.ts}`,
`tests/integration/{sources,schema-compat}.test.ts`.

## Verdict

The three things the story is actually about hold, and I proved each by breaking it:

- **Atomicity is real.** Mutating `sources-unit-of-work.ts:40` to hand the writer the pool instead
  of the transaction handle failed **exactly** the two atomicity tests and nothing else.
- **The stale-row guard is really exercised.** Removing `.for('update')` from
  `binding-repository.ts:153` failed the held-transaction test, and the stale tab **reverted the
  retirement** (`ok:true, published:false, annotated:true`, `status` back to `active`) — the exact
  defect Story 1.6 paid for.
- **Every CHECK constraint in 0006 fires**, verified by hand with raw SQL in `BEGIN/ROLLBACK`.
  `cardinality` was used, so the empty `declared_schema` really is rejected (the `array_length` trap
  was avoided), and `sensitive_fields <@ declared_schema` fails closed on NULL elements.
- `pnpm boundaries` passes, 183 modules cruised. No new AD-1 rule is needed and none is missing.

Nothing here is a BLOCKER. There are four SHOULDs, three of which are one class: **a guarantee is
stated at the layer that cannot be routed around, and then a value that gets past it is trusted.**

---

## 1. Every CHECK constraint in migration 0006, tested by hand

All statements ran inside `BEGIN … ROLLBACK`. Column order is the table's declaration order.
`:D` is `'aaaa…a'` (64 lower-case hex).

### Result table

| # | Row attempted | Expected | Actual |
|---|---|---|---|
| C1 | `kind = 'sftp-drop'` | reject | **rejected** `_kind_vocabulary` |
| C2 | `declared_count_mechanism = 'guess'` | reject | **rejected** `_mechanism_vocabulary` |
| C3 | `status = 'archived'` | reject | **rejected** `_status_vocabulary` |
| C4a | `declared_schema = ARRAY[]::text[]` | reject | **rejected** `_schema_present` |
| C4b | `declared_schema = ARRAY[NULL]::text[]` | reject | **ACCEPTED — see SHOULD-1** |
| C4c | `declared_schema = ARRAY['']` | reject | **ACCEPTED — see SHOULD-1** |
| C5a | `sensitive={b}`, `declared={a}` | reject | **rejected** `_sensitive_fields_declared` |
| C5b | `sensitive = ARRAY[]::text[]` | accept | **accepted** (correct: an empty mask set is legal) |
| C5c | `sensitive={NULL}`, `declared={a}` | reject | **rejected** — fails closed |
| C5d | `sensitive={a,NULL}`, `declared={a}` | reject | **rejected** — fails closed |
| C5e | `sensitive={NULL}`, `declared={NULL}` | reject | **rejected** — fails closed |
| C6a | `manual-upload` **with** a location | reject | **rejected** `_location_matches_kind` |
| C6b | `versioned-file` with `''` | reject | **rejected** `_location_matches_kind` |
| C6c | `versioned-file` with `'   '` | reject | **rejected** (btrim works) |
| C6d | `manual-upload` with `'  '` | reject | **rejected** (both directions really hold) |
| C7a | digest in UPPERCASE hex | reject | **rejected** `_digest_format` |
| C7b | `digest = 'abc'` | reject | **rejected** `_digest_format` |
| C7c | 64 hex + `\n` + junk (regex anchor) | reject | **rejected** — `~` is not multiline here |
| C8 | the row the command writes | accept | **accepted** |
| U1 | UPDATE narrowing `declared_schema` under an existing mask | reject | **rejected** `_sensitive_fields_declared` |

The masking rule therefore holds on UPDATE as well as INSERT — the case that matters, because a
binding is edited far more often than it is created.

### Exact SQL and output for the two that matter most

**C4a — the `array_length` trap was avoided. Empty schema is genuinely refused.**

```sql
BEGIN;
INSERT INTO population_source_binding VALUES
 ('00000000-0000-7000-8000-000000000004','x','versioned-file','s://x',
  ARRAY[]::text[],'none',ARRAY[]::text[],'','active',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
ROLLBACK;
```
```
ERROR:  new row for relation "population_source_binding" violates check constraint
        "population_source_binding_schema_present"
DETAIL:  Failing row contains (..., {}, none, {}, , active, aaaa..., ...).
```

Independently confirmed that the trap is real and the choice was load-bearing:

```sql
SELECT array_length(ARRAY[]::text[], 1) AS len, cardinality(ARRAY[]::text[]) AS card;
--  len | card
-- -----+------
--      |    0     <- array_length is NULL; a NULL CHECK PASSES
```

**C4b / C4c — `cardinality >= 1` counts elements, not field names. Both get through.**

```sql
BEGIN;
INSERT INTO population_source_binding VALUES
 ('...05','x','versioned-file','s://x',ARRAY[NULL]::text[],'none',ARRAY[]::text[],'','active',:D);
ROLLBACK;
-- INSERT 0 1        <- ACCEPTED

BEGIN;
INSERT INTO population_source_binding VALUES
 ('...06','x','versioned-file','s://x',ARRAY['']::text[],'none',ARRAY[]::text[],'','active',:D);
ROLLBACK;
-- INSERT 0 1        <- ACCEPTED
```

**C5c/C5d/C5e — `<@` with a NULL element fails closed, which is the right direction.**

```sql
BEGIN;
INSERT INTO population_source_binding VALUES
 ('...09','x','versioned-file','s://x',ARRAY['a'],'none',ARRAY[NULL]::text[],'','active',:D);
ROLLBACK;
```
```
ERROR:  new row for relation "population_source_binding" violates check constraint
        "population_source_binding_sensitive_fields_declared"
DETAIL:  Failing row contains (..., {a}, none, {NULL}, ...).
```
Same refusal for `{a,NULL} <@ {a}` and for `{NULL} <@ {NULL}`. So **no NULL can ever reach
`sensitive_fields`.** Only `declared_schema` is exposed, which is what SHOULD-1 is about.

**C5b — the empty case, which had to be checked because it is the one that must pass:**
`ARRAY[]::text[] <@ ARRAY['a']` is `true`, and the row was accepted. Correct: a binding with no
masked field is legal, and it is not the empty-schema case.

---

## SHOULD-1 — `_schema_present` accepts a schema of one nameless field, and the read adapter trusts it

`packages/infrastructure/drizzle/0006_absent_thanos.sql:45`
`packages/infrastructure/src/db/schema.ts:480`
`packages/infrastructure/src/sources/binding-repository.ts:81`

The migration header says this constraint "refuses a binding that declares no fields at all", and
the whole point of putting it in the table is the writer that has not read the command — "a future
migration, a restored dump or a psql session" (`binding-repository.ts:73-79`). Against exactly that
writer it does not hold: `ARRAY[NULL]` and `ARRAY['']` both have `cardinality = 1`, both were
inserted (C4b, C4c above), and neither declares a field anything could be evaluated against.

The second half is what makes it matter. `toBinding` (`binding-repository.ts:81`) is written to
defend against precisely this row — it drops a row whose `kind`, `declared_count_mechanism` or
`status` is outside the vocabulary — but it passes `declared_schema`, `sensitive_fields` and
`digest` straight through. So a `{NULL}` row is **not** dropped: it is returned as
`declaredSchema: string[]` that actually contains `null`, into a surface whose TypeScript says it
cannot. That is the inverse of the same file's stated rule, in the same function.

Note the two halves fail in opposite directions and both are wrong: an uninterpretable **scalar**
vanishes from the list with no telemetry and no trace (an administrator sees a shorter list and no
reason), while an uninterpretable **array** is rendered as if it were fine.

**Patch (verified against the live database — all six cases behaved as stated):**

```sql
-- 0007, and the same expression in schema.ts
ALTER TABLE population_source_binding DROP CONSTRAINT population_source_binding_schema_present;
ALTER TABLE population_source_binding ADD CONSTRAINT population_source_binding_schema_present
  CHECK (cardinality(declared_schema) >= 1
         AND array_position(declared_schema, NULL) IS NULL
         AND array_position(declared_schema, '')   IS NULL);
```

Verified: rejects `{}`, `{NULL}`, `{a,NULL}`, `{''}`, `{a,''}`; accepts `{a,b}`.
`array_position(arr, NULL)` returns the index when a NULL is present and `NULL` when it is not, so
`IS NULL` is a real boolean and cannot itself evaluate to NULL — unlike the obvious
`'' <> ALL(declared_schema)`, which I measured returning **NULL** when the array holds a NULL, i.e.
a passing CHECK. That is the same trap as `array_length`, one operator along.

Then close the read side in `toBinding`:

```ts
if (row.declaredSchema.some((f) => typeof f !== 'string' || f.trim() === '')) return null;
if (row.sensitiveFields.some((f) => typeof f !== 'string' || f.trim() === '')) return null;
if (!/^[0-9a-f]{64}$/.test(row.digest)) return null;
```

and report the drop through `runtime.telemetry` rather than dropping it in silence.

---

## SHOULD-2 — `SUPPORTED_SCHEMA_MIN = 1` is a claim this build cannot keep (answers point 6)

`packages/infrastructure/src/db/compat.ts:26-27`

`SUPPORTED_SCHEMA_MAX = 6` **is** correct: generation 6 is the highest the migrations seed
(`_journal.json` idx 6, `0006_absent_thanos.sql` seeds `VALUES (6)`), and
`schema-range.test.ts` proves it by reading the files. The live database reports 6.

**Generation 6 is safe forward.** It adds one table and touches nothing existing, so a generation-5
process that keeps running never selects from it — the migration header's claim is true, and I
confirmed no `ALTER`/`DROP` in the file.

**It is not safe backward, and the guard that is supposed to say so does not.** The declared range
is `1..6`. A generation-6 image booting against a generation-5 database passes
`assertSchemaSupported` and then 500s on `/administration/sources` with
`relation "population_source_binding" does not exist`. That is not hypothetical: the same build
also queries `target_system_registration` (generation 5), `user_role` and `auth_session`
(generation 3) and `audit_events` (generation 2), so the honest minimum for this image is 6.
`tests/integration/schema-compat.test.ts:60` asserts the database has **exactly** the
generation-6 table list — the suite already knows this build requires generation 6; only
`compat.ts` disagrees.

This predates Story 1.7 (it was already false at 5), but 1.7 is the third generation to widen the
gap and the story is the one that raised `MAX`.

**Patch:** in the same commit as any migration that adds a table this build reads,

```ts
export const SUPPORTED_SCHEMA_MIN = 6;
```

and strengthen `schema-range.test.ts`, which today only checks `1 <= MIN <= MAX`:

```ts
it('declares a min no lower than the generation that created any table the build queries', () => {
  // every pgTable in schema.ts must have been created at or before SUPPORTED_SCHEMA_MIN
  expect(SUPPORTED_SCHEMA_MIN).toBe(highestGenerationThatCreatesATable());
});
```

Read the `CREATE TABLE` statements out of `drizzle/*.sql` the way `seededGenerations()` already
reads the seeds. Without it, the next story raises `MAX` and leaves `MIN` behind again.

---

## SHOULD-3 — a non-UUID path segment is a 500, where a 404 belongs

`apps/web/app/administration/sources/[bindingId]/page.tsx:50`

`bindingId` comes straight off the URL bar into a `uuid` column comparison. Measured:

```
$ psql -c "SELECT binding_id FROM population_source_binding WHERE binding_id = 'not-a-uuid';"
ERROR:  invalid input syntax for type uuid: "not-a-uuid"
```

`findBinding` therefore throws instead of returning `null`, `notFound()` is never reached, and
`/administration/sources/abc` renders `app/error.tsx` — a 500 for a URL anybody can type, one
database round trip and one captured error per probe. This is the class CLAUDE.md already records
for `decodeURIComponent` in the breadcrumbs ("`/runs/%E0%A4%A` is a URL anybody can type;
unguarded, the URIError takes down every page under the shell"), and Story 1.6's
`registrations/[registrationId]/page.tsx:47-52` has the identical shape — so this is the second
occurrence, not the first.

The Server Action gets this right (`actions.ts:217`), which is what makes the page the gap.

**Patch —** guard in the adapter, so every caller is covered rather than every page:

```ts
// binding-repository.ts, DrizzleBindingRepository.findBinding
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
async findBinding(bindingId: string): Promise<PopulationSourceBinding | null> {
  if (!UUID.test(bindingId)) return null;   // a segment that cannot be an id is not a row
  ...
}
```

Do the same in `DrizzleRegistrationRepository.findRegistration` while the fix is in hand.

---

## SHOULD-4 — the command trusts the Server Action's id check

`packages/application/src/sources/register-population-source.ts:452` (`changePopulationSource`)

The command validates `bindingId` only as `bindingId.trim() === ''`. The UUID shape check lives
solely in the Server Action (`actions.ts:217`). Today that is sufficient because the action is the
only caller; the command is the reusable unit, and the next caller (a route handler, the worker,
the integration suite) that passes a raw string gets a postgres `22P02` out of
`bindings.findBinding` — thrown from **inside** the unit of work, so it is not a `CommandRefused`
and not a refusal sentence, but an exception the caller must translate.

The story's own rule is that a boundary check is not a substitute for the command's:
`ports.ts:70-80` argues the writer's read must be inside the transaction for exactly this reason.

**Patch:**

```ts
const BINDING_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
if (!BINDING_ID.test(bindingId)) return refuse(BINDING_REFUSALS.UNKNOWN_BINDING);
```

`UNKNOWN_BINDING`, not a new sentence: a malformed id and an id that is not there must be
indistinguishable, or the surface answers "does this id exist" differently for the two.

---

## 2. The Server Actions — authorization first, and hostile input (all measured)

`apps/web/app/administration/sources/actions.ts`

**Order is correct in both.** `createBindingAction:161` and `changeBindingAction:209` call
`requireServerAction('administration.bindings.manage')` as the **first statement**, before any
property of the argument is read; `isBindingFormFields` is line 164 / 212. Confirmed by test: a body
of `{ nonsense: true }` from an Auditor returns the **role** refusal, not the malformed one, so an
unauthorized caller cannot learn which fields exist. `dependencies()` — and therefore
`getRuntime()` — is reached only after both checks, so a refused or malformed caller never causes
the process to open a database connection.

The gated action name is real: `administration.bindings.manage` is entry 24 in
`GATED_ACTIONS` (`packages/domain/src/identity/roles.ts:56`) and is `ADMINISTER` in the table at
`:178`. Both pages call the same action, so the page and the action agree.

**Hostile input.** I ran a throwaway probe (`zzhostile.test.ts`, since deleted) with
`requireServerAction` mocked ALLOWED, and logged the result plus whether the command and the runtime
were reached. Every one of these was refused with the single `MALFORMED` sentence and **`getRuntime`
was called 0 times**:

`[]` · `'x'` · `7` · `true` · `JSON.parse('{"__proto__":{…}}')` · `declaredSchema:['a',null]` ·
`declaredSchema:[['a']]` · `declaredSchema:[{}]` · `sensitiveFields:{0:'salary',length:1}` ·
`status:'constructor'` · `kind:'__proto__'` · `kind:'valueOf'` · `location` 1001 chars ·
`note` 1e6 chars · `declaredSchema` of 100 000 entries.

Prototype keys are safe for a good reason and not by luck: `isPopulationSourceKind`,
`isDeclaredCountMechanism` and `isBindingStatus` are all `Array.includes` over a frozen tuple
(`population-source.ts:38,57`, `ports.ts:24`), not an object index — so the `Object.hasOwn` defect
that has now bitten four times cannot occur here. Worth saying out loud in review, because the next
person adding a vocabulary will reach for a lookup table.

Bounds agree on both sides, which is what makes the boundary a bound and not a second opinion:
`MAX.displayName/location/note/listItems/listItem = 200/1000/2000/200/200` (`actions.ts:52-62`)
match `BINDING_LIMITS.displayName/location/note/schemaFields/fieldName`
(`register-population-source.ts:83-91`).

Two behaviours worth recording, neither a defect:

- An **inherited-value object** (`Object.create(VALID)`, no own properties) is accepted and reaches
  the command. That is fine — the *values* are validated, and the reader is `fields['displayName']`
  with a literal key, never a key taken from the request.
- `expectedRowVersion` is bounded to 64 characters but not shape-checked, so `''` and
  `'<script>xxx…'` reach the command. Also fine, and fail-closed: neither can equal a real
  `bindingRowVersion`, so both produce `STALE_ROW`. It never enters an audit payload — unlike
  `bindingId`, whose shape check at `:217` is correctly justified in the comment there.

### CONSIDER-A — `actions.test.ts:189` names one property and asserts another

`apps/web/app/administration/sources/actions.test.ts:189`

The test is called `passes the row version through unchanged, so the guard is the command's`, and
what it asserts is `reason === 'The change could not be saved. Nothing was changed.'` — the
`getRuntime`-threw path. Its own comment admits it ("`dependencies()` reaches the runtime, so this
asserts the failure path's message rather than the command call"). Replace
`expectedRowVersion` with `'nonsense'` and the test still passes; delete line 234 and it still
passes. It proves nothing about the row version.

Fix: mock `@intellifin/infrastructure` alongside `@intellifin/application` so `dependencies()`
resolves, then assert the argument:

```ts
expect(changePopulationSource).toHaveBeenCalledWith(
  expect.anything(),
  expect.objectContaining({ bindingId: VALID_CHANGE.bindingId,
                            expectedRowVersion: VALID_CHANGE.expectedRowVersion }),
);
```

---

## 3. Atomicity — proved by mutation

`packages/infrastructure/src/sources/sources-unit-of-work.ts:40`

The design is sound by construction: `SourcesUnitOfWorkContext` (`ports.ts:88-96`) exposes exactly
two writers, both built from the `transaction` handle, and `DrizzleBindingWriter`'s constructor
takes `Transaction`, never `Database` — so there is no reachable binding writer outside the
transaction. That is a compile-time property, which is stronger than a test.

Forced append failure is already covered honestly: `dependencies({ failIds: true })` installs an id
generator returning `'not-a-uuid-v7'`, which the canonical envelope rejects, so the append throws
**after** the state write inside the same transaction — the ordering the claim is about, not a
pre-flight refusal.

**Mutation applied:** `bindings: new DrizzleBindingWriter(this.db as unknown as typeof transaction)`.

```
FAIL  stores nothing when the audit append fails
  expected 0 to be 1                              tests/integration/sources.test.ts:316
FAIL  leaves the binding untouched when the change event cannot be appended
  expected '27bc52b9…' to be '4a1d78c2…'          tests/integration/sources.test.ts:420
Tests  2 failed | 18 passed (20)
```

Exactly the two atomicity tests, and no others. The second failure is the interesting one: the row
kept the **new** digest after the append threw — a binding whose contract silently moved with
nothing in the chain, which is the unaudited configuration change FR-45 exists to prevent. Restored;
20/20 pass.

---

## 4. The stale-row guard under real concurrency — proved by mutation

`tests/integration/sources.test.ts:458`, `packages/infrastructure/src/sources/binding-repository.ts:153`

The test does hold the first transaction open, and correctly: `held` wraps the **real**
`PostgresSourcesUnitOfWork` and awaits a gate **after** `work(context)` returns and **before**
the callback resolves, so the lock, the read, the write and the append have all happened and the
COMMIT has not. The second call is started inside that window (`await wait(250)` on both sides).
The scenario chosen is the right one: the first administrator **retires** the binding, and `status`
is not digest-bearing, so a digest-shaped token would let the second save through.

**Mutation applied:** deleted `.for('update')` from `DrizzleBindingWriter.findBinding`.

```
FAIL  refuses a second change made while the first transaction is still open
  expected { ok: true, … } to deeply equal { ok: false, … }
  +  "annotated": true,  "ok": true,  "published": false,
  +  "priorDigest": "4a1d78c2…",  "digest": "4a1d78c2…"
Tests  1 failed | 19 passed (20)
```

So the test is evidence, not decoration — and the mutation reproduces the real defect: the stale tab
sailed past the version check and reverted a retirement, publishing a `binding-annotated` event for
a decision nobody made. Restored; 20/20 pass.

Two supporting details are right and easy to lose in a refactor: `rowVersionOf` reads through the
**repository** rather than reconstructing the token in the test (a token the test builds agrees only
with itself), and `bindingRowVersion` covers all nine mutable fields rather than the five the digest
covers — which is what makes `status` protected at all.

---

## 5. AD-1 boundaries

`pnpm boundaries` → `✔ no dependency violations found (183 modules cruised)`. `check-boundaries.mjs`
still fails a zero-module cruise, so the pass is real.

Nothing new needs a rule, and I checked rather than assumed:

- `packages/infrastructure/src/sources/` contains **no outbound call** — grep for
  `fetch(`, `node:http(s)`, `node:fs`, `axios`, `undici` returns nothing. So there is no
  probe-shaped module needing the `no-target-system-probe-in-apps` treatment, and the folder is
  correctly exported through the barrel (`src/index.ts`) with no subpath.
- `apps/web/app/administration/sources/**` and `apps/web/src/admin/**` import
  `@intellifin/infrastructure` only through the barrel — no deep `@intellifin/infrastructure/…`
  specifier that would slip past the reachability rules.
- The new application module is covered by `application-imports-only-domain`, the new
  infrastructure module by `infrastructure-imports-no-composition-root`, and both new `apps/web`
  route modules by the two `reachable: true` rules — none of which needed editing.

`tests/unit/boundaries.test.ts` plants violations only for the two `apps/`-reachability rules; since
1.7 adds no rule, there is nothing new to plant. Correct as it stands.

---

## CONSIDER-B — `updated_at` is written from the application clock

`packages/infrastructure/src/sources/binding-repository.ts:191` — `updatedAt: new Date()`.

`created_at` comes from `DEFAULT now()` (the database), `updated_at` from the Node process. A
container with a skewed clock writes an `updated_at` earlier than its own `created_at`, and two
rows written by two containers cannot be ordered against each other. Nothing depends on it today —
the audit chain is the ordering of record, and the row version is a hash, not a timestamp — which
is why this is a CONSIDER and not a SHOULD. `sql\`now()\`` costs nothing and removes the question.

## CONSIDER-C — the list truncates at 200 with no index behind the order

`packages/infrastructure/src/sources/binding-repository.ts:39,105-113`

`BINDING_LIST_LIMIT = 200` is right (an unbounded `SELECT` is a query whose cost the data sets), and
the surface is passed the limit so it can say it truncated. But `ORDER BY display_name, binding_id`
has only the primary key behind it, so it is a sort of the whole table on every render of a page
marked `force-dynamic`. Harmless at PoC size; a
`CREATE INDEX ON population_source_binding (display_name, binding_id)` in the next migration keeps
it harmless, and paging is correctly left to its own story.

## CONSIDER-D — nothing stops two bindings sharing a display name

No unique index on `display_name`. Two bindings named `HR leavers export` are told apart in the list
only by their digest, and the audit payload carries `displayName` beside `bindingId`, so the chain
stays unambiguous. Worth a decision rather than a default: either accept it explicitly (bindings are
identified by id, names are labels) or add the index. I would accept it — a forced-unique name is a
worse problem when a binding is retired and replaced.

---

## What I ran, and the state I left behind

```
pnpm boundaries                                              183 modules, 0 violations
pnpm test  schema.test.ts schema-range.test.ts actions.test.ts   46 passed
pnpm test:integration sources.test.ts schema-compat.test.ts      26 passed
```

Mutations applied and **restored**: `sources-unit-of-work.ts:40` (pool instead of transaction),
`binding-repository.ts:153` (`.for('update')` removed). Probe file
`apps/web/app/administration/sources/zzhostile.test.ts` created and deleted. `git diff` against
`5e4513e` is empty; every suite above was re-run green after restoring.

All SQL ran inside `BEGIN … ROLLBACK`; `SELECT count(*) FROM population_source_binding` is `0`
afterwards, and no `schema_meta` row was added or removed.
