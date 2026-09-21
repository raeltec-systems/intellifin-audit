import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), session: vi.fn(), runtime: vi.fn(), acquire: vi.fn(), renew: vi.fn(), release: vi.fn(), propose: vi.fn(), confirm: vi.fn(), recover: vi.fn(), read: vi.fn() }));
vi.mock('../../src/server-session', () => ({ requireServerAction: mocks.authorize, currentSession: mocks.session, currentCorrelationId: async () => 'trusted-correlation' }));
vi.mock('../../src/bootstrap', () => ({ getRuntime: mocks.runtime }));
vi.mock('@intellifin/application', async original => ({ ...await original<typeof import('@intellifin/application')>(),
  proposeRunControlTransfer: mocks.propose, confirmRunControlTransfer: mocks.confirm, recoverRunControlTransferReceipt: mocks.recover, acquireRunControlLease: mocks.acquire, renewRunControlLease: mocks.renew, releaseRunControlLease: mocks.release }));
vi.mock('@intellifin/infrastructure', async original => ({ ...await original<typeof import('@intellifin/infrastructure')>(), readRunControlLease: mocks.read }));
import { recoverRunControlTransferReceiptAction, proposeRunControlTransferAction, confirmRunControlTransferAction, changeRunControlAction, readRunControlAction } from './control-actions';

const session = { userId: 'trusted-auditor', sessionId: 'trusted-session' };
const request = { runId: '019823ab-0000-7000-8000-000000000001', expectedEpoch: 7 };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({ allowed: true, session });
  mocks.session.mockResolvedValue({ authenticated: true, session });
  mocks.runtime.mockResolvedValue({ db: {}, conversationEnabled: false, config: { RUN_CONVERSATION_MODE: 'off' }, telemetry: { captureError: vi.fn() } });
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


describe('distinct manager transfer server boundaries', () => {
  it.each([proposeRunControlTransferAction, confirmRunControlTransferAction, recoverRunControlTransferReceiptAction])('refuses an unauthenticated request before reading untrusted input', async action => {
    mocks.session.mockResolvedValue({ authenticated: false });
    const hostile = new Proxy({}, { get: () => { throw new Error('read'); }, ownKeys: () => { throw new Error('enumerated'); } });
    expect(await action(hostile, session.userId)).toEqual({ ok: false, code: 'unauthorized', reason: 'Sign in to continue.' });
    expect(mocks.runtime).not.toHaveBeenCalled();
    expect(mocks.propose).not.toHaveBeenCalled(); expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it('passes the authenticated session and exact proposal to the dedicated service', async () => {
    const proposed = { ...request, requestKey: '019823ab-0000-7000-8000-000000000002', reason: 'Covering the handover' };
    mocks.propose.mockResolvedValue({ ok: false, code: 'unauthorized', reason: 'Permission is required.' });
    expect(await proposeRunControlTransferAction(proposed, session.userId)).toMatchObject({ ok: false, code: 'unauthorized' });
    expect(mocks.propose.mock.calls[0]?.[1]).toEqual({ session, request: proposed });
    expect(mocks.acquire).not.toHaveBeenCalled();
    expect(mocks.authorize).not.toHaveBeenCalled();
  });
  it('passes confirmation identity without manufacturing a new epoch or actor', async () => {
    const confirmation = { runId: request.runId, commandId: '019823ab-0000-7000-8000-000000000002' };
    mocks.confirm.mockResolvedValue({ ok: true, receipt: { epoch: 8 }, replayed: true });
    expect(await confirmRunControlTransferAction(confirmation, session.userId)).toEqual({ ok: true, receipt: { epoch: 8 }, replayed: true });
    expect(mocks.confirm.mock.calls[0]?.[1]).toEqual({ session, request: confirmation });
  });
  it.each(['propose', 'confirm'] as const)('retains unknown outcome without logging governed content for %s', async mode => {
    const captureError = vi.fn();
    mocks.runtime.mockResolvedValue({ db: {}, config: { RUN_CONVERSATION_MODE: 'off' }, telemetry: { captureError } });
    mocks[mode].mockRejectedValue(new Error('private reason copied into a driver error'));
    const action = mode === 'propose' ? proposeRunControlTransferAction : confirmRunControlTransferAction;
    const result = await action(request, session.userId);
    expect(result).toMatchObject({ ok: false, unknownOutcome: true });
    expect(JSON.stringify(result)).not.toContain('private reason');
    expect(captureError).not.toHaveBeenCalled(); expect(mocks[mode]).toHaveBeenCalledTimes(1);
  });
});

it('never dispatches a retained proposal under another authenticated account', async () => {
  const result = await proposeRunControlTransferAction({ ...request, reason: 'previous account private reason' }, 'previous-manager');
  expect(result).toMatchObject({ ok: false, code: 'unauthorized' });
  expect(mocks.propose).not.toHaveBeenCalled(); expect(JSON.stringify(result)).not.toContain('private reason');
});
it('receipt recovery invokes only the read-only service, never confirmation or proposal', async () => {
  mocks.recover.mockResolvedValue({ ok: false, code: 'conflict', reason: 'No applied receipt exists.' });
  expect(await recoverRunControlTransferReceiptAction({ runId: request.runId, commandId: 'command' }, session.userId)).toMatchObject({ ok: false, code: 'conflict' });
  expect(mocks.confirm).not.toHaveBeenCalled(); expect(mocks.propose).not.toHaveBeenCalled(); expect(mocks.recover).toHaveBeenCalledOnce();
});
