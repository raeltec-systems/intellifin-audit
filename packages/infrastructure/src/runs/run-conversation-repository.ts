import { readLockedConversationQuestion } from './run-conversation-question.js';
import { createHash } from 'node:crypto';
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';

import {
  RUN_CONVERSATION_MAX_TEXT_BYTES,
  RUN_CONVERSATION_MAX_TEXT_CHARS,
  RUN_CONVERSATION_MESSAGE_KINDS,
  RUN_CONVERSATION_PAGE_SIZE,
  RUN_CONVERSATION_SCHEMA_VERSION,
  interpretRunConversationMessage,
  detectRunConversationSecretPattern,
  narrateRunConversationEvent,
  parseRunConversationMessageRequest,
  pauseRun,
  resumeRun,
  answerEscalation,
  parseRunConversationQuestionAnchor,
  resolveRunConversationAnswer,
  runConversationAnswerConsequence,
  runConversationAnswerClarification,
  type RunConversationQuestionContext,
  cancelRun,
  authorizeCommandRole,
  parseRunConversationResumeAnchor,
  type RunConversationResumeAnchor,
  acceptDeferredPause,
  parseDeferredPauseAnchor,
  type RunConversationAppendReceipt,
  type RunConversationInspectionRead,
  type RunConversationCommandReceipt,
  type RunConversationEvidenceLink,
  type RunConversationIntentKind,
  type RunConversationMessage,
  type RunConversationMessageKind,
  type RunConversationRead,
  type RunConversationReadRequest,
  type RunConversationRepository,
  type RunConversationEventContext,
} from '@intellifin/application';
import { ACTIVE_RUN_STATES, adapterLookupColumn, canonicalJson, classifyPlanTargets, authorizeActionRole, type AuditEventRecord, type ExecutablePlan, type JsonValue } from '@intellifin/domain';

import type { Database, Transaction } from '../db/client.js';
import {
  auditRun,
  auditEvents,
  authUser,
  populationRow,
  runConversationContent,
  runConversationMessage,
  runInteractionCommand,
  runInteractionTransition,
  runEvidence,
  runObservation,
  runWait,
  runWorkItem,
  runAgentWork,
} from '../db/schema.js';
import { createAuditEventWriter, CryptoUuidV7Generator } from '../db/audit-events.js';
import { isUuidText } from '../db/identifier.js';
import { DrizzleRoleRepository } from '../identity/role-repository.js';
import { DrizzleFrozenExecutionReader } from '../procedures/procedure-repository.js';
import { ConversationContentCipher } from './conversation-content.js';
import { recordReviewProjectionQuery } from './record-review-repository.js';
import { PostgresWaitRepository } from './wait-repository.js';
import { readLockedRunControlLease, runControlServerTime } from './run-control-lease-repository.js';
import { PostgresDeferredPauseRepository } from './deferred-pause-repository.js';
import { PostgresRunCancellationRepository } from './runs-unit-of-work.js';
import { matchesStopInteractionEvent, matchesResumeInteractionEvent, matchesAnswerInteractionEvent } from './run-interaction-projection.js';

const MAX_CONVERSATION_MESSAGES = 10_000;
const MAX_REQUESTS_PER_MINUTE = 20;
const MAX_SOURCE_ORDINAL = 10_000;
const MAX_LINKS = 16;
export interface PostgresRunConversationAppendInput {
  readonly actorId: string;
  readonly sessionId: string;
  readonly request: unknown;
}

interface StoredBody {
  readonly schemaVersion: typeof RUN_CONVERSATION_SCHEMA_VERSION;
  readonly text: string;
  readonly links: readonly RunConversationEvidenceLink[];
}

interface ConversationRun {
  readonly runId: string;
  readonly correlationId: string;
  readonly procedureId: string;
  readonly versionId: string;
  readonly versionNumber: number;
  readonly procedureName: string;
  readonly state: string;
  readonly revision: number;
}

interface ProjectionRow extends Record<string, unknown> {
  readonly ordinal: number;
  readonly key: string | null;
  readonly disposition: string;
  readonly duplicate: boolean;
  readonly target_id: string | null;
  readonly target_name: string;
  readonly observation_id: string | null;
  readonly work_item_id: string | null;
  readonly account: string | null;
  readonly captured_status: string | null;
  readonly found: string | null;
  readonly inspected: boolean;
  readonly exception: boolean;
  readonly pending: number;
  readonly evidence_problem: boolean;
  readonly evaluation_count: number;
  readonly unevaluated: boolean;
}

interface SelectedObservation {
  readonly observationId: string;
  readonly found: string;
  readonly coverage: string;
  readonly corroboration: string;
}

interface SelectedEvaluation {
  readonly observationId: string;
  readonly conditionId: string;
  readonly value: string;
  readonly confirmation: string | null;
}

interface ConversationFacts {
  readonly workItems: number;
  readonly selected: {
    readonly sourceOrdinal: number;
    readonly targets: readonly {
      readonly targetId: string;
      readonly targetName: string;
      readonly observationId: string | null;
      readonly found: string | null;
      readonly inspected: boolean;
      readonly account: string | null;
      readonly capturedStatus: string | null;
      readonly evaluationCount: number;
      readonly pending: number;
      readonly exception: boolean;
      readonly unevaluated: boolean;
    }[];
    readonly observations: readonly SelectedObservation[];
    readonly evaluations: readonly SelectedEvaluation[];
    readonly conditions: readonly { readonly conditionId: string; readonly text: string }[];
    readonly evidenceLinks: readonly RunConversationEvidenceLink[];
  } | null;
}

interface RunConversationMessageRow {
  readonly messageId: string;
  readonly runId: string;
  readonly sequence: number;
  readonly actorId: string;
  readonly kind: string;
  readonly createdAt: Date;
  readonly parentMessageId: string | null;
  readonly contextRevision: string | null;
  readonly sourceOrdinal: number | null;
  readonly replyToWaitId: string | null;
  readonly actorName: string | null;
  readonly ciphertext: string | null;
  readonly removedAt: Date | null;
  readonly sourceEvent: typeof auditEvents.$inferSelect | null;
}

function validClock(now: Date): Date {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new Error('Conversation clock unavailable');
  return new Date(now.getTime());
}

function validActor(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 255 && !/[\u0000-\u001f\u007f]/u.test(value);
}

function utf8Bytes(value: string): number {
  let length = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    length += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return length;
}

function validText(value: string): boolean {
  return value.trim().length > 0 && Array.from(value).length <= RUN_CONVERSATION_MAX_TEXT_CHARS && utf8Bytes(value) <= RUN_CONVERSATION_MAX_TEXT_BYTES;
}

function boundedText(value: string): string {
  const characters = Array.from(value.replace(/[\u0000-\u001f\u007f]/gu, ' '));
  while (characters.length > RUN_CONVERSATION_MAX_TEXT_CHARS || utf8Bytes(characters.join('')) > RUN_CONVERSATION_MAX_TEXT_BYTES) characters.pop();
  const result = characters.join('').trim();
  return result === '' ? 'No platform text was recorded.' : result;
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function safeLocator(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.length <= 255 && !/[\u0000-\u001f\u007f]/u.test(value));
}

function storedBody(value: string): StoredBody | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return null;
  }
  if (!plainObject(parsed) || !exactKeys(parsed, ['schemaVersion', 'text', 'links']) || parsed.schemaVersion !== RUN_CONVERSATION_SCHEMA_VERSION || typeof parsed.text !== 'string' || !validText(parsed.text) || !Array.isArray(parsed.links) || parsed.links.length > MAX_LINKS) return null;
  const links: RunConversationEvidenceLink[] = [];
  for (const item of parsed.links) {
    if (!plainObject(item) || !exactKeys(item, ['evidenceId', 'locator']) || typeof item.evidenceId !== 'string' || !isUuidText(item.evidenceId) || !safeLocator(item.locator)) return null;
    links.push({ evidenceId: item.evidenceId.toLowerCase(), locator: item.locator });
  }
  return { schemaVersion: RUN_CONVERSATION_SCHEMA_VERSION, text: parsed.text, links };
}

function bodyEnvelope(text: string, links: readonly RunConversationEvidenceLink[], platformText = true): string {
  // Auditor text has already passed the application parser's Unicode/size bounds and is
  // part of the semantic request. Preserve it byte-for-byte, including intentional
  // newlines and tabs. Only generated platform narration is sanitized here.
  const stored = platformText ? boundedText(text) : text;
  return JSON.stringify({ schemaVersion: RUN_CONVERSATION_SCHEMA_VERSION, text: stored, links: links.slice(0, MAX_LINKS) });
}

function safeFact(value: string, max = 300): string {
  // An additional conservative refusal for generated facts, not a privacy proof.
  // Test the complete value before truncation can remove a credential's label.
  if (detectRunConversationSecretPattern(value) !== null) return '[sensitive value withheld]';
  const clean = value.replace(/[\u0000-\u001f\u007f]/gu, ' ').trim();
  return Array.from(clean).slice(0, max).join('');
}

function errorRead(runId: string, status: 'denied' | 'missing' | 'unavailable', code: 'not-authorized' | 'run-not-found' | 'content-unavailable'): RunConversationRead {
  return { status, runId, messages: [], olderBefore: null, enabled: false, readAt: null, code };
}

function parseRun(row: typeof auditRun.$inferSelect): ConversationRun {
  return {
    runId: row.runId,
    correlationId: row.correlationId,
    procedureId: row.procedureId,
    versionId: row.versionId,
    versionNumber: row.versionNumber,
    procedureName: row.procedureName,
    state: row.state,
    revision: row.revision,
  };
}

function safeIntentKind(kind: RunConversationIntentKind): RunConversationIntentKind {
  return kind;
}

function kindForRequest(_kind: RunConversationIntentKind): RunConversationMessageKind {
  // Every human request is an auditor-message.  The database guard intentionally
  // permits platform replies only when their parent has exactly this kind.
  return 'auditor-message';
}

function replyText(run: ConversationRun, intent: RunConversationIntentKind, facts: ConversationFacts): string {
  const base = `Run state: ${safeFact(run.state)}. Procedure: ${safeFact(run.procedureName)} (version ${run.versionNumber}). Recorded Work Items: ${facts.workItems}.`;
  const selected = facts.selected;
  const selectedText = selected === null
    ? ''
    : ` Selected source record: ${selected.targets.length} frozen target(s), ${selected.observations.length} effective observation(s), ${selected.evidenceLinks.length} registered Evidence reference(s). Targets: ${selected.targets.map(target => {
      const captured = [target.account, target.capturedStatus].filter((value): value is string => value !== null).map(value => safeFact(value, 100)).join(', ');
      return `${safeFact(target.targetName, 120)}=${target.found ?? 'not-recorded'}${target.inspected ? ', inspected' : ', not-inspected'}${captured ? `, captured ${captured}` : ''}${target.evaluationCount > 0 ? `, ${target.evaluationCount} effective evaluation(s)` : ''}${target.pending > 0 ? `, ${target.pending} pending` : ''}${target.exception ? ', exception' : ''}${target.unevaluated ? ', unevaluated' : ''}`;
    }).join('; ') || 'none'}. Frozen conditions: ${selected.conditions.map(condition => safeFact(condition.text, 180)).join('; ') || 'none'}. Effective evaluations: ${selected.evaluations.map(evaluation => `${safeFact(evaluation.value, 40)}${evaluation.confirmation ? ` (${safeFact(evaluation.confirmation, 40)})` : ''}`).join(', ') || 'none'}.`;

  switch (intent) {
    case 'question':
      return `Read-only recorded facts. ${base}${selectedText}`;
    case 'annotation':
      return 'Annotation recorded in the Run conversation. No Run command was executed.';
    case 'pause-now':
      return `Pause outcome is not yet recorded. ${base}${selectedText}`;
    case 'resume':
      return `Use the Resume control to review and confirm restarting the paused inspection. ${base}${selectedText}`;
    case 'stop-confirmation':
      return `Use the Stop control to review and confirm stopping this Run. ${base}${selectedText}`;
    case 'deferred-pause-proposal':
      return `Pausing after the selected record is not available yet. No pause was requested. Pause now requests the next safe worker boundary. ${base}${selectedText}`;
    case 'answer-request-proposal':
      return `This conversation does not answer waits. Use the existing Escalation answer control. ${base}${selectedText}`;
    case 'strategy-proposal':
      return `The frozen plan does not declare selectable lookup strategies. No strategy was changed. ${base}${selectedText}`;
    case 'flag-proposal':
      return `Flag proposals are recorded as conversation text and do not apply a Run flag. Use the existing Flag control. ${base}${selectedText}`;
    case 'amendment':
      return `Amendments cannot change this frozen Run. Use the existing Procedure controls for a future version. ${base}${selectedText}`;
    case 'refusal':
      return `The requested action was not applied. ${base}${selectedText}`;
    case 'clarification':
      return `Please clarify within the bounded Run conversation. No Run command was executed. ${base}${selectedText}`;
  }
}

