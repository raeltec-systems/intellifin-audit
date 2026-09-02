import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditEventDraft } from '@intellifin/domain';

/**
 * The authentication surface's two guarantees: one answer for every failed attempt,
 * and no session without its audit event.
 */

const state = vi.hoisted(() => ({
  /** What the mounted Better Auth handler answers. */
  handler: null as ((request: Request) => Promise<Response>) | null,
  userIdByEmail: null as string | null,
  session: null as { userId: string; sessionId: string } | null,
  appended: [] as AuditEventDraft[],
  appendFails: false,
  revoked: [] as string[],
}));

vi.mock('@intellifin/infrastructure', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@intellifin/infrastructure')>();
  return {
    ...actual,
    findUserIdByEmail: () => Promise.resolve(state.userIdByEmail),
    findSessionByToken: () => Promise.resolve(state.session),
    revokeSessionByToken: (_db: unknown, token: string) => {
      state.revoked.push(token);
      return Promise.resolve();
    },
    PostgresAuditUnitOfWork: class {
      execute(work: (c: { auditEvents: { append: (d: AuditEventDraft) => Promise<unknown> } }) => Promise<unknown>) {
        return work({
          auditEvents: {
            append: (draft) => {
              if (state.appendFails) return Promise.reject(new Error('database unavailable'));
              state.appended.push(draft);
              return Promise.resolve(draft as unknown as never);
            },
          },
        });
      }
    },
  };
});

const telemetry = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), captureError: vi.fn() };
vi.mock('./bootstrap', () => ({
  getRuntime: () =>
    Promise.resolve({
      db: {},
      telemetry,
      auth: { handler: (request: Request) => state.handler?.(request) ?? Promise.resolve(new Response(null, { status: 404 })) },
    }),
}));

const signInRequest = (email: string) =>
  new Request('https://audit.example.com/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-correlation-id': 'corr_1' },
    body: JSON.stringify({ email, password: 'a password nobody should read' }),
  });

const load = () => import('./sign-in-route');

describe('subjectHashOf', () => {
  it('is the SHA-256 of the lower-cased, trimmed address', async () => {
    const { subjectHashOf } = await load();
    const expected = createHash('sha256').update('person@example.com', 'utf8').digest('hex');
    expect(subjectHashOf('  Person@Example.COM ')).toBe(expected);
    expect(subjectHashOf('person@example.com')).toBe(expected);
  });
});

describe('POST /api/auth/sign-in/email', () => {
  beforeEach(() => {
    state.handler = null;
    state.userIdByEmail = null;
    state.session = null;
    state.appended = [];
    state.appendFails = false;
    state.revoked = [];
    telemetry.info.mockReset();
    telemetry.captureError.mockReset();
  });

  it('answers a known address and an unknown one identically', async () => {
    const { handleAuthRequest } = await load();
    state.handler = () =>
      Promise.resolve(
        Response.json({ code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' }, { status: 401 }),
      );

    state.userIdByEmail = 'user_known';
    const known = await handleAuthRequest(signInRequest('known@example.com'));
    const knownBody = await known.text();

    state.userIdByEmail = null;
    const unknown = await handleAuthRequest(signInRequest('nobody@example.com'));
    const unknownBody = await unknown.text();

    expect(known.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(knownBody).toBe(unknownBody);
    expect(knownBody).toContain('Sign-in failed.');
    // Nothing about which user, and nothing the vendor said.
    expect(knownBody).not.toContain('INVALID_EMAIL_OR_PASSWORD');
  });

  it('attributes a failure to the user when the address matches one, and to "unknown" when it does not', async () => {
    const { handleAuthRequest } = await load();
    state.handler = () => Promise.resolve(new Response(null, { status: 401 }));

    state.userIdByEmail = 'user_known';
    await handleAuthRequest(signInRequest('known@example.com'));
    state.userIdByEmail = null;
    await handleAuthRequest(signInRequest('nobody@example.com'));

    expect(state.appended).toHaveLength(2);
    expect(state.appended[0]).toMatchObject({
      eventType: 'security.sign-in',
      outcome: 'failure',
      actor: { type: 'human', id: 'user_known' },
      sessionId: 'anonymous',
      correlationId: 'corr_1',
    });
    expect(state.appended[1]).toMatchObject({ actor: { id: 'unknown' } });
    // The address itself never enters the chain; only its hash does.
    expect(JSON.stringify(state.appended)).not.toContain('@example.com');
    expect(JSON.stringify(state.appended)).not.toContain('a password nobody should read');
  });

  it('keeps a rate-limited refusal honest rather than calling it a wrong password', async () => {
    const { handleAuthRequest, SIGN_IN_RATE_LIMITED_MESSAGE } = await load();
    state.handler = () => Promise.resolve(new Response(null, { status: 429 }));

    const response = await handleAuthRequest(signInRequest('known@example.com'));

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({ error: SIGN_IN_RATE_LIMITED_MESSAGE });
  });

  it('passes a successful sign-in through with its cookie once the event is appended', async () => {
    const { handleAuthRequest } = await load();
    state.session = { userId: 'user_1', sessionId: 'sess_1' };
    state.handler = () =>
      Promise.resolve(
        Response.json(
          { token: 'the-session-token', user: { id: 'user_1' } },
          { status: 200, headers: { 'set-cookie': 'better-auth.session_token=abc; Path=/' } },
        ),
      );

    const response = await handleAuthRequest(signInRequest('known@example.com'));

    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('better-auth.session_token');
    expect(state.appended[0]).toMatchObject({
      eventType: 'security.sign-in',
      outcome: 'success',
      actor: { id: 'user_1' },
      sessionId: 'sess_1',
    });
    expect(state.revoked).toEqual([]);
  });

  it('revokes the session and hands back no cookie when the event cannot be appended', async () => {
    const { handleAuthRequest } = await load();
    state.session = { userId: 'user_1', sessionId: 'sess_1' };
    state.appendFails = true;
    state.handler = () =>
      Promise.resolve(
        Response.json(
          { token: 'the-session-token' },
          { status: 200, headers: { 'set-cookie': 'better-auth.session_token=abc; Path=/' } },
        ),
      );

    const response = await handleAuthRequest(signInRequest('known@example.com'));

    expect(response.status).toBe(503);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(state.revoked).toEqual(['the-session-token']);
  });

  it('refuses a 2xx it cannot tie to a session row', async () => {
    const { handleAuthRequest } = await load();
    state.handler = () => Promise.resolve(Response.json({ ok: true }, { status: 200 }));

    const response = await handleAuthRequest(signInRequest('known@example.com'));
    expect(response.status).toBe(503);
    expect(state.appended).toEqual([]);
  });

  it('passes every other authentication endpoint straight through', async () => {
    const { handleAuthRequest } = await load();
    state.handler = () => Promise.resolve(Response.json({ session: null }, { status: 200 }));

    const response = await handleAuthRequest(
      new Request('https://audit.example.com/api/auth/get-session'),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ session: null });
    expect(state.appended).toEqual([]);
  });

  it('recognizes only the email sign-in path', async () => {
    const { isEmailSignInPath } = await load();
    expect(isEmailSignInPath('/api/auth/sign-in/email')).toBe(true);
    expect(isEmailSignInPath('/api/auth/sign-in/email/')).toBe(true);
    expect(isEmailSignInPath('/api/auth/sign-in/social')).toBe(false);
    expect(isEmailSignInPath('/api/auth/sign-in/email/extra')).toBe(false);
  });
});
