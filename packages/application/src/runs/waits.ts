import {
  AWAITING_AUDITOR_TIMEOUT_MS,
  ESCALATION_KINDS,
  ESCALATION_OPTION_IDS,
  isEscalationKind,
  waitTimeoutMs,
  type EscalationKind,
  type EscalationOption,
  type RunWait,
  type WaitClosureKind,
  type WaitKind,
} from './escalation-kind.js';
export {
  AWAITING_AUDITOR_TIMEOUT_MS,
  ESCALATION_KINDS,
  ESCALATION_OPTION_IDS,
  PAUSED_TIMEOUT_MS,
  PAUSE_OPTIONS,
  WAIT_CLOSURE_KINDS,
  WAIT_HELD_STATES,
  WAIT_KINDS,
  WAIT_OPENED_FROM_STATE,
  isEscalationKind,
  isEscalationWait,
  isWaitKind,
  waitClosureKindFor,
  waitRunState,
  waitTimeoutMs,
  type EscalationKind,
  type EscalationOption,
  type EscalationOptionId,
  type EscalationWait,
  type RunWait,
  type WaitClosureKind,
  type WaitKind,
} from './escalation-kind.js';
import {
  authorizeAction,
  type JsonObject,
  type ExecutablePlan,
  type Role,
  type RunCancellationRequest,
  type RunPauseRequest,
  type RunRecord,
} from '@intellifin/domain';
import type { AuditUnitOfWork } from '../audit/ports.js';
import type { Clock, UuidV7Generator } from '../audit/clock.js';
import { authorizeCommandRole, recordAuthorizationDenial } from '../identity/authorize.js';
import type { RoleRepository, SessionSnapshot } from '../identity/ports.js';
import { completeRun } from './complete-run.js';
import { performCancellation } from './cancel-run.js';
import type { RunResultContext } from './execution-ports.js';

/** The durable wait wire contract. A wait is intentionally kind-agnostic. */
export const WAIT_SCHEMA_VERSION = 1 as const;
export const WAIT_QUEUE_SCHEMA_VERSION = WAIT_SCHEMA_VERSION;

const RESERVED_ESCALATION_OPTION_IDS: ReadonlySet<string> = new Set(Object.values(ESCALATION_OPTION_IDS));


/** The fixed options from FR-27, in their user-facing order. */
export const FIXED_ESCALATION_OPTIONS: Readonly<{
  readonly 'unnamed-value': readonly EscalationOption[];
  readonly 'retry-or-skip': readonly EscalationOption[];
}> = {
  'unnamed-value': [
    { id: ESCALATION_OPTION_IDS.markUnevaluated, label: 'Mark the record Unevaluated and continue' },
    { id: ESCALATION_OPTION_IDS.abort, label: 'Abort' },
  ],
  'retry-or-skip': [
    { id: ESCALATION_OPTION_IDS.retry, label: 'Retry' },
    { id: ESCALATION_OPTION_IDS.skip, label: 'Skip' },
    { id: ESCALATION_OPTION_IDS.abort, label: 'Abort' },
  ],
};

/** A Run carries a revision for all human-in-the-loop compare-and-set commands. */
export type VersionedRun = RunRecord & { readonly revision: number };


/**
 * Safe metadata for the currently open Escalation.
 *
 * The wait row carries the answer vocabulary, while the immutable raise event carries
 * the platform's Step and Evidence references. Agent work is joined only through the
 * current wait and its current Work Item. The optional model text is exposed as an
 * agent-generated question by the web surface and must remain untrusted there.
 *
 * This DTO names references only. It never includes Evidence bytes, object-store keys or
 * credentials, so reading it cannot bypass the EvidenceStore boundary.
 */
export interface EscalationDetails {
  readonly stepId: string | null;
  /** `null` means the raise event did not declare references; an empty list is explicit. */
  readonly supportingEvidenceIds: readonly string[] | null;
  readonly workItemId: string | null;
  /** The matching turn's bounded uncertainty rationale, if one exists. */
  readonly agentQuestion: string | null;
}

export interface WaitJob {
  readonly schemaVersion: typeof WAIT_SCHEMA_VERSION;
  readonly runId: string;
  readonly waitId: string;
}

