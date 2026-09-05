import type { PlanDerivationFields } from '@intellifin/application';
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
}, table => [
  index('notification_recipient_delivery_idx').on(table.recipientId, table.deliveredAt.desc(), table.sendKey),
  index('notification_pending_delivery_idx').on(table.createdAt, table.sendKey).where(sql`${table.deliveredAt} IS NULL`),
  check('notification_version_number', sql`${table.versionNumber} > 0`),
  check('notification_kind', sql`${table.kind} IN ('submitted','approved','rejected')`),
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
}, table => [
  uniqueIndex('audit_run_initiator_request').on(table.initiatorId, table.requestToken),
  foreignKey({ name: 'audit_run_version_owner_fk', columns: [table.procedureId, table.versionId], foreignColumns: [procedureVersion.procedureId, procedureVersion.versionId] }),
  uniqueIndex('audit_run_active_standard_period').on(table.procedureId, table.periodFrom, table.periodTo).where(sql`${table.kind} = 'STANDARD' AND ${table.state} IN ('QUEUED','RUNNING','PAUSED','AWAITING_AUDITOR')`),
  check('audit_run_state', sql`${table.state} IN ('QUEUED','RUNNING','PAUSED','AWAITING_AUDITOR','COMPLETED','INCONCLUSIVE','RUN_FAILED','CANCELED')`),
  check('audit_run_kind', sql`${table.kind} IN ('STANDARD','REGRESSION')`),
  check('audit_run_period', sql`${table.periodFrom} >= DATE '0001-01-01' AND ${table.periodTo} <= DATE '9999-12-31' AND ${table.periodFrom} <= ${table.periodTo}`),
  check('audit_run_version', sql`${table.versionNumber} > 0`),
  check('audit_run_authorization', sql`${table.authorizationRole} IN ('auditor','audit-manager')`),
  check('audit_run_uuid_v7', sql`substring(${table.runId}::text, 15, 1) = '7' AND substring(${table.correlationId}::text, 15, 1) = '7'`),
]);


/** Multiple acknowledgement attempts may point at the same active or terminal Run. */
export const runInitiationRequest = pgTable('run_initiation_request', {
  initiatorId: text('initiator_id').notNull(), requestToken: uuid('request_token').notNull(),
  runId: uuid('run_id').notNull().references(() => auditRun.runId),
}, table => [primaryKey({ columns: [table.initiatorId, table.requestToken] })]);

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
},t=>[check('population_evidence_digest',sql`${t.rawDigest} IS NULL OR ${t.rawDigest} ~ '^[0-9a-f]{64}$'`),check('population_evidence_size',sql`${t.size} IS NULL OR ${t.size} >= 0`),check('population_evidence_state',sql`${t.state} IN ('RESERVED','REGISTERED','ABANDONED') AND (${t.state}<>'REGISTERED' OR (${t.rawDigest} IS NOT NULL AND ${t.envelopeDigest} IS NOT NULL AND ${t.size} IS NOT NULL))`)]);
export const populationSnapshot = pgTable('population_snapshot', {
  runId:uuid('run_id').primaryKey().references(()=>auditRun.runId), included:integer('included').notNull(),excluded:integer('excluded').notNull(),indeterminate:integer('indeterminate').notNull(),
  rowsDigest:text('rows_digest'), checks:jsonb('checks').$type<import('@intellifin/domain').PopulationCheck[]>().notNull(),
});
export const populationRow = pgTable('population_row', {
  runId:uuid('run_id').notNull().references(()=>populationSnapshot.runId),ordinal:integer('ordinal').notNull(),
  values:jsonb('values').$type<Record<string,import('@intellifin/domain').JsonValue>>().notNull(), disposition:text('disposition').$type<import('@intellifin/domain').PopulationRow['disposition']>().notNull(), reasons:jsonb('reasons').$type<string[]>().notNull(),
},t=>[primaryKey({columns:[t.runId,t.ordinal]}),check('population_row_disposition',sql`${t.disposition} IN ('included','excluded','indeterminate')`),check('population_row_ordinal',sql`${t.ordinal}>0`)]);
