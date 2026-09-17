import { describe, expect, it } from 'vitest';
import { canonicalizeAuditEvent, createCanonicalAuditEvent } from '../audit-event.js';
import { assertNoWorkspaceCapabilities, workspaceReference } from './workspace-reference.js';

describe('workspace capability containment', () => {
  it('identifies a workspace with platform-owned data only', () => {
    expect(workspaceReference('018f0000-0000-7000-8000-000000000001'))
      .toBe('workspace-018f0000-0000-7000-8000-000000000001');
  });
  it.each(['workspaceId', 'workspace_id', 'providerSessionId', 'signedSessionId', 'wsEndpoint', 'cdpEndpoint', 'observerEndpoint', 'controlEndpoint', 'streamEndpoint', 'replayUrl'])
    ('refuses %s before a new immutable event is appended', key => {
      expect(() => assertNoWorkspaceCapabilities({ nested: [{ [key]: 'synthetic-capability' }] })).toThrow('capabilities are forbidden');
      expect(() => assertNoWorkspaceCapabilities({ workspaceReference: 'workspace-run-1' })).not.toThrow();
    });
  it('does not invalidate canonical bytes of an historical event', () => {
    const event = createCanonicalAuditEvent({
      actor: { type: 'system', id: 'workspace-worker' }, eventType: 'lifecycle.agent-workspace',
      source: 'worker', outcome: 'success', sessionId: 'historical-session', correlationId: 'historical-correlation',
      payload: { workspaceId: 'historical-expired-capability' },
    }, { eventId: '018f0000-0000-7000-8000-000000000001', occurredAt: '2026-09-01T00:00:00.000Z', sequence: 1 });
    expect(canonicalizeAuditEvent(event)).toContain('historical-expired-capability');
    expect(() => assertNoWorkspaceCapabilities(event.payload)).toThrow('capabilities are forbidden');
  });
});
