import { describe, expect, it } from 'vitest';
import { DRAFT_SECTION_HEADINGS, initialDraftSections } from '@intellifin/domain';
import type { ProcedureVersionView } from '@intellifin/application';

import { builderProgress, scheduleLine, sectionSummary } from './section-summary';

/** A Draft with nothing answered. Every step is a question waiting for the auditor. */
function emptyDraft(): ProcedureVersionView {
  return {
    versionId: '00000000-0000-7000-8000-000000000001',
    procedureId: '00000000-0000-7000-8000-000000000002',
    versionNumber: 1,
    state: 'DRAFT',
    controlName: 'Terminated employee access',
    templateId: 'P-1',
    sections: initialDraftSections('P-1'),
    targetBlockers: ['targets-missing'],
    evidenceBlockers: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    period: null,
    scope: '',
    sourceSnapshot: null,
    inclusionRule: { schemaVersion: 1, all: [] },
    zeroRecordPass: false,
    allowVersionedDuplicates: false,
    targets: [],
    instructions: [],
    complianceSchemaVersion: 1,
    complianceCompilerVersion: 1,
    complianceConditions: [],
    agentJudgedThreshold: '0.80',
    evidenceSchemaVersion: 1,
    evidenceRequirements: [],
    schedule: null,
    planStatus: 'pending',
    compiledPlan: null,
    planAttempts: [],
    planDerivable: true,
    derivationModel: null,
  } as unknown as ProcedureVersionView;
}

describe('what a closed Builder step says about itself', () => {
  it('gives every section a line, so closing one is never hiding', () => {
    const draft = emptyDraft();
    for (const heading of DRAFT_SECTION_HEADINGS) {
      const summary = sectionSummary(heading, draft);
      expect(summary.line.length, heading).toBeGreaterThan(0);
    }
  });

  it('marks the unanswered questions and never the Template sections', () => {
    const draft = emptyDraft();
    expect(sectionSummary('Control', draft).state).toBe('reference');
    expect(sectionSummary('Objective', draft).state).toBe('reference');
    expect(sectionSummary('Period and scope', draft).state).toBe('todo');
    expect(sectionSummary('Population Source binding', draft).state).toBe('todo');
    expect(sectionSummary('Target System selection', draft).state).toBe('todo');
    expect(sectionSummary('Compliance Rule conditions', draft).state).toBe('todo');
    expect(sectionSummary('Evidence Requirements', draft).state).toBe('todo');
    expect(sectionSummary('Schedule', draft).state).toBe('todo');
  });

  /**
   * Instructions are optional — a system the agent drives can be audited from the
   * Compliance Rule alone — so an absent instruction must not put a permanent "To do"
   * on a Draft that is finished.
   */
  it('does not ask for Audit Instructions that are not required', () => {
    expect(sectionSummary('Audit Instructions', emptyDraft()).state).toBe('done');
  });

  it('says a period in words a reader can check against the dates they meant', () => {
    const draft = {
      ...emptyDraft(),
      period: { from: '2026-08-01', to: '2026-08-31' },
      scope: 'All leavers in the month.',
    } as ProcedureVersionView;
    const summary = sectionSummary('Period and scope', draft);
    expect(summary.state).toBe('done');
    expect(summary.line).toBe('1 Aug 2026 to 31 Aug 2026, UTC. All leavers in the month.');
  });

  /**
   * A source whose record count nobody confirms is SET but not safe to leave alone:
   * FR-6 requires its absence to be visible while a person can still act on it, and a
   * step marked "Set" is a step a person stops reading.
   */
  it('flags a source that nothing confirms the record count for', () => {
    const bound = (mechanism: 'cover-sheet' | 'none') =>
      ({
        ...emptyDraft(),
        sourceSnapshot: {
          bindingId: 'b',
          displayName: 'LoanCore leavers export',
          digest: 'a'.repeat(64),
          contract: {
            kind: 'versioned-file',
            location: 'https://example.test/leavers.csv',
            declared_schema: ['employee_id'],
            declared_count_mechanism: mechanism,
            sensitive_fields: [],
          },
        },
        inclusionRule: {
          schemaVersion: 1,
          all: [{ column: 'termination_date', kind: 'within-period' }],
        },
      }) as unknown as ProcedureVersionView;
    expect(sectionSummary('Population Source binding', bound('cover-sheet'))).toEqual({
      state: 'done',
      line: 'LoanCore leavers export — testing records matching 1 filter',
    });
    expect(sectionSummary('Population Source binding', bound('none')).state).toBe('attention');
  });

  it('reads a Schedule the way somebody would say it', () => {
    expect(scheduleLine(null)).toBe('Not set');
    expect(
      scheduleLine({
        frequency: 'weekly',
        startTime: '00:00',
        periodDerivationRule: 'previous-monday-sunday',
      }),
    ).toBe('Every week at 00:00 UTC');
    expect(
      scheduleLine({
        frequency: 'once',
        startTime: '06:00',
        periodDerivationRule: 'explicit-period',
      }),
    ).toBe('Once, over the period above');
  });
});

describe('the progress line', () => {
  it('counts only the steps somebody has to take', () => {
    const headings = DRAFT_SECTION_HEADINGS.filter(
      (heading) => heading !== 'Control' && heading !== 'Objective' && heading !== 'Risk' && heading !== 'Criterion reference',
    );
    const progress = builderProgress(headings, emptyDraft());
    expect(progress.total).toBe(headings.length);
    // Audit Instructions is optional and therefore already answered.
    expect(progress.done).toBe(1);
  });
});
