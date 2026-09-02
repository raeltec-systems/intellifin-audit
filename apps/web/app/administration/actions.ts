'use server';

import { revalidatePath } from 'next/cache';

import {
  createUserWithRole,
  setUserRole,
  type ManageUsersDependencies,
} from '@intellifin/application';
import { isRole, type Role } from '@intellifin/domain';
import {
  DrizzleRoleRepository,
  DrizzleUserDirectory,
  PostgresIdentityUnitOfWork,
} from '@intellifin/infrastructure';

import { getRuntime } from '../../src/bootstrap';
import { roleLabel } from '../../src/admin/roles';
import { currentCorrelationId, requireServerAction } from '../../src/server-session';

/**
 * The Administration surface's two mutations, as Server Actions (FR-2, FR-7, FR-45).
 *
 * **Each one authorizes first, before it reads its input.** A Server Action is not part
 * of the page it was written beside: Next exposes it as its own POST endpoint addressed
 * by id, and reaching the page is not a precondition for invoking it. The page's
 * `requireServerAction` therefore protects the page and nothing else, and an attacker's
 * surface is this file. `actions.test.ts` asserts the refusal against these functions,
 * not against the page.
 *
 * The refusal itself is audited by `authorizeCommand` inside `requireServerAction`, so a
 * denied administration attempt is in the chain whether it came through the interface or
 * through a hand-made POST.
 *
 * Nothing here returns a password, echoes one, or puts one in a URL — the argument is
 * consumed by the command and never leaves it.
 *
 * **The argument is untrusted.** `CreateUserFields` and `SetRoleFields` are TypeScript,
 * which is to say they are a comment as far as a hand-made POST is concerned. A body
 * carrying `null`, a number, or nothing at all reaches this file typed as a string and
 * throws on the first `.trim()`, answering a framework 500 to the one caller most likely
 * to be probing. Every field is therefore checked for shape and bounded for length here,
 * at the boundary, before anything reads it.
 */

export type AdministrationActionResult =
  | { readonly ok: true; readonly message: string }
  | { readonly ok: false; readonly reason: string };

/** Said when the command threw. It never names a driver, a table or a host. */
const UNAVAILABLE = 'The change could not be saved. Nothing was changed.';

/**
 * Said when the request itself was not the shape this action accepts. It is deliberately
 * one sentence for every malformed field: a caller hand-making a POST learns that it was
 * refused, not which field to fix next.
 */
const MALFORMED = 'That request was not valid. Nothing was changed.';

/**
 * Length ceilings, applied before anything else looks at the value.
 *
 * The password bound is the one that is not cosmetic. Better Auth hashes with scrypt,
 * whose cost is paid by this process, and an unbounded password is an unbounded amount
 * of that cost bought with one request. 128 is far above any real password and far below
 * anything worth sending. The address bound is the RFC 5321 maximum.
 */
const MAX_LENGTHS = { email: 254, name: 200, password: 128 } as const;

/** A present string within its bound. Anything else — number, null, missing — is not. */
function boundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max;
}

/** The whole argument, checked before any field is used. */
function isCreateUserFields(input: unknown): input is CreateUserFields {
  if (typeof input !== 'object' || input === null) return false;
  const fields = input as Record<string, unknown>;
  return (
    boundedString(fields['email'], MAX_LENGTHS.email) &&
    boundedString(fields['name'], MAX_LENGTHS.name) &&
    boundedString(fields['password'], MAX_LENGTHS.password) &&
    typeof fields['role'] === 'string'
  );
}

function isSetRoleFields(input: unknown): input is SetRoleFields {
  if (typeof input !== 'object' || input === null) return false;
  const fields = input as Record<string, unknown>;
  return (
    boundedString(fields['userId'], 255) &&
    typeof fields['role'] === 'string' &&
    typeof fields['expectedRole'] === 'string'
  );
}

/** `''` is "no role", which is a value a `<select>` can post and `null` is not. */
function roleFromField(value: string): Role | null | undefined {
  if (value === '') return null;
  return isRole(value) ? value : undefined;
}

