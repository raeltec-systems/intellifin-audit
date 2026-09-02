import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActionDecision } from '../../src/require-role';

/**
 * The Server Actions refuse for themselves (FR-1, FR-2).
 *
 * A Server Action is NOT protected by the page it was written beside. Next exposes each
 * one as its own POST endpoint addressed by an id that appears in the client bundle, so
 * a caller can invoke it without ever rendering `/administration`. This file therefore
 * tests the actions, not the page.
 *
 * Two properties are asserted, and the second is the one that is easy to lose in a
 * refactor:
 *
 *   1. an auditor and an unauthenticated caller are both refused, with the verbatim
 *      reason the authorization path produced; and
 *   2. on a refusal NOTHING else runs — the command is never called and the runtime is
 *      never even reached, so a refused caller cannot make the process open a database
 *      connection or construct the privileged identity instance.
 *
 * The runtime mock throws on use for exactly that reason: it turns "the action carried on
 * past the refusal" from a silent pass into a failure.
 */

const requireServerAction = vi.fn<() => Promise<ActionDecision>>();
const currentCorrelationId = vi.fn(async () => 'corr-test');
const createUserWithRole = vi.fn();
const setUserRole = vi.fn();
const getRuntime = vi.fn(() => {
  throw new Error('the runtime must not be reached on a refusal');
});

vi.mock('../../src/server-session', () => ({
  requireServerAction: (...args: unknown[]) =>
    (requireServerAction as unknown as (...a: unknown[]) => Promise<ActionDecision>)(...args),
  currentCorrelationId: () => currentCorrelationId(),
}));

vi.mock('../../src/bootstrap', () => ({ getRuntime: () => getRuntime() }));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@intellifin/application', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@intellifin/application')>();
  return {
    ...actual,
    createUserWithRole: (...args: unknown[]) => createUserWithRole(...args),
    setUserRole: (...args: unknown[]) => setUserRole(...args),
  };
});

const { createUserAction, setUserRoleAction } = await import('./actions');

const VALID_CREATE = {
  email: 'dana@synthetic.invalid',
  name: 'Dana Okoro',
  password: 'a-long-enough-password',
  role: 'auditor',
} as const;

/** What `requireServerAction` returns for a signed-in Auditor: the audited 403. */
const AUDITOR_DENIED: ActionDecision = {
  allowed: false,
  status: 403,
  reason: 'Your role does not permit this action.',
};

/** And for no session at all. */
const UNAUTHENTICATED: ActionDecision = {
  allowed: false,
  status: 401,
  reason: 'Sign in to continue.',
};

describe('the administration Server Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['an Auditor', AUDITOR_DENIED],
    ['an unauthenticated caller', UNAUTHENTICATED],
  ])('refuses %s calling createUserAction, and runs nothing else', async (_who, decision) => {
    requireServerAction.mockResolvedValue(decision);

    await expect(createUserAction(VALID_CREATE)).resolves.toEqual({
      ok: false,
      reason: decision.allowed ? '' : decision.reason,
    });

    expect(requireServerAction).toHaveBeenCalledWith('administration.users.manage');
    expect(createUserWithRole).not.toHaveBeenCalled();
    expect(getRuntime).not.toHaveBeenCalled();
  });

  it.each([
    ['an Auditor', AUDITOR_DENIED],
    ['an unauthenticated caller', UNAUTHENTICATED],
  ])('refuses %s calling setUserRoleAction, and runs nothing else', async (_who, decision) => {
    requireServerAction.mockResolvedValue(decision);

    await expect(
      setUserRoleAction({ userId: 'user-2', role: 'poc-administrator', expectedRole: 'auditor' }),
    ).resolves.toEqual({ ok: false, reason: decision.allowed ? '' : decision.reason });

    expect(requireServerAction).toHaveBeenCalledWith('administration.users.manage');
    expect(setUserRole).not.toHaveBeenCalled();
    expect(getRuntime).not.toHaveBeenCalled();
  });

  it('authorizes BEFORE it reads the input: invalid input from an Auditor still says denied', async () => {
    requireServerAction.mockResolvedValue(AUDITOR_DENIED);

    // Every field is invalid. A validate-then-authorize action would answer "Choose a
    // role", telling a caller who may not act anything at all about the input contract.
    await expect(
      createUserAction({ email: '', name: '', password: '', role: 'superuser' }),
    ).resolves.toEqual({ ok: false, reason: AUDITOR_DENIED.reason });
    await expect(setUserRoleAction({ userId: '', role: 'superuser', expectedRole: '' })).resolves.toEqual({
      ok: false,
      reason: AUDITOR_DENIED.reason,
    });
    expect(createUserWithRole).not.toHaveBeenCalled();
    expect(setUserRole).not.toHaveBeenCalled();
  });

  it('asks for exactly the administration action, never a weaker one', async () => {
    requireServerAction.mockResolvedValue(AUDITOR_DENIED);
    await createUserAction(VALID_CREATE);
    await setUserRoleAction({ userId: 'user-2', role: '', expectedRole: 'auditor' });
    for (const call of requireServerAction.mock.calls) {
      expect(call).toEqual(['administration.users.manage']);
    }
  });
});

describe('an authorized administrator', () => {
  const ALLOWED: ActionDecision = {
    allowed: true,
    session: { userId: 'admin-1', sessionId: 'session-1' },
    role: 'poc-administrator',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    requireServerAction.mockResolvedValue(ALLOWED);
    getRuntime.mockReturnValue({
      db: {},
      authConfig: { secret: 's', baseUrl: 'http://localhost' },
      telemetry: { captureError: vi.fn() },
    } as never);
  });

  it('passes the session from the decision, never one supplied by the caller', async () => {
    createUserWithRole.mockResolvedValue({ ok: true, userId: 'new-1', role: 'auditor' });

    await expect(createUserAction(VALID_CREATE)).resolves.toEqual({
      ok: true,
      message: 'Created dana@synthetic.invalid as Auditor.',
    });

    const input = createUserWithRole.mock.calls[0]?.[1] as { session: unknown };
    expect(input.session).toEqual(ALLOWED.allowed ? ALLOWED.session : null);
  });

  it('turns the empty role into a revocation rather than a value', async () => {
    setUserRole.mockResolvedValue({
      ok: true,
      userId: 'user-2',
      priorRole: 'auditor',
      newRole: null,
    });

    await expect(setUserRoleAction({ userId: 'user-2', role: '', expectedRole: 'auditor' })).resolves.toEqual({
      ok: true,
      message: 'Removed the role. The account and its sessions are unchanged.',
    });
    expect((setUserRole.mock.calls[0]?.[1] as { role: unknown }).role).toBeNull();
  });

  it('refuses a role outside the vocabulary without calling the command', async () => {
    await expect(setUserRoleAction({ userId: 'user-2', role: 'superuser', expectedRole: '' })).resolves.toEqual({
      ok: false,
      reason: 'Choose a role.',
    });
    expect(setUserRole).not.toHaveBeenCalled();
  });

  it('reports a thrown command as a failure that changed nothing, and never echoes it', async () => {
    setUserRole.mockRejectedValue(new Error('relation "user_role" does not exist'));

    const outcome = await setUserRoleAction({ userId: 'user-2', role: 'auditor', expectedRole: '' });

    expect(outcome).toEqual({
      ok: false,
      reason: 'The change could not be saved. Nothing was changed.',
    });
    expect(JSON.stringify(outcome)).not.toContain('user_role');
  });
});
