import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), runtime: vi.fn(), acquire: vi.fn(), renew: vi.fn(), release: vi.fn(), read: vi.fn() }));
vi.mock('../../src/server-session', () => ({ requireServerAction: mocks.authorize, currentCorrelationId: async () => 'trusted-correlation' }));
vi.mock('../../src/bootstrap', () => ({ getRuntime: mocks.runtime }));
vi.mock('@intellifin/application', async original => ({ ...await original<typeof import('@intellifin/application')>(),
  acquireRunControlLease: mocks.acquire, renewRunControlLease: mocks.renew, releaseRunControlLease: mocks.release }));
vi.mock('@intellifin/infrastructure', async original => ({ ...await original<typeof import('@intellifin/infrastructure')>(), readRunControlLease: mocks.read }));
import { changeRunControlAction, readRunControlAction } from './control-actions';

const session = { userId: 'trusted-auditor', sessionId: 'trusted-session' };
const request = { runId: '019823ab-0000-7000-8000-000000000001', expectedEpoch: 7 };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({ allowed: true, session });
  mocks.runtime.mockResolvedValue({ db: {}, conversationEnabled: false, telemetry: { captureError: vi.fn() } });
  for (const command of [mocks.acquire, mocks.renew, mocks.release]) command.mockResolvedValue({ ok: true });
  mocks.read.mockResolvedValue({ status: 'missing' });
});

describe('Run controller server boundaries', () => {
  it('authorizes before inspecting request data or reading controller state', async () => {
    mocks.authorize.mockResolvedValue({ allowed: false, reason: 'This role cannot resume.' });
    const hostile = new Proxy({}, { get: () => { throw new Error('inspected input'); }, ownKeys: () => { throw new Error('inspected input'); } });
    expect(await changeRunControlAction('acquire', hostile)).toEqual({ ok: false, reason: 'This role cannot resume.' });
    expect(await readRunControlAction(hostile)).toEqual({ status: 'denied' });
    expect(mocks.runtime).not.toHaveBeenCalled();
    expect(mocks.acquire).not.toHaveBeenCalled();
  });
  it.each(['transfer', 'takeover', 'constructor', '__proto__'])('never dispatches an unsupported operation: %s', async operation => {
    expect(await changeRunControlAction(operation, request)).toMatchObject({ ok: false });
    expect(mocks.acquire).not.toHaveBeenCalled();
    expect(mocks.renew).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
  });
  it.each(['acquire', 'renew', 'release'] as const)('passes trusted identity and server enrollment policy to %s', async operation => {
    expect(await changeRunControlAction(operation, request)).toEqual({ ok: true });
    const command = mocks[operation];
    expect(command.mock.calls[0]?.[1]).toEqual({ session, request });
    expect(command.mock.calls[0]?.[0]).toMatchObject({ allowEnrollment: false });
    expect(mocks.authorize).toHaveBeenCalledWith('run.resume');
  });
  it('does not turn a lost acknowledgment into an asserted rollback or automatic retry', async () => {
    mocks.acquire.mockRejectedValue(new Error('lost acknowledgment'));
    expect(await changeRunControlAction('acquire', request)).toMatchObject({ ok: false, unknownOutcome: true });
    expect(mocks.acquire).toHaveBeenCalledTimes(1);
  });
  it('binds the protected read to the authenticated actor and server policy', async () => {
    expect(await readRunControlAction(request.runId)).toEqual({ status: 'missing' });
    expect(mocks.read).toHaveBeenCalledWith({}, { runId: request.runId, actorId: session.userId, requiredForUnenrolledRun: false });
  });
});
