import { authenticate, withSession } from './authentication.js';
import {
  decodeSegment,
  json,
  normalizeHeaders,
  type NorthstarRequest,
  type NorthstarResponse,
} from './http.js';
import { enforceReadOnly } from './read-only.js';
import { ROUTES } from './routes.js';

/**
 * One request in, one response out. No sockets, no state, no clock.
 *
 * The ORDER of the three steps is the design:
 *
 *   1. read-only, applied ONCE, before anything else;
 *   2. authentication, applied ONCE, still above routing (Story 4.2);
 *   3. routing;
 *   4. a not-found answer that says so in the system's own words.
 *
 * Step 1 comes first so that a write to a path that does not exist is still REFUSED. A
 * 404 tells a Run "there is nothing here", which is a different and much more dangerous
 * statement than "this system does not accept that". Step 2 is above routing for the same
 * two reasons: a route cannot forget it, and an unauthenticated request to a path no route
 * serves must be told it is unauthenticated rather than told the path is empty.
 *
 * Read-only comes BEFORE authentication deliberately. A write is refused by this system
 * whoever is asking, and answering 401 first would suggest that a credential could make
 * one acceptable.
 */

export function parseRequest(
  method: string,
  url: string,
  headers: Readonly<Record<string, string | readonly string[] | undefined>> = {},
): NorthstarRequest {
  // A base is required and never used: every request this process sees is a path.
  const parsed = new URL(url, 'http://northstar.invalid');
  return {
    method: method.toUpperCase(),
    path: decodeSegment(parsed.pathname),
    rawPath: parsed.pathname,
    query: parsed.searchParams,
    headers: normalizeHeaders(headers),
  };
}

export function handleRequest(
  method: string,
  url: string,
  headers: Readonly<Record<string, string | readonly string[] | undefined>> = {},
): NorthstarResponse {
  const request = parseRequest(method, url, headers);

  const denied = enforceReadOnly(request);
  if (denied !== null) return denied;

  const authentication = authenticate(request);
  if (!authentication.ok) return authentication.response;

  const answer = route(request);
  return authentication.grant ? withSession(answer) : answer;
}

function route(request: NorthstarRequest): NorthstarResponse {
  for (const candidate of ROUTES) {
    // The pattern is matched against the RAW path, so a percent-encoded slash cannot
    // smuggle a segment past an anchored pattern; the handler decodes what it captured.
    const match = candidate.pattern.exec(request.rawPath);
    if (match !== null) return candidate.handle(request, match);
  }

  return json(404, {
    error: 'not_found',
    message: `No surface of any Northstar synthetic system is served at ${request.path}.`,
    path: request.path,
    index: '/',
  });
}
