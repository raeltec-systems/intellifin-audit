import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  runtime: vi.fn(),
  confirm: vi.fn(),
  reject: vi.fn(),
  revalidatePath: vi.fn(),
  telemetry: vi.fn(),
}));

vi.mock('../server-session', () => ({
  requireServerAction: mocks.authorize,
  currentCorrelationId: async () => 'trusted-correlation',
}));
vi.mock('../bootstrap', () => ({ getRuntime: mocks.runtime }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('@intellifin/application', () => ({
  EVALUATION_REVIEW_VALUES: ['COMPLIANT', 'EXCEPTION', 'UNEVALUATED'],
  EVALUATION_REVIEW_REFUSALS: { malformed: 'Choose a valid evaluation review.' },
  confirmEvaluation: mocks.confirm,
  rejectEvaluation: mocks.reject,
}));
vi.mock('@intellifin/infrastructure', () => ({
  CryptoUuidV7Generator: class { next(): string { return '019823ab-0000-7000-8000-000000000099'; } },
  DrizzleRoleRepository: class {},
  PostgresAuditUnitOfWork: class {},
  PostgresEvaluationReviewRepository: class {},
  SystemClock: class {},
}));

import { confirmEvaluationAction, rejectEvaluationAction } from './evaluation-review-actions';

const RUN_ID = '019823ab-0000-7000-8000-000000000001';
const OBSERVATION_ID = '019823ab-0000-7000-8000-000000000002';
const session = { userId: 'trusted-user', sessionId: 'trusted-session' };
const confirmRequest = {
  runId: RUN_ID,
  observationId: OBSERVATION_ID,
  conditionId: 'C2',
  expectedReviewRevision: 4,
};
const rejectRequest = {
  ...confirmRequest,
  replacementValue: 'UNEVALUATED',
  rationale: 'The retained evidence does not support the proposal.',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({ allowed: true, session, role: 'auditor' });
  mocks.runtime.mockResolvedValue({ db: {}, telemetry: { captureError: mocks.telemetry } });
  mocks.confirm.mockResolvedValue({ ok: true, action: 'confirm', decision: {}, result: {} });
  mocks.reject.mockResolvedValue({ ok: true, action: 'reject', decision: {}, result: {} });
});

describe('evaluation review Server Action boundary', () => {
  it('authorizes before inspecting hostile input', async () => {
    const reason = 'Sign in to continue.';
    mocks.authorize.mockResolvedValue({ allowed: false, reason });
    const hostile = new Proxy({}, {
      get: () => { throw new Error('input read'); },
      ownKeys: () => { throw new Error('input read'); },
    });

    expect(await confirmEvaluationAction(hostile)).toEqual({ ok: false, code: 'unauthorized', reason });
    expect(mocks.authorize).toHaveBeenCalledWith('evaluation.confirm');
    expect(mocks.runtime).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it.each([
    null,
    [],
    { ...confirmRequest, forged: true },
    { ...confirmRequest, runId: 'forged' },
    { ...confirmRequest, expectedReviewRevision: -1 },
    { ...confirmRequest, expectedReviewRevision: 1.5 },
    { ...confirmRequest, conditionId: 'bad condition' },
  ])('refuses malformed confirmation request %# before constructing dependencies', async request => {
    expect(await confirmEvaluationAction(request)).toMatchObject({ ok: false, code: 'malformed' });
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.runtime).not.toHaveBeenCalled();
  });

  it('passes the fresh review revision and authorized session to confirmation', async () => {
    const result = await confirmEvaluationAction(confirmRequest);
    expect(result).toMatchObject({ ok: true, action: 'confirm' });
    expect(mocks.confirm).toHaveBeenCalledWith(expect.any(Object), { session, request: confirmRequest });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/runs/${RUN_ID}`);
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/notifications');
  });

  it('requires fixed replacement vocabulary and non-empty rationale before rejection', async () => {
    expect(await rejectEvaluationAction({ ...rejectRequest, replacementValue: 'model supplied' })).toMatchObject({ ok: false });
    expect(await rejectEvaluationAction({ ...rejectRequest, rationale: '   ' })).toMatchObject({ ok: false });
    expect(await rejectEvaluationAction({ ...rejectRequest, rationale: 'x'.repeat(4001) })).toMatchObject({ ok: false });
    expect(mocks.reject).not.toHaveBeenCalled();
  });

  it('passes the selected fixed replacement and rationale to rejection', async () => {
    const result = await rejectEvaluationAction(rejectRequest);
    expect(result).toMatchObject({ ok: true, action: 'reject' });
    expect(mocks.authorize).toHaveBeenCalledWith('evaluation.reject');
    expect(mocks.reject).toHaveBeenCalledWith(expect.any(Object), { session, request: rejectRequest });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/runs/${RUN_ID}/evidence`);
  });

  it('returns application refusals without revalidating the page', async () => {
    mocks.confirm.mockResolvedValue({ ok: false, code: 'stale-revision', reason: 'This Result changed while you were deciding. Reload the Run.' });
    const result = await confirmEvaluationAction(confirmRequest);
    expect(result).toMatchObject({ ok: false, code: 'stale-revision' });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('marks a lost response unknown rather than claiming that no decision happened', async () => {
    const sqlWithRationale = "insert into run_evaluation_review (rationale) values ('do not log this')";
    mocks.confirm.mockRejectedValue(new Error(sqlWithRationale));
    const result = await confirmEvaluationAction(confirmRequest);
    expect(result).toMatchObject({ ok: false, code: 'unknown-outcome', unknownOutcome: true });
    expect(JSON.stringify(result)).not.toContain('Nothing was changed');
    expect(mocks.telemetry).toHaveBeenCalledWith('Captured failure', expect.objectContaining({
      message: 'Evaluation review failed',
    }), {
      correlationId: 'trusted-correlation',
      outcome: 'failure',
      errorCode: 'EVALUATION_REVIEW_FAILED',
    });
    const telemetryCall = mocks.telemetry.mock.calls[0];
    expect(telemetryCall).toBeDefined();
    if (!telemetryCall) throw new Error('telemetry call was not captured');
    const [message, capturedError, fields] = telemetryCall;
    expect(message).toBe('Captured failure');
    expect(capturedError).toBeInstanceOf(Error);
    expect((capturedError as Error).message).toBe('Evaluation review failed');
    expect(JSON.stringify([capturedError, fields])).not.toContain(sqlWithRationale);
  });
});
