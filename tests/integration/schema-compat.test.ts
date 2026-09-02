import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  REQUIRED_POSTGRES_MAJOR,
  UnsupportedSchemaError,
  assertPostgres18,
  assertSchemaSupported,
  createSqlClient,
  readSchemaVersion,
  type Sql,
} from '@intellifin/infrastructure';

/**
 * Proves the two startup guards against a real PostgreSQL 18 that the CI/release
 * migration job has already migrated (AD-11, AD-15). Nothing here migrates.
 */

const databaseUrl = process.env['DATABASE_URL'];

describe.skipIf(!databaseUrl)('startup guards against a migrated PostgreSQL 18', () => {
  let sql: Sql;

  beforeAll(() => {
    sql = createSqlClient(databaseUrl as string, { max: 2 });
  });

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it('accepts PostgreSQL 18', async () => {
    await expect(assertPostgres18(sql)).resolves.toBe(REQUIRED_POSTGRES_MAJOR);
  });

  it('finds an applied schema version', async () => {
    const version = await readSchemaVersion(sql);
    expect(version).not.toBeNull();
    expect(version).toBeGreaterThanOrEqual(3);
  });

  it('accepts a range that contains the applied version', async () => {
    const version = (await readSchemaVersion(sql)) as number;
    await expect(assertSchemaSupported(sql, version, version)).resolves.toBe(version);
  });

  it('refuses a range entirely above the applied version', async () => {
    const version = (await readSchemaVersion(sql)) as number;
    await expect(assertSchemaSupported(sql, version + 5, version + 9)).rejects.toBeInstanceOf(
      UnsupportedSchemaError,
    );
  });

  it('refuses a range entirely below the applied version and names both', async () => {
    const version = (await readSchemaVersion(sql)) as number;
    await expect(assertSchemaSupported(sql, 0, 0)).rejects.toThrow(
      new RegExp(`found ${version}, this build supports 0\\.\\.0`),
    );
  });

  it('has exactly the generation-6 tables and nothing was auto-migrated at startup', async () => {
    const rows = await sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `;
    const names = rows.map((r) => r.table_name);

    // Exact, not "contains": an extra public table means either a migration this
    // story does not own, or something created a table at runtime. Both break AD-15.
    expect(names).toEqual([
      'audit_event_heads',
      'audit_events',
      'auth_account',
      'auth_rate_limit',
      'auth_session',
      'auth_user',
      'auth_verification',
      'population_source_binding',
      'schema_meta',
      'target_system_probe',
      'target_system_registration',
      'user_role',
      'worker_heartbeat',
    ]);
  });
});
