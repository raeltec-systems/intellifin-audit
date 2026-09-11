import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), runtime: vi.fn(), generate: vi.fn(), accept: vi.fn(), reject: vi.fn(), revalidate: vi.fn() }));
vi.mock('../../src/server-session', () => ({ requireServerAction: mocks.authorize, currentCorrelationId: async () => 'trusted-correlation' }));
vi.mock('../../src/bootstrap', () => ({ getRuntime: mocks.runtime }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('@intellifin/application', async original => ({ ...await original<typeof import('@intellifin/application')>(), generateAuthoringSuggestion: mocks.generate, acceptAuthoringSuggestion: mocks.accept, rejectAuthoringSuggestion: mocks.reject }));
import { acceptAuthoringSuggestionAction, generateAuthoringSuggestionAction, rejectAuthoringSuggestionAction } from './[id]/builder/actions';

const common = { procedureId: '018f0000-0000-7000-8000-000000000001', versionId: '018f0000-0000-7000-8000-000000000002', requestId: '018f0000-0000-7000-8000-000000000003' };
const generation = { ...common, expectedRowVersion: 'a'.repeat(64), section: { kind: 'objective' as const }, mode: 'draft' as const, notes: 'Synthetic rough notes', changes: '' };
const acceptance = { ...common, expectedRowVersion: 'a'.repeat(64), replacement: 'A human accepted replacement.' };
const session = { userId: 'trusted-auditor', sessionId: 'trusted-session' };
beforeEach(() => {
  vi.clearAllMocks(); mocks.authorize.mockResolvedValue({ allowed: true, session, role: 'auditor' });
  mocks.runtime.mockResolvedValue({ db: {}, authoringModel: null });
  mocks.generate.mockResolvedValue({ ok: false, reason: 'Not configured' }); mocks.accept.mockResolvedValue({ ok: true, rowVersion: 'b'.repeat(64), alreadyApplied: false }); mocks.reject.mockResolvedValue({ ok: true });
});
describe('writing Server Actions enforce trusted request context', () => {
  it('authorizes every endpoint before inspecting untrusted input or reaching the runtime', async () => {
    mocks.authorize.mockResolvedValue({ allowed: false, reason: 'Sign in to continue.' });
    const unreadable = new Proxy(generation, { get() { throw new Error('Must not inspect'); }, ownKeys() { throw new Error('Must not inspect'); } });
    expect(await generateAuthoringSuggestionAction(unreadable)).toEqual({ ok: false, reason: 'Sign in to continue.' });
    expect(await acceptAuthoringSuggestionAction(unreadable as unknown as typeof acceptance)).toMatchObject({ ok: false });
    expect(await rejectAuthoringSuggestionAction(unreadable)).toMatchObject({ ok: false });
    expect(mocks.authorize).toHaveBeenCalledTimes(3); expect(mocks.runtime).not.toHaveBeenCalled(); expect(mocks.generate).not.toHaveBeenCalled(); expect(mocks.accept).not.toHaveBeenCalled(); expect(mocks.reject).not.toHaveBeenCalled();
  });
  it.each(['session', 'authorId', 'role', 'context'])('rejects forged %s instead of forwarding it', async key => {
    expect(await generateAuthoringSuggestionAction({ ...generation, [key]: 'forged' })).toMatchObject({ ok: false });
    expect(await acceptAuthoringSuggestionAction({ ...acceptance, [key]: 'forged' })).toMatchObject({ ok: false });
    expect(await rejectAuthoringSuggestionAction({ ...common, [key]: 'forged' })).toMatchObject({ ok: false });
    expect(mocks.runtime).not.toHaveBeenCalled();
  });
  it('uses the server-resolved human and only refreshes saved content after acceptance', async () => {
    await generateAuthoringSuggestionAction(generation); expect(mocks.generate.mock.calls[0]?.[1]).toMatchObject({ ...generation, session, correlationId: 'trusted-correlation' }); expect(mocks.revalidate).not.toHaveBeenCalled();
    await acceptAuthoringSuggestionAction(acceptance); expect(mocks.accept.mock.calls[0]?.[1]).toMatchObject({ ...acceptance, session }); expect(mocks.revalidate).toHaveBeenCalledWith(`/procedures/${common.procedureId}/builder`);
  });
  it('keeps uncertain generation and acceptance failures distinct from known refusals', async () => {
    mocks.generate.mockRejectedValueOnce(new Error('SENSITIVE_PROVIDER_BODY')); mocks.accept.mockRejectedValueOnce(new Error('SENSITIVE_DATABASE_BODY'));
    await expect(generateAuthoringSuggestionAction(generation)).rejects.toThrow('The writing response could not be confirmed.');
    await expect(acceptAuthoringSuggestionAction(acceptance)).rejects.toThrow('The change may have been saved.');
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
