import { sql } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';

import { EVALUATION_REVIEW_DISPATCH_REFUSALS } from '@intellifin/application';

import type {
  EvaluationReviewCommand,
  EvaluationReviewCommandCompletion,
  EvaluationReviewCommandContext,
  EvaluationReviewCommandRepository,
  EvaluationReviewCommandReceipt,
  EvaluationReviewCommandStatus,
  EvaluationReviewContext,
  EvaluationReviewDecision,
  EvaluationReviewRepository,
  EvaluationReviewTarget,
  EvaluationReviewTargetKey,
  ExceptionFingerprinter,
  AdapterExecutionContext,
  WriteEvaluationDecisionResult,
} from '@intellifin/application';
import { exceptionIdFor, type EvaluationConfirmation, type EvaluationOrigin, type EvaluationValue, type ExceptionFingerprintEnvelope } from '@intellifin/domain';

import type { Database, Transaction } from '../db/client.js';
import { isUuidText } from '../db/identifier.js';
import { DrizzleRoleRepository } from '../identity/role-repository.js';
import { DrizzleFrozenExecutionReader } from '../procedures/procedure-repository.js';
import { withRunExecutionContext } from './adapter-execution-repository.js';
import { EVALUATION_REVIEW_QUEUE } from './runs-unit-of-work.js';
import { queueDatabase } from '../procedures/derivation-queue.js';

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

