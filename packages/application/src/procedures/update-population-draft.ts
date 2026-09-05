import { queuePlanDerivation } from './plan-state.js';
import { bindingDigestEnvelope, isExplicitPeriod, isScopeStatement, isInclusionRule, populationBlockersFor, validatePopulationBinding, POPULATION_DRAFT_MESSAGES, type ProcedureSourceSnapshot, type JsonValue } from '@intellifin/domain';
import { authorizeCommand } from '../identity/authorize.js';
import type { SessionSnapshot } from '../identity/ports.js';
import { PROCEDURE_AUTHOR_ACTION, PROCEDURE_DRAFT_CHANGED_EVENT, PROCEDURE_REFUSALS, procedureVersionRowVersion, type ProcedureDependencies, type ProcedureOutcome } from './create-procedure.js';
import type { ProcedureVersionRecord } from './ports.js';

export type DraftPopulationEdit =
  | { readonly section: 'period-scope'; readonly period: unknown; readonly scope: unknown }
  | { readonly section: 'population-source'; readonly source: { readonly mode: 'retain' } | { readonly mode: 'bind'; readonly bindingId: string; readonly expectedDigest: string }; readonly inclusionRule: unknown; readonly zeroRecordPass: unknown; readonly allowVersionedDuplicates: unknown };
export interface UpdatePopulationDraftInput {
  readonly session: SessionSnapshot;
  readonly correlationId: string;
  readonly procedureId: string;
  readonly versionId: string;
  readonly expectedRowVersion: string;
  readonly edit: DraftPopulationEdit;
}
export type UpdatePopulationDraftResult = ProcedureOutcome<{ readonly rowVersion: string; readonly changed: boolean }>;
class Refused extends Error {}

/** Both editors guard the whole row. Source reads and the audit append share its transaction. */
export async function updatePopulationDraft(dependencies: ProcedureDependencies, input: UpdatePopulationDraftInput): Promise<UpdatePopulationDraftResult> {
  const decision = await authorizeCommand({ roles: dependencies.roles, unitOfWork: dependencies.unitOfWork }, { session: input.session, action: PROCEDURE_AUTHOR_ACTION, correlationId: input.correlationId });
  if (!decision.allowed) return { ok: false, reason: decision.reason };
  const edit = input.edit;
  if (edit.section === 'period-scope') {
    if (!isExplicitPeriod(edit.period)) return { ok: false, reason: POPULATION_DRAFT_MESSAGES.PERIOD };
    if (!isScopeStatement(edit.scope)) return { ok: false, reason: POPULATION_DRAFT_MESSAGES.SCOPE };
  } else if (edit.section === 'population-source') {
    if (!isInclusionRule(edit.inclusionRule)) return { ok: false, reason: POPULATION_DRAFT_MESSAGES.RULE };
    if (typeof edit.zeroRecordPass !== 'boolean' || typeof edit.allowVersionedDuplicates !== 'boolean') return { ok: false, reason: POPULATION_DRAFT_MESSAGES.FLAGS };
  } else return { ok: false, reason: POPULATION_DRAFT_MESSAGES.RULE };
  try {
    return await dependencies.unitOfWork.execute(async ({ derivationJobs, procedures, populationSources, auditEvents }) => {
      const before = await procedures.findVersionForUpdate(input.versionId);
      if (before === null || before.procedureId !== input.procedureId) throw new Refused(PROCEDURE_REFUSALS.UNKNOWN_VERSION);
      if (before.state !== 'DRAFT') throw new Refused(PROCEDURE_REFUSALS.NOT_A_DRAFT);
      if (procedureVersionRowVersion(before) !== input.expectedRowVersion) throw new Refused(PROCEDURE_REFUSALS.STALE_ROW);
      let after: ProcedureVersionRecord;
      if (edit.section === 'period-scope') {
        // Narrow again at the domain boundary; the persisted text is verbatim.
        if (!isExplicitPeriod(edit.period) || !isScopeStatement(edit.scope)) throw new Refused(POPULATION_DRAFT_MESSAGES.PERIOD);
        after = { ...before, period: edit.period, scope: edit.scope };
      } else {
        let source: ProcedureSourceSnapshot | null = before.sourceSnapshot;
        if (edit.source.mode === 'bind') {
          const binding = await populationSources.findBindingForShare(edit.source.bindingId);
          if (binding === null || binding.status !== 'active') throw new Refused(POPULATION_DRAFT_MESSAGES.SOURCE);
          if (binding.digest !== edit.source.expectedDigest) throw new Refused(POPULATION_DRAFT_MESSAGES.STALE_SOURCE);
          source = { bindingId: binding.bindingId, displayName: binding.displayName, digest: binding.digest, contract: bindingDigestEnvelope(binding) };
        } else if (edit.source.mode !== 'retain') throw new Refused(POPULATION_DRAFT_MESSAGES.SOURCE);
        if (source === null) throw new Refused(POPULATION_DRAFT_MESSAGES.SOURCE);
        const refusal = validatePopulationBinding(source, edit.inclusionRule);
        if (refusal !== null) throw new Refused(refusal);
        if (!isInclusionRule(edit.inclusionRule) || typeof edit.zeroRecordPass !== 'boolean' || typeof edit.allowVersionedDuplicates !== 'boolean') throw new Refused(POPULATION_DRAFT_MESSAGES.RULE);
        after = { ...before, sourceSnapshot: source, inclusionRule: edit.inclusionRule, zeroRecordPass: edit.zeroRecordPass, allowVersionedDuplicates: edit.allowVersionedDuplicates, populationBlockers: populationBlockersFor(source) };
      }
      let rowVersion = procedureVersionRowVersion(after);
      if (rowVersion === input.expectedRowVersion) return { ok: true, rowVersion, changed: false };
      after = await queuePlanDerivation(after, derivationJobs, input.session.userId);
      rowVersion = procedureVersionRowVersion(after);
      await procedures.updateVersion(after);
      const values = (row: ProcedureVersionRecord): JsonValue => edit.section === 'period-scope'
        ? { period: row.period as unknown as JsonValue, scope: row.scope }
        : { sourceSnapshot: row.sourceSnapshot as unknown as JsonValue, inclusionRule: row.inclusionRule as unknown as JsonValue, zeroRecordPass: row.zeroRecordPass, allowVersionedDuplicates: row.allowVersionedDuplicates, populationBlockers: [...row.populationBlockers] };
      await auditEvents.append({ actor: { type: 'human', id: input.session.userId }, eventType: PROCEDURE_DRAFT_CHANGED_EVENT, source: 'web', outcome: 'success', sessionId: input.session.sessionId, correlationId: input.correlationId, aggregateId: input.procedureId, payload: { procedureId: input.procedureId, versionId: input.versionId, versionNumber: before.versionNumber, section: edit.section, prior: values(before), current: values(after) } });
      return { ok: true, rowVersion, changed: true };
    });
  } catch (error) {
    if (error instanceof Refused) return { ok: false, reason: error.message };
    throw error;
  }
}
