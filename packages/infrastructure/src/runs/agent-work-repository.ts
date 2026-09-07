import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { AgentWorkCheckpoint, AgentWorkContext, AgentWorkRepository, AgentTurnRecord, RunWait } from '@intellifin/application';
import { canonicalJson, type JsonValue, type SanitizedToolAction } from '@intellifin/domain';
import type { Database } from '../db/client.js';
import { auditEvents, auditRun, runAgentExecution, runAgentWork, runAgentTurn, runWorkspace, runExecution, runEvidence, runEvidenceCapture, runToolAction, runWait } from '../db/schema.js';
import { withRunExecutionContext } from './adapter-execution-repository.js';

/** One Run lock and the same Evidence/Observation/Gate/Result writes as the adapter path. */
export class PostgresAgentWorkRepository implements AgentWorkRepository {
  constructor(private readonly db: Database) {}

  async transaction<T>(runId: string, work: (context: AgentWorkContext) => Promise<T>): Promise<T> {
    return this.db.transaction(tx => withRunExecutionContext(tx, runId, async shared => {
      const [stage] = await tx.select().from(runAgentWork).where(eq(runAgentWork.runId, runId));
      const [workspace] = await tx.select().from(runWorkspace).where(eq(runWorkspace.runId, runId));
      const [signIn] = await tx.select().from(runAgentExecution).where(eq(runAgentExecution.runId, runId));
      const [wait] = stage?.waitId ? await tx.select().from(runWait).where(and(eq(runWait.waitId, stage.waitId), eq(runWait.runId, runId))) : [];
      const raisedEvents = wait === undefined ? [] : await tx.select({ payload: auditEvents.payload }).from(auditEvents)
        .where(and(eq(auditEvents.aggregateId, runId), eq(auditEvents.eventType, 'execution.escalation-raised'), sql`${auditEvents.payload}->>'waitId'=${wait.waitId}`)).limit(2);
      const raised = raisedEvents.length === 1 ? raisedEvents[0]!.payload : null;
      const waitRaise = wait !== undefined && raised !== null && typeof raised.stepId === 'string' && Array.isArray(raised.supportingEvidenceIds) && raised.supportingEvidenceIds.every(id => typeof id === 'string')
        ? { runId, waitId: wait.waitId, stepId: raised.stepId, supportingEvidenceIds: raised.supportingEvidenceIds as readonly string[] } : null;
      const retainedIds = stage?.pendingWait?.retainedDecisionWaitIds ?? [];
      if (retainedIds.length > 2 || new Set(retainedIds).size !== retainedIds.length) throw new Error('Retained wait decision binding refused');
      const retainedRows = retainedIds.length === 0 ? [] : await tx.select().from(runWait).where(and(eq(runWait.runId, runId), inArray(runWait.waitId, [...retainedIds])));
      const retainedDecisions: AgentWorkContext['retainedDecisions'][number][] = [];
      for (const retained of retainedRows) {
        const events = await tx.select({ payload: auditEvents.payload }).from(auditEvents).where(and(eq(auditEvents.aggregateId, runId), eq(auditEvents.eventType, 'execution.escalation-raised'), sql`${auditEvents.payload}->>'waitId'=${retained.waitId}`)).limit(2);
        const payload = events.length === 1 ? events[0]!.payload : null;
        if (retained.closureKind !== 'answer' || retained.closedAt === null || retained.closedAt.getTime() >= retained.deadline.getTime() || retained.actor === null || !['choose-candidate','unnamed-value'].includes(retained.kind) || payload === null || typeof payload.stepId !== 'string' || !Array.isArray(payload.supportingEvidenceIds) || !payload.supportingEvidenceIds.every(id => typeof id === 'string')) throw new Error('Retained wait decision binding refused');
        retainedDecisions.push({ wait: { ...retained, kind: retained.kind as RunWait['kind'], deadline: retained.deadline.toISOString(), closedAt: retained.closedAt.toISOString(), closureKind: 'answer' }, raised: { runId, waitId: retained.waitId, stepId: payload.stepId, supportingEvidenceIds: payload.supportingEvidenceIds as readonly string[] } });
      }
      if (retainedDecisions.length !== retainedIds.length) throw new Error('Retained wait decision binding refused');
      const turns = await tx.select().from(runAgentTurn).where(eq(runAgentTurn.runId, runId)).orderBy(asc(runAgentTurn.sequence));
      const actions = await tx.select().from(runToolAction).where(eq(runToolAction.runId, runId)).orderBy(asc(runToolAction.startedAt));
      const captures = await tx.select().from(runEvidenceCapture).where(eq(runEvidenceCapture.runId, runId));
      return work({
        ...shared,
        checkpoint: stage === undefined ? null : {
          revision: stage.revision, status: stage.status as AgentWorkCheckpoint['status'],
          runStartedAt: stage.runStartedAt.toISOString(), leaseUntil: stage.leaseUntil.toISOString(),
          attemptId: stage.attemptId, workItemId: stage.workItemId, waitId: stage.waitId, pendingWait: stage.pendingWait, nextTurn: stage.nextTurn,
          tokens: stage.tokens, reservedTokens: stage.reservedTokens, model: stage.model,
          diagnostic: stage.diagnostic,
        },
        workspace: workspace?.status === 'OPEN' && workspace.workspaceId !== null &&
          (workspace.mode === 'local' || workspace.mode === 'solari')
          ? { runId, workspaceId: workspace.workspaceId, mode: workspace.mode } : null,
        prerequisitesReady: signIn?.status === 'SIGNED_IN' && shared.checkpoint?.status === 'EXTRACTION_COMPLETE',
        wait: wait === undefined ? null : { ...wait, kind: wait.kind as NonNullable<AgentWorkContext['wait']>['kind'], deadline: wait.deadline.toISOString(), closedAt: wait.closedAt?.toISOString() ?? null, closureKind: wait.closureKind as NonNullable<AgentWorkContext['wait']>['closureKind'] },
        waitRaise, retainedDecisions,
        toolActions: actions.map(row => ({ ...row, startedAt: row.startedAt.toISOString(), completedAt: row.completedAt?.toISOString() ?? null })) as readonly SanitizedToolAction[],
        captures,
        turns: turns.map(row => ({ ...row, status: row.status as AgentTurnRecord['status'] })),
        async saveCheckpoint(checkpoint, state) {
          const values = { ...checkpoint, runId, runStartedAt: new Date(checkpoint.runStartedAt), leaseUntil: new Date(checkpoint.leaseUntil) };
          await tx.insert(runAgentWork).values(values).onConflictDoUpdate({ target: runAgentWork.runId, set: values });
          await tx.update(auditRun).set({ state }).where(eq(auditRun.runId, runId));
        },
        async saveTurn(turn) {
          const [prior] = await tx.select().from(runAgentTurn).where(and(eq(runAgentTurn.runId, runId), eq(runAgentTurn.sequence, turn.sequence)));
          if (prior !== undefined) {
            if (prior.workItemId !== turn.workItemId || prior.stepExecutionId !== turn.stepExecutionId || prior.snapshotEvidenceId !== turn.snapshotEvidenceId || prior.reservedTokens !== turn.reservedTokens) throw new Error('Agent turn identity conflict');
            if (prior.status !== 'RESERVED') {
              if (prior.status !== turn.status || prior.diagnostic !== turn.diagnostic || canonicalJson(prior.response as unknown as JsonValue) !== canonicalJson(turn.response as unknown as JsonValue)) throw new Error('Agent turn completion conflict');
              return;
            }
          }
          await tx.insert(runAgentTurn).values({ ...turn, runId }).onConflictDoUpdate({
            target: [runAgentTurn.runId, runAgentTurn.sequence],
            set: { status: turn.status, response: turn.response, diagnostic: turn.diagnostic },
          });
        },
        async saveToolAction(action) {
          if (action.runId !== runId) throw new Error('Tool Action Run mismatch');
          const [prior] = await tx.select().from(runToolAction).where(eq(runToolAction.toolActionId, action.toolActionId));
          if (prior !== undefined) {
            const stored = { ...prior, startedAt: prior.startedAt.toISOString(), completedAt: prior.completedAt?.toISOString() ?? null };
            if (canonicalJson(stored as unknown as JsonValue) !== canonicalJson(action as unknown as JsonValue)) throw new Error('Tool Action identity conflict');
            return;
          }
          await tx.insert(runToolAction).values({ ...action, parameters: [...action.parameters], startedAt: new Date(action.startedAt), completedAt: action.completedAt === null ? null : new Date(action.completedAt) });
        },
        async saveCapture(binding) {
          const [evidence] = await tx.select().from(runEvidence).where(and(eq(runEvidence.evidenceId, binding.evidenceId), eq(runEvidence.runId, runId)));
          const [action] = await tx.select().from(runToolAction).where(and(eq(runToolAction.toolActionId, binding.toolActionId), eq(runToolAction.runId, runId)));
          if (!evidence || !action || evidence.state !== 'REGISTERED' ||
              !['structural-snapshot','screenshot'].includes(evidence.kind) ||
              action.outcome !== 'performed' || action.capture !== 'PERMITTED' ||
              action.destination !== binding.sourceLocation || action.targetSystem !== evidence.registrationId) {
            throw new Error('Evidence capture binding refused');
          }
          const [prior] = await tx.select().from(runEvidenceCapture).where(eq(runEvidenceCapture.evidenceId, binding.evidenceId));
          if (prior !== undefined) {
            if (prior.runId !== runId || prior.toolActionId !== binding.toolActionId || prior.sourceLocation !== binding.sourceLocation) throw new Error('Evidence capture binding conflict');
            return;
          }
          await tx.insert(runEvidenceCapture).values({ ...binding, runId });
        },
      });
    }));
  }

  async recoverableRunIds(limit: number): Promise<string[]> {
    const rows = await this.db.select({ id: auditRun.runId }).from(auditRun)
      .innerJoin(runWorkspace, eq(runWorkspace.runId, auditRun.runId))
      .innerJoin(runAgentExecution, eq(runAgentExecution.runId, auditRun.runId))
      .innerJoin(runExecution, eq(runExecution.runId, auditRun.runId))
      .leftJoin(runAgentWork, eq(runAgentWork.runId, auditRun.runId))
      .where(sql`${auditRun.state}='RUNNING' AND ${runWorkspace.status}='OPEN' AND ${runAgentExecution.status}='SIGNED_IN' AND ${runExecution.status}='EXTRACTION_COMPLETE' AND (${runAgentWork.runId} IS NULL OR ${runAgentWork.status}='RETRY' OR (${runAgentWork.status} IN ('EXECUTING','WAITING') AND ${runAgentWork.leaseUntil}<=now()))`)
      .orderBy(asc(auditRun.initiatedAt)).limit(Math.max(1, Math.min(100, limit)));
    return rows.map(row => row.id);
  }
}
