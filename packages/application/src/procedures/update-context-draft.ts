import { canonicalJson, draftContext, isDraftContextEdit, sha256Hex, withDraftContext, type DraftContextEdit, type JsonValue } from '@intellifin/domain';
import { authorizeCommand } from '../identity/authorize.js';
import type { SessionSnapshot } from '../identity/ports.js';
import { PROCEDURE_AUTHOR_ACTION, PROCEDURE_DRAFT_CHANGED_EVENT, PROCEDURE_REFUSALS, procedureVersionRowVersion, type ProcedureDependencies, type ProcedureOutcome } from './create-procedure.js';
import { queuePlanDerivation } from './plan-state.js';

export interface UpdateContextDraftInput {
  readonly session: SessionSnapshot;
  readonly correlationId: string;
  readonly procedureId: string;
  readonly versionId: string;
  readonly expectedRowVersion: string;
  readonly edit: DraftContextEdit;
}
export type UpdateContextDraftResult = ProcedureOutcome<{ readonly rowVersion: string; readonly changed: boolean }>;
class Refused extends Error {}

/** Same authorised, locked, audited write path as the existing structured editors. */
export async function updateContextDraft(dependencies: ProcedureDependencies, input: UpdateContextDraftInput): Promise<UpdateContextDraftResult> {
  const decision = await authorizeCommand({ roles: dependencies.roles, unitOfWork: dependencies.unitOfWork }, { session: input.session, action: PROCEDURE_AUTHOR_ACTION, correlationId: input.correlationId });
  if (!decision.allowed) return { ok: false, reason: decision.reason };
  if (!isDraftContextEdit(input.edit)) return { ok: false, reason: 'Enter an objective and keep each context field within 4,000 characters.' };
  try {
    return await dependencies.unitOfWork.execute(async ({ procedures, derivationJobs, auditEvents }) => {
      const before = await procedures.findVersionForUpdate(input.versionId);
      if (before === null || before.procedureId !== input.procedureId) throw new Refused(PROCEDURE_REFUSALS.UNKNOWN_VERSION);
      if (before.state !== 'DRAFT') throw new Refused(PROCEDURE_REFUSALS.NOT_A_DRAFT);
      if (procedureVersionRowVersion(before) !== input.expectedRowVersion) throw new Refused(PROCEDURE_REFUSALS.STALE_ROW);
      let after = { ...before, sections: withDraftContext(before.sections, input.edit) };
      if (procedureVersionRowVersion(after) === input.expectedRowVersion) return { ok: true, rowVersion: input.expectedRowVersion, changed: false };
      after = await queuePlanDerivation(after, derivationJobs, input.session.userId);
      await procedures.updateVersion(after);
      const fingerprint = (sections: typeof before.sections) => sha256Hex(canonicalJson(draftContext(sections) as unknown as JsonValue));
      await auditEvents.append({
        actor: { type: 'human', id: input.session.userId }, eventType: PROCEDURE_DRAFT_CHANGED_EVENT,
        source: 'web', outcome: 'success', sessionId: input.session.sessionId, correlationId: input.correlationId,
        aggregateId: input.procedureId,
        payload: { procedureId: input.procedureId, versionId: input.versionId, versionNumber: before.versionNumber,
          section: 'context', priorDigest: fingerprint(before.sections), currentDigest: fingerprint(after.sections) },
      });
      return { ok: true, rowVersion: procedureVersionRowVersion(after), changed: true };
    });
  } catch (error) {
    if (error instanceof Refused) return { ok: false, reason: error.message };
    throw error;
  }
}
