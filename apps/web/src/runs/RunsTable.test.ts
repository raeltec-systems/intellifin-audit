import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { GATE_CHECKS } from '@intellifin/domain';
import type { RunListRow, RunStopFacts } from '@intellifin/infrastructure';

import { RunsPagination, RunsTable, RunsTableSkeleton } from './RunsTable';
import { FRESHNESS_ADVICE } from './stop-reason';
import { RUNS_COLUMNS, RUNS_COLUMN_ORDER } from './runs-list-words';
import { STATUS_COLUMN_WORDS } from '../design/status-words';

/**
 * The Runs table's projection of the read model onto EXPERIENCE.md's ten columns.
 *
 * Rendered for real, server-side, because the properties under test are properties of the
 * MARKUP: which cell is a link, which value reaches which column, and what a cell says
 * when there is nothing to say. A test over the projection function alone would prove none
 * of them.
 */

const READ_AT = new Date('2026-09-06T10:00:00.000Z');

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

const render = (
  rows: readonly RunListRow[],
  extra: { stops?: ReadonlyMap<string, RunStopFacts>; names?: ReadonlyMap<string, string> } = {},
): string =>
  renderToStaticMarkup(
    React.createElement(RunsTable, {
      rows,
      readAt: READ_AT,
      stops: extra.stops ?? new Map(),
      names: extra.names ?? new Map(),
    }),
  );

/** The production case: a snapshot generated on the first, a period ending two weeks later. */
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

