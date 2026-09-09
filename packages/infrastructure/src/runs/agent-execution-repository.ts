import { asc, eq, sql } from 'drizzle-orm';
import type {
  AgentExecutionCheckpoint,
  AgentExecutionContext,
  AgentExecutionRepository,
  SessionStepRecord,
} from '@intellifin/application';
import type { Database } from '../db/client.js';
import {
  auditRun,
  populationExecution,
  runAgentExecution,
  runSessionStep,
  runStepExecution,
  runToolAction,
  runWorkspace,
} from '../db/schema.js';
import { DrizzleRunRepository } from './run-repository.js';
import { evidencePackageContext } from './evidence-package-repository.js';
import { runResultContext } from './result-repository.js';
import { DrizzleFrozenExecutionReader } from '../procedures/procedure-repository.js';
import { createAuditEventWriter, CryptoUuidV7Generator, SystemClock } from '../db/audit-events.js';
import { isUuidText } from '../db/identifier.js';

/**
 * Persistence for the agent execution phase (Story 4.2).
 *
 * One transaction per unit, opened on the same `audit_run` row lock the population and
 * adapter stages take, so no two phases of one Run can interleave their writes. Everything
 * a unit commits — its checkpoint, its Session Step, its Step Execution, its sanitized Tool
 * Action, its audit event and the Timeline notification — is inside it.
 *
 * There is nowhere here for a credential, by construction: `run_tool_action` has no column
 * that could hold one, the checkpoint has none, and the audit chain refuses a
 * credential-shaped payload key outright.
 */
export class PostgresAgentExecutionRepository implements AgentExecutionRepository {
  constructor(private readonly db: Database) {}

  async transaction<T>(
    runId: string,
    work: (context: AgentExecutionContext) => Promise<T>,
  ): Promise<T> {
    if (!isUuidText(runId)) throw new Error('Invalid Run identity');
    return this.db.transaction(async (tx) => {
      await tx.select({ id: auditRun.runId }).from(auditRun).where(eq(auditRun.runId, runId)).for('update');
      const run = await new DrizzleRunRepository(tx).findRun(runId);
      const [stage] = await tx.select().from(runAgentExecution).where(eq(runAgentExecution.runId, runId));
      const [population] = await tx
        .select()
        .from(populationExecution)
        .where(eq(populationExecution.runId, runId));
      const [workspace] = await tx.select().from(runWorkspace).where(eq(runWorkspace.runId, runId));
      const steps = await tx
        .select()
        .from(runSessionStep)
        .where(eq(runSessionStep.runId, runId))
        .orderBy(asc(runSessionStep.ordinal));

      return work({
        run,
        // The Evidence package's, the Gate's and the Result's shared reads, so this phase
        // can end a Run the same way every other one does — through `completeRun`, which
        // seals the package in the same transaction as the terminal transition.
        ...evidencePackageContext(tx, runId),
        ...runResultContext(tx, runId),
        checkpoint: stage
          ? {
              revision: stage.revision,
              status: stage.status as AgentExecutionCheckpoint['status'],
              attempts: stage.attempts,
              runStartedAt: stage.runStartedAt.toISOString(),
              startedAt: stage.startedAt.toISOString(),
              attemptStartedAt: stage.attemptStartedAt.toISOString(),
              leaseUntil: stage.leaseUntil.toISOString(),
              attemptId: stage.attemptId,
              diagnostic: stage.diagnostic,
            }
          : null,
        // The overall execution deadline starts with the first POPULATION claim and is
        // never restarted (population contract v1), so this phase inherits it.
        populationStartedAt: population ? population.startedAt.toISOString() : null,
        populationReady: population?.status === 'POPULATION_READY',
        // `OPEN` and nothing else: a workspace being provisioned, retried or released is
        // not one an action may be taken in.
        workspace:
          workspace && workspace.status === 'OPEN' && workspace.workspaceId !== null
            ? { workspaceId: workspace.workspaceId, mode: workspace.mode }
            : null,
        sessionSteps: steps.map(
          (row): SessionStepRecord => ({
            stepId: row.stepId,
            ordinal: row.ordinal,
            registrationId: row.registrationId,
            displayName: row.displayName,
            action: row.action as SessionStepRecord['action'],
            state: row.state as SessionStepRecord['state'],
            attempts: row.attempts,
            diagnostic: row.diagnostic,
            evidenceId: row.evidenceId,
          }),
        ),
        auditEvents: createAuditEventWriter(tx, new SystemClock(), new CryptoUuidV7Generator()),
        frozenPlan: () =>
          run
            ? new DrizzleFrozenExecutionReader(tx).readFrozenExecution(run.versionId, run.procedureId)
            : Promise.resolve(null),
        async saveCheckpoint(checkpoint, state) {
          const values = {
            runId,
            revision: checkpoint.revision,
            status: checkpoint.status,
            attempts: checkpoint.attempts,
            runStartedAt: new Date(checkpoint.runStartedAt),
            startedAt: new Date(checkpoint.startedAt),
            attemptStartedAt: new Date(checkpoint.attemptStartedAt),
            leaseUntil: new Date(checkpoint.leaseUntil),
            attemptId: checkpoint.attemptId,
            diagnostic: checkpoint.diagnostic,
          };
          await tx
            .insert(runAgentExecution)
            .values(values)
            .onConflictDoUpdate({ target: runAgentExecution.runId, set: values });
          await tx.update(auditRun).set({ state }).where(eq(auditRun.runId, runId));
        },
        async saveSessionStep(step) {
          const values = { ...step, runId };
          await tx
            .insert(runSessionStep)
            .values(values)
            .onConflictDoUpdate({
              target: [runSessionStep.runId, runSessionStep.stepId],
              set: {
                state: step.state,
                attempts: step.attempts,
                diagnostic: step.diagnostic,
                evidenceId: step.evidenceId,
              },
            });
        },
        async saveStepExecution(execution) {
          const values = {
            ...execution,
            runId,
            startedAt: new Date(execution.startedAt),
            completedAt: execution.completedAt === null ? null : new Date(execution.completedAt),
          };
          await tx
            .insert(runStepExecution)
            .values(values)
            .onConflictDoUpdate({
              target: runStepExecution.stepExecutionId,
              set: {
                state: execution.state,
                completedAt: values.completedAt,
                diagnostic: execution.diagnostic,
              },
            });
        },
        async saveToolAction(action) {
          // `DO NOTHING`, not `DO UPDATE`: an action already recorded is a redelivery
          // writing the row it already wrote, and rewriting the record of what a Run did
          // to a Target System is not something this table should be able to do.
          await tx
            .insert(runToolAction)
            .values({
              ...action,
              parameters: [...action.parameters],
              startedAt: new Date(action.startedAt),
              completedAt: action.completedAt === null ? null : new Date(action.completedAt),
            })
            .onConflictDoNothing({ target: runToolAction.toolActionId });
        },
        async notifyTimeline(sequence: number) {
          await tx.execute(
            sql`SELECT pg_notify('run_timeline',${JSON.stringify({ runId, sequence })})`,
          );
        },
        async readStepExecutionCount() {
          const [row] = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(runStepExecution)
            .where(eq(runStepExecution.runId, runId));
          return row?.count ?? 0;
        },
      });
    });
  }

