import { sql } from 'drizzle-orm';
import type { Transaction } from '../db/client.js';

/** Called only under the Run row lock. The first started attempt consumes the resume
 * by recording this exact wait id in its existing audit event in the same transaction.
 * This is a causal producer link, never a timestamp association on historical events. */
export async function readPendingResumeWait(tx: Transaction, runId: string): Promise<string | null> {
  const result = await tx.execute(sql`
    WITH latest AS (
      SELECT sequence, payload ->> 'waitId' AS wait_id, event_type
      FROM audit_events
      WHERE aggregate_id = ${runId}
        AND event_type IN ('lifecycle.run-paused', 'lifecycle.run-resumed')
      ORDER BY sequence DESC LIMIT 1
    )
    SELECT latest.wait_id FROM latest
    JOIN run_wait w ON w.wait_id::text = latest.wait_id AND w.run_id = ${runId}
    WHERE latest.event_type = 'lifecycle.run-resumed' AND w.kind = 'pause'
      AND w.closure_kind = 'resume'
      AND NOT EXISTS (
        SELECT 1 FROM audit_events started WHERE started.aggregate_id = ${runId}
          AND started.sequence > latest.sequence
          AND started.event_type IN ('lifecycle.agent-work', 'lifecycle.agent-execution', 'lifecycle.adapter-execution')
          AND started.source = 'worker' AND started.outcome = 'success'
          AND started.payload ->> 'diagnostic' IN ('work-item-attempt-started', 'sign-in-attempt-started', 'public-access-attempt-started', 'reference-attempt-started')
          AND started.payload ->> 'resumedFromWaitId' = latest.wait_id
      )
  `);
  const rows = result as unknown as readonly { wait_id: string }[];
  return rows[0]?.wait_id ?? null;
}

export interface RunPauseLinkage {
  readonly eventId: string;
  readonly sequence: number;
  readonly kind: 'pause' | 'resume';
  readonly occurredAt: string;
  readonly actorId: string;
  readonly waitId: string | null;
  readonly planStepId: string | null;
  readonly stepExecutionId: string | null;
  readonly attempt: number | null;
  /** null means the historical event did not record the distinction. */
  readonly inFlight: boolean | null;
}

export const PAUSE_LINKAGE_LIMIT = 100;

/** A bounded newest-first page, with the exact total. Resume provenance must be
 * unique and agree with the same Run's actual execution row. No time-based join. */
export async function readRunPauseLinkage(
  db: import('../db/client.js').Database,
  runId: string,
  beforeSequence: number | null = null,
): Promise<{ rows: readonly RunPauseLinkage[]; total: number; nextBeforeSequence: number | null }> {
  if (beforeSequence !== null && (!Number.isSafeInteger(beforeSequence) || beforeSequence <= 0)) throw new Error('Invalid pause history cursor');
  const result = await db.execute(sql`
    WITH history AS (
      SELECT event_id, sequence, event_type, occurred_at, actor_id, payload
      FROM audit_events WHERE aggregate_id = ${runId}
        AND event_type IN ('lifecycle.run-paused', 'lifecycle.run-resumed')
    ), page AS (
      SELECT * FROM history WHERE (${beforeSequence}::bigint IS NULL OR sequence < ${beforeSequence})
      ORDER BY sequence DESC LIMIT ${PAUSE_LINKAGE_LIMIT + 1}
    )
    SELECT page.*, totals.total, linked.plan_step_id AS resumed_plan_step_id,
      linked.step_execution_id::text AS resumed_execution_id,
      linked.attempt AS resumed_attempt, linked.link_count
    FROM (SELECT count(*) AS total FROM history) totals
    LEFT JOIN page ON true
    LEFT JOIN LATERAL (
      SELECT execution.plan_step_id, execution.step_execution_id, execution.attempt,
        count(*) OVER () AS link_count
      FROM audit_events started
      LEFT JOIN run_step_execution execution
        ON execution.run_id = ${runId}
        AND execution.step_execution_id::text = started.payload ->> 'stepExecutionId'
        AND execution.plan_step_id = started.payload ->> 'stepId'
        AND execution.attempt::text = started.payload ->> 'attempt'
      WHERE page.event_type = 'lifecycle.run-resumed'
        AND started.aggregate_id = ${runId} AND started.sequence > page.sequence
        AND started.payload ->> 'resumedFromWaitId' = page.payload ->> 'waitId'
        AND started.event_type IN ('lifecycle.agent-work', 'lifecycle.agent-execution', 'lifecycle.adapter-execution')
        AND started.source = 'worker' AND started.outcome = 'success'
        AND started.payload ->> 'diagnostic' IN ('work-item-attempt-started', 'sign-in-attempt-started', 'public-access-attempt-started', 'reference-attempt-started')
      ORDER BY started.sequence LIMIT 1
    ) linked ON true
    ORDER BY page.sequence DESC
  `);
  const rows = result as unknown as readonly {
    event_id: string; sequence: number | string; event_type: string; occurred_at: Date | string;
    actor_id: string; payload: Record<string, unknown>; total: number | string;
    resumed_plan_step_id: string | null; resumed_execution_id: string | null;
    resumed_attempt: number | null; link_count: number | string | null;
  }[];
  return {
    total: Number(rows[0]?.total ?? 0),
    nextBeforeSequence: rows.length > PAUSE_LINKAGE_LIMIT ? Number(rows[PAUSE_LINKAGE_LIMIT - 1]!.sequence) : null,
    rows: rows.filter(row => row.event_id != null).slice(0, PAUSE_LINKAGE_LIMIT).map(row => {
      const resume = row.event_type === 'lifecycle.run-resumed';
      const linked = Number(row.link_count) === 1 && row.resumed_execution_id !== null;
      const payload = row.payload;
      return {
        eventId: row.event_id, sequence: Number(row.sequence), kind: resume ? 'resume' : 'pause',
        occurredAt: new Date(row.occurred_at).toISOString(), actorId: row.actor_id,
        waitId: typeof payload.waitId === 'string' ? payload.waitId : null,
        planStepId: resume ? (linked ? row.resumed_plan_step_id : null) : typeof payload.planStepId === 'string' ? payload.planStepId : null,
        stepExecutionId: resume ? (linked ? row.resumed_execution_id : null) : typeof payload.stepExecutionId === 'string' ? payload.stepExecutionId : null,
        attempt: resume ? (linked ? row.resumed_attempt : null) : typeof payload.attempt === 'number' && Number.isSafeInteger(payload.attempt) && payload.attempt > 0 ? payload.attempt : null,
        inFlight: resume ? (linked ? true : null) : typeof payload.inFlight === 'boolean' ? payload.inFlight : null,
      };
    }),
  };
}
