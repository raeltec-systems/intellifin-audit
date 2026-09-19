import { and, desc, eq } from 'drizzle-orm';
import type { AuditEventRecord } from '@intellifin/domain';
import { parseDeferredPauseAnchor } from '@intellifin/application';
import type { Transaction } from '../db/client.js';
import { isUuidText } from '../db/identifier.js';
import { runInteractionCommand, runInteractionTransition } from '../db/schema.js';

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
  if (command.kind === 'pause-now') {
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
    state, reasonCode: state === 'queued' ? 'pause-requested' : state === 'applied' ? 'worker-paused' :
      command.kind === 'pause-after-inspection' ? 'deferred-pause-superseded' : 'run-finalized',
    createdAt: new Date(event.occurredAt), sourceEventId: event.eventId });
}
