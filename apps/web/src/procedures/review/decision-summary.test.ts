import { describe, expect, it } from 'vitest';
import {
  initialDraftCompliance,
  initialDraftEvidence,
  registrationDigest,
  snapshotFromRegistration,
  type EvidenceRequirement,
  type InclusionRule,
} from '@intellifin/domain';

import { executablePlanInputs } from '../../../../../tests/fixtures/executable-plan';
import { scheduleLine } from '../section-summary';
import {
  criteria,
  evidenceWords,
  fieldList,
  filterSentence,
  filterSentences,
  periodWords,
  plannedFrequencyWords,
  sectionText,
  sourceFacts,
  systemAccess,
} from './decision-summary';
import { FILTER_COMPARISONS } from '../../design/plain-words';
import { NOT_SET, NO_FILTERS_SENTENCE, SUMMARY_LABELS } from './review-words';

/**
 * What a manager is deciding about, read from the version's own frozen inputs.
 *
 * Every function here must READ and never infer: the summary is the thing an approver
 * actually reads before an approval activates a Procedure, so one that could disagree
 * with the contract underneath it would be worse than no summary at all.
 */

const INPUTS = executablePlanInputs();

describe('the scope reads the frozen Period and source', () => {
  it('says a Period the way a person reads it, never as two ISO dates', () => {
    expect(periodWords({ from: '2026-08-01', to: '2026-08-31' })).toBe('1–31 Aug 2026');
    expect(periodWords({ from: '2026-08-25', to: '2026-09-03' })).toBe('25 Aug – 3 Sep 2026');
  });

  it('says so when no Period is frozen, rather than rendering a dash', () => {
    expect(periodWords(null)).toBe(NOT_SET);
  });

  it('spaces a source field name rather than showing its stored spelling', () => {
    expect(fieldList(['employee_id', 'full_name'])).toBe('employee id, full name');
  });

  it('names the absence of a declared schema in words', () => {
    expect(fieldList([])).not.toBe('');
  });

  it('reads how the records arrive and how their count is confirmed', () => {
    const facts = sourceFacts(INPUTS.sourceSnapshot!);
    const labels = facts.map((fact) => fact.label);
    expect(labels).toContain(SUMMARY_LABELS.arrival);
    expect(labels).toContain(SUMMARY_LABELS.countMechanism);
    expect(labels).toContain(SUMMARY_LABELS.fields);
    expect(labels).toContain(SUMMARY_LABELS.masked);
    // Never the stored vocabulary: `versioned-file` and `cover-sheet` are domain values.
    for (const fact of facts) expect(fact.value).not.toMatch(/^[a-z]+(-[a-z]+)+$/);
  });
});

describe('an inclusion filter is a sentence, taken from the list the auditor chose from', () => {
  it('says every record is tested when the rule names no filter', () => {
    expect(filterSentences({ schemaVersion: 1, all: [] } as InclusionRule)).toEqual([NO_FILTERS_SENTENCE]);
  });

  it('quotes the value exactly, because compiler 1 compares named values exactly', () => {
    const sentence = filterSentence({ kind: 'text', column: 'department', value: 'Finance' } as InclusionRule['all'][number]);
    // The comparison is the Builder's OWN label, read from the shared list rather than
    // restated, so a reworded comparison lands on the auditor and the approver at once.
    const label = FILTER_COMPARISONS.find((entry) => entry.id === 'text:eq')!.label;
    expect(sentence).toBe(`department ${label} “Finance”`);
    expect(sentence).not.toContain('finance');
  });

  it('says a period clause without inventing a value it has none of', () => {
    const sentence = filterSentence({ kind: 'within-period', column: 'termination_effective_date' } as InclusionRule['all'][number]);
    expect(sentence).toContain('termination effective date');
    expect(sentence).not.toContain('“');
  });

  it('keeps a stored predicate kind this build has no label for, rather than a blank', () => {
    const sentence = filterSentence({ kind: 'not-a-kind', column: 'department', value: 'Finance' } as unknown as InclusionRule['all'][number]);
    expect(sentence).toContain('not-a-kind');
  });
});

