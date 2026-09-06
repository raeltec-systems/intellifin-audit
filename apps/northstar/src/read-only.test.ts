import { describe, expect, it } from 'vitest';

import { NON_MUTATING_READS } from './http.js';
import { READ_ONLY_ERROR, READ_ONLY_RULE, enforceReadOnly, permittedOperations } from './read-only.js';
import { ROUTES, type Route } from './routes.js';
import { handleRequest, parseRequest } from './server.js';

/**
 * FR-3 at the system level, asserted over the ROUTE TABLE and not over a list of paths.
 *
 * A test that names its own sample cannot notice the route that was added without one.
 * Every case below is generated from `ROUTES`, so a surface added by a later story is
 * covered the moment it exists — and a surface added with no `probe` does not compile.
 *
 * **Both directions, on purpose.** The rule is no longer "refuse every method but GET and
 * HEAD"; it is "refuse every operation a route has not declared non-mutating", and a suite
 * that asserted only the refusals would pass against a guard that refuses EVERYTHING —
 * including the sign-in this system now depends on, and including every read of every
 * surface. So each route is asserted to PERMIT exactly what it declares and to REFUSE
 * everything else.
 */

/** Everything a client can send. Nothing here is on any route's declaration by default. */
const EVERY_METHOD = [
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
  'TRACE',
  'CONNECT',
  'PROPFIND',
] as const;

function bodyOf(response: { body: string | Uint8Array }): string {
  return typeof response.body === 'string' ? response.body : Buffer.from(response.body).toString('utf8');
}

/** The credential is only needed to get PAST the guard; the guard itself never reads it. */
const SIGN_IN_BODY = 'credential=whatever-the-guard-does-not-read';

describe('every route declares what it permits, and the guard refuses everything else', () => {
  for (const route of ROUTES) {
    const declared = new Set(route.nonMutating ?? []);
    for (const method of EVERY_METHOD) {
      const permitted = declared.has(method);
      it(`${permitted ? 'permits' : 'refuses'} ${method} ${route.probe} (${route.id})`, () => {
        const response = handleRequest(method, route.probe, {}, SIGN_IN_BODY);
        if (permitted) {
          // The half that a guard refusing everything would fail. It is not asserted as a
          // 200 — a route may legitimately answer 401, 404 or 503 — only that the
          // READ-ONLY rule let it through to something that answered.
          expect(response.status).not.toBe(405);
          return;
        }
        expect(response.status).toBe(405);
        // RFC 9110: a 405 without `Allow` is a refusal that never says what is accepted.
        expect(response.headers['allow']).toBe([...declared].join(', '));
        const payload = JSON.parse(bodyOf(response)) as Record<string, unknown>;
        expect(payload['error']).toBe(READ_ONLY_ERROR);
        // The rule itself, verbatim. A denial a Run records must name the rule, not
        // merely carry a status code.
        expect(payload['rule']).toBe(READ_ONLY_RULE);
        expect(payload['allowed']).toEqual([...declared]);
        expect(payload['method']).toBe(method);
      });
    }
  }

  it('found the sign-in route, so the permitted-POST case above is not vacuous', () => {
    // The failure this guards is a rename that leaves the one interesting case
    // unexecuted, with every remaining case a refusal and the suite green.
    const signIn = ROUTES.filter((route) => (route.nonMutating ?? []).includes('POST'));
    expect(signIn.map((route) => route.id)).toEqual(['loancore-sign-in']);
  });

  it('lets every route answer the reads it declares', () => {
    for (const route of ROUTES) {
      for (const method of route.nonMutating ?? []) {
        if (method !== 'GET' && method !== 'HEAD') continue;
        const response = handleRequest(method, route.probe);
        expect(response.status, `${route.id} ${route.probe}`).not.toBe(405);
        expect(response.status, `${route.id} ${route.probe}`).toBeLessThan(500);
      }
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

describe('the declaration is fail-closed', () => {
  /** A route exactly as somebody would write one having forgotten the declaration. */
  const undeclared: Route = {
    id: 'undeclared',
    system: 'Nowhere',
    pattern: /^\/undeclared$/,
    probe: '/undeclared',
    summary: 'A route added by a later story that says nothing about what it mutates.',
    handle: () => ({ status: 200, headers: {}, body: '' }),
  };

  for (const method of EVERY_METHOD) {
    it(`refuses ${method} on a route that declares nothing`, () => {
      // The forcing function. A route that has not said what it does is treated as
      // mutating, so its GET is refused too — and the refusal says the resource accepts
      // nothing rather than borrowing the read baseline, which would be an `Allow` header
      // contradicting the response beside it.
      const request = parseRequest(method, undeclared.probe);
      const denial = enforceReadOnly(request, undeclared);
      expect(denial?.status).toBe(405);
      expect(denial?.headers['allow']).toBe('');
      expect(JSON.parse(bodyOf(denial!))['allowed']).toEqual([]);
    });
  }

  it('matches a declaration exactly, so a lower-case one permits nothing', () => {
    const lowercased: Route = { ...undeclared, nonMutating: ['get', 'post'] };
    expect(enforceReadOnly(parseRequest('GET', lowercased.probe), lowercased)?.status).toBe(405);
    expect(enforceReadOnly(parseRequest('POST', lowercased.probe), lowercased)?.status).toBe(405);
  });

  it('permits exactly what a declaration names, and nothing adjacent', () => {
    const declared: Route = { ...undeclared, nonMutating: ['GET', 'POST'] };
    expect(enforceReadOnly(parseRequest('GET', declared.probe), declared)).toBeNull();
    expect(enforceReadOnly(parseRequest('POST', declared.probe), declared)).toBeNull();
    expect(enforceReadOnly(parseRequest('HEAD', declared.probe), declared)?.status).toBe(405);
    expect(enforceReadOnly(parseRequest('PUT', declared.probe), declared)?.status).toBe(405);
  });

  it('says a matched route accepts nothing, and an unserved path accepts the reads', () => {
    expect(permittedOperations(undeclared)).toEqual([]);
    expect(permittedOperations(null)).toEqual([...NON_MUTATING_READS]);
  });
});

describe('the read-only rule is applied above routing', () => {
  it('refuses a write to a path no route serves, rather than answering 404', () => {
    // The difference matters to a Run: 404 says "there is nothing here", which is a
    // statement about the system's contents. 405 says "this system does not accept that".
    const response = handleRequest('POST', '/nothing/is/served/here');
    expect(response.status).toBe(405);
    expect(JSON.parse(bodyOf(response))['rule']).toBe(READ_ONLY_RULE);
    expect(response.headers['allow']).toBe('GET, HEAD');
  });

  it('answers 404 for a READ of a path no route serves', () => {
    const response = handleRequest('GET', '/nothing/is/served/here');
    expect(response.status).toBe(404);
  });

  it('refuses a write to a LoanCore path no route serves as a WRITE, not as a 401', () => {
    // Read-only runs before authentication deliberately: answering 401 first would suggest
    // that a credential could make a mutation acceptable.
    expect(handleRequest('POST', '/loancore/nothing/is/served/here').status).toBe(405);
  });

  it('refuses a POST to a LoanCore route that has not declared one', () => {
    // The sign-in's declaration is per ROUTE. There is no "a POST that looks like a read
    // is fine" heuristic, so the sibling surfaces of the one route that declares a POST
    // still refuse one.
    expect(handleRequest('POST', '/loancore').status).toBe(405);
    expect(handleRequest('POST', '/loancore/users').status).toBe(405);
    expect(handleRequest('POST', '/loancore/users/E-000103').status).toBe(405);
  });
});
