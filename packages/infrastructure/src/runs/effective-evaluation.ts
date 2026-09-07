import { and, eq, sql } from 'drizzle-orm';
import { runEvaluationReview, runObservationEvaluation } from '../db/schema.js';

/** Immutable machine rows remain the source; authorized decisions supply effective values. */
export const evaluationReviewJoin = and(
  eq(runEvaluationReview.runId, runObservationEvaluation.runId),
  eq(runEvaluationReview.observationId, runObservationEvaluation.observationId),
  eq(runEvaluationReview.conditionId, runObservationEvaluation.conditionId),
);
export const effectiveEvaluationValue = sql<string>`coalesce(${runEvaluationReview.effectiveValue}, ${runObservationEvaluation.value})`;
export const effectiveEvaluationOrigin = sql<string>`coalesce(${runEvaluationReview.effectiveOrigin}, ${runObservationEvaluation.origin})`;
// A rejection intentionally has NULL confirmation, so COALESCE would restore "pending".
export const effectiveEvaluationConfirmation = sql<string | null>`CASE WHEN ${runEvaluationReview.decisionId} IS NULL THEN ${runObservationEvaluation.confirmation} ELSE ${runEvaluationReview.effectiveConfirmation} END`;
