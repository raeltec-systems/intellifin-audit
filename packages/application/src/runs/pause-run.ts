import {
  authorizeAction,
  runPauseTransition,
  RUN_PAUSE_REFUSALS,
  RUN_RESUME_REFUSALS,
  type Role,
  type RunPauseRequest,
  type RunRecord,
} from '@intellifin/domain';
import type { Clock, UuidV7Generator } from '../audit/clock.js';
import type { AuditUnitOfWork } from '../audit/ports.js';
import { authorizeCommandRole, recordAuthorizationDenial } from '../identity/authorize.js';
import type { RoleRepository, SessionSnapshot } from '../identity/ports.js';
import {
  ESCALATION_OPTION_IDS,
  PAUSE_OPTIONS,
  isEscalationKind,
  waitTimeoutMs,
  type RunWait,
} from './escalation-kind.js';
import type { RunPauseContext } from './execution-ports.js';
import type { WaitRepository } from './waits.js';

/**
 * `PauseRun` and `ResumeRun`: stop a Running Run on a person's word, and start it again
 * (Story 5.4, FR-25, AD-16).
 *
 * **A pause is a WAIT, not a new mechanism.** It reuses `run_wait` and gets four things
 * that would otherwise have to be built a second time: the `run_wait_one_open` unique
 * index, which is exactly why "a Run waiting on an answer cannot be paused" and a paused
 * Run cannot raise an Escalation; the durable wake at the deadline, which is what ends an
 * abandoned pause Inconclusive; the Run-revision compare-and-set; and the recovery sweep.
 * Two copies of any of those would agree on every case anybody tried and diverge on the
 * first one nobody did.
 *
 * **A pause is NOT an Escalation, and every reader says which it means.** No question is
 * asked and no Audit Manager is notified. The inbox and the bell already exclude it
 * without a kind filter, because their one visibility predicate requires the Run to be
 * `AWAITING_AUDITOR` and a pause holds it in `PAUSED` — the state IS the exclusion, which
 * is stronger than a filter somebody has to remember.
 *
 * **The worker performs the transition.** `RUN_PAUSE_TRANSITIONS` has one row and it says
 * `worker`, because AD-16 makes a pause take effect at the next Tool Action boundary and a
 * `PAUSED` state written from under a working stage would make its next guarded commit
 * fail — silently discarding a unit's Evidence, Observations and Step Execution. So this
 * command records a durable marker and the stage honours it at the boundary it already
 * commits at, exactly as `CancelRun` does for a `RUNNING` Run.
 *
 * **Resume restarts the current Step Execution rather than continuing it.** The interrupted
 * attempt is marked `SUPERSEDED`, its Tool Actions stay on the Timeline, and the stage
 * re-navigates and re-briefs the model from the frozen plan and the Work Item with no
 * carried conversation state. `docs/contracts/run-pause-v1.md` states the whole rule, and
 * says why the story spec was followed over EXPERIENCE.md's Flow-3 sentence.
 */

/** The wait a pause opens. Derived, so the deadline and the marker cannot disagree. */
export function pauseWaitFor(input: {
  readonly waitId: string;
  readonly runId: string;
  readonly request: RunPauseRequest;
  readonly at: string;
}): RunWait {
  return {
    waitId: input.waitId,
    runId: input.runId,
    kind: 'pause',
    options: PAUSE_OPTIONS,
    // The instant the pause TOOK EFFECT, which is what the deadline is measured from and
    // what "ends Inconclusive at {time}" is derived from. The request time is on the Run's
    // own marker and on the Timeline; the two differ by at most one Tool Action.
    openedAt: input.at,
    openedBy: input.request.requestedBy,
    deadline: new Date(Date.parse(input.at) + waitTimeoutMs('pause')).toISOString(),
    closedAt: null,
    closureKind: null,
    answerOptionId: null,
    actor: null,
  };
}

