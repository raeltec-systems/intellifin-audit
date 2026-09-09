import { and, eq, isNull, sql } from 'drizzle-orm';
import { PgBoss, fromDrizzle, type Db } from 'pg-boss';
import type { PlanDerivationJob, PlanDerivationQueue, PlanDelivery } from '@intellifin/application';
import { createDb, createSqlClient, type Database, type Transaction } from '../db/client.js';
import { queuePlanDerivation } from '@intellifin/application';
import { procedureVersion } from '../db/schema.js';
import { DrizzleProcedureWriter } from './procedure-repository.js';

export const PROCEDURES_QUEUE = 'procedures';

/** pg-boss error/output JSON is an object; postgres.js needs its JSON text parameter.
 * SQL arrays remain arrays (job-id ANY predicates); transaction ownership is unchanged. */
export function queueDatabase(connection: Database | Transaction): Db {
  const adapter = fromDrizzle(connection, sql);
  return { executeSql: (text, values) => adapter.executeSql(text, values?.map((value) =>
    typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype
      ? JSON.stringify(value) : value)) };
}

/** How often queue maintenance runs. pg-boss's own supervisor default, kept deliberately. */
export const QUEUE_MAINTENANCE_INTERVAL_MS = 60_000;

/** Runtime uses the existing TLS/connection policy and never installs a schema.
 *
 * `supervise: false` because pg-boss's built-in supervisor cannot run on this connection:
 * it issues a raw `BEGIN; SET LOCAL ...; SELECT pg_advisory_xact_lock(...)` block, and
 * postgres.js refuses a raw transaction on a POOLED client with `UNSAFE_TRANSACTION` --
 * a pooled checkout cannot promise the whole block lands on one connection. Left at its
 * default it threw every 60 seconds and archived nothing. `startQueueMaintenance` below is
 * where maintenance actually happens, on a connection where that block is legal. */
export function createProceduresQueue(db: Database): PgBoss {
  return new PgBoss({ db: queueDatabase(db), migrate: false, createSchema: false, schedule: false, supervise: false });
}

/** Archive completed jobs, prune stats partitions and reindex, on a connection of its own.
 *
 * A sweep with its own client and its own timer -- the shape `startProceduresRecovery`
 * below already uses -- rather than the constructor's supervisor, for two reasons. The
 * raw transaction block above needs `max: 1`, which the shared pool is not; and
 * maintenance can hold that connection for seconds (a reindex is DDL), which on the
 * shared pool would stall the job polling of every worker this process runs.
 *
 * ONE process-wide instance is enough and is what the worker starts: a single PgBoss
 * instance serves every queue here, so its maintenance covers all of them. Without it
 * `pgboss.job` grows without bound. */
export function startQueueMaintenance(databaseUrl: string, onError: (error: unknown) => void): () => Promise<void> {
  const sql = createSqlClient(databaseUrl, { max: 1 });
  const queue = new PgBoss({ db: queueDatabase(createDb(sql)), migrate: false, createSchema: false, schedule: false, supervise: false });
  let running = false;
  // `start()` resolves to the PgBoss instance, not void; the value is unused and the
  // promise is kept only so a restarted sweep does not start the instance twice.
  let started: Promise<unknown> | null = null;
  const sweep = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      started ??= queue.start();
      await started;
      await queue.supervise();
    } catch (error) {
      // A failed sweep is reported and retried on the next tick. It must never throw out
      // of the timer: an unhandled rejection here would take the worker down over
      // housekeeping, which is the opposite of what maintenance is for.
      onError(error);
    } finally {
      running = false;
    }
  };
  void sweep();
  const timer = setInterval(() => void sweep(), QUEUE_MAINTENANCE_INTERVAL_MS);
  timer.unref();
  return async () => {
    clearInterval(timer);
    await queue.stop().catch(() => undefined);
    await sql.end({ timeout: 5 }).catch(() => undefined);
  };
}

/** No start is needed for send. Both queue lookup and INSERT use this transaction. */
export function transactionDerivationQueue(transaction: Transaction): PlanDerivationQueue {
  const db = queueDatabase(transaction);
  const queue = new PgBoss({ db, migrate: false, createSchema: false, schedule: false, supervise: false });
  return {
    async hasLiveDelivery(job) {
      const result = await db.executeSql("SELECT 1 FROM pgboss.job WHERE name = $1 AND data->>'versionId' = $2 AND data->>'inputDigest' = $3 AND state IN ('created','retry','active') LIMIT 1", [PROCEDURES_QUEUE, job.versionId, job.inputDigest]);
      return result.rows.length > 0;
    },
    async enqueue(job) {
      const id = await queue.send(PROCEDURES_QUEUE, job, { db, retryLimit: 3, retryDelay: 5, expireInSeconds: 180 });
      if (id === null) throw new Error('Derivation job was not enqueued');
    },
  };
}

