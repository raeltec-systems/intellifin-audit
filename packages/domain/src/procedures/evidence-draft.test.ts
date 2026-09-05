import { describe, expect, it } from 'vitest';

import { registrationDigest } from '../registrations/target-system.js';
import { bindingDigest, bindingDigestEnvelope } from '../sources/population-source.js';
import { snapshotFromRegistration, type RegistrationSixFields } from './target-draft.js';
import {
  EVIDENCE_DRAFT_LIMITS,
  EVIDENCE_DRAFT_MESSAGES,
  FREQUENCIES,
  PERIOD_DERIVATION_RULES,
  evidenceBlockersFor,
  hasAgentDrivenTarget,
  initialDraftEvidence,
  isDraftEvidenceFields,
  isDraftSchedule,
  isEvidenceRequirement,
  isFrequency,
  validateDraftEvidenceEdit,
  withPlatformCaptured,
  type EvidenceRequirement,
  type EvidenceRequirementInput,
} from './evidence-draft.js';

/**
 * Evidence Requirements and the Schedule (FR-9, FR-10). Covers every I/O & Edge-Case
 * Matrix row of spec-2-5: the grounding rule, the model-read exemption, platform-captured
 * being recorded rather than chosen, the frequency/derivation-rule vocabulary, and the
 * upload/frequency pairing as a completeness blocker rather than a save-time refusal.
 */

function registration(fields: Omit<RegistrationSixFields, 'digest'>): RegistrationSixFields {
  return { ...fields, digest: registrationDigest(fields) };
}

const LOANCORE = snapshotFromRegistration(
  registration({
    registrationId: '018f0000-0000-7000-8000-0000000000a1',
    displayName: 'LoanCore',
    kind: 'web',
    allowedOrigins: ['http://localhost:4300/loancore'],
    applicationIdentity: '',
    credentialRef: 'vault://audit/loancore',
    permittedActions: ['navigate', 'search', 'read-attribute'],
    attributeLabelPatterns: ['Status'],
    secondaryKey: 'Full name',
  }),
);

const ACCESSGATE = snapshotFromRegistration(
  registration({
    registrationId: '018f0000-0000-7000-8000-0000000000a2',
    displayName: 'AccessGate',
    kind: 'api',
    allowedOrigins: ['https://accessgate.synthetic.invalid'],
    applicationIdentity: '',
    credentialRef: 'vault://audit/accessgate',
    permittedActions: ['navigate'],
    attributeLabelPatterns: [],
    secondaryKey: '',
  }),
);

const sourceFields = { kind: 'manual-upload' as const, location: '', declaredSchema: ['status'], declaredCountMechanism: 'none' as const, sensitiveFields: [] };
const MANUAL_SOURCE = {
  bindingId: '018f0000-0000-7000-8000-000000000099',
  displayName: 'Manual leavers',
  digest: bindingDigest(sourceFields),
  contract: bindingDigestEnvelope(sourceFields),
};
const versionedFields = { ...sourceFields, kind: 'versioned-file' as const, location: 'https://population.synthetic.invalid/leavers.csv' };
const VERSIONED_SOURCE = {
  bindingId: '018f0000-0000-7000-8000-000000000098',
  displayName: 'Versioned leavers',
  digest: bindingDigest(versionedFields),
  contract: bindingDigestEnvelope(versionedFields),
};

function requirement(overrides: Partial<EvidenceRequirementInput> = {}): EvidenceRequirementInput {
  return {
    attributeName: 'account_status',
    modelRead: false,
    groundedBy: ['structural-snapshot'],
    screenshot: true,
    recordingSegment: false,
    ...overrides,
  };
}

describe('the frequency and period-derivation vocabulary', () => {
  it('names exactly once, daily, weekly, monthly', () => {
    expect(FREQUENCIES).toEqual(['once', 'daily', 'weekly', 'monthly']);
    for (const frequency of FREQUENCIES) expect(isFrequency(frequency)).toBe(true);
    expect(isFrequency('yearly')).toBe(false);
  });
  it('records, never executes, the period-derivation rule per frequency', () => {
    expect(PERIOD_DERIVATION_RULES).toEqual({
      once: 'explicit-period',
      daily: 'previous-calendar-day',
      weekly: 'previous-monday-sunday',
      monthly: 'previous-calendar-month',
    });
  });
});

