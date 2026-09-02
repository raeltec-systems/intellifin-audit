import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditEventDraft } from '@intellifin/domain';

/**
 * The Server Action's refusal is AUDITED — proven through the real authorization path.
 *
 * `actions.test.ts` mocks `requireServerAction` wholesale, which is the right shape for
 * asserting that the action authorizes before it reads its input and does nothing else on
 * a refusal. But it cannot prove the second half of the acceptance criterion — "each is
 * refused by the action itself AND the refusal is audited" — because the thing that does
 * the auditing is the very thing it replaced. Proven only at the command layer, that
 * criterion survives somebody swapping `requireServerAction` for a bare role comparison.
 *
 * So this file mocks one layer lower: the session reader, the role repository and the
 * unit of work are fakes, and everything above them — the action, `requireServerAction`,
 * `authorizeSessionAction`, `authorizeCommand`, the domain policy — is the real code.
 * The assertion is that invoking the action as an Auditor puts `security.denied` in the
 * chain.
 */

const state = vi.hoisted(() => ({
  session: { userId: 'auditor-1', sessionId: 'session-1' } as
    | { userId: string; sessionId: string }
    | null,
  role: 'auditor' as string | null,
  appended: [] as AuditEventDraft[],
}));

vi.mock('@intellifin/infrastructure', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@intellifin/infrastructure')>();
  class FakeUnitOfWork {
    execute(work: (context: { auditEvents: { append: (d: AuditEventDraft) => Promise<unknown> } }) => Promise<unknown>) {
      return work({
        auditEvents: {
          append: (draft) => {
            state.appended.push(draft);
            return Promise.resolve(draft as unknown as never);
          },
        },
      });
    }
  }
  return {
    ...actual,
    BetterAuthSessionReader: class {
      currentSession() {
        return Promise.resolve(state.session);
      }
    },
    DrizzleRoleRepository: class {
      findRole() {
        return Promise.resolve(state.role);
      }
    },
    DrizzleUserDirectory: class {
      listUsers() {
        return Promise.resolve([]);
      }
      findUser() {
        return Promise.resolve(null);
      }
    },
    PostgresAuditUnitOfWork: FakeUnitOfWork,
    PostgresIdentityUnitOfWork: FakeUnitOfWork,
  };
});

const telemetry = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), captureError: vi.fn() };
vi.mock('../../src/bootstrap', () => ({
  getRuntime: () =>
    Promise.resolve({ db: {}, telemetry, authConfig: { secret: 's', baseUrl: 'http://x' } }),
}));

/** A server component has no `Request`; `server-session.ts` rebuilds one from these. */
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers({ 'x-correlation-id': 'corr-audit' })),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { createUserAction, setUserRoleAction } = await import('./actions');

const CREATE = {
  email: 'dana@synthetic.invalid',
  name: 'Dana Okoro',
  password: 'a-long-enough-password',
  role: 'auditor',
} as const;

describe('the administration Server Actions, through the real authorization path', () => {
  beforeEach(() => {
    state.session = { userId: 'auditor-1', sessionId: 'session-1' };
    state.role = 'auditor';
    state.appended = [];
    vi.clearAllMocks();
  });

  it('refuses an Auditor calling createUserAction and appends security.denied', async () => {
    const outcome = await createUserAction(CREATE);

    expect(outcome).toEqual({ ok: false, reason: 'Your role does not permit this action.' });
    expect(state.appended).toHaveLength(1);
    expect(state.appended[0]).toMatchObject({
      actor: { type: 'human', id: 'auditor-1' },
      eventType: 'security.denied',
      source: 'web',
      outcome: 'denied',
      sessionId: 'session-1',
      payload: {
        action: 'administration.users.manage',
        role: 'auditor',
        reason: 'Your role does not permit this action.',
      },
    });
  });

  it('refuses an Auditor calling setUserRoleAction and appends security.denied', async () => {
    const outcome = await setUserRoleAction({
      userId: 'user-2',
      role: 'poc-administrator',
      expectedRole: 'auditor',
    });

    expect(outcome).toEqual({ ok: false, reason: 'Your role does not permit this action.' });
    expect(state.appended).toHaveLength(1);
    expect(state.appended[0]).toMatchObject({
      eventType: 'security.denied',
      outcome: 'denied',
      payload: { action: 'administration.users.manage' },
    });
  });

  it('audits a signed-in caller who holds no role at all', async () => {
    state.role = null;

    const outcome = await createUserAction(CREATE);

    expect(outcome).toEqual({ ok: false, reason: 'Your role does not permit this action.' });
    expect(state.appended[0]).toMatchObject({
      eventType: 'security.denied',
      payload: { role: null },
    });
  });

  it('refuses an unauthenticated caller, and appends nothing', async () => {
    state.session = null;

    const outcome = await createUserAction(CREATE);

    expect(outcome).toEqual({ ok: false, reason: 'Sign in to continue.' });
    // Deliberate, and a Story 1.3 decision: an unauthenticated caller must not be able to
    // grow the immutable chain one row per probe. The middleware turns anonymous traffic
    // away before it reaches a Server Action at all.
    expect(state.appended).toHaveLength(0);
  });

  it('carries the request correlation id into the audited refusal', async () => {
    await createUserAction(CREATE);
    expect(state.appended[0]?.correlationId).toBe('corr-audit');
  });
});
