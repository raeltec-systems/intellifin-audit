import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { classifyRolePrivilege, evaluateComplianceRecord, initialDraftCompliance, isDraftComplianceFields, RETAINED_PRIVILEGED_ASSIGNMENT, type DraftComplianceFields } from '@intellifin/domain';
import { canonicalLoanCoreCompliance, CANONICAL_LOANCORE_C1, CANONICAL_LOANCORE_C2_POLICY } from '../fixtures/canonical-loancore-compliance';

const evidence = { inspected: true, complete: true, ambiguous: false, contradictory: false, absenceProven: false };
function c1(fields: DraftComplianceFields, status: string) {
  return evaluateComplianceRecord('P-1', fields, { values: { found: true, account_status: status }, evidence }).conditions.find(condition => condition.conditionId === 'C1');
}
function c2(fields: DraftComplianceFields, roles: string, proposal?: { value: 'COMPLIANT' | 'EXCEPTION'; confidence: string }) {
  return evaluateComplianceRecord('P-1', fields, { values: { found: true, account_status: 'Disabled', roles }, evidence }, proposal ? { C2: proposal } : {}).conditions.find(condition => condition.conditionId === 'C2');
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
    });
});

describe('the canonical LoanCore role-privilege policy on C2', () => {
  const dataset = JSON.parse(readFileSync('fixtures/northstar/datasets/loancore-accounts.json', 'utf8')) as { accounts: { employee_id: string; roles: string[] }[] };
  const rolesOf = (employee: string) => dataset.accounts.find(account => account.employee_id === employee)!.roles.join(', ');

  it('keeps C2 Agent-Judged with the template prose and the owner\'s two explicit lists', () => {
    const fields = canonicalLoanCoreCompliance();
    const condition = fields.complianceConditions.find(c => c.conditionId === 'C2')!;
    const template = initialDraftCompliance('P-1').complianceConditions.find(c => c.conditionId === 'C2')!;
    expect(condition).toMatchObject({ text: template.text, applicability: template.applicability, status: 'AGENT_JUDGED', rule: null });
    expect(condition.policy).toEqual({ ...CANONICAL_LOANCORE_C2_POLICY, privileged: [...CANONICAL_LOANCORE_C2_POLICY.privileged].sort(), nonPrivileged: [...CANONICAL_LOANCORE_C2_POLICY.nonPrivileged].sort() });
    expect(isDraftComplianceFields(fields, 'P-1')).toBe(true);
    // The negative case is the template's own C2: no policy key at all.
    const original = canonicalLoanCoreCompliance({ c2Policy: false }).complianceConditions.find(c => c.conditionId === 'C2')!;
    expect(original).toEqual(template);
  });

  it('classifies the canonical dataset rows exactly as the expectation file names them', () => {
    const policy = canonicalLoanCoreCompliance().complianceConditions.find(c => c.conditionId === 'C2')!.policy!;
    // D1-b: E-000102 holds only LOAN_VIEWER — a complete list of known non-privileged roles.
    expect(classifyRolePrivilege(policy, rolesOf('E-000102'))).toMatchObject({ kind: 'non-privileged' });
    // D16-a: E-000118 retains LOAN_ADMIN and SYSTEM_ADMIN while disabled.
    expect(classifyRolePrivilege(policy, rolesOf('E-000118'))).toMatchObject({ kind: 'privileged', privileged: ['LOAN_ADMIN', 'SYSTEM_ADMIN'] });
    // D16-b: E-000119's OPS_GENERIC and XR_TEMP are in neither list — still ambiguous, still escalated.
    expect(classifyRolePrivilege(policy, rolesOf('E-000119'))).toMatchObject({ kind: 'unclassified', unclassified: ['OPS_GENERIC', 'XR_TEMP'] });
  });

  it('evaluates the three canonical rows under the policy without converting a proposal into approval', () => {
    const fields = canonicalLoanCoreCompliance();
    expect(c2(fields, rolesOf('E-000102'), { value: 'COMPLIANT', confidence: '0.9' })).toMatchObject({ value: 'COMPLIANT', origin: 'AGENT_JUDGED', diagnostics: [] });
    expect(c2(fields, rolesOf('E-000118'), { value: 'EXCEPTION', confidence: '0.9' })).toMatchObject({ value: 'EXCEPTION', diagnostics: [`${RETAINED_PRIVILEGED_ASSIGNMENT}LOAN_ADMIN, SYSTEM_ADMIN`] });
    expect(c2(fields, rolesOf('E-000118'), { value: 'COMPLIANT', confidence: '0.9' })?.value).toBe('UNEVALUATED');
    expect(c2(fields, rolesOf('E-000119'), { value: 'EXCEPTION', confidence: '0.9' })).toMatchObject({ value: 'UNEVALUATED', diagnostics: ['rule does not name value OPS_GENERIC', 'rule does not name value XR_TEMP'] });
    // Without the policy every one of them is the model's alone to decide.
    const original = canonicalLoanCoreCompliance({ c2Policy: false });
    expect(c2(original, rolesOf('E-000118'), { value: 'COMPLIANT', confidence: '0.9' })).toMatchObject({ value: 'COMPLIANT', diagnostics: [] });
  });
});
