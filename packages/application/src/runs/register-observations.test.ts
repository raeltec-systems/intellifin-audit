import { describe, expect, it } from 'vitest';
import {
  observationBatchDigest,
  observationDigest,
  observationIdFor,
  type ObservationAbsenceProof,
  type ObservationRecord,
  type RunRecord,
} from '@intellifin/domain';
import {
  NO_CORROBORATION,
  NO_EVALUATION,
  type EvidenceState,
  type ObservationCheckRow,
  type ObservationCorroborationPort,
  type ObservationEvaluationPort,
  type ObservationEvaluationRow,
  type ObservationRegistrationContext,
  type RegisteredObservation,
  type StoredObservation,
} from './execution-ports.js';
import {
  ObservationRegistrationError,
  registerObservations,
  type ObservationBatch,
  type ObservationBatchItem,
} from './register-observations.js';

/**
 * The one transactional registration, on its own.
 *
 * `execute-adapter-steps.test.ts` proves the adapter stage goes THROUGH it; this file
 * proves what it guarantees: one event carrying every digest, nothing written when a
 * batch is refused, nothing written twice on redelivery, and an uninspected record that
 * cannot be called Compliant.
 */

const RUN: RunRecord = {
  runId: '01920000-0000-7000-8000-000000000001',
  correlationId: '01920000-0000-7000-8000-000000000002',
  procedureId: '01920000-0000-7000-8000-000000000003',
  versionId: '01920000-0000-7000-8000-000000000004',
  versionNumber: 1,
  procedureName: 'Segregation of duties',
  period: { from: '2026-08-01', to: '2026-08-31' },
  state: 'RUNNING',
  kind: 'STANDARD',
  initiatorId: 'auditor',
  sessionId: 'session',
  initiatedAt: '2026-09-01T00:00:00.000Z',
  authorizationRole: 'auditor',
  requestToken: '01920000-0000-7000-8000-000000000005',
};

const WORK_ITEM = '01920000-0000-7000-8000-00000000a001';
const STEP_EXECUTION = '01920000-0000-7000-8000-00000000b001';
const EVIDENCE = '01920000-0000-7000-8000-00000000c001';
const TARGET = 'accessgate';
const OBSERVED_AT = '2026-09-05T10:00:00.000Z';

function found(key: string): ObservationRecord {
  return {
    schemaVersion: 1,
    observationId: observationIdFor(WORK_ITEM, key),
    workItemId: WORK_ITEM,
    populationRecordKey: key,
    targetSystem: TARGET,
    found: 'true',
    observedAt: OBSERVED_AT,
    stepExecutionId: STEP_EXECUTION,
    captureMethod: 'adapter',
    matchOrigin: 'platform',
    identity: {
      name: 'account_id',
      originalValue: key,
      normalizedValue: key,
      grounding: { evidenceId: EVIDENCE, locator: `$.accounts[0].account_id`, label: 'account_id', extractedText: key },
      corroboration: null,
    },
    attributes: [
      {
        name: 'roles',
        originalValue: ['AP_CLERK'],
        normalizedValue: ['AP_CLERK'],
        grounding: { evidenceId: EVIDENCE, locator: `$.accounts[0].roles`, label: 'roles', extractedText: '["AP_CLERK"]' },
        corroboration: null,
      },
    ],
    evidenceIds: [EVIDENCE],
  };
}

function absent(key: string): ObservationRecord {
  return { ...found(key), found: 'false', identity: null, attributes: [] };
}

const PROOF: ObservationAbsenceProof = {
  queryKeys: [{ key: 'account_id', value: 'AG-9999' }],
  emptyResultEvidenceId: EVIDENCE,
  extractionComplete: true,
};

function item(record: ObservationRecord, overrides: Partial<ObservationBatchItem> = {}): ObservationBatchItem {
  return {
    record,
    observedAtSource: record.observedAt,
    absence: record.found === 'false' ? { ...PROOF, queryKeys: [{ key: 'account_id', value: record.populationRecordKey }] } : null,
    expectedQueryKeys: [{ key: 'account_id', value: record.populationRecordKey }],
    ...overrides,
  };
}

