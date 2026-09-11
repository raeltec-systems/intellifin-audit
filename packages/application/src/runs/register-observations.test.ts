import { describe, expect, it } from 'vitest';
import {
  observationBatchDigest,
  observationDigest,
  exceptionIdFor,
  exceptionFingerprint,
  observationIdFor,
  utf8Bytes,
  type ObservationAbsenceProof,
  type ObservationRecord,
  type RaisedException,
  type RunRecord,
} from '@intellifin/domain';
import {
  NO_CORROBORATION,
  NO_EVALUATION,
  type EvidenceState,
  type ObservationCheckRow,
  type ObservationCorroborationPort,
  type ObservationEvaluationPort,
  type ObservationEvaluationResult,
  type ExceptionFingerprinter,
  type ObservationEvaluationRow,
  type ObservationRegistrationContext,
  type RegisteredObservation,
  type StoredObservation,
} from './execution-ports.js';
import type {
  AgentJudgedEvaluationRow,
  AgentJudgedProposal,
  AgentProposalEvaluationPort,
} from './agent-evaluation.js';
import {
  ObservationRegistrationError,
  registerObservations,
  observationAbsenceDigest,
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
  predecessorRunId: null,
  rerunReason: null,
  cancellation: null, pauseRequest: null,
  requestToken: '01920000-0000-7000-8000-000000000005',
};

const WORK_ITEM = '01920000-0000-7000-8000-00000000a001';
const STEP_EXECUTION = '01920000-0000-7000-8000-00000000b001';
const EVIDENCE = '01920000-0000-7000-8000-00000000c001';
const OTHER_EVIDENCE = '01920000-0000-7000-8000-00000000c002';
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

/**
 * The Template every batch below names, unless it says otherwise.
 *
 * P-3, whose §C coverage rule is "found or proven absent". That is the rule under which
 * the three legs of an honest absence decide anything at all: under P-2's `must-appear`
 * every `found = false` is `UNINSPECTED` whatever it proves, so a test of the legs written
 * against P-2 would pass against an implementation that had none of them. The one test
 * that exercises `must-appear` names P-2 explicitly.
 */
const TEMPLATE_ID = 'P-3';

function batch(items: readonly ObservationBatchItem[], overrides: Partial<ObservationBatch> = {}): ObservationBatch {
  return {
    run: RUN,
    workItemId: WORK_ITEM,
    stepExecutionId: STEP_EXECUTION,
    targetSystem: TARGET,
    templateId: TEMPLATE_ID,
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
  exceptions: RaisedException[] = [];
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
        ...(row.absence === undefined ? {} : { absence: row.absence }),
        observationId: row.record.observationId,
        populationRecordKey: row.record.populationRecordKey,
        record: row.record,
        digest: row.digest,
        coverage: row.coverage,
        // §B's retained capture time, read back with the row: an edit to it does not touch
        // the digest column, and it is outside the hashed envelope, so nothing else here
        // could ever see one.
        observedAtSource: row.observedAtSource,
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

  saveExceptions = async (rows: readonly RaisedException[]) => {
    for (const row of rows) {
      // `DO NOTHING` on the Observation, exactly as the unique index does: the first
      // Exception recorded for a record stands and a redelivery adds nothing.
      if (!this.exceptions.some((existing) => existing.observationId === row.observationId)) {
        this.exceptions.push(row);
      }
    }
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
      this.exceptions.length === 0 &&
      this.events.length === 0 &&
      this.timeline.length === 0
    );
  }
}

/** A fingerprinter with a known key, so a test can recompute what it should have written. */
const FINGERPRINT_KEY = 'story-3-7-exception-fingerprint-key-x';
const FINGERPRINTER: ExceptionFingerprinter = {
  keyId: 'k-test',
  fingerprint: (envelope) => exceptionFingerprint(utf8Bytes(FINGERPRINT_KEY), envelope),
};

const SEAMS = { corroboration: NO_CORROBORATION, evaluation: NO_EVALUATION, exceptions: FINGERPRINTER };

