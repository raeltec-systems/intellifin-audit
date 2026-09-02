import type { Role } from '@intellifin/domain';

import type { AuditUnitOfWorkContext } from '../audit/ports.js';

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

/**
 * A user as the administration surface lists them (FR-2, FR-7).
 *
 * There is no password, no hash, no token and no session here, and there never can be:
 * this is the whole shape the layer above is allowed to see. `role` is `null` for an
 * account that holds no role — a real state, never a default.
 */
export interface ManagedUser {
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly role: Role | null;
  /** ISO 8601 UTC, as the boundary rule requires. */
  readonly createdAt: string;
}

/** Reads the user list and one user. Outside any transaction; it changes nothing. */
export interface UserDirectory {
  listUsers(): Promise<readonly ManagedUser[]>;
  findUser(userId: string): Promise<ManagedUser | null>;
}

/**
 * Writes the application-owned role, INSIDE the caller's transaction (FR-45, AD-8).
 *
 * `findRole` is here as well as on {@link RoleRepository} on purpose: the prior value an
 * event records must be read in the same transaction that writes the new one, or a
 * concurrent change lands between the read and the write and the chain records a
 * transition that never happened.
 */
export interface RoleWriter {
  findRole(userId: string): Promise<Role | null>;
  setRole(assignment: RoleAssignment): Promise<void>;
  clearRole(userId: string): Promise<void>;
}

export interface RoleAssignment {
  readonly userId: string;
  readonly role: Role;
  /** The administrator who assigned it. Recorded in `user_role.assigned_by`. */
  readonly assignedBy: string;
}

/** The account an administrator asked for. The password is used and never stored here. */
export interface NewUserAccount {
  readonly email: string;
  readonly name: string;
  readonly password: string;
}

/**
 * `created: false` is a REFUSAL the administrator can read and act on — an address
 * already registered, most of all. It is not an error: nothing has gone wrong.
 */
export type UserCreationResult =
  | { readonly created: true; readonly userId: string }
  | { readonly created: false; readonly reason: string };

/**
 * Creates an account, inside the caller's transaction.
 *
 * The running application has no public sign-up endpoint at all; this port is the only
 * way an account comes into existence from the interface, and it is reached only behind
 * `administration.users.manage`.
 */
export interface UserCreator {
  createUser(account: NewUserAccount): Promise<UserCreationResult>;
}

/** Ends one session, inside the caller's transaction. Used by sign-out. */
export interface SessionWriter {
  revokeSession(sessionId: string): Promise<void>;
}

/**
 * The unit of work the identity commands need: the audit writer, plus the three
 * identity writers bound to the SAME transaction.
 *
 * This is the type that makes "the change and its event commit together, or neither
 * does" a compile-time property rather than a convention. A command cannot reach a
 * writer that is not in the transaction, because there is no other writer to reach.
 */
export interface IdentityUnitOfWorkContext extends AuditUnitOfWorkContext {
  readonly roles: RoleWriter;
  readonly users: UserCreator;
  readonly sessions: SessionWriter;
}