describe('the Schedule', () => {
  it('accepts a well-formed fixed UTC start with the matching derivation rule', () => {
    expect(isDraftSchedule({ frequency: 'weekly', startTime: '02:00', periodDerivationRule: 'previous-monday-sunday' })).toBe(true);
  });
  it('refuses a malformed start time, an unknown frequency, and a mismatched derivation rule', () => {
    expect(isDraftSchedule({ frequency: 'weekly', startTime: '2:00', periodDerivationRule: 'previous-monday-sunday' })).toBe(false);
    expect(isDraftSchedule({ frequency: 'weekly', startTime: '24:00', periodDerivationRule: 'previous-monday-sunday' })).toBe(false);
    expect(isDraftSchedule({ frequency: 'yearly', startTime: '02:00', periodDerivationRule: 'previous-monday-sunday' })).toBe(false);
    expect(isDraftSchedule({ frequency: 'weekly', startTime: '02:00', periodDerivationRule: 'previous-calendar-day' })).toBe(false);
    expect(isDraftSchedule({ frequency: 'weekly', startTime: '02:00' })).toBe(false);
  });
});

describe('the grounding rule', () => {
  it('accepts an attribute grounded by a Structural Snapshot or a source file excerpt', () => {
    expect(isEvidenceRequirement({ ...requirement(), platformCaptured: false })).toBe(true);
    expect(isEvidenceRequirement({ ...requirement({ groundedBy: ['source-file-excerpt'] }), platformCaptured: false })).toBe(true);
  });
  it('refuses an attribute grounded only by a screenshot or a recording segment', () => {
    const ungrounded = { ...requirement({ groundedBy: [] }), platformCaptured: false };
    expect(isEvidenceRequirement(ungrounded)).toBe(false);
    const validation = validateDraftEvidenceEdit({ section: 'evidence-requirements', requirements: [requirement({ groundedBy: [] })] });
    // Parsing accepts the shape; mandatory capture is determined under the row lock.
    expect(validation.ok).toBe(true);
  });
  it('accepts a model-read attribute with no grounding source, recorded as model-read', () => {
    const modelRead = { ...requirement({ modelRead: true, groundedBy: [], screenshot: false }), platformCaptured: false };
    expect(isEvidenceRequirement(modelRead)).toBe(true);
    const validation = validateDraftEvidenceEdit({ section: 'evidence-requirements', requirements: [requirement({ modelRead: true, groundedBy: [] })] });
    expect(validation.ok).toBe(true);
  });
  it('refuses a duplicate attribute name, case- and whitespace-insensitively', () => {
    const validation = validateDraftEvidenceEdit({
      section: 'evidence-requirements',
      requirements: [requirement({ attributeName: 'Status' }), requirement({ attributeName: ' status ' })],
    });
    expect(validation).toEqual({ ok: false, reason: EVIDENCE_DRAFT_MESSAGES.DUPLICATE });
  });
  it('refuses an unstorable, blank, or over-long attribute name', () => {
    expect(validateDraftEvidenceEdit({ section: 'evidence-requirements', requirements: [requirement({ attributeName: '  ' })] })).toEqual({ ok: false, reason: EVIDENCE_DRAFT_MESSAGES.ATTRIBUTE });
    expect(validateDraftEvidenceEdit({ section: 'evidence-requirements', requirements: [requirement({ attributeName: 'a'.repeat(201) })] })).toEqual({ ok: false, reason: EVIDENCE_DRAFT_MESSAGES.ATTRIBUTE });
    expect(validateDraftEvidenceEdit({ section: 'evidence-requirements', requirements: [requirement({ attributeName: '\uD800' })] })).toEqual({ ok: false, reason: EVIDENCE_DRAFT_MESSAGES.ATTRIBUTE });
  });
  it('refuses more than the requirement limit', () => {
    const many = Array.from({ length: EVIDENCE_DRAFT_LIMITS.requirements + 1 }, (_, index) => requirement({ attributeName: `attr-${index}` }));
    expect(validateDraftEvidenceEdit({ section: 'evidence-requirements', requirements: many })).toEqual({ ok: false, reason: EVIDENCE_DRAFT_MESSAGES.TOO_MANY });
  });
});

