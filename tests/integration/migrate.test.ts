import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createSqlClient, type Sql } from '@intellifin/infrastructure';
import { runMigrations } from '@intellifin/infrastructure/migrate';

/**
 * AD-15 regression guard. CI points `DATABASE_URL` at the same TLS-enabled PostgreSQL
 * image the deployed environment runs, with `sslmode=require`. A migrator whose driver
 * refuses that self-signed chain fails here instead of during a release.
 */
const databaseUrl = process.env['DATABASE_URL'];

describe.skipIf(!databaseUrl)('release migrator', () => {
  it('applies migrations over the configured connection and is idempotent', async () => {
    const first = await runMigrations(databaseUrl as string);
    const second = await runMigrations(databaseUrl as string);
    expect(first).toBeGreaterThanOrEqual(2);
    expect(second).toBe(first);
  });

  it('reports the driver error rather than swallowing it', async () => {
    const bad = (databaseUrl as string).replace(/:\/\/([^:]+):[^@]*@/, '://$1:definitely-wrong@');
    await expect(runMigrations(bad)).rejects.toThrow(/password authentication failed/i);
  });

  it('connects with TLS when the connection string asks for it', async () => {
    const url = databaseUrl as string;
    const sql: Sql = createSqlClient(url, { max: 1 });
    try {
      const rows = await sql<{ ssl: boolean }[]>`
        SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()
      `;
      expect(rows[0]?.ssl).toBe(url.includes('sslmode=require'));
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});

/**
 * The generation-32 backfills, executed on rows in the shape they were written in.
 *
 * "Backfill tests must execute the upgrade on existing authored rows" — a SQL literal
 * comparison cannot prove that a backfill updated anything, and the tables in the live
 * database are already migrated, so each statement is lifted OUT of the migration file and
 * run against TEMP tables holding pre-migration rows. The statement is read from the file
 * rather than retyped, so a test cannot pass against a migration that says something else.
 */
describe.skipIf(!databaseUrl)('generation 32 backfills', () => {
  const migration = readFileSync(
    new URL('../../packages/infrastructure/drizzle/0032_petite_doctor_octopus.sql', import.meta.url),
    'utf8',
  );
  /** One statement of the migration, by the text it starts with. Never retyped here. */
  const statement = (startsWith: string): string => {
    const start = migration.indexOf(startsWith);
    expect(start, startsWith).toBeGreaterThanOrEqual(0);
    return migration.slice(start, migration.indexOf('--> statement-breakpoint', start));
  };

  /**
   * The two things this migration deliberately does NOT write.
   *
   * A backfill test proves the statements it runs; it cannot see a statement somebody adds
   * beside them. Adding `UPDATE population_snapshot SET declared_count = ...` passed every
   * other test here, and it is exactly the fabrication the column exists to prevent. The
   * comment lines are stripped first, because the migration's own prose NAMES both columns
   * to explain why they are left alone — the `schema.test.ts` precedent.
   */
  it('writes no declared count and no population capture time, because neither can be known', () => {
    // Split per STATEMENT rather than matched across the whole file: a lazy `[\s\S]*?`
    // walks straight over a `--> statement-breakpoint` and finds `captured_at` in the NEXT
    // statement, which is the "prefer several simple patterns over one clever regex"
    // lesson this repository already paid dependency-cruiser for.
    const statements = migration
      .split('--> statement-breakpoint')
      .map((chunk) =>
        chunk.split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n').trim(),
      )
      .filter((chunk) => chunk.length > 0);
    const writesTo = (table: string, column: string): string[] =>
      statements.filter(
        (chunk) => chunk.startsWith(`UPDATE "${table}"`) && new RegExp(`"${column}"\\s*=`).test(chunk),
      );
    // The columns are ADDED, which is the only mention either may have.
    expect(statements.some((chunk) => chunk.includes('ADD COLUMN "declared_count"'))).toBe(true);
    expect(statements.some((chunk) => chunk.includes('ADD COLUMN "captured_at"'))).toBe(true);
    // And never assigned. A declaration lives in object storage that SQL cannot read, and
    // no Step Execution produced the population artifact — so there is nothing honest to
    // put in either, and a fabricated value would be a fact nobody measured entering an
    // immutable record.
    expect(writesTo('population_snapshot', 'declared_count')).toEqual([]);
    expect(writesTo('population_evidence', 'captured_at')).toEqual([]);
    expect(writesTo('population_evidence', 'capture_time_source')).toEqual([]);
    // The capture METHOD is different: it is structural, not measured, so it IS written.
    expect(writesTo('population_evidence', 'capture_method')).toHaveLength(1);
    // And the two that ARE recoverable really are written, so this is a real scan and not
    // a pattern that matches nothing.
    expect(writesTo('population_snapshot', 'retrieved_count')).toHaveLength(1);
    expect(writesTo('run_evidence', 'captured_at')).toHaveLength(1);
  });

  it('gives every request token a subject, and turns another caller’s binding into the refusal it really was', async () => {
    const sql = createSqlClient(databaseUrl as string, { max: 1 });
    try {
      await sql`CREATE TEMP TABLE audit_run (run_id uuid, procedure_id uuid, period_from date, period_to date, initiator_id text, request_token uuid)`;
      await sql`CREATE TEMP TABLE run_initiation_request (initiator_id text, request_token uuid, run_id uuid, procedure_id uuid, period_from date, period_to date, refusal text, refused_run_id uuid)`;
      const [mine, theirs] = ['11111111-1111-7111-8111-111111111111', '22222222-2222-7222-8222-222222222222'];
      const [myToken, spentToken, otherToken] = [
        '33333333-3333-7333-8333-333333333333',
        '44444444-4444-7444-8444-444444444444',
        '55555555-5555-7555-8555-555555555555',
      ];
      const procedureId = '66666666-6666-7666-8666-666666666666';
      await sql`INSERT INTO audit_run VALUES
        (${mine},${procedureId},'2026-08-01','2026-08-31','ann',${myToken}),
        (${theirs},${procedureId},'2026-08-01','2026-08-31','bob',${otherToken})`;
      await sql`INSERT INTO run_initiation_request (initiator_id,request_token,run_id) VALUES
        ('ann',${myToken},${mine}),
        ('ann',${spentToken},${mine}),
        ('ann',${otherToken},${theirs})`;
      await sql.unsafe(statement('UPDATE "run_initiation_request" r\nSET "procedure_id"'));
      await sql.unsafe(statement('UPDATE "run_initiation_request" r\nSET "run_id" = NULL'));
      const rows = await sql<
        { request_token: string; run_id: string | null; refusal: string | null; refused_run_id: string | null; procedure_id: string; period_from: string }[]
      >`SELECT request_token::text, run_id::text, refusal, refused_run_id::text, procedure_id::text, period_from::text FROM run_initiation_request ORDER BY request_token`;
      // The token that CREATED the Run keeps it. Every row gains the subject it was
      // decided for, which is what `RUN_TOKEN_REUSED` compares against.
      expect(rows.find((row) => row.request_token === myToken)).toEqual({
        request_token: myToken, run_id: mine, refusal: null, refused_run_id: null,
        procedure_id: procedureId, period_from: '2026-08-01',
      });
      // A second token of the same caller, bound to a Run it did not create, and a token
      // bound to ANOTHER caller's Run: both were acknowledgements of a refusal, and both
      // become that refusal, naming the Run by reference rather than as their answer.
      for (const token of [spentToken, otherToken]) {
        expect(rows.find((row) => row.request_token === token), token).toMatchObject({
          run_id: null, refusal: 'already-active', procedure_id: procedureId,
        });
      }
      expect(rows.find((row) => row.request_token === otherToken)?.refused_run_id).toBe(theirs);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it('recovers a capture time only where a Step Execution really froze the bytes', async () => {
    const sql = createSqlClient(databaseUrl as string, { max: 1 });
    try {
      await sql`CREATE TEMP TABLE run_evidence (evidence_id uuid, run_id uuid, state text, captured_at timestamptz, capture_method text, capture_time_source text)`;
      await sql`CREATE TEMP TABLE run_work_item (evidence_id uuid, run_id uuid, step_id text)`;
      await sql`CREATE TEMP TABLE run_session_step (evidence_id uuid, run_id uuid, step_id text)`;
      await sql`CREATE TEMP TABLE run_step_execution (run_id uuid, plan_step_id text, completed_at timestamptz)`;
      const runId = '77777777-7777-7777-8777-777777777777';
      const [item, session, orphan, reserved] = [
        '88888888-8888-7888-8888-888888888881',
        '88888888-8888-7888-8888-888888888882',
        '88888888-8888-7888-8888-888888888883',
        '88888888-8888-7888-8888-888888888884',
      ];
      await sql`INSERT INTO run_evidence VALUES
        (${item},${runId},'REGISTERED',NULL,NULL,NULL),
        (${session},${runId},'REGISTERED',NULL,NULL,NULL),
        (${orphan},${runId},'REGISTERED',NULL,NULL,NULL),
        (${reserved},${runId},'RESERVED',NULL,NULL,NULL)`;
      await sql`INSERT INTO run_work_item VALUES (${item},${runId},'step-1'),(${reserved},${runId},'step-3')`;
      await sql`INSERT INTO run_session_step VALUES (${session},${runId},'step-2')`;
      // Two attempts on step-1: the artifact was frozen on the attempt that succeeded.
      await sql`INSERT INTO run_step_execution VALUES
        (${runId},'step-1','2026-09-01T09:00:00Z'),
        (${runId},'step-1','2026-09-01T09:01:20Z'),
        (${runId},'step-2','2026-09-01T09:02:00Z'),
        (${runId},'step-3','2026-09-01T09:03:00Z')`;
      await sql.unsafe(statement("UPDATE \"run_evidence\" SET \"capture_method\" = 'adapter'"));
      await sql.unsafe(statement('UPDATE "run_evidence" e\nSET "captured_at"'));
      const rows = await sql<{ evidence_id: string; captured_at: Date | null; capture_method: string | null; capture_time_source: string | null }[]>`
        SELECT evidence_id::text, captured_at, capture_method, capture_time_source FROM run_evidence ORDER BY evidence_id`;
      const of = (id: string) => rows.find((row) => row.evidence_id === id)!;
      // Recovered, from the LAST completed Step Execution of the step that produced it —
      // and marked as recovered, so a reader can tell it from a measured instant.
      expect(of(item).captured_at?.toISOString()).toBe('2026-09-01T09:01:20.000Z');
      expect(of(item).capture_time_source).toBe('step-execution');
      expect(of(session).captured_at?.toISOString()).toBe('2026-09-01T09:02:00.000Z');
      // No producer at all: nothing to attribute it to, so it stays absent and the
      // surface keeps saying so rather than borrowing an instant from somewhere else.
      expect(of(orphan)).toMatchObject({ captured_at: null, capture_time_source: null });
      // A reservation nothing was written to captured nothing, even though its step ran.
      expect(of(reserved)).toMatchObject({ captured_at: null, capture_time_source: null });
      // The METHOD is structural rather than recovered: every row these tables have ever
      // held was written by the adapter path, so all four get it.
      expect(rows.every((row) => row.capture_method === 'adapter')).toBe(true);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it('derives the retrieved count from the dispositions it partitions, and invents no declared count', async () => {
    const sql = createSqlClient(databaseUrl as string, { max: 1 });
    try {
      await sql`CREATE TEMP TABLE population_snapshot (run_id uuid, included int, excluded int, indeterminate int, declared_count int, retrieved_count int)`;
      await sql`INSERT INTO population_snapshot VALUES
        ('99999999-9999-7999-8999-999999999991',2,1,0,NULL,NULL),
        ('99999999-9999-7999-8999-999999999992',0,0,0,NULL,NULL)`;
      await sql.unsafe(statement('UPDATE "population_snapshot"\nSET "retrieved_count"'));
      const rows = await sql<{ retrieved_count: number; declared_count: number | null }[]>`
        SELECT retrieved_count, declared_count FROM population_snapshot ORDER BY run_id`;
      expect(rows).toEqual([
        { retrieved_count: 3, declared_count: null },
        { retrieved_count: 0, declared_count: null },
      ]);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
