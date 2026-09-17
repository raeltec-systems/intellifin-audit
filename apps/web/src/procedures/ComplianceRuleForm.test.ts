import { complianceInputFromFields, initialDraftCompliance, COMPLIANCE_COMPILER_VERSION } from '@intellifin/domain';
import { describe, expect, it } from 'vitest';

import { storedComplianceInput } from './ComplianceRuleForm';

const DRAFT = { templateId: 'P-1' as const, complianceCompilerVersion: COMPLIANCE_COMPILER_VERSION };

/** C2 is P-1's Agent-Judged condition, the only one a role-privilege policy may bind. */
function withPolicy(privileged: readonly string[], nonPrivileged: readonly string[]) {
  const input = complianceInputFromFields(initialDraftCompliance('P-1'));
  return {
    ...input,
    conditions: input.conditions.map((condition) => condition.conditionId === 'C2'
      ? { ...condition, policy: { kind: 'role-privilege' as const, rolesField: 'roles' as const, privileged: [...privileged], nonPrivileged: [...nonPrivileged] } }
      : condition),
  };
}

/**
 * The section machine compares what it SENT with the snapshot that comes back, so what it
 * records has to be what the server stores — not what was typed. The compiler sorts a
 * policy's role lists, and recording the typed order declared a saved-value conflict after
 * a save that had succeeded, blocking every section review until a reload.
 */
describe('what the Compliance Rule editor records as sent', () => {
  it('carries the compiler\'s own normalisation, so a typed order is not a conflict', () => {
    const typed = withPolicy(
      ['SYSTEM_ADMIN', 'LOAN_ADMIN', 'BRANCH_SUPERVISOR'],
      ['LOAN_OFFICER', 'COLLECTIONS_AGENT'],
    );
    const stored = storedComplianceInput(DRAFT, typed);
    const policy = stored.conditions.find((condition) => condition.conditionId === 'C2')?.policy;
    expect(policy).toEqual({
      kind: 'role-privilege', rolesField: 'roles',
      privileged: ['BRANCH_SUPERVISOR', 'LOAN_ADMIN', 'SYSTEM_ADMIN'],
      nonPrivileged: ['COLLECTIONS_AGENT', 'LOAN_OFFICER'],
    });
    // Already in the compiler's order: recording it must be a no-op, never a rewrite.
    expect(storedComplianceInput(DRAFT, stored)).toEqual(stored);
  });

  it('returns an input the compiler refuses unchanged, so a refusal is not a conflict', () => {
    // Two lists that share a role is a policy the compiler refuses; the command refuses
    // that save too, so the section must report the refusal rather than a stale conflict.
    const refused = withPolicy(['LOAN_ADMIN'], ['LOAN_ADMIN']);
    expect(storedComplianceInput(DRAFT, refused)).toBe(refused);
  });
});
