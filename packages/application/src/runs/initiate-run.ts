import { authorizeAction, isExplicitPeriod, isInitiationRequestToken, type RunRecord, type Role } from '@intellifin/domain';
import type { Clock, UuidV7Generator } from '../audit/clock.js';
import type { AuditUnitOfWork } from '../audit/ports.js';
import { authorizeCommandRole, recordAuthorizationDenial } from '../identity/authorize.js';
import type { RoleRepository, SessionSnapshot } from '../identity/ports.js';
import type { RunsUnitOfWorkContext } from './ports.js';
export interface RunDependencies { readonly roles: RoleRepository; readonly unitOfWork: AuditUnitOfWork<RunsUnitOfWorkContext>; readonly ids: UuidV7Generator; readonly clock: Clock }
export type InitiateRunOutcome = { readonly ok: true; readonly runId: string } | { readonly ok: false; readonly reason: string; readonly existingRunId?: string };
class Revoked extends Error { constructor(readonly role: Role | null, reason: string) { super(reason); } }
export const NO_RUN_OWNER = 'No executable Active version owns that period. Check the approved version and handover dates.';
export async function initiateRun(dependencies: RunDependencies, input: { session: SessionSnapshot; request: unknown }): Promise<InitiateRunOutcome> {
  const correlationId = dependencies.ids.next();
  const authorization = { session: input.session, correlationId, action: 'run.initiate' as const };
  const permission = await authorizeCommandRole(dependencies, authorization);
  if (!permission.allowed) return { ok: false, reason: permission.reason };
  const request = input.request;
  if (!request || typeof request !== 'object' || Array.isArray(request) || Object.keys(request).length !== 3 || !Object.hasOwn(request, 'procedureId') || !Object.hasOwn(request, 'period') || !Object.hasOwn(request, 'requestToken') || !('procedureId' in request) || typeof request.procedureId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(request.procedureId) || !('requestToken' in request) || !isInitiationRequestToken(request.requestToken) || !('period' in request) || !isExplicitPeriod(request.period)) return { ok: false, reason: 'Choose a valid Procedure and inclusive start and end dates.' };
  const { period } = request;
  const procedureId = request.procedureId.toLowerCase(), requestToken = request.requestToken.toLowerCase();
  try {
    return await dependencies.unitOfWork.execute(async context => {
      const role = await context.authorizationRoles.findRole(input.session.userId);
      const locked = authorizeAction(role, 'run.initiate');
      if (!locked.allowed) throw new Revoked(role, locked.reason);
      const priorRequest = await context.runs.findRequest(input.session.userId, requestToken);
      if (priorRequest) {
        if (priorRequest.procedureId !== procedureId || priorRequest.period.from !== period.from || priorRequest.period.to !== period.to) return { ok: false, reason: 'That initiation token was already used for a different Procedure or period. Start a fresh initiation.' };
        return { ok: true, runId: priorRequest.runId };
      }
      const active = await context.runs.findActive(procedureId, period);
      if (active) {
        await context.runs.bindRequest(input.session.userId, requestToken, active.runId);
        return { ok: false, reason: 'An active Run already exists for this Procedure and period.', existingRunId: active.runId };
      }
      const owner = await context.procedures.findPeriodOwner(procedureId, period);
      if (!owner || owner.state !== 'ACTIVE' || !owner.frozenReview) return { ok: false, reason: NO_RUN_OWNER };
      const run: RunRecord = { runId: dependencies.ids.next(), requestToken, correlationId, procedureId, versionId: owner.versionId, versionNumber: owner.versionNumber, procedureName: owner.controlName,
        period, state: 'QUEUED', kind: 'STANDARD', initiatorId: input.session.userId, sessionId: input.session.sessionId, initiatedAt: dependencies.clock.now().toISOString(), authorizationRole: role! };
      if (!await context.runs.insert(run)) {
        const existing = await context.runs.findActive(procedureId, period);
        if (existing) await context.runs.bindRequest(input.session.userId, requestToken, existing.runId);
        return { ok: false, reason: 'An active Run already exists for this Procedure and period.', ...(existing ? { existingRunId: existing.runId } : {}) };
      }
      await context.runs.bindRequest(input.session.userId, requestToken, run.runId);
      await context.dispatch.enqueue({ schemaVersion: 1, runId: run.runId, correlationId });
      const event = await context.auditEvents.append({ actor: { type: 'human', id: run.initiatorId }, eventType: 'lifecycle.run-queued', source: 'web', outcome: 'success', aggregateId: run.runId, correlationId, sessionId: run.sessionId,
        payload: { priorState: null, state: 'QUEUED', reason: 'Auditor initiated a Standard Run.', occurredAt: run.initiatedAt, procedureId, versionId: run.versionId, period: { ...period }, authorizationRole: run.authorizationRole } });
      await context.notifyTimeline(run.runId, event.sequence);
      return { ok: true, runId: run.runId };
    });
  } catch (error) {
    if (error instanceof Revoked) { await recordAuthorizationDenial(dependencies, authorization, error.role, error.message); return { ok: false, reason: error.message }; }
    throw error;
  }
}
