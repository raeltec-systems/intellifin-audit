'use server';
import { revalidatePath } from 'next/cache';
import { transitionVersion } from '@intellifin/application';
import { CryptoUuidV7Generator, DrizzleRoleRepository, PostgresProceduresUnitOfWork } from '@intellifin/infrastructure';
import type { VersionDecision } from '@intellifin/domain';
import { getRuntime } from '../../src/bootstrap';
import { currentIdentity, currentCorrelationId } from '../../src/server-session';

export interface VersionActionFields { readonly procedureId: string; readonly versionId: string; readonly expectedRowVersion: string; readonly decision: VersionDecision; readonly rationale?: string | null }
export async function versionDecisionAction(fields: VersionActionFields): Promise<{ ok: true } | { ok: false; reason: string; unknownOutcome?: boolean }> {
  const identity = await currentIdentity();
  if (identity.kind !== 'identified') return { ok: false, reason: 'Sign in to continue.' };
  if (!fields || typeof fields !== 'object' || Object.keys(fields).some(key => !['procedureId','versionId','expectedRowVersion','decision','rationale'].includes(key)) || !['submit','approve','reject','edit'].includes(fields.decision) || ![fields.procedureId,fields.versionId].every(value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(value)) || typeof fields.expectedRowVersion !== 'string' || !/^[0-9a-f]{64}$/.test(fields.expectedRowVersion)) return { ok: false, reason: 'That request was not valid. Nothing was changed.' };
  const runtime = await getRuntime();
  const correlationId = await currentCorrelationId();
  try {
    const result = await transitionVersion({ roles: new DrizzleRoleRepository(runtime.db), unitOfWork: new PostgresProceduresUnitOfWork(runtime.db), ids: new CryptoUuidV7Generator() }, { procedureId: fields.procedureId, versionId: fields.versionId, expectedRowVersion: fields.expectedRowVersion, rationale: fields.rationale, session: identity.session, correlationId }, fields.decision);
    if (result.ok) { revalidatePath(`/procedures/${fields.procedureId}`); revalidatePath(`/procedures/${fields.procedureId}/versions/${fields.versionId}`); revalidatePath('/notifications'); }
    return result;
  } catch (error) {
    runtime.telemetry.captureError('Procedure Version decision failed', error, { correlationId, outcome: 'failure' });
    return { ok: false, reason: 'The decision could not be confirmed. Reload the page before trying again.', unknownOutcome: true };
  }
}
