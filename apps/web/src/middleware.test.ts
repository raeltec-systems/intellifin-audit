import { describe, expect, it } from 'vitest';

import { config, middleware } from '../middleware.js';

/**
 * The outer gate. It cannot authorize anything — it only sees whether a session
 * cookie is present — so what is tested here is that it refuses by default, refuses
 * without disclosing anything, and never lets a refusal be cached.
 */

interface RequestOptions {
  readonly cookies?: readonly { name: string; value: string }[];
}

/** The slice of NextRequest the middleware actually touches. */
function request(pathname: string, options: RequestOptions = {}) {
  const cookies = options.cookies ?? [];
  return {
    nextUrl: new URL(`https://audit.example.com${pathname}`),
    cookies: { getAll: () => [...cookies] },
  } as unknown as Parameters<typeof middleware>[0];
}

const SESSION = [{ name: 'better-auth.session_token', value: 'abc.def' }];

describe('middleware', () => {
  it.each(['/sign-in', '/api/health', '/api/auth/sign-in/email', '/_next/static/x.js'])(
    'lets the public path %s through untouched',
    (path) => {
      expect(middleware(request(path)).status).toBe(200);
    },
  );

  it.each(['/api/session', '/api/procedures', '/api/runs/RUN-1/events'])(
    'refuses %s with 401, an empty body and no cache',
    async (path) => {
      const response = middleware(request(path));

      expect(response.status).toBe(401);
      expect(response.headers.get('cache-control')).toBe('no-store');
      // A refusal must disclose nothing at all, not even which route it was.
      await expect(response.text()).resolves.toBe('');
    },
  );

  it.each(['/', '/runs/RUN-2437', '/administration/users'])(
    'redirects the page %s to sign-in and forbids caching that redirect',
    (path) => {
      const response = middleware(request(path));

      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('https://audit.example.com/sign-in');
      // Without this a shared cache can pin a protected path to the sign-in redirect.
      expect(response.headers.get('cache-control')).toBe('no-store');
    },
  );

  it.each([
    'better-auth.session_token',
    '__Secure-better-auth.session_token',
    'better-auth.session_token.1',
  ])('lets a request carrying the %s cookie reach the handler', (name) => {
    const response = middleware(request('/api/session', { cookies: [{ name, value: 'v' }] }));
    expect(response.status).toBe(200);
  });

  it('is not fooled by a cookie that merely looks like the session cookie', () => {
    const response = middleware(
      request('/api/session', { cookies: [{ name: 'not-better-auth.session_token', value: 'v' }] }),
    );
    expect(response.status).toBe(401);
  });

  it('treats the cookie as a hint only, never as proof', () => {
    // The cookie is unsigned and unverified here; `requireAction` makes the real
    // decision. This test exists so that stays deliberate rather than forgotten.
    const response = middleware(request('/api/session', { cookies: SESSION }));
    expect(response.status).toBe(200);
  });
});

describe('the matcher', () => {
  it('runs on every path, delegating the allowlist to route-access', () => {
    // A negative lookahead here would be a second allowlist in another language that
    // nothing tests, and it fails the same way a slash-less prefix does.
    expect(config.matcher).toEqual(['/(.*)']);
    for (const pattern of config.matcher) expect(pattern).not.toContain('?!');
  });

  it.each(['/_next/imagery', '/_next/imagex/leak', '/_next/staticky/leak'])(
    'therefore still sees the look-alike path %s',
    (path) => {
      expect(middleware(request(path)).status).toBe(307);
    },
  );
});
