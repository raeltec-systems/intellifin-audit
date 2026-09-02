import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
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
 * migrations are the only way schema changes. Generation 3 adds the Better Auth
 * identity tables and the application-owned `user_role` assignment.
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

/**
 * Better Auth's four tables (generation 3).
 *
 * The `auth_` prefix keeps them clear of `user`, which is a reserved word in SQL,
 * and marks them as the identity provider's storage rather than product state. The
 * JavaScript property names are the field names Better Auth asks the Drizzle adapter
 * for, so they stay camelCase while the columns stay snake_case.
 *
 * There is deliberately NO role column on `auth_user`. Authorization comes from
 * `user_role` below and from nowhere else (AD-7).
 */
export const authUser = pgTable('auth_user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});

export const authSession = pgTable('auth_session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => authUser.id, { onDelete: 'cascade' }),
});

export const authAccount = pgTable(
  'auth_account',
  {
    id: text('id').primaryKey(),
    issuer: text('issuer').notNull(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', {
      withTimezone: true,
      mode: 'date',
    }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', {
      withTimezone: true,
      mode: 'date',
    }),
    scope: text('scope'),
    /** Better Auth's password hash for the credential provider. Never read by us. */
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('auth_account_issuer_account_id_uidx').on(table.issuer, table.accountId),
  ],
);

export const authVerification = pgTable('auth_verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});

/**
 * The application-owned role assignment (FR-2, AD-7).
 *
 * This table, not the identity provider's user record, is the authority on what a
 * person may do. It is read on every request; deleting a row revokes the role on the
 * next request without touching the session that already exists.
 *
 * One role per user in the PoC, so the user id is the primary key.
 */
/**
 * The role vocabulary, spelled out rather than imported from `@intellifin/domain`.
 *
 * `drizzle-kit generate` transpiles this file and resolves `@intellifin/domain` to its
 * BUILT output, so a value import here would make migration generation depend on a
 * prior `pnpm build` — an ordering nobody would remember and CI would only discover
 * on a fresh checkout. A type-only import is erased and stays free.
 *
 * `schema.test.ts` fails if this list and `ROLES` ever differ.
 */
export const ROLE_VOCABULARY = ['auditor', 'audit-manager', 'poc-administrator'] as const;

const ROLE_VOCABULARY_SQL = ROLE_VOCABULARY.map((role) => `'${role}'`).join(', ');

export const userRole = pgTable(
  'user_role',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    assignedAt: timestamp('assigned_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    /** The administrator who assigned it. Null for an operator-seeded row. */
    assignedBy: text('assigned_by'),
  },
  (table) => [
    // `sql.raw` is safe here: every member is lower-case ASCII letters and hyphens.
    check('user_role_role_vocabulary', sql`${table.role} IN (${sql.raw(ROLE_VOCABULARY_SQL)})`),
  ],
);

export type SchemaMetaRow = typeof schemaMeta.$inferSelect;
export type WorkerHeartbeatRow = typeof workerHeartbeat.$inferSelect;
export type AuditEventHeadRow = typeof auditEventHeads.$inferSelect;
export type AuditEventRow = typeof auditEvents.$inferSelect;
export type AuthUserRow = typeof authUser.$inferSelect;
export type AuthSessionRow = typeof authSession.$inferSelect;
export type UserRoleRow = typeof userRole.$inferSelect;
