import type { EscalationDetails, RunWait, WaitRepository } from '@intellifin/application';
import { PostgresWaitRepository } from '@intellifin/infrastructure';

import { getRuntime } from '../bootstrap';
import { requireServerAction } from '../server-session';

/**
 * The request-time data the Escalation panel is allowed to receive.
 *
 * `RunWait` is read from the same transaction as the locked Run revision. The revision
 * is the compare-and-set value sent back by the answer command; using a value from the
 * Run row mapper would make an answer race a newer wait closure. This read only touches
 * wait metadata and the Run execution context. The detail DTO contains only the raise
 * event's Step/Evidence references and a matching agent rationale; it never resolves an
 * Evidence object, stored bytes or an object-storage URL.
 */
export interface OpenEscalationRead {
  readonly wait: RunWait | null;
  readonly runRevision: number | null;
  readonly details: EscalationDetails | null;
}

/** Read one open wait and its current Run revision through the application port. */
export async function readOpenEscalation(runId: string): Promise<OpenEscalationRead> {
  // This read is also a request-level Run read. Run Detail currently calls `openRun` before
  // reaching this function, but keeping the gate here prevents a future caller from using
  // the Escalation metadata seam as an unguarded lookup. The existing `run.initiate` action
  // is the product's Run access gate; role vocabulary stays unchanged.
  const decision = await requireServerAction('run.initiate');
  if (!decision.allowed) return { wait: null, runRevision: null, details: null };
  const runtime = await getRuntime();
  return readOpenEscalationWith(new PostgresWaitRepository(runtime.db), runId);
}

/**
 * Dependency-injected form used by focused route tests. The web composition still uses
 * `PostgresWaitRepository` above; the port keeps that choice out of the rendering logic.
 */
export async function readOpenEscalationWith(
  repository: Pick<WaitRepository, 'transaction'>,
  runId: string,
): Promise<OpenEscalationRead> {
  return repository.transaction(runId, async (context) => {
    const wait = context.wait;
    return {
      wait,
      runRevision: context.run?.revision ?? null,
      details: wait === null ? null : await context.readEscalationDetails(wait.waitId),
    };
  });
}
