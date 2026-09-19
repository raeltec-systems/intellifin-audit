import { createHash, randomBytes } from 'node:crypto';

import { asc, eq, sql } from 'drizzle-orm';
import { narrateRunConversationEvent } from '@intellifin/application';

import type {
  AuditChainReader,
  AuditEventWriter,
  AuditUnitOfWork,
  AuditUnitOfWorkContext,
  Clock,
  UuidV7Generator,
} from '@intellifin/application';
import {
  ZERO_HASH,
  assertNoWorkspaceCapabilities,
  assertAuditHash,
  canonicalizeAuditEvent,
  createCanonicalAuditEvent,
  validateAuditEventDraft,
  type AuditChainVerificationResult,
  type AuditEventDraft,
  type AuditEventRecord,
  type CanonicalAuditEvent,
} from '@intellifin/domain';

import type { Database, Transaction } from './client.js';
import { auditEventHeads, auditEvents, auditRun, runConversationMessage } from './schema.js';
import { isUuidText } from './identifier.js';

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** UUIDv7 generator owned by infrastructure; Node crypto never crosses inward. */
export class CryptoUuidV7Generator implements UuidV7Generator {
  next(): string {
    const bytes = randomBytes(16);
    let milliseconds = BigInt(Date.now());
    for (let index = 5; index >= 0; index -= 1) {
      bytes[index] = Number(milliseconds & 0xffn);
      milliseconds >>= 8n;
    }
    bytes[6] = ((bytes[6] as number) & 0x0f) | 0x70;
    bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
}

export function computeAuditEventHash(previousHash: string, event: CanonicalAuditEvent): string {
  assertAuditHash(previousHash, 'previousHash');
  return createHash('sha256')
    .update(Buffer.from(previousHash, 'hex'))
    .update(Buffer.from(canonicalizeAuditEvent(event), 'utf8'))
    .digest('hex');
}

async function appendAuditEvent(
  transaction: Transaction,
  clock: Clock,
  ids: UuidV7Generator,
  draft: AuditEventDraft,
): Promise<AuditEventRecord> {
  validateAuditEventDraft(draft);
  assertNoWorkspaceCapabilities(draft.payload);
  const aggregateId = draft.aggregateId ?? 'platform';

  // Keep the established Run-before-audit-head lock order. The conversation FK
  // takes KEY SHARE at insertion; taking it before the head prevents inversion
  // with a concurrent command that holds the Run and then appends its audit event.
  const [run] = isUuidText(aggregateId)
    ? await transaction.select({ runId: auditRun.runId }).from(auditRun)
      .where(eq(auditRun.runId, aggregateId)).for('key share').limit(1)
    : [];

  await transaction
    .insert(auditEventHeads)
    .values({ aggregateId, lastSequence: 0, lastEventHash: ZERO_HASH })
    .onConflictDoNothing({ target: auditEventHeads.aggregateId });

  const [head] = await transaction
    .select()
    .from(auditEventHeads)
    .where(eq(auditEventHeads.aggregateId, aggregateId))
    .for('update');
  if (!head) throw new Error('Audit aggregate head could not be locked');

  const sequence = head.lastSequence + 1;
  const canonical = createCanonicalAuditEvent(
    { ...draft, aggregateId },
    { eventId: ids.next(), occurredAt: clock.now().toISOString(), sequence },
  );
  const eventHash = computeAuditEventHash(head.lastEventHash, canonical);
  const record: AuditEventRecord = {
    ...canonical,
    previousHash: head.lastEventHash,
    eventHash,
  };

  await transaction.insert(auditEvents).values({
    eventId: record.eventId,
    actorType: record.actor.type,
    actorId: record.actor.id,
    eventType: record.eventType,
    occurredAt: new Date(record.occurredAt),
    source: record.source,
    outcome: record.outcome,
    sessionId: record.sessionId,
    correlationId: record.correlationId,
    aggregateId: record.aggregateId,
    sequence: record.sequence,
    payload: record.payload,
    previousHash: record.previousHash,
    eventHash: record.eventHash,
  });
  await transaction
    .update(auditEventHeads)
    .set({ lastSequence: sequence, lastEventHash: eventHash })
    .where(eq(auditEventHeads.aggregateId, aggregateId));

  // The existing aggregate head lock orders these references with human messages.
  // No copied prose, model call, queue, or second event authority is introduced.
  // Fixed operational copy is derived from this immutable source event at read time.
  if (run && narrateRunConversationEvent(record) !== null) {
    const [last] = await transaction.select({ sequence: sql<number>`coalesce(max(${runConversationMessage.sequence}), 0)::int` })
      .from(runConversationMessage).where(eq(runConversationMessage.runId, run.runId));
    // The bounded conversation must never stop authoritative execution. The audit
    // event above remains complete and available through the existing timeline.
    if ((last?.sequence ?? 0) >= 1_000_000) return record;
    await transaction.insert(runConversationMessage).values({
      messageId: record.eventId,
      runId: run.runId,
      sequence: (last?.sequence ?? 0) + 1,
      actorId: record.actor.id,
      kind: 'platform-event',
      createdAt: new Date(record.occurredAt),
      sourceEventSequence: record.sequence,
    });
    await transaction.execute(sql`SELECT pg_notify('run_timeline', ${JSON.stringify({ runId: run.runId, sequence: record.sequence })})`);
  }

  return record;
}

export interface PostgresAuditDependencies {
  readonly clock?: Clock;
  readonly ids?: UuidV7Generator;
}

/**
 * The append port, bound to one transaction.
 *
 * Exported so a richer unit of work — one that also carries the identity writers — can
 * be assembled without a second copy of the append logic. There is one appender, and
 * every unit of work uses it.
 */
export function createAuditEventWriter(
  transaction: Transaction,
  clock: Clock,
  ids: UuidV7Generator,
): AuditEventWriter {
  return { append: (draft) => appendAuditEvent(transaction, clock, ids, draft) };
}

/** PostgreSQL implementation of the application-owned atomic audit unit of work. */
export class PostgresAuditUnitOfWork implements AuditUnitOfWork {
  private readonly clock: Clock;
  private readonly ids: UuidV7Generator;

