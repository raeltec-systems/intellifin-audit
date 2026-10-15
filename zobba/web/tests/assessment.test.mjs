import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { groundingLabel, originLabel, parseAssessment, reasonLabel, supportLabel, valueLabel, verdictLabel } from '../src/assessment.ts';

const source = { original_id: 'ap-invoices', readable: true, filename: 'AP invoices.xlsx', version: 'v1', sha256: 'a'.repeat(64), locator: 'cell:Sheet1!B2', location: 'Sheet1!B2', byte_start: null, byte_end: null, quote: '1,250.00', verification: 'verified', reason: null };
const criterion = { id: 'crit-1', invocation_id: 'inv-a', key: 'c1', supersedes: null, assertion: 'Invoices above 1,000.00 USD require an approver', kind: 'rule', authority_kind: 'method', authority_verified: true, authority_reason: null, requirement_id: 'AP-1', criterion_ordinal: 0, authority_text_sha256: 'b'.repeat(64), authority_source: null, effective_from: null, effective_to: null, applicability: 'amount > 1000.00 USD', rule: 'approver is present', rubric: null, required_facts: [{ name: 'amount', fact_type: 'decimal', measure: 'USD' }], methodology_binding_id: 'binding-a', execution_epoch: '1' };
const basis = { id: 'basis-1', invocation_id: 'inv-a', key: 'b1', supersedes: null, objective: 'Test AP approvals', criteria: ['crit-1'], period_from: '2026-01-01', period_to: '2026-12-31', as_of: null, population: [{ original_id: 'ap-invoices', unit: 'invoice', selection: 'All invoices', sha256: 'a'.repeat(64), filename: 'AP invoices.xlsx' }], limitations: [], methodology_binding_id: 'binding-a', execution_epoch: '1' };
const fact = { id: 'fact-1', invocation_id: 'inv-a', basis_id: 'basis-1', subject: '000123', subject_unit: 'invoice', name: 'amount', value_kind: 'decimal', value_withheld: false, value: '1250.00', measure: 'USD', mantissa: '125000', scale: 2, utc: null, offset_minutes: null, unavailable_reason: null, candidates: null, rule: 'decimal_grouped_comma', support: 'supported', support_reason: null, subject_grounded: true, measure_grounded: true, job_id: null, sources: [source], methodology_binding_id: 'binding-a', execution_epoch: '1' };
const evaluation = { id: 'eval-1', invocation_id: 'inv-a', basis_id: 'basis-1', criterion_id: 'crit-1', subject: '000123', applicability: 'applicable', execution: 'completed', verdict: 'met', reason: null, origin: 'deterministic', inputs: [{ fact_id: 'fact-1', digest: 'c'.repeat(64) }], output_digest: 'd'.repeat(64), judgment: null, methodology_binding_id: 'binding-a', execution_epoch: '1' };
const assessment = { bases: [basis], total_bases: '1', criteria: [criterion], total_criteria: '1', facts: [fact], total_facts: '1', evaluations: [evaluation], total_evaluations: '1', populations: [], total_populations: '0', samples: [], total_samples: '0', summaries: [], total_summaries: '0' };

const judgment = { supporting: ['fact-1'], contrary: [], rationale: 'The approver is independent.', uncertainty: '' };
const instant = { ...fact, id: 'fact-2', name: 'approved_at', value_kind: 'instant', value: '2026-03-05T23:30:00-05:00', measure: null, mantissa: null, scale: null, measure_grounded: null, utc: '2026-03-06T04:30:00Z', offset_minutes: -300, rule: 'instant_rfc3339' };
const unavailable = { ...fact, id: 'fact-3', name: 'approver', value_kind: 'unavailable', value: null, measure: null, mantissa: null, scale: null, measure_grounded: null, rule: null, support: 'no_value', unavailable_reason: 'evidence_unavailable', sources: [] };
const ambiguous = { ...unavailable, id: 'fact-4', value_kind: 'ambiguous', unavailable_reason: null, candidates: 2 };
const withheld = { ...fact, id: 'fact-5', value_withheld: true, value: null, mantissa: null, scale: null, sources: [{ ...source, readable: false, filename: null, version: null, sha256: null, locator: null, location: null, quote: null }] };
const original = { ...criterion, id: 'crit-2', authority_kind: 'original', requirement_id: null, criterion_ordinal: null, authority_text_sha256: null, authority_source: source };
const rubric = { ...criterion, id: 'crit-3', kind: 'judgment', rule: null, rubric: 'Segregation is adequate' };
const proposal = { ...evaluation, id: 'eval-2', criterion_id: 'crit-3', origin: 'model_proposal', judgment };
const valid = { ...assessment, criteria: [criterion, original, rubric], total_criteria: '3', facts: [fact, instant, unavailable, ambiguous, withheld], total_facts: '5', evaluations: [evaluation, proposal], total_evaluations: '2' };
const with_ = (field, index, change) => ({ ...valid, [field]: valid[field].map((item, i) => i === index ? { ...item, ...change } : item) });

test('the assessment basis is strictly parsed with separate verdict fields', () => {
  assert.deepEqual(parseAssessment(assessment), assessment);
  assert.deepEqual(parseAssessment(valid), valid);
  // Leading zeros are kept exactly.
  assert.equal(parseAssessment(assessment).facts[0].subject, '000123');
});

