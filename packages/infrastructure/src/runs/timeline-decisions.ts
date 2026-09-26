import { eq, sql } from 'drizzle-orm';
import { adapterSearchKeys, type ExecutablePlan } from '@intellifin/domain';
import { auditRun } from '../db/schema.js';
import { DrizzleFrozenExecutionReader } from '../procedures/procedure-repository.js';
import type { Database, Transaction } from '../db/client.js';
import { isUuidText } from '../db/identifier.js';

export interface TimelineDecision {
  readonly sequence: number;
  readonly kind: 'escalation' | 'pause';
  readonly occurredAt: string;
  readonly actorId: string;
  readonly waitId: string | null;
  readonly escalationKind: string | null;
  readonly answerOptionId: string | null;
  readonly answerLabel: string | null;
  /** Missing on older presentation shapes: the UI must fail closed. */
  readonly answerMasked?: boolean;
  readonly requestedAt: string | null;
  readonly state: string | null;
  readonly stepId: string | null;
  readonly workItemId: string | null;
}
export interface TimelineDecisions {
  readonly rows: readonly TimelineDecision[];
  readonly total: number;
  readonly nextCursor: number | null;
  readonly selectionFound: boolean;
}

/** Candidate labels can contain the secondary lookup key or the primary fallback.
 * Remove the source value before it leaves the repository, using frozen policy only. */
export function maskTimelineCandidate(decision: TimelineDecision, plan: ExecutablePlan | null): TimelineDecision {
  if (decision.escalationKind !== 'choose-candidate' || decision.answerOptionId === 'mark-ambiguous')
    return { ...decision, answerMasked: true };
  const keys = plan === null ? [] : adapterSearchKeys(plan.inputs.templateId) ?? [];
  const policy = plan?.inputs.sourceSnapshot?.contract.sensitive_fields;
  const masked = plan === null || policy === undefined || keys.length === 0 || keys.some(key => policy.includes(key));
  return { ...decision, answerLabel: masked ? null : decision.answerLabel, answerMasked: masked };
}

/** The immutable decision envelope and its same-Run wait agree before a decision is shown.
 * Work comes only from the raise event's explicit Step and Evidence references and a unique
 * matching turn. Consumed/cleared agent checkpoints and nearby timestamps are not history.
 * No question, note or entire options array crosses this read boundary. */
