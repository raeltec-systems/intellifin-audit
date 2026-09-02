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
export const authUser = pgTable(
  'auth_user',
  {
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
  },
  (table) => [
    /**
     * One address, one account, whatever its case (generation 4).
     *
     * `.unique()` above is case-SENSITIVE, so `Dana@x` and `dana@x` are two rows to
     * PostgreSQL and one person to everybody else. The create-user command lowercases
     * when it checks for an existing address, but a check is not a constraint: two
     * concurrent creates of the two spellings both pass the check and both insert. This
     * index is what actually makes it impossible, and the command maps its violation to
     * the same "already has an account" refusal.
     */
    uniqueIndex('auth_user_email_lower_uidx').on(sql`lower(${table.email})`),
  ],
);

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
 * Better Auth's rate-limit counters.
 *
 * Stored in PostgreSQL rather than in process memory because the deployment can run
 * more than one web container, and a per-process counter is a limit an attacker walks
 * around by being load-balanced to the other one. `/api/auth/**` is the only publicly
 * allowlisted surface in the application, so its limiter has to actually hold.
 */
export const authRateLimit = pgTable('auth_rate_limit', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
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
    /**
     * The administrator who assigned it. Null for an operator-seeded row.
     *
     * Generation 4 makes it a real reference. Story 1.5 is the first thing that writes
     * it, and an attribution column that can hold any string is not an attribution: the
     * constraint is what makes "assigned by whom" answerable from the row. `SET NULL`
     * rather than `CASCADE`, because removing the administrator who granted a role must
     * not remove the role — that would be a silent privilege revocation nothing audited.
     */
    assignedBy: text('assigned_by').references(() => authUser.id, { onDelete: 'set null' }),
  },
  (table) => [
    // `sql.raw` is safe here: every member is lower-case ASCII letters and hyphens.
    check('user_role_role_vocabulary', sql`${table.role} IN (${sql.raw(ROLE_VOCABULARY_SQL)})`),
  ],
);

/**
 * Target System registrations (generation 5, FR-8, AD-2).
 *
 * The digest is stored beside the row rather than computed on read. It is computed by
 * `packages/domain/src/registrations/target-system.ts` and by nothing else — recomputing
 * it in SQL would be a second implementation of the value a Procedure Version freezes,
 * and the two would eventually disagree about a trimmed space or a sort order.
 *
 * Three vocabularies are spelled out here rather than imported from `@intellifin/domain`,
 * for the reason `ROLE_VOCABULARY` gives above: `drizzle-kit generate` transpiles this
 * file and resolves the workspace package to its BUILT output, so a value import would
 * make migration generation depend on a prior `pnpm build`. `schema.test.ts` fails if any
 * of them drifts from the domain list.
 */
export const TARGET_SYSTEM_KIND_VOCABULARY = ['web', 'desktop', 'api', 'versioned-file'] as const;

export const REGISTRATION_STATUS_VOCABULARY = ['active', 'retired'] as const;

/**
 * Every action an audit credential may be permitted. All of them observe.
 *
 * This list is a CHECK constraint, not documentation: `permitted_actions <@ ARRAY[...]`
 * means the database itself refuses a row containing anything else. FR-8's "write-capable
 * credentials are rejected" then survives a bug in the command, a direct `INSERT` from a
 * migration, and anything a later story adds — the one place it cannot be worked around
 * is the table.
 */
export const PERMITTED_READ_ACTION_VOCABULARY = [
  'navigate',
  'search',
  'list-records',
  'open-record',
  'read-attribute',
  'read-metadata',
  'read-file',
  'capture-screenshot',
] as const;

export const PROBE_STATE_VOCABULARY = ['reachable', 'unreachable'] as const;

const quoted = (values: readonly string[]): string => values.map((value) => `'${value}'`).join(', ');

