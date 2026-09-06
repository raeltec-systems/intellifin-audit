import { createHash } from 'node:crypto';

import { loanCoreCredential } from './fixtures.js';
import { json, type NorthstarRequest, type NorthstarResponse } from './http.js';

/**
 * LoanCore requires a credential, and it requires it on a GET (Story 4.2).
 *
 * Story 1.8 recorded that LoanCore has no sign-in form, and the reason was right: a
 * sign-in is a POST, `enforceReadOnly` refuses every method but GET and HEAD ABOVE
 * routing, and that invariant is not up for negotiation for one story's convenience. What
 * was wrong was the conclusion — that LoanCore therefore has no authentication at all.
 * Story 4.2 has to sign in, and Story 4.11 has to assert that no credential reaches an
 * artifact; against a system with no credential in play, that assertion passes because
 * nothing happened.
 *
 * So authentication is added the way read-only was: ONE middleware, applied ONCE, ABOVE
 * routing, so a route added by a later story is authenticated before it is written.
 *
 * - An unauthenticated `GET` to any `/loancore` path answers **401** with
 *   `WWW-Authenticate` and a JSON body in the shape the 405 denial already uses. A refusal
 *   a Run must record should not need parsing out of a page.
 * - A `GET` carrying the credential is answered normally AND granted a session cookie. That
 *   is the sign-in: no form, no POST, no relaxation of the read-only rule.
 * - Every later `GET` carries the cookie, which is what "the session is held in the
 *   workspace" means.
 *
 * **Only LoanCore.** The other synthetic systems stay unauthenticated: adding it everywhere
 * would make every Epic 3 adapter test carry a credential for no reason, and Epic 3's
 * adapter path resolves its credential from the frozen registration rather than from a
 * header this fixture invented.
 *
 * **The credential is SYNTHETIC and lives in the fixtures**, like every other synthetic
 * value. Story 1.8's rule that a REAL credential is the one thing this environment must not
 * have is unchanged, and is exactly why this one is invented and declared in a dataset that
 * carries the NFR-13 marker.
 */

/** The path prefix that requires a credential. There is exactly one. */
export const AUTHENTICATED_PREFIX = '/loancore';

/** The cookie a signed-in session is held in. */
export const SESSION_COOKIE = 'loancore_session';

/** The scheme the credential is presented in. Bearer, and nothing else. */
const BEARER = 'bearer ';

export const AUTHENTICATION_ERROR = 'authentication_required';

/** The verbatim sentence. The unit suite and the browser suite hold it to the character. */
export const AUTHENTICATION_RULE =
  'FR-3: LoanCore is an authenticated system. Every request under /loancore must carry the ' +
  'audit account credential in an Authorization header, or the session cookie a credentialed ' +
  'request was granted. There is no sign-in form: this system refuses every method but GET ' +
  'and HEAD, so the credential is presented on the read itself.';

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

/** `true` when the path is under the authenticated prefix, on a path boundary. */
export function requiresCredential(path: string): boolean {
  return path === AUTHENTICATED_PREFIX || path.startsWith(`${AUTHENTICATED_PREFIX}/`);
}

function presentedCredential(request: NorthstarRequest): boolean {
  const header = request.headers['authorization'] ?? '';
  if (!header.toLowerCase().startsWith(BEARER)) return false;
  return header.slice(BEARER.length).trim() === loanCoreCredential().token;
}

function presentedSession(request: NorthstarRequest): boolean {
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

export function authenticationDenial(request: NorthstarRequest): NorthstarResponse {
  const denial = json(401, {
    error: AUTHENTICATION_ERROR,
    rule: AUTHENTICATION_RULE,
    message: 'This account directory requires the audit account credential.',
    method: request.method,
    path: request.path,
    system: 'LoanCore',
  });
  return {
    ...denial,
    headers: {
      ...denial.headers,
      // RFC 9110 requires a challenge on a 401. Without it the refusal is a status code
      // with no statement of how to satisfy it.
      'www-authenticate': 'Bearer realm="LoanCore", charset="UTF-8"',
    },
  };
}

/** What a `Set-Cookie` looks like for a granted session. */
export function sessionCookieHeader(): string {
  return `${SESSION_COOKIE}=${sessionValue()}; Path=${AUTHENTICATED_PREFIX}; HttpOnly; SameSite=Lax`;
}

export type AuthenticationVerdict =
  /** Proceed to routing. `grant` is set when THIS response establishes the session. */
  | { readonly ok: true; readonly grant: boolean }
  | { readonly ok: false; readonly response: NorthstarResponse };

/**
 * Decide whether a request may reach routing, and whether it establishes a session.
 *
 * Applied above routing for the same two reasons the read-only rule is: a route cannot
 * forget it, and a request to a path no route serves is REFUSED rather than 404'd — "there
 * is nothing here" and "you are not authenticated to this system" are different statements
 * to a Run, and only the second is one it can act on.
 */
export function authenticate(request: NorthstarRequest): AuthenticationVerdict {
  if (!requiresCredential(request.path)) return { ok: true, grant: false };
  if (presentedCredential(request)) return { ok: true, grant: true };
  if (presentedSession(request)) return { ok: true, grant: false };
  return { ok: false, response: authenticationDenial(request) };
}

/** The routed response, with the session this request was granted. */
export function withSession(response: NorthstarResponse): NorthstarResponse {
  return { ...response, headers: { ...response.headers, 'set-cookie': sessionCookieHeader() } };
}
