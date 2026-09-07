import type { EvaluationValue } from '@intellifin/domain';

import type { Clock, UuidV7Generator } from '../audit/clock.js';
import type { AuditUnitOfWork } from '../audit/ports.js';
import { authorizeCommandRole } from '../identity/authorize.js';
import type { RoleRepository, SessionSnapshot } from '../identity/ports.js';
import {
  EVALUATION_REVIEW_REFUSALS,
  type EvaluationReviewAction,
  type EvaluationReviewContext,
  type EvaluationReviewDependencies,
  type EvaluationReviewInput,
  type EvaluationReviewRefusalCode,
  type EvaluationReviewRepository,
  type EvaluationReviewResult,
  parseEvaluationReviewRequest,
  reviewEvaluationInContext,
} from './evaluation-review.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The versioned data carried by the dedicated evaluation-review pg-boss queue. */
export const EVALUATION_REVIEW_JOB_SCHEMA_VERSION = 1 as const;
export const EVALUATION_REVIEW_JOB_KIND = 'evaluation-review' as const;

/**
 * A review command is the durable handoff between the web action and the worker.
 *
 * It contains the reviewer identity and bounded rationale because the database command
 * row is the source of truth. The queue job contains only `commandId`, `runId` and the
 * correlation id, so pg-boss metadata cannot become a second review payload or a place
 * for authored text to leak.
 */
export interface EvaluationReviewCommand {
  readonly schemaVersion: typeof EVALUATION_REVIEW_JOB_SCHEMA_VERSION;
  readonly commandId: string;
  readonly runId: string;
  readonly observationId: string;
  readonly conditionId: string;
  readonly expectedReviewRevision: number;
  readonly action: EvaluationReviewAction;
  readonly replacementValue: EvaluationValue | null;
  readonly rationale: string | null;
  readonly actorId: string;
  readonly sessionId: string;
  readonly correlationId: string;
  readonly requestedAt: string;
}

/** The only review fields a queue delivery is allowed to carry. */
export interface EvaluationReviewJob {
  readonly schemaVersion: typeof EVALUATION_REVIEW_JOB_SCHEMA_VERSION;
  readonly kind: typeof EVALUATION_REVIEW_JOB_KIND;
  readonly commandId: string;
  readonly runId: string;
  readonly correlationId: string;
}

export type EvaluationReviewCommandReceipt = {
  readonly commandId: string;
  readonly status: 'accepted';
} | {
  readonly commandId: string;
  readonly status: 'conflict';
  /** Fixed copy only; authored rationale and identity never enter this message. */
  readonly reason: string;
};

export const EVALUATION_REVIEW_DISPATCH_REFUSALS = {
  conflict: 'Another review decision is already pending for this evaluation. Reload the Run.',
} as const;

/** Web-side port. The implementation inserts the command and queue job in one tx. */
export interface EvaluationReviewCommandDispatcher {
  enqueue(command: EvaluationReviewCommand): Promise<EvaluationReviewCommandReceipt>;
}

export type EvaluationReviewCommandCompletion =
  | {
      readonly status: 'SUCCEEDED';
      readonly decisionId: string;
      readonly reviewRevision: number;
      readonly resultVersion: number;
      readonly resultOutcome: string;
      readonly resultSealed: boolean;
    }
  | {
      readonly status: 'REFUSED';
      readonly refusalCode: string;
    };

/**
 * Safe read model for a command's durable state. It intentionally omits the stored
 * rationale, actor/session identity and queue payload; the review surface only needs to
 * distinguish queued, completed and refused work for the exact target/revision it read.
 */
export interface EvaluationReviewCommandStatus {
  readonly commandId: string;
  readonly observationId: string;
  readonly conditionId: string;
  readonly action: EvaluationReviewAction;
  readonly expectedReviewRevision: number;
  readonly status: 'PENDING' | 'SUCCEEDED' | 'REFUSED';
  readonly refusalCode: EvaluationReviewRefusalCode | 'unknown' | null;
  readonly requestedAt: string;
  readonly processedAt: string | null;
}

/** Read-only port used by Run Detail to show durable review command state. */
export interface EvaluationReviewCommandStatusReader {
  readCommandStatuses(
    runId: string,
    expectedReviewRevision: number,
    observationIds: readonly string[],
  ): Promise<readonly EvaluationReviewCommandStatus[]>;
}

/**
 * The context supplied by the infrastructure command transaction.
 * `completeCommand` is intentionally transaction-bound: a worker cannot acknowledge a
 * queue command while leaving its decision, Exception or Result seal uncommitted.
 */
export interface EvaluationReviewCommandContext extends EvaluationReviewContext {
  completeCommand(completion: EvaluationReviewCommandCompletion): Promise<void>;
}

/** Existing review repository plus the durable command transaction. */
export interface EvaluationReviewCommandRepository extends EvaluationReviewRepository, EvaluationReviewCommandDispatcher, EvaluationReviewCommandStatusReader {
  transactionCommand<TResult>(
    commandId: string,
    work: (command: EvaluationReviewCommand, context: EvaluationReviewCommandContext) => Promise<TResult>,
  ): Promise<TResult | null>;
}

export interface EvaluationReviewDispatchDependencies {
  readonly dispatcher: EvaluationReviewCommandDispatcher;
  readonly roles: RoleRepository;
  readonly unitOfWork: AuditUnitOfWork;
  readonly ids: UuidV7Generator;
  readonly clock: Clock;
}

export interface EvaluationReviewDispatchInput {
  readonly session: SessionSnapshot;
  readonly request: unknown;
}

