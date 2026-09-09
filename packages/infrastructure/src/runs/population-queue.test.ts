import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PopulationExecutionRepository } from '@intellifin/application';
import type { RunRecord } from '@intellifin/domain';
import type { Database } from '../db/client.js';
import { DrizzleRunRepository } from './run-repository.js';
import { startPopulationRecovery } from './population-queue.js';

afterEach(() => vi.restoreAllMocks());

describe('population recovery isolation and shutdown', () => {
  it('continues the selected batch after a Run fails', async () => {
    const repository = { recoverableRunIds: vi.fn(async () => ['first', 'second', 'third']) } as unknown as PopulationExecutionRepository;
    vi.spyOn(DrizzleRunRepository.prototype, 'findRun').mockImplementation(async () => ({ correlationId: 'correlation' }) as RunRecord);
    let complete!: () => void;
    const completed = new Promise<void>(resolve => { complete = resolve; });
    const handler = vi.fn(async ({ runId }: { runId: string }) => { if (runId === 'first') throw new Error('Failure'); if (runId === 'third') complete(); });
    const onError = vi.fn();
    const stop = startPopulationRecovery({} as Database, repository, handler, onError);
    try {
      await completed;
      expect(handler.mock.calls.map(([job]) => job.runId)).toEqual(['first', 'second', 'third']);
      expect(onError).toHaveBeenCalledTimes(1);
    } finally { await stop(); }
  });

  it('waits for the active handler and starts no remaining batch item during shutdown', async () => {
    const repository = { recoverableRunIds: vi.fn(async () => ['first', 'second']) } as unknown as PopulationExecutionRepository;
    vi.spyOn(DrizzleRunRepository.prototype, 'findRun').mockImplementation(async () => ({ correlationId: 'correlation' }) as RunRecord);
    let release!: () => void, started!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const active = new Promise<void>(resolve => { started = resolve; });
    const handler = vi.fn(async () => { started(); await held; });
    const stop = startPopulationRecovery({} as Database, repository, handler, vi.fn());
    await active;
    let stopped = false;
    const stopping = stop().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    release();
    await stopping;
    expect(handler).toHaveBeenCalledTimes(1);
    expect(stopped).toBe(true);
  });
});
