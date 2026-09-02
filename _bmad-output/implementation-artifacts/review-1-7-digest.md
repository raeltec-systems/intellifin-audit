---
title: Story 1.7 review — the binding digest and the application command
lens: binding digest, projection, canonical bytes, golden fixture, register/change command
date: 2026-09-02
---

# Story 1.7 review — the binding digest and the application command

Branch `claude/codebase-architecture-overview-pv0nt7`, commit `5e4513e`, diff `184ffa0..HEAD`.

Files in scope:

- `packages/domain/src/sources/population-source.ts`, `index.ts`, `population-source.test.ts`
- `packages/application/src/sources/ports.ts`, `register-population-source.ts`, `register-population-source.test.ts`
- `scripts/make-binding-digest-golden.py`, `tests/fixtures/binding-digest-golden.json`, `tests/unit/binding-digest.test.ts`

Everything below was executed. Node 24.20.0 was not installable in this container, so
the suite ran on Node 22.22.2 with the workspace's own `node_modules` — every test in
scope is pure computation, and the full unit suite is green (`42 files, 1084 tests`).
A local PostgreSQL 16 was started for the one driver-level check; the behaviour under
test (`22021`) is identical on 18.

**No BLOCKER. Two SHOULD. Three CONSIDER.**

The two questions the lens was pointed at both come back clean:

- **No two different bindings collide on one digest** (200,000 fuzzed inputs over a
  quote-, comma- and bracket-heavy alphabet: 122,733 distinct envelopes, 122,733
  distinct digests, zero collisions and zero splits).
- **Story 1.6's defect is not repeated.** Every stored column agrees, field by field,
  with what the digest hashes. Verified analytically and then by a 685-pair randomized
  property probe: every stored row recomputes to its own digest from its own columns,
  and `before.digest !== after.digest` held **if and only if** one of the five moved.

---

## 1. Can two different bindings collide on one digest?

No. Table of what the envelope holds against what could imitate what:

| Envelope key | Type | Normalization | Can another field's content imitate it? |
|---|---|---|---|
| `declared_count_mechanism` | string | none (closed vocabulary) | No — its own JSON key |
| `declared_schema` | array of strings | trim, drop blanks, dedup, **keep order** | No |
| `kind` | string | none (closed vocabulary) | No |
| `location` | string or **null** | trim; `''` → `null`; forced `''` for `manual-upload` | No |
| `sensitive_fields` | array of strings | trim, drop blanks, dedup, **sort** | No |

