import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { raiseEscalation, answerEscalation, waitTimeoutMs, FIXED_ESCALATION_OPTIONS, type RunConversationQuestionContext, acquireRunControlLease, releaseRunControlLease, cancelRun, performCancellation, performPause } from '@intellifin/application';
import { DrizzleFrozenExecutionReader } from '../../packages/infrastructure/src/procedures/procedure-repository.js';
import { withRunExecutionContext } from '../../packages/infrastructure/src/runs/adapter-execution-repository.js';

import {
  bindingDigest,
  bindingDigestEnvelope,
  classifyPlanTargets,
  initialDraftCompliance,
  initialDraftEvidence,
  initialDraftPopulation,
  initialDraftSections,
  observationDigest,
  observationIdFor,
  POPULATION_CHECK_NAMES,
  registrationDigest,
  snapshotFromRegistration,
  type ExecutablePlan,
  type DeferredPauseAnchor,
  type JsonValue,
  type ObservationAttribute,
  type ObservationRecord,
} from '@intellifin/domain';
import {
  createDb,
  createSqlClient,
  CryptoUuidV7Generator,
  PostgresAuditUnitOfWork,
  PostgresAgentWorkRepository,
  PostgresRunCancellationRepository,
  PostgresRunControlLeaseRepository,
  PostgresRunsUnitOfWork,
  PostgresWaitRepository,
  DrizzleRoleRepository,
  PostgresProceduresUnitOfWork,
  type Database,
  type Sql,
} from '@intellifin/infrastructure';
import { activeRunVersion } from '../fixtures/active-run-version.js';
import { executablePlanInputs } from '../fixtures/executable-plan.js';
import { auditRun, authUser, populationRow, populationSnapshot, runEvidence, runObservation, runObservationCheck, runObservationEvaluation, runStepExecution, runWorkItem, userRole } from '../../packages/infrastructure/src/db/schema.js';
import { ConversationContentCipher } from '../../packages/infrastructure/src/runs/conversation-content.js';
import { PostgresRunConversationRepository } from '../../packages/infrastructure/src/runs/run-conversation-repository.js';

/**
 * Where the simulated worker boundary holds the Run (Story 10.6, legacy 5.4): before a
 * Run-level Session Step (the fixture plan's `session-3`), with no attempt in flight.
 */
const BOUNDARY_HOLD = { planStepId: 'session-3', workItemId: null, superseded: null } as const;

const url = process.env.DATABASE_URL;
const BASE_NOW = new Date('2026-09-19T12:00:00.000Z');
const OBSERVATION_CHECK_NAMES = [
  'required-evidence',
  'ambiguous-match',
  'freshness',
  'identity-corroboration',
  'search-completeness',
  'observation-corroboration',
] as const;

/** The action boundary treats bounded lock admission as an unknown outcome. After both
 * transactions settle, only that specific failure may recover the exact request. */
async function confirmConcurrentExactRequest<T>(confirm: () => Promise<T>): Promise<T[]> {
  const settled = await Promise.allSettled([confirm(), confirm()]);
  const results: T[] = [];
  for (const result of settled) {
    if (result.status === 'fulfilled') results.push(result.value);
    else {
      const error = result.reason as { code?: string; cause?: { code?: string } };
      expect(error.cause?.code ?? error.code).toBe('55P03');
      results.push(await confirm());
    }
  }
  return results;
}

interface SeededConversation {
  readonly procedureId: string;
  readonly versionId: string;
  readonly runId: string;
  readonly otherRunId: string;
  readonly readerId: string;
  readonly pagerId: string;
  readonly revokedId: string;
  readonly readerSession: string;
  readonly evidenceId: string;
  readonly otherEvidenceId: string;
  readonly waitId: string;
  readonly plan: ExecutablePlan;
  readonly targetId: string;
  readonly stepId: string;
  readonly sourceKey: string;
}

function p1ConversationInputs(bindingId: string, registrationId: string) {
  const schema = ['employee_id', 'full_name', 'employment_status', 'termination_effective_date'];
  const source = {
    kind: 'versioned-file' as const,
    location: 'https://synthetic.invalid/leavers.csv',
    declaredSchema: schema,
    sensitiveFields: [],
    declaredCountMechanism: 'cover-sheet' as const,
  };
  const registration = {
    registrationId,
    displayName: 'LoanCore',
    kind: 'web' as const,
    allowedOrigins: ['https://synthetic.invalid'],
    applicationIdentity: '',
    credentialRef: 'vault://synthetic/loancore',
    permittedActions: ['navigate', 'search', 'read-attribute'] as const,
    attributeLabelPatterns: ['Employee ID', 'Full name', 'Status', 'Username', 'Roles'],
    secondaryKey: 'full_name',
    authenticationDestination: 'https://synthetic.invalid/sign-in',
  };
  return {
    ...initialDraftPopulation('P-1'),
    ...initialDraftCompliance('P-1'),
    ...initialDraftEvidence('P-1'),
    templateId: 'P-1' as const,
    controlName: 'Synthetic leaver review',
    sections: initialDraftSections('P-1'),
    scope: 'Synthetic terminated employees',
    period: { from: '2026-08-01', to: '2026-08-31' },
    sourceSnapshot: {
      bindingId,
      displayName: 'Synthetic leavers',
      digest: bindingDigest(source),
      contract: bindingDigestEnvelope(source),
    },
    schedule: { frequency: 'once' as const, startTime: '00:00', periodDerivationRule: 'explicit-period' as const },
    targets: [snapshotFromRegistration({ ...registration, digest: registrationDigest(registration) })],
    instructions: [{ registrationId, text: 'Search by the approved employee keys and inspect the account.' }],
  };
}

/**
 * These tests use the migrated PostgreSQL schema and the same frozen procedure fixture
 * used by the record-review integration suite.  Conversation content is encrypted with
 * a test-only key; the key never comes from the database and no plaintext is written to
 * audit metadata.
 */
