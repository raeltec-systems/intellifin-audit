import { PgBoss } from 'pg-boss';

import {
  EVIDENCE_READ_GRANT_QUEUE,
  issueEvidenceReadGrant,
  parseEvidenceReadGrantJob,
  type Clock,
  type EvidenceReadGrantRepository,
  type EvidenceReadGrantSigner,
} from '@intellifin/application';

import type { Database, Transaction } from '../db/client.js';
import { queueDatabase } from '../procedures/derivation-queue.js';

/**
 * Consume the dedicated Evidence read queue. A delivery contains only a grant id;
 * the worker transaction obtains the registered object metadata and role again before
 * asking the S3 adapter to mint a capability. A `null` signer is an explicit
 * storage-unavailable refusal, so a deployment without object storage does not leave
 * pending requests stranded in the queue.
 */
export async function startEvidenceReadGrantWorker(
  queue: PgBoss,
  repository: EvidenceReadGrantRepository,
  signer: EvidenceReadGrantSigner | null,
  clock: Clock,
): Promise<void> {
  await queue.work<unknown>(EVIDENCE_READ_GRANT_QUEUE, { batchSize: 1, pollingIntervalSeconds: 1 }, async jobs => {
    for (const queued of jobs) {
      const job = parseEvidenceReadGrantJob(queued.data);
      if (job === null) throw new Error('Invalid Evidence read grant job contract');
      try {
        await issueEvidenceReadGrant({ repository, signer, clock }, job);
      } catch {
        // pg-boss persists thrown output. Keep signer/database details, object keys and
        // any future provider error out of that output so a retry remains the only effect.
        throw new Error('Evidence read grant worker failed');
      }
    }
  });
}

/**
 * Re-enqueue pending grants that have no live delivery. This is the restart/crash seam:
 * the row lock and the live-job check share one transaction, so two workers cannot create
 * duplicate deliveries for the same pending request.
 */
export async function requeuePendingEvidenceReadGrants(
  db: Database,
  limit = 100,
): Promise<number> {
  const adapter = queueDatabase(db);
  const boundedLimit = Math.max(1, Math.min(100, Number.isSafeInteger(limit) ? limit : 100));
  const candidatesResult = await adapter.executeSql(`
    SELECT g.grant_id::text
    FROM evidence_read_grant g
    WHERE g.status = 'pending'
      AND NOT EXISTS (
        SELECT 1
        FROM pgboss.job j
        WHERE j.name = $1
          AND j.state IN ('created', 'retry', 'active')
          AND j.data->>'grantId' = g.grant_id::text
      )
    ORDER BY g.requested_at, g.grant_id
    LIMIT $2
  `, [EVIDENCE_READ_GRANT_QUEUE, boundedLimit]);
  const candidates = candidatesResult.rows as { grant_id: string }[];
  let resent = 0;
  for (const candidate of candidates) {
    await db.transaction(async (tx: Transaction) => {
      const txAdapter = queueDatabase(tx);
      const lockedResult = await txAdapter.executeSql(`
        SELECT grant_id::text
        FROM evidence_read_grant
        WHERE grant_id = $1 AND status = 'pending'
        FOR UPDATE
      `, [candidate.grant_id]);
      const locked = lockedResult.rows as { grant_id: string }[];
      const row = locked[0];
      if (row === undefined) return;
      const liveResult = await txAdapter.executeSql(`
        SELECT id::text AS job_id
        FROM pgboss.job j
        WHERE name = $1
          AND state IN ('created', 'retry', 'active')
          AND j.data->>'grantId' = $2
        LIMIT 1
      `, [EVIDENCE_READ_GRANT_QUEUE, row.grant_id]);
      const live = liveResult.rows as { job_id: string }[];
      if (live.length > 0) return;
      const queue = new PgBoss({
        db: queueDatabase(tx),
        migrate: false,
        createSchema: false,
        schedule: false,
        supervise: false,
      });
      const jobId = await queue.send(EVIDENCE_READ_GRANT_QUEUE, {
        schemaVersion: 1,
        grantId: row.grant_id,
      }, { db: queueDatabase(tx), retryLimit: 3, retryDelay: 5, expireInSeconds: 180 });
      if (jobId === null) throw new Error('Evidence read grant recovery dispatch failed');
      resent += 1;
    });
  }
  return resent;
}

/** Reconcile orphaned pending grants after a worker restart. */
export function startEvidenceReadGrantRecovery(
  db: Database,
  onError: () => void,
  intervalMs = 5_000,
): () => Promise<void> {
  let pending: Promise<void> | undefined;
  let stopping = false;
  const tick = (): void => {
    if (stopping || pending !== undefined) return;
    pending = requeuePendingEvidenceReadGrants(db)
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
