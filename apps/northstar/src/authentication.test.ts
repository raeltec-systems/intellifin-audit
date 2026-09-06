import { describe, expect, it } from 'vitest';

import {
  AUTHENTICATION_ERROR,
  AUTHENTICATION_RULE,
  SESSION_COOKIE,
  requiresCredential,
} from './authentication.js';
import { loanCoreCredential } from './fixtures.js';
import { READ_ONLY_RULE } from './read-only.js';
import { ROUTES } from './routes.js';
import { handleRequest } from './server.js';

/**
 * FR-3's other half at the system level, asserted over the ROUTE TABLE (Story 4.2).
 *
 * The same shape as `read-only.test.ts`, and for the same reason: a test that names its own
 * sample cannot notice the route that was added without one. Every LoanCore case below is
 * generated from `ROUTES`, so a LoanCore surface added by a later story is covered the
 * moment it exists — and every other system's routes are asserted to be UNAFFECTED, which
 * is the half that a change adding authentication everywhere would break silently.
 */

const CREDENTIAL = loanCoreCredential();
const AUTHORIZED = { authorization: `Bearer ${CREDENTIAL.token}` } as const;

const loancoreRoutes = ROUTES.filter((route) => requiresCredential(route.probe));
const otherRoutes = ROUTES.filter((route) => !requiresCredential(route.probe));

function bodyOf(response: { body: string | Uint8Array }): string {
  return typeof response.body === 'string' ? response.body : Buffer.from(response.body).toString('utf8');
}

function cookieFrom(setCookie: string | undefined): string {
  const value = (setCookie ?? '').split(';')[0] ?? '';
  return value;
}

