import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), runtime: vi.fn(), initiate: vi.fn(), redirect: vi.fn() }));
vi.mock('../../src/server-session', () => ({ requireServerAction: mocks.authorize, currentCorrelationId: async () => 'trusted-correlation' }));
vi.mock('../../src/bootstrap', () => ({ getRuntime: mocks.runtime }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@intellifin/application', async original => ({ ...await original<typeof import('@intellifin/application')>(), initiateRun: mocks.initiate }));
import { initiateRunAction, initiateRunFormAction } from './actions';

const fields = { requestToken: '018f0000-0000-7000-8000-000000000099', procedureId: '018f0000-0000-7000-8000-000000000001', period: { from: '2026-09-01', to: '2026-09-30' } };
const session = { userId: 'trusted-user', sessionId: 'trusted-session' };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({ allowed: true, session, role: 'auditor' });
  mocks.runtime.mockResolvedValue({ db: {}, telemetry: { captureError: vi.fn() } });
  mocks.initiate.mockResolvedValue({ ok: true, runId: 'saved-run' });
});

describe('Run action request boundary', () => {
  it.each(['Sign in to continue.', 'This role cannot initiate a Run.'])('authorizes before inspecting hostile input: %s', async reason => {
    mocks.authorize.mockResolvedValue({ allowed: false, reason });
    expect(await initiateRunAction(new Proxy({}, { get: () => { throw new Error('input read'); }, ownKeys: () => { throw new Error('input read'); } }))).toEqual({ ok: false, reason });
    expect(mocks.authorize).toHaveBeenCalledWith('run.initiate');
    expect(mocks.runtime).not.toHaveBeenCalled();
    expect(mocks.initiate).not.toHaveBeenCalled();
  });
  it.each(['versionId', 'session', 'initiatorId', 'correlationId', 'kind', 'authorizationRole'])('refuses a forged %s', async key => {
    expect(await initiateRunAction({ ...fields, [key]: 'forged' })).toMatchObject({ ok: false });
    expect(mocks.initiate).not.toHaveBeenCalled();
  });
  it.each([null, [], 'bad', {}, { ...fields, procedureId: 'bad' }, { ...fields, period: { from: '2026-02-30', to: '2026-03-01' } }, { ...fields, period: { from: '2026-10-01', to: '2026-09-01' } }, { ...fields, period: { ...fields.period, extra: 'bad' } }])('refuses malformed input %#', async input => {
    expect(await initiateRunAction(input)).toMatchObject({ ok: false });
    expect(mocks.initiate).not.toHaveBeenCalled();
  });
  it('passes the trusted session and exact validated request to the command', async () => {
    expect(await initiateRunAction(fields)).toEqual({ ok: true, runId: 'saved-run' });
    expect(mocks.initiate.mock.calls[0]?.[1]).toEqual({ session, request: fields });
  });
  it.each([undefined, null, '', 'forged', '018f0000-0000-0000-8000-000000000099'])('refuses invalid retry token %s', async requestToken => {
    expect(await initiateRunAction({ ...fields, requestToken })).toMatchObject({ ok: false });
    expect(mocks.initiate).not.toHaveBeenCalled();
  });
  it('preserves the request token on a retry after an unknown response', async () => {
    mocks.initiate.mockRejectedValueOnce(new Error('lost acknowledgement')).mockResolvedValueOnce({ ok: true, runId: 'original-terminal-run' });
    expect(await initiateRunAction(fields)).toMatchObject({ ok: false, unknownOutcome: true });
    expect(await initiateRunAction(fields)).toEqual({ ok: true, runId: 'original-terminal-run' });
    expect(mocks.initiate.mock.calls.map(call => call[1])).toEqual([{ session, request: fields }, { session, request: fields }]);
  });
  it('preserves a changed-request refusal from the command', async () => {
    mocks.initiate.mockResolvedValue({ ok: false, reason: 'This initiation request was already used for different input.' });
    expect(await initiateRunAction(fields)).toEqual({ ok: false, reason: 'This initiation request was already used for different input.' });
  });
  it('returns the authorized duplicate link from the command', async () => {
    mocks.initiate.mockResolvedValue({ ok: false, reason: 'An active Run exists.', existingRunId: 'existing-run' });
    expect(await initiateRunAction(fields)).toEqual({ ok: false, reason: 'An active Run exists.', existingRunId: 'existing-run' });
  });
  it('never claims rollback when the outcome could not be confirmed', async () => {
    const captureError = vi.fn(), error = new Error('response lost after commit');
    mocks.runtime.mockResolvedValue({ db: {}, telemetry: { captureError } });
    mocks.initiate.mockRejectedValue(error);
    const result = await initiateRunAction(fields);
    expect(result).toMatchObject({ ok: false, unknownOutcome: true });
    expect(JSON.stringify(result)).not.toContain('Nothing was changed');
    expect(captureError).toHaveBeenCalledWith('Initiate Run failed', error, { correlationId: 'trusted-correlation', outcome: 'failure' });
  });
  it('handles a failed runtime without a framework exception', async () => {
    mocks.runtime.mockRejectedValue(new Error('unavailable'));
    expect(await initiateRunAction(fields)).toMatchObject({ ok: false, unknownOutcome: true });
  });
  it('redirects the native form only after a stored Run is returned', async () => {
    const data = new FormData(); data.set('requestToken', fields.requestToken); data.set('procedureId', fields.procedureId); data.set('from', fields.period.from); data.set('to', fields.period.to);
    await initiateRunFormAction(null, data);
    expect(mocks.redirect).toHaveBeenCalledWith('/runs/saved-run');
    expect(mocks.initiate.mock.calls[0]?.[1]).toEqual({ session, request: fields });
  });
  it('refuses duplicate and forged form fields', async () => {
    const data = new FormData(); data.set('requestToken', fields.requestToken); data.set('procedureId', fields.procedureId); data.append('procedureId', fields.procedureId); data.set('from', fields.period.from); data.set('to', fields.period.to); data.set('versionId', 'forged');
    expect(await initiateRunFormAction(null, data)).toMatchObject({ ok: false });
    expect(mocks.initiate).not.toHaveBeenCalled(); expect(mocks.redirect).not.toHaveBeenCalled();
  });
  it('returns an uncertain response when native form authorization is unavailable', async () => {
    mocks.authorize.mockRejectedValue(new Error('database unavailable'));
    expect(await initiateRunFormAction(null, new FormData())).toMatchObject({ ok: false, unknownOutcome: true });
    expect(mocks.initiate).not.toHaveBeenCalled(); expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
