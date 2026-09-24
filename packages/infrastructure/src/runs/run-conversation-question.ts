import { sql } from 'drizzle-orm';
import { isEscalationKind, runConversationQuestionDigest, detectRunConversationSecretPattern,
  type RunConversationQuestionContext } from '@intellifin/application';
import { canonicalJson, type JsonValue } from '@intellifin/domain';
import type { Transaction } from '../db/client.js';

/** Caller holds the canonical Run lock. No mutable latest-turn inference is permitted. */
export async function readLockedConversationQuestion(tx: Transaction, runId: string, lockWait = true): Promise<RunConversationQuestionContext | null> {
  const rows = await tx.execute<{
    revision: number; wait_id: string; kind: string; opened_at: string; deadline: string;
    options: { id: string; label: string }[]; event_id: string; payload: Record<string, unknown>;
    work_item_id: string | null; subject_key: string | null; registration_id: string | null;
    step_id: string | null; evidence_id: string | null; pending_wait: { kind: string; options: unknown } | null;
  }>(sql`SELECT r.revision,w.wait_id::text,w.kind,w.options,
    to_char(w.opened_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') opened_at,
    to_char(w.deadline AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') deadline,
    e.event_id::text,e.payload,i.work_item_id::text,i.subject_key,i.registration_id,i.step_id,i.evidence_id::text,a.pending_wait
    FROM audit_run r JOIN run_wait w ON w.run_id=r.run_id AND w.closed_at IS NULL AND w.kind<>'pause'
    JOIN audit_events e ON e.aggregate_id=r.run_id::text AND e.event_type='execution.escalation-raised'
      AND e.payload->>'waitId'=w.wait_id::text AND e.actor_type='system' AND e.actor_id='escalation-platform'
      AND e.source='platform' AND e.outcome='success'
    LEFT JOIN run_agent_work a ON a.run_id=r.run_id AND a.wait_id=w.wait_id AND a.status='WAITING'
    LEFT JOIN run_work_item i ON i.run_id=r.run_id AND i.work_item_id=a.work_item_id
    WHERE r.run_id=${runId}::uuid AND r.state='AWAITING_AUDITOR' ORDER BY e.sequence LIMIT 2 ${lockWait ? sql`FOR UPDATE OF w` : sql``}`);
  if (rows.length !== 1) return null;
  const row = rows[0];
  if (!row || !isEscalationKind(row.kind) || !object(row.payload) || row.payload.kind !== row.kind ||
    !Array.isArray(row.options) || row.options.length === 0 || row.options.length > 100 ||
    row.options.some(o => !object(o) || typeof o.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(o.id) || typeof o.label !== 'string' || o.label.length > 500 || detectRunConversationSecretPattern(o.label) !== null) ||
    new Set(row.options.map(o => o.id)).size !== row.options.length ||
    !Array.isArray(row.payload.supportingEvidenceIds) || row.payload.supportingEvidenceIds.some(id => typeof id !== 'string') ||
    typeof row.payload.stepId !== 'string' ||
    row.payload.deadline !== row.deadline || !Array.isArray(row.payload.optionIds) ||
    row.payload.optionIds.some(id => typeof id !== 'string') ||
    canonicalJson(row.payload.optionIds as JsonValue) !== canonicalJson(row.options.map(o => o.id))) return null;
  // The worker's pending vocabulary and evidence must be the same question. Candidate IDs
  // are indices in this snapshot; the existing worker decision verifier consumes it unchanged.
  if (row.work_item_id === null || !object(row.pending_wait) || !Array.isArray(row.pending_wait.options) || row.pending_wait.kind !== row.kind ||
    canonicalJson(row.pending_wait.options as JsonValue) !== canonicalJson(row.options) ||
    row.step_id !== row.payload.stepId || (row.kind === 'choose-candidate' &&
      (row.evidence_id === null || !row.payload.supportingEvidenceIds.includes(row.evidence_id)))) return null;
  const sources = await tx.execute<{ sequence: number; response: { uncertainty?: { rationale?: string } }; snapshot_evidence_id: string; step_execution_id: string }>(sql`
    SELECT t.sequence,t.response,t.snapshot_evidence_id::text,t.step_execution_id::text
    FROM run_agent_turn t JOIN run_step_execution s ON s.run_id=t.run_id AND s.step_execution_id=t.step_execution_id
    WHERE t.run_id=${runId}::uuid AND t.work_item_id=${row.work_item_id}::uuid AND t.status='COMPLETED'
      AND s.plan_step_id=${row.step_id} AND t.snapshot_evidence_id::text IN
        (SELECT jsonb_array_elements_text(${JSON.stringify(row.payload.supportingEvidenceIds)}::jsonb))
      AND t.response->'uncertainty'->>'kind' IN ('ambiguous','insufficient-evidence') ORDER BY t.sequence DESC LIMIT 2`);
  // Multiple matching rationales have no unique source identity. Keep the established card
  // available but do not offer a conversational confirmation for an inferred question.
  if (sources.length > 1) return null;
  const source = sources[0];
  const rationale = source && object(source.response) && object(source.response.uncertainty) ? source.response.uncertainty.rationale : undefined;
  const question = typeof rationale === 'string' && rationale.trim().length > 0 ? rationale :
    row.kind === 'choose-candidate' ? 'Which recorded candidate should be used?' : row.kind === 'unnamed-value'
      ? 'How should this unnamed captured value be handled?' : 'Retry or skip this inspection?';
  if (question.length > 2000 || detectRunConversationSecretPattern(question) !== null) return null;
  const subject = row.subject_key ?? 'Page inspection';
  if (subject.length > 512 || detectRunConversationSecretPattern(subject) !== null) return null;
  const base = { runId, waitId: row.wait_id, kind: row.kind, runRevision: row.revision,
    openedAt: row.opened_at, deadline: row.deadline, raisedEventId: row.event_id };
  const questionDigest = runConversationQuestionDigest({ ...base, options: row.options as unknown as JsonValue,
    question, subject, stepId: row.step_id, workItemId: row.work_item_id, registrationId: row.registration_id,
    supportingEvidenceIds: row.payload.supportingEvidenceIds as string[],
    source: source ? { sequence: source.sequence, snapshotEvidenceId: source.snapshot_evidence_id, stepExecutionId: source.step_execution_id } : { raisedEventId: row.event_id } });
  return { anchor: { ...base, questionDigest }, question, subject, options: row.options };
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