export async function startProceduresWorker(queue: PgBoss, handler: (job: PlanDerivationJob, delivery: PlanDelivery) => Promise<unknown>): Promise<void> {
  await queue.start();
  const options = { batchSize: 1, pollingIntervalSeconds: 1, includeMetadata: true } as const;
  await queue.work<PlanDerivationJob, unknown, typeof options>(PROCEDURES_QUEUE, options, async (jobs) => {
    for (const job of jobs) {
      const data: unknown = job.data;
      if (typeof data !== 'object' || data === null || !('schemaVersion' in data) || data.schemaVersion !== 1 ||
          !('versionId' in data) || typeof data.versionId !== 'string' || !/^[0-9a-f-]{36}$/.test(data.versionId) ||
          !('inputDigest' in data) || typeof data.inputDigest !== 'string' || !/^[0-9a-f]{64}$/.test(data.inputDigest)) {
        throw new Error('Invalid derivation job contract');
      }
      try {
        const result = await handler(job.data, { jobId: job.id, retriesRemaining: Math.max(0, job.retryLimit - job.retryCount) });
        if (typeof result === 'object' && result !== null && 'retry' in result && result.retry === true) throw new Error('Retryable plan derivation failure');
      } catch {
        // pg-boss persists thrown errors as job.output. Driver errors may contain SQL
        // parameters, so the telemetry allowlist alone cannot protect authored data.
        throw new Error('Plan derivation worker failed');
      }
    }
  });
}

/** Release/CI migrator only; processes must not call this. */
export async function migrateProceduresQueue(db: Database): Promise<void> {
  const queue = new PgBoss({ db: queueDatabase(db), migrate: true, createSchema: true, schedule: false, supervise: false });
  try {
    await queue.start();
    await queue.createQueue(PROCEDURES_QUEUE, { retryLimit: 3, retryDelay: 5, expireInSeconds: 180 });
    await enqueueExistingDraftPlans(db);
  } finally {
    await queue.stop();
  }
}

/** Upgrade existing Drafts once; row and job commit atomically and release reruns are safe. */
export async function enqueueExistingDraftPlans(db: Database): Promise<void> {
  const drafts = await db.select({ versionId: procedureVersion.versionId }).from(procedureVersion)
    .where(and(eq(procedureVersion.state, 'DRAFT'), isNull(procedureVersion.planInputDigest)));
  for (const draft of drafts) {
    await db.transaction(async (transaction) => {
      const writer = new DrizzleProcedureWriter(transaction);
      const row = await writer.findVersionForUpdate(draft.versionId);
      if (row === null || row.state !== 'DRAFT' || row.planInputDigest !== null) return;
      await writer.updateVersion(await queuePlanDerivation(row, transactionDerivationQueue(transaction)));
    });
  }
}

/** Reconcile terminal jobs and orphaned started attempts on startup and periodically.
 * Under the version lock the application rechecks live deliveries, preventing an old
 * terminal job from racing an authorized retry of the same digest. */
export async function reconcileProceduresQueue(db: Database, reconcile: (job: PlanDerivationJob) => Promise<void>, afterVersionId: string | null = null): Promise<string | null> {
  const adapter = queueDatabase(db);
  const result = await adapter.executeSql(`
    SELECT DISTINCT candidate.version_id, candidate.input_digest FROM (
      SELECT data->>'versionId' AS version_id, data->>'inputDigest' AS input_digest
      FROM pgboss.job WHERE name = $1 AND state IN ('failed','cancelled','completed')
      UNION
      SELECT v.version_id::text, a->>'inputDigest'
      FROM procedure_version v CROSS JOIN LATERAL jsonb_array_elements(v.plan_attempts) a
      LEFT JOIN pgboss.job j ON j.id::text = a->>'jobId' AND j.name = $1
      WHERE a->>'outcome' = 'started' AND (j.id IS NULL OR j.state IN ('failed','cancelled','completed'))
    ) candidate
    JOIN procedure_version relevant ON relevant.version_id::text = candidate.version_id
    WHERE ((relevant.plan_status = 'pending' AND relevant.plan_input_digest = candidate.input_digest) OR EXISTS (SELECT 1 FROM jsonb_array_elements(relevant.plan_attempts) a WHERE a->>'outcome' = 'started' AND a->>'inputDigest' = candidate.input_digest))
      AND candidate.version_id ~ '^[0-9a-f-]{36}$' AND candidate.input_digest ~ '^[0-9a-f]{64}$'
      AND NOT EXISTS (SELECT 1 FROM pgboss.job live WHERE live.name = $1
        AND live.data->>'versionId' = candidate.version_id AND live.data->>'inputDigest' = candidate.input_digest
        AND live.state IN ('created','retry','active'))
    ORDER BY candidate.version_id, candidate.input_digest LIMIT 100`, [PROCEDURES_QUEUE]);
  for (const row of result.rows as { version_id: string; input_digest: string }[]) {
    await reconcile({ schemaVersion: 1, versionId: row.version_id, inputDigest: row.input_digest });
  }
  // Rolling deployment: an old producer may alter a plan that already succeeded.
  // Walk every Draft by keyset, independently of queue history/status. Restarting
  // starts a fresh sweep; successful ticks advance rather than rescanning page one.
  const drafts = await adapter.executeSql("SELECT version_id::text, plan_input_digest AS input_digest FROM procedure_version WHERE state = 'DRAFT' AND ($1::uuid IS NULL OR version_id > $1::uuid) ORDER BY version_id LIMIT 100", [afterVersionId]);
  const page = drafts.rows as { version_id: string; input_digest: string | null }[];
  for (const row of page) await reconcile({ schemaVersion: 1, versionId: row.version_id, inputDigest: row.input_digest ?? '0'.repeat(64) });
  return page.length === 100 ? page[page.length - 1]!.version_id : null;
}

export async function startProceduresRecovery(db: Database, reconcile: (job: PlanDerivationJob) => Promise<void>, onError: () => void): Promise<() => void> {
  let cursor = await reconcileProceduresQueue(db, reconcile);
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void reconcileProceduresQueue(db, reconcile, cursor).then((next) => { cursor = next; }).catch(onError).finally(() => { running = false; });
  }, 15_000);
  timer.unref();
  return () => clearInterval(timer);
}
