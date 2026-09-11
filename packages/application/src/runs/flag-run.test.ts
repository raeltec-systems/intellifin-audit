import { describe, expect, it, vi } from 'vitest';
import {
  RUN_FLAG_NOTE_MAX_LENGTH,
  RUN_FLAG_REFUSALS,
  isFlaggableRunState,
  sha256Hex,
  type RunFlag,
  type RunRecord,
  type RunState,
} from '@intellifin/domain';
import { FLAGGED_EVENT, FLAG_REQUEST_MALFORMED, flagRun } from './flag-run.js';
import type { FlagNotification } from '../notifications/ports.js';
import type { RunFlagContext } from './ports.js';

const RUN_ID = '019823ab-0000-7000-8000-000000000001';
const SESSION = { userId: 'auditor-1', sessionId: 'session-1' };

function runRecord(state: RunState): RunRecord {
  return {
    runId: RUN_ID,
    correlationId: '019823ab-0000-7000-8000-0000000000ff',
    procedureId: '019823ab-0000-7000-8000-000000000010',
    versionId: '019823ab-0000-7000-8000-000000000011',
    versionNumber: 3,
    procedureName: 'Terminated users',
    period: { from: '2026-08-01', to: '2026-08-31' },
    state,
    kind: 'STANDARD',
    initiatorId: 'initiator-9',
    sessionId: 'initiator-session',
    authorizationRole: 'auditor',
    initiatedAt: '2026-09-01T00:00:00.000Z',
    revision: 4,
    predecessorRunId: null,
    cancellation: null,
    pauseRequest: null,
  } as unknown as RunRecord;
}

interface Harness {
  readonly outcome: Awaited<ReturnType<typeof flagRun>>;
  readonly flags: RunFlag[];
  readonly notifications: FlagNotification[];
  readonly events: { eventType: string; payload: Record<string, unknown>; actor: unknown; sessionId: string }[];
  readonly denials: { eventType: string }[];
  readonly notified: number[];
}

async function flag(options: {
  state?: RunState | null;
  role?: string | null;
  lockedRole?: string | null;
  request?: unknown;
  managers?: readonly string[];
}): Promise<Harness> {
  const flags: RunFlag[] = [];
  const notifications: FlagNotification[] = [];
  const events: Harness['events'] = [];
  const denials: { eventType: string }[] = [];
  const notified: number[] = [];
  const run = options.state === null ? null : runRecord(options.state ?? 'RUNNING');
  const context: RunFlagContext = {
    run,
    // `??` would swallow an explicit `null`, which is exactly the case this harness has to
    // be able to express: a role revoked between the outer check and the row lock.
    authorizationRoles: { findRole: async () => (Object.hasOwn(options, 'lockedRole') ? options.lockedRole : options.role ?? 'auditor') as never },
    auditEvents: {
      append: async (event: { eventType: string; payload: unknown; actor: unknown; sessionId?: string }) => {
        events.push({ eventType: event.eventType, payload: event.payload as Record<string, unknown>, actor: event.actor, sessionId: event.sessionId ?? '' });
        return { sequence: 12 } as never;
      },
    } as never,
    auditManagerIds: async () => options.managers ?? ['manager-1', 'manager-2'],
    insertFlag: async (value) => { flags.push(value); },
    enqueueNotification: async (value) => { notifications.push(value); },
    notifyTimeline: async (sequence) => { notified.push(sequence); },
  };
  const outcome = await flagRun(
    {
      roles: { findRole: async () => (options.role ?? 'auditor') as never },
      unitOfWork: {
        execute: async (work: (context: unknown) => Promise<unknown>) => work({
          auditEvents: { append: async (event: { eventType: string }) => { denials.push({ eventType: event.eventType }); return { sequence: 1 }; } },
        }),
      } as never,
      repository: { transaction: async (_runId, work) => work(context) },
      ids: { next: () => '019823ab-0000-7000-8000-0000000000aa' },
      clock: { now: () => new Date('2026-09-07T10:00:00.000Z') },
    },
    { session: SESSION, request: options.request ?? { runId: RUN_ID, note: 'Please look at the LoanCore step.' } },
  );
  return { outcome, flags, notifications, events, denials, notified };
}

