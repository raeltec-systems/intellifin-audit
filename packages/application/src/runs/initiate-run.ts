import { authorizeAction, isActiveRunState, isExplicitPeriod, isInitiationRequestToken, RUN_REASON_MAX_LENGTH, RUN_RERUN_DEFAULT_REASON, RUN_RERUN_REFUSALS, type ExplicitPeriod, type RunRecord, type Role } from '@intellifin/domain';
import type { Clock, UuidV7Generator } from '../audit/clock.js';
import type { AuditUnitOfWork } from '../audit/ports.js';
import { authorizeCommandRole, recordAuthorizationDenial } from '../identity/authorize.js';
import type { RoleRepository, SessionSnapshot } from '../identity/ports.js';
import type { RunsUnitOfWorkContext } from './ports.js';
export interface RunDependencies { readonly roles: RoleRepository; readonly unitOfWork: AuditUnitOfWork<RunsUnitOfWorkContext>; readonly ids: UuidV7Generator; readonly clock: Clock }
export type InitiateRunOutcome = { readonly ok: true; readonly runId: string } | { readonly ok: false; readonly reason: string; readonly existingRunId?: string };
class Revoked extends Error { constructor(readonly role: Role | null, reason: string) { super(reason); } }
export const NO_RUN_OWNER = 'No executable Active version owns that period. Check the approved version and handover dates.';
export const RUN_REQUEST_MALFORMED = 'Choose a valid Procedure and inclusive start and end dates.';
export const RERUN_REQUEST_MALFORMED = 'Choose a Run that has ended, and a reason of at most 500 characters.';
export const RUN_TOKEN_REUSED = 'That initiation token was already used for a different Procedure or period. Start a fresh initiation.';
export const RUN_ALREADY_ACTIVE = 'An active Run already exists for this Procedure and period.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The predecessor a rerun records, and the reason it exists. */
interface RerunLink { readonly predecessorRunId: string; readonly reason: string }

/**
 * The ONE path that creates a Run (Story 3.1, extended by Story 3.10).
 *
 * Initiation and rerun differ in where the Procedure and the period come from — a rerun
 * takes both from its predecessor rather than from the caller, so a "rerun" can never
 * point at another Procedure — and in the link the new row records. Everything after that
 * is identical and is written once: the request-token idempotency check, the active-Run
 * check, the period owner resolved AFRESH, the insert under the partial unique index, the
 * dispatch, the first Timeline event.
 *
 * Resolving the owner afresh is what makes a rerun after a version handover run the
 * version that NOW owns the period, and is why a period with no `ACTIVE` owner is refused
 * with initiation's own sentence rather than with a second one.
 */
async function createRun(
  dependencies: RunDependencies,
  context: RunsUnitOfWorkContext,
  input: { session: SessionSnapshot; correlationId: string; role: string; procedureId: string; period: ExplicitPeriod; requestToken: string; link: RerunLink | null },
): Promise<InitiateRunOutcome> {
  const { procedureId, period, requestToken, link } = input;
  const active = await context.runs.findActive(procedureId, period);
  if (active) {
    await context.runs.bindRequest(input.session.userId, requestToken, active.runId);
    return { ok: false, reason: RUN_ALREADY_ACTIVE, existingRunId: active.runId };
  }
  const owner = await context.procedures.findPeriodOwner(procedureId, period);
  if (!owner || owner.state !== 'ACTIVE' || !owner.frozenReview) return { ok: false, reason: NO_RUN_OWNER };
  const run: RunRecord = { runId: dependencies.ids.next(), requestToken, correlationId: input.correlationId, procedureId, versionId: owner.versionId, versionNumber: owner.versionNumber, procedureName: owner.controlName,
    period, state: 'QUEUED', kind: 'STANDARD', initiatorId: input.session.userId, sessionId: input.session.sessionId, initiatedAt: dependencies.clock.now().toISOString(), authorizationRole: input.role,
    predecessorRunId: link?.predecessorRunId ?? null, rerunReason: link?.reason ?? null, cancellation: null };
  if (!await context.runs.insert(run)) {
    const existing = await context.runs.findActive(procedureId, period);
    if (existing) await context.runs.bindRequest(input.session.userId, requestToken, existing.runId);
    return { ok: false, reason: RUN_ALREADY_ACTIVE, ...(existing ? { existingRunId: existing.runId } : {}) };
  }
  await context.runs.bindRequest(input.session.userId, requestToken, run.runId);
  await context.dispatch.enqueue({ schemaVersion: 1, runId: run.runId, correlationId: input.correlationId });
  const event = await context.auditEvents.append({ actor: { type: 'human', id: run.initiatorId }, eventType: 'lifecycle.run-queued', source: 'web', outcome: 'success', aggregateId: run.runId, correlationId: input.correlationId, sessionId: run.sessionId,
    payload: { priorState: null, state: 'QUEUED', reason: link === null ? 'Auditor initiated a Standard Run.' : link.reason, occurredAt: run.initiatedAt, procedureId, versionId: run.versionId, period: { ...period }, authorizationRole: run.authorizationRole,
      // The link is on the NEW Run's chain and nowhere else. A rerun leaves the
      // predecessor's row, Evidence, Observations, Result AND audit chain untouched, so
      // "unchanged" is checkable as a head hash rather than as a promise.
      predecessorRunId: link?.predecessorRunId ?? null } });
  await context.notifyTimeline(run.runId, event.sequence);
  return { ok: true, runId: run.runId };
}

/** A request token already spent: the same Run, or a refusal naming the mismatch. */
function replay(prior: RunRecord, procedureId: string, period: ExplicitPeriod): InitiateRunOutcome {
  if (prior.procedureId !== procedureId || prior.period.from !== period.from || prior.period.to !== period.to) return { ok: false, reason: RUN_TOKEN_REUSED };
  return { ok: true, runId: prior.runId };
}

