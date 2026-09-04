# Adversarial Review — Story 2.1 data/infrastructure layer

Scope reviewed: `packages/infrastructure/src/procedures/**`,
`packages/infrastructure/src/db/{schema.ts,compat.ts,identifier.ts}`,
`packages/infrastructure/drizzle/0007_*.sql` + meta snapshots,
`tests/integration/procedures.test.ts`, `tests/integration/schema-compat.test.ts`.

Environment: PostgreSQL 18.6 at `127.0.0.1:5433/intellifin`, already migrated to
generation 7 by another process in this session. All raw-SQL probes below were run
inside `BEGIN; ... ROLLBACK;`. Test-file runs used `pnpm vitest run` directly against
the single files named (never `pnpm test`/`pnpm test:integration`), pointed at the same
database with `DATABASE_URL` set for the invocation only. No `git add`/commit, no
uncommitted mutation left behind.

---

## Blockers

### B1 — `tests/integration/procedures.test.ts` fails on its own happy-path assertions against a real, migrated PostgreSQL 18 (5 of 18 tests, reproduced)

Ran directly:
```
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/intellifin \
  pnpm vitest run --config tests/integration/vitest.config.ts tests/integration/procedures.test.ts
```
Result: **5 failed, 13 passed**, deterministically (re-run gave the same failures).

**B1a — the `sections` shape asserted is not the shape the command stores (4 failures).**
`writes the Procedure, its DRAFT version and one event in ONE transaction` (line 209),
and the parametrized `pre-fills %s with its own defaults` for `P-2`, `P-3`, `P-4`
(line 240), all assert:
```ts
expect(versions[0]?.sections).toEqual({
  templateId: 'P-1',
  sections: initialDraftSections('P-1'),
});
```
i.e. a wrapped `{ templateId, sections }` object. The actual `procedure_version.sections`
column — read straight off the row with `rowsFor()`'s raw SQL, independent of the
repository — holds the **bare array** `initialDraftSections(templateId)` with no
wrapper. This is consistent through the whole write path:
`ProcedureVersionRecord.sections: readonly DraftSection[]` (`packages/application/src/procedures/ports.ts`),
`procedureVersion.sections` typed `jsonb('sections').$type<readonly DraftSection[]>()`
(`packages/infrastructure/src/db/schema.ts`), and
`DrizzleProcedureWriter.insertVersion` writes `sections: [...record.sections]`
(`packages/infrastructure/src/procedures/procedure-repository.ts:274-282`) — an array
literal, never `{ templateId, sections }`. The domain's `DraftSectionsPayload` wrapper
type exists only as the *validator's* input shape (`isValidDraftSectionsPayload`,
consumed by `toSections()` in the repository, which re-wraps the bare array in memory
purely to call the validator and then returns the array back out). The column itself was
never meant to hold the wrapper.

The test's expectation is simply wrong — it was written against the domain's
`DraftSectionsPayload` type name rather than against what the write path actually
persists. **This is the acceptance criterion's core assertion** ("every section
pre-populated from addendum §C for that Template") and it fails for all four Templates,
every time, with no mutation needed.

**B1b — the PoC-Administrator refusal string asserted is the wrong verbatim sentence (1 failure).**
`refuses a PoC Administrator and appends security.denied instead` (line 283) asserts:
```ts
expect(outcome).toEqual({ ok: false, reason: 'Your role does not permit this action.' });
```
The actual, correct refusal — confirmed against
`packages/domain/src/identity/roles.ts` (`ADMIN_CANNOT_AUTHOR`), EXPERIENCE.md's table
row, and `spec-1-3...md` line 137 — is the action-specific sentence:
`'PoC Administrator cannot author Procedures or start Runs.'`. `procedure.author` is
gated with this specific reason, not the generic `DEFAULT_DENIAL_REASON`; the production
code is correct (this is the verbatim EXPERIENCE.md sentence the spec's own acceptance
criterion requires), and the test's expectation is stale/wrong.

