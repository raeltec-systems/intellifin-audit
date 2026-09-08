import { eq, sql } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import type { AuditUnitOfWork, RunCancellationContext, RunCancellationRepository, RunsUnitOfWorkContext } from '@intellifin/application';
import { EVIDENCE_READ_GRANT_QUEUE } from '@intellifin/application';
import { CryptoUuidV7Generator, SystemClock, createAuditEventWriter, type PostgresAuditDependencies } from '../db/audit-events.js';
import type { Database } from '../db/client.js';
import { isUuidText } from '../db/identifier.js';
import { auditRun } from '../db/schema.js';
import { DrizzleRoleRepository } from '../identity/role-repository.js';
import { DrizzleFrozenExecutionReader, DrizzleProcedurePeriodOwnerReader } from '../procedures/procedure-repository.js';
import { queueDatabase } from '../procedures/derivation-queue.js';
import { evidencePackageContext } from './evidence-package-repository.js';
import { runResultContext } from './result-repository.js';
import { DrizzleRunRepository } from './run-repository.js';
export const RUNS_QUEUE = 'runs';
/** Human review commands use a separate consumer while sharing the pg-boss database. */
export const EVALUATION_REVIEW_QUEUE = 'evaluation-reviews';
export class PostgresRunsUnitOfWork implements AuditUnitOfWork<RunsUnitOfWorkContext> {
  constructor(private readonly db: Database, private readonly dependencies: PostgresAuditDependencies = {}) {}
  execute<T>(work: (context: RunsUnitOfWorkContext) => Promise<T>): Promise<T> {
    return this.db.transaction(async transaction => {
      await transaction.execute(sql`SELECT pg_advisory_xact_lock(20428, 1)`);
      const db = queueDatabase(transaction);
      const queue = new PgBoss({ db, migrate: false, createSchema: false, schedule: false, supervise: false });
      return work({
        authorizationRoles: new DrizzleRoleRepository(transaction), procedures: new DrizzleProcedurePeriodOwnerReader(transaction), runs: new DrizzleRunRepository(transaction),
        auditEvents: createAuditEventWriter(transaction, this.dependencies.clock ?? new SystemClock(), this.dependencies.ids ?? new CryptoUuidV7Generator()),
        dispatch: { async enqueue(job) { if (await queue.send(RUNS_QUEUE, job, { db, retryLimit: 3, retryDelay: 5, expireInSeconds: 180 }) === null) throw new Error('Run dispatch failed'); } },
        async notifyTimeline(runId, sequence) { await transaction.execute(sql`SELECT pg_notify('run_timeline', ${JSON.stringify({ runId, sequence })})`); },
      });
    });
  }
}
/**
 * The transaction ONE Run's cancellation is decided and committed inside (Story 3.10).
 *
 * It takes the Run's own row lock with `SELECT ... FOR UPDATE`, exactly as
 * `PostgresPopulationRepository` and `PostgresAdapterExecutionRepository` do, because
 * those are what it races: cancel-meets-claim is decided by that lock, so one side
 * commits and the other reads the committed result. It deliberately does NOT take the
 * configuration advisory lock the initiation unit of work takes — cancelling reads no
 * Active version set, and serializing every cancellation against every configuration
 * write would buy nothing.
 *
 * The Result-completing reads come from `runResultContext` and `evidencePackageContext`,
 * the same two the worker stages compose, so a Run cancelled by this command and one
 * cancelled at a worker boundary conclude through one implementation.
 */
export class PostgresRunCancellationRepository implements RunCancellationRepository {
  constructor(private readonly db: Database, private readonly dependencies: PostgresAuditDependencies = {}) {}
  transaction<T>(runId: string, work: (context: RunCancellationContext) => Promise<T>): Promise<T> {
    return this.db.transaction(async transaction => {
      if (!isUuidText(runId)) throw new Error('Invalid Run identity');
      await transaction.select({ id: auditRun.runId }).from(auditRun).where(eq(auditRun.runId, runId)).for('update');
      const repository = new DrizzleRunRepository(transaction);
      const run = await repository.findRun(runId);
      const db = queueDatabase(transaction);
      const queue = new PgBoss({ db, migrate: false, createSchema: false, schedule: false, supervise: false });
      return work({
        run,
        authorizationRoles: new DrizzleRoleRepository(transaction),
        ...evidencePackageContext(transaction, runId),
        ...runResultContext(transaction, runId),
        auditEvents: createAuditEventWriter(transaction, this.dependencies.clock ?? new SystemClock(), this.dependencies.ids ?? new CryptoUuidV7Generator()),
        frozenPlan: () => run ? new DrizzleFrozenExecutionReader(transaction).readFrozenExecution(run.versionId, run.procedureId) : Promise.resolve(null),
        requestCancellation: request => repository.requestCancellation(runId, request),
        // On the SAME transaction handle the queue's own metadata lookup uses. A producer
        // that used the pool for one of the two calls could escape this transaction or
        // deadlock a single-connection pool (Story 2.6).
        async removeDispatch() {
          const jobs = await queue.findJobs<unknown>(RUNS_QUEUE, { db, data: { runId } });
          if (jobs.length > 0) await queue.deleteJob(RUNS_QUEUE, jobs.map(job => job.id), { db });
        },
        async notifyTimeline(sequence) { await transaction.execute(sql`SELECT pg_notify('run_timeline', ${JSON.stringify({ runId, sequence })})`); },
      });
    });
  }
}
/** Release-only provisioning. Story 3.2 supplies the consumer. */
export async function migrateRunsQueue(db: Database): Promise<void> {
  const queue = new PgBoss({ db: queueDatabase(db), migrate: false, createSchema: false, schedule: false, supervise: false });
  await queue.createQueue(RUNS_QUEUE, { retryLimit: 3, retryDelay: 5, expireInSeconds: 180 });
  await queue.createQueue(EVALUATION_REVIEW_QUEUE, { retryLimit: 3, retryDelay: 5, expireInSeconds: 180 });
  await queue.createQueue(EVIDENCE_READ_GRANT_QUEUE, { retryLimit: 3, retryDelay: 5, expireInSeconds: 180 });
}