export type WaitOperation =
  | { readonly outcome: 'created'; readonly wait: RunWait; readonly run: VersionedRun }
  | { readonly outcome: 'closed'; readonly wait: RunWait; readonly run: VersionedRun }
  | { readonly outcome: 'timed-out'; readonly wait: RunWait; readonly run: VersionedRun }
  | { readonly outcome: 'already-open'; readonly wait: RunWait; readonly run: VersionedRun }
  | { readonly outcome: 'not-running'; readonly wait: RunWait | null; readonly run: VersionedRun | null }
  | { readonly outcome: 'not-awaiting'; readonly wait: RunWait; readonly run: VersionedRun }
  | { readonly outcome: 'superseded'; readonly wait: RunWait | null; readonly run: VersionedRun | null }
  | { readonly outcome: 'missing'; readonly wait: null; readonly run: VersionedRun | null }
  | { readonly outcome: 'stale-revision'; readonly wait: RunWait; readonly run: VersionedRun }
  | { readonly outcome: 'expired'; readonly wait: RunWait; readonly run: VersionedRun }
  | { readonly outcome: 'early'; readonly wait: RunWait; readonly run: VersionedRun };

export interface WaitContext extends RunResultContext {
  /** Loaded while holding the Run row lock. */
  readonly run: VersionedRun | null;
  /** The open or closed wait loaded while holding the same transaction. */
  readonly wait: RunWait | null;
  /** Read the addressed wait under the same transaction, including an already-closed row. */
  readWait(waitId: string): Promise<RunWait | null>;
  /** Read bounded Escalation provenance while the same Run transaction is held. */
  readEscalationDetails(waitId: string): Promise<EscalationDetails | null>;
  /** Role lookup bound to the same transaction, for the second authorization check. */
  readonly authorizationRoles: RoleRepository;
  /** The frozen plan used when a timeout must complete the Run. */
  frozenPlan(): Promise<ExecutablePlan | null>;
  /** Persist the abort marker before the sole CANCELED transition. */
  requestCancellation(request: RunCancellationRequest): Promise<void>;
  /** Record one person's pause request. The FIRST request wins, as with a cancellation. */
  requestPause(request: RunPauseRequest): Promise<void>;
  /** Insert the wait, move the Run to Awaiting Auditor and enqueue its wake job atomically. */
  createWait(wait: RunWait): Promise<WaitOperation>;
  /** Close an answer and compare-and-set the Run revision; continuation recovery resumes it. */
  closeWait(input: CloseWaitInput): Promise<WaitOperation>;
  /** Close an overdue wait and move the Run to Inconclusive atomically. */
  timeoutWait(input: TimeoutWaitInput): Promise<WaitOperation>;
}

export interface CloseWaitInput {
  readonly waitId: string;
  readonly expectedRunRevision: number;
  readonly answerOptionId: string;
  readonly actor: string;
  readonly now: string;
  /** `AWAITING_AUDITOR` for abort; cancellation then owns the terminal transition. */
  readonly stateAfterClose: 'RUNNING' | 'AWAITING_AUDITOR';
}

export interface TimeoutWaitInput {
  readonly waitId: string;
  readonly now: string;
}

export interface RecoverableWait {
  readonly waitId: string;
  readonly runId: string;
}

/** The application-owned transaction port. It contains no database or queue types. */
export interface WaitRepository {
  transaction<T>(runId: string, work: (context: WaitContext) => Promise<T>): Promise<T>;
  recoverableWaits(limit: number): Promise<readonly RecoverableWait[]>;
}

export interface RaiseEscalationInput {
  readonly runId: string;
  readonly kind: EscalationKind;
  /** Candidate choices for choose-candidate; fixed kinds ignore caller-supplied options. */
  readonly options?: readonly (EscalationOption | string)[];
  /** Optional safe Timeline metadata. The question itself is never persisted here. */
  readonly stepId?: string | null;
  readonly supportingEvidenceIds?: readonly string[];
}

export interface RaiseEscalationDependencies {
  readonly repository: WaitRepository;
  readonly ids: UuidV7Generator;
  readonly clock: Clock;
}

export type RaiseEscalationResult =
  | { readonly ok: true; readonly wait: RunWait; readonly run: VersionedRun }
  | { readonly ok: false; readonly reason: string; readonly operation?: WaitOperation };

export const RAISE_ESCALATION_REFUSALS = {
  malformed: 'Choose a supported Escalation and its closed answer set.',
  runNotRunning: 'The Run is not running and cannot open an Escalation.',
  alreadyOpen: 'This Run already has an open Escalation.',
  unsupported: 'That Escalation kind is not supported by this deployment.',
} as const;