/**
 * PostgreSQL-backed Run conversation metadata and governed content.  The cipher is an
 * injected local boundary: this class never reads a key, calls a provider, or emits a
 * capability.  When it is absent the surface is disabled and no plaintext is persisted.
 */
export class PostgresRunConversationRepository implements RunConversationRepository {
  constructor(
    private readonly db: Database | Transaction,
    private readonly cipher: ConversationContentCipher | null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** A coherent current execution anchor; a selected review row cannot manufacture it. */
  async readCurrentInspection(input: { runId: string; actorId: string }): Promise<RunConversationInspectionRead> {
    const unavailable = (reason: string): RunConversationInspectionRead => ({ status: 'unavailable', reason });
    if (!isUuidText(input.runId) || !validActor(input.actorId) || this.cipher === null)
      return unavailable('Current inspection is unavailable.');
    return this.db.transaction(async tx => {
      await tx.execute(sql`SET LOCAL statement_timeout = '5s'`);
      const role = await new DrizzleRoleRepository(tx).findRole(input.actorId);
      if (!authorizeActionRole(role, 'run.initiate').allowed) return unavailable('Your role cannot read the current inspection.');
      const [run] = await tx.select().from(auditRun).where(eq(auditRun.runId, input.runId)).limit(1);
      if (!run || !['RUNNING', 'AWAITING_AUDITOR'].includes(run.state)) return unavailable('No active inspection is available for a deferred pause.');
      const plan = await new DrizzleFrozenExecutionReader(tx).readFrozenExecution(run.versionId, run.procedureId);
      if (!plan) return unavailable('The frozen inspection context is unavailable.');
      const [current] = await tx.select({
        workItemId: runWorkItem.workItemId, subjectKey: runWorkItem.subjectKey,
        registrationId: runWorkItem.registrationId, stepId: runWorkItem.stepId,
        state: runWorkItem.state, stage: runAgentWork.status,
      }).from(runAgentWork).innerJoin(runWorkItem, and(
        eq(runWorkItem.workItemId, runAgentWork.workItemId), eq(runWorkItem.runId, runAgentWork.runId),
      )).where(eq(runAgentWork.runId, input.runId)).limit(1);
      if (!current || !['EXECUTING', 'RETRY', 'WAITING'].includes(current.stage) ||
        !['IN_PROGRESS', 'AWAITING'].includes(current.state)) return unavailable('No current agent inspection is available yet.');
      const target = classifyPlanTargets(plan).agents.find(entry =>
        entry.target.registrationId === current.registrationId && entry.stepId === current.stepId);
      if (!target) return unavailable('The current inspection is not part of the frozen agent plan.');
      const key = adapterLookupColumn(plan.inputs.templateId);
      const sources = current.subjectKey === null || key === null ? [] : await tx.select({ ordinal: populationRow.ordinal })
        .from(populationRow).where(and(eq(populationRow.runId, input.runId), eq(populationRow.disposition, 'included'),
          sql`jsonb_typeof(${populationRow.values}->${key})='string' AND ${populationRow.values}->>${key}=${current.subjectKey}`)).limit(2);
      return { status: 'ready' as const,
        anchor: { workItemId: current.workItemId, subjectKey: current.subjectKey, registrationId: current.registrationId,
          runRevision: run.revision, planDigest: createHash('sha256').update(canonicalJson(plan as unknown as JsonValue)).digest('hex') },
        subjectLabel: current.subjectKey ?? 'Page inspection', targetName: target.target.displayName,
        sourceOrdinal: sources.length === 1 ? sources[0]!.ordinal : null,
        multipleTargets: plan.targetSystems.length > 1,
      };
    }, { isolationLevel: 'repeatable read' });
  }

  async read(input: RunConversationReadRequest): Promise<RunConversationRead> {
    if (!isUuidText(input.runId)) return errorRead(input.runId, 'missing', 'run-not-found');
    if (!validActor(input.actorId)) return errorRead(input.runId, 'denied', 'not-authorized');
    if (input.beforeSequence !== undefined && input.beforeSequence !== null && (!Number.isSafeInteger(input.beforeSequence) || input.beforeSequence <= 0)) {
      return errorRead(input.runId, 'unavailable', 'content-unavailable');
    }

    return this.db.transaction(async (tx) => {
      const role = await new DrizzleRoleRepository(tx).findRole(input.actorId);
      if (!authorizeActionRole(role, 'run.initiate').allowed) return errorRead(input.runId, 'denied', 'not-authorized');
      const [run] = await tx.select().from(auditRun).where(eq(auditRun.runId, input.runId)).limit(1);
      if (!run) return errorRead(input.runId, 'missing', 'run-not-found');
      const cipher = this.cipher;
      if (cipher === null) return errorRead(input.runId, 'unavailable', 'content-unavailable');

      const before = input.beforeSequence ?? null;
      const rows = await tx
        .select({
          messageId: runConversationMessage.messageId,
          runId: runConversationMessage.runId,
          sequence: runConversationMessage.sequence,
          actorId: runConversationMessage.actorId,
          kind: runConversationMessage.kind,
          createdAt: runConversationMessage.createdAt,
          parentMessageId: runConversationMessage.parentMessageId,
          contextRevision: runConversationMessage.contextRevision,
          sourceOrdinal: runConversationMessage.sourceOrdinal,
          replyToWaitId: runConversationMessage.replyToWaitId,
          actorName: authUser.name,
          ciphertext: runConversationContent.ciphertext,
          removedAt: runConversationContent.removedAt,
          sourceEvent: auditEvents,
        })
        .from(runConversationMessage)
        .leftJoin(runConversationContent, eq(runConversationContent.messageId, runConversationMessage.messageId))
        .leftJoin(authUser, eq(authUser.id, runConversationMessage.actorId))
        .leftJoin(auditEvents, and(eq(auditEvents.eventId, runConversationMessage.messageId), sql`${auditEvents.aggregateId} = ${runConversationMessage.runId}::text`, eq(auditEvents.sequence, runConversationMessage.sourceEventSequence)))
        .where(and(eq(runConversationMessage.runId, input.runId), before === null ? sql`true` : lt(runConversationMessage.sequence, before)))
        .orderBy(desc(runConversationMessage.sequence))
        .limit(51) as unknown as readonly RunConversationMessageRow[];

      const page = rows.slice(0, RUN_CONVERSATION_PAGE_SIZE);
      const olderBefore = rows.length > RUN_CONVERSATION_PAGE_SIZE ? page[page.length - 1]?.sequence ?? null : null;
      const eventContext = await this.eventContext(tx, run, page);
      const receiptParents = page.filter(row => row.kind === 'command-receipt' && row.parentMessageId !== null).map(row => row.parentMessageId!);
      const receipts = receiptParents.length === 0 ? [] : await tx.execute<{
        message_id: string; command_id: string; state: NonNullable<RunConversationMessage['command']>['state'];
        expected_run_revision: number; deferred_control_epoch: number | null; reason_code: string;
        kind: 'pause-now' | 'pause-after-inspection' | 'resume' | 'stop' | 'answer'; actor_id: string; deferred_anchor: unknown; resume_anchor: unknown; answer_anchor: unknown; answer_option_id: string | null;
        at: string; source_event_id: string | null; event_valid: boolean; intake_ciphertext: string | null; intake_removed_at: unknown;
      }>(sql`SELECT c.message_id::text,c.command_id::text,c.kind,c.actor_id,c.expected_run_revision,c.deferred_control_epoch,c.deferred_anchor,c.resume_anchor,c.answer_anchor,c.answer_option_id,t.state,t.reason_code,
        to_char(t.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at,t.source_event_id::text, intake.ciphertext AS intake_ciphertext,intake.removed_at AS intake_removed_at,
        (t.source_event_id IS NULL OR coalesce(e.aggregate_id=c.run_id::text
          AND e.payload->>'commandId'=c.command_id::text AND e.occurred_at=t.created_at AND (
            (c.kind='answer' AND t.state='applied' AND conversation_answer_receipt_valid(c,e)) OR
            (c.kind='stop' AND e.outcome='success' AND e.actor_type='human' AND e.actor_id=c.actor_id
              AND EXISTS (SELECT 1 FROM audit_run r WHERE r.run_id=c.run_id AND r.cancel_requested_command_id=c.command_id
                AND r.cancel_requested_by=e.actor_id AND r.cancel_requested_session=e.session_id
                AND r.cancel_requested_at=(e.payload->>'requestedAt')::timestamptz AND r.cancel_reason=e.payload->>'reason') AND (
              (t.state='queued' AND e.event_type='lifecycle.run-cancel-requested' AND e.source='web' AND e.payload->>'performedBy'='worker' AND e.payload->>'state'='RUNNING') OR
              (t.state='applied' AND e.event_type='lifecycle.run-canceled' AND e.source IN ('web','worker') AND e.payload->>'performedBy'=e.source AND e.payload->>'state'='CANCELED' AND ((e.source='worker' AND e.payload->>'priorState'='RUNNING') OR (e.source='web' AND e.payload->>'priorState' IN ('QUEUED','PAUSED','AWAITING_AUDITOR')))
                AND EXISTS (SELECT 1 FROM audit_run ar JOIN run_result rr ON rr.run_id=ar.run_id JOIN run_evidence_package ep ON ep.run_id=ar.run_id
                  WHERE ar.run_id=c.run_id AND ar.state='CANCELED' AND rr.run_state='CANCELED' AND rr.outcome='CANCELED' AND rr.sealed AND ep.run_state='CANCELED')))) OR
            (c.kind='resume' AND t.state='applied' AND e.event_type='lifecycle.run-resumed'
              AND e.source='web' AND e.outcome='success' AND e.actor_type='human' AND e.actor_id=c.actor_id
              AND e.payload->'waitId'=c.resume_anchor->'waitId' AND e.payload->'pausedAt'=c.resume_anchor->'pausedAt'
              AND e.payload->'deadline'=c.resume_anchor->'deadline' AND e.payload->'controlEpoch'=c.resume_anchor->'controlEpoch'
              AND e.payload->'expectedRunRevision'=to_jsonb(c.expected_run_revision) AND e.payload->'planDigest'=to_jsonb(c.plan_digest)
              AND e.payload->>'closureKind'='resume' AND e.payload->>'priorState'='PAUSED' AND e.payload->>'state'='RUNNING') OR
            (c.kind='pause-now' AND (
              (t.state='queued' AND e.event_type='lifecycle.run-pause-requested' AND e.source='web' AND e.outcome='success' AND e.actor_type='human' AND e.actor_id=c.actor_id)
              OR (t.state='applied' AND e.event_type='lifecycle.run-paused' AND e.source='worker' AND e.outcome='success' AND e.actor_type='human' AND e.actor_id=c.actor_id)
              OR (t.state='superseded' AND e.event_type='lifecycle.pause-superseded' AND e.source='worker' AND e.outcome='failure' AND e.actor_type='system' AND e.actor_id='result-sealer' AND e.payload->>'requestedBy'=c.actor_id)
            )) OR (c.kind='pause-after-inspection'
              AND e.payload->'workItemId'=c.deferred_anchor->'workItemId'
              AND e.payload ? 'subjectKey'
              AND (e.payload->'subjectKey' IS NOT DISTINCT FROM c.deferred_anchor->'subjectKey')
              AND e.payload->'registrationId'=c.deferred_anchor->'registrationId' AND (
                (t.state='queued' AND e.event_type='lifecycle.run-deferred-pause-requested' AND e.source='web' AND e.outcome='success'
                  AND e.actor_type='human' AND e.actor_id=c.actor_id AND e.payload->'expectedControlEpoch'=to_jsonb(c.deferred_control_epoch)
                  AND e.payload->'planDigest'=to_jsonb(c.plan_digest) AND e.payload->'runRevision'=to_jsonb(c.expected_run_revision))
                OR (t.state='applied' AND e.event_type='lifecycle.run-paused' AND e.source='worker' AND e.outcome='success'
                  AND e.actor_type='human' AND e.actor_id=c.actor_id AND e.payload->>'pauseMode'='after-inspection')
                OR (t.state='superseded' AND e.event_type='lifecycle.deferred-pause-superseded' AND e.source IN ('web','worker') AND e.outcome='failure'
                  AND e.actor_type='system' AND e.actor_id='deferred-pause-coordinator' AND e.payload->>'requestedBy'=c.actor_id)
              ))
          ),false)) AS event_valid
        FROM run_interaction_command c
        JOIN LATERAL (SELECT state,reason_code,created_at,source_event_id FROM run_interaction_transition
          WHERE command_id=c.command_id ORDER BY sequence DESC LIMIT 1) t ON true
        LEFT JOIN audit_events e ON e.event_id=t.source_event_id
        LEFT JOIN run_conversation_content intake ON intake.message_id=c.message_id
        WHERE c.run_id=${run.runId}::uuid AND c.kind IN ('pause-now','pause-after-inspection','resume','stop','answer')
          AND c.message_id IN (SELECT jsonb_array_elements_text(${JSON.stringify(receiptParents)}::jsonb)::uuid)`);
      const receiptPlan = receipts.some(receipt => receipt.kind === 'pause-after-inspection')
        ? await new DrizzleFrozenExecutionReader(tx).readFrozenExecution(run.versionId, run.procedureId) : null;
      // Never present an applied receipt whose authoritative source fact is missing or changed.
      if (receipts.some(receipt => !receipt.event_valid)) return errorRead(input.runId, 'unavailable', 'content-unavailable');
      const answerQuestion = receipts.some(receipt => receipt.kind === 'answer' && receipt.state === 'interpreted')
        ? await readLockedConversationQuestion(tx, run.runId, false) : null;
      const answerReadAt = Date.parse(await runControlServerTime(tx));
      const receiptFor = new Map(receipts.map(receipt => [receipt.message_id, receipt]));
      const messages: RunConversationMessage[] = [];
      for (const row of [...page].reverse()) {
        const platform = row.parentMessageId !== null || row.kind === 'platform-event';
        let body: string | null = null;
        let links: readonly RunConversationEvidenceLink[] = [];
        let contentState: RunConversationMessage['contentState'] = 'unavailable';
        const source = row.sourceEvent;
        const receipt = row.parentMessageId === null ? undefined : receiptFor.get(row.parentMessageId);
        const narration = source === null ? null : narrateRunConversationEvent({
          eventId: source.eventId,
          actor: { type: source.actorType, id: source.actorId },
          eventType: source.eventType,
          occurredAt: source.occurredAt.toISOString(),
          source: source.source,
          outcome: source.outcome,
          sessionId: source.sessionId,
          correlationId: source.correlationId,
          aggregateId: source.aggregateId,
          sequence: source.sequence,
          payload: source.payload,
          previousHash: source.previousHash,
          eventHash: source.eventHash,
        } as AuditEventRecord, eventContext);
        if (narration !== null) {
          body = narration.text;
          links = narration.evidenceRefs;
          contentState = 'available';
        } else if (row.removedAt !== null) {
          contentState = 'removed';
        } else if (row.ciphertext !== null) {
          try {
            const opened = storedBody(cipher.open(row.runId, row.messageId, row.ciphertext));
            if (opened !== null) {
              body = opened.text;
              links = opened.links;
              contentState = 'available';
            }
          } catch {
            // The DTO carries an unavailable tombstone. Ciphertext/key details never cross
            // the application boundary or enter a log.
          }
        }
        messages.push({
          schemaVersion: RUN_CONVERSATION_SCHEMA_VERSION,
          messageId: row.messageId,
          runId: row.runId,
          sequence: row.sequence,
          actorId: narration !== null && source?.actorType === 'human' ? row.actorId : platform ? null : row.actorId,
          actorName: narration !== null && source?.actorType === 'human' ? (row.actorName?.trim() || 'Unknown actor') : platform ? 'Platform' : (row.actorName?.trim() || 'Unknown actor'),
          source: narration !== null && source?.source === 'worker' ? 'worker' : platform ? 'platform' : 'auditor',
          kind: RUN_CONVERSATION_MESSAGE_KINDS.includes(row.kind as RunConversationMessageKind) ? row.kind as RunConversationMessageKind : 'security-notice',
          body,
          contentState,
          sourceOrdinal: narration?.sourceOrdinal ?? row.sourceOrdinal,
          createdAt: row.createdAt.toISOString(),
          contextRevision: row.contextRevision,
          links,
          ...(receipt === undefined ? {} : { command: { commandId: receipt.command_id, kind: receipt.kind,
            state: receipt.state, at: receipt.at, sourceEventId: receipt.source_event_id,
            ...(receipt.kind === 'answer' ? (() => {
              const anchor = parseRunConversationQuestionAnchor(receipt.answer_anchor);
              const matchesQuestion = anchor !== null && answerQuestion !== null &&
                canonicalJson(anchor as unknown as JsonValue) === canonicalJson(answerQuestion.anchor as unknown as JsonValue);
              let intakeReadable = false;
              if (receipt.intake_removed_at === null && receipt.intake_ciphertext != null) {
                try { intakeReadable = storedBody(cipher.open(run.runId, receipt.message_id, receipt.intake_ciphertext)) !== null; } catch { /* Governed content is unavailable. */ }
              }
              const reason = receipt.state === 'refused' ? 'This answer proposal was refused. Review the current decision.'
                : receipt.state !== 'interpreted' ? undefined
                : receipt.actor_id !== input.actorId ? 'Only the auditor who proposed this answer can confirm it.'
                : !authorizeActionRole(role, 'escalation.answer').allowed ? 'Your current role cannot answer this question.'
                : !intakeReadable || contentState !== 'available' ? 'The original message or answer proposal is removed or unavailable.'
                : anchor !== null && answerReadAt >= Date.parse(anchor.deadline) ? 'This question deadline has passed. Review the current decision.'
                : !matchesQuestion ? 'This question changed, was already answered, or its source context is unavailable. Review the current decision.' : undefined;
              return { ...(body !== null ? { reviewText: body } : {}), ...(anchor ? { answerAnchor: anchor } : {}),
                ...(matchesQuestion && intakeReadable && contentState === 'available' && answerQuestion ? { answerQuestion } : {}),
                ...(receipt.answer_option_id ? { answerOptionId: receipt.answer_option_id } : {}),
                canConfirm: receipt.state === 'interpreted' && reason === undefined,
                ...(reason === undefined ? {} : { reason }) };
            })() : {}),
            ...(receipt.kind === 'stop' ? (() => {
              const stale = !(ACTIVE_RUN_STATES as readonly string[]).includes(run.state) || run.cancelRequestedAt !== null || run.revision !== receipt.expected_run_revision;
              return { canConfirm: !stale && contentState === 'available' && receipt.state === 'interpreted' && receipt.actor_id === input.actorId && authorizeActionRole(role, 'run.cancel').allowed,
                ...(receipt.state === 'refused' || (receipt.state === 'interpreted' && stale) ? { reason: receipt.reason_code === 'competing-cancellation'
                  ? 'Another cancellation request owns this Run.' : receipt.reason_code === 'run-ended' ? 'This Run has already ended.'
                  : 'The Run or proposal context changed. Review the current Run before proposing Stop again.' } : {}) };
            })() : {}),
            ...(receipt.kind === 'resume' ? (() => {
              const anchor = parseRunConversationResumeAnchor(receipt.resume_anchor);
              return { ...(anchor === null ? {} : { resumeAnchor: anchor, expectedControlEpoch: anchor.controlEpoch }), canConfirm: anchor !== null &&
                contentState === 'available' && receipt.state === 'interpreted' && receipt.actor_id === input.actorId &&
                authorizeActionRole(role, 'run.resume').allowed };
            })() : {}),
            ...(receipt.kind === 'pause-after-inspection' ? (() => {
              const anchor = parseDeferredPauseAnchor(receipt.deferred_anchor);
              const target = receiptPlan?.inputs.targets.find(entry => entry.registrationId === anchor?.registrationId);
              return { ...(receipt.deferred_control_epoch === null ? {} : { expectedControlEpoch: receipt.deferred_control_epoch }), targetLabel: anchor && target ? `${anchor.subjectKey === null ? 'the page inspection' : JSON.stringify(anchor.subjectKey)} on ${target.displayName}` : undefined,
                canConfirm: anchor !== null && target !== undefined && contentState === 'available' && receipt.state === 'interpreted' &&
                  receipt.actor_id === input.actorId && authorizeActionRole(role, 'run.pause').allowed };
            })() : {}),
          } }),
        });
      }
      return {
        status: 'ready' as const,
        runId: input.runId,
        messages,
        olderBefore,
        enabled: true as const,
        readAt: validClock(this.now()).toISOString(),
      };
    }, { isolationLevel: 'repeatable read' });
  }

  private async eventContext(tx: Transaction, run: typeof auditRun.$inferSelect, page: readonly RunConversationMessageRow[]): Promise<RunConversationEventContext> {
    const workIds = new Set<string>();
    const toolIds = new Set<string>();
    const evidenceIds = new Set<string>();
    for (const row of page) {
      const payload = row.sourceEvent?.payload;
      if (!payload) continue;
      if (typeof payload.workItemId === 'string' && isUuidText(payload.workItemId)) workIds.add(payload.workItemId.toLowerCase());
      if (typeof payload.toolActionId === 'string' && isUuidText(payload.toolActionId)) toolIds.add(payload.toolActionId.toLowerCase());
      if (Array.isArray(payload.supportingEvidenceIds) && payload.supportingEvidenceIds.length <= MAX_LINKS) {
        for (const id of payload.supportingEvidenceIds) if (typeof id === 'string' && isUuidText(id)) evidenceIds.add(id.toLowerCase());
      }
    }
    if (workIds.size === 0 && toolIds.size === 0 && evidenceIds.size === 0) return {};
    const plan = await new DrizzleFrozenExecutionReader(tx).readFrozenExecution(run.versionId, run.procedureId);
    if (!plan) return {};
    const key = adapterLookupColumn(plan.inputs.templateId);
    if (!key) return {};
    const targets = classifyPlanTargets(plan);
    // Only a subject-bound work item can name one record. A table-wide P4 inspection
    // or an adapter batch is not silently attributed to the currently selected row.
    const subjectTargets = targets.agents.filter(target => plan.inputs.templateId !== 'P-4')
      .map(target => ({ id: target.target.registrationId, step: target.stepId }));
    if (subjectTargets.length === 0) return {};
    const related = await tx.execute<{ work_item_id: string; tool_action_id: string | null; evidence_id: string | null; ordinal: number }>(sql`
      WITH targets AS (SELECT value->>'id' AS id,value->>'step' AS step
        FROM jsonb_array_elements(${JSON.stringify(subjectTargets)}::jsonb)),
      evidence AS (SELECT c.evidence_id,c.tool_action_id FROM run_evidence_capture c
        WHERE c.run_id=${run.runId}::uuid
          AND c.evidence_id IN (SELECT jsonb_array_elements_text(${JSON.stringify([...evidenceIds])}::jsonb)::uuid))
      SELECT w.work_item_id::text,a.tool_action_id::text,e.evidence_id::text,min(p.ordinal)::int AS ordinal
      FROM run_work_item w
      JOIN targets t ON t.id=w.registration_id AND t.step=w.step_id
      JOIN population_row p ON p.run_id=w.run_id AND p.disposition='included'
        AND jsonb_typeof(p.values->${key})='string' AND p.values->>${key}=w.subject_key
      LEFT JOIN run_tool_action a ON a.run_id=w.run_id AND a.work_item_id=w.work_item_id
        AND a.target_system=w.registration_id
        AND (a.tool_action_id IN (SELECT jsonb_array_elements_text(${JSON.stringify([...toolIds])}::jsonb)::uuid)
          OR a.tool_action_id IN (SELECT tool_action_id FROM evidence))
      LEFT JOIN evidence e ON e.tool_action_id=a.tool_action_id
      WHERE w.run_id=${run.runId}::uuid AND length(w.subject_key)>0
        AND (w.work_item_id IN (SELECT jsonb_array_elements_text(${JSON.stringify([...workIds])}::jsonb)::uuid) OR a.tool_action_id IS NOT NULL)
      GROUP BY w.work_item_id,a.tool_action_id,e.evidence_id HAVING count(DISTINCT p.ordinal)=1`);
    const sourceOrdinalForWorkItemId = new Map<string, number>();
    const sourceOrdinalForToolActionId = new Map<string, number>();
    const sourceOrdinalForEvidenceId = new Map<string, number>();
    for (const row of related) {
      sourceOrdinalForWorkItemId.set(row.work_item_id, row.ordinal);
      if (row.tool_action_id !== null) sourceOrdinalForToolActionId.set(row.tool_action_id, row.ordinal);
      if (row.evidence_id !== null) sourceOrdinalForEvidenceId.set(row.evidence_id, row.ordinal);
    }
    return { sourceOrdinalForWorkItemId, sourceOrdinalForToolActionId, sourceOrdinalForEvidenceId };
  }

  /** Exact retained answer; no browser text is reparsed on confirmation. */
  async confirmAnswer(input: PostgresRunConversationAppendInput): Promise<RunConversationCommandReceipt> {
    const fields = input.request;
    if (!validActor(input.actorId) || !validActor(input.sessionId) || !plainObject(fields) ||
      !exactKeys(fields, ['runId', 'commandId']) || typeof fields.runId !== 'string' || !isUuidText(fields.runId) ||
      typeof fields.commandId !== 'string' || !isUuidText(fields.commandId))
      return { ok: false, code: 'malformed', reason: 'Choose a recorded answer proposal.' };
    const runId = fields.runId.toLowerCase(), commandId = fields.commandId.toLowerCase(), cipher = this.cipher;
    if (cipher === null) return { ok: false, code: 'unavailable', reason: 'Run conversation is unavailable.' };
    return this.db.transaction(async tx => {
      await tx.execute(sql`SET LOCAL lock_timeout = '250ms'`);
      await tx.execute(sql`SET LOCAL statement_timeout = '5s'`);
      const [run] = await tx.select().from(auditRun).where(eq(auditRun.runId, runId)).for('update').limit(1);
      const at = new Date(await runControlServerTime(tx));
      const roles = new DrizzleRoleRepository(tx);
      const writer = createAuditEventWriter(tx, { now: () => at }, new CryptoUuidV7Generator());
      const authorization = await authorizeCommandRole({ roles, unitOfWork: { execute: work => work({ auditEvents: writer }) } }, {
        session: { userId: input.actorId, sessionId: input.sessionId }, correlationId: run?.correlationId ?? new CryptoUuidV7Generator().next(), action: 'escalation.answer',
      });
      if (!authorization.allowed) return { ok: false, code: 'denied', reason: authorization.reason };
      if (!run) return { ok: false, code: 'run-not-found', reason: 'The Run was not found.' };
      const [command] = await tx.select().from(runInteractionCommand).where(and(
        eq(runInteractionCommand.commandId, commandId), eq(runInteractionCommand.runId, runId),
        eq(runInteractionCommand.kind, 'answer'), eq(runInteractionCommand.actorId, input.actorId))).for('update').limit(1);
      if (!command) return { ok: false, code: 'denied', reason: 'Only the auditor who proposed this answer can confirm it.' };
      const anchor = parseRunConversationQuestionAnchor(command.answerAnchor);
      if (!anchor || !command.answerOptionId) return { ok: false, code: 'unavailable', reason: 'The recorded question context is unavailable.' };
      const [prior] = await tx.select().from(runInteractionTransition).where(eq(runInteractionTransition.commandId, commandId))
        .orderBy(desc(runInteractionTransition.sequence)).limit(1);
      const [closed] = await tx.select().from(runWait).where(and(eq(runWait.runId, runId), eq(runWait.waitId, anchor.waitId))).limit(1);
      if (prior?.state === 'applied') {
        const [fact] = prior.sourceEventId === null ? [] : await tx.select().from(auditEvents).where(eq(auditEvents.eventId, prior.sourceEventId));
        if (!fact || !matchesAnswerInteractionEvent(command, { ...fact, actor: { type: fact.actorType, id: fact.actorId } }) ||
          fact.occurredAt.getTime() !== prior.createdAt.getTime() || closed?.closureKind !== 'answer' || closed.answerCommandId !== commandId || closed.actor !== command.actorId ||
          closed.answerOptionId !== command.answerOptionId || closed.closedAt?.toISOString() !== fact.payload.occurredAt ||
          closed.closedAt?.getTime() !== fact.occurredAt.getTime())
          return { ok: false, code: 'unavailable', reason: 'The authoritative answer receipt is unavailable.' };
        if (command.answerOptionId === 'abort') {
          const [sealed] = await tx.execute(sql`SELECT 1 FROM run_result WHERE run_id=${runId}::uuid AND run_state='CANCELED' AND outcome='CANCELED' AND sealed`);
          if (run.state !== 'CANCELED' || !sealed) return { ok: false, code: 'unavailable', reason: 'The sealed abort outcome is unavailable.' };
        }
        return { ok: true, commandId, state: 'applied', replayed: true };
      }
      const recorded = closed?.closedAt ? ` The question was closed as ${closed.closureKind}${closed.answerOptionId ? ` with option ${closed.answerOptionId}` : ''} at ${closed.closedAt.toISOString()}.` : '';
      if (prior?.state !== 'interpreted') return { ok: false, code: 'conflict', reason: `This answer proposal is no longer available.${recorded}` };
      const bodies = await tx.select({ messageId: runConversationMessage.messageId,
        ciphertext: runConversationContent.ciphertext, removedAt: runConversationContent.removedAt })
        .from(runConversationMessage).innerJoin(runConversationContent, eq(runConversationContent.messageId, runConversationMessage.messageId))
        .where(and(eq(runConversationMessage.runId, runId), or(eq(runConversationMessage.messageId, command.messageId),
          and(eq(runConversationMessage.parentMessageId, command.messageId), eq(runConversationMessage.kind, 'command-receipt')))))
        .orderBy(runConversationContent.messageId).limit(3).for('update', { of: runConversationContent });
      let readable = bodies.length === 2;
      for (const body of bodies) {
        try { if (body.removedAt !== null || body.ciphertext === null || storedBody(cipher.open(runId, body.messageId, body.ciphertext)) === null) readable = false; }
        catch { readable = false; }
      }
      if (!readable) return { ok: false, code: 'unavailable', reason: 'Both the message and displayed proposal must remain readable before confirmation.' };
      const question = await readLockedConversationQuestion(tx, runId);
      const plan = await new DrizzleFrozenExecutionReader(tx).readFrozenExecution(run.versionId, run.procedureId);
      const valid = question !== null && canonicalJson(question.anchor as unknown as JsonValue) === canonicalJson(anchor as unknown as JsonValue) &&
        plan !== null && createHash('sha256').update(canonicalJson(plan as unknown as JsonValue)).digest('hex') === command.planDigest &&
        at.getTime() < Date.parse(anchor.deadline) && question.options.some(o => o.id === command.answerOptionId);
      const waits = new PostgresWaitRepository(tx);
      const outcome = valid ? await answerEscalation({ roles,
        // The nested context owns the writer used by the wait handler. Sharing only its
        // authorization unit of work would leave the event clock different from closure.
        repository: { transaction: (id, work) => waits.transaction(id, context => work({ ...context, auditEvents: writer })), recoverableWaits: (...args) => waits.recoverableWaits(...args) },
        unitOfWork: { execute: work => work({ auditEvents: writer }) }, ids: new CryptoUuidV7Generator(), clock: { now: () => at },
        confirmedInteraction: { commandId, planDigest: command.planDigest, questionAnchor: anchor },
      }, { session: { userId: input.actorId, sessionId: input.sessionId }, request: {
        runId, waitId: anchor.waitId, expectedRunRevision: command.expectedRunRevision, answerOptionId: command.answerOptionId,
      } }) : { ok: false as const, reason: `The question, choices, revision or deadline changed. Start a new draft from the current question.${recorded}` };
      if (!outcome.ok) {
        await tx.insert(runInteractionTransition).values({ commandId, sequence: prior.sequence + 1, state: 'refused', reasonCode: 'question-changed', createdAt: at });
        const event = await writer.append({ actor: { type: 'human', id: input.actorId }, eventType: 'review.interaction-refused',
          source: 'web', outcome: 'failure', aggregateId: runId, correlationId: run.correlationId, sessionId: input.sessionId,
          payload: { commandId, reasonCode: 'question-changed' } });
        await tx.execute(sql`SELECT pg_notify('run_timeline', ${JSON.stringify({ runId, sequence: event.sequence })})`);
        return { ok: false, code: 'conflict', reason: outcome.reason };
      }
      const [applied] = await tx.select().from(runInteractionTransition).where(eq(runInteractionTransition.commandId, commandId)).orderBy(desc(runInteractionTransition.sequence)).limit(1);
      if (applied?.state !== 'applied' || !applied.sourceEventId) throw new Error('Answer domain receipt unavailable');
      return { ok: true, commandId, state: 'applied', replayed: false };
    });
  }

  /** Confirm only the immutable proposal; the client cannot replace its target or epoch. */
  async confirmDeferredPause(input: PostgresRunConversationAppendInput): Promise<RunConversationCommandReceipt> {
    const request = input.request;
    if (!validActor(input.actorId) || !validActor(input.sessionId) || typeof request !== 'object' || request === null || Array.isArray(request))
      return { ok: false, code: 'malformed', reason: 'Choose a recorded inspection-pause proposal.' };
    const fields = request as Record<string, unknown>;
    if (Object.keys(fields).length !== 2 || typeof fields.runId !== 'string' || typeof fields.commandId !== 'string' || !isUuidText(fields.runId) || !isUuidText(fields.commandId))
      return { ok: false, code: 'malformed', reason: 'Choose a recorded inspection-pause proposal.' };
    const runId = fields.runId.toLowerCase();
    const commandId = fields.commandId.toLowerCase();
    if (this.cipher === null) return { ok: false, code: 'unavailable', reason: 'Run conversation is unavailable.' };
    return this.db.transaction(async tx => {
      await tx.execute(sql`SET LOCAL lock_timeout = '250ms'`);
      await tx.execute(sql`SET LOCAL statement_timeout = '5s'`);
      const [run] = await tx.select().from(auditRun).where(eq(auditRun.runId, runId)).for('update').limit(1);
      const roles = new DrizzleRoleRepository(tx);
      const role = await roles.findRole(input.actorId);
      if (!authorizeActionRole(role, 'run.pause').allowed) return { ok: false, code: 'denied', reason: 'Your current role cannot request this pause.' };
      if (!run) return { ok: false, code: 'run-not-found', reason: 'The Run was not found.' };
      const [command] = await tx.select().from(runInteractionCommand).where(and(
        eq(runInteractionCommand.commandId, commandId), eq(runInteractionCommand.runId, runId),
        eq(runInteractionCommand.kind, 'pause-after-inspection'), eq(runInteractionCommand.actorId, input.actorId),
      )).for('update').limit(1);
      if (!command) return { ok: false, code: 'denied', reason: 'Only the auditor who proposed this inspection pause can confirm it.' };
      const anchor = parseDeferredPauseAnchor(command.deferredAnchor);
      if (anchor === null || command.deferredControlEpoch === null) return { ok: false, code: 'unavailable', reason: 'The recorded proposal context is unavailable.' };
      const [prior] = await tx.select().from(runInteractionTransition).where(eq(runInteractionTransition.commandId, commandId))
        .orderBy(desc(runInteractionTransition.sequence)).limit(1);
      if (prior?.state === 'queued' || prior?.state === 'applied' || prior?.state === 'superseded') {
        const [fact] = prior.sourceEventId === null ? [] : await tx.select().from(auditEvents).where(and(
          eq(auditEvents.eventId, prior.sourceEventId), eq(auditEvents.aggregateId, runId), sql`${auditEvents.payload}->>'commandId'=${commandId}`,
        )).limit(1);
        const exactTarget = fact !== undefined && fact.occurredAt.getTime() === prior.createdAt.getTime() &&
          fact.payload.workItemId === anchor.workItemId && fact.payload.subjectKey === anchor.subjectKey &&
          fact.payload.registrationId === anchor.registrationId;
        const human = fact?.actorType === 'human' && fact.actorId === command.actorId;
        const protocol = prior.state === 'queued'
          ? fact?.eventType === 'lifecycle.run-deferred-pause-requested' && fact.source === 'web' && fact.outcome === 'success' && human &&
            fact.payload.expectedControlEpoch === command.deferredControlEpoch && fact.payload.planDigest === command.planDigest &&
            fact.payload.runRevision === command.expectedRunRevision
          : prior.state === 'applied'
            ? fact?.eventType === 'lifecycle.run-paused' && fact.source === 'worker' && fact.outcome === 'success' && human && fact.payload.pauseMode === 'after-inspection'
            : fact?.eventType === 'lifecycle.deferred-pause-superseded' && ['web', 'worker'].includes(fact.source) && fact.outcome === 'failure' &&
              fact.actorType === 'system' && fact.actorId === 'deferred-pause-coordinator' && fact.payload.requestedBy === command.actorId;
        if (!exactTarget || !protocol) return { ok: false, code: 'unavailable', reason: 'The authoritative command receipt is unavailable.' };
        return { ok: true, commandId, state: prior.state, replayed: true };
      }
      if (prior?.state !== 'interpreted') return { ok: false, code: 'conflict', reason: 'This proposal is no longer available for confirmation. Read its receipt and create a new proposal if needed.' };
      // The auditor reviewed the child proposal, not only their original sentence.
      // Both governed bodies must still be readable at first acceptance; a stale modal
      // cannot confirm a removed or undecipherable proposal. Recorded retries above
      // only recover a prior outcome and never execute it again.
      const bodies = await tx.select({ messageId: runConversationMessage.messageId,
        ciphertext: runConversationContent.ciphertext, removedAt: runConversationContent.removedAt })
        .from(runConversationMessage).leftJoin(runConversationContent,
          eq(runConversationContent.messageId, runConversationMessage.messageId))
        .where(and(eq(runConversationMessage.runId, runId), or(
          eq(runConversationMessage.messageId, command.messageId),
          and(eq(runConversationMessage.parentMessageId, command.messageId), eq(runConversationMessage.kind, 'command-receipt')),
        ))).limit(3);
      let readable = bodies.length === 2;
      for (const body of bodies) {
        try {
          if (body.removedAt !== null || body.ciphertext === null ||
            storedBody(this.cipher!.open(runId, body.messageId, body.ciphertext)) === null) readable = false;
        } catch { readable = false; }
      }
      if (!readable) return { ok: false, code: 'unavailable', reason: 'The proposal content is no longer available for confirmation.' };
      const at = new Date(await runControlServerTime(tx));
      const auditEventsWriter = createAuditEventWriter(tx, { now: () => at }, new CryptoUuidV7Generator());
      const outcome = await acceptDeferredPause({ roles, repository: new PostgresDeferredPauseRepository(tx),
        unitOfWork: { execute: work => work({ auditEvents: auditEventsWriter }) }, ids: new CryptoUuidV7Generator(),
        clock: { now: () => at }, commandId,
      }, { session: { userId: input.actorId, sessionId: input.sessionId }, request: { runId, anchor, expectedControlEpoch: command.deferredControlEpoch } });
      if (!outcome.ok) {
        await tx.insert(runInteractionTransition).values({ commandId, sequence: prior.sequence + 1, state: 'refused', reasonCode: 'domain-refused', createdAt: at });
        const refusal = await auditEventsWriter.append({ actor: { type: 'human', id: input.actorId },
          eventType: 'review.interaction-refused', source: 'web', outcome: 'failure', aggregateId: runId,
          correlationId: run.correlationId, sessionId: input.sessionId, payload: { commandId, reasonCode: 'domain-refused' } });
        await tx.execute(sql`SELECT pg_notify('run_timeline', ${JSON.stringify({ runId, sequence: refusal.sequence })})`);
        return { ok: false, code: 'conflict', reason: outcome.reason };
      }
      const [queued] = await tx.select({ state: runInteractionTransition.state }).from(runInteractionTransition)
        .where(eq(runInteractionTransition.commandId, commandId)).orderBy(desc(runInteractionTransition.sequence)).limit(1);
      if (queued?.state !== 'queued') throw new Error('Deferred pause domain receipt unavailable');
      return { ok: true, commandId, state: 'queued', replayed: false };
    });
  }

  /** A retry names the same retained proposal and can only recover its own effect. */
  async confirmResume(input: PostgresRunConversationAppendInput): Promise<RunConversationCommandReceipt> {
    const fields = input.request;
    if (!validActor(input.actorId) || !validActor(input.sessionId) || !plainObject(fields) ||
      !exactKeys(fields, ['runId', 'commandId']) || typeof fields.runId !== 'string' || !isUuidText(fields.runId) ||
      typeof fields.commandId !== 'string' || !isUuidText(fields.commandId))
      return { ok: false, code: 'malformed', reason: 'Choose a recorded Resume proposal.' };
    const runId = fields.runId.toLowerCase();
    const commandId = fields.commandId.toLowerCase();
    const cipher = this.cipher;
    if (cipher === null) return { ok: false, code: 'unavailable', reason: 'Run conversation is unavailable.' };
    return this.db.transaction(async tx => {
      await tx.execute(sql`SET LOCAL lock_timeout = '250ms'`);
      await tx.execute(sql`SET LOCAL statement_timeout = '5s'`);
      const [run] = await tx.select().from(auditRun).where(eq(auditRun.runId, runId)).for('update').limit(1);
      const roles = new DrizzleRoleRepository(tx);
      if (!authorizeActionRole(await roles.findRole(input.actorId), 'run.resume').allowed)
        return { ok: false, code: 'denied', reason: 'Your current role cannot resume this Run.' };
      if (!run) return { ok: false, code: 'run-not-found', reason: 'The Run was not found.' };
      const [command] = await tx.select().from(runInteractionCommand).where(and(
        eq(runInteractionCommand.commandId, commandId), eq(runInteractionCommand.runId, runId),
        eq(runInteractionCommand.kind, 'resume'), eq(runInteractionCommand.actorId, input.actorId),
      )).for('update').limit(1);
      if (!command) return { ok: false, code: 'denied', reason: 'Only the auditor who proposed this Resume can confirm it.' };
      const anchor = parseRunConversationResumeAnchor(command.resumeAnchor);
      if (anchor === null) return { ok: false, code: 'unavailable', reason: 'The recorded Resume context is unavailable.' };
      const [prior] = await tx.select().from(runInteractionTransition).where(eq(runInteractionTransition.commandId, commandId))
        .orderBy(desc(runInteractionTransition.sequence)).limit(1);
      if (prior?.state === 'applied') {
        const [fact] = prior.sourceEventId === null ? [] : await tx.select().from(auditEvents)
          .where(eq(auditEvents.eventId, prior.sourceEventId)).limit(1);
        if (!fact || fact.actorType !== 'human' || fact.occurredAt.getTime() !== prior.createdAt.getTime() ||
          !matchesResumeInteractionEvent(command, { ...fact, actor: { type: 'human', id: fact.actorId } }))
          return { ok: false, code: 'unavailable', reason: 'The authoritative Resume receipt is unavailable.' };
        return { ok: true, commandId, state: 'applied', replayed: true };
      }
      if (prior?.state !== 'interpreted')
        return { ok: false, code: 'conflict', reason: 'This Resume proposal is no longer available. Read its receipt and review the current pause.' };
      const bodies = await tx.select({ messageId: runConversationMessage.messageId,
        ciphertext: runConversationContent.ciphertext, removedAt: runConversationContent.removedAt })
        .from(runConversationMessage).leftJoin(runConversationContent, eq(runConversationContent.messageId, runConversationMessage.messageId))
        .where(and(eq(runConversationMessage.runId, runId), or(eq(runConversationMessage.messageId, command.messageId),
          and(eq(runConversationMessage.parentMessageId, command.messageId), eq(runConversationMessage.kind, 'command-receipt'))))).limit(3);
      let readable = bodies.length === 2;
      for (const body of bodies) {
        try {
          if (body.removedAt !== null || body.ciphertext === null || storedBody(cipher.open(runId, body.messageId, body.ciphertext)) === null)
            readable = false;
        } catch { readable = false; }
      }
      if (!readable) return { ok: false, code: 'unavailable', reason: 'The proposal content is no longer available for confirmation.' };
      const at = new Date(await runControlServerTime(tx));
      const auditEventsWriter = createAuditEventWriter(tx, { now: () => at }, new CryptoUuidV7Generator());
      const plan = await new DrizzleFrozenExecutionReader(tx).readFrozenExecution(run.versionId, run.procedureId);
      const validPlan = plan !== null && createHash('sha256').update(canonicalJson(plan as unknown as JsonValue)).digest('hex') === command.planDigest;
      const outcome = validPlan ? await resumeRun({ roles, repository: new PostgresWaitRepository(tx),
        unitOfWork: { execute: work => work({ auditEvents: auditEventsWriter }) },
        ids: new CryptoUuidV7Generator(), clock: { now: () => at }, requireControllerLease: true,
        confirmedInteraction: { commandId, planDigest: command.planDigest, waitId: anchor.waitId,
          pausedAt: anchor.pausedAt, deadline: anchor.deadline },
      }, { session: { userId: input.actorId, sessionId: input.sessionId }, request: {
        runId, expectedRunRevision: command.expectedRunRevision, expectedControlEpoch: anchor.controlEpoch,
      } }) : { ok: false as const, reason: 'The frozen plan no longer matches this Resume proposal.' };
      if (!outcome.ok) {
        await tx.insert(runInteractionTransition).values({ commandId, sequence: prior.sequence + 1,
          state: 'refused', reasonCode: 'domain-refused', createdAt: at });
        const refusal = await auditEventsWriter.append({ actor: { type: 'human', id: input.actorId },
          eventType: 'review.interaction-refused', source: 'web', outcome: 'failure', aggregateId: runId,
          correlationId: run.correlationId, sessionId: input.sessionId, payload: { commandId, reasonCode: 'domain-refused' } });
        await tx.execute(sql`SELECT pg_notify('run_timeline', ${JSON.stringify({ runId, sequence: refusal.sequence })})`);
        return { ok: false, code: 'conflict', reason: outcome.reason };
      }
      const [applied] = await tx.select().from(runInteractionTransition).where(eq(runInteractionTransition.commandId, commandId))
        .orderBy(desc(runInteractionTransition.sequence)).limit(1);
      if (applied?.state !== 'applied' || applied.sourceEventId === null) throw new Error('Resume domain receipt unavailable');
      return { ok: true, commandId, state: 'applied', replayed: false };
    });
  }

  /** A retry names the same retained proposal and can only recover its own effect. */
  async confirmStop(input: PostgresRunConversationAppendInput): Promise<RunConversationCommandReceipt> {
    const fields = input.request;
    if (!validActor(input.actorId) || !validActor(input.sessionId) || !plainObject(fields) ||
      !exactKeys(fields, ['runId', 'commandId']) || typeof fields.runId !== 'string' || !isUuidText(fields.runId) ||
      typeof fields.commandId !== 'string' || !isUuidText(fields.commandId))
      return { ok: false, code: 'malformed', reason: 'Choose a recorded Stop proposal.' };
    const runId = fields.runId.toLowerCase();
    const commandId = fields.commandId.toLowerCase();
    const cipher = this.cipher;
    if (cipher === null) return { ok: false, code: 'unavailable', reason: 'Run conversation is unavailable.' };
    return this.db.transaction(async tx => {
      await tx.execute(sql`SET LOCAL lock_timeout = '250ms'`);
      await tx.execute(sql`SET LOCAL statement_timeout = '5s'`);
      const [run] = await tx.select().from(auditRun).where(eq(auditRun.runId, runId)).for('update').limit(1);
      const roles = new DrizzleRoleRepository(tx);
      const at = new Date(await runControlServerTime(tx));
      const auditEventsWriter = createAuditEventWriter(tx, { now: () => at }, new CryptoUuidV7Generator());
      const permission = await authorizeCommandRole({ roles, unitOfWork: { execute: work => work({ auditEvents: auditEventsWriter }) } },
        { session: { userId: input.actorId, sessionId: input.sessionId }, action: 'run.cancel', correlationId: run?.correlationId ?? new CryptoUuidV7Generator().next() });
      if (!permission.allowed) return { ok: false, code: 'denied', reason: permission.reason };
      if (!run) return { ok: false, code: 'run-not-found', reason: 'The Run was not found.' };
      const [command] = await tx.select().from(runInteractionCommand).where(and(
        eq(runInteractionCommand.commandId, commandId), eq(runInteractionCommand.runId, runId),
        eq(runInteractionCommand.kind, 'stop'), eq(runInteractionCommand.actorId, input.actorId),
      )).for('update').limit(1);
      if (!command) return { ok: false, code: 'denied', reason: 'Only the auditor who proposed this Stop can confirm it.' };
      const [prior] = await tx.select().from(runInteractionTransition).where(eq(runInteractionTransition.commandId, commandId))
        .orderBy(desc(runInteractionTransition.sequence)).limit(1);
      if (prior?.state === 'applied' || prior?.state === 'queued') {
        const [fact] = prior.sourceEventId === null ? [] : await tx.select().from(auditEvents)
          .where(eq(auditEvents.eventId, prior.sourceEventId)).limit(1);
        if (!fact || fact.actorType !== 'human' || fact.occurredAt.getTime() !== prior.createdAt.getTime() ||
          !matchesStopInteractionEvent(command, { ...fact, actor: { type: 'human', id: fact.actorId } }, prior.state) ||
          run.cancelRequestedCommandId !== commandId || run.cancelRequestedBy !== command.actorId ||
          run.cancelRequestedSession !== fact.sessionId || run.cancelRequestedAt?.toISOString() !== fact.payload.requestedAt ||
          run.cancelReason !== fact.payload.reason)
          return { ok: false, code: 'unavailable', reason: 'The authoritative Stop receipt is unavailable.' };
        if (prior.state === 'applied') {
          const [sealed] = await tx.execute(sql`SELECT 1 FROM run_result rr JOIN run_evidence_package ep ON ep.run_id=rr.run_id
            WHERE rr.run_id=${runId}::uuid AND rr.run_state='CANCELED' AND rr.outcome='CANCELED' AND rr.sealed AND ep.run_state='CANCELED'`);
          if (run.state !== 'CANCELED' || !sealed) return { ok: false, code: 'unavailable', reason: 'The sealed cancellation outcome is unavailable.' };
        }
        return { ok: true, commandId, state: prior.state, replayed: true };
      }
      if (prior?.state !== 'interpreted')
        return { ok: false, code: 'conflict', reason: 'This Stop proposal is no longer available. Read its receipt and review the current Run.' };
      const bodies = await tx.select({ messageId: runConversationMessage.messageId,
        ciphertext: runConversationContent.ciphertext, removedAt: runConversationContent.removedAt })
        .from(runConversationMessage).innerJoin(runConversationContent, eq(runConversationContent.messageId, runConversationMessage.messageId))
        .where(and(eq(runConversationMessage.runId, runId), or(eq(runConversationMessage.messageId, command.messageId),
          and(eq(runConversationMessage.parentMessageId, command.messageId), eq(runConversationMessage.kind, 'command-receipt'))))).orderBy(runConversationContent.messageId).limit(3).for('update', { of: runConversationContent });
      let readable = bodies.length === 2;
      for (const body of bodies) {
        try {
          if (body.removedAt !== null || body.ciphertext === null || storedBody(cipher.open(runId, body.messageId, body.ciphertext)) === null)
            readable = false;
        } catch { readable = false; }
      }
      if (!readable) return { ok: false, code: 'unavailable', reason: 'The proposal content is no longer available for confirmation.' };

      const plan = await new DrizzleFrozenExecutionReader(tx).readFrozenExecution(run.versionId, run.procedureId);
      const validPlan = plan !== null && createHash('sha256').update(canonicalJson(plan as unknown as JsonValue)).digest('hex') === command.planDigest;
      const refusalCode = !(ACTIVE_RUN_STATES as readonly string[]).includes(run.state) ? 'run-ended'
        : run.cancelRequestedAt !== null ? 'competing-cancellation' : !validPlan || run.revision !== command.expectedRunRevision ? 'stale-context' : 'domain-refused';
      const outcome = !validPlan || run.revision !== command.expectedRunRevision
        ? { ok: false as const, reason: 'The Run or frozen plan changed. Review a fresh Stop proposal.' }
        : await cancelRun({ roles, repository: new PostgresRunCancellationRepository(tx, { clock: { now: () => at } }),
          unitOfWork: { execute: work => work({ auditEvents: auditEventsWriter }) },
          ids: new CryptoUuidV7Generator(), clock: { now: () => at }, commandId,
        }, { session: { userId: input.actorId, sessionId: input.sessionId }, request: { runId, reason: null } });
      if (!outcome.ok) {
        await tx.insert(runInteractionTransition).values({ commandId, sequence: prior.sequence + 1,
          state: 'refused', reasonCode: refusalCode, createdAt: at });
        const refusal = await auditEventsWriter.append({ actor: { type: 'human', id: input.actorId },
          eventType: 'review.interaction-refused', source: 'web', outcome: 'failure', aggregateId: runId,
          correlationId: run.correlationId, sessionId: input.sessionId, payload: { commandId, reasonCode: refusalCode } });
        await tx.execute(sql`SELECT pg_notify('run_timeline', ${JSON.stringify({ runId, sequence: refusal.sequence })})`);
        return { ok: false, code: 'conflict', reason: outcome.reason };
      }
      const [applied] = await tx.select().from(runInteractionTransition).where(eq(runInteractionTransition.commandId, commandId))
        .orderBy(desc(runInteractionTransition.sequence)).limit(1);
      if (!applied || !['queued', 'applied'].includes(applied.state) || applied.sourceEventId === null) throw new Error('Stop domain receipt unavailable');
      return { ok: true, commandId, state: applied.state as 'queued' | 'applied', replayed: false };
    });
  }

  async append(input: PostgresRunConversationAppendInput): Promise<RunConversationAppendReceipt> {
    if (!validActor(input.actorId) || !validActor(input.sessionId)) return { ok: false, code: 'malformed', reason: 'The conversation identity was not valid.' };
    const parsed = parseRunConversationMessageRequest(input.request);
    if (!parsed.ok) return { ok: false, code: 'malformed', reason: parsed.reason };
    const cipher = this.cipher;
    if (cipher === null) return { ok: false, code: 'unavailable', deliveryStatus: 'definite', reason: 'Run conversation content is unavailable.' };
    const interpretation = interpretRunConversationMessage(parsed.value);
    if (!['pause-now', 'stop-confirmation'].includes(interpretation.intent.kind) && parsed.value.selectedSourceOrdinal !== null && parsed.value.selectedSourceOrdinal > MAX_SOURCE_ORDINAL) return { ok: false, code: 'malformed', reason: 'The selected source ordinal is outside the bounded Run surface.' };
    const at = validClock(this.now());
    const semanticInput = JSON.stringify(['pause-now', 'stop-confirmation'].includes(interpretation.intent.kind) ? {
      schemaVersion: RUN_CONVERSATION_SCHEMA_VERSION,
      runId: parsed.value.runId,
      actorId: input.actorId,
      operation: interpretation.intent.kind,
    } : {
      schemaVersion: RUN_CONVERSATION_SCHEMA_VERSION,
      runId: parsed.value.runId,
      actorId: input.actorId,
      text: parsed.value.text.trim(),
      selectedSourceOrdinal: parsed.value.selectedSourceOrdinal,
      replyToWaitId: parsed.value.replyToWaitId,
      ...(parsed.value.questionAnchor == null ? {} : { questionAnchor: parsed.value.questionAnchor }),
      ...(interpretation.intent.kind === 'deferred-pause-proposal' ? { currentInspection: parsed.value.currentInspection ?? null } : {}),
    });
    const semanticFingerprint = cipher.fingerprint(semanticInput);

    return this.db.transaction(async (tx) => {
      // Conversation writes are deliberately short and local.  A waiting browser or
      // a blocked Run-control transaction must never hold these locks indefinitely.
      await tx.execute(sql`SET LOCAL lock_timeout = '250ms'`);
      await tx.execute(sql`SET LOCAL statement_timeout = '5s'`);
      // Serialize the per-actor limiter across Runs. All work under this lock remains
      // local PostgreSQL or local crypto; no provider, queue or object-store I/O occurs.
      const safetyShortcut = ['pause-now', 'stop-confirmation'].includes(interpretation.intent.kind);
      // Exact unqualified pause targets the Run. A stale review selection must not
      // retarget it. An explicit wait reply is separately classified as clarification.
      const sourceOrdinal = safetyShortcut ? null : parsed.value.selectedSourceOrdinal;
      const replyToWaitId = safetyShortcut ? null : parsed.value.replyToWaitId;
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${safetyShortcut ? 'run-conversation-safety' : 'run-conversation-actor'}:${input.actorId}`}, 0))`);
      const role = await new DrizzleRoleRepository(tx).findRole(input.actorId);
      if (!authorizeActionRole(role, 'run.initiate').allowed) return { ok: false, code: 'denied', reason: 'Your role does not permit this action.' };
      const [runRow] = await tx.select().from(auditRun).where(eq(auditRun.runId, parsed.value.runId)).for('update').limit(1);
      if (!runRow) return { ok: false, code: 'run-not-found', reason: 'The Run was not found.' };
      if (!authorizeActionRole(await new DrizzleRoleRepository(tx).findRole(input.actorId), 'run.initiate').allowed)
        return { ok: false, code: 'denied', reason: 'Your current role does not permit this action.' };
      const run = parseRun(runRow);
      const admittedAt = new Date(await runControlServerTime(tx));

      const [prior] = await tx.select({ messageId: runConversationMessage.messageId, sequence: runConversationMessage.sequence, semanticFingerprint: runConversationMessage.semanticFingerprint })
        .from(runConversationMessage)
        .where(and(eq(runConversationMessage.runId, run.runId), eq(runConversationMessage.actorId, input.actorId), eq(runConversationMessage.requestKey, parsed.value.idempotencyKey)))
        .limit(1);
      if (prior) {
        // Replay lookup deliberately precedes context validation. A retry must return
        // its original receipt even if a referenced wait has since been closed.
        return prior.semanticFingerprint === semanticFingerprint
          ? { ok: true, messageId: prior.messageId, sequence: prior.sequence, replayed: true }
          : { ok: false, code: 'conflict', reason: 'That idempotency key is already bound to another message.' };
      }

      if (sourceOrdinal !== null) {
        const [source] = await tx.select({ ordinal: populationRow.ordinal })
          .from(populationRow)
          .where(and(eq(populationRow.runId, run.runId), eq(populationRow.ordinal, sourceOrdinal)))
          .limit(1);
        if (!source) return { ok: false, code: 'malformed', reason: 'The selected source record is not part of this Run.' };
      }
      if (replyToWaitId !== null) {
        const [wait] = await tx.select({ waitId: runWait.waitId })
          .from(runWait)
          .where(and(eq(runWait.waitId, replyToWaitId), eq(runWait.runId, run.runId), isNull(runWait.closedAt)))
          .limit(1);
        if (!wait) return { ok: false, code: 'malformed', reason: 'The referenced wait is not open on this Run.' };
      }

      const windowStart = new Date(at.getTime() - 60_000);
      const [rate] = await tx.select({ count: sql<number>`count(*)::int` }).from(runConversationMessage)
        .where(and(eq(runConversationMessage.actorId, input.actorId), isNotNull(runConversationMessage.requestKey), gte(runConversationMessage.createdAt, windowStart),
          safetyShortcut ? sql`EXISTS (SELECT 1 FROM ${runInteractionCommand} c WHERE c.message_id=${runConversationMessage.messageId} AND c.kind IN ('pause-now','stop'))` : sql`NOT EXISTS (SELECT 1 FROM ${runInteractionCommand} c WHERE c.message_id=${runConversationMessage.messageId} AND c.kind IN ('pause-now','stop'))`));
      if ((rate?.count ?? 0) >= MAX_REQUESTS_PER_MINUTE) return { ok: false, code: 'unavailable', deliveryStatus: 'definite', reason: 'The conversation rate limit was reached. Try again shortly.' };

      if (!safetyShortcut) {
        const [total] = await tx.select({ count: sql<number>`count(*)::int` }).from(runConversationMessage)
          .where(and(eq(runConversationMessage.runId, run.runId), or(isNotNull(runConversationMessage.requestKey), isNotNull(runConversationMessage.parentMessageId))));
        if ((total?.count ?? 0) + 2 > MAX_CONVERSATION_MESSAGES) return { ok: false, code: 'unavailable', deliveryStatus: 'definite', reason: 'The Run conversation has reached its bounded message limit.' };
      }
      const [position] = await tx.select({ sequence: sql<number>`coalesce(max(${runConversationMessage.sequence}), 0)::int` })
        .from(runConversationMessage).where(eq(runConversationMessage.runId, run.runId));
      const requiredPositions = interpretation.intent.kind === 'pause-now' ? 3 : 2;
      if ((position?.sequence ?? 0) + requiredPositions > 1_000_000) return { ok: false, code: 'unavailable', deliveryStatus: 'definite', reason: 'The Run conversation has reached its history limit. Execution history remains available in Run details.' };

      const plan = await new DrizzleFrozenExecutionReader(tx).readFrozenExecution(run.versionId, run.procedureId);
      if (!plan) return { ok: false, code: 'unavailable', deliveryStatus: 'definite', reason: 'The frozen Run context is unavailable.' };
      const deferredAnchor = interpretation.intent.kind === 'deferred-pause-proposal' ? parsed.value.currentInspection ?? null : null;
      let deferredTargetLabel: string | null = null;
      let deferredControlEpoch: number | null = null;
      if (interpretation.intent.kind === 'deferred-pause-proposal') {
        if (deferredAnchor === null) return { ok: false, code: 'conflict', reason: 'No current inspection was captured for this draft. Clear the draft and start again from the current workspace.' };
        const currentRole = await new DrizzleRoleRepository(tx).findRole(input.actorId);
        if (!authorizeActionRole(currentRole, 'run.pause').allowed) return { ok: false, code: 'denied', reason: 'Your current role cannot request this pause.' };
        const control = await readLockedRunControlLease(tx, run.runId);
        const serverNow = Date.parse(await runControlServerTime(tx));
        if (!control || control.holderId !== input.actorId || control.expiresAt === null || Date.parse(control.expiresAt) <= serverNow)
          return { ok: false, code: 'denied', reason: 'Acquire control before proposing a pause after the current inspection.' };
        deferredControlEpoch = control.epoch;
        const digest = createHash('sha256').update(canonicalJson(plan as unknown as JsonValue)).digest('hex');
        const [current] = await tx.select({ workItemId: runWorkItem.workItemId, subjectKey: runWorkItem.subjectKey,
          registrationId: runWorkItem.registrationId, stepId: runWorkItem.stepId, state: runWorkItem.state,
          stage: runAgentWork.status }).from(runAgentWork).innerJoin(runWorkItem, and(
            eq(runAgentWork.workItemId, runWorkItem.workItemId), eq(runAgentWork.runId, runWorkItem.runId),
          )).where(eq(runAgentWork.runId, run.runId)).limit(1);
        const target = current && classifyPlanTargets(plan).agents.find(entry => entry.stepId === current.stepId && entry.target.registrationId === current.registrationId);
        if (!current || !target || !['RUNNING', 'AWAITING_AUDITOR'].includes(run.state) ||
          !['EXECUTING', 'RETRY', 'WAITING'].includes(current.stage) || !['IN_PROGRESS', 'AWAITING'].includes(current.state) ||
          current.workItemId !== deferredAnchor.workItemId || current.subjectKey !== deferredAnchor.subjectKey ||
          current.registrationId !== deferredAnchor.registrationId || run.revision !== deferredAnchor.runRevision || digest !== deferredAnchor.planDigest)
          return { ok: false, code: 'conflict', reason: 'The inspection changed while you were composing. No pause was requested. Clear the draft and review the current inspection.' };
        if (deferredAnchor.subjectKey === null && !/pause after this inspection[.!?]*$/i.test(parsed.value.text.trim()))
          return { ok: false, code: 'conflict', reason: 'The current unit is a page inspection, not one source record. Use “pause after this inspection” to name that boundary.' };
        deferredTargetLabel = `${deferredAnchor.subjectKey === null ? 'the page inspection' : JSON.stringify(deferredAnchor.subjectKey)} on ${safeFact(target.target.displayName, 120)}`;
      }
      let answerQuestion: RunConversationQuestionContext | null = null;
      let answerOption: { readonly id: string; readonly label: string } | null = null;
      if (interpretation.intent.kind === 'answer-request-proposal') {
        if (!authorizeActionRole(await new DrizzleRoleRepository(tx).findRole(input.actorId), 'escalation.answer').allowed)
          return { ok: false, code: 'denied', reason: 'Your current role cannot answer this question.' };
        answerQuestion = await readLockedConversationQuestion(tx, run.runId);
        if (!parsed.value.questionAnchor || !answerQuestion ||
          canonicalJson(parsed.value.questionAnchor as unknown as JsonValue) !== canonicalJson(answerQuestion.anchor as unknown as JsonValue) ||
          Date.parse(answerQuestion.anchor.deadline) <= admittedAt.getTime())
          return { ok: false, code: 'conflict', reason: 'The question changed or expired while you were composing. Start a new draft from the current question.' };
        answerOption = resolveRunConversationAnswer(parsed.value.text, answerQuestion.options);
      }
      const stopProposal = interpretation.intent.kind === 'stop-confirmation';
      if (stopProposal) {
        if (!authorizeActionRole(await new DrizzleRoleRepository(tx).findRole(input.actorId), 'run.cancel').allowed)
          return { ok: false, code: 'denied', reason: 'Your current role cannot stop this Run.' };
        if (!(ACTIVE_RUN_STATES as readonly string[]).includes(run.state) || runRow.cancelRequestedAt !== null)
          return { ok: false, code: 'conflict', reason: 'The Run already ended or has a cancellation request. Read the current Run state.' };
      }
      let resumeAnchor: RunConversationResumeAnchor | null = null;
      if (interpretation.intent.kind === 'resume') {
        const currentRole = await new DrizzleRoleRepository(tx).findRole(input.actorId);
        if (!authorizeActionRole(currentRole, 'run.resume').allowed)
          return { ok: false, code: 'denied', reason: 'Your current role cannot resume this Run.' };
        const control = await readLockedRunControlLease(tx, run.runId);
        const serverNow = Date.parse(await runControlServerTime(tx));
        if (!control || control.holderId !== input.actorId || control.expiresAt === null || Date.parse(control.expiresAt) <= serverNow)
          return { ok: false, code: 'denied', reason: 'Acquire control before proposing Resume.' };
        const [wait] = await tx.select().from(runWait).where(and(eq(runWait.runId, run.runId),
          eq(runWait.kind, 'pause'), isNull(runWait.closedAt))).limit(1);
        if (run.state !== 'PAUSED' || !wait || wait.deadline.getTime() <= serverNow)
          return { ok: false, code: 'conflict', reason: 'There is no current, unexpired pause to resume. Read the current Run state.' };
        resumeAnchor = { waitId: wait.waitId, pausedAt: wait.openedAt.toISOString(),
          deadline: wait.deadline.toISOString(), controlEpoch: control.epoch };
      }
      const facts = safetyShortcut ? null : await this.facts(tx, run, plan, sourceOrdinal);
      if (!safetyShortcut && facts === null) return { ok: false, code: 'malformed', reason: 'The selected source record is not available in this Run.' };
      let replyBody = facts === null ? bodyEnvelope('Pause request awaiting the domain decision.', [])
        : bodyEnvelope(replyText(run, safeIntentKind(interpretation.intent.kind), facts), facts.selected?.evidenceLinks ?? []);
      const messageId = new CryptoUuidV7Generator().next();
      const replyMessageId = new CryptoUuidV7Generator().next();
      const event = await createAuditEventWriter(tx, { now: () => at }, new CryptoUuidV7Generator()).append({
        actor: { type: 'human', id: input.actorId },
        eventType: 'review.conversation-received',
        source: 'web',
        outcome: 'success',
        sessionId: input.sessionId,
        correlationId: run.correlationId,
        aggregateId: run.runId,
        payload: {
          messageId,
          replyMessageId,
          intent: interpretation.intent.kind,
          ...(answerQuestion !== null && answerOption !== null ? { questionAnchor: { ...answerQuestion.anchor }, answerOptionId: answerOption.id } : {}),
          sourceOrdinal: sourceOrdinal,
          semanticFingerprint,
        },
      });
      const [last] = await tx.select({ sequence: sql<number>`coalesce(max(${runConversationMessage.sequence}), 0)::int` }).from(runConversationMessage).where(eq(runConversationMessage.runId, run.runId));
      const messageSequence = (last?.sequence ?? 0) + 1;
      const contextRevision = await this.contextRevision(tx, run.runId, run.revision);
      await tx.insert(runConversationMessage).values({
        messageId,
        runId: run.runId,
        sequence: messageSequence,
        actorId: input.actorId,
        kind: kindForRequest(interpretation.intent.kind),
        createdAt: at,
        parentMessageId: null,
        requestKey: parsed.value.idempotencyKey,
        semanticFingerprint,
        contextRevision,
        sourceOrdinal: sourceOrdinal,
        replyToWaitId: replyToWaitId,
        sourceEventSequence: event.sequence,
      });
      if (interpretation.intent.kind === 'pause-now') {
        const commandId = new CryptoUuidV7Generator().next();
        await tx.insert(runInteractionCommand).values({ commandId, runId: run.runId, messageId,
          actorId: input.actorId, kind: 'pause-now', requestKey: parsed.value.idempotencyKey,
          semanticFingerprint, planDigest: createHash('sha256').update(canonicalJson(plan as unknown as JsonValue)).digest('hex'),
          expectedRunRevision: run.revision, interpretationVersion: 'exact-safety-v1', createdAt: at });
        await tx.insert(runInteractionTransition).values({ commandId, sequence: 1, state: 'received', reasonCode: 'intake-persisted', createdAt: at });
        await tx.insert(runInteractionTransition).values({ commandId, sequence: 2, state: 'interpreted', reasonCode: 'exact-pause-now', createdAt: at });
        const auditEvents = createAuditEventWriter(tx, { now: () => at }, new CryptoUuidV7Generator());
        const outcome = await pauseRun({
          commandId, roles: new DrizzleRoleRepository(tx), repository: new PostgresWaitRepository(tx),
          unitOfWork: { execute: work => work({ auditEvents }) },
          ids: new CryptoUuidV7Generator(), clock: { now: () => at },
        }, { session: { userId: input.actorId, sessionId: input.sessionId }, request: { runId: run.runId } });
        if (!outcome.ok) {
          await tx.insert(runInteractionTransition).values({ commandId, sequence: 3, state: 'refused', reasonCode: 'domain-refused', createdAt: at });
        } else {
          const [queued] = await tx.select({ state: runInteractionTransition.state }).from(runInteractionTransition)
            .where(eq(runInteractionTransition.commandId, commandId)).orderBy(desc(runInteractionTransition.sequence)).limit(1);
          if (queued?.state !== 'queued') throw new Error('Pause domain receipt unavailable');
        }
        replyBody = bodyEnvelope(outcome.ok
          ? 'Pause requested. Execution is still running until the worker reaches its next safe boundary.'
          : `Pause was not requested. ${outcome.reason}`, []);
      }
      if (deferredAnchor !== null && deferredTargetLabel !== null) {
        const commandId = new CryptoUuidV7Generator().next();
        await tx.insert(runInteractionCommand).values({ commandId, runId: run.runId, messageId,
          actorId: input.actorId, kind: 'pause-after-inspection', requestKey: parsed.value.idempotencyKey,
          semanticFingerprint, planDigest: deferredAnchor.planDigest, expectedRunRevision: deferredAnchor.runRevision,
          interpretationVersion: 'confirmed-inspection-v1', deferredAnchor, deferredControlEpoch, createdAt: at });
        await tx.insert(runInteractionTransition).values([
          { commandId, sequence: 1, state: 'received', reasonCode: 'intake-persisted', createdAt: at },
          { commandId, sequence: 2, state: 'interpreted', reasonCode: 'inspection-confirmation-required', createdAt: at },
        ]);
        replyBody = bodyEnvelope(`Review a pause after ${deferredTargetLabel}. Only this target's inspection is named; this is not an all-systems record barrier. No pause is requested until you confirm. An open question remains open. If no work remains after this inspection, the Run can finish instead.`, []);
      }
      if (stopProposal) {
        const commandId = new CryptoUuidV7Generator().next();
        await tx.insert(runInteractionCommand).values({ commandId, runId: run.runId, messageId,
          actorId: input.actorId, kind: 'stop', requestKey: parsed.value.idempotencyKey, semanticFingerprint,
          planDigest: createHash('sha256').update(canonicalJson(plan as unknown as JsonValue)).digest('hex'),
          expectedRunRevision: run.revision, interpretationVersion: 'confirmed-stop-v1', createdAt: at });
        await tx.insert(runInteractionTransition).values([
          { commandId, sequence: 1, state: 'received', reasonCode: 'intake-persisted', createdAt: at },
          { commandId, sequence: 2, state: 'interpreted', reasonCode: 'stop-confirmation-required', createdAt: at },
        ]);
        replyBody = bodyEnvelope('Review Stop for this Run. Cancellation cannot be undone. The worker finishes its current safe boundary; collected evidence is retained and the partial Result is sealed. No cancellation is requested until you confirm.', []);
      }
      if (resumeAnchor !== null) {
        const commandId = new CryptoUuidV7Generator().next();
        await tx.insert(runInteractionCommand).values({ commandId, runId: run.runId, messageId,
          actorId: input.actorId, kind: 'resume', requestKey: parsed.value.idempotencyKey, semanticFingerprint,
          planDigest: createHash('sha256').update(canonicalJson(plan as unknown as JsonValue)).digest('hex'),
          expectedRunRevision: run.revision, interpretationVersion: 'confirmed-resume-v1', resumeAnchor, createdAt: at });
        await tx.insert(runInteractionTransition).values([
          { commandId, sequence: 1, state: 'received', reasonCode: 'intake-persisted', createdAt: at },
          { commandId, sequence: 2, state: 'interpreted', reasonCode: 'resume-confirmation-required', createdAt: at },
        ]);
        replyBody = bodyEnvelope(`Review Resume for the pause opened at ${resumeAnchor.pausedAt}. Confirm before ${resumeAnchor.deadline}. Interrupted work restarts as a new attempt using the frozen plan and committed evidence. No work resumes until you confirm.`, []);
      }
      if (answerQuestion !== null) {
        if (answerOption === null) replyBody = bodyEnvelope(runConversationAnswerClarification(answerQuestion), []);
        else {
          const commandId = new CryptoUuidV7Generator().next();
          await tx.insert(runInteractionCommand).values({ commandId, runId: run.runId, messageId,
            actorId: input.actorId, kind: 'answer', requestKey: parsed.value.idempotencyKey, semanticFingerprint,
            planDigest: createHash('sha256').update(canonicalJson(plan as unknown as JsonValue)).digest('hex'),
            expectedRunRevision: run.revision, interpretationVersion: 'confirmed-answer-v1',
            answerAnchor: answerQuestion.anchor, answerOptionId: answerOption.id, createdAt: admittedAt });
          await tx.insert(runInteractionTransition).values([
            { commandId, sequence: 1, state: 'received', reasonCode: 'intake-persisted', createdAt: admittedAt },
            { commandId, sequence: 2, state: 'interpreted', reasonCode: 'answer-confirmation-required', createdAt: admittedAt },
          ]);
          replyBody = bodyEnvelope(`Question for ${answerQuestion.subject}: ${answerQuestion.question} Choice: ${answerOption.label} (${answerOption.id}). ${runConversationAnswerConsequence(answerOption.id)} Confirm before ${answerQuestion.anchor.deadline}. No answer is applied until you confirm.`, []);
        }
      }
      // Existing domain events can append operational narration between intake and
      // reply. Allocate from the committed transaction history after invoking the handler.
      const [replyPosition] = await tx.select({ sequence: sql<number>`coalesce(max(${runConversationMessage.sequence}), 0)::int` })
        .from(runConversationMessage).where(eq(runConversationMessage.runId, run.runId));
      const replySequence = (replyPosition?.sequence ?? messageSequence) + 1;
      if (replySequence > 1_000_000) throw new Error('Conversation reply sequence unavailable');
      const [replyRun] = await tx.select({ revision: auditRun.revision }).from(auditRun).where(eq(auditRun.runId, run.runId));
      const replyContextRevision = await this.contextRevision(tx, run.runId, replyRun?.revision ?? run.revision);
      await tx.insert(runConversationMessage).values({
        messageId: replyMessageId,
        runId: run.runId,
        sequence: replySequence,
        actorId: input.actorId,
        kind: interpretation.intent.kind === 'pause-now' || deferredAnchor !== null || resumeAnchor !== null || stopProposal || answerOption !== null ? 'command-receipt' : 'platform-event',
        createdAt: at,
        parentMessageId: messageId,
        requestKey: null,
        semanticFingerprint: null,
        contextRevision: replyContextRevision,
        // The review selection can be historical. A deferred execution command names
        // its immutable current inspection; never link its receipt to that selection.
        sourceOrdinal: deferredAnchor === null && resumeAnchor === null ? sourceOrdinal : null,
        replyToWaitId: replyToWaitId,
        sourceEventSequence: null,
      });
      await tx.insert(runConversationContent).values([
        { messageId, ciphertext: cipher.seal(run.runId, messageId, bodyEnvelope(parsed.value.text, [], false)), contentEpoch: 1, removedAt: null },
        { messageId: replyMessageId, ciphertext: cipher.seal(run.runId, replyMessageId, replyBody), contentEpoch: 1, removedAt: null },
      ]);
      await tx.execute(sql`SELECT pg_notify('run_timeline', ${JSON.stringify({ runId: run.runId, sequence: event.sequence })})`);
      return { ok: true, messageId, sequence: messageSequence, replayed: false };
    });
  }

