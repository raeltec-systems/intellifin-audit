import { and, eq, inArray, sql } from 'drizzle-orm';
import type { RunReader, RunWriter } from '@intellifin/application';
import { ACTIVE_RUN_STATES, type ExplicitPeriod, type RunCancellationRequest, type RunRecord } from '@intellifin/domain';
import type { Database, Transaction } from '../db/client.js';
import { auditRun, runInitiationRequest } from '../db/schema.js';
import { isUuidText } from '../db/identifier.js';
/** The active-state list, from the domain and in ONE place: the partial unique index in
 * generation 1 spells the same four states and a second copy here would be a second
 * answer to "is this Run still running". */
const ACTIVE = [...ACTIVE_RUN_STATES];
function record(row: typeof auditRun.$inferSelect): RunRecord {
  const { periodFrom, periodTo, initiatedAt, cancelRequestedAt, cancelRequestedBy, cancelRequestedSession, cancelReason, ...rest } = row;
  return {
    ...rest,
    period: { from: periodFrom, to: periodTo },
    initiatedAt: initiatedAt.toISOString(),
    // Written whole or not at all; generation 26's CHECK says so as well, so a row that
    // carries the time carries the other three.
    cancellation: cancelRequestedAt === null || cancelRequestedBy === null || cancelRequestedSession === null || cancelReason === null
      ? null
      : { requestedBy: cancelRequestedBy, sessionId: cancelRequestedSession, requestedAt: cancelRequestedAt.toISOString(), reason: cancelReason },
  };
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
    const row = (await this.db.select().from(auditRun).where(and(eq(auditRun.procedureId, procedureId), eq(auditRun.periodFrom, period.from), eq(auditRun.periodTo, period.to), eq(auditRun.kind, 'STANDARD'), inArray(auditRun.state, ACTIVE))).limit(1))[0];
    return row ? record(row) : null;
  }
  async insert(run: RunRecord): Promise<boolean> {
    const { period, initiatedAt, cancellation, ...rest } = run;
    const inserted = await this.db.insert(auditRun).values({
      ...rest, periodFrom: period.from, periodTo: period.to, initiatedAt: new Date(initiatedAt),
      // A Run is never created already cancelled. The columns are written by
      // `requestCancellation` alone, which is what makes one marker per Run the rule.
      cancelRequestedAt: cancellation === null ? null : new Date(cancellation.requestedAt),
      cancelRequestedBy: cancellation?.requestedBy ?? null,
      cancelRequestedSession: cancellation?.sessionId ?? null,
      cancelReason: cancellation?.reason ?? null,
    }).onConflictDoNothing({ target: [auditRun.procedureId, auditRun.periodFrom, auditRun.periodTo], where: sql`kind = 'STANDARD' AND state IN ('QUEUED','RUNNING','PAUSED','AWAITING_AUDITOR')` }).returning({ id: auditRun.runId });
    return inserted.length === 1;
  }
  /**
   * Write one person's cancellation request onto the Run row (Story 3.10).
   *
   * Guarded on the marker still being absent, so the FIRST request wins even if two
   * transactions were somehow admitted: a later person must not overwrite the requester,
   * the time or the reason that the Canceled Run Detail state then reports. The command
   * refuses a second request before reaching here; this is the same rule below it.
   */
  async requestCancellation(runId: string, request: RunCancellationRequest): Promise<void> {
    await this.db.update(auditRun).set({
      cancelRequestedAt: new Date(request.requestedAt),
      cancelRequestedBy: request.requestedBy,
      cancelRequestedSession: request.sessionId,
      cancelReason: request.reason,
    }).where(and(eq(auditRun.runId, runId), sql`${auditRun.cancelRequestedAt} IS NULL`));
  }
}
