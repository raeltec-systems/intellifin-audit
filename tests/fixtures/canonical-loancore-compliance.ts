import { compileComplianceDraft, complianceInputFromFields, initialDraftCompliance, type PopulationFieldMapping, type RolePrivilegePolicy } from '@intellifin/domain';

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
 * The 24-hour disablement window (owner decision 2, 2026-09-08), authored as a THIRD
 * condition beside the explicit status rule rather than replacing it: an Active account
 * has no disablement instant, and C1 is what makes that an Exception while C3 stays
 * Unevaluated for want of a value. The mapping is the explicit frozen declaration that
 * compiler 1's `termination_time` is the population's `termination_effective_time`.
 */
export const CANONICAL_LOANCORE_C3_WINDOW = 'disabled_time - termination_time <= 24h';
export const CANONICAL_LOANCORE_C3_MAPPING: readonly PopulationFieldMapping[] = [{ field: 'termination_time', column: 'termination_effective_time' }];

/**
 * The canonical LoanCore P-1 Compliance Rule: the explicit status set on C1 and, by
 * default, the frozen role-privilege policy on C2. `{ c2Policy: false }` is the ORIGINAL
 * undefined-privilege scenario, kept as the negative case: without a policy the model
 * must ask for clarification rather than guess. `{ disablementWindow: true }` adds C3.
 */
export function canonicalLoanCoreCompliance(options: { readonly c2Policy?: boolean; readonly disablementWindow?: boolean } = {}) {
  const authored = complianceInputFromFields(initialDraftCompliance('P-1'));
  const compiled = compileComplianceDraft('P-1', {
    ...authored,
    conditions: [
      ...authored.conditions.map(condition => condition.conditionId === 'C1'
        ? { ...condition, text: CANONICAL_LOANCORE_C1 }
        : condition.conditionId === 'C2' && options.c2Policy !== false
          ? { ...condition, policy: CANONICAL_LOANCORE_C2_POLICY }
          : condition),
      ...(options.disablementWindow ? [{
        conditionId: 'C3', text: CANONICAL_LOANCORE_C3_WINDOW, applicability: 'found = true',
        comparison: { boundary: 'inclusive' as const, threshold: '24', tolerance: '0' }, mapping: CANONICAL_LOANCORE_C3_MAPPING,
      }] : []),
    ],
  });
  if (!compiled.ok) throw new Error('Explicit canonical LoanCore rule did not compile.');
  return compiled.value;
}
