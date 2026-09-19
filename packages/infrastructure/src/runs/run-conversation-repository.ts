import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';

import {
  RUN_CONVERSATION_MAX_TEXT_BYTES,
  RUN_CONVERSATION_MAX_TEXT_CHARS,
  RUN_CONVERSATION_MESSAGE_KINDS,
  RUN_CONVERSATION_PAGE_SIZE,
  RUN_CONVERSATION_SCHEMA_VERSION,
  interpretRunConversationMessage,
  parseRunConversationMessageRequest,
  type RunConversationAppendReceipt,
  type RunConversationEvidenceLink,
  type RunConversationIntentKind,
  type RunConversationMessage,
  type RunConversationMessageKind,
  type RunConversationRead,
  type RunConversationReadRequest,
  type RunConversationRepository,
} from '@intellifin/application';
import { authorizeActionRole, type ExecutablePlan } from '@intellifin/domain';

import type { Database, Transaction } from '../db/client.js';
import {
  auditRun,
  authUser,
  populationRow,
  runConversationContent,
  runConversationMessage,
  runEvidence,
  runObservation,
  runWait,
  runWorkItem,
} from '../db/schema.js';
import { createAuditEventWriter, CryptoUuidV7Generator } from '../db/audit-events.js';
import { isUuidText } from '../db/identifier.js';
import { DrizzleRoleRepository } from '../identity/role-repository.js';
import { DrizzleFrozenExecutionReader } from '../procedures/procedure-repository.js';
import { ConversationContentCipher } from './conversation-content.js';
import { recordReviewProjectionQuery } from './record-review-repository.js';

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
      return `This conversation does not execute Run controls. Use the existing Pause control. ${base}${selectedText}`;
    case 'resume':
      return `This conversation does not execute Run controls. Use the existing Resume control after confirmation. ${base}${selectedText}`;
    case 'stop-confirmation':
      return `This conversation does not execute Run controls. Use the existing Stop control after confirmation. ${base}${selectedText}`;
    case 'deferred-pause-proposal':
      return `This conversation records a deferred pause proposal only. Use the existing Run control after reviewing the selected record. ${base}${selectedText}`;
    case 'answer-request-proposal':
      return `This conversation does not answer waits. Use the existing Escalation answer control. ${base}${selectedText}`;
    case 'strategy-proposal':
      return `Strategy proposals are recorded for review and do not alter the frozen plan. ${base}${selectedText}`;
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
    private readonly db: Database,
    private readonly cipher: ConversationContentCipher | null,
    private readonly now: () => Date = () => new Date(),
  ) {}

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
        })
        .from(runConversationMessage)
        .leftJoin(runConversationContent, eq(runConversationContent.messageId, runConversationMessage.messageId))
        .leftJoin(authUser, eq(authUser.id, runConversationMessage.actorId))
        .where(and(eq(runConversationMessage.runId, input.runId), before === null ? sql`true` : lt(runConversationMessage.sequence, before)))
        .orderBy(desc(runConversationMessage.sequence))
        .limit(51) as unknown as readonly RunConversationMessageRow[];

      const page = rows.slice(0, RUN_CONVERSATION_PAGE_SIZE);
      const olderBefore = rows.length > RUN_CONVERSATION_PAGE_SIZE ? page[page.length - 1]?.sequence ?? null : null;
      const messages: RunConversationMessage[] = [];
      for (const row of [...page].reverse()) {
        const platform = row.parentMessageId !== null || row.kind === 'platform-event';
        let body: string | null = null;
        let links: readonly RunConversationEvidenceLink[] = [];
        let contentState: RunConversationMessage['contentState'] = 'unavailable';
        if (row.removedAt !== null) {
          contentState = 'removed';
        } else if (row.ciphertext !== null) {
          try {
            const opened = storedBody(cipher.open(input.runId, row.messageId, row.ciphertext));
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
          actorId: platform ? null : row.actorId,
          actorName: platform ? 'Platform' : (row.actorName?.trim() || 'Unknown actor'),
          source: platform ? 'platform' : 'auditor',
          kind: RUN_CONVERSATION_MESSAGE_KINDS.includes(row.kind as RunConversationMessageKind) ? row.kind as RunConversationMessageKind : 'security-notice',
          body,
          contentState,
          sourceOrdinal: row.sourceOrdinal,
          createdAt: row.createdAt.toISOString(),
          contextRevision: row.contextRevision,
          links,
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

  async append(input: PostgresRunConversationAppendInput): Promise<RunConversationAppendReceipt> {
    if (!validActor(input.actorId) || !validActor(input.sessionId)) return { ok: false, code: 'malformed', reason: 'The conversation identity was not valid.' };
    const parsed = parseRunConversationMessageRequest(input.request);
    if (!parsed.ok) return { ok: false, code: 'malformed', reason: parsed.reason };
    if (parsed.value.selectedSourceOrdinal !== null && parsed.value.selectedSourceOrdinal > MAX_SOURCE_ORDINAL) return { ok: false, code: 'malformed', reason: 'The selected source ordinal is outside the bounded Run surface.' };
    const cipher = this.cipher;
    if (cipher === null) return { ok: false, code: 'unavailable', reason: 'Run conversation content is unavailable.' };
    const interpretation = interpretRunConversationMessage(parsed.value);
    const at = validClock(this.now());
    const semanticInput = JSON.stringify({
      schemaVersion: RUN_CONVERSATION_SCHEMA_VERSION,
      runId: parsed.value.runId,
      actorId: input.actorId,
      text: parsed.value.text.trim(),
      selectedSourceOrdinal: parsed.value.selectedSourceOrdinal,
      replyToWaitId: parsed.value.replyToWaitId,
    });
    const semanticFingerprint = cipher.fingerprint(semanticInput);

    return this.db.transaction(async (tx) => {
      // Conversation writes are deliberately short and local.  A waiting browser or
      // a blocked Run-control transaction must never hold these locks indefinitely.
      await tx.execute(sql`SET LOCAL lock_timeout = '250ms'`);
      await tx.execute(sql`SET LOCAL statement_timeout = '5s'`);
      // Serialize the per-actor limiter across Runs. All work under this lock remains
      // local PostgreSQL or local crypto; no provider, queue or object-store I/O occurs.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`run-conversation-actor:${input.actorId}`}, 0))`);
      const role = await new DrizzleRoleRepository(tx).findRole(input.actorId);
      if (!authorizeActionRole(role, 'run.initiate').allowed) return { ok: false, code: 'denied', reason: 'Your role does not permit this action.' };
      const [runRow] = await tx.select().from(auditRun).where(eq(auditRun.runId, parsed.value.runId)).for('update').limit(1);
      if (!runRow) return { ok: false, code: 'run-not-found', reason: 'The Run was not found.' };
      const run = parseRun(runRow);

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

      if (parsed.value.selectedSourceOrdinal !== null) {
        const [source] = await tx.select({ ordinal: populationRow.ordinal })
          .from(populationRow)
          .where(and(eq(populationRow.runId, run.runId), eq(populationRow.ordinal, parsed.value.selectedSourceOrdinal)))
          .limit(1);
        if (!source) return { ok: false, code: 'malformed', reason: 'The selected source record is not part of this Run.' };
      }
      if (parsed.value.replyToWaitId !== null) {
        const [wait] = await tx.select({ waitId: runWait.waitId })
          .from(runWait)
          .where(and(eq(runWait.waitId, parsed.value.replyToWaitId), eq(runWait.runId, run.runId), isNull(runWait.closedAt)))
          .limit(1);
        if (!wait) return { ok: false, code: 'malformed', reason: 'The referenced wait is not open on this Run.' };
      }

      const windowStart = new Date(at.getTime() - 60_000);
      const [rate] = await tx.select({ count: sql<number>`count(*)::int` }).from(runConversationMessage)
        .where(and(eq(runConversationMessage.actorId, input.actorId), isNotNull(runConversationMessage.requestKey), gte(runConversationMessage.createdAt, windowStart)));
      if ((rate?.count ?? 0) >= MAX_REQUESTS_PER_MINUTE) return { ok: false, code: 'unavailable', reason: 'The conversation rate limit was reached. Try again shortly.' };

      const [total] = await tx.select({ count: sql<number>`count(*)::int` }).from(runConversationMessage).where(eq(runConversationMessage.runId, run.runId));
      if ((total?.count ?? 0) + 2 > MAX_CONVERSATION_MESSAGES) return { ok: false, code: 'unavailable', reason: 'The Run conversation has reached its bounded message limit.' };

      const plan = await new DrizzleFrozenExecutionReader(tx).readFrozenExecution(run.versionId, run.procedureId);
      if (!plan) return { ok: false, code: 'unavailable', reason: 'The frozen Run context is unavailable.' };
      const facts = await this.facts(tx, run, plan, parsed.value.selectedSourceOrdinal);
      if (facts === null) return { ok: false, code: 'malformed', reason: 'The selected source record is not available in this Run.' };
      const replyBody = bodyEnvelope(replyText(run, safeIntentKind(interpretation.intent.kind), facts), facts.selected?.evidenceLinks ?? []);
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
          sourceOrdinal: parsed.value.selectedSourceOrdinal,
          semanticFingerprint,
        },
      });
      const [last] = await tx.select({ sequence: sql<number>`coalesce(max(${runConversationMessage.sequence}), 0)::int` }).from(runConversationMessage).where(eq(runConversationMessage.runId, run.runId));
      const messageSequence = (last?.sequence ?? 0) + 1;
      const replySequence = messageSequence + 1;
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
        sourceOrdinal: parsed.value.selectedSourceOrdinal,
        replyToWaitId: parsed.value.replyToWaitId,
        sourceEventSequence: event.sequence,
      });
      await tx.insert(runConversationMessage).values({
        messageId: replyMessageId,
        runId: run.runId,
        sequence: replySequence,
        actorId: input.actorId,
        kind: 'platform-event',
        createdAt: at,
        parentMessageId: messageId,
        requestKey: null,
        semanticFingerprint: null,
        contextRevision,
        sourceOrdinal: parsed.value.selectedSourceOrdinal,
        replyToWaitId: parsed.value.replyToWaitId,
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
        ${runRevision},
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
