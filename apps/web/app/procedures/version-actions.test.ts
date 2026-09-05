import { beforeEach, describe, it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ identity: vi.fn(), runtime: vi.fn(), transition: vi.fn() }));
vi.mock('../../src/server-session', () => ({ currentIdentity: mocks.identity, currentCorrelationId: async () => 'correlation' }));
vi.mock('../../src/bootstrap', () => ({ getRuntime: mocks.runtime }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@intellifin/application', async original => ({ ...await original<typeof import('@intellifin/application')>(), transitionVersion: mocks.transition }));
import { versionDecisionAction } from './version-actions';
const fields = { procedureId:'018f0000-0000-7000-8000-000000000001',versionId:'018f0000-0000-7000-8000-000000000002',expectedRowVersion:'a'.repeat(64),decision:'approve' as const };
beforeEach(() => { vi.clearAllMocks(); mocks.identity.mockResolvedValue({kind:'identified',session:{userId:'trusted-user',sessionId:'trusted-session'},role:'audit-manager'}); mocks.runtime.mockResolvedValue({db:{},telemetry:{captureError:vi.fn()}}); mocks.transition.mockResolvedValue({ok:true}); });
describe('version action trusted request context', () => {
  it('refuses an unauthenticated caller before inspecting input', async () => {
    mocks.identity.mockResolvedValue({kind:'anonymous'});
    expect(await versionDecisionAction(new Proxy(fields,{get:() => {throw new Error('must not inspect');}}))).toEqual({ok:false,reason:'Sign in to continue.'});
    expect(mocks.runtime).not.toHaveBeenCalled(); expect(mocks.transition).not.toHaveBeenCalled();
  });
  it.each(['session','authorId','humanAuthorIds','role','context'])('refuses forged %s rather than forwarding authority', async key => {
    expect(await versionDecisionAction({...fields,[key]:'forged'})).toMatchObject({ok:false}); expect(mocks.transition).not.toHaveBeenCalled();
  });
  it('uses only the resolved server session for the command', async () => {
    expect(await versionDecisionAction(fields)).toMatchObject({ok:true});
    expect(mocks.transition.mock.calls[0]?.[1]).toMatchObject({session:{userId:'trusted-user',sessionId:'trusted-session'}});
    expect(mocks.transition.mock.calls[0]?.[2]).toBe('approve');
  });
});
