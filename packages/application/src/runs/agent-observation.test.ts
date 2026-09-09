import { describe, expect, it } from 'vitest';

import {
  initialDraftCompliance,
  judgeAbsence,
  registrationDigest,
  registrationDigestEnvelope,
  utf8Bytes,
  type ExecutablePlan,
  type ProcedureTargetSnapshot,
  type StoredSnapshot,
  type TargetSystemKind,
} from '@intellifin/domain';
import type { PopulationRecord } from './execution-ports.js';
import { buildAbsentAgentObservation, buildFoundAgentObservation, type AgentFieldSelection } from './agent-observation.js';

const SNAPSHOT_ID = '01990000-0000-7000-8000-00000000c401';
const SCREENSHOT_ID = '01990000-0000-7000-8000-00000000c402';
const WORK_ITEM_ID = '01990000-0000-7000-8000-00000000a401';
const STEP_ID = '01990000-0000-7000-8000-00000000b401';

const TARGET_FIELDS = {
  kind: 'web' as TargetSystemKind,
  allowedOrigins: ['https://loancore.example.test'],
  applicationIdentity: '',
  credentialRef: 'cred://synthetic/loancore',
  permittedActions: ['navigate', 'search', 'open-record', 'read-attribute'] as const,
  attributeLabelPatterns: ['Employee ID', 'Full name', 'Status', 'Username', 'Roles'],
  secondaryKey: 'Full name',
};

const TARGET: ProcedureTargetSnapshot = {
  registrationId: 'loancore',
  displayName: 'LoanCore',
  digest: registrationDigest(TARGET_FIELDS),
  contract: registrationDigestEnvelope(TARGET_FIELDS),
};

const TARGET_WITHOUT_USERNAME: ProcedureTargetSnapshot = {
  registrationId: TARGET.registrationId,
  displayName: TARGET.displayName,
  digest: registrationDigest({
    ...TARGET_FIELDS,
    attributeLabelPatterns: TARGET_FIELDS.attributeLabelPatterns.filter((label) => label !== 'Username'),
  }),
  contract: registrationDigestEnvelope({
    ...TARGET_FIELDS,
    attributeLabelPatterns: TARGET_FIELDS.attributeLabelPatterns.filter((label) => label !== 'Username'),
  }),
};

const PLAN = {
  schemaVersion: 1,
  compilerVersion: '1',
  inputs: {
    templateId: 'P-1',
    ...initialDraftCompliance('P-1'),
  },
  observations: [
    { attributeName: 'found', valueType: 'boolean' },
    { attributeName: 'account_status', valueType: 'text' },
    { attributeName: 'username', valueType: 'text' },
    { attributeName: 'roles', valueType: 'roles' },
    { attributeName: 'identity', valueType: 'text' },
  ],
} as unknown as ExecutablePlan;

const POPULATION: PopulationRecord = {
  ordinal: 1,
  values: {
    employee_id: 'E-000105',
    full_name: 'Esther Kabwe',
  },
};

const NODES = [
  { group: 'record:0', role: 'datum', label: 'Employee ID', value: 'E-000105', target: null },
  { group: 'record:0', role: 'datum', label: 'Full name', value: 'Esther Kabwe', target: null },
  { group: 'record:0', role: 'datum', label: 'Status', value: 'Active', target: null },
  { group: 'record:0', role: 'datum', label: 'Username', value: 'e.kabwe', target: null },
  { group: 'record:0', role: 'datum', label: 'Roles', value: ['COLLECTIONS_AGENT'], target: null },
  // A search control may display the same key. Its role and page group keep it out of identity.
  { group: 'page', role: 'input', label: 'Employee ID', value: 'E-000105', target: 'employee_id' },
] as const;

function snapshot(nodes: readonly unknown[] = NODES): StoredSnapshot {
  return {
    evidenceId: SNAPSHOT_ID,
    substrate: 'web_tree',
    bytes: utf8Bytes(JSON.stringify({ schemaVersion: 1, nodes })),
  };
}

const SELECTIONS: readonly AgentFieldSelection[] = [
  { attributeName: 'account_status', locator: '$.nodes[2].value' },
  { attributeName: 'username', locator: '$.nodes[3].value' },
  { attributeName: 'roles', locator: '$.nodes[4].value' },
];

