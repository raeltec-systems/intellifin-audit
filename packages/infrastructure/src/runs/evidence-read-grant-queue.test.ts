import { describe, expect, it, vi } from 'vitest';
import type { PgBoss } from 'pg-boss';

import type {
  Clock,
  EvidenceReadGrantRepository,
  EvidenceReadGrantSigner,
} from '@intellifin/application';
import { EVIDENCE_READ_GRANT_QUEUE } from '@intellifin/application';

import { startEvidenceReadGrantWorker } from './evidence-read-grant-queue.js';

const JOB = {
  schemaVersion: 1,
  grantId: '01990000-0000-7000-8000-00000000e403',
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
      if (handler === null) throw new Error('worker was not registered');
      return handler(jobs);
    },
  };
}

function dependencies(handler = vi.fn(async () => ({ status: 'missing' as const }))) {
  return {
    repository: { transaction: handler } as unknown as EvidenceReadGrantRepository,
    signer: {} as EvidenceReadGrantSigner,
    clock: { now: () => new Date('2026-09-07T00:00:00.000Z') } as Clock,
  };
}

describe('Evidence read grant queue worker', () => {
  it('uses a dedicated queue and passes only the validated grant envelope', async () => {
    const queue = fakeQueue();
    const repository = dependencies();
    await startEvidenceReadGrantWorker(queue.queue, repository.repository, repository.signer, repository.clock);

    expect(queue.queueName).toBe(EVIDENCE_READ_GRANT_QUEUE);
    await queue.deliver([{ data: JOB }]);
    expect(repository.repository.transaction).toHaveBeenCalledWith(JOB.grantId, expect.any(Function));
  });

  it('fails closed on a forged or extended payload', async () => {
    const queue = fakeQueue();
    const repository = dependencies();
    await startEvidenceReadGrantWorker(queue.queue, repository.repository, repository.signer, repository.clock);

    await expect(queue.deliver([{ data: { ...JOB, extra: 'forged' } }])).rejects.toThrow('Invalid Evidence read grant job contract');
    expect(repository.repository.transaction).not.toHaveBeenCalled();
  });

  it('does not expose application/provider errors through failed delivery output', async () => {
    const queue = fakeQueue();
    const secret = 'signed URL, object key and SQL details must never reach pg-boss output';
    const handler = vi.fn(async () => { throw new Error(secret); });
    const repository = dependencies(handler);
    await startEvidenceReadGrantWorker(queue.queue, repository.repository, repository.signer, repository.clock);

    await expect(queue.deliver([{ data: JOB }])).rejects.toThrow('Evidence read grant worker failed');
    await expect(queue.deliver([{ data: JOB }])).rejects.not.toThrow(secret);
  });
});
