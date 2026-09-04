# Self-Validation — Story 2.1: Create a Procedure from a Template

Date: 2026-09-03. Machine: Windows 11, bash (Git Bash), Node v24.18.0, pnpm 11.25.0.
Workspace: `C:\Users\opc\Documents\IntelliFin Audit` (path contains a space — see §4).

Every result below is one I observed in this working tree. Where I could not run a gate,
the reason is in §4; nothing is claimed that was not seen.

---

## 1. The commands, in this order

| Command | Result | Observed output |
|---|---|---|
| `pnpm install` | ✅ | Completed; lockfile satisfied; engine-strict warning only (`wanted node 24.20.0, current v24.18.0/v24.19.0` across the session — CI pins 24.20.0). |
| `pnpm -r typecheck` | ✅ | All packages `tsc --noEmit` clean (domain, application, infrastructure, web, worker). |
| `pnpm typecheck` (root: `tests/`) | ✅ | Clean, including the new `tests/unit/procedure-templates.test.ts` and `tests/integration/procedures.test.ts`. |
| `pnpm boundaries` | ✅ | `✔ no dependency violations found (232 modules cruised)` — AD-1 holds with the new `packages/*/src/procedures/` modules. |
| `pnpm test` | ✅ with 13 pre-existing/environmental failures, none from this story | Full breakdown below. |
| `pnpm build` | ✅ | All packages + worker + northstar build. |
| `pnpm --filter @intellifin/web build` | ❌ environmental | `Error: failed to canonicalize path '/C:/Users/opc/Documents/IntelliFin%20Audit/'` — the documented Windows space-in-path limitation; CLAUDE.md: the web image is built in CI on Linux. Reproduced identically on the clean tree. |
| `pnpm db:generate` | ✅ after one real fix | First run produced `0008_clear_wallow.sql`: schema drift, because my hand-written `0007` had no drizzle snapshot. Fixed by regenerating `0007` with drizzle-kit itself (`0007_shallow_lockheed.sql`), re-appending the hand `INSERT INTO "schema_meta" … VALUES (7)` line, and deleting the drift file. Re-run: `No schema changes, nothing to migrate` — the drift check now passes for real. |
| `pnpm test:integration` | ❌ could not run | No PostgreSQL could be started in this sandbox. Details in §4. |
| `pnpm test:e2e` | ❌ could not run | Requires `pnpm build` of the web app (blocked above) and a migrated database (blocked below). Details in §4. |

### The 13 unit failures, named and attributed

All reproduce on the clean tree (`git stash` → rerun → same failures → unstash). None is
in a file this story touches.

1. `apps/northstar/src/fixtures.test.ts` — 9 failures (`declares the digest of the bytes actually served`, `declares a schema that matches the file header`, across five cover sheets). Cause: Windows CRLF corrupts fixture digests (`disposition\r`).
2. `apps/northstar/src/server.test.ts` — 1 failure (`serves bytes whose digest is the one the cover sheet declares`). Same CRLF cause.
3. `apps/web/src/session-route.test.ts` — 2 failures (`answers 401 with an empty body when there is no session`, `reports the user id and the role held right now`).
4. `apps/web/src/require-role.test.ts` — 1 failure (`reports no session when the cookie proves nothing`).
5. `apps/web/src/sign-in-route.test.ts` — 1 failure (`is the SHA-256 of the lower-cased, trimmed address`). These four sign-in/session tests pass 37/37 when the file is run in isolation; they are 5-second-timing tests that flake under full-suite parallel load.
6. `packages/infrastructure/src/db/entry-point.test.ts` — file-level failure. Windows denies symlink creation without elevation (EPERM); needs a POSIX filesystem.

