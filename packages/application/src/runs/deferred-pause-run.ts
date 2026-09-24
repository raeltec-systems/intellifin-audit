import {
  authorizeAction,
  utf8Bytes,
  type DeferredPauseAnchor,
  type DeferredPauseState,
  type Role,
  type RunDeferredPauseRequest,
  type RunRecord,
} from '@intellifin/domain';
import type { AuditEventWriter, AuditUnitOfWork } from '../audit/ports.js';
import type { Clock, UuidV7Generator } from '../audit/clock.js';
import { authorizeCommandRole, recordAuthorizationDenial } from '../identity/authorize.js';
import type { RoleRepository, SessionSnapshot } from '../identity/ports.js';

/** The interpretation identity stored with a confirmed deferred safety command. */
export const DEFERRED_PAUSE_INTERPRETATION_VERSION = 'confirmed-inspection-v1' as const;

/** The request event is an admission fact; the worker's pause event is the effect fact. */
export const DEFERRED_PAUSE_REQUESTED_EVENT = 'lifecycle.run-deferred-pause-requested' as const;
export const DEFERRED_PAUSE_SUPERSEDED_EVENT = 'lifecycle.deferred-pause-superseded' as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DIGEST = /^[0-9a-f]{64}$/u;
const SUBJECT_MAX = 512;

function exactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

function uuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/**
 * Parse the server-read inspection anchor from an untrusted JSON value.
 *
 * The exact key set is intentional. In particular, an extra display ordinal, target
 * label or attempt id must not become part of the identity that a later confirmation
 * silently trusts. UUIDs are normalized only after validation; the digest is already
 * canonical lowercase and is never case-folded.
 */
export function parseDeferredPauseAnchor(value: unknown): DeferredPauseAnchor | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!exactKeys(record, ['workItemId', 'subjectKey', 'registrationId', 'runRevision', 'planDigest'])) return null;
  if (!uuid(record.workItemId) || !uuid(record.registrationId)) return null;
  if (record.subjectKey !== null && (typeof record.subjectKey !== 'string' || record.subjectKey.length === 0 || utf8Bytes(record.subjectKey).length > SUBJECT_MAX)) return null;
  if (typeof record.runRevision !== 'number' || !Number.isSafeInteger(record.runRevision) || record.runRevision < 0 || record.runRevision > 2_147_483_647) return null;
  if (typeof record.planDigest !== 'string' || !DIGEST.test(record.planDigest)) return null;
  return {
    workItemId: record.workItemId.toLowerCase(),
    subjectKey: record.subjectKey,
    registrationId: record.registrationId.toLowerCase(),
    runRevision: record.runRevision,
    planDigest: record.planDigest,
  };
}

/** The exact request body accepted by the low-level domain command. */
export interface DeferredPauseAcceptanceRequest {
  readonly runId: string;
  readonly anchor: DeferredPauseAnchor;
  readonly expectedControlEpoch: number;
}

/**
 * A fresh, transaction-bound read of the execution unit. The adapter must derive this
 * from the current worker checkpoint and frozen plan while holding the canonical Run row
 * lock. It is never derived from a selected review ordinal or from event chronology.
 */
export interface DeferredPauseCurrentInspection {
  readonly anchor: DeferredPauseAnchor;
  readonly stage: 'EXECUTING' | 'RETRY' | 'WAITING';
  /** A deferred pause may coexist with one open question only when this remains exact. */
  readonly openWaitId: string | null;
  readonly openWaitKind: string | null;
}

export interface DeferredPauseControl {
  readonly epoch: number;
  readonly holderId: string | null;
  readonly expiresAt: string | null;
  /** PostgreSQL server time sampled after taking the Run lock. */
  readonly now: Date;
}

/** The transaction-owned port used by admission and by the worker boundary. */
export interface DeferredPauseContext {
  readonly run: (RunRecord & { readonly revision: number }) | null;
  readonly authorizationRoles: RoleRepository;
  readCurrentInspection(): Promise<DeferredPauseCurrentInspection | null>;
  readControl(): Promise<DeferredPauseControl>;
  readDeferredPause(): Promise<RunDeferredPauseRequest | null>;
  requestDeferredPause(request: RunDeferredPauseRequest): Promise<void>;
  settleDeferredPause(state: Extract<DeferredPauseState, 'APPLIED' | 'SUPERSEDED'>, at: string, reason?: string): Promise<void>;
  readonly auditEvents: AuditEventWriter;
  notifyTimeline(sequence: number): Promise<void>;
}

