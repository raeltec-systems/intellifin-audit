import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  deriveExecutablePlan, initialDraftCompliance, initialDraftEvidence, initialDraftPopulation,
  initialDraftSections, registrationDigest, snapshotFromRegistration, utf8Bytes,
  observationChecks, bindingDigest, bindingDigestEnvelope, type ExecutablePlan, type FrozenPlanInputs,
} from '@intellifin/domain';
import { buildFoundAgentObservation } from '../../packages/application/src/runs/agent-observation';
import { executablePlanInputs } from '../fixtures/executable-plan';

const registration = {
  registrationId: '01990000-0000-7000-8000-00000000a401', displayName: 'LoanCore', kind: 'web' as const,
  allowedOrigins: ['https://synthetic.invalid/loancore'], applicationIdentity: '',
  credentialRef: 'cred://synthetic/loancore', authenticationDestination: 'https://synthetic.invalid/loancore/sign-in',
  permittedActions: ['navigate', 'search', 'open-record', 'read-attribute', 'capture-screenshot'] as const,
  attributeLabelPatterns: ['Employee ID', 'Full name', 'Status', 'Username', 'Roles'], secondaryKey: 'Full name',
};
const target = snapshotFromRegistration({ ...registration, digest: registrationDigest(registration) });
const source = { kind: 'versioned-file' as const, location: 'https://synthetic.invalid/leavers.csv',
  declaredSchema: ['employee_id', 'full_name', 'department', 'employment_status', 'termination_effective_date', 'manager'],
  sensitiveFields: [], declaredCountMechanism: 'cover-sheet' as const };
const base: FrozenPlanInputs = {
  ...executablePlanInputs(), ...initialDraftPopulation('P-1'), ...initialDraftCompliance('P-1'),
  ...initialDraftEvidence('P-1'), templateId: 'P-1', sections: initialDraftSections('P-1'),
  targets: [target], instructions: [{ registrationId: target.registrationId, text: 'Read the scoped account status, username and roles.' }],
  scope: 'One canonical synthetic employee', period: { from: '2026-08-01', to: '2026-08-31' },
  sourceSnapshot: { bindingId: '01990000-0000-7000-8000-00000000a400', displayName: 'Synthetic leavers', digest: bindingDigest(source), contract: bindingDigestEnvelope(source) },
  schedule: executablePlanInputs().schedule,
};
const account = JSON.parse(readFileSync('fixtures/northstar/datasets/loancore-accounts.json', 'utf8')).accounts
  .find((row: { employee_id: string }) => row.employee_id === 'E-000102');
const nodes = [
  ['Employee ID', account.employee_id], ['Full name', account.full_name], ['Status', account.status],
  ['Username', account.username], ['Roles', account.roles.join(', ')],
].map(([label, value]) => ({ group: 'record:0', role: 'datum', label, value, target: null }));
const snapshot = { evidenceId: '01990000-0000-7000-8000-00000000c401', substrate: 'web_tree' as const,
  bytes: utf8Bytes(JSON.stringify({ schemaVersion: 1, nodes })) };

function build(omitRoles = false) {
  const fields = base;
  const derived = deriveExecutablePlan(fields);
  if (!derived.ok) throw new Error(derived.reason);
  // The compiler's full catalog includes optional rule-variant fields. Never trim it
  // in a fixture: doing so masked their accidental promotion to mandatory captures.
  expect(derived.plan.observations.map(row => row.attributeName)).toContain('disabled_time');
  return buildFoundAgentObservation({
    plan: derived.plan as ExecutablePlan, target,
    population: { ordinal: 1, values: { employee_id: account.employee_id, full_name: account.full_name } },
    workItemId: '01990000-0000-7000-8000-00000000a402', stepExecutionId: '01990000-0000-7000-8000-00000000b401',
    snapshot, screenshotEvidenceId: '01990000-0000-7000-8000-00000000c402', identityLocator: '$.nodes[0].value',
    selections: [
      { attributeName: 'account_status', locator: '$.nodes[2].value' },
      { attributeName: 'username', locator: '$.nodes[3].value' },
      { attributeName: 'roles', locator: '$.nodes[4].value' },
    ].filter(row => !omitRoles || row.attributeName !== 'roles'), observedAt: '2026-09-08T00:01:00.000Z',
  });
}

describe('actual compiled P-1 Observation field scope', () => {
  it('retains target-declared attributes without inventing mandatory optional-variant captures', () => {
    const batch = build();
    expect(batch).not.toBeNull();
    expect(batch!.record.attributes.map(row => row.name).sort()).toEqual(['account_status', 'roles', 'username']);
    expect(batch!.record.attributes.every(row => row.grounding !== null)).toBe(true);
    expect(batch!.record.attributes.find(row => row.name === 'account_status')).toMatchObject({ originalValue: 'Disabled', normalizedValue: 'Disabled' });
  });

  it('retains a required but uncaptured target field as ungrounded', () => {
    const batch = build(true);
    expect(batch!.record.attributes.find(row => row.name === 'roles')).toMatchObject({ originalValue: null, normalizedValue: null, grounding: null });
    expect(observationChecks({ ...batch!, registeredEvidenceIds: batch!.record.evidenceIds,
      runStartedAt: '2026-09-08T00:00:00.000Z', registeredAt: '2026-09-08T00:02:00.000Z' }))
      .toContainEqual({ check: 'required-evidence', outcome: 'FAIL', diagnostic: 'attribute-ungrounded' });
  });
});
