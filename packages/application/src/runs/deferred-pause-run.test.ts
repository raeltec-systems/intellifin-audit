import { describe, expect, it } from 'vitest';
import type { AuditEventDraft, AuditEventRecord, Role, RunDeferredPauseRequest, RunRecord } from '@intellifin/domain';
import type { AuditEventWriter } from '../audit/ports.js';
import type { DeferredPauseContext, DeferredPauseDependencies } from './deferred-pause-run.js';
import { acceptDeferredPause, parseDeferredPauseAnchor } from './deferred-pause-run.js';

const RUN_ID = '019823ab-0000-7000-8000-000000000001';
const ITEM_ID = '019823ab-0000-7000-8000-000000000002';
const REGISTRATION_ID = '019823ab-0000-7000-8000-000000000003';
const SESSION = { userId: 'auditor-1', sessionId: 'session-1' };
const ANCHOR = { workItemId: ITEM_ID, subjectKey: 'EMP-7', registrationId: REGISTRATION_ID, runRevision: 12, planDigest: 'a'.repeat(64) } as const;

function run(state: RunRecord['state'] = 'RUNNING'): RunRecord & { revision: number } {
  return {
    runId: RUN_ID, correlationId: '019823ab-0000-7000-8000-000000000004', procedureId: '019823ab-0000-7000-8000-000000000005',
    versionId: '019823ab-0000-7000-8000-000000000006', versionNumber: 1, procedureName: 'Test',
    period: { from: '2026-01-01', to: '2026-01-31' }, state, kind: 'STANDARD', initiatorId: 'initiator',
    sessionId: 'initiator-session', authorizationRole: 'auditor', initiatedAt: '2026-09-19T00:00:00.000Z',
    requestToken: '019823ab-0000-7000-8000-000000000007', predecessorRunId: null, rerunReason: null,
    cancellation: null, pauseRequest: null, revision: 12,
  };
}

class Harness {
  run = run();
  marker: RunDeferredPauseRequest | null = null;
  events: AuditEventDraft[] = [];
  context: DeferredPauseContext;
  constructor() {
    const owner = this;
    this.context = {
      get run() { return owner.run; },
      authorizationRoles: { findRole: async (): Promise<Role | null> => 'auditor' },
      readCurrentInspection: async () => ({ anchor: ANCHOR, stage: 'EXECUTING', openWaitId: null, openWaitKind: null }),
      readControl: async () => ({ epoch: 4, holderId: SESSION.userId, expiresAt: '2026-09-19T10:02:00.000Z', now: new Date('2026-09-19T10:00:00.000Z') }),
      readDeferredPause: async () => owner.marker,
      requestDeferredPause: async (marker) => { owner.marker = marker; },
      settleDeferredPause: async () => undefined,
      auditEvents: {
        append: async (draft: AuditEventDraft) => {
          owner.events.push(draft);
          return { ...draft, eventId: `019823ab-0000-7000-8000-${String(owner.events.length).padStart(12, '0')}`, aggregateId: RUN_ID, occurredAt: '2026-09-19T10:00:00.000Z', sequence: owner.events.length, previousHash: '0'.repeat(64), eventHash: '1'.repeat(64) } as AuditEventRecord;
        },
      },
      notifyTimeline: async () => undefined,
    };
  }
  private readonly repository = {
    transaction: async <T>(_runId: string, work: (context: DeferredPauseContext) => Promise<T>) => work(this.context),
  };
  readonly dependencies: DeferredPauseDependencies = {
    roles: { findRole: async (): Promise<Role | null> => 'auditor' },
    unitOfWork: { execute: async <T>(work: (context: { auditEvents: AuditEventWriter }) => Promise<T>) => work({ auditEvents: this.context.auditEvents }) },
    repository: this.repository,
    ids: { next: () => '019823ab-0000-7000-8000-000000000008' },
    clock: { now: () => new Date('2026-09-19T10:00:00.000Z') },
    commandId: '019823ab-0000-7000-8000-000000000009',
  };
}

