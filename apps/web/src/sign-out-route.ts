import {
  BetterAuthSessionReader,
  PostgresIdentityUnitOfWork,
  SESSION_COOKIE_NAMES,
} from '@intellifin/infrastructure';
import { signOut } from '@intellifin/application';

import { getRuntime } from './bootstrap';
import { SESSION_COOKIE_PREFIXES } from './session-cookie';
import { correlationIdFrom } from './correlation';
import { SIGN_IN_PATH, SIGN_OUT_PATH } from './route-access';

/**
 * Sign out (FR-1, FR-45).
 *
 * Story 1.4 shipped a shell with no way to end a session: a session ended only when the
 * browser's cookies were cleared. For a product whose premise is attributable action at a
 * shared workstation, that is a gap no story owned, so this story closes it. If the top
 * bar must stay bell-only, this file and `SignOutButton.tsx` are the whole of it and
 * nothing else depends on them.
 *
 * **It is a native form target, and that is the point.** The control is a real
 * `<form method="post">` whose submission the browser performs itself, so it works from
 * the moment the HTML lands — before React hydrates, and with JavaScript disabled
 * entirely. The first version of this route answered JSON to a `fetch` in an `onClick`
 * handler, which meant a click during the hydration window was swallowed: no request, no
 * navigation, and a person at a shared workstation walking away from a session that
 * never ended. A sign-out that silently does nothing is a security defect, not a
 * rendering delay, so this path may not depend on client JavaScript at all.
 *
 * Because a browser is performing the submission, every answer is one a browser can act
 * on: a 303 to `/sign-in` on success, and an HTML page on failure. There is no response
 * here that only a script could interpret.
 *
 * The session row is deleted and `security.sign-out` is appended in ONE transaction, so a
 * session cannot end unaudited and the chain cannot claim a sign-out that did not happen.
 * Better Auth's own `/sign-out` handler is deliberately NOT used for the deletion: it
 * commits on its own connection, outside any transaction this process controls.
 *
 * It is idempotent. Signing out a session that has already ended answers the same 303,
 * because a double submit, a resubmitted form, and a second tab are all ordinary things
 * for a person to do — and none of them should meet a 500.
 */

export const SIGN_OUT_UNAVAILABLE_MESSAGE = 'Sign-out failed. Try again.';

/** Re-exported so a caller reading this handler finds the path it answers on. */
export { SIGN_OUT_PATH };

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

/**
 * The answer to a completed sign-out: 303 to the sign-in page, cookies expired.
 *
 * 303 rather than 302 or 307 on purpose. It is the status that tells a browser to follow
 * with a GET after a POST, so the resubmission prompt a person gets on Back never
 * re-posts the sign-out, and a 307 — which would repeat the POST at `/sign-in` — cannot
 * happen.
 */
function signedOut(): Response {
  const headers = new Headers(NO_STORE);
  for (const cookie of clearedSessionCookies()) headers.append('set-cookie', cookie);
  // A RELATIVE location, deliberately. `new URL(SIGN_IN_PATH, request.url)` reads the
  // host out of the request, which behind a proxy comes from the `Host` header the
  // client sent — so a forged Host would send the browser to an attacker's origin at the
  // exact moment its session cookies are cleared and it is looking for somewhere to type
  // a password. A relative Location is valid (RFC 9110 §10.2.2) and every browser
  // resolves it against the origin it actually connected to, which no header can move.
  headers.set('location', SIGN_IN_PATH);
  return new Response(null, { status: 303, headers });
}

/**
 * The answer when the event could not be appended: an HTML page, because the caller is a
 * browser performing a form submission and JSON would land as raw text on screen.
 *
 * It says plainly that nothing happened, which is the truth — the transaction rolled
 * back, so the session is still live and still attributable. Static markup, no
 * interpolation, no script.
 */
function signOutFailed(): Response {
  const body = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Sign-out failed · IntelliFin Audit</title></head>
<body>
<h1>${SIGN_OUT_UNAVAILABLE_MESSAGE}</h1>
<p>You are still signed in and your session is unchanged. Nothing was recorded.</p>
<p><a href="/">Return to IntelliFin Audit</a></p>
</body>
</html>`;
  return new Response(body, {
    status: 503,
    headers: { ...NO_STORE, 'content-type': 'text/html; charset=utf-8' },
  });
}

/**
 * Handle `POST /api/auth/sign-out`.
 *
 * A caller with no resolvable session is redirected exactly as a successful one is.
 * There is nothing to audit and nothing to revoke, and answering differently would tell
 * an unauthenticated caller something about the state of a cookie they hold — as well as
 * turning an ordinary double submit into an error page.
 */
/** Whether the request even carries something that could be a session. */
export function carriesSessionCookie(request: Request): boolean {
  const header = request.headers.get('cookie');
  if (!header) return false;
  return header
    .split(';')
    .some((pair) =>
      SESSION_COOKIE_PREFIXES.some((prefix) => pair.trim().startsWith(`${prefix}=`)),
    );
}

/**
 * Report a failure without letting the reporting itself throw.
 *
 * The failure being reported may BE the runtime, so acquiring it to log can fail too.
 * `instrumentation.ts` already reported a runtime that would not start.
 */
async function reportSignOutFailure(error: unknown, correlationId: string): Promise<void> {
  try {
    const runtime = await getRuntime();
    runtime.telemetry.captureError('Sign-out failed', error, {
      outcome: 'failure',
      correlationId,
    });
  } catch {
    // Nowhere left to write.
  }
}

export async function handleSignOut(request: Request): Promise<Response> {
  const correlationId = correlationIdFrom(request);

  // No session cookie at all: nothing to revoke, nothing to audit, and no reason to open
  // a connection. This matters because `/api/auth/**` is the one publicly allowlisted
  // surface and this handler intercepts BEFORE Better Auth's rate limiter ever sees the
  // path, so sign-out is not rate limited. Without this check every anonymous POST would
  // cost a database round trip. With it, an unauthenticated flood is answered from
  // memory, and an authenticated one limits itself: the first call deletes the session,
  // so every call after it takes this branch.
  if (!carriesSessionCookie(request)) return signedOut();

  try {
    // INSIDE the try, both of them. `getRuntime()` reads configuration and opens the
    // pool, and `currentSession()` queries it: a database that is down throws here, not
    // in the append. Left outside, that throw escaped the route entirely and the caller
    // got a framework 500 — an HTML page saying nothing, instead of the fail-closed page
    // written for exactly this case, which says the session is unchanged.
    const runtime = await getRuntime();
    const session = await new BetterAuthSessionReader(
      runtime.auth,
      request.headers,
    ).currentSession();
    // A cookie that no longer resolves — expired, revoked, already signed out. Same
    // answer as success: idempotent, and it discloses nothing about the cookie's state.
    if (!session) return signedOut();

    await signOut(new PostgresIdentityUnitOfWork(runtime.db, runtime.authConfig), {
      userId: session.userId,
      sessionId: session.sessionId,
      correlationId,
    });

    runtime.telemetry.info('Sign-out recorded', {
      outcome: 'success',
      userId: session.userId,
      sessionId: session.sessionId,
      correlationId,
    });
    return signedOut();
  } catch (error) {
    // Fail closed the only way a sign-out can: the transaction rolled back, so the
    // session is still live and still attributable. The person is told to try again
    // rather than being handed a cleared cookie over a session that still exists.
    await reportSignOutFailure(error, correlationId);
    return signOutFailed();
  }
}
