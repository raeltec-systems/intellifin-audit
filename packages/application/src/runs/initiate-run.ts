import { authorizeAction, isActiveRunState, isExplicitPeriod, isInitiationRequestToken, RUN_REASON_MAX_LENGTH, RUN_REQUEST_REFUSALS, RUN_RERUN_DEFAULT_REASON, RUN_RERUN_REFUSALS, type ExplicitPeriod, type RunRecord, type RunRequestRefusalCode, type Role } from '@intellifin/domain';
import type { Clock, UuidV7Generator } from '../audit/clock.js';
import type { AuditUnitOfWork } from '../audit/ports.js';
import { authorizeCommandRole, recordAuthorizationDenial } from '../identity/authorize.js';
import type { RoleRepository, SessionSnapshot } from '../identity/ports.js';
import type { RunRequestDecision, RunsUnitOfWorkContext } from './ports.js';
export interface RunDependencies { readonly roles: RoleRepository; readonly unitOfWork: AuditUnitOfWork<RunsUnitOfWorkContext>; readonly ids: UuidV7Generator; readonly clock: Clock }
export type InitiateRunOutcome = { readonly ok: true; readonly runId: string } | { readonly ok: false; readonly reason: string; readonly existingRunId?: string };
class Revoked extends Error { constructor(readonly role: Role | null, reason: string) { super(reason); } }
/** The two refusals a decided token can carry, stated in the domain and read from it. */
export const NO_RUN_OWNER = RUN_REQUEST_REFUSALS['no-owner'];
export const RUN_ALREADY_ACTIVE = RUN_REQUEST_REFUSALS['already-active'];
export const RUN_REQUEST_MALFORMED = 'Choose a valid Procedure and inclusive start and end dates.';
export const RERUN_REQUEST_MALFORMED = 'Choose a Run that has ended, and a reason of at most 500 characters.';
export const RUN_TOKEN_REUSED = 'That initiation token was already used for a different Procedure or period. Start a fresh initiation.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The predecessor a rerun records, and the reason it exists. */
interface RerunLink { readonly predecessorRunId: string; readonly reason: string }

/**
 * Decide a token as a refusal, once, and answer with it.
 *
 * Both commands go through this, so there is no spelling of a refusal that records nothing
 * and no spelling that binds the caller's token to somebody else's Run. `bindRequest` keeps
 * the FIRST decision, so two racing requests with one token still mean one thing.
 */
async function recordRefusal(
  context: RunsUnitOfWorkContext,
  initiatorId: string,
  requestToken: string,
  subject: { readonly procedureId: string; readonly period: ExplicitPeriod },
  refusal: RunRequestRefusalCode,
  refusedRunId: string | null,
): Promise<InitiateRunOutcome> {
  await context.runs.bindRequest(initiatorId, requestToken, { ...subject, runId: null, refusal, refusedRunId });
  return { ok: false, reason: RUN_REQUEST_REFUSALS[refusal], ...(refusedRunId === null ? {} : { existingRunId: refusedRunId }) };
}

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
  // Every refusal from here on is DECIDED against the token, so replaying it repeats the
  // refusal instead of re-deriving it against a world that has since changed. A refusal
  // records the blocking Run by reference; it never binds this caller's token TO it.
  const refuse = (refusal: RunRequestRefusalCode, refusedRunId: string | null): Promise<InitiateRunOutcome> =>
    recordRefusal(context, input.session.userId, requestToken, { procedureId, period }, refusal, refusedRunId);
  const active = await context.runs.findActive(procedureId, period);
  if (active) return refuse('already-active', active.runId);
  const owner = await context.procedures.findPeriodOwner(procedureId, period);
  if (!owner || owner.state !== 'ACTIVE' || !owner.frozenReview) return refuse('no-owner', null);
  const run: RunRecord = { runId: dependencies.ids.next(), requestToken, correlationId: input.correlationId, procedureId, versionId: owner.versionId, versionNumber: owner.versionNumber, procedureName: owner.controlName,
    period, state: 'QUEUED', kind: 'STANDARD', initiatorId: input.session.userId, sessionId: input.session.sessionId, initiatedAt: dependencies.clock.now().toISOString(), authorizationRole: input.role,
    predecessorRunId: link?.predecessorRunId ?? null, rerunReason: link?.reason ?? null, cancellation: null, pauseRequest: null };
  if (!await context.runs.insert(run)) {
    const existing = await context.runs.findActive(procedureId, period);
    return refuse('already-active', existing?.runId ?? null);
  }
  await context.runs.bindRequest(input.session.userId, requestToken, { procedureId, period, runId: run.runId, refusal: null, refusedRunId: null });
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