describe('platform-captured is recorded, never chosen', () => {
  it('removes only platform additions, including after repeated target saves and JSON reload', () => {
    for (const groundedBy of [[], ['source-file-excerpt'], ['structural-snapshot']] as const) {
      for (const screenshot of [false, true]) {
        const authored = requirement({ modelRead: true, groundedBy, screenshot, recordingSegment: true });
        const captured = withPlatformCaptured(authored, true);
        const reloaded = JSON.parse(JSON.stringify(withPlatformCaptured(captured, true))) as EvidenceRequirement;
        expect(withPlatformCaptured(reloaded, false)).toEqual({ ...authored, platformCaptured: false });
      }
    }
  });
  it('preserves legacy capture choices whose authorship was never recorded', () => {
    const legacy = { ...requirement({ groundedBy: ['structural-snapshot'], screenshot: true }), platformCaptured: true };
    expect(withPlatformCaptured(legacy, false)).toEqual({ ...legacy, platformCaptured: false });
  });
  it('allows incomplete grounding only on editable Draft reads, not executable inputs', () => {
    const removed = withPlatformCaptured(withPlatformCaptured(requirement({ groundedBy: [], screenshot: false }), true), false);
    const fields = { evidenceSchemaVersion: 1, evidenceRequirements: [removed], schedule: null };
    expect(isDraftEvidenceFields(fields, true)).toBe(true);
    expect(isDraftEvidenceFields(fields)).toBe(false);
    expect(isEvidenceRequirement(removed)).toBe(false);
  });
  it('rejects malformed or misplaced capture provenance', () => {
    const captured = withPlatformCaptured(requirement(), true);
    expect(isEvidenceRequirement({ ...captured, authoredCapture: { structuralSnapshot: 'yes', screenshot: false } })).toBe(false);
    expect(isEvidenceRequirement({ ...captured, platformCaptured: false })).toBe(false);
  });
  it('is false with no agent-driven Target System selected', () => {
    expect(hasAgentDrivenTarget([ACCESSGATE])).toBe(false);
    expect(hasAgentDrivenTarget([])).toBe(false);
  });
  it('is true the moment any selected Target System is agent-driven (web or desktop)', () => {
    expect(hasAgentDrivenTarget([LOANCORE])).toBe(true);
    expect(hasAgentDrivenTarget([ACCESSGATE, LOANCORE])).toBe(true);
  });
  it('forces Structural Snapshot grounding and the screenshot flag on, regardless of what was asked for', () => {
    const asked = requirement({ groundedBy: [], modelRead: true, screenshot: false });
    const recorded = withPlatformCaptured(asked, true);
    expect(recorded.platformCaptured).toBe(true);
    expect(recorded.groundedBy).toEqual(['structural-snapshot']);
    expect(recorded.screenshot).toBe(true);
    expect(isEvidenceRequirement(recorded)).toBe(true);
  });
  it('leaves an attribute alone when nothing is agent-driven', () => {
    const asked = requirement({ modelRead: true, groundedBy: [], screenshot: false });
    const recorded = withPlatformCaptured(asked, false);
    expect(recorded).toEqual({ ...asked, platformCaptured: false });
  });
  it('refuses a stored requirement that claims platform-captured without the forced fields', () => {
    const tampered: EvidenceRequirement = { ...requirement({ groundedBy: [], modelRead: true, screenshot: false }), platformCaptured: true };
    expect(isEvidenceRequirement(tampered)).toBe(false);
  });
});

describe('the upload/frequency pairing — a completeness blocker, never a refusal', () => {
  it('is empty with no Schedule set yet', () => {
    expect(evidenceBlockersFor(MANUAL_SOURCE, null)).toEqual([]);
  });
  it('flags a manual-upload binding paired with any non-once Schedule', () => {
    for (const frequency of ['daily', 'weekly', 'monthly'] as const) {
      const schedule = { frequency, startTime: '02:00', periodDerivationRule: PERIOD_DERIVATION_RULES[frequency] };
      expect(evidenceBlockersFor(MANUAL_SOURCE, schedule)).toEqual(['upload-frequency-mismatch']);
    }
  });
  it('is empty for a manual-upload binding paired with once', () => {
    const schedule = { frequency: 'once' as const, startTime: '02:00', periodDerivationRule: 'explicit-period' as const };
    expect(evidenceBlockersFor(MANUAL_SOURCE, schedule)).toEqual([]);
  });
  it('is empty for a versioned-file binding at any frequency', () => {
    const schedule = { frequency: 'weekly' as const, startTime: '02:00', periodDerivationRule: 'previous-monday-sunday' as const };
    expect(evidenceBlockersFor(VERSIONED_SOURCE, schedule)).toEqual([]);
  });
  it('is empty with no Population Source bound at all', () => {
    const schedule = { frequency: 'weekly' as const, startTime: '02:00', periodDerivationRule: 'previous-monday-sunday' as const };
    expect(evidenceBlockersFor(null, schedule)).toEqual([]);
  });
});

