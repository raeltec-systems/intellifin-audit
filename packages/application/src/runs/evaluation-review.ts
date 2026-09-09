import {
  authorizeAction,
  type EvaluationConfirmation,
  type EvaluationOrigin,
  type EvaluationValue,
  type ExecutablePlan,
  type JsonObject,
  type RunRecord,
} from '@intellifin/domain';

import type { AuditUnitOfWork } from '../audit/ports.js';
import type { Clock, UuidV7Generator } from '../audit/clock.js';
import { authorizeCommandRole } from '../identity/authorize.js';
import type { RoleRepository, SessionSnapshot } from '../identity/ports.js';
import { sealResult, type SealResultContext, type CompleteRunInput } from './complete-run.js';
import type { StoredRunResult } from './execution-ports.js';

/** The two human actions in §4.9. There is intentionally no edit or delete action. */
export const EVALUATION_REVIEW_ACTIONS = ['confirm', 'reject'] as const;
export type EvaluationReviewAction = (typeof EVALUATION_REVIEW_ACTIONS)[number];

export const EVALUATION_REVIEW_VALUES = ['COMPLIANT', 'EXCEPTION', 'UNEVALUATED'] as const;

/**
 * The evaluation row as it is read while the Result row is locked.
 *
 * `confidence`, `rationale` and `evidenceIds` are the original agent proposal. They are
 * copied into every decision record by the command so later effective-value changes do
 * not overwrite the proposal that a reviewer actually saw.
 */
export interface EvaluationReviewTarget {
  readonly runId: string;
  readonly observationId: string;
  readonly conditionId: string;
  readonly origin: EvaluationOrigin;
  readonly value: EvaluationValue;
  readonly confirmation: EvaluationConfirmation | null;
  readonly confidence: string | null;
  readonly rationale: string | null;
  readonly evidenceIds: readonly string[];
}

export interface EvaluationReviewTargetKey {
  readonly observationId: string;
  readonly conditionId: string;
}

/** The immutable history row written for one confirmation or rejection. */
export interface EvaluationReviewDecision {
  readonly decisionId: string;
  readonly runId: string;
  readonly observationId: string;
  readonly conditionId: string;
  /** The post-write review revision; this is separate from Result.version and Run.revision. */
  readonly reviewRevision: number;
  readonly action: EvaluationReviewAction;
  readonly originalOrigin: 'AGENT_JUDGED';
  readonly originalValue: EvaluationValue;
  readonly originalConfirmation: 'pending';
  readonly originalConfidence: string | null;
  readonly originalRationale: string | null;
  readonly originalEvidenceIds: readonly string[];
  readonly effectiveOrigin: 'AGENT_JUDGED' | 'HUMAN';
  readonly effectiveValue: EvaluationValue;
  readonly effectiveConfirmation: 'confirmed' | null;
  readonly replacementValue: EvaluationValue | null;
  readonly rejectionRationale: string | null;
  readonly actorId: string;
  readonly decidedAt: string;
}

export type WriteEvaluationDecisionResult =
  | { readonly status: 'written'; readonly reviewRevision: number }
  | { readonly status: 'stale-revision' }
  | { readonly status: 'already-decided' };

/**
 * The repository's transaction is responsible for locking the Result row before exposing
 * this context. The application layer only sees ports, so it cannot accidentally perform
 * a review update outside the Result lock or compare against an unlocked revision.
 */
export interface EvaluationReviewContext extends SealResultContext {
  readonly run: RunRecord | null;
  readonly authorizationRoles: RoleRepository;
  /** The review revision loaded while the Result row is locked. */
  readonly reviewRevision: number | null;
  readReviewTarget(key: EvaluationReviewTargetKey): Promise<EvaluationReviewTarget | null>;
  readReviewDecisions(key: EvaluationReviewTargetKey): Promise<readonly EvaluationReviewDecision[]>;
  frozenPlan(): Promise<ExecutablePlan | null>;
  writeDecision(
    decision: EvaluationReviewDecision,
    expectedReviewRevision: number,
  ): Promise<WriteEvaluationDecisionResult>;
  /**
   * Every transaction context must account for an effective Exception. A context without
   * the worker-only signer must provide a fail-closed implementation that throws; leaving
   * this optional would let a direct review write and seal a Result without its permanent
   * Exception lineage.
   */
  ensureException: (observationId: string, raisedAt: string) => Promise<void>;
}

