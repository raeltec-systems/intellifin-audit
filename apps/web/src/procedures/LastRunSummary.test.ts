import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { GATE_CHECKS } from '@intellifin/domain';
import type { ProcedureLastRun, RunStopFacts } from '@intellifin/infrastructure';

import { LastRunSummary } from './LastRunSummary';
import {
  LAST_RUN_ENDED,
  LAST_RUN_NOT_VISIBLE,
  LAST_RUN_STARTED,
  NO_RUN_YET,
  lastRunTiming,
} from './last-run-words';
import { FRESHNESS_ADVICE } from '../runs/stop-reason';

/**
 * The Procedure card's Last outcome cell (owner finding RUN-05).
 *
 * The defect: every card said "No outcome" beside "No Runs yet", so a Run Failed Run and a
 * Procedure nobody had ever run looked identical. The three statements this cell has to be
 * able to make are three tests.
 */

const RUN_ID = '019823ab-0000-7000-8000-000000000001';

function run(overrides: Partial<ProcedureLastRun> = {}): ProcedureLastRun {
  return {
    procedureId: '019823ab-0000-7000-8000-0000000000a1',
    runId: RUN_ID,
    state: 'COMPLETED',
    kind: 'STANDARD',
    initiatedAt: '2026-09-15T09:00:00.000Z',
    endedAt: '2026-09-15T09:03:41.000Z',
    outcome: 'PASS',
    gateChecks: GATE_CHECKS.length,
    gateFailed: 0,
    ...overrides,
  };
}

const STALE_SNAPSHOT: RunStopFacts = {
  runId: RUN_ID,
  state: 'INCONCLUSIVE',
  initiatedAt: '2026-09-15T09:00:00.000Z',
  period: { from: '2026-09-01', to: '2026-09-15' },
  stop: { stage: 'population', diagnostic: 'freshness' },
  timedOutWait: null,
  snapshotGeneratedAt: '2026-09-01T00:00:00.000Z',
  gateChecks: 0,
  gateFailed: 0,
  outcomeRow: 'gate-failed',
};

const render = (
  value: ProcedureLastRun | null,
  facts: RunStopFacts | null = null,
  visible = true,
): string => renderToStaticMarkup(React.createElement(LastRunSummary, { run: value, facts, visible }));

describe('the Procedure card last-Run cell', () => {
  it('says no Run has been started when there is none — never "No outcome"', () => {
    const html = render(null);
    expect(html).toContain(NO_RUN_YET);
    expect(html).not.toContain('No outcome');
    expect(html).not.toContain('No Runs yet');
  });

  it('shows the outcome, when it ended and its lifecycle, with a way onward', () => {
    const html = render(run());
    expect(html).toContain('Pass');
    expect(html).toContain('Completed');
    expect(html).toContain(LAST_RUN_ENDED);
    expect(html).toContain('2026-09-15T09:03:41.000Z');
    expect(html).toContain(`href="/runs/${RUN_ID}"`);
  });

  it('distinguishes no conclusion from no execution, and says why it stopped', () => {
    // The finding: "Ran on <date> · Run Failed: <reason>", never "No outcome".
    const html = render(run({ state: 'RUN_FAILED', outcome: 'RUN_FAILED', gateChecks: 0 }), STALE_SNAPSHOT);
    expect(html).toContain('No conclusion issued');
    expect(html).toContain('Run Failed');
    expect(html).toContain('The source snapshot was generated on 2026-09-01, before the period ended on 2026-09-15.');
    expect(html).toContain(FRESHNESS_ADVICE);
    expect(html).not.toContain(NO_RUN_YET);
    expect(html).not.toContain('No outcome');
  });

  it('says when an in-flight Run STARTED, because it has no end yet', () => {
    const html = render(run({ state: 'RUNNING', outcome: null, endedAt: null, gateChecks: 0 }));
    expect(html).toContain(LAST_RUN_STARTED);
    expect(html).toContain('2026-09-15T09:00:00.000Z');
    expect(html).toContain('Running');
    expect(html).toContain('No conclusion issued');
    expect(html).not.toContain(LAST_RUN_ENDED);
  });

  it('writes a state outside the vocabulary in words rather than throwing', () => {
    // `StatusBadge` throws on an unknown state; on this list that is a 500 for every card.
    const html = render(run({ state: 'SOMETHING_ELSE' as never, outcome: 'ODD' as never }));
    expect(html).toContain('SOMETHING_ELSE');
    expect(html).toContain('ODD');
  });

  it('says a role that may not see Runs is not being shown one, and shows nothing else', () => {
    // The Runs register is gated on `run.initiate` and this list is not. "No Run has been
    // started." would be a claim the page has no basis for — it read nothing — and the
    // outcome would be what `/runs` refuses that role.
    const html = render(run({ state: 'RUN_FAILED', outcome: 'RUN_FAILED' }), STALE_SNAPSHOT, false);
    expect(html).toContain(LAST_RUN_NOT_VISIBLE);
    expect(html).not.toContain(NO_RUN_YET);
    expect(html).not.toContain('Run Failed');
    expect(html).not.toContain(RUN_ID);
    expect(html).not.toContain(FRESHNESS_ADVICE);
  });

  it('keeps the stop reason out of a Run that concluded', () => {
    expect(render(run(), { ...STALE_SNAPSHOT, state: 'COMPLETED' })).not.toContain('ls-stop-reason');
  });
});

describe('which instant the card shows', () => {
  it('is the end for a terminal Run and the start for one still in flight', () => {
    expect(lastRunTiming(run())).toEqual({ word: LAST_RUN_ENDED, at: '2026-09-15T09:03:41.000Z' });
    expect(lastRunTiming(run({ state: 'QUEUED', endedAt: null }))).toEqual({
      word: LAST_RUN_STARTED,
      at: '2026-09-15T09:00:00.000Z',
    });
  });

  it('falls back to the start rather than inventing an end that was never recorded', () => {
    expect(lastRunTiming(run({ state: 'CANCELED', endedAt: null }))).toEqual({
      word: LAST_RUN_STARTED,
      at: '2026-09-15T09:00:00.000Z',
    });
  });
});
