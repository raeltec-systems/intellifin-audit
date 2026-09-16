import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { RunStopFacts } from '@intellifin/infrastructure';

import { StopReasonBanner, StopReasonNote } from './StopReason';
import { FRESHNESS_ADVICE, STOP_REASON_TITLE } from './stop-reason';

/**
 * The two renderings of one sentence: the caption under a list badge, and the banner on
 * every Run Detail tab. Both take the SAME facts through the SAME function, so the list
 * and the header cannot say two different things about one Run.
 */

const STALE: RunStopFacts = {
  runId: '019823ab-0000-7000-8000-000000000001',
  state: 'INCONCLUSIVE',
  initiatedAt: '2026-09-15T10:00:00.000Z',
  period: { from: '2026-09-01', to: '2026-09-15' },
  stop: { stage: 'population', diagnostic: 'freshness' },
  timedOutWait: null,
  snapshotGeneratedAt: '2026-09-01T00:00:00.000Z',
  gateChecks: 0,
  gateFailed: 0,
  outcomeRow: 'gate-failed',
};

describe('the stop reason on the list', () => {
  it('is one caption line carrying the sentence and the advice', () => {
    const html = renderToStaticMarkup(React.createElement(StopReasonNote, { facts: STALE }));
    expect(html).toContain('class="ls-caption ls-stop-reason"');
    expect(html).toContain('generated on 2026-09-01, before the period ended on 2026-09-15');
    expect(html).toContain(FRESHNESS_ADVICE);
    // The code word stays on the Timeline tab, where it is data. Not here.
    expect(html).not.toContain('>freshness<');
  });

  it('renders nothing at all for a Run that has not stopped', () => {
    expect(renderToStaticMarkup(React.createElement(StopReasonNote, { facts: { ...STALE, state: 'COMPLETED' } }))).toBe('');
    expect(renderToStaticMarkup(React.createElement(StopReasonNote, { facts: { ...STALE, state: 'CANCELED' } }))).toBe('');
  });
});

describe('the stop reason on Run Detail', () => {
  it('is a warning banner with the heading and the sentence', () => {
    const html = renderToStaticMarkup(React.createElement(StopReasonBanner, { facts: STALE }));
    expect(html).toContain('ls-banner--warning');
    expect(html).toContain(STOP_REASON_TITLE);
    expect(html).toContain('generated on 2026-09-01, before the period ended on 2026-09-15');
    // A status region, not an alert: the Run stopped some time ago and nothing is asked
    // of the reader this second.
    expect(html).toContain('role="status"');
  });

  it('renders nothing for a Run that has not stopped', () => {
    expect(renderToStaticMarkup(React.createElement(StopReasonBanner, { facts: { ...STALE, state: 'RUNNING' } }))).toBe('');
  });
});