**Consequence:** the self-validation report (`_bmad-output/implementation-artifacts/self-validation-2-1.md`, §4) is honest that `pnpm test:integration` was **never run** (no hostable PostgreSQL on the author's Windows sandbox) — so this was never caught, and the report's mutation-table rows 3, 4, 5 and 10 (all named against `tests/integration/procedures.test.ts`) were only exercised against *unit-level equivalents*, never against this file. The spec's own gate ("A gate you did not run is a gate that failed") applies literally here: this file does not currently pass, before any mutation is even planted. Fix the two assertions (unwrap `sections`, use `ADMIN_CANNOT_AUTHOR`'s sentence, e.g. import `PROCEDURE_REFUSALS`-equivalent or the roles module's constant) and re-run for real.

Not a defect in `procedure-repository.ts`, `procedures-unit-of-work.ts`, `schema.ts`, or
the migration — all of those are correct and internally consistent (see "Nothing found
here" below). The defect is entirely in the two assertions named above, in
`tests/integration/procedures.test.ts`.

---

## Should

### S1 — `seedVersionRow()`'s raw-SQL fixture writes a different `sections` shape than the command does

`tests/integration/procedures.test.ts:494-501` (`seedVersionRow`) inserts
`sections` as `JSON.stringify({ templateId: 'P-1', sections: initialDraftSections('P-1') })` —
the same wrapped shape as B1a, not the bare array the real write path stores. It happens
to be harmless for what those particular tests check (they only assert `count(*)` and
`.length`, never decode `.sections` through the repository), but it means this file's
raw-SQL fixture is not representative of a real row, and a future addition to those
tests that does decode `.sections` (e.g. through `DrizzleProcedureRepository`) would
either silently pass on the wrong shape or fail for a reason unrelated to what it's
testing. Align the seed helper with the real column shape (bare array) once B1a is
fixed, so the fixture and the production writer agree.

---

## Consider

### C1 — no test exercises `DrizzleProcedureWriter.updateVersion` or `findVersionForUpdate` returning a row whose `sections` fail `isValidDraftSectionsPayload`

`toVersionRecord`/`toVersionView` treat a row with an invalid `templateId`/`state`/
`sections` combination as absent (`null`), matching the binding repository's precedent
("a kind outside its vocabulary is read as nothing"). Nothing in
`tests/integration/procedures.test.ts` seeds such a row and checks that
`findVersionForUpdate` reports it as `null` (which would make `renameProcedureDraft`
refuse with `UNKNOWN_VERSION` rather than silently operate on a row it can't fully
interpret). Given the CHECK constraints on `template_id` and `state` already make most
of that unreachable through the schema, and only a mismatched `sections` payload could
slip through (jsonb has no CHECK forcing it to match the domain's section shape), a
seeded row with a `sections` value that doesn't match `initialDraftSections` for its own
`templateId` (e.g. wrong number of headings) is worth one raw-SQL case proving
`findVersionForUpdate` returns `null` for it, the same way the binding suite covers its
analogous case. Not required by the spec's explicit task list, so this is a
nice-to-have rather than a gap in acceptance.

### C2 — `procedure` has no `ON DELETE` policy question raised, but no test asserts the cascade either

`procedure_version.procedure_id` is `ON DELETE cascade` (schema.ts:544,
migration line 24). Nothing in this story deletes a `procedure` row (there is no
delete command), so this is inert for Story 2.1, and the spec does not ask for a
retirement/immutability rule the way Story 1.6 states one for registrations. Flagging
only so a later story that adds a delete or retirement path does so deliberately rather
than discovering the cascade by accident — no action needed now.

---

## Nothing found here (verified)

- **CHECK constraints (`0007_shallow_lockheed.sql`).** All four constraints
  (`procedure_control_name_present`, `procedure_template_vocabulary`,
  `procedure_version_control_name_present`, `procedure_version_template_vocabulary`,
  `procedure_version_state_vocabulary`, `procedure_version_number_at_least_one`) were
  independently proved against the live database with raw SQL inside
  `BEGIN;...ROLLBACK;`:
  - `control_name = '   '` on `procedure` → refused
    (`procedure_control_name_present`). Uses `btrim(...) <> ''`, not a bare `<> ''`, so
    whitespace-only is correctly caught — no NULL trap possible since the column is
    `NOT NULL` and `btrim` of a non-null string is never NULL.
  - `template_id = 'P-9'` → refused (`procedure_template_vocabulary`). Plain `IN (...)`
    over a `NOT NULL` column — no `array_length`/`cardinality`/`ALL()` construct
    anywhere in this migration, so the two documented NULL-trap classes (`array_length`
    of an empty array, `NULL <> ALL(x)`) have no surface here at all; there are no
    arrays in either table.
  - `version_number = 0` → refused (`procedure_version_number_at_least_one`).
  - `state = 'CLOSED'` → refused (`procedure_version_state_vocabulary`); every real
    state in `PROCEDURE_VERSION_STATES` accepted (also asserted in the test file and
    passing).
  - Duplicate `(procedure_id, version_number)` → refused by the UNIQUE index
    `procedure_version_procedure_number_uidx`.
  - A row shaped exactly like the command's own write (`seedProcedureRow` +
    `seedVersionRow({versionNumber:1})`) is accepted, so the refusals above mean
    something.
- **`SUPPORTED_SCHEMA_MIN`/`MAX`.** Both raised from 6 to 7 in this diff
  (`packages/infrastructure/src/db/compat.ts`). `db/schema-range.test.ts` (unmodified,
  ran it directly — 3/3 pass) independently derives the max from every
  `INSERT INTO "schema_meta"` line across all migrations and asserts `MIN === MAX`; it
  would fail if either diverged.
- **`schema_meta` version 7 seeded.** `0007_shallow_lockheed.sql`'s final statement:
  `INSERT INTO "schema_meta" ("version") VALUES (7) ON CONFLICT ("version") DO NOTHING;`.
  Confirmed present and confirmed the live (already-migrated) database's `schema_meta`
  reflects it via the passing `schema-range.test.ts`/`schema-compat.test.ts` runs.
- **Lookup-by-id guarded by `isUuidText` at the repository.** Every method in
  `DrizzleProcedureRepository` and `DrizzleProcedureWriter` that takes an id
  (`findProcedure`, `listVersions`, `findVersion`, `findVersionForUpdate`,
  `maxVersionNumber`) checks `isUuidText(...)` first and returns
  absence/`[]`/`0` rather than querying — no unguarded path found.
- **No SELECT-then-INSERT race.** `insertProcedure`/`insertVersion` are plain inserts
  against a freshly generated UUIDv7 id; there is no existence pre-check separated from
  the write anywhere in this module.
- **Lock ordering / deadlock.** `renameProcedureDraft`'s only lock is a single-row
  `SELECT ... FOR UPDATE` on one `procedure_version` row
  (`findVersionForUpdate`, `procedure-repository.ts:297-312`); there is no multi-row
  lock in this story's writer, so the deterministic-lock-ordering class of defect
  (relevant to `manage-users.ts`'s multi-holder lock) has no surface here.
- **`tests/integration/schema-compat.test.ts` table list.** `procedure` and
  `procedure_version` both added to the exact-table-set assertion (diff confirmed); ran
  it directly against the live database — 6/6 pass.
- **The stale-row test genuinely holds a transaction open.** `refuses a second rename
  made while the first transaction is still open` (line 391) wraps the real
  `PostgresProceduresUnitOfWork` in a `held` unit of work whose callback `await`s an
  explicit `gate` Promise *after* the write and audit-append have happened and *before*
  the callback returns (so before commit); the second call is started only after a
  250ms wait, and the gate is opened only after a further 250ms wait for the second call
  to have blocked on the same row's `FOR UPDATE`. This is the same shape
  `manage-users.test.ts` and `sources.test.ts` use, and it is not a start-two-at-once
  race that "finishes too fast to prove anything" — I ran it directly and it passed
  (524ms, consistent with the two 250ms waits), and the assertions correctly require the
  second call to see the *first call's committed* control name (proving it read
  post-commit, under the lock) and to be refused as stale.
- **`pnpm db:generate` produces no drift.** Ran it directly against a placeholder
  `DATABASE_URL` (this command never connects, per CLAUDE.md) — `No schema changes,
  nothing to migrate`, no new file written. `schema.ts` and `0007_shallow_lockheed.sql`
  agree.
- **Raw-SQL vocabulary interpolation (`quoted()` in `schema.ts:304`) is safe.** Reused
  from the existing pattern (registration/binding tables); both new vocabularies
  (`PROCEDURE_VERSION_STATE_VOCABULARY`, `PROCEDURE_TEMPLATE_VOCABULARY`) are
  compile-time `as const` arrays of upper-case ASCII/digits/hyphens, not request input.
- **`procedures/index.ts` and `src/index.ts` exports.** Correctly wired; no outbound
  call in the module (matches AD-23/AD-10 — this module names Templates and sections,
  never derives a plan or reaches a Target System).
- **`packages/infrastructure/src/config.ts`/`config.test.ts` diff in `main...HEAD`** is
  from an earlier commit on this branch (`29fc5e9`, ancestor of the Story 2.1 commit
  `637f70a`), not part of this story's change — confirmed with
  `git show --stat 637f70a`, which does not touch `config.ts`. Out of scope; not
  reviewed further here.
