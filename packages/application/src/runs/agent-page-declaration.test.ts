import { describe, expect, it } from 'vitest';
import type { ExecutablePlan } from '@intellifin/domain';
import {
  agentPageDeclarationChecks,
  buildAgentPageDeclaration,
  buildAgentPageDeclarationPayload,
  parseAgentPageDeclaration,
  p4PageTargetSystem,
  requiresP4PageDeclaration,
  type AgentPageDeclarationFacts,
  type AgentPageDeclarationInput,
} from './agent-page-declaration.js';

const BASE: AgentPageDeclarationInput = {
  targetSystem: 'prodconsole',
  workItemId: '01990000-0000-7000-8000-00000000a401',
  stepExecutionId: '01990000-0000-7000-8000-00000000b401',
  snapshotEvidenceId: '01990000-0000-7000-8000-00000000c401',
  snapshotIdentifier: 'PC-SNAP-2026-08-31T22:00:00Z-0007',
  snapshotIdentifierLocator: '$.nodes[0].value',
  expectedParameterCount: 4,
  expectedParameterCountLocator: '$.nodes[2].value',
  pageParameterCount: 4,
  registeredObservations: 4,
};

function facts(
  input: Partial<AgentPageDeclarationInput> = {},
  registeredObservationCount = 4,
): AgentPageDeclarationFacts {
  const declaration = buildAgentPageDeclaration({ ...BASE, ...input });
  if (declaration === null) throw new Error('test declaration is invalid');
  return {
    declaration,
    registeredObservationCount,
    binding: {
      evidenceId: declaration.snapshotEvidenceId,
      toolActionId: '01990000-0000-7000-8000-00000000c402',
      workItemId: declaration.workItemId,
      stepExecutionId: declaration.stepExecutionId,
    },
  };
}

const P4_PLAN = {
  inputs: {
    templateId: 'P-4',
    targets: [{ registrationId: 'prodconsole', contract: { kind: 'web' } }],
  },
} as unknown as ExecutablePlan;

describe('agent page declaration', () => {
  it('builds a closed metadata-only audit payload and parses it back', () => {
    const payload = buildAgentPageDeclarationPayload(BASE);
    expect(payload).toEqual({ schemaVersion: 1, ...BASE });
    expect(Object.keys(payload!)).not.toContain('values');
    expect(Object.keys(payload!)).not.toContain('credential');
    expect(parseAgentPageDeclaration(payload)).toEqual({ schemaVersion: 1, ...BASE });
    expect(parseAgentPageDeclaration({ ...payload, unexpected: 'field' })).toBeNull();
  });

  it('requires web-tree value locators and bounded counts', () => {
    expect(buildAgentPageDeclaration({ ...BASE, snapshotIdentifierLocator: '$.nodes[0].label' })).toBeNull();
    expect(buildAgentPageDeclaration({ ...BASE, expectedParameterCountLocator: '$.nodes[4096].value' })).toBeNull();
    expect(buildAgentPageDeclaration({ ...BASE, expectedParameterCount: -1 })).toBeNull();
    expect(buildAgentPageDeclaration({ ...BASE, registeredObservations: 100001 })).toBeNull();
    expect(buildAgentPageDeclaration({
      ...BASE,
      snapshotIdentifier: null,
      snapshotIdentifierLocator: null,
      expectedParameterCount: null,
      expectedParameterCountLocator: null,
    })).not.toBeNull();
  });

  it('uses the SQL-bound Observation count and the same declared-count predicate', () => {
    expect(agentPageDeclarationChecks(facts(), 'prodconsole')).toEqual([
      { name: 'declaration', passed: true },
      { name: 'declared-count', passed: true },
    ]);
    expect(agentPageDeclarationChecks(facts(), 'prodconsole')).toHaveLength(2);
    expect(agentPageDeclarationChecks(facts(), 'other')).toEqual([
      { name: 'declaration', passed: false },
      { name: 'declared-count', passed: false },
    ]);
    expect(agentPageDeclarationChecks(facts({}, 5), 'prodconsole')[1]).toEqual({ name: 'declared-count', passed: false });
    expect(agentPageDeclarationChecks(facts({ registeredObservations: 3 }), 'prodconsole')[1]).toEqual({ name: 'declared-count', passed: false });
    expect(agentPageDeclarationChecks(facts({ expectedParameterCount: 5, expectedParameterCountLocator: '$.nodes[2].value' }), 'prodconsole')[1]).toEqual({ name: 'declared-count', passed: false });
    expect(agentPageDeclarationChecks(null, 'prodconsole')).toEqual([
      { name: 'declaration', passed: false },
      { name: 'declared-count', passed: false },
    ]);
  });

  it('requires the durable binding to agree with the declaration', () => {
    const bound = facts();
    expect(agentPageDeclarationChecks({
      ...bound,
      binding: { ...bound.binding, evidenceId: '01990000-0000-7000-8000-00000000c499' },
    }, 'prodconsole')).toEqual([
      { name: 'declaration', passed: false },
      { name: 'declared-count', passed: false },
    ]);
  });

  it('requires P-4 page facts while leaving other templates unchanged', () => {
    expect(requiresP4PageDeclaration(P4_PLAN)).toBe(true);
    expect(p4PageTargetSystem(P4_PLAN)).toBe('prodconsole');
    expect(requiresP4PageDeclaration(null)).toBe(false);
    expect(p4PageTargetSystem(null)).toBeNull();
  });
});
