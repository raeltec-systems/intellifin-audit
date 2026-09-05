import {
  bindingDigest, bindingDigestEnvelope, registrationDigest, snapshotFromRegistration,
  initialDraftPopulation, initialDraftSections, initialDraftCompliance, initialDraftEvidence,
  type FrozenPlanInputs,
} from '@intellifin/domain';
export function executablePlanInputs(): FrozenPlanInputs {
  const source = { kind: 'versioned-file' as const, location: 'https://synthetic.invalid/population.csv', declaredSchema: ['parameter'], sensitiveFields: [], declaredCountMechanism: 'cover-sheet' as const };
  const registration = {
    registrationId: '018f0000-0000-7000-8000-0000000000a1', displayName: 'ProdConsole', kind: 'web' as const,
    allowedOrigins: ['https://synthetic.invalid'], applicationIdentity: '', credentialRef: 'vault://synthetic/prod',
    permittedActions: ['navigate', 'read-attribute'] as const, attributeLabelPatterns: ['Parameter'], secondaryKey: '',
  };
  return {
    ...initialDraftPopulation('P-4'), ...initialDraftCompliance('P-4'), ...initialDraftEvidence('P-4'),
    templateId: 'P-4', controlName: 'Configuration baseline', sections: initialDraftSections('P-4'),
    scope: 'All production parameters', period: { from: '2026-08-01', to: '2026-08-31' },
    sourceSnapshot: { bindingId: '018f0000-0000-7000-8000-000000000099', displayName: 'Baseline', digest: bindingDigest(source), contract: bindingDigestEnvelope(source) },
    schedule: { frequency: 'once', startTime: '00:00', periodDerivationRule: 'explicit-period' },
    targets: [snapshotFromRegistration({ ...registration, digest: registrationDigest(registration) })],
    instructions: [{ registrationId: registration.registrationId, text: 'Read all baseline parameters.' }],
  };
}