function input(over: Partial<Parameters<typeof buildFoundAgentObservation>[0]> = {}) {
  return {
    plan: PLAN,
    target: TARGET,
    population: POPULATION,
    workItemId: WORK_ITEM_ID,
    stepExecutionId: STEP_ID,
    snapshot: snapshot(),
    screenshotEvidenceId: SCREENSHOT_ID,
    identityLocator: '$.nodes[0].value',
    selections: SELECTIONS,
    observedAt: '2026-09-06T01:00:00+01:00',
    ...over,
  };
}

function attribute(result: NonNullable<ReturnType<typeof buildFoundAgentObservation>>, name: string) {
  return result.record.attributes.find((entry) => entry.name === name);
}

describe('buildFoundAgentObservation', () => {
  it('reads values from the frozen grouped tree and preserves provenance', () => {
    const result = buildFoundAgentObservation(input());
    expect(result).not.toBeNull();
    expect(result!.record).toMatchObject({
      populationRecordKey: 'E-000105',
      targetSystem: 'loancore',
      found: 'true',
      captureMethod: 'agent',
      matchOrigin: 'platform',
      observedAt: '2026-09-06T00:00:00.000Z',
      evidenceIds: [SNAPSHOT_ID, SCREENSHOT_ID],
    });
    expect(result!.record.identity).toMatchObject({
      name: 'employee_id',
      originalValue: 'E-000105',
      normalizedValue: 'E-000105',
      grounding: {
        evidenceId: SNAPSHOT_ID,
        locator: '$.nodes[0].value',
        label: 'Employee ID',
        extractedText: 'E-000105',
      },
    });
    expect(attribute(result!, 'account_status')).toMatchObject({
      originalValue: 'Active',
      normalizedValue: 'Active',
      grounding: { locator: '$.nodes[2].value', label: 'Status', extractedText: 'Active' },
    });
    expect(attribute(result!, 'username')).toMatchObject({
      originalValue: 'e.kabwe',
      grounding: { locator: '$.nodes[3].value', label: 'Username' },
    });
    // The list remains a JSON list; it is never flattened or supplied by a model.
    expect(attribute(result!, 'roles')).toMatchObject({
      originalValue: ['COLLECTIONS_AGENT'],
      normalizedValue: ['COLLECTIONS_AGENT'],
      grounding: { locator: '$.nodes[4].value', label: 'Roles', extractedText: '["COLLECTIONS_AGENT"]' },
    });
    expect(result!.expectedQueryKeys).toEqual([
      { key: 'employee_id', value: 'E-000105' },
      { key: 'full_name', value: 'Esther Kabwe' },
    ]);
    expect(result!.observedAtSource).toBe('2026-09-06T01:00:00+01:00');
  });

  it('does not let a filter control become the identity or a grounded value', () => {
    expect(
      buildFoundAgentObservation(input({ identityLocator: '$.nodes[5].value' })),
    ).toBeNull();
    const result = buildFoundAgentObservation(input({
      selections: [{ attributeName: 'account_status', locator: '$.nodes[5].value' }, ...SELECTIONS.slice(1)],
    }));
    expect(result).not.toBeNull();
    expect(attribute(result!, 'account_status')).toMatchObject({
      originalValue: null,
      normalizedValue: null,
      grounding: null,
    });
  });

  it('ignores a model-supplied value and reads the frozen locator', () => {
    const forgedSelection = {
      attributeName: 'account_status',
      locator: '$.nodes[2].value',
      value: 'Closed',
    } as unknown as AgentFieldSelection;
    const result = buildFoundAgentObservation(input({
      selections: [forgedSelection, ...SELECTIONS.slice(1)],
    }));
    expect(result).not.toBeNull();
    expect(attribute(result!, 'account_status')).toMatchObject({
      originalValue: 'Active',
      normalizedValue: 'Active',
      grounding: { locator: '$.nodes[2].value' },
    });
  });

  it('refuses an invalid capture time and never emits an unnormalized record', () => {
    expect(buildFoundAgentObservation(input({ observedAt: '2026-02-30T01:00:00+01:00' }))).toBeNull();
  });

  it('keeps the source label ungrounded when the frozen target does not declare it', () => {
    const result = buildFoundAgentObservation(input({ target: TARGET_WITHOUT_USERNAME }));
    expect(result).not.toBeNull();
    expect(attribute(result!, 'username')).toMatchObject({
      originalValue: null,
      normalizedValue: null,
      grounding: null,
    });
  });

  it('does not ground a field selected from a different row group', () => {
    const otherRow = {
      group: 'record:1', role: 'datum', label: 'Status', value: 'Active', target: null,
    } as const;
    const result = buildFoundAgentObservation(input({
      snapshot: snapshot([...NODES, otherRow]),
      selections: [{ attributeName: 'account_status', locator: '$.nodes[6].value' }, ...SELECTIONS.slice(1)],
    }));
    expect(result).not.toBeNull();
    expect(attribute(result!, 'account_status')).toMatchObject({ grounding: null, originalValue: null });
  });

  it('refuses a non-unique exact identity across groups instead of first-wins', () => {
    const duplicate = {
      group: 'record:1', role: 'datum', label: 'Employee ID', value: 'E-000105', target: null,
    } as const;
    expect(buildFoundAgentObservation(input({ snapshot: snapshot([...NODES, duplicate]) }))).toBeNull();
  });

  it('refuses a duplicate identity even when the second row label drifts', () => {
    const duplicate = {
      group: 'record:1', role: 'datum', label: 'ID', value: 'E-000105', target: null,
    } as const;
    expect(buildFoundAgentObservation(input({ snapshot: snapshot([...NODES, duplicate]) }))).toBeNull();
  });

  it('does not relabel an unrelated datum as the requested attribute', () => {
    const result = buildFoundAgentObservation(input({
      selections: [{ attributeName: 'account_status', locator: '$.nodes[3].value' }, ...SELECTIONS.slice(1)],
    }));
    expect(result).not.toBeNull();
    expect(attribute(result!, 'account_status')).toMatchObject({ grounding: null, originalValue: null });
  });

  it('refuses an identity value that differs from the population key', () => {
    const changed = { ...NODES, 0: { ...NODES[0], value: 'E-999999' } };
    expect(buildFoundAgentObservation(input({ snapshot: snapshot(changed) }))).toBeNull();
  });

  it('keeps every declared field explicit when the model did not select one', () => {
    const result = buildFoundAgentObservation(input({ selections: SELECTIONS.slice(0, 1) }));
    expect(result).not.toBeNull();
    expect(attribute(result!, 'username')).toEqual({
      name: 'username',
      originalValue: null,
      normalizedValue: null,
      grounding: null,
      corroboration: null,
    });
    expect(attribute(result!, 'roles')).toMatchObject({ grounding: null, originalValue: null });
  });
});

