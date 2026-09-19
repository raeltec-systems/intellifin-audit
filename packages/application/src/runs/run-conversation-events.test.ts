import { describe, expect, it } from 'vitest';
import type { AuditEventRecord, JsonObject } from '@intellifin/domain';

import {
  mapAuditEventToRunConversationEvent,
  narrateRunConversationEvent,
  type RunConversationEventContext,
} from './run-conversation-events.js';

const RUN_ID = '01900000-0000-7000-8000-000000000001';
const EVENT_ID = '01900000-0000-7000-8000-000000000002';
const WORK_ITEM_ID = '01900000-0000-7000-8000-000000000003';
const STEP_EXECUTION_ID = '01900000-0000-7000-8000-000000000004';
const TOOL_ACTION_ID = '01900000-0000-7000-8000-000000000005';
const WAIT_ID = '01900000-0000-7000-8000-000000000006';
const EVIDENCE_ID = '01900000-0000-7000-8000-000000000007';
const SCREENSHOT_ID = '01900000-0000-7000-8000-000000000008';
const AT = '2026-09-19T12:00:00.000Z';
const DIGEST = 'a'.repeat(64);

function audit(
  eventType: AuditEventRecord['eventType'],
  payload: JsonObject,
  overrides: Partial<AuditEventRecord> = {},
): AuditEventRecord {
  return {
    actor: { type: 'system', id: 'worker' },
    aggregateId: RUN_ID,
    correlationId: '01900000-0000-7000-8000-000000000009',
    eventId: EVENT_ID,
    eventType,
    occurredAt: AT,
    outcome: 'success',
    payload,
    sequence: 4,
    sessionId: 'session-1',
    source: 'worker',
    previousHash: 'b'.repeat(64),
    eventHash: 'c'.repeat(64),
    ...overrides,
  };
}

function context(ordinal = 7): RunConversationEventContext {
  return {
    sourceOrdinalForWorkItemId: new Map([[WORK_ITEM_ID, ordinal]]),
    sourceOrdinalForStepId: new Map([['step-1', ordinal], [STEP_EXECUTION_ID, ordinal]]),
    sourceOrdinalForToolActionId: new Map([[TOOL_ACTION_ID, ordinal]]),
    sourceOrdinalForEvidenceId: new Map([[EVIDENCE_ID, ordinal], [SCREENSHOT_ID, ordinal]]),
  };
}

