import { PgBoss } from 'pg-boss';

import {
  parseEvaluationReviewJob,
  type EvaluationReviewJob,
} from '@intellifin/application';

import type { Database, Transaction } from '../db/client.js';
import { queueDatabase } from '../procedures/derivation-queue.js';
import { EVALUATION_REVIEW_QUEUE } from './runs-unit-of-work.js';

/** A job handler receives only the validated queue envelope; it reads the command row. */
export type EvaluationReviewJobHandler = (job: EvaluationReviewJob) => Promise<unknown>;

/**
 * Consume review envelopes from the dedicated review queue. It is provisioned alongside
 * the existing `runs` queue, but has a separate pg-boss name so a population consumer can
 * never acknowledge a review command or silently discard it as an unrelated job.
 */
export async function startEvaluationReviewWorker(
  queue: PgBoss,
  handler: EvaluationReviewJobHandler,
): Promise<void> {
  await queue.work<unknown>(EVALUATION_REVIEW_QUEUE, { batchSize: 1, pollingIntervalSeconds: 1 }, async jobs => {
    for (const job of jobs) {
      const value: unknown = job.data;
      const parsed = parseEvaluationReviewJob(value);
      if (parsed === null) throw new Error('Invalid evaluation review job contract');
      try {
        await handler(parsed);
      } catch {
        // Queue output is persisted by pg-boss. Keep SQL/rationale out of it and leave
        // the command row PENDING so a redelivery can retry the whole transaction.
        throw new Error('Evaluation review worker failed');
      }
    }
  });
}

/** Release/recovery path: resend pending commands that have no live pg-boss delivery. */
export async function requeuePendingEvaluationReviews(
  db: Database,
  limit = 100,
): Promise<number> {
  const adapter = queueDatabase(db);
  const candidateResult = await adapter.executeSql(`
    SELECT c.command_id::text
    FROM run_evaluation_review_command c
    WHERE c.status = 'PENDING'
      AND NOT EXISTS (
        SELECT 1 FROM pgboss.job j
        WHERE j.name = $1
          AND j.state IN ('created', 'retry', 'active')
          AND j.data->>'kind' = 'evaluation-review'
          AND j.data->>'commandId' = c.command_id::text
      )
    ORDER BY c.requested_at, c.command_id
    LIMIT $2
  `, [EVALUATION_REVIEW_QUEUE, Math.max(1, Math.min(100, limit))]);
  const candidates = candidateResult.rows as { command_id: string }[];
  let resent = 0;
  for (const candidate of candidates) {
    await db.transaction(async (tx: Transaction) => {
      const txAdapter = queueDatabase(tx);
      const lockedResult = await txAdapter.executeSql(`
        SELECT command_id::text, run_id::text, correlation_id::text
        FROM run_evaluation_review_command
        WHERE command_id = $1 AND status = 'PENDING'
        FOR UPDATE
      `, [candidate.command_id]);
      const locked = lockedResult.rows as { command_id: string; run_id: string; correlation_id: string }[];
      const row = locked[0];
      if (!row) return;
      const liveResult = await txAdapter.executeSql(`
        SELECT id::text AS job_id
        FROM pgboss.job
        WHERE name = $1
          AND state IN ('created', 'retry', 'active')
          AND data->>'kind' = 'evaluation-review'
          AND data->>'commandId' = $2
        LIMIT 1
      `, [EVALUATION_REVIEW_QUEUE, row.command_id]);
      const live = liveResult.rows as { job_id: string }[];
      if (live.length > 0) return;
      const queue = new PgBoss({ db: queueDatabase(tx), migrate: false, createSchema: false, schedule: false, supervise: false });
      const jobId = await queue.send(EVALUATION_REVIEW_QUEUE, {
        schemaVersion: 1,
        kind: 'evaluation-review',
        commandId: row.command_id,
        runId: row.run_id,
        correlationId: row.correlation_id,
      }, { db: queueDatabase(tx), retryLimit: 3, retryDelay: 5, expireInSeconds: 180 });
      if (jobId === null) throw new Error('Evaluation review recovery dispatch failed');
      resent += 1;
    });
  }
  return resent;
}

/**
 * Reconcile pending review commands after a worker restart. The sweep deliberately has
 * one in-flight pass at a time and drains that pass before shutdown, so a slow database
 * connection cannot create overlapping queue deliveries or keep the process alive.
 */
export function startEvaluationReviewRecovery(
  db: Database,
  onError: () => void,
  intervalMs = 5_000,
): () => Promise<void> {
  let pending: Promise<void> | undefined;
  let stopping = false;
  const tick = (): void => {
    if (stopping || pending !== undefined) return;
    pending = requeuePendingEvaluationReviews(db)
      .then(() => undefined)
      .catch(onError)
      .finally(() => { pending = undefined; });
  };
  const timer = setInterval(tick, Math.max(1_000, intervalMs));
  timer.unref();
  tick();
  return async (): Promise<void> => {
    stopping = true;
    clearInterval(timer);
    await pending;
  };
}
