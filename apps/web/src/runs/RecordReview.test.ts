import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import type {
  RecordReviewPage,
  RecordReviewSelection,
  RecordReviewRow,
} from '@intellifin/application';
import type { RunEvidenceItem, RunObservationRow } from '@intellifin/infrastructure';

import {
  firstReviewOrdinal,
  normalizeRecordReviewNavigation,
  recordReviewHref,
  RecordReviewInspector,
  RecordReviewQueue,
  type RecordReviewNavigation,
} from './RecordReview';
import { NO_RECORD_NAMING, type RecordNaming } from './record-words';

const RUN_ID = '019823ab-0000-7000-8000-000000000001';
const OBSERVATION_ID = '019823ab-0000-7000-8000-000000000002';
const WORK_ITEM_ID = '019823ab-0000-7000-8000-000000000003';
const EVIDENCE_ID = '019823ab-0000-7000-8000-000000000004';

const navigation: RecordReviewNavigation = {
  filter: 'needs-review',
  search: 'Leaver',
  pageSize: 25,
  cursor: 'cursor-token',
  selected: 1,
};

const target = {
  targetId: 'target-1',
  targetName: 'LoanCore',
  observationId: OBSERVATION_ID,
  workItemId: WORK_ITEM_ID,
  account: 'account-17',
  capturedStatus: 'Observed',
  found: 'true',
  inspected: true,
  exception: false,
  pendingAssessments: 0,
  evidenceProblem: false,
  assessmentState: 'compliant' as const,
};

const firstRow: RecordReviewRow = {
  sourceOrdinal: 1,
  recordLabel: 'Leaver 17',
  disposition: 'included',
  duplicateIdentity: false,
  missingIdentity: false,
  targets: [target],
};

const secondRow: RecordReviewRow = {
  ...firstRow,
  sourceOrdinal: 2,
  recordLabel: 'Leaver 18',
  targets: [{ ...target, targetId: 'target-2', observationId: null, workItemId: null, assessmentState: 'needs-review', pendingAssessments: 1 }],
};

const page: RecordReviewPage = {
  status: 'ready',
  rows: [firstRow, secondRow],
  counts: {
    sourceRows: 2,
    sourceDeclaredCount: null,
    sourceGeneratedAt: null,
    sourceQuality: 'unknown',
    runEvidenceProblems: 0,
    includedRows: 2,
    excludedRows: 0,
    indeterminateRows: 0,
    fullyInspectedSubjects: 1,
    inspectedUnits: 1,
    requiredUnits: 2,
    exceptionRecords: null,
    unattributedObservations: 1,
    pendingAssessments: 1,
    evidenceProblemRecords: 0,
  },
  filteredRows: 2,
  asOf: '2026-09-19T10:00:00.000Z',
  expiresAt: '2026-09-19T10:10:00.000Z',
  revision: 'revision-1',
  changesAvailable: true,
  currentEvidenceProblems: 0,
  cursor: 'cursor-token',
  nextCursor: 'next-token',
  previousCursor: null,
  pageNumber: 1,
  pageSize: 25,
  filter: 'needs-review',
  search: 'Leaver',
};

const selection: RecordReviewSelection = {
  status: 'ready',
  row: firstRow,
  sourceValues: { account: '<script>ignore()</script>', department: 'Operations' },
  conditions: [{ conditionId: 'condition-1', text: 'The account must be disabled.' }],
  scope: 'Approved population',
  readAt: '2026-09-19T10:01:00.000Z',
  revision: 'revision-2',
  changedSinceList: true,
  maskedFields: [],
};

const observation = {
  observationId: OBSERVATION_ID,
  workItemId: WORK_ITEM_ID,
  populationRecordKey: 'Leaver 17',
  targetSystem: 'LoanCore',
  found: 'true',
  coverage: 'COVERED',
  corroboration: 'single',
  observedAt: '2026-09-19T09:59:00.000Z',
  observedAtSource: 'browser',
  captureMethod: 'screenshot',
  matchOrigin: 'adapter',
  digest: 'a'.repeat(64),
  identity: null,
  attributes: [{ name: 'observed_value', originalValue: '<script>changeOutcome()</script>',
    normalizedValue: 'different normalized value', grounding: null, corroboration: null }],
  evidenceIds: [EVIDENCE_ID],
  checks: [],
} as RunObservationRow;

