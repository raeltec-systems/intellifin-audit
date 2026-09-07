import { sql } from 'drizzle-orm';

import type {
  EvaluationReviewContext,
  EvaluationReviewDecision,
  EvaluationReviewRepository,
  EvaluationReviewTarget,
  EvaluationReviewTargetKey,
  WriteEvaluationDecisionResult,
} from '@intellifin/application';
import type { EvaluationConfirmation, EvaluationOrigin, EvaluationValue } from '@intellifin/domain';

import type { Database, Transaction } from '../db/client.js';
import { isUuidText } from '../db/identifier.js';
import { DrizzleRoleRepository } from '../identity/role-repository.js';
import { withRunExecutionContext } from './adapter-execution-repository.js';

/** The raw rows are deliberately typed at this boundary: SQL never crosses inward. */
type RawRow = Record<string, unknown>;

function rows(result: unknown): readonly RawRow[] {
  if (Array.isArray(result)) return result as RawRow[];
  if (result !== null && typeof result === 'object' && 'rows' in result) {
    const value = (result as { rows?: unknown }).rows;
    return Array.isArray(value) ? value as RawRow[] : [];
  }
  return [];
}

function textValue(value: unknown): string | null {
  return typeof value === 'string' ? value : value === null || value === undefined ? null : String(value);
}

function requiredText(row: RawRow, key: string): string | null {
  const value = textValue(row[key]);
  return value === null || value.length === 0 ? null : value;
}

function revisionValue(value: unknown): number | null {
  const revision = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
}

function dateValue(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function jsonArray(value: unknown): readonly unknown[] | null {
  let parsed = value;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      return null;
    }
  }
  return Array.isArray(parsed) ? parsed : null;
}

function evidenceIds(value: unknown): readonly string[] | null {
  const parsed = jsonArray(value);
  if (parsed === null || parsed.some((entry) => typeof entry !== 'string')) return null;
  return parsed as string[];
}

function evaluationOrigin(value: unknown): EvaluationOrigin | null {
  return value === 'RULE' || value === 'AGENT_JUDGED' || value === 'HUMAN' ? value : null;
}

function evaluationValue(value: unknown): EvaluationValue | null {
  return value === 'COMPLIANT' || value === 'EXCEPTION' || value === 'UNEVALUATED' ? value : null;
}

function evaluationConfirmation(value: unknown): EvaluationConfirmation | null {
  return value === 'pending' || value === 'confirmed' || value === 'rejected' ? value : null;
}

function nullableConfirmation(value: unknown): EvaluationConfirmation | null {
  return value === null || value === undefined ? null : evaluationConfirmation(value);
}

function reviewAction(value: unknown): 'confirm' | 'reject' | null {
  return value === 'confirm' || value === 'reject' ? value : null;
}

function parseTarget(row: RawRow, runId: string, key: EvaluationReviewTargetKey): EvaluationReviewTarget | null {
  const observationId = requiredText(row, 'observation_id')?.toLowerCase() ?? null;
  const conditionId = requiredText(row, 'condition_id');
  const rowRunId = requiredText(row, 'run_id')?.toLowerCase() ?? null;
  const origin = evaluationOrigin(row.origin);
  const value = evaluationValue(row.value);
  const confirmation = nullableConfirmation(row.confirmation);
  const evidence = evidenceIds(row.evidence_ids);
  if (
    observationId === null ||
    rowRunId !== runId ||
    conditionId === null ||
    origin === null ||
    value === null ||
    (row.confirmation !== null && row.confirmation !== undefined && confirmation === null) ||
    evidence === null ||
    !isUuidText(observationId) ||
    observationId !== key.observationId.toLowerCase() ||
    conditionId !== key.conditionId
  ) return null;
  return {
    runId,
    observationId,
    conditionId,
    origin,
    value,
    confirmation,
    confidence: textValue(row.confidence),
    rationale: textValue(row.rationale),
    evidenceIds: [...evidence],
  };
}

