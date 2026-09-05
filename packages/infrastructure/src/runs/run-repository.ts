import { and, eq, inArray, sql } from 'drizzle-orm';
import type { RunReader, RunWriter } from '@intellifin/application';
import type { ExplicitPeriod, RunRecord } from '@intellifin/domain';
import type { Database, Transaction } from '../db/client.js';
import { auditRun, runInitiationRequest } from '../db/schema.js';
import { isUuidText } from '../db/identifier.js';
function record(row: typeof auditRun.$inferSelect): RunRecord {
  const { periodFrom, periodTo, initiatedAt, ...rest } = row;
  return { ...rest, period: { from: periodFrom, to: periodTo }, initiatedAt: initiatedAt.toISOString() };
}
export class DrizzleRunRepository implements RunReader, RunWriter {
  constructor(private readonly db: Database | Transaction) {}
  async findRun(runId: string): Promise<RunRecord | null> {
    if (!isUuidText(runId)) return null;
    const row = (await this.db.select().from(auditRun).where(eq(auditRun.runId, runId)).limit(1))[0];
    return row ? record(row) : null;
  }
  async bindRequest(initiatorId: string, requestToken: string, runId: string): Promise<void> {
    await this.db.insert(runInitiationRequest).values({ initiatorId, requestToken, runId });
  }
  async findRequest(initiatorId: string, requestToken: string): Promise<RunRecord | null> {
    const row = (await this.db.select({ run: auditRun }).from(runInitiationRequest).innerJoin(auditRun, eq(runInitiationRequest.runId, auditRun.runId)).where(and(eq(runInitiationRequest.initiatorId, initiatorId), eq(runInitiationRequest.requestToken, requestToken))).limit(1))[0];
    return row ? record(row.run) : null;
  }
  async findActive(procedureId: string, period: ExplicitPeriod): Promise<RunRecord | null> {
    const row = (await this.db.select().from(auditRun).where(and(eq(auditRun.procedureId, procedureId), eq(auditRun.periodFrom, period.from), eq(auditRun.periodTo, period.to), eq(auditRun.kind, 'STANDARD'), inArray(auditRun.state, ['QUEUED','RUNNING','PAUSED','AWAITING_AUDITOR']))).limit(1))[0];
    return row ? record(row) : null;
  }
  async insert(run: RunRecord): Promise<boolean> {
    const { period, initiatedAt, ...rest } = run;
    const inserted = await this.db.insert(auditRun).values({ ...rest, periodFrom: period.from, periodTo: period.to, initiatedAt: new Date(initiatedAt) }).onConflictDoNothing({ target: [auditRun.procedureId, auditRun.periodFrom, auditRun.periodTo], where: sql`kind = 'STANDARD' AND state IN ('QUEUED','RUNNING','PAUSED','AWAITING_AUDITOR')` }).returning({ id: auditRun.runId });
    return inserted.length === 1;
  }
}
