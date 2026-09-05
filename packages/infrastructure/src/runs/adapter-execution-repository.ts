import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type {
  AdapterEvidenceRecord,
  AdapterExecutionCheckpoint,
  AdapterExecutionContext,
  AdapterExecutionRepository,
  PopulationCheckpoint,
  PopulationRecord,
  SessionStepRecord,
  StepExecutionRecord,
  WorkItemRecord,
} from '@intellifin/application';
import { POPULATION_LIMITS, type ObservationRecord } from '@intellifin/domain';
import type { Database } from '../db/client.js';
import {
  auditRun,
  populationExecution,
  populationRow,
  runEvidence,
  runExecution,
  runObservation,
  runSessionStep,
  runStepExecution,
  runWorkItem,
} from '../db/schema.js';
import { DrizzleRunRepository } from './run-repository.js';
import { DrizzleFrozenExecutionReader } from '../procedures/procedure-repository.js';
import { createAuditEventWriter, CryptoUuidV7Generator, SystemClock } from '../db/audit-events.js';
import { isUuidText } from '../db/identifier.js';

/**
 * Persistence for the adapter execution stage, mirroring `PostgresPopulationRepository`.
 *
 * One transaction per unit, opened on the same `audit_run` row lock the population stage
 * takes, so the two stages of one Run can never interleave their writes. Everything a
 * unit commits — its state, its Evidence row, its Observations, its Step Execution, its
 * audit event and the Timeline notification — is inside it.
 */
export class PostgresAdapterExecutionRepository implements AdapterExecutionRepository {
  constructor(private readonly db: Database) {}