function parseDecision(row: RawRow, runId: string): EvaluationReviewDecision | null {
  const decisionId = requiredText(row, 'decision_id')?.toLowerCase() ?? null;
  const rowRunId = requiredText(row, 'run_id')?.toLowerCase() ?? null;
  const observationId = requiredText(row, 'observation_id')?.toLowerCase() ?? null;
  const conditionId = requiredText(row, 'condition_id');
  const revision = revisionValue(row.review_revision);
  const action = reviewAction(row.action);
  const originalOrigin = evaluationOrigin(row.original_origin);
  const originalValue = evaluationValue(row.original_value);
  const originalConfirmation = row.original_confirmation === 'pending' ? 'pending' as const : null;
  const effectiveOrigin = evaluationOrigin(row.effective_origin);
  const effectiveValue = evaluationValue(row.effective_value);
  const effectiveConfirmation = nullableConfirmation(row.effective_confirmation);
  const replacementValue = row.replacement_value === null || row.replacement_value === undefined
    ? null
    : evaluationValue(row.replacement_value);
  const decidedAt = dateValue(row.decided_at);
  const actorId = requiredText(row, 'actor_id');
  const evidence = evidenceIds(row.original_evidence_ids);
  const rationale = row.rejection_rationale;
  const validActionShape = action === 'confirm'
    ? effectiveOrigin === 'AGENT_JUDGED' && effectiveConfirmation === 'confirmed' && replacementValue === null && (rationale === null || rationale === undefined)
    : action === 'reject'
      ? effectiveOrigin === 'HUMAN' && effectiveConfirmation === null && replacementValue !== null && typeof rationale === 'string' && rationale.trim().length > 0
      : false;
  if (
    decisionId === null || !isUuidText(decisionId) ||
    rowRunId !== runId || observationId === null || !isUuidText(observationId) ||
    conditionId === null || revision === null || action === null ||
    originalOrigin !== 'AGENT_JUDGED' || originalValue === null || originalConfirmation !== 'pending' ||
    effectiveOrigin === null || effectiveValue === null ||
    (row.effective_confirmation !== null && row.effective_confirmation !== undefined && effectiveConfirmation === null) ||
    !validActionShape ||
    actorId === null || decidedAt === null || evidence === null
  ) return null;
  const originalConfidence = textValue(row.original_confidence);
  const originalRationale = textValue(row.original_rationale);
  const rejectionRationale = action === 'reject' ? rationale as string : null;
  return {
    decisionId,
    runId,
    observationId,
    conditionId,
    reviewRevision: revision,
    action,
    originalOrigin: 'AGENT_JUDGED',
    originalValue,
    originalConfirmation: 'pending',
    originalConfidence,
    originalRationale,
    originalEvidenceIds: [...evidence],
    effectiveOrigin: effectiveOrigin as 'AGENT_JUDGED' | 'HUMAN',
    effectiveValue,
    effectiveConfirmation: effectiveConfirmation === 'rejected' ? null : effectiveConfirmation as 'confirmed' | null,
    replacementValue,
    rejectionRationale,
    actorId,
    decidedAt,
  };
}

async function lockedReviewRevision(tx: Transaction, runId: string): Promise<number | null> {
  const result = await tx.execute(sql`
    SELECT run_id::text AS run_id
    FROM run_result
    WHERE run_id = ${runId}
    FOR UPDATE
  `);
  if (rows(result).length === 0) return null;

  // Results created before this adjacent aggregate existed may not have a review row.
  // Lazily initialize revision zero while the Result lock is held; that keeps those
  // existing Results reviewable without allowing two reviewers to initialize it twice.
  await tx.execute(sql`
    INSERT INTO run_result_review (run_id, revision)
    VALUES (${runId}, 0)
    ON CONFLICT (run_id) DO NOTHING
  `);
  const review = await tx.execute(sql`
    SELECT revision
    FROM run_result_review
    WHERE run_id = ${runId}
    FOR UPDATE
  `);
  return revisionValue(rows(review)[0]?.revision);
}

/**
 * PostgreSQL review repository.
 *
 * `withRunExecutionContext` takes the audit_run lock first. This repository then takes
 * run_result and run_result_review in that order before invoking the application callback.
 * `writeDecision` only updates the already locked review aggregate and appends its
 * immutable ledger row; no evaluation or Result write can bypass this serialization point.
 */
export class PostgresEvaluationReviewRepository implements EvaluationReviewRepository {
  constructor(private readonly db: Database) {}