describe('flagRun', () => {
  it('records one flag, notifies the initiator and every Audit Manager, and chains the note by digest', async () => {
    const harness = await flag({});
    expect(harness.outcome).toEqual({ ok: true, flagId: '019823ab-0000-7000-8000-0000000000aa' });
    expect(harness.flags).toEqual([{
      flagId: '019823ab-0000-7000-8000-0000000000aa',
      runId: RUN_ID,
      flaggedBy: 'auditor-1',
      sessionId: 'session-1',
      flaggedAt: '2026-09-07T10:00:00.000Z',
      note: 'Please look at the LoanCore step.',
    }]);
    // FR-28's recipient rule: the initiator and every Audit Manager, deduplicated.
    expect(harness.notifications.map((row) => row.recipientId)).toEqual(['initiator-9', 'manager-1', 'manager-2']);
    expect(harness.notifications[0]).toMatchObject({
      kind: 'flag',
      runId: RUN_ID,
      flagId: '019823ab-0000-7000-8000-0000000000aa',
      procedureName: 'Terminated users',
      versionNumber: 3,
      sendKey: 'flag:019823ab-0000-7000-8000-0000000000aa:initiator-9',
    });
    const event = harness.events.find((row) => row.eventType === FLAGGED_EVENT);
    expect(event).toBeDefined();
    expect(event?.actor).toEqual({ type: 'human', id: 'auditor-1' });
    // The NOTE never enters the chain; its length and digest do.
    expect(event?.payload).toEqual({
      flagId: '019823ab-0000-7000-8000-0000000000aa',
      state: 'RUNNING',
      flaggedAt: '2026-09-07T10:00:00.000Z',
      noteLength: 'Please look at the LoanCore step.'.length,
      noteDigest: sha256Hex('Please look at the LoanCore step.'),
    });
    expect(JSON.stringify(event?.payload)).not.toContain('LoanCore');
    expect(harness.notified).toEqual([12]);
  });

  it('carries no note into the notification rows at all', async () => {
    const harness = await flag({});
    for (const row of harness.notifications) {
      expect(JSON.stringify(row)).not.toContain('LoanCore');
      expect(Object.keys(row).sort()).toEqual([
        'flagId', 'kind', 'procedureId', 'procedureName', 'recipientId', 'runId', 'sendKey', 'versionId', 'versionNumber',
      ]);
    }
  });

  it('deduplicates an Audit Manager who initiated the Run', async () => {
    const harness = await flag({ managers: ['initiator-9', 'manager-2'] });
    expect(harness.notifications.map((row) => row.recipientId)).toEqual(['initiator-9', 'manager-2']);
  });

  it('records an absent note as null rather than an empty string', async () => {
    const blank = await flag({ request: { runId: RUN_ID, note: '   ' } });
    expect(blank.flags[0]?.note).toBeNull();
    expect(blank.events[0]?.payload).toMatchObject({ noteLength: 0, noteDigest: null });
    const missing = await flag({ request: { runId: RUN_ID, note: null } });
    expect(missing.flags[0]?.note).toBeNull();
  });

  it('trims a note before storing and digesting it', async () => {
    const harness = await flag({ request: { runId: RUN_ID, note: '  spaced  ' } });
    expect(harness.flags[0]?.note).toBe('spaced');
    expect(harness.events[0]?.payload).toMatchObject({ noteDigest: sha256Hex('spaced') });
  });

  it.each(['RUNNING', 'PAUSED', 'AWAITING_AUDITOR'] as const)('flags a %s Run', async (state) => {
    expect(isFlaggableRunState(state)).toBe(true);
    const harness = await flag({ state });
    expect(harness.outcome.ok).toBe(true);
  });

  it.each(['QUEUED', 'COMPLETED', 'CANCELED', 'INCONCLUSIVE', 'RUN_FAILED'] as const)('refuses a %s Run and writes nothing', async (state) => {
    const harness = await flag({ state });
    expect(harness.outcome).toEqual({ ok: false, reason: RUN_FLAG_REFUSALS.NOT_FLAGGABLE });
    expect(harness.flags).toEqual([]);
    expect(harness.notifications).toEqual([]);
    expect(harness.events).toEqual([]);
  });

  it('refuses a Run that does not exist', async () => {
    const harness = await flag({ state: null });
    expect(harness.outcome).toEqual({ ok: false, reason: RUN_FLAG_REFUSALS.UNKNOWN });
    expect(harness.flags).toEqual([]);
  });

  it.each([
    ['a non-object', 'not an object'],
    ['an array', []],
    ['an extra key', { runId: RUN_ID, note: null, extra: 1 }],
    ['a missing note key', { runId: RUN_ID }],
    ['a Run id that is not a UUID', { runId: 'not-a-uuid', note: null }],
    ['a numeric note', { runId: RUN_ID, note: 7 }],
    ['an over-long note', { runId: RUN_ID, note: 'x'.repeat(RUN_FLAG_NOTE_MAX_LENGTH + 1) }],
  ])('refuses %s', async (_label, request) => {
    const harness = await flag({ request });
    expect(harness.outcome).toEqual({ ok: false, reason: FLAG_REQUEST_MALFORMED });
    expect(harness.flags).toEqual([]);
  });

  it('refuses a role that cannot flag, before reading the request', async () => {
    const harness = await flag({ role: 'poc-administrator', request: 'not an object' });
    expect(harness.outcome.ok).toBe(false);
    expect(harness.outcome).not.toMatchObject({ reason: FLAG_REQUEST_MALFORMED });
    expect(harness.flags).toEqual([]);
  });

  it('audits a role revoked between the outer check and the lock, and writes no flag', async () => {
    const harness = await flag({ role: 'auditor', lockedRole: null });
    expect(harness.outcome.ok).toBe(false);
    expect(harness.flags).toEqual([]);
    expect(harness.denials.map((row) => row.eventType)).toEqual(['security.denied']);
  });

  it('accepts a note exactly at the bound', async () => {
    const note = 'y'.repeat(RUN_FLAG_NOTE_MAX_LENGTH);
    const harness = await flag({ request: { runId: RUN_ID, note } });
    expect(harness.outcome.ok).toBe(true);
    expect(harness.flags[0]?.note).toBe(note);
  });

  it('lowercases the Run id it was given', async () => {
    const harness = await flag({ request: { runId: RUN_ID.toUpperCase(), note: null } });
    expect(harness.outcome.ok).toBe(true);
  });

  it('has no way to change the Run: the context carries no state writer', async () => {
    // The containment is STRUCTURAL. `RunFlagContext` is the whole surface this command
    // can reach, so "a flag has no execution effect" is a fact about the type rather than
    // a rule a later branch has to remember.
    const context: RunFlagContext = {
      run: runRecord('RUNNING'),
      authorizationRoles: { findRole: async () => 'auditor' as never },
      auditEvents: { append: async () => ({ sequence: 1 }) as never } as never,
      auditManagerIds: async () => [],
      insertFlag: async () => undefined,
      enqueueNotification: async () => undefined,
      notifyTimeline: async () => undefined,
    };
    expect(Object.keys(context).sort()).toEqual([
      'auditEvents', 'auditManagerIds', 'authorizationRoles', 'enqueueNotification', 'insertFlag', 'notifyTimeline', 'run',
    ]);
  });

  it('lets an unexpected repository failure propagate rather than reporting success', async () => {
    await expect(flagRun(
      {
        roles: { findRole: async () => 'auditor' as never },
        unitOfWork: { execute: vi.fn() } as never,
        repository: { transaction: async () => { throw new Error('connection lost'); } },
        ids: { next: () => '019823ab-0000-7000-8000-0000000000aa' },
        clock: { now: () => new Date('2026-09-07T10:00:00.000Z') },
      },
      { session: SESSION, request: { runId: RUN_ID, note: null } },
    )).rejects.toThrow('connection lost');
  });
});
