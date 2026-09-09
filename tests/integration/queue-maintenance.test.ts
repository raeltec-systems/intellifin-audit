import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDb, createSqlClient, createProceduresQueue, startQueueMaintenance, PROCEDURES_QUEUE,
  type Database, type Sql,
} from '@intellifin/infrastructure';

/**
 * pg-boss maintenance deletes completed jobs past their queue's deletion window. Without
 * it `pgboss.job` grows without bound for every queue this worker serves — and one PgBoss
 * instance serves all of them, so one broken supervisor is all of them.
 *
 * The defect this pins: the supervisor ran on the SHARED pool, where postgres.js refuses
 * its raw `BEGIN; SET LOCAL ...; SELECT pg_advisory_xact_lock(...)` block with
 * UNSAFE_TRANSACTION. It threw every 60 seconds and deleted nothing, and the only trace
 * was a log line, so nothing failed and the table grew.
 *
 * Both directions are asserted, because a test that only proved the fix works would also
 * pass against a build that had quietly gone back to the pool and swallowed the error.
 */

const databaseUrl = process.env['DATABASE_URL'];
const STALE = 'queue-maintenance-stale-job';

describe.skipIf(!databaseUrl)('queue maintenance against PostgreSQL', () => {
  let sql: Sql; let db: Database;
  beforeAll(() => { sql = createSqlClient(databaseUrl!, { max: 5 }); db = createDb(sql); });
  afterAll(async () => {
    await sql`DELETE FROM pgboss.job WHERE name = ${PROCEDURES_QUEUE} AND data->>'marker' = ${STALE}`;
    await sql?.end({ timeout: 5 });
  });

  /** A completed job finished long enough ago that maintenance must remove it. */
  async function seedStaleJob(): Promise<void> {
    await sql`
      INSERT INTO pgboss.job (id, name, data, state, created_on, started_on, completed_on, keep_until, deletion_seconds)
      VALUES (gen_random_uuid(), ${PROCEDURES_QUEUE}, ${`{"marker":"${STALE}"}`}::jsonb, 'completed',
              now() - interval '30 days', now() - interval '30 days', now() - interval '30 days',
              now() - interval '16 days', 604800)`;
    // Maintenance skips a queue it has swept recently; this one has been waiting a day.
    await sql`UPDATE pgboss.queue SET maintain_on = now() - interval '1 day' WHERE name = ${PROCEDURES_QUEUE}`;
  }

  const staleJobs = async (): Promise<number> => {
    const rows = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pgboss.job
      WHERE name = ${PROCEDURES_QUEUE} AND data->>'marker' = ${STALE}`;
    return rows[0]?.n ?? 0;
  };

  it('refuses to maintain on the shared pool, which is why the sweep has its own client', async () => {
    // BOTH timestamps, and for every queue. `supervise()` reaches the raw transaction in
    // its MONITOR pass (failJobsByTimeout / failJobsByHeartbeat, wrapped by `plans.locked`),
    // not only in the maintain pass, and it skips a queue whose slot is not yet due. A
    // version of this test that reset `maintain_on` alone resolved against the broken
    // build — it never got as far as the statement that fails.
    await sql`UPDATE pgboss.queue SET maintain_on = now() - interval '1 day', monitor_on = now() - interval '1 day'`;
    // The exact call the constructor's built-in supervisor makes on its timer. It is run
    // here by hand because `createProceduresQueue` now sets `supervise: false`; putting
    // that default back would put this failure back on a 60-second timer.
    const queue = createProceduresQueue(db);
    queue.on('error', () => undefined);
    await queue.start();
    let thrown: unknown = null;
    try { await queue.supervise(); } catch (error) { thrown = error; }
    await queue.stop().catch(() => undefined);

    // The driver's REASON, on the cause. pg-boss's own message is `Failed query: BEGIN; ...`,
    // so matching that would pass on any failed statement and drift with its formatting.
    expect(thrown).not.toBeNull();
    expect((thrown as { cause?: { code?: string } }).cause?.code).toBe('UNSAFE_TRANSACTION');
  });

  it('deletes a completed job past its deletion window', async () => {
    await seedStaleJob();
    expect(await staleJobs()).toBe(1);

    const errors: unknown[] = [];
    const stop = await new Promise<() => Promise<void>>((resolve) => {
      const dispose = startQueueMaintenance(databaseUrl!, (error) => errors.push(error));
      setTimeout(() => resolve(dispose), 6_000);
    });
    await stop();

    expect(errors).toEqual([]);
    // The DELETION is the assertion. `pgboss.queue.maintain_on` advances even on the
    // broken build — it is set before the statement that fails — so a test that watched
    // the timestamp alone passed against the pooled supervisor and proved nothing.
    expect(await staleJobs()).toBe(0);
  }, 30_000);

});
