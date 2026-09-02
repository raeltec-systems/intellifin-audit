import { cache } from 'react';
import { headers } from 'next/headers';

import { DrizzleRoleRepository } from '@intellifin/infrastructure';
import type { AuthorizationContext, GatedAction, Role } from '@intellifin/domain';
import type { RoleRepository, SessionSnapshot } from '@intellifin/application';

import { getRuntime } from './bootstrap';
import { correlationIdFrom } from './correlation';
import { authorizeSessionAction, requireSession, type ActionDecision } from './require-role';

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
 *
 * Everything here is wrapped in React's `cache()`. That is a per-REQUEST memo, not a
 * cache in the AD-7 sense: it is created and discarded with the render, so the layout
 * and the surface inside it resolve one session and read the role once between them
 * instead of twice — and a role change is still seen by the very next request.
 */

/** The incoming request, reconstructed. The URL is not used by either decision. */
const currentRequest = cache(async (): Promise<Request> => {
  const incoming = await headers();
  return new Request('http://server.local/', { headers: new Headers(incoming) });
});

const currentSession = cache(async () => requireSession(await currentRequest()));

const findRoleOnce = cache(async (userId: string): Promise<Role | null> => {
  const runtime = await getRuntime();
  return new DrizzleRoleRepository(runtime.db).findRole(userId);
});

/** The same repository port, memoised for this request only. */
const requestScopedRoles: RoleRepository = { findRole: findRoleOnce };

export interface Identity {
  readonly session: SessionSnapshot;
  /** `null` for a signed-in person with no `user_role` row. Never a default role. */
  readonly role: Role | null;
}

/**
 * Who is asking, as far as the server can tell.
 *
 * `anonymous` — no session. `identified` — a session, and the role it holds right now,
 * read fresh (AD-7). `degraded` — the question could not be answered: the database is
 * unreachable, the runtime refused to start, Better Auth threw.
 *
 * `degraded` is deliberately NOT folded into `anonymous`. Treating a platform failure
 * as "signed out" strips the shell — and with it the environment ribbon, which is a
 * standing compliance statement about what this deployment is — at exactly the moment
 * the platform is unhealthy. A failure can only ever remove privilege, never add it, so
 * the shell renders with no role at all.
 */
export type IdentityResult =
  | { readonly kind: 'anonymous' }
  | ({ readonly kind: 'identified' } & Identity)
  | { readonly kind: 'degraded' };

export const currentIdentity = cache(async (): Promise<IdentityResult> => {
  try {
    const result = await currentSession();
    if (!result.authenticated) return { kind: 'anonymous' };
    const role = await findRoleOnce(result.session.userId);
    return { kind: 'identified', session: result.session, role };
  } catch (error) {
    // Never silent. A persistent failure here means every page renders without its
    // navigation, and nothing else in the system would say so.
    try {
      const runtime = await getRuntime();
      runtime.telemetry.captureError('Identity could not be resolved', error, {
        outcome: 'failure',
      });
    } catch {
      // The runtime itself is what failed. `instrumentation.ts` already reported that
      // at boot; there is nowhere left to write.
    }
    return { kind: 'degraded' };
  }
});

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
  const request = await currentRequest();
  const result = await currentSession();
  if (!result.authenticated) {
    return { allowed: false, status: 401, reason: 'Sign in to continue.' };
  }
  return authorizeSessionAction(
    result.session,
    action,
    correlationIdFrom(request),
    context,
    requestScopedRoles,
  );
}
