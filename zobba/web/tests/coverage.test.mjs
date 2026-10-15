import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { completenessSentence, conclusionSentence, found, parseMembers, parsePopulation, parseSample, parseSummary, reconciliationSentence } from '../src/coverage.ts';

// The AC1/AC2 numbers of `fixtures/documents/AP population expected.json`.
const expected = JSON.parse(readFileSync(new URL('../../fixtures/documents/AP population expected.json', import.meta.url), 'utf8'));
const counts = {
  received_rows: '1256', unkeyed: '0', duplicate_rows: '6', distinct_subjects: '1250', excluded_out_of_period: '50',
  scope_unknown_period_unparsed: '0', scope_unknown_period_missing: '0', scope_unknown_conflicting_duplicate: '0', in_scope: '1200',
};
const population = {
  id: 'pop-1', invocation_id: 'inv-a', basis_id: 'basis-1', key: 'ap', supersedes: null, original_id: 'ap-population',
  original_sha256: 'a'.repeat(64), filename: 'AP population.xlsx', sheet: 'Invoices', header_row: 3, subject_unit: 'invoice',
  grain: ['Invoice'], period_column: 'Invoice date', period_rule: 'date_dmy',
  values: [{ header: 'Amount', name: 'amount', fact_type: 'decimal', rule: 'decimal_grouped_comma', measure: 'USD', measure_column: 'Currency' }],
  exhaustive: true, selection: 'Every invoice of 2026', declared_count: null, control_source: null, job_id: 'job-1',
  last_row: 1259, rows_read: 1256, truncated: false, completeness: 'complete', incomplete_reason: null, reconciliation: 'not_declared',
  counts, methodology_binding_id: 'binding-a', execution_epoch: '1',
};
const criterion = (id, notMet) => ({
  criterion_id: id, applicable: '1000', not_applicable: '200', applicability_unknown: '0', met: String(1000 - notMet - 10), not_met: String(notMet),
  undetermined: '10', undetermined_by_reason: [{ reason: 'missing_fact', count: '10' }], execution_failed: '0', not_evaluated: '0',
});
const summary = {
  id: 'sum-1', invocation_id: 'inv-a', basis_id: 'basis-1', population_id: 'pop-1', sample_id: null, aggregation: 'subject_partition_v1',
  conclusion: 'exceptions_found_inconclusive', completeness: 'complete', incomplete_reason: null, reconciliation: 'not_declared', declared_count: null,
  counts, selected: null, criteria: [criterion('crit-a', 15), criterion('crit-b', 12)],
  failing_subjects: '20', meets_every_applicable: '960', unresolved_subjects: '20', not_applicable_to_any: '200', failing_opportunities: '27',
  statistical_inference: false, limitations: [], summary_sha256: 'b'.repeat(64), methodology_binding_id: 'binding-a', execution_epoch: '1',
};
const sample = {
  id: 'sample-1', invocation_id: 'inv-a', population_id: 'pop-1', key: 's1', method: 'seeded_random', seed: '42', algorithm: 'splitmix64-fisher-yates-v1',
  size: 25, strata: '', justification: 'Random selection for testing', selected_count: '25', keys_withheld: false, keys: [], substitutions: [],
  statistical_inference: false, methodology_binding_id: 'binding-a', execution_epoch: '1',
};

test('the fixture numbers are the ones the matrix names', () => {
  assert.equal(expected.received_rows, 1256);
  assert.equal(expected.failing_opportunities, 27);
  assert.equal(expected.conclusion, 'exceptions_found_inconclusive');
});

test('population, sample and summary records are strictly parsed', () => {
  assert.deepEqual(parsePopulation(population), population);
  assert.deepEqual(parseSummary(summary), summary);
  assert.deepEqual(parseSample(sample), sample);
});

