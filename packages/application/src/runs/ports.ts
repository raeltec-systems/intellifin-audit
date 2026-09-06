import type { ExecutablePlan, ExplicitPeriod, RunCancellationRequest, RunRecord } from '@intellifin/domain';
import type { AuditUnitOfWorkContext } from '../audit/ports.js';
import type { RoleRepository } from '../identity/ports.js';
import type { ProcedurePeriodOwnerReader } from '../procedures/ports.js';
import type { RunResultContext } from './execution-ports.js';
export interface RunWriter {
  bindRequest(initiatorId: string, requestToken: string, runId: string): Promise<void>;
  findRequest(initiatorId: string, requestToken: string): Promise<RunRecord | null>;
  insert(run: RunRecord): Promise<boolean>;
  findActive(procedureId: string, period: ExplicitPeriod): Promise<RunRecord | null>;
  /** The predecessor a rerun links to, read inside the transaction that writes. */
  findRun(runId: string): Promise<RunRecord | null>;
}
export interface RunReader { findRun(runId: string): Promise<RunRecord | null> }
export interface RunDispatch { enqueue(job: { schemaVersion: 1; runId: string; correlationId: string }): Promise<void> }
export interface RunsUnitOfWorkContext extends AuditUnitOfWorkContext {
  readonly authorizationRoles: RoleRepository; readonly procedures: ProcedurePeriodOwnerReader;
  readonly runs: RunWriter; readonly dispatch: RunDispatch;
  notifyTimeline(runId: string, sequence: number): Promise<void>;
}

/**
 * The transaction ONE Run's cancellation is decided and committed inside (Story 3.10).
 *
 * It extends `RunResultContext` because a cancellation IS a terminal transition: the Run
 * state, the Evidence package seal, the Result and the Timeline event commit together or
 * not at all, and generation 25's deferred trigger refuses a Run reaching a terminal state
 * with no Result. A context that could not complete the Run would be a branch that reaches
 * `CANCELED` and fails to commit.
 *
 * It is keyed by Run id and takes that Run's row lock, exactly as the two worker stages'
 * repositories do — which is what makes cancel-meets-claim a race one side loses and sees
 * the committed result of, rather than two reads through the pool that both win.
 *
 * It is deliberately NOT the initiation unit of work: `RunsUnitOfWorkContext` notifies by
 * `(runId, sequence)` because it mints the Run id inside the transaction, while everything
 * that completes a Run already knows which Run it is.
 */
export interface RunCancellationContext extends RunResultContext {
  /** The Run, read under its own row lock inside this transaction. */
  readonly run: RunRecord | null;
  /** Re-read after the lock, never from a cached role (AD-7). */
  readonly authorizationRoles: RoleRepository;
  /** The plan the version froze, or `null` when this build cannot read it. */
  frozenPlan(): Promise<ExecutablePlan | null>;
  /** Record the durable marker. Written on both paths, so a Canceled Run names its actor. */
  requestCancellation(request: RunCancellationRequest): Promise<void>;
  /**
   * Remove this Run's dispatch job, in THIS transaction.
   *
   * A queued Run has no process holding it, so the command finishes the job itself: the
   * `CANCELED` state and the removal commit together and no worker can pick it up
   * afterwards. Leaving the job behind would mean the Run is cancelled and something is
   * still scheduled to execute it.
   */
  removeDispatch(): Promise<void>;
}

export interface RunCancellationRepository {
  transaction<T>(runId: string, work: (context: RunCancellationContext) => Promise<T>): Promise<T>;
}
