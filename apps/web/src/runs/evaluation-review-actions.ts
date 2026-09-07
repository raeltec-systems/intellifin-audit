'use server';

import { revalidatePath } from 'next/cache';

import {
  EVALUATION_REVIEW_REFUSALS,
  EVALUATION_REVIEW_VALUES,
  dispatchEvaluationReview,
  type EvaluationReviewDispatchResult,
  type EvaluationReviewResult,
} from '@intellifin/application';
import {
  CryptoUuidV7Generator,
  DrizzleRoleRepository,
  PostgresAuditUnitOfWork,
  PostgresEvaluationReviewRepository,
  SystemClock,
} from '@intellifin/infrastructure';

import { getRuntime } from '../bootstrap';
import { currentCorrelationId, requireServerAction } from '../server-session';

/** A request is still untrusted when it arrives at a typed Server Action call site. */
export interface ConfirmEvaluationRequest {
  readonly runId: string;
  readonly observationId: string;
  readonly conditionId: string;
  readonly expectedReviewRevision: number;
}

export interface RejectEvaluationRequest extends ConfirmEvaluationRequest {
  readonly replacementValue: (typeof EVALUATION_REVIEW_VALUES)[number];
  readonly rationale: string;
}

export type EvaluationReviewActionResult =
  | EvaluationReviewResult
  | EvaluationReviewDispatchResult
  | { readonly ok: false; readonly code: 'malformed' | 'unknown-outcome'; readonly reason: string; readonly unknownOutcome?: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONDITION_ID = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,254}$/;
const RATIONALE_MAX_LENGTH = 4_000;
const UNKNOWN = 'The evaluation decision could not be confirmed. Reload the Run before trying again.';

function isEvaluationValue(value: unknown): value is (typeof EVALUATION_REVIEW_VALUES)[number] {
  return typeof value === 'string' && (EVALUATION_REVIEW_VALUES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validCommonRequest(value: unknown, action: 'confirm' | 'reject'): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const allowed = action === 'confirm'
    ? ['runId', 'observationId', 'conditionId', 'expectedReviewRevision']
    : ['runId', 'observationId', 'conditionId', 'expectedReviewRevision', 'replacementValue', 'rationale'];
  const keys = Object.keys(value);
  if (keys.length !== allowed.length || keys.some((key) => !allowed.includes(key))) return false;
  if (
    typeof value.runId !== 'string' || !UUID.test(value.runId) ||
    typeof value.observationId !== 'string' || !UUID.test(value.observationId) ||
    typeof value.conditionId !== 'string' || !CONDITION_ID.test(value.conditionId) ||
    typeof value.expectedReviewRevision !== 'number' ||
    !Number.isSafeInteger(value.expectedReviewRevision) || value.expectedReviewRevision < 0
  ) return false;
  if (action === 'reject') {
    if (!isEvaluationValue(value.replacementValue)) return false;
    if (typeof value.rationale !== 'string') return false;
    const rationale = value.rationale.trim();
    if (rationale.length === 0 || rationale.length > RATIONALE_MAX_LENGTH) return false;
  }
  return true;
}

function revalidateRun(runId: string): void {
  // Review changes the Result and its historical view. Every Run Detail tab is a route,
  // so leaving a sibling cached would show the old effective evaluation after a decision.
  for (const suffix of ['', '/evidence', '/exceptions', '/review', '/timeline']) {
    revalidatePath(`/runs/${runId}${suffix}`);
  }
  revalidatePath('/notifications');
}

async function unknownFailure(): Promise<EvaluationReviewActionResult> {
  try {
    const runtime = await getRuntime();
    // Database/driver errors can contain SQL text and bound values, including the
    // human rationale. Preserve only a fixed error kind and an operational code.
    runtime.telemetry.captureError('Captured failure', new Error('Evaluation review failed'), {
      correlationId: await currentCorrelationId(),
      outcome: 'failure',
      errorCode: 'EVALUATION_REVIEW_FAILED',
    });
  } catch {
    // Runtime boot failures are reported by instrumentation. The action still returns an
    // unknown outcome instead of telling the reviewer that a write did not happen.
  }
  return { ok: false, code: 'unknown-outcome', reason: UNKNOWN, unknownOutcome: true };
}

/** Confirm one pending Agent-Judged evaluation by enqueueing a worker-owned command. */
export async function confirmEvaluationAction(request: unknown): Promise<EvaluationReviewActionResult> {
  try {
    // This endpoint authorizes before inspecting input or constructing a database port.
    const decision = await requireServerAction('evaluation.confirm');
    if (!decision.allowed) return { ok: false, code: 'unauthorized', reason: decision.reason };
    if (!validCommonRequest(request, 'confirm')) {
      return { ok: false, code: 'malformed', reason: EVALUATION_REVIEW_REFUSALS.malformed };
    }
    const runtime = await getRuntime();
    const result = await dispatchEvaluationReview(
      {
        dispatcher: new PostgresEvaluationReviewRepository(runtime.db),
        roles: new DrizzleRoleRepository(runtime.db),
        unitOfWork: new PostgresAuditUnitOfWork(runtime.db),
        ids: new CryptoUuidV7Generator(),
        clock: new SystemClock(),
      },
      { session: decision.session, request },
      'confirm',
    );
    if (result.ok) revalidateRun(request.runId as string);
    return result;
  } catch {
    return unknownFailure();
  }
}

/** Reject one pending Agent-Judged evaluation by enqueueing a worker-owned command. */
export async function rejectEvaluationAction(request: unknown): Promise<EvaluationReviewActionResult> {
  try {
    // The rejection endpoint has its own gate; a confirm permission cannot be substituted.
    const decision = await requireServerAction('evaluation.reject');
    if (!decision.allowed) return { ok: false, code: 'unauthorized', reason: decision.reason };
    if (!validCommonRequest(request, 'reject')) {
      return { ok: false, code: 'malformed', reason: EVALUATION_REVIEW_REFUSALS.malformed };
    }
    const runtime = await getRuntime();
    const result = await dispatchEvaluationReview(
      {
        dispatcher: new PostgresEvaluationReviewRepository(runtime.db),
        roles: new DrizzleRoleRepository(runtime.db),
        unitOfWork: new PostgresAuditUnitOfWork(runtime.db),
        ids: new CryptoUuidV7Generator(),
        clock: new SystemClock(),
      },
      { session: decision.session, request },
      'reject',
    );
    if (result.ok) revalidateRun(request.runId as string);
    return result;
  } catch {
    return unknownFailure();
  }
}
