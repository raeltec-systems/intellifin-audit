import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AuditEventDraft, AuditEventRecord, CanonicalAuditEvent } from '@intellifin/domain';
import {
  PostgresAuditChainReader,
  PostgresAuditUnitOfWork,
  computeAuditEventHash,
  createDb,
  createSqlClient,
  type Sql,
} from '@intellifin/infrastructure';

interface GoldenFixture {
  events: Array<{
    canonical: CanonicalAuditEvent;
    previousHash: string;
    eventHash: string;
  }>;
}

interface TamperedFixture {
  cases: Array<{
    name: string;
    column: 'actor_id' | 'payload' | 'previous_hash' | 'sequence';
    replacement: unknown;
    expectedFirstInvalidSequence: number;
    expectedReason: string;
  }>;
}

const fixture = <T>(name: string): T =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8'),
  ) as T;

const golden = fixture<GoldenFixture>('audit-chain-golden.json');
const tampered = fixture<TamperedFixture>('audit-chain-tampered.json');
const databaseUrl = process.env['DATABASE_URL'];

const toDraft = (event: CanonicalAuditEvent, omitAggregate = false): AuditEventDraft => ({
  actor: event.actor,
  eventType: event.eventType,
  source: event.source,
  outcome: event.outcome,
  sessionId: event.sessionId,
  correlationId: event.correlationId,
  aggregateId: omitAggregate ? undefined : event.aggregateId,
  payload: event.payload,
});

class FixedClock {
  private index = 0;
  constructor(private readonly values: readonly string[]) {}
  now(): Date {
    const value = this.values[this.index++];
    if (!value) throw new Error('Fixed clock exhausted');
    return new Date(value);
  }
}

class FixedIds {
  private index = 0;
  constructor(private readonly values: readonly string[]) {}
  next(): string {
    const value = this.values[this.index++];
    if (!value) throw new Error('Fixed UUID source exhausted');
    return value;
  }
}

