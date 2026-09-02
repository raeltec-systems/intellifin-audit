import { describe, expect, it } from 'vitest';

import type { AuditEventDraft, Role } from '@intellifin/domain';

import type { AuditUnitOfWork } from '../audit/ports.js';
import {
  MANAGE_USERS_REFUSALS,
  ROLE_CHANGED_EVENT,
  USER_CREATED_EVENT,
  createUserWithRole,
  setUserRole,
} from './manage-users.js';
import type {
  IdentityUnitOfWorkContext,
  ManagedUser,
  RoleRepository,
  SessionSnapshot,
  UserDirectory,
} from './ports.js';

/**
 * The two administration commands, against fakes.
 *
 * The fakes model the one property the real adapters guarantee and nothing else: the
 * unit of work is a transaction, so a throw inside it discards every write made inside
 * it. That is what makes "a failing append leaves the role unchanged" testable here
 * rather than only against PostgreSQL — and the integration suite then proves the real
 * adapter keeps the same promise.
 */

const ADMIN: SessionSnapshot = { userId: 'admin-1', sessionId: 'session-1' };
const CORRELATION = 'corr-1';

interface WorldOptions {
  /** The ACTOR's role. `poc-administrator` unless a case is about a refusal. */
  readonly actorRole?: Role | null;
  /** Existing accounts, keyed by user id. */
  readonly users?: Record<string, { name: string; email: string; role: Role | null }>;
  /** Throw from `auditEvents.append`, to prove the transaction discards the write. */
  readonly failAppend?: boolean;
  /** Refuse account creation, as a duplicate address does. */
  readonly refuseCreate?: string;
}

/**
 * One in-memory world: the role table, the account table, the appended events, and a
 * unit of work that rolls all three back when its callback throws.
 */
function world(options: WorldOptions = {}) {
  const roles = new Map<string, Role>();
  const accounts = new Map<string, { name: string; email: string }>();
  for (const [userId, user] of Object.entries(options.users ?? {})) {
    accounts.set(userId, { name: user.name, email: user.email });
    if (user.role) roles.set(userId, user.role);
  }
  const actorRole = options.actorRole === undefined ? 'poc-administrator' : options.actorRole;
  // The acting administrator is a `user_role` row like everybody else — which is what
  // makes the last-administrator count mean anything. Putting the actor's role in a
  // separate field would leave the fake counting zero administrators while one is signed
  // in and acting, and the guard would fire on every test.
  accounts.set(ADMIN.userId, { name: 'The Administrator', email: 'admin@synthetic.invalid' });
  if (actorRole !== null) roles.set(ADMIN.userId, actorRole);
  const events: AuditEventDraft[] = [];
  /** Which roles were locked, and in what order — the last-administrator guard's proof. */
  const locked: string[] = [];
  let created = 0;

  const roleRepository: RoleRepository = {
    findRole: (userId) => Promise.resolve(roles.get(userId) ?? null),
  };

  const directory: UserDirectory = {
    listUsers: () => Promise.resolve([] as readonly ManagedUser[]),
    findUser: (userId) => {
      const account = accounts.get(userId);
      return Promise.resolve(
        account
          ? {
              userId,
              name: account.name,
              email: account.email,
              role: roles.get(userId) ?? null,
              createdAt: '2026-01-01T00:00:00.000Z',
            }
          : null,
      );
    },
  };

  const unitOfWork: AuditUnitOfWork<IdentityUnitOfWorkContext> = {
    async execute(work) {
      // The snapshot IS the transaction: restored on a throw, kept on a return.
      const rolesBefore = new Map(roles);
      const accountsBefore = new Map(accounts);
      const eventsBefore = events.length;
      try {
        return await work({
          auditEvents: {
            append: (draft) => {
              if (options.failAppend) throw new Error('append failed');
              events.push(draft);
              return Promise.resolve({} as never);
            },
          },
          roles: {
            findRole: (userId) => Promise.resolve(roles.get(userId) ?? null),
            setRole: ({ userId, role }) => {
              roles.set(userId, role);
              return Promise.resolve();
            },
            clearRole: (userId) => {
              roles.delete(userId);
              return Promise.resolve();
            },
            lockHolders: (role) => {
              locked.push(role);
              return Promise.resolve(
                [...roles.entries()]
                  .filter(([, held]) => held === role)
                  .map(([userId]) => userId)
                  .sort(),
              );
            },
            countHolders: (role) =>
              Promise.resolve([...roles.values()].filter((held) => held === role).length),
          },
          users: {
            createUser: ({ email, name }) => {
              if (options.refuseCreate !== undefined) {
                return Promise.resolve({ created: false, reason: options.refuseCreate });
              }
              created += 1;
              const userId = `new-${created}`;
              accounts.set(userId, { name, email });
              return Promise.resolve({ created: true, userId });
            },
          },
          sessions: { revokeSession: () => Promise.resolve() },
        });
      } catch (error) {
        roles.clear();
        for (const [key, value] of rolesBefore) roles.set(key, value);
        accounts.clear();
        for (const [key, value] of accountsBefore) accounts.set(key, value);
        events.length = eventsBefore;
        throw error;
      }
    },
  };

  return {
    roles,
    accounts,
    events,
    locked,
    dependencies: { roles: roleRepository, users: directory, unitOfWork },
  };
}

