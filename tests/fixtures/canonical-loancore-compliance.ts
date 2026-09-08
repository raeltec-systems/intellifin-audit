import { compileComplianceDraft, complianceInputFromFields, initialDraftCompliance, type RolePrivilegePolicy } from '@intellifin/domain';

/** Explicitly authored fixture rule, frozen before initiation. Compiler-1 defaults
 * name lowercase values; canonical LoanCore displays capitalized values. §B does
 * not authorize case-folding or a human answer that maps an unnamed value. */
export const CANONICAL_LOANCORE_C1 = 'found = false or account_status in [Disabled] else [Active]';

/**
 * The owner's synthetic role-privilege policy (decision of 2026-09-08), authored as an
 * explicit, reviewable binding on P-1's Agent-Judged C2. Privilege is never inferred
 * from a role's name: OPS_GENERIC and XR_TEMP (E-000119) are in neither list, so that
 * record stays the ambiguous case and is escalated rather than guessed.
 */
export const CANONICAL_LOANCORE_C2_POLICY: RolePrivilegePolicy = {
  kind: 'role-privilege', rolesField: 'roles',
  privileged: ['SYSTEM_ADMIN', 'LOAN_ADMIN', 'BRANCH_SUPERVISOR'],
  nonPrivileged: ['LOAN_VIEWER', 'LOAN_OFFICER', 'COLLECTIONS_AGENT', 'TREASURY_ANALYST', 'SERVICING_CLERK', 'RISK_ANALYST', 'OPS_CLERK'],
};

/**
 * The canonical LoanCore P-1 Compliance Rule: the explicit status set on C1 and, by
 * default, the frozen role-privilege policy on C2. `{ c2Policy: false }` is the ORIGINAL
 * undefined-privilege scenario, kept as the negative case: without a policy the model
 * must ask for clarification rather than guess.
 */
export function canonicalLoanCoreCompliance(options: { readonly c2Policy?: boolean } = {}) {
  const authored = complianceInputFromFields(initialDraftCompliance('P-1'));
  const compiled = compileComplianceDraft('P-1', {
    ...authored,
    conditions: authored.conditions.map(condition => condition.conditionId === 'C1'
      ? { ...condition, text: CANONICAL_LOANCORE_C1 }
      : condition.conditionId === 'C2' && options.c2Policy !== false
        ? { ...condition, policy: CANONICAL_LOANCORE_C2_POLICY }
        : condition),
  });
  if (!compiled.ok) throw new Error('Explicit canonical LoanCore rule did not compile.');
  return compiled.value;
}