describe.skipIf(!databaseUrl)('tamper-evident audit events against PostgreSQL 18', () => {
  let sql: Sql;
  const testPrefix = `story-1-2:${process.pid}:`;

  beforeAll(() => {
    sql = createSqlClient(databaseUrl as string, { max: 5 });
  });

  afterAll(async () => {
    await sql`DELETE FROM audit_events WHERE aggregate_id LIKE ${`${testPrefix}%`} OR aggregate_id = 'platform'`;
    await sql`DELETE FROM audit_event_heads WHERE aggregate_id LIKE ${`${testPrefix}%`} OR aggregate_id = 'platform'`;
    await sql.end({ timeout: 5 });
  });

  it('serializes concurrent first appends under the head lock and matches independent golden hashes', async () => {
    await sql`DELETE FROM audit_events WHERE aggregate_id = 'platform'`;
    await sql`DELETE FROM audit_event_heads WHERE aggregate_id = 'platform'`;
    const db = createDb(sql);
    const unitOfWork = new PostgresAuditUnitOfWork(db, {
      clock: new FixedClock(golden.events.map((item) => item.canonical.occurredAt)),
      ids: new FixedIds(golden.events.map((item) => item.canonical.eventId)),
    });
    const reader = new PostgresAuditChainReader(db);
    let signalAppended: (() => void) | undefined;
    let releaseFirst: (() => void) | undefined;
    const firstAppended = new Promise<void>((resolve) => { signalAppended = resolve; });
    const holdFirst = new Promise<void>((resolve) => { releaseFirst = resolve; });

    const firstPromise = unitOfWork.execute(async ({ auditEvents }) => {
      const record = await auditEvents.append(toDraft(golden.events[0]!.canonical, true));
      signalAppended?.();
      await holdFirst;
      return record;
    });
    await firstAppended;
    const secondPromise = unitOfWork.execute(({ auditEvents }) =>
      auditEvents.append(toDraft(golden.events[1]!.canonical, true)),
    );
    // Give the second transaction time to reach the locked head while the first
    // transaction is deliberately still open.
    await new Promise((resolve) => setTimeout(resolve, 100));
    releaseFirst?.();
    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    expect(first).toMatchObject({
      aggregateId: 'platform',
      sequence: 1,
      previousHash: golden.events[0]!.previousHash,
      eventHash: golden.events[0]!.eventHash,
    });
    expect(second).toMatchObject({
      aggregateId: 'platform',
      sequence: 2,
      previousHash: golden.events[1]!.previousHash,
      eventHash: golden.events[1]!.eventHash,
    });
    expect(computeAuditEventHash(first.previousHash, first)).toBe(first.eventHash);
    expect(computeAuditEventHash(second.previousHash, second)).toBe(second.eventHash);
    await expect(reader.verify('platform')).resolves.toEqual({
      valid: true,
      aggregateId: 'platform',
      eventCount: 2,
      headSequence: 2,
      headHash: golden.events[1]!.eventHash,
    });
  });

  it('rolls back both the event and advanced head when work fails', async () => {
    const aggregateId = `${testPrefix}rollback`;
    const db = createDb(sql);
    const unitOfWork = new PostgresAuditUnitOfWork(db);
    const reader = new PostgresAuditChainReader(db);

    await expect(
      unitOfWork.execute(async ({ auditEvents }) => {
        await auditEvents.append({
          actor: { type: 'system', id: 'worker' },
          eventType: 'failure.retry',
          source: 'worker',
          outcome: 'failure',
          sessionId: 'session-rollback',
          correlationId: 'corr-rollback',
          aggregateId,
          payload: { attempt: 1 },
        });
        throw new Error('simulate state write failure');
      }),
    ).rejects.toThrow('simulate state write failure');

    await expect(reader.verify(aggregateId)).resolves.toMatchObject({ valid: true, eventCount: 0 });
  });

  it('rejects invalid required metadata without creating a head or event', async () => {
    const aggregateId = `${testPrefix}invalid`;
    const db = createDb(sql);
    const unitOfWork = new PostgresAuditUnitOfWork(db);

    await expect(
      unitOfWork.execute(({ auditEvents }) =>
        auditEvents.append({
          actor: { type: 'system', id: 'worker' },
          eventType: 'security.denied',
          source: 'worker',
          outcome: 'denied',
          sessionId: 'session-invalid',
          correlationId: '',
          aggregateId,
          payload: {},
        }),
      ),
    ).rejects.toThrow(/correlationId/);
    const rows = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM audit_event_heads WHERE aggregate_id = ${aggregateId}
    `;
    expect(rows[0]?.count).toBe(0);
  });

  it('records all required activity families with complete attribution in one verifiable chain', async () => {
    const aggregateId = `${testPrefix}families`;
    const db = createDb(sql);
    const unitOfWork = new PostgresAuditUnitOfWork(db);
    const eventTypes = [
      'security.denied',
      'configuration.changed',
      'lifecycle.started',
      'evidence-access.viewed',
      'review.approved',
      'export.completed',
      'failure.recorded',
    ] as const;

    for (const eventType of eventTypes) {
      await unitOfWork.execute(({ auditEvents }) =>
        auditEvents.append({
          actor: { type: 'human', id: 'auditor-007' },
          eventType,
          source: 'web',
          outcome: eventType === 'security.denied' ? 'denied' : 'success',
          sessionId: 'session-families',
          correlationId: 'corr-families',
          aggregateId,
          payload: { action: eventType },
        }),
      );
    }

    await expect(new PostgresAuditChainReader(db).verify(aggregateId)).resolves.toMatchObject({
      valid: true,
      eventCount: eventTypes.length,
      headSequence: eventTypes.length,
    });
    const rows = await sql<Record<string, string | number | Date>[]>`
      SELECT actor_type, actor_id, event_type, occurred_at, source, outcome,
             session_id, correlation_id, aggregate_id, sequence, previous_hash, event_hash
      FROM audit_events WHERE aggregate_id = ${aggregateId}
    `;
    expect(rows).toHaveLength(eventTypes.length);
    for (const row of rows) {
      expect(Object.values(row).every((value) => value !== null && value !== '')).toBe(true);
    }
  });

  it.each(tampered.cases)('$name reports the first damaged sequence without payload data', async (testCase) => {
    const aggregateId = `${testPrefix}tamper:${testCase.column}`;
    const db = createDb(sql);
    const unitOfWork = new PostgresAuditUnitOfWork(db);
    const record: AuditEventRecord = await unitOfWork.execute(({ auditEvents }) =>
      auditEvents.append({
        actor: { type: 'system', id: 'platform' },
        eventType: 'security.login',
        source: 'web',
        outcome: 'success',
        sessionId: 'session-tamper',
        correlationId: 'corr-tamper',
        aggregateId,
        payload: { marker: 'sensitive-payload-must-not-return' },
      }),
    );

    switch (testCase.column) {
      case 'actor_id':
        await sql`UPDATE audit_events SET actor_id = ${testCase.replacement as string} WHERE event_id = ${record.eventId}`;
        break;
      case 'payload':
        // Stringify and cast explicitly: postgres.js cannot infer a bind type for a
        // bare object here, and fails while binding rather than at the jsonb column.
        await sql`UPDATE audit_events SET payload = ${JSON.stringify(testCase.replacement)}::jsonb WHERE event_id = ${record.eventId}`;
        break;
      case 'previous_hash':
        await sql`UPDATE audit_events SET previous_hash = ${testCase.replacement as string} WHERE event_id = ${record.eventId}`;
        break;
      case 'sequence':
        await sql`UPDATE audit_events SET sequence = ${testCase.replacement as number} WHERE event_id = ${record.eventId}`;
        break;
    }

    const result = await new PostgresAuditChainReader(db).verify(aggregateId);
    expect(result).toEqual({
      valid: false,
      aggregateId,
      firstInvalidSequence: testCase.expectedFirstInvalidSequence,
      reason: testCase.expectedReason,
    });
    expect(JSON.stringify(result)).not.toContain('sensitive-payload-must-not-return');
  });
});