export type CandidateMatchDisposition = 'platform-resolve' | 'absence' | 'choose-candidate';

/**
 * Decide whether a search result is platform-decidable.
 *
 * Exactly one grounded key match resolves. Zero rows follows the absence path. Any other
 * non-empty result, including duplicate rows carrying the same grounded key, needs a
 * choose-candidate wait.
 */
export function candidateMatchDisposition(
  candidates: readonly { readonly groundedKey: string | null }[],
  recordKey: string,
): CandidateMatchDisposition {
  if (candidates.length === 0) return 'absence';
  const matches = candidates.filter((candidate) => candidate.groundedKey === recordKey).length;
  return matches === 1 ? 'platform-resolve' : 'choose-candidate';
}

export const chooseCandidateDisposition = candidateMatchDisposition;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPTION_ID = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,254}$/;

function validRaiseMetadata(input: RaiseEscalationInput): boolean {
  const keys = Object.keys(input as object);
  if (keys.some((key) => !['runId', 'kind', 'options', 'stepId', 'supportingEvidenceIds'].includes(key))) return false;
  if (Object.hasOwn(input, 'stepId') && input.stepId !== null &&
      (typeof input.stepId !== 'string' || !OPTION_ID.test(input.stepId))) return false;
  if (Object.hasOwn(input, 'supportingEvidenceIds')) {
    const ids = input.supportingEvidenceIds;
    if (!Array.isArray(ids) || ids.length > 100 || ids.some((id) => typeof id !== 'string' || !UUID.test(id))) return false;
  }
  return true;
}

function normalizeOptions(kind: EscalationKind, options: readonly (EscalationOption | string)[] | undefined): readonly EscalationOption[] | null {
  if (kind !== 'choose-candidate') return FIXED_ESCALATION_OPTIONS[kind];
  if (!Array.isArray(options) || options.length < 2) return null;
  const normalized = options.flatMap((option): EscalationOption[] => {
    if (typeof option === 'string') return [{ id: option, label: option }];
    if (!option || typeof option !== 'object' || Array.isArray(option)) return [];
    const id = (option as { id?: unknown }).id;
    const label = (option as { label?: unknown }).label;
    return typeof id === 'string' && typeof label === 'string' ? [{ id, label }] : [];
  });
  if (normalized.length !== options.length) return null;
  const ambiguous = normalized.at(-1);
  if (!ambiguous || ambiguous.id !== ESCALATION_OPTION_IDS.markAmbiguous ||
      !OPTION_ID.test(ambiguous.id) || ambiguous.label.trim().length === 0 || ambiguous.label.length > 500) return null;
  const candidateOptions = normalized.slice(0, -1);
  if (candidateOptions.some((option) => !OPTION_ID.test(option.id) || RESERVED_ESCALATION_OPTION_IDS.has(option.id) || option.label.trim().length === 0 || option.label.length > 500)) return null;
  const ids = new Set(candidateOptions.map((option) => option.id));
  if (ids.size !== candidateOptions.length) return null;
  return normalized;
}

function validWaitInput(input: RaiseEscalationInput): input is RaiseEscalationInput & { readonly kind: EscalationKind } {
  return Boolean(input) && typeof input === 'object' && !Array.isArray(input) &&
    Object.hasOwn(input, 'runId') && Object.hasOwn(input, 'kind') && validRaiseMetadata(input) &&
    UUID.test(input.runId) && isEscalationKind(input.kind);
}

function auditWaitPayload(wait: RunWait, input: RaiseEscalationInput): JsonObject {
  return {
    waitId: wait.waitId,
    kind: wait.kind,
    optionIds: wait.options.map((option) => option.id),
    deadline: wait.deadline,
    ...(input.stepId === undefined || input.stepId === null ? {} : { stepId: input.stepId }),
    ...(input.supportingEvidenceIds === undefined ? {} : { supportingEvidenceIds: [...input.supportingEvidenceIds] }),
  };
}

