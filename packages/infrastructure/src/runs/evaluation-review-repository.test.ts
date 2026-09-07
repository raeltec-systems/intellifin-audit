import { describe, expect, it, vi } from 'vitest';

import { PostgresEvaluationReviewRepository } from './evaluation-review-repository.js';

const RUN_ID = '01a06fd8-0000-7000-8000-0000000000a1';
const OBSERVATION_ID = '01a06fd8-0000-7000-8000-0000000000a2';
const COMMAND_ID = '01a06fd8-0000-7000-8000-0000000000a3';

describe('evaluation review command read model', () => {
  it('returns one safe latest status per target and closes unknown refusal codes', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [
      {
        command_id: COMMAND_ID,
        observation_id: OBSERVATION_ID,
        condition_id: 'C2',
        expected_review_revision: 4,
        action: 'reject',
        status: 'REFUSED',
        refusal_code: 'future-secret-code',
        requested_at: '2026-09-07T09:00:02.000Z',
        processed_at: '2026-09-07T09:00:03.000Z',
        rationale: 'secret rationale must never be returned',
      },
      {
        command_id: '01a06fd8-0000-7000-8000-0000000000a4',
        observation_id: OBSERVATION_ID,
        condition_id: 'C2',
        expected_review_revision: 4,
        action: 'confirm',
        status: 'SUCCEEDED',
        refusal_code: null,
        requested_at: '2026-09-07T09:00:01.000Z',
        processed_at: '2026-09-07T09:00:02.000Z',
      },
      { command_id: 'not-a-command', status: 'PENDING' },
    ] });
    const repository = new PostgresEvaluationReviewRepository({ execute } as never);

    const statuses = await repository.readCommandStatuses(RUN_ID, 4, [OBSERVATION_ID]);

    expect(statuses).toEqual([{
      commandId: COMMAND_ID,
      observationId: OBSERVATION_ID,
      conditionId: 'C2',
      action: 'reject',
      expectedReviewRevision: 4,
      status: 'REFUSED',
      refusalCode: 'unknown',
      requestedAt: '2026-09-07T09:00:02.000Z',
      processedAt: '2026-09-07T09:00:03.000Z',
    }]);
    expect(JSON.stringify(statuses)).not.toContain('secret');
  });

  it('does not query for an invalid Run or revision', async () => {
    const execute = vi.fn();
    const repository = new PostgresEvaluationReviewRepository({ execute } as never);

    await expect(repository.readCommandStatuses('invalid', 0, [OBSERVATION_ID])).resolves.toEqual([]);
    await expect(repository.readCommandStatuses(RUN_ID, -1, [OBSERVATION_ID])).resolves.toEqual([]);
    await expect(repository.readCommandStatuses(RUN_ID, 0, [])).resolves.toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });
});