/** Methods exposed on execution/result contexts without granting proposal admission. */
export interface DeferredPauseExecutionContext {
  readDeferredPause(): Promise<RunDeferredPauseRequest | null>;
  settleDeferredPause(state: Extract<DeferredPauseState, 'APPLIED' | 'SUPERSEDED'>, at: string, reason?: string): Promise<void>;
}

export interface DeferredPauseRepository {
  /** The implementation locks the Run before constructing the context. */
  transaction<T>(runId: string, work: (context: DeferredPauseContext) => Promise<T>): Promise<T>;
}

export interface DeferredPauseDependencies {
  readonly roles: RoleRepository;
  readonly unitOfWork: AuditUnitOfWork;
  readonly repository: DeferredPauseRepository;
  readonly ids: UuidV7Generator;
  readonly clock: Clock;
  /** The server-assigned command owner. A browser value is never accepted. */
  readonly commandId?: string | null;
}

export type DeferredPauseRefusalCode =
  | 'malformed'
  | 'unauthorized'
  | 'unknown'
  | 'terminal'
  | 'paused'
  | 'not-current'
  | 'awaiting-other-work'
  | 'immediate-pause'
  | 'cancellation'
  | 'control-required'
  | 'stale-control'
  | 'already-pending'
  | 'unavailable';

export type DeferredPauseOutcome =
  | { readonly ok: true; readonly pending: true; readonly marker: RunDeferredPauseRequest }
  | { readonly ok: false; readonly code: DeferredPauseRefusalCode; readonly reason: string };

export const DEFERRED_PAUSE_REFUSALS: Readonly<Record<DeferredPauseRefusalCode, string>> = {
  malformed: 'Choose the current inspection and its control epoch.',
  unauthorized: 'Your current role cannot request a deferred pause.',
  unknown: 'The Run was not found.',
  terminal: 'This Run has finished and its inspection cannot be paused.',
  paused: 'This Run is already paused; review the existing pause before requesting another one.',
  'not-current': 'The inspection changed while you were confirming. Review the current inspection again.',
  'awaiting-other-work': 'The Run is waiting on a different inspection decision.',
  'immediate-pause': 'An immediate pause is already pending for this Run.',
  cancellation: 'Cancellation is already pending for this Run.',
  'control-required': 'Acquire control of this Run before confirming a deferred pause.',
  'stale-control': 'Your control lease changed or expired. Review the current inspection again.',
  'already-pending': 'A deferred pause is already pending for this Run.',
  unavailable: 'The current inspection is temporarily unavailable.',
};

function refusal(code: DeferredPauseRefusalCode): DeferredPauseOutcome {
  return { ok: false, code, reason: DEFERRED_PAUSE_REFUSALS[code] };
}

function internalCommandId(value: unknown): string | null {
  return typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : null;
}

function parseEpoch(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function parseAcceptanceRequest(value: unknown): DeferredPauseAcceptanceRequest | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const anchorKey = Object.hasOwn(record, 'anchor') ? 'anchor' : Object.hasOwn(record, 'currentInspection') ? 'currentInspection' : null;
  if (anchorKey === null || !exactKeys(record, ['runId', anchorKey, 'expectedControlEpoch']) || !uuid(record.runId)) return null;
  const anchor = parseDeferredPauseAnchor(record[anchorKey]);
  const expectedControlEpoch = parseEpoch(record.expectedControlEpoch);
  if (anchor === null || expectedControlEpoch === null) return null;
  return { runId: record.runId.toLowerCase(), anchor, expectedControlEpoch };
}

function sameAnchor(left: DeferredPauseAnchor, right: DeferredPauseAnchor): boolean {
  return left.workItemId === right.workItemId && left.subjectKey === right.subjectKey &&
    left.registrationId === right.registrationId && left.runRevision === right.runRevision &&
    left.planDigest === right.planDigest;
}

function isLiveControl(control: DeferredPauseControl, actorId: string, expectedEpoch: number): boolean {
  if (control.epoch !== expectedEpoch || control.holderId !== actorId || control.expiresAt === null) return false;
  const expiry = Date.parse(control.expiresAt);
  return Number.isFinite(expiry) && Number.isFinite(control.now.getTime()) && expiry > control.now.getTime();
}

class Revoked extends Error {
  constructor(readonly role: Role | null, reason: string) {
    super(reason);
  }
}

/**
 * Confirm a proposal against the current locked execution state and install the sticky
 * worker latch. The marker and its admission event are written through the caller's
 * repository transaction; no provider, queue or browser operation occurs here.
 */
