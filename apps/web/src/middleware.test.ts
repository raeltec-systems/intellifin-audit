import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { middleware } from '../middleware.js';
import { SESSION_COOKIE_PREFIXES } from './session-cookie.js';

/**
 * `route-access.test.ts` proves which paths are public and which families are
 * protected. This file proves what the middleware actually *does* with that answer:
 * an API refusal carries no body, a page refusal goes to sign-in, and a request
 * carrying a session cookie is passed on to the handler that can really authorize it.
 */

const ORIGIN = 'https://audit.example.com';

function request(path: string, cookie?: string): NextRequest {
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);
  return new NextRequest(new URL(path, ORIGIN), { headers });
}

/** A middleware pass-through carries Next's own continue header rather than a status. */
function isPassThrough(response: { headers: Headers }): boolean {
  return response.headers.get('x-middleware-next') === '1';
}

describe('an anonymous request to a protected API path', () => {
  it.each([
    '/api/session',
    '/api/procedures',
    '/api/runs/RUN-1',
    '/api/runs/RUN-1/stream',
    '/api/evidence/E-1',
    '/api/exceptions/X-1',
    '/api/replay/RUN-1',
    '/api/administration/users',
  ])('refuses %s with 401 and no body at all', async (path) => {
    const response = middleware(request(path));

    expect(response.status).toBe(401);
    expect(await response.text()).toBe('');
    expect(response.headers.get('cache-control')).toBe('no-store');
    // A refusal must not name the route, the reason, or whether it exists.
    expect(response.headers.get('location')).toBeNull();
  });
});

describe('an anonymous request to a protected page path', () => {
  it.each(['/', '/runs', '/runs/RUN-1', '/administration'])(
    'sends %s to the sign-in page',
    (path) => {
      const response = middleware(request(path));

      expect(response.status).toBe(307);
      expect(new URL(response.headers.get('location') as string).pathname).toBe('/sign-in');
    },
  );

  it('keeps the redirect on the request origin rather than an attacker-supplied one', () => {
    const response = middleware(request('/runs'));

    expect(new URL(response.headers.get('location') as string).origin).toBe(ORIGIN);
  });
});

describe('a public path', () => {
  it.each(['/sign-in', '/api/health', '/api/auth/sign-in/email', '/favicon.ico'])(
    'lets %s through with no session cookie',
    (path) => {
      expect(isPassThrough(middleware(request(path)))).toBe(true);
    },
  );
});

describe('a request carrying a session cookie', () => {
  it.each(SESSION_COOKIE_PREFIXES)('lets a page through on %s', (name) => {
    expect(isPassThrough(middleware(request('/runs', `${name}=abc`)))).toBe(true);
  });

  it('lets an API route through, leaving the real decision to the handler', () => {
    const cookie = `${SESSION_COOKIE_PREFIXES[0]}=abc`;
    expect(isPassThrough(middleware(request('/api/session', cookie)))).toBe(true);
  });

  it('is not fooled by an unrelated cookie whose name merely contains the prefix', () => {
    const response = middleware(request('/api/session', 'not-better-auth.session_token=abc'));
    expect(response.status).toBe(401);
  });
});
