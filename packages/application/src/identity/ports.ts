import type { Role } from '@intellifin/domain';

/**
 * Identity ports this layer owns (AD-1, AD-7).
 *
 * Every type here is a plain value. No Better Auth type, no Drizzle row and no
 * framework request object crosses this seam, so the use cases below can be tested
 * with two object literals and the adapters can be replaced without touching them.
 */

/** Who is asking, as proven by the identity provider. It says nothing about permissions. */
export interface SessionSnapshot {
  /** Application user id. Safe to use as an audit `actor.id`. */
  readonly userId: string;
  /** The provider's session-row id — never the session token or cookie. */
  readonly sessionId: string;
}

/**
 * Reads the application-owned role. Implementations must hit storage on every call:
 * a cached role outlives its revocation, which AD-7 forbids.
 */
export interface RoleRepository {
  findRole(userId: string): Promise<Role | null>;
}

/** Resolves the session for the request in hand. `null` means unauthenticated. */
export interface SessionReader {
  currentSession(): Promise<SessionSnapshot | null>;
}
