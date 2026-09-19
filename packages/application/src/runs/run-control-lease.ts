import {
  authorizeAction,
  isTerminalRunState,
  type Role,
  type RunRecord,
} from '@intellifin/domain';

import type { UuidV7Generator } from '../audit/clock.js';
import type { AuditEventWriter, AuditUnitOfWork } from '../audit/ports.js';
import { authorizeCommandRole, recordAuthorizationDenial } from '../identity/authorize.js';
import type { RoleRepository, SessionSnapshot } from '../identity/ports.js';

/** The lease window promised by the controller surface. */
export const RUN_CONTROL_LEASE_DURATION_MS = 120_000;
/** The UI should renew around this often; this is guidance, not a second expiry. */
export const RUN_CONTROL_LEASE_RENEWAL_RECOMMENDATION_MS = 30_000;

export const RUN_CONTROL_LEASE_ACQUIRED_EVENT = 'lifecycle.run-control-lease-acquired';
export const RUN_CONTROL_LEASE_RENEWED_EVENT = 'lifecycle.run-control-lease-renewed';
export const RUN_CONTROL_LEASE_RELEASED_EVENT = 'lifecycle.run-control-lease-released';
export const RUN_CONTROL_LEASE_EXPIRED_EVENT = 'lifecycle.run-control-lease-expired';

/**
 * The current durable fence. A missing row is the one pre-enrollment state and has epoch
 * zero. Once a row exists it is retained through release and expiry; an empty holder is
 * therefore an absence of a current lease, never a return to the old Resume authority.
 *
 * `updatedAt` is supplied by the repository's transaction clock. It is deliberately part
 * of the application port so an adapter cannot use a process clock for a lease transition.
 */
export interface RunControlLeaseState {
  readonly runId: string;
  readonly epoch: number;
  readonly holderId: string | null;
  readonly expiresAt: string | null;
  readonly updatedAt: string;
}

/** Only the locked transaction can read or change this state. */
export interface RunControlLeaseContext {
  /** The Run row was read and locked by the repository before this callback ran. */
  readonly run: RunRecord | null;
  /** A fresh role read on the same connection after the Run lock was taken. */
  readonly authorizationRoles: RoleRepository;
  /** PostgreSQL `clock_timestamp()`, sampled after the Run lock is taken. */
  readonly now: Date;
  readonly auditEvents: AuditEventWriter;
  readLease(): Promise<RunControlLeaseState | null>;
  /** Writes the current fence in this transaction. The row is never deleted by a command. */
  saveLease(state: RunControlLeaseState): Promise<void>;
  /** Wake the existing Run timeline after the audit event has been appended. */
  notifyTimeline(sequence: number): Promise<void>;
}

export interface RunControlLeaseRepository {
  /** Implementations lock the canonical Run row before constructing the context. */
  transaction<T>(runId: string, work: (context: RunControlLeaseContext) => Promise<T>): Promise<T>;
}

export interface RunControlLeaseDependencies {
  readonly roles: RoleRepository;
  /** Used for authorization and for a denial that happens after the fresh lock check. */
  readonly unitOfWork: AuditUnitOfWork;
  readonly repository: RunControlLeaseRepository;
  readonly ids: UuidV7Generator;
  /** Server policy: a missing row may enroll only while the controller surface is enabled. */
  readonly allowEnrollment: boolean;
}

export interface RunControlLeaseRequest {
  readonly runId: string;
  readonly expectedEpoch: number;
}

export type RunControlLeaseOperation = 'acquire' | 'renew' | 'release';

export type RunControlLeaseRefusalCode =
  | 'malformed'
  | 'unauthorized'
  | 'unknown'
  | 'terminal'
  | 'held'
  | 'stale-epoch'
  | 'expired'
  | 'not-owner'
  | 'no-lease'
  | 'disabled'
  | 'unavailable';

export type RunControlLeaseOutcome =
  | {
      readonly ok: true;
      readonly operation: RunControlLeaseOperation;
      readonly lease: RunControlLeaseState;
    }
  | {
      readonly ok: false;
      readonly code: RunControlLeaseRefusalCode;
      readonly reason: string;
    };

