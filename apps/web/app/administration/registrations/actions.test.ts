import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActionDecision } from '../../../src/require-role';

/**
 * The registration Server Actions refuse for themselves (FR-1, FR-2, FR-8).
 *
 * A Server Action is NOT protected by the page it was written beside: Next exposes each
 * one as its own POST endpoint addressed by an id that appears in the client bundle, so
 * a caller can invoke it without ever rendering `/administration/registrations`. This
 * file therefore tests the actions, not the pages.
 *
 * Three properties, and the last two are the ones a refactor loses quietly:
 *
 *   1. an Auditor and an unauthenticated caller are both refused with the verbatim
 *      reason the authorization path produced;
 *   2. on a refusal NOTHING else runs — the command is never called and the runtime is
 *      never reached, so a refused caller cannot make the process open a database
 *      connection; and
 *   3. a malformed body is refused with one sentence and never reaches the command,
 *      including a `permittedActions` array carrying a write action, which satisfies
 *      TypeScript and must not satisfy this boundary.
 */

const requireServerAction = vi.fn<() => Promise<ActionDecision>>();
const currentCorrelationId = vi.fn(async () => 'corr-test');
const registerTargetSystem = vi.fn();
const changeTargetSystem = vi.fn();
const getRuntime = vi.fn(() => {
  throw new Error('the runtime must not be reached on a refusal');
});

vi.mock('../../../src/server-session', () => ({
  requireServerAction: (...args: unknown[]) =>
    (requireServerAction as unknown as (...a: unknown[]) => Promise<ActionDecision>)(...args),
  currentCorrelationId: () => currentCorrelationId(),
}));

vi.mock('../../../src/bootstrap', () => ({ getRuntime: () => getRuntime() }));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@intellifin/application', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@intellifin/application')>();
  return {
    ...actual,
    registerTargetSystem: (...args: unknown[]) => registerTargetSystem(...args),
    changeTargetSystem: (...args: unknown[]) => changeTargetSystem(...args),
  };
});

const { createRegistrationAction, changeRegistrationAction } = await import('./actions');

const VALID = {
  displayName: 'Northstar Web',
  kind: 'web',
  allowedOrigins: ['https://northstar.synthetic.invalid'],
  applicationIdentity: '',
  credentialRef: 'cred://synthetic/northstar-readonly',
  permittedActions: ['navigate', 'read-attribute'],
  attributeLabelPatterns: ['Invoice *'],
  secondaryKey: '',
  note: '',
  status: 'active',
} as const;

const VALID_CHANGE = {
  ...VALID,
  registrationId: '018f0000-0000-7000-8000-000000000001',
  expectedDigest: 'a'.repeat(64),
} as const;

const AUDITOR_DENIED: ActionDecision = {
  allowed: false,
  status: 403,
  reason: 'Your role does not permit this action.',
};

const UNAUTHENTICATED: ActionDecision = {
  allowed: false,
  status: 401,
  reason: 'Sign in to continue.',
};

const ALLOWED: ActionDecision = {
  allowed: true,
  session: { userId: 'admin-1', sessionId: 'session-1' },
  role: 'poc-administrator',
};

const MALFORMED = 'That request was not valid. Nothing was changed.';

describe('the registration Server Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['an Auditor', AUDITOR_DENIED],
    ['an unauthenticated caller', UNAUTHENTICATED],
  ])('refuses %s on create, without reaching the command', async (_label, decision) => {
    requireServerAction.mockResolvedValue(decision);

    await expect(createRegistrationAction(VALID)).resolves.toEqual({
      ok: false,
      reason: decision.allowed ? '' : decision.reason,
    });
    expect(registerTargetSystem).not.toHaveBeenCalled();
    expect(getRuntime).not.toHaveBeenCalled();
  });

  it.each([
    ['an Auditor', AUDITOR_DENIED],
    ['an unauthenticated caller', UNAUTHENTICATED],
  ])('refuses %s on change, without reaching the command', async (_label, decision) => {
    requireServerAction.mockResolvedValue(decision);

    await expect(changeRegistrationAction(VALID_CHANGE)).resolves.toEqual({
      ok: false,
      reason: decision.allowed ? '' : decision.reason,
    });
    expect(changeTargetSystem).not.toHaveBeenCalled();
    expect(getRuntime).not.toHaveBeenCalled();
  });

  it('authorizes before it reads the input at all', async () => {
    requireServerAction.mockResolvedValue(AUDITOR_DENIED);
    // A body that would fail every shape check. The refusal must still be the role one:
    // a malformed-body message would tell an unauthorized caller which fields exist.
    await expect(
      createRegistrationAction({ nonsense: true } as unknown as typeof VALID),
    ).resolves.toEqual({ ok: false, reason: AUDITOR_DENIED.reason });
  });

  it.each([
    ['a missing body', undefined],
    ['a null body', null],
    ['a number where a string belongs', { ...VALID, displayName: 42 }],
    ['an origin list that is not a list', { ...VALID, allowedOrigins: 'https://x.invalid' }],
    ['a list of numbers', { ...VALID, permittedActions: [1, 2] }],
    ['a kind outside the vocabulary', { ...VALID, kind: 'ftp' }],
    ['a status outside the vocabulary', { ...VALID, status: 'deleted' }],
    // TypeScript would accept this at the call site of the command; the boundary must not.
    ['a write action', { ...VALID, permittedActions: ['create-record'] }],
    ['an inherited key', { ...VALID, kind: 'constructor' }],
    ['a display name past its bound', { ...VALID, displayName: 'x'.repeat(201) }],
    ['an origin past its bound', { ...VALID, allowedOrigins: ['x'.repeat(401)] }],
  ])('refuses %s with one sentence, without reaching the command', async (_label, body) => {
    requireServerAction.mockResolvedValue(ALLOWED);

    await expect(createRegistrationAction(body as unknown as typeof VALID)).resolves.toEqual({
      ok: false,
      reason: MALFORMED,
    });
    expect(registerTargetSystem).not.toHaveBeenCalled();
    expect(getRuntime).not.toHaveBeenCalled();
  });

  it.each([
    ['no registration id', { ...VALID_CHANGE, registrationId: 42 }],
    ['a registration id past its bound', { ...VALID_CHANGE, registrationId: 'x'.repeat(65) }],
    ['a digest past its bound', { ...VALID_CHANGE, expectedDigest: 'a'.repeat(65) }],
  ])('refuses a change with %s', async (_label, body) => {
    requireServerAction.mockResolvedValue(ALLOWED);

    await expect(
      changeRegistrationAction(body as unknown as typeof VALID_CHANGE),
    ).resolves.toEqual({ ok: false, reason: MALFORMED });
    expect(changeTargetSystem).not.toHaveBeenCalled();
  });
});
