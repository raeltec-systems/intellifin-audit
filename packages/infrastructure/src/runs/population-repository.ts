import { and, asc, eq, ne, sql } from 'drizzle-orm';
import type {
  PopulationExecutionRepository,
  PopulationExecutionContext,
  PopulationCheckpoint,
} from '@intellifin/application';
import type { Database } from '../db/client.js';
import {
  auditRun,
  populationExecution,
  populationEvidence,
  populationSnapshot,
  populationRow,
} from '../db/schema.js';
import { DrizzleRunRepository } from './run-repository.js';
import { DrizzleFrozenExecutionReader } from '../procedures/procedure-repository.js';
import {
  createAuditEventWriter,
  CryptoUuidV7Generator,
  SystemClock,
} from '../db/audit-events.js';
import { isUuidText } from '../db/identifier.js';

export class PostgresPopulationRepository
  implements PopulationExecutionRepository
{
  constructor(private readonly db: Database) {}
  async transaction<T>(
    runId: string,
    work: (context: PopulationExecutionContext) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      if (!isUuidText(runId)) throw new Error('Invalid Run identity');
      await tx
        .select({ id: auditRun.runId })
        .from(auditRun)
        .where(eq(auditRun.runId, runId))
        .for('update');
      const run = await new DrizzleRunRepository(tx).findRun(runId);
      const progress = (
        await tx
          .select()
          .from(populationExecution)
          .where(eq(populationExecution.runId, runId))
      )[0];
      const evidence = (
        await tx
          .select()
          .from(populationEvidence)
          .where(eq(populationEvidence.runId, runId))
      )[0];
      const checkpoint: PopulationCheckpoint | null =
        progress && evidence
          ? {
              stepId: progress.stepId,
              attemptId: progress.attemptId,
              revision: progress.revision,
              status: progress.status as PopulationCheckpoint['status'],
              attempts: progress.attempts,
              startedAt: progress.startedAt.toISOString(),
              attemptStartedAt: progress.attemptStartedAt.toISOString(),
              leaseUntil: progress.leaseUntil.toISOString(),
              diagnostic: progress.diagnostic,
              evidenceId: evidence.evidenceId,
              objectKey: evidence.objectKey,
              envelopeKey: evidence.envelopeKey,
              rawDigest: evidence.rawDigest,
              envelopeDigest: evidence.envelopeDigest,
              size: evidence.size,
            }
          : null;
      if (Boolean(progress) !== Boolean(evidence))
        throw new Error('Population checkpoint integrity failure');
      return work({
        run,
        checkpoint,
        auditEvents: createAuditEventWriter(
          tx,
          new SystemClock(),
          new CryptoUuidV7Generator(),
        ),
        frozenPlan: () =>
          run
            ? new DrizzleFrozenExecutionReader(tx).readFrozenExecution(
                run.versionId,
                run.procedureId,
              )
            : Promise.resolve(null),
        async save(cp, state, result) {
          const execution = {
            runId,
            stepId: cp.stepId,
            attemptId: cp.attemptId,
            revision: cp.revision,
            status: cp.status,
            attempts: cp.attempts,
            startedAt: new Date(cp.startedAt),
            attemptStartedAt: new Date(cp.attemptStartedAt),
            leaseUntil: new Date(cp.leaseUntil),
            diagnostic: cp.diagnostic,
          };
          await tx
            .insert(populationExecution)
            .values(execution)
            .onConflictDoUpdate({
              target: populationExecution.runId,
              set: execution,
            });
          await tx
            .insert(populationEvidence)
            .values({
              runId,
              evidenceId: cp.evidenceId,
              objectKey: cp.objectKey,
              envelopeKey: cp.envelopeKey,
              rawDigest: cp.rawDigest,
              envelopeDigest: cp.envelopeDigest,
              size: cp.size,
              state: cp.rawDigest
                ? 'REGISTERED'
                : cp.status === 'TERMINAL'
                  ? 'ABANDONED'
                  : 'RESERVED',
            })
            .onConflictDoUpdate({
              target: populationEvidence.runId,
              set: {
                rawDigest: cp.rawDigest,
                envelopeDigest: cp.envelopeDigest,
                size: cp.size,
                state: cp.rawDigest
                  ? 'REGISTERED'
                  : cp.status === 'TERMINAL'
                    ? 'ABANDONED'
                    : 'RESERVED',
              },
            });
          await tx
            .update(auditRun)
            .set({ state })
            .where(eq(auditRun.runId, runId));
          if (result) {
            await tx
              .insert(populationSnapshot)
              .values({
                runId,
                included: result.included,
                excluded: result.excluded,
                indeterminate: result.indeterminate,
                rowsDigest: result.rowsDigest,
                checks: result.checks,
              });
            for (let offset = 0; offset < result.rows.length; offset += 500)
              await tx
                .insert(populationRow)
                .values(
                  result.rows
                    .slice(offset, offset + 500)
                    .map((row) => ({ ...row, runId })),
                );
          }
        },
        async notifyTimeline(sequence) {
          await tx.execute(
            sql`SELECT pg_notify('run_timeline',${JSON.stringify({ runId, sequence })})`,
          );
        },
      });
    });
  }
  async recoverableRunIds(limit: number): Promise<string[]> {
    const rows = await this.db
      .select({ id: auditRun.runId })
      .from(auditRun)
      .leftJoin(
        populationExecution,
        eq(populationExecution.runId, auditRun.runId),
      )
      .where(
        sql`${auditRun.state} IN ('QUEUED','RUNNING') AND (${populationExecution.runId} IS NULL OR ${populationExecution.status}='RETRY' OR (${populationExecution.status}='ACQUIRING' AND ${populationExecution.leaseUntil}<=now()))`,
      )
      .orderBy(asc(auditRun.initiatedAt))
      .limit(Math.max(1, Math.min(100, limit)));
    return rows.map((row) => row.id);
  }
  async readPopulation(runId: string, after = 0) {
    if (!isUuidText(runId)) return null;
    const progress = (
      await this.db
        .select()
        .from(populationExecution)
        .where(eq(populationExecution.runId, runId))
    )[0];
    if (!progress) return null;
    const evidence = (
      await this.db
        .select({
          evidenceId: populationEvidence.evidenceId,
          state: populationEvidence.state,
          rawDigest: populationEvidence.rawDigest,
          size: populationEvidence.size,
        })
        .from(populationEvidence)
        .where(eq(populationEvidence.runId, runId))
    )[0];
    const summary = (
      await this.db
        .select()
        .from(populationSnapshot)
        .where(eq(populationSnapshot.runId, runId))
    )[0];
    const rows = await this.db
      .select({
        ordinal: populationRow.ordinal,
        disposition: populationRow.disposition,
        reasons: populationRow.reasons,
      })
      .from(populationRow)
      .where(
        and(
          eq(populationRow.runId, runId),
          ne(populationRow.disposition, 'included'),
          sql`${populationRow.ordinal}>${Number.isSafeInteger(after) && after >= 0 ? after : 0}`,
        ),
      )
      .orderBy(asc(populationRow.ordinal))
      .limit(51);
    return {
      status: progress.status,
      attempts: progress.attempts,
      diagnostic: progress.diagnostic,
      evidence,
      summary,
      rows: rows.slice(0, 50),
      next: rows.length > 50 ? rows[49]!.ordinal : null,
    };
  }
}
