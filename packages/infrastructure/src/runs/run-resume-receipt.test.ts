import { describe, expect, it } from 'vitest';
import { parseRunConversationResumeAnchor } from '@intellifin/application';
import { matchesResumeInteractionEvent } from './run-interaction-projection.js';
import type { runInteractionCommand } from '../db/schema.js';

const anchor = { waitId: '01a06fd8-0000-7000-8000-0000000000c2',
  pausedAt: '2026-09-19T12:00:00.000Z', deadline: '2026-09-19T12:30:00.000Z', controlEpoch: 7 };
const command: typeof runInteractionCommand.$inferSelect = {
  flagAnchor:null, answerAnchor: null, answerOptionId: null,
  commandId: '01a06fd8-0000-7000-8000-0000000000d1', runId: '01a06fd8-0000-7000-8000-0000000000d2',
  messageId: '01a06fd8-0000-7000-8000-0000000000d3', requestKey: '01a06fd8-0000-7000-8000-0000000000d4',
  actorId: 'auditor', kind: 'resume', semanticFingerprint: 'a'.repeat(64), planDigest: 'b'.repeat(64),
  expectedRunRevision: 2, interpretationVersion: 'confirmed-resume-v1',
  deferredAnchor: null, deferredControlEpoch: null, resumeAnchor: anchor, createdAt: new Date(anchor.pausedAt),
};
const event = { eventType: 'lifecycle.run-resumed', source: 'web', outcome: 'success',
  actor: { type: 'human', id: 'auditor' }, aggregateId: command.runId,
  payload: { ...anchor, commandId: command.commandId, expectedRunRevision: 2, planDigest: command.planDigest,
    closureKind: 'resume', priorState: 'PAUSED', state: 'RUNNING' } };

describe('source-backed conversational Resume', () => {
  it('recognizes only the exact reviewed pause, lease and frozen Run context', () => {
    expect(parseRunConversationResumeAnchor(anchor)).toEqual(anchor);
    expect(matchesResumeInteractionEvent(command, event)).toBe(true);
    expect(matchesResumeInteractionEvent(command, { ...event, actor: { type: 'human', id: 'another' } })).toBe(false);
    expect(matchesResumeInteractionEvent(command, { ...event, source: 'worker' })).toBe(false);
    expect(matchesResumeInteractionEvent(command, { ...event, aggregateId: command.messageId })).toBe(false);
  });

  it.each([
    ['waitId', command.commandId], ['pausedAt', anchor.deadline], ['deadline', anchor.pausedAt],
    ['controlEpoch', '7'], ['expectedRunRevision', '2'], ['planDigest', 'c'.repeat(64)],
    ['commandId', command.messageId], ['closureKind', 'answer'], ['state', 'PAUSED'],
  ])('refuses a changed or text-coerced %s in the source fact', (field, value) => {
    expect(matchesResumeInteractionEvent(command, { ...event, payload: { ...event.payload, [field!]: value } })).toBe(false);
  });

  it.each([
    { ...anchor, extra: true }, { ...anchor, controlEpoch: '7' }, { ...anchor, controlEpoch: 0 },
    { ...anchor, controlEpoch: 1.5 }, { ...anchor, deadline: anchor.pausedAt },
    { ...anchor, pausedAt: '2026-02-31T12:00:00.000Z' }, { ...anchor, waitId: 'other-wait' },
  ])('refuses malformed immutable pause context %#', candidate => {
    expect(parseRunConversationResumeAnchor(candidate)).toBeNull();
  });
});
