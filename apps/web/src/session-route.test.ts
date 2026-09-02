import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `GET /api/session` is the spec's observable proof that role resolution works: the
 * role it reports comes from `user_role` on every call, never from the session token.
 * Following the `health-route.test.ts` template — the route module is imported inside
 * each test so the mocks below are in effect when it is evaluated.
 */

const state = vi.hoisted(() => ({
  session: null as { userId: string; sessionId: string } | null,
  role: null as string | null,
  roleLookups: 0,
  roleThrows: false,
}));

vi.mock('@intellifin/infrastructure', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@intellifin/infrastructure')>();
  return {
    ...actual,
    DrizzleRoleRepository: class {
      findRole() {
        state.roleLookups += 1;
        if (state.roleThrows) return Promise.reject(new Error('connect ECONNREFUSED 10.1.2.3:5432'));
        return Promise.resolve(state.role);
      }
    },
  };
});

const getRuntime = vi.fn();
vi.mock('./bootstrap', () => ({ getRuntime }));

const requireSession = vi.fn();
vi.mock('./require-role', () => ({ requireSession }));

async function callSession() {
  const { GET } = await import('../app/api/session/route');
  return GET(new Request('https://audit.example.com/api/session'));
}

describe('GET /api/session', () => {
  beforeEach(() => {
    state.session = null;
    state.role = null;
    state.roleLookups = 0;
    state.roleThrows = false;
    getRuntime.mockReset();
    getRuntime.mockResolvedValue({ db: {} });
    requireSession.mockReset();
    requireSession.mockResolvedValue({ authenticated: false });
  });

  it('answers 401 with an empty body when there is no session', async () => {
    const response = await callSession();

    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.text()).resolves.toBe('');
    // Nothing was looked up, because there was nobody to look up.
    expect(state.roleLookups).toBe(0);
  });

  it('reports the user id and the role held right now', async () => {
    requireSession.mockResolvedValue({
      authenticated: true,
      session: { userId: 'user_1', sessionId: 'sess_1' },
    });
    state.role = 'audit-manager';

    const response = await callSession();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ userId: 'user_1', role: 'audit-manager' });
    expect(state.roleLookups).toBe(1);
  });

  it('reports role null for a signed-in person who holds no role', async () => {
    requireSession.mockResolvedValue({
      authenticated: true,
      session: { userId: 'user_1', sessionId: 'sess_1' },
    });
    state.role = null;

    const response = await callSession();

    expect(response.status).toBe(200);
    // `null` is a real answer, not an error: no role means no action (AD-7).
    await expect(response.json()).resolves.toEqual({ userId: 'user_1', role: null });
  });

  it('re-reads the role on every call rather than caching it', async () => {
    requireSession.mockResolvedValue({
      authenticated: true,
      session: { userId: 'user_1', sessionId: 'sess_1' },
    });
    state.role = 'poc-administrator';
    await callSession();
    state.role = null;
    const second = await callSession();

    await expect(second.json()).resolves.toEqual({ userId: 'user_1', role: null });
    expect(state.roleLookups).toBe(2);
  });

  it('never echoes a raw driver error when the lookup fails', async () => {
    requireSession.mockResolvedValue({
      authenticated: true,
      session: { userId: 'user_1', sessionId: 'sess_1' },
    });
    state.roleThrows = true;

    const response = await callSession();
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(503);
    expect(body.error).toBe('Session unavailable');
    expect(JSON.stringify(body)).not.toContain('10.1.2.3');
  });

  it('answers 503 rather than throwing when the runtime itself refuses', async () => {
    requireSession.mockRejectedValue(new Error('connect ECONNREFUSED 10.1.2.3:5432'));

    const response = await callSession();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'Session unavailable' });
  });
});
