import { describe, expect, it } from 'vitest';
import {
  initialDraftCompliance,
  observationIdFor,
  utf8Bytes,
  type ExecutablePlan,
  type ObservationCheckResult,
  type ObservationRecord,
  type ReferenceArtifact,
} from '@intellifin/domain';
import type { ObservationEvaluationSubject, PopulationRecord } from './execution-ports.js';
import type { AgentJudgedProposal } from './agent-evaluation.js';
import { agentRuleEvaluation, applicableAgentConditionIds } from './agent-rule-evaluation.js';

const WORK_ITEM = '01930000-0000-7000-8000-00000000a001';
const STEP_EXECUTION = '01930000-0000-7000-8000-00000000b001';
const EVIDENCE = '01930000-0000-7000-8000-00000000c001';
const TEMPLATE_FIELDS = {
  P1: initialDraftCompliance('P-1'),
  P2: initialDraftCompliance('P-2'),
};

function plan(templateId: 'P-1' | 'P-2'): ExecutablePlan {
  return {
    schemaVersion: 1,
    compilerVersion: '1',
    inputs: {
      templateId,
      ...TEMPLATE_FIELDS[templateId === 'P-1' ? 'P1' : 'P2'],
    },
    observations: [],
    sessionSteps: [],
    targetSystems: [],
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

const PASSING_CHECKS: readonly ObservationCheckResult[] = [
  { check: 'identity-corroboration', outcome: 'PASS', diagnostic: null },
  { check: 'required-evidence', outcome: 'PASS', diagnostic: null },
  { check: 'observation-corroboration', outcome: 'PASS', diagnostic: null },
];

function foundP1(key: string, status = 'disabled'): ObservationRecord {
  return {
    schemaVersion: 1,
    observationId: observationIdFor(WORK_ITEM, key),
    workItemId: WORK_ITEM,
    populationRecordKey: key,
    targetSystem: 'accessgate',
    found: 'true',
    observedAt: '2026-09-05T10:00:00.000Z',
    stepExecutionId: STEP_EXECUTION,
    captureMethod: 'agent',
    matchOrigin: 'platform',
    identity: {
      name: 'employee_id',
      originalValue: key,
      normalizedValue: key,
      grounding: {
        evidenceId: EVIDENCE,
        locator: '$.accounts[0].employee_id',
        label: 'Employee ID',
        extractedText: key,
      },
      corroboration: null,
    },
    attributes: [
      {
        name: 'account_status',
        originalValue: status,
        normalizedValue: status,
        grounding: {
          evidenceId: EVIDENCE,
          locator: '$.accounts[0].account_status',
          label: 'Account status',
          extractedText: status,
        },
        corroboration: null,
      },
    ],
    evidenceIds: [EVIDENCE],
  };
}

function foundP2(key: string, roles: readonly string[]): ObservationRecord {
  return {
    schemaVersion: 1,
    observationId: observationIdFor(WORK_ITEM, key),
    workItemId: WORK_ITEM,
    populationRecordKey: key,
    targetSystem: 'accessgate',
    found: 'true',
    observedAt: '2026-09-05T10:00:00.000Z',
    stepExecutionId: STEP_EXECUTION,
    captureMethod: 'adapter',
    matchOrigin: 'platform',
    identity: {
      name: 'account_id',
      originalValue: key,
      normalizedValue: key,
      grounding: {
        evidenceId: EVIDENCE,
        locator: '$.accounts[0].account_id',
        label: 'Account ID',
        extractedText: key,
      },
      corroboration: null,
    },
    attributes: [
      {
        name: 'roles',
        originalValue: [...roles],
        normalizedValue: [...roles],
        grounding: {
          evidenceId: EVIDENCE,
          locator: '$.accounts[0].roles',
          label: 'Roles',
          extractedText: JSON.stringify(roles),
        },
        corroboration: null,
      },
    ],
    evidenceIds: [EVIDENCE],
  };
}

function subject(record: ObservationRecord, overrides: Partial<ObservationEvaluationSubject> = {}): ObservationEvaluationSubject {
  return {
    record,
    coverage: 'COVERED',
    corroboration: 'MATCHED',
    checks: PASSING_CHECKS,
    ...overrides,
  };
}

function population(...values: readonly Record<string, string>[]): readonly PopulationRecord[] {
  return values.map((entry, ordinal) => ({ ordinal: ordinal + 1, values: entry }));
}

function proposal(
  observationId: string,
  overrides: Partial<AgentJudgedProposal> = {},
): AgentJudgedProposal {
  return {
    observationId,
    conditionId: 'C2',
    value: 'EXCEPTION',
    confidence: '0.80',
    rationale: 'The captured account evidence supports the proposed exception.',
    ...overrides,
  };
}

describe('agentRuleEvaluation', () => {
  it('derives applicable Agent-Judged ids from the frozen compiler for a final found Observation', () => {
    const record = foundP1('EMP-1');
    expect(applicableAgentConditionIds({
      plan: plan('P-1'),
      records: population({ employee_id: 'EMP-1', full_name: 'Dana Ok' }),
      references: [],
    }, record)).toEqual(['C2']);
  });

  it('does not offer an inapplicable or indeterminate condition to the model', () => {
    const inputs = {
      plan: plan('P-1'),
      records: population({ employee_id: 'EMP-1', full_name: 'Dana Ok' }),
      references: [],
    };
    expect(applicableAgentConditionIds(inputs, { ...foundP1('EMP-1'), found: 'false', identity: null, attributes: [] })).toEqual([]);
    expect(applicableAgentConditionIds(inputs, { ...foundP1('EMP-1'), found: 'ambiguous' })).toEqual([]);
  });

  it('passes a C2 proposal through the frozen plan and existing deterministic evaluator', async () => {
    const record = foundP1('EMP-1');
    const evaluation = agentRuleEvaluation({
      plan: plan('P-1'),
      records: population({ employee_id: 'EMP-1', full_name: 'Dana Ok' }),
      references: [],
    });
    const result = await evaluation.evaluateWithAgentProposals(
      [subject(record)],
      [proposal(record.observationId)],
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.observationId).toBe(record.observationId);
    expect(result[0]!.evaluations.map(({ conditionId, origin, value }) => [conditionId, origin, value])).toEqual([
      ['C1', 'RULE', 'COMPLIANT'],
      ['C2', 'AGENT_JUDGED', 'EXCEPTION'],
    ]);
    expect(result[0]!.evaluations[1]).toMatchObject({
      confirmation: 'pending',
      confidence: '0.80',
      rationale: 'The captured account evidence supports the proposed exception.',
    });
  });

  it('keeps a below-threshold proposal as raw agent context while making its effective result unevaluated', async () => {
    const record = foundP1('EMP-1');
    const result = await agentRuleEvaluation({
      plan: plan('P-1'),
      records: population({ employee_id: 'EMP-1', full_name: 'Dana Ok' }),
      references: [],
    }).evaluateWithAgentProposals(
      [subject(record)],
      [proposal(record.observationId, { confidence: '0.79' })],
    );

    expect(result[0]!.evaluations[1]).toMatchObject({
      conditionId: 'C2',
      origin: 'AGENT_JUDGED',
      value: 'UNEVALUATED',
      confirmation: null,
      confidence: '0.79',
    });
    expect(result[0]!.evaluations[1]!.diagnostic).toContain('below the stored threshold');
  });

  it('uses frozen applicability and never lets a proposal decide an absent record', async () => {
    const record = { ...foundP1('EMP-1'), found: 'false' as const, identity: null, attributes: [] };
    const result = await agentRuleEvaluation({
      plan: plan('P-1'),
      records: population({ employee_id: 'EMP-1', full_name: 'Dana Ok' }),
      references: [],
    }).evaluateWithAgentProposals([subject(record)], []);

    expect(result[0]!.evaluations.find(({ conditionId }) => conditionId === 'C2')).toMatchObject({
      origin: 'AGENT_JUDGED',
      value: 'COMPLIANT',
      confirmation: null,
      confidence: null,
      rationale: null,
      diagnostic: 'condition does not apply to this record',
    });
  });

  it('passes the frozen reference artifact to Rule-Classified evaluation and refuses duplicate population keys conservatively', async () => {
    const record = foundP2('AG-1', ['AP_CLERK', 'PAYMENT_APPROVER']);
    const references: readonly ReferenceArtifact[] = [{
      mediaType: 'text/csv',
      bytes: utf8Bytes('entry,role,permission\n1,AP_CLERK,CREATE_PAYMENT\n1,AP_CLERK,VIEW_PAYMENT\n2,PAYMENT_APPROVER,RELEASE_PAYMENT\n'),
    }];
    const withReference = await agentRuleEvaluation({
      plan: plan('P-2'),
      records: population({ account_id: 'AG-1' }),
      references,
    }).evaluateWithAgentProposals([subject(record)], []);
    expect(withReference[0]!.evaluations[0]).toMatchObject({ value: 'EXCEPTION', origin: 'RULE' });

    const duplicate = await agentRuleEvaluation({
      plan: plan('P-2'),
      records: population({ account_id: 'AG-1' }, { account_id: 'AG-1' }),
      references,
    }).evaluateWithAgentProposals([subject(record)], []);
    expect(duplicate[0]!.evaluations[0]).toMatchObject({ value: 'UNEVALUATED', origin: 'RULE' });
  });

  it('answers each subject in order and ignores no frozen subject when proposals target another record', async () => {
    const first = foundP1('EMP-1');
    const second = foundP1('EMP-2', 'active');
    const evaluator = agentRuleEvaluation({
      plan: plan('P-1'),
      records: population(
        { employee_id: 'EMP-1', full_name: 'Dana Ok' },
        { employee_id: 'EMP-2', full_name: 'Lee Qi' },
      ),
      references: [],
    });
    const proposals = [proposal(second.observationId, { value: 'COMPLIANT', confidence: '0.95' })];
    const firstResult = await evaluator.evaluateWithAgentProposals(
      [subject(first), subject(second)],
      proposals,
    );
    const secondResult = await evaluator.evaluateWithAgentProposals(
      [subject(first), subject(second)],
      proposals,
    );

    expect(firstResult).toEqual(secondResult);
    expect(firstResult.map(({ observationId }) => observationId)).toEqual([
      first.observationId,
      second.observationId,
    ]);
    expect(firstResult[0]!.evaluations.find(({ conditionId }) => conditionId === 'C2')).toMatchObject({
      value: 'UNEVALUATED',
      confidence: null,
    });
    expect(firstResult[1]!.evaluations.find(({ conditionId }) => conditionId === 'C2')).toMatchObject({
      value: 'COMPLIANT',
      confidence: '0.95',
      confirmation: 'pending',
    });
  });
});