  private async contextRevision(tx: Transaction, runId: string, runRevision: number): Promise<string> {
    const [row] = await tx.execute<{ revision: string }>(sql`
      SELECT md5(jsonb_build_array(
        ${runRevision}::integer,
        coalesce((SELECT h.last_sequence FROM audit_event_heads h WHERE h.aggregate_id=${runId}), 0),
        coalesce((SELECT r.revision FROM run_result_review r WHERE r.run_id=${runId}::uuid), 0)
      )::text) AS revision`);
    return row?.revision ?? `${runRevision}:0:0`;
  }

  private async facts(tx: Transaction, run: ConversationRun, plan: ExecutablePlan, sourceOrdinal: number | null): Promise<ConversationFacts | null> {
    const [work] = await tx.select({ count: sql<number>`count(*)::int` }).from(runWorkItem).where(eq(runWorkItem.runId, run.runId));
    if (sourceOrdinal === null) return { workItems: work?.count ?? 0, selected: null };

    const [source] = await tx.select({ ordinal: populationRow.ordinal })
      .from(populationRow)
      .where(and(eq(populationRow.runId, run.runId), eq(populationRow.ordinal, sourceOrdinal)))
      .limit(1);
    if (!source) return null;

    const flat = await tx.execute<ProjectionRow>(recordReviewProjectionQuery(run.runId, plan, sourceOrdinal));
    const targets = new Map<string, { targetId: string; targetName: string; observationId: string | null; found: string | null; inspected: boolean; account: string | null; capturedStatus: string | null; evaluationCount: number; pending: number; exception: boolean; unevaluated: boolean }>();
    const observationIds = new Set<string>();
    for (const row of flat) {
      if (row.target_id === null) continue;
      targets.set(row.target_id, {
        targetId: row.target_id,
        targetName: row.target_name,
        observationId: row.observation_id,
        found: row.found,
        inspected: row.inspected,
        account: row.account,
        capturedStatus: row.captured_status,
        evaluationCount: row.evaluation_count,
        pending: row.pending,
        exception: row.exception,
        unevaluated: row.unevaluated,
      });
      if (row.observation_id !== null && isUuidText(row.observation_id)) observationIds.add(row.observation_id);
    }
    const observationRows = observationIds.size === 0 ? [] : await tx.select({ observationId: runObservation.observationId, found: runObservation.found, coverage: runObservation.coverage, corroboration: runObservation.corroboration, evidenceIds: runObservation.evidenceIds })
      .from(runObservation).where(and(eq(runObservation.runId, run.runId), inArray(runObservation.observationId, [...observationIds]))).limit(32);
    const evaluations = observationIds.size === 0 ? [] : await tx.execute<{
      observation_id: string;
      condition_id: string;
      value: string;
      confirmation: string | null;
    }>(sql`
      SELECT e.observation_id::text AS observation_id, e.condition_id,
        CASE WHEN r.decision_id IS NULL THEN e.value ELSE r.effective_value END AS value,
        CASE WHEN r.decision_id IS NULL THEN e.confirmation ELSE r.effective_confirmation END AS confirmation
      FROM run_observation_evaluation e
      LEFT JOIN run_evaluation_review r
        ON r.run_id=e.run_id AND r.observation_id=e.observation_id AND r.condition_id=e.condition_id
      WHERE e.run_id=${run.runId}::uuid AND e.observation_id IN ${sql`(${sql.join([...observationIds].map(id => sql`${id}::uuid`), sql`, `)})`}
      ORDER BY e.observation_id, e.condition_id
      LIMIT 64`);
    const evidenceIds = [...new Set(observationRows.flatMap(row => row.evidenceIds.filter(isUuidText)))];
    const registered = evidenceIds.length === 0 ? [] : await tx.select({ evidenceId: runEvidence.evidenceId }).from(runEvidence)
      .where(and(eq(runEvidence.runId, run.runId), eq(runEvidence.state, 'REGISTERED'), inArray(runEvidence.evidenceId, evidenceIds))).limit(MAX_LINKS);
    const conditions = plan.inputs.complianceConditions.slice(0, 32).map(condition => ({ conditionId: safeFact(condition.conditionId, 80), text: safeFact(condition.text, 180) }));
    return {
      workItems: work?.count ?? 0,
      selected: {
        sourceOrdinal,
        targets: [...targets.values()],
        observations: observationRows.map(row => ({ observationId: row.observationId, found: row.found, coverage: row.coverage, corroboration: row.corroboration })),
        evaluations: evaluations.map(row => ({ observationId: row.observation_id, conditionId: row.condition_id, value: row.value, confirmation: row.confirmation })),
        conditions,
        evidenceLinks: registered.map(row => ({ evidenceId: row.evidenceId, locator: null })),
      },
    };
  }
}
