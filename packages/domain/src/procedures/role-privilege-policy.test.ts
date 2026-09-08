import { describe, expect, it } from 'vitest';
import {
  COMPLIANCE_LIMITS, COMPLIANCE_MESSAGES, POLICY_CONTRADICTED, RETAINED_PRIVILEGED_ASSIGNMENT, ROLE_PRIVILEGE_LIMITS,
  RULE_DOES_NOT_NAME_VALUE, MISSING_OBSERVATION_FIELD,
  agentJudgedNeedsProposal, classifyRolePrivilege, compileComplianceDraft, complianceInputFromFields, conditionInstructionText,
  evaluateComplianceRecord, initialDraftCompliance, isDraftComplianceFields, normalizeConditionPolicy, readRoleList, rolePrivilegeInstruction,
  type ComplianceObservation, type DraftComplianceFields, type RolePrivilegePolicy,
} from './index.js';

/** The owner's synthetic policy (2026-09-08), authored out of order and with stray whitespace on purpose. */
const AUTHORED = {
  kind: 'role-privilege', rolesField: 'roles',
  privileged: ['SYSTEM_ADMIN', ' LOAN_ADMIN', 'BRANCH_SUPERVISOR', 'SYSTEM_ADMIN'],
  nonPrivileged: ['LOAN_VIEWER', 'LOAN_OFFICER', 'COLLECTIONS_AGENT', 'TREASURY_ANALYST', 'SERVICING_CLERK', 'RISK_ANALYST', 'OPS_CLERK '],
} as const;
const POLICY: RolePrivilegePolicy = {
  kind: 'role-privilege', rolesField: 'roles',
  privileged: ['BRANCH_SUPERVISOR', 'LOAN_ADMIN', 'SYSTEM_ADMIN'],
  nonPrivileged: ['COLLECTIONS_AGENT', 'LOAN_OFFICER', 'LOAN_VIEWER', 'OPS_CLERK', 'RISK_ANALYST', 'SERVICING_CLERK', 'TREASURY_ANALYST'],
};
const evidence = { inspected: true, complete: true, ambiguous: false, contradictory: false, absenceProven: false } as const;
const found = (roles: unknown): ComplianceObservation => ({ values: { found: true, account_status: 'Disabled', roles }, evidence });

function p1(policy: unknown = AUTHORED): DraftComplianceFields {
  const authored = complianceInputFromFields(initialDraftCompliance('P-1'));
  const result = compileComplianceDraft('P-1', { ...authored, conditions: authored.conditions.map((condition) => condition.conditionId === 'C2' ? { ...condition, policy } : condition) });
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}
const c2 = (fields: DraftComplianceFields, observation: ComplianceObservation, proposal?: { value: 'COMPLIANT' | 'EXCEPTION' | 'UNEVALUATED'; confidence: string }) =>
  evaluateComplianceRecord('P-1', fields, observation, proposal ? { C2: proposal } : {}).conditions.find((condition) => condition.conditionId === 'C2')!;