/** Stable refusal copy; callers can translate the code without matching prose. */
export const RUN_CONTROL_LEASE_REFUSALS = {
  malformed: 'Choose a Run and the control epoch you read.',
  unknown: 'That Run does not exist.',
  terminal: 'This Run has finished and its controller cannot be changed.',
  held: 'Another auditor currently controls this Run. Wait for that lease to end or be released.',
  staleEpoch: 'This control lease changed while you were reading it. Reload the Run.',
  expired: 'This control lease expired. Reload the Run before trying again.',
  notOwner: 'Only the current controller can renew or release this Run.',
  noLease: 'No current controller lease exists for this Run. Reload the Run.',
  disabled: 'Controller control is not enabled for new Runs.',
  unavailable: 'Controller control is temporarily unavailable. Reload the Run and try again.',
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Parse the exact untrusted request envelope. The actor is intentionally absent: identity
 * comes only from `SessionSnapshot`, so a request cannot acquire a lease for somebody else.
 */
export function parseRunControlLeaseRequest(value: unknown): RunControlLeaseRequest | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 2 ||
    !Object.hasOwn(record, 'runId') ||
    !Object.hasOwn(record, 'expectedEpoch') ||
    typeof record.runId !== 'string' ||
    !UUID.test(record.runId) ||
    typeof record.expectedEpoch !== 'number' ||
    !Number.isSafeInteger(record.expectedEpoch) ||
    record.expectedEpoch < 0
  )
    return null;
  return { runId: record.runId.toLowerCase(), expectedEpoch: record.expectedEpoch };
}

class Revoked extends Error {
  constructor(
    readonly role: Role | null,
    reason: string,
  ) {
    super(reason);
  }
}

function refusal(code: RunControlLeaseRefusalCode, reason: string): RunControlLeaseOutcome {
  return { ok: false, code, reason };
}

function epochOf(state: RunControlLeaseState | null): number {
  return state?.epoch ?? 0;
}

function nextEpoch(state: RunControlLeaseState | null): number | null {
  const prior = epochOf(state);
  // The database stores an integer epoch. Refuse rather than wrap or write a value the
  // durable fence cannot represent; this branch is unreachable under normal operation.
  if (!Number.isSafeInteger(prior) || prior >= 2_147_483_646) return null;
  return prior + 1;
}

function transactionTime(context: RunControlLeaseContext): { readonly iso: string; readonly ms: number } {
  const ms = context.now.getTime();
  if (!Number.isFinite(ms)) throw new Error('Controller lease transaction time is unavailable.');
  return { iso: new Date(ms).toISOString(), ms };
}

function isLive(state: RunControlLeaseState, nowMs: number): boolean {
  return state.holderId !== null && state.expiresAt !== null && Number.isFinite(Date.parse(state.expiresAt)) && nowMs < Date.parse(state.expiresAt);
}

type PersistedTransitionOperation = RunControlLeaseOperation | 'expire';

function eventType(operation: PersistedTransitionOperation): typeof RUN_CONTROL_LEASE_ACQUIRED_EVENT | typeof RUN_CONTROL_LEASE_RENEWED_EVENT | typeof RUN_CONTROL_LEASE_RELEASED_EVENT | typeof RUN_CONTROL_LEASE_EXPIRED_EVENT {
  if (operation === 'acquire') return RUN_CONTROL_LEASE_ACQUIRED_EVENT;
  if (operation === 'renew') return RUN_CONTROL_LEASE_RENEWED_EVENT;
  if (operation === 'release') return RUN_CONTROL_LEASE_RELEASED_EVENT;
  return RUN_CONTROL_LEASE_EXPIRED_EVENT;
}

