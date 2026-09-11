import type { ExecutablePlan, ExplicitPeriod, RunCancellationRequest, RunFlag, RunRecord, RunRequestRefusalCode } from '@intellifin/domain';
import type { AuditEventWriter, AuditUnitOfWorkContext } from '../audit/ports.js';
import type { FlagNotification } from '../notifications/ports.js';
import type { RoleRepository } from '../identity/ports.js';
import type { ProcedurePeriodOwnerReader } from '../procedures/ports.js';
import type { RunResultContext } from './execution-ports.js';

/**
 * What one initiation request token was decided to mean, durably.
 *
 * The SUBJECT — the Procedure and the inclusive period the request named — is stored on the
 * record itself rather than read off a bound Run, because a refused request has no Run to
 * read it from. It is what `RUN_TOKEN_REUSED` compares against, so the same token used for
 * a different Procedure or period is refused whether the first use created a Run or not.
 *
 * Exactly one of `runId` and `refusal` is set. `refusedRunId` names the active Run that
 * blocked the request, when there was one, so a replay reproduces the same answer down to
 * the link the surface offers — the "stable" half of the owner's decision.
 */
export interface RunRequestDecision {
  readonly procedureId: string;
  readonly period: ExplicitPeriod;
  /** The Run THIS caller's request created, or `null` when the request was refused. */
  readonly runId: string | null;
  readonly refusal: RunRequestRefusalCode | null;
  /** The Run named in the refusal, when one was. Never a Run this caller initiated. */
  readonly refusedRunId: string | null;
}

export interface RunWriter {
  /**
   * Record a token's decision. The FIRST decision wins and a second call changes nothing:
   * a token means one thing forever, which is the whole of the replay contract.
   */
  bindRequest(initiatorId: string, requestToken: string, decision: RunRequestDecision): Promise<void>;
  findRequest(initiatorId: string, requestToken: string): Promise<RunRequestDecision | null>;
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

/**
 * What `FlagRun` may reach (Story 5.5).
 *
 * Deliberately NARROWER than {@link RunCancellationContext}: it does not extend
 * `RunResultContext`, so there is no Run state writer, no seal and no Result here. "A flag
 * has no execution effect" is therefore a property of what this context can reach rather
 * than a rule a later branch has to remember.
 */
export interface RunFlagContext {
  /** The Run, read under its own row lock inside this transaction. */
  readonly run: RunRecord | null;
  /** Re-read after the lock, never from a cached role (AD-7). */
  readonly authorizationRoles: RoleRepository;
  readonly auditEvents: AuditEventWriter;
  /** Every current Audit Manager, read on THIS transaction's connection. */
  auditManagerIds(): Promise<readonly string[]>;
  /** The Procedure name and version this Run froze, for the notification projection. */
  insertFlag(flag: RunFlag): Promise<void>;
  enqueueNotification(notification: FlagNotification): Promise<void>;
  /** Wake the list channel so a bell somewhere re-reads its count (Story 5.1). */
  notifyTimeline(sequence: number): Promise<void>;
}

export interface RunFlagRepository {
  transaction<T>(runId: string, work: (context: RunFlagContext) => Promise<T>): Promise<T>;
}