export async function readTimelineDecisions(db: Database | Transaction, runId: string, after = 0, waitId?: string): Promise<TimelineDecisions> {
  const unavailable = { rows: [], total: 0, nextCursor: null, selectionFound: false };
  if (!isUuidText(runId) || !Number.isSafeInteger(after) || after < 0 ||
      (waitId !== undefined && (!isUuidText(waitId) || after !== 0))) return unavailable;
  runId = runId.toLowerCase();
  const selectedWait = waitId?.toLowerCase() ?? null;
  const rows = await db.execute<{ rows: TimelineDecision[]; total: number; selection_found: boolean }>(sql`
    WITH decisions AS (
      SELECT e.sequence, 'escalation' AS kind, e.occurred_at AS "occurredAt", w.actor AS "actorId",
        w.wait_id AS "waitId", w.kind AS "escalationKind", w.answer_option_id AS "answerOptionId",
        (SELECT option->>'label' FROM jsonb_array_elements(w.options) option
          WHERE option->>'id'=w.answer_option_id LIMIT 1) AS "answerLabel",
        NULL::text AS "requestedAt", NULL::text AS state,
        raised.payload->>'stepId' AS "stepId", binding.work_item_id AS "workItemId"
      FROM audit_events e
      JOIN run_wait w ON w.run_id::text=e.aggregate_id AND w.wait_id::text=e.payload->>'waitId'
        AND w.closure_kind='answer' AND w.closed_at IS NOT NULL AND w.kind<>'pause'
        AND w.actor=e.actor_id AND w.kind=e.payload->>'kind'
        AND w.answer_option_id=e.payload->>'answerOptionId'
      LEFT JOIN LATERAL (
        SELECT r.payload FROM audit_events r WHERE r.aggregate_id=e.aggregate_id
          AND r.event_type='execution.escalation-raised' AND r.actor_type='system'
          AND r.actor_id='escalation-platform' AND r.source='platform' AND r.outcome='success'
          AND r.payload->>'waitId'=w.wait_id::text AND r.payload->>'kind'=w.kind
          AND r.sequence<e.sequence ORDER BY r.sequence DESC LIMIT 1
      ) raised ON true
      LEFT JOIN LATERAL (
        SELECT CASE WHEN count(DISTINCT t.work_item_id)=1 THEN min(t.work_item_id::text) END AS work_item_id
        FROM run_agent_turn t JOIN run_step_execution s ON s.run_id=t.run_id AND s.step_execution_id=t.step_execution_id
        JOIN run_work_item wi ON wi.run_id=t.run_id AND wi.work_item_id=t.work_item_id AND wi.step_id=s.plan_step_id
        WHERE t.run_id::text=e.aggregate_id AND s.plan_step_id=raised.payload->>'stepId'
          AND t.snapshot_evidence_id::text IN (
            SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(raised.payload->'supportingEvidenceIds')='array'
              THEN raised.payload->'supportingEvidenceIds' ELSE '[]'::jsonb END))
      ) binding ON true
      WHERE e.aggregate_id=${runId} AND e.event_type='execution.escalation-answered'
        AND e.actor_type='human' AND e.source='web' AND e.outcome='success'
        AND e.payload->>'closureKind'='answer'
      UNION ALL
      SELECT e.sequence, 'pause', e.occurred_at, e.payload->>'requestedBy', NULL::uuid, NULL::text,
        NULL::text, NULL::text, e.payload->>'requestedAt', e.payload->>'state', NULL::text, NULL::text
      FROM audit_events e WHERE e.aggregate_id=${runId} AND e.event_type='lifecycle.pause-superseded'
        AND e.actor_type='system' AND e.actor_id='result-sealer' AND e.source='worker' AND e.outcome='failure'
        AND jsonb_typeof(e.payload->'requestedBy')='string' AND jsonb_typeof(e.payload->'requestedAt')='string'
    ), selected AS (SELECT min(sequence) AS sequence FROM decisions WHERE "waitId"::text=${selectedWait}),
    page AS (SELECT * FROM decisions
      WHERE sequence > CASE WHEN ${selectedWait}::text IS NULL THEN ${after}
        ELSE (SELECT sequence - 1 FROM selected) END ORDER BY sequence LIMIT 51)
    SELECT (SELECT count(*)::integer FROM decisions) AS total,
      CASE WHEN ${selectedWait}::text IS NOT NULL THEN (SELECT sequence IS NOT NULL FROM selected)
        WHEN ${after} > 0 THEN EXISTS (SELECT 1 FROM page) ELSE true END AS selection_found,
      COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY sequence) FROM page), '[]'::jsonb) AS rows
  `);
  const result = rows[0];
  if (!result?.selection_found) return unavailable;
  let plan: ExecutablePlan | null = null;
  if (result.rows.some(row => row.escalationKind === 'choose-candidate' && row.answerOptionId !== 'mark-ambiguous')) {
    const [run] = await db.select({ versionId: auditRun.versionId, procedureId: auditRun.procedureId })
      .from(auditRun).where(eq(auditRun.runId, runId)).limit(1);
    if (run !== undefined) plan = await new DrizzleFrozenExecutionReader(db).readFrozenExecution(run.versionId, run.procedureId);
  }
  const page = (result?.rows ?? []).map(row => maskTimelineCandidate({ ...row, sequence: Number(row.sequence),
    occurredAt: new Date(row.occurredAt).toISOString() }, plan));
  return { rows: page.slice(0, 50), total: result?.total ?? 0, selectionFound: true,
    nextCursor: page.length > 50 ? page[49]!.sequence : null };
}
