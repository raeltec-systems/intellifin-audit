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
  normalizeRecordReviewNavigation,
  recordReviewHref,
  RecordReviewInspector,
  RecordReviewQueue,
  type RecordReviewNavigation,
} from './RecordReview';

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
    expect(html).toContain('Source quality');
    expect(html).toContain('Unknown');
    expect(html).toContain('Declared source count');
    expect(html).toContain('Time not recorded');
    expect(html).toContain('Records with exceptions</dt><dd>Unavailable');
    expect(html).toContain('Observation relationship unresolved');
    expect(html).toContain('List as of');
    expect(html).toContain('Review evidence');
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
