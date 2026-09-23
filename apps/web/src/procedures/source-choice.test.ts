import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { InclusionPredicate } from '@intellifin/domain';

import { SOURCE_KIND_WORDS } from '../design/plain-words';
import { SourceChooser } from './SourceChooser';
import { FILTERS_DO_NOT_FIT, missingFieldsSentence, rankSources, requiredSourceFields, sourceChoiceDescription, type ChoosableSource } from './source-choice';

/**
 * UX-11: the evidence-source chooser. Suggested first by the FIELDS the procedure needs,
 * never by a name; every row says how its records arrive, its fields in words, and what it
 * lacks; a row whose fields the saved filters cannot use withholds Choose with a reason.
 */
const leavers: ChoosableSource = { bindingId: 'b1', displayName: 'Leavers export', kind: 'versioned-file', digest: 'd'.repeat(64),
  declaredSchema: ['employee_id', 'full_name', 'employment_status', 'termination_effective_date'] };
const hrApi: ChoosableSource = { bindingId: 'b2', displayName: 'HR service', kind: 'read-only-api', digest: 'e'.repeat(64),
  declaredSchema: ['employee_id', 'full_name', 'employment_status'] };
const accounts: ChoosableSource = { bindingId: 'b3', displayName: 'AccessGate accounts', kind: 'manual-upload', digest: 'f'.repeat(64),
  declaredSchema: ['account_id', 'username'] };
const p1Filters: InclusionPredicate[] = [
  { column: 'employment_status', kind: 'text', operator: 'eq', value: 'Terminated' },
  { column: 'termination_effective_date', kind: 'within-period' },
];

describe('the evidence-source chooser (UX-11)', () => {
  it('requires the Template lookup fields and the saved filter fields, each once', () => {
    expect(requiredSourceFields('P-1', p1Filters)).toEqual(['employee_id', 'full_name', 'employment_status', 'termination_effective_date']);
    expect(requiredSourceFields('P-2', [])).toEqual(['account_id']);
  });

  it('suggests the sources that declare every required field, and names what the others lack in words', () => {
    const ranked = rankSources([accounts, hrApi, leavers], 'P-1', p1Filters);
    expect(ranked.suggested.map((choice) => choice.displayName)).toEqual(['Leavers export']);
    expect(ranked.other.map((choice) => choice.displayName)).toEqual(['AccessGate accounts', 'HR service']);
    const hr = ranked.other.find((choice) => choice.bindingId === 'b2')!;
    expect(missingFieldsSentence(hr.missing)).toBe('Missing: termination effective date');
    expect(hr.filtersFit).toBe(false);
    expect(ranked.suggested[0]!.fields).toContain('termination effective date');
    expect(ranked.suggested[0]!.arrives).toBe(SOURCE_KIND_WORDS['versioned-file'].label);
  });

  it('filters by name, by how records arrive and by field words', () => {
    expect(rankSources([accounts, hrApi, leavers], 'P-1', p1Filters, 'termination').suggested.map((c) => c.bindingId)).toEqual(['b1']);
    expect(rankSources([accounts, hrApi, leavers], 'P-1', p1Filters, 'read-only service').other.map((c) => c.bindingId)).toEqual(['b2']);
    expect(rankSources([accounts, hrApi, leavers], 'P-1', p1Filters, 'nothing like this').other).toEqual([]);
  });

  it('renders one row per source with a Choose control, and withholds it with a reason when the filters cannot be kept', () => {
    const html = renderToStaticMarkup(React.createElement(SourceChooser, { sources: [accounts, hrApi, leavers], templateId: 'P-1', predicates: p1Filters,
      selectedBindingId: null, busy: false, onChoose: async () => ({ ok: true, message: 'saved' }) }));
    expect(html).toContain('Suited to this procedure');
    expect(html).toContain('Other sources');
    expect(html).toContain('Missing: termination effective date');
    expect(html).toContain('Choose<span class="ls-visually-hidden"> Leavers export</span>');
    expect(html).toContain(FILTERS_DO_NOT_FIT);
    // Field names are said in words, never as stored column names.
    expect(html).not.toContain('termination_effective_date');
    expect(html).toContain('3 sources set up for this institution.');
  });

  it('marks the saved source as chosen instead of offering it again', () => {
    const html = renderToStaticMarkup(React.createElement(SourceChooser, { sources: [leavers], templateId: 'P-1', predicates: p1Filters,
      selectedBindingId: 'b1', busy: false, onChoose: async () => ({ ok: true, message: 'saved' }) }));
    expect(html).toContain('data-source-chosen');
    expect(html).not.toContain('Choose<span');
  });

  it('gives the chat the same words as the row', () => {
    const [choice] = rankSources([hrApi], 'P-1', p1Filters).other;
    expect(sourceChoiceDescription(choice!)).toBe('A read-only service. Provides employee id, full name, employment status. Missing: termination effective date. Existing record filters are retained.');
  });

  it('says in words that no source exists rather than rendering an empty list', () => {
    const html = renderToStaticMarkup(React.createElement(SourceChooser, { sources: [], templateId: 'P-1', predicates: [],
      selectedBindingId: null, busy: false, onChoose: async () => ({ ok: true, message: 'saved' }) }));
    expect(html).toContain('No sources are available yet.');
  });
});
