import { createHash } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { authorizeCommand, recordSignInAttempt } from '@intellifin/application';
import type { Role } from '@intellifin/domain';
import {
  BetterAuthSessionReader,
  DrizzleRoleRepository,
  PostgresAuditChainReader,
  PostgresAuditUnitOfWork,
  createAuth,
  createDb,
  createSeedAuth,
  createSqlClient,
  findSessionByToken,
  findUserIdByEmail,
  revokeSessionByToken,
  type Auth,
  type Database,
  type Sql,
} from '@intellifin/infrastructure';

/**
 * Identity and role enforcement against a real, migrated PostgreSQL 18 (FR-1, FR-2, AD-7).
 *
 * Nothing here migrates. The users it creates are namespaced by process id and deleted
 * afterwards; the `platform` audit chain is verified at the end, because these are the
 * first events a real request appends to it.
 */

const databaseUrl = process.env['DATABASE_URL'];
const SECRET = 'integration-test-secret-not-a-real-one';
const BASE_URL = 'http://localhost:3000';
const PASSWORD = 'correct horse battery staple';

const subjectHashOf = (email: string) =>
  createHash('sha256').update(email.trim().toLowerCase(), 'utf8').digest('hex');

describe.skipIf(!databaseUrl)('sign-in, roles, and denial against PostgreSQL 18', () => {
  let sql: Sql;
  let db: Database;
  let auth: Auth;
  const emailPrefix = `story-1-3-${process.pid}-`;
  const emailFor = (label: string) => `${emailPrefix}${label}@synthetic.invalid`;

  async function createUser(label: string, role: Role | null): Promise<string> {
    const email = emailFor(label);
    const created = await auth.api.signUpEmail({
      body: { email, name: `Synthetic ${label}`, password: PASSWORD },
    });
    if (role) {
      await sql`INSERT INTO user_role (user_id, role) VALUES (${created.user.id}, ${role})`;
    }
    return created.user.id;
  }

  /** Sign in through the mounted handler exactly as a browser would. */
  async function signIn(email: string, password: string): Promise<Response> {
    return auth.handler(
      new Request(`${BASE_URL}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      }),
    );
  }

  async function platformEvents(correlationId: string) {
    return sql<
      { event_type: string; outcome: string; actor_id: string; payload: Record<string, unknown> }[]
    >`
      SELECT event_type, outcome, actor_id, payload
      FROM audit_events
      WHERE aggregate_id = 'platform' AND correlation_id = ${correlationId}
      ORDER BY sequence
    `;
  }

  beforeAll(async () => {
    sql = createSqlClient(databaseUrl as string, { max: 5 });
    db = createDb(sql);
    // Sign-up is enabled in this instance only, so the test can make its own users.
    auth = createSeedAuth(db, { secret: SECRET, baseUrl: BASE_URL });
    await sql`DELETE FROM auth_user WHERE email LIKE ${`${emailPrefix}%`}`;
    // A previous run's leftovers would make the chain verification below meaningless.
    await sql`DELETE FROM auth_rate_limit`;
    await sql`DELETE FROM audit_events WHERE aggregate_id = 'platform'`;
    await sql`DELETE FROM audit_event_heads WHERE aggregate_id = 'platform'`;
  });

  afterEach(async () => {
    await sql`DELETE FROM auth_session WHERE user_id IN (SELECT id FROM auth_user WHERE email LIKE ${`${emailPrefix}%`})`;
  });

  afterAll(async () => {
    // Cascades clear auth_session, auth_account, auth_rate_limit is untouched.
    await sql`DELETE FROM auth_user WHERE email LIKE ${`${emailPrefix}%`}`;
    // Delete the head with the events. Removing events but leaving the head behind
    // makes it point past the rows that remain, and the next run of this file fails
    // `verify('platform')` with a sequence mismatch that has nothing to do with the
    // code under test. `audit-events.test.ts` clears both for the same reason.
    await sql`DELETE FROM audit_events WHERE aggregate_id = 'platform'`;
    await sql`DELETE FROM audit_event_heads WHERE aggregate_id = 'platform'`;
    await sql.end({ timeout: 5 });
  });

  it('appends exactly one successful security.sign-in for a correct credential', async () => {
    const userId = await createUser('success', 'auditor');
    const correlationId = `${emailPrefix}success`;
    const response = await signIn(emailFor('success'), PASSWORD);
    expect(response.status).toBe(200);

    const body = (await response.json()) as { token: string };
    const session = await findSessionByToken(db, body.token);
    expect(session?.userId).toBe(userId);

    await recordSignInAttempt(new PostgresAuditUnitOfWork(db), {
      outcome: 'success',
      userId,
      subjectHash: subjectHashOf(emailFor('success')),
      sessionId: session?.sessionId as string,
      correlationId,
    });

    const events = await platformEvents(correlationId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event_type: 'security.sign-in',
      outcome: 'success',
      actor_id: userId,
    });
    // Never the address, and never the credential.
    expect(JSON.stringify(events[0]?.payload)).not.toContain('@synthetic.invalid');
    expect(JSON.stringify(events[0]?.payload)).not.toContain(PASSWORD);
  });

  it('refuses a wrong password without disclosing that the user exists, and audits the failure', async () => {
    const userId = await createUser('wrong-password', 'auditor');
    const correlationId = `${emailPrefix}wrong-password`;

    const known = await signIn(emailFor('wrong-password'), 'a completely wrong password');
    const unknown = await signIn(emailFor('nobody-here'), 'a completely wrong password');
    expect(known.ok).toBe(false);
    expect(unknown.ok).toBe(false);
    // Better Auth answers both identically; the route wrapper rewrites both anyway.
    expect(known.status).toBe(unknown.status);

    expect(await findUserIdByEmail(db, emailFor('wrong-password'))).toBe(userId);
    expect(await findUserIdByEmail(db, emailFor('nobody-here'))).toBeNull();

    await recordSignInAttempt(new PostgresAuditUnitOfWork(db), {
      outcome: 'failure',
      userId,
      subjectHash: subjectHashOf(emailFor('wrong-password')),
      correlationId,
    });

    const events = await platformEvents(correlationId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ outcome: 'failure', actor_id: userId });
  });

  it('records an unknown address as actor "unknown" with only its hash', async () => {
    const correlationId = `${emailPrefix}unknown`;
    const email = emailFor('never-registered');

    await recordSignInAttempt(new PostgresAuditUnitOfWork(db), {
      outcome: 'failure',
      userId: (await findUserIdByEmail(db, email)) ?? undefined,
      subjectHash: subjectHashOf(email),
      correlationId,
    });

    const events = await platformEvents(correlationId);
    expect(events[0]).toMatchObject({ outcome: 'failure', actor_id: 'unknown' });
    expect(events[0]?.payload).toMatchObject({ subjectHash: subjectHashOf(email) });
    expect(JSON.stringify(events[0]?.payload)).not.toContain(email);
  });

  it('resolves the role from user_role rather than from the session', async () => {
    const userId = await createUser('role-lookup', 'poc-administrator');
    const response = await signIn(emailFor('role-lookup'), PASSWORD);
    const cookie = response.headers.get('set-cookie') as string;

    const reader = new BetterAuthSessionReader(auth, new Headers({ cookie }));
    const session = await reader.currentSession();
    expect(session?.userId).toBe(userId);

    await expect(new DrizzleRoleRepository(db).findRole(userId)).resolves.toBe('poc-administrator');
    // Nothing in the session payload carries the role.
    expect(JSON.stringify(session)).not.toContain('poc-administrator');
  });

  it('denies an out-of-role action with the verbatim reason and appends security.denied', async () => {
    const userId = await createUser('denied', 'poc-administrator');
    const correlationId = `${emailPrefix}denied`;
    const response = await signIn(emailFor('denied'), PASSWORD);
    const body = (await response.json()) as { token: string };
    const session = (await findSessionByToken(db, body.token)) as {
      userId: string;
      sessionId: string;
    };

    const outcome = await authorizeCommand(
      {
        roles: new DrizzleRoleRepository(db),
        unitOfWork: new PostgresAuditUnitOfWork(db),
      },
      { session, action: 'procedure.author', correlationId },
    );

    expect(outcome).toEqual({
      allowed: false,
      reason: 'PoC Administrator cannot author Procedures or start Runs.',
      role: 'poc-administrator',
    });

    const events = await platformEvents(correlationId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event_type: 'security.denied',
      outcome: 'denied',
      actor_id: userId,
    });
    expect(events[0]?.payload).toMatchObject({
      action: 'procedure.author',
      role: 'poc-administrator',
      reason: 'PoC Administrator cannot author Procedures or start Runs.',
    });
  });

  it('denies the next request after the role row is deleted, and leaves the session alive', async () => {
    const userId = await createUser('revoked', 'poc-administrator');
    const correlationId = `${emailPrefix}revoked`;
    const response = await signIn(emailFor('revoked'), PASSWORD);
    const cookie = response.headers.get('set-cookie') as string;
    const body = (await response.json()) as { token: string };
    const session = (await findSessionByToken(db, body.token)) as {
      userId: string;
      sessionId: string;
    };

    const dependencies = {
      roles: new DrizzleRoleRepository(db),
      unitOfWork: new PostgresAuditUnitOfWork(db),
    };
    await expect(
      authorizeCommand(dependencies, {
        session,
        action: 'administration.users.manage',
        correlationId: `${correlationId}-before`,
      }),
    ).resolves.toMatchObject({ allowed: true, role: 'poc-administrator' });

    await sql`DELETE FROM user_role WHERE user_id = ${userId}`;

    await expect(
      authorizeCommand(dependencies, {
        session,
        action: 'administration.users.manage',
        correlationId,
      }),
    ).resolves.toEqual({
      allowed: false,
      reason: 'Your role does not permit this action.',
      role: null,
    });

    // The session itself survives: revocation blocks new actions, it does not sign out.
    const rows = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM auth_session WHERE id = ${session.sessionId}
    `;
    expect(rows[0]?.count).toBe(1);
    const stillSignedIn = await new BetterAuthSessionReader(
      auth,
      new Headers({ cookie }),
    ).currentSession();
    expect(stillSignedIn?.userId).toBe(userId);

    const events = await platformEvents(correlationId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ event_type: 'security.denied', outcome: 'denied' });
  });

  it('leaves the platform chain verifiable after every event this suite appended', async () => {
    const result = await new PostgresAuditChainReader(db).verify('platform');
    expect(result.valid).toBe(true);
  });

  it('rejects a role value outside the vocabulary at the database', async () => {
    const userId = await createUser('bad-role', null);
    await expect(
      sql`INSERT INTO user_role (user_id, role) VALUES (${userId}, ${'superuser'})`,
    ).rejects.toThrow(/user_role_role_vocabulary/);
    // The row was refused, so there is none: this is the missing-row path.
    await expect(new DrizzleRoleRepository(db).findRole(userId)).resolves.toBeNull();
  });

  it('reads an unrecognized stored role as no role at all', async () => {
    // The check constraint above is the first defence. This is the second: if a value
    // outside the vocabulary ever reaches the column -- an older constraint, a manual
    // fix, a future migration -- `findRole` must fail CLOSED rather than hand back a
    // string the policy has never heard of. Dropping the constraint for the length of
    // this test is the only way to execute that guard against a real row.
    const userId = await createUser('smuggled-role', null);
    await sql`ALTER TABLE user_role DROP CONSTRAINT user_role_role_vocabulary`;
    try {
      await sql`INSERT INTO user_role (user_id, role) VALUES (${userId}, ${'superuser'})`;
      await expect(new DrizzleRoleRepository(db).findRole(userId)).resolves.toBeNull();

      // And the row really is there -- the null above is the guard, not an empty table.
      const rows = await sql<{ role: string }[]>`
        SELECT role FROM user_role WHERE user_id = ${userId}
      `;
      expect(rows[0]?.role).toBe('superuser');
    } finally {
      await sql`DELETE FROM user_role WHERE user_id = ${userId}`;
      await sql`
        ALTER TABLE user_role ADD CONSTRAINT user_role_role_vocabulary
        CHECK (role IN ('auditor', 'audit-manager', 'poc-administrator'))
      `;
    }
  });

  it('revokes a session by its token against the real column', async () => {
    // `revokeSessionByToken` is the fail-closed path for a sign-in that could not be
    // audited. Deleting by the wrong column would satisfy every mock and leave the
    // session live, so it is run here against the database it will run against.
    await createUser('revoke-by-token', 'auditor');
    const response = await signIn(emailFor('revoke-by-token'), PASSWORD);
    const body = (await response.json()) as { token: string };
    const before = await findSessionByToken(db, body.token);
    expect(before).not.toBeNull();

    await revokeSessionByToken(db, body.token);

    await expect(findSessionByToken(db, body.token)).resolves.toBeNull();
    const rows = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM auth_session WHERE id = ${before?.sessionId as string}
    `;
    expect(rows[0]?.count).toBe(0);
  });

  it('revoking one session leaves every other session alone', async () => {
    await createUser('revoke-scope', 'auditor');
    const first = (await (await signIn(emailFor('revoke-scope'), PASSWORD)).json()) as {
      token: string;
    };
    const second = (await (await signIn(emailFor('revoke-scope'), PASSWORD)).json()) as {
      token: string;
    };
    expect(first.token).not.toBe(second.token);

    await revokeSessionByToken(db, first.token);

    await expect(findSessionByToken(db, first.token)).resolves.toBeNull();
    await expect(findSessionByToken(db, second.token)).resolves.not.toBeNull();
  });
});

/**
 * The production Better Auth instance, which no other test constructs.
 *
 * Every case above builds `createSeedAuth`, where sign-up is ENABLED so the suite can
 * make its own users. That means inverting `disableSignUp` on `createAuth` would ship
 * anonymous self-registration on a publicly allowlisted path and the whole suite would
 * still be green. This block builds the real one and asks it directly.
 */
describe.skipIf(!databaseUrl)('the deployed Better Auth instance', () => {
  let sql: Sql;
  let db: Database;
  const email = `story-1-3-signup-${process.pid}@synthetic.invalid`;

  const signUp = (auth: Auth) =>
    auth.handler(
      new Request(`${BASE_URL}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, name: 'Uninvited Person', password: PASSWORD }),
      }),
    );

  beforeAll(() => {
    sql = createSqlClient(databaseUrl as string, { max: 2 });
    db = createDb(sql);
  });

  afterAll(async () => {
    await sql`DELETE FROM auth_user WHERE email = ${email}`;
    await sql`DELETE FROM auth_rate_limit`;
    await sql.end({ timeout: 5 });
  });

  it('refuses self-registration', async () => {
    const auth = createAuth(db, { secret: SECRET, baseUrl: BASE_URL });

    const response = await signUp(auth);

    expect(response.ok).toBe(false);
    // And no user was created behind the refusal.
    await expect(findUserIdByEmail(db, email)).resolves.toBeNull();
  });

  it('has no role field on its user model, so a role can never come from the session', async () => {
    const auth = createAuth(db, { secret: SECRET, baseUrl: BASE_URL });
    const columns = await sql<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'auth_user'
      ORDER BY column_name
    `;
    expect(columns.map((row) => row.column_name)).not.toContain('role');
    expect(auth.options.user?.modelName).toBe('auth_user');
  });

  it('is the seed instance, and only the seed instance, that can create a user', async () => {
    const seed = createSeedAuth(db, { secret: SECRET, baseUrl: BASE_URL });

    const response = await signUp(seed);

    expect(response.ok).toBe(true);
    await expect(findUserIdByEmail(db, email)).resolves.not.toBeNull();
  });
});
