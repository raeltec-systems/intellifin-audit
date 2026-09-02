import { headers } from 'next/headers';

import { DrizzleRoleRepository } from '@intellifin/infrastructure';
import type { AuthorizationContext, GatedAction, Role } from '@intellifin/domain';
import type { SessionSnapshot } from '@intellifin/application';

import { getRuntime } from './bootstrap';
import { requireAction, requireSession, type ActionDecision } from './require-role';

/**
 * The server-component entry point to the same decisions route handlers make.
 *
 * `requireSession` and `requireAction` take a `Request`, because a route handler has
 * one. A server component does not; it has `next/headers`. So this module builds a
 * `Request` from the incoming headers and delegates — one decision path, reached two
 * ways, rather than two implementations of "who is this and may they".
 *
 * It lives apart from `require-role.ts` on purpose: importing `next/headers` there
 * would drag the Next request context into a module whose unit tests run under plain
 * Node with no request at all.
 */

/** The incoming request, reconstructed. The URL is not used by either decision. */
async function currentRequest(): Promise<Request> {
  const incoming = await headers();
  return new Request('http://server.local/', { headers: new Headers(incoming) });
}

export interface Identity {
  readonly session: SessionSnapshot;
  /** `null` for a signed-in person with no `user_role` row. Never a default role. */
  readonly role: Role | null;
}

/**
 * The signed-in person and the role they hold RIGHT NOW, read fresh (AD-7).
 *
 * `null` means "render nothing privileged": no session, or the runtime could not answer.
 * A failure is not an authorization, so it can only ever remove the shell's privileged
 * nav — never add it. The sign-in page must still render when the database is down,
 * which is why this returns `null` rather than throwing.
 */
export async function currentIdentity(): Promise<Identity | null> {
  try {
    const request = await currentRequest();
    const result = await requireSession(request);
    if (!result.authenticated) return null;
    const runtime = await getRuntime();
    const role = await new DrizzleRoleRepository(runtime.db).findRole(result.session.userId);
    return { session: result.session, role };
  } catch {
    return null;
  }
}

/**
 * Authorize one action for the current server-rendered request, auditing a refusal.
 *
 * This is the control. Hiding a nav item is presentation: anybody can type the path,
 * so the surface behind it asks here, where the role is resolved fresh and the refusal
 * is written to the audit chain.
 */
export async function requireServerAction(
  action: GatedAction,
  context: AuthorizationContext = {},
): Promise<ActionDecision> {
  return requireAction(await currentRequest(), action, context);
}
