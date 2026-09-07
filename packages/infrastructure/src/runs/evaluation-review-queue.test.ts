import { describe, expect, it, vi } from 'vitest';
import type { PgBoss } from 'pg-boss';

import { EVALUATION_REVIEW_QUEUE } from './runs-unit-of-work.js';
import { startEvaluationReviewWorker } from './evaluation-review-queue.js';

const JOB = {
  schemaVersion: 1,
  kind: 'evaluation-review',
  commandId: '01a06fd8-0000-7000-8000-0000000000a3',
  runId: '01a06fd8-0000-7000-8000-0000000000a1',
  correlationId: '01a06fd8-0000-7000-8000-0000000000a4',
};

type DeliveredJob = { readonly data: unknown };
type WorkHandler = (jobs: readonly DeliveredJob[]) => Promise<void>;

function fakeQueue() {
  let queueName: string | null = null;
  let handler: WorkHandler | null = null;
  const queue = {
    work: async (name: string, _options: object, callback: WorkHandler): Promise<void> => {
      queueName = name;
      handler = callback;
    },
  } as unknown as PgBoss;
  return {
    queue,
    get queueName() { return queueName; },
    deliver: async (jobs: readonly DeliveredJob[]) => {
      if (!handler) throw new Error('worker was not registered');
      return handler(jobs);
    },
  };
}

describe('evaluation review queue worker', () => {
  it('uses a dedicated queue so population deliveries cannot be acknowledged here', async () => {
    const queue = fakeQueue();
    const handle = vi.fn(async () => undefined);
    await startEvaluationReviewWorker(queue.queue, handle);

    expect(queue.queueName).toBe(EVALUATION_REVIEW_QUEUE);
    await queue.deliver([{ data: JOB }]);
    expect(handle).toHaveBeenCalledWith(JOB);
  });

  it('fails closed on a non-review payload instead of silently dropping it', async () => {
    const queue = fakeQueue();
    const handle = vi.fn(async () => undefined);
    await startEvaluationReviewWorker(queue.queue, handle);

    await expect(queue.deliver([{
      data: { schemaVersion: 1, runId: JOB.runId, correlationId: JOB.correlationId },
    }])).rejects.toThrow('Invalid evaluation review job contract');
    expect(handle).not.toHaveBeenCalled();
  });

  it('does not expose handler or queue error details through a failed delivery', async () => {
    const queue = fakeQueue();
    const secret = 'review rationale must never reach pg-boss output';
    await startEvaluationReviewWorker(queue.queue, async () => { throw new Error(secret); });

    await expect(queue.deliver([{ data: JOB }])).rejects.toThrow('Evaluation review worker failed');
    await expect(queue.deliver([{ data: JOB }])).rejects.not.toThrow(secret);
  });
});
