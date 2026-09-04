---
title: 'Adversarial review — Story 2.1 (domain/application scope)'
type: 'review'
created: '2026-09-04'
status: 'final'
scope: |
  packages/domain/src/procedures/**, packages/application/src/procedures/**,
  packages/domain/src/canonical-json.ts / sha256.ts / audit-event.ts (only where new code
  uses them), tests/unit/procedure-templates.test.ts
---

# Adversarial review — Story 2.1, domain + application scope

Reviewed `git diff main...HEAD -- packages/domain packages/application tests/unit`.
`pnpm --filter @intellifin/domain typecheck`, `pnpm --filter @intellifin/application
typecheck`, and `pnpm boundaries` all pass clean. Every mutation below was planted with
`sed`/`python3`, run with `pnpm vitest run <path>`, observed, then reverted with a
restored backup file (never `git checkout`, to avoid touching the tree while another
agent's suite runs); `git status --porcelain` was empty after each revert.

## Blockers

### 1. `renameProcedureDraft` does not refuse an unstorable Control name — it throws a raw `NotCanonicalizableError` out of the command

**File:** `packages/application/src/procedures/create-procedure.ts`, lines 152–162
(`validatedControlName`) and line 295 (its only use inside `renameProcedureDraft`),
contrasted with lines 172–186 (`validateCreateProcedureInput`, used only by
`createProcedure`).

The spec's I/O matrix states, without scoping it to creation: *"Unstorable value | A lone
surrogate or NUL in the Control name | Refused with a sentence | `canonicalJson` refuses;
the command translates."* The Control name is the one field both commands write.
`createProcedure` translates the `canonicalJson` throw into `PROCEDURE_REFUSALS.NOT_STORABLE`
(lines 179–184). `renameProcedureDraft` calls only `validatedControlName`, which checks
blank/length and nothing else — there is no `canonicalJson` call, and no translation.

`procedureVersionRowVersion(after)` (called at line 317, inside the transaction, right
after `findVersionForUpdate` has taken the row lock) internally calls `canonicalJson` over
the whole record, including the new `controlName`. When that string contains a NUL or a
lone surrogate, `canonicalJson` throws `NotCanonicalizableError` synchronously. That error
is not a `CommandRefused`, so the `catch` block at the bottom of `renameProcedureDraft`
(`if (error instanceof CommandRefused) return refuse(...); throw error;`) rethrows it
unhandled. A Server Action built on this command (per Story 1.5's own lesson, restated in
CLAUDE.md: *"A Server Action's argument is untrusted, whatever its TypeScript type
says"*) would surface this as an uncaught exception — a framework error — to exactly the
caller most likely to be sending a hand-made POST, instead of the sentence the spec
requires.

**Reproduced:** built `packages/domain` and `packages/application` to `dist`, then ran a
standalone script that calls `createProcedure` (to seed a Draft) and then
`renameProcedureDraft` with `controlName: 'terminated' + '\0' + 'users'`:

```
created true
THREW NotCanonicalizableError a NUL character cannot be stored
```

The same is true of a lone surrogate (`'\ud800'`), by the same code path.

No test in `create-procedure.test.ts` exercises this: the only `NOT_STORABLE` assertions
(lines 239–247) are under `describe('createProcedure', ...)`. `describe('renameProcedureDraft',
...)` has no case for it at all — the gap in test coverage is exactly how this shipped.

**Fix:** give `renameProcedureDraft` the same `canonicalJson` check
`validateCreateProcedureInput` performs (or factor a shared `validatedStorableControlName`
used by both), refusing with `PROCEDURE_REFUSALS.NOT_STORABLE` before opening the
transaction — and add the missing test under `renameProcedureDraft`.

No CLAUDE.md guarantee is broken by this bug in a way that corrupts data — the throw
happens before `updateVersion`/`append`, and the real unit of work rolls the transaction
back on any thrown error, so nothing is stored. This is a Blocker because it is a spec
requirement that is silently absent, not merely under-tested, and it repeats — for the
Control name specifically, in the sibling command written the same day — the defect class
CLAUDE.md already names twice ("A Server Action's argument is untrusted...", "A refusal
returned from inside a unit of work commits; a refusal thrown rolls back" — here nothing
even reaches the refusal path, it reaches an unhandled exception instead).

## Should

### 1. `RenameProcedureDraftResult` type has a stray double semicolon

**File:** `packages/application/src/procedures/create-procedure.ts`, line 131: `}>;;`.
Harmless (TypeScript accepts an empty statement), but it is exactly the kind of typo a
linter would catch and nothing here does (the repo has no lint step). Worth a one-line
fix in the same pass as the Blocker above.

### 2. `templates.test.ts`'s "marks exactly the fields §C states non-null, and nothing more" checks fewer fields than its name claims

**File:** `packages/domain/src/procedures/templates.test.ts`, lines 161–173 (title also
echoed in `tests/unit/procedure-templates.test.ts`, lines 161–173, same title, same
narrower coverage). The test only asserts `controlStatement` and `schedule` are null for
P-2/P-3/P-4 and non-null for P-1. It says nothing about `auditInstructions`,
`evidenceRequirements`, `declaredAttributeLabels`, `secondaryKey`, or `inconclusive`,
which are also null on P-2 through P-4 per the current data. This is not a false-negative
risk today — the on-disk pin test (`expectPinned`) would independently fail if one of
those fields were populated with invented text not present in the addendum block, and
would very likely (though not certainly, if the invented text happened to already appear
verbatim in that Template's block by coincidence) catch a wrong non-null value — but the
test's own name overclaims "and nothing more" when it verifies only two of the seven
nullable fields directly. Recommend either narrowing the title or extending the assertion
to loop over all nullable fields for P-2 through P-4.

### 3. `declaredAttributeLabels` pin in `tests/unit/procedure-templates.test.ts` special-cases the `identity` attribute unnecessarily

**File:** `tests/unit/procedure-templates.test.ts`, lines 136–144. The code reads
`if (attribute !== 'identity') expect(block).toContain(attribute);`, skipping the
containment check for the `identity` key. But the addendum's P-1 block does contain the
literal word `identity` (`"identity → \"Employee ID\""`), so the exclusion is not
protecting against a real mismatch — it just means the test would not catch a typo in
the attribute *key* `identity` if one were ever introduced (e.g., renamed to `identify`
in `templates.ts` while the addendum still says `identity`, since the `identify` key
would then simply not be checked against the block at all). Low risk since
`declaredAttributeLabels` is P-1-only, hand-verified data, but the special case is
unexplained in a comment and worth either removing (since it isn't needed) or annotating
why it exists.

## Consider

- `ProcedureWriter.maxVersionNumber` (`packages/application/src/procedures/ports.ts`,
  line 85) is declared but never called from `create-procedure.ts` — `createProcedure`
  hardcodes `versionNumber: 1`, matching the spec's "no version numbering beyond 1," so
  this is very likely forward plumbing for a later story (submission/versioning) rather
  than dead code, but nothing in this diff exercises real behavior for it beyond the
  trivial fake in the test harness. Worth a one-line comment in `ports.ts` saying which
  story consumes it, the way other forward-looking ports in this codebase are annotated.
- `conditionsText` (`packages/domain/src/procedures/procedure-version.ts`, lines 130–143)
  builds a human-readable multi-line string from `TemplateCondition` fields for the
  read-only "Compliance Rule conditions" section. It is display formatting only
  (`compiled: false` throughout, nothing is derived or evaluated), so it does not read as
  a PlanCompiler or plan derivation under the spec's "Never" list, but it is worth a
  second reviewer's eye if a later story extends it, since it is the one place in this
  diff that transforms Template data rather than passing it through verbatim.

## Nothing found here

- **Assertions that cannot fail.** Every test file in scope was checked by inverting the
  code under test and re-running:
  - `templates.test.ts` mutation (schedule `'weekly'` → `'biweekly'`) failed two tests as
    expected, confirmed, reverted.
  - `tests/unit/procedure-templates.test.ts` mutation (`goldenBindingReference` pointed at
    a nonexistent binding id) failed the fixture-catalogue test as expected, confirmed,
    reverted.
  - `procedure-version.test.ts` mutation (`Schedule` mapping forced to `null`) failed two
    tests as expected, confirmed, reverted.
  - `create-procedure.test.ts`'s row-version test (field dropped from
    `procedureVersionRowVersion`'s hashed object) failed as expected, confirmed, reverted.
  No test in scope compares a function's output against a copy of the same computation
  with no independent source of truth — the one place that looks superficially like it
  (`outcome.sections` vs. `initialDraftSections(templateId)` in `create-procedure.test.ts`,
  lines 178–190) is a wiring check (does `createProcedure` forward the validated
  `templateId` into the pre-fill without substituting another one), not a template-value
  pin — that pin lives correctly in `tests/unit/procedure-templates.test.ts` against the
  addendum on disk.
- **Refusal returned vs. thrown.** `createProcedure` has no refusal path inside its unit
  of work (nothing to refuse there beyond authorization/validation, both pre-transaction).
  `renameProcedureDraft`'s three in-transaction refusals (`UNKNOWN_VERSION`, `NOT_A_DRAFT`,
  `STALE_ROW`) are all `throw new CommandRefused(...)`. Verified by mutating the
  `STALE_ROW` branch to `return refuse(...)` instead of throwing: the transaction-count
  assertion in the stale-row test (`{ committed: 1, rolledBack: 1 }`) failed as expected
  (got `{ committed: 2, rolledBack: 0 }`), confirming a returned refusal would silently
  commit. Reverted.
- **Optimistic-concurrency token coverage.** `procedureVersionRowVersion` hashes all seven
  fields of `ProcedureVersionRecord` (`versionId`, `procedureId`, `versionNumber`,
  `state`, `controlName`, `templateId`, `sections`) — there is no eighth field the record
  type carries that the token omits. Confirmed by the mutation above (dropping
  `versionNumber` from the hashed object broke the "moves when any field a save would
  replace moves" test).
- **Idle save writes/appends nothing.** Verified live (mutation removing the idle-save
  early-return broke the "writes and appends NOTHING when the save changes nothing" test:
  `changed` came back `true` instead of `false`). Reverted.
- **Template defaults pinned to addendum §C on disk.** `tests/unit/procedure-templates.test.ts`
  genuinely reads
  `_bmad-output/planning-artifacts/prds/prd-IntelliFin Audit-2026-08-31/addendum.md` off
  disk via `readFileSync`/`fileURLToPath`, locates each `### P-n:` block, and requires
  every stored default to appear verbatim (after stripping markdown emphasis/backticks
  from the artifact side only). Proved this is a real pin, not a copy-of-itself check, by
  the schedule-value mutation above. The golden binding references and expectation/
  confirmation-script ids are checked against the real fixture catalogue
  (`fixtures/northstar/datasets/systems.json`, `fixtures/northstar/expectations/*.json`)
  and confirmed to resolve; a mutation pointing a reference at a nonexistent name failed
  the test as required.
- **No new dependency in `packages/domain` or `packages/application`.** Neither
  `package.json` nor `tsconfig.json` for either package is touched by this diff (`git
  diff main...HEAD` on those four files is empty). Both packages still typecheck clean
  with `pnpm --filter <pkg> typecheck`, and neither tsconfig adds `types: ["node"]`, so
  `process.env` remains untypeable there (AD-11 preserved by omission, not by an explicit
  new check — consistent with how the rest of the codebase preserves this invariant).
- **Audit event family closure.** `packages/domain/src/audit-event.ts` is untouched by
  this diff. `lifecycle.procedure-created` and `lifecycle.procedure-draft-changed` both
  use the existing `lifecycle` family and match `EVENT_TYPE_PATTERN`
  (`^lifecycle\.[a-z0-9]+(?:[._-][a-z0-9]+)*$`) — no new family was added, none was
  needed.
- **`procedure.author` gating.** Already present in `GATED_ACTIONS` /
  `packages/domain/src/identity/roles.ts` before this story (that file has no diff in
  this range); both commands call `authorizeCommand` with this action before reading any
  further input beyond the session, and — per the mutation above that moved the
  authorization call after validation — the PoC Administrator test would (and does)
  catch a reordering.
- **Object.hasOwn / prototype-pollution-shaped lookups.** No object literal in scope is
  indexed by a raw, unvalidated request-input string. `SECTION_CONTENT[heading]`
  (`procedure-version.ts`) is only ever indexed by values drawn from the fixed
  `DRAFT_SECTION_HEADINGS` array during `initialDraftSections`'s own iteration, never by
  external input. `isValidDraftSectionsPayload`'s bracket accesses
  (`payload['templateId']`, `entry['heading']`, etc.) use hardcoded key literals, not a
  key derived from the input — the vulnerable shape (`MAP[untrustedKey]`) does not appear
  in this diff. `isTemplateId`/`findProcedureTemplate` use `Array.prototype.includes`/
  `.find`, which do not walk the prototype chain the way a plain-object index does; the
  `'toString'`/`'constructor'` probes in both test files pass.
- **Never-list items.** No `PlanCompiler`, no plan derivation/preview, no `ModelGateway`
  reference anywhere in the diff (`grep` confirms). No submission, approval, rejection,
  diff, or version numbering beyond `1` is implemented — `createProcedure` hardcodes
  `versionNumber: 1` and there is no code path that writes any state but `DRAFT`. No new
  digest function was added — `procedureVersionRowVersion` is the same class of value as
  `registrationRowVersion`/`bindingRowVersion` (an optimistic-concurrency token over the
  whole row), matching the Always-list requirement rather than the Never-list
  prohibition; it is not a frozen-contract digest and nothing calls it one.
- **Transaction atomicity (application-layer fake).** Both commands route every write and
  the audit append through the single `dependencies.unitOfWork.execute(...)` call; the
  fake harness in `create-procedure.test.ts` only commits writes when the callback
  resolves, and the "stores nothing when the audit append fails" /
  "leaves the Draft untouched when the append fails" tests confirm rollback behavior at
  this layer. Real PostgreSQL atomicity is `tests/integration/procedures.test.ts`'s claim
  to prove, out of this review's scope, and not run here per the task's instructions.

## What I did not run

- `tests/integration/procedures.test.ts`, `tests/e2e/procedures.spec.ts`, the whole
  `pnpm test`/`pnpm test:integration`/`pnpm test:e2e` suites, and anything touching
  `DATABASE_URL` — explicitly out of scope for this review pass (another agent owns
  these) and not run.
- `apps/web/**`, `packages/infrastructure/**`, and the migration/schema-compat files —
  out of this review's assigned scope; not inspected beyond the two grep checks above
  confirming `packages/domain`/`packages/application` package.json and tsconfig files are
  untouched.
