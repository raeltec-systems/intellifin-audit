import { sql } from 'drizzle-orm';
import type { Database, Transaction } from '../db/client.js';
import { isUuidText } from '../db/identifier.js';

export interface ReplayCaptureGap {
  readonly toolActionId: string;
  readonly stepExecutionId: string;
  readonly startedAt: string;
  readonly kind: 'missing' | 'suppressed';
  readonly captureSuppression: string | null;
}
export interface ReplayCaptureGaps {
  readonly rows: readonly ReplayCaptureGap[];
  readonly total: number;
  readonly missing: number;
  readonly suppressed: number;
}
/** A complete exact count with a bounded deterministic position list. A protected-read
 * error is a client-local unavailable frame, not a new missing-capture audit event. */
export async function readReplayCaptureGaps(db: Database | Transaction, runId: string,
  workItemId?: string): Promise<ReplayCaptureGaps> {
  if (!isUuidText(runId) || (workItemId !== undefined && !isUuidText(workItemId)))
    return { rows: [], total: 0, missing: 0, suppressed: 0 };
  const scope = workItemId === undefined ? sql`` : sql`AND coalesce(s.work_item_id,a.work_item_id)=${workItemId}::uuid`;
  const base = sql`FROM run_tool_action a JOIN run_step_execution s ON s.step_execution_id=a.step_execution_id AND s.run_id=a.run_id
    WHERE a.run_id=${runId}::uuid ${scope} AND a.outcome='performed'
      AND (a.capture='SUPPRESSED' OR (a.capture='PERMITTED' AND NOT EXISTS (
        SELECT 1 FROM run_evidence_capture c JOIN run_evidence e ON e.evidence_id=c.evidence_id AND e.run_id=a.run_id
        WHERE c.tool_action_id=a.tool_action_id AND e.kind='screenshot' AND e.state='REGISTERED'))) `;
  const counted = await db.execute<{ missing: number; suppressed: number }>(sql`
    SELECT count(*) FILTER (WHERE a.capture='PERMITTED')::int AS missing,
      count(*) FILTER (WHERE a.capture='SUPPRESSED')::int AS suppressed ${base}`);
  const rows = await db.execute<{ tool_action_id: string; step_execution_id: string; started_at: string | Date; capture: string; capture_suppression: string | null }>(sql`
    SELECT a.tool_action_id,a.step_execution_id,a.started_at,a.capture,a.capture_suppression ${base}
    ORDER BY a.started_at,a.tool_action_id LIMIT 500`);
  const missing = Number(counted[0]?.missing ?? 0), suppressed = Number(counted[0]?.suppressed ?? 0);
  return { missing, suppressed, total: missing + suppressed, rows: rows.map(row => ({
    toolActionId: row.tool_action_id, stepExecutionId: row.step_execution_id, captureSuppression: row.capture_suppression,
    startedAt: new Date(row.started_at).toISOString(), kind: row.capture === 'SUPPRESSED' ? 'suppressed' : 'missing',
  })) };
}