function batch(items: readonly ObservationBatchItem[], overrides: Partial<ObservationBatch> = {}): ObservationBatch {
  return {
    run: RUN,
    workItemId: WORK_ITEM,
    stepExecutionId: STEP_EXECUTION,
    targetSystem: TARGET,
    runStartedAt: '2026-09-05T09:00:00.000Z',
    registeredAt: '2026-09-05T11:00:00.000Z',
    items,
    ...overrides,
  };
}

/** Everything one transaction wrote, and nothing that another one did. */
class FakeContext implements ObservationRegistrationContext {
  observations: RegisteredObservation[] = [];
  checks: ObservationCheckRow[] = [];
  evaluations: ObservationEvaluationRow[] = [];
  events: { payload: Record<string, unknown> }[] = [];
  timeline: number[] = [];
  evidence: EvidenceState[] = [{ evidenceId: EVIDENCE, state: 'REGISTERED' }];
  private sequence = 0;

  auditEvents = {
    append: async (draft: { payload: Record<string, unknown> }) => {
      this.sequence += 1;
      this.events.push({ payload: draft.payload });
      return { sequence: this.sequence } as never;
    },
  };

  readObservations = async (
    workItemId: string,
    keys: readonly string[],
  ): Promise<readonly StoredObservation[]> =>
    this.observations
      .filter((row) => row.record.workItemId === workItemId && keys.includes(row.record.populationRecordKey))
      .map((row) => ({
        observationId: row.record.observationId,
        populationRecordKey: row.record.populationRecordKey,
        record: row.record,
        digest: row.digest,
        coverage: row.coverage,
      }));

  readEvidenceStates = async (ids: readonly string[]): Promise<readonly EvidenceState[]> =>
    this.evidence.filter((row) => ids.includes(row.evidenceId));

  saveObservations = async (rows: readonly RegisteredObservation[]) => {
    for (const row of rows) {
      if (!this.observations.some((existing) => existing.record.populationRecordKey === row.record.populationRecordKey)) {
        this.observations.push(row);
      }
    }
  };

  saveObservationChecks = async (rows: readonly ObservationCheckRow[]) => {
    this.checks.push(...rows);
  };

  saveObservationEvaluations = async (rows: readonly ObservationEvaluationRow[]) => {
    this.evaluations.push(...rows);
  };

  notifyTimeline = async (sequence: number) => {
    this.timeline.push(sequence);
  };

  /** Nothing at all was written. What "the batch failed, nothing written" means. */
  wroteNothing(): boolean {
    return (
      this.observations.length === 0 &&
      this.checks.length === 0 &&
      this.evaluations.length === 0 &&
      this.events.length === 0 &&
      this.timeline.length === 0
    );
  }
}

const SEAMS = { corroboration: NO_CORROBORATION, evaluation: NO_EVALUATION };

async function refusal(work: () => Promise<unknown>): Promise<string> {
  try {
    await work();
  } catch (error) {
    if (error instanceof ObservationRegistrationError) return error.refusal;
    throw error;
  }
  throw new Error('the batch was not refused');
}

