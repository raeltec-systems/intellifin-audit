import { and, desc, eq } from 'drizzle-orm';
import { validateAuditEventDraft, canonicalJson, type JsonValue, type AuditEventRecord } from '@intellifin/domain';
import { parseDeferredPauseAnchor, parseRunConversationResumeAnchor, parseRunConversationQuestionAnchor } from '@intellifin/application';
import type { Transaction } from '../db/client.js';
import { isUuidText } from '../db/identifier.js';
import { runInteractionCommand, runInteractionTransition } from '../db/schema.js';

export function matchesFlagInteractionEvent(command: typeof runInteractionCommand.$inferSelect,
  event: { readonly eventType: string; readonly source: string; readonly outcome: string;
    readonly actor: { readonly type: string; readonly id: string }; readonly aggregateId: string;
    readonly payload: Readonly<Record<string, unknown>> }): boolean {
  try { validateAuditEventDraft({...event,sessionId:'projection',correlationId:'projection'} as import('@intellifin/domain').AuditEventDraft); }
  catch { return false; }
  return command.kind==='flag' && event.eventType==='lifecycle.run-flagged' && event.source==='web' && event.outcome==='success' &&
    event.actor.type==='human' && event.actor.id===command.actorId && event.aggregateId===command.runId && event.payload.commandId===command.commandId &&
    command.flagAnchor!==null && canonicalJson(command.flagAnchor as JsonValue)===canonicalJson({noteDigest:event.payload.noteDigest,noteLength:event.payload.noteLength} as JsonValue);
}

export function matchesAnswerInteractionEvent(command: typeof runInteractionCommand.$inferSelect,
  event: { readonly eventType: string; readonly source: string; readonly outcome: string;
    readonly actor: { readonly type: string; readonly id: string }; readonly aggregateId: string;
    readonly payload: Readonly<Record<string, unknown>> }): boolean {
  const anchor = parseRunConversationQuestionAnchor(command.answerAnchor);
  const actual = parseRunConversationQuestionAnchor(event.payload.questionAnchor);
  return command.kind === 'answer' && anchor !== null && actual !== null &&
    canonicalJson(anchor as unknown as JsonValue) === canonicalJson(actual as unknown as JsonValue) &&
    event.aggregateId === command.runId && event.eventType === 'execution.escalation-answered' &&
    event.source === 'web' && event.outcome === 'success' && event.actor.type === 'human' && event.actor.id === command.actorId &&
    event.payload.commandId === command.commandId && event.payload.waitId === anchor.waitId && event.payload.kind === anchor.kind &&
    event.payload.answerOptionId === command.answerOptionId && event.payload.expectedRunRevision === command.expectedRunRevision &&
    event.payload.planDigest === command.planDigest && event.payload.closureKind === 'answer' && event.payload.priorState === 'AWAITING_AUDITOR' &&
    event.payload.state === (command.answerOptionId === 'abort' ? 'CANCELED' : 'RUNNING');
}

export function matchesResumeInteractionEvent(command: typeof runInteractionCommand.$inferSelect,
  event: { readonly eventType: string; readonly source: string; readonly outcome: string;
    readonly actor: { readonly type: string; readonly id: string }; readonly aggregateId: string;
    readonly payload: Readonly<Record<string, unknown>> }): boolean {
  const anchor = parseRunConversationResumeAnchor(command.resumeAnchor);
  return command.kind === 'resume' && anchor !== null && event.aggregateId === command.runId &&
    event.eventType === 'lifecycle.run-resumed' && event.source === 'web' && event.outcome === 'success' &&
    event.actor.type === 'human' && event.actor.id === command.actorId && event.payload.commandId === command.commandId &&
    event.payload.waitId === anchor.waitId && event.payload.pausedAt === anchor.pausedAt &&
    event.payload.deadline === anchor.deadline && event.payload.controlEpoch === anchor.controlEpoch &&
    event.payload.expectedRunRevision === command.expectedRunRevision && event.payload.planDigest === command.planDigest &&
    event.payload.closureKind === 'resume' && event.payload.priorState === 'PAUSED' && event.payload.state === 'RUNNING';
}

/** Cancellation facts are attributed to the original requester even at a worker boundary. */
export function matchesStopInteractionEvent(command: typeof runInteractionCommand.$inferSelect,
  event: { readonly eventType: string; readonly source: string; readonly outcome: string;
    readonly actor: { readonly type: string; readonly id: string }; readonly aggregateId: string;
    readonly payload: Readonly<Record<string, unknown>> }, state: 'queued' | 'applied'): boolean {
  return command.kind === 'stop' && event.aggregateId === command.runId && event.outcome === 'success' &&
    event.actor.type === 'human' && event.actor.id === command.actorId && event.payload.commandId === command.commandId &&
    (state === 'queued' ? event.eventType === 'lifecycle.run-cancel-requested' && event.source === 'web' && event.payload.performedBy === 'worker' && event.payload.state === 'RUNNING'
      : event.eventType === 'lifecycle.run-canceled' && ['web', 'worker'].includes(event.source) && event.payload.performedBy === event.source && event.payload.state === 'CANCELED' &&
        (event.source === 'worker' ? event.payload.priorState === 'RUNNING' : ['QUEUED', 'PAUSED', 'AWAITING_AUDITOR'].includes(String(event.payload.priorState))));
}

