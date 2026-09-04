import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActionDecision } from '../../../src/require-role';

/**
 * The Procedure Server Actions refuse for themselves (FR-4, FR-7).
 *
 * A Server Action is NOT protected by the page it was written beside: Next exposes each
 * one as its own POST endpoint addressed by an id that appears in the client bundle, so
 * a caller can invoke it without ever rendering `/procedures/new` or a Builder. This
 * file therefore tests the actions, not the pages.
 *
 * Three properties, and the last two are the ones a refactor loses quietly:
 *
 *   1. an Auditor (no `procedure.author`) and an unauthenticated caller are both refused
 *      with the verbatim reason the authorization path produced;
 *   2. on a refusal NOTHING else runs — the command is never called and the runtime is
 *      never reached, so a refused caller cannot make the process open a database
 *      connection; and
 *   3. a malformed body is refused with one sentence and never reaches the command,
 *      including ids that are not UUIDs and a Control name past its bound.
 */

const requireServerAction = vi.fn<() => Promise<ActionDecision>>();
const currentCorrelationId = vi.fn(async () => 'corr-test');
const createProcedure = vi.fn();
const renameProcedureDraft = vi.fn();
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
    createProcedure: (...args: unknown[]) => createProcedure(...args),
    renameProcedureDraft: (...args: unknown[]) => renameProcedureDraft(...args),
  };
});

const { createProcedureAction } = await import('./actions');
const { renameProcedureDraftAction } = await import('../[id]/builder/actions');

const PROCEDURE_ID = '018f0000-0000-7000-8000-000000000001';
const VERSION_ID = '018f0000-0000-7000-8000-000000000002';

const VALID_NEW = {
  templateId: 'P-1',
  controlName: 'Terminated users retain no access',
} as const;

const VALID_RENAME = {
  procedureId: PROCEDURE_ID,
  versionId: VERSION_ID,
  controlName: 'Renamed',
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
  session: { userId: 'auditor-1', sessionId: 'session-1' },
  role: 'auditor',
};

const MALFORMED = 'That request was not valid. Nothing was changed.';