export const targetSystemRegistration = pgTable(
  'target_system_registration',
  {
    registrationId: uuid('registration_id').primaryKey(),
    displayName: text('display_name').notNull(),
    kind: text('kind').notNull(),
    /** Allowlisted origins. Empty for a `desktop` system, which uses the identity below. */
    allowedOrigins: text('allowed_origins').array().notNull().default(sql`'{}'::text[]`),
    applicationIdentity: text('application_identity').notNull().default(''),
    /** Opaque. This column holds a REFERENCE; no secret value ever reaches this database. */
    credentialRef: text('credential_ref').notNull(),
    permittedActions: text('permitted_actions').array().notNull(),
    attributeLabelPatterns: text('attribute_label_patterns')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    secondaryKey: text('secondary_key').notNull().default(''),
    note: text('note').notNull().default(''),
    status: text('status').notNull().default('active'),
    /** The AD-2 digest, lower-case SHA-256 hex. */
    digest: text('digest').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // `sql.raw` is safe for all three: every member is lower-case ASCII and hyphens.
    check(
      'target_system_registration_kind_vocabulary',
      sql`${table.kind} IN (${sql.raw(quoted(TARGET_SYSTEM_KIND_VOCABULARY))})`,
    ),
    check(
      'target_system_registration_status_vocabulary',
      sql`${table.status} IN (${sql.raw(quoted(REGISTRATION_STATUS_VOCABULARY))})`,
    ),
    /** FR-8, at the one layer nothing can route around: no write action, ever. */
    check(
      'target_system_registration_actions_read_only',
      sql`${table.permittedActions} <@ ARRAY[${sql.raw(quoted(PERMITTED_READ_ACTION_VOCABULARY))}]::text[]`,
    ),
    /**
     * `cardinality`, not `array_length(..., 1)`.
     *
     * `array_length` of an empty array is NULL, and a CHECK constraint that evaluates to
     * NULL PASSES — so the obvious spelling of this rule accepts exactly the row it was
     * written to refuse. `cardinality` returns 0. The integration suite inserts an empty
     * array with raw SQL and expects the refusal by name, which is how this was caught.
     */
    check(
      'target_system_registration_actions_present',
      sql`cardinality(${table.permittedActions}) >= 1`,
    ),
    check('target_system_registration_digest_format', sql`${table.digest} ~ '^[0-9a-f]{64}$'`),
  ],
);

/**
 * What the WORKER last observed about a Target System (AD-10).
 *
 * The web process only ever reads this table. A registration with no row here has never
 * been probed, which is the state every registration is in until Story 1.8 brings the
 * synthetic Northstar systems and the probing loop that writes here.
 */
export const targetSystemProbe = pgTable(
  'target_system_probe',
  {
    registrationId: uuid('registration_id')
      .primaryKey()
      .references(() => targetSystemRegistration.registrationId, { onDelete: 'cascade' }),
    state: text('state').notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true, mode: 'date' }).notNull(),
    /** The worker that wrote it. Never a payload, a URL or anything the probe read. */
    observedBy: text('observed_by').notNull(),
  },
  (table) => [
    check(
      'target_system_probe_state_vocabulary',
      sql`${table.state} IN (${sql.raw(quoted(PROBE_STATE_VOCABULARY))})`,
    ),
  ],
);

export type SchemaMetaRow = typeof schemaMeta.$inferSelect;
export type WorkerHeartbeatRow = typeof workerHeartbeat.$inferSelect;
export type AuditEventHeadRow = typeof auditEventHeads.$inferSelect;
export type AuditEventRow = typeof auditEvents.$inferSelect;
export type AuthUserRow = typeof authUser.$inferSelect;
export type AuthSessionRow = typeof authSession.$inferSelect;
export type AuthRateLimitRow = typeof authRateLimit.$inferSelect;
export type UserRoleRow = typeof userRole.$inferSelect;
export type TargetSystemRegistrationRow = typeof targetSystemRegistration.$inferSelect;
export type TargetSystemProbeRow = typeof targetSystemProbe.$inferSelect;
