import {
  authorizeAction,
  runCancelTransition,
  RUN_CANCELED_DEFAULT_REASON,
  RUN_CANCEL_REFUSALS,
  RUN_REASON_MAX_LENGTH,
  type ExecutablePlan,
  type Role,
  type RunCancellationRequest,
  type RunRecord,
} from '@intellifin/domain';
import type { Clock, UuidV7Generator } from '../audit/clock.js';
import type { AuditUnitOfWork } from '../audit/ports.js';
import { authorizeCommandRole, recordAuthorizationDenial } from '../identity/authorize.js';
import type { RoleRepository, SessionSnapshot } from '../identity/ports.js';
import { completeRun } from './complete-run.js';
import type { RunResultContext } from './execution-ports.js';
import type { RunCancellationRepository } from './ports.js';

/**
 * `CancelRun`: stop an active Run, and let the owner of its current stage do the stopping
 * (Story 3.10).
 *
 * **Who performs the transition depends on who owns the Run, and that is the whole
 * design.** A `QUEUED` Run has no process holding it, so this command transitions it to
 * `CANCELED` and removes its dispatch job in ONE transaction: leaving a "cancel requested"
 * marker on a queued Run would mean it is cancelled only if a worker eventually collects
 * it, which is exactly backwards. A `RUNNING` Run is held under a lease by a worker
 * mid-transaction, so the request is recorded and that worker performs the transition at
 * the boundary it already commits at. A unit of work is never interrupted mid-commit.
 * `packages/domain/src/runs/run.ts` owns which states may be cancelled and which side
 * performs each; nothing here restates it.
 *
 * **The race that matters is cancel meeting claim.** Both sides read the Run state inside
 * the transaction that writes — this command under the Run's own row lock, the worker
 * inside its claim — so one of them loses and sees the other's committed result. Reading
 * through the pool and then writing in a transaction is the defect the role rechecks of
 * Stories 1.5 and 2.7 were written to avoid, one table along.
 *
 * **`CANCELED` is reserved for a person.** It is never produced by a timeout, a limit, a
 * Gate failure or an execution failure — `RUN_STOP_STATES` holds that line in the domain
 * and a test walks every stop cause. A timeout that wrote `CANCELED` would put a sentence
 * naming an actor on a Run nobody touched.
 *
 * **Evidence is never removed.** Nothing here touches an Evidence row, an artifact or an
 * Observation; a partial reservation is left OPEN for `SealPackage`, which is the one
 * thing that abandons one, so the sealed package lists it as abandoned rather than
 * silently dropping it.
 */

export interface CancelRunDependencies {
  readonly roles: RoleRepository;
  /** Where a refusal's `security.denied` event is appended, after the refusal. */
  readonly unitOfWork: AuditUnitOfWork;
  readonly repository: RunCancellationRepository;
  readonly ids: UuidV7Generator;
  readonly clock: Clock;
}

export type CancelRunOutcome =
  | {
      readonly ok: true;
      /** The state the Run is in once this command committed. */
      readonly state: RunRecord['state'];
      /** True when the worker still has to perform the transition at its next boundary. */
      readonly pending: boolean;
    }
  | { readonly ok: false; readonly reason: string };

export const CANCEL_REQUEST_MALFORMED =
  'Choose a Run that is still active, and a reason of at most 500 characters.';

/** The transition itself, and the request that asked for it. */
const CANCEL_EVENT = 'lifecycle.run-canceled';
/** The durable marker on a Run a worker still owns. */
const CANCEL_REQUESTED_EVENT = 'lifecycle.run-cancel-requested';

class Revoked extends Error {
  constructor(
    readonly role: Role | null,
    reason: string,
  ) {
    super(reason);
  }
}

/**
 * The ONE place a Run becomes `CANCELED`.
 *
 * Three producers reach it — this command for a Run nothing is executing, and each of the
 * two worker stages at its own checkpoint boundary — and all three go through this
 * function, so the state write, the Timeline event and `CompleteRun` cannot come apart.
 * The alternative is three copies of a terminal transition, and the third one would be the
 * one that forgot the Result.
 *
 * The caller's transaction is the unit: the state, the event, the Evidence package seal
 * and the Result commit together or not at all.
 */