export type EvaluationReviewDispatchResult =
  | {
      readonly ok: true;
      readonly status: 'accepted';
      readonly pending: true;
      readonly commandId: string;
      readonly action: EvaluationReviewAction;
      readonly runId: string;
      readonly expectedReviewRevision: number;
    }
  | {
      readonly ok: false;
      readonly code: 'malformed' | 'unauthorized' | 'already-pending';
      readonly reason: string;
    };

function refusal(code: 'malformed' | 'unauthorized', reason = EVALUATION_REVIEW_REFUSALS[code]): EvaluationReviewDispatchResult {
  return { ok: false, code, reason };
}

function boundedIdentity(value: string): boolean {
  return value.trim().length > 0 && value.length <= 255;
}

/**
 * Authorize and enqueue one review. The worker performs the authoritative second role
 * check while holding the Run/Result/revision locks.
 */
export async function dispatchEvaluationReview(
  dependencies: EvaluationReviewDispatchDependencies,
  input: EvaluationReviewDispatchInput,
  action: EvaluationReviewAction,
): Promise<EvaluationReviewDispatchResult> {
  const correlationId = dependencies.ids.next();
  const authorization = {
    session: input.session,
    correlationId,
    action: action === 'confirm' ? 'evaluation.confirm' as const : 'evaluation.reject' as const,
  };
  const permission = await authorizeCommandRole(dependencies, authorization);
  if (!permission.allowed) return refusal('unauthorized', permission.reason);

  const parsed = parseEvaluationReviewRequest(input.request, action);
  if ('error' in parsed) return refusal('malformed', EVALUATION_REVIEW_REFUSALS[parsed.error]);
  if (!boundedIdentity(input.session.userId) || !boundedIdentity(input.session.sessionId)) {
    return refusal('malformed');
  }

  const command: EvaluationReviewCommand = {
    schemaVersion: EVALUATION_REVIEW_JOB_SCHEMA_VERSION,
    commandId: dependencies.ids.next(),
    runId: parsed.runId,
    observationId: parsed.observationId,
    conditionId: parsed.conditionId,
    expectedReviewRevision: parsed.expectedReviewRevision,
    action,
    replacementValue: parsed.replacementValue,
    rationale: parsed.rationale,
    actorId: input.session.userId,
    sessionId: input.session.sessionId,
    correlationId,
    requestedAt: dependencies.clock.now().toISOString(),
  };
  const receipt = await dependencies.dispatcher.enqueue(command);
  if (receipt.status === 'conflict') {
    // Keep this response closed even if a future adapter gets the conflict path
    // wrong. Authored rationale and another actor's identity must not be reflected
    // back to the browser through a queue/database adapter.
    return {
      ok: false,
      code: 'already-pending',
      reason: EVALUATION_REVIEW_DISPATCH_REFUSALS.conflict,
    };
  }
  return {
    ok: true,
    status: 'accepted',
    pending: true,
    commandId: receipt.commandId,
    action,
    runId: command.runId,
    expectedReviewRevision: command.expectedReviewRevision,
  };
}

function completion(result: EvaluationReviewResult): EvaluationReviewCommandCompletion {
  if (!result.ok) return { status: 'REFUSED', refusalCode: result.code };
  return {
    status: 'SUCCEEDED',
    decisionId: result.decision.decisionId,
    reviewRevision: result.decision.reviewRevision,
    resultVersion: result.result.version,
    resultOutcome: result.result.outcome,
    resultSealed: result.result.sealed,
  };
}

export interface EvaluationReviewWorkerDependencies {
  readonly repository: EvaluationReviewCommandRepository;
  readonly ids: UuidV7Generator;
  readonly clock: Clock;
}

/**
 * Process one queue command. A terminal command returns `null` from the repository and is
 * acknowledged as a safe duplicate. Any thrown error leaves the row PENDING so pg-boss
 * can retry it; no command is marked complete before the review transaction succeeds.
 */
export function executeEvaluationReviewCommand(
  dependencies: EvaluationReviewWorkerDependencies,
  commandId: string,
): Promise<EvaluationReviewResult | null> {
  return dependencies.repository.transactionCommand(commandId, async (command, context) => {
    const request: Record<string, unknown> = {
      runId: command.runId,
      observationId: command.observationId,
      conditionId: command.conditionId,
      expectedReviewRevision: command.expectedReviewRevision,
      ...(command.action === 'reject'
        ? { replacementValue: command.replacementValue, rationale: command.rationale }
        : {}),
    };
    const input: EvaluationReviewInput = {
      session: { userId: command.actorId, sessionId: command.sessionId },
      request,
    };
    const result = await reviewEvaluationInContext(
      dependencies,
      context,
      input,
      command.action,
      { correlationId: command.correlationId, source: 'worker' },
    );
    await context.completeCommand(completion(result));
    return result;
  });
}

/** Narrow runtime parser for jobs that may have been redelivered or forged in the queue. */
export function parseEvaluationReviewJob(value: unknown): EvaluationReviewJob | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== EVALUATION_REVIEW_JOB_SCHEMA_VERSION ||
    record.kind !== EVALUATION_REVIEW_JOB_KIND ||
    typeof record.commandId !== 'string' || !UUID.test(record.commandId) ||
    typeof record.runId !== 'string' || !UUID.test(record.runId) ||
    typeof record.correlationId !== 'string' || !UUID.test(record.correlationId) ||
    Object.keys(record).some((key) => !['schemaVersion', 'kind', 'commandId', 'runId', 'correlationId'].includes(key))
  ) return null;
  return {
    schemaVersion: EVALUATION_REVIEW_JOB_SCHEMA_VERSION,
    kind: EVALUATION_REVIEW_JOB_KIND,
    commandId: record.commandId.toLowerCase(),
    runId: record.runId.toLowerCase(),
    correlationId: record.correlationId.toLowerCase(),
  };
}