test('each structural rule refuses exactly its own defect', () => {
  // Every case breaks one rule of an otherwise valid response.
  const cases = {
    'a total below the listed records': { ...valid, total_facts: '4' },
    'an unknown field (a confidence score)': with_('evaluations', 0, { confidence: 0.9 }),
    'an unknown field on a fact': with_('facts', 0, { probability: '0.9' }),
    'a decided verdict that does not apply': with_('evaluations', 0, { applicability: 'not_applicable' }),
    'a decided verdict with a reason': with_('evaluations', 0, { reason: 'missing_fact' }),
    'a decided verdict without inputs': with_('evaluations', 0, { inputs: [] }),
    'a failed execution with a verdict': with_('evaluations', 0, { execution: 'failed', reason: 'analysis_failed' }),
    'a failed execution with another reason': with_('evaluations', 0, { execution: 'failed', verdict: null, reason: 'missing_fact' }),
    'a not-applicable verdict': with_('evaluations', 0, { applicability: 'not_applicable', verdict: 'undetermined', reason: 'missing_fact' }),
    'a deterministic undetermined verdict without its reason': with_('evaluations', 0, { verdict: 'undetermined' }),
    'a model proposal without its judgment': with_('evaluations', 1, { judgment: null }),
    'a judgment on a deterministic record': with_('evaluations', 0, { judgment }),
    'a decimal without its mantissa': with_('facts', 0, { mantissa: null }),
    'a decimal without its scale': with_('facts', 0, { scale: null }),
    'a decimal without its measure': with_('facts', 0, { measure: null }),
    'a decimal without its measure grounding': with_('facts', 0, { measure_grounded: null }),
    'a measure grounding on an instant': with_('facts', 1, { measure_grounded: true }),
    'a float mantissa': with_('facts', 0, { mantissa: '1.25e5' }),
    'an instant without UTC': with_('facts', 1, { utc: null }),
    'an instant without its offset': with_('facts', 1, { offset_minutes: null }),
    'an unavailable fact without its reason': with_('facts', 2, { unavailable_reason: null }),
    'an ambiguous fact without its count': with_('facts', 3, { candidates: null }),
    'an unsupported fact without its reason': with_('facts', 0, { support: 'unsupported' }),
    'a withheld value that is shown': with_('facts', 4, { value: '1250.00' }),
    'a withheld unavailable fact': with_('facts', 2, { value_withheld: true }),
    'a numeric value': with_('facts', 0, { value: 1250 }),
    'an unknown support reason': with_('facts', 0, { support: 'unsupported', support_reason: 'probably_wrong' }),
    'a verified authority with a reason': with_('criteria', 0, { authority_reason: 'not_found_at_location' }),
    'an unverified authority without its reason': with_('criteria', 0, { authority_verified: false }),
    'a method authority without its requirement': with_('criteria', 0, { requirement_id: null }),
    'an original authority without its source': with_('criteria', 1, { authority_source: null }),
    'a rule criterion without its rule': with_('criteria', 0, { rule: null }),
    'a judgment criterion without its rubric': with_('criteria', 2, { rubric: null }),
    'a basis ending before it starts': with_('bases', 0, { period_from: '2027-01-01' }),
    'a subject of White_Space only': with_('facts', 0, { subject: '\u2003' }),
  };
  for (const [name, bad] of Object.entries(cases)) {
    assert.throws(() => parseAssessment(bad), /Invalid assessment response/, name);
  }
  // Rust keeps U+FEFF (it is not White_Space), so it is not blank here either.
  assert.equal(parseAssessment(with_('facts', 0, { subject: '\ufeff' })).facts[0].subject, '\ufeff');
});

test('words keep missing, failed and exception apart and never call no-verdict a pass', () => {
  assert.equal(verdictLabel(null), 'No verdict');
  assert.equal(verdictLabel('not_met'), 'Not met (exception)');
  assert.equal(reasonLabel('missing_fact'), 'a required fact is missing');
  assert.equal(reasonLabel('analysis_failed'), 'the analysis failed');
  assert.equal(valueLabel(fact), '1250.00 USD');
  assert.equal(supportLabel({ ...fact, support: 'unsupported', support_reason: 'type_mismatch' }), 'Unsupported · the source does not show this value');
  assert.equal(supportLabel({ ...fact, support: 'unsupported', support_reason: 'partial_value' }), 'Unsupported · the quote is only part of a longer value');
  assert.equal(valueLabel(withheld), 'Value withheld — you cannot open its source');
  assert.equal(groundingLabel(fact), null);
  assert.equal(groundingLabel({ ...fact, measure_grounded: false }), 'USD only claimed');
  assert.equal(groundingLabel({ ...fact, subject_grounded: false }), 'subject not found beside its source');
  assert.equal(reasonLabel('unit_unverified'), 'the currency or unit is only claimed, not shown by the source');
  // The platform evaluates a rule it did not choose: the words say so.
  assert.equal(originLabel.deterministic, 'Platform evaluated the rule Zobba proposed');
  assert.doesNotMatch(originLabel.deterministic, /Decided by a platform rule/);
});

test('the worker-recorded assessment JSON parses', () => {
  const recorded = JSON.parse(readFileSync(new URL('./fixtures/task-assessment.json', import.meta.url), 'utf8'));
  const assessment = parseAssessment(recorded);
  const verdicts = assessment.evaluations.map(e => e.verdict);
  assert.ok(verdicts.includes('met') && verdicts.includes('not_met'));
  assert.equal(assessment.evaluations.filter(e => e.verdict === 'not_met').length, 1);
});