/** The Timeline event each side of the pause appends. */
export const PAUSE_REQUESTED_EVENT = 'lifecycle.run-pause-requested';
export const PAUSED_EVENT = 'lifecycle.run-paused';
export const RESUMED_EVENT = 'lifecycle.run-resumed';
// `lifecycle.pause-superseded` is `CompleteRun`'s, defined where it is appended.

/**
 * The ONE place a Run becomes `PAUSED`.
 *
 * Three stages reach it and each calls it inside the guarded transaction that has already
 * written its own checkpoint at `PAUSED`, so the state, the superseded Step Execution, the
 * wait row, its durable wake and the Timeline event commit together or not at all. A
 * `PAUSED` Run with no wait row would be a Run nothing could ever end.
 */
export async function performPause(
  context: RunPauseContext,
  input: {
    readonly run: RunRecord;
    readonly request: RunPauseRequest;
    /** A fresh id. The wait itself is DERIVED, so no caller can mis-shape one. */
    readonly waitId: string;
    readonly at: string;
    /** The Step Execution this pause superseded, when a stage had one in flight. */
    readonly stepExecutionId?: string | null;
    readonly workItemId?: string | null;
  },
): Promise<RunWait> {
  const wait = pauseWaitFor({
    waitId: input.waitId,
    runId: input.run.runId,
    request: input.request,
    at: input.at,
  });
  await context.openPauseWait(wait);
  // The request has now been honoured, so the marker that says "requested and not yet
  // honoured" stops being true. Cleared here, in the same commit, which is what makes a
  // marker still present at a terminal transition mean exactly `pause-superseded`.
  await context.clearPauseRequest();
  const stored = await context.auditEvents.append({
    // A person paused it, whichever process performed the transition — the same reading
    // `performCancellation` applies to the actor on a worker-performed cancellation.
    actor: { type: 'human', id: input.request.requestedBy },
    eventType: PAUSED_EVENT,
    source: 'worker',
    outcome: 'success',
    aggregateId: input.run.runId,
    correlationId: input.run.correlationId,
    sessionId: input.request.sessionId,
    payload: {
      priorState: 'RUNNING',
      state: 'PAUSED',
      waitId: wait.waitId,
      requestedAt: input.request.requestedAt,
      occurredAt: input.at,
      deadline: wait.deadline,
      ...(input.stepExecutionId ? { stepExecutionId: input.stepExecutionId } : {}),
      ...(input.workItemId ? { workItemId: input.workItemId } : {}),
    },
  });
  await context.notifyTimeline(stored.sequence);
  return wait;
}

export interface PauseRunDependencies {
  readonly roles: RoleRepository;
  /** Where a refusal's `security.denied` event is appended, after the refusal. */
  readonly unitOfWork: AuditUnitOfWork;
  readonly repository: WaitRepository;
  readonly ids: UuidV7Generator;
  readonly clock: Clock;
}

export type PauseRunOutcome =
  | {
      readonly ok: true;
      /** The state the Run is in once this command committed — still `RUNNING`. */
      readonly state: RunRecord['state'];
      /** Always true: a worker performs the transition at its next boundary. */
      readonly pending: true;
    }
  | { readonly ok: false; readonly reason: string };

export type ResumeRunOutcome =
  | { readonly ok: true; readonly state: 'RUNNING'; readonly waitId: string }
  | { readonly ok: false; readonly reason: string; readonly code: ResumeRefusalCode };

export type ResumeRefusalCode = 'malformed' | 'unknown' | 'not-paused' | 'stale-revision' | 'timed-out';

export const PAUSE_REQUEST_MALFORMED = 'Choose a Run that is still running.';
export const RESUME_REQUEST_MALFORMED = 'Choose a Paused Run and the revision you read.';

