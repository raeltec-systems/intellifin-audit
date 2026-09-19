import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  observationDigest,
  observationIdFor,
  POPULATION_CHECK_NAMES,
  classifyPlanTargets,
  registrationDigest,
  snapshotFromRegistration,
  type ExecutablePlan,
  type JsonValue,
  type ObservationAttribute,
  type ObservationRecord,
  type SanitizedToolAction,
} from '@intellifin/domain';
import {
  type ObservationCheckRow,
  type ObservationEvaluationRow,
  type RegisteredObservation,
} from '@intellifin/application';
import {
  createDb,
  createSqlClient,
  CryptoUuidV7Generator,
  PostgresAgentWorkRepository,
  PostgresProceduresUnitOfWork,
  explainRecordReviewProjection,
  populationRow,
  populationSnapshot,
  type Database,
  type Sql,
} from '@intellifin/infrastructure';
import {
  PostgresRecordReviewRepository,
} from '../../packages/infrastructure/src/runs/record-review-repository.js';
import { activeRunVersion } from '../fixtures/active-run-version.js';
import { executablePlanInputs } from '../fixtures/executable-plan.js';

/**
 * This is deliberately a real PostgreSQL suite. The projection joins the frozen plan,
 * source membership, Work Items, Observations, evaluations, checks and Evidence. A fake
 * repository would miss the two invariants this surface exists to protect: source order is
 * the identity of the row, and duplicate source identities do not receive inspection
 * credit merely because a Target System happened to return one matching value.
 */
const url = process.env.DATABASE_URL;
const BASE_NOW = new Date('2026-09-19T12:00:00.000Z');
const CHECKS = [
  'required-evidence',
  'ambiguous-match',
  'freshness',
  'identity-corroboration',
  'search-completeness',
  'observation-corroboration',
] as const;

type Target = ExecutablePlan['inputs']['targets'][number];

interface SeededReviewRun {
  readonly runId: string;
  readonly otherRunId: string;
  readonly procedureId: string;
  readonly versionId: string;
  readonly actorId: string;
  readonly otherActorId: string;
  readonly plan: ExecutablePlan;
  readonly primaryTarget: Target;
  readonly secondaryTarget: Target;
  readonly primaryWorkItemId: string;
  readonly primaryStepExecutionId: string;
  readonly secondaryWorkItemId: string;
  readonly secondaryStepExecutionId: string;
  readonly primaryEvidenceId: string;
  readonly secondaryEvidenceId: string;
  readonly missingEvidenceId: string;
  readonly sourceValues: ReadonlyMap<number, Record<string, JsonValue>>;
}

