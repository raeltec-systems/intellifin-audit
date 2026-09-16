import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { GATE_CHECKS } from '@intellifin/domain';
import type { RunListRow, RunStopFacts } from '@intellifin/infrastructure';

import { RecentRuns } from './RecentRuns';
import { FRESHNESS_ADVICE } from '../runs/stop-reason';

/**
 * Recent Runs on the Overview.
 *
 * EXPERIENCE.md fixes five columns for this table where the Runs register has ten, so the
 * column set is asserted rather than assumed: a sixth column here would be a product
 * decision taken sideways inside a bug fix.
 */

function row(overrides: Partial<RunListRow> = {}): RunListRow {
  return {
    runId: '019823ab-0000-7000-8000-000000000001',
    procedureId: '019823ab-0000-7000-8000-0000000000a1',
    procedureName: 'Terminated Users Retaining Access',
    versionNumber: 1,
    period: { from: '2026-08-01', to: '2026-08-31' },
    state: 'COMPLETED',
    kind: 'STANDARD',
    outcome: 'PASS',
    resultSealed: true,
    gateChecks: GATE_CHECKS.length,
    gateFailed: 0,
    initiatorId: 'auditor-1',
    initiatedAt: '2026-09-06T09:00:00.000Z',
    endedAt: '2026-09-06T09:03:41.000Z',
    change: { kind: 'compared', added: 2, resolved: 1 },
    ...overrides,
  };
}

const STALE_SNAPSHOT: RunStopFacts = {
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

const render = (
  rows: readonly RunListRow[],
  extra: { stops?: ReadonlyMap<string, RunStopFacts>; names?: ReadonlyMap<string, string> } = {},
): string =>
  renderToStaticMarkup(
    React.createElement(RecentRuns, {
      rows,
      stops: extra.stops ?? new Map(),
      names: extra.names ?? new Map(),
    }),
  );

describe('Recent Runs on the Overview', () => {
  it("shows the contract's five columns, in the contract's order", () => {
    const html = render([row()]);
    const headers = [...html.matchAll(/<th scope="col"[^>]*>([^<]*)</g)].map((match) => match[1]);
    expect(headers).toEqual(['Run', 'Procedure', 'Lifecycle', 'Result outcome', 'Gate']);
  });

  it('makes the Run cell the row header and its only Run link', () => {
    const html = render([row()]);
    expect(html).toContain('<th scope="row"');
    const links = [...html.matchAll(/<a [^>]*href="([^"]*)"/g)].map((match) => match[1]);
    expect(links).toEqual(['/runs/019823ab-0000-7000-8000-000000000001']);
  });

  it('says why a stopped Run stopped, under its outcome badge', () => {
    const stopped = row({ state: 'INCONCLUSIVE', outcome: 'INCONCLUSIVE', gateChecks: 0, period: STALE_SNAPSHOT.period });
    const html = render([stopped], { stops: new Map([[stopped.runId, STALE_SNAPSHOT]]) });
    expect(html).toContain('No conclusion issued');
    expect(html).toContain('The source snapshot was generated on 2026-09-01, before the period ended on 2026-09-15.');
    expect(html).toContain(FRESHNESS_ADVICE);
    expect(html).not.toContain('>freshness<');
  });

  it('names the initiator beside the Procedure, and the id only when no name is known', () => {
    const named = render([row()], { names: new Map([['auditor-1', 'Daniel Okonjo']]) });
    expect(named).toContain('Started by');
    expect(named).toContain('Daniel Okonjo');
    expect(named).not.toContain('>auditor-1<');
    expect(render([row()])).toContain('<span class="ls-mono">auditor-1</span>');
  });

  it('writes a state outside the vocabulary in words rather than throwing', () => {
    // `StatusBadge` throws on an unknown state, and on a server-rendered list that is a
    // 500 for every Run on the page.
    const html = render([row({ state: 'SOMETHING_ELSE' as never, outcome: 'ODD' as never })]);
    expect(html).toContain('SOMETHING_ELSE');
    expect(html).toContain('ODD');
  });

  it('says "No conclusion issued" for a Run with no Result and "Not evaluated" for no Gate', () => {
    const html = render([row({ state: 'QUEUED', outcome: null, resultSealed: null, gateChecks: 0, gateFailed: 0, endedAt: null })]);
    expect(html).toContain('No conclusion issued');
    expect(html).toContain('Not evaluated');
    expect(html).not.toContain('Passed');
  });

  it("renders the contract's empty state, and only when there is nothing to list", () => {
    const html = render([]);
    expect(html).toContain('No Runs yet.');
    expect(html).toContain('An empty Overview does not mean a control passed.');
    expect(html).not.toContain('<table');
    // And never beside rows: an empty state over a populated table is the defect this
    // page was repaired for, said the other way round.
    expect(render([row()])).not.toContain('An empty Overview does not mean a control passed.');
  });
});
