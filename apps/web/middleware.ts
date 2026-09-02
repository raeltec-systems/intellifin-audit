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

  // `no-store` on the redirect too. A shared cache that stored this 307 for, say,
  // `/runs/RUN-2437` would then serve it to a signed-in person who should have seen
  // the page -- and, worse, could serve a cached page to somebody signed out.
  const target = new URL(SIGN_IN_PATH, request.nextUrl);
  const redirect = NextResponse.redirect(target);
  redirect.headers.set('cache-control', 'no-store');
  return redirect;
}

/**
 * Run on EVERY path. There is deliberately no negative lookahead here.
 *
 * A matcher exclusion is a second allowlist, written in a different language, that
 * nothing tests — and it fails the same way a prefix without a trailing slash does:
 * `(?!_next/image)` also skips `/_next/imagery` and `/_next/imagex/leak`. Those are
 * harmless only for as long as no route happens to live there, which is not a property
 * anybody is checking. So the matcher decides nothing and `isPublicPath` decides
 * everything, in one place, under test.
 *
 * The cost is one function call on a static asset request, which is nothing.
 */
export const config = {
  matcher: ['/(.*)'],
};
