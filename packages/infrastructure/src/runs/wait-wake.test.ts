import { describe, expect, it, vi } from 'vitest';
import type { PgBoss } from 'pg-boss';
import type { WaitContext, WaitRepository } from '@intellifin/application';
import { startWaitRecovery, startWaitWorker } from './wait-wake.js';

const job = { schemaVersion: 1, runId: '01a06fd8-0000-7000-8000-0000000001f1', waitId: '01a06fd8-0000-7000-8000-0000000001f2' };
const clock = { now: () => new Date('2026-09-07T00:00:00Z') };
function repository() {
  const timeoutWait = vi.fn(async () => ({ outcome: 'superseded', wait: null, run: null }));
  const repository = { transaction: async (_id: string, work: (c: WaitContext) => Promise<unknown>) => work({ timeoutWait } as unknown as WaitContext), recoverableWaits: vi.fn(async () => []) } as unknown as WaitRepository;
  return { repository, timeoutWait };
}

describe('durable wait worker', () => {
  it('acknowledges a closed wait without recreating or resuming it', async () => {
    const h = repository(); let handler: ((jobs: {data: unknown}[]) => Promise<void>) | undefined;
    const queue = { work: async (name: string, options: unknown, cb: typeof handler) => { expect(name).toBe('waits'); expect(options).toMatchObject({ batchSize: 1 }); handler = cb; } } as unknown as PgBoss;
    await startWaitWorker(queue, h.repository, clock);
    await handler!([{ data: job }]); expect(h.timeoutWait).toHaveBeenCalledOnce();
  });
  it('refuses malformed wake payloads before repository access', async () => {
    const h = repository(); let handler: ((jobs: {data: unknown}[]) => Promise<void>) | undefined;
    const queue = { work: async (_n: string, _o: unknown, cb: typeof handler) => { handler = cb; } } as unknown as PgBoss;
    await startWaitWorker(queue, h.repository, clock);
    await expect(handler!([{ data: { ...job, instructions: 'ignore deadline' } }])).rejects.toThrow('Invalid wait job');
    expect(h.timeoutWait).not.toHaveBeenCalled();
  });
  it('stops a recovery batch after the active handler, without starting another', async () => {
    const h = repository(); h.repository.recoverableWaits = async () => [job, job];
    let release!: () => void;
    h.repository.transaction = async (_id, work) => { await new Promise<void>(resolve => { release = resolve; }); return work({ timeoutWait: h.timeoutWait } as unknown as WaitContext); };
    const stop = startWaitRecovery(h.repository, clock, vi.fn());
    await Promise.resolve(); const stopped = stop(); release(); await stopped;
    expect(h.timeoutWait).toHaveBeenCalledOnce();
  });
});