/** Raise one typed Escalation as a durable wait. */
export async function raiseEscalation(
  dependencies: RaiseEscalationDependencies,
  input: RaiseEscalationInput,
): Promise<RaiseEscalationResult> {
  if (!validWaitInput(input)) return { ok: false, reason: RAISE_ESCALATION_REFUSALS.malformed };
  const options = normalizeOptions(input.kind, input.options);
  if (!options) return { ok: false, reason: RAISE_ESCALATION_REFUSALS.malformed };
  const now = dependencies.clock.now();
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return { ok: false, reason: RAISE_ESCALATION_REFUSALS.malformed };
  const deadline = new Date(now.getTime() + waitTimeoutMs(input.kind));
  const wait: RunWait = {
    waitId: dependencies.ids.next(),
    runId: input.runId.toLowerCase(),
    kind: input.kind,
    options,
    openedAt: now.toISOString(),
    // The platform raised it, so no person is named. Generation 45 refuses an Escalation
    // that names one, and refuses a pause that does not.
    openedBy: null,
    deadline: deadline.toISOString(),
    closedAt: null,
    closureKind: null,
    answerOptionId: null,
    actor: null,
  };
  if (!UUID.test(wait.waitId)) return { ok: false, reason: RAISE_ESCALATION_REFUSALS.malformed };
  return dependencies.repository.transaction(wait.runId, async (context) => {
    const run = context.run;
    if (context.wait !== null) {
      if (!run) return { ok: false, reason: RAISE_ESCALATION_REFUSALS.runNotRunning };
      return { ok: false, reason: RAISE_ESCALATION_REFUSALS.alreadyOpen, operation: { outcome: 'already-open', wait: context.wait, run } };
    }
    if (!run || run.state !== 'RUNNING') return { ok: false, reason: RAISE_ESCALATION_REFUSALS.runNotRunning };
    const operation = await context.createWait(wait);
    if (operation.outcome === 'already-open') return { ok: false, reason: RAISE_ESCALATION_REFUSALS.alreadyOpen, operation };
    if (operation.outcome !== 'created') return { ok: false, reason: RAISE_ESCALATION_REFUSALS.runNotRunning, operation };
    const event = await context.auditEvents.append({
      actor: { type: 'system', id: 'escalation-platform' },
      eventType: 'execution.escalation-raised',
      source: 'platform',
      outcome: 'success',
      aggregateId: run.runId,
      correlationId: run.correlationId,
      sessionId: run.sessionId,
      payload: auditWaitPayload(wait, input),
    });
    await context.notifyTimeline(event.sequence);
    return { ok: true, wait: operation.wait, run: operation.run };
  });
}

export interface AnswerEscalationDependencies {
  readonly repository: WaitRepository;
  readonly roles: RoleRepository;
  readonly unitOfWork: AuditUnitOfWork;
  readonly ids: UuidV7Generator;
  readonly clock: Clock;
}

export interface AnswerEscalationInput {
  readonly session: SessionSnapshot;
  readonly request: unknown;
}

export type AnswerEscalationResult =
  | { readonly ok: true; readonly state: 'RUNNING' | 'CANCELED'; readonly wait: RunWait; readonly answerOptionId: string }
  | { readonly ok: false; readonly reason: string; readonly code: AnswerEscalationRefusalCode; readonly timedOutAt?: string };

export type AnswerEscalationRefusalCode = 'malformed' | 'unknown' | 'closed' | 'stale-revision' | 'timed-out' | 'invalid-option';

export const ANSWER_ESCALATION_REFUSALS: Readonly<Record<AnswerEscalationRefusalCode, string>> = {
  malformed: 'Choose an open Escalation answer.',
  unknown: 'That Escalation does not exist.',
  closed: 'That Escalation has already been closed.',
  'stale-revision': 'This Run changed while you were answering. Reload the Run.',
  'timed-out': 'This Escalation timed out at {time}; the Run is Inconclusive.',
  'invalid-option': 'Choose one of the available Escalation answers.',
};

class Revoked extends Error {
  constructor(readonly role: Role | null, reason: string) {
    super(reason);
  }
}