**Story 2.1's own suites are all green**: domain `templates.test.ts` (§C disk pin included), `procedure-version.test.ts`, `tests/unit/procedure-templates.test.ts`; application `create-procedure.test.ts` (31); infrastructure `schema.test.ts` (23, including the new migration pins), schema-range, sources, bindings; web `copy.test.ts`, `form-method.test.ts`, `route-access.test.ts`, `actions.test.ts` (23); all pre-existing suites unchanged.

---

## 2. Mutation testing — all 12 rows, each planted, observed failing, and reverted

| # | Mutation planted | Suite run | FAILED with | Reverted, suite green |
|---|---|---|---|---|
| 1 | P-1 objective changed to a plausible near-miss ("…and confirm removal" → "…and confirm the removal") | `templates.test.ts` + `tests/unit/procedure-templates.test.ts` | `are pinned to addendum §C block by block, default by default` | ✅ |
| 2 | P-3 deleted from `PROCEDURE_TEMPLATES` | `templates.test.ts` + unit pin | `are exactly the four ids, with P-1 first and marked the hero` | ✅ |
| 3 | Stale-row refusal RETURNED from inside the unit of work instead of thrown | `tests/integration/procedures.test.ts` is the named suite — no DB (§4). Ran the command suite's equivalent atomicity case | `refuses a stale row version and changes nothing` (the fake UoW commits on return, so the "changes nothing" assertion fails) | ✅ |
| 4 | Audit append wrapped in `try/catch` that swallows, so rows commit without the event | same reading as row 3 | `stores nothing when the audit append fails` | ✅ |
| 5 | `expectedRowVersion` comparison removed from `renameProcedureDraft` | `create-procedure.test.ts` | `refuses a stale row version and changes nothing` | ✅ |
| 6 | `requireServerAction` moved AFTER the shape check in `createProcedureAction` | `apps/web/app/procedures/new/actions.test.ts` | `authorizes before it reads the input at all` | ✅ |
| 7 | `requireServerAction` deleted from the New-procedure page (nav stays hidden) | Named suite is the e2e PoC case — cannot run (§4). Added a structural unit kill on the repo's own source-pinning precedent (`copy.test.ts` pins pages off disk) | `asks the audited authorization path for procedure.author before rendering anything` (new test in `actions.test.ts`; gate must precede `<NewProcedureForm` in `page.tsx`) | ✅ |
| 8 | A card's absent-cell replaced with an empty string | `copy.test.ts` (+ e2e list assertion names the same behavior) | `are the four UX-DR7 sentences, in words, never a dash` | ✅ |
| 9 | `method="post"` removed from `NewProcedureForm`'s form | `form-method.test.ts` | per-file rule `apps/web/src/procedures/NewProcedureForm.tsx` | ✅ |
| 10 | `procedure_version_state_vocabulary` CHECK deleted from `0007_shallow_lockheed.sql` | Named suite is the integration raw-SQL case — no DB (§4). Ran the unit disk-pin of the migration file | `writes the whole state vocabulary into the generation-7 migration` (`schema.test.ts`) | ✅ |
| 11 | Idle-save early return removed so the write is unconditional | `create-procedure.test.ts` | `writes and appends NOTHING when the save changes nothing` | ✅ |
| 12 | P-1's golden binding reference renamed to a name absent from the fixture catalogue | `tests/unit/procedure-templates.test.ts` | `names a Population Source binding that exists in the fixture catalogue` | ✅ |

Every "reverted" cell was confirmed by re-running the suite afterwards: 146/146 across the
three action/command/form suites at the end, 23/23 `schema.test.ts`, 31/31 command tests,
34 domain tests.

---

## 3. Adversarial re-read of my own diff — with file and line

**Which assertion cannot fail?**
None remains, but one did and is now gone: `displayStateOf` in
`packages/application/src/procedures/create-procedure.ts` was exported with the comment
"exported for the repository adapter and the surfaces to agree on" — but no surface, test
or repository imported it (the repository has its own `displayVersion`). Its only
consumer would have been a test comparing it with itself. Deleted in this pass;
typecheck and 31/31 command tests confirm nothing needed it.