describe('the frozen role-privilege policy binding', () => {
  it('normalizes the authored lists as sets and refuses an ambiguous or empty policy', () => {
    expect(normalizeConditionPolicy(AUTHORED)).toEqual(POLICY);
    expect(normalizeConditionPolicy(null)).toBeUndefined();
    expect(normalizeConditionPolicy(undefined)).toBeUndefined();
    expect(normalizeConditionPolicy({ ...AUTHORED, nonPrivileged: [...AUTHORED.nonPrivileged, 'LOAN_ADMIN'] })).toBe(false);
    expect(normalizeConditionPolicy({ ...AUTHORED, privileged: [], nonPrivileged: [] })).toBe(false);
    expect(normalizeConditionPolicy({ ...AUTHORED, privileged: ['A,B'] })).toBe(false);
    expect(normalizeConditionPolicy({ ...AUTHORED, privileged: [''] })).toBe(false);
    expect(normalizeConditionPolicy({ ...AUTHORED, privileged: ['x'.repeat(ROLE_PRIVILEGE_LIMITS.roleLength + 1)] })).toBe(false);
    expect(normalizeConditionPolicy({ ...AUTHORED, kind: 'name-heuristic' })).toBe(false);
    expect(normalizeConditionPolicy({ ...AUTHORED, rolesField: 'username' })).toBe(false);
    expect(normalizeConditionPolicy({ ...AUTHORED, extra: true })).toBe(false);
    expect(normalizeConditionPolicy({ ...AUTHORED, privileged: Array.from({ length: ROLE_PRIVILEGE_LIMITS.roles + 1 }, (_, index) => `R${index}`) })).toBe(false);
    // One list may be empty: a policy that only names privileged roles escalates every other role.
    expect(normalizeConditionPolicy({ ...AUTHORED, nonPrivileged: [] })).toMatchObject({ nonPrivileged: [] });
  });

  it('compiles only onto an Agent-Judged condition over a declared roles field, omitting the key when absent', () => {
    const fields = p1();
    const [c1, condition] = fields.complianceConditions;
    expect(condition).toMatchObject({ conditionId: 'C2', status: 'AGENT_JUDGED', rule: null, policy: POLICY });
    expect(Object.hasOwn(c1!, 'policy')).toBe(false);
    expect(isDraftComplianceFields(fields, 'P-1')).toBe(true);
    // Legacy rows and a `null` on input both compile to a condition with NO policy key.
    for (const legacy of initialDraftCompliance('P-1').complianceConditions) expect(Object.hasOwn(legacy, 'policy')).toBe(false);
    for (const legacy of p1(null).complianceConditions) expect(Object.hasOwn(legacy, 'policy')).toBe(false);
    expect(complianceInputFromFields(fields).conditions[1]).toEqual({ conditionId: 'C2', text: condition!.text, applicability: condition!.applicability, comparison: null, policy: POLICY });
    expect(Object.hasOwn(complianceInputFromFields(fields).conditions[0]!, 'policy')).toBe(false);
    // The frozen row and its recompilation agree byte for byte, with and without a policy.
    expect(isDraftComplianceFields(initialDraftCompliance('P-1'), 'P-1')).toBe(true);
    // A malformed policy, a policy on a Rule-Classified condition, and a policy on a Template with no roles are refused.
    const authored = complianceInputFromFields(initialDraftCompliance('P-1'));
    expect(compileComplianceDraft('P-1', { ...authored, conditions: authored.conditions.map((c) => c.conditionId === 'C2' ? { ...c, policy: { ...AUTHORED, kind: 'other' } } : c) })).toEqual({ ok: false, reason: `C2: ${COMPLIANCE_MESSAGES.POLICY}` });
    expect(compileComplianceDraft('P-1', { ...authored, conditions: authored.conditions.map((c) => c.conditionId === 'C1' ? { ...c, policy: AUTHORED } : c) })).toEqual({ ok: false, reason: `C1: ${COMPLIANCE_MESSAGES.POLICY}` });
    const p3 = complianceInputFromFields(initialDraftCompliance('P-3'));
    expect(compileComplianceDraft('P-3', { ...p3, conditions: [{ conditionId: 'J1', text: 'Use professional judgement.', applicability: 'all records', comparison: null, policy: AUTHORED }] })).toEqual({ ok: false, reason: `J1: ${COMPLIANCE_MESSAGES.POLICY}` });
    // The prose plus its rendered policy is one instruction and is bounded as one.
    const long = 'x'.repeat(COMPLIANCE_LIMITS.text - 10);
    expect(compileComplianceDraft('P-1', { ...authored, conditions: [{ conditionId: 'C2', text: long, applicability: 'found = true', comparison: null, policy: AUTHORED }] })).toEqual({ ok: false, reason: `C2: ${COMPLIANCE_MESSAGES.POLICY}` });
    expect(compileComplianceDraft('P-1', { ...authored, conditions: [{ conditionId: 'C2', text: long, applicability: 'found = true', comparison: null }] })).toMatchObject({ ok: true });
  });

  it('reads a captured roles value as an exact list and classifies it without inferring from names', () => {
    expect(readRoleList('LOAN_ADMIN, SYSTEM_ADMIN')).toEqual(['LOAN_ADMIN', 'SYSTEM_ADMIN']);
    expect(readRoleList('LOAN_VIEWER;OPS_CLERK\nRISK_ANALYST')).toEqual(['LOAN_VIEWER', 'OPS_CLERK', 'RISK_ANALYST']);
    expect(readRoleList('["LOAN_VIEWER","OPS_CLERK"]')).toEqual(['LOAN_VIEWER', 'OPS_CLERK']);
    expect(readRoleList(['LOAN_VIEWER'])).toEqual(['LOAN_VIEWER']);
    expect(readRoleList('')).toBeNull(); expect(readRoleList('  ')).toBeNull(); expect(readRoleList(null)).toBeNull();
    expect(readRoleList('[not json')).toBeNull(); expect(readRoleList([1])).toBeNull(); expect(readRoleList([])).toBeNull();
    expect(classifyRolePrivilege(POLICY, 'LOAN_ADMIN, SYSTEM_ADMIN')).toEqual({ kind: 'privileged', roles: ['LOAN_ADMIN', 'SYSTEM_ADMIN'], privileged: ['LOAN_ADMIN', 'SYSTEM_ADMIN'] });
    // One privileged role decides, whatever else the account holds.
    expect(classifyRolePrivilege(POLICY, 'XR_TEMP, SYSTEM_ADMIN')).toMatchObject({ kind: 'privileged', privileged: ['SYSTEM_ADMIN'] });
    expect(classifyRolePrivilege(POLICY, 'LOAN_VIEWER')).toEqual({ kind: 'non-privileged', roles: ['LOAN_VIEWER'] });
    expect(classifyRolePrivilege(POLICY, 'OPS_GENERIC, XR_TEMP')).toEqual({ kind: 'unclassified', roles: ['OPS_GENERIC', 'XR_TEMP'], unclassified: ['OPS_GENERIC', 'XR_TEMP'] });
    // Exact strings: a lowercase spelling of a privileged role is not that role, and is not guessed to be.
    expect(classifyRolePrivilege(POLICY, 'system_admin')).toMatchObject({ kind: 'unclassified', unclassified: ['system_admin'] });
    // A name that merely LOOKS privileged is unclassified until the policy names it.
    expect(classifyRolePrivilege(POLICY, 'SUPER_ADMIN')).toMatchObject({ kind: 'unclassified' });
    expect(classifyRolePrivilege(POLICY, undefined)).toEqual({ kind: 'unreadable' });
    expect(classifyRolePrivilege(POLICY, '')).toEqual({ kind: 'unreadable' });
  });

  it('labels a policy-consistent privileged Exception and never lets a contradicting proposal decide', () => {
    const fields = p1();
    expect(c2(fields, found('LOAN_ADMIN, SYSTEM_ADMIN'), { value: 'EXCEPTION', confidence: '0.95' })).toMatchObject({ value: 'EXCEPTION', origin: 'AGENT_JUDGED', diagnostics: [`${RETAINED_PRIVILEGED_ASSIGNMENT}LOAN_ADMIN, SYSTEM_ADMIN`] });
    expect(c2(fields, found('LOAN_VIEWER'), { value: 'COMPLIANT', confidence: '0.95' })).toMatchObject({ value: 'COMPLIANT', diagnostics: [] });
    const contradicted = c2(fields, found('LOAN_ADMIN, SYSTEM_ADMIN'), { value: 'COMPLIANT', confidence: '0.99' });
    expect(contradicted.value).toBe('UNEVALUATED');
    expect(contradicted.diagnostics[0]).toBe(`${POLICY_CONTRADICTED}: COMPLIANT proposed for roles LOAN_ADMIN, SYSTEM_ADMIN`);
    expect(c2(fields, found('LOAN_VIEWER'), { value: 'EXCEPTION', confidence: '0.99' })).toMatchObject({ value: 'UNEVALUATED', diagnostics: [`${POLICY_CONTRADICTED}: EXCEPTION proposed for roles LOAN_VIEWER`] });
    // The model may still decline; a declared UNEVALUATED is not a contradiction.
    expect(c2(fields, found('LOAN_ADMIN'), { value: 'UNEVALUATED', confidence: '0.99' })).toMatchObject({ value: 'UNEVALUATED', diagnostics: [] });
    // The stored threshold still applies before the policy reads the proposal.
    expect(c2(fields, found('LOAN_ADMIN'), { value: 'EXCEPTION', confidence: '0.5' })).toMatchObject({ value: 'UNEVALUATED', diagnostics: ['Agent-Judged confidence for C2 is below the stored threshold'] });
    expect(c2(fields, found('LOAN_ADMIN'))).toMatchObject({ value: 'UNEVALUATED', diagnostics: ['missing Agent-Judged evaluation for C2'] });
  });

  it('escalates an unnamed role and reports unreadable roles as the missing field, with or without a proposal', () => {
    const fields = p1();
    const unnamed = c2(fields, found('OPS_GENERIC, XR_TEMP'), { value: 'EXCEPTION', confidence: '0.99' });
    expect(unnamed).toMatchObject({ value: 'UNEVALUATED', diagnostics: [`${RULE_DOES_NOT_NAME_VALUE}OPS_GENERIC`, `${RULE_DOES_NOT_NAME_VALUE}XR_TEMP`] });
    expect(c2(fields, found('OPS_GENERIC, XR_TEMP'))).toMatchObject({ value: 'UNEVALUATED', diagnostics: [`${RULE_DOES_NOT_NAME_VALUE}OPS_GENERIC`, `${RULE_DOES_NOT_NAME_VALUE}XR_TEMP`] });
    expect(c2(fields, found(undefined), { value: 'COMPLIANT', confidence: '0.99' })).toMatchObject({ value: 'UNEVALUATED', diagnostics: [`${MISSING_OBSERVATION_FIELD}roles`] });
    expect(c2(fields, found('n/a'))).toMatchObject({ value: 'UNEVALUATED', diagnostics: [`${RULE_DOES_NOT_NAME_VALUE}n/a`] });
    // Those two rows are decided by the platform and need no proposal; a decidable row does.
    expect(agentJudgedNeedsProposal(c2(fields, found('OPS_GENERIC')))).toBe(false);
    expect(agentJudgedNeedsProposal(c2(fields, found(undefined)))).toBe(false);
    expect(agentJudgedNeedsProposal(c2(fields, found('LOAN_ADMIN')))).toBe(true);
    expect(agentJudgedNeedsProposal(c2(fields, found('LOAN_VIEWER')))).toBe(true);
    expect(agentJudgedNeedsProposal(c2(fields, { values: { found: false }, evidence: { ...evidence, absenceProven: true } }))).toBe(false);
  });

  it('leaves the policy-less C2 exactly as it was: the original undefined-privilege scenario', () => {
    const fields = initialDraftCompliance('P-1');
    expect(c2(fields, found('LOAN_ADMIN, SYSTEM_ADMIN'), { value: 'COMPLIANT', confidence: '0.95' })).toMatchObject({ value: 'COMPLIANT', diagnostics: [] });
    expect(c2(fields, found('OPS_GENERIC'), { value: 'EXCEPTION', confidence: '0.95' })).toMatchObject({ value: 'EXCEPTION', diagnostics: [] });
    expect(agentJudgedNeedsProposal(c2(fields, found('OPS_GENERIC')))).toBe(true);
    expect(conditionInstructionText(fields.complianceConditions[1]!)).toBe(fields.complianceConditions[1]!.text);
  });

  it('renders the policy into the condition instruction deterministically and names both lists', () => {
    const condition = p1().complianceConditions[1]!;
    const text = conditionInstructionText(condition);
    expect(text.startsWith(`${condition.text}\n\n`)).toBe(true);
    expect(text).toContain('Privileged roles: BRANCH_SUPERVISOR, LOAN_ADMIN, SYSTEM_ADMIN');
    expect(text).toContain('Known non-privileged roles: COLLECTIONS_AGENT, LOAN_OFFICER, LOAN_VIEWER, OPS_CLERK, RISK_ANALYST, SERVICING_CLERK, TREASURY_ANALYST');
    expect(text).toContain('do not infer privilege from a role name');
    expect(rolePrivilegeInstruction(POLICY)).toBe(rolePrivilegeInstruction({ ...POLICY }));
    expect(rolePrivilegeInstruction({ ...POLICY, nonPrivileged: [] })).toContain('Known non-privileged roles: (none declared)');
  });
});
