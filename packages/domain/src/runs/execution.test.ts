import { describe, expect, it } from 'vitest';

import {
  SESSION_STEP_STATES,
  STEP_EXECUTION_STATES,
  WORK_ITEM_STATES,
  adapterLookupColumn,
  adapterTargets,
  canTransitionSessionStep,
  canTransitionStepExecution,
  canTransitionWorkItem,
  classifyPlanTargets,
  executionUnitOrder,
  isSessionStepState,
  isTerminalWorkItemState,
  isWorkItemState,
  referenceTargets,
} from './execution.js';
import type { ExecutablePlan } from '../procedures/executable-plan.js';
import { registrationDigest, registrationDigestEnvelope, type TargetSystemKind } from '../registrations/target-system.js';
import type { ProcedureTargetSnapshot } from '../procedures/target-draft.js';

function target(id: string, kind: TargetSystemKind): ProcedureTargetSnapshot {
  const fields = {
    kind,
    allowedOrigins: kind === 'desktop' ? [] : ['https://synthetic.invalid/system'],
    applicationIdentity: kind === 'desktop' ? 'com.synthetic.app' : '',
    credentialRef: `cred://synthetic/${id}`,
    permittedActions: ['read-attribute'] as const,
    attributeLabelPatterns: ['Field'],
    secondaryKey: '',
  };
  return {
    registrationId: id,
    displayName: `System ${id}`,
    digest: registrationDigest(fields),
    contract: registrationDigestEnvelope(fields),
  };
}

/** Only the fields the classification reads. It never looks at anything else. */
function plan(kinds: readonly TargetSystemKind[], overrides: Partial<ExecutablePlan> = {}): ExecutablePlan {
  const targets = kinds.map((kind, index) => target(`reg-${String(index + 1)}`, kind));
  return {
    schemaVersion: 1,
    compilerVersion: '1',
    inputs: { templateId: 'P-2', targets } as unknown as ExecutablePlan['inputs'],
    sessionSteps: [
      { id: 'session-1', action: 'acquire-population', targetSystemId: null, text: 'x' },
      ...targets.map((entry, index) => ({
        id: `session-${String(index + 2)}`,
        action: 'extract-adapter' as const,
        targetSystemId: entry.registrationId,
        text: 'x',
      })),
    ],
    targetSystems: [],
    observations: [],
    credentialReferences: [],
    limits: {} as ExecutablePlan['limits'],
    ...overrides,
  } as ExecutablePlan;
}

describe('execution state vocabularies', () => {
  it('carries the whole addendum E Work Item vocabulary from the first commit', () => {
    expect([...WORK_ITEM_STATES]).toEqual([
      'PENDING', 'IN_PROGRESS', 'AWAITING', 'OBSERVED', 'UNINSPECTED', 'AMBIGUOUS', 'FAILED',
    ]);
    expect([...SESSION_STEP_STATES]).toEqual(['PENDING', 'IN_PROGRESS', 'ACQUIRED', 'FAILED']);
    expect([...STEP_EXECUTION_STATES]).toEqual(['RUNNING', 'SUCCEEDED', 'FAILED']);
  });

  it('permits exactly the addendum E Work Item edges', () => {
    expect(canTransitionWorkItem('PENDING', 'IN_PROGRESS')).toBe(true);
    expect(canTransitionWorkItem('IN_PROGRESS', 'OBSERVED')).toBe(true);
    expect(canTransitionWorkItem('IN_PROGRESS', 'AWAITING')).toBe(true);
    expect(canTransitionWorkItem('AWAITING', 'IN_PROGRESS')).toBe(true);
    expect(canTransitionWorkItem('AWAITING', 'UNINSPECTED')).toBe(true);
    // A choose-candidate answer resolves an ambiguous item; nothing else leaves it.
    expect(canTransitionWorkItem('AMBIGUOUS', 'IN_PROGRESS')).toBe(true);
    expect(canTransitionWorkItem('AMBIGUOUS', 'OBSERVED')).toBe(false);
    expect(canTransitionWorkItem('PENDING', 'OBSERVED')).toBe(false);
    expect(canTransitionWorkItem('OBSERVED', 'IN_PROGRESS')).toBe(false);
    expect(canTransitionWorkItem('FAILED', 'IN_PROGRESS')).toBe(false);
  });

  it('permits only forward Session Step and Step Execution edges', () => {
    expect(canTransitionSessionStep('PENDING', 'IN_PROGRESS')).toBe(true);
    expect(canTransitionSessionStep('IN_PROGRESS', 'ACQUIRED')).toBe(true);
    expect(canTransitionSessionStep('IN_PROGRESS', 'PENDING')).toBe(true);
    expect(canTransitionSessionStep('ACQUIRED', 'PENDING')).toBe(false);
    expect(canTransitionSessionStep('FAILED', 'IN_PROGRESS')).toBe(false);
    expect(canTransitionStepExecution('RUNNING', 'SUCCEEDED')).toBe(true);
    expect(canTransitionStepExecution('SUCCEEDED', 'FAILED')).toBe(false);
  });

  it('treats an inherited property as an unknown state, not a function', () => {
    expect(canTransitionWorkItem('constructor', 'IN_PROGRESS')).toBe(false);
    expect(canTransitionWorkItem('toString', 'PENDING')).toBe(false);
    expect(canTransitionSessionStep('__proto__', 'ACQUIRED')).toBe(false);
    expect(canTransitionStepExecution('valueOf', 'SUCCEEDED')).toBe(false);
    expect(isWorkItemState('constructor')).toBe(false);
    expect(isSessionStepState('hasOwnProperty')).toBe(false);
  });

  it('names the states nothing can leave', () => {
    expect(isTerminalWorkItemState('OBSERVED')).toBe(true);
    expect(isTerminalWorkItemState('FAILED')).toBe(true);
    expect(isTerminalWorkItemState('UNINSPECTED')).toBe(true);
    expect(isTerminalWorkItemState('AMBIGUOUS')).toBe(false);
    expect(isTerminalWorkItemState('AWAITING')).toBe(false);
  });
});