describe('deferred pause admission', () => {
  it('parses the exact, bounded anchor shape', () => {
    expect(parseDeferredPauseAnchor(ANCHOR)).toEqual(ANCHOR);
    expect(parseDeferredPauseAnchor({ ...ANCHOR, extra: true })).toBeNull();
    expect(parseDeferredPauseAnchor({ ...ANCHOR, planDigest: 'A'.repeat(64) })).toBeNull();
    expect(parseDeferredPauseAnchor({ ...ANCHOR, subjectKey: null })).toMatchObject({ subjectKey: null });
    expect(parseDeferredPauseAnchor({ ...ANCHOR, runRevision: 2_147_483_648 })).toBeNull();
    expect(parseDeferredPauseAnchor({ ...ANCHOR, subjectKey: 'é'.repeat(256) })).not.toBeNull();
    expect(parseDeferredPauseAnchor({ ...ANCHOR, subjectKey: 'é'.repeat(257) })).toBeNull();
  });

  it('requires the live owned epoch and retains one marker idempotently', async () => {
    const harness = new Harness();
    const input = { session: SESSION, request: { runId: RUN_ID, anchor: ANCHOR, expectedControlEpoch: 4 } };
    const accepted = await acceptDeferredPause(harness.dependencies, input);
    expect(accepted).toMatchObject({ ok: true, pending: true, marker: { state: 'PENDING', commandId: harness.dependencies.commandId } });
    expect(harness.events[0]?.eventType).toBe('lifecycle.run-deferred-pause-requested');
    expect(await acceptDeferredPause(harness.dependencies, input)).toMatchObject({ ok: true, pending: true });
    expect(harness.events).toHaveLength(1);
  });

  it('refuses a stale epoch, a retargeted anchor and a paused Run', async () => {
    const stale = new Harness();
    const staleResult = await acceptDeferredPause(stale.dependencies, { session: SESSION, request: { runId: RUN_ID, anchor: ANCHOR, expectedControlEpoch: 3 } });
    expect(staleResult).toMatchObject({ ok: false, code: 'stale-control' });

    const retargeted = new Harness();
    const changed = { ...ANCHOR, workItemId: '019823ab-0000-7000-8000-000000000010' };
    expect(await acceptDeferredPause(retargeted.dependencies, { session: SESSION, request: { runId: RUN_ID, anchor: changed, expectedControlEpoch: 4 } })).toMatchObject({ ok: false, code: 'not-current' });

    const paused = new Harness(); paused.run = run('PAUSED');
    expect(await acceptDeferredPause(paused.dependencies, { session: SESSION, request: { runId: RUN_ID, anchor: ANCHOR, expectedControlEpoch: 4 } })).toMatchObject({ ok: false, code: 'paused' });
  });
  it('rechecks authority inside the transaction before reading or writing the latch', async () => {
    const harness = new Harness();
    harness.context.authorizationRoles.findRole = async () => null;
    expect(await acceptDeferredPause(harness.dependencies, { session: SESSION,
      request: { runId: RUN_ID, anchor: ANCHOR, expectedControlEpoch: 4 } })).toMatchObject({ ok: false, code: 'unauthorized' });
    expect(harness.marker).toBeNull();
    expect(harness.events.some(event => event.eventType === 'lifecycle.run-deferred-pause-requested')).toBe(false);
  });

  it('uses database time and rejects an expired lease despite a matching owner and epoch', async () => {
    const harness = new Harness();
    harness.context.readControl = async () => ({ epoch: 4, holderId: SESSION.userId,
      expiresAt: '2026-09-19T10:00:00.000Z', now: new Date('2026-09-19T10:00:00.001Z') });
    expect(await acceptDeferredPause(harness.dependencies, { session: SESSION,
      request: { runId: RUN_ID, anchor: ANCHOR, expectedControlEpoch: 4 } })).toMatchObject({ ok: false, code: 'stale-control' });
    expect(harness.marker).toBeNull();
  });

  it('keeps an existing exact inspection question open and refuses a mismatched wait', async () => {
    const harness = new Harness(); harness.run = run('AWAITING_AUDITOR');
    const request = { runId: RUN_ID, anchor: ANCHOR, expectedControlEpoch: 4 };
    expect(await acceptDeferredPause(harness.dependencies, { session: SESSION, request })).toMatchObject({ ok: false, code: 'awaiting-other-work' });
    harness.context.readCurrentInspection = async () => ({ anchor: ANCHOR, stage: 'WAITING', openWaitId: 'open-inspection-question', openWaitKind: 'retry-or-skip' });
    expect(await acceptDeferredPause(harness.dependencies, { session: SESSION, request })).toMatchObject({ ok: true });
    expect(harness.events.map(event => event.eventType)).toEqual(['lifecycle.run-deferred-pause-requested']);
  });

});
