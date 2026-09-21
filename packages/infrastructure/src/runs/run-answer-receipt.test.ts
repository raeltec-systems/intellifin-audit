import { describe, expect, it } from 'vitest';
import { matchesAnswerInteractionEvent } from './run-interaction-projection.js';
import type { runInteractionCommand } from '../db/schema.js';
const anchor = { runId: '01990000-0000-7000-8000-000000000001', waitId: '01990000-0000-7000-8000-000000000002',
  raisedEventId: '01990000-0000-7000-8000-000000000003', kind: 'retry-or-skip', runRevision: 2,
  openedAt: '2026-09-20T00:00:00.000Z', deadline: '2026-09-20T04:00:00.000Z', questionDigest: 'a'.repeat(64) };
const command: typeof runInteractionCommand.$inferSelect = { commandId: '01990000-0000-7000-8000-000000000004',
  runId: anchor.runId, messageId: anchor.waitId, actorId: 'auditor', kind: 'answer', requestKey: anchor.waitId,
  semanticFingerprint: 'b'.repeat(64), planDigest: 'c'.repeat(64), expectedRunRevision: 2, interpretationVersion: 'confirmed-answer-v1',
  deferredAnchor: null, deferredControlEpoch: null, resumeAnchor: null, flagAnchor:null, answerAnchor: anchor, answerOptionId: 'retry', createdAt: new Date() };
const event = { aggregateId: anchor.runId, eventType: 'execution.escalation-answered', source: 'web', outcome: 'success',
  actor: { type: 'human', id: 'auditor' }, payload: { commandId: command.commandId, waitId: anchor.waitId, kind: anchor.kind,
    answerOptionId: 'retry', questionAnchor: anchor, expectedRunRevision: 2, planDigest: command.planDigest,
    closureKind: 'answer', priorState: 'AWAITING_AUDITOR', state: 'RUNNING' } };
describe('answer event identity', () => {
  it('accepts only its exact successful domain answer and anchor', () => {
    expect(matchesAnswerInteractionEvent(command, event)).toBe(true);
    for (const patch of [{ questionAnchor: null }, { questionAnchor: { ...anchor, runRevision: '2' } },
      { questionAnchor: { ...anchor, raisedEventId: command.commandId } }, { questionAnchor: { ...anchor, questionDigest: 'd'.repeat(64) } },
      { commandId: anchor.runId }, { expectedRunRevision: '2' }, { answerOptionId: 'skip' }, { waitId: anchor.runId },
      { kind: 'pause' }, { planDigest: 'd'.repeat(64) }, { state: 'CANCELED' }])
      expect(matchesAnswerInteractionEvent(command, { ...event, payload: { ...event.payload, ...patch } })).toBe(false);
    expect(matchesAnswerInteractionEvent(command, { ...event, source: 'worker' })).toBe(false);
    expect(matchesAnswerInteractionEvent(command, { ...event, actor: { type: 'human', id: 'other' } })).toBe(false);
  });
});
