import { decodeSegment, json, type NorthstarRequest, type NorthstarResponse } from './http.js';
import { enforceReadOnly } from './read-only.js';
import { ROUTES } from './routes.js';

/**
 * One request in, one response out. No sockets, no state, no clock.
 *
 * The ORDER of the three steps is the design:
 *
 *   1. read-only, applied ONCE, before anything else;
 *   2. routing;
 *   3. a not-found answer that says so in the system's own words.
 *
 * Step 1 comes first so that a write to a path that does not exist is still REFUSED. A
 * 404 tells a Run "there is nothing here", which is a different and much more dangerous
 * statement than "this system does not accept that".
 */

export function parseRequest(method: string, url: string): NorthstarRequest {
  // A base is required and never used: every request this process sees is a path.
  const parsed = new URL(url, 'http://northstar.invalid');
  return {
    method: method.toUpperCase(),
    path: decodeSegment(parsed.pathname),
    rawPath: parsed.pathname,
    query: parsed.searchParams,
  };
}

export function handleRequest(method: string, url: string): NorthstarResponse {
  const request = parseRequest(method, url);

  const denied = enforceReadOnly(request);
  if (denied !== null) return denied;

  for (const route of ROUTES) {
    // The pattern is matched against the RAW path, so a percent-encoded slash cannot
    // smuggle a segment past an anchored pattern; the handler decodes what it captured.
    const match = route.pattern.exec(request.rawPath);
    if (match !== null) return route.handle(request, match);
  }

  return json(404, {
    error: 'not_found',
    message: `No surface of any Northstar synthetic system is served at ${request.path}.`,
    path: request.path,
    index: '/',
  });
}
