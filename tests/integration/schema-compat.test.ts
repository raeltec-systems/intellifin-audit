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

  it('has exactly the generation-36 tables and nothing was auto-migrated at startup', async () => {
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
      'run_agent_execution',
      'run_agent_turn',
      'run_agent_work',
      // Story 4.9. Human decisions retain the original Agent-Judged proposal in an
      // immutable ledger beside the mutable Result review revision.
      'run_evaluation_review',
      'run_evaluation_review_command',
      'run_evidence',
      'run_evidence_capture',
      // Story 3.5. The sealed Evidence package of one Run, and the Audit Trail integrity
      // findings a post-Run verification adds beside it without changing any state.
      'run_evidence_integrity',
      'run_evidence_package',
      // Story 3.7. The permanent Exception a deterministic evaluation raises: one row per
      // Observation whose evaluation recorded an `EXCEPTION`, never updated and never
      // deleted while its Observation stands.
      'run_exception',
      'run_execution',
      // Story 3.8. The Run-level Evidence Quality Gate: one row per addendum §H check,
      // written once when the last Work Item completes and never updated.
      'run_gate_check',
      'run_initiation_request',
      'run_observation',
      // Story 3.4. Observation registration: the per-Observation Gate check outcomes and
      // the per-condition evaluations, both committed in the same transaction as the
      // Observation rows they describe.
      'run_observation_check',
      'run_observation_evaluation',
      // Story 3.9. The sealed Result: the System Outcome, the §E.1 row that decided it and
      // the published document, written once in the transaction that completes the Run.
      'run_result',
      'run_result_review',
      'run_session_step',
      'run_step_execution',
      'run_tool_action',
      'run_wait',
      'run_work_item',
      // Story 4.1. The isolated Agent Workspace one Run gets: its provider identity, the
      // guarantee its mode actually had, and the provider deadline it must respect.
      'run_workspace',
      'schema_meta',
      'target_system_probe',
      'target_system_registration',
      'user_role',
      'worker_heartbeat',
    ]);
  });

  /**
   * The columns generations 32 and 36 added, asserted EXACTLY on the tables they changed.
   *
   * The table list above is exact so that a migration nobody reviewed fails; a column
   * added to an existing table slipped past it entirely. These rows carry facts an
   * auditor reads off a Result — capture provenance, record counts and the preserved
   * evaluation-review proposal — so the same rule applies to their shape.
   */
  it.each([
    [
      'run_evidence',
      ['capture_method', 'capture_time_source', 'captured_at', 'digest', 'evidence_id', 'kind', 'media_type', 'object_key', 'registration_id', 'required', 'run_id', 'size', 'state'],
    ],
    [
      'population_evidence',
      ['capture_method', 'capture_time_source', 'captured_at', 'envelope_digest', 'envelope_key', 'evidence_id', 'object_key', 'raw_digest', 'required', 'run_id', 'size', 'state'],
    ],
    [
      'population_snapshot',
      ['checks', 'declared_count', 'excluded', 'generated_at', 'included', 'indeterminate', 'retrieved_count', 'rows_digest', 'run_id'],
    ],
    [
      'run_initiation_request',
      ['initiator_id', 'period_from', 'period_to', 'procedure_id', 'refusal', 'refused_run_id', 'request_token', 'run_id'],
    ],
    [
      'run_observation_evaluation',
      ['agent_proposed_confidence', 'agent_proposed_rationale', 'agent_proposed_value', 'condition_id', 'confidence', 'confirmation', 'corroboration', 'coverage', 'diagnostic', 'evidence_ids', 'observation_id', 'origin', 'rationale', 'run_id', 'value'],
    ],
    [
      'run_evaluation_review',
      ['action', 'actor_id', 'condition_id', 'decided_at', 'decision_id', 'effective_confirmation', 'effective_origin', 'effective_value', 'observation_id', 'original_confidence', 'original_confirmation', 'original_evidence_ids', 'original_origin', 'original_rationale', 'original_value', 'rejection_rationale', 'replacement_value', 'review_revision', 'run_id'],
    ],
    [
      'run_evaluation_review_command',
      ['action', 'actor_id', 'command_id', 'condition_id', 'correlation_id', 'decision_id', 'expected_review_revision', 'observation_id', 'processed_at', 'rationale', 'refusal_code', 'replacement_value', 'requested_at', 'result_outcome', 'result_sealed', 'result_version', 'review_revision', 'run_id', 'session_id', 'status'],
    ],
    [
      'run_result_review',
      ['revision', 'run_id'],
    ],
  ])('has exactly the reviewed release columns on %s', async (table, columns) => {
    const rows = await sql<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${table}
      ORDER BY column_name
    `;
    expect(rows.map((row) => row.column_name)).toEqual(columns);
  });

  /**
   * `run_initiation_request.procedure_id` carries NO foreign key, deliberately.
   *
   * A request that names a Procedure which does not exist is exactly the `no-owner`
   * refusal this table has to record; a foreign key there refuses the row and answers the
   * caller a framework 500 instead of the refusal sentence. This asserts the absence,
   * because an absence nothing checks is one the next `db:generate` quietly restores.
   */
  it('does not key the request subject to a Procedure that has to be allowed not to exist', async () => {
    const rows = await sql<{ constraint_name: string; column_name: string }[]>`
      SELECT c.constraint_name, k.column_name
      FROM information_schema.table_constraints c
      JOIN information_schema.key_column_usage k ON k.constraint_name = c.constraint_name
      WHERE c.table_schema = 'public' AND c.table_name = 'run_initiation_request' AND c.constraint_type = 'FOREIGN KEY'
      ORDER BY k.column_name
    `;
    expect(rows.map((row) => row.column_name)).toEqual(['refused_run_id', 'run_id']);
  });
});
