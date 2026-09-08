import { describe, expect, it } from 'vitest';
import { evaluateComplianceRecord, initialDraftCompliance, isDraftComplianceFields, type DraftComplianceFields } from '@intellifin/domain';
import { canonicalLoanCoreCompliance, CANONICAL_LOANCORE_C1 } from '../fixtures/canonical-loancore-compliance';

function c1(fields: DraftComplianceFields, status: string) {
  return evaluateComplianceRecord('P-1', fields, {
    values: { found: true, account_status: status },
    evidence: { inspected: true, complete: true, ambiguous: false, contradictory: false, absenceProven: false },
  }).conditions.find(condition => condition.conditionId === 'C1');
}

describe('explicitly authored canonical LoanCore status rule', () => {
  it('preserves the default lowercase mismatch as an unnamed value', () => {
    expect(c1(initialDraftCompliance('P-1'), 'Disabled')).toMatchObject({
      value: 'UNEVALUATED', diagnostics: ['rule does not name value Disabled'],
    });
  });
  it.each([['Disabled', 'COMPLIANT'], ['Active', 'EXCEPTION'], ['disabled', 'UNEVALUATED'], ['Suspended', 'UNEVALUATED']])
    ('evaluates only the explicitly named %s value as %s', (status, value) => {
      const fields = canonicalLoanCoreCompliance();
      expect(isDraftComplianceFields(fields, 'P-1')).toBe(true);
      expect(fields.complianceConditions[0]!.text).toBe(CANONICAL_LOANCORE_C1);
      expect(c1(fields, status)?.value).toBe(value);
      expect(fields.complianceConditions.find(condition => condition.conditionId === 'C2'))
        .toEqual(initialDraftCompliance('P-1').complianceConditions.find(condition => condition.conditionId === 'C2'));
    });
});