const NEW_USER = {
  email: 'dana@synthetic.invalid',
  name: 'Dana Okoro',
  password: 'a-long-enough-password',
} as const;

describe('createUserWithRole', () => {
  it('creates the account, assigns the role, and appends one event with priorRole null', async () => {
    const scene = world();

    const outcome = await createUserWithRole(scene.dependencies, {
      session: ADMIN,
      correlationId: CORRELATION,
      ...NEW_USER,
      role: 'auditor',
    });

    expect(outcome).toEqual({ ok: true, userId: 'new-1', role: 'auditor' });
    expect(scene.roles.get('new-1')).toBe('auditor');
    expect(scene.events).toHaveLength(1);
    expect(scene.events[0]).toMatchObject({
      actor: { type: 'human', id: ADMIN.userId },
      eventType: USER_CREATED_EVENT,
      outcome: 'success',
      sessionId: ADMIN.sessionId,
      correlationId: CORRELATION,
      payload: { subjectUserId: 'new-1', priorRole: null, newRole: 'auditor' },
    });
  });

  it('never puts the password or the address in the event', async () => {
    const scene = world();

    await createUserWithRole(scene.dependencies, {
      session: ADMIN,
      correlationId: CORRELATION,
      ...NEW_USER,
      role: 'auditor',
    });

    const serialized = JSON.stringify(scene.events[0]);
    expect(serialized).not.toContain(NEW_USER.password);
    expect(serialized).not.toContain(NEW_USER.email);
  });

  it('refuses a duplicate address without creating an account or an event', async () => {
    const scene = world({ refuseCreate: MANAGE_USERS_REFUSALS.DUPLICATE_EMAIL });

    const outcome = await createUserWithRole(scene.dependencies, {
      session: ADMIN,
      correlationId: CORRELATION,
      ...NEW_USER,
      role: 'auditor',
    });

    expect(outcome).toEqual({ ok: false, reason: MANAGE_USERS_REFUSALS.DUPLICATE_EMAIL });
    expect(scene.accounts.has('new-1')).toBe(false);
    expect(scene.events).toHaveLength(0);
  });

  it('leaves the account and the role unwritten when the append fails', async () => {
    const scene = world({ failAppend: true });

    await expect(
      createUserWithRole(scene.dependencies, {
        session: ADMIN,
        correlationId: CORRELATION,
        ...NEW_USER,
        role: 'auditor',
      }),
    ).rejects.toThrow('append failed');

    expect(scene.accounts.has('new-1')).toBe(false);
    expect(scene.roles.has('new-1')).toBe(false);
    expect(scene.events).toHaveLength(0);
  });

  it('refuses an Auditor before it reads the input, and writes nothing', async () => {
    const scene = world({ actorRole: 'auditor' });

    const outcome = await createUserWithRole(scene.dependencies, {
      session: ADMIN,
      correlationId: CORRELATION,
      email: '',
      name: '',
      password: '',
      role: 'auditor',
    });

    // The denial reason, not "enter an email address": the caller learns that they may
    // not act, never which of their fields was wrong.
    expect(outcome).toEqual({ ok: false, reason: 'Your role does not permit this action.' });
    expect(scene.accounts.has('new-1')).toBe(false);
    // The refusal itself IS audited — `authorizeCommand` appends `security.denied`.
    expect(scene.events).toHaveLength(1);
    expect(scene.events[0]).toMatchObject({ eventType: 'security.denied', outcome: 'denied' });
  });

  it('refuses a signed-in caller with no role at all', async () => {
    const scene = world({ actorRole: null });

    const outcome = await createUserWithRole(scene.dependencies, {
      session: ADMIN,
      correlationId: CORRELATION,
      ...NEW_USER,
      role: 'auditor',
    });

    expect(outcome).toEqual({ ok: false, reason: 'Your role does not permit this action.' });
    expect(scene.accounts.has('new-1')).toBe(false);
  });

  it.each([
    [{ email: '  ' }, MANAGE_USERS_REFUSALS.EMAIL_REQUIRED],
    [{ email: 'not-an-address' }, MANAGE_USERS_REFUSALS.EMAIL_INVALID],
    [{ email: 'two@@at.invalid' }, MANAGE_USERS_REFUSALS.EMAIL_INVALID],
    [{ name: '   ' }, MANAGE_USERS_REFUSALS.NAME_REQUIRED],
    [{ password: 'short' }, MANAGE_USERS_REFUSALS.PASSWORD_TOO_SHORT],
    [{ role: 'superuser' as Role }, MANAGE_USERS_REFUSALS.ROLE_INVALID],
  ])('refuses %j with a stated reason and writes nothing', async (override, reason) => {
    const scene = world();

    const outcome = await createUserWithRole(scene.dependencies, {
      session: ADMIN,
      correlationId: CORRELATION,
      ...NEW_USER,
      role: 'auditor',
      ...override,
    });

    expect(outcome).toEqual({ ok: false, reason });
    expect(scene.accounts.has('new-1')).toBe(false);
    expect(scene.events).toHaveLength(0);
  });
});

