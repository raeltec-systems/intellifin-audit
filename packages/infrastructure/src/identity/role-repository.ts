import { asc, eq, sql } from 'drizzle-orm';

import type {
  NotificationRecipientReader,
  ManagedUser,
  RoleAssignment,
  RoleRepository,
  RoleWriter,
  SessionReader,
  SessionSnapshot,
  SessionWriter,
  UserDirectory,
} from '@intellifin/application';

export class DrizzleNotificationRecipientReader implements NotificationRecipientReader {
  constructor(private readonly handle: ReadHandle) {}
  async auditManagerIds(): Promise<readonly string[]> {
    return (await this.handle.select({ id: userRole.userId }).from(userRole).where(eq(userRole.role, 'audit-manager')).orderBy(asc(userRole.userId))).map(row => row.id);
  }
}
import { isRole, type Role } from '@intellifin/domain';

import type { Database, Transaction } from '../db/client.js';
import { authSession, authUser, userRole } from '../db/schema.js';
import type { Auth } from './auth.js';

/**
 * Reads `user_role` on every call, with no cache of any kind (AD-7).
 *
 * A cached role — in a cookie, a claim, a module-level map, or a memoized promise —
 * outlives the row it came from, so a revoked administrator keeps administering until
 * something expires. One indexed primary-key lookup per request is the price of the
 * guarantee, and it is a cheap one.
 */
export class DrizzleRoleRepository implements RoleRepository {
  constructor(private readonly db: ReadHandle) {}

  findRole(userId: string): Promise<Role | null> {
    return readRole(this.db, userId);
  }
}

/**
 * Either handle can read, and a transaction also reads its own uncommitted writes.
 * Exported so an adapter that must read inside a unit of work can say so in its type.
 */
export type ReadHandle = Pick<Database, 'select'>;

async function readRole(handle: ReadHandle, userId: string): Promise<Role | null> {
  const rows = await handle
    .select({ role: userRole.role })
    .from(userRole)
    .where(eq(userRole.userId, userId))
    .limit(1);
  const value = rows[0]?.role;
  // A row whose value is outside the vocabulary is treated as no role at all: an
  // unrecognized string must never be read as "some role", which would fail open.
  return isRole(value) ? value : null;
}

/**
 * The role write, bound to ONE transaction (FR-45, AD-8).
 *
 * It takes a {@link Transaction}, not a `Database`, and that is the guarantee: there is
 * no way to construct this writer outside a unit of work, so a role change cannot commit
 * while the audit event that records it fails. `findRole` is here too so the prior value
 * an event names is read on the same connection that writes the new one — a read through
 * the pool could be answered by a snapshot the write is about to invalidate.
 *
 * There is no cache and no read-modify-write outside the transaction: the upsert is one
 * statement, so two administrators changing the same user serialize on the row.
 */
export class DrizzleRoleWriter implements RoleWriter {
  constructor(private readonly transaction: Transaction) {}

  findRole(userId: string): Promise<Role | null> {
    return readRole(this.transaction, userId);
  }

  async setRole({ userId, role, assignedBy }: RoleAssignment): Promise<void> {
    const assignedAt = new Date();
    await this.transaction
      .insert(userRole)
      .values({ userId, role, assignedAt, assignedBy })
      .onConflictDoUpdate({
        target: userRole.userId,
        set: { role, assignedAt, assignedBy },
      });
  }

  async clearRole(userId: string): Promise<void> {
    await this.transaction.delete(userRole).where(eq(userRole.userId, userId));
  }

  /**
   * `SELECT ... FOR UPDATE`, ordered.
   *
   * `ORDER BY user_id` is not cosmetic: `FOR UPDATE` locks rows as it scans them, so two
   * transactions locking the same set in different orders deadlock. A deterministic order
   * makes the second one queue behind the first instead, which is what the
   * last-administrator guard needs to be able to count after the first has committed.
   *
   * Aggregates and `FOR UPDATE` cannot be combined in PostgreSQL, so this returns the ids
   * and {@link countHolders} counts separately, after the write.
   */
  async lockHolders(role: Role): Promise<readonly string[]> {
    const rows = await this.transaction
      .select({ userId: userRole.userId })
      .from(userRole)
      .where(eq(userRole.role, role))
      .orderBy(asc(userRole.userId))
      .for('update');
    return rows.map((row) => row.userId);
  }

  async countHolders(role: Role): Promise<number> {
    const rows = await this.transaction
      .select({ count: sql<number>`count(*)::int` })
      .from(userRole)
      .where(eq(userRole.role, role));
    return rows[0]?.count ?? 0;
  }
}