function parseAnswerRequest(value: unknown): { runId: string; waitId: string; expectedRunRevision: number; answerOptionId: string; note: string | null } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.some((key) => !['runId', 'waitId', 'expectedRunRevision', 'answerOptionId', 'note'].includes(key))) return null;
  if (!Object.hasOwn(record, 'runId') || !Object.hasOwn(record, 'waitId') || !Object.hasOwn(record, 'expectedRunRevision') || !Object.hasOwn(record, 'answerOptionId')) return null;
  if (typeof record.runId !== 'string' || !UUID.test(record.runId) || typeof record.waitId !== 'string' || !UUID.test(record.waitId)) return null;
  if (typeof record.expectedRunRevision !== 'number' || !Number.isSafeInteger(record.expectedRunRevision) || record.expectedRunRevision < 0) return null;
  if (typeof record.answerOptionId !== 'string' || !OPTION_ID.test(record.answerOptionId)) return null;
  if (Object.hasOwn(record, 'note') && record.note !== null && (typeof record.note !== 'string' || record.note.trim().length === 0 || record.note.length > 500)) return null;
  return { runId: record.runId.toLowerCase(), waitId: record.waitId.toLowerCase(), expectedRunRevision: record.expectedRunRevision, answerOptionId: record.answerOptionId, note: typeof record.note === 'string' ? record.note.trim() : null };
}

/** Close one Escalation under the Run lock and expected revision. */
export async function answerEscalation(
  dependencies: AnswerEscalationDependencies,
  input: AnswerEscalationInput,
): Promise<AnswerEscalationResult> {
  const correlationId = dependencies.ids.next();
  const authorization = { session: input.session, correlationId, action: 'escalation.answer' as const };
  const permission = await authorizeCommandRole(dependencies, authorization);
  if (!permission.allowed) return { ok: false, reason: permission.reason, code: 'malformed' };
  const request = parseAnswerRequest(input.request);
  if (!request) return { ok: false, reason: ANSWER_ESCALATION_REFUSALS.malformed, code: 'malformed' };
  try {
    return await dependencies.repository.transaction(request.runId, async (context) => {
      const role = await context.authorizationRoles.findRole(input.session.userId);
      const locked = authorizeAction(role, 'escalation.answer');
      if (!locked.allowed) throw new Revoked(role, locked.reason);
      const run = context.run;
      const wait = await context.readWait(request.waitId);
      // A pause is a wait and is NOT an Escalation. Refused here as `unknown` because from
      // this command's point of view there is no such Escalation — and refused again by
      // generation 45, which cannot store `kind='pause'` closed as an `answer`. Resuming is
      // `resumeRun`'s, which refuses an Escalation the same way.
      if (!run || !wait || wait.waitId !== request.waitId || !isEscalationKind(wait.kind))
        return { ok: false, reason: ANSWER_ESCALATION_REFUSALS.unknown, code: 'unknown' };
      const now = dependencies.clock.now().toISOString();
      const option = wait.options.find((candidate) => candidate.id === request.answerOptionId);
      if (!option) return { ok: false, reason: ANSWER_ESCALATION_REFUSALS['invalid-option'], code: 'invalid-option' };
      const operation = await context.closeWait({
        waitId: request.waitId,
        expectedRunRevision: request.expectedRunRevision,
        answerOptionId: request.answerOptionId,
        actor: input.session.userId,
        now,
        stateAfterClose: request.answerOptionId === ESCALATION_OPTION_IDS.abort ? 'AWAITING_AUDITOR' : 'RUNNING',
      });
      if (operation.outcome === 'superseded') {
        if (wait.closureKind === 'timeout') {
          const timedOutAt = wait.closedAt ?? wait.deadline;
          return { ok: false, reason: ANSWER_ESCALATION_REFUSALS['timed-out'].replace('{time}', timedOutAt), code: 'timed-out', timedOutAt };
        }
        return { ok: false, reason: ANSWER_ESCALATION_REFUSALS.closed, code: 'closed' };
      }
      if (operation.outcome === 'stale-revision') return { ok: false, reason: ANSWER_ESCALATION_REFUSALS['stale-revision'], code: 'stale-revision' };
      if (operation.outcome === 'expired') return { ok: false, reason: ANSWER_ESCALATION_REFUSALS['timed-out'].replace('{time}', wait.deadline), code: 'timed-out', timedOutAt: wait.deadline };
      if (operation.outcome !== 'closed') return { ok: false, reason: ANSWER_ESCALATION_REFUSALS.unknown, code: 'unknown' };
      const event = await context.auditEvents.append({
        actor: { type: 'human', id: input.session.userId },
        eventType: 'execution.escalation-answered',
        source: 'web',
        outcome: 'success',
        aggregateId: run.runId,
        correlationId,
        sessionId: input.session.sessionId,
        payload: {
          waitId: wait.waitId,
          kind: wait.kind,
          answerOptionId: request.answerOptionId,
          closureKind: 'answer',
          priorState: 'AWAITING_AUDITOR',
          state: request.answerOptionId === ESCALATION_OPTION_IDS.abort ? 'CANCELED' : 'RUNNING',
          occurredAt: now,
          ...(request.note === null ? {} : { recordedNote: request.note }),
        },
      });
      await context.notifyTimeline(event.sequence);
      if (request.answerOptionId === ESCALATION_OPTION_IDS.abort) {
        const cancellation = {
          requestedBy: input.session.userId,
          sessionId: input.session.sessionId,
          requestedAt: now,
          reason: 'Escalation answer: abort',
        } as const;
        await context.requestCancellation(cancellation);
        await performCancellation(context, {
          run,
          request: cancellation,
          at: now,
          plan: await context.frozenPlan(),
          source: 'web',
        });
      }
      return { ok: true, state: request.answerOptionId === ESCALATION_OPTION_IDS.abort ? 'CANCELED' : 'RUNNING', wait: operation.wait, answerOptionId: request.answerOptionId };
    });
  } catch (error) {
    if (error instanceof Revoked) {
      await recordAuthorizationDenial(dependencies, authorization, error.role, error.message);
      return { ok: false, reason: error.message, code: 'malformed' };
    }
    throw error;
  }
}

