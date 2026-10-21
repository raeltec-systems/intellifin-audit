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
  last_row: 1259, rows_read: 1256, truncated: false, naive_date_times: '0', completeness: 'complete', incomplete_reason: null, reconciliation: 'not_declared',
  counts, methodology_binding_id: 'binding-a', execution_epoch: '1',
};
const criterion = (id, notMet) => ({
  criterion_id: id, applicable: '1000', not_applicable: '200', applicability_unknown: '0', met: String(1000 - notMet - 10), not_met: String(notMet),
  undetermined: '10', undetermined_by_reason: [{ reason: 'missing_fact', count: '10' }], execution_failed: '0', not_evaluated: '0', met_unreviewed: '0',
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
  // A clean complete population summary that concludes "no exception found".
  const clean = { ...summary, conclusion: 'no_exception_found', criteria: [{ ...criterion('crit-a', 0), met: '1000', undetermined: '0', undetermined_by_reason: [] }],
    failing_subjects: '0', unresolved_subjects: '0', failing_opportunities: '0', meets_every_applicable: '1000', not_applicable_to_any: '200' };
  assert.deepEqual(parseSummary(clean), clean);
  const sampled = { ...summary, sample_id: 'sample-1', selected: '25', conclusion: 'inconclusive', criteria: [{ ...criterion('crit-a', 0), applicable: '25', not_applicable: '0', met: '25', undetermined: '0', undetermined_by_reason: [] }],
    failing_subjects: '0', unresolved_subjects: '0', failing_opportunities: '0', meets_every_applicable: '25', not_applicable_to_any: '0' };
  assert.deepEqual(parseSummary(sampled), sampled);
  const incomplete = { ...population, exhaustive: false, completeness: 'incomplete', incomplete_reason: 'not_exhaustive' };
  assert.deepEqual(parsePopulation(incomplete), incomplete);
  // A conflicting key holds at least two rows, each scope unknown.
  const conflicting = { ...counts, received_rows: '1258', scope_unknown_conflicting_duplicate: '1', distinct_subjects: '1251' };
  assert.deepEqual(parsePopulation({ ...population, counts: conflicting }).counts, conflicting);
  const limitation = { code: 'unreviewed_model_judgments', criterion_id: 'crit-a', count: '3', text: 'Judgment criterion crit-a: 3 met verdicts are model proposals nobody has reviewed; they cannot show that no exception exists.' };
  assert.deepEqual(parseSummary({ ...summary, limitations: [limitation] }).limitations, [limitation]);
  const cases = {
    'an unknown field (a percentage)': [parseSummary, { ...summary, percent_failing: '1.7' }],
    'a confidence score': [parsePopulation, { ...population, confidence: 0.9 }],
    'a numeric count': [parseSummary, { ...summary, failing_subjects: 20 }],
    'a partition that does not cover the in-scope items': [parseSummary, { ...summary, meets_every_applicable: '959' }],
    'failing opportunities that are not the not-met counts': [parseSummary, { ...summary, failing_opportunities: '20' }],
    'more failing items than failing opportunities': [parseSummary, { ...summary, failing_subjects: '28', meets_every_applicable: '952' }],
    'an applicable count that is not its outcomes': [parseSummary, { ...summary, criteria: [{ ...criterion('crit-a', 15), met: '976' }, criterion('crit-b', 12)] }],
    'undetermined reasons that do not add up': [parseSummary, { ...summary, criteria: [{ ...criterion('crit-a', 15), undetermined_by_reason: [] }, criterion('crit-b', 12)] }],
    'more unreviewed proposals than met': [parseSummary, { ...summary, criteria: [{ ...criterion('crit-a', 15), met_unreviewed: '976' }, criterion('crit-b', 12)] }],
    'a pass on an incomplete population': [parseSummary, { ...clean, completeness: 'incomplete', incomplete_reason: 'not_exhaustive' }],
    'a pass on a sample': [parseSummary, { ...sampled, conclusion: 'no_exception_found' }],
    'a pass with zero applicable': [parseSummary, { ...clean, meets_every_applicable: '0', not_applicable_to_any: '1200' }],
    'a pass with an unreviewed model proposal': [parseSummary, { ...clean, criteria: [{ ...clean.criteria[0], met_unreviewed: '1' }] }],
    'a pass over a row with no key': [parseSummary, { ...clean, counts: { ...counts, received_rows: '1257', unkeyed: '1' } }],
    'a pass over a subject of unknown scope': [parseSummary, { ...clean, counts: { ...counts, received_rows: '1257', distinct_subjects: '1251', scope_unknown_period_missing: '1' } }],
    'a pass with an unresolved item': [parseSummary, { ...clean, unresolved_subjects: '1', meets_every_applicable: '999' }],
    'exceptions with no failing item': [parseSummary, { ...clean, conclusion: 'exceptions_found' }],
    'exceptions found (not inconclusive) with an unresolved item': [parseSummary, { ...summary, conclusion: 'exceptions_found' }],
    'no eligible items on an incomplete population': [parseSummary, { ...clean, conclusion: 'no_eligible_items', meets_every_applicable: '0', not_applicable_to_any: '1200', completeness: 'incomplete', incomplete_reason: 'not_exhaustive' }],
    'no eligible items with a failing item': [parseSummary, { ...summary, conclusion: 'no_eligible_items' }],
    'absence not proven on a complete population': [parseSummary, { ...clean, conclusion: 'no_items_found_absence_not_proven' }],
    'statistical inference': [parseSummary, { ...summary, statistical_inference: true }],
    'a sample summary without its selected count': [parseSummary, { ...summary, sample_id: 'sample-1' }],
    'a summary complete with a reason': [parseSummary, { ...summary, incomplete_reason: 'row_bound' }],
    'a summary reconciled with no declared count': [parseSummary, { ...summary, reconciliation: 'matched' }],
    'a limitation of an unknown code': [parseSummary, { ...summary, limitations: [{ ...limitation, code: 'percent' }] }],
    'a per-criterion limitation with no criterion': [parseSummary, { ...summary, limitations: [{ ...limitation, criterion_id: null }] }],
    'a limitation as bare text': [parseSummary, { ...summary, limitations: ['3 unreviewed'] }],
    'subjects that are not their dispositions': [parsePopulation, { ...population, counts: { ...counts, in_scope: '1199' } }],
    'dispositions covering more rows than received': [parsePopulation, { ...population, counts: { ...counts, received_rows: '1255' } }],
    'a conflicting key counted on one row': [parsePopulation, { ...population, counts: { ...counts, received_rows: '1257', scope_unknown_conflicting_duplicate: '1', distinct_subjects: '1251' } }],
    'complete without the exhaustive statement': [parsePopulation, { ...population, exhaustive: false, incomplete_reason: null }],
    'not exhaustive with another reason': [parsePopulation, { ...incomplete, incomplete_reason: 'row_bound' }],
    'complete after a truncated read': [parsePopulation, { ...population, truncated: true }],
    'complete with its reason': [parsePopulation, { ...population, incomplete_reason: 'row_bound' }],
    'a declared count without its cited source': [parsePopulation, { ...population, declared_count: '1250', reconciliation: 'matched' }],
    'not declared with a declared count': [parsePopulation, { ...population, declared_count: '1250', control_source: null }],
    'a period column without a rule': [parsePopulation, { ...population, period_rule: null }],
    'an empty grain': [parsePopulation, { ...population, grain: [] }],
    'a naive date-time count that is a number': [parsePopulation, { ...population, naive_date_times: 0 }],
    'a seeded sample without its seed': [parseSample, { ...sample, seed: null, algorithm: null }],
    'a seed without its algorithm': [parseSample, { ...sample, algorithm: null }],
    'a judgmental sample with a seed': [parseSample, { ...sample, method: 'judgmental' }],
    'a sample whose selection is not its size': [parseSample, { ...sample, selected_count: '24' }],
    'withheld keys that are shown': [parseSample, { ...sample, keys_withheld: true, keys: ['INV-0001'] }],
    'sample inference': [parseSample, { ...sample, statistical_inference: true }],
  };
  for (const [name, [parse, value]] of Object.entries(cases)) {
    assert.throws(() => parse(value), /Invalid (assessment|conversation) response/, name);
  }
});