export async function lockedReviewRevision(tx: Transaction, runId: string): Promise<number | null> {
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

export interface EvaluationReviewRepositoryOptions {
  /** Worker-only closure. It is never serialized or exposed to application/web callers. */
  readonly exceptions?: ExceptionFingerprinter;
}

/**
 * Materialize the Exception created by a human replacement of an evaluation.
 *
 * The row is derived from the effective evaluations in the locked transaction, then
 * signed through the worker-owned closure. This keeps the exact condition set honest when
 * a review changes one condition and avoids precomputing a non-composable HMAC.
 */
async function ensureException(
  tx: Transaction,
  runId: string,
  observationId: string,
  raisedAt: string,
  fingerprinter: ExceptionFingerprinter,
): Promise<void> {
  const existing = await tx.execute(sql`
    SELECT exception_id
    FROM run_exception
    WHERE observation_id = ${observationId}
    LIMIT 1
  `);
  if (rows(existing).length > 0) return;

  const observation = await tx.execute(sql`
    SELECT work_item_id::text AS work_item_id, target_system, population_record_key
    FROM run_observation
    WHERE run_id = ${runId} AND observation_id = ${observationId}
    FOR SHARE
  `);
  const observationRow = rows(observation)[0];
  const workItemId = requiredText(observationRow ?? {}, 'work_item_id')?.toLowerCase() ?? null;
  const targetSystem = requiredText(observationRow ?? {}, 'target_system');
  const populationRecordKey = requiredText(observationRow ?? {}, 'population_record_key');
  if (workItemId === null || targetSystem === null || populationRecordKey === null || !isUuidText(workItemId)) {
    throw new Error('Evaluation review Exception observation is unavailable');
  }

  const evaluations = await tx.execute(sql`
    SELECT
      e.condition_id,
      e.diagnostic,
      COALESCE(h.effective_value, e.value) AS effective_value
    FROM run_observation_evaluation e
    LEFT JOIN LATERAL (
      SELECT effective_value
      FROM run_evaluation_review
      WHERE run_id = ${runId}
        AND observation_id = e.observation_id
        AND condition_id = e.condition_id
      ORDER BY review_revision DESC
      LIMIT 1
    ) h ON true
    WHERE e.run_id = ${runId} AND e.observation_id = ${observationId}
  `);
  const exceptions = rows(evaluations).filter((row) => row.effective_value === 'EXCEPTION');
  if (exceptions.length === 0) throw new Error('Evaluation review Exception has no effective Exception condition');

  // `condition_ids` is the frozen compliance-condition order, not database or review
  // insertion order. The plan is read from the same Run version that is already locked.
  const run = await tx.execute(sql`
    SELECT version_id::text AS version_id, procedure_id::text AS procedure_id
    FROM audit_run
    WHERE run_id = ${runId}
  `);
  const runRow = rows(run)[0];
  const versionId = requiredText(runRow ?? {}, 'version_id');
  const procedureId = requiredText(runRow ?? {}, 'procedure_id');
  if (versionId === null || procedureId === null || !isUuidText(versionId) || !isUuidText(procedureId)) {
    throw new Error('Evaluation review Exception plan identity is unavailable');
  }
  const plan = await new DrizzleFrozenExecutionReader(tx).readFrozenExecution(versionId, procedureId);
  if (plan === null) throw new Error('Evaluation review Exception frozen plan is unavailable');
  const order = new Map(plan.inputs.complianceConditions.map((condition, index) => [condition.conditionId, index]));
  const orderedExceptions = exceptions
    .map((row) => ({ conditionId: requiredText(row, 'condition_id'), diagnostic: textValue(row.diagnostic) }))
    .filter((entry): entry is { conditionId: string; diagnostic: string | null } => entry.conditionId !== null);
  if (orderedExceptions.length !== exceptions.length || orderedExceptions.some((entry) => !order.has(entry.conditionId))) {
    throw new Error('Evaluation review Exception condition is outside the frozen plan');
  }
  orderedExceptions.sort((left, right) =>
    (order.get(left.conditionId) ?? Number.MAX_SAFE_INTEGER) -
    (order.get(right.conditionId) ?? Number.MAX_SAFE_INTEGER));
  const conditionIds = orderedExceptions.map((entry) => entry.conditionId);
  const diagnostics = orderedExceptions
    .map((entry) => entry.diagnostic)
    .filter((diagnostic): diagnostic is string => diagnostic !== null);
  const envelope: ExceptionFingerprintEnvelope = {
    procedureId,
    templateId: plan.inputs.templateId,
    targetSystem,
    populationRecordKey,
    conditionIds,
  };
  const fingerprint = fingerprinter.fingerprint(envelope);
  if (!/^[0-9a-f]{64}$/.test(fingerprint)) throw new Error('Evaluation review Exception fingerprint is invalid');

  await tx.execute(sql`
    INSERT INTO run_exception (
      exception_id, run_id, observation_id, work_item_id, target_system,
      population_record_key, condition_ids, diagnostics, fingerprint,
      fingerprint_key_id, raised_at
    ) VALUES (
      ${exceptionIdFor(runId, observationId)}, ${runId}, ${observationId}, ${workItemId},
      ${targetSystem}, ${populationRecordKey}, ${JSON.stringify(conditionIds)}::jsonb,
      ${JSON.stringify(diagnostics)}::jsonb, ${fingerprint}, ${fingerprinter.keyId},
      ${raisedAt}::timestamptz
    )
    ON CONFLICT (observation_id) DO NOTHING
  `);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONDITION_ID = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,254}$/;

function commandValue(value: unknown): EvaluationValue | null {
  return value === 'COMPLIANT' || value === 'EXCEPTION' || value === 'UNEVALUATED' ? value : null;
}

function commandAction(value: unknown): 'confirm' | 'reject' | null {
  return value === 'confirm' || value === 'reject' ? value : null;
}

function commandDate(value: unknown): string | null {
  return dateValue(value);
}

function parseCommand(row: RawRow): EvaluationReviewCommand | null {
  const commandId = requiredText(row, 'command_id')?.toLowerCase() ?? null;
  const runId = requiredText(row, 'run_id')?.toLowerCase() ?? null;
  const observationId = requiredText(row, 'observation_id')?.toLowerCase() ?? null;
  const conditionId = requiredText(row, 'condition_id');
  const expectedReviewRevision = revisionValue(row.expected_review_revision);
  const action = commandAction(row.action);
  const replacementValue = row.replacement_value === null || row.replacement_value === undefined
    ? null
    : commandValue(row.replacement_value);
  const rationale = row.rationale === null || row.rationale === undefined ? null : textValue(row.rationale);
  const actorId = requiredText(row, 'actor_id');
  const sessionId = requiredText(row, 'session_id');
  const correlationId = requiredText(row, 'correlation_id')?.toLowerCase() ?? null;
  const requestedAt = commandDate(row.requested_at);
  if (
    commandId === null || !UUID.test(commandId) || runId === null || !UUID.test(runId) ||
    observationId === null || !UUID.test(observationId) || conditionId === null || !CONDITION_ID.test(conditionId) ||
    expectedReviewRevision === null || action === null || actorId === null || actorId.length > 255 ||
    sessionId === null || sessionId.length > 255 || correlationId === null || !UUID.test(correlationId) ||
    requestedAt === null ||
    (action === 'confirm' && (replacementValue !== null || rationale !== null)) ||
    (action === 'reject' && (replacementValue === null || rationale === null || rationale.trim().length === 0 || rationale.length > 4000))
  ) return null;
  return {
    schemaVersion: 1,
    commandId,
    runId,
    observationId,
    conditionId,
    expectedReviewRevision,
    action,
    replacementValue,
    rationale,
    actorId,
    sessionId,
    correlationId,
    requestedAt,
  };
}

function validateCommand(command: EvaluationReviewCommand): void {
  if (
    command.schemaVersion !== 1 || !UUID.test(command.commandId) || !UUID.test(command.runId) ||
    !UUID.test(command.observationId) || !CONDITION_ID.test(command.conditionId) ||
    !Number.isSafeInteger(command.expectedReviewRevision) || command.expectedReviewRevision < 0 ||
    commandAction(command.action) === null || command.actorId.trim().length === 0 || command.actorId.length > 255 ||
    command.sessionId.trim().length === 0 || command.sessionId.length > 255 || !UUID.test(command.correlationId) ||
    command.requestedAt.length === 0 ||
    (command.action === 'confirm' && (command.replacementValue !== null || command.rationale !== null)) ||
    (command.action === 'reject' && (command.replacementValue === null || command.rationale === null || command.rationale.trim().length === 0 || command.rationale.length > 4000))
  ) throw new Error('Evaluation review command shape invalid');
}

async function completeCommand(
  tx: Transaction,
  commandId: string,
  completion: EvaluationReviewCommandCompletion,
): Promise<void> {
  const updated = completion.status === 'SUCCEEDED'
    ? await tx.execute(sql`
        UPDATE run_evaluation_review_command
        SET status = 'SUCCEEDED', decision_id = ${completion.decisionId},
            review_revision = ${completion.reviewRevision}, result_version = ${completion.resultVersion},
            result_outcome = ${completion.resultOutcome}, result_sealed = ${completion.resultSealed},
            processed_at = now()
        WHERE command_id = ${commandId} AND status = 'PENDING'
        RETURNING command_id
      `)
    : await tx.execute(sql`
        UPDATE run_evaluation_review_command
        SET status = 'REFUSED', refusal_code = ${completion.refusalCode}, processed_at = now()
        WHERE command_id = ${commandId} AND status = 'PENDING'
        RETURNING command_id
      `);
  if (rows(updated).length !== 1) throw new Error('Evaluation review command completion compare-and-set failed');
}

const REVIEW_REFUSAL_CODES: ReadonlySet<string> = new Set([
  'malformed',
  'unauthorized',
  'unknown',
  'not-completed',
  'sealed',
  'not-pending',
  'stale-revision',
  'rationale-required',
  'invalid-replacement',
]);

function parseCommandStatus(row: RawRow): EvaluationReviewCommandStatus | null {
  const commandId = requiredText(row, 'command_id')?.toLowerCase() ?? null;
  const observationId = requiredText(row, 'observation_id')?.toLowerCase() ?? null;
  const conditionId = requiredText(row, 'condition_id');
  const expectedReviewRevision = revisionValue(row.expected_review_revision);
  const action = reviewAction(row.action);
  const status = row.status === 'PENDING' || row.status === 'SUCCEEDED' || row.status === 'REFUSED'
    ? row.status
    : null;
  const requestedAt = dateValue(row.requested_at);
  const processedAt = row.processed_at === null || row.processed_at === undefined
    ? null
    : dateValue(row.processed_at);
  const rawRefusal = row.refusal_code === null || row.refusal_code === undefined
    ? null
    : requiredText(row, 'refusal_code');
  const refusalCode = status === 'REFUSED'
    ? rawRefusal !== null && REVIEW_REFUSAL_CODES.has(rawRefusal)
      ? rawRefusal as EvaluationReviewCommandStatus['refusalCode']
      : 'unknown' as const
    : null;
  if (
    commandId === null || !isUuidText(commandId) || observationId === null || !isUuidText(observationId) ||
    conditionId === null || !CONDITION_ID.test(conditionId) || expectedReviewRevision === null || action === null ||
    status === null || requestedAt === null || (status !== 'PENDING' && processedAt === null) ||
    (status === 'PENDING' && (processedAt !== null || rawRefusal !== null))
  ) return null;
  return {
    commandId,
    observationId,
    conditionId,
    action,
    expectedReviewRevision,
    status,
    refusalCode,
    requestedAt,
    processedAt,
  };
}

/**
 * PostgreSQL review repository.
 *
 * `withRunExecutionContext` takes the audit_run lock first. This repository then takes
 * run_result and run_result_review in that order before invoking the application callback.
 * `writeDecision` only updates the already locked review aggregate and appends its
 * immutable ledger row; no evaluation or Result write can bypass this serialization point.
 */
async function createEvaluationReviewContext(
  tx: Transaction,
  runId: string,
  shared: AdapterExecutionContext,
  reviewRevision: number | null,
  options: EvaluationReviewRepositoryOptions,
): Promise<EvaluationReviewContext> {
const context: EvaluationReviewContext = {
  ...shared,
  authorizationRoles: new DrizzleRoleRepository(tx),
  reviewRevision,
  ensureException: options.exceptions === undefined
    ? async () => { throw new Error('Evaluation review worker signer unavailable'); }
    : (observationId, raisedAt) => ensureException(tx, runId, observationId, raisedAt, options.exceptions!),
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
  return context;
}

export class PostgresEvaluationReviewRepository implements EvaluationReviewCommandRepository {
  constructor(
    private readonly db: Database,
    private readonly options: EvaluationReviewRepositoryOptions = {},
  ) {}

  /**
   * Read only the current revision's safe command projection. The web needs this to
   * distinguish a queued review from a worker refusal after a refresh; authored rationale
   * and actor/session fields remain inside the command table and never cross this boundary.
   */
  async readCommandStatuses(
    runId: string,
    expectedReviewRevision: number,
    observationIds: readonly string[],
  ): Promise<readonly EvaluationReviewCommandStatus[]> {
    const ids = observationIds.filter(isUuidText).slice(0, 50);
    if (!isUuidText(runId) || !Number.isSafeInteger(expectedReviewRevision) || expectedReviewRevision < 0 || ids.length === 0) return [];
    const idList = sql.join(ids.map((id) => sql`${id}`), sql`, `);
    const result = await this.db.execute(sql`
      SELECT DISTINCT ON (observation_id, condition_id)
             command_id::text AS command_id, observation_id::text AS observation_id,
             condition_id, expected_review_revision, action, status, refusal_code,
             requested_at, processed_at
      FROM run_evaluation_review_command
      WHERE run_id = ${runId}
        AND expected_review_revision = ${expectedReviewRevision}
        AND observation_id IN (${idList})
      ORDER BY observation_id, condition_id, (status = 'PENDING') DESC, requested_at DESC, command_id DESC
    `);
    // Terminal retries are retained for auditability. The surface needs the newest
    // command for each target/revision, while DISTINCT ON and the SQL order keep the
    // result bounded to one row per visible target without exposing old refusals as the
    // current state.
    const latest = new Map<string, EvaluationReviewCommandStatus>();
    for (const row of rows(result)) {
      const status = parseCommandStatus(row);
      if (status === null) continue;
      const key = `${status.observationId}:${status.conditionId}`;
      if (!latest.has(key)) latest.set(key, status);
    }
    return [...latest.values()];
  }

  async transaction<T>(runId: string, work: (context: EvaluationReviewContext) => Promise<T>): Promise<T> {
    if (!isUuidText(runId)) throw new Error('Invalid Run identity');
    return this.db.transaction((tx) => withRunExecutionContext(tx, runId, async (shared) => {
      const reviewRevision = await lockedReviewRevision(tx, runId);
      const context = await createEvaluationReviewContext(tx, runId, shared, reviewRevision, this.options);
      return work(context);
    }));
  }

  async transactionCommand<T>(
    commandId: string,
    work: (command: EvaluationReviewCommand, context: EvaluationReviewCommandContext) => Promise<T>,
  ): Promise<T | null> {
    if (!isUuidText(commandId)) throw new Error('Invalid review command identity');
    return this.db.transaction(async (tx) => {
      const commandResult = await tx.execute(sql`
        SELECT command_id::text AS command_id, run_id::text AS run_id, observation_id::text AS observation_id,
               condition_id, expected_review_revision, action, replacement_value, rationale,
               actor_id, session_id, correlation_id, requested_at, status
        FROM run_evaluation_review_command
        WHERE command_id = ${commandId}
        FOR UPDATE
      `);
      const commandRow = rows(commandResult)[0];
      if (!commandRow || commandRow.status !== 'PENDING') return null;
      const command = parseCommand(commandRow);
      if (command === null) throw new Error('Evaluation review command shape invalid');
      // A worker command must always be composed with the worker-only HMAC closure. A
      // missing key leaves the command PENDING for retry/recovery and, crucially, prevents
      // a review or Result seal from committing without its Exception capability.
      if (this.options.exceptions === undefined) throw new Error('Evaluation review worker signer unavailable');
      return withRunExecutionContext(tx, command.runId, async (shared) => {
        const reviewRevision = await lockedReviewRevision(tx, command.runId);
        const base = await createEvaluationReviewContext(tx, command.runId, shared, reviewRevision, this.options);
        const context: EvaluationReviewCommandContext = {
          ...base,
          async completeCommand(completion: EvaluationReviewCommandCompletion) {
            await completeCommand(tx, command.commandId, completion);
          },
        };
        return work(command, context);
      });
    });
  }

  async enqueue(command: EvaluationReviewCommand): Promise<EvaluationReviewCommandReceipt> {
    validateCommand(command);
    return this.db.transaction(async (tx) => {
      const existing = await tx.execute(sql`
        SELECT command_id::text AS command_id, status, action, replacement_value, rationale, actor_id, session_id
        FROM run_evaluation_review_command
        WHERE run_id = ${command.runId}
          AND observation_id = ${command.observationId}
          AND condition_id = ${command.conditionId}
          AND expected_review_revision = ${command.expectedReviewRevision}
          AND status = 'PENDING'
        FOR UPDATE
      `);
      const existingRow = rows(existing)[0];
      if (existingRow) {
        const existingId = requiredText(existingRow, 'command_id');
        if (!existingId || !isUuidText(existingId)) throw new Error('Evaluation review command identity invalid');
        const sameRequest =
          existingRow.action === command.action &&
          (existingRow.replacement_value ?? null) === command.replacementValue &&
          (existingRow.rationale ?? null) === command.rationale &&
          existingRow.actor_id === command.actorId &&
          existingRow.session_id === command.sessionId;
        if (!sameRequest) {
          return {
            commandId: existingId,
            status: 'conflict' as const,
            reason: EVALUATION_REVIEW_DISPATCH_REFUSALS.conflict,
          };
        }
        return { commandId: existingId, status: 'accepted' as const };
      }
      const inserted = await tx.execute(sql`
        INSERT INTO run_evaluation_review_command (
          command_id, run_id, observation_id, condition_id, expected_review_revision, action,
          replacement_value, rationale, actor_id, session_id, correlation_id, requested_at, status
        ) VALUES (
          ${command.commandId}, ${command.runId}, ${command.observationId}, ${command.conditionId},
          ${command.expectedReviewRevision}, ${command.action}, ${command.replacementValue},
          ${command.rationale}, ${command.actorId}, ${command.sessionId}, ${command.correlationId},
          ${command.requestedAt}::timestamptz, 'PENDING'
        )
        ON CONFLICT (run_id, observation_id, condition_id, expected_review_revision)
          WHERE status = 'PENDING'
        DO NOTHING
        RETURNING command_id
      `);
      if (rows(inserted).length === 0) {
        // Two first submissions can both observe no row under READ COMMITTED. The
        // partial-index conflict is a truthful target conflict; re-read the winner
        // instead of turning the browser response into an unknown-outcome error.
        const winnerResult = await tx.execute(sql`
          SELECT command_id::text AS command_id, action, replacement_value, rationale, actor_id, session_id
          FROM run_evaluation_review_command
          WHERE run_id = ${command.runId}
            AND observation_id = ${command.observationId}
            AND condition_id = ${command.conditionId}
            AND expected_review_revision = ${command.expectedReviewRevision}
            AND status = 'PENDING'
          FOR UPDATE
        `);
        const winner = rows(winnerResult)[0];
        const winnerId = requiredText(winner ?? {}, 'command_id');
        if (!winnerId || !isUuidText(winnerId)) throw new Error('Evaluation review command conflict winner unavailable');
        const sameRequest =
          winner?.action === command.action &&
          (winner.replacement_value ?? null) === command.replacementValue &&
          (winner.rationale ?? null) === command.rationale &&
          winner.actor_id === command.actorId &&
          winner.session_id === command.sessionId;
        if (!sameRequest) {
          return {
            commandId: winnerId,
            status: 'conflict' as const,
            reason: EVALUATION_REVIEW_DISPATCH_REFUSALS.conflict,
          };
        }
        return { commandId: winnerId, status: 'accepted' as const };
      }
      const queue = new PgBoss({ db: queueDatabase(tx), migrate: false, createSchema: false, schedule: false, supervise: false });
      const jobId = await queue.send(EVALUATION_REVIEW_QUEUE, {
        schemaVersion: 1,
        kind: 'evaluation-review',
        commandId: command.commandId,
        runId: command.runId,
        correlationId: command.correlationId,
      }, { db: queueDatabase(tx), retryLimit: 3, retryDelay: 5, expireInSeconds: 180 });
      if (jobId === null) throw new Error('Evaluation review command was not enqueued');
      return { commandId: command.commandId, status: 'accepted' as const };
    });
  }
}
