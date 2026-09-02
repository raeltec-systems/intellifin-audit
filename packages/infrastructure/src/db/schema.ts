import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import type { JsonObject } from '@intellifin/domain';

const ZERO_SHA256 = '0'.repeat(64);

/**
 * AD-8: PostgreSQL is the transactional system of record and explicit reviewed
 * migrations are the only way schema changes. Story 1.1 owns exactly two tables.
 */

/**
 * The one row-set that records which schema generation is applied. A process
 * refuses to start when `max(version)` falls outside its declared support range
 * (AD-15).
 */
export const schemaMeta = pgTable('schema_meta', {
  version: integer('version').primaryKey(),
  appliedAt: timestamp('applied_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});

/** Liveness proof written by `apps/worker`, read by operators and by tests. */
export const workerHeartbeat = pgTable('worker_heartbeat', {
  hostname: text('hostname').primaryKey(),
  seenAt: timestamp('seen_at', { withTimezone: true, mode: 'date' }).notNull(),
});

/** Serialization point for each aggregate's gapless audit-event chain. */
export const auditEventHeads = pgTable(
  'audit_event_heads',
  {
    aggregateId: text('aggregate_id').primaryKey(),
    lastSequence: bigint('last_sequence', { mode: 'number' }).notNull().default(0),
    lastEventHash: text('last_event_hash').notNull().default(ZERO_SHA256),
  },
  (table) => [
    check('audit_event_heads_sequence_nonnegative', sql`${table.lastSequence} >= 0`),
    check(
      'audit_event_heads_hash_format',
      sql`${table.lastEventHash} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

/** Immutable product audit events. Only the append adapter writes this table. */
export const auditEvents = pgTable(
  'audit_events',
  {
    eventId: uuid('event_id').primaryKey(),
    actorType: text('actor_type').notNull(),
    actorId: text('actor_id').notNull(),
    eventType: text('event_type').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),
    source: text('source').notNull(),
    outcome: text('outcome').notNull(),
    sessionId: text('session_id').notNull(),
    correlationId: text('correlation_id').notNull(),
    aggregateId: text('aggregate_id')
      .notNull()
      .references(() => auditEventHeads.aggregateId),
    sequence: bigint('sequence', { mode: 'number' }).notNull(),
    payload: jsonb('payload').$type<JsonObject>().notNull(),
    previousHash: text('previous_hash').notNull(),
    eventHash: text('event_hash').notNull(),
  },
  (table) => [
    uniqueIndex('audit_events_aggregate_sequence_uidx').on(table.aggregateId, table.sequence),
    index('audit_events_correlation_idx').on(table.correlationId),
    index('audit_events_type_time_idx').on(table.eventType, table.occurredAt),
    check('audit_events_sequence_positive', sql`${table.sequence} > 0`),
    check('audit_events_previous_hash_format', sql`${table.previousHash} ~ '^[0-9a-f]{64}$'`),
    check('audit_events_event_hash_format', sql`${table.eventHash} ~ '^[0-9a-f]{64}$'`),
  ],
);

export type SchemaMetaRow = typeof schemaMeta.$inferSelect;
export type WorkerHeartbeatRow = typeof workerHeartbeat.$inferSelect;
export type AuditEventHeadRow = typeof auditEventHeads.$inferSelect;
export type AuditEventRow = typeof auditEvents.$inferSelect;
