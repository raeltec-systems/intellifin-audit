import type { PgBoss } from 'pg-boss';
import type { PopulationJob } from '@intellifin/application';
import type { Database } from '../db/client.js';
import { DrizzleRunRepository } from './run-repository.js';
import { RUNS_QUEUE } from './runs-unit-of-work.js';
export async function startPopulationWorker(queue:PgBoss,handler:(job:PopulationJob)=>Promise<{retry:boolean}>):Promise<void> {
  await queue.work<PopulationJob>(RUNS_QUEUE,{batchSize:1,pollingIntervalSeconds:1},async jobs=>{
    for(const job of jobs) {
      try {
        const d:unknown=job.data;
        if(!d || typeof d!=='object' || !('schemaVersion' in d) || d.schemaVersion!==1 || !('runId' in d) || typeof d.runId!=='string' || !/^[0-9a-f-]{36}$/.test(d.runId) || !('correlationId' in d) || typeof d.correlationId!=='string') throw new Error('Invalid job');
        if((await handler(job.data)).retry) throw new Error('Retry pending');
      } catch { throw new Error('Population worker failed'); }
    }
  });
}
/** Any stage's own read of the Runs it may resume. Population and adapter extraction
 * each supply their own: a stage that borrowed another's would sweep the wrong set. */
export interface RecoverableRuns { recoverableRunIds(limit:number):Promise<string[]> }
export function startPopulationRecovery(db:Database,repository:RecoverableRuns,handler:(job:PopulationJob)=>Promise<unknown>,onError:()=>void):()=>Promise<void> {
  let pending:Promise<void>|undefined;
  let stopping = false;
  const tick=()=>{
    if(pending || stopping) return;
    pending=(async()=>{
      for(const id of await repository.recoverableRunIds(100)) {
        if (stopping) break;
        try {
          const run=await new DrizzleRunRepository(db).findRun(id);
          if (stopping) break;
          if(run) await handler({schemaVersion:1,runId:id,correlationId:run.correlationId});
        } catch { onError(); }
      }
    })().catch(onError).finally(()=>{pending=undefined;});
  };
  const timer=setInterval(tick,5000); tick();
  // The active handler is bounded by the frozen Step/Run deadlines. Do not start
  // any more of the selected batch while shutdown waits for that one handler.
  return async()=>{stopping=true;clearInterval(timer);await pending;};
}