The reason no separator trick works is structural, not lucky: `bindingCanonicalText`
(`population-source.ts:152`) hands a real object to `canonicalJson`, which emits
`JSON.stringify`-escaped strings inside `[...]` and `{...}`. There is no concatenation
step where a `","` typed inside a field name could close one array and open another.
I fuzzed exactly that with an alphabet of `,` `"` `\` `","` `[` `]` `{` `}` `:` `null`
`"a","b"` and got no collision in 200,000 draws.

The ordered/unordered pair is safe for the same reason: `declared_schema` and
`sensitive_fields` are two separate JSON keys, so `["a","b"]` under one key can never be
read as `["b","a"]` under the other.

**Manual upload's null location.** `location: null` is reachable only when
`kind === 'manual-upload'` (`population-source.ts:141,146`), and `kind` is in the
envelope, so a null location can never be confused with a `versioned-file` whose
location happened to be blank. At the row layer the same invariant is a CHECK constraint
(`schema.ts:493-496`, `population_source_binding_location_matches_kind`), in both
directions. Nothing to fix.

**Empty lists.** `declared_schema: []` is representable by the domain function but
refused by the command (`SCHEMA_REQUIRED`, `register-population-source.ts:263`) and by
`population_source_binding_schema_present` (`cardinality(...) >= 1`). `sensitive_fields:
[]` is legitimate and is pinned by the `read-only-api-count-endpoint` vector.

---

## 2. Can a binding change without the digest moving, or the other way round?

Field by field, stored column against hashed value:

| Column | Stored by `toRecord` (`register-population-source.ts:303`) | Hashed by `bindingDigestEnvelope` (`population-source.ts:140`) | Agree? |
|---|---|---|---|
| `kind` | `fields.kind` verbatim | `input.kind` verbatim | yes |
| `location` | `''` for `manual-upload`, else `.trim()` | same rule, then `'' → null` | yes |
| `declaredSchema` | `listOf` = trim, drop blank, dedup, keep order | `normalizedList` = identical | yes |
| `declaredCountMechanism` | verbatim | verbatim | yes |
| `sensitiveFields` | `setOf` = `listOf` then `.sort()` | `normalizedSet` = identical | yes |
| `displayName` | `.trim()` | not hashed — by design (FR-45 annotation, not contract) | n/a |
| `note` | `.trim()` | not hashed — by design | n/a |
| `status` | verbatim | not hashed — by design | n/a |
| `digest` | derived | n/a | n/a |

`'' → null` is the one place the stored value and the hashed value differ in *shape*,
and it is harmless: `''` and `null` are in bijection given `kind`, so nothing can move
one without moving the other.

The command also asserts both directions at run time and **throws** (so the transaction
rolls back) rather than committing a contradiction — `register-population-source.ts:511`
("a digest-bearing field changed without moving the digest") and `:521` ("the digest
moved without any of the five fields changing"). I fuzzed 685 create-then-change pairs
across all three kinds, all three mechanisms, blank/duplicate/whitespace-padded field
lists and both statuses: neither guard ever fired, and no row-version-moving write ever
happened without an audit event.

`bindingRowVersion` (`:348`) covers all nine content fields of `BindingRecord` plus the
id — every column `DrizzleBindingWriter.updateBinding` replaces except the
server-generated `updated_at`. Correct, and stronger than the digest, which is the whole
point.

---

## 3. Is the golden fixture real independent evidence?

Yes, on all three counts.

- **Reproduces byte-identically.** `uv run scripts/make-binding-digest-golden.py` rewrote
  `tests/fixtures/binding-digest-golden.json`; `git diff --exit-code` on that path
  returned 0. Producer string `Python 3.11.15 + rfc8785 0.1.4 + hashlib.sha256`.
- **Envelopes are hand-written.** `VECTORS` (`make-binding-digest-golden.py:44-208`) is a
  4-tuple per vector where the fourth element is the literal envelope. There is no Python
  projection function; the only Python code that touches an envelope is the
  `set(envelope) != FIVE_KEYS` assertion and the subset check at `:222-226`. A reviewer
  can read the five keys.
- **A test asserts the producer is Python.** `tests/unit/binding-digest.test.ts:46`:
  `expect(golden.producer).toMatch(/^Python /)`.

The generator also refuses to write a fixture in which two *different* envelopes share a
digest (`:248`), which is what keeps the deliberately-equal pair meaningful.

---

## 4. Do the vectors discriminate the rules they claim?

Every rule was broken in `packages/domain/src/sources/population-source.ts`, the suite
run, and the module restored. All four claimed rules are pinned.

| # | Mutation | Result |
|---|---|---|
| M1 | `normalizedList` sorts (schema becomes a set) | **caught** — 5 failures; `versioned-file-cover-sheet`, `schema-order-reversed` and 3 domain tests |
| M2 | `normalizedSet` drops `.sort()` (sensitive fields become a list) | **caught** — `sensitive-fields-order-irrelevant` and `unicode-field-names` |
| M3 | `kind` removed from the envelope | **caught** — all 6 golden vectors fail on the `toEqual` projection check |
| M4 | `manual-upload` keeps its typed location | **caught** — `manual-upload-no-location` plus the domain test |
| M5 | `normalizedSet` sorts by **code point** instead of UTF-16 code unit | **caught by exactly one vector** — `unicode-field-names`, on the U+FFFD sentinel, exactly as the generator's comment at `:184-190` claims |

M5 is the interesting one: it is a defect a reviewer would never find by inspection and
only the deliberately-chosen sentinel catches it. That vector earns its place.

---

## SHOULD-1 — a NUL is accepted by `validateBindingFields` and rejected by PostgreSQL, so the guard written to avoid a framework 500 does not cover it

`packages/application/src/sources/register-population-source.ts:287-298`

The `storable` guard exists, in its own words, to turn a value the row cannot hold "into
a sentence instead of a framework 500 for the caller most likely to be probing". It
delegates that judgement entirely to `canonicalJson`, and `canonicalJson` has no opinion
about `U+0000` — it is perfectly valid JSON, escaped as `\u0000`. PostgreSQL's `text` type
is the layer that refuses it.

Concrete input, run:

```
validateBindingFields({ ...BASE, declaredSchema: ['salary', 'a\u0000b'] })
  => refusal: null                                  // accepted
