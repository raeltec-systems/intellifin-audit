import type { PlanDerivationFields, AgentModelIdentity, AgentModelResponse, EscalationOption, AgentWorkCheckpoint } from '@intellifin/application';
import type { VersionAuthorship, VersionDecisionRecord, FrozenVersionReview, SubmittedVersionReview } from '@intellifin/domain';
import { sql } from 'drizzle-orm';
import {
  primaryKey,
  foreignKey,
  date,
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import type { CompiledComplianceCondition, DraftSchedule, DraftSection, EvidenceRequirement, ExplicitPeriod, InclusionRule, ProcedureSourceSnapshot, ProcedureTargetSnapshot, PopulationBlocker, TargetInstruction, JsonObject } from '@intellifin/domain';

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
    /** Exact query-free HTTP(S) form action for credential entry, when configured. */
    authenticationDestination: text('authentication_destination'),
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
      sql`cardinality(${table.permittedActions}) >= 1
        AND array_position(${table.permittedActions}, NULL) IS NULL`,
    ),
    /** A direct SQL writer must not bypass the frozen endpoint's basic shape contract. */
    check(
      'target_system_registration_authentication_destination_shape',
      sql`${table.authenticationDestination} IS NULL OR (
        ${table.kind} = 'web'
        AND
        length(${table.authenticationDestination}) BETWEEN 1 AND 2048
        AND btrim(${table.authenticationDestination}) = ${table.authenticationDestination}
        AND ${table.authenticationDestination} ~* '^https?://[^[:space:]?#@]+$'
      )`,
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

/**
 * The Population Source binding vocabularies (generation 6, FR-6, FR-41).
 *
 * Spelled out here rather than imported from `@intellifin/domain`, for the reason
 * `TARGET_SYSTEM_KIND_VOCABULARY` gives above: `drizzle-kit generate` resolves the
 * workspace package to its BUILT output, so a value import would make migration
 * generation depend on a prior `pnpm build`. `schema.test.ts` fails if either drifts.
 */
export const POPULATION_SOURCE_KIND_VOCABULARY = [
  'manual-upload',
  'versioned-file',
  'read-only-api',
] as const;

export const DECLARED_COUNT_MECHANISM_VOCABULARY = [
  'cover-sheet',
  'count-endpoint',
  'none',
] as const;

export const BINDING_STATUS_VOCABULARY = ['active', 'retired'] as const;

/**
 * Population Source bindings (generation 6, FR-6, FR-41).
 *
 * The digest is stored beside the row and never recomputed on read, for the same reason
 * the registration digest is: it is the value a Procedure Version freezes, and a second
 * implementation in SQL would eventually disagree with the domain module about a trimmed
 * space or a sort order.
 *
 * Two of the CHECK constraints are the point of the table.
 * `..._sensitive_fields_declared` is FR-41's masking rule at the one layer nothing can
 * route around: `sensitive_fields <@ declared_schema` means no command, migration or
 * psql session can store a mask over a field the schema does not declare — a mask that
 * hides nothing while reading, in a list view, exactly like protection.
 * `..._schema_present` refuses a binding that declares no fields at all, written with
 * `cardinality` because `array_length(x, 1)` of an empty array is NULL and a NULL CHECK
 * PASSES, which would accept exactly the row it forbids.
 *
 * No credential is stored here and there is no column one could go in. A `read-only-api`
 * binding names a location; the credential a Run uses belongs to the Target System
 * registration, which already proves it read-only.
 */
export const populationSourceBinding = pgTable(
  'population_source_binding',
  {
    bindingId: uuid('binding_id').primaryKey(),
    displayName: text('display_name').notNull(),
    kind: text('kind').notNull(),
    /** Where the population is found. Empty for a `manual-upload` binding, which names nowhere. */
    location: text('location').notNull().default(''),
    /** Field names, IN ORDER: a schema is a positional declaration. */
    declaredSchema: text('declared_schema').array().notNull(),
    declaredCountMechanism: text('declared_count_mechanism').notNull(),
    /** A set, sorted, and always a subset of `declared_schema` (FR-41). */
    sensitiveFields: text('sensitive_fields').array().notNull().default(sql`'{}'::text[]`),
    note: text('note').notNull().default(''),
    status: text('status').notNull().default('active'),
    /** The binding digest, lower-case SHA-256 hex. */
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
      'population_source_binding_kind_vocabulary',
      sql`${table.kind} IN (${sql.raw(quoted(POPULATION_SOURCE_KIND_VOCABULARY))})`,
    ),
    check(
      'population_source_binding_mechanism_vocabulary',
      sql`${table.declaredCountMechanism} IN (${sql.raw(quoted(DECLARED_COUNT_MECHANISM_VOCABULARY))})`,
    ),
    check(
      'population_source_binding_status_vocabulary',
      sql`${table.status} IN (${sql.raw(quoted(BINDING_STATUS_VOCABULARY))})`,
    ),
    /**
     * A declared schema is a non-empty list of NAMES, and all three words are enforced.
     *
     * `cardinality`, not `array_length(..., 1)`: `array_length` of an empty array is
     * NULL, and a CHECK that evaluates to NULL PASSES, so the obvious spelling accepts
     * exactly the row it was written to refuse.
     *
     * But cardinality counts ELEMENTS, not names — `ARRAY[NULL]` and `ARRAY['']` both
     * have cardinality 1 and were both accepted. A NULL element then flows out of the
     * repository typed `string[]`, and an empty name is a field nothing can ever match.
     * `array_position(x, NULL) IS NULL` is the NULL test that works: `NULL <> ALL(x)`
     * returns NULL, which passes, one operator along from the same trap.
     */
    check(
      'population_source_binding_schema_present',
      sql`cardinality(${table.declaredSchema}) >= 1
        AND array_position(${table.declaredSchema}, NULL) IS NULL
        AND '' <> ALL (${table.declaredSchema})`,
    ),
    /** FR-41, at the one layer nothing can route around: no mask over an undeclared field. */
    check(
      'population_source_binding_sensitive_fields_declared',
      sql`${table.sensitiveFields} <@ ${table.declaredSchema}
        AND array_position(${table.sensitiveFields}, NULL) IS NULL`,
    ),
    /**
     * A binding names somewhere, or it is a manual upload that names nowhere.
     *
     * Both directions, because both are wrong. A versioned file with no location points
     * at nothing; a manual upload WITH one holds a value the digest deliberately drops,
     * so the row would say something the frozen contract does not.
     */
    check(
      'population_source_binding_location_matches_kind',
      sql`(${table.kind} = 'manual-upload' AND ${table.location} = '') OR (${table.kind} <> 'manual-upload' AND btrim(${table.location}) <> '')`,
    ),
    check('population_source_binding_digest_format', sql`${table.digest} ~ '^[0-9a-f]{64}$'`),
  ],
);

/**
 * The Procedure vocabularies (generation 7, FR-4, FR-5).
 *
 * Spelled out here rather than imported from `@intellifin/domain`, for the reason
 * `ROLE_VOCABULARY` gives above: `drizzle-kit generate` resolves the workspace package
 * to its BUILT output, so a value import would make migration generation depend on a
 * prior `pnpm build`. `schema.test.ts` fails if either drifts.
 */
export const PROCEDURE_VERSION_STATE_VOCABULARY = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'ACTIVE',
  'RETIRED',
] as const;

export const PROCEDURE_TEMPLATE_VOCABULARY = ['P-1', 'P-2', 'P-3', 'P-4'] as const;

/**
 * Procedures (generation 7, FR-4).
 *
 * The Control name here is the Procedure's current heading, which for a one-version
 * Procedure is the Draft's own name. A Procedure with two versions that disagree still
 * has ONE current heading, and this column holds it; the version row holds the name the
 * version was authored under. Both are non-blank; the CHECK is the layer nothing can
 * route around.
 *
 * `template_id` is a CHECK over the four shipped Templates and not a foreign key:
 * the Templates are build constants owned by the domain module (AD-2), not rows, so
 * there is no `template` table to reference — and no Template row an operator could
 * edit to drift a deployment from the contract its own tests assert.
 */
