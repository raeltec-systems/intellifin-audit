import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditEventDraft } from '@intellifin/domain';

/**
 * Sign-out answers a browser, not a script.
 *
 * The control is a native form submission, so every answer this route gives has to be
 * one the browser can act on by itself: a 303 to `/sign-in`, or an HTML page. A JSON
 * body here would land on screen as raw text for anybody whose bundle had not loaded —
 * which is the exact population this route exists to serve.
 */

const state = vi.hoisted(() => ({
  session: null as { userId: string; sessionId: string } | null,
  appended: [] as AuditEventDraft[],
  revoked: [] as string[],
  failAppend: false,
  runtimeFails: false,
  /** How many times the session was resolved — i.e. how often the database was asked. */
  reads: 0,
}));

vi.mock('@intellifin/infrastructure', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@intellifin/infrastructure')>();
  return {
    ...actual,
    BetterAuthSessionReader: class {
      currentSession() {
        state.reads += 1;
        return Promise.resolve(state.session);
      }
    },
    PostgresIdentityUnitOfWork: class {
      execute(
        work: (context: {
          auditEvents: { append: (draft: AuditEventDraft) => Promise<unknown> };
          sessions: { revokeSession: (sessionId: string) => Promise<void> };
        }) => Promise<unknown>,
      ) {
        // A transaction: a throw discards the revoke made inside it.
        const before = state.revoked.length;
        return work({
          auditEvents: {
            append: (draft) => {
              if (state.failAppend) return Promise.reject(new Error('database unavailable'));
              state.appended.push(draft);
              return Promise.resolve(draft as unknown as never);
            },
          },
          sessions: {
            revokeSession: (sessionId) => {
              state.revoked.push(sessionId);
              return Promise.resolve();
            },
          },
        }).catch((error: unknown) => {
          state.revoked.length = before;
          throw error;
        });
      }
    },
  };
});

const telemetry = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), captureError: vi.fn() };
vi.mock('./bootstrap', () => ({
  getRuntime: () =>
    state.runtimeFails
      ? Promise.reject(new Error('database unreachable'))
      : Promise.resolve({ db: {}, telemetry, authConfig: { secret: 's', baseUrl: 'http://x' } }),
}));

const { SIGN_OUT_PATH, handleSignOut, isSignOutPath } = await import('./sign-out-route');

/** A native form submission, exactly as a browser sends one. */
const formPost = () =>
  new Request('http://localhost:3000/api/auth/sign-out', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      // A session cookie has to be present or the handler short-circuits before it ever
      // looks for a session — see the anonymous case below.
      cookie: 'better-auth.session_token=a-token.a-signature',
    },
    body: '',
  });

describe('isSignOutPath', () => {
  it.each(['/api/auth/sign-out', '/api/auth/sign-out/'])('matches %s', (path) => {
    expect(isSignOutPath(path)).toBe(true);
  });

  it.each([
    '/api/auth/sign-outx',
    '/api/auth/sign-out/all',
    '/api/auth/sign-in/email',
    '/sign-out',
  ])('does not match %s', (path) => {
    expect(isSignOutPath(path)).toBe(false);
  });

  it('is the path the form posts to', () => {
    expect(isSignOutPath(SIGN_OUT_PATH)).toBe(true);
  });
});