export interface EvaluationReviewRepository {
  transaction<TResult>(
    runId: string,
    work: (context: EvaluationReviewContext) => Promise<TResult>,
  ): Promise<TResult>;
}

export interface EvaluationReviewDependencies {
  readonly repository: EvaluationReviewRepository;
  readonly roles: RoleRepository;
  readonly unitOfWork: AuditUnitOfWork;
  readonly ids: UuidV7Generator;
  readonly clock: Clock;
}

export interface EvaluationReviewInput {
  readonly session: SessionSnapshot;
  readonly request: unknown;
}

export type EvaluationReviewRefusalCode =
  | 'malformed'
  | 'unauthorized'
  | 'unknown'
  | 'not-completed'
  | 'sealed'
  | 'not-pending'
  | 'stale-revision'
  | 'rationale-required'
  | 'invalid-replacement';

export const EVALUATION_REVIEW_REFUSALS: Readonly<Record<EvaluationReviewRefusalCode, string>> = {
  malformed: 'Choose a valid evaluation review.',
  unauthorized: 'You are not allowed to review this evaluation.',
  unknown: 'That evaluation does not exist.',
  'not-completed': 'Only a Completed Run can accept an evaluation decision.',
  sealed: 'This Result is sealed and cannot be changed.',
  'not-pending': 'That evaluation is not awaiting confirmation.',
  'stale-revision': 'This Result changed while you were deciding. Reload the Run.',
  'rationale-required': 'Enter a rationale for rejecting this evaluation.',
  'invalid-replacement': 'Choose Compliant, Exception, or Unevaluated as the replacement.',
};

export type EvaluationReviewSuccess = {
  readonly ok: true;
  readonly action: EvaluationReviewAction;
  readonly decision: EvaluationReviewDecision;
  readonly result: StoredRunResult;
};

export type EvaluationReviewResult =
  | EvaluationReviewSuccess
  | {
      readonly ok: false;
      readonly code: EvaluationReviewRefusalCode;
      readonly reason: string;
    };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONDITION_ID = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,254}$/;
const RATIONALE_MAX_LENGTH = 4_000;

export interface ParsedEvaluationReviewRequest {
  readonly runId: string;
  readonly observationId: string;
  readonly conditionId: string;
  readonly expectedReviewRevision: number;
  readonly replacementValue: EvaluationValue | null;
  readonly rationale: string | null;
}

export type ReviewRequestParseResult = ParsedEvaluationReviewRequest | { readonly error: EvaluationReviewRefusalCode };

function isEvaluationValue(value: unknown): value is EvaluationValue {
  return typeof value === 'string' && (EVALUATION_REVIEW_VALUES as readonly string[]).includes(value);
}

