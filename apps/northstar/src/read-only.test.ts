import { describe, expect, it } from 'vitest';

import { READ_ONLY_ERROR, READ_ONLY_RULE } from './read-only.js';
import { ROUTES } from './routes.js';
import { handleRequest } from './server.js';

/**
 * FR-3 at the system level, asserted over the ROUTE TABLE and not over a list of paths.
 *
 * A test that names its own sample cannot notice the route that was added without one.
 * Every case below is generated from `ROUTES`, so a surface added by a later story is
 * covered the moment it exists — and a surface added with no `probe` does not compile.
 */

/** Everything a client can send that is not a read. `CONNECT` and `TRACE` included. */
const WRITE_METHODS = [
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
  'TRACE',
  'CONNECT',
  'PROPFIND',
  'post',
] as const;

function bodyOf(response: { body: string | Uint8Array }): string {
  return typeof response.body === 'string' ? response.body : Buffer.from(response.body).toString('utf8');
}

describe('every route refuses every method but GET and HEAD', () => {
  for (const route of ROUTES) {
    for (const method of WRITE_METHODS) {
      it(`${method} ${route.probe} (${route.id})`, () => {
        const response = handleRequest(method, route.probe);
        expect(response.status).toBe(405);
        // RFC 9110: a 405 without `Allow` is a refusal that never says what is accepted.
        expect(response.headers['allow']).toBe('GET, HEAD');
        const payload = JSON.parse(bodyOf(response)) as Record<string, unknown>;
        expect(payload['error']).toBe(READ_ONLY_ERROR);
        // The rule itself, verbatim. A denial a Run records must name the rule, not
        // merely carry a status code.
        expect(payload['rule']).toBe(READ_ONLY_RULE);
        expect(payload['allowed']).toEqual(['GET', 'HEAD']);
        expect(payload['method']).toBe(method.toUpperCase());
      });
    }
  }
});

describe('the read-only rule is applied above routing', () => {
  it('refuses a write to a path no route serves, rather than answering 404', () => {
    // The difference matters to a Run: 404 says "there is nothing here", which is a
    // statement about the system's contents. 405 says "this system does not accept that".
    const response = handleRequest('POST', '/nothing/is/served/here');
    expect(response.status).toBe(405);
    expect(JSON.parse(bodyOf(response))['rule']).toBe(READ_ONLY_RULE);
  });

  it('answers 404 for a READ of a path no route serves', () => {
    const response = handleRequest('GET', '/nothing/is/served/here');
    expect(response.status).toBe(404);
  });

  it('lets every route answer a GET', () => {
    for (const route of ROUTES) {
      const response = handleRequest('GET', route.probe);
      expect(response.status, `${route.id} ${route.probe}`).not.toBe(405);
      expect(response.status, `${route.id} ${route.probe}`).toBeLessThan(500);
    }
  });

  it('answers HEAD exactly as GET, headers included', () => {
    for (const route of ROUTES) {
      const get = handleRequest('GET', route.probe);
      const head = handleRequest('HEAD', route.probe);
      expect(head.status, route.id).toBe(get.status);
      expect(head.headers, route.id).toEqual(get.headers);
    }
  });
});