const AGENT_CONDITION_IDS = ['C1', 'C2'] as const;

function agentBatch(
  proposals: readonly AgentJudgedProposal[] = [],
  overrides: Partial<ObservationBatch> = {},
): ObservationBatch {
  return batch([item(found('AG-1001'))], {
    templateId: 'P-1',
    expectedConditionIds: AGENT_CONDITION_IDS,
    expectedAgentConditionIds: ['C2'],
    agentProposals: proposals,
    ...overrides,
  });
}

const MATCHED_CORROBORATION: ObservationCorroborationPort = {
  corroborate: async (subjects) =>
    subjects.map((subject) => ({
      observationId: subject.observationId,
      outcome: 'PASS' as const,
      diagnostic: null,
      identity: 'matched' as const,
      attributes: [{ name: 'roles', corroboration: 'matched' as const }],
    })),
};

function agentEvaluationPort(
  answer: (observationId: string, proposals: readonly AgentJudgedProposal[]) => ObservationEvaluationResult,
): AgentProposalEvaluationPort {
  return {
    evaluateWithAgentProposals: async (subjects, proposals) =>
      subjects.map((subject) => answer(subject.record.observationId, proposals)),
  };
}

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

  it('leaves an absence UNINSPECTED under a must-appear Template, however honest', async () => {
    // §H computes per-record coverage "per the Template's coverage rule (§C)". P-2's rule
    // is satisfied only when every population account "appears in the extraction with a
    // grounded role list", so an account whose permissions nothing could read is a gap —
    // and `UNINSPECTED` is what the composite foreign key already refuses to call
    // Compliant. The absence below is fully honest, and `search-completeness` still PASSES:
    // the adapter did look, and whether it looked is a different question from whether
    // this Template accepts an absence as coverage.
    const context = new FakeContext();
    await registerObservations(context, batch([item(absent('AG-9999'))], { templateId: 'P-2' }), SEAMS);
    expect(context.observations[0]!.coverage).toBe('UNINSPECTED');
    expect(context.checks.find((row) => row.check === 'search-completeness')?.outcome).toBe('PASS');
    expect(context.events[0]!.payload['coverage']).toEqual({ COVERED: 0, UNINSPECTED: 1, AMBIGUOUS: 0 });
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

  it('refuses the entire batch when identity and values use different Evidence snapshots', async () => {
    // This includes a valid first item so the assertion catches any implementation that
    // starts registration before validating every Observation. The declared value is
    // intentionally named `identity`: the dedicated record.identity slot is the match
    // attribute selected from the frozen plan, regardless of declared attribute names.
    const split = found('AG-1002');
    const splitRecord: ObservationRecord = {
      ...split,
      attributes: [
        {
          ...split.attributes[0]!,
          name: 'identity',
          grounding: { ...split.attributes[0]!.grounding!, evidenceId: OTHER_EVIDENCE },
        },
      ],
      evidenceIds: [EVIDENCE, OTHER_EVIDENCE],
    };
    const context = new FakeContext();
    expect(
      await refusal(() =>
        registerObservations(context, batch([item(found('AG-1001')), item(splitRecord)]), SEAMS),
      ),
    ).toBe('identity-grounding-split');
    expect(context.wroteNothing()).toBe(true);
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

  it('raises the integrity failure when the retained capture time was rewritten', async () => {
    const context = new FakeContext();
    await registerObservations(context, batch([item(found('AG-1001'), { observedAtSource: '2026-09-05T12:00:00+02:00' })]), SEAMS);
    // §B's retained provenance sits OUTSIDE the thirteen hashed wire keys — the envelope is
    // pinned by a Python-produced golden vector and moving it is a contract change, not a
    // repair. So an edit to this column leaves the digest matching, and without reading it
    // back a redelivered batch reports the row as already registered and sees nothing. What
    // makes it tamper-evident is re-deriving it: the source must still normalize to the
    // `observedAt` the digest DOES cover.
    const stored = context.observations[0]!;
    context.observations[0] = { ...stored, observedAtSource: '2026-09-05T12:00:00+05:00' };
    expect(await refusal(() => registerObservations(context, batch([item(found('AG-1001'))]), SEAMS))).toBe(
      'observation-integrity',
    );
    expect(context.events).toHaveLength(1);
  });

  it('raises the integrity failure when the retained capture time is no longer an instant', async () => {
    const context = new FakeContext();
    await registerObservations(context, batch([item(found('AG-1001'))]), SEAMS);
    const stored = context.observations[0]!;
    // Not an instant at all, and an impossible calendar date, which `Date.parse` would
    // ROLL OVER into a real one rather than refuse.
    for (const source of ['', 'yesterday', '2026-02-30T00:00:00Z']) {
      context.observations[0] = { ...stored, observedAtSource: source };
      expect(await refusal(() => registerObservations(context, batch([item(found('AG-1001'))]), SEAMS))).toBe(
        'observation-integrity',
      );
    }
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
          identity: 'matched' as const,
          attributes: [{ name: 'roles', corroboration: 'contradictory' as const }],
        })),
    };
    await registerObservations(context, batch([item(found('AG-1001'))]), { ...SEAMS, corroboration });

    const stored = context.observations[0]!;
    expect(stored.record.attributes[0]!.corroboration).toBe('contradictory');
    expect(stored.record.identity!.corroboration).toBe('matched');
    // The rollup stored beside the row, derived from the record the digest is taken over.
    expect(stored.corroboration).toBe('CONTRADICTORY');
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
          identity: null,
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

  it('never gives a same-named attribute the identity verdict', async () => {
    // B.1 lets a declared attribute share the identity's name. One verdict list keyed by
    // name alone would hand one of them the other's answer, and the two are grounded at
    // different locators, so the answers legitimately differ.
    const context = new FakeContext();
    const shared: ObservationRecord = {
      ...found('AG-1001'),
      attributes: [{ ...found('AG-1001').identity!, name: 'account_id' }],
    };
    const corroboration: ObservationCorroborationPort = {
      corroborate: async (subjects) =>
        subjects.map((subject) => ({
          observationId: subject.observationId,
          outcome: 'FAIL' as const,
          diagnostic: 'corroboration-contradictory',
          identity: 'matched' as const,
          attributes: [{ name: 'account_id', corroboration: 'contradictory' as const }],
        })),
    };
    await registerObservations(context, batch([item(shared)]), { ...SEAMS, corroboration });
    const stored = context.observations[0]!;
    expect(stored.record.identity!.corroboration).toBe('matched');
    expect(stored.record.attributes[0]!.corroboration).toBe('contradictory');
    expect(stored.corroboration).toBe('CONTRADICTORY');
  });

  it('refuses a COMPLIANT evaluation of a record its own snapshot contradicts', async () => {
    const context = new FakeContext();
    const corroboration: ObservationCorroborationPort = {
      corroborate: async (subjects) =>
        subjects.map((subject) => ({
          observationId: subject.observationId,
          outcome: 'FAIL' as const,
          diagnostic: 'corroboration-contradictory',
          identity: 'contradictory' as const,
          attributes: [],
        })),
    };
    const evaluation: ObservationEvaluationPort = {
      evaluate: async (subjects) =>
        subjects.map((subject) => ({
          observationId: subject.record.observationId,
          evaluations: [
            {
              conditionId: 'C1',
              origin: 'RULE' as const,
              value: 'COMPLIANT' as const,
              confirmation: null,
              confidence: null,
              rationale: null,
              diagnostic: null,
              evidenceIds: [],
            },
          ],
        })),
    };
    // The coverage is COVERED — this refusal is the corroboration one and not the other.
    expect(
      await refusal(() =>
        registerObservations(context, batch([item(found('AG-1001'))]), { ...SEAMS, corroboration, evaluation }),
      ),
    ).toBe('corroboration-conflict');
    expect(context.wroteNothing()).toBe(true);
  });

  it('refuses a corroboration verdict about an Observation the batch does not carry', async () => {
    const context = new FakeContext();
    const corroboration: ObservationCorroborationPort = {
      corroborate: async () => [
        { observationId: observationIdFor(WORK_ITEM, 'AG-0000'), outcome: 'PASS', diagnostic: null, identity: null, attributes: [] },
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

  it('registers an applicable Agent-Judged C2 evaluation and retains its original proposal', async () => {
    const proposal: AgentJudgedProposal = {
      observationId: observationIdFor(WORK_ITEM, 'AG-1001'),
      conditionId: 'C2',
      value: 'EXCEPTION',
      confidence: '0.80',
      rationale: 'The captured roles are privileged.',
    };
    const agentEvaluation = agentEvaluationPort((observationId, proposals) => {
      const current = proposals[0]!;
      return {
        observationId,
        evaluations: [
          {
            conditionId: 'C1', origin: 'RULE' as const, value: 'COMPLIANT' as const,
            confirmation: null, confidence: null, rationale: null, diagnostic: null, evidenceIds: [EVIDENCE],
          },
          {
            conditionId: 'C2', origin: 'AGENT_JUDGED' as const, value: current.value,
            confirmation: 'pending' as const, confidence: current.confidence,
            rationale: current.rationale, diagnostic: null, evidenceIds: [EVIDENCE],
          },
        ],
      };
    });
    const context = new FakeContext();
    const outcome = await registerObservations(
      context,
      agentBatch([proposal]),
      { ...SEAMS, corroboration: MATCHED_CORROBORATION, agentEvaluation },
    );
    expect(outcome).toMatchObject({ registered: 1, evaluations: 2, exceptions: 1 });
    expect(context.evaluations[1]).toMatchObject({
      evaluation: { conditionId: 'C2', origin: 'AGENT_JUDGED', confirmation: 'pending' },
      agentProposal: proposal,
    });
    // The proposal is copied into the registration row, so later mutation of the caller's
    // object cannot alter the retained machine record.
    const retained = (context.evaluations[1] as AgentJudgedEvaluationRow).agentProposal;
    expect(retained).not.toBe(proposal);
    expect(retained).toEqual(proposal);
  });

  it('stores a below-threshold Agent proposal as UNEVALUATED with no pending control', async () => {
    const proposal: AgentJudgedProposal = {
      observationId: observationIdFor(WORK_ITEM, 'AG-1001'),
      conditionId: 'C2',
      value: 'EXCEPTION',
      confidence: '0.79',
      rationale: 'The role signal is below the frozen confidence threshold.',
    };
    const agentEvaluation = agentEvaluationPort((observationId, proposals) => {
      const current = proposals[0]!;
      return {
        observationId,
        evaluations: [
          {
            conditionId: 'C1', origin: 'RULE' as const, value: 'COMPLIANT' as const,
            confirmation: null, confidence: null, rationale: null, diagnostic: null, evidenceIds: [EVIDENCE],
          },
          {
            conditionId: 'C2', origin: 'AGENT_JUDGED' as const, value: 'UNEVALUATED' as const,
            confirmation: null, confidence: current.confidence,
            rationale: current.rationale, diagnostic: 'Agent-Judged confidence for C2 is below the stored threshold',
            evidenceIds: [EVIDENCE],
          },
        ],
      };
    });
    const context = new FakeContext();
    const outcome = await registerObservations(
      context,
      agentBatch([proposal]),
      { ...SEAMS, corroboration: MATCHED_CORROBORATION, agentEvaluation },
    );
    expect(outcome).toMatchObject({ registered: 1, evaluations: 2, exceptions: 0 });
    expect(context.evaluations[1]).toMatchObject({
      evaluation: { value: 'UNEVALUATED', origin: 'AGENT_JUDGED', confirmation: null, confidence: '0.79' },
      agentProposal: proposal,
    });
  });

  it.each([
    { confidence: undefined },
    { confidence: '1.5' },
    { confidence: 'abc' },
  ])('refuses malformed Agent confidence before calling the evaluation seam (%j)', async (overrides) => {
    const proposal = Object.assign({
      observationId: observationIdFor(WORK_ITEM, 'AG-1001'), conditionId: 'C2', value: 'EXCEPTION',
      confidence: '0.80', rationale: 'A bounded rationale.',
    }, overrides) as unknown as AgentJudgedProposal;
    let calls = 0;
    const agentEvaluation = agentEvaluationPort((observationId) => {
      calls += 1;
      return { observationId, evaluations: [] };
    });
    const context = new FakeContext();
    expect(
      await refusal(() => registerObservations(
        context,
        agentBatch([proposal]),
        { ...SEAMS, agentEvaluation },
      )),
    ).toBe('evaluation-shape');
    expect(calls).toBe(0);
    expect(context.wroteNothing()).toBe(true);
  });

  it('refuses duplicate, unknown and extra Agent proposals before any writes', async () => {
    const valid: AgentJudgedProposal = {
      observationId: observationIdFor(WORK_ITEM, 'AG-1001'), conditionId: 'C2', value: 'COMPLIANT',
      confidence: '0.95', rationale: 'The account is not privileged.',
    };
    const cases: readonly AgentJudgedProposal[][] = [
      [valid, valid],
      [{ ...valid, observationId: observationIdFor(WORK_ITEM, 'AG-0000') }],
      [{ ...valid, conditionId: 'C3' }],
      [{ ...valid, conditionId: 'C1' }],
    ];
    for (const proposals of cases) {
      const context = new FakeContext();
      expect(await refusal(() => registerObservations(
        context,
        agentBatch(proposals),
        { ...SEAMS, agentEvaluation: agentEvaluationPort((observationId) => ({ observationId, evaluations: [] })) },
      ))).toBe('evaluation-shape');
      expect(context.wroteNothing()).toBe(true);
    }
  });

  it('refuses an applicable Agent condition with no proposal and a result missing a frozen condition', async () => {
    const context = new FakeContext();
    const missingProposal = agentEvaluationPort((observationId) => ({
      observationId,
      evaluations: [
        {
          conditionId: 'C1', origin: 'RULE' as const, value: 'COMPLIANT' as const,
          confirmation: null, confidence: null, rationale: null, diagnostic: null, evidenceIds: [EVIDENCE],
        },
        {
          conditionId: 'C2', origin: 'AGENT_JUDGED' as const, value: 'EXCEPTION' as const,
          confirmation: 'pending' as const, confidence: '0.80', rationale: 'An answer exists, but no input proposal.',
          diagnostic: null, evidenceIds: [EVIDENCE],
        },
      ],
    }));
    expect(await refusal(() => registerObservations(
      context,
      agentBatch([]),
      { ...SEAMS, corroboration: MATCHED_CORROBORATION, agentEvaluation: missingProposal },
    ))).toBe('evaluation-shape');
    expect(context.wroteNothing()).toBe(true);

    const omittedCondition = agentEvaluationPort((observationId) => ({
      observationId,
      evaluations: [{
        conditionId: 'C1', origin: 'RULE' as const, value: 'COMPLIANT' as const,
        confirmation: null, confidence: null, rationale: null, diagnostic: null, evidenceIds: [EVIDENCE],
      }],
    }));
    const second = new FakeContext();
    expect(await refusal(() => registerObservations(
      second,
      agentBatch([{ observationId: observationIdFor(WORK_ITEM, 'AG-1001'), conditionId: 'C2', value: 'EXCEPTION', confidence: '0.80', rationale: 'A bounded rationale.' }]),
      { ...SEAMS, corroboration: MATCHED_CORROBORATION, agentEvaluation: omittedCondition },
    ))).toBe('evaluation-shape');
    expect(second.wroteNothing()).toBe(true);
  });

  it('allows an inapplicable C2 row only when the frozen evaluator marks it so', async () => {
    const context = new FakeContext();
    const agentEvaluation = agentEvaluationPort((observationId) => ({
      observationId,
      evaluations: [
        {
          conditionId: 'C1', origin: 'RULE' as const, value: 'COMPLIANT' as const,
          confirmation: null, confidence: null, rationale: null, diagnostic: null, evidenceIds: [EVIDENCE],
        },
        {
          conditionId: 'C2', origin: 'AGENT_JUDGED' as const, value: 'COMPLIANT' as const,
          confirmation: null, confidence: null, rationale: null, diagnostic: 'condition does not apply to this record', evidenceIds: [EVIDENCE],
        },
      ],
    }));
    await expect(registerObservations(
      context,
      agentBatch([]),
      { ...SEAMS, corroboration: MATCHED_CORROBORATION, agentEvaluation },
    )).resolves.toMatchObject({ registered: 1, evaluations: 2, exceptions: 0 });
  });

  it('keeps an ambiguous Observation with unknown Agent-Judged applicability Unevaluated', async () => {
    const ambiguous = { ...found('AG-1001'), found: 'ambiguous' as const, identity: null, attributes: [] };
    const agentEvaluation = agentEvaluationPort((observationId) => ({
      observationId,
      evaluations: [
        {
          conditionId: 'C1', origin: 'RULE' as const, value: 'UNEVALUATED' as const,
          confirmation: null, confidence: null, rationale: null,
          diagnostic: 'missing, ambiguous, contradictory, uninspected, or unproven Evidence', evidenceIds: [EVIDENCE],
        },
        {
          conditionId: 'C2', origin: 'AGENT_JUDGED' as const, value: 'UNEVALUATED' as const,
          confirmation: null, confidence: null, rationale: null,
          diagnostic: 'missing or invalid Observation field found', evidenceIds: [EVIDENCE],
        },
      ],
    }));
    const context = new FakeContext();
    await expect(registerObservations(
      context,
      agentBatch([], { items: [item(ambiguous)] }),
      { ...SEAMS, corroboration: MATCHED_CORROBORATION, agentEvaluation },
    )).resolves.toMatchObject({ registered: 1, evaluations: 2, exceptions: 0 });
    expect(context.evaluations).toHaveLength(2);
    expect(context.evaluations[1]?.evaluation).toMatchObject({
      conditionId: 'C2', origin: 'AGENT_JUDGED', value: 'UNEVALUATED', confirmation: null,
    });
    expect('agentProposal' in (context.evaluations[1] ?? {})).toBe(false);
  });

  it('rejects a proposal or Compliant result when Agent-Judged applicability is unknown', async () => {
    const unknown = (observationId: string, value: 'COMPLIANT' | 'UNEVALUATED'): ObservationEvaluationResult => ({
      observationId,
      evaluations: [
        {
          conditionId: 'C1', origin: 'RULE' as const, value: 'UNEVALUATED' as const,
          confirmation: null, confidence: null, rationale: null,
          diagnostic: 'missing, ambiguous, contradictory, uninspected, or unproven Evidence', evidenceIds: [EVIDENCE],
        },
        {
          conditionId: 'C2', origin: 'AGENT_JUDGED' as const, value,
          confirmation: null, confidence: null, rationale: null,
          diagnostic: 'missing or invalid Observation field found', evidenceIds: [EVIDENCE],
        },
      ],
    });
    const proposal: AgentJudgedProposal = {
      observationId: observationIdFor(WORK_ITEM, 'AG-1001'), conditionId: 'C2', value: 'EXCEPTION',
      confidence: '0.80', rationale: 'The model must not decide unknown applicability.',
    };
    const proposedContext = new FakeContext();
    expect(await refusal(() => registerObservations(
      proposedContext,
      agentBatch([proposal], { items: [item({ ...found('AG-1001'), found: 'ambiguous' as const, identity: null, attributes: [] })] }),
      { ...SEAMS, corroboration: MATCHED_CORROBORATION, agentEvaluation: agentEvaluationPort((observationId) => unknown(observationId, 'UNEVALUATED')) },
    ))).toBe('evaluation-shape');
    expect(proposedContext.wroteNothing()).toBe(true);

    const compliantContext = new FakeContext();
    expect(await refusal(() => registerObservations(
      compliantContext,
      agentBatch([], { items: [item({ ...found('AG-1001'), found: 'ambiguous' as const, identity: null, attributes: [] })] }),
      { ...SEAMS, corroboration: MATCHED_CORROBORATION, agentEvaluation: agentEvaluationPort((observationId) => unknown(observationId, 'COMPLIANT')) },
    ))).toBe('evaluation-shape');
    expect(compliantContext.wroteNothing()).toBe(true);
  });

  it('accepts a policy-decided unnamed role without a proposal and refuses one with a proposal', async () => {
    // The producer never asks the model about a role the frozen policy does not name;
    // the registrar shares the predicate, so a proposal for that row is an extra answer.
    const decided = (observationId: string): ObservationEvaluationResult => ({
      observationId,
      evaluations: [
        {
          conditionId: 'C1', origin: 'RULE' as const, value: 'COMPLIANT' as const,
          confirmation: null, confidence: null, rationale: null, diagnostic: null, evidenceIds: [EVIDENCE],
        },
        {
          conditionId: 'C2', origin: 'AGENT_JUDGED' as const, value: 'UNEVALUATED' as const,
          confirmation: null, confidence: null, rationale: null,
          diagnostic: 'rule does not name value XR_TEMP', evidenceIds: [EVIDENCE],
        },
      ],
    });
    const context = new FakeContext();
    await expect(registerObservations(
      context,
      agentBatch([]),
      { ...SEAMS, corroboration: MATCHED_CORROBORATION, agentEvaluation: agentEvaluationPort((observationId) => decided(observationId)) },
    )).resolves.toMatchObject({ registered: 1, evaluations: 2, exceptions: 0 });
    expect(context.evaluations[1]?.evaluation).toMatchObject({ conditionId: 'C2', value: 'UNEVALUATED', confirmation: null, diagnostic: 'rule does not name value XR_TEMP' });
    expect('agentProposal' in (context.evaluations[1] ?? {})).toBe(false);

    const proposal: AgentJudgedProposal = {
      observationId: observationIdFor(WORK_ITEM, 'AG-1001'), conditionId: 'C2', value: 'EXCEPTION',
      confidence: '0.90', rationale: 'The model must not decide an unnamed role.',
    };
    const proposedContext = new FakeContext();
    expect(await refusal(() => registerObservations(
      proposedContext,
      agentBatch([proposal]),
      { ...SEAMS, corroboration: MATCHED_CORROBORATION, agentEvaluation: agentEvaluationPort((observationId) => decided(observationId)) },
    ))).toBe('evaluation-shape');
    expect(proposedContext.wroteNothing()).toBe(true);
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

  it('refuses an evaluation port that answers about only some of the batch', async () => {
    // A short answer leaves the unanswered Observations with no evaluation row at all,
    // which downstream is indistinguishable from a frozen plan whose Compliance Rule this
    // build cannot recompile: §H's condition-completeness row reports both as
    // `condition-evaluation-missing` and nothing says which happened. "Nothing judged
    // this" is a result with NO evaluations, never an omitted result.
    const partial: ObservationEvaluationPort = {
      evaluate: async (subjects) =>
        subjects
          .slice(0, 1)
          .map((subject) => ({ observationId: subject.record.observationId, evaluations: [] })),
    };
    const context = new FakeContext();
    expect(
      await refusal(() =>
        registerObservations(
          context,
          batch([item(found('AG-1001')), item(found('AG-1002'))]),
          { ...SEAMS, evaluation: partial },
        ),
      ),
    ).toBe('evaluation-shape');
    expect(context.wroteNothing()).toBe(true);

    // The same length, but twice about one record and never about the other.
    const lopsided: ObservationEvaluationPort = {
      evaluate: async (subjects) =>
        subjects.map(() => ({ observationId: subjects[0]!.record.observationId, evaluations: [] })),
    };
    const second = new FakeContext();
    expect(
      await refusal(() =>
        registerObservations(
          second,
          batch([item(found('AG-1001')), item(found('AG-1002'))]),
          { ...SEAMS, evaluation: lopsided },
        ),
      ),
    ).toBe('evaluation-shape');
    expect(second.wroteNothing()).toBe(true);
  });

  it('accepts "nothing judged this" as a result per Observation carrying no evaluations', async () => {
    // What `NO_EVALUATION` and a Template this build has no rules for both answer. The
    // rows, their checks and their coverage still commit; the absence of an evaluation is
    // the Run-level Gate's business, not a refusal that would take the Work Item with it.
    const context = new FakeContext();
    const outcome = await registerObservations(
      context,
      batch([item(found('AG-1001')), item(found('AG-1002'))]),
      SEAMS,
    );
    expect(outcome).toMatchObject({ registered: 2, evaluations: 0, exceptions: 0 });
    expect(context.evaluations).toEqual([]);
    expect(context.observations).toHaveLength(2);
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

  it('preserves the actual absence proof beside the wire record and rejects different proof on replay', async () => {
    const context = new FakeContext();
    const offered = item(absent('AG-9999'));
    await registerObservations(context, batch([offered]), SEAMS);
    const persisted = context.observations[0]!;
    expect(persisted.absence).toEqual({ proof: offered.absence, expectedQueryKeys: offered.expectedQueryKeys,
      digest: observationAbsenceDigest(offered.record.observationId, offered.absence, offered.expectedQueryKeys) });
    expect(persisted.digest).toBe(observationDigest(persisted.record));
    await expect(registerObservations(context, batch([offered]), SEAMS)).resolves.toMatchObject({ registered: 0, alreadyRegistered: 1 });
    const changed = { ...offered, absence: { ...offered.absence!, extractionComplete: false } };
    expect(await refusal(() => registerObservations(context, batch([changed]), SEAMS))).toBe('digest-mismatch');
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

describe('required agent captures in the shared registration contract', () => {
  it.each(['missing', 'reserved', 'other-target', 'other-step', 'other-action', 'unlinked', 'matching'] as const)('registers honest evidence checks for a %s screenshot', async mode => {
    const context = new FakeContext();
    context.evidence = [{ evidenceId: EVIDENCE, state: 'REGISTERED', kind: 'structural-snapshot', registrationId: TARGET, stepExecutionId: STEP_EXECUTION, toolActionId: 'capture-action' }];
    if (mode !== 'missing') context.evidence.push({ evidenceId: OTHER_EVIDENCE, state: mode === 'reserved' ? 'RESERVED' : 'REGISTERED', kind: 'screenshot', registrationId: mode === 'other-target' ? 'another-target' : TARGET, stepExecutionId: mode === 'other-step' ? 'another-step' : STEP_EXECUTION, toolActionId: mode === 'other-action' ? 'different-action' : 'capture-action' });
    const record = { ...found('AG-1001'), captureMethod: 'agent' as const, evidenceIds: mode === 'missing' || mode === 'unlinked' ? [EVIDENCE] : [EVIDENCE, OTHER_EVIDENCE] };
    await registerObservations(context, batch([item(record)], { evidenceRequirements: [] }), { ...SEAMS, corroboration: MATCHED_CORROBORATION });
    expect(context.observations).toHaveLength(1); expect(context.observations[0]?.corroboration).toBe('MATCHED');
    expect(context.checks).toContainEqual(expect.objectContaining({ check: 'required-evidence', outcome: mode === 'matching' ? 'PASS' : 'FAIL', diagnostic: mode === 'matching' ? null : 'required-capture-missing' }));
  });
  it('refuses omission of frozen requirements by an agent producer', async () => {
    const context = new FakeContext();
    await expect(registerObservations(context, batch([item({ ...found('AG-1001'), captureMethod: 'agent' })]), SEAMS)).rejects.toMatchObject({ refusal: 'batch-mismatch' });
    expect(context.wroteNothing()).toBe(true);
  });
});
