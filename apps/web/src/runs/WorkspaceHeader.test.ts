import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { RunState } from '@intellifin/domain';

import { WorkspaceHeader, WorkspaceProgress, type WorkspaceHeaderRun } from './WorkspaceHeader';
import { NO_STEP_STARTED_SENTENCE, RECORD_COVERAGE_UNAVAILABLE } from './workspace-words';

/**
 * The Auditor Workspace's header and progress lines (UI cleanup 2026-09-23, UX-23, UX-02).
 *
 * `.test.ts` with `React.createElement`, because Vitest collects `*.test.ts` and not
 * `*.test.tsx` (a `.tsx` test here would pass by never running).
 */

const RUN: WorkspaceHeaderRun = {
  procedureId: '0199a000-0000-7000-8000-000000000001',
  procedureName: 'Leaver access review',
  versionId: '0199a000-0000-7000-8000-000000000002',
  versionNumber: 3,
  period: { from: '2026-08-01', to: '2026-08-31' },
  initiatedAt: '2026-09-21T12:24:45.656Z',
  state: 'AWAITING_AUDITOR',
};

const ISO_INSTANT = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** What a reader sees: the markup with every tag, and so every attribute, removed. */
function visibleText(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

function header(run: WorkspaceHeaderRun = RUN): string {
  return renderToStaticMarkup(React.createElement(WorkspaceHeader, { run }));
}

function progress(props: React.ComponentProps<typeof WorkspaceProgress>): string {
  return renderToStaticMarkup(React.createElement(WorkspaceProgress, props));
}

describe('the Auditor Workspace header (UX-23)', () => {
  it('uses the shared PageHeader shape: the title with its state badge, then one meta line', () => {
    const html = header();
    expect(html).toMatch(/^<header class="ls-page-header"><div class="ls-page-header__row"><div class="ls-page-header__title">/);
    expect(html).toContain('<h1>Auditor Workspace · Leaver access review</h1>');
    // The state is the lifecycle badge on the title's row, not a lowercased code.
    expect(html).toMatch(/<div class="ls-page-header__title"><h1>[^<]+<\/h1><span class="ls-badge ls-badge--md [^"]+">/);
    expect(visibleText(html)).toContain('Awaiting Auditor');
    expect(html).not.toContain('awaiting auditor');
    expect(html).toContain('<p class="ls-page-header__meta">');
  });

  it('says the period in words and the start as a readable instant, exact only in its attribute', () => {
    const html = header();
    const text = visibleText(html);
    expect(text).toContain('Period 1–31 Aug 2026');
    expect(text).toContain('Started 21 Sep 2026, 12:24 UTC');
    // The old header printed `2026-08-01 to 2026-08-31` and the Run's raw state.
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}/);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(text).not.toMatch(ISO_INSTANT);
    expect(text).not.toContain('Approved version');
    // React's server rendering writes `dateTime`, not `datetime`.
    expect(html).toContain('<time dateTime="2026-09-21T12:24:45.656Z"');
  });

  it('links the Procedure and the approved version in the meta line', () => {
    const html = header();
    expect(html).toContain(`<a href="/procedures/${RUN.procedureId}">Leaver access review</a>`);
    expect(html).toContain(`<a href="/procedures/${RUN.procedureId}/versions/${RUN.versionId}">v3</a>`);
  });

  it('writes a state outside the vocabulary in words rather than throwing', () => {
    const html = header({ ...RUN, state: 'SOMETHING_NEW' as RunState });
    expect(html).toContain('Run lifecycle: SOMETHING_NEW');
    expect(html).not.toContain('ls-badge');
  });
});

describe('the Auditor Workspace progress line (UX-02, UX-31)', () => {
  const readAt = new Date('2026-09-21T12:30:05.123Z');

  it('counts with their nouns, pluralised by the count', () => {
    const one = visibleText(progress({ counts: { fullyInspectedSubjects: 1, includedRows: 1, exceptionRecords: 1, pendingAssessments: 1 }, readAt, current: null }));
    expect(one).toContain('1 of 1 included record inspected · 1 record with exceptions · 1 assessment awaiting confirmation');
    const many = visibleText(progress({ counts: { fullyInspectedSubjects: 1200, includedRows: 1842, exceptionRecords: 0, pendingAssessments: 2 }, readAt, current: null }));
    expect(many).toContain('1,200 of 1,842 included records inspected · 0 records with exceptions · 2 assessments awaiting confirmation');
  });

  it('says an exception count that cannot be exact is not counted, never "Unknown with exceptions"', () => {
    const text = visibleText(progress({ counts: { fullyInspectedSubjects: 0, includedRows: 3, exceptionRecords: null, pendingAssessments: 0 }, readAt, current: null }));
    expect(text).toContain('records with exceptions not counted');
    expect(text).not.toContain('Unknown');
  });

  it('names the newest step and both instants in words, with the exact instants only in attributes', () => {
    const html = progress({
      counts: null,
      readAt,
      current: { action: 'inspect-record', subject: 'E-000103', target: 'LoanCore', startedAt: '2026-09-21T12:29:58.004Z' },
    });
    const text = visibleText(html);
    expect(text).toContain(RECORD_COVERAGE_UNAVAILABLE);
    expect(text).toContain('Read at 21 Sep 2026, 12:30:05 UTC. Inspect the record for E-000103 on LoanCore, started 21 Sep 2026, 12:29:58 UTC.');
    expect(text).not.toMatch(ISO_INSTANT);
    expect(html).toContain('dateTime="2026-09-21T12:29:58.004Z"');
    // The step line stays a bounded, keyboard-reachable region: a record key is source data.
    expect(html).toContain('class="ls-caption run-workspace-current-action" role="region" aria-label="Current action and freshness" tabindex="0"');
  });

  it('says no step has started without claiming anything was committed', () => {
    const text = visibleText(progress({ counts: null, readAt, current: null }));
    expect(text).toContain(NO_STEP_STARTED_SENTENCE);
    expect(text).not.toContain('committed');
  });
});

describe('the workspace page composes these rather than printing its own words', () => {
  const page = readFileSync(fileURLToPath(new URL('../../app/runs/[id]/workspace/page.tsx', import.meta.url)), 'utf8');

  it('renders the shared header and progress components', () => {
    expect(page).toContain('header={<WorkspaceHeader run={run} />}');
    expect(page).toContain('progress={<WorkspaceProgress');
  });

  it('prints no raw instant, no state code and no implementation statement', () => {
    for (const removed of [
      'utcStamp',
      '.toLowerCase()',
      'Approved version',
      'Registered action-linked capture',
      'Registered evidence updates when execution commits a capture',
      'Action-linked workspace captures',
      'No registered workspace capture',
      'No committed current action',
    ]) {
      expect(page, removed).not.toContain(removed);
    }
  });

  it('says where the saved screen came from, through the untrusted-content block', () => {
    expect(page).toContain('<UntrustedRegion><FrameSource frame={frame}');
    expect(page).toContain('savedScreenSentence(');
  });
});