bindingCanonicalText(...)                            // accepted
  => {"declared_count_mechanism":"none","declared_schema":["a\u0000b"], ...}
```

then, against a real PostgreSQL through postgres.js — the driver this repository uses —
inserting `['a\u0000b']` into a `text[]` column:

```
DRIVER/PG ERROR: PostgresError | 22021 | invalid byte sequence for encoding "UTF8": 0x00
```

Reachable: `isBindingFormFields` in `apps/web/app/administration/sources/actions.ts:74`
checks only `typeof entry === 'string' && entry.length <= 200`. A Server Action is its own
POST endpoint addressed by an id in the client bundle (the Story 1.5 lesson), so a
hand-made post carrying `"declaredSchema": ["a\u0000b"]` reaches the command. The
`PostgresError` is thrown out of `insertBinding` inside `unitOfWork.execute`; the command
catches only `CommandRefused` (`:587`), so it propagates as an unhandled error.

Severity is SHOULD, not BLOCKER, precisely because the failure is loud: the transaction
rolls back, nothing is stored, and no row ever disagrees with its digest. What is lost is
the refusal sentence `BINDING_REFUSALS.NOT_STORABLE` — whose text, "That value contains a
character this system cannot store", describes a NUL better than it describes anything
else.

Patch:

```ts
// register-population-source.ts, replacing the try/catch at :294-298

  // A value with no canonical form (a lone surrogate) or none PostgreSQL can hold. The
  // canonicalizer has no opinion about U+0000 — it is valid JSON — but `text` refuses it
  // with SQLSTATE 22021, which would otherwise leave the transaction to raise a framework
  // 500 for the caller most likely to be probing.
  try {
    for (const value of storable) {
      if (value.includes('\u0000')) return BINDING_REFUSALS.NOT_STORABLE;
      canonicalJson(value);
    }
  } catch {
    return BINDING_REFUSALS.NOT_STORABLE;
  }
```

and, beside the existing lone-surrogate test at
`register-population-source.test.ts:301`:

```ts
  it('refuses a NUL, which is valid JSON and not a value PostgreSQL can hold', async () => {
    const test = harness();
    const outcome = await register(test, { declaredSchema: ['salary', 'a\u0000b'] });

    expect(outcome).toEqual({ ok: false, reason: BINDING_REFUSALS.NOT_STORABLE });
    expect(test.stored.size).toBe(0);
  });
```

Removing the `includes('\u0000')` line makes that test fail; it passes today only because
no test asserts it.

---

## SHOULD-2 — nothing pins the stored `sensitiveFields` column to the sorted form the digest hashes

`packages/application/src/sources/register-population-source.ts:232-235`

The shipped code is **correct**. What is missing is any test that says so, and this is
the exact defect class Story 1.6 paid for — a stored column and a hashed value that
normalize differently — mirrored onto the one field where the two are opposite.

Mutation run (`setOf` stops sorting):

```ts
function setOf(values: readonly string[]): readonly string[] {
  return listOf(values);          // was: [...listOf(values)].sort()
}
```

`register-population-source.test.ts`: **52 passed, 0 failed.** Whole unit suite: green.

The consequence I then measured with a probe, under that mutation:

```
create  sensitiveFields: ['employee_id','salary']   → stored ["employee_id","salary"]
change  sensitiveFields: ['salary','employee_id']   → stored ["salary","employee_id"]
OUTCOME: published: false, annotated: false
EVENTS APPENDED: 0
ROW VERSION MOVED: true
DIGEST MOVED:     false
```

So the row is silently rewritten; `bindingRowVersion` moves, which invalidates every
other administrator's open tab with the `STALE_ROW` sentence for a change that was never
recorded; and the audit chain has nothing. The database is no backstop —
`population_source_binding_sensitive_fields_declared` uses `<@`, which is set containment
and order-blind.

A second mutation survives for the same root cause: `changedDigestFields` at `:405`
changed from `sameSet` to `sameOrdered` also passes all 52 tests, because sorted storage
makes the two comparisons indistinguishable. Fix the first and that one stops mattering.

The existing test `publishes NOTHING when the sensitive fields are only reordered`
(`:399`) asserts the *events*, not the *column*, which is why it does not catch this.

Patch — add to `describe('registerPopulationSource')`, and one line to the reorder test:

```ts
  it('stores the sensitive fields as the digest hashes them: a sorted set', async () => {
    // The stored column must BE the value that was hashed. A column that keeps the typed
    // order while the digest sorts is Story 1.6's defect on the one field where the two
    // rules are opposite: reordering would then rewrite the row and move the row version
    // with priorDigest === newDigest and no event at all.
    const test = harness();
    const created = await register(test, {
      sensitiveFields: ['salary', '  employee_id  ', 'salary', ''],
    });
    if (!created.ok) throw new Error('setup failed');
    const record = test.stored.get(created.bindingId) as BindingRecord;

    expect(record.sensitiveFields).toEqual(['employee_id', 'salary']);
    expect(record.digest).toBe(
      bindingDigest({
        kind: record.kind,
        location: record.location,
        declaredSchema: record.declaredSchema,
        declaredCountMechanism: record.declaredCountMechanism,
        sensitiveFields: record.sensitiveFields,
      }),
    );
  });
