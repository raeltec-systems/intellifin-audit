import { isPreparationSectionId, preparationBasis, refreshPreparation, type SectionPreparation } from '@intellifin/domain';
import type { Clock } from '../audit/clock.js';
import { authorizeCommand } from '../identity/authorize.js';
import type { SessionSnapshot } from '../identity/ports.js';
import { PROCEDURE_AUTHOR_ACTION, PROCEDURE_REFUSALS, procedureVersionRowVersion, type ProcedureDependencies, type ProcedureOutcome } from './create-procedure.js';

export interface ReviewSectionInput {
  readonly session: SessionSnapshot;
  readonly correlationId: string;
  readonly procedureId: string;
  readonly versionId: string;
  readonly expectedRowVersion: string;
  readonly section: unknown;
  readonly decision: unknown;
}
class Refused extends Error {}
/** An acknowledgement of saved content, independent of plan readiness and approval. */
export async function reviewSection(dependencies: ProcedureDependencies & { readonly clock: Clock }, input: ReviewSectionInput): Promise<ProcedureOutcome<{ readonly rowVersion: string }>> {
  const auth = await authorizeCommand({ roles: dependencies.roles, unitOfWork: dependencies.unitOfWork }, { session: input.session, action: PROCEDURE_AUTHOR_ACTION, correlationId: input.correlationId });
  if (!auth.allowed) return { ok: false, reason: auth.reason };
  if (!isPreparationSectionId(input.section) || !['review', 'clarify', 'draft'].includes(String(input.decision))) return { ok: false, reason: 'Choose a valid section and preparation action.' };
  const sectionId = input.section;
  try {
    return await dependencies.unitOfWork.execute(async ({ procedures, auditEvents }) => {
      const row = await procedures.findVersionForUpdate(input.versionId);
      if (!row || row.procedureId !== input.procedureId) throw new Refused(PROCEDURE_REFUSALS.UNKNOWN_VERSION);
      if (row.state !== 'DRAFT') throw new Refused(PROCEDURE_REFUSALS.NOT_A_DRAFT);
      if (procedureVersionRowVersion(row) !== input.expectedRowVersion) throw new Refused(PROCEDURE_REFUSALS.STALE_ROW);
      if (!row.authorship) throw new Refused('The authorship of this draft could not be verified.');
      const state = row.sectionPreparation ?? refreshPreparation(row), current = state.sections[sectionId];
      const basis = preparationBasis(row, sectionId);
      if (basis !== current.basis) throw new Refused('The saved section changed. Reload and review its current content.');
      const at = dependencies.clock.now().toISOString();
      const preparation: SectionPreparation = { ...state, sections: { ...state.sections, [sectionId]: {
        ...current, needsClarification: input.decision === 'clarify',
        review: input.decision === 'review' ? { actorId: input.session.userId, at, basis, revision: current.revision } : null,
      } } };
      const after = { ...row, sectionPreparation: preparation, authorship: { ...row.authorship,
        humanAuthorIds: [...new Set([...row.authorship.humanAuthorIds, input.session.userId])] } };
      await procedures.updateVersion(after);
      await auditEvents.append({ actor: { type: 'human', id: input.session.userId }, eventType: 'lifecycle.procedure-section-prepared',
        source: 'web', outcome: 'success', sessionId: input.session.sessionId, correlationId: input.correlationId, aggregateId: row.procedureId,
        payload: { procedureId: row.procedureId, versionId: row.versionId, section: sectionId, decision: String(input.decision), basis, revision: current.revision } });
      return { ok: true, rowVersion: procedureVersionRowVersion(after) };
    });
  } catch (error) { if (error instanceof Refused) return { ok: false, reason: error.message }; throw error; }
}
