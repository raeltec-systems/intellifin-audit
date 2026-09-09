import { NON_MUTATING_READS, json, type NorthstarRequest, type NorthstarResponse } from './http.js';
import type { Route } from './routes.js';

/**
 * The read-only rule, in one place, applied once (FR-3).
 *
 * Every synthetic Northstar system is read-only AT THE SYSTEM LEVEL, so that FR-3 is
 * enforced by the system as well as by the registration's permitted-action allowlist. An
 * audit credential that has somehow been talked into attempting a write meets a refusal
 * from the thing it is writing to, not only from the thing that asked.
 *
 * **The predicate is "is this a declared non-mutating operation?", and it used to be "is
 * the method GET or HEAD?".** Those are not the same question, and the second was a proxy
 * for the first: a sign-in POST creates a SESSION and mutates no audited business data, so
 * refusing it protected nothing and forced LoanCore into a `GET`-with-a-header sign-in
 * that made the fixture less like a real Target System — which is the one thing a
 * synthetic fixture must not be. FR-3 constrains what the platform may INVOKE, and that is
 * enforced against the registration's frozen `permitted_actions`; this guard is the
 * system's own independent half of it. Recorded in full in
 * `_bmad-output/implementation-artifacts/epic-4-loancore-authentication-decision.md`.
 *
 * Every property that made the method rule good survives:
 *
 *   1. It runs BEFORE routing, in `handleRequest`, so it is not something a route can
 *      forget. A route added by a later story is read-only before it is written.
 *   2. It is FAIL-CLOSED. `Route.nonMutating` is optional and its ABSENCE means the route
 *      mutates, so a route added with no declaration is refused every method — including
 *      GET — until it says otherwise. The default lives in the type, not in a convention
 *      somebody has to remember.
 *   3. It runs before routing for a second reason: a write to a path that does not exist
 *      must still be REFUSED, not 404'd. A 404 tells a Run "there is nothing here"; a
 *      405 tells it "this system does not accept that, and here is the rule". The
 *      difference is what a Run can record.
 *   4. The denial is JSON on every surface, including the two web ones. A refusal a Run
 *      must be able to record is a refusal that should not need parsing out of a page.
 *
 * There is deliberately no "a POST that looks like a read is fine" heuristic. The
 * allowlist is per route and explicit; a heuristic would be the same category error one
 * level down.
 */

/** The verbatim sentence. `read-only.test.ts` and the browser suite hold it to the character. */
export const READ_ONLY_RULE =
  'FR-3: an audit credential may not write. Every Northstar synthetic system is read-only ' +
  'at the system level and refuses any operation a route has not declared non-mutating.';

export const READ_ONLY_ERROR = 'read_only_system';

/**
 * What the matched resource accepts, for the `Allow` header and the denial body.
 *
 * A path no route serves still ANSWERS a read — with this system's own 404 page, which is
 * a real answer and the one a proven absence needs — so the baseline is what a caller may
 * use there. A route that matched and declares nothing accepts NOTHING, and must not
 * borrow that baseline: saying `GET, HEAD` while the guard refuses a GET would be a header
 * that contradicts the response beside it.
 */
export function permittedOperations(matched: Route | null): readonly string[] {
  return matched === null ? [...NON_MUTATING_READS] : (matched.nonMutating ?? []);
}

export function readOnlyDenial(
  request: NorthstarRequest,
  permitted: readonly string[],
): NorthstarResponse {
  const denial = json(405, {
    error: READ_ONLY_ERROR,
    rule: READ_ONLY_RULE,
    message: `This system is read-only. ${request.method} is not a declared non-mutating operation of ${request.path}.`,
    method: request.method,
    path: request.path,
    allowed: [...permitted],
  });
  return {
    ...denial,
    // RFC 9110 requires `Allow` on a 405. Without it the refusal is a status code with no
    // statement of what the system does accept.
    headers: { ...denial.headers, allow: permitted.join(', ') },
  };
}

/**
 * `null` when the request may proceed to routing.
 *
 * `matched` is the route the request resolved to, or `null` for a path no route serves.
 * The caller matches ONCE and hands the answer to both this and the router, so the rule
 * and the routing can never disagree about which route a request is.
 */
export function enforceReadOnly(
  request: NorthstarRequest,
  matched: Route | null,
): NorthstarResponse | null {
  const permitted = permittedOperations(matched);
  // The method is compared as the client sent it, upper-cased by `parseRequest`. A
  // declaration is written in upper case and matched exactly: a route that declared
  // `post` would permit nothing, which is the fail-closed direction and is asserted.
  //
  // A read of an unserved path proceeds, and routing answers this system's own 404. A
  // WRITE to it does not: the baseline says which operations that path accepts, and a
  // mutation is not one of them anywhere on this system.
  if (permitted.includes(request.method)) return null;
  return readOnlyDenial(request, permitted);
}
