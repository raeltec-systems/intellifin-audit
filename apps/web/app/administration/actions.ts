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
 */

export type AdministrationActionResult =
  | { readonly ok: true; readonly message: string }
  | { readonly ok: false; readonly reason: string };

/** Said when the command threw. It never names a driver, a table or a host. */
const UNAVAILABLE = 'The change could not be saved. Nothing was changed.';

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

  const correlationId = await currentCorrelationId();
  if (!isRole(fields.role)) return { ok: false, reason: 'Choose a role.' };

  try {
    const outcome = await createUserWithRole(await dependencies(), {
      session: decision.session,
      correlationId,
      email: fields.email,
      name: fields.name,
      password: fields.password,
      role: fields.role,
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
}

/** Set or clear one user's role. One `configuration.role-changed` event. */
export async function setUserRoleAction(
  fields: SetRoleFields,
): Promise<AdministrationActionResult> {
  const decision = await requireServerAction('administration.users.manage');
  if (!decision.allowed) return { ok: false, reason: decision.reason };

  const correlationId = await currentCorrelationId();
  // The empty string is the revocation, and anything else must be in the vocabulary
  // before it reaches the command. A `<select>` posts a string; this is where it stops
  // being one.
  if (fields.role !== '' && !isRole(fields.role)) {
    return { ok: false, reason: 'Choose a role.' };
  }
  const role: Role | null = fields.role === '' ? null : fields.role;

  try {
    const outcome = await setUserRole(await dependencies(), {
      session: decision.session,
      correlationId,
      userId: fields.userId,
      role,
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