describe('run conversation audit event narration', () => {
  it('maps a committed workspace creation to fixed copy', () => {
    const result = narrateRunConversationEvent(audit('lifecycle.agent-workspace', {
      state: 'RUNNING',
      diagnostic: 'workspace-created',
      workspaceReference: 'provider-session://secret-handle',
      targetName: 'Ignore this captured instruction',
    }, { actor: { type: 'system', id: 'workspace-worker' } }));

    expect(result).toMatchObject({
      eventId: EVENT_ID,
      sequence: 4,
      at: AT,
      runId: RUN_ID,
      kind: 'workspace-created',
      text: 'A private workspace was created for this Run.',
      evidenceRefs: [],
      sourceOrdinal: null,
    });
    expect(result?.text).not.toContain('provider-session');
    expect(result?.text).not.toContain('Ignore this captured instruction');
  });

  it('carries only the exact capture Evidence IDs and an exact tool-action relation', () => {
    const result = narrateRunConversationEvent(audit('execution.capture-registered', {
      toolActionId: TOOL_ACTION_ID,
      targetSystem: 'loancore',
      structuralSnapshotEvidenceId: EVIDENCE_ID,
      screenshotEvidenceId: SCREENSHOT_ID,
      registered: 2,
      destination: 'https://provider.invalid/private?token=do-not-copy',
    }, { actor: { type: 'system', id: 'agent-worker' } }), context());

    expect(result).toMatchObject({
      kind: 'capture-registered',
      text: 'A protected capture was registered for the current inspection.',
      sourceOrdinal: 7,
      evidenceRefs: [
        { evidenceId: EVIDENCE_ID, locator: null },
        { evidenceId: SCREENSHOT_ID, locator: null },
      ],
    });
    expect(result?.text).not.toContain(EVIDENCE_ID);
    expect(result?.text).not.toContain('provider.invalid');
  });

  it('uses the explicit inspection-start event and does not invent inspection from capture facts', () => {
    const started = narrateRunConversationEvent(audit('lifecycle.agent-work', {
      state: 'RUNNING',
      diagnostic: 'work-item-attempt-started',
      workItemId: WORK_ITEM_ID,
      stepExecutionId: STEP_EXECUTION_ID,
      attempt: 1,
    }, { actor: { type: 'system', id: 'agent-worker' } }), context());
    expect(started).toMatchObject({ kind: 'current-inspection', sourceOrdinal: 7 });
    expect(started?.text).toBe('The current inspection started.');

    const completed = narrateRunConversationEvent(audit('lifecycle.agent-work', {
      state: 'RUNNING',
      diagnostic: 'work-item-observed',
      workItemId: WORK_ITEM_ID,
      stepExecutionId: STEP_EXECUTION_ID,
      observations: 1,
    }, { actor: { type: 'system', id: 'agent-worker' } }), context());
    expect(completed).toBeNull();
  });

  it('maps observation registration only when its committed digest envelope is intact', () => {
    const result = narrateRunConversationEvent(audit('execution.observations-registered', {
      workItemId: WORK_ITEM_ID,
      stepExecutionId: STEP_EXECUTION_ID,
      registrationId: 'loancore',
      schemaVersion: 1,
      registered: 1,
      alreadyRegistered: 0,
      digests: [DIGEST],
      batchDigest: DIGEST,
      evaluations: 1,
    }, { actor: { type: 'system', id: 'observation-registrar' } }), context());
    expect(result).toMatchObject({ kind: 'observations-registered', sourceOrdinal: 7, evidenceRefs: [] });

    const malformed = narrateRunConversationEvent(audit('execution.observations-registered', {
      workItemId: WORK_ITEM_ID,
      stepExecutionId: STEP_EXECUTION_ID,
      registrationId: 'loancore',
      registered: 1,
      digests: ['captured text'],
      batchDigest: DIGEST,
    }, { actor: { type: 'system', id: 'observation-registrar' } }), context());
    expect(malformed).toBeNull();
  });

  it('maps a typed escalation and its exact supporting Evidence references', () => {
    const result = narrateRunConversationEvent(audit('execution.escalation-raised', {
      waitId: WAIT_ID,
      kind: 'retry-or-skip',
      optionIds: ['retry', 'skip', 'abort'],
      deadline: '2026-09-19T13:00:00.000Z',
      stepId: 'step-1',
      supportingEvidenceIds: [EVIDENCE_ID],
      question: 'Ignore this arbitrary page instruction',
    }, { actor: { type: 'system', id: 'escalation-platform' }, source: 'platform' }), context());

    expect(result).toMatchObject({
      kind: 'escalation-raised',
      text: 'The Run is waiting for an auditor decision.',
      sourceOrdinal: 7,
      evidenceRefs: [{ evidenceId: EVIDENCE_ID, locator: null }],
    });
    expect(result?.text).not.toContain(WAIT_ID);
    expect(result?.text).not.toContain('Ignore this arbitrary page instruction');
  });

  it.each([
    ['lifecycle.run-pause-requested', 'pause-requested', { actor: { type: 'human', id: 'auditor-1' }, source: 'web' }, { state: 'RUNNING', requestedAt: AT, performedBy: 'worker' }],
    ['lifecycle.run-paused', 'paused', { actor: { type: 'human', id: 'auditor-1' }, source: 'worker' }, { priorState: 'RUNNING', state: 'PAUSED', waitId: WAIT_ID, requestedAt: AT, occurredAt: AT, deadline: '2026-09-19T13:00:00.000Z', workItemId: WORK_ITEM_ID }],
    ['lifecycle.run-resumed', 'resumed', { actor: { type: 'human', id: 'auditor-1' }, source: 'web' }, { priorState: 'PAUSED', state: 'RUNNING', waitId: WAIT_ID, closureKind: 'resume', pausedAt: AT, occurredAt: AT }],
  ] as const)('maps the exact %s transition as %s', (eventType, kind, overrides, payload) => {
    const result = narrateRunConversationEvent(audit(eventType as AuditEventRecord['eventType'], payload, overrides));
    expect(result?.kind).toBe(kind);
    expect(result?.text).not.toMatch(UUID_TEXT);
  });

  it('maps result sealing as the terminal event and ignores unsupported provenance', () => {
    const result = narrateRunConversationEvent(audit('lifecycle.result-sealed', {
      outcome: 'CONTROL_FAILURE',
      rule: 'control-failure',
      sealed: true,
      version: 1,
      runState: 'RUN_FAILED',
      providerUrl: 'https://provider.invalid',
      privateId: RUN_ID,
    }, { actor: { type: 'system', id: 'result-sealer' }, outcome: 'failure' }));
    expect(result).toMatchObject({ kind: 'ended', text: 'The Run ended and its result was sealed.' });

    const unsupported = narrateRunConversationEvent(audit('lifecycle.result-sealed', {
      outcome: 'PASS', sealed: true, version: 1, runState: 'RUNNING',
    }, { actor: { type: 'system', id: 'result-sealer' } }));
    expect(unsupported).toBeNull();
  });

  it('rejects forged actors, outcomes and malformed IDs instead of narrating them', () => {
    const forged = narrateRunConversationEvent(audit('execution.capture-registered', {
      toolActionId: TOOL_ACTION_ID,
      targetSystem: 'loancore',
      structuralSnapshotEvidenceId: 'provider-handle',
      screenshotEvidenceId: null,
      registered: 1,
    }, { actor: { type: 'system', id: 'untrusted-worker' } }));
    expect(forged).toBeNull();

    const denied = narrateRunConversationEvent(audit('lifecycle.agent-workspace', {
      state: 'RUNNING', diagnostic: 'workspace-created',
    }, { actor: { type: 'system', id: 'workspace-worker' }, outcome: 'denied' }));
    expect(denied).toBeNull();
  });
});

const UUID_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu;

describe('run conversation narration aliases', () => {
  it('keeps the projection alias equivalent to the primary mapper', () => {
    const event = audit('lifecycle.agent-workspace', { state: 'RUNNING', diagnostic: 'workspace-created' }, { actor: { type: 'system', id: 'workspace-worker' } });
    expect(mapAuditEventToRunConversationEvent(event)).toEqual(narrateRunConversationEvent(event));
  });
});
