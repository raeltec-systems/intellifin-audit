import { describe, expect, it } from 'vitest';
import {
  initialDraftCompliance,
  registrationDigest,
  registrationDigestEnvelope,
  utf8Bytes,
  type ExecutablePlan,
  type ProcedureTargetSnapshot,
  type StoredSnapshot,
} from '@intellifin/domain';
import {
  planAgentTools,
  type AgentSearchEvidence,
} from './agent-tool-planner.js';
import type { PopulationRecord } from './execution-ports.js';

const TARGET_FIELDS = {
  kind: 'web' as const,
  allowedOrigins: ['https://loancore.example.test/loancore'],
  applicationIdentity: '',
  credentialRef: 'cred://synthetic/loancore',
  permittedActions: ['navigate', 'search', 'open-record', 'read-attribute', 'capture-screenshot'] as const,
  attributeLabelPatterns: ['Employee ID', 'Full name', 'Status', 'Username', 'Roles'],
  secondaryKey: 'Full name',
};

const TARGET: ProcedureTargetSnapshot = {
  registrationId: 'loancore',
  displayName: 'LoanCore',
  digest: registrationDigest(TARGET_FIELDS),
  contract: registrationDigestEnvelope(TARGET_FIELDS),
};

const PLAN = {
  schemaVersion: 1,
  compilerVersion: '1',
  inputs: {
    templateId: 'P-1',
    ...initialDraftCompliance('P-1'),
    targets: [TARGET],
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
  values: { employee_id: 'E-000105', full_name: 'Esther Kabwe' },
};

const HOME_NODES = [
  { group: 'page', role: 'input', label: 'Employee ID', value: '', target: 'employee_id' },
  { group: 'page', role: 'input', label: 'Full name', value: '', target: 'name' },
  { group: 'page', role: 'button', label: 'Search', value: 'Search', target: null },
  { group: 'page', role: 'link', label: 'Record', value: 'Record', target: 'https://loancore.example.test/loancore/users/E-000103' },
  { group: 'page', role: 'link', label: 'Query example', value: 'Query example', target: 'https://loancore.example.test/loancore/users?employee_id=E-000103' },
  { group: 'page', role: 'link', label: 'Outside', value: 'Outside', target: 'https://other.example.test/account' },
] as const;

const RECORD_NODES = [
  { group: 'record:0', role: 'datum', label: 'Employee ID', value: 'E-000105', target: null },
  { group: 'record:0', role: 'datum', label: 'Full name', value: 'Esther Kabwe', target: null },
  { group: 'record:0', role: 'datum', label: 'Status', value: 'Active', target: null },
  { group: 'record:0', role: 'datum', label: 'Username', value: 'e.kabwe', target: null },
  { group: 'record:0', role: 'datum', label: 'Roles', value: ['COLLECTIONS_AGENT'], target: null },
] as const;

function snapshot(
  nodes: readonly unknown[],
  completion?: { readonly complete: boolean; readonly returned: number | null },
): StoredSnapshot {
  return {
    evidenceId: '01990000-0000-7000-8000-00000000c401',
    substrate: 'web_tree',
    bytes: utf8Bytes(JSON.stringify({ schemaVersion: 1, nodes, ...(completion === undefined ? {} : { completion }) })),
  };
}

function input(over: Partial<Parameters<typeof planAgentTools>[0]> = {}) {
  return {
    plan: PLAN,
    target: TARGET,
    population: POPULATION,
    snapshot: snapshot(HOME_NODES),
    sourceLocation: 'https://loancore.example.test/loancore?stale=query',
    searches: [] as readonly AgentSearchEvidence[],
    ...over,
  };
}

describe('planAgentTools', () => {
  it('derives a primary search from the live approved control and keeps its value out of the model tool', () => {
    const planned = planAgentTools(input());
    const search = planned.tools.find((tool) => tool.action === 'search');
    expect(search).toEqual({
      toolId: 'agent-search-0',
      action: 'search',
      destination: 'https://loancore.example.test/loancore',
      locator: { substrate: 'web_tree', path: '$.nodes[0].value' },
      description: 'Search with the approved population key.',
      parameterNames: ['employee_id'],
    });
    expect(planned.parametersByToolId['agent-search-0']).toEqual([
      { name: 'employee_id', value: 'E-000105' },
    ]);
    expect(JSON.stringify(planned.tools)).not.toContain('E-000105');
    expect(planned.tools.some((tool) => tool.destination.includes('?'))).toBe(false);
  });

  it('uses the recorded primary search before offering the secondary control', () => {
    const searches: readonly AgentSearchEvidence[] = [{
      parameters: [{ name: 'employee_id', value: 'E-000105' }],
      controlSnapshot: snapshot(HOME_NODES),
      snapshot: snapshot(RECORD_NODES, { complete: true, returned: 1 }),
    }];
    const planned = planAgentTools(input({ searches }));
    const search = planned.tools.find((tool) => tool.action === 'search');
    expect(search?.locator).toEqual({ substrate: 'web_tree', path: '$.nodes[1].value' });
    expect(search?.parameterNames).toEqual(['name']);
    expect(planned.parametersByToolId['agent-search-1']).toEqual([
      { name: 'name', value: 'Esther Kabwe' },
    ]);
  });

  it('grounds one candidate and exposes only frozen locators for declared fields', () => {
    const planned = planAgentTools(input({
      snapshot: snapshot(RECORD_NODES),
      sourceLocation: 'https://loancore.example.test/loancore/users/E-000105',
    }));
    expect(planned.found).toEqual({
      identityLocator: '$.nodes[0].value',
      selections: [
        { attributeName: 'account_status', locator: '$.nodes[2].value' },
        { attributeName: 'username', locator: '$.nodes[3].value' },
        { attributeName: 'roles', locator: '$.nodes[4].value' },
      ],
    });
    expect(planned.candidates).toEqual([]);
    expect(planned.tools.filter((tool) => tool.action === 'read-attribute').map((tool) => tool.locator)).toEqual([
      { substrate: 'web_tree', path: '$.nodes[2].value' },
      { substrate: 'web_tree', path: '$.nodes[3].value' },
      { substrate: 'web_tree', path: '$.nodes[4].value' },
    ]);
    expect(JSON.stringify(planned.tools)).not.toContain('Active');
  });

  it('returns a name-only candidate without claiming a population identity', () => {
    const nameOnly = [
      { group: 'record:0', role: 'datum', label: 'Full name', value: 'Esther Kabwe', target: null },
      { group: 'record:0', role: 'datum', label: 'Status', value: 'Active', target: null },
    ] as const;
    const planned = planAgentTools(input({ snapshot: snapshot(nameOnly) }));
    expect(planned.found).toBeNull();
    expect(planned.candidates).toEqual([{ id: 'candidate-0', label: 'Esther Kabwe', identityLocator: null }]);
  });

  it('fails closed on duplicate identities and never treats an empty tree as absence', () => {
    const duplicate = [
      ...RECORD_NODES,
      { group: 'record:1', role: 'datum', label: 'Employee ID', value: 'E-000105', target: null },
    ] as const;
    expect(planAgentTools(input({ snapshot: snapshot(duplicate) }))).toMatchObject({
      tools: [],
      found: null,
      candidates: [
        { id: 'candidate-0', label: 'Esther Kabwe', identityLocator: '$.nodes[0].value' },
        { id: 'candidate-5', label: 'E-000105', identityLocator: '$.nodes[5].value' },
      ],
      absenceReady: false,
    });
    const empty = planAgentTools(input({
      snapshot: snapshot([]),
      sourceLocation: 'https://loancore.example.test/loancore/users',
    }));
    expect(empty.found).toBeNull();
    expect(empty.candidates).toEqual([]);
    expect(empty.absenceReady).toBe(false);
  });

  it('marks absence ready only after both recorded searches prove complete zero results', () => {
    const zero = snapshot([], { complete: true, returned: 0 });
    const searches: readonly AgentSearchEvidence[] = [
      {
        parameters: [{ name: 'employee_id', value: 'E-000105' }],
        controlSnapshot: snapshot(HOME_NODES),
        snapshot: zero,
      },
      {
        parameters: [{ name: 'name', value: 'Esther Kabwe' }],
        controlSnapshot: snapshot(HOME_NODES),
        snapshot: zero,
      },
    ];
    const planned = planAgentTools(input({ snapshot: zero, searches }));
    expect(planned.absenceReady).toBe(true);
    expect(planned.tools.some((tool) => tool.action === 'search')).toBe(false);
    const incomplete = planAgentTools(input({ snapshot: snapshot([]), searches }));
    expect(incomplete.absenceReady).toBe(false);
  });

  it('does not ground a field from a matching control', () => {
    const control = [
      RECORD_NODES[0]!,
      RECORD_NODES[1]!,
      { group: 'record:0', role: 'input', label: 'Status', value: 'Active', target: 'status' },
    ] as const;
    const planned = planAgentTools(input({ snapshot: snapshot(control) }));
    expect(planned.found).toEqual({ identityLocator: '$.nodes[0].value', selections: [] });
    expect(planned.tools.filter((tool) => tool.action === 'read-attribute')).toHaveLength(0);
  });

  it('does not attribute a value to a lookup key when the recorded control name is wrong', () => {
    const zero = snapshot([], { complete: true, returned: 0 });
    const searches: readonly AgentSearchEvidence[] = [{
      // The employee ID value was recorded as if it came from the name field.
      // Value equality alone must never prove an employee_id search.
      parameters: [{ name: 'name', value: 'E-000105' }],
      controlSnapshot: snapshot(HOME_NODES),
      snapshot: zero,
    }];
    const planned = planAgentTools(input({ searches }));
    expect(planned.absenceReady).toBe(false);
    expect(planned.tools.find((tool) => tool.action === 'search')?.parameterNames).toEqual(['employee_id']);
  });

  it('offers only a record link grounded to the current identity', () => {
    const links = [
      ...RECORD_NODES,
      {
        group: 'page',
        role: 'link' as const,
        label: 'Other record',
        value: 'Other record',
        target: 'https://loancore.example.test/loancore/users/E-000103',
      },
      {
        group: 'page',
        role: 'link' as const,
        label: 'Current record',
        value: 'Current record',
        target: 'https://loancore.example.test/loancore/users/E-000105',
      },
    ] as const;
    const planned = planAgentTools(input({
      snapshot: snapshot(links),
      sourceLocation: 'https://loancore.example.test/loancore/users',
    }));
    expect(planned.tools.filter((tool) => tool.action === 'open-record').map((tool) => tool.destination)).toEqual([
      'https://loancore.example.test/loancore/users/E-000105',
    ]);
  });
});
