import { eq, sql } from 'drizzle-orm';
import { authorizeActionRole } from '@intellifin/domain';
import type { RunControlLeaseRepository, RunControlLeaseContext, RunControlLeaseState } from '@intellifin/application';
import type { Database, Transaction } from '../db/client.js';
import { auditRun, authUser, runControlLease } from '../db/schema.js';
import { isUuidText } from '../db/identifier.js';
import { DrizzleRoleRepository } from '../identity/role-repository.js';
import { createAuditEventWriter, CryptoUuidV7Generator, SystemClock } from '../db/audit-events.js';
import { DrizzleRunRepository } from './run-repository.js';

/** Called only under the canonical Run lock for command authorization. */
export async function readLockedRunControlLease(tx: Transaction, runId: string): Promise<RunControlLeaseState | null> {
  const [row] = await tx.select().from(runControlLease).where(eq(runControlLease.runId, runId));
  return row === undefined ? null : {
    runId: row.runId,
    epoch: row.epoch,
    holderId: row.holderId,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** A bounded adjunct to existing Run authority, never a worker or execution queue. */
export class PostgresRunControlLeaseRepository implements RunControlLeaseRepository {
  constructor(private readonly db: Database | Transaction) {}

  async transaction<T>(runId: string, work: (context: RunControlLeaseContext) => Promise<T>): Promise<T> {
    if (!isUuidText(runId)) throw new Error('Invalid Run identity');
    return this.db.transaction(async tx => {
      // Match pause, resume, cancellation and worker lock order. Do not load the full
      // execution projection merely to arbitrate a five-field control lease.
      await tx.select({ id: auditRun.runId }).from(auditRun).where(eq(auditRun.runId, runId)).for('update');
      const run = await new DrizzleRunRepository(tx).findRun(runId);
      const now = new Date(await runControlServerTime(tx));
      return work({
        run,
        now,
        authorizationRoles: new DrizzleRoleRepository(tx),
        auditEvents: createAuditEventWriter(tx, new SystemClock(), new CryptoUuidV7Generator()),
        readLease: () => readLockedRunControlLease(tx, runId),
        async saveLease(state) {
          if (state.runId !== runId || run === null) throw new Error('Invalid Run control identity');
          const values = {
            runId,
            epoch: state.epoch,
            holderId: state.holderId,
            expiresAt: state.expiresAt === null ? null : new Date(state.expiresAt),
            updatedAt: new Date(state.updatedAt),
          };
          const updated = await tx.update(runControlLease).set(values)
            .where(eq(runControlLease.runId, runId)).returning({ runId: runControlLease.runId });
          if (updated.length === 0) await tx.insert(runControlLease).values(values);
        },
        async notifyTimeline(sequence) {
          await tx.execute(sql`SELECT pg_notify('run_timeline', ${JSON.stringify({ runId, sequence })})`);
        },
      });
    });
  }
}

/** The authoritative time is sampled after acquiring the Run lock, never from a client. */
export async function runControlServerTime(tx: Transaction): Promise<string> {
  const result = await tx.execute<{ server_time: Date | string }>(sql`SELECT clock_timestamp() AS server_time`);
  const value = result[0]?.server_time;
  if (value === undefined) throw new Error('Run control server time unavailable');
  return new Date(value).toISOString();
}

export type RunControlLeaseRead =
  | { readonly status: 'denied' | 'missing' }
  | {
    readonly status: 'ready';
    readonly runId: string;
    readonly required: boolean;
    readonly epoch: number;
    readonly heldByYou: boolean;
    readonly holderName: string | null;
    readonly expiresAt: string | null;
    readonly serverTime: string;
    readonly active: boolean;
  };

/** Bounded presentation read. A subsequent command must recheck everything under lock. */
export async function readRunControlLease(
  db: Database,
  input: { readonly runId: string; readonly actorId: string; readonly requiredForUnenrolledRun: boolean },
): Promise<RunControlLeaseRead> {
  if (!isUuidText(input.runId)) return { status: 'missing' };
  return db.transaction(async tx => {
    const role = await new DrizzleRoleRepository(tx).findRole(input.actorId);
    if (!authorizeActionRole(role, 'run.resume').allowed) return { status: 'denied' };
    const [row] = await tx.select({
      runId: auditRun.runId,
      state: auditRun.state,
      epoch: runControlLease.epoch,
      holderId: runControlLease.holderId,
      holderName: authUser.name,
      expiresAt: runControlLease.expiresAt,
      serverTime: sql<Date | string>`clock_timestamp()`,
    }).from(auditRun)
      .leftJoin(runControlLease, eq(runControlLease.runId, auditRun.runId))
      .leftJoin(authUser, eq(authUser.id, runControlLease.holderId))
      .where(eq(auditRun.runId, input.runId));
    if (row === undefined) return { status: 'missing' };
    const now = new Date(row.serverTime);
    const live = row.holderId !== null && row.expiresAt !== null && row.expiresAt > now;
    return {
      status: 'ready',
      runId: row.runId,
      required: row.epoch !== null || input.requiredForUnenrolledRun,
      epoch: row.epoch ?? 0,
      heldByYou: live && row.holderId === input.actorId,
      holderName: live ? row.holderName ?? 'Unavailable controller identity' : null,
      expiresAt: live ? row.expiresAt!.toISOString() : null,
      serverTime: now.toISOString(),
      active: ['QUEUED', 'RUNNING', 'AWAITING_AUDITOR', 'PAUSED'].includes(row.state),
    };
  });
}