export const RESUME_RUN_REFUSALS: Readonly<Record<ResumeRefusalCode, string>> = {
  malformed: RESUME_REQUEST_MALFORMED,
  unknown: RUN_RESUME_REFUSALS.UNKNOWN,
  'not-paused': RUN_RESUME_REFUSALS.NOT_PAUSED,
  'stale-revision': 'This Run changed while you were reading it. Reload the Run.',
  'timed-out': 'This pause timed out at {time}; the Run is Inconclusive.',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class Revoked extends Error {
  constructor(
    readonly role: Role | null,
    reason: string,
  ) {
    super(reason);
  }
}

/** Untrusted whatever its TypeScript type says: an exact key set and a real Run id. */
function parsePauseRequest(value: unknown): { runId: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || !Object.hasOwn(record, 'runId')) return null;
  if (typeof record.runId !== 'string' || !UUID.test(record.runId)) return null;
  return { runId: record.runId.toLowerCase() };
}

function parseResumeRequest(value: unknown): { runId: string; expectedRunRevision: number } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 2 || !Object.hasOwn(record, 'runId') || !Object.hasOwn(record, 'expectedRunRevision'))
    return null;
  if (typeof record.runId !== 'string' || !UUID.test(record.runId)) return null;
  if (
    typeof record.expectedRunRevision !== 'number' ||
    !Number.isSafeInteger(record.expectedRunRevision) ||
    record.expectedRunRevision < 0
  )
    return null;
  return { runId: record.runId.toLowerCase(), expectedRunRevision: record.expectedRunRevision };
}

/** Record one person's pause request. The worker honours it at its next boundary. */
export async function pauseRun(
  dependencies: PauseRunDependencies,
  input: { session: SessionSnapshot; request: unknown },
): Promise<PauseRunOutcome> {
  const correlationId = dependencies.ids.next();
  const authorization = { session: input.session, correlationId, action: 'run.pause' as const };
  const permission = await authorizeCommandRole(dependencies, authorization);
  if (!permission.allowed) return { ok: false, reason: permission.reason };
  const request = parsePauseRequest(input.request);
  if (request === null) return { ok: false, reason: PAUSE_REQUEST_MALFORMED };
  try {
    return await dependencies.repository.transaction(request.runId, async (context) => {
      const role = await context.authorizationRoles.findRole(input.session.userId);
      const locked = authorizeAction(role, 'run.pause');
      if (!locked.allowed) throw new Revoked(role, locked.reason);
      const run = context.run;
      if (run === null) return { ok: false, reason: RUN_PAUSE_REFUSALS.UNKNOWN };
      // Every refusal below happens before this command writes anything, so returning one
      // commits an empty transaction rather than half a pause. A refusal that could follow
      // a write would have to be THROWN — a returned refusal commits.
      if (run.state === 'AWAITING_AUDITOR') return { ok: false, reason: RUN_PAUSE_REFUSALS.AWAITING };
      if (runPauseTransition(run.state) === null)
        return { ok: false, reason: RUN_PAUSE_REFUSALS.NOT_RUNNING };
      // Idempotent: one marker, one pause, one event. A second request must not overwrite
      // the first requester or the first time, which the Paused banner then reports.
      if (run.pauseRequest !== null) return { ok: true, state: run.state, pending: true };
      const pause: RunPauseRequest = {
        requestedBy: input.session.userId,
        sessionId: input.session.sessionId,
        requestedAt: dependencies.clock.now().toISOString(),
      };
      await context.requestPause(pause);
      const stored = await context.auditEvents.append({
        actor: { type: 'human', id: pause.requestedBy },
        eventType: PAUSE_REQUESTED_EVENT,
        source: 'web',
        outcome: 'success',
        aggregateId: run.runId,
        correlationId,
        sessionId: pause.sessionId,
        payload: {
          state: run.state,
          requestedAt: pause.requestedAt,
          // The Run is still owned by a worker: this records the REQUEST, and the worker's
          // own event records the transition it then performs.
          performedBy: 'worker',
        },
      });
      await context.notifyTimeline(stored.sequence);
      return { ok: true, state: run.state, pending: true };
    });
  } catch (error) {
    if (error instanceof Revoked) {
      await recordAuthorizationDenial(dependencies, authorization, error.role, error.message);
      return { ok: false, reason: error.message };
    }
    throw error;
  }
}

