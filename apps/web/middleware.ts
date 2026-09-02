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

  // ABSOLUTE, and it has to be. `sign-out-route.ts` sends a RELATIVE `Location` so that a
  // forged `Host` header cannot move the redirect to an attacker's origin, and that is
  // the better construction — but it cannot be used here. Next parses a middleware
  // response's `Location` as a URL and throws `TypeError: Invalid URL` on a relative one,
  // which turns every protected path into a 500 and takes default-deny down with it.
  // Verified against `next dev`, not reasoned about.
  //
  // What contains the risk instead is `no-store`, immediately below. An attacker cannot
  // set the `Host` header of a victim's browser cross-origin; the way a Host-derived
  // redirect reaches a victim is a shared cache that stored it under the path alone, and
  // `no-store` is what stops that. It earns its place twice over: the same cache could
  // otherwise pin a protected path to this redirect for a signed-in person, or serve a
  // cached page to somebody signed out.
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
