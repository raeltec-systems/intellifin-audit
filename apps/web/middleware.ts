import { NextResponse, type NextRequest } from 'next/server';

import { SESSION_COOKIE_PREFIXES } from './src/session-cookie';
import { SIGN_IN_PATH, isApiPath, isPublicPath } from './src/route-access';

/**
 * The outer, default-deny gate (FR-1).
 *
 * Middleware cannot reach PostgreSQL, so it cannot authorize anything: all it can see
 * is whether a session cookie is present. That is deliberately enough. Its job is to
 * make an unprotected route impossible by default, so that a route family added by a
 * later story is refused for an anonymous caller even before its handler exists.
 *
 * The real decision — is this session valid, what role does it hold now, and may that
 * role do this — is `src/require-role.ts`, which runs inside the handler with the
 * database in reach. Neither layer is sufficient alone: this one cannot authorize,
 * and that one can be forgotten on a new route.
 *
 * A cookie here is only a hint. It is never trusted as proof of a session.
 */
export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  const hasSessionCookie = request.cookies
    .getAll()
    .some((cookie) => SESSION_COOKIE_PREFIXES.some((prefix) => cookie.name.startsWith(prefix)));
  if (hasSessionCookie) return NextResponse.next();

  if (isApiPath(pathname)) {
    // No body at all: a refusal must disclose nothing, not even which route it was.
    return new NextResponse(null, {
      status: 401,
      headers: { 'cache-control': 'no-store' },
    }) as NextResponse;
  }

  const target = new URL(SIGN_IN_PATH, request.nextUrl);
  return NextResponse.redirect(target);
}

/**
 * Run on everything except Next's own static output. The allowlist lives in
 * `route-access.ts`, not here: a matcher that skipped a path would skip it silently,
 * which is exactly the failure default-deny exists to prevent.
 */
export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