```

and inside `publishes NOTHING when the sensitive fields are only reordered`:

```ts
    expect((test.stored.get(bindingId) as BindingRecord).sensitiveFields).toEqual(
      ['employee_id', 'salary'],
    );
```

The first assertion of the new test fails under the mutation; the `bindingDigest`
re-derivation is the general form and would catch the same class on any of the five.

---

## CONSIDER-1 — an idle save writes `updated_at` and appends no event

`register-population-source.ts:514` runs `await bindings.updateBinding(next)`
unconditionally, *before* the `changed.length === 0` branch. When neither list has moved,
the row content is byte-identical, but `DrizzleBindingWriter.updateBinding`
(`packages/infrastructure/src/sources/binding-repository.ts:191`) still sets
`updatedAt: new Date()`, and `BindingEditor.tsx:98` renders that timestamp to the reader.

Measured (probe counting `updateBinding` calls):

```
OUTCOME: published: false, annotated: false
updateBinding calls: 1 | events appended: 0
```

So a reviewer can see "Last updated" move with nothing in the chain to explain it. It is
small — nothing a person can *see about the binding* changed — but it is the one place
this command writes without an event, and the comment at `:473` ("A save that moves
nothing publishes nothing") reads as though no write happens either.

Patch:

```ts
        if (changed.length === 0) {
          if (before.digest !== next.digest) {
            throw new Error('the digest moved without any of the five fields changing');
          }
          // Nothing moved: do not touch the row. `updated_at` is rendered to a reader,
          // and moving it with no event in the chain is a configuration change nobody
          // can account for.
          if (annotated.length === 0) {
            return { ok: true, bindingId, digest: next.digest, priorDigest: before.digest,
                     published: false, annotated: false, declaresNoCount };
          }
          await bindings.updateBinding(next);
          await auditEvents.append({ /* ... binding-annotated, unchanged ... */ });
          ...
        }
        await bindings.updateBinding(next);   // moved down, before the changed-event append
```

with `expect(updates).toHaveLength(0)` added to `appends nothing when a save moves
nothing at all` (`:482`), which passes today only because the fake's `updateBinding` is
not counted.

---

## CONSIDER-2 — `bindingRowVersion`'s coverage is asserted by a hand-written list

`register-population-source.test.ts:680-693` enumerates the nine fields by hand. It is
correct today and it checks every one. But a tenth column added to `BindingRecord` by a
later story and wired into `updateBinding` would be silently absent from the token, and
the suite would stay green — which is the failure mode the token exists to prevent
(Story 1.6: `displayName`, `note` and `status` were exactly the fields the digest could
not protect).

Patch — derive the list instead of typing it:

```ts
  const MUTABLE = (Object.keys(RECORD) as (keyof BindingRecord)[]).filter(
    (key) => key !== 'digest',   // derived from five of the others; see the test below
  );

  it.each(MUTABLE)('moves when %s moves', (field) => {
    // Derived from the record's own keys, so a column added to BindingRecord and to
    // updateBinding without being added to the token fails here rather than shipping.
    const altered: BindingRecord = { ...RECORD, [field]: MUTATIONS[field] } as BindingRecord;
    expect(bindingRowVersion(altered)).not.toBe(bindingRowVersion(RECORD));
  });
