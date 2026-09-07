import { describe, expect, it } from 'vitest';
import {
  COMPLIANCE_OBSERVATION_FIELDS,
  initialDraftCompliance,
  observationIdFor,
  type ExecutablePlan,
  type ExplicitPeriod,
  type JsonValue,
  type ObservationAttribute,
  type ObservationCheckResult,
  type ObservationRecord,
} from '@intellifin/domain';
import type { ObservationEvaluationSubject, PopulationRecord } from './execution-ports.js';
import { ruleEvaluation } from './rule-evaluation.js';

const WORK_ITEM = '019a0000-0000-7000-8000-00000000a001';
const STEP_EXECUTION = '019a0000-0000-7000-8000-00000000b001';
const EVIDENCE = '019a0000-0000-7000-8000-00000000c001';
const PERIOD: ExplicitPeriod = { from: '2026-08-01', to: '2026-08-31' };

const PASSING: readonly ObservationCheckResult[] = [
  { check: 'identity-corroboration', outcome: 'PASS', diagnostic: null },
  { check: 'required-evidence', outcome: 'PASS', diagnostic: null },
  { check: 'observation-corroboration', outcome: 'PASS', diagnostic: null },
];

function plan(templateId: 'P-3' | 'P-4'): ExecutablePlan {
  return {
    schemaVersion: 1,
    compilerVersion: '1',
    inputs: { templateId, ...initialDraftCompliance(templateId) },
    sessionSteps: [],
    targetSystems: [],
    observations: Object.entries(COMPLIANCE_OBSERVATION_FIELDS[templateId]).map(
      ([attributeName, valueType]) => ({ attributeName, valueType }),
    ),
    credentialReferences: [],
    limits: {
      retriesPerStep: 3,
      stepTimeoutSeconds: 120,
      runStepExecutions: 10000,
      runTimeoutSeconds: 3600,
      runTokens: 1000000,
    },
  } as unknown as ExecutablePlan;
}

function attribute(name: string, value: string): ObservationAttribute {
  return {
    name,
    originalValue: value,
    normalizedValue: value,
    grounding: {
      evidenceId: EVIDENCE,
      locator: `$.rows[0].${name}`,
      label: name,
      extractedText: value,
    },
    corroboration: null,
  };
}

function p4Record(
  key: string,
  observedValue: string,
  observationTime: string,
  observedAt = '2026-01-01T00:00:00.000Z',
): ObservationRecord {
  return {
    schemaVersion: 1,
    observationId: observationIdFor(WORK_ITEM, key),
    workItemId: WORK_ITEM,
    populationRecordKey: key,
    targetSystem: 'prodconsole',
    found: 'true',
    observedAt,
    stepExecutionId: STEP_EXECUTION,
    captureMethod: 'agent',
    matchOrigin: 'platform',
    identity: attribute('parameter', key),
    attributes: [attribute('observed_value', observedValue), attribute('observation_time', observationTime)],
    evidenceIds: [EVIDENCE],
  };
}

function p3Record(key: string): ObservationRecord {
  return {
    ...p4Record(key, 'unused', '2026-08-01T00:00:00Z'),
    targetSystem: 'approvenow',
    identity: attribute('transaction_id', key),
    attributes: [
      attribute('decision', 'APPROVED'),
      attribute('decided_at', '2026-08-01T08:00:00Z'),
      attribute('approver_limit', '500000.00'),
      attribute('approval_id', 'APV-1'),
    ],
  };
}

function subject(record: ObservationRecord): ObservationEvaluationSubject {
  return { record, coverage: 'COVERED', corroboration: 'MATCHED', checks: PASSING };
}

function population(...rows: readonly Record<string, JsonValue>[]): readonly PopulationRecord[] {
  return rows.map((values, index) => ({ ordinal: index + 1, values }));
}

async function evaluateP4(
  records: readonly PopulationRecord[],
  record: ObservationRecord,
  period: ExplicitPeriod | null | undefined,
) {
  const [result] = await ruleEvaluation({ plan: plan('P-4'), records, references: [], period }).evaluate([
    subject(record),
  ]);
  return result!;
}

describe('ruleEvaluation', () => {
  it('supplies frozen P-4 baselines and the Run Period to the shared compiler', async () => {
    const key = 'max_manual_approval_amount';
    const result = await evaluateP4(
      population({
        parameter: key,
        approved_value: '50000.00',
        effective_time: '2026-01-01T00:00:00+02:00',
        disposition: 'approved',
      }),
      p4Record(key, '50000.00', '2026-08-31T22:00:00+00:00'),
      PERIOD,
    );
    expect(result.evaluations[0]).toMatchObject({
      conditionId: 'C1',
      origin: 'RULE',
      value: 'COMPLIANT',
      diagnostic: null,
    });
  });

  it('keeps duplicate parameter rows ambiguous instead of selecting a baseline', async () => {
    const key = 'session_timeout_minutes';
    const result = await evaluateP4(
      population(
        {
          parameter: key,
          approved_value: '15',
          effective_time: '2026-01-01T00:00:00Z',
          disposition: 'approved',
        },
        {
          parameter: key,
          approved_value: '20',
          effective_time: '2026-08-15T00:00:00Z',
          disposition: 'approved',
        },
      ),
      p4Record(key, '60', '2026-08-20T00:00:00Z'),
      PERIOD,
    );
    expect(result.evaluations[0]!.value).toBe('UNEVALUATED');
    expect(result.evaluations[0]!.diagnostic).toContain('Evidence');
  });

  it.each([
    ['missing Period', undefined, '2026-08-20T00:00:00Z'],
    ['before Period', PERIOD, '2026-07-31T23:59:59Z'],
    ['after Period', PERIOD, '2026-09-01T00:00:00Z'],
    ['invalid date', PERIOD, '2026-02-30T00:00:00Z'],
  ] as const)('keeps a %s Observation Unevaluated', async (_name, period, observationTime) => {
    const key = 'max_manual_approval_amount';
    const result = await evaluateP4(
      population({
        parameter: key,
        approved_value: '50000.00',
        effective_time: '2026-01-01T00:00:00Z',
        disposition: 'approved',
      }),
      // observedAt is deliberately outside the Period; P-4 freshness comes from the
      // declared page observation_time, never from capture timing.
      p4Record(key, '50000.00', observationTime, '2026-01-01T00:00:00.000Z'),
      period,
    );
    expect(result.evaluations[0]!.value).toBe('UNEVALUATED');
  });

  it('turns an invalid frozen baseline row into an Unevaluated compiler result', async () => {
    const key = 'max_manual_approval_amount';
    const result = await evaluateP4(
      population({
        parameter: key,
        approved_value: '50000.00',
        effective_time: 'not-a-timestamp',
        disposition: 'approved',
      }),
      p4Record(key, '50000.00', '2026-08-20T00:00:00Z'),
      PERIOD,
    );
    expect(result.evaluations[0]!.value).toBe('UNEVALUATED');
    expect(result.evaluations[0]!.diagnostic).toContain('missing effective baseline');
  });

  it('leaves P-3 evaluation unchanged when no P-4 Period is supplied', async () => {
    const key = 'TX-1';
    const [result] = await ruleEvaluation({
      plan: plan('P-3'),
      records: population({
        transaction_id: key,
        amount: '250000.00',
        currency: 'USD',
        processed_time: '2026-08-01T09:00:00Z',
      }),
      references: [],
    }).evaluate([subject(p3Record(key))]);
    expect(result!.evaluations[0]!.value).toBe('COMPLIANT');
  });
});
