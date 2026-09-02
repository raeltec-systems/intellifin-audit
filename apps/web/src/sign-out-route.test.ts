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
}));

vi.mock('@intellifin/infrastructure', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@intellifin/infrastructure')>();
  return {
    ...actual,
    BetterAuthSessionReader: class {
      currentSession() {
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
    Promise.resolve({ db: {}, telemetry, authConfig: { secret: 's', baseUrl: 'http://x' } }),
}));

const { SIGN_OUT_PATH, clearedSessionCookies, handleSignOut, isSignOutPath } = await import(
  './sign-out-route'
);

/** A native form submission, exactly as a browser sends one. */
const formPost = () =>
  new Request('http://localhost:3000/api/auth/sign-out', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
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
    vi.clearAllMocks();
  });

  it('answers 303 to /sign-in so a browser follows it with a GET', async () => {
    const response = await handleSignOut(formPost());

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('http://localhost:3000/sign-in');
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

  it('expires both session cookie names', async () => {
    const response = await handleSignOut(formPost());
    const cookies = response.headers.getSetCookie();

    expect(cookies).toEqual(clearedSessionCookies());
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
    expect(response.headers.get('location')).toBe('http://localhost:3000/sign-in');
    expect(response.headers.getSetCookie().length).toBeGreaterThan(0);
    expect(state.appended).toHaveLength(0);
    expect(state.revoked).toHaveLength(0);
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
