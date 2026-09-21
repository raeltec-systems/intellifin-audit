import { describe, expect, it } from 'vitest';
import { matchesStopInteractionEvent } from './run-interaction-projection.js';
import type { runInteractionCommand } from '../db/schema.js';

const anchor = { waitId: '01a06fd8-0000-7000-8000-0000000000c2',
  pausedAt: '2026-09-19T12:00:00.000Z', deadline: '2026-09-19T12:30:00.000Z', controlEpoch: 7 };
const command: typeof runInteractionCommand.$inferSelect = {
  flagAnchor:null, answerAnchor: null, answerOptionId: null,
  commandId: '01a06fd8-0000-7000-8000-0000000000d1', runId: '01a06fd8-0000-7000-8000-0000000000d2',
  messageId: '01a06fd8-0000-7000-8000-0000000000d3', requestKey: '01a06fd8-0000-7000-8000-0000000000d4',
  actorId: 'auditor', kind: 'stop', semanticFingerprint: 'a'.repeat(64), planDigest: 'b'.repeat(64),
  expectedRunRevision: 2, interpretationVersion: 'confirmed-stop-v1',
  deferredAnchor: null, deferredControlEpoch: null, resumeAnchor: null, createdAt: new Date(anchor.pausedAt),
};
const event = { eventType: 'lifecycle.run-canceled', source: 'worker', outcome: 'success',
  actor: { type: 'human', id: 'auditor' }, aggregateId: command.runId,
  payload: { commandId: command.commandId, state: 'CANCELED', priorState: 'RUNNING', performedBy: 'worker' } };

describe('source-backed conversational Stop', () => {
  it('distinguishes requested cancellation from actual application', () => {
    expect(matchesStopInteractionEvent(command, event, 'applied')).toBe(true);
    expect(matchesStopInteractionEvent(command, event, 'queued')).toBe(false);
    const queued = { ...event, eventType: 'lifecycle.run-cancel-requested', source: 'web', payload: { ...event.payload, state: 'RUNNING' } };
    expect(matchesStopInteractionEvent(command, queued, 'queued')).toBe(true);
    expect(matchesStopInteractionEvent(command, queued, 'applied')).toBe(false);
  });
  it('requires the exact actor, Run, command and successful cancellation fact', () => {
    expect(matchesStopInteractionEvent(command, { ...event, actor: { type: 'human', id: 'other' } }, 'applied')).toBe(false);
    expect(matchesStopInteractionEvent(command, { ...event, aggregateId: command.messageId }, 'applied')).toBe(false);
    expect(matchesStopInteractionEvent(command, { ...event, outcome: 'failure' }, 'applied')).toBe(false);
    for (const payload of [{ ...event.payload, commandId: command.messageId }, { ...event.payload, state: 'RUNNING' },
      { ...event.payload, performedBy: 'web' }]) expect(matchesStopInteractionEvent(command, { ...event, payload }, 'applied')).toBe(false);
  });
});