  /**
   * The agent phase's OWN read, not a surface's and not another stage's.
   *
   * A Run whose population is ready, whose workspace is OPEN, and whose agent phase is
   * unclaimed, retrying or holding an expired lease. It is scoped by the WORKSPACE rather
   * than by "no checkpoint row", because every adapter-only Run would otherwise be
   * selected on every tick to be told there is nothing to do.
   */
  async recoverableRunIds(limit: number): Promise<string[]> {
    const rows = await this.db
      .select({ id: auditRun.runId })
      .from(auditRun)
      .innerJoin(populationExecution, eq(populationExecution.runId, auditRun.runId))
      .innerJoin(runWorkspace, eq(runWorkspace.runId, auditRun.runId))
      .leftJoin(runAgentExecution, eq(runAgentExecution.runId, auditRun.runId))
      .where(
        // Recovery provisions before sign-in. A failed or interrupted reattachment
        // must remain discoverable even before extraction has begun; a live lease
        // belongs to its current claimant and is excluded.
        sql`${auditRun.state}='RUNNING' AND ${populationExecution.status}='POPULATION_READY' AND (${runWorkspace.status} IN ('OPEN','RETRY') OR (${runWorkspace.status}='PROVISIONING' AND ${runWorkspace.leaseUntil}<=now())) AND (${runAgentExecution.runId} IS NULL OR ${runAgentExecution.status}='RETRY' OR (${runAgentExecution.status}='EXECUTING' AND ${runAgentExecution.leaseUntil}<=now()))`,
      )
      .orderBy(asc(auditRun.initiatedAt))
      .limit(Math.max(1, Math.min(100, limit)));
    return rows.map((row) => row.id);
  }
}
