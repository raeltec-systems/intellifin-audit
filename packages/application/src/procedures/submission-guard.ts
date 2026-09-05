import { completenessReason } from '@intellifin/domain';
import type { ProcedureVersionRecord } from './ports.js';
import { planAuthoringDigest, planAuthoringInputs } from './plan-state.js';

/** Reads the saved signal; no compiler or model is invoked here. */
export function submissionUnavailableReason(row: ProcedureVersionRecord): string | null {
  if (row.state !== 'DRAFT') return 'Only a Draft can be submitted.';
  const completeness = completenessReason(planAuthoringInputs(row));
  if (completeness) return completeness;
  if (row.planStatus === 'pending') return 'Wait for the executable plan to finish deriving.';
  if (row.planStatus !== 'succeeded' || !row.planDerivable || !row.compiledPlan || row.planInputDigest !== planAuthoringDigest(row)) {
    return row.planFailureReason ? `Cannot derive: ${row.planFailureReason}` : 'Derive the current executable plan before submitting.';
  }
  if (!row.authorship) return 'The responsible author of this Procedure Version could not be verified.';
  return null;
}
