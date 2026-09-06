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
import { evidencePackageContext } from './evidence-package-repository.js';
import { runResultContext } from './result-repository.js';
import { DrizzleFrozenExecutionReader } from '../procedures/procedure-repository.js';
import {
  createAuditEventWriter,
  CryptoUuidV7Generator,
  SystemClock,
} from '../db/audit-events.js';
import { isUuidText } from '../db/identifier.js';
import { isEvidenceCaptureMethod, isEvidenceCaptureTimeSource } from '@intellifin/domain';

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
              evidenceRequired: evidence.required,
              // Generation 32. Read as request-shaped input, like every other stored
              // value: a code this build does not know is `null`, which the surface says
              // in words rather than rendering as a fact.
              capturedAt: evidence.capturedAt === null ? null : evidence.capturedAt.toISOString(),
              captureMethod: isEvidenceCaptureMethod(evidence.captureMethod) ? evidence.captureMethod : null,
              captureTimeSource: isEvidenceCaptureTimeSource(evidence.captureTimeSource) ? evidence.captureTimeSource : null,
            }
          : null;
      if (Boolean(progress) !== Boolean(evidence))
        throw new Error('Population checkpoint integrity failure');
      return work({
        run,
        checkpoint,
        ...evidencePackageContext(tx, runId),
        // Story 3.9: this stage takes terminal transitions too, so it completes the Run.
        ...runResultContext(tx, runId),
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
              required: cp.evidenceRequired,
              capturedAt: cp.capturedAt === null ? null : new Date(cp.capturedAt),
              captureMethod: cp.captureMethod,
              captureTimeSource: cp.captureTimeSource,
              // REGISTERED once the raw digest is verified, RESERVED until then. It is
              // deliberately NOT abandoned here even at a TERMINAL checkpoint: `SealPackage`
              // is the one thing that abandons a reservation (Story 3.5), and a repository
              // that did it as a side effect of a status would be the third copy of the
              // rule this story exists to remove — and the seal would then find nothing
              // open and list no abandonment on the Result.
              state: cp.rawDigest ? 'REGISTERED' : 'RESERVED',
            })
            .onConflictDoUpdate({
              target: populationEvidence.runId,
              set: {
                rawDigest: cp.rawDigest,
                envelopeDigest: cp.envelopeDigest,
                size: cp.size,
                required: cp.evidenceRequired,
                capturedAt: cp.capturedAt === null ? null : new Date(cp.capturedAt),
                captureMethod: cp.captureMethod,
                captureTimeSource: cp.captureTimeSource,
                state: cp.rawDigest ? 'REGISTERED' : 'RESERVED',
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
                // Generation 32: the two numbers behind the §H record-count reconciliation.
                // `declaredCount` is `null` when the declaration stated none this build can
                // store — never the retrieved count, which would make every unreconciled
                // population look reconciled.
                declaredCount: result.declaredCount,
                retrievedCount: result.retrievedCount,
                rowsDigest: result.rowsDigest,
                checks: result.checks,
                // Generation 24: the declaration's own generation time, so the Run-level
                // Gate can name WHICH way a snapshot is unfit. `null` when the declaration
                // stated none this build can read, which §H makes `INCONCLUSIVE`.
                generatedAt: result.generatedAt === null ? null : new Date(result.generatedAt),
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
          envelopeDigest: populationEvidence.envelopeDigest,
          size: populationEvidence.size,
          required: populationEvidence.required,
          // The two objects this ONE reservation addresses. The Evidence tab used to spell
          // `population/<runId>/raw` inline, which is a second copy of `evidenceObjectKeys`
          // that nothing compared with the first; and the Result's declared-count row needs
          // the ENVELOPE key, because that is the artifact the declaration is frozen in.
          objectKey: populationEvidence.objectKey,
          envelopeKey: populationEvidence.envelopeKey,
          capturedAt: populationEvidence.capturedAt,
          captureMethod: populationEvidence.captureMethod,
          captureTimeSource: populationEvidence.captureTimeSource,
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
      // The capture instant is rendered as ISO 8601 UTC on every Run surface, so the
      // conversion happens once here rather than on each page that shows it.
      evidence: evidence
        ? { ...evidence, capturedAt: evidence.capturedAt === null ? null : evidence.capturedAt.toISOString() }
        : evidence,
      summary,
      rows: rows.slice(0, 50),
      next: rows.length > 50 ? rows[49]!.ordinal : null,
    };
  }
}
