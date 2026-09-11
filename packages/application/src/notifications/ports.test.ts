import { describe, expect, it } from 'vitest';
import {
  createEscalationNotification,
  createFlagNotification,
  escalationNotificationBody,
  flagNotificationBody,
  flagNotificationSendKey,
  isRunNotification,
  runNotificationRecipients,
  type EscalationNotification,
} from './ports.js';

const seed = {
  recipientId: 'auditor',
  runId: '01920000-0000-7000-8000-000000000001',
  waitId: '01920000-0000-7000-8000-000000000002',
  procedureId: '01920000-0000-7000-8000-000000000003',
  versionId: '01920000-0000-7000-8000-000000000004',
  procedureName: 'Terminated users',
  versionNumber: 1,
  escalationKind: 'choose-candidate' as const,
  deadline: '2026-09-07T14:00:00.000Z',
};

describe('escalation notifications', () => {
  it('deduplicates the initiator and preserves the identity reader order', () => {
    expect(runNotificationRecipients('auditor', ['manager', 'auditor', 'manager'])).toEqual([
      'auditor',
      'manager',
    ]);
  });

  it('uses one stable send key and carries only the safe Run projection', () => {
    const notification = createEscalationNotification(seed);
    expect(notification).toEqual({
      sendKey: 'escalation:01920000-0000-7000-8000-000000000002:auditor',
      recipientId: 'auditor',
      procedureId: seed.procedureId,
      versionId: seed.versionId,
      procedureName: seed.procedureName,
      versionNumber: 1,
      kind: 'escalation',
      runId: seed.runId,
      waitId: seed.waitId,
      escalationKind: 'choose-candidate',
      deadline: seed.deadline,
    } satisfies EscalationNotification);
  });

  it('renders Procedure, Run, kind and current time remaining only', () => {
    const notification = {
      ...createEscalationNotification(seed),
      // These values model data that exists in a Run detail but must never enter a
      // notification body. The formatter accepts only its safe projection.
      question: 'Which candidate is correct?',
      evidence: 'secret evidence value',
      secret: 'credential-token',
    } as EscalationNotification & { question: string; evidence: string; secret: string };
    const body = escalationNotificationBody(notification, new Date('2026-09-07T12:30:00.000Z'));
    expect(body).toContain('Procedure Terminated users');
    expect(body).toContain(`Run ${seed.runId}`);
    expect(body).toContain('Escalation choose-candidate');
    expect(body).toContain('Time remaining: 1 hour 30 minutes');
    expect(body).not.toContain(notification.question);
    expect(body).not.toContain(notification.evidence);
    expect(body).not.toContain(notification.secret);
  });

  it('reports no remaining time after the deadline', () => {
    expect(escalationNotificationBody(seed, new Date('2026-09-07T15:00:00.000Z'))).toContain('Time remaining: 0 minutes');
  });
});

describe('the flag notification projection (Story 5.5)', () => {
  it('names the Procedure, the Run and the flag, and carries no note', () => {
    const notification = createFlagNotification({
      recipientId: 'manager-1',
      runId: 'run-1',
      flagId: 'flag-1',
      procedureId: 'procedure-1',
      versionId: 'version-1',
      procedureName: 'Terminated users',
      versionNumber: 2,
    });
    expect(notification).toEqual({
      sendKey: 'flag:flag-1:manager-1',
      recipientId: 'manager-1',
      procedureId: 'procedure-1',
      versionId: 'version-1',
      procedureName: 'Terminated users',
      versionNumber: 2,
      kind: 'flag',
      runId: 'run-1',
      flagId: 'flag-1',
    });
    // There is nowhere for a note, a question or an Evidence value to live.
    expect(Object.keys(notification)).not.toContain('note');
  });
  it('keys a send by the flag and the recipient, so a replay cannot duplicate one', () => {
    expect(flagNotificationSendKey('flag-1', 'manager-1')).toBe('flag:flag-1:manager-1');
    expect(flagNotificationSendKey('flag-1', 'manager-2')).not.toBe(flagNotificationSendKey('flag-1', 'manager-1'));
  });
  it('renders a body with NO countdown, because a flag has no deadline', () => {
    const body = flagNotificationBody({ procedureName: 'Terminated users', runId: 'run-1' });
    expect(body).toBe('Procedure Terminated users; Run run-1; flagged for an Audit Manager.');
    // "0 minutes" would be a countdown that has already run out.
    expect(body).not.toContain('minute');
    expect(body).not.toContain('Time remaining');
  });
  it('tells a Run notification from a Procedure Version one', () => {
    expect(isRunNotification({ kind: 'escalation' } as never)).toBe(true);
    expect(isRunNotification({ kind: 'flag' } as never)).toBe(true);
    for (const kind of ['submitted', 'approved', 'rejected'] as const) {
      expect(isRunNotification({ kind } as never)).toBe(false);
    }
  });
});
