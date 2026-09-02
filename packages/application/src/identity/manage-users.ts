import { isRole, type Role } from '@intellifin/domain';

import type { AuditUnitOfWork } from '../audit/ports.js';
import { authorizeCommand } from './authorize.js';
import type {
  IdentityUnitOfWorkContext,
  RoleRepository,
  SessionSnapshot,
  UserDirectory,
} from './ports.js';

/**
 * The two audited administration commands (FR-2, FR-7, FR-45, AD-7, AD-8).
 *
 * Each one does four things in a fixed order, and the order is the design:
 *
 *   1. authorize through {@link authorizeCommand}, which resolves the role afresh and
 *      audits the refusal itself — this module never re-implements the check, and never
 *      reads the input before deciding whether the caller may act at all;
 *   2. validate the input;
 *   3. write the change and
 *   4. append exactly one `configuration` event naming the actor, the subject, the
 *      prior value and the new value — 3 and 4 inside ONE transaction.
 *
 * Step 3 and step 4 sharing a transaction is the whole point. A role written through a
 * pool-bound repository would survive a failed append, which is precisely the unaudited
 * privilege change FR-45 exists to prevent. The {@link IdentityUnitOfWorkContext} makes
 * that structural: the only writers a command can reach are the ones in its transaction.
 *
 * Nothing here ever touches an email address as an identifier. The subject of an event
 * is a user id, because the audit vocabulary excludes `@` from `actor.id` and because an
 * address is personal data that the immutable chain must not carry.
 */

export const MANAGE_USERS_ACTION = 'administration.users.manage' as const;

/**
 * The role the deployment must never run out of.
 *
 * It is the only role that can grant a role, and there is no public sign-up endpoint and
 * no user deletion. A deployment with zero holders cannot administer itself back into
 * existence from the interface at all — recovery is a shell and `pnpm seed:identity`.
 */
export const IRREPLACEABLE_ROLE = 'poc-administrator' as const satisfies Role;

/** The two event types this module appends. Both are in the `configuration` family. */
export const USER_CREATED_EVENT = 'configuration.user-created' as const;
export const ROLE_CHANGED_EVENT = 'configuration.role-changed' as const;

/** Better Auth is configured with the same floor; stating it here refuses earlier. */
export const MIN_PASSWORD_LENGTH = 12;