describe.skipIf(!url)('record review projection on PostgreSQL 18', () => {
  let sql: Sql;
  let db: Database;
  let seeded: SeededReviewRun;
  let now = new Date(BASE_NOW);

  const ids = new CryptoUuidV7Generator();

  beforeAll(async () => {
    const target = new URL(url!);
    if (
      !['localhost', '127.0.0.1', '[::1]', 'postgres', 'db'].includes(target.hostname) ||
      !/(?:^|[_-])(?:test|ci)(?:[_-]|$)/i.test(target.pathname.slice(1))
    ) {
      throw new Error('Record review tests require an isolated local or CI test database');
    }

    sql = createSqlClient(url!, { max: 8 });
    db = createDb(sql);
    seeded = await seedReviewRun();
  }, 120_000);

  beforeEach(async () => {
    now = new Date(BASE_NOW);
    // Progress tests add one new Observation. Remove that append-only fixture row
    // between tests so each snapshot starts from the same 97 observed API units.
    const progressKey = seeded.sourceValues.get(101)!.parameter as string;
    const progressObservationId = observationIdFor(seeded.secondaryWorkItemId, progressKey);
    await sql`DELETE FROM run_observation_check WHERE observation_id=${progressObservationId}`;
    await sql`DELETE FROM run_observation_evaluation WHERE observation_id=${progressObservationId}`;
    await sql`DELETE FROM run_observation_absence WHERE observation_id=${progressObservationId}`;
    await sql`DELETE FROM run_observation WHERE observation_id=${progressObservationId}`;
    await sql`UPDATE run_work_item SET observations=97 WHERE work_item_id=${seeded.secondaryWorkItemId}`;
    // Tests intentionally create fresh query snapshots. Removing prior presentation
    // copies keeps each cursor assertion about the snapshot made in that test, while
    // leaving all source, Observation and Evidence rows untouched.
    await sql`DELETE FROM run_review_snapshot WHERE run_id IN (${seeded.runId}, ${seeded.otherRunId})`;
  });

  afterAll(async () => {
    if (!sql || !seeded) return;
    try {
      for (const runId of [seeded.runId, seeded.otherRunId]) {
        await sql`DELETE FROM run_review_snapshot WHERE run_id=${runId}`;
        await sql`DELETE FROM run_observation_check WHERE run_id=${runId}`;
        await sql`DELETE FROM run_observation_evaluation WHERE run_id=${runId}`;
        await sql`DELETE FROM run_observation_absence WHERE run_id=${runId}`;
        await sql`DELETE FROM run_observation WHERE run_id=${runId}`;
        await sql`DELETE FROM run_evidence_capture WHERE run_id=${runId}`;
        await sql`DELETE FROM run_tool_action WHERE run_id=${runId}`;
        await sql`DELETE FROM run_step_execution WHERE run_id=${runId}`;
        await sql`DELETE FROM run_work_item WHERE run_id=${runId}`;
        await sql`DELETE FROM run_session_step WHERE run_id=${runId}`;
        await sql`DELETE FROM run_evidence WHERE run_id=${runId}`;
        await sql`DELETE FROM population_row WHERE run_id=${runId}`;
        await sql`DELETE FROM population_snapshot WHERE run_id=${runId}`;
        await sql`DELETE FROM audit_events WHERE aggregate_id=${runId}`;
        await sql`DELETE FROM audit_event_heads WHERE aggregate_id=${runId}`;
        await sql`DELETE FROM audit_run WHERE run_id=${runId}`;
      }
      await sql`DELETE FROM procedure_version WHERE procedure_id=${seeded.procedureId}`;
      await sql`DELETE FROM procedure WHERE procedure_id=${seeded.procedureId}`;
      await sql`DELETE FROM auth_user WHERE id IN (${seeded.actorId}, ${seeded.otherActorId})`;
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  const repository = () => new PostgresRecordReviewRepository(db, () => now);

  it('pages all 1,000 source rows in source order with exact full counts', async () => {
    const first = await repository().readPage({ runId: seeded.runId, actorId: seeded.actorId, pageSize: 25 });
    expect(first).toMatchObject({ status: 'ready', pageNumber: 1, pageSize: 25, filter: 'all', search: '' });
    if (first.status !== 'ready') return;

    expect(first.rows).toHaveLength(25);
    expect(first.rows.map(row => row.sourceOrdinal)).toEqual(
      Array.from({ length: 25 }, (_, index) => index + 1),
    );
    expect(first.filteredRows).toBe(1000);
    expect(first.counts).toEqual({
      sourceRows: 1000,
      sourceDeclaredCount: 1000,
      sourceGeneratedAt: '2026-09-01T00:00:00.000Z',
      sourceQuality: 'verified',
      runEvidenceProblems: 0,
      includedRows: 1000,
      excludedRows: 0,
      indeterminateRows: 0,
      fullyInspectedSubjects: 1,
      inspectedUnits: 97,
      requiredUnits: 2000,
      exceptionRecords: 1,
      unattributedObservations: 0,
      pendingAssessments: 1,
      evidenceProblemRecords: 4,
    });
    expect(first.asOf).toBe(BASE_NOW.toISOString());
    expect(new Date(first.expiresAt).getTime() - BASE_NOW.getTime()).toBe(600_000);

    const allRows = [...first.rows];
    let page = first;
    while (page.nextCursor !== null) {
      const next = await repository().readPage({
        runId: seeded.runId,
        actorId: seeded.actorId,
        cursor: page.nextCursor,
        pageSize: 25,
      });
      expect(next.status).toBe('ready');
      if (next.status !== 'ready') return;
      expect(next.pageNumber).toBe(page.pageNumber + 1);
      expect(next.previousCursor).toBe(page.cursor);
      allRows.push(...next.rows);
      page = next;
    }

    expect(allRows).toHaveLength(1000);
    expect(allRows.map(row => row.sourceOrdinal)).toEqual(
      Array.from({ length: 1000 }, (_, index) => index + 1),
    );
    expect(page.nextCursor).toBeNull();
    expect(page.pageNumber).toBe(40);
  });

  it('keeps multi-target partial results, duplicate identities and missing rows visible', async () => {
    const result = await repository().readPage({ runId: seeded.runId, actorId: seeded.actorId, pageSize: 50 });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;

    const row1 = result.rows.find(row => row.sourceOrdinal === 1)!;
    expect(row1.targets).toHaveLength(2);
    expect(row1.targets.every(target => target.inspected)).toBe(true);
    expect(row1.targets.map(target => target.targetId)).toEqual([
      seeded.primaryTarget.registrationId,
      seeded.secondaryTarget.registrationId,
    ]);

    const primaryObservationId = observationIdFor(seeded.primaryWorkItemId, 'Param-0001');
    const storedObservation = await sql`SELECT coverage, corroboration FROM run_observation WHERE observation_id=${primaryObservationId}`;
    expect(storedObservation[0]).toMatchObject({ coverage: 'COVERED', corroboration: 'MATCHED' });
    const linkedEvidence = await sql`SELECT e.state, c.tool_action_id
      FROM run_evidence e
      JOIN run_evidence_capture c ON c.evidence_id=e.evidence_id AND c.run_id=e.run_id
      WHERE e.run_id=${seeded.runId} AND e.evidence_id=${seeded.primaryEvidenceId}`;
    expect(linkedEvidence[0]).toMatchObject({ state: 'REGISTERED' });
    expect(linkedEvidence[0]?.tool_action_id).toBeTruthy();
    const storedChecks = await sql`SELECT check_name, outcome, diagnostic FROM run_observation_check WHERE observation_id=${primaryObservationId}`;
    for (const check of ['required-evidence', 'ambiguous-match', 'freshness', 'identity-corroboration']) {
      expect(storedChecks.find(row => row.check_name === check)).toMatchObject({ outcome: 'PASS', diagnostic: null });
    }
    expect(await sql`SELECT finding_id FROM run_evidence_integrity WHERE run_id=${seeded.runId}`).toHaveLength(0);

    const row2 = result.rows.find(row => row.sourceOrdinal === 2)!;
    expect(row2.targets).toHaveLength(2);
    expect(row2.targets.filter(target => target.observationId !== null)).toHaveLength(1);
    expect(row2.targets.find(target => target.targetId === seeded.primaryTarget.registrationId)).toMatchObject({
      observationId: null,
      inspected: false,
      assessmentState: 'not-inspected',
    });

    const duplicateRows = result.rows.filter(row => row.sourceOrdinal === 10 || row.sourceOrdinal === 11);
    expect(duplicateRows.map(row => [row.sourceOrdinal, row.recordLabel, row.duplicateIdentity])).toEqual([
      [10, 'DUPLICATE-ID', true],
      [11, 'DUPLICATE-ID', true],
    ]);
    expect(duplicateRows.every(row => row.targets.every(target => target.observationId === null && !target.inspected))).toBe(true);
    expect(duplicateRows.every(row => row.targets.every(target => target.evidenceProblem))).toBe(true);

    const missing = result.rows.find(row => row.sourceOrdinal === 20)!;
    expect(missing).toMatchObject({ sourceOrdinal: 20, recordLabel: 'Source row 20', missingIdentity: true });
    expect(missing.targets.every(target => target.observationId === null && !target.inspected)).toBe(true);
    expect(result.rows.find(row => row.sourceOrdinal === 4)?.recordLabel).toBe('  CaseSensitive–004  ');
  });

  it('applies filters and search while preserving counts from the unfiltered snapshot', async () => {
    const cases = [
      { filter: 'exceptions', expected: [1] },
      { filter: 'needs-review', expected: [2] },
      { filter: 'evidence-problems', expected: [3, 10, 11, 20] },
      { filter: 'not-inspected', expectedCount: 999 },
    ] as const;

    for (const testCase of cases) {
      const result = await repository().readPage({
        runId: seeded.runId,
        actorId: seeded.actorId,
        filter: testCase.filter,
        pageSize: 50,
      });
      expect(result.status).toBe('ready');
      if (result.status !== 'ready') continue;
      expect(result.counts.sourceRows).toBe(1000);
      expect(result.counts.requiredUnits).toBe(2000);
      if ('expected' in testCase) {
        expect(result.filteredRows).toBe(testCase.expected.length);
        expect(result.rows.map(row => row.sourceOrdinal)).toEqual(testCase.expected);
      } else {
        expect(result.filteredRows).toBe(testCase.expectedCount);
        expect(result.rows.every(row => row.targets.some(target => !target.inspected))).toBe(true);
      }
    }

    const search = await repository().readPage({
      runId: seeded.runId,
      actorId: seeded.actorId,
      search: 'param-0001',
      pageSize: 25,
    });
    expect(search).toMatchObject({ status: 'ready', filteredRows: 1, rows: [{ sourceOrdinal: 1, recordLabel: 'Param-0001' }] });
  });

  it('fails closed when a stored observation cannot be attributed to a source row', async () => {
    const record = observation({
      runId: seeded.runId,
      target: seeded.secondaryTarget,
      workItemId: seeded.secondaryWorkItemId,
      stepExecutionId: seeded.secondaryStepExecutionId,
      key: 'orphan-stored-observation',
      ordinal: 1001,
      evidenceId: seeded.secondaryEvidenceId,
    });
    try {
      await new PostgresAgentWorkRepository(db).transaction(seeded.runId, async context => {
        await context.saveObservations([{
          record,
          digest: observationDigest(record),
          coverage: 'COVERED',
          corroboration: 'MATCHED',
          observedAtSource: record.observedAt,
        }]);
      });
      const result = await repository().readPage({ runId: seeded.runId, actorId: seeded.actorId, pageSize: 25 });
      expect(result.status).toBe('ready');
      if (result.status !== 'ready') return;
      expect(result.counts.unattributedObservations).toBe(1);
      expect(result.counts.exceptionRecords).toBeNull();
    } finally {
      await sql`DELETE FROM run_observation_check WHERE observation_id=${record.observationId}`;
      await sql`DELETE FROM run_observation_evaluation WHERE observation_id=${record.observationId}`;
      await sql`DELETE FROM run_observation_absence WHERE observation_id=${record.observationId}`;
      await sql`DELETE FROM run_observation WHERE observation_id=${record.observationId}`;
      await sql`UPDATE run_work_item SET observations=97 WHERE work_item_id=${seeded.secondaryWorkItemId}`;
    }
  });

  it('keeps an opaque page stable while execution progresses and reports changesAvailable', async () => {
    const first = await repository().readPage({ runId: seeded.runId, actorId: seeded.actorId, pageSize: 25 });
    expect(first.status).toBe('ready');
    if (first.status !== 'ready' || first.nextCursor === null) return;

    await addSecondaryObservation(101);
    const stable = await repository().readPage({
      runId: seeded.runId,
      actorId: seeded.actorId,
      cursor: first.nextCursor,
      pageSize: 25,
    });
    expect(stable.status).toBe('ready');
    if (stable.status !== 'ready') return;
    expect(stable.changesAvailable).toBe(true);
    expect(stable.revision).toBe(first.revision);
    expect(stable.rows.map(row => row.sourceOrdinal)).toEqual(
      Array.from({ length: 25 }, (_, index) => index + 26),
    );
    expect(stable.counts.inspectedUnits).toBe(first.counts.inspectedUnits);
  });

  it('refreshes counts after progress and bounds actor/run snapshots', async () => {
    const before = await repository().readPage({ runId: seeded.runId, actorId: seeded.actorId, pageSize: 25 });
    expect(before.status).toBe('ready');
    if (before.status !== 'ready') return;

    await addSecondaryObservation(101);
    const refreshed = await repository().readPage({ runId: seeded.runId, actorId: seeded.actorId, pageSize: 25 });
    expect(refreshed).toMatchObject({ status: 'ready', changesAvailable: false, filteredRows: 1000 });
    if (refreshed.status !== 'ready') return;
    expect(refreshed.revision).not.toBe(before.revision);
    expect(refreshed.counts.inspectedUnits).toBe(before.counts.inspectedUnits + 1);

    await repository().readPage({ runId: seeded.runId, actorId: seeded.actorId, filter: 'exceptions', pageSize: 25 });
    await repository().readPage({ runId: seeded.runId, actorId: seeded.actorId, search: 'Param-0001', pageSize: 25 });
    const snapshots = await sql`SELECT snapshot_id FROM run_review_snapshot WHERE actor_id=${seeded.actorId} AND run_id=${seeded.runId}`;
    expect(snapshots.length).toBeLessThanOrEqual(2);
  });

  it('rejects malformed, cross-actor, cross-run and query-mismatched cursors without data', async () => {
    const first = await repository().readPage({ runId: seeded.runId, actorId: seeded.actorId, pageSize: 25 });
    expect(first.status).toBe('ready');
    if (first.status !== 'ready' || first.nextCursor === null) return;

    const cases = [
      { actorId: seeded.otherActorId, runId: seeded.runId, cursor: first.nextCursor, pageSize: 25 },
      { actorId: seeded.actorId, runId: seeded.otherRunId, cursor: first.nextCursor, pageSize: 25 },
      { actorId: seeded.actorId, runId: seeded.runId, cursor: first.nextCursor, filter: 'exceptions', pageSize: 25 },
      { actorId: seeded.actorId, runId: seeded.runId, cursor: first.nextCursor, search: 'Param-0001', pageSize: 25 },
      { actorId: seeded.actorId, runId: seeded.runId, cursor: first.nextCursor, pageSize: 50 },
      { actorId: seeded.actorId, runId: seeded.runId, cursor: 'not-a-cursor', pageSize: 25 },
    ] as const;
    for (const input of cases) {
      const result = await repository().readPage(input);
      expect(['invalid', 'missing']).toContain(result.status);
      expect(result).not.toHaveProperty('rows');
    }
  });

  it('reads the current role on every page and selection request', async () => {
    const page = await repository().readPage({ runId: seeded.runId, actorId: seeded.actorId, pageSize: 25 });
    expect(page.status).toBe('ready');
    if (page.status !== 'ready') return;
    const selection = await repository().readSelection({ runId: seeded.runId, actorId: seeded.actorId, sourceOrdinal: 1, listedRevision: page.revision });
    expect(selection.status).toBe('ready');

    await sql`DELETE FROM user_role WHERE user_id=${seeded.actorId}`;
    try {
      expect(await repository().readPage({ runId: seeded.runId, actorId: seeded.actorId, pageSize: 25 })).toEqual({ status: 'denied' });
      expect(await repository().readPage({ runId: seeded.runId, actorId: seeded.actorId, cursor: page.nextCursor ?? page.cursor, pageSize: 25 })).toEqual({ status: 'denied' });
      expect(await repository().readSelection({ runId: seeded.runId, actorId: seeded.actorId, sourceOrdinal: 1 })).toEqual({ status: 'denied' });
    } finally {
      await sql`INSERT INTO user_role(user_id,role) VALUES (${seeded.actorId},'auditor')`;
    }
  });

  it('returns expired for a cursor past the ten-minute TTL', async () => {
    const first = await repository().readPage({ runId: seeded.runId, actorId: seeded.actorId, pageSize: 25 });
    expect(first.status).toBe('ready');
    if (first.status !== 'ready' || first.nextCursor === null) return;
    expect(new Date(first.expiresAt).getTime() - new Date(first.asOf).getTime()).toBe(600_000);

    now = new Date(new Date(first.expiresAt).getTime() + 1);
    expect(await repository().readPage({ runId: seeded.runId, actorId: seeded.actorId, cursor: first.nextCursor, pageSize: 25 })).toEqual({ status: 'expired' });
  });

  it('returns selection details from the requested run and marks progress after a listed revision', async () => {
    const page = await repository().readPage({ runId: seeded.runId, actorId: seeded.actorId, pageSize: 25 });
    expect(page.status).toBe('ready');
    if (page.status !== 'ready') return;

    const selection = await repository().readSelection({ runId: seeded.runId, actorId: seeded.actorId, sourceOrdinal: 1, listedRevision: page.revision });
    expect(selection.status).toBe('ready');
    if (selection.status !== 'ready') return;
    expect(selection.row.sourceOrdinal).toBe(1);
    expect(selection.sourceValues).toEqual(seeded.sourceValues.get(1));
    expect(selection.sourceValues.parameter).toBe('Param-0001');
    expect(selection.conditions).toEqual(seeded.plan.inputs.complianceConditions.map(condition => ({ conditionId: condition.conditionId, text: condition.text })));
    expect(selection.scope).toBe(seeded.plan.inputs.scope);
    expect(selection.changedSinceList).toBe(false);

    await addSecondaryObservation(101);
    const changed = await repository().readSelection({ runId: seeded.runId, actorId: seeded.actorId, sourceOrdinal: 1, listedRevision: page.revision });
    expect(changed).toMatchObject({ status: 'ready', changedSinceList: true, row: { sourceOrdinal: 1 } });

    const otherRunSelection = await repository().readSelection({ runId: seeded.otherRunId, actorId: seeded.actorId, sourceOrdinal: 1 });
    expect(otherRunSelection).toMatchObject({ status: 'ready', sourceValues: { parameter: 'OTHER-RUN-ONLY' }, row: { sourceOrdinal: 1 } });
    expect((otherRunSelection as { sourceValues?: Record<string, JsonValue> }).sourceValues?.parameter).not.toBe('Param-0001');
    expect(await repository().readSelection({ runId: seeded.otherRunId, actorId: seeded.actorId, sourceOrdinal: 1000 })).toEqual({ status: 'missing' });
  });

  it('proves the production projection query with PostgreSQL EXPLAIN ANALYZE', async () => {
    const explain = await explainRecordReviewProjection(db, seeded.runId, seeded.plan) as unknown as readonly [{
      'QUERY PLAN'?: readonly [{ Plan?: { ['Actual Rows']?: number }; ['Execution Time']?: number }];
    }];
    const plan = explain[0]?.['QUERY PLAN']?.[0];
    expect(plan).toBeDefined();
    expect(plan?.Plan?.['Actual Rows']).toBe(2000);
    expect(plan?.['Execution Time']).toBeGreaterThanOrEqual(0);

    // CI keeps the actual plan as a review artifact. Assertions intentionally cover only
    // row count and successful execution; planner costs/timings vary by PostgreSQL host.
    const artifact = fileURLToPath(new URL('../../test-results/record-review-query-plan.json', import.meta.url));
    await mkdir(dirname(artifact), { recursive: true });
    await writeFile(artifact, JSON.stringify(explain, null, 2));
  });

  async function seedReviewRun(): Promise<SeededReviewRun> {
    const actorId = ids.next();
    const otherActorId = ids.next();
    const procedureId = ids.next();
    const versionId = ids.next();
    const runId = ids.next();
    const otherRunId = ids.next();
    const primaryWorkItemId = ids.next();
    const primaryStepExecutionId = ids.next();
    const secondaryWorkItemId = ids.next();
    const secondaryStepExecutionId = ids.next();
    const primaryEvidenceId = ids.next();
    const secondaryEvidenceId = ids.next();
    const missingEvidenceId = ids.next();
    const secondaryRegistrationId = ids.next();

    await sql`INSERT INTO auth_user(id,name,email) VALUES
      (${actorId},'Record review actor',${actorId + '@test.invalid'}),
      (${otherActorId},'Record review second actor',${otherActorId + '@test.invalid'})`;
    await sql`INSERT INTO user_role(user_id,role) VALUES (${actorId},'auditor'),(${otherActorId},'auditor')`;

    const baseInputs = executablePlanInputs();
    const primaryTarget = baseInputs.targets[0]!;
    const secondaryRegistration = {
      registrationId: secondaryRegistrationId,
      displayName: 'Config API',
      kind: 'api' as const,
      allowedOrigins: ['https://synthetic.invalid'],
      applicationIdentity: '',
      credentialRef: 'vault://synthetic/config-api',
      permittedActions: ['list-records', 'read-attribute'] as const,
      attributeLabelPatterns: ['Parameter'],
      secondaryKey: '',
    };
    const inputs = {
      ...baseInputs,
      targets: [primaryTarget, snapshotFromRegistration({ ...secondaryRegistration, digest: registrationDigest(secondaryRegistration) })],
      // The API target intentionally has no instruction; target draft validation refuses
      // instructions for a non-agent target.
      instructions: baseInputs.instructions,
    };
    const version = activeRunVersion(procedureId, versionId, actorId, inputs);
    await new PostgresProceduresUnitOfWork(db).execute(async context => {
      await context.procedures.insertProcedure(version);
      await context.procedures.insertVersion(version);
    });
    const plan = version.compiledPlan!;
    const secondaryTarget = plan.inputs.targets[1]!;
    const initiatedAt = '2026-09-01T00:00:00.000Z';
    await insertRun(runId, procedureId, versionId, actorId, initiatedAt, '2026-08-01', '2026-08-31');
    await insertRun(otherRunId, procedureId, versionId, actorId, initiatedAt, '2026-09-01', '2026-09-30');

    const sourceValues = new Map<number, Record<string, JsonValue>>();
    const rows = Array.from({ length: 1000 }, (_, index) => {
      const ordinal = index + 1;
      const parameter = ordinal === 10 || ordinal === 11
        ? 'DUPLICATE-ID'
        : ordinal === 20
          ? ''
          : ordinal === 4
            ? '  CaseSensitive–004  '
            : `Param-${ordinal.toString().padStart(4, '0')}`;
      const values = {
        parameter,
        observed_value: 'enabled',
        approved_value: 'enabled',
        observation_time: '2026-09-05T10:00:00.000Z',
      } satisfies Record<string, JsonValue>;
      sourceValues.set(ordinal, values);
      return { runId, ordinal, values, disposition: 'included' as const, reasons: [] as string[] };
    });
    await db.insert(populationSnapshot).values({
      runId,
      included: 1000,
      excluded: 0,
      indeterminate: 0,
      rowsDigest: null,
      checks: POPULATION_CHECK_NAMES.map(name => ({ name, passed: true })),
      generatedAt: new Date('2026-09-01T00:00:00.000Z'),
      declaredCount: 1000,
      retrievedCount: 1000,
    });
    for (let offset = 0; offset < rows.length; offset += 250) {
      await db.insert(populationRow).values(rows.slice(offset, offset + 250));
    }
    await db.insert(populationSnapshot).values({
      runId: otherRunId,
      included: 1,
      excluded: 0,
      indeterminate: 0,
      rowsDigest: null,
      checks: POPULATION_CHECK_NAMES.map(name => ({ name, passed: true })),
      generatedAt: new Date('2026-09-01T00:00:00.000Z'),
      declaredCount: 1,
      retrievedCount: 1,
    });
    await db.insert(populationRow).values({
      runId: otherRunId,
      ordinal: 1,
      values: { parameter: 'OTHER-RUN-ONLY', marker: 'different source' },
      disposition: 'included',
      reasons: [],
    });

    const primaryStepId = inspectStep(plan, primaryTarget.registrationId);
    const secondaryStepId = inspectStep(plan, secondaryTarget.registrationId);
    const at = '2026-09-05T10:00:00.000Z';
    const primaryAction = action({ runId, workItemId: primaryWorkItemId, stepExecutionId: primaryStepExecutionId, toolActionId: ids.next(), targetSystem: primaryTarget.registrationId, at });
    const secondaryAction = action({ runId, workItemId: secondaryWorkItemId, stepExecutionId: secondaryStepExecutionId, toolActionId: ids.next(), targetSystem: secondaryTarget.registrationId, at });
    const primaryEvidence = evidence({ evidenceId: primaryEvidenceId, runId, target: primaryTarget, objectKey: `record-review/${runId}/primary`, at });
    const secondaryEvidence = evidence({ evidenceId: secondaryEvidenceId, runId, target: secondaryTarget, objectKey: `record-review/${runId}/secondary`, at });

    const registered: RegisteredObservation[] = [];
    const checks: ObservationCheckRow[] = [];
    const evaluations: ObservationEvaluationRow[] = [];
    const add = (target: Target, workItemId: string, stepExecutionId: string, ordinal: number, kind: 'primary' | 'secondary') => {
      const values = sourceValues.get(ordinal)!;
      const key = values.parameter as string;
      const badEvidence = kind === 'secondary' && ordinal === 3;
      const evidenceId = badEvidence ? missingEvidenceId : kind === 'primary' ? primaryEvidenceId : secondaryEvidenceId;
      const record = observation({ runId, target, workItemId, stepExecutionId, key, ordinal, evidenceId });
      registered.push({ record, digest: observationDigest(record), coverage: 'COVERED', corroboration: 'MATCHED', observedAtSource: record.observedAt });
      for (const check of CHECKS) checks.push({ observationId: record.observationId, check, outcome: badEvidence && check === 'required-evidence' ? 'FAIL' : 'PASS', diagnostic: badEvidence && check === 'required-evidence' ? 'missing linked Evidence' : null });
      const pending = kind === 'secondary' && ordinal === 2;
      const exception = kind === 'secondary' && ordinal === 1;
      evaluations.push({ observationId: record.observationId, coverage: 'COVERED', corroboration: 'MATCHED', evaluation: {
        conditionId: 'C1',
        origin: pending ? 'AGENT_JUDGED' : 'RULE',
        value: exception ? 'EXCEPTION' : pending ? 'UNEVALUATED' : 'COMPLIANT',
        confirmation: pending ? 'pending' : null,
        confidence: pending ? '0.900000' : null,
        rationale: pending ? 'Awaiting auditor confirmation' : exception ? 'Synthetic deviation' : null,
        diagnostic: pending ? 'pending review' : null,
        evidenceIds: [evidenceId],
      }});
    };

    // P4's frozen plan uses one page Work Item per Target (subjectKey is deliberately
    // null for this template). The API is partial; the web target has one completed row.
    add(primaryTarget, primaryWorkItemId, primaryStepExecutionId, 1, 'primary');
    for (let ordinal = 1; ordinal <= 100; ordinal++) {
      if (ordinal === 10 || ordinal === 11 || ordinal === 20) continue;
      add(secondaryTarget, secondaryWorkItemId, secondaryStepExecutionId, ordinal, 'secondary');
    }

    const execution = new PostgresAgentWorkRepository(db);
    await execution.transaction(runId, async context => {
      await context.saveWorkItem({ workItemId: primaryWorkItemId, subjectKey: null, stepId: primaryStepId, ordinal: 1, registrationId: primaryTarget.registrationId, displayName: primaryTarget.displayName, state: 'OBSERVED', attempts: 1, cycles: 0, diagnostic: null, evidenceId: primaryEvidenceId, observations: 1 });
      await context.saveStepExecution({ stepExecutionId: primaryStepExecutionId, planStepId: primaryStepId, workItemId: primaryWorkItemId, action: 'inspect-record', state: 'SUCCEEDED', attempt: 1, startedAt: at, completedAt: at, diagnostic: null });
      await context.saveWorkItem({ workItemId: secondaryWorkItemId, subjectKey: null, stepId: secondaryStepId, ordinal: 2, registrationId: secondaryTarget.registrationId, displayName: secondaryTarget.displayName, state: 'OBSERVED', attempts: 1, cycles: 0, diagnostic: null, evidenceId: secondaryEvidenceId, observations: 97 });
      await context.saveStepExecution({ stepExecutionId: secondaryStepExecutionId, planStepId: secondaryStepId, workItemId: secondaryWorkItemId, action: 'extract-adapter', state: 'SUCCEEDED', attempt: 1, startedAt: at, completedAt: at, diagnostic: null });
      await context.saveEvidence(primaryEvidence);
      await context.saveEvidence(secondaryEvidence);
      await context.saveToolAction(primaryAction);
      await context.saveToolAction(secondaryAction);
      await context.saveCapture({ evidenceId: primaryEvidenceId, toolActionId: primaryAction.toolActionId, sourceLocation: primaryAction.destination });
      await context.saveCapture({ evidenceId: secondaryEvidenceId, toolActionId: secondaryAction.toolActionId, sourceLocation: secondaryAction.destination });
      await context.saveObservations(registered);
      await context.saveObservationChecks(checks);
      await context.saveObservationEvaluations(evaluations);
    });

    return {
      runId,
      otherRunId,
      procedureId,
      versionId,
      actorId,
      otherActorId,
      plan,
      primaryTarget,
      secondaryTarget,
      primaryWorkItemId,
      primaryStepExecutionId,
      secondaryWorkItemId,
      secondaryStepExecutionId,
      primaryEvidenceId,
      secondaryEvidenceId,
      missingEvidenceId,
      sourceValues,
    };
  }

  async function addSecondaryObservation(ordinal: number): Promise<void> {
    const values = seeded.sourceValues.get(ordinal)!;
    const key = values.parameter as string;
    const record = observation({
      runId: seeded.runId,
      target: seeded.secondaryTarget,
      workItemId: seeded.secondaryWorkItemId,
      stepExecutionId: seeded.secondaryStepExecutionId,
      key,
      ordinal,
      evidenceId: seeded.secondaryEvidenceId,
    });
    const checks: ObservationCheckRow[] = CHECKS.map(check => ({ observationId: record.observationId, check, outcome: 'PASS', diagnostic: null }));
    const evaluation: ObservationEvaluationRow = { observationId: record.observationId, coverage: 'COVERED', corroboration: 'MATCHED', evaluation: {
      conditionId: 'C1', origin: 'RULE', value: 'COMPLIANT', confirmation: null, confidence: null, rationale: null, diagnostic: null, evidenceIds: [seeded.secondaryEvidenceId],
    }};
    await new PostgresAgentWorkRepository(db).transaction(seeded.runId, async context => {
      await context.saveObservations([{ record, digest: observationDigest(record), coverage: 'COVERED', corroboration: 'MATCHED', observedAtSource: record.observedAt }]);
      await context.saveObservationChecks(checks);
      await context.saveObservationEvaluations([evaluation]);
      await context.saveWorkItem({ workItemId: seeded.secondaryWorkItemId, subjectKey: null, stepId: inspectStep(seeded.plan, seeded.secondaryTarget.registrationId), ordinal: 2, registrationId: seeded.secondaryTarget.registrationId, displayName: seeded.secondaryTarget.displayName, state: 'OBSERVED', attempts: 1, cycles: 0, diagnostic: null, evidenceId: seeded.secondaryEvidenceId, observations: 98 });
    });
  }

  async function insertRun(runId: string, procedureId: string, versionId: string, actorId: string, initiatedAt: string, periodFrom: string, periodTo: string): Promise<void> {
    await sql`INSERT INTO audit_run(request_token,run_id,correlation_id,procedure_id,version_id,version_number,procedure_name,period_from,period_to,state,kind,initiator_id,session_id,authorization_role,initiated_at)
      VALUES (${ids.next()},${runId},${ids.next()},${procedureId},${versionId},1,'Record review test',${periodFrom},${periodTo},'RUNNING','STANDARD',${actorId},'record-review-test','auditor',${initiatedAt})`;
  }

  function inspectStep(plan: ExecutablePlan, targetId: string): string {
    const classified = classifyPlanTargets(plan);
    const target = [...classified.adapters, ...classified.agents].find(entry => entry.target.registrationId === targetId);
    if (!target) throw new Error(`Missing frozen execution step for ${targetId}`);
    return target.stepId;
  }

  function evidence(input: { evidenceId: string; runId: string; target: Target; objectKey: string; at: string }) {
    return {
      evidenceId: input.evidenceId,
      runId: input.runId,
      kind: 'structural-snapshot' as const,
      registrationId: input.target.registrationId,
      objectKey: input.objectKey,
      mediaType: 'application/json',
      digest: input.evidenceId.replaceAll('-', '').padEnd(64, 'a').slice(0, 64),
      size: 128,
      required: true,
      state: 'REGISTERED' as const,
      role: 'evidence' as const,
      capturedAt: input.at,
      captureMethod: 'agent' as const,
      captureTimeSource: 'registration' as const,
    };
  }

  function action(input: { runId: string; workItemId: string; stepExecutionId: string; toolActionId: string; targetSystem: string; at: string }): SanitizedToolAction {
    return {
      toolActionId: input.toolActionId,
      runId: input.runId,
      workItemId: input.workItemId,
      stepExecutionId: input.stepExecutionId,
      surface: 'agent',
      targetSystem: input.targetSystem,
      action: 'read-attribute',
      method: 'GET',
      destination: `https://synthetic.invalid/${input.targetSystem}/parameters`,
      parameters: [],
      outcome: 'performed',
      denial: null,
      offending: null,
      status: 200,
      redirected: false,
      downloads: 0,
      startedAt: input.at,
      completedAt: input.at,
      diagnostic: null,
      capture: 'PERMITTED',
      captureSuppression: null,
    };
  }

  function attribute(name: string, value: string, evidenceId: string, locator: string): ObservationAttribute {
    return {
      name,
      originalValue: value,
      normalizedValue: value,
      grounding: { evidenceId, locator, label: name, extractedText: value },
      corroboration: 'matched',
    };
  }

  function observation(input: { runId: string; target: Target; workItemId: string; stepExecutionId: string; key: string; ordinal: number; evidenceId: string }): ObservationRecord {
    const observedAt = '2026-09-05T10:00:00.000Z';
    const identity = attribute('parameter', input.key, input.evidenceId, `$.parameters[${input.ordinal}].parameter`);
    const attributes = [
      attribute('observed_value', 'enabled', input.evidenceId, `$.parameters[${input.ordinal}].observed_value`),
      attribute('approved_value', 'enabled', input.evidenceId, `$.parameters[${input.ordinal}].approved_value`),
      attribute('observation_time', observedAt, input.evidenceId, `$.parameters[${input.ordinal}].observation_time`),
    ];
    return {
      schemaVersion: 1,
      observationId: observationIdFor(input.workItemId, input.key),
      workItemId: input.workItemId,
      populationRecordKey: input.key,
      targetSystem: input.target.registrationId,
      found: 'true',
      observedAt,
      stepExecutionId: input.stepExecutionId,
      captureMethod: 'agent',
      matchOrigin: 'platform',
      identity,
      attributes,
      evidenceIds: [input.evidenceId],
    };
  }
});
