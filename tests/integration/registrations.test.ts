import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  REGISTRATION_ANNOTATED_EVENT,
  changeTargetSystem,
  registerTargetSystem,
  registrationRowVersion,
  type CredentialCapability,
  type CredentialProvider,
  type RegistrationDependencies,
  type RegistrationFields,
  type SessionSnapshot,
} from '@intellifin/application';
import { registrationDigest } from '@intellifin/domain';
import {
  CryptoUuidV7Generator,
  DrizzleRegistrationRepository,
  DrizzleRoleRepository,
  ManifestCredentialProvider,
  TimerDeadline,
  PostgresAuditChainReader,
  PostgresRegistrationsUnitOfWork,
  createDb,
  createSeedAuth,
  createSqlClient,
  type Auth,
  type Database,
  type Sql,
} from '@intellifin/infrastructure';
import { recordProbe } from '@intellifin/infrastructure/probe';

/**
 * Target System registrations against a real, migrated PostgreSQL 18 (FR-8, FR-45,
 * AD-2, AD-8, AD-10).
 *
 * Everything here is about promises only a real transaction can keep: the registration
 * and its `RegistrationChanged` event commit together or not at all, and a refused
 * credential leaves the table exactly as it was. A fake unit of work can be written to
 * behave that way; PostgreSQL either does or does not.
 *
 * It also asserts the two guarantees that live in the DATABASE rather than in code: the
 * read-only action CHECK constraint, and the digest-format CHECK. Both are attempted
 * with raw SQL, because the point of a constraint is that it holds against a writer that
 * has not read the command.
 *
 * Nothing here migrates. Rows are namespaced by process id and deleted afterwards, and
 * the `platform` chain is verified at the end.
 */

const databaseUrl = process.env['DATABASE_URL'];
const SECRET = 'integration-test-secret-not-a-real-one';
const BASE_URL = 'http://localhost:3000';
const PASSWORD = 'correct horse battery staple';
const AUTH_CONFIG = { secret: SECRET, baseUrl: BASE_URL };

const READ_ONLY_REF = 'cred://synthetic/story-1-6-readonly';
const WRITE_CAPABLE_REF = 'cred://synthetic/story-1-6-writer';
const UNDECLARED_REF = 'cred://synthetic/story-1-6-undeclared';

const MANIFEST = new Map<string, CredentialCapability>([
  [READ_ONLY_REF, 'read-only'],
  [WRITE_CAPABLE_REF, 'write-capable'],
]);

