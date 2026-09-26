import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  bindingDigest,
  bindingDigestEnvelope,
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
  DrizzleRunDetailRepository,
  createSqlClient,
  CryptoUuidV7Generator,
  PostgresAgentWorkRepository,
  PostgresProceduresUnitOfWork,
  explainRecordReviewProjection,
  populationRow,
  populationSnapshot,
  runReviewSnapshotRow,
  type Database,
  type Sql,
} from '@intellifin/infrastructure';
import {
  PostgresRecordReviewRepository,
  readRecordNames,
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

interface ReferenceOnlyReviewRun {
  readonly runId: string;
  readonly procedureId: string;
  readonly versionId: string;
  readonly plan: ExecutablePlan;
  cleanup(): Promise<void>;
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

  it.each([
    { matching: 'historical' as const, sensitive: true },
    { matching: 'linked' as const, sensitive: true },
    { matching: 'linked' as const, sensitive: false },
  ])('reads human match provenance by exact registration link: $matching, sensitive=$sensitive', async ({ matching, sensitive }) => {
    const fixture = await seedMaskedRun(matching, sensitive);
    try {
      const matches = await new DrizzleRunDetailRepository(db).readHumanMatchedObservations(fixture.runId);
      expect(matches.total).toBe(1); expect(matches.rows[0]?.matchOrigin).toBe('human-matched');
      if (matching === 'linked') expect(matches.rows[0]?.matchingDecision).toMatchObject({ answerOptionId: 'candidate-2',
        answerLabel: sensitive ? null : 'Candidate 2', answerMasked: sensitive, actorId: seeded.actorId });
      else expect(matches.rows[0]?.matchingDecision).toBeNull();
      const queue = await repository().readPage({ runId: fixture.runId, actorId: seeded.actorId, pageSize: 25 });
      expect(queue.status).toBe('ready');
      if (queue.status === 'ready') expect(queue.rows.flatMap(row => row.targets).find(target => target.observationId === matches.rows[0]?.observationId)).toMatchObject({ matchOrigin: 'human-matched', matchingDecision: matches.rows[0]?.matchingDecision });
      const direct = await new DrizzleRunDetailRepository(db).readObservationsByIds(fixture.runId, [matches.rows[0]!.observationId]);
      expect(direct[0]?.matchingDecision).toEqual(matches.rows[0]?.matchingDecision);
      if (matching === 'linked') {
        const stored = await sql`SELECT r.row::text AS row FROM run_review_snapshot_row r
          JOIN run_review_snapshot s ON s.snapshot_id=r.snapshot_id WHERE s.run_id=${fixture.runId}`;
        expect(stored.length).toBeGreaterThan(0);
        if (sensitive) expect(JSON.stringify(stored)).not.toContain('Candidate 2');
        else expect(JSON.stringify(stored)).toContain('Candidate 2');
      }
      expect((await new DrizzleRunDetailRepository(db).readObservationsByIds(seeded.otherRunId, [matches.rows[0]!.observationId]))).toEqual([]);
    } finally { await fixture.cleanup(); }
  });

  it.each(['foreign-wait', 'wrong-digest', 'contradictory-links', 'duplicate-links', 'timeout', 'withdrawn', 'open', 'resume'] as const)(
    'refuses invalid human match provenance through detail and queue: %s', async invalid => {
      const fixture = await seedMaskedRun('linked', true, invalid);
      try {
        const [registration] = await sql<{ payload: { matchingDecisions: { observationId: string; digest: string; waitId: string }[] } }[]>`
          SELECT payload FROM audit_events WHERE aggregate_id=${fixture.runId} AND event_type='execution.observations-registered'`;
        const link = registration!.payload.matchingDecisions[0]!;
        const detail = new DrizzleRunDetailRepository(db);
        const matches = await detail.readHumanMatchedObservations(fixture.runId);
        expect(matches.total).toBe(1);
        expect(matches.rows[0]).toMatchObject({ observationId: link.observationId, matchOrigin: 'human-matched', matchingDecision: null });
        expect((await detail.readObservationsByIds(fixture.runId, [link.observationId]))[0]).toMatchObject({ matchingDecision: null });
        const queue = await repository().readPage({ runId: fixture.runId, actorId: seeded.actorId, pageSize: 25 });
        expect(queue.status).toBe('ready');
        if (queue.status !== 'ready') throw new Error('Expected review queue');
        expect(queue.rows.flatMap(row => row.targets).find(target => target.observationId === link.observationId))
          .toMatchObject({ matchOrigin: 'human-matched', matchingDecision: null });
      } finally {
        // A deliberately foreign wait must still be removed before the fixture Run.
        await sql`DELETE FROM run_wait WHERE wait_id::text IN (
          SELECT link->>'waitId' FROM audit_events e CROSS JOIN LATERAL jsonb_array_elements(e.payload->'matchingDecisions') link
          WHERE e.aggregate_id=${fixture.runId} AND e.event_type='execution.observations-registered')`;
        await fixture.cleanup();
      }
    },
  );

  it('counts one human-matched source record while retaining both target decisions', async () => {
    const result = await new DrizzleRunDetailRepository(db).readHumanMatchedRecords(seeded.runId);
    expect(result.total).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ sourceOrdinal: 1, populationRecordKey: 'Param-0001' });
    expect(result.rows[0]!.observations).toHaveLength(2);
    expect(new Set(result.rows[0]!.observations.map(row => row.targetSystem))).toEqual(new Set([seeded.primaryTarget.registrationId, seeded.secondaryTarget.registrationId]));
  });

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

  it('reads live totals without creating or evicting immutable review snapshots', async () => {
    const page = await repository().readPage({ runId: seeded.runId, actorId: seeded.actorId });
    expect(page.status).toBe('ready');
    if (page.status !== 'ready') return;
    const before = await sql`SELECT snapshot_id FROM run_review_snapshot WHERE run_id=${seeded.runId} ORDER BY snapshot_id`;
    const summary = await repository().readSummary({ runId: seeded.runId, actorId: seeded.actorId });
    expect(summary.status).toBe('ready');
    if (summary.status === 'ready') expect(summary.counts).toEqual(page.counts);
    expect(await sql`SELECT snapshot_id FROM run_review_snapshot WHERE run_id=${seeded.runId} ORDER BY snapshot_id`).toEqual(before);
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

  it('leaves a captured observation uninspected when its historical checks are missing without inventing an evidence problem', async () => {
    const observationId = observationIdFor(seeded.primaryWorkItemId, 'Param-0001');
    const originalChecks = await sql<{ check_name: string; outcome: string; diagnostic: string | null }[]>`
      SELECT check_name, outcome, diagnostic
      FROM run_observation_check
      WHERE observation_id=${observationId}
      ORDER BY check_name`;
    expect(originalChecks).toHaveLength(CHECKS.length);

    try {
      await sql`DELETE FROM run_observation_check WHERE observation_id=${observationId}`;
      const result = await repository().readPage({ runId: seeded.runId, actorId: seeded.actorId, pageSize: 50 });
      expect(result.status).toBe('ready');
      if (result.status !== 'ready') return;

      const row = result.rows.find(entry => entry.sourceOrdinal === 1)!;
      const primary = row.targets.find(target => target.targetId === seeded.primaryTarget.registrationId);
      expect(primary).toMatchObject({
        observationId,
        inspected: false,
        evidenceProblem: false,
        assessmentState: 'not-inspected',
      });
      expect(result.counts.inspectedUnits).toBe(96);
      expect(result.counts.fullyInspectedSubjects).toBe(0);
      expect(result.counts.evidenceProblemRecords).toBe(4);
    } finally {
      for (const check of originalChecks) {
        await sql`INSERT INTO run_observation_check(observation_id,run_id,check_name,outcome,diagnostic)
          VALUES(${observationId},${seeded.runId},${check.check_name},${check.outcome},${check.diagnostic})
          ON CONFLICT (observation_id,check_name) DO UPDATE
          SET run_id=excluded.run_id,outcome=excluded.outcome,diagnostic=excluded.diagnostic`;
      }
    }
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

  it('retains source rows for a valid frozen plan whose only Target is a versioned-file Reference Source', async () => {
    const referenceRun = await seedReferenceOnlyRun();
    try {
      const classification = classifyPlanTargets(referenceRun.plan);
      expect(classification.unsupported).toBeNull();
      expect(classification.references).toHaveLength(1);
      expect(classification.adapters).toHaveLength(0);
      expect(classification.agents).toHaveLength(0);

      const result = await repository().readPage({ runId: referenceRun.runId, actorId: seeded.actorId, pageSize: 25 });
      expect(result).toMatchObject({ status: 'ready', filteredRows: 2 });
      if (result.status !== 'ready') return;
      expect(result.rows.map(row => row.sourceOrdinal)).toEqual([1, 2]);
      expect(result.rows.map(row => row.recordLabel)).toEqual(['Reference-0001', 'Reference-0002']);
      expect(result.rows.every(row => row.targets.length === 0)).toBe(true);
      expect(result.counts.requiredUnits).toBe(0);
      expect(result.counts.inspectedUnits).toBe(0);
      expect(result.counts.fullyInspectedSubjects).toBe(0);
      expect(result.counts.evidenceProblemRecords).toBe(0);
    } finally {
      await referenceRun.cleanup();
    }
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

  it('round-trips a cursor for an empty filtered snapshot without rejecting position zero', async () => {
    const first = await repository().readPage({
      runId: seeded.runId,
      actorId: seeded.actorId,
      search: 'does-not-exist-in-the-population',
      pageSize: 25,
    });
    expect(first).toMatchObject({
      status: 'ready',
      filteredRows: 0,
      rows: [],
      pageNumber: 1,
      nextCursor: null,
      previousCursor: null,
    });
    if (first.status !== 'ready') return;

    const roundTrip = await repository().readPage({
      runId: seeded.runId,
      actorId: seeded.actorId,
      cursor: first.cursor,
      search: 'does-not-exist-in-the-population',
      pageSize: 25,
    });
    expect(roundTrip).toMatchObject({
      status: 'ready',
      filteredRows: 0,
      rows: [],
      pageNumber: 1,
      nextCursor: null,
      previousCursor: null,
    });
    if (roundTrip.status !== 'ready') return;
    expect(roundTrip.cursor).toBe(first.cursor);
    expect(roundTrip.revision).toBe(first.revision);
  });

  it('rejects an update to an immutable presentation snapshot row with check-violation 23514', async () => {
    const first = await repository().readPage({ runId: seeded.runId, actorId: seeded.actorId, pageSize: 25 });
    expect(first.status).toBe('ready');
    if (first.status !== 'ready') return;

    const [stored] = await sql<{ snapshot_id: string; position: number; row: unknown }[]>`
      SELECT r.snapshot_id::text AS snapshot_id, snapshot_row.position, snapshot_row.row
      FROM run_review_snapshot_row snapshot_row
      JOIN run_review_snapshot r ON r.snapshot_id=snapshot_row.snapshot_id
      WHERE r.run_id=${seeded.runId} AND r.actor_id=${seeded.actorId}
      ORDER BY r.created_at DESC, snapshot_row.position
      LIMIT 1`;
    expect(stored).toBeDefined();
    if (!stored) return;

    let failure: unknown;
    try {
      await sql`UPDATE run_review_snapshot_row
        SET row=${JSON.stringify({ tampered: true })}::jsonb
        WHERE snapshot_id=${stored.snapshot_id}::uuid AND position=${stored.position}`;
    } catch (error) {
      failure = error;
    }
    expect((failure as { code?: string } | undefined)?.code).toBe('23514');
    const [unchanged] = await sql<{ row: unknown }[]>`
      SELECT row FROM run_review_snapshot_row
      WHERE snapshot_id=${stored.snapshot_id}::uuid AND position=${stored.position}`;
    expect(unchanged?.row).toEqual(stored.row);
  });

  it('admits concurrent cursorless reads while retaining at most two actor/run snapshots', async () => {
    const started = performance.now();
    const results = await Promise.all(Array.from({ length: 8 }, () => repository().readPage({
      runId: seeded.runId,
      actorId: seeded.actorId,
      pageSize: 25,
    })));
    expect(results.every(result => result.status === 'ready')).toBe(true);
    expect(results.every(result => result.status === 'ready' && result.rows.length === 25)).toBe(true);

    const snapshots = await sql<{ snapshot_id: string }[]>`
      SELECT snapshot_id::text
      FROM run_review_snapshot
      WHERE actor_id=${seeded.actorId} AND run_id=${seeded.runId}`;
    expect(snapshots.length).toBeLessThanOrEqual(2);
    const artifact = fileURLToPath(new URL('../../test-results/record-review-admission-timing.json', import.meta.url));
    await mkdir(dirname(artifact), { recursive: true });
    await writeFile(artifact, JSON.stringify({ readers: 8, sourceRows: 1000, elapsedMs: performance.now() - started,
      scope: 'Focused contention regression; not the measured-capacity gate' }, null, 2));
  });

  it('releases a one-connection pool without projecting while admission is held, independently of other actors and Runs', async () => {
    const { release, reader } = await heldAdmissionReader();
    const pending = reader.repository.readPage({ runId: seeded.runId, actorId: seeded.actorId });
    void pending.catch(() => undefined);
    try {
      await barrier(reader.attempted);
      // This query can finish only after the rejected transaction returns the sole
      // connection. The admission owner is still held by the explicit barrier.
      expect(await barrier(reader.client`SELECT 1 AS pool_probe`.execute())).toMatchObject([{ pool_probe: 1 }]);
      expect(reader.queries.some(query => /user_role|population_row|run_review_snapshot/i.test(query))).toBe(false);
      expect(reader.queries.find(query => /^\s*select/i.test(query))).toContain('pg_try_advisory_xact_lock');
      expect(await sql`SELECT snapshot_id FROM run_review_snapshot WHERE run_id=${seeded.runId}`).toHaveLength(0);
      const otherActor = await repository().readPage({ runId: seeded.runId, actorId: seeded.otherActorId });
      const otherRun = await repository().readPage({ runId: seeded.otherRunId, actorId: seeded.actorId });
      expect(otherActor.status).toBe('ready');
      expect(otherRun.status).toBe('ready');
      expect(await sql`SELECT snapshot_id FROM run_review_snapshot WHERE run_id=${seeded.runId} AND actor_id=${seeded.actorId}`).toHaveLength(0);
      await release();
      expect((await pending).status).toBe('ready');
    } finally {
      try {
        await release();
        await pending.catch(() => undefined);
      } finally { await reader.client.end({ timeout: 5 }); }
    }
  });

  it('observes role revocation committed while waiting before creating any snapshot', async () => {
    const [role] = await sql`SELECT role,assigned_at::text AS assigned_at FROM user_role WHERE user_id=${seeded.actorId}`;
    const { release, reader } = await heldAdmissionReader();
    const pending = reader.repository.readPage({ runId: seeded.runId, actorId: seeded.actorId });
    void pending.catch(() => undefined);
    try {
      await barrier(reader.attempted);
      await barrier(reader.client`SELECT 1 AS pool_probe`.execute());
      await sql`DELETE FROM user_role WHERE user_id=${seeded.actorId}`;
      await release();
      expect(await pending).toEqual({ status: 'denied' });
      expect(await sql`SELECT snapshot_id FROM run_review_snapshot WHERE run_id=${seeded.runId}`).toHaveLength(0);
      expect(reader.queries.some(query => /population_row/i.test(query))).toBe(false);
    } finally {
      try {
        await release();
        await pending.catch(() => undefined);
      } finally {
        try {
          await sql`INSERT INTO user_role(user_id,role,assigned_at) VALUES (${seeded.actorId},${role!.role},${role!.assigned_at}::timestamptz)
            ON CONFLICT (user_id) DO UPDATE SET role=excluded.role,assigned_at=excluded.assigned_at`;
        } finally { await reader.client.end({ timeout: 5 }); }
      }
    }
  });

  it('rolls back materialized rows and releases admission after a real transaction failure', async () => {
    for (let i = 0; i < 2; i++) {
      expect((await repository().readPage({ runId: seeded.runId, actorId: seeded.actorId })).status).toBe('ready');
    }
    const prior = await sql`SELECT * FROM run_review_snapshot WHERE run_id=${seeded.runId} ORDER BY snapshot_id`;
    expect(prior).toHaveLength(2);
    const priorRows = await sql`SELECT * FROM run_review_snapshot_row
      WHERE snapshot_id IN (${prior[0]!.snapshot_id},${prior[1]!.snapshot_id}) ORDER BY snapshot_id,position`;
    const transaction = db.transaction.bind(db);
    let rolledBackSnapshot: string | undefined;
    const intercepted = vi.spyOn(db, 'transaction').mockImplementationOnce((callback, config) => transaction(async tx => {
      await callback(tx);
      const headers = await tx.query.runReviewSnapshot.findMany({ where: (s, { and, eq }) =>
        and(eq(s.runId, seeded.runId), eq(s.actorId, seeded.actorId)) });
      expect(headers.filter(header => prior.some(old => old.snapshot_id === header.snapshotId))).toHaveLength(1);
      const header = headers.find(header => !prior.some(old => old.snapshot_id === header.snapshotId));
      expect(header).toBeDefined();
      rolledBackSnapshot = header!.snapshotId;
      const materialized = await tx.query.runReviewSnapshotRow.findMany({ where: (r, { eq }) => eq(r.snapshotId, header!.snapshotId) });
      expect(materialized).toHaveLength(1000);
      // PostgreSQL aborts the real transaction after the snapshot rows exist.
      await tx.insert(runReviewSnapshotRow).values(materialized[0]!);
      throw new Error('Expected PostgreSQL duplicate-key violation');
    }, config));
    try {
      await expect(repository().readPage({ runId: seeded.runId, actorId: seeded.actorId }))
        .rejects.toThrow(/^Record review read failed \(23505\)$/);
    } finally {
      intercepted.mockRestore();
    }
    expect(await sql`SELECT * FROM run_review_snapshot WHERE run_id=${seeded.runId} ORDER BY snapshot_id`).toEqual(prior);
    expect(await sql`SELECT * FROM run_review_snapshot_row
      WHERE snapshot_id IN (${prior[0]!.snapshot_id},${prior[1]!.snapshot_id}) ORDER BY snapshot_id,position`).toEqual(priorRows);
    expect(rolledBackSnapshot).toBeDefined();
    expect(await sql`SELECT snapshot_id FROM run_review_snapshot_row WHERE snapshot_id=${rolledBackSnapshot!}`).toHaveLength(0);
    await sql.begin(async tx => {
      const [lock] = await tx`SELECT pg_try_advisory_xact_lock(hashtextextended(${`record-review:${seeded.actorId}:${seeded.runId}`},0)) AS acquired`;
      expect(lock!.acquired).toBe(true);
    });
    expect((await repository().readPage({ runId: seeded.runId, actorId: seeded.actorId })).status).toBe('ready');
  });

  it('pages an existing cursor while cursorless admission is held', async () => {
    const first = await repository().readPage({ runId: seeded.runId, actorId: seeded.actorId, pageSize: 25 });
    expect(first.status).toBe('ready');
    if (first.status !== 'ready' || !first.nextCursor) throw new Error('Expected a second page cursor');
    const { release, reader } = await heldAdmissionReader();
    try {
      const page = await barrier(reader.repository.readPage({ runId: seeded.runId, actorId: seeded.actorId,
        pageSize: 25, cursor: first.nextCursor }));
      expect(page).toMatchObject({ status: 'ready', pageNumber: 2 });
      if (page.status !== 'ready') throw new Error('Expected the cursor page');
      expect(page.rows.map(row => row.sourceOrdinal)).toEqual(Array.from({ length: 25 }, (_, index) => index + 26));
      // Paging still reads current source metadata to report changes/evidence issues;
      // it must not acquire creation admission or mutate presentation snapshots.
      expect(reader.queries.some(query => /pg_try_advisory_xact_lock|(?:insert into|delete from)\s+"?run_review_snapshot/i.test(query))).toBe(false);
      expect(await sql`SELECT snapshot_id FROM run_review_snapshot WHERE run_id=${seeded.runId}`).toHaveLength(1);
    } finally {
      try { await release(); } finally { await reader.client.end({ timeout: 5 }); }
    }
  });

  it('expires while queued for the only pool connection and never projects after its later release', async () => {
    const reader = await admissionReader();
    const occupied = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const held = reader.client.begin(async tx => {
      await tx`SELECT 1 AS occupied_pool`;
      occupied.resolve();
      await release.promise;
    });
    const transaction = reader.database.transaction.bind(reader.database);
    let queued: Promise<unknown> | undefined;
    const intercepted = vi.spyOn(reader.database, 'transaction').mockImplementationOnce((callback, config) => {
      const pending = transaction(callback, config);
      queued = pending;
      return pending;
    });
    try {
      await barrier(Promise.race([occupied.promise, held]));
      reader.queries.length = 0;
      const started = performance.now();
      expect(await reader.repository.readPage({ runId: seeded.runId, actorId: seeded.actorId }))
        .toEqual({ status: 'unavailable' });
      expect(performance.now() - started).toBeGreaterThanOrEqual(10000);
      expect(performance.now() - started).toBeLessThan(15000);
      expect(queued).toBeDefined();
      release.resolve();
      await barrier(held);
      await barrier(queued!);
      expect(reader.queries.some(query => /pg_try_advisory_xact_lock|user_role|population_row|run_review_snapshot/i.test(query))).toBe(false);
      expect(await sql`SELECT snapshot_id FROM run_review_snapshot WHERE run_id=${seeded.runId}`).toHaveLength(0);
      expect(await reader.client`SELECT 1 AS pool_probe`).toMatchObject([{ pool_probe: 1 }]);
    } finally {
      release.resolve();
      intercepted.mockRestore();
      try {
        await held.catch(() => undefined);
        await queued?.catch(() => undefined);
      } finally { await reader.client.end({ timeout: 5 }); }
    }
  });

  it('refuses held admission at the monotonic ten-second deadline without leaking errors or projecting', async () => {
    const { release, reader } = await heldAdmissionReader();
    const started = performance.now();
    try {
      const result = await reader.repository.readPage({ runId: seeded.runId, actorId: seeded.actorId });
      const elapsed = performance.now() - started;
      expect(result).toEqual({ status: 'unavailable' });
      expect(elapsed).toBeGreaterThanOrEqual(10000);
      expect(elapsed).toBeLessThan(15000);
      // More than eight failed admissions must not exhaust the SSI retry budget.
      expect(reader.queries.filter(query => query.includes('pg_try_advisory_xact_lock')).length).toBeGreaterThan(8);
      expect(reader.queries.some(query => /user_role|population_row|run_review_snapshot/i.test(query))).toBe(false);
      expect(await sql`SELECT snapshot_id FROM run_review_snapshot WHERE run_id=${seeded.runId}`).toHaveLength(0);
      expect(await reader.client`SELECT 1 AS pool_probe`).toMatchObject([{ pool_probe: 1 }]);
    } finally {
      try { await release(); } finally { await reader.client.end({ timeout: 5 }); }
    }
  });

  async function holdAdmission() {
    const acquired = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const held = sql.begin(async tx => {
      await tx`SET LOCAL lock_timeout = '5s'`;
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`record-review:${seeded.actorId}:${seeded.runId}`},0))`;
      acquired.resolve();
      await release.promise;
    });
    try {
      await barrier(Promise.race([acquired.promise, held]));
    } catch (error) {
      release.resolve();
      await held.catch(() => undefined);
      throw error;
    }
    return async () => { release.resolve(); await held; };
  }

  async function heldAdmissionReader() {
    const release = await holdAdmission();
    try {
      return { release, reader: await admissionReader() };
    } catch (error) {
      await release();
      throw error;
    }
  }

  async function admissionReader() {
    const attempted = Promise.withResolvers<void>();
    const queries: string[] = [];
    const client = createSqlClient(url!, { max: 1, debug: (_connection, query) => {
      queries.push(query);
      if (query.includes('pg_try_advisory_xact_lock')) attempted.resolve();
    } });
    try {
      await client`SELECT 1`;
    } catch (error) {
      await client.end({ timeout: 5 });
      throw error;
    }
    queries.length = 0;
    const database = createDb(client);
    return { client, database, queries, attempted: attempted.promise, repository: new PostgresRecordReviewRepository(database, () => now) };
  }

  // Timers bound a broken barrier; successful evidence is always a real query or
  // transaction completing before the owner explicitly releases admission.
  async function barrier<T>(work: PromiseLike<T>): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([work, new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('Admission database barrier did not complete')), 5000);
      })]);
    } finally {
      clearTimeout(timeout);
    }
  }

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
    expect(selection.maskedFields).toEqual([]);
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

  it('lists Exceptions first, then records waiting on a person, each in source order (UX-22)', async () => {
    // The seed's Exception is source row 1 and its pending assessment is row 2, so source
    // order alone would already put them first. A second Exception at row 101 is what shows
    // the queue ORDERS by what needs attention rather than merely starting where it does.
    await addSecondaryObservation(101, 'EXCEPTION');
    const first = await repository().readPage({ runId: seeded.runId, actorId: seeded.actorId, pageSize: 25 });
    expect(first.status).toBe('ready');
    if (first.status !== 'ready') return;
    expect(first.filteredRows).toBe(1000);
    expect(first.counts.exceptionRecords).toBe(2);
    expect(first.rows.map(row => row.sourceOrdinal)).toEqual([1, 101, 2, ...Array.from({ length: 22 }, (_, index) => index + 3)]);

    // The order is decided when the snapshot is written, so the next page continues in
    // source order and never repeats a record that moved to the front.
    const second = await repository().readPage({ runId: seeded.runId, actorId: seeded.actorId, cursor: first.nextCursor!, pageSize: 25 });
    expect(second.status).toBe('ready');
    if (second.status !== 'ready') return;
    expect(second.rows.map(row => row.sourceOrdinal)).toEqual(Array.from({ length: 25 }, (_, index) => index + 25));

    const exceptions = await repository().readPage({ runId: seeded.runId, actorId: seeded.actorId, filter: 'exceptions', pageSize: 25 });
    expect(exceptions).toMatchObject({ status: 'ready', filteredRows: 2 });
    if (exceptions.status === 'ready') expect(exceptions.rows.map(row => row.sourceOrdinal)).toEqual([1, 101]);
  });

  it('never stores, searches or returns a field the frozen binding designates sensitive (FR-41, UX-25)', async () => {
    const masked = await seedMaskedRun();
    try {
      const page = await repository().readPage({ runId: masked.runId, actorId: seeded.actorId, pageSize: 25 });
      expect(page.status).toBe('ready');
      if (page.status !== 'ready') return;
      expect(page.rows.map(row => row.sourceOrdinal)).toEqual([1, 2]);
      // The observed account is not sensitive and is shown; the captured status is, and is
      // withheld from the row altogether rather than stored and hidden later.
      expect(page.rows[0]!.targets[0]).toMatchObject({ account: 'ACC-1', capturedStatus: null });
      const stored = await sql`SELECT r.row::text AS row FROM run_review_snapshot_row r
        JOIN run_review_snapshot s ON s.snapshot_id=r.snapshot_id WHERE s.run_id=${masked.runId}`;
      expect(stored.length).toBe(2);
      expect(stored.some(entry => String(entry.row).includes('SECRET-STATUS'))).toBe(false);
      expect(stored.some(entry => String(entry.row).includes('SECRET-APPROVED'))).toBe(false);

      // A masked KEY is still the row's identity, but typing it finds nothing, so a search
      // cannot probe whether a masked record exists. Non-sensitive text is still searchable.
      const byKey = await repository().readPage({ runId: masked.runId, actorId: seeded.actorId, search: 'secret-0001' });
      expect(byKey).toMatchObject({ status: 'ready', filteredRows: 0, rows: [] });
      const byStatus = await repository().readPage({ runId: masked.runId, actorId: seeded.actorId, search: 'secret-status' });
      expect(byStatus).toMatchObject({ status: 'ready', filteredRows: 0, rows: [] });
      const byAccount = await repository().readPage({ runId: masked.runId, actorId: seeded.actorId, search: 'acc-1' });
      expect(byAccount).toMatchObject({ status: 'ready', filteredRows: 1, rows: [{ sourceOrdinal: 1 }] });

      const selection = await repository().readSelection({ runId: masked.runId, actorId: seeded.actorId, sourceOrdinal: 1 });
      expect(selection).toMatchObject({ status: 'ready', maskedFields: ['approved_value', 'parameter', 'status'] });
      if (selection.status !== 'ready') return;
      expect(selection.sourceValues).toEqual({
        parameter: null,
        observed_value: 'enabled',
        approved_value: null,
        observation_time: '2026-09-05T10:00:00.000Z',
        status: null,
        account_id: 'ACC-1',
      });
      expect(selection.row.targets[0]).toMatchObject({ account: 'ACC-1', capturedStatus: null });
    } finally {
      await masked.cleanup();
    }
  });

  it('names a record by its frozen name column only when the binding permits it and the key is unique (UX-25)', async () => {
    const runId = ids.next();
    await insertRun(runId, seeded.procedureId, seeded.versionId, seeded.actorId, '2026-09-19T12:00:00.000Z', '2026-10-01', '2026-10-31');
    try {
      const people: Record<string, JsonValue>[] = [
        { employee_id: 'E-000101', full_name: 'Dana Leaver' },
        { employee_id: 'E-000102', full_name: '   ' },
        { employee_id: 'E-000103', full_name: 'First Person' },
        { employee_id: 'E-000103', full_name: 'Second Person' },
        { employee_id: 'E-000104', full_name: 42 },
        { employee_id: 'E-000105' },
      ];
      await db.insert(populationSnapshot).values({
        runId,
        included: people.length,
        excluded: 0,
        indeterminate: 0,
        rowsDigest: null,
        checks: POPULATION_CHECK_NAMES.map(name => ({ name, passed: true })),
        generatedAt: new Date('2026-09-01T00:00:00.000Z'),
        declaredCount: people.length,
        retrievedCount: people.length,
      });
      await db.insert(populationRow).values(people.map((values, index) => ({
        runId, ordinal: index + 1, values, disposition: 'included' as const, reasons: [] as string[],
      })));

      const keys = ['E-000101', 'E-000102', 'E-000103', 'E-000104', 'E-000105', 'E-404404'];
      const p1: ExecutablePlan = { ...seeded.plan, inputs: { ...seeded.plan.inputs, templateId: 'P-1' } };
      // Only the unique key with a real name is answered: a blank name, a duplicated key,
      // a non-text value, a missing value and an unknown key all leave the key alone.
      expect([...(await readRecordNames(db, runId, p1, keys))]).toEqual([['E-000101', 'Dana Leaver']]);

      const sensitiveSource = {
        kind: 'versioned-file' as const,
        location: 'https://synthetic.invalid/leavers.csv',
        declaredSchema: ['employee_id', 'full_name'],
        sensitiveFields: ['full_name'],
        declaredCountMechanism: 'cover-sheet' as const,
      };
      const maskedName: ExecutablePlan = { ...p1, inputs: { ...p1.inputs, sourceSnapshot: {
        bindingId: ids.next(), displayName: 'Leavers', digest: bindingDigest(sensitiveSource), contract: bindingDigestEnvelope(sensitiveSource),
      } } };
      expect((await readRecordNames(db, runId, maskedName, keys)).size).toBe(0);
      // A Template whose frozen lookup declares no name column names nobody, and another
      // Run's population is never read.
      expect((await readRecordNames(db, runId, seeded.plan, keys)).size).toBe(0);
      expect((await readRecordNames(db, seeded.runId, p1, keys)).size).toBe(0);
    } finally {
      await sql`DELETE FROM population_row WHERE run_id=${runId}`;
      await sql`DELETE FROM population_snapshot WHERE run_id=${runId}`;
      await sql`DELETE FROM audit_events WHERE aggregate_id=${runId}`;
      await sql`DELETE FROM audit_event_heads WHERE aggregate_id=${runId}`;
      await sql`DELETE FROM audit_run WHERE run_id=${runId}`;
    }
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
      const captured = observation({ runId, target, workItemId, stepExecutionId, key, ordinal, evidenceId });
      const record = ordinal === 1 ? { ...captured, matchOrigin: 'human-matched' as const } : captured;
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
      // Evidence is the parent row for Work Item.evidence_id. Persist the registered
      // artifact before the Work Item references it; this keeps the fixture valid on a
      // database enforcing the foreign key during each statement.
      await context.saveEvidence(primaryEvidence);
      await context.saveEvidence(secondaryEvidence);
      await context.saveWorkItem({ workItemId: primaryWorkItemId, subjectKey: null, stepId: primaryStepId, ordinal: 1, registrationId: primaryTarget.registrationId, displayName: primaryTarget.displayName, state: 'OBSERVED', attempts: 1, cycles: 0, diagnostic: null, evidenceId: primaryEvidenceId, observations: 1 });
      await context.saveStepExecution({ stepExecutionId: primaryStepExecutionId, planStepId: primaryStepId, workItemId: primaryWorkItemId, action: 'inspect-record', state: 'SUCCEEDED', attempt: 1, startedAt: at, completedAt: at, diagnostic: null });
      await context.saveWorkItem({ workItemId: secondaryWorkItemId, subjectKey: null, stepId: secondaryStepId, ordinal: 2, registrationId: secondaryTarget.registrationId, displayName: secondaryTarget.displayName, state: 'OBSERVED', attempts: 1, cycles: 0, diagnostic: null, evidenceId: secondaryEvidenceId, observations: 97 });
      await context.saveStepExecution({ stepExecutionId: secondaryStepExecutionId, planStepId: secondaryStepId, workItemId: secondaryWorkItemId, action: 'extract-adapter', state: 'SUCCEEDED', attempt: 1, startedAt: at, completedAt: at, diagnostic: null });
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

  async function addSecondaryObservation(ordinal: number, value: 'COMPLIANT' | 'EXCEPTION' = 'COMPLIANT'): Promise<void> {
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
      conditionId: 'C1', origin: 'RULE', value, confirmation: null, confidence: null,
      rationale: value === 'EXCEPTION' ? 'Synthetic deviation' : null, diagnostic: null, evidenceIds: [seeded.secondaryEvidenceId],
    }};
    await new PostgresAgentWorkRepository(db).transaction(seeded.runId, async context => {
      await context.saveObservations([{ record, digest: observationDigest(record), coverage: 'COVERED', corroboration: 'MATCHED', observedAtSource: record.observedAt }]);
      await context.saveObservationChecks(checks);
      await context.saveObservationEvaluations([evaluation]);
      await context.saveWorkItem({ workItemId: seeded.secondaryWorkItemId, subjectKey: null, stepId: inspectStep(seeded.plan, seeded.secondaryTarget.registrationId), ordinal: 2, registrationId: seeded.secondaryTarget.registrationId, displayName: seeded.secondaryTarget.displayName, state: 'OBSERVED', attempts: 1, cycles: 0, diagnostic: null, evidenceId: seeded.secondaryEvidenceId, observations: 98 });
    });
  }

  /**
   * A P-4 Run whose frozen binding designates the record key, the approved value and the
   * captured status sensitive. Row 1 is inspected, with a non-sensitive `account_id` and a
   * sensitive `status` among its captured attributes; row 2 is not inspected.
   */
  async function seedMaskedRun(matching: 'platform' | 'historical' | 'linked' = 'platform', sensitive = true, invalid?: 'foreign-wait' | 'wrong-digest' | 'contradictory-links' | 'duplicate-links' | 'timeout' | 'withdrawn' | 'open' | 'resume'): Promise<{ runId: string; cleanup(): Promise<void> }> {
    const procedureId = ids.next();
    const versionId = ids.next();
    const runId = ids.next();
    const workItemId = ids.next();
    const stepExecutionId = ids.next();
    const evidenceId = ids.next();
    const source = {
      kind: 'versioned-file' as const,
      location: 'https://synthetic.invalid/masked-baseline.csv',
      declaredSchema: ['parameter', 'observed_value', 'approved_value', 'observation_time', 'status', 'account_id'],
      sensitiveFields: sensitive ? ['parameter', 'approved_value', 'status'] : [],
      declaredCountMechanism: 'cover-sheet' as const,
    };
    const inputs = {
      ...executablePlanInputs(),
      sourceSnapshot: { bindingId: ids.next(), displayName: 'Masked baseline', digest: bindingDigest(source), contract: bindingDigestEnvelope(source) },
    };
    const version = activeRunVersion(procedureId, versionId, seeded.actorId, inputs);
    await new PostgresProceduresUnitOfWork(db).execute(async context => {
      await context.procedures.insertProcedure(version);
      await context.procedures.insertVersion(version);
    });
    const plan = version.compiledPlan!;
    const target = plan.inputs.targets[0]!;
    const cleanup = async () => {
      await sql.begin(async cleanupSql => {
      await cleanupSql`SELECT run_id FROM audit_run WHERE run_id=${runId} FOR UPDATE`;
      await cleanupSql`DELETE FROM run_wait WHERE run_id=${runId}`;
      await cleanupSql`DELETE FROM run_review_snapshot WHERE run_id=${runId}`;
      await cleanupSql`DELETE FROM run_observation_check WHERE run_id=${runId}`;
      await cleanupSql`DELETE FROM run_observation_evaluation WHERE run_id=${runId}`;
      await cleanupSql`DELETE FROM run_observation_absence WHERE run_id=${runId}`;
      await cleanupSql`DELETE FROM run_observation WHERE run_id=${runId}`;
      await cleanupSql`DELETE FROM run_evidence_capture WHERE run_id=${runId}`;
      await cleanupSql`DELETE FROM run_tool_action WHERE run_id=${runId}`;
      await cleanupSql`DELETE FROM run_step_execution WHERE run_id=${runId}`;
      await cleanupSql`DELETE FROM run_work_item WHERE run_id=${runId}`;
      await cleanupSql`DELETE FROM run_evidence WHERE run_id=${runId}`;
      await cleanupSql`DELETE FROM population_row WHERE run_id=${runId}`;
      await cleanupSql`DELETE FROM population_snapshot WHERE run_id=${runId}`;
      await cleanupSql`DELETE FROM audit_events WHERE aggregate_id=${runId}`;
      await cleanupSql`DELETE FROM audit_event_heads WHERE aggregate_id=${runId}`;
      await cleanupSql`DELETE FROM audit_run WHERE run_id=${runId}`;
      await cleanupSql`DELETE FROM procedure_version WHERE procedure_id=${procedureId}`;
      await cleanupSql`DELETE FROM procedure WHERE procedure_id=${procedureId}`;
      });
    };
    try {
      await insertRun(runId, procedureId, versionId, seeded.actorId, '2026-09-19T12:00:00.000Z', '2026-08-01', '2026-08-31');
      await db.insert(populationSnapshot).values({
        runId,
        included: 2,
        excluded: 0,
        indeterminate: 0,
        rowsDigest: null,
        checks: POPULATION_CHECK_NAMES.map(name => ({ name, passed: true })),
        generatedAt: new Date('2026-09-01T00:00:00.000Z'),
        declaredCount: 2,
        retrievedCount: 2,
      });
      await db.insert(populationRow).values([1, 2].map(ordinal => ({
        runId,
        ordinal,
        values: {
          parameter: `Secret-000${ordinal}`,
          observed_value: 'enabled',
          approved_value: 'SECRET-APPROVED',
          observation_time: '2026-09-05T10:00:00.000Z',
          status: 'SECRET-STATUS',
          account_id: `ACC-${ordinal}`,
        },
        disposition: 'included' as const,
        reasons: [] as string[],
      })));

      const at = '2026-09-05T10:00:00.000Z';
      const stepId = inspectStep(plan, target.registrationId);
      const toolAction = action({ runId, workItemId, stepExecutionId, toolActionId: ids.next(), targetSystem: target.registrationId, at });
      const captured = observation({ runId, target, workItemId, stepExecutionId, key: 'Secret-0001', ordinal: 1, evidenceId });
      const record: ObservationRecord = {
        ...captured,
        matchOrigin: matching === 'platform' ? 'platform' : 'human-matched',
        attributes: [
          ...captured.attributes,
          attribute('account_id', 'ACC-1', evidenceId, '$.parameters[1].account_id'),
          attribute('status', 'SECRET-STATUS', evidenceId, '$.parameters[1].status'),
        ],
      };
      const matchingWaitId = ids.next();
      const closure = invalid === 'open' ? null : invalid === 'resume' ? 'resume' : invalid === 'timeout' || invalid === 'withdrawn' ? invalid : 'answer';
      const option = closure === 'answer' ? 'candidate-2' : closure === 'resume' ? 'resume' : null;
      if (matching === 'linked') await sql`INSERT INTO run_wait(wait_id,run_id,kind,options,opened_at,opened_by,deadline,closed_at,closure_kind,answer_option_id,actor)
        VALUES(${matchingWaitId},${invalid === 'foreign-wait' ? seeded.otherRunId : runId},${invalid === 'resume' ? 'pause' : 'choose-candidate'},
          ${JSON.stringify(invalid === 'resume' ? [{ id: 'resume', label: 'Resume' }] : [{ id: 'candidate-2', label: 'Candidate 2' }])}::jsonb,
          '2026-09-05T09:00:00Z',${invalid === 'resume' ? seeded.actorId : null},'2026-09-05T13:00:00Z',
          ${closure === null ? null : '2026-09-05T09:30:00Z'},${closure},${option},
          ${closure === null ? null : closure === 'timeout' ? 'wait-wake' : closure === 'withdrawn' ? 'run-terminal' : seeded.actorId})`;
      const link = { observationId: record.observationId, digest: observationDigest(record), waitId: matchingWaitId };
      const wrong = { ...link, digest: 'not-the-registered-observation-digest' };
      const matchingDecisions = invalid === 'wrong-digest' ? [wrong] : invalid === 'contradictory-links' ? [link, wrong] : invalid === 'duplicate-links' ? [link, link] : [link];
      await new PostgresAgentWorkRepository(db).transaction(runId, async context => {
        await context.saveEvidence(evidence({ evidenceId, runId, target, objectKey: `record-review/${runId}/masked`, at }));
        await context.saveWorkItem({ workItemId, subjectKey: null, stepId, ordinal: 1, registrationId: target.registrationId, displayName: target.displayName, state: 'OBSERVED', attempts: 1, cycles: 0, diagnostic: null, evidenceId, observations: 1 });
        await context.saveStepExecution({ stepExecutionId, planStepId: stepId, workItemId, action: 'inspect-record', state: 'SUCCEEDED', attempt: 1, startedAt: at, completedAt: at, diagnostic: null });
        await context.saveToolAction(toolAction);
        await context.saveCapture({ evidenceId, toolActionId: toolAction.toolActionId, sourceLocation: toolAction.destination });
        await context.saveObservations([{ record, digest: observationDigest(record), coverage: 'COVERED', corroboration: 'MATCHED', observedAtSource: record.observedAt }]);
        if (matching === 'linked') await context.auditEvents.append({ actor: { type: 'system', id: 'observation-registrar' },
          eventType: 'execution.observations-registered', source: 'worker', outcome: 'success', aggregateId: runId,
          correlationId: runId, sessionId: 'test', payload: { matchingDecisions } });
        await context.saveObservationChecks(CHECKS.map(check => ({ observationId: record.observationId, check, outcome: 'PASS', diagnostic: null })));
        await context.saveObservationEvaluations([{ observationId: record.observationId, coverage: 'COVERED', corroboration: 'MATCHED', evaluation: {
          conditionId: 'C1', origin: 'RULE', value: 'COMPLIANT', confirmation: null, confidence: null, rationale: null, diagnostic: null, evidenceIds: [evidenceId],
        } }]);
      });
    } catch (error) {
      await cleanup();
      throw error;
    }
    return { runId, cleanup };
  }

  async function seedReferenceOnlyRun(): Promise<ReferenceOnlyReviewRun> {
    const procedureId = ids.next();
    const versionId = ids.next();
    const runId = ids.next();
    const referenceRegistration = {
      registrationId: ids.next(),
      displayName: 'ReferenceOnly',
      kind: 'versioned-file' as const,
      allowedOrigins: ['https://synthetic.invalid/reference.csv'],
      applicationIdentity: '',
      credentialRef: 'vault://synthetic/reference-only',
      permittedActions: ['read-file', 'read-metadata'] as const,
      attributeLabelPatterns: ['parameter'],
      secondaryKey: '',
    };
    const inputs = {
      ...executablePlanInputs(),
      targets: [snapshotFromRegistration({
        ...referenceRegistration,
        digest: registrationDigest(referenceRegistration),
      })],
      instructions: [],
    };
    const version = activeRunVersion(procedureId, versionId, seeded.actorId, inputs);
    await new PostgresProceduresUnitOfWork(db).execute(async context => {
      await context.procedures.insertProcedure(version);
      await context.procedures.insertVersion(version);
    });

    await insertRun(runId, procedureId, versionId, seeded.actorId, '2026-09-19T12:00:00.000Z', '2026-08-01', '2026-08-31');
    await db.insert(populationSnapshot).values({
      runId,
      included: 2,
      excluded: 0,
      indeterminate: 0,
      rowsDigest: null,
      checks: POPULATION_CHECK_NAMES.map(name => ({ name, passed: true })),
      generatedAt: new Date('2026-09-01T00:00:00.000Z'),
      declaredCount: 2,
      retrievedCount: 2,
    });
    await db.insert(populationRow).values([1, 2].map(ordinal => ({
      runId,
      ordinal,
      values: { parameter: `Reference-${String(ordinal).padStart(4, '0')}` },
      disposition: 'included' as const,
      reasons: [] as string[],
    })));

    return {
      runId,
      procedureId,
      versionId,
      plan: version.compiledPlan!,
      cleanup: async () => {
        await sql`DELETE FROM run_review_snapshot WHERE run_id=${runId}`;
        await sql`DELETE FROM population_row WHERE run_id=${runId}`;
        await sql`DELETE FROM population_snapshot WHERE run_id=${runId}`;
        await sql`DELETE FROM audit_events WHERE aggregate_id=${runId}`;
        await sql`DELETE FROM audit_event_heads WHERE aggregate_id=${runId}`;
        await sql`DELETE FROM audit_run WHERE run_id=${runId}`;
        await sql`DELETE FROM procedure_version WHERE procedure_id=${procedureId}`;
        await sql`DELETE FROM procedure WHERE procedure_id=${procedureId}`;
      },
    };
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
