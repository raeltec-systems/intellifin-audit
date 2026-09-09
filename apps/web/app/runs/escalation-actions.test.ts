import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  runtime: vi.fn(),
  answer: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('../../src/server-session', () => ({
  requireServerAction: mocks.authorize,
  currentCorrelationId: async () => 'trusted-correlation',
}));
vi.mock('../../src/bootstrap', () => ({ getRuntime: mocks.runtime }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@intellifin/application', async (importOriginal) => ({
  ...await importOriginal<typeof import('@intellifin/application')>(),
  answerEscalation: mocks.answer,
}));

import { answerEscalationAction } from './actions';

const RUN_ID = '019823ab-0000-7000-8000-000000000001';
const WAIT_ID = '019823ab-0000-7000-8000-000000000002';
const REQUEST = {
  runId: RUN_ID,
  waitId: WAIT_ID,
  expectedRunRevision: 7,
  answerOptionId: 'retry',
  note: null,
};
const session = { userId: 'trusted-user', sessionId: 'trusted-session' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({ allowed: true, session, role: 'auditor' });
  mocks.runtime.mockResolvedValue({ db: {}, telemetry: { captureError: vi.fn() } });
  mocks.answer.mockResolvedValue({ ok: true, state: 'RUNNING', answerOptionId: 'retry', wait: {} });
});

describe('Escalation answer Server Action boundary', () => {
  it('authorizes before inspecting hostile input', async () => {
    const reason = 'Sign in to continue.';
    mocks.authorize.mockResolvedValue({ allowed: false, reason });
    const hostile = new Proxy({}, {
      get: () => { throw new Error('input read'); },
      ownKeys: () => { throw new Error('input read'); },
    });

    expect(await answerEscalationAction(hostile)).toEqual({ ok: false, reason });
    expect(mocks.authorize).toHaveBeenCalledWith('escalation.answer');
    expect(mocks.runtime).not.toHaveBeenCalled();
    expect(mocks.answer).not.toHaveBeenCalled();
  });

  it.each([
    null,
    [],
    { ...REQUEST, extra: 'forged' },
    { ...REQUEST, runId: 'forged' },
    { ...REQUEST, waitId: 'forged' },
    { ...REQUEST, expectedRunRevision: -1 },
    { ...REQUEST, expectedRunRevision: 1.5 },
    { ...REQUEST, answerOptionId: 'bad option' },
    { ...REQUEST, note: '' },
    { ...REQUEST, note: 'x'.repeat(501) },
  ])('refuses malformed request %# before constructing dependencies', async request => {
    expect(await answerEscalationAction(request)).toMatchObject({ ok: false, code: 'malformed' });
    expect(mocks.answer).not.toHaveBeenCalled();
  });

  it('passes the authorized session and exact request to the closing command', async () => {
    expect(await answerEscalationAction(REQUEST)).toMatchObject({ ok: true, state: 'RUNNING' });
    expect(mocks.answer.mock.calls[0]?.[1]).toEqual({ session, request: REQUEST });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/runs/${RUN_ID}`);
    for (const suffix of ['/evidence', '/exceptions', '/review', '/timeline']) {
      expect(mocks.revalidatePath).toHaveBeenCalledWith(`/runs/${RUN_ID}${suffix}`);
    }
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/notifications');
  });

  it('returns a deadline refusal without invalidating a stale panel', async () => {
    mocks.answer.mockResolvedValue({
      ok: false,
      code: 'timed-out',
      reason: 'This Escalation timed out at 2026-09-06T13:00:00.000Z; the Run is Inconclusive.',
      timedOutAt: '2026-09-06T13:00:00.000Z',
    });
    const result = await answerEscalationAction(REQUEST);
    expect(result).toMatchObject({ ok: false, code: 'timed-out' });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('marks an uncertain response without claiming that the wait stayed open', async () => {
    const error = new Error('response lost after commit');
    const captureError = vi.fn();
    mocks.runtime.mockResolvedValue({ db: {}, telemetry: { captureError } });
    mocks.answer.mockRejectedValue(error);

    const result = await answerEscalationAction(REQUEST);
    expect(result).toMatchObject({ ok: false, unknownOutcome: true });
    expect(JSON.stringify(result)).not.toContain('Nothing was changed');
    expect(captureError).toHaveBeenCalledWith('Captured failure', error, {
      correlationId: 'trusted-correlation',
      outcome: 'failure',
    });
  });
});