  async transaction<T>(
    runId: string,
    work: (context: AdapterExecutionContext) => Promise<T>,
  ): Promise<T> {
    if (!isUuidText(runId)) throw new Error('Invalid Run identity');
    return this.db.transaction(async (tx) => {
      await tx.select({ id: auditRun.runId }).from(auditRun).where(eq(auditRun.runId, runId)).for('update');
      const run = await new DrizzleRunRepository(tx).findRun(runId);
      const progress = (
        await tx.select().from(populationExecution).where(eq(populationExecution.runId, runId))
      )[0];
      const stage = (await tx.select().from(runExecution).where(eq(runExecution.runId, runId)))[0];
      const steps = await tx
        .select()
        .from(runSessionStep)
        .where(eq(runSessionStep.runId, runId))
        .orderBy(asc(runSessionStep.ordinal));
      const items = await tx
        .select()
        .from(runWorkItem)
        .where(eq(runWorkItem.runId, runId))
        .orderBy(asc(runWorkItem.ordinal));
      const evidence = await tx.select().from(runEvidence).where(eq(runEvidence.runId, runId));

      // `population_execution` and `population_evidence` are the population stage's rows;
      // only its status and its start time matter here, and the start time is the Run
      // deadline this stage inherits rather than restarting.
      const population: PopulationCheckpoint | null = progress
        ? ({
            stepId: progress.stepId,
            attemptId: progress.attemptId,
            revision: progress.revision,
            status: progress.status as PopulationCheckpoint['status'],
            attempts: progress.attempts,
            startedAt: progress.startedAt.toISOString(),
            attemptStartedAt: progress.attemptStartedAt.toISOString(),
            leaseUntil: progress.leaseUntil.toISOString(),
            diagnostic: progress.diagnostic,
            evidenceId: '',
            objectKey: '',
            envelopeKey: '',
            rawDigest: null,
            envelopeDigest: null,
            size: null,
          } satisfies PopulationCheckpoint)
        : null;

      return work({
        run,
        population,
        checkpoint: stage
          ? {
              revision: stage.revision,
              status: stage.status as AdapterExecutionCheckpoint['status'],
              attempts: stage.attempts,
              runStartedAt: stage.runStartedAt.toISOString(),
              startedAt: stage.startedAt.toISOString(),
              attemptStartedAt: stage.attemptStartedAt.toISOString(),
              leaseUntil: stage.leaseUntil.toISOString(),
              attemptId: stage.attemptId,
              diagnostic: stage.diagnostic,
            }
          : null,
        sessionSteps: steps.map(
          (row): SessionStepRecord => ({
            stepId: row.stepId,
            ordinal: row.ordinal,
            registrationId: row.registrationId,
            displayName: row.displayName,
            state: row.state as SessionStepRecord['state'],
            attempts: row.attempts,
            diagnostic: row.diagnostic,
            evidenceId: row.evidenceId,
          }),
        ),
        workItems: items.map(
          (row): WorkItemRecord => ({
            workItemId: row.workItemId,
            stepId: row.stepId,
            ordinal: row.ordinal,
            registrationId: row.registrationId,
            displayName: row.displayName,
            state: row.state as WorkItemRecord['state'],
            attempts: row.attempts,
            cycles: row.cycles,
            diagnostic: row.diagnostic,
            evidenceId: row.evidenceId,
            observations: row.observations,
          }),
        ),
        evidence: evidence.map(
          (row): AdapterEvidenceRecord => ({
            evidenceId: row.evidenceId,
            kind: row.kind as AdapterEvidenceRecord['kind'],
            registrationId: row.registrationId,
            objectKey: row.objectKey,
            mediaType: row.mediaType,
            digest: row.digest,
            size: row.size,
            state: row.state as AdapterEvidenceRecord['state'],
          }),
        ),
        auditEvents: createAuditEventWriter(tx, new SystemClock(), new CryptoUuidV7Generator()),
        frozenPlan: () =>
          run
            ? new DrizzleFrozenExecutionReader(tx).readFrozenExecution(run.versionId, run.procedureId)
            : Promise.resolve(null),
        async includedRecords(): Promise<readonly PopulationRecord[]> {
          const rows = await tx
            .select({ ordinal: populationRow.ordinal, values: populationRow.values })
            .from(populationRow)
            .where(and(eq(populationRow.runId, runId), eq(populationRow.disposition, 'included')))
            .orderBy(asc(populationRow.ordinal))
            .limit(POPULATION_LIMITS.rows);
          return rows;
        },
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
            .insert(runExecution)
            .values(values)
            .onConflictDoUpdate({ target: runExecution.runId, set: values });
          await tx.update(auditRun).set({ state }).where(eq(auditRun.runId, runId));
        },
        async saveEvidence(record) {
          const values = { ...record, runId };
          await tx
            .insert(runEvidence)
            .values(values)
            .onConflictDoUpdate({
              target: runEvidence.evidenceId,
              set: {
                mediaType: record.mediaType,
                digest: record.digest,
                size: record.size,
                state: record.state,
              },
            });
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
        async saveWorkItem(item) {
          const values = { ...item, runId };
          await tx
            .insert(runWorkItem)
            .values(values)
            .onConflictDoUpdate({
              target: runWorkItem.workItemId,
              set: {
                state: item.state,
                attempts: item.attempts,
                cycles: item.cycles,
                diagnostic: item.diagnostic,
                evidenceId: item.evidenceId,
                observations: item.observations,
              },
            });
        },
        async saveStepExecution(execution: StepExecutionRecord) {
          const values = {
            ...execution,
            runId,
            action: execution.action,
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
        async saveObservations(observations: readonly ObservationRecord[]) {
          // `DO NOTHING` on (work_item_id, population_record_key): a redelivered job that
          // reaches this line again writes no second Observation for the same record.
          for (let offset = 0; offset < observations.length; offset += 500) {
            const batch = observations.slice(offset, offset + 500).map((observation) => ({
              observationId: observation.observationId,
              runId,
              workItemId: observation.workItemId,
              schemaVersion: observation.schemaVersion,
              populationRecordKey: observation.populationRecordKey,
              targetSystem: observation.targetSystem,
              found: observation.found,
              observedAt: new Date(observation.observedAt),
              stepExecutionId: observation.stepExecutionId,
              captureMethod: observation.captureMethod,
              matchOrigin: observation.matchOrigin,
              identity: observation.identity,
              attributes: [...observation.attributes],
              evidenceIds: [...observation.evidenceIds],
            }));
            if (batch.length > 0) {
              await tx
                .insert(runObservation)
                .values(batch)
                .onConflictDoNothing({
                  target: [runObservation.workItemId, runObservation.populationRecordKey],
                });
            }
          }
        },
        async notifyTimeline(sequence: number) {
          await tx.execute(
            sql`SELECT pg_notify('run_timeline',${JSON.stringify({ runId, sequence })})`,
          );
        },
      });
    });
  }

  /**
   * The job's own read, not a surface's.
   *
   * Active Runs whose population is ready and whose extraction is unclaimed, retrying or
   * holding an expired lease. A background sweep that borrowed a paged list would stop
   * seeing work the moment a page filled up (Story 1.8).
   */
  async recoverableRunIds(limit: number): Promise<string[]> {
    const rows = await this.db
      .select({ id: auditRun.runId })
      .from(auditRun)
      .innerJoin(populationExecution, eq(populationExecution.runId, auditRun.runId))
      .leftJoin(runExecution, eq(runExecution.runId, auditRun.runId))
      .where(
        sql`${auditRun.state}='RUNNING' AND ${populationExecution.status}='POPULATION_READY' AND (${runExecution.runId} IS NULL OR ${runExecution.status}='RETRY' OR (${runExecution.status}='EXECUTING' AND ${runExecution.leaseUntil}<=now()))`,
      )
      .orderBy(asc(auditRun.initiatedAt))
      .limit(Math.max(1, Math.min(100, limit)));
    return rows.map((row) => row.id);
  }

  /** What the Run page shows: Session Steps, Work Items and their Evidence. */
  async readExecution(runId: string) {
    if (!isUuidText(runId)) return null;
    const stage = (await this.db.select().from(runExecution).where(eq(runExecution.runId, runId)))[0];
    const steps = await this.db
      .select()
      .from(runSessionStep)
      .where(eq(runSessionStep.runId, runId))
      .orderBy(asc(runSessionStep.ordinal));
    const items = await this.db
      .select()
      .from(runWorkItem)
      .where(eq(runWorkItem.runId, runId))
      .orderBy(asc(runWorkItem.ordinal));
    if (!stage && steps.length === 0 && items.length === 0) return null;
    const ids = [...steps, ...items].map((row) => row.evidenceId).filter((id): id is string => id !== null);
    const evidence =
      ids.length === 0
        ? []
        : await this.db
            .select({
              evidenceId: runEvidence.evidenceId,
              state: runEvidence.state,
              digest: runEvidence.digest,
              size: runEvidence.size,
            })
            .from(runEvidence)
            .where(inArray(runEvidence.evidenceId, ids));
    const byId = new Map(evidence.map((row) => [row.evidenceId, row]));
    return {
      status: stage?.status ?? null,
      attempts: stage?.attempts ?? 0,
      diagnostic: stage?.diagnostic ?? null,
      sessionSteps: steps.map((row) => ({ ...row, evidence: byId.get(row.evidenceId ?? '') ?? null })),
      workItems: items.map((row) => ({ ...row, evidence: byId.get(row.evidenceId ?? '') ?? null })),
    };
  }
}
