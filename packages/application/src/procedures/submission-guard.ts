import { completenessReason } from '@intellifin/domain';
import type { ProcedureVersionRecord } from './ports.js';
import { planAuthoringDigest, planAuthoringInputs } from './plan-state.js';

/**
 * Reads the saved signal; no compiler or model is invoked here.
 *
 * The plan sentences say "test plan" and "prepare" (UI cleanup 2026-09-22, UX-16):
 * "derive" named the worker's mechanism, not anything an auditor asked for.
 */
export function submissionUnavailableReason(row: ProcedureVersionRecord): string | null {
  if (row.sectionPreparation && Object.values(row.sectionPreparation.sections).some(s => s.needsClarification)) return 'Resolve sections marked Needs clarification before submitting.';
  if (row.state !== 'DRAFT') return 'Only a Draft can be submitted.';
  const completeness = completenessReason(planAuthoringInputs(row));
  if (completeness) return completeness;
  if (row.planStatus === 'pending') return 'Wait for the test plan to finish preparing.';
  if (row.planStatus !== 'succeeded' || !row.planDerivable || !row.compiledPlan || row.planInputDigest !== planAuthoringDigest(row)) {
    return row.planFailureReason ? `The test plan could not be prepared: ${row.planFailureReason}` : 'Prepare the current test plan before submitting.';
  }
  if (!row.authorship) return 'The responsible author of this Procedure Version could not be verified.';
  return null;
}