describe('invalid or malformed edits', () => {
  it('refuses an unknown frequency', () => {
    expect(validateDraftEvidenceEdit({ section: 'schedule', frequency: 'yearly', startTime: '02:00' })).toEqual({ ok: false, reason: EVIDENCE_DRAFT_MESSAGES.FREQUENCY });
  });
  it('refuses a malformed start time', () => {
    expect(validateDraftEvidenceEdit({ section: 'schedule', frequency: 'daily', startTime: 'noon' })).toEqual({ ok: false, reason: EVIDENCE_DRAFT_MESSAGES.START });
    expect(validateDraftEvidenceEdit({ section: 'schedule', frequency: 'daily', startTime: '9:00' })).toEqual({ ok: false, reason: EVIDENCE_DRAFT_MESSAGES.START });
  });
  it('refuses an unknown section', () => {
    expect(validateDraftEvidenceEdit({ section: 'other' })).toEqual({ ok: false, reason: EVIDENCE_DRAFT_MESSAGES.SHAPE });
    expect(validateDraftEvidenceEdit('not an object')).toEqual({ ok: false, reason: EVIDENCE_DRAFT_MESSAGES.SHAPE });
  });
});

describe('the stored Draft shape', () => {
  it('validates a well-formed row and survives a reload round-trip', () => {
    const value = {
      evidenceSchemaVersion: 1 as const,
      evidenceRequirements: [withPlatformCaptured(requirement(), true), withPlatformCaptured(requirement({ attributeName: 'username', modelRead: true, groundedBy: [], screenshot: false }), false)],
      schedule: { frequency: 'weekly' as const, startTime: '02:00', periodDerivationRule: 'previous-monday-sunday' },
    };
    expect(isDraftEvidenceFields(value)).toBe(true);
  });
  it('refuses a row with a duplicate attribute name', () => {
    const one = withPlatformCaptured(requirement({ attributeName: 'Status' }), false);
    const two = withPlatformCaptured(requirement({ attributeName: 'status' }), false);
    expect(isDraftEvidenceFields({ evidenceSchemaVersion: 1, evidenceRequirements: [one, two], schedule: null })).toBe(false);
  });
  it('refuses an unsupported schema version', () => {
    expect(isDraftEvidenceFields({ evidenceSchemaVersion: 2, evidenceRequirements: [], schedule: null })).toBe(false);
  });
});

describe('initial Draft state', () => {
  it('seeds P-1 evidence suggestions without claiming capture before targets are selected', () => {
    const fields = initialDraftEvidence('P-1');
    expect(fields.schedule).toEqual({ frequency: 'weekly', startTime: '00:00', periodDerivationRule: 'previous-monday-sunday' });
    expect(fields.evidenceRequirements.map((r) => r.attributeName).sort()).toEqual(['account_status', 'roles', 'username']);
    for (const r of fields.evidenceRequirements) {
      expect(r.platformCaptured).toBe(false);
      expect(r.groundedBy).toContain('structural-snapshot');
      expect(r.screenshot).toBe(true);
    }
    expect(isDraftEvidenceFields(fields)).toBe(true);
  });
  it('seeds every other Template with no structured evidence and an unset Schedule', () => {
    for (const templateId of ['P-2', 'P-3', 'P-4'] as const) {
      const fields = initialDraftEvidence(templateId);
      expect(fields.evidenceRequirements).toEqual([]);
      expect(fields.schedule).toBeNull();
      expect(isDraftEvidenceFields(fields)).toBe(true);
    }
  });
});