export function parseEvaluationReviewRequest(value: unknown, action: EvaluationReviewAction): ReviewRequestParseResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'malformed' };
  const record = value as Record<string, unknown>;
  const common = ['runId', 'observationId', 'conditionId', 'expectedReviewRevision'];
  const actionKeys = action === 'reject' ? ['replacementValue', 'rationale'] : [];
  const allowed = new Set([...common, ...actionKeys]);
  const keys = Object.keys(record);
  if (keys.some((key) => !allowed.has(key))) return { error: 'malformed' };
  if (common.some((key) => !Object.hasOwn(record, key))) return { error: 'malformed' };
  if (
    typeof record.runId !== 'string' ||
    !UUID.test(record.runId) ||
    typeof record.observationId !== 'string' ||
    !UUID.test(record.observationId) ||
    typeof record.conditionId !== 'string' ||
    !CONDITION_ID.test(record.conditionId) ||
    typeof record.expectedReviewRevision !== 'number' ||
    !Number.isSafeInteger(record.expectedReviewRevision) ||
    record.expectedReviewRevision < 0
  ) return { error: 'malformed' };

  if (action === 'confirm') {
    return {
      runId: record.runId.toLowerCase(),
      observationId: record.observationId.toLowerCase(),
      conditionId: record.conditionId,
      expectedReviewRevision: record.expectedReviewRevision,
      replacementValue: null,
      rationale: null,
    };
  }

  if (!Object.hasOwn(record, 'replacementValue') || !isEvaluationValue(record.replacementValue)) return { error: 'invalid-replacement' };
  if (!Object.hasOwn(record, 'rationale') || typeof record.rationale !== 'string') return { error: 'rationale-required' };
  const rationale = record.rationale.trim();
  if (rationale.length === 0 || rationale.length > RATIONALE_MAX_LENGTH) return { error: 'rationale-required' };
  return {
    runId: record.runId.toLowerCase(),
    observationId: record.observationId.toLowerCase(),
    conditionId: record.conditionId,
    expectedReviewRevision: record.expectedReviewRevision,
    replacementValue: record.replacementValue,
    rationale,
  };
}

function refusal(code: EvaluationReviewRefusalCode, reason = EVALUATION_REVIEW_REFUSALS[code]): EvaluationReviewResult {
  return { ok: false, code, reason };
}

/** Confirm one pending AGENT_JUDGED evaluation and seal the Result if it was the last. */
export function confirmEvaluation(
  dependencies: EvaluationReviewDependencies,
  input: EvaluationReviewInput,
): Promise<EvaluationReviewResult> {
  return reviewEvaluation(dependencies, input, 'confirm');
}

/** Reject one pending AGENT_JUDGED evaluation with a required human replacement and rationale. */
export function rejectEvaluation(
  dependencies: EvaluationReviewDependencies,
  input: EvaluationReviewInput,
): Promise<EvaluationReviewResult> {
  return reviewEvaluation(dependencies, input, 'reject');
}

/** Shared implementation for the two closed review commands. */
export async function reviewEvaluation(
  dependencies: EvaluationReviewDependencies,
  input: EvaluationReviewInput,
  action: EvaluationReviewAction,
): Promise<EvaluationReviewResult> {
  const correlationId = dependencies.ids.next();
  const authorization = { session: input.session, correlationId, action: action === 'confirm' ? 'evaluation.confirm' as const : 'evaluation.reject' as const };
  const permission = await authorizeCommandRole(dependencies, authorization);
  if (!permission.allowed) return refusal('unauthorized', permission.reason);

  const parsed = parseEvaluationReviewRequest(input.request, action);
  if ('error' in parsed) return refusal(parsed.error);
  const request = parsed;

  return dependencies.repository.transaction(request.runId, async (context) =>
    reviewEvaluationInContext(dependencies, context, input, action, {
      correlationId,
      source: 'web',
    }));
}

/**
 * Execute a previously dispatched review in the caller's already locked transaction.
 *
 * This is deliberately separate from {@link reviewEvaluation}: the web command only
 * authorizes and enqueues. The worker calls this function after locking the durable
 * command row and the Run, so role reauthorization, the immutable decision, any newly
 * raised Exception, the audit event and Result seal share one commit boundary.
 */
