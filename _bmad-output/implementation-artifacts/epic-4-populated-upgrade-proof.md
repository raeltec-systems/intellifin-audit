---
title: 'Populated upgrade proof: generation 14 to 41'
type: 'verification'
created: '2026-09-09'
status: 'final'
candidate: 'codex/epic-4-agent-runs @ 6237c4c (PR 24)'
main: '12ec596 (schema generation 14, the deployed build)'
verdict: 'PASS'
---

# Populated upgrade proof: generation 14 to 41

Production runs `main` at schema generation 14. The Epic 4 candidate ships generation 41,
so the release migrates the production database across 27 generations before any new
image starts. The earlier proofs covered a fresh install to 41 and an upgrade from 32
(`epic-4-independent-verification.md`); neither started from the generation production
actually has, and neither carried data written by production's own build. This one does.

The question answered: **does the candidate's migrator upgrade a populated generation-14
database without changing any row it did not create, and does the result equal a fresh
generation-41 install?** The answer is yes, with the evidence below. No secret appears
here; the identity accounts are synthetic `example.test` addresses and the platform
configuration named a synthetic model id.

## Method

Two throwaway databases on a local PostgreSQL 18.4, both dropped afterwards.

1. **Build main's generation 14.** A detached worktree of `origin/main` at `12ec596` was
   installed and built, and its own migrator (`pnpm db:migrate`) took an empty database to
   generation 14 (exit 0, `schema_meta` max 14).
2. **Populate it through main's real commands only.** No hand-written SQL for any row a
   command can produce: three identity accounts (auditor, audit manager, PoC
   administrator) through the seed script; nine Target System registrations and six
   Population Source bindings through the seed-northstar script; four Procedures through
   the Procedure commands, driven to every version state main can reach:

   | Template | What was authored | State left |
   |---|---|---|
   | P-1 | Deliberately incomplete: main's P-1 still required web and desktop coverage and no desktop system exists (deferred to Epic 7) | DRAFT, derivation failed for that stated reason |
   | P-2 | v1 fully authored, derived, submitted, approved and activated; v2 a successor with an added Target System (forces regression) | v1 ACTIVE, v2 APPROVED pending regression |
   | P-3 | Fully authored, derived, submitted | SUBMITTED |
   | P-4 | Fully authored including Audit Instructions for its agent-driven target, derived | DRAFT |

   A platform configuration revision was published through `apply-platform-configuration`,
   which minted one platform-authored Draft off the Active P-2 (its derivation failed
   honestly for want of a model gateway). Main's worker then ran briefly, drained the 24
   queued derivation jobs, delivered the 5 queued notifications and wrote one heartbeat
   row, and was stopped by PID.
3. **Snapshot before.** Every table exported in primary-key order (31 tables; the local
   `pg_dump` is a 16.x client and refuses an 18.4 server, so the export used `psql \copy`
   per table, which is the same COPY protocol). Nine named tables were digested twice:
   over every column, and over only the columns that existed at generation 14. That column
   list was reconstructed from main's own migration files 0000 to 0014 and cross-checked
   against the live tables afterwards.
4. **Upgrade in place** with the candidate's migrator from the candidate's checkout:
   exit 0, `schema_meta` max 41, 12.19 s, no warning.
5. **Snapshot after** and compare.
6. **Parity** against a second database migrated directly to 41 by the same migrator.
7. **Behaviour** on the upgraded, populated database: a bounded slice of the candidate's
   own integration suite, then the migrator's own test file (idempotency and the
   generation-32 backfill cases).

## Results

### Nothing written by main changed

| Table | Digest over generation-14 columns | Digest over every column | Added columns |
|---|---|---|---|
| `audit_event_heads` | unchanged | unchanged | none |
| `audit_events` | unchanged | unchanged | none |
| `auth_user` | unchanged | unchanged | none |
| `notification` | unchanged | moved | 7 nullable escalation and email-outcome columns (Epic 4) |
| `population_source_binding` | unchanged | unchanged | none |
| `procedure` | unchanged | unchanged | none |
| `procedure_version` | unchanged | unchanged | none |
| `target_system_registration` | unchanged | moved | `authentication_destination`, nullable (Epic 4) |
| `user_role` | unchanged | unchanged | none |

The two "moved" full-row digests are exactly the two tables that gained nullable columns;
their generation-14 columns are byte for byte what main wrote. The audit chain in
particular is untouched, so every hash still verifies.

### Row counts on pre-existing tables

Only two changed, both expected: `schema_meta` 14 to 41 (the migration ledger itself) and
`pgboss.queue` 1 to 5 (queue definition rows for the four job types Epic 4 adds; no job
rows). Thirty-one new tables appeared and none was removed.

### Parity with a fresh generation-41 install

| Catalogue | Upgraded | Fresh | Only in one |
|---|---|---|---|
| Columns | 673 | 673 | none |
| Table constraints | 861 | 861 | none |
| Triggers | 40 | 40 | none |

### Behaviour on the upgraded data

| Suite | Result |
|---|---|
| `procedures.test.ts` | 59 of 59 passed |
| `sources.test.ts` | 21 of 21 passed |
| `registrations.test.ts` | 18 of 18 passed |
| `migrate.test.ts` | 7 of 7 passed, including running the migrator twice against the already-upgraded database: the second run is a true no-op and `schema_meta` still holds exactly 41 rows |
| `immutable-versions.test.ts` | 19 of 21 passed; the two failures are a test-isolation gap, explained below |
| `notification-delivery.test.ts` | not run: its own safety guard refuses a database whose name does not carry `test` or `ci` as a token, and the throwaway was named `intellifin_gen14`. A harness naming property, not a defect |

**The two `immutable-versions` failures are not the upgrade's.** Both tests restore the
platform configuration pointer (`procedure_configuration` `@current`) in their own
cleanup, and that restore threw inside the database driver when a pointer row already
existed before the test. The same two tests were then run on the fresh generation-41
database with nothing in it but a published configuration, and failed identically; with no
pointer row they pass. So the trigger is any pre-existing published configuration, on a
fresh or an upgraded database alike, and this run met it only because step 2 published one
deliberately. CI never meets it because every CI database is empty. Nothing was lost:
before failing, one of the two tests republished the platform configuration and the real
command correctly minted two more platform-authored Drafts on the Active P-2, which is what
that command is for.

## What this does not prove

- It is a developer-host proof against a local PostgreSQL 18.4, not a rehearsal against
  a copy of the production database. The production data is small and was written by the
  same commands, but a rehearsal on a Railway snapshot is the owner's to run if wanted.
- The behaviour slice is five integration files plus the migrator's own, chosen for the
  tables main populated. The full suite runs on every candidate in CI against an empty
  database and is not repeated here.
- No P-1 version past DRAFT could be produced on main, for the stated reason, so the
  P-1 rows exercised by the upgrade are a Draft and its failed derivation attempt.

## Verdict

PASS. The candidate's migrator upgrades production's generation with every pre-existing
row intact, reaches a schema identical to a fresh install, and is idempotent on the
result. The release ordering in `epic-4-deployment-readiness.md` stands.