The second candidate was `packages/domain/src/procedures/procedure-version.test.ts`'s
pre-fill assertions ("pre-fills the sections from P-n exactly as the domain pre-fill
does"): `createProcedure` calls `initialDraftSections`, so asserting the output equals
`initialDraftSections(id)` is comparing a function with itself. I kept the assertion but
re-scoped its meaning in `create-procedure.test.ts` (lines 20–24): what it actually pins
is that the command does not transform the pre-fill on the way into the row — the
content equality with §C is pinned separately, off the addendum, in
`tests/unit/procedure-templates.test.ts` (lines 119–150), which reads the addendum off
disk and is the assertion that can fail.

**Which object lookup is keyed by request input and does not use `Object.hasOwn`?**
`apps/web/app/procedures/new/actions.ts` `isNewProcedureFormFields` and
`apps/web/app/procedures/[id]/builder/actions.ts` `isRenameDraftFields` read
`fields['templateId']`, `fields['controlName']`, etc. off an `unknown` via a
`Record<string, unknown>` cast. `Object.hasOwn` is not needed: every access is a
`typeof`/length check on `unknown`, never a prototype-chain read of a
constructor-bearing value (`'hasOwnProperty'` as a `templateId` fails `typeof === 'string'`).
`apps/web/src/procedures/ProcedureStateBadge.tsx` `STATE_WORDS[state]` is keyed by the
domain's closed `ProcedureVersionState` union, not by request input — a state outside
the vocabulary cannot reach it because the repository's `toState` guards it
(`procedure-repository.ts` `toVersionView`).
`packages/infrastructure/src/procedures/procedure-repository.ts` uses
`rows[0]`/`byProcedure.get(...)` with `noUncheckedIndexedAccess` guards
(`if (!row) return null`), and `displayVersion` sorts then indexes with an
`undefined` check — the only index into sorted data, not request-keyed data.

**Which `aria-label` sits on an element that cannot carry an accessible name?**
One `aria-label` in the diff: `DetailTrail.tsx` line 30,
`<nav className="ls-breadcrumbs" aria-label="Breadcrumb">`. A `<nav>` is a landmark
and carries an accessible name. `ConfirmDialog`'s title is a `title` prop rendered as
text, not an aria attribute. The `Banner` in the refusal branches renders its reason as
visible text, not an aria-label.

**Which `<form>` has no `method`?**
None — `form-method.test.ts` walks every `.ts`/`.tsx` source file in `apps/web/src` and
`apps/web/app`, brace-aware, and both new forms (`NewProcedureForm.tsx`,
`RenameDraftForm.tsx`) declare `method="post"`. Mutation row 9 proved the guard fires.

**Which new `var(--…)` names a custom property nothing defines?**
None. The diff introduces 15 token uses (`--color-surface-card`,
`--color-border-default`, `--color-text-muted`, `--color-text-secondary`,
`--rounded-lg`, `--spacing-4`, `--spacing-card-padding`, `--type-body-sm-*` (2),
`--type-caption-*` (3), `--type-card-title-*` (3)); each was grepped against
`apps/web/app/tokens.css` and all 15 are defined there (verified mechanically: 15/15
found, zero missing).

**Which CHECK constraint would still pass on the exact row it exists to refuse?**
Reviewed each constraint in `0007_shallow_lockheed.sql` against the spec's NULL trap:

- `procedure_control_name_present`: `btrim("control_name") <> ''` — the column is
  `NOT NULL`, so btrim cannot receive NULL; whitespace-only names are refused. Sound.
- `procedure_template_vocabulary` (both tables): `IN ('P-1',…)` — column `NOT NULL`;
  NULL would pass `IN` but cannot reach the check. A look-alike (`'p-1'`, `'P-5'`)
  fails. Sound.
- `procedure_version_state_vocabulary`: column `NOT NULL`; every §E state listed.
  Sound — and mutation row 10 proved the pin on it fires.
- `procedure_version_number_at_least_one`: `>= 1`; `version_number` is `NOT NULL`
  integer. Sound.
- No `array_length`/`ALL()` construct exists in the migration, so the spec's
  empty-array NULL trap has no surface here.

**Which code path reaches a database with a string the URL bar can supply?**
`apps/web/app/procedures/[id]/page.tsx` passes `params.id` — a URL string — into
`findProcedure(id)` / `listVersions(id)`. Both are guarded:
`packages/infrastructure/src/procedures/procedure-repository.ts`
`findProcedure`/`listVersions`/`findVersion`/`findVersionForUpdate`/
`maxVersionNumber` each begin with
`if (!isUuidText(<id>)) return null/[]/0`, so a path like
`/procedures/'; DROP TABLE procedure; --` is absence (`notFound()`), never a query.
The Builder action additionally shape-checks both ids against a strict UUID pattern at
the boundary before the command runs. Ordering note: the page authorizes BEFORE the id
is used for anything, so a refused caller cannot probe id existence either.

---

## 4. What I could NOT run, and why

1. **`pnpm test:integration` (zero runs, not two)** — this sandbox has no working
   PostgreSQL. I attempted, concretely: local install check (`C:/Program Files/PostgreSQL/18`
   is a PostGIS tooling distribution — no `postgres.exe`/`initdb.exe`), Docker (absent),
   port 5432 (nothing listening), then downloaded the zonky PostgreSQL 18.6 portable
   binaries, ran `initdb` successfully, and started a postmaster on port 54329 — it
   listened, but every backend process crashed with Windows exception `0xC0000142`
   (DLL initialization failure in this restricted session), so no client could ever
   connect. The cluster was stopped and `/tmp/pg18` abandoned. Consequence: the two
   runs-the-same-second-time integration checks did not happen. The integration suite's
   logic (`tests/integration/procedures.test.ts`, 15 cases) typechecks and mirrors the
   fake-unit-of-work cases that DO pass at unit level, but the real-transaction cases —
   `FOR UPDATE` locking, true rollback on throw, the raw-SQL CHECK enforcement — are
   unverified by execution.

2. **`pnpm test:e2e` (zero runs, not two)** — requires the web build, which fails on
   Windows with a path containing a space (`failed to canonicalize path '/C:/Users/opc/
   Documents/IntelliFin%20Audit/'`), and requires a migrated database (blocked by (1)).
   This is pre-existing and documented (CLAUDE.md: the web image is built in CI on
   Linux). Consequence: the browser-level PoC-refusal and UX-DR7-card assertions in
   `tests/e2e/procedures.spec.ts` are unexecuted. Their logic is partially covered at
   unit level: the copy pins (`copy.test.ts`), the structural page-gate test added for
   mutation row 7, and `form-method.test.ts`.

3. **The twice-in-a-row requirement** — unmet for both suites above, for the same
   environmental reasons. The unit suite DID run repeatedly (full runs plus per-mutation
   runs); it is deterministic apart from the 13 attributed failures, which reproduce
   identically on the clean tree.

4. **Engine note** — `.nvmrc` wants Node 24.20.0; this machine has 24.18/24.19 across
   the session, so pnpm prints an `Unsupported engine` warning. `engine-strict` affects
   install, which succeeded (warning, not error). All gates were run on this engine.

---

## 5. Verdict

Every deliverable the spec's Tasks section lists exists in the working tree; every
mutation row was planted, observed failing by name, and reverted; every adversarial
question has a file-and-line answer verified in this pass (one dead export found and
removed). The two suites I could not execute are blocked by the sandbox — no hostable
PostgreSQL, no Windows web build — not by anything in the story, and both are covered
as far as unit-level equivalents honestly reach. Per the spec's own standard: the
integration and e2e gates remain **unrun**, and this report does not claim otherwise.
