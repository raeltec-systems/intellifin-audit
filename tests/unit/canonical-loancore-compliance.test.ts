import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { classifyRolePrivilege, complianceFieldMappings, evaluateComplianceRecord, initialDraftCompliance, isDraftComplianceFields, observationIdFor, observationRuleValues, MISSING_OBSERVATION_FIELD, RETAINED_PRIVILEGED_ASSIGNMENT, type DraftComplianceFields, type ObservationRecord } from '@intellifin/domain';
import { canonicalLoanCoreCompliance, CANONICAL_LOANCORE_C1, CANONICAL_LOANCORE_C2_POLICY, CANONICAL_LOANCORE_C3_MAPPING, CANONICAL_LOANCORE_C3_WINDOW } from '../fixtures/canonical-loancore-compliance';

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

describe('the canonical 24-hour disablement window against the golden fixtures (D3)', () => {
  const loancore = JSON.parse(readFileSync('fixtures/northstar/datasets/loancore-accounts.json', 'utf8')) as { accounts: { employee_id: string; status: string; roles: string[]; disabled_time: string }[] };
  const peoplehub = JSON.parse(readFileSync('fixtures/northstar/datasets/peoplehub-employees.json', 'utf8')) as { employees: { employee_id: string; termination_effective_time: string }[] };
  const leavers = JSON.parse(readFileSync('fixtures/northstar/datasets/leavers-export.json', 'utf8')) as { rows: Record<string, string>[] };
  const expectations = JSON.parse(readFileSync('fixtures/northstar/expectations/p-1-terminated-users.json', 'utf8')) as { cases: { case_id: string; record_key: string; expected_record_evaluation: string }[] };
  const d3 = expectations.cases.find((entry) => entry.case_id === 'D3')!;
  const account = loancore.accounts.find((entry) => entry.employee_id === d3.record_key)!;
  const employee = peoplehub.employees.find((entry) => entry.employee_id === d3.record_key)!;
  const fields = canonicalLoanCoreCompliance({ disablementWindow: true });
  const evidence = { inspected: true, complete: true, ambiguous: false, contradictory: false, absenceProven: false };
  const captured = (disabledTime: string): ObservationRecord => ({
    schemaVersion: 1, observationId: observationIdFor('01920000-0000-7000-8000-00000000a001', account.employee_id),
    workItemId: '01920000-0000-7000-8000-00000000a001', populationRecordKey: account.employee_id, targetSystem: 'loancore',
    found: 'true', observedAt: '2026-09-05T10:00:00.000Z', stepExecutionId: '01920000-0000-7000-8000-00000000b001',
    captureMethod: 'agent', matchOrigin: 'platform', identity: null, evidenceIds: ['01920000-0000-7000-8000-00000000c001'],
    attributes: [
      { name: 'account_status', originalValue: account.status, normalizedValue: account.status, grounding: null, corroboration: null },
      { name: 'roles', originalValue: account.roles.join(', '), normalizedValue: account.roles.join(', '), grounding: null, corroboration: null },
      { name: 'disabled_time', originalValue: disabledTime, normalizedValue: disabledTime, grounding: null, corroboration: null },
    ],
  });
  const evaluate = (population: Record<string, string>, disabledTime = account.disabled_time) => evaluateComplianceRecord('P-1', fields,
    { values: observationRuleValues('P-1', captured(disabledTime), population, complianceFieldMappings(fields)), evidence },
    { C2: { value: 'COMPLIANT', confidence: '0.9' } });

  it('freezes the window as a third condition with the explicit mapping, beside the status rule and the policy', () => {
    expect(fields.complianceConditions.map((condition) => condition.conditionId)).toEqual(['C1', 'C2', 'C3']);
    expect(fields.complianceConditions[2]).toMatchObject({ text: CANONICAL_LOANCORE_C3_WINDOW, status: 'RULE', mapping: CANONICAL_LOANCORE_C3_MAPPING, rule: { kind: 'disablement-window', hours: '24', boundary: 'inclusive' } });
    expect(isDraftComplianceFields(fields, 'P-1')).toBe(true);
  });

  it('reaches the expectation file\'s D3 verdict from the PeopleHub instant and the LoanCore page, exactly 24 hours apart', () => {
    expect(d3.expected_record_evaluation).toBe('COMPLIANT');
    expect(account.disabled_time).toBe('2026-08-08T00:00:00+02:00');
    expect(employee.termination_effective_time).toBe('2026-08-07T00:00:00+02:00');
    const result = evaluate({ employee_id: account.employee_id, termination_effective_time: employee.termination_effective_time });
    expect(result.conditions.map((condition) => [condition.conditionId, condition.value])).toEqual([['C1', 'COMPLIANT'], ['C2', 'COMPLIANT'], ['C3', 'COMPLIANT']]);
    expect(result.value).toBe(d3.expected_record_evaluation);
    // One second later is the Exception the dataset note promises.
    expect(evaluate({ employee_id: account.employee_id, termination_effective_time: employee.termination_effective_time }, '2026-08-08T00:00:01+02:00').conditions[2]).toMatchObject({ conditionId: 'C3', value: 'EXCEPTION' });
  });

  it('cannot substantiate the window from the leavers export, which declares a termination DATE only', () => {
    const row = leavers.rows.find((entry) => entry['employee_id'] === account.employee_id)!;
    expect(row['termination_effective_date']).toBe('2026-08-07');
    expect(Object.hasOwn(row, 'termination_effective_time')).toBe(false);
    const result = evaluate(row);
    expect(result.conditions[2]).toMatchObject({ conditionId: 'C3', value: 'UNEVALUATED', diagnostics: [`${MISSING_OBSERVATION_FIELD}termination_time`] });
    expect(result.value).toBe('UNEVALUATED');
  });
});
