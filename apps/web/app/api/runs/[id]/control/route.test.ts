import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), runtime: vi.fn(), read: vi.fn() }));
vi.mock('../../../../../src/bootstrap', () => ({ getRuntime: mocks.runtime }));
vi.mock('../../../../../src/require-role', async original => ({
  ...await original<typeof import('../../../../../src/require-role')>(), requireAction: mocks.authorize,
}));
vi.mock('@intellifin/infrastructure', () => ({ readRunControlLease: mocks.read }));
import { GET } from './route';

const runId = '019823ab-0000-7000-8000-000000000001';
const session = { userId: 'trusted-auditor', sessionId: 'trusted-session' };
const projection = { status: 'ready', runId, required: true, epoch: 7, heldByYou: true,
  holderName: 'Auditor', expiresAt: '2026-09-20T19:02:00.000Z', serverTime: '2026-09-20T19:00:00.000Z', active: true };
const request = new Request(`https://audit.example.test/api/runs/${runId}/control`);
async function call(id = runId) {
  const response = await GET(request, { params: Promise.resolve({ id }) });
  expect(response.headers.get('cache-control')).toBe('no-store');
  return response;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({ allowed: true, session, role: 'auditor' });
  mocks.runtime.mockResolvedValue({ db: {}, conversationEnabled: true });
  mocks.read.mockResolvedValue(projection);
});

describe('GET /api/runs/<id>/control', () => {
  it.each([401, 403] as const)('refuses %s before inspecting Run identity or reading a projection', async status => {
    mocks.authorize.mockResolvedValue({ allowed: false, status, reason: 'Access denied.' });
    const params = { then: () => { throw new Error('Run identity inspected before authorization'); } } as unknown as Promise<{ id: string }>;
    const response = await GET(request, { params });
    expect(response.status).toBe(status);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.runtime).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
    if (status === 401) expect(await response.text()).toBe('');
    else expect(await response.json()).toEqual({ reason: 'Access denied.' });
  });
  it('returns only the authorized projection under fresh actor and server enrollment policy', async () => {
    const response = await call(runId.toUpperCase());
    expect(response.status).toBe(200); expect(await response.json()).toEqual(projection);
    expect(mocks.authorize).toHaveBeenCalledWith(request, 'run.resume');
    expect(mocks.read).toHaveBeenCalledWith({}, { runId, actorId: session.userId, requiredForUnenrolledRun: true });
    mocks.runtime.mockResolvedValue({ db: {}, conversationEnabled: false });
    await call();
    expect(mocks.authorize).toHaveBeenCalledTimes(2);
    expect(mocks.read).toHaveBeenLastCalledWith({}, { runId, actorId: session.userId, requiredForUnenrolledRun: false });
  });
  it('refuses a malformed Run without a database read', async () => {
    const response = await call('not-a-run');
    expect(response.status).toBe(400); expect(await response.json()).toEqual({ status: 'missing' });
    expect(mocks.runtime).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
  });
  it('returns missing after authorized lookup', async () => {
    mocks.read.mockResolvedValue({ status: 'missing' });
    const response = await call();
    expect(response.status).toBe(404); expect(await response.json()).toEqual({ status: 'missing' });
  });
  it('refuses a role revoked at the repository read', async () => {
    mocks.read.mockResolvedValue({ status: 'denied' });
    const response = await call();
    expect(response.status).toBe(403); expect(await response.json()).toEqual({ status: 'denied' });
  });
  it.each(['authorize', 'runtime', 'read'] as const)('returns unavailable without internal errors when %s fails', async source => {
    mocks[source].mockRejectedValue(new Error('private database address'));
    const response = await call();
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ status: 'unavailable' });
  });
});