const evidence = {
  evidenceId: EVIDENCE_ID,
  kind: 'screenshot',
  registrationId: 'registration-1',
  objectKey: 'run/object-key',
  mediaType: 'image/png',
  digest: 'b'.repeat(64),
  size: 128,
  state: 'REGISTERED',
  required: true,
  stepId: 'step-1',
  displayName: 'Inspect account',
  workItemId: WORK_ITEM_ID,
  capturedAt: '2026-09-19T09:59:00.000Z',
  captureMethod: 'browser',
  captureTimeSource: 'registration',
} as RunEvidenceItem;

describe('record review queue and inspector', () => {
  it('preserves immutable list context and clears the cursor when requested', () => {
    const href = recordReviewHref(RUN_ID, navigation, { selected: 2 });
    expect(href).toContain('filter=needs-review');
    expect(href).toContain('search=Leaver');
    expect(href).toContain('cursor=cursor-token');
    expect(href).toContain('selected=2');
    expect(recordReviewHref(RUN_ID, navigation, { cursor: null, selected: null })).not.toContain('cursor=');
    expect(normalizeRecordReviewNavigation({ filter: 'invalid', pageSize: '10', selected: '0' })).toEqual({
      filter: 'all', search: '', pageSize: 25, cursor: null, selected: null,
    });
  });

  it('renders exact list measures, as-of state, source-quality unknowns, and current changes', () => {
    const html = renderToStaticMarkup(React.createElement(RecordReviewQueue, { runId: RUN_ID, page, navigation }));
    expect(html).toContain('Changes available');
    expect(html).toContain('Source checks');
    expect(html).toContain('Not known');
    expect(html).toContain('Declared source count');
    expect(html).toContain('Time not recorded');
    expect(html).toContain('Records with exceptions</dt><dd>Unavailable');
    expect(html).toContain('Some findings are not linked to a record');
    expect(html).toContain('List read');
    expect(html).toContain('Review evidence');
  });

  // UX-22: the queue opens on RECORDS. The walkthrough met ~15 source and count figures
  // before the first record; they are behind ONE closed disclosure now, the counts are one
  // line of words, and a failed check keeps its own banner OUTSIDE the disclosure.
  it('opens on records: counts in one line, figures behind one closed disclosure', () => {
    const html = renderToStaticMarkup(React.createElement(RecordReviewQueue, { runId: RUN_ID, page, navigation }));
    expect(html).toContain('2 included records · exceptions not yet known · 1 assessment waiting for review · 1 of 2 fully inspected');
    const details = html.match(/<details class="ls-disclosure record-review__population">[\s\S]*?<\/details>/)?.[0] ?? '';
    expect(details).toContain('<summary>Source and coverage details</summary>');
    expect(details).not.toMatch(/<details[^>]*\sopen/);
    for (const figure of ['Source rows', 'Declared source count', 'Records with exceptions', 'Integrity problems when read']) {
      expect(details).toContain(figure);
      expect(html.replace(details, '')).not.toContain(figure);
    }
    // The failure stays visible, outside the disclosure.
    expect(html.replace(details, '')).toContain('Some findings are not linked to a record');
    // The records come after the one-line counts, not after a wall of figures.
    expect(html.indexOf('Record review queue')).toBeGreaterThan(html.indexOf(details));
    // The implementation sentence about escaping is gone (UX-24).
    expect(html).not.toContain('They are escaped');
    // Readable instants only: no element whose text is a raw ISO instant.
    expect(html).not.toMatch(/>\s*\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z\s*</);
  });

  it('says which evidence checks a row passed instead of "No problem recorded" (UX-26)', () => {
    const html = renderToStaticMarkup(React.createElement(RecordReviewQueue, { runId: RUN_ID, page, navigation }));
    expect(html).not.toContain('No problem recorded');
    expect(html).toContain('All checks passed');
    const unchecked = renderToStaticMarkup(React.createElement(RecordReviewQueue, {
      runId: RUN_ID, navigation,
      page: { ...page, rows: [{ ...secondRow, targets: [{ ...secondRow.targets[0]!, inspected: false }] }] },
    }));
    expect(unchecked).toContain('Not checked yet');
    expect(unchecked).not.toContain('All checks passed');
    const failed = renderToStaticMarkup(React.createElement(RecordReviewQueue, {
      runId: RUN_ID, navigation,
      page: { ...page, rows: [{ ...firstRow, targets: [{ ...target, evidenceProblem: true }] }] },
    }));
    expect(failed).toContain('A check failed');
  });

  it('meets the reader on the first Exception, then the first record waiting on a person', () => {
    const exceptionRow = { ...secondRow, sourceOrdinal: 7, targets: [{ ...target, exception: true, assessmentState: 'exception' as const }] };
    expect(firstReviewOrdinal([firstRow, secondRow, exceptionRow])).toBe(7);
    expect(firstReviewOrdinal([firstRow, secondRow])).toBe(2);
    expect(firstReviewOrdinal([firstRow])).toBe(1);
    expect(firstReviewOrdinal([])).toBeNull();
  });

  it('renders a changed selected record with escaped source data and exact protected links', () => {
    const html = renderToStaticMarkup(React.createElement(RecordReviewInspector, {
      runId: RUN_ID,
      selection,
      observations: [observation],
      evaluations: [],
      evidence: [evidence],
      evaluationReview: null,
      navigation,
      page,
    }));
    expect(html).toContain('Changed since this list loaded');
    expect(html).toContain('The account must be disabled.');
    expect(html).toContain('&lt;script&gt;ignore()&lt;/script&gt;');
    expect(html).not.toContain('<script>ignore()</script>');
    expect(html).toContain('observed value: &lt;script&gt;changeOutcome()&lt;/script&gt;');
    expect(html).not.toContain('<script>changeOutcome()</script>');
    expect(html).not.toContain('different normalized value');
    expect(html).toContain(`/api/runs/${RUN_ID}/frames/${EVIDENCE_ID}`);
    expect(html).toContain('Preview account capture');
    expect(html).toContain(`/runs/${RUN_ID}/replay?workItem=${WORK_ITEM_ID}`);
    expect(html).toContain('selected=2');
    expect(html).toContain('cursor=cursor-token');
    expect(html).toContain('Opening evidence does not confirm an assessment.');
    expect(html).toContain('Technical details');
  });

  // UX-24: the inspector says what an auditor needs and nothing about how the platform
  // stores or serves it. Each of these was on the walkthrough's screen.
  it('says no implementation sentence, and names the source, the time and the checks', () => {
    const checked = { ...observation, checks: [
      { check: 'identity-corroboration', outcome: 'PASS', diagnostic: null },
      { check: 'required-evidence', outcome: 'FAIL', diagnostic: 'screenshot-missing' },
    ] } as RunObservationRow;
    // Production projects a target by its registration id, which is what an Evidence
    // item carries, so the inspector can say which system a capture came from.
    const html = renderToStaticMarkup(React.createElement(RecordReviewInspector, {
      runId: RUN_ID, selection, observations: [checked], evaluations: [],
      evidence: [{ ...evidence, registrationId: 'target-1' } as RunEvidenceItem],
      evaluationReview: null, navigation, page,
    }));
    for (const phrase of [
      'bytes load only', 'protected preview or snapshot route', 'independently authorized',
      'current Result and review revision', 'selected-record projection', 'inert presentation content',
      'Recorded in selected metadata', 'Fingerprint recorded', 'No problem recorded',
    ]) expect(html, phrase).not.toContain(phrase);
    // Where the evidence came from and when.
    expect(html).toContain('LoanCore · Inspect account');
    expect(html).toContain('<time');
    expect(html).not.toContain('2026-09-19T09:59:00.000Z</');
    // Which checks ran and how they came out, in words; a failure's code is technical.
    expect(html).toContain('The record found is the one searched for: <strong>Passed</strong>');
    expect(html).toContain('All required evidence was captured: <strong>Failed</strong>');
    expect(html).toContain('Matched when the file was saved');
    // The untrusted-content policy is said once for the whole inspector (UX-27).
    expect(html.match(/ls-untrusted-region__policy/g)?.length ?? 0).toBe(1);
  });

  it('says a file was never verified when it was not registered', () => {
    const html = renderToStaticMarkup(React.createElement(RecordReviewInspector, {
      runId: RUN_ID, selection, observations: [observation], evaluations: [],
      evidence: [{ ...evidence, state: 'RESERVED', digest: null } as RunEvidenceItem],
      evaluationReview: null, navigation, page,
    }));
    expect(html).toContain('Not verified yet');
    expect(html).not.toContain('Matched when the file was saved');
  });

  // UX-25 and FR-41: one record label everywhere, masked where the frozen binding says so.
  it('labels the record by key and permitted name, and masks what the binding designates', () => {
    const naming: RecordNaming = { keyColumn: 'employee_id', nameColumn: 'full_name', keyMasked: false, nameMasked: false, sensitiveFields: [] };
    const named = renderToStaticMarkup(React.createElement(RecordReviewQueue, {
      runId: RUN_ID, navigation, naming,
      page: { ...page, rows: [{ ...firstRow, recordLabel: 'E-000103', recordName: 'Dana Leaver' }] },
    }));
    expect(named).toContain('<h3>E-000103 · Dana Leaver</h3>');

    const masking: RecordNaming = { ...naming, keyMasked: true, nameMasked: true, sensitiveFields: ['employee_id', 'full_name'] };
    const masked = renderToStaticMarkup(React.createElement(RecordReviewInspector, {
      runId: RUN_ID, navigation, page, naming: masking,
      selection: { ...selection, row: { ...firstRow, recordLabel: 'E-000103', recordName: null },
        sourceValues: { employee_id: null, full_name: null, department: 'Operations' }, maskedFields: ['employee_id', 'full_name'] },
      observations: [{ ...observation, attributes: [{ name: 'full_name', originalValue: 'Dana Leaver', normalizedValue: 'Dana Leaver', grounding: null, corroboration: null }] } as RunObservationRow],
      evaluations: [], evidence: [], evaluationReview: null,
    }));
    expect(masked).not.toContain('E-000103');
    expect(masked).not.toContain('Dana Leaver');
    expect(masked).toContain('Masked by the Population Source binding');
    expect(masked).toContain('full name: ••••');
    expect(masked).toContain('Operations');

    const plain = renderToStaticMarkup(React.createElement(RecordReviewQueue, { runId: RUN_ID, page, navigation, naming: NO_RECORD_NAMING }));
    expect(plain).toContain('<h3>Leaver 17</h3>');
  });

  it('offers each target inspection separately instead of choosing the first system silently', () => {
    const otherWork = '019823ab-0000-7000-8000-000000000005';
    const html = renderToStaticMarkup(React.createElement(RecordReviewInspector, {
      runId: RUN_ID,
      selection: { ...selection, row: { ...selection.row, targets: [target, { ...target, targetId: 'target-2', targetName: 'AccessGate', workItemId: otherWork }] } },
      observations: [], evaluations: [], evidence: [], navigation, page,
    }));
    expect(html).toContain('Replay LoanCore inspection');
    expect(html).toContain('Replay AccessGate inspection');
    expect(html).toContain(`/replay?workItem=${WORK_ITEM_ID}`);
    expect(html).toContain(`/replay?workItem=${otherWork}`);
    expect(html).not.toContain('Replay this inspection');
  });
});