describe('handleSignOut', () => {
  beforeEach(() => {
    state.session = { userId: 'user-1', sessionId: 'session-1' };
    state.appended = [];
    state.revoked = [];
    state.failAppend = false;
    state.runtimeFails = false;
    state.reads = 0;
    vi.clearAllMocks();
  });

  it('answers 303 to /sign-in so a browser follows it with a GET', async () => {
    const response = await handleSignOut(formPost());

    expect(response.status).toBe(303);
    // RELATIVE. An absolute location would take its host from the request, which behind
    // a proxy is the client's own `Host` header — a forged one would send the browser to
    // an attacker's origin at the moment its cookies are cleared.
    expect(response.headers.get('location')).toBe('/sign-in');
    expect(response.headers.get('cache-control')).toBe('no-store');
    // Nothing a script would have to interpret.
    expect(response.headers.get('content-type')).toBeNull();
    await expect(response.text()).resolves.toBe('');
  });

  it('revokes the session and appends security.sign-out', async () => {
    await handleSignOut(formPost());

    expect(state.revoked).toEqual(['session-1']);
    expect(state.appended).toHaveLength(1);
    expect(state.appended[0]).toMatchObject({
      actor: { type: 'human', id: 'user-1' },
      eventType: 'security.sign-out',
      outcome: 'success',
      sessionId: 'session-1',
    });
  });

  it('expires both session cookie names, with the attributes a browser matches on', async () => {
    const response = await handleSignOut(formPost());
    const cookies = response.headers.getSetCookie();

    // Deliberately NOT compared with `clearedSessionCookies()`. Asserting the response
    // equals the function that produced it proves only that the function was called: the
    // attributes could all be wrong together and the test would still pass. Each one is
    // checked for what a browser actually needs.
    expect(cookies).toHaveLength(2);
    // `Path=/` is the one nothing pinned before. A browser expires a cookie only when
    // the name, domain AND path match the one it stored; Better Auth sets `Path=/`, so
    // `Path=/api/auth` here would leave the session cookie in place on every page while
    // every assertion still passed.
    for (const cookie of cookies) expect(cookie).toContain('; Path=/;');
    for (const cookie of cookies) expect(cookie).toContain('HttpOnly');
    for (const cookie of cookies) expect(cookie).toContain('SameSite=Lax');
    expect(cookies.some((cookie) => cookie.startsWith('better-auth.session_token='))).toBe(true);
    expect(
      cookies.some((cookie) => cookie.startsWith('__Secure-better-auth.session_token=')),
    ).toBe(true);
    for (const cookie of cookies) expect(cookie).toContain('Max-Age=0');
    // Only the `__Secure-` name may carry `Secure`; a browser refuses one that does not.
    for (const cookie of cookies) {
      expect(cookie.includes('; Secure')).toBe(cookie.startsWith('__Secure-'));
    }
  });

  it('is idempotent: no session answers the same 303, and audits nothing', async () => {
    state.session = null;

    const response = await handleSignOut(formPost());

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/sign-in');
    expect(response.headers.getSetCookie().length).toBeGreaterThan(0);
    expect(state.appended).toHaveLength(0);
    expect(state.revoked).toHaveLength(0);
  });

  it('ignores a forged Host header entirely', async () => {
    const response = await handleSignOut(
      new Request('http://localhost:3000/api/auth/sign-out', {
        method: 'POST',
        headers: { host: 'evil.example', cookie: 'better-auth.session_token=abc' },
      }),
    );

    expect(response.headers.get('location')).toBe('/sign-in');
    expect(response.headers.get('location')).not.toContain('evil.example');
  });

  it('answers a caller with no session cookie without touching the database', async () => {
    // `/api/auth/**` is the one publicly allowlisted surface and this handler intercepts
    // before Better Auth's rate limiter sees the path, so sign-out is not rate limited.
    // An anonymous POST must therefore cost nothing.
    const response = await handleSignOut(
      new Request('http://localhost:3000/api/auth/sign-out', { method: 'POST' }),
    );

    expect(response.status).toBe(303);
    expect(state.reads).toBe(0);
    expect(state.appended).toHaveLength(0);
  });

  it('answers the fail-closed page when the runtime itself is unreachable', async () => {
    // The riskiest work — acquiring the runtime and resolving the session — happens
    // inside the route's own try. Left outside it, a database that is down threw through
    // the route and the caller got a framework 500 instead of this page.
    state.runtimeFails = true;

    const response = await handleSignOut(formPost());

    expect(response.status).toBe(503);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    await expect(response.text()).resolves.toContain('You are still signed in');
  });

  it('fails closed when the event cannot be appended: no revoke, no cleared cookie', async () => {
    state.failAppend = true;

    const response = await handleSignOut(formPost());

    expect(response.status).toBe(503);
    // An HTML page, because a browser is the caller and JSON would land as raw text.
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    const body = await response.text();
    expect(body).toContain('Sign-out failed. Try again.');
    expect(body).toContain('You are still signed in');
    // The session survives and no cookie is cleared: a cleared cookie over a live
    // session is a person who believes they signed out and did not.
    expect(state.revoked).toEqual([]);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(telemetry.captureError).toHaveBeenCalledWith(
      'Sign-out failed',
      expect.anything(),
      expect.objectContaining({ outcome: 'failure' }),
    );
  });
});
