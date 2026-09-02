import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CryptoUuidV7Generator,
  DrizzleRegistrationRepository,
  DrizzleRoleRepository,
  ManifestCredentialProvider,
  PostgresRegistrationsUnitOfWork,
  TimerDeadline,
  createDb,
  createSeedAuth,
  createSqlClient,
  type Auth,
  type Database,
  type Sql,
} from '@intellifin/infrastructure';
import { runProbeSweep, type Fetcher } from '@intellifin/infrastructure/probe-runner';
import { REGISTRATION_LIST_LIMIT } from '@intellifin/infrastructure';
import {
  registerTargetSystem,
  type CredentialCapability,
  type RegistrationFields,
  type SessionSnapshot,
} from '@intellifin/application';

/**
 * The Target System connectivity sweep against a real, migrated PostgreSQL 18 (AD-10).
 *
 * `probe-runner.test.ts` covers the decision — what counts as reachable, what is not
 * probed at all — with no database. This is about the half only a real transaction can
 * keep: one row per registration, the row the web then reads, and the behaviour when a
 * registration disappears between the read and the write.
 *
 * The fetcher is a fake on purpose. The point of the sweep is what it WRITES; making a
 * real outbound call here would tie the suite to a second process being up and would
 * still not prove anything more about the row.
 */

const databaseUrl = process.env['DATABASE_URL'];
const SECRET = 'integration-test-secret-not-a-real-one';
const AUTH_CONFIG = { secret: SECRET, baseUrl: 'http://localhost:3000' };
const PASSWORD = 'correct horse battery staple';
const READ_ONLY_REF = 'cred://synthetic/story-1-8-readonly';
const MANIFEST = new Map<string, CredentialCapability>([[READ_ONLY_REF, 'read-only']]);