export interface WakeEscalationDependencies {
  readonly repository: WaitRepository;
  readonly clock: Clock;
}

export type WakeEscalationResult =
  | { readonly ok: true; readonly status: 'timed-out' | 'superseded' | 'early'; readonly wait: RunWait | null }
  | { readonly ok: false; readonly reason: string };

export function parseWaitJob(value: unknown): WaitJob | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (Object.keys(value).length !== 3 || !Object.hasOwn(value, 'schemaVersion') || !Object.hasOwn(value, 'runId') || !Object.hasOwn(value, 'waitId')) return null;
  if (!('schemaVersion' in value) || !('runId' in value) || !('waitId' in value)) return null;
  if (value.schemaVersion !== WAIT_SCHEMA_VERSION || typeof value.runId !== 'string' || typeof value.waitId !== 'string' || !UUID.test(value.runId) || !UUID.test(value.waitId)) return null;
  return { schemaVersion: WAIT_SCHEMA_VERSION, runId: value.runId.toLowerCase(), waitId: value.waitId.toLowerCase() };
}

/** The worker-side wake operation. It never trusts data outside the wait row. */
export async function wakeEscalation(
  dependencies: WakeEscalationDependencies,
  job: unknown,
): Promise<WakeEscalationResult> {
  const parsed = parseWaitJob(job);
  if (!parsed) return { ok: false, reason: 'Invalid Escalation wake job.' };
  return dependencies.repository.transaction(parsed.runId, async (context) => {
    const operation = await context.timeoutWait({ waitId: parsed.waitId, now: dependencies.clock.now().toISOString() });
    if (operation.outcome === 'superseded') return { ok: true, status: 'superseded', wait: operation.wait };
    if (operation.outcome === 'early') return { ok: true, status: 'early', wait: operation.wait };
    if (operation.outcome !== 'timed-out') return { ok: false, reason: 'That Escalation does not exist.' };
    const run = context.run;
    if (!run) return { ok: false, reason: 'That Run does not exist.' };
    const at = dependencies.clock.now().toISOString();
    const event = await context.auditEvents.append({
      actor: { type: 'system', id: 'escalation-wake' },
      eventType: 'execution.escalation-timeout',
      source: 'worker',
      outcome: 'failure',
      aggregateId: run.runId,
      correlationId: run.correlationId,
      sessionId: run.sessionId,
      payload: {
        waitId: operation.wait.waitId,
        kind: operation.wait.kind,
        closureKind: 'timeout',
        priorState: 'AWAITING_AUDITOR',
        state: 'INCONCLUSIVE',
        occurredAt: at,
      },
    });
    await context.notifyTimeline(event.sequence);
    // timeoutWait already changed the Run state under the same lock; CompleteRun owns the
    // terminal Result and Evidence seal and therefore remains the sole sealing path.
    await completeRun(context, { run, state: 'INCONCLUSIVE', at, plan: await context.frozenPlan() });
    return { ok: true, status: 'timed-out', wait: operation.wait };
  });
}

export const timeoutEscalation = wakeEscalation;
export const wakeWait = wakeEscalation;
