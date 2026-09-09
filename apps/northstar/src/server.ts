import { authenticate } from './authentication.js';
import {
  decodeSegment,
  json,
  normalizeHeaders,
  type NorthstarRequest,
  type NorthstarResponse,
} from './http.js';
import { enforceReadOnly } from './read-only.js';
import { matchRoute } from './routes.js';

/**
 * One request in, one response out. No sockets, no state, no clock.
 *
 * The ORDER of the steps is the design:
 *
 *   1. match, ONCE, without calling anything;
 *   2. read-only, applied ONCE, before any handler runs;
 *   3. authentication, applied ONCE, still above every handler (Story 4.2);
 *   4. the handler, or a not-found answer that says so in the system's own words.
 *
 * Step 1 is a lookup and not an execution: the read-only rule now asks the matched route
 * what it declares, so the rule and the routing must agree about which route a request is,
 * and matching twice is how they would come to disagree. Nothing the route can do runs
 * before step 2.
 *
 * Step 2 comes before the handler so that a write to a path that does not exist is still
 * REFUSED. A 404 tells a Run "there is nothing here", which is a different and much more
 * dangerous statement than "this system does not accept that". Step 3 is above the handler
 * for the same two reasons: a route cannot forget it, and an unauthenticated request to a
 * path no route serves must be told it is unauthenticated rather than told the path is
 * empty.
 *
 * Read-only comes BEFORE authentication deliberately. A mutation is refused by this system
 * whoever is asking, and answering 401 first would suggest that a credential could make
 * one acceptable.
 */

export function parseRequest(
  method: string,
  url: string,
  headers: Readonly<Record<string, string | readonly string[] | undefined>> = {},
  body = '',
): NorthstarRequest {
  // A base is required and never used: every request this process sees is a path.
  const parsed = new URL(url, 'http://northstar.invalid');
  return {
    method: method.toUpperCase(),
    path: decodeSegment(parsed.pathname),
    rawPath: parsed.pathname,
    query: parsed.searchParams,
    headers: normalizeHeaders(headers),
    body,
  };
}

export function handleRequest(
  method: string,
  url: string,
  headers: Readonly<Record<string, string | readonly string[] | undefined>> = {},
  body = '',
): NorthstarResponse {
  const request = parseRequest(method, url, headers, body);

  const matched = matchRoute(request.rawPath);

  const denied = enforceReadOnly(request, matched?.route ?? null);
  if (denied !== null) return denied;

  const authentication = authenticate(request);
  if (!authentication.ok) return authentication.response;

  return matched === null ? notFound(request) : matched.route.handle(request, matched.match);
}

function notFound(request: NorthstarRequest): NorthstarResponse {
  return json(404, {
    error: 'not_found',
    message: `No surface of any Northstar synthetic system is served at ${request.path}.`,
    path: request.path,
    index: '/',
  });
}
