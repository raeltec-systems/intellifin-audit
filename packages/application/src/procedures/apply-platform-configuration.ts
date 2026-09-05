import { canonicalJson, PlatformPublicationInputSchema, type JsonValue } from '@intellifin/domain';
import type { AuditUnitOfWork } from '../audit/ports.js';
import type { UuidV7Generator } from '../audit/clock.js';
import type { ProceduresUnitOfWorkContext } from './ports.js';
import type { ModelIdentity } from './plan-ports.js';
import { mintPlatformDraft } from './mint-platform-draft.js';

export interface PlatformConfigurationInput {
  readonly revision: string;
  readonly model: ModelIdentity | null;
  readonly interpreterContract: 'executable-plan-v1';
  readonly changeKind: 'model';
}
/** Explicit release operation, never called by process startup. Secrets cannot enter this contract. */
export async function applyPlatformConfiguration(dependencies: { unitOfWork: AuditUnitOfWork<ProceduresUnitOfWorkContext>; ids: UuidV7Generator }, value: unknown): Promise<readonly string[]> {
  const parsed = PlatformPublicationInputSchema.safeParse(value);
  if (!parsed.success) throw new Error('Unsupported configuration publication. Supply a model change with a valid revision, model (or null), prompt 1 and executable-plan-v1 interpreter.');
  const input = parsed.data;
  const configuration: JsonValue = { model: input.model, interpreterContract: input.interpreterContract, changeKind: input.changeKind };
  canonicalJson(configuration);
  return dependencies.unitOfWork.execute(async context => {
    if (!context.procedures.applyConfigurationRevision) throw new Error('Configuration revision transaction is unavailable.');
    const changed = await context.procedures.applyConfigurationRevision(input.revision, configuration);
    const changeId = `platform:${input.revision}`;
    if (changed) await context.auditEvents.append({ actor: { type: 'system', id: 'release-configuration' }, eventType: 'configuration.procedure-platform-changed', source: 'platform', outcome: 'success', sessionId: 'platform-configuration', correlationId: changeId, aggregateId: 'procedure-platform-configuration', payload: { revision: input.revision, changeKind: input.changeKind } });
    if (!changed && await context.procedures.findChangeResult!(changeId) === null) { await context.procedures.recordChangeResult!(changeId, []); return []; }
    return mintPlatformDraft(context, dependencies.ids, { changeId, kind: input.changeKind, revision: input.revision, model: input.model });
  });
}