describe('a system says what the agent may do there and where it may go', () => {
  const registration = {
    registrationId: '018f0000-0000-7000-8000-0000000000b1',
    displayName: 'LoanCore',
    kind: 'web' as const,
    allowedOrigins: ['https://synthetic.invalid/loancore'],
    applicationIdentity: '',
    credentialRef: 'vault://synthetic/loancore',
    permittedActions: ['navigate', 'read-attribute'] as const,
    attributeLabelPatterns: ['Status'],
    secondaryKey: '',
  };
  const target = snapshotFromRegistration({ ...registration, digest: registrationDigest(registration) });

  it('says the permitted actions in words and never as their stored spelling', () => {
    const [access] = systemAccess([target], []);
    expect(access!.actions).toEqual(['open pages', 'read a field']);
    expect(access!.reach).toEqual(registration.allowedOrigins);
    expect(access!.kindWord).not.toBe('web');
  });

  it('names the credential by reference only, and the value is nowhere in the shape', () => {
    const [access] = systemAccess([target], []);
    expect(access!.credentialRef).toBe(registration.credentialRef);
    expect(JSON.stringify(access)).not.toContain('password');
  });

  it('carries the auditor instruction for the system it was written for, and no other', () => {
    const [access] = systemAccess([target], [{ registrationId: target.registrationId, text: 'Read the status.' }]);
    expect(access!.instruction).toBe('Read the status.');
    const [none] = systemAccess([target], [{ registrationId: 'other', text: 'Not this system.' }]);
    expect(none!.instruction).toBeNull();
  });

  it('treats a blank instruction as none rather than as an empty sentence', () => {
    const [access] = systemAccess([target], [{ registrationId: target.registrationId, text: '   ' }]);
    expect(access!.instruction).toBeNull();
  });
});

describe('a criterion is said in audit language where the shared reader can express it', () => {
  it('reads P-1 Template conditions into sentences an auditor can check', () => {
    const p1 = initialDraftCompliance('P-1');
    const read = criteria(p1.complianceConditions, 'P-1');
    expect(read.length).toBeGreaterThan(0);
    const spoken = read.filter((condition) => condition.sentence !== null);
    expect(spoken.length).toBeGreaterThan(0);
    for (const condition of spoken) {
      expect(condition.sentence).toContain('Acceptable:');
      expect(condition.sentence).toContain('Exception:');
    }
  });

  it('answers null for a criterion only the rule language can express, never a guess', () => {
    // P-4's Template criterion is frozen prose the simple reader has no shape for. A
    // sentence invented there would describe a rule the version did not freeze.
    const read = criteria(initialDraftCompliance('P-4').complianceConditions, 'P-4');
    expect(read.every((condition) => condition.sentence === null)).toBe(true);
    for (const condition of read) expect(condition.text.length).toBeGreaterThan(0);
  });

  it('says which criteria the agent judges, because certainty decides only those', () => {
    const read = criteria(initialDraftCompliance('P-1').complianceConditions, 'P-1');
    const judged = read.filter((condition) => condition.agentJudged);
    expect(judged.length).toBeGreaterThan(0);
  });
});

describe('the proof kept per record is words rather than flags', () => {
  const base: EvidenceRequirement = {
    attributeName: 'account_status',
    modelRead: false,
    groundedBy: ['structural-snapshot'],
    screenshot: true,
    recordingSegment: false,
    platformCaptured: true,
  };

  it('names each artifact that is kept', () => {
    const words = evidenceWords(base);
    expect(words).toContain('page structure');
    expect(words).toContain('screenshot');
    expect(words).not.toContain('structural-snapshot');
  });

  it('says a model-read value is accepted without a matching proof', () => {
    const words = evidenceWords({ ...base, modelRead: true, groundedBy: [], screenshot: false });
    expect(words).toMatch(/accepted/);
  });

  it('never implies proof where the requirement asks for none', () => {
    const words = evidenceWords({ ...base, groundedBy: [], screenshot: false });
    expect(words).toContain('Nothing is kept');
  });

  it('reads the Template’s own requirements without inventing one', () => {
    const evidence = initialDraftEvidence('P-1');
    for (const requirement of evidence.evidenceRequirements) {
      expect(evidenceWords(requirement).length).toBeGreaterThan(0);
    }
  });
});

describe('frequency is a plan, and the Template sections are read as stored', () => {
  it('reads the saved frequency through the Builder’s own sentence', () => {
    // `scheduleLine` is the Builder's saved-frequency sentence, read rather than restated.
    expect(plannedFrequencyWords(INPUTS.schedule)).toBe(scheduleLine(INPUTS.schedule));
    expect(plannedFrequencyWords(INPUTS.schedule)).toContain('Once');
    expect(plannedFrequencyWords(null)).toBe(NOT_SET);
  });

  it('answers null for a section the version left empty, never an empty string', () => {
    expect(sectionText({ sections: [{ heading: 'Control', content: '   ', compiled: null }] } as never, 'Control')).toBeNull();
    expect(sectionText({ sections: [] } as never, 'Control')).toBeNull();
  });
});
