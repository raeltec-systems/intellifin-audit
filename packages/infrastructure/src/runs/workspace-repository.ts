import { and, asc, eq, gt, isNotNull, sql } from 'drizzle-orm';
import type {
  StepExecutionRecord,
  WorkspaceCheckpoint,
  WorkspaceExecutionContext,
  WorkspaceExecutionRepository,
} from '@intellifin/application';

import type { Database } from '../db/client.js';
import { auditRun, runStepExecution, runWorkspace } from '../db/schema.js';
import { DrizzleRunRepository } from './run-repository.js';
import { evidencePackageContext } from './evidence-package-repository.js';
import { runResultContext } from './result-repository.js';
import { DrizzleFrozenExecutionReader } from '../procedures/procedure-repository.js';
import { createAuditEventWriter, CryptoUuidV7Generator, SystemClock } from '../db/audit-events.js';
import { isUuidText } from '../db/identifier.js';

/**
 * Persistence for the Agent Workspace stage (Story 4.1), mirroring
 * `PostgresPopulationRepository`.
 *
 * One transaction per unit, opened on the same `audit_run` row lock the other two stages
 * take, so no two stages of one Run can interleave their writes. Everything a unit commits
 * — the workspace row, the Run state, the Step Execution, the audit event, the Timeline
 * notification and, at a terminal transition, the sealed package and Result — is inside it.
 *
 * It carries the full `RunResultContext` because this stage takes terminal transitions:
 * §E makes a Run-level Session Step's failure after bounded retries `RUN_FAILED`, and
 * generation 25's deferred constraint trigger refuses a Run reaching a terminal state
 * without a Result. A branch that forgot would fail to commit rather than ship a Run
 * nobody can read.
 */
export class PostgresWorkspaceRepository implements WorkspaceExecutionRepository {
  constructor(private readonly db: Database) {}

  async transaction<T>(
    runId: string,
    work: (context: WorkspaceExecutionContext) => Promise<T>,
  ): Promise<T> {
    if (!isUuidText(runId)) throw new Error('Invalid Run identity');
    return this.db.transaction(async (tx) => {
      await tx.select({ id: auditRun.runId }).from(auditRun).where(eq(auditRun.runId, runId)).for('update');
      const run = await new DrizzleRunRepository(tx).findRun(runId);
      const row = (await tx.select().from(runWorkspace).where(eq(runWorkspace.runId, runId)))[0];
      return work({
        run,
        ...evidencePackageContext(tx, runId),
        ...runResultContext(tx, runId),
        auditEvents: createAuditEventWriter(tx, new SystemClock(), new CryptoUuidV7Generator()),
        async notifyTimeline(sequence: number) {
          await tx.execute(
            sql`SELECT pg_notify('run_timeline',${JSON.stringify({ runId, sequence })})`,
          );
        },
        checkpoint: row
          ? {
              revision: row.revision,
              status: row.status as WorkspaceCheckpoint['status'],
              attempts: row.attempts,
              stepId: row.stepId,
              workspaceId: row.workspaceId,
              expiresAt: row.expiresAt === null ? null : row.expiresAt.toISOString(),
              mode: row.mode as WorkspaceCheckpoint['mode'],
              startedAt: row.startedAt.toISOString(),
              attemptStartedAt: row.attemptStartedAt.toISOString(),
              leaseUntil: row.leaseUntil.toISOString(),
              releasedAt: row.releasedAt === null ? null : row.releasedAt.toISOString(),
              diagnostic: row.diagnostic,
            }
          : null,
        frozenPlan: () =>
          run
            ? new DrizzleFrozenExecutionReader(tx).readFrozenExecution(run.versionId, run.procedureId)
            : Promise.resolve(null),
        async save(checkpoint, state) {
          const values = {
            runId,
            revision: checkpoint.revision,
            status: checkpoint.status,
            attempts: checkpoint.attempts,
            stepId: checkpoint.stepId,
            workspaceId: checkpoint.workspaceId,
            expiresAt: checkpoint.expiresAt === null ? null : new Date(checkpoint.expiresAt),
            mode: checkpoint.mode,
            startedAt: new Date(checkpoint.startedAt),
            attemptStartedAt: new Date(checkpoint.attemptStartedAt),
            leaseUntil: new Date(checkpoint.leaseUntil),
            releasedAt: checkpoint.releasedAt === null ? null : new Date(checkpoint.releasedAt),
            diagnostic: checkpoint.diagnostic,
          };
          await tx
            .insert(runWorkspace)
            .values(values)
            .onConflictDoUpdate({ target: runWorkspace.runId, set: values });
          await tx.update(auditRun).set({ state }).where(eq(auditRun.runId, runId));
        },
        async saveStepExecution(execution: StepExecutionRecord) {
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
      });
    });
  }

  /**
   * The reaper's own read: workspaces still held whose Run has already ended.
   *
   * A keyset page ordered by Run id, so a rotation covers every one of them rather than
   * re-reading the same first page. `PROVISIONING` and `RETRY` are selected as well as
   * `OPEN`: an attempt that died between the provider answering and the commit leaves a
   * row that still names a session, and that session is exactly what would otherwise be
   * held until the provider's own grace timer reaped it.
   *
   * It selects only rows that NAME a workspace, because a row with no identity has nothing
   * to release; `releaseWorkspace` closes such a row when it meets one, and this read does
   * not make the sweep walk them forever.
   *
   * "Whose Run is absent" is unreachable by construction and deliberately so:
   * `run_workspace.run_id` is a real foreign key, so there is no dangling row to find.
   */
  async reapableRunIds(after: string | null, limit: number): Promise<string[]> {
    const page = Math.max(1, Math.min(100, limit));
    const cursor = after !== null && isUuidText(after) ? after : null;
    const rows = await this.db
      .select({ id: runWorkspace.runId })
      .from(runWorkspace)
      .innerJoin(auditRun, eq(auditRun.runId, runWorkspace.runId))
      .where(
        and(
          sql`${runWorkspace.status} IN ('PROVISIONING','OPEN','RETRY')`,
          isNotNull(runWorkspace.workspaceId),
          sql`${auditRun.state} IN ('COMPLETED','INCONCLUSIVE','RUN_FAILED','CANCELED')`,
          ...(cursor === null ? [] : [gt(runWorkspace.runId, cursor)]),
        ),
      )
      .orderBy(asc(runWorkspace.runId))
      .limit(page);
    return rows.map((row) => row.id);
  }
}