describe('setUserRole', () => {
  const SUBJECT = {
    'user-2': { name: 'Ravi Patel', email: 'ravi@synthetic.invalid', role: 'auditor' as Role },
  };

  it('records the prior role and the new one', async () => {
    const scene = world({ users: SUBJECT });

    const outcome = await setUserRole(scene.dependencies, {
      session: ADMIN,
      correlationId: CORRELATION,
      userId: 'user-2',
      role: 'audit-manager',
    });

    expect(outcome).toEqual({
      ok: true,
      userId: 'user-2',
      priorRole: 'auditor',
      newRole: 'audit-manager',
    });
    expect(scene.roles.get('user-2')).toBe('audit-manager');
    expect(scene.events).toHaveLength(1);
    expect(scene.events[0]).toMatchObject({
      actor: { type: 'human', id: ADMIN.userId },
      eventType: ROLE_CHANGED_EVENT,
      outcome: 'success',
      payload: { subjectUserId: 'user-2', priorRole: 'auditor', newRole: 'audit-manager' },
    });
  });

  it('records newRole null when the role is removed, and keeps the account', async () => {
    const scene = world({ users: SUBJECT });

    const outcome = await setUserRole(scene.dependencies, {
      session: ADMIN,
      correlationId: CORRELATION,
      userId: 'user-2',
      role: null,
    });

    expect(outcome).toMatchObject({ ok: true, priorRole: 'auditor', newRole: null });
    expect(scene.roles.has('user-2')).toBe(false);
    expect(scene.accounts.has('user-2')).toBe(true);
    expect(scene.events[0]?.payload).toEqual({
      subjectUserId: 'user-2',
      priorRole: 'auditor',
      newRole: null,
    });
  });

  it('records priorRole null for a first assignment', async () => {
    const scene = world({
      users: { 'user-3': { name: 'No Role', email: 'none@synthetic.invalid', role: null } },
    });

    const outcome = await setUserRole(scene.dependencies, {
      session: ADMIN,
      correlationId: CORRELATION,
      userId: 'user-3',
      role: 'auditor',
    });

    expect(outcome).toMatchObject({ ok: true, priorRole: null, newRole: 'auditor' });
    expect(scene.events[0]?.payload).toEqual({
      subjectUserId: 'user-3',
      priorRole: null,
      newRole: 'auditor',
    });
  });

  it('leaves the role unchanged when the append fails', async () => {
    const scene = world({ users: SUBJECT, failAppend: true });

    await expect(
      setUserRole(scene.dependencies, {
        session: ADMIN,
        correlationId: CORRELATION,
        userId: 'user-2',
        role: 'poc-administrator',
      }),
    ).rejects.toThrow('append failed');

    expect(scene.roles.get('user-2')).toBe('auditor');
    expect(scene.events).toHaveLength(0);
  });

  it('refuses an unknown subject', async () => {
    const scene = world({ users: SUBJECT });

    const outcome = await setUserRole(scene.dependencies, {
      session: ADMIN,
      correlationId: CORRELATION,
      userId: 'nobody',
      role: 'auditor',
    });

    expect(outcome).toEqual({ ok: false, reason: MANAGE_USERS_REFUSALS.UNKNOWN_USER });
    expect(scene.events).toHaveLength(0);
  });

  it('refuses an Auditor, audits the refusal, and changes nothing', async () => {
    const scene = world({ actorRole: 'auditor', users: SUBJECT });

    const outcome = await setUserRole(scene.dependencies, {
      session: ADMIN,
      correlationId: CORRELATION,
      userId: 'user-2',
      role: 'poc-administrator',
    });

    expect(outcome).toEqual({ ok: false, reason: 'Your role does not permit this action.' });
    expect(scene.roles.get('user-2')).toBe('auditor');
    expect(scene.events).toHaveLength(1);
    expect(scene.events[0]).toMatchObject({ eventType: 'security.denied', outcome: 'denied' });
  });

  it('refuses a no-op without writing or appending anything', async () => {
    const scene = world({ users: SUBJECT });

    const outcome = await setUserRole(scene.dependencies, {
      session: ADMIN,
      correlationId: CORRELATION,
      userId: 'user-2',
      role: 'auditor',
      expectedRole: 'auditor',
    });

    // Success, because the requested state is the state — but no event, because no
    // transition happened and the chain records transitions. The disabled button in the
    // interface is a courtesy; this is the control.
    expect(outcome).toMatchObject({ ok: true, priorRole: 'auditor', newRole: 'auditor' });
    expect(scene.events).toHaveLength(0);
  });

  it('refuses a change whose expected prior value is stale', async () => {
    const scene = world({ users: SUBJECT });

    const outcome = await setUserRole(scene.dependencies, {
      session: ADMIN,
      correlationId: CORRELATION,
      userId: 'user-2',
      role: 'poc-administrator',
      // The page was rendered when they held no role; somebody has made them an Auditor
      // since. Blind-overwriting would append an event claiming a transition from a
      // value this administrator never saw.
      expectedRole: null,
    });

    expect(outcome).toEqual({ ok: false, reason: MANAGE_USERS_REFUSALS.STALE_ROLE });
    expect(scene.roles.get('user-2')).toBe('auditor');
    expect(scene.events).toHaveLength(0);
  });

  it('refuses a role outside the vocabulary', async () => {
    const scene = world({ users: SUBJECT });

    const outcome = await setUserRole(scene.dependencies, {
      session: ADMIN,
      correlationId: CORRELATION,
      userId: 'user-2',
      role: 'superuser' as Role,
    });

    expect(outcome).toEqual({ ok: false, reason: MANAGE_USERS_REFUSALS.ROLE_INVALID });
    expect(scene.roles.get('user-2')).toBe('auditor');
  });
});