export async function performCancellation(
  context: RunResultContext,
  input: {
    readonly run: RunRecord;
    readonly request: RunCancellationRequest;
    readonly at: string;
    readonly plan: ExecutablePlan | null;
    readonly source: 'web' | 'worker';
  },
): Promise<void> {
  await context.saveRunState('CANCELED');
  const stored = await context.auditEvents.append({
    // A person cancelled it, whichever process performed the transition. The actor is the
    // requester and the session is the one they asked from — not the initiator's, which is
    // what the Run row would otherwise have supplied.
    actor: { type: 'human', id: input.request.requestedBy },
    eventType: CANCEL_EVENT,
    source: input.source,
    outcome: 'success',
    aggregateId: input.run.runId,
    correlationId: input.run.correlationId,
    sessionId: input.request.sessionId,
    payload: {
      priorState: input.run.state,
      state: 'CANCELED',
      reason: input.request.reason,
      requestedAt: input.request.requestedAt,
      occurredAt: input.at,
      performedBy: input.source,
    },
  });
  await context.notifyTimeline(stored.sequence);
  await completeRun(context, { run: input.run, state: 'CANCELED', at: input.at, plan: input.plan });
}

export async function cancelRun(
  dependencies: CancelRunDependencies,
  input: { session: SessionSnapshot; request: unknown },
): Promise<CancelRunOutcome> {
  const correlationId = dependencies.ids.next();
  const authorization = { session: input.session, correlationId, action: 'run.cancel' as const };
  const permission = await authorizeCommandRole(dependencies, authorization);
  if (!permission.allowed) return { ok: false, reason: permission.reason };
  const request = input.request;
  // Untrusted whatever its TypeScript type says: an exact key set, a Run id that is really
  // one, and a bounded reason. The database refuses a longer one as well.
  if (
    !request ||
    typeof request !== 'object' ||
    Array.isArray(request) ||
    Object.keys(request).length !== 2 ||
    !Object.hasOwn(request, 'runId') ||
    !Object.hasOwn(request, 'reason') ||
    !('runId' in request) ||
    typeof request.runId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(request.runId) ||
    !('reason' in request) ||
    (request.reason !== null &&
      (typeof request.reason !== 'string' ||
        request.reason.trim().length === 0 ||
        request.reason.length > RUN_REASON_MAX_LENGTH))
  )
    return { ok: false, reason: CANCEL_REQUEST_MALFORMED };
  const runId = request.runId.toLowerCase();
  const reason =
    typeof request.reason === 'string' ? request.reason.trim() : RUN_CANCELED_DEFAULT_REASON;
  try {
    return await dependencies.repository.transaction(runId, async (context) => {
      const role = await context.authorizationRoles.findRole(input.session.userId);
      const locked = authorizeAction(role, 'run.cancel');
      if (!locked.allowed) throw new Revoked(role, locked.reason);
      const run = context.run;
      if (run === null) return { ok: false, reason: RUN_CANCEL_REFUSALS.UNKNOWN };
      // Every refusal below happens before this command writes anything, so returning one
      // commits an empty transaction rather than half a cancellation. A refusal that could
      // follow a write would have to be THROWN — a returned refusal commits.
      const transition = runCancelTransition(run.state);
      if (transition === null) return { ok: false, reason: RUN_CANCEL_REFUSALS.ALREADY_TERMINAL };
      // Idempotent: one marker, one transition, one event. A second cancellation of a Run
      // a worker still owns must not overwrite the first requester, the first time or the
      // first reason with a later person's.
      if (run.cancellation !== null) return { ok: true, state: run.state, pending: true };
      const cancellation: RunCancellationRequest = {
        requestedBy: input.session.userId,
        sessionId: input.session.sessionId,
        requestedAt: dependencies.clock.now().toISOString(),
        reason,
      };
      await context.requestCancellation(cancellation);
      if (transition.performedBy === 'worker') {
        const stored = await context.auditEvents.append({
          actor: { type: 'human', id: cancellation.requestedBy },
          eventType: CANCEL_REQUESTED_EVENT,
          source: 'web',
          outcome: 'success',
          aggregateId: run.runId,
          correlationId,
          sessionId: cancellation.sessionId,
          payload: {
            state: run.state,
            reason: cancellation.reason,
            requestedAt: cancellation.requestedAt,
            // The Run is still owned by a worker: this records the REQUEST, and the
            // worker's own event records the transition it then performs.
            performedBy: 'worker',
          },
        });
        await context.notifyTimeline(stored.sequence);
        return { ok: true, state: run.state, pending: true };
      }
      // Nothing is executing this Run, so the command finishes the job: the dispatch job
      // goes in the same transaction as the state, and no worker can pick it up after.
      await context.removeDispatch();
      await performCancellation(context, {
        run,
        request: cancellation,
        at: cancellation.requestedAt,
        plan: await context.frozenPlan(),
        source: 'web',
      });
      return { ok: true, state: 'CANCELED', pending: false };
    });
  } catch (error) {
    if (error instanceof Revoked) {
      await recordAuthorizationDenial(dependencies, authorization, error.role, error.message);
      return { ok: false, reason: error.message };
    }
    throw error;
  }
}
