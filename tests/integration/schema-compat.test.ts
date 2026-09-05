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

  it('has exactly the generation-20 tables and nothing was auto-migrated at startup', async () => {
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
      'audit_run',
      'auth_account',
      'auth_rate_limit',
      'auth_session',
      'auth_user',
      'auth_verification',
      'notification',
      'population_evidence',
      'population_execution',
      'population_row',
      'population_snapshot',
      'population_source_binding',
      // Story 2.1. Owned by the procedures module (AD-2); no other module reads or
      // writes either table.
      'procedure',
      'procedure_change',
      'procedure_configuration',
      'procedure_succession',
      'procedure_version',
      // Story 3.3. The adapter execution stage: its claim, its Reference Source Session
      // Steps, its Work Items, their Step Executions, their Evidence and the §B.1
      // Observations. An unlisted table is a migration nobody reviewed.
      'run_evidence',
      'run_execution',
      'run_initiation_request',
      'run_observation',
      // Story 3.4. Observation registration: the per-Observation Gate check outcomes and
      // the per-condition evaluations, both committed in the same transaction as the
      // Observation rows they describe.
      'run_observation_check',
      'run_observation_evaluation',
      'run_session_step',
      'run_step_execution',
      'run_work_item',
      'schema_meta',
      'target_system_probe',
      'target_system_registration',
      'user_role',
      'worker_heartbeat',
    ]);
  });
});