  constructor(
    private readonly db: Database,
    dependencies: PostgresAuditDependencies = {},
  ) {
    this.clock = dependencies.clock ?? new SystemClock();
    this.ids = dependencies.ids ?? new CryptoUuidV7Generator();
  }

  execute<TResult>(work: (context: AuditUnitOfWorkContext) => Promise<TResult>): Promise<TResult> {
    return this.db.transaction(async (transaction) =>
      work({ auditEvents: createAuditEventWriter(transaction, this.clock, this.ids) }),
    );
  }
}

function verificationFailure(
  aggregateId: string,
  firstInvalidSequence: number,
  reason: Exclude<AuditChainVerificationResult, { valid: true }>['reason'],
): AuditChainVerificationResult {
  return { valid: false, aggregateId, firstInvalidSequence, reason };
}

/** Full verifier which takes a shared lock on the head for a consistent snapshot. */
export class PostgresAuditChainReader implements AuditChainReader {
  constructor(private readonly db: Database) {}

  verify(aggregateId: string): Promise<AuditChainVerificationResult> {
    return this.db.transaction(async (transaction) => {
      const [head] = await transaction
        .select()
        .from(auditEventHeads)
        .where(eq(auditEventHeads.aggregateId, aggregateId))
        .for('share');

      if (!head) {
        return {
          valid: true,
          aggregateId,
          eventCount: 0,
          headSequence: 0,
          headHash: ZERO_HASH,
        };
      }

      const rows = await transaction
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.aggregateId, aggregateId))
        .orderBy(asc(auditEvents.sequence));

      let previousHash = ZERO_HASH;
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        if (!row) continue;
        const expectedSequence = index + 1;
        if (row.sequence !== expectedSequence) {
          return verificationFailure(aggregateId, expectedSequence, 'SEQUENCE_MISMATCH');
        }
        if (row.previousHash !== previousHash) {
          return verificationFailure(aggregateId, expectedSequence, 'PREVIOUS_HASH_MISMATCH');
        }

        let canonical: CanonicalAuditEvent;
        try {
          canonical = createCanonicalAuditEvent(
            {
              actor: { type: row.actorType as CanonicalAuditEvent['actor']['type'], id: row.actorId },
              aggregateId: row.aggregateId,
              correlationId: row.correlationId,
              eventType: row.eventType as CanonicalAuditEvent['eventType'],
              outcome: row.outcome as CanonicalAuditEvent['outcome'],
              payload: row.payload,
              sessionId: row.sessionId,
              source: row.source as CanonicalAuditEvent['source'],
            },
            {
              eventId: row.eventId,
              occurredAt: row.occurredAt.toISOString(),
              sequence: row.sequence,
            },
          );
        } catch {
          return verificationFailure(aggregateId, expectedSequence, 'EVENT_HASH_MISMATCH');
        }
        const computed = computeAuditEventHash(previousHash, canonical);
        if (row.eventHash !== computed) {
          return verificationFailure(aggregateId, expectedSequence, 'EVENT_HASH_MISMATCH');
        }
        previousHash = row.eventHash;
      }

      if (head.lastSequence !== rows.length || head.lastEventHash !== previousHash) {
        return verificationFailure(
          aggregateId,
          Math.max(1, Math.min(head.lastSequence || 1, rows.length + 1)),
          'HEAD_MISMATCH',
        );
      }
      return {
        valid: true,
        aggregateId,
        eventCount: rows.length,
        headSequence: head.lastSequence,
        headHash: head.lastEventHash,
      };
    });
  }
}
