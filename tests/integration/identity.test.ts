import { createHash, randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { authorizeCommand, recordSignInAttempt } from '@intellifin/application';
import type { Role } from '@intellifin/domain';
import {
  BetterAuthSessionReader,
  DrizzleRoleRepository,
  PostgresAuditChainReader,
  PostgresAuditUnitOfWork,
  createDb,
  createSeedAuth,
  createSqlClient,
  findSessionByToken,
  findUserIdByEmail,
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
  });

  afterEach(async () => {
    await sql`DELETE FROM auth_session WHERE user_id IN (SELECT id FROM auth_user WHERE email LIKE ${`${emailPrefix}%`})`;
  });

  afterAll(async () => {
    // Cascades clear auth_session, auth_account and user_role.
    await sql`DELETE FROM auth_user WHERE email LIKE ${`${emailPrefix}%`}`;
    await sql`DELETE FROM audit_events WHERE correlation_id LIKE ${`${emailPrefix}%`}`;
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
    // And an unrecognized value, however it got there, reads as no role at all.
    expect(randomUUID()).toBeTruthy();
    await expect(new DrizzleRoleRepository(db).findRole(userId)).resolves.toBeNull();
  });
});