describe.skipIf(!url)('Run conversation repository on PostgreSQL 18', () => {
  let sql: Sql;
  let db: Database;
  let seeded: SeededConversation;
  let now = new Date(BASE_NOW);

  const ids = new CryptoUuidV7Generator();
  const cipher = new ConversationContentCipher('11'.repeat(32));

  beforeAll(async () => {
    const target = new URL(url!);
    if (
      !['localhost', '127.0.0.1', '[::1]', 'postgres', 'db'].includes(target.hostname) ||
      !/(?:^|[_-])(?:test|ci)(?:[_-]|$)/i.test(target.pathname.slice(1))
    ) {
      throw new Error('Run conversation tests require an isolated local or CI test database');
    }
    sql = createSqlClient(url!, { max: 8 });
    db = createDb(sql);
    seeded = await seed();
  }, 120_000);

  afterAll(async () => {
    if (!sql || !seeded) return;
    try {
      for (const runId of [seeded.runId, seeded.otherRunId]) await cleanupRun(runId);
      await sql`DELETE FROM procedure_version WHERE procedure_id=${seeded.procedureId}`;
      await sql`DELETE FROM procedure WHERE procedure_id=${seeded.procedureId}`;
      await sql`DELETE FROM auth_user WHERE id IN (${seeded.readerId},${seeded.pagerId},${seeded.revokedId})`;
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  const repository = (clock = () => now) => new PostgresRunConversationRepository(db, cipher, clock);

  it('encrypts governed content and keeps user text out of metadata and audit payloads', async () => {
    const text = `private annotation\n\t${ids.next()}`;
    const receipt = await append(seeded.readerId, { text });
    expect(receipt.ok).toBe(true);
    if (!receipt.ok) return;

    const [stored] = await sql<{ ciphertext: string; removed_at: Date | null }[]>`
      SELECT ciphertext,removed_at FROM run_conversation_content WHERE message_id=${receipt.messageId}::uuid`;
    expect(stored?.ciphertext.startsWith('v1.')).toBe(true);
    expect(stored?.ciphertext).not.toContain(text);
    expect(stored?.removed_at).toBeNull();

    const [metadata] = await sql<{ metadata: string }[]>`
      SELECT row_to_json(m)::text AS metadata FROM run_conversation_message m WHERE message_id=${receipt.messageId}::uuid`;
    expect(metadata?.metadata).not.toContain(text);
    const events = await sql<{ payload: string }[]>`
      SELECT payload::text AS payload FROM audit_events WHERE aggregate_id=${seeded.runId} AND event_type='review.conversation-received'`;
    expect(events.some(event => event.payload.includes(text))).toBe(false);

    const read = await repository().read({ runId: seeded.runId, actorId: seeded.readerId });
    expect(read.status).toBe('ready');
    if (read.status !== 'ready') return;
    expect(read.messages.find(message => message.messageId === receipt.messageId)).toMatchObject({
      body: text,
      contentState: 'available',
      source: 'auditor',
      actorId: seeded.readerId,
    });
  });

  it('returns the original receipt for an exact retry and conflicts on changed payload', async () => {
    const idempotencyKey = ids.next();
    const request = { runId: seeded.runId, idempotencyKey, text: 'same semantic request', selectedSourceOrdinal: null, replyToWaitId: null };
    const first = await repository().append({ actorId: seeded.readerId, sessionId: seeded.readerSession, request });
    expect(first).toMatchObject({ ok: true, replayed: false });
    if (!first.ok) return;

    const replay = await repository().append({ actorId: seeded.readerId, sessionId: seeded.readerSession, request });
    expect(replay).toEqual({ ...first, replayed: true });
    const conflict = await repository().append({
      actorId: seeded.readerId,
      sessionId: seeded.readerSession,
      request: { ...request, text: 'changed semantic request' },
    });
    expect(conflict).toMatchObject({ ok: false, code: 'conflict' });
    const [countRow] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM run_conversation_message WHERE run_id=${seeded.runId} AND request_key=${idempotencyKey}::uuid`;
    expect(countRow?.count).toBe(1);
  });

  it('grounds selected context in the same Run and exposes only registered Evidence references', async () => {
    const first = await append(seeded.readerId, { text: 'What was recorded for this record?', selectedSourceOrdinal: 1 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const other = await append(seeded.readerId, { runId: seeded.otherRunId, text: 'What was recorded for this record?', selectedSourceOrdinal: 1 });
    expect(other.ok).toBe(true);
    if (!other.ok) return;

    const read = await repository().read({ runId: seeded.runId, actorId: seeded.readerId });
    expect(read.status).toBe('ready');
    if (read.status !== 'ready') return;
    const reply = read.messages.find(message => message.sequence === first.sequence + 1);
    expect(reply).toMatchObject({ source: 'platform', contentState: 'available', sourceOrdinal: 1 });
    expect(reply?.links).toEqual([{ evidenceId: seeded.evidenceId, locator: null }]);
    expect(reply?.links).not.toContainEqual({ evidenceId: seeded.otherEvidenceId, locator: null });
    expect(reply?.body).toContain('captured');
    expect(reply?.body).toContain('effective evaluation');
    expect(reply?.body).not.toContain(seeded.runId);
    expect(reply?.body).not.toContain(seeded.otherRunId);
    expect(reply?.body).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}/i);
    expect(reply?.contextRevision).toMatch(/^[0-9a-f]{32}$/);

    const invalid = await repository().append({
      actorId: seeded.readerId,
      sessionId: seeded.readerSession,
      request: { runId: seeded.runId, idempotencyKey: ids.next(), text: 'What?', selectedSourceOrdinal: 999, replyToWaitId: null },
    });
    expect(invalid).toMatchObject({ ok: false, code: 'malformed' });
  });

  it('replays a valid wait request after the wait closes, while rejecting an unknown wait', async () => {
    const request = { runId: seeded.runId, idempotencyKey: ids.next(), text: 'note: retaining the referenced question', selectedSourceOrdinal: null, replyToWaitId: seeded.waitId };
    const first = await repository().append({ actorId: seeded.readerId, sessionId: seeded.readerSession, request });
    expect(first).toMatchObject({ ok: true, replayed: false });
    if (!first.ok) return;

    await sql`UPDATE run_wait SET closed_at=${new Date(now.getTime() + 1_000).toISOString()}::timestamptz, closure_kind='answer', answer_option_id='one', actor=${seeded.readerId} WHERE wait_id=${seeded.waitId}`;
    const replay = await repository().append({ actorId: seeded.readerId, sessionId: seeded.readerSession, request });
    expect(replay).toEqual({ ...first, replayed: true });

    const rejected = await repository().append({
      actorId: seeded.readerId,
      sessionId: seeded.readerSession,
      request: { ...request, idempotencyKey: ids.next(), replyToWaitId: ids.next() },
    });
    expect(rejected).toMatchObject({ ok: false, code: 'malformed' });
  });

  it('pages a bounded fifty-message window without duplicates', async () => {
    const sequences: number[] = [];
    for (let index = 0; index < 26; index += 1) {
      now = new Date(now.getTime() + 61_000);
      const receipt = await append(seeded.pagerId, { text: `page item ${index + 1}` });
      expect(receipt.ok).toBe(true);
      if (receipt.ok) sequences.push(receipt.sequence, receipt.sequence + 1);
    }
    expect(sequences).toHaveLength(52);

    const first = await repository().read({ runId: seeded.runId, actorId: seeded.pagerId });
    expect(first.status).toBe('ready');
    if (first.status !== 'ready') return;
    expect(first.messages).toHaveLength(50);
    expect(first.olderBefore).not.toBeNull();
    const second = await repository().read({ runId: seeded.runId, actorId: seeded.pagerId, beforeSequence: first.olderBefore });
    expect(second.status).toBe('ready');
    if (second.status !== 'ready') return;
    expect(second.messages.length).toBeGreaterThan(0);
    expect(second.messages.every(message => message.sequence < (first.messages[0]?.sequence ?? Number.MAX_SAFE_INTEGER))).toBe(true);
    expect(new Set([...first.messages, ...second.messages].map(message => message.messageId)).size).toBe(first.messages.length + second.messages.length);
    expect(first.messages.every(message => message.actorName === 'Conversation reader' || message.actorName === 'Platform' || message.actorName === 'Conversation pager')).toBe(true);
  });

  it('reads fresh authorization on every request and returns a governed tombstone', async () => {
    const receipt = await append(seeded.revokedId, { text: 'revocation probe' });
    expect(receipt.ok).toBe(true);
    if (!receipt.ok) return;

    await sql`DELETE FROM user_role WHERE user_id=${seeded.revokedId}`;
    try {
      expect(await repository().read({ runId: seeded.runId, actorId: seeded.revokedId })).toMatchObject({ status: 'denied', messages: [] });
      expect(await repository().append({ actorId: seeded.revokedId, sessionId: seeded.readerSession, request: { runId: seeded.runId, idempotencyKey: ids.next(), text: 'blocked' } })).toMatchObject({ ok: false, code: 'denied' });
    } finally {
      await sql`INSERT INTO user_role(user_id,role) VALUES (${seeded.revokedId},'auditor')`;
    }

    await sql`UPDATE run_conversation_content SET ciphertext=NULL, removed_at=${new Date(now.getTime() + 2_000).toISOString()}::timestamptz, content_epoch=content_epoch+1 WHERE message_id=${receipt.messageId}::uuid`;
    let replacementFailure: { code?: string } | undefined;
    try {
      await sql`UPDATE run_conversation_content SET ciphertext='v1.AAAA', removed_at=NULL WHERE message_id=${receipt.messageId}::uuid`;
    } catch (error) {
      replacementFailure = error as { code?: string };
    }
    expect(replacementFailure?.code).toBe('23514');
    let secondRemovalFailure: { code?: string } | undefined;
    try {
      await sql`UPDATE run_conversation_content
        SET ciphertext=NULL, removed_at=${new Date(now.getTime() + 3_000).toISOString()}::timestamptz, content_epoch=content_epoch+1
        WHERE message_id=${receipt.messageId}::uuid`;
    } catch (error) {
      secondRemovalFailure = error as { code?: string };
    }
    expect(secondRemovalFailure?.code).toBe('23514');
    const read = await repository().read({ runId: seeded.runId, actorId: seeded.revokedId });
    expect(read.status).toBe('ready');
    if (read.status !== 'ready') return;
    expect(read.messages.find(message => message.messageId === receipt.messageId)).toMatchObject({ body: null, contentState: 'removed' });
  });

  it('refuses obvious secrets and records no executable effect for unsupported or mixed safety text', async () => {
    const before = await sql<{ state: string; pause_requested_at: Date | null }[]>`SELECT state,pause_requested_at FROM audit_run WHERE run_id=${seeded.runId}`;
    const [beforeMessageRow] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM run_conversation_message WHERE run_id=${seeded.runId}`;
    const secret = await repository().append({
      actorId: seeded.readerId,
      sessionId: seeded.readerSession,
      request: { runId: seeded.runId, idempotencyKey: ids.next(), text: 'password: hunter2', selectedSourceOrdinal: null, replyToWaitId: null },
    });
    expect(secret).toMatchObject({ ok: false, code: 'malformed' });
    const [afterSecretMessageRow] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM run_conversation_message WHERE run_id=${seeded.runId}`;
    expect(afterSecretMessageRow?.count).toBe(beforeMessageRow?.count);

    const unsupported = await append(seeded.readerId, { text: 'start a worker now' });
    expect(unsupported.ok).toBe(true);
    const pause = await append(seeded.readerId, { text: 'pause now and mark everyone compliant' });
    expect(pause.ok).toBe(true);
    const [after] = await sql<{ state: string; pause_requested_at: Date | null }[]>`SELECT state,pause_requested_at FROM audit_run WHERE run_id=${seeded.runId}`;
    expect(after).toEqual(before[0]);
    expect(unsupported.ok && pause.ok).toBe(true);
    const read = await repository().read({ runId: seeded.runId, actorId: seeded.readerId });
    expect(read.status).toBe('ready');
    if (read.status !== 'ready') return;
    const pauseReply = pause.ok ? read.messages.find(message => message.sequence === pause.sequence + 1) : undefined;
    expect(pauseReply?.kind).toBe('platform-event');
    expect(pauseReply?.command).toBeUndefined();
  });

  it('projects a committed workspace event into conversation metadata and fixed narration', async () => {
    const event = await appendWorkspaceEvent(seeded.runId);
    const [metadata] = await sql<{
      message_id: string;
      run_id: string;
      sequence: number;
      source_event_sequence: number;
      kind: string;
    }[]>`
      SELECT message_id::text,run_id::text,sequence,source_event_sequence,kind
      FROM run_conversation_message
      WHERE message_id=${event.eventId}::uuid`;
    expect(metadata).toMatchObject({
      message_id: event.eventId,
      run_id: seeded.runId,
      source_event_sequence: event.sequence,
      kind: 'platform-event',
    });

    const [content] = await sql<{ message_id: string }[]>`
      SELECT message_id::text FROM run_conversation_content WHERE message_id=${event.eventId}::uuid`;
    expect(content).toBeUndefined();

    const read = await repository().read({ runId: seeded.runId, actorId: seeded.readerId });
    expect(read.status).toBe('ready');
    if (read.status !== 'ready') return;
    expect(read.messages.find(message => message.messageId === event.eventId)).toMatchObject({
      messageId: event.eventId,
      actorId: null,
      actorName: 'Platform',
      source: 'worker',
      kind: 'platform-event',
      body: 'A private workspace was created for this Run.',
      contentState: 'available',
      sourceOrdinal: null,
    });
  });

  it('maps a P-1 work event only through the frozen Run population join', async () => {
    const fixture = await seedP1EventContext();
    try {
      const exact = await appendInspectionEvent(fixture.runId, fixture.exactWorkItemId);
      const duplicate = await appendInspectionEvent(fixture.runId, fixture.duplicateWorkItemId);
      const crossRun = await appendInspectionEvent(fixture.runId, fixture.crossRunWorkItemId);

      const read = await repository().read({ runId: fixture.runId, actorId: seeded.readerId });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;

      expect(read.messages.find(message => message.messageId === exact.eventId)).toMatchObject({
        kind: 'platform-event',
        body: 'The current inspection started.',
        sourceOrdinal: 1,
      });
      expect(read.messages.find(message => message.messageId === duplicate.eventId)).toMatchObject({
        kind: 'platform-event',
        body: 'The current inspection started.',
        sourceOrdinal: null,
      });
      expect(read.messages.find(message => message.messageId === crossRun.eventId)).toMatchObject({
        kind: 'platform-event',
        body: 'The current inspection started.',
        sourceOrdinal: null,
      });
    } finally {
      await cleanupRun(fixture.runId);
      await cleanupRun(fixture.otherRunId);
      await sql`DELETE FROM procedure_version WHERE procedure_id=${fixture.procedureId}`;
      await sql`DELETE FROM procedure WHERE procedure_id=${fixture.procedureId}`;
    }
  });

  it('rolls back an audit event and its operational conversation metadata together', async () => {
    let eventId: string | undefined;
    let failure: unknown;
    try {
      await new PostgresAuditUnitOfWork(db, { clock: { now: () => new Date(now.getTime()) } }).execute(async ({ auditEvents }) => {
        const event = await auditEvents.append(workspaceEventDraft(seeded.runId));
        eventId = event.eventId;
        throw new Error('conversation rollback probe');
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('conversation rollback probe');
    expect(eventId).toBeDefined();
    if (!eventId) return;

    const [event] = await sql<{ event_id: string }[]>`
      SELECT event_id::text FROM audit_events WHERE event_id=${eventId}::uuid`;
    const [message] = await sql<{ message_id: string }[]>`
      SELECT message_id::text FROM run_conversation_message WHERE message_id=${eventId}::uuid`;
    expect(event).toBeUndefined();
    expect(message).toBeUndefined();
  });

  it('orders concurrent human and operational appends with unique conversation sequences', async () => {
    const eventPromise = appendWorkspaceEvent(seeded.runId);
    const humanPromise = append(seeded.readerId, { text: 'concurrent ordering probe' });
    const [event, human] = await Promise.all([eventPromise, humanPromise]);
    expect(human.ok).toBe(true);
    if (!human.ok) return;

    const rows = await sql<{
      message_id: string;
      sequence: number;
      source_event_sequence: number | null;
    }[]>`
      SELECT message_id::text,sequence,source_event_sequence
      FROM run_conversation_message
      WHERE run_id=${seeded.runId}
        AND (message_id=${event.eventId}::uuid OR message_id=${human.messageId}::uuid OR parent_message_id=${human.messageId}::uuid)
      ORDER BY sequence ASC`;
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map(row => row.sequence)).size).toBe(rows.length);
    const operational = rows.find(row => row.message_id === event.eventId);
    const humanRow = rows.find(row => row.message_id === human.messageId);
    const replyRow = rows.find(row => row.message_id !== event.eventId && row.message_id !== human.messageId);
    expect(operational).toMatchObject({ source_event_sequence: event.sequence });
    expect(humanRow).toMatchObject({ sequence: human.sequence });
    expect(replyRow).toMatchObject({ sequence: human.sequence + 1 });
    expect(humanRow?.source_event_sequence).not.toBeNull();
    if (humanRow?.source_event_sequence === null || humanRow?.source_event_sequence === undefined || operational === undefined) return;
    if (event.sequence < humanRow.source_event_sequence) {
      expect(operational.sequence).toBeLessThan(human.sequence);
    } else {
      expect(event.sequence).toBeGreaterThan(humanRow.source_event_sequence);
      expect(operational.sequence).toBeGreaterThan(human.sequence + 1);
    }
  });

  it('opens governed content when the Run identifier is supplied with uppercase hex', async () => {
    const receipt = await append(seeded.readerId, { text: 'uppercase canonical Run identity probe' });
    expect(receipt.ok).toBe(true);
    if (!receipt.ok) return;

    const read = await repository().read({ runId: seeded.runId.toUpperCase(), actorId: seeded.readerId });
    expect(read.status).toBe('ready');
    if (read.status !== 'ready') return;
    expect(read.messages.find(message => message.messageId === receipt.messageId)).toMatchObject({
      messageId: receipt.messageId,
      runId: seeded.runId,
      body: 'uppercase canonical Run identity probe',
      contentState: 'available',
    });
  });

  it('links exact pause intake to the existing marker once and records worker application in the same transaction', async () => {
    const runId = ids.next();
    await insertRun(runId, seeded.procedureId, seeded.versionId, seeded.readerId, '2026-10-01', '2026-10-31');
    try {
      // Stale record selection cannot retarget or block an unqualified Run safety command.
      const request = { runId, idempotencyKey: ids.next(), text: 'pause now', selectedSourceOrdinal: 10001, replyToWaitId: null };
      const input = { actorId: seeded.readerId, sessionId: seeded.readerSession, request };
      const first = await repository().append(input);
      expect(first).toMatchObject({ ok: true });
      if (!first.ok) throw new Error('Pause intake refused');
      const [intake] = await sql`SELECT source_ordinal,reply_to_wait_id FROM run_conversation_message WHERE message_id=${first.messageId}`;
      expect(intake).toMatchObject({ source_ordinal: null, reply_to_wait_id: null });
      expect(await repository().append(input)).toEqual({ ...first, replayed: true });
      expect(await repository().append({ ...input, request: { ...request, text: ' PAUSE NOW ' } })).toEqual({ ...first, replayed: true });
      // Only the unqualified safety shortcut ignores stale view selection. An ordinary
      // request still validates that envelope before idempotency reconciliation.
      expect(await repository().append({ ...input, request: { ...request, text: 'resume' } })).toMatchObject({ ok: false, code: 'malformed' });
      expect(await repository().append({ ...input, request: { ...request, text: 'resume', selectedSourceOrdinal: null } })).toMatchObject({ ok: false, code: 'conflict' });
      const [command] = await sql<{ command_id: string; plan_digest: string }[]>`SELECT command_id::text,plan_digest FROM run_interaction_command WHERE message_id=${first.messageId}`;
      expect(command?.plan_digest).toMatch(/^[a-f0-9]{64}$/);
      if (!command) throw new Error('Pause command missing');
      const [pending] = await sql`SELECT state,pause_requested_by,pause_requested_command_id::text FROM audit_run WHERE run_id=${runId}`;
      expect(pending).toMatchObject({ state: 'RUNNING', pause_requested_by: seeded.readerId, pause_requested_command_id: command.command_id });
      const transitions = () => sql<{ state: string; source_event_id: string | null }[]>`SELECT state,source_event_id::text FROM run_interaction_transition WHERE command_id=${command.command_id} ORDER BY sequence`;
      expect((await transitions()).map(t => t.state)).toEqual(['received','interpreted','queued']);
      const queuedEventId = (await transitions()).at(-1)!.source_event_id;
      await expect(sql`INSERT INTO run_interaction_transition(command_id,sequence,state,reason_code,created_at,source_event_id)
        SELECT ${command.command_id}::uuid,4,'applied','forged-applied',occurred_at,event_id FROM audit_events WHERE event_id=${queuedEventId}`)
        .rejects.toMatchObject({ code: '23514' });
      const [requested] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM audit_events WHERE aggregate_id=${runId} AND event_type='lifecycle.run-pause-requested'`;
      expect(requested?.count).toBe(1);

      // A second actor's command must not claim ownership of the already pending marker.
      expect((await append(seeded.revokedId, { runId, text: 'pause now' })).ok).toBe(true);
      const refused = await sql<{ state: string }[]>`SELECT t.state FROM run_interaction_transition t JOIN run_interaction_command c USING(command_id) WHERE c.run_id=${runId} AND c.actor_id=${seeded.revokedId} ORDER BY t.sequence`;
      expect(refused.map(t => t.state)).toEqual(['received','interpreted','refused']);
      const boundary = () => db.transaction(tx => withRunExecutionContext(tx, runId, async context => {
        if (!context.run?.pauseRequest) throw new Error('Pause marker missing');
        await context.saveRunState('PAUSED');
        await performPause(context, { run: context.run, request: context.run.pauseRequest, waitId: ids.next(), at: now.toISOString(), hold: BOUNDARY_HOLD });
      }));
      // Exercise rollback through the actual shared worker context, not a fake receipt writer.
      await expect(db.transaction(tx => withRunExecutionContext(tx, runId, async context => {
        if (!context.run?.pauseRequest) throw new Error('Pause marker missing');
        await context.saveRunState('PAUSED');
        await performPause(context, { run: context.run, request: context.run.pauseRequest, waitId: ids.next(), at: now.toISOString(), hold: BOUNDARY_HOLD });
        throw new Error('rollback-worker-pause');
      }))).rejects.toThrow('rollback-worker-pause');
      expect((await transitions()).map(t => t.state)).toEqual(['received','interpreted','queued']);
      // An accepted safety request survives subsequent role revocation.
      await sql`DELETE FROM user_role WHERE user_id=${seeded.readerId}`;
      try {
        expect(await repository().append(input)).toMatchObject({ ok: false, code: 'denied' });
        await boundary();
      } finally {
        await sql`INSERT INTO user_role(user_id,role) VALUES (${seeded.readerId},'auditor')`;
      }
      const history = await transitions();
      expect(history.map(t => t.state)).toEqual(['received','interpreted','queued','applied']);
      const [applied] = await sql`SELECT event_type,payload FROM audit_events WHERE event_id=${history.at(-1)!.source_event_id}`;
      expect(applied).toMatchObject({ event_type: 'lifecycle.run-paused', payload: { commandId: command.command_id } });
      const [state] = await sql`SELECT state,pause_requested_at,pause_requested_command_id FROM audit_run WHERE run_id=${runId}`;
      expect(state).toMatchObject({ state: 'PAUSED', pause_requested_at: null, pause_requested_command_id: null });
      const read = await repository().read({ runId, actorId: seeded.readerId });
      expect(read.status).toBe('ready');
      if (read.status === 'ready') expect(read.messages.find(m => m.command?.commandId === command.command_id)?.command).toMatchObject({ state: 'applied', sourceEventId: history.at(-1)!.source_event_id });
      await expect(sql`UPDATE run_interaction_transition SET state='queued' WHERE command_id=${command.command_id} AND state='applied'`).rejects.toMatchObject({ code: '23514' });
      // Privileged storage damage must not leave a still-credible applied receipt.
      await sql`DELETE FROM audit_events WHERE event_id=${history.at(-1)!.source_event_id}`;
      expect(await repository().read({ runId, actorId: seeded.readerId })).toMatchObject({ status: 'unavailable', messages: [] });
    } finally {
      await sql`DELETE FROM pgboss.job WHERE data->>'runId'=${runId}`;
      await cleanupRun(runId);
    }
  });

  it('records a pause as superseded when the existing cancellation owner finalizes first', async () => {
    const runId = ids.next();
    await insertRun(runId, seeded.procedureId, seeded.versionId, seeded.readerId, '2026-11-01', '2026-11-30');
    try {
      const note = await append(seeded.readerId, { runId, text: 'Ledger constraint fixture' });
      if (!note.ok) throw new Error('Ledger fixture intake unavailable');
      const invalidId = ids.next();
      // A valid auditor note cannot be relabelled as a pause intake by an internal caller.
      await expect(sql`INSERT INTO run_interaction_command(command_id,run_id,message_id,actor_id,kind,request_key,semantic_fingerprint,plan_digest,expected_run_revision,interpretation_version,created_at)
          SELECT ${invalidId}::uuid,run_id,message_id,actor_id,'pause-now',request_key,semantic_fingerprint,${'0'.repeat(64)},0,'exact-safety-v1',created_at
          FROM run_conversation_message WHERE message_id=${note.messageId}`).rejects.toMatchObject({ code: '23514' });
      const guardedMessageId = ids.next();
      const guardedKey = ids.next();
      const fingerprint = 'a'.repeat(64);
      const intakeEvent = await new PostgresAuditUnitOfWork(db, { clock: { now: () => now } }).execute(({ auditEvents }) => auditEvents.append({
        actor: { type: 'human', id: seeded.readerId }, aggregateId: runId, correlationId: ids.next(),
        sessionId: seeded.readerSession, eventType: 'review.conversation-received', source: 'web', outcome: 'success',
        payload: { messageId: guardedMessageId, intent: 'pause-now', semanticFingerprint: fingerprint },
      }));
      let commandInserted = false;
      await expect(sql.begin(async tx => {
        await tx`INSERT INTO run_conversation_message(message_id,run_id,sequence,actor_id,kind,created_at,request_key,semantic_fingerprint,source_event_sequence)
          SELECT ${guardedMessageId}::uuid,${runId}::uuid,coalesce(max(sequence),0)+1,${seeded.readerId},'auditor-message',${now.toISOString()}::timestamptz,${guardedKey}::uuid,${fingerprint},${intakeEvent.sequence}
          FROM run_conversation_message WHERE run_id=${runId}`;
        await tx`INSERT INTO run_interaction_command(command_id,run_id,message_id,actor_id,kind,request_key,semantic_fingerprint,plan_digest,expected_run_revision,interpretation_version,created_at)
          VALUES (${invalidId}::uuid,${runId}::uuid,${guardedMessageId}::uuid,${seeded.readerId},'pause-now',${guardedKey}::uuid,${fingerprint},${'0'.repeat(64)},0,'exact-safety-v1',${now.toISOString()}::timestamptz)`;
        commandInserted = true;
        await tx`INSERT INTO run_interaction_transition(command_id,sequence,state,reason_code,created_at)
          VALUES (${invalidId}::uuid,1,'interpreted','skip-received',${now.toISOString()}::timestamptz)`;
      })).rejects.toMatchObject({ code: '23514' });
      expect(commandInserted).toBe(true);
      expect((await append(seeded.readerId, { runId, text: 'pause now' })).ok).toBe(true);
      const [command] = await sql<{ command_id: string }[]>`SELECT command_id::text FROM run_interaction_command WHERE run_id=${runId}`;
      if (!command) throw new Error('Pause command missing');
      const canceled = await cancelRun({ roles: new DrizzleRoleRepository(db), unitOfWork: new PostgresRunsUnitOfWork(db),
        repository: new PostgresRunCancellationRepository(db), ids, clock: { now: () => now } },
      { session: { userId: seeded.readerId, sessionId: seeded.readerSession }, request: { runId, reason: null } });
      expect(canceled).toMatchObject({ ok: true, pending: true });
      await db.transaction(tx => withRunExecutionContext(tx, runId, async context => {
        if (!context.run?.cancellation) throw new Error('Cancellation marker missing');
        await performCancellation(context, { run: context.run, request: context.run.cancellation, at: now.toISOString(), plan: seeded.plan, source: 'worker' });
      }));
      const states = await sql<{ state: string; source_event_id: string | null }[]>`SELECT state,source_event_id::text FROM run_interaction_transition WHERE command_id=${command.command_id} ORDER BY sequence`;
      expect(states.map(t => t.state)).toEqual(['received','interpreted','queued','superseded']);
      const [event] = await sql`SELECT event_type,actor_type,actor_id,payload FROM audit_events WHERE event_id=${states.at(-1)!.source_event_id}`;
      expect(event).toMatchObject({ event_type: 'lifecycle.pause-superseded', actor_type: 'system', actor_id: 'result-sealer', payload: { commandId: command.command_id, requestedBy: seeded.readerId } });
      const [state] = await sql`SELECT state FROM audit_run WHERE run_id=${runId}`;
      expect(state?.state).toBe('CANCELED');
    } finally {
      await sql`DELETE FROM pgboss.job WHERE data->>'runId'=${runId}`;
      await cleanupRun(runId);
    }
  });

  it('persists an inspection proposal without executing it, then confirms once while preserving the exact open question', async () => {
    const fixture = await seedDeferredContext(true);
    try {
      await acquireControl(fixture.runId);
      const inspection = await currentInspection(fixture.runId);
      expect(inspection).toMatchObject({ sourceOrdinal: 1, subjectLabel: 'E-001', targetName: 'LoanCore' });
      const beforeWait = await sql`SELECT * FROM run_wait WHERE wait_id=${fixture.waitId}`;
      const beforeRun = await sql`SELECT state,revision FROM audit_run WHERE run_id=${fixture.runId}`;
      const commandId = await proposeInspection(fixture.runId, inspection.anchor, fixture.waitId, 2);
      expect(await sql`SELECT command_id FROM run_deferred_pause WHERE run_id=${fixture.runId}`).toHaveLength(0);
      expect(await sql`SELECT state FROM run_interaction_transition WHERE command_id=${commandId} ORDER BY sequence`)
        .toEqual([{ state: 'received' }, { state: 'interpreted' }]);
      let read = await repository().read({ runId: fixture.runId, actorId: seeded.readerId });
      expect(read.status).toBe('ready');
      expect(read.messages.find(message => message.command?.commandId === commandId)?.command)
        .toMatchObject({ kind: 'pause-after-inspection', state: 'interpreted', canConfirm: true, targetLabel: '"E-001" on LoanCore' });
      expect(read.messages.find(message => message.command?.commandId === commandId)?.sourceOrdinal).toBeNull();
      expect(read.messages.find(message => message.source === 'auditor' && message.body === 'pause after this employee')?.sourceOrdinal).toBe(2);

      // The browser cannot substitute the anchor or the controller fence in confirmation.
      expect(await confirmInspection(fixture.runId, commandId, { currentInspection: inspection.anchor }))
        .toMatchObject({ ok: false, code: 'malformed' });
      expect(await repository().confirmDeferredPause({ actorId: seeded.pagerId, sessionId: seeded.readerSession,
        request: { runId: fixture.runId, commandId } })).toMatchObject({ ok: false, code: 'denied' });
      const concurrent = await Promise.all([
        confirmInspection(fixture.runId, commandId), confirmInspection(fixture.runId, commandId),
      ]);
      expect(concurrent).toEqual(expect.arrayContaining([
        expect.objectContaining({ ok: true, state: 'queued', replayed: false }),
        expect.objectContaining({ ok: true, state: 'queued', replayed: true }),
      ]));
      expect(await confirmInspection(fixture.runId, commandId)).toMatchObject({ ok: true, state: 'queued', replayed: true });
      expect(await sql`SELECT work_item_id,subject_key,expected_control_epoch,state FROM run_deferred_pause WHERE run_id=${fixture.runId}`)
        .toEqual([{ work_item_id: fixture.exactWorkItemId, subject_key: 'E-001', expected_control_epoch: 1, state: 'PENDING' }]);
      expect(await sql`SELECT event_id FROM audit_events WHERE aggregate_id=${fixture.runId} AND event_type='lifecycle.run-deferred-pause-requested'`).toHaveLength(1);
      expect(await sql`SELECT state FROM run_interaction_transition WHERE command_id=${commandId} ORDER BY sequence`)
        .toEqual([{ state: 'received' }, { state: 'interpreted' }, { state: 'queued' }]);
      expect(await sql`SELECT * FROM run_wait WHERE wait_id=${fixture.waitId}`).toEqual(beforeWait);
      expect(await sql`SELECT state,revision FROM audit_run WHERE run_id=${fixture.runId}`).toEqual(beforeRun);
      expect(await sql`SELECT wait_id FROM run_wait WHERE run_id=${fixture.runId} AND closed_at IS NULL`).toHaveLength(1);
      read = await repository().read({ runId: fixture.runId, actorId: seeded.readerId });
      expect(read.messages.find(message => message.command?.commandId === commandId)?.command)
        .toMatchObject({ state: 'queued', canConfirm: false });
      // A stored transition alone cannot stand in for its authoritative source fact.
      await sql`DELETE FROM audit_events WHERE aggregate_id=${fixture.runId} AND event_type='lifecycle.run-deferred-pause-requested'`;
      expect(await repository().read({ runId: fixture.runId, actorId: seeded.readerId }))
        .toMatchObject({ status: 'unavailable', messages: [] });
      expect(await confirmInspection(fixture.runId, commandId)).toMatchObject({ ok: false, code: 'unavailable' });
    } finally { await cleanupDeferredContext(fixture); }
  });

  it('requires owned live control before recording a deferred proposal', async () => {
    const fixture = await seedDeferredContext();
    try {
      const { anchor } = await currentInspection(fixture.runId);
      const propose = () => append(seeded.readerId, { runId: fixture.runId, text: 'pause after this employee', currentInspection: anchor });
      expect(await propose()).toMatchObject({ ok: false, code: 'denied' });
      await acquireControl(fixture.runId, seeded.pagerId);
      expect(await propose()).toMatchObject({ ok: false, code: 'denied' });
      expect(await sql`SELECT command_id FROM run_interaction_command WHERE run_id=${fixture.runId}`).toHaveLength(0);
      expect(await sql`SELECT command_id FROM run_deferred_pause WHERE run_id=${fixture.runId}`).toHaveLength(0);
    } finally { await cleanupDeferredContext(fixture); }
  });

  it('refuses a stale proposal after the same auditor releases and reacquires control', async () => {
    const fixture = await seedDeferredContext();
    try {
      await acquireControl(fixture.runId);
      const { anchor } = await currentInspection(fixture.runId);
      const commandId = await proposeInspection(fixture.runId, anchor);
      expect(await releaseRunControlLease(controlDependencies(), { session: readerSession(),
        request: { runId: fixture.runId, expectedEpoch: 1 } })).toMatchObject({ ok: true, lease: { epoch: 2 } });
      await acquireControl(fixture.runId, seeded.readerId, 2);
      expect(await confirmInspection(fixture.runId, commandId)).toMatchObject({ ok: false, code: 'conflict', reason: expect.stringContaining('lease changed') });
      expect(await sql`SELECT deferred_control_epoch,deferred_anchor FROM run_interaction_command WHERE command_id=${commandId}`)
        .toEqual([{ deferred_control_epoch: 1, deferred_anchor: anchor }]);
      expect(await sql`SELECT command_id FROM run_deferred_pause WHERE run_id=${fixture.runId}`).toHaveLength(0);
      const read = await repository().read({ runId: fixture.runId, actorId: seeded.readerId });
      expect(read.messages.find(message => message.command?.commandId === commandId)?.command)
        .toMatchObject({ state: 'refused', canConfirm: false });
    } finally { await cleanupDeferredContext(fixture); }
  });

  it('uses database time to reject an expired owned controller at proposal intake', async () => {
    const fixture = await seedDeferredContext();
    try {
      const { anchor } = await currentInspection(fixture.runId);
      await sql`WITH stamp AS (SELECT clock_timestamp() AS at)
        INSERT INTO run_control_lease(run_id,epoch,holder_id,updated_at,expires_at)
        SELECT ${fixture.runId}::uuid,1,${seeded.readerId},at-interval '121 seconds',at-interval '1 second' FROM stamp`;
      expect(await append(seeded.readerId, { runId: fixture.runId, text: 'pause after this employee', currentInspection: anchor }))
        .toMatchObject({ ok: false, code: 'denied' });
      expect(await sql`SELECT command_id FROM run_interaction_command WHERE run_id=${fixture.runId}`).toHaveLength(0);
      expect(await sql`SELECT command_id FROM run_deferred_pause WHERE run_id=${fixture.runId}`).toHaveLength(0);
    } finally { await cleanupDeferredContext(fixture); }
  });

  it('refuses forged or stale draft anchors and never retargets a persisted proposal to the next record', async () => {
    const fixture = await seedDeferredContext();
    try {
      await acquireControl(fixture.runId);
      const { anchor } = await currentInspection(fixture.runId);
      for (const currentInspection of [
        { ...anchor, workItemId: fixture.crossRunWorkItemId, subjectKey: 'E-CROSS' },
        { ...anchor, workItemId: fixture.duplicateWorkItemId, subjectKey: 'E-DUP' },
        { ...anchor, planDigest: '00'.repeat(32) },
        { ...anchor, runRevision: anchor.runRevision + 1 },
        { ...anchor, registrationId: ids.next() },
      ]) {
        expect(await append(seeded.readerId, { runId: fixture.runId, text: 'pause after this record', currentInspection }))
          .toMatchObject({ ok: false, code: 'conflict' });
      }
      // Historical review selection alone is not an execution target.
      expect(await append(seeded.readerId, { runId: fixture.runId, text: 'pause after this employee', selectedSourceOrdinal: 1 }))
        .toMatchObject({ ok: false, code: 'conflict' });
      const commandId = await proposeInspection(fixture.runId, anchor);
      await sql`UPDATE run_agent_work SET work_item_id=${fixture.duplicateWorkItemId},revision=revision+1 WHERE run_id=${fixture.runId}`;
      expect(await currentInspection(fixture.runId)).toMatchObject({ subjectLabel: 'E-DUP', sourceOrdinal: null });
      expect(await confirmInspection(fixture.runId, commandId)).toMatchObject({ ok: false, code: 'conflict', reason: expect.stringContaining('inspection changed') });
      expect(await sql`SELECT deferred_anchor FROM run_interaction_command WHERE command_id=${commandId}`).toEqual([{ deferred_anchor: anchor }]);
      expect(await sql`SELECT command_id FROM run_deferred_pause WHERE run_id=${fixture.runId}`).toHaveLength(0);
      const read = await repository().read({ runId: fixture.runId, actorId: seeded.readerId });
      expect(read.messages.find(message => message.command?.commandId === commandId)?.command)
        .toMatchObject({ state: 'refused', targetLabel: '"E-001" on LoanCore' });
    } finally { await cleanupDeferredContext(fixture); }
  });

  it('checks current role again at confirmation and leaves the proposal non-executable after revocation', async () => {
    const fixture = await seedDeferredContext();
    try {
      await acquireControl(fixture.runId);
      const { anchor } = await currentInspection(fixture.runId);
      const commandId = await proposeInspection(fixture.runId, anchor);
      const original = await sql<{ assigned_at: string; assigned_by: string | null }[]>`SELECT assigned_at::text AS assigned_at,assigned_by FROM user_role WHERE user_id=${seeded.readerId}`;
      await sql`DELETE FROM user_role WHERE user_id=${seeded.readerId}`;
      try {
        expect(await confirmInspection(fixture.runId, commandId)).toMatchObject({ ok: false, code: 'denied' });
        expect(await sql`SELECT command_id FROM run_deferred_pause WHERE run_id=${fixture.runId}`).toHaveLength(0);
        expect(await sql`SELECT state FROM run_interaction_transition WHERE command_id=${commandId} ORDER BY sequence`)
          .toEqual([{ state: 'received' }, { state: 'interpreted' }]);
      } finally {
        await sql`INSERT INTO user_role(user_id,role,assigned_at,assigned_by) VALUES (${seeded.readerId},'auditor',${original[0]!.assigned_at}::timestamptz,${original[0]!.assigned_by})`;
      }
    } finally { await cleanupDeferredContext(fixture); }
  });

  it.each(['removed', 'corrupt'] as const)('refuses confirmation when the displayed child proposal is %s despite an intact intake', async mode => {
    const fixture = await seedDeferredContext();
    try {
      await acquireControl(fixture.runId);
      const { anchor } = await currentInspection(fixture.runId);
      // Inject a damaged child at initial storage, never by disabling the immutable
      // content guard. Only the proposal is damaged; the auditor intake decrypts.
      class DamagedProposalCipher extends ConversationContentCipher {
        override seal(runId: string, messageId: string, content: string): string {
          const envelope = JSON.parse(content) as { text: string };
          return envelope.text.startsWith('Review a pause after ') ? 'v1.AAAA' : super.seal(runId, messageId, content);
        }
      }
      const writer = mode === 'corrupt'
        ? new PostgresRunConversationRepository(db, new DamagedProposalCipher('11'.repeat(32)), () => now)
        : repository();
      const receipt = await writer.append({ actorId: seeded.readerId, sessionId: seeded.readerSession, request: {
        runId: fixture.runId, idempotencyKey: ids.next(), text: 'pause after this employee', currentInspection: anchor,
      } });
      expect(receipt.ok).toBe(true);
      if (!receipt.ok) throw new Error(receipt.reason);
      const [stored] = await sql<{ command_id: string; proposal_id: string; intake_ciphertext: string }[]>`
        SELECT c.command_id,child.message_id AS proposal_id,intake.ciphertext AS intake_ciphertext
        FROM run_interaction_command c
        JOIN run_conversation_message child ON child.parent_message_id=c.message_id AND child.kind='command-receipt'
        JOIN run_conversation_content intake ON intake.message_id=c.message_id
        WHERE c.message_id=${receipt.messageId}`;
      if (!stored) throw new Error('Deferred proposal was not stored');
      expect(cipher.open(fixture.runId, receipt.messageId, stored.intake_ciphertext)).toContain('pause after this employee');
      if (mode === 'removed') {
        await sql`UPDATE run_conversation_content SET ciphertext=NULL,removed_at=clock_timestamp(),content_epoch=content_epoch+1
          WHERE message_id=${stored.proposal_id}`;
      }
      const read = await repository().read({ runId: fixture.runId, actorId: seeded.readerId });
      expect(read.status).toBe('ready');
      expect(read.messages.find(message => message.messageId === stored.proposal_id))
        .toMatchObject({ body: null, contentState: mode === 'removed' ? 'removed' : 'unavailable', command: { canConfirm: false } });
      expect(await confirmInspection(fixture.runId, stored.command_id)).toMatchObject({ ok: false, code: 'unavailable' });
      expect(await sql`SELECT command_id FROM run_deferred_pause WHERE run_id=${fixture.runId}`).toHaveLength(0);
      expect(await sql`SELECT event_id FROM audit_events WHERE aggregate_id=${fixture.runId} AND event_type='lifecycle.run-deferred-pause-requested'`).toHaveLength(0);
      expect(await sql`SELECT state FROM run_interaction_transition WHERE command_id=${stored.command_id} ORDER BY sequence`)
        .toEqual([{ state: 'received' }, { state: 'interpreted' }]);
    } finally { await cleanupDeferredContext(fixture); }
  });

  it('confirms the stored Resume once and recovers that fact without rebinding the pause', async () => {
    const runId = await seedResumeContext();
    try {
      await acquireControl(runId);
      const receipt = await append(seeded.readerId, { runId, text: 'Resume' });
      expect(receipt.ok).toBe(true);
      const [command] = await sql`SELECT command_id,resume_anchor,expected_run_revision,plan_digest FROM run_interaction_command WHERE run_id=${runId} AND kind='resume'`;
      if (!command) throw new Error('Resume proposal missing');
      const request = { runId, commandId: command.command_id };
      const confirm = () => repository().confirmResume({ actorId: seeded.readerId, sessionId: seeded.readerSession, request });
      expect(await sql`SELECT state FROM audit_run WHERE run_id=${runId}`).toEqual([{ state: 'PAUSED' }]);
      expect(await sql`SELECT closed_at FROM run_wait WHERE run_id=${runId}`).toEqual([{ closed_at: null }]);
      expect(await repository().confirmResume({ actorId: seeded.readerId, sessionId: seeded.readerSession,
        request: { ...request, expectedControlEpoch: 99 } })).toMatchObject({ ok: false, code: 'malformed' });
      expect(await repository().confirmResume({ actorId: seeded.pagerId, sessionId: seeded.readerSession, request }))
        .toMatchObject({ ok: false, code: 'denied' });
      const results = await confirmConcurrentExactRequest(confirm);
      expect(results).toContainEqual({ ok: true, commandId: command.command_id, state: 'applied', replayed: false });
      expect(results).toContainEqual({ ok: true, commandId: command.command_id, state: 'applied', replayed: true });
      expect(await sql`SELECT state,revision FROM audit_run WHERE run_id=${runId}`)
        .toEqual([{ state: 'RUNNING', revision: Number(command.expected_run_revision) + 1 }]);
      const facts = await sql`SELECT event_id,payload FROM audit_events WHERE aggregate_id=${runId} AND event_type='lifecycle.run-resumed'`;
      expect(facts).toHaveLength(1);
      expect(facts[0]?.payload).toMatchObject({ ...command.resume_anchor, commandId: command.command_id,
        expectedRunRevision: command.expected_run_revision, planDigest: command.plan_digest });
      expect(await sql`SELECT state FROM run_interaction_transition WHERE command_id=${command.command_id} ORDER BY sequence`)
        .toEqual([{ state: 'received' }, { state: 'interpreted' }, { state: 'applied' }]);
      // A later lease release cannot undo this accepted outcome or cause another Resume.
      expect(await releaseRunControlLease(controlDependencies(), { session: readerSession(), request: { runId, expectedEpoch: 1 } })).toMatchObject({ ok: true });
      expect(await confirm()).toMatchObject({ ok: true, state: 'applied', replayed: true });
      const read = await repository().read({ runId, actorId: seeded.readerId });
      expect(read.status).toBe('ready');
      expect(read.messages.find(row => row.command?.commandId === command.command_id)?.command)
        .toMatchObject({ kind: 'resume', state: 'applied', canConfirm: false });
      // The read must not imply application after the authoritative event is unavailable.
      await sql`DELETE FROM audit_events WHERE event_id=${facts[0]!.event_id}`;
      expect(await confirm()).toMatchObject({ ok: false, code: 'unavailable' });
      expect(await repository().read({ runId, actorId: seeded.readerId })).toMatchObject({ status: 'unavailable' });
    } finally { await sql`DELETE FROM pgboss.job WHERE data->>'runId'=${runId}`; await cleanupRun(runId); }
  });

  it.each(['stale-control', 'removed-content', 'role-revoked'] as const)('refuses a Resume proposal after %s without closing the pause', async mode => {
    const runId = await seedResumeContext();
    const [originalRole] = await sql`SELECT role,assigned_by,assigned_at::text AS assigned_at FROM user_role WHERE user_id=${seeded.readerId}`;
    try {
      await acquireControl(runId);
      expect((await append(seeded.readerId, { runId, text: 'Resume' })).ok).toBe(true);
      const [command] = await sql`SELECT command_id,message_id FROM run_interaction_command WHERE run_id=${runId} AND kind='resume'`;
      if (!command) throw new Error('Resume proposal missing');
      if (mode === 'stale-control') {
        expect(await releaseRunControlLease(controlDependencies(), { session: readerSession(), request: { runId, expectedEpoch: 1 } })).toMatchObject({ ok: true });
        await acquireControl(runId, seeded.readerId, 2);
      } else if (mode === 'removed-content') {
        await sql`UPDATE run_conversation_content SET ciphertext=NULL,removed_at=clock_timestamp(),content_epoch=content_epoch+1
          WHERE message_id IN (SELECT message_id FROM run_conversation_message WHERE parent_message_id=${command.message_id})`;
      } else await sql`DELETE FROM user_role WHERE user_id=${seeded.readerId}`;
      expect(await repository().confirmResume({ actorId: seeded.readerId, sessionId: seeded.readerSession,
        request: { runId, commandId: command.command_id } })).toMatchObject({ ok: false,
          code: mode === 'stale-control' ? 'conflict' : mode === 'removed-content' ? 'unavailable' : 'denied' });
      expect(await sql`SELECT state FROM audit_run WHERE run_id=${runId}`).toEqual([{ state: 'PAUSED' }]);
      expect(await sql`SELECT closed_at FROM run_wait WHERE run_id=${runId}`).toEqual([{ closed_at: null }]);
      expect(await sql`SELECT event_id FROM audit_events WHERE aggregate_id=${runId} AND event_type='lifecycle.run-resumed'`).toHaveLength(0);
    } finally {
      if (mode === 'role-revoked' && originalRole) await sql`INSERT INTO user_role(user_id,role,assigned_by,assigned_at)
        VALUES (${seeded.readerId},${originalRole.role},${originalRole.assigned_by},${originalRole.assigned_at}::timestamptz)`;
      await sql`DELETE FROM pgboss.job WHERE data->>'runId'=${runId}`;
      await cleanupRun(runId);
    }
  });

  it.each(['QUEUED', 'PAUSED', 'AWAITING_AUDITOR'] as const)('confirms Stop without a lease on %s and retains one exact applied receipt', async state => {
    const runId = await seedResumeContext();
    try {
      await sql`UPDATE audit_run SET state=${state} WHERE run_id=${runId}`;
      const commandId = await proposeStop(runId);
      expect(await sql`SELECT cancel_requested_at FROM audit_run WHERE run_id=${runId}`).toEqual([{ cancel_requested_at: null }]);
      expect(await confirmStop(runId, commandId)).toMatchObject({ ok: true, state: 'applied', replayed: false });
      expect(await confirmStop(runId, commandId)).toMatchObject({ ok: true, state: 'applied', replayed: true });
      expect(await sql`SELECT state,cancel_requested_command_id FROM audit_run WHERE run_id=${runId}`)
        .toEqual([{ state: 'CANCELED', cancel_requested_command_id: commandId }]);
      expect(await sql`SELECT * FROM run_result WHERE run_id=${runId}`).toHaveLength(1);
      expect(await sql`SELECT * FROM run_evidence_package WHERE run_id=${runId}`).toHaveLength(1);
      expect(await sql`SELECT * FROM audit_events WHERE aggregate_id=${runId} AND event_type='lifecycle.run-canceled'`).toHaveLength(1);
      expect((await repository().read({ runId, actorId: seeded.readerId })).messages.find(row => row.command?.commandId === commandId)?.command)
        .toMatchObject({ kind: 'stop', state: 'applied', canConfirm: false });
    } finally { await cleanupRun(runId); }
  });

  it('keeps Stop queued until actual worker cancellation and recovers the same command after both responses', async () => {
    const runId = await seedResumeContext();
    try {
      await sql`UPDATE audit_run SET state='RUNNING' WHERE run_id=${runId}`;
      const commandId = await proposeStop(runId);
      expect(await confirmStop(runId, commandId)).toMatchObject({ ok: true, state: 'queued', replayed: false });
      expect(await confirmStop(runId, commandId)).toMatchObject({ ok: true, state: 'queued', replayed: true });
      expect(await sql`SELECT state FROM audit_run WHERE run_id=${runId}`).toEqual([{ state: 'RUNNING' }]);
      await db.transaction(tx => withRunExecutionContext(tx, runId, async context => {
        if (!context.run?.cancellation) throw new Error('Cancellation marker missing');
        // The marker is read through the same persistence port used after worker restart.
        expect(await context.readCancellation()).toMatchObject({ commandId });
        await performCancellation(context, { run: context.run, request: context.run.cancellation,
          at: new Date().toISOString(), plan: seeded.plan, source: 'worker' });
      }));
      expect(await confirmStop(runId, commandId)).toMatchObject({ ok: true, state: 'applied', replayed: true });
      expect(await sql`SELECT state FROM run_interaction_transition WHERE command_id=${commandId} ORDER BY sequence`)
        .toEqual([{ state: 'received' }, { state: 'interpreted' }, { state: 'queued' }, { state: 'applied' }]);
      expect(await sql`SELECT * FROM audit_events WHERE aggregate_id=${runId} AND event_type IN ('lifecycle.run-canceled','lifecycle.run-cancel-requested')`).toHaveLength(2);
      const [fact] = await sql`SELECT source_event_id FROM run_interaction_transition WHERE command_id=${commandId} AND state='applied'`;
      await sql`DELETE FROM audit_events WHERE event_id=${fact!.source_event_id}`;
      expect(await confirmStop(runId, commandId)).toMatchObject({ ok: false, code: 'unavailable' });
      expect(await repository().read({ runId, actorId: seeded.readerId })).toMatchObject({ status: 'unavailable' });
    } finally { await cleanupRun(runId); }
  });

  it.each(['revision', 'removed-content', 'other-actor', 'wrong-run', 'role-revoked', 'competing-stop', 'terminal'] as const)
    ('refuses confirmed Stop after %s without taking cancellation ownership', async mode => {
    const runId = await seedResumeContext();
    const [originalRole] = await sql`SELECT role,assigned_by,assigned_at::text AS assigned_at FROM user_role WHERE user_id=${seeded.readerId}`;
    try {
      await sql`UPDATE audit_run SET state='RUNNING' WHERE run_id=${runId}`;
      const commandId = await proposeStop(runId);
      if (mode === 'revision') await sql`UPDATE audit_run SET state='AWAITING_AUDITOR' WHERE run_id=${runId}`;
      if (mode === 'removed-content') await sql`UPDATE run_conversation_content SET ciphertext=NULL,removed_at=clock_timestamp(),content_epoch=content_epoch+1
        WHERE message_id IN (SELECT message_id FROM run_interaction_command WHERE command_id=${commandId})`;
      if (mode === 'role-revoked') await sql`DELETE FROM user_role WHERE user_id=${seeded.readerId}`;
      if (mode === 'competing-stop' || mode === 'terminal') {
        expect(await cancelRun({ roles: new DrizzleRoleRepository(db), unitOfWork: new PostgresAuditUnitOfWork(db),
          repository: new PostgresRunCancellationRepository(db), ids, clock: { now: () => now } },
          { session: readerSession(seeded.pagerId), request: { runId, reason: null } })).toMatchObject({ ok: true, pending: true });
        if (mode === 'terminal') await db.transaction(tx => withRunExecutionContext(tx, runId, async context => {
          if (!context.run?.cancellation) throw new Error('Competing cancellation marker missing');
          await performCancellation(context, { run: context.run, request: context.run.cancellation,
            at: new Date().toISOString(), plan: seeded.plan, source: 'worker' });
        }));
      }
      if (['revision', 'competing-stop', 'terminal'].includes(mode)) {
        const pendingRead = await repository().read({ runId, actorId: seeded.readerId });
        expect(pendingRead.messages.find(row => row.command?.commandId === commandId)?.command)
          .toMatchObject({ state: 'interpreted', canConfirm: false });
      }
      expect(await repository().confirmStop({ actorId: mode === 'other-actor' ? seeded.pagerId : seeded.readerId,
        sessionId: seeded.readerSession, request: { runId: mode === 'wrong-run' ? seeded.otherRunId : runId, commandId } })).toMatchObject({ ok: false });
      if (mode === 'role-revoked') expect(await sql`SELECT event_id FROM audit_events WHERE actor_id=${seeded.readerId}
        AND correlation_id=(SELECT correlation_id::text FROM audit_run WHERE run_id=${runId}) AND event_type='security.denied' AND payload->>'action'='run.cancel'`).toHaveLength(1);
      if (['revision', 'competing-stop', 'terminal'].includes(mode)) {
        const read = await repository().read({ runId, actorId: seeded.readerId });
        expect(read.messages.find(row => row.command?.commandId === commandId)?.command).toMatchObject({ canConfirm: false });
      }
      expect(await sql`SELECT cancel_requested_command_id FROM audit_run WHERE run_id=${runId}`).toEqual([{ cancel_requested_command_id: null }]);
      expect(await sql`SELECT * FROM audit_events WHERE aggregate_id=${runId} AND payload->>'commandId'=${commandId} AND event_type='lifecycle.run-canceled'`).toHaveLength(0);
    } finally {
      if (mode === 'role-revoked' && originalRole) await sql`INSERT INTO user_role(user_id,role,assigned_by,assigned_at)
        VALUES (${seeded.readerId},${originalRole.role},${originalRole.assigned_by},${originalRole.assigned_at}::timestamptz)`;
      await cleanupRun(runId);
    }
  });

  it('rolls back cancellation, sealing and its projected receipt with the enclosing transaction', async () => {
    const runId = await seedResumeContext();
    try {
      const commandId = await proposeStop(runId);
      await expect(db.transaction(async tx => {
        const result = await new PostgresRunConversationRepository(tx, cipher, () => now).confirmStop({
          actorId: seeded.readerId, sessionId: seeded.readerSession, request: { runId, commandId } });
        expect(result).toMatchObject({ ok: true, state: 'applied' });
        throw new Error('rollback after real cancellation');
      })).rejects.toThrow('rollback after real cancellation');
      expect(await sql`SELECT state,cancel_requested_command_id FROM audit_run WHERE run_id=${runId}`)
        .toEqual([{ state: 'PAUSED', cancel_requested_command_id: null }]);
      expect(await sql`SELECT * FROM run_result WHERE run_id=${runId}`).toHaveLength(0);
      expect(await sql`SELECT * FROM run_evidence_package WHERE run_id=${runId}`).toHaveLength(0);
      expect(await sql`SELECT state FROM run_interaction_transition WHERE command_id=${commandId} ORDER BY sequence`)
        .toEqual([{ state: 'received' }, { state: 'interpreted' }]);
      expect(await confirmStop(runId, commandId)).toMatchObject({ ok: true, state: 'applied' });
    } finally { await cleanupRun(runId); }
  });

  it.each(['removed', 'corrupt'] as const)('refuses Stop with an intact intake and %s child proposal', async mode => {
    const runId = await seedResumeContext();
    try {
      class DamagedStopCipher extends ConversationContentCipher {
        override seal(runId: string, messageId: string, content: string): string {
          return (JSON.parse(content) as { text: string }).text.startsWith('Review Stop ') ? 'v1.AAAA' : super.seal(runId, messageId, content);
        }
      }
      const writer = mode === 'corrupt' ? new PostgresRunConversationRepository(db, new DamagedStopCipher('11'.repeat(32)), () => now) : repository();
      expect(await writer.append({ actorId: seeded.readerId, sessionId: seeded.readerSession,
        request: { runId, idempotencyKey: ids.next(), text: 'Stop' } })).toMatchObject({ ok: true });
      const [proposal] = await sql`SELECT c.command_id,child.message_id FROM run_interaction_command c
        JOIN run_conversation_message child ON child.parent_message_id=c.message_id WHERE c.run_id=${runId} AND c.kind='stop'`;
      if (!proposal) throw new Error('Stop proposal missing');
      if (mode === 'removed') await sql`UPDATE run_conversation_content SET ciphertext=NULL,removed_at=clock_timestamp(),content_epoch=content_epoch+1 WHERE message_id=${proposal.message_id}`;
      expect(await confirmStop(runId, proposal.command_id)).toMatchObject({ ok: false, code: 'unavailable' });
      expect(await sql`SELECT cancel_requested_at FROM audit_run WHERE run_id=${runId}`).toEqual([{ cancel_requested_at: null }]);
    } finally { await cleanupRun(runId); }
  });

  it('refuses a changed frozen plan without refreshing the original proposal', async () => {
    const runId = await seedResumeContext();
    try {
      const commandId = await proposeStop(runId);
      const changed = { ...seeded.plan, inputs: { ...seeded.plan.inputs, scope: 'Changed frozen scope' } };
      const reader = vi.spyOn(DrizzleFrozenExecutionReader.prototype, 'readFrozenExecution').mockResolvedValueOnce(changed);
      try { expect(await confirmStop(runId, commandId)).toMatchObject({ ok: false, code: 'conflict' }); }
      finally { reader.mockRestore(); }
      expect(await sql`SELECT cancel_requested_at FROM audit_run WHERE run_id=${runId}`).toEqual([{ cancel_requested_at: null }]);
    } finally { await cleanupRun(runId); }
  });

  it.each(['same', 'different'] as const)('serializes %s Stop confirmations to one cancellation owner', async mode => {
    const runId = await seedResumeContext();
    try {
      await sql`UPDATE audit_run SET state='RUNNING' WHERE run_id=${runId}`;
      const first = await proposeStop(runId);
      let second = first;
      if (mode === 'different') {
        const receipt = await append(seeded.readerId, { runId, text: 'Stop' });
        if (!receipt.ok) throw new Error(receipt.reason);
        const [other] = await sql`SELECT command_id FROM run_interaction_command WHERE message_id=${receipt.messageId}`;
        second = String(other!.command_id);
      }
      const outcomes = await Promise.all([confirmStop(runId, first), confirmStop(runId, second)]);
      expect(outcomes.filter(outcome => outcome.ok && !outcome.replayed)).toHaveLength(1);
      expect(outcomes.filter(outcome => mode === 'same' ? outcome.ok && outcome.replayed : !outcome.ok)).toHaveLength(1);
      expect(await sql`SELECT * FROM audit_events WHERE aggregate_id=${runId} AND event_type='lifecycle.run-cancel-requested'`).toHaveLength(1);
    } finally { await cleanupRun(runId); }
  });

  it('locks both governed bodies until confirmed Stop commits', async () => {
    const runId = await seedResumeContext();
    try {
      const commandId = await proposeStop(runId);
      await db.transaction(async tx => {
        expect(await new PostgresRunConversationRepository(tx, cipher).confirmStop({ actorId: seeded.readerId,
          sessionId: seeded.readerSession, request: { runId, commandId } })).toMatchObject({ ok: true });
        const bodies = await sql`SELECT m.message_id FROM run_conversation_message m JOIN run_interaction_command c
          ON m.message_id=c.message_id OR m.parent_message_id=c.message_id WHERE c.command_id=${commandId} ORDER BY m.message_id`;
        expect(bodies).toHaveLength(2);
        for (const body of bodies) await expect(sql.begin(async removing => {
          await removing`SET LOCAL lock_timeout='100ms'`;
          await removing`UPDATE run_conversation_content SET ciphertext=NULL,removed_at=clock_timestamp(),content_epoch=content_epoch+1 WHERE message_id=${body.message_id}`;
        })).rejects.toMatchObject({ code: '55P03' });
      });
    } finally { await cleanupRun(runId); }
  });

  it('binds the cancellation latch to the exact Stop and rejects reassignment or clearing', async () => {
    const runId = await seedResumeContext();
    try {
      await sql`UPDATE audit_run SET state='RUNNING' WHERE run_id=${runId}`;
      const commandId = await proposeStop(runId);
      const [pause] = await sql`SELECT command_id FROM run_interaction_command WHERE run_id=${runId} AND kind='pause-now'`;
      for (const candidate of [{ runId, commandId: pause!.command_id, actor: seeded.readerId },
        { runId, commandId, actor: seeded.pagerId }, { runId: seeded.otherRunId, commandId, actor: seeded.readerId }]) {
        await expect(sql`UPDATE audit_run SET cancel_requested_command_id=${candidate.commandId},cancel_requested_at=clock_timestamp(),
          cancel_requested_by=${candidate.actor},cancel_requested_session=${seeded.readerSession},cancel_reason='Cancel'
          WHERE run_id=${candidate.runId}`).rejects.toMatchObject({ code: '23514' });
      }
      expect(await confirmStop(runId, commandId)).toMatchObject({ ok: true, state: 'queued' });
      await expect(sql`UPDATE audit_run SET cancel_requested_command_id=NULL WHERE run_id=${runId}`).rejects.toMatchObject({ code: '23514' });
      await expect(sql`UPDATE audit_run SET cancel_requested_command_id=${pause!.command_id} WHERE run_id=${runId}`).rejects.toMatchObject({ code: '23514' });
      for (const field of ['cancel_requested_by', 'cancel_requested_session', 'cancel_reason'])
        await expect(sql.unsafe(`UPDATE audit_run SET ${field}=$1 WHERE run_id=$2`, ['changed', runId])).rejects.toMatchObject({ code: '23514' });
      await expect(sql`UPDATE audit_run SET cancel_requested_at=cancel_requested_at+interval '1 second' WHERE run_id=${runId}`).rejects.toMatchObject({ code: '23514' });
    } finally { await cleanupRun(runId); }
  });

  it.each(['session', 'requested-at', 'reason', 'source', 'prior-state', 'actor', 'command', 'run', 'still-running', 'unsealed'] as const)
    ('rejects a forged applied Stop fact with %s disagreement', async mode => {
    const runId = await seedResumeContext();
    try {
      await sql`UPDATE audit_run SET state='RUNNING' WHERE run_id=${runId}`;
      const commandId = await proposeStop(runId);
      expect(await confirmStop(runId, commandId)).toMatchObject({ ok: true, state: 'queued' });
      const [request] = await sql`SELECT * FROM audit_events WHERE aggregate_id=${runId} AND event_type='lifecycle.run-cancel-requested'`;
      if (!request) throw new Error('Cancellation request event missing');
      const at = new Date().toISOString();
      const payload = { ...request.payload, state: 'CANCELED', priorState: mode === 'prior-state' ? 'QUEUED' : 'RUNNING',
        occurredAt: at, performedBy: mode === 'source' ? 'web' : 'worker',
        ...(mode === 'requested-at' ? { requestedAt: '2026-01-01T00:00:00.000Z' } : {}),
        ...(mode === 'reason' ? { reason: 'Another reason' } : {}), ...(mode === 'command' ? { commandId: ids.next() } : {}) };
      await expect(sql.begin(async forging => {
        if (mode !== 'still-running') await forging`UPDATE audit_run SET state='CANCELED' WHERE run_id=${runId}`;
        const eventId = ids.next();
        await forging`INSERT INTO audit_events(event_id,actor_type,actor_id,event_type,occurred_at,source,outcome,session_id,
          correlation_id,aggregate_id,sequence,payload,previous_hash,event_hash)
          SELECT ${eventId},actor_type,${mode === 'actor' ? seeded.pagerId : seeded.readerId},'lifecycle.run-canceled',${at}::timestamptz,
          ${mode === 'source' ? 'web' : 'worker'},outcome,${mode === 'session' ? 'wrong-session' : request.session_id},
          correlation_id,${mode === 'run' ? seeded.otherRunId : runId},(SELECT coalesce(max(e.sequence),0)+1 FROM audit_events e WHERE e.aggregate_id=${mode === 'run' ? seeded.otherRunId : runId}),${JSON.stringify(payload)}::jsonb,previous_hash,event_hash
          FROM audit_events WHERE event_id=${request.event_id}`;
        await forging`INSERT INTO run_interaction_transition(command_id,sequence,state,reason_code,created_at,source_event_id)
          VALUES (${commandId},4,'applied','run-canceled',${at}::timestamptz,${eventId})`;
      })).rejects.toMatchObject({ code: '23514' });
      expect(await confirmStop(runId, commandId)).toMatchObject({ ok: true, state: 'queued', replayed: true });
    } finally { await cleanupRun(runId); }
  });

  it('does not replay or display an applied Stop after its sealed Result is unavailable', async () => {
    const runId = await seedResumeContext();
    try {
      const commandId = await proposeStop(runId);
      expect(await confirmStop(runId, commandId)).toMatchObject({ ok: true, state: 'applied' });
      await sql`DELETE FROM run_result WHERE run_id=${runId}`;
      expect(await confirmStop(runId, commandId)).toMatchObject({ ok: false, code: 'unavailable' });
      expect(await repository().read({ runId, actorId: seeded.readerId })).toMatchObject({ status: 'unavailable' });
      await expect(sql`UPDATE audit_run SET state='RUNNING' WHERE run_id=${runId}`).rejects.toMatchObject({ code: '23514' });
    } finally { await cleanupRun(runId); }
  });

  it.each(['immediate', 'deferred'] as const)('preserves %s pause supersession when confirmed Stop wins', async mode => {
    const fixture = await seedDeferredContext();
    try {
      let pauseCommand: string;
      if (mode === 'deferred') {
        await acquireControl(fixture.runId);
        pauseCommand = await proposeInspection(fixture.runId, (await currentInspection(fixture.runId)).anchor);
        expect(await confirmInspection(fixture.runId, pauseCommand)).toMatchObject({ ok: true, state: 'queued' });
      } else {
        expect(await append(seeded.readerId, { runId: fixture.runId, text: 'pause now' })).toMatchObject({ ok: true });
        const [pause] = await sql`SELECT command_id FROM run_interaction_command WHERE run_id=${fixture.runId} AND kind='pause-now'`;
        pauseCommand = String(pause!.command_id);
      }
      const commandId = await proposeStop(fixture.runId);
      expect(await confirmStop(fixture.runId, commandId)).toMatchObject({ ok: true, state: 'queued' });
      await db.transaction(tx => withRunExecutionContext(tx, fixture.runId, async context => {
        if (!context.run?.cancellation) throw new Error('Stop marker missing');
        await performCancellation(context, { run: context.run, request: context.run.cancellation,
          at: new Date().toISOString(), plan: fixture.plan, source: 'worker' });
      }));
      expect(await sql`SELECT state FROM run_interaction_transition WHERE command_id=${pauseCommand} ORDER BY sequence DESC LIMIT 1`)
        .toEqual([{ state: 'superseded' }]);
      expect(await confirmStop(fixture.runId, commandId)).toMatchObject({ ok: true, state: 'applied' });
    } finally {
      await sql`DELETE FROM notification WHERE run_id=${fixture.runId}`;
      await sql`DELETE FROM run_result WHERE run_id=${fixture.runId}`;
      await sql`DELETE FROM run_gate_check WHERE run_id=${fixture.runId}`;
      await sql`DELETE FROM run_evidence_package WHERE run_id=${fixture.runId}`;
      await cleanupDeferredContext(fixture);
    }
  });

  async function proposeStop(runId: string) {
    const [wait] = await sql`SELECT wait_id FROM run_wait WHERE run_id=${runId} AND closed_at IS NULL LIMIT 1`;
    expect(await append(seeded.readerId, { runId, text: 'Stop', selectedSourceOrdinal: 999999, replyToWaitId: wait?.wait_id ?? null })).toMatchObject({ ok: true });
    const [command] = await sql`SELECT command_id FROM run_interaction_command WHERE run_id=${runId} AND kind='stop'`;
    if (!command) throw new Error('Stop proposal missing');
    return command.command_id as string;
  }
  function confirmStop(runId: string, commandId: string) {
    return repository().confirmStop({ actorId: seeded.readerId, sessionId: seeded.readerSession, request: { runId, commandId } });
  }

  async function seedAnswerContext(expiresInMs?: number) {
    const fixture = await seedDeferredContext();
    const target = classifyPlanTargets(fixture.plan).agents[0]!;
    const options = FIXED_ESCALATION_OPTIONS['retry-or-skip'];
    await sql`UPDATE run_agent_work SET status='WAITING',pending_wait=${JSON.stringify({ kind: 'retry-or-skip', options })}::jsonb WHERE run_id=${fixture.runId}`;
    await sql`UPDATE run_work_item SET state='AWAITING' WHERE work_item_id=${fixture.exactWorkItemId}`;
    // Create an authentic initial deadline; immutable question fields are never rewritten.
    const openedAt = new Date(Date.now() - (expiresInMs === undefined ? 0 : waitTimeoutMs('retry-or-skip') - expiresInMs));
    const raised = await raiseEscalation({ repository: new PostgresWaitRepository(db), ids, clock: { now: () => openedAt } },
      { runId: fixture.runId, kind: 'retry-or-skip', stepId: target.stepId, supportingEvidenceIds: [] });
    if (!raised.ok) throw new Error(raised.reason);
    const question = await new PostgresWaitRepository(db).transaction(fixture.runId, context => context.readConversationQuestion!());
    if (!question) throw new Error('Answer fixture question missing');
    return { ...fixture, waitId: raised.wait.waitId, question };
  }

  async function proposeAnswer(fixture: Awaited<ReturnType<typeof seedAnswerContext>>, text = 'Retry', writer = repository()) {
    const request = { runId: fixture.runId, idempotencyKey: ids.next(), text, replyToWaitId: fixture.waitId,
      questionAnchor: fixture.question.anchor, selectedSourceOrdinal: null };
    const receipt = await writer.append({ actorId: seeded.readerId, sessionId: seeded.readerSession, request });
    if (!receipt.ok) throw new Error(receipt.reason);
    const [command] = await sql`SELECT command_id,message_id,answer_anchor,answer_option_id FROM run_interaction_command WHERE message_id=${receipt.messageId}`;
    if (!command) throw new Error('Answer proposal missing');
    return { commandId: String(command.command_id), request, receipt };
  }
  const confirmAnswer = (runId: string, commandId: string, actorId = seeded.readerId) => repository().confirmAnswer({
    actorId, sessionId: seeded.readerSession, request: { runId, commandId },
  });

  it.each([undefined, null])('replays an authentic pre-0059 note fingerprint with questionAnchor %s', async questionAnchor => {
    now = new Date(now.getTime() + 61_000);
    const request = { runId: seeded.runId, idempotencyKey: ids.next(), text: 'A retained note', selectedSourceOrdinal: null, replyToWaitId: null };
    const originalSemantic = JSON.stringify({ schemaVersion: 1, runId: request.runId, actorId: seeded.readerId,
      text: request.text, selectedSourceOrdinal: null, replyToWaitId: null });
    class Pre0059Cipher extends ConversationContentCipher {
      override fingerprint(_semantic: string) { return super.fingerprint(originalSemantic); }
    }
    const oldRepository = new PostgresRunConversationRepository(db, new Pre0059Cipher('11'.repeat(32)), () => now);
    const original = await oldRepository.append({ actorId: seeded.readerId, sessionId: seeded.readerSession, request });
    expect(original.ok).toBe(true);
    if (!original.ok) return;
    expect(await repository().append({ actorId: seeded.readerId, sessionId: seeded.readerSession,
      request: { ...request, ...(questionAnchor === undefined ? {} : { questionAnchor }) } }))
      .toEqual({ ...original, replayed: true });
  });

  it.each(['pending-options','raised-options','raised-deadline','raised-kind','raised-step','raised-evidence'] as const)
    ('makes inconsistent %s provenance unavailable without a command or effect', async mode => {
      const fixture = await seedAnswerContext();
      try {
        if (mode === 'pending-options') await sql`UPDATE run_agent_work SET pending_wait=jsonb_set(pending_wait,'{options}',
          '[{"id":"retry","label":"Changed meaning"}]'::jsonb) WHERE run_id=${fixture.runId}`;
        else {
          const patch = mode === 'raised-options' ? { optionIds: ['retry'] } : mode === 'raised-deadline' ? { deadline: '2030-01-01T00:00:00.000Z' }
            : mode === 'raised-kind' ? { kind: 'choose-candidate' } : mode === 'raised-step' ? { stepId: 'another-step' } : { supportingEvidenceIds: [null] };
          await sql`UPDATE audit_events SET payload=payload||${JSON.stringify(patch)}::jsonb WHERE event_id=${fixture.question.anchor.raisedEventId}`;
        }
        expect(await new PostgresWaitRepository(db).transaction(fixture.runId, context => context.readConversationQuestion!())).toBeNull();
        expect(await repository().append({ actorId: seeded.readerId, sessionId: seeded.readerSession,
          request: { runId: fixture.runId, idempotencyKey: ids.next(), text: 'Retry', replyToWaitId: fixture.waitId, questionAnchor: fixture.question.anchor } }))
          .toMatchObject({ ok: false });
        expect(await sql`SELECT command_id FROM run_interaction_command WHERE run_id=${fixture.runId}`).toHaveLength(0);
        expect(await sql`SELECT event_id FROM audit_events WHERE aggregate_id=${fixture.runId} AND event_type='execution.escalation-answered'`).toHaveLength(0);
        expect(await sql`SELECT closed_at FROM run_wait WHERE wait_id=${fixture.waitId}`).toEqual([{ closed_at: null }]);
      } finally { await cleanupDeferredContext(fixture); }
    });

  it('requires readable intake even when only the proposal is on the history page', async () => {
    const fixture = await seedAnswerContext();
    try {
      const proposal = await proposeAnswer(fixture);
      const [child] = await sql`SELECT sequence FROM run_conversation_message WHERE parent_message_id=${proposal.receipt.messageId}`;
      // Add 49 visible source events: page one retains the proposal while its intake is on page two.
      for (let i = 0; i < 49; i++) await appendWorkspaceEvent(fixture.runId);
      await sql`UPDATE run_conversation_content SET ciphertext=NULL,removed_at=clock_timestamp(),content_epoch=content_epoch+1 WHERE message_id=${proposal.receipt.messageId}`;
      const read = await repository().read({ runId: fixture.runId, actorId: seeded.readerId });
      expect(read.messages.some(m => m.messageId === proposal.receipt.messageId)).toBe(false);
      expect(read.messages.find(m => m.sequence === Number(child!.sequence))?.command)
        .toMatchObject({ canConfirm: false, reason: expect.stringContaining('removed or unavailable') });
      expect(read.messages.find(m => m.sequence === Number(child!.sequence))?.command?.answerQuestion).toBeUndefined();
    } finally { await cleanupDeferredContext(fixture); }
  });

  it('retains an answer receipt when another question opens in the same outer transaction', async () => {
    const fixture = await seedAnswerContext();
    try {
      const proposal = await proposeAnswer(fixture);
      await db.transaction(async tx => {
        expect(await new PostgresRunConversationRepository(tx as unknown as Database, cipher, () => now).confirmAnswer({
          actorId: seeded.readerId, sessionId: seeded.readerSession, request: { runId: fixture.runId, commandId: proposal.commandId },
        })).toMatchObject({ ok: true });
        await new PostgresAgentWorkRepository(tx as unknown as Database).transaction(fixture.runId, async context => {
          if (!context.checkpoint) throw new Error('Expected the existing worker checkpoint');
          await context.saveCheckpoint({ ...context.checkpoint, waitId: null }, 'RUNNING');
        });
        expect(await raiseEscalation({ repository: new PostgresWaitRepository(tx as unknown as Database), ids, clock: { now: () => new Date() } },
          { runId: fixture.runId, kind: 'retry-or-skip', stepId: classifyPlanTargets(fixture.plan).agents[0]!.stepId, supportingEvidenceIds: [] })).toMatchObject({ ok: true });
      });
      expect(await confirmAnswer(fixture.runId, proposal.commandId)).toMatchObject({ ok: true, replayed: true });
      expect(await sql`SELECT state FROM audit_run WHERE run_id=${fixture.runId}`).toEqual([{ state: 'AWAITING_AUDITOR' }]);
    } finally { await cleanupDeferredContext(fixture); }
  });

  it('answers exactly once without controller ownership and reauthorizes historical recovery', async () => {
    const fixture = await seedAnswerContext();
    try {
      const proposal = await proposeAnswer(fixture, 'answer: RETRY');
      expect(await sql`SELECT closed_at FROM run_wait WHERE wait_id=${fixture.waitId}`).toEqual([{ closed_at: null }]);
      expect(await sql`SELECT run_id FROM run_control_lease WHERE run_id=${fixture.runId}`).toHaveLength(0);
      const results = await confirmConcurrentExactRequest(() => confirmAnswer(fixture.runId, proposal.commandId));
      expect(results).toContainEqual({ ok: true, commandId: proposal.commandId, state: 'applied', replayed: false });
      expect(results).toContainEqual({ ok: true, commandId: proposal.commandId, state: 'applied', replayed: true });
      const [closed] = await sql`SELECT actor,answer_option_id,closure_kind,closed_at::text FROM run_wait WHERE wait_id=${fixture.waitId}`;
      expect(closed).toMatchObject({ actor: seeded.readerId, answer_option_id: 'retry', closure_kind: 'answer' });
      const facts = await sql`SELECT payload,occurred_at::text FROM audit_events WHERE aggregate_id=${fixture.runId} AND event_type='execution.escalation-answered'`;
      expect(facts).toHaveLength(1);
      expect(facts[0]?.occurred_at).toBe(closed?.closed_at);
      expect(facts[0]?.payload).toMatchObject({ commandId: proposal.commandId, questionAnchor: fixture.question.anchor, answerOptionId: 'retry' });
      expect(facts[0]?.payload.recordedNote).toBeUndefined();
      expect(await repository().append({ actorId: seeded.readerId, sessionId: seeded.readerSession, request: proposal.request }))
        .toEqual({ ...proposal.receipt, replayed: true });
      expect(await repository().append({ actorId: seeded.readerId, sessionId: seeded.readerSession, request: { ...proposal.request, text: 'Skip' } }))
        .toMatchObject({ ok: false, code: 'conflict' });
      const read = await repository().read({ runId: fixture.runId, actorId: seeded.readerId });
      expect(read.messages.find(m => m.command?.commandId === proposal.commandId)?.command).toMatchObject({ kind: 'answer', state: 'applied', canConfirm: false });
      await sql`DELETE FROM user_role WHERE user_id=${seeded.readerId}`;
      try { expect(await confirmAnswer(fixture.runId, proposal.commandId)).toMatchObject({ ok: false, code: 'denied' }); }
      finally { await sql`INSERT INTO user_role(user_id,role) VALUES (${seeded.readerId},'auditor')`; }
      expect(await confirmAnswer(fixture.runId, proposal.commandId)).toMatchObject({ ok: true, replayed: true });
    } finally { await cleanupDeferredContext(fixture); }
  });

  it('clarifies unsupported, negated, conditional and ambiguous answers without an executable proposal', async () => {
    const fixture = await seedAnswerContext();
    try {
      for (const text of ['yes', 'do not retry', 'retry if safe', 'retry and skip', 'answer: answer: retry', 'answer: do not retry', 'answer: retry if safe']) {
        now = new Date(now.getTime() + 61_000);
        expect(await repository().append({ actorId: seeded.readerId, sessionId: seeded.readerSession,
          request: { runId: fixture.runId, idempotencyKey: ids.next(), text, replyToWaitId: fixture.waitId, questionAnchor: fixture.question.anchor } }))
          .toMatchObject({ ok: true });
      }
      expect(await sql`SELECT command_id FROM run_interaction_command WHERE run_id=${fixture.runId}`).toHaveLength(0);
      expect(await sql`SELECT closed_at FROM run_wait WHERE wait_id=${fixture.waitId}`).toEqual([{ closed_at: null }]);
      const read = await repository().read({ runId: fixture.runId, actorId: seeded.readerId });
      expect(read.messages.some(m => m.body?.includes('No answer was proposed.'))).toBe(true);
    } finally { await cleanupDeferredContext(fixture); }
  });

  it.each(['options', 'deadline'] as const)('rejects a forged initial %s anchor and preserves the immutable question', async mode => {
    const fixture = await seedAnswerContext();
    try {
      if (mode === 'options') {
        await expect(sql`UPDATE run_wait SET options='[{"id":"retry","label":"Changed meaning"},{"id":"skip","label":"Skip"},{"id":"abort","label":"Abort"}]'::jsonb WHERE wait_id=${fixture.waitId}`)
          .rejects.toMatchObject({ code: '23514', message: 'Wait identity and question are immutable' });
      } else {
        await expect(sql`UPDATE run_wait SET deadline=deadline+interval '1 minute' WHERE wait_id=${fixture.waitId}`)
          .rejects.toMatchObject({ code: '23514', message: 'Wait identity and question are immutable' });
      }
      const questionAnchor = { ...fixture.question.anchor, ...(mode === 'options'
        ? { questionDigest: fixture.question.anchor.questionDigest === '0'.repeat(64) ? '1'.repeat(64) : '0'.repeat(64) }
        : { deadline: new Date(Date.parse(fixture.question.anchor.deadline) + 60_000).toISOString() }) };
      expect(await repository().append({ actorId: seeded.readerId, sessionId: seeded.readerSession,
        request: { runId: fixture.runId, idempotencyKey: ids.next(), text: 'Retry', replyToWaitId: fixture.waitId, questionAnchor } }))
        .toMatchObject({ ok: false });
      expect(await sql`SELECT command_id FROM run_interaction_command WHERE run_id=${fixture.runId}`).toHaveLength(0);
      expect(await sql`SELECT event_id FROM audit_events WHERE aggregate_id=${fixture.runId} AND event_type='execution.escalation-answered'`).toHaveLength(0);
      expect(await sql`SELECT closed_at FROM run_wait WHERE wait_id=${fixture.waitId}`).toEqual([{ closed_at: null }]);
    } finally { await cleanupDeferredContext(fixture); }
  });

  it.each(['revision','expired','intake-removed','proposal-removed','proposal-corrupt','revoked','other-actor','wrong-run'] as const)
    ('refuses answer confirmation after %s with no wait effect', async mode => {
      const fixture = await seedAnswerContext(mode === 'expired' ? 5_000 : undefined);
      try {
        class DamagedAnswerCipher extends ConversationContentCipher {
          override seal(runId: string, messageId: string, content: string): string {
            return (JSON.parse(content) as { text: string }).text.startsWith('Question for ') ? 'v1.AAAA' : super.seal(runId, messageId, content);
          }
        }
        const proposal = await proposeAnswer(fixture, 'Retry', mode === 'proposal-corrupt'
          ? new PostgresRunConversationRepository(db, new DamagedAnswerCipher('11'.repeat(32)), () => now) : repository());
        if (mode === 'revision') await sql`UPDATE audit_run SET procedure_name=procedure_name||' revised' WHERE run_id=${fixture.runId}`;
        if (mode === 'expired') await new Promise(resolve => setTimeout(resolve, Math.max(0, Date.parse(fixture.question.anchor.deadline) - Date.now()) + 25));
        if (['intake-removed','proposal-removed'].includes(mode)) {
          const [child] = await sql`SELECT message_id FROM run_conversation_message WHERE parent_message_id=${proposal.receipt.messageId}`;
          const id = mode === 'intake-removed' ? proposal.receipt.messageId : String(child!.message_id);
          await sql`UPDATE run_conversation_content SET ciphertext=NULL,removed_at=clock_timestamp(),content_epoch=content_epoch+1 WHERE message_id=${id}`;
        }
        if (['revision','expired','intake-removed','proposal-removed','proposal-corrupt'].includes(mode)) {
          const read = await repository().read({ runId: fixture.runId, actorId: seeded.readerId });
          expect(read.status).toBe('ready');
          expect(read.messages.find(m => m.command?.commandId === proposal.commandId)?.command)
            .toMatchObject({ canConfirm: false, reason: expect.any(String) });
        }
        if (mode === 'revoked') await sql`DELETE FROM user_role WHERE user_id=${seeded.readerId}`;
        try {
          expect(await confirmAnswer(mode === 'wrong-run' ? fixture.otherRunId : fixture.runId, proposal.commandId,
            mode === 'other-actor' ? seeded.pagerId : seeded.readerId)).toMatchObject({ ok: false });
        } finally { if (mode === 'revoked') await sql`INSERT INTO user_role(user_id,role) VALUES (${seeded.readerId},'auditor')`; }
        expect(await sql`SELECT event_id FROM audit_events WHERE aggregate_id=${fixture.runId} AND event_type='execution.escalation-answered'`).toHaveLength(0);
        expect(await sql`SELECT closed_at FROM run_wait WHERE wait_id=${fixture.waitId}`).toEqual([{ closed_at: null }]);
      } finally { await cleanupDeferredContext(fixture); }
    });

  it('lets only one of two distinct choices win and never retargets W1 to W2', async () => {
    const fixture = await seedAnswerContext();
    try {
      const retry = await proposeAnswer(fixture), skip = await proposeAnswer(fixture, 'Skip');
      const results = await Promise.all([confirmAnswer(fixture.runId, retry.commandId), confirmAnswer(fixture.runId, skip.commandId)]);
      expect(results.filter(r => r.ok)).toHaveLength(1);
      expect(results.filter(r => !r.ok)).toHaveLength(1);
      const [closed] = await sql`SELECT answer_option_id FROM run_wait WHERE wait_id=${fixture.waitId}`;
      const winning = closed?.answer_option_id === 'retry' ? retry : skip, losing = winning === retry ? skip : retry;
      expect(await confirmAnswer(fixture.runId, losing.commandId)).toMatchObject({ ok: false, reason: expect.stringContaining('closed as answer') });
      await sql`UPDATE run_agent_work SET wait_id=NULL WHERE run_id=${fixture.runId}`;
      const raised = await raiseEscalation({ repository: new PostgresWaitRepository(db), ids, clock: { now: () => new Date() } },
        { runId: fixture.runId, kind: 'retry-or-skip', stepId: classifyPlanTargets(fixture.plan).agents[0]!.stepId, supportingEvidenceIds: [] });
      expect(raised.ok).toBe(true);
      expect(await repository().append({ actorId: seeded.readerId, sessionId: seeded.readerSession,
        request: { ...winning.request, idempotencyKey: ids.next() } })).toMatchObject({ ok: false });
      expect(await confirmAnswer(fixture.runId, winning.commandId)).toMatchObject({ ok: true, replayed: true });
      expect(await sql`SELECT wait_id FROM run_wait WHERE run_id=${fixture.runId} AND closed_at IS NULL`).toHaveLength(1);
      expect(await sql`SELECT event_id FROM audit_events WHERE aggregate_id=${fixture.runId} AND event_type='execution.escalation-answered'`).toHaveLength(1);
    } finally { await cleanupDeferredContext(fixture); }
  });

  it('refuses a conversation loser after the existing decision card wins', async () => {
    const fixture = await seedAnswerContext();
    try {
      const proposal = await proposeAnswer(fixture);
      expect(await answerEscalation({ repository: new PostgresWaitRepository(db), roles: new DrizzleRoleRepository(db),
        unitOfWork: new PostgresRunsUnitOfWork(db), ids, clock: { now: () => new Date() } },
        { session: readerSession(), request: { runId: fixture.runId, waitId: fixture.waitId,
          expectedRunRevision: fixture.question.anchor.runRevision, answerOptionId: 'skip' } })).toMatchObject({ ok: true });
      expect(await confirmAnswer(fixture.runId, proposal.commandId)).toMatchObject({ ok: false, reason: expect.stringContaining('option skip') });
    } finally { await cleanupDeferredContext(fixture); }
  });

  it('uses the existing abort cancellation and seals its partial Result', async () => {
    const fixture = await seedAnswerContext();
    try {
      const proposal = await proposeAnswer(fixture, 'Abort');
      expect(await confirmAnswer(fixture.runId, proposal.commandId)).toMatchObject({ ok: true, state: 'applied' });
      expect(await sql`SELECT state,cancel_requested_command_id FROM audit_run WHERE run_id=${fixture.runId}`)
        .toEqual([{ state: 'CANCELED', cancel_requested_command_id: null }]);
      expect(await sql`SELECT outcome,sealed FROM run_result WHERE run_id=${fixture.runId}`).toEqual([{ outcome: 'CANCELED', sealed: true }]);
      expect(await confirmAnswer(fixture.runId, proposal.commandId)).toMatchObject({ ok: true, replayed: true });
    } finally { await cleanupDeferredContext(fixture); }
  });

  it.each(['event','receipt','notification'] as const)('rolls back the whole answer if its %s write fails', async mode => {
    const fixture = await seedAnswerContext();
    try {
      const proposal = await proposeAnswer(fixture);
      const schema = 'answer_failure_' + ids.next().replaceAll('-', '');
      const table = mode === 'event' ? 'audit_events' : mode === 'receipt' ? 'run_interaction_transition' : 'audit_events';
      const predicate = mode === 'receipt' ? `NEW.command_id='${proposal.commandId}'::uuid AND NEW.state='applied'`
        : `NEW.aggregate_id='${fixture.runId}' AND NEW.event_type='execution.escalation-answered'`;
      if (mode === 'notification') {
        const original = PostgresWaitRepository.prototype.transaction;
        const spy = vi.spyOn(PostgresWaitRepository.prototype, 'transaction').mockImplementation(function (this: PostgresWaitRepository, id, work) {
          return original.call(this, id, context => work({ ...context, notifyTimeline: async () => { throw new Error('synthetic timeline notification failure'); } })) as ReturnType<typeof original>;
        });
        try { await expect(confirmAnswer(fixture.runId, proposal.commandId)).rejects.toThrow('synthetic timeline notification failure'); }
        finally { spy.mockRestore(); }
      } else {
        await sql.unsafe(`CREATE FUNCTION ${schema}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${predicate} THEN RAISE EXCEPTION 'synthetic answer failure'; END IF; RETURN NEW; END $$`);
        await sql.unsafe(`CREATE TRIGGER ${schema} BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION ${schema}()`);
        try { await expect(confirmAnswer(fixture.runId, proposal.commandId)).rejects.toThrow(); }
        finally { await sql.unsafe(`DROP TRIGGER ${schema} ON ${table}`); await sql.unsafe(`DROP FUNCTION ${schema}()`); }
      }
      expect(await sql`SELECT closed_at FROM run_wait WHERE wait_id=${fixture.waitId}`).toEqual([{ closed_at: null }]);
      expect(await sql`SELECT state FROM audit_run WHERE run_id=${fixture.runId}`).toEqual([{ state: 'AWAITING_AUDITOR' }]);
      expect(await sql`SELECT event_id FROM audit_events WHERE aggregate_id=${fixture.runId} AND event_type='execution.escalation-answered'`).toHaveLength(0);
      expect(await confirmAnswer(fixture.runId, proposal.commandId)).toMatchObject({ ok: true, replayed: false });
    } finally { await cleanupDeferredContext(fixture); }
  });

  it('rejects SQL forged or missing answer receipt bindings and preserves the authoritative event', async () => {
    const fixture = await seedAnswerContext();
    try {
      const proposal = await proposeAnswer(fixture);
      await expect(sql`UPDATE run_interaction_command SET answer_option_id='skip' WHERE command_id=${proposal.commandId}`).rejects.toMatchObject({ code: '23514' });
      await expect(sql`INSERT INTO run_interaction_transition(command_id,sequence,state,reason_code,created_at)
        VALUES (${proposal.commandId},3,'applied','forged',clock_timestamp())`).rejects.toMatchObject({ code: '23514' });
      for (const bad of [null, { ...fixture.question.anchor, runRevision: String(fixture.question.anchor.runRevision) },
        { ...fixture.question.anchor, waitId: ids.next() }]) {
        await expect(new PostgresAuditUnitOfWork(db).execute(context => context.auditEvents.append({ actor: { type: 'human', id: seeded.readerId },
          aggregateId: fixture.runId, correlationId: ids.next(), sessionId: seeded.readerSession, eventType: 'execution.escalation-answered', source: 'web', outcome: 'success',
          payload: { commandId: proposal.commandId, questionAnchor: bad } }))).rejects.toThrow();
      }
      await expect(sql.begin(async tx => {
        await tx`UPDATE run_wait SET closed_at=date_trunc('milliseconds',clock_timestamp()),closure_kind='answer',
          answer_option_id='retry',actor=${seeded.readerId},answer_command_id=${proposal.commandId} WHERE wait_id=${fixture.waitId}`;
        await tx`UPDATE audit_run SET state='RUNNING' WHERE run_id=${fixture.runId}`;
      })).rejects.toMatchObject({ code: '23514' });
      await expect(sql.begin(async tx => {
        const [clock] = await tx`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at`;
        const at = String(clock!.at), eventId = ids.next();
        const [command] = await tx`SELECT plan_digest,expected_run_revision FROM run_interaction_command WHERE command_id=${proposal.commandId}`;
        await tx`UPDATE run_wait SET closed_at=${at}::timestamptz,closure_kind='answer',answer_option_id='retry',actor=${seeded.readerId},
          answer_command_id=${proposal.commandId} WHERE wait_id=${fixture.waitId}`;
        const payload = { waitId: fixture.waitId, kind: fixture.question.anchor.kind, answerOptionId: 'retry', closureKind: 'answer',
          priorState: 'AWAITING_AUDITOR', state: 'RUNNING', occurredAt: at, commandId: proposal.commandId,
          planDigest: command!.plan_digest, expectedRunRevision: command!.expected_run_revision, questionAnchor: fixture.question.anchor };
        await tx`INSERT INTO audit_events(event_id,aggregate_id,correlation_id,session_id,actor_type,actor_id,event_type,source,outcome,occurred_at,sequence,payload,previous_hash,event_hash)
          SELECT ${eventId},${fixture.runId},${ids.next()},${seeded.readerSession},'human',${seeded.readerId},'execution.escalation-answered','web','success',
            ${at}::timestamptz,max(sequence)+1,${JSON.stringify(payload)}::jsonb,${'a'.repeat(64)},${'b'.repeat(64)} FROM audit_events WHERE aggregate_id=${fixture.runId}`;
        await tx`INSERT INTO run_interaction_transition(command_id,sequence,state,reason_code,created_at,source_event_id)
          VALUES (${proposal.commandId},3,'applied','applied',${at}::timestamptz,${eventId})`;
      })).rejects.toMatchObject({ code: '23514', message: 'Answer fact requires its authoritative Run transition' });
      expect(await confirmAnswer(fixture.runId, proposal.commandId)).toMatchObject({ ok: true });
      for (const patch of [{ commandId: null }, { questionAnchor: null },
        { questionAnchor: { ...fixture.question.anchor, runRevision: String(fixture.question.anchor.runRevision) } },
        { questionAnchor: { ...fixture.question.anchor, waitId: ids.next() } }, { answerOptionId: 'skip' }]) {
        await expect(sql`INSERT INTO audit_events(event_id,aggregate_id,correlation_id,session_id,actor_type,actor_id,event_type,source,outcome,occurred_at,sequence,payload,previous_hash,event_hash)
          SELECT ${ids.next()},aggregate_id,correlation_id,session_id,actor_type,actor_id,event_type,source,outcome,occurred_at,sequence+100000,
            payload||${JSON.stringify(patch)}::jsonb,previous_hash,event_hash FROM audit_events
          WHERE aggregate_id=${fixture.runId} AND event_type='execution.escalation-answered'`).rejects.toMatchObject({ code: '23514' });
      }
      await expect(sql`UPDATE run_wait SET answer_option_id='skip' WHERE wait_id=${fixture.waitId}`).rejects.toMatchObject({ code: '23514' });
      await expect(sql`DELETE FROM audit_events WHERE aggregate_id=${fixture.runId} AND event_type='execution.escalation-answered'`).rejects.toMatchObject({ code: '23514' });
      await expect(sql`UPDATE audit_events SET payload=payload||'{"answerOptionId":"skip"}'::jsonb WHERE aggregate_id=${fixture.runId} AND event_type='execution.escalation-answered'`).rejects.toMatchObject({ code: '23514' });
    } finally { await cleanupDeferredContext(fixture); }
  });

  async function seedResumeContext() {
    now = new Date(now.getTime() + 61_000);
    const runId = ids.next();
    await insertRun(runId, seeded.procedureId, seeded.versionId, seeded.readerId, '2027-01-01', '2027-01-31');
    expect((await append(seeded.readerId, { runId, text: 'pause now' })).ok).toBe(true);
    await db.transaction(tx => withRunExecutionContext(tx, runId, async context => {
      if (!context.run?.pauseRequest) throw new Error('Pause marker missing');
      await context.saveRunState('PAUSED');
      await performPause(context, { run: context.run, request: context.run.pauseRequest, waitId: ids.next(), at: new Date().toISOString(), hold: BOUNDARY_HOLD });
    }));
    return runId;
  }

  function readerSession(actorId = seeded.readerId) { return { userId: actorId, sessionId: seeded.readerSession }; }

  function controlDependencies() {
    return { roles: new DrizzleRoleRepository(db), unitOfWork: new PostgresRunsUnitOfWork(db),
      repository: new PostgresRunControlLeaseRepository(db), ids, allowEnrollment: true };
  }

  async function acquireControl(runId: string, actorId = seeded.readerId, expectedEpoch = 0) {
    expect(await acquireRunControlLease(controlDependencies(), { session: readerSession(actorId), request: { runId, expectedEpoch } }))
      .toMatchObject({ ok: true, lease: { epoch: expectedEpoch + 1 } });
  }

  async function currentInspection(runId: string) {
    const read = await repository().readCurrentInspection({ runId, actorId: seeded.readerId });
    expect(read.status).toBe('ready');
    if (read.status !== 'ready') throw new Error(read.reason);
    return read;
  }

  async function proposeInspection(runId: string, currentInspection: DeferredPauseAnchor, replyToWaitId: string | null = null, selectedSourceOrdinal: number | null = null) {
    const receipt = await append(seeded.readerId, { runId, text: 'pause after this employee', currentInspection, replyToWaitId, selectedSourceOrdinal });
    expect(receipt.ok).toBe(true);
    if (!receipt.ok) throw new Error(receipt.reason);
    const [command] = await sql<{ command_id: string }[]>`SELECT command_id FROM run_interaction_command WHERE run_id=${runId} AND message_id=${receipt.messageId}`;
    if (!command) throw new Error('Deferred proposal did not persist a command');
    return command.command_id;
  }

  function confirmInspection(runId: string, commandId: string, extra: Record<string, unknown> = {}) {
    return repository().confirmDeferredPause({ actorId: seeded.readerId, sessionId: seeded.readerSession, request: { runId, commandId, ...extra } });
  }

  async function seedDeferredContext(waiting = false) {
    // Separate actor rate-limit windows without using the test clock for lease expiry.
    now = new Date(now.getTime() + 61_000);
    const fixture = await seedP1EventContext();
    const waitId = ids.next();
    if (waiting) {
      await sql`UPDATE audit_run SET state='AWAITING_AUDITOR' WHERE run_id=${fixture.runId}`;
      await sql`UPDATE run_work_item SET state='AWAITING' WHERE work_item_id=${fixture.exactWorkItemId}`;
      await sql`INSERT INTO run_wait(wait_id,run_id,kind,options,opened_at,deadline)
        VALUES (${waitId},${fixture.runId},'choose-candidate',${JSON.stringify([{ id: 'one', label: 'One' }])}::jsonb,clock_timestamp(),clock_timestamp()+interval '1 day')`;
    }
    await sql`INSERT INTO run_agent_work(run_id,revision,status,run_started_at,lease_until,attempt_id,work_item_id,wait_id,next_turn,tokens,reserved_tokens)
      VALUES (${fixture.runId},1,${waiting ? 'WAITING' : 'EXECUTING'},clock_timestamp(),clock_timestamp()+interval '1 minute',${ids.next()},${fixture.exactWorkItemId},${waiting ? waitId : null},1,0,0)`;
    return { ...fixture, waitId };
  }

  async function cleanupDeferredContext(fixture: Awaited<ReturnType<typeof seedDeferredContext>>) {
    // The marker survives with its Run. Its Work Item FK is deferred so both can be
    // deleted in one transaction without disabling the retained-identity guard.
    for (const runId of [fixture.runId, fixture.otherRunId]) {
      await sql.begin(async tx => {
        await tx`DELETE FROM notification WHERE run_id=${runId}`;
        await tx`DELETE FROM pgboss.job WHERE data->>'runId'=${runId}`;
        await tx`DELETE FROM run_result WHERE run_id=${runId}`;
        await tx`DELETE FROM run_gate_check WHERE run_id=${runId}`;
        await tx`DELETE FROM run_evidence_integrity WHERE run_id=${runId}`;
        await tx`DELETE FROM run_evidence_package WHERE run_id=${runId}`;
        await tx`DELETE FROM run_agent_work WHERE run_id=${runId}`;
        await tx`DELETE FROM run_wait WHERE run_id=${runId}`;
        await tx`DELETE FROM population_row WHERE run_id=${runId}`;
        await tx`DELETE FROM population_snapshot WHERE run_id=${runId}`;
        await tx`DELETE FROM audit_events WHERE aggregate_id=${runId}`;
        await tx`DELETE FROM audit_event_heads WHERE aggregate_id=${runId}`;
        await tx`DELETE FROM run_work_item WHERE run_id=${runId}`;
        await tx`DELETE FROM audit_run WHERE run_id=${runId}`;
      });
    }
    await sql`DELETE FROM procedure_version WHERE procedure_id=${fixture.procedureId}`;
    await sql`DELETE FROM procedure WHERE procedure_id=${fixture.procedureId}`;
  }

  async function append(actorId: string, input: { runId?: string; text: string; selectedSourceOrdinal?: number | null; replyToWaitId?: string | null; currentInspection?: DeferredPauseAnchor | null }) {
    return repository().append({
      actorId,
      sessionId: seeded.readerSession,
      request: {
        runId: input.runId ?? seeded.runId,
        idempotencyKey: ids.next(),
        text: input.text,
        selectedSourceOrdinal: input.selectedSourceOrdinal ?? null,
        replyToWaitId: input.replyToWaitId ?? null,
        ...(input.currentInspection === undefined ? {} : { currentInspection: input.currentInspection }),
      },
    });
  }

  function workspaceEventDraft(runId: string) {
    return {
      actor: { type: 'system' as const, id: 'workspace-worker' },
      eventType: 'lifecycle.agent-workspace' as const,
      source: 'worker' as const,
      outcome: 'success' as const,
      sessionId: 'workspace-session',
      correlationId: ids.next(),
      aggregateId: runId,
      payload: { diagnostic: 'workspace-created', state: 'RUNNING', stepId: null },
    };
  }

  async function appendWorkspaceEvent(runId: string) {
    return new PostgresAuditUnitOfWork(db, { clock: { now: () => new Date(now.getTime()) } }).execute(({ auditEvents }) =>
      auditEvents.append(workspaceEventDraft(runId)),
    );
  }

  async function appendInspectionEvent(runId: string, workItemId: string) {
    const stepExecutionId = ids.next();
    return new PostgresAuditUnitOfWork(db, { clock: { now: () => new Date(now.getTime()) } }).execute(({ auditEvents }) =>
      auditEvents.append({
        actor: { type: 'system' as const, id: 'agent-worker' },
        eventType: 'lifecycle.agent-work' as const,
        source: 'worker' as const,
        outcome: 'success' as const,
        sessionId: 'p1-inspection',
        correlationId: ids.next(),
        aggregateId: runId,
        payload: { diagnostic: 'work-item-attempt-started', state: 'RUNNING', workItemId, stepExecutionId, attempt: 1 },
      }),
    );
  }

  async function seedP1EventContext() {
    const procedureId = ids.next();
    const versionId = ids.next();
    const runId = ids.next();
    const otherRunId = ids.next();
    const registrationId = ids.next();
    const bindingId = ids.next();
    const version = activeRunVersion(procedureId, versionId, seeded.readerId, p1ConversationInputs(bindingId, registrationId));
    await new PostgresProceduresUnitOfWork(db).execute(async context => {
      await context.procedures.insertProcedure(version);
      await context.procedures.insertVersion(version);
    });
    const plan = version.compiledPlan!;
    const target = classifyPlanTargets(plan).agents[0];
    if (!target) throw new Error('P-1 conversation fixture requires a subject-scoped agent Target');
    await insertRun(runId, procedureId, versionId, seeded.readerId, '2026-08-01', '2026-08-31');
    await insertRun(otherRunId, procedureId, versionId, seeded.readerId, '2026-09-01', '2026-09-30');
    await insertP1Population(runId, [
      { employee_id: 'E-001', full_name: 'Exact Person' },
      { employee_id: 'E-DUP', full_name: 'Duplicate One' },
      { employee_id: 'E-DUP', full_name: 'Duplicate Two' },
    ]);
    await insertP1Population(otherRunId, [{ employee_id: 'E-CROSS', full_name: 'Cross Run Person' }]);

    const exactWorkItemId = ids.next();
    const duplicateWorkItemId = ids.next();
    const crossRunWorkItemId = ids.next();
    await db.insert(runWorkItem).values([
      {
        workItemId: exactWorkItemId,
        runId,
        stepId: target.stepId,
        ordinal: 1,
        subjectKey: 'E-001',
        registrationId: target.target.registrationId,
        displayName: 'LoanCore exact record',
        state: 'IN_PROGRESS',
        attempts: 1,
        cycles: 0,
        diagnostic: null,
        evidenceId: null,
        observations: 0,
      },
      {
        workItemId: duplicateWorkItemId,
        runId,
        stepId: target.stepId,
        ordinal: 2,
        subjectKey: 'E-DUP',
        registrationId: target.target.registrationId,
        displayName: 'LoanCore duplicate record',
        state: 'IN_PROGRESS',
        attempts: 1,
        cycles: 0,
        diagnostic: null,
        evidenceId: null,
        observations: 0,
      },
      {
        workItemId: crossRunWorkItemId,
        runId: otherRunId,
        stepId: target.stepId,
        ordinal: 1,
        subjectKey: 'E-CROSS',
        registrationId: target.target.registrationId,
        displayName: 'LoanCore cross Run record',
        state: 'IN_PROGRESS',
        attempts: 1,
        cycles: 0,
        diagnostic: null,
        evidenceId: null,
        observations: 0,
      },
    ]);
    return { procedureId, runId, otherRunId, exactWorkItemId, duplicateWorkItemId, crossRunWorkItemId, plan };
  }

  async function insertP1Population(runId: string, rows: readonly { employee_id: string; full_name: string }[]): Promise<void> {
    await db.insert(populationSnapshot).values({
      runId,
      included: rows.length,
      excluded: 0,
      indeterminate: 0,
      rowsDigest: null,
      checks: POPULATION_CHECK_NAMES.map(name => ({ name, passed: true })),
      generatedAt: new Date('2026-09-01T00:00:00.000Z'),
      declaredCount: rows.length,
      retrievedCount: rows.length,
    });
    await db.insert(populationRow).values(rows.map((values, index) => ({
      runId,
      ordinal: index + 1,
      values: { ...values } satisfies Record<string, JsonValue>,
      disposition: 'included' as const,
      reasons: [] as string[],
    })));
  }

  async function seed(): Promise<SeededConversation> {
    const procedureId = ids.next();
    const versionId = ids.next();
    const runId = ids.next();
    const otherRunId = ids.next();
    const readerId = ids.next();
    const pagerId = ids.next();
    const revokedId = ids.next();
    const readerSession = ids.next();
    const waitId = ids.next();
    const version = activeRunVersion(procedureId, versionId, readerId, executablePlanInputs());
    await new PostgresProceduresUnitOfWork(db).execute(async context => {
      await context.procedures.insertProcedure(version);
      await context.procedures.insertVersion(version);
    });
    const plan = version.compiledPlan!;
    const classified = classifyPlanTargets(plan);
    const entry = [...classified.adapters, ...classified.agents][0];
    if (!entry) throw new Error('Conversation fixture requires one executable Target');
    const targetId = entry.target.registrationId;
    const stepId = entry.stepId;
    const sourceKey = 'record-0001';

    await db.insert(authUser).values([
      { id: readerId, name: 'Conversation reader', email: `${readerId}@test.invalid` },
      { id: pagerId, name: 'Conversation pager', email: `${pagerId}@test.invalid` },
      { id: revokedId, name: 'Revoked conversation actor', email: `${revokedId}@test.invalid` },
    ]);
    await db.insert(userRole).values([
      { userId: readerId, role: 'auditor', assignedAt: new Date(BASE_NOW), assignedBy: readerId },
      { userId: pagerId, role: 'auditor', assignedAt: new Date(BASE_NOW), assignedBy: readerId },
      { userId: revokedId, role: 'auditor', assignedAt: new Date(BASE_NOW), assignedBy: readerId },
    ]);
    await insertRun(runId, procedureId, versionId, readerId, '2026-08-01', '2026-08-31');
    await insertRun(otherRunId, procedureId, versionId, readerId, '2026-09-01', '2026-09-30');
    await insertPopulation(runId);
    await insertPopulation(otherRunId);

    const evidenceId = ids.next();
    const otherEvidenceId = ids.next();
    await insertEvidence(runId, evidenceId, targetId);
    await insertEvidence(otherRunId, otherEvidenceId, targetId);
    const conditionId = plan.inputs.complianceConditions[0]?.conditionId ?? null;
    await insertExecution(runId, evidenceId, targetId, stepId, sourceKey, conditionId);
    await insertExecution(otherRunId, otherEvidenceId, targetId, stepId, sourceKey, conditionId);
    await sql`INSERT INTO run_wait(wait_id,run_id,kind,options,opened_at,opened_by,deadline,closed_at,closure_kind,answer_option_id,actor)
      VALUES (${waitId},${runId},'choose-candidate',${JSON.stringify([{ id: 'one', label: 'One' }])}::jsonb,${BASE_NOW.toISOString()},NULL,${new Date(BASE_NOW.getTime() + 86_400_000).toISOString()},NULL,NULL,NULL,NULL)`;

    return { procedureId, versionId, runId, otherRunId, readerId, pagerId, revokedId, readerSession, evidenceId, otherEvidenceId, waitId, plan, targetId, stepId, sourceKey };
  }

  async function insertRun(runId: string, procedureId: string, versionId: string, actorId: string, periodFrom: string, periodTo: string): Promise<void> {
    await db.insert(auditRun).values({
      requestToken: ids.next(),
      runId,
      correlationId: ids.next(),
      procedureId,
      versionId,
      versionNumber: 1,
      procedureName: 'Conversation test procedure',
      periodFrom,
      periodTo,
      state: 'RUNNING',
      kind: 'STANDARD',
      initiatorId: actorId,
      sessionId: 'conversation-fixture',
      authorizationRole: 'auditor',
      initiatedAt: new Date(BASE_NOW),
    });
  }

  async function insertPopulation(runId: string): Promise<void> {
    await db.insert(populationSnapshot).values({
      runId,
      included: 30,
      excluded: 0,
      indeterminate: 0,
      rowsDigest: null,
      checks: POPULATION_CHECK_NAMES.map(name => ({ name, passed: true })),
      generatedAt: new Date('2026-09-01T00:00:00.000Z'),
      declaredCount: 30,
      retrievedCount: 30,
    });
    await db.insert(populationRow).values(Array.from({ length: 30 }, (_, index) => ({
      runId,
      ordinal: index + 1,
      values: { parameter: `record-${String(index + 1).padStart(4, '0')}`, observed_value: 'enabled' } satisfies Record<string, JsonValue>,
      disposition: 'included' as const,
      reasons: [] as string[],
    })));
  }

  async function insertEvidence(runId: string, evidenceId: string, targetId: string): Promise<void> {
    await db.insert(runEvidence).values({
      evidenceId,
      runId,
      kind: 'structural-snapshot',
      registrationId: targetId,
      objectKey: `conversation/${runId}/${evidenceId}`,
      mediaType: 'application/json',
      digest: evidenceId.replaceAll('-', '').padEnd(64, 'a').slice(0, 64),
      size: 128,
      state: 'REGISTERED',
      required: true,
      capturedAt: new Date(BASE_NOW),
      captureMethod: 'agent',
      captureTimeSource: 'registration',
      role: 'evidence',
    });
  }

  async function insertExecution(runId: string, evidenceId: string, targetId: string, stepId: string, key: string, conditionId: string | null): Promise<void> {
    const workItemId = ids.next();
    const stepExecutionId = ids.next();
    await db.insert(runWorkItem).values({
      workItemId,
      runId,
      stepId,
      ordinal: 1,
      subjectKey: null,
      registrationId: targetId,
      displayName: 'Conversation target',
      state: 'OBSERVED',
      attempts: 1,
      cycles: 0,
      diagnostic: null,
      evidenceId,
      observations: 1,
    });
    await db.insert(runStepExecution).values({
      stepExecutionId,
      runId,
      planStepId: stepId,
      workItemId,
      action: 'inspect-record',
      state: 'SUCCEEDED',
      attempt: 1,
      startedAt: new Date(BASE_NOW),
      completedAt: new Date(BASE_NOW),
      diagnostic: null,
      supersededBy: null,
    });
    const record = observation(runId, workItemId, stepExecutionId, targetId, key, evidenceId);
    await db.insert(runObservation).values({
      observationId: record.observationId,
      runId,
      workItemId: record.workItemId,
      schemaVersion: record.schemaVersion,
      populationRecordKey: record.populationRecordKey,
      targetSystem: record.targetSystem,
      found: record.found,
      observedAt: new Date(record.observedAt),
      stepExecutionId: record.stepExecutionId,
      captureMethod: record.captureMethod,
      matchOrigin: record.matchOrigin,
      identity: record.identity,
      attributes: [...record.attributes],
      evidenceIds: [...record.evidenceIds],
      digest: observationDigest(record),
      coverage: 'COVERED',
      observedAtSource: record.observedAt,
      corroboration: 'MATCHED',
    });
    await db.insert(runObservationCheck).values(OBSERVATION_CHECK_NAMES.map(checkName => ({
      observationId: record.observationId,
      runId,
      checkName,
      outcome: 'PASS',
      diagnostic: null,
    })));
    if (conditionId !== null) {
      await db.insert(runObservationEvaluation).values({
        observationId: record.observationId,
        coverage: 'COVERED',
        corroboration: 'MATCHED',
        runId,
        conditionId,
        origin: 'RULE',
        value: 'COMPLIANT',
        confirmation: null,
        confidence: null,
        rationale: null,
        diagnostic: null,
        evidenceIds: [evidenceId],
        agentProposedValue: null,
        agentProposedConfidence: null,
        agentProposedRationale: null,
      });
    }
  }

  function observation(runId: string, workItemId: string, stepExecutionId: string, targetId: string, key: string, evidenceId: string): ObservationRecord {
    const attribute = (name: string, value: string): ObservationAttribute => ({
      name,
      originalValue: value,
      normalizedValue: value,
      grounding: { evidenceId, locator: `$.${name}`, label: name, extractedText: value },
      corroboration: 'matched',
    });
    return {
      schemaVersion: 1,
      observationId: observationIdFor(workItemId, key),
      workItemId,
      populationRecordKey: key,
      targetSystem: targetId,
      found: 'true',
      observedAt: BASE_NOW.toISOString(),
      stepExecutionId,
      captureMethod: 'agent',
      matchOrigin: 'platform',
      identity: attribute('parameter', key),
      attributes: [attribute('observed_value', 'enabled'), attribute('account_name', 'record-account'), attribute('status', 'enabled')],
      evidenceIds: [evidenceId],
    };
  }

  async function cleanupRun(runId: string): Promise<void> {
    await sql`DELETE FROM notification WHERE run_id=${runId}`;
    await sql`DELETE FROM run_result WHERE run_id=${runId}`;
    await sql`DELETE FROM run_gate_check WHERE run_id=${runId}`;
    await sql`DELETE FROM run_evidence_integrity WHERE run_id=${runId}`;
    await sql`DELETE FROM run_evidence_package WHERE run_id=${runId}`;
    await sql`DELETE FROM run_observation_check WHERE run_id=${runId}`;
    await sql`DELETE FROM run_observation_evaluation WHERE run_id=${runId}`;
    await sql`DELETE FROM run_observation_absence WHERE run_id=${runId}`;
    await sql`DELETE FROM run_observation WHERE run_id=${runId}`;
    await sql`DELETE FROM run_evidence_capture WHERE run_id=${runId}`;
    await sql`DELETE FROM run_tool_action WHERE run_id=${runId}`;
    await sql`DELETE FROM run_step_execution WHERE run_id=${runId}`;
    await sql`DELETE FROM run_session_step WHERE run_id=${runId}`;
    await sql`DELETE FROM run_work_item WHERE run_id=${runId}`;
    await sql`DELETE FROM run_evidence WHERE run_id=${runId}`;
    await sql`DELETE FROM run_wait WHERE run_id=${runId}`;
    await sql`DELETE FROM population_row WHERE run_id=${runId}`;
    await sql`DELETE FROM population_snapshot WHERE run_id=${runId}`;
    await sql`DELETE FROM audit_events WHERE aggregate_id=${runId}`;
    await sql`DELETE FROM audit_event_heads WHERE aggregate_id=${runId}`;
    // The whole Run cascade removes conversation metadata and governed content. The
    // migration intentionally rejects deleting either table while this row exists.
    await sql`DELETE FROM audit_run WHERE run_id=${runId}`;
  }
});