export const procedure = pgTable(
  'procedure',
  {
    procedureId: uuid('procedure_id').primaryKey(),
    controlName: text('control_name').notNull(),
    templateId: text('template_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // `sql.raw` is safe for both: every member is upper-case ASCII, digits and hyphens.
    check(
      'procedure_template_vocabulary',
      sql`${table.templateId} IN (${sql.raw(quoted(PROCEDURE_TEMPLATE_VOCABULARY))})`,
    ),
    // `btrim`, not `<> ''`: a Control name of three spaces is blank, and a rule written
    // without the trim accepts exactly the row it was written to refuse.
    check('procedure_control_name_present', sql`btrim(${table.controlName}) <> ''`),
  ],
);

/**
 * Procedure Versions (generation 7, FR-5).
 *
 * The state vocabulary is the whole of addendum §E from the first commit, so the
 * machine never grows an arrow per story; this story writes only `DRAFT`. The
 * sections payload is `jsonb` and `NOT NULL` — never read untyped, because the domain
 * owns its shape and its validator, and each later story promotes its part of it to
 * typed columns when it authors that section.
 *
 * `version_number` starts at 1 and no two versions of one Procedure share a number:
 * the UNIQUE constraint is the whole of "version numbering" this story needs, and
 * stories 2.7 and 2.8 build on it rather than renumbering anything.
 */
export const procedureVersion = pgTable(
  'procedure_version',
  {
    versionId: uuid('version_id').primaryKey(),
    procedureId: uuid('procedure_id')
      .notNull()
      .references(() => procedure.procedureId, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),
    state: text('state').notNull(),
    controlName: text('control_name').notNull(),
    templateId: text('template_id').notNull(),
    sections: jsonb('sections').$type<readonly DraftSection[]>().notNull(),
    period: jsonb('period').$type<ExplicitPeriod>(),
    scope: text('scope').notNull().default(''),
    sourceSnapshot: jsonb('source_snapshot').$type<ProcedureSourceSnapshot>(),
    inclusionRule: jsonb('inclusion_rule').$type<InclusionRule>().notNull().default({ schemaVersion: 1, all: [] }),
    zeroRecordPass: boolean('zero_record_pass').notNull().default(false),
    allowVersionedDuplicates: boolean('allow_versioned_duplicates').notNull().default(false),
    populationBlockers: jsonb('population_blockers').$type<readonly PopulationBlocker[]>().notNull().default([]),
    /**
     * Target System selection and per-system Audit Instructions (generation 9, FR-7, FR-8).
     *
     * `targets` is an ordered array of frozen six-key registration snapshots; `instructions`
     * is the verbatim per-system text. Both are `jsonb NOT NULL` and never read untyped —
     * the domain's `isDraftTargetFields` is the one reader, and a row that fails it reads as
     * nothing. The CHECKs below are the shallow shape guard (array, bounded length) the one
     * layer nothing can route around; the domain validator does the deep validation.
     */
    targets: jsonb('targets').$type<readonly ProcedureTargetSnapshot[]>().notNull().default([]),
    instructions: jsonb('instructions').$type<readonly TargetInstruction[]>().notNull().default([]),
    complianceSchemaVersion: integer('compliance_schema_version').notNull().default(1),
    complianceCompilerVersion: text('compliance_compiler_version').notNull().default('1'),
    complianceConditions: jsonb('compliance_conditions').$type<readonly CompiledComplianceCondition[]>().notNull(),
    // Text preserves the author's exact decimal, including its trailing zeroes.
    agentJudgedThreshold: text('agent_judged_threshold').notNull().default('0.80'),
    /**
     * Evidence Requirements and the Schedule (generation 11, FR-9, FR-10).
     *
     * `evidenceRequirements` is an array of typed, per-attribute requirements; the
     * domain's `isDraftEvidenceFields` is the one reader, and a row that fails it reads
     * as nothing — the same discipline `targets`/`instructions` use. `schedule` is
     * `jsonb`, nullable: a Draft starts with no Schedule and the auditor sets it
     * explicitly. The CHECKs below are the shallow shape guard the one layer nothing can
     * route around; the deep validation (the grounding rule, the platform-captured
     * invariant, the period-derivation rule matching the frequency) is the domain's.
     */
    evidenceSchemaVersion: integer('evidence_schema_version').notNull().default(1),
    evidenceRequirements: jsonb('evidence_requirements').$type<readonly EvidenceRequirement[]>().notNull().default([]),
    schedule: jsonb('schedule').$type<DraftSchedule>(),
    planCompilerVersion: text('plan_compiler_version').notNull().default('1'),
    derivationModel: jsonb('derivation_model').$type<PlanDerivationFields['derivationModel']>(),
    compiledPlan: jsonb('compiled_plan').$type<PlanDerivationFields['compiledPlan']>(),
    planInputDigest: text('plan_input_digest'),
    planStatus: text('plan_status').$type<PlanDerivationFields['planStatus']>().notNull().default('pending'),
    planFailureReason: text('plan_failure_reason'),
    planDerivable: boolean('plan_derivable').notNull().default(false),
    planAttempts: jsonb('plan_attempts').$type<PlanDerivationFields['planAttempts']>().notNull().default([]),
    authorship: jsonb('authorship').$type<VersionAuthorship>(),
    decisions: jsonb('decisions').$type<readonly VersionDecisionRecord[]>().notNull().default([]),
    frozenReview: jsonb('frozen_review').$type<FrozenVersionReview>(),
    submittedReview: jsonb('submitted_review').$type<SubmittedVersionReview>(),
    lifecycle: jsonb('lifecycle').$type<import('@intellifin/domain').VersionLifecycle>(),
    platformOrigin: jsonb('platform_origin').$type<import('@intellifin/domain').PlatformDraftOrigin>(),
    configurationRevision: text('configuration_revision'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('procedure_version_owner_uidx').on(table.procedureId, table.versionId),
    uniqueIndex('procedure_version_procedure_number_uidx').on(
      table.procedureId,
      table.versionNumber,
    ),
    check(
      'procedure_version_state_vocabulary',
      sql`${table.state} IN (${sql.raw(quoted(PROCEDURE_VERSION_STATE_VOCABULARY))})`,
    ),
    check(
      'procedure_version_template_vocabulary',
      sql`${table.templateId} IN (${sql.raw(quoted(PROCEDURE_TEMPLATE_VOCABULARY))})`,
    ),
    // The same btrim rule as the parent table: whitespace is blank.
    check('procedure_version_control_name_present', sql`btrim(${table.controlName}) <> ''`),
    check('procedure_version_number_at_least_one', sql`${table.versionNumber} >= 1`),
    check('procedure_version_period_shape', sql`${table.period} IS NULL OR coalesce(jsonb_typeof(${table.period}) = 'object' AND ${table.period} - 'from' - 'to' = '{}'::jsonb AND ${table.period}->>'from' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND ${table.period}->>'to' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND (${table.period}->>'from')::date <= (${table.period}->>'to')::date AND (${table.period}->>'from')::date >= date '0001-01-01', false)`),
    check('procedure_version_scope_bound', sql`length(${table.scope}) <= 10000`),
    check('procedure_version_source_shape', sql`${table.sourceSnapshot} IS NULL OR coalesce(jsonb_typeof(${table.sourceSnapshot}) = 'object' AND ${table.sourceSnapshot} - 'bindingId' - 'displayName' - 'digest' - 'contract' = '{}'::jsonb AND ${table.sourceSnapshot}->>'bindingId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' AND ${table.sourceSnapshot}->>'digest' ~ '^[0-9a-f]{64}$' AND length(${table.sourceSnapshot}->>'displayName') BETWEEN 1 AND 200 AND jsonb_typeof(${table.sourceSnapshot}->'contract') = 'object' AND ${table.sourceSnapshot}->'contract' ?& ARRAY['kind','location','declared_schema','declared_count_mechanism','sensitive_fields'] AND (${table.sourceSnapshot}->'contract') - 'kind' - 'location' - 'declared_schema' - 'declared_count_mechanism' - 'sensitive_fields' = '{}'::jsonb AND ${table.sourceSnapshot}->'contract'->>'kind' IN ('manual-upload','versioned-file','read-only-api') AND ${table.sourceSnapshot}->'contract'->>'declared_count_mechanism' IN ('cover-sheet','count-endpoint','none') AND jsonb_typeof(${table.sourceSnapshot}->'contract'->'declared_schema') = 'array' AND jsonb_typeof(${table.sourceSnapshot}->'contract'->'sensitive_fields') = 'array', false)`),
    check('procedure_version_rule_shape', sql`coalesce(jsonb_typeof(${table.inclusionRule}) = 'object' AND ${table.inclusionRule} - 'schemaVersion' - 'all' = '{}'::jsonb AND ${table.inclusionRule}->'schemaVersion' = '1'::jsonb AND jsonb_typeof(${table.inclusionRule}->'all') = 'array' AND jsonb_array_length(${table.inclusionRule}->'all') <= 32, false)`),
    check('procedure_version_count_blocker', sql`${table.populationBlockers} = CASE WHEN ${table.sourceSnapshot}->'contract'->>'declared_count_mechanism' = 'none' THEN '["declared-count-missing"]'::jsonb ELSE '[]'::jsonb END`),
    // Shallow shape guard (generation 9): an array, bounded. The deep validation — every
    // snapshot self-consistent, every instruction for a selected agent-driven system — is
    // the domain's `isDraftTargetFields`, which a raw writer cannot be made to run.
    check('procedure_version_targets_shape', sql`coalesce(jsonb_typeof(${table.targets}) = 'array' AND jsonb_array_length(${table.targets}) <= 32, false)`),
    check('procedure_version_instructions_shape', sql`coalesce(jsonb_typeof(${table.instructions}) = 'array' AND jsonb_array_length(${table.instructions}) <= 32, false)`),
    check('procedure_version_compliance_schema', sql`${table.complianceSchemaVersion} = 1`),
    check('procedure_version_compliance_compiler', sql`${table.complianceCompilerVersion} = '1'`),
    check('procedure_version_compliance_shape', sql`coalesce(jsonb_typeof(${table.complianceConditions}) = 'array' AND jsonb_array_length(${table.complianceConditions}) BETWEEN 1 AND 32, false)`),
    check('procedure_version_confidence_range', sql`CASE WHEN length(${table.agentJudgedThreshold}) <= 100 AND ${table.agentJudgedThreshold} ~ '^-?(0|[1-9][0-9]*)([.][0-9]+)?$' THEN ${table.agentJudgedThreshold}::numeric BETWEEN 0 AND 1 ELSE false END`),
    check('procedure_version_plan_compiler', sql`length(${table.planCompilerVersion}) BETWEEN 1 AND 64`),
    check('procedure_version_plan_model', sql`${table.derivationModel} IS NULL OR coalesce(jsonb_typeof(${table.derivationModel}) = 'object' AND ${table.derivationModel} - 'provider' - 'modelId' - 'promptVersion' = '{}'::jsonb AND jsonb_typeof(${table.derivationModel}->'provider') = 'string' AND jsonb_typeof(${table.derivationModel}->'modelId') = 'string' AND jsonb_typeof(${table.derivationModel}->'promptVersion') = 'string' AND length(${table.derivationModel}->>'provider') BETWEEN 1 AND 100 AND length(${table.derivationModel}->>'modelId') BETWEEN 1 AND 200 AND length(${table.derivationModel}->>'promptVersion') BETWEEN 1 AND 100, false)`),
    check('procedure_version_plan_shape', sql`${table.compiledPlan} IS NULL OR coalesce(jsonb_typeof(${table.compiledPlan}) = 'object' AND ${table.compiledPlan}->'schemaVersion' = '1'::jsonb, false)`),
    check('procedure_version_plan_digest', sql`${table.planInputDigest} IS NULL OR ${table.planInputDigest} ~ '^[0-9a-f]{64}$'`),
    check('procedure_version_plan_status', sql`${table.planStatus} IN ('pending','succeeded','failed')`),
    check('procedure_version_plan_failure', sql`${table.planFailureReason} IS NULL OR length(${table.planFailureReason}) BETWEEN 1 AND 1000`),
    check('procedure_version_plan_attempts', sql`coalesce(jsonb_typeof(${table.planAttempts}) = 'array', false)`),
    check('procedure_version_authorship_shape', sql`${table.authorship} IS NULL OR coalesce(jsonb_typeof(${table.authorship}) = 'object' AND jsonb_typeof(${table.authorship}->'createdBy') = 'object' AND ${table.authorship}->'createdBy'->>'type' IN ('human','platform') AND jsonb_typeof(${table.authorship}->'createdBy'->'id') = 'string' AND jsonb_typeof(${table.authorship}->'responsibleAuthorId') = 'string' AND jsonb_typeof(${table.authorship}->'humanAuthorIds') = 'array', false)`),
    check('procedure_version_decisions_shape', sql`coalesce(jsonb_typeof(${table.decisions}) = 'array', false)`),
    check('procedure_version_submitted_review_shape', sql`${table.submittedReview} IS NULL OR coalesce(jsonb_typeof(${table.submittedReview}) = 'object' AND ${table.submittedReview}->'schemaVersion' = '1'::jsonb AND jsonb_typeof(${table.submittedReview}->'definition') = 'object' AND jsonb_typeof(${table.submittedReview}->'diff') = 'array', false)`),
    check('procedure_version_review_shape', sql`${table.frozenReview} IS NULL OR coalesce(jsonb_typeof(${table.frozenReview}) = 'object' AND ${table.frozenReview}->'schemaVersion' = '1'::jsonb AND jsonb_typeof(${table.frozenReview}->'definition') = 'object' AND jsonb_typeof(${table.frozenReview}->'diff') = 'array' AND jsonb_typeof(${table.frozenReview}->'approval') = 'object', false)`),
    check('procedure_version_plan_consistency', sql`coalesce((${table.planDerivable} = (${table.planStatus} = 'succeeded')) AND (${table.planStatus} <> 'succeeded' OR (${table.compiledPlan} IS NOT NULL AND ${table.planInputDigest} IS NOT NULL AND ${table.planFailureReason} IS NULL)) AND (${table.planStatus} <> 'failed' OR (${table.compiledPlan} IS NULL AND ${table.planFailureReason} IS NOT NULL)), false)`),
    check('procedure_version_evidence_schema', sql`${table.evidenceSchemaVersion} = 1`),
    // Shallow shape guard (generation 11): an array, bounded. The deep validation — the
    // grounding rule, the platform-captured invariant — is the domain's
    // `isDraftEvidenceFields`, which a raw writer cannot be made to run.
    check('procedure_version_evidence_shape', sql`coalesce(jsonb_typeof(${table.evidenceRequirements}) = 'array' AND jsonb_array_length(${table.evidenceRequirements}) <= 32, false)`),
    check('procedure_version_schedule_shape', sql`${table.schedule} IS NULL OR coalesce(jsonb_typeof(${table.schedule}) = 'object' AND ${table.schedule} - 'frequency' - 'startTime' - 'periodDerivationRule' = '{}'::jsonb AND ${table.schedule}->>'frequency' IN ('once','daily','weekly','monthly') AND jsonb_typeof(${table.schedule}->'periodDerivationRule') = 'string' AND ${table.schedule}->>'periodDerivationRule' = CASE ${table.schedule}->>'frequency' WHEN 'once' THEN 'explicit-period' WHEN 'daily' THEN 'previous-calendar-day' WHEN 'weekly' THEN 'previous-monday-sunday' WHEN 'monthly' THEN 'previous-calendar-month' END AND ${table.schedule}->>'startTime' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$', false)`),
  ],
);

export const notification = pgTable('notification', {
  sendKey: text('send_key').primaryKey(),
  recipientId: text('recipient_id').notNull().references(() => authUser.id),
  procedureId: uuid('procedure_id').notNull().references(() => procedure.procedureId),
  versionId: uuid('version_id').notNull().references(() => procedureVersion.versionId),
  procedureName: text('procedure_name').notNull(),
  versionNumber: integer('version_number').notNull(),
  kind: text('kind').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  runId: uuid('run_id').references(() => auditRun.runId),
  waitId: uuid('wait_id').references(() => runWait.waitId),
  escalationKind: text('escalation_kind'),
  deadline: timestamp('deadline', { withTimezone: true }),
  inAppOutcome: text('in_app_outcome'),
  emailOutcome: text('email_outcome'),
  emailOutcomeAt: timestamp('email_outcome_at', { withTimezone: true }),
}, table => [
  index('notification_recipient_delivery_idx').on(table.recipientId, table.deliveredAt.desc(), table.sendKey),
  index('notification_pending_delivery_idx').on(table.createdAt, table.sendKey).where(sql`${table.deliveredAt} IS NULL`),
  check('notification_version_number', sql`${table.versionNumber} > 0`),
  check('notification_kind', sql`${table.kind} IN ('submitted','approved','rejected','escalation')`),
  check('notification_escalation_context', sql`coalesce(
    (${table.kind} = 'escalation' AND ${table.runId} IS NOT NULL AND ${table.waitId} IS NOT NULL AND ${table.escalationKind} IN ('choose-candidate','unnamed-value','retry-or-skip') AND ${table.deadline} IS NOT NULL)
    OR (${table.kind} <> 'escalation' AND ${table.runId} IS NULL AND ${table.waitId} IS NULL AND ${table.escalationKind} IS NULL AND ${table.deadline} IS NULL AND ${table.inAppOutcome} IS NULL AND ${table.emailOutcome} IS NULL AND ${table.emailOutcomeAt} IS NULL), false)`),
  check('notification_in_app_outcome', sql`${table.inAppOutcome} IS NULL OR ${table.inAppOutcome} IN ('delivered','unconfigured','failed','superseded')`),
  check('notification_email_outcome', sql`(${table.emailOutcome} IS NULL AND ${table.emailOutcomeAt} IS NULL) OR (${table.emailOutcome} IS NOT NULL AND ${table.emailOutcome} IN ('delivered','unconfigured','failed','superseded') AND ${table.emailOutcomeAt} IS NOT NULL)`),
]);

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
export type PopulationSourceBindingRow = typeof populationSourceBinding.$inferSelect;
export type ProcedureRow = typeof procedure.$inferSelect;
export type ProcedureVersionRow = typeof procedureVersion.$inferSelect;

export const procedureChange = pgTable('procedure_change', {
  changeId: text('change_id').primaryKey(),
  versionIds: jsonb('version_ids').$type<readonly string[]>().notNull(),
});
export const procedureConfiguration = pgTable('procedure_configuration', {
  revision: text('revision').primaryKey(),
  configuration: jsonb('configuration').$type<import('@intellifin/domain').JsonValue>().notNull(),
  appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
});
export const procedureSuccession = pgTable('procedure_succession', {
  successorId: uuid('successor_id').primaryKey().references(() => procedureVersion.versionId),
  predecessorId: uuid('predecessor_id').notNull().references(() => procedureVersion.versionId),
  procedureId: uuid('procedure_id').notNull().references(() => procedure.procedureId),
  activatedAt: timestamp('activated_at', { withTimezone: true }),
  handoverAt: timestamp('handover_at', { withTimezone: true }),
}, table => [
  uniqueIndex('procedure_succession_activated_predecessor').on(table.predecessorId).where(sql`${table.activatedAt} IS NOT NULL`),
  check('procedure_succession_no_self', sql`${table.predecessorId} <> ${table.successorId}`),
  check('procedure_succession_boundary', sql`${table.handoverAt} IS NULL OR (${table.activatedAt} IS NOT NULL AND ${table.handoverAt} > ${table.activatedAt})`),
]);

export const auditRun = pgTable('audit_run', {
  revision: integer('revision').notNull().default(0),
  requestToken: uuid('request_token').notNull(),
  runId: uuid('run_id').primaryKey(), correlationId: uuid('correlation_id').notNull(),
  procedureId: uuid('procedure_id').notNull().references(() => procedure.procedureId),
  versionId: uuid('version_id').notNull().references(() => procedureVersion.versionId),
  versionNumber: integer('version_number').notNull(), procedureName: text('procedure_name').notNull(),
  periodFrom: date('period_from').notNull(), periodTo: date('period_to').notNull(),
  state: text('state').$type<import('@intellifin/domain').RunState>().notNull(),
  kind: text('kind').$type<import('@intellifin/domain').RunKind>().notNull(),
  initiatorId: text('initiator_id').notNull(), sessionId: text('session_id').notNull(),
  authorizationRole: text('authorization_role').notNull(),
  initiatedAt: timestamp('initiated_at', { withTimezone: true }).notNull(),
  /** Story 3.10. The rerun link: the Run this one follows, and why it exists. */
  predecessorRunId: uuid('predecessor_run_id').references((): import('drizzle-orm/pg-core').AnyPgColumn => auditRun.runId),
  rerunReason: text('rerun_reason'),
  /** Story 3.10. One person's durable cancellation request. All four, or none. */
  cancelRequestedAt: timestamp('cancel_requested_at', { withTimezone: true }),
  cancelRequestedBy: text('cancel_requested_by'),
  cancelRequestedSession: text('cancel_requested_session'),
  cancelReason: text('cancel_reason'),
}, table => [
  uniqueIndex('audit_run_initiator_request').on(table.initiatorId, table.requestToken),
  // A marker is written whole or not at all: a Canceled Run Detail states the actor, the
  // time and the reason, and three of four columns is a state that can say none of them.
  // `(a IS NULL) = (b IS NULL)` is boolean = boolean and is never NULL, so unlike a
  // comparison of the values themselves this CHECK cannot pass by evaluating to NULL.
  check('audit_run_cancel_request', sql`(${table.cancelRequestedAt} IS NULL) = (${table.cancelRequestedBy} IS NULL) AND (${table.cancelRequestedAt} IS NULL) = (${table.cancelRequestedSession} IS NULL) AND (${table.cancelRequestedAt} IS NULL) = (${table.cancelReason} IS NULL)`),
  check('audit_run_cancel_reason', sql`${table.cancelReason} IS NULL OR (length(${table.cancelReason}) BETWEEN 1 AND 500)`),
  // The predecessor and the reason are one fact. A link with no reason records that a
  // rerun exists and not why, which is exactly what FR-26 asks for.
  check('audit_run_rerun_link', sql`(${table.predecessorRunId} IS NULL) = (${table.rerunReason} IS NULL)`),
  check('audit_run_rerun_reason', sql`${table.rerunReason} IS NULL OR (length(${table.rerunReason}) BETWEEN 1 AND 500)`),
  check('audit_run_rerun_not_self', sql`${table.predecessorRunId} IS NULL OR ${table.predecessorRunId} <> ${table.runId}`),
  foreignKey({ name: 'audit_run_version_owner_fk', columns: [table.procedureId, table.versionId], foreignColumns: [procedureVersion.procedureId, procedureVersion.versionId] }),
  uniqueIndex('audit_run_active_standard_period').on(table.procedureId, table.periodFrom, table.periodTo).where(sql`${table.kind} = 'STANDARD' AND ${table.state} IN ('QUEUED','RUNNING','PAUSED','AWAITING_AUDITOR')`),
  check('audit_run_state', sql`${table.state} IN ('QUEUED','RUNNING','PAUSED','AWAITING_AUDITOR','COMPLETED','INCONCLUSIVE','RUN_FAILED','CANCELED')`),
  check('audit_run_kind', sql`${table.kind} IN ('STANDARD','REGRESSION')`),
  check('audit_run_period', sql`${table.periodFrom} >= DATE '0001-01-01' AND ${table.periodTo} <= DATE '9999-12-31' AND ${table.periodFrom} <= ${table.periodTo}`),
  check('audit_run_version', sql`${table.versionNumber} > 0`),
  check('audit_run_authorization', sql`${table.authorizationRole} IN ('auditor','audit-manager')`),
  check('audit_run_uuid_v7', sql`substring(${table.runId}::text, 15, 1) = '7' AND substring(${table.correlationId}::text, 15, 1) = '7'`),
]);


/**
 * What one caller's initiation request token was DECIDED to mean (generation 32).
 *
 * It used to be a binding from a token to a Run, and a request refused because somebody
 * else's Run held the Procedure and period was recorded by binding the token to THAT Run —
 * so replaying it answered success and walked the caller into another person's audit work.
 * The row now records the DECISION: the Run this caller's own request created, or the
 * refusal it received. Exactly one of the two, forever.
 *
 * The SUBJECT is stored here rather than read off a bound Run, because a refused request
 * has no Run to read it from, and it is what a token used for a different Procedure or
 * period is refused against.
 */
export const runInitiationRequest = pgTable('run_initiation_request', {
  initiatorId: text('initiator_id').notNull(), requestToken: uuid('request_token').notNull(),
  /**
   * The Procedure and period the request NAMED — deliberately with no foreign key.
   *
   * A request that names a Procedure which does not exist is exactly the `no-owner` case
   * this table has to be able to record, and a foreign key would refuse the row and answer
   * the caller a framework 500 instead of the refusal sentence. The subject is what the
   * caller asked for, not a claim that it exists; `RUN_TOKEN_REUSED` compares against it,
   * and it needs nothing more than to be the same string on a replay.
   */
  procedureId: uuid('procedure_id').notNull(),
  periodFrom: date('period_from').notNull(), periodTo: date('period_to').notNull(),
  /** The Run THIS caller's request created. Never another caller's. */
  runId: uuid('run_id').references(() => auditRun.runId),
  refusal: text('refusal'),
  /** The Run the refusal named, when it named one. A reference, never a binding. */
  refusedRunId: uuid('refused_run_id').references(() => auditRun.runId),
}, table => [
  primaryKey({ columns: [table.initiatorId, table.requestToken] }),
  // Exactly one outcome. `(a IS NULL) <> (b IS NULL)` is boolean <> boolean and is never
  // NULL, so unlike a comparison of the values themselves this cannot pass by evaluating
  // to NULL — the `audit_run_cancel_request` idiom, and the `array_length` trap avoided.
  check('run_initiation_request_decision', sql`(${table.runId} IS NULL) <> (${table.refusal} IS NULL)`),
  check('run_initiation_request_refusal', sql`${table.refusal} IS NULL OR ${table.refusal} IN ('already-active','no-owner','predecessor-active')`),
  // A named Run belongs to a refusal. A created Run is `run_id`; naming it twice would
  // invite a reader to ask which of the two the token really means.
  check('run_initiation_request_refused_run', sql`${table.refusedRunId} IS NULL OR ${table.refusal} IS NOT NULL`),
  check('run_initiation_request_period', sql`${table.periodFrom} <= ${table.periodTo}`),
]);

export const populationExecution = pgTable('population_execution', {
  runId: uuid('run_id').primaryKey().references(() => auditRun.runId),
  revision: integer('revision').notNull(), status: text('status').notNull(), attempts: integer('attempts').notNull(),
  startedAt: timestamp('started_at',{withTimezone:true}).notNull(), attemptStartedAt: timestamp('attempt_started_at',{withTimezone:true}).notNull(), leaseUntil: timestamp('lease_until',{withTimezone:true}).notNull(),
  diagnostic: text('diagnostic'),
  stepId:text('step_id').notNull(),attemptId:uuid('attempt_id').notNull(),
}, t=>[check('population_execution_status',sql`${t.status} IN ('ACQUIRING','RETRY','POPULATION_READY','TERMINAL')`),check('population_execution_counts',sql`${t.revision}>0 AND ${t.attempts}>0 AND ${t.attempts}<=4`)]);
export const populationEvidence = pgTable('population_evidence', {
  runId: uuid('run_id').primaryKey().references(()=>auditRun.runId), evidenceId:uuid('evidence_id').notNull().unique(),
  objectKey:text('object_key').notNull().unique(), envelopeKey:text('envelope_key').notNull().unique(),
  rawDigest:text('raw_digest'),envelopeDigest:text('envelope_digest'),size:integer('size'),state:text('state').notNull(),
  required:boolean('required').notNull(),
  /**
   * Generation 32: the same capture provenance `run_evidence` carries, for the artifact
   * that had none at all.
   *
   * The population artifact is the one FR-31 could say nothing about: an adapter
   * extraction's instant was recoverable from its Step Execution, and this row's was not,
   * so the Evidence tab said `Capture time was not recorded.` in words. It is measured
   * now, at the registration that verifies the raw bytes. Rows written before this
   * generation stay NULL and the surface keeps saying so — a fabricated capture time is a
   * fact nobody measured entering an immutable record, which is why generation 20 refused
   * to backfill a digest and generation 24 refused to default a generation time.
   */
  capturedAt: timestamp('captured_at',{withTimezone:true}),
  captureMethod: text('capture_method'),
  captureTimeSource: text('capture_time_source'),
},t=>[check('population_evidence_digest',sql`${t.rawDigest} IS NULL OR ${t.rawDigest} ~ '^[0-9a-f]{64}$'`),check('population_evidence_size',sql`${t.size} IS NULL OR ${t.size} >= 0`),check('population_evidence_state',sql`${t.state} IN ('RESERVED','REGISTERED','ABANDONED') AND (${t.state}<>'REGISTERED' OR (${t.rawDigest} IS NOT NULL AND ${t.envelopeDigest} IS NOT NULL AND ${t.size} IS NOT NULL))`),
  // Generation 21: an ABANDONED reservation is one nothing was ever written to. A
  // registered artifact is never demoted, so a raw digest beside `ABANDONED` would be a
  // row claiming both that the bytes were verified and that they never arrived.
  check('population_evidence_abandoned',sql`${t.state}<>'ABANDONED' OR ${t.rawDigest} IS NULL`),
  check('population_evidence_capture_method',sql`${t.captureMethod} IS NULL OR ${t.captureMethod} IN ('agent','adapter')`),
  check('population_evidence_capture_time',sql`(${t.capturedAt} IS NULL) = (${t.captureTimeSource} IS NULL) AND (${t.captureTimeSource} IS NULL OR ${t.captureTimeSource} IN ('registration','step-execution'))`)]);
export const populationSnapshot = pgTable('population_snapshot', {
  runId:uuid('run_id').primaryKey().references(()=>auditRun.runId), included:integer('included').notNull(),excluded:integer('excluded').notNull(),indeterminate:integer('indeterminate').notNull(),
  rowsDigest:text('rows_digest'), checks:jsonb('checks').$type<import('@intellifin/domain').PopulationCheck[]>().notNull(),
  /**
   * Generation 24 (Story 3.8): the snapshot's own declared generation time.
   *
   * §H's freshness row has to name WHICH way a snapshot is unfit — stale, future-dated or
   * unknown — and the stored pass/failed boolean beside it cannot. NULL is "unknown",
   * which §H makes `INCONCLUSIVE`; that is the fail-closed direction and it is what a row
   * written before this column existed reads as. Never defaulted to `now()`: a fabricated
   * generation time would make the Gate report a snapshot nobody generated.
   */
  generatedAt: timestamp('generated_at',{withTimezone:true}),
  /**
   * Generation 32 (owner decision, 2026-09-06): the two numbers behind the §H
   * record-count reconciliation, so a surface can show them instead of a pass/fail word.
   *
   * `declared_count` is what the INDEPENDENT declaration stated; `retrieved_count` is what
   * was parsed out of the frozen raw artifact. Each is attributable to an artifact of the
   * population reservation — the declaration to the acquisition envelope, the rows to the
   * raw object — and `population_evidence` holds both object keys for the same Run, so the
   * attribution is a reference to a stored row and not a second copy of it.
   *
   * `declared_count` is NULL when the declaration stated no count this build can store, and
   * on every row written before this generation: the declaration itself lives inside the
   * frozen envelope in object storage, which SQL cannot read and no surface may
   * (`no-evidence-store-in-web`). `retrieved_count` IS honestly backfilled, because
   * `includePopulation` maps every parsed row to exactly one row and the three dispositions
   * partition them — which the CHECK below then pins for every row, old and new.
   */
  declaredCount: integer('declared_count'),
  retrievedCount: integer('retrieved_count').notNull(),
}, t=>[
  check('population_snapshot_counts',sql`${t.included} >= 0 AND ${t.excluded} >= 0 AND ${t.indeterminate} >= 0 AND ${t.retrievedCount} >= 0 AND (${t.declaredCount} IS NULL OR ${t.declaredCount} >= 0)`),
  check('population_snapshot_retrieved',sql`${t.retrievedCount} = ${t.included} + ${t.excluded} + ${t.indeterminate}`),
]);
export const populationRow = pgTable('population_row', {
  runId:uuid('run_id').notNull().references(()=>populationSnapshot.runId),ordinal:integer('ordinal').notNull(),
  values:jsonb('values').$type<Record<string,import('@intellifin/domain').JsonValue>>().notNull(), disposition:text('disposition').$type<import('@intellifin/domain').PopulationRow['disposition']>().notNull(), reasons:jsonb('reasons').$type<string[]>().notNull(),
},t=>[primaryKey({columns:[t.runId,t.ordinal]}),check('population_row_disposition',sql`${t.disposition} IN ('included','excluded','indeterminate')`),check('population_row_ordinal',sql`${t.ordinal}>0`)]);

/**
 * Generation 19 — the adapter execution stage (Story 3.3).
 *
 * `run_execution` is the stage's claim, beside `population_execution`. `run_session_step`
 * holds one Reference Source acquisition per FROZEN `extract-adapter` step that names a
 * `versioned-file` Target System; `run_work_item` holds one adapter Work Item per `api`
 * one. `run_step_execution` keeps the frozen plan step id as provenance for every
 * attempt, `run_evidence` the reserve/register/abandon lifecycle of each artifact, and
 * `run_observation` the §B.1 wire schema.
 *
 * The CHECKs pin every enum, the digest format and the jsonb shape. `jsonb_array_length`
 * of an empty array is 0, not NULL, but the coalesce is kept anyway: a NULL CHECK PASSES,
 * and this repository has been bitten by that twice with `array_length`.
 */
export const runExecution = pgTable('run_execution', {
  runId: uuid('run_id').primaryKey().references(() => auditRun.runId),
  revision: integer('revision').notNull(), status: text('status').notNull(), attempts: integer('attempts').notNull(),
  runStartedAt: timestamp('run_started_at',{withTimezone:true}).notNull(),
  startedAt: timestamp('started_at',{withTimezone:true}).notNull(),
  attemptStartedAt: timestamp('attempt_started_at',{withTimezone:true}).notNull(),
  leaseUntil: timestamp('lease_until',{withTimezone:true}).notNull(),
  attemptId: uuid('attempt_id').notNull(), diagnostic: text('diagnostic'),
}, t=>[
  check('run_execution_status',sql`${t.status} IN ('EXECUTING','RETRY','EXTRACTION_COMPLETE','TERMINAL')`),
  check('run_execution_counts',sql`${t.revision}>0 AND ${t.attempts}>0 AND ${t.attempts}<=4`),
]);

/**
 * Generation 27 — the isolated Agent Workspace (Story 4.1).
 *
 * One row per Run, and its own table rather than a field on another stage's checkpoint,
 * because the workspace outlives every one of them: it is created at the frozen
 * `create-workspace` Session Step — which the compiler emits FIRST whenever a selected
 * Target is web or desktop — and released at the Run's terminal transition. The reaper
 * also needs its OWN read, and a background job must not borrow another stage's.
 *
 * `workspace_id` is the PROVIDER session identifier (`browser.id` under Solari). It is an
 * opaque identifier and not a capability — releasing a Solari session still needs the
 * deployment's API key — which is why it may be stored and recorded in the Timeline while
 * the API key, any session token and the wire-protocol endpoint may not. There is nowhere
 * in this row for any of those three.
 *
 * `mode` says which guarantee this Run's workspace actually had. The two are not equal:
 * `solari` is a separate managed browser with provider-side egress, `local` isolates
 * browser state per Run and does NOT isolate the worker process at all. A Run that ran
 * under the weaker one must say so rather than inherit the stronger sentence.
 */
export const runWorkspace = pgTable('run_workspace', {
  // ON DELETE CASCADE, unlike `run_gate_check`, `run_result`, `run_evidence_package` and
  // `run_evidence_integrity`, which every test teardown has to delete by name. Those four
  // record an OUTCOME and should not be silently removable; a workspace row is operational
  // state, and removing a whole Run is a different act that takes it along — exactly the
  // reason `run_exception` cascades from `run_observation`. Nothing requires a workspace
  // row the way generations 21 and 25 require a package and a Result, so there is no
  // invariant for the cascade to break. It also means the ten existing teardowns that
  // delete `audit_run` keep working: a foreign key nobody knew about does not fail its own
  // suite, it leaves rows behind and fails an unrelated one later on a count.
  runId: uuid('run_id').primaryKey().references(() => auditRun.runId, { onDelete: 'cascade' }),
  revision: integer('revision').notNull(), status: text('status').notNull(), attempts: integer('attempts').notNull(),
  stepId: text('step_id').notNull(),
  workspaceId: text('workspace_id'), mode: text('mode').notNull(),
  // The PROVIDER's hard deadline, at which a Solari session auto-releases. Nullable, and
  // null for a locally launched browser, which has no plan-tier deadline at all: it lives
  // exactly as long as the worker process does, and a far-future timestamp invented to
  // fill the column would be a fact nobody measured.
  expiresAt: timestamp('expires_at',{withTimezone:true}),
  startedAt: timestamp('started_at',{withTimezone:true}).notNull(),
  attemptStartedAt: timestamp('attempt_started_at',{withTimezone:true}).notNull(),
  leaseUntil: timestamp('lease_until',{withTimezone:true}).notNull(),
  releasedAt: timestamp('released_at',{withTimezone:true}), diagnostic: text('diagnostic'),
}, t=>[
  check('run_workspace_status',sql`${t.status} IN ('PROVISIONING','OPEN','RETRY','RELEASED','FAILED')`),
  check('run_workspace_mode',sql`${t.mode} IN ('solari','local')`),
  // Four is `sessionStepAttemptBudget` for compiler 1 — `retriesPerStep` 3 plus the first
  // attempt, times the one cycle §E gives a Run-level Session Step. Restated here as a
  // constant exactly as `population_execution_counts` restates it: a CHECK cannot read the
  // frozen plan, and the bound this row must never exceed is a property of the schema.
  check('run_workspace_counts',sql`${t.revision}>0 AND ${t.attempts}>0 AND ${t.attempts}<=4`),
  // An OPEN workspace nobody can name is a workspace nobody can release. The reaper acts
  // on `workspace_id`, so a row claiming to hold one without saying which is a leak with
  // a record of itself and no way to act on it.
  check('run_workspace_open_identity',sql`${t.status}<>'OPEN' OR ${t.workspaceId} IS NOT NULL`),
  // `boolean = boolean` is never NULL, unlike a comparison of the values themselves, so
  // this CHECK cannot pass by evaluating to NULL -- the trap `array_length` set in
  // generation 5 and `<> ALL` set in generation 7.
  check('run_workspace_released_at',sql`(${t.releasedAt} IS NULL) = (${t.status} <> 'RELEASED')`),
  check('run_workspace_identity_shape',sql`${t.workspaceId} IS NULL OR (length(${t.workspaceId}) BETWEEN 1 AND 200)`),
]);

export const runEvidence = pgTable('run_evidence', {
  evidenceId: uuid('evidence_id').primaryKey(),
  runId: uuid('run_id').notNull().references(() => auditRun.runId),
  kind: text('kind').notNull(), registrationId: text('registration_id').notNull(),
  objectKey: text('object_key').notNull().unique(), mediaType: text('media_type'),
  digest: text('digest'), size: integer('size'), state: text('state').notNull(),
  /** Generation 21: may this Run conclude without the artifact? Stamped at reservation. */
  required: boolean('required').notNull(),
  /**
   * Generation 32 (owner decision, 2026-09-06): FR-31's capture provenance, per artifact.
   *
   * `captured_at` is the instant, `capture_time_source` says how we come to have it —
   * `registration` for one measured inside the transaction that wrote `REGISTERED`,
   * `step-execution` for one recovered from the Step Execution that froze the bytes — and
   * `capture_method` is a STORED value rather than one derived from the kind on the way to
   * a screen. A derivation is a guess with good manners: it is true of every kind Epic 3
   * writes and stops being true the first time two processes can produce one kind.
   */
  capturedAt: timestamp('captured_at',{withTimezone:true}),
  captureMethod: text('capture_method'),
  captureTimeSource: text('capture_time_source'),
  /**
   * Generation 43 (Story 5.2): what the artifact is FOR, beside what it IS.
   *
   * `evidence` is what a Run concluded from; `replay` is what it is watched by. The same
   * kind sits on both sides — a screenshot an Observation is grounded in against one
   * captured after every Tool Action so the session can be replayed — so `kind` cannot
   * carry the distinction, and a naming convention would be one anybody could satisfy by
   * typing. A CHECK also refuses a REQUIRED replay row, so no raw writer can make a Run
   * INCOMPLETE for a frame nobody concluded anything from.
   */
  role: text('role').notNull(),
}, t=>[
  check('run_evidence_kind',sql`${t.kind} IN ('reference-source','adapter-extraction','structural-snapshot','screenshot')`),
  check('run_evidence_role',sql`${t.role} IN ('evidence','replay')`),
  check('run_evidence_replay_never_required',sql`${t.role} <> 'replay' OR ${t.required} = false`),
  check('run_evidence_digest',sql`${t.digest} IS NULL OR ${t.digest} ~ '^[0-9a-f]{64}$'`),
  check('run_evidence_size',sql`${t.size} IS NULL OR ${t.size} >= 0`),
  check('run_evidence_state',sql`${t.state} IN ('RESERVED','REGISTERED','ABANDONED') AND (${t.state}<>'REGISTERED' OR (${t.digest} IS NOT NULL AND ${t.size} IS NOT NULL))`),
  check('run_evidence_abandoned',sql`${t.state}<>'ABANDONED' OR ${t.digest} IS NULL`),
  check('run_evidence_capture_method',sql`${t.captureMethod} IS NULL OR ${t.captureMethod} IN ('agent','adapter')`),
  // A time and its provenance are written whole or not at all: a time with no source is a
  // number a reader takes for measured, and a source with no time names nothing.
  check('run_evidence_capture_time',sql`(${t.capturedAt} IS NULL) = (${t.captureTimeSource} IS NULL) AND (${t.captureTimeSource} IS NULL OR ${t.captureTimeSource} IN ('registration','step-execution'))`),
]);

/**
 * Generation 38 — an actor-bound, short-lived capability request for a stored Structural
 * Snapshot (Story 4.4).
 *
 * This is request and capability metadata only. The worker/object-store boundary owns the
 * object key lookup and signed GET; this table never stores bytes, credentials, or a durable
 * object URL. The binding trigger in 0038 also checks the Run and Structural Snapshot kind,
 * because `run_evidence.evidence_id` predates this table and is globally unique on its own.
 */
export const evidenceReadGrant = pgTable('evidence_read_grant', {
  grantId: uuid('grant_id').primaryKey(),
  runId: uuid('run_id').notNull().references(() => auditRun.runId, { onDelete: 'cascade' }),
  evidenceId: uuid('evidence_id').notNull().references(() => runEvidence.evidenceId, { onDelete: 'cascade' }),
  locator: text('locator').notNull(),
  actorId: text('actor_id').notNull(),
  sessionId: text('session_id').notNull(),
  correlationId: text('correlation_id').notNull(),
  requestedAt: timestamp('requested_at', { withTimezone: true, mode: 'date' }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  status: text('status').notNull(),
  denialCode: text('denial_code'),
  signedUrl: text('signed_url'),
  signedUrlExpiresAt: timestamp('signed_url_expires_at', { withTimezone: true, mode: 'date' }),
  capabilityMediaType: text('capability_media_type'),
  capabilityDigest: text('capability_digest'),
  capabilitySize: integer('capability_size'),
}, table => [
  check('evidence_read_grant_locator', sql`length(${table.locator}) BETWEEN 1 AND 1024 AND btrim(${table.locator}) = ${table.locator}`),
  check('evidence_read_grant_actor', sql`length(btrim(${table.actorId})) BETWEEN 1 AND 255`),
  check('evidence_read_grant_session', sql`length(btrim(${table.sessionId})) BETWEEN 1 AND 255`),
  check('evidence_read_grant_correlation', sql`length(btrim(${table.correlationId})) BETWEEN 1 AND 255`),
  check('evidence_read_grant_window', sql`${table.expiresAt} > ${table.requestedAt} AND ${table.expiresAt} <= ${table.requestedAt} + interval '5 minutes'`),
  check('evidence_read_grant_status', sql`${table.status} IN ('pending','issued','denied','expired')`),
  check('evidence_read_grant_denial', sql`${table.denialCode} IS NULL OR ${table.denialCode} IN ('expired','unauthorized','scope-mismatch','evidence-not-registered','unsupported-media-type','invalid-evidence-metadata','storage-unavailable')`),
  check('evidence_read_grant_url', sql`${table.signedUrl} IS NULL OR (length(${table.signedUrl}) BETWEEN 1 AND 4096 AND ${table.signedUrl} ~* '^https?://[^[:space:]#@]+$')`),
  check('evidence_read_grant_digest', sql`${table.capabilityDigest} IS NULL OR ${table.capabilityDigest} ~ '^[0-9a-f]{64}$'`),
  check('evidence_read_grant_size', sql`${table.capabilitySize} IS NULL OR ${table.capabilitySize} BETWEEN 0 AND 4194304`),
  check('evidence_read_grant_media_type', sql`${table.capabilityMediaType} IS NULL OR length(btrim(${table.capabilityMediaType})) BETWEEN 1 AND 255`),
  check('evidence_read_grant_completion', sql`coalesce((
    (${table.status} = 'pending'
      AND ${table.denialCode} IS NULL AND ${table.signedUrl} IS NULL AND ${table.signedUrlExpiresAt} IS NULL
      AND ${table.capabilityMediaType} IS NULL AND ${table.capabilityDigest} IS NULL AND ${table.capabilitySize} IS NULL)
    OR (${table.status} = 'issued'
      AND ${table.denialCode} IS NULL AND ${table.signedUrl} IS NOT NULL
      AND ${table.signedUrlExpiresAt} > ${table.requestedAt} AND ${table.signedUrlExpiresAt} <= ${table.expiresAt}
      AND ${table.capabilityMediaType} IS NOT NULL AND ${table.capabilityDigest} IS NOT NULL AND ${table.capabilitySize} IS NOT NULL)
    OR (${table.status} = 'denied'
      AND ${table.denialCode} IS NOT NULL AND ${table.denialCode} <> 'expired'
      AND ${table.signedUrl} IS NULL AND ${table.signedUrlExpiresAt} IS NULL
      AND ${table.capabilityMediaType} IS NULL AND ${table.capabilityDigest} IS NULL AND ${table.capabilitySize} IS NULL)
    OR (${table.status} = 'expired'
      AND ${table.denialCode} = 'expired'
      AND ${table.signedUrl} IS NULL AND ${table.signedUrlExpiresAt} IS NULL
      AND ${table.capabilityMediaType} IS NULL AND ${table.capabilityDigest} IS NULL AND ${table.capabilitySize} IS NULL)
  ), false)`),
  check('evidence_read_grant_issued_capability_window', sql`${table.status} <> 'issued' OR ${table.signedUrlExpiresAt} <= ${table.requestedAt} + interval '5 minutes'`),
  index('evidence_read_grant_pending_expiry').on(table.status, table.expiresAt).where(sql`${table.status} = 'pending'`),
  index('evidence_read_grant_actor').on(table.actorId, table.requestedAt),
]);

/**
 * Generation 21 — the sealed Evidence package (Story 3.5).
 *
 * One row per Run, written by `SealPackage` at the terminal transition and never again.
 * `missing_required` and `abandoned` are on the row because the Result and the export read
 * them there: an abandonment recorded only in the audit chain is not "listed on the
 * Result". Both hold `{evidenceId, kind, objectKey}` — an identity and an address, never
 * bytes, a media type, a location or a credential reference.
 *
 * Three things the COMMAND cannot route around, because the database says them (see
 * `0021_*.sql`): a Run may not reach a terminal state without one of these rows; a SEALED
 * row may not exist while a required artifact of that Run is unregistered; and once a row
 * exists its Run's Evidence rows are frozen and the row itself cannot be updated.
 */
export const runEvidencePackage = pgTable('run_evidence_package', {
  runId: uuid('run_id').primaryKey().references(() => auditRun.runId),
  state: text('state').notNull(), runState: text('run_state').notNull(),
  sealedAt: timestamp('sealed_at',{withTimezone:true}).notNull(),
  requiredTotal: integer('required_total').notNull(), registered: integer('registered').notNull(),
  missingRequired: jsonb('missing_required').notNull(), abandoned: jsonb('abandoned').notNull(),
}, t=>[
  check('run_evidence_package_state',sql`${t.state} IN ('SEALED','INCOMPLETE')`),
  check('run_evidence_package_run_state',sql`${t.runState} IN ('COMPLETED','INCONCLUSIVE','RUN_FAILED','CANCELED')`),
  check('run_evidence_package_counts',sql`${t.requiredTotal}>=0 AND ${t.registered}>=0`),
  check('run_evidence_package_shape',sql`coalesce(jsonb_typeof(${t.missingRequired})='array',false) AND coalesce(jsonb_typeof(${t.abandoned})='array',false)`),
  // The seal state and the list it is derived from say the same thing, or the row is
  // refused: a SEALED package naming a missing artifact is the one lie this table exists
  // to prevent, and a command that computed it wrongly must not be able to store it.
  check('run_evidence_package_complete',sql`(${t.state}='SEALED') = (jsonb_typeof(${t.missingRequired})='array' AND jsonb_array_length(${t.missingRequired})=0)`),
]);

/**
 * Generation 21 — an Audit Trail integrity finding discovered AFTER the Run.
 *
 * A mismatch found while the Run is running ends it `RUN_FAILED`. The same mismatch found
 * afterwards changes no state at all: it adds a row here and an event to the chain, and is
 * corrected only by a new Run. The unique index makes re-verification idempotent.
 *
 * `evidence_id` carries no foreign key on purpose: it names a row in `run_evidence` OR in
 * `population_evidence`, and two nullable keys would let a finding name neither.
 */
export const runEvidenceIntegrity = pgTable('run_evidence_integrity', {
  findingId: uuid('finding_id').primaryKey(),
  runId: uuid('run_id').notNull().references(() => auditRun.runId),
  evidenceId: uuid('evidence_id').notNull(), objectKey: text('object_key').notNull(),
  finding: text('finding').notNull(),
  expectedDigest: text('expected_digest').notNull(), observedDigest: text('observed_digest'),
  expectedSize: integer('expected_size'), observedSize: integer('observed_size'),
  detectedAt: timestamp('detected_at',{withTimezone:true}).notNull(),
}, t=>[
  uniqueIndex('run_evidence_integrity_artifact').on(t.evidenceId, t.objectKey, t.finding),
  check('run_evidence_integrity_finding',sql`${t.finding} IN ('object-missing','size-mismatch','digest-mismatch')`),
  check('run_evidence_integrity_digest',sql`${t.expectedDigest} ~ '^[0-9a-f]{64}$' AND (${t.observedDigest} IS NULL OR ${t.observedDigest} ~ '^[0-9a-f]{64}$')`),
  check('run_evidence_integrity_size',sql`(${t.expectedSize} IS NULL OR ${t.expectedSize}>=0) AND (${t.observedSize} IS NULL OR ${t.observedSize}>=0)`),
  check('run_evidence_integrity_observed',sql`(${t.finding}='object-missing') = (${t.observedDigest} IS NULL AND ${t.observedSize} IS NULL)`),
  // A finding has to be a real disagreement. Without this a caller could write a
  // digest-mismatch whose two digests are equal — a fabricated integrity event in a chain
  // nothing can take it out of.
  check('run_evidence_integrity_disagrees',sql`(${t.finding}<>'digest-mismatch' OR ${t.observedDigest} IS DISTINCT FROM ${t.expectedDigest}) AND (${t.finding}<>'size-mismatch' OR (${t.observedSize} IS NOT NULL AND ${t.expectedSize} IS NOT NULL AND ${t.observedSize} <> ${t.expectedSize}))`),
]);

export const runSessionStep = pgTable('run_session_step', {
  runId: uuid('run_id').notNull().references(() => auditRun.runId),
  stepId: text('step_id').notNull(), ordinal: integer('ordinal').notNull(),
  registrationId: text('registration_id').notNull(), displayName: text('display_name').notNull(),
  // Generation 28. The FROZEN action of the step, so the ACQUIRED rule below can say what
  // it actually means: an ACQUIRED ACQUISITION has Evidence. A sign-in Session Step
  // establishes a session and freezes nothing, and a constraint that could not tell the
  // two apart would have refused exactly the row Story 4.2 exists to write.
  action: text('action').notNull(),
  state: text('state').notNull(), attempts: integer('attempts').notNull(), diagnostic: text('diagnostic'),
  evidenceId: uuid('evidence_id').references(() => runEvidence.evidenceId),
}, t=>[
  primaryKey({columns:[t.runId,t.stepId]}),
  check('run_session_step_state',sql`${t.state} IN ('PENDING','IN_PROGRESS','ACQUIRED','FAILED')`),
  check('run_session_step_action',sql`${t.action} IN ('sign-in','extract-adapter')`),
  check('run_session_step_counts',sql`${t.ordinal}>0 AND ${t.attempts}>=0`),
  check('run_session_step_acquired',sql`${t.state}<>'ACQUIRED' OR ${t.action}<>'extract-adapter' OR ${t.evidenceId} IS NOT NULL`),
]);


export const runWorkItem = pgTable('run_work_item', {
  workItemId: uuid('work_item_id').primaryKey(),
  runId: uuid('run_id').notNull().references(() => auditRun.runId),
  stepId: text('step_id').notNull(), ordinal: integer('ordinal').notNull(),
  subjectKey: text('subject_key'),
  registrationId: text('registration_id').notNull(), displayName: text('display_name').notNull(),
  state: text('state').notNull(), attempts: integer('attempts').notNull(), cycles: integer('cycles').notNull(),
  diagnostic: text('diagnostic'), evidenceId: uuid('evidence_id').references(() => runEvidence.evidenceId),
  observations: integer('observations').notNull(),
}, t=>[
  uniqueIndex('run_work_item_run_step').on(t.runId,t.stepId,sql`coalesce(${t.subjectKey},'')`),
  check('run_work_item_state',sql`${t.state} IN ('PENDING','IN_PROGRESS','AWAITING','OBSERVED','UNINSPECTED','AMBIGUOUS','FAILED')`),
  // Two bounded retry cycles: the frozen NFR-8 cycle and the owner's automatic second.
  check('run_work_item_counts',sql`${t.ordinal}>0 AND ${t.attempts}>=0 AND ${t.cycles}>=0 AND ${t.cycles}<=2 AND ${t.observations}>=0`),
]);

export const runStepExecution = pgTable('run_step_execution', {
  stepExecutionId: uuid('step_execution_id').primaryKey(),
  runId: uuid('run_id').notNull().references(() => auditRun.runId),
  planStepId: text('plan_step_id').notNull(), workItemId: uuid('work_item_id').references(() => runWorkItem.workItemId),
  action: text('action').notNull(), state: text('state').notNull(), attempt: integer('attempt').notNull(),
  startedAt: timestamp('started_at',{withTimezone:true}).notNull(),
  completedAt: timestamp('completed_at',{withTimezone:true}), diagnostic: text('diagnostic'),
}, t=>[
  index('run_step_execution_run_idx').on(t.runId,t.startedAt),
  check('run_step_execution_state',sql`${t.state} IN ('RUNNING','SUCCEEDED','FAILED')`),
  check('run_step_execution_action',sql`${t.action} IN ('create-workspace','acquire-population','sign-in','extract-adapter','inspect-record','capture-observation','evaluate-conditions')`),
  check('run_step_execution_attempt',sql`${t.attempt}>0`),
]);

/**
 * The agent execution phase's durable claim, one row per Run (generation 28).
 *
 * Its own row rather than a field on `run_execution`: the agent phase and the adapter
 * phase are different phases with different vocabularies, and a stage that borrowed
 * another's checkpoint would have to answer for a status it does not produce. It cascades
 * with its Run for the reason `run_workspace` does — it is operational state, not an
 * outcome — so the existing teardowns keep working.
 */
export const runAgentExecution = pgTable('run_agent_execution', {
  runId: uuid('run_id').primaryKey().references(() => auditRun.runId, { onDelete: 'cascade' }),
  revision: integer('revision').notNull(), status: text('status').notNull(), attempts: integer('attempts').notNull(),
  runStartedAt: timestamp('run_started_at',{withTimezone:true}).notNull(),
  startedAt: timestamp('started_at',{withTimezone:true}).notNull(),
  attemptStartedAt: timestamp('attempt_started_at',{withTimezone:true}).notNull(),
  leaseUntil: timestamp('lease_until',{withTimezone:true}).notNull(),
  attemptId: uuid('attempt_id').notNull(), diagnostic: text('diagnostic'),
}, t=>[
  check('run_agent_execution_status',sql`${t.status} IN ('EXECUTING','SIGNED_IN','RETRY','TERMINAL')`),
  // Four is `sessionStepAttemptBudget` for compiler 1 — `retriesPerStep` 3 plus the first
  // attempt, times the one cycle §E gives a Run-level Session Step. Restated as a constant
  // exactly as `run_workspace_counts` restates it: a CHECK cannot read the frozen plan.
  check('run_agent_execution_counts',sql`${t.revision}>0 AND ${t.attempts}>0 AND ${t.attempts}<=4`),
]);

/**
 * The sanitized action log: one row per Tool Action and per Adapter Action (generation 28).
 *
 * ONE table and ONE shape for both surfaces, so a reader compares them rather than
 * translating — AD-6 says it in as many words ("every lookup or extraction is an Adapter
 * Action on the Timeline with the same sanitized-action schema"). `surface` is the only
 * field that differs between the two producers.
 *
 * There is nowhere here for a credential, a request body, a response body or a header.
 * `destination` is scheme, authority and path — never a query string, which is where a
 * token or a signed URL lives — and the parameters are the PLATFORM's own, which is what
 * lets addendum §B.1 derive an absence proof's query string from this log rather than from
 * anything the agent reported about itself.
 *
 * Ordering is `(started_at, tool_action_id)`: the id is a UUIDv7, so it is a deterministic
 * tiebreak rather than an arbitrary one, exactly as the Runs list keyset uses `run_id`.
 */
export const runToolAction = pgTable('run_tool_action', {
  toolActionId: uuid('tool_action_id').primaryKey(),
  runId: uuid('run_id').notNull().references(() => auditRun.runId),
  stepExecutionId: uuid('step_execution_id').notNull().references(() => runStepExecution.stepExecutionId),
  workItemId: uuid('work_item_id').references(() => runWorkItem.workItemId),
  surface: text('surface').notNull(), targetSystem: text('target_system').notNull(),
  action: text('action').notNull(), method: text('method').notNull(), destination: text('destination').notNull(),
  parameters: jsonb('parameters').$type<import('@intellifin/domain').ToolActionParameter[]>().notNull(),
  outcome: text('outcome').notNull(), denial: text('denial'), offending: text('offending'),
  status: integer('status'), redirected: boolean('redirected').notNull(), downloads: integer('downloads').notNull(),
  startedAt: timestamp('started_at',{withTimezone:true}).notNull(),
  completedAt: timestamp('completed_at',{withTimezone:true}), diagnostic: text('diagnostic'),
  // Generation 29 (Story 4.3). Whether the platform captured anything from this action,
  // and why not. Recorded on EVERY row, so a reader never has to infer from an artifact
  // that is not there whether capture was suppressed or simply produced nothing — a gap is
  // what a reader takes for "nothing happened here".
  capture: text('capture').notNull(), captureSuppression: text('capture_suppression'),
}, t=>[
  index('run_tool_action_run_idx').on(t.runId,t.startedAt),
  check('run_tool_action_surface',sql`${t.surface} IN ('agent','adapter')`),
  check('run_tool_action_outcome',sql`${t.outcome} IN ('performed','denied','failed')`),
  // Generation 31. The vocabulary is `TOOL_ACTION_METHODS` in the domain, and `POST` is in
  // it for exactly one operation: submitting a Target System's own sign-in form, which
  // creates a SESSION and no audited business data. It read `IN ('GET','HEAD')` while the
  // system-level guard used the method as a proxy for mutation; FR-3 constrains what the
  // platform may INVOKE — enforced against the registration's frozen `permitted_actions` —
  // and neither this CHECK nor a fixture's guard is what makes an execution read-only
  // (`epic-4-loancore-authentication-decision.md`). It stays a CLOSED set: a method
  // outside it is a request this build did not make.
  check('run_tool_action_method',sql`${t.method} IN ('GET','HEAD','POST')`),
  check('run_tool_action_denial',sql`${t.denial} IS NULL OR ${t.denial} IN ('action-not-permitted','destination-refused','origin-not-allowed','parameter-out-of-scope')`),
  // A denial ALWAYS names its rule and a performed action never carries one. The two halves
  // are one CHECK because either alone permits a row that reads as the other.
  check('run_tool_action_denied',sql`(${t.outcome}='denied') = (${t.denial} IS NOT NULL)`),
  check('run_tool_action_counts',sql`${t.downloads}>=0 AND (${t.status} IS NULL OR (${t.status}>=100 AND ${t.status}<=599))`),
  check('run_tool_action_capture',sql`${t.capture} IN ('PERMITTED','SUPPRESSED')`),
  check('run_tool_action_capture_reason',sql`${t.captureSuppression} IS NULL OR ${t.captureSuppression} IN ('credential-entry')`),
  // A suppressed capture ALWAYS names its reason and a permitted one never carries one.
  // One CHECK, like `run_tool_action_denied`, because either half alone permits a row that
  // reads as the other: a SUPPRESSED row with no reason is a gap wearing a label, and a
  // PERMITTED row with a reason says capture was both allowed and refused.
  check('run_tool_action_capture_suppressed',sql`(${t.capture}='SUPPRESSED') = (${t.captureSuppression} IS NOT NULL)`),
]);

export const runObservation = pgTable('run_observation', {
  observationId: uuid('observation_id').primaryKey(),
  runId: uuid('run_id').notNull().references(() => auditRun.runId),
  workItemId: uuid('work_item_id').notNull().references(() => runWorkItem.workItemId),
  schemaVersion: integer('schema_version').notNull(),
  populationRecordKey: text('population_record_key').notNull(), targetSystem: text('target_system').notNull(),
  found: text('found').notNull(), observedAt: timestamp('observed_at',{withTimezone:true}).notNull(),
  stepExecutionId: uuid('step_execution_id').notNull(),
  captureMethod: text('capture_method').notNull(), matchOrigin: text('match_origin').notNull(),
  identity: jsonb('identity').$type<import('@intellifin/domain').ObservationAttribute | null>(),
  attributes: jsonb('attributes').$type<import('@intellifin/domain').ObservationAttribute[]>().notNull(),
  evidenceIds: jsonb('evidence_ids').$type<string[]>().notNull(),
  // Generation 20. The digest is over the RFC 8785 canonical JSON of the WIRE RECORD and
  // nothing else, so a row edited after registration stops agreeing with the digest the
  // registration event recorded. `observed_at_source` is §B's retained original offset:
  // the instant is normalized to UTC in `observed_at` and never silently shifted.
  digest: text('digest').notNull(),
  coverage: text('coverage').notNull(),
  observedAtSource: text('observed_at_source').notNull(),
  // Generation 22 (Story 3.6). The rollup of the per-attribute corroboration verdicts
  // this row's own `identity` and `attributes` carry, derived by
  // `observationCorroborationState` and pinned to them by a CHECK, so no command,
  // migration or psql session can store a rollup that disagrees with its own data.
  corroboration: text('corroboration').notNull(),
}, t=>[
  // A redelivered job cannot create a second Observation for the same record.
  uniqueIndex('run_observation_item_record').on(t.workItemId,t.populationRecordKey),
  // The composite key `run_observation_evaluation` points at, so "an uninspected record is
  // never Compliant" and "a record its own snapshot contradicts is never Compliant" are a
  // foreign key plus a CHECK rather than two rules in one command. `observation_id` is the
  // primary key, so widening this index adds a column to the FK and no ambiguity.
  uniqueIndex('run_observation_coverage_key').on(t.observationId,t.coverage,t.corroboration),
  check('run_observation_schema',sql`${t.schemaVersion} = 1`),
  check('run_observation_found',sql`${t.found} IN ('true','false','ambiguous')`),
  check('run_observation_capture',sql`${t.captureMethod} IN ('agent','adapter')`),
  check('run_observation_origin',sql`${t.matchOrigin} IN ('platform','human-matched')`),
  // §B.1: a grounded identity attribute is required when found = true, and meaningless
  // otherwise — an ambiguous or absent Observation carrying one asserts the very match
  // it exists to say did not resolve.
  check('run_observation_identity',sql`(${t.found} = 'true') = (${t.identity} IS NOT NULL) AND (${t.identity} IS NULL OR jsonb_typeof(${t.identity}) = 'object')`),
  check('run_observation_attributes',sql`coalesce(jsonb_typeof(${t.attributes}) = 'array' AND jsonb_array_length(${t.attributes}) <= 64, false)`),
  check('run_observation_evidence',sql`coalesce(jsonb_typeof(${t.evidenceIds}) = 'array' AND jsonb_array_length(${t.evidenceIds}) BETWEEN 1 AND 16, false)`),
  check('run_observation_digest',sql`${t.digest} ~ '^[0-9a-f]{64}$'`),
  // §H per-record coverage counts `found ∈ {true, false}` only, so an ambiguous match is
  // its own coverage state and never `COVERED`; a resolved match always is; an absence is
  // covered only when it proved it looked, and `UNINSPECTED` otherwise.
  check('run_observation_coverage',sql`${t.coverage} IN ('COVERED','UNINSPECTED','AMBIGUOUS') AND (${t.found} = 'ambiguous') = (${t.coverage} = 'AMBIGUOUS') AND (${t.found} <> 'true' OR ${t.coverage} = 'COVERED')`),
  // Generation 22. The per-attribute verdict vocabulary, pinned INSIDE the jsonb: the
  // domain validator says the same thing, and a validator is a rule a caller must be made
  // to run. A verdict that is not `matched`, `contradictory`, `model-read` or JSON null —
  // on the identity or on any attribute — cannot be stored at all.
  check('run_observation_attribute_corroboration',sql`NOT jsonb_path_exists(coalesce(${t.identity},'null'::jsonb), '$.corroboration ? (@.type() != "null" && (@.type() != "string" || (@ != "matched" && @ != "contradictory" && @ != "model-read")))') AND NOT jsonb_path_exists(${t.attributes}, '$[*].corroboration ? (@.type() != "null" && (@.type() != "string" || (@ != "matched" && @ != "contradictory" && @ != "model-read")))')`),
  check('run_observation_corroboration',sql`${t.corroboration} IN ('MATCHED','CONTRADICTORY','UNJUDGED')`),
  // The rollup IS the derivation, not a summary somebody remembered to update:
  // CONTRADICTORY when any attribute was re-read and disagreed, MATCHED when at least one
  // was judged and none disagreed, UNJUDGED when none was.
  check('run_observation_corroboration_state',sql`${t.corroboration} = CASE WHEN jsonb_path_exists(coalesce(${t.identity},'null'::jsonb), '$.corroboration ? (@ == "contradictory")') OR jsonb_path_exists(${t.attributes}, '$[*].corroboration ? (@ == "contradictory")') THEN 'CONTRADICTORY' WHEN jsonb_path_exists(coalesce(${t.identity},'null'::jsonb), '$.corroboration ? (@.type() == "string")') OR jsonb_path_exists(${t.attributes}, '$[*].corroboration ? (@.type() == "string")') THEN 'MATCHED' ELSE 'UNJUDGED' END`),
]);

/**
 * `run_observation_check` — one §H per-Observation check outcome, and its diagnostic.
 *
 * A failing check is a FINDING, not a refusal: it is recorded here and the Run-level Gate
 * (Story 3.8) turns it into `INCONCLUSIVE`. A PASS never carries a diagnostic and a FAIL
 * always does — a passing check with a reason attached reads as a finding to everything
 * downstream, and a failing one with none is a finding nobody can act on.
 */
export const runObservationCheck = pgTable('run_observation_check', {
  observationId: uuid('observation_id').notNull().references(() => runObservation.observationId),
  runId: uuid('run_id').notNull().references(() => auditRun.runId),
  checkName: text('check_name').notNull(), outcome: text('outcome').notNull(), diagnostic: text('diagnostic'),
}, t=>[
  primaryKey({columns:[t.observationId,t.checkName]}),
  index('run_observation_check_run_idx').on(t.runId,t.checkName),
  check('run_observation_check_name',sql`${t.checkName} IN ('identity-corroboration','search-completeness','ambiguous-match','required-evidence','freshness','observation-corroboration')`),
  check('run_observation_check_outcome',sql`${t.outcome} IN ('PASS','FAIL') AND (${t.outcome} = 'PASS') = (${t.diagnostic} IS NULL)`),
]);

/**
 * `run_observation_evaluation` — §B.1's per-condition evaluation, one row per condition.
 *
 * `coverage` is denormalized from `run_observation` and held there by a composite foreign
 * key, so `value <> 'COMPLIANT' OR coverage = 'COVERED'` is a guarantee no command,
 * migration or psql session can route around: an uninspected or ambiguous record cannot
 * be recorded Compliant, by anybody. `UNEVALUATED` is a VALUE, never an origin.
 * Generation 36 keeps these original rows insert-only. Human review copies their proposal
 * fields into its immutable ledger; no later writer may rewrite what a reviewer saw.
 */
export const runObservationEvaluation = pgTable('run_observation_evaluation', {
  observationId: uuid('observation_id').notNull(),
  coverage: text('coverage').notNull(),
  /** Generation 22: denormalized from `run_observation` and held there by the same FK. */
  corroboration: text('corroboration').notNull(),
  runId: uuid('run_id').notNull().references(() => auditRun.runId),
  conditionId: text('condition_id').notNull(), origin: text('origin').notNull(), value: text('value').notNull(),
  confirmation: text('confirmation'), confidence: numeric('confidence',{precision:7,scale:6}),
  rationale: text('rationale'), diagnostic: text('diagnostic'),
  evidenceIds: jsonb('evidence_ids').$type<string[]>().notNull(),
  /** The original machine proposal, retained when the effective value is UNEVALUATED. */
  agentProposedValue: text('agent_proposed_value'),
  agentProposedConfidence: numeric('agent_proposed_confidence',{precision:7,scale:6}),
  agentProposedRationale: text('agent_proposed_rationale'),
}, t=>[
  primaryKey({columns:[t.observationId,t.conditionId]}),
  index('run_observation_evaluation_run_idx').on(t.runId,t.value),
  foreignKey({columns:[t.observationId,t.coverage,t.corroboration],foreignColumns:[runObservation.observationId,runObservation.coverage,runObservation.corroboration],name:'run_observation_evaluation_coverage_fk'}),
  check('run_observation_evaluation_origin',sql`${t.origin} IN ('RULE','AGENT_JUDGED','HUMAN')`),
  check('run_observation_evaluation_value',sql`${t.value} IN ('COMPLIANT','EXCEPTION','UNEVALUATED')`),
  // Confirmation and confidence belong to an Agent-Judged evaluation and to no other.
  check('run_observation_evaluation_confirmation',sql`${t.confirmation} IS NULL OR (${t.origin} = 'AGENT_JUDGED' AND ${t.confirmation} IN ('pending','confirmed','rejected'))`),
  check('run_observation_evaluation_confidence',sql`${t.confidence} IS NULL OR (${t.origin} = 'AGENT_JUDGED' AND ${t.confidence} >= 0 AND ${t.confidence} <= 1)`),
  // §H: uninspected records are never Compliant, and neither is an ambiguous match.
  check('run_observation_evaluation_coverage',sql`${t.value} <> 'COMPLIANT' OR ${t.coverage} = 'COVERED'`),
  // Story 3.6, the same shape one column along: an Observation whose stored Structural
  // Snapshot contradicts it can never be Compliant. Claiming MATCHED in this row does not
  // help — the triple has to exist in `run_observation`.
  check('run_observation_evaluation_corroboration',sql`${t.corroboration} IN ('MATCHED','CONTRADICTORY','UNJUDGED') AND (${t.value} <> 'COMPLIANT' OR ${t.corroboration} <> 'CONTRADICTORY')`),
  check('run_observation_evaluation_evidence',sql`coalesce(jsonb_typeof(${t.evidenceIds}) = 'array' AND jsonb_array_length(${t.evidenceIds}) <= 16, false)`),
  // A proposal is an all-or-nothing machine record. It may accompany only an
  // AGENT_JUDGED evaluation; RULE and HUMAN rows must carry three NULLs. Keeping the
  // proposal's own vocabulary and numeric/text bounds here prevents a raw writer from
  // smuggling an unreviewable value beside an otherwise valid evaluation.
  check('run_observation_evaluation_agent_proposal',sql`coalesce((
    (${t.agentProposedValue} IS NULL AND ${t.agentProposedConfidence} IS NULL AND ${t.agentProposedRationale} IS NULL)
    OR (
      ${t.origin} = 'AGENT_JUDGED'
      AND ${t.agentProposedValue} IN ('COMPLIANT','EXCEPTION','UNEVALUATED')
      AND ${t.agentProposedConfidence} >= 0 AND ${t.agentProposedConfidence} <= 1
      AND length(${t.agentProposedRationale}) BETWEEN 1 AND 8192
    )
  ), false)`),
]);

/**
 * `run_exception` — the permanent record of a control failure (Story 3.7).
 *
 * One row per Observation whose evaluation raised at least one `EXCEPTION`, written in the
 * SAME transaction as that evaluation. `exception_id` is DERIVED from the Run and the
 * Observation rather than minted, so a redelivered batch reaches the row it already wrote
 * instead of raising a second finding about one record; the unique index on
 * `observation_id` says the same thing where a command cannot route around it.
 *
 * `fingerprint` is HMAC-SHA-256 over the RFC 8785 canonical JSON of the finding's identity
 * — Procedure, Template, Target System, population record and the conditions that failed —
 * and `fingerprint_key_id` is retained beside it, so a rotated key still says which key
 * signed which row. The Run is deliberately outside the fingerprint: the same control
 * failure recurring next month fingerprints the same and is recognisable as the same
 * finding.
 *
 * Generation 23 adds two triggers, because neither rule is expressible as a CHECK: an
 * Exception can never be UPDATEd, and it can never be deleted while the Observation it was
 * raised on still exists. Removing a whole Observation is a different act from rewriting an
 * outcome, and it takes the record and its digest with it.
 */
export const runException = pgTable('run_exception', {
  exceptionId: uuid('exception_id').primaryKey(),
  runId: uuid('run_id').notNull().references(() => auditRun.runId),
  observationId: uuid('observation_id').notNull().references(() => runObservation.observationId, {onDelete:'cascade'}),
  workItemId: uuid('work_item_id').notNull().references(() => runWorkItem.workItemId),
  targetSystem: text('target_system').notNull(),
  populationRecordKey: text('population_record_key').notNull(),
  conditionIds: jsonb('condition_ids').$type<string[]>().notNull(),
  /** Every violating pair, and every other reason the compiled rules gave, verbatim. */
  diagnostics: jsonb('diagnostics').$type<string[]>().notNull(),
  fingerprint: text('fingerprint').notNull(),
  fingerprintKeyId: text('fingerprint_key_id').notNull(),
  raisedAt: timestamp('raised_at',{withTimezone:true}).notNull(),
}, t=>[
  // The first Exception recorded for a record stands; a redelivery adds nothing.
  uniqueIndex('run_exception_observation').on(t.observationId),
  index('run_exception_run_idx').on(t.runId,t.raisedAt),
  index('run_exception_fingerprint_idx').on(t.fingerprint),
  // `cardinality`, never `array_length`/`jsonb_array_length` alone: a CHECK that evaluates
  // to NULL PASSES, so the coalesce is what makes an unusable value fail rather than slip.
  check('run_exception_conditions',sql`coalesce(jsonb_typeof(${t.conditionIds}) = 'array' AND jsonb_array_length(${t.conditionIds}) BETWEEN 1 AND 64, false)`),
  check('run_exception_diagnostics',sql`coalesce(jsonb_typeof(${t.diagnostics}) = 'array' AND jsonb_array_length(${t.diagnostics}) <= 64, false)`),
  check('run_exception_fingerprint',sql`${t.fingerprint} ~ '^[0-9a-f]{64}$'`),
  check('run_exception_key_id',sql`length(${t.fingerprintKeyId}) BETWEEN 1 AND 1024`),
]);


/**
 * Generation 24 — the Run-level Evidence Quality Gate (Story 3.8).
 *
 * One row per addendum §H check, written once when the last Work Item completes, in the
 * SAME transaction as the terminal Run state and the Evidence package seal. Twenty rows,
 * always: a row that found nothing is a `PASS` that was actually evaluated, and an absent
 * row would be indistinguishable from a row nobody wrote.
 *
 * `diagnostics`, `target_systems`, `work_items` and `records` are what the Result names.
 * They hold IDENTITIES and closed constants — there is no column here for a captured
 * value, a message or a byte of Evidence — and the identity lists are a bounded sample
 * beside an exact `total`, so a Run over a hundred thousand records can still commit its
 * own conclusion.
 *
 * Two things the COMMAND cannot route around, because the database says them:
 * a `PASS` may not carry a diagnostic and a `FAIL` must (the `run_observation_check` rule
 * one layer up), and a Gate row can never be UPDATEd — "a Gate failure is not repaired by
 * re-running a check" is a trigger rather than a habit.
 */
export const runGateCheck = pgTable('run_gate_check', {
  runId: uuid('run_id').notNull().references(() => auditRun.runId),
  checkName: text('check_name').notNull(),
  outcome: text('outcome').notNull(),
  diagnostics: jsonb('diagnostics').$type<import('@intellifin/domain').GateDiagnostic[]>().notNull(),
  targetSystems: jsonb('target_systems').$type<string[]>().notNull(),
  workItems: jsonb('work_items').$type<string[]>().notNull(),
  records: jsonb('records').$type<string[]>().notNull(),
  total: integer('total').notNull(),
  decidedAt: timestamp('decided_at',{withTimezone:true}).notNull(),
}, t=>[
  primaryKey({columns:[t.runId,t.checkName]}),
  index('run_gate_check_run_idx').on(t.runId,t.outcome),
  // The whole §H vocabulary, from the first commit. A row naming a check that is not one
  // of the addendum's twenty is a Gate that judged something nobody specified.
  check('run_gate_check_name',sql`${t.checkName} IN ('workspace-access','population-acquisition','count-reconciliation-file','count-reconciliation-inclusion','empty-population','per-record-coverage','identity-corroboration','search-completeness','required-evidence','observation-corroboration','condition-completeness','extraction-completeness','schema','mandatory-values','duplicate-primary-keys','ambiguous-match','unnamed-value','snapshot-freshness','observation-freshness','integrity')`),
  // A PASS never carries a diagnostic and a FAIL always does: a passing check with a reason
  // attached reads as a finding to everything downstream, and a failing one with none is a
  // finding nobody can act on.
  check('run_gate_check_outcome',sql`${t.outcome} IN ('PASS','FAIL') AND coalesce(jsonb_typeof(${t.diagnostics})='array',false) AND (${t.outcome}='PASS') = (jsonb_array_length(${t.diagnostics})=0)`),
  // The closed diagnostic vocabulary, pinned INSIDE the jsonb by containment: every element
  // of `diagnostics` must be an element of the list. `<@` refuses a number, an object and a
  // spelling nobody declared alike, and an empty array is contained in anything.
  check('run_gate_check_diagnostics',sql`${t.diagnostics} <@ '["session-step-failed","target-access-denied","acquisition-incomplete","declaration-absent","declaration-contradictory","declared-count-mismatch","declared-digest-mismatch","rows-unaccounted","exclusion-reason-missing","population-empty","record-uncovered","record-uninspected","record-ambiguous","identity-uncorroborated","absence-unproven","evidence-missing","observation-contradicted","condition-evaluation-missing","extraction-incomplete","acquisition-unavailable","schema-field-missing","schema-field-undeclared","mandatory-identifier-empty","mandatory-value-missing","timestamp-unparseable","duplicate-primary-key","ambiguous-match","unnamed-value","snapshot-stale","snapshot-future-dated","snapshot-generation-unknown","observation-stale","integrity-mismatch"]'::jsonb`),
  // The named identity lists are a bounded sample; `total` is exact and never truncated.
  check('run_gate_check_affected',sql`coalesce(jsonb_typeof(${t.targetSystems})='array' AND jsonb_array_length(${t.targetSystems})<=32,false) AND coalesce(jsonb_typeof(${t.workItems})='array' AND jsonb_array_length(${t.workItems})<=32,false) AND coalesce(jsonb_typeof(${t.records})='array' AND jsonb_array_length(${t.records})<=32,false) AND ${t.total}>=0`),
  // A row that found nothing names nothing: a PASS carrying affected identities would put
  // a Work Item on the Result under a check it passed.
  check('run_gate_check_pass_names_nothing',sql`${t.outcome}<>'PASS' OR (jsonb_array_length(${t.targetSystems})=0 AND jsonb_array_length(${t.workItems})=0 AND jsonb_array_length(${t.records})=0 AND ${t.total}=0)`),
]);

/**
 * Generation 25 — the sealed Result (Story 3.9).
 *
 * One row per Run, written by `CompleteRun` at the terminal transition, in the SAME
 * transaction as the terminal Run state and the Evidence package seal. It carries the
 * System Outcome, the addendum §E.1 row that decided it, the Gate verdict that row read,
 * the version's own scope statement verbatim, and the published document an auditor reads.
 *
 * The CHECKs pin the outcome vocabulary, the §E.1 row-to-outcome mapping, the
 * outcome-to-Run-state agreement and — the one that matters most — that a `PASS` is
 * impossible while the Gate did not pass. That last one is the story's central rule stated
 * where no command, migration or psql session can route around it: a passed Gate is
 * NECESSARY for a Pass, and this is the half of "necessary but never sufficient" a
 * database can express.
 *
 * Two things the COMMAND cannot route around either, because `0025_*.sql` says them in
 * triggers: a Run may not reach a terminal state without one of these rows, and a SEALED
 * Result can never be UPDATEd. The only permitted update is the sealing of the one unsealed
 * outcome there is (`PENDING_CONFIRMATION`), which must raise the version by exactly one.
 */
export const runResult = pgTable('run_result', {
  runId: uuid('run_id').primaryKey().references(() => auditRun.runId),
  /** 1 when the Result is written; raised by one on the sealing of a pending Result. */
  version: integer('version').notNull(),
  outcome: text('outcome').$type<import('@intellifin/domain').SystemOutcome>().notNull(),
  /** Which §E.1 row decided, so a Result can say why it says what it says. */
  outcomeRow: text('outcome_row').$type<import('@intellifin/domain').OutcomeRowId>().notNull(),
  sealed: boolean('sealed').notNull(),
  runState: text('run_state').notNull(),
  /** Read from `run_gate_check`, never inferred from the evaluations. */
  gatePassed: boolean('gate_passed').notNull(),
  sealedAt: timestamp('sealed_at',{withTimezone:true}).notNull(),
  /** The version's stored scope statement, VERBATIM. NULL for an unreadable frozen plan. */
  scope: text('scope'),
  publication: jsonb('publication').$type<import('@intellifin/domain').RunResultPublication>().notNull(),
}, t=>[
  check('run_result_outcome',sql`${t.outcome} IN ('CANCELED','RUN_FAILED','INCONCLUSIVE','PENDING_CONFIRMATION','CONTROL_FAILURE','PASS')`),
  // The §E.1 rows, and the outcome each of them produces. A row that produced a different
  // outcome would be a transcription nobody could check from the data.
  check('run_result_row',sql`${t.outcomeRow} = CASE ${t.outcome} WHEN 'CANCELED' THEN 'canceled' WHEN 'RUN_FAILED' THEN 'run-failed' WHEN 'PENDING_CONFIRMATION' THEN 'pending-confirmation' WHEN 'CONTROL_FAILURE' THEN 'control-failure' WHEN 'PASS' THEN 'pass' ELSE ${t.outcomeRow} END AND ${t.outcomeRow} IN ('canceled','run-failed','gate-failed','pending-confirmation','unevaluated','control-failure','pass') AND (${t.outcome} <> 'INCONCLUSIVE' OR ${t.outcomeRow} IN ('gate-failed','unevaluated'))`),
  // Pending Confirmation is the one outcome §E.1 marks "(unsealed)", and the only Result
  // that is waiting for anything. Everything else is final the moment it is written.
  check('run_result_sealed',sql`${t.sealed} = (${t.outcome} <> 'PENDING_CONFIRMATION')`),
  check('run_result_version',sql`${t.version} >= 1`),
  check('run_result_run_state',sql`${t.runState} IN ('COMPLETED','INCONCLUSIVE','RUN_FAILED','CANCELED')`),
  // Three outcomes ARE Run states ("(Run state)" in §E.1's own cells) and must equal one;
  // the other three are conclusions only a COMPLETED Run reaches.
  check('run_result_state_agrees',sql`CASE WHEN ${t.outcome} IN ('CANCELED','RUN_FAILED','INCONCLUSIVE') THEN ${t.runState} = ${t.outcome} ELSE ${t.runState} = 'COMPLETED' END`),
  // A passed Gate is NECESSARY for a Pass. It is never sufficient, which is a rule about
  // the evaluations and lives in the command; this is the half a CHECK can hold.
  check('run_result_pass_requires_gate',sql`${t.outcome} <> 'PASS' OR ${t.gatePassed}`),
  check('run_result_scope',sql`${t.scope} IS NULL OR length(${t.scope}) <= 10000`),
  check('run_result_publication',sql`coalesce(jsonb_typeof(${t.publication})='object',false)`),
]);

/**
 * The mutable review revision for one unsealed Result (Story 4.9).
 *
 * The Result's ten-key contract stays frozen. Review answers advance this adjacent
 * aggregate under the same Run -> Result -> review lock order; the immutable decision
 * rows below bind to the revision they append.
 */
export const runResultReview = pgTable('run_result_review', {
  runId: uuid('run_id').primaryKey().references(() => runResult.runId, { onDelete: 'cascade' }),
  revision: integer('revision').notNull().default(0),
}, t => [
  check('run_result_review_revision', sql`${t.revision} >= 0`),
]);

/**
 * One immutable human decision over one original Agent-Judged evaluation.
 *
 * Every original field is copied into the row so a later effective overlay cannot change
 * what the reviewer saw. The migration adds the cross-row guard: the copied proposal must
 * still be the pending evaluation on a Completed Run with an unsealed Result, and its
 * review revision must be the current locked aggregate revision.
 */
export const runEvaluationReview = pgTable('run_evaluation_review', {
  decisionId: uuid('decision_id').primaryKey(),
  runId: uuid('run_id').notNull().references(() => auditRun.runId),
  observationId: uuid('observation_id').notNull(),
  conditionId: text('condition_id').notNull(),
  reviewRevision: integer('review_revision').notNull(),
  action: text('action').notNull(),
  originalOrigin: text('original_origin').notNull(),
  originalValue: text('original_value').notNull(),
  originalConfirmation: text('original_confirmation').notNull(),
  originalConfidence: numeric('original_confidence',{precision:7,scale:6}),
  originalRationale: text('original_rationale'),
  originalEvidenceIds: jsonb('original_evidence_ids').$type<string[]>().notNull(),
  effectiveOrigin: text('effective_origin').notNull(),
  effectiveValue: text('effective_value').notNull(),
  effectiveConfirmation: text('effective_confirmation'),
  replacementValue: text('replacement_value'),
  rejectionRationale: text('rejection_rationale'),
  actorId: text('actor_id').notNull(),
  decidedAt: timestamp('decided_at',{withTimezone:true}).notNull(),
}, t => [
  // One decision per target, and no two decisions may claim one review revision.
  uniqueIndex('run_evaluation_review_target_uidx').on(t.runId,t.observationId,t.conditionId),
  uniqueIndex('run_evaluation_review_revision_uidx').on(t.runId,t.reviewRevision),
  foreignKey({
    columns: [t.observationId,t.conditionId],
    foreignColumns: [runObservationEvaluation.observationId,runObservationEvaluation.conditionId],
    name: 'run_evaluation_review_evaluation_fk',
  }).onDelete('cascade'),
  check('run_evaluation_review_revision',sql`${t.reviewRevision} >= 1`),
  check('run_evaluation_review_action',sql`${t.action} IN ('confirm','reject')`),
  check('run_evaluation_review_original_origin',sql`${t.originalOrigin} = 'AGENT_JUDGED'`),
  check('run_evaluation_review_original_value',sql`${t.originalValue} IN ('COMPLIANT','EXCEPTION','UNEVALUATED')`),
  check('run_evaluation_review_original_confirmation',sql`${t.originalConfirmation} = 'pending'`),
  check('run_evaluation_review_original_confidence',sql`${t.originalConfidence} IS NULL OR (${t.originalConfidence} >= 0 AND ${t.originalConfidence} <= 1)`),
  check('run_evaluation_review_original_rationale',sql`${t.originalRationale} IS NULL OR length(${t.originalRationale}) BETWEEN 1 AND 8192`),
  check('run_evaluation_review_original_evidence',sql`coalesce(jsonb_typeof(${t.originalEvidenceIds}) = 'array' AND jsonb_array_length(${t.originalEvidenceIds}) BETWEEN 1 AND 16, false)`),
  check('run_evaluation_review_effective_origin',sql`${t.effectiveOrigin} IN ('AGENT_JUDGED','HUMAN')`),
  check('run_evaluation_review_effective_value',sql`${t.effectiveValue} IN ('COMPLIANT','EXCEPTION','UNEVALUATED')`),
  check('run_evaluation_review_effective_confirmation',sql`${t.effectiveConfirmation} IS NULL OR ${t.effectiveConfirmation} = 'confirmed'`),
  check('run_evaluation_review_replacement_value',sql`${t.replacementValue} IS NULL OR ${t.replacementValue} IN ('COMPLIANT','EXCEPTION','UNEVALUATED')`),
  check('run_evaluation_review_rejection_rationale',sql`${t.rejectionRationale} IS NULL OR length(${t.rejectionRationale}) BETWEEN 1 AND 4000`),
  check('run_evaluation_review_shape',sql`coalesce((
    (${t.action} = 'confirm'
      AND ${t.effectiveOrigin} = 'AGENT_JUDGED'
      AND ${t.effectiveValue} = ${t.originalValue}
      AND ${t.effectiveConfirmation} = 'confirmed'
      AND ${t.replacementValue} IS NULL
      AND ${t.rejectionRationale} IS NULL)
    OR
    (${t.action} = 'reject'
      AND ${t.effectiveOrigin} = 'HUMAN'
      AND ${t.effectiveConfirmation} IS NULL
      AND ${t.replacementValue} IS NOT NULL
      AND ${t.rejectionRationale} IS NOT NULL
      AND btrim(${t.rejectionRationale}) <> '')
  ), false)`),
  check('run_evaluation_review_condition',sql`length(${t.conditionId}) BETWEEN 1 AND 255`),
  check('run_evaluation_review_actor',sql`length(btrim(${t.actorId})) BETWEEN 1 AND 255`),
]);

/**
 * Durable handoff for a human evaluation review (Story 4.9 worker completion).
 *
 * The web stores the bounded request and identity here, then enqueues only the command
 * id. A worker locks this row before the Run/Result/review rows and changes PENDING to one
 * terminal state in the same transaction as the immutable decision, any worker-signed
 * Exception and Result seal. A redelivered queue job therefore sees its terminal row and
 * performs no second write.
 */
export const runEvaluationReviewCommand = pgTable('run_evaluation_review_command', {
  commandId: uuid('command_id').primaryKey(),
  runId: uuid('run_id').notNull().references(() => auditRun.runId, { onDelete: 'cascade' }),
  observationId: uuid('observation_id').notNull(),
  conditionId: text('condition_id').notNull(),
  expectedReviewRevision: integer('expected_review_revision').notNull(),
  action: text('action').notNull(),
  replacementValue: text('replacement_value'),
  rationale: text('rationale'),
  actorId: text('actor_id').notNull(),
  sessionId: text('session_id').notNull(),
  correlationId: uuid('correlation_id').notNull(),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull(),
  status: text('status').notNull(),
  decisionId: uuid('decision_id'),
  reviewRevision: integer('review_revision'),
  resultVersion: integer('result_version'),
  resultOutcome: text('result_outcome'),
  resultSealed: boolean('result_sealed'),
  refusalCode: text('refusal_code'),
  processedAt: timestamp('processed_at', { withTimezone: true }),
}, t => [
  // One command can claim one target/revision. A browser retry returns this same id.
  // A refused command is immutable history, not a lock on the target. Only one pending
  // request may claim a target/revision; a later authorized retry can therefore enqueue a
  // fresh command after a transient role or worker refusal.
  uniqueIndex('run_evaluation_review_command_target_uidx')
    .on(t.runId, t.observationId, t.conditionId, t.expectedReviewRevision)
    .where(sql`${t.status} = 'PENDING'`),
  foreignKey({
    columns: [t.observationId, t.conditionId],
    foreignColumns: [runObservationEvaluation.observationId, runObservationEvaluation.conditionId],
    name: 'run_evaluation_review_command_evaluation_fk',
  }).onDelete('cascade'),
  check('run_evaluation_review_command_revision', sql`${t.expectedReviewRevision} >= 0`),
  check('run_evaluation_review_command_action', sql`${t.action} IN ('confirm','reject')`),
  check('run_evaluation_review_command_replacement', sql`coalesce(
    (${t.action} = 'confirm' AND ${t.replacementValue} IS NULL)
    OR (${t.action} = 'reject' AND ${t.replacementValue} IN ('COMPLIANT','EXCEPTION','UNEVALUATED')),
    false)`),
  check('run_evaluation_review_command_rationale', sql`coalesce(
    (${t.action} = 'confirm' AND ${t.rationale} IS NULL)
    OR (${t.action} = 'reject' AND ${t.rationale} IS NOT NULL AND length(${t.rationale}) BETWEEN 1 AND 4000 AND btrim(${t.rationale}) <> ''),
    false)`),
  check('run_evaluation_review_command_actor', sql`length(btrim(${t.actorId})) BETWEEN 1 AND 255`),
  check('run_evaluation_review_command_session', sql`length(btrim(${t.sessionId})) BETWEEN 1 AND 255`),
  check('run_evaluation_review_command_status', sql`${t.status} IN ('PENDING','SUCCEEDED','REFUSED')`),
  // Terminal metadata is all-or-nothing. `coalesce(..., false)` keeps NULL from passing a
  // malformed terminal row through a CHECK's three-valued logic.
  check('run_evaluation_review_command_completion', sql`coalesce((
    (${t.status} = 'PENDING'
      AND ${t.decisionId} IS NULL AND ${t.reviewRevision} IS NULL AND ${t.resultVersion} IS NULL
      AND ${t.resultOutcome} IS NULL AND ${t.resultSealed} IS NULL AND ${t.refusalCode} IS NULL
      AND ${t.processedAt} IS NULL)
    OR
    (${t.status} = 'SUCCEEDED'
      AND ${t.decisionId} IS NOT NULL AND ${t.reviewRevision} >= 1 AND ${t.resultVersion} >= 1
      AND ${t.resultOutcome} IN ('CANCELED','RUN_FAILED','INCONCLUSIVE','PENDING_CONFIRMATION','CONTROL_FAILURE','PASS')
      AND ${t.resultSealed} IS NOT NULL AND ${t.refusalCode} IS NULL AND ${t.processedAt} IS NOT NULL)
    OR
    (${t.status} = 'REFUSED'
      AND ${t.decisionId} IS NULL AND ${t.reviewRevision} IS NULL AND ${t.resultVersion} IS NULL
      AND ${t.resultOutcome} IS NULL AND ${t.resultSealed} IS NULL
      AND ${t.refusalCode} IN ('malformed','unauthorized','unknown','not-completed','sealed','not-pending','stale-revision','rationale-required','invalid-replacement')
      AND ${t.processedAt} IS NOT NULL)
  ), false)`),
]);

/** Agent work progress extends the shared audit engine; no duplicate Observation tables. */
export const runAgentWork = pgTable('run_agent_work', {
  runId: uuid('run_id').primaryKey().references(() => auditRun.runId, { onDelete: 'cascade' }),
  revision: integer('revision').notNull(), status: text('status').notNull(),
  runStartedAt: timestamp('run_started_at',{withTimezone:true}).notNull(),
  leaseUntil: timestamp('lease_until',{withTimezone:true}).notNull(),
  attemptId: uuid('attempt_id').notNull(),
  workItemId: uuid('work_item_id').references(() => runWorkItem.workItemId),
  waitId: uuid('wait_id'),
  pendingWait: jsonb('pending_wait').$type<AgentWorkCheckpoint['pendingWait']>(),
  nextTurn: integer('next_turn').notNull(), tokens: integer('tokens').notNull(),
  reservedTokens: integer('reserved_tokens').notNull(),
  model: jsonb('model').$type<AgentModelIdentity>(), diagnostic: text('diagnostic'),
}, t => [
  check('run_agent_work_status',sql`${t.status} IN ('EXECUTING','RETRY','WAITING','COMPLETE','TERMINAL')`),
  check('run_agent_work_counts',sql`${t.revision}>0 AND ${t.nextTurn}>0 AND ${t.tokens}>=0 AND ${t.reservedTokens}>=0`),
]);

export const runAgentTurn = pgTable('run_agent_turn', {
  runId: uuid('run_id').notNull().references(() => auditRun.runId,{onDelete:'cascade'}),
  sequence: integer('sequence').notNull(),
  workItemId: uuid('work_item_id').notNull().references(() => runWorkItem.workItemId),
  stepExecutionId: uuid('step_execution_id').notNull().references(() => runStepExecution.stepExecutionId),
  snapshotEvidenceId: uuid('snapshot_evidence_id').notNull().references(() => runEvidence.evidenceId),
  status: text('status').notNull(), reservedTokens: integer('reserved_tokens').notNull(),
  response: jsonb('response').$type<AgentModelResponse>(), diagnostic: text('diagnostic'),
}, t => [
  primaryKey({columns:[t.runId,t.sequence]}),
  check('run_agent_turn_status',sql`${t.status} IN ('RESERVED','COMPLETED','FAILED')`),
  check('run_agent_turn_counts',sql`${t.sequence}>0 AND ${t.reservedTokens}>0`),
  check('run_agent_turn_response',sql`(${t.status}='COMPLETED')=(${t.response} IS NOT NULL)`),
]);

/** Capture provenance is shared Evidence metadata, with links to the actual reading action. */
export const runEvidenceCapture = pgTable('run_evidence_capture', {
  evidenceId: uuid('evidence_id').primaryKey().references(() => runEvidence.evidenceId),
  runId: uuid('run_id').notNull().references(() => auditRun.runId),
  toolActionId: uuid('tool_action_id').notNull().references(() => runToolAction.toolActionId),
  sourceLocation: text('source_location').notNull(),
});

/** A kind-agnostic durable wait. The partial index permits only one open wait per Run. */
export const runWait = pgTable('run_wait', {
  waitId: uuid('wait_id').primaryKey(),
  runId: uuid('run_id').notNull().references(() => auditRun.runId),
  kind: text('kind').notNull(), options: jsonb('options').notNull().$type<readonly EscalationOption[]>(),
  deadline: timestamp('deadline',{withTimezone:true}).notNull(),
  closedAt: timestamp('closed_at',{withTimezone:true}), closureKind: text('closure_kind'),
  answerOptionId: text('answer_option_id'), actor: text('actor'),
}, t => [
  uniqueIndex('run_wait_one_open').on(t.runId).where(sql`${t.closedAt} IS NULL`),
  index('run_wait_deadline').on(t.deadline).where(sql`${t.closedAt} IS NULL`),
  check('run_wait_kind',sql`${t.kind} IN ('choose-candidate','unnamed-value','retry-or-skip')`),
  check('run_wait_options',sql`jsonb_typeof(${t.options})='array' AND jsonb_array_length(${t.options})>0`),
  check('run_wait_closure',sql`(${t.closedAt} IS NULL AND ${t.closureKind} IS NULL AND ${t.answerOptionId} IS NULL AND ${t.actor} IS NULL) OR (${t.closedAt} IS NOT NULL AND ${t.closureKind} IS NOT NULL AND ${t.closureKind}='answer' AND ${t.answerOptionId} IS NOT NULL AND ${t.actor} IS NOT NULL) OR (${t.closedAt} IS NOT NULL AND ${t.closureKind} IS NOT NULL AND ${t.actor} IS NOT NULL AND ${t.closureKind}='timeout' AND ${t.answerOptionId} IS NULL AND ${t.actor}='wait-wake')`),
]);

export type RunObservationEvaluationRow = typeof runObservationEvaluation.$inferSelect;
export type RunResultReviewRow = typeof runResultReview.$inferSelect;
export type RunEvaluationReviewRow = typeof runEvaluationReview.$inferSelect;
export type RunEvaluationReviewCommandRow = typeof runEvaluationReviewCommand.$inferSelect;

/** Immutable registration-time absence provenance; no historical proof is invented. */
export const runObservationAbsence = pgTable('run_observation_absence', {
  observationId: uuid('observation_id').primaryKey().references(() => runObservation.observationId, { onDelete: 'cascade' }),
  runId: uuid('run_id').notNull().references(() => auditRun.runId),
  proof: jsonb('proof').$type<import('@intellifin/domain').ObservationAbsenceProof>(),
  expectedQueryKeys: jsonb('expected_query_keys').$type<readonly import('@intellifin/domain').ObservationQueryKey[]>().notNull(),
  digest: text('digest').notNull(),
}, t => [
  check('run_observation_absence_digest', sql`${t.digest} ~ '^[0-9a-f]{64}$'`),
  check('run_observation_absence_proof', sql`${t.proof} IS NULL OR (jsonb_typeof(${t.proof}) = 'object' AND octet_length(${t.proof}::text) <= 4194304)`),
  check('run_observation_absence_expected', sql`jsonb_typeof(${t.expectedQueryKeys}) = 'array' AND jsonb_array_length(${t.expectedQueryKeys}) <= 64 AND octet_length(${t.expectedQueryKeys}::text) <= 4194304`),
  index('run_observation_absence_run').on(t.runId),
]);
