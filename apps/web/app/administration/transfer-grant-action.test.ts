import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), setGrant: vi.fn(), refresh: vi.fn() }));
vi.mock('../../src/server-session', () => ({ requireServerAction: mocks.authorize, currentCorrelationId: async () => 'trusted-correlation' }));
vi.mock('../../src/bootstrap', () => ({ getRuntime: async () => ({ db: {}, authConfig: {} }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.refresh }));
vi.mock('@intellifin/application', async original => ({ ...await original<typeof import('@intellifin/application')>(), setUserRunControlTransferGrant: mocks.setGrant }));
import { setUserRunControlTransferGrantAction } from './actions';
const session = { userId: 'administrator', sessionId: 'trusted-session' };
const request = { userId: 'manager', granted: true, expectedGrantRevision: 8 };
beforeEach(() => {
  vi.clearAllMocks(); mocks.authorize.mockResolvedValue({ allowed: true, session, role: 'poc-administrator' });
});
describe('administrator transfer grant dispatch', () => {
  it('passes the exact expected revision and trusted session and refreshes the directory', async () => {
    mocks.setGrant.mockResolvedValue({ ok: true, userId: request.userId, grant: { granted: true, revision: 9 } });
    expect(await setUserRunControlTransferGrantAction(request)).toEqual({ ok: true, message: 'Run control transfer permission granted.' });
    expect(mocks.setGrant.mock.calls[0]?.[1]).toEqual({ ...request, session, correlationId: 'trusted-correlation' });
    expect(mocks.refresh).toHaveBeenCalledWith('/administration');
  });
  it('preserves a stale-revision refusal without reporting a successful save', async () => {
    mocks.setGrant.mockResolvedValue({ ok: false, reason: 'This permission changed. Refresh the user list.' });
    expect(await setUserRunControlTransferGrantAction(request)).toEqual({ ok: false, reason: 'This permission changed. Refresh the user list.' });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it('reports a lost response truthfully without asserting rollback or leaking internal details', async () => {
    mocks.setGrant.mockRejectedValue(new Error('private SQL statement'));
    const result = await setUserRunControlTransferGrantAction(request);
    expect(result).toEqual({ ok: false, reason: 'The permission change could not be confirmed. Refresh the user list before trying again.' });
    expect(mocks.setGrant).toHaveBeenCalledTimes(1);
  });
});