  async transaction<T>(runId: string, work: (context: EvaluationReviewContext) => Promise<T>): Promise<T> {
    if (!isUuidText(runId)) throw new Error('Invalid Run identity');
    return this.db.transaction((tx) => withRunExecutionContext(tx, runId, async (shared) => {
      const reviewRevision = await lockedReviewRevision(tx, runId);
      const context: EvaluationReviewContext = {
        ...shared,
        authorizationRoles: new DrizzleRoleRepository(tx),
        reviewRevision,
        async sealPendingResult(result, expectedVersion) {
          // `run_result` is already locked before the review aggregate. The version and
          // pending predicates remain a second, database-level CAS so a future caller
          // cannot use this port to rewrite a sealed or already-sealed Result.
          const updated = await tx.execute(sql`
            UPDATE run_result
            SET version = ${result.version},
                outcome = ${result.outcome},
                outcome_row = ${result.row},
                sealed = ${result.sealed},
                run_state = ${result.runState},
                gate_passed = ${result.gatePassed},
                sealed_at = ${result.sealedAt}::timestamptz,
                scope = ${result.scope},
                publication = ${JSON.stringify(result.publication)}::jsonb
            WHERE run_id = ${runId}
              AND version = ${expectedVersion}
              AND sealed = false
              AND outcome = 'PENDING_CONFIRMATION'
            RETURNING run_id
          `);
          if (rows(updated).length !== 1) throw new Error('Result sealing compare-and-set failed');
        },
        async readReviewTarget(key) {
          if (!isUuidText(key.observationId) || key.conditionId.length === 0) return null;
          const result = await tx.execute(sql`
            SELECT
              e.run_id::text AS run_id,
              e.observation_id::text AS observation_id,
              e.condition_id,
              COALESCE(h.effective_origin, e.origin) AS origin,
              COALESCE(h.effective_value, e.value) AS value,
              CASE WHEN h.decision_id IS NULL THEN e.confirmation ELSE h.effective_confirmation END AS confirmation,
              e.confidence,
              e.rationale,
              e.evidence_ids
            FROM run_observation_evaluation e
            LEFT JOIN LATERAL (
              SELECT decision_id, effective_origin, effective_value, effective_confirmation
              FROM run_evaluation_review
              WHERE run_id = ${runId}
                AND observation_id = e.observation_id
                AND condition_id = e.condition_id
              ORDER BY review_revision DESC
              LIMIT 1
            ) h ON true
            WHERE e.run_id = ${runId}
              AND e.observation_id = ${key.observationId.toLowerCase()}
              AND e.condition_id = ${key.conditionId}
          `);
          return parseTarget(rows(result)[0] ?? {}, runId, key);
        },
        async readReviewDecisions(key) {
          if (!isUuidText(key.observationId) || key.conditionId.length === 0) return [];
          const result = await tx.execute(sql`
            SELECT
              decision_id::text AS decision_id,
              run_id::text AS run_id,
              observation_id::text AS observation_id,
              condition_id,
              review_revision,
              action,
              original_origin,
              original_value,
              original_confirmation,
              original_confidence,
              original_rationale,
              original_evidence_ids,
              effective_origin,
              effective_value,
              effective_confirmation,
              replacement_value,
              rejection_rationale,
              actor_id,
              decided_at
            FROM run_evaluation_review
            WHERE run_id = ${runId}
              AND observation_id = ${key.observationId.toLowerCase()}
              AND condition_id = ${key.conditionId}
            ORDER BY review_revision
          `);
          return rows(result).map((row) => {
            const decision = parseDecision(row, runId);
            if (decision === null) throw new Error('Evaluation review history shape invalid');
            return decision;
          });
        },
        async writeDecision(decision, expectedReviewRevision): Promise<WriteEvaluationDecisionResult> {
          if (
            decision.runId !== runId ||
            decision.reviewRevision !== expectedReviewRevision + 1 ||
            !isUuidText(decision.decisionId) ||
            !isUuidText(decision.observationId)
          ) throw new Error('Evaluation review identity invalid');

          const existing = await tx.execute(sql`
            SELECT decision_id
            FROM run_evaluation_review
            WHERE run_id = ${runId}
              AND observation_id = ${decision.observationId}
              AND condition_id = ${decision.conditionId}
            LIMIT 1
          `);
          if (rows(existing).length > 0) return { status: 'already-decided' };

          const advanced = await tx.execute(sql`
            UPDATE run_result_review
            SET revision = revision + 1
            WHERE run_id = ${runId} AND revision = ${expectedReviewRevision}
            RETURNING revision
          `);
          const nextRevision = revisionValue(rows(advanced)[0]?.revision);
          if (nextRevision === null) return { status: 'stale-revision' };
          if (nextRevision !== decision.reviewRevision) throw new Error('Evaluation review revision mismatch');

          await tx.execute(sql`
            INSERT INTO run_evaluation_review (
              decision_id, run_id, observation_id, condition_id, review_revision, action,
              original_origin, original_value, original_confirmation, original_confidence,
              original_rationale, original_evidence_ids, effective_origin, effective_value,
              effective_confirmation, replacement_value, rejection_rationale, actor_id, decided_at
            ) VALUES (
              ${decision.decisionId}, ${runId}, ${decision.observationId}, ${decision.conditionId},
              ${decision.reviewRevision}, ${decision.action}, ${decision.originalOrigin},
              ${decision.originalValue}, ${decision.originalConfirmation},
              ${decision.originalConfidence}::numeric, ${decision.originalRationale},
              ${JSON.stringify(decision.originalEvidenceIds)}::jsonb, ${decision.effectiveOrigin},
              ${decision.effectiveValue}, ${decision.effectiveConfirmation},
              ${decision.replacementValue}, ${decision.rejectionRationale}, ${decision.actorId},
              ${decision.decidedAt}::timestamptz
            )
          `);
          return { status: 'written', reviewRevision: nextRevision };
        },
      };
      return work(context);
    }));
  }
}
