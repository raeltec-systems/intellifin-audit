import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  classifyPlanTargets,
  observationDigest,
  observationIdFor,
  POPULATION_CHECK_NAMES,
  type ExecutablePlan,
  type JsonValue,
  type ObservationAttribute,
  type ObservationRecord,
} from '@intellifin/domain';
import {
  createDb,
  createSqlClient,
  CryptoUuidV7Generator,
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
    const read = await repository().read({ runId: seeded.runId, actorId: seeded.revokedId });
    expect(read.status).toBe('ready');
    if (read.status !== 'ready') return;
    expect(read.messages.find(message => message.messageId === receipt.messageId)).toMatchObject({ body: null, contentState: 'removed' });
  });

  it('refuses obvious secrets and records no executable effect for unsupported or safety text', async () => {
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
    const pause = await append(seeded.readerId, { text: 'pause now' });
    expect(pause.ok).toBe(true);
    const [after] = await sql<{ state: string; pause_requested_at: Date | null }[]>`SELECT state,pause_requested_at FROM audit_run WHERE run_id=${seeded.runId}`;
    expect(after).toEqual(before[0]);
    expect(unsupported.ok && pause.ok).toBe(true);
    const read = await repository().read({ runId: seeded.runId, actorId: seeded.readerId });
    expect(read.status).toBe('ready');
    if (read.status !== 'ready') return;
    const pauseReply = pause.ok ? read.messages.find(message => message.sequence === pause.sequence + 1) : undefined;
    expect(pauseReply?.body).toContain('does not execute Run controls');
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
    await insertRun(runId, procedureId, versionId, readerId);
    await insertRun(otherRunId, procedureId, versionId, readerId);
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

  async function insertRun(runId: string, procedureId: string, versionId: string, actorId: string): Promise<void> {
    await db.insert(auditRun).values({
      requestToken: ids.next(),
      runId,
      correlationId: ids.next(),
      procedureId,
      versionId,
      versionNumber: 1,
      procedureName: 'Conversation test procedure',
      periodFrom: '2026-08-01',
      periodTo: '2026-08-31',
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