const member = (ordinal, change = {}) => ({ ordinal, row: ordinal + 4, subject: `INV-${ordinal}`, disposition: 'excluded', reason: 'out_of_period', duplicate_of: null, cells: [{ column: 'Invoice', text: `INV-${ordinal}`, location: `Invoices!A${ordinal + 4}`, kind: 'text' }], values: [], ...change });
const page = { population, disposition: 'excluded', total: '50', values_withheld: false, members: [member(0), member(1)], next_cursor: '1' };

test('a member page is an exact count, its filter and withheld values', () => {
  assert.deepEqual(parseMembers(page, 'pop-1', 'excluded'), page);
  const hidden = { ...page, values_withheld: true, members: [member(0, { subject: null, cells: [{ column: 'Invoice', text: null, location: 'Invoices!A4', kind: 'text' }] })] };
  assert.deepEqual(parseMembers(hidden, 'pop-1', 'excluded'), hidden);
  assert.throws(() => parseMembers({ ...hidden, members: [member(0)] }, 'pop-1', 'excluded'), /Invalid/, 'withheld values that are shown');
  assert.throws(() => parseMembers({ ...page, members: [member(0, { disposition: 'in_scope', reason: null })] }, 'pop-1', 'excluded'), /Invalid/, 'a row outside the filter');
  assert.throws(() => parseMembers({ ...page, total: '1' }, 'pop-1', 'excluded'), /Invalid/, 'a total below the rows shown');
  assert.throws(() => parseMembers(page, 'pop-2', 'excluded'), /Invalid/, 'another population');
  assert.throws(() => parseMembers({ ...page, members: [member(0, { reason: 'period_missing' })] }, 'pop-1', 'excluded'), /Invalid/, 'an exclusion that is not out of period');
  const value = { name: 'amount', state: 'value', value: '1250.00', measure: 'USD', measure_grounded: true };
  assert.throws(() => parseMembers({ ...hidden, members: [member(0, { subject: null, cells: hidden.members[0].cells, values: [{ ...value, value: null }] })] }, 'pop-1', 'excluded'), /Invalid/, 'a withheld measure that is shown');
  assert.throws(() => parseMembers({ ...page, members: [member(0, { cells: [{ ...page.members[0].cells[0], kind: 'number' }] })] }, 'pop-1', 'excluded'), /Invalid/, 'a cell of an unknown kind');
  assert.throws(() => parseMembers({ ...page, disposition: null, members: [member(1, { disposition: 'duplicate_row', reason: null })] }, 'pop-1', null), /Invalid/, 'a duplicate row that names no first row');
  assert.throws(() => parseMembers({ ...page, disposition: null, members: [member(1, { disposition: 'unkeyed', reason: null })] }, 'pop-1', null), /Invalid/, 'an unkeyed row with a key');
  assert.throws(() => parseMembers({ ...page, next_cursor: 'INV-1' }, 'pop-1', 'excluded'), /Invalid/, 'a malformed cursor');
  const dated = member(2, { cells: [{ column: 'Invoice date', text: '2026-03-05', location: 'Dated!B6', kind: 'excel_date' }] });
  assert.equal(parseMembers({ ...page, members: [dated] }, 'pop-1', 'excluded').members[0].cells[0].kind, 'excel_date');
});

test('a lower bound reads "at least … found" and an exact count does not', () => {
  assert.match(found('1256', 'row', false), /^at least 1,256 rows found$/);
  assert.equal(found('1', 'invoice', true), '1 invoice');
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