async function persistTransition(
  context: RunControlLeaseContext,
  input: {
    readonly operation: PersistedTransitionOperation;
    readonly actorId: string;
    readonly sessionId: string;
    readonly correlationId: string;
    readonly prior: RunControlLeaseState | null;
    readonly next: RunControlLeaseState;
  },
): Promise<void> {
  // `saveLease` and this event use the same locked repository transaction. If either
  // operation fails, the adapter rolls back the fence, event, and timeline wake together.
  await context.saveLease(input.next);
  const stored = await context.auditEvents.append({
    actor: input.operation === 'expire'
      ? { type: 'system', id: 'run-control-lease-observer' }
      : { type: 'human', id: input.actorId },
    eventType: eventType(input.operation),
    source: 'web',
    outcome: 'success',
    aggregateId: input.next.runId,
    correlationId: input.correlationId,
    sessionId: input.sessionId,
    payload: {
      operation: input.operation,
      priorEpoch: input.prior?.epoch ?? 0,
      epoch: input.next.epoch,
      priorHolderId: input.prior?.holderId ?? null,
      holderId: input.next.holderId,
      expiresAt: input.next.expiresAt,
      updatedAt: input.next.updatedAt,
      ...(input.operation === 'expire' ? { observedBy: input.actorId } : {}),
    },
  });
  await context.notifyTimeline(stored.sequence);
}

/**
 * Expiry is a durable fence transition, not an in-memory observation. Keeping it as a
 * separate epoch means a delayed command cannot renew the old holder after somebody has
 * observed its deadline. An acquire that follows this transition advances once more for
 * the new holder, so the audit chain shows both facts.
 */
async function materializeExpiry(
  context: RunControlLeaseContext,
  input: {
    readonly actorId: string;
    readonly sessionId: string;
    readonly correlationId: string;
    readonly prior: RunControlLeaseState;
    readonly now: { readonly iso: string };
  },
): Promise<RunControlLeaseState> {
  const epoch = nextEpoch(input.prior);
  if (epoch === null) throw new Error(RUN_CONTROL_LEASE_REFUSALS.unavailable);
  const next: RunControlLeaseState = {
    runId: input.prior.runId,
    epoch,
    holderId: null,
    expiresAt: null,
    updatedAt: input.now.iso,
  };
  await persistTransition(context, {
    operation: 'expire',
    actorId: input.actorId,
    sessionId: input.sessionId,
    correlationId: input.correlationId,
    prior: input.prior,
    next,
  });
  return next;
}

async function freshAuthorization(
  context: RunControlLeaseContext,
  input: { readonly session: SessionSnapshot },
): Promise<void> {
  const role = await context.authorizationRoles.findRole(input.session.userId);
  const decision = authorizeAction(role, 'run.resume');
  if (!decision.allowed) throw new Revoked(role, decision.reason);
}

