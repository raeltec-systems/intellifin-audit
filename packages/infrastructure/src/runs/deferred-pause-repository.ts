import { and, eq, isNull, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import type {
  DeferredPauseContext,
  DeferredPauseCurrentInspection,
  DeferredPauseRepository,
} from '@intellifin/application';
import { canonicalJson, classifyPlanTargets, type JsonValue, type RunDeferredPauseRequest } from '@intellifin/domain';
import type { Database, Transaction } from '../db/client.js';
import {
  auditRun,
  runAgentWork,
  runDeferredPause,
  runWait,
  runWorkItem,
} from '../db/schema.js';
import { isUuidText } from '../db/identifier.js';
import { DrizzleRoleRepository } from '../identity/role-repository.js';
import { DrizzleFrozenExecutionReader } from '../procedures/procedure-repository.js';
import { readLockedRunControlLease, runControlServerTime } from './run-control-lease-repository.js';
import { DrizzleRunRepository } from './run-repository.js';
import { createAuditEventWriter, CryptoUuidV7Generator, SystemClock } from '../db/audit-events.js';

function revisionValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function rowDate(value: unknown): string | null {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : typeof value === 'string' ? value : null;
}

/**
 * Transaction adapter for deferred-pause admission and the worker latch. It deliberately
 * uses the existing canonical Run lock, frozen-plan reader, audit writer and Timeline
 * channel, with narrow admission queries instead of loading execution evidence.
 */
export class PostgresDeferredPauseRepository implements DeferredPauseRepository {
  constructor(private readonly db: Database | Transaction) {}

  async transaction<T>(runId: string, work: (context: DeferredPauseContext) => Promise<T>): Promise<T> {
    if (!isUuidText(runId)) throw new Error('Invalid Run identity');
    return this.db.transaction(async tx => {
      // Keep proposal confirmation short: the Run lock, the narrow execution/lease reads,
      // the marker and its audit event are all this transaction needs. Loading the full
      // Evidence/Observation projection here would hold unrelated rows during a browser
      // confirmation and could deadlock with an executing worker.
      await tx.select({ id: auditRun.runId }).from(auditRun).where(eq(auditRun.runId, runId)).for('update');
      const loaded = await new DrizzleRunRepository(tx).findRun(runId);
      const revisionResult = await tx.execute(sql`SELECT revision FROM audit_run WHERE run_id = ${runId}`);
      const revision = revisionValue(revisionResult[0]?.revision);
      const run = loaded === null || revision === null ? null : { ...loaded, revision };
      const context: DeferredPauseContext = {
        run,
        authorizationRoles: new DrizzleRoleRepository(tx),
        auditEvents: createAuditEventWriter(tx, new SystemClock(), new CryptoUuidV7Generator()),
        async notifyTimeline(sequence: number) {
          await tx.execute(sql`SELECT pg_notify('run_timeline', ${JSON.stringify({ runId, sequence })})`);
        },
        async readCurrentInspection(): Promise<DeferredPauseCurrentInspection | null> {
          if (run === null) return null;
          const [row] = await tx.select({
            workItemId: runWorkItem.workItemId,
            stepId: runWorkItem.stepId,
            subjectKey: runWorkItem.subjectKey,
            registrationId: runWorkItem.registrationId,
            stage: runAgentWork.status,
            workState: runWorkItem.state,
            waitId: runAgentWork.waitId,
            waitKind: runWait.kind,
          }).from(runAgentWork)
            .innerJoin(runWorkItem, and(eq(runWorkItem.workItemId, runAgentWork.workItemId), eq(runWorkItem.runId, runAgentWork.runId)))
            .leftJoin(runWait, and(eq(runWait.waitId, runAgentWork.waitId), eq(runWait.runId, runId), isNull(runWait.closedAt)))
            .where(eq(runAgentWork.runId, runId)).limit(1);
          if (!row || !isUuidText(row.workItemId) || row.subjectKey === undefined ||
              !['EXECUTING', 'RETRY', 'WAITING'].includes(row.stage) ||
              !['IN_PROGRESS', 'AWAITING'].includes(row.workState)) return null;
          const plan = await new DrizzleFrozenExecutionReader(tx).readFrozenExecution(run.versionId, run.procedureId);
          if (plan === null) return null;
          const classified = classifyPlanTargets(plan).agents.find(entry =>
            entry.stepId === row.stepId && entry.target.registrationId === row.registrationId);
          // The Work Item's step id and registration must both point to one frozen agent
          // target; a digest alone cannot prove that a malformed historical row is legal.
          if (classified === undefined) return null;
          return {
            anchor: {
              workItemId: row.workItemId.toLowerCase(),
              subjectKey: row.subjectKey,
              registrationId: row.registrationId.toLowerCase(),
              runRevision: run.revision,
              planDigest: createHash('sha256').update(canonicalJson(plan as unknown as JsonValue)).digest('hex'),
            },
            stage: row.stage as DeferredPauseCurrentInspection['stage'],
            openWaitId: row.waitId ?? null,
            openWaitKind: row.waitKind ?? null,
          };
        },
        async readControl() {
          const lease = await readLockedRunControlLease(tx, runId);
          return {
            epoch: lease?.epoch ?? 0,
            holderId: lease?.holderId ?? null,
            expiresAt: lease?.expiresAt ?? null,
            now: new Date(await runControlServerTime(tx)),
          };
        },
        async readDeferredPause(): Promise<RunDeferredPauseRequest | null> {
          const [row] = await tx.select().from(runDeferredPause)
            .where(and(eq(runDeferredPause.runId, runId), eq(runDeferredPause.state, 'PENDING'))).limit(1);
          if (!row) return null;
          const requestedAt = rowDate(row.requestedAt);
          const createdAt = rowDate(row.createdAt);
          if (requestedAt === null || createdAt === null || !isUuidText(row.commandId) || !isUuidText(row.runId) || !isUuidText(row.workItemId))
            throw new Error('Deferred pause marker is malformed');
          return {
            runId: row.runId.toLowerCase(), commandId: row.commandId.toLowerCase(), state: row.state as 'PENDING',
            workItemId: row.workItemId.toLowerCase(), subjectKey: row.subjectKey,
            registrationId: row.registrationId.toLowerCase(), runRevision: row.runRevision,
            planDigest: row.planDigest, requestedBy: row.requestedBy, sessionId: row.sessionId,
            requestedAt, expectedControlEpoch: row.expectedControlEpoch,
          };
        },
        async requestDeferredPause(request) {
          if (request.runId !== runId || request.state !== 'PENDING') throw new Error('Deferred pause identity mismatch');
          await tx.insert(runDeferredPause).values({
            commandId: request.commandId, runId: request.runId, workItemId: request.workItemId,
            subjectKey: request.subjectKey, registrationId: request.registrationId,
            runRevision: request.runRevision, planDigest: request.planDigest,
            requestedBy: request.requestedBy, sessionId: request.sessionId,
            requestedAt: new Date(request.requestedAt), expectedControlEpoch: request.expectedControlEpoch,
            state: 'PENDING', createdAt: new Date(request.requestedAt),
          });
        },
        async settleDeferredPause(state, at, reason) {
          if (state === 'SUPERSEDED' && reason === undefined) throw new Error('Deferred pause supersession requires a reason');
          const changed = state === 'APPLIED'
            ? await tx.update(runDeferredPause).set({ state: 'APPLIED', appliedAt: new Date(at) })
              .where(and(eq(runDeferredPause.runId, runId), eq(runDeferredPause.state, 'PENDING'))).returning({ commandId: runDeferredPause.commandId })
            : await tx.update(runDeferredPause).set({ state: 'SUPERSEDED', supersededAt: new Date(at), supersededReason: reason })
              .where(and(eq(runDeferredPause.runId, runId), eq(runDeferredPause.state, 'PENDING'))).returning({ commandId: runDeferredPause.commandId });
          if (changed.length > 1) throw new Error('Multiple deferred pauses were settled');
        },
      };
      return work(context);
    });
  }
}