/** Called by the existing audit writer, in the transaction that owns the domain fact. */
export async function projectRunInteractionEvent(tx: Transaction, event: AuditEventRecord): Promise<void> {
  const commandId = event.payload.commandId;
  if (typeof commandId !== 'string' || !isUuidText(commandId)) return;
  const [command] = await tx.select().from(runInteractionCommand).where(and(
    eq(runInteractionCommand.commandId, commandId), eq(runInteractionCommand.runId, event.aggregateId),
  )).for('update').limit(1);
  if (!command) return;
  let state: 'queued' | 'applied' | 'superseded';
  let priorState: 'interpreted' | 'queued';
  const human = event.actor.type === 'human' && event.actor.id === command.actorId;
  if (command.kind === 'flag') {
    if (!matchesFlagInteractionEvent(command,event)) return;
    state='applied'; priorState='interpreted';
  } else if (command.kind === 'answer') {
    if (!matchesAnswerInteractionEvent(command, event)) return;
    state = 'applied'; priorState = 'interpreted';
  } else if (command.kind === 'stop') {
    if (matchesStopInteractionEvent(command, event, 'queued')) { state = 'queued'; priorState = 'interpreted'; }
    else if (matchesStopInteractionEvent(command, event, 'applied')) { state = 'applied'; priorState = event.source === 'web' ? 'interpreted' : 'queued'; }
    else return;
  } else if (command.kind === 'resume') {
    if (!matchesResumeInteractionEvent(command, event)) return;
    state = 'applied'; priorState = 'interpreted';
  } else if (command.kind === 'pause-now') {
    if (event.eventType === 'lifecycle.run-pause-requested' && event.source === 'web' && event.outcome === 'success' && human) {
      state = 'queued'; priorState = 'interpreted';
    } else if (event.eventType === 'lifecycle.run-paused' && event.source === 'worker' && event.outcome === 'success' && human) {
      state = 'applied'; priorState = 'queued';
    } else if (event.eventType === 'lifecycle.pause-superseded' && event.source === 'worker' && event.outcome === 'failure' &&
      event.actor.type === 'system' && event.actor.id === 'result-sealer' && event.payload.requestedBy === command.actorId) {
      state = 'superseded'; priorState = 'queued';
    } else return;
  } else if (command.kind === 'pause-after-inspection') {
    const anchor = parseDeferredPauseAnchor(command.deferredAnchor);
    if (anchor === null || event.payload.workItemId !== anchor.workItemId || event.payload.subjectKey !== anchor.subjectKey ||
      event.payload.registrationId !== anchor.registrationId) return;
    if (event.eventType === 'lifecycle.run-deferred-pause-requested' && event.source === 'web' && event.outcome === 'success' && human &&
      event.payload.expectedControlEpoch === command.deferredControlEpoch && event.payload.planDigest === command.planDigest &&
      event.payload.runRevision === command.expectedRunRevision) {
      state = 'queued'; priorState = 'interpreted';
    } else if (event.eventType === 'lifecycle.run-paused' && event.source === 'worker' && event.outcome === 'success' && human && event.payload.pauseMode === 'after-inspection') {
      state = 'applied'; priorState = 'queued';
    } else if (event.eventType === 'lifecycle.deferred-pause-superseded' && ['web', 'worker'].includes(event.source) && event.outcome === 'failure' &&
      event.actor.type === 'system' && event.actor.id === 'deferred-pause-coordinator' && event.payload.requestedBy === command.actorId) {
      state = 'superseded'; priorState = 'queued';
    } else return;
  } else return;
  const [prior] = await tx.select().from(runInteractionTransition)
    .where(eq(runInteractionTransition.commandId, command.commandId)).orderBy(desc(runInteractionTransition.sequence)).limit(1);
  // A terminal receipt is never overwritten by a later or duplicate fact.
  if (!prior || prior.state !== priorState) return;
  await tx.insert(runInteractionTransition).values({ commandId: command.commandId, sequence: prior.sequence + 1,
    state, reasonCode: command.kind === 'flag' ? 'run-flagged' : command.kind === 'answer' ? 'question-answered' : command.kind === 'stop' ? (state === 'queued' ? 'cancellation-requested' : 'run-canceled') : command.kind === 'resume' ? 'run-resumed' : state === 'queued' ? 'pause-requested' : state === 'applied' ? 'worker-paused' :
      command.kind === 'pause-after-inspection' ? 'deferred-pause-superseded' : 'run-finalized',
    createdAt: new Date(event.occurredAt), sourceEventId: event.eventId });
}
