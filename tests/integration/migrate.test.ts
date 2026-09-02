import { describe, expect, it } from 'vitest';

import { createSqlClient, runMigrations, type Sql } from '@intellifin/infrastructure';

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
    expect(first).toBeGreaterThanOrEqual(1);
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
