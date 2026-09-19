import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cancelRun, performCancellation, performPause } from '@intellifin/application';
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
  type JsonValue,
  type ObservationAttribute,
  type ObservationRecord,
} from '@intellifin/domain';
import {
  createDb,
  createSqlClient,
  CryptoUuidV7Generator,
  PostgresAuditUnitOfWork,
  PostgresRunCancellationRepository,
  PostgresRunsUnitOfWork,
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
    const request = { runId: seeded.runId, idempotencyKey: ids.next(), text: 'answer: choose the recorded option', selectedSourceOrdinal: null, replyToWaitId: seeded.waitId };
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
        await performPause(context, { run: context.run, request: context.run.pauseRequest, waitId: ids.next(), at: now.toISOString() });
      }));
      // Exercise rollback through the actual shared worker context, not a fake receipt writer.
      await expect(db.transaction(tx => withRunExecutionContext(tx, runId, async context => {
        if (!context.run?.pauseRequest) throw new Error('Pause marker missing');
        await context.saveRunState('PAUSED');
        await performPause(context, { run: context.run, request: context.run.pauseRequest, waitId: ids.next(), at: now.toISOString() });
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

  async function append(actorId: string, input: { runId?: string; text: string; selectedSourceOrdinal?: number | null; replyToWaitId?: string | null }) {
    return repository().append({
      actorId,
      sessionId: seeded.readerSession,
      request: {
        runId: input.runId ?? seeded.runId,
        idempotencyKey: ids.next(),
        text: input.text,
        selectedSourceOrdinal: input.selectedSourceOrdinal ?? null,
        replyToWaitId: input.replyToWaitId ?? null,
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
    return { procedureId, runId, otherRunId, exactWorkItemId, duplicateWorkItemId, crossRunWorkItemId };
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