export async function initiateRun(dependencies: RunDependencies, input: { session: SessionSnapshot; request: unknown }): Promise<InitiateRunOutcome> {
  const correlationId = dependencies.ids.next();
  const authorization = { session: input.session, correlationId, action: 'run.initiate' as const };
  const permission = await authorizeCommandRole(dependencies, authorization);
  if (!permission.allowed) return { ok: false, reason: permission.reason };
  const request = input.request;
  if (!request || typeof request !== 'object' || Array.isArray(request) || Object.keys(request).length !== 3 || !Object.hasOwn(request, 'procedureId') || !Object.hasOwn(request, 'period') || !Object.hasOwn(request, 'requestToken') || !('procedureId' in request) || typeof request.procedureId !== 'string' || !UUID.test(request.procedureId) || !('requestToken' in request) || !isInitiationRequestToken(request.requestToken) || !('period' in request) || !isExplicitPeriod(request.period)) return { ok: false, reason: RUN_REQUEST_MALFORMED };
  const { period } = request;
  const procedureId = request.procedureId.toLowerCase(), requestToken = request.requestToken.toLowerCase();
  try {
    return await dependencies.unitOfWork.execute(async context => {
      const role = await context.authorizationRoles.findRole(input.session.userId);
      const locked = authorizeAction(role, 'run.initiate');
      if (!locked.allowed) throw new Revoked(role, locked.reason);
      const priorRequest = await context.runs.findRequest(input.session.userId, requestToken);
      if (priorRequest) return replay(priorRequest, procedureId, period);
      return createRun(dependencies, context, { session: input.session, correlationId, role: role!, procedureId, period, requestToken, link: null });
    });
  } catch (error) {
    if (error instanceof Revoked) { await recordAuthorizationDenial(dependencies, authorization, error.role, error.message); return { ok: false, reason: error.message }; }
    throw error;
  }
}

/**
 * `Rerun`: a new Run that records the terminal Run it follows and why it exists.
 *
 * A rerun is a NEW Run, not a copy. There is deliberately NO `run.rerun` gated action —
 * starting a Run is starting a Run, so it is gated by `run.initiate`, which the same two
 * roles hold; `roles.test.ts` asserts all 24 actions against all 3 roles, so a synonym
 * would break a completeness claim about the table EXPERIENCE.md is transcribed from.
 *
 * The Procedure and the period come from the PREDECESSOR, never from the caller: a caller
 * that could supply them could point a "rerun" at a different Procedure entirely, and the
 * link would then record a predecessor that has nothing to do with the work.
 *
 * The predecessor row, its Evidence, its Observations, its Result and its audit chain are
 * never touched. Nothing here writes to it — the only reference to it is the id the new
 * row and the new Run's own first event carry.
 */
export async function rerunRun(dependencies: RunDependencies, input: { session: SessionSnapshot; request: unknown }): Promise<InitiateRunOutcome> {
  const correlationId = dependencies.ids.next();
  const authorization = { session: input.session, correlationId, action: 'run.initiate' as const };
  const permission = await authorizeCommandRole(dependencies, authorization);
  if (!permission.allowed) return { ok: false, reason: permission.reason };
  const request = input.request;
  // The argument is untrusted whatever its TypeScript type says: an exact key set, a
  // bounded reason, and a Run id that is really one.
  if (!request || typeof request !== 'object' || Array.isArray(request) || Object.keys(request).length !== 3 || !Object.hasOwn(request, 'predecessorRunId') || !Object.hasOwn(request, 'requestToken') || !Object.hasOwn(request, 'reason') ||
    !('predecessorRunId' in request) || typeof request.predecessorRunId !== 'string' || !UUID.test(request.predecessorRunId) ||
    !('requestToken' in request) || !isInitiationRequestToken(request.requestToken) ||
    !('reason' in request) || (request.reason !== null && (typeof request.reason !== 'string' || request.reason.trim().length === 0 || request.reason.length > RUN_REASON_MAX_LENGTH))) return { ok: false, reason: RERUN_REQUEST_MALFORMED };
  const predecessorRunId = request.predecessorRunId.toLowerCase(), requestToken = request.requestToken.toLowerCase();
  const reason = typeof request.reason === 'string' ? request.reason.trim() : RUN_RERUN_DEFAULT_REASON;
  try {
    return await dependencies.unitOfWork.execute(async context => {
      const role = await context.authorizationRoles.findRole(input.session.userId);
      const locked = authorizeAction(role, 'run.initiate');
      if (!locked.allowed) throw new Revoked(role, locked.reason);
      const predecessor = await context.runs.findRun(predecessorRunId);
      if (predecessor === null) return { ok: false, reason: RUN_RERUN_REFUSALS.UNKNOWN };
      // Read INSIDE the transaction that writes, so a Run that becomes terminal while
      // this rerun is refused, and a Run cancelled a moment ago, each see one committed
      // answer rather than a state read through the pool a moment earlier.
      if (isActiveRunState(predecessor.state)) return { ok: false, reason: RUN_RERUN_REFUSALS.STILL_ACTIVE, existingRunId: predecessor.runId };
      const priorRequest = await context.runs.findRequest(input.session.userId, requestToken);
      if (priorRequest) return replay(priorRequest, predecessor.procedureId, predecessor.period);
      return createRun(dependencies, context, { session: input.session, correlationId, role: role!, procedureId: predecessor.procedureId, period: predecessor.period, requestToken, link: { predecessorRunId, reason } });
    });
  } catch (error) {
    if (error instanceof Revoked) { await recordAuthorizationDenial(dependencies, authorization, error.role, error.message); return { ok: false, reason: error.message }; }
    throw error;
  }
}
