import { eq, sql } from 'drizzle-orm';

import type { RoleRepository, SessionSnapshot, SessionReader } from '@intellifin/application';
import { isRole, type Role } from '@intellifin/domain';

import type { Database } from '../db/client.js';
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
  constructor(private readonly db: Database) {}

  async findRole(userId: string): Promise<Role | null> {
    const rows = await this.db
      .select({ role: userRole.role })
      .from(userRole)
      .where(eq(userRole.userId, userId))
      .limit(1);
    const value = rows[0]?.role;
    // A row whose value is outside the vocabulary is treated as no role at all: an
    // unrecognized string must never be read as "some role", which would fail open.
    return isRole(value) ? value : null;
  }
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
export async function findUserIdByEmail(db: Database, email: string): Promise<string | null> {
  const rows = await db
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
