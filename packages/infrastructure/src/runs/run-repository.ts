import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { RunReader, RunRequestDecision, RunWriter } from '@intellifin/application';
import { ACTIVE_RUN_STATES, isRunRequestRefusalCode, type ExplicitPeriod, type RunCancellationRequest, type RunPauseRequest, type RunRecord } from '@intellifin/domain';
import type { Database, Transaction } from '../db/client.js';
import { auditRun, runInitiationRequest } from '../db/schema.js';
import { isUuidText } from '../db/identifier.js';
/** The active-state list, from the domain and in ONE place: the partial unique index in
 * generation 1 spells the same four states and a second copy here would be a second
 * answer to "is this Run still running". */
const ACTIVE = [...ACTIVE_RUN_STATES];
function record(row: typeof auditRun.$inferSelect): RunRecord {
  const { periodFrom, periodTo, initiatedAt, cancelRequestedAt, cancelRequestedBy, cancelRequestedSession, cancelReason,
    pauseRequestedAt, pauseRequestedBy, pauseRequestedSession, ...rest } = row;
  return {
    ...rest,
    period: { from: periodFrom, to: periodTo },
    initiatedAt: initiatedAt.toISOString(),
    // Written whole or not at all; generation 26's CHECK says so as well, so a row that
    // carries the time carries the other three.
    cancellation: cancelRequestedAt === null || cancelRequestedBy === null || cancelRequestedSession === null || cancelReason === null
      ? null
      : { requestedBy: cancelRequestedBy, sessionId: cancelRequestedSession, requestedAt: cancelRequestedAt.toISOString(), reason: cancelReason },
    // The same rule, and generation 45's `audit_run_pause_request` CHECK says the three
    // move together. Present means "requested and not yet honoured": the boundary that
    // performs a pause clears it, so a Run that ends carrying one was never paused.
    pauseRequest: pauseRequestedAt === null || pauseRequestedBy === null || pauseRequestedSession === null
      ? null
      : { requestedBy: pauseRequestedBy, sessionId: pauseRequestedSession, requestedAt: pauseRequestedAt.toISOString() },
  };
}
export class DrizzleRunRepository implements RunReader, RunWriter {
  constructor(private readonly db: Database | Transaction) {}
  async findRun(runId: string): Promise<RunRecord | null> {
    if (!isUuidText(runId)) return null;
    const row = (await this.db.select().from(auditRun).where(eq(auditRun.runId, runId)).limit(1))[0];
    return row ? record(row) : null;
  }
  /**
   * The Runs that name this one as their predecessor (PR 23 review, P2-1).
   *
   * `RunLifecycleActions` tells a person whose rerun response was LOST to "Reload the Run
   * to see whether a new Run was queued" — and the Run they reload could not answer that,
   * because the link is deliberately on the SUCCESSOR's row and its own chain and nowhere
   * else. So they saw nothing, clicked Rerun again, and once the first successor had itself
   * concluded the active-period check no longer refused them: two Runs from one intent,
   * with the person believing there was one. This is the read that answers the sentence.
   *
   * Bounded and ordered, like every other read on these surfaces. `predecessor_run_id` is
   * not indexed, and does not need to be for a PoC: this is one Run's own detail page.
   */
  async findSuccessors(runId: string, limit = 10): Promise<readonly RunRecord[]> {
    if (!isUuidText(runId)) return [];
    const rows = await this.db
      .select()
      .from(auditRun)
      .where(eq(auditRun.predecessorRunId, runId))
      .orderBy(asc(auditRun.initiatedAt), asc(auditRun.runId))
      .limit(Math.max(1, Math.min(limit, 25)));
    return rows.map(record);
  }
  /**
   * Record what this token was decided to mean. The FIRST decision wins.
   *
   * `onConflictDoNothing`, not an upsert: a token means one thing forever, so a second
   * write must change nothing rather than replace an answer somebody has already been
   * given. It also makes two racing requests carrying one token safe — one inserts, the
   * other no-ops, and both read the same row back.
   */
  async bindRequest(initiatorId: string, requestToken: string, decision: RunRequestDecision): Promise<void> {
    await this.db.insert(runInitiationRequest).values({
      initiatorId, requestToken,
      procedureId: decision.procedureId, periodFrom: decision.period.from, periodTo: decision.period.to,
      runId: decision.runId, refusal: decision.refusal, refusedRunId: decision.refusedRunId,
    }).onConflictDoNothing({ target: [runInitiationRequest.initiatorId, runInitiationRequest.requestToken] });
  }
  /**
   * The decision, read from the request row ALONE — no join to a Run.
   *
   * The join is what made the old behaviour possible: the row pointed at a Run and the
   * command answered with whatever it found there, including a Run this caller never
   * initiated. A decision is now a fact about the request, and a Run id on it is a
   * reference the caller can follow, never the answer itself.
   */
  async findRequest(initiatorId: string, requestToken: string): Promise<RunRequestDecision | null> {
    const row = (await this.db.select().from(runInitiationRequest).where(and(eq(runInitiationRequest.initiatorId, initiatorId), eq(runInitiationRequest.requestToken, requestToken))).limit(1))[0];
    if (!row) return null;
    return {
      procedureId: row.procedureId,
      period: { from: row.periodFrom, to: row.periodTo },
      runId: row.runId,
      // A stored value, so it is read as request-shaped input: a code this build does not
      // know is `null`, which `replay` reads fail-closed as a refusal rather than as the
      // success an unrecognised string must never become.
      refusal: isRunRequestRefusalCode(row.refusal) ? row.refusal : null,
      refusedRunId: row.refusedRunId,
    };
  }
  async findActive(procedureId: string, period: ExplicitPeriod): Promise<RunRecord | null> {
    const row = (await this.db.select().from(auditRun).where(and(eq(auditRun.procedureId, procedureId), eq(auditRun.periodFrom, period.from), eq(auditRun.periodTo, period.to), eq(auditRun.kind, 'STANDARD'), inArray(auditRun.state, ACTIVE))).limit(1))[0];
    return row ? record(row) : null;
  }
  async insert(run: RunRecord): Promise<boolean> {
    const { period, initiatedAt, cancellation, pauseRequest, ...rest } = run;
    const inserted = await this.db.insert(auditRun).values({
      ...rest, periodFrom: period.from, periodTo: period.to, initiatedAt: new Date(initiatedAt),
      // A Run is never created already cancelled. The columns are written by
      // `requestCancellation` alone, which is what makes one marker per Run the rule.
      cancelRequestedAt: cancellation === null ? null : new Date(cancellation.requestedAt),
      cancelRequestedBy: cancellation?.requestedBy ?? null,
      cancelRequestedSession: cancellation?.sessionId ?? null,
      cancelReason: cancellation?.reason ?? null,
      // A Run is never created already paused; `requestPause` is the only writer, which is
      // what makes one outstanding request per Run the rule.
      pauseRequestedAt: pauseRequest === null ? null : new Date(pauseRequest.requestedAt),
      pauseRequestedBy: pauseRequest?.requestedBy ?? null,
      pauseRequestedSession: pauseRequest?.sessionId ?? null,
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
  /** The FIRST pause request wins, exactly as the FIRST cancellation request does. */
  async requestPause(runId: string, request: RunPauseRequest): Promise<void> {
    await this.db.update(auditRun).set({
      pauseRequestedAt: new Date(request.requestedAt),
      pauseRequestedBy: request.requestedBy,
      pauseRequestedSession: request.sessionId,
    }).where(and(eq(auditRun.runId, runId), sql`${auditRun.pauseRequestedAt} IS NULL`));
  }
  /** Remove the marker, in the transaction that HONOURS the pause. Never on resume. */
  async clearPauseRequest(runId: string): Promise<void> {
    await this.db.update(auditRun).set({
      pauseRequestedAt: null, pauseRequestedBy: null, pauseRequestedSession: null,
    }).where(eq(auditRun.runId, runId));
  }
}
