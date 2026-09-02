import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditEventDraft } from '@intellifin/domain';

/**
 * The request-level guard, with only the two outside edges faked: who the session says
 * you are, and what `user_role` holds. The domain policy, `authorizeCommand`, and the
 * audit draft are all real, so this test proves the wiring rather than restating it.
 */

const state = vi.hoisted(() => ({
  session: null as { userId: string; sessionId: string } | null,
  roles: [] as (string | null)[],
  roleLookups: 0,
  appended: [] as AuditEventDraft[],
  appendFails: false,
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
    DrizzleRoleRepository: class {
      findRole() {
        const value = state.roles[state.roleLookups] ?? state.roles.at(-1) ?? null;
        state.roleLookups += 1;
        return Promise.resolve(value);
      }
    },
    PostgresAuditUnitOfWork: class {
      execute(work: (context: { auditEvents: { append: (d: AuditEventDraft) => Promise<unknown> } }) => Promise<unknown>) {
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
  getRuntime: () => Promise.resolve({ db: {}, auth: {}, telemetry }),
}));

const request = (headers: Record<string, string> = {}) =>
  new Request('https://audit.example.com/api/procedures', { headers });

async function load() {
  return import('./require-role');
}

describe('requireSession', () => {
  beforeEach(() => {
    state.session = null;
    state.roles = [];
    state.roleLookups = 0;
    state.appended = [];
    state.appendFails = false;
    telemetry.info.mockReset();
  });

  it('reports no session when the cookie proves nothing', async () => {
    const { requireSession } = await load();
    await expect(requireSession(request())).resolves.toEqual({ authenticated: false });
  });

  it('reports the user and session ids when the session is real', async () => {
    state.session = { userId: 'user_1', sessionId: 'sess_1' };
    const { requireSession } = await load();
    await expect(requireSession(request())).resolves.toEqual({
      authenticated: true,
      session: { userId: 'user_1', sessionId: 'sess_1' },
    });
  });
});

describe('requireAction', () => {
  beforeEach(() => {
    state.session = { userId: 'user_1', sessionId: 'sess_1' };
    state.roles = [];
    state.roleLookups = 0;
    state.appended = [];
    state.appendFails = false;
    telemetry.info.mockReset();
  });

  it('refuses an unauthenticated caller with 401 and audits nothing', async () => {
    state.session = null;
    const { requireAction } = await load();

    const decision = await requireAction(request(), 'procedure.author');

    expect(decision).toMatchObject({ allowed: false, status: 401 });
    // An anonymous probe must not be able to grow the immutable chain.
    expect(state.appended).toEqual([]);
  });

  it('answers a 401 with an empty body', async () => {
    state.session = null;
    const { denialResponse, requireAction } = await load();

    const decision = await requireAction(request(), 'procedure.author');
    const response = denialResponse(decision as Extract<typeof decision, { allowed: false }>);

    expect(response.status).toBe(401);
    await expect(response.text()).resolves.toBe('');
  });

  it('denies a signed-in person who holds no role, and audits it', async () => {
    state.roles = [null];
    const { requireAction } = await load();

    const decision = await requireAction(request(), 'procedure.author');

    expect(decision).toEqual({
      allowed: false,
      status: 403,
      reason: 'Your role does not permit this action.',
    });
    expect(state.appended).toHaveLength(1);
    expect(state.appended[0]).toMatchObject({
      eventType: 'security.denied',
      outcome: 'denied',
      source: 'web',
      actor: { type: 'human', id: 'user_1' },
      sessionId: 'sess_1',
      payload: { action: 'procedure.author', role: null },
    });
  });

  it('allows an action the role holds', async () => {
    state.roles = ['auditor'];
    const { requireAction } = await load();

    await expect(requireAction(request(), 'procedure.author')).resolves.toEqual({
      allowed: true,
      role: 'auditor',
      session: { userId: 'user_1', sessionId: 'sess_1' },
    });
    expect(state.appended).toEqual([]);
  });

  it('denies an out-of-role action with the verbatim reason and audits it', async () => {
    state.roles = ['poc-administrator'];
    const { denialResponse, requireAction } = await load();

    const decision = await requireAction(request(), 'procedure.author');

    expect(decision).toEqual({
      allowed: false,
      status: 403,
      reason: 'PoC Administrator cannot author Procedures or start Runs.',
    });

    const response = denialResponse(decision as Extract<typeof decision, { allowed: false }>);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      reason: 'PoC Administrator cannot author Procedures or start Runs.',
    });

    expect(state.appended[0]).toMatchObject({
      eventType: 'security.denied',
      outcome: 'denied',
      payload: {
        action: 'procedure.author',
        role: 'poc-administrator',
        reason: 'PoC Administrator cannot author Procedures or start Runs.',
      },
    });
  });

  it('passes the actor through so an author cannot approve their own version', async () => {
    state.roles = ['audit-manager'];
    const { requireAction } = await load();

    await expect(
      requireAction(request(), 'procedure.version.approve', { authorId: 'user_1' }),
    ).resolves.toEqual({
      allowed: false,
      status: 403,
      reason: 'You cannot approve a version you authored.',
    });
  });

  it('takes a revocation into effect on the very next request', async () => {
    // The same live session throughout: only the role row changes between calls.
    state.roles = ['poc-administrator', null];
    const { requireAction } = await load();

    await expect(requireAction(request(), 'administration.users.manage')).resolves.toMatchObject({
      allowed: true,
      role: 'poc-administrator',
    });
    await expect(requireAction(request(), 'administration.users.manage')).resolves.toMatchObject({
      allowed: false,
      status: 403,
    });
    // Two requests, two reads: nothing was cached between them.
    expect(state.roleLookups).toBe(2);
  });

  it('never answers "allowed" when the denial could not be audited', async () => {
    state.roles = ['poc-administrator'];
    state.appendFails = true;
    const { requireAction } = await load();

    await expect(requireAction(request(), 'procedure.author')).rejects.toThrow(/database/);
  });

  it('carries a well-formed correlation identifier from the request header', async () => {
    state.roles = [null];
    const { requireAction } = await load();

    await requireAction(request({ 'x-correlation-id': 'corr_abc-123' }), 'procedure.author');
    expect(state.appended[0]?.correlationId).toBe('corr_abc-123');
  });

  it('replaces a hostile correlation header rather than sanitizing it', async () => {
    state.roles = [null];
    const { requireAction } = await load();

    await requireAction(request({ 'x-correlation-id': 'someone@example.com' }), 'procedure.author');
    expect(state.appended[0]?.correlationId).not.toContain('@');
    expect(state.appended[0]?.correlationId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
