import { createHash } from 'node:crypto';

import { loanCoreCredential } from './fixtures.js';
import { json, type NorthstarRequest, type NorthstarResponse } from './http.js';

/**
 * LoanCore requires a credential, and it takes it through a real sign-in form (Story 4.2).
 *
 * Story 1.8 recorded that LoanCore has no sign-in form because a sign-in is a POST and
 * every Northstar system refused every method but GET and HEAD. Story 4.2 then built a
 * `GET`-with-an-`Authorization`-header sign-in around that rule. Both were wrong for the
 * same reason: the method was being used as a proxy for MUTATION. A sign-in creates a
 * session and touches no audited business data, the read-only guard now says so by name,
 * and LoanCore authenticates the way an application actually does
 * (`_bmad-output/implementation-artifacts/epic-4-loancore-authentication-decision.md`).
 *
 * Authentication is applied the way read-only is: ONE middleware, applied ONCE, ABOVE
 * routing, so a route added by a later story is authenticated before it is written.
 *
 * - `/loancore` and `/loancore/sign-in` are the PUBLIC surfaces, and they are public for
 *   the reason `apps/web`'s `/sign-in` is: a caller who cannot reach the sign-in cannot
 *   sign in. `/loancore` serves the FORM to a caller with no session and the user
 *   administration home to one with a session, which is what makes the frozen allowed
 *   origin the sign-in destination — the platform navigates to the origin its Procedure
 *   Version froze and needs to guess no path and parse no page to find the form.
 * - Every other `/loancore` path answers **401** to a caller with no session, with a
 *   `WWW-Authenticate` challenge naming the form and a JSON body in the shape the 405
 *   denial already uses. A refusal a Run must record should not need parsing out of a
 *   page.
 * - `POST /loancore/sign-in` carrying the credential is answered with the session cookie.
 *   Every later request carries it, which is what "the session is held in the workspace"
 *   means.
 *
 * There is no `Authorization` header sign-in any more, deliberately. Leaving one would
 * make the form decorative: a test could pass with the form removed, which is exactly the
 * failure "assert both directions" exists to prevent.
 *
 * **Only LoanCore.** The other synthetic systems stay unauthenticated: adding it
 * everywhere would make every Epic 3 adapter test carry a credential for no reason, and
 * Epic 3's adapter path resolves its credential from the frozen registration rather than
 * from anything this fixture invented.
 *
 * **The credential is SYNTHETIC and lives in the fixtures**, like every other synthetic
 * value. Story 1.8's rule that a REAL credential is the one thing this environment must not
 * have is unchanged, and is exactly why this one is invented and declared in a dataset that
 * carries the NFR-13 marker.
 */

/** The path prefix that requires a credential. There is exactly one. */
export const AUTHENTICATED_PREFIX = '/loancore';

/** Where the form is served and where it posts. One path, two operations. */
export const SIGN_IN_PATH = '/loancore/sign-in';

/** The form field the credential is typed into. */
export const CREDENTIAL_FIELD = 'credential';

/** The cookie a signed-in session is held in. */
export const SESSION_COOKIE = 'loancore_session';

export const AUTHENTICATION_ERROR = 'authentication_required';

/**
 * The challenge a 401 carries.
 *
 * RFC 9110 requires one, and it must name a scheme. There is no registered scheme for
 * "sign in at this form", so this system declares its own and says where the form is —
 * which is a machine-readable statement a Run can record, unlike a `Bearer` challenge
 * that would name a way of authenticating this system no longer has.
 */
export const AUTHENTICATION_CHALLENGE = `FormSignIn realm="LoanCore", form="${SIGN_IN_PATH}"`;

/** The verbatim sentence. The unit suite and the browser suite hold it to the character. */
export const AUTHENTICATION_RULE =
  'FR-3: LoanCore is an authenticated system. Every request under /loancore except the ' +
  'sign-in surfaces must carry the session cookie granted by a sign-in. The credential is ' +
  'submitted to the form at /loancore/sign-in, which this system declares non-mutating ' +
  'because it creates a session and no audited business data.';

/**
 * The session value a credentialed request is granted.
 *
 * Derived from the credential rather than equal to it, so the token itself never leaves in
 * a `Set-Cookie` and a test asserting "this exact string appears nowhere" stays meaningful.
 * Deterministic and stateless on purpose: `handleRequest` is a pure function with no
 * sockets, no state and no clock, and a synthetic system that grew a session store would
 * have a second thing that can go wrong while a Run is being observed.
 */
