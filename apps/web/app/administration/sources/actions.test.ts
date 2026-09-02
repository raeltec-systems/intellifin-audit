import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActionDecision } from '../../../src/require-role';

/**
 * The binding Server Actions refuse for themselves (FR-1, FR-2, FR-6).
 *
 * A Server Action is NOT protected by the page it was written beside: Next exposes each
 * one as its own POST endpoint addressed by an id that appears in the client bundle, so a
 * caller can invoke it without ever rendering `/administration/sources`. This file
 * therefore tests the actions, not the pages.
 *
 * Three properties, and the last two are the ones a refactor loses quietly:
 *
 *   1. an Auditor and an unauthenticated caller are both refused with the verbatim reason
 *      the authorization path produced;
 *   2. on a refusal NOTHING else runs — the command is never called and the runtime is
 *      never reached, so a refused caller cannot make the process open a database
 *      connection; and
 *   3. a malformed body is refused with one sentence and never reaches the command,
 *      including a mechanism or a kind outside the vocabulary, which satisfies TypeScript
 *      and must not satisfy this boundary.
 */

const requireServerAction = vi.fn<() => Promise<ActionDecision>>();
const currentCorrelationId = vi.fn(async () => 'corr-test');
const registerPopulationSource = vi.fn();
const changePopulationSource = vi.fn();
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
    registerPopulationSource: (...args: unknown[]) => registerPopulationSource(...args),
    changePopulationSource: (...args: unknown[]) => changePopulationSource(...args),
  };
});

const { createBindingAction, changeBindingAction } = await import('./actions');

const VALID = {
  displayName: 'HR leavers export',
  kind: 'versioned-file',
  location: 's3://synthetic-bucket/hr/leavers/2026-08.csv',
  declaredSchema: ['employee_id', 'salary'],
  declaredCountMechanism: 'cover-sheet',
  sensitiveFields: ['salary'],
  note: '',
  status: 'active',
} as const;

const VALID_CHANGE = {
  ...VALID,
  bindingId: '018f0000-0000-7000-8000-000000000001',
  expectedRowVersion: 'a'.repeat(64),
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

describe('the binding Server Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['an Auditor', AUDITOR_DENIED],
    ['an unauthenticated caller', UNAUTHENTICATED],
  ])('refuses %s on create, without reaching the command', async (_label, decision) => {
    requireServerAction.mockResolvedValue(decision);

    await expect(createBindingAction(VALID)).resolves.toEqual({
      ok: false,
      reason: decision.allowed ? '' : decision.reason,
    });
    expect(registerPopulationSource).not.toHaveBeenCalled();
    expect(getRuntime).not.toHaveBeenCalled();
  });

  it.each([
    ['an Auditor', AUDITOR_DENIED],
    ['an unauthenticated caller', UNAUTHENTICATED],
  ])('refuses %s on change, without reaching the command', async (_label, decision) => {
    requireServerAction.mockResolvedValue(decision);

    await expect(changeBindingAction(VALID_CHANGE)).resolves.toEqual({
      ok: false,
      reason: decision.allowed ? '' : decision.reason,
    });
    expect(changePopulationSource).not.toHaveBeenCalled();
    expect(getRuntime).not.toHaveBeenCalled();
  });

  it('asks for the binding action, not some other one', async () => {
    // The gating table names `administration.bindings.manage`. Asking for a different
    // action would either refuse every administrator or, worse, gate this surface behind
    // a permission somebody else holds.
    requireServerAction.mockResolvedValue(AUDITOR_DENIED);
    await createBindingAction(VALID);
    await changeBindingAction(VALID_CHANGE);
    expect(requireServerAction).toHaveBeenCalledTimes(2);
    for (const call of requireServerAction.mock.calls) {
      expect(call).toEqual(['administration.bindings.manage']);
    }
  });

  it('authorizes before it reads the input at all', async () => {
    requireServerAction.mockResolvedValue(AUDITOR_DENIED);
    // A body that would fail every shape check. The refusal must still be the role one: a
    // malformed-body message would tell an unauthorized caller which fields exist.
    await expect(
      createBindingAction({ nonsense: true } as unknown as typeof VALID),
    ).resolves.toEqual({ ok: false, reason: AUDITOR_DENIED.reason });
  });

  it.each([
    ['a missing body', undefined],
    ['a null body', null],
    ['a number where a string belongs', { ...VALID, displayName: 42 }],
    ['a schema that is not a list', { ...VALID, declaredSchema: 'employee_id' }],
    ['a list of numbers', { ...VALID, sensitiveFields: [1, 2] }],
    ['a kind outside the vocabulary', { ...VALID, kind: 'sftp' }],
    ['a mechanism outside the vocabulary', { ...VALID, declaredCountMechanism: 'trust-me' }],
    ['a status outside the vocabulary', { ...VALID, status: 'deleted' }],
    ['an inherited key as the kind', { ...VALID, kind: 'constructor' }],
    ['an inherited key as the mechanism', { ...VALID, declaredCountMechanism: 'toString' }],
    ['a display name past its bound', { ...VALID, displayName: 'x'.repeat(201) }],
    ['a location past its bound', { ...VALID, location: 'x'.repeat(1001) }],
    ['a field name past its bound', { ...VALID, declaredSchema: ['x'.repeat(201)] }],
    ['a schema with too many fields', { ...VALID, declaredSchema: Array(201).fill('f') }],
    ['a note past its bound', { ...VALID, note: 'x'.repeat(2001) }],
  ])('refuses %s with one sentence, without reaching the command', async (_label, body) => {
    requireServerAction.mockResolvedValue(ALLOWED);

    await expect(createBindingAction(body as unknown as typeof VALID)).resolves.toEqual({
      ok: false,
      reason: MALFORMED,
    });
    expect(registerPopulationSource).not.toHaveBeenCalled();
    expect(getRuntime).not.toHaveBeenCalled();
  });

  it.each([
    ['no binding id', { ...VALID_CHANGE, bindingId: 42 }],
    ['a binding id that is not a UUID', { ...VALID_CHANGE, bindingId: 'x'.repeat(36) }],
    ['a binding id past its bound', { ...VALID_CHANGE, bindingId: 'x'.repeat(65) }],
    ['a row version past its bound', { ...VALID_CHANGE, expectedRowVersion: 'a'.repeat(65) }],
    ['a row version that is not a string', { ...VALID_CHANGE, expectedRowVersion: null }],
  ])('refuses a change with %s', async (_label, body) => {
    requireServerAction.mockResolvedValue(ALLOWED);

    await expect(changeBindingAction(body as unknown as typeof VALID_CHANGE)).resolves.toEqual({
      ok: false,
      reason: MALFORMED,
    });
    expect(changePopulationSource).not.toHaveBeenCalled();
  });

  it('passes the row version through unchanged, so the guard is the command\'s', async () => {
    requireServerAction.mockResolvedValue(ALLOWED);
    getRuntime.mockImplementation((() => {
      throw new Error('the runtime is not available in this test');
    }) as never);
    changePopulationSource.mockResolvedValue({ ok: false, reason: 'stop here' });

    // `dependencies()` reaches the runtime, so this asserts the failure path's message
    // rather than the command call. What it proves is that a well-formed body is NOT
    // refused at the boundary — the boundary checks shape, and the row-version decision
    // belongs to the command, inside its transaction.
    await expect(changeBindingAction(VALID_CHANGE)).resolves.toEqual({
      ok: false,
      reason: 'The change could not be saved. Nothing was changed.',
    });
  });
});
