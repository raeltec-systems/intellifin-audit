import { and, desc, eq } from 'drizzle-orm';
import type { AuditEventRecord } from '@intellifin/domain';
import type { Transaction } from '../db/client.js';
import { isUuidText } from '../db/identifier.js';
import { runInteractionCommand, runInteractionTransition } from '../db/schema.js';

/** Called by the existing audit writer, in the transaction that owns the domain fact. */
export async function projectRunInteractionEvent(tx: Transaction, event: AuditEventRecord): Promise<void> {
  const commandId = event.payload.commandId;
  if (typeof commandId !== 'string' || !isUuidText(commandId)) return;
  let state: 'queued' | 'applied' | 'superseded';
  let priorState: 'interpreted' | 'queued';
  if (event.eventType === 'lifecycle.run-pause-requested' && event.source === 'web' && event.outcome === 'success' && event.actor.type === 'human') {
    state = 'queued'; priorState = 'interpreted';
  } else if (event.eventType === 'lifecycle.run-paused' && event.source === 'worker' && event.outcome === 'success' && event.actor.type === 'human') {
    state = 'applied'; priorState = 'queued';
  } else if (event.eventType === 'lifecycle.pause-superseded' && event.source === 'worker' && event.outcome === 'failure' && event.actor.type === 'system' && event.actor.id === 'result-sealer') {
    state = 'superseded'; priorState = 'queued';
  } else return;
  const actorId = state === 'superseded' ? event.payload.requestedBy : event.actor.id;
  if (typeof actorId !== 'string') return;
  const [command] = await tx.select().from(runInteractionCommand).where(and(
    eq(runInteractionCommand.commandId, commandId), eq(runInteractionCommand.runId, event.aggregateId),
    eq(runInteractionCommand.actorId, actorId), eq(runInteractionCommand.kind, 'pause-now'),
  )).for('update').limit(1);
  if (!command) return;
  const [prior] = await tx.select().from(runInteractionTransition)
    .where(eq(runInteractionTransition.commandId, command.commandId)).orderBy(desc(runInteractionTransition.sequence)).limit(1);
  // A terminal receipt is never overwritten by a later or duplicate fact.
  if (!prior || prior.state !== priorState) return;
  await tx.insert(runInteractionTransition).values({ commandId: command.commandId, sequence: prior.sequence + 1,
    state, reasonCode: state === 'queued' ? 'pause-requested' : state === 'applied' ? 'worker-paused' : 'run-finalized',
    createdAt: new Date(event.occurredAt), sourceEventId: event.eventId });
}
