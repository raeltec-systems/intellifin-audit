import { authorizeCommand } from '../identity/authorize.js';
import type { SessionSnapshot } from '../identity/ports.js';
import { PROCEDURE_AUTHOR_ACTION, PROCEDURE_REFUSALS, procedureVersionRowVersion, type ProcedureDependencies, type ProcedureOutcome } from './create-procedure.js';
import { planAuthoringDigest, queuePlanDerivation } from './plan-state.js';

export interface RetryPlanDerivationInput {
  readonly session: SessionSnapshot; readonly correlationId: string;
  readonly procedureId: string; readonly versionId: string; readonly expectedRowVersion: string;
}
export async function retryPlanDerivation(dependencies: ProcedureDependencies, input: RetryPlanDerivationInput): Promise<ProcedureOutcome<{ readonly rowVersion: string }>> {
  const decision = await authorizeCommand({ roles: dependencies.roles, unitOfWork: dependencies.unitOfWork }, { session: input.session, action: PROCEDURE_AUTHOR_ACTION, correlationId: input.correlationId });
  if (!decision.allowed) return { ok: false, reason: decision.reason };
  return dependencies.unitOfWork.execute(async ({ procedures, derivationJobs, auditEvents }) => {
    const row = await procedures.findVersionForUpdate(input.versionId);
    if (row === null || row.procedureId !== input.procedureId) return { ok: false, reason: PROCEDURE_REFUSALS.UNKNOWN_VERSION };
    if (row.state !== 'DRAFT') return { ok: false, reason: PROCEDURE_REFUSALS.NOT_A_DRAFT };
    if (procedureVersionRowVersion(row) !== input.expectedRowVersion) return { ok: false, reason: PROCEDURE_REFUSALS.STALE_ROW };
    if (row.planStatus !== 'failed' || row.planInputDigest !== planAuthoringDigest(row)) return { ok: false, reason: 'Only a failed current Draft derivation can be retried. Reload the saved version.' };
    const after = await queuePlanDerivation(row, derivationJobs);
    await procedures.updateVersion(after);
    await auditEvents.append({ actor: { type: 'human', id: input.session.userId }, eventType: 'lifecycle.procedure-plan-retried', source: 'web', outcome: 'success', sessionId: input.session.sessionId, correlationId: input.correlationId, aggregateId: input.procedureId, payload: { versionId: row.versionId, inputDigest: after.planInputDigest } });
    return { ok: true, rowVersion: procedureVersionRowVersion(after) };
  });
}