test('each structural rule refuses exactly its own defect', () => {
  const cases = {
    'an unknown field (a percentage)': [parseSummary, { ...summary, percent_failing: '1.7' }],
    'a confidence score': [parsePopulation, { ...population, confidence: 0.9 }],
    'a numeric count': [parseSummary, { ...summary, failing_subjects: 20 }],
    'a partition that does not cover the in-scope items': [parseSummary, { ...summary, meets_every_applicable: '959' }],
    'failing opportunities that are not the not-met counts': [parseSummary, { ...summary, failing_opportunities: '20' }],
    'more failing items than failing opportunities': [parseSummary, { ...summary, failing_subjects: '28', meets_every_applicable: '952' }],
    'an applicable count that is not its outcomes': [parseSummary, { ...summary, criteria: [{ ...criterion('crit-a', 15), met: '976' }, criterion('crit-b', 12)] }],
    'undetermined reasons that do not add up': [parseSummary, { ...summary, criteria: [{ ...criterion('crit-a', 15), undetermined_by_reason: [] }, criterion('crit-b', 12)] }],
    'a pass on an incomplete population': [parseSummary, { ...summary, conclusion: 'no_exception_found', completeness: 'incomplete', incomplete_reason: 'not_exhaustive', criteria: [], failing_subjects: '0', unresolved_subjects: '0', failing_opportunities: '0', meets_every_applicable: '1000' }],
    'a pass on a sample': [parseSummary, { ...summary, conclusion: 'no_exception_found', sample_id: 'sample-1', selected: '25', criteria: [], failing_subjects: '0', unresolved_subjects: '0', failing_opportunities: '0', meets_every_applicable: '25', not_applicable_to_any: '0' }],
    'a pass with zero applicable': [parseSummary, { ...summary, conclusion: 'no_exception_found', criteria: [], failing_subjects: '0', unresolved_subjects: '0', failing_opportunities: '0', meets_every_applicable: '0', not_applicable_to_any: '1200' }],
    'exceptions with no failing item': [parseSummary, { ...summary, conclusion: 'exceptions_found', criteria: [], failing_subjects: '0', failing_opportunities: '0', meets_every_applicable: '980' }],
    'statistical inference': [parseSummary, { ...summary, statistical_inference: true }],
    'a sample summary without its selected count': [parseSummary, { ...summary, sample_id: 'sample-1' }],
    'rows that are not exactly their dispositions': [parsePopulation, { ...population, counts: { ...counts, in_scope: '1199' } }],
    'complete without the exhaustive statement': [parsePopulation, { ...population, exhaustive: false }],
    'complete with its reason': [parsePopulation, { ...population, incomplete_reason: 'row_bound' }],
    'a declared count without its cited source': [parsePopulation, { ...population, declared_count: '1250', reconciliation: 'matched' }],
    'a seeded sample without its seed': [parseSample, { ...sample, seed: null }],
    'a sample whose selection is not its size': [parseSample, { ...sample, selected_count: '24' }],
    'withheld keys that are shown': [parseSample, { ...sample, keys_withheld: true, keys: ['INV-0001'] }],
    'sample inference': [parseSample, { ...sample, statistical_inference: true }],
  };
  for (const [name, [parse, value]] of Object.entries(cases)) {
    assert.throws(() => parse(value), /Invalid (assessment|conversation) response/, name);
  }
});

const member = (ordinal, change = {}) => ({ ordinal, row: ordinal + 4, subject: `INV-${ordinal}`, disposition: 'excluded', reason: 'out_of_period', duplicate_of: null, cells: [{ column: 'Invoice', text: `INV-${ordinal}`, location: `Invoices!A${ordinal + 4}` }], values: [], ...change });
const page = { population, disposition: 'excluded', total: '50', values_withheld: false, members: [member(0), member(1)], next_cursor: '1' };

test('a member page is an exact count, its filter and withheld values', () => {
  assert.deepEqual(parseMembers(page, 'pop-1', 'excluded'), page);
  const hidden = { ...page, values_withheld: true, members: [member(0, { subject: null, cells: [{ column: 'Invoice', text: null, location: 'Invoices!A4' }] })] };
  assert.deepEqual(parseMembers(hidden, 'pop-1', 'excluded'), hidden);
  assert.throws(() => parseMembers({ ...hidden, members: [member(0)] }, 'pop-1', 'excluded'), /Invalid/, 'withheld values that are shown');
  assert.throws(() => parseMembers({ ...page, members: [member(0, { disposition: 'in_scope', reason: null })] }, 'pop-1', 'excluded'), /Invalid/, 'a row outside the filter');
  assert.throws(() => parseMembers({ ...page, total: '1' }, 'pop-1', 'excluded'), /Invalid/, 'a total below the rows shown');
  assert.throws(() => parseMembers(page, 'pop-2', 'excluded'), /Invalid/, 'another population');
  assert.throws(() => parseMembers({ ...page, members: [member(0, { reason: 'period_missing' })] }, 'pop-1', 'excluded'), /Invalid/, 'an exclusion that is not out of period');
});

test('words: lower bounds, unknown totals, no percentages, no pass on zero applicable', () => {
  assert.equal(found('1200', 'invoice', true), '1,200 invoices');
  assert.equal(found('0', 'row', false), 'at least 0 rows found');
  assert.equal(completenessSentence({ completeness: 'incomplete', incomplete_reason: 'not_exhaustive' }),
    'Incomplete: the source was declared not exhaustive (for example a search or filtered export). The total is not known.');
  assert.match(reconciliationSentence({ reconciliation: 'mismatch', declared_count: '1251', counts }), /1,251; 1,250 distinct/);
  assert.equal(conclusionSentence({ ...summary, conclusion: 'no_eligible_items' }), 'No eligible items; operating effectiveness was not demonstrated.');
  assert.equal(conclusionSentence({ ...summary, conclusion: 'no_items_found_absence_not_proven' }), 'No items found; absence is not proven.');
  const sampled = conclusionSentence({ ...summary, sample_id: 'sample-1', conclusion: 'inconclusive' });
  assert.match(sampled, /selected items only/);
  assert.doesNotMatch(sampled, /no exception found/i);
  for (const conclusion of ['no_eligible_items', 'exceptions_found', 'exceptions_found_inconclusive', 'inconclusive', 'no_items_found_absence_not_proven']) {
    assert.doesNotMatch(conclusionSentence({ ...summary, conclusion }), /%|pass|no exception found/i, conclusion);
  }
});
