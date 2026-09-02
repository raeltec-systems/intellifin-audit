import {
  BetterAuthSessionReader,
  PostgresIdentityUnitOfWork,
  SESSION_COOKIE_NAMES,
} from '@intellifin/infrastructure';
import { signOut } from '@intellifin/application';

import { getRuntime } from './bootstrap';
import { correlationIdFrom } from './correlation';

/**
 * Sign out (FR-1, FR-45).
 *
 * Story 1.4 shipped a shell with no way to end a session: a session ended only when the
 * browser's cookies were cleared. For a product whose premise is attributable action at a
 * shared workstation, that is a gap no story owned, so this story closes it. If the top
 * bar must stay bell-only, this file and `SignOutButton.tsx` are the whole of it and
 * nothing else depends on them.
 *
 * The session row is deleted and `security.sign-out` is appended in ONE transaction, so a
 * session cannot end unaudited and the chain cannot claim a sign-out that did not happen.
 * Better Auth's own `/sign-out` handler is deliberately NOT used for the deletion: it
 * commits on its own connection, outside any transaction this process controls.
 *
 * The cookie is cleared by this route rather than by Better Auth for the same reason —
 * the response is built here, after the transaction has committed.
 */

export const SIGN_OUT_UNAVAILABLE_MESSAGE = 'Sign-out failed. Try again.';

const NO_STORE = { 'cache-control': 'no-store' } as const;

/** `/api/auth/sign-out`, with or without a trailing slash. */
export function isSignOutPath(pathname: string): boolean {
  return /^\/api\/auth\/sign-out\/?$/.test(pathname);
}

/**
 * Expire every name the session cookie can have, on both spellings.
 *
 * `Max-Age=0` with an identical path, and `Secure` only on the `__Secure-` name — a
 * browser refuses a `__Secure-` cookie that is not, and refuses to overwrite a Secure
 * cookie from a non-secure attribute set. `HttpOnly` and `SameSite=Lax` mirror what
 * Better Auth set, because a browser matches an expiry by name, path and domain.
 */
export function clearedSessionCookies(): string[] {
  return SESSION_COOKIE_NAMES.map((name) => {
    const secure = name.startsWith('__Secure-') ? '; Secure' : '';
    return `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`;
  });
}

function withClearedCookies(body: unknown, status: number): Response {
  const headers = new Headers(NO_STORE);
  for (const cookie of clearedSessionCookies()) headers.append('set-cookie', cookie);
  headers.set('content-type', 'application/json');
  return new Response(JSON.stringify(body), { status, headers });
}

/**
 * Handle `POST /api/auth/sign-out`.
 *
 * A caller with no resolvable session is answered 200 with the cookies cleared. There is
 * nothing to audit and nothing to revoke, and reporting "you were not signed in" would
 * tell an unauthenticated caller something about the state of a cookie they hold.
 */
export async function handleSignOut(request: Request): Promise<Response> {
  const runtime = await getRuntime();
  const correlationId = correlationIdFrom(request);

  const session = await new BetterAuthSessionReader(
    runtime.auth,
    request.headers,
  ).currentSession();
  if (!session) return withClearedCookies({ ok: true }, 200);

  try {
    await signOut(new PostgresIdentityUnitOfWork(runtime.db, runtime.authConfig), {
      userId: session.userId,
      sessionId: session.sessionId,
      correlationId,
    });
  } catch (error) {
    // Fail closed the only way a sign-out can: the transaction rolled back, so the
    // session is still live and still attributable. The person is told to try again
    // rather than being handed a cleared cookie over a session that still exists.
    runtime.telemetry.captureError('Sign-out failed', error, {
      outcome: 'failure',
      correlationId,
    });
    return Response.json(
      { error: SIGN_OUT_UNAVAILABLE_MESSAGE },
      { status: 503, headers: NO_STORE },
    );
  }

  runtime.telemetry.info('Sign-out recorded', {
    outcome: 'success',
    userId: session.userId,
    sessionId: session.sessionId,
    correlationId,
  });
  return withClearedCookies({ ok: true }, 200);
}