async function executeLeaseCommand(
  dependencies: RunControlLeaseDependencies,
  input: { readonly session: SessionSnapshot; readonly request: unknown },
  operation: RunControlLeaseOperation,
): Promise<RunControlLeaseOutcome> {
  const correlationId = dependencies.ids.next();
  const authorization = { session: input.session, correlationId, action: 'run.resume' as const };
  const permission = await authorizeCommandRole(dependencies, authorization);
  if (!permission.allowed) return refusal('unauthorized', permission.reason);

  const request = parseRunControlLeaseRequest(input.request);
  if (request === null) return refusal('malformed', RUN_CONTROL_LEASE_REFUSALS.malformed);

  try {
    return await dependencies.repository.transaction(request.runId, async (context) => {
      await freshAuthorization(context, input);
      const run = context.run;
      if (run === null) return refusal('unknown', RUN_CONTROL_LEASE_REFUSALS.unknown);
      if (isTerminalRunState(run.state)) return refusal('terminal', RUN_CONTROL_LEASE_REFUSALS.terminal);

      const now = transactionTime(context);
      const prior = await context.readLease();
      const currentEpoch = epochOf(prior);

      if (request.expectedEpoch !== currentEpoch) {
        return refusal('stale-epoch', RUN_CONTROL_LEASE_REFUSALS.staleEpoch);
      }

      if (operation === 'acquire') {
        if (prior === null && !dependencies.allowEnrollment) {
          return refusal('disabled', RUN_CONTROL_LEASE_REFUSALS.disabled);
        }
        if (prior !== null && isLive(prior, now.ms)) {
          return refusal('held', RUN_CONTROL_LEASE_REFUSALS.held);
        }
        const available = prior !== null && prior.holderId !== null && !isLive(prior, now.ms)
          ? await materializeExpiry(context, {
              actorId: input.session.userId,
              sessionId: input.session.sessionId,
              correlationId,
              prior,
              now,
            })
          : prior;
        const epoch = nextEpoch(available);
        if (epoch === null) return refusal('unavailable', RUN_CONTROL_LEASE_REFUSALS.unavailable);
        const next: RunControlLeaseState = {
          runId: run.runId,
          epoch,
          holderId: input.session.userId,
          expiresAt: new Date(now.ms + RUN_CONTROL_LEASE_DURATION_MS).toISOString(),
          updatedAt: now.iso,
        };
        await persistTransition(context, { operation, actorId: input.session.userId, sessionId: input.session.sessionId, correlationId, prior: available, next });
        return { ok: true, operation, lease: next };
      }

      if (prior === null || prior.holderId === null) {
        return refusal('no-lease', RUN_CONTROL_LEASE_REFUSALS.noLease);
      }
      if (!isLive(prior, now.ms)) {
        await materializeExpiry(context, {
          actorId: input.session.userId,
          sessionId: input.session.sessionId,
          correlationId,
          prior,
          now,
        });
        return refusal('expired', RUN_CONTROL_LEASE_REFUSALS.expired);
      }
      if (prior.holderId !== input.session.userId) {
        return refusal('not-owner', RUN_CONTROL_LEASE_REFUSALS.notOwner);
      }

      if (operation === 'renew') {
        const next: RunControlLeaseState = {
          ...prior,
          // Keep the epoch and holder exactly; only the server-time window moves.
          expiresAt: new Date(now.ms + RUN_CONTROL_LEASE_DURATION_MS).toISOString(),
          updatedAt: now.iso,
        };
        await persistTransition(context, { operation, actorId: input.session.userId, sessionId: input.session.sessionId, correlationId, prior, next });
        return { ok: true, operation, lease: next };
      }

      const epoch = nextEpoch(prior);
      if (epoch === null) return refusal('unavailable', RUN_CONTROL_LEASE_REFUSALS.unavailable);
      const next: RunControlLeaseState = {
        runId: run.runId,
        epoch,
        holderId: null,
        expiresAt: null,
        updatedAt: now.iso,
      };
      await persistTransition(context, { operation, actorId: input.session.userId, sessionId: input.session.sessionId, correlationId, prior, next });
      return { ok: true, operation, lease: next };
    });
  } catch (error) {
    if (error instanceof Revoked) {
      await recordAuthorizationDenial(dependencies, authorization, error.role, error.message);
      return refusal('unauthorized', error.message);
    }
    throw error;
  }
}

/** Acquire a new epoch when no live controller currently holds the Run. */
export function acquireRunControlLease(
  dependencies: RunControlLeaseDependencies,
  input: { readonly session: SessionSnapshot; readonly request: unknown },
): Promise<RunControlLeaseOutcome> {
  return executeLeaseCommand(dependencies, input, 'acquire');
}

/** Renew the current actor's live lease without changing its epoch. */
export function renewRunControlLease(
  dependencies: RunControlLeaseDependencies,
  input: { readonly session: SessionSnapshot; readonly request: unknown },
): Promise<RunControlLeaseOutcome> {
  return executeLeaseCommand(dependencies, input, 'renew');
}

/** Voluntarily release the current actor's live lease and advance the fence epoch. */
export function releaseRunControlLease(
  dependencies: RunControlLeaseDependencies,
  input: { readonly session: SessionSnapshot; readonly request: unknown },
): Promise<RunControlLeaseOutcome> {
  return executeLeaseCommand(dependencies, input, 'release');
}