describe.skipIf(!databaseUrl)('Target System registrations against PostgreSQL 18', () => {
  let sql: Sql;
  let db: Database;
  let seedAuth: Auth;
  const prefix = `story-1-6-${process.pid}-`;
  const emailFor = (label: string) => `${prefix}${label}@synthetic.invalid`;

  let admin: SessionSnapshot;
  let auditor: SessionSnapshot;
  /** Registration ids this suite created, deleted in `afterAll`. */
  const created: string[] = [];

  function fields(overrides: Partial<RegistrationFields> = {}): RegistrationFields {
    return {
      displayName: `${prefix}Northstar Web`,
      kind: 'web',
      allowedOrigins: ['https://northstar.synthetic.invalid'],
      applicationIdentity: '',
      credentialRef: READ_ONLY_REF,
      permittedActions: ['navigate', 'read-attribute'],
      attributeLabelPatterns: ['Invoice *'],
      secondaryKey: '',
      note: '',
      status: 'active',
      ...overrides,
    };
  }

  function dependencies(
    options: { failIds?: boolean; credentials?: CredentialProvider } = {},
  ): RegistrationDependencies {
    return {
      roles: new DrizzleRoleRepository(db),
      credentials: options.credentials ?? new ManifestCredentialProvider(MANIFEST),
      deadlines: new TimerDeadline(),
      unitOfWork: new PostgresRegistrationsUnitOfWork(
        db,
        // An id generator that produces something the canonical envelope rejects, so the
        // append throws AFTER the state write inside the same transaction — the ordering
        // the atomicity claim is actually about.
        options.failIds ? { ids: { next: () => 'not-a-uuid-v7' } } : {},
      ),
      ids: new CryptoUuidV7Generator(),
    };
  }

  async function eventsFor(correlationId: string) {
    return sql<
      {
        event_type: string;
        outcome: string;
        actor_id: string;
        aggregate_id: string;
        payload: Record<string, unknown>;
      }[]
    >`
      SELECT event_type, outcome, actor_id, aggregate_id, payload
      FROM audit_events
      WHERE correlation_id = ${correlationId}
      ORDER BY sequence
    `;
  }

  async function rowFor(registrationId: string) {
    const rows = await sql<
      { digest: string; display_name: string; permitted_actions: string[]; status: string }[]
    >`
      SELECT digest, display_name, permitted_actions, status
      FROM target_system_registration WHERE registration_id = ${registrationId}
    `;
    return rows[0] ?? null;
  }

  /**
   * The row version the surface would have rendered, read from the real row.
   *
   * Read through the repository rather than reconstructed in the test: a token the test
   * builds from its own idea of the row would agree with itself and prove nothing about
   * what the command compares against.
   */
  async function rowVersionOf(registrationId: string): Promise<string> {
    const record = await new DrizzleRegistrationRepository(db).findRegistration(registrationId);
    if (record === null) throw new Error(`no registration ${registrationId}`);
    return registrationRowVersion(record);
  }

  async function createSession(userId: string, label: string): Promise<SessionSnapshot> {
    const sessionId = `${prefix}session-${label}`;
    await sql`
      INSERT INTO auth_session (id, user_id, token, expires_at)
      VALUES (${sessionId}, ${userId}, ${`${prefix}token-${label}`}, now() + interval '1 hour')
      ON CONFLICT (id) DO NOTHING
    `;
    return { userId, sessionId };
  }

  beforeAll(async () => {
    sql = createSqlClient(databaseUrl as string, { max: 5 });
    db = createDb(sql);
    seedAuth = createSeedAuth(db, AUTH_CONFIG);

    await sql`DELETE FROM target_system_registration WHERE display_name LIKE ${`${prefix}%`}`;
    await sql`DELETE FROM auth_user WHERE email LIKE ${`${prefix}%`}`;
    await sql`DELETE FROM audit_events WHERE correlation_id LIKE ${`${prefix}%`}`;

    const one = await seedAuth.api.signUpEmail({
      body: { email: emailFor('admin'), name: 'Synthetic Administrator', password: PASSWORD },
    });
    await sql`INSERT INTO user_role (user_id, role) VALUES (${one.user.id}, 'poc-administrator')`;
    admin = await createSession(one.user.id, 'admin');

    const two = await seedAuth.api.signUpEmail({
      body: { email: emailFor('auditor'), name: 'Synthetic Auditor', password: PASSWORD },
    });
    await sql`INSERT INTO user_role (user_id, role) VALUES (${two.user.id}, 'auditor')`;
    auditor = await createSession(two.user.id, 'auditor');
  });

  afterAll(async () => {
    for (const registrationId of created) {
      await sql`DELETE FROM target_system_registration WHERE registration_id = ${registrationId}`;
    }
    await sql`DELETE FROM target_system_registration WHERE display_name LIKE ${`${prefix}%`}`;
    await sql`DELETE FROM auth_user WHERE email LIKE ${`${prefix}%`}`;
    // The events stay: deleting them would leave `audit_event_heads` pointing past the
    // rows that remain, which is a corrupt chain — the thing the last test verifies.
    await sql.end({ timeout: 5 });
  });

  async function register(
    overrides: Partial<RegistrationFields> = {},
    correlationId = `${prefix}create`,
    options: Parameters<typeof dependencies>[0] = {},
  ) {
    const outcome = await registerTargetSystem(dependencies(options), {
      ...fields(overrides),
      session: admin,
      correlationId,
    });
    if (outcome.ok) created.push(outcome.registrationId);
    return outcome;
  }

  it('writes the registration, its digest and one event in one transaction', async () => {
    const correlationId = `${prefix}create`;
    const outcome = await register({}, correlationId);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const row = await rowFor(outcome.registrationId);
    expect(row?.digest).toBe(outcome.digest);
    // The stored digest is the domain module's, not something the adapter recomputed.
    expect(row?.digest).toBe(
      registrationDigest({
        kind: 'web',
        allowedOrigins: ['https://northstar.synthetic.invalid'],
        applicationIdentity: '',
        credentialRef: READ_ONLY_REF,
        permittedActions: ['navigate', 'read-attribute'],
        attributeLabelPatterns: ['Invoice *'],
        secondaryKey: '',
      }),
    );

    const events = await eventsFor(correlationId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event_type: 'configuration.registration-created',
      outcome: 'success',
      actor_id: admin.userId,
      aggregate_id: outcome.registrationId,
    });
    // The chain must not carry anything credential-shaped, ever: it is immutable.
    expect(JSON.stringify(events[0]?.payload)).not.toContain(READ_ONLY_REF);
  });

  it('gives all four kinds different digests, and reads them all back', async () => {
    const digests = new Set<string>();
    for (const [index, kind] of (['web', 'desktop', 'api', 'versioned-file'] as const).entries()) {
      const outcome = await register(
        {
          displayName: `${prefix}Kind ${kind}`,
          kind,
          allowedOrigins: kind === 'desktop' ? [] : ['https://kinds.synthetic.invalid'],
          applicationIdentity: kind === 'desktop' ? 'com.synthetic.kinds' : '',
        },
        `${prefix}kind-${index}`,
      );
      expect(outcome.ok, kind).toBe(true);
      if (outcome.ok) digests.add(outcome.digest);
    }
    expect(digests.size).toBe(4);

    const listed = await new DrizzleRegistrationRepository(db).listRegistrations();
    const mine = listed.filter((row) => row.displayName.startsWith(`${prefix}Kind `));
    expect(mine).toHaveLength(4);
    // Never probed, and the web made no call to find that out.
    for (const registration of mine) {
      expect(registration.connectivity).toEqual({ state: 'never-probed', observedAt: null });
    }
  });

  it('stores nothing and audits the attempt when the credential is write-capable', async () => {
    const correlationId = `${prefix}write-capable`;
    const outcome = await register(
      { displayName: `${prefix}Refused`, credentialRef: WRITE_CAPABLE_REF },
      correlationId,
    );

    expect(outcome).toEqual({ ok: false, reason: 'Audit credentials must be read-only.' });
    const rows = await sql<{ c: number }[]>`
      SELECT count(*)::int AS c FROM target_system_registration
      WHERE display_name = ${`${prefix}Refused`}
    `;
    expect(rows[0]?.c).toBe(0);

    // The refusal event COMMITTED while nothing was stored: two opposite outcomes that
    // one transaction could not have produced, which is why the check runs before it.
    const events = await eventsFor(correlationId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event_type: 'configuration.registration-refused',
      outcome: 'denied',
      actor_id: admin.userId,
    });
    expect(events[0]?.payload).toMatchObject({ capability: 'write-capable' });
    expect(JSON.stringify(events[0]?.payload)).not.toContain(WRITE_CAPABLE_REF);
  });

  it('fails closed on a credential nothing has declared', async () => {
    const correlationId = `${prefix}undeclared`;
    const outcome = await register(
      { displayName: `${prefix}Undeclared`, credentialRef: UNDECLARED_REF },
      correlationId,
    );

    expect(outcome).toEqual({ ok: false, reason: 'Audit credentials must be read-only.' });
    const rows = await sql<{ c: number }[]>`
      SELECT count(*)::int AS c FROM target_system_registration
      WHERE display_name = ${`${prefix}Undeclared`}
    `;
    expect(rows[0]?.c).toBe(0);
    expect((await eventsFor(correlationId))[0]?.payload).toMatchObject({ capability: 'unknown' });
  });

  it('stores nothing when the audit append fails', async () => {
    const correlationId = `${prefix}append-fails`;

    await expect(
      register({ displayName: `${prefix}Never stored` }, correlationId, { failIds: true }),
    ).rejects.toThrow();

    const rows = await sql<{ c: number }[]>`
      SELECT count(*)::int AS c FROM target_system_registration
      WHERE display_name = ${`${prefix}Never stored`}
    `;
    expect(rows[0]?.c).toBe(0);
    await expect(eventsFor(correlationId)).resolves.toHaveLength(0);
  });

  it('recomputes the digest and publishes RegistrationChanged in the same transaction', async () => {
    const created_ = await register({ displayName: `${prefix}Changing` }, `${prefix}change-setup`);
    expect(created_.ok).toBe(true);
    if (!created_.ok) return;
    const correlationId = `${prefix}change`;

    const outcome = await changeTargetSystem(dependencies(), {
      ...fields({
        displayName: `${prefix}Changing`,
        allowedOrigins: ['https://moved.synthetic.invalid'],
      }),
      session: admin,
      correlationId,
      registrationId: created_.registrationId,
      expectedRowVersion: await rowVersionOf(created_.registrationId),
    });

    expect(outcome).toMatchObject({ ok: true, published: true, priorDigest: created_.digest });
    const row = await rowFor(created_.registrationId);
    expect(row?.digest).not.toBe(created_.digest);

    const events = await eventsFor(correlationId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event_type: 'configuration.registration-changed',
      aggregate_id: created_.registrationId,
    });
    expect(events[0]?.payload).toMatchObject({
      priorDigest: created_.digest,
      changedFields: ['allowedOrigins'],
    });
  });

  it('writes no RegistrationChanged and no new digest when only a non-digest field changes', async () => {
    const created_ = await register({ displayName: `${prefix}Renaming` }, `${prefix}rename-setup`);
    expect(created_.ok).toBe(true);
    if (!created_.ok) return;
    const correlationId = `${prefix}rename`;

    const outcome = await changeTargetSystem(dependencies(), {
      ...fields({ displayName: `${prefix}Renamed`, note: 'an operator note' }),
      session: admin,
      correlationId,
      registrationId: created_.registrationId,
      expectedRowVersion: await rowVersionOf(created_.registrationId),
    });

    expect(outcome).toMatchObject({
      ok: true,
      published: false,
      annotated: true,
      digest: created_.digest,
    });
    const row = await rowFor(created_.registrationId);
    expect(row?.display_name).toBe(`${prefix}Renamed`);
    expect(row?.digest).toBe(created_.digest);
    // The row moved, so the chain has to say so — under the event type Epic 2 does not
    // read, so a rename mints no platform-authored draft.
    const events = await eventsFor(correlationId);
    expect(events).toHaveLength(1);
    expect(events[0]?.event_type).toBe(REGISTRATION_ANNOTATED_EVENT);
  });

  it('writes nothing to the chain when a save moves nothing at all', async () => {
    const created_ = await register({ displayName: `${prefix}Idle` }, `${prefix}idle-setup`);
    expect(created_.ok).toBe(true);
    if (!created_.ok) return;
    const correlationId = `${prefix}idle`;

    const outcome = await changeTargetSystem(dependencies(), {
      ...fields({ displayName: `${prefix}Idle` }),
      session: admin,
      correlationId,
      registrationId: created_.registrationId,
      expectedRowVersion: await rowVersionOf(created_.registrationId),
    });

    expect(outcome).toMatchObject({ ok: true, published: false, annotated: false });
    await expect(eventsFor(correlationId)).resolves.toHaveLength(0);
  });

  it('leaves the registration untouched when the change event cannot be appended', async () => {
    const created_ = await register({ displayName: `${prefix}Untouched` }, `${prefix}untouched-setup`);
    expect(created_.ok).toBe(true);
    if (!created_.ok) return;
    const correlationId = `${prefix}untouched`;

    await expect(
      changeTargetSystem(dependencies({ failIds: true }), {
        ...fields({
          displayName: `${prefix}Untouched`,
          allowedOrigins: ['https://never.synthetic.invalid'],
        }),
        session: admin,
        correlationId,
        registrationId: created_.registrationId,
        expectedRowVersion: await rowVersionOf(created_.registrationId),
      }),
    ).rejects.toThrow();

    // The write happened before the append inside the same transaction, and it is gone.
    const row = await rowFor(created_.registrationId);
    expect(row?.digest).toBe(created_.digest);
    await expect(eventsFor(correlationId)).resolves.toHaveLength(0);
  });

  it('refuses an Auditor and appends security.denied instead', async () => {
    const correlationId = `${prefix}denied`;
    const outcome = await registerTargetSystem(dependencies(), {
      ...fields({ displayName: `${prefix}Should not exist` }),
      session: auditor,
      correlationId,
    });

    expect(outcome).toEqual({ ok: false, reason: 'Your role does not permit this action.' });
    const rows = await sql<{ c: number }[]>`
      SELECT count(*)::int AS c FROM target_system_registration
      WHERE display_name = ${`${prefix}Should not exist`}
    `;
    expect(rows[0]?.c).toBe(0);

    const events = await eventsFor(correlationId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ event_type: 'security.denied', outcome: 'denied' });
    expect(events[0]?.payload).toMatchObject({
      action: 'administration.registrations.manage',
    });
  });

  /**
   * The guarantees that live in the table.
   *
   * These use raw SQL on purpose. A CHECK constraint exists precisely for the writer
   * that has not read the command — a migration, a restored dump, a psql session — so
   * asserting it through the command would prove nothing about the constraint.
   */
  describe('the database refuses what the command refuses', () => {
    const id = '018f0000-0000-7000-8000-0000000000aa';
    const digest = 'a'.repeat(64);

    it('rejects a write action in permitted_actions', async () => {
      await expect(
        sql`
          INSERT INTO target_system_registration
            (registration_id, display_name, kind, allowed_origins, credential_ref,
             permitted_actions, digest)
          VALUES (${id}, ${`${prefix}Raw`}, 'web', ARRAY['https://x.invalid'],
                  ${READ_ONLY_REF}, ARRAY['create-record'], ${digest})
        `,
      ).rejects.toThrow(/target_system_registration_actions_read_only/);
    });

    it('rejects an empty permitted_actions list', async () => {
      await expect(
        sql`
          INSERT INTO target_system_registration
            (registration_id, display_name, kind, allowed_origins, credential_ref,
             permitted_actions, digest)
          VALUES (${id}, ${`${prefix}Raw`}, 'web', ARRAY['https://x.invalid'],
                  ${READ_ONLY_REF}, ARRAY[]::text[], ${digest})
        `,
      ).rejects.toThrow(/target_system_registration_actions_present/);
    });

    it('rejects a digest that is not lower-case SHA-256 hex', async () => {
      await expect(
        sql`
          INSERT INTO target_system_registration
            (registration_id, display_name, kind, allowed_origins, credential_ref,
             permitted_actions, digest)
          VALUES (${id}, ${`${prefix}Raw`}, 'web', ARRAY['https://x.invalid'],
                  ${READ_ONLY_REF}, ARRAY['navigate'], 'NOT-A-DIGEST')
        `,
      ).rejects.toThrow(/target_system_registration_digest_format/);
    });

    it('rejects a kind outside the vocabulary', async () => {
      await expect(
        sql`
          INSERT INTO target_system_registration
            (registration_id, display_name, kind, allowed_origins, credential_ref,
             permitted_actions, digest)
          VALUES (${id}, ${`${prefix}Raw`}, 'ftp', ARRAY['https://x.invalid'],
                  ${READ_ONLY_REF}, ARRAY['navigate'], ${digest})
        `,
      ).rejects.toThrow(/target_system_registration_kind_vocabulary/);
    });
  });

  /**
   * The read path for connectivity, driven from the WORKER's side.
   *
   * `recordProbe` is what the worker will call in Story 1.8. It is imported here from
   * `@intellifin/infrastructure/probe`, the subpath `apps/` may not reach at all — this
   * test is not `apps/`, and proving the read path needs a row that only the write path
   * can create.
   */
  it('reads connectivity the worker wrote, and never writes it from the read path', async () => {
    const created_ = await register({ displayName: `${prefix}Probed` }, `${prefix}probe-setup`);
    expect(created_.ok).toBe(true);
    if (!created_.ok) return;

    const repository = new DrizzleRegistrationRepository(db);
    const before = await repository.findRegistration(created_.registrationId);
    expect(before?.connectivity).toEqual({ state: 'never-probed', observedAt: null });

    const observedAt = new Date('2026-09-02T09:00:00.000Z');
    expect(
      await recordProbe(db, {
        registrationId: created_.registrationId,
        state: 'reachable',
        observedAt,
        observedBy: 'synthetic-worker-1',
      }),
    ).toBe(true);

    const after = await repository.findRegistration(created_.registrationId);
    expect(after?.connectivity).toEqual({
      state: 'reachable',
      observedAt: observedAt.toISOString(),
    });

    // A second observation replaces the first: this table answers "now", not "ever".
    await recordProbe(db, {
      registrationId: created_.registrationId,
      state: 'unreachable',
      observedAt: new Date('2026-09-02T10:00:00.000Z'),
      observedBy: 'synthetic-worker-1',
    });
    const rows = await sql<{ c: number }[]>`
      SELECT count(*)::int AS c FROM target_system_probe
      WHERE registration_id = ${created_.registrationId}
    `;
    expect(rows[0]?.c).toBe(1);

    // And a probe for a registration that no longer exists is discarded, not an error.
    expect(
      await recordProbe(db, {
        registrationId: '018f0000-0000-7000-8000-0000000000bb',
        state: 'reachable',
        observedAt,
        observedBy: 'synthetic-worker-1',
      }),
    ).toBe(false);
  });

  it('leaves the platform chain verifiable after every event this suite appended', async () => {
    const result = await new PostgresAuditChainReader(db).verify('platform');
    expect(result.valid).toBe(true);
  });
});