describe('frozen-kind classification', () => {
  it('makes a versioned-file target a Reference Source and an api target a Work Item', () => {
    const value = plan(['versioned-file', 'api']);
    const classified = classifyPlanTargets(value);
    expect(classified.unsupported).toBeNull();
    expect(classified.references.map((entry) => entry.target.registrationId)).toEqual(['reg-1']);
    expect(classified.adapters.map((entry) => entry.target.registrationId)).toEqual(['reg-2']);
    // The FROZEN step ids, preserved for Step Execution provenance.
    expect(classified.references[0]?.stepId).toBe('session-2');
    expect(classified.adapters[0]?.stepId).toBe('session-3');
    expect(referenceTargets(value)).toEqual(classified.references);
    expect(adapterTargets(value)).toEqual(classified.adapters);
  });

  it('orders every Reference Source before every Work Item, in authored order', () => {
    const value = plan(['api', 'versioned-file', 'api']);
    expect(executionUnitOrder(value).map((step) => [step.unit, step.entry.target.registrationId])).toEqual([
      ['reference', 'reg-2'],
      ['work-item', 'reg-1'],
      ['work-item', 'reg-3'],
    ]);
  });

  it('refuses an agent-driven target rather than skipping it', () => {
    expect(classifyPlanTargets(plan(['web'])).unsupported).toBe('agent-driven-target');
    expect(classifyPlanTargets(plan(['desktop', 'api'])).unsupported).toBe('agent-driven-target');
    expect(referenceTargets(plan(['web']))).toEqual([]);
    expect(adapterTargets(plan(['web']))).toEqual([]);
  });

  it('refuses a plan whose first Session Step is not population acquisition', () => {
    const value = plan(['api']);
    const shifted = {
      ...value,
      sessionSteps: [
        { id: 'session-0', action: 'create-workspace' as const, targetSystemId: null, text: 'x' },
        ...value.sessionSteps,
      ],
    } as ExecutablePlan;
    expect(classifyPlanTargets(shifted).unsupported).toBe('unsupported-frozen-plan');
  });

  it('refuses a Session Step it cannot account for, and a target with no step', () => {
    const value = plan(['api']);
    const extra = {
      ...value,
      sessionSteps: [
        ...value.sessionSteps,
        { id: 'session-9', action: 'sign-in' as const, targetSystemId: 'reg-9', text: 'x' },
      ],
    } as ExecutablePlan;
    expect(classifyPlanTargets(extra).unsupported).toBe('unsupported-frozen-plan');
    const missing = { ...value, sessionSteps: [value.sessionSteps[0]!] } as ExecutablePlan;
    expect(classifyPlanTargets(missing).unsupported).toBe('unsupported-frozen-plan');
  });

  it('refuses a plan version it was not written for', () => {
    expect(classifyPlanTargets({ ...plan(['api']), schemaVersion: 2 } as unknown as ExecutablePlan).unsupported)
      .toBe('unsupported-plan-version');
    expect(classifyPlanTargets({ ...plan(['api']), compilerVersion: '2' } as unknown as ExecutablePlan).unsupported)
      .toBe('unsupported-plan-version');
  });
});

describe('the Template lookup binding', () => {
  it('reads the compiler-1 table rather than a second copy of it', () => {
    expect(adapterLookupColumn('P-1')).toBe('employee_id');
    expect(adapterLookupColumn('P-2')).toBe('account_id');
    expect(adapterLookupColumn('P-3')).toBe('transaction_id');
    expect(adapterLookupColumn('P-4')).toBe('parameter');
  });

  it('answers nothing for an unknown or inherited key', () => {
    expect(adapterLookupColumn('P-9')).toBeNull();
    expect(adapterLookupColumn('constructor')).toBeNull();
  });
});