describe('the Runs table', () => {
  it("shows the contract's revised six columns, in the contract's order", () => {
    // `[REWRITTEN 2026-09-22, UX-17]` This asserted the OLD ten. EXPERIENCE.md's Data
    // tables row now reads "Runs: Run (the Procedure name, with the short reference and
    // the effective period beneath it) · Execution · Assessment · Evidence checks ·
    // Started (by whom, when, and elapsed) · Change", so the ten were the defect this
    // test would otherwise pin: at a laptop's width they scrolled the whole page sideways.
    const html = render([row()]);
    const headers = [...html.matchAll(/<th scope="col"[^>]*>([^<]*)</g)].map((match) => match[1]);
    expect(headers).toEqual(RUNS_COLUMN_ORDER.map((key) => RUNS_COLUMNS[key]));
    expect(headers).toEqual(['Run', 'Execution', 'Assessment', 'Evidence checks', 'Started', 'Change']);
    // The three status questions are the shared words, so the three families can never be
    // read as one thing.
    expect(headers).toContain(STATUS_COLUMN_WORDS.execution);
    expect(headers).toContain(STATUS_COLUMN_WORDS.assessment);
    expect(headers).toContain(STATUS_COLUMN_WORDS.evidenceChecks);
  });

  it('names the row by its Procedure, with the short reference and the period beneath it', () => {
    // UX-17 and UX-02: the first cell used to be the Run's own UUID — thirty-six
    // characters a reader cannot compare by eye, in the cell that should say what the Run
    // was about. Proven by mutation: put `row.runId` back as the label and this fails.
    const html = render([row()]);
    const header = /<th scope="row"[\s\S]*?<\/th>/.exec(html)![0];
    expect(header).toContain('>Terminated Users Retaining Access<');
    expect(header).not.toContain('>019823ab-0000-7000-8000-000000000001<');
    expect(header).not.toContain('ls-identifier');
    // The short reference is the LAST eight characters: a UUIDv7 begins with its
    // timestamp, so two Runs of one minute share their first eight.
    expect(header).toContain('Run <span class="ls-mono">00000001</span>');
    // And the effective period, readable rather than in the machine spelling.
    expect(header).toContain('1–31 Aug 2026');
    expect(header).not.toContain('2026-08-01 → 2026-08-31');
  });

  it('says in its caption that the Review column is absent until a Result can be reviewed', () => {
    // A column silently removed is a reader wondering where it went. The caption is read
    // by assistive technology before the rows.
    const html = render([row()]);
    expect(html).toContain('A Review column joins this table when a Result can be sent for review');
    expect(html).not.toContain('No Auditor Review has started.');
  });

  it('makes the Run cell the row header and the row\'s only link', () => {
    const html = render([row()]);
    expect(html).toContain('<th scope="row"');
    const links = [...html.matchAll(/<a [^>]*href="([^"]*)"/g)].map((match) => match[1]);
    expect(links).toEqual(['/runs/019823ab-0000-7000-8000-000000000001']);
  });

  it('says a Run still going has taken that long SO FAR', () => {
    // "took 1h 0m 0s" about a Run that has not finished would state an elapsed time as a
    // duration, which is a different fact.
    expect(render([row({ endedAt: null, state: 'RUNNING' })])).toContain('so far');
    expect(render([row()])).not.toContain('so far');
  });

  it('renders every badge with a word, never colour alone', () => {
    const html = render([row()]);
    for (const word of ['Completed', 'Pass', 'Passed']) expect(html).toContain(word);
    // Every badge carries an icon: the vocabulary supplies it, so a badge cannot be
    // written without one.
    expect(html.match(/<svg/g) ?? []).toHaveLength(3);
  });

  it('writes a state outside the vocabulary in words rather than throwing', () => {
    // `StatusBadge` throws on an unknown state, and on a server-rendered list that is a
    // 500 for every Run on the page. Rendering must survive a row this build cannot name.
    const html = render([row({ state: 'SOMETHING_ELSE' as never, outcome: 'ODD' as never })]);
    expect(html).toContain('SOMETHING_ELSE');
    expect(html).toContain('ODD');
  });

  it('says "No conclusion issued" for a Run with no Result, and "Not evaluated" for no Gate', () => {
    const html = render([row({ outcome: null, resultSealed: null, gateChecks: 0, gateFailed: 0, endedAt: null, state: 'QUEUED' })]);
    expect(html).toContain('No conclusion issued');
    expect(html).toContain('Not evaluated');
    expect(html).not.toContain('Passed');
  });

  it('measures Elapsed to the sealed Result, and to the read time while running', () => {
    expect(render([row()])).toContain('3m 41s');
    expect(render([row({ endedAt: null, state: 'RUNNING' })])).toContain('1h 0m 0s');
  });

  it('states the change, the incomparable case, and the absent case', () => {
    expect(render([row()])).toContain('2 new, 1 resolved');
    expect(render([row({ change: { kind: 'compared', added: 0, resolved: 0 } })])).toContain('No change');
    expect(render([row({ change: { kind: 'incomparable' } })])).toContain('Not comparable — versions differ');
    const absent = render([row({ change: { kind: 'absent' } })]);
    expect(absent).toContain('No comparable previous Run.');
  });

  it('says under the outcome badge why a stopped Run stopped, and nothing under one that concluded', () => {
    // A page of "Inconclusive · No conclusion issued" read as "all the runs failed" with
    // the reason only on the Timeline tab, as the code word `freshness`.
    const stopped = row({ state: 'INCONCLUSIVE', outcome: 'INCONCLUSIVE', gateChecks: 0, period: STALE_SNAPSHOT.period });
    const html = render([stopped], { stops: new Map([[stopped.runId, STALE_SNAPSHOT]]) });
    expect(html).toContain('No conclusion issued');
    expect(html).toContain('The source snapshot was generated on 2026-09-01, before the period ended on 2026-09-15.');
    expect(html).toContain(FRESHNESS_ADVICE);
    expect(html).not.toContain('>freshness<');
    // The facts of a Run that concluded produce no sentence even when they are supplied.
    const concluded = row();
    expect(render([concluded], { stops: new Map([[concluded.runId, { ...STALE_SNAPSHOT, state: 'COMPLETED' }]]) })).not.toContain('ls-stop-reason');
    // And a stopped Run whose facts were not read says nothing rather than something wrong.
    expect(render([stopped])).not.toContain('ls-stop-reason');
  });

  it("names the initiator, and shows the id in monospace only when no name is known", () => {
    const named = render([row()], { names: new Map([['auditor-1', 'Daniel Okonjo']]) });
    expect(named).toContain('Daniel Okonjo');
    expect(named).not.toContain('>auditor-1<');
    const unnamed = render([row()]);
    expect(unnamed).toContain('<span class="ls-mono">auditor-1</span>');
  });

  it('says when a Run started, readably, with the exact instant still in the markup', () => {
    // The Started cell is one event: who, when, and how long. The instant goes through
    // `Timestamp`, so a browser test and a screen reader can still read the exact value.
    const html = render([row()]);
    expect(html).toContain('6 Sep 2026, 09:00 UTC');
    expect(html).toContain('dateTime="2026-09-06T09:00:00.000Z"');
  });

  it('refuses to present an empty list as anything but an empty list', () => {
    const html = render([]);
    expect(html).toContain('No Runs yet.');
    expect(html).toContain('An empty list does not mean a control passed.');
    expect(html).not.toContain('<table');
  });
});

describe('the cold-load skeleton and the pagination', () => {
  it('announces loading in words and hides the decorative rows', () => {
    const html = renderToStaticMarkup(React.createElement(RunsTableSkeleton, { rows: 4 }));
    expect(html).toContain('role="status"');
    expect(html).toContain('Loading Runs.');
    expect(html).toContain('aria-hidden="true"');
    // The container class is `ls-skeleton__rows`, so the quote is part of the match.
    expect(html.match(/ls-skeleton__row"/g) ?? []).toHaveLength(4);
    // A prohibited accessible name is silently dropped and axe reports it as incomplete,
    // so the skeleton must not reach for one on a generic element.
    expect(html).not.toContain('aria-label');
  });

  it('offers plain links, and nothing at all on a single page', () => {
    expect(
      renderToStaticMarkup(
        React.createElement(RunsPagination, { next: null, firstHref: '/runs', onFirstPage: true }),
      ),
    ).toBe('');
    const html = renderToStaticMarkup(
      React.createElement(RunsPagination, { next: 'abc', firstHref: '/runs', onFirstPage: false }),
    );
    expect(html).toContain('href="/runs"');
    expect(html).toContain('href="/runs?after=abc"');
    expect(html).not.toContain('onclick');
  });
});
