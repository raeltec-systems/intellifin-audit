import { compileComplianceDraft, complianceInputFromFields, initialDraftCompliance } from '@intellifin/domain';

/** Explicitly authored fixture rule, frozen before initiation. Compiler-1 defaults
 * name lowercase values; canonical LoanCore displays capitalized values. §B does
 * not authorize case-folding or a human answer that maps an unnamed value. */
export const CANONICAL_LOANCORE_C1 = 'found = false or account_status in [Disabled] else [Active]';
export function canonicalLoanCoreCompliance() {
  const authored = complianceInputFromFields(initialDraftCompliance('P-1'));
  const compiled = compileComplianceDraft('P-1', {
    ...authored,
    conditions: authored.conditions.map(condition => condition.conditionId === 'C1'
      ? { ...condition, text: CANONICAL_LOANCORE_C1 }
      : condition),
  });
  if (!compiled.ok) throw new Error('Explicit canonical LoanCore status rule did not compile.');
  return compiled.value;
}