/**
 * A request token already decided: EXACTLY the answer it was decided to mean.
 *
 * Two properties, and they are the owner's own words (2026-09-06).
 *
 * **Explicit.** The decision is stored — the Run this caller's request created, or the
 * refusal it received, with the Procedure and period it was decided for. Nothing is
 * re-derived from a world that has moved on since.
 *
 * **Stable.** The same token gives the same answer every time, including the link the
 * refusal offered, so a person retrying a lost response cannot be told two different
 * things by the same click.
 *
 * And the property that made the change necessary: a token is NEVER an entry into a Run
 * the caller did not initiate. The refused Run is named as a reference — a Run everyone
 * with the role can already see in the Runs list — and never as `ok: true` with its id,
 * which is what walked one auditor into another's audit work.
 *
 * `RUN_TOKEN_REUSED` is decided against the SUBJECT stored on the record, not against a
 * bound Run: a refused token has no Run to read a Procedure and period off.
 */
function replay(prior: RunRequestDecision, procedureId: string, period: ExplicitPeriod): InitiateRunOutcome {
  if (prior.procedureId !== procedureId || prior.period.from !== period.from || prior.period.to !== period.to) return { ok: false, reason: RUN_TOKEN_REUSED };
  if (prior.runId !== null) return { ok: true, runId: prior.runId };
  // A stored decision with neither a Run nor a refusal cannot be written — the database
  // CHECK refuses it — so this is the fail-closed reading of a row somebody made by hand.
  const refusal = prior.refusal ?? 'already-active';
  return { ok: false, reason: RUN_REQUEST_REFUSALS[refusal], ...(prior.refusedRunId === null ? {} : { existingRunId: prior.refusedRunId }) };
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
      // An authorization refusal is deliberately NOT decided against the token. AD-7 says
      // the role is read on every request and never cached, and a token that remembered a
      // denial would be exactly that cache: a person whose role was granted a minute later
      // would still be refused by a stored answer. Authorization is re-decided every time,
      // which is the one place a replay is SUPPOSED to be able to answer differently.
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
      // Not decided against the token, and it does not need to be: a Run id that does not
      // exist never starts existing — ids are minted and never reused — so this refusal is
      // already the same answer on every replay, and there is no subject to record it
      // under anyway.
      if (predecessor === null) return { ok: false, reason: RUN_RERUN_REFUSALS.UNKNOWN };
      const subject = { procedureId: predecessor.procedureId, period: predecessor.period };
      // The token is consulted BEFORE the predecessor's state is judged, so a decided token
      // answers from its own record and from nothing else. It comes after `findRun` only
      // because a rerun's SUBJECT is the predecessor's Procedure and period, which is what
      // `RUN_TOKEN_REUSED` compares against.
      const priorRequest = await context.runs.findRequest(input.session.userId, requestToken);
      if (priorRequest) return replay(priorRequest, subject.procedureId, subject.period);
      // Read INSIDE the transaction that writes, so a Run that becomes terminal while
      // this rerun is refused, and a Run cancelled a moment ago, each see one committed
      // answer rather than a state read through the pool a moment earlier. DECIDED against
      // the token as well: without that, the same click answered "not ended yet" now and
      // started a Run an hour later, which is one token meaning two things.
      if (isActiveRunState(predecessor.state)) return recordRefusal(context, input.session.userId, requestToken, subject, 'predecessor-active', predecessor.runId);
      return createRun(dependencies, context, { session: input.session, correlationId, role: role!, ...subject, requestToken, link: { predecessorRunId, reason } });
    });
  } catch (error) {
    if (error instanceof Revoked) { await recordAuthorizationDenial(dependencies, authorization, error.role, error.message); return { ok: false, reason: error.message }; }
    throw error;
  }
}