it('refuses a unique primary identity whose configured secondary key contradicts the population', () => {
  const nodes = NODES.map((node, index) => index === 1 ? { ...node, value: 'Different employee' } : node);
  expect(buildFoundAgentObservation(input({ snapshot: snapshot(nodes) }))).toBeNull();
});


describe('agent absence uses the shared completeness judge', () => {
  const keys = [{ key: 'employee_id', value: 'E-000105' }, { key: 'full_name', value: 'Esther Kabwe' }];
  const empty = (complete: boolean): StoredSnapshot => ({ evidenceId: SNAPSHOT_ID, substrate: 'web_tree', bytes: utf8Bytes(JSON.stringify({ schemaVersion: 1, nodes: [], completion: { complete, returned: 0 } })) });
  const absent = (over: Partial<Parameters<typeof buildAbsentAgentObservation>[0]> = {}) => buildAbsentAgentObservation({ ...input(), snapshot: empty(true), queryKeys: keys, searchEvidenceIds: [SNAPSHOT_ID], ...over });
  const judge = (item: NonNullable<ReturnType<typeof absent>>) => judgeAbsence({ proof: item.absence, expected: item.expectedQueryKeys, linkedEvidenceIds: item.record.evidenceIds, registeredEvidenceIds: [SNAPSHOT_ID] });
  it('does not turn an arbitrary empty page into an absence claim', () => {
    expect(absent({ snapshot: snapshot([]) })).toBeNull();
  });
  it('retains both actual lookup keys and the registered empty result', () => {
    const item = absent();
    expect(item).not.toBeNull();
    expect(item?.record).toMatchObject({ found: 'false', identity: null, attributes: [], captureMethod: 'agent' });
    expect(judge(item!)).toEqual({ honest: true, failure: null });
  });
  it('cannot pass absence without the secondary lookup', () => {
    expect(judge(absent({ queryKeys: keys.slice(0, 1) })!)).toEqual({ honest: false, failure: 'query-key-missing' });
  });
  it('retains incomplete search scope as a failing proof', () => {
    expect(judge(absent({ snapshot: empty(false) })!)).toEqual({ honest: false, failure: 'extraction-incomplete' });
  });
});