/**
 * Ends one session inside the caller's transaction, so a sign-out and its event commit
 * together. It deletes by the session ROW id; the token is a credential and never
 * reaches this layer.
 */
export class DrizzleSessionWriter implements SessionWriter {
  constructor(private readonly transaction: Transaction) {}

  async revokeSession(sessionId: string): Promise<void> {
    await this.transaction.delete(authSession).where(eq(authSession.id, sessionId));
  }
}

/**
 * How many accounts the user list returns.
 *
 * An unbounded `SELECT` is a query whose cost is set by the data rather than by the code:
 * it is fine at five accounts and renders a page nobody can use at five thousand. The
 * surface says so when it is truncated rather than silently showing a prefix, and
 * pagination is deferred to its own story.
 */
export const USER_LIST_LIMIT = 200;

/**
 * The user list the Administration surface renders.
 *
 * It selects the four columns the surface shows and no others — in particular not
 * `auth_account.password`, which is where Better Auth keeps the credential hash. A
 * `select *` here would put every hash one serialization mistake away from a response.
 *
 * The role is joined from `user_role`, read at the moment of the query like every other
 * role read (AD-7). `null` means the account holds no role.
 */
export class DrizzleUserDirectory implements UserDirectory {
  constructor(
    private readonly db: Database,
    /** How many rows the surface will render. See {@link USER_LIST_LIMIT}. */
    private readonly limit: number = USER_LIST_LIMIT,
  ) {}

  async listUsers(): Promise<readonly ManagedUser[]> {
    const rows = await this.db
      .select({
        userId: authUser.id,
        name: authUser.name,
        email: authUser.email,
        role: userRole.role,
        createdAt: authUser.createdAt,
      })
      .from(authUser)
      .leftJoin(userRole, eq(userRole.userId, authUser.id))
      .orderBy(asc(authUser.createdAt), asc(authUser.id))
      .limit(this.limit);
    return rows.map(toManagedUser);
  }

  async findUser(userId: string): Promise<ManagedUser | null> {
    const rows = await this.db
      .select({
        userId: authUser.id,
        name: authUser.name,
        email: authUser.email,
        role: userRole.role,
        createdAt: authUser.createdAt,
      })
      .from(authUser)
      .leftJoin(userRole, eq(userRole.userId, authUser.id))
      .where(eq(authUser.id, userId))
      .limit(1);
    const row = rows[0];
    return row ? toManagedUser(row) : null;
  }
}

function toManagedUser(row: {
  userId: string;
  name: string;
  email: string;
  role: string | null;
  createdAt: Date;
}): ManagedUser {
  return {
    userId: row.userId,
    name: row.name,
    email: row.email,
    // Same fail-closed reading as `readRole`: an unrecognized value is no role at all.
    role: isRole(row.role) ? row.role : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Resolves the session for one request through Better Auth. It returns plain ids —
 * never the session token or the cookie — so nothing vendor-shaped reaches the
 * application layer.
 */
export class BetterAuthSessionReader implements SessionReader {
  constructor(
    private readonly auth: Auth,
    private readonly headers: Headers,
  ) {}

  async currentSession(): Promise<SessionSnapshot | null> {
    const result = await this.auth.api.getSession({ headers: this.headers });
    if (!result?.session?.id || !result.session.userId) return null;
    return { userId: result.session.userId, sessionId: result.session.id };
  }
}

/** The user an email address belongs to, matched case-insensitively. `null` if none. */
export async function findUserIdByEmail(
  handle: ReadHandle,
  email: string,
): Promise<string | null> {
  const rows = await handle
    .select({ id: authUser.id })
    .from(authUser)
    .where(sql`lower(${authUser.email}) = lower(${email})`)
    .limit(1);
  return rows[0]?.id ?? null;
}

/**
 * The session row a freshly issued token identifies. The token is a credential: it is
 * used to find the row and never returned, logged, or audited.
 */
export async function findSessionByToken(
  db: Database,
  token: string,
): Promise<SessionSnapshot | null> {
  const rows = await db
    .select({ id: authSession.id, userId: authSession.userId })
    .from(authSession)
    .where(eq(authSession.token, token))
    .limit(1);
  const row = rows[0];
  return row ? { userId: row.userId, sessionId: row.id } : null;
}

/**
 * Delete a session row by its token.
 *
 * Used on one path only: a sign-in whose audit event could not be appended. AD-10
 * and FR-45 make the event part of the sign-in, not a side effect of it, so a session
 * that exists without its event must not survive the request.
 */
export async function revokeSessionByToken(db: Database, token: string): Promise<void> {
  await db.delete(authSession).where(eq(authSession.token, token));
}
