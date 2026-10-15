import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseAssessment, reasonLabel, supportLabel, valueLabel, verdictLabel } from '../src/assessment.ts';

const source = { original_id: 'ap-invoices', readable: true, filename: 'AP invoices.xlsx', version: 'v1', sha256: 'a'.repeat(64), locator: 'cell:Sheet1!B2', location: 'Sheet1!B2', byte_start: null, byte_end: null, quote: '1,250.00', verification: 'verified', reason: null };
const criterion = { id: 'crit-1', invocation_id: 'inv-a', key: 'c1', supersedes: null, assertion: 'Invoices above 1,000.00 USD require an approver', kind: 'rule', authority_kind: 'method', authority_verified: true, authority_reason: null, requirement_id: 'AP-1', criterion_ordinal: 0, authority_text_sha256: 'b'.repeat(64), authority_source: null, effective_from: null, effective_to: null, applicability: 'amount > 1000.00 USD', rule: 'approver is present', rubric: null, required_facts: [{ name: 'amount', fact_type: 'decimal', measure: 'USD' }], methodology_binding_id: 'binding-a', execution_epoch: '1' };
const basis = { id: 'basis-1', invocation_id: 'inv-a', key: 'b1', supersedes: null, objective: 'Test AP approvals', criteria: ['crit-1'], period_from: '2026-01-01', period_to: '2026-12-31', as_of: null, population: [{ original_id: 'ap-invoices', unit: 'invoice', selection: 'All invoices', sha256: 'a'.repeat(64), filename: 'AP invoices.xlsx' }], limitations: [], methodology_binding_id: 'binding-a', execution_epoch: '1' };
const fact = { id: 'fact-1', invocation_id: 'inv-a', basis_id: 'basis-1', subject: '000123', subject_unit: 'invoice', name: 'amount', value_kind: 'decimal', value: '1250.00', measure: 'USD', mantissa: '125000', scale: 2, utc: null, offset_minutes: null, unavailable_reason: null, candidates: null, rule: 'decimal_grouped_comma', support: 'supported', support_reason: null, job_id: null, sources: [source], methodology_binding_id: 'binding-a', execution_epoch: '1' };
const evaluation = { id: 'eval-1', invocation_id: 'inv-a', basis_id: 'basis-1', criterion_id: 'crit-1', subject: '000123', applicability: 'applicable', execution: 'completed', verdict: 'met', reason: null, origin: 'deterministic', inputs: [{ fact_id: 'fact-1', digest: 'c'.repeat(64) }], output_digest: 'd'.repeat(64), judgment: null, methodology_binding_id: 'binding-a', execution_epoch: '1' };
const assessment = { bases: [basis], total_bases: '1', criteria: [criterion], total_criteria: '1', facts: [fact], total_facts: '1', evaluations: [evaluation], total_evaluations: '1' };

test('the assessment basis is strictly parsed with separate verdict fields', () => {
  assert.deepEqual(parseAssessment(assessment), assessment);
  for (const bad of [
    { ...assessment, total_facts: '0' },
    { ...assessment, evaluations: [{ ...evaluation, confidence: 0.9, verdict: 'probably' }] },
    // A decided verdict needs an applicable, completed evaluation and no reason.
    { ...assessment, evaluations: [{ ...evaluation, applicability: 'not_applicable' }] },
    { ...assessment, evaluations: [{ ...evaluation, reason: 'missing_fact' }] },
    // A failed execution has no verdict and says analysis_failed.
    { ...assessment, evaluations: [{ ...evaluation, execution: 'failed' }] },
    { ...assessment, evaluations: [{ ...evaluation, origin: 'model_proposal' }] },
    { ...assessment, facts: [{ ...fact, mantissa: '1.25e5' }] },
    { ...assessment, facts: [{ ...fact, support: 'unsupported' }] },
    { ...assessment, facts: [{ ...fact, value: 1250 }] },
    { ...assessment, criteria: [{ ...criterion, authority_verified: false }] },
    { ...assessment, criteria: [{ ...criterion, rule: null }] },
    { ...assessment, bases: [{ ...basis, period_from: '2027-01-01' }] },
  ]) assert.throws(() => parseAssessment(bad));
  // Leading zeros are kept exactly.
  assert.equal(parseAssessment(assessment).facts[0].subject, '000123');
});

test('words keep missing, failed and exception apart and never call no-verdict a pass', () => {
  assert.equal(verdictLabel(null), 'No verdict');
  assert.equal(verdictLabel('not_met'), 'Not met (exception)');
  assert.equal(reasonLabel('missing_fact'), 'a required fact is missing');
  assert.equal(reasonLabel('analysis_failed'), 'the analysis failed');
  assert.equal(valueLabel(fact), '1250.00 USD');
  assert.equal(supportLabel({ ...fact, support: 'unsupported', support_reason: 'type_mismatch' }), 'Unsupported · the source does not show this value');
});

test('the worker-recorded assessment JSON parses', () => {
  const recorded = JSON.parse(readFileSync(new URL('./fixtures/task-assessment.json', import.meta.url), 'utf8'));
  const assessment = parseAssessment(recorded);
  const verdicts = assessment.evaluations.map(e => e.verdict);
  assert.ok(verdicts.includes('met') && verdicts.includes('not_met'));
  assert.equal(assessment.evaluations.filter(e => e.verdict === 'not_met').length, 1);
});
