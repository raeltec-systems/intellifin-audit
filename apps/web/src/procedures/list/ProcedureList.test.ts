import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { ProcedureLastRun, ProcedureListRow, ProcedureOwner } from '@intellifin/infrastructure';

import { PROCEDURE_CARD_ABSENT } from '../../design/copy';
import { NEXT_RUN_MANUAL, NO_RUN_YET, LAST_RUN_NOT_VISIBLE } from '../last-run-words';
import { ProcedureCard } from './ProcedureCard';
import { ProcedureFilters } from './ProcedureFilters';
import { CLEAR_FILTERS, FILTER_KEYS, plannedFrequencySentence } from './procedures-list-words';

/**
 * One Procedure card and the list's filters (UI cleanup 2026-09-22, UX-03 and UX-04).
 *
 * The findings: a card that repeated the same two absent sentences on every row, and a
 * list a person could not narrow at all.
 */

function row(overrides: Partial<ProcedureListRow> = {}): ProcedureListRow {
  return {
    procedureId: '019823ab-0000-7000-8000-0000000000f1',
    controlName: 'Terminated Users Retaining Access',
    templateId: 'P-1',
    activeVersionState: 'ACTIVE',
    activeVersionNumber: 3,
    latestVersionState: 'DRAFT',
    latestVersionNumber: 4,
    plannedFrequency: 'weekly',
    ownerId: 'auditor-1',
    updatedAt: '2026-09-20T08:30:00.000Z',
    ...overrides,
  };
}

const LAST_RUN: ProcedureLastRun = {
  runId: '019823ab-0000-7000-8000-000000000001',
  procedureId: '019823ab-0000-7000-8000-0000000000f1',
  kind: 'STANDARD',
  state: 'COMPLETED',
  outcome: 'PASS',
  initiatedAt: '2026-09-06T09:00:00.000Z',
  endedAt: '2026-09-06T09:03:41.000Z',
  gateChecks: 20,
  gateFailed: 0,
};

const card = (
  overrides: Partial<ProcedureListRow> = {},
  extra: { lastRun?: ProcedureLastRun | null; runsVisible?: boolean } = {},
): string =>
  renderToStaticMarkup(
    React.createElement(ProcedureCard, {
      row: row(overrides),
      lastRun: extra.lastRun === undefined ? LAST_RUN : extra.lastRun,
      stop: null,
      runsVisible: extra.runsVisible ?? true,
      absent: PROCEDURE_CARD_ABSENT,
      names: new Map([['auditor-1', 'Daniel Okonjo']]),
    }),
  );

describe('a Procedure card', () => {
  it('keeps "Active version" meaning ACTIVE, and names the newest version separately', () => {
    // Story 2.1's repair: the cell printed "Active version: Draft" for every Procedure in
    // the product. The two facts answer two different questions and are two cells.
    const html = card();
    expect(html).toContain('v3');
    expect(html).toContain('Draft');
    expect(html).toContain('v4');
    const noActive = card({ activeVersionState: null, activeVersionNumber: null });
    expect(noActive).toContain(PROCEDURE_CARD_ABSENT.activeVersion);
    expect(noActive).not.toContain('Active version: Draft');
  });

  it('says which frequency the Active version PLANS, never that it will run', () => {
    expect(card()).toContain(plannedFrequencySentence('weekly'));
    // And the availability sentence is NOT repeated on the card: the list says it once.
    expect(card()).not.toContain(NEXT_RUN_MANUAL);
    expect(card({ plannedFrequency: null })).toContain(PROCEDURE_CARD_ABSENT.schedule);
  });

  it('names the person accountable, and says so when nobody is recorded', () => {
    expect(card()).toContain('Daniel Okonjo');
    expect(card()).not.toContain('>auditor-1<');
    expect(card({ ownerId: null })).toContain('No author is recorded on the newest version.');
  });

  it('tells a Run that concluded from a Procedure that never ran, and from one not shown', () => {
    // Three different statements, never one — `LastRunSummary`'s rule, rendered here with
    // a readable instant instead of the raw ISO one.
    const ran = card();
    expect(ran).toContain('Pass');
    expect(ran).toContain('6 Sep 2026, 09:03 UTC');
    expect(ran).toContain('dateTime="2026-09-06T09:03:41.000Z"');
    expect(card({}, { lastRun: null })).toContain(NO_RUN_YET);
    expect(card({}, { runsVisible: false })).toContain(LAST_RUN_NOT_VISIBLE);
    // Not reading is the control: the cell says which of the two is happening.
    expect(card({}, { runsVisible: false })).not.toContain(NO_RUN_YET);
  });

  it('never prints an ISO instant as visible text', () => {
    expect(card()).not.toContain('>2026-09-06T09:03:41.000Z<');
  });
});

describe('the Procedures filters', () => {
  const owners: readonly ProcedureOwner[] = [{ userId: 'auditor-1', procedures: 3 }];
  const names = new Map([['auditor-1', 'Daniel Okonjo']]);

  const filters = (search = '', states: readonly string[] = [], ownerId = ''): string =>
    renderToStaticMarkup(
      React.createElement(ProcedureFilters, { search, states, ownerId, owners, names }),
    );

  it('is a GET form that declares itself a read-only filter', () => {
    // The ONE exception to the POST rule, and it has to CLAIM it: an unmarked GET form is
    // still refused by `form-method.test.ts`.
    const html = filters();
    expect(html).toContain('method="get"');
    expect(html).toContain('data-readonly-filter="true"');
    expect(html).toContain('action="/procedures"');
  });

  it('labels every control, and needs no JavaScript to submit', () => {
    const html = filters();
    for (const id of ['procedures-search', 'procedures-state', 'procedures-owner']) {
      expect(html).toContain(`for="${id}"`);
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain('type="submit"');
    for (const key of Object.values(FILTER_KEYS).filter((key) => key !== 'page')) {
      expect(html).toContain(`name="${key}"`);
    }
  });

  it('names the owner rather than printing an identifier at a reader', () => {
    expect(filters()).toContain('>Daniel Okonjo<');
  });

  it('keeps what was typed, and offers Clear only when something is filtering', () => {
    const html = filters('leavers', ['DRAFT'], 'auditor-1');
    expect(html).toContain('value="leavers"');
    expect(html).toContain('<option value="DRAFT" selected="">');
    expect(html).toContain('<option value="auditor-1" selected="">');
    expect(html).toContain(CLEAR_FILTERS);
    // Clear is a LINK to the unfiltered page: a reset would restore the filter.
    expect(html).toContain('href="/procedures"');
    expect(filters()).not.toContain(CLEAR_FILTERS);
  });
});