async function dependencies(): Promise<ManageUsersDependencies> {
  const runtime = await getRuntime();
  return {
    roles: new DrizzleRoleRepository(runtime.db),
    users: new DrizzleUserDirectory(runtime.db),
    unitOfWork: new PostgresIdentityUnitOfWork(runtime.db, runtime.authConfig),
  };
}

/**
 * Report a failure and refuse.
 *
 * The person is told one sentence; the operator gets the error. Returning the thrown
 * message would leak whatever the driver said — a host, a constraint name, a query.
 */
async function unavailable(
  message: 'Create user failed' | 'Set user role failed',
  error: unknown,
  correlationId: string,
): Promise<AdministrationActionResult> {
  try {
    const runtime = await getRuntime();
    runtime.telemetry.captureError(message, error, { outcome: 'failure', correlationId });
  } catch {
    // The runtime is what failed. `instrumentation.ts` reported that at boot.
  }
  return { ok: false, reason: UNAVAILABLE };
}

export interface CreateUserFields {
  readonly email: string;
  readonly name: string;
  readonly password: string;
  readonly role: string;
}

/** Create an account and give it a role. One `configuration.user-created` event. */
export async function createUserAction(
  fields: CreateUserFields,
): Promise<AdministrationActionResult> {
  const decision = await requireServerAction('administration.users.manage');
  if (!decision.allowed) return { ok: false, reason: decision.reason };

  if (!isCreateUserFields(fields)) return { ok: false, reason: MALFORMED };
  const role = roleFromField(fields.role);
  if (role === null || role === undefined) return { ok: false, reason: 'Choose a role.' };

  const correlationId = await currentCorrelationId();

  try {
    const outcome = await createUserWithRole(await dependencies(), {
      session: decision.session,
      correlationId,
      email: fields.email,
      name: fields.name,
      password: fields.password,
      role,
    });
    if (!outcome.ok) return outcome;

    revalidatePath('/administration');
    return { ok: true, message: `Created ${fields.email.trim()} as ${roleLabel(outcome.role)}.` };
  } catch (error) {
    return unavailable('Create user failed', error, correlationId);
  }
}

export interface SetRoleFields {
  readonly userId: string;
  /** The empty string REVOKES the role: a `<select>` cannot post `null`. */
  readonly role: string;
  /**
   * The role the surface rendered for this user, same encoding as `role`.
   *
   * Optimistic concurrency: the command compares it with the value it reads inside the
   * transaction and refuses when they differ, so a stale tab cannot blind-overwrite and
   * the audit event always records the transition the administrator actually confirmed.
   */
  readonly expectedRole: string;
}

/** Set or clear one user's role. One `configuration.role-changed` event. */
export async function setUserRoleAction(
  fields: SetRoleFields,
): Promise<AdministrationActionResult> {
  const decision = await requireServerAction('administration.users.manage');
  if (!decision.allowed) return { ok: false, reason: decision.reason };

  if (!isSetRoleFields(fields)) return { ok: false, reason: MALFORMED };
  // The empty string is the revocation, and anything else must be in the vocabulary
  // before it reaches the command. A `<select>` posts a string; this is where it stops
  // being one.
  const role = roleFromField(fields.role);
  const expectedRole = roleFromField(fields.expectedRole);
  if (role === undefined || expectedRole === undefined) {
    return { ok: false, reason: 'Choose a role.' };
  }

  const correlationId = await currentCorrelationId();

  try {
    const outcome = await setUserRole(await dependencies(), {
      session: decision.session,
      correlationId,
      userId: fields.userId,
      role,
      expectedRole,
    });
    if (!outcome.ok) return outcome;

    revalidatePath('/administration');
    return {
      ok: true,
      message:
        outcome.newRole === null
          ? 'Removed the role. The account and its sessions are unchanged.'
          : `Set the role to ${roleLabel(outcome.newRole)}. It applies on their next request.`,
    };
  } catch (error) {
    return unavailable('Set user role failed', error, correlationId);
  }
}