```

(with `MUTATIONS` the existing overrides keyed by field name — a `Record<keyof
BindingRecord, unknown>` type makes a missing entry a compile error, which is the point.)

---

## CONSIDER-3 — `validateBindingFields` throws instead of refusing on a malformed shape

`register-population-source.ts:244` is documented as "everything that can be decided
without touching a database" and is exported from `@intellifin/application`. It reaches
`.trim()` and `.length` without checking either. Run:

```
declaredSchema = null   => THREW TypeError  Cannot read properties of null (reading 'map')
declaredSchema = [1]    => THREW TypeError  value.trim is not a function
note = undefined        => THREW TypeError  Cannot read properties of undefined (reading 'length')
```

Not reachable from the web today: `isBindingFormFields`
(`apps/web/app/administration/sources/actions.ts:93`) checks every field's shape before
the command sees it, and CONSIDER-3 is only about the second caller — the worker entry
point Story 1.8 adds, or any later surface that trusts the TypeScript type the way a
hand-made POST does not.

Either add a shape check at the top of `validateBindingFields` (returning
`KIND_INVALID`/`SCHEMA_REQUIRED` as appropriate), or state in its doc comment that shape
validation is the caller's and name `isBindingFormFields` as the one that does it. The
second is cheaper and matches the existing "the vocabulary checks happen HERE as well as
in the command" note in `actions.ts:110-115`.

---

## Item 6 — what a `JSON.stringify`-based canonicalizer could mangle

Checked, and covered:

- **Lone surrogates** — `canonicalJson` refuses them (`canonical-json.ts:42`), the
  digest propagates the refusal, and the command turns it into `NOT_STORABLE`. Verified
  in all three string positions (`declaredSchema` entry, `location`, `sensitiveFields`
  entry): all three threw `NotCanonicalizableError`. Dropping the command's guard fails
  `refuses a value with no canonical form rather than storing a substitute` (M10).
- **Non-finite numbers** — not reachable: the envelope holds no numbers at all. Every
  value is a closed-vocabulary string, a free string, `null`, or an array of strings.
- **Unusual keys** — the five keys are literals in `bindingDigestEnvelope`, and
  `canonicalJson` runs `assertWellFormed` on every key anyway (`canonical-json.ts:87`).
- **`-0`, integers past 2^53** — not reachable, same reason as non-finite numbers.
- **`U+0000`** — accepted by the canonicalizer and refused by PostgreSQL. This is
  SHOULD-1 above and is the one gap in this row.
- **U+FFFD substitution** — cannot occur: the only path that would produce it is a lone
  surrogate reaching the driver, and that is refused two layers earlier.

---

## Verification log

| What | Command | Result |
|---|---|---|
| Golden reproduces | `uv run scripts/make-binding-digest-golden.py` | byte-identical (`git diff --exit-code` = 0) |
| Digest + fixture tests | `npx vitest run tests/unit/binding-digest.test.ts` | 9 passed |
| Whole unit suite, after restoring every mutation | `npx vitest run` | 42 files, 1084 tests, all passed |
| Collision fuzz | 200,000 inputs, adversarial alphabet | 122,733 envelopes / 122,733 digests, 0 collisions |
| Stored-vs-digest property fuzz | 685 create/change pairs | 0 guard firings, 0 silent row writes |
| Mutations M1-M5 (domain) | each broken, suite run, restored | all caught |
| Mutations M6, M8, M10 (command) | each broken, suite run, restored | all caught |
| Mutations M7, M9 (command) | each broken, suite run, restored | **survived** — SHOULD-2 |
| `U+0000` through postgres.js | real PostgreSQL, `text[]` insert | `22021 invalid byte sequence for encoding "UTF8": 0x00` |

Every mutation was reverted from a pre-mutation copy and `git status` confirmed clean for
all three of `packages/domain/src/sources/population-source.ts`,
`packages/application/src/sources/register-population-source.ts` and
`tests/fixtures/binding-digest-golden.json`. Nothing was committed.
