import {
  DrizzleRoleRepository,
  BetterAuthSessionReader,
  PostgresAuditUnitOfWork,
} from '@intellifin/infrastructure';
import { authorizeCommand, type SessionSnapshot } from '@intellifin/application';
import type { AuthorizationContext, GatedAction, Role } from '@intellifin/domain';

import { getRuntime } from './bootstrap';
import { correlationIdFrom } from './correlation';

/**
 * The request-level decision (FR-1, FR-2, AD-7).
 *
 * `middleware.ts` only saw a cookie. Here the session is actually resolved, the role
 * is read fresh from `user_role`, the pure domain policy decides, and a refusal is
 * audited before it is returned. Every gated handler goes through `requireAction`;
 * none of them talks to the role table itself.
 */

export type SessionResult =
  | { readonly authenticated: true; readonly session: SessionSnapshot }
  | { readonly authenticated: false };

export type ActionDecision =
  | { readonly allowed: true; readonly session: SessionSnapshot; readonly role: Role }
  | {
      readonly allowed: false;
      /** 401 for no session at all, 403 for a session whose role forbids the action. */
      readonly status: 401 | 403;
      readonly reason: string;
    };

/** Shown to nobody: a 401 carries an empty body, so this never reaches a caller. */
const UNAUTHENTICATED_REASON = 'Sign in to continue.';

/** Resolve the caller's session. `authenticated: false` covers every failure mode. */
export async function requireSession(request: Request): Promise<SessionResult> {
  const runtime = await getRuntime();
  const reader = new BetterAuthSessionReader(runtime.auth, request.headers);
  const session = await reader.currentSession();
  return session ? { authenticated: true, session } : { authenticated: false };
}

/**
 * Resolve the session, resolve the role, decide, and audit a refusal.
 *
 * An unauthenticated caller is refused WITHOUT an audit event: the middleware already
 * turned anonymous traffic away, and appending a `security.denied` row per unauthenticated
 * probe would let anybody grow the immutable chain at will. A refusal that names a real
 * session — including a session whose role row was deleted — is always audited.
 */
export async function requireAction(
  request: Request,
  action: GatedAction,
  context: AuthorizationContext = {},
): Promise<ActionDecision> {
  const result = await requireSession(request);
  if (!result.authenticated) {
    return { allowed: false, status: 401, reason: UNAUTHENTICATED_REASON };
  }

  const runtime = await getRuntime();
  const outcome = await authorizeCommand(
    {
      roles: new DrizzleRoleRepository(runtime.db),
      unitOfWork: new PostgresAuditUnitOfWork(runtime.db),
    },
    {
      session: result.session,
      action,
      correlationId: correlationIdFrom(request),
      context,
    },
  );

  if (!outcome.allowed) {
    runtime.telemetry.info('Authorization denied', {
      action,
      role: outcome.role,
      userId: result.session.userId,
      sessionId: result.session.sessionId,
      outcome: 'denied',
    });
    return { allowed: false, status: 403, reason: outcome.reason };
  }

  return { allowed: true, session: result.session, role: outcome.role };
}

/**
 * The refusal, as a response. A 401 has no body at all; a 403 carries only the
 * verbatim reason, which is the one thing the person is allowed to learn.
 */
export function denialResponse(
  decision: Extract<ActionDecision, { allowed: false }>,
): Response {
  const headers = { 'cache-control': 'no-store' };
  if (decision.status === 401) return new Response(null, { status: 401, headers });
  return Response.json({ reason: decision.reason }, { status: 403, headers });
}
