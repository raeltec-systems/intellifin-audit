import { eq } from 'drizzle-orm';

import type { NewUserAccount, UserCreationResult, UserCreator } from '@intellifin/application';

import type { Database, Transaction } from '../db/client.js';
import { authUser } from '../db/schema.js';
import { createSeedAuth, type AuthConfig } from './auth.js';
import { findUserIdByEmail } from './role-repository.js';

/**
 * Account creation, server-side and inside the caller's transaction (FR-2, FR-7).
 *
 * Three things about this class matter more than its lines of code.
 *
 * **It is privileged.** The instance the web process mounts has `disableSignUp: true`,
 * so the running application exposes no account-creation endpoint at all; this builds
 * the instance that CAN create one, which until now only `scripts/seed-identity.mts`
 * did. That capability is safe here for exactly one reason: nothing constructs this
 * class except a command that has already passed `administration.users.manage`, and the
 * privileged instance is never mounted on a route. `tests/integration/manage-users.test.ts`
 * keeps proving the mounted handler still refuses `sign-up/email`.
 *
 * **It is transactional.** Better Auth talks to PostgreSQL through the Drizzle adapter it
 * is given, so handing it the transaction handle instead of the pool puts the account
 * rows inside the same transaction as the role write and the audit event. Roll back and
 * the account never existed. Without this the three writes would be three commits, and a
 * failed audit append would leave an account nothing in the chain accounts for.
 *
 * **It does not trust the provider's answer.** Better Auth 1.7.2 answers a sign-up for an
 * ALREADY REGISTERED address with a fabricated user object — a fresh id, no row written,
 * no error raised. That is deliberate on its part: on a public sign-up endpoint, telling
 * the caller "this address is taken" is user enumeration. Here it is a trap. Taken at its
 * word this class would report a user id that does not exist, and the command would then
 * write a role and an audit event for a subject that was never created. So the address is
 * checked before, the returned id is checked after, and only a row that is really there
 * counts as created. The `user_role` foreign key is the third line of the same defence.
 *
 * The password is a parameter and nothing else: it is not stored, logged, audited,
 * returned or held after the call. Better Auth hashes it and this process forgets it.
 */
export class BetterAuthUserCreator implements UserCreator {
  constructor(
    private readonly transaction: Transaction,
    private readonly config: AuthConfig,
  ) {}

  async createUser(account: NewUserAccount): Promise<UserCreationResult> {
    // Read inside the transaction, case-insensitively — `Dana@x` and `dana@x` are one
    // person, and the column's unique index is case-sensitive.
    const existing = await findUserIdByEmail(this.transaction, account.email);
    if (existing !== null) return duplicate();

    // The transaction handle exposes the query builder the Drizzle adapter uses; the
    // cast is the seam between Drizzle's two handle types, and it is the whole trick.
    const auth = createSeedAuth(this.transaction as unknown as Database, this.config);

    let userId: string;
    try {
      const created = await auth.api.signUpEmail({
        body: { email: account.email, name: account.name, password: account.password },
      });
      userId = created.user.id;
    } catch (error) {
      // A refusal it DOES raise. The message is ours: a provider's wording is not a
      // contract we control, and this one is read by an administrator.
      if (isDuplicateAddress(error) || isUniqueViolation(error)) return duplicate();
      throw error;
    }

    // The row, or nothing. This catches the fabricated answer above, and it also catches
    // a concurrent creation of the same address that slipped past the check: the second
    // caller is told the address is taken instead of being handed a phantom id.
    const rows = await this.transaction
      .select({ id: authUser.id })
      .from(authUser)
      .where(eq(authUser.id, userId))
      .limit(1);
    if (rows.length === 0) return duplicate();

    return { created: true, userId };
  }
}

/** One sentence, whichever way the duplicate was detected. */
function duplicate(): UserCreationResult {
  return { created: false, reason: 'That email address already has an account.' };
}

/**
 * A PostgreSQL unique violation (SQLSTATE 23505) anywhere in the error chain.
 *
 * The pre-check and Better Auth's own answer are both checks, and a check is not a
 * constraint: two concurrent creates of `Dana@x` and `dana@x` can each find no existing
 * row and each proceed. The `auth_user_email_lower_uidx` index added in generation 4 is
 * what actually stops the second one, and this is what turns its error into the same
 * sentence the administrator would have seen a moment earlier.
 *
 * Better Auth wraps driver errors, so the whole `cause` chain is walked rather than the
 * top-level object alone.
 */
function isUniqueViolation(error: unknown): boolean {
  for (let current: unknown = error, depth = 0; current && depth < 5; depth += 1) {
    const candidate = current as { code?: unknown; cause?: unknown };
    if (candidate.code === '23505') return true;
    current = candidate.cause;
  }
  return false;
}

/**
 * Better Auth signals an existing address with an `APIError` carrying the
 * `USER_ALREADY_EXISTS` code. The code is matched first and the message only as a
 * fallback, so a wording change upstream degrades to a raised failure — which surfaces
 * as "the change could not be saved" — rather than to a silently swallowed one.
 */
function isDuplicateAddress(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const body = (error as { body?: { code?: unknown; message?: unknown } }).body;
  if (typeof body?.code === 'string' && body.code === 'USER_ALREADY_EXISTS') return true;
  const message = typeof body?.message === 'string' ? body.message : (error as Error).message;
  return typeof message === 'string' && /already exists/i.test(message);
}
