import { sql } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import type { AuditUnitOfWork, RunsUnitOfWorkContext } from '@intellifin/application';
import { CryptoUuidV7Generator, SystemClock, createAuditEventWriter, type PostgresAuditDependencies } from '../db/audit-events.js';
import type { Database } from '../db/client.js';
import { DrizzleRoleRepository } from '../identity/role-repository.js';
import { DrizzleProcedurePeriodOwnerReader } from '../procedures/procedure-repository.js';
import { queueDatabase } from '../procedures/derivation-queue.js';
import { DrizzleRunRepository } from './run-repository.js';
export const RUNS_QUEUE = 'runs';
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
/** Release-only provisioning. Story 3.2 supplies the consumer. */
export async function migrateRunsQueue(db: Database): Promise<void> {
  const queue = new PgBoss({ db: queueDatabase(db), migrate: false, createSchema: false, schedule: false, supervise: false });
  await queue.createQueue(RUNS_QUEUE, { retryLimit: 3, retryDelay: 5, expireInSeconds: 180 });
}