export async function reviewEvaluationInContext(
  dependencies: Pick<EvaluationReviewDependencies, 'ids' | 'clock'>,
  context: EvaluationReviewContext,
  input: EvaluationReviewInput,
  action: EvaluationReviewAction,
  options: {
    readonly correlationId: string;
    readonly source: 'web' | 'worker';
  },
): Promise<EvaluationReviewResult> {
  const parsed = parseEvaluationReviewRequest(input.request, action);
  if ('error' in parsed) return refusal(parsed.error);
  const request = parsed;

  const role = await context.authorizationRoles.findRole(input.session.userId);
  const authorizationAction = action === 'confirm' ? 'evaluation.confirm' as const : 'evaluation.reject' as const;
  const locked = authorizeAction(role, authorizationAction);
  if (!locked.allowed) {
    await context.auditEvents.append({
      actor: { type: 'human', id: input.session.userId },
      eventType: 'security.denied',
      source: options.source,
      outcome: 'denied',
      sessionId: input.session.sessionId,
      correlationId: options.correlationId,
      aggregateId: context.run?.runId,
      payload: { action: authorizationAction, role: role ?? null, reason: locked.reason },
    });
    return refusal('unauthorized', locked.reason);
  }

  const run = context.run;
  if (!run) return refusal('unknown');
  if (run.state !== 'COMPLETED') return refusal('not-completed');

  const result = await context.readResult();
  if (!result) return refusal('unknown');
  if (result.sealed) return refusal('sealed');
  if (result.runState !== 'COMPLETED') return refusal('not-completed');
  if (result.outcome !== 'PENDING_CONFIRMATION') return refusal('not-pending');

  const reviewRevision = context.reviewRevision;
  if (reviewRevision === null || reviewRevision !== request.expectedReviewRevision) {
    return refusal('stale-revision');
  }

  const key = { observationId: request.observationId, conditionId: request.conditionId };
  const target = await context.readReviewTarget(key);
  if (!target || target.runId !== run.runId) return refusal('unknown');
  if (target.origin !== 'AGENT_JUDGED' || target.confirmation !== 'pending') return refusal('not-pending');
  const history = await context.readReviewDecisions(key);
  if (history.length > 0) return refusal('not-pending');

  const now = dependencies.clock.now().toISOString();
  const decision: EvaluationReviewDecision = {
    decisionId: dependencies.ids.next(),
    runId: run.runId,
    observationId: target.observationId,
    conditionId: target.conditionId,
    reviewRevision: reviewRevision + 1,
    action,
    originalOrigin: 'AGENT_JUDGED',
    originalValue: target.value,
    originalConfirmation: 'pending',
    originalConfidence: target.confidence,
    originalRationale: target.rationale,
    originalEvidenceIds: [...target.evidenceIds],
    effectiveOrigin: action === 'confirm' ? 'AGENT_JUDGED' : 'HUMAN',
    effectiveValue: action === 'confirm' ? target.value : request.replacementValue as EvaluationValue,
    effectiveConfirmation: action === 'confirm' ? 'confirmed' : null,
    replacementValue: action === 'confirm' ? null : request.replacementValue,
    rejectionRationale: action === 'confirm' ? null : request.rationale,
    actorId: input.session.userId,
    decidedAt: now,
  };

  const written = await context.writeDecision(decision, request.expectedReviewRevision);
  if (written.status === 'stale-revision') return refusal('stale-revision');
  if (written.status === 'already-decided') return refusal('not-pending');

  if (decision.effectiveValue === 'EXCEPTION') {
    await context.ensureException(target.observationId, now);
  }

  const event = await context.auditEvents.append({
    actor: { type: 'human', id: input.session.userId },
    eventType: action === 'confirm' ? 'execution.evaluation-confirmed' : 'execution.evaluation-rejected',
    source: options.source,
    outcome: 'success',
    aggregateId: run.runId,
    correlationId: options.correlationId,
    sessionId: input.session.sessionId,
    payload: {
      observationId: target.observationId,
      conditionId: target.conditionId,
      action,
      reviewRevision: decision.reviewRevision,
      originalValue: target.value,
      effectiveValue: decision.effectiveValue,
      ...(action === 'reject'
        ? { replacementValue: decision.replacementValue, rationale: decision.rejectionRationale }
        : {}),
      occurredAt: now,
    } as JsonObject,
  });
  await context.notifyTimeline(event.sequence);

  // `sealResult` re-reads the effective evaluation counts from this same transaction.
  // It returns the still-open Result when another pending evaluation remains and seals
  // exactly once when this decision removed the last pending row.
  const sealed = await sealResult(context, {
    run,
    state: 'COMPLETED',
    at: now,
    plan: await context.frozenPlan(),
  } satisfies CompleteRunInput);
  const finalResult = sealed ?? (await context.readResult());
  if (!finalResult) throw new Error('Evaluation review committed without a Result');
  return { ok: true, action, decision, result: finalResult };
}