export interface ResumeRunDependencies extends PauseRunDependencies {}

/**
 * Close the pause wait and put the Run back to `RUNNING`.
 *
 * The stage's own recovery sweep is what picks it up again, exactly as it does after an
 * Escalation is answered: `RUNNING` is the one thing every sweep's read requires, so
 * returning the Run to it is the whole handover. Nothing is enqueued here — a second
 * dispatch would race the sweep for one lease.
 */
export async function resumeRun(
  dependencies: ResumeRunDependencies,
  input: { session: SessionSnapshot; request: unknown },
): Promise<ResumeRunOutcome> {
  const correlationId = dependencies.ids.next();
  const authorization = { session: input.session, correlationId, action: 'run.resume' as const };
  const permission = await authorizeCommandRole(dependencies, authorization);
  if (!permission.allowed) return { ok: false, reason: permission.reason, code: 'malformed' };
  const request = parseResumeRequest(input.request);
  if (request === null) return { ok: false, reason: RESUME_REQUEST_MALFORMED, code: 'malformed' };
  try {
    return await dependencies.repository.transaction(request.runId, async (context) => {
      const role = await context.authorizationRoles.findRole(input.session.userId);
      const locked = authorizeAction(role, 'run.resume');
      if (!locked.allowed) throw new Revoked(role, locked.reason);
      const run = context.run;
      const wait = context.wait;
      if (run === null) return { ok: false, reason: RESUME_RUN_REFUSALS.unknown, code: 'unknown' };
      // An Escalation is refused here the way a pause is refused by `answerEscalation`:
      // this command knows of no such pause. Generation 45 refuses the contradictory
      // closure row underneath both.
      if (wait === null || wait.closedAt !== null || isEscalationKind(wait.kind))
        return { ok: false, reason: RESUME_RUN_REFUSALS['not-paused'], code: 'not-paused' };
      if (run.state !== 'PAUSED')
        return { ok: false, reason: RESUME_RUN_REFUSALS['not-paused'], code: 'not-paused' };
      const now = dependencies.clock.now().toISOString();
      const operation = await context.closeWait({
        waitId: wait.waitId,
        expectedRunRevision: request.expectedRunRevision,
        answerOptionId: ESCALATION_OPTION_IDS.resume,
        actor: input.session.userId,
        now,
        stateAfterClose: 'RUNNING',
      });
      if (operation.outcome === 'stale-revision')
        return { ok: false, reason: RESUME_RUN_REFUSALS['stale-revision'], code: 'stale-revision' };
      if (operation.outcome === 'expired' || operation.outcome === 'superseded') {
        const at = operation.wait?.closedAt ?? wait.deadline;
        return {
          ok: false,
          reason: RESUME_RUN_REFUSALS['timed-out'].replace('{time}', at),
          code: 'timed-out',
        };
      }
      if (operation.outcome !== 'closed')
        return { ok: false, reason: RESUME_RUN_REFUSALS.unknown, code: 'unknown' };
      const stored = await context.auditEvents.append({
        actor: { type: 'human', id: input.session.userId },
        eventType: RESUMED_EVENT,
        source: 'web',
        outcome: 'success',
        aggregateId: run.runId,
        correlationId,
        sessionId: input.session.sessionId,
        payload: {
          priorState: 'PAUSED',
          state: 'RUNNING',
          waitId: wait.waitId,
          closureKind: 'resume',
          pausedAt: wait.openedAt,
          occurredAt: now,
        },
      });
      await context.notifyTimeline(stored.sequence);
      return { ok: true, state: 'RUNNING', waitId: wait.waitId };
    });
  } catch (error) {
    if (error instanceof Revoked) {
      await recordAuthorizationDenial(dependencies, authorization, error.role, error.message);
      return { ok: false, reason: error.message, code: 'malformed' };
    }
    throw error;
  }
}
