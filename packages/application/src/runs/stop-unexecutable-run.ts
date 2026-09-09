import type { RunRecord } from '@intellifin/domain';
import type { Clock } from '../audit/clock.js';
import type { PopulationExecutionRepository } from './execution-ports.js';
import type { PopulationJob } from './acquire-population.js';
import { completeRun } from './complete-run.js';
import { performCancellation } from './cancel-run.js';

/**
 * `StopUnexecutableRun`: end a Run this deployment cannot execute, terminally and with a
 * diagnostic that names why (PR 23 review, P1-6 and P1-7).
 *
 * **A capability disabled by name must also stop the work that depends on it.** The PR 23
 * repair was right to let the worker start without `EVIDENCE_S3_*` — refusing to boot would
 * have taken plan derivation, notification delivery and the liveness row down with it — but
 * disabling the stage left NO consumer registered for the `runs` queue while the web's
 * Initiate Run action stayed enabled and went on enqueueing. Every Run then sat `QUEUED`
 * for ever: no worker, no diagnostic, no Result, no Evidence, and nothing on the Run page
 * saying anything was wrong. The same shape one stage along is worse: with storage
 * configured but no credential manifest, acquisition succeeded, the job was ACKNOWLEDGED,
 * and the Run stayed `RUNNING` at `POPULATION_READY` with its population Evidence already
 * frozen — the population sweep no longer selects it and the adapter sweep is only
 * installed when extraction is on, so nothing on either side would ever move it again.
 *
 * So the consumer is ALWAYS registered and this is what it does instead. §E maps a Run-level
 * Session Step that cannot be performed to `RUN_FAILED`, which is what this writes: through
 * `completeRun`, so the Result and the Evidence package seal commit with it and generation
 * 21's and 25's deferred triggers are satisfied rather than dodged. An operator reads the
 * diagnostic, provisions what is missing, and the auditor reruns. A Run that failed for a
 * stated reason can be acted on; a Run that never moved cannot.
 *
 * **Nothing is fabricated.** No checkpoint is written and no Evidence is reserved: for the
 * queued case nothing was ever attempted, and a reservation invented here would make the
 * seal list an abandonment for an artifact nobody asked for. For the `POPULATION_READY` case
 * the checkpoint stays exactly as acquisition left it, because the population really was
 * ready — what failed is the stage after it.
 *
 * **A cancellation still wins here**, because unlike the two boundary cases in `completeRun`
 * this Run has earned no outcome at all: nothing ran, nothing concluded, and the person who
 * asked for it to stop is the only fact about why it ended.
 */

/** Why this deployment cannot execute a Run. A closed vocabulary, never free text. */
export const UNEXECUTABLE_RUN_REASONS = {
  /** No object storage for Evidence, so no Run can be executed at all. */
  'evidence-store-unconfigured':
    'This deployment cannot execute Runs: object storage for Evidence is not configured.',
  /** Storage is there; adapter extraction is not, so the Run cannot get past its population. */
  'adapter-extraction-unconfigured':
    'This deployment cannot execute adapter extraction: no audit credential or Exception fingerprint key is configured.',
} as const;

export type UnexecutableRunReason = keyof typeof UNEXECUTABLE_RUN_REASONS;

/** The audit event that records a Run this build could not run, and why. */
const UNEXECUTABLE_EVENT = 'lifecycle.run-unexecutable';

export interface UnexecutableRunDependencies {
  readonly repository: PopulationExecutionRepository;
  readonly clock: Clock;
}

/**
 * Stop one Run, or do nothing if it is already past stopping.
 *
 * Idempotent: a redelivery finds a terminal Run and writes nothing, and `completeRun`'s own
 * first-Result-wins rule is the second lock on that. The queue job is always acknowledged —
 * retrying against a deployment whose configuration has not changed proves nothing, and the
 * decision is taken once at boot, so a retry could not observe a different answer.
 */
export async function stopUnexecutableRun(
  dependencies: UnexecutableRunDependencies,
  job: PopulationJob,
  reason: UnexecutableRunReason,
): Promise<{ retry: boolean }> {
  await dependencies.repository.transaction(job.runId, async (context) => {
    const run = context.run;
    if (run === null || run.correlationId !== job.correlationId || job.schemaVersion !== 1) return;
    // The same guard `acquirePopulation` takes at its claim: a Run that has already stopped
    // is not stopped again, and a terminal Run already has a Result nothing may replace.
    if (!(['QUEUED', 'RUNNING'] as RunRecord['state'][]).includes(run.state)) return;
    const at = dependencies.clock.now().toISOString();
    const plan = await context.frozenPlan();

    // Somebody asked for this Run to stop and it was never going to run: their request is
    // the whole truth about why it ended, so it is honoured rather than superseded.
    if (run.cancellation !== null) {
      await performCancellation(context, { run, request: run.cancellation, at, plan, source: 'worker' });
      return;
    }

    await context.saveRunState('RUN_FAILED');
    const stored = await context.auditEvents.append({
      actor: { type: 'system', id: 'population-worker' },
      eventType: UNEXECUTABLE_EVENT,
      source: 'worker',
      outcome: 'failure',
      aggregateId: run.runId,
      correlationId: run.correlationId,
      sessionId: run.sessionId,
      payload: {
        priorState: run.state,
        state: 'RUN_FAILED',
        // The closed reason and its sentence. A deployment's configuration is not named
        // beyond the capability that is absent: an environment variable's VALUE never
        // enters the chain, and the chain is immutable.
        diagnostic: reason,
        reason: UNEXECUTABLE_RUN_REASONS[reason],
        occurredAt: at,
      },
    });
    await context.notifyTimeline(stored.sequence);
    await completeRun(context, { run, state: 'RUN_FAILED', at, plan });
  });
  return { retry: false };
}
