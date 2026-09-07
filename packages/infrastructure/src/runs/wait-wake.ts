import type { PgBoss } from 'pg-boss';
import { parseWaitJob, wakeEscalation, type Clock, type WaitRepository } from '@intellifin/application';
import { WAIT_QUEUE } from './wait-repository.js';

/** Typed durable delivery; a closed wait is acknowledged without changing anything. */
export async function startWaitWorker(queue: PgBoss, repository: WaitRepository, clock: Clock): Promise<void> {
  await queue.work<unknown>(WAIT_QUEUE, { batchSize: 1, pollingIntervalSeconds: 1 }, async jobs => {
    for (const queued of jobs) {
      const job = parseWaitJob(queued.data);
      if (job === null) throw new Error('Invalid wait job');
      const result = await wakeEscalation({ repository, clock }, job);
      if (result.ok && result.status === 'early') throw new Error('Wait deadline is still pending');
    }
  });
}

/** Recovers overdue open waits even if a queue delivery exhausted its retry budget. */
export function startWaitRecovery(repository: WaitRepository, clock: Clock, onError: () => void): () => Promise<void> {
  let stopping = false;
  let pending: Promise<void> | undefined;
  const tick = () => {
    if (stopping || pending) return;
    pending = (async () => {
      for (const wait of await repository.recoverableWaits(100)) {
        if (stopping) break;
        try { await wakeEscalation({ repository, clock }, { schemaVersion: 1, ...wait }); }
        catch { onError(); }
      }
    })().catch(onError).finally(() => { pending = undefined; });
  };
  const timer = setInterval(tick, 5000);
  tick();
  return async () => { stopping = true; clearInterval(timer); await pending; };
}