/** What an administrator is told when a command refuses. Never why a password failed. */
export const MANAGE_USERS_REFUSALS = {
  EMAIL_REQUIRED: 'Enter an email address.',
  EMAIL_INVALID: 'Enter a valid email address.',
  NAME_REQUIRED: 'Enter a name.',
  PASSWORD_TOO_SHORT: `The password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
  ROLE_INVALID: 'Choose a role.',
  USER_REQUIRED: 'Choose a user.',
  UNKNOWN_USER: 'That user no longer exists.',
  DUPLICATE_EMAIL: 'That email address already has an account.',
  /**
   * Self-demotion and last-administrator removal are the two ways this surface could
   * lock the deployment out of itself. There is no sign-up endpoint and no user
   * deletion, so recovering from either needs shell access to re-run the seed script.
   */
  SELF_ROLE_CHANGE:
    'You cannot change your own role. Ask another PoC Administrator to change it.',
  LAST_ADMINISTRATOR:
    'This would leave no PoC Administrator. Give another user that role first.',
  STALE_ROLE:
    "That user's role changed since this page was loaded. Reload the page and try again.",
} as const;

export type ManageUsersOutcome<TDetail> =
  | ({ readonly ok: true } & TDetail)
  | { readonly ok: false; readonly reason: string };

export interface ManageUsersDependencies {
  /** Resolves the ACTOR's role for the authorization check. Read on every call. */
  readonly roles: RoleRepository;
  /** Resolves the SUBJECT. Read-only, outside the transaction. */
  readonly users: UserDirectory;
  readonly unitOfWork: AuditUnitOfWork<IdentityUnitOfWorkContext>;
}

/**
 * A refusal raised from inside the transaction so the transaction rolls back.
 *
 * Returning a refusal from the callback would COMMIT it: everything written before the
 * refusal — an account, in the duplicate-address case — would survive. Throwing is the
 * only way to say "this did not happen" to PostgreSQL as well as to the caller.
 */
class CommandRefused extends Error {
  override readonly name = 'CommandRefused';
  readonly refusal: string;

  constructor(refusal: string) {
    super(refusal);
    this.refusal = refusal;
  }
}

function refuse(reason: string): { readonly ok: false; readonly reason: string } {
  return { ok: false, reason };
}

/**
 * Deliberately minimal: one `@`, something either side, no whitespace, and a dot in the
 * domain. This is a shape check that catches a typo, not an address validator — the
 * address is proven by nothing here, and RFC 5322 in a regular expression is a liability.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

function validateNewAccount(input: {
  readonly email: string;
  readonly name: string;
  readonly password: string;
  readonly role: unknown;
}): string | null {
  const email = input.email.trim();
  if (email === '') return MANAGE_USERS_REFUSALS.EMAIL_REQUIRED;
  if (!EMAIL_SHAPE.test(email)) return MANAGE_USERS_REFUSALS.EMAIL_INVALID;
  if (input.name.trim() === '') return MANAGE_USERS_REFUSALS.NAME_REQUIRED;
  // Length, and nothing else: a composition rule stated in an error message is a hint
  // about the shape of every password in the system.
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    return MANAGE_USERS_REFUSALS.PASSWORD_TOO_SHORT;
  }
  if (!isRole(input.role)) return MANAGE_USERS_REFUSALS.ROLE_INVALID;
  return null;
}

export interface CreateUserWithRoleInput {
  /** Established by the session. A caller cannot claim to be somebody else. */
  readonly session: SessionSnapshot;
  readonly correlationId: string;
  readonly email: string;
  readonly name: string;
  /** Used once, to create the account. Never stored, logged, audited or returned. */
  readonly password: string;
  readonly role: Role;
}

export type CreateUserWithRoleResult = ManageUsersOutcome<{
  readonly userId: string;
  readonly role: Role;
}>;

/**
 * Create an account and give it a role, as one audited transaction.
 *
 * `priorRole` is `null` and is still recorded. A first assignment is a real transition,
 * and the chain has to be readable on its own: an event that omits the key it does not
 * need is an event a later reader cannot tell apart from one that forgot it.
 */
export async function createUserWithRole(
  dependencies: ManageUsersDependencies,
  input: CreateUserWithRoleInput,
): Promise<CreateUserWithRoleResult> {
  const { session, correlationId } = input;

  const decision = await authorizeCommand(
    { roles: dependencies.roles, unitOfWork: dependencies.unitOfWork },
    { session, action: MANAGE_USERS_ACTION, correlationId },
  );
  if (!decision.allowed) return refuse(decision.reason);

  const invalid = validateNewAccount(input);
  if (invalid !== null) return refuse(invalid);

  const email = input.email.trim();
  const name = input.name.trim();

  try {
    return await dependencies.unitOfWork.execute(
      async ({ auditEvents, roles, users }): Promise<CreateUserWithRoleResult> => {
        const creation = await users.createUser({ email, name, password: input.password });
        if (!creation.created) throw new CommandRefused(creation.reason);

        await roles.setRole({
          userId: creation.userId,
          role: input.role,
          assignedBy: session.userId,
        });

        await auditEvents.append({
          actor: { type: 'human', id: session.userId },
          eventType: USER_CREATED_EVENT,
          source: 'web',
          outcome: 'success',
          sessionId: session.sessionId,
          correlationId,
          payload: {
            subjectUserId: creation.userId,
            priorRole: null,
            newRole: input.role,
          },
        });

        return { ok: true, userId: creation.userId, role: input.role };
      },
    );
  } catch (error) {
    if (error instanceof CommandRefused) return refuse(error.refusal);
    // Anything else is a failure, not a refusal. It is rethrown so the composition root
    // reports it: nothing was committed, and pretending otherwise would hide an outage.
    throw error;
  }
}

export interface SetUserRoleInput {
  readonly session: SessionSnapshot;
  readonly correlationId: string;
  /** The subject. A user id, never an address. */
  readonly userId: string;
  /** `null` REVOKES the role. The account and its sessions are untouched (AD-7). */
  readonly role: Role | null;
  /**
   * The role the caller believes the subject holds — the value the surface rendered.
   *
   * It is optimistic concurrency, and it is about the audit event as much as the write.
   * A stale tab that blind-overwrites produces an event whose `priorRole` is a value the
   * administrator never saw and never intended to replace, so the chain records a
   * decision nobody made. When this does not match the value read inside the
   * transaction, the change is refused and the person is asked to reload.
   *
   * `undefined` means the caller did not state an expectation and the check is skipped;
   * every caller in this application states one.
   */
  readonly expectedRole?: Role | null | undefined;
}

export type SetUserRoleResult = ManageUsersOutcome<{
  readonly userId: string;
  readonly priorRole: Role | null;
  readonly newRole: Role | null;
}>;

/**
 * Set or clear one user's role, as one audited transaction.
 *
 * Removing the role is the revocation mechanism; there is no user deletion anywhere in
 * this module, because deleting an account would orphan the audit history that names it.
 * A revocation records `newRole: null` and takes effect on the subject's very next
 * request without ending the session they already hold (AD-7).
 */
export async function setUserRole(
  dependencies: ManageUsersDependencies,
  input: SetUserRoleInput,
): Promise<SetUserRoleResult> {
  const { session, correlationId, userId } = input;

  const decision = await authorizeCommand(
    { roles: dependencies.roles, unitOfWork: dependencies.unitOfWork },
    { session, action: MANAGE_USERS_ACTION, correlationId },
  );
  if (!decision.allowed) return refuse(decision.reason);

  if (userId.trim() === '') return refuse(MANAGE_USERS_REFUSALS.USER_REQUIRED);
  if (input.role !== null && !isRole(input.role)) {
    return refuse(MANAGE_USERS_REFUSALS.ROLE_INVALID);
  }

  // Nobody changes their own role. Not because it is dangerous in itself, but because
  // the two ways to lock this deployment out of administration are self-demotion and
  // removing the last administrator, and this is the cheap half of that guard: it needs
  // no lock, no count and no transaction, because who is asking cannot change under us.
  if (userId === session.userId) return refuse(MANAGE_USERS_REFUSALS.SELF_ROLE_CHANGE);

  const subject = await dependencies.users.findUser(userId);
  if (subject === null) return refuse(MANAGE_USERS_REFUSALS.UNKNOWN_USER);

  try {
    return await dependencies.unitOfWork.execute(
      async ({ auditEvents, roles }): Promise<SetUserRoleResult> => {
        // FIRST, before any write: lock every holder of the irreplaceable role, in a
        // deterministic order. Two administrators demoting each other concurrently each
        // count one remaining holder under READ COMMITTED — each sees its own
        // uncommitted write and not the other's — and both commit into a locked-out
        // deployment. Locking first makes the second transaction wait and then count
        // after the first has committed. Locking BEFORE the write, rather than after,
        // also keeps the acquisition order the same for every caller, so two of them
        // queue instead of deadlocking.
        await roles.lockHolders(IRREPLACEABLE_ROLE);

        // Read inside the transaction. The prior value the event claims must be the value
        // the write actually replaced, not one read a moment earlier from another
        // connection.
        const priorRole = await roles.findRole(userId);

        // The surface rendered a role; if it is no longer that, the administrator is
        // deciding about a state that no longer exists.
        if (input.expectedRole !== undefined && priorRole !== input.expectedRole) {
          throw new CommandRefused(MANAGE_USERS_REFUSALS.STALE_ROLE);
        }

        // Setting the role somebody already holds is not a transition. Writing the row
        // again would append an event claiming a change that did not happen, and the
        // chain is the record of what changed — a disabled button is not the control.
        if (priorRole === input.role) {
          return { ok: true, userId, priorRole, newRole: input.role };
        }

        if (input.role === null) {
          await roles.clearRole(userId);
        } else {
          await roles.setRole({ userId, role: input.role, assignedBy: session.userId });
        }

        // Counted AFTER the write, so it is the state this transaction would commit.
        // Every holder is locked, so no concurrent transaction can remove one behind us.
        if ((await roles.countHolders(IRREPLACEABLE_ROLE)) === 0) {
          throw new CommandRefused(MANAGE_USERS_REFUSALS.LAST_ADMINISTRATOR);
        }

        await auditEvents.append({
          actor: { type: 'human', id: session.userId },
          eventType: ROLE_CHANGED_EVENT,
          source: 'web',
          outcome: 'success',
          sessionId: session.sessionId,
          correlationId,
          payload: { subjectUserId: userId, priorRole, newRole: input.role },
        });

        return { ok: true, userId, priorRole, newRole: input.role };
      },
    );
  } catch (error) {
    if (error instanceof CommandRefused) return refuse(error.refusal);
    throw error;
  }
}