function sessionValue(): string {
  return createHash('sha256').update(`loancore-session:${loanCoreCredential().token}`).digest('hex');
}

/** The path, with a single trailing slash removed. `/loancore/` and `/loancore` are one surface. */
function normalizedPath(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

/** `true` when the path is under the authenticated prefix, on a path boundary. */
export function requiresCredential(path: string): boolean {
  return path === AUTHENTICATED_PREFIX || path.startsWith(`${AUTHENTICATED_PREFIX}/`);
}

/**
 * The two surfaces a signed-out caller may reach, named rather than derived.
 *
 * An allowlist of exactly two paths, in the spirit of `apps/web`'s `isPublicPath`: a
 * pattern here would be a second allowlist in another language, and it fails exactly as a
 * slash-less prefix does.
 */
export function isSignInSurface(path: string): boolean {
  const normalized = normalizedPath(path);
  return normalized === AUTHENTICATED_PREFIX || normalized === SIGN_IN_PATH;
}

/** `true` when this request carries the session cookie this system granted. */
export function presentedSession(request: NorthstarRequest): boolean {
  const cookies = request.headers['cookie'] ?? '';
  const wanted = sessionValue();
  for (const pair of cookies.split(';')) {
    const index = pair.indexOf('=');
    if (index < 0) continue;
    if (pair.slice(0, index).trim() !== SESSION_COOKIE) continue;
    if (pair.slice(index + 1).trim() === wanted) return true;
  }
  return false;
}

/**
 * `true` when this form submission carries the declared credential.
 *
 * The body is `application/x-www-form-urlencoded`, parsed with `URLSearchParams`, which
 * takes the FIRST value of a repeated field — a second `credential` is not a second chance
 * at it, exactly as a repeated header is not.
 */
export function presentedCredential(request: NorthstarRequest): boolean {
  const submitted = new URLSearchParams(request.body).get(CREDENTIAL_FIELD);
  return submitted !== null && submitted === loanCoreCredential().token;
}

export function authenticationDenial(request: NorthstarRequest): NorthstarResponse {
  const denial = json(401, {
    error: AUTHENTICATION_ERROR,
    rule: AUTHENTICATION_RULE,
    message: 'This account directory requires the audit account credential.',
    method: request.method,
    path: request.path,
    system: 'LoanCore',
    signIn: SIGN_IN_PATH,
  });
  return {
    ...denial,
    headers: {
      ...denial.headers,
      // RFC 9110 requires a challenge on a 401. Without it the refusal is a status code
      // with no statement of how to satisfy it.
      'www-authenticate': AUTHENTICATION_CHALLENGE,
    },
  };
}

/** What a `Set-Cookie` looks like for a granted session. */
export function sessionCookieHeader(): string {
  return `${SESSION_COOKIE}=${sessionValue()}; Path=${AUTHENTICATED_PREFIX}; HttpOnly; SameSite=Lax`;
}

export type AuthenticationVerdict =
  /** Proceed to routing. */
  | { readonly ok: true }
  | { readonly ok: false; readonly response: NorthstarResponse };

/**
 * Decide whether a request may reach routing.
 *
 * Applied above routing for the same two reasons the read-only rule is: a route cannot
 * forget it, and a request to a path no route serves is REFUSED rather than 404'd — "there
 * is nothing here" and "you are not authenticated to this system" are different statements
 * to a Run, and only the second is one it can act on.
 *
 * Granting the session is NOT here. The sign-in route is what knows the credential was
 * correct, so it is what answers with the cookie; a middleware that granted one would be a
 * second place a session can be established.
 */
export function authenticate(request: NorthstarRequest): AuthenticationVerdict {
  if (!requiresCredential(request.path)) return { ok: true };
  if (isSignInSurface(request.path)) return { ok: true };
  if (presentedSession(request)) return { ok: true };
  return { ok: false, response: authenticationDenial(request) };
}

/** The routed response, with the session this request was granted. */
export function withSession(response: NorthstarResponse): NorthstarResponse {
  return { ...response, headers: { ...response.headers, 'set-cookie': sessionCookieHeader() } };
}
