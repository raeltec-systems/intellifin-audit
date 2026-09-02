import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, createSqlClient, type Sql } from '@intellifin/infrastructure';

import { upsertHeartbeat } from '../../apps/worker/src/heartbeat.js';

/** Matrix row "Heartbeat": one row per hostname, refreshed in place, UTC timestamps. */
const databaseUrl = process.env['DATABASE_URL'];

describe.skipIf(!databaseUrl)('worker heartbeat against a migrated PostgreSQL 18', () => {
  let sql: Sql;
  const host = `test-${process.pid}`;

  beforeAll(() => {
    sql = createSqlClient(databaseUrl as string, { max: 2 });
  });

  afterAll(async () => {
    await sql`DELETE FROM worker_heartbeat WHERE hostname = ${host}`;
    await sql?.end({ timeout: 5 });
  });

  it('upserts exactly one row per hostname and refreshes seen_at', async () => {
    const db = createDb(sql);
    const first = new Date('2026-09-02T00:00:00.000Z');
    const second = new Date('2026-09-02T00:00:30.000Z');
    await upsertHeartbeat(db, host, first);
    await upsertHeartbeat(db, host, second);
    const rows = await sql<{ hostname: string; seen_at: Date | string }[]>`
      SELECT hostname, seen_at FROM worker_heartbeat WHERE hostname = ${host}
    `;
    expect(rows).toHaveLength(1);
    expect(new Date(rows[0]?.seen_at as Date | string).toISOString()).toBe(second.toISOString());
  });
});
