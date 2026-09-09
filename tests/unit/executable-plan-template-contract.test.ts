import { describe, expect, it } from 'vitest';
import {
  bindingDigest, bindingDigestEnvelope, canonicalJson, defaultTargetsFor,
  classifyPlanTargets, deriveExecutablePlan, ExecutablePlanSchema, initialDraftCompliance, initialDraftEvidence,
  initialDraftPopulation, initialDraftSections, isAgentDrivenKind,
  registrationDigest, snapshotFromRegistration, withPlatformCaptured,
  type FrozenPlanInputs, type JsonValue, type TemplateId,
} from '@intellifin/domain';

const cases = [
  { id: 'P-1', columns: ['employee_id', 'full_name', 'employment_status', 'termination_effective_date'],
    actions: ['create-workspace', 'acquire-population', 'sign-in', 'sign-in'], lookup: 'employee_id', conditions: ['RULE', 'AGENT_JUDGED'] },
  { id: 'P-2', columns: ['account_id', 'status'],
    actions: ['acquire-population', 'extract-adapter'], lookup: 'account_id', conditions: ['RULE'] },
  { id: 'P-3', columns: ['transaction_id', 'currency', 'amount', 'processed_time'],
    actions: ['acquire-population', 'extract-adapter'], lookup: 'transaction_id', conditions: ['RULE'] },
  { id: 'P-4', columns: ['parameter'],
    actions: ['create-workspace', 'acquire-population', 'sign-in'], lookup: 'parameter', conditions: ['RULE'] },
] as const;

function authored(templateId: TemplateId, columns: readonly string[]): FrozenPlanInputs {
  const targets = defaultTargetsFor(templateId).map((target, index) => {
    const fields = {
      registrationId: `018f0000-0000-7000-8000-00000000000${index + 1}`,
      displayName: target.name, kind: target.kind,
      allowedOrigins: target.kind === 'desktop' ? [] : ['https://synthetic.invalid'],
      applicationIdentity: target.kind === 'desktop' ? 'synthetic-ledger.exe' : '',
      credentialRef: `vault://synthetic/${target.name}`,
      permittedActions: ['read-attribute'] as const,
      attributeLabelPatterns: ['Identity'], secondaryKey: '',
    };
    return snapshotFromRegistration({ ...fields, digest: registrationDigest(fields) });
  });
  const source = {
    kind: 'versioned-file' as const, location: 'https://synthetic.invalid/population.csv',
    declaredSchema: [...columns], sensitiveFields: [], declaredCountMechanism: 'cover-sheet' as const,
  };
  const evidence = initialDraftEvidence(templateId);
  return {
    ...initialDraftPopulation(templateId), ...initialDraftCompliance(templateId), ...evidence,
    templateId, controlName: `${templateId} contract verification`, sections: initialDraftSections(templateId),
    period: { from: '2026-08-01', to: '2026-08-31' }, scope: 'All included synthetic records',
    sourceSnapshot: { bindingId: '018f0000-0000-7000-8000-000000000099', displayName: 'Synthetic source',
      digest: bindingDigest(source), contract: bindingDigestEnvelope(source) },
    schedule: evidence.schedule ?? { frequency: 'once', startTime: '00:00', periodDerivationRule: 'explicit-period' },
    targets,
    instructions: targets.filter((target) => isAgentDrivenKind(target.contract.kind))
      .map((target) => ({ registrationId: target.registrationId, text: `Read the registered ${target.displayName} records.` })),
    evidenceRequirements: evidence.evidenceRequirements.map(({ platformCaptured: _ignored, ...requirement }) =>
      withPlatformCaptured(requirement, targets.some((target) => isAgentDrivenKind(target.contract.kind)))),
  };
}

describe('all four executable Template contracts', () => {
  it.each(cases)('$id retains its source, ordered targets and evaluation origins', ({ id, columns, actions, lookup, conditions }) => {
    const input = authored(id, columns);
    const result = deriveExecutablePlan(input);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    const plan = result.plan;
    expect(plan.sessionSteps.map((step) => step.action)).toEqual(actions);
    expect(plan.targetSystems.map((target) => target.registrationId)).toEqual(input.targets.map((target) => target.registrationId));
    expect(plan.inputs.complianceConditions.map((condition) => condition.status)).toEqual(conditions);
    expect(plan.inputs.sourceSnapshot).toEqual(input.sourceSnapshot);
    expect(plan.inputs.inclusionRule).toEqual(input.inclusionRule);
    expect(plan.targetSystems.every((target) => target.planSteps[0]?.text.includes(lookup))).toBe(true);
    expect(plan.targetSystems.map((target) => target.planSteps[0]?.text).join('\n')).not.toContain('secondary key null');
    expect(plan.credentialReferences.map((reference) => reference.credentialRef)).toEqual(input.targets.map((target) => target.contract.credential_ref));
    const repeated = deriveExecutablePlan(structuredClone(input));
    expect(repeated.ok && canonicalJson(repeated.plan as unknown as JsonValue)).toBe(canonicalJson(plan as unknown as JsonValue));
  });
});

describe('explicit P-1 target scope', () => {
  it('derives the selected LoanCore journey without adding an unselected desktop', () => {
    const defaults = authored('P-1', cases[0].columns);
    const targets = defaults.targets.filter(target => target.contract.kind === 'web');
    const input = { ...defaults, targets, instructions: defaults.instructions.filter(instruction => targets.some(target => target.registrationId === instruction.registrationId)) };
    const result = deriveExecutablePlan(input);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(ExecutablePlanSchema.safeParse(result.plan).success).toBe(true);
    expect(result.plan.inputs.targets).toEqual(targets);
    expect(result.plan.targetSystems.map(target => target.registrationId)).toEqual(targets.map(target => target.registrationId));
    expect(result.plan.credentialReferences).toEqual(targets.map(target => ({ targetSystemId: target.registrationId, credentialRef: target.contract.credential_ref })));
    expect(classifyPlanTargets(result.plan).unsupported).toBeNull();
    expect(classifyPlanTargets(result.plan).agents.map(entry => entry.target)).toEqual(targets);
  });

  it('retains every selected target in authored order and refuses selected unsupported desktop execution', () => {
    const defaults = authored('P-1', cases[0].columns);
    const targets = [...defaults.targets].reverse();
    const result = deriveExecutablePlan({ ...defaults, targets });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.plan.inputs.targets).toEqual(targets);
    expect(result.plan.targetSystems.map(target => target.registrationId)).toEqual(targets.map(target => target.registrationId));
    expect(result.plan.credentialReferences).toEqual(targets.map(target => ({ targetSystemId: target.registrationId, credentialRef: target.contract.credential_ref })));
    expect(classifyPlanTargets(result.plan).unsupported).toBe('agent-driven-target');
  });
});