describe('the fixture declares a credential at all', () => {
  it('has a reference and an invented token, and they are different values', () => {
    expect(CREDENTIAL.reference).toMatch(/^cred:\/\//);
    expect(CREDENTIAL.token.length).toBeGreaterThan(16);
    expect(CREDENTIAL.token).not.toBe(CREDENTIAL.reference);
  });

  it('found LoanCore routes to check, so the walk below is not vacuous', () => {
    // The failure this guards is a rename that leaves every assertion unexecuted and green.
    expect(loancoreRoutes.length).toBeGreaterThanOrEqual(3);
    expect(otherRoutes.length).toBeGreaterThanOrEqual(10);
  });
});

describe('every LoanCore route refuses an unauthenticated read', () => {
  for (const route of loancoreRoutes) {
    it(`GET ${route.probe} (${route.id})`, () => {
      const response = handleRequest('GET', route.probe);
      expect(response.status).toBe(401);
      // RFC 9110: a 401 without a challenge is a refusal that never says how to satisfy it.
      expect(response.headers['www-authenticate']).toBe('Bearer realm="LoanCore", charset="UTF-8"');
      const payload = JSON.parse(bodyOf(response)) as Record<string, unknown>;
      expect(payload['error']).toBe(AUTHENTICATION_ERROR);
      // The rule itself, verbatim. A denial a Run records must name the rule, not merely
      // carry a status code.
      expect(payload['rule']).toBe(AUTHENTICATION_RULE);
      expect(payload['path']).toBe(route.probe);
      // Nothing the system knows leaks into the refusal: not the credential, not the page.
      expect(bodyOf(response)).not.toContain(CREDENTIAL.token);
    });
  }
});

describe('every LoanCore route serves a credentialed read, and grants a session', () => {
  for (const route of loancoreRoutes) {
    it(`GET ${route.probe} (${route.id})`, () => {
      const response = handleRequest('GET', route.probe, AUTHORIZED);
      expect(response.status).toBe(200);
      const cookie = response.headers['set-cookie'] ?? '';
      expect(cookie).toContain(`${SESSION_COOKIE}=`);
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('Path=/loancore');
      // The session value is DERIVED from the credential and is never the credential: the
      // token must appear in nothing this system hands back.
      expect(cookie).not.toContain(CREDENTIAL.token);
      expect(bodyOf(response)).not.toContain(CREDENTIAL.token);
    });
  }
});

describe('the session the sign-in granted is what a later read carries', () => {
  const granted = handleRequest('GET', '/loancore', AUTHORIZED);
  const cookie = cookieFrom(granted.headers['set-cookie']);

  it('a 401 before, a 200 after, on the same path', () => {
    expect(handleRequest('GET', '/loancore/users?employee_id=E-000103').status).toBe(401);
    expect(handleRequest('GET', '/loancore/users?employee_id=E-000103', { cookie }).status).toBe(200);
  });

  it('a read carrying only the session is not granted another one', () => {
    // A `Set-Cookie` on every response would rewrite the session on every read, which is
    // a second sign-in nobody performed.
    const response = handleRequest('GET', '/loancore', { cookie });
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('refuses a cookie whose value is not the one this system granted', () => {
    expect(handleRequest('GET', '/loancore', { cookie: `${SESSION_COOKIE}=guessed` }).status).toBe(401);
    expect(handleRequest('GET', '/loancore', { cookie: 'other=value' }).status).toBe(401);
  });

  it('refuses a credential that is not the declared one, however it is spelled', () => {
    expect(handleRequest('GET', '/loancore', { authorization: 'Bearer wrong' }).status).toBe(401);
    expect(handleRequest('GET', '/loancore', { authorization: CREDENTIAL.token }).status).toBe(401);
    expect(handleRequest('GET', '/loancore', { authorization: `Basic ${CREDENTIAL.token}` }).status).toBe(401);
    // A prefix or a suffix is not the credential.
    expect(handleRequest('GET', '/loancore', { authorization: `Bearer ${CREDENTIAL.token}x` }).status).toBe(401);
  });

  it('takes the FIRST value of a repeated header, so a second one is not a second chance', () => {
    const response = handleRequest('GET', '/loancore', {
      authorization: ['Bearer wrong', `Bearer ${CREDENTIAL.token}`],
    });
    expect(response.status).toBe(401);
  });
});

describe('authentication is applied above routing', () => {
  it('refuses an unauthenticated read of a LoanCore path no route serves', () => {
    // 404 says "there is nothing here", which is a statement about this system's contents
    // and one an unauthenticated caller has not earned. 401 says what is actually true.
    const response = handleRequest('GET', '/loancore/nothing/is/served/here');
    expect(response.status).toBe(401);
    expect(JSON.parse(bodyOf(response))['rule']).toBe(AUTHENTICATION_RULE);
  });

  it('answers 404 for the same path once the credential is presented', () => {
    expect(handleRequest('GET', '/loancore/nothing/is/served/here', AUTHORIZED).status).toBe(404);
  });

  it('refuses a write BEFORE it considers the credential', () => {
    // The read-only rule is untouched by this story and must stay above authentication: a
    // 401 first would suggest that a credential could make a write acceptable.
    const response = handleRequest('POST', '/loancore', AUTHORIZED);
    expect(response.status).toBe(405);
    expect(JSON.parse(bodyOf(response))['rule']).toBe(READ_ONLY_RULE);
  });

  it('refuses a write to a LoanCore path with no credential as a WRITE, not as a 401', () => {
    expect(handleRequest('POST', '/loancore/users').status).toBe(405);
  });

  it('is a path BOUNDARY, so a sibling prefix is not inside it', () => {
    expect(requiresCredential('/loancore')).toBe(true);
    expect(requiresCredential('/loancore/users/E-000103')).toBe(true);
    expect(requiresCredential('/loancore-other')).toBe(false);
    expect(requiresCredential('/loancoreother')).toBe(false);
    expect(requiresCredential('/')).toBe(false);
  });
});

describe('every other synthetic system stays unauthenticated', () => {
  for (const route of otherRoutes) {
    it(`GET ${route.probe} (${route.id})`, () => {
      const response = handleRequest('GET', route.probe);
      // Adding authentication everywhere would make every Epic 3 adapter test carry a
      // credential for no reason, and Epic 3's adapter path resolves its credential from
      // the frozen registration rather than from a header this fixture invented.
      expect(response.status).not.toBe(401);
      expect(response.headers['set-cookie']).toBeUndefined();
    });
  }
});