/**
 * The two ways this surface could lock the deployment out of itself.
 *
 * There is no sign-up endpoint and no user deletion, so a deployment with no PoC
 * Administrator cannot get one back from the interface at all: recovery is shell access
 * and `pnpm seed:identity`. Both refusals are enforced in the command, because the
 * interface is never the control.
 */
describe('lockout guards', () => {
  it('refuses an administrator changing their own role, before any transaction', async () => {
    const scene = world();

    const outcome = await setUserRole(scene.dependencies, {
      session: ADMIN,
      correlationId: CORRELATION,
      userId: ADMIN.userId,
      role: 'auditor',
      expectedRole: 'poc-administrator',
    });

    expect(outcome).toEqual({ ok: false, reason: MANAGE_USERS_REFUSALS.SELF_ROLE_CHANGE });
    expect(scene.roles.get(ADMIN.userId)).toBe('poc-administrator');
    expect(scene.events).toHaveLength(0);
    // Nothing was locked, because nothing opened a transaction: who is asking cannot
    // change under us, so this guard needs no database at all.
    expect(scene.locked).toEqual([]);
  });

  it('authorizes before it counts, so a demoted caller is refused for their role', async () => {
    const scene = world({
      users: {
        'user-9': { name: 'Ex Admin', email: 'ex@synthetic.invalid', role: 'auditor' },
      },
    });

    const outcome = await setUserRole(scene.dependencies, {
      session: { userId: 'user-9', sessionId: 'session-9' },
      correlationId: CORRELATION,
      userId: ADMIN.userId,
      role: null,
      expectedRole: 'poc-administrator',
    });

    // The order matters: an Auditor is told they may not act, never that their action
    // would have left no administrator — which would disclose how many there are.
    expect(outcome).toEqual({ ok: false, reason: 'Your role does not permit this action.' });
    expect(scene.roles.get(ADMIN.userId)).toBe('poc-administrator');
    expect(scene.locked).toEqual([]);
  });

  it('refuses the demotion that would leave zero administrators', async () => {
    const scene = world({
      users: {
        'user-9': {
          name: 'Only Other Admin',
          email: 'other@synthetic.invalid',
          role: 'poc-administrator',
        },
      },
    });
    // Take the actor out of the count while leaving them able to act, exactly as a
    // concurrent transaction would have: their row is gone, the session is not.
    scene.roles.delete(ADMIN.userId);
    const acting = {
      ...scene.dependencies,
      roles: { findRole: () => Promise.resolve('poc-administrator' as Role) },
    };

    const outcome = await setUserRole(acting, {
      session: ADMIN,
      correlationId: CORRELATION,
      userId: 'user-9',
      role: 'auditor',
      expectedRole: 'poc-administrator',
    });

    expect(outcome).toEqual({ ok: false, reason: MANAGE_USERS_REFUSALS.LAST_ADMINISTRATOR });
    // Refused inside the transaction, so the write it had already made is gone.
    expect(scene.roles.get('user-9')).toBe('poc-administrator');
    expect(scene.events).toHaveLength(0);
    // And it locked the holders before writing, which is what makes the concurrent case
    // safe against the database rather than only against this fake.
    expect(scene.locked).toEqual(['poc-administrator']);
  });

  it('locks the holders BEFORE writing, so two concurrent demotions serialize', async () => {
    const scene = world({
      users: {
        'user-a': { name: 'Admin A', email: 'a@synthetic.invalid', role: 'poc-administrator' },
        'user-b': { name: 'Admin B', email: 'b@synthetic.invalid', role: 'poc-administrator' },
      },
    });
    scene.roles.delete(ADMIN.userId);
    const acting = {
      ...scene.dependencies,
      roles: { findRole: () => Promise.resolve('poc-administrator' as Role) },
    };

    // A demotes B. Allowed: A still holds it.
    const first = await setUserRole(acting, {
      session: ADMIN,
      correlationId: `${CORRELATION}-a`,
      userId: 'user-b',
      role: 'auditor',
      expectedRole: 'poc-administrator',
    });
    expect(first).toMatchObject({ ok: true, newRole: 'auditor' });

    // B demotes A, arriving after. In PostgreSQL this transaction waited on the row lock
    // and now counts the committed state; here the fake is sequential, which is the same
    // observation. Either way the second one must see zero and refuse.
    const second = await setUserRole(acting, {
      session: { userId: 'user-b', sessionId: 'session-b' },
      correlationId: `${CORRELATION}-b`,
      userId: 'user-a',
      role: 'auditor',
      expectedRole: 'poc-administrator',
    });

    expect(second).toEqual({ ok: false, reason: MANAGE_USERS_REFUSALS.LAST_ADMINISTRATOR });
    expect(scene.roles.get('user-a')).toBe('poc-administrator');
    // Both transactions took the lock, and took it first.
    expect(scene.locked).toEqual(['poc-administrator', 'poc-administrator']);
  });
});