describe.skipIf(!databaseUrl)('the probe sweep against PostgreSQL 18', () => {
  let sql: Sql;
  let db: Database;
  let seedAuth: Auth;
  const prefix = `story-1-8-${process.pid}-`;
  let admin: SessionSnapshot;

  const UP = 'https://up.synthetic.invalid';
  const DOWN = 'https://down.synthetic.invalid';

  /** Reachable for one origin, refusing for every other. */
  const fetcher: Fetcher = async (origin) => {
    if (origin === UP) return { ok: true, status: 200 };
    throw new Error('ECONNREFUSED');
  };

  function fields(overrides: Partial<RegistrationFields> = {}): RegistrationFields {
    return {
      displayName: `${prefix}system`,
      kind: 'web',
      allowedOrigins: [UP],
      applicationIdentity: '',
      credentialRef: READ_ONLY_REF,
      permittedActions: ['navigate'],
      attributeLabelPatterns: [],
      secondaryKey: '',
      note: '',
      status: 'active',
      ...overrides,
    };
  }

  async function register(overrides: Partial<RegistrationFields>): Promise<string> {
    const result = await registerTargetSystem(
      {
        roles: new DrizzleRoleRepository(db),
        credentials: new ManifestCredentialProvider(MANIFEST),
        deadlines: new TimerDeadline(),
        unitOfWork: new PostgresRegistrationsUnitOfWork(db),
        ids: new CryptoUuidV7Generator(),
      },
      {
        ...fields(overrides),
        session: admin,
        correlationId: `${prefix}${overrides.displayName ?? 'system'}`,
      },
    );
    if (!result.ok) throw new Error(`registration refused: ${result.reason}`);
    return result.registrationId;
  }

  async function probeRow(registrationId: string) {
    const rows = await sql<{ state: string; observed_by: string; observed_at: Date }[]>`
      SELECT state, observed_by, observed_at FROM target_system_probe
      WHERE registration_id = ${registrationId}
    `;
    return rows[0] ?? null;
  }

  beforeAll(async () => {
    sql = createSqlClient(databaseUrl as string, { max: 5 });
    db = createDb(sql);
    seedAuth = createSeedAuth(db, AUTH_CONFIG);

    await sql`DELETE FROM target_system_registration WHERE display_name LIKE ${`${prefix}%`}`;
    await sql`DELETE FROM auth_user WHERE email LIKE ${`${prefix}%`}`;

    const created = await seedAuth.api.signUpEmail({
      body: {
        email: `${prefix}admin@synthetic.invalid`,
        name: 'Synthetic Administrator',
        password: PASSWORD,
      },
    });
    await sql`INSERT INTO user_role (user_id, role) VALUES (${created.user.id}, 'poc-administrator')`;
    const sessionId = `${prefix}session`;
    await sql`
      INSERT INTO auth_session (id, user_id, token, expires_at)
      VALUES (${sessionId}, ${created.user.id}, ${`${prefix}token`}, now() + interval '1 hour')
      ON CONFLICT (id) DO NOTHING
    `;
    admin = { userId: created.user.id, sessionId };
  });

  afterAll(async () => {
    await sql`DELETE FROM target_system_registration WHERE display_name LIKE ${`${prefix}%`}`;
    await sql`DELETE FROM auth_user WHERE email LIKE ${`${prefix}%`}`;
    // The audit events stay. Deleting them would leave `audit_event_heads` pointing past
    // the rows that remain, which is a corrupt chain.
    await sql.end({ timeout: 5 });
  });

  it('writes one row per active registration and the surface reads it', async () => {
    const reachable = await register({ displayName: `${prefix}reachable`, allowedOrigins: [UP] });
    const unreachable = await register({
      displayName: `${prefix}unreachable`,
      allowedOrigins: [DOWN],
    });

    await runProbeSweep(db, { fetcher, observedBy: 'integration-host' });

    expect((await probeRow(reachable))?.state).toBe('reachable');
    expect((await probeRow(unreachable))?.state).toBe('unreachable');
    expect((await probeRow(reachable))?.observed_by).toBe('integration-host');

    // The web reads the same rows through the repository the Administration surface uses,
    // which is the actual claim: the worker writes, the web reads, and the column stops
    // saying "Never probed".
    const registrations = await new DrizzleRegistrationRepository(db).listRegistrations();
    const seen = registrations.find((row) => row.registrationId === reachable);
    expect(seen?.connectivity.state).toBe('reachable');
    expect(seen?.connectivity.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('replaces the previous observation rather than keeping a history', async () => {
    const id = await register({ displayName: `${prefix}flapping`, allowedOrigins: [UP] });
    await runProbeSweep(db, { fetcher, observedBy: 'integration-host' });
    expect((await probeRow(id))?.state).toBe('reachable');

    // The surface answers "is it reachable NOW". An unbounded observation log is a table
    // that grows forever to answer a question about the present.
    const everythingDown: Fetcher = async () => {
      throw new Error('ECONNREFUSED');
    };
    await runProbeSweep(db, { fetcher: everythingDown, observedBy: 'integration-host' });
    expect((await probeRow(id))?.state).toBe('unreachable');
    const count = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM target_system_probe WHERE registration_id = ${id}
    `;
    expect(count[0]?.n).toBe(1);
  });

  it('does not probe a retired registration', async () => {
    // Retirement is the control that stops a Target System being used. A retired row whose
    // connectivity kept refreshing would read as live.
    const id = await register({
      displayName: `${prefix}retired`,
      allowedOrigins: [UP],
      status: 'retired',
    });
    await runProbeSweep(db, { fetcher, observedBy: 'integration-host' });
    expect(await probeRow(id)).toBeNull();
  });

  it('does not probe a registration with no probeable origin', async () => {
    // A desktop system has an application identity and no origin. Writing "unreachable"
    // would be a claim the probe cannot support.
    const id = await register({
      displayName: `${prefix}desktop`,
      kind: 'desktop',
      allowedOrigins: [],
      applicationIdentity: 'com.northstar.ledgerdesk',
    });
    const result = await runProbeSweep(db, { fetcher, observedBy: 'integration-host' });
    expect(await probeRow(id)).toBeNull();
    expect(result.skipped).toBeGreaterThanOrEqual(1);
  });

  it('discards an observation for a registration that has been removed', async () => {
    // The registration disappearing between the read and the write is normal, not an
    // error: `recordProbe` is one INSERT ... SELECT ... WHERE EXISTS, so the check and the
    // write happen together rather than in two statements that a pool may not even run on
    // one connection.
    const { recordProbe } = await import('@intellifin/infrastructure/probe');
    const written = await recordProbe(db, {
      // A syntactically valid uuid that names nothing.
      registrationId: '00000000-0000-7000-8000-000000000000',
      state: 'reachable',
      observedAt: new Date(),
      observedBy: 'integration-host',
    });
    expect(written).toBe(false);
  });

    it('probes a live system sitting behind more retired ones than a page holds', async () => {
      // The sweep borrowed `listRegistrations`, which is capped at REGISTRATION_LIST_LIMIT
      // and includes retired rows because a person looking at a page wants both. With
      // enough retired registrations ahead of them, every live system fell off the end:
      // the sweep probed nothing, exited 0, and the surface went on saying "Never probed".
      //
      // The retired rows are inserted with raw SQL rather than through the command: this
      // test is about the READ, and 205 audited creates would be a slow way to say so.
      const retiredPrefix = `${prefix}retired-`;
      const values = Array.from({ length: REGISTRATION_LIST_LIMIT + 5 }, (_, index) => index);
      for (const index of values) {
        await sql`
          INSERT INTO target_system_registration
            (registration_id, display_name, kind, allowed_origins, credential_ref,
             permitted_actions, digest, status)
          VALUES (gen_random_uuid(),
                  ${`${retiredPrefix}${String(index).padStart(4, '0')}`},
                  'web', ARRAY[${DOWN}]::text[], 'cred://synthetic/x',
                  ARRAY['navigate']::text[], ${'a'.repeat(64)}, 'retired')
        `;
      }

      // Named so it sorts AFTER every retired row, which is where the page ended.
      const live = await register({
        displayName: `${prefix}zzz-live`,
        allowedOrigins: [UP],
      });

      const result = await runProbeSweep(db, { fetcher, observedBy: 'integration-host' });

      expect((await probeRow(live))?.state).toBe('reachable');
      // And not one retired row was probed: retirement is the control that stops a system
      // being used, and a retired row whose connectivity kept refreshing reads as live.
      expect(result.probed).toBeGreaterThan(0);
      const retiredRows = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count
        FROM target_system_probe p
        JOIN target_system_registration r ON r.registration_id = p.registration_id
        WHERE r.display_name LIKE ${`${retiredPrefix}%`}
      `;
      expect(retiredRows[0]?.count).toBe('0');
    });

});