describe('registerObservations', () => {
  it('commits rows, checks and one event carrying every digest, in order', async () => {
    const context = new FakeContext();
    const records = [found('AG-1001'), absent('AG-9999'), { ...absent('AG-1007'), found: 'ambiguous' as const }];
    const outcome = await registerObservations(context, batch(records.map((record) => item(record))), SEAMS);

    expect(outcome.registered).toBe(3);
    expect(context.observations.map((row) => row.record.populationRecordKey)).toEqual([
      'AG-1001', 'AG-9999', 'AG-1007',
    ]);
    // Every digest is the domain's digest over the record exactly as it is stored.
    expect(outcome.digests).toEqual(context.observations.map((row) => observationDigest(row.record)));
    expect(outcome.batchDigest).toBe(observationBatchDigest(outcome.digests));

    expect(context.events).toHaveLength(1);
    const payload = context.events[0]!.payload;
    expect(payload['digests']).toEqual(outcome.digests);
    expect(payload['batchDigest']).toBe(outcome.batchDigest);
    expect(payload['registered']).toBe(3);
    expect(payload['coverage']).toEqual({ COVERED: 2, UNINSPECTED: 0, AMBIGUOUS: 1 });
    expect(payload['failedChecks']).toEqual({ 'ambiguous-match': 1 });
    // One Timeline notification, for the one event.
    expect(context.timeline).toEqual([1]);
  });

  it('derives the coverage state and stores it beside the row', async () => {
    const context = new FakeContext();
    await registerObservations(
      context,
      batch([
        item(found('AG-1001')),
        item(absent('AG-9999')),
        // The same absence with no proof at all: it looked at nothing it can show.
        item(absent('AG-8888'), { absence: null }),
      ]),
      SEAMS,
    );
    expect(context.observations.map((row) => [row.record.populationRecordKey, row.coverage])).toEqual([
      ['AG-1001', 'COVERED'],
      ['AG-9999', 'COVERED'],
      ['AG-8888', 'UNINSPECTED'],
    ]);
    const failed = context.checks.filter((row) => row.outcome === 'FAIL');
    expect(failed).toEqual([
      { observationId: observationIdFor(WORK_ITEM, 'AG-8888'), check: 'search-completeness', outcome: 'FAIL', diagnostic: 'absence-proof-missing' },
    ]);
  });

  it('makes an absence UNINSPECTED when its empty result is not registered Evidence', async () => {
    const context = new FakeContext();
    context.evidence = [{ evidenceId: EVIDENCE, state: 'RESERVED' }];
    await registerObservations(context, batch([item(absent('AG-9999'))]), SEAMS);
    expect(context.observations[0]!.coverage).toBe('UNINSPECTED');
    expect(
      context.checks.find((row) => row.check === 'search-completeness')?.diagnostic,
    ).toBe('empty-result-unregistered');
  });

  it('makes an absence UNINSPECTED when the extraction did not prove itself complete', async () => {
    const context = new FakeContext();
    const record = absent('AG-9999');
    await registerObservations(
      context,
      batch([
        item(record, {
          absence: { ...PROOF, queryKeys: [{ key: 'account_id', value: 'AG-9999' }], extractionComplete: false },
        }),
      ]),
      SEAMS,
    );
    expect(context.observations[0]!.coverage).toBe('UNINSPECTED');
    expect(
      context.checks.find((row) => row.check === 'search-completeness')?.diagnostic,
    ).toBe('extraction-incomplete');
  });

  it('makes an absence UNINSPECTED when a declared search key was never searched', async () => {
    const context = new FakeContext();
    await registerObservations(
      context,
      batch([
        item(absent('AG-9999'), {
          expectedQueryKeys: [
            { key: 'account_id', value: 'AG-9999' },
            { key: 'full_name', value: 'Dana Ok' },
          ],
        }),
      ]),
      SEAMS,
    );
    expect(context.observations[0]!.coverage).toBe('UNINSPECTED');
    expect(context.checks.find((row) => row.check === 'search-completeness')?.diagnostic).toBe('query-key-missing');
  });

  it('writes nothing at all when a batch is refused', async () => {
    const cases: readonly [string, ObservationBatch][] = [
      // The whole B.1 wire schema, whatever produced it.
      ['wire-schema', batch([item({ ...found('AG-1001'), schemaVersion: 2 as never })])],
      // found = true with no grounded identity is refused by the schema itself.
      ['wire-schema', batch([item({ ...found('AG-1001'), identity: null })])],
      ['batch-mismatch', batch([item({ ...found('AG-1001'), targetSystem: 'somewhere-else' })])],
      ['duplicate-record-key', batch([item(found('AG-1001')), item(found('AG-1001'))])],
      [
        'observation-identity',
        batch([item({ ...found('AG-1001'), observationId: observationIdFor(WORK_ITEM, 'AG-1002') })]),
      ],
      ['capture-time', batch([item(found('AG-1001'), { observedAtSource: '2026-09-05T11:00:00.000Z' })])],
      ['absence-proof-shape', batch([item(found('AG-1001'), { absence: PROOF })])],
    ];
    for (const [expected, offered] of cases) {
      const context = new FakeContext();
      expect(await refusal(() => registerObservations(context, offered, SEAMS))).toBe(expected);
      expect(context.wroteNothing()).toBe(true);
    }
  });

  it('registers nothing and appends no event when the same batch is delivered twice', async () => {
    const context = new FakeContext();
    const offered = batch([item(found('AG-1001')), item(absent('AG-9999'))]);
    const first = await registerObservations(context, offered, SEAMS);
    const checks = context.checks.length;

    const second = await registerObservations(context, offered, SEAMS);
    expect(second).toMatchObject({ registered: 0, alreadyRegistered: 2, checks: 0, evaluations: 0, batchDigest: null });
    expect(second.digests).toEqual([]);
    expect(context.observations).toHaveLength(first.registered);
    expect(context.checks).toHaveLength(checks);
    expect(context.evaluations).toHaveLength(0);
    // One event, one notification, for two deliveries.
    expect(context.events).toHaveLength(1);
    expect(context.timeline).toEqual([1]);
  });

  it('registers only what is missing when a partial batch is redelivered', async () => {
    const context = new FakeContext();
    await registerObservations(context, batch([item(found('AG-1001'))]), SEAMS);
    const outcome = await registerObservations(
      context,
      batch([item(found('AG-1001')), item(absent('AG-9999'))]),
      SEAMS,
    );
    expect(outcome).toMatchObject({ registered: 1, alreadyRegistered: 1 });
    expect(outcome.digests).toEqual([observationDigest(absent('AG-9999'))]);
    expect(context.events).toHaveLength(2);
  });

  it('raises the integrity failure when a stored ROW no longer agrees with its digest', async () => {
    const context = new FakeContext();
    await registerObservations(context, batch([item(found('AG-1001'))]), SEAMS);
    // Somebody edited the row after it was registered. Its digest COLUMN is untouched, so
    // comparing a fresh batch against that column alone would find them in agreement and
    // see nothing; recomputing the digest from the row as it is now is the detection.
    const stored = context.observations[0]!;
    context.observations[0] = { ...stored, record: { ...stored.record, targetSystem: 'tampered' } };
    expect(await refusal(() => registerObservations(context, batch([item(found('AG-1001'))]), SEAMS))).toBe(
      'observation-integrity',
    );
    expect(context.events).toHaveLength(1);
  });

  it('raises the integrity failure when a stored row is no longer in the wire schema', async () => {
    const context = new FakeContext();
    await registerObservations(context, batch([item(found('AG-1001'))]), SEAMS);
    const stored = context.observations[0]!;
    context.observations[0] = { ...stored, record: { ...stored.record, found: 'maybe' } as never };
    expect(await refusal(() => registerObservations(context, batch([item(found('AG-1001'))]), SEAMS))).toBe(
      'observation-integrity',
    );
  });

  it('raises the conflict when the batch describes a different Observation for one record', async () => {
    const context = new FakeContext();
    await registerObservations(context, batch([item(found('AG-1001'))]), SEAMS);
    // A second capture of the same record under the same Work Item. The unique index
    // forbids storing it, so saying so is better than dropping it silently.
    const step = '01920000-0000-7000-8000-00000000b002';
    const recaptured = { ...found('AG-1001'), stepExecutionId: step };
    expect(
      await refusal(() =>
        registerObservations(context, batch([item(recaptured)], { stepExecutionId: step }), SEAMS),
      ),
    ).toBe('digest-mismatch');
    expect(context.observations).toHaveLength(1);
    expect(context.events).toHaveLength(1);
  });

  it('applies corroboration before the digest, and records its check', async () => {
    const context = new FakeContext();
    const corroboration: ObservationCorroborationPort = {
      corroborate: async (subjects) =>
        subjects.map((subject) => ({
          observationId: subject.observationId,
          outcome: 'FAIL' as const,
          diagnostic: 'corroboration-contradictory',
          attributes: [{ name: 'roles', corroboration: 'contradictory' as const }],
        })),
    };
    await registerObservations(context, batch([item(found('AG-1001'))]), { ...SEAMS, corroboration });

    const stored = context.observations[0]!;
    expect(stored.record.attributes[0]!.corroboration).toBe('contradictory');
    // The digest covers the record AS STORED: corroboration is set at registration, so a
    // digest taken before it would describe a record nobody kept.
    expect(stored.digest).toBe(observationDigest(stored.record));
    expect(stored.digest).not.toBe(observationDigest(found('AG-1001')));
    expect(context.checks).toContainEqual({
      observationId: stored.record.observationId,
      check: 'observation-corroboration',
      outcome: 'FAIL',
      diagnostic: 'corroboration-contradictory',
    });
  });

  it('never lets a passing corroboration carry a diagnostic', async () => {
    const context = new FakeContext();
    const corroboration: ObservationCorroborationPort = {
      corroborate: async (subjects) =>
        subjects.map((subject) => ({
          observationId: subject.observationId,
          outcome: 'PASS' as const,
          diagnostic: 'corroboration-contradictory',
          attributes: [],
        })),
    };
    await registerObservations(context, batch([item(found('AG-1001'))]), { ...SEAMS, corroboration });
    expect(context.checks.find((row) => row.check === 'observation-corroboration')).toEqual({
      observationId: observationIdFor(WORK_ITEM, 'AG-1001'),
      check: 'observation-corroboration',
      outcome: 'PASS',
      diagnostic: null,
    });
  });

  it('refuses a corroboration verdict about an Observation the batch does not carry', async () => {
    const context = new FakeContext();
    const corroboration: ObservationCorroborationPort = {
      corroborate: async () => [
        { observationId: observationIdFor(WORK_ITEM, 'AG-0000'), outcome: 'PASS', diagnostic: null, attributes: [] },
      ],
    };
    expect(
      await refusal(() => registerObservations(context, batch([item(found('AG-1001'))]), { ...SEAMS, corroboration })),
    ).toBe('corroboration-shape');
    expect(context.wroteNothing()).toBe(true);
  });

  it('commits evaluations with the rows they describe', async () => {
    const context = new FakeContext();
    const evaluation: ObservationEvaluationPort = {
      evaluate: async (subjects) =>
        subjects.map((subject) => ({
          observationId: subject.record.observationId,
          evaluations: [
            {
              conditionId: 'C1',
              origin: 'RULE' as const,
              value: subject.coverage === 'COVERED' ? ('EXCEPTION' as const) : ('UNEVALUATED' as const),
              confirmation: null,
              confidence: null,
              rationale: null,
              diagnostic: subject.coverage === 'COVERED' ? null : 'record was never inspected',
              evidenceIds: [EVIDENCE],
            },
          ],
        })),
    };
    const outcome = await registerObservations(
      context,
      batch([item(found('AG-1001')), item(absent('AG-8888'), { absence: null })]),
      { ...SEAMS, evaluation },
    );
    expect(outcome.evaluations).toBe(2);
    expect(context.evaluations.map((row) => [row.coverage, row.evaluation.value])).toEqual([
      ['COVERED', 'EXCEPTION'],
      ['UNINSPECTED', 'UNEVALUATED'],
    ]);
    expect(context.events[0]!.payload['evaluations']).toBe(2);
  });

  it('refuses to call an uninspected or ambiguous record Compliant', async () => {
    // H, and the composite foreign key that says the same thing in the database.
    for (const offered of [
      batch([item(absent('AG-8888'), { absence: null })]),
      batch([item({ ...absent('AG-1007'), found: 'ambiguous' as const })]),
    ]) {
      const context = new FakeContext();
      const evaluation: ObservationEvaluationPort = {
        evaluate: async (subjects) =>
          subjects.map((subject) => ({
            observationId: subject.record.observationId,
            evaluations: [
              {
                conditionId: 'C1', origin: 'RULE' as const, value: 'COMPLIANT' as const,
                confirmation: null, confidence: null, rationale: null, diagnostic: null, evidenceIds: [],
              },
            ],
          })),
      };
      expect(await refusal(() => registerObservations(context, offered, { ...SEAMS, evaluation }))).toBe(
        'coverage-conflict',
      );
      expect(context.wroteNothing()).toBe(true);
    }
  });

  it('refuses an evaluation outside the shape, about an unknown row, or repeated', async () => {
    const bad: readonly ObservationEvaluationPort[] = [
      { evaluate: async () => [{ observationId: 'nobody', evaluations: [] }] },
      {
        evaluate: async (subjects) => [
          {
            observationId: subjects[0]!.record.observationId,
            evaluations: [{ conditionId: 'C1', origin: 'RULE', value: 'MAYBE' } as never],
          },
        ],
      },
      {
        evaluate: async (subjects) => [
          {
            observationId: subjects[0]!.record.observationId,
            evaluations: [
              { conditionId: 'C1', origin: 'RULE', value: 'EXCEPTION', confirmation: null, confidence: null, rationale: null, diagnostic: null, evidenceIds: [] },
              { conditionId: 'C1', origin: 'HUMAN', value: 'COMPLIANT', confirmation: null, confidence: null, rationale: null, diagnostic: null, evidenceIds: [] },
            ],
          },
        ],
      },
    ];
    for (const evaluation of bad) {
      const context = new FakeContext();
      expect(
        await refusal(() => registerObservations(context, batch([item(found('AG-1001'))]), { ...SEAMS, evaluation })),
      ).toBe('evaluation-shape');
      expect(context.wroteNothing()).toBe(true);
    }
  });

  it('normalizes an offset-bearing capture time to UTC and keeps the original', async () => {
    const context = new FakeContext();
    const record = { ...found('AG-1001'), observedAt: '2026-09-05T10:00:00.000Z' };
    await registerObservations(
      context,
      batch([item(record, { observedAtSource: '2026-09-05T12:00:00+02:00' })]),
      SEAMS,
    );
    const stored = context.observations[0]!;
    expect(stored.record.observedAt).toBe('2026-09-05T10:00:00.000Z');
    expect(stored.observedAtSource).toBe('2026-09-05T12:00:00+02:00');
    // The instant is provably the same one; nothing was silently shifted.
    expect(Date.parse(stored.observedAtSource)).toBe(Date.parse(stored.record.observedAt));
  });

  it('registers an empty batch as nothing at all', async () => {
    const context = new FakeContext();
    const outcome = await registerObservations(context, batch([]), SEAMS);
    expect(outcome).toMatchObject({ registered: 0, alreadyRegistered: 0, batchDigest: null });
    expect(context.wroteNothing()).toBe(true);
  });

  it('keeps a batch too large for one statement atomic, and in order', async () => {
    const context = new FakeContext();
    const items = Array.from({ length: 1200 }, (_, index) =>
      item(found(`AG-${String(index).padStart(6, '0')}`)),
    );
    const outcome = await registerObservations(context, batch(items), SEAMS);
    expect(outcome.registered).toBe(1200);
    expect(context.observations.map((row) => row.record.populationRecordKey)).toEqual(
      items.map((entry) => entry.record.populationRecordKey),
    );
    expect(outcome.digests).toHaveLength(1200);
    // One event for the whole batch, however many statements carried it.
    expect(context.events).toHaveLength(1);
    expect((context.events[0]!.payload['digests'] as string[])[1199]).toBe(outcome.digests[1199]);
  });
});
