import { authorizeAction, type Role } from '@intellifin/domain';
import { authorizeCommand, recordAuthorizationDenial } from '../identity/authorize.js';
import { procedureVersionRowVersion, type ProcedureDependencies, type ProcedureOutcome } from './create-procedure.js';
import type { VersionTransitionInput } from './decide-version.js';
import { copyActiveDraft } from './mint-platform-draft.js';
class PermissionRefused extends Error { constructor(reason: string, readonly role: Role | null) { super(reason); } }

export async function newProcedureVersion(dependencies: ProcedureDependencies, input: VersionTransitionInput): Promise<ProcedureOutcome<{ versionId: string }>> {
  const permission = await authorizeCommand(dependencies, { session: input.session, correlationId: input.correlationId, action: 'procedure.author' });
  if (!permission.allowed) return { ok: false, reason: permission.reason };
  try { return await dependencies.unitOfWork.execute(async context => {
    const role = await context.authorizationRoles.findRole(input.session.userId);
    const lockedPermission = authorizeAction(role, 'procedure.author');
    if (!lockedPermission.allowed) throw new PermissionRefused(lockedPermission.reason, role);
    const before = await context.procedures.findVersionForUpdate(input.versionId);
    if (!before || before.procedureId !== input.procedureId || before.state !== 'ACTIVE') return { ok: false, reason: 'New version requires an Active Procedure Version.' };
    if (procedureVersionRowVersion(before) !== input.expectedRowVersion) return { ok: false, reason: 'That Procedure Version changed. Reload the page.' };
    const draft = await copyActiveDraft(context, dependencies.ids, before, input.session.userId, null, {}, { sessionId: input.session.sessionId, correlationId: input.correlationId });
    return { ok: true, versionId: draft.versionId };
  }); } catch (error) {
    if (!(error instanceof PermissionRefused)) throw error;
    await recordAuthorizationDenial(dependencies, { session: input.session, correlationId: input.correlationId, action: 'procedure.author' }, error.role, error.message);
    return { ok: false, reason: error.message };
  }
}