describe('the Procedure Server Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['a PoC Administrator', AUDITOR_DENIED],
    ['an unauthenticated caller', UNAUTHENTICATED],
  ])('refuses %s on create, without reaching the command', async (_label, decision) => {
    requireServerAction.mockResolvedValue(decision);

    await expect(createProcedureAction(VALID_NEW)).resolves.toEqual({
      ok: false,
      reason: decision.reason,
    });
    expect(createProcedure).not.toHaveBeenCalled();
    expect(getRuntime).not.toHaveBeenCalled();
  });

  it.each([
    ['a PoC Administrator', AUDITOR_DENIED],
    ['an unauthenticated caller', UNAUTHENTICATED],
  ])('refuses %s on rename, without reaching the command', async (_label, decision) => {
    requireServerAction.mockResolvedValue(decision);

    await expect(renameProcedureDraftAction(VALID_RENAME)).resolves.toEqual({
      ok: false,
      reason: decision.reason,
    });
    expect(renameProcedureDraft).not.toHaveBeenCalled();
    expect(getRuntime).not.toHaveBeenCalled();
  });

  it('asks for procedure.author, the action the gating table names, on both', async () => {
    requireServerAction.mockResolvedValue(AUDITOR_DENIED);
    await createProcedureAction(VALID_NEW);
    await renameProcedureDraftAction(VALID_RENAME);
    expect(requireServerAction).toHaveBeenCalledTimes(2);
    for (const call of requireServerAction.mock.calls) {
      expect(call).toEqual(['procedure.author']);
    }
  });

  it('authorizes before it reads the input at all', async () => {
    requireServerAction.mockResolvedValue(AUDITOR_DENIED);
    // Bodies that would fail every shape check. The refusal must still be the role one:
    // a malformed-body message would tell an unauthorized caller which fields exist.
    await expect(
      createProcedureAction({ nonsense: true } as unknown as typeof VALID_NEW),
    ).resolves.toEqual({ ok: false, reason: AUDITOR_DENIED.reason });
    await expect(
      renameProcedureDraftAction(null as unknown as typeof VALID_RENAME),
    ).resolves.toEqual({ ok: false, reason: AUDITOR_DENIED.reason });
    expect(createProcedure).not.toHaveBeenCalled();
    expect(renameProcedureDraft).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing body', undefined],
    ['a null body', null],
    ['no Template chosen', { ...VALID_NEW, templateId: '' }],
    ['a Template id that is not a string', { ...VALID_NEW, templateId: 42 }],
    ['a Template id past vocabulary size', { ...VALID_NEW, templateId: 'P-9999999' }],
    ['a Control name that is not a string', { ...VALID_NEW, controlName: 7 }],
    ['a Control name past its bound', { ...VALID_NEW, controlName: 'x'.repeat(201) }],
  ])('refuses a create with %s, without reaching the command', async (_label, body) => {
    requireServerAction.mockResolvedValue(ALLOWED);

    await expect(createProcedureAction(body as unknown as typeof VALID_NEW)).resolves.toEqual({
      ok: false,
      reason: MALFORMED,
    });
    expect(createProcedure).not.toHaveBeenCalled();
    expect(getRuntime).not.toHaveBeenCalled();
  });

  it.each([
    ['no procedure id', { ...VALID_RENAME, procedureId: undefined }],
    ['a procedure id that is not a UUID', { ...VALID_RENAME, procedureId: 'not-a-uuid' }],
    ['a version id that is not a UUID', { ...VALID_RENAME, versionId: 99 }],
    ['a Control name past its bound', { ...VALID_RENAME, controlName: 'x'.repeat(201) }],
    ['a row version past its bound', { ...VALID_RENAME, expectedRowVersion: 'a'.repeat(65) }],
    ['a row version that is not a string', { ...VALID_RENAME, expectedRowVersion: null }],
  ])('refuses a rename with %s, without reaching the command', async (_label, body) => {
    requireServerAction.mockResolvedValue(ALLOWED);

    await expect(
      renameProcedureDraftAction(body as unknown as typeof VALID_RENAME),
    ).resolves.toEqual({ ok: false, reason: MALFORMED });
    expect(renameProcedureDraft).not.toHaveBeenCalled();
    expect(getRuntime).not.toHaveBeenCalled();
  });

  it('passes a well-formed create through to the command', async () => {
    requireServerAction.mockResolvedValue(ALLOWED);
    getRuntime.mockImplementation((() => {
      throw new Error('the runtime is not available in this test');
    }) as never);

    // `dependencies()` reaches the runtime, so this asserts the failure path's message
    // rather than the command call — the same reading as the binding action test. What
    // it proves is that a well-formed body is NOT refused at the boundary: the boundary
    // checks shape, and the vocabulary decision belongs to the command, which is the
    // one place the domain's validator lives. The UNAVAILABLE message (not MALFORMED)
    // is the proof the body got past every shape check.
    await expect(createProcedureAction(VALID_NEW)).resolves.toEqual({
      ok: false,
      reason: 'The Procedure could not be created. Nothing was changed.',
    });
  });

  it('passes a well-formed rename through to the command', async () => {
    requireServerAction.mockResolvedValue(ALLOWED);
    getRuntime.mockImplementation((() => {
      throw new Error('the runtime is not available in this test');
    }) as never);

    // Same reading: UNAVAILABLE, not MALFORMED, is the proof the body passed the
    // boundary, and the row-version decision belongs to the command inside its
    // transaction.
    await expect(renameProcedureDraftAction(VALID_RENAME)).resolves.toEqual({
      ok: false,
      reason: 'The change could not be saved. Nothing was changed.',
    });
  });
});

describe('the New-procedure page gate, read off the page source', () => {
  // The e2e PoC case exercises this in a browser; this is the unit-level half of the
  // same guard, on the repo's own precedent of source-pinning surfaces (copy.test.ts).
  // It fails the moment the gate moves after the render or disappears — which is the
  // mutation a refactor loses quietly.
  const page = () =>
    readFileSync(fileURLToPath(new URL('./page.tsx', import.meta.url)), 'utf8');

  it('asks the audited authorization path for procedure.author before rendering anything', () => {
    const source = page();
    const gate = source.indexOf('await requireServerAction(PROCEDURE_AUTHOR_ACTION)');
    expect(gate).toBeGreaterThan(-1);
    expect(source.indexOf('<NewProcedureForm')).toBeGreaterThan(gate);
  });

  it('renders only the verbatim refusal when the gate refuses', () => {
    const source = page();
    expect(source).toContain('decision.reason');
    // The refusal branch must not embed the form's JSX: one return, one branch.
    expect(source.match(/<NewProcedureForm/g)).toHaveLength(1);
  });
});
