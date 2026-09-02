import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createUserWithRole,
  setUserRole,
  signOut,
  type ManageUsersDependencies,
  type SessionSnapshot,
} from '@intellifin/application';
import type { Role } from '@intellifin/domain';
import {
  BetterAuthSessionReader,
  DrizzleRoleRepository,
  DrizzleUserDirectory,
  PostgresAuditChainReader,
  PostgresIdentityUnitOfWork,
  createAuth,
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
 * Managing users and roles against a real, migrated PostgreSQL 18 (FR-2, FR-7, FR-45).
 *
 * Everything here is about a promise that only a real transaction can keep: the account,
 * the role and the audit event commit together or not at all. A fake unit of work can be
 * written to behave that way; PostgreSQL either does or does not.
 *
 * Nothing here migrates. Accounts are namespaced by process id and deleted afterwards,
 * and the `platform` chain is verified at the end.
 */

const databaseUrl = process.env['DATABASE_URL'];
const SECRET = 'integration-test-secret-not-a-real-one';
const BASE_URL = 'http://localhost:3000';
const PASSWORD = 'correct horse battery staple';
const AUTH_CONFIG = { secret: SECRET, baseUrl: BASE_URL };

describe.skipIf(!databaseUrl)('manage users against PostgreSQL 18', () => {
  let sql: Sql;
  let db: Database;
  let seedAuth: Auth;
  const emailPrefix = `story-1-5-${process.pid}-`;
  const emailFor = (label: string) => `${emailPrefix}${label}@synthetic.invalid`;

  /** The acting administrator, and a live session for them. */
  let admin: SessionSnapshot;

  function dependencies(overrides: { failIds?: boolean } = {}): ManageUsersDependencies {
    return {
      roles: new DrizzleRoleRepository(db),
      users: new DrizzleUserDirectory(db),
      unitOfWork: new PostgresIdentityUnitOfWork(
        db,
        AUTH_CONFIG,
        // An id generator that produces something the canonical envelope rejects. The
        // append therefore throws AFTER the state write inside the same transaction,
        // which is exactly the ordering the atomicity claim is about.
        overrides.failIds ? { ids: { next: () => 'not-a-uuid-v7' } } : {},
      ),
    };
  }

  async function eventsFor(correlationId: string) {
    return sql<
      {
        event_type: string;
        outcome: string;
        actor_id: string;
        session_id: string;
        payload: Record<string, unknown>;
      }[]
    >`
      SELECT event_type, outcome, actor_id, session_id, payload
      FROM audit_events
      WHERE correlation_id = ${correlationId}
      ORDER BY sequence
    `;
  }

  async function roleOf(userId: string): Promise<Role | null> {
    return new DrizzleRoleRepository(db).findRole(userId);
  }

  async function signIn(email: string): Promise<{ token: string; cookie: string }> {
    const response = await seedAuth.handler(
      new Request(`${BASE_URL}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: PASSWORD }),
      }),
    );
    const body = (await response.json()) as { token: string };
    return { token: body.token, cookie: response.headers.get('set-cookie') as string };
  }

  beforeAll(async () => {
    sql = createSqlClient(databaseUrl as string, { max: 5 });
    db = createDb(sql);
    seedAuth = createSeedAuth(db, AUTH_CONFIG);

    await sql`DELETE FROM auth_user WHERE email LIKE ${`${emailPrefix}%`}`;
    await sql`DELETE FROM auth_rate_limit`;
    await sql`DELETE FROM audit_events WHERE aggregate_id = 'platform'`;
    await sql`DELETE FROM audit_event_heads WHERE aggregate_id = 'platform'`;

    const created = await seedAuth.api.signUpEmail({
      body: { email: emailFor('admin'), name: 'Synthetic Administrator', password: PASSWORD },
    });
    await sql`INSERT INTO user_role (user_id, role) VALUES (${created.user.id}, 'poc-administrator')`;
    const session = await findSessionByToken(db, (await signIn(emailFor('admin'))).token);
    admin = session as SessionSnapshot;
  });

  afterAll(async () => {
    await sql`DELETE FROM auth_user WHERE email LIKE ${`${emailPrefix}%`}`;
    await sql`DELETE FROM audit_events WHERE aggregate_id = 'platform'`;
    await sql`DELETE FROM audit_event_heads WHERE aggregate_id = 'platform'`;
    await sql.end({ timeout: 5 });
  });

  it('creates the account, the role and exactly one event in one transaction', async () => {
    const correlationId = `${emailPrefix}create`;

    const outcome = await createUserWithRole(dependencies(), {
      session: admin,
      correlationId,
      email: emailFor('created'),
      name: 'Synthetic Created',
      password: PASSWORD,
      role: 'auditor',
    });

    expect(outcome.ok).toBe(true);
    const userId = outcome.ok ? outcome.userId : '';
    expect(await findUserIdByEmail(db, emailFor('created'))).toBe(userId);
    expect(await roleOf(userId)).toBe('auditor');

    const events = await eventsFor(correlationId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event_type: 'configuration.user-created',
      outcome: 'success',
      actor_id: admin.userId,
      session_id: admin.sessionId,
    });
    expect(events[0]?.payload).toEqual({
      subjectUserId: userId,
      priorRole: null,
      newRole: 'auditor',
    });
    // Never the address, never the credential.
    const serialized = JSON.stringify(events[0]?.payload);
    expect(serialized).not.toContain('@synthetic.invalid');
    expect(serialized).not.toContain(PASSWORD);

    // And the acting administrator is recorded on the assignment itself.
    const rows = await sql<{ assigned_by: string | null }[]>`
      SELECT assigned_by FROM user_role WHERE user_id = ${userId}
    `;
    expect(rows[0]?.assigned_by).toBe(admin.userId);
  });

  it('refuses a duplicate address, leaving the existing account untouched and no event', async () => {
    const correlationId = `${emailPrefix}duplicate`;
    const before = await findUserIdByEmail(db, emailFor('created'));
    expect(before).not.toBeNull();

    const outcome = await createUserWithRole(dependencies(), {
      session: admin,
      correlationId,
      email: emailFor('created'),
      name: 'Somebody Else',
      password: PASSWORD,
      role: 'poc-administrator',
    });

    expect(outcome).toEqual({
      ok: false,
      reason: 'That email address already has an account.',
    });
    // The same one account, the same role, and nothing appended.
    const count = await sql<{ c: number }[]>`
      SELECT count(*)::int AS c FROM auth_user WHERE email = ${emailFor('created')}
    `;
    expect(count[0]?.c).toBe(1);
    expect(await roleOf(before as string)).toBe('auditor');
    await expect(eventsFor(correlationId)).resolves.toHaveLength(0);
  });

  it('changes a role, recording the prior and the new value', async () => {
    const correlationId = `${emailPrefix}change`;
    const userId = (await findUserIdByEmail(db, emailFor('created'))) as string;

    const outcome = await setUserRole(dependencies(), {
      session: admin,
      correlationId,
      userId,
      role: 'audit-manager',
    });

    expect(outcome).toMatchObject({ ok: true, priorRole: 'auditor', newRole: 'audit-manager' });
    expect(await roleOf(userId)).toBe('audit-manager');

    const events = await eventsFor(correlationId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event_type: 'configuration.role-changed',
      outcome: 'success',
      actor_id: admin.userId,
    });
    expect(events[0]?.payload).toEqual({
      subjectUserId: userId,
      priorRole: 'auditor',
      newRole: 'audit-manager',
    });
  });

  it('clears a role, keeping the account and its sessions, and records newRole null', async () => {
    const correlationId = `${emailPrefix}clear`;
    const userId = (await findUserIdByEmail(db, emailFor('created'))) as string;
    const { token } = await signIn(emailFor('created'));
    const session = await findSessionByToken(db, token);
    expect(session).not.toBeNull();

    const outcome = await setUserRole(dependencies(), {
      session: admin,
      correlationId,
      userId,
      role: null,
    });

    expect(outcome).toMatchObject({ ok: true, priorRole: 'audit-manager', newRole: null });
    expect(await roleOf(userId)).toBeNull();
    const events = await eventsFor(correlationId);
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toEqual({
      subjectUserId: userId,
      priorRole: 'audit-manager',
      newRole: null,
    });

    // The account survives, and so does the session it already held.
    expect(await findUserIdByEmail(db, emailFor('created'))).toBe(userId);
    await expect(findSessionByToken(db, token)).resolves.not.toBeNull();
  });

  it('takes effect on the subject next request without ending their session', async () => {
    const correlationId = `${emailPrefix}live-session`;
    const created = await createUserWithRole(dependencies(), {
      session: admin,
      correlationId: `${correlationId}-setup`,
      email: emailFor('live'),
      name: 'Synthetic Live',
      password: PASSWORD,
      role: 'auditor',
    });
    const userId = created.ok ? created.userId : '';

    // A live session, resolved exactly as a request would resolve it.
    const { cookie } = await signIn(emailFor('live'));
    const reader = new BetterAuthSessionReader(
      createAuth(db, AUTH_CONFIG),
      new Headers({ cookie }),
    );
    const before = await reader.currentSession();
    expect(before?.userId).toBe(userId);
    expect(await roleOf(userId)).toBe('auditor');

    await setUserRole(dependencies(), {
      session: admin,
      correlationId,
      userId,
      role: 'poc-administrator',
    });

    // The very next resolution sees the new role, and the same session is still valid.
    const after = await reader.currentSession();
    expect(after?.sessionId).toBe(before?.sessionId);
    expect(await roleOf(userId)).toBe('poc-administrator');
    const rows = await sql<{ c: number }[]>`
      SELECT count(*)::int AS c FROM auth_session WHERE id = ${before?.sessionId as string}
    `;
    expect(rows[0]?.c).toBe(1);
  });

  it('leaves user_role unchanged when the audit append fails', async () => {
    const correlationId = `${emailPrefix}append-fails`;
    const userId = (await findUserIdByEmail(db, emailFor('live'))) as string;
    expect(await roleOf(userId)).toBe('poc-administrator');

    await expect(
      setUserRole(dependencies({ failIds: true }), {
        session: admin,
        correlationId,
        userId,
        role: 'auditor',
      }),
    ).rejects.toThrow();

    // The write happened before the append inside the same transaction, and it is gone.
    expect(await roleOf(userId)).toBe('poc-administrator');
    await expect(eventsFor(correlationId)).resolves.toHaveLength(0);
  });

  it('creates no account when the audit append fails', async () => {
    const correlationId = `${emailPrefix}create-append-fails`;

    await expect(
      createUserWithRole(dependencies({ failIds: true }), {
        session: admin,
        correlationId,
        email: emailFor('never-created'),
        name: 'Never Created',
        password: PASSWORD,
        role: 'auditor',
      }),
    ).rejects.toThrow();

    // Better Auth wrote the user and the account row inside the transaction, so the
    // rollback removed them. This is the case a non-transactional creator would fail.
    await expect(findUserIdByEmail(db, emailFor('never-created'))).resolves.toBeNull();
    await expect(eventsFor(correlationId)).resolves.toHaveLength(0);
  });

  it('refuses an Auditor and appends security.denied instead', async () => {
    const correlationId = `${emailPrefix}denied`;
    const auditor = await seedAuth.api.signUpEmail({
      body: { email: emailFor('auditor'), name: 'Synthetic Auditor', password: PASSWORD },
    });
    await sql`INSERT INTO user_role (user_id, role) VALUES (${auditor.user.id}, 'auditor')`;
    const session = (await findSessionByToken(
      db,
      (await signIn(emailFor('auditor'))).token,
    )) as SessionSnapshot;

    const outcome = await createUserWithRole(dependencies(), {
      session,
      correlationId,
      email: emailFor('should-not-exist'),
      name: 'Should Not Exist',
      password: PASSWORD,
      role: 'poc-administrator',
    });

    expect(outcome).toEqual({ ok: false, reason: 'Your role does not permit this action.' });
    await expect(findUserIdByEmail(db, emailFor('should-not-exist'))).resolves.toBeNull();

    const events = await eventsFor(correlationId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event_type: 'security.denied',
      outcome: 'denied',
      actor_id: session.userId,
    });
    expect(events[0]?.payload).toMatchObject({ action: 'administration.users.manage' });
  });

  it('ends a session and appends security.sign-out in one transaction', async () => {
    const correlationId = `${emailPrefix}sign-out`;
    const userId = (await findUserIdByEmail(db, emailFor('auditor'))) as string;
    const { token } = await signIn(emailFor('auditor'));
    const session = (await findSessionByToken(db, token)) as SessionSnapshot;

    await signOut(new PostgresIdentityUnitOfWork(db, AUTH_CONFIG), {
      userId,
      sessionId: session.sessionId,
      correlationId,
    });

    await expect(findSessionByToken(db, token)).resolves.toBeNull();
    const events = await eventsFor(correlationId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event_type: 'security.sign-out',
      outcome: 'success',
      actor_id: userId,
      session_id: session.sessionId,
    });
  });

  it('keeps the session alive when the sign-out event cannot be appended', async () => {
    const correlationId = `${emailPrefix}sign-out-fails`;
    const userId = (await findUserIdByEmail(db, emailFor('auditor'))) as string;
    const { token } = await signIn(emailFor('auditor'));
    const session = (await findSessionByToken(db, token)) as SessionSnapshot;

    await expect(
      signOut(new PostgresIdentityUnitOfWork(db, AUTH_CONFIG, { ids: { next: () => 'nope' } }), {
        userId,
        sessionId: session.sessionId,
        correlationId,
      }),
    ).rejects.toThrow();

    // Still signed in, and still attributable — which is the fail-closed outcome.
    await expect(findSessionByToken(db, token)).resolves.not.toBeNull();
  });

  it('lists users with their role and nothing that could be a credential', async () => {
    const users = await new DrizzleUserDirectory(db).listUsers();
    const mine = users.filter((user) => user.email.startsWith(emailPrefix));
    expect(mine.length).toBeGreaterThanOrEqual(3);
    expect(mine.map((user) => user.email)).toContain(emailFor('admin'));
    expect(mine.find((user) => user.email === emailFor('admin'))?.role).toBe('poc-administrator');
    // The shape is the guard: a field that could carry a hash cannot be added by accident.
    for (const user of mine) {
      expect(Object.keys(user).sort()).toEqual([
        'createdAt',
        'email',
        'name',
        'role',
        'userId',
      ]);
    }
  });

  it('leaves the platform chain verifiable after every event this suite appended', async () => {
    const result = await new PostgresAuditChainReader(db).verify('platform');
    expect(result.valid).toBe(true);
  });
});

/**
 * The publicly mounted instance still refuses self-registration.
 *
 * This story gives an administration command the privileged, sign-up-capable Better Auth
 * instance server-side. That capability is only safe while the MOUNTED instance keeps
 * refusing anonymous account creation, so the guarantee is re-asserted here against
 * `createAuth` directly rather than being assumed to have survived the change.
 */
describe.skipIf(!databaseUrl)('the mounted Better Auth instance after Story 1.5', () => {
  let sql: Sql;
  let db: Database;
  const email = `story-1-5-signup-${process.pid}@synthetic.invalid`;

  beforeAll(() => {
    sql = createSqlClient(databaseUrl as string, { max: 2 });
    db = createDb(sql);
  });

  afterAll(async () => {
    await sql`DELETE FROM auth_user WHERE email = ${email}`;
    await sql`DELETE FROM auth_rate_limit`;
    await sql.end({ timeout: 5 });
  });

  it('refuses POST /api/auth/sign-up/email and creates nothing', async () => {
    const auth = createAuth(db, AUTH_CONFIG);

    const response = await auth.handler(
      new Request(`${BASE_URL}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, name: 'Uninvited Person', password: PASSWORD }),
      }),
    );

    expect(response.ok).toBe(false);
    await expect(findUserIdByEmail(db, email)).resolves.toBeNull();
  });
});