export async function acceptDeferredPause(
  dependencies: DeferredPauseDependencies,
  input: {
    readonly session: SessionSnapshot;
    readonly request: unknown;
    readonly commandId?: string;
    /** Server-read from the immutable interaction proposal; never supplied by the browser. */
    readonly expectedControlEpoch?: number;
  },
): Promise<DeferredPauseOutcome> {
  const commandId = internalCommandId(input.commandId ?? dependencies.commandId);
  const request = parseAcceptanceRequest(input.request);
  const expectedEpoch = parseEpoch(input.expectedControlEpoch) ?? request?.expectedControlEpoch ?? null;
  if (commandId === null || request === null || expectedEpoch === null) return refusal('malformed');
  if (request.expectedControlEpoch !== expectedEpoch) return refusal('stale-control');

  const correlationId = dependencies.ids.next();
  const authorization = { session: input.session, correlationId, action: 'run.pause' as const };
  const permission = await authorizeCommandRole(dependencies, authorization);
  if (!permission.allowed) return { ok: false, code: 'unauthorized', reason: permission.reason };

  try {
    return await dependencies.repository.transaction(request.runId, async (context) => {
      const role = await context.authorizationRoles.findRole(input.session.userId);
      const locked = authorizeAction(role, 'run.pause');
      if (!locked.allowed) throw new Revoked(role, locked.reason);
      const run = context.run;
      if (run === null) return refusal('unknown');
      if (run.cancellation !== null) return refusal('cancellation');
      if (run.pauseRequest !== null) return refusal('immediate-pause');
      if (run.state === 'PAUSED') return refusal('paused');
      if (run.state === 'QUEUED') return refusal('not-current');
      if (['COMPLETED', 'INCONCLUSIVE', 'RUN_FAILED', 'CANCELED'].includes(run.state)) return refusal('terminal');

      const control = await context.readControl();
      if (!isLiveControl(control, input.session.userId, expectedEpoch)) return refusal('stale-control');
      const existing = await context.readDeferredPause();
      if (existing !== null) {
        if (existing.commandId === commandId && existing.requestedBy === input.session.userId &&
            sameAnchor(existing, request.anchor) && existing.expectedControlEpoch === expectedEpoch) {
          return { ok: true, pending: true, marker: existing };
        }
        return refusal('already-pending');
      }

      const current = await context.readCurrentInspection();
      if (current === null || !sameAnchor(current.anchor, request.anchor)) return refusal('not-current');
      if (run.state === 'AWAITING_AUDITOR' && (current.stage !== 'WAITING' || current.openWaitId === null || current.openWaitKind === null))
        return refusal('awaiting-other-work');
      if (run.state === 'RUNNING' && !['EXECUTING', 'RETRY', 'WAITING'].includes(current.stage)) return refusal('not-current');

      const requestedAt = control.now.toISOString();
      const marker: RunDeferredPauseRequest = {
        runId: run.runId,
        commandId,
        requestedBy: input.session.userId,
        sessionId: input.session.sessionId,
        requestedAt,
        expectedControlEpoch: expectedEpoch,
        state: 'PENDING',
        ...request.anchor,
      };
      await context.requestDeferredPause(marker);
      const stored = await context.auditEvents.append({
        actor: { type: 'human', id: marker.requestedBy },
        eventType: DEFERRED_PAUSE_REQUESTED_EVENT,
        source: 'web',
        outcome: 'success',
        aggregateId: run.runId,
        correlationId,
        sessionId: marker.sessionId,
        payload: {
          commandId: marker.commandId,
          state: 'PENDING',
          workItemId: marker.workItemId,
          subjectKey: marker.subjectKey,
          registrationId: marker.registrationId,
          runRevision: marker.runRevision,
          planDigest: marker.planDigest,
          expectedControlEpoch: marker.expectedControlEpoch,
          requestedAt: marker.requestedAt,
          performedBy: 'worker',
        },
      });
      await context.notifyTimeline(stored.sequence);
      return { ok: true, pending: true, marker };
    });
  } catch (error) {
    if (error instanceof Revoked) {
      await recordAuthorizationDenial(dependencies, authorization, error.role, error.message);
      return { ok: false, code: 'unauthorized', reason: error.message };
    }
    throw error;
  }
}

/** A narrow worker helper used at a commit boundary after the target unit settles. */
export async function settleDeferredPause(
  context: DeferredPauseContext,
  state: Extract<DeferredPauseState, 'APPLIED' | 'SUPERSEDED'>,
  at: string,
  reason?: string,
): Promise<void> {
  const marker = await context.readDeferredPause();
  if (marker === null || marker.state === state) return;
  await context.settleDeferredPause(state, at, reason);
}

export type { DeferredPauseAnchor };
