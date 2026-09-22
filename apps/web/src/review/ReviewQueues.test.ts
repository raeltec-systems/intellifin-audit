import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { PendingResultRow, SubmittedVersionRow } from '@intellifin/infrastructure';

import { PendingResults } from './PendingResults';
import { SubmittedVersions } from './SubmittedVersions';
import { OPEN_RESULT, OPEN_VERSION_REVIEW, reviewsBounded } from './review-words';

/**
 * The two Reviews queues, rendered for real (UI cleanup 2026-09-22, UX-30/35/36).
 *
 * Both are shared with the Overview's attention list, so what is asserted here is that
 * each row names what a person recognises, carries ONE way onward, and says the exact
 * number waiting rather than the length of the page.
 */

const VERSION: SubmittedVersionRow = {
  versionId: '019823ab-0000-7000-8000-0000000000b3',
  procedureId: '019823ab-0000-7000-8000-0000000000a3',
  controlName: 'Privileged Access Review',
  versionNumber: 4,
  submittedAt: '2026-09-15T08:00:00.000Z',
  submittedBy: 'auditor-2',
  authorId: 'auditor-3',
};

const PENDING: PendingResultRow = {
  runId: '019823ab-0000-7000-8000-000000000004',
  procedureId: '019823ab-0000-7000-8000-0000000000a5',
  procedureName: 'Segregation of Duties',
  versionNumber: 2,
  period: { from: '2026-08-01', to: '2026-08-31' },
  initiatorId: 'auditor-1',
  initiatedAt: '2026-09-15T09:00:00.000Z',
  resultAt: '2026-09-15T09:04:00.000Z',
  pendingEvaluations: 3,
};

describe('the Procedure Versions queue', () => {
  const names = new Map([
    ['auditor-2', 'Mira Haddad'],
    ['auditor-3', 'Daniel Okonjo'],
  ]);

  it('names the version, who sent it, who wrote it, and one way onward', () => {
    const html = renderToStaticMarkup(
      React.createElement(SubmittedVersions, { rows: [VERSION], total: 1, names }),
    );
    expect(html).toContain('Privileged Access Review');
    expect(html).toContain('v4');
    expect(html).toContain('Mira Haddad');
    expect(html).toContain('Daniel Okonjo');
    expect(html).toContain('15 Sep 2026, 08:00 UTC');
    expect(html).toContain(OPEN_VERSION_REVIEW);
    expect(html).toContain(
      'href="/procedures/019823ab-0000-7000-8000-0000000000a3/versions/019823ab-0000-7000-8000-0000000000b3"',
    );
    // A user id printed at a reader is the platform speaking its own language.
    expect(html).not.toContain('>auditor-2<');
  });

  it('says what a row does not record rather than showing a gap', () => {
    const html = renderToStaticMarkup(
      React.createElement(SubmittedVersions, {
        rows: [{ ...VERSION, submittedAt: null, submittedBy: null, authorId: null }],
        total: 1,
        names: new Map(),
      }),
    );
    expect(html).toContain('The submission time was not recorded.');
    expect(html).toContain('No author is recorded on this version.');
  });

  it('says how many it did not show, from the exact total', () => {
    const html = renderToStaticMarkup(
      React.createElement(SubmittedVersions, { rows: [VERSION], total: 12, names }),
    );
    expect(html).toContain(reviewsBounded(1, 12));
  });
});

describe('the waiting assessments queue', () => {
  const names = new Map([['auditor-1', 'Daniel Okonjo']]);

  it('leads with the Procedure and asks for the exact number of confirmations', () => {
    const html = renderToStaticMarkup(
      React.createElement(PendingResults, { rows: [PENDING], total: 1, names }),
    );
    expect(html).toContain('Segregation of Duties');
    expect(html).toContain('Pending Confirmation');
    expect(html).toContain('3 of the agent’s assessments need your confirmation.');
    // The same number the Run's own Result tab shows: both come from the effective
    // confirmation over the review ledger, never from the machine rows alone.
    expect(html).toContain(OPEN_RESULT);
    expect(html).toContain('href="/runs/019823ab-0000-7000-8000-000000000004/result"');
    expect(html).toContain('1–31 Aug 2026');
    expect(html).toContain('Daniel Okonjo');
    // Named by a short reference, never by its own UUID as visible text.
    expect(html).not.toContain('>019823ab-0000-7000-8000-000000000004<');
    expect(html).toContain('Run <span class="ls-mono">00000004</span>');
  });

  it('counts one waiting assessment as one', () => {
    const html = renderToStaticMarkup(
      React.createElement(PendingResults, {
        rows: [{ ...PENDING, pendingEvaluations: 1 }],
        total: 1,
        names,
      }),
    );
    expect(html).toContain('1 of the agent’s assessments needs your confirmation.');
  });
});
