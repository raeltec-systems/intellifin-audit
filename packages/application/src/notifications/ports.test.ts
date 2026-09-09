import { describe, expect, it } from 'vitest';
import {
  createEscalationNotification,
  escalationNotificationBody,
  escalationNotificationRecipients,
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
    expect(escalationNotificationRecipients('auditor', ['manager', 'auditor', 'manager'])).toEqual([
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
